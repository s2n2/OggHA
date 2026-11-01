"""Validate candidate handling without network activity."""

from types import SimpleNamespace

import pytest

from custom_components.ogg.endpoints import endpoint_url, resolve_candidates, validate_config


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("192.168.1.2", "ws://192.168.1.2:12345/"),
        ("192.168.1.2:2345", "ws://192.168.1.2:2345/"),
        ("ws://server.local:12345", "ws://server.local:12345/"),
        ("wss://example.test:8443/control", "wss://example.test:8443/control"),
        ("::1", "ws://[::1]:12345/"),
        ("[2001:db8::1]:2345", "ws://[2001:db8::1]:2345/"),
    ],
)
def test_addresses_normalise(raw, expected):
    assert endpoint_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "unknown",
        "unavailable",
        "192.168.999.1",
        "http://server.local",
        "server name",
        "ws://user:secret@server.local",
        "ws://host/?token=secret",
        "ws://host/#fragment",
        "ws://host:65536",
        "ws://host:0",
        "..",
        "ws://",
    ],
)
def test_invalid_or_secret_bearing_addresses_rejected(raw):
    with pytest.raises(ValueError):
        endpoint_url(raw)


def test_selector_integer_floats_are_normalised():
    config = validate_config(
        {"manual_hosts": ["127.0.0.1"], "port": 12345.0, "scan_interval": 15.0}
    )
    assert config["port"] == 12345
    assert isinstance(config["port"], int)
    assert isinstance(config["scan_interval"], int)


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"manual_hosts": ["192.168.1.1"] * 6},
        {"sensor_entities": [f"sensor.phone_{i}" for i in range(6)]},
        {"sensor_entities": ["person.shane"]},
        {"manual_hosts": ["127.0.0.1"], "port": True},
        {"manual_hosts": ["127.0.0.1"], "scan_interval": 1},
        {"manual_hosts": ["127.0.0.1"], "scan_interval": 15.5},
    ],
)
def test_configuration_rejects_bad_counts_types_and_ranges(data):
    with pytest.raises(ValueError):
        validate_config(data)


def test_five_fixed_and_five_sensor_sources_are_supported_and_deduplicated():
    config = validate_config(
        {
            "manual_hosts": [f"192.168.1.{i}" for i in range(1, 6)],
            "sensor_entities": [f"sensor.phone_{i}" for i in range(5)],
        }
    )
    states = {f"sensor.phone_{i}": SimpleNamespace(state=f"192.168.1.{i + 5}") for i in range(5)}
    candidates = resolve_candidates(config, states)
    assert len(candidates) == 9
    duplicate = next(candidate for candidate in candidates if "192.168.1.5:" in candidate.url)
    assert duplicate.source == "sensor:sensor.phone_0"


def test_sensor_source_identity_survives_dhcp_changes_and_skips_unknown_values():
    config = validate_config({"sensor_entities": ["sensor.phone_ip", "sensor.offline_ip"]})
    states = {
        "sensor.phone_ip": SimpleNamespace(state="192.168.1.10"),
        "sensor.offline_ip": SimpleNamespace(state="unknown"),
    }
    before = resolve_candidates(config, states)
    assert len(before) == 1
    states["sensor.phone_ip"] = SimpleNamespace(state="192.168.1.11")
    after = resolve_candidates(config, states)
    assert before[0].source == after[0].source
    assert before[0].url != after[0].url
