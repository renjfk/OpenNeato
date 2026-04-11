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
#include "scheduler.h"
#include "manual_clean_manager.h"
#include "notification_manager.h"
#include "cleaning_history.h"
#include "loop_task.h"

// Global objects
Preferences prefs;
AsyncWebServer server(80);
NeatoSerial neatoSerial;
SystemManager systemManager(prefs);
SettingsManager settingsManager(prefs);
DataLogger dataLogger(neatoSerial, systemManager);
WiFiManager wifiManager(prefs, dataLogger);
FirmwareManager firmwareManager(dataLogger);
Scheduler scheduler(settingsManager, systemManager, neatoSerial, dataLogger);
ManualCleanManager manualClean(neatoSerial);
NotificationManager notifMgr(neatoSerial, settingsManager, dataLogger);
CleaningHistory cleaningHistory(neatoSerial, dataLogger, systemManager);
WebServer webServer(server, neatoSerial, dataLogger, systemManager, firmwareManager, settingsManager, manualClean,
                    notifMgr, cleaningHistory);

// Tracks whether web server has been started (may be deferred if WiFi was slow at boot)
bool webServerStarted = false;

void setup() {
    Serial.begin(115200);
    delay(1000); // Wait for serial to be ready
    LOG("BOOT", "");
    LOG("BOOT", "========================================");
    LOG("BOOT", "%s Neato starting...", CHIP_MODEL);
    LOG("BOOT", "========================================");

    // Open shared NVS namespace (stays open for the lifetime of the device)
    prefs.begin(NVS_NAMESPACE, false);

    // Setup reset button
    pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);

    // Initialize settings first (loads pin config from NVS before UART init)
    LOG("BOOT", "Initializing settings...");
    settingsManager.onTzChange([&](const String& tz) { systemManager.applyTimezone(tz); });
    settingsManager.onTxPowerChange([&](int quarterDbm) { wifiManager.setTxPower(quarterDbm); });
    settingsManager.onRebootRequired([&] { systemManager.restart(); });
    settingsManager.begin();

    // Apply manual clean settings from NVS (stall threshold, motor speeds)
    const auto& s = settingsManager.get();
    manualClean.setStallThreshold(s.stallThreshold);
    manualClean.setBrushRpm(s.brushRpm);
    manualClean.setVacuumSpeed(s.vacuumSpeed);
    manualClean.setSideBrushPower(s.sideBrushPower);

    // Initialize notification manager
    notifMgr.begin();

    // Initialize Neato UART with configured pins
    LOG("BOOT", "Initializing Neato serial...");
    neatoSerial.begin(s.uartTxPin, s.uartRxPin);

    // Wire clean start hook so CleaningHistory switches to active polling
    // immediately when a clean command is sent via API.
    neatoSerial.onCleanStart([&] { cleaningHistory.notifyCleanStart(); });

    // Wire WiFi events to data logger BEFORE WiFi connects so boot events are captured.
    // DataLogger buffers entries in memory - they get flushed once SPIFFS mounts in begin().
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
        switch (event) {
            case ARDUINO_EVENT_WIFI_STA_CONNECTED:
                dataLogger.logWifi(
                        "connected",
                        {{"channel", String(info.wifi_sta_connected.channel), FIELD_INT},
                         {"ssid", String(reinterpret_cast<const char *>(info.wifi_sta_connected.ssid)), FIELD_STRING}});
                break;
            case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
                dataLogger.logWifi("disconnected", {{"reason", String(info.wifi_sta_disconnected.reason), FIELD_INT}});
                break;
            case ARDUINO_EVENT_WIFI_STA_GOT_IP:
                dataLogger.logWifi("got_ip", {{"ip", WiFi.localIP().toString(), FIELD_STRING},
                                              {"rssi", String(WiFi.RSSI()), FIELD_INT}});
                break;
            default:
                break;
        }
    });

    // Initialize WiFi with provisioning
    LOG("BOOT", "Initializing WiFi...");
    wifiManager.setHostname(settingsManager.get().hostname);
    wifiManager.begin();

    // Initialize system manager (NTP detection, time)
    LOG("BOOT", "Initializing system manager...");
    systemManager.begin();
    systemManager.applyTimezone(settingsManager.get().tz);

    // Wire NTP sync callback: log the event
    systemManager.onNtpSync([&] {
        time_t t = time(nullptr);
        dataLogger.logNtp("sync_ok", {{"epoch", String(static_cast<long>(t)), FIELD_INT}});
    });

    // Initialize web server and OTA if WiFi is already connected.
    // If WiFi is slow (e.g. DHCP timeout after OTA), the web server will be
    // started later in loop() once WiFi comes up — see deferred start below.
    if (wifiManager.isConnected()) {
        LOG("BOOT", "Initializing web server...");
        webServer.begin();
        LOG("BOOT", "Starting HTTP server...");
        server.begin();
        webServerStarted = true;

        // Mark firmware as valid — cancels auto-rollback on next reboot
        esp_ota_mark_app_valid_cancel_rollback();
        LOG("BOOT", "Firmware marked valid");
    } else {
        LOG("BOOT", "WiFi not ready — web server will start when connected");
    }

    // Initialize data logger (SPIFFS, serial command hook)
    // Note: WiFi/OTA events buffered in memory above get flushed once SPIFFS mounts here.
    LOG("BOOT", "Initializing data logger...");
    dataLogger.setLogLevelCheck([&]() { return settingsManager.get().logLevel; });
    dataLogger.begin();

    // Fetch robot time as fallback clock (parsed from "Time UTC" in GetVersion)
    neatoSerial.getVersion([](bool ok, const VersionData& v) {
        if (!ok || v.timeUtc == 0) {
            LOG("MAIN", "GetVersion time not available, no robot clock fallback");
            return;
        }
        systemManager.setFallbackClock(v.timeUtc);
        LOG("MAIN", "Robot clock fallback set from GetVersion: epoch %ld", static_cast<long>(v.timeUtc));
    });

    // Start task watchdog AFTER all slow init is complete (SPIFFS mount,
    // WiFi connect, etc.) so boot sequence doesn't trigger a false reset.
    systemManager.initTaskWdt();

    LOG("BOOT", "System initialization complete");

    // User-facing boot banner (visible in serial monitor / flash tool)
    if (wifiManager.isConnected()) {
        SerialMenu::printBanner("OpenNeato", FIRMWARE_VERSION,
                                "WiFi: " + WiFi.SSID() + " (" + WiFi.localIP().toString() + ")",
                                "Press 'm' for menu, 's' for status");
    } else {
        SerialMenu::printBanner("OpenNeato", FIRMWARE_VERSION, "WiFi: not configured");
    }

    // Show WiFi config menu if needed
    if (!wifiManager.isConnected()) {
        wifiManager.showMenu();
    }
}

void loop() {
    // Feed task watchdog — must happen every iteration to prevent TWDT reset
    systemManager.feedTaskWdt();

    // Deferred reboot — gives the web server time to flush the HTTP response
    systemManager.checkPendingReboot();

    // Handle WiFi configuration through serial
    wifiManager.handleSerialInput();

    // WiFi auto-reconnect with exponential backoff
    wifiManager.loop();

    // Deferred web server start — if WiFi was slow at boot (e.g. DHCP timeout
    // after OTA), start the web server once WiFi eventually connects.
    if (!webServerStarted && wifiManager.isConnected()) {
        LOG("MAIN", "WiFi connected late — starting web server now");
        dataLogger.logWifi("deferred_start");
        webServer.begin();
        server.begin();
        webServerStarted = true;

        esp_ota_mark_app_valid_cancel_rollback();
        LOG("MAIN", "Firmware marked valid (deferred)");
    }

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
                systemManager.factoryReset();
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

    // Tick all unconditionally-polled managers (registered via TaskRegistry::add in
    // each constructor): NeatoSerial, ManualCleanManager, SystemManager, DataLogger,
    // NotificationManager, Scheduler. Each respects its own LoopTask interval.
    TaskRegistry::tickAll();
}
