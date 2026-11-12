"""Real Home Assistant setup, config flows, discovery and service dispatch."""

from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ogg.const import DOMAIN

from .conftest import vibration_device

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")


def config(host: str = "192.0.2.10") -> dict:
    return {
        "manual_hosts": [host],
        "sensor_entities": [],
        "port": 12345,
        "ssl": False,
        "scan_interval": 5,
    }


async def setup_entry(hass, host: str = "192.0.2.10") -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Ogg", data=config(host))
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def entity_id(hass, entry, domain: str, key: str, device_key: str | None = None) -> str:
    unique = f"{entry.entry_id}:{key}"
    if device_key is not None:
        unique = f"{entry.entry_id}:{device_key}:{key}"
    result = er.async_get(hass).async_get_entity_id(domain, DOMAIN, unique)
    assert result is not None, (domain, unique)
    return result


async def service(hass, domain: str, name: str, entity: str, **data) -> None:
    await hass.services.async_call(domain, name, {"entity_id": entity, **data}, blocking=True)
    await hass.async_block_till_done()


async def wait_until(predicate, timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.005)


async def test_offline_entry_loads_with_connection_controls_and_no_setup_retry(hass):
    entry = await setup_entry(hass)
    try:
        assert entry.state is ConfigEntryState.LOADED
        hub = entry.runtime_data
        assert not hub.connected
        assert hub._monitor is None
        assert hass.states.get(entity_id(hass, entry, "switch", "enabled")).state == "off"
        assert (
            hass.states.get(entity_id(hass, entry, "sensor", "connection_status")).state
            == "disabled"
        )
        assert hass.states.get(entity_id(hass, entry, "binary_sensor", "connected")).state == "off"
        assert hass.states.get(entity_id(hass, entry, "sensor", "server_ip")).state == "unknown"
        await service(hass, "button", "press", entity_id(hass, entry, "button", "stop_all"))
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "settings",
    [
        {"intensity": 60},
        {"intensity": 60, "pattern": [], "motor_mode": {}, "native_profile": []},
    ],
)
async def test_restored_enabled_entry_loads_while_endpoint_is_offline(
    hass, hass_storage, unused_tcp_port, socket_enabled, settings
):
    host = f"ws://127.0.0.1:{unused_tcp_port}"
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Ogg", data=config(host))
    entry.add_to_hass(hass)
    hass_storage[f"ogg.{entry.entry_id}"] = {
        "version": 1,
        "data": {
            "enabled": True,
            "devices": [
                {
                    "source": f"manual:{host}/",
                    "raw": vibration_device(name="Saved device"),
                    "settings": settings,
                    "running": True,
                }
            ],
        },
    }
    async with asyncio.timeout(2):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    try:
        hub = entry.runtime_data
        assert entry.state is ConfigEntryState.LOADED
        assert hub.enabled
        assert not hub.connected
        assert hub._monitor is not None and not hub._monitor.done()
        assert hass.states.get(entity_id(hass, entry, "switch", "enabled")).state == "on"
        key = next(iter(hub.devices))
        assert hub.devices[key].alias == "Saved device"
        assert not hub.devices[key].running
        assert hub.devices[key].settings["intensity"] == 60
        assert hub.devices[key].settings["pattern"] == "steady"
        assert hub.devices[key].settings["motor_mode"] == "together"
        assert hub.devices[key].settings["native_profile"] == "disabled"
        assert hass.states.get(entity_id(hass, entry, "switch", "run", key)).state == "unavailable"
        await wait_until(lambda: hub.last_error == "No configured server is responding")
        assert entry.state is ConfigEntryState.LOADED
        assert (
            hass.states.get(entity_id(hass, entry, "sensor", "connection_status")).state
            == "searching"
        )
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_config_flow_accepts_all_ten_sources_and_selector_integer_floats(hass):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.FORM
    data = {
        **config(),
        "manual_hosts": [f"192.0.2.{index}" for index in range(1, 6)],
        "sensor_entities": [f"sensor.phone_{index}_ip" for index in range(1, 6)],
    }
    selected = result["data_schema"](data)
    assert isinstance(selected["port"], float)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], selected)
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Ogg"
    assert len(result["data"]["manual_hosts"]) == 5
    assert len(result["data"]["sensor_entities"]) == 5
    assert type(result["data"]["port"]) is int
    assert type(result["data"]["scan_interval"]) is int
    await hass.async_block_till_done()
    entry = result["result"]
    assert entry.state is ConfigEntryState.LOADED
    duplicate = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert duplicate["type"] is FlowResultType.ABORT
    assert duplicate["reason"] == "single_instance_allowed"
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "invalid",
    [
        {"manual_hosts": [f"192.0.2.{index}" for index in range(1, 7)]},
        {"sensor_entities": [f"sensor.phone_{index}_ip" for index in range(1, 7)]},
        {"port": 12345.5},
        {"manual_hosts": ["https://example.invalid"]},
    ],
)
async def test_config_flow_rejects_invalid_limits_and_addresses(hass, invalid):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {**config(), **invalid}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_config"}


