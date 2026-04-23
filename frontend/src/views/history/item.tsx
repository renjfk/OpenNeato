import { useEffect, useRef, useState } from "preact/hooks";
import boltSvg from "../../assets/icons/bolt.svg?raw";
import { Icon } from "../../components/icon";
import { useMapGestures } from "../../hooks/use-map-gestures";
import type { HistoryFileInfo, MapData } from "../../types";
import { formatDuration, renderMap } from "./helpers";
import { MotionPlayer } from "./motion-player";

interface HistoryItemViewProps {
    file: HistoryFileInfo;
    map: MapData | null;
    mapEmpty: boolean;
    recording: boolean;
}

export function HistoryItemView({ file, map, mapEmpty, recording }: HistoryItemViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const transform = useMapGestures(canvasRef);

    // Expose the live canvas element so MotionPlayer can drive the renderer
    // without duplicating gesture handling or the ref plumbing.
    const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
    useEffect(() => {
        setCanvasEl(canvasRef.current);
    }, [map]);

    // Motion playback is only available for finished sessions. While
    // recording we fall back to the live static render (with its pulsing
    // end marker) so the existing behaviour is unchanged.
    const showPlayer = !recording && map !== null && map.path.length > 0;

    // When the player is visible it owns all canvas draws. Otherwise we
    // render the static map here so recording sessions and loading states
    // keep working exactly as before.
    useEffect(() => {
        if (showPlayer) return;
        if (map && canvasRef.current) {
            renderMap(canvasRef.current, map, recording, transform);
        }
    }, [map, recording, transform, showPlayer]);

    useEffect(() => {
        if (showPlayer) return;
        if (!map) return;
        const handleResize = () => {
            if (map && canvasRef.current) renderMap(canvasRef.current, map, recording, transform);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [map, recording, transform, showPlayer]);

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
                            {session?.battery ?? "?"}% &rarr; {summary.batteryEnd ?? summary.battery ?? "?"}%
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

            {/* Map canvas */}
            <div class="history-canvas-wrap">
                {!map && !mapEmpty && <div class="history-empty">Loading map...</div>}
                {mapEmpty && <div class="history-empty">Not enough data to display map</div>}
                <canvas ref={canvasRef} class="history-canvas" style={map ? undefined : { display: "none" }} />
            </div>

            {/* Motion player (finished sessions only) */}
            {showPlayer && map && <MotionPlayer canvas={canvasEl} map={map} transform={transform} />}

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
