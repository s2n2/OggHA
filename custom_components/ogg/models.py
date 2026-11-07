"""Persistent devices, preserving server names and advertised capabilities."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from .patterns import is_classic_candidate
from .protocol import raw_endpoints


def features(messages: dict[str, Any], command: str) -> list[dict[str, Any]]:
    """Read a v3 feature array (and older count-only metadata defensively)."""
    values = messages.get(command, [])
    if isinstance(values, list):
        return [value if isinstance(value, dict) else {} for value in values]
    if isinstance(values, dict):
        count = values.get("FeatureCount", 0)
        if isinstance(count, int) and 0 <= count <= 32:
            return [{} for _ in range(count)]
    return []


def normalise_name(value: Any) -> str:
    """Compare names without changing their display spelling."""
    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


_MAC = re.compile(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\Z")


def physical_address(raw: dict[str, Any]) -> str:
    """Return explicit MAC extension, never guess it from names or indices."""
    value = raw.get("BluetoothAddress")
    if not isinstance(value, str):
        return ""
    value = value.strip().upper().replace("-", ":")
    return value if _MAC.fullmatch(value) else ""


def useful_label(value: Any) -> bool:
    """Prefer a model label over generic vendor descriptors."""
    name = normalise_name(value).replace("-", "").replace(" ", "")
    return bool(name and name not in {"device", "wevibe", "wevibe8bit", "bluetoothdevice"})


def identity_parts(raw: dict[str, Any]) -> tuple[str, str]:
    """Return model and meaningful custom label, independent of routing.

    Standard v3 has no portable physical identifier. Consistent distinct
    display names let users distinguish multiple instances of one model.
    A display name equal to the model is the same as an unset display name.
    """
    model = normalise_name(raw.get("DeviceName"))
    label = normalise_name(raw.get("DeviceDisplayName"))
    return model, label if label != model else ""


def device_key(source: str, raw: dict[str, Any]) -> str:
    """Fingerprint a device independently of server, index and capabilities.

    ``source`` remains in this compatibility signature, but is deliberately not
    part of the fingerprint. Existing devices retain their stored opaque key;
    this helper is only the initial key candidate for a newly seen identity.
    """
    identity = ("bluetooth", physical_address(raw)) if physical_address(raw) else identity_parts(raw)
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]


def legacy_device_key(source: str, raw: dict[str, Any]) -> str:
    """Reconstruct a 0.1.0 key only when an old record did not store one.

    The previous release derived IDs from routing and feature metadata. Keep
    its calculation solely to recover existing HA IDs from a partial cache.
    """
    messages = raw.get("DeviceMessages", {})
    shape = {
        name: [value.get("ActuatorType", "") for value in features(messages, name)]
        for name in ("ScalarCmd", "RotateCmd", "LinearCmd")
    }
    identity = [source, raw.get("DeviceIndex"), raw.get("DeviceName", ""), shape]
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]


def default_settings(motors: int) -> dict[str, Any]:
    """No positive output is sent until an explicit start command."""
    return {
        "intensity": 25.0,
        "period": 2.0,
        "pattern": "steady",
        "motor_mode": "together",
        "native_profile": "disabled",
        "motor_levels": [100.0] * motors,
    }


@dataclass(slots=True)
class OggDevice:
    """One cached device; connection/output state is deliberately not restored."""

    key: str
    alias: str
    source: str
    raw: dict[str, Any]
    settings: dict[str, Any] = field(default_factory=dict)
    connected: bool = False
    commands_enabled: bool = True
    recovering: bool = False
    running: bool = False
    mode: str = "idle"
    engine: str = "software"
    remaining: float | None = None
    battery: float | None = None
    last_error: str | None = None
    aux_values: dict[str, float] = field(default_factory=dict)
    native_failed: bool = False
    native_maybe_active: bool = False
    battery_failed: bool = False
    revision: int = 0
    generation: int = 0
    bindings: dict[str, int] = field(default_factory=dict)
    identity_display_name: str = ""
    motor_level_memory: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        supplied_levels = self.settings.get("motor_levels")
        initial = default_settings(self.motor_count)
        initial.update(self.settings)
        self.settings = initial
        self.motor_level_memory = (
            [_bounded(level, 0, 100, 100) for level in self.motor_level_memory]
            if isinstance(self.motor_level_memory, list)
            else []
        )
        if isinstance(supplied_levels, list):
            self._remember_levels(supplied_levels)
        self._restore_active_levels()
        self.settings["intensity"] = _bounded(self.settings.get("intensity"), 0, 100, 25)
        self.settings["period"] = _bounded(self.settings.get("period"), 0.4, 30, 2)
        self.bindings = (
            {
                source: index
                for source, index in self.bindings.items()
                if isinstance(source, str)
                and isinstance(index, int)
                and not isinstance(index, bool)
                and index >= 0
            }
            if isinstance(self.bindings, dict)
            else {}
        )
        self.bindings[self.source] = self.index
        self.identity_display_name = (
            normalise_name(self.identity_display_name) or identity_parts(self.raw)[1]
        )

    def _remember_levels(self, levels: list[Any]) -> None:
        """Keep settings for motors a different server temporarily omits."""
        for index, level in enumerate(levels):
            number = _bounded(level, 0, 100, 100)
            if index < len(self.motor_level_memory):
                self.motor_level_memory[index] = number
            else:
                self.motor_level_memory.append(number)

    def _restore_active_levels(self) -> None:
        count = self.motor_count
        self.motor_level_memory.extend([100.0] * max(0, count - len(self.motor_level_memory)))
        self.settings["motor_levels"] = self.motor_level_memory[:count]

    def update_binding(self, source: str, raw: dict[str, Any]) -> None:
        """Change the current route while retaining logical identity/settings."""
        self._remember_levels(self.settings["motor_levels"])
        self.source = source
        self.raw = raw
        incoming = str(raw.get("DeviceDisplayName") or raw.get("DeviceName") or "Device")
        if useful_label(incoming) or not useful_label(self.alias):
            self.alias = incoming
        self.bindings[source] = self.index
        if not self.identity_display_name:
            self.identity_display_name = identity_parts(raw)[1]
        self._restore_active_levels()

    @property
    def index(self) -> int:
        return int(self.raw["DeviceIndex"])

    @property
    def messages(self) -> dict[str, Any]:
        return self.raw.get("DeviceMessages", {})

    @property
    def vibration_features(self) -> list[tuple[int, dict[str, Any]]]:
        return [
            (index, feature)
            for index, feature in enumerate(features(self.messages, "ScalarCmd"))
            if feature.get("ActuatorType") == "Vibrate"
        ]

    @property
    def motor_count(self) -> int:
        return len(self.vibration_features)

    @property
    def rotation_count(self) -> int:
        return len(features(self.messages, "RotateCmd"))

    @property
    def linear_count(self) -> int:
        return len(features(self.messages, "LinearCmd"))

    @property
    def native_available(self) -> bool:
        return (
            "tx" in raw_endpoints(self.raw)
            and 1 <= self.motor_count <= 2
            and is_classic_candidate(
                self.raw.get("DeviceName", ""),
                [feature.get("StepCount") for _, feature in self.vibration_features],
            )
        )

    @property
    def battery_sensor(self) -> tuple[int, dict[str, Any]] | None:
        for index, feature in enumerate(features(self.messages, "SensorReadCmd")):
            if feature.get("SensorType") == "Battery":
                return index, feature
        return None

    @property
    def battery_supported(self) -> bool:
        return self.battery_sensor is not None

    @property
    def message_interval(self) -> float:
        gap = self.raw.get("DeviceMessageTimingGap", 0)
        if isinstance(gap, (int, float)) and math.isfinite(gap):
            return max(0.1, min(float(gap) / 1000, 60.0))
        return 0.1

    def stored(self) -> dict[str, Any]:
        """Only local configuration/capabilities, never an active command."""
        self._remember_levels(self.settings["motor_levels"])
        return {
            "key": self.key,
            "alias": self.alias,
            "source": self.source,
            "raw": self.raw,
            "settings": self.settings,
            "commands_enabled": self.commands_enabled,
            "bindings": dict(self.bindings),
            "identity_display_name": self.identity_display_name,
            "motor_level_memory": list(self.motor_level_memory),
        }


def _bounded(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) and minimum <= number <= maximum else default
    except (ValueError, TypeError):
        return default
