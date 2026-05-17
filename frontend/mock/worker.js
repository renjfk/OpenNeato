import { DEMO_VERSION } from "./build-info.js";
import mapdataEmpty04 from "./mapdata-empty-04.jsonl";
import mapdataHouse03 from "./mapdata-house-03.jsonl";
import mapdataSpot01 from "./mapdata-spot-01.jsonl";
import mapdataSpot02 from "./mapdata-spot-02.jsonl";
import { createMockApi } from "./shared-api.js";
import { createScenarioState, scenarioCookie, scenarioFromRequest } from "./shared-state.js";

const UMAMI_ENDPOINT = "https://cloud.umami.is/api/send";
const WEBSITE_ID = "417b882b-03c5-45d2-b070-9d7b8b7855d4";

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const err = (message, status = 500) => json({ error: message }, status);

const historyFixtures = [
    ["mapdata-empty-04.jsonl", mapdataEmpty04],
    ["mapdata-house-03.jsonl", mapdataHouse03],
    ["mapdata-spot-01.jsonl", mapdataSpot01],
    ["mapdata-spot-02.jsonl", mapdataSpot02],
];

async function handleCollect(request) {
    try {
        const form = await request.formData();
        const hostname = new URL(request.url).hostname;

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

function resetRecordingSimulation() {
    const recordingFile = [...context.historySessions.entries()].find(
        ([, lines]) => !lines.some((line) => line.includes('"type":"summary"')),
    );
    if (!recordingFile) {
        recordingSimulation = null;
        return;
    }

    const [recordingName, recordingLines] = recordingFile;
    const lastPose = [...recordingLines].reverse().find((line) => line.includes('"x":'));
    const pos = lastPose ? JSON.parse(lastPose) : { x: 0, y: 0, t: 0, ts: 7244 };
    recordingSimulation = {
        name: recordingName,
        x: pos.x,
        y: pos.y,
        t: pos.t,
        ts: pos.ts,
        lastUpdate: Date.now(),
    };
}

function updateRecordingSession() {
    if (!recordingSimulation) return;
    const elapsed = Math.floor((Date.now() - recordingSimulation.lastUpdate) / 2000);
    if (elapsed <= 0) return;
    recordingSimulation.lastUpdate += elapsed * 2000;

    const lines = context.historySessions.get(recordingSimulation.name);
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

let initializedScenario = null;
let bootTime = Date.now();
let recordingSimulation = null;
const context = {
    state: {},
    faults: {},
    historySessions: new Map(),
    rand: randomInt,
    sleep,
    getVersion: () => DEMO_VERSION,
    getBootTime: () => bootTime,
    reboot: () => {
        bootTime = Date.now();
    },
};

const api = createMockApi(context);

function initScenario(rawScenario) {
    const scenario = rawScenario.trim() || "ok";
    const scenarioState = createScenarioState(scenario);
    context.state = scenarioState.state;
    context.faults = scenarioState.faults;
    context.historySessions = createDefaultHistory();
    bootTime = Date.now();
    initializedScenario = scenario;
    resetRecordingSimulation();
}

initScenario("ok");

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
    const scenario = scenarioFromRequest(url.searchParams, request.headers.get("Cookie") ?? "");
    if (scenario !== initializedScenario) initScenario(scenario);
    updateRecordingSession();

    await sleep(randomInt(50, 200));

    const demoMode = (env.DEMO_MODE ?? "true").toLowerCase() === "true";

    if (demoMode && request.method === "POST" && url.pathname === "/api/firmware/update") {
        return err("Firmware upload is disabled in demo mode", 403);
    }
    if (demoMode && request.method === "POST" && url.pathname === "/api/history/import") {
        return err("Session import is disabled in demo mode", 403);
    }

    let cachedBytes = null;
    const bytes = async () => {
        cachedBytes ??= new Uint8Array(await request.arrayBuffer());
        return cachedBytes;
    };

    const response = toWorkerResponse(
        await api.handle({
            method: request.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            bytes,
            text: async () => new TextDecoder().decode(await bytes()),
        }),
    );
    if (url.searchParams.has("scenario")) response.headers.set("Set-Cookie", scenarioCookie(scenario));
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
        if (request.method === "POST" && url.pathname === "/api/collect") return handleCollect(request);
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/repos/")) return handleApi(request, env);
        return serveAsset(request, env);
    },
};
