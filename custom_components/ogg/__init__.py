"""Ogg: a local controller whose connection state never gates entry setup."""

from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, PLATFORMS
from .coordinator import OggHub
from .studio import async_setup_studio, async_setup_studio_entry, async_unload_studio_entry
from .studio.privacy import STUDIO_OPTIONS

HOLD_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("motor"): vol.All(vol.Coerce(int), vol.Range(min=1, max=2)),
        vol.Optional("seconds", default=1.0): vol.All(vol.Coerce(float), vol.Range(min=0.3, max=3.0)),
    }
)
LIVE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("levels"): vol.All(
            [vol.All(vol.Coerce(float), vol.Range(min=0, max=1))], vol.Length(min=1, max=2)
        ),
        vol.Optional("seconds", default=1.0): vol.All(vol.Coerce(float), vol.Range(min=0.3, max=3.0)),
    }
)
PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("script"): dict,
        vol.Optional("speed", default=1.0): vol.All(vol.Coerce(float), vol.Range(min=0.25, max=4.0)),
        vol.Optional("loop", default=False): cv.boolean,
    }
)
LINEAR_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("position"): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Required("duration"): vol.All(vol.Coerce(int), vol.Range(min=20, max=10000)),
        vol.Optional("index", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=7)),
    }
)
STOP_SCHEMA = vol.Schema({vol.Required("entity_id"): cv.entity_id})
from .dashboard_resource import async_register_control_deck

type OggConfigEntry = ConfigEntry[OggHub]

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the bundled Control Deck once, without gating the Ogg engine."""
    try:
        await async_register_control_deck(hass)
    except Exception:  # noqa: BLE001 - optional frontend must not break BLE control
        _LOGGER.exception("Could not register Ogg Control Deck; Ogg will remain available")
    # The Play card's side (was the OggStudio integration): services, links.
    # Like the cards, it must never keep Ogg's device control from starting.
    try:
        await async_setup_studio(hass)
    except Exception:  # noqa: BLE001
        _LOGGER.exception("Could not set up Ogg Studio; Ogg will remain available")

    async def async_hold(call: ServiceCall) -> None:
        """Hold-to-run for one device (any of its entities identifies it)."""
        registry = er.async_get(hass)
        entry = registry.async_get(call.data["entity_id"])
        if entry is None or entry.platform != DOMAIN or entry.config_entry_id is None:
            raise HomeAssistantError("Choose an Ogg device entity")
        config_entry = hass.config_entries.async_get_entry(entry.config_entry_id)
        hub = getattr(config_entry, "runtime_data", None)
        parts = str(entry.unique_id).split(":")
        if not isinstance(hub, OggHub) or len(parts) < 3:
            raise HomeAssistantError("Choose an Ogg device entity")
        key = parts[1]
        motor = call.data.get("motor")
        motors = frozenset({motor - 1}) if motor else None
        await hub.async_hold(key, call.data["seconds"], motors)

    hass.services.async_register(DOMAIN, "hold", async_hold, schema=HOLD_SCHEMA)

    def _hub_and_key(entity_id: str) -> tuple[OggHub, str]:
        registry = er.async_get(hass)
        entry = registry.async_get(entity_id)
        if entry is None or entry.platform != DOMAIN or entry.config_entry_id is None:
            raise HomeAssistantError("Choose an Ogg device entity")
        config_entry = hass.config_entries.async_get_entry(entry.config_entry_id)
        hub = getattr(config_entry, "runtime_data", None)
        parts = str(entry.unique_id).split(":")
        if not isinstance(hub, OggHub) or len(parts) < 3:
            raise HomeAssistantError("Choose an Ogg device entity")
        return hub, parts[1]

    async def async_live(call: ServiceCall) -> None:
        hub, key = _hub_and_key(call.data["entity_id"])
        await hub.async_live(key, call.data["levels"], call.data["seconds"])

    async def async_linear(call: ServiceCall) -> None:
        hub, key = _hub_and_key(call.data["entity_id"])
        await hub.async_linear(
            key, call.data["position"], call.data["duration"], call.data["index"]
        )

    async def async_play_script(call: ServiceCall) -> None:
        hub, key = _hub_and_key(call.data["entity_id"])
        await hub.async_play_script(key, call.data["script"], call.data["speed"], call.data["loop"])

    async def async_stop_script(call: ServiceCall) -> None:
        hub, key = _hub_and_key(call.data["entity_id"])
        await hub.async_stop(key)

    hass.services.async_register(DOMAIN, "live", async_live, schema=LIVE_SCHEMA)
    hass.services.async_register(DOMAIN, "linear", async_linear, schema=LINEAR_SCHEMA)
    hass.services.async_register(DOMAIN, "play_script", async_play_script, schema=PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, "stop_script", async_stop_script, schema=STOP_SCHEMA)
    return True



async def async_setup_entry(hass: HomeAssistant, entry: OggConfigEntry) -> bool:
    """Create entities from local state, then connect in the background.

    An unreachable server is an ordinary runtime state. There is deliberately
    no connection attempt and no ConfigEntryNotReady path in entry setup.
    """
    # A HACS integration reload does not call async_setup again. Refresh the
    # bundled Lovelace resource here as well, without allowing frontend issues
    # to affect the running controller. Registration itself is idempotent.
    try:
        await async_register_control_deck(hass)
    except Exception:  # noqa: BLE001
        _LOGGER.exception("Could not refresh Ogg Control Deck resource")
    registry = er.async_get(hass)
    for stale in er.async_entries_for_config_entry(registry, entry.entry_id):
        if stale.platform == DOMAIN and stale.unique_id.endswith((":pulse_in", ":pulse_out")):
            registry.async_remove(stale.entity_id)
    hub = OggHub(hass, entry)
    entry.runtime_data = hub
    try:
        await hub.async_initialize()
        await async_setup_studio_entry(hass, entry)
        hass.data.setdefault(CONNECTION_SNAPSHOT, {})[entry.entry_id] = _connection(entry)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

        async def async_stop(_event: Event) -> None:
            await hub.async_shutdown()

        entry.async_on_unload(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, async_stop))
        entry.async_on_unload(entry.add_update_listener(_async_update_options))
        hub.start()
    except BaseException:
        # Also clean up if Home Assistant cancels setup during shutdown.
        await hub.async_shutdown()
        raise
    return True


CONNECTION_SNAPSHOT = "ogg_connection_snapshot"


def _connection(entry: ConfigEntry) -> dict:
    """The settings that need a reconnect (not the studio's privacy settings)."""
    return {k: v for k, v in {**entry.data, **entry.options}.items() if k not in STUDIO_OPTIONS}


async def _async_update_options(hass: HomeAssistant, entry: OggConfigEntry) -> None:
    """Apply edited connection sources through a full clean reload.

    Studio settings (privacy, PIN) apply on their own, without reconnecting.
    """
    if hass.data.get(CONNECTION_SNAPSHOT, {}).get(entry.entry_id) == _connection(entry):
        return
    await hass.config_entries.async_reload(entry.entry_id)


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: OggConfigEntry, device_entry: dr.DeviceEntry
) -> bool:
    """Let users delete a stale Ogg device (e.g. a leftover duplicate).

    Only an offline device can be removed; a live one would be recreated by
    the next device list anyway. The hub device itself is never removable.
    """
    hub = entry.runtime_data
    return await hub.async_remove_device(device_entry.identifiers)


async def async_unload_entry(hass: HomeAssistant, entry: OggConfigEntry) -> bool:
    """Cancel output, stop devices and release background work before entities."""
    await entry.runtime_data.async_shutdown()
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        async_unload_studio_entry(hass)
    return ok
