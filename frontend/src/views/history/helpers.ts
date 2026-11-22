// Shared helpers for history views

import clockSvg from "../../assets/icons/clock.svg?raw";
import houseSvg from "../../assets/icons/house.svg?raw";
import manualSvg from "../../assets/icons/manual.svg?raw";
import spotSvg from "../../assets/icons/spot.svg?raw";
import type { MapBounds, MapData, MapPathPoint, MapTransform } from "../../types";

const DEFAULT_TRANSFORM: MapTransform = { panX: 0, panY: 0, zoom: 1 };
const MAP_PAD = 20;
const GRID_STEP = 0.5;

export interface MapProjection {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    scale: number;
    toX: (wx: number) => number;
    toY: (wy: number) => number;
}

// World-to-canvas projection used by the static renderer and the loading wave.
// `pad` is in display pixels; the world is centered within the available area.
export function computeMapProjection(displayW: number, displayH: number, bounds: MapBounds): MapProjection {
    const { minX, maxX, minY, maxY } = bounds;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    const availW = displayW - MAP_PAD * 2;
    const availH = displayH - MAP_PAD * 2;
    const scale = Math.min(availW / worldW, availH / worldH);
    const offX = MAP_PAD + (availW - worldW * scale) / 2;
    const offY = MAP_PAD + (availH - worldH * scale) / 2;
    return {
        minX,
        maxX,
        minY,
        maxY,
        scale,
        toX: (wx) => offX + (wx - minX) * scale,
        toY: (wy) => offY + (maxY - wy) * scale,
    };
}

// 0.5m background grid. Same look in both the static map and the wave reveal.
export function drawMapGrid(ctx: CanvasRenderingContext2D, proj: MapProjection, isDark: boolean): void {
    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.06)";
    ctx.lineWidth = 1;
    const { minX, maxX, minY, maxY, toX, toY } = proj;
    for (let gx = Math.floor(minX / GRID_STEP) * GRID_STEP; gx <= maxX; gx += GRID_STEP) {
        ctx.beginPath();
        ctx.moveTo(toX(gx), toY(minY));
        ctx.lineTo(toX(gx), toY(maxY));
        ctx.stroke();
    }
    for (let gy = Math.floor(minY / GRID_STEP) * GRID_STEP; gy <= maxY; gy += GRID_STEP) {
        ctx.beginPath();
        ctx.moveTo(toX(minX), toY(gy));
        ctx.lineTo(toX(maxX), toY(gy));
        ctx.stroke();
    }
}

export function isDarkSurface(canvas: HTMLCanvasElement): boolean {
    return getComputedStyle(canvas).getPropertyValue("--surface").trim().startsWith("#1");
}

// -- WiFi signal layer -------------------------------------------------------

export type SignalBand = "good" | "fair" | "weak" | "poor" | "off";

// Band edges in dBm. Kept in one place so the legend text and the colour
// thresholds cannot drift apart.
const GOOD_MIN_DBM = -60;
const FAIR_MIN_DBM = -70;
const WEAK_MIN_DBM = -80;

// Fill colours stay semi-transparent so the path and map grid remain visible
// underneath. Thresholds are coarse on purpose: RSSI is smoothed and noisy, so
// a gradient would imply survey-grade precision the data does not have.
const SIGNAL_RGB_DARK: Record<SignalBand, string> = {
    good: "52, 199, 89",
    fair: "255, 204, 0",
    weak: "255, 149, 0",
    poor: "255, 69, 58",
    off: "142, 142, 147",
};

// Light surfaces need darker, slightly stronger fills to stay legible.
const SIGNAL_RGB_LIGHT: Record<SignalBand, string> = {
    good: "22, 130, 50",
    fair: "191, 144, 0",
    weak: "214, 106, 0",
    poor: "214, 45, 35",
    off: "110, 110, 118",
};

const SIGNAL_ALPHA_DARK: Record<SignalBand, number> = {
    good: 0.42,
    fair: 0.42,
    weak: 0.46,
    poor: 0.46,
    off: 0.45,
};

