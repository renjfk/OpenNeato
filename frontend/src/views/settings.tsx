import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import alertSvg from "../assets/icons/alert.svg?raw";
import backSvg from "../assets/icons/back.svg?raw";
import bellSvg from "../assets/icons/bell.svg?raw";
import calendarSvg from "../assets/icons/calendar.svg?raw";
import chipSvg from "../assets/icons/chip.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import gearSvg from "../assets/icons/gear.svg?raw";
import manualSvg from "../assets/icons/manual.svg?raw";
import moonSvg from "../assets/icons/moon.svg?raw";
import paletteSvg from "../assets/icons/palette.svg?raw";
import powerSvg from "../assets/icons/power.svg?raw";
import robotSvg from "../assets/icons/robot.svg?raw";
import stethoscopeSvg from "../assets/icons/stethoscope.svg?raw";
import sunSvg from "../assets/icons/sun.svg?raw";
import tagSvg from "../assets/icons/tag.svg?raw";
import wifiSvg from "../assets/icons/wifi.svg?raw";
import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate } from "../components/router";
import { usePolling } from "../hooks/use-polling";
import type { FirmwareVersion, SystemData, UserSettingsData } from "../types";
import {
    BRUSH_PRESETS,
    SIDE_BRUSH_PRESETS,
    STALL_PRESETS,
    TIMEZONE_PRESETS,
    TX_POWER_PRESETS,
    VACUUM_PRESETS,
} from "./settings/constants";
import { findPresetLabel, formatRobotTime } from "./settings/helpers";
import { SettingsCategory } from "./settings/settings-category";
import { useFirmwareUpload } from "./settings/use-firmware-upload";
import { useReboot } from "./settings/use-reboot";
import { useSettingsForm } from "./settings/use-settings-form";

type Theme = "system" | "dark" | "light";

interface SettingsViewProps {
    theme: Theme;
    onThemeChange: (t: Theme) => void;
    firmware: FirmwareVersion | null;
}

