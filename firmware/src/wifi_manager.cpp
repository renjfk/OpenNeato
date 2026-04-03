#include "wifi_manager.h"
#include "data_logger.h"
#include <esp_task_wdt.h>
#include <esp_wifi.h>

WiFiManager::WiFiManager(Preferences& prefs, DataLogger& logger) :
    LoopTask(WIFI_RECONNECT_INTERVAL), prefs(prefs), dataLogger(logger), menu("WiFi Configuration Menu"),
    networkMenu("Available WiFi Networks") {}

void WiFiManager::begin() {
    LOG("WIFI", "Starting WiFi setup...");

    // If build-time credentials are provided and no credentials are saved yet,
    // seed them into NVS so the device connects on first boot without serial.
#if defined(PRESET_WIFI_SSID) && defined(PRESET_WIFI_PASS)
    if (!prefs.isKey(NVS_KEY_WIFI_SSID)) {
        LOG("WIFI", "Seeding build-time WiFi credentials into NVS");
        prefs.putString(NVS_KEY_WIFI_SSID, PRESET_WIFI_SSID);
        prefs.putString(NVS_KEY_WIFI_PASS, PRESET_WIFI_PASS);
    }
#endif

    // Try to load and connect with saved credentials
    String ssid, password;
    if (loadCredentials(ssid, password)) {
        LOG("WIFI", "Found saved credentials for: %s", ssid.c_str());
        if (connectToWiFi(ssid, password)) {
            LOG("WIFI", "Connected successfully!");
            LOG("WIFI", "IP: %s", WiFi.localIP().toString().c_str());
            LOG("WIFI", "MAC: %s", WiFi.macAddress().c_str());

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

        // Log boot connection failure
        dataLogger.logWifi("boot_connect_fail",
                           {{"ssid", ssid, FIELD_STRING}, {"status", String(WiFi.status()), FIELD_INT}});
    } else {
        LOG("WIFI", "No saved credentials found");
    }

    // No credentials or connection failed
    LOG("WIFI", "WiFi not configured!");
    inConfigMode = true;
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
    WiFi.mode(WIFI_STA);
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
    while (WiFi.status() != WL_CONNECTED && attempts < 60) {
        esp_task_wdt_reset();
        delay(500);
        attempts++;
    }

    unsigned long connectMs = millis() - connectStart;

    if (WiFi.status() == WL_CONNECTED) {
        LOG("WIFI", "Connected in %lu ms (%d attempts)", connectMs, attempts);
        wasConnected = true;
        reconnectBackoff = WIFI_RECONNECT_INTERVAL;
        reconnectAttemptCount = 0;
    } else {
        LOG("WIFI", "Connect failed after %lu ms (%d attempts), status=%d", connectMs, attempts, WiFi.status());
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

void WiFiManager::tick() {
    // Only attempt auto-reconnect if we were previously connected and are not
    // in config mode (user is actively setting up WiFi through the serial menu)
    if (inConfigMode || !wasConnected || WiFi.status() == WL_CONNECTED)
        return;

    reconnectAttemptCount++;
    LOG("WIFI", "Connection lost — reconnecting (attempt %lu, backoff %lu ms)...", reconnectAttemptCount,
        reconnectBackoff);

    String ssid, password;
    if (!loadCredentials(ssid, password))
        return;

    WiFi.disconnect(true);
    delay(100);
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

bool WiFiManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}
