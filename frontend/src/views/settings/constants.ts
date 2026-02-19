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

export const DEFAULT_SERVER: SettingsData = {
    tz: "UTC0",
    debugLog: false,
    wifiTxPower: 60,
    uartTxPin: 3,
    uartRxPin: 4,
    hostname: "neato",
} as SettingsData;
