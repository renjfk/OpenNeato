# Neato Serial Protocol Reference

Complete reference for the Neato Botvac serial command protocol used by OpenNeato.
This document covers supported robots, command syntax, response formats, state
machines, and protocol quirks discovered through experiments and various online sources.

## Supported Robots

D3, D4, D5, D6, D7 confirmed. D70-D85 likely compatible.
D8/D9/D10 NOT supported (different board, password-locked serial).

## Robot Debug Port Pinout (D3/D5/D7)

```
RX | 3.3V | TX | GND
```
Connect: Robot RX -> ESP TX, Robot TX -> ESP RX, Robot 3.3V -> ESP VCC,
Robot GND -> ESP GND. The robot provides 3.3V to power the ESP.

## Protocol Basics

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

## Polling Intervals (from reference project)

- `GetErr` + `GetState`: every 2 seconds
- `GetCharger`: every 2 minutes
- Inter-command delay: 50ms between sequential commands
- TestMode -> SetSystemMode delay: 100ms

## Known Limitations

- LIDAR scan responses are large; line-by-line reading recommended
- Serial commands must be queued (no overlapping)
- In TestMode, GetState always returns `UIMGR_STATE_TESTMODE`
- Return-to-dock uses `SetEvent UIMGR_EVENT_SMARTAPP_SEND_TO_BASE` (requires SKey)
- Commands cannot have leading spaces
- Communication parameters (Baud, start/stop bits, parity) are unimportant for USB
  (they apply only to real COM ports, not USB CDC)

## Command Reference

### No TestMode required

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
- `GetUserSettings` — Get all user-configurable settings (sound, cleaning, power saving, maintenance)
- `SetUserSettings [Key ON|OFF|Value]` — Set user settings
  - `ButtonClick ON/OFF` — Button press sounds
  - `Melodies ON/OFF` — Startup/shutdown melodies
  - `Warnings ON/OFF` — Warning beeps
  - `EcoMode ON/OFF` — Eco cleaning mode (lower brush/vacuum power)
  - `IntenseClean ON/OFF` — Intense clean (double-pass)
  - `BinFullDetect ON/OFF` — Dust bin full detection
  - `WallEnable ON/OFF` — Wall following (robot traces along walls and edges during cleaning)
  - `WiFi ON/OFF` — Robot's own WiFi radio (unused with OpenNeato)
  - `StealthLED ON/OFF` — Standby LEDs (ON = hidden, OFF = visible)
  - `FilterChange <seconds>` — Filter change alert interval
  - `BrushChange <seconds>` — Brush change alert interval
  - `DirtBin <minutes>` — Dirt bin alert reminder interval
  - `Reset` — Reset all user settings to factory defaults
  - Note: `GetUserSettings` response uses different label names than `SetUserSettings` parameters
    (e.g. "ClickSounds" vs "ButtonClick", "Melody Sounds" vs "Melodies", "Wall Enable" vs "WallEnable")
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
  - All: YYYY-MM-DD--hh:mm:ss (optional, sets full date/time on RTC instead of scheduler clock)
  - **D7 4.6.0 quirk:** The Day/Hour/Min/Sec parameters have no effect - the scheduler clock
    (`GetTime`) is stuck at `Sunday 0:00:00` and cannot be written. Use `SetTime All` instead,
    which updates the real RTC visible via `GetVersion` `Time Local`/`Time UTC` fields.
- `SetNTPTime` — Instruct the robot to sync its clock from NTP servers (D7 only, requires robot WiFi)
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

### TestMode required

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

### Hidden commands (undocumented, found via reverse engineering)

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
  - `MinCharge <percent>` — Min charge to trigger recharge (range 5-100, -1 rejected; default 50%; sticky — persists across cleans)
  - `NavTest` — Navigation test mode
  - `CleaningEnable` — Enable brush and vacuum during cleaning
  - `CleaningDisable` — Disable brush and vacuum during cleaning
  - `IEC1mTest` — Run IEC cleaning test
  - `MaxModeEnable` — Enable max cleaning mode
  - `MaxModeDisable` — Disable max cleaning mode
