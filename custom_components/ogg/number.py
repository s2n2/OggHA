"""Intensity, timing, per-motor, and capability-based motion controls."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OggHub
from .entity import OggEntity, async_register_device_entities

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([OggPulseDuration(entry.runtime_data)])
    async_register_device_entities(entry, async_add_entities, _device_numbers)


def _device_numbers(hub: OggHub, key: str) -> list[OggEntity]:
    device = hub.devices[key]
    entities: list[OggEntity] = [OggDevicePulseDuration(hub, key)]
    if device.motor_count:
        entities.extend(
            [OggSettingNumber(hub, key, "intensity"), OggSettingNumber(hub, key, "period")]
        )
    if device.motor_count > 1:
        entities.extend(OggMotorNumber(hub, key, index) for index in range(device.motor_count))
    entities.extend(
        OggMotionNumber(hub, key, "rotate", index) for index in range(device.rotation_count)
    )
    entities.extend(
        OggMotionNumber(hub, key, "linear", index) for index in range(device.linear_count)
    )
    return entities


class OggPulseDuration(OggEntity, NumberEntity):
    _attr_icon = "mdi:timer-outline"
    _attr_native_min_value = 0.1
    _attr_native_max_value = 300.0
    _attr_native_step = 0.1
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS
    _attr_mode = NumberMode.SLIDER

    def __init__(self, hub: OggHub) -> None:
        super().__init__(hub, "pulse_duration", "pulse_duration")

    @property
    def native_value(self) -> float:
        return self.hub.pulse_duration

    async def async_set_native_value(self, value: float) -> None:
        await self.hub.async_set_pulse_duration(value)


class OggDevicePulseDuration(OggPulseDuration):
    """Device-page control for the same global timer; not a device override."""

    def __init__(self, hub: OggHub, device_key: str) -> None:
        OggEntity.__init__(self, hub, "pulse_duration_shared", "pulse_duration_shared", device_key)


class OggSettingNumber(OggEntity, NumberEntity):
    _attr_mode = NumberMode.SLIDER

    def __init__(self, hub: OggHub, key: str, setting: str) -> None:
        super().__init__(hub, setting, setting, key)
        self.setting = setting
        if setting == "intensity":
            self._attr_icon = "mdi:tune-vertical"
            self._attr_native_min_value = 0
            self._attr_native_max_value = 100
            self._attr_native_step = 1
            self._attr_native_unit_of_measurement = PERCENTAGE
        else:
            self._attr_icon = "mdi:metronome"
            self._attr_native_min_value = 0.4
            self._attr_native_max_value = 30
            self._attr_native_step = 0.1
            self._attr_native_unit_of_measurement = UnitOfTime.SECONDS

    @property
    def available(self) -> bool:
        return self.device.motor_count > 0

    @property
    def native_value(self) -> float:
        return float(self.device.settings[self.setting])

    async def async_set_native_value(self, value: float) -> None:
        assert self.device_key is not None
        await self.hub.async_set_setting(self.device_key, self.setting, value)


class OggMotorNumber(OggEntity, NumberEntity):
    _attr_icon = "mdi:tune-vertical-variant"
    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.SLIDER

    def __init__(self, hub: OggHub, key: str, index: int) -> None:
        super().__init__(hub, f"motor_level_{index}", "motor_level", key)
        self.index = index
        self._attr_translation_placeholders = {"motor": str(index + 1)}

    @property
    def available(self) -> bool:
        return self.index < self.device.motor_count

    @property
    def native_value(self) -> float | None:
        if not self.available:
            return None
        return float(self.device.settings["motor_levels"][self.index])

    async def async_set_native_value(self, value: float) -> None:
        assert self.device_key is not None
        if not self.available:
            raise HomeAssistantError("This server does not expose that motor")
        levels = list(self.device.settings["motor_levels"])
        levels[self.index] = value
        await self.hub.async_set_setting(self.device_key, "motor_levels", levels)


class OggMotionNumber(OggEntity, NumberEntity):
    """Deliberate manual control for separately advertised motion actuators."""

    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.SLIDER

    def __init__(self, hub: OggHub, key: str, kind: str, index: int) -> None:
        super().__init__(hub, f"{kind}_{index}", kind, key)
        self.kind = kind
        self.index = index
        self._attr_native_min_value = -100 if kind == "rotate" else 0
        self._attr_icon = "mdi:rotate-360" if kind == "rotate" else "mdi:arrow-expand-vertical"
        self._attr_translation_placeholders = {"motor": str(index + 1)}

    @property
    def available(self) -> bool:
        count = self.device.rotation_count if self.kind == "rotate" else self.device.linear_count
        return self.device_online and self.index < count

    @property
    def native_value(self) -> float | None:
        if not self.available:
            return None
        return self.device.aux_values.get(f"{self.kind}_{self.index}", 0.0)

    async def async_set_native_value(self, value: float) -> None:
        assert self.device_key is not None
        await self.hub.async_set_aux(self.device_key, self.kind, self.index, value)
