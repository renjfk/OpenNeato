#include "data_logger.h"
#include "neato_serial.h"
#include "system_manager.h"
#include <WiFi.h>
#include <ctime>
#include <esp_system.h>

// -- CompressedLogReader (streaming decompression) ---------------------------

size_t CompressedLogReader::read(uint8_t *buffer, size_t maxLen) {
    if (finished)
        return 0;

    size_t totalWritten = 0;

    while (totalWritten < maxLen) {
        // Try polling decompressed output first
        size_t polled = 0;
        HSD_poll_res pres = heatshrink_decoder_poll(&hsd, buffer + totalWritten, maxLen - totalWritten, &polled);
        if (pres < 0) {
            finished = true;
            return totalWritten;
        }
        totalWritten += polled;

        if (pres == HSDR_POLL_MORE)
            continue;

        // Decoder needs more input — refill from file if needed
        if (inBufOff >= inBufLen) {
            if (inputDone) {
                HSD_finish_res fres = heatshrink_decoder_finish(&hsd);
                if (fres == HSDR_FINISH_DONE) {
                    finished = true;
                    return totalWritten;
                }
                continue;
            }

            size_t bytesRead = file.read(inBuf, sizeof(inBuf));
            if (bytesRead == 0) {
                inputDone = true;
                continue;
            }
            inBufLen = bytesRead;
            inBufOff = 0;
        }

        // Sink input into decoder
        size_t sunk = 0;
        HSD_sink_res sres = heatshrink_decoder_sink(&hsd, inBuf + inBufOff, inBufLen - inBufOff, &sunk);
        if (sres < 0) {
            finished = true;
            return totalWritten;
        }
        inBufOff += sunk;
    }

    return totalWritten;
}

// -- BufferedLogReader (file + unflushed buffer) -----------------------------

size_t BufferedLogReader::read(uint8_t *buffer, size_t maxLen) {
    size_t total = 0;

    // Phase 1: drain the file
    if (file) {
        size_t n = file.read(buffer, maxLen);
        if (n > 0) {
            total += n;
            if (total >= maxLen)
                return total;
        }
        file.close();
    }

    // Phase 2: serve unflushed buffer tail
    size_t remaining = tail.length() - tailOff;
    if (remaining == 0)
        return total;
    size_t chunk = (maxLen - total < remaining) ? maxLen - total : remaining;
    memcpy(buffer + total, tail.c_str() + tailOff, chunk);
    tailOff += chunk;
    total += chunk;
    return total;
}

// -- LogFileInfo -------------------------------------------------------------

std::vector<Field> LogFileInfo::toFields() const {
    return {
            {"name", name, FIELD_STRING},
            {"size", String(size), FIELD_INT},
            {"compressed", compressed ? "true" : "false", FIELD_BOOL},
    };
}

// -- Constructor -------------------------------------------------------------

DataLogger::DataLogger(NeatoSerial& neato, SystemManager& sys) : LoopTask(50), neato(neato), sysMgr(sys) {
    TaskRegistry::add(this);
}

// -- Lifecycle ---------------------------------------------------------------

void DataLogger::begin() {
    if (!LittleFS.begin(true)) {
        LOG("DLOG", "LittleFS mount failed");
        return;
    }
    fsReady = true;
    LOG("DLOG", "LittleFS mounted: %u / %u bytes used", LittleFS.usedBytes(), LittleFS.totalBytes());

    // LittleFS requires real directories (unlike SPIFFS's flat namespace)
    LittleFS.mkdir(LOG_DIR);
    LittleFS.mkdir(HISTORY_DIR);

    // Continue logging into existing current.jsonl across reboots — no need to
    // archive on boot. The file rotates naturally at LOG_MAX_FILE_SIZE and gets
    // a proper epoch-based name once NTP is synced.

    // Seed currentFileSize from existing file (if any)
    if (LittleFS.exists(LOG_CURRENT_FILE)) {
        File f = LittleFS.open(LOG_CURRENT_FILE, FILE_READ);
        if (f) {
            currentFileSize = f.size();
            f.close();
        }
    }

    // Register serial command logger hook with enhanced parameters
    neato.setLogger([this](const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int qDepth,
                           size_t respBytes, unsigned long cacheAgeMs) {
        onCommand(cmd, status, ms, raw, qDepth, respBytes, cacheAgeMs);
    });

    // Log boot event
    logBootEvent();

    lastFlushMs = millis();
}

