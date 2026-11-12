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
    sent: list[tuple[float, float, float]] = []
    start = time.monotonic()
    real_linear = OggHub.async_linear

    async def linear(key, position, duration, index=0, *, _script=False):
        if not _script:
            hub._cancel_linear(key)
        sent.append((round((time.monotonic() - start) * 1000), round(position), round(duration)))

    hub.async_linear = linear
    return hub, device, sent, real_linear


def script(*points):
    return {"actions": [{"at": at, "pos": pos} for at, pos in points]}


async def test_heads_for_each_point_over_the_time_between_them():
    hub, _, sent, _ = make_hub()
    await hub.async_play_linear("k", script((0, 10), (100, 90), (200, 10)))
    await asyncio.wait_for(asyncio.shield(hub._linear_runs["k"]), 2)
    assert [p for _, p, _ in sent] == [10, 90, 10]
    # The first move takes its time (from wherever it is); then 100 ms each.
    assert [d for _, _, d in sent] == [400, 100, 100]
    assert sent[1][0] == pytest.approx(0, abs=40) and sent[2][0] == pytest.approx(100, abs=40)
    assert "k" not in hub._linear_runs


async def test_loop_ends_at_the_time_limit():
    hub, _, sent, _ = make_hub()
    await hub.async_play_linear("k", script((0, 0), (50, 100), (100, 0)), loop=True, max_seconds=0.35)
    task = hub._linear_runs["k"]
    await asyncio.wait_for(asyncio.shield(task), 2)
    assert len(sent) >= 6           # went round several times
    assert sent[-1][0] < 450


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
