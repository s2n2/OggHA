"""Two Buttplug servers presented to Ogg as one connection.

With "Connect to two servers at once" enabled, Ogg keeps the local IntiHA
server in slot 0 and one other server (for example a phone running Intiface)
in slot 1. Servers are told apart by the name they report in the Buttplug
handshake, so the order of the configured addresses does not matter and the
same phone reachable at two addresses is only connected once. Devices
from both are merged into one list. Each device gets a stable virtual index
``slot * SLOT_STRIDE + server_index`` so commands are routed to the server that
owns it, invisibly to the rest of Ogg. One server dropping removes only its
devices; the missing slot is retried in the background. The combined
connection only counts as closed when no server is connected.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from .protocol import ConnectionLost, ProtocolError

_LOGGER = logging.getLogger(__name__)

SLOT_STRIDE = 1000
MAX_SERVERS = 2

EventCallback = Callable[[str, dict[str, Any]], None]


def split_index(index: int) -> tuple[int, int]:
    """Virtual device index -> (slot, server index)."""
    return divmod(int(index), SLOT_STRIDE)


class MultiServerConnection:
    """Duck-types ButtplugConnection over up to two real connections."""

    def __init__(
        self,
        factory: Callable[[EventCallback], Any],
        event_callback: EventCallback,
        resolve_urls: Callable[[], list[str]],
        retry_seconds: float = 15.0,
    ) -> None:
        self._factory = factory
        self._event_callback = event_callback
        self._resolve_urls = resolve_urls
        self._retry_seconds = max(1.0, float(retry_seconds))
        self._subs: dict[int, Any] = {}
        self._urls: dict[int, str] = {}
        # url -> slot it belongs to, learned from each server's handshake name.
        self._kinds: dict[str, int] = {}
        self._scanning: set[int] = set()
        self._closed = asyncio.Event()
        self._closed.set()
        self._closing = False
        self._maintainer: asyncio.Task[None] | None = None
        self._watchers: dict[int, asyncio.Task[None]] = {}
        self.closed_reason = "not_connected"
        self.server_info: dict[str, Any] = {}

    # ---- ButtplugConnection-compatible surface --------------------------------
    @property
    def connected(self) -> bool:
        return not self._closing and any(sub.connected for sub in self._subs.values())

    @property
    def peer_ip(self) -> str | None:
        ips = [sub.peer_ip for _, sub in sorted(self._subs.items()) if sub.peer_ip]
        return " + ".join(ips) if ips else None

    @property
    def devices(self) -> dict[int, dict[str, Any]]:
        merged: dict[int, dict[str, Any]] = {}
        for slot, sub in sorted(self._subs.items()):
            for index, raw in sub.devices.items():
                virtual = slot * SLOT_STRIDE + int(index)
                merged[virtual] = {**raw, "DeviceIndex": virtual}
        return merged

    @property
    def endpoints(self) -> list[tuple[int, str]]:
        """Connected (slot, url) pairs, e.g. for IntiHA's identity side channel."""
        return [(slot, self._urls[slot]) for slot in sorted(self._subs) if slot in self._urls]

    @property
    def primary_url(self) -> str | None:
        endpoints = self.endpoints
        return endpoints[0][1] if endpoints else None

    async def connect_any(self) -> None:
        """Connect every available slot; fail only if no server answers."""
        self._closing = False
        self._closed.clear()
        self.closed_reason = "connecting"
        await self._fill_slots()
        if not self._subs:
            self._closed.set()
            self.closed_reason = "setup_failed"
            raise ConnectionLost("No configured server is responding")
        self._maintainer = asyncio.get_running_loop().create_task(self._maintain())

    async def connect(self, url: str) -> None:  # pragma: no cover - interface parity
        await self.connect_any()

    async def request(
        self, message_type: str, payload: Mapping[str, Any] | None = None, *, timeout: float | None = None
    ) -> dict[str, Any]:
        body = dict(payload or {})
        if "DeviceIndex" in body:
            slot, index = split_index(body["DeviceIndex"])
            sub = self._sub(slot)
            body["DeviceIndex"] = index
            response = await sub.request(message_type, body, timeout=timeout)
            return self._virtualise(slot, response)
        responses = await self._all(lambda sub: sub.request(message_type, body, timeout=timeout))
        return responses[0] if responses else {"Ok": {}}

    async def start_scanning(self) -> None:
        slots = list(self._subs)
        await self._all(lambda sub: sub.start_scanning())
        self._scanning = set(slots)

    async def stop_scanning(self) -> None:
        self._scanning.clear()
        await self._all(lambda sub: sub.stop_scanning(), ignore_errors=True)

    async def start_scanning_on(self, slot: int) -> bool:
        """Scan on one server only (e.g. slot 0, the local IntiHA)."""
        sub = self._subs.get(slot)
        if sub is None or not sub.connected:
            return False
        await sub.start_scanning()
        self._scanning.add(slot)
        return True

    async def stop_scanning_on(self, slot: int) -> None:
        sub = self._subs.get(slot)
        self._scanning.discard(slot)
        if sub is not None and sub.connected:
            await sub.stop_scanning()

    async def stop_device(self, index: int) -> None:
        slot, server_index = split_index(index)
        await self._sub(slot).stop_device(server_index)

    async def stop_all(self) -> None:
        await self._all(lambda sub: sub.stop_all())

    async def scalar(self, index: int, values: Sequence[Mapping[str, Any]]) -> None:
        slot, server_index = split_index(index)
        await self._sub(slot).scalar(server_index, values)

    async def raw_write(self, index: int, data: bytes, endpoint: str = "tx") -> None:
        slot, server_index = split_index(index)
        await self._sub(slot).raw_write(server_index, data, endpoint)

    async def await_closed(self) -> None:
        await self._closed.wait()

    async def close(self, *, reason: str = "closed") -> None:
        if self._closing and self._closed.is_set():
            return
        self._closing = True
        self.closed_reason = reason
        tasks = [t for t in (self._maintainer, *self._watchers.values()) if t is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._watchers.clear()
        self._maintainer = None
        subs = list(self._subs.values())
        self._subs.clear()
        await asyncio.gather(*(sub.close(reason=reason) for sub in subs), return_exceptions=True)
        self._closed.set()

    # ---- internals -------------------------------------------------------------
    def _sub(self, slot: int) -> Any:
        sub = self._subs.get(slot)
        if sub is None or not sub.connected:
            raise ConnectionLost("That device's server is disconnected")
        return sub

    async def _all(self, call: Callable[[Any], Any], *, ignore_errors: bool = False) -> list[Any]:
        subs = [sub for _, sub in sorted(self._subs.items()) if sub.connected]
        if not subs:
            raise ConnectionLost("No server is connected")
        results = await asyncio.gather(*(call(sub) for sub in subs), return_exceptions=True)
        errors = [r for r in results if isinstance(r, BaseException)]
        if errors and not ignore_errors:
            raise errors[0]
        return [r for r in results if not isinstance(r, BaseException)]

    @staticmethod
    def _virtualise(slot: int, response: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name, body in response.items():
            if isinstance(body, dict) and isinstance(body.get("DeviceIndex"), int):
                body = {**body, "DeviceIndex": slot * SLOT_STRIDE + body["DeviceIndex"]}
            out[name] = body
        return out

    @staticmethod
    def _slot_for(sub: Any) -> int:
        """Slot 0 for the local IntiHA engine, slot 1 for any other server."""
        name = str(getattr(sub, "server_info", {}).get("ServerName", ""))
        return 0 if name.strip().lower().startswith("intiha") else 1

    async def _fill_slots(self) -> None:
        taken = {u for s, u in self._urls.items() if s in self._subs}
        for url in dict.fromkeys(self._resolve_urls()):
            missing = {0, 1} - set(self._subs)
            if not missing:
                return
            known = self._kinds.get(url)
            if url in taken or (known is not None and known not in missing):
                continue
            holder: dict[str, int] = {"slot": -1}
            sub = self._factory(
                lambda kind, payload, holder=holder: self._on_sub_event(holder["slot"], kind, payload)
            )
            try:
                await sub.connect(url)
            except ProtocolError:
                with contextlib.suppress(Exception):
                    await sub.close(reason="setup_failed")
                continue
            slot = self._slot_for(sub)
            self._kinds[url] = slot
            if slot not in missing:
                # Same kind of server as one already connected (for example the
                # phone again at another address): do not connect it twice.
                with contextlib.suppress(Exception):
                    await sub.close(reason="duplicate_server")
                continue
            holder["slot"] = slot
            self._subs[slot] = sub
            self._urls[slot] = url
            taken.add(url)
            self._watchers[slot] = asyncio.get_running_loop().create_task(self._watch(slot, sub))
            if self._scanning:
                with contextlib.suppress(ProtocolError):
                    await sub.start_scanning()
                    self._scanning.add(slot)
            _LOGGER.info("Ogg connected server slot %s", slot + 1)
            self._emit("DeviceList", {})

    async def _watch(self, slot: int, sub: Any) -> None:
        await sub.await_closed()
        if self._subs.get(slot) is sub:
            self._subs.pop(slot, None)
            self._scanning.discard(slot)
            self._watchers.pop(slot, None)
            _LOGGER.info("Ogg server slot %s disconnected", slot + 1)
            self._emit("DeviceList", {})
            if not self._subs and not self._closing:
                self.closed_reason = "all_servers_lost"
                self._closed.set()

    async def _maintain(self) -> None:
        while not self._closing:
            await asyncio.sleep(self._retry_seconds)
            if len(self._subs) < MAX_SERVERS:
                try:
                    await self._fill_slots()
                except Exception:  # noqa: BLE001 - a retry must never kill the session
                    _LOGGER.debug("Ogg could not reconnect a server slot", exc_info=True)

    def _on_sub_event(self, slot: int, kind: str, payload: dict[str, Any]) -> None:
        if slot < 0:
            return  # Still identifying this server.
        if kind == "ScanningFinished":
            self._scanning.discard(slot)
            if self._scanning:
                return  # Wait until every scanning server has finished.
        if isinstance(payload.get("DeviceIndex"), int):
            payload = {**payload, "DeviceIndex": slot * SLOT_STRIDE + payload["DeviceIndex"]}
        self._emit(kind, payload)

    def _emit(self, kind: str, payload: dict[str, Any]) -> None:
        try:
            self._event_callback(kind, payload)
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Ogg could not process a server event")
