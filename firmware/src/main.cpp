#include <Arduino.h>
#include "config.h"
#include "wifi_manager.h"
#include "ota_handler.h"
#include "web_server.h"

// Global objects
AsyncWebServer server(80);
WiFiMgr wifiManager;
OTAHandler otaHandler(server);
WebServer webServer(server);

void setup() {
    Serial.begin(115200);
    delay(1000); // Wait for serial to be ready
    LOG("BOOT", "");
    LOG("BOOT", "========================================");
    LOG("BOOT", "ESP32-C3 Neato starting...");
    LOG("BOOT", "========================================");

    // Setup reset button
    pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
    delay(100); // Small delay for pin to stabilize

    // Read and log button state for debugging
    int buttonState = digitalRead(RESET_BUTTON_PIN);
    LOG("BOOT", "Button pin %d state: %s", RESET_BUTTON_PIN, buttonState == LOW ? "PRESSED" : "RELEASED");

    // Check if button is held during boot for factory reset
    if (buttonState == LOW) {
        LOG("BOOT", "Reset button detected on boot!");
        LOG("BOOT", "Hold for 5 seconds to reset WiFi credentials...");

        unsigned long pressStart = millis();
        bool resetConfirmed = false;
        int countdown = 5;

        while (digitalRead(RESET_BUTTON_PIN) == LOW) {
            unsigned long elapsed = millis() - pressStart;
            int currentCountdown = 5 - (elapsed / 1000);

            if (currentCountdown != countdown) {
                countdown = currentCountdown;
                LOG("BOOT", "Resetting in %d seconds...", countdown);
            }

            if (elapsed >= RESET_BUTTON_HOLD_TIME) {
                LOG("BOOT", "RESETTING WiFi credentials!");
                wifiManager.reset();
                resetConfirmed = true;
                break;
            }
            delay(100);
        }

        if (!resetConfirmed) {
            LOG("BOOT", "Reset cancelled - button released too early");
        }
    }

    // Initialize WiFi with provisioning
    LOG("BOOT", "Initializing WiFi...");
    wifiManager.begin();

    // Initialize OTA only if WiFi is connected
    if (wifiManager.isConnected()) {
        LOG("BOOT", "Initializing web server...");
        webServer.begin();
        LOG("BOOT", "Initializing OTA...");
        otaHandler.begin();
    } else {
        LOG("BOOT", "Skipping OTA (no WiFi connection)");
        LOG("BOOT", "Configure WiFi through serial menu");
    }

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
            LOG("BUTTON", "Button pressed - hold for 5 seconds to reset");
        } else {
            // Button still held
            unsigned long holdTime = millis() - buttonPressStart;
            if (holdTime >= RESET_BUTTON_HOLD_TIME) {
                LOG("BUTTON", "RESETTING WiFi credentials!");
                wifiManager.reset();
            }
        }
    } else {
        if (buttonWasPressed) {
            LOG("BUTTON", "Button released");
            buttonWasPressed = false;
        }
    }

    // Note: Serial commands are now handled by wifiManager.handleSerialInput()

    // OTA handling (only if connected)
    if (wifiManager.isConnected()) {
        otaHandler.loop();

        // Skip other operations during OTA
        if (otaHandler.isInProgress()) {
            return;
        }
    }

    // Add your application logic here
    delay(100);
}
