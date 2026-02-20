import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import backSvg from "../assets/icons/back.svg?raw";
import boltSvg from "../assets/icons/bolt.svg?raw";
import brushSvg from "../assets/icons/brush.svg?raw";
import sideBrushSvg from "../assets/icons/side-brush.svg?raw";
import sparkleSvg from "../assets/icons/sparkle.svg?raw";
import stopSvg from "../assets/icons/stop.svg?raw";
import vacuumSvg from "../assets/icons/vacuum.svg?raw";
import { BatteryIcon } from "../components/battery-icon";
import { Icon } from "../components/icon";
import type { JoystickValue } from "../components/joystick";
import { Joystick } from "../components/joystick";
import { LidarMap } from "../components/lidar-map";
import { useNavigate } from "../components/router";
import { usePolling } from "../hooks/use-polling";
import type { ChargerData, LidarScan, ManualStatus } from "../types";

// Convert joystick X/Y to differential wheel distances (mm).
// We send a large fixed distance so the robot keeps moving continuously until
// the next command changes direction or a stop cancels it. The firmware watchdog
// stops wheels if no command arrives within MANUAL_MOVE_TIMEOUT_MS (2s).
const MOVE_DIST_MM = 10000; // Protocol max — robot moves until next command
const MAX_SPEED_MM_S = 200;

interface WheelCommand {
    left: number;
    right: number;
    speed: number;
}

function clamp(val: number, min: number, max: number): number {
    return val < min ? min : val > max ? max : val;
}

function joystickToWheels(v: JoystickValue): WheelCommand {
    if (v.magnitude === 0) return { left: 0, right: 0, speed: 0 };

    const speed = Math.round(v.magnitude * MAX_SPEED_MM_S);
    // Normalize direction from joystick, then apply fixed long distance.
    // The ratio of left/right determines the turn arc; speed controls pace.
    const fwd = v.y * MOVE_DIST_MM;
    const turn = v.x * MOVE_DIST_MM;

    // Robot rejects LWheelDist/RWheelDist outside ±10000mm
    const left = Math.round(clamp(fwd + turn, -MOVE_DIST_MM, MOVE_DIST_MM));
    const right = Math.round(clamp(fwd - turn, -MOVE_DIST_MM, MOVE_DIST_MM));
    return { left, right, speed };
}

interface ManualViewProps {
    isManual: boolean;
    status: ManualStatus | null;
    brush: boolean;
    vacuum: boolean;
    sideBrush: boolean;
    onToggleBrush: () => Promise<void>;
    onToggleVacuum: () => Promise<void>;
    onToggleSideBrush: () => Promise<void>;
    onToggleAll: () => Promise<void>;
}

function safetyWarning(status: ManualStatus | null): string | null {
    if (!status) return null;
    if (status.lifted) return "Robot is lifted";
    // Stall: direction-aware message
    if (status.stallFront) return "Stall detected — reverse to clear";
    if (status.stallRear) return "Stall detected — move forward to clear";
    // Physical bumper contact
    const bumpers: string[] = [];
    if (status.bumperFrontLeft) bumpers.push("front-left");
    if (status.bumperFrontRight) bumpers.push("front-right");
    if (status.bumperSideLeft) bumpers.push("side-left");
    if (status.bumperSideRight) bumpers.push("side-right");
    if (bumpers.length > 0) return `Bumper: ${bumpers.join(", ")} — reverse to clear`;
    return null;
}

