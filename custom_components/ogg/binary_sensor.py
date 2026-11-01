"""Connection sensors remain available while endpoints or devices are offline."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OggHub
from .entity import OggEntity, async_register_device_entities

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([OggConnectedSensor(entry.runtime_data)])
    async_register_device_entities(
        entry, async_add_entities, lambda hub, key: [OggConnectedSensor(hub, key)]
    )


class OggConnectedSensor(OggEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, hub: OggHub, key: str | None = None) -> None:
        super().__init__(hub, "connected", "connected", key)

    @property
    def is_on(self) -> bool:
        if self.device_key is None:
            return self.hub.connected
        return self.device_online
