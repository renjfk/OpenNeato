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

    // Phase 1: drain the SPIFFS file
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

DataLogger::DataLogger(NeatoSerial& neato, SystemManager& sys) : neato(neato), sysMgr(sys) {}

// -- Lifecycle ---------------------------------------------------------------

void DataLogger::begin() {
    // Mount SPIFFS (format on first use)
    if (!SPIFFS.begin(true)) {
        LOG("DLOG", "SPIFFS mount failed");
        return;
    }
    spiffsReady = true;
    LOG("DLOG", "SPIFFS mounted: %u / %u bytes used", SPIFFS.usedBytes(), SPIFFS.totalBytes());

    // SPIFFS is flat — mkdir is a no-op, directory paths are just file prefixes

    // Continue logging into existing current.jsonl across reboots — no need to
    // archive on boot. The file rotates naturally at LOG_MAX_FILE_SIZE and gets
    // a proper epoch-based name once NTP is synced.

    // Seed currentFileSize from existing file (if any)
    if (SPIFFS.exists(LOG_CURRENT_FILE)) {
        File f = SPIFFS.open(LOG_CURRENT_FILE, FILE_READ);
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

void DataLogger::loop() {
    // Flush write buffer to SPIFFS when interval elapsed or buffer full
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

            SPIFFS.remove(pendingSrcPath);
            compressing = false;
        }
    }

    // Enforce space and file count limits (one delete per loop iteration)
    if (!compressing && !bulkDeletePending) {
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
        SPIFFS.remove(path);
        LOG("DLOG", "Bulk delete: %s", path.c_str());

        if (bulkDeletePaths.empty()) {
            bulkDeletePending = false;
        }
    }
}

// -- Write buffer (non-blocking log writes) ----------------------------------

void DataLogger::bufferLine(const String& jsonLine) {
    // Accept entries even before SPIFFS is ready — they accumulate in memory
    // and get flushed once begin() mounts SPIFFS. This allows early-boot
    // events (WiFi connect, NTP) to be captured before dataLogger.begin().
    // Cap the buffer to prevent unbounded heap growth if SPIFFS init is delayed.
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
    if (writeBuffer.empty() || !spiffsReady)
        return;

    File f = SPIFFS.open(LOG_CURRENT_FILE, FILE_APPEND);
    if (!f) {
        LOG("DLOG", "Failed to open log file for writing");
        writeBuffer.clear();
        return;
    }

    for (const auto& line: writeBuffer) {
        size_t written = f.println(line);
        currentFileSize += written;
    }
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
        SPIFFS.rename(LOG_CURRENT_FILE, pendingSrcPath);
        currentFileSize = 0;
        rotationPending = true;
    }
}

// -- Incremental compression -------------------------------------------------

void DataLogger::startCompression() {
    compressSrc = SPIFFS.open(pendingSrcPath, FILE_READ);
    if (!compressSrc) {
        LOG("DLOG", "Compression failed: cannot open source %s", pendingSrcPath.c_str());
        return;
    }

    compressDst = SPIFFS.open(pendingDstPath, FILE_WRITE);
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
    // Process one chunk of input per call (~5ms of SPIFFS I/O)
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
                    SPIFFS.remove(pendingDstPath);
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
                        SPIFFS.remove(pendingDstPath);
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
        SPIFFS.remove(pendingDstPath);
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
            SPIFFS.remove(pendingDstPath);
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
    // Count archived files and find the oldest in one pass
    int archiveCount = 0;
    String oldest;
    File root = SPIFFS.open(LOG_DIR);
    if (!root || !root.isDirectory())
        return;

    File entry = root.openNextFile();
    while (entry) {
        String name = String(entry.name());
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

    // Delete oldest if over space limit or file count limit
    size_t maxBytes = (SPIFFS.totalBytes() * LOG_MAX_SPIFFS_PERCENT) / 100;
    if (SPIFFS.usedBytes() > maxBytes || archiveCount > LOG_MAX_FILES) {
        String fullPath = String(LOG_DIR) + "/" + oldest;
        LOG("DLOG", "Limit: deleting %s (files=%d, space=%u/%u)", fullPath.c_str(), archiveCount, SPIFFS.usedBytes(),
            SPIFFS.totalBytes());
        SPIFFS.remove(fullPath);
    }
}

// -- Public logging methods --------------------------------------------------

void DataLogger::logEvent(const String& type, const std::vector<Field>& fields) {
    String line = "{\"t\":" + String(static_cast<long>(sysMgr.now())) + ",\"typ\":\"" + type + "\",\"d\":{" +
                  fieldsToJsonInner(fields) + "}}";
    bufferLine(line);
}

void DataLogger::logError(const String& source, const String& message) {
    logEvent("error", {{"src", source, FIELD_STRING}, {"msg", message, FIELD_STRING}});
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
        default:
            statusStr = "unknown";
            break;
    }

    // Log command metadata; include raw response only when debug logging is enabled
    // cache_age presence is implicit: 0 = fresh fetch (omitted), >0 = served from cache
    std::vector<Field> fields = {{"cmd", cmd, FIELD_STRING},
                                 {"status", statusStr, FIELD_STRING},
                                 {"ms", String(ms), FIELD_INT},
                                 {"q", String(queueDepth), FIELD_INT},
                                 {"bytes", String(respBytes), FIELD_INT}};
    if (cacheAgeMs > 0)
        fields.push_back({"age", String(cacheAgeMs), FIELD_INT});
    if (debugCheck && debugCheck())
        fields.push_back({"resp", raw, FIELD_STRING});
    logEvent("command", fields);
}

// -- Log file management -----------------------------------------------------

std::vector<LogFileInfo> DataLogger::listLogs() {
    std::vector<LogFileInfo> files;
    if (!spiffsReady)
        return files;

    // Add current log — always present when logging is active.
    // Size from tracked flushed bytes + unflushed buffer estimate (no SPIFFS I/O).
    LogFileInfo current;
    current.name = "current.jsonl";
    current.size = currentFileSize + bufferBytes();
    files.push_back(current);

    // List archived logs
    File root = SPIFFS.open(LOG_DIR);
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
    if (!spiffsReady)
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
        if (SPIFFS.exists(path))
            f = SPIFFS.open(path, FILE_READ);
        if (!f && tail.isEmpty())
            return nullptr;
        return std::make_shared<BufferedLogReader>(std::move(f), std::move(tail));
    }

    if (!SPIFFS.exists(path))
        return nullptr;

    File f = SPIFFS.open(path, FILE_READ);
    if (!f)
        return nullptr;

    if (filename.endsWith(".hs")) {
        return std::make_shared<CompressedLogReader>(std::move(f));
    }
    return std::make_shared<PlainLogReader>(std::move(f));
}

bool DataLogger::deleteLog(const String& filename) {
    if (!spiffsReady)
        return false;

    String path;
    if (filename == "current.jsonl") {
        path = LOG_CURRENT_FILE;
    } else {
        path = String(LOG_DIR) + "/" + filename;
    }

    return SPIFFS.remove(path);
}

void DataLogger::deleteAllLogs() {
    if (!spiffsReady)
        return;

    // Collect all paths — actual deletion is deferred to loop() (one per iteration)
    bulkDeletePaths.clear();

    // Current log
    if (SPIFFS.exists(LOG_CURRENT_FILE)) {
        bulkDeletePaths.push_back(LOG_CURRENT_FILE);
        currentFileSize = 0;
    }

    // Archived logs
    File root = SPIFFS.open(LOG_DIR);
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
