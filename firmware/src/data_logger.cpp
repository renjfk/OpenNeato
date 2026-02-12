#include "data_logger.h"
#include "neato_serial.h"
#include <Preferences.h>
#include <WiFi.h>
#include <ctime>
#include <esp_system.h>
#include <heatshrink_decoder.h>

// -- Constructor -------------------------------------------------------------

DataLogger::DataLogger(NeatoSerial& neato) : neato(neato) {}

// -- Lifecycle ---------------------------------------------------------------

void DataLogger::begin() {
    // Mount SPIFFS (format on first use)
    if (!SPIFFS.begin(true)) {
        LOG("DLOG", "SPIFFS mount failed");
        return;
    }
    spiffsReady = true;
    LOG("DLOG", "SPIFFS mounted: %u / %u bytes used", SPIFFS.usedBytes(), SPIFFS.totalBytes());

    // Create log directory if needed (SPIFFS is flat, but path prefix works)
    if (!SPIFFS.exists(LOG_DIR)) {
        SPIFFS.mkdir(LOG_DIR);
    }

    // Compress any leftover uncompressed log from a previous run
    // (blocking is acceptable during boot — no web server yet)
    archiveLeftoverLog();

    // Seed currentFileSize from existing file (if any)
    if (SPIFFS.exists(LOG_CURRENT_FILE)) {
        File f = SPIFFS.open(LOG_CURRENT_FILE, FILE_READ);
        if (f) {
            currentFileSize = f.size();
            f.close();
        }
    }

    // Initialize timezone NVS namespace if it doesn't exist
    Preferences prefs;
    if (!prefs.begin(NTP_NVS_NAMESPACE, true)) {
        // Namespace doesn't exist — create it with default
        prefs.begin(NTP_NVS_NAMESPACE, false);
        prefs.putString(NTP_NVS_TZ_KEY, NTP_DEFAULT_TZ);
        prefs.end();
        LOG("DLOG", "Initialized timezone namespace with default: %s", NTP_DEFAULT_TZ);
    } else {
        prefs.end();
    }

    // Configure NTP with timezone from NVS
    String tz = getTimezone();
    configTzTime(tz.c_str(), NTP_SERVER_1, NTP_SERVER_2);
    LOG("DLOG", "NTP configured with TZ: %s", tz.c_str());

    // Register serial command logger hook with enhanced parameters
    neato.setLogger([this](const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int qDepth,
                           size_t respBytes) { onCommand(cmd, status, ms, raw, qDepth, respBytes); });

    // Fetch robot time for immediate clock
    fetchRobotTime();

    // Log boot event
    logBootEvent();

    lastFlushMs = millis();
}

void DataLogger::loop() {
    // Detect NTP sync transition
    if (!ntpSynced) {
        time_t t = time(nullptr);
        if (t > 1700000000) {
            ntpSynced = true;
            LOG("DLOG", "NTP synced: %ld", static_cast<long>(t));
            logNtp("sync_ok", String(R"("epoch":)") + String(static_cast<long>(t)));
            syncRobotTime();
            lastRobotSync = millis();
        }
    }

    // Periodic robot time re-sync from NTP
    if (ntpSynced && millis() - lastRobotSync >= ROBOT_TIME_SYNC_INTERVAL_MS) {
        syncRobotTime();
        lastRobotSync = millis();
    }

    // Flush write buffer to SPIFFS when interval elapsed or buffer full
    if (!writeBuffer.empty()) {
        bool intervalElapsed = millis() - lastFlushMs >= LOG_FLUSH_INTERVAL_MS;
        bool bufferFull = writeBuffer.size() >= LOG_FLUSH_MAX_LINES;
        if (intervalElapsed || bufferFull) {
            flushBuffer();
        }
    }

    // Incremental compression (one chunk per loop iteration)
    if (compressing) {
        if (compressStep()) {
            // Compression complete — clean up source file
            compressSrc.close();
            compressDst.close();

            LOG("DLOG", "Compressed %u -> %u bytes (%.0f%%)", compressTotalIn, compressTotalOut,
                compressTotalIn > 0
                        ? (100.0f * static_cast<float>(compressTotalOut) / static_cast<float>(compressTotalIn))
                        : 0.0f);

            SPIFFS.remove(pendingSrcPath);
            compressing = false;
            enforceSpaceLimit();
        }
    }

    // Deferred rotation: start compression if rotation was requested
    if (rotationPending && !compressing) {
        startCompression();
        rotationPending = false;
    }

    // Deferred bulk delete: delete one file per loop iteration
    if (bulkDeletePending && !bulkDeletePaths.empty()) {
        String path = bulkDeletePaths.back();
        bulkDeletePaths.pop_back();
        SPIFFS.remove(path);
        LOG("DLOG", "Bulk delete: %s", path.c_str());

        if (bulkDeletePaths.empty()) {
            bulkDeletePending = false;
        }
    }
}

