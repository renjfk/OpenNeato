// Mock API server for Neato web UI development
// Mimics all firmware REST endpoints with realistic stateful responses
// Runs as a Vite plugin — hooks into Vite's dev server middleware
// To test different scenarios, edit the `state` object directly and reload

const { createHash } = require("node:crypto");
const { execSync } = require("node:child_process");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

// --- Helpers ---

const getVersion = () => {
    try {
        const hash = execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
        return `0.0-${hash}`;
    } catch {
        return "0.0";
    }
};

const jsonResponse = (res, data, status = 200) => {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
};

const sendOk = (res) => jsonResponse(res, { ok: true });
const sendError = (res, msg, status = 500) => jsonResponse(res, { error: msg }, status);

// Request logging — captures original writeHead to log via Vite's logger
let viteLogger = null;

const logRequest = (req, res) => {
    if (!viteLogger) return;
    const start = Date.now();
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, ...args) => {
        const ms = Date.now() - start;
        const msg = `${req.method} ${req.url} \x1b[90m${status} ${ms}ms\x1b[0m`;
        if (status >= 500) viteLogger.error(msg, { timestamp: true });
        else if (status >= 400) viteLogger.warn(msg, { timestamp: true });
        else viteLogger.info(msg, { timestamp: true });
        return origWriteHead(status, ...args);
    };
};

const readBody = (req) =>
    new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => resolve(body));
    });

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const _randf = (min, max, decimals = 2) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

// --- Scenario selector ---
// Change this value to switch between test states. Save and Vite hot-reloads.
// Combine multiple scenarios with "|":
//   "ok"          — Robot idle, online, battery 85%
//   "err|fa"      — Robot error (brush stuck) + action faults
//   "low|fl|fs"   — Low battery + log faults + settings fault
//   "man|llq"     — Manual clean + low LIDAR quality
//
// Robot state:
//   ok   — Idle, battery 85%          off  — Device unreachable
//   ident — Identifying robot (boot)  unsup — Unsupported robot model
//   upd  — Firmware v0.9 (triggers update banner)
//   cls  — House cleaning             spt  — Spot cleaning
//   dock — Docking (return to base)   rchg — Mid-clean recharge (on dock, charging)
//   chg  — Charging, 62%              ch2  — Charging, 25%
//   ful  — Full, on dock              mid  — Battery 45%
//   low  — Battery 12%                ded  — Battery 0%
//   err  — Brush stuck error          alrt — Alert only (brush change)
//
// Manual clean (combine with each other or fault scenarios):
//   man  — Manual mode active (no safety issues)
//   mlf  — Manual + robot lifted
//   mbf  — Manual + front-left bumper contact
//   mbs  — Manual + side-right bumper contact
//   msf  — Manual + forward stall (reverse to clear)
//   msr  — Manual + rear stall (move forward to clear)
//
// LIDAR quality (combine with any state):
//   llq  — Low scan quality (<90 valid points)
//   lsl  — Slow LDS rotation (2.8 Hz)
//   lno  — LIDAR unavailable (GET /api/lidar returns error)
//
// Fault injection (combine with any state above):
//   fa   — Action faults (clean house/spot/stop return errors)
//   fs   — Settings fault (NVS write error)
//   flr  — Log read fault (list + content fail)
//   fld  — Log delete fault (delete single + delete all fail)
//   fl   — All log faults (read + delete)
//   fps  — Polling fault: GET /api/state
//   fpc  — Polling fault: GET /api/charger
//   fpe  — Polling fault: GET /api/error
//   fp   — All polling faults (state + charger + error)
//   fhc  — History corruption (inject corrupted pose lines in session data)
//   fal  — All faults combined
const SCENARIO = "ok";

// --- Robot state ---

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
        },
    },
};

// Merge scenarios split by "|"
const merged = {};
const mergedFaults = {};
for (const key of SCENARIO.split("|")) {
    const s = SCENARIOS[key] || {};
    const { faults: sf, ...rest } = s;
    Object.assign(merged, rest);
    if (sf) Object.assign(mergedFaults, sf);
}
merged.faults = mergedFaults;

// Fault flags — toggled by scenarios, checked by route handlers
const faults = {
    actions: false,
    settings: false,
    logsRead: false,
    logsDelete: false,
    pollState: false,
    pollCharger: false,
    pollError: false,
    historyCorrupt: false,
    ...(merged.faults || {}),
};

