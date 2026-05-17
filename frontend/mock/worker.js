import { DEMO_VERSION } from "./build-info.js";
import mapdataEmpty04 from "./mapdata-empty-04.jsonl";
import mapdataHouse03 from "./mapdata-house-03.jsonl";
import mapdataSpot01 from "./mapdata-spot-01.jsonl";
import mapdataSpot02 from "./mapdata-spot-02.jsonl";
import { createMockApi } from "./shared-api.js";
import { createScenarioState, scenarioCookie, scenarioFromRequest } from "./shared-state.js";

const UMAMI_ENDPOINT = "https://cloud.umami.is/api/send";
const WEBSITE_ID = "417b882b-03c5-45d2-b070-9d7b8b7855d4";
const SESSION_COOKIE = "openneato_demo_session";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 60 * 60 * 1000;

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const err = (message, status = 500) => json({ error: message }, status);

const SECURITY_HEADERS = {
    "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join("; "),
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
};

const withSecurityHeaders = (response) => {
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
    return secured;
};

const parseCookieValue = (cookieHeader, name) => {
    for (const part of cookieHeader.split(";")) {
        const [rawName, ...rawValue] = part.trim().split("=");
        if (rawName !== name) continue;
        try {
            return decodeURIComponent(rawValue.join("="));
        } catch {
            return "";
        }
    }
    return "";
};

const sessionCookie = (id) =>
    `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=3600; SameSite=Lax; HttpOnly; Secure`;

async function checkAnalyticsRateLimit(request, env) {
    if (!env.ANALYTICS_RATE_LIMITER) return null;

    const cookieSession = parseCookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE);
    const clientId = cookieSession || request.headers.get("CF-Connecting-IP") || "anonymous";
    const { success } = await env.ANALYTICS_RATE_LIMITER.limit({ key: `collect:${clientId}` });
    if (success) return null;

    return new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
    });
}

async function readBodyWithLimit(request) {
    if (!request.body) return new Uint8Array();

    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
            await reader.cancel();
            throw new Error("Request body too large");
        }
        chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

const historyFixtures = [
    ["mapdata-empty-04.jsonl", mapdataEmpty04],
    ["mapdata-house-03.jsonl", mapdataHouse03],
    ["mapdata-spot-01.jsonl", mapdataSpot01],
    ["mapdata-spot-02.jsonl", mapdataSpot02],
];

async function handleCollect(request, env) {
    try {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin");
        if (origin) {
            let originHost = "";
            try {
                originHost = new URL(origin).host;
            } catch {
                return new Response(null, { status: 403 });
            }
            if (originHost !== url.host) return new Response(null, { status: 403 });
        }
        const contentLength = Number(request.headers.get("Content-Length") || "0");
        if (contentLength > MAX_BODY_BYTES) return new Response(null, { status: 413 });

        const rateLimited = await checkAnalyticsRateLimit(request, env);
        if (rateLimited) return rateLimited;

        const formRequest = new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body: await readBodyWithLimit(request),
        });
        const form = await formRequest.formData();
        const hostname = url.hostname;

        const response = await fetch(UMAMI_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
            },
            body: JSON.stringify({
                type: "event",
                payload: {
                    website: WEBSITE_ID,
                    hostname,
                    ip: request.headers.get("CF-Connecting-IP") || undefined,
                    screen: form.get("s") || "",
                    language: form.get("l") || "",
                    title: form.get("t") || "",
                    url: form.get("u") || "",
                    referrer: form.get("r") || "",
                },
            }),
        });

        return new Response(null, { status: response.ok ? 204 : 502 });
    } catch (error) {
        console.error("[Analytics]", error);
        return new Response(null, { status: 502 });
    }
}

const createDefaultHistory = () => {
    return new Map(
        historyFixtures.map(([name, content]) => [
            name,
            content
                .trim()
                .split("\n")
                .filter((line) => line.length > 0),
        ]),
    );
};

