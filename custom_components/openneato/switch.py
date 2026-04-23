"""Switch platform for the OpenNeato integration."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
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
class OpenNeatoSwitchEntityDescription(SwitchEntityDescription):
    """Describe an OpenNeato switch."""

    section: str = ""
    field: str = ""
    # For user_settings switches (POST with key/value)
    setting_key: str | None = None
    # For settings switches (PUT with JSON body)
    settings_field: str | None = None
    # For switches with a dedicated API method (e.g. wall follower)
    api_method: str | None = None


SWITCH_DESCRIPTIONS: tuple[OpenNeatoSwitchEntityDescription, ...] = (
    OpenNeatoSwitchEntityDescription(
        key="eco_mode",
        translation_key="eco_mode",
        name="Eco mode",
        section="user_settings",
        field="ecoMode",
        setting_key="EcoMode",
        icon="mdi:leaf",
    ),
    OpenNeatoSwitchEntityDescription(
        key="intense_clean",
        translation_key="intense_clean",
        name="Intense clean",
        section="user_settings",
        field="intenseClean",
        setting_key="IntenseClean",
        icon="mdi:flash",
    ),
    OpenNeatoSwitchEntityDescription(
        key="bin_full_detect",
        translation_key="bin_full_detect",
        name="Bin full detect",
        section="user_settings",
        field="binFullDetect",
        setting_key="BinFullDetect",
        icon="mdi:delete-alert",
    ),
    OpenNeatoSwitchEntityDescription(
        key="schedule",
        translation_key="schedule",
        name="Schedule",
        section="settings",
        field="scheduleEnabled",
        settings_field="scheduleEnabled",
        icon="mdi:calendar-clock",
    ),
    OpenNeatoSwitchEntityDescription(
        key="wall_follower",
        translation_key="wall_follower",
        name="Wall follower",
        section="user_settings",
        field="wallEnable",
        setting_key="WallEnable",
        icon="mdi:wall",
    ),
    OpenNeatoSwitchEntityDescription(
        key="button_click_sounds",
        translation_key="button_click_sounds",
        name="Button click sounds",
        section="user_settings",
        field="buttonClick",
        setting_key="ButtonClick",
        icon="mdi:gesture-tap-button",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="melody_sounds",
        translation_key="melody_sounds",
        name="Melody sounds",
        section="user_settings",
        field="melodies",
        setting_key="Melodies",
        icon="mdi:music",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="warning_sounds",
        translation_key="warning_sounds",
        name="Warning sounds",
        section="user_settings",
        field="warnings",
        setting_key="Warnings",
        icon="mdi:volume-high",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="stealth_led",
        translation_key="stealth_led",
        name="Stealth LED",
        section="user_settings",
        field="stealthLed",
        setting_key="StealthLED",
        icon="mdi:led-off",
        entity_category=EntityCategory.CONFIG,
    ),
    # ── Notification switches (from ESP32 settings) ───────────────────
    OpenNeatoSwitchEntityDescription(
        key="notifications_enabled",
        translation_key="notifications_enabled",
        name="Notifications",
        section="settings",
        field="ntfyEnabled",
        settings_field="ntfyEnabled",
        icon="mdi:bell",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="notify_on_done",
        translation_key="notify_on_done",
        name="Notify on clean done",
        section="settings",
        field="ntfyOnDone",
        settings_field="ntfyOnDone",
        icon="mdi:bell-check",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="notify_on_error",
        translation_key="notify_on_error",
        name="Notify on error",
        section="settings",
        field="ntfyOnError",
        settings_field="ntfyOnError",
        icon="mdi:bell-alert",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="notify_on_alert",
        translation_key="notify_on_alert",
        name="Notify on alert",
        section="settings",
        field="ntfyOnAlert",
        settings_field="ntfyOnAlert",
        icon="mdi:bell-ring",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="notify_on_docking",
        translation_key="notify_on_docking",
        name="Notify on docking",
        section="settings",
        field="ntfyOnDocking",
        settings_field="ntfyOnDocking",
        icon="mdi:bell-plus",
        entity_category=EntityCategory.CONFIG,
    ),
    OpenNeatoSwitchEntityDescription(
        key="remote_syslog",
        translation_key="remote_syslog",
        name="Remote syslog",
        section="settings",
        field="syslogEnabled",
        settings_field="syslogEnabled",
        icon="mdi:console-network",
        entity_category=EntityCategory.CONFIG,
    ),
)


class OpenNeatoSwitch(OpenNeatoEntity, SwitchEntity):
    """Representation of an OpenNeato switch."""

    entity_description: OpenNeatoSwitchEntityDescription

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        serial: str,
        description: OpenNeatoSwitchEntityDescription,
        api: OpenNeatoApiClient,
        model: str | None = None,
        sw_version: str | None = None,
        fw_version: str | None = None,
        host: str | None = None,
    ) -> None:
        """Initialize the switch."""
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
    def is_on(self) -> bool | None:
        """Return true if the switch is on."""
        if self.coordinator.data is None:
            return None
        section_data = self.coordinator.data.get(
            self.entity_description.section, {}
        )
        value = section_data.get(self.entity_description.field)
        if value is None:
            return None
        return bool(value)

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn the switch on."""
        desc = self.entity_description
        if desc.api_method is not None:
            await getattr(self._api, desc.api_method)(True)
        elif desc.setting_key is not None:
            await self._api.set_user_setting(desc.setting_key, "ON")
        elif desc.settings_field is not None:
            await self._api.update_settings({desc.settings_field: True})
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Turn the switch off."""
        desc = self.entity_description
        if desc.api_method is not None:
            await getattr(self._api, desc.api_method)(False)
        elif desc.setting_key is not None:
            await self._api.set_user_setting(desc.setting_key, "OFF")
        elif desc.settings_field is not None:
            await self._api.update_settings({desc.settings_field: False})
        await self.coordinator.async_request_refresh()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up OpenNeato switches from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    serial = data["serial"]
    model = data["model"]
    sw_version = data["sw_version"]
    fw_version = data["fw_version"]
    host = data["host"]
    api = data["api"]
    coordinator = data["coordinator"]

    entities: list[OpenNeatoSwitch] = []
    for description in SWITCH_DESCRIPTIONS:
        entities.append(
            OpenNeatoSwitch(
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
