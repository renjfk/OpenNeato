#ifndef MANUAL_CLEAN_MANAGER_H
#define MANUAL_CLEAN_MANAGER_H

#include <Arduino.h>
#include <functional>
#include "config.h"
#include "json_fields.h"
#include "loop_task.h"
#include "neato_serial.h"

// Manages the manual clean lifecycle: TestMode entry/exit, LDS rotation,
// continuous safety polling (bumpers + stall detection), and directional
// obstacle blocking.
//
// Flow:
//   enable()  → TestMode On → SetLDSRotation On → active (polling begins)
//   move()    → checks obstacles → SetMotor wheels (or rejects)
//   disable() → stop wheels → motors off → SetLDSRotation Off → TestMode Off
//
// Safety:
//   - Bumper contact blocks forward movement
//   - Wheel lift blocks all movement and motors
//   - Stall detection: polls wheel load while moving; if load exceeds
//     MANUAL_STALL_LOAD_PCT for MANUAL_STALL_COUNT consecutive polls, stops
//     wheels and sets stall flags blocking further movement in that direction
//   - Client watchdog stops wheels if no API activity within timeout
//     (uses WebServer::lastApiActivity — any request keeps it alive)
//
// Note: LIDAR is NOT used for movement blocking. The turret sits near the back
// of the D-shape, making distance-to-body-edge calculations unreliable. Bumpers
// are the ground truth for collision detection. LIDAR data is still available
// for the frontend map visualization via GET /api/lidar.

class ManualCleanManager : public LoopTask {
public:
    ManualCleanManager(NeatoSerial& serial);

    // Enter or exit manual mode (enable=true → TestMode On + LDS start, false → shutdown).
    // Returns false if already in requested state or a transition is in progress (caller gets 503).
    // Callback fires when the transition completes.
    bool enable(bool enable, std::function<void(bool)> callback);

    // Send a wheel move command. Validates against current obstacle state.
    // Returns false immediately if not active or a move is already queued (caller gets 503).
    // left/right: distance in mm (positive = forward, negative = backward); speed: mm/s.
    bool move(int leftMM, int rightMM, int speedMMs, std::function<void(bool)> callback);

    // Control cleaning motors (brush, vacuum, side brush).
    // Returns false immediately if not active (caller gets 503).
    bool setMotors(bool brush, bool vacuum, bool sideBrush, std::function<void(bool)> callback);

    bool isActive() const { return active; }

    // Update motor/safety settings from SettingsManager. Called at boot and on change.
    void setStallThreshold(int pct) { stallLoadPct = pct; }
    void setBrushRpm(int rpm) { brushRpm = rpm; }
    void setVacuumSpeed(int pct) { vacuumSpeedPct = pct; }
    void setSideBrushPower(int mw) { sideBrushMw = mw; }

    // Return current safety + motor state as JSON (no serial I/O — reads in-memory flags)
    String getStatusJson() const;

private:
    NeatoSerial& serial;
    bool active = false;
    bool enabling = false; // Transition in progress (enable sequence)
    unsigned long enablingStartMs = 0; // millis() when enable() started (for timeout recovery)
    bool disabling = false; // Transition in progress (disable sequence)

    // Current motor state (to avoid redundant commands on toggle)
    bool brushOn = false;
    bool vacuumOn = false;
    bool sideBrushOn = false;

    // Safety state — updated by continuous polling (physical sensors)
    bool bumperFrontLeft = false; // Left front/LDS bumper (blocks forward + right turn)
    bool bumperFrontRight = false; // Right front/LDS bumper (blocks forward + left turn)
    bool bumperSideLeft = false; // Left side bumper (blocks right turn only)
    bool bumperSideRight = false; // Right side bumper (blocks left turn only)
    bool wheelLifted = false; // Either wheel extended (robot picked up)

    // Stall-induced virtual bumpers — set by stall detection, cleared on reverse move
    bool stallFront = false; // Stall while moving forward → blocks forward
    bool stallRear = false; // Stall while moving backward → blocks backward

    void tick() override; // Called every loop() iteration (intervalMs = 0)

    // Polling tickers (independent sub-timers inside tick())
    Ticker safetyTicker; // MANUAL_SAFETY_POLL_MS
    Ticker stallTicker; // MANUAL_STALL_POLL_MS
    bool watchdogStopped = false; // True if watchdog already sent stop

    // Runtime motor/safety settings (defaults from config.h, updated by SettingsManager)
    int stallLoadPct = MANUAL_STALL_LOAD_PCT;
    int brushRpm = MANUAL_BRUSH_RPM;
    int vacuumSpeedPct = MANUAL_VACUUM_SPEED_PCT;
    int sideBrushMw = MANUAL_SIDE_BRUSH_POWER_MW;

    // Stall detection — tracks wheel load while moving
    bool wheelsMoving = false; // True between move() and stop/stall/disable
    int lastCmdLeftMM = 0; // Last commanded left wheel distance
    int lastCmdRightMM = 0; // Last commanded right wheel distance
    int stallCount = 0; // Consecutive polls with overloaded wheels

    // Poll digital sensors for bumper/wheel-lift state
    void pollBumpers();

    // Poll motor odometry while wheels are moving to detect stalls
    void pollStall();

    // Check if a move command is safe given current obstacle state.
    // Returns true if the move is allowed, false if blocked.
    bool isMoveAllowed(int leftMM, int rightMM);

    // Stop all wheel movement immediately
    void stopWheels();

    // Turn off all cleaning motors
    void stopAllMotors();
};

#endif // MANUAL_CLEAN_MANAGER_H
