"""Registry upgrades retain original entities while removing server duplicates."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ogg.const import DOMAIN
from custom_components.ogg.migration import async_migrate_device_registry

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")


def config_entry(hass, domain=DOMAIN):
    entry = MockConfigEntry(domain=domain, title="Registry test", data={})
    entry.add_to_hass(hass)
    return entry


def device(hass, entry, key, **kwargs):
    return dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, f"{entry.entry_id}:{key}")},
        name="We-Vibe Chorus",
        manufacturer="Ogg",
        model="We-Vibe Chorus",
        **kwargs,
    )


def entity(hass, entry, key, suffix="run", domain="switch", device_id=None, platform=DOMAIN):
    return er.async_get(hass).async_get_or_create(
        domain,
        platform,
        f"{entry.entry_id}:{key}:{suffix}",
        config_entry=entry,
        device_id=device_id,
        suggested_object_id=f"test_{key}_{suffix}",
    )


async def test_original_ids_and_customizations_survive_and_new_capabilities_move(hass):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    original = device(hass, entry, "original")
    duplicate = device(hass, entry, "other_server")
    original_area = ar.async_get(hass).async_create("Original room")
    duplicate_area = ar.async_get(hass).async_create("Other room")
    original = devices.async_update_device(
        original.id, name_by_user="My device", area_id=original_area.id
    )
    devices.async_update_device(
        duplicate.id, name_by_user="Duplicated device", area_id=duplicate_area.id
    )
    original_run = entity(hass, entry, "original", device_id=original.id)
    original_run = entities.async_update_entity(
        original_run.entity_id,
        new_entity_id="switch.my_existing_device",
        name="My control",
        icon="mdi:toggle-switch",
        disabled_by=er.RegistryEntryDisabler.USER,
        hidden_by=er.RegistryEntryHider.USER,
        area_id=original_area.id,
    )
    duplicate_run = entity(hass, entry, "other_server", device_id=duplicate.id)
    extra = entity(
        hass, entry, "other_server", "motor_2", domain="number", device_id=duplicate.id
    )
    extra = entities.async_update_entity(
        extra.entity_id,
        new_entity_id="number.existing_second_motor",
        name="Independent motor",
        disabled_by=er.RegistryEntryDisabler.USER,
    )

    await async_migrate_device_registry(hass, entry, {"other_server": "original"})
    await hass.async_block_till_done()

    assert devices.async_get(original.id) == original
    assert devices.async_get(duplicate.id) is None
    assert entities.async_get(original_run.entity_id) == original_run
    assert entities.async_get(duplicate_run.entity_id) is None
    migrated = entities.async_get(extra.entity_id)
    assert migrated is not None
    assert migrated.id == extra.id
    assert migrated.entity_id == "number.existing_second_motor"
    assert migrated.device_id == original.id
    assert migrated.unique_id == f"{entry.entry_id}:original:motor_2"
    assert migrated.name == extra.name
    assert migrated.disabled_by == extra.disabled_by

    # Running the same upgrade again must not replace records or clear settings.
    await async_migrate_device_registry(hass, entry, {"other_server": "original"})
    await hass.async_block_till_done()
    assert devices.async_get(original.id) == original
    assert entities.async_get(original_run.entity_id) == original_run
    assert entities.async_get(extra.entity_id) == migrated


async def test_unset_original_metadata_is_recovered_from_duplicate(hass):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    original = device(hass, entry, "original")
    duplicate = device(hass, entry, "duplicate")
    area = ar.async_get(hass).async_create("Saved room")
    devices.async_update_device(duplicate.id, name_by_user="Saved name", area_id=area.id)

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    migrated = devices.async_get(original.id)
    assert migrated.name == "We-Vibe Chorus"
    assert migrated.name_by_user == "Saved name"
    assert migrated.area_id == area.id
    assert devices.async_get(duplicate.id) is None


async def test_only_later_registry_device_reuses_its_existing_device_and_entity_ids(hass):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    duplicate = device(hass, entry, "duplicate")
    duplicate = devices.async_update_device(duplicate.id, name_by_user="Keep this name")
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    migrated_device = devices.async_get(duplicate.id)
    assert migrated_device.identifiers == {(DOMAIN, f"{entry.entry_id}:original")}
    assert migrated_device.name_by_user == "Keep this name"
    migrated_entity = entities.async_get(control.entity_id)
    assert migrated_entity.device_id == duplicate.id
    assert migrated_entity.unique_id == f"{entry.entry_id}:original:run"
    assert migrated_entity.id == control.id


async def test_hub_other_config_entries_and_other_platforms_are_untouched(hass):
    entry = config_entry(hass)
    other_entry = config_entry(hass)
    foreign_entry = config_entry(hass, "template")
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    original = device(hass, entry, "original")
    duplicate = device(hass, entry, "duplicate")
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)
    hub = devices.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={(DOMAIN, entry.entry_id)}, name="Ogg"
    )
    hub_control = entities.async_get_or_create(
        "switch", DOMAIN, f"{entry.entry_id}:enabled", config_entry=entry, device_id=hub.id
    )
    other_device = device(hass, other_entry, "duplicate")
    other_control = entity(hass, other_entry, "duplicate", device_id=other_device.id)
    foreign_device = devices.async_get_or_create(
        config_entry_id=foreign_entry.entry_id,
        identifiers={("template", "foreign_device")},
        name="Unrelated device",
    )
    # Matching text alone must not authorize touching another integration's entity.
    foreign_control = entities.async_get_or_create(
        "switch",
        "template",
        f"{entry.entry_id}:duplicate:run",
        config_entry=foreign_entry,
        device_id=foreign_device.id,
    )
    same_entry_foreign_platform = entity(
        hass, entry, "duplicate", suffix="unrelated", platform="template", device_id=hub.id
    )

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    assert entities.async_get(control.entity_id).device_id == original.id
    assert devices.async_get(duplicate.id) is None
    for untouched in (hub, other_device, foreign_device):
        assert devices.async_get(untouched.id) == untouched
    for untouched in (
        hub_control,
        other_control,
        foreign_control,
        same_entry_foreign_platform,
    ):
        assert entities.async_get(untouched.entity_id) == untouched


async def test_foreign_unique_id_conflict_does_not_delete_either_entity(hass):
    entry = config_entry(hass)
    other_entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    device(hass, entry, "original")
    duplicate = device(hass, entry, "duplicate")
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)
    foreign = entities.async_get_or_create(
        "switch", DOMAIN, f"{entry.entry_id}:original:run", config_entry=other_entry
    )

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    assert entities.async_get(control.entity_id) == control
    assert entities.async_get(foreign.entity_id) == foreign
    assert devices.async_get(duplicate.id) == duplicate


@pytest.mark.parametrize("with_target", [False, True])
async def test_orphan_entity_keeps_its_id_and_gets_canonical_unique_id(hass, with_target):
    entry = config_entry(hass)
    entities = er.async_get(hass)
    target = device(hass, entry, "original") if with_target else None
    orphan = entity(hass, entry, "duplicate")

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    migrated = entities.async_get(orphan.entity_id)
    assert migrated.id == orphan.id
    assert migrated.unique_id == f"{entry.entry_id}:original:run"
    assert migrated.device_id == (target.id if target else None)


async def test_chained_aliases_consolidate_all_copies_into_first_device(hass):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    original = device(hass, entry, "original")
    controls = []
    for key in ("second", "third"):
        duplicate = device(hass, entry, key)
        controls.append(entity(hass, entry, key, suffix=key, device_id=duplicate.id))

    await async_migrate_device_registry(
        hass, entry, {"third": "second", "second": "original"}
    )
    await hass.async_block_till_done()

    assert dr.async_entries_for_config_entry(devices, entry.entry_id) == [original]
    for control in controls:
        migrated = entities.async_get(control.entity_id)
        assert migrated.device_id == original.id
        assert migrated.unique_id == f"{entry.entry_id}:original:{control.unique_id.split(':')[-1]}"


async def test_previously_combined_identifiers_keep_surviving_device(hass):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    combined = devices.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={
            (DOMAIN, f"{entry.entry_id}:original"),
            (DOMAIN, f"{entry.entry_id}:duplicate"),
        },
    )
    control = entity(hass, entry, "duplicate", device_id=combined.id)

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    assert devices.async_get(combined.id).identifiers == {(DOMAIN, f"{entry.entry_id}:original")}
    assert entities.async_get(control.entity_id).device_id == combined.id


async def test_legacy_shared_device_only_detaches_ogg_membership(hass):
    """Exercise the old multi-owner API without using its deprecated current shim."""
    entry = config_entry(hass)
    other_entry = config_entry(hass, "template")
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    original = device(hass, entry, "original")
    duplicate = device(hass, entry, "duplicate")
    foreign_identifier = ("template", "shared_device")
    duplicate = devices.async_update_device(
        duplicate.id, new_identifiers=duplicate.identifiers | {foreign_identifier}
    )
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)
    shared = SimpleNamespace(
        id=duplicate.id,
        identifiers=duplicate.identifiers,
        config_entries={entry.entry_id, other_entry.entry_id},
        name_by_user=None,
        area_id=None,
    )
    real_entries = dr.async_entries_for_config_entry

    def legacy_entries(registry, config_entry_id):
        return [
            shared if row.id == duplicate.id else row
            for row in real_entries(registry, config_entry_id)
        ]

    with (
        patch.object(dr, "async_entries_for_config_entry", side_effect=legacy_entries),
        patch.object(devices, "async_update_device") as update,
        patch.object(devices, "async_remove_device") as remove,
    ):
        await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
        update.assert_called_once_with(
            duplicate.id,
            new_identifiers={foreign_identifier},
            remove_config_entry_id=entry.entry_id,
        )
        remove.assert_not_called()
    await hass.async_block_till_done()
    assert entities.async_get(control.entity_id).device_id == original.id


async def test_unrelated_entities_on_source_device_are_not_cascaded_away(hass):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    original = device(hass, entry, "original")
    duplicate = device(hass, entry, "duplicate")
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)
    unrelated = entity(
        hass, entry, "foreign", domain="sensor", platform="template", device_id=duplicate.id
    )

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    assert entities.async_get(control.entity_id).device_id == original.id
    assert entities.async_get(unrelated.entity_id) == unrelated
    assert devices.async_get(duplicate.id) == duplicate


async def test_unrelated_device_links_are_not_changed_by_duplicate_cleanup(hass):
    entry = config_entry(hass)
    foreign_entry = config_entry(hass, "template")
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    original = device(hass, entry, "original")
    duplicate = device(hass, entry, "duplicate")
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)
    foreign_device = devices.async_get_or_create(
        config_entry_id=foreign_entry.entry_id,
        identifiers={("template", "foreign_device")},
    )
    foreign_device = devices.async_update_device(
        foreign_device.id, via_device_id=duplicate.id
    )

    await async_migrate_device_registry(hass, entry, {"duplicate": "original"})
    await hass.async_block_till_done()

    assert entities.async_get(control.entity_id).device_id == original.id
    assert devices.async_get(duplicate.id) == duplicate
    assert devices.async_get(foreign_device.id) == foreign_device


@pytest.mark.parametrize(
    "aliases", [{}, {"duplicate": "duplicate"}, {"duplicate": "other", "other": "duplicate"}]
)
async def test_empty_or_cyclic_migration_is_a_noop(hass, aliases):
    entry = config_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    duplicate = device(hass, entry, "duplicate")
    control = entity(hass, entry, "duplicate", device_id=duplicate.id)

    await async_migrate_device_registry(hass, entry, aliases)
    await hass.async_block_till_done()

    assert devices.async_get(duplicate.id) == duplicate
    assert entities.async_get(control.entity_id) == control
