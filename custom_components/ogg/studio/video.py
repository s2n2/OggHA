"""Casting a video without storing it: Home Assistant relays it from the browser to the TV.

A Chromecast (or other TV) fetches what it plays, and a browser cannot be
fetched from, so Home Assistant stands in between, in memory only:

1. The card opens a relay over the websocket (``oggstudio/relay``) and gets a
   private link, ``/api/ogg/studio/relay/<random id>/<name>``. The TV is told to
   play that link (Home Assistant signs it for the TV).
2. When the TV asks for part of the video (range requests: it seeks freely),
   Home Assistant asks the card for those bytes, a block at a time, a few
   blocks ahead.
3. The card reads them from the local file and posts them back
   (``/api/ogg/studio/relay_data/<id>/<request>``), and they are passed straight
   on to the TV.

Nothing is written to disk. The link dies when the card stops casting, closes,
or loses its connection. Videos stored by OggStudio 0.13.0 are deleted.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import shutil
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any

import voluptuous as vol
from aiohttp import web
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)

RELAY_URL = "/api/ogg/studio/relay"
DATA_URL = "/api/ogg/studio/relay_data"
RELAYS = "ogg_studio_relays"
BLOCK = 1024 * 1024        # bytes asked of the card at a time
AHEAD = 3                  # blocks asked for ahead of what the TV has had
WAIT = 20                  # s to wait for a block before giving up on that TV request
MAX_PER_USER = 3
EXTENSIONS = {".mp4", ".m4v", ".webm", ".mov", ".mkv", ".ogv"}


def link_name(name: str) -> str:
    """A safe file name for the link (TVs like a familiar extension)."""
    stem, ext = os.path.splitext(os.path.basename(str(name)))
    ext = ext.lower() if ext.lower() in EXTENSIONS else ".mp4"
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")[:40] or "video"
    return safe + ext


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """One byte range (inclusive) from a Range header; None: send it all.

    Raises ValueError when the range is outside the video (answered with 416).
    A header we do not understand (several ranges, other units) is ignored,
    as HTTP allows.
    """
    if not header:
        return None
    m = re.fullmatch(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*", header)
    if not m or (m[1] == "" and m[2] == ""):
        return None
    if m[1] == "":
        length = int(m[2])
        if length == 0:
            raise ValueError("empty suffix range")
        return max(0, size - length), size - 1
    start = int(m[1])
    end = min(int(m[2]), size - 1) if m[2] else size - 1
    if start >= size or start > end:
        raise ValueError("range not satisfiable")
    return start, end


class Relay:
    """One video being cast: the browser that has it, and what the TV waits for."""

    def __init__(self, sid: str, user_id: str | None, size: int, mime: str,
                 send: Callable[[dict[str, Any]], None]) -> None:
        self.sid = sid
        self.user_id = user_id
        self.size = size
        self.mime = mime
        self._send = send
        self._pending: dict[int, asyncio.Future[bytes]] = {}
        self._next = 0
        self.closed = False

    def ask(self, start: int, length: int) -> asyncio.Future[bytes]:
        n = self._next
        self._next += 1
        fut: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
        self._pending[n] = fut
        fut.add_done_callback(lambda _f: self._pending.pop(n, None))
        self._send({"req": n, "start": start, "length": length})
        return fut

    def answer(self, n: int, data: bytes) -> bool:
        fut = self._pending.get(n)
        if fut is None or fut.done():
            return False            # the TV moved on (seek) or gave up
        fut.set_result(data)
        return True

    def close(self) -> None:
        self.closed = True
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(ConnectionError("the browser stopped casting"))


async def stream(relay: Relay, resp: web.StreamResponse, start: int, end: int) -> int:
    """Pass bytes start..end (inclusive) from the browser to the TV. Returns bytes sent."""
    sent = 0
    pos = start
    queue: deque[tuple[asyncio.Future[bytes], int]] = deque()
    try:
        while pos <= end or queue:
            while pos <= end and len(queue) < AHEAD:
                length = min(BLOCK, end - pos + 1)
                queue.append((relay.ask(pos, length), length))
                pos += length
            fut, length = queue.popleft()
            data = await asyncio.wait_for(fut, WAIT)
            if len(data) != length:
                raise ConnectionError("short block from the browser")
            await resp.write(data)
            sent += length
    except (TimeoutError, ConnectionError, OSError) as err:
        _LOGGER.debug("Cast relay %s: TV request ended after %s bytes: %s", relay.sid, sent, err)
    finally:
        for fut, _ in queue:
            fut.cancel()
    return sent


class RelayView(HomeAssistantView):
    """What the TV fetches (signed link; range requests)."""

    url = RELAY_URL + "/{sid}/{name}"
    name = "api:ogg:studio:relay"

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request, sid: str, name: str) -> web.StreamResponse:
        relay = self.hass.data.get(RELAYS, {}).get(sid)
        if relay is None or relay.closed:
            raise web.HTTPNotFound
        try:
            rng = parse_range(request.headers.get("Range"), relay.size)
        except ValueError as err:
            raise web.HTTPRequestRangeNotSatisfiable(headers={"Content-Range": f"bytes */{relay.size}"}) from err
        start, end = rng or (0, relay.size - 1)
        headers = {"Accept-Ranges": "bytes", "Content-Type": relay.mime, "Cache-Control": "no-store",
                   "Content-Length": str(end - start + 1)}
        if rng:
            headers["Content-Range"] = f"bytes {start}-{end}/{relay.size}"
        resp = web.StreamResponse(status=206 if rng else 200, headers=headers)
        await resp.prepare(request)
        if request.method != "HEAD":
            if await stream(relay, resp, start, end) == end - start + 1:
                await resp.write_eof()
            elif request.transport is not None:
                request.transport.close()   # cut short: close so the TV asks again rather than waits
        return resp

    head = get


class RelayDataView(HomeAssistantView):
    """The card's answer: the bytes the TV asked for."""

    url = DATA_URL + "/{sid}/{req}"
    name = "api:ogg:studio:relay_data"

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def post(self, request: web.Request, sid: str, req: str) -> web.Response:
        relay = self.hass.data.get(RELAYS, {}).get(sid)
        user = request.get("hass_user")
        if relay is None or relay.closed or (user is not None and user.id != relay.user_id):
            raise web.HTTPNotFound
        if not req.isdigit():
            raise web.HTTPBadRequest
        data = await request.read()
        return self.json({"used": relay.answer(int(req), data)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ogg/studio/relay",
        vol.Required("name"): str,
        vol.Required("size"): vol.All(int, vol.Range(min=1)),
        vol.Optional("mime", default="video/mp4"): str,
    }
)
@callback
def ws_relay(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Open a relay for one video; it lasts as long as this subscription."""
    relays: dict[str, Relay] = hass.data.setdefault(RELAYS, {})
    user_id = connection.user.id if connection.user else None
    allow = hass.data.get("ogg_studio_allow")
    if allow and not allow(user_id):
        connection.send_error(msg["id"], "unauthorized", "Not allowed")
        return
    mine = [r for r in relays.values() if r.user_id == user_id]
    for old in mine[: max(0, len(mine) - MAX_PER_USER + 1)]:
        old.close()
        relays.pop(old.sid, None)
    sid = secrets.token_hex(16)
    mime = msg["mime"] if msg["mime"].startswith("video/") else "video/mp4"
    msg_id = msg["id"]
    relay = Relay(sid, user_id, msg["size"], mime,
                  lambda event: connection.send_message(websocket_api.event_message(msg_id, event)))
    relays[sid] = relay

    @callback
    def end() -> None:
        relay.close()
        relays.pop(sid, None)

    connection.subscriptions[msg_id] = end
    connection.send_result(msg_id)
    connection.send_message(websocket_api.event_message(
        msg_id, {"ready": True, "id": sid, "url": f"{RELAY_URL}/{sid}/{link_name(msg['name'])}"}))


def _remove_stored(folders: list[Path]) -> int:
    """Delete videos that OggStudio 0.13.0 stored for casting."""
    gone = 0
    for folder in folders:
        if not folder.is_dir():
            continue
        for p in folder.iterdir():
            if p.is_file() and (re.fullmatch(r"[A-Za-z0-9_-]{1,60}-\d{1,14}\.[a-z0-9]{2,4}(\.part)?", p.name)):
                p.unlink(missing_ok=True)
                gone += 1
        if not any(folder.iterdir()):
            shutil.rmtree(folder, ignore_errors=True)
    return gone


async def async_setup_video(hass: HomeAssistant) -> None:
    hass.http.register_view(RelayView(hass))
    hass.http.register_view(RelayDataView(hass))
    websocket_api.async_register_command(hass, ws_relay)
    media = getattr(hass.config, "media_dirs", None) or {}
    folders = [Path(d) / "oggstudio" for d in media.values()] + [Path(hass.config.path("oggstudio_videos"))]
    try:
        gone = await hass.async_add_executor_job(_remove_stored, folders)
        if gone:
            _LOGGER.info("Deleted %s video(s) stored for casting by an earlier OggStudio", gone)
    except OSError:
        _LOGGER.exception("Could not delete videos stored by an earlier OggStudio")
