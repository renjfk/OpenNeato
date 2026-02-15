import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import alertSvg from "../assets/icons/alert.svg?raw";
import backSvg from "../assets/icons/back.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import moonSvg from "../assets/icons/moon.svg?raw";
import powerSvg from "../assets/icons/power.svg?raw";
import sunSvg from "../assets/icons/sun.svg?raw";
import wifiSvg from "../assets/icons/wifi.svg?raw";
import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate } from "../components/router";
import type { SettingsData, SystemData } from "../types";

type Theme = "system" | "dark" | "light";

// Common timezone presets — label shown in UI, value is POSIX TZ string
// UTC offset shown is the standard (non-DST) offset
const TIMEZONE_PRESETS: { label: string; tz: string }[] = [
    { label: "UTC (UTC+0)", tz: "UTC0" },
    { label: "US Hawaii (UTC-10)", tz: "HST10" },
    { label: "US Alaska (UTC-9)", tz: "AKST9AKDT,M3.2.0,M11.1.0" },
    { label: "US Pacific (UTC-8)", tz: "PST8PDT,M3.2.0,M11.1.0" },
    { label: "US Mountain (UTC-7)", tz: "MST7MDT,M3.2.0,M11.1.0" },
    { label: "US Central (UTC-6)", tz: "CST6CDT,M3.2.0,M11.1.0" },
    { label: "US Eastern (UTC-5)", tz: "EST5EDT,M3.2.0,M11.1.0" },
    { label: "UK / Ireland (UTC+0)", tz: "GMT0BST,M3.5.0/1,M10.5.0" },
    { label: "Central Europe (UTC+1)", tz: "CET-1CEST,M3.5.0,M10.5.0/3" },
    { label: "Eastern Europe (UTC+2)", tz: "EET-2EEST,M3.5.0/3,M10.5.0/4" },
    { label: "Turkey (UTC+3)", tz: "<+03>-3" },
    { label: "India (UTC+5:30)", tz: "IST-5:30" },
    { label: "China / Singapore (UTC+8)", tz: "CST-8" },
    { label: "Japan / Korea (UTC+9)", tz: "JST-9" },
    { label: "Australia Eastern (UTC+10)", tz: "AEST-10AEDT,M10.1.0,M4.1.0/3" },
    { label: "New Zealand (UTC+12)", tz: "NZST-12NZDT,M9.5.0,M4.1.0/3" },
];

// WiFi TX power presets — value is in 0.25 dBm units (ESP32 wifi_power_t)
const TX_POWER_PRESETS: { label: string; value: number }[] = [
    { label: "8.5 dBm (low power, recommended)", value: 34 },
    { label: "11 dBm", value: 44 },
    { label: "13 dBm", value: 52 },
    { label: "15 dBm", value: 60 },
    { label: "17 dBm", value: 68 },
    { label: "19.5 dBm (default, max range)", value: 78 },
];

const DEFAULT_SERVER: SettingsData = {
    tz: "UTC0",
    debugLog: false,
    wifiTxPower: 34,
    uartTxPin: 3,
    uartRxPin: 4,
    hostname: "neato",
};

function findPresetLabel(tz: string): string | null {
    const match = TIMEZONE_PRESETS.find((p) => p.tz === tz);
    return match ? match.label : null;
}

function formatRobotTime(epochSec: number, tz: string): string {
    try {
        const date = new Date(epochSec * 1000);
        // POSIX format: STDoffset[DST[offset][,rule]] — offset is hours WEST of UTC
        const offsetMatch = tz.match(/[A-Z]+(-?\d+)(?::(\d+))?/);
        if (offsetMatch) {
            const hours = parseInt(offsetMatch[1], 10);
            const mins = offsetMatch[2] ? parseInt(offsetMatch[2], 10) : 0;
            const offsetMs = -(hours * 60 + (hours < 0 ? -mins : mins)) * 60 * 1000;
            const local = new Date(date.getTime() + offsetMs);
            const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            const day = days[local.getUTCDay()];
            const h = local.getUTCHours().toString().padStart(2, "0");
            const m = local.getUTCMinutes().toString().padStart(2, "0");
            const s = local.getUTCSeconds().toString().padStart(2, "0");
            return `${day} ${h}:${m}:${s}`;
        }
    } catch {
        // fall through
    }
    const d = new Date(epochSec * 1000);
    return d.toUTCString().replace(" GMT", " UTC");
}

interface SettingsViewProps {
    theme: Theme;
    onThemeChange: (t: Theme) => void;
    system: SystemData | null;
}

