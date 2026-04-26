export interface VersionData {
    /** Robot model name (e.g. "Botvac D7") */
    modelName: string;
    /** Robot serial number */
    serialNumber: string;
    /** Robot firmware version, format "Major.Minor.Build" */
    softwareVersion: string;
    /** LIDAR firmware version */
    ldsVersion: string;
    /** LIDAR serial number */
    ldsSerial: string;
    /** Main board hardware version */
    mainBoardVersion: string;
}

export interface MotorData {
    /** Main brush rotation speed in RPM */
    brushRPM: number;
    /** Main brush current draw in mA */
    brushMA: number;
    /** Vacuum motor speed in RPM */
    vacuumRPM: number;
    /** Vacuum motor current draw in mA */
    vacuumMA: number;
    /** Left wheel rotation speed in RPM */
    leftWheelRPM: number;
    /** Left wheel load percentage */
    leftWheelLoad: number;
    /** Left wheel position in millimeters since boot */
    leftWheelPositionMM: number;
    /** Left wheel speed in mm/s */
    leftWheelSpeed: number;
    /** Right wheel rotation speed in RPM */
    rightWheelRPM: number;
    /** Right wheel load percentage */
    rightWheelLoad: number;
    /** Right wheel position in millimeters since boot */
    rightWheelPositionMM: number;
    /** Right wheel speed in mm/s */
    rightWheelSpeed: number;
    /** Side brush current draw in mA */
    sideBrushMA: number;
    /** Laser turret rotation speed in RPM */
    laserRPM: number;
}

export interface StateData {
    /** UI state machine value, e.g. "UIMGR_STATE_STANDBY" */
    uiState: string;
    /** Robot state machine value, e.g. "ST_C_Standby" */
    robotState: string;
}

export interface ChargerData {
    /** Battery charge percentage (0-100, -1 = unknown) */
    fuelPercent: number;
    /** Battery temperature exceeds safe limits */
    batteryOverTemp: boolean;
    /** Charger currently delivering current */
    chargingActive: boolean;
    /** Charging circuit enabled (independent of active flow) */
    chargingEnabled: boolean;
    /** Fuel gauge reading is trusted */
    confidOnFuel: boolean;
    /** Battery has dropped into reserve range */
    onReservedFuel: boolean;
    /** Battery considered empty (robot will not start) */
    emptyFuel: boolean;
    /** Battery hardware fault detected */
    batteryFailure: boolean;
    /** External power supply (dock or barrel jack) connected */
    extPwrPresent: boolean;
    /** Battery voltage in volts */
    vBattV: number;
    /** External supply voltage in volts */
    vExtV: number;
    /** Cumulative mAh delivered into the battery */
    chargerMAH: number;
    /** Cumulative mAh discharged from the battery */
    dischargeMAH: number;
}

export interface ErrorData {
    /** True if the robot is currently reporting an error or warning */
    hasError: boolean;
    /** "error" for codes 243+, "warning" for codes 201-242 */
    kind: "error" | "warning";
    /** Numeric error/warning code (200 = no error) */
    errorCode: number;
    /** Full raw response from the robot (for diagnostics) */
    errorMessage: string;
    /** Human-readable message suitable for UI and notifications */
    displayMessage: string;
}

export interface SystemData {
    /** Free heap memory in bytes */
    heap: number;
    /** Total heap memory in bytes */
    heapTotal: number;
    /** Milliseconds since boot */
    uptime: number;
    /** WiFi signal strength in dBm (negative, closer to 0 = stronger) */
    rssi: number;
    /** SPIFFS bytes used */
    fsUsed: number;
    /** SPIFFS total capacity in bytes */
    fsTotal: number;
    /** NTP has successfully synced at least once */
    ntpSynced: boolean;
    /** Current Unix epoch time in seconds (UTC) */
    time: number;
    /** Time source: "ntp", "robot", or "boot" */
    timeSource: string;
    /** Configured IANA timezone (e.g. "America/New_York") */
    tz: string;
    /** DST-aware local time, e.g. "Sat 17:45:01" */
    localTime: string;
    /** True when daylight saving time is active */
    isDst: boolean;
}

