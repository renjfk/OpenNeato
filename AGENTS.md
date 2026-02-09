# AGENTS.md — project-neato

Guidelines for AI agents working in this repository.

## Project Overview

ESP32-C3 bridge for Neato Botvac robot vacuums (D3, D5, D7 series). The ESP32-C3
communicates with the Botvac over UART (TX/RX pins) using Neato's serial command
protocol, and exposes a web UI over WiFi so users can monitor and control the robot
from a browser.

Built with PlatformIO + Arduino framework on espressif32 platform.

**Standalone system** — no Home Assistant, no cloud, no external dependencies.
The ESP32-C3 serves a SPA (single-page application) that communicates with the
firmware through a simple API (REST or GraphQL, TBD). Everything runs on the
device itself.

## Project Vision

### Phase 1: Foundation (current)
- WiFi provisioning via serial menu
- OTA firmware updates via web UI
- Basic infrastructure (async web server, NVS config storage)

### Phase 2: Web UI foundation
- SPA shell served from SPIFFS (1920KB partition)
- Build pipeline: compile frontend assets, gzip, upload to SPIFFS
- Basic layout and navigation structure
- API design (REST or GraphQL) for firmware <-> browser communication
- WebSocket for real-time data push (sensor updates, state changes)
- Responsive design for mobile and desktop browsers

### Phase 3: Sensor readings
- UART serial bridge to Neato Botvac
- Read sensor data: battery level, wheel/brush motors, bumpers, cliff sensors,
  wall sensor, drop sensors, accelerometer
- Display live sensor data on web UI
- GetVersion, GetCharger, GetAnalogSensors, GetDigitalSensors, GetMotors

### Phase 4: Manual control
- Drive the robot manually from the web UI (forward, back, rotate)
- Start/stop/pause cleaning cycles
- SetMotor, SetLED commands
- TestMode enable/disable for direct motor control

### Phase 5: Safe OTA with auto-rollback
- Check GitHub Releases for newer firmware versions
- Web UI notification when an update is available
- One-click download and install from the browser
- Strict checksum validation before flashing (SHA-256 or MD5)
- ESP32 app rollback: new firmware must call `esp_ota_mark_app_valid_cancel_rollback()`
  after reaching a "successfully booted" checkpoint, otherwise the bootloader
  automatically rolls back to the previous partition on next reboot
- Dual OTA partition layout already in place (app0/app1, 1920KB each)

### Phase 6: On-device analytics and diagnostics
- Comprehensive data collection without serial debug (robot is mobile)
- Structured log entries: system events, sensor readings, errors, commands
- Data categories:
  - System health: free heap, uptime, restart reason, WiFi RSSI
  - Serial comms: commands sent, responses, timeouts, parse errors
  - Sensor snapshots: periodic GetAnalogSensors, GetDigitalSensors, GetMotors
  - LIDAR scans: full GetLDSScan captures for offline map debugging
  - Cleaning sessions: start/stop times, duration, type, errors
  - OTA events: check/download/flash attempts, versions, outcomes
- Compressed storage using ESP32 ROM miniz (deflate), rotating log files
- Store in SPIFFS (128KB partition) with automatic rotation (drop oldest)
- API endpoint to browse, filter, and download logs from the web UI
- Critical for LIDAR/mapping development: replay scan data without live robot

### Phase 7: LIDAR and mapping
- Read LIDAR distance data via GetLDSScan
- Render real-time 2D maps in the web UI
- Store and display historical maps
- Explore new areas by combining manual drive with live LIDAR feedback

### Neato Serial Protocol
- **Baud rate**: 115200
- **Line ending**: LF (`\n`)
- **Command format**: ASCII text commands, one per line
- **Response format**: Multi-line ASCII, terminated by Ctrl-Z (0x1A)
- **Response line endings**: `\r\n` (CRLF) between lines
- **Case sensitivity**: NOT case-sensitive, supports partial matching
- **Key commands**: `GetVersion`, `GetCharger`, `GetAnalogSensors`,
  `GetDigitalSensors`, `GetMotors`, `GetLDSScan`, `SetMotor`, `TestMode`,
  `SetLED`, `Clean`, `PlaySound`
- **TestMode**: Must be enabled (`TestMode On`) before direct motor commands

### Robot Debug Port Pinout (D3/D5/D7)
```
RX | 3.3V | TX | GND
```
Connect: Robot RX -> ESP TX, Robot TX -> ESP RX, Robot 3.3V -> ESP VCC,
Robot GND -> ESP GND. The robot provides 3.3V to power the ESP.

### Command Reference

