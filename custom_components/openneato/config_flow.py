"""Config flow for OpenNeato integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import OpenNeatoApiClient, OpenNeatoApiError, OpenNeatoConnectionError
from .const import CONF_HOST, DOMAIN

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
    }
)


class OpenNeatoConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for OpenNeato."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST]
            session = async_get_clientsession(self.hass)
            api = OpenNeatoApiClient(host, session)

            try:
                firmware_info = await api.get_firmware_version()
                robot_info = await api.get_robot_version()
            except OpenNeatoConnectionError:
                errors["base"] = "cannot_connect"
            except (OpenNeatoApiError, Exception):
                _LOGGER.exception("Unexpected exception during config flow")
                errors["base"] = "unknown"
            else:
                serial = robot_info.get("serialNumber", "")
                model = robot_info.get("modelName")
                software_version = robot_info.get("softwareVersion")
                firmware_version = firmware_info.get("version")

                if not serial:
                    errors["base"] = "unknown"
                    return self.async_show_form(
                        step_id="user",
                        data_schema=STEP_USER_DATA_SCHEMA,
                        errors=errors,
                    )

                await self.async_set_unique_id(serial)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=model or f"OpenNeato ({host})",
                    data={
                        CONF_HOST: host,
                        "serial": serial,
                        "model": model,
                        "firmware_version": firmware_version,
                        "software_version": software_version,
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )
