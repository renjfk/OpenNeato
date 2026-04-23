"""The OpenNeato integration."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import OpenNeatoApiClient, OpenNeatoConnectionError
from .const import CONF_HOST, DOMAIN
from .coordinator import OpenNeatoCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.VACUUM,
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.SWITCH,
    Platform.NUMBER,
    Platform.BUTTON,
    Platform.CAMERA,
    Platform.SELECT,
    Platform.TEXT,
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up OpenNeato from a config entry."""
    host = entry.data[CONF_HOST]
    session = async_get_clientsession(hass)
    api = OpenNeatoApiClient(host, session)

    _LOGGER.debug("Connecting to OpenNeato at %s", host)
    try:
        firmware_info = await api.get_firmware_version()
        robot_info = await api.get_robot_version()
    except OpenNeatoConnectionError as err:
        _LOGGER.warning("Cannot connect to OpenNeato at %s: %s", host, err)
        raise ConfigEntryNotReady(
            f"Cannot connect to OpenNeato at {host}: {err}"
        ) from err
    except Exception as err:
        _LOGGER.exception("Unexpected error connecting to OpenNeato at %s", host)
        raise ConfigEntryNotReady(
            f"Unexpected error connecting to OpenNeato at {host}: {err}"
        ) from err

    _LOGGER.info(
        "Connected to OpenNeato at %s — %s (%s) firmware %s",
        host,
        robot_info.get("modelName"),
        robot_info.get("serialNumber"),
        firmware_info.get("version"),
    )

    serial = robot_info.get("serialNumber", entry.data.get("serial", "unknown"))
    model = robot_info.get("modelName", entry.data.get("model"))
    sw_version = robot_info.get("softwareVersion", entry.data.get("software_version"))
    fw_version = firmware_info.get("version", entry.data.get("firmware_version"))

    coordinator = OpenNeatoCoordinator(hass, api)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "api": api,
        "coordinator": coordinator,
        "serial": serial,
        "model": model,
        "sw_version": sw_version,
        "fw_version": fw_version,
        "host": host,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an OpenNeato config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
