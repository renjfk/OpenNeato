#include "wifi_manager.h"
#include "data_logger.h"
#include <ESPmDNS.h>
#include <esp_task_wdt.h>
#include <esp_wifi.h>
#include "ping/ping_sock.h"

// -- Helper structs ----------------------------------------------------------

std::vector<Field> WiFiStatus::toFields() const {
    return {
            {"staConnected", staConnected ? "true" : "false", FIELD_BOOL},
            {"ssid", ssid, FIELD_STRING},
            {"ip", ip, FIELD_STRING},
            {"rssi", String(rssi), FIELD_INT},
            {"apActive", apActive ? "true" : "false", FIELD_BOOL},
            {"apSsid", apSsid, FIELD_STRING},
            {"apIp", apIp, FIELD_STRING},
            {"apClients", String(apClients), FIELD_INT},
            {"apFallbackOnDisconnect", apFallbackOnDisconnect ? "true" : "false", FIELD_BOOL},
            {"staticIpBypassed", staticIpBypassed ? "true" : "false", FIELD_BOOL},
            {"lastError", lastError, FIELD_STRING},
    };
}

std::vector<Field> WiFiNetwork::toFields() const {
    return {
            {"ssid", ssid, FIELD_STRING},
            {"rssi", String(rssi), FIELD_INT},
            {"open", open ? "true" : "false", FIELD_BOOL},
    };
}

String WiFiScanResult::toJson() const {
    String json = "{\"networks\":[";
    for (size_t i = 0; i < networks.size(); i++) {
        if (i > 0)
            json += ",";
        json += networks[i].toJson();
    }
    json += "]}";
    return json;
}

// -- Gateway probe -----------------------------------------------------------

namespace {
    // Written by the esp_ping task, read by the caller waiting in probeGateway().
    struct PingResult {
        volatile bool replied = false;
        volatile bool finished = false;
    };

    // File scope so a late callback from the ping task can never reference dead
    // stack memory. WiFiManager is a singleton, so one instance is enough.
    PingResult pingResult;
} // namespace

static void onPingSuccess(esp_ping_handle_t /*handle*/, void *args) {
    static_cast<PingResult *>(args)->replied = true;
}

static void onPingEnd(esp_ping_handle_t /*handle*/, void *args) {
    static_cast<PingResult *>(args)->finished = true;
}

// -- WiFiManager -------------------------------------------------------------

WiFiManager::WiFiManager(Preferences& prefs, DataLogger& logger) :
    LoopTask(WIFI_RECONNECT_INTERVAL), prefs(prefs), dataLogger(logger), menu("WiFi Configuration Menu"),
    networkMenu("Available WiFi Networks") {}

void WiFiManager::begin() {
    LOG("WIFI", "Starting WiFi setup...");

    // Try to load and connect with saved credentials
    String ssid, password;
    if (loadCredentials(ssid, password)) {
        LOG("WIFI", "Found saved credentials for: %s", ssid.c_str());
        if (connectToWiFi(ssid, password)) {
            LOG("WIFI", "Connected successfully!");
            LOG("WIFI", "IP: %s", WiFi.localIP().toString().c_str());
            LOG("WIFI", "MAC: %s", WiFi.macAddress().c_str());
            startMdns();

            // Log successful boot connection with diagnostics
            dataLogger.logWifi("boot_connect", {{"ssid", ssid, FIELD_STRING},
                                                {"ip", WiFi.localIP().toString(), FIELD_STRING},
                                                {"rssi", String(WiFi.RSSI()), FIELD_INT},
                                                {"channel", String(WiFi.channel()), FIELD_INT},
                                                {"bssid", WiFi.BSSIDstr(), FIELD_STRING},
                                                {"txPower", String(WiFi.getTxPower()), FIELD_INT}});
            return;
        }
        LOG("WIFI", "Failed to connect with saved credentials");
        lastStaError = wifiStatusReason(WiFi.status());

        // Log boot connection failure
        dataLogger.logWifi("boot_connect_fail",
                           {{"ssid", ssid, FIELD_STRING}, {"status", String(WiFi.status()), FIELD_INT}});
    } else {
        LOG("WIFI", "No saved credentials found");
    }

    // No credentials or connection failed
    LOG("WIFI", "WiFi not configured!");
    inConfigMode = true;

    // Bring up the fallback AP so users can provision via browser
    reevaluateFallbackAp();
}

