"""Two-server connection: merged devices, routing, failover, no HA needed."""

from __future__ import annotations

import asyncio

from custom_components.ogg.multi import SLOT_STRIDE, MultiServerConnection
from custom_components.ogg.protocol import ConnectionLost


class FakeServer:
    """Minimal ButtplugConnection stand-in."""

    reachable: dict[str, bool] = {}
    instances: list[FakeServer] = []

    def __init__(self, callback) -> None:
        self.callback = callback
        self.devices: dict[int, dict] = {}
        self.sent: list[tuple] = []
        self.url = None
        self._closed = asyncio.Event()
        self.connected = False
        self.peer_ip = None
        self.server_info = {}
        FakeServer.instances.append(self)

    async def connect(self, url: str) -> None:
        if not FakeServer.reachable.get(url, False):
            from custom_components.ogg.protocol import ProtocolError

            raise ProtocolError("unreachable")
        self.url = url
        self.server_info = {"ServerName": "IntiHA" if "ha" in url else "Intiface Server"}
        self.connected = True
        self.peer_ip = url.split("//")[1].split(":")[0]
        name = "WeVibe Bond" if "ha" in url else "WeVibe Sync 2"
        self.devices = {0: {"DeviceIndex": 0, "DeviceName": name, "DeviceMessages": {}}}

    async def scalar(self, index, values):
        self.sent.append(("scalar", index))

    async def stop_device(self, index):
        self.sent.append(("stop", index))

    async def stop_all(self):
        self.sent.append(("stop_all",))

    async def start_scanning(self):
        self.sent.append(("scan",))

    async def stop_scanning(self):
        self.sent.append(("unscan",))

    async def request(self, name, body, timeout=None):
        self.sent.append((name, body.get("DeviceIndex")))
        return {"SensorReading": {"DeviceIndex": body.get("DeviceIndex"), "Data": [50]}}

    async def await_closed(self):
        await self._closed.wait()

    async def close(self, reason="closed"):
        self.connected = False
        self._closed.set()

    def drop(self):
        self.connected = False
        self._closed.set()


def _setup(urls, reachable):
    FakeServer.reachable = dict(reachable)
    FakeServer.instances = []
    events: list[str] = []
    multi = MultiServerConnection(FakeServer, lambda kind, payload: events.append(kind), lambda: list(urls), retry_seconds=1)
    return multi, events


def test_merges_devices_and_routes_commands():
    async def run():
        multi, _ = _setup(["ws://ha:12345/", "ws://phone:12345/"], {"ws://ha:12345/": True, "ws://phone:12345/": True})
        await multi.connect_any()
        assert set(multi.devices) == {0, SLOT_STRIDE}
        assert multi.devices[SLOT_STRIDE]["DeviceName"] == "WeVibe Sync 2"
        assert multi.peer_ip == "ha + phone"
        ha, phone = FakeServer.instances
        await multi.scalar(SLOT_STRIDE, [{"Index": 0, "Scalar": 0.5}])
        await multi.stop_device(0)
        assert phone.sent == [("scalar", 0)] and ha.sent == [("stop", 0)]
        reading = await multi.request("SensorReadCmd", {"DeviceIndex": SLOT_STRIDE})
        assert reading["SensorReading"]["DeviceIndex"] == SLOT_STRIDE
        await multi.start_scanning()
        assert ("scan",) in ha.sent and ("scan",) in phone.sent
        await multi.close()

    asyncio.run(run())


def test_one_server_dropping_keeps_the_other_and_reconnects():
    async def run():
        urls = ["ws://ha:12345/", "ws://phone:12345/"]
        multi, events = _setup(urls, {urls[0]: True, urls[1]: True})
        await multi.connect_any()
        phone = FakeServer.instances[1]
        phone.drop()
        await asyncio.sleep(0.05)
        assert multi.connected and set(multi.devices) == {0}
        assert "DeviceList" in events
        try:
            await multi.scalar(SLOT_STRIDE, [])
        except ConnectionLost:
            pass
        else:
            raise AssertionError("commands to the lost server must fail")
        await asyncio.sleep(1.2)  # background retry reconnects slot 2
        assert set(multi.devices) == {0, SLOT_STRIDE}
        # Losing every server closes the combined connection.
        for server in FakeServer.instances:
            server.drop()
        await asyncio.wait_for(multi.await_closed(), 1)
        await multi.close()

    asyncio.run(run())


def test_starts_with_only_the_other_server_and_fails_with_none():
    async def run():
        urls = ["ws://ha:12345/", "ws://phone:12345/"]
        multi, _ = _setup(urls, {urls[1]: True})
        await multi.connect_any()
        assert set(multi.devices) == {SLOT_STRIDE}
        await multi.close()
        multi, _ = _setup(urls, {})
        try:
            await multi.connect_any()
        except ConnectionLost:
            return
        raise AssertionError("no reachable server must raise")

    asyncio.run(run())


def test_slots_follow_server_identity_not_address_order():
    async def run():
        # Phone first (two addresses for the same phone), IntiHA last.
        urls = ["ws://phone-vpn:12345/", "ws://phone-wifi:12345/", "ws://ha:12345/"]
        multi, _ = _setup(urls, {u: True for u in urls})
        await multi.connect_any()
        names = {i: d["DeviceName"] for i, d in multi.devices.items()}
        assert names == {0: "WeVibe Bond", SLOT_STRIDE: "WeVibe Sync 2"}
        assert dict(multi.endpoints) == {0: "ws://ha:12345/", 1: "ws://phone-vpn:12345/"}
        # The phone's second address was identified and not kept connected.
        wifi = [s for s in FakeServer.instances if s.url == "ws://phone-wifi:12345/"]
        assert all(not s.connected for s in wifi)
        await multi.close()

    asyncio.run(run())