// Per-day schedule fields (Mon=0..Sun=6), two slots per day.
// Slot 0 (primary):   sched{0-6}Hour, sched{0-6}Min, sched{0-6}On
// Slot 1 (secondary): sched{0-6}Slot1Hour, sched{0-6}Slot1Min, sched{0-6}Slot1On
export interface SettingsData {
    /** IANA timezone identifier (e.g. "America/New_York") */
    tz: string;
    /** 0=off, 1=info, 2=debug */
    logLevel: number;
    /** When on, logs go to UDP syslog instead of flash */
    syslogEnabled: boolean;
    /** IPv4 address of syslog receiver */
    syslogIp: string;
    /** WiFi TX power in 0.25 dBm units (e.g. 34 = 8.5 dBm) */
    wifiTxPower: number;
    /** GPIO pin used for UART TX to the robot */
    uartTxPin: number;
    /** GPIO pin used for UART RX from the robot */
    uartRxPin: number;
    /** Read-only - max valid GPIO for this chip (21 for C3, 39 for ESP32) */
    maxGpioPin: number;
    /** mDNS hostname (e.g. "openneato") */
    hostname: string;
    /** Navigation mode for house cleaning: "Normal", "Gentle", "Deep", "Quick" */
    navMode: string;
    /** Wheel load % for stall detection (30-80) */
    stallThreshold: number;
    /** Main brush RPM (500-1600) */
    brushRpm: number;
    /** Vacuum speed % (40-100) */
    vacuumSpeed: number;
    /** Side brush power in mW (500-1500) */
    sideBrushPower: number;
    /** ntfy.sh topic for push notifications (empty = disabled) */
    ntfyTopic: string;
    /** Global switch - must be on for any notification to fire */
    ntfyEnabled: boolean;
    /** Notify when cleaning completes */
    ntfyOnDone: boolean;
    /** Notify on robot error (UI_ERROR_*, code 243+) */
    ntfyOnError: boolean;
    /** Notify on robot alert (UI_ALERT_*, code 201-242) */
    ntfyOnAlert: boolean;
    /** Notify when robot returns to base */
    ntfyOnDocking: boolean;
    /** Master switch for the weekly cleaning schedule */
    scheduleEnabled: boolean;
    // Slot 0 (primary)
    sched0Hour: number;
    sched0Min: number;
    sched0On: boolean;
    sched1Hour: number;
    sched1Min: number;
    sched1On: boolean;
    sched2Hour: number;
    sched2Min: number;
    sched2On: boolean;
    sched3Hour: number;
    sched3Min: number;
    sched3On: boolean;
    sched4Hour: number;
    sched4Min: number;
    sched4On: boolean;
    sched5Hour: number;
    sched5Min: number;
    sched5On: boolean;
    sched6Hour: number;
    sched6Min: number;
    sched6On: boolean;
    // Slot 1 (secondary)
    sched0Slot1Hour: number;
    sched0Slot1Min: number;
    sched0Slot1On: boolean;
    sched1Slot1Hour: number;
    sched1Slot1Min: number;
    sched1Slot1On: boolean;
    sched2Slot1Hour: number;
    sched2Slot1Min: number;
    sched2Slot1On: boolean;
    sched3Slot1Hour: number;
    sched3Slot1Min: number;
    sched3Slot1On: boolean;
    sched4Slot1Hour: number;
    sched4Slot1Min: number;
    sched4Slot1On: boolean;
    sched5Slot1Hour: number;
    sched5Slot1Min: number;
    sched5Slot1On: boolean;
    sched6Slot1Hour: number;
    sched6Slot1Min: number;
    sched6Slot1On: boolean;
}

export interface UserSettingsData {
    /** Play a click sound on button presses */
    buttonClick: boolean;
    /** Play melodies (start, finish, etc.) */
    melodies: boolean;
    /** Play warning chimes */
    warnings: boolean;
    /** Reduced power cleaning (longer runtime, lower suction) */
    ecoMode: boolean;
    /** Maximum power cleaning */
    intenseClean: boolean;
    /** Stop and warn when dirt bin is full */
    binFullDetect: boolean;
    /** Enable wall following along walls and edges */
    wallEnable: boolean;
    /** Robot WiFi radio enabled (separate from bridge WiFi) */
    wifi: boolean;
    /** Dim status LEDs at night */
    stealthLed: boolean;
    /** Filter change reminder interval in seconds */
    filterChange: number;
    /** Brush change reminder interval in seconds */
    brushChange: number;
    /** Dirt bin reminder interval in minutes */
    dirtBin: number;
}

export interface LidarPoint {
    /** Bearing in degrees (0-359, 0 = robot front) */
    angle: number;
    /** Distance to target in millimeters (0 if invalid) */
    dist: number;
    /** Return signal strength (0-255) */
    intensity: number;
    /** Per-point error code (0 = valid) */
    error: number;
}

