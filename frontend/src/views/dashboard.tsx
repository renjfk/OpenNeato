import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import alertSvg from "../assets/icons/alert.svg?raw";
import boltSvg from "../assets/icons/bolt.svg?raw";
import checkSvg from "../assets/icons/check.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import dockSvg from "../assets/icons/dock.svg?raw";
import gearSvg from "../assets/icons/gear.svg?raw";
import historySvg from "../assets/icons/history.svg?raw";
import houseSvg from "../assets/icons/house.svg?raw";
import idleSvg from "../assets/icons/idle.svg?raw";
import manualSvg from "../assets/icons/manual.svg?raw";
import pauseSvg from "../assets/icons/pause.svg?raw";
import playSvg from "../assets/icons/play.svg?raw";
import sparkleSvg from "../assets/icons/sparkle.svg?raw";
import spotSvg from "../assets/icons/spot.svg?raw";
import stopSvg from "../assets/icons/stop.svg?raw";
import tagSvg from "../assets/icons/tag.svg?raw";
import wifiSvg from "../assets/icons/wifi.svg?raw";
import wifiOffSvg from "../assets/icons/wifi-off.svg?raw";
import robotSvg from "../assets/robot.svg?raw";
import { BatteryIcon } from "../components/battery-icon";
import { ErrorBanner, ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate } from "../components/router";
import type { PollResult } from "../hooks/use-polling";
import { usePolling } from "../hooks/use-polling";
import type { ChargerData, ErrorData, FirmwareVersion, StateData, SystemData } from "../types";
import type { UpdateInfo } from "../update";

// -- Helpers --

interface StatusInfo {
    label: string;
    color: string;
    icon: string;
}

function statusInfo(s: string): StatusInfo {
    if (s.includes("CLEANINGRUNNING")) return { label: "Cleaning", color: "green", icon: "sparkle" };
    if (s.includes("CLEANINGPAUSED")) return { label: "Paused", color: "amber", icon: "alert" };
    if (s.includes("CLEANINGSUSPENDED")) return { label: "Recharging", color: "amber", icon: "bolt" };
    if (s.includes("MANUALCLEANING")) return { label: "Cleaning", color: "green", icon: "sparkle" };
    if (s.includes("DOCKING")) return { label: "Docking", color: "amber", icon: "bolt" };
    return { label: "Active", color: "green", icon: "check" };
}

const STATUS_ICONS: Record<string, string> = {
    check: checkSvg,
    sparkle: sparkleSvg,
    alert: alertSvg,
    bolt: boltSvg,
    manual: manualSvg,
};

const MODE_ICONS: Record<string, string> = {
    idle: idleSvg,
    house: houseSvg,
    spot: spotSvg,
    bolt: boltSvg,
    alert: alertSvg,
    manual: manualSvg,
};

function modeInfo(
    charging: boolean,
    docked: boolean,
    isSpot: boolean,
    isCleaning: boolean,
    isManual: boolean,
): StatusInfo {
    if (isManual) return { label: "Manual", color: "blue", icon: "manual" };
    if (charging) return { label: "Charging", color: "amber", icon: "bolt" };
    if (docked) return { label: "Docked", color: "amber", icon: "bolt" };
    if (isSpot) return { label: "Spot", color: "blue", icon: "spot" };
    if (isCleaning) return { label: "House", color: "blue", icon: "house" };
    return { label: "Idle", color: "green", icon: "idle" };
}

function battColor(pct: number): string {
    if (pct <= 25) return "red";
    if (pct <= 50) return "amber";
    return "green";
}

function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
}

function wifiStrength(rssi: number): string {
    if (rssi >= -50) return "Excellent";
    if (rssi >= -60) return "Good";
    if (rssi >= -70) return "Fair";
    return "Weak";
}

// -- Dashboard view --

interface DashboardViewProps {
    firmware: PollResult<FirmwareVersion>;
    state: PollResult<StateData>;
    isManual: boolean;
    updateInfo: UpdateInfo | null;
    robotReady: boolean;
    identifying: boolean;
}

export function DashboardView({ firmware, state, isManual, updateInfo, robotReady, identifying }: DashboardViewProps) {
    const navigate = useNavigate();
    const charger = usePolling<ChargerData>(api.getCharger, 5000);
    const error = usePolling<ErrorData>(api.getError, 2000);
    const system = usePolling<SystemData>(api.getSystem, 10000);

    const connErr = state.error && charger.error;
    const hasData = state.data || charger.data;
    const offline = connErr && !hasData;

    const si = state.data
        ? statusInfo(state.data.uiState)
        : { label: state.error ? "Error" : "...", color: state.error ? "red" : "amber", icon: "alert" };

    // Pending state — disabled until backend confirms state change or timeout
    const [pending, setPending] = useState(false);
    const lastUiState = useRef<string | null>(null);
    const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingManual = useRef(false);
    const [actionErrors, actionErrorStack] = useErrorStack();

    if (state.data && state.data.uiState !== lastUiState.current) {
        lastUiState.current = state.data.uiState;
        if (pending) {
            setPending(false);
            if (pendingTimer.current) {
                clearTimeout(pendingTimer.current);
                pendingTimer.current = null;
            }
        }
    }

    // Navigate to manual page only after polled state confirms MANUALCLEANING
    useEffect(() => {
        if (isManual && pendingManual.current) {
            pendingManual.current = false;
            navigate("/manual");
        }
    }, [isManual, navigate]);

    const handleAction = useCallback(
        (action: () => Promise<unknown>) => {
            setPending(true);
            if (pendingTimer.current) clearTimeout(pendingTimer.current);
            pendingTimer.current = setTimeout(() => {
                setPending(false);
                pendingManual.current = false;
                pendingTimer.current = null;
            }, 10000);
            action().catch((e: unknown) => {
                setPending(false);
                pendingManual.current = false;
                if (pendingTimer.current) {
                    clearTimeout(pendingTimer.current);
                    pendingTimer.current = null;
                }
                actionErrorStack.push(e instanceof Error ? e.message : "Action failed");
            });
        },
        [actionErrorStack],
    );

    const isRunning = state.data?.uiState?.includes("CLEANINGRUNNING") ?? false;
    const isPaused = state.data?.uiState?.includes("CLEANINGPAUSED") ?? false;
    const isDocking = state.data?.uiState?.includes("DOCKING") ?? false;
    const isSuspended = state.data?.uiState?.includes("CLEANINGSUSPENDED") ?? false;
    const isCleaning = isRunning || isPaused || isSuspended;
    const isSpot = state.data?.uiState?.includes("SPOT") ?? false;
    const robotError = error.data?.hasError
        ? {
              kind: (error.data.kind === "warning" ? "warning" : "error") as "error" | "warning",
              title: error.data.kind === "warning" ? "Robot Notice" : "Robot Attention Needed",
              message: error.data.displayMessage || `Robot reported error ${error.data.errorCode}.`,
          }
        : null;
    const hasRobotError = robotError?.kind === "error";
    const charging = charger.data?.chargingActive ?? false;
    const docked = charger.data?.extPwrPresent ?? false;
    const pct = charger.data?.fuelPercent ?? 0;
    const bc = charger.data ? battColor(pct) : charger.error ? "red" : "amber";
    const modeErr = (!state.data && state.error) || (!charger.data && charger.error);
    const mi = modeErr
        ? { label: "Error", color: "red", icon: "alert" }
        : modeInfo(charging, docked, isSpot, isCleaning, isManual);

    return (
        <>
            {/* Header */}
            <div class="header">
                <h1>OpenNeato</h1>
                <div class="header-btns">
                    <button
                        type="button"
                        class="header-right-btn"
                        aria-label="Cleaning History"
                        onClick={() => navigate("/history")}
                        disabled={!robotReady}
                    >
                        <Icon svg={historySvg} />
                    </button>
                    <button
                        type="button"
                        class="header-right-btn"
                        aria-label="Settings"
                        onClick={() => navigate("/settings")}
                    >
                        <Icon svg={gearSvg} />
                    </button>
                </div>
            </div>

            {/* Status bar */}
            {system.data && !offline && (
                <div class="status-bar">
                    <div class="status-bar-item">
                        <div class="status-bar-label">WiFi</div>
                        <div class="status-bar-value">
                            <Icon svg={wifiSvg} />
                            {wifiStrength(system.data.rssi)}
                        </div>
                    </div>
                    <div class="status-bar-item">
                        <div class="status-bar-label">Uptime</div>
                        <div class="status-bar-value">
                            <Icon svg={clockSvg} />
                            {formatUptime(system.data.uptime)}
                        </div>
                    </div>
                    <div class="status-bar-item">
                        <div class="status-bar-label">Storage</div>
                        <div class="status-bar-value">
                            <Icon svg={databaseSvg} />
                            {Math.round((system.data.fsUsed / system.data.fsTotal) * 100)}%
                        </div>
                    </div>
                    {firmware.data && (
                        <div class="status-bar-item">
                            <div class="status-bar-label">Firmware</div>
                            <div class="status-bar-value">
                                <Icon svg={tagSvg} />
                                {firmware.data.version}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Update notification */}
            {updateInfo && (
                <a class="update-banner" href={updateInfo.url} target="_blank" rel="noopener noreferrer">
                    <Icon svg={tagSvg} />
                    Update available: v{updateInfo.version} — tap to view release
                </a>
            )}

            {/* Robot error/warning — fixed, clears automatically when robot resolves it */}
            {robotError && (
                <ErrorBanner title={robotError.title} message={robotError.message} variant={robotError.kind} />
            )}
            {!error.data && error.error && !connErr && <ErrorBanner title="Warning" message={error.error} />}

            {/* Action errors — dismissible, stackable */}
            <ErrorBannerStack errors={actionErrors} />

            {/* Hero area — robot right, cards left */}
            {!robotReady ? (
                <div class="hero-area gate-hero">
                    <div class="robot-float gate-robot">
                        <Icon svg={robotSvg} />
                    </div>
                    {identifying ? (
                        <p class="gate-message">Connecting to robot...</p>
                    ) : (
                        <div class="gate-message">
                            <Icon svg={alertSvg} />
                            <h2>Unsupported Robot</h2>
                            <p>
                                OpenNeato requires a Neato Botvac D3, D4, D5, D6, or D7.
                                <br />
                                The connected robot could not be identified.
                            </p>
                        </div>
                    )}
                </div>
            ) : offline ? (
                <div class="conn-error">
                    <Icon svg={wifiOffSvg} />
                    Unable to reach robot
                </div>
            ) : (
                <div class="hero-area">
                    <div class="robot-float">
                        <Icon svg={robotSvg} />
                    </div>

                    <div class="info-cards">
                        <div class="info-card">
                            <div class="info-card-left">
                                <div class="info-card-label">Status</div>
                                <div class={`info-card-value ${si.color}`}>{si.label}</div>
                            </div>
                            <div class={`info-card-icon ${si.color}`}>
                                <Icon svg={STATUS_ICONS[si.icon]} />
                            </div>
                        </div>

                        <div class="info-card">
                            <div class="info-card-left">
                                <div class="info-card-label">Battery</div>
                                <div class={`info-card-value ${bc}`}>
                                    {charger.data ? `${pct}%` : charger.error ? "Error" : "..."}
                                </div>
                            </div>
                            <div class={`info-card-icon ${charger.error && !charger.data ? "red" : ""}`}>
                                {charger.error && !charger.data ? <Icon svg={alertSvg} /> : <BatteryIcon pct={pct} />}
                            </div>
                        </div>

                        <div class="info-card">
                            <div class="info-card-left">
                                <div class="info-card-label">Mode</div>
                                <div class={`info-card-value ${mi.color}`}>{mi.label}</div>
                            </div>
                            <div class={`info-card-icon ${mi.color}`}>
                                <Icon svg={MODE_ICONS[mi.icon]} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom action bar — always 3 buttons */}
            <div class="action-bar">
                <div class="action-bar-row">
                    {isCleaning ? (
                        <>
                            {/* Cleaning: Pause/Resume, Dock, Stop */}
                            <button
                                type="button"
                                class={`action-btn primary${pending ? " pending" : ""}`}
                                onClick={() => handleAction(isPaused ? api.cleanHouse : api.cleanPause)}
                                disabled={!robotReady || offline || pending}
                            >
                                <Icon svg={isPaused ? playSvg : pauseSvg} />
                                {isPaused ? "Resume" : "Pause"}
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanDock)}
                                disabled={!robotReady || offline || pending}
                            >
                                <Icon svg={dockSvg} />
                                Dock
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanStop)}
                                disabled={!robotReady || offline || pending}
                            >
                                <Icon svg={stopSvg} />
                                Stop
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Idle / Docking / Manual: House, Spot, Manual/Stop */}
                            <button
                                type="button"
                                class={`action-btn primary${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanHouse)}
                                disabled={!robotReady || offline || isDocking || isManual || pending || hasRobotError}
                            >
                                <Icon svg={houseSvg} />
                                House
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanSpot)}
                                disabled={!robotReady || offline || isDocking || isManual || pending || hasRobotError}
                            >
                                <Icon svg={spotSvg} />
                                Spot
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() =>
                                    isDocking
                                        ? handleAction(api.cleanStop)
                                        : isManual
                                          ? navigate("/manual")
                                          : handleAction(() => {
                                                pendingManual.current = true;
                                                return api.manual(true);
                                            })
                                }
                                disabled={
                                    !robotReady ||
                                    offline ||
                                    (pending && !isManual) ||
                                    (hasRobotError && !isManual && !isDocking)
                                }
                            >
                                <Icon svg={isDocking ? stopSvg : manualSvg} />
                                {isDocking ? "Stop" : "Manual"}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
