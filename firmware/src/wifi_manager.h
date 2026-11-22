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
    bool staticIpBypassed = false; // Static IP enabled but DHCP in use after a failed gateway probe
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

    // Static IP configuration. Must be called before begin() or connect();
    // the addresses are applied right before every STA connect attempt.
    void setStaticIp(bool enabled, const String& ip, const String& gateway, const String& subnet, const String& dns);

    // Callback fired when the saved network changed to a different SSID, so
    // the owner can drop a static IP that belongs to the previous network.
    void onNetworkChanged(std::function<void()> cb) { networkChangeCb = cb; }

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

    // Static IP (empty when DHCP is used)
    bool staticIpEnabled = false;
    bool staticIpApplied = false; // A static config is in effect on the STA interface
    bool staticIpBypassed = false; // Set when the gateway probe failed this boot
    String staticIp;
    String staticGateway;
    String staticSubnet;
    String staticDns;
    std::function<void()> networkChangeCb;

    void tick() override; // Called by LoopTask::loop() at WIFI_RECONNECT_INTERVAL cadence

    // Apply TX power from NVS (called after WiFi.begin and after reconnect)
    void applyTxPower();

    // Apply the static IP configuration before WiFi.begin(). No-op when the
    // static IP setting is off or the stored addresses are invalid (the
    // settings layer validates input, so the latter only happens on NVS
    // corruption, falling back to DHCP keeps the device reachable).
    // Returns true when the static configuration is in use for this attempt.
    // logSuccess=false on reconnect retries so a down network doesn't log the
    // same applied configuration next to every reconnect_fail event.
    bool applyStaticIp(bool logSuccess = true);

    // ICMP-probe the configured gateway after associating with a static IP.
    // A config that associates but cannot reach the gateway leaves the device
    // unreachable, so it is treated as a failure and DHCP is used instead.
    bool probeGateway();

    // Return the STA interface to DHCP after a static config was applied. The
    // Arduino core only leaves static mode through WiFi.config(), so the
    // previous settings cannot simply be dropped by disconnecting.
    void resetToDhcp();

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

    // Safe to call repeatedly: bring up the mDNS responder for
    // <hostname>.local advertising
    // the web UI on port 80. Called whenever a network interface (STA or AP)
    // becomes available so clients can reach the device without knowing its IP.
    void startMdns();

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
