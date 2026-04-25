// Loading + reveal wave animation for the cleaning history map.
//
// Two phases share one rAF loop and one pulse pool so the loading ->
// revealing transition has no visual cut:
//   1. LOADING: small noisy pulses ripple outward from near canvas center
//      and fade out. Repeats until startReveal() or cancel().
//   2. REVEAL: startReveal() spawns a "carrier" pulse at center. It looks
//      like a loading pulse at birth but lives long enough to traverse
//      the whole canvas and gradually fattens as it travels. Coverage
//      cells, the path, and start/end markers paint in its wake.
//
// The wave owns the canvas while running. The host UI keeps its own
// canvas effects suspended until `done` resolves, then takes over to
// show the final state.

import type { MapData, MapTransform } from "../../types";
import { computeMapProjection, drawMapGrid, isDarkSurface, type MapProjection, renderMap } from "./helpers";

const CELL_SIZE_M = 0.05; // matches CELL_SIZE_M in history-data.ts

// Tuning — chosen empirically in /tmp/openneato-loading-demo.html.
const PULSE_PERIOD_S = 2.2;
const PULSE_SPAWN_S = 0.9;
const PULSE_DRIFT = 0.4; // 0..1, how far loading pulses spawn from center
const REVEAL_RING_MULT = 3; // carrier's final ringW = ringWidthPx * this
const REVEAL_DUR_MS = 1600;
const NOISE_AMP = 0.55; // 0..1, fraction of ringW used for wobble
const REVEAL_FADE_RING_MULT = 1.5; // wake-fade and carrier overshoot in units of ringW
const SUPPRESS_FADE_RING_MULT = 3; // gentle ramp-out for idle pulses behind the carrier

// Visual sizes scale with canvas dimension so phones get a less chunky
// wave. Desktop (>= ~600px square) lands on the original 40 / 12 values
// because of the upper clamps; very small canvases get clamped from
// below to keep the wave readable.
const RING_W_RATIO = 0.067; // ~6.7% of min(W, H), targets 40px on a 600px canvas
const RING_W_MIN = 22;
const RING_W_MAX = 40;
const ANIM_CELL_RATIO = 0.02; // ~2% of min(W, H), targets 12px on a 600px canvas
const ANIM_CELL_MIN = 7;
const ANIM_CELL_MAX = 12;

function ringWidthPx(W: number, H: number): number {
    return Math.max(RING_W_MIN, Math.min(RING_W_MAX, Math.min(W, H) * RING_W_RATIO));
}

function animCellPx(W: number, H: number): number {
    return Math.max(ANIM_CELL_MIN, Math.min(ANIM_CELL_MAX, Math.min(W, H) * ANIM_CELL_RATIO));
}

type PulseRole = "loading" | "carrier";

interface Pulse {
    bornAt: number; // seconds since wave start
    ox: number; // origin in canvas pixels
    oy: number;
    salt: number; // unique seed for noise
    duration: number; // total lifetime in seconds
    role: PulseRole;
    ringWStart: number;
    ringWEnd: number;
    maxR: number; // target front radius at end of life, pixels
}

// Stable per-cell hash noise in [-1, 1]. No allocations, deterministic.
function hashNoise(cx: number, cy: number, salt: number): number {
    let h = (cx | 0) * 374761393 + (cy | 0) * 668265263 + (salt | 0) * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) / 4294967295) * 2 - 1;
}

// Smooth 2D value noise — bilinear interp of 4 corners with smoothstep.
function valueNoise2D(x: number, y: number, salt: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = hashNoise(xi, yi, salt);
    const b = hashNoise(xi + 1, yi, salt);
    const c = hashNoise(xi, yi + 1, salt);
    const d = hashNoise(xi + 1, yi + 1, salt);
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const ab = a + (b - a) * sx;
    const cd = c + (d - c) * sx;
    return ab + (cd - ab) * sy;
}

