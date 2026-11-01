"""Persistent devices, preserving server names and advertised capabilities."""

from __future__ import annotations

import hashlib
import json
import math
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


def device_key(source: str, raw: dict[str, Any]) -> str:
    """Scope a v3 index to its configured server source and capability shape.

    Protocol v3 has no portable physical identifier. Including source, name,
    index and feature shape prevents conflating differently named devices or
    matching indices on unrelated servers. This is not claimed as a MAC ID.
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

    def __post_init__(self) -> None:
        initial = default_settings(self.motor_count)
        initial.update(self.settings)
        self.settings = initial
        levels = self.settings.get("motor_levels", [])
        self.settings["motor_levels"] = (
            [
                _bounded(levels[index], 0, 100, 100) if index < len(levels) else 100.0
                for index in range(self.motor_count)
            ]
            if isinstance(levels, list)
            else [100.0] * self.motor_count
        )
        self.settings["intensity"] = _bounded(self.settings.get("intensity"), 0, 100, 25)
        self.settings["period"] = _bounded(self.settings.get("period"), 0.4, 30, 2)

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
        return {
            "key": self.key,
            "alias": self.alias,
            "source": self.source,
            "raw": self.raw,
            "settings": self.settings,
        }


def _bounded(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) and minimum <= number <= maximum else default
    except (ValueError, TypeError):
        return default