// -- Time --------------------------------------------------------------------

time_t DataLogger::now() const {
    // Prefer NTP
    time_t t = time(nullptr);
    if (t > 1700000000)
        return t;

    // Fall back to robot clock
    if (robotTimeFetched && robotTimeBase > 0) {
        return robotTimeBase + (millis() - robotTimeMillis) / 1000;
    }

    // Last resort: uptime as pseudo-timestamp
    return static_cast<time_t>(millis() / 1000);
}

void DataLogger::fetchRobotTime() {
    // Issue GetTime to read the robot's clock
    neato.sendRaw("GetTime", [this](bool ok, const String& raw) {
        if (!ok) {
            LOG("DLOG", "GetTime failed");
            logError("NTP", "GetTime failed, no robot clock available");
            return;
        }

        // Parse "DayOfWeek HH:MM:SS" -> approximate epoch
        // Robot doesn't provide date, so we construct a rough epoch
        // Format: "Sunday 13:57:09" or similar
        String line = raw;
        line.trim();

        int spaceIdx = line.indexOf(' ');
        if (spaceIdx < 0)
            return;

        String timeStr = line.substring(spaceIdx + 1);
        int h = 0, m = 0, s = 0;
        // NOLINTNEXTLINE(cert-err34-c) - we check return value, conversion errors are handled
        if (sscanf(timeStr.c_str(), "%d:%d:%d", &h, &m, &s) == 3) {
            // Use a fixed date base (we only have time-of-day from robot)
            // This gives us correct relative ordering within a day
            struct tm tm = {};
            tm.tm_year = 2025 - 1900;
            tm.tm_mon = 0;
            tm.tm_mday = 1;
            tm.tm_hour = h;
            tm.tm_min = m;
            tm.tm_sec = s;
            robotTimeBase = mktime(&tm);
            robotTimeMillis = millis();
            robotTimeFetched = true;
            LOG("DLOG", "Robot time: %02d:%02d:%02d -> epoch %ld", h, m, s, static_cast<long>(robotTimeBase));
        }
    });
}

void DataLogger::triggerRobotTimeSync() {
    if (!ntpSynced) {
        LOG("DLOG", "Manual sync skipped: NTP not synced");
        return;
    }
    syncRobotTime();
}

void DataLogger::syncRobotTime() {
    // Push NTP time (local) to robot via SetTime
    time_t t = time(nullptr);
    if (t <= 1700000000)
        return;

    struct tm tm;
    localtime_r(&t, &tm);

    // SetTime Day <0-6> Hour <0-23> Min <0-59> Sec <0-59>
    // tm_wday: 0=Sunday matches Neato's format
    String cmd = "SetTime Day " + String(tm.tm_wday) + " Hour " + String(tm.tm_hour) + " Min " + String(tm.tm_min) +
                 " Sec " + String(tm.tm_sec);

    neato.sendRaw(cmd, [this](bool ok, const String&) {
        logNtp("robot_time_set", String(R"("ok":)") + (ok ? "true" : "false"));
        LOG("DLOG", "Robot clock sync %s", ok ? "OK" : "FAILED");
    });
}

// -- Write buffer (non-blocking log writes) ----------------------------------

void DataLogger::bufferLine(const String& jsonLine) {
    if (!spiffsReady)
        return;
    writeBuffer.push_back(jsonLine);
}

