const SCENARIOS = {
    ok: {},
    off: { offline: true },
    cls: { cleaning: true },
    spt: { spotCleaning: true },
    chg: { fuelPercent: 62, chargingActive: true, extPwrPresent: true },
    ch2: { fuelPercent: 25, chargingActive: true, extPwrPresent: true },
    ful: { fuelPercent: 100, chargingActive: false, extPwrPresent: true },
    mid: { fuelPercent: 45 },
    low: { fuelPercent: 12 },
    ded: { fuelPercent: 0 },
    err: {
        hasError: true,
        kind: "error",
        errorCode: 265,
        errorMessage:
            "Error\r\n265 -  (UI_ERROR_BRUSH_STUCK)\r\nAlert\r\n205 -  (UI_ALERT_DUST_BIN_FULL)\r\nUSB state \r\n NOT connected",
        displayMessage: "Main brush is stuck",
    },
    alrt: {
        hasError: true,
        kind: "warning",
        errorCode: 229,
        errorMessage: "Error\r\n200 -  (UI_ALERT_INVALID)\r\nAlert\r\n229 -  (UI_ALERT_BRUSH_CHANGE)",
        displayMessage: "Time to replace the brush",
    },
    dock: { docking: true, cleaning: false },
    rchg: {
        midCleanRecharge: true,
        fuelPercent: 15,
        chargingActive: true,
        extPwrPresent: true,
    },
    man: { manualClean: true },
    mlf: { manualClean: true, manualLifted: true },
    mbf: { manualClean: true, manualBumperFrontLeft: true },
    mbs: { manualClean: true, manualBumperSideRight: true },
    msf: { manualClean: true, manualStallFront: true },
    msr: { manualClean: true, manualStallRear: true },
    ident: { identifying: true },
    unsup: { unsupported: true },
    upd: { firmwareVersion: "0.9" },
    llq: { lidarLowQuality: true },
    lsl: { lidarSlowRotation: true },
    lno: { lidarUnavailable: true },
    fa: { faults: { actions: true } },
    fs: { faults: { settings: true } },
    flr: { faults: { logsRead: true } },
    fld: { faults: { logsDelete: true } },
    fl: { faults: { logsRead: true, logsDelete: true } },
    fps: { faults: { pollState: true } },
    fpc: { faults: { pollCharger: true } },
    fpe: { faults: { pollError: true } },
    fp: { faults: { pollState: true, pollCharger: true, pollError: true } },
    fhc: { faults: { historyCorrupt: true } },
    fhl: { faults: { historyListCorrupt: true } },
    wap: { wifiDisconnected: true },
    wnc: { wifiDisconnected: true, wifiNoCredentials: true },
    wfo: { apFallbackOnDisconnect: false },
    fws: { faults: { wifiScan: true } },
    fwn: { faults: { wifiScanEmpty: true } },
    fwc: { faults: { wifiConnect: true } },
    fal: {
        faults: {
            actions: true,
            settings: true,
            logsRead: true,
            logsDelete: true,
            pollState: true,
            pollCharger: true,
            pollError: true,
            historyCorrupt: true,
            historyListCorrupt: true,
            wifiScan: true,
            wifiConnect: true,
        },
    },
};

