#include "neato_serial.h"
#include "config.h"

// -- Lifecycle ---------------------------------------------------------------

// Helper: create a cache hit lambda that fires loggerCallback with cached=true.
// Captures `this` so it reads loggerCallback at call time (works before setLogger).
#define CACHE_HIT(CMD)                                                                                                 \
    [this](unsigned long ageMs) {                                                                                      \
        if (loggerCallback)                                                                                            \
            loggerCallback(CMD, CMD_SUCCESS, 0, "", 0, 0, ageMs);                                                      \
    }

NeatoSerial::NeatoSerial() :
    LoopTask(0), versionCache(
                         CACHE_TTL_VERSION, [this](AsyncCache<VersionData>::Callback cb) { fetchVersion(cb); },
                         CACHE_HIT(CMD_GET_VERSION)),
    chargerCache(
            CACHE_TTL_CHARGER, [this](AsyncCache<ChargerData>::Callback cb) { fetchCharger(cb); },
            CACHE_HIT(CMD_GET_CHARGER)),
    digitalCache(
            CACHE_TTL_SENSORS, [this](AsyncCache<DigitalSensorData>::Callback cb) { fetchDigitalSensors(cb); },
            CACHE_HIT(CMD_GET_DIGITAL_SENSORS)),
    motorCache(
            CACHE_TTL_SENSORS, [this](AsyncCache<MotorData>::Callback cb) { fetchMotors(cb); },
            CACHE_HIT(CMD_GET_MOTORS)),
    stateCache(
            CACHE_TTL_STATE, [this](AsyncCache<RobotState>::Callback cb) { fetchState(cb); }, CACHE_HIT(CMD_GET_STATE)),
    errCache(
            CACHE_TTL_STATE, [this](AsyncCache<ErrorData>::Callback cb) { fetchErr(cb); }, CACHE_HIT(CMD_GET_ERR)),
    ldsCache(
            CACHE_TTL_LDS, [this](AsyncCache<LdsScanData>::Callback cb) { fetchLdsScan(cb); },
            CACHE_HIT(CMD_GET_LDS_SCAN)),
    robotPosRawCache(
            CACHE_TTL_SENSORS,
            [this](AsyncCache<RobotPosData>::Callback cb) { fetchRobotPos(CMD_GET_ROBOT_POS_RAW, cb); },
            CACHE_HIT(CMD_GET_ROBOT_POS_RAW)),
    robotPosSmoothCache(
            CACHE_TTL_SENSORS,
            [this](AsyncCache<RobotPosData>::Callback cb) { fetchRobotPos(CMD_GET_ROBOT_POS_SMOOTH, cb); },
            CACHE_HIT(CMD_GET_ROBOT_POS_SMOOTH)) {
    TaskRegistry::add(this);
}

#undef CACHE_HIT

void NeatoSerial::begin(int txPin, int rxPin) {
    uart.setRxBufferSize(NEATO_UART_RX_BUFFER);
    uart.begin(NEATO_BAUD_RATE, SERIAL_8N1, rxPin, txPin);
    LOG("NEATO", "UART initialized (TX=GPIO%d, RX=GPIO%d, baud=%d)", txPin, rxPin, NEATO_BAUD_RATE);
}

void NeatoSerial::initSKey() {
    sKeyPending = true;
    versionCache.invalidate(); // Force a fresh fetch (don't serve a stale failure)
    getVersion([this](bool ok, const VersionData& v) {
        if (!ok || v.serialNumber.length() == 0) {
            LOG("NEATO", "SKey init failed — GetVersion returned no serial, retrying in %lu ms", sKeyRetryDelay);
            sKeyRetryAt = millis() + sKeyRetryDelay;
            sKeyRetryDelay = (sKeyRetryDelay * 2 < SKEY_RETRY_MAX_MS) ? sKeyRetryDelay * 2 : SKEY_RETRY_MAX_MS;
            return;
        }
        sKeyPending = false;
        robotModelName = v.modelName;
        LOG("NEATO", "Model: %s (supported=%s)", robotModelName.c_str(),
            isSupportedModel(robotModelName) ? "yes" : "no");
        sKey = computeSKey(v.serialNumber);
        if (sKey.length() > 0) {
            LOG("NEATO", "SKey computed (%d chars) from serial %s", sKey.length(), v.serialNumber.c_str());
        } else {
            LOG("NEATO", "SKey computation failed for serial: %s", v.serialNumber.c_str());
        }
    });
}