const SIGNAL_ALPHA_LIGHT: Record<SignalBand, number> = {
    good: 0.45,
    fair: 0.48,
    weak: 0.48,
    poor: 0.48,
    off: 0.45,
};

// Shared by the settled map renderer and the loading-wave reveal. `scale`
// lowers the opacity while a cell fades in.
export function signalFill(band: SignalBand, isDark: boolean, scale = 1): string {
    const rgb = (isDark ? SIGNAL_RGB_DARK : SIGNAL_RGB_LIGHT)[band];
    const alpha = (isDark ? SIGNAL_ALPHA_DARK : SIGNAL_ALPHA_LIGHT)[band] * scale;
    return `rgba(${rgb}, ${alpha.toFixed(3)})`;
}

function signalColors(isDark: boolean): Record<SignalBand, string> {
    return {
        good: signalFill("good", isDark),
        fair: signalFill("fair", isDark),
        weak: signalFill("weak", isDark),
        poor: signalFill("poor", isDark),
        off: signalFill("off", isDark),
    };
}

export function signalBand(rssi: number | undefined): SignalBand {
    if (rssi === undefined || rssi === 0) return "off";
    if (rssi >= GOOD_MIN_DBM) return "good";
    if (rssi >= FAIR_MIN_DBM) return "fair";
    if (rssi >= WEAK_MIN_DBM) return "weak";
    return "poor";
}

// Human-readable band bounds for the legend. Symbols and numbers only, so the
// text needs no translation; the unit is dBm.
export function signalBandRange(band: SignalBand): string {
    if (band === "good") return `≥ ${GOOD_MIN_DBM} dBm`;
    if (band === "fair") return `${GOOD_MIN_DBM} … ${FAIR_MIN_DBM} dBm`;
    if (band === "weak") return `${FAIR_MIN_DBM} … ${WEAK_MIN_DBM} dBm`;
    if (band === "poor") return `< ${WEAK_MIN_DBM} dBm`;
    return "";
}

export interface SignalStats {
    // Worst decibel reading; 0 when every sample was disconnected.
    worst: number;
    samples: number;
    disconnected: number;
}

export function signalStats(map: MapData): SignalStats | null {
    let worst = 0;
    let samples = 0;
    let disconnected = 0;
    for (const p of map.path) {
        if (p.r === undefined) continue;
        samples++;
        if (p.r === 0) {
            disconnected++;
            continue;
        }
        if (p.r < worst) worst = p.r;
    }
    return samples > 0 ? { worst, samples, disconnected } : null;
}

// RSSI at (or just before) a session-relative timestamp, for the live badge in
// the player. Walks back over poses that predate signal sampling.
const RSSI_LOOKBACK = 120; // poses; ~4 min at the 2 s sampling interval

export function rssiAt(path: MapPathPoint[], ts: number): number | undefined {
    let lo = 0;
    let hi = path.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (path[mid].ts <= ts) lo = mid;
        else hi = mid - 1;
    }
    for (let i = lo; i >= 0 && i > lo - RSSI_LOOKBACK; i--) {
        if (path[i].r !== undefined) return path[i].r;
    }
    return undefined;
}

export function modeInfo(mode: string): { label: string; icon: string } {
    if (mode === "house") return { label: "House Clean", icon: houseSvg };
    if (mode === "spot") return { label: "Spot Clean", icon: spotSvg };
    if (mode === "manual") return { label: "Manual Clean", icon: manualSvg };
    return { label: mode, icon: clockSvg };
}

// Total session duration derived from the map data. Prefers the summary
// value written by the firmware, falls back to the last pose timestamp.
export function sessionDuration(map: MapData): number {
    if (map.summary?.duration && map.summary.duration > 0) return map.summary.duration;
    if (map.path.length > 0) return map.path[map.path.length - 1].ts;
    return 0;
}

// Shortest-arc interpolation between two headings in degrees.
function lerpAngleDeg(a: number, b: number, f: number): number {
    const delta = ((b - a + 540) % 360) - 180;
    return a + delta * f;
}

