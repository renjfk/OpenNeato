#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <ESPAsyncWebServer.h>
#include "config.h"

class WebServer {
public:
    WebServer(AsyncWebServer &server);

    void begin();

private:
    AsyncWebServer &server;
};

#endif // WEB_SERVER_H
