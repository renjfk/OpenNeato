# Update host Worker

Serves the firmware release feed for OpenNeato. It exists for two clients that
cannot use GitHub directly:

- the **device**, which has no TLS stack and asks over plain HTTP whether a
  newer stable release exists, then downloads it;
- the **web UI**, served from the device's LAN address, which needs CORS to list
  releases and mirror an image into the browser before POSTing it to the device.

The Worker is a cache and a CORS mirror. It holds no keys and signs nothing.
Trust comes from the signed token each release carries, verified on the device
(see [`docs/firmware-signing.md`](../../docs/firmware-signing.md)).

## Endpoints

| Route | Used by | Returns |
|---|---|---|
| `GET /v1/latest?board=<board>&version=<version>` | device | `204` when current, else three lines: `version`, firmware URL, token |
| `GET /v1/releases?board=<board>` | web UI | JSON list of up to 10 releases (stable and prereleases) with URLs |
| `GET /v1/firmware/<tag>/<board>` | both | Firmware bytes, CORS enabled, cached immutably per tag |
| `GET /v1/token/<tag>/<board>` | web UI | Token text, CORS enabled |
| `GET /` | humans | Usage text |

Only assets from published releases of `renjfk/OpenNeato` that match
`openneato-<board>-firmware.bin` (plus its `.token`) are served, so the Worker
cannot be used as an open proxy.

## Deploy

```bash
cd workers/update
npm install
npm test          # node --test, no credentials needed
npx wrangler deploy
```

Set the custom domain `openneato-update.renjfk.com` or adjust the route in
[`wrangler.toml`](wrangler.toml). Two Cloudflare settings matter:

- **Always Use HTTPS must be off for this hostname.** The device speaks plain
  HTTP and will not follow a redirect. Add a Configuration Rule matching
  `http.host eq "openneato-update.renjfk.com"` with "Always Use HTTPS" disabled.
  The rest of the zone keeps its redirect.
- **Optional GitHub token.** Without one, listing releases uses GitHub's
  unauthenticated API limit (60 requests/hour per egress IP, shared across
  Cloudflare). Results are cached for 5 minutes, which is usually enough; add a
  read-only token for headroom:

```bash
npx wrangler secret put GITHUB_TOKEN
```

## Local development

```bash
npx wrangler dev
curl "http://localhost:8787/v1/latest?board=esp32-c3&version=0.15"
```

The firmware's update host is set by `OTA_UPDATE_HOST` in
[`firmware/src/config.h`](../../firmware/src/config.h).

## Tests

`npm test` runs the handler against a stubbed GitHub API and covers version
ordering, stable-vs-prerelease filtering, per-board asset selection, CORS
headers, and refusal of tags/assets the Worker does not own.
