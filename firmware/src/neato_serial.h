#ifndef NEATO_SERIAL_H
#define NEATO_SERIAL_H

#include <Arduino.h>
#include <functional>
#include <vector>
#include "config.h"
#include "loop_task.h"
#include "neato_commands.h"
#include "async_cache.h"

// Internal queue entry — raw callback wraps the typed one
struct CommandEntry {
    String command;
    uint8_t priority;
    std::function<void(bool, const String&)> callback;
};

enum CommandPriority : uint8_t {
    PRIORITY_CRITICAL = 1,
    PRIORITY_HIGH = 2,
    PRIORITY_MEDIUM = 3,
    PRIORITY_NORMAL = 4,
};

enum QueueState { QUEUE_IDLE, QUEUE_SENDING, QUEUE_WAITING_RESPONSE, QUEUE_INTER_DELAY };

class NeatoSerial : public LoopTask {
public:
    NeatoSerial();
    void begin(int txPin, int rxPin);

    // Fetch GetVersion, extract serial number, and compute the SetEvent SKey.
    // Driven automatically by tick() — first attempt fires on the first loop
    // iteration, with exponential backoff retries on failure (robot may still
    // be booting). The SKey is required for all cleaning control commands.
    void initSKey();
    bool hasSKey() const { return sKey.length() > 0; }

    // Model name extracted from GetVersion at boot (e.g. "Botvac D7")
    const String& getModelName() const { return robotModelName; }

    // True while initSKey is still retrying (robot not yet identified)
    bool isIdentifying() const { return sKeyPending; }

    // -- Sensor queries (typed callbacks) ------------------------------------
    // These are transparently cached: concurrent requests are coalesced,
    // and results within the TTL window are served from cache.

    void getVersion(std::function<void(bool, const VersionData&)> callback);
    void getCharger(std::function<void(bool, const ChargerData&)> callback);
    void getUserSettings(std::function<void(bool, const UserSettingsData&)> callback);
    void getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback);
    void getDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback, CommandPriority priority);
    void getMotors(std::function<void(bool, const MotorData&)> callback);
    void getMotors(std::function<void(bool, const MotorData&)> callback, CommandPriority priority);
    void getState(std::function<void(bool, const RobotState&)> callback);
    void getErr(std::function<void(bool, const ErrorData&)> callback);
    void getErrClear(std::function<void(bool, const ErrorData&)> callback);
    void getLdsScan(std::function<void(bool, const LdsScanData&)> callback);
    void getRobotPos(bool smooth, std::function<void(bool, const RobotPosData&)> callback);
    // -- Action commands (fire-and-forget by default) ------------------------

    bool clean(const String& action, std::function<void(bool)> callback = nullptr);
    bool testMode(bool enable, std::function<void(bool)> callback = nullptr);
    bool playSound(SoundId soundId, std::function<void(bool)> callback = nullptr);
    bool setLdsRotation(bool on, std::function<void(bool)> callback = nullptr);
    bool setMotorWheels(int leftMM, int rightMM, int speedMMs, std::function<void(bool)> callback = nullptr);
    bool setMotorBrush(int rpm, std::function<void(bool)> callback = nullptr);
    bool setMotorVacuum(bool on, int speedPercent = 80, std::function<void(bool)> callback = nullptr);
    bool setMotorSideBrush(bool on, int powerMw = 5000, std::function<void(bool)> callback = nullptr);
    bool setTime(int dayOfWeek, int hour, int min, int sec, std::function<void(bool)> callback = nullptr);

    // Set a single robot user setting via "SetUserSettings <key> <value>".
    // Invalidates the user settings cache.
    bool setUserSetting(const String& key, const String& value, std::function<void(bool)> callback = nullptr);

    // Power control: sends TestMode On, then SetSystemMode after inter-command delay.
    // action = "restart" (PowerCycle) or "shutdown" (Shutdown).
    bool powerControl(const String& action, std::function<void(bool)> callback = nullptr);

    // -- Raw command (temporary debug endpoint) --------------------------------
    bool sendRaw(const String& cmd, std::function<void(bool, const String&)> callback);

    // -- Time query --------------------------------------------------------------

    bool getTime(std::function<void(bool, const TimeData&)> callback);

    // -- Cache invalidation --------------------------------------------------
    // Call after actions that change robot state (cleaning, test mode, etc.)
    // so the next poll fetches fresh data instead of returning stale cache.

    void invalidateState();
    void invalidateAll();

    // -- Manual clean state override -----------------------------------------
    // When set, getState() patches uiState to "UIMGR_STATE_MANUALCLEANING"
    // since the robot reports TESTMODE during manual clean.
    void setManualCleanActive(bool active) { manualCleanActive = active; }

    // -- Logger hook ---------------------------------------------------------

    // Callback: (command, status, elapsed_ms, raw_response, queue_depth_before, response_bytes, cache_age_ms)
    // cache_age_ms: 0 = fresh serial fetch, >0 = served from cache (age in ms)
    using LoggerCallback =
            std::function<void(const String&, CommandStatus, unsigned long, const String&, int, size_t, unsigned long)>;
    void setLogger(LoggerCallback logger) { loggerCallback = logger; }

    // -- Clean start hook ----------------------------------------------------
    // Called from clean() when a new cleaning session starts (house/spot).
    // Used by CleaningHistory to switch to active polling immediately.
    void onCleanStart(std::function<void()> cb) { cleanStartCallback = cb; }

    // -- Status --------------------------------------------------------------

    bool isBusy() const { return state != QUEUE_IDLE || !queue.empty(); }
    int queueDepth() const { return static_cast<int>(queue.size()); }

