#include "cleaning_history.h"

#include <SPIFFS.h>
#include <ctype.h>
#include <string.h>
#include "config.h"
#include "map_config_parser.h"

namespace {
    bool readValidMapConfigFile(const String& path, String *json = nullptr) {
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
        if (!parseMapConfig(candidate, validationError))
            return false;
        if (json)
            *json = candidate;
        return true;
    }
} // namespace

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
    String primaryPath = sidecarPath(filename, ".map.json");
    return isSessionFilename(filename) &&
           (SPIFFS.exists(primaryPath) || SPIFFS.exists(primaryPath + ".bak") || SPIFFS.exists(primaryPath + ".old"));
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
    if (!ok)
        SPIFFS.remove(path);
    return ok;
}

bool CleaningHistory::readMapConfig(const String& filename, String& json) const {
    json = "";
    if (!hasMapConfig(filename))
        return false;

    String primaryPath = sidecarPath(filename, ".map.json");
    String backupPath = primaryPath + ".bak";
    if (readValidMapConfigFile(primaryPath, &json))
        return true;
    String recoveryPath = backupPath;
    if (!readValidMapConfigFile(backupPath, &json)) {
        recoveryPath = primaryPath + ".old";
        if (!readValidMapConfigFile(recoveryPath, &json))
            return false;
    }

    // Missing primary means power was lost between the two atomic renames. A corrupt primary
    // is retained for diagnosis, while the valid backup remains available for future reads.
    if (!SPIFFS.exists(primaryPath))
        SPIFFS.rename(recoveryPath, primaryPath);
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
    String oldBackupPath = path + ".old";
    SPIFFS.remove(tempPath);

    File file = SPIFFS.open(tempPath, FILE_WRITE);
    if (!file) {
        error = "could not create map configuration";
        return false;
    }
    size_t written = file.write(reinterpret_cast<const uint8_t *>(json.c_str()), json.length());
    file.flush();
    file.close();
    if (written != json.length() || !readValidMapConfigFile(tempPath)) {
        SPIFFS.remove(tempPath);
        error = "could not write complete map configuration";
        return false;
    }

    bool primaryExists = SPIFFS.exists(path);
    bool backupExists = SPIFFS.exists(backupPath);
    bool primaryValid = primaryExists && readValidMapConfigFile(path);
    bool backupValid = backupExists && readValidMapConfigFile(backupPath);
    bool oldBackupExists = SPIFFS.exists(oldBackupPath);
    bool oldBackupValid = oldBackupExists && readValidMapConfigFile(oldBackupPath);

    // Normalize a stale .old left by an interrupted rollback without discarding the only valid backup.
    if (oldBackupExists) {
        if (!backupValid && oldBackupValid) {
            if (backupExists && !SPIFFS.remove(backupPath)) {
                SPIFFS.remove(tempPath);
                error = "could not remove corrupt map configuration backup";
                return false;
            }
            if (!SPIFFS.rename(oldBackupPath, backupPath)) {
                SPIFFS.remove(tempPath);
                error = "could not recover map configuration backup";
                return false;
            }
            backupExists = true;
            backupValid = true;
        } else if (!SPIFFS.remove(oldBackupPath)) {
            SPIFFS.remove(tempPath);
            error = "could not clear stale map configuration backup";
            return false;
        }
    }

    bool wasPinned = isPinned(filename);
    if (!setPinned(filename, true)) {
        SPIFFS.remove(tempPath);
        error = "could not pin session";
        return false;
    }

    bool backupMovedAside = false;
    bool primaryMovedToBackup = false;
    if (primaryValid) {
        if (backupExists) {
            if (!SPIFFS.rename(backupPath, oldBackupPath)) {
                SPIFFS.remove(tempPath);
                if (!wasPinned)
                    setPinned(filename, false);
                error = "could not preserve map configuration backup";
                return false;
            }
            backupMovedAside = true;
        }
        if (!SPIFFS.rename(path, backupPath)) {
            if (backupMovedAside)
                SPIFFS.rename(oldBackupPath, backupPath);
            SPIFFS.remove(tempPath);
            if (!wasPinned)
                setPinned(filename, false);
            error = "could not preserve existing map configuration";
            return false;
        }
        primaryMovedToBackup = true;
    } else if (primaryExists) {
        // A corrupt primary is never useful for rollback. Preserve a valid backup in place.
        if (!SPIFFS.remove(path)) {
            SPIFFS.remove(tempPath);
            if (!wasPinned)
                setPinned(filename, false);
            error = "could not remove corrupt map configuration";
            return false;
        }
        if (backupExists && !backupValid)
            SPIFFS.remove(backupPath);
    }

    if (!SPIFFS.rename(tempPath, path)) {
        SPIFFS.remove(tempPath);
        if (primaryMovedToBackup) {
            SPIFFS.rename(backupPath, path);
            if (backupMovedAside)
                SPIFFS.rename(oldBackupPath, backupPath);
        }
        if (!wasPinned)
            setPinned(filename, false);
        error = "could not activate map configuration";
        return false;
    }

    // Activation and pinning succeeded. The immediately previous valid primary remains as .bak.
    if (backupMovedAside)
        SPIFFS.remove(oldBackupPath);
    return true;
}
