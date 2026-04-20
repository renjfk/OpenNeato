// Map data processing — parses raw JSONL from firmware and generates
// coverage maps, path arrays, and bounding boxes client-side.

import type {
    MapBounds,
    MapCoverageCell,
    MapData,
    MapPathPoint,
    MapRechargePoint,
    MapSession,
    MapSummary,
} from "./types";

const ROBOT_DIAMETER_M = 0.33; // Neato Botvac diameter
const CELL_SIZE_M = 0.05; // 5cm grid cells for coverage map

interface RawPose {
    x: number;
    y: number;
    t: number;
    ts: number;
}

// Pose line structure: {"x":NUM,"y":NUM,"t":NUM,"ts":NUM}
// Heatshrink decompression can corrupt single bytes in numeric tokens
// (e.g. '.' -> ':' or '.' -> '"'). Try to recover by matching the structural
// skeleton permissively and replacing non-numeric garbage with '.'.
const POSE_RE =
    /^\{.x.:\s*(-?[\d.eE:"\w-]+)\s*,.y.:\s*(-?[\d.eE:"\w-]+)\s*,.t.:\s*([\d.eE:"\w-]+)\s*,.ts.:\s*([\d.eE:"\w-]+)\s*\}$/;

function repairNumber(raw: string): number {
    // Replace any character that isn't digit, dot, minus, or 'e'/'E' with '.'
    const cleaned = raw.replace(/[^0-9.eE-]/g, ".");
    // Collapse multiple dots — keep only the first as the decimal point
    const parts = cleaned.split(".");
    const fixed = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned;
    const n = Number(fixed);
    return Number.isFinite(n) ? n : Number.NaN;
}

function tryRepairPoseLine(line: string): RawPose | null {
    const m = line.match(POSE_RE);
    if (!m) return null;
    const x = repairNumber(m[1]);
    const y = repairNumber(m[2]);
    const t = repairNumber(m[3]);
    const ts = repairNumber(m[4]);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(t) || Number.isNaN(ts)) return null;
    return { x, y, t, ts };
}

/** Parse raw JSONL text (possibly multiple sessions) into MapData[] */
export function parseMapData(raw: string): MapData[] {
    const lines = raw
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);

    // Split into per-session chunks: each starts with a {"type":"session",...} line
    const chunks: string[][] = [];
    let current: string[] = [];
    for (const line of lines) {
        // Peek at the line to detect session boundary
        if (line.includes('"type":"session"') && current.length > 0) {
            chunks.push(current);
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) chunks.push(current);

    return chunks.map(buildSession).filter((m) => m.path.length > 0);
}

// Union of all line types that can appear in a session JSONL
type SessionLine = MapSession | MapSummary | RawPose | (MapRechargePoint & { type: "recharge" });

function isSession(l: SessionLine): l is MapSession {
    return "type" in l && (l as MapSession).type === "session";
}
function isSummary(l: SessionLine): l is MapSummary {
    return "type" in l && (l as MapSummary).type === "summary";
}
function isRecharge(l: SessionLine): l is MapRechargePoint & { type: "recharge" } {
    return "type" in l && (l as { type: string }).type === "recharge";
}
function isPose(l: SessionLine): l is RawPose {
    return "x" in l && !("type" in l);
}