function pulseFront(pl: Pulse, t: number): number {
    const age = t - pl.bornAt;
    if (age < 0) return -Infinity;
    const localT = age / pl.duration;
    if (pl.role === "carrier") {
        return localT * (pl.maxR + pl.ringWEnd * REVEAL_FADE_RING_MULT);
    }
    return localT * pl.maxR;
}

// Carrier ringW grows linearly across its lifetime so the wave looks
// like a loading pulse at birth and fattens as it travels.
function pulseRingW(pl: Pulse, t: number): number {
    if (pl.role !== "carrier") return pl.ringWStart;
    const localT = Math.max(0, Math.min(1, (t - pl.bornAt) / pl.duration));
    return pl.ringWStart + (pl.ringWEnd - pl.ringWStart) * localT;
}

function pulseAlpha(pl: Pulse, t: number): number {
    const localT = (t - pl.bornAt) / pl.duration;
    if (pl.role === "carrier") {
        return Math.min(1, 0.85 + 0.15 * Math.min(1, localT * 4));
    }
    return Math.max(0, 1 - localT);
}

function pulseDistancePx(pl: Pulse, px: number, py: number, ringW: number): number {
    const dx = px - pl.ox;
    const dy = py - pl.oy;
    const dRaw = Math.sqrt(dx * dx + dy * dy);
    const n = valueNoise2D(px * 0.06, py * 0.06, pl.salt);
    return dRaw + n * NOISE_AMP * ringW * 0.6;
}

// Largest distance from (ox, oy) to any canvas corner.
function farthestCorner(ox: number, oy: number, W: number, H: number): number {
    return Math.max(Math.hypot(ox, oy), Math.hypot(W - ox, oy), Math.hypot(ox, H - oy), Math.hypot(W - ox, H - oy));
}

interface WaveOptions {
    canvas: HTMLCanvasElement;
}

export class Wave {
    private canvas: HTMLCanvasElement;
    private map: MapData | null = null;
    private transform: MapTransform | null = null;
    private rotation = 0;
    private carrier: Pulse | null = null;
    private pulses: Pulse[] = [];
    private nextSpawnAt = 0;
    private saltCounter = 1;
    private startTs: number;
    private raf: number | null = null;
    private finished = false;
    private resolveDone: (() => void) | null = null;
    public readonly done: Promise<void>;

    private cachedSurface: string | null = null;
    private cachedIsDark = true;
    private cachedDpr = 0;
    private cachedW = 0;
    private cachedH = 0;

    constructor(opts: WaveOptions) {
        this.canvas = opts.canvas;
        this.startTs = performance.now();
        this.done = new Promise<void>((resolve) => {
            this.resolveDone = resolve;
        });
        this.tick = this.tick.bind(this);
        this.raf = requestAnimationFrame(this.tick);
    }

    // Begin the reveal phase. Spawns a fresh "carrier" pulse at center
    // and re-anchors any in-flight loading pulses onto the carrier's
    // velocity so they expand at the same rate and expire together
    // instead of trailing as ghosts on their own slower cadence.
    startReveal(map: MapData, transform: MapTransform, rotation: number = 0): void {
        if (this.carrier !== null || this.finished) return;
        this.map = map;
        this.transform = transform;
        this.rotation = rotation;

        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const ox = W / 2;
        const oy = H / 2;
        const ringWStart = ringWidthPx(W, H);
        const ringWEnd = ringWStart * REVEAL_RING_MULT;
        const t = (performance.now() - this.startTs) / 1000;
        const carrier: Pulse = {
            bornAt: t,
            ox,
            oy,
            salt: this.saltCounter++,
            duration: REVEAL_DUR_MS / 1000,
            role: "carrier",
            ringWStart,
            ringWEnd,
            maxR: farthestCorner(ox, oy, W, H) + ringWEnd * REVEAL_FADE_RING_MULT + 20,
        };

        // Match each loading pulse's front-velocity to the carrier's
        // *rendered* velocity. The carrier's pulseFront includes an
        // overshoot of `ringWEnd * REVEAL_FADE_RING_MULT` past maxR so
        // its trailing edge clears the canvas; loading pulses don't get
        // that bonus, so we compensate via their duration. bornAt is
        // shifted to keep the current front position continuous on the
        // reveal frame (no jump).
        const carrierRenderedMaxR = carrier.maxR + carrier.ringWEnd * REVEAL_FADE_RING_MULT;
        const carrierVelocity = carrierRenderedMaxR / carrier.duration;
        for (const pl of this.pulses) {
            if (pl.role !== "loading") continue;
            const oldFront = pulseFront(pl, t);
            const newDuration = pl.maxR / carrierVelocity;
            pl.duration = newDuration;
            pl.bornAt = t - (oldFront / pl.maxR) * newDuration;
        }

        this.pulses.push(carrier);
        this.carrier = carrier;
    }

