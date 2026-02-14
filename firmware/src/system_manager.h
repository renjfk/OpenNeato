#ifndef SYSTEM_MANAGER_H
#define SYSTEM_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <functional>
#include "config.h"
#include "json_fields.h"

// System health snapshot — returned by SystemManager, serialized by caller
struct SystemHealth : public JsonSerializable {
    size_t heap = 0;
    size_t heapTotal = 0;
    unsigned long uptime = 0;
    int rssi = 0;
    size_t spiffsUsed = 0;
    size_t spiffsTotal = 0;
    bool ntpSynced = false;
    time_t time = 0;
    String timeSource;
    String tz;

    std::vector<Field> toFields() const override;
};

class SystemManager {
public:
    explicit SystemManager(Preferences& prefs);

    void begin();
    void loop();

    // Best-available epoch (NTP > fallback clock > millis)
    time_t now() const;

    // NTP status
    bool isNtpSynced() const { return ntpSynced; }

    // External clock fallback (e.g. robot clock parsed from GetTime)
    void setFallbackClock(time_t epoch);

    // Timezone (POSIX TZ string, stored in NVS)
    String getTimezone() const;
    void setTimezone(const String& tz);

    // System health snapshot (heap, uptime, RSSI, SPIFFS, NTP, time, timezone)
    SystemHealth getSystemHealth() const;

    // Callback fired once when NTP first syncs
    using NtpSyncCallback = std::function<void()>;
    void onNtpSync(NtpSyncCallback cb) { ntpSyncCallback = cb; }

private:
    Preferences& prefs;
    bool ntpSynced = false;
    bool fallbackSet = false;
    time_t fallbackEpoch = 0;
    unsigned long fallbackMillis = 0;

    NtpSyncCallback ntpSyncCallback;
};

#endif // SYSTEM_MANAGER_H
