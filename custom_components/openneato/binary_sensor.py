"""Binary sensor platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN
from .entity import OpenNeatoEntity


@dataclass(frozen=True, kw_only=True)
class OpenNeatoBinarySensorEntityDescription(BinarySensorEntityDescription):
    """Describe an OpenNeato binary sensor."""

    coordinator_key: str = "fast_coordinator"
    section: str = ""
    field: str = ""


BINARY_SENSOR_DESCRIPTIONS: tuple[OpenNeatoBinarySensorEntityDescription, ...] = (
    # ── Fast coordinator: charger ────────────────────────────────────
    OpenNeatoBinarySensorEntityDescription(
        key="charger_charging_active",
        translation_key="charging",
        name="Charging",
        coordinator_key="fast_coordinator",
        section="charger",
        field="chargingActive",
        device_class=BinarySensorDeviceClass.BATTERY_CHARGING,
    ),
    OpenNeatoBinarySensorEntityDescription(
        key="charger_ext_pwr_present",
        translation_key="external_power",
        name="External power",
        coordinator_key="fast_coordinator",
        section="charger",
        field="extPwrPresent",
        device_class=BinarySensorDeviceClass.PLUG,
    ),
    OpenNeatoBinarySensorEntityDescription(
        key="charger_battery_over_temp",
        translation_key="battery_over_temp",
        name="Battery over temp",
        coordinator_key="fast_coordinator",
        section="charger",
        field="batteryOverTemp",
        device_class=BinarySensorDeviceClass.HEAT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoBinarySensorEntityDescription(
        key="charger_battery_failure",
        translation_key="battery_failure",
        name="Battery failure",
        coordinator_key="fast_coordinator",
        section="charger",
        field="batteryFailure",
        device_class=BinarySensorDeviceClass.PROBLEM,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoBinarySensorEntityDescription(
        key="charger_empty_fuel",
        translation_key="empty_fuel",
        name="Empty fuel",
        coordinator_key="fast_coordinator",
        section="charger",
        field="emptyFuel",
        device_class=BinarySensorDeviceClass.BATTERY,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── Fast coordinator: error ──────────────────────────────────────
    OpenNeatoBinarySensorEntityDescription(
        key="error_has_error",
        translation_key="error",
        name="Error",
        coordinator_key="fast_coordinator",
        section="error",
        field="hasError",
        device_class=BinarySensorDeviceClass.PROBLEM,
    ),
    # ── Slow coordinator: system ─────────────────────────────────────
    OpenNeatoBinarySensorEntityDescription(
        key="system_ntp_synced",
        translation_key="ntp_synced",
        name="NTP synced",
        coordinator_key="slow_coordinator",
        section="system",
        field="ntpSynced",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
)


class OpenNeatoBinarySensor(OpenNeatoEntity, BinarySensorEntity):
    """Representation of an OpenNeato binary sensor."""

    entity_description: OpenNeatoBinarySensorEntityDescription

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        serial: str,
        description: OpenNeatoBinarySensorEntityDescription,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the binary sensor."""
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

    @property
    def is_on(self) -> bool | None:
        """Return true if the binary sensor is on."""
        if self.coordinator.data is None:
            return None
        section_data = self.coordinator.data.get(
            self.entity_description.section, {}
        )
        value = section_data.get(self.entity_description.field)
        if value is None:
            return None
        return bool(value)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato binary sensors from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]

    entities: list[OpenNeatoBinarySensor] = []
    for description in BINARY_SENSOR_DESCRIPTIONS:
        coordinator = data[description.coordinator_key]
        entities.append(
            OpenNeatoBinarySensor(
                coordinator,
                serial,
                description,
                model=model,
                sw_version=sw_version,
                fw_version=fw_version,
                host=host,
            )
        )

    async_add_entities(entities)