private:
    void tick() override; // Called every loop() iteration (intervalMs = 0 — UART state machine)

    HardwareSerial& uart = Serial1;
    std::vector<CommandEntry> queue;
    QueueState state = QUEUE_IDLE;
    bool manualCleanActive = false;

    // SetEvent security key (computed from robot serial number at boot)
    String sKey;

    // Robot model name extracted from GetVersion at boot
    String robotModelName;

    // initSKey retry state — retries with exponential backoff if GetVersion
    // fails at boot (e.g. robot still booting, UART not ready yet).
    bool sKeyPending = true;
    unsigned long sKeyRetryAt = 0;
    unsigned long sKeyRetryDelay = SKEY_RETRY_INITIAL_MS;

    // Build a SetEvent command string: "SetEvent event <evt> SKey <sKey>"
    String buildSetEvent(const char *event) const;

    // Logger hook
    LoggerCallback loggerCallback;

    // Clean start hook
    std::function<void()> cleanStartCallback;

    // Current command in flight
    String currentCommand;
    String responseBuffer;
    std::function<void(bool, const String&)> currentCallback;
    unsigned long commandSentAt = 0;
    unsigned long delayStartedAt = 0;
    int queueDepthAtStart = 0; // Queue depth when current command started

    // Enqueue a raw command with callback and priority.
    // Lower number = higher priority (1 highest).
    bool enqueue(const String& command, std::function<void(bool, const String&)> callback,
                 CommandPriority priority = PRIORITY_NORMAL);

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
    AsyncCache<DigitalSensorData> digitalCache;
    AsyncCache<MotorData> motorCache;
    AsyncCache<RobotState> stateCache;
    AsyncCache<ErrorData> errCache;
    AsyncCache<LdsScanData> ldsCache;
    AsyncCache<RobotPosData> robotPosRawCache;
    AsyncCache<RobotPosData> robotPosSmoothCache;
    AsyncCache<UserSettingsData> userSettingsCache;

    // Raw (uncached) fetch methods — enqueue the command and parse response
    void fetchVersion(std::function<void(bool, const VersionData&)> callback);
    void fetchCharger(std::function<void(bool, const ChargerData&)> callback);
    void fetchDigitalSensors(std::function<void(bool, const DigitalSensorData&)> callback,
                             CommandPriority priority = PRIORITY_NORMAL);
    void fetchMotors(std::function<void(bool, const MotorData&)> callback, CommandPriority priority = PRIORITY_NORMAL);
    void fetchState(std::function<void(bool, const RobotState&)> callback);
    void fetchErr(std::function<void(bool, const ErrorData&)> callback);
    void fetchErrClear(std::function<void(bool, const ErrorData&)> callback);
    void fetchLdsScan(std::function<void(bool, const LdsScanData&)> callback);
    void fetchRobotPos(const char *cmd, std::function<void(bool, const RobotPosData&)> callback);
    void fetchUserSettings(std::function<void(bool, const UserSettingsData&)> callback);
};

#endif // NEATO_SERIAL_H
