import { useCallback, useRef, useState } from "preact/hooks";
import { api } from "../api";
import alertSvg from "../assets/icons/alert.svg?raw";
import boltSvg from "../assets/icons/bolt.svg?raw";
import checkSvg from "../assets/icons/check.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import gearSvg from "../assets/icons/gear.svg?raw";
import houseSvg from "../assets/icons/house.svg?raw";
import idleSvg from "../assets/icons/idle.svg?raw";
import sparkleSvg from "../assets/icons/sparkle.svg?raw";
import spotSvg from "../assets/icons/spot.svg?raw";
import stopSvg from "../assets/icons/stop.svg?raw";
import tagSvg from "../assets/icons/tag.svg?raw";
import wifiSvg from "../assets/icons/wifi.svg?raw";
import wifiOffSvg from "../assets/icons/wifi-off.svg?raw";
import robotSvg from "../assets/robot.svg?raw";
import { BatteryIcon } from "../components/battery-icon";
import { ErrorBanner } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate } from "../components/router";
import type { PollResult } from "../hooks/use-polling";
import type { ChargerData, ErrorData, FirmwareVersion, StateData, SystemData } from "../types";

// -- Helpers --

function statusInfo(s: string): { label: string; color: string; icon: string } {
    if (s.includes("CLEANINGRUNNING")) return { label: "Cleaning", color: "green", icon: "sparkle" };
    if (s.includes("CLEANINGPAUSED")) return { label: "Paused", color: "amber", icon: "alert" };
    if (s.includes("DOCKING")) return { label: "Docking", color: "amber", icon: "bolt" };
    if (s.includes("TESTMODE")) return { label: "Test", color: "amber", icon: "gear" };
    return { label: "Active", color: "green", icon: "check" };
}

const STATUS_ICONS: Record<string, string> = {
    check: checkSvg,
    sparkle: sparkleSvg,
    alert: alertSvg,
    bolt: boltSvg,
    gear: gearSvg,
};

const MODE_ICONS: Record<string, string> = {
    idle: idleSvg,
    house: houseSvg,
    spot: spotSvg,
    bolt: boltSvg,
};

function modeInfo(
    charging: boolean,
    docked: boolean,
    isSpot: boolean,
    isCleaning: boolean,
): { label: string; color: string; icon: string } {
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
    system: PollResult<SystemData>;
    firmware: PollResult<FirmwareVersion>;
    error: PollResult<ErrorData>;
    state: PollResult<StateData>;
    charger: PollResult<ChargerData>;
}

export function DashboardView({ system, firmware, error, state, charger }: DashboardViewProps) {
    const navigate = useNavigate();

    const connErr = state.error && charger.error;
    const hasData = state.data || charger.data;
    const offline = connErr && !hasData;

    const si = state.data ? statusInfo(state.data.uiState) : { label: "...", color: "amber", icon: "check" };

    // Pending state — disabled until backend confirms state change
    const [pending, setPending] = useState(false);
    const lastUiState = useRef<string | null>(null);

    if (state.data && state.data.uiState !== lastUiState.current) {
        lastUiState.current = state.data.uiState;
        if (pending) setPending(false);
    }

    const handleAction = useCallback((action: () => Promise<unknown>) => {
        setPending(true);
        action();
    }, []);
    const isCleaning = state.data?.uiState?.includes("CLEANING") ?? false;
    const isSpot = state.data?.uiState?.includes("SPOT") ?? false;
    const charging = charger.data?.chargingActive ?? false;
    const docked = charger.data?.extPwrPresent ?? false;
    const pct = charger.data?.fuelPercent ?? 0;
    const bc = charger.data ? battColor(pct) : "amber";
    const mi = modeInfo(charging, docked, isSpot, isCleaning);

    return (
        <>
            {/* Header */}
            <div class="header">
                <h1>OpenNeato</h1>
                <button
                    type="button"
                    class="header-right-btn"
                    aria-label="Settings"
                    onClick={() => navigate("/settings")}
                >
                    <Icon svg={gearSvg} />
                </button>
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
                            {Math.round((system.data.spiffsUsed / system.data.spiffsTotal) * 100)}%
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

            {/* Error banner */}
            {error.data?.hasError && <ErrorBanner message={error.data.errorMessage} />}

            {/* Hero area — robot right, cards left */}
            {offline ? (
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
                                <div class={`info-card-value ${bc}`}>{charger.data ? `${pct}%` : "..."}</div>
                            </div>
                            <div class="info-card-icon">
                                <BatteryIcon pct={pct} />
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

            {/* Bottom action bar */}
            <div class="action-bar">
                <div class="action-bar-row">
                    <button
                        type="button"
                        class={`action-btn primary${pending ? " pending" : ""}`}
                        onClick={() => handleAction(api.cleanHouse)}
                        disabled={offline || isCleaning || pending}
                    >
                        <Icon svg={houseSvg} />
                        House
                    </button>
                    <button
                        type="button"
                        class={`action-btn${pending ? " pending" : ""}`}
                        onClick={() => handleAction(api.cleanSpot)}
                        disabled={offline || isCleaning || pending}
                    >
                        <Icon svg={spotSvg} />
                        Spot
                    </button>
                    <button
                        type="button"
                        class={`action-btn${pending ? " pending" : ""}`}
                        onClick={() => handleAction(api.cleanStop)}
                        disabled={offline || !isCleaning || pending}
                    >
                        <Icon svg={stopSvg} />
                        Stop
                    </button>
                </div>
            </div>
        </>
    );
}
