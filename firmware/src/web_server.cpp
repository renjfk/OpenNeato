#include "web_server.h"
#include "web_assets.h"
#include "neato_serial.h"
#include "data_logger.h"
#include "system_manager.h"
#include <SPIFFS.h>

// Default serializer for structs with toFields()
template<typename T>
static std::function<String(const T&)> jsonFields() {
    return [](const T& data) { return fieldsToJson(data.toFields()); };
}

WebServer::WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys) :
    server(server), neato(neato), logger(logger), sysMgr(sys) {}

void WebServer::loggedRoute(const char *path, WebRequestMethodComposite httpMethod, SyncHandler handler) {
    server.on(path, httpMethod, [this, handler](AsyncWebServerRequest *request) {
        unsigned long startMs = millis();
        int status = handler(request);
        logger.logRequest(request->method(), request->url().c_str(), status, millis() - startMs);
    });
}

void WebServer::loggedBodyRoute(const char *path, WebRequestMethodComposite httpMethod, BodyHandler handler) {
    server.on(
            path, httpMethod, [](AsyncWebServerRequest *request) { /* handled in body callback */ }, nullptr,
            [this, handler](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t, size_t) {
                unsigned long startMs = millis();
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
    request->send(code, "application/json", R"({"error":")" + msg + R"("})");
}

void WebServer::sendOk(AsyncWebServerRequest *request) {
    request->send(200, "application/json", R"({"ok":true})");
}

void WebServer::registerActionRoute(const char *path, bool (NeatoSerial::*method)(std::function<void(bool)>)) {
    registerActionRoute(path, [this, method](AsyncWebServerRequest *, std::function<void(bool)> cb) {
        return (neato.*method)(cb);
    });
}

void WebServer::registerActionRoute(const char *path, ActionDispatch dispatch) {
    server.on(path, HTTP_POST, [this, path, dispatch](AsyncWebServerRequest *request) {
        unsigned long startMs = millis();
        auto weak = request->pause();
        if (!dispatch(request, [this, weak, path, startMs](bool ok) {
                if (auto request = weak.lock()) {
                    unsigned long elapsed = millis() - startMs;
                    if (!ok) {
                        logger.logRequest(HTTP_POST, path, 504, elapsed);
                        sendError(request.get(), 504, "timeout");
                        return;
                    }
                    logger.logRequest(HTTP_POST, path, 200, elapsed);
                    sendOk(request.get());
                }
            })) {
            logger.logRequest(HTTP_POST, path, 503, 0);
            sendError(request, 503, "unavailable");
        }
    });
}

void WebServer::begin() {
    // Serve SPA index
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
        sendGzipAsset(request, INDEX_HTML_GZ, INDEX_HTML_GZ_LEN, INDEX_HTML_CONTENT_TYPE);
    });

    // Serve app.js
    server.on("/app.js", HTTP_GET, [](AsyncWebServerRequest *request) {
        sendGzipAsset(request, APP_JS_GZ, APP_JS_GZ_LEN, APP_JS_CONTENT_TYPE);
    });

    registerApiRoutes();
    registerLogRoutes();
    registerSystemRoutes();

    LOG("WEB", "Frontend and API routes registered");
}

void WebServer::registerApiRoutes() {
    // -- Sensor query endpoints ----------------------------------------------

    registerSensorRoute<VersionData>("/api/version", &NeatoSerial::getVersion, jsonFields<VersionData>());
    registerSensorRoute<ChargerData>("/api/charger", &NeatoSerial::getCharger, jsonFields<ChargerData>());
    registerSensorRoute<AnalogSensorData>("/api/sensors/analog", &NeatoSerial::getAnalogSensors,
                                          jsonFields<AnalogSensorData>());
    registerSensorRoute<DigitalSensorData>("/api/sensors/digital", &NeatoSerial::getDigitalSensors,
                                           jsonFields<DigitalSensorData>());
    registerSensorRoute<MotorData>("/api/motors", &NeatoSerial::getMotors, jsonFields<MotorData>());
    registerSensorRoute<RobotState>("/api/state", &NeatoSerial::getState, jsonFields<RobotState>());
    registerSensorRoute<ErrorData>("/api/error", &NeatoSerial::getErr, jsonFields<ErrorData>());
    registerSensorRoute<AccelData>("/api/accel", &NeatoSerial::getAccel, jsonFields<AccelData>());
    registerSensorRoute<ButtonData>("/api/buttons", &NeatoSerial::getButtons, jsonFields<ButtonData>());
    registerSensorRoute<LdsScanData>(
            "/api/lidar", &NeatoSerial::getLdsScan,
            std::function<String(const LdsScanData&)>([](const LdsScanData& data) { return data.toJson(); }));

    // -- Action endpoints ----------------------------------------------------

    registerActionRoute("/api/clean/house", &NeatoSerial::cleanHouse);
    registerActionRoute("/api/clean/spot", &NeatoSerial::cleanSpot);
    registerActionRoute("/api/clean/stop", &NeatoSerial::cleanStop);

    // Sound requires a query parameter, dispatched via lambda overload
    registerActionRoute("/api/sound", [this](AsyncWebServerRequest *request, std::function<void(bool)> cb) {
        int id = request->getParam("id")->value().toInt();
        return neato.playSound(static_cast<SoundId>(id), cb);
    });

    LOG("WEB", "API routes registered");
}

// -- Log file endpoints ------------------------------------------------------

static String logListJson(const std::vector<LogFileInfo>& files) {
    String json = "[";
    for (size_t i = 0; i < files.size(); i++) {
        if (i > 0)
            json += ",";
        json += R"({"name":")" + files[i].name + R"(","size":)" + String(files[i].size) + R"(,"compressed":)" +
                (files[i].compressed ? "true" : "false") + "}";
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

// -- System health and timezone endpoints ------------------------------------

void WebServer::registerSystemRoutes() {
    // GET /api/system — live system health (heap, uptime, RSSI, SPIFFS, NTP)
    loggedRoute("/api/system", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        request->send(200, "application/json", sysMgr.systemHealthJson());
        return 200;
    });

    // GET /api/timezone — current POSIX TZ string
    loggedRoute("/api/timezone", HTTP_GET, [this](AsyncWebServerRequest *request) -> int {
        request->send(200, "application/json", R"({"tz":")" + sysMgr.getTimezone() + R"("})");
        return 200;
    });

    // PUT /api/timezone — set POSIX TZ string (body: {"tz":"..."})
    loggedBodyRoute("/api/timezone", HTTP_PUT,
                    [this](AsyncWebServerRequest *request, uint8_t *data, size_t len) -> int {
                        String body = String(reinterpret_cast<const char *>(data), len);

                        // Simple JSON parse: find "tz":"..." value
                        int tzStart = body.indexOf(R"("tz")");
                        if (tzStart < 0) {
                            sendError(request, 400, "missing tz field");
                            return 400;
                        }
                        int colonIdx = body.indexOf(':', tzStart);
                        int openQuote = body.indexOf('"', colonIdx + 1);
                        int closeQuote = body.indexOf('"', openQuote + 1);
                        if (openQuote < 0 || closeQuote < 0) {
                            sendError(request, 400, "invalid tz value");
                            return 400;
                        }

                        String tz = body.substring(openQuote + 1, closeQuote);
                        sysMgr.setTimezone(tz);
                        request->send(200, "application/json", R"({"tz":")" + tz + R"("})");
                        return 200;
                    });

    LOG("WEB", "System routes registered");
}
