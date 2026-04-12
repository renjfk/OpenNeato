#include "settings_manager.h"

// Day-name labels for JSON responses (Mon=0 .. Sun=6)
static const char *DAY_NAMES[SCHEDULE_DAYS] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};

// Build NVS key for a per-day, per-slot schedule field.
// Slot 0 (legacy): "s0h", "s0m", "s0on" (backwards compatible with single-slot firmware)
// Slot 1: "s0h1", "s0m1", "s0on1"
static String schedKey(int day, int slot, const char *suffix) {
    String key = "s" + String(day) + suffix;
    if (slot > 0)
        key += String(slot);
    return key;
}

SettingsManager::SettingsManager(Preferences& prefs) : prefs(prefs) {}

// -- Lifecycle ---------------------------------------------------------------

static const char *logLevelStr(int level) {
    switch (level) {
        case LOG_LEVEL_INFO:
            return "info";
        case LOG_LEVEL_DEBUG:
            return "debug";
        default:
            return "off";
    }
}

void SettingsManager::begin() {
    load();
    LOG("SETTINGS", "Loaded: hostname=%s tz=%s logLevel=%s txPower=%d (%.1f dBm) uart=TX%d/RX%d sched=%s",
        current.hostname.c_str(), current.tz.c_str(), logLevelStr(current.logLevel), current.wifiTxPower,
        current.wifiTxPower * 0.25f, current.uartTxPin, current.uartRxPin, current.scheduleEnabled ? "on" : "off");
}

// -- Persistence -------------------------------------------------------------

void SettingsManager::load() {
    current.hostname = prefs.getString(NVS_KEY_HOSTNAME, DEFAULT_HOSTNAME);
    current.tz = prefs.getString(NVS_KEY_TIMEZONE, NTP_DEFAULT_TZ);

    // TODO: Remove this migration block after v0.5 — all devices will have migrated by then.
    // Migrate legacy "debug" bool to "log_level" int on first boot after upgrade.
    // Old firmware stored debug=true/false; new firmware uses logLevel 0/1/2.
    if (prefs.isKey(NVS_KEY_DEBUG)) {
        bool oldDebug = prefs.getBool(NVS_KEY_DEBUG, false);
        current.logLevel = oldDebug ? LOG_LEVEL_DEBUG : LOG_LEVEL_OFF;
        prefs.remove(NVS_KEY_DEBUG);
        prefs.putInt(NVS_KEY_LOG_LEVEL, current.logLevel);
        LOG("SETTINGS", "Migrated debug=%s -> logLevel=%s", oldDebug ? "true" : "false", logLevelStr(current.logLevel));
    } else {
        current.logLevel = prefs.getInt(NVS_KEY_LOG_LEVEL, LOG_LEVEL_OFF);
    }
    if (current.logLevel > LOG_LEVEL_OFF)
        logLevelEnabledAt = millis(); // Start auto-expire timer for persisted log level
    current.wifiTxPower = prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER);
    current.uartTxPin = prefs.getInt(NVS_KEY_UART_TX_PIN, NEATO_DEFAULT_TX_PIN);
    current.uartRxPin = prefs.getInt(NVS_KEY_UART_RX_PIN, NEATO_DEFAULT_RX_PIN);
    current.navMode = prefs.getString(NVS_KEY_NAV_MODE, "Normal");
    current.stallThreshold = prefs.getInt(NVS_KEY_MC_STALL_THR, MANUAL_STALL_LOAD_PCT);
    current.brushRpm = prefs.getInt(NVS_KEY_MC_BRUSH_RPM, MANUAL_BRUSH_RPM);
    current.vacuumSpeed = prefs.getInt(NVS_KEY_MC_VACUUM_PCT, MANUAL_VACUUM_SPEED_PCT);
    current.sideBrushPower = prefs.getInt(NVS_KEY_MC_SBRUSH_MW, MANUAL_SIDE_BRUSH_POWER_MW);
    current.ntfyTopic = prefs.getString(NVS_KEY_NTFY_TOPIC, "");
    current.ntfyEnabled = prefs.getBool(NVS_KEY_NTFY_ENABLED, false);
    current.ntfyOnDone = prefs.getBool(NVS_KEY_NTFY_ON_DONE, true);
    current.ntfyOnError = prefs.getBool(NVS_KEY_NTFY_ON_ERR, true);
    current.ntfyOnAlert = prefs.getBool(NVS_KEY_NTFY_ON_ALERT, true);
    current.ntfyOnDocking = prefs.getBool(NVS_KEY_NTFY_ON_DOCK, true);
    current.scheduleEnabled = prefs.getBool(NVS_KEY_SCHED_ENABLED, false);
    for (int d = 0; d < SCHEDULE_DAYS; d++) {
        for (int s = 0; s < SCHEDULE_SLOTS_PER_DAY; s++) {
            current.sched[d].slots[s].hour = prefs.getInt(schedKey(d, s, "h").c_str(), 0);
            current.sched[d].slots[s].minute = prefs.getInt(schedKey(d, s, "m").c_str(), 0);
            current.sched[d].slots[s].on = prefs.getBool(schedKey(d, s, "on").c_str(), false);
        }
    }
}

