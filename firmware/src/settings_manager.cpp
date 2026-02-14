#include "settings_manager.h"

SettingsManager::SettingsManager(Preferences& prefs) : prefs(prefs) {}

// -- Lifecycle ---------------------------------------------------------------

void SettingsManager::begin() {
    load();
    LOG("SETTINGS", "Loaded: tz=%s debugLog=%s", current.tz.c_str(), current.debugLog ? "true" : "false");
}

// -- Persistence -------------------------------------------------------------

void SettingsManager::load() {
    current.tz = prefs.getString(NVS_KEY_TIMEZONE, NTP_DEFAULT_TZ);
    current.debugLog = prefs.getBool(NVS_KEY_DEBUG_LOG, false);
}

void SettingsManager::save() {
    prefs.putString(NVS_KEY_TIMEZONE, current.tz);
    prefs.putBool(NVS_KEY_DEBUG_LOG, current.debugLog);
}

// -- Partial update ----------------------------------------------------------

bool SettingsManager::apply(const String& json) {
    Settings incoming = current; // start from current values
    if (!incoming.fromJson(json))
        return false;

    bool changed = false;

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

    if (changed)
        save();
    return changed;
}

// -- JSON serialization / deserialization ------------------------------------

std::vector<Field> Settings::toFields() const {
    return {
            {"tz", tz, FIELD_STRING},
            {"debugLog", debugLog ? "true" : "false", FIELD_BOOL},
    };
}

bool Settings::fromFields(const std::vector<Field>& fields) {
    bool applied = false;
    const Field *f;

    if ((f = findField(fields, "tz")) && f->type == FIELD_STRING) {
        tz = f->value;
        applied = true;
    }
    if ((f = findField(fields, "debugLog")) && f->type == FIELD_BOOL) {
        debugLog = (f->value == "true");
        applied = true;
    }

    return applied;
}
