"""Server-independent matching and conservative migration of saved devices."""

from copy import deepcopy

import pytest

from custom_components.ogg.identity import load_devices, match_device, new_device_key
from custom_components.ogg.models import OggDevice, device_key, legacy_device_key

from .conftest import vibration_device


def make_device(key="original", source="first", index=0, label=None, model="WeVibe Nova"):
    raw = vibration_device(index, model)
    if label is not None:
        raw["DeviceDisplayName"] = label
    return OggDevice(key, label or model, source, raw)


def test_load_keeps_saved_key_and_settings_instead_of_recomputing_identity():
    original = make_device("opaque-old-id", index=7)
    original.settings.update(intensity=57, pattern="wave", motor_levels=[25, 70])
    devices, aliases = load_devices([original.stored()])
    assert list(devices) == ["opaque-old-id"]
    assert devices["opaque-old-id"].settings == original.settings
    assert not aliases


def test_missing_key_reconstructs_the_legacy_identifier():
    original = make_device(index=7)
    record = original.stored()
    del record["key"]
    devices, _ = load_devices([record])
    assert list(devices) == [legacy_device_key(original.source, original.raw)]
    assert device_key(original.source, original.raw) not in devices


def test_cross_server_duplicates_keep_original_settings_and_union_bindings():
    original = make_device("first-key", "phone-a", 1)
    duplicate = make_device("later-key", "phone-b", 74)
    original.settings.update(intensity=63, period=4.5, motor_levels=[15, 65])
    devices, aliases = load_devices([original.stored(), duplicate.stored()])
    assert list(devices) == ["first-key"]
    assert aliases == {"later-key": "first-key"}
    assert devices["first-key"].settings == original.settings
    assert devices["first-key"].bindings == {"phone-a": 1, "phone-b": 74}
    # A subsequent reload must not replace the surviving old identifier.
    reloaded, aliases_again = load_devices([devices["first-key"].stored()])
    assert list(reloaded) == ["first-key"]
    assert reloaded["first-key"].bindings == devices["first-key"].bindings
    assert not aliases_again


def test_unambiguous_named_and_unnamed_duplicates_merge_and_remember_label():
    original = make_device("unnamed", "phone-a", 0)
    named = make_device("named", "phone-b", 4, label="Bedroom Nova")
    devices, aliases = load_devices([original.stored(), named.stored()])
    assert list(devices) == ["unnamed"]
    assert aliases == {"named": "unnamed"}
    assert devices["unnamed"].identity_display_name == "bedroom nova"
    # The current route still reports its actual model name unchanged.
    assert devices["unnamed"].alias == "WeVibe Nova"


@pytest.mark.parametrize("same_source", [False, True])
def test_distinct_explicit_names_are_not_collapsed(same_source):
    first = make_device("first", "server-a", 0, label="Bedroom")
    second = make_device("second", "server-a" if same_source else "server-b", 1, label="Travel")
    devices, aliases = load_devices([first.stored(), second.stored()])
    assert set(devices) == {"first", "second"}
    assert not aliases


def test_multiple_unnamed_devices_on_one_server_are_not_collapsed():
    first = make_device("one", "server-a", 0)
    second = make_device("two", "server-a", 1)
    third = make_device("unknown", "server-b", 5)
    devices, aliases = load_devices([first.stored(), second.stored(), third.stored()])
    assert set(devices) == {"one", "two", "unknown"}
    assert not aliases


def test_historical_bindings_prevent_collapsing_known_distinct_devices():
    first = make_device("one", "server-a", 0)
    first.update_binding("server-b", vibration_device(2, "WeVibe Nova"))
    second = make_device("two", "server-a", 1)
    second.update_binding("server-c", vibration_device(7, "WeVibe Nova"))
    devices, aliases = load_devices([first.stored(), second.stored()])
    assert set(devices) == {"one", "two"}
    assert not aliases


def test_unnamed_record_does_not_choose_between_multiple_named_devices():
    records = [
        make_device("unnamed", "server-a").stored(),
        make_device("bedroom", "server-b", label="Bedroom").stored(),
        make_device("travel", "server-c", label="Travel").stored(),
    ]
    devices, aliases = load_devices(records)
    assert set(devices) == {"unnamed", "bedroom", "travel"}
    assert not aliases


def test_migration_retains_extra_motor_settings_from_later_server():
    original = make_device("first", "server-a")
    original.update_binding("server-a", vibration_device(0, "WeVibe Nova", motors=1))
    original.motor_level_memory = [20]
    original.settings["motor_levels"] = [20]
    duplicate = make_device("second", "server-b")
    duplicate.settings["motor_levels"] = [50, 75]
    devices, _ = load_devices([original.stored(), duplicate.stored()])
    saved = devices["first"]
    assert saved.settings["motor_levels"] == [20]
    saved.update_binding("server-b", duplicate.raw)
    assert saved.settings["motor_levels"] == [20, 75]


