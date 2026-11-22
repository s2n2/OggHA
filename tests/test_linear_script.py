"""Stroker timelines played in Home Assistant (Ogg Studio with the screen off)."""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.ogg.coordinator import OggHub
from custom_components.ogg.patterns import ScriptProgram


class Entry:
    def async_create_background_task(self, hass, coro, name):
        return asyncio.get_running_loop().create_task(coro, name=name)


def make_hub(linear_count: int = 1):
    """An OggHub with just what the linear runner touches; LinearCmd is recorded."""
    hub = OggHub.__new__(OggHub)
    device = SimpleNamespace(
        key="k", connected=True, commands_enabled=True, linear_count=linear_count, motor_count=0
    )
    hub.hass = None
    hub.entry = Entry()
    hub.devices = {"k": device}
    hub.enabled = True
    hub._operation_epoch = 0
    hub._linear_runs = {}
    hub._linear_serials = {}
    hub._require_online = lambda dev: None
    hub.wifi = SimpleNamespace(routes=lambda key: False)   # Bluetooth
    sent: list[tuple[float, float, float]] = []
    start = time.monotonic()
    real_linear = OggHub.async_linear

    async def linear(key, position, duration, index=0, *, _script=False, _deadline=None, _run=None):
        if not _script:
            hub._cancel_linear(key)
        sent.append((round((time.monotonic() - start) * 1000), round(position), round(duration)))

    hub.async_linear = linear
    return hub, device, sent, real_linear


def script(*points):
    return {"actions": [{"at": at, "pos": pos} for at, pos in points]}


async def test_heads_for_each_point_over_the_time_between_them():
    hub, _, sent, _ = make_hub()
    await hub.async_play_linear("k", script((0, 10), (300, 90), (600, 10)))
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 2)
    await asyncio.sleep(0)
    assert [p for _, p, _ in sent] == [10, 90, 10]
    # The first move takes its time (from wherever it is); then 300 ms each.
    assert [d for _, _, d in sent] == [400, 300, 300]
    assert sent[1][0] == pytest.approx(0, abs=40) and sent[2][0] == pytest.approx(300, abs=40)
    assert "k" not in hub._linear_runs


async def test_loop_ends_at_the_time_limit():
    hub, _, sent, _ = make_hub()
    await hub.async_play_linear("k", script((0, 0), (150, 100), (300, 0)), loop=True, max_seconds=1.0)
    task = hub._linear_runs["k"]
    await asyncio.wait_for(asyncio.shield(task), 3)
    assert len(sent) >= 6           # went round several times
    assert sent[-1][0] < 1100


async def test_a_live_command_stop_or_all_off_takes_over():
    hub, device, sent, real_linear = make_hub()
    long = script((0, 0), (5000, 100), (10000, 0))
    await hub.async_play_linear("k", long)
    task = hub._linear_runs["k"]
    await hub.async_linear("k", 50, 100)          # live following from a card
    await asyncio.sleep(0)
    assert task.cancelled() or task.done()
    assert "k" not in hub._linear_runs

    await hub.async_play_linear("k", long)
    hub._operation_epoch += 1                       # Stop all, Ogg off or a disconnect
    hub._linear_runs["k"].cancel()
    await asyncio.sleep(0)

    await hub.async_play_linear("k", long)
    task = hub._linear_runs["k"]
    # The real live call cancels the timeline before anything else.
    with pytest.raises(HomeAssistantError):
        await real_linear(hub, "k", 50, 100, index=3)
    await asyncio.sleep(0)
    assert task.cancelled()


async def test_refuses_a_device_without_a_stroker_or_an_empty_script():
    hub, _, _, _ = make_hub(linear_count=0)
    with pytest.raises(HomeAssistantError):
        await hub.async_play_linear("k", script((0, 10)))
    hub, _, _, _ = make_hub()
    with pytest.raises(HomeAssistantError):
        await hub.async_play_linear("k", {"actions": []})


def test_looped_vibration_script_ends_at_its_time_limit():
    prog = ScriptProgram([[(0, 0.0), (100, 1.0)]], loop=True, max_seconds=60)
    prog.levels(1000.0, 1)
    assert not prog.finished(1059.0)
    assert prog.finished(1060.0)
    assert not ScriptProgram([[(0, 0.0), (100, 1.0)]], loop=True).finished(5000.0)


async def test_starts_part_way_then_loops_the_whole_script():
    hub, _, sent, _ = make_hub()
    await hub.async_play_linear(
        "k", script((0, 0), (200, 80), (400, 100)), loop=True, max_seconds=0.9, start_ms=300
    )
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 3)
    positions = [p for _, p, _ in sent]
    # First pass from 300 ms: only the 400 ms point; then round from 0.
    assert positions[:4] == [100, 0, 80, 100]
    assert sent[1][0] == pytest.approx(100, abs=40)


