// OpenNeato update host.
//
// Two very different clients hit this Worker:
//
//   * firmware, over plain HTTP, asking "is there a newer stable release for my
//     board?" and then downloading it. It cannot do TLS, so it trusts nothing
//     about the transport: every release carries a signed token that the device
//     verifies against a public key compiled into it.
//   * the web UI, running in a browser, listing releases (stable and
//     prereleases) and downloading a chosen image to POST to the device.
//     Cross-origin access is required because the UI is served by the device on
//     its own LAN address.
//
// The Worker is therefore a cache and a CORS mirror, not a trust anchor. It
// never signs anything and holds no keys.

const GITHUB_API = "https://api.github.com";
const RELEASES_TTL_SECONDS = 300;
// Large enough that a burst of prereleases cannot push the newest stable
// release out of the window the device feed reads.
const MAX_RELEASES = 100;
const MAX_LISTED = 10;

const BOARD_PATTERN = /^[a-z0-9-]{1,40}$/;
// v0.16, v0.16-pr220.10c2046, v0.16-signed-updates.abc1234,
// v0.16-fix_Things.abc1234 (branch names keep case and underscores)
const TAG_PATTERN = /^v\d+\.\d+(-[a-z0-9._-]+)?$/i;
const FIRMWARE_ASSET = /^openneato-([a-z0-9-]+)-firmware\.bin$/;
const TOKEN_ASSET = /^(openneato-[a-z0-9-]+-firmware\.bin)\.token$/;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, ETag",
};

// -- Version helpers ----------------------------------------------------------

// Split "0.15" / "0.15-pr220.abc1234" into comparable parts.
function parseVersion(value) {
    const [base, ...rest] = String(value ?? "").replace(/^v/, "").split("-");
    const numeric = base.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { numeric, prerelease: rest.length > 0 ? rest.join("-") : "" };
}

// Returns >0 when a is newer than b, <0 when older, 0 when identical.
export function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    for (let index = 0; index < 2; index++) {
        const diff = (left.numeric[index] ?? 0) - (right.numeric[index] ?? 0);
        if (diff !== 0) return diff;
    }
    if (left.prerelease === right.prerelease) return 0;
    if (!left.prerelease) return 1; // stable beats its own prereleases
    if (!right.prerelease) return -1;
    return left.prerelease > right.prerelease ? 1 : -1;
}

// -- GitHub releases ----------------------------------------------------------

// Edge cache, absent in the Node test runner.
function edgeCache() {
    return globalThis.caches?.default ?? null;
}

function jsonError(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
}

async function githubFetch(env, path, accept = "application/vnd.github+json") {
    const headers = { Accept: accept, "User-Agent": "openneato-update-worker" };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const response = await fetch(`${GITHUB_API}${path}`, { headers });
    if (!response.ok) {
        throw new Error(`github ${path} -> ${response.status}`);
    }
    return response;
}

// Index a release into the shape the handlers need: per-board firmware and
// token assets. Releases without a complete pair are unusable for that board.
function indexRelease(release, repo) {
    const boards = {};
    for (const asset of release.assets ?? []) {
        const firmware = FIRMWARE_ASSET.exec(asset.name);
        const token = firmware ? null : TOKEN_ASSET.exec(asset.name);
        const board = firmware?.[1] ?? (token ? FIRMWARE_ASSET.exec(token[1])?.[1] : undefined);
        if (!board) continue;
        const entry = boards[board] ?? {};
        if (firmware) entry.firmware = asset;
        else entry.token = asset;
        boards[board] = entry;
    }
    for (const board of Object.keys(boards)) {
        if (!boards[board].firmware || !boards[board].token) delete boards[board];
    }
    return {
        tag: release.tag_name,
        version: String(release.tag_name ?? "").replace(/^v/, ""),
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at,
        boards,
        repo,
    };
}