void WiFiManager::showMenu() {
    if (!inConfigMode)
        return;

    // Build menu items
    menu.clearItems();
    menu.addItem("Scan WiFi networks", "Scan and select from available networks", [this]() { scanNetworksMenu(); });
    menu.addItem("Enter SSID manually", "Type network name manually", [this]() { manualSSID(); });
    menu.addItem("Show current status", "Display WiFi connection status", [this]() { showStatus(); });
    menu.addItem("Reset all settings", "Erase all saved settings and restart", [this]() { resetCredentials(); });

    menu.show();
}

void WiFiManager::handleSerialInput() {
    if (!Serial.available()) {
        return;
    }

    // If network selection menu is active, let it handle input
    if (networkMenu.isActive()) {
        networkMenu.handleInput();
        return;
    }

    // If main menu is active, let it handle input
    if (menu.isActive()) {
        menu.handleInput();
        return;
    }

    // Quick commands when not in config mode
    if (!inConfigMode) {
        char c = Serial.read();

        if (c == 'm' || c == 'M') {
            menu.printStatus("");
            inConfigMode = true;
            showMenu();
        } else if (c == 's' || c == 'S') {
            menu.printSection("WiFi Status");
            menu.printKeyValue("Connected", isConnected() ? "Yes" : "No");
            if (isConnected()) {
                menu.printKeyValue("SSID", WiFi.SSID());
                menu.printKeyValue("IP", WiFi.localIP().toString());
                menu.printKeyValue("MAC", WiFi.macAddress());
                menu.printKeyValue("RSSI", String(WiFi.RSSI()) + " dBm");
            }
            String ssid, pass;
            if (loadCredentials(ssid, pass)) {
                menu.printKeyValue("Saved SSID", ssid);
            }
            if (apActive) {
                menu.printKeyValue("Fallback AP", apSsidName());
                menu.printKeyValue("AP IP", WiFi.softAPIP().toString());
            }
            menu.printSeparator();
            menu.printStatus("Quick commands: [m]enu, [s]tatus");
        } else if (c != '\n' && c != '\r') {
            menu.printSection("Quick Commands");
            menu.printKeyValue("[m]", "Configuration menu");
            menu.printKeyValue("[s]", "WiFi status");
            menu.printSeparator();
            menu.printStatus("");
        }
    }
}

void WiFiManager::scanNetworksMenu() {
    menu.printStatus("Scanning WiFi networks...");
    scannedNetworkCount = WiFi.scanNetworks();

    if (scannedNetworkCount == 0) {
        menu.printError("No networks found!");
        menu.show();
        return;
    }

    // Build network menu
    networkMenu.clearItems();

    for (int i = 0; i < scannedNetworkCount && i < 20; ++i) {
        String encryption = "";
        switch (WiFi.encryptionType(i)) {
            case WIFI_AUTH_OPEN:
                encryption = "Open";
                break;
            case WIFI_AUTH_WEP:
                encryption = "WEP";
                break;
            case WIFI_AUTH_WPA_PSK:
                encryption = "WPA";
                break;
            case WIFI_AUTH_WPA2_PSK:
                encryption = "WPA2";
                break;
            case WIFI_AUTH_WPA_WPA2_PSK:
                encryption = "WPA/WPA2";
                break;
            case WIFI_AUTH_WPA2_ENTERPRISE:
                encryption = "WPA2-E";
                break;
            default:
                encryption = "Unknown";
                break;
        }

        // Format: "SSID (signal, encryption)"
        String ssid = WiFi.SSID(i);
        int rssi = WiFi.RSSI(i);

        String label = ssid + " (" + String(rssi) + " dBm, " + encryption + ")";

        // Capture index for lambda
        int index = i;
        networkMenu.addItem(label, "", [this, index]() { handleNetworkSelection(index); });
    }

    // Add "Back" option
    networkMenu.addItem("Back to main menu", "", [this]() {
        networkMenu.hide();
        menu.show();
    });

    networkMenu.show();
}

