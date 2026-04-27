#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include <Preferences.h>
#include <functional>
#include <vector>
#include "config.h"
#include "json_fields.h"
#include "loop_task.h"
#include "serial_menu.h"

class DataLogger;

// Status of an STA connection attempt initiated via the API.
struct WiFiStatus : public JsonSerializable {
    bool staConnected = false;
    String ssid;
    String ip;
    int rssi = 0;
    bool apActive = false;
    String apSsid;
    String apIp;
    int apClients = 0;
    bool apFallbackOnDisconnect = true;
    String lastError; // Empty when no error; otherwise human-readable failure reason

    std::vector<Field> toFields() const override;
};

// Single network result from a scan.
struct WiFiNetwork : public JsonSerializable {
    String ssid;
    int rssi = 0;
    bool open = false;

    std::vector<Field> toFields() const override;
};

// Scan result list , wraps a vector of networks for JSON serialization.
struct WiFiScanResult : public JsonSerializable {
    std::vector<WiFiNetwork> networks;

    std::vector<Field> toFields() const override { return {}; } // Unused , toJson is overridden
    String toJson() const;
};

class WiFiManager : public LoopTask {
public:
    WiFiManager(Preferences& prefs, DataLogger& logger);

    void begin();

    void showMenu();

    void handleSerialInput();

    bool isConnected() const;

    // True when the fallback AP is currently broadcasting. Used by main.cpp
    // to decide whether the web server should come up even without STA.
    bool isApActive() const { return apActive; }

    // Set hostname for WiFi/mDNS. Must be called before begin() or takes effect on next reboot.
    void setHostname(const String& name) { hostname = name; }

    // Apply TX power setting (0.25 dBm units). Safe to call at any time.
    void setTxPower(int quarterDbm);

    // Update the fallback-on-disconnect policy and re-evaluate AP state.
    void setApFallbackOnDisconnect(bool enabled);

    // -- API-driven WiFi management ------------------------------------------
    // These methods follow the registerGetRoute / registerPostRoute callback
    // shape so they can be wired directly from the web server.

    // Snapshot current STA + AP state. Always succeeds.
    void getStatus(std::function<void(bool, const WiFiStatus&)> cb);

    // Trigger a synchronous WiFi.scanNetworks() and report results.
    // Blocks the calling task for ~2s; only invoked from API handlers.
    void scanNetworks(std::function<void(bool, const WiFiScanResult&)> cb);

    // Save credentials, attempt connection. Reboots on success so the
    // new STA setup goes through the regular boot path.
    bool connect(const String& ssid, const String& password, std::function<void(bool)> cb);

    // Clear saved credentials and disconnect the STA. AP comes up
    // automatically after the disconnect (no credentials saved).
    bool disconnect(std::function<void(bool)> cb);

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

    // Fallback AP state
    bool apActive = false;
    bool apFallbackOnDisconnect = true; // Mirrors setting; updated via setApFallbackOnDisconnect
    String lastStaError; // Last STA failure reason (cleared on successful connect)

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

    bool hasSavedCredentials();

    // Fallback AP lifecycle
    String apSsidName() const; // Returns "<hostname>-ap"
    void startAccessPoint();
    void stopAccessPoint();
    // Decide whether the AP should be on and bring it up / down accordingly.
    // Called whenever STA state, credentials, or apFallbackOnDisconnect change.
    void reevaluateFallbackAp();

    // Menu actions
    void scanNetworksMenu();
    void manualSSID();
    void showStatus();
    void resetCredentials();
    void handleNetworkSelection(int index);

    // Human-readable reason for the last WiFi.status() failure code
    static String wifiStatusReason(wl_status_t status);
};

#endif // WIFI_MANAGER_H
