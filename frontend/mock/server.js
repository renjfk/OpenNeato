// Mock API server for Neato web UI development
// Mimics all firmware REST endpoints with realistic stateful responses
// Runs as a Vite plugin — hooks into Vite's dev server middleware
// To test different scenarios, edit the `state` object directly and reload

// --- Helpers ---

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

const readBody = (req) =>
    new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => resolve(body));
    });

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randf = (min, max, decimals = 2) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

// --- Scenario selector ---
// Change this value to switch between test states. Save and Vite hot-reloads.
// Combine multiple scenarios with "|":
//   "ok"          — Robot idle, online, battery 85%
//   "err|fa"      — Robot error (brush stuck) + action faults
//   "low|fl|fs"   — Low battery + log faults + settings fault
//
// Robot state:
//   ok   — Idle, battery 85%          off — Device unreachable
//   cls  — House cleaning             spt — Spot cleaning
//   chg  — Charging, 62%              ch2 — Charging, 25%
//   ful  — Full, on dock              mid — Battery 45%
//   low  — Battery 12%                ded — Battery 0%
//   err  — Brush stuck error
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
        errorCode: 234,
        errorMessage: "My Brush is stuck. Please free it from debris",
    },
    fa: { faults: { actions: true } },
    fs: { faults: { settings: true } },
    flr: { faults: { logsRead: true } },
    fld: { faults: { logsDelete: true } },
    fl: { faults: { logsRead: true, logsDelete: true } },
    fps: { faults: { pollState: true } },
    fpc: { faults: { pollCharger: true } },
    fpe: { faults: { pollError: true } },
    fp: { faults: { pollState: true, pollCharger: true, pollError: true } },
    fal: {
        faults: {
            actions: true,
            settings: true,
            logsRead: true,
            logsDelete: true,
            pollState: true,
            pollCharger: true,
            pollError: true,
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
    ...(merged.faults || {}),
};

const state = {
    offline: false,
    fuelPercent: 85,
    chargingActive: false,
    extPwrPresent: false,
    cleaning: false,
    spotCleaning: false,
    uiState: "UIMGR_STATE_IDLE",
    robotState: "ST_C_Idle",
    hasError: false,
    errorCode: 200,
    errorMessage: "",
    testMode: false,
    tz: "UTC0",
    debugLog: false,
    wifiTxPower: 34, // 8.5 dBm in 0.25 dBm units
    uartTxPin: 3,
    uartRxPin: 4,
    hostname: "neato",
    ...merged,
};

// Boot time for uptime calculation (mutable — reset by simulated reboot)
let bootTime = Date.now();

// --- Derived helpers ---

const vBattFromFuel = (fuel) => parseFloat((12.0 + (fuel / 100) * 4.6).toFixed(2));

// --- LIDAR synthetic room generator ---

const generateLidarScan = () => {
    const points = [];
    for (let angle = 0; angle < 360; angle++) {
        const rad = (angle * Math.PI) / 180;

        // Simple rectangular room ~4m x 3m, robot near center
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Distance to room walls from center
        let dist;
        if (Math.abs(cos) > Math.abs(sin)) {
            dist = Math.abs(2000 / cos); // 2m to left/right walls
        } else {
            dist = Math.abs(1500 / sin); // 1.5m to front/back walls
        }

        // Cap at reasonable max and add noise
        dist = Math.min(dist, 5000);
        dist = Math.round(dist + rand(-30, 30));

        // Some angles get errors (simulating LIDAR artifacts)
        const hasError = Math.random() < 0.05;

        points.push({
            angle,
            dist: hasError ? 0 : Math.max(0, dist),
            intensity: hasError ? 0 : rand(1200, 1600),
            error: hasError ? rand(1, 3) : 0,
        });
    }

    const validPoints = points.filter((p) => p.error === 0).length;
    return { rotationSpeed: randf(4.8, 5.2), validPoints, points };
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
    '{"t":1700000305,"typ":"request","d":{"method":"POST","path":"/api/clean/house","status":200,"ms":210}}',
    '{"t":1700000306,"typ":"command","d":{"cmd":"Clean House","status":"ok","ms":95,"q":0,"bytes":28}}',
    '{"t":1700000400,"typ":"event","d":{"msg":"cleaning_started","mode":"house"}}',
    '{"t":1700000500,"typ":"command","d":{"cmd":"GetMotors","status":"ok","ms":110,"q":2,"bytes":520}}',
    '{"t":1700000600,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":450,"q":0,"bytes":8200}}',
    '{"t":1700000601,"typ":"command","d":{"cmd":"GetCharger","status":"ok","ms":0,"q":0,"bytes":0,"age":401}}',
    '{"t":1700000602,"typ":"command","d":{"cmd":"GetAnalogSensors","status":"ok","ms":95,"q":1,"bytes":480}}',
    '{"t":1700000604,"typ":"command","d":{"cmd":"GetDigitalSensors","status":"ok","ms":35,"q":0,"bytes":210}}',
    '{"t":1700000610,"typ":"request","d":{"method":"GET","path":"/api/sensors/analog","status":200,"ms":102}}',
    '{"t":1700000612,"typ":"request","d":{"method":"GET","path":"/api/sensors/digital","status":200,"ms":41}}',
    '{"t":1700000615,"typ":"request","d":{"method":"GET","path":"/api/lidar","status":200,"ms":460}}',
    '{"t":1700000620,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":440,"q":1,"bytes":8140}}',
    '{"t":1700000621,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',
    '{"t":1700000625,"typ":"command","d":{"cmd":"GetAccel","status":"ok","ms":28,"q":0,"bytes":96}}',
    '{"t":1700000630,"typ":"request","d":{"method":"GET","path":"/api/accel","status":200,"ms":34}}',
    '{"t":1700000700,"typ":"event","d":{"msg":"cleaning_completed","duration":600}}',
    '{"t":1700000710,"typ":"error","d":{"code":234,"msg":"My Brush is stuck. Please free it from debris"}}',
].join("\n");

// --- Derive UI/robot state from current state ---

const deriveStates = () => {
    if (state.testMode) {
        state.uiState = "UIMGR_STATE_TESTMODE";
        state.robotState = "ST_C_TestMode";
    } else if (state.cleaning) {
        state.uiState = "UIMGR_STATE_HOUSECLEANINGRUNNING";
        state.robotState = "ST_C_HouseCleaning";
    } else if (state.spotCleaning) {
        state.uiState = "UIMGR_STATE_SPOTCLEANINGRUNNING";
        state.robotState = "ST_C_SpotCleaning";
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
            modelName: "BotVacD5",
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

    "GET /api/sensors/analog": (_req, res) => {
        const cleaning = state.cleaning || state.spotCleaning;
        jsonResponse(res, {
            batteryVoltage: Math.round(vBattFromFuel(state.fuelPercent) * 1000),
            batteryCurrent: cleaning ? -600 : -150,
            batteryTemp: rand(21000, 25000),
            externalVoltage: state.extPwrPresent ? 22300 : 0,
            accelX: rand(-20, 20),
            accelY: rand(-20, 20),
            accelZ: rand(950, 970),
            vacuumCurrent: cleaning ? rand(300, 600) : 0,
            sideBrushCurrent: cleaning ? rand(100, 300) : 0,
            magSensorLeft: 0,
            magSensorRight: 0,
            wallSensor: cleaning ? rand(20, 400) : rand(200, 300),
            dropSensorLeft: rand(15, 25),
            dropSensorRight: rand(15, 25),
        });
    },

    "GET /api/sensors/digital": (_req, res) => {
        jsonResponse(res, {
            dcJackIn: state.extPwrPresent,
            dustbinIn: true,
            leftWheelExtended: false,
            rightWheelExtended: false,
            lSideBit: false,
            lFrontBit: false,
            lLdsBit: false,
            rSideBit: false,
            rFrontBit: false,
            rLdsBit: false,
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
            errorCode: state.errorCode,
            errorMessage: state.errorMessage,
        });
    },

    "GET /api/accel": (_req, res) => {
        jsonResponse(res, {
            pitchDeg: randf(-2, 2),
            rollDeg: randf(-2, 2),
            xInG: randf(-0.05, 0.05, 4),
            yInG: randf(-0.05, 0.05, 4),
            zInG: randf(0.95, 1.0, 4),
            sumInG: randf(0.96, 1.01, 4),
        });
    },

    "GET /api/buttons": (_req, res) => {
        jsonResponse(res, {
            softKey: false,
            scrollUp: false,
            start: false,
            back: false,
            scrollDown: false,
        });
    },

    "GET /api/lidar": (_req, res) => {
        jsonResponse(res, generateLidarScan());
    },

    // Action routes
    "POST /api/clean/house": (_req, res) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        state.cleaning = true;
        state.spotCleaning = false;
        deriveStates();
        sendOk(res);
    },

    "POST /api/clean/spot": (_req, res) => {
        if (faults.actions) return sendError(res, "UART timeout: robot not responding", 500);
        state.spotCleaning = true;
        state.cleaning = false;
        deriveStates();
        sendOk(res);
    },

    "POST /api/clean/stop": (_req, res) => {
        if (faults.actions) return sendError(res, "Command queue full", 503);
        state.cleaning = false;
        state.spotCleaning = false;
        deriveStates();
        sendOk(res);
    },

    "POST /api/sound": (_req, res) => {
        // Accept and ignore — just acknowledge
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
            spiffsUsed: rand(10000, 50000),
            spiffsTotal: 262144,
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

    "POST /api/system/reset": (_req, res) => {
        sendOk(res);
        setTimeout(() => {
            bootTime = Date.now();
        }, 2000);
    },

    "GET /api/settings": (_req, res) => {
        jsonResponse(res, {
            tz: state.tz,
            debugLog: state.debugLog,
            wifiTxPower: state.wifiTxPower,
            uartTxPin: state.uartTxPin,
            uartRxPin: state.uartRxPin,
            hostname: state.hostname,
        });
    },

    "GET /api/firmware/version": (_req, res) => {
        jsonResponse(res, { version: "0.0.0-dev" });
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
            if (data.debugLog !== undefined) state.debugLog = data.debugLog;
            if (data.wifiTxPower !== undefined) state.wifiTxPower = data.wifiTxPower;
            const pinsChanged =
                (data.uartTxPin !== undefined && data.uartTxPin !== state.uartTxPin) ||
                (data.uartRxPin !== undefined && data.uartRxPin !== state.uartRxPin);
            if (data.uartTxPin !== undefined) state.uartTxPin = data.uartTxPin;
            if (data.uartRxPin !== undefined) state.uartRxPin = data.uartRxPin;
            const hostnameChanged = data.hostname !== undefined && data.hostname !== state.hostname;
            if (data.hostname !== undefined) state.hostname = data.hostname;
            if (pinsChanged || hostnameChanged) {
                setTimeout(() => {
                    bootTime = Date.now();
                }, 2000);
            }
            return jsonResponse(res, {
                tz: state.tz,
                debugLog: state.debugLog,
                wifiTxPower: state.wifiTxPower,
                uartTxPin: state.uartTxPin,
                uartRxPin: state.uartRxPin,
                hostname: state.hostname,
            });
        } catch {
            return sendError(res, "invalid JSON", 400);
        }
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
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                // Only intercept /api/* requests
                if (!req.url.startsWith("/api")) return next();

                // Latency simulation (50-200ms)
                await new Promise((r) => setTimeout(r, rand(50, 200)));

                const handled = await handleRequest(req, res);
                if (handled === false) next();
            });
        },
    };
}

module.exports = { mockApiPlugin };
