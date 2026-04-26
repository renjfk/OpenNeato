#include "web_server.h"
#include "web_assets.h"
#include "neato_serial.h"
#include "data_logger.h"
#include "system_manager.h"
#include "settings_manager.h"
#include "firmware_manager.h"
#include "manual_clean_manager.h"
#include "notification_manager.h"
#include "cleaning_history.h"
#include <SPIFFS.h>

unsigned long WebServer::lastApiActivity = 0;

WebServer::WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys,
                     FirmwareManager& fw, SettingsManager& settings, ManualCleanManager& manual,
                     NotificationManager& notif, CleaningHistory& history) :
    server(server), neato(neato), logger(logger), sysMgr(sys), fwMgr(fw), settingsMgr(settings), manualMgr(manual),
    notifMgr(notif), historyMgr(history) {}

void WebServer::loggedRoute(const char *path, WebRequestMethodComposite httpMethod, SyncHandler handler) {
    server.on(path, httpMethod, [this, handler](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        int status = handler(request);
        logger.logRequest(request->method(), request->url().c_str(), status, millis() - startMs);
    });
}

void WebServer::loggedBodyRoute(const char *path, WebRequestMethodComposite httpMethod, BodyHandler handler) {
    server.on(
            path, httpMethod, [](AsyncWebServerRequest *request) { /* handled in body callback */ }, nullptr,
            [this, handler](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t, size_t) {
                lastApiActivity = millis();
                unsigned long startMs = lastApiActivity;
                int status = handler(request, data, len);
                logger.logRequest(request->method(), request->url().c_str(), status, millis() - startMs);
            });
}

void WebServer::sendGzipAsset(AsyncWebServerRequest *request, const uint8_t *data, size_t len,
                              const char *contentType) {
    AsyncWebServerResponse *response = request->beginResponse(200, contentType, data, len);
    response->addHeader("Content-Encoding", "gzip");
    request->send(response);
}

void WebServer::sendError(AsyncWebServerRequest *request, int code, const String& msg) {
    request->send(code, "application/json", fieldsToJson({{"error", msg, FIELD_STRING}}));
}

void WebServer::sendOk(AsyncWebServerRequest *request) {
    request->send(200, "application/json", fieldsToJson({{"ok", "true", FIELD_BOOL}}));
}

void WebServer::begin() {
    // Register all embedded frontend assets from the auto-generated registry
    for (size_t i = 0; i < WEB_ASSETS_COUNT; i++) {
        const WebAsset& asset = WEB_ASSETS[i];
        server.on(asset.path, HTTP_GET, [&asset](AsyncWebServerRequest *request) {
            sendGzipAsset(request, asset.data, asset.length, asset.contentType);
        });
    }

    LOG("WEB", "Registered %u embedded assets", WEB_ASSETS_COUNT);

    registerApiRoutes();
    registerManualRoutes();
    registerLogRoutes();
    registerSystemRoutes();
    registerSettingsRoutes();
    registerFirmwareRoutes();
    registerMapRoutes();

    LOG("WEB", "Frontend and API routes registered");
}

