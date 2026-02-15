#include "settings_manager.h"

SettingsManager::SettingsManager(Preferences& prefs) : prefs(prefs) {}

// -- Lifecycle ---------------------------------------------------------------

void SettingsManager::begin() {
    load();
    LOG("SETTINGS", "Loaded: hostname=%s tz=%s debugLog=%s txPower=%d (%.1f dBm) uart=TX%d/RX%d",
        current.hostname.c_str(), current.tz.c_str(), current.debugLog ? "true" : "false", current.wifiTxPower,
        current.wifiTxPower * 0.25f, current.uartTxPin, current.uartRxPin);
}

// -- Persistence -------------------------------------------------------------

void SettingsManager::load() {
    current.hostname = prefs.getString(NVS_KEY_HOSTNAME, DEFAULT_HOSTNAME);
    current.tz = prefs.getString(NVS_KEY_TIMEZONE, NTP_DEFAULT_TZ);
    current.debugLog = prefs.getBool(NVS_KEY_DEBUG_LOG, false);
    current.wifiTxPower = prefs.getInt(NVS_KEY_WIFI_TX_POWER, WIFI_DEFAULT_TX_POWER);
    current.uartTxPin = prefs.getInt(NVS_KEY_UART_TX_PIN, NEATO_DEFAULT_TX_PIN);
    current.uartRxPin = prefs.getInt(NVS_KEY_UART_RX_PIN, NEATO_DEFAULT_RX_PIN);
}

void SettingsManager::save() {
    prefs.putString(NVS_KEY_HOSTNAME, current.hostname);
    prefs.putString(NVS_KEY_TIMEZONE, current.tz);
    prefs.putBool(NVS_KEY_DEBUG_LOG, current.debugLog);
    prefs.putInt(NVS_KEY_WIFI_TX_POWER, current.wifiTxPower);
    prefs.putInt(NVS_KEY_UART_TX_PIN, current.uartTxPin);
    prefs.putInt(NVS_KEY_UART_RX_PIN, current.uartRxPin);
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

    if (changed)
        save();

    // Trigger reboot after save so the new pin config takes effect on next boot
    if (needReboot && rebootCb)
        rebootCb();

    return changed ? APPLY_CHANGED : APPLY_UNCHANGED;
}

// -- JSON serialization / deserialization ------------------------------------

std::vector<Field> Settings::toFields() const {
    return {
            {"hostname", hostname, FIELD_STRING},
            {"tz", tz, FIELD_STRING},
            {"debugLog", debugLog ? "true" : "false", FIELD_BOOL},
            {"wifiTxPower", String(wifiTxPower), FIELD_INT},
            {"uartTxPin", String(uartTxPin), FIELD_INT},
            {"uartRxPin", String(uartRxPin), FIELD_INT},
    };
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

    return applied;
}