**No TestMode required:**
- `Help` — List all commands
- `Clean [House|Spot|Stop|Persistent|AutoCycle]` — Cleaning control
- `Clean Spot Width N Height N` — Spot clean with dimensions (100-400 cm)
- `Clean MinCharge N` — Min charge for recharge (-1 = default 50%)
- `Clean MaxModeEnable/MaxModeDisable` — Max cleaning mode
- `Clean CleaningEnable/CleaningDisable` — Brush/vacuum during clean
- `GetVersion` — Software/hardware version info
- `GetCharger` — Battery and charging data
- `GetAnalogSensors` — A2D analog sensor readings
- `GetDigitalSensors` — Digital sensor states
- `GetMotors` — Motor diagnostic data
- `GetAccel` — Accelerometer readings
- `GetButtons` — UI button states
- `GetErr` — Error and alert messages
- `GetLDSScan` — One full LIDAR scan
- `GetState` — UI and robot state machine state
- `GetUserSettings` — User settings
- `GetWarranty` — Warranty data (hex values)
- `GetUsage` — Usage settings
- `GetTime` — Scheduler time
- `GetSensor` — Wall follower & ultrasound status
- `GetCalInfo` — Calibration info
- `GetWifiInfo` / `GetWifiStatus` — WiFi info
- `SetTime` / `SetUserSettings` / `SetUsage` / `SetWifi` — Set values
- `SetNavigationMode Normal/Gentle/Deep/Quick` — Navigation mode
- `SetButton` — Simulate button press
- `SetFuelGauge` / `SetBatteryTest` / `SetIEC` — Battery/test settings
- `PlaySound SoundId N` — Play sound (20 = locate beep)
- `TestMode On/Off` — Enable/disable test mode
- `ClearFiles` — Erase logs
- `DiagTest` — Execute test modes
- `Upload` — Upload new firmware

**TestMode required:**
- `SetMotor RWheelDist <mm> LWheelDist <mm> Speed <speed>` — Drive wheels
- `SetMotor LWheelDisable RWheelDisable` — Stop wheels
- `SetLED` — Control LEDs
- `SetLDSRotation On/Off` — Start/stop LIDAR rotation
- `SetLCD` — Set LCD display
- `SetSystemMode Shutdown/Hibernate/Standby/PowerCycle` — Power control

**Hidden commands (undocumented, found via reverse engineering):**
- `GetRobotPos Raw/Smooth` — Odometry/localized position
- `GetDatabase All/Factory/Robot/Runtime/Statistics/System/CleanStats`
- `GetActiveServices` — Running services
- `SetUIError setalert/clearalert/clearall/list` — UI error state machine
- `NewBattery` — Tell robot new battery installed

### Response Formats

**GetCharger** — CSV: `Label,Value`
```
FuelPercent,53              # Battery %
BatteryOverTemp,0           # 0/1
ChargingActive,0            # 0/1
ChargingEnabled,1           # 0/1
ConfidentOnFuel,0           # 0/1
OnReservedFuel,0            # 0/1
EmptyFuel,0                 # 0/1
BatteryFailure,0            # 0/1
ExtPwrPresent,0             # 0/1 (on dock)
ThermistorPresent,0         # 0/1
BattTempCAvg,22             # Celsius
VBattV,14.58                # Volts
VExtV,0.00                  # External volts
Charger_mAH,0               # mAh charged
Discharge_mAH,238           # mAh discharged
```

**GetAnalogSensors** — CSV: `SensorName,Unit,Value` (trailing comma)
```
BatteryVoltage,mV,14585,
BatteryCurrent,mA,-238,     # Negative = discharging
BatteryTemperature,mC,22800, # Milli-Celsius (÷1000 for °C)
ExternalVoltage,mV,0,
AccelerometerX,mG,16,       # Milli-G
AccelerometerY,mG,2,
AccelerometerZ,mG,963,
VacuumCurrent,mA,0,
SideBrushCurrent,mA,0,
MagSensorLeft,VAL,0,        # Magnetic boundary strip
MagSensorRight,VAL,0,
WallSensor,mm,255,          # Distance to wall
DropSensorLeft,mm,19,       # Cliff sensor
DropSensorRight,mm,19,
```

**GetDigitalSensors** — CSV: `Name,Value` (all 0/1)
```
SNSR_DC_JACK_IS_IN          # Charging dock connected
SNSR_DUSTBIN_IS_IN          # Dustbin present
SNSR_LEFT_WHEEL_EXTENDED    # Left wheel lifted
SNSR_RIGHT_WHEEL_EXTENDED   # Right wheel lifted
LSIDEBIT, LFRONTBIT, LLDSBIT   # Left bumper sections
RSIDEBIT, RFRONTBIT, RLDSBIT   # Right bumper sections
```

