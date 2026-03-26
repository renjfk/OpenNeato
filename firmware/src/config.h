#ifndef CONFIG_H
#define CONFIG_H

// Firmware version — passed via build flag (-DFIRMWARE_VERSION=...), fallback for local builds
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0"
#endif

// Chip model — passed via build flag (-DCHIP_MODEL=...) from board section in platformio.ini
#ifndef CHIP_MODEL
#error "CHIP_MODEL must be defined (e.g. -DCHIP_MODEL=\\\"ESP32-C3\\\")"
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

// Pin Configuration — boot/reset button and default UART pins vary by chip.
// Original ESP32: BOOT is GPIO0, GPIO1/3 are the USB-UART bridge (U0TXD/U0RXD).
// ESP32-C3: BOOT is GPIO9, GPIO1/3 are free GPIOs.
#if CONFIG_IDF_TARGET_ESP32
#define RESET_BUTTON_PIN 0
#define NEATO_DEFAULT_TX_PIN 17
#define NEATO_DEFAULT_RX_PIN 16
#define MAX_GPIO_PIN 39
#elif CONFIG_IDF_TARGET_ESP32C3
#define RESET_BUTTON_PIN 9
#define NEATO_DEFAULT_TX_PIN 3
#define NEATO_DEFAULT_RX_PIN 4
#define MAX_GPIO_PIN 21
#else
#error "Unsupported chip — add pin definitions for this target"
#endif

// Actual UART pins are stored in NVS and configurable via settings API.
#define NEATO_BAUD_RATE 115200
#define NEATO_UART_RX_BUFFER 4096 // Default 256 bytes overflows during GetLDSScan (~5KB response)

// Neato command queue timing (milliseconds)
#define NEATO_CMD_TIMEOUT_MS 3000
#define NEATO_INTER_CMD_DELAY_MS 50
#define NEATO_QUEUE_MAX_SIZE 16
#define NEATO_RESPONSE_TERMINATOR 0x1A // Ctrl-Z

// initSKey retry — GetVersion can fail at boot if the robot is still powering up.
// Retry with exponential backoff until the robot responds.
#define SKEY_RETRY_INITIAL_MS 2000 // First retry after 2s
#define SKEY_RETRY_MAX_MS 30000 // Cap backoff at 30s

// AsyncCache TTL values (milliseconds) — how long each response is considered fresh.
// Callers within the TTL window get the cached value instantly; concurrent requests
// during an in-flight fetch are coalesced (only one serial command dispatched).
#define CACHE_TTL_STATE 2000 // GetState + GetErr — polled every 2s
#define CACHE_TTL_CHARGER 30000 // GetCharger — battery data (30s)
#define CACHE_TTL_SENSORS 1000 // Analog/digital sensors, motors (1s — fast for manual clean safety)
#define CACHE_TTL_VERSION 300000 // GetVersion — rarely changes (5 min)
#define CACHE_TTL_LDS 1500 // LIDAR scan — 1.5s (scan takes ~800ms on serial)

// Manual clean safety
#define MANUAL_SAFETY_POLL_MS 500 // Poll bumpers every 500ms during manual clean
#define MANUAL_STALL_POLL_MS 500 // Poll wheel load every 500ms while wheels are moving
#define MANUAL_STALL_LOAD_PCT 60 // Wheel load % threshold — above this is considered stalled
#define MANUAL_STALL_COUNT 2 // Consecutive overloaded polls before stopping (2 × 500ms = 1s grace)
#define MANUAL_CLIENT_TIMEOUT_MS 5000 // Stop wheels if no API activity (any request) within this window
#define MANUAL_BRUSH_RPM 1200 // Default brush RPM in manual mode
#define MANUAL_VACUUM_SPEED_PCT 80 // Default vacuum speed (%) in manual mode
#define MANUAL_SIDE_BRUSH_POWER_MW 1500 // Default side brush power (mW) — universal Neato Botvac default

