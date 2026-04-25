// Shared helpers for history views

import clockSvg from "../../assets/icons/clock.svg?raw";
import houseSvg from "../../assets/icons/house.svg?raw";
import manualSvg from "../../assets/icons/manual.svg?raw";
import spotSvg from "../../assets/icons/spot.svg?raw";
import type { MapBounds, MapData, MapPathPoint, MapTransform } from "../../types";
import { pad2 } from "../../utils";

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

export function formatDuration(secs: number): string {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// Playback clock format — M:SS, or H:MM:SS past the hour mark.
export function formatClock(secs: number): string {
    const total = Math.max(0, Math.floor(secs));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function formatDate(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

    // Coverage cells — filtered by timestamp during playback
    const cellPx = map.cellSize * scale;
    ctx.fillStyle = isDark ? "rgba(52, 199, 89, 0.15)" : "rgba(22, 130, 50, 0.22)";
    for (const cell of map.coverage) {
        const [cx, cy, ts] = cell;
        if (ts > tNow) continue;
        const wx = cx * map.cellSize;
        const wy = cy * map.cellSize;
        ctx.fillRect(toX(wx) - cellPx / 2, toY(wy) - cellPx / 2, cellPx, cellPx);
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