- `SetNavigationMode [Normal|Gentle|Deep|Quick]` — Set navigation mode for house cleaning
  - `Normal` — Default navigation behavior
  - `Gentle` — Extra care: robot avoids pushing objects taller than itself (detected via LIDAR)
  - `Deep` — Robot drives deep into corners, backs up, and cleans corners in a curve
  - `Quick` — Faster, less thorough navigation
  - Mode resets to Normal on robot restart (not persisted by robot firmware)
  - Only affects house cleaning, not spot cleaning
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

## Response Formats

**GetUserSettings** — CSV: `Label, Value` (note space after comma)
```
Language, EL_NONE
ClickSounds, OFF
LED, ON
Wall Enable, ON
Eco Mode, ON
IntenseClean, OFF
WiFi, ON
Melody Sounds, OFF
Warning Sounds, ON
Bin Full Detect, ON
Filter Change Time (seconds), 43200
Brush Change Time (seconds), 259200
Dirt Bin Alert Reminder Interval (minutes), 90
Current Dirt Bin Runtime is: 5857220
Number of Cleanings where Dust Bin was Full is: 1
Schedule is Disabled
```
Note: Labels differ from `SetUserSettings` parameter names (e.g. "ClickSounds" in
response vs "ButtonClick" in set command, "LED" vs "StealthLED"). LED=ON means
LEDs are visible (not stealth); StealthLED=ON means LEDs are hidden (stealth mode).

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
D7 (and possibly D6) also include time fields:
```
Time Local,Sat Apr 11 22:26:13 2026
Time UTC,Sat Apr 11 19:26:13 2026
```
These reflect the robot's real RTC and are the reliable source for robot clock readback.

**GetWarranty** — Three hex values, convert with `strtoul(hex, nullptr, 16)`