// Command completion status (for enhanced logging)
enum CommandStatus {
    CMD_SUCCESS, // Command succeeded, response received OK
    CMD_TIMEOUT, // No complete response within timeout (may have partial data)
    CMD_PARSE_FAILED, // Got response but parse failed (not used yet)
    CMD_SERIAL_ERROR, // UART error or other serial issue (e.g. response desync)
    CMD_UNSUPPORTED, // Robot responded with "Unknown Cmd" — command not available
    CMD_QUEUE_FULL // Command rejected because the serial queue was full
};

// Timing intervals (milliseconds)
#define WIFI_RECONNECT_INTERVAL 5000
#define RESET_BUTTON_HOLD_TIME 5000 // Hold for 5 seconds to reset

// Data logger
#define LOG_MAX_FILE_SIZE 32768 // 32 KB per file before rotation
#define LOG_MAX_FS_PERCENT 60 // Delete oldest logs when log dir exceeds this share of filesystem
#define LOG_MIN_FS_PERCENT 10 // Logs always get at least this % of filesystem, even if other data fills the rest
#define LOG_MAX_FILES 50 // Maximum number of archived log files to keep
#define LOG_DIR "/log"
#define LOG_CURRENT_FILE "/log/current.jsonl"
#define LOG_FLUSH_INTERVAL_MS 30000 // Flush write buffer to filesystem every 30 seconds (reduces flash wear)
#define LOG_FLUSH_MAX_LINES 128 // Also flush when buffer reaches this many lines
#define LOG_ENFORCE_LIMITS_MS 30000 // Check log dir size/count limits every 30s (not every 50ms tick)

// NVS (Non-Volatile Storage) — single shared namespace for all settings
#define NVS_NAMESPACE "neato"

// NVS keys — WiFi
#define NVS_KEY_WIFI_SSID "wifi_ssid"
#define NVS_KEY_WIFI_PASS "wifi_pass"

// NVS keys — Time/NTP
#define NVS_KEY_TIMEZONE "tz"

// NVS keys — Settings
#define NVS_KEY_HOSTNAME "hostname"
#define NVS_KEY_LOG_LEVEL "log_level"
#define NVS_KEY_DEBUG "debug" // TODO: Remove after v0.5 — legacy key, migrated to log_level on first boot
#define LOG_LEVEL_AUTO_OFF_DEBUG_MS 600000 // Auto-revert debug -> off after 10 minutes
#define LOG_LEVEL_AUTO_OFF_INFO_MS 3600000 // Auto-revert info -> off after 1 hour

// Log levels — controls what gets written to LittleFS. Default off to minimize
// flash wear. LittleFS copy-on-write metadata updates on every write stall
// the main loop and degrade serial response times as storage fills up.
#define LOG_LEVEL_OFF 0 // Nothing written to LittleFS (default)
#define LOG_LEVEL_INFO 1 // Errors, state transitions, boot, wifi, ota, ntp, cleaning events, notifications
#define LOG_LEVEL_DEBUG 2 // Everything in Info + all serial commands + raw responses
#define NVS_KEY_WIFI_TX_POWER "wifi_tx_pwr"
#define NVS_KEY_UART_TX_PIN "uart_tx_pin"
#define NVS_KEY_UART_RX_PIN "uart_rx_pin"
// NVS keys — Manual clean
#define NVS_KEY_MC_STALL_THR "mc_stall_thr"
#define NVS_KEY_MC_BRUSH_RPM "mc_brush_rpm"
#define NVS_KEY_MC_VACUUM_PCT "mc_vacuum_pct"
#define NVS_KEY_MC_SBRUSH_MW "mc_sbrush_mw"

