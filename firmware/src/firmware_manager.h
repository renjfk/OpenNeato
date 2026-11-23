#ifndef FIRMWARE_MANAGER_H
#define FIRMWARE_MANAGER_H

#include <Arduino.h>
#include <Update.h>
#include <StreamString.h>
#include "config.h"
#include "loop_task.h"
#include "update_verifier.h"

class DataLogger;

// Owns the ESP32 Update singleton for exactly one session at a time.
//
// Web uploads arrive on the AsyncTCP task while an automatic install runs on the
// loop task, and on dual-core boards those run in parallel. Every operation is
// therefore tied to a session id returned by beginUpdate(): only the caller that
// claimed the session may write, finish, or abort it, and a second caller is
// refused instead of interrupting the first.
class FirmwareManager : public LoopTask {
public:
    explicit FirmwareManager(DataLogger& logger);

    // Version info
    const char *getFirmwareVersion() const { return FIRMWARE_VERSION; }
    const char *getChipModel() const { return CHIP_MODEL; }
    const char *getBoardId() const { return BOARD_ID; }

    // Update lifecycle. md5Hash is the legacy integrity check used by manual
    // uploads; token is the signed release token (empty for manual uploads).
    // An upload must be described by at least one of them. expectedVersion, when
    // set, must match the token's signed version (used by automatic updates).
    //
    // Returns a non-zero session id on success, 0 on failure. When another
    // session is running, *busy is set and updateError is left untouched.
    uint32_t beginUpdate(const String& md5Hash = "", const String& token = "", const String& expectedVersion = "",
                         bool *busy = nullptr);
    bool writeChunk(uint32_t session, uint8_t *data, size_t len);
    bool endUpdate(uint32_t session);

    // Abandon a session and release the flasher. Ignores ids that are not the
    // active session, so a stale caller cannot abort someone else's update.
    // Keeps updateError so the owner can report it.
    void abortUpdate(uint32_t session);

    bool ownsSession(uint32_t session) const { return session != 0 && session == activeSession; }

    // Signed updates are available on this build: release-pipeline firmware with
    // at least one compiled-in key.
    bool supportsSignedUpdates() const;

    // State queries
    bool isInProgress() const { return activeSession != 0; }
    size_t getProgress() const { return currentProgress; }
    const String& getError() const { return updateError; }

private:
    void tick() override; // Runs every 250ms — checks rebootPending flag

    DataLogger& dataLogger;
    UpdateToken token;

    // Session guard, shared by both tasks.
    portMUX_TYPE sessionMux = portMUX_INITIALIZER_UNLOCKED;
    volatile uint32_t activeSession = 0;
    uint32_t nextSession = 1;

    bool validateChip(uint8_t *data, size_t len);
    void releaseSession(uint32_t session);

    bool chipValidated = false;
    bool rebootPending = false;
    unsigned long rebootRequestMs = 0;
    size_t currentProgress = 0;
    String updateError;
};

#endif // FIRMWARE_MANAGER_H
