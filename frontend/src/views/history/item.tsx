import { useEffect, useRef } from "preact/hooks";
import boltSvg from "../../assets/icons/bolt.svg?raw";
import { Icon } from "../../components/icon";
import type { HistoryFileInfo, MapData } from "../../types";
import { formatDuration, renderMap } from "./helpers";

interface HistoryItemViewProps {
    file: HistoryFileInfo;
    map: MapData | null;
    recording: boolean;
}

export function HistoryItemView({ file, map, recording }: HistoryItemViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Render canvas when map data changes
    useEffect(() => {
        if (map && canvasRef.current) {
            renderMap(canvasRef.current, map, recording);
        }
    }, [map, recording]);

    // Re-render on resize
    useEffect(() => {
        if (!map) return;
        const handleResize = () => {
            if (map && canvasRef.current) renderMap(canvasRef.current, map, recording);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [map, recording]);

    return (
        <>
            {/* Summary bar - use list metadata (available immediately) */}
            {file.summary && (
                <div class="history-detail-stats">
                    <div class="history-stat">
                        <span class="history-stat-label">Duration</span>
                        <span class="history-stat-value">{formatDuration(file.summary.duration)}</span>
                    </div>
                    <div class="history-stat">
                        <span class="history-stat-label">Distance</span>
                        <span class="history-stat-value">{file.summary.distanceTraveled.toFixed(1)}m</span>
                    </div>
                    <div class="history-stat">
                        <span class="history-stat-label">Area</span>
                        <span class="history-stat-value">{file.summary.areaCovered.toFixed(1)}m&sup2;</span>
                    </div>
                    <div class="history-stat">
                        <span class="history-stat-label">Battery</span>
                        <span class="history-stat-value">
                            {file.session?.battery ?? "?"}% &rarr;{" "}
                            {file.summary.batteryEnd ?? file.summary.battery ?? "?"}%
                        </span>
                    </div>
                    {file.summary.recharges > 0 && (
                        <div class="history-stat">
                            <span class="history-stat-label">Recharges</span>
                            <span class="history-stat-value">{file.summary.recharges}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Map canvas */}
            <div class="history-canvas-wrap">
                {!map && <div class="history-empty">Loading map...</div>}
                <canvas ref={canvasRef} class="history-canvas" style={map ? undefined : { display: "none" }} />
            </div>

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
        </>
    );
}
