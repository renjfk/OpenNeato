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

// NOLINTNEXTLINE(readability-convert-member-functions-to-static) - uses member state
String SystemManager::systemHealthJson() const {
    String json = "{";
    json += "\"heap\":" + String(ESP.getFreeHeap());
    json += ",\"heapTotal\":" + String(ESP.getHeapSize());
    json += ",\"uptime\":" + String(millis());
    json += ",\"rssi\":" + String(WiFi.RSSI());
    json += ",\"spiffsUsed\":" + String(SPIFFS.usedBytes());
    json += ",\"spiffsTotal\":" + String(SPIFFS.totalBytes());
    json += ",\"ntpSynced\":" + String(ntpSynced ? "true" : "false");
    json += ",\"time\":" + String(static_cast<long>(now()));
    json += R"(,"timeSource":")" + String(ntpSynced ? "ntp" : (fallbackSet ? "fallback" : "millis")) + R"(")";
    json += R"(,"tz":")" + getTimezone() + R"(")";
    json += "}";
    return json;
}
