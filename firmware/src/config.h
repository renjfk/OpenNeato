#ifndef CONFIG_H
#define CONFIG_H

// WiFi Configuration
#define HOSTNAME "Neato"

// Pin Configuration (ESP32-C3 Boot button is GPIO9)
#define RESET_BUTTON_PIN 9

// Timing intervals (milliseconds)
#define WIFI_RECONNECT_INTERVAL 5000
#define RESET_BUTTON_HOLD_TIME 5000  // Hold for 5 seconds to reset

// Logging
#define ENABLE_LOGGING

#ifdef ENABLE_LOGGING
#define LOG(tag, fmt, ...) Serial.printf("[%s] " fmt "\n", tag, ##__VA_ARGS__)
#else
#define LOG(tag, fmt, ...)
#endif

#endif // CONFIG_H