export function ManualView({
    isManual,
    status,
    brush,
    vacuum,
    sideBrush,
    onToggleBrush,
    onToggleVacuum,
    onToggleSideBrush,
    onToggleAll,
}: ManualViewProps) {
    const navigate = useNavigate();
    const charger = usePolling<ChargerData>(api.getCharger, 5000);
    const [stopping, setStopping] = useState(false);
    const [motorPending, setMotorPending] = useState(false);
    const [moving, setMoving] = useState(false);
    const [mapSize, setMapSize] = useState(280);
    const mapContainerRef = useRef<HTMLDivElement>(null);

    const wrapMotorToggle = useCallback(
        (toggle: () => Promise<void>) => {
            if (motorPending) return;
            setMotorPending(true);
            toggle()
                .catch(() => {})
                .finally(() => setMotorPending(false));
        },
        [motorPending],
    );

    // Poll LIDAR only when in manual mode
    const lidar = usePolling<LidarScan>(api.getLidar, isManual ? 1000 : 0);

    // Measure available map container width
    useEffect(() => {
        const el = mapContainerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.floor(entry.contentRect.width);
                setMapSize(Math.min(w, 400));
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Send move command (fire-and-forget, throttled on change).
    // The firmware client watchdog uses WebServer::lastApiActivity — any API
    // request (polling, motor toggles, etc.) keeps it alive. Move commands are
    // only sent when the joystick direction actually changes.
    const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastMove = useRef<WheelCommand | null>(null);
    const lastSent = useRef<WheelCommand | null>(null);

    const onJoystickMove = useCallback(
        (v: JoystickValue) => {
            if (!isManual || stopping) return;
            const wheels = joystickToWheels(v);
            lastMove.current = wheels;
            setMoving(wheels.left !== 0 || wheels.right !== 0);

            if (moveTimer.current) return;
            moveTimer.current = setTimeout(() => {
                moveTimer.current = null;
                const m = lastMove.current;
                if (!m || (m.left === 0 && m.right === 0)) return;
                // Skip if wheel command hasn't meaningfully changed (within ~5% of max distance)
                const prev = lastSent.current;
                if (
                    prev &&
                    Math.abs(m.left - prev.left) < 500 &&
                    Math.abs(m.right - prev.right) < 500 &&
                    Math.abs(m.speed - prev.speed) < 10
                )
                    return;
                lastSent.current = m;
                api.manualMove(m.left, m.right, m.speed).catch(() => {});
            }, 200);
        },
        [isManual, stopping],
    );

    const onJoystickRelease = useCallback(() => {
        if (!isManual || stopping) return;
        lastMove.current = null;
        lastSent.current = null;
        setMoving(false);
        if (moveTimer.current) {
            clearTimeout(moveTimer.current);
            moveTimer.current = null;
        }
        api.manualMove(0, 0, 0).catch(() => {});
    }, [isManual, stopping]);

    // Navigate away only after polled state confirms manual mode ended
    useEffect(() => {
        if (stopping && !isManual) {
            navigate("/");
        }
    }, [stopping, isManual, navigate]);

    const handleStop = useCallback(() => {
        if (stopping) return;
        setStopping(true);
        api.manual(false).catch(() => setStopping(false));
    }, [stopping]);

    return (
        <>
            {/* Header */}
            <div class="header">
                <button
                    type="button"
                    class="header-back-btn"
                    aria-label="Back"
                    disabled={stopping}
                    onClick={() => navigate("/")}
                >
                    <Icon svg={backSvg} />
                </button>
                <h1>Manual</h1>
                <div class="header-right-spacer" />
            </div>

            <div class="manual-page">
                {/* LIDAR map */}
                <div class="manual-map" ref={mapContainerRef}>
                    <LidarMap scan={lidar.data} size={mapSize} moving={moving} />
                    {charger.data && (
                        <div class="manual-map-battery">
                            <BatteryIcon pct={charger.data.fuelPercent} />
                            <span>{charger.data.fuelPercent}%</span>
                            {(charger.data.chargingActive || charger.data.extPwrPresent) && <Icon svg={boltSvg} />}
                        </div>
                    )}
                    {!lidar.data && !isManual && (
                        <div class="manual-map-warn manual-map-center">Not in manual mode</div>
                    )}
                    {!lidar.data && isManual && lidar.error && (
                        <div class="manual-map-warn manual-map-center">LIDAR unavailable</div>
                    )}
                    {safetyWarning(status) && (
                        <div class="manual-map-warn manual-map-top error">{safetyWarning(status)}</div>
                    )}
                    {lidar.data &&
                        (lidar.data.validPoints < 90 ||
                            (lidar.data.rotationSpeed > 0 && lidar.data.rotationSpeed < 4.0)) && (
                            <div class="manual-map-warn">
                                {[
                                    lidar.data.validPoints < 90 && `Low quality (${lidar.data.validPoints}/360)`,
                                    lidar.data.rotationSpeed > 0 &&
                                        lidar.data.rotationSpeed < 4.0 &&
                                        `Slow LDS (${lidar.data.rotationSpeed.toFixed(1)} Hz)`,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </div>
                        )}
                </div>

                {/* Controls area */}
                <div class={`manual-controls${isManual && !stopping ? "" : " disabled"}`}>
                    {/* Joystick */}
                    <div class="manual-joystick">
                        <Joystick size={160} onMove={onJoystickMove} onRelease={onJoystickRelease} />
                    </div>

                    {/* Motor toggles */}
                    <div class="manual-motors">
                        <button
                            type="button"
                            class={`manual-motor-btn${brush ? " active" : ""}${motorPending ? " pending" : ""}`}
                            disabled={!isManual || stopping || motorPending || status?.lifted}
                            onClick={() => wrapMotorToggle(onToggleBrush)}
                        >
                            <Icon svg={brushSvg} />
                            Brush
                        </button>
                        <button
                            type="button"
                            class={`manual-motor-btn${vacuum ? " active" : ""}${motorPending ? " pending" : ""}`}
                            disabled={!isManual || stopping || motorPending || status?.lifted}
                            onClick={() => wrapMotorToggle(onToggleVacuum)}
                        >
                            <Icon svg={vacuumSvg} />
                            Vacuum
                        </button>
                        <button
                            type="button"
                            class={`manual-motor-btn${sideBrush ? " active" : ""}${motorPending ? " pending" : ""}`}
                            disabled={!isManual || stopping || motorPending || status?.lifted}
                            onClick={() => wrapMotorToggle(onToggleSideBrush)}
                        >
                            <Icon svg={sideBrushSvg} />
                            Side
                        </button>
                        <button
                            type="button"
                            class={`manual-motor-btn${brush && vacuum && sideBrush ? " active" : ""}${motorPending ? " pending" : ""}`}
                            disabled={!isManual || stopping || motorPending || status?.lifted}
                            onClick={() => wrapMotorToggle(onToggleAll)}
                        >
                            <Icon svg={sparkleSvg} />
                            All
                        </button>
                    </div>
                </div>

                {/* Stop button */}
                <div class="manual-stop">
                    <button
                        type="button"
                        class={`action-btn manual-stop-btn${stopping ? " pending" : ""}`}
                        disabled={!isManual || stopping}
                        onClick={handleStop}
                    >
                        <Icon svg={stopSvg} />
                        Stop
                    </button>
                </div>
            </div>
        </>
    );
}
