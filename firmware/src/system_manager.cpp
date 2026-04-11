#include "system_manager.h"
#include <SPIFFS.h>
#include <WiFi.h>
#include <ctime>

SystemManager::SystemManager(Preferences& prefs) : LoopTask(5000), prefs(prefs) {
    TaskRegistry::add(this);
}

// -- Lifecycle ---------------------------------------------------------------

void SystemManager::begin() {
    // NTP is configured by SettingsManager via applyTimezone() after settings are loaded
    LOG("SYS", "System manager initialized (NTP pending timezone from settings)");
}

// -- Task Watchdog Timer -----------------------------------------------------

void SystemManager::initTaskWdt() {
    // Initialize TWDT with configured timeout. If loop() stops calling
    // feedTaskWdt(), the hardware watchdog resets the ESP32.
    esp_task_wdt_init(TASK_WDT_TIMEOUT_S, true); // true = panic (reset) on timeout
    esp_task_wdt_add(nullptr); // nullptr = subscribe current task (loopTask)
    LOG("SYS", "Task watchdog initialized (%ds timeout)", TASK_WDT_TIMEOUT_S);
}

void SystemManager::feedTaskWdt() {
    esp_task_wdt_reset();
}

void SystemManager::tick() {
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

    // Heap watchdog — restart if free heap stays critically low for too long.
    // This catches scenarios where the web server exhausts sockets/memory and
    // becomes unresponsive (e.g. after a UART desync cascade). A brief dip is
    // tolerated; only sustained low heap triggers the restart.
    size_t freeHeap = ESP.getFreeHeap();
    if (freeHeap < HEAP_WATCHDOG_THRESHOLD) {
        if (heapLowSince == 0) {
            heapLowSince = millis();
            LOG("SYS", "Heap watchdog: low heap detected (%u bytes)", freeHeap);
        } else if (millis() - heapLowSince >= HEAP_WATCHDOG_DURATION_MS) {
            LOG("SYS", "Heap watchdog: heap critically low for %lums (%u bytes), restarting", HEAP_WATCHDOG_DURATION_MS,
                freeHeap);
            ESP.restart();
        }
    } else {
        // Heap recovered — reset the timer
        if (heapLowSince > 0) {
            LOG("SYS", "Heap watchdog: heap recovered (%u bytes)", freeHeap);
            heapLowSince = 0;
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

// -- Deferred reboot ---------------------------------------------------------

void SystemManager::restart() {
    LOG("SYS", "Restart scheduled");
    pendingRebootAt = millis();
}

void SystemManager::factoryReset() {
    LOG("SYS", "Factory reset scheduled");
    pendingFactoryReset = true;
    pendingRebootAt = millis();
}

void SystemManager::formatFs() {
    LOG("SYS", "Filesystem format scheduled");
    pendingFormatFs = true;
    pendingRebootAt = millis();
}

void SystemManager::checkPendingReboot() {
    if (pendingRebootAt == 0 || millis() - pendingRebootAt < 500)
        return;

    if (pendingFactoryReset) {
        LOG("SYS", "Factory reset: clearing NVS, WiFi credentials, and filesystem...");
        prefs.clear();
        WiFi.disconnect(true, true);
        SPIFFS.format();
        delay(500);
    } else if (pendingFormatFs) {
        LOG("SYS", "Formatting filesystem...");
        SPIFFS.format();
        delay(500);
    }
    LOG("SYS", "Rebooting...");
    ESP.restart();
}

// -- System health -----------------------------------------------------------

std::vector<Field> SystemHealth::toFields() const {
    return {
            {"heap", String(heap), FIELD_INT},
            {"heapTotal", String(heapTotal), FIELD_INT},
            {"uptime", String(uptime), FIELD_INT},
            {"rssi", String(rssi), FIELD_INT},
            {"fsUsed", String(fsUsed), FIELD_INT},
            {"fsTotal", String(fsTotal), FIELD_INT},
            {"ntpSynced", ntpSynced ? "true" : "false", FIELD_BOOL},
            {"time", String(static_cast<long>(time)), FIELD_INT},
            {"timeSource", timeSource, FIELD_STRING},
            {"tz", tz, FIELD_STRING},
            {"localTime", localTime, FIELD_STRING},
            {"isDst", isDst ? "true" : "false", FIELD_BOOL},
    };
}

SystemHealth SystemManager::getSystemHealth(const String& tz) const {
    SystemHealth h;
    h.heap = ESP.getFreeHeap();
    h.heapTotal = ESP.getHeapSize();
    h.uptime = millis();
    h.rssi = WiFi.RSSI();
    h.fsUsed = SPIFFS.usedBytes();
    h.fsTotal = SPIFFS.totalBytes();
    h.ntpSynced = ntpSynced;
    h.time = now();
    h.timeSource = ntpSynced ? "ntp" : (fallbackSet ? "fallback" : "millis");
    h.tz = tz;

    // Compute DST-aware local time string via localtime_r (same conversion the
    // scheduler uses). The POSIX TZ string applied via configTzTime() handles
    // DST transitions, so this is always correct for the configured timezone.
    if (h.time > 1700000000) {
        struct tm tm;
        localtime_r(&h.time, &tm);
        static const char *DAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
        char buf[20];
        snprintf(buf, sizeof(buf), "%s %02d:%02d:%02d", DAYS[tm.tm_wday], tm.tm_hour, tm.tm_min, tm.tm_sec);
        h.localTime = buf;
        h.isDst = tm.tm_isdst > 0;
    }

    return h;
}