void WiFiManager::handleNetworkSelection(int index) {
    if (index < 0 || index >= scannedNetworkCount) {
        networkMenu.printError("Invalid selection!");
        menu.show();
        return;
    }

    selectedSSID = WiFi.SSID(index);
    networkMenu.printStatus("Selected: " + selectedSSID);

    // Check if open network
    if (WiFi.encryptionType(index) == WIFI_AUTH_OPEN) {
        networkMenu.hide();
        networkMenu.printStatus("Open network - connecting...");
        if (connectToWiFi(selectedSSID, "")) {
            saveCredentials(selectedSSID, "");
            networkMenu.printSuccess("Connected successfully!");
            networkMenu.printStatus("Restarting...");
            delay(2000);
            ESP.restart();
        } else {
            networkMenu.printError("Connection failed: " + wifiStatusReason(WiFi.status()));
            menu.show();
        }
    } else {
        // Keep menu active for password input
        networkMenu.promptPassword("Enter password for " + selectedSSID, [this](String password) {
            networkMenu.hide();
            networkMenu.printStatus("Connecting...");
            if (connectToWiFi(selectedSSID, password)) {
                saveCredentials(selectedSSID, password);
                networkMenu.printSuccess("Connected successfully!");
                networkMenu.printStatus("Restarting...");
                delay(2000);
                ESP.restart();
            } else {
                networkMenu.printError("Connection failed: " + wifiStatusReason(WiFi.status()));
                menu.show();
            }
        });
    }
}

void WiFiManager::manualSSID() {
    menu.promptText("Enter SSID", [this](String ssid) {
        selectedSSID = ssid;
        menu.printStatus("SSID: " + selectedSSID);

        menu.promptPassword("Enter password (leave empty for open network)", [this](String password) {
            menu.printStatus("Connecting...");
            if (connectToWiFi(selectedSSID, password)) {
                saveCredentials(selectedSSID, password);
                menu.printSuccess("Connected successfully!");
                menu.printStatus("Restarting...");
                delay(2000);
                ESP.restart();
            } else {
                menu.printError("Connection failed: " + wifiStatusReason(WiFi.status()));
                menu.show();
            }
        });
    });
}

void WiFiManager::showStatus() {
    menu.printSection("WiFi Status");

    menu.printKeyValue("Connected", isConnected() ? "Yes" : "No");

    if (isConnected()) {
        menu.printKeyValue("SSID", WiFi.SSID());
        menu.printKeyValue("IP", WiFi.localIP().toString());
        menu.printKeyValue("MAC", WiFi.macAddress());
        menu.printKeyValue("Signal", String(WiFi.RSSI()) + " dBm");
    }

    String ssid, pass;
    if (loadCredentials(ssid, pass)) {
        menu.printKeyValue("Saved SSID", ssid);
    }

    if (apActive) {
        menu.printKeyValue("Fallback AP", apSsidName());
        menu.printKeyValue("AP IP", WiFi.softAPIP().toString());
        menu.printKeyValue("AP clients", String(WiFi.softAPgetStationNum()));
    }

    menu.printSeparator();
    menu.printStatus(""); // Print newline

    menu.show();
}

void WiFiManager::resetCredentials() {
    menu.promptConfirmation("Reset all settings", [this](bool confirmed) {
        if (confirmed) {
            menu.printStatus("Resetting all settings...");
            prefs.clear();
            WiFi.disconnect(true, true);
            delay(1000);
            ESP.restart();
        } else {
            menu.printStatus("Reset cancelled");
            menu.show();
        }
    });
}