void SettingsManager::save() {
    prefs.putString(NVS_KEY_HOSTNAME, current.hostname);
    prefs.putString(NVS_KEY_TIMEZONE, current.tz);
    prefs.putInt(NVS_KEY_LOG_LEVEL, current.logLevel);
    prefs.putInt(NVS_KEY_WIFI_TX_POWER, current.wifiTxPower);
    prefs.putInt(NVS_KEY_UART_TX_PIN, current.uartTxPin);
    prefs.putInt(NVS_KEY_UART_RX_PIN, current.uartRxPin);
    prefs.putString(NVS_KEY_NAV_MODE, current.navMode);
    prefs.putInt(NVS_KEY_MC_STALL_THR, current.stallThreshold);
    prefs.putInt(NVS_KEY_MC_BRUSH_RPM, current.brushRpm);
    prefs.putInt(NVS_KEY_MC_VACUUM_PCT, current.vacuumSpeed);
    prefs.putInt(NVS_KEY_MC_SBRUSH_MW, current.sideBrushPower);
    prefs.putString(NVS_KEY_NTFY_TOPIC, current.ntfyTopic);
    prefs.putBool(NVS_KEY_NTFY_ENABLED, current.ntfyEnabled);
    prefs.putBool(NVS_KEY_NTFY_ON_DONE, current.ntfyOnDone);
    prefs.putBool(NVS_KEY_NTFY_ON_ERR, current.ntfyOnError);
    prefs.putBool(NVS_KEY_NTFY_ON_ALERT, current.ntfyOnAlert);
    prefs.putBool(NVS_KEY_NTFY_ON_DOCK, current.ntfyOnDocking);
    prefs.putBool(NVS_KEY_SCHED_ENABLED, current.scheduleEnabled);
    for (int d = 0; d < SCHEDULE_DAYS; d++) {
        for (int s = 0; s < SCHEDULE_SLOTS_PER_DAY; s++) {
            prefs.putInt(schedKey(d, s, "h").c_str(), current.sched[d].slots[s].hour);
            prefs.putInt(schedKey(d, s, "m").c_str(), current.sched[d].slots[s].minute);
            prefs.putBool(schedKey(d, s, "on").c_str(), current.sched[d].slots[s].on);
        }
    }
}

// -- Debug auto-expire -------------------------------------------------------

const Settings& SettingsManager::get() {
    // Auto-revert log level to off after timeout to prevent forgotten verbose
    // logging that fills flash and degrades serial performance.
    if (current.logLevel > LOG_LEVEL_OFF && logLevelEnabledAt > 0) {
        unsigned long timeout =
                (current.logLevel >= LOG_LEVEL_DEBUG) ? LOG_LEVEL_AUTO_OFF_DEBUG_MS : LOG_LEVEL_AUTO_OFF_INFO_MS;
        if (millis() - logLevelEnabledAt >= timeout) {
            LOG("SETTINGS", "Log level auto-reverted: %s -> off (after %lu ms)", logLevelStr(current.logLevel),
                timeout);
            current.logLevel = LOG_LEVEL_OFF;
            logLevelEnabledAt = 0;
            save();
        }
    }
    return current;
}

// -- Partial update ----------------------------------------------------------

