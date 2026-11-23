#include "firmware_updater.h"

#include <Update.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp_task_wdt.h>

#include "data_logger.h"
#include "firmware_manager.h"
#include "neato_serial.h"
#include "settings_manager.h"
#include "update_verifier.h"

// Minimal plain-HTTP GET reader. The release host is reached over plain HTTP:
// the transport is not trusted, the signed token is. Keeping this hand-rolled
// (rather than pulling in HTTPClient) costs under 1 KB of flash and follows the
// same style as the ntfy sender.
//
// Every read is bounded by a deadline and feeds the task watchdog: a silently
// dropped connection must not block loop() long enough for the 15 s watchdog to
// reset the device.
namespace {

    // Upper bound for the small text feed. A misbehaving host (captive portal,
    // man in the middle) must not be able to exhaust the heap with a body.
    constexpr size_t MAX_FEED_BYTES = 1024;
    constexpr size_t MAX_HEADER_LINE = 512;

    // WiFiClient::setTimeout() takes seconds on this Arduino core, while
    // connect() and Stream::readBytes() use milliseconds.
    constexpr unsigned long IO_TIMEOUT_MS = OTA_CONNECT_TIMEOUT_MS;
    constexpr uint32_t IO_TIMEOUT_SECONDS = OTA_CONNECT_TIMEOUT_MS / 1000;

    // Buffered reader over a WiFiClient. Reads exactly the body bytes it
    // reports, so the same object can hand a raw stream to the flasher.
    class HttpResponse {
    public:
        explicit HttpResponse(WiFiClient& client) : stream(client) {}

        int status = 0;
        long contentLength = -1;
        bool chunked = false;
        String location;

        // Bound the whole exchange, not just each read. A slow or malicious
        // peer must not keep loop() (and the robot polling) paused forever.
        void setOverallTimeout(unsigned long ms) { overallEnd = millis() + ms; }

        bool readHead() {
            if (!readLine(statusLine, MAX_HEADER_LINE) || statusLine.length() < 12) {
                return false;
            }
            status = statusLine.substring(9, 12).toInt();
            while (readLine(line, MAX_HEADER_LINE)) {
                if (line.isEmpty()) {
                    return true;
                }
                int colon = line.indexOf(':');
                if (colon <= 0) {
                    continue;
                }
                String name = line.substring(0, colon);
                name.toLowerCase();
                String value = line.substring(colon + 1);
                value.trim();
                if (name == "content-length") {
                    contentLength = value.toInt();
                } else if (name == "transfer-encoding") {
                    chunked = value.indexOf("chunked") >= 0;
                } else if (name == "location") {
                    location = value;
                }
            }
            return false;
        }

        // Read up to maxLen bytes of body. Returns -1 on timeout/error, 0 at end.
        int readBody(uint8_t *dst, size_t maxLen) {
            if (done) {
                return 0;
            }
            if (chunked) {
                return readChunked(dst, maxLen);
            }
            if (contentLength >= 0 && totalRead >= static_cast<unsigned long>(contentLength)) {
                done = true;
                return 0;
            }
            size_t want = maxLen;
            if (contentLength >= 0) {
                size_t remaining = static_cast<size_t>(contentLength - static_cast<long>(totalRead));
                want = remaining < want ? remaining : want;
            }
            int n = readAvailable(dst, want);
            if (n == 0) {
                if (!stream.connected()) {
                    done = true; // Peer closed: caught by the size/hash check
                    return 0;
                }
                n = waitForData();
                if (n <= 0) {
                    return n;
                }
                n = readAvailable(dst, want);
            }
            if (n <= 0) {
                return -1;
            }
            totalRead += static_cast<unsigned long>(n);
            if (contentLength >= 0 && totalRead >= static_cast<unsigned long>(contentLength)) {
                done = true;
            }
            return n;
        }

        // Read the whole body into a String, capped at MAX_FEED_BYTES.
        bool readAll(String& out) {
            uint8_t buf[128];
            while (true) {
                int n = readBody(buf, sizeof(buf));
                if (n < 0) {
                    return false;
                }
                if (n == 0) {
                    return true;
                }
                if (out.length() + static_cast<unsigned int>(n) > MAX_FEED_BYTES) {
                    return false;
                }
                out.concat(reinterpret_cast<const char *>(buf), static_cast<unsigned int>(n));
            }
        }

