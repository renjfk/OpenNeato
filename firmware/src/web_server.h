#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <ESPAsyncWebServer.h>
#include <functional>
#include "config.h"
#include "neato_commands.h"
#include "data_logger.h"

class NeatoSerial;
class SystemManager;

class WebServer {
public:
    WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys);
    void begin();

private:
    AsyncWebServer& server;
    NeatoSerial& neato;
    DataLogger& logger;
    SystemManager& sysMgr;

    void registerApiRoutes();
    void registerLogRoutes();
    void registerSystemRoutes();
    static void sendGzipAsset(AsyncWebServerRequest *request, const uint8_t *data, size_t len, const char *contentType);
    static void sendError(AsyncWebServerRequest *request, int code, const String& msg);
    static void sendOk(AsyncWebServerRequest *request);

    // Wrap server.on() with automatic request timing and logging.
    // Handler returns the HTTP status code it sent; the wrapper logs it.
    using SyncHandler = std::function<int(AsyncWebServerRequest *)>;
    void loggedRoute(const char *path, WebRequestMethodComposite httpMethod, SyncHandler handler);

    // Overload for routes with a body callback (e.g. PUT with JSON body)
    using BodyHandler = std::function<int(AsyncWebServerRequest *, uint8_t *data, size_t len)>;
    void loggedBodyRoute(const char *path, WebRequestMethodComposite httpMethod, BodyHandler handler);

    // Register a GET endpoint that queries a typed Neato response and returns JSON
    template<typename T>
    void registerSensorRoute(const char *path, bool (NeatoSerial::*method)(std::function<void(bool, const T&)>),
                             std::function<String(const T&)> serialize);

    // Register a POST endpoint that sends an action command and returns {"ok":true}
    void registerActionRoute(const char *path, bool (NeatoSerial::*method)(std::function<void(bool)>));

    // Overload: dispatch via lambda (for commands needing request params)
    using ActionDispatch = std::function<bool(AsyncWebServerRequest *, std::function<void(bool)>)>;
    void registerActionRoute(const char *path, ActionDispatch dispatch);
};

// -- Template implementation (must be in header) -----------------------------

template<typename T>
void WebServer::registerSensorRoute(const char *path, bool (NeatoSerial::*method)(std::function<void(bool, const T&)>),
                                    std::function<String(const T&)> serialize) {
    server.on(path, HTTP_GET, [this, path, method, serialize](AsyncWebServerRequest *request) {
        unsigned long startMs = millis();
        auto weak = request->pause();
        if (!(neato.*method)([this, weak, path, serialize, startMs](bool ok, const T& data) {
                if (auto request = weak.lock()) {
                    unsigned long elapsed = millis() - startMs;
                    if (!ok) {
                        logger.logRequest(HTTP_GET, path, 504, elapsed);
                        sendError(request.get(), 504, "timeout");
                        return;
                    }
                    logger.logRequest(HTTP_GET, path, 200, elapsed);
                    request->send(200, "application/json", serialize(data));
                }
            })) {
            logger.logRequest(HTTP_GET, path, 503, 0);
            sendError(request, 503, "unavailable");
        }
    });
}

#endif // WEB_SERVER_H
