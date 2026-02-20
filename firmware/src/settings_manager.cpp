#include "settings_manager.h"

// Day-name labels for JSON responses (Mon=0 .. Sun=6)
static const char *DAY_NAMES[SCHEDULE_DAYS] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};

// Build NVS key for a per-day schedule field: "s0h", "s0m", "s0on", etc.
static String schedKey(int day, const char *suffix) {
    return "s" + String(day) + suffix;
}

SettingsManager::SettingsManager(Preferences& prefs) : prefs(prefs) {}

// -- Lifecycle ---------------------------------------------------------------

void SettingsManager::begin() {
    load();
    LOG("SETTINGS", "Loaded: hostname=%s tz=%s debugLog=%s txPower=%d (%.1f dBm) uart=TX%d/RX%d sched=%s",
        current.hostname.c_str(), current.tz.c_str(), current.debugLog ? "true" : "false", current.wifiTxPower,
        current.wifiTxPower * 0.25f, current.uartTxPin, current.uartRxPin, current.scheduleEnabled ? "on" : "off");
}

// -- Persistence -------------------------------------------------------------

void SettingsManager::load() {
    current.hostname = prefs.getString(NVS_KEY_HOSTNAME, DEFAULT_HOSTNAME);
    current.tz = prefs.getString(NVS_KEY_TIMEZONE, NTP_DEFAULT_TZ);
    current.debugLog = prefs.getBool(NVS_KEY_DEBUG_LOG, false);
    current.wifiTxPower = prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER);
    current.uartTxPin = prefs.getInt(NVS_KEY_UART_TX_PIN, NEATO_DEFAULT_TX_PIN);
    current.uartRxPin = prefs.getInt(NVS_KEY_UART_RX_PIN, NEATO_DEFAULT_RX_PIN);
    current.stallThreshold = prefs.getInt(NVS_KEY_MC_STALL_THR, MANUAL_STALL_LOAD_PCT);
    current.brushRpm = prefs.getInt(NVS_KEY_MC_BRUSH_RPM, MANUAL_BRUSH_RPM);
    current.vacuumSpeed = prefs.getInt(NVS_KEY_MC_VACUUM_PCT, MANUAL_VACUUM_SPEED_PCT);
    current.sideBrushPower = prefs.getInt(NVS_KEY_MC_SBRUSH_MW, MANUAL_SIDE_BRUSH_POWER_MW);
    current.scheduleEnabled = prefs.getBool(NVS_KEY_SCHED_ENABLED, false);
    for (int d = 0; d < SCHEDULE_DAYS; d++) {
        current.sched[d].hour = prefs.getInt(schedKey(d, "h").c_str(), 0);
        current.sched[d].minute = prefs.getInt(schedKey(d, "m").c_str(), 0);
        current.sched[d].on = prefs.getBool(schedKey(d, "on").c_str(), false);
    }
}

