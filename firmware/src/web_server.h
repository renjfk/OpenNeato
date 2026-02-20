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
class ManualCleanManager;

class WebServer {
public:
    WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys, FirmwareManager& fw,
              SettingsManager& settings, ManualCleanManager& manual);
    void begin();

    // Last time any API request was received (millis()). Any module can check
    // this to detect frontend connectivity without dedicated heartbeat calls.
    static unsigned long lastApiActivity;

private:
    AsyncWebServer& server;
    NeatoSerial& neato;
    DataLogger& logger;
    SystemManager& sysMgr;
    FirmwareManager& fwMgr;
    SettingsManager& settingsMgr;
    ManualCleanManager& manualMgr;

    void registerApiRoutes();
    void registerManualRoutes();
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

    // Register a GET endpoint that queries a typed response and returns JSON.
    // T must have a toJson() method. Works with any manager class.
    template<typename Mgr, typename T>
    void registerSensorRoute(const char *path, Mgr& mgr, void (Mgr::*method)(std::function<void(bool, const T&)>));

    // Register a POST action endpoint. Reads query params from the request,
    // converts them to the method's argument types, and calls the method.
    // Returns {"ok":true} on success, 504 on timeout, 503 if queue full.
    // Works with any manager class (NeatoSerial, ManualCleanManager, etc.).
    //
    // Each Args type maps to a query param name. An optional trailing default
    // value (const char*) is used when the param is missing from the request.
    // Supported types: bool (0/1), int/enum (toInt), const String& (raw string).

    // No-arg action
    template<typename Mgr>
    void registerActionRoute(const char *path, Mgr& mgr, bool (Mgr::*method)(std::function<void(bool)>));

    // Single-arg action with optional default value
    template<typename Mgr, typename A>
    void registerActionRoute(const char *path, Mgr& mgr, bool (Mgr::*method)(A, std::function<void(bool)>),
                             const char *paramName, const char *defaultValue = nullptr);

    // Three-arg action
    template<typename Mgr, typename A, typename B, typename C>
    void registerActionRoute(const char *path, Mgr& mgr, bool (Mgr::*method)(A, B, C, std::function<void(bool)>),
                             const char *p1, const char *p2, const char *p3);
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

template<typename Mgr, typename T>
void WebServer::registerSensorRoute(const char *path, Mgr& mgr,
                                    void (Mgr::*method)(std::function<void(bool, const T&)>)) {
    server.on(path, HTTP_GET, [this, path, &mgr, method](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        auto weak = request->pause();
        (mgr.*method)([this, weak, path, startMs](bool ok, const T& data) {
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

template<typename Mgr>
void WebServer::registerActionRoute(const char *path, Mgr& mgr, bool (Mgr::*method)(std::function<void(bool)>)) {
    server.on(path, HTTP_POST, [this, path, &mgr, method](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        auto weak = request->pause();
        if (!(mgr.*method)([this, weak, path, startMs](bool ok) {
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

template<typename Mgr, typename A>
void WebServer::registerActionRoute(const char *path, Mgr& mgr, bool (Mgr::*method)(A, std::function<void(bool)>),
                                    const char *paramName, const char *defaultValue) {
    using ConvertType = typename detail::StripRef<A>::type;
    server.on(path, HTTP_POST, [this, path, &mgr, method, paramName, defaultValue](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        String raw = request->hasParam(paramName) ? request->getParam(paramName)->value()
                                                  : String(defaultValue ? defaultValue : "");
        ConvertType arg = detail::paramConvert<ConvertType>(raw);
        auto weak = request->pause();
        if (!(mgr.*method)(arg, [this, weak, path, startMs](bool ok) {
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

template<typename Mgr, typename A, typename B, typename C>
void WebServer::registerActionRoute(const char *path, Mgr& mgr, bool (Mgr::*method)(A, B, C, std::function<void(bool)>),
                                    const char *p1, const char *p2, const char *p3) {
    using CA = typename detail::StripRef<A>::type;
    using CB = typename detail::StripRef<B>::type;
    using CC = typename detail::StripRef<C>::type;
    server.on(path, HTTP_POST, [this, path, &mgr, method, p1, p2, p3](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        CA a = detail::paramConvert<CA>(request->hasParam(p1) ? request->getParam(p1)->value() : String(""));
        CB b = detail::paramConvert<CB>(request->hasParam(p2) ? request->getParam(p2)->value() : String(""));
        CC c = detail::paramConvert<CC>(request->hasParam(p3) ? request->getParam(p3)->value() : String(""));
        auto weak = request->pause();
        if (!(mgr.*method)(a, b, c, [this, weak, path, startMs](bool ok) {
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