bool WiFiManager::connectToWiFi(const String& ssid, const String& password) {
    // Clean disconnect before attempting new connection
    WiFi.disconnect(true);
    delay(100);

    WiFi.setHostname(hostname.c_str());
    // Use AP+STA mode if the fallback AP is currently active so we keep
    // serving the provisioning page during the connection attempt.
    WiFi.mode(apActive ? WIFI_AP_STA : WIFI_STA);
    // Enable modem sleep — radio powers down between AP beacons (~100ms),
    // reducing idle current from ~120mA to ~15-20mA. WiFi association stays
    // active; AP buffers frames during sleep. TX power is unaffected.
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);

    applyTxPower(); // Set before WiFi.begin — improves association reliability
    bool staticIpInUse = applyStaticIp(); // Must run before WiFi.begin so no DHCP request is sent
    WiFi.begin(ssid.c_str(), password.c_str());

    // Wait up to 30 seconds (60 attempts x 500ms).
    // Feed the task watchdog each iteration so slow associations (mesh APs,
    // weak signal) don't trigger a TWDT reset when called from loop().
    unsigned long connectStart = millis();
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 60) {
        esp_task_wdt_reset();
        delay(500);
        attempts++;
    }

    unsigned long connectMs = millis() - connectStart;

    if (WiFi.status() == WL_CONNECTED) {
        // Associating is not enough with a static IP: a wrong address or
        // subnet leaves the device connected but unreachable. Probe the
        // gateway and fall back to DHCP for this boot when it does not answer.
        if (staticIpInUse) {
            bool gatewayOk = probeGateway();
            if (!gatewayOk) {
                // A router that is still booting or briefly busy should not
                // drop the configuration, so retry once before falling back.
                LOG("WIFI", "Gateway %s did not answer, retrying probe", staticGateway.c_str());
                esp_task_wdt_reset();
                delay(GATEWAY_PROBE_RETRY_DELAY_MS);
                gatewayOk = probeGateway();
            }
            if (!gatewayOk) {
                LOG("WIFI", "Gateway %s unreachable, falling back to DHCP for this boot", staticGateway.c_str());
                dataLogger.logWifi("static_ip_fallback",
                                   {{"ip", staticIp, FIELD_STRING}, {"gateway", staticGateway, FIELD_STRING}});
                staticIpBypassed = true;
                return connectToWiFi(ssid, password); // staticIpBypassed prevents a second probe
            }
        }

        LOG("WIFI", "Connected in %lu ms (%d attempts)", connectMs, attempts);
        wasConnected = true;
        reconnectBackoff = WIFI_RECONNECT_INTERVAL;
        reconnectAttemptCount = 0;
        lastStaError = "";
    } else {
        LOG("WIFI", "Connect failed after %lu ms (%d attempts), status=%d", connectMs, attempts, WiFi.status());
        lastStaError = wifiStatusReason(WiFi.status());
        // Enable auto-reconnect even if boot connect timed out (e.g. slow DHCP).
        // WiFi may still be associating in the background — let loop() handle
        // reconnection so the deferred web server start can pick it up.
        wasConnected = true;
    }

    return WiFi.status() == WL_CONNECTED;
}

void WiFiManager::applyTxPower() {
    int val = prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER);
    WiFi.setTxPower(static_cast<wifi_power_t>(val));
    LOG("WIFI", "TX power set to %.1f dBm", val * 0.25f);
}

void WiFiManager::setTxPower(int quarterDbm) {
    WiFi.setTxPower(static_cast<wifi_power_t>(quarterDbm));
    LOG("WIFI", "TX power updated to %.1f dBm", quarterDbm * 0.25f);
}

void WiFiManager::setApFallbackOnDisconnect(bool enabled) {
    apFallbackOnDisconnect = enabled;
    reevaluateFallbackAp();
}

void WiFiManager::setStaticIp(bool enabled, const String& ip, const String& gateway, const String& subnet,
                              const String& dns) {
    staticIpEnabled = enabled;
    staticIp = ip;
    staticGateway = gateway;
    staticSubnet = subnet;
    staticDns = dns;
}

