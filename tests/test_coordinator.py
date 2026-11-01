"""Lifecycle and race regressions through real Home Assistant config entries."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable

import pytest
from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ogg.diagnostics import async_get_config_entry_diagnostics

from .conftest import FakeServer, vibration_device


async def until(predicate: Callable[[], bool], timeout: float = 2) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.005)


@pytest.fixture
async def hub_factory(hass, enable_custom_integrations):
    entries = []

    async def create(server: FakeServer, config: dict | None = None):
        entry = MockConfigEntry(
            domain="ogg",
            title="Ogg",
            unique_id="ogg",
            data=config or {"manual_hosts": [server.url]},
        )
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        entries.append(entry)
        assert entry.state is ConfigEntryState.LOADED
        hub = entry.runtime_data
        await hub.async_set_enabled(True)
        await until(lambda: hub.connected and hub.connected_count > 0)
        await server.wait_for("StartScanning")
        return hub

    yield create
    for entry in entries:
        if entry.state is ConfigEntryState.LOADED:
            await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def test_pulse_stops_after_duration_and_repeated_press_replaces_timer(
    fake_server, hub_factory
):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    device = hub.devices[key]
    await hub.async_set_pulse_duration(0.3)
    await hub.async_start(key, pulse=True)
    await fake_server.wait_for("ScalarCmd")
    first_task = hub._runs[key]
    await asyncio.sleep(0.15)
    await hub.async_start(key, pulse=True)
    assert first_task.done()
    assert len(hub._runs) == 1
    await asyncio.sleep(0.18)
    assert device.running
    await until(lambda: not device.running)
    assert device.mode == "idle"
    assert not hub._runs
    assert fake_server.requests[-1][0] == "StopDeviceCmd"


async def test_pulse_deadline_stops_even_when_output_acknowledgement_is_missing(
    fake_server, hub_factory
):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    fake_server.withhold.add("ScalarCmd")
    await hub.async_set_pulse_duration(0.1)
    await hub.async_start(key, pulse=True)
    await fake_server.wait_for("ScalarCmd")
    # One stop precedes a new run. The second must arrive near the pulse
    # deadline, rather than after the connection's normal five-second timeout.
    await fake_server.wait_for("StopDeviceCmd", count=2, timeout=0.7)
    await until(lambda: not hub.devices[key].running)
    assert hub.connected


async def test_all_off_during_start_cannot_launch_a_late_runner(
    fake_server, hub_factory, monkeypatch
):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    entered = asyncio.Event()
    release = asyncio.Event()
    original = hub._client.stop_device
    calls = 0

    async def block_first_stop(index):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await release.wait()
        await original(index)

    monkeypatch.setattr(hub._client, "stop_device", block_first_stop)
    starting = asyncio.create_task(hub.async_start(key))
    await asyncio.wait_for(entered.wait(), 1)
    stopping = asyncio.create_task(hub.async_all_stop())
    await asyncio.sleep(0)
    release.set()
    await asyncio.wait_for(asyncio.gather(starting, stopping), 1)
    assert not hub.devices[key].running
    assert not hub._runs
    assert not any(name == "ScalarCmd" for name, _ in fake_server.requests)
    assert any(name == "StopAllDevices" for name, _ in fake_server.requests)


async def test_disconnect_reconnect_preserves_settings_without_resuming_output(
    fake_server, hub_factory
):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_setting(key, "intensity", 42)
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    await fake_server.disconnect()
    await fake_server.wait_for("RequestServerInfo", count=2)
    await until(
        lambda: hub.connected and hub.devices[key].connected and not hub.devices[key].running
    )
    count_after_reconnect = sum(name == "ScalarCmd" for name, _ in fake_server.requests)
    await asyncio.sleep(0.15)
    assert sum(name == "ScalarCmd" for name, _ in fake_server.requests) == count_after_reconnect
    assert hub.devices[key].settings["intensity"] == 42
    assert not hub._runs


async def test_unreachable_first_candidate_fails_over_to_next(
    fake_server, hub_factory, unused_tcp_port
):
    hub = await hub_factory(
        fake_server,
        {
            "manual_hosts": [f"ws://127.0.0.1:{unused_tcp_port}/", fake_server.url],
        },
    )
    assert hub.connected
    assert hub.server_url == fake_server.url
    assert hub.entry.state is ConfigEntryState.LOADED


async def test_removed_device_cleanup_cannot_stop_reused_index(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    old_key = next(iter(hub.devices))
    await hub.async_start(old_key)
    await fake_server.wait_for("ScalarCmd")
    replacement = vibration_device(0, "Replacement device")
    fake_server.devices = [replacement]
    await fake_server.push("DeviceRemoved", {"DeviceIndex": 0})
    await fake_server.push("DeviceAdded", replacement)
    await until(lambda: len(hub.devices) == 2)
    new_key = next(key for key in hub.devices if key != old_key)
    await hub.async_start(new_key)
    await fake_server.wait_for("ScalarCmd", count=2)
    marker = len(fake_server.requests)
    await asyncio.sleep(0.15)
    assert not hub.devices[old_key].connected
    assert hub.devices[new_key].running
    assert not any(name == "StopDeviceCmd" for name, _ in fake_server.requests[marker:])


@pytest.mark.parametrize(("new_index", "motors"), [(7, 2), (0, 1)])
async def test_live_route_or_capability_change_stops_old_runner_without_resuming(
    fake_server, hub_factory, new_index, motors
):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    device = hub.devices[key]
    fake_server.withhold.add("ScalarCmd")
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    old_runner = hub._runs[key]
    fake_server.devices = [vibration_device(new_index, motors=motors)]
    await fake_server.push("DeviceList", {"Devices": fake_server.devices})
    stops = await fake_server.wait_for("StopDeviceCmd", count=2)
    await until(lambda: old_runner.done() and not device.recovering)
    assert list(hub.devices) == [key]
    assert device.index == new_index
    assert device.motor_count == motors
    assert stops[-1]["DeviceIndex"] == new_index
    assert not device.running
    assert not hub._runs
    await asyncio.sleep(0.15)
    assert sum(kind == "ScalarCmd" for kind, _ in fake_server.requests) == 1

    fake_server.withhold.clear()
    await hub.async_start(key)
    output = (await fake_server.wait_for("ScalarCmd", count=2))[-1]
    assert output["DeviceIndex"] == new_index
    assert len(output["Scalars"]) == motors


async def test_sensor_ip_change_reconnects_with_same_device_identity(
    hass, fake_server, hub_factory, aiohttp_server
):
    from aiohttp import web

    second = FakeServer()
    app = web.Application()
    app.router.add_get("/", second.handle)
    runner = await aiohttp_server(app)
    second.url = str(runner.make_url("/")).replace("http://", "ws://", 1)
    hass.states.async_set("sensor.phone_ip", fake_server.url)
    hub = await hub_factory(fake_server, {"sensor_entities": ["sensor.phone_ip"]})
    key = next(iter(hub.devices))
    await hub.async_set_setting(key, "intensity", 37)
    try:
        hass.states.async_set("sensor.phone_ip", second.url)
        await second.wait_for("RequestServerInfo")
        await until(lambda: hub.connected and hub.server_url == second.url)
        assert list(hub.devices) == [key]
        assert hub.devices[key].settings["intensity"] == 37
        assert not hub.devices[key].running
    finally:
        await hub.async_set_enabled(False)
        await second.disconnect()


async def test_native_cancel_sends_zero_packet_even_before_initial_ack(fake_server, hub_factory):
    fake_server.devices = [vibration_device(0, "WeVibe Nova")]
    fake_server.devices[0]["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_setting(key, "native_profile", "classic")
    await hub.async_set_setting(key, "pattern", "pulse")
    fake_server.withhold_native_start = True
    await hub.async_start(key)
    await fake_server.wait_for("RawWriteCmd")
    await asyncio.wait_for(hub.async_stop(key), 1)
    raw_packets = [body["Data"] for name, body in fake_server.requests if name == "RawWriteCmd"]
    assert raw_packets[0][1] == 5
    assert raw_packets[-1] == [15, 0, 0, 0, 0, 0, 0, 0]
    assert not hub.devices[key].running


async def test_explicit_native_stop_acknowledgement_cannot_clear_rebound_recovery(
    fake_server, hub_factory
):
    fake_server.devices = [vibration_device(0, "WeVibe Nova")]
    fake_server.devices[0]["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    device = hub.devices[key]
    # An unresolved firmware pattern can outlive its local runner. Exercise
    # the explicit-stop path, independently of the runner's own final stop.
    device.native_maybe_active = True
    fake_server.withhold.add("RawWriteCmd")
    stopping = asyncio.create_task(hub.async_stop(key))
    try:
        old_stop = (await fake_server.wait_for("RawWriteCmd"))[0]
        assert old_stop["DeviceIndex"] == 0
        moved = vibration_device(7, "WeVibe Nova")
        moved["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
        fake_server.devices = [moved]
        await fake_server.push("DeviceList", {"Devices": [moved]})
        await until(lambda: device.index == 7 and device.recovering)
        assert not stopping.done()

        # Acknowledge the old index only after the binding has changed. That
        # completion must not claim that firmware on the new route was stopped.
        fake_server.withhold.remove("RawWriteCmd")
        await fake_server.clients[-1].send_json([{"Ok": {"Id": old_stop["Id"]}}])
        await asyncio.wait_for(stopping, 1)
        stops = await fake_server.wait_for("RawWriteCmd", count=2)
        await until(lambda: not device.recovering and not device.native_maybe_active)
        assert [body["DeviceIndex"] for body in stops] == [0, 7]
        assert all(body["Data"] == [15, 0, 0, 0, 0, 0, 0, 0] for body in stops)
        assert list(hub.devices) == [key]
        assert not device.running
        assert not hub._runs
        assert hub.connected
    finally:
        fake_server.withhold.discard("RawWriteCmd")
        if not stopping.done():
            stopping.cancel()
        await asyncio.gather(stopping, return_exceptions=True)


async def test_native_explicit_rejection_falls_back_to_standard_output(fake_server, hub_factory):
    fake_server.devices = [vibration_device(0, "WeVibe Nova")]
    fake_server.devices[0]["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    fake_server.reject.add("RawWriteCmd")
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_setting(key, "native_profile", "classic")
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    await until(lambda: hub.devices[key].engine == "fallback")
    assert hub.devices[key].engine == "fallback"
    assert hub.connected
    assert hub.devices[key].running
    await hub.async_stop(key)


@pytest.mark.parametrize("late_discovery", [False, True], ids=["initial_list", "late_device_added"])
async def test_native_reconnect_sends_explicit_off_before_new_user_output(
    fake_server, hub_factory, late_discovery
):
    fake_server.devices = [vibration_device(0, "WeVibe Nova")]
    fake_server.devices[0]["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    device = hub.devices[key]
    await hub.async_set_setting(key, "native_profile", "classic")
    await hub.async_set_setting(key, "pattern", "pulse")
    await hub.async_start(key)
    await until(lambda: device.engine == "native" and device.native_maybe_active)

    # Native writes can bypass a server's scalar cache. On a new session,
    # merely marking this device idle cannot establish that firmware stopped.
    original_device = fake_server.devices[0]
    if late_discovery:
        fake_server.devices = []
    await fake_server.clients[-1].close()
    await fake_server.wait_for("RequestServerInfo", count=2)
    new_session = [
        index for index, (name, _) in enumerate(fake_server.requests) if name == "RequestServerInfo"
    ][1]
    if late_discovery:
        # A restarted server can finish its handshake before Bluetooth finds
        # the device. Ensure both initial enumeration and its first scan/list
        # cycle see an empty snapshot, then deliver the normal hotplug event.
        await until(
            lambda: (
                hub.connected
                and sum(
                    name == "RequestDeviceList" for name, _ in fake_server.requests[new_session:]
                )
                >= 2
            )
        )
        assert not device.connected
        assert device.native_maybe_active
        fake_server.devices = [original_device]
        await fake_server.push("DeviceAdded", original_device)
    off_packet = [15, 0, 0, 0, 0, 0, 0, 0]
    await until(
        lambda: any(
            name == "RawWriteCmd" and body["Data"] == off_packet
            for name, body in fake_server.requests[new_session:]
        )
    )
    await until(lambda: hub.connected and device.connected and not device.native_maybe_active)
    assert not device.running
    assert all(
        body["Data"] == off_packet
        for name, body in fake_server.requests[new_session:]
        if name == "RawWriteCmd"
    )

    # Recovery does not replay the old run, and an explicit later start still
    # works after the stop is acknowledged.
    marker = len(fake_server.requests)
    await hub.async_start(key)
    await until(
        lambda: any(
            name == "RawWriteCmd" and body["Data"][1] == 5 and body["Data"][5] > 0
            for name, body in fake_server.requests[marker:]
        )
    )
    assert device.running
    await hub.async_stop(key)


async def test_rotation_change_preserves_other_motor_value(fake_server, hub_factory):
    fake_server.devices[0]["DeviceMessages"]["RotateCmd"] = [
        {"FeatureDescriptor": "Rotation 1", "StepCount": 100},
        {"FeatureDescriptor": "Rotation 2", "StepCount": 100},
    ]
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_aux(key, "rotate", 0, 30)
    await hub.async_set_aux(key, "rotate", 1, -50)
    commands = await fake_server.wait_for("RotateCmd", count=2)
    assert commands[-1]["Rotations"] == [
        {"Index": 0, "Speed": 0.3, "Clockwise": True},
        {"Index": 1, "Speed": 0.5, "Clockwise": False},
    ]
    await hub.async_all_stop()
    assert all(
        value == 0
        for name, value in hub.devices[key].aux_values.items()
        if name.startswith("rotate_")
    )
    assert not hub.devices[key].running


async def test_concurrent_shutdown_calls_wait_for_same_complete_teardown(
    fake_server, hub_factory, monkeypatch
):
    hub = await hub_factory(fake_server)
    entered = asyncio.Event()
    release = asyncio.Event()
    original = hub.async_all_stop

    async def delayed_stop():
        entered.set()
        await release.wait()
        await original()

    monkeypatch.setattr(hub, "async_all_stop", delayed_stop)
    first = asyncio.create_task(hub.async_shutdown())
    await asyncio.wait_for(entered.wait(), 1)
    second = asyncio.create_task(hub.async_shutdown())
    await asyncio.sleep(0)
    assert not second.done()
    release.set()
    await asyncio.wait_for(asyncio.gather(first, second), 2)
    assert not hub.connected
    assert not hub._runs
    assert not hub._event_tasks


async def test_diagnostics_exclude_names_addresses_and_sensor_identifiers(
    hass, fake_server, hub_factory
):
    fake_server.devices[0]["DeviceName"] = "PRIVATE_DEVICE_NAME"
    hass.states.async_set("sensor.private_phone_ip", fake_server.url)
    hub = await hub_factory(fake_server, {"sensor_entities": ["sensor.private_phone_ip"]})
    result = await async_get_config_entry_diagnostics(hass, hub.entry)
    text = json.dumps(result)
    assert "PRIVATE_DEVICE_NAME" not in text
    assert "private_phone_ip" not in text
    assert fake_server.url not in text
    assert "127.0.0.1" not in text
