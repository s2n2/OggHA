"""Identity stays attached to hardware across real HA/server reconnections."""

from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest
import pytest_socket
from aiohttp import web
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ogg.const import DOMAIN

from .conftest import FakeServer, vibration_device

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")
ACTUATION_COMMANDS = {"ScalarCmd", "RawWriteCmd", "RotateCmd", "LinearCmd"}


class SwitchableServer(FakeServer):
    """Keep the listener available while refusing new sessions during failover."""

    def __init__(self) -> None:
        super().__init__()
        self.accepting = True

    async def handle(self, request: web.Request) -> web.StreamResponse:
        if not self.accepting:
            return web.Response(status=503)
        return await super().handle(request)

    async def go_offline(self) -> None:
        self.accepting = False
        await self.disconnect()


@pytest.fixture
async def peer_factory(aiohttp_server, socket_enabled):
    pytest_socket.socket_allow_hosts(["127.0.0.1", "127.0.0.2"])
    peers = []

    async def create(devices: list[dict], host: str = "127.0.0.1") -> SwitchableServer:
        peer = SwitchableServer()
        peer.devices = deepcopy(devices)
        app = web.Application()
        app.router.add_get("/", peer.handle)
        listener = await aiohttp_server(app, host=host)
        peer.url = str(listener.make_url("/")).replace("http://", "ws://", 1)
        peers.append(peer)
        return peer

    yield create
    for peer in peers:
        await peer.disconnect()


@pytest.fixture
async def entry_factory(hass):
    entries = []

    async def create(hosts: list[str], sensors: list[str] | None = None) -> MockConfigEntry:
        entry = MockConfigEntry(
            domain=DOMAIN,
            title="Ogg",
            unique_id=DOMAIN,
            data={
                "manual_hosts": hosts,
                "sensor_entities": sensors or [],
                "port": 12345,
                "ssl": False,
                "scan_interval": 5,
            },
        )
        entry.add_to_hass(hass)
        entries.append(entry)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.LOADED
        await entry.runtime_data.async_set_enabled(True)
        return entry

    yield create
    for entry in entries:
        if entry.state is ConfigEntryState.LOADED:
            assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def connected_to(hass, hub, peer: SwitchableServer, count: int = 1) -> None:
    async with asyncio.timeout(4):
        while not (
            hub.connected and hub.server_url == peer.url and hub.connected_count == count
        ):
            await asyncio.sleep(0.005)
    await peer.wait_for("RequestDeviceList")
    await hass.async_block_till_done()


def registry_device(hass, entry, key: str):
    return next(
        device
        for device in dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
        if (DOMAIN, f"{entry.entry_id}:{key}") in device.identifiers
    )


def entity_map(hass, device_id: str) -> dict[str, str]:
    return {
        entity.unique_id: entity.entity_id
        for entity in er.async_entries_for_device(er.async_get(hass), device_id)
    }


def device_entity(hass, entry, key: str, domain: str, suffix: str) -> str:
    result = er.async_get(hass).async_get_entity_id(
        domain, DOMAIN, f"{entry.entry_id}:{key}:{suffix}"
    )
    assert result is not None
    return result


def assert_no_actuation(requests: list[tuple[str, dict]]) -> None:
    assert not any(kind in ACTUATION_COMMANDS for kind, _ in requests)


