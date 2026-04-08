"""Data update coordinators for OpenNeato."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import OpenNeatoApiClient, OpenNeatoConnectionError
from .const import DEFAULT_FAST_POLL_INTERVAL, DEFAULT_SLOW_POLL_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class OpenNeatoFastCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator for frequently-polled data (state, charger, error, user_settings)."""

    def __init__(self, hass: HomeAssistant, api: OpenNeatoApiClient) -> None:
        """Initialize the fast coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_fast",
            update_interval=timedelta(seconds=DEFAULT_FAST_POLL_INTERVAL),
        )
        self.api = api

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch state, charger, error, and user_settings concurrently."""
        results = await asyncio.gather(
            self.api.get_state(),
            self.api.get_charger(),
            self.api.get_error(),
            self.api.get_user_settings(),
            return_exceptions=True,
        )

        keys = ("state", "charger", "error", "user_settings")
        data: dict[str, Any] = {}
        failures: list[str] = []

        for key, result in zip(keys, results):
            if isinstance(result, OpenNeatoConnectionError):
                raise UpdateFailed(
                    f"Cannot connect to OpenNeato: {result}"
                ) from result
            if isinstance(result, Exception):
                _LOGGER.warning("Failed to fetch %s: %s", key, result)
                failures.append(key)
                # Preserve previous data for this key if available
                if self.data and key in self.data:
                    data[key] = self.data[key]
                else:
                    data[key] = {}
            else:
                data[key] = result

        if len(failures) == len(keys):
            raise UpdateFailed(
                f"All fast-poll endpoints failed: {', '.join(failures)}"
            )

        return data


class OpenNeatoSlowCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator for infrequently-polled data (system, settings, motors)."""

    def __init__(self, hass: HomeAssistant, api: OpenNeatoApiClient) -> None:
        """Initialize the slow coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_slow",
            update_interval=timedelta(seconds=DEFAULT_SLOW_POLL_INTERVAL),
        )
        self.api = api

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch system, settings, and motors concurrently."""
        results = await asyncio.gather(
            self.api.get_system(),
            self.api.get_settings(),
            self.api.get_motors(),
            return_exceptions=True,
        )

        keys = ("system", "settings", "motors")
        data: dict[str, Any] = {}
        failures: list[str] = []

        for key, result in zip(keys, results):
            if isinstance(result, OpenNeatoConnectionError):
                raise UpdateFailed(
                    f"Cannot connect to OpenNeato: {result}"
                ) from result
            if isinstance(result, Exception):
                _LOGGER.warning("Failed to fetch %s: %s", key, result)
                failures.append(key)
                if self.data and key in self.data:
                    data[key] = self.data[key]
                else:
                    data[key] = {}
            else:
                data[key] = result

        if len(failures) == len(keys):
            raise UpdateFailed(
                f"All slow-poll endpoints failed: {', '.join(failures)}"
            )

        return data
