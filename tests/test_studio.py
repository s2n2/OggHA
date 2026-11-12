"""The studio (the Play card's side of Ogg, formerly the OggStudio integration)."""

from __future__ import annotations

import pytest
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ogg.const import DOMAIN
from custom_components.ogg.studio.const import LIBRARY

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")

SCRIPT = {"actions": [{"at": 0, "pos": 0}, {"at": 500, "pos": 80}, {"at": 1000, "pos": 10}]}


def config() -> dict:
    return {"manual_hosts": ["192.0.2.10"], "sensor_entities": [], "port": 12345, "ssl": False,
            "scan_interval": 5}


async def setup_entry(hass, **kwargs) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="Ogg", data=config(), **kwargs)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_studio_entities_and_library_services(hass):
    entry = await setup_entry(hass)
    reg = er.async_get(hass)
    saved = reg.async_get_entity_id("select", DOMAIN, f"{entry.entry_id}:studio_saved_script")
    speed = reg.async_get_entity_id("select", DOMAIN, f"{entry.entry_id}:studio_speed")
    panic = reg.async_get_entity_id("button", DOMAIN, f"{entry.entry_id}:studio_panic")
    assert saved and speed and panic

    res = await hass.services.async_call(DOMAIN, "studio_save", {"name": "Test", "script": SCRIPT},
                                         blocking=True, return_response=True)
    assert res == {"name": "Test"}
    await hass.async_block_till_done()
    assert "Test" in hass.states.get(saved).attributes["options"]
    got = await hass.services.async_call(DOMAIN, "studio_get_script", {"name": "Test"},
                                         blocking=True, return_response=True)
    assert got["script"]["actions"][1]["pos"] == 80
    await hass.services.async_call(DOMAIN, "studio_rename", {"name": "Test", "new_name": "Other"}, blocking=True)
    assert "Other" in hass.data[LIBRARY].scripts
    await hass.services.async_call(DOMAIN, "studio_delete", {"name": "Other"}, blocking=True)
    assert not hass.data[LIBRARY].scripts
    # Stop everything works with no devices connected.
    res = await hass.services.async_call(DOMAIN, "studio_panic", {}, blocking=True, return_response=True)
    assert res == {"stopped": 0} or "stopped" in res


async def test_options_menu_and_studio_settings_do_not_reconnect(hass):
    entry = await setup_entry(hass)
    hub = entry.runtime_data
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.MENU
    assert set(result["menu_options"]) == {"connection", "studio"}
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "studio"})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "studio"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"no_history": False, "discreet": True, "discreet_name": "Lamp", "users": [],
                            "pin": "2468", "remove_pin": False, "auto_lock": 5})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.options["pin_hash"] and entry.options["discreet"] is True
    # The same hub: privacy settings apply without a reload.
    assert entry.runtime_data is hub
    assert hass.data[LIBRARY].settings["pin"] is True
    assert hass.data[LIBRARY].settings["name"] == "Lamp"

    # Connection settings keep the studio's and reload Ogg.
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "connection"})
    assert result["step_id"] == "connection"
    result = await hass.config_entries.options.async_configure(result["flow_id"], {**config(), "scan_interval": 9})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.options["scan_interval"] == 9 and entry.options["pin_hash"]
    assert entry.runtime_data is not hub


async def test_old_oggstudio_settings_and_library_are_taken_over(hass, hass_storage):
    old = MockConfigEntry(domain="oggstudio", unique_id="oggstudio", title="OggStudio",
                          options={"discreet": True, "discreet_name": "Notes", "auto_lock": 7})
    old.add_to_hass(hass)
    hass_storage[f"oggstudio.{old.entry_id}"] = {
        "version": 1, "key": f"oggstudio.{old.entry_id}",
        "data": {"scripts": {"Kept": {"script": SCRIPT, "saved": None}}},
    }
    entry = await setup_entry(hass)
    assert entry.options["discreet_name"] == "Notes" and entry.options["auto_lock"] == 7
    assert "Kept" in hass.data[LIBRARY].scripts
    # It asks for the old integration to be removed.
    assert ir.async_get(hass).async_get_issue(DOMAIN, "oggstudio_merged") is not None