function resetRecordingSimulation(session) {
    const recordingFile = [...session.context.historySessions.entries()].find(
        ([, lines]) => !lines.some((line) => line.includes('"type":"summary"')),
    );
    if (!recordingFile) {
        session.recordingSimulation = null;
        return;
    }

    const [recordingName, recordingLines] = recordingFile;
    const lastPose = [...recordingLines].reverse().find((line) => line.includes('"x":'));
    const pos = lastPose ? JSON.parse(lastPose) : { x: 0, y: 0, t: 0, ts: 7244 };
    session.recordingSimulation = {
        name: recordingName,
        x: pos.x,
        y: pos.y,
        t: pos.t,
        ts: pos.ts,
        lastUpdate: Date.now(),
    };
}

function updateRecordingSession(session) {
    const recordingSimulation = session.recordingSimulation;
    if (!recordingSimulation) return;
    const elapsed = Math.floor((Date.now() - recordingSimulation.lastUpdate) / 2000);
    if (elapsed <= 0) return;
    recordingSimulation.lastUpdate += elapsed * 2000;

    const lines = session.context.historySessions.get(recordingSimulation.name);
    if (!lines) return;

    for (let i = 0; i < elapsed; i++) {
        recordingSimulation.t += (Math.random() - 0.5) * 30;
        if (recordingSimulation.t < 0) recordingSimulation.t += 360;
        if (recordingSimulation.t >= 360) recordingSimulation.t -= 360;
        const rad = (recordingSimulation.t * Math.PI) / 180;
        const step = 0.08 + Math.random() * 0.12;
        recordingSimulation.x += Math.cos(rad) * step;
        recordingSimulation.y -= Math.sin(rad) * step;
        recordingSimulation.ts += 2.0 + Math.random() * 0.3;
        if (lines.length > 1) lines.splice(1, 1);
        lines.push(
            `{"x":${recordingSimulation.x.toFixed(3)},"y":${recordingSimulation.y.toFixed(3)},"t":${recordingSimulation.t.toFixed(1)},"ts":${recordingSimulation.ts.toFixed(1)}}`,
        );
    }
}

const sessions = new Map();

function createSession(id) {
    const session = {
        id,
        api: null,
        context: null,
        initializedScenario: null,
        bootTime: Date.now(),
        lastAccess: Date.now(),
        recordingSimulation: null,
    };
    session.context = {
        state: {},
        faults: {},
        historySessions: new Map(),
        rand: randomInt,
        sleep,
        getVersion: () => DEMO_VERSION,
        getBootTime: () => session.bootTime,
        reboot: () => {
            session.bootTime = Date.now();
        },
    };
    session.api = createMockApi(session.context);
    initScenario(session, "ok");
    return session;
}

function pruneSessions(now) {
    for (const [id, session] of sessions) {
        if (now - session.lastAccess > SESSION_TTL_MS) sessions.delete(id);
    }
    while (sessions.size > MAX_SESSIONS) {
        let oldestId = null;
        let oldestAccess = Infinity;
        for (const [id, session] of sessions) {
            if (session.lastAccess < oldestAccess) {
                oldestId = id;
                oldestAccess = session.lastAccess;
            }
        }
        if (!oldestId) break;
        sessions.delete(oldestId);
    }
}

function getSession(request) {
    const now = Date.now();
    pruneSessions(now);

    const cookieHeader = request.headers.get("Cookie") ?? "";
    let id = parseCookieValue(cookieHeader, SESSION_COOKIE);
    let isNew = false;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
        id = crypto.randomUUID();
        isNew = true;
    }

    let session = sessions.get(id);
    if (!session) {
        session = createSession(id);
        sessions.set(id, session);
        isNew = true;
    }
    session.lastAccess = now;
    return { session, isNew };
}

function initScenario(session, rawScenario) {
    const scenario = rawScenario.trim() || "ok";
    if (scenario === session.initializedScenario) return;
    const scenarioState = createScenarioState(scenario);
    session.context.state = scenarioState.state;
    session.context.faults = scenarioState.faults;
    session.context.historySessions = createDefaultHistory();
    session.bootTime = Date.now();
    session.initializedScenario = scenario;
    resetRecordingSimulation(session);
}