@pytest.mark.parametrize("initial_source", ["manual", "sensor"])
async def test_same_device_keeps_registry_ids_settings_and_routes_current_index(
    hass, peer_factory, entry_factory, initial_source
):
    """Different IP, configured source, index, reload and return all keep one device."""
    first = await peer_factory([vibration_device(0, "WeVibe Nova")])
    second = await peer_factory([vibration_device(7, "WeVibe Nova")], "127.0.0.2")
    if initial_source == "sensor":
        second.accepting = False
        hass.states.async_set("sensor.ogg_phone_ip", first.url)
        entry = await entry_factory([second.url], ["sensor.ogg_phone_ip"])
    else:
        entry = await entry_factory([first.url, second.url])
    hub = entry.runtime_data
    await connected_to(hass, hub, first)
    assert hub.server_ip == "127.0.0.1"
    key = next(iter(hub.devices))
    original_source = hub.devices[key].source
    original_device = registry_device(hass, entry, key)
    original_entities = entity_map(hass, original_device.id)
    assert original_device.name == "WeVibe Nova"
    assert original_entities
    assert_no_actuation(first.requests)

    await hub.async_set_setting(key, "intensity", 42)
    await hub.async_set_setting(key, "period", 3.5)
    await hub.async_set_setting(key, "motor_levels", [40, 70])
    expected_settings = deepcopy(hub.devices[key].settings)
    await hub.async_start(key)
    assert (await first.wait_for("ScalarCmd"))[-1]["DeviceIndex"] == 0
    await hub.async_stop(key)

    second.accepting = True
    await first.go_offline()
    await connected_to(hass, hub, second)
    assert hub.server_ip == "127.0.0.2"
    assert list(hub.devices) == [key]
    device = hub.devices[key]
    assert device.index == 7
    assert device.source != original_source
    assert not device.running
    assert device.settings == expected_settings
    assert registry_device(hass, entry, key).id == original_device.id
    assert entity_map(hass, original_device.id) == original_entities
    assert_no_actuation(second.requests)
    assert hass.states.get(device_entity(hass, entry, key, "switch", "run")).state == "off"

    await hub.async_start(key)
    output = (await second.wait_for("ScalarCmd"))[-1]
    assert output["DeviceIndex"] == 7
    # Outputs are quantized to the advertised 15 steps; settings retain percentages.
    assert [motor["Scalar"] for motor in output["Scalars"]] == pytest.approx([3 / 15, 4 / 15])
    await hub.async_stop(key)
    after_stop = len(second.requests)
    assert await hass.config_entries.async_reload(entry.entry_id)
    hub = entry.runtime_data
    await connected_to(hass, hub, second)
    assert list(hub.devices) == [key]
    assert hub.devices[key].settings == expected_settings
    assert registry_device(hass, entry, key).id == original_device.id
    assert entity_map(hass, original_device.id) == original_entities
    assert_no_actuation(second.requests[after_stop:])

    first.accepting = True
    first_before_return = len(first.requests)
    await second.go_offline()
    await connected_to(hass, hub, first)
    assert hub.server_ip == "127.0.0.1"
    assert list(hub.devices) == [key]
    assert hub.devices[key].index == 0
    assert hub.devices[key].source == original_source
    assert hub.devices[key].settings == expected_settings
    assert registry_device(hass, entry, key).id == original_device.id
    assert entity_map(hass, original_device.id) == original_entities
    assert_no_actuation(first.requests[first_before_return:])
    previous_outputs = sum(kind == "ScalarCmd" for kind, _ in first.requests)
    await hub.async_start(key)
    assert (await first.wait_for("ScalarCmd", previous_outputs + 1))[-1]["DeviceIndex"] == 0
    await hub.async_stop(key)


async def test_capability_changes_keep_device_and_restore_dormant_motor_settings(
    hass, peer_factory, entry_factory
):
    first = await peer_factory([vibration_device(0, "WeVibe Nova", motors=2)])
    second = await peer_factory([vibration_device(9, "WeVibe Nova", motors=1)], "127.0.0.2")
    entry = await entry_factory([first.url, second.url])
    hub = entry.runtime_data
    await connected_to(hass, hub, first)
    key = next(iter(hub.devices))
    original_device = registry_device(hass, entry, key)
    motor_two = device_entity(hass, entry, key, "number", "motor_level_1")
    await hub.async_set_setting(key, "intensity", 42)
    await hub.async_set_setting(key, "motor_levels", [40, 70])

    await first.go_offline()
    await connected_to(hass, hub, second)
    assert list(hub.devices) == [key]
    assert registry_device(hass, entry, key).id == original_device.id
    assert hub.devices[key].motor_count == 1
    assert hub.devices[key].settings["motor_levels"] == [40]
    assert hass.states.get(motor_two).state == "unavailable"
    assert_no_actuation(second.requests)
    await hub.async_start(key)
    output = (await second.wait_for("ScalarCmd"))[-1]
    assert output["DeviceIndex"] == 9
    assert len(output["Scalars"]) == 1
    assert output["Scalars"][0]["Scalar"] == pytest.approx(3 / 15)
    await hub.async_stop(key)

    first.accepting = True
    await second.go_offline()
    await connected_to(hass, hub, first)
    assert list(hub.devices) == [key]
    assert hub.devices[key].settings["intensity"] == 42
    assert hub.devices[key].settings["motor_levels"] == [40, 70]
    assert device_entity(hass, entry, key, "number", "motor_level_1") == motor_two
    assert hass.states.get(motor_two).state == "70.0"


async def test_same_model_distinct_display_names_remain_separate_across_servers(
    hass, peer_factory, entry_factory
):
    left = {**vibration_device(0, "WeVibe Nova"), "DeviceDisplayName": "Left Nova"}
    right = {**vibration_device(1, "WeVibe Nova"), "DeviceDisplayName": "Right Nova"}
    first = await peer_factory([left, right])
    second = await peer_factory(
        [{**right, "DeviceIndex": 20}, {**left, "DeviceIndex": 4}], "127.0.0.2"
    )
    entry = await entry_factory([first.url, second.url])
    hub = entry.runtime_data
    await connected_to(hass, hub, first, 2)
    keys = {device.alias: key for key, device in hub.devices.items()}
    registry_ids = {name: registry_device(hass, entry, key).id for name, key in keys.items()}
    assert len(keys) == 2
    await hub.async_set_setting(keys["Left Nova"], "intensity", 35)
    await hub.async_set_setting(keys["Right Nova"], "intensity", 65)

    await first.go_offline()
    await connected_to(hass, hub, second, 2)
    assert {device.alias: key for key, device in hub.devices.items()} == keys
    assert {name: registry_device(hass, entry, key).id for name, key in keys.items()} == registry_ids
    assert_no_actuation(second.requests)
    for name, intensity, index, scalar in (
        ("Left Nova", 35, 4, 5 / 15),
        ("Right Nova", 65, 20, 10 / 15),
    ):
        key = keys[name]
        assert hub.devices[key].settings["intensity"] == intensity
        assert hub.devices[key].index == index
        previous_outputs = sum(kind == "ScalarCmd" for kind, _ in second.requests)
        await hub.async_start(key)
        output = (await second.wait_for("ScalarCmd", previous_outputs + 1))[-1]
        assert output["DeviceIndex"] == index
        assert output["Scalars"][0]["Scalar"] == pytest.approx(scalar)
        await hub.async_stop(key)