void WebServer::registerApiRoutes() {
    // -- Sensor query endpoints ----------------------------------------------
    // @tag Sensors: Read-only telemetry from the robot

    // @doc summary: Get robot identity (model, serial, firmware versions)
    // @doc response: VersionData
    registerGetRoute("/api/version", neato, &NeatoSerial::getVersion, {});
    // @doc summary: Get battery and charger status
    // @doc response: ChargerData
    registerGetRoute("/api/charger", neato, &NeatoSerial::getCharger, {});
    // @doc summary: Get motor telemetry (brush, vacuum, wheels, side brush, laser)
    // @doc response: MotorData
    registerGetRoute(
            "/api/motors", neato,
            static_cast<void (NeatoSerial::*)(std::function<void(bool, const MotorData&)>)>(&NeatoSerial::getMotors),
            {});
    // @doc summary: Get current UI and robot state machine values
    // @doc response: StateData
    registerGetRoute("/api/state", neato, &NeatoSerial::getState, {});
    // @doc summary: Get current error or warning state
    // @doc response: ErrorData
    registerGetRoute("/api/error", neato, &NeatoSerial::getErr, {});
    // @doc summary: Get latest 360-point LIDAR scan
    // @doc response: LidarScan
    registerGetRoute("/api/lidar", neato, &NeatoSerial::getLdsScan, {});
    // @doc summary: Get robot on-board user settings (sounds, eco, wall follow, maintenance)
    // @doc response: UserSettingsData
    registerGetRoute("/api/user-settings", neato, &NeatoSerial::getUserSettings, {});

    // -- Action endpoints ----------------------------------------------------
    // All parameterized actions use query strings: resource URL identifies the
    // command, query params carry arguments (mirrors Neato serial protocol).
    // @tag Actions: Control commands sent to the robot

    // @doc summary: Start, pause, resume, stop, or dock cleaning
    // @doc query: action enum=house,spot,pause,stop,dock required
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/clean", neato, &NeatoSerial::clean, {"action"});
    // @doc summary: Play a robot sound effect
    // @doc query: id integer 0..20 required
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/sound", neato, &NeatoSerial::playSound, {"id"});
    // @doc summary: Enter or exit test mode (required for manual control)
    // @doc query: enable boolean 0..1 required
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/testmode", neato, &NeatoSerial::testMode, {"enable"});
    // @doc summary: Restart or shutdown the robot
    // @doc query: action enum=restart,shutdown required
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/power", neato, &NeatoSerial::powerControl, {"action"});
    // @doc summary: Start or stop LIDAR turret rotation
    // @doc query: enable boolean 0..1 required
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/lidar/rotate", neato, &NeatoSerial::setLdsRotation, {"enable"});
    // @doc summary: Set a single robot on-board user setting
    // @doc query: key string required
    // @doc query: value string required
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/user-settings", neato, &NeatoSerial::setUserSetting, {"key", "value"});
    // @doc summary: Clear all UI errors and warnings on the robot
    // @doc response: Ok
    // @doc errors: 503=robot busy, 504=robot timeout
    registerPostRoute("/api/clear-errors", neato, &NeatoSerial::clearErrors, {});

    // Serial endpoint — send arbitrary serial command, returns raw response.
    // Always available (no debug gate — useful for diagnostics without enabling verbose logging).
    // Excluded from public API docs (diagnostics-only passthrough).
    // @doc skip
    server.on("/api/serial", HTTP_POST, [this](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;

        if (!request->hasParam("cmd")) {
            logger.logRequest(HTTP_POST, "/api/serial", 400, millis() - startMs);
            sendError(request, 400, "missing cmd");
            return;
        }
        String cmd = request->getParam("cmd")->value();
        if (cmd.isEmpty()) {
            logger.logRequest(HTTP_POST, "/api/serial", 400, millis() - startMs);
            sendError(request, 400, "empty cmd");
            return;
        }

        auto weak = request->pause();
        bool ok = neato.sendRaw(cmd, [this, weak, startMs](bool /*success*/, const String& response) {
            if (auto req = weak.lock()) {
                unsigned long elapsed = millis() - startMs;
                logger.logRequest(HTTP_POST, "/api/serial", 200, elapsed);
                req->send(200, "text/plain", response);
            }
        });
        if (!ok) {
            logger.logRequest(HTTP_POST, "/api/serial", 503, millis() - startMs);
            sendError(request, 503, "unavailable");
        }
    });

    LOG("WEB", "API routes registered");
}

// -- Manual clean endpoints ---------------------------------------------------

