#include "manual_clean_manager.h"
#include "web_server.h"

ManualCleanManager::ManualCleanManager(NeatoSerial& serial) : LoopTask(0), serial(serial) {
    TaskRegistry::add(this);
}

// -- Enable/disable lifecycle ------------------------------------------------

bool ManualCleanManager::enable(bool doEnable, std::function<void(bool)> callback) {
    return enableFor(ControlOwner::MANUAL_UI, doEnable, callback);
}

bool ManualCleanManager::enableNavigation(bool doEnable, std::function<void(bool)> callback) {
    return enableFor(ControlOwner::NAVIGATION, doEnable, callback);
}

bool ManualCleanManager::enableFor(ControlOwner requestedOwner, bool doEnable, std::function<void(bool)> callback) {
    if (doEnable) {
        if (owner != ControlOwner::NONE || active || enabling || disabling) {
            if (callback)
                callback(false);
            return false;
        }

        owner = requestedOwner;
        enabling = true;
        enablingStartMs = millis();
        const uint32_t session = ++generation;
        LOG("MANUAL", "Enabling manual mode for owner %d...", static_cast<int>(requestedOwner));

        serial.testMode(true, [this, requestedOwner, session, callback](bool ok) {
            if (session != generation || owner != requestedOwner)
                return;
            if (!ok) {
                LOG("MANUAL", "TestMode On failed");
                enabling = false;
                owner = ControlOwner::NONE;
                if (callback)
                    callback(false);
                return;
            }

            serial.setLdsRotation(true, [this, requestedOwner, session, callback](bool ok) {
                if (session != generation || owner != requestedOwner)
                    return;
                if (!ok) {
                    LOG("MANUAL", "SetLDSRotation On failed, reverting TestMode");
                    serial.testMode(false, nullptr);
                    enabling = false;
                    owner = ControlOwner::NONE;
                    if (callback)
                        callback(false);
                    return;
                }

                // A previous emergency stop leaves the wheel drivers disabled.
                // The normal zero-distance command performs a disable/enable cycle.
                serial.setMotorWheels(0, 0, 0, [this, requestedOwner, session, callback](bool ok) {
                    if (session != generation || owner != requestedOwner)
                        return;
                    if (!ok) {
                        LOG("MANUAL", "Wheel enable failed, leaving TestMode");
                        serial.setLdsRotation(false, nullptr);
                        serial.testMode(false, nullptr);
                        enabling = false;
                        owner = ControlOwner::NONE;
                        if (callback)
                            callback(false);
                        return;
                    }

                    LOG("MANUAL", "Manual mode active for owner %d", static_cast<int>(requestedOwner));
                    enabling = false;
                    active = true;
                    serial.setManualCleanActive(true);
                    safetyTicker.reset();
                    stallTicker.reset();
                    watchdogStopped = false;

                    bumperFrontLeft = false;
                    bumperFrontRight = false;
                    bumperSideLeft = false;
                    bumperSideRight = false;
                    wheelLifted = false;
                    wheelsMoving = false;
                    stallCount = 0;
                    stallFront = false;
                    stallRear = false;
                    brushOn = false;
                    vacuumOn = false;
                    sideBrushOn = false;

                    if (callback)
                        callback(true);
                });
            });
        });
        return true;
    }

    if (owner != requestedOwner || (!active && !enabling) || disabling) {
        if (callback)
            callback(false);
        return false;
    }

    disabling = true;
    enabling = false;
    const uint32_t session = ++generation;
    LOG("MANUAL", "Disabling manual mode for owner %d...", static_cast<int>(requestedOwner));

    serial.emergencyStopWheels([this, requestedOwner, session, callback](bool stopOk) {
        if (session != generation || owner != requestedOwner)
            return;
        stopAllMotors();
        serial.setLdsRotation(false, [this, requestedOwner, session, callback, stopOk](bool ldsOk) {
            if (session != generation || owner != requestedOwner)
                return;
            serial.testMode(false, [this, requestedOwner, session, callback, stopOk, ldsOk](bool testModeOk) {
                if (session != generation || owner != requestedOwner)
                    return;
                bool ok = stopOk && ldsOk && testModeOk;
                LOG("MANUAL", "Manual mode disabled for owner %d (%s)", static_cast<int>(requestedOwner),
                    ok ? "clean" : "teardown failed");
                active = false;
                serial.setManualCleanActive(false);
                disabling = false;
                owner = ControlOwner::NONE;
                if (callback)
                    callback(ok);
            });
        });
    });
    return true;
}