ApplyResult SettingsManager::apply(const String& json) {
    Settings incoming = current; // start from current values
    if (!incoming.fromJson(json))
        return APPLY_INVALID;

    bool changed = false;
    bool needReboot = false;

    if (incoming.hostname != current.hostname) {
        // Validate: non-empty, max 32 chars, alphanumeric + hyphens only
        String h = incoming.hostname;
        bool valid = h.length() > 0 && h.length() <= 32;
        for (unsigned int i = 0; valid && i < h.length(); i++) {
            char c = h.charAt(i);
            if (!isalnum(c) && c != '-')
                valid = false;
        }
        if (!valid)
            return APPLY_INVALID;
        current.hostname = h;
        changed = true;
        needReboot = true;
        LOG("SETTINGS", "Hostname -> %s (reboot required)", current.hostname.c_str());
    }

    if (incoming.tz != current.tz) {
        current.tz = incoming.tz;
        changed = true;
        if (tzChangeCb)
            tzChangeCb(current.tz);
        LOG("SETTINGS", "Timezone -> %s", current.tz.c_str());
    }

    if (incoming.logLevel != current.logLevel) {
        int clamped = constrain(incoming.logLevel, LOG_LEVEL_OFF, LOG_LEVEL_DEBUG);
        current.logLevel = clamped;
        changed = true;
        logLevelEnabledAt = (current.logLevel > LOG_LEVEL_OFF) ? millis() : 0;
        unsigned long timeout = (current.logLevel >= LOG_LEVEL_DEBUG)  ? LOG_LEVEL_AUTO_OFF_DEBUG_MS
                                : (current.logLevel == LOG_LEVEL_INFO) ? LOG_LEVEL_AUTO_OFF_INFO_MS
                                                                       : 0;
        LOG("SETTINGS", "Log level -> %s%s", logLevelStr(current.logLevel),
            timeout > 0 ? String(" (auto-off in " + String(timeout / 60000) + " min)").c_str() : "");
    }

    if (incoming.wifiTxPower != current.wifiTxPower) {
        // Clamp to valid range: 8 (2 dBm) .. 84 (21 dBm)
        int clamped = incoming.wifiTxPower;
        if (clamped < 8)
            clamped = 8;
        if (clamped > 84)
            clamped = 84;
        current.wifiTxPower = clamped;
        changed = true;
        if (txPowerChangeCb)
            txPowerChangeCb(current.wifiTxPower);
        LOG("SETTINGS", "WiFi TX power -> %d (%.1f dBm)", current.wifiTxPower, current.wifiTxPower * 0.25f);
    }

    // UART pin changes require reboot — hardware UART can't be reconfigured at runtime
    int newTx = incoming.uartTxPin != current.uartTxPin ? incoming.uartTxPin : current.uartTxPin;
    int newRx = incoming.uartRxPin != current.uartRxPin ? incoming.uartRxPin : current.uartRxPin;

    // Reject if TX and RX would be the same pin
    if (newTx == newRx && (incoming.uartTxPin != current.uartTxPin || incoming.uartRxPin != current.uartRxPin)) {
        LOG("SETTINGS", "Rejected: TX and RX cannot be the same pin (GPIO%d)", newTx);
        return APPLY_INVALID;
    }

    if (incoming.uartTxPin != current.uartTxPin && incoming.uartTxPin >= 0 && incoming.uartTxPin <= MAX_GPIO_PIN) {
        current.uartTxPin = incoming.uartTxPin;
        changed = true;
        needReboot = true;
        LOG("SETTINGS", "UART TX pin -> GPIO%d (reboot required)", current.uartTxPin);
    }
    if (incoming.uartRxPin != current.uartRxPin && incoming.uartRxPin >= 0 && incoming.uartRxPin <= MAX_GPIO_PIN) {
        current.uartRxPin = incoming.uartRxPin;
        changed = true;
        needReboot = true;
        LOG("SETTINGS", "UART RX pin -> GPIO%d (reboot required)", current.uartRxPin);
    }

    // Cleaning — navigation mode (sent to robot before each house clean)
    if (incoming.navMode != current.navMode) {
        // Validate against known modes
        if (incoming.navMode == "Normal" || incoming.navMode == "Gentle" || incoming.navMode == "Deep" ||
            incoming.navMode == "Quick") {
            current.navMode = incoming.navMode;
            changed = true;
            LOG("SETTINGS", "Nav mode -> %s", current.navMode.c_str());
        }
        // Silently ignore invalid values (keep current)
    }

    // Manual clean motor settings — clamp to safe hardware ranges
    if (incoming.stallThreshold != current.stallThreshold) {
        current.stallThreshold = constrain(incoming.stallThreshold, 30, 80);
        changed = true;
        LOG("SETTINGS", "Stall threshold -> %d%%", current.stallThreshold);
    }
    if (incoming.brushRpm != current.brushRpm) {
        current.brushRpm = constrain(incoming.brushRpm, 500, 1600);
        changed = true;
        LOG("SETTINGS", "Brush RPM -> %d", current.brushRpm);
    }
    if (incoming.vacuumSpeed != current.vacuumSpeed) {
        current.vacuumSpeed = constrain(incoming.vacuumSpeed, 40, 100);
        changed = true;
        LOG("SETTINGS", "Vacuum speed -> %d%%", current.vacuumSpeed);
    }
    if (incoming.sideBrushPower != current.sideBrushPower) {
        current.sideBrushPower = constrain(incoming.sideBrushPower, 500, 1500);
        changed = true;
        LOG("SETTINGS", "Side brush power -> %d mW", current.sideBrushPower);
    }

    if (incoming.ntfyTopic != current.ntfyTopic) {
        current.ntfyTopic = incoming.ntfyTopic;
        changed = true;
        LOG("SETTINGS", "ntfy topic -> %s", current.ntfyTopic.isEmpty() ? "(disabled)" : current.ntfyTopic.c_str());
    }

    if (incoming.ntfyEnabled != current.ntfyEnabled) {
        current.ntfyEnabled = incoming.ntfyEnabled;
        changed = true;
        LOG("SETTINGS", "ntfy enabled -> %s", current.ntfyEnabled ? "on" : "off");
    }
    if (incoming.ntfyOnDone != current.ntfyOnDone) {
        current.ntfyOnDone = incoming.ntfyOnDone;
        changed = true;
        LOG("SETTINGS", "ntfy on done -> %s", current.ntfyOnDone ? "on" : "off");
    }
    if (incoming.ntfyOnError != current.ntfyOnError) {
        current.ntfyOnError = incoming.ntfyOnError;
        changed = true;
        LOG("SETTINGS", "ntfy on error -> %s", current.ntfyOnError ? "on" : "off");
    }
    if (incoming.ntfyOnAlert != current.ntfyOnAlert) {
        current.ntfyOnAlert = incoming.ntfyOnAlert;
        changed = true;
        LOG("SETTINGS", "ntfy on alert -> %s", current.ntfyOnAlert ? "on" : "off");
    }
    if (incoming.ntfyOnDocking != current.ntfyOnDocking) {
        current.ntfyOnDocking = incoming.ntfyOnDocking;
        changed = true;
        LOG("SETTINGS", "ntfy on docking -> %s", current.ntfyOnDocking ? "on" : "off");
    }

    if (incoming.scheduleEnabled != current.scheduleEnabled) {
        current.scheduleEnabled = incoming.scheduleEnabled;
        changed = true;
        LOG("SETTINGS", "Schedule -> %s", current.scheduleEnabled ? "on" : "off");
    }

    for (int d = 0; d < SCHEDULE_DAYS; d++) { // NOLINT(modernize-loop-convert) index needed for DAY_NAMES[d]
        for (int s = 0; s < SCHEDULE_SLOTS_PER_DAY; s++) {
            SchedSlot& cur = current.sched[d].slots[s];
            const SchedSlot& inc = incoming.sched[d].slots[s];
            if (inc.hour != cur.hour || inc.minute != cur.minute || inc.on != cur.on) {
                // Validate hour/minute ranges
                if (inc.hour < 0 || inc.hour > 23 || inc.minute < 0 || inc.minute > 59)
                    return APPLY_INVALID;
                cur.hour = inc.hour;
                cur.minute = inc.minute;
                cur.on = inc.on;
                changed = true;
                LOG("SETTINGS", "Sched %s slot %d -> %02d:%02d %s", DAY_NAMES[d], s, cur.hour, cur.minute,
                    cur.on ? "on" : "off");
            }
        }
    }

    if (changed)
        save();

    // Trigger reboot after save so the new pin config takes effect on next boot
    if (needReboot && rebootCb)
        rebootCb();

    return changed ? APPLY_CHANGED : APPLY_UNCHANGED;
}

