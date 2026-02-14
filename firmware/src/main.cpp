#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_ota_ops.h>
#include "config.h"
#include "wifi_manager.h"
#include "firmware_manager.h"
#include "system_manager.h"
#include "settings_manager.h"
#include "web_server.h"
#include "neato_serial.h"
#include "data_logger.h"

// Global objects
Preferences prefs;
AsyncWebServer server(80);
NeatoSerial neatoSerial;
WiFiManager wifiManager(prefs);
FirmwareManager firmwareManager;
SystemManager systemManager(prefs);
SettingsManager settingsManager(prefs);
DataLogger dataLogger(neatoSerial, systemManager);
WebServer webServer(server, neatoSerial, dataLogger, systemManager, firmwareManager, settingsManager);

// Robot time sync state (managed here, not in SystemManager)
unsigned long lastRobotSync = 0;

// Push NTP time to robot clock via SetTime
static void syncRobotClock() {
    time_t t = time(nullptr);
    if (t <= 1700000000)
        return;

    struct tm tm;
    localtime_r(&t, &tm);

    neatoSerial.setTime(tm.tm_wday, tm.tm_hour, tm.tm_min, tm.tm_sec,
                        [](bool ok) { LOG("MAIN", "Robot clock sync %s", ok ? "OK" : "FAILED"); });
}

void setup() {
    Serial.begin(115200);
    delay(1000); // Wait for serial to be ready
    LOG("BOOT", "");
    LOG("BOOT", "========================================");
    LOG("BOOT", "ESP32-C3 Neato starting...");
    LOG("BOOT", "========================================");

    // Open shared NVS namespace (stays open for the lifetime of the device)
    prefs.begin(NVS_NAMESPACE, false);

    // Setup reset button
    pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);

    // Initialize Neato UART
    LOG("BOOT", "Initializing Neato serial...");
    neatoSerial.begin();

    // Initialize WiFi with provisioning
    LOG("BOOT", "Initializing WiFi...");
    wifiManager.begin();

    // Initialize system manager (NTP detection, time)
    LOG("BOOT", "Initializing system manager...");
    systemManager.begin();

    // Initialize settings (loads from NVS, wires timezone to NTP)
    LOG("BOOT", "Initializing settings...");
    settingsManager.onTzChange([&](const String& tz) { systemManager.applyTimezone(tz); });
    settingsManager.begin();
    systemManager.applyTimezone(settingsManager.get().tz);

    // Wire NTP sync callback: push time to robot, log the event
    systemManager.onNtpSync([&] {
        time_t t = time(nullptr);
        dataLogger.logNtp("sync_ok", {{"epoch", String(static_cast<long>(t)), FIELD_INT}});
        syncRobotClock();
        lastRobotSync = millis();
    });

    // Initialize web server and OTA only if WiFi is connected
    if (wifiManager.isConnected()) {
        LOG("BOOT", "Initializing web server...");
        webServer.begin();
        LOG("BOOT", "Starting HTTP server...");
        server.begin();

        // Mark firmware as valid — cancels auto-rollback on next reboot
        esp_ota_mark_app_valid_cancel_rollback();
        LOG("BOOT", "Firmware marked valid");
    } else {
        LOG("BOOT", "Skipping web server (no WiFi connection)");
        LOG("BOOT", "Configure WiFi through serial menu");
    }

    // Initialize data logger (SPIFFS, serial command hook)
    LOG("BOOT", "Initializing data logger...");
    dataLogger.setDebugCheck([&]() { return settingsManager.get().debugLog; });
    dataLogger.begin();

    // Fetch robot time as fallback clock
    neatoSerial.getTime([](bool ok, const TimeData& t) {
        if (!ok) {
            LOG("MAIN", "GetTime failed, no robot clock available");
            return;
        }
        struct tm tm = {};
        tm.tm_year = 2025 - 1900;
        tm.tm_mon = 0;
        tm.tm_mday = 1;
        tm.tm_hour = t.hour;
        tm.tm_min = t.minute;
        tm.tm_sec = t.second;
        time_t epoch = mktime(&tm);
        systemManager.setFallbackClock(epoch);
        LOG("MAIN", "Robot time: %02d:%02d:%02d -> epoch %ld", t.hour, t.minute, t.second, static_cast<long>(epoch));
    });

    // Wire firmware update events to data logger
    firmwareManager.setLogger(
            [](const String& event, const std::vector<Field>& extra) { dataLogger.logOta(event, extra); });

    // Wire WiFi events to data logger
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
        switch (event) {
            case ARDUINO_EVENT_WIFI_STA_CONNECTED:
                dataLogger.logWifi("connected");
                break;
            case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
                dataLogger.logWifi("disconnected", {{"reason", String(info.wifi_sta_disconnected.reason), FIELD_INT}});
                break;
            case ARDUINO_EVENT_WIFI_STA_GOT_IP:
                dataLogger.logWifi("got_ip", {{"ip", WiFi.localIP().toString(), FIELD_STRING}});
                break;
            default:
                break;
        }
    });

    LOG("BOOT", "========================================");
    LOG("BOOT", "System initialization complete");
    LOG("BOOT", "========================================");

    // Show WiFi config menu if needed (after all boot messages)
    if (!wifiManager.isConnected()) {
        wifiManager.showMenu();
    } else {
        LOG("BOOT", "");
        LOG("BOOT", "Quick commands: [m]enu, [s]tatus");
    }
}

void loop() {
    // Handle WiFi configuration through serial
    wifiManager.handleSerialInput();

    // Check for button press (runtime reset)
    static unsigned long buttonPressStart = 0;
    static bool buttonWasPressed = false;

    if (digitalRead(RESET_BUTTON_PIN) == LOW) {
        if (!buttonWasPressed) {
            // Button just pressed
            buttonPressStart = millis();
            buttonWasPressed = true;
            LOG("BUTTON", "Button pressed - hold for 5 seconds to factory reset");
        } else {
            // Button still held
            unsigned long holdTime = millis() - buttonPressStart;
            if (holdTime >= RESET_BUTTON_HOLD_TIME) {
                LOG("BUTTON", "FACTORY RESET!");
                prefs.clear();
                WiFi.disconnect(true, true);
                delay(1000);
                ESP.restart();
            }
        }
    } else {
        if (buttonWasPressed) {
            LOG("BUTTON", "Button released");
            buttonWasPressed = false;
        }
    }

    // Firmware update handling (only if connected)
    if (wifiManager.isConnected()) {
        firmwareManager.loop();

        // Skip other operations during firmware update
        if (firmwareManager.isInProgress()) {
            return;
        }
    }

    // Pump Neato serial command queue
    neatoSerial.loop();

    // System manager housekeeping (NTP detection)
    systemManager.loop();

    // Data logger housekeeping (flush buffer, compression, bulk delete)
    dataLogger.loop();

    // Periodic robot time re-sync from NTP (every 4 hours)
    if (systemManager.isNtpSynced() && millis() - lastRobotSync >= ROBOT_TIME_SYNC_INTERVAL_MS) {
        syncRobotClock();
        lastRobotSync = millis();
    }
}
