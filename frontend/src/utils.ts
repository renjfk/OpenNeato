// Small shared utilities. Keep dependency-free and side-effect-free so this
// module can be imported from anywhere (components, hooks, plain modules)
// without pulling in Preact.

// Zero-pad a non-negative integer to the given width. Used for clock and
// date formatting throughout the UI.
export function pad2(n: number): string {
    return n.toString().padStart(2, "0");
}

// Best-effort extraction of a human-readable message from a caught value.
// Falls back to the provided default when the value isn't an Error instance.
export function normalizeError(e: unknown, fallback = "Something went wrong"): string {
    return e instanceof Error ? e.message : fallback;
}