void DataLogger::tick() {
    // Flush write buffer to filesystem when interval elapsed or buffer full
    if (!writeBuffer.empty()) {
        bool intervalElapsed = millis() - lastFlushMs >= LOG_FLUSH_INTERVAL_MS;
        bool bufferFull = writeBuffer.size() >= LOG_FLUSH_MAX_LINES;
        if (intervalElapsed || bufferFull) {
            flushBuffer();
        }
    }

    // Incremental compression (one chunk per loop iteration)
    if (compressing) {
        if (compressStep()) {
            // Compression complete — clean up source file
            compressSrc.close();
            compressDst.close();

            LOG("DLOG", "Compressed %u -> %u bytes (%.0f%%)", compressTotalIn, compressTotalOut,
                compressTotalIn > 0
                        ? (100.0f * static_cast<float>(compressTotalOut) / static_cast<float>(compressTotalIn))
                        : 0.0f);

            LittleFS.remove(pendingSrcPath);
            compressing = false;
        }
    }

    // Enforce space and file count limits — throttled to once per 30s.
    // Previously ran every 50ms tick, causing constant LittleFS directory scans
    // that block the main loop and degrade serial response times.
    if (!compressing && !bulkDeletePending && enforceLimitsTicker.elapsed(LOG_ENFORCE_LIMITS_MS)) {
        enforceLimits();
    }

    // Deferred rotation: start compression if rotation was requested
    if (rotationPending && !compressing) {
        startCompression();
        rotationPending = false;
    }

    // Deferred bulk delete: delete one file per loop iteration
    if (bulkDeletePending && !bulkDeletePaths.empty()) {
        String path = bulkDeletePaths.back();
        bulkDeletePaths.pop_back();
        LittleFS.remove(path);
        LOG("DLOG", "Bulk delete: %s", path.c_str());

        if (bulkDeletePaths.empty()) {
            bulkDeletePending = false;
        }
    }
}

// -- Write buffer (non-blocking log writes) ----------------------------------

void DataLogger::bufferLine(const String& jsonLine) {
    // Accept entries even before filesystem is ready — they accumulate in memory
    // and get flushed once begin() mounts LittleFS. This allows early-boot
    // events (WiFi connect, NTP) to be captured before dataLogger.begin().
    // Cap the buffer to prevent unbounded heap growth if filesystem init is delayed.
    if (writeBuffer.size() >= LOG_FLUSH_MAX_LINES * 4)
        return;
    writeBuffer.push_back(jsonLine);
}

size_t DataLogger::bufferBytes() const {
    size_t total = 0;
    for (const auto& line: writeBuffer) {
        total += line.length() + 1; // +1 for newline from println()
    }
    return total;
}

String DataLogger::snapshotBuffer() const {
    String result;
    result.reserve(bufferBytes());
    for (const auto& line: writeBuffer) {
        result += line;
        result += '\n';
    }
    return result;
}

void DataLogger::flushBuffer() {
    if (writeBuffer.empty() || !fsReady)
        return;

    File f = LittleFS.open(LOG_CURRENT_FILE, FILE_APPEND);
    if (!f) {
        LOG("DLOG", "Failed to open log file for writing");
        writeBuffer.clear();
        return;
    }

    // Build a single string and write once to minimize LittleFS COW metadata
    // updates. Previously each println() triggered a separate COW + B-tree
    // update, causing 50-300ms stalls that blocked the UART state machine.
    String batch;
    batch.reserve(bufferBytes());
    for (const auto& line: writeBuffer) {
        batch += line;
        batch += '\n';
    }
    size_t written = f.write(reinterpret_cast<const uint8_t *>(batch.c_str()), batch.length());
    currentFileSize += written;
    f.close();
    writeBuffer.clear();
    lastFlushMs = millis();

    // Check if rotation is needed (deferred — actual compression happens in loop())
    if (currentFileSize >= LOG_MAX_FILE_SIZE && !rotationPending && !compressing) {
        String baseName = String(LOG_DIR) + "/" + String(static_cast<long>(sysMgr.now()));
        pendingSrcPath = baseName + ".jsonl";
        pendingDstPath = baseName + ".jsonl.hs";
        LOG("DLOG", "Rotating log -> %s (%u bytes)", pendingDstPath.c_str(), currentFileSize);

        // Rename current log to uncompressed archive (fast, ~5ms)
        LittleFS.rename(LOG_CURRENT_FILE, pendingSrcPath);
        currentFileSize = 0;
        rotationPending = true;
    }
}

// -- Incremental compression -------------------------------------------------