String NeatoSerial::buildSetEvent(const char *event) const {
    return String(CMD_SET_EVENT_PREFIX) + event + CMD_SET_EVENT_SKEY + sKey;
}

void NeatoSerial::tick() {
    // Drive initSKey lifecycle: first attempt + retries on failure.
    // Runs inside tick() (not setup()) so the UART state machine is already
    // processing the queue — avoids the race where GetVersion was enqueued
    // in setup() but tick() hadn't started yet.
    if (sKeyPending && millis() >= sKeyRetryAt) {
        sKeyRetryAt = ULONG_MAX; // Prevent re-entry while fetch is in flight
        initSKey();
    }

    switch (state) {
        case QUEUE_IDLE:
            if (!queue.empty()) {
                dequeueNext();
            }
            break;

        case QUEUE_SENDING:
            sendCurrentCommand();
            break;

        case QUEUE_WAITING_RESPONSE: {
            // Read all available bytes
            while (uart.available()) {
                char c = static_cast<char>(uart.read());
                if (c == NEATO_RESPONSE_TERMINATOR) {
                    unsigned long elapsed = millis() - commandSentAt;
                    LOG("NEATO", "RX: %u bytes in %lu ms", responseBuffer.length(), elapsed);

                    // Validate: response must echo the sent command on the first line.
                    // If it doesn't, the UART stream is desynced (we got a response
                    // meant for a different command). Flush and fail this request so
                    // the next command starts clean.
                    if (!validateResponseEcho(responseBuffer)) {
                        LOG("NEATO", "DESYNC: sent '%s' but response echoed a different command, flushing",
                            currentCommand.c_str());
                        flushUartRx();
                        completeCommand(CMD_SERIAL_ERROR, responseBuffer);
                        return;
                    }

                    // Detect "Unknown Cmd" — robot doesn't support this command
                    if (responseBuffer.indexOf("Unknown Cmd") >= 0) {
                        LOG("NEATO", "Unsupported: %s", currentCommand.c_str());
                        completeCommand(CMD_UNSUPPORTED, responseBuffer);
                        return;
                    }

                    completeCommand(CMD_SUCCESS, responseBuffer);
                    return;
                }
                responseBuffer += c;
            }
            // Check timeout
            if (millis() - commandSentAt >= NEATO_CMD_TIMEOUT_MS) {
                LOG("NEATO", "Timeout: %s (%lu ms, partial: %u bytes)", currentCommand.c_str(),
                    (unsigned long) NEATO_CMD_TIMEOUT_MS, responseBuffer.length());
                // Log partial response on timeout (useful for debugging serial issues).
                // Flush UART to prevent stale bytes from leaking into the next command.
                flushUartRx();
                completeCommand(CMD_TIMEOUT, responseBuffer);
            }
            break;
        }

        case QUEUE_INTER_DELAY:
            if (millis() - delayStartedAt >= NEATO_INTER_CMD_DELAY_MS) {
                state = QUEUE_IDLE;
            }
            break;
    }
}

// -- Queue management --------------------------------------------------------

bool NeatoSerial::enqueue(const String& command, std::function<void(bool, const String&)> callback,
                          CommandPriority priority) {
    if (static_cast<int>(queue.size()) >= NEATO_QUEUE_MAX_SIZE) {
        LOG("NEATO", "Queue full, rejecting: %s", command.c_str());
        if (loggerCallback)
            loggerCallback(command, CMD_QUEUE_FULL, 0, "", static_cast<int>(queue.size()), 0, 0);
        if (callback)
            callback(false, "");
        return false;
    }
    // Lower number = higher priority. Keep FIFO order within same priority.
    auto it = queue.begin();
    for (; it != queue.end(); ++it) {
        if (it->priority > priority)
            break;
    }
    queue.insert(it, {command, static_cast<uint8_t>(priority), callback});
    return true;
}

std::function<void(bool, const String&)> NeatoSerial::wrapAction(std::function<void(bool)> callback) {
    if (!callback)
        return nullptr;
    return [callback](bool ok, const String&) { callback(ok); };
}

void NeatoSerial::dequeueNext() {
    if (queue.empty())
        return;

    // Capture queue depth before dequeue (for logging)
    queueDepthAtStart = static_cast<int>(queue.size());

    CommandEntry entry = queue.front();
    queue.erase(queue.begin());

    currentCommand = entry.command;
    currentCallback = entry.callback;
    responseBuffer = "";

    state = QUEUE_SENDING;
}