void DataLogger::flushBuffer() {
    if (writeBuffer.empty() || !spiffsReady)
        return;

    File f = SPIFFS.open(LOG_CURRENT_FILE, FILE_APPEND);
    if (!f) {
        LOG("DLOG", "Failed to open log file for writing");
        writeBuffer.clear();
        return;
    }

    for (const auto& line: writeBuffer) {
        size_t written = f.println(line);
        currentFileSize += written;
    }
    f.close();
    writeBuffer.clear();
    lastFlushMs = millis();

    // Check if rotation is needed (deferred — actual compression happens in loop())
    if (currentFileSize >= LOG_MAX_FILE_SIZE && !rotationPending && !compressing) {
        String baseName = String(LOG_DIR) + "/" + String(static_cast<long>(now()));
        pendingSrcPath = baseName + ".jsonl";
        pendingDstPath = baseName + ".jsonl.hs";
        LOG("DLOG", "Rotating log -> %s (%u bytes)", pendingDstPath.c_str(), currentFileSize);

        // Rename current log to uncompressed archive (fast, ~5ms)
        SPIFFS.rename(LOG_CURRENT_FILE, pendingSrcPath);
        currentFileSize = 0;
        rotationPending = true;
    }
}

// -- Incremental compression -------------------------------------------------

void DataLogger::startCompression() {
    compressSrc = SPIFFS.open(pendingSrcPath, FILE_READ);
    if (!compressSrc) {
        LOG("DLOG", "Compression failed: cannot open source %s", pendingSrcPath.c_str());
        return;
    }

    compressDst = SPIFFS.open(pendingDstPath, FILE_WRITE);
    if (!compressDst) {
        LOG("DLOG", "Compression failed: cannot open dest %s", pendingDstPath.c_str());
        compressSrc.close();
        return;
    }

    heatshrink_encoder_reset(&compressEncoder);
    compressInputDone = false;
    compressTotalIn = 0;
    compressTotalOut = 0;
    compressing = true;
}

bool DataLogger::compressStep() {
    // Process one chunk of input per call (~5ms of SPIFFS I/O)
    static const size_t CHUNK_SIZE = 512;
    uint8_t inBuf[CHUNK_SIZE];
    uint8_t outBuf[CHUNK_SIZE];

    if (!compressInputDone) {
        // Read one chunk from source
        int bytesRead = compressSrc.read(inBuf, CHUNK_SIZE);
        if (bytesRead <= 0) {
            compressInputDone = true;
        } else {
            // Sink all bytes from this chunk into the encoder
            size_t offset = 0;
            while (offset < static_cast<size_t>(bytesRead)) {
                size_t sunk = 0;
                HSE_sink_res sres =
                        heatshrink_encoder_sink(&compressEncoder, inBuf + offset, bytesRead - offset, &sunk);
                if (sres < 0) {
                    LOG("DLOG", "Heatshrink sink error");
                    compressSrc.close();
                    compressDst.close();
                    SPIFFS.remove(pendingDstPath);
                    compressing = false;
                    // Fall back to uncompressed archive (source already renamed)
                    return true;
                }
                offset += sunk;
                compressTotalIn += sunk;

                // Poll for compressed output
                size_t outSz = 0;
                HSE_poll_res pres;
                do {
                    pres = heatshrink_encoder_poll(&compressEncoder, outBuf, CHUNK_SIZE, &outSz);
                    if (pres < 0) {
                        LOG("DLOG", "Heatshrink poll error");
                        compressSrc.close();
                        compressDst.close();
                        SPIFFS.remove(pendingDstPath);
                        compressing = false;
                        return true;
                    }
                    if (outSz > 0) {
                        compressDst.write(outBuf, outSz);
                        compressTotalOut += outSz;
                    }
                } while (pres == HSER_POLL_MORE);
            }
        }
        return false; // More work to do
    }

    // Input exhausted — finish encoding
    HSE_finish_res fres = heatshrink_encoder_finish(&compressEncoder);
    if (fres < 0) {
        LOG("DLOG", "Heatshrink finish error");
        compressSrc.close();
        compressDst.close();
        SPIFFS.remove(pendingDstPath);
        compressing = false;
        return true;
    }

    // Poll remaining compressed output
    size_t outSz = 0;
    HSE_poll_res pres;
    do {
        pres = heatshrink_encoder_poll(&compressEncoder, outBuf, CHUNK_SIZE, &outSz);
        if (pres < 0) {
            LOG("DLOG", "Heatshrink poll error during finish");
            compressSrc.close();
            compressDst.close();
            SPIFFS.remove(pendingDstPath);
            compressing = false;
            return true;
        }
        if (outSz > 0) {
            compressDst.write(outBuf, outSz);
            compressTotalOut += outSz;
        }
    } while (pres == HSER_POLL_MORE);

    // HSER_FINISH_MORE means more finish passes needed
    return (fres == HSER_FINISH_DONE);
}

