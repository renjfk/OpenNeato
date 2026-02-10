#include "web_server.h"
#include "web_assets.h"

WebServer::WebServer(AsyncWebServer &server)
    : server(server) {
}

// Helper to send a gzipped PROGMEM asset
static void sendGzipAsset(AsyncWebServerRequest *request,
                          const uint8_t *data, size_t len,
                          const char *contentType) {
    AsyncWebServerResponse *response = request->beginResponse_P(
        200, contentType, data, len);
    response->addHeader("Content-Encoding", "gzip");
    request->send(response);
}

void WebServer::begin() {
    // Serve SPA index
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
        sendGzipAsset(request, INDEX_HTML_GZ, INDEX_HTML_GZ_LEN,
                      INDEX_HTML_CONTENT_TYPE);
    });

    // Serve app.js
    server.on("/app.js", HTTP_GET, [](AsyncWebServerRequest *request) {
        sendGzipAsset(request, APP_JS_GZ, APP_JS_GZ_LEN,
                      APP_JS_CONTENT_TYPE);
    });

    LOG("WEB", "Frontend routes registered");
}
