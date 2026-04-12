#ifndef SYSTEM_MANAGER_H
#define SYSTEM_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include <functional>
#include "config.h"
#include "json_fields.h"
#include "loop_task.h"

// System health snapshot — returned by SystemManager, serialized by caller
struct SystemHealth : public JsonSerializable {
    size_t heap = 0;
    size_t heapTotal = 0;
    unsigned long uptime = 0;
    int rssi = 0;
    size_t fsUsed = 0;
    size_t fsTotal = 0;
    bool ntpSynced = false;
    time_t time = 0;
    String timeSource;
    String tz;
    String localTime; // DST-aware local time string, e.g. "Sat 17:45:01"
    bool isDst = false; // true when daylight saving time is active

    std::vector<Field> toFields() const override;
};

class SystemManager : public LoopTask {
public:
    explicit SystemManager(Preferences& prefs);

    void begin();

    // Task Watchdog Timer — must be called from setup() after all slow init,
    // and feedTaskWdt() from every loop() iteration to prevent TWDT reset.
    void initTaskWdt();
    void feedTaskWdt();

    // Best-available epoch (NTP > fallback clock > millis)
    time_t now() const;

    // NTP status
    bool isNtpSynced() const { return ntpSynced; }

    // External clock fallback (e.g. robot clock parsed from GetTime)
    void setFallbackClock(time_t epoch);

    // Apply a timezone string (reconfigures NTP, does NOT store to NVS)
    void applyTimezone(const String& tz);

    // System health snapshot (heap, uptime, RSSI, storage, NTP, time)
    // Caller must supply tz string (owned by SettingsManager, not SystemManager)
    SystemHealth getSystemHealth(const String& tz) const;

    // Deferred restart — schedules a reboot after 500ms so HTTP response can flush
    void restart();

    // Deferred factory reset — clears NVS + WiFi, then restarts
    void factoryReset();

    // Deferred filesystem format — erases all logs/map data, then restarts
    void formatFs();

    // True if a deferred reboot is pending (restart or factory reset)
    bool isRebootPending() const { return pendingRebootAt > 0; }

    // Must be called from loop() — executes deferred reboot when timer expires
    void checkPendingReboot();

    // Callback fired once when NTP first syncs
    using NtpSyncCallback = std::function<void()>;
    void onNtpSync(NtpSyncCallback cb) { ntpSyncCallback = cb; }

private:
    void tick() override; // Runs every 5000ms — NTP sync detection + heap watchdog

    Preferences& prefs;
    bool ntpSynced = false;
    bool fallbackSet = false;
    time_t fallbackEpoch = 0;
    unsigned long fallbackMillis = 0;

    // Deferred reboot state
    unsigned long pendingRebootAt = 0;
    bool pendingFactoryReset = false;
    bool pendingFormatFs = false;

    // Heap watchdog state
    unsigned long heapLowSince = 0; // millis() when heap first dropped below threshold (0 = healthy)

    NtpSyncCallback ntpSyncCallback;
};

#endif // SYSTEM_MANAGER_H