**GetMotors** — CSV: `Parameter,Value`
```
Brush_RPM, Brush_mA, Vacuum_RPM, Vacuum_mA, SideBrush_mA
LeftWheel_RPM, LeftWheel_Load%, LeftWheel_PositionInMM, LeftWheel_Speed
RightWheel_RPM, RightWheel_Load%, RightWheel_PositionInMM, RightWheel_Speed
ROTATION_SPEED              # Decimal rotation speed
```
Wheel PositionInMM = odometry from origin, can be negative.

**GetLDSScan** — CSV: `AngleDeg,DistMM,Intensity,ErrorCode`
- AngleDeg: 0-359 (integer)
- DistMM: millimeters (0 = no reading)
- ErrorCode: 0 = valid, non-zero = error
- 360 data points per full scan

**GetState** — Two lines:
```
Current UI State is: UIMGR_STATE_STANDBY
Current Robot State is: ST_C_Standby
```

**GetVersion** — CSV key,value pairs including:
ModelID, ConfigID, Software (major,minor,build), BatteryType, BlowerType,
BrushSpeed, VacuumSpeed, Serial Number, Model, Time Local, Time UTC

**GetWarranty** — Values are hex strings, convert with `strtoul(hex, nullptr, 16)`

**GetErr** — Error code 200 (`UI_ALERT_INVALID`) = no error (normal state)

### Polling Intervals (from reference project)
- `GetErr` + `GetState`: every 2 seconds
- `GetCharger`: every 2 minutes
- Inter-command delay: 50ms between sequential commands
- TestMode -> SetSystemMode delay: 100ms

### UI States (UIMGR_STATE_*)
Key states: `POWERUP`, `STANDBY`, `IDLE`, `HOUSECLEANINGRUNNING`,
`HOUSECLEANINGPAUSED`, `SPOTCLEANINGRUNNING`, `SPOTCLEANINGPAUSED`,
`DOCKINGRUNNING`, `DOCKINGPAUSED`, `TESTMODE`, `MANUALDRIVING`

### Pause Workaround
```
Clean Stop
SetUIError setalert UI_ALERT_OLD_ERROR   (50ms delay)
SetUIError clearalert UI_ALERT_OLD_ERROR
```
Forces UI state machine to properly recognize paused state.

### Supported Robots
D3, D4, D5, D6, D7 confirmed. D70-D85 likely compatible.
D8/D9/D10 NOT supported (different board, password-locked serial).

### Known Limitations
- LIDAR scan responses are large; line-by-line reading recommended
- Serial commands must be queued (no overlapping)
- In TestMode, GetState always returns `UIMGR_STATE_TESTMODE`
- No known serial command to return to dock
- Commands cannot have leading spaces

## Architecture

Flat `src/` directory with header/source pairs. No subdirectories, no test framework.

```
src/
  config.h             # Global defines, macros, LOG macro
  main.cpp             # setup()/loop() entry point, global objects
  serial_menu.h/cpp    # Generic interactive serial menu system
  wifi_manager.h/cpp   # WiFi config, credential storage, network scanning
  ota_handler.h/cpp    # ElegantOTA wrapper over async web server
partition.csv          # Custom partition table (dual OTA slots, 1920KB each)
platformio.ini         # Build environments, dependencies, OTA upload command
```

## Build Commands

```bash
# Build (Debug env — serial upload)
pio run -e Debug

# Build and upload via USB serial
pio run -e Debug -t upload

# Upload and open serial monitor
pio run -e Debug -t upload -t monitor

# Serial monitor only
pio run -e Debug -t monitor

# OTA upload (device must be on network as neato.home)
pio run -e OTA -t upload

# Clean build artifacts
pio run -e Debug --target clean
```

**Monitor baud rate**: 115200

There are no tests or linting tools configured. Verify changes by building
successfully with `pio run -e Debug`.

## Dependencies (all pinned)

- `ayushsharma82/ElegantOTA @ 3.1.7`
- `ESP32Async/AsyncTCP @ 3.4.10`
- `ESP32Async/ESPAsyncWebServer @ 3.9.6`
- Built-in: `Preferences @ 2.0.0`, `WiFi @ 2.0.0`

## Code Style

### File Naming
- `snake_case` for all filenames: `wifi_manager.cpp`, `serial_menu.h`

### Header Guards
- Traditional `#ifndef`/`#define`/`#endif` (not `#pragma once`)
- Pattern: `FILENAME_H` in `UPPER_SNAKE_CASE`
- Closing comment: `#endif // WIFI_MANAGER_H`

### Include Order
1. Framework/library headers with angle brackets: `<Arduino.h>`, `<WiFi.h>`, `<functional>`
2. Project headers with quotes: `"config.h"`, `"serial_menu.h"`
3. Source files include only their own header — no re-inclusion of transitive deps