// -- Boot-only blocking compression ------------------------------------------

// NOLINTNEXTLINE(readability-convert-member-functions-to-static) - uses spiffsReady, SPIFFS, LOG
void DataLogger::archiveLeftoverLog() {
    if (!SPIFFS.exists(LOG_CURRENT_FILE))
        return;

    File f = SPIFFS.open(LOG_CURRENT_FILE, FILE_READ);
    if (!f)
        return;

    size_t size = f.size();
    f.close();

    if (size == 0) {
        SPIFFS.remove(LOG_CURRENT_FILE);
        return;
    }

    // Compress leftover log from previous run (millis fallback since no clock yet)
    String baseName = String(LOG_DIR) + "/boot_" + String(millis());
    String compressedName = baseName + ".jsonl.hs";
    LOG("DLOG", "Archiving leftover log (%u bytes)", size);

    bool compressed = compressFile(LOG_CURRENT_FILE, compressedName);
    if (compressed) {
        // Compression succeeded — remove original
        SPIFFS.remove(LOG_CURRENT_FILE);
    } else {
        // Compression failed — rename to uncompressed archive
        String uncompressedName = baseName + ".jsonl";
        SPIFFS.rename(LOG_CURRENT_FILE, uncompressedName);
    }
}

// NOLINTNEXTLINE(readability-convert-member-functions-to-static) - uses SPIFFS, LOG
void DataLogger::enforceSpaceLimit() {
    size_t maxBytes = (SPIFFS.totalBytes() * LOG_MAX_SPIFFS_PERCENT) / 100;
    if (SPIFFS.usedBytes() <= maxBytes)
        return;

    // Delete only one file per call — this runs from loop() so we avoid long blocking
    String oldest;
    File root = SPIFFS.open(LOG_DIR);
    if (!root || !root.isDirectory())
        return;

    File entry = root.openNextFile();
    while (entry) {
        String name = String(entry.name());
        if ((name.endsWith(".jsonl") || name.endsWith(".jsonl.hs")) && name != "current.jsonl") {
            if (oldest.isEmpty() || name < oldest) {
                oldest = name;
            }
        }
        entry = root.openNextFile();
    }

    if (!oldest.isEmpty()) {
        String fullPath = String(LOG_DIR) + "/" + oldest;
        LOG("DLOG", "Space limit: deleting %s", fullPath.c_str());
        SPIFFS.remove(fullPath);
    }
}

// -- Public logging methods --------------------------------------------------

// NOLINTNEXTLINE(readability-convert-member-functions-to-static) - uses now(), bufferLine()
void DataLogger::logEvent(const String& type, const String& jsonPayload) {
    String line =
            "{\"t\":" + String(static_cast<long>(now())) + ",\"typ\":\"" + type + "\",\"d\":{" + jsonPayload + "}}";
    bufferLine(line);
}

void DataLogger::logError(const String& source, const String& message) {
    logEvent("error", "\"src\":\"" + jsonEscape(source) + "\",\"msg\":\"" + jsonEscape(message) + "\"");
}

static const char *httpMethodStr(WebRequestMethodComposite method) {
    switch (method) {
        case HTTP_GET:
            return "GET";
        case HTTP_POST:
            return "POST";
        case HTTP_DELETE:
            return "DELETE";
        case HTTP_PUT:
            return "PUT";
        default:
            return "UNKNOWN";
    }
}

void DataLogger::logRequest(WebRequestMethodComposite method, const String& path, int status, unsigned long ms) {
    logEvent("request", "\"method\":\"" + String(httpMethodStr(method)) + "\",\"path\":\"" + jsonEscape(path) +
                                "\",\"status\":" + String(status) + ",\"ms\":" + String(ms));
}

void DataLogger::logWifi(const String& event, const String& jsonPayload) {
    logEvent("wifi", "\"event\":\"" + jsonEscape(event) + "\"" + (jsonPayload.length() > 0 ? "," + jsonPayload : ""));
}

