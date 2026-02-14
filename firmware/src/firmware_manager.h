#ifndef FIRMWARE_MANAGER_H
#define FIRMWARE_MANAGER_H

#include <Update.h>
#include <StreamString.h>
#include <functional>
#include <vector>
#include "config.h"
#include "json_fields.h"

class FirmwareManager {
public:
    void loop();

    // Version info
    const char *getFirmwareVersion() const { return FIRMWARE_VERSION; }

    // Update lifecycle
    bool beginUpdate(const String& md5Hash = "");
    bool writeChunk(uint8_t *data, size_t len);
    bool endUpdate();

    // State queries
    bool isInProgress() const { return updateInProgress; }
    size_t getProgress() const { return currentProgress; }
    const String& getError() const { return updateError; }

    // Logger callback: (event, extra_fields)
    using LogCallback = std::function<void(const String&, const std::vector<Field>&)>;
    void setLogger(LogCallback logger) { loggerCallback = logger; }

private:
    bool updateInProgress = false;
    bool rebootPending = false;
    unsigned long rebootRequestMs = 0;
    size_t currentProgress = 0;
    String updateError;
    LogCallback loggerCallback;
};

#endif // FIRMWARE_MANAGER_H
