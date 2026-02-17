#ifndef SCHEDULER_H
#define SCHEDULER_H

#include <Arduino.h>
#include <functional>
#include <vector>
#include "config.h"
#include "json_fields.h"
#include "settings_manager.h"
#include "system_manager.h"
#include "neato_serial.h"

// ESP32-managed cleaning scheduler.
// Checks system time against the 7-day schedule stored in SettingsManager
// and issues Clean House via NeatoSerial when a scheduled time is reached.
// Uses SystemManager::now() for time (NTP preferred, robot fallback).
// Runs entirely on the ESP32 — does not use robot serial schedule commands.
class Scheduler {
public:
    Scheduler(SettingsManager& settings, SystemManager& system, NeatoSerial& serial);

    // Log callback — fires on schedule events (trigger, skip, fail)
    using LogCallback = std::function<void(const String& event, const std::vector<Field>& fields)>;
    void setLogger(LogCallback cb) { logCallback = std::move(cb); }

    void loop();

private:
    SettingsManager& settings;
    SystemManager& system;
    NeatoSerial& serial;
    LogCallback logCallback;

    unsigned long lastCheck = 0;

    // Duplicate trigger guard: remember the last slot we fired
    int firedDay = -1;
    int firedSlot = -1; // Minutes-since-midnight of the scheduled slot

    void logSchedule(const String& event, const std::vector<Field>& fields = {});

    // Convert C library tm_wday (Sun=0..Sat=6) to our index (Mon=0..Sun=6)
    static int toSchedDay(int tmWday);
};

#endif // SCHEDULER_H
