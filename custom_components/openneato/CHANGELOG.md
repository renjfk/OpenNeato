# Changelog

## 1.5

### Added
- **Cleaning replay camera** (`camera.openneato_*_motion_map`, translated as
  "Cleaning replay") — standard HA camera entity serving an animated GIF
  time-lapse of the most recent completed cleaning session. Plays once,
  then holds on the fully-drawn map so dashboards settle on a static
  final image. Works with picture-entity, vacuum-card, and other camera
  consumers. Regenerated only when a newer completed session lands.
  Coverage cells are revealed progressively in sync with path drawing.

### Fixed
- **`/api/history` robustness** — a single heatshrink-corrupted session
  file no longer breaks the HA coordinator. Previously, merged JSONL
  lines (a rare decompression artifact) produced invalid JSON in the
  listing response, causing the entire history fetch to fail and
  leaving the LIDAR camera blank and `last_clean_*` sensors as
  "unknown". Firmware now validates session/summary metadata structure
  before embedding; corrupt metadata is reported as `null`.
- **"Last clean" sensors** — now pick the most recent session by
  `summary.time` instead of relying on SPIFFS directory iteration
  order, which isn't deterministic. Fixes cases where a stale session
  was shown as the latest.

### Security
- Session filenames from the ESP32 listing are now validated against
  `\d+\.jsonl(\.hs)?` before being interpolated into the download URL,
  and response bodies are capped at 2 MB. Prevents a compromised or
  misbehaving peer on LAN from redirecting history requests to
  unrelated endpoints or OOM'ing HA Core with an unbounded stream.

### Previous 1.5-track changes (from 2c0adbc)
- Navigation mode select (Normal/Gentle/Deep/Quick)
- Remote syslog switch + syslog server IP text entity
- Wall follower switch migrated to standard `SetUserSettings WallEnable`
- Manifest bumped 1.3.1 → 1.5

## 1.3.1

### Fixed
- **Coordinator resilience** — a single hung endpoint (e.g. `/api/error`
  when the robot's serial interface gets stuck on the `GetErr` command)
  no longer puts the integration into "requires attention" state. The
  coordinator now only fails when ALL critical endpoints (state, charger,
  system) time out. Non-critical endpoints fall back to their last-known
  value so the integration keeps working during transient hangs.

## 1.3.0

### Added
- **LIDAR map camera entity** — standard HA camera entity (`camera.openneato_*_lidar_map`)
  compatible with vacuum-card, picture-entity, and picture-glance cards.
  Renders the robot's 360-degree LDS scan as a 480x480 dark-theme PNG with
  wall segments, grid rings, and robot indicator. Algorithm ported from the
  standalone frontend's lidar-map.tsx (segment detection, gap bridging,
  distance smoothing, multi-scan accumulation)
- **Cleaning session history map** — when the robot is docked/idle, the camera
  automatically shows the most recent completed cleaning session map with
  coverage grid (green), path line (gold), start/end markers, and recharge
  bolt icons. Ported from the frontend's history view rendering
- **Adaptive map_source attribute** — entity exposes `map_source` ("lidar",
  "history", or "idle") plus mode-specific diagnostics (rotation_speed,
  scan_quality for LIDAR; session_mode, session_duration, session_area for
  history maps)
- **Self-managed LIDAR polling** — camera fetches `/api/lidar` independently
  at 2-second intervals only when the robot is actively cleaning. Stops
  polling when idle to avoid wasting ESP32 serial bandwidth. Zero additional
  load on the coordinator's 5-second cycle
- **Session JSONL download** — `get_history_session()` API method to fetch
  raw JSONL pose data from `/api/history/<file>` with heatshrink corruption
  recovery

### Changed
- **No firmware changes required** — uses existing `/api/lidar` and
  `/api/history/<file>` endpoints. No flash needed to upgrade from 1.2.0

### Note on camera.py removal in 1.2.0
The previous camera entity (removed in 1.2.0) rendered only cleaning paths
and pulled Pillow as a declared dependency (~20MB). This new implementation
takes a fundamentally different approach: Pillow is already a core HA
dependency (no manifest entry needed), rendering is split into standalone
modules that run in the executor, and LIDAR polling is self-managed rather
than added to the coordinator. The architecture was evaluated by a
cross-functional review covering ESP32 performance constraints, HA camera
platform conventions, vacuum-card compatibility, and UX considerations.

## 1.2.0

### Added
- **Last clean stats sensors** — 6 new sensors from cleaning history session summaries:
  - Last clean duration, area covered, distance traveled
  - Last clean battery used, cleaning mode, end timestamp
- **Entity translations** — complete `strings.json` with translations for all 35 entities
  across sensor, binary_sensor, switch, button, and number platforms

### Changed
- **Single coordinator** — merged dual fast/slow coordinators into one polling all
  endpoints at 5s. The firmware's AsyncCache handles per-endpoint TTL deduplication
  (charger 30s, user_settings 5min), so cache hits return instantly without serial bus access
- **Modernized API client** — replaced deprecated `async_timeout` with `asyncio.timeout`
- **Format filesystem button** — moved to diagnostic category and disabled by default
  to prevent accidental data loss
- **Sensor metadata** — added `state_class` to heap and storage sensors for long-term
  statistics support

### Removed
- **camera.py** — removed Pillow-based map rendering (~20MB dependency). Map rendering
  belongs in the frontend layer as a Lovelace card (tracked in #37)
- **translations/en.json** — duplicate of strings.json; HA auto-generates translations
  for custom components
- **brand/ directory** — not loaded by HA for custom integrations (only for core
  integrations in the home-assistant/brands repo)
- **Pillow dependency** — `requirements` is now empty

### Fixed
- **Translation keys** — 29 translation keys were declared in entity code but never
  defined in strings.json (dead code). All now properly defined

## 1.1.3

- Custom ntfy server hostname and access token support
- HTTPS with Bearer auth for self-hosted ntfy servers

## 1.1.2

- Revert to standard shared aiohttp session with comprehensive logging

## 1.1.1

- Use dedicated aiohttp session to bypass system proxy
- Increase API timeout to 30s for busy ESP32 serial queue

## 1.1.0

- Address PR review: fix connection handling, response leaks, and compat
- Add local brand images for HA 2026.3+ brands proxy API

## 1.0.2

- Bump version

## 1.0.1

- Fix vacuum state mapping and use project icon

## 1.0.0

- Initial Home Assistant custom integration for OpenNeato
