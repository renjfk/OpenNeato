// HTTP API types are generated from frontend/api/openapi.yaml. Edit the spec,
// not this file. The build pipeline runs `openapi-typescript` to refresh
// types.generated.ts before tsc.
export type {
    ChargerData,
    ErrorData,
    FirmwareVersion,
    HistoryFileInfo,
    LidarPoint,
    LidarScan,
    LogFileInfo,
    ManualStatus,
    MapSession,
    MapSummary,
    MotorData,
    SettingsData,
    StateData,
    SystemData,
    UserSettingsData,
    VersionData,
} from "./types.generated";

// -- Frontend-only types (not part of the HTTP API) --------------------------
// These describe shapes used internally by the map view and aren't exchanged
// over the wire.

export interface MapPathPoint {
    x: number;
    y: number;
    t: number;
    ts: number;
}

export interface MapBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface MapRechargePoint {
    x: number;
    y: number;
    // Session-relative timestamp when the robot returned to base to charge,
    // derived from the last pose snapshot before collection paused.
    ts: number;
    // Session-relative timestamp when cleaning resumed after the charge —
    // taken from the first pose snapshot written once collection restarted.
    // Falls back to `ts` when the session ended before resuming.
    endTs: number;
}

// Coverage cell with the session-relative timestamp (seconds) at which the
// cell was first stamped. Used by the motion player to reveal coverage
// progressively during playback.
export type MapCoverageCell = [cx: number, cy: number, ts: number];

export interface MapTransform {
    panX: number;
    panY: number;
    zoom: number;
}

export interface MapData {
    session: import("./types.generated").MapSession | null;
    summary: import("./types.generated").MapSummary | null;
    path: MapPathPoint[];
    coverage: MapCoverageCell[];
    recharges: MapRechargePoint[];
    bounds: MapBounds | null;
    cellSize: number;
}
