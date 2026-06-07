import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import alertSvg from "../assets/icons/alert.svg?raw";
import backSvg from "../assets/icons/back.svg?raw";
import bellSvg from "../assets/icons/bell.svg?raw";
import boltSvg from "../assets/icons/bolt.svg?raw";
import calendarSvg from "../assets/icons/calendar.svg?raw";
import chipSvg from "../assets/icons/chip.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import gearSvg from "../assets/icons/gear.svg?raw";
import globeSvg from "../assets/icons/globe.svg?raw";
import houseSvg from "../assets/icons/house.svg?raw";
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
import { TimeInput } from "../components/time-input";
import { useDirtyGuard } from "../hooks/use-dirty-guard";
import { usePoll } from "../hooks/use-poll";
import { usePolling } from "../hooks/use-polling";
import { availableLocales, type LanguagePreference, T, useI18n } from "../i18n";
import type { FirmwareVersion, SystemData, UserSettingsData } from "../types";
import { normalizeError } from "../utils";
import {
    BRUSH_PRESETS,
    NAV_MODE_PRESETS,
    SIDE_BRUSH_PRESETS,
    STALL_PRESETS,
    TIMEZONE_PRESETS,
    TX_POWER_PRESETS,
    VACUUM_PRESETS,
} from "./settings/constants";
import { findPresetLabel } from "./settings/helpers";
import { SettingsCategory } from "./settings/settings-category";
import { useFirmwareUpload } from "./settings/use-firmware-upload";
import { useReboot } from "./settings/use-reboot";
import { useSettingsForm } from "./settings/use-settings-form";
import { WiFiSection } from "./settings/wifi-section";

type Theme = "system" | "dark" | "light";

interface SettingsViewProps {
    theme: Theme;
    onThemeChange: (t: Theme) => void;
    language: LanguagePreference;
    onLanguageChange: (language: LanguagePreference) => void;
    firmware: FirmwareVersion | null;
}

function languageLabel(locale: string): string {
    try {
        return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
    } catch {
        return locale;
    }
}

