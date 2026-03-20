// Browser-side update checker — ports logic from tash/internal/data/update.go
// Fetches GitHub releases API, compares versions, stores state in localStorage.
// ESP32 makes no outbound connections; this runs entirely in the browser.

declare const __GITHUB_API_BASE__: string | undefined;
const GITHUB_API_BASE = typeof __GITHUB_API_BASE__ !== "undefined" ? __GITHUB_API_BASE__ : "https://api.github.com";
const GITHUB_RELEASES_URL = `${GITHUB_API_BASE}/repos/renjfk/OpenNeato/releases/latest`;
const RELEASE_URL_BASE = "https://github.com/renjfk/OpenNeato/releases/tag/";
const LS_KEY_LATEST = "update_latest_version";
const LS_KEY_TIMESTAMP = "update_last_check";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface GitHubRelease {
    tag_name: string;
}

export interface UpdateInfo {
    version: string;
    url: string;
}

// Strip leading "v", trim whitespace, drop suffix after "-" so that
// dev builds ("0.0-abc1234"), snapshots, and pre-release tags all
// reduce to their numeric base ("0.0").
function cleanVersion(v: string): string {
    v = v.trim();
    if (v.startsWith("v")) v = v.slice(1);
    const idx = v.indexOf("-");
    if (idx !== -1) v = v.slice(0, idx);
    return v;
}

// Parse a dotted version string with 1-2 numeric parts into [major, minor],
// padding missing parts with zero. Returns null on invalid input.
function splitVersion(v: string): [number, number] | null {
    if (!v) return null;
    const parts = v.split(".");
    if (parts.length === 0 || parts.length > 2) return null;
    const nums: [number, number] = [0, 0];
    for (let i = 0; i < parts.length; i++) {
        const n = Number.parseInt(parts[i], 10);
        if (Number.isNaN(n)) return null;
        nums[i] = n;
    }
    return nums;
}

// Returns true if version a is strictly newer than version b.
function isNewerVersion(a: string, b: string): boolean {
    const ap = splitVersion(a);
    const bp = splitVersion(b);
    if (!ap || !bp) return false;
    for (let i = 0; i < 2; i++) {
        if (ap[i] > bp[i]) return true;
        if (ap[i] < bp[i]) return false;
    }
    return false;
}

// Returns true if enough time has passed since the last check.
function shouldCheck(): boolean {
    const ts = localStorage.getItem(LS_KEY_TIMESTAMP);
    if (!ts) return true;
    const last = Number.parseInt(ts, 10);
    if (Number.isNaN(last)) return true;
    return Date.now() - last >= CHECK_INTERVAL_MS;
}

function writeTimestamp(): void {
    localStorage.setItem(LS_KEY_TIMESTAMP, String(Date.now()));
}

// Fetch latest release from GitHub, compare against current version,
// store result in localStorage. Fails silently on network errors.
export async function checkForUpdate(currentVersion: string): Promise<void> {
    const local = cleanVersion(currentVersion);
    if (!local || local === "0.0") return; // dev build, skip

    if (!shouldCheck()) return;
    writeTimestamp();

    try {
        const res = await fetch(GITHUB_RELEASES_URL, {
            headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;

        const release: GitHubRelease = await res.json();
        const latest = cleanVersion(release.tag_name);

        if (isNewerVersion(latest, local)) {
            localStorage.setItem(LS_KEY_LATEST, latest);
        } else {
            localStorage.removeItem(LS_KEY_LATEST);
        }
    } catch {
        // fail silently — network errors, rate limits, CORS issues
    }
}

// Read stored update info. Returns null if no update available or if the
// running version already matches/exceeds the stored version (handles the
// case where user updated but the flag file lingers).
export function getAvailableUpdate(currentVersion: string): UpdateInfo | null {
    const stored = localStorage.getItem(LS_KEY_LATEST);
    if (!stored) return null;

    const local = cleanVersion(currentVersion);
    if (!isNewerVersion(stored, local)) {
        localStorage.removeItem(LS_KEY_LATEST);
        return null;
    }

    return { version: stored, url: `${RELEASE_URL_BASE}v${stored}` };
}
