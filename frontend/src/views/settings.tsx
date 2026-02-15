import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import backSvg from "../assets/icons/back.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import moonSvg from "../assets/icons/moon.svg?raw";
import sunSvg from "../assets/icons/sun.svg?raw";
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
    const [tz, setTz] = useState<string>(system?.tz ?? "UTC0");
    const [debugLog, setDebugLog] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errors, errorStack] = useErrorStack();

    // Sync when system data arrives
    useEffect(() => {
        if (system?.tz) setTz(system.tz);
    }, [system?.tz]);

    // Fetch settings on mount to get debugLog state
    useEffect(() => {
        api.getSettings().then((s: SettingsData) => setDebugLog(s.debugLog));
    }, []);

    const handleTzChange = useCallback(
        (newTz: string) => {
            setTz(newTz);
            setSaving(true);
            api.updateSettings({ tz: newTz })
                .then((res) => setTz(res.tz))
                .catch((e: unknown) => {
                    if (system?.tz) setTz(system.tz);
                    errorStack.push(e instanceof Error ? e.message : "Failed to update timezone");
                })
                .finally(() => setSaving(false));
        },
        [system?.tz],
    );

    const [debugSaving, setDebugSaving] = useState(false);

    const handleDebugToggle = useCallback(() => {
        const next = !debugLog;
        setDebugLog(next);
        setDebugSaving(true);
        api.updateSettings({ debugLog: next })
            .catch(() => setDebugLog(!next))
            .finally(() => setDebugSaving(false));
    }, [debugLog]);

    const presetLabel = findPresetLabel(tz);
    const isCustom = !presetLabel;

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={() => navigate("/")} aria-label="Back">
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
                            class={`settings-tz-select${saving ? " pending" : ""}`}
                            value={isCustom ? "__custom__" : tz}
                            onChange={(e) => {
                                const val = (e.target as HTMLSelectElement).value;
                                if (val !== "__custom__") handleTzChange(val);
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
                    <div class="settings-section-title">Diagnostics</div>
                    <div class="settings-toggle-row">
                        <div class="settings-toggle-label">
                            <span class="settings-toggle-title">Debug logging</span>
                            <span class="settings-toggle-desc">Include serial responses in logs</span>
                        </div>
                        <button
                            type="button"
                            class={`settings-toggle${debugLog ? " on" : ""}${debugSaving ? " pending" : ""}`}
                            onClick={handleDebugToggle}
                            disabled={debugSaving}
                            aria-label="Toggle debug logging"
                        />
                    </div>
                    <button type="button" class="settings-nav-row" onClick={() => navigate("/logs")}>
                        <div class="settings-nav-row-left">
                            <Icon svg={databaseSvg} />
                            Logs
                        </div>
                        <span class="settings-nav-chevron">&rsaquo;</span>
                    </button>
                </div>
            </div>
        </>
    );
}