void NeatoSerial::flushUartRx() {
    int flushed = 0;
    while (uart.available()) {
        uart.read();
        flushed++;
    }
    if (flushed > 0) {
        LOG("NEATO", "Flushed %d stale bytes from UART RX", flushed);
    }
}

void NeatoSerial::sendCurrentCommand() {
    // Drain any stale bytes from a previous response that may have arrived late
    flushUartRx();

    LOG("NEATO", "TX: %s", currentCommand.c_str());
    uart.print(currentCommand + "\n");
    commandSentAt = millis();
    state = QUEUE_WAITING_RESPONSE;
}

bool NeatoSerial::validateResponseEcho(const String& response) const {
    // The Neato echoes the command on the first line of the response,
    // e.g. "GetCharger\r\nLabel,Value\r\n...". Extract the first word of the
    // sent command (before any space/flag) and check the response starts with it.
    // Some commands echo only the name ("Clean" for "Clean House"), while others
    // echo the full command with arguments ("TestMode On" for "TestMode On").
    // Using startsWith handles both cases.
    String expectedEcho = currentCommand;
    int spacePos = expectedEcho.indexOf(' ');
    if (spacePos > 0)
        expectedEcho = expectedEcho.substring(0, spacePos);

    // Find the first line in the response (up to \r or \n)
    String firstLine = response;
    int crPos = firstLine.indexOf('\r');
    int lfPos = firstLine.indexOf('\n');
    int lineEnd = -1;
    if (crPos >= 0 && lfPos >= 0)
        lineEnd = (crPos < lfPos) ? crPos : lfPos;
    else if (crPos >= 0)
        lineEnd = crPos;
    else if (lfPos >= 0)
        lineEnd = lfPos;
    if (lineEnd >= 0)
        firstLine = firstLine.substring(0, lineEnd);

    // Check that the echo line starts with the expected command name (case-insensitive).
    firstLine.trim();
    expectedEcho.trim();
    firstLine.toLowerCase();
    expectedEcho.toLowerCase();
    return firstLine.startsWith(expectedEcho);
}

void NeatoSerial::completeCommand(CommandStatus status, const String& response) {
    unsigned long elapsed = millis() - commandSentAt;
    String cmd = currentCommand;
    auto cb = currentCallback;
    int qDepth = queueDepthAtStart;
    String resp = response; // Copy before clearing responseBuffer (response is a ref to it)
    size_t respBytes = resp.length();

    currentCommand = "";
    currentCallback = nullptr;
    responseBuffer = "";
    queueDepthAtStart = 0;

    // Start inter-command delay before next command
    delayStartedAt = millis();
    state = QUEUE_INTER_DELAY;

    // Fire logger hook before user callback with enhanced metadata
    if (loggerCallback)
        loggerCallback(cmd, status, elapsed, resp, qDepth, respBytes, 0);

    // User callback still gets simple bool for backward compatibility
    bool success = (status == CMD_SUCCESS);
    if (cb)
        cb(success, resp);
}

// -- Cached sensor query methods (public API) --------------------------------
// These delegate to AsyncCache, which handles TTL, dedup, and coalescing.

void NeatoSerial::getVersion(std::function<void(bool, const VersionData&)> callback) {
    versionCache.get(callback);
}

void NeatoSerial::getCharger(std::function<void(bool, const ChargerData&)> callback) {
    chargerCache.get(callback);
}

void NeatoSerial::getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback) {
    getDigitalSensors(callback, PRIORITY_NORMAL);
}

void NeatoSerial::getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback,
                                    CommandPriority priority) {
    // Normal priority goes through cache; elevated priority bypasses it
    // to guarantee commands are enqueued at the requested priority.
    if (priority == PRIORITY_NORMAL) {
        digitalCache.get(callback);
    } else {
        fetchDigitalSensors(callback, priority);
    }
}

void NeatoSerial::getMotors(std::function<void(bool, const MotorData&)> callback) {
    getMotors(callback, PRIORITY_NORMAL);
}

void NeatoSerial::getMotors(std::function<void(bool, const MotorData&)> callback, CommandPriority priority) {
    // Normal priority goes through cache; elevated priority bypasses it
    // to guarantee commands are enqueued at the requested priority.
    if (priority == PRIORITY_NORMAL) {
        motorCache.get(callback);
    } else {
        fetchMotors(callback, priority);
    }
}

