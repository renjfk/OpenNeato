# AGENTS.md — OpenNeato

Guidelines for AI agents working in this repository. Keep this file concise —
only document constraints and rules an agent would get wrong without being told.
Implementation details belong in code comments, not here.

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

### Filesystem and Flash Wear

LittleFS (not SPIFFS). Buffer writes in RAM, never write to flash in a loop.
NVS writes are user-triggered only (settings save, WiFi provisioning).

## Build Commands

### Firmware

```bash
pio run -e c3-debug                        # Build
pio run -e c3-debug -t upload              # Upload via USB
pio run -e c3-debug -t upload -t monitor   # Upload + serial monitor
pio run -e c3-release                      # Release build (no serial logging)
python scripts/check_format.py             # clang-format check (--fix to auto-fix)
pio check -e c3-debug                      # Static analysis (clang-tidy)
```

Verify firmware changes: `pio run -e c3-debug` + `python scripts/check_format.py` +
`pio check -e c3-debug` with zero defects.

Verify frontend changes: `npm run check` + `npm run build` in `frontend/`.

Verify flash tool changes: `golangci-lint run ./...` + `go build` in `flash/`.

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
