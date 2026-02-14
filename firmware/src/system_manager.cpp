#include "system_manager.h"
#include <SPIFFS.h>
#include <WiFi.h>
#include <ctime>

SystemManager::SystemManager(Preferences& prefs) : prefs(prefs) {}

// -- Lifecycle ---------------------------------------------------------------

void SystemManager::begin() {
    // Initialize default timezone if not set
    if (!prefs.isKey(NVS_KEY_TIMEZONE)) {
        prefs.putString(NVS_KEY_TIMEZONE, NTP_DEFAULT_TZ);
        LOG("SYS", "Initialized timezone with default: %s", NTP_DEFAULT_TZ);
    }

    String tz = getTimezone();
    configTzTime(tz.c_str(), NTP_SERVER_1, NTP_SERVER_2);
    LOG("SYS", "NTP configured with TZ: %s", tz.c_str());
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

String SystemManager::getTimezone() const {
    return prefs.getString(NVS_KEY_TIMEZONE, NTP_DEFAULT_TZ);
}

void SystemManager::setTimezone(const String& tz) {
    prefs.putString(NVS_KEY_TIMEZONE, tz);
    configTzTime(tz.c_str(), NTP_SERVER_1, NTP_SERVER_2);
    LOG("SYS", "Timezone updated: %s", tz.c_str());
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

SystemHealth SystemManager::getSystemHealth() const {
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
    h.tz = getTimezone();
    return h;
}