export function SettingsView({ theme, onThemeChange, firmware }: SettingsViewProps) {
    const navigate = useNavigate();
    const systemPoll = usePolling<SystemData>(api.getSystem, 10000);
    const system = systemPoll.data;
    const userSettingsPoll = usePolling<UserSettingsData>(api.getUserSettings, 30000);
    const [robotSettings, setRobotSettings] = useState<UserSettingsData | null>(null);
    const [savingRobotSettings, setSavingRobotSettings] = useState(false);

    // Sync polled data into local state — only on fresh poll results, not during/after saves.
    // The ref tracks whether the user has made a local change; once they have, we stop
    // overwriting from poll data until the next fresh poll result arrives.
    const lastPollRef = useRef(userSettingsPoll.data);
    useEffect(() => {
        if (userSettingsPoll.data && userSettingsPoll.data !== lastPollRef.current && !savingRobotSettings) {
            lastPollRef.current = userSettingsPoll.data;
            setRobotSettings(userSettingsPoll.data);
        }
    }, [userSettingsPoll.data, savingRobotSettings]);

    const robotSettingsDisabled = !robotSettings || savingRobotSettings || !firmware?.supported;

    const [errors, errorStack] = useErrorStack();
    const { rebooting, startRebootFlow } = useReboot(system?.uptime ?? 0);

    const fw = useFirmwareUpload(firmware?.chip ?? null, errorStack, startRebootFlow);

    const {
        tz,
        setTz,
        debug,
        setDebug,
        wifiTxPower,
        setWifiTxPower,
        uartTxPin,
        setUartTxPin,
        uartRxPin,
        setUartRxPin,
        maxGpioPin,
        hostname,
        setHostname,
        stallThreshold,
        setStallThreshold,
        brushRpm,
        setBrushRpm,
        vacuumSpeed,
        setVacuumSpeed,
        sideBrushPower,
        setSideBrushPower,
        ntfyTopic,
        setNtfyTopic,
        ntfyEnabled,
        setNtfyEnabled,
        ntfyOnDone,
        setNtfyOnDone,
        ntfyOnError,
        setNtfyOnError,
        ntfyOnAlert,
        setNtfyOnAlert,
        ntfyOnDocking,
        setNtfyOnDocking,
        isDirty,
        pinError,
        hostnameError,
        validationError,
        saving,
        showSaveConfirm,
        setShowSaveConfirm,
        saveLabel,
        handleSave,
        onSaveClick,
    } = useSettingsForm(errorStack, startRebootFlow);

    // --- Robot user settings save ---
    // Maps frontend field names to SetUserSettings serial command keys.
    // StealthLed is inverted: frontend true = LEDs hidden = StealthLED ON.
    const robotSettingKeys: Record<string, string> = {
        buttonClick: "ButtonClick",
        melodies: "Melodies",
        warnings: "Warnings",
        ecoMode: "EcoMode",
        intenseClean: "IntenseClean",
        binFullDetect: "BinFullDetect",
        wifi: "WiFi",
        stealthLed: "StealthLED",
    };

    const handleRobotSettingsChange = useCallback(
        (field: keyof typeof robotSettingKeys, value: boolean) => {
            if (!robotSettings) return;
            setRobotSettings({ ...robotSettings, [field]: value });
            setSavingRobotSettings(true);
            const serialValue = value ? "ON" : "OFF";
            api.setUserSetting(robotSettingKeys[field], serialValue)
                .catch((e: unknown) => {
                    errorStack.push(e instanceof Error ? e.message : "Failed to update robot settings");
                    if (userSettingsPoll.data) setRobotSettings(userSettingsPoll.data);
                })
                .finally(() => setSavingRobotSettings(false));
        },
        [robotSettings, userSettingsPoll.data, errorStack],
    );

    // --- Notification test ---
    const [testingNotif, setTestingNotif] = useState(false);
    const [notifTestResult, setNotifTestResult] = useState<string | null>(null);

    const handleTestNotification = useCallback(() => {
        if (!ntfyTopic.trim()) return;
        setTestingNotif(true);
        setNotifTestResult(null);
        api.testNotification(ntfyTopic.trim())
            .then(() => {
                setNotifTestResult("Sent");
                setTimeout(() => setNotifTestResult(null), 2000);
            })
            .catch((e: unknown) => {
                setNotifTestResult(e instanceof Error ? e.message : "Failed");
                setTimeout(() => setNotifTestResult(null), 3000);
            })
            .finally(() => setTestingNotif(false));
    }, [ntfyTopic]);

    // --- Dialogs ---
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [showRestartConfirm, setShowRestartConfirm] = useState(false);
    const [showFormatConfirm, setShowFormatConfirm] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showUploadConfirm, setShowUploadConfirm] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const pendingNav = useRef<string | null>(null);

    // --- Robot power control ---
    const [showRobotRestartConfirm, setShowRobotRestartConfirm] = useState(false);
    const [showRobotShutdownConfirm, setShowRobotShutdownConfirm] = useState(false);
    const [robotRestarting, setRobotRestarting] = useState(false);
    const robotRestartPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const robotRestartTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (robotRestartPollTimer.current) clearTimeout(robotRestartPollTimer.current);
            if (robotRestartTimeout.current) clearTimeout(robotRestartTimeout.current);
        };
    }, []);

    const handleRobotRestart = useCallback(() => {
        setRobotRestarting(true);

        robotRestartTimeout.current = setTimeout(() => {
            if (robotRestartPollTimer.current) clearTimeout(robotRestartPollTimer.current);
            robotRestartPollTimer.current = null;
            robotRestartTimeout.current = null;
            setRobotRestarting(false);
            errorStack.push("Robot did not recover after restart — check physical connection");
        }, 30000);

        api.robotRestart()
            .then(() => {
                const poll = () => {
                    api.getState()
                        .then(() => {
                            if (robotRestartTimeout.current) clearTimeout(robotRestartTimeout.current);
                            robotRestartTimeout.current = null;
                            robotRestartPollTimer.current = null;
                            setRobotRestarting(false);
                        })
                        .catch(() => {
                            robotRestartPollTimer.current = setTimeout(poll, 2000);
                        });
                };
                robotRestartPollTimer.current = setTimeout(poll, 2000);
            })
            .catch((e: unknown) => {
                if (robotRestartTimeout.current) clearTimeout(robotRestartTimeout.current);
                robotRestartTimeout.current = null;
                setRobotRestarting(false);
                errorStack.push(e instanceof Error ? e.message : "Failed to restart robot");
            });
    }, [errorStack]);

    const handleRobotShutdown = useCallback(() => {
        setShowRobotShutdownConfirm(false);
        // Navigate immediately — the ESP32 will lose power and go offline,
        // so we don't wait for the response or surface network errors.
        api.robotShutdown().catch(() => {});
        navigate("/");
    }, [navigate]);

    // --- Unsaved changes guards ---

    const dirtyRef = useRef(false);
    dirtyRef.current = isDirty;

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (dirtyRef.current) e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

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

    // --- Restart / Factory Reset ---

    const handleRestart = useCallback(() => {
        setRestarting(true);
        api.restart()
            .then(() => {
                setShowRestartConfirm(false);
                startRebootFlow();
            })
            .catch((e: unknown) => {
                if (e instanceof TypeError) {
                    setShowRestartConfirm(false);
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to restart");
                    setShowRestartConfirm(false);
                }
            })
            .finally(() => setRestarting(false));
    }, [startRebootFlow, errorStack]);

    const handleFormatFs = useCallback(() => {
        setRestarting(true);
        api.formatFs()
            .then(() => {
                setShowFormatConfirm(false);
                startRebootFlow();
            })
            .catch((e: unknown) => {
                if (e instanceof TypeError) {
                    setShowFormatConfirm(false);
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to format storage");
                    setShowFormatConfirm(false);
                }
            })
            .finally(() => setRestarting(false));
    }, [startRebootFlow, errorStack]);

    const handleFactoryReset = useCallback(() => {
        setRestarting(true);
        api.factoryReset()
            .then(() => {
                setShowResetConfirm(false);
                startRebootFlow();
            })
            .catch((e: unknown) => {
                if (e instanceof TypeError) {
                    setShowResetConfirm(false);
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to factory reset");
                    setShowResetConfirm(false);
                }
            })
            .finally(() => setRestarting(false));
    }, [startRebootFlow, errorStack]);

    // --- Derived UI values ---

    const presetLabel = findPresetLabel(tz);
    const isCustom = !presetLabel;

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
                <SettingsCategory title="Appearance" icon={paletteSvg} defaultOpen>
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
                </SettingsCategory>

                <SettingsCategory title="Device" icon={gearSvg}>
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
                        <div class="settings-section-title">UART Pins</div>
                        <div class="settings-pin-row">
                            <label class="settings-pin-label">
                                TX (ESP → Robot)
                                <input
                                    type="number"
                                    class="settings-pin-input"
                                    min={0}
                                    max={maxGpioPin}
                                    value={uartTxPin}
                                    onChange={(e) =>
                                        setUartTxPin(parseInt((e.target as HTMLInputElement).value, 10) || 0)
                                    }
                                    disabled={saving}
                                />
                            </label>
                            <label class="settings-pin-label">
                                RX (Robot → ESP)
                                <input
                                    type="number"
                                    class="settings-pin-input"
                                    min={0}
                                    max={maxGpioPin}
                                    value={uartRxPin}
                                    onChange={(e) =>
                                        setUartRxPin(parseInt((e.target as HTMLInputElement).value, 10) || 0)
                                    }
                                    disabled={saving}
                                />
                            </label>
                        </div>
                        {pinError && <div class="settings-field-error">{pinError}</div>}
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row" onClick={() => guardedNavigate("/schedule")}>
                            <div class="settings-nav-row-left">
                                <Icon svg={calendarSvg} />
                                Cleaning Schedule
                            </div>
                            <span class="settings-nav-chevron">&rsaquo;</span>
                        </button>
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row" onClick={() => setShowRestartConfirm(true)}>
                            <div class="settings-nav-row-left">
                                <Icon svg={powerSvg} />
                                Restart Device
                            </div>
                        </button>
                    </div>
                </SettingsCategory>

                <SettingsCategory title="Notifications" icon={bellSvg}>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Enable notifications</span>
                                <span class="settings-toggle-desc">Push alerts via ntfy.sh over plain HTTP</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${ntfyEnabled ? " on" : ""}`}
                                onClick={() => setNtfyEnabled(!ntfyEnabled)}
                                disabled={saving}
                                aria-label="Toggle notifications"
                            />
                        </div>
                        {ntfyEnabled && (
                            <>
                                <div class="settings-ntfy-row">
                                    <input
                                        type="text"
                                        class="settings-text-input"
                                        value={ntfyTopic}
                                        onInput={(e) => setNtfyTopic((e.target as HTMLInputElement).value)}
                                        disabled={saving}
                                        placeholder="e.g. my-robot-alerts"
                                    />
                                    <button
                                        type="button"
                                        class="settings-ntfy-test-btn"
                                        onClick={handleTestNotification}
                                        disabled={!ntfyTopic.trim() || testingNotif}
                                    >
                                        {testingNotif ? "..." : (notifTestResult ?? "Test")}
                                    </button>
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">Cleaning done</span>
                                        <span class="settings-toggle-desc">When a cleaning cycle completes</span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnDone ? " on" : ""}`}
                                        onClick={() => setNtfyOnDone(!ntfyOnDone)}
                                        disabled={saving}
                                        aria-label="Toggle cleaning done notification"
                                    />
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">Robot error</span>
                                        <span class="settings-toggle-desc">Stuck brush, wheel, or other failures</span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnError ? " on" : ""}`}
                                        onClick={() => setNtfyOnError(!ntfyOnError)}
                                        disabled={saving}
                                        aria-label="Toggle error notification"
                                    />
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">Robot alert</span>
                                        <span class="settings-toggle-desc">Brush or filter replacement reminders</span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnAlert ? " on" : ""}`}
                                        onClick={() => setNtfyOnAlert(!ntfyOnAlert)}
                                        disabled={saving}
                                        aria-label="Toggle alert notification"
                                    />
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">Returning to base</span>
                                        <span class="settings-toggle-desc">When the robot docks to charge</span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnDocking ? " on" : ""}`}
                                        onClick={() => setNtfyOnDocking(!ntfyOnDocking)}
                                        disabled={saving}
                                        aria-label="Toggle docking notification"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </SettingsCategory>

                <SettingsCategory title="Manual Clean" icon={manualSvg}>
                    <div class="settings-section">
                        <div class="settings-section-title">Brush Speed</div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={brushRpm}
                                onChange={(e) => setBrushRpm(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {BRUSH_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">Main brush rotation speed during manual clean</div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Vacuum Power</div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={vacuumSpeed}
                                onChange={(e) => setVacuumSpeed(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {VACUUM_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">Vacuum motor speed during manual clean</div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Side Brush Power</div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={sideBrushPower}
                                onChange={(e) => setSideBrushPower(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {SIDE_BRUSH_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">Side brush motor power (D5 and above)</div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Stall Detection</div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={stallThreshold}
                                onChange={(e) => setStallThreshold(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {STALL_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            Wheel load threshold for obstacle detection during manual driving
                        </div>
                    </div>
                </SettingsCategory>

                <SettingsCategory title="Firmware" icon={chipSvg}>
                    <div class="settings-section">
                        <div class="settings-section-title">Firmware</div>
                        <div class="fw-info-row">
                            <div class="fw-info-item">
                                <Icon svg={tagSvg} />
                                <span>{firmware?.version ?? "..."}</span>
                            </div>
                            <div class="fw-info-item">
                                <Icon svg={chipSvg} />
                                <span>{firmware?.chip ?? "..."}</span>
                            </div>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Update</div>
                        {fw.status === "idle" && (
                            <>
                                <label class="fw-file-label">
                                    <input
                                        type="file"
                                        accept=".bin"
                                        class="fw-file-input"
                                        onChange={(e) =>
                                            fw.selectFile((e.target as HTMLInputElement).files?.[0] ?? null)
                                        }
                                    />
                                    <span class={`fw-file-btn${fw.file ? " has-file" : ""}`}>
                                        {fw.file ? fw.file.name : "Select firmware file (.bin)"}
                                    </span>
                                </label>
                                {fw.file && (
                                    <div class="fw-file-meta">
                                        {(fw.file.size / 1024).toFixed(0)} KB
                                        {fw.chipError && <span class="fw-chip-error">{fw.chipError}</span>}
                                    </div>
                                )}
                                {fw.file && !fw.chipError && (
                                    <>
                                        <label class="fw-file-label">
                                            <input
                                                type="file"
                                                accept=".txt"
                                                class="fw-file-input"
                                                onChange={(e) =>
                                                    fw.selectChecksumFile(
                                                        (e.target as HTMLInputElement).files?.[0] ?? null,
                                                    )
                                                }
                                            />
                                            <span class={`fw-file-btn${fw.checksumFile ? " has-file" : ""}`}>
                                                {fw.checksumFile
                                                    ? fw.checksumFile.name
                                                    : "Select checksums.txt (optional)"}
                                            </span>
                                        </label>
                                        {fw.checksumResult === "match" && (
                                            <div class="fw-checksum-status fw-checksum-ok">Checksum verified</div>
                                        )}
                                        {fw.checksumResult === "mismatch" && (
                                            <div class="fw-checksum-status fw-checksum-fail">
                                                Checksum mismatch — firmware file may be corrupted
                                            </div>
                                        )}
                                        {fw.checksumResult === "not-found" && (
                                            <div class="fw-checksum-status fw-checksum-warn">
                                                Firmware filename not found in checksums file
                                            </div>
                                        )}
                                        {fw.canUpload && (
                                            <button
                                                type="button"
                                                class="fw-upload-btn"
                                                onClick={() => {
                                                    if (fw.checksumVerified) {
                                                        fw.startUpload();
                                                    } else {
                                                        setShowUploadConfirm(true);
                                                    }
                                                }}
                                            >
                                                Upload & Install
                                            </button>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                        {fw.status === "hashing" && (
                            <div class="fw-progress-wrap">
                                <div class="fw-progress-bar">
                                    <div class="fw-progress-fill indeterminate" />
                                </div>
                                <div class="fw-progress-text">Computing checksum...</div>
                            </div>
                        )}
                        {fw.status === "uploading" && (
                            <div class="fw-progress-wrap">
                                <div class="fw-progress-bar">
                                    <div class="fw-progress-fill" style={{ width: `${fw.progress}%` }} />
                                </div>
                                <div class="fw-progress-text">
                                    {fw.progress >= 90 ? "Writing firmware..." : `Uploading... ${fw.progress}%`}
                                </div>
                            </div>
                        )}
                        {fw.status === "done" && (
                            <div class="fw-progress-wrap">
                                <div class="fw-progress-bar">
                                    <div class="fw-progress-fill" style={{ width: "100%" }} />
                                </div>
                                <div class="fw-progress-text">Upload complete. Rebooting...</div>
                            </div>
                        )}
                    </div>
                </SettingsCategory>

                <SettingsCategory title="Diagnostics" icon={stethoscopeSvg}>
                    <div class="settings-section">
                        <div class="settings-section-title">Diagnostics</div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Debug mode</span>
                                <span class="settings-toggle-desc">Verbose logging and serial console endpoint</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${debug ? " on" : ""}`}
                                onClick={() => setDebug(!debug)}
                                disabled={saving}
                                aria-label="Toggle debug mode"
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row" onClick={() => guardedNavigate("/logs")}>
                            <div class="settings-nav-row-left">
                                <Icon svg={databaseSvg} />
                                Logs
                            </div>
                            <span class="settings-nav-chevron">&rsaquo;</span>
                        </button>
                    </div>
                </SettingsCategory>

                <button
                    type="button"
                    class={`settings-save-btn${saving ? " pending" : ""}`}
                    onClick={onSaveClick}
                    disabled={saving || !isDirty || !!validationError}
                >
                    {saveLabel}
                </button>

                <SettingsCategory title="Robot" icon={robotSvg} disabled={firmware?.supported === false}>
                    <div class="settings-section">
                        <div class="settings-section-title">Sound</div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Button clicks</span>
                                <span class="settings-toggle-desc">Sound when pressing buttons</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.buttonClick ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("buttonClick", !robotSettings?.buttonClick)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle button clicks"
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Melodies</span>
                                <span class="settings-toggle-desc">Startup and shutdown sounds</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.melodies ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("melodies", !robotSettings?.melodies)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle melodies"
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Warnings</span>
                                <span class="settings-toggle-desc">Warning beeps</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.warnings ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("warnings", !robotSettings?.warnings)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle warnings"
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Cleaning</div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Eco mode</span>
                                <span class="settings-toggle-desc">
                                    Lower brush and vacuum power, longer battery life
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.ecoMode ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("ecoMode", !robotSettings?.ecoMode)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle eco mode"
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Intense clean</span>
                                <span class="settings-toggle-desc">Double-pass cleaning for deeper clean</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.intenseClean ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("intenseClean", !robotSettings?.intenseClean)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle intense clean"
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Bin full detection</span>
                                <span class="settings-toggle-desc">Alert when dust bin is full</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.binFullDetect ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() =>
                                    handleRobotSettingsChange("binFullDetect", !robotSettings?.binFullDetect)
                                }
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle bin full detection"
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Power Saving</div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Robot WiFi</span>
                                <span class="settings-toggle-desc">Unused with OpenNeato, disable to save power</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.wifi ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("wifi", !robotSettings?.wifi)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle robot WiFi"
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Stealth LEDs</span>
                                <span class="settings-toggle-desc">Disable standby indicator lights</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.stealthLed ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("stealthLed", !robotSettings?.stealthLed)}
                                disabled={robotSettingsDisabled}
                                aria-label="Toggle stealth LEDs"
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Power Control</div>
                        <button type="button" class="settings-nav-row" onClick={() => setShowRobotRestartConfirm(true)}>
                            <div class="settings-nav-row-left">
                                <Icon svg={powerSvg} />
                                Restart Robot
                            </div>
                        </button>
                    </div>
                    <div class="settings-section">
                        <button
                            type="button"
                            class="settings-nav-row danger"
                            onClick={() => setShowRobotShutdownConfirm(true)}
                        >
                            <div class="settings-nav-row-left">
                                <Icon svg={alertSvg} />
                                Shutdown Robot
                            </div>
                        </button>
                    </div>
                </SettingsCategory>

                <SettingsCategory title="Danger Zone" icon={alertSvg}>
                    <div class="settings-section">
                        <button
                            type="button"
                            class="settings-nav-row danger"
                            onClick={() => setShowFormatConfirm(true)}
                        >
                            <div class="settings-nav-row-left">
                                <Icon svg={databaseSvg} />
                                Format Storage
                            </div>
                        </button>
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row danger" onClick={() => setShowResetConfirm(true)}>
                            <div class="settings-nav-row-left">
                                <Icon svg={alertSvg} />
                                Factory Reset
                            </div>
                        </button>
                    </div>
                </SettingsCategory>
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

            {showFormatConfirm && (
                <ConfirmDialog
                    message="This will erase all logs and map data. Settings are preserved. Device will reboot."
                    confirmLabel="Format"
                    disabled={restarting}
                    onConfirm={handleFormatFs}
                    onCancel={() => setShowFormatConfirm(false)}
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

            {showUploadConfirm && (
                <ConfirmDialog
                    message="No checksums.txt provided. A corrupted firmware file could brick your device. Upload anyway?"
                    confirmLabel="Upload"
                    onConfirm={() => {
                        setShowUploadConfirm(false);
                        fw.startUpload();
                    }}
                    onCancel={() => setShowUploadConfirm(false)}
                />
            )}

            {showRobotRestartConfirm && (
                <ConfirmDialog
                    message="Restart the robot? It will be unavailable for a few seconds."
                    confirmLabel="Restart"
                    onConfirm={() => {
                        setShowRobotRestartConfirm(false);
                        handleRobotRestart();
                    }}
                    onCancel={() => setShowRobotRestartConfirm(false)}
                />
            )}

            {showRobotShutdownConfirm && (
                <ConfirmDialog
                    message="Shut down the robot? The ESP32 will lose power and go offline. The robot needs a physical button press to turn back on."
                    confirmLabel="Shutdown"
                    onConfirm={handleRobotShutdown}
                    onCancel={() => setShowRobotShutdownConfirm(false)}
                />
            )}

            {(rebooting || robotRestarting) && (
                <div class="reboot-overlay">
                    <div class="reboot-dialog">
                        <div class="reboot-spinner" />
                        <div class="reboot-text">{robotRestarting ? "Restarting robot..." : "Rebooting..."}</div>
                        <div class="reboot-subtext">
                            {robotRestarting
                                ? "Waiting for robot to come back online"
                                : "Waiting for device to come back online"}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