void WebServer::registerManualRoutes() {
    // Register longer paths first — ESPAsyncWebServer matches routes by prefix,
    // so /api/manual would swallow /api/manual/move and /api/manual/motors.
    // @tag Manual: Manual cleaning mode (joystick, motors)

    // @doc path: /api/manual/status
    // @doc method: GET
    // @doc summary: Get manual mode state (active flag, motors, bumpers, stalls)
    // @doc response: ManualStatus
    loggedRoute("/api/manual/status", HTTP_GET, [this](AsyncWebServerRequest *request) {
        request->send(200, "application/json", manualMgr.getStatusJson());
        return 200;
    });
    // @doc summary: Drive the wheels for a specific distance at a given speed
    // @doc query: left integer required (mm, negative=backward)
    // @doc query: right integer required (mm, negative=backward)
    // @doc query: speed integer required (mm/s)
    // @doc response: Ok
    // @doc errors: 503=manual mode inactive or unsafe state, 504=robot timeout
    registerPostRoute("/api/manual/move", manualMgr, &ManualCleanManager::move, {"left", "right", "speed"});
    // @doc summary: Toggle main brush, vacuum, and side brush motors
    // @doc query: brush boolean 0..1 required
    // @doc query: vacuum boolean 0..1 required
    // @doc query: sideBrush boolean 0..1 required
    // @doc response: Ok
    // @doc errors: 503=manual mode inactive, 504=robot timeout
    registerPostRoute("/api/manual/motors", manualMgr, &ManualCleanManager::setMotors,
                      {"brush", "vacuum", "sideBrush"});
    // @doc summary: Enable or disable manual mode (also enters TestMode and starts LIDAR)
    // @doc query: enable boolean 0..1 required
    // @doc response: Ok
    // @doc errors: 503=cannot enter manual mode, 504=robot timeout
    registerPostRoute("/api/manual", manualMgr, &ManualCleanManager::enable, {"enable"});

    LOG("WEB", "Manual clean routes registered");
}

// -- Log file endpoints ------------------------------------------------------

// Strip .hs extension so browser saves a plain .jsonl file
static String downloadName(const String& filename) {
    if (filename.endsWith(".hs"))
        return filename.substring(0, filename.length() - 3);
    return filename;
}

static String logListJson(const std::vector<LogFileInfo>& files) {
    String json = "[";
    for (size_t i = 0; i < files.size(); i++) {
        if (i > 0)
            json += ",";
        json += files[i].toJson();
    }
    json += "]";
    return json;
}

void WebServer::registerLogRoutes() {
    // @tag Logs: Diagnostic log files stored in flash

    // GET /api/logs[/filename] — list logs or download a specific file
    // A single BackwardCompatible handler matches both "/api/logs" and "/api/logs/..."
    // This route uses server.on() directly instead of loggedRoute() because
    // compressed log downloads use chunked streaming (beginChunkedResponse) which
    // must not block — loggedRoute's sync wrapper would block until completion.
    // @doc path: /api/logs
    // @doc method: GET
    // @doc summary: List all log files
    // @doc response: array of LogFileInfo
    // @doc path: /api/logs/{filename}
    // @doc method: GET
    // @doc summary: Download a single log file (transparently decompressed)
    // @doc param: filename string required
    // @doc response: application/x-ndjson
    // @doc errors: 404=log not found
    server.on("/api/logs", HTTP_GET, [this](AsyncWebServerRequest *request) {
        unsigned long startMs = millis();
        String filename = request->url().substring(String("/api/logs/").length());

        if (filename.isEmpty()) {
            String json = logListJson(logger.listLogs());
            logger.logRequest(HTTP_GET, "/api/logs", 200, millis() - startMs);
            request->send(200, "application/json", json);
            return;
        }

        // Open log via DataLogger — handles path resolution and transparent decompression
        auto reader = logger.readLog(filename);
        if (!reader) {
            logger.logRequest(HTTP_GET, request->url().c_str(), 404, millis() - startMs);
            sendError(request, 404, "log not found");
            return;
        }

        logger.logRequest(HTTP_GET, request->url().c_str(), 200, millis() - startMs);

        // Stream log content via chunked response — reader handles decompression
        AsyncWebServerResponse *response = request->beginChunkedResponse(
                "application/x-ndjson",
                [reader](uint8_t *buffer, size_t maxLen, size_t) -> size_t { return reader->read(buffer, maxLen); });

        response->addHeader("Content-Disposition", "attachment; filename=\"" + downloadName(filename) + "\"");

        request->send(response);
    });

    // DELETE /api/logs[/filename] — delete all logs or a specific file
    // @doc path: /api/logs
    // @doc method: DELETE
    // @doc summary: Delete all log files
    // @doc response: Ok
    // @doc path: /api/logs/{filename}
    // @doc method: DELETE
    // @doc summary: Delete a single log file
    // @doc param: filename string required
    // @doc response: Ok
    // @doc errors: 404=log not found
    loggedRoute("/api/logs", HTTP_DELETE, [this](AsyncWebServerRequest *request) -> int {
        String filename = request->url().substring(String("/api/logs/").length());

        if (filename.isEmpty()) {
            logger.deleteAllLogs();
            sendOk(request);
            return 200;
        }

        if (logger.deleteLog(filename)) {
            sendOk(request);
            return 200;
        }

        sendError(request, 404, "log not found");
        return 404;
    });

    LOG("WEB", "Log routes registered");
}

