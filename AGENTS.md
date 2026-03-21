# AGENTS.md — OpenNeato

Guidelines for AI agents working in this repository.

## Project Overview

**OpenNeato** is an open-source replacement for Neato's discontinued cloud and
mobile app. An ESP32-C3 bridge communicates with Botvac robots (D3-D7) over UART
and exposes a local web UI over WiFi — no cloud, no app, no account required.

**Standalone system** — no Home Assistant, no cloud, no external dependencies.

Robot serial protocol reference (commands, response formats, error codes, state
machines) is in [`docs/neato-serial-protocol.md`](docs/neato-serial-protocol.md).

## Architecture

Three top-level components: `firmware/` (ESP32 C/C++), `frontend/` (Preact SPA),
`flash/` (Go CLI). `platformio.ini` at root.

- Firmware: non-blocking `loop()`, managers wired via dependency injection in `main.cpp`
- Frontend: hash-based routing, polling hooks, dark/light theme, mobile-first, embedded in firmware via PROGMEM
- Flash tool: Go CLI, cross-compiled via GoReleaser, uses esptool subprocess
- Mock server: `frontend/mock/server.js` Vite plugin, `SCENARIO` constant for state switching. Reset to `"ok"` before
  committing.
- Build pipeline: `npm run build` -> lint -> tsc -> vite -> `embed_frontend.js` generates `web_assets.h`

### Data Logging

All significant events must be logged via `DataLogger` (injected by reference).
`logEvent` is private — use typed public helpers (`logRequest`, `logWifi`, `logOta`,
`logNtp`, `logGenericEvent`, `logNotification`). When adding a new manager that
needs logging, add a new typed helper following the existing pattern. Log both
success and failure outcomes.

`event` type entries use `category` as the frontend discriminator with prefixes:
`scheduler_*`, `history_*`, `notif_*`.

### Filesystem and Flash Wear

LittleFS (not SPIFFS) — mounted via `LittleFS.begin(true, "/littlefs", 10, "spiffs")`
using the `"spiffs"` partition label for OTA compatibility (no partition table change
needed). Directories `/log` and `/history` are created after mount.

Flash wear mitigation:
- **DataLogger** buffers log lines in RAM, flushes every 30s or 128 lines. Cache-hit
  serial commands are not logged (only real UART fetches).
- **CleaningHistory** buffers pose snapshots in RAM via `bufferLine()`, flushes every
  30s or on session end. Session headers/summaries use immediate `writeLine()`.
- **Debug mode** auto-expires after 10 minutes (`DEBUG_AUTO_OFF_MS`) to prevent
  forgotten verbose logging from inflating log files with raw serial responses.
- **NVS** writes are user-triggered only (settings save, WiFi provisioning) — no
  periodic or loop-driven NVS writes.

## Build Commands

### Firmware

```bash
pio run -e c3-debug                        # Build
pio run -e c3-debug -t upload              # Upload via USB
pio run -e c3-debug -t upload -t monitor   # Upload + serial monitor
pio run -e c3-release                      # Release build (no serial logging)
pio check -e c3-debug                      # Static analysis (clang-tidy)
```

Verify firmware changes: `pio run -e c3-debug` + `pio check -e c3-debug` with zero defects.

### Frontend

```bash
cd frontend
npm run dev          # Vite dev server with mock API
npm run build        # Lint + type check + build + embed into firmware header
npm run check        # Biome lint/format check
npm run fix          # Auto-fix safe issues
```

### Flash tool

```bash
cd flash
go build -o openneato-flash .    # Build
golangci-lint run ./...          # Lint
```

## Zero-Dependency Policy

The ESP32-C3 has 320KB RAM and 1600KB per OTA slot — every kilobyte counts.

**Firmware:** No external libraries beyond what's in `platformio.ini`. No JSON
libraries (use `json_fields.h/cpp`), no HTTP client/MQTT/WebSocket.

**Frontend:** No npm runtime dependencies beyond Preact. No state management,
CSS frameworks, routing, or HTTP wrapper libraries.

## Code Style

### Firmware

- `snake_case` files, PascalCase classes, camelCase methods, UPPER_SNAKE macros
- 4-space indent, K&R braces, 120-col (`.clang-format`)
- Arduino `String`, `//` comments only, `#ifndef` guards
- No exceptions — return-value error handling, early returns

### Frontend

- 4-space indent, double quotes, semicolons, 120-col (Biome)
- Named `interface`/`type` only, never inline object type literals

## Hardware

- **Board**: ESP32-C3-DevKitM-1 (RISC-V, 160MHz, 320KB RAM, 4MB flash)
- **Flash layout**: Dual OTA slots (1600KB each), 768KB LittleFS, 20KB NVS
- **NVS**: Single `"neato"` namespace, opened once, passed by reference
- **Reset**: GPIO9, hold 5s for factory reset

## Planned / In-Progress

**GitHub Actions — Release workflow** — Triggered on version tags. Steps:
build frontend (`npm run build`), build firmware (`pio run -e c3-release`),
GoReleaser runs `prepare_flash_embed.sh` via `before.hooks`, builds flash
tool for all platforms, and creates GitHub release with firmware packs
attached as extra files.

**GitHub Actions — PR CI workflow** — Triggered on pull requests. Steps:
firmware build + `pio check` (clang-tidy), frontend lint + type check + build,
Go lint (`golangci-lint`) + build for flash tool.

**Project README** — Write `README.md` with project description, screenshots,
feature list, quick start guide, and links to installation docs and releases.

**Installation guide** — Write `docs/installation.md` covering required materials
(ESP32-C3 board, jumper wires, debug port pinout), hardware assembly with photos,
flashing with the flash tool, and first-time WiFi configuration walkthrough.

**Clean up "spiffs" partition label** — Once the device is physically re-flashed
(not OTA), change partition subtype from `spiffs` to `littlefs` in
`firmware/partition.csv` and simplify the mount call from
`LittleFS.begin(true, "/littlefs", 10, "spiffs")` to `LittleFS.begin(true)`.
The `"spiffs"` label is only kept for OTA compatibility with the old partition
table — a full flash makes it unnecessary.

**Mid-clean recharge continuity** — Verify the firmware correctly handles the
autonomous mid-clean recharge cycle (robot docks to charge, then resumes cleaning).
The cleaning history session must stay open during recharge so map collection
continues seamlessly. The notification manager should detect this as a recharge
pause (not cleaning completion) via the `ST_M1_Charging_Cleaning` robot state.
Needs live testing with a partially-charged battery to trigger the recharge cycle.
