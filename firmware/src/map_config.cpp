#include "cleaning_history.h"

#include <SPIFFS.h>
#include <ctype.h>
#include <string.h>
#include "config.h"

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

    String path = sidecarPath(filename, ".map.json");
    if (!SPIFFS.exists(path))
        path += ".bak";
    File file = SPIFFS.open(path, FILE_READ);
    if (!file)
        return false;
    if (file.size() > MAP_CONFIG_MAX_BYTES) {
        file.close();
        return false;
    }
    json = file.readString();
    file.close();
    return !json.isEmpty();
}

static int mapConfigValueIndex(const String& json, const char *key) {
    int keyIndex = json.indexOf(String("\"") + key + "\"");
    if (keyIndex < 0)
        return -1;
    int colon = json.indexOf(':', keyIndex + strlen(key) + 2);
    if (colon < 0)
        return -1;
    int value = colon + 1;
    while (value < static_cast<int>(json.length()) && isspace(static_cast<unsigned char>(json.charAt(value))))
        value++;
    return value;
}

bool CleaningHistory::validateMapConfig(const String& json, String& error) {
    if (json.isEmpty() || json.length() > MAP_CONFIG_MAX_BYTES) {
        error = "map configuration is empty or too large";
        return false;
    }

    int start = 0;
    while (start < static_cast<int>(json.length()) && (json.charAt(start) == ' ' || json.charAt(start) == '\n' ||
                                                       json.charAt(start) == '\r' || json.charAt(start) == '\t'))
        start++;
    int versionValue = mapConfigValueIndex(json, "version");
    int zonesValue = mapConfigValueIndex(json, "zones");
    int noGoLinesValue = mapConfigValueIndex(json, "noGoLines");
    if (start >= static_cast<int>(json.length()) || json.charAt(start) != '{' || versionValue < 0 || zonesValue < 0 ||
        noGoLinesValue < 0 || json.charAt(versionValue) != '1' || json.charAt(zonesValue) != '[' ||
        json.charAt(noGoLinesValue) != '[') {
        error = "map configuration requires version 1, zones array, and noGoLines array";
        return false;
    }

    bool inString = false;
    bool escaped = false;
    int braces = 0;
    int brackets = 0;
    bool rootClosed = false;
    for (int i = start; i < static_cast<int>(json.length()); i++) {
        char c = json.charAt(i);
        if (rootClosed) {
            if (!isspace(static_cast<unsigned char>(c))) {
                error = "unexpected data after map configuration";
                return false;
            }
            continue;
        }
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                inString = false;
            }
            continue;
        }
        if (c == '"') {
            inString = true;
        } else if (c == '{') {
            braces++;
        } else if (c == '}') {
            if (--braces < 0) {
                error = "unbalanced map configuration";
                return false;
            }
            if (braces == 0)
                rootClosed = true;
        } else if (c == '[') {
            brackets++;
        } else if (c == ']') {
            if (--brackets < 0) {
                error = "unbalanced map configuration";
                return false;
            }
        }
    }

    if (inString || !rootClosed || braces != 0 || brackets != 0) {
        error = "unbalanced map configuration";
        return false;
    }
    return true;
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
