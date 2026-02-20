#include "web_server.h"
#include "web_assets.h"
#include "neato_serial.h"
#include "data_logger.h"
#include "system_manager.h"
#include "settings_manager.h"
#include "firmware_manager.h"
#include "manual_clean_manager.h"
#include <SPIFFS.h>

unsigned long WebServer::lastApiActivity = 0;

WebServer::WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys,
                     FirmwareManager& fw, SettingsManager& settings, ManualCleanManager& manual) :
    server(server), neato(neato), logger(logger), sysMgr(sys), fwMgr(fw), settingsMgr(settings), manualMgr(manual) {}

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

    LOG("WEB", "Frontend and API routes registered");
}

void WebServer::registerApiRoutes() {
    // -- Sensor query endpoints ----------------------------------------------

    registerSensorRoute<NeatoSerial, VersionData>("/api/version", neato, &NeatoSerial::getVersion);
    registerSensorRoute<NeatoSerial, ChargerData>("/api/charger", neato, &NeatoSerial::getCharger);
    registerSensorRoute<NeatoSerial, AnalogSensorData>("/api/sensors/analog", neato, &NeatoSerial::getAnalogSensors);
    registerSensorRoute<NeatoSerial, DigitalSensorData>("/api/sensors/digital", neato, &NeatoSerial::getDigitalSensors);
    registerSensorRoute<NeatoSerial, MotorData>("/api/motors", neato, &NeatoSerial::getMotors);
    registerSensorRoute<NeatoSerial, RobotState>("/api/state", neato, &NeatoSerial::getState);
    registerSensorRoute<NeatoSerial, ErrorData>("/api/error", neato, &NeatoSerial::getErr);
    registerSensorRoute<NeatoSerial, AccelData>("/api/accel", neato, &NeatoSerial::getAccel);
    registerSensorRoute<NeatoSerial, ButtonData>("/api/buttons", neato, &NeatoSerial::getButtons);
    registerSensorRoute<NeatoSerial, LdsScanData>("/api/lidar", neato, &NeatoSerial::getLdsScan);

    // -- Action endpoints ----------------------------------------------------
    // All parameterized actions use query strings: resource URL identifies the
    // command, query params carry arguments (mirrors Neato serial protocol).

    registerActionRoute("/api/clean", neato, &NeatoSerial::clean, "action", "house");
    registerActionRoute("/api/sound", neato, &NeatoSerial::playSound, "id");
    registerActionRoute("/api/testmode", neato, &NeatoSerial::testMode, "enable");
    registerActionRoute("/api/lidar/rotate", neato, &NeatoSerial::setLdsRotation, "enable");

    LOG("WEB", "API routes registered");
}

// -- Manual clean endpoints ---------------------------------------------------

void WebServer::registerManualRoutes() {
    // Register longer paths first — ESPAsyncWebServer matches routes by prefix,
    // so /api/manual would swallow /api/manual/move and /api/manual/motors.
    loggedRoute("/api/manual/status", HTTP_GET, [this](AsyncWebServerRequest *request) {
        request->send(200, "application/json", manualMgr.getStatusJson());
        return 200;
    });
    registerActionRoute("/api/manual/move", manualMgr, &ManualCleanManager::move, "left", "right", "speed");
    registerActionRoute("/api/manual/motors", manualMgr, &ManualCleanManager::setMotors, "brush", "vacuum",
                        "sideBrush");
    registerActionRoute("/api/manual", manualMgr, &ManualCleanManager::enable, "enable");

    LOG("WEB", "Manual clean routes registered");
}

// -- Log file endpoints ------------------------------------------------------

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
    // GET /api/logs[/filename] — list logs or download a specific file
    // A single BackwardCompatible handler matches both "/api/logs" and "/api/logs/..."
    // This route uses server.on() directly instead of loggedRoute() because
    // compressed log downloads use chunked streaming (beginChunkedResponse) which
    // must not block — loggedRoute's sync wrapper would block until completion.
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
        request->send(response);
    });

    // DELETE /api/logs[/filename] — delete all logs or a specific file
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
    // GET /api/system — live system health (heap, uptime, RSSI, SPIFFS, NTP)
    loggedRoute("/api/system", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        request->send(200, "application/json", sysMgr.getSystemHealth(settingsMgr.get().tz).toJson());
        return 200;
    });

    // POST /api/system/restart — deferred restart
    loggedRoute("/api/system/restart", HTTP_POST, [this](AsyncWebServerRequest *request) -> int {
        sendOk(request);
        sysMgr.restart();
        return 200;
    });

    // POST /api/system/reset — factory reset (clears NVS + WiFi, then restarts)
    loggedRoute("/api/system/reset", HTTP_POST, [this](AsyncWebServerRequest *request) -> int {
        sendOk(request);
        sysMgr.factoryReset();
        return 200;
    });

    LOG("WEB", "System routes registered");
}

// -- Settings endpoint -------------------------------------------------------

void WebServer::registerSettingsRoutes() {
    // GET /api/settings — all user-configurable settings
    loggedRoute("/api/settings", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        request->send(200, "application/json", settingsMgr.get().toJson());
        return 200;
    });

    // PUT /api/settings — partial update (only fields present are written)
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

    LOG("WEB", "Settings routes registered");
}

// -- Firmware endpoints -------------------------------------------------------

void WebServer::registerFirmwareRoutes() {
    // GET /api/firmware/version — current ESP32 firmware version + chip model
    loggedRoute("/api/firmware/version", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        std::vector<Field> fields = {
                {"version", fwMgr.getFirmwareVersion(), FIELD_STRING},
                {"chip", fwMgr.getChipModel(), FIELD_STRING},
        };
        request->send(200, "application/json", fieldsToJson(fields));
        return 200;
    });

    // POST /api/firmware/update?hash=<md5> — single-request firmware upload
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
