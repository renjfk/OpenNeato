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
2. **API layer** — UART serial bridge, command queue, REST endpoints, client-side polling
3. **Analytics** — SPIFFS JSON-lines logging, heatshrink compression, NTP time sync
4. **Firmware management** — OTA with MD5 + chip ID validation, dual-partition auto-rollback
5. **Mock API server** — Stateful Node.js dev server (Vite plugin) with scenario switching
6. **Web UI dashboard** — Preact SPA, dark/light theme, mobile-first, embedded in firmware
7. **Async cache** — Generic `AsyncCache<T>` with TTL, deduplication, invalidation
8. **Error handling UX** — Two-tier error banners (fixed robot errors + dismissible API errors)
9. **Settings** — Unified settings page, deferred reboot, unsaved changes guards, WiFi reliability
10. **Pause/Resume/Stop** — State-aware action buttons, SetUIError dance for D7 workaround
11. **Schedule** — ESP32-managed 7-day schedule (robot serial schedule commands not used)
12. **WiFi modem sleep** — `WIFI_PS_MIN_MODEM` for ~15-20mA idle
13. **Task Watchdog** — Hardware TWDT resets ESP32 if loop() hangs
14. **Manual clean** — Full-stack manual driving: firmware backend (TestMode lifecycle, motor commands, safety polling, stall detection, client timeout), configurable motor settings (brush RPM, vacuum speed, side brush power, stall threshold) with NVS persistence and preset dropdowns in settings UI
15. **Push notifications** — Fire-and-forget HTTP POST to ntfy.sh, adaptive polling (3s active / 30s idle), triggers on cleaning done, error, and return-to-base, configurable topic in settings with test button

**Note for agents**: When a phase is completed, add a one-line summary to the list above.

### Planned / in-progress

**Silent pause/resume/stop** — Eliminate alert tones from SetUIError dance and spot resume.
May vary across robot models/firmware versions.

**OTA via GitHub Releases** — Browser-side only (ESP32 makes no outbound connections).
Browser fetches `api.github.com` releases list (CORS allowed), displays available
versions with release notes in settings. User clicks download link which opens the
`.bin` asset in a new tab (normal navigation, no CORS issue), then uploads via the
existing firmware upload file picker. Two-click flow, zero infrastructure.

**LIDAR and mapping** — GetLDSScan data, 2D occupancy maps on ESP32, SPIFFS persistence.

