#ifndef OTA_HANDLER_H
#define OTA_HANDLER_H

#include <ESPAsyncWebServer.h>
#include <ElegantOTA.h>
#include "config.h"

class OTAHandler {
public:
    OTAHandler(AsyncWebServer &server);

    void begin();

    void loop();

    bool isInProgress() const { return otaInProgress; }

private:
    AsyncWebServer &server;
    bool otaInProgress = false;
};

#endif // OTA_HANDLER_H