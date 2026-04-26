import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import boltSvg from "../../assets/icons/bolt.svg?raw";
import rotateLeftSvg from "../../assets/icons/rotate-left.svg?raw";
import rotateRightSvg from "../../assets/icons/rotate-right.svg?raw";
import { Icon } from "../../components/icon";
import { useMapGestures } from "../../hooks/use-map-gestures";
import type { HistoryFileInfo, MapData } from "../../types";
import { formatDuration, renderMap } from "./helpers";
import { Wave } from "./loading-wave";
import { MotionPlayer } from "./motion-player";

interface HistoryItemViewProps {
    file: HistoryFileInfo;
    map: MapData | null;
    mapEmpty: boolean;
    recording: boolean;
}

// Persisted map rotation, in degrees. Always normalized to one of 0/90/180/270.
function loadRotation(): number {
    const raw = Number(localStorage.getItem("mapRotation"));
    if (!Number.isFinite(raw)) return 0;
    return (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
}

export function HistoryItemView({ file, map, mapEmpty, recording }: HistoryItemViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [rotation, setRotation] = useState<number>(loadRotation);
    const transform = useMapGestures(canvasRef, rotation);

    useEffect(() => {
        localStorage.setItem("mapRotation", String(rotation));
    }, [rotation]);

    const rotateBy = useCallback((delta: number) => {
        setRotation((r) => (((r + delta) % 360) + 360) % 360);
    }, []);

    // Expose the live canvas element so MotionPlayer can drive the renderer
    // without duplicating gesture handling or the ref plumbing.
    const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
    useEffect(() => {
        setCanvasEl(canvasRef.current);
    }, [map]);

    // True while the wave is on screen — covers both the loading phase
    // and the brief carrier-driven reveal phase. Flips to false when the
    // carrier wave's trailing edge clears the canvas, at which point the
    // wave hands the canvas back to the motion player / static render.
    const [revealing, setRevealing] = useState<boolean>(true);

    // Single Wave instance lives across the loading -> revealing
    // transition so in-flight idle pulses carry over into the reveal
    // phase rather than being torn down and replaced. We create it once
    // on mount; a separate effect calls startReveal() when map arrives.
    const waveRef = useRef<Wave | null>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const wave = new Wave({ canvas });
        waveRef.current = wave;
        let canceled = false;
        wave.done.then(() => {
            if (!canceled) setRevealing(false);
        });
        return () => {
            canceled = true;
            wave.cancel();
            waveRef.current = null;
        };
    }, []);

    // Kick the reveal phase the first time map data arrives. The wave
    // keeps its existing in-flight idle pulses; the carrier joins them
    // as one extra pulse instead of replacing the rhythm. Subsequent
    // map updates (e.g. recording-session polling) are ignored — the
    // reveal animation runs once.
    const revealStartedRef = useRef(false);
    useEffect(() => {
        if (revealStartedRef.current) return;
        if (!map || map.path.length === 0) return;
        const wave = waveRef.current;
        if (!wave) return;
        wave.startReveal(map, transform, rotation);
        revealStartedRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map]);

    // Motion playback mounts as soon as a finished session's data is
    // present. While `revealing` is true its canvas effects are
    // suspended via the `canvasSuspended` prop — controls render and
    // are interactive, but it doesn't fight the wave for the canvas.
    const showPlayer = !recording && map !== null && map.path.length > 0;

    // Static render fallback — only when the player is not present
    // (recording sessions). The player handles its own canvas draws when
    // it owns them. We also skip while `revealing` so the wave keeps the
    // canvas to itself.
    useEffect(() => {
        if (showPlayer) return;
        if (revealing) return;
        if (map && canvasRef.current) {
            renderMap(canvasRef.current, map, recording, transform, undefined, rotation);
        }
    }, [map, recording, transform, showPlayer, revealing, rotation]);

    useEffect(() => {
        if (showPlayer) return;
        if (revealing) return;
        if (!map) return;
        const handleResize = () => {
            if (map && canvasRef.current) renderMap(canvasRef.current, map, recording, transform, undefined, rotation);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [map, recording, transform, showPlayer, revealing, rotation]);

    // Prefer list metadata summary (available immediately), fall back to
    // the summary parsed from the full JSONL data (available after fetch)
    const summary = file.summary ?? map?.summary ?? null;
    const session = file.session ?? map?.session ?? null;

    return (
        <>
            {/* Summary bar */}
            {summary && (
                <div class="history-detail-stats">
                    <div class="history-stat">
                        <span class="history-stat-label">Duration</span>
                        <span class="history-stat-value">{formatDuration(summary.duration)}</span>
                    </div>
                    <div class="history-stat">
                        <span class="history-stat-label">Distance</span>
                        <span class="history-stat-value">{summary.distanceTraveled.toFixed(1)}m</span>
                    </div>
                    <div class="history-stat">
                        <span class="history-stat-label">Area</span>
                        <span class="history-stat-value">{summary.areaCovered.toFixed(1)}m&sup2;</span>
                    </div>
                    <div class="history-stat">
                        <span class="history-stat-label">Battery</span>
                        <span class="history-stat-value">
                            {session?.battery ?? "?"}% &rarr; {summary.batteryEnd ?? "?"}%
                        </span>
                    </div>
                    {summary.recharges > 0 && (
                        <div class="history-stat">
                            <span class="history-stat-label">Recharges</span>
                            <span class="history-stat-value">{summary.recharges}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Map canvas. The wave owns this canvas while `revealing`;
                afterwards the motion player or the static-render effect
                takes over. The empty-data message replaces it only when
                we know the session has no usable map. */}
            <div class="history-canvas-wrap">
                {mapEmpty && <div class="history-empty">Not enough data to display map</div>}
                <canvas ref={canvasRef} class="history-canvas" style={mapEmpty ? { display: "none" } : undefined} />
                {map && !mapEmpty && (
                    <>
                        <button
                            type="button"
                            class="history-rotate-btn left"
                            onClick={() => rotateBy(-90)}
                            aria-label="Rotate map counter-clockwise"
                        >
                            <Icon svg={rotateLeftSvg} />
                        </button>
                        <button
                            type="button"
                            class="history-rotate-btn right"
                            onClick={() => rotateBy(90)}
                            aria-label="Rotate map clockwise"
                        >
                            <Icon svg={rotateRightSvg} />
                        </button>
                    </>
                )}
            </div>

            {/* Motion player mounts immediately when data arrives so its
                controls render right away. Its canvas effects are
                suspended via `canvasSuspended` until the wave resolves. */}
            {showPlayer && map && (
                <MotionPlayer
                    canvas={canvasEl}
                    map={map}
                    transform={transform}
                    rotation={rotation}
                    canvasSuspended={revealing}
                />
            )}

            {/* Legend */}
            {map && (
                <div class="history-legend">
                    <span class="history-legend-item">
                        <span class="history-legend-dot start" /> Start
                    </span>
                    <span class="history-legend-item">
                        <span class={`history-legend-dot ${recording ? "current" : "end"}`} />{" "}
                        {recording ? "Current" : "End"}
                    </span>
                    <span class="history-legend-item">
                        <span class="history-legend-swatch coverage" /> Coverage
                    </span>
                    {map.recharges.length > 0 && (
                        <span class="history-legend-item">
                            <span class="history-legend-bolt">
                                <Icon svg={boltSvg} />
                            </span>{" "}
                            Recharge
                        </span>
                    )}
                </div>
            )}
            {map && (
                <div class="history-map-hint">Pinch or scroll to zoom, drag to pan, double-tap to zoom in or reset</div>
            )}
            {showPlayer && (
                <div class="history-map-hint">
                    Space to play or pause, arrow keys to seek, hold shift for a larger jump
                </div>
            )}
        </>
    );
}
