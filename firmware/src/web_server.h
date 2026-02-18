#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <ESPAsyncWebServer.h>
#include <functional>
#include "config.h"
#include "neato_commands.h"
#include "data_logger.h"

class NeatoSerial;
class SystemManager;
class FirmwareManager;
class SettingsManager;

class WebServer {
public:
    WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys, FirmwareManager& fw,
              SettingsManager& settings);
    void begin();

private:
    AsyncWebServer& server;
    NeatoSerial& neato;
    DataLogger& logger;
    SystemManager& sysMgr;
    FirmwareManager& fwMgr;
    SettingsManager& settingsMgr;

    void registerApiRoutes();
    void registerLogRoutes();
    void registerSystemRoutes();
    void registerSettingsRoutes();
    void registerFirmwareRoutes();
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

    // Register a GET endpoint that queries a typed Neato response and returns JSON.
    // T must have a toJson() method (JsonSerializable or custom).
    template<typename T>
    void registerSensorRoute(const char *path, void (NeatoSerial::*method)(std::function<void(bool, const T&)>));

    // Register a POST action endpoint. Reads query params from the request,
    // converts them to the method's argument types, and calls the NeatoSerial
    // method. Returns {"ok":true} on success, 504 on timeout, 503 if queue full.
    //
    // Usage:
    //   registerActionRoute<bool>("/api/testmode", &NeatoSerial::testMode, "enable");
    //   registerActionRoute<const String&>("/api/clean", &NeatoSerial::clean, "action", "house");
    //
    // Each Args type maps to a query param name. An optional trailing default
    // value (const char*) is used when the param is missing from the request.
    // Supported types: bool (0/1), int/enum (toInt), const String& (raw string).

    // Single-arg action with default value
    template<typename A>
    void registerActionRoute(const char *path, bool (NeatoSerial::*method)(A, std::function<void(bool)>),
                             const char *paramName, const char *defaultValue = nullptr);

    // No-arg action (no query params needed)
    void registerActionRoute(const char *path, bool (NeatoSerial::*method)(std::function<void(bool)>));
};

// -- Template helpers (query param -> typed value) ---------------------------

namespace detail {

    // Generic: parse query param string to target type
    template<typename T>
    T paramConvert(const String& value);
    template<>
    inline bool paramConvert<bool>(const String& value) {
        return value.toInt() != 0;
    }
    template<>
    inline int paramConvert<int>(const String& value) {
        return value.toInt();
    }
    template<>
    inline SoundId paramConvert<SoundId>(const String& value) {
        return static_cast<SoundId>(value.toInt());
    }
    template<>
    inline String paramConvert<String>(const String& value) {
        return value;
    }

    // Strip reference/const from the method arg type for conversion lookup
    template<typename T>
    struct StripRef {
        using type = T;
    };
    template<typename T>
    struct StripRef<const T&> {
        using type = T;
    };

} // namespace detail

// -- Template implementation (must be in header) -----------------------------

template<typename T>
void WebServer::registerSensorRoute(const char *path,
                                    void (NeatoSerial::*method)(std::function<void(bool, const T&)>)) {
    server.on(path, HTTP_GET, [this, path, method](AsyncWebServerRequest *request) {
        unsigned long startMs = millis();
        auto weak = request->pause();
        (neato.*method)([this, weak, path, startMs](bool ok, const T& data) {
            if (auto request = weak.lock()) {
                unsigned long elapsed = millis() - startMs;
                if (!ok) {
                    logger.logRequest(HTTP_GET, path, 504, elapsed);
                    sendError(request.get(), 504, "timeout");
                    return;
                }
                logger.logRequest(HTTP_GET, path, 200, elapsed);
                request->send(200, "application/json", data.toJson());
            }
        });
    });
}

template<typename A>
void WebServer::registerActionRoute(const char *path, bool (NeatoSerial::*method)(A, std::function<void(bool)>),
                                    const char *paramName, const char *defaultValue) {
    using ConvertType = typename detail::StripRef<A>::type;
    server.on(path, HTTP_POST, [this, path, method, paramName, defaultValue](AsyncWebServerRequest *request) {
        unsigned long startMs = millis();
        String raw = request->hasParam(paramName) ? request->getParam(paramName)->value()
                                                  : String(defaultValue ? defaultValue : "");
        ConvertType arg = detail::paramConvert<ConvertType>(raw);
        auto weak = request->pause();
        if (!(neato.*method)(arg, [this, weak, path, startMs](bool ok) {
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

#endif // WEB_SERVER_H
