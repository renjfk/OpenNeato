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

export interface SettingsData {
    tz: string;
    debugLog: boolean;
}

export interface FirmwareVersion {
    version: string;
}

export interface LogFileInfo {
    name: string;
    size: number;
    compressed: boolean;
}