export function SettingsView({ theme, onThemeChange, language, onLanguageChange, firmware }: SettingsViewProps) {
    const { t, formatDuration, formatBytes } = useI18n();
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
        logLevel,
        setLogLevel,
        syslogEnabled,
        setSyslogEnabled,
        syslogIp,
        setSyslogIp,
        wifiTxPower,
        setWifiTxPower,
        apFallbackOnDisconnect,
        setApFallbackOnDisconnect,
        uartTxPin,
        setUartTxPin,
        uartRxPin,
        setUartRxPin,
        maxGpioPin,
        hostname,
        setHostname,
        navMode,
        setNavMode,
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
        autoRestartEnabled,
        setAutoRestartEnabled,
        autoRestartTime,
        setAutoRestartTime,
        restartBeforeClean,
        setRestartBeforeClean,
        isDirty,
        pinError,
        hostnameError,
        syslogIpError,
        autoRestartTimeError,
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
        wallEnable: "WallEnable",
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
                    errorStack.push(normalizeError(e, "Failed to update robot settings"));
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
                setNotifTestResult(normalizeError(e, "Failed"));
                setTimeout(() => setNotifTestResult(null), 3000);
            })
            .finally(() => setTestingNotif(false));
    }, [ntfyTopic]);

    // --- Dialogs ---
    const [showRestartConfirm, setShowRestartConfirm] = useState(false);
    const [showFormatConfirm, setShowFormatConfirm] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showUploadConfirm, setShowUploadConfirm] = useState(false);
    const [restarting, setRestarting] = useState(false);

    // --- Robot power control ---
    const [showRobotRestartConfirm, setShowRobotRestartConfirm] = useState(false);
    const [showRobotShutdownConfirm, setShowRobotShutdownConfirm] = useState(false);
    const [robotRestarting, setRobotRestarting] = useState(false);
    const [robotRestartPolling, setRobotRestartPolling] = useState(false);
    const robotRestartTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (robotRestartTimeout.current) clearTimeout(robotRestartTimeout.current);
        };
    }, []);

    usePoll(
        async () => {
            await api.getState();
            if (robotRestartTimeout.current) clearTimeout(robotRestartTimeout.current);
            robotRestartTimeout.current = null;
            setRobotRestarting(false);
            setRobotRestartPolling(false);
        },
        2000,
        robotRestartPolling,
        2000,
    );

    const handleRobotRestart = useCallback(() => {
        setRobotRestarting(true);

        robotRestartTimeout.current = setTimeout(() => {
            setRobotRestartPolling(false);
            setRobotRestarting(false);
            errorStack.push("Robot did not recover after restart - check physical connection");
        }, 30000);

        api.robotRestart()
            .then(() => setRobotRestartPolling(true))
            .catch((e: unknown) => {
                if (robotRestartTimeout.current) clearTimeout(robotRestartTimeout.current);
                robotRestartTimeout.current = null;
                setRobotRestarting(false);
                errorStack.push(normalizeError(e, "Failed to restart robot"));
            });
    }, [errorStack]);

    const handleRobotShutdown = useCallback(() => {
        setShowRobotShutdownConfirm(false);
        // Navigate immediately — the ESP32 will lose power and go offline,
        // so we don't wait for the response or surface network errors.
        api.robotShutdown().catch(() => {});
        navigate("/");
    }, [navigate]);

    // --- Clear errors ---
    const [showClearErrorsConfirm, setShowClearErrorsConfirm] = useState(false);
    const [clearingErrors, setClearingErrors] = useState(false);

    const handleClearErrors = useCallback(() => {
        setShowClearErrorsConfirm(false);
        setClearingErrors(true);
        api.clearErrors()
            .catch((e: unknown) => {
                errorStack.push(normalizeError(e, "Failed to clear errors"));
            })
            .finally(() => setClearingErrors(false));
    }, [errorStack]);

    // --- Unsaved changes guards ---

    const { guardedNavigate, showDiscardConfirm, setShowDiscardConfirm, handleDiscard } = useDirtyGuard(isDirty);

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
                    errorStack.push(normalizeError(e, "Failed to restart"));
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
                    errorStack.push(normalizeError(e, "Failed to format storage"));
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
                    errorStack.push(normalizeError(e, "Failed to factory reset"));
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
                <button
                    type="button"
                    class="header-back-btn"
                    onClick={() => guardedNavigate("/")}
                    aria-label={t("Back")}
                >
                    <Icon svg={backSvg} />
                </button>
                <h1>
                    <T>Settings</T>
                </h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="settings-page">
                <SettingsCategory title={t("Appearance")} icon={paletteSvg} defaultOpen>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Theme</T>
                        </div>
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
                                <T>Auto</T>
                            </button>
                            <button
                                type="button"
                                class={`settings-theme-btn${theme === "light" ? " active" : ""}`}
                                onClick={() => onThemeChange("light")}
                            >
                                <div class="settings-theme-icon">
                                    <Icon svg={sunSvg} />
                                </div>
                                <T>Light</T>
                            </button>
                            <button
                                type="button"
                                class={`settings-theme-btn${theme === "dark" ? " active" : ""}`}
                                onClick={() => onThemeChange("dark")}
                            >
                                <div class="settings-theme-icon">
                                    <Icon svg={moonSvg} />
                                </div>
                                <T>Dark</T>
                            </button>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Language</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={language}
                                onChange={(e) =>
                                    onLanguageChange((e.target as HTMLSelectElement).value as LanguagePreference)
                                }
                            >
                                {availableLocales.map((locale) => (
                                    <option key={locale} value={locale}>
                                        {languageLabel(locale)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <T>Choose the interface language. Missing translations fall back to English.</T>
                        </div>
                    </div>
                </SettingsCategory>

                <SettingsCategory title={t("Device")} icon={gearSvg}>
                    <div class="settings-section">
                        <div class="fw-info-row">
                            <div class="fw-info-item">
                                <Icon svg={clockSvg} />
                                <span>{system?.uptime ? formatDuration(Math.floor(system.uptime / 1000)) : "..."}</span>
                            </div>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Hostname</T>
                        </div>
                        <input
                            type="text"
                            class="settings-text-input"
                            value={hostname}
                            maxLength={32}
                            onInput={(e) => setHostname((e.target as HTMLInputElement).value)}
                            disabled={saving}
                            placeholder={t("neato")}
                        />
                        {hostnameError ? (
                            <div class="settings-field-error">{hostnameError}</div>
                        ) : (
                            <div class="settings-robot-time">
                                <T>mDNS hostname for the device on your network</T>
                            </div>
                        )}
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>WiFi TX Power</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={wifiTxPower}
                                onChange={(e) => setWifiTxPower(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {TX_POWER_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {t(p.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <Icon svg={wifiSvg} />
                            <T>Lower power reduces range but improves stability on serial port power</T>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Timezone</T>
                        </div>
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
                                        {t(p.label)}
                                    </option>
                                ))}
                                {isCustom && (
                                    <option value="__custom__" disabled>
                                        {t("Custom: {timezone}", { timezone: tz })}
                                    </option>
                                )}
                            </select>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>UART Pins</T>
                        </div>
                        <div class="settings-pin-row">
                            <label class="settings-pin-label">
                                <T>TX (ESP → Robot)</T>
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
                                <T>RX (Robot → ESP)</T>
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
                                <T>Cleaning Schedule</T>
                            </div>
                            <span class="settings-nav-chevron">&rsaquo;</span>
                        </button>
                    </div>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Auto restart</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Restart the robot automatically once per day when it is idle</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${autoRestartEnabled ? " on" : ""}`}
                                onClick={() => setAutoRestartEnabled(!autoRestartEnabled)}
                                disabled={saving || firmware?.supported === false}
                                aria-label={t("Toggle auto restart")}
                            />
                        </div>
                        {autoRestartEnabled && (
                            <>
                                <div class="settings-ntfy-row">
                                    <TimeInput
                                        class="settings-text-input"
                                        value={autoRestartTime}
                                        maxLength={5}
                                        placeholder={t("HH:MM")}
                                        onInput={setAutoRestartTime}
                                        disabled={saving}
                                    />
                                </div>
                                {autoRestartTimeError && <div class="settings-field-error">{autoRestartTimeError}</div>}
                                <div class="settings-robot-time">
                                    <T>
                                        Uses the configured local timezone and skips the restart if the robot is busy.
                                    </T>
                                </div>
                                {robotSettings?.melodies && (
                                    <div class="settings-robot-time settings-hint-warn">
                                        <T>
                                            Robot melodies are enabled. Restart at the scheduled time will play sound.
                                        </T>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Restart before scheduled clean</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Power-cycle the robot before each scheduled clean to ensure responsiveness</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${restartBeforeClean ? " on" : ""}`}
                                onClick={() => setRestartBeforeClean(!restartBeforeClean)}
                                disabled={saving || firmware?.supported === false}
                                aria-label={t("Toggle restart before clean")}
                            />
                        </div>
                        {restartBeforeClean && (
                            <div class="settings-robot-time">
                                <T>The robot will restart and wait for boot before starting the scheduled clean.</T>
                            </div>
                        )}
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row" onClick={() => setShowRestartConfirm(true)}>
                            <div class="settings-nav-row-left">
                                <Icon svg={powerSvg} />
                                <T>Restart Device</T>
                            </div>
                        </button>
                    </div>
                </SettingsCategory>

                <SettingsCategory title={t("WiFi")} icon={wifiSvg} lazy>
                    <WiFiSection
                        apFallbackOnDisconnect={apFallbackOnDisconnect}
                        onApFallbackChange={setApFallbackOnDisconnect}
                        saving={saving}
                        errorStack={errorStack}
                    />
                </SettingsCategory>

                <SettingsCategory title={t("Notifications")} icon={bellSvg}>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Enable notifications</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Push alerts via ntfy.sh over plain HTTP</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${ntfyEnabled ? " on" : ""}`}
                                onClick={() => setNtfyEnabled(!ntfyEnabled)}
                                disabled={saving}
                                aria-label={t("Toggle notifications")}
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
                                        placeholder={t("e.g. my-robot-alerts")}
                                    />
                                    <button
                                        type="button"
                                        class="settings-ntfy-test-btn"
                                        onClick={handleTestNotification}
                                        disabled={!ntfyTopic.trim() || testingNotif}
                                    >
                                        {testingNotif ? "..." : t(notifTestResult ?? "Test")}
                                    </button>
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">
                                            <T>Cleaning done</T>
                                        </span>
                                        <span class="settings-toggle-desc">
                                            <T>When a cleaning cycle completes</T>
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnDone ? " on" : ""}`}
                                        onClick={() => setNtfyOnDone(!ntfyOnDone)}
                                        disabled={saving}
                                        aria-label={t("Toggle cleaning done notification")}
                                    />
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">
                                            <T>Robot error</T>
                                        </span>
                                        <span class="settings-toggle-desc">
                                            <T>Stuck brush, wheel, or other failures</T>
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnError ? " on" : ""}`}
                                        onClick={() => setNtfyOnError(!ntfyOnError)}
                                        disabled={saving}
                                        aria-label={t("Toggle error notification")}
                                    />
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">
                                            <T>Robot alert</T>
                                        </span>
                                        <span class="settings-toggle-desc">
                                            <T>Brush or filter replacement reminders</T>
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnAlert ? " on" : ""}`}
                                        onClick={() => setNtfyOnAlert(!ntfyOnAlert)}
                                        disabled={saving}
                                        aria-label={t("Toggle alert notification")}
                                    />
                                </div>
                                <div class="settings-toggle-row">
                                    <div class="settings-toggle-label">
                                        <span class="settings-toggle-title">
                                            <T>Returning to base</T>
                                        </span>
                                        <span class="settings-toggle-desc">
                                            <T>When the robot docks to charge</T>
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        class={`settings-toggle${ntfyOnDocking ? " on" : ""}`}
                                        onClick={() => setNtfyOnDocking(!ntfyOnDocking)}
                                        disabled={saving}
                                        aria-label={t("Toggle docking notification")}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </SettingsCategory>

                <SettingsCategory title={t("House Cleaning")} icon={houseSvg} disabled={firmware?.supported === false}>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Navigation</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={navMode}
                                onChange={(e) => setNavMode((e.target as HTMLSelectElement).value)}
                                disabled={saving}
                            >
                                {NAV_MODE_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {t(p.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <T>
                                How the robot navigates during house cleaning. Extra Care avoids obstacles, Deep cleans
                                corners thoroughly.
                            </T>
                        </div>
                    </div>
                </SettingsCategory>

                <SettingsCategory title={t("Manual Clean")} icon={manualSvg}>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Brush Speed</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={brushRpm}
                                onChange={(e) => setBrushRpm(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {BRUSH_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {t(p.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <T>Main brush rotation speed during manual clean</T>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Vacuum Power</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={vacuumSpeed}
                                onChange={(e) => setVacuumSpeed(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {VACUUM_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {t(p.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <T>Vacuum motor speed during manual clean</T>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Side Brush Power</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={sideBrushPower}
                                onChange={(e) => setSideBrushPower(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {SIDE_BRUSH_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {t(p.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <T>Side brush motor power (D5 and above)</T>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Stall Detection</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={stallThreshold}
                                onChange={(e) => setStallThreshold(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                {STALL_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {t(p.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            <T>Wheel load threshold for obstacle detection during manual driving</T>
                        </div>
                    </div>
                </SettingsCategory>

                <SettingsCategory title={t("Firmware")} icon={chipSvg}>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Firmware</T>
                        </div>
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
                        <div class="settings-section-title">
                            <T>Update</T>
                        </div>
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
                                        {fw.file ? fw.file.name : t("Select firmware file (.bin)")}
                                    </span>
                                </label>
                                {fw.file && (
                                    <div class="fw-file-meta">
                                        {formatBytes(fw.file.size)}
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
                                                    : t("Select checksums.txt (optional)")}
                                            </span>
                                        </label>
                                        {fw.checksumResult === "match" && (
                                            <div class="fw-checksum-status fw-checksum-ok">
                                                <T>Checksum verified</T>
                                            </div>
                                        )}
                                        {fw.checksumResult === "mismatch" && (
                                            <div class="fw-checksum-status fw-checksum-fail">
                                                <T>Checksum mismatch - firmware file may be corrupted</T>
                                            </div>
                                        )}
                                        {fw.checksumResult === "not-found" && (
                                            <div class="fw-checksum-status fw-checksum-warn">
                                                <T>Firmware filename not found in checksums file</T>
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
                                                <T>Upload & Install</T>
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
                                <div class="fw-progress-text">
                                    <T>Computing checksum...</T>
                                </div>
                            </div>
                        )}
                        {fw.status === "uploading" && (
                            <div class="fw-progress-wrap">
                                <div class="fw-progress-bar">
                                    <div class="fw-progress-fill" style={{ width: `${fw.progress}%` }} />
                                </div>
                                <div class="fw-progress-text">
                                    {fw.progress >= 90
                                        ? t("Writing firmware...")
                                        : t("Uploading... {progress}%", { progress: fw.progress })}
                                </div>
                            </div>
                        )}
                        {fw.status === "done" && (
                            <div class="fw-progress-wrap">
                                <div class="fw-progress-bar">
                                    <div class="fw-progress-fill" style={{ width: "100%" }} />
                                </div>
                                <div class="fw-progress-text">
                                    <T>Upload complete. Rebooting...</T>
                                </div>
                            </div>
                        )}
                    </div>
                </SettingsCategory>

                <SettingsCategory title={t("Diagnostics")} icon={stethoscopeSvg} lazy>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Log Level</T>
                        </div>
                        <div class="settings-tz-select-wrap">
                            <select
                                class="settings-tz-select"
                                value={logLevel}
                                onChange={(e) => setLogLevel(parseInt((e.target as HTMLSelectElement).value, 10))}
                                disabled={saving}
                            >
                                <option value={0}>{t("Off (default)")}</option>
                                <option value={1}>{t(syslogEnabled ? "Info" : "Info (auto-off after 1 hour)")}</option>
                                <option value={2}>
                                    {t(syslogEnabled ? "Debug" : "Debug (auto-off after 10 min)")}
                                </option>
                            </select>
                        </div>
                        <div class="settings-robot-time">
                            {syslogEnabled
                                ? t("Logs are sent to the remote syslog server over UDP.")
                                : t(
                                      "Logging writes to flash storage. Higher levels increase wear and can slow serial communication.",
                                  )}
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Remote syslog</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Send logs over UDP instead of writing to flash</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${syslogEnabled ? " on" : ""}`}
                                onClick={() => setSyslogEnabled(!syslogEnabled)}
                                disabled={saving}
                                aria-label={t("Toggle remote syslog")}
                            />
                        </div>
                        {syslogEnabled && (
                            <>
                                <div class="settings-ntfy-row">
                                    <input
                                        type="text"
                                        class="settings-text-input"
                                        value={syslogIp}
                                        onInput={(e) => setSyslogIp((e.target as HTMLInputElement).value)}
                                        disabled={saving}
                                        placeholder={t("e.g. 192.168.1.100")}
                                    />
                                </div>
                                {syslogIpError && <div class="settings-field-error">{syslogIpError}</div>}
                            </>
                        )}
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row" onClick={() => guardedNavigate("/battery")}>
                            <div class="settings-nav-row-left">
                                <Icon svg={boltSvg} />
                                <T>Battery Diagnostics</T>
                            </div>
                            <span class="settings-nav-chevron">&rsaquo;</span>
                        </button>
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row" onClick={() => guardedNavigate("/logs")}>
                            <div class="settings-nav-row-left">
                                <Icon svg={databaseSvg} />
                                <T>Logs</T>
                            </div>
                            <span class="settings-nav-chevron">&rsaquo;</span>
                        </button>
                    </div>
                    <div class="settings-section">
                        <button
                            type="button"
                            class="settings-nav-row"
                            onClick={() => setShowClearErrorsConfirm(true)}
                            disabled={clearingErrors || firmware?.supported === false}
                        >
                            <div class="settings-nav-row-left">
                                <Icon svg={alertSvg} />
                                <T>Clear Robot Errors</T>
                            </div>
                        </button>
                    </div>
                </SettingsCategory>

                <button
                    type="button"
                    class={`settings-save-btn${saving ? " pending" : ""}`}
                    onClick={onSaveClick}
                    disabled={saving || !isDirty || !!validationError}
                >
                    {t(saveLabel)}
                </button>

                <SettingsCategory title={t("Robot")} icon={robotSvg} disabled={firmware?.supported === false}>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Sound</T>
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Button clicks</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Sound when pressing buttons</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.buttonClick ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("buttonClick", !robotSettings?.buttonClick)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle button clicks")}
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Melodies</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Startup and shutdown sounds</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.melodies ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("melodies", !robotSettings?.melodies)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle melodies")}
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Warnings</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Warning beeps</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.warnings ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("warnings", !robotSettings?.warnings)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle warnings")}
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Cleaning options</T>
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Eco mode</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Lower brush and vacuum power, longer battery life</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.ecoMode ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("ecoMode", !robotSettings?.ecoMode)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle eco mode")}
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Intense clean</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Double-pass cleaning for deeper clean</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.intenseClean ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("intenseClean", !robotSettings?.intenseClean)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle intense clean")}
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Bin full detection</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Alert when dust bin is full</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.binFullDetect ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() =>
                                    handleRobotSettingsChange("binFullDetect", !robotSettings?.binFullDetect)
                                }
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle bin full detection")}
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Wall following</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Follow walls and edges for thorough cleaning</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.wallEnable ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("wallEnable", !robotSettings?.wallEnable)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle wall following")}
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Power Saving</T>
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Robot WiFi</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Unused with OpenNeato, disable to save power</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.wifi ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("wifi", !robotSettings?.wifi)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle robot WiFi")}
                            />
                        </div>
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">
                                    <T>Stealth LEDs</T>
                                </span>
                                <span class="settings-toggle-desc">
                                    <T>Disable standby indicator lights</T>
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${robotSettings?.stealthLed ? " on" : ""}${savingRobotSettings ? " pending" : ""}`}
                                onClick={() => handleRobotSettingsChange("stealthLed", !robotSettings?.stealthLed)}
                                disabled={robotSettingsDisabled}
                                aria-label={t("Toggle stealth LEDs")}
                            />
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <T>Power Control</T>
                        </div>
                        <button type="button" class="settings-nav-row" onClick={() => setShowRobotRestartConfirm(true)}>
                            <div class="settings-nav-row-left">
                                <Icon svg={powerSvg} />
                                <T>Restart Robot</T>
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
                                <T>Shutdown Robot</T>
                            </div>
                        </button>
                    </div>
                </SettingsCategory>

                {firmware && (
                    <SettingsCategory title={t("About")} icon={globeSvg}>
                        <div class="settings-section">
                            <div class="settings-about-card">
                                <div class="settings-about-name">{firmware.name}</div>
                                <div class="settings-about-description">
                                    <T>Open-source replacement for Neato's discontinued cloud and mobile app.</T>
                                </div>
                                <div class="settings-about-meta">
                                    <T>Copyright © 2026 Soner Köksal</T>
                                </div>
                                <div class="settings-about-meta">
                                    {t("Licensed under {license} License", { license: firmware.license })}
                                </div>
                            </div>
                        </div>
                        <div class="settings-section">
                            <a
                                class="settings-nav-row settings-link-row"
                                href={firmware.repositoryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <div class="settings-nav-row-left">
                                    <Icon svg={globeSvg} />
                                    <T>View on GitHub</T>
                                </div>
                                <span class="settings-nav-chevron">&rsaquo;</span>
                            </a>
                        </div>
                    </SettingsCategory>
                )}

                <SettingsCategory title={t("Danger Zone")} icon={alertSvg}>
                    <div class="settings-section">
                        <button
                            type="button"
                            class="settings-nav-row danger"
                            onClick={() => setShowFormatConfirm(true)}
                        >
                            <div class="settings-nav-row-left">
                                <Icon svg={databaseSvg} />
                                <T>Format Storage</T>
                            </div>
                        </button>
                    </div>
                    <div class="settings-section">
                        <button type="button" class="settings-nav-row danger" onClick={() => setShowResetConfirm(true)}>
                            <div class="settings-nav-row-left">
                                <Icon svg={alertSvg} />
                                <T>Factory Reset</T>
                            </div>
                        </button>
                    </div>
                </SettingsCategory>
            </div>

            {showDiscardConfirm && (
                <ConfirmDialog
                    message={t("You have unsaved changes. Discard them?")}
                    confirmLabel={t("Discard")}
                    onConfirm={handleDiscard}
                    onCancel={() => setShowDiscardConfirm(false)}
                />
            )}

            {showSaveConfirm && (
                <ConfirmDialog
                    message={t("Some changes require a device reboot. Save and reboot now?")}
                    confirmLabel={t("Save & Reboot")}
                    disabled={saving}
                    onConfirm={handleSave}
                    onCancel={() => setShowSaveConfirm(false)}
                />
            )}

            {showRestartConfirm && (
                <ConfirmDialog
                    message={t("Restart device?")}
                    confirmLabel={t("Restart")}
                    disabled={restarting}
                    onConfirm={handleRestart}
                    onCancel={() => setShowRestartConfirm(false)}
                />
            )}

            {showFormatConfirm && (
                <ConfirmDialog
                    message={t("This will erase all logs and map data. Settings are preserved. Device will reboot.")}
                    confirmLabel={t("Format")}
                    disabled={restarting}
                    onConfirm={handleFormatFs}
                    onCancel={() => setShowFormatConfirm(false)}
                />
            )}

            {showResetConfirm && (
                <ConfirmDialog
                    message={t("This will erase all settings including WiFi credentials. Are you sure?")}
                    confirmLabel={t("Factory Reset")}
                    confirmText={t("RESET")}
                    disabled={restarting}
                    onConfirm={handleFactoryReset}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}

            {showUploadConfirm && (
                <ConfirmDialog
                    message={t(
                        "No checksums.txt provided. A corrupted firmware file could brick your device. Upload anyway?",
                    )}
                    confirmLabel={t("Upload")}
                    onConfirm={() => {
                        setShowUploadConfirm(false);
                        fw.startUpload();
                    }}
                    onCancel={() => setShowUploadConfirm(false)}
                />
            )}

            {showClearErrorsConfirm && (
                <ConfirmDialog
                    message={t(
                        "Clear all robot errors and warnings? This dismisses any active error state on the robot.",
                    )}
                    confirmLabel={t("Clear")}
                    onConfirm={handleClearErrors}
                    onCancel={() => setShowClearErrorsConfirm(false)}
                />
            )}

            {showRobotRestartConfirm && (
                <ConfirmDialog
                    message={t("Restart the robot? It will be unavailable for a few seconds.")}
                    confirmLabel={t("Restart")}
                    onConfirm={() => {
                        setShowRobotRestartConfirm(false);
                        handleRobotRestart();
                    }}
                    onCancel={() => setShowRobotRestartConfirm(false)}
                />
            )}

            {showRobotShutdownConfirm && (
                <ConfirmDialog
                    message={t(
                        "Shut down the robot? The ESP32 will lose power and go offline. The robot needs a physical button press to turn back on.",
                    )}
                    confirmLabel={t("Shutdown")}
                    onConfirm={handleRobotShutdown}
                    onCancel={() => setShowRobotShutdownConfirm(false)}
                />
            )}

            {(rebooting || robotRestarting) && (
                <div class="loading-overlay">
                    <div class="loading-dialog">
                        <div class="loading-spinner" />
                        <div class="loading-text">{t(robotRestarting ? "Restarting robot..." : "Rebooting...")}</div>
                        <div class="loading-subtext">
                            {t(
                                robotRestarting
                                    ? "Waiting for robot to come back online"
                                    : "Waiting for device to come back online",
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
