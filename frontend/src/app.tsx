import { api } from "./api";
import { usePolling } from "./hooks/use-polling";
import { Icon } from "./components/icon";
import { BatteryIcon } from "./components/battery-icon";
import type { StateData, ChargerData, ErrorData, SystemData } from "./types";

// SVG assets (inlined at build time via Vite ?raw)
import robotSvg from "./assets/robot.svg?raw";
import gearSvg from "./assets/icons/gear.svg?raw";
import checkSvg from "./assets/icons/check.svg?raw";
import sparkleSvg from "./assets/icons/sparkle.svg?raw";
import powerSvg from "./assets/icons/power.svg?raw";
import playSvg from "./assets/icons/play.svg?raw";
import spotSvg from "./assets/icons/spot.svg?raw";
import stopSvg from "./assets/icons/stop.svg?raw";
import findSvg from "./assets/icons/find.svg?raw";
import alertSvg from "./assets/icons/alert.svg?raw";
import wifiOffSvg from "./assets/icons/wifi-off.svg?raw";

// -- Helpers --

function statusInfo(s: string): { label: string; color: string } {
    if (s.includes("HOUSECLEANINGRUNNING")) return { label: "Cleaning", color: "green" };
    if (s.includes("HOUSECLEANINGPAUSED")) return { label: "Paused", color: "amber" };
    if (s.includes("SPOTCLEANINGRUNNING")) return { label: "Spot", color: "blue" };
    if (s.includes("SPOTCLEANINGPAUSED")) return { label: "Paused", color: "amber" };
    if (s.includes("DOCKING")) return { label: "Docking", color: "amber" };
    if (s.includes("TESTMODE")) return { label: "Test", color: "amber" };
    return { label: "Active", color: "green" };
}

function battColor(pct: number): string {
    if (pct <= 15) return "red";
    if (pct <= 35) return "amber";
    return "green";
}

// -- Main App --

export function App() {
    const state = usePolling<StateData>(api.getState, 2000);
    const charger = usePolling<ChargerData>(api.getCharger, 5000);
    const error = usePolling<ErrorData>(api.getError, 2000);
    const system = usePolling<SystemData>(api.getSystem, 10000);

    const connErr = state.error && charger.error;
    const hasData = state.data || charger.data;

    const si = state.data ? statusInfo(state.data.uiState) : { label: "...", color: "amber" };
    const isCleaning = state.data?.uiState?.includes("CLEANING") ?? false;
    const charging = charger.data?.chargingActive ?? false;
    const docked = charger.data?.extPwrPresent ?? false;
    const pct = charger.data?.fuelPercent ?? 0;
    const bc = charger.data ? battColor(pct) : "amber";
    const modeLabel = charging ? "Charging" : docked ? "Docked" : isCleaning ? "Deep" : "Idle";
    const modeColor = charging ? "amber" : isCleaning ? "blue" : "green";

    return (
        <>
            {/* Header */}
            <div class="header">
                <h1>OpenNeato</h1>
                <button class="header-right-btn" aria-label="Settings">
                    <Icon svg={gearSvg} />
                </button>
            </div>

            {/* On/Off pill */}
            <div class={`online-pill${hasData ? "" : " off"}`}>
                <span>{hasData ? "On" : "Off"}</span>
                <div class="power-icon-circle">
                    <Icon svg={powerSvg} />
                </div>
            </div>

            {/* Error banner */}
            {error.data?.hasError && (
                <div class="error-banner">
                    <div class="error-banner-row">
                        <div class="error-banner-icon"><Icon svg={alertSvg} /></div>
                        <div>
                            <div class="error-banner-title">Alert</div>
                            <div class="error-banner-msg">{error.data.errorMessage}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Hero area — robot right, cards left */}
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
                        <div class={`info-card-icon ${si.color}`}><Icon svg={checkSvg} /></div>
                    </div>

                    <div class="info-card">
                        <div class="info-card-left">
                            <div class="info-card-label">Battery</div>
                            <div class={`info-card-value ${bc}`}>
                                {charger.data ? `${pct}%` : "..."}
                            </div>
                        </div>
                        <div class="info-card-icon">
                            <BatteryIcon pct={pct} color={bc} />
                        </div>
                    </div>

                    <div class="info-card">
                        <div class="info-card-left">
                            <div class="info-card-label">Mode</div>
                            <div class={`info-card-value ${modeColor}`}>{modeLabel}</div>
                        </div>
                        <div class={`info-card-icon ${modeColor}`}><Icon svg={sparkleSvg} /></div>
                    </div>
                </div>
            </div>

            {/* Connection error */}
            {connErr && !hasData && (
                <div class="conn-error">
                    <Icon svg={wifiOffSvg} />
                    Unable to reach robot
                </div>
            )}

            {/* Bottom action bar */}
            <div class="action-bar">
                <div class="action-bar-row">
                    <button
                        class="action-btn primary"
                        onClick={() => api.cleanHouse()}
                        disabled={isCleaning}
                    >
                        <Icon svg={playSvg} />
                        Start
                    </button>
                    <button
                        class="action-btn"
                        onClick={() => api.cleanSpot()}
                        disabled={isCleaning}
                    >
                        <Icon svg={spotSvg} />
                        Spot
                    </button>
                    <button
                        class="action-btn"
                        onClick={() => api.cleanStop()}
                    >
                        <Icon svg={stopSvg} />
                        Stop
                    </button>
                    <button
                        class="action-btn"
                        onClick={() => api.playSound(0)}
                    >
                        <Icon svg={findSvg} />
                        Find
                    </button>
                </div>
            </div>
        </>
    );
}
