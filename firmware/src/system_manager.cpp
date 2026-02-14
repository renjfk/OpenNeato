#include "system_manager.h"
#include <SPIFFS.h>
#include <WiFi.h>
#include <ctime>

SystemManager::SystemManager(Preferences& prefs) : prefs(prefs) {}

// -- Lifecycle ---------------------------------------------------------------

void SystemManager::begin() {
    // NTP is configured by SettingsManager via applyTimezone() after settings are loaded
    LOG("SYS", "System manager initialized (NTP pending timezone from settings)");
}

void SystemManager::loop() {
    // Detect NTP sync transition
    if (!ntpSynced) {
        time_t t = time(nullptr);
        if (t > 1700000000) {
            ntpSynced = true;
            LOG("SYS", "NTP synced: %ld", static_cast<long>(t));
            if (ntpSyncCallback) {
                ntpSyncCallback();
            }
        }
    }
}

// -- Time --------------------------------------------------------------------

time_t SystemManager::now() const {
    // Prefer NTP
    time_t t = time(nullptr);
    if (t > 1700000000)
        return t;

    // Fall back to external clock
    if (fallbackSet && fallbackEpoch > 0) {
        return fallbackEpoch + (millis() - fallbackMillis) / 1000;
    }

    // Last resort: uptime as pseudo-timestamp
    return static_cast<time_t>(millis() / 1000);
}

void SystemManager::setFallbackClock(time_t epoch) {
    fallbackEpoch = epoch;
    fallbackMillis = millis();
    fallbackSet = true;
    LOG("SYS", "Fallback clock set: epoch %ld", static_cast<long>(epoch));
}

// -- Timezone ----------------------------------------------------------------

void SystemManager::applyTimezone(const String& tz) {
    configTzTime(tz.c_str(), NTP_SERVER_1, NTP_SERVER_2);
    LOG("SYS", "NTP timezone applied: %s", tz.c_str());
}

// -- System health -----------------------------------------------------------

std::vector<Field> SystemHealth::toFields() const {
    return {
            {"heap", String(heap), FIELD_INT},
            {"heapTotal", String(heapTotal), FIELD_INT},
            {"uptime", String(uptime), FIELD_INT},
            {"rssi", String(rssi), FIELD_INT},
            {"spiffsUsed", String(spiffsUsed), FIELD_INT},
            {"spiffsTotal", String(spiffsTotal), FIELD_INT},
            {"ntpSynced", ntpSynced ? "true" : "false", FIELD_BOOL},
            {"time", String(static_cast<long>(time)), FIELD_INT},
            {"timeSource", timeSource, FIELD_STRING},
            {"tz", tz, FIELD_STRING},
    };
}

SystemHealth SystemManager::getSystemHealth(const String& tz) const {
    SystemHealth h;
    h.heap = ESP.getFreeHeap();
    h.heapTotal = ESP.getHeapSize();
    h.uptime = millis();
    h.rssi = WiFi.RSSI();
    h.spiffsUsed = SPIFFS.usedBytes();
    h.spiffsTotal = SPIFFS.totalBytes();
    h.ntpSynced = ntpSynced;
    h.time = now();
    h.timeSource = ntpSynced ? "ntp" : (fallbackSet ? "fallback" : "millis");
    h.tz = tz;
    return h;
}
