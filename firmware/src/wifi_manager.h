#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include <Preferences.h>
#include <vector>
#include "config.h"
#include "loop_task.h"
#include "serial_menu.h"

class DataLogger;

struct WifiNetworkInfo {
    String ssid;
    int rssi = 0;
    String auth;
    bool open = false;
};

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

    void setApConfig(bool enabled, const String& ssid, const String& password);

    void setFallbackApRuntimeEnabled(bool enabled);

    bool isFallbackApRuntimeEnabled() const;

    bool isApConfiguredEnabled() const;

    bool isApActive() const;

    String getApSsid() const;

    String getApIp() const;

    int getApClientCount() const;

    bool isStaConfigured();

    String getSavedSsid();

    bool isReconnecting() const;

    String getLastStaError() const;

    std::vector<WifiNetworkInfo> scanForNetworks();

    bool connectToNetwork(const String& ssid, const String& password);

    void disconnectFromNetwork(bool clearSavedCredentials);

private:
    Preferences& prefs;
    DataLogger& dataLogger;
    String hostname = DEFAULT_HOSTNAME;
    bool apEnabled = true;
    String apSsid;
    String apPassword = WIFI_AP_DEFAULT_PASSWORD;
    SerialMenu menu;
    SerialMenu networkMenu;
    bool inConfigMode = false;
    bool inNetworkSelection = false;
    String selectedSSID = "";
    int scannedNetworkCount = 0;
    std::vector<WifiNetworkInfo> scannedNetworks;
    bool apActive = false;
    bool apRuntimeDisabled = false;
    bool reconnecting = false;
    String lastStaError;
    // Deferred AP reevaluation — set by request handlers, acted on by tick()
    // to avoid tearing down the AP while still serving the triggering response.
    bool pendingApReevaluate = false;

    void tick() override; // Called by LoopTask::loop() at WIFI_RECONNECT_INTERVAL cadence

    // Apply TX power from NVS (called after WiFi.begin and after reconnect)
    void applyTxPower();

    // Auto-reconnect state
    bool wasConnected = false;
    unsigned long reconnectBackoff = WIFI_RECONNECT_INTERVAL;
    unsigned long reconnectAttemptCount = 0;

    bool connectToWiFi(const String& ssid, const String& password, bool keepApActive = false);

    void saveCredentials(const String& ssid, const String& password);

    bool loadCredentials(String& ssid, String& password);

    void clearCredentials();

    bool startFallbackAp();

    void stopFallbackAp();

    void reevaluateFallbackAp();

    String effectiveApSsid() const;

    bool shouldAllowFallbackAp() const;

    static String authModeName(wifi_auth_mode_t mode);

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
