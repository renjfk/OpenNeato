"""Button platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from collections.abc import Callable, Coroutine
from typing import Any

from homeassistant.components.button import (
    ButtonDeviceClass,
    ButtonEntity,
    ButtonEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import OpenNeatoApiClient
from .const import DOMAIN
from .entity import OpenNeatoEntity

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class OpenNeatoButtonEntityDescription(ButtonEntityDescription):
    """Describe an OpenNeato button."""

    press_fn: Callable[[OpenNeatoApiClient], Coroutine[Any, Any, Any]]


BUTTON_DESCRIPTIONS: tuple[OpenNeatoButtonEntityDescription, ...] = (
    OpenNeatoButtonEntityDescription(
        key="restart",
        translation_key="restart",
        name="Restart device",
        device_class=ButtonDeviceClass.RESTART,
        entity_category=EntityCategory.CONFIG,
        press_fn=lambda api: api.restart(),
    ),
    OpenNeatoButtonEntityDescription(
        key="format_fs",
        translation_key="format_fs",
        name="Format filesystem",
        icon="mdi:harddisk-remove",
        entity_category=EntityCategory.CONFIG,
        press_fn=lambda api: api.format_fs(),
    ),
)


class OpenNeatoButton(OpenNeatoEntity, ButtonEntity):
    """Representation of an OpenNeato button."""

    entity_description: OpenNeatoButtonEntityDescription

    def __init__(
        self,
        coordinator,
        serial: str,
        description: OpenNeatoButtonEntityDescription,
        api: OpenNeatoApiClient,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the button."""
        super().__init__(
            coordinator, serial,
            model=model, sw_version=sw_version, fw_version=fw_version, host=host,
        )
        self.entity_description = description
        self._attr_unique_id = f"{serial}_{description.key}"
        self._api = api

    async def async_press(self) -> None:
        """Handle the button press."""
        await self.entity_description.press_fn(self._api)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato buttons from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]
    api = data["api"]
    coordinator = data["slow_coordinator"]

    async_add_entities(
        [
            OpenNeatoButton(
                coordinator, serial, description, api,
                model=model, sw_version=sw_version, fw_version=fw_version, host=host,
            )
            for description in BUTTON_DESCRIPTIONS
        ]
    )
