"""Ogg: a local controller whose connection state never gates entry setup."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import PLATFORMS
from .coordinator import OggHub
from .dashboard_resource import async_register_control_deck

type OggConfigEntry = ConfigEntry[OggHub]

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the bundled Control Deck once, without gating the Ogg engine."""
    try:
        await async_register_control_deck(hass)
    except Exception:  # noqa: BLE001 - optional frontend must not break BLE control
        _LOGGER.exception("Could not register Ogg Control Deck; Ogg will remain available")
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
    hub = OggHub(hass, entry)
    entry.runtime_data = hub
    try:
        await hub.async_initialize()
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


async def _async_update_options(hass: HomeAssistant, entry: OggConfigEntry) -> None:
    """Apply the edited connection sources through a full clean reload."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: OggConfigEntry) -> bool:
    """Cancel output, stop devices and release background work before entities."""
    await entry.runtime_data.async_shutdown()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