// -- Movement with safety check ----------------------------------------------

bool ManualCleanManager::move(int leftMM, int rightMM, int speedMMs, std::function<void(bool)> callback) {
    return moveFor(ControlOwner::MANUAL_UI, leftMM, rightMM, speedMMs, callback, false);
}

bool ManualCleanManager::moveNavigation(int leftMM, int rightMM, int speedMMs, std::function<void(bool)> callback) {
    return moveFor(ControlOwner::NAVIGATION, leftMM, rightMM, speedMMs, callback, true);
}

bool ManualCleanManager::moveFor(ControlOwner requestedOwner, int leftMM, int rightMM, int speedMMs,
                                 std::function<void(bool)> callback, bool requireFreshSafety) {
    if (!active || disabling || owner != requestedOwner)
        return false;

    unsigned long lastActivity = WebServer::lastApiActivity;
    bool clientTimedOut = lastActivity > 0 && millis() - lastActivity >= MANUAL_CLIENT_TIMEOUT_MS;
    if ((watchdogStopped || clientTimedOut) && (leftMM != 0 || rightMM != 0)) {
        watchdogStopped = true;
        return false;
    }

    if (leftMM == 0 && rightMM == 0) {
        wheelsMoving = false;
        return serial.setMotorWheels(0, 0, 0, callback);
    }

    auto issueMove = [this, requestedOwner, leftMM, rightMM, speedMMs, callback]() {
        if (!active || disabling || owner != requestedOwner || !isMoveAllowed(leftMM, rightMM)) {
            LOG("MANUAL", "Move blocked for owner %d: L=%d R=%d", static_cast<int>(requestedOwner), leftMM, rightMM);
            stopWheels();
            if (callback)
                callback(false);
            return;
        }

        lastCmdLeftMM = leftMM;
        lastCmdRightMM = rightMM;
        if (!wheelsMoving) {
            wheelsMoving = true;
            stallCount = 0;
        }
        if (!serial.setMotorWheels(leftMM, rightMM, speedMMs, callback))
            wheelsMoving = false;
    };

    if (!requireFreshSafety) {
        issueMove();
        return true;
    }

    // Autonomous movement is fail-closed: bypass the sensor cache and require
    // a successful sample immediately before every wheel command.
    serial.getDigitalSensors(
            [this, requestedOwner, issueMove, callback](bool ok, const DigitalSensorData& data) {
                if (!ok || !active || disabling || owner != requestedOwner) {
                    stopWheels();
                    if (callback)
                        callback(false);
                    return;
                }
                updateSafetyState(data);
                issueMove();
            },
            PRIORITY_CRITICAL);
    return true;
}

// -- Motor control -----------------------------------------------------------

bool ManualCleanManager::setMotors(bool brush, bool vacuum, bool sideBrush, std::function<void(bool)> callback) {
    if (!active || disabling || owner != ControlOwner::MANUAL_UI)
        return false;

    // Track how many motor commands need to complete.
    // Use a raw pointer in a shared array to avoid std::make_shared.
    int *remaining = new int(0);
    bool *anyFailed = new bool(false);

    auto done = [remaining, anyFailed, callback]() {
        (*remaining)--;
        if (*remaining <= 0) {
            bool failed = *anyFailed;
            delete remaining;
            delete anyFailed;
            if (callback)
                callback(!failed);
        }
    };
    auto fail = [anyFailed, done](bool ok) {
        if (!ok)
            *anyFailed = true;
        done();
    };

    // Only send commands for motors that changed state
    if (brush != brushOn) {
        (*remaining)++;
        serial.setMotorBrush(brush ? brushRpm : 0, fail);
        brushOn = brush;
    }
    if (vacuum != vacuumOn) {
        (*remaining)++;
        serial.setMotorVacuum(vacuum, vacuumSpeedPct, fail);
        vacuumOn = vacuum;
    }
    if (sideBrush != sideBrushOn) {
        (*remaining)++;
        serial.setMotorSideBrush(sideBrush, sideBrushMw, fail);
        sideBrushOn = sideBrush;
    }

    // No changes needed — callback immediately and clean up
    if (*remaining == 0) {
        delete remaining;
        delete anyFailed;
        if (callback)
            callback(true);
    }

    return true;
}

