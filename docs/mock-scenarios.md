# Mock scenarios

The frontend mock API supports scenario flags for testing robot states and failures without hardware. Scenarios are
selected with the `scenario` query parameter and can be combined with `|`.

Useful combinations:

- `ok` - robot idle, online, battery 85%
- `err|fa` - robot error, brush stuck, plus action faults
- `low|fl|fs` - low battery plus log faults and settings fault
- `man|llq` - manual clean plus low LIDAR quality

When writing URLs, encode `|` as `%7C` if your browser or shell does not preserve it literally.

## Local development

Start the Vite dev server:

```bash
cd frontend
npm run dev
```

Open the UI with a scenario:

```text
http://localhost:5173/?scenario=err%7Cfa
http://localhost:5173/?scenario=low%7Cfl%7Cfs#/settings
```

The selected scenario is stored in the `openneato_scenario` cookie so later SPA API calls keep using it. Switch back to
the normal state with:

```text
http://localhost:5173/?scenario=ok
```

## Demo site

The Cloudflare demo uses the same mock API and the same query parameter:

```text
https://openneato-demo.renjfk.com/?scenario=err%7Cfa
https://openneato-demo.renjfk.com/?scenario=man%7Cllq#/manual
```

The demo persists the selected scenario in the same `openneato_scenario` cookie. Firmware and history uploads are
blocked server-side in demo mode.

The local dev server also answers the update host's `/v1/...` routes with two fake releases, a 64 KB firmware image,
and a placeholder token, so the release list and the signed install flow can be exercised without a device or network
access. The demo build lists real releases from the deployed update host without offering an install.

## Scenario keys

Robot state:

- `ok` - idle, online, battery 85%
- `off` - device unreachable
- `ident` - identifying robot during boot
- `unsup` - unsupported robot model
- `upd` - firmware v0.9, triggers update banner
- `cls` - house cleaning
- `spt` - spot cleaning
- `dock` - docking, return to base
- `rchg` - mid-clean recharge, on dock and charging
- `chg` - charging, 62%
- `ch2` - charging, 25%
- `ful` - full, on dock
- `mid` - battery 45%
- `low` - battery 12%
- `ded` - battery 0%
- `err` - brush stuck error
- `alrt` - alert only, brush change

Manual clean, combinable with each other or fault scenarios:

- `man` - manual mode active, no safety issues
- `mlf` - manual mode active, robot lifted
- `mbf` - manual mode active, front-left bumper contact
- `mbs` - manual mode active, side-right bumper contact
- `msf` - manual mode active, forward stall, reverse to clear
- `msr` - manual mode active, rear stall, move forward to clear

LIDAR quality, combinable with any state:

- `llq` - low scan quality, fewer than 90 valid points
- `lsl` - slow LDS rotation, 2.8 Hz
- `lno` - LIDAR unavailable, `GET /api/lidar` returns an error

Fault injection, combinable with any state:

- `fa` - action faults, clean house, spot, stop, and return operations fail
- `fs` - settings fault, NVS write error
- `flr` - log read fault, list and content fail
- `fld` - log delete fault, delete single and delete all fail
- `fl` - log reads and deletes fail
- `fps` - `/api/state` polling fails
- `fpc` - `/api/charger` polling fails
- `fpe` - `/api/error` polling fails
- `fp` - all polling endpoints fail, state, charger, and error
- `fhc` - history corruption, injects corrupted pose lines in session data
- `fhl` - history list corruption, malformed JSON in `/api/history` response, triggers recovery panel
- `fal` - all major faults combined

WiFi:

- `wap` - fallback AP active, STA disconnected and fallback enabled
- `wnc` - no saved credentials, first boot path, AP always on
- `wfo` - fallback AP setting off, combine with `wap` to test off plus disconnected
- `fws` - scan fault, `/api/wifi/scan` returns 500
- `fwn` - empty scan, `/api/wifi/scan` returns no networks
- `fwc` - connect fault, `/api/wifi/connect` rejects with auth error

## Examples

- `err|fa` - robot error plus action failures
- `low|fl|fs` - low battery, log failures, and settings failure
- `man|llq` - manual mode with degraded LIDAR
- `wap|wfo` - disconnected station with fallback AP setting disabled
- `upd|fhl` - update banner plus corrupted history list recovery state
