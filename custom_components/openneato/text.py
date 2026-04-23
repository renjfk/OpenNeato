"""Text platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
import logging

from homeassistant.components.text import TextEntity, TextEntityDescription
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
class OpenNeatoTextEntityDescription(TextEntityDescription):
    """Describe an OpenNeato text entity."""

    section: str = "settings"
    settings_field: str = ""


TEXT_DESCRIPTIONS: tuple[OpenNeatoTextEntityDescription, ...] = (
    OpenNeatoTextEntityDescription(
        key="syslog_ip",
        translation_key="syslog_ip",
        name="Syslog server IP",
        section="settings",
        settings_field="syslogIp",
        icon="mdi:ip-network",
        entity_category=EntityCategory.CONFIG,
        # Max length for an IPv4 address string (e.g. "255.255.255.255")
        native_max=15,
        pattern=r"^(\d{1,3}\.){3}\d{1,3}$|^$",
    ),
)


class OpenNeatoText(OpenNeatoEntity, TextEntity):
    """Representation of an OpenNeato text entity."""

    entity_description: OpenNeatoTextEntityDescription

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        serial: str,
        description: OpenNeatoTextEntityDescription,
        api: OpenNeatoApiClient,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the text entity."""
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
    def native_value(self) -> str | None:
        """Return the current value."""
        if self.coordinator.data is None:
            return None
        section_data = self.coordinator.data.get(
            self.entity_description.section, {}
        )
        value = section_data.get(self.entity_description.settings_field)
        if value is None:
            return None
        return str(value)

    async def async_set_value(self, value: str) -> None:
        """Set the new value."""
        desc = self.entity_description
        await self._api.update_settings({desc.settings_field: value})
        await self.coordinator.async_request_refresh()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato text entities from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]
    api = data["api"]
    coordinator = data["coordinator"]

    entities: list[OpenNeatoText] = []
    for description in TEXT_DESCRIPTIONS:
        entities.append(
            OpenNeatoText(
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
