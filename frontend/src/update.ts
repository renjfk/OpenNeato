// Browser-side update checker.
//
// Asks the update host for the release list of this board, compares the newest
// stable release with the running version, and remembers the result in
// localStorage so the dashboard banner survives a page reload. Installs are
// driven from Settings and verified on the device; this file only decides
// whether to advertise an update.

import { fetchReleases, type ReleaseInfo } from "./releases";

const RELEASE_URL_BASE = "https://github.com/renjfk/OpenNeato/releases/tag/";
const LS_KEY_LATEST = "update_latest_version";
const LS_KEY_TIMESTAMP = "update_last_check";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UpdateInfo {
    version: string;
    url: string;
}

// Strip a leading "v", trim, and drop any suffix after "-" so dev builds
// ("0.0-abc1234") and prereleases ("0.15-pr220.abc1234") reduce to their
// numeric base for comparison.
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

export function clearUpdateCache(): void {
    localStorage.removeItem(LS_KEY_LATEST);
    localStorage.removeItem(LS_KEY_TIMESTAMP);
}

// True when a release's base version is older than the running one. Such a
// release is listed for reference but the device would refuse it.
export function isOlderVersion(candidate: string, currentVersion: string): boolean {
    const candidateBase = splitVersion(cleanVersion(candidate));
    const currentBase = splitVersion(cleanVersion(currentVersion));
    if (!candidateBase || !currentBase) return false;
    for (let i = 0; i < 2; i++) {
        if (candidateBase[i] < currentBase[i]) return true;
        if (candidateBase[i] > currentBase[i]) return false;
    }
    return false;
}

// Newest stable release that is newer than the running version, if any.
export function newestStable(releases: ReleaseInfo[], currentVersion: string): ReleaseInfo | null {
    const local = cleanVersion(currentVersion);
    if (!local || local === "0.0") return null;

    let best: ReleaseInfo | null = null;
    for (const release of releases) {
        if (release.prerelease) continue;
        const base = cleanVersion(release.version);
        if (!isNewerVersion(base, local)) continue;
        if (!best || isNewerVersion(base, cleanVersion(best.version))) best = release;
    }
    return best;
}

// Refresh the cached result from the release feed. Fails silently: an offline
// device or an unreachable update host must not surface an error.
export async function checkForUpdate(currentVersion: string, board: string): Promise<void> {
    const local = cleanVersion(currentVersion);
    if (!local || local === "0.0") return; // dev build, skip
    if (!board) return;
    if (!shouldCheck()) return;
    writeTimestamp();

    try {
        const best = newestStable(await fetchReleases(board), currentVersion);
        if (best) {
            localStorage.setItem(LS_KEY_LATEST, cleanVersion(best.version));
        } else {
            localStorage.removeItem(LS_KEY_LATEST);
        }
    } catch {
        // fail silently — offline, blocked, or the update host is down
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
