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
//   "ok"  — Robot idle, online, battery 85%
//   "off" — Device unreachable (connection lost)
//   "shd" — Robot powered off (shutdown)
//   "cls" — House cleaning in progress
//   "spt" — Spot cleaning in progress
//   "chg" — On dock, charging, battery 62%
//   "ch2" — On dock, charging, battery 25%
//   "ful" — Fully charged, on dock, battery 100%
//   "mid" — Battery at 45%, not charging
//   "low" — Battery at 12%, not charging
//   "ded" — Battery empty (0%)
//   "err" — Robot has error (brush stuck)
const SCENARIO = "ok";

// --- Robot state ---

const SCENARIOS = {
    ok: {},
    off: { offline: true },
    shd: { uiState: "UIMGR_STATE_SHUTDOWN", robotState: "ST_C_Shutdown" },
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
    ...SCENARIOS[SCENARIO],
};

// Boot time for uptime calculation
const bootTime = Date.now();

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
    { name: "1699990000.jsonl.hs", size: 3584, compressed: true },
];

const mockLogContent = [
    '{"ts":1700000100,"type":"boot","msg":"startup","reason":"power_on"}',
    '{"ts":1700000101,"type":"wifi","msg":"connected","rssi":-52}',
    '{"ts":1700000102,"type":"ntp","msg":"synced","source":"pool.ntp.org"}',
    '{"ts":1700000200,"type":"command","cmd":"GetCharger","status":"ok","ms":85,"q":0,"bytes":312}',
    '{"ts":1700000202,"type":"command","cmd":"GetState","status":"ok","ms":42,"q":0,"bytes":95}',
    '{"ts":1700000210,"type":"request","method":"GET","path":"/api/charger","status":200,"ms":92}',
].join("\n");

// --- Derive UI/robot state from current state ---

const deriveStates = () => {
    if (state.uiState === "UIMGR_STATE_SHUTDOWN") return;
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
        deriveStates();
        jsonResponse(res, {
            uiState: state.uiState,
            robotState: state.robotState,
        });
    },

    "GET /api/error": (_req, res) => {
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
        state.cleaning = true;
        state.spotCleaning = false;
        deriveStates();
        sendOk(res);
    },

    "POST /api/clean/spot": (_req, res) => {
        state.spotCleaning = true;
        state.cleaning = false;
        deriveStates();
        sendOk(res);
    },

    "POST /api/clean/stop": (_req, res) => {
        state.cleaning = false;
        state.spotCleaning = false;
        deriveStates();
        sendOk(res);
    },

    "POST /api/sound": (_req, res) => {
        // Accept and ignore — just acknowledge
        sendOk(res);
    },

    // Power routes
    "POST /api/power/off": (_req, res) => {
        state.cleaning = false;
        state.spotCleaning = false;
        state.uiState = "UIMGR_STATE_SHUTDOWN";
        state.robotState = "ST_C_Shutdown";
        sendOk(res);
    },

    "POST /api/power/on": (_req, res) => {
        state.uiState = "UIMGR_STATE_IDLE";
        state.robotState = "ST_C_Idle";
        sendOk(res);
    },

    // Log routes
    "GET /api/logs": (_req, res) => {
        jsonResponse(res, mockLogs);
    },

    "DELETE /api/logs": (_req, res) => {
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

    "GET /api/timezone": (_req, res) => {
        jsonResponse(res, { tz: state.tz });
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
            res.writeHead(200, {
                "Content-Type": "application/x-ndjson",
                "Content-Disposition": `attachment; filename="${filename.replace(/\.hs$/, "")}"`,
            });
            return res.end(mockLogContent);
        }
        if (req.method === "DELETE") {
            return sendOk(res);
        }
        return sendError(res, "method not allowed", 405);
    }

    // PUT /api/timezone
    if (req.method === "PUT" && path === "/api/timezone") {
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            if (!data.tz) return sendError(res, "missing tz field", 400);
            state.tz = data.tz;
            return jsonResponse(res, { tz: state.tz });
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
