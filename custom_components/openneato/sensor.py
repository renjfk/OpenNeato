"""Sensor platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
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
    UnitOfLength,
    UnitOfTemperature,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .camera import latest_completed_session
from .const import DOMAIN
from .entity import OpenNeatoEntity


def _latest_summary(history: Any) -> dict[str, Any] | None:
    """Return the summary dict from the most recent completed session."""
    session = latest_completed_session(history)
    if not session:
        return None
    summary = session.get("summary")
    return summary if isinstance(summary, dict) else None


@dataclass(frozen=True, kw_only=True)
class OpenNeatoSensorEntityDescription(SensorEntityDescription):
    """Describe an OpenNeato sensor."""

    section: str = ""
    field: str = ""
    value_fn: Any = None


SENSOR_DESCRIPTIONS: tuple[OpenNeatoSensorEntityDescription, ...] = (
    # ── Charger ─────────────────────────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="charger_fuel_percent",
        translation_key="battery_level",
        name="Battery level",
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
        section="charger",
        field="vExtV",
        device_class=SensorDeviceClass.VOLTAGE,
        native_unit_of_measurement=UnitOfElectricPotential.VOLT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="charger_batt_temp",
        translation_key="battery_temperature",
        name="Battery temperature",
        section="charger",
        field="battTempC",
        device_class=SensorDeviceClass.TEMPERATURE,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda v: v if v is not None and v >= 0 else None,
    ),
    OpenNeatoSensorEntityDescription(
        key="charger_discharge_mah",
        translation_key="discharge_mah",
        name="Battery discharge",
        section="charger",
        field="dischargeMAH",
        native_unit_of_measurement="mAh",
        icon="mdi:battery-arrow-down",
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="charger_charge_mah",
        translation_key="charge_mah",
        name="Battery charge",
        section="charger",
        field="chargerMAH",
        native_unit_of_measurement="mAh",
        icon="mdi:battery-arrow-up",
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── Error ───────────────────────────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="error_code",
        translation_key="error_code",
        name="Error code",
        section="error",
        field="errorCode",
        icon="mdi:alert-circle",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="error_message",
        translation_key="error_message",
        name="Error message",
        section="error",
        field="displayMessage",
        icon="mdi:alert-circle-outline",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── System ──────────────────────────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="system_rssi",
        translation_key="wifi_signal",
        name="WiFi signal",
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
        section="system",
        field="heap",
        native_unit_of_measurement="B",
        icon="mdi:memory",
        entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    OpenNeatoSensorEntityDescription(
        key="system_fs_used",
        translation_key="storage_used",
        name="Storage used",
        section="system",
        field="fsUsed",
        native_unit_of_measurement="B",
        icon="mdi:harddisk",
        entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    # ── Motors ──────────────────────────────────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="motors_brush_rpm",
        translation_key="brush_rpm",
        name="Brush RPM",
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
        section="motors",
        field="sideBrushMA",
        native_unit_of_measurement="mA",
        icon="mdi:current-dc",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    OpenNeatoSensorEntityDescription(
        key="motors_laser_rpm",
        translation_key="lidar_rpm",
        name="LIDAR RPM",
        section="motors",
        field="laserRPM",
        native_unit_of_measurement="rpm",
        icon="mdi:radar",
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    # ── Last clean stats (from history) ──────────────────────────────
    OpenNeatoSensorEntityDescription(
        key="last_clean_duration",
        translation_key="last_clean_duration",
        name="Last clean duration",
        section="history",
        field="",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:timer-outline",
        value_fn=lambda data: (s := _latest_summary(data)) and s.get("duration"),
    ),
    OpenNeatoSensorEntityDescription(
        key="last_clean_area",
        translation_key="last_clean_area",
        name="Last clean area",
        section="history",
        field="",
        native_unit_of_measurement="m\u00b2",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:texture-box",
        value_fn=lambda data: (s := _latest_summary(data)) and s.get("areaCovered"),
    ),
    OpenNeatoSensorEntityDescription(
        key="last_clean_distance",
        translation_key="last_clean_distance",
        name="Last clean distance",
        section="history",
        field="",
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.METERS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:map-marker-distance",
        value_fn=lambda data: (s := _latest_summary(data)) and s.get("distanceTraveled"),
    ),
    OpenNeatoSensorEntityDescription(
        key="last_clean_battery_used",
        translation_key="last_clean_battery_used",
        name="Last clean battery used",
        section="history",
        field="",
        native_unit_of_measurement="%",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:battery-minus-outline",
        value_fn=lambda data: (
            s["batteryStart"] - s["batteryEnd"]
            if (s := _latest_summary(data))
            and s.get("batteryStart") is not None
            and s.get("batteryEnd") is not None
            else None
        ),
    ),
    OpenNeatoSensorEntityDescription(
        key="last_clean_mode",
        translation_key="last_clean_mode",
        name="Last clean mode",
        section="history",
        field="",
        icon="mdi:robot-vacuum",
        value_fn=lambda data: (s := _latest_summary(data)) and s.get("mode"),
    ),
    OpenNeatoSensorEntityDescription(
        key="last_clean_ended",
        translation_key="last_clean_ended",
        name="Last clean ended",
        section="history",
        field="",
        device_class=SensorDeviceClass.TIMESTAMP,
        value_fn=lambda data: (
            datetime.fromtimestamp(s["time"], tz=timezone.utc)
            if (s := _latest_summary(data)) and s.get("time")
            else None
        ),
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
        if self.entity_description.value_fn is not None:
            # History sensors (field="") pass the whole section (a list);
            # field-based sensors pass the extracted field value.
            if self.entity_description.field:
                return self.entity_description.value_fn(
                    section_data.get(self.entity_description.field)
                )
            return self.entity_description.value_fn(section_data)
        return section_data.get(self.entity_description.field)


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
    coordinator = data["coordinator"]

    entities: list[OpenNeatoSensor] = []
    for description in SENSOR_DESCRIPTIONS:
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
