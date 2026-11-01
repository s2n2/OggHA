"""Minimal support diagnostics without names, endpoints, or identifiers."""

from __future__ import annotations

import math
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .coordinator import OggHub
from .patterns import MOTOR_MODES, NATIVE_PATTERNS, SOFTWARE_PATTERNS


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry[OggHub]
) -> dict[str, Any]:
    """Return an explicit allow-list; never include raw configuration or errors."""
    hub = entry.runtime_data
    integration = await async_get_integration(hass, DOMAIN)
    data = {**entry.data, **entry.options}
    devices: list[dict[str, Any]] = []
    patterns = {*SOFTWARE_PATTERNS, *NATIVE_PATTERNS}
    for device in hub.devices.values():
        settings = device.settings
        devices.append(
            {
                "connected": device.connected,
                "running": device.running,
                "vibration_motors": device.motor_count,
                "rotation_features": device.rotation_count,
                "linear_features": device.linear_count,
                "battery_supported": device.battery_supported,
                "classic_native_available": device.native_available,
                "native_failed": device.native_failed,
                "has_error": bool(device.last_error),
                "settings": {
                    "pattern": _enum(settings.get("pattern"), patterns),
                    "motor_mode": _enum(settings.get("motor_mode"), set(MOTOR_MODES)),
                    "native_profile": _enum(
                        settings.get("native_profile"), {"disabled", "classic"}
                    ),
                    "intensity": _number(settings.get("intensity")),
                    "period": _number(settings.get("period")),
                },
            }
        )
    return {
        "integration_version": integration.manifest.get("version"),
        "config_entry_version": entry.version,
        "connection": {
            "enabled": hub.enabled,
            "connected": hub.connected,
            "status": _enum(
                hub.status,
                {
                    "disabled",
                    "searching",
                    "connecting",
                    "connected",
                    "reconnecting",
                    "no_endpoints",
                    "error",
                },
            ),
            "manual_source_count": len(data.get("manual_hosts", [])),
            "sensor_source_count": len(data.get("sensor_entities", [])),
            "has_error": bool(hub.last_error),
        },
        "device_count": len(devices),
        "devices": devices,
    }


def _enum(value: Any, allowed: set[str]) -> str | None:
    return value if isinstance(value, str) and value in allowed else None


def _number(value: Any) -> float | None:
    if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None
