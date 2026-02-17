import { TIMEZONE_PRESETS } from "./constants";

export function findPresetLabel(tz: string): string | null {
    const match = TIMEZONE_PRESETS.find((p) => p.tz === tz);
    return match ? match.label : null;
}

export function formatRobotTime(epochSec: number, tz: string): string {
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
