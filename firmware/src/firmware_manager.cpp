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

bool FirmwareManager::beginUpdate(const String& md5Hash) {
    currentProgress = 0;
    chipValidated = false;
    updateError = "";

    // Abort any stale Update from a previous failed attempt — the ESP32
    // Update singleton keeps _size > 0 after a failed upload, which causes
    // subsequent begin() calls to silently fail with "already running".
    if (Update.isRunning()) {
        Update.abort();
        LOG("FW", "Aborted stale update from previous attempt");
    }

    if (md5Hash.isEmpty()) {
        updateError = "MD5 hash required";
        LOG("FW", "%s", updateError.c_str());
        return false;
    }
    if (!Update.setMD5(md5Hash.c_str())) {
        updateError = "MD5 parameter invalid";
        LOG("FW", "%s", updateError.c_str());
        return false;
    }
    LOG("FW", "MD5 hash set: %s", md5Hash.c_str());

    LOG("FW", "Update started");
    updateInProgress = true;
    dataLogger.logOta("start", {});

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

    // Validate chip ID from image header on first chunk
    if (!chipValidated && len >= 16) {
        if (!validateChip(data, len)) {
            Update.abort();
            updateInProgress = false;
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

    dataLogger.logOta("end", {{"ok", "true", FIELD_BOOL}});

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