export function SettingsView({ theme, onThemeChange, system }: SettingsViewProps) {
    const navigate = useNavigate();

    // Local form state
    const [tz, setTz] = useState<string>(system?.tz ?? "UTC0");
    const [debugLog, setDebugLog] = useState(false);
    const [wifiTxPower, setWifiTxPower] = useState(34);
    const [uartTxPin, setUartTxPin] = useState(3);
    const [uartRxPin, setUartRxPin] = useState(4);
    const [hostname, setHostname] = useState("neato");

    // Server-confirmed state — used to compute dirty/needsReboot
    const server = useRef<SettingsData>({ ...DEFAULT_SERVER });

    // Save flow
    const [saving, setSaving] = useState(false);
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [showRestartConfirm, setShowRestartConfirm] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [rebooting, setRebooting] = useState(false);
    const [errors, errorStack] = useErrorStack();
    const pendingNav = useRef<string | null>(null);

    // Sync tz from system polling (initial load before settings fetch)
    useEffect(() => {
        if (system?.tz) setTz(system.tz);
    }, [system?.tz]);

    // Fetch settings on mount
    useEffect(() => {
        api.getSettings().then((s: SettingsData) => {
            server.current = { ...s };
            setTz(s.tz);
            setDebugLog(s.debugLog);
            setWifiTxPower(s.wifiTxPower);
            setUartTxPin(s.uartTxPin);
            setUartRxPin(s.uartRxPin);
            setHostname(s.hostname);
        });
    }, []);

    // --- Dirty / validation / reboot detection ---

    const isDirty =
        tz !== server.current.tz ||
        debugLog !== server.current.debugLog ||
        wifiTxPower !== server.current.wifiTxPower ||
        uartTxPin !== server.current.uartTxPin ||
        uartRxPin !== server.current.uartRxPin ||
        hostname !== server.current.hostname;

    const needsReboot =
        uartTxPin !== server.current.uartTxPin ||
        uartRxPin !== server.current.uartRxPin ||
        hostname !== server.current.hostname;

    const pinError =
        uartTxPin === uartRxPin
            ? "TX and RX cannot be the same pin"
            : uartTxPin < 0 || uartTxPin > 21 || uartRxPin < 0 || uartRxPin > 21
              ? "Pin must be 0-21"
              : null;

    const hostnameError =
        hostname.length === 0
            ? "Hostname cannot be empty"
            : hostname.length > 32
              ? "Max 32 characters"
              : !/^[a-zA-Z0-9-]+$/.test(hostname)
                ? "Only letters, numbers, and hyphens"
                : null;

    const validationError = pinError || hostnameError;

    // --- Unsaved changes guards ---

    // Ref tracks latest isDirty for beforeunload handler
    const dirtyRef = useRef(false);
    dirtyRef.current = isDirty;

    // Warn on tab close / refresh when dirty
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (dirtyRef.current) e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

    // Guarded navigation — shows discard dialog when dirty
    const guardedNavigate = useCallback(
        (to: string) => {
            if (isDirty) {
                pendingNav.current = to;
                setShowDiscardConfirm(true);
            } else {
                navigate(to);
            }
        },
        [isDirty, navigate],
    );

    const handleDiscard = useCallback(() => {
        setShowDiscardConfirm(false);
        if (pendingNav.current) {
            navigate(pendingNav.current);
            pendingNav.current = null;
        }
    }, [navigate]);

    // --- Reboot flow ---

    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const uptimeBeforeReboot = useRef(0);

    const pollUntilRebooted = useCallback(() => {
        const poll = () => {
            fetch("/api/system")
                .then((res) => (res.ok ? res.json() : Promise.reject()))
                .then((data: SystemData) => {
                    if (data.uptime < uptimeBeforeReboot.current) {
                        window.location.reload();
                    } else {
                        pollTimer.current = setTimeout(poll, 2000);
                    }
                })
                .catch(() => {
                    pollTimer.current = setTimeout(poll, 2000);
                });
        };
        pollTimer.current = setTimeout(poll, 2000);
    }, []);

    useEffect(() => {
        return () => {
            if (pollTimer.current) clearTimeout(pollTimer.current);
        };
    }, []);

    const startRebootFlow = useCallback(() => {
        uptimeBeforeReboot.current = system?.uptime ?? 0;
        setShowSaveConfirm(false);
        setShowRestartConfirm(false);
        setShowResetConfirm(false);
        setRebooting(true);
        pollUntilRebooted();
    }, [system?.uptime, pollUntilRebooted]);

    // --- Unified save ---

    const buildPatch = useCallback((): Partial<SettingsData> => {
        const patch: Partial<SettingsData> = {};
        if (tz !== server.current.tz) patch.tz = tz;
        if (debugLog !== server.current.debugLog) patch.debugLog = debugLog;
        if (wifiTxPower !== server.current.wifiTxPower) patch.wifiTxPower = wifiTxPower;
        if (uartTxPin !== server.current.uartTxPin) patch.uartTxPin = uartTxPin;
        if (uartRxPin !== server.current.uartRxPin) patch.uartRxPin = uartRxPin;
        if (hostname !== server.current.hostname) patch.hostname = hostname;
        return patch;
    }, [tz, debugLog, wifiTxPower, uartTxPin, uartRxPin, hostname]);

    const handleSave = useCallback(() => {
        const willReboot = needsReboot;
        setSaving(true);
        api.updateSettings(buildPatch())
            .then((res) => {
                server.current = { ...res };
                if (willReboot) {
                    startRebootFlow();
                } else {
                    setShowSaveConfirm(false);
                }
            })
            .catch((e: unknown) => {
                if (e instanceof TypeError && willReboot) {
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to save settings");
                    setShowSaveConfirm(false);
                }
            })
            .finally(() => setSaving(false));
    }, [buildPatch, needsReboot, startRebootFlow]);

    const onSaveClick = useCallback(() => {
        if (needsReboot) {
            setShowSaveConfirm(true);
        } else {
            handleSave();
        }
    }, [needsReboot, handleSave]);

    // --- Restart / Factory Reset ---

    const handleRestart = useCallback(() => {
        setRestarting(true);
        api.restart()
            .then(() => startRebootFlow())
            .catch((e: unknown) => {
                if (e instanceof TypeError) {
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to restart");
                    setShowRestartConfirm(false);
                }
            })
            .finally(() => setRestarting(false));
    }, [startRebootFlow]);

    const handleFactoryReset = useCallback(() => {
        setRestarting(true);
        api.factoryReset()
            .then(() => startRebootFlow())
            .catch((e: unknown) => {
                if (e instanceof TypeError) {
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to factory reset");
                    setShowResetConfirm(false);
                }
            })
            .finally(() => setRestarting(false));
    }, [startRebootFlow]);

    // --- Derived UI values ---

    const presetLabel = findPresetLabel(tz);
    const isCustom = !presetLabel;

    const saveLabel = saving ? "Saving..." : needsReboot ? "Save & Reboot" : "Save";

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={() => guardedNavigate("/")} aria-label="Back">
                    <Icon svg={backSvg} />
                </button>
                <h1>Settings</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="settings-page">
                <div class="settings-section">
                    <div class="settings-section-title">Appearance</div>
                    <div class="settings-theme-row">
                        <button
                            type="button"
                            class={`settings-theme-btn${theme === "system" ? " active" : ""}`}
                            onClick={() => onThemeChange("system")}
                        >
                            <div class="settings-theme-icon">
                                <Icon svg={sunSvg} />
                                <Icon svg={moonSvg} />
                            </div>
                            Auto
                        </button>
                        <button
                            type="button"
                            class={`settings-theme-btn${theme === "light" ? " active" : ""}`}
                            onClick={() => onThemeChange("light")}
                        >
                            <div class="settings-theme-icon">
                                <Icon svg={sunSvg} />
                            </div>
                            Light
                        </button>
                        <button
                            type="button"
                            class={`settings-theme-btn${theme === "dark" ? " active" : ""}`}
                            onClick={() => onThemeChange("dark")}
                        >
                            <div class="settings-theme-icon">
                                <Icon svg={moonSvg} />
                            </div>
                            Dark
                        </button>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Timezone</div>
                    <div class="settings-tz-select-wrap">
                        <select
                            class="settings-tz-select"
                            value={isCustom ? "__custom__" : tz}
                            onChange={(e) => {
                                const val = (e.target as HTMLSelectElement).value;
                                if (val !== "__custom__") setTz(val);
                            }}
                            disabled={saving}
                        >
                            {TIMEZONE_PRESETS.map((p) => (
                                <option key={p.tz} value={p.tz}>
                                    {p.label}
                                </option>
                            ))}
                            {isCustom && (
                                <option value="__custom__" disabled>
                                    Custom: {tz}
                                </option>
                            )}
                        </select>
                    </div>
                    {system?.time && (
                        <div class="settings-robot-time">
                            <Icon svg={clockSvg} />
                            Robot time: {formatRobotTime(system.time, tz)}
                        </div>
                    )}
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Hostname</div>
                    <input
                        type="text"
                        class="settings-text-input"
                        value={hostname}
                        maxLength={32}
                        onInput={(e) => setHostname((e.target as HTMLInputElement).value)}
                        disabled={saving}
                        placeholder="neato"
                    />
                    {hostnameError ? (
                        <div class="settings-field-error">{hostnameError}</div>
                    ) : (
                        <div class="settings-robot-time">mDNS hostname for the device on your network</div>
                    )}
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">WiFi TX Power</div>
                    <div class="settings-tz-select-wrap">
                        <select
                            class="settings-tz-select"
                            value={wifiTxPower}
                            onChange={(e) => setWifiTxPower(parseInt((e.target as HTMLSelectElement).value, 10))}
                            disabled={saving}
                        >
                            {TX_POWER_PRESETS.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div class="settings-robot-time">
                        <Icon svg={wifiSvg} />
                        Lower power reduces range but improves stability on serial port power
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">UART Pins</div>
                    <div class="settings-pin-row">
                        <label class="settings-pin-label">
                            TX (ESP → Robot)
                            <input
                                type="number"
                                class="settings-pin-input"
                                min={0}
                                max={21}
                                value={uartTxPin}
                                onChange={(e) => setUartTxPin(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
                                disabled={saving}
                            />
                        </label>
                        <label class="settings-pin-label">
                            RX (Robot → ESP)
                            <input
                                type="number"
                                class="settings-pin-input"
                                min={0}
                                max={21}
                                value={uartRxPin}
                                onChange={(e) => setUartRxPin(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
                                disabled={saving}
                            />
                        </label>
                    </div>
                    {pinError && <div class="settings-field-error">{pinError}</div>}
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Diagnostics</div>
                    <div class="settings-toggle-row">
                        <div class="settings-toggle-label">
                            <span class="settings-toggle-title">Debug logging</span>
                            <span class="settings-toggle-desc">Include serial responses in logs</span>
                        </div>
                        <button
                            type="button"
                            class={`settings-toggle${debugLog ? " on" : ""}`}
                            onClick={() => setDebugLog(!debugLog)}
                            disabled={saving}
                            aria-label="Toggle debug logging"
                        />
                    </div>
                    <button type="button" class="settings-nav-row" onClick={() => guardedNavigate("/logs")}>
                        <div class="settings-nav-row-left">
                            <Icon svg={databaseSvg} />
                            Logs
                        </div>
                        <span class="settings-nav-chevron">&rsaquo;</span>
                    </button>
                </div>

                <button
                    type="button"
                    class={`settings-save-btn${saving ? " pending" : ""}`}
                    onClick={onSaveClick}
                    disabled={saving || !isDirty || !!validationError}
                >
                    {saveLabel}
                </button>

                <div class="settings-section">
                    <div class="settings-section-title">Device</div>
                    <div class="settings-device-actions">
                        <button type="button" class="settings-device-btn" onClick={() => setShowRestartConfirm(true)}>
                            <Icon svg={powerSvg} />
                            Restart
                        </button>
                        <button
                            type="button"
                            class="settings-device-btn danger"
                            onClick={() => setShowResetConfirm(true)}
                        >
                            <Icon svg={alertSvg} />
                            Factory Reset
                        </button>
                    </div>
                </div>
            </div>

            {showDiscardConfirm && (
                <ConfirmDialog
                    message="You have unsaved changes. Discard them?"
                    confirmLabel="Discard"
                    onConfirm={handleDiscard}
                    onCancel={() => setShowDiscardConfirm(false)}
                />
            )}

            {showSaveConfirm && (
                <ConfirmDialog
                    message="Some changes require a device reboot. Save and reboot now?"
                    confirmLabel="Save & Reboot"
                    disabled={saving}
                    onConfirm={handleSave}
                    onCancel={() => setShowSaveConfirm(false)}
                />
            )}

            {showRestartConfirm && (
                <ConfirmDialog
                    message="Restart device?"
                    confirmLabel="Restart"
                    disabled={restarting}
                    onConfirm={handleRestart}
                    onCancel={() => setShowRestartConfirm(false)}
                />
            )}

            {showResetConfirm && (
                <ConfirmDialog
                    message="This will erase all settings including WiFi credentials. Are you sure?"
                    confirmLabel="Factory Reset"
                    confirmText="RESET"
                    disabled={restarting}
                    onConfirm={handleFactoryReset}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}

            {rebooting && (
                <div class="reboot-overlay">
                    <div class="reboot-dialog">
                        <div class="reboot-spinner" />
                        <div class="reboot-text">Rebooting...</div>
                        <div class="reboot-subtext">Waiting for device to come back online</div>
                    </div>
                </div>
            )}
        </>
    );
}