async def test_start_past_the_end_plays_from_the_beginning():
    hub, _, sent, _ = make_hub()
    await hub.async_play_linear("k", script((0, 10), (300, 90)), start_ms=5000)
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 2)
    await asyncio.sleep(0)
    assert [p for _, p, _ in sent] == [10, 90]


def test_vibration_script_starts_part_way_then_loops_from_the_start():
    from custom_components.ogg.patterns import parse_script

    channels = parse_script({"actions": [{"at": 0, "pos": 0}, {"at": 1000, "pos": 100}, {"at": 2000, "pos": 0}]})
    once = ScriptProgram(channels, start_ms=1500)
    assert abs(once.levels(0.0, 1)[0] - 0.5) < 1e-9
    assert not once.finished(0.4) and once.finished(0.6)
    looped = ScriptProgram(channels, loop=True, start_ms=1500)
    looped.levels(0.0, 1)
    # 0.5 s later it is at the end, 1 s later back at 500 ms in.
    assert abs(looped.levels(1.0, 1)[0] - 0.5) < 1e-9 and not looped.finished(99)
    assert ScriptProgram(channels, start_ms=9999).start_ms == 0


async def test_plays_when_home_assistant_starts_the_task_eagerly():
    """HA runs a background task up to its first await before returning it."""
    hub, _, sent, _ = make_hub()

    class EagerEntry:
        def async_create_background_task(self, hass, coro, name):
            return asyncio.get_running_loop().create_task(coro, name=name, eager_start=True)

    hub.entry = EagerEntry()
    await hub.async_play_linear("k", script((0, 10), (300, 90), (600, 10)))
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 2)
    await asyncio.sleep(0)
    assert [p for _, p, _ in sent] == [10, 90, 10]



def real_hub():
    """The real async_linear and lock, with a fake Buttplug client whose
    acknowledgement can stall (the IntiHA engine sometimes holds it for over
    a second while a slow Bluetooth write finishes)."""
    hub, device, _, real_linear = make_hub()
    del hub.async_linear                     # use the real method again
    device.index = 0
    device.aux_values = {}
    hub._locks = {}
    hub._notify = lambda: None
    start = time.monotonic()
    sent: list[tuple[int, int, int]] = []
    stalls: dict[int, float] = {}

    class Client:
        async def request(self, name, payload):
            vector = payload["Vectors"][0]
            sent.append((round((time.monotonic() - start) * 1000), round(vector["Position"] * 100), vector["Duration"]))
            await asyncio.sleep(stalls.get(len(sent), 0.002))
            return {"Ok": {}}

    client = Client()
    hub._require_online = lambda dev: client
    return hub, sent, stalls


async def test_a_stalled_acknowledgement_does_not_hold_back_or_burst_the_timeline():
    hub, sent, stalls = real_hub()
    stalls[2] = 1.0                      # the second move's acknowledgement takes a second
    points = [(i * 300, 10 if i % 2 == 0 else 90) for i in range(9)]   # 300 ms strokes for 2.4 s
    await hub.async_play_linear("k", script(*points))
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 4)
    await asyncio.sleep(0.05)
    times = [at for at, _, _ in sent]
    # No catch-up burst: after the stall, moves are still a stroke apart.
    assert all(b - a >= 150 for a, b in zip(times[2:], times[3:])), sent
    # The stalled stretch was skipped, not queued: the last move still goes
    # out on time (for the 2.4 s point, a stroke before it).
    assert times[-1] == pytest.approx(2100, abs=80)
    # Each move after the stall lands on its own point's time (a multiple of 300 ms).
    for at, _pos, duration in sent[2:]:
        landing = (at + duration) % 300
        assert min(landing, 300 - landing) <= 50, sent


async def test_a_move_sent_late_aims_at_its_point_but_never_lurches():
    hub, sent, _ = real_hub()
    deadline = time.monotonic() + 0.1    # its point is 100 ms away
    await hub.async_linear("k", 50, 400, _script=True, _deadline=deadline)
    assert sent[-1][2] == 240            # 60% of its 400 ms, not a 100 ms lurch
    deadline = time.monotonic() + 0.35
    await hub.async_linear("k", 60, 400, _script=True, _deadline=deadline)
    assert sent[-1][2] == pytest.approx(350, abs=15)


async def test_a_dense_recording_is_cleaned_before_it_plays():
    hub, sent, _ = real_hub()
    import math
    # A finger recording: a slow stroke sampled every 50 ms with a little tremor.
    points = [(i, round(50 + 40 * math.sin(2 * math.pi * i / 1600) + (2 if (i // 50) % 2 else -2))) for i in range(0, 1600, 50)]
    await hub.async_play_linear("k", script(*points))
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 4)
    await asyncio.sleep(0.05)
    assert len(sent) < len(points) / 2
    times = [at for at, _, _ in sent]
    assert all(b - a >= 120 for a, b in zip(times[1:], times[2:])), sent
    positions = [p for _, p, _ in sent]
    assert max(positions) >= 86 and min(positions) <= 14      # the full stroke is kept