// Interpolate robot pose at a given session-relative timestamp. Returns
// null when the path is empty. Uses linear interpolation for x/y and
// shortest-arc interpolation for the heading so the sprite never snaps.
export function interpolatePose(
    path: MapPathPoint[],
    ts: number,
): { x: number; y: number; t: number; ts: number } | null {
    if (path.length === 0) return null;
    if (ts <= path[0].ts) return { ...path[0] };
    const last = path[path.length - 1];
    if (ts >= last.ts) return { ...last };

    // Binary search for the segment containing ts
    let lo = 0;
    let hi = path.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (path[mid].ts <= ts) lo = mid;
        else hi = mid;
    }

    const a = path[lo];
    const b = path[hi];
    const span = b.ts - a.ts;
    const f = span > 0 ? (ts - a.ts) / span : 0;
    return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        t: lerpAngleDeg(a.t, b.t, f),
        ts,
    };
}

// Canvas renderer for map visualization. When `currentTime` is provided the
// renderer draws only the portion of the session up to that timestamp and
// shows the interpolated robot pose as a directional sprite — used by the
// motion player. Without `currentTime` the full static map is drawn.
// `rotation` rotates the map content around the canvas center (degrees, 0/90/180/270).
export function renderMap(
    canvas: HTMLCanvasElement,
    map: MapData,
    recording = false,
    tf?: MapTransform,
    currentTime?: number,
    rotation = 0,
    showSignal = false,
) {
    const ctx = canvas.getContext("2d");
    if (!ctx || !map.bounds) return;

    const { panX, panY, zoom } = tf ?? DEFAULT_TRANSFORM;
    const playing = currentTime !== undefined;
    const tNow = currentTime ?? Number.POSITIVE_INFINITY;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.scale(dpr, dpr);

    // Fill the unrotated background first so rotation doesn't expose the
    // underlying transparent canvas at the corners.
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--surface").trim() || "#1a1a1c";
    ctx.fillRect(0, 0, displayW, displayH);

    // Rotate the map content around the canvas center. Pan/zoom are applied
    // in the rotated coordinate space so gestures stay aligned with the
    // visible orientation (handled in useMapGestures).
    if (rotation) {
        ctx.translate(displayW / 2, displayH / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-displayW / 2, -displayH / 2);
    }

    // Apply zoom + pan: zoom from top-left origin, panX/panY computed by
    // useMapGestures already account for the cursor-relative zoom anchor.
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const proj = computeMapProjection(displayW, displayH, map.bounds);
    const { scale, toX, toY } = proj;
    const isDark = isDarkSurface(canvas);

    // Grid lines - draw first so coverage/path render on top
    drawMapGrid(ctx, proj, isDark);

    // Coverage or signal cells — filtered by timestamp during playback. The
    // signal layer replaces coverage instead of stacking on it: overlapping
    // translucent fills would muddle the band colours.
    if (showSignal && map.signals.length > 0) {
        const cellPx = map.signalCellSize * scale;
        const colors = signalColors(isDark);
        for (const cell of map.signals) {
            const [cx, cy, rssi, ts] = cell;
            if (ts > tNow) continue;
            ctx.fillStyle = colors[signalBand(rssi)];
            const wx = cx * map.signalCellSize;
            const wy = cy * map.signalCellSize;
            ctx.fillRect(toX(wx) - cellPx / 2, toY(wy) - cellPx / 2, cellPx, cellPx);
        }
    } else {
        const cellPx = map.cellSize * scale;
        ctx.fillStyle = isDark ? "rgba(52, 199, 89, 0.15)" : "rgba(22, 130, 50, 0.22)";
        for (const cell of map.coverage) {
            const [cx, cy, ts] = cell;
            if (ts > tNow) continue;
            const wx = cx * map.cellSize;
            const wy = cy * map.cellSize;
            ctx.fillRect(toX(wx) - cellPx / 2, toY(wy) - cellPx / 2, cellPx, cellPx);
        }
    }

    // Resolve the subset of path points to draw and the current robot pose
    // when playing. During playback we cut the path at `tNow` and append
    // an interpolated endpoint so the line keeps up with the robot sprite.
    let pathEnd = map.path.length;
    let liveHead: { x: number; y: number; t: number; ts: number } | null = null;
    if (playing) {
        pathEnd = 0;
        while (pathEnd < map.path.length && map.path[pathEnd].ts <= tNow) pathEnd++;
        liveHead = interpolatePose(map.path, tNow);
    }

    // Path line
    const drawnPath: { x: number; y: number; ts: number }[] = [];
    for (let i = 0; i < pathEnd; i++) drawnPath.push(map.path[i]);
    if (playing && liveHead && (drawnPath.length === 0 || drawnPath[drawnPath.length - 1].ts !== liveHead.ts)) {
        drawnPath.push(liveHead);
    }

    if (drawnPath.length > 1) {
        ctx.beginPath();
        ctx.moveTo(toX(drawnPath[0].x), toY(drawnPath[0].y));
        for (let i = 1; i < drawnPath.length; i++) {
            ctx.lineTo(toX(drawnPath[i].x), toY(drawnPath[i].y));
        }
        ctx.strokeStyle = isDark ? "rgba(249, 235, 178, 0.6)" : "rgba(180, 140, 40, 0.5)";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
    }

    // Start point
    if (map.path.length > 0) {
        const start = map.path[0];
        ctx.beginPath();
        ctx.arc(toX(start.x), toY(start.y), 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(52, 199, 89, 0.9)";
        ctx.fill();
    }

    // End point / animated robot sprite
    if (playing && liveHead) {
        drawRobotSprite(ctx, toX(liveHead.x), toY(liveHead.y), liveHead.t);
    } else if (map.path.length > 1) {
        const end = map.path[map.path.length - 1];
        const ex = toX(end.x);
        const ey = toY(end.y);
        if (recording) {
            ctx.save();
            ctx.shadowColor = "rgba(52, 199, 89, 0.6)";
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(ex, ey, 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(52, 199, 89, 0.9)";
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(ex, ey, 5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 69, 58, 0.9)";
            ctx.fill();
        }
    }

    // Recharge points (bolt icon with glow) — hidden until reached during playback
    for (const rp of map.recharges) {
        if (rp.ts > tNow) continue;
        const rx = toX(rp.x);
        const ry = toY(rp.y);
        const s = 10;
        const drawBolt = () => {
            ctx.beginPath();
            ctx.moveTo(rx + s * 0.15, ry - s);
            ctx.lineTo(rx - s * 0.55, ry + s * 0.05);
            ctx.lineTo(rx - s * 0.05, ry + s * 0.05);
            ctx.lineTo(rx - s * 0.15, ry + s);
            ctx.lineTo(rx + s * 0.55, ry - s * 0.05);
            ctx.lineTo(rx + s * 0.05, ry - s * 0.05);
            ctx.closePath();
        };
        ctx.save();
        ctx.shadowColor = "rgba(255, 204, 0, 0.7)";
        ctx.shadowBlur = 8;
        drawBolt();
        ctx.fillStyle = "rgba(255, 204, 0, 1)";
        ctx.fill();
        ctx.restore();
        drawBolt();
        ctx.strokeStyle = isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

// Draws the animated robot sprite: a filled circle with a small nose pointing
// in the heading direction. Theta is in degrees, 0 = +X axis (canvas right),
// increasing counter-clockwise in world coordinates, so we flip the sign when
// applying it to screen coordinates (Y axis is inverted by toY).
function drawRobotSprite(ctx: CanvasRenderingContext2D, x: number, y: number, thetaDeg: number) {
    const radius = 7;
    const screenAngle = -(thetaDeg * Math.PI) / 180;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(screenAngle);

    // Heading wedge behind the body so it reads as a direction arrow
    ctx.beginPath();
    ctx.moveTo(radius + 5, 0);
    ctx.lineTo(radius * 0.6, -radius * 0.7);
    ctx.lineTo(radius * 0.6, radius * 0.7);
    ctx.closePath();
    ctx.fillStyle = "rgba(52, 199, 89, 0.95)";
    ctx.fill();

    // Body
    ctx.shadowColor = "rgba(52, 199, 89, 0.6)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(52, 199, 89, 0.95)";
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner dot for contrast
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fill();

    ctx.restore();
}