const state = {
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
    testMode: false,
    manualClean: false,
    // Manual clean motor + safety state
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
    // Mid-clean recharge (docking to charge, then resume)
    midCleanRecharge: false,
    // Robot model
    identifying: false,
    unsupported: false,
    // Firmware version override (null = auto from git hash)
    firmwareVersion: null,
    // LIDAR quality overrides
    lidarLowQuality: false,
    lidarSlowRotation: false,
    tz: "UTC0",
    debug: false,
    wifiTxPower: 60, // 15 dBm in 0.25 dBm units
    uartTxPin: 3,
    uartRxPin: 4,
    maxGpioPin: 21,
    hostname: "neato",
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
    // Schedule (Mon=0..Sun=6)
    scheduleEnabled: true,
    sched0Hour: 9,
    sched0Min: 0,
    sched0On: true, // Mon
    sched1Hour: 9,
    sched1Min: 0,
    sched1On: true, // Tue
    sched2Hour: 9,
    sched2Min: 0,
    sched2On: true, // Wed
    sched3Hour: 9,
    sched3Min: 0,
    sched3On: true, // Thu
    sched4Hour: 9,
    sched4Min: 0,
    sched4On: true, // Fri
    sched5Hour: 0,
    sched5Min: 0,
    sched5On: false, // Sat
    sched6Hour: 0,
    sched6Min: 0,
    sched6On: false, // Sun
    ...merged,
};

// Boot time for uptime calculation (mutable — reset by simulated reboot)
let bootTime = Date.now();

// --- Derived helpers ---

const vBattFromFuel = (fuel) => parseFloat((12.0 + (fuel / 100) * 4.6).toFixed(2));

// --- LIDAR captured scans (real data from Neato D7) ---

const lidarScans = readdirSync(__dirname)
    .filter((f) => f.startsWith("lidar-scan") && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(__dirname, f), "utf8")));
let lidarScanIndex = 0;

// --- Map data — in-memory session store ---
// Load mapdata-*.jsonl files into memory at startup. The active recording
// session (no summary line) grows via random-walk timer — no file I/O.

const historySessions = new Map(); // name -> string[] (JSONL lines)

for (const f of readdirSync(__dirname)
    .filter((n) => n.startsWith("mapdata-") && n.endsWith(".jsonl"))
    .sort()) {
    const lines = readFileSync(join(__dirname, f), "utf8")
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
    historySessions.set(f, lines);
}

// Find the active recording session (no summary line) and start random-walk timer
const recordingFile = [...historySessions.entries()].find(
    ([, lines]) => !lines.some((l) => l.includes('"type":"summary"')),
);

if (recordingFile) {
    const [recordingName, recordingLines] = recordingFile;
    const lastPose = [...recordingLines].reverse().find((l) => l.includes('"x":'));
    const pos = lastPose ? JSON.parse(lastPose) : { x: 0, y: 0, t: 0, ts: 7244 };
    let simX = pos.x;
    let simY = pos.y;
    let simT = pos.t;
    let simTs = pos.ts;

    setInterval(() => {
        simT += (Math.random() - 0.5) * 30;
        if (simT < 0) simT += 360;
        if (simT >= 360) simT -= 360;
        const rad = (simT * Math.PI) / 180;
        const step = 0.08 + Math.random() * 0.12;
        simX += Math.cos(rad) * step;
        simY -= Math.sin(rad) * step;
        simTs += 2.0 + Math.random() * 0.3;
        const lines = historySessions.get(recordingName);
        // Rolling window: drop oldest coordinate (keep session header at [0])
        if (lines.length > 1) lines.splice(1, 1);
        lines.push(`{"x":${simX.toFixed(3)},"y":${simY.toFixed(3)},"t":${simT.toFixed(1)},"ts":${simTs.toFixed(1)}}`);
    }, 2000);
}

const getLidarScan = () => {
    const scan = lidarScans[lidarScanIndex];
    lidarScanIndex = (lidarScanIndex + 1) % lidarScans.length;
    return scan;
};

// --- Mock log files ---

const mockLogs = [
    { name: "current.jsonl", size: 8192, compressed: false },
    { name: "1700000000.jsonl.hs", size: 4096, compressed: true },
    { name: "boot_2501.jsonl.hs", size: 1851, compressed: true },
];

