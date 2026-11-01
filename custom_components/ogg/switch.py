"""Master connection and continuous-run switches."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OggHub
from .entity import OggEntity, async_register_device_entities

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up switches even when no endpoint is online."""
    hub: OggHub = entry.runtime_data
    async_add_entities([OggEnabledSwitch(hub), OggAllSwitch(hub)])
    async_register_device_entities(
        entry,
        async_add_entities,
        lambda hub, key: [OggRunSwitch(hub, key)] if hub.devices[key].motor_count else [],
    )


class OggEnabledSwitch(OggEntity, SwitchEntity):
    """Enable connection management without starting any device."""

    _attr_icon = "mdi:power"

    def __init__(self, hub: OggHub) -> None:
        super().__init__(hub, "enabled", "enabled")

    @property
    def is_on(self) -> bool:
        return self.hub.enabled

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.hub.async_set_enabled(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.hub.async_set_enabled(False)


class OggAllSwitch(OggEntity, SwitchEntity):
    """Run all available devices or stop all, including partial activity."""

    _attr_icon = "mdi:play-network-outline"

    def __init__(self, hub: OggHub) -> None:
        super().__init__(hub, "all_devices", "all_devices")

    @property
    def is_on(self) -> bool:
        # Any activity must leave an obvious off control on the dashboard.
        return any(device.running for device in self.hub.devices.values())

    @property
    def extra_state_attributes(self) -> dict[str, int]:
        return {
            "running_devices": sum(d.running for d in self.hub.devices.values()),
            "connected_devices": self.hub.connected_count,
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.hub.async_all_start()

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.hub.async_all_stop()


class OggRunSwitch(OggEntity, SwitchEntity):
    """Run one device using its selected pattern and settings."""

    _attr_icon = "mdi:play-circle-outline"

    def __init__(self, hub: OggHub, device_key: str) -> None:
        super().__init__(hub, "run", "run", device_key)

    @property
    def available(self) -> bool:
        return self.device_online

    @property
    def is_on(self) -> bool:
        return self.device.running

    async def async_turn_on(self, **kwargs: Any) -> None:
        assert self.device_key is not None
        await self.hub.async_start(self.device_key)

    async def async_turn_off(self, **kwargs: Any) -> None:
        assert self.device_key is not None
        await self.hub.async_stop(self.device_key)