**Return to base** — Experiment with `Clean Persistent MinCharge 99` during an
active clean to see if the robot forces a recharge dock return. If it works,
add a "Return to Base" button on the dashboard while cleaning is in progress.

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
- `SetMotor` — Full syntax (XV-series base + Botvac extensions):
  ```
  SetMotor [LWheelDist <mm>] [RWheelDist <mm>] [Speed <mm/s>] [Accel <mm/s>]
           [RPM <rpm>] [Brush] [VacuumOn|VacuumOff] [VacuumSpeed <percent>]
           [RWheelDisable|RWheelEnable] [LWheelDisable|LWheelEnable]
           [BrushDisable|BrushEnable]
           [SideBrushEnable|SideBrushDisable] [SideBrushOn|SideBrushOff]
           [SideBrushPower <mW>]
  ```
  **Motor control table:**

  | Motor | Enable/Disable | Activate | Speed Control | Range |
  |-------|---------------|----------|---------------|-------|
  | Left Wheel | `LWheelEnable` / `LWheelDisable` | `LWheelDist <mm>` | `Speed <mm/s>` | 0–300 mm/s |
  | Right Wheel | `RWheelEnable` / `RWheelDisable` | `RWheelDist <mm>` | `Speed <mm/s>` | 0–300 mm/s |
  | Main Brush | `BrushEnable` / `BrushDisable` | `Brush` flag | `RPM <value>` | ~500–10000 RPM |
  | Side Brush (Botvac only) | `SideBrushEnable` / `SideBrushDisable` | `SideBrushOn` / `SideBrushOff` | `SideBrushPower <mW>` | milliwatts |
  | Vacuum | — | `VacuumOn` / `VacuumOff` | `VacuumSpeed <pct>` | 1–100% |

  **Wheel commands:**
  - LWheelDist/RWheelDist: ±10,000 mm (positive = forward, negative = backward)
  - All three params (both distances + speed) required in a single call
  - Accel: 0–300 mm/s², defaults to Speed value if not specified
  - Track width: 248 mm (wheel separation)
  - Nominal cleaning speeds: 200 mm/s (hard floor), 100 mm/s (carpet)
  - When L/R distances differ, firmware applies Speed to the farther wheel and
    proportionally scales the nearer wheel so both finish simultaneously
  - `SetMotor 0 0 0` has a known bug — values of 0 are ignored, robot may coast
    for ~1s. Workaround: send `SetMotor 1 1 1` then `SetMotor 0 0 0`, or use
    `LWheelDisable RWheelDisable` for immediate stop

  **Main brush:**
  - Closed-loop RPM feedback control (8-pole magnetic disk + Hall effect sensor)
  - `Brush` flag is mutually exclusive with wheel and vacuum commands in a single call
  - Firmware-default BrushSpeed values per model:

    | Model | Normal RPM | Eco RPM |
    |-------|:---:|:---:|
    | XV-11/15/21/25/28, Botvac 65/70e/75/80/85 | 1,200 | N/A |
    | Botvac Connected, D3, D5 | 1,200–1,400 | 800 |
    | D6, D7 | 1,400 | 1,100 |
    | Vorwerk VR200 | 1,800 | 1,450 |

  - Practical limits: below ~500 RPM controller is unstable (speed fluctuates);
    above ~2,000 RPM the motor shuts off on XV firmware
  - Higher RPM dramatically increases power draw (1,450 vs 1,200 RPM halved
    battery runtime in testing)

  **Side brush (Botvac D3–D7 only, not XV-series):**
  - Uses open-loop power control in milliwatts (no encoder feedback)
  - Universal default: 1,500 mW across all Neato Botvacs (Vorwerk VR200: 700 mW)
  - Two-layer control: `SideBrushEnable` energizes motor driver, `SideBrushOn` starts spinning
  - Both layers needed: `SideBrushEnable` then `SideBrushOn SideBrushPower <mW>`
  - Draws 28 mA idle current even when nominally "off"
  - XV-series robots report `SideBrushType,1,SIDE_BRUSH_NONE` — no hardware
  - SideBrushType values: `SIDE_BRUSH_NONE` (XV), `SIDE_BRUSH_VORWERK_REV1` (VR100,
    Botvac Connected), `SIDE_BRUSH_PRESENT` (D3/D5/D6/D7)

  **Vacuum:**
  - `VacuumSpeed` must be combined with `VacuumOn` in the same call
  - `SetMotor VacuumSpeed 50` alone fails with "No recognizable parameters"
  - Default when `VacuumOn` used without `VacuumSpeed`: ~90%
  - Firmware-stored VacuumPwr: 52% (older Botvac Basic), 65% (newer Basic/D85),
    80% (Connected/VR200 turbo), 65% (Connected/VR200 eco)
  - Higher vacuum speeds substantially increase current; filter condition also
    affects draw (~0.5A extra with clogged filter)

  **Protocol quirks:**
  - Commands run asynchronously — queries like `GetMotors` work while motors spin
  - Motor power on the 15V bus only available when TestMode is active or robot is cleaning
  - `SideBrushDisable` help text has a firmware bug (says "Enable" but actually disables)
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
`DOCKINGRUNNING`, `DOCKINGPAUSED`, `TESTMODE`, `MANUALCLEANING`

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

## Architecture

Two top-level directories: `firmware/` for ESP32 code, `frontend/` for the web UI.
`platformio.ini` at root for CLion/PlatformIO.

### Firmware modules (`firmware/src/`)

| Module | Role |
|--------|------|
| `main.cpp` | `setup()`/`loop()` entry, wires all managers together, NVS init |
| `config.h` | Global defines, constants, LOG macro, CommandStatus enum |
| `neato_serial` | UART command queue state machine with AsyncCache per sensor type |
| `neato_commands` | Command string constants, response structs, CSV parsers |
| `async_cache.h` | Generic `AsyncCache<T>` template (TTL, dedup, invalidation) |
| `web_server` | REST API routes, serves embedded frontend from PROGMEM |
| `web_assets.h` | Auto-generated embedded frontend assets (gzipped PROGMEM arrays) |
| `wifi_manager` | WiFi config, credentials (NVS), auto-reconnect, modem sleep |
| `firmware_manager` | OTA update lifecycle (Update.h), chip validation, MD5 |
| `settings_manager` | Unified NVS settings, partial JSON updates, schedule storage |
| `scheduler` | 7-day cleaning scheduler, window-based triggering |
| `system_manager` | NTP sync, system health, deferred reboot, heap/task watchdogs |
| `data_logger` | SPIFFS JSON-lines logging, heatshrink compression, log management |
| `manual_clean_manager` | Manual clean lifecycle, safety polling, obstacle blocking |
| `notification_manager` | ntfy.sh push notifications, adaptive polling, state transition detection |
| `json_fields` | Lightweight field-based JSON serialization (no ArduinoJson) |
| `serial_menu` | Interactive serial menu for USB debug console |

