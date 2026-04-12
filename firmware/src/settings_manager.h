#ifndef SETTINGS_MANAGER_H
#define SETTINGS_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <functional>
#include "config.h"
#include "json_fields.h"

// Single schedule time slot
struct SchedSlot {
    int hour = 0; // 0-23
    int minute = 0; // 0-59
    bool on = false; // true = house clean at this time
};

// Per-day schedule (Mon=0 .. Sun=6), two slots per day
struct SchedDay {
    SchedSlot slots[SCHEDULE_SLOTS_PER_DAY];
};

// All user-configurable settings — flat struct, serializable to/from JSON
struct Settings : public JsonSerializable {
    String hostname = DEFAULT_HOSTNAME;
    String tz = NTP_DEFAULT_TZ;
    int logLevel = LOG_LEVEL_OFF; // 0=off, 1=info, 2=debug (auto-expires back to off)
    int wifiTxPower = WIFI_DEFAULT_TX_POWER; // 0.25 dBm units (34 = 8.5 dBm)
    int uartTxPin = NEATO_DEFAULT_TX_PIN; // ESP GPIO -> Robot RX
    int uartRxPin = NEATO_DEFAULT_RX_PIN; // ESP GPIO <- Robot TX
    // House cleaning — sent to robot before each house clean starts
    String navMode = "Normal"; // Navigation mode: "Normal", "Gentle", "Deep", "Quick"
    // Manual clean motor settings
    int stallThreshold = MANUAL_STALL_LOAD_PCT; // Wheel load % for stall detection (30-80)
    int brushRpm = MANUAL_BRUSH_RPM; // Main brush RPM (500-1600)
    int vacuumSpeed = MANUAL_VACUUM_SPEED_PCT; // Vacuum speed % (40-100)
    int sideBrushPower = MANUAL_SIDE_BRUSH_POWER_MW; // Side brush power in mW (500-1500)

    // Notifications (ntfy.sh)
    String ntfyTopic; // Empty = disabled
    bool ntfyEnabled = false; // Global switch — must be on for any notification to fire
    bool ntfyOnDone = true; // Notify when cleaning completes
    bool ntfyOnError = true; // Notify on robot error (UI_ERROR_*, code 243+)
    bool ntfyOnAlert = true; // Notify on robot alert (UI_ALERT_*, code 201-242)
    bool ntfyOnDocking = true; // Notify when robot returns to base

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

    // Read current settings (auto-expires log level if timed out)
    const Settings& get();

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
    unsigned long logLevelEnabledAt = 0; // millis() when log level was changed from off (0 = off/never)

    void load();
    void save();
};

#endif // SETTINGS_MANAGER_H
