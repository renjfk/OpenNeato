"""Select platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
import logging

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .api import OpenNeatoApiClient
from .const import DOMAIN
from .entity import OpenNeatoEntity

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class OpenNeatoSelectEntityDescription(SelectEntityDescription):
    """Describe an OpenNeato select entity."""

    section: str = "settings"
    settings_field: str = ""


SELECT_DESCRIPTIONS: tuple[OpenNeatoSelectEntityDescription, ...] = (
    OpenNeatoSelectEntityDescription(
        key="navigation_mode",
        translation_key="navigation_mode",
        name="Navigation mode",
        section="settings",
        settings_field="navMode",
        options=["Normal", "Gentle", "Deep", "Quick"],
        icon="mdi:navigation-variant",
        entity_category=EntityCategory.CONFIG,
    ),
)


class OpenNeatoSelect(OpenNeatoEntity, SelectEntity):
    """Representation of an OpenNeato select entity."""

    entity_description: OpenNeatoSelectEntityDescription

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        serial: str,
        description: OpenNeatoSelectEntityDescription,
        api: OpenNeatoApiClient,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the select entity."""
        super().__init__(
            coordinator,
            serial,
            model=model,
            sw_version=sw_version,
            fw_version=fw_version,
            host=host,
        )
        self.entity_description = description
        self._attr_unique_id = f"{serial}_{description.key}"
        self._api = api

    @property
    def current_option(self) -> str | None:
        """Return the currently selected option."""
        if self.coordinator.data is None:
            return None
        section_data = self.coordinator.data.get(
            self.entity_description.section, {}
        )
        value = section_data.get(self.entity_description.settings_field)
        if value in (self.entity_description.options or []):
            return value
        return None

    async def async_select_option(self, option: str) -> None:
        """Change the selected option."""
        desc = self.entity_description
        if option not in (desc.options or []):
            return
        await self._api.update_settings({desc.settings_field: option})
        await self.coordinator.async_request_refresh()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato select entities from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]
    api = data["api"]
    coordinator = data["coordinator"]

    entities: list[OpenNeatoSelect] = []
    for description in SELECT_DESCRIPTIONS:
        entities.append(
            OpenNeatoSelect(
                coordinator,
                serial,
                description,
                api,
                model=model,
                sw_version=sw_version,
                fw_version=fw_version,
                host=host,
            )
        )

    async_add_entities(entities)