bool WiFiManager::applyStaticIp(bool logSuccess) {
    if (!staticIpEnabled || staticIpBypassed) {
        // A static config applied earlier in this boot must be cleared through
        // WiFi.config(), otherwise the core keeps using it and skips DHCP.
        if (staticIpApplied)
            resetToDhcp();
        return false;
    }

    IPAddress ip, gateway, subnet;
    if (!ip.fromString(staticIp) || !gateway.fromString(staticGateway) || !subnet.fromString(staticSubnet)) {
        LOG("WIFI", "Static IP config invalid, using DHCP");
        dataLogger.logWifi("static_ip_invalid", {{"ip", staticIp, FIELD_STRING},
                                                 {"gateway", staticGateway, FIELD_STRING},
                                                 {"subnet", staticSubnet, FIELD_STRING}});
        return false;
    }

    IPAddress dns;
    if (staticDns.isEmpty() || !dns.fromString(staticDns))
        dns = gateway; // No usable DNS server configured, use the gateway
    bool ok = WiFi.config(ip, gateway, subnet, dns);

    if (!ok) {
        LOG("WIFI", "Static IP %s could not be applied", ip.toString().c_str());
        dataLogger.logWifi("static_ip_fail", {{"ip", ip.toString(), FIELD_STRING}});
        return false;
    }

    if (logSuccess) {
        LOG("WIFI", "Static IP %s, gateway %s, subnet %s, DNS %s", ip.toString().c_str(), gateway.toString().c_str(),
            subnet.toString().c_str(), dns.toString().c_str());
        dataLogger.logWifi("static_ip", {{"ip", ip.toString(), FIELD_STRING},
                                         {"gateway", gateway.toString(), FIELD_STRING},
                                         {"subnet", subnet.toString(), FIELD_STRING},
                                         {"dns", dns.toString(), FIELD_STRING}});
    }

    staticIpApplied = true;
    return true;
}

void WiFiManager::resetToDhcp() {
    IPAddress any(0, 0, 0, 0);
    // The core interprets a zero address in WiFi.config() as "start DHCP".
    bool ok = WiFi.config(any, any, any);
    staticIpApplied = false;
    LOG("WIFI", "Static IP cleared, DHCP enabled: %s", ok ? "ok" : "failed");
    dataLogger.logWifi("static_ip_cleared", {{"ok", ok ? "true" : "false", FIELD_BOOL}});
}

bool WiFiManager::probeGateway() {
    IPAddress gateway;
    if (!gateway.fromString(staticGateway))
        return true; // Nothing to probe, keep the static configuration

    esp_ping_config_t config = ESP_PING_DEFAULT_CONFIG();
    config.count = 2;
    config.interval_ms = 200;
    config.timeout_ms = 1000;
    config.target_addr.type = IPADDR_TYPE_V4;
    config.target_addr.u_addr.ip4.addr = static_cast<uint32_t>(gateway);

    pingResult.replied = false;
    pingResult.finished = false;
    esp_ping_callbacks_t callbacks = {};
    callbacks.cb_args = &pingResult;
    callbacks.on_ping_success = onPingSuccess;
    callbacks.on_ping_end = onPingEnd;

    esp_ping_handle_t handle = nullptr;
    esp_err_t err = esp_ping_new_session(&config, &callbacks, &handle);
    if (err != ESP_OK) {
        LOG("WIFI", "Gateway probe unavailable (err=%d), keeping static IP", err);
        return true;
    }

    if (esp_ping_start(handle) != ESP_OK) {
        LOG("WIFI", "Gateway probe could not start, keeping static IP");
        esp_ping_delete_session(handle);
        return true;
    }

    unsigned long start = millis();
    while (!pingResult.finished && millis() - start < GATEWAY_PROBE_TIMEOUT_MS) {
        esp_task_wdt_reset();
        delay(50);
    }

    esp_ping_stop(handle);
    // esp_ping_stop() does not wait for the ping task; give it a moment so the
    // session is not deleted while the task may still be running.
    start = millis();
    while (!pingResult.finished && millis() - start < 1000) {
        esp_task_wdt_reset();
        delay(10);
    }
    esp_ping_delete_session(handle);

    LOG("WIFI", "Gateway %s probe: %s", staticGateway.c_str(), pingResult.replied ? "reachable" : "no reply");
    return pingResult.replied;
}

