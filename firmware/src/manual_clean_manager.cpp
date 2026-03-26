#include "manual_clean_manager.h"
#include "web_server.h"

ManualCleanManager::ManualCleanManager(NeatoSerial& serial) : LoopTask(0), serial(serial) {
    TaskRegistry::add(this);
}

// -- Enable/disable lifecycle ------------------------------------------------

bool ManualCleanManager::enable(bool doEnable, std::function<void(bool)> callback) {
    if (doEnable) {
        if (active || enabling) {
            if (callback)
                callback(false);
            return false;
        }

        enabling = true;
        enablingStartMs = millis();
        LOG("MANUAL", "Enabling manual mode...");

        // Step 1: Enter TestMode
        serial.testMode(true, [this, callback](bool ok) {
            if (!ok) {
                LOG("MANUAL", "TestMode On failed");
                enabling = false;
                if (callback)
                    callback(false);
                return;
            }

            // Step 2: Start LDS rotation
            serial.setLdsRotation(true, [this, callback](bool ok) {
                if (!ok) {
                    LOG("MANUAL", "SetLDSRotation On failed, reverting TestMode");
                    serial.testMode(false, nullptr);
                    enabling = false;
                    if (callback)
                        callback(false);
                    return;
                }

                LOG("MANUAL", "Manual mode active");
                enabling = false;
                active = true;
                serial.setManualCleanActive(true);
                safetyTicker.reset(); // Force immediate first poll
                stallTicker.reset();
                watchdogStopped = false;

                // Reset safety state
                bumperFrontLeft = false;
                bumperFrontRight = false;
                bumperSideLeft = false;
                bumperSideRight = false;
                wheelLifted = false;

                // Reset stall detection
                wheelsMoving = false;
                stallCount = 0;
                stallFront = false;
                stallRear = false;

                // Reset motor state
                brushOn = false;
                vacuumOn = false;
                sideBrushOn = false;

                if (callback)
                    callback(true);
            });
        });
    } else {
        if (!active || disabling) {
            if (callback)
                callback(false);
            return false;
        }

        disabling = true;
        LOG("MANUAL", "Disabling manual mode...");

        // Step 1: Stop wheels immediately
        serial.setMotorWheels(0, 0, 0, [this, callback](bool) {
            // Step 2: Turn off cleaning motors (best-effort, don't block on failure)
            stopAllMotors();

            // Step 3: Stop LDS rotation
            serial.setLdsRotation(false, [this, callback](bool) {
                // Step 4: Exit TestMode
                serial.testMode(false, [this, callback](bool ok) {
                    LOG("MANUAL", "Manual mode disabled (%s)", ok ? "clean" : "TestMode Off failed");
                    active = false;
                    serial.setManualCleanActive(false);
                    disabling = false;
                    if (callback)
                        callback(ok);
                });
            });
        });
    }

    return true;
}

// -- Movement with safety check ----------------------------------------------

bool ManualCleanManager::move(int leftMM, int rightMM, int speedMMs, std::function<void(bool)> callback) {
    if (!active)
        return false;

    // Zero move = explicit stop, always allowed (priority so it jumps the queue)
    if (leftMM == 0 && rightMM == 0) {
        wheelsMoving = false;
        serial.setMotorWheels(0, 0, 0, callback);
        return true;
    }

    if (!isMoveAllowed(leftMM, rightMM)) {
        LOG("MANUAL", "Move blocked: L=%d R=%d (fL=%d fR=%d sL=%d sR=%d lift=%d)", leftMM, rightMM, bumperFrontLeft,
            bumperFrontRight, bumperSideLeft, bumperSideRight, wheelLifted);
        // Stop wheels to make sure robot isn't coasting from a previous command
        wheelsMoving = false;
        serial.setMotorWheels(0, 0, 0, nullptr);
        if (callback)
            callback(false);
        return true; // Request was accepted and handled (blocked), not a queue error
    }

    // Track movement for stall detection
    lastCmdLeftMM = leftMM;
    lastCmdRightMM = rightMM;
    if (!wheelsMoving) {
        // New movement — reset stall tracking
        wheelsMoving = true;
        stallCount = 0;
    }

    // setMotorWheels internally enqueues at CRITICAL priority
    serial.setMotorWheels(leftMM, rightMM, speedMMs, callback);
    return true;
}

// -- Motor control -----------------------------------------------------------

bool ManualCleanManager::setMotors(bool brush, bool vacuum, bool sideBrush, std::function<void(bool)> callback) {
    if (!active)
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
        LOG("MANUAL", "Enable timeout — resetting enabling flag after 10s");
        enabling = false;
        enablingStartMs = 0;
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

                bumperFrontLeft = d.lFrontBit || d.lLdsBit;
                bumperFrontRight = d.rFrontBit || d.rLdsBit;
                bumperSideLeft = d.lSideBit;
                bumperSideRight = d.rSideBit;
                wheelLifted = d.leftWheelExtended || d.rightWheelExtended;

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
    serial.setMotorWheels(0, 0, 0, nullptr);
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
