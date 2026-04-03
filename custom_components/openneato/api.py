"""Async HTTP client for the OpenNeato robot API."""

from __future__ import annotations

from typing import Any

import aiohttp
import async_timeout

from homeassistant.exceptions import HomeAssistantError

TIMEOUT = 10  # seconds


class OpenNeatoConnectionError(HomeAssistantError):
    """Error to indicate we cannot connect to the robot."""


class OpenNeatoApiError(HomeAssistantError):
    """Error to indicate a non-connection API failure."""


class OpenNeatoApiClient:
    """Async HTTP client for OpenNeato."""

    def __init__(self, host: str, session: aiohttp.ClientSession) -> None:
        """Initialize the API client."""
        self._host = host.rstrip("/")
        self._session = session
        self._base_url = f"http://{self._host}"

    @property
    def base_url(self) -> str:
        """Return the base URL."""
        return self._base_url

    @property
    def session(self) -> aiohttp.ClientSession:
        """Return the aiohttp session."""
        return self._session

    async def _get(self, path: str) -> dict[str, Any]:
        """Perform a GET request and return parsed JSON."""
        url = f"{self._base_url}{path}"
        try:
            async with async_timeout.timeout(TIMEOUT):
                async with self._session.get(url) as response:
                    response.raise_for_status()
                    return await response.json()
        except aiohttp.ClientConnectionError as err:
            raise OpenNeatoConnectionError(
                f"Unable to connect to OpenNeato at {self._host}: {err}"
            ) from err
        except aiohttp.ClientResponseError as err:
            raise OpenNeatoApiError(
                f"API error from {path}: {err.status} {err.message}"
            ) from err
        except TimeoutError as err:
            raise OpenNeatoConnectionError(
                f"Timeout connecting to OpenNeato at {self._host}"
            ) from err

    async def _post(
        self, path: str, params: dict[str, str] | None = None
    ) -> dict[str, Any] | str:
        """Perform a POST request with optional query params."""
        url = f"{self._base_url}{path}"
        try:
            async with async_timeout.timeout(TIMEOUT):
                async with self._session.post(url, params=params) as response:
                    response.raise_for_status()
                    content_type = response.content_type or ""
                    if "json" in content_type:
                        return await response.json()
                    return await response.text()
        except aiohttp.ClientConnectionError as err:
            raise OpenNeatoConnectionError(
                f"Unable to connect to OpenNeato at {self._host}: {err}"
            ) from err
        except aiohttp.ClientResponseError as err:
            raise OpenNeatoApiError(
                f"API error from POST {path}: {err.status} {err.message}"
            ) from err
        except TimeoutError as err:
            raise OpenNeatoConnectionError(
                f"Timeout connecting to OpenNeato at {self._host}"
            ) from err

    async def _put(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """Perform a PUT request with a JSON body."""
        url = f"{self._base_url}{path}"
        try:
            async with async_timeout.timeout(TIMEOUT):
                async with self._session.put(url, json=json_data) as response:
                    response.raise_for_status()
                    return await response.json()
        except aiohttp.ClientConnectionError as err:
            raise OpenNeatoConnectionError(
                f"Unable to connect to OpenNeato at {self._host}: {err}"
            ) from err
        except aiohttp.ClientResponseError as err:
            raise OpenNeatoApiError(
                f"API error from PUT {path}: {err.status} {err.message}"
            ) from err
        except TimeoutError as err:
            raise OpenNeatoConnectionError(
                f"Timeout connecting to OpenNeato at {self._host}"
            ) from err

    # ── GET endpoints ────────────────────────────────────────────────

    async def get_state(self) -> dict[str, Any]:
        """Get the robot's current state."""
        return await self._get("/api/state")

    async def get_charger(self) -> dict[str, Any]:
        """Get charger / battery information."""
        return await self._get("/api/charger")

    async def get_error(self) -> dict[str, Any]:
        """Get current error information."""
        return await self._get("/api/error")

    async def get_firmware_version(self) -> dict[str, Any]:
        """Get firmware version info (chip, model, etc.)."""
        return await self._get("/api/firmware/version")

    async def get_robot_version(self) -> dict[str, Any]:
        """Get robot version info (serial, model name, etc.)."""
        return await self._get("/api/version")

    async def get_motors(self) -> dict[str, Any]:
        """Get motor RPM and current readings."""
        return await self._get("/api/motors")

    async def get_system(self) -> dict[str, Any]:
        """Get system information (heap, uptime, RSSI, etc.)."""
        return await self._get("/api/system")

    async def get_user_settings(self) -> dict[str, Any]:
        """Get user-facing settings (eco mode, intense clean, etc.)."""
        return await self._get("/api/user-settings")

    async def get_settings(self) -> dict[str, Any]:
        """Get full device settings."""
        return await self._get("/api/settings")

    async def get_history(self) -> list[dict[str, Any]]:
        """Get cleaning history sessions."""
        return await self._get("/api/history")  # type: ignore[return-value]

    # ── POST endpoints ───────────────────────────────────────────────

    async def clean(self, action: str) -> dict[str, Any] | str:
        """Send a clean command (start, stop, pause, resume, spot, dock)."""
        return await self._post("/api/clean", params={"action": action})

    async def play_sound(self, sound_id: int) -> dict[str, Any] | str:
        """Play a sound by ID (0-20)."""
        return await self._post("/api/sound", params={"id": str(sound_id)})

    async def power(self, action: str) -> dict[str, Any] | str:
        """Send a power command (on, off, standby, shutdown)."""
        return await self._post("/api/power", params={"action": action})

    async def set_user_setting(
        self, key: str, value: str
    ) -> dict[str, Any] | str:
        """Set a single user setting via query params."""
        return await self._post(
            "/api/user-settings", params={"key": key, "value": value}
        )

    async def send_serial_command(self, cmd: str) -> str:
        """Send a raw serial command. Returns plain text."""
        result = await self._post("/api/serial", params={"cmd": cmd})
        return str(result)

    async def restart(self) -> dict[str, Any] | str:
        """Restart the robot controller."""
        return await self._post("/api/system/restart")

    async def format_fs(self) -> dict[str, Any] | str:
        """Format the filesystem."""
        return await self._post("/api/system/format-fs")

    # ── PUT endpoints ────────────────────────────────────────────────

    async def update_settings(
        self, settings: dict[str, Any]
    ) -> dict[str, Any]:
        """Update device settings (JSON body). Returns full settings."""
        return await self._put("/api/settings", json_data=settings)
