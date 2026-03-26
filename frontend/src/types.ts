export interface StateData {
    uiState: string;
    robotState: string;
}

export interface ChargerData {
    fuelPercent: number;
    batteryOverTemp: boolean;
    chargingActive: boolean;
    chargingEnabled: boolean;
    confidOnFuel: boolean;
    onReservedFuel: boolean;
    emptyFuel: boolean;
    batteryFailure: boolean;
    extPwrPresent: boolean;
    vBattV: number;
    vExtV: number;
    chargerMAH: number;
    dischargeMAH: number;
}

export interface ErrorData {
    hasError: boolean;
    kind: "error" | "warning";
    errorCode: number;
    errorMessage: string;
    displayMessage: string;
}

export interface SystemData {
    heap: number;
    heapTotal: number;
    uptime: number;
    rssi: number;
    fsUsed: number;
    fsTotal: number;
    ntpSynced: boolean;
    time: number;
    timeSource: string;
    tz: string;
}

// Per-day schedule fields: sched{0-6}Hour, sched{0-6}Min, sched{0-6}On (Mon=0..Sun=6)
export interface SettingsData {
    tz: string;
    debug: boolean;
    wifiTxPower: number; // 0.25 dBm units (e.g. 34 = 8.5 dBm)
    uartTxPin: number;
    uartRxPin: number;
    maxGpioPin: number; // Read-only — max valid GPIO for this chip (21 for C3, 39 for ESP32)
    hostname: string;
    stallThreshold: number; // Wheel load % for stall detection (30-80)
    brushRpm: number; // Main brush RPM (500-1600)
    vacuumSpeed: number; // Vacuum speed % (40-100)
    sideBrushPower: number; // Side brush power in mW (500-1500)
    ntfyTopic: string; // ntfy.sh topic for push notifications (empty = disabled)
    ntfyEnabled: boolean; // Global switch — must be on for any notification to fire
    ntfyOnDone: boolean; // Notify when cleaning completes
    ntfyOnError: boolean; // Notify on robot error (UI_ERROR_*, code 243+)
    ntfyOnAlert: boolean; // Notify on robot alert (UI_ALERT_*, code 201-242)
    ntfyOnDocking: boolean; // Notify when robot returns to base
    scheduleEnabled: boolean;
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
}

export interface UserSettingsData {
    buttonClick: boolean;
    melodies: boolean;
    warnings: boolean;
    ecoMode: boolean;
    intenseClean: boolean;
    binFullDetect: boolean;
    wifi: boolean;
    stealthLed: boolean;
    filterChange: number; // seconds
    brushChange: number; // seconds
    dirtBin: number; // minutes
}

export interface LidarPoint {
    angle: number;
    dist: number;
    intensity: number;
    error: number;
}

export interface LidarScan {
    rotationSpeed: number;
    validPoints: number;
    points: LidarPoint[];
}

export interface FirmwareVersion {
    version: string;
    chip: string;
    supported: boolean;
    identifying: boolean;
}

export interface ManualStatus {
    active: boolean;
    brush: boolean;
    vacuum: boolean;
    sideBrush: boolean;
    lifted: boolean;
    bumperFrontLeft: boolean;
    bumperFrontRight: boolean;
    bumperSideLeft: boolean;
    bumperSideRight: boolean;
    stallFront: boolean;
    stallRear: boolean;
}

export interface LogFileInfo {
    name: string;
    size: number;
    compressed: boolean;
}

export interface MapSession {
    type: "session";
    mode: string;
    time: number;
    battery: number;
}

export interface MapSummary {
    type: "summary";
    time: number;
    duration: number;
    mode: string;
    recharges: number;
    snapshots: number;
    distanceTraveled: number;
    maxDistFromOrigin: number;
    totalRotation: number;
    areaCovered: number;
    errorsDuringClean: number;
    battery?: number; // Legacy: same as batteryStart (pre-fix firmware)
    batteryStart?: number;
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
}

export interface MapData {
    session: MapSession | null;
    summary: MapSummary | null;
    path: MapPathPoint[];
    coverage: [number, number][];
    recharges: MapRechargePoint[];
    bounds: MapBounds | null;
    cellSize: number;
}

export interface HistoryFileInfo {
    name: string;
    size: number;
    compressed: boolean;
    recording: boolean;
    session: MapSession | null;
    summary: MapSummary | null;
}