// -- System health endpoint ---------------------------------------------------

void WebServer::registerSystemRoutes() {
    // @tag System: ESP32 system health and lifecycle

    // GET /api/system — live system health (heap, uptime, RSSI, storage, NTP)
    // @doc path: /api/system
    // @doc method: GET
    // @doc summary: Get live system metrics (heap, uptime, WiFi RSSI, storage, NTP, time)
    // @doc response: SystemData
    loggedRoute("/api/system", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        request->send(200, "application/json", sysMgr.getSystemHealth(settingsMgr.get().tz).toJson());
        return 200;
    });

    // POST /api/system/restart — deferred restart
    // @doc path: /api/system/restart
    // @doc method: POST
    // @doc summary: Restart the ESP32 (deferred 500ms to flush HTTP response)
    // @doc response: Ok
    loggedRoute("/api/system/restart", HTTP_POST, [this](AsyncWebServerRequest *request) -> int {
        sendOk(request);
        sysMgr.restart();
        return 200;
    });

    // POST /api/system/reset — factory reset (clears NVS + WiFi, then restarts)
    // @doc path: /api/system/reset
    // @doc method: POST
    // @doc summary: Factory reset (clear NVS and WiFi credentials, then restart)
    // @doc response: Ok
    loggedRoute("/api/system/reset", HTTP_POST, [this](AsyncWebServerRequest *request) -> int {
        sendOk(request);
        sysMgr.factoryReset();
        return 200;
    });

    // POST /api/system/format-fs — format filesystem (erases logs + map data, then restarts)
    // @doc path: /api/system/format-fs
    // @doc method: POST
    // @doc summary: Format the SPIFFS filesystem (erases logs and history, then restart)
    // @doc response: Ok
    loggedRoute("/api/system/format-fs", HTTP_POST, [this](AsyncWebServerRequest *request) -> int {
        sendOk(request);
        sysMgr.formatFs();
        return 200;
    });

    LOG("WEB", "System routes registered");
}

// -- Settings endpoint -------------------------------------------------------

void WebServer::registerSettingsRoutes() {
    // @tag Settings: User-configurable bridge settings

    // GET /api/settings — all user-configurable settings
    // @doc path: /api/settings
    // @doc method: GET
    // @doc summary: Get all bridge settings (timezone, logging, WiFi, navigation, schedule, notifications)
    // @doc response: SettingsData
    loggedRoute("/api/settings", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        request->send(200, "application/json", settingsMgr.get().toJson());
        return 200;
    });

    // PUT /api/settings — partial update (only fields present are written)
    // @doc path: /api/settings
    // @doc method: PUT
    // @doc summary: Partial settings update (only fields present in body are written)
    // @doc body: SettingsData (partial)
    // @doc response: SettingsData
    // @doc errors: 400=invalid settings
    loggedBodyRoute("/api/settings", HTTP_PUT,
                    [this](AsyncWebServerRequest *request, uint8_t *data, size_t len) -> int {
                        String body = String(reinterpret_cast<const char *>(data), len);
                        ApplyResult result = settingsMgr.apply(body);
                        if (result == APPLY_INVALID) {
                            sendError(request, 400, "Invalid settings");
                            return 400;
                        }
                        if (result == APPLY_CHANGED) {
                            // Push manual clean settings to manager (no reboot needed)
                            const auto& s = settingsMgr.get();
                            manualMgr.setStallThreshold(s.stallThreshold);
                            manualMgr.setBrushRpm(s.brushRpm);
                            manualMgr.setVacuumSpeed(s.vacuumSpeed);
                            manualMgr.setSideBrushPower(s.sideBrushPower);
                        }
                        request->send(200, "application/json", settingsMgr.get().toJson());
                        return 200;
                    });

    // POST /api/notifications/test?topic=<topic> — send a test notification
    // @doc path: /api/notifications/test
    // @doc method: POST
    // @doc summary: Send a test push notification to the given ntfy.sh topic
    // @doc query: topic string required
    // @doc response: Ok
    // @doc errors: 400=missing or empty topic
    loggedRoute("/api/notifications/test", HTTP_POST, [this](AsyncWebServerRequest *request) -> int {
        if (!request->hasParam("topic")) {
            sendError(request, 400, "missing topic");
            return 400;
        }
        String topic = request->getParam("topic")->value();
        if (topic.isEmpty()) {
            sendError(request, 400, "topic cannot be empty");
            return 400;
        }
        notifMgr.sendTestNotification(topic);
        sendOk(request);
        return 200;
    });

    LOG("WEB", "Settings routes registered");
}

