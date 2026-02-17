#ifndef CONFIG_H
#define CONFIG_H

// Firmware version — passed via build flag (-DFIRMWARE_VERSION=...), fallback for local builds
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// WiFi Configuration
#define DEFAULT_HOSTNAME "neato"
#define WIFI_DEFAULT_TX_POWER                                                                                          \
    60 // WiFi TX power in 0.25 dBm units (60 = 15 dBm, ~32 mW)
       // Lower values caused boot connection failures (4-way handshake
       // timeouts) at marginal signal levels (-70 dBm range).
       // Range: 8 (2 dBm) to 84 (21 dBm). Common values:
       //   34 = 8.5 dBm,  52 = 13 dBm,  60 = 15 dBm (recommended)
       //   68 = 17 dBm,  78 = 19.5 dBm
#define WIFI_MAX_RECONNECT_BACKOFF 30000 // Max backoff between reconnect attempts (ms)

// Pin Configuration (ESP32-C3 Boot button is GPIO9)
#define RESET_BUTTON_PIN 9

// Neato UART pin defaults (ESP32-C3 hardware UART on free GPIOs)
// Actual pins are stored in NVS and configurable via settings API.
#define NEATO_DEFAULT_TX_PIN 3
#define NEATO_DEFAULT_RX_PIN 4
#define NEATO_BAUD_RATE 115200

// Neato command queue timing (milliseconds)
#define NEATO_CMD_TIMEOUT_MS 3000
#define NEATO_LDS_TIMEOUT_MS 8000
#define NEATO_INTER_CMD_DELAY_MS 50
#define NEATO_QUEUE_MAX_SIZE 16
#define NEATO_RESPONSE_TERMINATOR 0x1A // Ctrl-Z

// AsyncCache TTL values (milliseconds) — how long each response is considered fresh.
// Callers within the TTL window get the cached value instantly; concurrent requests
// during an in-flight fetch are coalesced (only one serial command dispatched).
#define CACHE_TTL_STATE 2000 // GetState + GetErr — polled every 2s
#define CACHE_TTL_CHARGER 30000 // GetCharger — battery data (30s)
#define CACHE_TTL_SENSORS 5000 // Analog/digital sensors, motors (5s)
#define CACHE_TTL_VERSION 300000 // GetVersion — rarely changes (5 min)
#define CACHE_TTL_ACCEL 5000 // Accelerometer (5s)
#define CACHE_TTL_BUTTONS 2000 // Button state (2s)
#define CACHE_TTL_LDS 2000 // LIDAR scan — 2s (scan takes ~1.5s)

// Command completion status (for enhanced logging)
enum CommandStatus {
    CMD_SUCCESS, // Command succeeded, response received OK
    CMD_TIMEOUT, // No complete response within timeout (may have partial data)
    CMD_PARSE_FAILED, // Got response but parse failed (not used yet)
    CMD_SERIAL_ERROR // UART error or other serial issue (not used yet)
};

// Timing intervals (milliseconds)
#define WIFI_RECONNECT_INTERVAL 5000
#define RESET_BUTTON_HOLD_TIME 5000 // Hold for 5 seconds to reset

// Data logger
#define LOG_MAX_FILE_SIZE 32768 // 32 KB per file before rotation
#define LOG_MAX_SPIFFS_PERCENT 85 // Delete the oldest logs when SPIFFS usage exceeds this %
#define LOG_DIR "/log"
#define LOG_CURRENT_FILE "/log/current.jsonl"
#define LOG_FLUSH_INTERVAL_MS 1000 // Flush write buffer to SPIFFS at most once per second
#define LOG_FLUSH_MAX_LINES 32 // Also flush when buffer reaches this many lines

// NVS (Non-Volatile Storage) — single shared namespace for all settings
#define NVS_NAMESPACE "neato"

// NVS keys — WiFi
#define NVS_KEY_WIFI_SSID "wifi_ssid"
#define NVS_KEY_WIFI_PASS "wifi_pass"

// NVS keys — Time/NTP
#define NVS_KEY_TIMEZONE "tz"

// NVS keys — Settings
#define NVS_KEY_HOSTNAME "hostname"
#define NVS_KEY_DEBUG_LOG "debug_log"
#define NVS_KEY_WIFI_TX_POWER "wifi_tx_pwr"
#define NVS_KEY_UART_TX_PIN "uart_tx_pin"
#define NVS_KEY_UART_RX_PIN "uart_rx_pin"

// NTP / time sync
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.nist.gov"
#define NTP_DEFAULT_TZ "UTC0" // POSIX TZ string, stored in NVS
#define ROBOT_TIME_SYNC_INTERVAL_MS 14400000 // Push NTP to robot every 4 hours

// Logging
#define ENABLE_LOGGING

#ifdef ENABLE_LOGGING
#define LOG(tag, fmt, ...) Serial.printf("[%s] " fmt "\n", tag, ##__VA_ARGS__)
#else
#define LOG(tag, fmt, ...)
#endif

#endif // CONFIG_H
