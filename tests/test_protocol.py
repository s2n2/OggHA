"""Exercise the transport against a real aiohttp WebSocket peer."""

from __future__ import annotations

import asyncio

import pytest
from aiohttp import ClientSession

from custom_components.ogg.protocol import (
    ButtplugConnection,
    CommandError,
    ConnectionLost,
    ProtocolError,
)

from .conftest import vibration_device


async def test_handshake_has_no_motor_side_effects(fake_server):
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        assert client.connected
        assert set(client.devices) == {0}
        assert [name for name, _ in fake_server.requests] == [
            "RequestServerInfo",
            "RequestDeviceList",
        ]
        assert fake_server.requests[0][1]["ClientName"] == "Ogg"
        assert fake_server.requests[0][1]["MessageVersion"] == 3
        await client.close()
        assert not session.closed
        assert not client.connected


async def test_push_discovery_updates_snapshot_before_callback(fake_server):
    async with ClientSession() as session:
        events = []
        client = ButtplugConnection(session, lambda name, body: events.append((name, body)))
        await client.connect(fake_server.url)
        await fake_server.push("DeviceAdded", vibration_device(9))
        async with asyncio.timeout(1):
            while 9 not in client.devices:
                await asyncio.sleep(0.005)
        assert events[-1][0] == "DeviceAdded"
        await fake_server.push("DeviceRemoved", {"DeviceIndex": 9})
        async with asyncio.timeout(1):
            while 9 in client.devices:
                await asyncio.sleep(0.005)
        assert events[-1][0] == "DeviceRemoved"
        await client.close()


async def test_concurrent_commands_have_unique_ids(fake_server):
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        replies = await asyncio.gather(*(client.request("Ping") for _ in range(20)))
        ids = [reply["Ok"]["Id"] for reply in replies]
        assert len(set(ids)) == len(ids)
        assert all(value > 0 for value in ids)
        assert client.connected
        await client.close()


async def test_explicit_rejection_does_not_drop_connection_or_expose_private_error(fake_server):
    fake_server.reject.add("StartScanning")
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        with pytest.raises(CommandError) as caught:
            await client.start_scanning()
        assert "Private" not in str(caught.value)
        assert caught.value.code == 4
        assert client.connected
        await client.stop_all()
        await client.close()


async def test_timeout_invalidates_connection_and_other_pending_requests(fake_server):
    fake_server.withhold.update({"ScalarCmd", "StartScanning"})
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None, request_timeout=0.05)
        await client.connect(fake_server.url)
        results = await asyncio.gather(
            client.scalar(0, [{"Index": 0, "Scalar": 0.3, "ActuatorType": "Vibrate"}]),
            client.start_scanning(),
            return_exceptions=True,
        )
        assert all(isinstance(result, ConnectionLost) for result in results)
        assert not client.connected
        await asyncio.wait_for(client.await_closed(), 1)
        assert not client._pending
        await client.close()


async def test_remote_disconnect_fails_pending_without_waiting_full_timeout(fake_server):
    fake_server.withhold.add("StartScanning")
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None, request_timeout=5)
        await client.connect(fake_server.url)
        pending = asyncio.create_task(client.start_scanning())
        await fake_server.wait_for("StartScanning")
        await fake_server.disconnect()
        with pytest.raises(ConnectionLost):
            await asyncio.wait_for(pending, 1)
        await asyncio.wait_for(client.await_closed(), 1)
        assert not client.connected
        await client.close()


async def test_server_heartbeat_is_sent(fake_server):
    fake_server.max_ping_time = 100
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        await fake_server.wait_for("Ping", count=2)
        assert client.connected
        await client.close()


async def test_missed_heartbeat_closes_connection(fake_server):
    fake_server.max_ping_time = 100
    fake_server.withhold.add("Ping")
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        await asyncio.wait_for(client.await_closed(), 1)
        assert not client.connected
        await client.close()


async def test_raw_write_requires_advertised_endpoint(fake_server):
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        with pytest.raises(ProtocolError):
            await client.raw_write(0, bytes(8))
        assert not any(name == "RawWriteCmd" for name, _ in fake_server.requests)
        client.devices[0]["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
        await client.raw_write(0, bytes([15, 5, 0, 255, 0, 3, 0, 0]))
        packet = (await fake_server.wait_for("RawWriteCmd"))[-1]
        assert packet["Endpoint"] == "tx"
        assert packet["WriteWithResponse"] is True
        assert len(packet["Data"]) == 8
        await client.close()


async def test_scalar_checks_feature_type_instead_of_treating_all_features_as_motors(fake_server):
    fake_server.devices[0]["DeviceMessages"]["ScalarCmd"].insert(
        0, {"ActuatorType": "Constrict", "StepCount": 100}
    )
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        with pytest.raises(ProtocolError):
            await client.scalar(0, [{"Index": 0, "Scalar": 0.5, "ActuatorType": "Vibrate"}])
        await client.scalar(0, [{"Index": 1, "Scalar": 0.5, "ActuatorType": "Vibrate"}])
        assert (await fake_server.wait_for("ScalarCmd"))[-1]["Scalars"][0]["Index"] == 1
        await client.close()


async def test_incompatible_protocol_fails_cleanly(fake_server):
    fake_server.version = 4
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        with pytest.raises(ProtocolError):
            await client.connect(fake_server.url)
        assert not client.connected
        await client.close()


async def test_malformed_frame_disconnects_and_shutdown_is_idempotent(fake_server):
    async with ClientSession() as session:
        client = ButtplugConnection(session, lambda *_: None)
        await client.connect(fake_server.url)
        await fake_server.clients[-1].send_json({"not": "an array"})
        await asyncio.wait_for(client.await_closed(), 1)
        assert client.closed_reason == "invalid_server_message"
        await asyncio.gather(client.close(), client.close())
