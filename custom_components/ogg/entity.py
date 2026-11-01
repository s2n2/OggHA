"""Shared entity identity and discovery for Ogg."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import TYPE_CHECKING

from homeassistant.core import callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity import DeviceInfo, Entity

from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .coordinator import OggHub
    from .models import OggDevice


class OggEntity(Entity):
    """An entity with stable identity and the user's actual device name."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self,
        hub: OggHub,
        key: str,
        translation_key: str,
        device_key: str | None = None,
    ) -> None:
        self.hub = hub
        self.device_key = device_key
        self._attr_translation_key = translation_key
        scope = hub.entry.entry_id
        if device_key is not None:
            scope = f"{scope}:{device_key}"
        self._attr_unique_id = f"{scope}:{key}"

        if device_key is None:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, hub.entry.entry_id)},
                name="Ogg",
                manufacturer="Ogg",
                model="Local controller",
            )
        else:
            # Newer HA versions scope devices to config entries and link them
            # by registry ID. Keep the older field only on versions that still
            # require it, and create the parent before cached child entities.
            if "via_device_id" in DeviceInfo.__annotations__:
                parent = dr.async_get(hub.hass).async_get_or_create(
                    config_entry_id=hub.entry.entry_id,
                    identifiers={(DOMAIN, hub.entry.entry_id)},
                    name="Ogg",
                    manufacturer="Ogg",
                    model="Local controller",
                )
                parent_link = {"via_device_id": parent.id}
            else:
                parent_link = {"via_device": (DOMAIN, hub.entry.entry_id)}
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, scope)},
                name=hub.devices[device_key].alias,
                manufacturer="Ogg",
                model=hub.devices[device_key].raw.get("DeviceName", "Local device"),
                **parent_link,
            )

    @property
    def device(self) -> OggDevice:
        """Resolve the current device record after a reconnect."""
        assert self.device_key is not None
        return self.hub.devices[self.device_key]

    @property
    def device_online(self) -> bool:
        """Whether a command can currently reach this device."""
        return (
            self.hub.enabled
            and self.hub.connected
            and self.device_key in self.hub.devices
            and self.device.connected
            and not self.device.recovering
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe after HA has attached the entity."""
        await super().async_added_to_hass()
        self.async_on_remove(self.hub.async_add_listener(self._handle_update))

    @callback
    def _handle_update(self) -> None:
        """Push an update without polling or doing IO in properties."""
        self.async_write_ha_state()


@callback
def async_register_device_entities(
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
    factory: Callable[[OggHub, str], Iterable[OggEntity]],
) -> None:
    """Add persisted and later-discovered entities once per stable unique ID.

    Re-evaluating capabilities also permits a newly advertised battery or motor
    to appear after a reconnect without reloading the integration.
    """
    hub: OggHub = entry.runtime_data
    known: set[str] = set()
    signatures: dict[str, tuple[int, int, int, bool, bool]] = {}

    @callback
    def discover() -> None:
        additions: list[OggEntity] = []
        for key in tuple(hub.devices):
            device = hub.devices[key]
            signature = (
                device.motor_count,
                device.rotation_count,
                device.linear_count,
                device.battery_supported,
                device.native_available,
            )
            if signatures.get(key) == signature:
                continue
            signatures[key] = signature
            for entity in factory(hub, key):
                assert entity.unique_id is not None
                if entity.unique_id not in known:
                    known.add(entity.unique_id)
                    additions.append(entity)
        if additions:
            async_add_entities(additions)

    entry.async_on_unload(hub.async_add_listener(discover))
    discover()
