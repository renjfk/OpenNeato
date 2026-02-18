#include "scheduler.h"

Scheduler::Scheduler(SettingsManager& settings, SystemManager& system, NeatoSerial& serial) :
    settings(settings), system(system), serial(serial) {}

// C library: Sun=0, Mon=1 .. Sat=6
// Our schedule: Mon=0, Tue=1 .. Sun=6
int Scheduler::toSchedDay(int tmWday) {
    return (tmWday + 6) % 7;
}

void Scheduler::logSchedule(const String& event, const std::vector<Field>& fields) {
    if (logCallback)
        logCallback(event, fields);
}

void Scheduler::loop() {
    // Throttle checks
    unsigned long now = millis();
    if (now - lastCheck < SCHEDULE_CHECK_INTERVAL_MS)
        return;
    lastCheck = now;

    const Settings& s = settings.get();
    if (!s.scheduleEnabled)
        return;

    // Get current local time (NTP preferred, robot fallback via SystemManager)
    time_t t = system.now();
    if (t <= 1700000000)
        return; // Clock not set yet

    struct tm tm;
    localtime_r(&t, &tm);

    int day = toSchedDay(tm.tm_wday);
    int nowMins = tm.tm_hour * 60 + tm.tm_min;

    const SchedDay& slot = s.sched[day];
    if (!slot.on)
        return;

    int schedMins = slot.hour * 60 + slot.minute;
    int elapsed = nowMins - schedMins;

    // Fire if we're within 0..SCHEDULE_WINDOW_MINS after the scheduled time
    if (elapsed < 0 || elapsed > SCHEDULE_WINDOW_MINS)
        return;

    // Already fired for this slot today?
    if (day == firedDay && schedMins == firedSlot)
        return;

    // Build common log fields for this slot
    String slotStr = String(schedMins / 60) + ":" + (schedMins % 60 < 10 ? "0" : "") + String(schedMins % 60);

    // Check robot state before triggering (uses cached state — no extra serial command)
    serial.getState([this, day, schedMins, slotStr](bool ok, const RobotState& state) {
        if (!ok) {
            LOG("SCHED", "GetState failed, cannot check robot state for slot %s", slotStr.c_str());
            logSchedule("state_error", {{"day", String(day), FIELD_INT}, {"slot", slotStr, FIELD_STRING}});
            return;
        }

        // Robot already cleaning — mark slot as fired so we don't retry every 30s
        if (state.uiState != "UIMGR_STATE_IDLE" && state.uiState != "UIMGR_STATE_STANDBY") {
            LOG("SCHED", "Robot busy (%s), skipping slot %s", state.uiState.c_str(), slotStr.c_str());
            logSchedule("skipped", {{"day", String(day), FIELD_INT},
                                    {"slot", slotStr, FIELD_STRING},
                                    {"reason", "busy", FIELD_STRING},
                                    {"state", state.uiState, FIELD_STRING}});
            firedDay = day;
            firedSlot = schedMins;
            return;
        }

        LOG("SCHED", "Triggering scheduled clean (day=%d slot=%s)", day, slotStr.c_str());
        logSchedule("trigger", {{"day", String(day), FIELD_INT}, {"slot", slotStr, FIELD_STRING}});

        serial.clean("house", [this, day, slotStr](bool ok) {
            LOG("SCHED", "Scheduled clean %s", ok ? "started" : "FAILED");
            if (!ok) {
                logSchedule("trigger_failed", {{"day", String(day), FIELD_INT}, {"slot", slotStr, FIELD_STRING}});
            }
        });

        firedDay = day;
        firedSlot = schedMins;
    });
}
