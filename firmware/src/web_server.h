#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <ESPAsyncWebServer.h>
#include <array>
#include <functional>
#include <initializer_list>
#include <tuple>
#include "config.h"
#include "neato_commands.h"
#include "data_logger.h"

class NeatoSerial;
class SystemManager;
class FirmwareManager;
class SettingsManager;
class ManualCleanManager;
class NotificationManager;
class CleaningHistory;
class WiFiManager;

class WebServer {
public:
    WebServer(AsyncWebServer& server, NeatoSerial& neato, DataLogger& logger, SystemManager& sys, FirmwareManager& fw,
              SettingsManager& settings, ManualCleanManager& manual, NotificationManager& notif,
              CleaningHistory& history, WiFiManager& wifi);
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
    NotificationManager& notifMgr;
    CleaningHistory& historyMgr;
    WiFiManager& wifiMgr;

    void registerApiRoutes();
    void registerManualRoutes();
    void registerLogRoutes();
    void registerSystemRoutes();
    void registerSettingsRoutes();
    void registerFirmwareRoutes();
    void registerMapRoutes();
    void registerWiFiRoutes();
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

    // Register a GET endpoint. The method pointer type fully determines the arg
    // count and data type. Pass one param name per user arg; {} for no-arg methods.
    // Expected: void (Mgr::*)(UserArgs..., std::function<void(bool, const T&)>)
    template<typename Mgr, typename Method>
    void registerGetRoute(const char *path, Mgr& mgr, Method method, std::initializer_list<const char *> paramNames);

    // Register a POST action endpoint. Returns {"ok":true} / 504 / 503.
    // Pass one param name per user arg; {} for no-arg methods.
    // Expected: bool (Mgr::*)(UserArgs..., std::function<void(bool)>)
    template<typename Mgr, typename Method>
    void registerPostRoute(const char *path, Mgr& mgr, Method method, std::initializer_list<const char *> paramNames);
};

// -- Template helpers --------------------------------------------------------

namespace detail {

    // Hand-rolled index sequence (GCC 8.4 / Arduino may not expose std::index_sequence).
    template<size_t... I>
    struct IndexSeq {};

    template<size_t N, size_t... I>
    struct MakeIndexSeq : MakeIndexSeq<N - 1, N - 1, I...> {};

    template<size_t... I>
    struct MakeIndexSeq<0, I...> {
        using type = IndexSeq<I...>;
    };

    template<size_t N>
    using MakeIndexSequence = typename MakeIndexSeq<N>::type;

    // -------------------------------------------------------------------------
    // paramConvert: string -> typed value.
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

    // StripRef: remove const& for paramConvert lookup.
    template<typename T>
    struct StripRef {
        using type = T;
    };
    template<typename T>
    struct StripRef<const T&> {
        using type = T;
    };

    inline String paramRaw(AsyncWebServerRequest *request, const char *name) {
        return request->hasParam(name) ? request->getParam(name)->value() : String("");
    }

    template<size_t N>
    std::array<const char *, N> toArray(std::initializer_list<const char *> names) {
        std::array<const char *, N> arr{};
        size_t i = 0;
        for (const char *n: names)
            arr[i++] = n;
        return arr;
    }

    // -------------------------------------------------------------------------
    // Method pointer traits.
    //
    // Partial specialisation on  Ret(Mgr::*)(A0, A1, ..., An)  where the full
    // arg list AllArgs... is deducible (no trailing fixed type).  We then peel
    // the last element (the callback) off AllArgs at compile time to obtain the
    // user arg pack.
    //
    // NArgs = sizeof...(AllArgs) - 1
    // UserArgsTuple = tuple<AllArgs[0], ..., AllArgs[NArgs-1]>
    // -------------------------------------------------------------------------

    // TupleHead<N, Tuple>: first N elements of Tuple as a new tuple type.
    template<size_t N, typename Tuple, typename Seq = MakeIndexSequence<N>>
    struct TupleHead;

    template<size_t N, typename Tuple, size_t... I>
    struct TupleHead<N, Tuple, IndexSeq<I...>> {
        using type = std::tuple<typename std::tuple_element<I, Tuple>::type...>;
    };

    // DispatchGet: call (mgr.*method)(convertedArgs..., cb) for a GET handler.
    template<typename Mgr, typename MethodPtr, typename T, typename UserArgsTuple, size_t NArgs>
    struct DispatchGet {
        using Cb = std::function<void(bool, const T&)>;
        using Names = std::array<const char *, NArgs>;

        template<size_t... I>
        static void invoke(Mgr& mgr, MethodPtr method, AsyncWebServerRequest *request, const Names& names, const Cb& cb,
                           IndexSeq<I...>) {
            (mgr.*method)(paramConvert<typename StripRef<typename std::tuple_element<I, UserArgsTuple>::type>::type>(
                                  paramRaw(request, names[I]))...,
                          cb);
        }
    };

    // DispatchPost: call (mgr.*method)(convertedArgs..., cb) for a POST handler.
    template<typename Mgr, typename MethodPtr, typename UserArgsTuple, size_t NArgs>
    struct DispatchPost {
        using Cb = std::function<void(bool)>;
        using Names = std::array<const char *, NArgs>;