const mockLogContent = [
    '{"t":1700000100,"typ":"boot","d":{"reason":"power_on","heap":195000}}',
    '{"t":1700000101,"typ":"wifi","d":{"event":"connected","rssi":-52}}',
    '{"t":1700000102,"typ":"ntp","d":{"event":"sync_ok","epoch":1700000102}}',
    '{"t":1700000200,"typ":"command","d":{"cmd":"GetCharger","status":"ok","ms":85,"q":0,"bytes":312,"resp":"GetCharger\\r\\nLabel,Value\\r\\nFuelPercent,85\\r\\nBatteryOverTemp,0\\r\\nChargingActive,0\\r\\nChargingEnabled,1\\r\\n"}}',
    '{"t":1700000202,"typ":"command","d":{"cmd":"GetState","status":"ok","ms":42,"q":0,"bytes":95,"resp":"GetState\\r\\nCurrent UI State is: UIMGR_STATE_IDLE\\nCurrent Robot State is: ST_C_Idle\\n"}}',
    '{"t":1700000203,"typ":"command","d":{"cmd":"GetState","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',
    '{"t":1700000210,"typ":"request","d":{"method":"GET","path":"/api/charger","status":200,"ms":92}}',
    '{"t":1700000215,"typ":"command","d":{"cmd":"GetErr","status":"ok","ms":38,"q":0,"bytes":64,"resp":"GetErr\\r\\nError\\r\\n200 -  (UI_ALERT_INVALID)\\r\\nAlert\\r\\n200 -  (UI_ALERT_INVALID)\\r\\n"}}',
    '{"t":1700000216,"typ":"command","d":{"cmd":"GetErr","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',
    '{"t":1700000220,"typ":"request","d":{"method":"GET","path":"/api/state","status":200,"ms":48}}',
    '{"t":1700000300,"typ":"command","d":{"cmd":"GetAnalogSensors","status":"ok","ms":120,"q":1,"bytes":480}}',
    '{"t":1700000305,"typ":"request","d":{"method":"POST","path":"/api/clean?action=house","status":200,"ms":210}}',
    '{"t":1700000306,"typ":"command","d":{"cmd":"Clean House","status":"ok","ms":95,"q":0,"bytes":28}}',
    '{"t":1700000400,"typ":"event","d":{"msg":"cleaning_started","mode":"house"}}',
    '{"t":1700000500,"typ":"command","d":{"cmd":"GetMotors","status":"ok","ms":110,"q":2,"bytes":520}}',
    '{"t":1700000600,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":450,"q":0,"bytes":8200}}',
    '{"t":1700000601,"typ":"command","d":{"cmd":"GetCharger","status":"ok","ms":0,"q":0,"bytes":0,"age":401}}',

    '{"t":1700000615,"typ":"request","d":{"method":"GET","path":"/api/lidar","status":200,"ms":460}}',
    '{"t":1700000620,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":440,"q":1,"bytes":8140}}',
    '{"t":1700000621,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',

    '{"t":1700000700,"typ":"event","d":{"msg":"cleaning_completed","duration":600}}',
].join("\n");

// --- Derive UI/robot state from current state ---

const deriveStates = () => {
    if (state.manualClean) {
        state.uiState = "UIMGR_STATE_MANUALCLEANING";
        state.robotState = "ST_C_ManualCleaning";
    } else if (state.testMode) {
        state.uiState = "UIMGR_STATE_TESTMODE";
        state.robotState = "ST_C_TestMode";
    } else if (state.midCleanRecharge) {
        state.uiState = "UIMGR_STATE_CLEANINGSUSPENDED";
        state.robotState = "ST_M1_Charging_Cleaning";
    } else if (state.docking) {
        state.uiState = "UIMGR_STATE_DOCKINGRUNNING";
        state.robotState = "ST_C_Docking";
    } else if (state.cleaning && !state.paused) {
        state.uiState = "UIMGR_STATE_HOUSECLEANINGRUNNING";
        state.robotState = "ST_C_HouseCleaning";
    } else if (state.cleaning && state.paused) {
        state.uiState = "UIMGR_STATE_HOUSECLEANINGPAUSED";
        state.robotState = "ST_C_Standby";
    } else if (state.spotCleaning && !state.paused) {
        state.uiState = "UIMGR_STATE_SPOTCLEANINGRUNNING";
        state.robotState = "ST_C_SpotCleaning";
    } else if (state.spotCleaning && state.paused) {
        state.uiState = "UIMGR_STATE_SPOTCLEANINGPAUSED";
        state.robotState = "ST_C_Standby";
    } else {
        state.uiState = "UIMGR_STATE_IDLE";
        state.robotState = "ST_C_Idle";
    }
};

