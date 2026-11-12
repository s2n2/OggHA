"""Privacy: no history, a discreet card, who may use it, and a PIN.

* **No history.** Home Assistant has no way to exclude entities from the
  recorder at run time, so OggStudio removes what the recorder kept about
  every Ogg and OggStudio entity: at start, then every half hour
  (``recorder.purge_entities`` with ``keep_days: 0``). The logbook reads from
  the same database. For nothing to be written at all, exclude them in
  ``configuration.yaml`` (see the README).
* **Allowed users.** When set, OggStudio's services and websocket commands
  refuse other signed-in users, and the cards hide for them. Calls with no
  user (automations) are allowed. Stopping is always allowed.
* **PIN.** Kept salted and hashed (PBKDF2). Cards ask for it before they
  open; it is checked here, never in the browser. It locks the cards, not
  Home Assistant: someone signed in can still reach Ogg's own entities.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from datetime import timedelta
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_time_interval

from .const import LIBRARY, OGG_DOMAIN

_LOGGER = logging.getLogger(__name__)

PURGE_EVERY = timedelta(minutes=30)
PIN_ROUNDS = 120_000
PIN_TRIES = 5            # wrong PINs before a pause
PIN_PAUSE = 60           # s
FAILS = "ogg_studio_pin_fails"
DEFAULTS = {"no_history": True, "discreet": False, "discreet_name": "Studio", "users": [], "auto_lock": 15}
# Ogg options that belong to the studio (changing them does not reconnect Ogg).
STUDIO_OPTIONS = (*DEFAULTS, "pin_hash", "pin_salt", "studio_taken")


def hash_pin(pin: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PIN_ROUNDS)
    return digest.hex(), salt


def check_pin(pin: str, digest: str, salt: str) -> bool:
    return hmac.compare_digest(hash_pin(pin, salt)[0], digest)


def option(entry: ConfigEntry | None, key: str) -> Any:
    return (entry.options if entry else {}).get(key, DEFAULTS.get(key))


def _entry(hass: HomeAssistant) -> ConfigEntry | None:
    for entry in hass.config_entries.async_entries(OGG_DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry
    return None


def card_settings(entry: ConfigEntry) -> dict[str, Any]:
    """What the cards need to know (never the PIN)."""
    return {
        "discreet": bool(option(entry, "discreet")),
        "name": str(option(entry, "discreet_name") or "Studio")[:40],
        "users": list(option(entry, "users") or []),
        "pin": bool(entry.options.get("pin_hash")),
        "auto_lock": int(option(entry, "auto_lock") or 0),
    }


def user_allowed(hass: HomeAssistant, user_id: str | None) -> bool:
    users = option(_entry(hass), "users") or []
    return not users or user_id is None or user_id in users


def require_user(hass: HomeAssistant, user_id: str | None) -> None:
    if not user_allowed(hass, user_id):
        raise Unauthorized()


def private_entities(hass: HomeAssistant) -> list[str]:
    registry = er.async_get(hass)
    return sorted(e.entity_id for e in registry.entities.values() if e.platform == OGG_DOMAIN)


async def async_purge(hass: HomeAssistant) -> int:
    """Remove what the recorder kept about Ogg and OggStudio entities."""
    entities = private_entities(hass)
    if not entities or not hass.services.has_service("recorder", "purge_entities"):
        return 0
    try:
        await hass.services.async_call(
            "recorder", "purge_entities", {"entity_id": entities, "keep_days": 0}, blocking=True)
    except Exception as err:  # noqa: BLE001 - privacy housekeeping must never break the integration
        _LOGGER.warning("Could not clear the history of Ogg entities: %s", err)
        return 0
    return len(entities)


@callback
def async_setup_privacy_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Start (or not) the history clearing for this entry; follow option changes."""
    state: dict[str, Any] = {"stop": None}

    async def purge(_now: Any = None) -> None:
        if option(entry, "no_history"):
            await async_purge(hass)

    @callback
    def apply() -> None:
        if state["stop"]:
            state["stop"]()
            state["stop"] = None
        library = hass.data.get(LIBRARY)
        if library is not None:
            library.set_settings(card_settings(entry))
        if not option(entry, "no_history"):
            return
        state["stop"] = async_track_time_interval(hass, purge, PURGE_EVERY)
        if hass.state is CoreState.running:
            hass.async_create_task(purge())

    async def changed(_hass: HomeAssistant, _entry_: ConfigEntry) -> None:
        apply()

    @callback
    def unload() -> None:
        if state["stop"]:
            state["stop"]()

    if hass.state is not CoreState.running:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, purge)
    entry.async_on_unload(entry.add_update_listener(changed))
    entry.async_on_unload(unload)
    apply()


@websocket_api.websocket_command({vol.Required("type"): "ogg/studio/unlock",
                                  vol.Required("pin"): vol.All(str, vol.Length(min=1, max=64))})
@websocket_api.async_response
async def ws_unlock(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Check the PIN for a card. A few wrong tries pause that user for a minute."""
    entry = _entry(hass)
    user_id = connection.user.id if connection.user else ""
    if not user_allowed(hass, user_id):
        connection.send_error(msg["id"], "unauthorized", "Not allowed")
        return
    if entry is None or not entry.options.get("pin_hash"):
        connection.send_result(msg["id"], {"ok": True})
        return
    fails = hass.data.setdefault(FAILS, {})
    count, until = fails.get(user_id, (0, 0.0))
    now = time.monotonic()
    if until > now:
        connection.send_result(msg["id"], {"ok": False, "wait": int(until - now) + 1})
        return
    ok = await hass.async_add_executor_job(check_pin, msg["pin"], entry.options["pin_hash"], entry.options["pin_salt"])
    if ok:
        fails.pop(user_id, None)
        connection.send_result(msg["id"], {"ok": True})
        return
    count += 1
    pause = count % PIN_TRIES == 0
    fails[user_id] = (count, now + PIN_PAUSE if pause else 0.0)
    connection.send_result(msg["id"], {"ok": False, "wait": PIN_PAUSE if pause else 0})


async def async_setup_privacy(hass: HomeAssistant) -> None:
    hass.data["ogg_studio_allow"] = lambda user_id: user_allowed(hass, user_id)
    websocket_api.async_register_command(hass, ws_unlock)
