#ifndef SCHEDULER_H
#define SCHEDULER_H

#include <Arduino.h>
#include <vector>
#include "config.h"
#include "json_fields.h"
#include "loop_task.h"
#include "settings_manager.h"
#include "system_manager.h"
#include "neato_serial.h"

class DataLogger;

// ESP32-managed cleaning scheduler.
// Checks system time against the 7-day schedule stored in SettingsManager
// and issues Clean House via NeatoSerial when a scheduled time is reached.
// Uses SystemManager::now() for time (NTP preferred, robot fallback).
// Runs entirely on the ESP32 — does not use robot serial schedule commands.
class Scheduler : public LoopTask {
public:
    Scheduler(SettingsManager& settings, SystemManager& system, NeatoSerial& serial, DataLogger& logger);

private:
    void tick() override; // Called every SCHEDULE_CHECK_INTERVAL_MS
    SettingsManager& settings;
    SystemManager& system;
    NeatoSerial& serial;
    DataLogger& dataLogger;

    // Duplicate trigger guard: remember fired slots per day.
    // Key = day * SCHEDULE_SLOTS_PER_DAY + slotIndex, value = minutes-since-midnight.
    int firedDay = -1;
    int firedSlots[SCHEDULE_SLOTS_PER_DAY] = {-1, -1}; // Minutes-since-midnight per slot index

    // Convert C library tm_wday (Sun=0..Sat=6) to our index (Mon=0..Sun=6)
    static int toSchedDay(int tmWday);
};

#endif // SCHEDULER_H
