#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include <Preferences.h>
#include "config.h"
#include "loop_task.h"
#include "serial_menu.h"

class DataLogger;

class WiFiManager : public LoopTask {
public:
    WiFiManager(Preferences& prefs, DataLogger& logger);

    void begin();

    void showMenu();

    void handleSerialInput();

    bool isConnected() const;

    // Set hostname for WiFi/mDNS. Must be called before begin() or takes effect on next reboot.
    void setHostname(const String& name) { hostname = name; }

    // Apply TX power setting (0.25 dBm units). Safe to call at any time.
    void setTxPower(int quarterDbm);

private:
    Preferences& prefs;
    DataLogger& dataLogger;
    String hostname = DEFAULT_HOSTNAME;
    SerialMenu menu;
    SerialMenu networkMenu;
    bool inConfigMode = false;
    bool inNetworkSelection = false;
    String selectedSSID = "";
    int scannedNetworkCount = 0;

    void tick() override; // Called by LoopTask::loop() at WIFI_RECONNECT_INTERVAL cadence

    // Apply TX power from NVS (called after WiFi.begin and after reconnect)
    void applyTxPower();

    // Auto-reconnect state
    bool wasConnected = false;
    unsigned long reconnectBackoff = WIFI_RECONNECT_INTERVAL;
    unsigned long reconnectAttemptCount = 0;

    bool connectToWiFi(const String& ssid, const String& password);

    void saveCredentials(const String& ssid, const String& password);

    bool loadCredentials(String& ssid, String& password);

    // Menu actions
    void scanNetworks();
    void manualSSID();
    void showStatus();
    void resetCredentials();
    void handleNetworkSelection(int index);

    // Human-readable reason for the last WiFi.status() failure code
    static String wifiStatusReason(wl_status_t status);
};

#endif // WIFI_MANAGER_H
