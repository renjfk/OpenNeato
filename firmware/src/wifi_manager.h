#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include <Preferences.h>
#include "config.h"
#include "serial_menu.h"

class WiFiManager {
public:
    explicit WiFiManager(Preferences& prefs);

    void begin();
    void loop();

    void showMenu();

    void handleSerialInput();

    bool isConnected() const;

    // Set hostname for WiFi/mDNS. Must be called before begin() or takes effect on next reboot.
    void setHostname(const String& name) { hostname = name; }

    // Apply TX power setting (0.25 dBm units). Safe to call at any time.
    void setTxPower(int quarterDbm);

private:
    Preferences& prefs;
    String hostname = DEFAULT_HOSTNAME;
    SerialMenu menu;
    SerialMenu networkMenu;
    bool inConfigMode = false;
    bool inNetworkSelection = false;
    String selectedSSID = "";
    int scannedNetworkCount = 0;

    // Auto-reconnect state
    bool wasConnected = false;
    unsigned long lastReconnectAttempt = 0;
    unsigned long reconnectBackoff = WIFI_RECONNECT_INTERVAL;

    bool connectToWiFi(const String& ssid, const String& password);

    void saveCredentials(const String& ssid, const String& password);

    bool loadCredentials(String& ssid, String& password);

    // Menu actions
    void scanNetworks();
    void manualSSID();
    void showStatus();
    void resetCredentials();
    void handleNetworkSelection(int index);
};

#endif // WIFI_MANAGER_H