    private:
        WiFiClient& stream;
        String statusLine;
        String line;
        unsigned long totalRead = 0;
        unsigned long remainingChunk = 0;
        unsigned long overallEnd = 0;
        bool done = false;

        bool overallExpired() const { return overallEnd != 0 && static_cast<long>(millis() - overallEnd) >= 0; }

        // Wait until any data arrives. Returns 1 when data is available, -1 on
        // timeout. Keeps the task watchdog fed while waiting.
        int waitForData() {
            unsigned long start = millis();
            while (millis() - start < IO_TIMEOUT_MS) {
                if (overallExpired()) {
                    return -1;
                }
                if (stream.available() > 0) {
                    return 1;
                }
                if (!stream.connected()) {
                    return 0;
                }
                esp_task_wdt_reset();
                delay(10);
            }
            return -1;
        }

        // Non-blocking read of whatever is already buffered.
        int readAvailable(uint8_t *dst, size_t maxLen) {
            if (maxLen == 0 || stream.available() <= 0) {
                return 0;
            }
            int n = stream.read(dst, maxLen);
            if (n > 0) {
                esp_task_wdt_reset();
            }
            return n < 0 ? 0 : n;
        }

        bool readLine(String& out, size_t maxLength) {
            out = "";
            unsigned long start = millis();
            while (millis() - start < IO_TIMEOUT_MS) {
                if (overallExpired()) {
                    return false;
                }
                while (stream.available() > 0) {
                    int c = stream.read();
                    if (c < 0) {
                        break;
                    }
                    if (c == '\n') {
                        if (out.endsWith("\r")) {
                            out.remove(out.length() - 1);
                        }
                        return true;
                    }
                    out += static_cast<char>(c);
                    if (out.length() > maxLength) {
                        return false;
                    }
                }
                if (!stream.connected()) {
                    return false;
                }
                esp_task_wdt_reset();
                delay(10);
            }
            return false;
        }

        int readChunked(uint8_t *dst, size_t maxLen) {
            while (true) {
                if (remainingChunk == 0) {
                    String sizeLine;
                    if (!readLine(sizeLine, MAX_HEADER_LINE)) {
                        return -1;
                    }
                    remainingChunk = strtoul(sizeLine.c_str(), nullptr, 16);
                    if (remainingChunk == 0) {
                        done = true;
                        return 0;
                    }
                }
                size_t want = maxLen < remainingChunk ? maxLen : remainingChunk;
                int n = readAvailable(dst, want);
                if (n == 0) {
                    n = waitForData();
                    if (n <= 0) {
                        return n < 0 ? -1 : 0;
                    }
                    n = readAvailable(dst, want);
                }
                if (n <= 0) {
                    return -1;
                }
                remainingChunk -= static_cast<unsigned long>(n);
                totalRead += static_cast<unsigned long>(n);
                if (remainingChunk == 0) {
                    String trailing;
                    readLine(trailing, MAX_HEADER_LINE); // CRLF after the chunk data
                }
                return n;
            }
        }
    };

    // Connect and issue a GET. Returns false if the connection or request fails.
    //
    // Note: connect(host) resolves DNS synchronously in this core (up to the DNS
    // timeout), and the watchdog cannot be fed during that call. It is fed right
    // before, so only a pathological resolver delay can still trip it.
    bool openGet(WiFiClient& client, const String& host, uint16_t port, const String& path) {
        esp_task_wdt_reset();
        client.setTimeout(IO_TIMEOUT_SECONDS);
        if (!client.connect(host.c_str(), port, static_cast<int32_t>(IO_TIMEOUT_MS))) {
            return false;
        }
        client.print("GET " + path + " HTTP/1.1\r\n");
        client.print("Host: " + host + "\r\n");
        client.print("User-Agent: OpenNeato/" FIRMWARE_VERSION "\r\n");
        client.print("Connection: close\r\n\r\n");
        return true;
    }

} // namespace