void WiFiManager::tick() {
    // Re-evaluate the AP regardless of STA state , this also handles the
    // recovery case where credentials are wiped via the API.
    reevaluateFallbackAp();

    // Only attempt auto-reconnect if we were previously connected and are not
    // in config mode (user is actively setting up WiFi through the serial menu)
    if (inConfigMode || !wasConnected || WiFi.status() == WL_CONNECTED)
        return;

    if (apActive && WiFi.softAPgetStationNum() > 0) {
        LOG("WIFI", "Reconnect paused while fallback AP has clients");
        return;
    }

    reconnectAttemptCount++;
    LOG("WIFI", "Connection lost — reconnecting (attempt %lu, backoff %lu ms)...", reconnectAttemptCount,
        reconnectBackoff);

    String ssid, password;
    if (!loadCredentials(ssid, password))
        return;

    WiFi.disconnect(true);
    delay(100);
    applyStaticIp(/*logSuccess=*/false);
    WiFi.begin(ssid.c_str(), password.c_str());

    // Brief wait — shorter than initial connect but still blocks loop().
    // Feed the watchdog each iteration to stay within the TWDT window.
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 5000) {
        esp_task_wdt_reset();
        delay(100);
    }

    unsigned long reconnectMs = millis() - start;

    if (WiFi.status() == WL_CONNECTED) {
        applyTxPower();
        startMdns();
        LOG("WIFI", "Reconnected! IP: %s, RSSI: %d, attempt: %lu", WiFi.localIP().toString().c_str(), WiFi.RSSI(),
            reconnectAttemptCount);

        dataLogger.logWifi("reconnect_ok", {{"ssid", ssid, FIELD_STRING},
                                            {"ip", WiFi.localIP().toString(), FIELD_STRING},
                                            {"rssi", String(WiFi.RSSI()), FIELD_INT},
                                            {"channel", String(WiFi.channel()), FIELD_INT},
                                            {"bssid", WiFi.BSSIDstr(), FIELD_STRING},
                                            {"attempt", String(reconnectAttemptCount), FIELD_INT},
                                            {"ms", String(reconnectMs), FIELD_INT}});
        reconnectBackoff = WIFI_RECONNECT_INTERVAL; // Reset backoff on success
        setInterval(reconnectBackoff);
        reconnectAttemptCount = 0;
        lastStaError = "";
    } else {
        // Exponential backoff: 5s -> 10s -> 20s -> 30s (capped)
        reconnectBackoff = min(reconnectBackoff * 2, static_cast<unsigned long>(WIFI_MAX_RECONNECT_BACKOFF));
        setInterval(reconnectBackoff);
        LOG("WIFI", "Reconnect failed (status=%d), next attempt in %lu ms", WiFi.status(), reconnectBackoff);
        lastStaError = wifiStatusReason(WiFi.status());

        dataLogger.logWifi("reconnect_fail", {{"ssid", ssid, FIELD_STRING},
                                              {"status", String(WiFi.status()), FIELD_INT},
                                              {"attempt", String(reconnectAttemptCount), FIELD_INT},
                                              {"backoff", String(reconnectBackoff), FIELD_INT},
                                              {"ms", String(reconnectMs), FIELD_INT}});
    }
}

String WiFiManager::wifiStatusReason(wl_status_t status) {
    switch (status) {
        case WL_NO_SSID_AVAIL:
            return "network not found";
        case WL_CONNECT_FAILED:
            return "wrong password or authentication rejected";
        case WL_CONNECTION_LOST:
            return "connection lost during setup";
        case WL_DISCONNECTED:
            return "timed out (no response from network)";
        case WL_IDLE_STATUS:
            return "timed out (WiFi idle)";
        default:
            return "unknown error (status=" + String((int) status) + ")";
    }
}

