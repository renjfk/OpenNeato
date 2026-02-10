#include "ota_handler.h"

OTAHandler::OTAHandler(AsyncWebServer &server)
    : server(server) {
}

void OTAHandler::begin() {
    ElegantOTA.begin(&server);

    // OTA start callback
    ElegantOTA.onStart([this]() {
        LOG("OTA", "Update started");
        otaInProgress = true;
    });

    // OTA progress callback
    ElegantOTA.onProgress([this](const size_t bytesReceived, const size_t totalSize) {
        static unsigned long lastUpdate = 0;

        if (totalSize == 0) {
            LOG("OTA", "Progress: %zu/%zu bytes (totalSize=0)", bytesReceived, totalSize);
            return;
        }

        const unsigned long now = millis();
        if (now - lastUpdate >= 1000) {
            const auto progress = static_cast<uint8_t>(
                static_cast<float>(bytesReceived) * 100.0f / static_cast<float>(totalSize));
            LOG("OTA", "Progress: %u%% (%zu/%zu bytes)", progress, bytesReceived, totalSize);

            lastUpdate = now;
        }
    });

    // OTA end callback
    ElegantOTA.onEnd([this](const bool success) {
        if (success) {
            LOG("OTA", "Update successful!");
        } else {
            LOG("OTA", "Update failed!");
        }
        // Note: otaInProgress flag stays true until reboot
    });

    server.begin();
    LOG("OTA", "ElegantOTA started on http://%s.home", HOSTNAME);
}

void OTAHandler::loop() {
    ElegantOTA.loop();
}