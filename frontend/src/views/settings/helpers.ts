import { TIMEZONE_PRESETS } from "./constants";

export function findPresetLabel(tz: string): string | null {
    const match = TIMEZONE_PRESETS.find((p) => p.tz === tz);
    return match ? match.label : null;
}

// Return the current timezone abbreviation (e.g. "EEST" during DST, "EET" otherwise).
export function findCurrentTzAbbrev(tz: string, isDst: boolean): string | null {
    const match = TIMEZONE_PRESETS.find((p) => p.tz === tz);
    if (!match) return null;
    return isDst && match.dst ? match.dst : (match.std ?? null);
}
