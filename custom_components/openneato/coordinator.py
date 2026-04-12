"""Data update coordinator for OpenNeato."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import OpenNeatoApiClient, OpenNeatoConnectionError
from .const import DEFAULT_POLL_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class OpenNeatoCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Single coordinator for all OpenNeato data."""

    def __init__(self, hass: HomeAssistant, api: OpenNeatoApiClient) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_POLL_INTERVAL),
        )
        self.api = api

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch all data concurrently."""
        results = await asyncio.gather(
            self.api.get_state(),
            self.api.get_charger(),
            self.api.get_error(),
            self.api.get_user_settings(),
            self.api.get_system(),
            self.api.get_settings(),
            self.api.get_motors(),
            self.api.get_history(),
            return_exceptions=True,
        )

        keys = (
            "state", "charger", "error", "user_settings",
            "system", "settings", "motors", "history",
        )
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
                    data[key] = {} if key != "history" else []
            else:
                data[key] = result

        if len(failures) == len(keys):
            raise UpdateFailed(
                f"All endpoints failed: {', '.join(failures)}"
            )

        return data