**Key patterns:**
- Dependency injection via constructor refs (shared `Preferences&`, `DataLogger&`, manager refs)
- Callback wiring in `main.cpp` (NTP sync, timezone changes, debug check)
- Non-blocking loop: all managers tick in `loop()`, no blocking I/O
- Web server is a thin route layer — delegates to managers, no business logic

**Data logging requirement:** All significant events must be logged via `DataLogger`.
`DataLogger` is injected by reference into managers that need it — no `setLogger()` callbacks.
Use the appropriate typed helper; `logEvent` is private. Current public helpers:

| Method | Type written | Key field | Used by |
|--------|-------------|-----------|---------|
| `logRequest(method, path, status, ms)` | `request` | `path` | web_server |
| `logWifi(event, extra)` | `wifi` | `event` | wifi_manager |
| `logOta(event, extra)` | `ota` | `event` | firmware_manager |
| `logNtp(event, extra)` | `ntp` | `event` | system_manager |
| `logSchedule(category, extra)` | `event` | `category` | scheduler |
| `logNotification(category, message, success)` | `event` | `category` | notification_manager |

When adding a new manager that needs logging, add a typed helper to `DataLogger`
(following the pattern above) rather than exposing `logEvent` or adding a callback.
Log both success and failure outcomes so issues are diagnosable from the log files.

**`event` type entries** (scheduler + notifications) use `category` as the drill-down
discriminator in the frontend. Scheduler categories are prefixed `scheduler_*`;
notification categories are prefixed `notif_*`.

### Frontend (`frontend/src/`)

| Module | Role |
|--------|------|
| `app.tsx` | Root shell: theme, polling, routing, global state |
| `api.ts` | Typed fetch wrappers for all REST endpoints |
| `types.ts` | TypeScript interfaces for API data |
| `style.css` | Single CSS file, CSS variables for theming, responsive breakpoints |
| `views/` | Page components: dashboard, settings, logs, schedule, manual |
| `components/` | Reusable: Icon, BatteryIcon, ErrorBanner, ConfirmDialog, Router |
| `hooks/` | `usePolling`, `useRoute`, `useFetch` |
| `settings/` | Settings submodules: form state, firmware upload, reboot polling |
| `assets/` | SVG robot illustration + icon set |

**Key patterns:**
- Hash-based routing (`#/`, `#/settings`, `#/logs`, `#/schedule`, `#/manual`)
- Polling hooks pause when tab is hidden, resume on return
- Dark theme default, CSS variables for light/dark/auto
- Mobile-first responsive (breakpoints: 400px, 600px, 900px)
- Consumer-facing UI, not a debug tool

### Mock server (`frontend/mock/server.js`)

Stateful Node.js dev server (Vite plugin). Edit `SCENARIO` constant for quick
state switching (e.g. `"ok"`, `"err"`, `"chg"`, fault injection codes).
Reset to `"ok"` before committing.

### Frontend build pipeline

`npm run build` -> Biome lint -> Vite build -> `embed_frontend.js` gzips dist/
files and generates `web_assets.h` -> firmware compiles with assets in PROGMEM.
Frontend is part of the firmware binary — single OTA update covers both.

### Current API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/*` | Embedded frontend assets (gzip) |
| GET | `/api/firmware/version` | Firmware version + chip model |
| POST | `/api/firmware/update?hash=<md5>` | OTA firmware upload |
| GET | `/api/version` | Robot version info |
| GET | `/api/charger` | Battery and charging data |
| GET | `/api/sensors/analog` | Analog sensor readings |
| GET | `/api/sensors/digital` | Digital sensor states |
| GET | `/api/motors` | Motor diagnostic data |
| GET | `/api/state` | Robot UI state |
| GET | `/api/error` | Robot error/alert |
| GET | `/api/accel` | Accelerometer readings |
| GET | `/api/buttons` | Button states |
| GET | `/api/lidar` | LIDAR scan data |
| POST | `/api/clean?action=house\|spot\|stop` | Cleaning control |
| POST | `/api/sound?id=N` | Play sound |
| POST | `/api/testmode?enable=1\|0` | Test mode toggle |
| POST | `/api/lidar/rotate?enable=1\|0` | LIDAR rotation toggle |
| GET | `/api/logs` | List log files |
| GET | `/api/logs/{filename}` | Download log file |
| DELETE | `/api/logs/{filename}` | Delete log file |
| DELETE | `/api/logs` | Delete all logs |
| GET | `/api/system` | System health (heap, uptime, RSSI, SPIFFS, NTP) |
| POST | `/api/system/restart` | Restart device |
| POST | `/api/system/reset` | Factory reset |
| GET | `/api/settings` | All user settings |
| PUT | `/api/settings` | Partial settings update |
| POST | `/api/manual?enable=1\|0` | Manual mode (TestMode + LDS lifecycle) |
| GET | `/api/manual/status` | Manual clean status (safety, motors, stall) |
| POST | `/api/manual/move?left=N&right=N&speed=N` | Manual clean movement (safety-checked) |
| POST | `/api/manual/motors?brush=0\|1&vacuum=0\|1&sideBrush=0\|1` | Motor control |
| POST | `/api/notifications/test?topic=<topic>` | Send test notification via ntfy.sh |

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