    cancel(): void {
        this.finish();
    }

    // Stop the rAF loop and resolve `done`. Idempotent.
    private finish(): void {
        if (this.finished) return;
        this.finished = true;
        if (this.raf !== null) cancelAnimationFrame(this.raf);
        this.raf = null;
        this.resolveDone?.();
    }

    private spawnLoadingPulse(t: number): void {
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const ox = W / 2 + (Math.random() - 0.5) * W * 0.5 * PULSE_DRIFT;
        const oy = H / 2 + (Math.random() - 0.5) * H * 0.5 * PULSE_DRIFT;
        const ringW = ringWidthPx(W, H);
        this.pulses.push({
            bornAt: t,
            ox,
            oy,
            salt: this.saltCounter++,
            duration: PULSE_PERIOD_S * (0.85 + Math.random() * 0.3),
            role: "loading",
            ringWStart: ringW,
            ringWEnd: ringW,
            maxR: farthestCorner(ox, oy, W, H) + 20,
        });
    }

    private tick(now: number): void {
        if (this.finished) return;
        const t = (now - this.startTs) / 1000;

        if (this.carrier === null) {
            if (t >= this.nextSpawnAt) {
                this.spawnLoadingPulse(t);
                this.nextSpawnAt = t + PULSE_SPAWN_S * (0.7 + Math.random() * 0.6);
            }
            if (this.pulses.length === 0) this.spawnLoadingPulse(t);
        }

        // Drop expired pulses
        this.pulses = this.pulses.filter((pl) => t - pl.bornAt < pl.duration * 1.2);

        this.render(t);

        // Reveal completion: the carrier's trailing edge has cleared the
        // farthest visible canvas pixel. Hand off to the host UI.
        if (this.carrier !== null && this.map !== null && this.transform !== null) {
            const front = pulseFront(this.carrier, t);
            const ringW = pulseRingW(this.carrier, t);
            if (front - ringW >= this.carrier.maxR) {
                renderMap(this.canvas, this.map, false, this.transform, undefined, this.rotation);
                this.finish();
                return;
            }
        }

        this.raf = requestAnimationFrame(this.tick);
    }