def test_match_new_server_and_reindexed_capabilities_to_same_device():
    original = make_device()
    changed = vibration_device(91, "WeVibe Nova", motors=1)
    changed["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    changed["DeviceMessageTimingGap"] = 250
    assert (
        match_device({original.key: original}, "new-server", changed, set(), [changed]) is original
    )


def test_matching_does_not_change_identity_until_caller_updates_binding():
    original = make_device()
    before = deepcopy(original.stored())
    moved = vibration_device(3, "WeVibe Nova")
    assert match_device({original.key: original}, "second", moved, set(), [moved]) is original
    assert original.stored() == before


@pytest.mark.parametrize("label", [None, "Bedroom"])
def test_unambiguous_model_matches_when_only_one_side_has_a_display_name(label):
    original = make_device(label=label)
    moved = vibration_device(5, "WeVibe Nova")
    if label is None:
        moved["DeviceDisplayName"] = "Bedroom"
    assert match_device({original.key: original}, "new-server", moved, set(), [moved]) is original


def test_existing_route_never_overrides_a_different_explicit_name():
    original = make_device(label="Bedroom")
    different = deepcopy(original.raw)
    different["DeviceDisplayName"] = "Travel"
    assert (
        match_device({original.key: original}, original.source, different, set(), [different])
        is None
    )


def test_existing_route_never_overrides_a_different_model():
    original = make_device()
    different = vibration_device(original.index, "Other device")
    assert (
        match_device({original.key: original}, original.source, different, set(), [different])
        is None
    )


def test_distinct_labels_match_after_server_and_index_order_change():
    first = make_device("bedroom", "server-a", 0, label="Bedroom")
    second = make_device("travel", "server-a", 1, label="Travel")
    devices = {device.key: device for device in (first, second)}
    rows = [deepcopy(second.raw), deepcopy(first.raw)]
    rows[0]["DeviceIndex"], rows[1]["DeviceIndex"] = 0, 1
    assert match_device(devices, "server-b", rows[0], set(), rows) is second
    assert match_device(devices, "server-b", rows[1], {second.key}, rows) is first


def test_claimed_device_is_never_matched_again():
    original = make_device()
    assert (
        match_device(
            {original.key: original}, original.source, original.raw, {original.key}, [original.raw]
        )
        is None
    )


def test_indistinguishable_simultaneous_devices_need_a_known_route():
    first = make_device("one", "server-a", 0)
    second = make_device("two", "server-a", 1)
    devices = {device.key: device for device in (first, second)}
    rows = [deepcopy(first.raw), deepcopy(second.raw)]
    assert match_device(devices, "server-a", rows[0], set(), rows) is first
    assert match_device(devices, "server-a", rows[1], {first.key}, rows) is second
    assert match_device(devices, "new-server", rows[0], set(), rows) is None
    assert match_device(devices, "new-server", rows[1], set(), rows) is None
    # Even one stored instance must not be assigned arbitrarily between twins.
    assert match_device({first.key: first}, "new-server", rows[0], set(), rows) is None


def test_unnamed_server_hop_does_not_erase_a_custom_identity():
    original = make_device(label="Bedroom")
    unnamed = vibration_device(4, "WeVibe Nova")
    devices = {original.key: original}
    assert match_device(devices, "unnamed-server", unnamed, set(), [unnamed]) is original
    original.update_binding("unnamed-server", unnamed)
    different = vibration_device(7, "WeVibe Nova")
    different["DeviceDisplayName"] = "Travel"
    assert match_device(devices, "third-server", different, set(), [different]) is None


def test_new_keys_are_global_but_collisions_receive_persistent_suffixes():
    raw = vibration_device()
    base = new_device_key({}, "first", raw)
    assert new_device_key({}, "second", raw) == base
    first = OggDevice(base, "Test device", "first", raw)
    devices = {base: first}
    second_key = new_device_key(devices, "first", raw)
    assert second_key == f"{base}_2"
    devices[second_key] = OggDevice(second_key, "Test device", "first", raw)
    assert new_device_key(devices, "third", raw) == f"{base}_3"


def test_invalid_cached_records_are_skipped_without_losing_valid_devices():
    valid = make_device().stored()
    invalid_index = deepcopy(valid)
    invalid_index["raw"]["DeviceIndex"] = True
    invalid_messages = deepcopy(valid)
    invalid_messages["raw"]["DeviceMessages"] = None
    invalid_name = deepcopy(valid)
    invalid_name["raw"]["DeviceName"] = 123
    devices, aliases = load_devices(
        [None, {}, invalid_index, invalid_messages, invalid_name, valid]
    )
    assert list(devices) == ["original"]
    assert not aliases
    assert load_devices(None) == ({}, {})
