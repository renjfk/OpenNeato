# Changelog

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
