# Signed firmware updates

OpenNeato installs firmware from the web UI, and optionally without anyone
watching. The ESP32-C3 build has no TLS stack: adding one costs about 140 KB of
flash (the OTA slot has roughly 220 KB free) and around 40 KB of heap per
handshake. Updates are therefore fetched over plain HTTP, and the trust comes
from a **signed update token** that the device verifies against a public key
compiled into the firmware.

- HTTPS, if it ever exists, would only protect the transport.
- The token proves the image came from this project, whatever the transport.

## What the device enforces

Before a single byte reaches the inactive OTA slot:

| Check | Rejects |
|---|---|
| Token signature (ECDSA P-256) | Any image not signed by a release key |
| Token format version | Future or malformed token shapes |
| Board id | A C3 image on a XIAO build, and vice versa |
| Version | Downgrades, and reinstalling the exact same build |
| Declared size | Images outside the OTA slot bounds |

Before the image is committed (`Update.end()`):

| Check | Rejects |
|---|---|
| SHA-256 of the received stream | Any bit changed in transit |
| Byte count | Truncated or padded downloads |

The MD5 check used by manual uploads still applies when no token is supplied.

## Token format

One line of text, published next to each firmware binary as
`<binary>.token`:

```
v1|<board>|<version>|<size>|<sha256>|<signature>
```

| Field | Example | Notes |
|---|---|---|
| `v1` | `v1` | Format version |
| `board` | `esp32-c3` | Release board id (`BOARD_ID`, derived from the artifact name) |
| `version` | `0.16` | Version compiled into the image (`FIRMWARE_VERSION`) |
| `size` | `1427744` | Exact image size in bytes |
| `sha256` | 64 hex chars | SHA-256 of the image |
| `signature` | 128 hex chars | ECDSA P-256 over `v1\|board\|version\|size\|sha256`, raw `r\|\|s` |

Signatures are produced by `scripts/ota_sign.py` (OpenSSL) and verified on the
device with mbedTLS. The public keys live in
[`firmware/src/ota_public_keys.h`](../firmware/src/ota_public_keys.h) as
uncompressed SEC1 points.

## Keys

The repository contains a **development key** in
`firmware/src/ota_public_keys.h`, marked `OTA_KEYS_ARE_RELEASE 0`. It exists so
local builds can exercise token verification, but such builds do not advertise
signed updates: Settings shows only a "This build was not produced by the
release pipeline" note instead of the release list, and automatic updates stay
off. Release builds regenerate the header from the `OTA_SIGNING_KEY` secret with
`--release`, which sets the marker to 1.

Set the secret once:

```bash
./scripts/ota_keygen.py --out-key ./ota-signing-key.pem
gh secret set OTA_SIGNING_KEY --repo renjfk/OpenNeato < ./ota-signing-key.pem
```

Keep `ota-signing-key.pem` offline (password manager or hardware token), never
in the repository. The printed public key must match the header the release
build generates; if it does not, the release firmware would reject every
update, so treat a mismatch as a build failure.

### Rotation

The header holds up to two keys (`OTA_PUBLIC_KEY_MAX`). The release workflows
generate it from the secret plus an optional extra key, so rotation is a
repository variable change, not a code change.

A device verifies release N with the keys compiled into release N-1, so the
release that introduces the new key must still be signed with the old one:

1. Generate a new key. Keep the **old** key in `OTA_SIGNING_KEY`, and put the
   **new** public key (65-byte hex) in the repository variable:
   `gh variable set OTA_ROTATION_PUBLIC_KEY --body 04ab...`.
2. Release N. It is signed with the old key and its header trusts both keys, so
   every device can install it.
3. Move the secret to the new key and delete the variable:
   `gh secret set OTA_SIGNING_KEY < new-key.pem` then
   `gh variable delete OTA_ROTATION_PUBLIC_KEY`.
4. Release N+1. Devices that installed release N carry the new key and verify
   it; devices still on older releases need one manual upload.

`./scripts/ota_keygen.py --rotate` does the same merge against a committed header
when rotating by hand.

## Release workflow

`release.yml` and `prerelease.yml` both use two dedicated jobs, each checked out
at a commit of the **default branch** recorded before any code from the ref under
test runs (prereleases build pull-request code), with a read-only token and no
stored credentials. The key is therefore never handled by code that a PR or
branch can change. `release.yml` also builds without the pip and PlatformIO
caches, because a prerelease run can write the same cache keys:

1. `signing-key` derives `ota_public_keys.h` from `OTA_SIGNING_KEY` (plus
   `OTA_ROTATION_PUBLIC_KEY` when set) and hands it to the firmware builds.
2. `sign-artifacts` signs every `openneato-<board>-firmware.bin`, writing
   `openneato-<board>-firmware.bin.token`, and verifies each token against the
   public key before the artifacts reach the publishing job.
3. The publishing job runs GoReleaser with the `.goreleaser.yml` from that
   pinned commit, not the one in the ref under test, and `release.yml` refuses a
   tag that is not already reachable from the default branch.
4. The signed tokens ship as release assets (GoReleaser `extra_files` and
   `checksums.txt`).

Prereleases are signed with the same key so testers can install them from the
UI. They are never installed automatically: the firmware skips any version with
a `-` suffix, and the update host's device feed only serves stable releases.

## Update host

The release feed is served by the Worker in [`workers/update`](../workers/update)
so that:

- the browser can download firmware cross-origin (GitHub release assets send no
  CORS headers),
- the device can ask over plain HTTP, which it needs,
- and the bytes come from Cloudflare's edge cache instead of GitHub for every
  install.

The Worker holds no keys. It only mirrors assets from this repository's
releases and passes tokens through unchanged.

Deployment notes are in [`workers/update/README.md`](../workers/update/README.md).
The one Cloudflare setting that matters: `openneato-update.renjfk.com` must not
redirect HTTP to HTTPS, because the device cannot follow it (Configuration Rule
with "Always Use HTTPS" off for that hostname).

## Manual uploads

`POST /api/firmware/update?hash=<md5>` without a token is unchanged: the device
verifies the MD5 of the body and flashes it. This keeps working for:

- custom builds and local experiments,
- installing an image offline from a file,
- recovering a device whose update check cannot reach anything.

Nothing in this design weakens that path. Note that anyone who can reach the
device on the LAN can already upload a firmware image to it, so tokens protect
the automatic path, not against a hostile local network.

## Testing without a release

```bash
# Sign a local build
FIRMWARE_VERSION=0.16 pio run -e c3-release
./scripts/ota_sign.py sign --key ./ota-signing-key.pem --version 0.16 \
  --bin .pio/build/c3-release/openneato-esp32-c3-firmware.bin

# Check a token against the public key
openssl pkey -in ./ota-signing-key.pem -pubout -out ./ota-signing-key.pub.pem
./scripts/ota_sign.py verify --pubkey ./ota-signing-key.pub.pem \
  --bin .pio/build/c3-release/openneato-esp32-c3-firmware.bin \
  --token .pio/build/c3-release/openneato-esp32-c3-firmware.bin.token
```

To test against hardware, POST the image with the token and watch the response:

```bash
curl -F "file=@openneato-esp32-c3-firmware.bin" \
  "http://<device-ip>/api/firmware/update?token=$(cat openneato-esp32-c3-firmware.bin.token)"
```

A rejection returns the reason in the JSON `error` field (`Update signature
invalid`, `Update is for <board>, this device is <board>`, `Update hash
mismatch`, ...). `/api/firmware/version` reports `signedUpdates: false` on builds
that were not produced by the release pipeline, including local builds with the
development key.
