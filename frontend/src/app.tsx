import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { BatteryIcon } from "./components/battery-icon";
import { Icon } from "./components/icon";
import { Settings } from "./components/settings";
import { usePolling } from "./hooks/use-polling";
import type { ChargerData, ErrorData, StateData, SystemData } from "./types";

type Theme = "system" | "dark" | "light";

function applyTheme(theme: Theme) {
    const html = document.documentElement;
    html.classList.remove("light", "system-theme");
    if (theme === "light") {
        html.classList.add("light");
    } else if (theme === "system") {
        html.classList.add("system-theme");
    }
    // "dark" = no extra class, just :root defaults
}

function loadTheme(): Theme {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "system";
}

import alertSvg from "./assets/icons/alert.svg?raw";
import boltSvg from "./assets/icons/bolt.svg?raw";
import checkSvg from "./assets/icons/check.svg?raw";
import gearSvg from "./assets/icons/gear.svg?raw";
import houseSvg from "./assets/icons/house.svg?raw";
import powerSvg from "./assets/icons/power.svg?raw";
import sparkleSvg from "./assets/icons/sparkle.svg?raw";
import spotSvg from "./assets/icons/spot.svg?raw";
import stopSvg from "./assets/icons/stop.svg?raw";
import wifiOffSvg from "./assets/icons/wifi-off.svg?raw";
// SVG assets (inlined at build time via Vite ?raw)
import robotSvg from "./assets/robot.svg?raw";

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
    sparkle: sparkleSvg,
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
    return { label: "Idle", color: "green", icon: "sparkle" };
}

function battColor(pct: number): string {
    if (pct <= 25) return "red";
    if (pct <= 50) return "amber";
    return "green";
}

// -- Main App --

export function App() {
    const [page, setPage] = useState<"dashboard" | "settings">("dashboard");
    const [theme, setTheme] = useState<Theme>(loadTheme);

    const themeInitialized = useRef(false);
    useEffect(() => {
        applyTheme(theme);
        if (themeInitialized.current) {
            localStorage.setItem("theme", theme);
        }
        themeInitialized.current = true;
    }, [theme]);

    const state = usePolling<StateData>(api.getState, 2000);
    const charger = usePolling<ChargerData>(api.getCharger, 5000);
    const error = usePolling<ErrorData>(api.getError, 2000);
    const _system = usePolling<SystemData>(api.getSystem, 10000);

    const connErr = state.error && charger.error;
    const hasData = state.data || charger.data;
    const offline = connErr && !hasData;

    const si = state.data ? statusInfo(state.data.uiState) : { label: "...", color: "amber", icon: "check" };
    const isOn = hasData && !state.data?.uiState?.includes("SHUTDOWN");

    // Pending state — disabled until backend confirms state change
    const [pending, setPending] = useState(false);
    const lastUiState = useRef<string | null>(null);

    if (state.data && state.data.uiState !== lastUiState.current) {
        lastUiState.current = state.data.uiState;
        if (pending) setPending(false);
    }

    const handlePowerToggle = useCallback(() => {
        setPending(true);
        if (isOn) api.shutdown();
        else api.wakeUp();
    }, [isOn]);

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

    if (page === "settings") {
        return <Settings theme={theme} onThemeChange={setTheme} onBack={() => setPage("dashboard")} />;
    }

    return (
        <>
            {/* Header */}
            <div class="header">
                <h1>OpenNeato</h1>
                <button
                    type="button"
                    class="header-right-btn"
                    aria-label="Settings"
                    onClick={() => setPage("settings")}
                >
                    <Icon svg={gearSvg} />
                </button>
            </div>

            {/* On/Off toggle pill */}
            <button
                type="button"
                class={`power-pill${isOn ? " on" : ""}${pending ? " pending" : ""}`}
                onClick={handlePowerToggle}
                disabled={offline || pending}
                aria-label={isOn ? "Turn off" : "Turn on"}
            >
                <span class="power-pill-label">On</span>
                <div class="power-pill-knob">
                    <Icon svg={powerSvg} />
                </div>
                <span class="power-pill-label">Off</span>
            </button>

            {/* Error banner */}
            {error.data?.hasError && (
                <div class="error-banner">
                    <div class="error-banner-row">
                        <div class="error-banner-icon">
                            <Icon svg={alertSvg} />
                        </div>
                        <div>
                            <div class="error-banner-title">Alert</div>
                            <div class="error-banner-msg">{error.data.errorMessage}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Hero area — robot right, cards left */}
            {offline ? (
                <div class="conn-error">
                    <Icon svg={wifiOffSvg} />
                    Unable to reach robot
                </div>
            ) : !isOn ? (
                <div class="conn-error">
                    <Icon svg={powerSvg} />
                    Robot is off
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
                        disabled={!isOn || isCleaning || pending}
                    >
                        <Icon svg={houseSvg} />
                        House
                    </button>
                    <button
                        type="button"
                        class={`action-btn${pending ? " pending" : ""}`}
                        onClick={() => handleAction(api.cleanSpot)}
                        disabled={!isOn || isCleaning || pending}
                    >
                        <Icon svg={spotSvg} />
                        Spot
                    </button>
                    <button
                        type="button"
                        class={`action-btn${pending ? " pending" : ""}`}
                        onClick={() => handleAction(api.cleanStop)}
                        disabled={!isOn || !isCleaning || pending}
                    >
                        <Icon svg={stopSvg} />
                        Stop
                    </button>
                </div>
            </div>
        </>
    );
}
