// Mock API server for Neato web UI development.
// Runs as a Vite plugin and delegates route behavior to shared-api.js so the
// Cloudflare demo Worker and local dev server stay aligned.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockApi } from "./shared-api.js";
import { createScenarioState, scenarioFromRequest } from "./shared-state.js";
import { DEFAULT_MOCK_VERSION, mockVersionFromHash } from "./shared-version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockSourceFiles = new Set([join(__dirname, "shared-api.js"), join(__dirname, "shared-state.js")]);

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const getVersion = () => {
    try {
        const hash = execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
        return mockVersionFromHash(hash);
    } catch {
        return DEFAULT_MOCK_VERSION;
    }
};

const sendResponse = (res, response) => {
    const headers = { ...response.headers };
    if (response.body !== undefined && !headers["Content-Length"]) {
        headers["Content-Length"] = Buffer.byteLength(response.body);
    }
    res.writeHead(response.status, headers);
    res.end(response.body ?? "");
};

// Request logging - captures original writeHead to log via Vite's logger.
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

const readBodyBytes = (req) =>
    new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
    });

const createRequestAdapter = (req, parsed) => {
    let cachedBody = null;
    const bytes = async () => {
        cachedBody ??= await readBodyBytes(req);
        return cachedBody;
    };
    return {
        method: req.method,
        path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        bytes,
        text: async () => (await bytes()).toString("utf8"),
    };
};

// Select scenarios with ?scenario=err|fa. The page stores it in a cookie so
// subsequent SPA API calls keep using the selected mock state.
let initializedScenario = null;
let bootTime = Date.now();

const lidarScans = readdirSync(__dirname)
    .filter((f) => f.startsWith("lidar-scan") && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(__dirname, f), "utf8")));
let lidarScanIndex = 0;

const getLidarScan = () => {
    const scan = lidarScans[lidarScanIndex];
    lidarScanIndex = (lidarScanIndex + 1) % lidarScans.length;
    return scan;
};

const loadHistorySessions = () => {
    const sessions = new Map();

    for (const f of readdirSync(__dirname)
        .filter((n) => n.startsWith("mapdata-") && n.endsWith(".jsonl"))
        .sort()) {
        const lines = readFileSync(join(__dirname, f), "utf8")
            .trim()
            .split("\n")
            .filter((line) => line.length > 0);
        sessions.set(f, lines);
    }

    return sessions;
};

const context = {
    state: {},
    faults: {},
    historySessions: loadHistorySessions(),
    rand,
    getVersion,
    getLidarScan,
    getBootTime: () => bootTime,
    reboot: () => {
        setTimeout(() => {
            bootTime = Date.now();
        }, 2000);
    },
    shutdown: () => setTimeout(() => process.exit(0), 500),
    md5Hex: (bytes) => createHash("md5").update(Buffer.from(bytes)).digest("hex"),
};

const initScenario = (scenario) => {
    if (scenario === initializedScenario) return;
    const scenarioState = createScenarioState(scenario);
    context.state = scenarioState.state;
    context.faults = scenarioState.faults;
    context.historySessions = loadHistorySessions();
    bootTime = Date.now();
    initializedScenario = scenario;
};

initScenario("ok");

const recordingFile = [...context.historySessions.entries()].find(
    ([, lines]) => !lines.some((line) => line.includes('"type":"summary"')),
);

if (recordingFile) {
    const [recordingName, recordingLines] = recordingFile;
    const lastPose = [...recordingLines].reverse().find((line) => line.includes('"x":'));
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
        const lines = context.historySessions.get(recordingName);
        if (lines.length > 1) lines.splice(1, 1);
        lines.push(`{"x":${simX.toFixed(3)},"y":${simY.toFixed(3)},"t":${simT.toFixed(1)},"ts":${simTs.toFixed(1)}}`);
    }, 2000);
}

const api = createMockApi(context);

const handleRequest = async (req, res) => {
    const parsed = new URL(req.url, "http://localhost");
    initScenario(scenarioFromRequest(parsed.searchParams, req.headers.cookie));
    const response = await api.handle(createRequestAdapter(req, parsed));
    if (response === false) return false;
    if (response.offline) {
        req.destroy();
        return;
    }
    sendResponse(res, response);
};

function mockApiPlugin() {
    return {
        name: "mock-api",
        transformIndexHtml(html) {
            return html.replace(
                "</head>",
                `<script>(()=>{const p=new URLSearchParams(location.search);const s=p.get("scenario");if(s)document.cookie="openneato_scenario="+encodeURIComponent(s)+"; Path=/; SameSite=Lax";const active=s||document.cookie.split("; ").find((v)=>v.startsWith("openneato_scenario="))?.split("=").slice(1).join("=");const scenario=active?decodeURIComponent(active):"ok";if(!scenario.split("|").includes("upd")){localStorage.removeItem("update_latest_version");localStorage.removeItem("update_last_check");}})();</script></head>`,
            );
        },
        configureServer(server) {
            viteLogger = server.config.logger;
            server.watcher.on("change", (file) => {
                if (!mockSourceFiles.has(file)) return;
                viteLogger?.info(`mock source changed, restarting dev server: ${file}`, { timestamp: true });
                if (typeof server.restart === "function") {
                    void server.restart();
                }
            });
            server.middlewares.use(async (req, res, next) => {
                if (!req.url.startsWith("/api") && !req.url.startsWith("/repos")) return next();

                logRequest(req, res);
                await new Promise((resolve) => setTimeout(resolve, rand(50, 200)));

                const handled = await handleRequest(req, res);
                if (handled === false) next();
            });
        },
    };
}

export { mockApiPlugin };
