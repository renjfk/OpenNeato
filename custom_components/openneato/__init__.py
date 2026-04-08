"""The OpenNeato integration."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import OpenNeatoApiClient
from .const import CONF_HOST, DOMAIN
from .coordinator import OpenNeatoFastCoordinator, OpenNeatoSlowCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.VACUUM,
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.SWITCH,
    Platform.NUMBER,
    Platform.BUTTON,
    Platform.CAMERA,
]

type OpenNeatoConfigEntry = ConfigEntry


async def async_setup_entry(hass: HomeAssistant, entry: OpenNeatoConfigEntry) -> bool:
    """Set up OpenNeato from a config entry."""
    host = entry.data[CONF_HOST]
    session = async_get_clientsession(hass)
    api = OpenNeatoApiClient(host, session)

    # Fetch version info for device_info – validates connectivity too
    firmware_info = await api.get_firmware_version()
    robot_info = await api.get_robot_version()

    serial = robot_info.get("serialNumber", entry.data.get("serial", "unknown"))
    model = robot_info.get("modelName", entry.data.get("model"))
    sw_version = robot_info.get("softwareVersion", entry.data.get("software_version"))
    fw_version = firmware_info.get("version", entry.data.get("firmware_version"))

    fast_coordinator = OpenNeatoFastCoordinator(hass, api)
    slow_coordinator = OpenNeatoSlowCoordinator(hass, api)

    await fast_coordinator.async_config_entry_first_refresh()
    await slow_coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "api": api,
        "fast_coordinator": fast_coordinator,
        "slow_coordinator": slow_coordinator,
        "serial": serial,
        "model": model,
        "sw_version": sw_version,
        "fw_version": fw_version,
        "host": host,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: OpenNeatoConfigEntry) -> bool:
    """Unload an OpenNeato config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