export interface LidarScan {
    /** LIDAR turret rotation speed in Hz */
    rotationSpeed: number;
    /** Count of points with error == 0 */
    validPoints: number;
    /** Always 360 entries indexed by angle */
    points: LidarPoint[];
}

export interface FirmwareVersion {
    /** Bridge firmware semantic version */
    version: string;
    /** ESP32 chip model (e.g. "ESP32-C3") */
    chip: string;
    /** Robot model name (e.g. "Botvac D7", empty until identified) */
    model: string;
    /** mDNS hostname (e.g. "openneato") */
    hostname: string;
    /** True if the connected robot model is officially supported */
    supported: boolean;
    /** True while the bridge is still probing the robot model */
    identifying: boolean;
}

export interface ManualStatus {
    /** Manual mode currently engaged */
    active: boolean;
    /** Main brush motor enabled */
    brush: boolean;
    /** Vacuum motor enabled */
    vacuum: boolean;
    /** Side brush motor enabled */
    sideBrush: boolean;
    /** Robot wheel-drop sensor reports the robot is off the ground */
    lifted: boolean;
    /** Front-left bumper contacted */
    bumperFrontLeft: boolean;
    /** Front-right bumper contacted */
    bumperFrontRight: boolean;
    /** Left side bumper contacted */
    bumperSideLeft: boolean;
    /** Right side bumper contacted */
    bumperSideRight: boolean;
    /** Front wheel stall detected */
    stallFront: boolean;
    /** Rear wheel stall detected */
    stallRear: boolean;
}

export interface LogFileInfo {
    /** File name as stored on flash (may include .hs compression suffix) */
    name: string;
    /** File size in bytes */
    size: number;
    /** True if stored with heatshrink compression */
    compressed: boolean;
}

export interface MapSession {
    /** Always "session" - identifies the record type */
    type: "session";
    /** Cleaning mode: "House", "Spot", or "Manual" */
    mode: string;
    /** Unix epoch seconds when the session started */
    time: number;
    /** Battery percentage at session start */
    battery: number;
}

export interface MapSummary {
    /** Always "summary" - identifies the record type */
    type: "summary";
    /** Unix epoch seconds when the session ended */
    time: number;
    /** Session duration in seconds */
    duration: number;
    /** Cleaning mode: "House", "Spot", or "Manual" */
    mode: string;
    /** Number of times the robot returned to base to recharge */
    recharges: number;
    /** Number of pose snapshots captured */
    snapshots: number;
    /** Total distance traveled in meters */
    distanceTraveled: number;
    /** Maximum distance from origin in meters */
    maxDistFromOrigin: number;
    /** Total rotation in degrees */
    totalRotation: number;
    /** Estimated area covered in square meters */
    areaCovered: number;
    /** Number of errors encountered during cleaning */
    errorsDuringClean: number;
    /** Battery percentage at session start */
    batteryStart?: number;
    /** Battery percentage at session end */
    batteryEnd?: number;
}

export interface MapPathPoint {
    x: number;
    y: number;
    t: number;
    ts: number;
}

export interface MapBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface MapRechargePoint {
    x: number;
    y: number;
    // Session-relative timestamp when the robot returned to base to charge,
    // derived from the last pose snapshot before collection paused.
    ts: number;
    // Session-relative timestamp when cleaning resumed after the charge —
    // taken from the first pose snapshot written once collection restarted.
    // Falls back to `ts` when the session ended before resuming.
    endTs: number;
}

// Coverage cell with the session-relative timestamp (seconds) at which the
// cell was first stamped. Used by the motion player to reveal coverage
// progressively during playback.
export type MapCoverageCell = [cx: number, cy: number, ts: number];

export interface MapTransform {
    panX: number;
    panY: number;
    zoom: number;
}

export interface MapData {
    session: MapSession | null;
    summary: MapSummary | null;
    path: MapPathPoint[];
    coverage: MapCoverageCell[];
    recharges: MapRechargePoint[];
    bounds: MapBounds | null;
    cellSize: number;
}

export interface HistoryFileInfo {
    /** File name as stored on flash (may include .hs compression suffix) */
    name: string;
    /** File size in bytes */
    size: number;
    /** True if stored with heatshrink compression */
    compressed: boolean;
    /** True if this session is currently being recorded */
    recording: boolean;
    /** Session metadata, or null if not yet written */
    session: MapSession | null;
    /** Session summary, or null if cleaning has not finished */
    summary: MapSummary | null;
}