        template<size_t... I>
        static bool invoke(Mgr& mgr, MethodPtr method, AsyncWebServerRequest *request, const Names& names, const Cb& cb,
                           IndexSeq<I...>) {
            return (mgr.*
                    method)(paramConvert<typename StripRef<typename std::tuple_element<I, UserArgsTuple>::type>::type>(
                                    paramRaw(request, names[I]))...,
                            cb);
        }
    };

    // StdFunctionArg<F, I>: extracts the I-th argument type of a std::function.
    template<typename F, size_t I>
    struct StdFunctionArg;

    template<typename... FArgs, size_t I>
    struct StdFunctionArg<std::function<void(FArgs...)>, I> {
        using type = typename std::tuple_element<I, std::tuple<FArgs...>>::type;
    };

    // GetMethodTraits: specialise on void(Mgr::*)(AllArgs...) — ALL args including cb.
    template<typename M>
    struct GetMethodTraits; // undefined base

    template<typename Mgr, typename... AllArgs>
    struct GetMethodTraits<void (Mgr::*)(AllArgs...)> {
        using AllArgsTuple = std::tuple<AllArgs...>;
        static constexpr size_t NArgs = sizeof...(AllArgs) - 1; // exclude cb
        using UserArgsTuple = typename TupleHead<NArgs, AllArgsTuple>::type;
        using MethodPtr = void (Mgr::*)(AllArgs...);
        using Cb = typename std::tuple_element<NArgs, AllArgsTuple>::type;
        // DataType = T from std::function<void(bool, const T&)>:
        // second arg of Cb stripped of const&.
        using DataType = typename StripRef<typename StdFunctionArg<Cb, 1>::type>::type;
        using Names = std::array<const char *, NArgs>;
    };

    // PostMethodTraits: specialise on bool(Mgr::*)(AllArgs...).
    template<typename M>
    struct PostMethodTraits; // undefined base

    template<typename Mgr, typename... AllArgs>
    struct PostMethodTraits<bool (Mgr::*)(AllArgs...)> {
        using AllArgsTuple = std::tuple<AllArgs...>;
        static constexpr size_t NArgs = sizeof...(AllArgs) - 1;
        using UserArgsTuple = typename TupleHead<NArgs, AllArgsTuple>::type;
        using MethodPtr = bool (Mgr::*)(AllArgs...);
        using Cb = std::function<void(bool)>;
        using Names = std::array<const char *, NArgs>;
    };

} // namespace detail

// -- Template implementation (must be in header) -----------------------------

// registerGetRoute

template<typename Mgr, typename Method>
void WebServer::registerGetRoute(const char *path, Mgr& mgr, Method method,
                                 std::initializer_list<const char *> paramNames) {
    using Traits = detail::GetMethodTraits<Method>;
    using T = typename Traits::DataType;
    using Cb = typename Traits::Cb;
    using UserArgsTuple = typename Traits::UserArgsTuple;
    static constexpr size_t NArgs = Traits::NArgs;
    auto names = detail::toArray<NArgs>(paramNames);
    server.on(path, HTTP_GET, [this, path, &mgr, method, names](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        auto weak = request->pause();
        Cb cb = [this, weak, path, startMs](bool ok, const T& data) {
            if (auto req = weak.lock()) {
                unsigned long elapsed = millis() - startMs;
                if (!ok) {
                    logger.logRequest(HTTP_GET, path, 504, elapsed);
                    sendError(req.get(), 504, "timeout");
                    return;
                }
                logger.logRequest(HTTP_GET, path, 200, elapsed);
                req->send(200, "application/json", data.toJson());
            }
        };
        detail::DispatchGet<Mgr, Method, T, UserArgsTuple, NArgs>::invoke(mgr, method, request, names, cb,
                                                                          detail::MakeIndexSequence<NArgs>{});
    });
}

// registerPostRoute

template<typename Mgr, typename Method>
void WebServer::registerPostRoute(const char *path, Mgr& mgr, Method method,
                                  std::initializer_list<const char *> paramNames) {
    using Traits = detail::PostMethodTraits<Method>;
    using UserArgsTuple = typename Traits::UserArgsTuple;
    static constexpr size_t NArgs = Traits::NArgs;
    auto names = detail::toArray<NArgs>(paramNames);
    server.on(path, HTTP_POST, [this, path, &mgr, method, names](AsyncWebServerRequest *request) {
        lastApiActivity = millis();
        unsigned long startMs = lastApiActivity;
        auto weak = request->pause();
        typename Traits::Cb cb = [this, weak, path, startMs](bool ok) {
            if (auto req = weak.lock()) {
                unsigned long elapsed = millis() - startMs;
                if (!ok) {
                    logger.logRequest(HTTP_POST, path, 504, elapsed);
                    sendError(req.get(), 504, "timeout");
                    return;
                }
                logger.logRequest(HTTP_POST, path, 200, elapsed);
                sendOk(req.get());
            }
        };
        if (!detail::DispatchPost<Mgr, Method, UserArgsTuple, NArgs>::invoke(mgr, method, request, names, cb,
                                                                             detail::MakeIndexSequence<NArgs>{})) {
            logger.logRequest(HTTP_POST, path, 503, 0);
            sendError(request, 503, "unavailable");
        }
    });
}

#endif // WEB_SERVER_H
