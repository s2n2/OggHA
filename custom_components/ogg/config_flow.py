"""Offline-first setup and connection options for Ogg."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import selector

from .const import DEFAULT_PORT, DOMAIN
from .endpoints import validate_config
from .studio.privacy import DEFAULTS as STUDIO_DEFAULTS
from .studio.privacy import STUDIO_OPTIONS, hash_pin


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
    """Connection sources (saving reloads Ogg) or the studio's privacy (applies at once)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        return self.async_show_menu(step_id="init", menu_options=["connection", "studio"])

    def _studio_options(self) -> dict[str, Any]:
        return {k: v for k, v in self.config_entry.options.items() if k in STUDIO_OPTIONS}

    async def async_step_connection(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                data = validate_config(user_input)
            except (TypeError, ValueError):
                errors["base"] = "invalid_config"
            else:
                return self.async_create_entry(title="", data={**self._studio_options(), **data})

        current = {k: v for k, v in {**self.config_entry.data, **self.config_entry.options}.items()
                   if k not in STUDIO_OPTIONS}
        return self.async_show_form(
            step_id="connection", data_schema=_schema(user_input or current), errors=errors
        )

    async def async_step_studio(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """The Play card's privacy: no history, discreet, who may use it, the PIN."""
        entry = self.config_entry
        errors: dict[str, str] = {}
        if user_input is not None:
            options = dict(entry.options)
            pin = str(user_input.pop("pin", "") or "").strip()
            remove = bool(user_input.pop("remove_pin", False))
            options.update(user_input)
            options["discreet_name"] = (
                str(options.get("discreet_name") or "").strip()[:40] or STUDIO_DEFAULTS["discreet_name"])
            if remove:
                options.pop("pin_hash", None)
                options.pop("pin_salt", None)
            elif pin:
                if not 4 <= len(pin) <= 32:
                    errors["pin"] = "pin_length"
                else:
                    options["pin_hash"], options["pin_salt"] = await self.hass.async_add_executor_job(hash_pin, pin)
            if not errors:
                return self.async_create_entry(title="", data=options)

        def now(key: str) -> Any:
            return entry.options.get(key, STUDIO_DEFAULTS[key])

        users = {u.id: u.name or u.id for u in await self.hass.auth.async_get_users()
                 if not u.system_generated and u.is_active}
        schema = vol.Schema({
            vol.Required("no_history", default=now("no_history")): cv.boolean,
            vol.Required("discreet", default=now("discreet")): cv.boolean,
            vol.Optional("discreet_name", default=now("discreet_name")): cv.string,
            vol.Optional("users", default=[u for u in now("users") if u in users]): cv.multi_select(users),
            vol.Optional("pin"): cv.string,
            vol.Optional("remove_pin", default=False): cv.boolean,
            vol.Required("auto_lock", default=now("auto_lock")): vol.All(vol.Coerce(int), vol.Range(min=0, max=240)),
        })
        return self.async_show_form(
            step_id="studio", data_schema=schema, errors=errors,
            description_placeholders={"pin": "set" if entry.options.get("pin_hash") else "not set"})
