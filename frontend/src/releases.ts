// Release feed client.
//
// Releases are listed by the update host (a Cloudflare Worker) rather than by
// the GitHub API: it answers with CORS enabled for the device's LAN origin,
// mirrors the firmware bytes for the browser, and does not need a token. The
// listing is only advisory: every install carries a signed token that the
// device verifies before it writes anything to flash.

export interface ReleaseInfo {
    version: string;
    tag: string;
    prerelease: boolean;
    publishedAt: string | null;
    size: number;
    url: string;
    tokenUrl: string;
}

declare const __UPDATE_API_BASE__: string;
declare const __DEMO_BUILD__: boolean;

// The demo Worker blocks firmware uploads, so it lists releases without
// offering an install.
export const releaseInstallEnabled = !__DEMO_BUILD__;

const API_BASE = typeof __UPDATE_API_BASE__ !== "undefined" ? __UPDATE_API_BASE__ : "";
const RELEASES_TTL_MS = 10 * 60 * 1000;

let cached: { board: string; fetchedAt: number; releases: ReleaseInfo[] } | null = null;

export async function fetchReleases(board: string, force = false): Promise<ReleaseInfo[]> {
    if (!board) return [];
    if (!force && cached && cached.board === board && Date.now() - cached.fetchedAt < RELEASES_TTL_MS) {
        return cached.releases;
    }

    const res = await fetch(`${API_BASE}/v1/releases?board=${encodeURIComponent(board)}`);
    if (!res.ok) throw new Error(`Release list unavailable (${res.status})`);

    const releases = (await res.json()) as ReleaseInfo[];
    cached = { board, fetchedAt: Date.now(), releases };
    return releases;
}

export function clearReleaseCache(): void {
    cached = null;
}

// Download a firmware image. Uses the reported size for progress because the
// compressed/edge-cached response does not always carry Content-Length.
export async function downloadFirmware(release: ReleaseInfo, onProgress: (pct: number) => void): Promise<Blob> {
    const res = await fetch(release.url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);

    const total = Number(res.headers.get("Content-Length") ?? release.size) || release.size;
    const reader = res.body?.getReader();
    if (!reader) return res.blob();

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)));
    }
    return new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
}

export async function fetchReleaseToken(release: ReleaseInfo): Promise<string> {
    const res = await fetch(release.tokenUrl);
    if (!res.ok) throw new Error(`Update token unavailable (${res.status})`);
    const token = (await res.text()).trim();
    if (!token) throw new Error("Update token is empty");
    return token;
}