// -- Firmware endpoints -------------------------------------------------------

void WebServer::registerFirmwareRoutes() {
    // @tag Firmware: ESP32 firmware version and OTA update

    // GET /api/firmware/version — current ESP32 firmware version + chip model + robot support status
    // @doc path: /api/firmware/version
    // @doc method: GET
    // @doc summary: Get current ESP32 firmware version, chip model, robot model, and support status
    // @doc response: FirmwareVersion
    loggedRoute("/api/firmware/version", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        std::vector<Field> fields = {
                {"version", fwMgr.getFirmwareVersion(), FIELD_STRING},
                {"chip", fwMgr.getChipModel(), FIELD_STRING},
                {"model", neato.getModelName(), FIELD_STRING},
                {"hostname", settingsMgr.get().hostname, FIELD_STRING},
                {"supported", isSupportedModel(neato.getModelName()) ? "true" : "false", FIELD_BOOL},
                {"identifying", neato.isIdentifying() ? "true" : "false", FIELD_BOOL},
        };
        request->send(200, "application/json", fieldsToJson(fields));
        return 200;
    });

    // POST /api/firmware/update?hash=<md5> — single-request firmware upload
    // @doc path: /api/firmware/update
    // @doc method: POST
    // @doc summary: Upload a new firmware image and verify against the supplied MD5
    // @doc query: hash string required (MD5 of firmware binary)
    // @doc body: multipart/form-data file=<firmware.bin>
    // @doc response: text/plain "OK"
    // @doc errors: 400=update failed (bad hash, write error, or MD5 mismatch)
    server.on(
            "/api/firmware/update", HTTP_POST,
            // Response handler (called after upload completes)
            [this](AsyncWebServerRequest *request) {
                unsigned long startMs = millis();
                bool ok = fwMgr.getError().isEmpty();

                if (ok) {
                    ok = fwMgr.endUpdate();
                }

                if (!ok) {
                    logger.logRequest(HTTP_POST, "/api/firmware/update", 400, millis() - startMs);
                    sendError(request, 400, fwMgr.getError());
                } else {
                    logger.logRequest(HTTP_POST, "/api/firmware/update", 200, millis() - startMs);
                    AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", "OK");
                    response->addHeader("Connection", "close");
                    request->send(response);
                }
            },
            // Upload handler (called per chunk)
            [this](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len,
                   bool final) {
                // First chunk: initialize update session
                if (!index) {
                    String md5 = request->hasParam("hash") ? request->getParam("hash")->value() : "";
                    if (!fwMgr.beginUpdate(md5)) {
                        return;
                    }
                }

                if (len) {
                    fwMgr.writeChunk(data, len);

                    // Report progress at most once per second
                    static unsigned long lastProgressMs = 0;
                    unsigned long now = millis();
                    if (now - lastProgressMs >= 1000) {
                        auto percent = static_cast<uint8_t>(
                                request->contentLength() > 0 ? static_cast<float>(fwMgr.getProgress()) * 100.0f /
                                                                       static_cast<float>(request->contentLength())
                                                             : 0);
                        LOG("FW", "Progress: %u%% (%zu/%zu bytes)", percent, fwMgr.getProgress(),
                            request->contentLength());
                        lastProgressMs = now;
                    }
                }
            });

    LOG("WEB", "Firmware routes registered");
}

// -- Map data endpoints -------------------------------------------------------