void DataLogger::startCompression() {
    compressSrc = LittleFS.open(pendingSrcPath, FILE_READ);
    if (!compressSrc) {
        LOG("DLOG", "Compression failed: cannot open source %s", pendingSrcPath.c_str());
        return;
    }

    compressDst = LittleFS.open(pendingDstPath, FILE_WRITE);
    if (!compressDst) {
        LOG("DLOG", "Compression failed: cannot open dest %s", pendingDstPath.c_str());
        compressSrc.close();
        return;
    }

    heatshrink_encoder_reset(&compressEncoder);
    compressInputDone = false;
    compressTotalIn = 0;
    compressTotalOut = 0;
    compressing = true;
}

bool DataLogger::compressStep() {
    // Process one chunk of input per call (~5ms of filesystem I/O)
    static const size_t CHUNK_SIZE = 512;
    uint8_t inBuf[CHUNK_SIZE];
    uint8_t outBuf[CHUNK_SIZE];

    if (!compressInputDone) {
        // Read one chunk from source
        int bytesRead = compressSrc.read(inBuf, CHUNK_SIZE);
        if (bytesRead <= 0) {
            compressInputDone = true;
        } else {
            // Sink all bytes from this chunk into the encoder
            size_t offset = 0;
            while (offset < static_cast<size_t>(bytesRead)) {
                size_t sunk = 0;
                HSE_sink_res sres =
                        heatshrink_encoder_sink(&compressEncoder, inBuf + offset, bytesRead - offset, &sunk);
                if (sres < 0) {
                    LOG("DLOG", "Heatshrink sink error");
                    compressSrc.close();
                    compressDst.close();
                    LittleFS.remove(pendingDstPath);
                    compressing = false;
                    // Fall back to uncompressed archive (source already renamed)
                    return true;
                }
                offset += sunk;
                compressTotalIn += sunk;

                // Poll for compressed output
                size_t outSz = 0;
                HSE_poll_res pres;
                do {
                    pres = heatshrink_encoder_poll(&compressEncoder, outBuf, CHUNK_SIZE, &outSz);
                    if (pres < 0) {
                        LOG("DLOG", "Heatshrink poll error");
                        compressSrc.close();
                        compressDst.close();
                        LittleFS.remove(pendingDstPath);
                        compressing = false;
                        return true;
                    }
                    if (outSz > 0) {
                        compressDst.write(outBuf, outSz);
                        compressTotalOut += outSz;
                    }
                } while (pres == HSER_POLL_MORE);
            }
        }
        return false; // More work to do
    }

    // Input exhausted — finish encoding
    HSE_finish_res fres = heatshrink_encoder_finish(&compressEncoder);
    if (fres < 0) {
        LOG("DLOG", "Heatshrink finish error");
        compressSrc.close();
        compressDst.close();
        LittleFS.remove(pendingDstPath);
        compressing = false;
        return true;
    }

    // Poll remaining compressed output
    size_t outSz = 0;
    HSE_poll_res pres;
    do {
        pres = heatshrink_encoder_poll(&compressEncoder, outBuf, CHUNK_SIZE, &outSz);
        if (pres < 0) {
            LOG("DLOG", "Heatshrink poll error during finish");
            compressSrc.close();
            compressDst.close();
            LittleFS.remove(pendingDstPath);
            compressing = false;
            return true;
        }
        if (outSz > 0) {
            compressDst.write(outBuf, outSz);
            compressTotalOut += outSz;
        }
    } while (pres == HSER_POLL_MORE);

    // HSER_FINISH_MORE means more finish passes needed
    return (fres == HSER_FINISH_DONE);
}

void DataLogger::enforceLimits() {
    // Count archived files, sum log directory size, and find the oldest in one pass
    int archiveCount = 0;
    size_t logDirBytes = 0;
    String oldest;
    File root = LittleFS.open(LOG_DIR);
    if (!root || !root.isDirectory())
        return;

    File entry = root.openNextFile();
    while (entry) {
        String name = String(entry.name());
        logDirBytes += entry.size();
        if ((name.endsWith(".jsonl") || name.endsWith(".jsonl.hs")) && name != "current.jsonl") {
            archiveCount++;
            if (oldest.isEmpty() || name < oldest) {
                oldest = name;
            }
        }
        entry = root.openNextFile();
    }

    if (oldest.isEmpty())
        return;

    // Log budget: total filesystem cap minus what non-log data uses, but always at least 10%
    size_t total = LittleFS.totalBytes();
    size_t globalCap = (total * LOG_MAX_FS_PERCENT) / 100;
    size_t nonLogBytes = LittleFS.usedBytes() > logDirBytes ? LittleFS.usedBytes() - logDirBytes : 0;
    size_t available = globalCap > nonLogBytes ? globalCap - nonLogBytes : 0;
    size_t minReserved = (total * LOG_MIN_FS_PERCENT) / 100;
    size_t logBudget = available > minReserved ? available : minReserved;

    if (logDirBytes > logBudget || archiveCount > LOG_MAX_FILES) {
        String fullPath = String(LOG_DIR) + "/" + oldest;
        LOG("DLOG", "Limit: deleting %s (files=%d, logBytes=%u/%u)", fullPath.c_str(), archiveCount, logDirBytes,
            logBudget);
        LittleFS.remove(fullPath);
    }
}

