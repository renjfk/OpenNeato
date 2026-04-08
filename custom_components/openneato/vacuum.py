"""Vacuum entity for the OpenNeato integration."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.vacuum import (
    StateVacuumEntity,
    VacuumActivity,
    VacuumEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import OpenNeatoApiClient
from .const import DOMAIN, FAN_SPEEDS, UISTATE_MAP
from .entity import OpenNeatoEntity

_LOGGER = logging.getLogger(__name__)

SUPPORTED_FEATURES = (
    VacuumEntityFeature.START
    | VacuumEntityFeature.STOP
    | VacuumEntityFeature.PAUSE
    | VacuumEntityFeature.RETURN_HOME
    | VacuumEntityFeature.CLEAN_SPOT
    | VacuumEntityFeature.LOCATE
    | VacuumEntityFeature.FAN_SPEED
    | VacuumEntityFeature.SEND_COMMAND
    | VacuumEntityFeature.STATE
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato vacuum from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            OpenNeatoVacuum(
                coordinator=data["fast_coordinator"],
                api=data["api"],
                serial=data["serial"],
                model=data["model"],
                sw_version=data["sw_version"],
                fw_version=data["fw_version"],
                host=data["host"],
            )
        ]
    )


class OpenNeatoVacuum(OpenNeatoEntity, StateVacuumEntity):
    """Representation of an OpenNeato vacuum cleaner."""

    _attr_supported_features = SUPPORTED_FEATURES
    _attr_fan_speed_list = FAN_SPEEDS
    _attr_name = None  # Use device name

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
        """Initialize the vacuum entity."""
        super().__init__(
            coordinator, serial,
            model=model, sw_version=sw_version, fw_version=fw_version, host=host,
        )
        self._api = api
        self._attr_unique_id = f"{serial}_vacuum"

    @property
    def activity(self) -> VacuumActivity | None:
        """Return the current vacuum activity."""
        if not self.coordinator.data:
            return None

        state_data = self.coordinator.data.get("state", {})
        charger_data = self.coordinator.data.get("charger", {})
        error_data = self.coordinator.data.get("error", {})

        # Error takes priority
        if error_data.get("hasError"):
            return VacuumActivity.ERROR

        ui_state = state_data.get("uiState", "")

        if ui_state in UISTATE_MAP:
            return UISTATE_MAP[ui_state]

        # For unmapped states, use charger to distinguish docked vs idle
        if charger_data.get("chargingActive") or charger_data.get("extPwrPresent"):
            return VacuumActivity.DOCKED

        return VacuumActivity.IDLE

    @property
    def battery_level(self) -> int | None:
        """Return the battery level."""
        if not self.coordinator.data:
            return None
        fuel = self.coordinator.data.get("charger", {}).get("fuelPercent", -1)
        return None if fuel == -1 else fuel

    @property
    def fan_speed(self) -> str | None:
        """Return the current fan speed."""
        if not self.coordinator.data:
            return None
        settings = self.coordinator.data.get("user_settings", {})
        if settings.get("ecoMode"):
            return "eco"
        if settings.get("intenseClean"):
            return "intense"
        return "normal"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra state attributes."""
        attrs: dict[str, Any] = {}
        if not self.coordinator.data:
            return attrs

        state_data = self.coordinator.data.get("state", {})
        error_data = self.coordinator.data.get("error", {})

        if robot_state := state_data.get("robotState"):
            attrs["robot_state"] = robot_state
        if ui_state := state_data.get("uiState"):
            attrs["ui_state"] = ui_state

        if error_data.get("hasError"):
            attrs["error_message"] = error_data.get("displayMessage", "Unknown error")
            attrs["error_code"] = error_data.get("errorCode")

        return attrs

    # -- Commands ----------------------------------------------------------

    async def async_start(self, **kwargs: Any) -> None:
        """Start cleaning."""
        await self._api.clean("start")
        await self.coordinator.async_request_refresh()

    async def async_stop(self, **kwargs: Any) -> None:
        """Stop cleaning."""
        await self._api.clean("stop")
        await self.coordinator.async_request_refresh()

    async def async_pause(self, **kwargs: Any) -> None:
        """Pause cleaning."""
        await self._api.clean("pause")
        await self.coordinator.async_request_refresh()

    async def async_return_to_base(self, **kwargs: Any) -> None:
        """Return to dock."""
        await self._api.clean("dock")
        await self.coordinator.async_request_refresh()

    async def async_clean_spot(self, **kwargs: Any) -> None:
        """Start spot cleaning."""
        await self._api.clean("spot")
        await self.coordinator.async_request_refresh()

    async def async_locate(self, **kwargs: Any) -> None:
        """Locate the vacuum by playing an alert sound."""
        await self._api.play_sound(19)

    async def async_set_fan_speed(self, fan_speed: str, **kwargs: Any) -> None:
        """Set the fan speed."""
        if fan_speed == "eco":
            await self._api.set_user_setting("EcoMode", "ON")
            await self._api.set_user_setting("IntenseClean", "OFF")
        elif fan_speed == "intense":
            await self._api.set_user_setting("EcoMode", "OFF")
            await self._api.set_user_setting("IntenseClean", "ON")
        else:
            await self._api.set_user_setting("EcoMode", "OFF")
            await self._api.set_user_setting("IntenseClean", "OFF")
        await self.coordinator.async_request_refresh()

    async def async_send_command(
        self, command: str, params: dict[str, Any] | list[Any] | None = None, **kwargs: Any
    ) -> None:
        """Send a raw serial command to the robot."""
        await self._api.send_serial_command(command)
        await self.coordinator.async_request_refresh()