**GetErr [Clear]** — Returns error message if present, otherwise no message
- Error code 200 (`UI_ALERT_INVALID`) = no error (normal state)
- `Clear` flag dismisses the reported error
- **Complete error/alert code list** (from `SetUIError list`, firmware 4.5.3):
  - **Legacy hardware errors (1-23):**
    - 1: WDT, 2: SSEG LED, 3: BTN LED, 4: BACK LED, 5: FLASH
    - 10: BattNominal, 11: BattOverVolt, 12: BattUnderVolt, 13: BattOverTemp
    - 14: BattShutdownTemp, 15: BattUnderCurrent, 16: BattTimeout, 17: BattTempPeak
    - 18: BattFastCapacity, 19: BattMACapacity, 20: BattOnReserve, 21: BattEmpty
    - 22: BattMismatch, 23: BattLithiumAdapterFailure
  - **Alerts (200-242):**
    - 200: `UI_ALERT_INVALID` (= no error, normal state)
    - 201: `UI_ALERT_RETURN_TO_BASE`
    - 202: `UI_ALERT_RETURN_TO_BASE_PWR`
    - 203: `UI_ALERT_RETURN_TO_START`
    - 204: `UI_ALERT_RETURN_TO_CHARGE`
    - 205: `UI_ALERT_DUST_BIN_FULL`
    - 206: `UI_ALERT_BUSY_CHARGING`
    - 207: `UI_ALERT_OLD_ERROR`
    - 208: `UI_ALERT_RECOVERING_LOCATION`
    - 209: `UI_ALERT_INFO_THANK_YOU`
    - 210: `UI_ALERT_LOG_READ_FAIL`
    - 211: `UI_ALERT_LOG_WRITE_FAIL`
    - 212: `UI_ALERT_USB_DISCONNECTED`
    - 213: `UI_ALERT_SWUPDATE_SUCCESS`
    - 214: `UI_ALERT_SWUPDATE_FAIL`
    - 215: `UI_ALERT_LOG_WRITE_SUCCESS`
    - 216: `UI_ALERT_TIME_NOT_SET`
    - 217: `UI_ALERT_TIME_SET`
    - 218: `UI_ALERT_TIMER_SET`
    - 219: `UI_ALERT_TIMER_REMOVED`
    - 220: `UI_ALERT_ENABLE_TIMER`
    - 221: `UI_ALERT_CHARGING_POWER`
    - 222: `UI_ALERT_CHARGING_BASE`
    - 223: `UI_ALERT_BATTERY_ChargeBaseCommErr`
    - 224: `UI_ALERT_CONNECT_CHRG_CABLE`
    - 225: `UI_ALERT_WAIT_FOR_POWER_SWITCH_DETECT`
    - 226: `UI_ALERT_LINKEDAPP`
    - 227: `UI_ALERT_ORIGIN_UNCLEAN`
    - 228: `UI_ALERT_LOGUPLOAD_FAIL`
    - 229: `UI_ALERT_BRUSH_CHANGE`
    - 230: `UI_ALERT_FILTER_CHANGE`
    - 231: `UI_ALERT_PERSISTENT_RELOCALIZATION_FAIL`
    - 232: `UI_ALERT_TRAINING_MULTIPLE_FLOORPLANS_VALID`
    - 233: `UI_ALERT_MULTIPLE_FLOORPLANS_VALID`
    - 234: `UI_ALERT_PM_LOAD_FAIL`
    - 235: `UI_ALERT_PM_SETUP_FAIL`
    - 236: `UI_ALERT_ACQUIRING_PERSISTENT_MAP_IDS`
    - 237: `UI_ALERT_CREATING_AND_UPLOADING_MAP`
    - 238: `UI_ALERT_PM_START_CLEAN_FAIL`
    - 239: `UI_ALERT_NAV_FLOORPLAN_NOT_CREATED`
    - 240: `UI_ALERT_NAV_FLOORPLAN_ZONE_UNREACHABLE`
    - 241: `UI_ALERT_NAV_FLOORPLAN_ZONE_WRONG_FLOOR`
    - 242: `UI_ALERT_TRAINING_MAP_SPARSE`
  - **Errors (243-316):**
    - 243: `UI_ERROR_CHECK_BATTERY_SWITCH`
    - 244: `UI_ERROR_DISCONNECT_CHRG_CABLE`
    - 245: `UI_ERROR_DISCONNECT_USB_CABLE`
    - 246: `UI_ERROR_SCHED_OFF`
    - 247: `UI_ERROR_TIME_NOT_SET`
    - 248: `UI_ERROR_DUST_BIN_EMPTIED`
    - 249: `UI_ERROR_DUST_BIN_MISSING`
    - 250: `UI_ERROR_DUST_BIN_FULL`
    - 251: `UI_ERROR_BATTERY_OVERTEMP`
    - 252: `UI_ERROR_UNABLE_TO_RETURN_TO_BASE`
    - 253: `UI_ERROR_QA_FAIL`
    - 254: `UI_ERROR_BUMPER_STUCK`
    - 255: `UI_ERROR_PICKED_UP`
    - 256: `UI_ERROR_RECONNECT_FAILED`
    - 257: `UI_ERROR_LWHEEL_STUCK`
    - 258: `UI_ERROR_RWHEEL_STUCK`
    - 259: `UI_ERROR_LDS_JAMMED`
    - 260: `UI_ERROR_LDS_DISCONNECTED`
    - 261: `UI_ERROR_LDS_MISSED_PACKETS`
    - 262: `UI_ERROR_LDS_BAD_PACKETS`
    - 263: `UI_ERROR_LDS_LASER_OVER_POWER`
    - 264: `UI_ERROR_LDS_LASER_UNDER_POWER`
    - 265: `UI_ERROR_BRUSH_STUCK`
    - 266: `UI_ERROR_BRUSH_OVERLOAD`
    - 267: `UI_ERROR_VACUUM_STUCK`
    - 268: `UI_ERROR_VACUUM_SLIP`
    - 269: `UI_ERROR_BATTERY_CRITICAL`
    - 270: `UI_ERROR_BATTERY_OverVolt`
    - 271: `UI_ERROR_BATTERY_UnderVolt`
    - 272: `UI_ERROR_BATTERY_UnderCurrent`
    - 273: `UI_ERROR_BATTERY_Mismatch`
    - 274: `UI_ERROR_BATTERY_LithiumAdapterFailure`
    - 275: `UI_ERROR_BATTERY_UnderTemp`
    - 276: `UI_ERROR_BATTERY_Unplugged`
    - 277: `UI_ERROR_BATTERY_NoThermistor`
    - 278: `UI_ERROR_BATTERY_BattUnderVoltLithiumSafety`
    - 279: `UI_ERROR_BATTERY_InvalidSensor`
    - 280: `UI_ERROR_BATTERY_PermanentError`
    - 281: `UI_ERROR_BATTERY_Fault`
    - 282: `UI_ERROR_NAVIGATION_UndockingFailed`
    - 283: `UI_ERROR_NAVIGATION_Falling`
    - 284: `UI_ERROR_NAVIGATION_PinkyCommsFail`
    - 285: `UI_ERROR_NAVIGATION_NoMotionCommands`
    - 286: `UI_ERROR_NAVIGATION_BackDrop_LeftBump`
    - 287: `UI_ERROR_NAVIGATION_BackDrop_FrontBump`
    - 288: `UI_ERROR_NAVIGATION_BackDrop_WheelExtended`
    - 289: `UI_ERROR_NAVIGATION_RightDrop_LeftBump`
    - 290: `UI_ERROR_NAVIGATION_NoExitsToGo`
    - 291: `UI_ERROR_NAVIGATION_PathProblems_ReturningHome`
    - 292: `UI_ERROR_NAVIGATION_NoProgress`
    - 293: `UI_ERROR_NAVIGATION_BadMagSensor`
    - 294: `UI_ERROR_NAVIGATION_Origin_Unclean`
    - 295: `UI_ERROR_NAVIGATION_PathBlocked_GoingToZone`
    - 296: `UI_ERROR_SHUTDOWN`
    - 297: `UI_ERROR_DFLT_APP`
    - 298: `UI_ERROR_CORRUPT_SCB`
    - 299: `UI_ERROR_SCB_FLASH_READ`
    - 300: `UI_ERROR_SCB_SIGNATURE`
    - 301: `UI_ERROR_SCB_LENGTH_MISMATCH`
    - 302: `UI_ERROR_SCB_CHECKSUM`
    - 303: `UI_ERROR_SCB_VALIDATION`
    - 304: `UI_ERROR_SCB_INTERFACE`
    - 305: `UI_ERROR_HARDWARE_FAILURE`
    - 306: `UI_ERROR_DECK_DEBRIS`
    - 307: `UI_ERROR_RDROP_STUCK`
    - 308: `UI_ERROR_LDROP_STUCK`
    - 309: `UI_ERROR_UNABLE_TO_SEE`
    - 310: `UI_ERROR_TILTED_ON_CLEANING_STARTUP`
    - 311: `UI_ERROR_SWUPDATE_FILEMISSING`
    - 312: `UI_ERROR_FLIGHT_SENSOR_DISCONNECTED`
    - 313: `UI_ERROR_WIFIPSWDORROUTERISSUE`
    - 314: `UI_ERROR_CONNECTINGTOSERVER`
    - 315: `UI_ERROR_TIMEDOUTCONNECTROUTER`
    - 316: `LAST_UI_ALERT`
  - **Note:** Codes 200-242 are alerts (informational), 243+ are errors (action required).
    Code numbers shifted between firmware 3.2.0 and 4.5.3 — always match by name, not number.