void NeatoSerial::getState(std::function<void(bool, const RobotState&)> callback) {
    // During manual clean, the robot reports UIMGR_STATE_TESTMODE.
    // Override to UIMGR_STATE_MANUALCLEANING so callers (frontend, dashboard)
    // see the correct pseudo-state without needing to know about TestMode internals.
    if (manualCleanActive) {
        stateCache.get([callback](bool ok, const RobotState& data) {
            if (!ok || !callback) {
                if (callback)
                    callback(ok, data);
                return;
            }
            RobotState patched = data;
            patched.uiState = "UIMGR_STATE_MANUALCLEANING";
            callback(true, patched);
        });
        return;
    }
    stateCache.get(callback);
}

void NeatoSerial::getErr(std::function<void(bool, const ErrorData&)> callback) {
    errCache.get(callback);
}

void NeatoSerial::getErrClear(std::function<void(bool, const ErrorData&)> callback) {
    // getErrClear is never cached — it clears the error and always needs a fresh fetch
    fetchErrClear(callback);
}

void NeatoSerial::getLdsScan(std::function<void(bool, const LdsScanData&)> callback) {
    ldsCache.get(callback);
}

void NeatoSerial::getRobotPos(bool smooth, std::function<void(bool, const RobotPosData&)> callback) {
    (smooth ? robotPosSmoothCache : robotPosRawCache).get(callback);
}

// -- Raw fetch methods (enqueue serial command, parse response) ---------------

