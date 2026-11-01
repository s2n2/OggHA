"""Small, bounded Buttplug v3 transport using Home Assistant's aiohttp session.

This is a protocol client, not a Bluetooth driver. Device capabilities always
come from the connected server. No command that starts a motor is sent during
connection, discovery, or reconnection.

Specification: https://buttplug.io/docs/spec-v3/spec/
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)
_MAX_MESSAGE_ID = 2**32 - 1
_MAX_PENDING = 128
_MAX_MESSAGE_BYTES = 1024 * 1024
_EXPECTED_REPLIES = {
    "RequestServerInfo": "ServerInfo",
    "RequestDeviceList": "DeviceList",
    "SensorReadCmd": "SensorReading",
    "RawReadCmd": "RawReading",
    "Ping": "Ok",
    "StartScanning": "Ok",
    "StopScanning": "Ok",
    "StopAllDevices": "Ok",
    "StopDeviceCmd": "Ok",
    "ScalarCmd": "Ok",
    "VibrateCmd": "Ok",
    "RotateCmd": "Ok",
    "LinearCmd": "Ok",
    "RawWriteCmd": "Ok",
    "SensorSubscribeCmd": "Ok",
    "SensorUnsubscribeCmd": "Ok",
}

type Message = dict[str, Any]
type EventCallback = Callable[[str, Message], None]


class ProtocolError(Exception):
    """An Ogg connection or protocol operation failed."""


class ConnectionLost(ProtocolError):
    """The transport is no longer usable."""


class CommandError(ProtocolError):
    """The server explicitly rejected one command.

    The remote error is kept separately because it can contain a device name or
    address. The exception string is intentionally suitable for discreet logs.
    """

    def __init__(self, command: str, body: Mapping[str, Any]) -> None:
        self.command = command
        code = body.get("ErrorCode")
        self.code = code if isinstance(code, int) and not isinstance(code, bool) else None
        self.server_message = str(body.get("ErrorMessage", ""))
        super().__init__(f"Server rejected {command} (code {self.code})")


def raw_endpoints(device: Mapping[str, Any]) -> frozenset[str]:
    """Return only explicitly advertised raw-write endpoints."""
    messages = device.get("DeviceMessages", {})
    if not isinstance(messages, Mapping):
        return frozenset()
    attributes = messages.get("RawWriteCmd", {})
    if isinstance(attributes, Mapping):
        endpoints = attributes.get("Endpoints", [])
    elif isinstance(attributes, list):
        endpoints = [
            value
            for item in attributes
            if isinstance(item, Mapping) and isinstance(item.get("Endpoints"), list)
            for value in item["Endpoints"]
        ]
    else:
        endpoints = []
    if not isinstance(endpoints, (list, tuple)):
        return frozenset()
    return frozenset(value for value in endpoints if isinstance(value, str))


class ButtplugConnection:
    """One v3 WebSocket session with correlated replies and push events.

    ``event_callback`` is synchronous and receives ``(message_name, body)``.
    It should schedule work if that work needs to await another request; the
    receive loop must remain free to deliver the corresponding reply.

    ``request`` returns the whole single-message envelope, for example
    ``{"Ok": {"Id": 2}}``. Device snapshots are keyed by server DeviceIndex.
    A failed/closed object can be discarded and a new object used for retry.
    Closing this object never closes the caller's shared ClientSession.
    """

    def __init__(
        self,
        session: aiohttp.ClientSession,
        event_callback: EventCallback,
        *,
        request_timeout: float = 5.0,
        connect_timeout: float = 5.0,
    ) -> None:
        if not (0 < request_timeout <= 60 and 0 < connect_timeout <= 60):
            raise ValueError("Timeouts must be greater than zero and at most 60 seconds")
        self._session = session
        self._event_callback = event_callback
        self.request_timeout = request_timeout
        self.connect_timeout = connect_timeout
        self.server_info: Message = {}
        self.devices: dict[int, Message] = {}
        self.closed_reason = "not_connected"
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._ping_task: asyncio.Task[None] | None = None
        self._pending: dict[int, asyncio.Future[Message]] = {}
        self._next_id = 1
        self._send_lock = asyncio.Lock()
        self._closed = asyncio.Event()
        self._closed.set()
        self._connected = False
        self._closing = False

    @property
    def connected(self) -> bool:
        """Whether handshake completed and the socket remains open."""
        return bool(self._connected and self._ws is not None and not self._ws.closed)

    @property
    def peer_ip(self) -> str | None:
        """Return the socket peer's resolved address, never a configured hostname."""
        if self._ws is None or self._ws.closed:
            return None
        peer = self._ws.get_extra_info("peername")
        if isinstance(peer, (list, tuple)) and peer and isinstance(peer[0], str):
            return peer[0]
        return None

    async def connect(self, url: str) -> None:
        """Open, handshake and enumerate without starting any devices."""
        if self._ws is not None or not self._closed.is_set():
            raise ProtocolError("This connection is already open")
        self._closed.clear()
        self._closing = False
        self._connected = False
        self.closed_reason = "connecting"
        self.server_info = {}
        self.devices = {}
        try:
            async with asyncio.timeout(self.connect_timeout):
                self._ws = await self._session.ws_connect(
                    url,
                    # Own the keepalive task below. This also avoids orphaned
                    # aiohttp heartbeat timers during a close handshake.
                    heartbeat=None,
                    autoping=True,
                    max_msg_size=_MAX_MESSAGE_BYTES,
                )
            self._reader_task = asyncio.create_task(
                self._read_messages(), name="ogg_protocol_reader"
            )
            response = await self.request(
                "RequestServerInfo", {"ClientName": "Ogg", "MessageVersion": 3}
            )
            info = response.get("ServerInfo")
            if not isinstance(info, dict) or info.get("MessageVersion") != 3:
                raise ProtocolError("The server did not negotiate protocol version 3")
            max_ping = info.get("MaxPingTime", 0)
            if isinstance(max_ping, bool) or not isinstance(max_ping, int) or max_ping < 0:
                raise ProtocolError("The server returned an invalid heartbeat interval")
            self.server_info = info
            self._ping_task = asyncio.create_task(
                self._ping_loop(max_ping), name="ogg_protocol_heartbeat"
            )
            response = await self.request("RequestDeviceList")
            if "DeviceList" not in response:
                raise ProtocolError("The server returned an invalid device list")
            # The reader applied this snapshot before resolving the request.
            # Do not apply it a second time and overwrite intervening hotplug events.
            if self._ws is None or self._ws.closed:
                raise ConnectionLost("Connection closed during setup")
            self._connected = True
            self.closed_reason = "connected"
        except asyncio.CancelledError:
            await self.close(reason="cancelled")
            raise
        except ProtocolError:
            await self.close(reason="setup_failed")
            raise
        except (aiohttp.ClientError, OSError, TimeoutError, ValueError) as err:
            await self.close(reason="setup_failed")
            raise ConnectionLost("Unable to establish a server connection") from err

    async def request(
        self,
        message_type: str,
        payload: Mapping[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> Message:
        """Send a command and await its own bounded response.

        A timeout invalidates the connection: whether an output command reached
        the device is then unknown, so it must never be retried silently.
        Explicit protocol Error replies leave the connection usable.
        """
        ws = self._ws
        if ws is None or ws.closed or self._closing:
            raise ConnectionLost("The server is disconnected")
        if len(self._pending) >= _MAX_PENDING:
            raise ProtocolError("Too many commands are pending")
        request_id = self._allocate_id()
        future: asyncio.Future[Message] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        body = dict(payload or {})
        body["Id"] = request_id
        try:
            async with asyncio.timeout(timeout if timeout is not None else self.request_timeout):
                async with self._send_lock:
                    if ws.closed or self._closing:
                        raise ConnectionLost("The server is disconnected")
                    await ws.send_json([{message_type: body}])
                response = await future
            if "Error" in response:
                raise CommandError(message_type, response["Error"])
            expected = _EXPECTED_REPLIES.get(message_type)
            if expected is not None and expected not in response:
                await self.close(reason="unexpected_reply")
                raise ProtocolError("The server returned an unexpected acknowledgement")
            return response
        except TimeoutError as err:
            await self.close(reason="request_timeout")
            raise ConnectionLost("The server did not acknowledge a command in time") from err
        except (aiohttp.ClientError, OSError) as err:
            await self.close(reason="transport_error")
            raise ConnectionLost("The server connection was interrupted") from err
        finally:
            self._pending.pop(request_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                # A send failure can close the socket before this request ever
                # starts awaiting its Future. Consume that teardown exception.
                future.exception()

    async def start_scanning(self) -> None:
        """Ask the server to discover nearby devices."""
        await self._expect_ok("StartScanning")

    async def stop_scanning(self) -> None:
        """Ask the server to finish discovery."""
        await self._expect_ok("StopScanning")

    async def stop_device(self, index: int) -> None:
        """Send the explicit per-device stop command."""
        await self._expect_ok("StopDeviceCmd", {"DeviceIndex": index})

    async def stop_all(self) -> None:
        """Send the explicit server-wide stop command."""
        await self._expect_ok("StopAllDevices")

    async def scalar(self, index: int, values: Sequence[Mapping[str, Any]]) -> None:
        """Set advertised vibration features without touching other actuators."""
        device = self.devices.get(index, {})
        messages = device.get("DeviceMessages", {})
        features = messages.get("ScalarCmd", []) if isinstance(messages, Mapping) else []
        if not isinstance(features, list):
            raise ProtocolError("This device does not advertise scalar features")
        scalars: list[Message] = []
        for value in values:
            feature_index = value.get("Index")
            level = value.get("Scalar")
            if (
                isinstance(feature_index, bool)
                or not isinstance(feature_index, int)
                or not 0 <= feature_index < len(features)
                or not isinstance(features[feature_index], Mapping)
                or features[feature_index].get("ActuatorType") != "Vibrate"
                or value.get("ActuatorType") != "Vibrate"
                or isinstance(level, bool)
                or not isinstance(level, (float, int))
                or not math.isfinite(level)
                or not 0 <= level <= 1
            ):
                raise ProtocolError("Invalid vibration feature or level")
            scalars.append({"Index": feature_index, "Scalar": level, "ActuatorType": "Vibrate"})
        if not scalars:
            raise ProtocolError("At least one vibration feature is required")
        await self._expect_ok("ScalarCmd", {"DeviceIndex": index, "Scalars": scalars})

    async def raw_write(self, index: int, data: bytes, endpoint: str = "tx") -> None:
        """Write to the advertised control endpoint after caller profile checks.

        Ogg's caller must explicitly opt a verified classic We-Vibe into this
        path. No endpoint discovery or attempts at unknown endpoints occur here.
        """
        if endpoint != "tx" or endpoint not in raw_endpoints(self.devices.get(index, {})):
            raise ProtocolError("The server has not exposed the raw control endpoint")
        if not isinstance(data, bytes) or len(data) != 8:
            raise ProtocolError("Native control requires one eight-byte packet")
        await self._expect_ok(
            "RawWriteCmd",
            {
                "DeviceIndex": index,
                "Endpoint": endpoint,
                "Data": list(data),
                "WriteWithResponse": True,
            },
        )

    async def await_closed(self) -> None:
        """Wait for remote loss or an explicit local close."""
        await self._closed.wait()

    async def close(self, *, reason: str = "closed") -> None:
        """Bounded, idempotent teardown; ownership of ClientSession is external."""
        if self._closing:
            await self._closed.wait()
            return
        self._closing = True
        self._connected = False
        self.closed_reason = reason
        current = asyncio.current_task()
        tasks = [
            task
            for task in (self._reader_task, self._ping_task)
            if task is not None and task is not current and not task.done()
        ]
        for task in tasks:
            task.cancel()
        ws, self._ws = self._ws, None
        self._fail_pending()
        try:
            if ws is not None and not ws.closed:
                with suppress(aiohttp.ClientError, OSError, TimeoutError):
                    async with asyncio.timeout(2):
                        await ws.close()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            self._closed.set()

    def _allocate_id(self) -> int:
        for _ in range(_MAX_PENDING + 1):
            value = self._next_id
            self._next_id = 1 if value == _MAX_MESSAGE_ID else value + 1
            if value not in self._pending:
                return value
        raise ProtocolError("No message identifier is available")

    async def _expect_ok(self, message_type: str, payload: Mapping[str, Any] | None = None) -> None:
        response = await self.request(message_type, payload)
        if "Ok" not in response:
            raise ProtocolError("The server returned an unexpected acknowledgement")

    async def _ping_loop(self, max_ping_ms: int) -> None:
        # Servers with MaxPingTime=0 may have no Ping timer configured. A
        # read-only device snapshot is a portable liveness check in that case.
        # It refreshes metadata only, and never starts scanning or output.
        interval = max(0.001, min(10.0, max_ping_ms / 2000)) if max_ping_ms else 15.0
        timeout = (
            min(self.request_timeout, max(0.001, max_ping_ms / 2000))
            if max_ping_ms
            else self.request_timeout
        )
        command, expected = ("Ping", "Ok") if max_ping_ms else ("RequestDeviceList", "DeviceList")
        try:
            while True:
                await asyncio.sleep(interval)
                response = await self.request(command, timeout=timeout)
                if expected not in response:
                    raise ProtocolError("The server rejected its heartbeat")
        except asyncio.CancelledError:
            raise
        except ProtocolError:
            await self.close(reason="heartbeat_failed")

    async def _read_messages(self) -> None:
        ws = self._ws
        if ws is None:
            return
        reason = "connection_closed"
        try:
            async for frame in ws:
                if frame.type == aiohttp.WSMsgType.TEXT:
                    messages = json.loads(frame.data)
                    if not isinstance(messages, list):
                        raise ProtocolError("The server sent an invalid message frame")
                    for envelope in messages:
                        self._dispatch(envelope)
                elif frame.type == aiohttp.WSMsgType.BINARY:
                    raise ProtocolError("The server sent an unsupported binary message")
                elif frame.type == aiohttp.WSMsgType.ERROR:
                    reason = "transport_error"
                    break
        except asyncio.CancelledError:
            raise
        except ConnectionLost:
            reason = "server_error"
        except (ValueError, TypeError, ProtocolError):
            reason = "invalid_server_message"
        except (aiohttp.ClientError, OSError):
            reason = "transport_error"
        finally:
            self._connected = False
            self._fail_pending()
            if not self._closing:
                self.closed_reason = reason
                if self._ping_task is not None:
                    self._ping_task.cancel()
                if not ws.closed:
                    with suppress(aiohttp.ClientError, OSError, TimeoutError):
                        async with asyncio.timeout(2):
                            await ws.close()
                if self._ws is ws:
                    self._ws = None
                self._closed.set()

    def _dispatch(self, envelope: Any) -> None:
        if not isinstance(envelope, dict) or len(envelope) != 1:
            raise ProtocolError("The server sent an invalid message envelope")
        name, body = next(iter(envelope.items()))
        if not isinstance(body, dict):
            raise ProtocolError("The server sent an invalid message body")
        message_id = body.get("Id")
        if (
            isinstance(message_id, bool)
            or not isinstance(message_id, int)
            or not 0 <= message_id <= _MAX_MESSAGE_ID
        ):
            raise ProtocolError("The server sent an invalid message identifier")
        if name == "DeviceList":
            values = body.get("Devices")
            if not isinstance(values, list):
                raise ProtocolError("The server sent an invalid device list")
            self.devices = {self._device_index(device): device for device in values}
        elif name == "DeviceAdded":
            self.devices[self._device_index(body)] = body
        elif name == "DeviceRemoved":
            self.devices.pop(self._device_index(body), None)
        future = self._pending.get(message_id)
        if future is not None and not future.done():
            future.set_result(envelope)
        elif message_id == 0:
            try:
                self._event_callback(name, body)
            except Exception:  # An integration callback must not strand pending requests.
                _LOGGER.exception("Ogg could not process a server event")
            if name == "Error":
                # A system error (for example watchdog expiry) has no awaiting
                # caller. Treat it as loss of the session, not a healthy link.
                raise ConnectionLost("The server reported a session error")

    @staticmethod
    def _device_index(device: Any) -> int:
        if not isinstance(device, dict):
            raise ProtocolError("The server sent an invalid device description")
        value = device.get("DeviceIndex")
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ProtocolError("The server sent an invalid device index")
        return value

    def _fail_pending(self) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(ConnectionLost("The server connection closed"))