## UI States (UIMGR_STATE_*)

Complete list from firmware 3.2.0 (unchanged in 4.5.3):
- `UIMGR_STATE_POWERUP`
- `UIMGR_STATE_IDLE`
- `UIMGR_STATE_USERMENU`
- `UIMGR_STATE_STANDBY`
- `UIMGR_STATE_STARTSPOTCLEANING`
- `UIMGR_STATE_SPOTCLEANINGRUNNING`
- `UIMGR_STATE_STARTHOUSECLEANING`
- `UIMGR_STATE_HOUSECLEANINGRUNNING`
- `UIMGR_STATE_HOUSECLEANINGPAUSED`
- `UIMGR_STATE_SPOTCLEANINGPAUSED`
- `UIMGR_STATE_DOCKINGRUNNING`
- `UIMGR_STATE_DOCKINGPAUSED`
- `UIMGR_STATE_CLEANINGTESTRUNNING`
- `UIMGR_STATE_CLEANINGSUSPENDED`
- `UIMGR_STATE_CLEANINGSUSPENDEDMENU`
- `UIMGR_STATE_TESTMENU`
- `UIMGR_STATE_MANUALDRIVING`
- `UIMGR_STATE_TESTMODE`
- `UIMGR_STATE_INITIALSETUPMENU`
- `UIMGR_STATE_SMARTDEVICECONTROL`
- `UIMGR_STATE_USB_LOGCOPY`
- `UIMGR_STATE_SWUPGRADE`
- `UIMGR_STATE_OTA_LOGUPLOAD`
- `UIMGR_STATE_INVALID`

