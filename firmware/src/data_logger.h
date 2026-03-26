#ifndef DATA_LOGGER_H
#define DATA_LOGGER_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <functional>
#include <memory>
#include <vector>
#include <heatshrink_encoder.h>
#include <heatshrink_decoder.h>
#include "config.h"
#include "json_fields.h"
#include "loop_task.h"

class NeatoSerial;
class SystemManager;


// Log file metadata for API listing
struct LogFileInfo : public JsonSerializable {
    String name;
    size_t size = 0;
    bool compressed = false;

    std::vector<Field> toFields() const override;
};

// Streaming log reader — abstracts both plain and compressed log files.
// Returned by DataLogger::readLog(), used by web server's chunked response.
// Caller just calls read() repeatedly until it returns 0.
struct LogReader {
    virtual ~LogReader() = default;
    // Fill buffer with up to maxLen bytes, return bytes written (0 = done)
    virtual size_t read(uint8_t *buffer, size_t maxLen) = 0;
};

// Plain text log reader — thin wrapper around filesystem File
struct PlainLogReader : public LogReader {
    File file;
    explicit PlainLogReader(File f) : file(std::move(f)) {}
    ~PlainLogReader() override {
        if (file)
            file.close();
    }
    size_t read(uint8_t *buffer, size_t maxLen) override { return file.read(buffer, maxLen); }
};

// Buffered log reader — serves file content followed by unflushed
// in-memory buffer lines. Used for current.jsonl so the API always returns
// complete data even between flush intervals.
struct BufferedLogReader : public LogReader {
    File file;
    String tail; // Concatenated unflushed lines (with newlines)
    size_t tailOff = 0;

    BufferedLogReader(File f, String buffered) : file(std::move(f)), tail(std::move(buffered)) {}
    ~BufferedLogReader() override {
        if (file)
            file.close();
    }
    size_t read(uint8_t *buffer, size_t maxLen) override;
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

class DataLogger : public LoopTask {
public:
    DataLogger(NeatoSerial& neato, SystemManager& sys);

    void begin();

    // -- Public logging methods (called by other modules) --------------------
    // These are safe to call from any context (request handlers, callbacks,
    // event handlers). They only append to an in-memory buffer; actual
    // filesystem I/O is deferred to loop().

    void logRequest(WebRequestMethodComposite method, const String& path, int status, unsigned long ms);
    void logWifi(const String& event, const std::vector<Field>& extra = {});
    void logOta(const String& event, const std::vector<Field>& extra = {});
    void logNtp(const String& event, const std::vector<Field>& extra = {});
    void logGenericEvent(const String& category, const std::vector<Field>& extra = {});
    void logNotification(const String& category, const String& message, bool success);

    // Log level check — returns current log level from SettingsManager.
    // 0=off (no logging), 1=info (events only), 2=debug (all commands + raw responses).
    // Wired by main.cpp to SettingsManager.
    using LogLevelCheck = std::function<int()>;
    void setLogLevelCheck(LogLevelCheck check) { logLevelCheck = check; }

    // -- Log file management (for API) --------------------------------------

    std::vector<LogFileInfo> listLogs();
    std::shared_ptr<LogReader> readLog(const String& filename);
    bool deleteLog(const String& filename);
    void deleteAllLogs();

private:
    void tick() override; // Runs every 50ms — flush buffer, compression step, limit enforcement

    NeatoSerial& neato;
    SystemManager& sysMgr;
    LogLevelCheck logLevelCheck;

    void logEvent(const String& type, const std::vector<Field>& fields);

    // Filesystem state
    bool fsReady = false;

    // -- Write buffer (non-blocking log writes) ------------------------------
    // Log lines accumulate in memory; loop() flushes them to filesystem.
    std::vector<String> writeBuffer;
    unsigned long lastFlushMs = 0;
    size_t currentFileSize = 0; // Tracked in memory to avoid filesystem stat on every write

    void bufferLine(const String& jsonLine);
    void flushBuffer();
    size_t bufferBytes() const; // Estimate total size of unflushed buffer lines
    String snapshotBuffer() const; // Concatenate buffer lines into a single string

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

    void enforceLimits();
    Ticker enforceLimitsTicker; // Throttle enforceLimits to once per 30s instead of every 50ms tick

    // -- Deferred bulk delete ------------------------------------------------
    bool bulkDeletePending = false;
    std::vector<String> bulkDeletePaths;

    // Boot tasks
    void logBootEvent();

    // NeatoSerial logger hook (enhanced with status, queue depth, response size, cache info)
    // cacheAgeMs: 0 = fresh serial fetch, >0 = served from cache (age in ms)
    void onCommand(const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int queueDepth,
                   size_t respBytes, unsigned long cacheAgeMs);
};

#endif // DATA_LOGGER_H
