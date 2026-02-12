#ifndef SYSTEM_MANAGER_H
#define SYSTEM_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <functional>
#include "config.h"

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

    // System health JSON (heap, uptime, RSSI, SPIFFS, NTP, time, timezone)
    String systemHealthJson() const;

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
