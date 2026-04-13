import { TIMEZONE_PRESETS } from "./constants";

export function findPresetLabel(tz: string): string | null {
    const match = TIMEZONE_PRESETS.find((p) => p.tz === tz);
    return match ? match.label : null;
}

// Return the current timezone abbreviation (e.g. "EEST" during DST, "EET" otherwise).
export function findCurrentTzAbbrev(tz: string, isDst: boolean): string | null {
    const match = TIMEZONE_PRESETS.find((p) => p.tz === tz);
    if (!match) return null;
    return isDst && match.dst ? match.dst : match.std;
}

// Format robot time (Unix timestamp) as a human-readable string, e.g. "Sun 14:30:45"
export function formatRobotTime(unixTime: number, _tz: string): string {
    const date = new Date(unixTime * 1000);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const day = dayNames[date.getDay()];
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${day} ${hours}:${minutes}:${seconds}`;
}
