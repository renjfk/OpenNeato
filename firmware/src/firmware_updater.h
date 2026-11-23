#ifndef FIRMWARE_UPDATER_H
#define FIRMWARE_UPDATER_H

#include <Arduino.h>
#include <functional>
#include "config.h"
#include "loop_task.h"

class DataLogger;
class SettingsManager;
class FirmwareManager;
class NeatoSerial;

// Automatic (unattended) firmware updates from the signed release feed.
//
// The device asks the release host for the newest stable release of its own
// board over plain HTTP, and trusts the answer only because every release
// carries an ECDSA token compiled into the firmware (see update_verifier.h).
// A man in the middle can therefore only refuse to serve an update, never
// change one.
//
// Attempts run only while the robot is docked and idle, and prereleases are
// never installed this way: those are offered in the web UI for an explicit
// click.
class FirmwareUpdater : public LoopTask {
public:
    FirmwareUpdater(DataLogger& logger, SettingsManager& settings, FirmwareManager& fw, NeatoSerial& serial);

    // Run a check on the next tick (web UI "check now", boot).
    void requestCheck();

private:
    void tick() override;

    DataLogger& dataLogger;
    SettingsManager& settingsMgr;
    FirmwareManager& fwMgr;
    NeatoSerial& neato;

    // Last known robot state, refreshed from the serial cache each tick.
    bool stateKnown = false;
    bool robotIdle = false;
    bool robotDocked = false;
    unsigned long stateRefreshAt = 0;

    bool checkRequested = false;
    bool gateBlocked = false;
    bool checkDue = true;
    // Elapsed-time scheduling: absolute deadlines break across the ~49-day
    // millis() wrap.
    unsigned long lastCheckAt = 0;
    unsigned long checkInterval = OTA_CHECK_INTERVAL_MS;

    void refreshRobotState();
    bool canInstallNow() const { return stateKnown && robotIdle && robotDocked; }

    bool checkForUpdate();
    bool downloadAndInstall(const String& url, const String& token, const String& expectedVersion);
};

#endif // FIRMWARE_UPDATER_H