### Naming Conventions
| Element              | Convention          | Examples                                    |
|----------------------|---------------------|---------------------------------------------|
| Classes/Structs      | `PascalCase`        | `WiFiMgr`, `OTAHandler`, `SerialMenu`, `MenuItem` |
| Enum types           | `PascalCase`        | `InputMode`                                 |
| Enum values          | `UPPER_SNAKE_CASE`  | `MENU_SELECTION`, `TEXT_INPUT`               |
| Methods              | `camelCase`         | `begin()`, `handleInput()`, `isConnected()`  |
| Member variables     | `camelCase` (no prefix) | `inConfigMode`, `selectedSSID`, `inputBuffer` |
| Local variables      | `camelCase`         | `buttonState`, `pressStart`, `attempts`      |
| Global objects       | `camelCase`         | `wifiManager`, `otaHandler`, `server`        |
| Macros/defines       | `UPPER_SNAKE_CASE`  | `HOSTNAME`, `RESET_BUTTON_PIN`, `LOG`        |

### Formatting
- **Indentation**: 4 spaces (no tabs)
- **Braces**: K&R style (opening brace on same line)
- **`const` correctness**: Applied to parameters (`const String&`), methods (`isActive() const`), and locals where appropriate
- **Reference/pointer attachment**: Attach to type: `const String &ssid`, `AsyncWebServer &server`
- **Inline trivial getters** in headers: `bool isActive() const { return active; }`
- **Non-trivial methods**: Declared in header, defined in `.cpp`

### Types
- Use Arduino `String` throughout (never `std::string`)
- Use `std::function` and `std::vector` from STL where needed (C++11)
- Use `static_cast<>` for conversions (not C-style casts)
- Use `unsigned long` for `millis()` timestamps
- Use `bool` for flags, `int` for counters/indexes, `size_t` for collection iteration
- Default-initialize member variables in the header: `bool active = false;`

### Comments
- `//` single-line comments only (no Doxygen or `/** */` blocks)
- Brief section labels: `// Menu actions`, `// Input state`, `// Global objects`
- Inline explanations where non-obvious: `delay(1000); // Wait for serial`

## Error Handling

- **No exceptions** — standard Arduino constraint
- **Return-value based**: Functions return `bool` for success/failure
- **Early returns**: Check preconditions and return immediately
- **Retry with limit**: `while (condition && attempts < 20) { delay(500); attempts++; }`
- **Bounds checking**: Validate indexes before array/vector access
- **Critical failure**: Call `ESP.restart()` after credential reset or OTA completion

## Logging

Defined in `config.h` as a compile-time conditional macro:

```cpp
#ifdef ENABLE_LOGGING
#define LOG(tag, fmt, ...) Serial.printf("[%s] " fmt "\n", tag, ##__VA_ARGS__)
#else
#define LOG(tag, fmt, ...)
#endif
```

- Tags are short UPPER_CASE strings: `"BOOT"`, `"WIFI"`, `"OTA"`, `"BUTTON"`
- Uses printf-style format specifiers: `%s`, `%d`, `%u`
- All user-facing serial output must go through `SerialMenu` helper methods
  (`printStatus`, `printError`, `printSuccess`, `printSection`, `printSeparator`,
  `printKeyValue`), not direct `Serial.print`/`Serial.println` calls

## Serial Menu Pattern

`SerialMenu` is the sole owner of serial display output. WiFi/OTA modules
must use SerialMenu methods for all user-facing output. The only acceptable
direct `Serial` calls outside of `serial_menu.cpp` are:
- `Serial.available()` / `Serial.read()` for input entry points
- `LOG()` macro for debug logging

## Class Design Patterns

- **Dependency injection**: Pass dependencies via constructor (`OTAHandler(AsyncWebServer&)`)
- **Composition over inheritance**: Classes own their collaborators as members
- **Callbacks via lambdas**: `std::function` with `[this]` capture for menu actions
- **State machine**: `InputMode` enum drives serial input behavior in `SerialMenu`
- **No inheritance or virtual methods** in this codebase

## Hardware Notes

- **Board**: ESP32-C3-DevKitM-1 (RISC-V single core, 160MHz, 320KB RAM, 4MB flash)
- **USB**: Native USB CDC (not UART bridge) — `ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`
- **Reset button**: GPIO9 (BOOT button), active LOW with internal pull-up, hold 5s to reset credentials
- **Flash layout**: Dual OTA slots (1920KB each), 128KB SPIFFS, 20KB NVS
- **WiFi credentials**: Stored in NVS via `Preferences` library under namespace `"wifi"`
