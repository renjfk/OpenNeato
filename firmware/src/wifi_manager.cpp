#include "wifi_manager.h"

WiFiManager::WiFiManager(Preferences& prefs) :
    prefs(prefs), menu("WiFi Configuration Menu"), networkMenu("Available WiFi Networks") {}

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
            return;
        }
        LOG("WIFI", "Failed to connect with saved credentials");
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
            networkMenu.printError("Connection failed!");
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
                networkMenu.printError("Connection failed!");
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
                menu.printError("Connection failed!");
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
    WiFi.setSleep(false); // Disable modem sleep — keeps radio always on
    WiFi.begin(ssid.c_str(), password.c_str());

    // Wait up to 30 seconds (60 attempts x 500ms)
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 60) {
        delay(500);
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        // Apply TX power after connection — must be called after WiFi.begin()
        WiFi.setTxPower(static_cast<wifi_power_t>(prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER)));
        LOG("WIFI", "TX power set to %.1f dBm", prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER) * 0.25f);
        wasConnected = true;
        reconnectBackoff = WIFI_RECONNECT_INTERVAL;
    }

    return WiFi.status() == WL_CONNECTED;
}

void WiFiManager::setTxPower(int quarterDbm) {
    if (WiFi.status() == WL_CONNECTED) {
        WiFi.setTxPower(static_cast<wifi_power_t>(quarterDbm));
        LOG("WIFI", "TX power updated to %.1f dBm", quarterDbm * 0.25f);
    }
}

void WiFiManager::loop() {
    // Only attempt auto-reconnect if we were previously connected and are not
    // in config mode (user is actively setting up WiFi through the serial menu)
    if (inConfigMode || !wasConnected || WiFi.status() == WL_CONNECTED)
        return;

    unsigned long now = millis();
    if (now - lastReconnectAttempt < reconnectBackoff)
        return;

    lastReconnectAttempt = now;
    LOG("WIFI", "Connection lost — reconnecting (backoff %lu ms)...", reconnectBackoff);

    String ssid, password;
    if (!loadCredentials(ssid, password))
        return;

    WiFi.disconnect(true);
    delay(100);
    WiFi.begin(ssid.c_str(), password.c_str());

    // Brief non-blocking wait (don't block loop for 30s like initial connect)
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 5000) {
        delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
        WiFi.setTxPower(static_cast<wifi_power_t>(prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER)));
        reconnectBackoff = WIFI_RECONNECT_INTERVAL; // Reset backoff on success
        LOG("WIFI", "Reconnected! IP: %s", WiFi.localIP().toString().c_str());
    } else {
        // Exponential backoff: 5s -> 10s -> 20s -> 30s (capped)
        reconnectBackoff = min(reconnectBackoff * 2, static_cast<unsigned long>(WIFI_MAX_RECONNECT_BACKOFF));
        LOG("WIFI", "Reconnect failed, next attempt in %lu ms", reconnectBackoff);
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