void DataLogger::logOta(const String& event, const String& jsonPayload) {
    logEvent("ota", "\"event\":\"" + jsonEscape(event) + "\"" + (jsonPayload.length() > 0 ? "," + jsonPayload : ""));
}

void DataLogger::logNtp(const String& event, const String& jsonPayload) {
    logEvent("ntp", "\"event\":\"" + jsonEscape(event) + "\"" + (jsonPayload.length() > 0 ? "," + jsonPayload : ""));
}

void DataLogger::logBootEvent() {
    int reason = static_cast<int>(esp_reset_reason());
    String reasonStr;
    switch (reason) {
        case 1:
            reasonStr = "POWERON";
            break;
        case 3:
            reasonStr = "SW_RESET";
            break;
        case 4:
            reasonStr = "PANIC";
            break;
        case 5:
            reasonStr = "INT_WDT";
            break;
        case 6:
            reasonStr = "TASK_WDT";
            break;
        case 7:
            reasonStr = "WDT";
            break;
        case 8:
            reasonStr = "DEEPSLEEP";
            break;
        case 9:
            reasonStr = "BROWNOUT";
            break;
        case 10:
            reasonStr = "SDIO";
            break;
        default:
            reasonStr = "UNKNOWN_" + String(reason);
            break;
    }

    logEvent("boot", "\"reason\":\"" + reasonStr + "\",\"heap\":" + String(ESP.getFreeHeap()));
}

// -- NeatoSerial logger hook -------------------------------------------------

void DataLogger::onCommand(const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int queueDepth,
                           size_t respBytes) {
    // Convert status enum to string for JSON
    const char *statusStr;
    switch (status) {
        case CMD_SUCCESS:
            statusStr = "ok";
            break;
        case CMD_TIMEOUT:
            statusStr = "timeout";
            break;
        case CMD_PARSE_FAILED:
            statusStr = "parse_failed";
            break;
        case CMD_SERIAL_ERROR:
            statusStr = "serial_error";
            break;
        default:
            statusStr = "unknown";
            break;
    }

    // Log with enhanced metadata: status, queue depth, response size, partial response
    logEvent("command", "\"cmd\":\"" + jsonEscape(cmd) + "\",\"status\":\"" + String(statusStr) +
                                "\",\"ms\":" + String(ms) + ",\"q\":" + String(queueDepth) +
                                ",\"bytes\":" + String(respBytes) + ",\"resp\":\"" + jsonEscape(raw) + "\"");
}

// -- Log file management -----------------------------------------------------

std::vector<LogFileInfo> DataLogger::listLogs() const {
    std::vector<LogFileInfo> files;
    if (!spiffsReady)
        return files;

    // Add current log if it exists
    if (SPIFFS.exists(LOG_CURRENT_FILE)) {
        File f = SPIFFS.open(LOG_CURRENT_FILE, FILE_READ);
        if (f) {
            LogFileInfo info;
            info.name = "current.jsonl";
            info.size = f.size();
            files.push_back(info);
            f.close();
        }
    }

    // List archived logs
    File root = SPIFFS.open(LOG_DIR);
    if (!root || !root.isDirectory())
        return files;

    File entry = root.openNextFile();
    while (entry) {
        String name = String(entry.name());
        if ((name.endsWith(".jsonl.hs") || name.endsWith(".jsonl")) && name != "current.jsonl") {
            LogFileInfo info;
            info.name = name;
            info.size = entry.size();
            info.compressed = name.endsWith(".hs");
            files.push_back(info);
        }
        entry = root.openNextFile();
    }

    return files;
}

bool DataLogger::readLog(const String& filename, std::function<void(File&)> reader) const {
    if (!spiffsReady)
        return false;

    String path;
    if (filename == "current.jsonl") {
        path = LOG_CURRENT_FILE;
    } else {
        path = String(LOG_DIR) + "/" + filename;
    }

    if (!SPIFFS.exists(path))
        return false;

    File f = SPIFFS.open(path, FILE_READ);
    if (!f)
        return false;

    reader(f);
    f.close();
    return true;
}