// -- Loop (safety polling + watchdog) ----------------------------------------

void ManualCleanManager::tick() {
    // Recover from stuck enabling state — if the enable callback never fires
    // (e.g. serial queue was full when TestMode/LDS commands were enqueued),
    // reset after 10s so the user can retry instead of being locked out forever.
    if (enabling && enablingStartMs > 0 && millis() - enablingStartMs >= 10000) {
        LOG("MANUAL", "Enable timeout — aborting manual mode enable after 10s");
        ++generation;
        enabling = false;
        enablingStartMs = 0;
        owner = ControlOwner::NONE;
        serial.setLdsRotation(false, nullptr);
        serial.testMode(false, nullptr);
    }

    if (!active)
        return;

    // Safety polling — bumpers (skip if serial queue is more than half full
    // to prevent queue saturation that blocks all other commands including
    // TestMode entry and move commands — root cause of #18)
    if (safetyTicker.elapsed(MANUAL_SAFETY_POLL_MS) && serial.queueDepth() <= NEATO_QUEUE_MAX_SIZE / 2) {
        pollBumpers();
    }

    // Stall detection — poll motor odometry while wheels are moving
    if (wheelsMoving && stallTicker.elapsed(MANUAL_STALL_POLL_MS) && serial.queueDepth() <= NEATO_QUEUE_MAX_SIZE / 2) {
        pollStall();
    }

    // Client watchdog — stop wheels if frontend goes silent (any API request resets the timer)
    unsigned long lastActivity = WebServer::lastApiActivity;
    unsigned long now = millis();
    if (!watchdogStopped && lastActivity > 0 && now - lastActivity >= MANUAL_CLIENT_TIMEOUT_MS) {
        LOG("MANUAL", "Client watchdog: no API activity for %lu ms, stopping wheels",
            (unsigned long) MANUAL_CLIENT_TIMEOUT_MS);
        stopWheels();
        watchdogStopped = true;
    }
}

// -- Safety polling ----------------------------------------------------------

void ManualCleanManager::pollBumpers() {
    // Safety polling uses HIGH priority to jump ahead of normal sensor polls
    serial.getDigitalSensors(
            [this](bool ok, const DigitalSensorData& d) {
                if (!ok || !active)
                    return;

                bool prevLift = wheelLifted;
                bool prevFrontL = bumperFrontLeft;
                bool prevFrontR = bumperFrontRight;
                bool prevSideL = bumperSideLeft;
                bool prevSideR = bumperSideRight;

                updateSafetyState(d);

                // Log state changes and stop wheels on any new contact
                if (wheelLifted && !prevLift) {
                    LOG("MANUAL", "SAFETY: Wheel lifted — stopping all motors and wheels");
                    stopWheels();
                    stopAllMotors();
                }
                if (bumperFrontLeft && !prevFrontL) {
                    LOG("MANUAL", "SAFETY: Left front bumper contact");
                    stopWheels();
                }
                if (bumperFrontRight && !prevFrontR) {
                    LOG("MANUAL", "SAFETY: Right front bumper contact");
                    stopWheels();
                }
                if (bumperSideLeft && !prevSideL) {
                    LOG("MANUAL", "SAFETY: Left side bumper contact");
                    stopWheels();
                }
                if (bumperSideRight && !prevSideR) {
                    LOG("MANUAL", "SAFETY: Right side bumper contact");
                    stopWheels();
                }
            },
            PRIORITY_HIGH);
}

void ManualCleanManager::updateSafetyState(const DigitalSensorData& data) {
    bumperFrontLeft = data.lFrontBit || data.lLdsBit;
    bumperFrontRight = data.rFrontBit || data.rLdsBit;
    bumperSideLeft = data.lSideBit;
    bumperSideRight = data.rSideBit;
    wheelLifted = data.leftWheelExtended || data.rightWheelExtended;
}

// -- Stall detection ---------------------------------------------------------