void SettingsManager::save() {
    prefs.putString(NVS_KEY_HOSTNAME, current.hostname);
    prefs.putString(NVS_KEY_TIMEZONE, current.tz);
    prefs.putBool(NVS_KEY_DEBUG_LOG, current.debugLog);
    prefs.putInt(NVS_KEY_WIFI_TX_POWER, current.wifiTxPower);
    prefs.putInt(NVS_KEY_UART_TX_PIN, current.uartTxPin);
    prefs.putInt(NVS_KEY_UART_RX_PIN, current.uartRxPin);
    prefs.putInt(NVS_KEY_MC_STALL_THR, current.stallThreshold);
    prefs.putInt(NVS_KEY_MC_BRUSH_RPM, current.brushRpm);
    prefs.putInt(NVS_KEY_MC_VACUUM_PCT, current.vacuumSpeed);
    prefs.putInt(NVS_KEY_MC_SBRUSH_MW, current.sideBrushPower);
    prefs.putBool(NVS_KEY_SCHED_ENABLED, current.scheduleEnabled);
    for (int d = 0; d < SCHEDULE_DAYS; d++) {
        prefs.putInt(schedKey(d, "h").c_str(), current.sched[d].hour);
        prefs.putInt(schedKey(d, "m").c_str(), current.sched[d].minute);
        prefs.putBool(schedKey(d, "on").c_str(), current.sched[d].on);
    }
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

    if (incoming.debugLog != current.debugLog) {
        current.debugLog = incoming.debugLog;
        changed = true;
        LOG("SETTINGS", "Debug log -> %s", current.debugLog ? "on" : "off");
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

    if (incoming.uartTxPin != current.uartTxPin && incoming.uartTxPin >= 0 && incoming.uartTxPin <= 21) {
        current.uartTxPin = incoming.uartTxPin;
        changed = true;
        needReboot = true;
        LOG("SETTINGS", "UART TX pin -> GPIO%d (reboot required)", current.uartTxPin);
    }
    if (incoming.uartRxPin != current.uartRxPin && incoming.uartRxPin >= 0 && incoming.uartRxPin <= 21) {
        current.uartRxPin = incoming.uartRxPin;
        changed = true;
        needReboot = true;
        LOG("SETTINGS", "UART RX pin -> GPIO%d (reboot required)", current.uartRxPin);
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

    if (incoming.scheduleEnabled != current.scheduleEnabled) {
        current.scheduleEnabled = incoming.scheduleEnabled;
        changed = true;
        LOG("SETTINGS", "Schedule -> %s", current.scheduleEnabled ? "on" : "off");
    }

    for (int d = 0; d < SCHEDULE_DAYS; d++) { // NOLINT(modernize-loop-convert) index needed for DAY_NAMES[d]
        SchedDay& cur = current.sched[d];
        const SchedDay& inc = incoming.sched[d];
        if (inc.hour != cur.hour || inc.minute != cur.minute || inc.on != cur.on) {
            // Validate hour/minute ranges
            if (inc.hour < 0 || inc.hour > 23 || inc.minute < 0 || inc.minute > 59)
                return APPLY_INVALID;
            cur.hour = inc.hour;
            cur.minute = inc.minute;
            cur.on = inc.on;
            changed = true;
            LOG("SETTINGS", "Sched %s -> %02d:%02d %s", DAY_NAMES[d], cur.hour, cur.minute, cur.on ? "on" : "off");
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
            {"debugLog", debugLog ? "true" : "false", FIELD_BOOL},
            {"wifiTxPower", String(wifiTxPower), FIELD_INT},
            {"uartTxPin", String(uartTxPin), FIELD_INT},
            {"uartRxPin", String(uartRxPin), FIELD_INT},
            {"stallThreshold", String(stallThreshold), FIELD_INT},
            {"brushRpm", String(brushRpm), FIELD_INT},
            {"vacuumSpeed", String(vacuumSpeed), FIELD_INT},
            {"sideBrushPower", String(sideBrushPower), FIELD_INT},
            {"scheduleEnabled", scheduleEnabled ? "true" : "false", FIELD_BOOL},
    };
    for (int d = 0; d < SCHEDULE_DAYS; d++) {
        String prefix = "sched" + String(d);
        f.push_back({prefix + "Hour", String(sched[d].hour), FIELD_INT});
        f.push_back({prefix + "Min", String(sched[d].minute), FIELD_INT});
        f.push_back({prefix + "On", sched[d].on ? "true" : "false", FIELD_BOOL});
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
    if ((f = findField(fields, "debugLog")) && f->type == FIELD_BOOL) {
        debugLog = (f->value == "true");
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
    if ((f = findField(fields, "scheduleEnabled")) && f->type == FIELD_BOOL) {
        scheduleEnabled = (f->value == "true");
        applied = true;
    }
    for (int d = 0; d < SCHEDULE_DAYS; d++) { // NOLINT(modernize-loop-convert) index needed for field name prefix
        String prefix = "sched" + String(d);
        if ((f = findField(fields, (prefix + "Hour").c_str())) && f->type == FIELD_INT) {
            sched[d].hour = f->value.toInt();
            applied = true;
        }
        if ((f = findField(fields, (prefix + "Min").c_str())) && f->type == FIELD_INT) {
            sched[d].minute = f->value.toInt();
            applied = true;
        }
        if ((f = findField(fields, (prefix + "On").c_str())) && f->type == FIELD_BOOL) {
            sched[d].on = (f->value == "true");
            applied = true;
        }
    }

    return applied;
}
