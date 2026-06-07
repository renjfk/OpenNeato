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
import { T, useI18n } from "../i18n";
import type { ChargerData, ErrorData, FirmwareVersion, SettingsData, StateData, SystemData } from "../types";
import type { UpdateInfo } from "../update";
import { normalizeError } from "../utils";

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

function wifiStrength(rssi: number): string {
    if (rssi >= -50) return "Excellent";
    if (rssi >= -60) return "Good";
    if (rssi >= -70) return "Fair";
    return "Weak";
}

const LOCAL_TIME_DAY_TO_SCHED_DAY: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
};

function readSlot(settings: SettingsData, day: number, slot: number) {
    const prefix = slot === 0 ? `sched${day}` : `sched${day}Slot${slot}`;
    return {
        hour: (settings[`${prefix}Hour` as keyof SettingsData] as number) ?? 0,
        minute: (settings[`${prefix}Min` as keyof SettingsData] as number) ?? 0,
        on: (settings[`${prefix}On` as keyof SettingsData] as boolean) ?? false,
    };
}

function readDaySlots(settings: SettingsData, day: number) {
    const slot0 = readSlot(settings, day, 0);
    const slot1 = readSlot(settings, day, 1);
    if (!slot0.on) slot1.on = false;
    return [slot0, slot1];
}

function formatSchedTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function nextScheduleLabel(settings: SettingsData, localTime: string, t: (text: string) => string): string | null {
    if (!settings.scheduleEnabled) return null;

    const match = localTime.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;

    const currentDay = LOCAL_TIME_DAY_TO_SCHED_DAY[match[1]];
    const currentMinutes = Number.parseInt(match[2], 10) * 60 + Number.parseInt(match[3], 10);

    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
        const day = (currentDay + dayOffset) % 7;
        const slots = readDaySlots(settings, day)
            .filter((slot) => slot.on)
            .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

        for (const slot of slots) {
            const slotMinutes = slot.hour * 60 + slot.minute;
            if (dayOffset === 0 && slotMinutes < currentMinutes) continue;

            const when =
                dayOffset === 0
                    ? t("Today")
                    : dayOffset === 1
                      ? t("Tomorrow")
                      : t(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day]);
            return `${when} ${formatSchedTime(slot.hour, slot.minute)}`;
        }
    }

    return null;
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
    const { t, formatSystemTime } = useI18n();
    const navigate = useNavigate();
    const charger = usePolling<ChargerData>(api.getCharger, 5000);
    const error = usePolling<ErrorData>(api.getError, 2000);
    const settings = usePolling<SettingsData>(api.getSettings, 30000);
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
                actionErrorStack.push(normalizeError(e, "Action failed"));
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
    const nextSchedule =
        settings.data?.scheduleEnabled && system.data?.localTime
            ? nextScheduleLabel(settings.data, system.data.localTime, t)
            : null;

    return (
        <>
            {/* Header */}
            <div class="header">
                <h1>
                    OpenNeato
                    {firmware.data?.hostname && <span class="header-hostname"> ({firmware.data.hostname})</span>}
                </h1>
                <div class="header-btns">
                    <button
                        type="button"
                        class="header-right-btn"
                        aria-label={t("Cleaning History")}
                        onClick={() => navigate("/history")}
                        disabled={!robotReady}
                    >
                        <Icon svg={historySvg} />
                    </button>
                    <button
                        type="button"
                        class="header-right-btn"
                        aria-label={t("Settings")}
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
                        <div class="status-bar-label">
                            <T>WiFi</T>
                        </div>
                        <div class="status-bar-value">
                            <Icon svg={wifiSvg} />
                            {wifiStrength(system.data.rssi)}
                        </div>
                    </div>
                    <div class="status-bar-item">
                        <div class="status-bar-label">
                            <T>Time</T>
                        </div>
                        <div class="status-bar-value">
                            <Icon svg={clockSvg} />
                            {formatSystemTime(system.data.localTime)}
                        </div>
                    </div>
                    <div class="status-bar-item">
                        <div class="status-bar-label">
                            <T>Storage</T>
                        </div>
                        <div class="status-bar-value">
                            <Icon svg={databaseSvg} />
                            {Math.round((system.data.fsUsed / system.data.fsTotal) * 100)}%
                        </div>
                    </div>
                    {firmware.data && (
                        <div class="status-bar-item">
                            <div class="status-bar-label">
                                <T>Firmware</T>
                            </div>
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
                    {t("Update available: v{version} - tap to view release", { version: updateInfo.version })}
                </a>
            )}

            {/* Robot error/warning — fixed, clears automatically when robot resolves it */}
            {robotError && (
                <ErrorBanner title={t(robotError.title)} message={robotError.message} variant={robotError.kind} />
            )}
            {!error.data && error.error && !connErr && <ErrorBanner title={t("Warning")} message={error.error} />}

            {/* Action errors — dismissible, stackable */}
            <ErrorBannerStack errors={actionErrors} />

            {settings.data?.scheduleEnabled && (
                <button type="button" class="schedule-banner" onClick={() => navigate("/schedule")}>
                    <Icon svg={clockSvg} />
                    <span>
                        {nextSchedule
                            ? t("Next clean: {time}", { time: nextSchedule })
                            : t("Schedule enabled - tap to view")}
                    </span>
                </button>
            )}

            {/* Hero area — robot right, cards left */}
            {!robotReady ? (
                <div class="hero-area gate-hero">
                    <div class="robot-float gate-robot">
                        <Icon svg={robotSvg} />
                    </div>
                    {identifying ? (
                        <p class="gate-message">
                            <T>Connecting to robot...</T>
                        </p>
                    ) : (
                        <div class="gate-message">
                            <Icon svg={alertSvg} />
                            <h2>
                                <T>Unsupported Robot</T>
                            </h2>
                            <p>
                                <T>OpenNeato requires a Neato Botvac D3, D4, D5, D6, or D7.</T>
                                <br />
                                <T>The connected robot could not be identified.</T>
                            </p>
                        </div>
                    )}
                </div>
            ) : offline ? (
                <div class="conn-error">
                    <Icon svg={wifiOffSvg} />
                    <T>Unable to reach robot</T>
                </div>
            ) : (
                <div class="hero-area">
                    <div class="robot-float">
                        <Icon svg={robotSvg} />
                    </div>

                    <div class="info-cards">
                        <div class="info-card">
                            <div class="info-card-left">
                                <div class="info-card-label">
                                    <T>Status</T>
                                </div>
                                <div class={`info-card-value ${si.color}`}>{t(si.label)}</div>
                            </div>
                            <div class={`info-card-icon ${si.color}`}>
                                <Icon svg={STATUS_ICONS[si.icon]} />
                            </div>
                        </div>

                        <div class="info-card">
                            <div class="info-card-left">
                                <div class="info-card-label">
                                    <T>Battery</T>
                                </div>
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
                                <div class="info-card-label">
                                    <T>Mode</T>
                                </div>
                                <div class={`info-card-value ${mi.color}`}>{t(mi.label)}</div>
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
                                {t(isPaused ? "Resume" : "Pause")}
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanDock)}
                                disabled={!robotReady || offline || pending}
                            >
                                <Icon svg={dockSvg} />
                                <T>Dock</T>
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanStop)}
                                disabled={!robotReady || offline || pending}
                            >
                                <Icon svg={stopSvg} />
                                <T>Stop</T>
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
                                <T>House</T>
                            </button>
                            <button
                                type="button"
                                class={`action-btn${pending ? " pending" : ""}`}
                                onClick={() => handleAction(api.cleanSpot)}
                                disabled={!robotReady || offline || isDocking || isManual || pending || hasRobotError}
                            >
                                <Icon svg={spotSvg} />
                                <T>Spot</T>
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
                                {t(isDocking ? "Stop" : "Manual")}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
