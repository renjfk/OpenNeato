import type { SettingsData } from "../../types";

interface TimezonePreset {
    label: string;
    tz: string;
    std: string; // Standard time abbreviation, e.g. "EET"
    dst?: string; // DST abbreviation, e.g. "EEST"
}

interface TxPowerPreset {
    label: string;
    value: number;
}

// Common timezone presets — label shown in UI, value is POSIX TZ string
// Zones with DST show both offsets (standard/summer) to avoid confusion
export const TIMEZONE_PRESETS: TimezonePreset[] = [
    { label: "UTC (UTC+0)", tz: "UTC0", std: "UTC" },
    { label: "US Hawaii (UTC-10)", tz: "HST10", std: "HST" },
    { label: "US Alaska (UTC-9/-8)", tz: "AKST9AKDT,M3.2.0,M11.1.0", std: "AKST", dst: "AKDT" },
    { label: "US Pacific (UTC-8/-7)", tz: "PST8PDT,M3.2.0,M11.1.0", std: "PST", dst: "PDT" },
    { label: "US Mountain (UTC-7/-6)", tz: "MST7MDT,M3.2.0,M11.1.0", std: "MST", dst: "MDT" },
    { label: "US Central (UTC-6/-5)", tz: "CST6CDT,M3.2.0,M11.1.0", std: "CST", dst: "CDT" },
    { label: "US Eastern (UTC-5/-4)", tz: "EST5EDT,M3.2.0,M11.1.0", std: "EST", dst: "EDT" },
    { label: "UK / Ireland (UTC+0/+1)", tz: "GMT0BST,M3.5.0/1,M10.5.0", std: "GMT", dst: "BST" },
    { label: "Central Europe (UTC+1/+2)", tz: "CET-1CEST,M3.5.0,M10.5.0/3", std: "CET", dst: "CEST" },
    { label: "Eastern Europe (UTC+2/+3)", tz: "EET-2EEST,M3.5.0/3,M10.5.0/4", std: "EET", dst: "EEST" },
    { label: "Turkey (UTC+3)", tz: "<+03>-3", std: "TRT" },
    { label: "India (UTC+5:30)", tz: "IST-5:30", std: "IST" },
    { label: "China / Singapore (UTC+8)", tz: "CST-8", std: "CST" },
    { label: "Japan / Korea (UTC+9)", tz: "JST-9", std: "JST" },
    { label: "Australia Eastern (UTC+10/+11)", tz: "AEST-10AEDT,M10.1.0,M4.1.0/3", std: "AEST", dst: "AEDT" },
    { label: "New Zealand (UTC+12/+13)", tz: "NZST-12NZDT,M9.5.0,M4.1.0/3", std: "NZST", dst: "NZDT" },
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

// Navigation mode presets — sent to robot before each house clean
export interface NavModePreset {
    label: string;
    value: string;
}

export const NAV_MODE_PRESETS: NavModePreset[] = [
    { label: "Normal", value: "Normal" },
    { label: "Extra Care", value: "Gentle" },
    { label: "Deep", value: "Deep" },
    { label: "Quick", value: "Quick" },
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

export const DEFAULT_SERVER = {
    tz: "UTC0",
    logLevel: 0,
    wifiTxPower: 60,
    uartTxPin: 3,
    uartRxPin: 4,
    maxGpioPin: 21,
    hostname: "neato",
    navMode: "Normal",
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