async def test_options_can_replace_addresses_without_a_running_server(hass):
    entry = await setup_entry(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.MENU     # Connection, or the studio's privacy
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": "connection"}
    )
    assert result["type"] is FlowResultType.FORM
    changed = {**config(), "manual_hosts": [], "sensor_entities": ["sensor.phone_ip"]}
    selected = result["data_schema"](changed)
    result = await hass.config_entries.options.async_configure(result["flow_id"], selected)
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    try:
        assert entry.options == changed
        assert entry.state is ConfigEntryState.LOADED
        assert entry.runtime_data.config["manual_hosts"] == []
        assert entry.runtime_data.config["sensor_entities"] == ["sensor.phone_ip"]
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_entities_preserve_names_and_dispatch_standard_actions(hass, fake_server):
    entry = await setup_entry(hass, fake_server.url)
    try:
        await service(hass, "switch", "turn_on", entity_id(hass, entry, "switch", "enabled"))
        await fake_server.wait_for("RequestDeviceList", count=2)
        await hass.async_block_till_done()
        hub = entry.runtime_data
        key = next(iter(hub.devices))
        device = hub.devices[key]
        registry_device = next(
            device
            for device in dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
            if (DOMAIN, f"{entry.entry_id}:{key}") in device.identifiers
        )
        assert registry_device.name == "Test device"
        assert registry_device.model == "Test device"
        assert not any(
            name in {"ScalarCmd", "RawWriteCmd", "RotateCmd", "LinearCmd"}
            for name, _ in fake_server.requests
        )
        assert hass.states.get(entity_id(hass, entry, "sensor", "server_ip")).state == "127.0.0.1"
        await service(
            hass,
            "number",
            "set_value",
            entity_id(hass, entry, "number", "intensity", key),
            value=40,
        )
        await service(
            hass,
            "number",
            "set_value",
            entity_id(hass, entry, "number", "motor_level_0", key),
            value=50,
        )
        await service(
            hass,
            "select",
            "select_option",
            entity_id(hass, entry, "select", "pattern", key),
            option="steady",
        )
        assert not any(name == "ScalarCmd" for name, _ in fake_server.requests)
        await service(
            hass,
            "number",
            "set_value",
            entity_id(hass, entry, "number", "pulse_duration"),
            value=0.2,
        )
        await service(hass, "button", "press", entity_id(hass, entry, "button", "pulse", key))
        output = (await fake_server.wait_for("ScalarCmd"))[-1]
        assert output["Scalars"][0]["Scalar"] == pytest.approx(0.2)
        assert output["Scalars"][1]["Scalar"] == pytest.approx(0.4)
        await wait_until(lambda: not device.running)
        await hass.async_block_till_done()
        assert hass.states.get(entity_id(hass, entry, "switch", "run", key)).state == "off"
        assert hass.states.get(entity_id(hass, entry, "sensor", "remaining", key)).state == "0.0"
        await service(hass, "switch", "turn_on", entity_id(hass, entry, "switch", "all_devices"))
        await wait_until(lambda: device.running)
        await service(hass, "button", "press", entity_id(hass, entry, "button", "stop_all"))
        assert not device.running
        assert any(name == "StopAllDevices" for name, _ in fake_server.requests)
        await service(hass, "switch", "turn_off", entity_id(hass, entry, "switch", "enabled"))
        assert entry.state is ConfigEntryState.LOADED
        assert hass.states.get(entity_id(hass, entry, "switch", "run", key)).state == "unavailable"
        assert (
            hass.states.get(entity_id(hass, entry, "binary_sensor", "connected", key)).state
            == "off"
        )
        await service(hass, "button", "press", entity_id(hass, entry, "button", "stop", key))
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_later_capabilities_create_entities_once_and_errors_are_visible(hass, fake_server):
    fake_server.devices[0]["DeviceName"] = "WeVibe Sync"
    entry = await setup_entry(hass, fake_server.url)
    try:
        await service(hass, "switch", "turn_on", entity_id(hass, entry, "switch", "enabled"))
        await fake_server.wait_for("RequestDeviceList", count=2)
        await hass.async_block_till_done()
        hub = entry.runtime_data
        key = next(iter(hub.devices))
        registry = er.async_get(hass)
        assert (
            registry.async_get_entity_id("select", DOMAIN, f"{entry.entry_id}:{key}:native_profile")
            is None
        )
        updated = deepcopy(fake_server.devices[0])
        updated["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
        updated["DeviceMessages"]["SensorReadCmd"] = [
            {"SensorType": "Battery", "SensorRange": [[0, 100]]}
        ]
        fake_server.devices[0] = updated
        await fake_server.push("DeviceAdded", updated)
        await wait_until(lambda: hub.devices[key].native_available)
        await hass.async_block_till_done()
        native_id = entity_id(hass, entry, "select", "native_profile", key)
        battery_id = entity_id(hass, entry, "sensor", "battery", key)
        assert hass.states.get(native_id).state == "disabled"
        assert hass.states.get(battery_id) is not None
        count = len(er.async_entries_for_config_entry(registry, entry.entry_id))
        await fake_server.push("DeviceAdded", updated)
        await asyncio.sleep(0.02)
        await hass.async_block_till_done()
        assert len(er.async_entries_for_config_entry(registry, entry.entry_id)) == count
        await service(hass, "select", "select_option", native_id, option="classic")
        assert hub.devices[key].settings["native_profile"] == "classic"
        fake_server.reject.add("RawWriteCmd")
        await service(hass, "button", "press", entity_id(hass, entry, "button", "pulse", key))
        await fake_server.wait_for("ScalarCmd")
        await hass.async_block_till_done()
        state = hass.states.get(entity_id(hass, entry, "sensor", "status", key))
        assert "software" in state.attributes["last_error"]
        assert hass.states.get(entity_id(hass, entry, "sensor", "engine", key)).state == "fallback"
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)

