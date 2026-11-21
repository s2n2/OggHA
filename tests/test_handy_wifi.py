"""The Handy over Wi-Fi: moves and timelines become timed HSP points, sent ahead."""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.ogg import handy_wifi
from custom_components.ogg.coordinator import OggHub
from custom_components.ogg.handy_wifi import (
    HandyApiError,
    HandyStream,
    _read_secrets,
    _write_secrets,
    mask,
)


class FakeApi:
    """Records calls; answers like the Handy API."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict | None]] = []
        self.rtt_ms = 300.0
        self.offset_ms = 1_000_000.0
        self.fail: HandyApiError | None = None

    async def call(self, method, path, body=None):
        if self.fail is not None:
            raise self.fail
        self.calls.append((method, path, body))
        return {}       # no current_time: the lead stays from the round trip

    def points(self) -> list[tuple[int, int]]:
        out = []
        for _, path, body in self.calls:
            if path == "/hsp/add":
                out += [(p["t"], p["x"]) for p in body["points"]]
            if path == "/hsp/play":
                out += [(p["t"], p["x"]) for p in body["add"]["points"]]
        return out


async def settle(stream: HandyStream, seconds: float = 0.4) -> None:
    await asyncio.sleep(seconds)


@pytest.fixture
async def stream():
    api = FakeApi()
    s = HandyStream(api, lambda: None)
    s.start()
    yield s
    await s.shutdown()


async def test_a_move_starts_a_stream_in_step_with_the_server_clock(stream):
    stream.move(80, 300)
    await settle(stream)
    paths = [path for _, path, _ in stream.api.calls]
    assert paths[:3] == ["/mode2", "/hsp/setup", "/hsp/play"]
    play = stream.api.calls[2][2]
    assert play["pause_on_starving"] is False
    # server_time is the local time it was sent, on the server's clock.
    assert abs(play["server_time"] - (time.monotonic() * 1000 + stream.api.offset_ms)) < 1000
    # The first move: from wherever it is, to 80, a lead ahead plus its 300 ms.
    [(t, x)] = stream.api.points()
    assert x == 80
    assert t - play["start_time"] == pytest.approx(stream.lead_s * 1000 + 300, abs=60)
    assert stream.playing


async def test_moves_hold_then_go_and_are_sent_together(stream):
    stream.move(20, 200)
    await settle(stream)
    stream.move(90, 300)          # later: holds at 20 until this move starts
    await settle(stream)
    points = stream.api.points()
    assert [x for _, x in points] == [20, 20, 90]
    assert points[2][0] - points[1][0] == 300
    assert all(b[0] > a[0] for a, b in zip(points, points[1:]))
    adds = [body for _, path, body in stream.api.calls if path == "/hsp/add"]
    assert adds and adds[-1]["tail_point_stream_index"] == 3


async def test_a_newer_move_replaces_what_is_left_of_an_older_one(stream):
    # Both before anything is sent: the second cuts the first short where it starts.
    stream.move(0, 50)
    await settle(stream)
    stream.move(100, 2000, start=time.monotonic() + 1.0)
    stream.move(50, 200, start=time.monotonic() + 1.5)
    await settle(stream)
    points = stream.api.points()
    xs = [x for _, x in points]
    assert xs[-1] == 50
    # The 100 was never reached: about a quarter of the way at 1.5 s.
    assert 100 not in xs
    assert all(b[0] > a[0] for a, b in zip(points, points[1:]))


async def test_a_timeline_goes_ahead_but_only_within_the_horizon(stream, monkeypatch):
    monkeypatch.setattr(handy_wifi, "HORIZON_S", 2.0)
    now = time.monotonic()
    stream.timeline([(now + 1 + i * 0.1, i % 2 * 100) for i in range(10)])   # within 2 s
    stream.timeline([(now + 30, 50)])                                         # far ahead
    await settle(stream, 0.6)
    assert len(stream.api.points()) == 10
    assert stream._pending and stream._pending[0].x == 50


async def test_stop_and_clear(stream):
    stream.move(70, 300)
    await settle(stream)
    await stream.clear()
    assert ("PUT", "/hsp/flush", None) in stream.api.calls
    assert stream.playing
    await stream.stop()
    assert ("PUT", "/hsp/stop", None) in stream.api.calls
    assert not stream.playing
    stream.move(30, 300)        # a new stream after a stop
    await settle(stream)
    assert [path for _, path, _ in stream.api.calls].count("/hsp/setup") == 2


async def test_a_handy_off_wifi_stops_the_stream(stream):
    stream.api.fail = HandyApiError("Device not connected", name="DeviceNotConnected", connected=False)
    stream.move(70, 300)
    await settle(stream, 0.8)
    assert not stream.playing and not stream._pending
    assert stream.last_error == "Device not connected"


async def test_lead_follows_the_round_trip(stream):
    stream.api.rtt_ms = 300
    assert 0.8 <= stream.lead_s <= 0.95
    stream.api.rtt_ms = 20
    assert stream.lead_s == handy_wifi.LEAD_MIN_S
    stream._check_late({"current_time": 5000}, 4000, 4300)   # a point arrived late, 700 ms on the way
    assert stream._lead_extra > 0
    # Once measured, the lead is how long points take to reach the Handy (plus room).
    assert stream.lead_s == pytest.approx(handy_wifi.FLUSH_S + 0.7 + 0.15 + stream._lead_extra, abs=0.01)


def test_keys_are_written_to_secrets_without_touching_other_lines(tmp_path):
    path = tmp_path / "secrets.yaml"
    path.write_text("some_password: abc\nother: 'x y'", encoding="utf-8")
    _write_secrets(str(path), {"ogg_handy_connection_key": "AbC123xy", "ogg_handy_app_id": "app.ID-1_x"})
    text = path.read_text(encoding="utf-8")
    assert text.startswith("some_password: abc\nother: 'x y'\n")
    assert _read_secrets(str(path)) == {
        "some_password": "abc", "other": "x y",
        "ogg_handy_connection_key": "AbC123xy", "ogg_handy_app_id": "app.ID-1_x",
    }
    _write_secrets(str(path), {"ogg_handy_connection_key": "Zz9"})     # replaced in place
    assert path.read_text(encoding="utf-8").count("ogg_handy_connection_key") == 1
    assert _read_secrets(str(path))["ogg_handy_connection_key"] == "Zz9"
    assert _read_secrets(str(tmp_path / "missing.yaml")) == {}


def test_keys_are_only_ever_shown_masked():
    assert mask("Ab12Cd3Z") == "Ab…Z"
    assert mask("") == ""


# ---------------------------------------------------------------- the hub's route
class Entry:
    def async_create_background_task(self, hass, coro, name):
        return asyncio.get_running_loop().create_task(coro, name=name)


def wifi_hub(online: bool = True):
    hub = OggHub.__new__(OggHub)
    device = SimpleNamespace(
        key="h", alias="The Handy", raw={"DeviceName": "The Handy"}, connected=False, recovering=False,
        commands_enabled=True, linear_count=1, motor_count=0, aux_values={},
    )
    hub.hass = None
    hub.entry = Entry()
    hub.devices = {"h": device}
    hub.enabled = True
    hub._shutting_down = False
    hub._ready = False
    hub._client = None
    hub._operation_epoch = 0
    hub._linear_runs = {}
    hub._linear_serials = {}
    hub._listeners = set()
    moves: list[tuple[float, float]] = []
    timelines: list[list] = []

    async def play_timeline(actions, speed, loop, max_seconds, start_ms):
        timelines.append(actions)

    hub.wifi = SimpleNamespace(
        routes=lambda key: key == "h", online=online,
        linear=lambda position, duration, deadline=None: moves.append((position, duration)),
        play_timeline=play_timeline,
    )
    return hub, device, moves, timelines


async def test_the_handy_on_wifi_is_online_without_bluetooth():
    hub, device, _, _ = wifi_hub()
    assert hub.device_online(device)                      # no Buttplug server at all
    hub.wifi.online = False
    assert not hub.device_online(device)


async def test_live_moves_and_timelines_take_the_wifi_route():
    hub, device, moves, timelines = wifi_hub()
    await hub.async_linear("h", 75, 200)
    assert moves == [(75.0, 200)]
    assert device.aux_values["linear_0"] == 75
    await hub.async_play_linear("h", {"actions": [{"at": 0, "pos": 10}, {"at": 500, "pos": 90}]})
    await asyncio.sleep(0.05)
    assert timelines and [round(level * 100) for _, level in timelines[0]] == [10, 90]


async def test_no_move_while_the_handy_is_off_wifi():
    hub, _, moves, _ = wifi_hub(online=False)
    with pytest.raises(HomeAssistantError):
        await hub.async_linear("h", 75, 200)
    assert moves == []


async def test_the_last_move_ends_with_a_hold_sent_just_in_time(stream):
    # After its last point the Handy runs on to the end of the stroke: a hold stops it.
    stream.move(60, 300)
    await settle(stream, 0.3)
    assert [x for _, x in stream.api.points()] == [60]          # the hold waits
    await settle(stream, 1.2)
    points = stream.api.points()
    assert [x for _, x in points] == [60, 60]
    assert points[1][0] - points[0][0] == handy_wifi.TAIL_HOLD_MS
    # ... and it got there before the move ended (a lead's worth of travel time in hand).
    hold_sent = next(i for i, (_, path, _) in enumerate(stream.api.calls) if path == "/hsp/add")
    assert hold_sent


async def test_a_following_move_replaces_the_waiting_hold(stream):
    stream.move(60, 300)
    await settle(stream, 0.3)
    stream.move(20, 300)            # a finger moving on: no hold in between
    await settle(stream, 0.3)
    xs = [x for _, x in stream.api.points()]
    assert xs in ([60], [60, 20])          # straight on from 60 to 20: the end hold at 60 never went
    assert stream._pending and stream._pending[-1].hold and stream._pending[-1].x == 20
