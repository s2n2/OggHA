"""The Handy over Wi-Fi: one more route to the same Ogg device.

The Handy (firmware 4) is on Bluetooth or on Wi-Fi, never both. On Wi-Fi it
is reached only through Ohdoki's Handy REST API v3 (their servers relay every
command; there is no local Wi-Fi control). This turns that into the same
calls Ogg already makes for a Bluetooth stroker, so the device, its entities
and every card stay as they are; only the route changes.

Moves go as HSP (Handy Streaming Protocol): timed points ("be at x at
time t") in a buffer on the Handy, played by its own clock, which is synced
to the server's. A late request then changes nothing as long as the buffer
is ahead, so:

- a live move (a finger, a held speed, a script the phone plays) becomes
  points a short lead ahead (the time a request takes to reach the Handy,
  about 0.7 s from New Zealand to Ohdoki's servers and back);
- a timeline Ogg plays itself is sent up to HORIZON_S ahead, so it plays
  smoothly through any hiccup in the connection.

The connection key and the Application ID are read from secrets.yaml
(ogg_handy_connection_key, ogg_handy_app_id) and never stored anywhere else
or shown in full.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

if TYPE_CHECKING:
    from .coordinator import OggHub

_LOGGER = logging.getLogger(__name__)

API_URL = "https://www.handyfeeling.com/api/handy-rest/v3"
SECRET_CONNECTION_KEY = "ogg_handy_connection_key"
SECRET_APP_ID = "ogg_handy_app_id"
CONNECTION_KEY_RE = re.compile(r"^[A-Za-z0-9]{5,64}$")
APP_ID_RE = re.compile(r"^[A-Za-z0-9._~+/=-]{8,256}$")

POLL_S = 10.0             # is the Handy on Wi-Fi? (asked this often while Wi-Fi is on)
REQUEST_TIMEOUT_S = 10.0
FLUSH_S = 0.25            # points go at most this often (Ohdoki allows ~4 requests a second)
HORIZON_S = 20.0          # a timeline is sent this far ahead
MAX_ADD = 100             # points per request (the API's limit)
LEAD_MIN_S = 0.5
LEAD_MAX_S = 3.0
HOLD_GAP_MS = 20          # a move starting later than this after the last point first holds
SYNC_SAMPLES = 6
RESYNC_S = 600.0
MODE_HSP = 4


class HandyApiError(Exception):
    """An error from the Handy API (or the way to it)."""

    def __init__(self, message: str, *, name: str = "", connected: bool | None = None) -> None:
        super().__init__(message)
        self.name = name
        self.connected = connected


def mask(value: str | None) -> str:
    """Enough of a key to recognise it, not to use it."""
    if not value:
        return ""
    return f"{value[:2]}…{value[-1:]}" if len(value) > 4 else "…"


class HandyApi:
    """Calls to Ohdoki's Handy REST API v3 for one Handy."""

    def __init__(self, session: aiohttp.ClientSession, app_id: str, connection_key: str) -> None:
        self._session = session
        self._headers = {
            "X-Api-Key": app_id,
            "X-Connection-Key": connection_key,
            "Accept": "application/json",
        }
        self.rtt_ms: float | None = None   # smoothed round trip to the API
        self.offset_ms = 0.0               # server clock - local clock (time.monotonic, ms)

    async def call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        sent = time.monotonic()
        try:
            async with self._session.request(
                method, API_URL + path, json=body, headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S),
            ) as response:
                try:
                    data = await response.json(content_type=None)
                except (ValueError, aiohttp.ContentTypeError):
                    data = None
                status = response.status
        except (aiohttp.ClientError, TimeoutError) as err:
            raise HandyApiError(f"Could not reach the Handy servers ({type(err).__name__})") from err
        rtt = (time.monotonic() - sent) * 1000
        self.rtt_ms = rtt if self.rtt_ms is None else self.rtt_ms * 0.8 + rtt * 0.2
        if status == 401:
            raise HandyApiError("The Application ID was not accepted", name="Unauthenticated")
        if status == 429:
            raise HandyApiError("Too many requests to the Handy servers", name="RateLimited")
        if not isinstance(data, dict):
            raise HandyApiError(f"Unexpected answer from the Handy servers (HTTP {status})")
        error = data.get("error")
        if isinstance(error, dict) and error:
            raise HandyApiError(
                str(error.get("message") or error.get("name") or "Handy error"),
                name=str(error.get("name") or ""), connected=error.get("connected"),
            )
        if status >= 400:
            raise HandyApiError(f"The Handy servers refused the request (HTTP {status})")
        result = data.get("result", data)
        return result if isinstance(result, dict) else {"value": result}

    def server_now(self) -> int:
        """The server's clock now (ms), estimated."""
        return int(time.monotonic() * 1000 + self.offset_ms)

    async def sync_clock(self, samples: int = SYNC_SAMPLES) -> None:
        """Server clock offset: the documented method (server time + half the round trip)."""
        offsets: list[tuple[float, float]] = []
        for _ in range(samples):
            sent = time.monotonic() * 1000
            result = await self.call("GET", "/servertime")
            got = time.monotonic() * 1000
            server = result.get("server_time")
            if isinstance(server, (int, float)):
                offsets.append((got - sent, server + (got - sent) / 2 - got))
        if not offsets:
            raise HandyApiError("The Handy servers did not give their time")
        # The quickest answers say the most about the clock.
        offsets.sort()
        best = offsets[: max(1, len(offsets) // 2)]
        self.offset_ms = sum(offset for _, offset in best) / len(best)


@dataclass
class _Point:
    t: int        # ms of stream time
    x: int        # 0-100


class HandyStream:
    """The Handy's HSP buffer, kept ahead of where it is playing.

    Times are local (time.monotonic seconds); stream time 0 is local time
    t0. Moves and timelines become points; a background task sends them in
    batches (at most every FLUSH_S) once they are within HORIZON_S.
    """

    def __init__(self, api: HandyApi, on_change: Callable[[], None]) -> None:
        self.api = api
        self._on_change = on_change
        self.playing = False
        self._t0 = time.monotonic()
        self._pending: list[_Point] = []
        self._sent: _Point | None = None        # the newest point the Handy has
        self._tail = 0
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._lead_extra = 0.0
        self.last_error: str | None = None

    # ------------------------------------------------------------- timing
    @property
    def lead_s(self) -> float:
        """How far ahead a live move is placed: the time to reach the Handy, with room."""
        rtt = (self.api.rtt_ms or 400) / 1000
        return min(LEAD_MAX_S, max(LEAD_MIN_S, FLUSH_S + 1.5 * rtt + 0.15 + self._lead_extra))

    def _ms(self, at: float) -> int:
        return int(round((at - self._t0) * 1000))

    @property
    def _last(self) -> _Point | None:
        return self._pending[-1] if self._pending else self._sent

    # ------------------------------------------------------------- points
    def _add(self, t: int, x: float) -> None:
        last = self._last
        if last is not None and t <= last.t:
            t = last.t + 1
        self._pending.append(_Point(max(0, t), int(round(min(100.0, max(0.0, x))))))

    def _make_room(self, start: int) -> int:
        """Where a move meant to start at stream time start can begin.

        A newer move replaces what is left of an older one while those points
        are still here; what the Handy already has plays out first.
        """
        last = self._last
        if last is None or start > last.t:
            return start
        if self._sent is not None and start <= self._sent.t:
            start = self._sent.t + 1
            if not self._pending:
                return start
        before = self._sent
        keep: list[_Point] = []
        for point in self._pending:
            if point.t > start:
                break
            keep.append(point)
            before = point
        if len(keep) == len(self._pending):
            return start
        after = self._pending[len(keep)]
        if before is None:
            x: float = after.x
        else:
            share = (start - before.t) / max(1, after.t - before.t)
            x = before.x + (after.x - before.x) * share
        self._pending = keep
        self._add(start, x)
        return start

    def move(self, x: float, duration_ms: float, *, start: float | None = None) -> None:
        """Go to x over duration_ms from local time start (default: now + lead)."""
        begin = self._make_room(self._ms(start if start is not None else time.monotonic() + self.lead_s))
        last = self._last
        if last is not None and begin - last.t > HOLD_GAP_MS:
            self._add(begin, last.x)      # stays where it is until the move starts
        # With nothing before it, the Handy goes there from wherever it is.
        self._add(begin + max(1, int(duration_ms)), x)
        self._wake.set()

    def timeline(self, points: list[tuple[float, float]]) -> None:
        """Points at local times (a timeline played here), after what is there."""
        for at, x in points:
            self._add(self._ms(at), x)
        if points:
            self._wake.set()

    # ------------------------------------------------------------- control
    async def clear(self) -> None:
        """Drop everything not yet played (a newer command takes over)."""
        self._pending.clear()
        if self.playing and self._sent is not None:
            try:
                await self.api.call("PUT", "/hsp/flush")
            except HandyApiError as err:
                _LOGGER.debug("Handy Wi-Fi flush failed: %s", err)
        self._sent = None

    async def stop(self) -> None:
        """Stop moving now; the next move starts a new stream."""
        self._pending.clear()
        self._sent = None
        was, self.playing = self.playing, False
        if was:
            try:
                await self.api.call("PUT", "/hsp/stop")
            except HandyApiError as err:
                _LOGGER.debug("Handy Wi-Fi stop failed: %s", err)
            self._on_change()

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run(), name="ogg_handy_wifi_stream")

    async def shutdown(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await self.stop()

    # ------------------------------------------------------------- sending
    def _due_in(self) -> float | None:
        """Seconds until the first waiting point is within the horizon (None: nothing waits)."""
        if not self._pending:
            return None
        return max(0.0, (self._pending[0].t - self._ms(time.monotonic() + HORIZON_S)) / 1000)

    async def _run(self) -> None:
        while True:
            due = self._due_in()
            if due is None or due > 0:
                self._wake.clear()
                try:
                    async with asyncio.timeout(due):
                        await self._wake.wait()
                except TimeoutError:
                    pass
                continue
            began = time.monotonic()
            try:
                await self._send_due()
                self.last_error = None
            except HandyApiError as err:
                self.last_error = str(err)
                _LOGGER.debug("Handy Wi-Fi points not sent: %s", err)
                if err.connected is False:
                    self._pending.clear()
                    self._sent = None
                    self.playing = False
                    self._on_change()
                await asyncio.sleep(2.0 if err.name == "RateLimited" else 0.5)
            await asyncio.sleep(max(0.0, FLUSH_S - (time.monotonic() - began)))

    async def _send_due(self) -> None:
        horizon = self._ms(time.monotonic() + HORIZON_S)
        batch = [p for p in self._pending[:MAX_ADD] if p.t <= horizon]
        if not batch:
            return
        add: dict[str, Any] = {"points": [{"t": p.t, "x": p.x} for p in batch]}
        if not self.playing:
            await self._begin(add)
        else:
            add["tail_point_stream_index"] = self._tail + len(batch)
            state = await self.api.call("PUT", "/hsp/add", add)
            self._tail += len(batch)
            self._check_late(state, batch[0].t)
        # Only what was sent goes (a newer move may have replaced the rest meanwhile).
        if self._pending[: len(batch)] == batch:
            del self._pending[: len(batch)]
        else:
            self._pending = [p for p in self._pending if p.t > batch[-1].t]
        self._sent = batch[-1]

    async def _begin(self, add: dict[str, Any]) -> None:
        """A new stream: HSP mode, a fresh session, then play in step with the server's clock."""
        await self.api.call("PUT", "/mode2", {"mode": MODE_HSP})
        await self.api.call("PUT", "/hsp/setup", {})
        self._tail = len(add["points"])
        add["tail_point_stream_index"] = self._tail
        now = time.monotonic()
        state = await self.api.call("PUT", "/hsp/play", {
            "start_time": max(0, self._ms(now)),
            "server_time": int(now * 1000 + self.api.offset_ms),
            "pause_on_starving": False,
            "add": add,
        })
        self.playing = True
        self._check_late(state, add["points"][0]["t"])
        self._on_change()

    def _check_late(self, state: dict[str, Any], first_t: int) -> None:
        """Points that reached the Handy after their time: place live moves further ahead."""
        now_t = state.get("current_time")
        if isinstance(now_t, (int, float)) and now_t > first_t:
            self._lead_extra = min(1.5, self._lead_extra + 0.1)
        else:
            self._lead_extra = max(0.0, self._lead_extra - 0.01)


class HandyWifi:
    """Ogg's Wi-Fi route to the Handy: switched on by hand, one device."""

    def __init__(self, hass: HomeAssistant, hub: OggHub) -> None:
        self.hass = hass
        self.hub = hub
        self.on = False
        self.device_key: str | None = None
        self.online = False
        self.firmware: str | None = None
        self.last_error: str | None = None
        self.checked_at: float | None = None
        self._connection_key: str | None = None
        self._app_id: str | None = None
        self.api: HandyApi | None = None
        self.stream: HandyStream | None = None
        self._poll: asyncio.Task | None = None
        self._synced_at = 0.0
        self._listeners: set[Callable[[], None]] = set()

    # ------------------------------------------------------------- settings
    def load(self, saved: dict[str, Any]) -> None:
        self.on = saved.get("on") is True
        key = saved.get("device_key")
        self.device_key = key if isinstance(key, str) else None

    def stored(self) -> dict[str, Any]:
        return {"on": self.on, "device_key": self.device_key}

    @property
    def has_keys(self) -> bool:
        return bool(self._connection_key and self._app_id)

    def routes(self, key: str) -> bool:
        """Does this device go over Wi-Fi now?"""
        return self.on and key == self.bound_key

    @property
    def bound_key(self) -> str | None:
        """The Handy among Ogg's devices: the one chosen, or the stroker named Handy."""
        devices = self.hub.devices
        if self.device_key in devices:
            return self.device_key
        strokers = [k for k, d in devices.items() if d.linear_count]
        named = [k for k in strokers if "handy" in f"{devices[k].alias} {devices[k].raw.get('DeviceName', '')}".lower()]
        return (named or strokers or [None])[0]

    @property
    def lead_ms(self) -> int:
        return int(round(self.stream.lead_s * 1000)) if self.stream else int(LEAD_MIN_S * 1000)

    # ------------------------------------------------------------- listeners
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _changed(self) -> None:
        for listener in tuple(self._listeners):
            try:
                listener()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("A Handy Wi-Fi listener failed")
        self.hub.wifi_changed()

    # ------------------------------------------------------------- keys
    async def async_load_keys(self) -> None:
        secrets = await self.hass.async_add_executor_job(_read_secrets, self.hass.config.path("secrets.yaml"))
        connection_key = secrets.get(SECRET_CONNECTION_KEY)
        app_id = secrets.get(SECRET_APP_ID)
        self._connection_key = connection_key if isinstance(connection_key, str) and CONNECTION_KEY_RE.match(connection_key) else None
        self._app_id = app_id if isinstance(app_id, str) and APP_ID_RE.match(app_id) else None
        old_stream = self.stream
        if self.has_keys:
            self.api = HandyApi(async_get_clientsession(self.hass), self._app_id, self._connection_key)
            self.stream = HandyStream(self.api, self._changed)
            self._synced_at = 0.0
        else:
            self.api = None
            self.stream = None
        if old_stream is not None:
            await old_stream.shutdown()

    async def async_save_keys(self, connection_key: str | None, app_id: str | None) -> None:
        """Write the keys to secrets.yaml (only Ogg's two lines change)."""
        if connection_key is not None and not CONNECTION_KEY_RE.match(connection_key):
            raise ValueError("A connection key is 5-64 letters and digits")
        if app_id is not None and not APP_ID_RE.match(app_id):
            raise ValueError("That does not look like an Application ID")
        values = {
            SECRET_CONNECTION_KEY: connection_key,
            SECRET_APP_ID: app_id,
        }
        await self.hass.async_add_executor_job(
            _write_secrets, self.hass.config.path("secrets.yaml"),
            {k: v for k, v in values.items() if v is not None},
        )
        await self.async_load_keys()
        if self.on:
            self.start()
        self._changed()

    # ------------------------------------------------------------- on / off
    async def async_set(self, on: bool | None = None, device_key: str | None = None) -> None:
        if device_key is not None:
            if device_key not in self.hub.devices or not self.hub.devices[device_key].linear_count:
                raise ValueError("Choose a stroker Ogg knows")
            self.device_key = device_key
        if on is not None and bool(on) != self.on:
            key = self.bound_key
            if key is not None:
                await self.hub.async_stop_route(key)   # whatever was moving it stops first
            self.on = bool(on)
            if self.on:
                self.start()
            else:
                await self.async_stop_polling()
                if self.stream is not None:
                    await self.stream.stop()
                self.online = False
        self.hub.save_later()
        self._changed()

    def start(self) -> None:
        if not self.on or not self.hub.enabled or self.api is None:
            return
        if self._poll is None or self._poll.done():
            self._poll = self.hub.entry.async_create_background_task(self.hass, self._poll_loop(), "ogg_handy_wifi_poll")
        if self.stream is not None:
            self.stream.start()

    async def async_stop_polling(self) -> None:
        task, self._poll = self._poll, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def async_shutdown(self) -> None:
        await self.async_stop_polling()
        if self.stream is not None:
            await self.stream.shutdown()
        self.online = False

    async def _poll_loop(self) -> None:
        while self.on and self.api is not None:
            await self.async_check()
            await asyncio.sleep(POLL_S)

    async def async_check(self) -> dict[str, Any]:
        """Is it on Wi-Fi? Its firmware, the round trip and the clock (a Test too)."""
        if self.api is None:
            self.last_error = "Add the connection key and Application ID first"
            self._changed()
            return self.status()
        was = self.online
        try:
            result = await self.api.call("GET", "/connected")
            self.online = bool(result.get("connected"))
            if self.online and (not was or self.firmware is None):
                info = await self.api.call("GET", "/info")
                self.firmware = str(info.get("fw_version") or "") or None
            if self.online and time.monotonic() - self._synced_at > RESYNC_S:
                await self.api.sync_clock()
                self._synced_at = time.monotonic()
            self.last_error = None if self.online else "The Handy is not on Wi-Fi (or is switched off)"
        except HandyApiError as err:
            self.online = False
            self.last_error = str(err)
        self.checked_at = time.time()
        if was != self.online:
            if not self.online and self.stream is not None:
                self.stream.playing = False
            _LOGGER.info("The Handy is %s over Wi-Fi", "reachable" if self.online else "not reachable")
        self._changed()
        return self.status()

    # ------------------------------------------------------------- moves
    def linear(self, position: float, duration_ms: float, *, deadline: float | None = None) -> None:
        if self.stream is None:
            raise HandyApiError("Add the connection key and Application ID first")
        if deadline is not None:
            # A timeline step: it ends at its point's time (plus the lead, as live moves do).
            self.stream.move(position, duration_ms, start=deadline - duration_ms / 1000 + self.stream.lead_s)
        else:
            self.stream.move(position, duration_ms)

    async def play_timeline(
        self, actions: list[tuple[float, float]], speed: float, loop: bool,
        max_seconds: float | None, start_ms: float,
    ) -> None:
        """A whole timeline, sent up to HORIZON_S ahead: (ms, level 0-1) points at speed."""
        stream = self.stream
        if stream is None or not actions:
            return
        await stream.clear()
        began = time.monotonic()
        limit = began + max_seconds if max_seconds is not None else None
        offset = max(0.0, float(start_ms or 0))
        if offset >= actions[-1][0]:
            offset = 0.0
        # The first point a little later, so the Handy can get there from wherever it is.
        start = began + stream.lead_s + 0.4 - offset / speed / 1000
        try:
            while True:
                points = [(start + at / speed / 1000, level * 100) for at, level in actions if at >= offset]
                if limit is not None:
                    points = [p for p in points if p[0] <= limit]
                while points:
                    reach = time.monotonic() + HORIZON_S
                    count = next((i for i, p in enumerate(points) if p[0] > reach), len(points))
                    stream.timeline(points[:count])
                    points = points[count:]
                    if points:
                        await asyncio.sleep(min(5.0, max(1.0, points[0][0] - reach)))
                end = start + actions[-1][0] / speed / 1000
                await asyncio.sleep(max(0.0, end - time.monotonic()))
                if not loop or (limit is not None and time.monotonic() >= limit):
                    return
                offset = 0.0
                start = end
        except asyncio.CancelledError:
            await stream.clear()
            raise

    async def stop(self) -> None:
        if self.stream is not None:
            await self.stream.stop()

    # ------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        key = self.bound_key
        device = self.hub.devices.get(key) if key else None
        stream = self.stream
        return {
            "on": self.on,
            "ogg_enabled": self.hub.enabled,
            "keys": {"connection_key": bool(self._connection_key), "app_id": bool(self._app_id)},
            "connection_key_hint": mask(self._connection_key),
            "online": self.online,
            "firmware": self.firmware,
            "rtt_ms": int(self.api.rtt_ms) if self.api and self.api.rtt_ms else None,
            "lead_ms": self.lead_ms if stream else None,
            "playing": bool(stream and stream.playing),
            "last_error": self.last_error or (stream.last_error if stream else None),
            "checked_at": self.checked_at,
            "device": {"key": key, "name": device.alias} if device else None,
            "strokers": [
                {"key": k, "name": d.alias} for k, d in self.hub.devices.items() if d.linear_count
            ],
        }


def _read_secrets(path: str) -> dict[str, Any]:
    from homeassistant.util.yaml import load_yaml_dict

    try:
        data = load_yaml_dict(path)
    except FileNotFoundError:
        return {}
    except Exception as err:  # noqa: BLE001 - a broken secrets file must not break Ogg
        _LOGGER.warning("Could not read secrets.yaml for the Handy keys: %s", type(err).__name__)
        return {}
    return data if isinstance(data, dict) else {}


def _write_secrets(path: str, values: dict[str, str]) -> None:
    """Set Ogg's keys in secrets.yaml, keeping every other line as it was."""
    import os

    from homeassistant.util.file import write_utf8_file_atomic

    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except FileNotFoundError:
        text = ""
    lines = text.splitlines()
    for name, value in values.items():
        line = f'{name}: "{value}"'
        pattern = re.compile(rf"^{re.escape(name)}\s*:")
        for index, existing in enumerate(lines):
            if pattern.match(existing):
                lines[index] = line
                break
        else:
            if not any(l.startswith("# Ogg: The Handy over Wi-Fi") for l in lines):
                if lines and lines[-1].strip():
                    lines.append("")
                lines.append("# Ogg: The Handy over Wi-Fi (Connect Handy card)")
            lines.append(line)
    mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o600
    write_utf8_file_atomic(path, "\n".join(lines) + "\n", private=mode == 0o600)
