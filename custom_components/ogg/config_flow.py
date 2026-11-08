"""Offline-first setup and connection options for Ogg."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import DEFAULT_PORT, DOMAIN
from .endpoints import validate_config


def _schema(values: Mapping[str, Any] | None = None) -> vol.Schema:
    """Expose address lists without requiring a reachable server."""
    data = values or {}
    return vol.Schema(
        {
            vol.Optional(
                "manual_hosts", default=data.get("manual_hosts", [])
            ): selector.TextSelector(selector.TextSelectorConfig(multiple=True)),
            vol.Optional(
                "sensor_entities", default=data.get("sensor_entities", [])
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(filter={"domain": "sensor"}, multiple=True)
            ),
            vol.Required("port", default=data.get("port", DEFAULT_PORT)): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=1, max=65535, step=1, mode=selector.NumberSelectorMode.BOX
                )
            ),
            vol.Required("ssl", default=data.get("ssl", False)): selector.BooleanSelector(),
            vol.Required(
                "multi_server", default=data.get("multi_server", False)
            ): selector.BooleanSelector(),
            vol.Required(
                "scan_interval", default=data.get("scan_interval", 15)
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=5,
                    max=120,
                    step=1,
                    unit_of_measurement="s",
                    mode=selector.NumberSelectorMode.BOX,
                )
            ),
        }
    )


class OggConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create one Ogg controller with multiple alternative connection sources."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                data = validate_config(user_input)
            except (TypeError, ValueError):
                errors["base"] = "invalid_config"
            else:
                await self.async_set_unique_id(DOMAIN)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title="Ogg", data=data)

        return self.async_show_form(step_id="user", data_schema=_schema(user_input), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> OggOptionsFlow:
        return OggOptionsFlow()


class OggOptionsFlow(config_entries.OptionsFlow):
    """Edit alternative endpoints; the entry update listener reloads Ogg."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                data = validate_config(user_input)
            except (TypeError, ValueError):
                errors["base"] = "invalid_config"
            else:
                return self.async_create_entry(title="", data=data)

        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(
            step_id="init", data_schema=_schema(user_input or current), errors=errors
        )