    private ensureCanvasSized(): { ctx: CanvasRenderingContext2D; W: number; H: number } | null {
        const ctx = this.canvas.getContext("2d");
        if (!ctx) return null;
        const dpr = window.devicePixelRatio || 1;
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        if (W !== this.cachedW || H !== this.cachedH || dpr !== this.cachedDpr) {
            this.canvas.width = W * dpr;
            this.canvas.height = H * dpr;
            this.cachedDpr = dpr;
            this.cachedW = W;
            this.cachedH = H;
            this.cachedSurface = null;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (this.cachedSurface === null) {
            this.cachedSurface = getComputedStyle(this.canvas).getPropertyValue("--surface").trim();
            this.cachedIsDark = isDarkSurface(this.canvas);
        }
        return { ctx, W, H };
    }

    private render(t: number): void {
        const sized = this.ensureCanvasSized();
        if (!sized) return;
        const { ctx, W: displayW, H: displayH } = sized;
        const isDark = this.cachedIsDark;

        ctx.fillStyle = this.cachedSurface || "#1a1a1c";
        ctx.fillRect(0, 0, displayW, displayH);

        // Reveal phase paints the map beneath the wave foreground.
        // Loading phase has no map data, so the wave runs on the bare
        // background.
        const proj =
            this.carrier && this.map?.bounds ? computeMapProjection(displayW, displayH, this.map.bounds) : null;

        if (proj) {
            const tf = this.transform ?? { panX: 0, panY: 0, zoom: 1 };
            ctx.save();
            if (this.rotation) {
                ctx.translate(displayW / 2, displayH / 2);
                ctx.rotate((this.rotation * Math.PI) / 180);
                ctx.translate(-displayW / 2, -displayH / 2);
            }
            ctx.translate(tf.panX, tf.panY);
            ctx.scale(tf.zoom, tf.zoom);
            drawMapGrid(ctx, proj, isDark);
            this.drawRevealCoverage(ctx, t, proj, isDark);
            this.drawRevealPath(ctx, t, proj, isDark);
            ctx.restore();
        }

        this.drawWaveCells(ctx, t, displayW, displayH, isDark);

        if (proj) {
            ctx.save();
            if (this.rotation) {
                ctx.translate(displayW / 2, displayH / 2);
                ctx.rotate((this.rotation * Math.PI) / 180);
                ctx.translate(-displayW / 2, -displayH / 2);
            }
            const tf = this.transform ?? { panX: 0, panY: 0, zoom: 1 };
            ctx.translate(tf.panX, tf.panY);
            ctx.scale(tf.zoom, tf.zoom);
            this.drawRevealMarkers(ctx, t, proj);
            ctx.restore();
        }
    }

    // Paint real coverage cells at native 5cm resolution behind the
    // carrier wave front. Opacity ramps from 0 at the front edge to full
    // settled coverage opacity within ~1.5 ringW behind the front.
    private drawRevealCoverage(ctx: CanvasRenderingContext2D, t: number, proj: MapProjection, isDark: boolean): void {
        const carrier = this.carrier;
        const map = this.map;
        if (!carrier || !map) return;
        const ringW = pulseRingW(carrier, t);
        const front = pulseFront(carrier, t);
        const cellPx = CELL_SIZE_M * proj.scale;
        const settledA = isDark ? 0.15 : 0.22;
        const baseRgb = isDark ? "52, 199, 89" : "22, 130, 50";
        const fadeWidth = ringW * REVEAL_FADE_RING_MULT;

        const buckets: number[][] = Array.from({ length: 10 }, () => []);

        for (const cell of map.coverage) {
            const [cx, cy] = cell;
            const px = proj.toX(cx * CELL_SIZE_M);
            const py = proj.toY(cy * CELL_SIZE_M);
            const edge = front - pulseDistancePx(carrier, px, py, ringW);
            if (edge <= 0) continue;
            const settle = Math.min(1, edge / fadeWidth);
            const bIdx = Math.min(9, (settle * 10) | 0);
            buckets[bIdx].push(px - cellPx / 2, py - cellPx / 2);
        }

        for (let i = 0; i < 10; i++) {
            const arr = buckets[i];
            if (arr.length === 0) continue;
            ctx.fillStyle = `rgba(${baseRgb}, ${(settledA * (i + 1)) / 10})`;
            for (let j = 0; j < arr.length; j += 2) {
                ctx.fillRect(arr[j], arr[j + 1], cellPx, cellPx);
            }
        }
    }

    private drawRevealPath(ctx: CanvasRenderingContext2D, t: number, proj: MapProjection, isDark: boolean): void {
        const carrier = this.carrier;
        const map = this.map;
        if (!carrier || !map || map.path.length < 2) return;
        const ringW = pulseRingW(carrier, t);
        const front = pulseFront(carrier, t);

        ctx.strokeStyle = isDark ? "rgba(249, 235, 178, 0.6)" : "rgba(180, 140, 40, 0.5)";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        let drawing = false;
        for (const pt of map.path) {
            const ppx = proj.toX(pt.x);
            const ppy = proj.toY(pt.y);
            const reached = front - pulseDistancePx(carrier, ppx, ppy, ringW) > 0;
            if (reached) {
                if (drawing) ctx.lineTo(ppx, ppy);
                else {
                    ctx.moveTo(ppx, ppy);
                    drawing = true;
                }
            } else {
                drawing = false;
            }
        }
        ctx.stroke();
    }

    private drawRevealMarkers(ctx: CanvasRenderingContext2D, t: number, proj: MapProjection): void {
        const carrier = this.carrier;
        const map = this.map;
        if (!carrier || !map || map.path.length === 0) return;
        const ringW = pulseRingW(carrier, t);
        const front = pulseFront(carrier, t);
        const fadeWidth = ringW * REVEAL_FADE_RING_MULT;

        const drawDot = (worldX: number, worldY: number, r: number, g: number, b: number) => {
            const px = proj.toX(worldX);
            const py = proj.toY(worldY);
            const edge = front - pulseDistancePx(carrier, px, py, ringW);
            if (edge < 0) return;
            const a = Math.min(1, edge / fadeWidth);
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.9 * a})`;
            ctx.fill();
        };

        const start = map.path[0];
        drawDot(start.x, start.y, 52, 199, 89);
        if (map.path.length > 1) {
            const end = map.path[map.path.length - 1];
            drawDot(end.x, end.y, 255, 69, 58);
        }
    }

    // Foreground wave cells on a fixed-pixel grid (independent of map
    // scale). Loading and carrier pulses share the same brightness
    // formula so the carrier reads as a continuation of the rhythm.
    // Behind the carrier front, contributions are suppressed with a soft
    // ramp so idle pulses don't snap-cut to invisible.
    private drawWaveCells(
        ctx: CanvasRenderingContext2D,
        t: number,
        displayW: number,
        displayH: number,
        isDark: boolean,
    ): void {
        const baseRgb = isDark ? "52, 199, 89" : "22, 130, 50";
        const cellPx = animCellPx(displayW, displayH);
        const cols = Math.ceil(displayW / cellPx) + 2;
        const rows = Math.ceil(displayH / cellPx) + 2;

        const carrier = this.carrier;
        const carrierRingW = carrier ? pulseRingW(carrier, t) : 0;
        const carrierFront = carrier ? pulseFront(carrier, t) : 0;
        const suppressFadeWidth = carrierRingW * SUPPRESS_FADE_RING_MULT;
        const tickSeed = (t * 4) | 0;

        const buckets: number[][] = Array.from({ length: 10 }, () => []);

        for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                const px = cx * cellPx;
                const py = cy * cellPx;

                let suppress = 1;
                if (carrier) {
                    const edge = carrierFront - pulseDistancePx(carrier, px, py, carrierRingW);
                    if (edge > carrierRingW) {
                        suppress = Math.max(0, 1 - (edge - carrierRingW) / suppressFadeWidth);
                    }
                }
                if (suppress <= 0.01) continue;

                let bright = 0;
                for (const pl of this.pulses) {
                    const ringW = pulseRingW(pl, t);
                    const front = pulseFront(pl, t);
                    if (front <= -ringW) continue;
                    const delta = front - pulseDistancePx(pl, px, py, ringW);
                    const absDelta = delta < 0 ? -delta : delta;
                    if (absDelta < ringW) {
                        const f = 1 - absDelta / ringW;
                        const flicker = 0.9 + 0.1 * hashNoise(cx, cy, pl.salt + tickSeed);
                        const b = f * pulseAlpha(pl, t) * flicker;
                        if (b > bright) bright = b;
                    }
                }
                bright *= suppress;
                if (bright <= 0.02) continue;

                buckets[Math.min(9, (bright * 10) | 0)].push(px, py);
            }
        }

        for (let i = 0; i < 10; i++) {
            const arr = buckets[i];
            if (arr.length === 0) continue;
            ctx.fillStyle = `rgba(${baseRgb}, ${(0.85 * (i + 1)) / 10})`;
            for (let j = 0; j < arr.length; j += 2) {
                ctx.fillRect(arr[j], arr[j + 1], cellPx, cellPx);
            }
        }
    }
}