bool DataLogger::decompressLog(const String& filename, std::function<void(const uint8_t *, size_t)> writer) const {
    if (!spiffsReady)
        return false;

    String path = String(LOG_DIR) + "/" + filename;
    if (!SPIFFS.exists(path))
        return false;

    File f = SPIFFS.open(path, FILE_READ);
    if (!f)
        return false;

    // Initialize heatshrink decoder (static alloc, same config as encoder)
    heatshrink_decoder hsd;
    heatshrink_decoder_reset(&hsd);

    uint8_t inBuf[512];
    uint8_t outBuf[512];
    size_t sunk = 0;
    size_t polled = 0;
    HSD_sink_res sres;
    HSD_poll_res pres;

    // Stream decompress: read compressed chunks, sink, poll, write decompressed output
    while (f.available()) {
        size_t bytesRead = f.read(inBuf, sizeof(inBuf));
        if (bytesRead == 0)
            break;

        size_t offset = 0;
        while (offset < bytesRead) {
            sres = heatshrink_decoder_sink(&hsd, &inBuf[offset], bytesRead - offset, &sunk);
            if (sres < 0) {
                f.close();
                return false; // Decoder error
            }
            offset += sunk;

            // Poll for decompressed output
            do {
                pres = heatshrink_decoder_poll(&hsd, outBuf, sizeof(outBuf), &polled);
                if (pres < 0) {
                    f.close();
                    return false;
                }
                if (polled > 0) {
                    writer(outBuf, polled);
                }
            } while (pres == HSDR_POLL_MORE);
        }
    }

    // Finish decoder — flush any remaining output
    HSD_finish_res fres = heatshrink_decoder_finish(&hsd);
    if (fres < 0) {
        f.close();
        return false;
    }

    do {
        pres = heatshrink_decoder_poll(&hsd, outBuf, sizeof(outBuf), &polled);
        if (pres < 0) {
            f.close();
            return false;
        }
        if (polled > 0) {
            writer(outBuf, polled);
        }
    } while (pres == HSDR_POLL_MORE);

    f.close();
    return true;
}

bool DataLogger::deleteLog(const String& filename) {
    if (!spiffsReady)
        return false;

    String path;
    if (filename == "current.jsonl") {
        path = LOG_CURRENT_FILE;
    } else {
        path = String(LOG_DIR) + "/" + filename;
    }

    return SPIFFS.remove(path);
}

void DataLogger::deleteAllLogs() {
    if (!spiffsReady)
        return;

    // Collect all paths — actual deletion is deferred to loop() (one per iteration)
    bulkDeletePaths.clear();

    // Current log
    if (SPIFFS.exists(LOG_CURRENT_FILE)) {
        bulkDeletePaths.push_back(LOG_CURRENT_FILE);
        currentFileSize = 0;
    }

    // Archived logs
    File root = SPIFFS.open(LOG_DIR);
    if (root && root.isDirectory()) {
        File entry = root.openNextFile();
        while (entry) {
            String name = String(entry.name());
            if (name.endsWith(".jsonl") || name.endsWith(".jsonl.hs")) {
                bulkDeletePaths.push_back(String(LOG_DIR) + "/" + name);
            }
            entry = root.openNextFile();
        }
    }

    if (!bulkDeletePaths.empty()) {
        bulkDeletePending = true;
    }
}

// -- System health -----------------------------------------------------------

String DataLogger::systemHealthJson() const {
    String json = "{";
    json += "\"heap\":" + String(ESP.getFreeHeap());
    json += ",\"heapTotal\":" + String(ESP.getHeapSize());
    json += ",\"uptime\":" + String(millis());
    json += ",\"rssi\":" + String(WiFi.RSSI());
    json += ",\"spiffsUsed\":" + String(spiffsReady ? SPIFFS.usedBytes() : 0);
    json += ",\"spiffsTotal\":" + String(spiffsReady ? SPIFFS.totalBytes() : 0);
    json += ",\"ntpSynced\":" + String(ntpSynced ? "true" : "false");
    json += ",\"time\":" + String(static_cast<long>(now()));
    json += R"(,"timeSource":")" + String(ntpSynced ? "ntp" : (robotTimeFetched ? "robot" : "millis")) + R"(")";
    json += R"(,"tz":")" + jsonEscape(getTimezone()) + R"(")";
    json += "}";
    return json;
}

// -- Timezone ----------------------------------------------------------------

