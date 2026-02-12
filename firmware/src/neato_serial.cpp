#include "neato_serial.h"
#include "config.h"

// -- Lifecycle ---------------------------------------------------------------

void NeatoSerial::begin() {
    uart.begin(NEATO_BAUD_RATE, SERIAL_8N1, NEATO_RX_PIN, NEATO_TX_PIN);
    LOG("NEATO", "UART initialized (TX=%d, RX=%d, baud=%d)", NEATO_TX_PIN, NEATO_RX_PIN, NEATO_BAUD_RATE);
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
                    completeCommand(CMD_SUCCESS, responseBuffer);
                    return;
                }
                responseBuffer += c;
            }
            // Check timeout
            if (millis() - commandSentAt >= currentTimeout) {
                LOG("NEATO", "Timeout: %s (%lu ms, partial: %u bytes)", currentCommand.c_str(), currentTimeout,
                    responseBuffer.length());
                // Log partial response on timeout (useful for debugging serial issues)
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

bool NeatoSerial::enqueue(const String& command, unsigned long timeoutMs,
                          std::function<void(bool, const String&)> callback) {
    if (static_cast<int>(queue.size()) >= NEATO_QUEUE_MAX_SIZE) {
        LOG("NEATO", "Queue full, rejecting: %s", command.c_str());
        if (callback)
            callback(false, "");
        return false;
    }
    queue.push_back({command, callback, timeoutMs});
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
    currentTimeout = entry.timeoutMs;
    responseBuffer = "";

    state = QUEUE_SENDING;
}

void NeatoSerial::sendCurrentCommand() {
    LOG("NEATO", "TX: %s", currentCommand.c_str());
    uart.print(currentCommand + "\n");
    commandSentAt = millis();
    state = QUEUE_WAITING_RESPONSE;
}

void NeatoSerial::completeCommand(CommandStatus status, const String& response) {
    unsigned long elapsed = millis() - commandSentAt;
    String cmd = currentCommand;
    auto cb = currentCallback;
    int qDepth = queueDepthAtStart;
    size_t respBytes = response.length();

    currentCommand = "";
    currentCallback = nullptr;
    responseBuffer = "";
    queueDepthAtStart = 0;

    // Start inter-command delay before next command
    delayStartedAt = millis();
    state = QUEUE_INTER_DELAY;

    // Fire logger hook before user callback with enhanced metadata
    if (loggerCallback)
        loggerCallback(cmd, status, elapsed, response, qDepth, respBytes);

    // User callback still gets simple bool for backward compatibility
    bool success = (status == CMD_SUCCESS);
    if (cb)
        cb(success, response);
}

// -- Sensor query convenience methods ----------------------------------------

bool NeatoSerial::getVersion(std::function<void(bool, const VersionData&)> callback) {
    return enqueue(commandToString(CMD_GET_VERSION), commandTimeout(CMD_GET_VERSION),
                   [callback](bool ok, const String& raw) {
                       VersionData data;
                       if (ok)
                           ok = parseVersionData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getCharger(std::function<void(bool, const ChargerData&)> callback) {
    return enqueue(commandToString(CMD_GET_CHARGER), commandTimeout(CMD_GET_CHARGER),
                   [callback](bool ok, const String& raw) {
                       ChargerData data;
                       if (ok)
                           ok = parseChargerData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getAnalogSensors(std::function<void(bool, const AnalogSensorData&)> callback) {
    return enqueue(commandToString(CMD_GET_ANALOG_SENSORS), commandTimeout(CMD_GET_ANALOG_SENSORS),
                   [callback](bool ok, const String& raw) {
                       AnalogSensorData data;
                       if (ok)
                           ok = parseAnalogSensorData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback) {
    return enqueue(commandToString(CMD_GET_DIGITAL_SENSORS), commandTimeout(CMD_GET_DIGITAL_SENSORS),
                   [callback](bool ok, const String& raw) {
                       DigitalSensorData data;
                       if (ok)
                           ok = parseDigitalSensorData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getMotors(std::function<void(bool, const MotorData&)> callback) {
    return enqueue(commandToString(CMD_GET_MOTORS), commandTimeout(CMD_GET_MOTORS),
                   [callback](bool ok, const String& raw) {
                       MotorData data;
                       if (ok)
                           ok = parseMotorData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getState(std::function<void(bool, const RobotState&)> callback) {
    return enqueue(commandToString(CMD_GET_STATE), commandTimeout(CMD_GET_STATE),
                   [callback](bool ok, const String& raw) {
                       RobotState data;
                       if (ok)
                           ok = parseRobotState(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getErr(std::function<void(bool, const ErrorData&)> callback) {
    return enqueue(commandToString(CMD_GET_ERR), commandTimeout(CMD_GET_ERR), [callback](bool ok, const String& raw) {
        ErrorData data;
        if (ok)
            ok = parseErrorData(raw, data);
        if (callback)
            callback(ok, data);
    });
}

bool NeatoSerial::getErrClear(std::function<void(bool, const ErrorData&)> callback) {
    return enqueue(commandToString(CMD_GET_ERR_CLEAR), commandTimeout(CMD_GET_ERR_CLEAR),
                   [callback](bool ok, const String& raw) {
                       ErrorData data;
                       if (ok)
                           ok = parseErrorData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getLdsScan(std::function<void(bool, const LdsScanData&)> callback) {
    return enqueue(commandToString(CMD_GET_LDS_SCAN), commandTimeout(CMD_GET_LDS_SCAN),
                   [callback](bool ok, const String& raw) {
                       LdsScanData data;
                       if (ok)
                           ok = parseLdsScanData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getAccel(std::function<void(bool, const AccelData&)> callback) {
    return enqueue(commandToString(CMD_GET_ACCEL), commandTimeout(CMD_GET_ACCEL),
                   [callback](bool ok, const String& raw) {
                       AccelData data;
                       if (ok)
                           ok = parseAccelData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

bool NeatoSerial::getButtons(std::function<void(bool, const ButtonData&)> callback) {
    return enqueue(commandToString(CMD_GET_BUTTONS), commandTimeout(CMD_GET_BUTTONS),
                   [callback](bool ok, const String& raw) {
                       ButtonData data;
                       if (ok)
                           ok = parseButtonData(raw, data);
                       if (callback)
                           callback(ok, data);
                   });
}

// -- Action command convenience methods --------------------------------------

bool NeatoSerial::cleanHouse(std::function<void(bool)> callback) {
    return enqueue(commandToString(CMD_CLEAN_HOUSE), commandTimeout(CMD_CLEAN_HOUSE), wrapAction(callback));
}

bool NeatoSerial::cleanSpot(std::function<void(bool)> callback) {
    return enqueue(commandToString(CMD_CLEAN_SPOT), commandTimeout(CMD_CLEAN_SPOT), wrapAction(callback));
}

bool NeatoSerial::cleanStop(std::function<void(bool)> callback) {
    return enqueue(commandToString(CMD_CLEAN_STOP), commandTimeout(CMD_CLEAN_STOP), wrapAction(callback));
}

bool NeatoSerial::testModeOn(std::function<void(bool)> callback) {
    return enqueue(commandToString(CMD_TEST_MODE_ON), commandTimeout(CMD_TEST_MODE_ON), wrapAction(callback));
}

bool NeatoSerial::testModeOff(std::function<void(bool)> callback) {
    return enqueue(commandToString(CMD_TEST_MODE_OFF), commandTimeout(CMD_TEST_MODE_OFF), wrapAction(callback));
}

bool NeatoSerial::playSound(SoundId soundId, std::function<void(bool)> callback) {
    String cmd = String(commandToString(CMD_PLAY_SOUND)) + " SoundID " + String(static_cast<int>(soundId));
    return enqueue(cmd, commandTimeout(CMD_PLAY_SOUND), wrapAction(callback));
}

bool NeatoSerial::setLdsRotation(bool on, std::function<void(bool)> callback) {
    NeatoCommand cmd = on ? CMD_SET_LDS_ROTATION_ON : CMD_SET_LDS_ROTATION_OFF;
    return enqueue(commandToString(cmd), commandTimeout(cmd), wrapAction(callback));
}

// -- Time commands -----------------------------------------------------------

bool NeatoSerial::getTime(std::function<void(bool, const TimeData&)> callback) {
    return enqueue(commandToString(CMD_GET_TIME), commandTimeout(CMD_GET_TIME), [callback](bool ok, const String& raw) {
        TimeData data;
        if (ok)
            ok = parseTimeData(raw, data);
        callback(ok, data);
    });
}

bool NeatoSerial::setTime(int dayOfWeek, int hour, int min, int sec, std::function<void(bool)> callback) {
    String cmd = String(commandToString(CMD_SET_TIME)) + " Day " + String(dayOfWeek) + " Hour " + String(hour) +
                 " Min " + String(min) + " Sec " + String(sec);
    return enqueue(cmd, commandTimeout(CMD_SET_TIME), wrapAction(callback));
}
