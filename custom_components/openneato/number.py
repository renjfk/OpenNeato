"""Number platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from homeassistant.components.number import NumberEntity, NumberEntityDescription
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
class OpenNeatoNumberEntityDescription(NumberEntityDescription):
    """Describe an OpenNeato number entity."""

    section: str = "settings"
    field: str = ""
    settings_field: str = ""


NUMBER_DESCRIPTIONS: tuple[OpenNeatoNumberEntityDescription, ...] = (
    OpenNeatoNumberEntityDescription(
        key="brush_rpm_setting",
        translation_key="brush_rpm_setting",
        name="Brush RPM",
        section="settings",
        field="brushRpm",
        settings_field="brushRpm",
        native_min_value=500,
        native_max_value=1600,
        native_step=100,
        native_unit_of_measurement="rpm",
        icon="mdi:rotate-right",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoNumberEntityDescription(
        key="vacuum_speed_setting",
        translation_key="vacuum_speed_setting",
        name="Vacuum speed",
        section="settings",
        field="vacuumSpeed",
        settings_field="vacuumSpeed",
        native_min_value=40,
        native_max_value=100,
        native_step=5,
        native_unit_of_measurement="%",
        icon="mdi:fan",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoNumberEntityDescription(
        key="side_brush_power_setting",
        translation_key="side_brush_power_setting",
        name="Side brush power",
        section="settings",
        field="sideBrushPower",
        settings_field="sideBrushPower",
        native_min_value=500,
        native_max_value=1500,
        native_step=100,
        native_unit_of_measurement="mW",
        icon="mdi:rotate-left",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoNumberEntityDescription(
        key="stall_threshold_setting",
        translation_key="stall_threshold_setting",
        name="Stall threshold",
        section="settings",
        field="stallThreshold",
        settings_field="stallThreshold",
        native_min_value=30,
        native_max_value=80,
        native_step=5,
        native_unit_of_measurement="%",
        icon="mdi:car-brake-alert",
        entity_category=EntityCategory.CONFIG,
    ),
)


class OpenNeatoNumber(OpenNeatoEntity, NumberEntity):
    """Representation of an OpenNeato number entity."""

    entity_description: OpenNeatoNumberEntityDescription

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        serial: str,
        description: OpenNeatoNumberEntityDescription,
        api: OpenNeatoApiClient,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the number entity."""
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
    def native_value(self) -> float | None:
        """Return the current value."""
        if self.coordinator.data is None:
            return None
        section_data = self.coordinator.data.get(
            self.entity_description.section, {}
        )
        value = section_data.get(self.entity_description.field)
        if value is None:
            return None
        return float(value)

    async def async_set_native_value(self, value: float) -> None:
        """Set the new value."""
        desc = self.entity_description
        await self._api.update_settings({desc.settings_field: int(value)})
        await self.coordinator.async_request_refresh()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato number entities from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]
    api = data["api"]
    coordinator = data["slow_coordinator"]

    entities: list[OpenNeatoNumber] = []
    for description in NUMBER_DESCRIPTIONS:
        entities.append(
            OpenNeatoNumber(
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
