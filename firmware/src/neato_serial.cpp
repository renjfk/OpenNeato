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
    versionCache(
            CACHE_TTL_VERSION, [this](AsyncCache<VersionData>::Callback cb) { fetchVersion(cb); },
            CACHE_HIT(CMD_GET_VERSION)),
    chargerCache(
            CACHE_TTL_CHARGER, [this](AsyncCache<ChargerData>::Callback cb) { fetchCharger(cb); },
            CACHE_HIT(CMD_GET_CHARGER)),
    analogCache(
            CACHE_TTL_SENSORS, [this](AsyncCache<AnalogSensorData>::Callback cb) { fetchAnalogSensors(cb); },
            CACHE_HIT(CMD_GET_ANALOG_SENSORS)),
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
    accelCache(
            CACHE_TTL_ACCEL, [this](AsyncCache<AccelData>::Callback cb) { fetchAccel(cb); }, CACHE_HIT(CMD_GET_ACCEL)),
    buttonCache(
            CACHE_TTL_BUTTONS, [this](AsyncCache<ButtonData>::Callback cb) { fetchButtons(cb); },
            CACHE_HIT(CMD_GET_BUTTONS)),
    ldsCache(
            CACHE_TTL_LDS, [this](AsyncCache<LdsScanData>::Callback cb) { fetchLdsScan(cb); },
            CACHE_HIT(CMD_GET_LDS_SCAN)) {}

#undef CACHE_HIT

void NeatoSerial::begin(int txPin, int rxPin) {
    uart.begin(NEATO_BAUD_RATE, SERIAL_8N1, rxPin, txPin);
    LOG("NEATO", "UART initialized (TX=GPIO%d, RX=GPIO%d, baud=%d)", txPin, rxPin, NEATO_BAUD_RATE);
}

void NeatoSerial::loop() {
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

bool NeatoSerial::enqueue(const String& command, std::function<void(bool, const String&)> callback) {
    if (static_cast<int>(queue.size()) >= NEATO_QUEUE_MAX_SIZE) {
        LOG("NEATO", "Queue full, rejecting: %s", command.c_str());
        if (callback)
            callback(false, "");
        return false;
    }
    queue.push_back({command, callback});
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

void NeatoSerial::getAnalogSensors(std::function<void(bool, const AnalogSensorData&)> callback) {
    analogCache.get(callback);
}

void NeatoSerial::getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback) {
    digitalCache.get(callback);
}

void NeatoSerial::getMotors(std::function<void(bool, const MotorData&)> callback) {
    motorCache.get(callback);
}

void NeatoSerial::getState(std::function<void(bool, const RobotState&)> callback) {
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

void NeatoSerial::getAccel(std::function<void(bool, const AccelData&)> callback) {
    accelCache.get(callback);
}

void NeatoSerial::getButtons(std::function<void(bool, const ButtonData&)> callback) {
    buttonCache.get(callback);
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

void NeatoSerial::fetchAnalogSensors(std::function<void(bool, const AnalogSensorData&)> callback) {
    enqueue(CMD_GET_ANALOG_SENSORS, [callback](bool ok, const String& raw) {
        AnalogSensorData data;
        if (ok)
            ok = parseAnalogSensorData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback) {
    enqueue(CMD_GET_DIGITAL_SENSORS, [callback](bool ok, const String& raw) {
        DigitalSensorData data;
        if (ok)
            ok = parseDigitalSensorData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchMotors(std::function<void(bool, const MotorData&)> callback) {
    enqueue(CMD_GET_MOTORS, [callback](bool ok, const String& raw) {
        MotorData data;
        if (ok)
            ok = parseMotorData(raw, data);
        if (callback)
            callback(ok, data);
    });
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

void NeatoSerial::fetchAccel(std::function<void(bool, const AccelData&)> callback) {
    enqueue(CMD_GET_ACCEL, [callback](bool ok, const String& raw) {
        AccelData data;
        if (ok)
            ok = parseAccelData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

void NeatoSerial::fetchButtons(std::function<void(bool, const ButtonData&)> callback) {
    enqueue(CMD_GET_BUTTONS, [callback](bool ok, const String& raw) {
        ButtonData data;
        if (ok)
            ok = parseButtonData(raw, data);
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
    analogCache.invalidate();
    digitalCache.invalidate();
    motorCache.invalidate();
    stateCache.invalidate();
    errCache.invalidate();
    accelCache.invalidate();
    buttonCache.invalidate();
    ldsCache.invalidate();
}

// -- Action command convenience methods --------------------------------------

bool NeatoSerial::clean(const String& action, std::function<void(bool)> callback) {
    // Determine the correct command based on action AND current robot state.
    // The Neato serial protocol behaves differently from the physical button:
    //   - Bare "Clean" = equivalent to pressing Start button (house clean start/resume)
    //   - "Clean House" = explicitly starts a NEW house clean (triggers "new cleaning" sound)
    //   - "Clean Spot" = starts or resumes a spot clean
    //   - "Clean Stop" = pause (first) or stop (second)
    // To match button behavior, we use bare "Clean" for house start and resume,
    // and "Clean Spot" for spot start and resume (matches ESPHome community integrations).

    if (action == "stop") {
        // Check cached state BEFORE invalidating — invalidate() clears hasCached().
        bool isRunning = stateCache.hasCached() && stateCache.getCached().uiState.indexOf("CLEANINGRUNNING") >= 0;
        invalidateState();

        if (isRunning) {
            // Pause (RUNNING -> PAUSED): SetUIError dance required.
            // The D7 (firmware 4.6.0) does not transition its UI state machine to
            // PAUSED after a bare "Clean Stop" — GetState keeps reporting RUNNING
            // even though the robot physically stops.  The SetUIError setalert /
            // clearalert dance nudges the state machine so it reports the correct
            // CLEANINGPAUSED state on the next GetState poll.
            bool ok = enqueue(CMD_CLEAN_STOP, nullptr);
            ok = ok && enqueue(CMD_SET_UI_ERROR_SET_ALERT, nullptr);
            ok = ok && enqueue(CMD_SET_UI_ERROR_CLEAR_ALERT, wrapAction(callback));
            return ok;
        }
        // Stop (PAUSED -> IDLE): plain Clean Stop, no dance needed.
        return enqueue(CMD_CLEAN_STOP, wrapAction(callback));
    }

    // House or Spot start/resume: use bare "Clean" for house (matches physical button),
    // "Clean Spot" for spot.
    const char *cmd = (action == "spot") ? CMD_CLEAN_SPOT : CMD_CLEAN;
    invalidateState();
    return enqueue(cmd, wrapAction(callback));
}

bool NeatoSerial::testMode(bool enable, std::function<void(bool)> callback) {
    const char *cmd = enable ? CMD_TEST_MODE_ON : CMD_TEST_MODE_OFF;
    invalidateState();
    return enqueue(cmd, wrapAction(callback));
}

bool NeatoSerial::playSound(SoundId soundId, std::function<void(bool)> callback) {
    String cmd = String(CMD_PLAY_SOUND) + " SoundID " + String(static_cast<int>(soundId));
    return enqueue(cmd, wrapAction(callback));
}

bool NeatoSerial::setLdsRotation(bool on, std::function<void(bool)> callback) {
    const char *cmd = on ? CMD_SET_LDS_ROTATION_ON : CMD_SET_LDS_ROTATION_OFF;
    return enqueue(cmd, wrapAction(callback));
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
