#ifndef NEATO_SERIAL_H
#define NEATO_SERIAL_H

#include <Arduino.h>
#include <functional>
#include <vector>
#include "config.h"
#include "neato_commands.h"

// Internal queue entry — raw callback wraps the typed one
struct CommandEntry {
    String command;
    std::function<void(bool, const String&)> callback;
    unsigned long timeoutMs;
};

enum QueueState { QUEUE_IDLE, QUEUE_SENDING, QUEUE_WAITING_RESPONSE, QUEUE_INTER_DELAY };

class NeatoSerial {
public:
    void begin();
    void loop();

    // -- Sensor queries (typed callbacks) ------------------------------------

    bool getVersion(std::function<void(bool, const VersionData&)> callback);
    bool getCharger(std::function<void(bool, const ChargerData&)> callback);
    bool getAnalogSensors(std::function<void(bool, const AnalogSensorData&)> callback);
    bool getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback);
    bool getMotors(std::function<void(bool, const MotorData&)> callback);
    bool getState(std::function<void(bool, const RobotState&)> callback);
    bool getErr(std::function<void(bool, const ErrorData&)> callback);
    bool getErrClear(std::function<void(bool, const ErrorData&)> callback);
    bool getLdsScan(std::function<void(bool, const LdsScanData&)> callback);
    bool getAccel(std::function<void(bool, const AccelData&)> callback);
    bool getButtons(std::function<void(bool, const ButtonData&)> callback);

    // -- Action commands (fire-and-forget by default) ------------------------

    bool cleanHouse(std::function<void(bool)> callback = nullptr);
    bool cleanSpot(std::function<void(bool)> callback = nullptr);
    bool cleanStop(std::function<void(bool)> callback = nullptr);
    bool testModeOn(std::function<void(bool)> callback = nullptr);
    bool testModeOff(std::function<void(bool)> callback = nullptr);
    bool playSound(SoundId soundId, std::function<void(bool)> callback = nullptr);
    bool setLdsRotation(bool on, std::function<void(bool)> callback = nullptr);
    bool setTime(int dayOfWeek, int hour, int min, int sec, std::function<void(bool)> callback = nullptr);

    // -- Time query --------------------------------------------------------------

    bool getTime(std::function<void(bool, const TimeData&)> callback);

    // -- Logger hook ---------------------------------------------------------

    // Callback: (command, status, elapsed_ms, raw_response, queue_depth_before, response_bytes)
    using LoggerCallback = std::function<void(const String&, CommandStatus, unsigned long, const String&, int, size_t)>;
    void setLogger(LoggerCallback logger) { loggerCallback = logger; }

    // -- Status --------------------------------------------------------------

    bool isBusy() const { return state != QUEUE_IDLE || !queue.empty(); }
    int queueDepth() const { return static_cast<int>(queue.size()); }

private:
    HardwareSerial& uart = Serial1;
    std::vector<CommandEntry> queue;
    QueueState state = QUEUE_IDLE;

    // Logger hook
    LoggerCallback loggerCallback;

    // Current command in flight
    String currentCommand;
    String responseBuffer;
    std::function<void(bool, const String&)> currentCallback;
    unsigned long currentTimeout = 0;
    unsigned long commandSentAt = 0;
    unsigned long delayStartedAt = 0;
    int queueDepthAtStart = 0; // Queue depth when current command started

    // Enqueue a raw command with callback
    bool enqueue(const String& command, unsigned long timeoutMs, std::function<void(bool, const String&)> callback);

    // Wrap action command callback (just success/fail, no response body)
    static std::function<void(bool, const String&)> wrapAction(std::function<void(bool)> callback);

    void dequeueNext();
    void sendCurrentCommand();
    void completeCommand(CommandStatus status, const String& response);
};

#endif // NEATO_SERIAL_H
