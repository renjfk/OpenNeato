"""Sensor platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    EntityCategory,
    UnitOfElectricPotential,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN
from .entity import OpenNeatoEntity


@dataclass(frozen=True, kw_only=True)
class OpenNeatoSensorEntityDescription(SensorEntityDescription):
    """Describe an OpenNeato sensor."""

    coordinator_key: str = "fast_coordinator"
    section: str = ""
    field: str = ""
    value_fn: Any = None


SENSOR_DESCRIPTIONS: tuple[OpenNeatoSensorEntityDescription, ...] = (
    # ── Fast coordinator: charger ────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="charger_fuel_percent",
        translation_key="battery_level",
        name="Battery level",
        coordinator_key="fast_coordinator",
        section="charger",
        field="fuelPercent",
        device_class=SensorDeviceClass.BATTERY,
        native_unit_of_measurement="%",
        state_class=SensorStateClass.MEASUREMENT,
    ),
    OpenNeatoSensorEntityDescription(
        key="charger_vbattv",
        translation_key="battery_voltage",
        name="Battery voltage",
        coordinator_key="fast_coordinator",
        section="charger",
        field="vBattV",
        device_class=SensorDeviceClass.VOLTAGE,
        native_unit_of_measurement=UnitOfElectricPotential.VOLT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="charger_vextv",
        translation_key="external_voltage",
        name="External voltage",
        coordinator_key="fast_coordinator",
        section="charger",
        field="vExtV",
        device_class=SensorDeviceClass.VOLTAGE,
        native_unit_of_measurement=UnitOfElectricPotential.VOLT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── Fast coordinator: error ──────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="error_code",
        translation_key="error_code",
        name="Error code",
        coordinator_key="fast_coordinator",
        section="error",
        field="errorCode",
        icon="mdi:alert-circle",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="error_message",
        translation_key="error_message",
        name="Error message",
        coordinator_key="fast_coordinator",
        section="error",
        field="displayMessage",
        icon="mdi:alert-circle-outline",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── Slow coordinator: system ─────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="system_rssi",
        translation_key="wifi_signal",
        name="WiFi signal",
        coordinator_key="slow_coordinator",
        section="system",
        field="rssi",
        device_class=SensorDeviceClass.SIGNAL_STRENGTH,
        native_unit_of_measurement="dBm",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="system_uptime",
        translation_key="uptime",
        name="Uptime",
        coordinator_key="slow_coordinator",
        section="system",
        field="uptime",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda v: round(v / 1000) if v is not None else None,
    ),
    OpenNeatoSensorEntityDescription(
        key="system_heap",
        translation_key="free_heap",
        name="Free heap",
        coordinator_key="slow_coordinator",
        section="system",
        field="heap",
        native_unit_of_measurement="B",
        icon="mdi:memory",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="system_fs_used",
        translation_key="storage_used",
        name="Storage used",
        coordinator_key="slow_coordinator",
        section="system",
        field="fsUsed",
        native_unit_of_measurement="B",
        icon="mdi:harddisk",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── Slow coordinator: motors ─────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="motors_brush_rpm",
        translation_key="brush_rpm",
        name="Brush RPM",
        coordinator_key="slow_coordinator",
        section="motors",
        field="brushRPM",
        native_unit_of_measurement="rpm",
        icon="mdi:rotate-right",
        state_class=SensorStateClass.MEASUREMENT,
    ),
    OpenNeatoSensorEntityDescription(
        key="motors_vacuum_rpm",
        translation_key="vacuum_rpm",
        name="Vacuum RPM",
        coordinator_key="slow_coordinator",
        section="motors",
        field="vacuumRPM",
        native_unit_of_measurement="rpm",
        icon="mdi:fan",
        state_class=SensorStateClass.MEASUREMENT,
    ),
    OpenNeatoSensorEntityDescription(
        key="motors_side_brush_ma",
        translation_key="side_brush_current",
        name="Side brush current",
        coordinator_key="slow_coordinator",
        section="motors",
        field="sideBrushMA",
        native_unit_of_measurement="mA",
        icon="mdi:current-dc",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
)


class OpenNeatoSensor(OpenNeatoEntity, SensorEntity):
    """Representation of an OpenNeato sensor."""

    entity_description: OpenNeatoSensorEntityDescription

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        serial: str,
        description: OpenNeatoSensorEntityDescription,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the sensor."""
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
    def native_value(self) -> Any:
        """Return the sensor value."""
        if self.coordinator.data is None:
            return None
        section_data = self.coordinator.data.get(
            self.entity_description.section, {}
        )
        value = section_data.get(self.entity_description.field)
        if self.entity_description.value_fn is not None:
            return self.entity_description.value_fn(value)
        return value


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato sensors from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]

    entities: list[OpenNeatoSensor] = []
    for description in SENSOR_DESCRIPTIONS:
        coordinator = data[description.coordinator_key]
        entities.append(
            OpenNeatoSensor(
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