## Robot States (ST_*)

Reported in `GetState` second line (`Current Robot State is:`). Available in
firmware 4.5.3+ (not present in 3.2.0):
- `ST_A_Init` — Initialization
- `ST_C_Standby` — Standby/idle
- `ST_F_Cleaning` — House cleaning (top-level)
- `ST_F1_Undocking` — Undocking for house clean
- `ST_F2_PartialMapManagement` — Partial map management
- `ST_F21_Exploring` — Exploring during house clean
- `ST_F3_InteriorCleaning` — Interior cleaning in progress
- `ST_F4_BoundaryFollowing` — Following boundaries
- `ST_F5_PickedUp` — Robot picked up during house clean
- `ST_F6_CleaningErrRecovery` — Error recovery during house clean
- `ST_F7_CleaningError` — Cleaning error state
- `ST_G_SpotCleaning` — Spot cleaning (top-level)
- `ST_G1_Undocking` — Undocking for spot clean
- `ST_G2_PartialMapManagement` — Partial map management (spot)
- `ST_G21_Exploring` — Exploring during spot clean
- `ST_G3_InteriorCleaning` — Interior cleaning (spot)
- `ST_G4_BoundaryFollowing` — Following boundaries (spot)
- `ST_G5_PickedUp` — Robot picked up during spot clean
- `ST_G6_CleaningErrRecovery` — Error recovery during spot clean
- `ST_G7_CleaningError` — Cleaning error (spot)
- `ST_K_Critical` — Critical error
- `ST_L_Safety` — Safety stop
- `ST_M_Charging` — Charging (top-level)
- `ST_M1_Charging_Cleaning` — Charging mid-clean (recharge-and-resume)
- `ST_M2_Charging_StdBy` — Charging in standby
- `ST_P_PopState` — Pop state (internal transition)
- `ST_T_Test` — Test mode (top-level)
- `ST_T1_TestObstacleMonitor` — Obstacle monitor test
- `ST_T3_ProxFollowTest` — Proximity follow test
- `ST_T4_TestMotionExecutor` — Motion executor test
- `ST_T6_BoundFollowOnly` — Boundary follow test
- `ST_T7_TestDocking` — Docking test
- `ST_T8_TestService` — Service test
- `ST_X_ManNav` — Manual navigation

## SetEvent Cleaning Control (D3-D7)

All cleaning control uses authenticated `SetEvent` commands — the same protocol
Neato's cloud app used. Format: `SetEvent event <EVENT> SKey <key>`

The SKey is computed at boot from the robot's serial number (MAC portion) via
RC4 with a fixed seed. Implementation: `computeSKey()` in `neato_commands.cpp`.

**Event table:**

| Action | Event |
|--------|-------|
| Start house | `UIMGR_EVENT_SMARTAPP_START_HOUSE_CLEANING` |
| Start spot | `UIMGR_EVENT_SMARTAPP_START_SPOT_CLEANING` |
| Pause | `UIMGR_EVENT_SMARTAPP_PAUSE_CLEANING` |
| Resume | `UIMGR_EVENT_SMARTAPP_RESUME_CLEANING` |
| Stop | `UIMGR_EVENT_SMARTAPP_STOP_CLEANING` |
| Return to base | `UIMGR_EVENT_SMARTAPP_SEND_TO_BASE` |

**Why not `Clean Stop`?** On D7 firmware 4.6.0, `Clean Stop` destroys
localization — position resets to 0,0,0 and the robot starts a new exploration
on resume. Bare `Clean` for resume also resets position. `SetEvent` correctly
transitions the UI state machine and preserves map/localization for true
in-place pause/resume.

## Additional Commands from XV-11 Manual

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
**D7 4.6.0 quirk:** Always returns `Sunday 0:00:00` regardless of `SetTime`. Use `GetVersion`
`Time UTC` field for reliable robot clock readback instead.

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