// -- JSON serialization / deserialization ------------------------------------

std::vector<Field> Settings::toFields() const {
    std::vector<Field> f = {
            {"hostname", hostname, FIELD_STRING},
            {"tz", tz, FIELD_STRING},
            {"logLevel", String(logLevel), FIELD_INT},
            {"wifiTxPower", String(wifiTxPower), FIELD_INT},
            {"uartTxPin", String(uartTxPin), FIELD_INT},
            {"uartRxPin", String(uartRxPin), FIELD_INT},
            {"maxGpioPin", String(MAX_GPIO_PIN), FIELD_INT},
            {"navMode", navMode, FIELD_STRING},
            {"stallThreshold", String(stallThreshold), FIELD_INT},
            {"brushRpm", String(brushRpm), FIELD_INT},
            {"vacuumSpeed", String(vacuumSpeed), FIELD_INT},
            {"sideBrushPower", String(sideBrushPower), FIELD_INT},
            {"ntfyTopic", ntfyTopic, FIELD_STRING},
            {"ntfyEnabled", ntfyEnabled ? "true" : "false", FIELD_BOOL},
            {"ntfyOnDone", ntfyOnDone ? "true" : "false", FIELD_BOOL},
            {"ntfyOnError", ntfyOnError ? "true" : "false", FIELD_BOOL},
            {"ntfyOnAlert", ntfyOnAlert ? "true" : "false", FIELD_BOOL},
            {"ntfyOnDocking", ntfyOnDocking ? "true" : "false", FIELD_BOOL},
            {"scheduleEnabled", scheduleEnabled ? "true" : "false", FIELD_BOOL},
    };
    for (int d = 0; d < SCHEDULE_DAYS; d++) {
        for (int s = 0; s < SCHEDULE_SLOTS_PER_DAY; s++) {
            // Slot 0: "sched0Hour", "sched0Min", "sched0On" (backwards compatible)
            // Slot 1: "sched0Slot1Hour", "sched0Slot1Min", "sched0Slot1On"
            String prefix = "sched" + String(d);
            if (s > 0)
                prefix += "Slot" + String(s);
            f.push_back({prefix + "Hour", String(sched[d].slots[s].hour), FIELD_INT});
            f.push_back({prefix + "Min", String(sched[d].slots[s].minute), FIELD_INT});
            f.push_back({prefix + "On", sched[d].slots[s].on ? "true" : "false", FIELD_BOOL});
        }
    }
    return f;
}