function isBlockedDemoEndpoint(method, path, query) {
    if (method === "DELETE") return true;
    if (method !== "POST") return false;
    if (path === "/api/firmware/update" || path === "/api/history/import") return true;
    if (["/api/system/restart", "/api/system/format-fs", "/api/system/reset"].includes(path)) return true;
    return path === "/api/power" && ["restart", "shutdown"].includes(query.action || "");
}

function scenarioForRequest(url, request) {
    try {
        return scenarioFromRequest(url.searchParams, request.headers.get("Cookie") ?? "");
    } catch {
        return (url.searchParams.get("scenario") || "ok").trim() || "ok";
    }
}

const toWorkerResponse = (response) => {
    if (response === false) return err("not found", 404);
    if (response.offline) return err("Device unreachable", 503);
    return new Response(response.body ?? "", {
        status: response.status,
        headers: response.headers,
    });
};

async function handleApi(request, env) {
    const url = new URL(request.url);
    const { session, isNew } = getSession(request);
    const scenario = scenarioForRequest(url, request);
    initScenario(session, scenario);
    updateRecordingSession(session);

    await sleep(randomInt(50, 200));

    const demoMode = (env.DEMO_MODE ?? "true").toLowerCase() === "true";
    const query = Object.fromEntries(url.searchParams);

    if (demoMode && isBlockedDemoEndpoint(request.method, url.pathname, query)) {
        const response = err("This action is disabled in demo mode", 403);
        if (isNew) response.headers.append("Set-Cookie", sessionCookie(session.id));
        if (url.searchParams.has("scenario")) response.headers.append("Set-Cookie", scenarioCookie(scenario));
        return response;
    }

    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
        const response = err("Request body too large", 413);
        if (isNew) response.headers.append("Set-Cookie", sessionCookie(session.id));
        if (url.searchParams.has("scenario")) response.headers.append("Set-Cookie", scenarioCookie(scenario));
        return response;
    }

    let cachedBytes = null;
    const bytes = async () => {
        cachedBytes ??= await readBodyWithLimit(request);
        return cachedBytes;
    };

    let response;
    try {
        response = toWorkerResponse(
            await session.api.handle({
                method: request.method,
                path: url.pathname,
                query,
                bytes,
                text: async () => new TextDecoder().decode(await bytes()),
            }),
        );
    } catch (error) {
        response = error.message === "Request body too large" ? err(error.message, 413) : err("Internal error", 500);
    }
    if (isNew) response.headers.append("Set-Cookie", sessionCookie(session.id));
    if (url.searchParams.has("scenario")) response.headers.append("Set-Cookie", scenarioCookie(scenario));
    return response;
}

async function serveAsset(request, env) {
    const url = new URL(request.url);
    const scenario = url.searchParams.get("scenario");
    const rawAssetResponse = await env.ASSETS.fetch(request);
    const assetResponse = new Response(rawAssetResponse.body, rawAssetResponse);
    if (scenario) assetResponse.headers.set("Set-Cookie", scenarioCookie(scenario));
    if (assetResponse.status !== 404) return assetResponse;

    const indexRequest = new Request(new URL("/index.html", url).toString(), request);
    const rawIndexResponse = await env.ASSETS.fetch(indexRequest);
    const indexResponse = new Response(rawIndexResponse.body, rawIndexResponse);
    if (scenario) indexResponse.headers.set("Set-Cookie", scenarioCookie(scenario));
    if (indexResponse.status !== 404) return indexResponse;
    return assetResponse;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/api/collect") {
            return withSecurityHeaders(await handleCollect(request, env));
        }
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/repos/")) {
            return withSecurityHeaders(await handleApi(request, env));
        }
        return withSecurityHeaders(await serveAsset(request, env));
    },
};
