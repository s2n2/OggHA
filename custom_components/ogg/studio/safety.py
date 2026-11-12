"""Safety: stop everything, per-device limits, and stopping when a browser goes away.

* ``oggstudio.panic`` (also the Stop everything button, and the
  ``OGGSTUDIO_PANIC`` notification action) stops every Ogg device, drops all
  control claims and tells every open card to halt what it is doing.
* Limits are kept per device and shown to the cards, which apply them to
  everything they send. ``oggstudio.play`` applies the intensity limit too.
* A card holds an ``oggstudio/session`` subscription open while it is on
  screen. When its connection goes (page closed, phone asleep, network lost),
  the devices it was driving are stopped at once.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import LIBRARY, OGG_DOMAIN

_LOGGER = logging.getLogger(__name__)

PANIC_ACTION = "OGGSTUDIO_PANIC"


def _library(hass: HomeAssistant) -> Any:
    return hass.data.get(LIBRARY)


def ogg_stop_entities(hass: HomeAssistant) -> list[str]:
    """The Stop button of every Ogg device."""
    registry = er.async_get(hass)
    return [e.entity_id for e in registry.entities.values()
            if e.platform == OGG_DOMAIN and not e.disabled_by and str(e.unique_id).endswith(":stop")]


def device_limits(hass: HomeAssistant, library: Any, entity_id: str) -> dict[str, int] | None:
    """Limits of the device an entity belongs to (they are kept by its Stop button)."""
    if entity_id in library.limits:
        return library.limits[entity_id]
    registry = er.async_get(hass)
    entry = registry.async_get(entity_id)
    if entry is None or entry.device_id is None:
        return None
    for other, limits in library.limits.items():
        other_entry = registry.async_get(other)
        if other_entry is not None and other_entry.device_id == entry.device_id:
            return limits
    return None


async def async_stop_entities(hass: HomeAssistant, entity_ids: list[str]) -> None:
    for entity_id in entity_ids:
        try:
            await hass.services.async_call(OGG_DOMAIN, "stop_script", {"entity_id": entity_id}, blocking=True)
        except Exception as err:  # noqa: BLE001 - one device failing must not keep the others running
            _LOGGER.warning("Could not stop %s: %s", entity_id, err)
        if entity_id.startswith("button."):
            try:
                await hass.services.async_call("button", "press", {"entity_id": entity_id}, blocking=True)
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Could not press %s: %s", entity_id, err)


async def async_panic(hass: HomeAssistant) -> int:
    """Stop every Ogg device now. Returns how many devices were told to stop."""
    library = _library(hass)
    if library is not None:
        library.panic()          # cards halt first, so nothing is sent again after the stop
    hass.bus.async_fire("ogg_studio_panic")
    stops = ogg_stop_entities(hass)
    await async_stop_entities(hass, stops)
    return len(stops)


@websocket_api.websocket_command({vol.Required("type"): "ogg/studio/session",
                                  vol.Required("owner"): vol.All(str, vol.Length(min=1, max=80))})
@callback
def ws_session(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Held open by a card; when it ends, what that card was driving stops."""
    owner = msg["owner"]

    @callback
    def end() -> None:
        library = _library(hass)
        if library is None:
            return
        gone = library.release_owner(owner)
        if gone:
            hass.async_create_task(async_stop_entities(hass, gone))

    connection.subscriptions[msg["id"]] = end
    connection.send_result(msg["id"])


async def async_setup_safety(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_session)

    async def on_action(event: Event) -> None:
        if event.data.get("action") == PANIC_ACTION:
            await async_panic(hass)

    hass.bus.async_listen("mobile_app_notification_action", on_action)
