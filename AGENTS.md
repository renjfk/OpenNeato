# AGENTS.md — OpenNeato

Guidelines for AI agents working in this repository.

## Project Overview

**OpenNeato** is a community-driven, open-source replacement for Neato's discontinued
cloud and mobile app. After Neato ceased operations, millions of Botvac robots
(D3-D7 series) lost their only means of remote control. OpenNeato fills that gap
with an ESP32-C3 bridge that communicates with the robot over UART using Neato's
serial command protocol and exposes a local web UI over WiFi — no cloud, no app
store, no account required.

Built with PlatformIO + Arduino framework on espressif32 platform.

**Standalone system** — no Home Assistant, no cloud, no external dependencies.
The ESP32-C3 serves a SPA (single-page application) that communicates with the
firmware through REST API. Everything runs on the device itself.

## Project Vision

### Completed phases
1. **Foundation** — WiFi provisioning, OTA updates, async web server, NVS config
2. **API layer and sensor integration** — UART serial bridge, command queue, REST
   endpoints for all sensors and actions, client-side polling
3. **On-device analytics and diagnostics** — SPIFFS JSON-lines logging, heatshrink
   compression on rotation, non-blocking I/O, command/request/event logging, NTP time
   sync. BufferedLogReader merges file + unflushed buffer for current.jsonl reads.
   10s flush interval, 64-line buffer, 90% space limit, 50-file cap. No boot archive
   (current.jsonl survives reboots, rotates at 32KB when NTP synced). Frontend sorts
   logs newest-first.
4. **Firmware management** — Custom FirmwareManager (Update.h), MD5 validation,
   server-side chip ID validation (rejects wrong-chip binaries before flash write),
   safe boot checkpoint, dual OTA partition auto-rollback. Settings page Firmware
   category: version + chip display, file picker with client-side chip validation,
   smoothed upload progress bar, auto-reboot after success.
5. **Mock API server** — Stateful Node.js dev server (Vite plugin), all REST
   endpoints, realistic responses. Edit state object directly for testing scenarios.
6. **Web UI dashboard** — Preact SPA with dark/light theme, mobile-first responsive
   design, robot illustration, live status cards, action buttons. Embedded in firmware.
7. **Async response cache** — Generic `AsyncCache<T>` template with TTL, request
   deduplication, and explicit invalidation. Integrated into NeatoSerial typed getters.
8. **Error handling UX** — Two-tier error banner system: fixed (non-dismissible)
   banners for robot errors from GetErr polling, stackable dismissible banners for
   API/action errors. Dashboard cards show "Error" state when polling fails. Mock
   server fault injection scenarios for all error paths.
9. **Settings & device management** — Unified settings page with single Save button
   (auto-detects reboot-required changes). Configurable hostname, UART pins, WiFi TX
   power, timezone, debug logging. Device restart and factory reset with type-to-confirm.
   Deferred reboot pattern via SystemManager. Unsaved changes guards (beforeunload +
   in-app navigation). WiFi stability: configurable TX power, auto-reconnect with
   exponential backoff. Partition resize: 1600KB OTA slots, 768KB SPIFFS.
   WiFi reliability: TX power applied before WiFi.begin() for reliable boot
   association, deferred web server start when DHCP is slow, WiFi event logging
   with RSSI/channel/BSSID diagnostics, default TX power raised to 15 dBm.
10. **Pause/Resume/Stop UX** — Dashboard action buttons adapt to cleaning state: Idle
   shows House/Spot enabled with Pause disabled; Running shows Pause enabled (first stop
   goes to Paused state); Paused shows relevant resume button (play icon + "Resume" label)
       and Stop button enabled. Single `POST /api/clean?action=stop`: first call pauses
   (RUNNING → PAUSED), second call stops (PAUSED → IDLE). Resume reuses
   `?action=house`/`?action=spot` to continue. GetErr parser fixed for code 200 (UI_ALERT_INVALID = no error). Mock server
   updated with pause state transitions.
   SetUIError dance: `Clean Stop` alone doesn't update the D7 UI state machine —
   firmware enqueues `Clean Stop` + `SetUIError setalert UI_ALERT_OLD_ERROR` +
   `SetUIError clearalert UI_ALERT_OLD_ERROR` as a 3-command sequence to force
   the state machine into reporting `CLEANINGPAUSED`.
   Bare `Clean` command: house start and resume both use bare `Clean` (no `House`
   flag) to match physical button behavior — avoids "new cleaning" sounds on
   resume. `Clean House` would explicitly start a new clean. Spot uses `Clean Spot`
   for both start and resume.
