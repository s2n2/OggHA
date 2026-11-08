"""Validate configured server locations without probing the network."""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .const import DEFAULT_PORT, DEFAULT_SCAN_INTERVAL

_HOST = re.compile(r"(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\Z")
_SENSOR = re.compile(r"sensor\.[a-z0-9_]+\Z")
_UNAVAILABLE = {"", "unknown", "unavailable", "none", "null"}


@dataclass(frozen=True, slots=True)
class Candidate:
    """A configured location and its stable source identity."""

    source: str
    url: str


def endpoint_url(raw: str, port: int = DEFAULT_PORT, ssl: bool = False) -> str:
    """Accept an IP, host, host:port or ws(s) URL; never guess a subnet.

    Bare IPv6 is supported. Credentials and URL query strings are deliberately
    not accepted: configuration should contain addresses, not secrets.
    """
    if not isinstance(raw, str) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("Invalid server address or port")
    value = raw.strip()
    if value.lower() in _UNAVAILABLE or any(c.isspace() for c in value):
        raise ValueError("Invalid server address")
    if any(c in value for c in ("\\", "%")):
        raise ValueError("Invalid server address")
    scheme = "wss" if ssl else "ws"
    if "://" not in value:
        try:
            literal = ipaddress.ip_address(value)
        except ValueError:
            pass
        else:
            value = f"[{literal}]" if literal.version == 6 else str(literal)
        value = f"{scheme}://{value}"
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        selected_port = parsed.port if parsed.port is not None else port
    except ValueError as err:
        raise ValueError("Invalid server address") from err
    if (
        parsed.scheme not in {"ws", "wss"}
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not 1 <= selected_port <= 65535
    ):
        raise ValueError("Use an address or a ws/wss URL without credentials")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        if not _HOST.fullmatch(host) or ".." in host or re.fullmatch(r"[0-9.]+", host):
            raise ValueError("Invalid IP address or hostname") from None
        host = host.lower()
    else:
        host = f"[{literal}]" if literal.version == 6 else str(literal)
    return urlunsplit((parsed.scheme, f"{host}:{selected_port}", parsed.path or "/", "", ""))


def validate_config(data: dict[str, Any]) -> dict[str, Any]:
    """Return a small, normalised configuration; never require an online server."""
    manual = data.get("manual_hosts") or []
    sensors = data.get("sensor_entities") or []
    if not isinstance(manual, list) or not isinstance(sensors, list):
        raise ValueError("Server locations must be lists")
    if len(manual) > 5 or len(sensors) > 5:
        raise ValueError("Use at most five manual addresses and five sensors")
    if any(not isinstance(item, str) for item in [*manual, *sensors]):
        raise ValueError("Invalid server location")
    manual = list(dict.fromkeys(item.strip() for item in manual if item.strip()))
    sensors = list(dict.fromkeys(sensors))
    port = data.get("port", DEFAULT_PORT)
    interval = data.get("scan_interval", DEFAULT_SCAN_INTERVAL)
    secure = data.get("ssl", False)
    if (
        isinstance(port, bool)
        or not isinstance(port, (int, float))
        or not 1 <= port <= 65535
        or int(port) != port
    ):
        raise ValueError("Port must be between 1 and 65535")
    if (
        isinstance(interval, bool)
        or not isinstance(interval, (int, float))
        or not 5 <= interval <= 120
        or int(interval) != interval
    ):
        raise ValueError("Search interval must be between 5 and 120 seconds")
    if not isinstance(secure, bool):
        raise ValueError("Invalid secure connection setting")
    port, interval = int(port), int(interval)
    for value in manual:
        endpoint_url(value, port, secure)
    if any(not _SENSOR.fullmatch(value) for value in sensors):
        raise ValueError("Choose sensor entities containing an address in their state")
    if not manual and not sensors:
        raise ValueError("Configure at least one address or sensor")
    multi = data.get("multi_server", False)
    if not isinstance(multi, bool):
        raise ValueError("Invalid two-server setting")
    return {
        "manual_hosts": manual,
        "sensor_entities": sensors,
        "port": port,
        "ssl": secure,
        "scan_interval": interval,
        "multi_server": multi,
    }


def resolve_candidates(config: dict[str, Any], states: Any) -> list[Candidate]:
    """Read current sensor states, ignoring invalid/offline sensors.

    ``states`` is HA's StateMachine or a mapping with a compatible ``get``.
    A sensor's identity survives DHCP changes. Prefer that identity when the
    same address is also listed manually, while preserving manual priority.
    """
    port = config.get("port", DEFAULT_PORT)
    secure = config.get("ssl", False)
    sensor_candidates: dict[str, Candidate] = {}
    for entity_id in config.get("sensor_entities", []):
        state = states.get(entity_id)
        value = getattr(state, "state", state)
        try:
            url = endpoint_url(value, port, secure)
        except (TypeError, ValueError):
            continue
        sensor_candidates.setdefault(url, Candidate(f"sensor:{entity_id}", url))
    candidates: dict[str, Candidate] = {}
    for value in config.get("manual_hosts", []):
        try:
            url = endpoint_url(value, port, secure)
        except (TypeError, ValueError):
            continue
        candidates.setdefault(url, sensor_candidates.get(url, Candidate(f"manual:{url}", url)))
    for url, candidate in sensor_candidates.items():
        candidates.setdefault(url, candidate)
    return list(candidates.values())
