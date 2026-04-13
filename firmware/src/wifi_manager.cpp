#include "wifi_manager.h"
#include "data_logger.h"
#include <esp_task_wdt.h>
#include <esp_wifi.h>

static String loadOptionalString(Preferences& prefs, const char *key, const String& fallback) {
    return prefs.isKey(key) ? prefs.getString(key, fallback) : fallback;
}

WiFiManager::WiFiManager(Preferences& prefs, DataLogger& logger) :
    LoopTask(WIFI_RECONNECT_INTERVAL), prefs(prefs), dataLogger(logger), menu("WiFi Configuration Menu"),
    networkMenu("Available WiFi Networks") {}

void WiFiManager::begin() {
    LOG("WIFI", "Starting WiFi setup...");
    apEnabled = prefs.getBool(NVS_KEY_AP_ENABLED, true);
    apSsid = loadOptionalString(prefs, NVS_KEY_AP_SSID, "");
    apPassword = loadOptionalString(prefs, NVS_KEY_AP_PASS, WIFI_AP_DEFAULT_PASSWORD);

    // Try to load and connect with saved credentials
    String ssid, password;
    if (loadCredentials(ssid, password)) {
        LOG("WIFI", "Found saved credentials for: %s", ssid.c_str());
        if (connectToWiFi(ssid, password, false)) {
            LOG("WIFI", "Connected successfully!");
            LOG("WIFI", "IP: %s", WiFi.localIP().toString().c_str());
            LOG("WIFI", "MAC: %s", WiFi.macAddress().c_str());
            stopFallbackAp();

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

    // No credentials or connection failed — expose fallback AP if allowed.
    reevaluateFallbackAp();
    LOG("WIFI", "%s", apActive ? "Fallback hotspot active" : "WiFi not configured!");
    inConfigMode = true;
}

void WiFiManager::setApConfig(bool enabled, const String& ssid, const String& password) {
    apEnabled = enabled;
    apSsid = ssid;
    apPassword = password;
    // Defer: may be called from inside an HTTP handler that's running over the AP.
    // Tearing down the AP synchronously here causes a load-access fault in the
    // network stack. tick() will pick this up on the next loop() iteration.
    pendingApReevaluate = true;
}

void WiFiManager::setFallbackApRuntimeEnabled(bool enabled) {
    apRuntimeDisabled = !enabled;
    // Defer: same reason as setApConfig — must not tear down AP inside its own
    // request handler. tick() will act on this on the next loop() iteration.
    pendingApReevaluate = true;
}

bool WiFiManager::isFallbackApRuntimeEnabled() const {
    return !apRuntimeDisabled;
}

bool WiFiManager::isApConfiguredEnabled() const {
    return apEnabled;
}

bool WiFiManager::isApActive() const {
    return apActive;
}

String WiFiManager::effectiveApSsid() const {
    return apSsid.isEmpty() ? hostname + WIFI_AP_DEFAULT_SSID_SUFFIX : apSsid;
}

String WiFiManager::getApSsid() const {
    return effectiveApSsid();
}

String WiFiManager::getApIp() const {
    return apActive ? WiFi.softAPIP().toString() : String("");
}

int WiFiManager::getApClientCount() const {
    return apActive ? WiFi.softAPgetStationNum() : 0;
}

bool WiFiManager::isStaConfigured() {
    String ssid;
    String password;
    return loadCredentials(ssid, password);
}

String WiFiManager::getSavedSsid() {
    String ssid;
    String password;
    return loadCredentials(ssid, password) ? ssid : String("");
}

bool WiFiManager::isReconnecting() const {
    return reconnecting;
}

String WiFiManager::getLastStaError() const {
    return lastStaError;
}

bool WiFiManager::shouldAllowFallbackAp() const {
    return apEnabled && !apRuntimeDisabled;
}

String WiFiManager::authModeName(wifi_auth_mode_t mode) {
    switch (mode) {
        case WIFI_AUTH_OPEN:
            return "Open";
        case WIFI_AUTH_WEP:
            return "WEP";
        case WIFI_AUTH_WPA_PSK:
            return "WPA";
        case WIFI_AUTH_WPA2_PSK:
            return "WPA2";
        case WIFI_AUTH_WPA_WPA2_PSK:
            return "WPA/WPA2";
        case WIFI_AUTH_WPA2_ENTERPRISE:
            return "WPA2-E";
        case WIFI_AUTH_WPA3_PSK:
            return "WPA3";
        case WIFI_AUTH_WPA2_WPA3_PSK:
            return "WPA2/WPA3";
        default:
            return "Unknown";
    }
}

bool WiFiManager::startFallbackAp() {
    if (!shouldAllowFallbackAp()) {
        stopFallbackAp();
        return false;
    }
    if (apActive)
        return true;

    bool keepSta = isStaConfigured();
    WiFi.mode(keepSta ? WIFI_AP_STA : WIFI_AP);
    bool ok = apPassword.isEmpty() ? WiFi.softAP(effectiveApSsid().c_str())
                                   : WiFi.softAP(effectiveApSsid().c_str(), apPassword.c_str());
    if (!ok) {
        LOG("WIFI", "Failed to start fallback hotspot");
        return false;
    }

    apActive = true;
    LOG("WIFI", "Fallback hotspot active: %s (%s)", effectiveApSsid().c_str(), WiFi.softAPIP().toString().c_str());
    dataLogger.logWifi("ap_start", {{"ssid", effectiveApSsid(), FIELD_STRING},
                                     {"ip", WiFi.softAPIP().toString(), FIELD_STRING},
                                     {"open", apPassword.isEmpty() ? "true" : "false", FIELD_BOOL}});
    return true;
}

void WiFiManager::stopFallbackAp() {
    if (!apActive)
        return;

    WiFi.softAPdisconnect(true);
    apActive = false;
    if (WiFi.status() == WL_CONNECTED || isStaConfigured()) {
        WiFi.setHostname(hostname.c_str());
        WiFi.mode(WIFI_STA);
    } else {
        WiFi.mode(WIFI_OFF);
    }
    LOG("WIFI", "Fallback hotspot stopped");
    dataLogger.logWifi("ap_stop");
}

void WiFiManager::reevaluateFallbackAp() {
    if (WiFi.status() == WL_CONNECTED || !shouldAllowFallbackAp()) {
        stopFallbackAp();
        return;
    }
    startFallbackAp();
}

void WiFiManager::showMenu() {
    if (!inConfigMode)
        return;

    // Build menu items
    menu.clearItems();
    menu.addItem("Scan WiFi networks", "Scan and select from available networks", [this]() { scanNetworks(); });
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

void WiFiManager::scanNetworks() {
    menu.printStatus("Scanning WiFi networks...");
    scannedNetworks = scanForNetworks();
    scannedNetworkCount = static_cast<int>(scannedNetworks.size());

    if (scannedNetworkCount == 0) {
        menu.printError("No networks found!");
        menu.show();
        return;
    }

    // Build network menu
    networkMenu.clearItems();

    for (int i = 0; i < scannedNetworkCount && i < 20; ++i) {
        const WifiNetworkInfo& network = scannedNetworks[i];
        String label = network.ssid + " (" + String(network.rssi) + " dBm, " + network.auth + ")";

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
    if (index < 0 || index >= scannedNetworkCount || index >= static_cast<int>(scannedNetworks.size())) {
        networkMenu.printError("Invalid selection!");
        menu.show();
        return;
    }

    selectedSSID = scannedNetworks[index].ssid;
    networkMenu.printStatus("Selected: " + selectedSSID);

    // Check if open network
    if (scannedNetworks[index].open) {
        networkMenu.hide();
        networkMenu.printStatus("Open network - connecting...");
        if (connectToNetwork(selectedSSID, "")) {
            networkMenu.printSuccess("Connected successfully!");
        } else {
            networkMenu.printError("Connection failed: " + wifiStatusReason(WiFi.status()));
            menu.show();
        }
    } else {
        // Keep menu active for password input
        networkMenu.promptPassword("Enter password for " + selectedSSID, [this](String password) {
            networkMenu.hide();
            networkMenu.printStatus("Connecting...");
            if (connectToNetwork(selectedSSID, password)) {
                networkMenu.printSuccess("Connected successfully!");
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
            if (connectToNetwork(selectedSSID, password)) {
                menu.printSuccess("Connected successfully!");
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
        menu.printKeyValue("Fallback AP", "standby");
    } else if (apActive) {
        menu.printKeyValue("Fallback AP", "active");
        menu.printKeyValue("AP SSID", effectiveApSsid());
        menu.printKeyValue("AP IP", WiFi.softAPIP().toString());
    }

    String ssid, pass;
    if (loadCredentials(ssid, pass)) {
        menu.printKeyValue("Saved SSID", ssid);
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

bool WiFiManager::connectToWiFi(const String& ssid, const String& password, bool keepApActive) {
    // Clean disconnect before attempting new connection
    WiFi.setHostname(hostname.c_str());
    WiFi.mode(keepApActive ? WIFI_AP_STA : WIFI_STA);
    WiFi.disconnect(false, false);
    delay(100);

    // Enable modem sleep — radio powers down between AP beacons (~100ms),
    // reducing idle current from ~120mA to ~15-20mA. WiFi association stays
    // active; AP buffers frames during sleep. TX power is unaffected.
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);

    applyTxPower(); // Set before WiFi.begin — improves association reliability
    WiFi.begin(ssid.c_str(), password.c_str());

    // Wait up to 30 seconds (60 attempts x 500ms).
    // Feed the task watchdog each iteration so slow associations (mesh APs,
    // weak signal) don't trigger a TWDT reset when called from loop().
    unsigned long connectStart = millis();
    int attempts = 0;
    reconnecting = true;
    while (WiFi.status() != WL_CONNECTED && attempts < 60) {
        esp_task_wdt_reset();
        delay(500);
        attempts++;
    }

    unsigned long connectMs = millis() - connectStart;

    if (WiFi.status() == WL_CONNECTED) {
        LOG("WIFI", "Connected in %lu ms (%d attempts)", connectMs, attempts);
        wasConnected = true;
        reconnecting = false;
        lastStaError = "";
        reconnectBackoff = WIFI_RECONNECT_INTERVAL;
        reconnectAttemptCount = 0;
        stopFallbackAp();
    } else {
        LOG("WIFI", "Connect failed after %lu ms (%d attempts), status=%d", connectMs, attempts, WiFi.status());
        // Enable auto-reconnect even if boot connect timed out (e.g. slow DHCP).
        // WiFi may still be associating in the background — let loop() handle
        // reconnection so the deferred web server start can pick it up.
        wasConnected = true;
        reconnecting = false;
        lastStaError = wifiStatusReason(WiFi.status());
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

void WiFiManager::tick() {
    if (pendingApReevaluate) {
        pendingApReevaluate = false;
        reevaluateFallbackAp();
    }

    if (WiFi.status() == WL_CONNECTED) {
        if (apActive)
            stopFallbackAp();
        reconnecting = false;
        lastStaError = "";
        wasConnected = true;
        return;
    }

    String ssid, password;
    bool hasCredentials = loadCredentials(ssid, password);
    if (!hasCredentials) {
        wasConnected = false;
        reconnecting = false;
        reevaluateFallbackAp();
        return;
    }

    reconnectAttemptCount++;
    reconnecting = true;
    LOG("WIFI", "Connection lost — reconnecting (attempt %lu, backoff %lu ms)...", reconnectAttemptCount,
        reconnectBackoff);

    WiFi.setHostname(hostname.c_str());
    WiFi.mode(apActive ? WIFI_AP_STA : WIFI_STA);
    WiFi.disconnect(false, false);
    delay(100);
    applyTxPower();
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
        LOG("WIFI", "Reconnected! IP: %s, RSSI: %d, attempt: %lu", WiFi.localIP().toString().c_str(), WiFi.RSSI(),
            reconnectAttemptCount);
        reconnecting = false;
        lastStaError = "";
        stopFallbackAp();

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
    } else {
        // Exponential backoff: 5s -> 10s -> 20s -> 30s (capped)
        reconnectBackoff = min(reconnectBackoff * 2, static_cast<unsigned long>(WIFI_MAX_RECONNECT_BACKOFF));
        setInterval(reconnectBackoff);
        LOG("WIFI", "Reconnect failed (status=%d), next attempt in %lu ms", WiFi.status(), reconnectBackoff);
        reconnecting = false;
        lastStaError = wifiStatusReason(WiFi.status());
        reevaluateFallbackAp();

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
    prefs.putString(NVS_KEY_WIFI_SSID, ssid);
    prefs.putString(NVS_KEY_WIFI_PASS, password);
    LOG("WIFI", "Credentials saved");
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

void WiFiManager::clearCredentials() {
    prefs.remove(NVS_KEY_WIFI_SSID);
    prefs.remove(NVS_KEY_WIFI_PASS);
}

std::vector<WifiNetworkInfo> WiFiManager::scanForNetworks() {
    std::vector<WifiNetworkInfo> networks;

    wl_status_t currentStatus = WiFi.status();
    wifi_mode_t mode = currentStatus == WL_CONNECTED ? (apActive ? WIFI_AP_STA : WIFI_STA)
                                                     : (apActive ? WIFI_AP_STA : WIFI_STA);
    WiFi.mode(mode);
    int count = WiFi.scanNetworks();
    for (int i = 0; i < count; ++i) {
        WifiNetworkInfo network;
        network.ssid = WiFi.SSID(i);
        network.rssi = WiFi.RSSI(i);
        network.open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
        network.auth = authModeName(WiFi.encryptionType(i));
        if (!network.ssid.isEmpty())
            networks.push_back(network);
    }
    WiFi.scanDelete();
    return networks;
}

bool WiFiManager::connectToNetwork(const String& ssid, const String& password) {
    bool ok = connectToWiFi(ssid, password, apActive);
    if (ok) {
        saveCredentials(ssid, password);
        inConfigMode = false;
        stopFallbackAp();
    } else {
        reevaluateFallbackAp();
    }
    return ok;
}

void WiFiManager::disconnectFromNetwork(bool clearSavedCredentials) {
    if (clearSavedCredentials)
        clearCredentials();

    WiFi.disconnect(false, false);
    wasConnected = false;
    reconnecting = false;
    if (clearSavedCredentials)
        lastStaError = "network disconnected";
    reevaluateFallbackAp();
}

bool WiFiManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}