void NeatoSerial::fetchVersion(std::function<void(bool, const VersionData&)> callback) {
    enqueue(CMD_GET_VERSION, [callback](bool ok, const String& raw) {
        VersionData data;
        if (ok)
            ok = parseVersionData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchCharger(std::function<void(bool, const ChargerData&)> callback) {
    enqueue(CMD_GET_CHARGER, [callback](bool ok, const String& raw) {
        ChargerData data;
        if (ok)
            ok = parseChargerData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback,
                                      CommandPriority priority) {
    enqueue(
            CMD_GET_DIGITAL_SENSORS,
            [callback](bool ok, const String& raw) {
                DigitalSensorData data;
                if (ok)
                    ok = parseDigitalSensorData(raw, data);
                if (callback)
                    callback(ok, data);
            },
            priority);
}

void NeatoSerial::fetchMotors(std::function<void(bool, const MotorData&)> callback, CommandPriority priority) {
    enqueue(
            CMD_GET_MOTORS,
            [callback](bool ok, const String& raw) {
                MotorData data;
                if (ok)
                    ok = parseMotorData(raw, data);
                if (callback)
                    callback(ok, data);
            },
            priority);
}

void NeatoSerial::fetchState(std::function<void(bool, const RobotState&)> callback) {
    enqueue(CMD_GET_STATE, [callback](bool ok, const String& raw) {
        RobotState data;
        if (ok)
            ok = parseRobotState(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchErr(std::function<void(bool, const ErrorData&)> callback) {
    enqueue(CMD_GET_ERR, [callback](bool ok, const String& raw) {
        ErrorData data;
        if (ok)
            ok = parseErrorData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchErrClear(std::function<void(bool, const ErrorData&)> callback) {
    enqueue(CMD_GET_ERR_CLEAR, [callback](bool ok, const String& raw) {
        ErrorData data;
        if (ok)
            ok = parseErrorData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchLdsScan(std::function<void(bool, const LdsScanData&)> callback) {
    enqueue(CMD_GET_LDS_SCAN, [callback](bool ok, const String& raw) {
        LdsScanData data;
        if (ok)
            ok = parseLdsScanData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchRobotPos(const char *cmd, std::function<void(bool, const RobotPosData&)> callback) {
    enqueue(cmd, [callback](bool ok, const String& raw) {
        RobotPosData data;
        if (ok)
            ok = parseRobotPosData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

// -- Cache invalidation ------------------------------------------------------

void NeatoSerial::invalidateState() {
    stateCache.invalidate();
    errCache.invalidate();
}

void NeatoSerial::invalidateAll() {
    versionCache.invalidate();
    chargerCache.invalidate();
    digitalCache.invalidate();
    motorCache.invalidate();
    stateCache.invalidate();
    errCache.invalidate();
    ldsCache.invalidate();
    robotPosRawCache.invalidate();
    robotPosSmoothCache.invalidate();
}

// -- Action command convenience methods --------------------------------------

bool NeatoSerial::clean(const String& action, std::function<void(bool)> callback) {
    // All cleaning control uses SetEvent — the authenticated event API that D3-D7
    // robots use for their cloud/app protocol. This correctly transitions the UI
    // state machine and preserves map/localization during pause/resume.
    //
    // SKey must be computed at boot via initSKey(). If missing, commands will fail
    // gracefully (callback with false).

    if (!hasSKey()) {
        LOG("NEATO", "clean(%s) failed — SKey not available", action.c_str());
        if (callback)
            callback(false);
        return false;
    }

    if (action == "dock") {
        invalidateState();
        return enqueue(buildSetEvent(EVT_SEND_TO_BASE), wrapAction(callback), PRIORITY_HIGH);
    }

    if (action == "pause") {
        invalidateState();
        return enqueue(buildSetEvent(EVT_PAUSE), wrapAction(callback), PRIORITY_HIGH);
    }

    if (action == "stop") {
        invalidateState();
        return enqueue(buildSetEvent(EVT_STOP), wrapAction(callback), PRIORITY_HIGH);
    }

    bool isPaused = stateCache.hasCached() && stateCache.getCached().uiState.indexOf("CLEANINGPAUSED") >= 0;

    if (isPaused) {
        // Resume in-place — preserves map and localization
        invalidateState();
        return enqueue(buildSetEvent(EVT_RESUME), wrapAction(callback), PRIORITY_HIGH);
    }

    // New clean from idle
    const char *evt = (action == "spot") ? EVT_START_SPOT : EVT_START_HOUSE;
    invalidateState();
    if (cleanStartCallback)
        cleanStartCallback();
    return enqueue(buildSetEvent(evt), wrapAction(callback), PRIORITY_HIGH);
}

bool NeatoSerial::testMode(bool enable, std::function<void(bool)> callback) {
    const char *cmd = enable ? CMD_TEST_MODE_ON : CMD_TEST_MODE_OFF;
    invalidateState();
    // HIGH priority: TestMode is a prerequisite for motor commands — must execute
    // before any CRITICAL/MEDIUM motor commands that may already be queued.
    return enqueue(cmd, wrapAction(callback), PRIORITY_HIGH);
}

bool NeatoSerial::playSound(SoundId soundId, std::function<void(bool)> callback) {
    String cmd = String(CMD_PLAY_SOUND) + " SoundID " + String(static_cast<int>(soundId));
    return enqueue(cmd, wrapAction(callback));
}

bool NeatoSerial::setLdsRotation(bool on, std::function<void(bool)> callback) {
    const char *cmd = on ? CMD_SET_LDS_ROTATION_ON : CMD_SET_LDS_ROTATION_OFF;
    // HIGH priority: LDS rotation is a setup/teardown command that must execute
    // before motor commands during manual clean enable/disable sequences.
    return enqueue(cmd, wrapAction(callback), PRIORITY_HIGH);
}

bool NeatoSerial::setMotorWheels(int leftMM, int rightMM, int speedMMs, std::function<void(bool)> callback) {
    // SetMotor 0 0 0 bug: zero values are ignored, robot coasts for ~1s.
    // Workaround: disable wheels for immediate stop, then re-enable for next command.
    if (leftMM == 0 && rightMM == 0) {
        return enqueue(
                String(CMD_SET_MOTOR) + " LWheelDisable RWheelDisable",
                [this, callback](bool ok, const String&) {
                    // Re-enable wheels so subsequent move commands work
                    enqueue(String(CMD_SET_MOTOR) + " LWheelEnable RWheelEnable", wrapAction(callback),
                            PRIORITY_CRITICAL);
                },
                PRIORITY_CRITICAL);
    }
    // Robot rejects distances outside ±10000mm — clamp to protocol limits
    leftMM = constrain(leftMM, -10000, 10000);
    rightMM = constrain(rightMM, -10000, 10000);
    speedMMs = constrain(speedMMs, 0, 300);
    String cmd = String(CMD_SET_MOTOR) + " LWheelDist " + String(leftMM) + " RWheelDist " + String(rightMM) +
                 " Speed " + String(speedMMs);
    return enqueue(cmd, wrapAction(callback), PRIORITY_CRITICAL);
}

bool NeatoSerial::setMotorBrush(int rpm, std::function<void(bool)> callback) {
    if (rpm <= 0) {
        return enqueue(String(CMD_SET_MOTOR) + " BrushDisable", wrapAction(callback), PRIORITY_MEDIUM);
    }
    // BrushEnable energizes the motor driver, then Brush + RPM starts spinning.
    // Brush flag is mutually exclusive with wheel/vacuum commands per call.
    return enqueue(
            String(CMD_SET_MOTOR) + " BrushEnable",
            [this, rpm, callback](bool ok, const String&) {
                if (!ok) {
                    if (callback)
                        callback(false);
                    return;
                }
                enqueue(String(CMD_SET_MOTOR) + " Brush RPM " + String(rpm), wrapAction(callback), PRIORITY_MEDIUM);
            },
            PRIORITY_MEDIUM);
}

bool NeatoSerial::setMotorVacuum(bool on, int speedPercent, std::function<void(bool)> callback) {
    // VacuumSpeed must be combined with VacuumOn in the same call.
    String cmd = String(CMD_SET_MOTOR);
    cmd += on ? " VacuumOn VacuumSpeed " + String(speedPercent) : " VacuumOff";
    return enqueue(cmd, wrapAction(callback), PRIORITY_MEDIUM);
}

bool NeatoSerial::setMotorSideBrush(bool on, int powerMw, std::function<void(bool)> callback) {
    // Side brush (Botvac D3-D7 only) uses open-loop power control in milliwatts.
    // Two-layer control: SideBrushEnable energizes motor driver, SideBrushOn starts spinning.
    // Completely independent from the main brush.
    if (!on) {
        return enqueue(
                String(CMD_SET_MOTOR) + " SideBrushOff",
                [this, callback](bool ok, const String&) {
                    // Best-effort disable after stopping
                    enqueue(String(CMD_SET_MOTOR) + " SideBrushDisable", wrapAction(callback), PRIORITY_MEDIUM);
                },
                PRIORITY_MEDIUM);
    }
    return enqueue(
            String(CMD_SET_MOTOR) + " SideBrushEnable",
            [this, powerMw, callback](bool ok, const String&) {
                if (!ok) {
                    if (callback)
                        callback(false);
                    return;
                }
                enqueue(String(CMD_SET_MOTOR) + " SideBrushOn SideBrushPower " + String(powerMw), wrapAction(callback),
                        PRIORITY_MEDIUM);
            },
            PRIORITY_MEDIUM);
}

// -- Power control -----------------------------------------------------------

bool NeatoSerial::powerControl(const String& action, std::function<void(bool)> callback) {
    const char *cmd;
    if (action == "restart") {
        cmd = CMD_SET_SYSTEM_MODE_POWER_CYCLE;
    } else if (action == "shutdown") {
        cmd = CMD_SET_SYSTEM_MODE_SHUTDOWN;
    } else {
        LOG("NEATO", "powerControl: unknown action '%s'", action.c_str());
        if (callback)
            callback(false);
        return false;
    }

    // SetSystemMode requires TestMode On first (protocol specifies 100ms delay,
    // which the inter-command delay covers). Chain: TestMode On -> SetSystemMode.
    invalidateState();
    const char *sysCmd = cmd; // capture for lambda
    return testMode(true, [this, sysCmd, callback](bool ok) {
        if (!ok) {
            LOG("NEATO", "powerControl: TestMode On failed");
            if (callback)
                callback(false);
            return;
        }
        enqueue(sysCmd, wrapAction(callback), PRIORITY_HIGH);
    });
}

// -- Time commands -----------------------------------------------------------

bool NeatoSerial::getTime(std::function<void(bool, const TimeData&)> callback) {
    return enqueue(CMD_GET_TIME, [callback](bool ok, const String& raw) {
        TimeData data;
        if (ok)
            ok = parseTimeData(raw, data);
        callback(ok, data);
    });
}

bool NeatoSerial::setTime(int dayOfWeek, int hour, int min, int sec, std::function<void(bool)> callback) {
    String cmd = String(CMD_SET_TIME) + " Day " + String(dayOfWeek) + " Hour " + String(hour) + " Min " + String(min) +
                 " Sec " + String(sec);
    return enqueue(cmd, wrapAction(callback));
}

bool NeatoSerial::sendRaw(const String& cmd, std::function<void(bool, const String&)> callback) {
    if (cmd.isEmpty())
        return false;
    return enqueue(cmd, callback);
}
