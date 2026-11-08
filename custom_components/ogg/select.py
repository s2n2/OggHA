"""Pattern, motor routing, and explicitly confirmed native mode selectors."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import CONNECT_FEEDBACK_OPTIONS, OggHub
from .entity import OggEntity, async_register_device_entities
from .patterns import DUAL_PATTERNS, NATIVE_PATTERNS, RANDOM_PATTERN, SOFTWARE_PATTERNS

PARALLEL_UPDATES = 0

PATTERN_OPTIONS = list(dict.fromkeys([*SOFTWARE_PATTERNS, *NATIVE_PATTERNS, RANDOM_PATTERN]))
# Two-motor devices get the two-motor set instead of the single-motor list.
DUAL_PATTERN_OPTIONS = [*DUAL_PATTERNS, RANDOM_PATTERN]
MOTOR_OPTIONS = ["together", "alternating", "motor_1", "motor_2"]


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([OggConnectFeedback(entry.runtime_data)])
    async_register_device_entities(entry, async_add_entities, _device_selects)


class OggConnectFeedback(OggEntity, SelectEntity):
    """Whether devices give a very short buzz when they (re)connect."""

    _attr_icon = "mdi:vibrate"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_options = list(CONNECT_FEEDBACK_OPTIONS)

    def __init__(self, hub: OggHub) -> None:
        super().__init__(hub, "connect_feedback", "connect_feedback")

    @property
    def available(self) -> bool:
        return True

    @property
    def current_option(self) -> str:
        return self.hub.connect_feedback

    async def async_select_option(self, option: str) -> None:
        await self.hub.async_set_connect_feedback(option)


def _device_selects(hub: OggHub, key: str) -> list[OggSelect]:
    device = hub.devices[key]
    if not device.motor_count:
        return []
    options = DUAL_PATTERN_OPTIONS if device.motor_count > 1 else PATTERN_OPTIONS
    entities = [OggSelect(hub, key, "pattern", options)]
    if device.motor_count > 1:
        entities.append(OggSelect(hub, key, "motor_mode", MOTOR_OPTIONS))
    if device.native_available:
        entities.append(OggSelect(hub, key, "native_profile", ["disabled", "classic"]))
    return entities


class OggSelect(OggEntity, SelectEntity):
    """Persist a setting without starting an idle device."""

    def __init__(self, hub: OggHub, key: str, setting: str, options: list[str]) -> None:
        super().__init__(hub, setting, setting, key)
        self.setting = setting
        self._attr_options = list(options)
        self._attr_icon = {
            "pattern": "mdi:waveform",
            "motor_mode": "mdi:tune-variant",
            "native_profile": "mdi:chip",
        }[setting]
        if setting == "native_profile":
            self._attr_entity_category = EntityCategory.CONFIG

    @property
    def available(self) -> bool:
        if self.setting == "motor_mode":
            return self.device.motor_count > 1
        if self.setting == "pattern":
            return self.device.motor_count > 0
        return True

    @property
    def current_option(self) -> str:
        return str(self.device.settings[self.setting])

    async def async_select_option(self, option: str) -> None:
        assert self.device_key is not None
        await self.hub.async_set_setting(self.device_key, self.setting, option)
