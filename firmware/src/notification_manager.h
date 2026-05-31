#ifndef NOTIFICATION_MANAGER_H
#define NOTIFICATION_MANAGER_H

#include <Arduino.h>
#include "config.h"
#include "loop_task.h"

class NeatoSerial;
class SettingsManager;
class DataLogger;

class NotificationManager : public LoopTask {
public:
    NotificationManager(NeatoSerial& neato, SettingsManager& settings, DataLogger& logger);

    void begin();

    // Send a test notification to the given topic (called from web server)
    void sendTestNotification(const String& topic);

private:
    void tick() override; // Called by LoopTask; skipped while fetchPending

    NeatoSerial& neato;
    SettingsManager& settings;
    DataLogger& dataLogger;

    // Previous state for transition detection
    String prevUiState;
    String prevRobotState;
    bool prevHasError = false;
    int prevErrorCode = 200; // UI_ALERT_INVALID = no error

    // Track whether the robot was cleaning before entering docking state
    bool wasCleaningBeforeDock = false;

    // Pending state fetch tracking
    bool fetchPending = false;

    void checkTransitions();
    void sendNotification(const String& topic, const String& tags, const String& title, const String& message);
    static bool isActiveState(const String& uiState);
};

#endif // NOTIFICATION_MANAGER_H
