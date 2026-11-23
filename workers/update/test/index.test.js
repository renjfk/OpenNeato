import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker, { compareVersions } from "../src/index.js";

const ORIGIN = "https://openneato-update.renjfk.com";

function release(tag, { prerelease = false, boards = ["esp32-c3"] } = {}) {
    const assets = [];
    for (const board of boards) {
        assets.push({ name: `openneato-${board}-firmware.bin`, size: 1234, browser_download_url: `https://github.com/dl/${tag}/${board}/bin` });
        assets.push({ name: `openneato-${board}-firmware.bin.token`, size: 250, browser_download_url: `https://github.com/dl/${tag}/${board}/token` });
    }
    return { tag_name: tag, prerelease, draft: false, published_at: "2026-11-01T00:00:00Z", assets };
}

const RELEASES = [
    release("v0.17-pr220.10c2046", { prerelease: true }),
    release("v0.16"),
    release("v0.16", { boards: ["seeed-xiao-esp32c3"] }), // overwritten below
    release("v0.15"),
    { tag_name: "v0.18", draft: true, prerelease: false, assets: [] },
];
// Give v0.16 a XIAO asset too, and v0.15 none for the XIAO.
RELEASES[1] = release("v0.16", { boards: ["esp32-c3", "seeed-xiao-esp32c3"] });

const TOKEN = "v1|esp32-c3|0.16|1234|abc|def";

function stubFetch() {
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).includes("api.github.com")) {
            return new Response(JSON.stringify(RELEASES.filter((r) => !r.draft)), { status: 200 });
        }
        if (String(url).endsWith("/token")) {
            return new Response(TOKEN, { status: 200 });
        }
        return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
        });
    };
    return calls;
}

function get(path) {
    return worker.fetch(new Request(`${ORIGIN}${path}`), { REPO: "renjfk/OpenNeato" });
}

afterEach(() => {
    delete globalThis.fetch;
});

test("compareVersions ranks stable above its prereleases", () => {
    assert.ok(compareVersions("0.16", "0.15") > 0);
    assert.ok(compareVersions("0.16", "0.16-pr220.10c2046") > 0);
    assert.ok(compareVersions("0.16-pr220.10c2046", "0.16-pr219.abcdef0") > 0);
    assert.equal(compareVersions("v0.16", "0.16"), 0);
});

test("latest returns nothing when the device is current", async () => {
    stubFetch();
    const response = await get("/v1/latest?board=esp32-c3&version=0.16");
    assert.equal(response.status, 204);
});

test("latest skips prereleases for the device feed", async () => {
    stubFetch();
    const response = await get("/v1/latest?board=esp32-c3&version=0.15");
    assert.equal(response.status, 200);
    const [version, url, token] = (await response.text()).trim().split("\n");
    assert.equal(version, "0.16");
    assert.equal(url, `${ORIGIN}/v1/firmware/v0.16/esp32-c3`);
    assert.equal(token, TOKEN);
});

test("latest works for boards that share a chip", async () => {
    stubFetch();
    const response = await get("/v1/latest?board=seeed-xiao-esp32c3&version=0.15");
    assert.equal(response.status, 200);
});

test("latest rejects unknown boards", async () => {
    stubFetch();
    const response = await get("/v1/latest?board=../../etc&version=0.15");
    assert.equal(response.status, 400);
});

test("releases lists stable and prerelease builds for the board", async () => {
    stubFetch();
    const response = await get("/v1/releases?board=esp32-c3");
    const body = await response.json();
    assert.deepEqual(
        body.map((entry) => entry.version),
        ["0.17-pr220.10c2046", "0.16", "0.15"],
    );
    assert.equal(body[0].prerelease, true);
    assert.equal(body[1].url, `${ORIGIN}/v1/firmware/v0.16/esp32-c3`);
    assert.equal(body[1].tokenUrl, `${ORIGIN}/v1/token/v0.16/esp32-c3`);
});

test("firmware is proxied with CORS headers", async () => {
    stubFetch();
    const response = await get("/v1/firmware/v0.16/esp32-c3");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
    assert.equal((await response.arrayBuffer()).byteLength, 4);
});

test("token is served as text", async () => {
    stubFetch();
    const response = await get("/v1/token/v0.16/esp32-c3");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), TOKEN);
});

test("branch prerelease tags are accepted", async () => {
    stubFetch();
    const response = await worker.fetch(
        new Request(`${ORIGIN}/v1/firmware/v0.17-signed-updates.abc1234/esp32-c3`),
        { REPO: "renjfk/OpenNeato" },
    );
    // Not in the fixture releases, so it must reach the lookup and 404 rather
    // than be rejected as a malformed tag.
    assert.equal(response.status, 404);
});

test("mixed-case tags from branch names are accepted", async () => {
    stubFetch();
    const response = await worker.fetch(
        new Request(`${ORIGIN}/v1/firmware/v0.17-fix_Things.abc1234/esp32-c3`),
        { REPO: "renjfk/OpenNeato" },
    );
    assert.equal(response.status, 404);
});

test("assets outside a known release are refused", async () => {
    stubFetch();
    const response = await get("/v1/firmware/v9.9/esp32-c3");
    assert.equal(response.status, 404);
    const badTag = await get("/v1/firmware/latest/esp32-c3");
    assert.equal(badTag.status, 400);
});

test("unknown paths return 404 and OPTIONS answers preflight", async () => {
    stubFetch();
    assert.equal((await get("/elsewhere")).status, 404);
    const preflight = await worker.fetch(new Request(`${ORIGIN}/v1/releases`, { method: "OPTIONS" }), {});
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
});