const DEFAULT_STATE = {
    offline: false,
    fuelPercent: 85,
    chargingActive: false,
    extPwrPresent: false,
    cleaning: false,
    spotCleaning: false,
    docking: false,
    paused: false,
    uiState: "UIMGR_STATE_IDLE",
    robotState: "ST_C_Idle",
    hasError: false,
    kind: "",
    errorCode: 200,
    errorMessage: "",
    displayMessage: "",
    manualClean: false,
    manualBrush: false,
    manualVacuum: false,
    manualSideBrush: false,
    manualLifted: false,
    manualBumperFrontLeft: false,
    manualBumperFrontRight: false,
    manualBumperSideLeft: false,
    manualBumperSideRight: false,
    manualStallFront: false,
    manualStallRear: false,
    midCleanRecharge: false,
    identifying: false,
    unsupported: false,
    firmwareVersion: null,
    lidarLowQuality: false,
    lidarSlowRotation: false,
    lidarUnavailable: false,
    tz: "UTC0",
    logLevel: 0,
    apFallbackOnDisconnect: true,
    wifiDisconnected: false,
    wifiNoCredentials: false,
    syslogEnabled: false,
    syslogIp: "",
    wifiTxPower: 60,
    uartTxPin: 3,
    uartRxPin: 4,
    maxGpioPin: 21,
    hostname: "neato",
    navMode: "Normal",
    stallThreshold: 60,
    brushRpm: 1200,
    vacuumSpeed: 80,
    sideBrushPower: 1500,
    ntfyTopic: "",
    ntfyEnabled: true,
    ntfyOnDone: true,
    ntfyOnError: true,
    ntfyOnAlert: true,
    ntfyOnDocking: true,
    buttonClick: true,
    melodies: true,
    warnings: true,
    ecoMode: false,
    intenseClean: false,
    binFullDetect: true,
    wallEnable: true,
    wifi: true,
    stealthLed: false,
    filterChange: 2592000,
    brushChange: 2592000,
    dirtBin: 30,
    scheduleEnabled: true,
    autoRestartEnabled: false,
    autoRestartHour: 3,
    autoRestartMinute: 0,
    restartBeforeClean: false,
    sched0Hour: 9,
    sched0Min: 0,
    sched0On: true,
    sched1Hour: 9,
    sched1Min: 0,
    sched1On: true,
    sched2Hour: 9,
    sched2Min: 0,
    sched2On: true,
    sched3Hour: 9,
    sched3Min: 0,
    sched3On: true,
    sched4Hour: 9,
    sched4Min: 0,
    sched4On: true,
    sched5Hour: 0,
    sched5Min: 0,
    sched5On: false,
    sched6Hour: 0,
    sched6Min: 0,
    sched6On: false,
    sched0Slot1Hour: 15,
    sched0Slot1Min: 0,
    sched0Slot1On: true,
    sched1Slot1Hour: 15,
    sched1Slot1Min: 0,
    sched1Slot1On: true,
    sched2Slot1Hour: 15,
    sched2Slot1Min: 0,
    sched2Slot1On: true,
    sched3Slot1Hour: 15,
    sched3Slot1Min: 0,
    sched3Slot1On: true,
    sched4Slot1Hour: 15,
    sched4Slot1Min: 0,
    sched4Slot1On: true,
    sched5Slot1Hour: 0,
    sched5Slot1Min: 0,
    sched5Slot1On: false,
    sched6Slot1Hour: 0,
    sched6Slot1Min: 0,
    sched6Slot1On: false,
};

const DEFAULT_FAULTS = {
    actions: false,
    settings: false,
    logsRead: false,
    logsDelete: false,
    pollState: false,
    pollCharger: false,
    pollError: false,
    historyCorrupt: false,
    historyListCorrupt: false,
    wifiScan: false,
    wifiScanEmpty: false,
    wifiConnect: false,
};

const SCENARIO_COOKIE = "openneato_scenario";

function normalizeScenario(scenario) {
    return (scenario || "ok").trim() || "ok";
}

function parseCookies(cookieHeader = "") {
    const cookies = {};
    for (const part of cookieHeader.split(";")) {
        const [rawName, ...rawValue] = part.trim().split("=");
        if (!rawName) continue;
        cookies[rawName] = decodeURIComponent(rawValue.join("="));
    }
    return cookies;
}

function scenarioFromRequest(query = {}, cookieHeader = "") {
    const queryScenario = typeof query.get === "function" ? query.get("scenario") : query.scenario;
    return normalizeScenario(queryScenario || parseCookies(cookieHeader)[SCENARIO_COOKIE]);
}

function scenarioCookie(scenario) {
    return `${SCENARIO_COOKIE}=${encodeURIComponent(normalizeScenario(scenario))}; Path=/; SameSite=Lax`;
}

function createScenarioState(scenario = "ok") {
    const merged = {};
    const mergedFaults = {};

    for (const key of scenario.split("|")) {
        const s = SCENARIOS[key] || {};
        const { faults, ...rest } = s;
        Object.assign(merged, rest);
        if (faults) Object.assign(mergedFaults, faults);
    }

    return {
        state: { ...DEFAULT_STATE, ...merged },
        faults: { ...DEFAULT_FAULTS, ...mergedFaults },
    };
}

export { createScenarioState, SCENARIOS, scenarioCookie, scenarioFromRequest };
