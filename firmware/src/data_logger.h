#ifndef DATA_LOGGER_H
#define DATA_LOGGER_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <SPIFFS.h>
#include <functional>
#include <vector>
#include <heatshrink_encoder.h>
#include "config.h"

class NeatoSerial;


// Log file metadata for API listing
struct LogFileInfo {
    String name;
    size_t size = 0;
    bool compressed = false;
};

class DataLogger {
public:
    DataLogger(NeatoSerial& neato);

    void begin();
    void loop();

    // -- Public logging methods (called by other modules) --------------------
    // These are safe to call from any context (request handlers, callbacks,
    // event handlers). They only append to an in-memory buffer; actual SPIFFS
    // I/O is deferred to loop().

    void logEvent(const String& type, const String& jsonPayload);
    void logError(const String& source, const String& message);
    void logRequest(WebRequestMethodComposite method, const String& path, int status, unsigned long ms);
    void logWifi(const String& event, const String& jsonPayload);
    void logOta(const String& event, const String& jsonPayload);
    void logNtp(const String& event, const String& jsonPayload);

    // -- Log file management (for API) --------------------------------------

    std::vector<LogFileInfo> listLogs() const;
    bool readLog(const String& filename, std::function<void(File&)> reader) const;
    bool decompressLog(const String& filename, std::function<void(const uint8_t *, size_t)> writer) const;
    bool deleteLog(const String& filename);
    void deleteAllLogs();

    // -- System health (live, for GET /api/system) --------------------------

    String systemHealthJson() const;

    // -- Timezone -----------------------------------------------------------

    String getTimezone() const;
    void setTimezone(const String& tz);

    // -- NTP status ---------------------------------------------------------

    bool isNtpSynced() const { return ntpSynced; }
    void triggerRobotTimeSync();

private:
    NeatoSerial& neato;

    // Time management
    bool ntpSynced = false;
    bool robotTimeFetched = false;
    time_t robotTimeBase = 0; // Epoch from robot clock at boot
    unsigned long robotTimeMillis = 0; // millis() when robot time was read
    unsigned long lastRobotSync = 0;

    // SPIFFS state
    bool spiffsReady = false;

    // Get current epoch (best available source)
    time_t now() const;

    // -- Write buffer (non-blocking log writes) ------------------------------
    // Log lines accumulate in memory; loop() flushes them to SPIFFS.
    std::vector<String> writeBuffer;
    unsigned long lastFlushMs = 0;
    size_t currentFileSize = 0; // Tracked in memory to avoid SPIFFS stat on every write

    void bufferLine(const String& jsonLine);
    void flushBuffer();

    // -- Deferred rotation ---------------------------------------------------
    // After flush detects file too large, it renames current.jsonl to a temp
    // uncompressed archive. Compression happens incrementally in loop().
    bool rotationPending = false;
    String pendingSrcPath;
    String pendingDstPath;

    // Incremental compression state (persists across loop() calls)
    bool compressing = false;
    File compressSrc;
    File compressDst;
    heatshrink_encoder compressEncoder;
    bool compressInputDone = false; // No more source data to read
    size_t compressTotalIn = 0;
    size_t compressTotalOut = 0;

    void startCompression();
    bool compressStep(); // Returns true when compression is complete

    void enforceSpaceLimit();

    // -- Deferred bulk delete ------------------------------------------------
    bool bulkDeletePending = false;
    std::vector<String> bulkDeletePaths;

    // Boot tasks
    void archiveLeftoverLog();
    void logBootEvent();
    void fetchRobotTime();
    void syncRobotTime();

    // Blocking compression (used only in begin() during boot)
    bool compressFile(const String& srcPath, const String& dstPath);

    // NeatoSerial logger hook (enhanced with status, queue depth, response size)
    void onCommand(const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int queueDepth,
                   size_t respBytes);

    // Helper: escape a string for JSON
    static String jsonEscape(const String& s);
};

#endif // DATA_LOGGER_H