void WiFiManager::saveCredentials(const String& ssid, const String& password) {
    String previousSsid;
    String previousPassword;
    bool hadCredentials = loadCredentials(previousSsid, previousPassword);

    prefs.putString(NVS_KEY_WIFI_SSID, ssid);
    prefs.putString(NVS_KEY_WIFI_PASS, password);
    LOG("WIFI", "Credentials saved");

    // A static IP belongs to the network it was set up for. When the saved
    // network changes, drop back to DHCP so the device stays reachable on the
    // new network (and on the next boot).
    if (staticIpEnabled && (!hadCredentials || previousSsid != ssid)) {
        staticIpEnabled = false;
        LOG("WIFI", "Saved network changed (%s -> %s), static IP disabled",
            hadCredentials ? previousSsid.c_str() : "(none)", ssid.c_str());
        dataLogger.logWifi("static_ip_disabled",
                           {{"previousSsid", previousSsid, FIELD_STRING}, {"ssid", ssid, FIELD_STRING}});
        if (networkChangeCb)
            networkChangeCb();
    }
}

bool WiFiManager::loadCredentials(String& ssid, String& password) {
    if (!prefs.isKey(NVS_KEY_WIFI_SSID)) {
        ssid = "";
        password = "";
        return false;
    }

    ssid = prefs.getString(NVS_KEY_WIFI_SSID, "");
    password = prefs.getString(NVS_KEY_WIFI_PASS, "");
    return ssid.length() > 0;
}

bool WiFiManager::hasSavedCredentials() {
    String ssid, password;
    return loadCredentials(ssid, password);
}

bool WiFiManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

// -- Fallback AP -------------------------------------------------------------

String WiFiManager::apSsidName() const {
    return hostname + AP_SSID_SUFFIX;
}

void WiFiManager::startAccessPoint() {
    if (apActive)
        return;

    String ssid = apSsidName();
    LOG("WIFI", "Starting fallback AP: %s", ssid.c_str());

    // Combined AP+STA so the device can keep trying STA reconnects while the
    // AP is up. Pure-AP mode would block reconnect attempts entirely.
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAPConfig(AP_DEFAULT_IP, AP_GATEWAY, AP_SUBNET);
    bool ok = WiFi.softAP(ssid.c_str(), nullptr, AP_CHANNEL, /*ssid_hidden=*/0, AP_MAX_CONNECTIONS);
    if (!ok) {
        LOG("WIFI", "softAP() failed");
        dataLogger.logWifi("ap_start_fail", {{"ssid", ssid, FIELD_STRING}});
        return;
    }

    apActive = true;
    LOG("WIFI", "AP active: SSID=%s IP=%s", ssid.c_str(), WiFi.softAPIP().toString().c_str());
    dataLogger.logWifi("ap_start", {{"ssid", ssid, FIELD_STRING}, {"ip", WiFi.softAPIP().toString(), FIELD_STRING}});
    startMdns();
}

void WiFiManager::stopAccessPoint() {
    if (!apActive)
        return;

    LOG("WIFI", "Stopping fallback AP");
    WiFi.softAPdisconnect(true);
    // If STA is still wanted, keep STA mode active; otherwise drop to STA-only
    // so the radio doesn't sit in AP+STA with no AP.
    WiFi.mode(WIFI_STA);
    apActive = false;
    dataLogger.logWifi("ap_stop");
}

void WiFiManager::startMdns() {
    if (hostname.isEmpty()) {
        LOG("WIFI", "mDNS init skipped: empty hostname");
        return;
    }

    // Restart mDNS so service registration stays consistent when the active
    // interface changes (STA<->AP) and this method is called repeatedly.
    MDNS.end();

    if (!MDNS.begin(hostname.c_str())) {
        LOG("WIFI", "mDNS init failed for hostname: %s", hostname.c_str());
        return;
    }

    if (!MDNS.addService("http", "tcp", 80)) {
        LOG("WIFI", "mDNS HTTP service registration failed");
        return;
    }

    LOG("WIFI", "mDNS responder up: %s.local", hostname.c_str());
}