async def test_two_identical_unnamed_devices_are_not_collapsed_by_a_refresh(
    hass, peer_factory, entry_factory
):
    peer = await peer_factory([vibration_device(0), vibration_device(1)])
    entry = await entry_factory([peer.url])
    hub = entry.runtime_data
    await connected_to(hass, hub, peer, 2)
    keys = {device.index: key for key, device in hub.devices.items()}
    assert len(keys) == 2
    request_count = sum(kind == "RequestDeviceList" for kind, _ in peer.requests)
    await hub.async_rescan()
    await peer.wait_for("RequestDeviceList", request_count + 1)
    await hass.async_block_till_done()
    assert {device.index: key for key, device in hub.devices.items()} == keys
    assert_no_actuation(peer.requests)


async def test_upgrade_merges_legacy_duplicates_before_platforms_load(hass, hass_storage):
    """The real setup path keeps original registry IDs, names and settings."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Ogg",
        unique_id=DOMAIN,
        data={"manual_hosts": ["192.0.2.10"], "sensor_entities": []},
    )
    entry.add_to_hass(hass)
    original_key, duplicate_key = "a" * 24, "b" * 24
    hass_storage[f"ogg.{entry.entry_id}"] = {
        "version": 1,
        "data": {
            "enabled": False,
            "devices": [
                {
                    "key": original_key,
                    "alias": "WeVibe Nova",
                    "source": "manual:ws://192.0.2.10:12345/",
                    "raw": vibration_device(0, "WeVibe Nova"),
                    "settings": {"intensity": 42, "motor_levels": [40, 70]},
                },
                {
                    "key": duplicate_key,
                    "alias": "WeVibe Nova",
                    "source": "manual:ws://192.0.2.11:12345/",
                    "raw": vibration_device(7, "WeVibe Nova"),
                    "settings": {"intensity": 25, "motor_levels": [100, 100]},
                },
            ],
        },
    }
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)
    original = device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, f"{entry.entry_id}:{original_key}")},
        name="WeVibe Nova",
    )
    original = device_registry.async_update_device(original.id, name_by_user="My Nova")
    duplicate = device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, f"{entry.entry_id}:{duplicate_key}")},
        name="WeVibe Nova",
    )
    original_entity = entity_registry.async_get_or_create(
        "number",
        DOMAIN,
        f"{entry.entry_id}:{original_key}:intensity",
        config_entry=entry,
        device_id=original.id,
        suggested_object_id="original_nova_intensity",
    )
    duplicate_entity = entity_registry.async_get_or_create(
        "number",
        DOMAIN,
        f"{entry.entry_id}:{duplicate_key}:intensity",
        config_entry=entry,
        device_id=duplicate.id,
        suggested_object_id="duplicate_nova_intensity",
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    try:
        hub = entry.runtime_data
        assert list(hub.devices) == [original_key]
        assert not hub.enabled
        assert hub.devices[original_key].settings["intensity"] == 42
        assert hub.devices[original_key].settings["motor_levels"] == [40, 70]
        assert registry_device(hass, entry, original_key).id == original.id
        assert device_registry.async_get(original.id).name_by_user == "My Nova"
        assert device_registry.async_get(duplicate.id) is None
        assert entity_registry.async_get(original_entity.entity_id).device_id == original.id
        assert entity_registry.async_get(duplicate_entity.entity_id) is None
        assert (
            device_entity(hass, entry, original_key, "number", "intensity")
            == original_entity.entity_id
        )
        assert hass.states.get(original_entity.entity_id).state == "42.0"
        saved = hass_storage[f"ogg.{entry.entry_id}"]["data"]
        assert [record["key"] for record in saved["devices"]] == [original_key]
        assert saved["identity_aliases"] == {duplicate_key: original_key}
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert list(entry.runtime_data.devices) == [original_key]
        assert registry_device(hass, entry, original_key).id == original.id
        assert device_registry.async_get(original.id).name_by_user == "My Nova"
        assert device_registry.async_get(duplicate.id) is None
        assert entity_registry.async_get(duplicate_entity.entity_id) is None
        assert (
            device_entity(hass, entry, original_key, "number", "intensity")
            == original_entity.entity_id
        )
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)