void WebServer::registerMapRoutes() {
    // @tag History: Cleaning session history and map data

    // GET /api/history[/filename] — list sessions, collection status, or download a specific file
    // @doc path: /api/history
    // @doc method: GET
    // @doc summary: List all cleaning session files with embedded session and summary metadata
    // @doc response: array of HistoryFileInfo
    // @doc path: /api/history/{filename}
    // @doc method: GET
    // @doc summary: Download a single session file (transparently decompressed)
    // @doc param: filename string required
    // @doc response: application/x-ndjson
    // @doc errors: 404=session not found
    server.on("/api/history", HTTP_GET, [this](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        String suffix = request->url().substring(String("/api/history/").length());

        if (suffix.isEmpty()) {
            // List all session files with embedded session/summary metadata
            auto sessions = historyMgr.listSessions();
            String json = "[";
            for (size_t i = 0; i < sessions.size(); i++) {
                if (i > 0)
                    json += ",";
                const auto& s = sessions[i];
                json += R"({"name":")" + s.name + R"(","size":)" + String(static_cast<unsigned long>(s.size)) +
                        R"(,"compressed":)" + String(s.compressed ? "true" : "false") + R"(,"recording":)" +
                        String(s.recording ? "true" : "false");
                if (s.session.length() > 0) {
                    json += ",\"session\":" + s.session;
                } else {
                    json += ",\"session\":null";
                }
                if (s.summary.length() > 0) {
                    json += ",\"summary\":" + s.summary;
                } else {
                    json += ",\"summary\":null";
                }
                json += "}";
            }
            json += "]";
            logger.logRequest(HTTP_GET, "/api/history", 200, millis() - startMs);
            request->send(200, "application/json", json);
            return;
        }

        // Download specific session
        auto reader = historyMgr.readSession(suffix);
        if (!reader) {
            logger.logRequest(HTTP_GET, request->url().c_str(), 404, millis() - startMs);
            sendError(request, 404, "session not found");
            return;
        }

        logger.logRequest(HTTP_GET, request->url().c_str(), 200, millis() - startMs);

        AsyncWebServerResponse *response = request->beginChunkedResponse(
                "application/x-ndjson",
                [reader](uint8_t *buffer, size_t maxLen, size_t) -> size_t { return reader->read(buffer, maxLen); });

        response->addHeader("Content-Disposition", "attachment; filename=\"" + downloadName(suffix) + "\"");

        request->send(response);
    });

    // DELETE /api/history[/filename] — delete one or all sessions
    // @doc path: /api/history
    // @doc method: DELETE
    // @doc summary: Delete all cleaning session files
    // @doc response: Ok
    // @doc path: /api/history/{filename}
    // @doc method: DELETE
    // @doc summary: Delete a single cleaning session file
    // @doc param: filename string required
    // @doc response: Ok
    // @doc errors: 404=session not found
    loggedRoute("/api/history", HTTP_DELETE, [this](AsyncWebServerRequest *request) -> int {
        String filename = request->url().substring(String("/api/history/").length());

        if (filename.isEmpty()) {
            historyMgr.deleteAllSessions();
            sendOk(request);
            return 200;
        }

        if (historyMgr.deleteSession(filename)) {
            sendOk(request);
            return 200;
        }

        sendError(request, 404, "session not found");
        return 404;
    });

    // POST /api/history/import — upload a .jsonl session file, compress and store
    // @doc path: /api/history/import
    // @doc method: POST
    // @doc summary: Upload a JSONL session file (compressed and stored on flash)
    // @doc body: multipart/form-data file=<session.jsonl>
    // @doc response: Ok
    // @doc errors: 400=import failed (invalid file or write error)
    server.on(
            "/api/history/import", HTTP_POST,
            // Response handler (called after upload completes)
            [this](AsyncWebServerRequest *request) {
                unsigned long startMs = millis();
                bool ok = historyMgr.getImportError().isEmpty();

                if (ok) {
                    ok = historyMgr.endImport();
                }

                if (!ok) {
                    logger.logRequest(HTTP_POST, "/api/history/import", 400, millis() - startMs);
                    sendError(request, 400, historyMgr.getImportError());
                } else {
                    logger.logRequest(HTTP_POST, "/api/history/import", 200, millis() - startMs);
                    sendOk(request);
                }
            },
            // Upload handler (called per chunk)
            [this](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len,
                   bool final) {
                // First chunk: initialize import session
                if (!index) {
                    if (!historyMgr.beginImport(filename)) {
                        return;
                    }
                }

                if (len && historyMgr.isImporting()) {
                    historyMgr.writeImportChunk(data, len);
                }
            });

    LOG("WEB", "History routes registered");
}
