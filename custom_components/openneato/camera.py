"""Camera entity for the OpenNeato cleaning map."""

from __future__ import annotations

import io
import json
import logging
from typing import Any

from PIL import Image, ImageDraw

from homeassistant.components.camera import Camera
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import OpenNeatoApiClient
from .const import DOMAIN
from .entity import OpenNeatoEntity

_LOGGER = logging.getLogger(__name__)

MAP_SIZE = 480
MAP_PADDING = 20
BACKGROUND_COLOR = (30, 30, 30)
PATH_COLOR = (0, 160, 255)
START_COLOR = (0, 200, 0)
END_COLOR = (220, 40, 40)
DOT_RADIUS = 4


def _render_map(poses: list[tuple[float, float]]) -> bytes:
    """Render a list of (x, y) poses as a PNG image."""
    if not poses:
        img = Image.new("RGB", (MAP_SIZE, MAP_SIZE), BACKGROUND_COLOR)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    xs = [p[0] for p in poses]
    ys = [p[1] for p in poses]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    span_x = max_x - min_x
    span_y = max_y - min_y
    span = max(span_x, span_y, 1.0)

    drawable = MAP_SIZE - 2 * MAP_PADDING

    def to_pixel(x: float, y: float) -> tuple[int, int]:
        px = MAP_PADDING + int((x - min_x - (span_x - span) / 2) / span * drawable)
        py = MAP_PADDING + int((1 - (y - min_y - (span_y - span) / 2) / span) * drawable)
        return (px, py)

    img = Image.new("RGB", (MAP_SIZE, MAP_SIZE), BACKGROUND_COLOR)
    draw = ImageDraw.Draw(img)

    if len(poses) >= 2:
        pixel_points = [to_pixel(x, y) for x, y in poses]
        draw.line(pixel_points, fill=PATH_COLOR, width=2)

    sx, sy = to_pixel(poses[0][0], poses[0][1])
    draw.ellipse(
        [sx - DOT_RADIUS, sy - DOT_RADIUS, sx + DOT_RADIUS, sy + DOT_RADIUS],
        fill=START_COLOR,
    )

    ex, ey = to_pixel(poses[-1][0], poses[-1][1])
    draw.ellipse(
        [ex - DOT_RADIUS, ey - DOT_RADIUS, ex + DOT_RADIUS, ey + DOT_RADIUS],
        fill=END_COLOR,
    )

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _parse_poses_from_jsonl(text: str) -> list[tuple[float, float]]:
    """Extract (x, y) pose points from JSONL session data."""
    poses: list[tuple[float, float]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if "x" in obj and "y" in obj and "type" not in obj:
            poses.append((float(obj["x"]), float(obj["y"])))
    return poses


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato map camera from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            OpenNeatoMapCamera(
                coordinator=data["slow_coordinator"],
                api=data["api"],
                serial=data["serial"],
                model=data["model"],
                sw_version=data["sw_version"],
                fw_version=data["fw_version"],
                host=data["host"],
            )
        ]
    )


class OpenNeatoMapCamera(OpenNeatoEntity, Camera):
    """Camera entity that renders the cleaning map from history data."""

    _attr_name = "Cleaning map"
    _attr_frame_interval = 10.0

    def __init__(
        self,
        coordinator,
        api: OpenNeatoApiClient,
        serial: str,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the map camera."""
        OpenNeatoEntity.__init__(
            self, coordinator, serial,
            model=model, sw_version=sw_version, fw_version=fw_version, host=host,
        )
        Camera.__init__(self)
        self._api = api
        self._attr_unique_id = f"{serial}_map_camera"
        self._image_bytes: bytes | None = None
        self._last_session_name: str | None = None

    @property
    def is_on(self) -> bool:
        """Return True when map data is available."""
        return self._image_bytes is not None

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return the latest map image."""
        await self._async_update_map()
        return self._image_bytes

    def _handle_coordinator_update(self) -> None:
        """Schedule a map refresh when the slow coordinator updates."""
        self.hass.async_create_task(self._async_update_map())
        super()._handle_coordinator_update()

    async def _async_update_map(self) -> None:
        """Fetch the latest history session and re-render the map image."""
        try:
            sessions: list[dict[str, Any]] = await self._api.get_history()
        except Exception:
            _LOGGER.debug("Failed to fetch history list", exc_info=True)
            return

        if not sessions:
            return

        # Prefer an active recording session; otherwise use most recent
        target: dict[str, Any] | None = None
        for session in sessions:
            if session.get("recording"):
                target = session
                break
        if target is None:
            target = sessions[0]

        session_name: str = target.get("name", "")
        if not session_name:
            return

        # Skip re-fetch when session hasn't changed and isn't recording
        if (
            session_name == self._last_session_name
            and not target.get("recording")
            and self._image_bytes is not None
        ):
            return

        try:
            text = await self._fetch_session_data(session_name)
        except Exception:
            _LOGGER.debug("Failed to fetch session %s", session_name, exc_info=True)
            return

        poses = await self.hass.async_add_executor_job(_parse_poses_from_jsonl, text)
        if not poses:
            return

        self._image_bytes = await self.hass.async_add_executor_job(_render_map, poses)
        self._last_session_name = session_name

    async def _fetch_session_data(self, filename: str) -> str:
        """Download the JSONL content of a history session."""
        import async_timeout

        url = f"{self._api.base_url}/api/history/{filename}"
        async with async_timeout.timeout(30):
            async with self._api.session.get(url) as response:
                response.raise_for_status()
                return await response.text()