// -- Public logging methods --------------------------------------------------

void DataLogger::logEvent(const String& type, const std::vector<Field>& fields) {
    // Skip if logging is off — no filesystem I/O, no buffer growth.
    // If logLevelCheck is not yet wired (null during early boot), default to off.
    if (!logLevelCheck || logLevelCheck() == LOG_LEVEL_OFF)
        return;

    String line = "{\"t\":" + String(static_cast<long>(sysMgr.now())) + ",\"typ\":\"" + type + "\",\"d\":{" +
                  fieldsToJsonInner(fields) + "}}";
    bufferLine(line);
}

static const char *httpMethodStr(WebRequestMethodComposite method) {
    switch (method) {
        case HTTP_GET:
            return "GET";
        case HTTP_POST:
            return "POST";
        case HTTP_DELETE:
            return "DELETE";
        case HTTP_PUT:
            return "PUT";
        default:
            return "UNKNOWN";
    }
}

void DataLogger::logRequest(WebRequestMethodComposite method, const String& path, int status, unsigned long ms) {
    logEvent("request", {{"method", httpMethodStr(method), FIELD_STRING},
                         {"path", path, FIELD_STRING},
                         {"status", String(status), FIELD_INT},
                         {"ms", String(ms), FIELD_INT}});
}

void DataLogger::logWifi(const String& event, const std::vector<Field>& extra) {
    std::vector<Field> fields = {{"event", event, FIELD_STRING}};
    fields.insert(fields.end(), extra.begin(), extra.end());
    logEvent("wifi", fields);
}

void DataLogger::logOta(const String& event, const std::vector<Field>& extra) {
    std::vector<Field> fields = {{"event", event, FIELD_STRING}};
    fields.insert(fields.end(), extra.begin(), extra.end());
    logEvent("ota", fields);
}

void DataLogger::logNtp(const String& event, const std::vector<Field>& extra) {
    std::vector<Field> fields = {{"event", event, FIELD_STRING}};
    fields.insert(fields.end(), extra.begin(), extra.end());
    logEvent("ntp", fields);
}

void DataLogger::logGenericEvent(const String& category, const std::vector<Field>& extra) {
    std::vector<Field> fields = {{"category", category, FIELD_STRING}};
    fields.insert(fields.end(), extra.begin(), extra.end());
    logEvent("event", fields);
}

void DataLogger::logNotification(const String& category, const String& message, bool success) {
    logEvent("event", {{"category", category, FIELD_STRING},
                       {"msg", message, FIELD_STRING},
                       {"status", success ? "ok" : "fail", FIELD_STRING}});
}

void DataLogger::logBootEvent() {
    int reason = static_cast<int>(esp_reset_reason());
    String reasonStr;
    switch (reason) {
        case 1:
            reasonStr = "POWERON";
            break;
        case 3:
            reasonStr = "SW_RESET";
            break;
        case 4:
            reasonStr = "PANIC";
            break;
        case 5:
            reasonStr = "INT_WDT";
            break;
        case 6:
            reasonStr = "TASK_WDT";
            break;
        case 7:
            reasonStr = "WDT";
            break;
        case 8:
            reasonStr = "DEEPSLEEP";
            break;
        case 9:
            reasonStr = "BROWNOUT";
            break;
        case 10:
            reasonStr = "SDIO";
            break;
        default:
            reasonStr = "UNKNOWN_" + String(reason);
            break;
    }

    logEvent("boot", {{"reason", reasonStr, FIELD_STRING}, {"heap", String(ESP.getFreeHeap()), FIELD_INT}});
}

// -- NeatoSerial logger hook -------------------------------------------------

