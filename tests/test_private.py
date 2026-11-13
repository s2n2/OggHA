"""Private mode: toys stop showing their status to others; the owner sees it live."""

from __future__ import annotations

from homeassistant.helpers import entity_registry as er

from custom_components.ogg.const import DOMAIN
from custom_components.ogg.private import DATA, PrivateMode

from .test_ui import setup_entry


def pulse_entity(hass, entry) -> str:
    entity_id = er.async_get(hass).async_get_entity_id(
        "number", DOMAIN, f"{entry.entry_id}:pulse_duration"
    )
    assert entity_id is not None
    return entity_id


async def set_pulse(hass, entity_id: str, value: float) -> None:
    await hass.services.async_call(
        "number", "set_value", {"entity_id": entity_id, "value": value}, blocking=True
    )
    await hass.async_block_till_done()


async def next_event(ws) -> dict:
    msg = await ws.receive_json()
    assert msg["type"] == "event", msg
    return msg["event"]


async def test_others_see_held_states_and_the_owner_sees_them_live(
    hass, hass_ws_client, hass_access_token, hass_read_only_access_token, hass_read_only_user
):
    entry = await setup_entry(hass)
    try:
        pulse = pulse_entity(hass, entry)
        await set_pulse(hass, pulse, 2.0)
        assert hass.states.get(pulse).state == "2.0"

        owner = await hass_ws_client(hass, hass_access_token)
        other = await hass_ws_client(hass, hass_read_only_access_token)
        await owner.send_json({"id": 1, "type": "ogg/private/subscribe"})
        assert (await owner.receive_json())["success"]
        assert await next_event(owner) == {"on": False, "mine": False, "since": None}
        await other.send_json({"id": 1, "type": "ogg/private/subscribe"})
        assert (await other.receive_json())["success"]
        await next_event(other)

        # The owner turns it on: every session hears; only theirs get states.
        await owner.send_json({"id": 2, "type": "ogg/private/set", "on": True})
        first = await next_event(owner)
        result = await owner.receive_json()
        assert result["success"] and result["result"] == {"on": True}
        assert first["on"] and first["mine"]
        assert first["states"][pulse]["state"] == "2.0"
        seen = await next_event(other)
        assert seen == {"on": True, "mine": False, "since": None}

        # A change: Home Assistant keeps the old state; the owner gets the new.
        await set_pulse(hass, pulse, 7.0)
        assert hass.states.get(pulse).state == "2.0"
        update = await next_event(owner)
        assert update["states"][pulse]["state"] == "7.0"

        # Someone else can neither take it over nor turn it off.
        await other.send_json({"id": 2, "type": "ogg/private/set", "on": True})
        assert (await other.receive_json())["error"]["code"] == "in_use"
        await other.send_json({"id": 3, "type": "ogg/private/set", "on": False})
        assert (await other.receive_json())["error"]["code"] == "not_yours"
        assert hass.states.get(pulse).state == "2.0"

        # Off: everyone sees the live state again.
        await owner.send_json({"id": 3, "type": "ogg/private/set", "on": False})
        await next_event(owner)
        assert (await owner.receive_json())["result"] == {"on": False}
        assert hass.states.get(pulse).state == "7.0"
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_a_second_session_of_the_owner_gets_the_live_states(
    hass, hass_ws_client, hass_access_token
):
    entry = await setup_entry(hass)
    try:
        pulse = pulse_entity(hass, entry)
        laptop = await hass_ws_client(hass, hass_access_token)
        await laptop.send_json({"id": 1, "type": "ogg/private/set", "on": True})
        assert (await laptop.receive_json())["success"]
        await set_pulse(hass, pulse, 9.0)
        phone = await hass_ws_client(hass, hass_access_token)
        await phone.send_json({"id": 1, "type": "ogg/private/subscribe"})
        assert (await phone.receive_json())["success"]
        event = await next_event(phone)
        assert event["mine"] and event["states"][pulse]["state"] == "9.0"
        assert hass.states.get(pulse).state != "9.0"
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_private_mode_is_kept_across_a_restart(hass, hass_storage):
    hass_storage["ogg_private"] = {"version": 1, "data": {"owner": "u1", "since": 5.0}}
    mode = PrivateMode(hass)
    await mode.async_load()
    assert mode.active and mode.owner == "u1"
    hass.data[DATA] = mode
    mode.turn_off()
    assert not mode.active