// NVS keys — Notifications
#define NVS_KEY_NTFY_TOPIC "ntfy_topic"
#define NVS_KEY_NTFY_ENABLED "ntfy_enabled"
#define NVS_KEY_NTFY_ON_DONE "ntfy_on_done"
#define NVS_KEY_NTFY_ON_ERR "ntfy_on_err"
#define NVS_KEY_NTFY_ON_ALERT "ntfy_on_alrt"
#define NVS_KEY_NTFY_ON_DOCK "ntfy_on_dock"

// NVS keys — Schedule (ESP32-managed, not robot serial)
#define NVS_KEY_SCHED_ENABLED "sched_on"
// Per-day keys use suffix: "s0h","s0m","s0on" .. "s6h","s6m","s6on" (Mon=0..Sun=6)
// Built programmatically in SettingsManager — no individual defines needed.
#define SCHEDULE_DAYS 7
#define SCHEDULE_CHECK_INTERVAL_MS 30000 // Check schedule against NTP time every 30s
#define SCHEDULE_WINDOW_MINS 5 // Fire if current time is 0..N minutes after scheduled slot

// Notification manager — adaptive polling intervals
#define NOTIF_INTERVAL_ACTIVE_MS 3000 // Check state every 3s when robot is active (cleaning/docking)
#define NOTIF_INTERVAL_IDLE_MS 30000 // Check state every 30s when robot is idle

// Cleaning history
#define HISTORY_INTERVAL_IDLE_MS 30000 // Poll state every 30s when idle (detect cleaning start)
#define HISTORY_INTERVAL_ACTIVE_MS 2000 // Poll state/pose every 2s during active cleaning (~0.6m resolution at 300mm/s)
#define HISTORY_FLUSH_INTERVAL_MS 30000 // Flush buffered pose snapshots to disk every 30 seconds
#define HISTORY_COMPRESS_INTERVAL_MS 50 // Fast tick during post-session compression (512B/tick)
#define HISTORY_DIR "/history" // LittleFS directory for session files
#define HISTORY_MAX_FS_PERCENT 50 // Delete oldest sessions when history dir exceeds this share of filesystem
#define HISTORY_MIN_FS_PERCENT 10 // History always gets at least this % of filesystem
#define HISTORY_MAX_FILES 20 // Maximum number of archived session files to keep
#define HISTORY_AREA_CELL_M 0.5f // Coarse grid cell size in meters for visited-area estimation

// Task Watchdog Timer (TWDT) — hardware watchdog that resets the ESP32 if
// loop() stops running (deadlock, infinite loop, blocking I/O). The main task
// must call esp_task_wdt_reset() every iteration; if it misses the deadline,
// the TWDT triggers a system reset. This complements the heap watchdog below
// which only catches memory exhaustion (and requires loop() to keep running).
#define TASK_WDT_TIMEOUT_S                                                                                             \
    15 // Seconds before TWDT triggers reset (generous
       // to accommodate slow filesystem operations and
       // LIDAR scans that can take several seconds)

// Heap watchdog — restart if free heap stays below threshold for this duration.
// Prevents the device from becoming unresponsive when memory is exhausted
// (e.g. by runaway async connections after a UART desync cascade).
#define HEAP_WATCHDOG_THRESHOLD 16384 // 16 KB — below this is critical
#define HEAP_WATCHDOG_DURATION_MS 30000 // Must stay low for 30s to trigger

// NTP / time sync
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.nist.gov"
#define NTP_DEFAULT_TZ "UTC0" // POSIX TZ string, stored in NVS
#define ROBOT_TIME_SYNC_INTERVAL_MS 14400000 // Push NTP to robot every 4 hours

// Logging — enabled by default, disable with -DENABLE_LOGGING=0
#ifndef ENABLE_LOGGING
#define ENABLE_LOGGING 1
#endif

#if ENABLE_LOGGING
#define LOG(tag, fmt, ...) Serial.printf("[%s] " fmt "\n", tag, ##__VA_ARGS__)
#else
#define LOG(tag, fmt, ...)
#endif

#endif // CONFIG_H
