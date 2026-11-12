"""Ogg Studio: the Play card's side of Ogg.

Record, import, save and replay scripts, moods and patterns; play together;
limits, privacy and a PIN. This was the separate OggStudio integration; it is
now part of Ogg. Its services are ``ogg.studio_*``.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import issue_registry as ir

from .const import LIBRARY, OGG_DOMAIN, OLD_DOMAIN, SPEEDS
from .convert import RUN_MODES, run_script
from .library import Library, clean_script, limit_script, script_info
from .privacy import STUDIO_OPTIONS, async_setup_privacy, async_setup_privacy_entry, require_user
from .safety import async_panic, async_setup_safety, device_limits
from .together import async_setup_together
from .video import async_setup_video

_LOGGER = logging.getLogger(__name__)

SAVE_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("script"): dict,
                          vol.Optional("mode"): vol.In(RUN_MODES)})
MODE_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("mode"): vol.In(RUN_MODES)})
NAME_SCHEMA = vol.Schema({vol.Required("name"): cv.string})
RENAME_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("new_name"): cv.string})
PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("name"): cv.string,
        vol.Optional("script"): dict,
        vol.Optional("speed"): vol.Any(vol.In(SPEEDS), vol.All(vol.Coerce(float), vol.Range(min=0.25, max=4))),
        vol.Optional("loop", default=False): cv.boolean,
        vol.Optional("mode"): vol.In(RUN_MODES),
    }
)
STOP_SCHEMA = vol.Schema({vol.Required("entity_id"): cv.entity_id})
CLAIM_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("owner"): vol.All(cv.string, vol.Length(min=1, max=80)),
        vol.Optional("label", default=""): cv.string,
        vol.Optional("release", default=False): cv.boolean,
    }
)
LIMITS_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("max", default=100): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("lo", default=0): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("hi", default=100): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("speed", default=100): vol.All(vol.Coerce(float), vol.Range(min=5, max=100)),
    }
)
PLAYLIST_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("items"): list,
                              vol.Optional("loop", default=False): cv.boolean})


def studio_library(hass: HomeAssistant) -> Library:
    library = hass.data.get(LIBRARY)
    if library is None:
        raise HomeAssistantError("Set up Ogg first")
    return library


async def async_setup_studio(hass: HomeAssistant) -> None:
    """Services, websocket commands and links (once, from Ogg's async_setup)."""
    await async_setup_video(hass)
    await async_setup_safety(hass)
    await async_setup_privacy(hass)
    await async_setup_together(hass)

    def guarded(handler: Any) -> Any:
        """Only the allowed users (when some are chosen); automations always."""
        async def run(call: ServiceCall) -> Any:
            require_user(hass, call.context.user_id)
            return await handler(call)
        return run

    async def panic(call: ServiceCall) -> ServiceResponse:
        stopped = await async_panic(hass)
        return {"stopped": stopped} if call.return_response else None

    async def set_limits(call: ServiceCall) -> None:
        studio_library(hass).set_limits(call.data["entity_id"], {k: call.data[k] for k in ("max", "lo", "hi", "speed")})

    async def save_playlist(call: ServiceCall) -> ServiceResponse:
        name = studio_library(hass).save_playlist(call.data["name"], call.data["items"], call.data["loop"])
        return {"name": name} if call.return_response else None

    async def delete_playlist(call: ServiceCall) -> None:
        studio_library(hass).delete_playlist(call.data["name"])

    async def save(call: ServiceCall) -> ServiceResponse:
        name = studio_library(hass).save(call.data["name"], call.data["script"], call.data.get("mode"))
        return {"name": name}

    async def claim(call: ServiceCall) -> None:
        studio_library(hass).claim(call.data["entity_id"], call.data["owner"], call.data["label"],
                                   call.data["release"])

    async def set_mode(call: ServiceCall) -> None:
        studio_library(hass).set_mode(call.data["name"], call.data["mode"])

    async def delete(call: ServiceCall) -> None:
        studio_library(hass).delete(call.data["name"])

    async def rename(call: ServiceCall) -> None:
        studio_library(hass).rename(call.data["name"], call.data["new_name"])

    async def get_script(call: ServiceCall) -> ServiceResponse:
        script = studio_library(hass).get(call.data["name"])
        return {"name": call.data["name"], "script": script, **script_info(script)}

    async def play(call: ServiceCall) -> None:
        library = studio_library(hass)
        name: str | None = None
        if "script" in call.data:
            script = clean_script(call.data["script"])
        elif "name" in call.data or library.selected:
            name = call.data.get("name") or library.selected
            script = library.get(name)
        else:
            raise HomeAssistantError("Choose a saved script or give a script to play")
        mode = call.data.get("mode")
        if name and mode:
            library.set_mode(name, mode)
        script = run_script(script, mode or (library.mode(name) if name else None))
        script = limit_script(script, device_limits(hass, library, call.data["entity_id"]))
        speed: Any = call.data.get("speed", library.speed)
        factor = float(str(speed).rstrip("x"))
        await hass.services.async_call(
            OGG_DOMAIN, "play_script",
            {"entity_id": call.data["entity_id"], "script": script, "speed": factor, "loop": call.data["loop"]},
            blocking=True,
        )

    async def stop(call: ServiceCall) -> None:
        await hass.services.async_call(OGG_DOMAIN, "stop_script", {"entity_id": call.data["entity_id"]}, blocking=True)

    reg = hass.services.async_register
    reg(OGG_DOMAIN, "studio_save", guarded(save), schema=SAVE_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    reg(OGG_DOMAIN, "studio_delete", guarded(delete), schema=NAME_SCHEMA)
    reg(OGG_DOMAIN, "studio_set_mode", guarded(set_mode), schema=MODE_SCHEMA)
    reg(OGG_DOMAIN, "studio_claim", guarded(claim), schema=CLAIM_SCHEMA)
    reg(OGG_DOMAIN, "studio_rename", guarded(rename), schema=RENAME_SCHEMA)
    reg(OGG_DOMAIN, "studio_get_script", guarded(get_script), schema=NAME_SCHEMA,
        supports_response=SupportsResponse.ONLY)
    reg(OGG_DOMAIN, "studio_play", guarded(play), schema=PLAY_SCHEMA)
    reg(OGG_DOMAIN, "studio_set_limits", guarded(set_limits), schema=LIMITS_SCHEMA)
    reg(OGG_DOMAIN, "studio_save_playlist", guarded(save_playlist), schema=PLAYLIST_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL)
    reg(OGG_DOMAIN, "studio_delete_playlist", guarded(delete_playlist), schema=NAME_SCHEMA)
    # Stopping is never refused.
    reg(OGG_DOMAIN, "studio_stop", stop, schema=STOP_SCHEMA)
    reg(OGG_DOMAIN, "studio_panic", panic, schema=vol.Schema({}), supports_response=SupportsResponse.OPTIONAL)


async def async_setup_studio_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """The library and privacy for Ogg's entry (before its entities are set up)."""
    await _async_take_old_settings(hass, entry)
    library = Library(hass)
    await library.async_load()
    hass.data[LIBRARY] = library
    async_setup_privacy_entry(hass, entry)
    if hass.config_entries.async_entries(OLD_DOMAIN):
        # The separate OggStudio integration is still installed: ask to remove it.
        ir.async_create_issue(
            hass, OGG_DOMAIN, "oggstudio_merged", is_fixable=False, severity=ir.IssueSeverity.WARNING,
            translation_key="oggstudio_merged", learn_more_url="https://github.com/s2n2/OggHA")
    else:
        ir.async_delete_issue(hass, OGG_DOMAIN, "oggstudio_merged")


async def _async_take_old_settings(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Privacy settings and the PIN of the OggStudio integration, once."""
    old_entries = hass.config_entries.async_entries(OLD_DOMAIN)
    if entry.options.get("studio_taken") or not old_entries:
        return
    options = dict(entry.options)
    for old in old_entries:
        for key in STUDIO_OPTIONS:
            if key in old.options and key not in options:
                options[key] = old.options[key]
        break
    options["studio_taken"] = True
    hass.config_entries.async_update_entry(entry, options=options)


def async_unload_studio_entry(hass: HomeAssistant) -> None:
    hass.data.pop(LIBRARY, None)
