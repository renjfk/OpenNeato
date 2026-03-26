import type { SettingsData } from "../../types";

interface TimezonePreset {
    label: string;
    tz: string;
}

interface TxPowerPreset {
    label: string;
    value: number;
}

// Common timezone presets — label shown in UI, value is POSIX TZ string
// UTC offset shown is the standard (non-DST) offset
export const TIMEZONE_PRESETS: TimezonePreset[] = [
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
export const TX_POWER_PRESETS: TxPowerPreset[] = [
    { label: "8.5 dBm (low power)", value: 34 },
    { label: "11 dBm", value: 44 },
    { label: "13 dBm", value: 52 },
    { label: "15 dBm (recommended)", value: 60 },
    { label: "17 dBm", value: 68 },
    { label: "19.5 dBm (max range)", value: 78 },
];

// Stall detection presets — wheel load % threshold
export interface StallPreset {
    label: string;
    value: number;
}

export const STALL_PRESETS: StallPreset[] = [
    { label: "30% (very sensitive)", value: 30 },
    { label: "40%", value: 40 },
    { label: "50%", value: 50 },
    { label: "60% (recommended)", value: 60 },
    { label: "70%", value: 70 },
    { label: "80% (less sensitive)", value: 80 },
];

// Brush RPM presets — safe range 500-2000, above 2000 motor shuts off
export interface BrushPreset {
    label: string;
    value: number;
}

export const BRUSH_PRESETS: BrushPreset[] = [
    { label: "800 RPM (eco)", value: 800 },
    { label: "1000 RPM", value: 1000 },
    { label: "1200 RPM (recommended)", value: 1200 },
    { label: "1400 RPM", value: 1400 },
    { label: "1600 RPM (high)", value: 1600 },
];

// Vacuum speed presets — 1-100%
export interface VacuumPreset {
    label: string;
    value: number;
}

export const VACUUM_PRESETS: VacuumPreset[] = [
    { label: "40% (eco)", value: 40 },
    { label: "60%", value: 60 },
    { label: "80% (recommended)", value: 80 },
    { label: "90%", value: 90 },
    { label: "100% (turbo)", value: 100 },
];

// Side brush power presets — milliwatts, open-loop
export interface SideBrushPreset {
    label: string;
    value: number;
}

export const SIDE_BRUSH_PRESETS: SideBrushPreset[] = [
    { label: "700 mW", value: 700 },
    { label: "1000 mW", value: 1000 },
    { label: "1200 mW", value: 1200 },
    { label: "1500 mW (recommended)", value: 1500 },
];

export const DEFAULT_SERVER: SettingsData = {
    tz: "UTC0",
    logLevel: 0,
    wifiTxPower: 60,
    uartTxPin: 3,
    uartRxPin: 4,
    maxGpioPin: 21,
    hostname: "neato",
    stallThreshold: 60,
    brushRpm: 1200,
    vacuumSpeed: 80,
    sideBrushPower: 1500,
    ntfyTopic: "",
    ntfyEnabled: false,
    ntfyOnDone: true,
    ntfyOnError: true,
    ntfyOnAlert: true,
    ntfyOnDocking: true,
} as SettingsData;