void DataLogger::onCommand(const String& cmd, CommandStatus status, unsigned long ms, const String& raw, int queueDepth,
                           size_t respBytes, unsigned long cacheAgeMs) {
    int level = logLevelCheck ? logLevelCheck() : LOG_LEVEL_OFF;
    if (level == LOG_LEVEL_OFF)
        return;

    // Skip cache hits — they are memory lookups, not real serial I/O.
    if (cacheAgeMs > 0)
        return;

    // Info level: only log failures (timeouts, errors, queue_full, unsupported).
    // Successful routine polls are noise at info level.
    if (level == LOG_LEVEL_INFO && status == CMD_SUCCESS)
        return;

    // Convert status enum to string for JSON
    const char *statusStr;
    switch (status) {
        case CMD_SUCCESS:
            statusStr = "ok";
            break;
        case CMD_TIMEOUT:
            statusStr = "timeout";
            break;
        case CMD_PARSE_FAILED:
            statusStr = "parse_failed";
            break;
        case CMD_SERIAL_ERROR:
            statusStr = "serial_error";
            break;
        case CMD_UNSUPPORTED:
            statusStr = "unsupported";
            break;
        case CMD_QUEUE_FULL:
            statusStr = "queue_full";
            break;
        default:
            statusStr = "unknown";
            break;
    }

    // Log command metadata; include raw response only at debug level
    std::vector<Field> fields = {{"cmd", cmd, FIELD_STRING},
                                 {"status", statusStr, FIELD_STRING},
                                 {"ms", String(ms), FIELD_INT},
                                 {"q", String(queueDepth), FIELD_INT},
                                 {"bytes", String(respBytes), FIELD_INT}};
    if (level >= LOG_LEVEL_DEBUG)
        fields.push_back({"resp", raw, FIELD_STRING});
    logEvent("command", fields);
}

// -- Log file management -----------------------------------------------------

std::vector<LogFileInfo> DataLogger::listLogs() {
    std::vector<LogFileInfo> files;
    if (!fsReady)
        return files;

    // Add current log — always present when logging is active.
    // Size from tracked flushed bytes + unflushed buffer estimate (no filesystem I/O).
    LogFileInfo current;
    current.name = "current.jsonl";
    current.size = currentFileSize + bufferBytes();
    files.push_back(current);

    // List archived logs
    File root = LittleFS.open(LOG_DIR);
    if (!root || !root.isDirectory())
        return files;

    File entry = root.openNextFile();
    while (entry) {
        String name = String(entry.name());
        if ((name.endsWith(".jsonl.hs") || name.endsWith(".jsonl")) && name != "current.jsonl") {
            LogFileInfo info;
            info.name = name;
            info.size = entry.size();
            info.compressed = name.endsWith(".hs");
            files.push_back(info);
        }
        entry = root.openNextFile();
    }

    return files;
}

std::shared_ptr<LogReader> DataLogger::readLog(const String& filename) {
    if (!fsReady)
        return nullptr;

    String path;
    if (filename == "current.jsonl") {
        path = LOG_CURRENT_FILE;
    } else {
        path = String(LOG_DIR) + "/" + filename;
    }

    // For current.jsonl: serve file content + unflushed buffer as a single stream.
    // The file may not exist yet if nothing has been flushed, but buffer may have data.
    if (filename == "current.jsonl") {
        String tail = snapshotBuffer();
        File f;
        if (LittleFS.exists(path))
            f = LittleFS.open(path, FILE_READ);
        if (!f && tail.isEmpty())
            return nullptr;
        return std::make_shared<BufferedLogReader>(std::move(f), std::move(tail));
    }

    if (!LittleFS.exists(path))
        return nullptr;

    File f = LittleFS.open(path, FILE_READ);
    if (!f)
        return nullptr;

    if (filename.endsWith(".hs")) {
        return std::make_shared<CompressedLogReader>(std::move(f));
    }
    return std::make_shared<PlainLogReader>(std::move(f));
}

bool DataLogger::deleteLog(const String& filename) {
    if (!fsReady)
        return false;

    String path;
    if (filename == "current.jsonl") {
        path = LOG_CURRENT_FILE;
    } else {
        path = String(LOG_DIR) + "/" + filename;
    }

    return LittleFS.remove(path);
}

void DataLogger::deleteAllLogs() {
    if (!fsReady)
        return;

    // Collect all paths — actual deletion is deferred to loop() (one per iteration)
    bulkDeletePaths.clear();

    // Current log
    if (LittleFS.exists(LOG_CURRENT_FILE)) {
        bulkDeletePaths.push_back(LOG_CURRENT_FILE);
        currentFileSize = 0;
    }

    // Archived logs
    File root = LittleFS.open(LOG_DIR);
    if (root && root.isDirectory()) {
        File entry = root.openNextFile();
        while (entry) {
            String name = String(entry.name());
            if (name.endsWith(".jsonl") || name.endsWith(".jsonl.hs")) {
                bulkDeletePaths.push_back(String(LOG_DIR) + "/" + name);
            }
            entry = root.openNextFile();
        }
    }

    if (!bulkDeletePaths.empty()) {
        bulkDeletePending = true;
    }
}

// -- Helpers -----------------------------------------------------------------
