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
    errorCode: number;
    errorMessage: string;
}

export interface SystemData {
    heap: number;
    heapTotal: number;
    uptime: number;
    rssi: number;
    spiffsUsed: number;
    spiffsTotal: number;
    ntpSynced: boolean;
    time: number;
    timeSource: string;
    tz: string;
}

// Per-day schedule fields: sched{0-6}Hour, sched{0-6}Min, sched{0-6}On (Mon=0..Sun=6)
export interface SettingsData {
    tz: string;
    debugLog: boolean;
    wifiTxPower: number; // 0.25 dBm units (e.g. 34 = 8.5 dBm)
    uartTxPin: number;
    uartRxPin: number;
    hostname: string;
    stallThreshold: number; // Wheel load % for stall detection (30-80)
    brushRpm: number; // Main brush RPM (500-1600)
    vacuumSpeed: number; // Vacuum speed % (40-100)
    sideBrushPower: number; // Side brush power in mW (500-1500)
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