FirmwareUpdater::FirmwareUpdater(DataLogger& logger, SettingsManager& settings, FirmwareManager& fw,
                                 NeatoSerial& serial) :
    LoopTask(2000), dataLogger(logger), settingsMgr(settings), fwMgr(fw), neato(serial) {}

// Unattended installs wait until the robot is docked (external power present)
// and idle, so a reboot never interrupts a clean in progress.
void FirmwareUpdater::refreshRobotState() {
    if (millis() - stateRefreshAt < 10000) {
        return;
    }
    stateRefreshAt = millis();

    neato.getState([this](bool ok, const RobotState& state) {
        stateKnown = ok;
        robotIdle = ok && state.isIdle();
    });
    neato.getCharger([this](bool ok, const ChargerData& charger) { robotDocked = ok && charger.extPwrPresent; });
}

void FirmwareUpdater::requestCheck() {
    checkRequested = true;
}

void FirmwareUpdater::tick() {
    if (checkRequested) {
        checkRequested = false;
        checkDue = true;
    }

    // An upload from the web UI (or a previous install) owns the flasher.
    if (fwMgr.isInProgress() || !fwMgr.supportsSignedUpdates()) {
        return;
    }
    // Nothing polls the robot or the network unless the user opted in.
    if (!settingsMgr.get().autoUpdate) {
        return;
    }
    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    refreshRobotState();
    if (!checkDue && (millis() - lastCheckAt) < checkInterval) {
        return;
    }

    checkDue = false;
    lastCheckAt = millis();
    checkInterval = OTA_CHECK_INTERVAL_MS;
    checkForUpdate();
}

bool FirmwareUpdater::checkForUpdate() {
    auto retryLater = [this](const char *reason) {
        LOG("OTA", "Check failed: %s", reason);
        dataLogger.logOta("check_fail", {{"reason", reason, FIELD_STRING}});
        checkInterval = OTA_RETRY_INTERVAL_MS;
    };

    if (!canInstallNow()) {
        if (!gateBlocked) {
            LOG("OTA", "Update check postponed: robot not docked and idle");
            gateBlocked = true;
        }
        checkDue = true; // Retry as soon as the gate opens, no need to wait 6h
        return false;
    }
    gateBlocked = false;

    WiFiClient client;
    if (!openGet(client, OTA_UPDATE_HOST, OTA_UPDATE_PORT,
                 "/v1/latest?board=" + String(BOARD_ID) + "&version=" + String(FIRMWARE_VERSION))) {
        retryLater("connect");
        return false;
    }

    HttpResponse response(client);
    response.setOverallTimeout(OTA_FEED_TIMEOUT_MS);
    if (!response.readHead()) {
        client.stop();
        retryLater("response");
        return false;
    }

    if (response.status != 200) {
        client.stop();
        if (response.status == 204) {
            LOG("OTA", "Up to date (%s)", FIRMWARE_VERSION);
            return true;
        }
        LOG("OTA", "Update check returned %d", response.status);
        checkInterval = OTA_RETRY_INTERVAL_MS;
        return false;
    }

    String body;
    bool ok = response.readAll(body);
    client.stop();
    if (!ok) {
        retryLater("body");
        return false;
    }

    // Response: <version>\n<url>\n<token>\n (or just <version> when there is
    // nothing newer).
    std::vector<String> lines;
    int start = 0;
    while (start < static_cast<int>(body.length()) && lines.size() < 4) {
        int nl = body.indexOf('\n', start);
        if (nl < 0) {
            nl = body.length();
        }
        String line = body.substring(start, nl);
        line.trim();
        if (line.length()) {
            lines.push_back(line);
        }
        start = nl + 1;
    }

    if (lines.empty()) {
        retryLater("empty");
        return false;
    }

    const String& remoteVersion = lines[0];
    if (lines.size() < 3) {
        LOG("OTA", "Up to date (%s)", FIRMWARE_VERSION);
        return true;
    }

    if (compareVersions(remoteVersion, FIRMWARE_VERSION) <= 0) {
        LOG("OTA", "Up to date (%s)", FIRMWARE_VERSION);
        return true;
    }
    // Prereleases (v0.16-pr123.abcdef, branch builds) are installed only from
    // the web UI, where someone picks them deliberately. The version comes from
    // an unauthenticated reply, but the token must match it exactly, so a man in
    // the middle cannot substitute a signed prerelease here.
    if (remoteVersion.indexOf('-') >= 0) {
        LOG("OTA", "Skipping prerelease %s", remoteVersion.c_str());
        return true;
    }

    LOG("OTA", "Installing %s", remoteVersion.c_str());
    dataLogger.logOta("auto_start", {{"version", remoteVersion, FIELD_STRING}});

    String url = lines[1];
    String token = lines[2];
    if (!canInstallNow()) {
        LOG("OTA", "Robot became busy, aborting install of %s", remoteVersion.c_str());
        checkDue = true;
        return false;
    }

    if (!downloadAndInstall(url, token, remoteVersion)) {
        checkInterval = OTA_RETRY_INTERVAL_MS;
        return false;
    }
    return true;
}