bool Settings::fromFields(const std::vector<Field>& fields) {
    bool applied = false;
    const Field *f;

    if ((f = findField(fields, "hostname")) && f->type == FIELD_STRING) {
        hostname = f->value;
        applied = true;
    }
    if ((f = findField(fields, "tz")) && f->type == FIELD_STRING) {
        tz = f->value;
        applied = true;
    }
    if ((f = findField(fields, "logLevel")) && f->type == FIELD_INT) {
        logLevel = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "wifiTxPower")) && f->type == FIELD_INT) {
        wifiTxPower = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "uartTxPin")) && f->type == FIELD_INT) {
        uartTxPin = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "uartRxPin")) && f->type == FIELD_INT) {
        uartRxPin = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "navMode")) && f->type == FIELD_STRING) {
        navMode = f->value;
        applied = true;
    }
    if ((f = findField(fields, "stallThreshold")) && f->type == FIELD_INT) {
        stallThreshold = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "brushRpm")) && f->type == FIELD_INT) {
        brushRpm = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "vacuumSpeed")) && f->type == FIELD_INT) {
        vacuumSpeed = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "sideBrushPower")) && f->type == FIELD_INT) {
        sideBrushPower = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "ntfyTopic")) && f->type == FIELD_STRING) {
        ntfyTopic = f->value;
        applied = true;
    }
    if ((f = findField(fields, "ntfyEnabled")) && f->type == FIELD_BOOL) {
        ntfyEnabled = (f->value == "true");
        applied = true;
    }
    if ((f = findField(fields, "ntfyOnDone")) && f->type == FIELD_BOOL) {
        ntfyOnDone = (f->value == "true");
        applied = true;
    }
    if ((f = findField(fields, "ntfyOnError")) && f->type == FIELD_BOOL) {
        ntfyOnError = (f->value == "true");
        applied = true;
    }
    if ((f = findField(fields, "ntfyOnAlert")) && f->type == FIELD_BOOL) {
        ntfyOnAlert = (f->value == "true");
        applied = true;
    }
    if ((f = findField(fields, "ntfyOnDocking")) && f->type == FIELD_BOOL) {
        ntfyOnDocking = (f->value == "true");
        applied = true;
    }
    if ((f = findField(fields, "scheduleEnabled")) && f->type == FIELD_BOOL) {
        scheduleEnabled = (f->value == "true");
        applied = true;
    }
    for (int d = 0; d < SCHEDULE_DAYS; d++) { // NOLINT(modernize-loop-convert) index needed for field name prefix
        for (int s = 0; s < SCHEDULE_SLOTS_PER_DAY; s++) {
            String prefix = "sched" + String(d);
            if (s > 0)
                prefix += "Slot" + String(s);
            if ((f = findField(fields, (prefix + "Hour").c_str())) && f->type == FIELD_INT) {
                sched[d].slots[s].hour = f->value.toInt();
                applied = true;
            }
            if ((f = findField(fields, (prefix + "Min").c_str())) && f->type == FIELD_INT) {
                sched[d].slots[s].minute = f->value.toInt();
                applied = true;
            }
            if ((f = findField(fields, (prefix + "On").c_str())) && f->type == FIELD_BOOL) {
                sched[d].slots[s].on = (f->value == "true");
                applied = true;
            }
        }
    }

    return applied;
}
