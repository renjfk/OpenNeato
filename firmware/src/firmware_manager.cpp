#include "firmware_manager.h"

bool FirmwareManager::beginUpdate(const String& md5Hash) {
    currentProgress = 0;
    updateError = "";

    if (!md5Hash.isEmpty()) {
        if (!Update.setMD5(md5Hash.c_str())) {
            updateError = "MD5 parameter invalid";
            LOG("FW", "%s", updateError.c_str());
            return false;
        }
        LOG("FW", "MD5 hash set: %s", md5Hash.c_str());
    }

    LOG("FW", "Update started");
    updateInProgress = true;
    if (loggerCallback) {
        loggerCallback("start", {});
    }

    if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
        StreamString err;
        Update.printError(err);
        updateError = err.c_str();
        LOG("FW", "Failed to start: %s", updateError.c_str());
        updateInProgress = false;
        return false;
    }

    return true;
}

bool FirmwareManager::writeChunk(uint8_t *data, size_t len) {
    if (updateError.length()) {
        return false;
    }

    if (len && Update.write(data, len) != len) {
        StreamString err;
        Update.printError(err);
        updateError = err.c_str();
        LOG("FW", "Write error: %s", updateError.c_str());
        return false;
    }

    currentProgress += len;
    return true;
}

bool FirmwareManager::endUpdate() {
    if (!Update.end(true)) {
        StreamString err;
        Update.printError(err);
        updateError = err.c_str();
        LOG("FW", "Finalize error: %s", updateError.c_str());
        return false;
    }

    LOG("FW", "Update successful (%zu bytes)", currentProgress);

    if (loggerCallback) {
        loggerCallback("end", {{"ok", "true", FIELD_BOOL}});
    }

    rebootRequestMs = millis();
    rebootPending = true;
    return true;
}

void FirmwareManager::loop() {
    if (rebootPending && millis() - rebootRequestMs > 2000) {
        LOG("FW", "Rebooting...");
        ESP.restart();
    }
}