// --- Route handlers ---

const routes = {
    // Sensor routes
    "GET /api/version": (_req, res) => {
        jsonResponse(res, {
            modelName: "BotVacD7",
            serialNumber: "OPS01234AA,0000001,D",
            softwareVersion: "4.5.3-142",
            ldsVersion: "V2.6.15295",
            ldsSerial: "KSH-V5F4",
            mainBoardVersion: "15.0",
        });
    },

    "GET /api/charger": (_req, res) => {
        if (faults.pollCharger) return sendError(res, "UART timeout reading charger", 500);
        const fuel = Math.round(state.fuelPercent);
        jsonResponse(res, {
            fuelPercent: fuel,
            batteryOverTemp: false,
            chargingActive: state.chargingActive,
            chargingEnabled: true,
            confidOnFuel: fuel > 20,
            onReservedFuel: fuel < 10,
            emptyFuel: fuel === 0,
            batteryFailure: false,
            extPwrPresent: state.extPwrPresent,
            vBattV: vBattFromFuel(fuel),
            vExtV: state.extPwrPresent ? 22.3 : 0.0,
            chargerMAH: state.chargingActive ? 1200 : 0,
            dischargeMAH: Math.round(((100 - fuel) / 100) * 2800),
        });
    },

    "GET /api/motors": (_req, res) => {
        const cleaning = state.cleaning || state.spotCleaning;
        jsonResponse(res, {
            brushRPM: cleaning ? rand(1100, 1300) : 0,
            brushMA: cleaning ? rand(200, 400) : 0,
            vacuumRPM: cleaning ? rand(2200, 2600) : 0,
            vacuumMA: cleaning ? rand(400, 700) : 0,
            leftWheelRPM: cleaning ? rand(60, 120) : 0,
            leftWheelLoad: cleaning ? rand(10, 40) : 0,
            leftWheelPositionMM: state.leftWheelPos,
            leftWheelSpeed: cleaning ? rand(150, 300) : 0,
            rightWheelRPM: cleaning ? rand(60, 120) : 0,
            rightWheelLoad: cleaning ? rand(10, 40) : 0,
            rightWheelPositionMM: state.rightWheelPos,
            rightWheelSpeed: cleaning ? rand(150, 300) : 0,
            sideBrushMA: cleaning ? rand(50, 200) : 0,
            laserRPM: cleaning ? rand(290, 310) : 0,
        });
    },

    "GET /api/state": (_req, res) => {
        if (faults.pollState) return sendError(res, "UART timeout reading state", 500);
        deriveStates();
        jsonResponse(res, {
            uiState: state.uiState,
            robotState: state.robotState,
        });
    },

    "GET /api/error": (_req, res) => {
        if (faults.pollError) return sendError(res, "UART timeout reading error", 500);
        jsonResponse(res, {
            hasError: state.hasError,
            kind: state.kind,
            errorCode: state.errorCode,
            errorMessage: state.errorMessage,
            displayMessage: state.displayMessage,
        });
    },

    "GET /api/lidar": (_req, res) => {
        if (state.lidarUnavailable) return sendError(res, "UART timeout reading LDS scan", 500);
        const scan = getLidarScan();
        // Degrade scan for quality scenarios
        if (state.lidarLowQuality || state.lidarSlowRotation) {
            const degraded = { ...scan };
            if (state.lidarSlowRotation) degraded.rotationSpeed = 2.8;
            if (state.lidarLowQuality) {
                // Zero out most points to simulate poor readings
                degraded.points = scan.points.map((p, i) =>
                    i % 5 === 0 ? p : { ...p, dist: 0, intensity: 0, error: 8035 },
                );
                degraded.validPoints = degraded.points.filter((p) => p.dist > 0).length;
            }
            return jsonResponse(res, degraded);
        }
        jsonResponse(res, scan);
    },

    // Action routes — parameterized via query string
    "POST /api/clean": (_req, res, query) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        const action = query.action || "house";
        if (action === "dock") {
            if (state.cleaning || state.spotCleaning) {
                state.docking = true; // Simulate return-to-base
                state.cleaning = false;
                state.spotCleaning = false;
                state.paused = false;
            }
        } else if (action === "pause") {
            if ((state.cleaning || state.spotCleaning) && !state.paused) {
                state.paused = true; // Running -> Paused
            }
        } else if (action === "stop") {
            state.cleaning = false;
            state.spotCleaning = false;
            state.docking = false;
            state.paused = false;
        } else if (action === "spot") {
            state.spotCleaning = true;
            state.cleaning = false;
            state.docking = false;
            state.paused = false;
        } else {
            state.cleaning = true;
            state.spotCleaning = false;
            state.docking = false;
            state.paused = false;
        }
        deriveStates();
        sendOk(res);
    },

    "GET /api/manual/status": (_req, res) => {
        jsonResponse(res, {
            active: state.manualClean,
            brush: state.manualBrush,
            vacuum: state.manualVacuum,
            sideBrush: state.manualSideBrush,
            lifted: state.manualLifted,
            bumperFrontLeft: state.manualBumperFrontLeft,
            bumperFrontRight: state.manualBumperFrontRight,
            bumperSideLeft: state.manualBumperSideLeft,
            bumperSideRight: state.manualBumperSideRight,
            stallFront: state.manualStallFront,
            stallRear: state.manualStallRear,
        });
    },

    "POST /api/manual/move": (_req, res) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        if (!state.manualClean) return sendError(res, "Not in manual mode", 400);
        sendOk(res);
    },

    "POST /api/manual/motors": (_req, res, query) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        if (!state.manualClean) return sendError(res, "Not in manual mode", 400);
        state.manualBrush = query.brush === "1";
        state.manualVacuum = query.vacuum === "1";
        state.manualSideBrush = query.sideBrush === "1";
        setTimeout(() => sendOk(res), 600);
    },

    "POST /api/power": (_req, res, query) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        const action = query.action;
        if (action === "restart") {
            // Simulate robot power cycle — robot recovers in ~1s, ESP32 stays online
            sendOk(res);
        } else if (action === "shutdown") {
            // Simulate real ESP32 power loss — respond then kill the dev server
            sendOk(res);
            setTimeout(() => process.exit(0), 500);
        } else {
            sendError(res, "unknown action", 400);
        }
    },

    "POST /api/sound": (_req, res) => {
        // Accept and ignore — just acknowledge
        sendOk(res);
    },

    "POST /api/testmode": (_req, res, query) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        state.testMode = query.enable === "1";
        deriveStates();
        sendOk(res);
    },

    "POST /api/manual": (_req, res, query) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        const enable = query.enable === "1";
        state.manualClean = enable;
        if (enable) {
            state.cleaning = false;
            state.spotCleaning = false;
            state.paused = false;
        }
        // Reset motor and safety state on enable/disable
        state.manualBrush = false;
        state.manualVacuum = false;
        state.manualSideBrush = false;
        if (!enable) {
            state.manualLifted = false;
            state.manualBumperFrontLeft = false;
            state.manualBumperFrontRight = false;
            state.manualBumperSideLeft = false;
            state.manualBumperSideRight = false;
            state.manualStallFront = false;
            state.manualStallRear = false;
        }
        deriveStates();
        sendOk(res);
    },

    "POST /api/lidar/rotate": (_req, res) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        // LDS rotation is fire-and-forget — no state change visible in polls
        sendOk(res);
    },

    // Log routes
    "GET /api/logs": (_req, res) => {
        if (faults.logsRead) return sendError(res, "SPIFFS read failed", 500);
        jsonResponse(res, mockLogs);
    },

    "DELETE /api/logs": (_req, res) => {
        if (faults.logsDelete) return sendError(res, "SPIFFS busy, try again later", 503);
        sendOk(res);
    },

    // System routes
    "GET /api/system": (_req, res) => {
        jsonResponse(res, {
            heap: rand(160000, 200000),
            heapTotal: 327680,
            uptime: Date.now() - bootTime,
            rssi: rand(-65, -40),
            fsUsed: rand(10000, 50000),
            fsTotal: 262144,
            ntpSynced: true,
            time: Math.floor(Date.now() / 1000),
            timeSource: "ntp",
            tz: state.tz,
        });
    },

    "POST /api/system/restart": (_req, res) => {
        sendOk(res);
        setTimeout(() => {
            bootTime = Date.now();
        }, 2000);
    },

    "POST /api/system/format-fs": (_req, res) => {
        sendOk(res);
        setTimeout(() => {
            bootTime = Date.now();
        }, 2000);
    },

    "POST /api/system/reset": (_req, res) => {
        sendOk(res);
        setTimeout(() => {
            bootTime = Date.now();
        }, 2000);
    },

    "GET /api/settings": (_req, res) => {
        const s = {};
        const keys = [
            "tz",
            "debug",
            "wifiTxPower",
            "uartTxPin",
            "uartRxPin",
            "maxGpioPin",
            "hostname",
            "stallThreshold",
            "brushRpm",
            "vacuumSpeed",
            "sideBrushPower",
            "ntfyTopic",
            "ntfyEnabled",
            "ntfyOnDone",
            "ntfyOnError",
            "ntfyOnAlert",
            "ntfyOnDocking",
            "scheduleEnabled",
        ];
        for (const k of keys) s[k] = state[k];
        for (let d = 0; d < 7; d++) {
            s[`sched${d}Hour`] = state[`sched${d}Hour`];
            s[`sched${d}Min`] = state[`sched${d}Min`];
            s[`sched${d}On`] = state[`sched${d}On`];
        }
        jsonResponse(res, s);
    },

    "POST /api/notifications/test": (_req, res, query) => {
        if (!query.topic) return sendError(res, "missing topic", 400);
        sendOk(res);
    },

    "GET /repos/renjfk/OpenNeato/releases/latest": (_req, res) => {
        jsonResponse(res, { tag_name: "v1.0" });
    },

    "GET /api/firmware/version": (_req, res) => {
        jsonResponse(res, {
            version: state.firmwareVersion ?? getVersion(),
            chip: "ESP32-C3",
            supported: !state.unsupported && !state.identifying,
            identifying: state.identifying,
        });
    },
};

