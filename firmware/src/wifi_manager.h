#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include <Preferences.h>
#include "config.h"
#include "serial_menu.h"

class WiFiMgr {
public:
    WiFiMgr();

    void begin();

    void showMenu();

    void handleSerialInput();

    bool isConnected();

    void reset();

private:
    Preferences preferences;
    SerialMenu menu;
    SerialMenu networkMenu;
    bool inConfigMode = false;
    bool inNetworkSelection = false;
    String selectedSSID = "";
    int scannedNetworkCount = 0;

    bool connectToWiFi(const String &ssid, const String &password);

    void saveCredentials(const String &ssid, const String &password);

    bool loadCredentials(String &ssid, String &password);

    // Menu actions
    void scanNetworks();

    void manualSSID();

    void showStatus();

    void resetCredentials();

    void handleNetworkSelection(int index);
};

#endif // WIFI_MANAGER_H