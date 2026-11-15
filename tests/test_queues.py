"""His and hers queues (the Queue card): add, play, the played list, links."""

from __future__ import annotations

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from custom_components.ogg.const import DOMAIN
from custom_components.ogg.studio.queues import MAX_PLAYED, Queues

from .test_ui import setup_entry

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")

SCRIPT = {"actions": [{"at": 0, "pos": 0}, {"at": 60_000, "pos": 80}]}


async def test_add_play_and_requeue(hass, hass_storage):
    queues = Queues(hass)
    await queues.async_load()
    item = queues.add("hers", "  10:00 ·  Sat 14:32 ", SCRIPT, by="Sam")
    summary = queues.summary[item]
    assert summary["name"] == "10:00 · Sat 14:32"
    assert summary["for"] == "hers" and summary["by"] == "Sam"
    assert summary["played"] is None and summary["duration_ms"] == 60_000
    assert "script" not in summary
    assert queues.script(item)["metadata"]["title"] == "10:00 · Sat 14:32"

    queues.played(item)
    assert queues.summary[item]["played"] and queues.summary[item]["plays"] == 1
    queues.played(item)
    assert queues.summary[item]["plays"] == 2
    queues.requeue(item, "his")
    assert queues.summary[item]["played"] is None and queues.summary[item]["for"] == "his"

    queues.rename(item, "For later")
    assert queues.summary[item]["name"] == "For later"
    queues.delete(item)
    assert not queues.items
    with pytest.raises(HomeAssistantError):
        queues.script(item)
    with pytest.raises(HomeAssistantError):
        queues.add("theirs", "x", SCRIPT)
    with pytest.raises(HomeAssistantError):
        queues.add("his", "x", {"actions": []})


async def test_the_played_list_keeps_the_newest(hass, hass_storage):
    queues = Queues(hass)
    await queues.async_load()
    ids = [queues.add("his", f"n{i}", SCRIPT) for i in range(MAX_PLAYED + 3)]
    for item in ids:
        queues.played(item)
    assert len(queues.items) == MAX_PLAYED
    assert ids[-1] in queues.items and ids[0] not in queues.items


async def test_kept_across_a_restart(hass, hass_storage):
    hass_storage["ogg_studio_queues"] = {"version": 1, "data": {"items": {
        "abc": {"name": "Kept", "for": "his", "script": SCRIPT, "made": "2026-11-15T00:00:00+00:00",
                "by": "Alex", "played": None, "plays": 0},
        "bad": {"name": "Broken", "for": "nobody", "script": SCRIPT},
    }}}
    queues = Queues(hass)
    await queues.async_load()
    assert list(queues.items) == ["abc"]


async def test_services_and_the_entity(hass):
    entry = await setup_entry(hass)
    try:
        saved = er.async_get(hass).async_get_entity_id("select", DOMAIN, f"{entry.entry_id}:studio_saved_script")
        assert saved is not None
        res = await hass.services.async_call(
            DOMAIN, "studio_queue_add", {"for": "his", "name": "Tonight", "script": SCRIPT},
            blocking=True, return_response=True)
        item = res["id"]
        await hass.async_block_till_done()
        listed = hass.states.get(saved).attributes["queues"]
        assert listed[item]["name"] == "Tonight" and listed[item]["for"] == "his"

        got = await hass.services.async_call(DOMAIN, "studio_queue_get", {"id": item},
                                             blocking=True, return_response=True)
        assert got["script"]["actions"][-1] == {"at": 60_000, "pos": 80}

        await hass.services.async_call(DOMAIN, "studio_queue_played", {"id": item}, blocking=True)
        await hass.async_block_till_done()
        assert hass.states.get(saved).attributes["queues"][item]["played"]

        await hass.services.async_call(DOMAIN, "studio_queue_delete", {"id": item}, blocking=True)
        await hass.async_block_till_done()
        assert hass.states.get(saved).attributes["queues"] == {}
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)