async def test_device_command_gate_and_shared_pulse_duration(hass, hass_storage):
    """A cached device exposes a persistent command gate and shared global timer."""
    host = "192.0.2.10"
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Ogg", data=config(host))
    entry.add_to_hass(hass)
    hass_storage[f"ogg.{entry.entry_id}"] = {
        "version": 1,
        "data": {
            "enabled": False,
            "devices": [{
                "source": f"manual:{host}/",
                "raw": vibration_device(name="Saved device"),
            }],
        },
    }
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    try:
        hub = entry.runtime_data
        key = next(iter(hub.devices))
        gate = entity_id(hass, entry, "switch", "connect_this_device", key)
        shared = entity_id(hass, entry, "number", "pulse_duration_shared", key)
        original = entity_id(hass, entry, "number", "pulse_duration")
        assert hass.states.get(gate).state == "on"
        await service(hass, "switch", "turn_off", gate)
        assert not hub.devices[key].commands_enabled
        assert hass.states.get(gate).state == "off"
        await service(hass, "number", "set_value", shared, value=5.4)
        assert hub.pulse_duration == 5.4
        assert float(hass.states.get(original).state) == 5.4
        await service(hass, "number", "set_value", original, value=7.0)
        assert float(hass.states.get(shared).state) == 7.0
        assert hub._saved_data()["devices"][0]["commands_enabled"] is False
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)
