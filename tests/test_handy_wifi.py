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
    assert play["pause_on_starving"] is True        # out of points it stops, never runs on
    # server_time is the local time it was sent, on the server's clock.
    assert abs(play["server_time"] - (time.monotonic() * 1000 + stream.api.offset_ms)) < 1000
    # The first move: from wherever it is, to 80, a lead ahead plus its 300 ms.
    [(t, x)] = stream.api.points()
    assert x == 80
    assert t - play["start_time"] == pytest.approx(stream.lead_s * 1000 + 300, abs=60)
    assert stream.playing


async def test_moves_hold_then_go_and_are_sent_together(stream):
    stream.move(20, 200)
    await settle(stream, 0.7)
    stream.move(90, 300)          # a while later: holds at 20 until this move starts
    await settle(stream)
    points = stream.api.points()
    assert [x for _, x in points] == [20, 20, 90]
    assert points[2][0] - points[1][0] == 300
    assert all(b[0] > a[0] for a, b in zip(points, points[1:]))
    sends = [body if path == "/hsp/add" else body["add"] for _, path, body in stream.api.calls if path in ("/hsp/add", "/hsp/play")]
    assert sends[-1]["tail_point_stream_index"] == 3


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
    stream.api.rtt_ms = 300                      # nothing to the Handy yet: from the server's round trip
    assert 1.0 <= stream.lead_s <= 1.2
    stream._rtts = [1100, 1300, 1250, 2600, 1200]   # requests that reach the Handy (measured over Wi-Fi)
    reach = handy_wifi.REACH_SHARE * 2600 / 1000
    assert stream.lead_s == pytest.approx(handy_wifi.FLUSH_S + reach + 0.15, abs=0.01)
    stream._rtts = [100, 120, 110]
    assert stream.lead_s == handy_wifi.LEAD_MIN_S


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


async def test_after_a_pause_the_stream_is_put_back_in_step(stream):
    # The Handy pauses (and its clock with it) when it runs out of points: the
    # next move goes with /hsp/play from our time now, not as an add.
    stream.move(60, 100)
    await settle(stream, 0.3)
    await asyncio.sleep(stream.lead_s + 0.3)          # its last point is past: it has paused
    stream.move(20, 300)
    await settle(stream, 0.4)
    plays = [body for _, path, body in stream.api.calls if path == "/hsp/play"]
    assert len(plays) == 2 and [path for _, path, _ in stream.api.calls].count("/hsp/setup") == 1
    second = plays[1]
    assert second["pause_on_starving"] is True
    assert second["start_time"] == pytest.approx((time.monotonic() - stream._t0) * 1000, abs=600)
    xs = [p["x"] for p in second["add"]["points"]]
    assert xs == [60, 20]                               # waits where it stopped, then moves
    assert second["add"]["tail_point_stream_index"] == 3


async def test_moves_in_quick_succession_go_as_adds(stream):
    stream.move(60, 600)
    await settle(stream, 0.3)
    stream.move(20, 600)                                # well before the first one ends
    await settle(stream, 0.4)
    paths = [path for _, path, _ in stream.api.calls]
    assert paths.count("/hsp/play") == 1 and "/hsp/add" in paths


async def test_a_script_target_asked_again_adds_nothing(stream):
    # The card asks for a script's next point again about every second.
    start = time.monotonic() + 1.0
    stream.move(80, 2000, start=start)
    stream.move(80, 1500, start=start + 0.5)
    stream.move(80, 1000, start=start + 1.0)
    assert [p.x for p in stream._pending] == [80]


async def test_overlapping_moves_arrive_on_time_and_never_drift(stream):
    # Live moves each overlap the last a little (and some get sent in between):
    # every move still arrives when it was meant to.
    base = time.monotonic() + 1.0
    for i in range(20):
        stream.move(20 if i % 2 else 80, 200, start=base + i * 0.185)
        if i % 3 == 0:
            await asyncio.sleep(0.3)          # some go out before the next arrives
    await settle(stream, 0.4)
    points = stream.api.points() + [(p.t, p.x) for p in stream._pending]
    last_meant = stream._ms(base + 19 * 0.185) + 200
    assert points[-1][1] == 20
    assert abs(points[-1][0] - last_meant) <= 20      # no drift (it was 15 ms per move, adding up)