void ManualCleanManager::pollStall() {
    serial.getMotors(
            [this](bool ok, const MotorData& m) {
                if (!ok || !active || !wheelsMoving)
                    return;

                // Wheel load percentage spikes when motors fight an obstacle.
                // Either wheel exceeding the threshold counts as stalled.
                bool overloaded = (lastCmdLeftMM != 0 && m.leftWheelLoad >= stallLoadPct) ||
                                  (lastCmdRightMM != 0 && m.rightWheelLoad >= stallLoadPct);

                if (!overloaded) {
                    stallCount = 0;
                    return;
                }

                stallCount++;
                if (stallCount >= MANUAL_STALL_COUNT) {
                    LOG("MANUAL", "STALL: wheel overload (L load=%d%% R load=%d%%, cmd L=%d R=%d, count=%d)",
                        m.leftWheelLoad, m.rightWheelLoad, lastCmdLeftMM, lastCmdRightMM, stallCount);

                    // Set stall flags based on commanded direction.
                    // These persist until the user reverses away, unlike physical
                    // bumper flags which track real-time sensor state.
                    bool cmdForward = (lastCmdLeftMM > 0) || (lastCmdRightMM > 0);
                    bool cmdBackward = (lastCmdLeftMM < 0) || (lastCmdRightMM < 0);
                    if (cmdForward)
                        stallFront = true;
                    if (cmdBackward)
                        stallRear = true;

                    stopWheels();
                }
            },
            PRIORITY_HIGH);
}

// -- Movement safety logic ---------------------------------------------------

bool ManualCleanManager::isMoveAllowed(int leftMM, int rightMM) {
    // Wheel lift blocks everything
    if (wheelLifted)
        return false;

    // Determine movement direction from wheel distances
    bool movingForward = (leftMM > 0) || (rightMM > 0);
    bool movingBackward = (leftMM < 0) || (rightMM < 0);
    bool turningLeft = (rightMM > leftMM); // Right wheel goes further = turning left
    bool turningRight = (leftMM > rightMM); // Left wheel goes further = turning right

    // Combine physical bumper and stall flags
    bool frontBlocked = bumperFrontLeft || bumperFrontRight || stallFront;
    bool rearBlocked = stallRear;

    // Clear stall flags when moving in the opposite direction (escape move)
    if (movingBackward && !movingForward && stallFront)
        stallFront = false;
    if (movingForward && !movingBackward && stallRear)
        stallRear = false;

    // Front: blocks forward movement; turning into hit side only when not reversing
    if (frontBlocked && movingForward)
        return false;
    if (bumperFrontLeft && turningRight && !movingBackward)
        return false;
    if (bumperFrontRight && turningLeft && !movingBackward)
        return false;

    // Rear stall: blocks backward movement
    if (rearBlocked && movingBackward)
        return false;

    // Side bumper blocks only turning into the obstacle (not when reversing)
    if (bumperSideLeft && turningRight && !movingBackward)
        return false;
    if (bumperSideRight && turningLeft && !movingBackward)
        return false;

    return true;
}

// -- Status JSON (no serial I/O) ---------------------------------------------

String ManualCleanManager::getStatusJson() const {
    return fieldsToJson({
            {"active", active ? "true" : "false", FIELD_BOOL},
            {"brush", brushOn ? "true" : "false", FIELD_BOOL},
            {"vacuum", vacuumOn ? "true" : "false", FIELD_BOOL},
            {"sideBrush", sideBrushOn ? "true" : "false", FIELD_BOOL},
            {"lifted", wheelLifted ? "true" : "false", FIELD_BOOL},
            {"bumperFrontLeft", bumperFrontLeft ? "true" : "false", FIELD_BOOL},
            {"bumperFrontRight", bumperFrontRight ? "true" : "false", FIELD_BOOL},
            {"bumperSideLeft", bumperSideLeft ? "true" : "false", FIELD_BOOL},
            {"bumperSideRight", bumperSideRight ? "true" : "false", FIELD_BOOL},
            {"stallFront", stallFront ? "true" : "false", FIELD_BOOL},
            {"stallRear", stallRear ? "true" : "false", FIELD_BOOL},
    });
}

// -- Motor helpers -----------------------------------------------------------

void ManualCleanManager::stopWheels() {
    wheelsMoving = false;
    serial.emergencyStopWheels(nullptr);
}

void ManualCleanManager::stopAllMotors() {
    if (brushOn) {
        serial.setMotorBrush(0, nullptr);
        brushOn = false;
    }
    if (vacuumOn) {
        serial.setMotorVacuum(false, 0, nullptr);
        vacuumOn = false;
    }
    if (sideBrushOn) {
        serial.setMotorSideBrush(false, 0, nullptr);
        sideBrushOn = false;
    }
}