bool FirmwareUpdater::downloadAndInstall(const String& url, const String& token, const String& expectedVersion) {
    // URL is absolute: http://host[:port]/path
    int schemeEnd = url.indexOf("://");
    if (schemeEnd < 0) {
        LOG("OTA", "Malformed update URL");
        return false;
    }
    String rest = url.substring(schemeEnd + 3);
    int slash = rest.indexOf('/');
    if (slash < 0) {
        LOG("OTA", "Malformed update URL");
        return false;
    }
    String hostPort = rest.substring(0, slash);
    String path = rest.substring(slash);
    uint16_t port = OTA_UPDATE_PORT;
    int colon = hostPort.indexOf(':');
    if (colon > 0) {
        port = static_cast<uint16_t>(hostPort.substring(colon + 1).toInt());
        hostPort = hostPort.substring(0, colon);
    }

    WiFiClient client;
    if (!openGet(client, hostPort, port, path)) {
        LOG("OTA", "Connect to update host failed");
        dataLogger.logOta("auto_fail", {{"reason", "connect", FIELD_STRING}});
        return false;
    }

    HttpResponse response(client);
    response.setOverallTimeout(OTA_DOWNLOAD_TIMEOUT_MS);
    if (!response.readHead() || response.status != 200) {
        LOG("OTA", "Firmware download returned %d", response.status);
        client.stop();
        dataLogger.logOta("auto_fail", {{"reason", "download", FIELD_STRING}});
        return false;
    }

    // Token is validated before a single flash write, so a bad or stale token
    // never touches the inactive slot.
    bool busy = false;
    uint32_t session = fwMgr.beginUpdate("", token, expectedVersion, &busy);
    if (session == 0) {
        String reason = busy ? "Another update is in progress" : fwMgr.getError();
        LOG("OTA", "Update rejected: %s", reason.c_str());
        client.stop();
        dataLogger.logOta("auto_fail", {{"reason", reason, FIELD_STRING}});
        return false;
    }

    uint8_t buffer[1024];
    bool ok = true;
    size_t total = 0;
    while (ok) {
        int n = response.readBody(buffer, sizeof(buffer));
        if (n < 0) {
            ok = false;
            LOG("OTA", "Download interrupted after %zu bytes", total);
            break;
        }
        if (n == 0) {
            break;
        }
        if (!fwMgr.writeChunk(session, buffer, static_cast<size_t>(n))) {
            ok = false;
            LOG("OTA", "Write failed: %s", fwMgr.getError().c_str());
            break;
        }
        total += static_cast<size_t>(n);
    }
    client.stop();

    if (!ok) {
        String reason = fwMgr.getError();
        fwMgr.abortUpdate(session);
        dataLogger.logOta("auto_fail", {{"reason", reason, FIELD_STRING}});
        return false;
    }

    if (!fwMgr.endUpdate(session)) {
        LOG("OTA", "Install failed: %s", fwMgr.getError().c_str());
        dataLogger.logOta("auto_fail", {{"reason", fwMgr.getError(), FIELD_STRING}});
        return false;
    }

    LOG("OTA", "Installed %zu bytes, rebooting", total);
    return true;
}
