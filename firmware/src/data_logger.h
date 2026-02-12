#ifndef DATA_LOGGER_H
#define DATA_LOGGER_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <SPIFFS.h>
#include <functional>
#include <memory>
#include <vector>
#include <heatshrink_encoder.h>
#include <heatshrink_decoder.h>
#include "config.h"

class NeatoSerial;
class SystemManager;


// Log file metadata for API listing
struct LogFileInfo {
    String name;
    size_t size = 0;
    bool compressed = false;
};

// Streaming log reader — abstracts both plain and compressed log files.
// Returned by DataLogger::readLog(), used by web server's chunked response.
// Caller just calls read() repeatedly until it returns 0.
struct LogReader {
    virtual ~LogReader() = default;
    // Fill buffer with up to maxLen bytes, return bytes written (0 = done)
    virtual size_t read(uint8_t *buffer, size_t maxLen) = 0;
};

// Plain text log reader — thin wrapper around SPIFFS File
struct PlainLogReader : public LogReader {
    File file;
    explicit PlainLogReader(File f) : file(std::move(f)) {}
    ~PlainLogReader() override {
        if (file)
            file.close();
    }
    size_t read(uint8_t *buffer, size_t maxLen) override { return file.read(buffer, maxLen); }
};

// Compressed log reader — streaming heatshrink decompression
struct CompressedLogReader : public LogReader {
    File file;
    heatshrink_decoder hsd;
    uint8_t inBuf[512];
    size_t inBufLen = 0;
    size_t inBufOff = 0;
    bool inputDone = false;
    bool finished = false;

    explicit CompressedLogReader(File f) : file(std::move(f)) { heatshrink_decoder_reset(&hsd); }
    ~CompressedLogReader() override {
        if (file)
            file.close();
    }
    size_t read(uint8_t *buffer, size_t maxLen) override;
};

class DataLogger {
public:
    DataLogger(NeatoSerial& neato, SystemManager& sys);

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
    std::shared_ptr<LogReader> readLog(const String& filename) const;
    bool deleteLog(const String& filename);
    void deleteAllLogs();

private:
    NeatoSerial& neato;
    SystemManager& sysMgr;

    // SPIFFS state
    bool spiffsReady = false;

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

    // Blocking compression (used only in begin() during boot)
    bool compressFile(const String& srcPath, const String& dstPath);

    // NeatoSerial logger hook (enhanced with status, queue depth, response size)
    void onCommand(const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int queueDepth,
                   size_t respBytes);

    // Helper: escape a string for JSON
    static String jsonEscape(const String& s);
};

#endif // DATA_LOGGER_H