function buildSession(lines: string[]): MapData {
    // Preserve source order so recharges can be timestamped relative to
    // the nearest pose snapshot (recharges don't carry their own ts field).
    const parsed: SessionLine[] = [];
    const rawRecharges: { x: number; y: number; prevTs: number }[] = [];
    let lastPoseTs = 0;

    for (const l of lines) {
        let obj: SessionLine | null = null;
        try {
            obj = JSON.parse(l);
        } catch {
            const repaired = tryRepairPoseLine(l);
            if (repaired) obj = repaired;
        }
        if (!obj) continue;
        parsed.push(obj);
        if (isPose(obj)) {
            lastPoseTs = obj.ts;
        } else if (isRecharge(obj)) {
            rawRecharges.push({ x: obj.x, y: obj.y, prevTs: lastPoseTs });
        }
    }

    const session: MapSession | null = parsed.find(isSession) ?? null;
    const summary: MapSummary | null = parsed.find(isSummary) ?? null;
    const rawPoses: RawPose[] = parsed.filter(isPose).filter((l) => l.x !== 0 || l.y !== 0 || l.t !== 0);

    if (rawPoses.length === 0) {
        return { session, summary, path: [], coverage: [], recharges: [], bounds: null, cellSize: CELL_SIZE_M };
    }

    // Firmware records `ts` as seconds since boot, not session start, so
    // normalize against the first retained pose. This makes timestamps
    // session-relative and keeps them in sync with the summary duration
    // used by the motion player's scrubber.
    const tOrigin = rawPoses[0].ts;
    const poses: RawPose[] = rawPoses.map((p) => ({ ...p, ts: Math.max(0, p.ts - tOrigin) }));

    // Detect charge windows from long gaps in the pose timeline. The firmware
    // writes the recharge marker as soon as the robot starts docking, but
    // keeps writing snapshots until collection is paused on the dock — so
    // the gap containing the actual charge can be a handful of lines after
    // the marker. We scan the whole pose timeline for big gaps (> a few
    // typical snapshot intervals) and pair each recharge marker with its
    // nearest gap for accurate start/end times.
    const POSE_INTERVAL_S = 2; // firmware samples every ~2s
    const GAP_MIN_S = 30; // anything longer than 15x the interval is a pause
    const gaps: { start: number; end: number }[] = [];
    for (let i = 1; i < poses.length; i++) {
        const delta = poses[i].ts - poses[i - 1].ts;
        if (delta >= GAP_MIN_S) {
            gaps.push({ start: poses[i - 1].ts, end: poses[i].ts });
        }
    }

    const usedGaps = new Set<number>();
    const recharges: MapRechargePoint[] = rawRecharges.map((r) => {
        const markerTs = Math.max(0, r.prevTs - tOrigin);
        // Find the closest unused gap to the marker. Prefer one that starts
        // at or after the marker since the pause always follows the marker.
        let bestIdx = -1;
        let bestScore = Infinity;
        for (let i = 0; i < gaps.length; i++) {
            if (usedGaps.has(i)) continue;
            const g = gaps[i];
            const distance = g.start >= markerTs ? g.start - markerTs : (markerTs - g.start) * 4;
            if (distance < bestScore) {
                bestScore = distance;
                bestIdx = i;
            }
        }
        if (bestIdx >= 0) {
            usedGaps.add(bestIdx);
            const g = gaps[bestIdx];
            return { x: r.x, y: r.y, ts: g.start, endTs: g.end };
        }
        // Fallback when no large gap was found — use a single-interval window
        // so the bar still shows a visible sliver at the marker location.
        const next = poses.find((p) => p.ts > markerTs);
        return { x: r.x, y: r.y, ts: markerTs, endTs: next ? next.ts : markerTs + POSE_INTERVAL_S };
    });

    const path: MapPathPoint[] = poses.map((p) => ({ x: p.x, y: p.y, t: p.t, ts: p.ts }));

    // Coverage grid — stamp robot footprint circle at each pose and record
    // the earliest timestamp at which the cell was touched so the motion
    // player can reveal coverage progressively.
    const radiusCells = Math.ceil(ROBOT_DIAMETER_M / 2 / CELL_SIZE_M);
    const firstCoverTs = new Map<string, number>();

    for (const p of poses) {
        const cx = Math.round(p.x / CELL_SIZE_M);
        const cy = Math.round(p.y / CELL_SIZE_M);
        for (let dx = -radiusCells; dx <= radiusCells; dx++) {
            for (let dy = -radiusCells; dy <= radiusCells; dy++) {
                if (dx * dx + dy * dy <= radiusCells * radiusCells) {
                    const key = `${cx + dx},${cy + dy}`;
                    if (!firstCoverTs.has(key)) firstCoverTs.set(key, p.ts);
                }
            }
        }
    }

    const coverage: MapCoverageCell[] = Array.from(firstCoverTs.entries()).map(([k, ts]) => {
        const [c, r] = k.split(",").map(Number);
        return [c, r, ts];
    });

    // Bounding box padded by robot radius
    const pad = ROBOT_DIAMETER_M / 2 + 0.1;
    const xs = poses.map((p) => p.x);
    const ys = poses.map((p) => p.y);
    const bounds: MapBounds = {
        minX: Math.min(...xs) - pad,
        maxX: Math.max(...xs) + pad,
        minY: Math.min(...ys) - pad,
        maxY: Math.max(...ys) + pad,
    };

    return { session, summary, path, coverage, recharges, bounds, cellSize: CELL_SIZE_M };
}
