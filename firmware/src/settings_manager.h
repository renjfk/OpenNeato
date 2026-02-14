#ifndef SETTINGS_MANAGER_H
#define SETTINGS_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <functional>
#include "config.h"
#include "json_fields.h"

// All user-configurable settings — flat struct, serializable to/from JSON
struct Settings : public JsonSerializable {
    String tz = NTP_DEFAULT_TZ;
    bool debugLog = false;

    std::vector<Field> toFields() const override;
    bool fromFields(const std::vector<Field>& fields) override;
};

class SettingsManager {
public:
    explicit SettingsManager(Preferences& prefs);

    void begin();

    // Read current settings
    const Settings& get() const { return current; }

    // Apply a partial update — only fields present in the JSON body are written.
    // Returns true if any field changed.
    bool apply(const String& json);

    // Callback fired when timezone changes (so SystemManager can reconfigure NTP)
    using TzChangeCallback = std::function<void(const String& tz)>;
    void onTzChange(TzChangeCallback cb) { tzChangeCb = cb; }

private:
    Preferences& prefs;
    Settings current;
    TzChangeCallback tzChangeCb;

    void load();
    void save();
};

#endif // SETTINGS_MANAGER_H
