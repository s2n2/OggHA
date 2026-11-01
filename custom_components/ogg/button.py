"""One-shot pulses, stop controls, and explicit discovery."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OggHub
from .entity import OggEntity, async_register_device_entities

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    hub: OggHub = entry.runtime_data
    async_add_entities(OggButton(hub, action) for action in ("pulse_all", "stop_all", "search_now"))
    async_register_device_entities(entry, async_add_entities, _device_buttons)


def _device_buttons(hub: OggHub, key: str) -> list[OggButton]:
    buttons = [OggButton(hub, "stop", key)]
    if hub.devices[key].motor_count:
        buttons.append(OggButton(hub, "pulse", key))
    return buttons


class OggButton(OggEntity, ButtonEntity):
    """A stateless action routed through the controller's serialised methods."""

    def __init__(self, hub: OggHub, action: str, device_key: str | None = None) -> None:
        super().__init__(hub, action, action, device_key)
        self.action = action
        self._attr_icon = {
            "pulse_all": "mdi:timer-play-outline",
            "pulse": "mdi:timer-play-outline",
            "stop_all": "mdi:stop-circle-outline",
            "stop": "mdi:stop-circle-outline",
            "search_now": "mdi:magnify",
        }[action]

    @property
    def available(self) -> bool:
        if self.action == "pulse":
            return self.device_online and self.device.motor_count > 0
        if self.action == "pulse_all":
            return self.hub.enabled and self.hub.connected
        # Stop actions also clear local state offline; search can be requested
        # while disabled without enabling or starting the devices.
        return True

    async def async_press(self) -> None:
        if self.action == "pulse_all":
            await self.hub.async_all_start(pulse=True)
        elif self.action == "stop_all":
            await self.hub.async_all_stop()
        elif self.action == "search_now":
            await self.hub.async_rescan()
        elif self.action == "pulse":
            assert self.device_key is not None
            await self.hub.async_start(self.device_key, pulse=True)
        else:
            assert self.device_key is not None
            await self.hub.async_stop(self.device_key)
