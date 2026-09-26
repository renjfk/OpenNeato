#ifndef NAVIGATION_MANAGER_H
#define NAVIGATION_MANAGER_H

#include <Arduino.h>
#include <atomic>
#include <functional>
#include <vector>
#include "loop_task.h"

class DataLogger;
class ManualCleanManager;
class NeatoSerial;

struct NavigationWaypoint {
    float x = 0.0f;
    float y = 0.0f;
    float theta = 0.0f;
};

class NavigationManager : public LoopTask {
public:
    NavigationManager(NeatoSerial& serial, ManualCleanManager& manual, DataLogger& logger);

    bool start(const String& body, String& error);
    void stop();
    void noteClientActivity();
    String getStatusJson() const;

private:
    enum class State { IDLE, ENABLING, NAVIGATING, STOPPING, COMPLETE, CANCELLED, ERROR };

    NeatoSerial& serial;
    ManualCleanManager& manual;
    DataLogger& logger;
    State state = State::IDLE;
    std::vector<NavigationWaypoint> waypoints;
    size_t waypointIndex = 0;
    float currentX = 0.0f;
    float currentY = 0.0f;
    float currentTheta = 0.0f;
    bool hasPosition = false;
    bool positionPending = false;
    bool movePending = false;
    unsigned long nextPositionPollMs = 0;
    unsigned long stateStartedMs = 0;
    std::atomic<uint32_t> lastClientActivityMs{0};
    uint32_t generation = 0;
    String errorMessage;

    void tick() override;
    void pollPosition();
    void advanceFromPosition(float x, float y, float theta);
    void finish(State finalState, const String& error = "");
    static bool parseWaypoints(const String& body, std::vector<NavigationWaypoint>& result, String& error);
    static bool parsePose(const String& raw, float& x, float& y, float& theta);
    static const char *stateName(State value);
};

#endif
