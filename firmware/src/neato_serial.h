#ifndef NEATO_SERIAL_H
#define NEATO_SERIAL_H

#include <Arduino.h>
#include <functional>
#include <vector>
#include "config.h"
#include "neato_commands.h"
#include "async_cache.h"

// Internal queue entry — raw callback wraps the typed one
struct CommandEntry {
    String command;
    std::function<void(bool, const String&)> callback;
    unsigned long timeoutMs;
};

enum QueueState { QUEUE_IDLE, QUEUE_SENDING, QUEUE_WAITING_RESPONSE, QUEUE_INTER_DELAY };

class NeatoSerial {
public:
    NeatoSerial();
    void begin(int txPin, int rxPin);
    void loop();

    // -- Sensor queries (typed callbacks) ------------------------------------
    // These are transparently cached: concurrent requests are coalesced,
    // and results within the TTL window are served from cache.

    void getVersion(std::function<void(bool, const VersionData&)> callback);
    void getCharger(std::function<void(bool, const ChargerData&)> callback);
    void getAnalogSensors(std::function<void(bool, const AnalogSensorData&)> callback);
    void getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback);
    void getMotors(std::function<void(bool, const MotorData&)> callback);
    void getState(std::function<void(bool, const RobotState&)> callback);
    void getErr(std::function<void(bool, const ErrorData&)> callback);
    void getErrClear(std::function<void(bool, const ErrorData&)> callback);
    void getLdsScan(std::function<void(bool, const LdsScanData&)> callback);
    void getAccel(std::function<void(bool, const AccelData&)> callback);
    void getButtons(std::function<void(bool, const ButtonData&)> callback);

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

    // -- Cache invalidation --------------------------------------------------
    // Call after actions that change robot state (cleaning, test mode, etc.)
    // so the next poll fetches fresh data instead of returning stale cache.

    void invalidateState();
    void invalidateAll();

    // -- Logger hook ---------------------------------------------------------

    // Callback: (command, status, elapsed_ms, raw_response, queue_depth_before, response_bytes, cache_age_ms)
    // cache_age_ms: 0 = fresh serial fetch, >0 = served from cache (age in ms)
    using LoggerCallback =
            std::function<void(const String&, CommandStatus, unsigned long, const String&, int, size_t, unsigned long)>;
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

    // Validate that the response starts with the expected command echo.
    // Returns true if the echo matches (or cannot be checked), false if desynced.
    bool validateResponseEcho(const String& response) const;

    // Drain all pending bytes from the UART receive buffer.
    void flushUartRx();

    // -- Async caches (one per sensor type) ----------------------------------
    // Each cache owns a fetch function that enqueues the serial command.

    AsyncCache<VersionData> versionCache;
    AsyncCache<ChargerData> chargerCache;
    AsyncCache<AnalogSensorData> analogCache;
    AsyncCache<DigitalSensorData> digitalCache;
    AsyncCache<MotorData> motorCache;
    AsyncCache<RobotState> stateCache;
    AsyncCache<ErrorData> errCache;
    AsyncCache<AccelData> accelCache;
    AsyncCache<ButtonData> buttonCache;
    AsyncCache<LdsScanData> ldsCache;

    // Raw (uncached) fetch methods — enqueue the command and parse response
    void fetchVersion(std::function<void(bool, const VersionData&)> callback);
    void fetchCharger(std::function<void(bool, const ChargerData&)> callback);
    void fetchAnalogSensors(std::function<void(bool, const AnalogSensorData&)> callback);
    void fetchDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback);
    void fetchMotors(std::function<void(bool, const MotorData&)> callback);
    void fetchState(std::function<void(bool, const RobotState&)> callback);
    void fetchErr(std::function<void(bool, const ErrorData&)> callback);
    void fetchErrClear(std::function<void(bool, const ErrorData&)> callback);
    void fetchAccel(std::function<void(bool, const AccelData&)> callback);
    void fetchButtons(std::function<void(bool, const ButtonData&)> callback);
    void fetchLdsScan(std::function<void(bool, const LdsScanData&)> callback);
};

#endif // NEATO_SERIAL_H
