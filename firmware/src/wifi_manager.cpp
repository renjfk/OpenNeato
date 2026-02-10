#include "wifi_manager.h"

WiFiMgr::WiFiMgr() : menu("WiFi Configuration Menu"), networkMenu("Available WiFi Networks") {
}

void WiFiMgr::begin() {
    LOG("WIFI", "Starting WiFi setup...");

    // Initialize preferences
    preferences.begin("wifi", false);

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

void WiFiMgr::showMenu() {
    if (!inConfigMode) return;

    // Build menu items
    menu.clearItems();
    menu.addItem("Scan WiFi networks", "Scan and select from available networks", [this]() {
        scanNetworks();
    });
    menu.addItem("Enter SSID manually", "Type network name manually", [this]() {
        manualSSID();
    });
    menu.addItem("Show current status", "Display WiFi connection status", [this]() {
        showStatus();
    });
    menu.addItem("Reset credentials", "Erase saved WiFi credentials", [this]() {
        resetCredentials();
    });

    menu.show();
}

void WiFiMgr::handleSerialInput() {
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
            menu.printStatus(""); // Print newline
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
            menu.printStatus(""); // Print newline
        }
    }
}

void WiFiMgr::scanNetworks() {
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
            case WIFI_AUTH_OPEN: encryption = "Open";
                break;
            case WIFI_AUTH_WEP: encryption = "WEP";
                break;
            case WIFI_AUTH_WPA_PSK: encryption = "WPA";
                break;
            case WIFI_AUTH_WPA2_PSK: encryption = "WPA2";
                break;
            case WIFI_AUTH_WPA_WPA2_PSK: encryption = "WPA/WPA2";
                break;
            case WIFI_AUTH_WPA2_ENTERPRISE: encryption = "WPA2-E";
                break;
            default: encryption = "Unknown";
                break;
        }

        // Format: "SSID (signal, encryption)"
        String ssid = WiFi.SSID(i);
        int rssi = WiFi.RSSI(i);

        String label = ssid + " (" + String(rssi) + " dBm, " + encryption + ")";

        // Capture index for lambda
        int index = i;
        networkMenu.addItem(label, "", [this, index]() {
            handleNetworkSelection(index);
        });
    }

    // Add "Back" option
    networkMenu.addItem("Back to main menu", "", [this]() {
        networkMenu.hide();
        menu.show();
    });

    networkMenu.show();
}

void WiFiMgr::handleNetworkSelection(int index) {
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

void WiFiMgr::manualSSID() {
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

void WiFiMgr::showStatus() {
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

void WiFiMgr::resetCredentials() {
    menu.promptConfirmation("Reset WiFi credentials", [this](bool confirmed) {
        if (confirmed) {
            menu.printStatus("Resetting credentials...");
            reset();
        } else {
            menu.printStatus("Reset cancelled");
            menu.show();
        }
    });
}

bool WiFiMgr::connectToWiFi(const String &ssid, const String &password) {
    // Clean disconnect before attempting new connection
    WiFi.disconnect(true);
    delay(100);

    WiFi.setHostname(HOSTNAME);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false); // Disable modem sleep — keeps radio always on
    WiFi.begin(ssid.c_str(), password.c_str());

    // Wait up to 30 seconds (60 attempts x 500ms)
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 60) {
        delay(500);
        attempts++;
    }

    return WiFi.status() == WL_CONNECTED;
}

void WiFiMgr::saveCredentials(const String &ssid, const String &password) {
    preferences.putString("ssid", ssid);
    preferences.putString("password", password);
    LOG("WIFI", "Credentials saved");
}

bool WiFiMgr::loadCredentials(String &ssid, String &password) {
    // Check if credentials exist before trying to load them
    if (!preferences.isKey("ssid")) {
        ssid = "";
        password = "";
        return false;
    }

    ssid = preferences.getString("ssid", "");
    password = preferences.getString("password", "");
    return ssid.length() > 0;
}

bool WiFiMgr::isConnected() {
    return WiFi.status() == WL_CONNECTED;
}

void WiFiMgr::reset() {
    LOG("WIFI", "Resetting WiFi credentials...");
    preferences.clear();
    WiFi.disconnect(true, true);
    delay(1000);
    ESP.restart();
}
