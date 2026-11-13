"""The studio's entities: saved scripts, playback speed, and Stop everything.

They sit on an "Ogg Studio" device. The Play card finds them by their unique
ids (``<entry>:studio_saved_script``, ``:studio_speed``, ``:studio_panic``).
"""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo

from ..private import PrivateStateMixin
from .const import LIBRARY, NO_SCRIPT, OGG_DOMAIN, SPEEDS
from .library import Library, script_info
from .safety import async_panic


def _device(entry: ConfigEntry) -> DeviceInfo:
    return DeviceInfo(identifiers={(OGG_DOMAIN, f"{entry.entry_id}_studio")}, name="Ogg Studio",
                      manufacturer="Ogg", model="Play card")


def studio_selects(hass: HomeAssistant, entry: ConfigEntry) -> list[SelectEntity]:
    library: Library | None = hass.data.get(LIBRARY)
    return [] if library is None else [ScriptSelect(entry, library), SpeedSelect(entry, library)]


def studio_buttons(hass: HomeAssistant, entry: ConfigEntry) -> list[ButtonEntity]:
    return [PanicButton(entry)] if hass.data.get(LIBRARY) is not None else []


class _Base(PrivateStateMixin, SelectEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, library: Library, key: str) -> None:
        self.library = library
        self._attr_unique_id = f"{entry.entry_id}:studio_{key}"
        self._attr_translation_key = f"studio_{key}"
        self._attr_device_info = _device(entry)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.library.add_listener(self.async_write_ha_state))


class ScriptSelect(_Base):
    """Saved scripts; the selection is what the studio plays by default."""

    _attr_icon = "mdi:playlist-music"
    # Kept out of the recorder: none of this belongs in the history database.
    _unrecorded_attributes = frozenset({"scripts", "controllers", "limits", "playlists", "panic", "settings", "options"})

    def __init__(self, entry: ConfigEntry, library: Library) -> None:
        super().__init__(entry, library, "saved_script")

    @property
    def options(self) -> list[str]:
        return sorted(self.library.scripts, key=str.casefold) or [NO_SCRIPT]

    @property
    def current_option(self) -> str:
        return self.library.selected or (self.options[0] if self.library.scripts else NO_SCRIPT)

    @property
    def extra_state_attributes(self) -> dict:
        details = {}
        for name, record in self.library.scripts.items():
            details[name] = {**script_info(record["script"]), "saved": record.get("saved"),
                             "mode": record.get("mode")}
        return {"scripts": details, "controllers": self.library.controllers, "limits": self.library.limits,
                "playlists": self.library.playlists, "panic": self.library.panic_at,
                "settings": self.library.settings}

    async def async_select_option(self, option: str) -> None:
        self.library.select(option)


class SpeedSelect(_Base):
    _attr_icon = "mdi:speedometer"
    _attr_options = list(SPEEDS)

    def __init__(self, entry: ConfigEntry, library: Library) -> None:
        super().__init__(entry, library, "speed")

    @property
    def current_option(self) -> str:
        return self.library.speed

    async def async_select_option(self, option: str) -> None:
        self.library.set_speed(option)


class PanicButton(PrivateStateMixin, ButtonEntity):
    """Stop every Ogg device now: for automations, a physical button, a voice assistant."""

    _attr_has_entity_name = True
    _attr_translation_key = "studio_stop_everything"
    _attr_icon = "mdi:stop-circle"

    def __init__(self, entry: ConfigEntry) -> None:
        self._attr_unique_id = f"{entry.entry_id}:studio_panic"
        self._attr_device_info = _device(entry)

    async def async_press(self) -> None:
        await async_panic(self.hass)
