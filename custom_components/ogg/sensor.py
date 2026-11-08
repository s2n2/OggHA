"""Connection, execution, and capability-based battery telemetry."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OggHub
from .entity import OggEntity, async_register_device_entities

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(
        OggHubSensor(entry.runtime_data, kind)
        for kind in ("connection_status", "server_ip", "connected_devices")
    )
    async_register_device_entities(entry, async_add_entities, _device_sensors)


def _device_sensors(hub: OggHub, key: str) -> list[OggDeviceSensor]:
    device = hub.devices[key]
    sensors = [OggDeviceSensor(hub, key, "status")]
    if device.motor_count:
        sensors.extend(
            [OggDeviceSensor(hub, key, "engine"), OggDeviceSensor(hub, key, "remaining")]
        )
    if device.battery_supported:
        sensors.append(OggDeviceSensor(hub, key, "battery"))
    return sensors


class OggHubSensor(OggEntity, SensorEntity):
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, hub: OggHub, kind: str) -> None:
        super().__init__(hub, kind, kind)
        self.kind = kind
        self._attr_icon = {
            "connection_status": "mdi:lan-connect",
            "server_ip": "mdi:ip-network-outline",
            "connected_devices": "mdi:devices",
        }[kind]
        if kind == "connection_status":
            self._attr_device_class = SensorDeviceClass.ENUM
            self._attr_options = [
                "disabled",
                "searching",
                "connecting",
                "connected",
                "reconnecting",
                "no_endpoints",
                "error",
            ]

    @property
    def native_value(self) -> str | int | None:
        if self.kind == "connection_status":
            return self.hub.status
        if self.kind == "server_ip":
            return self.hub.server_ip
        return self.hub.connected_count

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.kind == "connection_status" and self.hub.last_error:
            return {"last_error": self.hub.last_error}
        return None


class OggDeviceSensor(OggEntity, SensorEntity):
    """Only Ogg's own execution state is reported; external app state is unknown."""

    def __init__(self, hub: OggHub, key: str, kind: str) -> None:
        super().__init__(hub, kind, kind, key)
        self.kind = kind
        if kind == "remaining":
            self._attr_icon = "mdi:timer-sand"
            self._attr_device_class = SensorDeviceClass.DURATION
            self._attr_native_unit_of_measurement = UnitOfTime.SECONDS
            self._attr_suggested_display_precision = 1
        elif kind == "battery":
            self._attr_device_class = SensorDeviceClass.BATTERY
            self._attr_native_unit_of_measurement = PERCENTAGE
            self._attr_state_class = SensorStateClass.MEASUREMENT
            self._attr_entity_category = EntityCategory.DIAGNOSTIC
        else:
            self._attr_device_class = SensorDeviceClass.ENUM
            self._attr_entity_category = EntityCategory.DIAGNOSTIC
            self._attr_icon = "mdi:information-outline" if kind == "status" else "mdi:chip"
            self._attr_options = (
                ["disconnected", "idle", "continuous", "pulse"]
                if kind == "status"
                else ["software", "native", "fallback"]
            )

    @property
    def available(self) -> bool:
        if self.kind == "battery":
            return self.device_online and self.device.battery_supported
        return True

    @property
    def native_value(self) -> str | float | None:
        if self.kind == "status":
            return self.device.mode if self.device_online else "disconnected"
        if self.kind == "engine":
            return self.device.engine
        if self.kind == "remaining":
            return round(max(0.0, self.device.remaining or 0.0), 1)
        return self.device.battery

    # Live output changes several times a second: keep it out of history.
    _unrecorded_attributes = frozenset({"output", "output_source"})

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.kind != "status":
            return None
        attrs: dict[str, Any] = {}
        if self.device.last_error:
            attrs["last_error"] = self.device.last_error
        if self.device.running and self.device.output_levels:
            attrs["output"] = [round(level * 100) for level in self.device.output_levels]
            attrs["output_source"] = self.device.output_source
        return attrs or None
