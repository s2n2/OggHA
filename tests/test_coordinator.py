"""Lifecycle and race regressions through real Home Assistant config entries."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
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
        await server.wait_for("RequestDeviceList")
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


async def test_disconnect_reconnect_resumes_run_only_after_new_stop(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_setting(key, "intensity", 42)
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    await fake_server.disconnect()
    await fake_server.wait_for("RequestServerInfo", count=2)
    await until(lambda: hub.connected and hub.devices[key].connected and hub.devices[key].running)
    marker = [i for i, (name, _) in enumerate(fake_server.requests) if name == "RequestServerInfo"][1]
    await until(lambda: any(name == "ScalarCmd" for name, _ in fake_server.requests[marker:]))
    names = [name for name, _ in fake_server.requests[marker:]]
    assert names.index("StopDeviceCmd") < names.index("ScalarCmd")
    assert hub.devices[key].settings["intensity"] == 42
    await hub.async_stop(key)


async def test_device_reappearance_resumes_only_remaining_pulse(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_pulse_duration(0.75)
    await hub.async_start(key, pulse=True)
    await fake_server.wait_for("ScalarCmd")
    first_deadline = hub._desired_outputs[key].deadline
    previously_sent = sum(name == "ScalarCmd" for name, _ in fake_server.requests)
    saved_device = fake_server.devices[0]
    fake_server.devices = []
    await fake_server.push("DeviceRemoved", {"DeviceIndex": 0})
    await until(lambda: not hub.devices[key].connected)
    await asyncio.sleep(0.12)
    fake_server.devices = [saved_device]
    await fake_server.push("DeviceAdded", saved_device)
    await until(lambda: hub.devices[key].running)
    assert hub._desired_outputs[key].deadline == first_deadline
    await fake_server.wait_for("ScalarCmd", count=previously_sent + 1)
    await until(lambda: not hub.devices[key].running, timeout=2)
    assert key not in hub._desired_outputs


async def test_expired_pulse_never_resumes_after_reappearance(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_pulse_duration(0.15)
    await hub.async_start(key, pulse=True)
    await fake_server.wait_for("ScalarCmd")
    saved_device = fake_server.devices[0]
    fake_server.devices = []
    await fake_server.push("DeviceRemoved", {"DeviceIndex": 0})
    await until(lambda: not hub.devices[key].connected)
    await asyncio.sleep(0.25)
    count = sum(name == "ScalarCmd" for name, _ in fake_server.requests)
    fake_server.devices = [saved_device]
    await fake_server.push("DeviceAdded", saved_device)
    await until(lambda: hub.devices[key].connected and not hub.devices[key].recovering)
    await asyncio.sleep(0.1)
    assert sum(name == "ScalarCmd" for name, _ in fake_server.requests) == count
    assert key not in hub._desired_outputs


async def test_stop_while_disconnected_cancels_pending_resume(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    saved_device = fake_server.devices[0]
    fake_server.devices = []
    await fake_server.push("DeviceRemoved", {"DeviceIndex": 0})
    await until(lambda: not hub.devices[key].connected)
    await hub.async_stop(key)
    assert key not in hub._desired_outputs
    marker = len(fake_server.requests)
    fake_server.devices = [saved_device]
    await fake_server.push("DeviceAdded", saved_device)
    await until(lambda: hub.devices[key].connected and not hub.devices[key].recovering)
    await asyncio.sleep(0.1)
    assert not any(name == "ScalarCmd" for name, _ in fake_server.requests[marker:])


async def test_long_disconnection_never_resumes_run(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    saved_device = fake_server.devices[0]
    fake_server.devices = []
    await fake_server.push("DeviceRemoved", {"DeviceIndex": 0})
    await until(lambda: not hub.devices[key].connected)
    hub._desired_outputs[key].lost_at -= 31  # emulate 31 seconds elapsed
    marker = len(fake_server.requests)
    fake_server.devices = [saved_device]
    await fake_server.push("DeviceAdded", saved_device)
    await until(lambda: hub.devices[key].connected and not hub.devices[key].recovering)
    await asyncio.sleep(0.1)
    assert key not in hub._desired_outputs
    assert not any(name == "ScalarCmd" for name, _ in fake_server.requests[marker:])


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
async def test_live_route_or_capability_change_verifies_stop_then_resumes(
    fake_server, hub_factory, new_index, motors
):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    device = hub.devices[key]
    fake_server.withhold.add("ScalarCmd")
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd")
    old_runner = hub._runs[key]
    fake_server.withhold.clear()
    marker = len(fake_server.requests)
    fake_server.devices = [vibration_device(new_index, motors=motors)]
    await fake_server.push("DeviceList", {"Devices": fake_server.devices})
    await until(lambda: old_runner.done() and not device.recovering)
    await until(
        lambda: any(name == "ScalarCmd" for name, _ in fake_server.requests[marker:])
    )
    assert list(hub.devices) == [key]
    assert device.index == new_index
    assert device.motor_count == motors
    names = [name for name, _ in fake_server.requests[marker:]]
    assert names.index("StopDeviceCmd") < names.index("ScalarCmd")
    output = next(body for name, body in fake_server.requests[marker:] if name == "ScalarCmd")
    assert output["DeviceIndex"] == new_index
    assert len(output["Scalars"]) == motors
    assert device.running
    await hub.async_stop(key)


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
    # Native recovery must first send the vendor zero packet, followed by
    # standard StopDeviceCmd. Only after both are acknowledged may Ogg resume.
    await until(
        lambda: any(
            name == "RawWriteCmd" and body["Data"][1] == 5 and body["Data"][5] > 0
            for name, body in fake_server.requests[new_session:]
        )
    )
    new_commands = fake_server.requests[new_session:]
    off_at = next(
        i for i, (name, body) in enumerate(new_commands)
        if name == "RawWriteCmd" and body["Data"] == off_packet
    )
    stop_at = next(
        i for i, (name, _) in enumerate(new_commands)
        if i > off_at and name == "StopDeviceCmd"
    )
    run_at = next(
        i for i, (name, body) in enumerate(new_commands)
        if name == "RawWriteCmd" and body["Data"][1] == 5 and body["Data"][5] > 0
    )
    assert off_at < stop_at < run_at
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


async def test_unready_device_stop_does_not_disconnect_server(fake_server, hub_factory):
    """IntiHA may expose a known BLE device before its stop path is ready.

    Server connection must remain usable, but device controls remain blocked
    until StopDeviceCmd succeeds on a subsequent scan.
    """
    fake_server.reject.add("StopDeviceCmd")
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    assert hub.connected
    assert hub.devices[key].recovering
    assert hub.devices[key].last_error is not None

    fake_server.reject.discard("StopDeviceCmd")
    hub._wake.set()
    await until(lambda: hub.connected and not hub.devices[key].recovering, timeout=3)
    assert len([name for name, _ in fake_server.requests if name == "RequestServerInfo"]) == 1
    assert len([name for name, _ in fake_server.requests if name == "StopDeviceCmd"]) >= 2


async def test_pulse_redundant_stops_at_three_checkpoints(fake_server, hub_factory, monkeypatch):
    """A successful server ACK does not suppress pulse STOP redundancy."""
    from custom_components.ogg import coordinator

    # Short timings exercise the same sequence without a ten-second CI wait.
    monkeypatch.setattr(coordinator, "PULSE_STOP_BACKUP_DELAYS", (.02, .04, .06, .08, .10))
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_pulse_duration(.08)
    stop_baseline = sum(name == "StopDeviceCmd" for name, _ in fake_server.requests)
    await hub.async_start(key, pulse=True)
    await fake_server.wait_for("ScalarCmd")
    await until(lambda: not hub.devices[key].running)
    # STOP before starting, STOP on expiry, and five follow-ups.
    await until(
        lambda: sum(name == "StopDeviceCmd" for name, _ in fake_server.requests)
        >= stop_baseline + 7
    )
    await until(lambda: not hub._stop_backups)
    stops = [body for name, body in fake_server.requests if name == "StopDeviceCmd"]
    assert len(stops) == stop_baseline + 7
    assert not hub.devices[key].running


async def test_late_pulse_stops_cannot_interrupt_new_run(fake_server, hub_factory, monkeypatch):
    """A new command supersedes the pulse STOP watchdog, not vice versa."""
    from custom_components.ogg import coordinator

    monkeypatch.setattr(coordinator, "PULSE_STOP_BACKUP_DELAYS", (.04, .08, .12, .16, .20))
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_pulse_duration(.08)
    await hub.async_start(key, pulse=True)
    await fake_server.wait_for("ScalarCmd")
    await until(lambda: not hub.devices[key].running)
    # Wait for the first of five backups before beginning the new run.
    await until(lambda: len([x for x in fake_server.requests if x[0] == "StopDeviceCmd"]) >= 3)
    previous_scalars = sum(name == "ScalarCmd" for name, _ in fake_server.requests)
    await hub.async_start(key)
    await fake_server.wait_for("ScalarCmd", count=previous_scalars + 1)
    since_restart = len(fake_server.requests)
    await asyncio.sleep(.25)
    assert hub.devices[key].running
    assert not any(name == "StopDeviceCmd" for name, _ in fake_server.requests[since_restart:])
    await hub.async_stop(key)


async def test_native_pulse_backups_repeat_zero_packet(fake_server, hub_factory, monkeypatch):
    """Native firmware patterns need repeated native zero AND standard stop."""
    from custom_components.ogg import coordinator

    monkeypatch.setattr(coordinator, "PULSE_STOP_BACKUP_DELAYS", (.02, .04, .06, .08, .10))
    fake_server.devices = [vibration_device(0, "WeVibe Nova")]
    fake_server.devices[0]["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    await hub.async_set_setting(key, "native_profile", "classic")
    await hub.async_set_setting(key, "pattern", "pulse")
    await hub.async_set_pulse_duration(.08)
    await hub.async_start(key, pulse=True)
    await until(lambda: not hub.devices[key].running)
    await until(lambda: sum(
        name == "RawWriteCmd" and body["Data"] == [15, 0, 0, 0, 0, 0, 0, 0]
        for name, body in fake_server.requests
    ) >= 6)
    await until(lambda: not hub._stop_backups)
    zeros = [
        body for name, body in fake_server.requests
        if name == "RawWriteCmd" and body["Data"] == [15, 0, 0, 0, 0, 0, 0, 0]
    ]
    assert len(zeros) >= 6
    assert not hub.devices[key].running


async def test_pulse_all_has_independent_stop_backup_per_device(
    fake_server, hub_factory, monkeypatch
):
    """Global Pulse all must protect every device without stopping other runs."""
    from custom_components.ogg import coordinator

    monkeypatch.setattr(coordinator, "PULSE_STOP_BACKUP_DELAYS", (.02, .04, .06, .08, .10))
    fake_server.devices = [vibration_device(0, "Left"), vibration_device(1, "Right")]
    hub = await hub_factory(fake_server)
    await until(lambda: hub.connected_count == 2 and all(
        not device.recovering for device in hub.devices.values()
    ))
    await hub.async_set_pulse_duration(.08)
    baseline = {
        index: sum(
            name == "StopDeviceCmd" and body["DeviceIndex"] == index
            for name, body in fake_server.requests
        ) for index in (0, 1)
    }
    await hub.async_all_start(pulse=True)
    await until(lambda: all(not device.running for device in hub.devices.values()))
    await until(lambda: all(
        sum(
            name == "StopDeviceCmd" and body["DeviceIndex"] == index
            for name, body in fake_server.requests
        ) >= baseline[index] + 7 for index in (0, 1)
    ))
    await until(lambda: not hub._stop_backups)
    assert all(not device.running for device in hub.devices.values())


def stroker_device(index: int = 0) -> dict:
    return {
        "DeviceIndex": index,
        "DeviceName": "Test stroker",
        "DeviceMessageTimingGap": 0,
        "DeviceMessages": {
            "StopDeviceCmd": {},
            "LinearCmd": [{"FeatureDescriptor": "Stroke", "ActuatorType": "Position", "StepCount": 100}],
        },
    }


async def test_live_linear_sends_one_vector_without_stop(hass, fake_server, hub_factory):
    fake_server.devices = [stroker_device()]
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    before = len(fake_server.requests)
    await hub.async_linear(key, 80, 120)
    commands = await fake_server.wait_for("LinearCmd")
    assert commands[-1]["Vectors"] == [{"Index": 0, "Duration": 120, "Position": 0.8}]
    sent = [name for name, _ in fake_server.requests[before:]]
    assert "StopDeviceCmd" not in sent
    assert hub.devices[key].aux_values["linear_0"] == 80

    # Through the registered service, any Ogg entity of the device works.
    registry = er.async_get(hass)
    entity_id = next(
        e.entity_id
        for e in registry.entities.values()
        if e.platform == "ogg" and str(e.unique_id).split(":")[1:2] == [key]
    )
    await hass.services.async_call(
        "ogg", "linear", {"entity_id": entity_id, "position": 10, "duration": 300}, blocking=True
    )
    commands = await fake_server.wait_for("LinearCmd", count=2)
    assert commands[-1]["Vectors"] == [{"Index": 0, "Duration": 300, "Position": 0.1}]
    assert "StopDeviceCmd" not in [name for name, _ in fake_server.requests[before:]]


async def test_live_linear_newest_call_wins(fake_server, hub_factory):
    fake_server.devices = [stroker_device()]
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    fake_server.withhold.add("LinearCmd")
    first = asyncio.create_task(hub.async_linear(key, 10, 100))
    await fake_server.wait_for("LinearCmd")
    # These wait behind the in-flight command; only the newest may be sent.
    queued = [asyncio.create_task(hub.async_linear(key, p, 100)) for p in (20, 30, 40)]
    await asyncio.sleep(0.05)
    fake_server.withhold.discard("LinearCmd")
    first.cancel()
    await asyncio.gather(first, return_exceptions=True)
    await asyncio.gather(*queued)
    positions = [body["Vectors"][0]["Position"] for name, body in fake_server.requests
                 if name == "LinearCmd"]
    assert positions == [0.1, 0.4]
    assert hub.devices[key].aux_values["linear_0"] == 40


async def test_live_linear_rejects_device_without_linear(fake_server, hub_factory):
    hub = await hub_factory(fake_server)
    key = next(iter(hub.devices))
    with pytest.raises(HomeAssistantError):
        await hub.async_linear(key, 50, 100)
    assert not [name for name, _ in fake_server.requests if name == "LinearCmd"]
