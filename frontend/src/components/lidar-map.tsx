import { useEffect, useMemo, useRef } from "preact/hooks";
import type { LidarScan } from "../types";

interface LidarMapProps {
    scan: LidarScan | null;
    size: number;
    moving?: boolean; // When true, disable multi-scan accumulation to avoid ghost walls
}

const MAX_RANGE_MM = 5000;
const MAX_DIST_MM = 6000; // Reject readings above this (LDS max range + margin)
const MAX_SCAN_AGE = 5; // Keep points from the last N scans
const MAX_BRIDGE_GAP = 5; // Bridge up to N missing angles between valid points
const MAX_DIST_JUMP_PCT = 0.3; // Max distance jump as fraction of average distance (30%)
const SMOOTH_WINDOW = 5; // Moving-average half-window for distance smoothing
const MIN_SEGMENT_LEN = 3; // Minimum points in a wall segment to be drawn

// Per-angle accumulated point: stores the most recent valid reading and its age
interface AccumPoint {
    dist: number;
    age: number; // 0 = current scan, incremented each scan
}

// Mutable accumulator — persists across renders via useRef
interface ScanAccumulator {
    points: (AccumPoint | null)[]; // 360 slots
}

function createAccumulator(): ScanAccumulator {
    return { points: new Array(360).fill(null) };
}

export function LidarMap({ scan, size, moving }: LidarMapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const accumRef = useRef<ScanAccumulator>(createAccumulator());

    // Merge incoming scan into the accumulator
    const merged = useMemo(() => {
        const acc = accumRef.current;

        // When moving, clear the accumulator to avoid ghost walls from old positions
        if (moving) {
            acc.points.fill(null);
        } else {
            // Age all existing points
            for (let i = 0; i < 360; i++) {
                const p = acc.points[i];
                if (p) {
                    p.age++;
                    if (p.age > MAX_SCAN_AGE) {
                        acc.points[i] = null;
                    }
                }
            }
        }

        // Merge new scan — overwrite with fresh readings
        if (scan) {
            for (const p of scan.points) {
                if (p.error !== 0 || p.dist === 0 || p.dist > MAX_DIST_MM) continue;
                acc.points[p.angle] = { dist: p.dist, age: 0 };
            }
        }

        // Return a snapshot for rendering
        return acc.points.map((p) => (p ? { ...p } : null));
    }, [scan, moving]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);

        const cx = size / 2;
        const cy = size / 2;
        const scale = (size / 2 - 8) / MAX_RANGE_MM;

        // Read theme colors from CSS variables
        const styles = getComputedStyle(document.documentElement);
        const bgColor = styles.getPropertyValue("--surface").trim() || "#1a1a1c";
        const gridColor = styles.getPropertyValue("--border").trim() || "rgba(255, 255, 255, 0.06)";
        const robotColor = styles.getPropertyValue("--text-dim").trim() || "#8a8a8e";

        // Background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);

        // Grid rings (1m intervals)
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        for (let r = 1000; r <= MAX_RANGE_MM; r += 1000) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(cx, 4);
        ctx.lineTo(cx, size - 4);
        ctx.moveTo(4, cy);
        ctx.lineTo(size - 4, cy);
        ctx.stroke();

        // Helper: angle to canvas coordinates
        const toCanvas = (angleDeg: number, dist: number): [number, number] => {
            const rad = ((90 - angleDeg) * Math.PI) / 180;
            return [cx + dist * scale * Math.cos(rad), cy - dist * scale * Math.sin(rad)];
        };

        // Helper: opacity from age (1.0 = current, fades to 0.3)
        const opacity = (age: number): number => 1.0 - (age / MAX_SCAN_AGE) * 0.7;

        // Check if two points are on the same surface (proportional distance check)
        const sameSurface = (a: AccumPoint, b: AccumPoint): boolean => {
            const avg = (a.dist + b.dist) / 2;
            return Math.abs(a.dist - b.dist) < avg * MAX_DIST_JUMP_PCT;
        };

        // Collect contiguous wall segments by walking the 360 angles.
        // Each segment is a run of points (bridging small gaps) on the same surface.
        interface SegPoint {
            angle: number;
            dist: number;
            age: number;
        }
        const segments: SegPoint[][] = [];
        let current: SegPoint[] = [];

        for (let i = 0; i < 360; i++) {
            const pt = merged[i];
            if (!pt) {
                // Check if we can bridge the gap
                let bridged = false;
                if (current.length > 0) {
                    for (let gap = 1; gap <= MAX_BRIDGE_GAP; gap++) {
                        const next = merged[(i + gap) % 360];
                        if (next && sameSurface(current[current.length - 1], next)) {
                            bridged = true;
                            break;
                        }
                    }
                }
                if (!bridged && current.length > 0) {
                    segments.push(current);
                    current = [];
                }
                continue;
            }
            if (current.length > 0 && !sameSurface(current[current.length - 1], pt)) {
                segments.push(current);
                current = [];
            }
            current.push({ angle: i, dist: pt.dist, age: pt.age });
        }
        if (current.length > 0) segments.push(current);

        // Try to merge first and last segment if they wrap around 360° on the same surface
        if (segments.length >= 2) {
            const first = segments[0];
            const last = segments[segments.length - 1];
            if (
                last[last.length - 1].angle >= 355 &&
                first[0].angle <= 4 &&
                sameSurface(last[last.length - 1], first[0])
            ) {
                segments[0] = [...last, ...first];
                segments.pop();
            }
        }

        // Smooth distances within each segment using a moving average
        const smooth = (seg: SegPoint[]): SegPoint[] =>
            seg.map((p, i) => {
                let sum = 0;
                let count = 0;
                for (let j = Math.max(0, i - SMOOTH_WINDOW); j <= Math.min(seg.length - 1, i + SMOOTH_WINDOW); j++) {
                    sum += seg[j].dist;
                    count++;
                }
                return { ...p, dist: sum / count };
            });

        // Draw smoothed wall segments as polylines
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (const seg of segments) {
            if (seg.length < MIN_SEGMENT_LEN) continue;
            const smoothed = smooth(seg);
            const avgAge = seg.reduce((s, p) => s + p.age, 0) / seg.length;
            const alpha = opacity(avgAge) * 0.7;
            ctx.strokeStyle = `rgba(59, 158, 255, ${alpha})`;
            ctx.beginPath();
            const [sx, sy] = toCanvas(smoothed[0].angle, smoothed[0].dist);
            ctx.moveTo(sx, sy);
            for (let i = 1; i < smoothed.length; i++) {
                const [px, py] = toCanvas(smoothed[i].angle, smoothed[i].dist);
                ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        // Robot indicator (center triangle pointing up = forward)
        ctx.fillStyle = robotColor;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx - 5, cy + 4);
        ctx.lineTo(cx + 5, cy + 4);
        ctx.closePath();
        ctx.fill();
    }, [merged, size]);

    return <canvas ref={canvasRef} class="lidar-canvas" />;
}