String DataLogger::getTimezone() const {
    Preferences prefs;
    if (!prefs.begin(NTP_NVS_NAMESPACE, true)) {
        // Namespace doesn't exist yet (first boot) — return default
        return NTP_DEFAULT_TZ;
    }
    String tz = prefs.getString(NTP_NVS_TZ_KEY, NTP_DEFAULT_TZ);
    prefs.end();
    return tz;
}

void DataLogger::setTimezone(const String& tz) {
    Preferences prefs;
    prefs.begin(NTP_NVS_NAMESPACE, false);
    prefs.putString(NTP_NVS_TZ_KEY, tz);
    prefs.end();

    // Apply immediately
    configTzTime(tz.c_str(), NTP_SERVER_1, NTP_SERVER_2);
    LOG("DLOG", "Timezone updated: %s", tz.c_str());

    // Re-sync robot clock with new timezone
    if (ntpSynced) {
        syncRobotTime();
    }
}

// -- Blocking compression (boot-time only) -----------------------------------

bool DataLogger::compressFile(const String& srcPath, const String& dstPath) {
    File src = SPIFFS.open(srcPath, FILE_READ);
    if (!src)
        return false;

    File dst = SPIFFS.open(dstPath, FILE_WRITE);
    if (!dst) {
        src.close();
        return false;
    }

    // Static encoder — window=10 (1KB), lookahead=5 (32 bytes), buffer=2KB
    // Total struct size: ~2KB on stack. Safe for ESP32-C3.
    heatshrink_encoder hse;
    heatshrink_encoder_reset(&hse);

    static const size_t IN_BUF_SIZE = 512;
    static const size_t OUT_BUF_SIZE = 512;
    uint8_t inBuf[IN_BUF_SIZE];
    uint8_t outBuf[OUT_BUF_SIZE];

    size_t totalIn = 0;
    size_t totalOut = 0;
    bool ok = true;

    // Feed input through encoder
    while (src.available() > 0) {
        int bytesRead = src.read(inBuf, IN_BUF_SIZE);
        if (bytesRead <= 0)
            break;

        size_t offset = 0;
        while (offset < static_cast<size_t>(bytesRead)) {
            size_t sunk = 0;
            HSE_sink_res sres = heatshrink_encoder_sink(&hse, inBuf + offset, bytesRead - offset, &sunk);
            if (sres < 0) {
                ok = false;
                break;
            }
            offset += sunk;
            totalIn += sunk;

            // Poll for compressed output
            size_t outSz = 0;
            HSE_poll_res pres;
            do {
                pres = heatshrink_encoder_poll(&hse, outBuf, OUT_BUF_SIZE, &outSz);
                if (pres < 0) {
                    ok = false;
                    break;
                }
                if (outSz > 0) {
                    dst.write(outBuf, outSz);
                    totalOut += outSz;
                }
            } while (pres == HSER_POLL_MORE);

            if (!ok)
                break;
        }
        if (!ok)
            break;
    }

    // Finish encoding — flush remaining data
    if (ok) {
        HSE_finish_res fres;
        do {
            fres = heatshrink_encoder_finish(&hse);
            if (fres < 0) {
                ok = false;
                break;
            }
            size_t outSz = 0;
            HSE_poll_res pres;
            do {
                pres = heatshrink_encoder_poll(&hse, outBuf, OUT_BUF_SIZE, &outSz);
                if (pres < 0) {
                    ok = false;
                    break;
                }
                if (outSz > 0) {
                    dst.write(outBuf, outSz);
                    totalOut += outSz;
                }
            } while (pres == HSER_POLL_MORE);
        } while (fres == HSER_FINISH_MORE);
    }

    src.close();
    dst.close();

    if (!ok) {
        LOG("DLOG", "Heatshrink compress failed");
        SPIFFS.remove(dstPath);
        return false;
    }

    LOG("DLOG", "Compressed %u -> %u bytes (%.0f%%)", totalIn, totalOut,
        totalIn > 0 ? (100.0f * static_cast<float>(totalOut) / static_cast<float>(totalIn)) : 0.0f);
    return true;
}

// -- Helpers -----------------------------------------------------------------

String DataLogger::jsonEscape(const String& s) {
    String out;
    out.reserve(s.length() + 16);
    for (unsigned int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        switch (c) {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
                break;
        }
    }
    return out;
}
