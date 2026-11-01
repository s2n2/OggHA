"""Shared fixtures using real Home Assistant and a local WebSocket server."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from copy import deepcopy
from typing import Any

import pytest
from aiohttp import WSMsgType, web


def vibration_device(index: int = 0, name: str = "Test device", motors: int = 2) -> dict:
    """Describe actual v3 feature indexes, including two independent motors."""
    return {
        "DeviceIndex": index,
        "DeviceName": name,
        "DeviceMessageTimingGap": 0,
        "DeviceMessages": {
            "StopDeviceCmd": {},
            "ScalarCmd": [
                {"FeatureDescriptor": f"Motor {i + 1}", "ActuatorType": "Vibrate", "StepCount": 15}
                for i in range(motors)
            ],
        },
    }


class FakeServer:
    """Protocol peer over a real loopback WebSocket, with injectable failures."""

    def __init__(self) -> None:
        self.devices = [vibration_device()]
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.clients: list[web.WebSocketResponse] = []
        self.withhold: set[str] = set()
        self.withhold_native_start = False
        self.reject: set[str] = set()
        self.version = 3
        self.max_ping_time = 0
        self.url = ""

    async def handle(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.clients.append(ws)
        async for frame in ws:
            if frame.type != WSMsgType.TEXT:
                continue
            for envelope in frame.json():
                name, body = next(iter(envelope.items()))
                self.requests.append((name, deepcopy(body)))
                if name in self.withhold:
                    continue
                if name == "RawWriteCmd" and self.withhold_native_start and body["Data"][1] != 0:
                    continue
                request_id = body["Id"]
                if name in self.reject:
                    response = {
                        "Error": {
                            "Id": request_id,
                            "ErrorCode": 4,
                            "ErrorMessage": "Private model and address must not reach normal logs",
                        }
                    }
                elif name == "RequestServerInfo":
                    response = {
                        "ServerInfo": {
                            "Id": request_id,
                            "ServerName": "Synthetic Ogg test server",
                            "MessageVersion": self.version,
                            "MaxPingTime": self.max_ping_time,
                        }
                    }
                elif name == "RequestDeviceList":
                    response = {"DeviceList": {"Id": request_id, "Devices": deepcopy(self.devices)}}
                elif name == "SensorReadCmd":
                    response = {
                        "SensorReading": {
                            "Id": request_id,
                            "DeviceIndex": body["DeviceIndex"],
                            "SensorIndex": body["SensorIndex"],
                            "SensorType": body["SensorType"],
                            "Data": [75],
                        }
                    }
                else:
                    response = {"Ok": {"Id": request_id}}
                await ws.send_json([response])
        return ws

    async def push(self, name: str, body: dict) -> None:
        for ws in self.clients:
            if not ws.closed:
                await ws.send_json([{name: {**body, "Id": 0}}])

    async def disconnect(self) -> None:
        for ws in self.clients:
            if not ws.closed:
                await ws.close()

    async def wait_for(self, kind: str, count: int = 1, timeout: float = 2) -> list[dict]:
        async with asyncio.timeout(timeout):
            while len(found := [body for name, body in self.requests if name == kind]) < count:
                await asyncio.sleep(0.005)
        return found


@pytest.fixture
async def fake_server(aiohttp_server, socket_enabled) -> AsyncIterator[FakeServer]:
    server = FakeServer()
    app = web.Application()
    app.router.add_get("/", server.handle)
    runner = await aiohttp_server(app)
    server.url = str(runner.make_url("/")).replace("http://", "ws://", 1)
    yield server
    await server.disconnect()
