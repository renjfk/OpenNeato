#include "cleaning_history.h"

#include <SPIFFS.h>
#include "config.h"

bool CleaningHistory::isSessionFilename(const String& filename) {
    return filename.length() > 6 && filename.indexOf('/') < 0 && filename.indexOf('\\') < 0 &&
           (filename.endsWith(".jsonl") || filename.endsWith(".jsonl.hs"));
}

String CleaningHistory::sidecarPath(const String& filename, const char *suffix) {
    return String(HISTORY_DIR) + "/" + filename + suffix;
}

bool CleaningHistory::isPinned(const String& filename) const {
    return isSessionFilename(filename) && SPIFFS.exists(sidecarPath(filename, ".pin"));
}

bool CleaningHistory::hasMapConfig(const String& filename) const {
    return isSessionFilename(filename) && SPIFFS.exists(sidecarPath(filename, ".map.json"));
}

bool CleaningHistory::setPinned(const String& filename, bool pinned) {
    if (!isSessionFilename(filename) || !SPIFFS.exists(String(HISTORY_DIR) + "/" + filename))
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

    File file = SPIFFS.open(sidecarPath(filename, ".map.json"), FILE_READ);
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

bool CleaningHistory::validateMapConfig(const String& json, String& error) {
    if (json.isEmpty() || json.length() > MAP_CONFIG_MAX_BYTES) {
        error = "map configuration is empty or too large";
        return false;
    }

    int start = 0;
    while (start < static_cast<int>(json.length()) && (json.charAt(start) == ' ' || json.charAt(start) == '\n' ||
                                                       json.charAt(start) == '\r' || json.charAt(start) == '\t'))
        start++;
    if (start >= static_cast<int>(json.length()) || json.charAt(start) != '{' || json.indexOf("\"version\"") < 0 ||
        json.indexOf("\"zones\"") < 0 || json.indexOf("\"noGoLines\"") < 0) {
        error = "map configuration must contain version, zones, and noGoLines";
        return false;
    }

    bool inString = false;
    bool escaped = false;
    int braces = 0;
    int brackets = 0;
    for (int i = start; i < static_cast<int>(json.length()); i++) {
        char c = json.charAt(i);
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
        } else if (c == '[') {
            brackets++;
        } else if (c == ']') {
            if (--brackets < 0) {
                error = "unbalanced map configuration";
                return false;
            }
        }
    }

    if (inString || braces != 0 || brackets != 0) {
        error = "unbalanced map configuration";
        return false;
    }
    return true;
}

bool CleaningHistory::writeMapConfig(const String& filename, const String& json, String& error) {
    if (!isSessionFilename(filename) || !SPIFFS.exists(String(HISTORY_DIR) + "/" + filename)) {
        error = "session not found";
        return false;
    }
    if (!validateMapConfig(json, error))
        return false;

    String path = sidecarPath(filename, ".map.json");
    String tempPath = path + ".tmp";
    SPIFFS.remove(tempPath);

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

    SPIFFS.remove(path);
    if (!SPIFFS.rename(tempPath, path)) {
        SPIFFS.remove(tempPath);
        error = "could not activate map configuration";
        return false;
    }
    if (!setPinned(filename, true)) {
        SPIFFS.remove(path);
        error = "could not pin session";
        return false;
    }
    return true;
}
