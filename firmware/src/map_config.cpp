#include "cleaning_history.h"

#include <SPIFFS.h>
#include <ctype.h>
#include <string.h>
#include "config.h"
#include "map_config_parser.h"

bool CleaningHistory::isSessionFilename(const String& filename) {
    return filename.length() > 6 && filename.indexOf('/') < 0 && filename.indexOf('\\') < 0 &&
           (filename.endsWith(".jsonl") || filename.endsWith(".jsonl.hs"));
}

String CleaningHistory::sidecarPath(const String& filename, const char *suffix) {
    return String(HISTORY_DIR) + "/" + filename + suffix;
}

bool CleaningHistory::hasSession(const String& filename) const {
    return isSessionFilename(filename) && SPIFFS.exists(String(HISTORY_DIR) + "/" + filename);
}

bool CleaningHistory::isPinned(const String& filename) const {
    return isSessionFilename(filename) && SPIFFS.exists(sidecarPath(filename, ".pin"));
}

bool CleaningHistory::hasMapConfig(const String& filename) const {
    return isSessionFilename(filename) &&
           (SPIFFS.exists(sidecarPath(filename, ".map.json")) || SPIFFS.exists(sidecarPath(filename, ".map.json.bak")));
}

bool CleaningHistory::setPinned(const String& filename, bool pinned) {
    if (!hasSession(filename))
        return false;

    String path = sidecarPath(filename, ".pin");
    if (!pinned) {
        return !SPIFFS.exists(path) || SPIFFS.remove(path);
    }

    File marker = SPIFFS.open(path, FILE_WRITE);
    if (!marker)
        return false;
    bool ok = marker.print("1") == 1;
    marker.close();
    return ok;
}

bool CleaningHistory::readMapConfig(const String& filename, String& json) const {
    json = "";
    if (!hasMapConfig(filename))
        return false;

    String primaryPath = sidecarPath(filename, ".map.json");
    String backupPath = primaryPath + ".bak";
    auto readValidFile = [&json](const String& path) {
        if (!SPIFFS.exists(path))
            return false;
        File file = SPIFFS.open(path, FILE_READ);
        if (!file)
            return false;
        size_t expectedSize = file.size();
        if (expectedSize == 0 || expectedSize > MAP_CONFIG_MAX_BYTES) {
            file.close();
            return false;
        }
        String candidate = file.readString();
        file.close();
        if (candidate.length() != expectedSize)
            return false;
        String validationError;
        if (!CleaningHistory::validateMapConfig(candidate, validationError))
            return false;
        json = candidate;
        return true;
    };

    if (readValidFile(primaryPath))
        return true;
    if (!readValidFile(backupPath))
        return false;

    // Missing primary means power was lost between the two atomic renames. A corrupt primary
    // is retained for diagnosis, while the valid backup remains available for future reads.
    if (!SPIFFS.exists(primaryPath))
        SPIFFS.rename(backupPath, primaryPath);
    return true;
}

bool CleaningHistory::validateMapConfig(const String& json, String& error) {
    if (json.isEmpty() || json.length() > MAP_CONFIG_MAX_BYTES) {
        error = "map configuration is empty or too large";
        return false;
    }
    return parseMapConfig(json, error);
}

bool CleaningHistory::writeMapConfig(const String& filename, const String& json, String& error) {
    if (!hasSession(filename)) {
        error = "session not found";
        return false;
    }
    if (!validateMapConfig(json, error))
        return false;

    String path = sidecarPath(filename, ".map.json");
    String tempPath = path + ".tmp";
    String backupPath = path + ".bak";
    SPIFFS.remove(tempPath);
    if (!SPIFFS.exists(path) && SPIFFS.exists(backupPath) && !SPIFFS.rename(backupPath, path)) {
        error = "could not recover existing map configuration";
        return false;
    }
    if (SPIFFS.exists(path))
        SPIFFS.remove(backupPath);

    File file = SPIFFS.open(tempPath, FILE_WRITE);
    if (!file) {
        error = "could not create map configuration";
        return false;
    }
    size_t written = file.write(reinterpret_cast<const uint8_t *>(json.c_str()), json.length());
    file.flush();
    file.close();
    if (written != json.length()) {
        SPIFFS.remove(tempPath);
        error = "could not write complete map configuration";
        return false;
    }

    bool hadConfig = SPIFFS.exists(path);
    if (hadConfig && !SPIFFS.rename(path, backupPath)) {
        SPIFFS.remove(tempPath);
        error = "could not preserve existing map configuration";
        return false;
    }
    if (!SPIFFS.rename(tempPath, path)) {
        SPIFFS.remove(tempPath);
        if (hadConfig)
            SPIFFS.rename(backupPath, path);
        error = "could not activate map configuration";
        return false;
    }
    if (!setPinned(filename, true)) {
        SPIFFS.remove(path);
        if (hadConfig)
            SPIFFS.rename(backupPath, path);
        error = "could not pin session";
        return false;
    }
    SPIFFS.remove(backupPath);
    return true;
}
