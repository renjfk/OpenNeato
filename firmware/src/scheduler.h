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

// ESP32-managed time-based automation.
// Checks system time against the schedule stored in SettingsManager
// and triggers robot actions when a scheduled time is reached.
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

    // Duplicate trigger guard for cleaning slots per day.
    int firedDay = -1;
    int firedSlots[SCHEDULE_SLOTS_PER_DAY] = {-1, -1}; // Minutes-since-midnight per slot index
    int firedAutoRestart = -1;

    // Pending clean after restart (RAM-only, no flash persistence)
    bool pendingCleanAfterRestart = false;
    int pendingCleanDay = -1;
    int pendingCleanSlot = -1;
    unsigned long restartIssuedAt = 0;

    // Convert C library tm_wday (Sun=0..Sat=6) to our index (Mon=0..Sun=6)
    static int toSchedDay(int tmWday);
    void resetFiredGuards(int day);
    bool isRobotIdle(const RobotState& state) const;
    bool handleScheduledCleaning(const Settings& s, int day, int nowMins);
    void handleAutoRestart(const Settings& s, int day, int nowMins);
    void handlePendingCleanAfterRestart();
    void clearPendingCleanAfterRestart();
    void triggerClean(int day, int slotIndex);

    // Returns true if the given time is within the check window and not already fired.
    // Writes the computed minutes-since-midnight into outSchedMins.
    static bool isActionDue(int hour, int minute, int nowMins, int lastFiredMins, int& outSchedMins);
};

#endif // SCHEDULER_H
