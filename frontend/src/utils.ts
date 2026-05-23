// Small shared utilities. Keep dependency-free and side-effect-free so this
// module can be imported from anywhere (components, hooks, plain modules)
// without pulling in Preact.

// Zero-pad a non-negative integer to the given width. Used for clock and
// date formatting throughout the UI.
export function pad2(n: number): string {
    return n.toString().padStart(2, "0");
}

// Format hour/minute as "HH:MM".
export function fmtTime(h: number, m: number): string {
    return `${pad2(h)}:${pad2(m)}`;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Parse "HH:MM" into { hour, minute }, or null if invalid.
export function parseTime(value: string): { hour: number; minute: number } | null {
    const match = value.match(TIME_RE);
    if (!match) return null;
    return { hour: Number.parseInt(match[1], 10), minute: Number.parseInt(match[2], 10) };
}

// Best-effort extraction of a human-readable message from a caught value.
// Falls back to the provided default when the value isn't an Error instance.
export function normalizeError(e: unknown, fallback = "Something went wrong"): string {
    return e instanceof Error ? e.message : fallback;
}