Verify firmware changes by building with `pio run -e Debug` and running
`pio check -e Debug` with zero defects.

### Frontend

```bash
cd frontend
npm run dev          # Start Vite dev server with mock API
npm run build        # Lint + build + embed assets into firmware header
npm run check        # Biome lint and format check (no changes)
npm run fix          # Auto-fix safe issues (formatting, import order)
npm run fix:unsafe   # Also apply unsafe fixes (template literals, etc.)
```

Frontend build runs `biome check` before `vite build` — lint/format errors fail the build.

## Dependencies (all pinned)

- `ESP32Async/AsyncTCP @ 3.4.10`
- `ESP32Async/ESPAsyncWebServer @ 3.9.6`
- Vendored: `heatshrink @ 0.4.1` (in `firmware/lib/heatshrink/`)
- Built-in: `Preferences @ 2.0.0`, `WiFi @ 2.0.0`, `SPIFFS @ 2.0.0`, `Update @ 2.0.0`

## Zero-Dependency Policy

The ESP32-C3 has 320KB RAM and 1600KB per OTA slot — every kilobyte counts.

**Firmware rules:**
- No external libraries beyond what is already listed in Dependencies above
- No JSON libraries — use the project's own `json_fields.h/cpp`
- No HTTP client, MQTT, WebSocket libraries
- Use ESP-IDF / Arduino built-in APIs directly

**Frontend rules:**
- No npm runtime dependencies beyond Preact
- No state management, CSS frameworks, routing, or HTTP wrapper libraries
- Dev dependencies (Vite, Biome, TypeScript) are fine

**Exceptions** only when: functionality is non-trivial, no built-in API covers it,
library can be vendored and trimmed, size impact is acceptable.

## Code Style

### Firmware
- **File naming**: `snake_case` (`wifi_manager.cpp`)
- **Header guards**: `#ifndef`/`#define`/`#endif` (`FILENAME_H`)
- **Include order**: Framework `<>` first, then project `""`
- **Naming**: PascalCase classes, camelCase methods/members, UPPER_SNAKE macros/enums
- **Formatting**: 4-space indent, K&R braces, 120-col width (enforced by `.clang-format`)
- **Types**: Arduino `String` (not `std::string`), `std::function`/`std::vector` from STL
- **Comments**: `//` only, no Doxygen blocks

### Frontend
- **Formatting**: 4-space indent, double quotes, semicolons, 120-col (enforced by Biome)
- **Types**: Always use named `interface`/`type`, never inline object type literals

## Error Handling

- No exceptions (Arduino constraint)
- Return-value based (`bool` for success/failure)
- Early returns for preconditions
- Bounds checking before array access
- `ESP.restart()` for critical failures

## Logging

```cpp
#define LOG(tag, fmt, ...) Serial.printf("[%s] " fmt "\n", tag, ##__VA_ARGS__)
```
Tags: `"BOOT"`, `"WIFI"`, `"OTA"`, `"SERIAL"`, etc. All user-facing serial output
goes through `SerialMenu` helper methods.

## Class Design Patterns

- **Dependency injection**: Constructor refs (`WiFiManager(Preferences&)`)
- **Composition over inheritance**
- **Callbacks via lambdas**: `std::function` with `[this]` capture
- **State machines**: Command queue, serial menu input, UI state tracking

## Hardware Notes

- **Board**: ESP32-C3-DevKitM-1 (RISC-V single core, 160MHz, 320KB RAM, 4MB flash)
- **USB**: Native USB CDC (`ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`)
- **Reset button**: GPIO9 (BOOT), active LOW, hold 5s to factory reset
- **Flash layout**: Dual OTA slots (1600KB each), 768KB SPIFFS, 20KB NVS
- **NVS**: Single shared `"neato"` namespace, opened once, passed by reference