// --- Core request handler ---

const handleRequest = async (req, res) => {
    // Simulate device unreachable — drop connection
    if (state.offline) {
        req.destroy();
        return;
    }

    const parsed = new URL(req.url, "http://localhost");
    const path = parsed.pathname;
    const query = Object.fromEntries(parsed.searchParams);

    // Match history routes: GET /api/history, GET/DELETE /api/history/{filename}
    // Inject corrupted pose lines to test frontend repair logic (simulates
    // heatshrink decompression artifacts: '.' -> ':', '.' -> '"', digit -> letter)
    const injectCorruptedPoses = (lines) => {
        const corruptions = [
            '{"x":-0.798,"y":3.459,"t":100:5,"ts":8203.4}',
            '{"x":-0.785,"y":4.192,"t":100:3,"ts":8208.1}',
            '{"x":-1.286,"y":4.007,"t":177:5,"ts":8215.6}',
            '{"x":-1.8"3,"y":2.254,"t":181.0,"ts":8288.6}',
            '{"x":-1.946,"y":2.0"3,"t":181.9,"ts":8312.8}',
            '{"x":-4.793,"y":-1.6t2,"t":356.5,"ts":9182.5}',
            '{"x":-1.740,"y":3.510,"t":1.6,"ts":8242:0}',
        ];
        const result = [lines[0]];
        for (let i = 1; i < lines.length; i++) {
            result.push(lines[i]);
            // Sprinkle corrupted lines at ~5% rate among pose lines
            if (!lines[i].includes('"type"') && i % 20 === 0) {
                result.push(corruptions[i % corruptions.length]);
            }
        }
        return result;
    };

    if (path === "/api/history" && req.method === "GET") {
        // List sessions from in-memory store with embedded session/summary metadata
        const list = [...historySessions.entries()].map(([name, lines]) => {
            let session = null;
            let summary = null;
            if (lines.length > 0) {
                try {
                    const first = JSON.parse(lines[0]);
                    if (first.type === "session") session = first;
                } catch {}
            }
            if (lines.length > 1) {
                try {
                    const last = JSON.parse(lines[lines.length - 1]);
                    if (last.type === "summary") summary = last;
                } catch {}
            }
            const raw = `${lines.join("\n")}\n`;
            return {
                name,
                size: Buffer.byteLength(raw),
                compressed: name.endsWith(".hs"),
                recording: summary === null,
                session,
                summary,
            };
        });
        return jsonResponse(res, list);
    }

    if (path === "/api/history" && req.method === "DELETE") {
        historySessions.clear();
        return sendOk(res);
    }

    const historyMatch = path.match(/^\/api\/history\/(.+)$/);
    if (historyMatch) {
        const filename = historyMatch[1];
        if (req.method === "GET") {
            const lines = historySessions.get(filename);
            if (!lines) return sendError(res, "session not found", 404);
            const served = faults.historyCorrupt ? injectCorruptedPoses(lines) : lines;
            const raw = `${served.join("\n")}\n`;
            res.writeHead(200, {
                "Content-Type": "application/x-ndjson",
                "Content-Length": Buffer.byteLength(raw),
            });
            return res.end(raw);
        }
        if (req.method === "DELETE") {
            historySessions.delete(filename);
            return sendOk(res);
        }
        return sendError(res, "method not allowed", 405);
    }

    // Match log file routes: GET/DELETE /api/logs/{filename}
    const logFileMatch = path.match(/^\/api\/logs\/(.+)$/);
    if (logFileMatch) {
        const filename = logFileMatch[1];
        if (req.method === "GET") {
            if (faults.logsRead) return sendError(res, "SPIFFS read failed", 500);
            res.writeHead(200, {
                "Content-Type": "application/x-ndjson",
                "Content-Disposition": `attachment; filename="${filename.replace(/\.hs$/, "")}"`,
            });
            return res.end(mockLogContent);
        }
        if (req.method === "DELETE") {
            if (faults.logsDelete) return sendError(res, "SPIFFS busy, try again later", 503);
            return sendOk(res);
        }
        return sendError(res, "method not allowed", 405);
    }

    // POST /api/firmware/update?hash=<md5> — validate chip ID + MD5, simulate flash write, reboot
    if (req.method === "POST" && path === "/api/firmware/update") {
        const expectedMd5 = query.hash || "";
        if (!expectedMd5) return sendError(res, "MD5 hash required", 400);
        const MOCK_CHIP_ID = 5; // ESP32-C3
        const chunks = [];
        await new Promise((resolve) => {
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", resolve);
        });
        // Extract file bytes from multipart body (skip boundary/headers, find file content)
        const body = Buffer.concat(chunks);
        const bodyStr = body.toString("binary");
        const headerEnd = bodyStr.indexOf("\r\n\r\n");
        // Find end of file content (before the closing boundary)
        const boundaryEnd = bodyStr.lastIndexOf("\r\n--");
        const fileStart = headerEnd !== -1 ? headerEnd + 4 : -1;
        const fileEnd = boundaryEnd > fileStart ? boundaryEnd : body.length;
        if (fileStart !== -1) {
            if (body.length >= fileStart + 16) {
                const chipId = body[fileStart + 12];
                if (chipId !== MOCK_CHIP_ID) {
                    return sendError(res, "Firmware chip mismatch: file targets a different ESP32 variant", 400);
                }
            }
            // MD5 verification — mirrors ESP32 Update.setMD5 / Update.end(true) behavior
            const fileBytes = body.subarray(fileStart, fileEnd);
            const actualMd5 = createHash("md5").update(fileBytes).digest("hex");
            if (actualMd5 !== expectedMd5.toLowerCase()) {
                return sendError(res, "MD5 mismatch: firmware integrity check failed", 400);
            }
        }
        // Simulate flash write: 3-5s delay
        await new Promise((r) => setTimeout(r, rand(3000, 5000)));
        sendOk(res);
        setTimeout(() => {
            bootTime = Date.now();
        }, 2000);
        return;
    }

    // PUT /api/settings — partial update, simulate NVS write delay
    if (req.method === "PUT" && path === "/api/settings") {
        if (faults.settings) {
            await new Promise((r) => setTimeout(r, rand(200, 400)));
            return sendError(res, "NVS write failed: flash error", 500);
        }
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            await new Promise((r) => setTimeout(r, rand(300, 600)));
            if (data.tz !== undefined) state.tz = data.tz;
            if (data.debug !== undefined) state.debug = data.debug;
            if (data.wifiTxPower !== undefined) state.wifiTxPower = data.wifiTxPower;
            const pinsChanged =
                (data.uartTxPin !== undefined && data.uartTxPin !== state.uartTxPin) ||
                (data.uartRxPin !== undefined && data.uartRxPin !== state.uartRxPin);
            if (data.uartTxPin !== undefined) state.uartTxPin = data.uartTxPin;
            if (data.uartRxPin !== undefined) state.uartRxPin = data.uartRxPin;
            const hostnameChanged = data.hostname !== undefined && data.hostname !== state.hostname;
            if (data.hostname !== undefined) state.hostname = data.hostname;
            if (data.stallThreshold !== undefined) state.stallThreshold = data.stallThreshold;
            if (data.brushRpm !== undefined) state.brushRpm = data.brushRpm;
            if (data.vacuumSpeed !== undefined) state.vacuumSpeed = data.vacuumSpeed;
            if (data.sideBrushPower !== undefined) state.sideBrushPower = data.sideBrushPower;
            if (data.ntfyTopic !== undefined) state.ntfyTopic = data.ntfyTopic;
            if (data.ntfyEnabled !== undefined) state.ntfyEnabled = data.ntfyEnabled;
            if (data.ntfyOnDone !== undefined) state.ntfyOnDone = data.ntfyOnDone;
            if (data.ntfyOnError !== undefined) state.ntfyOnError = data.ntfyOnError;
            if (data.ntfyOnAlert !== undefined) state.ntfyOnAlert = data.ntfyOnAlert;
            if (data.ntfyOnDocking !== undefined) state.ntfyOnDocking = data.ntfyOnDocking;
            if (data.scheduleEnabled !== undefined) state.scheduleEnabled = data.scheduleEnabled;
            for (let d = 0; d < 7; d++) {
                if (data[`sched${d}Hour`] !== undefined) state[`sched${d}Hour`] = data[`sched${d}Hour`];
                if (data[`sched${d}Min`] !== undefined) state[`sched${d}Min`] = data[`sched${d}Min`];
                if (data[`sched${d}On`] !== undefined) state[`sched${d}On`] = data[`sched${d}On`];
            }
            if (pinsChanged || hostnameChanged) {
                setTimeout(() => {
                    bootTime = Date.now();
                }, 2000);
            }
            // Return full settings (reuse GET handler logic)
            const s = {};
            const keys = [
                "tz",
                "debug",
                "wifiTxPower",
                "uartTxPin",
                "uartRxPin",
                "maxGpioPin",
                "hostname",
                "stallThreshold",
                "brushRpm",
                "vacuumSpeed",
                "sideBrushPower",
                "ntfyTopic",
                "ntfyEnabled",
                "ntfyOnDone",
                "ntfyOnError",
                "ntfyOnAlert",
                "ntfyOnDocking",
                "scheduleEnabled",
            ];
            for (const k of keys) s[k] = state[k];
            for (let d = 0; d < 7; d++) {
                s[`sched${d}Hour`] = state[`sched${d}Hour`];
                s[`sched${d}Min`] = state[`sched${d}Min`];
                s[`sched${d}On`] = state[`sched${d}On`];
            }
            return jsonResponse(res, s);
        } catch {
            return sendError(res, "invalid JSON", 400);
        }
    }

    // Debug serial endpoint — gated on debug mode
    if (req.method === "POST" && path === "/api/serial") {
        if (!state.debug) return sendError(res, "debug mode disabled", 403);
        const cmd = query.cmd;
        if (!cmd) return sendError(res, "missing cmd", 400);
        // Simulate serial response with a delay
        await new Promise((r) => setTimeout(r, rand(50, 150)));
        const body = `${cmd}\r\nMock response for: ${cmd}\r\n\x1a`;
        res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) });
        return res.end(body);
    }

    // Standard route lookup
    const key = `${req.method} ${path}`;
    const handler = routes[key];
    if (handler) {
        return handler(req, res, query);
    }

    // Not an API route — return false so Vite can handle it
    return false;
};

// --- Vite plugin ---
// Hooks into Vite's dev server middleware so /api/* requests are handled
// in-process — single port, single `npm run dev`

function mockApiPlugin() {
    return {
        name: "mock-api",
        // Clear update localStorage when not in upd scenario
        transformIndexHtml(html) {
            if (SCENARIO.split("|").includes("upd")) return html;
            return html.replace(
                "</head>",
                `<script>localStorage.removeItem("update_latest_version");localStorage.removeItem("update_last_check");</script></head>`,
            );
        },
        configureServer(server) {
            viteLogger = server.config.logger;
            server.middlewares.use(async (req, res, next) => {
                // Only intercept /api/* and /repos/* (GitHub API mock) requests
                if (!req.url.startsWith("/api") && !req.url.startsWith("/repos")) return next();

                logRequest(req, res);

                // Latency simulation (50-200ms)
                await new Promise((r) => setTimeout(r, rand(50, 200)));

                const handled = await handleRequest(req, res);
                if (handled === false) next();
            });
        },
    };
}

module.exports = { mockApiPlugin };
