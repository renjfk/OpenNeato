#ifndef SETTINGS_MANAGER_H
#define SETTINGS_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <functional>
#include "config.h"
#include "json_fields.h"

// Per-day schedule slot (Mon=0 .. Sun=6)
struct SchedDay {
    int hour = 0; // 0-23
    int minute = 0; // 0-59
    bool on = false; // true = house clean at this time
};

// All user-configurable settings — flat struct, serializable to/from JSON
struct Settings : public JsonSerializable {
    String hostname = DEFAULT_HOSTNAME;
    String tz = NTP_DEFAULT_TZ;
    bool debugLog = false;
    int wifiTxPower = WIFI_DEFAULT_TX_POWER; // 0.25 dBm units (34 = 8.5 dBm)
    int uartTxPin = NEATO_DEFAULT_TX_PIN; // ESP GPIO -> Robot RX
    int uartRxPin = NEATO_DEFAULT_RX_PIN; // ESP GPIO <- Robot TX

    // Schedule (ESP32-managed, not robot serial)
    bool scheduleEnabled = false;
    SchedDay sched[SCHEDULE_DAYS]; // Sun=0 .. Sat=6

    std::vector<Field> toFields() const override;
    bool fromFields(const std::vector<Field>& fields) override;
};

enum ApplyResult { APPLY_UNCHANGED, APPLY_CHANGED, APPLY_INVALID };

class SettingsManager {
public:
    explicit SettingsManager(Preferences& prefs);

    void begin();

    // Read current settings
    const Settings& get() const { return current; }

    // Apply a partial update — only fields present in the JSON body are written.
    ApplyResult apply(const String& json);

    // Callback fired when timezone changes (so SystemManager can reconfigure NTP)
    using TzChangeCallback = std::function<void(const String& tz)>;
    void onTzChange(TzChangeCallback cb) { tzChangeCb = cb; }

    // Callback fired when WiFi TX power changes (so WiFiManager can apply it live)
    using TxPowerChangeCallback = std::function<void(int quarterDbm)>;
    void onTxPowerChange(TxPowerChangeCallback cb) { txPowerChangeCb = cb; }

    // Callback fired when a setting change requires reboot (e.g. UART pins)
    using RebootCallback = std::function<void()>;
    void onRebootRequired(RebootCallback cb) { rebootCb = cb; }

private:
    Preferences& prefs;
    Settings current;
    TzChangeCallback tzChangeCb;
    TxPowerChangeCallback txPowerChangeCb;
    RebootCallback rebootCb;

    void load();
    void save();
};

#endif // SETTINGS_MANAGER_H