async def test_a_script_played_by_the_card_lands_on_time(stream, monkeypatch):
    # As the Play card plays a script: each next point is asked a lead ahead
    # (its connected sensor's lead_ms, rounded), with the time left to it; the
    # same point is asked again each second while far off. Every stroke lands
    # at its own time, the last as surely as the first.
    monkeypatch.setattr(handy_wifi, "FLUSH_S", 0.05)
    actions = [(1500 + i * 700, 15 if i % 2 else 90) for i in range(8)] + [(1500 + 7 * 700 + 2500, 50)]
    stream._rtts = [1300.0] * 5                  # a steady Wi-Fi round trip (the fake answers at once)
    monkeypatch.setattr(stream, "_post", _no_rtt(stream._post))
    t0 = time.monotonic()
    asked = {}
    while (now := time.monotonic() - t0) < actions[-1][0] / 1000:
        card_lead = round(stream.lead_s * 1000 / 50) * 50 / 1000     # its connected sensor's lead_ms
        ms = (now + card_lead) * 1000
        nxt = next(((at, x) for at, x in actions if at > ms), None)
        if nxt and (asked.get(nxt[0]) is None or now - asked[nxt[0]] >= 1.0):
            asked[nxt[0]] = now
            stream.move(nxt[1], nxt[0] - ms)
        await asyncio.sleep(0.02)
    await settle(stream, 0.3)
    points = stream.api.points() + [(p.t, p.x) for p in stream._pending]
    for at, x in actions:
        want = stream._ms(t0) + at          # the card reads it a lead ahead; Ogg places it a lead ahead
        got = [t for t, px in points if px == x and abs(t - want) <= 80]
        assert got, f"the point {x} at {at} ms did not land on time"


async def test_a_finger_with_jittery_timing_moves_without_stops_or_cut_turns(stream):
    # Live moves reach Home Assistant a little early or late: each still carries
    # straight on from the last (no hold point, no turn cut short), and the
    # delay stays the same (no drift).
    import random
    rnd = random.Random(3)
    base = time.monotonic() + stream.lead_s
    meant, xs = base, []
    for i in range(16):
        x = 85 if i % 2 else 15
        xs.append(x)
        stream.move(x, 180, start=meant + rnd.uniform(-0.05, 0.08))
        meant += 0.18
        if i % 4 == 0:
            await asyncio.sleep(0.3)
    await settle(stream, 0.4)
    points = stream.api.points() + [(p.t, p.x) for p in stream._pending]
    assert [x for _, x in points] == xs                 # every turn, nothing in between
    assert abs(points[-1][0] - stream._ms(meant)) <= 100



def _no_rtt(post):
    """The fake answers at once: keep the measured round trip as set."""
    async def wrapped(path, body, sent, began):
        await post(path, body, sent, time.monotonic())
    return wrapped


class SlowApi(FakeApi):
    """Answers like a Handy over Wi-Fi: each request taken after 0.6 s, answered after 1.2 s."""

    def __init__(self, behind: int | None = None) -> None:
        super().__init__()
        self.behind = behind
        self.stream = None

    async def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        await asyncio.sleep(1.2)
        if path in ("/hsp/add", "/hsp/play") and self.stream is not None:
            now = self.stream._ms(time.monotonic())
            return {"current_time": now - 1200 - (self.behind or 0) + 600}
        return {}


async def test_batches_go_without_waiting_for_the_last_answer():
    api = SlowApi()
    s = HandyStream(api, lambda: None)
    api.stream = s
    s.start()
    await s.prepare()                            # done ahead when the Handy comes online
    try:
        for i in range(8):                       # a finger: a move every 0.2 s
            s.move(85 if i % 2 else 15, 200)
            await asyncio.sleep(0.2)
        sent = [path for _, path, _ in api.calls if path in ("/hsp/add", "/hsp/play")]
        # Not one every 1.2 s: about one per move, while earlier ones are still unanswered.
        assert len(sent) >= 6
        assert len(s._inflight) >= 2
    finally:
        await s.shutdown()


async def test_a_handy_whose_clock_fell_behind_is_put_back_in_step():
    api = SlowApi(behind=1500)                   # it paused out of points for a while
    s = HandyStream(api, lambda: None)
    api.stream = s
    s.start()
    await s.prepare()
    try:
        s.move(80, 300)
        await asyncio.sleep(2.0)                 # the first answer says it is behind
        assert s._resync
        s.move(20, 300, start=time.monotonic() + 0.3)
        await asyncio.sleep(0.4)
        assert [path for _, path, _ in api.calls if path in ("/hsp/add", "/hsp/play")][-1] == "/hsp/play"
    finally:
        await s.shutdown()
