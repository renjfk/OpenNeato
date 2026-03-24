#ifndef CLEANING_HISTORY_H
#define CLEANING_HISTORY_H

#include <Arduino.h>
#include <memory>
#include <set>
#include "config.h"
#include "data_logger.h"
#include "neato_commands.h"

class NeatoSerial;
class SystemManager;

// Session metadata returned by listSessions() — includes the raw JSON of
// the session header line and (if finished) the summary line so the frontend
// can render list cards without fetching each file's full content.
struct HistorySessionInfo {
    String name; // Filename (e.g. "1771683615.jsonl.hs")
    size_t size = 0; // File size in bytes
    bool compressed = false;
    bool recording = false; // True if this is the active recording session
    String session; // Raw JSON of first line ({"type":"session",...})
    String summary; // Raw JSON of last line ({"type":"summary",...}), empty if still recording
};

// Records robot pose data during autonomous cleaning runs and stores each
// session as a JSONL file on SPIFFS. During collection, raw JSONL lines are
// written directly to /history/<epoch>.jsonl. When cleaning ends, the file
// is compressed to .jsonl.hs via incremental heatshrink encoding (non-blocking,
// spread across tick() calls).
//
// Files are served through the same LogReader/CompressedLogReader/PlainLogReader
// abstractions used by DataLogger, so the web server streaming code is identical.

class CleaningHistory : public LoopTask {
public:
    CleaningHistory(NeatoSerial& neato, DataLogger& logger, SystemManager& sysMgr);

    // -- File management (for API, mirrors DataLogger pattern) ----------------

    std::vector<HistorySessionInfo> listSessions();
    std::shared_ptr<LogReader> readSession(const String& filename);
    bool deleteSession(const String& filename);
    void deleteAllSessions();

    // Called by WebServer when a clean command is sent via API.
    // Switches to active polling so collection starts immediately
    // instead of waiting for the next idle-interval tick.
    void notifyCleanStart();


private:
    void tick() override;

    NeatoSerial& neato;
    DataLogger& dataLogger;
    SystemManager& systemManager;

    // -- State tracking ------------------------------------------------------
    String prevUiState;
    bool collecting = false;
    bool recharging = false;
    bool fetchPending = false;
    bool recoveryAttempted = false; // Only try orphan recovery once after boot
    size_t snapshotCount = 0;

    // Active session file (open during collection, closed at end)
    File activeFile;
    String activeFilePath; // e.g. "/history/1771683615.jsonl"

    // -- Session metadata ----------------------------------------------------
    String cleanMode;
    time_t sessionStartTime = 0;
    int batteryStart = -1;

    // -- Session accumulators ------------------------------------------------
    int rechargeCount = 0;
    float totalDistance = 0.0f;
    float totalRotation = 0.0f;
    float maxDistFromOrigin = 0.0f;
    int errorsDuringClean = 0;
    bool prevHadError = false;

    // Previous pose for delta calculations
    float prevX = 0.0f;
    float prevY = 0.0f;
    float prevTheta = 0.0f;
    float originX = 0.0f;
    float originY = 0.0f;
    bool hasPrevPose = false;

    // Coarse area coverage — set of visited grid cells
    std::set<uint32_t> visitedCells;

    // -- End-of-session compression (incremental, non-blocking) ---------------
    bool compressing = false;
    File compressSrc;
    File compressDst;
    heatshrink_encoder compressEncoder;
    bool compressInputDone = false;
    String compressSrcPath;
    String compressDstPath;

    bool compressStep(); // Returns true when done

    // -- Collection lifecycle ------------------------------------------------
    void checkState();
    void startCollection(const String& uiState);
    void stopCollection();
    void collectSnapshot();
    void writeLine(const String& line); // Immediate write + flush (headers, summaries)
    void bufferLine(const String& line); // Buffer for deferred flush (pose snapshots)
    void flushWriteBuffer(); // Flush buffered lines to disk
    std::vector<String> writeBuffer;
    unsigned long lastFlushMs = 0;
    void writeSessionHeader();
    void writeSessionSummary(int batteryEnd);
    void writeSnapshot(float x, float y, float theta, float time);
    void updateAccumulators(float x, float y, float theta);
    void resetSession();
    bool replayLine(const String& line);
    bool recoverCollection(const String& uiState);
    void finalizeOrphanSessions();

    // Storage enforcement — delete oldest sessions when budget exceeded
    void enforceLimits();

    // Read first and last lines from a session file (decompresses .hs files)
    static void readFirstLastLines(const String& path, bool compressed, String& firstLine, String& lastLine);

    static bool isCleaningState(const String& uiState);
    static bool isPausedState(const String& uiState);
    static bool isDockingState(const String& uiState);
    static String cleanModeFromState(const String& uiState);
};

#endif // CLEANING_HISTORY_H