async function listReleases(env, request) {
    const cache = edgeCache();
    const cacheKey = new Request(`${new URL(request.url).origin}/__releases`, { method: "GET" });
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) return cached.json();

    const repo = env.REPO ?? "renjfk/OpenNeato";
    const response = await githubFetch(env, `/repos/${repo}/releases?per_page=${MAX_RELEASES}`);
    const releases = (await response.json())
        .filter((release) => !release.draft)
        .map((release) => indexRelease(release, repo));

    const body = JSON.stringify(releases);
    if (cache) {
        await cache.put(
            cacheKey,
            new Response(body, {
                headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${RELEASES_TTL_SECONDS}` },
            }),
        );
    }
    return JSON.parse(body);
}

function boardReleases(releases, board) {
    return releases.filter((release) => Boolean(release.boards[board]));
}

// -- Handlers -----------------------------------------------------------------

// Device feed: "is there a newer stable release for my board?"
async function handleLatest(url, env) {
    const board = url.searchParams.get("board") ?? "";
    const current = url.searchParams.get("version") ?? "0.0";
    if (!BOARD_PATTERN.test(board)) return jsonError("invalid board");

    const releases = boardReleases(await listReleases(env, new Request(url.toString())), board);
    const stable = releases.filter((release) => !release.prerelease);
    const latest = stable.find((release) => compareVersions(release.version, current) > 0);
    if (!latest) {
        return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Cache-Control": "max-age=60" } });
    }

    const assets = latest.boards[board];
    const tokenResponse = await fetch(assets.token.browser_download_url, { redirect: "follow" });
    if (!tokenResponse.ok) return jsonError("token unavailable", 502);
    const token = (await tokenResponse.text()).trim();

    const origin = url.origin;
    const body = [latest.version, `${origin}/v1/firmware/${latest.tag}/${board}`, token].join("\n") + "\n";
    return new Response(body, {
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "max-age=60" },
    });
}

// Browser listing: stable releases and prereleases that fit this board.
async function handleReleases(url, env) {
    const board = url.searchParams.get("board") ?? "";
    if (!BOARD_PATTERN.test(board)) return jsonError("invalid board");

    const releases = boardReleases(await listReleases(env, new Request(url.toString())), board);
    const listed = releases.slice(0, MAX_LISTED).map((release) => ({
        version: release.version,
        tag: release.tag,
        prerelease: release.prerelease,
        publishedAt: release.publishedAt,
        size: release.boards[board].firmware.size,
        url: `${url.origin}/v1/firmware/${release.tag}/${board}`,
        tokenUrl: `${url.origin}/v1/token/${release.tag}/${board}`,
    }));

    return new Response(JSON.stringify(listed), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "max-age=60" },
    });
}

// Firmware bytes and token text. Only assets that belong to a published release
// of this project are served, so the Worker cannot be used as an open proxy.
async function handleAsset(request, url, env, kind) {
    const [, , , tag, board] = url.pathname.split("/");
    if (!TAG_PATTERN.test(tag ?? "")) return jsonError("invalid tag");
    if (!BOARD_PATTERN.test(board ?? "")) return jsonError("invalid board");

    const cache = edgeCache();
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) return cached;

    const releases = (await listReleases(env, request)).filter((release) => release.tag === tag);
    if (!releases.length) return jsonError("release not found", 404);
    const assets = releases[0].boards[board];
    if (!assets) return jsonError("no image for this board in that release", 404);

    const asset = kind === "token" ? assets.token : assets.firmware;
    const response = await fetch(asset.browser_download_url, { redirect: "follow" });
    if (!response.ok) return jsonError("asset unavailable", 502);

    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
    headers.set("Content-Type", kind === "token" ? "text/plain; charset=utf-8" : "application/octet-stream");
    // Release assets are immutable: a tag never changes its bytes.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.delete("Content-Disposition");
    headers.delete("Content-Encoding");

    const body = await response.arrayBuffer();
    const proxied = new Response(body, { status: 200, headers });
    if (cache) await cache.put(cacheKey, proxied.clone());
    return proxied;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonError("method not allowed", 405);
        }

        try {
            switch (url.pathname) {
                case "/v1/latest":
                    return await handleLatest(url, env);
                case "/v1/releases":
                    return await handleReleases(url, env);
                case "/":
                    return new Response(
                        "OpenNeato update host\n\n" +
                            "GET /v1/latest?board=<board>&version=<version>  device feed\n" +
                            "GET /v1/releases?board=<board>                  release list\n" +
                            "GET /v1/firmware/<tag>/<board>                  firmware image\n" +
                            "GET /v1/token/<tag>/<board>                     signed update token\n",
                        { headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" } },
                    );
                default:
                    if (url.pathname.startsWith("/v1/firmware/")) return await handleAsset(request, url, env, "firmware");
                    if (url.pathname.startsWith("/v1/token/")) return await handleAsset(request, url, env, "token");
                    return jsonError("not found", 404);
            }
        } catch (error) {
            return jsonError(`update host error: ${error.message}`, 502);
        }
    },
};