void WiFiManager::reevaluateFallbackAp() {
    // Three policies, derived from the issue scope:
    //   1. No saved credentials -> AP always on (only way to provision).
    //   2. STA connected -> AP off.
    //   3. Saved credentials but STA disconnected -> AP on iff
    //      apFallbackOnDisconnect is true.
    bool credsSaved = hasSavedCredentials();
    bool staConnected = WiFi.status() == WL_CONNECTED;

    bool wantAp;
    if (!credsSaved) {
        wantAp = true;
    } else if (staConnected) {
        wantAp = false;
    } else {
        wantAp = apFallbackOnDisconnect;
    }

    if (wantAp && !apActive) {
        startAccessPoint();
    } else if (!wantAp && apActive) {
        stopAccessPoint();
    }
}

// -- API surface -------------------------------------------------------------

void WiFiManager::getStatus(std::function<void(bool, const WiFiStatus&)> cb) {
    WiFiStatus s;
    s.staConnected = isConnected();
    if (s.staConnected) {
        s.ssid = WiFi.SSID();
        s.ip = WiFi.localIP().toString();
        s.rssi = WiFi.RSSI();
    } else {
        // Fall back to saved SSID so the UI can show "trying to reconnect to X"
        String savedPass;
        loadCredentials(s.ssid, savedPass);
    }
    s.apActive = apActive;
    if (apActive) {
        s.apSsid = apSsidName();
        s.apIp = WiFi.softAPIP().toString();
        s.apClients = WiFi.softAPgetStationNum();
    }
    s.apFallbackOnDisconnect = apFallbackOnDisconnect;
    s.staticIpBypassed = staticIpBypassed;
    s.lastError = lastStaError;
    cb(true, s);
}

void WiFiManager::scanNetworks(std::function<void(bool, const WiFiScanResult&)> cb) {
    WiFiScanResult result;

    // Use synchronous scan with watchdog feeding so a slow scan doesn't
    // trigger a TWDT reset. Returns the network count or a negative error.
    int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/false);
    esp_task_wdt_reset();

    if (n < 0) {
        LOG("WIFI", "Scan failed: %d", n);
        cb(false, result);
        return;
    }

    // Cap at 30 entries , anything more than that on an ESP32-C3 is noise
    // and would just bloat the JSON response.
    int max = n < 30 ? n : 30;
    result.networks.reserve(max);
    for (int i = 0; i < max; ++i) {
        WiFiNetwork net;
        net.ssid = WiFi.SSID(i);
        net.rssi = WiFi.RSSI(i);
        net.open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
        result.networks.push_back(net);
    }
    WiFi.scanDelete();

    cb(true, result);
}

bool WiFiManager::connect(const String& ssid, const String& password, std::function<void(bool)> cb) {
    if (ssid.isEmpty()) {
        cb(false);
        return true; // Handler ran (returned an error) , don't return 503
    }

    LOG("WIFI", "API connect request: %s", ssid.c_str());
    dataLogger.logWifi("api_connect", {{"ssid", ssid, FIELD_STRING}});

    // Save first so a successful connection leads to a normal reboot path
    // and a failure can be inspected via the AP afterwards.
    saveCredentials(ssid, password);

    bool ok = connectToWiFi(ssid, password);
    if (ok) {
        // Schedule a reboot so the regular boot flow brings up the web server,
        // mDNS, etc. with the freshly connected STA. Give the response time
        // to flush first.
        cb(true);
        delay(500);
        ESP.restart();
        return true;
    }

    // Connection failed , keep AP up so the user can try again.
    reevaluateFallbackAp();
    cb(false);
    return true;
}

bool WiFiManager::disconnect(std::function<void(bool)> cb) {
    LOG("WIFI", "API disconnect request");
    dataLogger.logWifi("api_disconnect");

    prefs.remove(NVS_KEY_WIFI_SSID);
    prefs.remove(NVS_KEY_WIFI_PASS);
    WiFi.disconnect(true, true);
    wasConnected = false;
    lastStaError = "";

    // No credentials -> AP must be up regardless of policy
    reevaluateFallbackAp();

    cb(true);
    return true;
}
