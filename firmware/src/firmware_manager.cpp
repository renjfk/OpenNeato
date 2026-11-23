#include "firmware_manager.h"
#include "data_logger.h"
#include <esp_chip_info.h>

FirmwareManager::FirmwareManager(DataLogger& logger) : LoopTask(250), dataLogger(logger) {}

// ESP32 image extended header byte 12 contains the chip ID (ESP_CHIP_ID_*),
// which is a different enum from esp_chip_info_t::model (esp_chip_model_t).
// They happen to match for C3 (5) and S3 (9), but not for the original ESP32
// (header=0, model=1) or H2. Translate explicitly before comparing.
bool FirmwareManager::validateChip(uint8_t *data, size_t len) {
    if (len < 16) {
        return true; // Not enough data yet, defer validation
    }
    struct ChipMap {
        uint8_t headerId; // ESP_CHIP_ID_* from image header byte 12
        uint8_t model; // esp_chip_model_t value
    };
    static const ChipMap kChipMap[] = {
            {0x00, CHIP_ESP32},
            {0x02, CHIP_ESP32S2},
            {0x05, CHIP_ESP32C3},
            {0x09, CHIP_ESP32S3},
    };
    auto binChipId = static_cast<uint8_t>(data[12]);
    const ChipMap *match = nullptr;
    for (const auto& entry: kChipMap) {
        if (entry.headerId == binChipId) {
            match = &entry;
            break;
        }
    }
    if (!match) {
        updateError = "Firmware chip mismatch: unknown chip ID in image";
        LOG("FW", "Unknown binary chip ID: 0x%02X", binChipId);
        return false;
    }
    esp_chip_info_t info;
    esp_chip_info(&info);
    auto expected = static_cast<uint8_t>(info.model);
    if (match->model != expected) {
        updateError = "Firmware chip mismatch: file targets a different ESP32 variant";
        LOG("FW", "Chip mismatch: binary chip ID 0x%02X (model %u), expected model %u", binChipId, match->model,
            expected);
        return false;
    }
    LOG("FW", "Chip ID validated: 0x%02X (model %u)", binChipId, match->model);
    return true;
}

bool FirmwareManager::supportsSignedUpdates() const {
    return OTA_KEYS_ARE_RELEASE && updateKeysConfigured();
}

void FirmwareManager::releaseSession(uint32_t session) {
    portENTER_CRITICAL(&sessionMux);
    if (activeSession == session) {
        activeSession = 0;
    }
    portEXIT_CRITICAL(&sessionMux);
}

void FirmwareManager::abortUpdate(uint32_t session) {
    if (!ownsSession(session)) {
        return; // Never touch a session owned by another caller
    }
    if (Update.isRunning()) {
        Update.abort();
    }
    token.clear();
    chipValidated = false;
    currentProgress = 0;
    releaseSession(session);
}

uint32_t FirmwareManager::beginUpdate(const String& md5Hash, const String& tokenText, const String& expectedVersion,
                                      bool *busy) {
    if (busy) {
        *busy = false;
    }

    // Claim the flasher atomically: the web server and the automatic updater run
    // on different tasks, and on dual-core boards truly in parallel.
    uint32_t session = 0;
    portENTER_CRITICAL(&sessionMux);
    if (activeSession == 0) {
        session = nextSession++;
        if (nextSession == 0) {
            nextSession = 1;
        }
        activeSession = session;
    }
    portEXIT_CRITICAL(&sessionMux);

    if (!session) {
        if (busy) {
            *busy = true;
        }
        LOG("FW", "Update refused: another session is running");
        return 0;
    }

    currentProgress = 0;
    chipValidated = false;
    updateError = "";

    // Drop token state from an interrupted signed attempt, so a manual upload
    // never inherits its size or hash.
    token.clear();

    // Abort any stale Update from a previous failed attempt — the ESP32
    // Update singleton keeps _size > 0 after a failed upload, which causes
    // subsequent begin() calls to silently fail with "already running".
    if (Update.isRunning()) {
        Update.abort();
        LOG("FW", "Aborted stale update from previous attempt");
    }

    auto reject = [this, session](const String& reason) {
        updateError = reason;
        LOG("FW", "Update rejected: %s", reason.c_str());
        dataLogger.logOta("reject", {{"reason", reason, FIELD_STRING}});
        abortUpdate(session);
        return 0;
    };

    // A signed token takes precedence: it pins the exact image and version.
    if (!tokenText.isEmpty()) {
        String tokenError;
        if (!token.authorize(tokenText, tokenError, expectedVersion)) {
            return reject(tokenError);
        }
        LOG("FW", "Signed update accepted: version %s, %zu bytes", token.getVersion().c_str(), token.getSize());
        token.beginHash();
    } else {
        if (md5Hash.isEmpty()) {
            return reject("MD5 hash or update token required");
        }
        if (!Update.setMD5(md5Hash.c_str())) {
            return reject("MD5 parameter invalid");
        }
        LOG("FW", "MD5 hash set: %s", md5Hash.c_str());
    }

    LOG("FW", "Update started (session %lu)", static_cast<unsigned long>(session));
    dataLogger.logOta("start", {});

    // Reserve exactly the signed size when available, so a short or padded
    // image fails at end() instead of writing past the intended image.
    size_t expected = token.isActive() ? token.getSize() : UPDATE_SIZE_UNKNOWN;
    if (!Update.begin(expected, U_FLASH)) {
        StreamString err;
        Update.printError(err);
        updateError = err.c_str();
        LOG("FW", "Failed to start: %s", updateError.c_str());
        abortUpdate(session);
        return 0;
    }

    return session;
}

bool FirmwareManager::writeChunk(uint32_t session, uint8_t *data, size_t len) {
    if (!ownsSession(session)) {
        return false;
    }
    if (updateError.length()) {
        return false;
    }

    // Validate chip ID from image header on first chunk
    if (!chipValidated && len >= 16) {
        if (!validateChip(data, len)) {
            abortUpdate(session);
            return false;
        }
        chipValidated = true;
    }

    if (len && Update.write(data, len) != len) {
        StreamString err;
        Update.printError(err);
        updateError = err.c_str();
        LOG("FW", "Write error: %s", updateError.c_str());
        return false;
    }

    token.updateHash(data, len);
    currentProgress += len;
    return true;
}

bool FirmwareManager::endUpdate(uint32_t session) {
    if (!ownsSession(session)) {
        return false;
    }

    // Signature-implied hash check runs before end(), because end() commits the
    // image to the OTA slot.
    String hashError;
    if (!token.finishHash(hashError)) {
        updateError = hashError;
        abortUpdate(session);
        LOG("FW", "%s", updateError.c_str());
        dataLogger.logOta("reject", {{"reason", updateError, FIELD_STRING}});
        return false;
    }

    if (!Update.end(true)) {
        StreamString err;
        Update.printError(err);
        updateError = err.c_str();
        LOG("FW", "Finalize error: %s", updateError.c_str());
        abortUpdate(session);
        return false;
    }

    LOG("FW", "Update successful (%zu bytes)", currentProgress);

    dataLogger.logOta("end", {{"ok", "true", FIELD_BOOL}});

    // Keep the session claimed until the reboot so nothing else can start
    // writing to the slot in the meantime.
    rebootRequestMs = millis();
    rebootPending = true;
    return true;
}

void FirmwareManager::tick() {
    if (rebootPending && millis() - rebootRequestMs > 2000) {
        LOG("FW", "Rebooting...");
        ESP.restart();
    }
}