11. **ESP32-managed schedule** — 7-day cleaning schedule managed entirely on ESP32 (robot
   serial GetSchedule/SetSchedule NOT used — D7 4.6.0 doesn't support them). NVS storage
   with flat keys (`scheduleEnabled`, `sched{0-6}{Hour,Min,On}`, Mon=0..Sun=6). Scheduler
   class checks time via `SystemManager::now()` every 30s, fires within a 5-minute window
   (`SCHEDULE_WINDOW_MINS`), guards against duplicate triggers and robot-busy states.
   Schedule events logged to DataLogger (trigger/skipped/failed). Frontend schedule page
   (`#/schedule`) navigated from Settings > Robot. `CMD_UNSUPPORTED` status added to
       serial state machine. Settings view refactored into submodules (`settings/` directory).
12. **WiFi modem sleep** — WiFi radio powers down between AP beacons (~100ms) via
    `esp_wifi_set_ps(WIFI_PS_MIN_MODEM)`, reducing idle current from ~120mA to
    ~15-20mA. WiFi association stays active (AP buffers frames). TX power unaffected.
13. **Task Watchdog Timer** — Hardware TWDT via `esp_task_wdt` resets the ESP32 if
    `loop()` stops running (deadlock, infinite loop, blocking I/O). 15s timeout
    configured after all slow boot init completes. Fed every `loop()` iteration via
    `esp_task_wdt_reset()`. Complements the existing heap watchdog (which only catches
    memory exhaustion and requires `loop()` to keep running).

Details for completed phases are documented in the Architecture, API routes, and
reference sections below.

**Note for agents**: When a phase is completed, verify its details are covered in the
Architecture/API/reference sections, then remove the full phase description from below
and add a one-line summary to the completed list above. Do this before committing.

### Silent pause/resume/stop
- Goal: pause, resume, and stop should be completely silent — identical to
  pressing the physical Start button on the robot, with no alert tones or
  "Starting Cleaning" sounds
- Current behavior: pause may trigger an alert sound due to the SetUIError
  dance used to work around a D7 4.6.0 state machine bug; spot resume may
  trigger a "new cleaning" sound because `Clean Spot` can be interpreted as
  starting a new clean rather than resuming
- Behavior may vary across robot models and firmware versions — D3/D4/D6/D7
  may not have the state machine bug at all and may not need the workaround

### Manual control
- Drive the robot manually from the web UI (forward, back, rotate)
- Start/stop/pause cleaning cycles
- SetMotor, SetLED commands
- TestMode enable/disable for direct motor control

### OTA update via GitHub Releases
- Entirely browser-side — ESP32 has no background update checker and makes no
  outbound connections to GitHub
- On firmware page load, the browser fetches the GitHub Releases API (HTTPS
  handled by browser, not by ESP32) and compares the latest release tag against
  the device's current `FIRMWARE_VERSION` (obtained from `GET /api/firmware/version`)
- GitHub repo URL configurable in settings (stored in NVS)
- Web UI firmware page: shows current version, available version, changelog,
  one-click update button
- Update flow:
  1. Browser fetches GitHub Releases API (HTTPS handled by browser)
  2. Browser downloads `.bin` asset from the release
  3. Browser uploads to `POST /api/firmware/update?hash=<md5>`
  4. Device reboots, auto-rollback protects against bad firmware
- ESP32 never makes outbound HTTPS connections — all GitHub communication
  happens in the browser

### LIDAR and mapping
- Read LIDAR distance data via GetLDSScan
- Build 2D occupancy maps on the ESP32 using LIDAR + odometry data
- Store maps on SPIFFS for persistence across reboots
- Web UI renders stored maps (browser is display-only, ESP32 does the processing)
- Explore new areas by combining manual drive with live LIDAR feedback

### Push notifications via ntfy.sh
- Lightweight push notifications using [ntfy.sh](https://ntfy.sh) — self-hostable,
  no app account required, works on Android/iOS/desktop via simple HTTP PUT/POST
- ESP32 publishes notifications by POSTing to a configurable ntfy topic URL
- Notification triggers:
  - Cleaning started / completed / stopped with error
  - Battery low (configurable threshold)
  - Robot error or alert (GetErr non-200 codes)
  - Stuck or pickup detected (wheel extended, bumper stuck)
  - Returning to base due to low battery
  - Charging started / completed
  - OTA update applied / failed
  - Device boot / unexpected restart
- User-configurable settings stored in NVS:
  - ntfy server URL (default: `http://ntfy.sh`, supports self-hosted instances)
  - Topic name
  - Enable/disable per notification category
  - Priority levels per category (min, low, default, high, urgent)
- Web UI settings page for notification configuration and test button
- Event detection piggybacks on existing sensor polling (GetErr, GetState,
  GetCharger); no additional robot polling needed
- Fire-and-forget HTTP POST to ntfy — no persistent connection or retry queue
- Optional: ntfy features like tags/emojis, click URLs (link back to device web UI),
  and action buttons

### Neato Serial Protocol
- **Baud rate**: 115200
- **Line ending**: LF (`\n`)
- **Command format**: ASCII text commands, one per line
- **Response format**: Multi-line ASCII, terminated by Ctrl-Z (0x1A)
- **Response line endings**: `\r\n` (CRLF) between lines
- **Case sensitivity**: NOT case-sensitive, supports partial matching
- **Partial command matching**: Only type enough letters to make command unique
- **Command syntax**: Flexible format with `Cmd [Flag] [ParamName ParamValue]` pairs
  - Flags are boolean (presence = true)
  - ParamName/Value pairs can be in any order
  - ParamNames support partial matching
  - Can omit ParamNames if values are in correct sequence
- **Key commands**: `GetVersion`, `GetCharger`, `GetAnalogSensors`,
  `GetDigitalSensors`, `GetMotors`, `GetLDSScan`, `SetMotor`, `TestMode`,
  `SetLED`, `Clean`, `PlaySound`
- **TestMode**: Must be enabled (`TestMode On`) before direct motor commands
- **Response parsing**: CSV format with header row; row/column order not guaranteed
  across firmware versions; always parse by matching labels, not position

### Robot Debug Port Pinout (D3/D5/D7)
```
RX | 3.3V | TX | GND
```
Connect: Robot RX -> ESP TX, Robot TX -> ESP RX, Robot 3.3V -> ESP VCC,
Robot GND -> ESP GND. The robot provides 3.3V to power the ESP.

### Command Reference

**No TestMode required:**
- `Help [Cmd]` — List all commands or help for specific command
  - Without argument: prints list of all commands
  - With command name: prints help for that specific command
- `Clean [House|Spot|Stop]` — Cleaning control
  - *(no flag)* — Equivalent to pressing 'Start' button. Starts house cleaning
    or resumes a paused house clean without triggering "new cleaning" sounds
  - `House` (Optional) — Explicitly starts a NEW house clean (triggers start sound)
  - `Spot` (Optional) — Starts or resumes a spot clean
  - `Stop` — Stop Cleaning (first call pauses, second call stops)
- `GetVersion` — Software/hardware version info
- `GetCharger` — Battery and charging data
- `GetAnalogSensors [raw] [stats]` — A2D analog sensor readings
- `GetDigitalSensors` — Digital sensor states
- `GetMotors [Brush] [Vacuum] [LeftWheel] [RightWheel] [Laser] [Charger]` — Motor diagnostic data
- `GetAccel` — Accelerometer readings
- `GetButtons` — UI button states
- `GetErr [Clear]` — Error and alert messages
- `GetLDSScan` — One full LIDAR scan (360 lines: AngleDeg,DistMM,Intensity,ErrorCode)
- `GetSchedule [Day N]` — Get cleaning schedule (24h format)
- `GetTime` — Current scheduler time
- `GetCalInfo` — Calibration info from system control block
- `GetLifeStatLog` — All life stat logs
- `GetSysLog` — System log data (unimplemented in XV-11)
- `GetWarranty` — Warranty validation codes (hex values)
- `PlaySound [SoundID N] [Stop]` — Play sound (0-20, see manual for IDs)
- `RestoreDefaults` — Restore user settings to default
- `SetDistanceCal [DropMinimum|DropMiddle|DropMaximum] [WallMinimum|WallMiddle|WallMaximum]` — Set distance sensor calibration values for min and max distances
  - DropMinimum: Take minimum distance drop sensor readings (mutually exclusive of DropMiddle and DropMax)
  - DropMiddle: Take middle distance drop sensor readings (mutually exclusive of DropMinimum and DropMax)
  - DropMaximum: Take maximum distance drop sensor readings (mutually exclusive of DropMinimum and DropMiddle)
  - WallMinimum: Take minimum distance wall sensor readings (mutually exclusive of WallMiddle and WallMax)
  - WallMiddle: Take middle distance wall sensor readings (mutually exclusive of WallMinimum and WallMax)
  - WallMaximum: Take maximum distance wall sensor readings (mutually exclusive of WallMinimum and WallMiddle)
  - Returns: `Label,Value RDropCalA2DMin,-1 RDropCalA2DMid,-1 RDropCalA2DMax,-1 LDropCalA2DMin,-1 LDropCalA2DMid,-1 LDropCalA2DMax,-1 WallCalA2DMin,-1 WallCalA2DMid,-1 WallCalA2DMax,-1`
- `SetFuelGauge [Percent N]` — Set fuel gauge level (0-100)
- `SetSchedule [Day N] [Hour N] [Min N] [House|None] [ON|OFF]` — Modify cleaning schedule
  - Day: 0=Sun, 6=Sat (required)
  - Hour: 0-23 (required)
  - Min: 0-59 (required)
  - House: Schedule to clean whole house (default, mutually exclusive with None)
  - None: Remove scheduled cleaning for specified day (time is ignored)
  - ON/OFF: Enable/disable scheduled cleanings (mutually exclusive)
- `SetTime [Day N] [Hour N] [Min N] [Sec N]` — Set scheduler clock
  - Day: 0=Sunday, 1=Monday, ... (required)
  - Hour: 0-23 (required)
  - Min: 0-59 (required)
  - Sec: 0-59 (optional, defaults to 0)
- `SetWallFollower [Enable|Disable]` — Enable/disable wall follower
- `TestMode On/Off` — Enable/disable test mode
- `DiagTest [TestsOff|DrivePath|DriveForever|MoveAndBump|DropTest|...]` — Execute test modes
- `Upload [dump|code|sound|LDS] [xmodem] [size N] [noburn] [readflash] [reboot]` — Upload new firmware
  - code/sound/LDS: Upload file type (mutually exclusive)
  - xmodem: Use xmodem protocol
  - size: Data size to upload
  - noburn: Test option - do NOT burn flash after upload
  - readflash: Test option - read flash at current region
  - reboot: Reset robot after upload

**TestMode required:**
- `SetMotor [LWheelDist <mm>] [RWheelDist <mm>] [Speed <mm/s>] [Accel <mm/s>]` — Drive wheels
  - Distance in millimeters (pos = forward, neg = backward)
  - Speed required only for wheel movements
  - Accel defaults to Speed value if not specified
- `SetMotor [RPM <rpm>] [Brush] [VacuumOn|VacuumOff] [VacuumSpeed <percent>]` — Control motors
  - RPM not used for wheels, applied to all other motors
  - Brush motor forward (mutually exclusive with wheels and vacuum)
  - VacuumSpeed in percent (1-100)
- `SetMotor [RWheelDisable|LWheelDisable|BrushDisable] [RWheelEnable|LWheelEnable|BrushEnable]` — Enable/disable motors
- `SetLED [BacklightOn|BacklightOff] [ButtonAmber|ButtonGreen|LEDRed|LEDGreen|ButtonAmberDim|ButtonGreenDim|ButtonOff]` — Control LEDs
  - BacklightOn/Off: LCD Backlight (mutually exclusive)
  - ButtonAmber/Green/Red/Green/Dim: Start Button (mutually exclusive)
  - ButtonOff: Start Button Off
- `SetLDSRotation On/Off` — Start/stop LIDAR rotation (mutually exclusive)
- `SetLCD [BGWhite|BGBlack] [HLine <row>] [VLine <col>] [HBars|VBars] [FGWhite|FGBlack] [Contrast <0-63>]` — Set LCD display
  - BGWhite/BGBlack: Fill background
  - HLine/VLine: Draw horizontal/vertical line at specified position
  - HBars/VBars: Draw alternating lines across screen
  - FGWhite/FGBlack: Foreground (line) color
  - Contrast: 0..63 value into NAND
- `SetSystemMode [Shutdown|Hibernate|Standby]` — Power control (mutually exclusive)

**Hidden commands (undocumented, found via reverse engineering):**
- `GetRobotPos [Raw|Smooth]` — Robot position (Raw = odometry, Smooth = smoothed/localized)
- `GetDatabase [All|Factory|Robot|Runtime|Statistics|System|CleanStats]` — Show database tables
- `GetActiveServices` — Display all running services
- `SetUIError [setalert|clearalert|clearall|list]` — UI error state machine control
  - `setalert` — Sets specified UI alert or error
  - `clearalert` — Clears specified UI alert or error
  - `clearall` — Clears all UI alerts and errors
  - `list` — Lists all UI alerts and errors
- `NewBattery` — Tell robot new battery installed (may fix charging issues with new battery)
- `GetState` — Gets UI Finite State Machine state (standard command on newer firmware)
- `Log [Text <text>|Flush]` — Write text to log or flush log entries
- `CopyDumps` — Copy all core dumps to EMMC and pack them
- `GetLoggingType` — Display log type (QA, NavPen, or Production)
- `GetRobotPassword` — Returns robot's saved random password
- `RunUSMFGTest` — Run Ultrasonic MFG Test (function unknown)
- `GetI2CBlowerInfo` — Get I2C Blower Registers (TestMode only)
- `USBLogCopy` — Copy all logs to USB drive
- `CalibrateSensor` — Auto-calibrate sensors and store to SCB (requires security key)
- `CalibrateAccelerometer` — Calibrate accelerometer X/Y positions (requires security key)
- `GetStats` — Show system statistics (unimplemented: "Not supported yet...")
- `SetApp Alert` — Set alert/error to be sent to app
- `UpdateSW [GetStatus|Verify|Terminate]` — Software update control
  - `GetStatus` — Returns status of SW update
  - `Verify` — Returns status of SW update
  - `Terminate` — Force shutdown of SoftwareManager
- `TestPWM` — PWM testing (function unknown)
- `GetWifiStatus [mfgtest|registry|sloginfo|wpacfg|...]` — WiFi diagnostics
  - `mfgtest` — MFG test to check if WiFi chip present
  - `registry` — Show WiFi registries
  - `sloginfo [Pattern] [Pattern2] [Exclude] [clear]` — WiFi log info with pattern matching
  - `wpacfg` — Show /emmc/wpa_supplicant.cfg file
- `Clean` — Extended flags beyond standard House/Spot/Stop:
  - `Persistent` — Start persistent cleaning (as from Smart App)
  - `Width <cm>` — Spot width 100-400cm (-1 = default)
  - `Height <cm>` — Spot height 100-400cm (-1 = default)
  - `AutoCycle` — Auto cycle mode (cleared by shutdown or Clean Stop, not with Spot)
  - `MinCharge <percent>` — Min charge to trigger recharge (-1 = default 50%)
  - `NavTest` — Navigation test mode
  - `CleaningEnable` — Enable brush and vacuum during cleaning
  - `CleaningDisable` — Disable brush and vacuum during cleaning
  - `IEC1mTest` — Run IEC cleaning test
  - `MaxModeEnable` — Enable max cleaning mode
  - `MaxModeDisable` — Disable max cleaning mode
- `ClearFiles [BB] [All] [Life]` — Clear log files
  - `BB` — Clear managed logs in BlackBox directory
  - `All` — Additionally clear unmanaged files (crash logs, etc.)
  - `Life` — Function unknown

**Notes on hidden commands:**
- Most hidden commands found in firmware 3.2.0-4.5.3 via reverse engineering
- Some require security keys (CalibrateSensor, CalibrateAccelerometer)
- Some are unimplemented (GetStats)
- Function of some commands unknown (RunUSMFGTest, TestPWM)
- D3-D7 support varies by firmware version
- **No WiFi control commands** — robot WiFi is managed internally, no serial access

### Response Formats

**GetCharger** — CSV: `Label,Value`
```
Charger Variable Name, Value Label,Value FuelPercent,100 BatteryOverTemp,0
ChargingActive,0 ChargingEnabled,0 ConfidentOnFuel,0 OnReservedFuel,0 EmptyFuel,0
BatteryFailure,0 ExtPwrPresent,0 ThermistorPresent[0],0 ThermistorPresent[1],0
BattTempCAvg[0],103 BattTempCAvg[1],103 VBattV,0.21 VExtV,0.00 Charger_mAH,0
MaxPWM,65536 PWM,-858993460
```
Simplified format (newer firmware):
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
- 360 output lines of LDS Scan Angle, Distance code in MM, normalized spot intensity, and error code
- AngleDeg: 0-359 (integer)
- DistMM: millimeters (0 = no reading)
- Intensity: Normalized spot intensity
- ErrorCode: 0 = valid, non-zero = error
- Followed by 2 status variable pairs
- Example: `AngleInDegrees,DistInMM,Intensity,ErrorCodeHEX 0,221,1400,0 1,223,1396,0 ... 359,220,1421,0 ROTATION_SPEED (in Hz, Floating Point),5.00`

**GetState** — Two lines:
```
Current UI State is: UIMGR_STATE_STANDBY
Current Robot State is: ST_C_Standby
```

**GetVersion** — CSV: `Component,Major,Minor,Build`
```
Component,Major,Minor,Build
Product Model,XV-11,,
Serial Number,AAAnnnnnAA,0000000,D
Software,6,1,13328
LDS Software,V1.0.0,,
LDS Serial,XXX-YYY,,
MainBoard Vendor ID,1,,
MainBoard Serial Number,99,,
MainBoard Version,0,8,
Chassis Version,-1,,
UIPanel Version,-1,,
```
More recent versions may include:
```
ModelID,0,XV11, ConfigID,1,, Serial Number,AAAnnnnnAA,0000000,D
Software,2,1,15499 BatteryType,1,NIMH_12CELL, BlowerType,1,BLOWER_ORIG,
BrushSpeed,0,, BrushMotorType,1,BRUSH_MOTOR_ORIG, SideBrushType,1,SIDE_BRUSH_NONE,
WheelPodType,1,WHEEL_POD_ORIG, DropSensorType,1,DROP_SENSOR_ORIG,
MagSensorType,1,MAG_SENSOR_ORIG, WallSensorType,1,WALL_SENSOR_ORIG,
Locale,1,LOCALE_USA, LDS Software,V1.0.0,, LDS Serial,XXX-YYY,, LDS CPU,F2802x/cd00,,
MainBoard Vendor ID,1,, MainBoard Serial Number,99,, MainBoard Version,15,0,
ChassisRev,-1,, UIPanelRev,-1,,
```

**GetWarranty** — Three hex values, convert with `strtoul(hex, nullptr, 16)`

**GetErr [Clear]** — Returns error message if present, otherwise no message
- Error code 200 (`UI_ALERT_INVALID`) = no error (normal state)
- `Clear` flag dismisses the reported error
- **Complete error code list:**
  - 1: WDT, 2: SSEG LED, 3: BTN LED, 4: BACK LED, 5: FLASH
  - 10: BattNominal, 11: BattOverVolt, 12: BattUnderVolt, 13: BattOverTemp
  - 14: BattShutdownTemp, 15: BattUnderCurrent, 16: BattTimeout, 17: BattTempPeak
  - 18: BattFastCapacity, 19: BattMACapacity, 20: BattOnReserve, 21: BattEmpty
  - 22: BattMismatch, 23: BattLithiumAdapterFailure
  - 207: I had to reset my system. Please press START to clean
  - 217: Please unplug my Power Cable when you want me to clean
  - 218: Please unplug my USB Cable when you want me to clean
  - 219: Please set schedule to ON first
  - 220: Please set my clock first
  - 222: Please put my Dirt Bin back in
  - 223: Please check my Dirt Bin and Filter. Empty them as needed
  - 224: My Brush is overheated. Please wait while I cool down
  - 225: My Battery is overheated. Please wait while I cool down
  - 226: I am unable to navigate. Please clear my path
  - 227: Please return me to my base
  - 228: My Bumper is stuck. Please free it
  - 229: Please put me down on the floor
  - 230: I can't charge. Try moving the base station to a new location
  - 231: My Left Wheel is stuck. Please free it from debris
  - 232: My Right Wheel is stuck. Please free it from debris
  - 233: I have an RPS error. Please visit web support
  - 234: My Brush is stuck. Please free it from debris
  - 235: My Brush is overloaded. Please free it from debris
  - 236: My Vacuum is stuck. Please visit web support
  - 237: Please Check my filter and Dirt Bin
  - 238: My Battery has a critical error. Please visit web support
  - 239: My Brush has a critical error. Please visit web support
  - 240: My Schedule is now OFF
  - 241: I can't shut down while I am connected to power
  - 243: A Software update is available. Please visit web support
  - 244: My SCB was corrupted. I reinitialized it. Please visit web support
  - 245: Please Dust me off so that I can see

### Polling Intervals (from reference project)
- `GetErr` + `GetState`: every 2 seconds
- `GetCharger`: every 2 minutes
- Inter-command delay: 50ms between sequential commands
- TestMode -> SetSystemMode delay: 100ms

### UI States (UIMGR_STATE_*)
Key states: `POWERUP`, `STANDBY`, `IDLE`, `HOUSECLEANINGRUNNING`,
`HOUSECLEANINGPAUSED`, `SPOTCLEANINGRUNNING`, `SPOTCLEANINGPAUSED`,
`DOCKINGRUNNING`, `DOCKINGPAUSED`, `TESTMODE`, `MANUALDRIVING`

### Clean Stop Behavior
Single `Clean Stop` command transitions:
- RUNNING → PAUSED (first call)
- PAUSED → IDLE (second call)

**SetUIError dance required for pause**: The D7 (firmware 4.6.0) does not
transition its UI state machine to `CLEANINGPAUSED` after a bare `Clean Stop` —
`GetState` keeps reporting `CLEANINGRUNNING` even though the robot physically
stops. A `SetUIError setalert UI_ALERT_OLD_ERROR` + `SetUIError clearalert
UI_ALERT_OLD_ERROR` sequence immediately after `Clean Stop` nudges the state
machine into reporting the correct paused state. The firmware enqueues all three
commands atomically (50ms inter-command delay handled by the serial queue).
This workaround was discovered via ESPHome community integrations.

### Supported Robots
D3, D4, D5, D6, D7 confirmed. D70-D85 likely compatible.
D8/D9/D10 NOT supported (different board, password-locked serial).

### Known Limitations
- LIDAR scan responses are large; line-by-line reading recommended
- Serial commands must be queued (no overlapping)
- In TestMode, GetState always returns `UIMGR_STATE_TESTMODE`
- No known serial command to return to dock
- Commands cannot have leading spaces
- Communication parameters (Baud, start/stop bits, parity) are unimportant for USB
  (they apply only to real COM ports, not USB CDC)

### Additional Commands from XV-11 Manual

**DiagTest flags:**
- `TestsOff` — Stop diagnostic test and clear all diagnostic test modes
- `DrivePath [DrivePathDist <mm>]` — Robot travels straight by commanded distance as path
- `DriveForever [DriveForeverLeftDist <mm>] [DriveForeverRightDist <mm>] [DriveForeverSpeed <mm/s>]` — Robot drives continuously; ratio of left/right determines turn radius
- `MoveAndBump` — Executes canned series of motions, but will react to bumps
- `DropTest [Speed <mm/s>] [BrushSpeed <rpm>] [AutoCycle|OneShot]` — Drive forward until drop detected
  - `AutoCycle` — Robot drives backwards then forward until drop detected, repeating until test over
  - `OneShot` — Only executes test once
- `BrushOn` — Turn on brush during test (may conflict with motor commands)
- `VacuumOn` — Turn on vacuum during test (may conflict with motor commands)
- `LDSOn` — Turn on LDS during test (may conflict with motor commands)
- `AllMotorsOn` — Turn on brush, vacuum, and LDS during test (may conflict with motor commands)
- `DisablePickupDetect` — Ignore pickup (wheel suspension). By default, pickup detect is enabled and stops the test

**PlaySound IDs (0-20):**
- 0: Waking Up
- 1: Starting Cleaning
- 2: Cleaning Completed
- 3: Attention Needed
- 4: Backing up into base station
- 5: Base Station Docking Completed
- 6: Test Sound 1
- 7: Test Sound 2
- 8: Test Sound 3
- 9: Test Sound 4
- 10: Test Sound 5
- 11: Exploring
- 12: ShutDown
- 13: Picked Up
- 14: Going to sleep
- 15: Returning Home
- 16: User Canceled Cleaning
- 17: User Terminated Cleaning
- 18: Slipped Off Base While Charging
- 19: Alert
- 20: Thank You

**GetAccel** — Returns: `Label,Value PitchInDegrees, RollInDegrees, XInG, YInG, ZInG, SumInG`

**GetButtons** — Returns: `Button Name,Pressed` for BTN_SOFT_KEY, BTN_SCROLL_UP, BTN_START, BTN_BACK, BTN_SCROLL_DOWN
Example: `BTN_SOFT_KEY,0 BTN_SCROLL_UP,0 BTN_START,0 BTN_BACK,0 BTN_SCROLL_DOWN,0`

**GetCalInfo** — Returns calibration values:
```
Parameter,Value LDSOffset,0 XAccel,0 YAccel,0 ZAccel,0 RTCOffset,0 LCDContrast,43
RDropMin,-1 RDropMid,-1 RDropMax,-1 LDropMin,-1 LDropMid,-1 LDropMax,-1
WallMin,-1 WallMid,-1 WallMax,-1
```

**GetSchedule** — Returns schedule for all days or specific day:
```
Schedule is Enabled Sun 00:00 - None - Mon 00:00 - None - Tue 00:00 R
Wed 00:00 R Thu 00:00 R Fri 00:00 H Sat 00:00 H
```
(R = spot clean, H = house clean, None = no cleaning)

**GetTime** — Returns: `DayOfWeek HourOf24:Min:Sec` Example: `Sunday 13:57:09`

**GetLifeStatLog** — Returns multiple LifeStat logs from oldest to newest, non-zero entries only:
Format: `runID,statID,count,Min,Max,Sum,SumV*2`
Includes stats for A2D sensors, drop sensors, clean types, errors (brush overtemp, battery overtemp,
wheel stuck, LDS jammed, brush stuck, vacuum stuck, etc.), LDS errors (dot issues, calibration,
laser errors), alerts, and usage counters.

**GetSysLog** — Returns: `(Unimplemented) Sys Log Entries: Run, Stat, Min, Max, Sum, Count, Time(ms)`

**GetAnalogSensors raw** — Returns raw millivolt values:
```
SensorName,SignalVoltageInmV WallSensorInMM,0 BatteryVoltageInmV,2574 LeftDropInMM,3296
RightDropInMM,3296 RightMagSensor,0 LeftMagSensor,0 XTemp0InC,1759 XTemp1InC,1759
VacuumCurrentInmA,322 ChargeVoltInmV,0 NotConnected1,0 BatteryTemp1InC,1759
NotConnected2,0 CurrentInmA,992 NotConnected3,0 BatteryTemp0InC,1759
```

**GetAnalogSensors stats** — Returns statistics (Mean, Max, Min, Cnt, Dev):
```
SensorName,Mean,Max,Min,Cnt,Dev WallSensorInMM,0,0,0,50,0
BatteryVoltageInmV,2574,2574,2574,50,0 LeftDropInMM,3296,3296,3296,50,0
(stats for all sensors with mean, max, min, count, deviation)
```

**GetDigitalSensors** — Full sensor list:
```
SNSR_DC_JACK_CONNECT,0 SNSR_DUSTBIN_IS_IN,1 SNSR_LEFT_WHEEL_EXTENDED,0
SNSR_RIGHT_WHEEL_EXTENDED,0 LSIDEBIT,0 LFRONTBIT,0 RSIDEBIT,0 RFRONTBIT,0
```

**GetMotors** — Full motor diagnostic output (if no flags, all motors reported):
```
Parameter,Value Brush_MaxPWM,65536 Brush_PWM,-858993460 Brush_mVolts,1310
Brush_Encoder,0 Brush_RPM,-858993460 Vacuum_MaxPWM,65536 Vacuum_PWM,-858993460
Vacuum_CurrentInMA,52428 Vacuum_Encoder,0 Vacuum_RPM,52428
LeftWheel_MaxPWM,65536 LeftWheel_PWM,-858993460 LeftWheel_mVolts,1310
LeftWheel_Encoder,0 LeftWheel_PositionInMM,0 LeftWheel_RPM,-13108
RightWheel_MaxPWM,65536 RightWheel_PWM,-858993460 RightWheel_mVolts,1310
RightWheel_Encoder,0 RightWheel_PositionInMM,0 RightWheel_RPM,-13108
Laser_MaxPWM,65536 Laser_PWM,-858993460 Laser_mVolts,1310 Laser_Encoder,0
Laser_RPM,52428 Charger_MaxPWM,65536 Charger_PWM,-858993460 Charger_mAH,52428
```

## Frontend Stack

- **Framework**: Preact (~4 KB gzipped) — React-compatible API, minimal footprint for
  constrained firmware budget
- **Build tool**: Vite — tree-shaking, minification, gzip-ready output
- **Language**: TypeScript with JSX (TSX)
- **Pipeline**: `npm run build` → minified bundle → gzip → generate C header with
  embedded byte arrays → firmware compiles with assets baked in
- **Serving**: ESPAsyncWebServer serves embedded assets from PROGMEM with gzip
  Content-Encoding headers
- **OTA strategy**: Frontend assets are bundled into the firmware binary, so a single
  firmware OTA update covers both code and UI — no version mismatch possible, no
  separate SPIFFS upload needed
- **Size budget**: 1600 KB per OTA slot is shared between firmware and embedded assets;
  keeping the frontend small is still important (Preact helps here)
- **SPIFFS freed**: With frontend in firmware, the full SPIFFS partition is available
  for analytics logs and diagnostics (Phase 3)
- **Mock server**: `frontend/mock/server.js` runs as Vite plugin, simulates all API
  endpoints with stateful responses. To test scenarios (low battery, errors, charging),
  edit the `SCENARIO` constant at the top of the file and save (Vite auto-reloads).
  Available scenarios (3-letter codes): `ok` (normal idle), `off` (offline),
  `cls` (house cleaning), `spt` (spot cleaning), `chg` (charging 62%),
  `ch2` (charging 25%), `ful` (full on dock), `mid` (battery 45%), `low` (battery 12%),
  `ded` (battery 0%), `err` (brush stuck). Fault injection scenarios: `fa` (actions),
  `fs` (settings), `flr` (log read), `fld` (log delete), `fl` (all logs),
  `fps` (poll state), `fpc` (poll charger), `fpe` (poll error), `fp` (all polls),
  `fal` (all faults). Combine with `|`: `"err|fa|fp"`. State is static (no dynamic
  simulation). Always reset SCENARIO to `"ok"` before committing.

### Web UI Design

**Core principles:**
- Consumer-facing UI, not a debug tool — show human-readable status, not raw sensor dumps
- Mobile-first responsive design with breakpoints at 400px, 600px, 900px
- Dark theme as default, user-selectable theme (auto/light/dark) via settings page
- Hash-based routing (`#/` dashboard, `#/settings` settings, `#/logs` logs,
  `#/schedule` schedule) — persists across refresh, supports browser back/forward
  via `Router`/`Route` components and `useRoute` hook

**Layout structure:**
- Header: "OpenNeato" branding left, gear icon (settings) right
- Hero area: Robot illustration (right) + info cards (left) with glass-effect cards
- Info cards: Status, Battery, Mode — each showing icon + label + value
- Action bar: 3 equal-width buttons (House, Spot, Stop) with 34px icons

**Settings page:**
- Full page swap (gear icon → settings, back arrow → dashboard)
- Header: back button (left), "Settings" title (center), spacer (right)
- Collapsible categories: each section is a `SettingsCategory` component with icon,
  title, and chevron. Expand/collapse animated via CSS `grid-template-rows` (0fr→1fr).
  Categories: Appearance (palette icon, default open), Network (wifi icon),
  Robot (robot vacuum icon), Firmware (chip icon), Diagnostics (stethoscope icon).
- Appearance category: 3-button theme selector (Auto, Light, Dark)
- Theme preference persisted in localStorage, defaults to system if unset
- Network category: hostname text input (max 32 chars, alphanumeric + hyphens),
  WiFi TX Power dropdown with dBm presets (8.5–19.5 dBm)
- Robot category: timezone dropdown with 16 common POSIX TZ presets (UTC offset shown),
  robot time display (dimmed small text from `GET /api/system` `time` field adjusted
  by selected TZ offset), UART Pins (two number inputs TX/RX 0–21, no duplicates)
- Firmware category: shows current firmware version (tag icon) + chip model (chip icon).
  File picker for .bin upload, client-side chip validation (parses ESP32 image header
  byte 12 to detect target chip, rejects firmware built for wrong chip), server-side
  chip validation (compares binary header chip ID against esp_chip_info at first chunk,
  aborts before flash write on mismatch), MD5 hash computation, upload with smoothed
  progress bar via XMLHttpRequest (caps at 90% during upload, holds at "Writing
  firmware..." while server writes flash, jumps to 100% on response), auto-reboot
  after success. Bootloader provides third safety net via
  bootloader_common_check_chip_validity on boot with auto-rollback.
- Diagnostics category: debug logging toggle, "Logs" nav row (database icon + chevron)
- Unified Save button between categories and Device section: "Save" for non-reboot
  changes, "Save & Reboot" when hostname or pins changed — shows confirm dialog
- Unsaved changes guards: `beforeunload` prevents tab close, in-app navigation (back
  button, logs link) shows "Discard unsaved changes?" confirm dialog
- Device section (not collapsible): Restart button, Factory Reset button
  (type-to-confirm "RESET")

**Logs page:**
- Navigated from settings Diagnostics section, back button returns to settings
- List view: summary bar (file count + total size + "Delete All" button), file rows
  with name, date (parsed from epoch filename), size, compressed badge, delete button
- Detail view: tapping a file fetches its content, parses JSON-lines, displays entries
  with colored type badges (BOOT/WIFI/NTP/CMD/HTTP/EVT/OTA), timestamps, monospace
  summary of remaining fields. Back button returns to list view.
- Delete: per-file delete button (alert icon, red), "Delete All" button in summary bar
- Empty state: centered database icon + "No log files" / "Empty log" message

**Visual design:**
- Dark theme: Radial gradient background (`#38383e` → `#232328` → `#161618`)
- Light theme: Radial gradient background (`#eff0f5` → `#f5f5f9` → `#ffffff`),
  lighter surfaces (`#e5e5ea`), translucent cards (`rgba(0,0,0,0.06)`)
- Glass-effect cards: `backdrop-filter: blur(12px)` with translucent backgrounds
- Button icon color: `var(--btn-color)` — `#c6c2bc` dark, `#6e6e73` light
- Battery thresholds: red ≤25%, amber 26-50%, light green 51-75%, full green 76%+

**Pending state pattern:**
- Single `pending` flag shared across action buttons
- On click: button disabled immediately, pulse animation indicates waiting
- Clears when polled `uiState` changes (backend confirms the action)
- Find/sound actions excluded (fire-and-forget, no state change)

**Icon system:**
- SVG files in `frontend/src/assets/icons/`, loaded via Vite `?raw` import
- `Icon` component renders raw SVG strings via `dangerouslySetInnerHTML`
- Single-color icons use `currentColor` (spot, stop, gear, power, back, sun, moon)
- Multi-color icons hardcode colors (battery shell, house outline)
- Battery icon: Dynamic fill rectangle clipped via `<clipPath>` based on charge %

**Robot illustration:**
- Vectorized D-shape Neato vacuum from 3/4 perspective
- 4 greyscale layers: `#cac5a2` (highlights), `#666362`, `#3e3c3c`, `#191613` (shadows)
- 1px white outline via 4-directional `drop-shadow` filters
- Responsive positioning: mobile (left: 220px, half off-screen), tablets+ (fits within viewport)
- `overflow: hidden` on `.hero-area` clips right edge on mobile

**Theme implementation:**
- CSS variables in `:root` (dark defaults)
- `.light` class on `<html>` for explicit light mode
- `.system-theme` class + `@media (prefers-color-scheme: light)` for auto mode
- Dark mode: no extra class needed (`:root` defaults)
- `applyTheme()` in app.tsx sets the correct class on `document.documentElement`
- Theme persisted to localStorage only on user interaction (not on initial mount)
- All theme-sensitive values use CSS variables (surfaces, cards, buttons, text)
- Dynamic `<meta name="theme-color">` updated by `applyTheme()` to match active
  theme (`#161618` dark, `#ffffff` light) — controls PWA/mobile status bar color.
  System theme tracks OS preference changes via `matchMedia` listener.
- iOS Safari safe area: `viewport-fit=cover` extends page background into status
  bar and home indicator areas. `html` element has solid `background-color: var(--bg)`
  (separate from `body` gradient) so Safari can sample it for chrome coloring.
  Header uses `padding-top: calc(Npx + env(safe-area-inset-top))`, action bar uses
  `padding-bottom: max(Npx, env(safe-area-inset-bottom))` to keep content clear of
  notch/home bar.

**Responsive breakpoints:**
```css
/* Mobile default: <400px */
/* Larger phones: ≥400px */
/* Tablets: ≥600px (max-width: 600px body) */
/* Desktop: ≥900px (max-width: 700px body) */
```

## Architecture

Two top-level directories: `firmware/` for ESP32 code, `frontend/` for the web UI.
`platformio.ini` stays at the root so CLion/PlatformIO can load the project directly.

**Important**: Keep this section up to date whenever files are added, removed, or
renamed — especially after completing a phase or making a commit that changes project
structure. This avoids redundant codebase exploration and keeps agents productive.

```
.clang-format              # Code formatting rules (K&R braces, 4-space indent, 120 cols)
.clang-tidy                # Static analysis config for pio check
.gitignore                 # Ignores .pio/, node_modules/, dist/, .cache/, etc.
platformio.ini             # PIO config (src_dir = firmware/src)
scripts/
  env_config.py            # Pre-build script: injects FIRMWARE_VERSION build flag,
                           #   auto-generates 0.0.0+<git-hash> when not set,
                           #   sets UPLOAD_PORT from OTA_HOST env var for OTA uploads,
                           #   BUILD_FRONTEND=1 triggers `npm run build` before compile
firmware/
  src/
    config.h               # Global defines, macros, LOG macro, pin/timing constants,
                           #   data logger settings (file sizes, NTP servers, TZ,
                           #   LOG_FLUSH_INTERVAL_MS=10000, LOG_FLUSH_MAX_LINES=64,
                           #   LOG_SPACE_LIMIT_PERCENT=90, LOG_MAX_FILES=50),
                           #   NVS namespace/key defines (NVS_KEY_DEBUG_LOG,
                           #   NVS_KEY_HOSTNAME, NVS_KEY_WIFI_TX_POWER,
                           #   NVS_KEY_UART_TX_PIN, NVS_KEY_UART_RX_PIN),
                           #   DEFAULT_HOSTNAME ("neato"), default pin/power values,
                           #   CommandStatus enum, AsyncCache TTL defines
                           #   (CACHE_TTL_STATE, CACHE_TTL_CHARGER, etc.),
                           #   task watchdog define (TASK_WDT_TIMEOUT_S),
                           #   heap watchdog defines (HEAP_WATCHDOG_THRESHOLD,
                           #   HEAP_WATCHDOG_DURATION_MS),
                           #   schedule defines (NVS_KEY_SCHED_ENABLED,
                           #   SCHEDULE_DAYS, SCHEDULE_CHECK_INTERVAL_MS,
                           #   SCHEDULE_WINDOW_MINS)
    async_cache.h          # Generic AsyncCache<T> template: TTL-based caching with
                           #   request deduplication and explicit invalidation. Stores
                           #   last value + timestamp, coalesces concurrent waiters
                           #   during in-flight fetch, serves cached value within TTL.
                           #   Optional HitFunc callback (3rd constructor param) fires
                           #   on cache hits with age in ms (used for logging).
                           #   Header-only (template). Used by NeatoSerial.
    main.cpp               # setup()/loop() entry point, global Preferences (single
                           #   "neato" NVS namespace opened once, shared by ref),
                           #   WiFi event handlers -> dataLogger.logWifi() (registered
                           #   BEFORE wifiManager.begin() to capture boot events),
                           #   WiFiManager/FirmwareManager/Scheduler logger callbacks
                           #   wired to DataLogger. SettingsManager wiring (tz change
                           #   callback -> SystemManager::applyTimezone), robot time
                           #   fallback via GetTime, NTP-to-robot clock sync, periodic
                           #   re-sync (4h), factory reset (button hold clears
                           #   NVS + restart). Deferred web server start: if WiFi
                           #   is slow at boot (DHCP timeout), web server starts
                           #   later in loop() once WiFi connects.
                           #   wifiManager.setHostname() at boot from settings
    serial_menu.h/cpp      # Generic interactive serial menu system (state machine,
                           #   formatting helpers: printStatus, printError, etc.)
    wifi_manager.h/cpp     # WiFi config, credential storage (shared Preferences&),
                           #   network scanning, serial quick commands ([m]enu, [s]tatus),
                           #   auto-reconnect with exponential backoff and attempt
                           #   counting, LogCallback for WiFi event logging (boot
                           #   connect/fail, reconnect ok/fail with RSSI/channel/
                           #   BSSID/attempt/backoff/duration), applyTxPower()
                           #   from NVS before WiFi.begin() for reliable association.
                           #   WiFi modem sleep: esp_wifi_set_ps(WIFI_PS_MIN_MODEM)
                           #   enabled in connectToWiFi() — radio sleeps between AP
                           #   beacons, ~120mA → ~15-20mA idle. Association stays active.
                           #   wifiManager.setHostname() at boot from settings
    firmware_manager.h/cpp # Firmware update business logic using ESP32 Update.h,
                           #   no web server dependency — pure update lifecycle:
                           #   beginUpdate(), writeChunk(), endUpdate(),
                           #   getFirmwareVersion(), getChipModel() (ESP.getChipModel()),
                           #   MD5 validation, server-side chip ID validation
                           #   (validateChip() compares image header byte 12 against
                           #   esp_chip_info, aborts before flash write on mismatch),
                           #   auto-reboot,
                           #   isInProgress()/getProgress()/getError() queries,
                           #   LogCallback hook. Routes registered by WebServer.
    settings_manager.h/cpp # Unified settings management: owns all user-configurable
                           #   NVS keys (tz, debug_log, hostname, wifiTxPower,
                           #   uartTxPin, uartRxPin). Settings struct extends
                           #   JsonSerializable with toFields() and fromFields().
                           #   begin() loads from NVS, apply(json) does partial
                           #   updates via fromJson() (only fields present get
                           #   written). ApplyResult enum (UNCHANGED, CHANGED,
                           #   INVALID). needReboot flag for pin/hostname changes.
                           #   onTzChange() callback mechanism.
                           #   SchedDay struct + scheduleEnabled/sched[7] for
                           #   ESP32-managed 7-day schedule (flat NVS keys:
                           #   s0h/s0m/s0on..s6h/s6m/s6on, Mon=0..Sun=6).
                           #   Flat JSON keys: sched{0-6}{Hour,Min,On}.
    scheduler.h/cpp        # ESP32-managed cleaning scheduler. Checks system time
                           #   against 7-day schedule in SettingsManager, issues
                           #   Clean House via NeatoSerial when scheduled time is
                           #   reached. Window-based triggering (SCHEDULE_WINDOW_MINS),
                           #   duplicate fire guard (firedDay/firedSlot), robot idle
                           #   check via getState cache. Graceful busy handling:
                           #   marks slot as fired if robot already cleaning.
                           #   LogCallback for DataLogger integration (trigger,
                           #   skipped, trigger_failed, state_error events).
                           #   Uses SystemManager::now() for time (NTP + fallback).
    system_manager.h/cpp   # NTP time sync, applyTimezone() for POSIX TZ (called
                           #   via SettingsManager callback, no longer owns TZ in
                           #   NVS). SystemHealth struct (JsonSerializable) returned
                           #   by getSystemHealth(tz) with heap, uptime, RSSI,
                           #   SPIFFS, NTP fields. Robot-agnostic — no NeatoSerial
                           #   dependency. onNtpSync() callback for main.cpp to push
                           #   time to robot. setFallbackClock() for external clock
                           #   sources (e.g. robot GetTime).
                           #   Deferred reboot: restart(), factoryReset() set timestamp,
                           #   checkPendingReboot() in loop() executes after 500ms.
                           #   Factory reset: NVS clear + WiFi disconnect + SPIFFS format.
                           #   Heap watchdog: monitors free heap in loop(), restarts
                           #   if below HEAP_WATCHDOG_THRESHOLD (16KB) for
                           #   HEAP_WATCHDOG_DURATION_MS (10s). Prevents unresponsive
                           #   state from memory exhaustion (e.g. socket leak after
                           #   UART desync cascade).
                           #   Task Watchdog Timer: initTaskWdt() configures ESP-IDF
                           #   hardware TWDT (esp_task_wdt) with TASK_WDT_TIMEOUT_S
                           #   timeout, subscribes the main Arduino task. feedTaskWdt()
                           #   resets the timer each loop() iteration. If loop() hangs,
                           #   TWDT triggers a hardware reset. Initialized after all
                           #   slow boot init to avoid false triggers.

    web_server.h/cpp       # Serves embedded frontend assets from PROGMEM, registers
                           #   all REST API routes (sensor GET, action POST),
                           #   firmware routes (version, OTA upload), log routes
                           #   (list/download/delete), system routes (health),
                           #   settings routes (GET/PUT /api/settings via
                           #   SettingsManager). Request logging on all sensor/action
                           #   routes via DataLogger. Firmware routes delegate to
                           #   FirmwareManager for version/update. Template helpers:
                            #   registerSensorRoute<T>(), registerActionRoute<A>()
                           #   (variadic template: auto-parses query params to typed
                           #   method args via detail::paramConvert),
                           #   sendGzipAsset(), sendError()
                           #   Thin route layer — no business logic. System actions
                           #   (restart, factoryReset) call SystemManager directly.
    web_assets.h           # Auto-generated — WebAsset struct + WEB_ASSETS[] registry
                           #   of all dist/ files (gzipped PROGMEM byte arrays, paths,
                           #   MIME types). Web server iterates registry to register routes.
    data_logger.h/cpp      # On-device analytics (Phase 3): SPIFFS JSON-lines logging,
                           #   heatshrink compression on rotation, space enforcement,
                           #   boot event logging, NeatoSerial command hook (logs every
                           #   serial command with status/queue/bytes), log file management
                           #   (list/read/delete). Delegates time to SystemManager.
                           #   All logging methods use typed fields (std::vector<Field>)
                           #   instead of raw JSON string fragments — logEvent(),
                           #   logWifi(), logOta(), logNtp() accept Field vectors,
                           #   serialized via fieldsToJsonInner() from json_fields.
                           #   LogReader abstraction: readLog() returns shared_ptr<LogReader>,
                           #   PlainLogReader (thin File wrapper), CompressedLogReader
                           #   (streaming heatshrink decoder), or BufferedLogReader
                           #   (merges file + unflushed buffer for current.jsonl) —
                           #   web_server uses reader->read() with beginChunkedResponse,
                           #   no decompression knowledge leaks out.
                           #   Non-blocking design: log writes buffered in memory
                           #   (accepts entries before SPIFFS is ready for early-boot
                           #   events, capped at LOG_FLUSH_MAX_LINES*4 to bound heap),
                           #   flushed to SPIFFS in loop(); log rotation uses fast
                           #   rename + incremental heatshrink compression across
                           #   loop() iterations; bulk delete deferred one file per tick.
                           #   No boot archive: current.jsonl survives reboots, rotates
                           #   at 32KB when NTP synced (epoch filename). enforceLimits()
                           #   runs every loop() tick: deletes oldest if space >90% or
                           #   file count >LOG_MAX_FILES (50).
                           #   listLogs() always includes current.jsonl with accurate
                           #   size (file + buffer), no SPIFFS I/O for current file.
                           #   DebugCheck callback: when set and returns true, raw
                           #   serial responses are included in command log entries
                           #   via the "resp" field. Wired to SettingsManager.debugLog
                           #   in main.cpp.
                           #   Cache hit logging: "age" field emitted when cacheAgeMs > 0
                           #   (implicit — presence means cached, absence means fresh).
    json_fields.h/cpp      # Lightweight field-based JSON serialization and parsing:
                           #   Field struct, FieldType enum (INT, FLOAT, BOOL, STRING),
                           #   fieldsToJson() wraps in braces, fieldsToJsonInner()
                           #   returns bare key-value pairs (for embedding in envelopes).
                           #   fieldsFromJson() parses flat JSON object into Field vector
                           #   (inverse of fieldsToJson), findField() for key lookup.
                           #   jsonEscape() for safe string embedding. JsonSerializable
                           #   base struct with toFields()/toJson() for serialization and
                           #   fromFields()/fromJson() for deserialization. Used by
                           #   neato_commands, data_logger, system_manager, settings_manager,
                           #   web_server.
    neato_commands.h/cpp   # Command string constants (27 #define CMD_* macros mapping
                           #   directly to UART command strings — no enum, no
                           #   commandToString() lookup), response structs (VersionData,
                           #   ChargerData, AnalogSensorData, DigitalSensorData,
                           #   MotorData, RobotState, ErrorData, AccelData, ButtonData,
                           #   LdsScanData), CSV parsers, toFields() implementations,
                           #   SoundId enum, SetUIError setalert/clearalert commands.
    neato_serial.h/cpp     # UART command queue state machine (IDLE -> SENDING ->
                           #   WAITING_RESPONSE -> INTER_DELAY -> IDLE), typed
                           #   convenience methods (getCharger, getVersion, etc.)
                           #   backed by AsyncCache<T> per sensor type (TTL caching,
                           #   request deduplication, concurrent waiter coalescing),
                           #   action methods (clean, testMode, playSound,
                           #   setLdsRotation) with automatic state cache invalidation,
                           #   invalidateState()/invalidateAll() for explicit control,
                           #   time methods (getTime, setTime), no sendRaw() public API,
                           #   isBusy()/queueDepth() status,
                           #   enqueue() takes command + callback (flat timeout via
                           #   NEATO_CMD_TIMEOUT_MS constant, no per-command override),
                           #   CommandEntry struct: {command, callback} (no timeoutMs).
                           #   LoggerCallback hook for DataLogger integration (7-param:
                           #   cmd, status, ms, raw, queueDepth, respBytes, cacheAgeMs).
                           #   CACHE_HIT(CMD) macro creates per-cache hit lambdas that
                           #   fire loggerCallback with cacheAgeMs on cache hits.
                           #   UART desync protection: flushUartRx() drains stale bytes
                           #   before each command send and after timeouts.
                           #   validateResponseEcho() checks the first line of each
                           #   response matches the sent command — on mismatch, flushes
                           #   UART and fails with CMD_SERIAL_ERROR to prevent cascading
                           #   wrong-response errors.
  lib/
    heatshrink/            # Vendored heatshrink compression library (0.4.1)
      heatshrink_config.h  # Custom config: static alloc, w=10, la=5, 32-bit
      heatshrink_encoder.h/c           # Standard encoder (8/16-bit)
      heatshrink_encoder_32bit.cpp     # 32-bit optimized encoder
      heatshrink_decoder.h/c           # Standard decoder (8/16-bit)
      heatshrink_decoder_32bit.cpp     # 32-bit optimized decoder
      heatshrink_common.h  # Shared definitions
      library.json         # PIO lib manifest (srcFilter, include flags)
      private/
        hs_search.hpp      # Pattern search (patched for GCC 8.4)
        hs_arch.hpp        # Architecture detection (Xtensa/RISC-V)
  partition.csv            # Custom partition table:
                           #   nvs 20KB, otadata 8KB, app0 1600KB, app1 1600KB,
                           #   spiffs 768KB (used by DataLogger for log storage),
                           #   coredump 64KB
frontend/
  package.json             # Preact + Vite build config
  package-lock.json        # Lockfile for reproducible builds
  tsconfig.json            # TypeScript configuration
  vite.config.ts           # Vite build settings (deterministic output filenames,
                           #   dev server: loads mock API plugin for /api/* routes)
  index.html               # SPA entry point
  src/
    main.tsx               # Preact render entry point
    app.tsx                # Root shell: theme management, polling, Router with
                           #   Route declarations for dashboard, settings, logs,
                           #   schedule views
    types.ts               # TypeScript interfaces (ChargerData, AnalogSensorData,
                           #   LogFileInfo, SettingsData, etc.)
    api.ts                 # Typed fetch wrappers for all API endpoints (get/post/put/del
                           #   with server error parsing from JSON body),
                           #   uploadFirmware() via XMLHttpRequest with progress callback
    style.css              # Single CSS file with all styles + responsive breakpoints
    svg.d.ts               # TypeScript declaration for *.svg?raw imports
    hooks/
      use-polling.ts       # Generic polling hook with configurable interval,
                           #   pauses when browser tab is hidden (visibilitychange),
                           #   resumes immediately on tab return
      use-route.ts         # Hash-based routing hook (reads/writes location.hash)
      use-fetch.ts         # Generic one-shot fetch hook (loading/data/error state)
    components/
      icon.tsx             # SVG renderer component using dangerouslySetInnerHTML
      battery-icon.tsx     # Dynamic battery with clipPath + color thresholds
      error-banner.tsx     # Reusable error banner (title + message, alert icon,
                           #   optional onDismiss prop for × close button),
                           #   useErrorStack hook (stable refs via useMemo),
                           #   ErrorBannerStack component for stacked dismissible errors
      confirm-dialog.tsx   # Reusable confirm modal (overlay + blur, Cancel/Delete
                           #   buttons, destructive action styling)
                           #   Optional confirmText prop (type-to-confirm for
                           #   destructive actions like factory reset)
      router.tsx           # Router (context provider), Route (path matcher),
                           #   useNavigate/usePath hooks for any component
    views/
      dashboard.tsx        # Dashboard view: status bar, hero area, info cards,
                           #   action buttons, pending state, helpers
                           #   Two-tier error banners: fixed for robot errors,
                           #   dismissible stack for action errors. Cards show
                           #   "Error" state when polling fails.
                           #   Pending timeout (10s) auto-clears stuck pending state.
                           #   Robot error disables House/Spot action buttons.
                           #   Pause/resume/stop: Idle shows Pause (disabled), Running
                           #   shows Pause (enabled), Paused shows play icon + "Resume"
                           #   on relevant button (House or Spot) and Stop enabled.
      settings.tsx         # Settings view: collapsible categories (Appearance,
                           #   Network, Robot, Firmware, Diagnostics) with icons and
                           #   animated expand/collapse via CSS grid-template-rows.
                           #   Each category is a SettingsCategory component with icon,
                           #   title, and chevron. Appearance theme selector, timezone
                           #   dropdown with POSIX TZ presets, robot time display,
                           #   debug logging toggle (fetches/updates via settings API)
                           #   Unified settings page with single Save button
                           #   (auto-detects reboot-required changes). Configurable
                           #   hostname, UART pins, WiFi TX power. Firmware category:
                           #   shows current version + chip model, file picker for .bin
                           #   upload, chip validation (parses ESP32 image header byte 12
                           #   to reject wrong-chip firmware), progress bar during upload,
                           #   auto-reboot after success. Device restart and factory
                           #   reset with type-to-confirm. Unsaved changes guards
                           #   (beforeunload + in-app navigation).
      settings/            # Settings view submodules (extracted from settings.tsx)
        constants.ts       # TIMEZONE_PRESETS, TX_POWER_PRESETS arrays
        helpers.ts         # findPresetLabel(), formatRobotTime() utilities
        settings-category.tsx  # Collapsible category component
        use-reboot.ts      # Reboot polling hook (polls /api/system until uptime drops)
        use-settings-form.ts   # Settings form state, dirty detection, save logic
        use-firmware-upload.ts # Firmware upload hook: file selection, ESP32 chip ID
                           #   validation from .bin header, MD5 hash computation,
                           #   upload with progress via XMLHttpRequest, reboot flow
      schedule.tsx         # Schedule view: 7-day Mon-Sun cleaning schedule,
                           #   per-day toggle + time picker (hour/minute selects),
                           #   master enable/disable toggle, uses flat settings keys.
                           #   Navigated from Settings > Robot > Cleaning Schedule.
      logs.tsx             # Logs view: file list with size/date, detail view with
                           #   parsed JSON-lines entries, type badges, delete actions.
                           #   Collapsible raw response in command entries (debug log).
                           #   Frontend sorts logs newest-first.
    assets/
      robot.svg            # Main robot illustration (30KB, vectorized 4-layer greyscale)
      icons/               # SVG icons loaded via ?raw import (alert, back, battery,
                           #   bolt, calendar, check, chip, clock, database, gear,
                           #   house, idle, moon, palette, pause, play, power, robot,
                           #   sparkle, spot, stethoscope, stop, sun, tag, wifi, wifi-off)
  mock/
    server.js              # Mock API server (plain Node.js http, zero deps),
                           #   SCENARIO selector for quick state switching,
                           #   stateful simulation of all REST endpoints.
                           #   Request logging via Vite logger (timestamp + tag,
                           #   color-coded by status: info/warn/error).
                           #   Pause state support: POST /api/clean?action=stop
                           #   transitions RUNNING → PAUSED → IDLE on successive calls.
                           #   TestMode and LDS rotation routes with query params.
                           #   Fault injection via scenario codes (fa, fs, fl,
                           #   fp, fal, etc.) with pipe-separated combining.
                           #   Reboot simulation via mutable bootTime reset on
                           #   restart/reset/pin-change/hostname-change requests.
                           #   Schedule: flat keys (sched{0-6}{Hour,Min,On}) in
                           #   state, GET/PUT handlers with loops.
  scripts/
    embed_frontend.js      # Auto-discovers all dist/ files, gzips each, generates
                           #   firmware/src/web_assets.h with WebAsset registry
  dist/                    # Vite build output (index.html + app.js), gitignored
```

### Current API routes

| Method | Path | Handler |
|--------|------|---------|
| GET | `/*` (static) | Serve any embedded frontend asset from WEB_ASSETS[] registry (gzip) |
| GET | `/api/firmware/version` | Current firmware version + chip model (ESP.getChipModel()) |
| POST | `/api/firmware/update?hash=<md5>` | Firmware upload (multipart, optional MD5 validation) |
| GET | `/api/version` | `NeatoSerial::getVersion` -> JSON |
| GET | `/api/charger` | `NeatoSerial::getCharger` -> JSON |
| GET | `/api/sensors/analog` | `NeatoSerial::getAnalogSensors` -> JSON |
| GET | `/api/sensors/digital` | `NeatoSerial::getDigitalSensors` -> JSON |
| GET | `/api/motors` | `NeatoSerial::getMotors` -> JSON |
| GET | `/api/state` | `NeatoSerial::getState` -> JSON |
| GET | `/api/error` | `NeatoSerial::getErr` -> JSON |
| GET | `/api/accel` | `NeatoSerial::getAccel` -> JSON |
| GET | `/api/buttons` | `NeatoSerial::getButtons` -> JSON |
| GET | `/api/lidar` | `NeatoSerial::getLdsScan` -> JSON |
| POST | `/api/clean?action=house\|spot\|stop` | `NeatoSerial::clean` |
| POST | `/api/sound?id=N` | `NeatoSerial::playSound` |
| POST | `/api/testmode?enable=1\|0` | `NeatoSerial::testMode` |
| POST | `/api/lidar/rotate?enable=1\|0` | `NeatoSerial::setLdsRotation` |
| GET | `/api/logs` | List log files with metadata (JSON array) |
| GET | `/api/logs/{filename}` | Download a log file (compressed files auto-decompressed) |
| DELETE | `/api/logs/{filename}` | Delete a specific log file |
| DELETE | `/api/logs` | Delete all log files |
| GET | `/api/system` | Live system health (heap, uptime, RSSI, SPIFFS, NTP) |
| POST | `/api/system/restart` | Deferred restart via SystemManager |
| POST | `/api/system/reset` | Factory reset (NVS clear + WiFi + SPIFFS format) via SystemManager |
| GET | `/api/settings` | All user settings (tz, debugLog, hostname, wifiTxPower, uartTxPin, uartRxPin, scheduleEnabled, sched{0-6}{Hour,Min,On}) |
| PUT | `/api/settings` | Partial settings update (body: `{"tz":"...","debugLog":true}`) |


## Build Commands

### Firmware

```bash
pio run -e Debug                        # Build (auto version: 0.0.0+<git-hash>)
FIRMWARE_VERSION=1.0.0 pio run -e Debug # Build with specific version
BUILD_FRONTEND=1 pio run -e Debug       # Build frontend + firmware in one step
pio run -e Debug -t upload              # Build and upload via USB serial
pio run -e Debug -t upload -t monitor   # Upload and open serial monitor
pio run -e Debug -t monitor             # Serial monitor only
pio run -e OTA -t upload                # OTA upload (defaults to neato.home)
OTA_HOST=10.10.10.15 pio run -e OTA -t upload  # OTA to specific host
pio run -e Debug --target clean         # Clean build artifacts
pio check -e Debug                      # Static analysis (clang-tidy)
clang-format -i firmware/src/*.cpp firmware/src/*.h  # Format code
```

**Version handling**: When `FIRMWARE_VERSION` is not set, the build script auto-generates
a version string from the git commit hash: `0.0.0+<short-hash>`. This provides
traceability for development builds without manual version management.

**Monitor baud rate**: 115200

Verify firmware changes by building with `pio run -e Debug` and running
`pio check -e Debug` with zero defects. Code style is enforced by
`.clang-format` at the project root.

### Frontend

```bash
cd frontend
npm run dev          # Start Vite dev server with mock API
npm run build        # Lint + build + embed assets into firmware header
npm run check        # Biome lint and format check (no changes)
npm run fix          # Auto-fix safe issues (formatting, import order)
npm run fix:unsafe   # Also apply unsafe fixes (template literals, etc.)
```

Frontend build runs `biome check` before `vite build` — lint/format errors
fail the build. Style is enforced by Biome (`frontend/biome.json`):
4-space indent, double quotes, semicolons, 120-char line width, recommended
lint rules.

## Dependencies (all pinned)

- `ESP32Async/AsyncTCP @ 3.4.10`
- `ESP32Async/ESPAsyncWebServer @ 3.9.6`
- Vendored: `heatshrink @ 0.4.1` (from BitsForPeople/esp-heatshrink, in `firmware/lib/heatshrink/`)
  - Static alloc, window=10, lookahead=5, 32-bit mode, patched `hs_search.hpp`
    for GCC 8.4 compatibility (removed `constexpr` from defaulted copy assignment)
- Built-in: `Preferences @ 2.0.0`, `WiFi @ 2.0.0`, `SPIFFS @ 2.0.0`, `Update @ 2.0.0`

## Zero-Dependency Policy

This project enforces a strict zero-dependency policy for both firmware and frontend.
The ESP32-C3 has 320KB RAM and 1600KB per OTA slot — every kilobyte of unused framework
or library code is waste that directly reduces capacity for actual features.

**Rationale**: External libraries and frameworks ship generalized code designed for broad
use cases. On a constrained embedded target, this generality becomes bloat — unused
features still consume flash, RAM, and compile time. Writing purpose-built code that does
exactly what we need and nothing more produces smaller binaries, lower memory usage, and
fewer surprises at runtime.

**Firmware rules:**
- No external libraries beyond what is already listed in Dependencies above
- No JSON libraries (ArduinoJson, cJSON, etc.) — use the project's own `json_fields.h/cpp`
  lightweight field-based serializer, which compiles to a fraction of the size
- No HTTP client libraries — browser-side fetch handles all outbound HTTP
- No MQTT, WebSocket, or pub/sub libraries — REST over ESPAsyncWebServer is sufficient
- Vendor and patch individual source files when a small, focused library is genuinely
  needed (as done with heatshrink) rather than pulling in a full dependency
- Use ESP-IDF / Arduino built-in APIs directly (Preferences, WiFi, SPIFFS, Update)

**Frontend rules:**
- No npm runtime dependencies beyond Preact (the only framework dependency)
- No state management libraries (Redux, Zustand, etc.) — use Preact hooks and props
- No CSS frameworks or utility libraries (Tailwind, styled-components, etc.) — use
  a single `style.css` with CSS variables
- No routing libraries — use the project's own hash-based `Router`/`Route` components
- No HTTP/fetch wrapper libraries (axios, ky, etc.) — use the project's own `api.ts`
- Dev dependencies (Vite, Biome, TypeScript) are acceptable since they do not ship
  in the final binary

**When to make exceptions**: Only when all of the following are true:
1. The functionality is complex enough that a correct implementation is non-trivial
   (cryptography, compression algorithms, protocol stacks)
2. No ESP-IDF / Arduino built-in API covers the need
3. The library can be vendored and trimmed to only the required source files
4. The size impact has been measured and is acceptable within the OTA slot budget

**Never propose** adding a dependency without first explaining why the existing built-in
APIs and project utilities are insufficient.

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


## Hardware Notes

- **Board**: ESP32-C3-DevKitM-1 (RISC-V single core, 160MHz, 320KB RAM, 4MB flash)
- **USB**: Native USB CDC (not UART bridge) — `ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`
- **Reset button**: GPIO9 (BOOT button), active LOW with internal pull-up, hold 5s to reset credentials
- **Flash layout**: Dual OTA slots (1600KB each), 768KB SPIFFS, 20KB NVS
- **NVS**: Single shared `"neato"` namespace (Preferences), opened once in main.cpp,
  passed by reference to WiFiManager and SystemManager. Factory reset clears all keys.
