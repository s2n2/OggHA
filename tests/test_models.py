"""Check persisted identity and capability-based controls."""

from copy import deepcopy

from custom_components.ogg.models import OggDevice, device_key, legacy_device_key

from .conftest import vibration_device


def test_fingerprint_is_independent_of_server_index_and_capabilities():
    original = vibration_device(0, "WeVibe Nova")
    assert device_key("sensor:phone_a", original) == device_key("sensor:phone_b", original)
    moved = deepcopy(original)
    moved["DeviceIndex"] = 87
    moved["DeviceMessageTimingGap"] = 250
    moved["DeviceMessages"]["ScalarCmd"].pop()
    moved["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    assert device_key("sensor:phone_a", original) == device_key("manual:elsewhere", moved)
    assert legacy_device_key("sensor:phone_a", original) != legacy_device_key(
        "sensor:phone_b", original
    )
    assert legacy_device_key("sensor:phone_a", original) != legacy_device_key(
        "sensor:phone_a", moved
    )


def test_fingerprint_normalises_names_without_changing_display():
    original = vibration_device(0, "WeVibe Nova")
    changed = deepcopy(original)
    changed["DeviceName"] = "  WEVIBE\u2003Nova  "
    changed["DeviceDisplayName"] = "wevibe nova"
    assert device_key("first", original) == device_key("second", changed)
    changed["DeviceDisplayName"] = "Bedroom Nova"
    assert device_key("first", original) != device_key("second", changed)
    custom = deepcopy(changed)
    custom["DeviceDisplayName"] = "  BEDROOM  NOVA "
    assert device_key("first", custom) == device_key("second", changed)
    assert changed["DeviceDisplayName"] == "Bedroom Nova"


def test_native_control_needs_exact_model_steps_and_raw_endpoint():
    raw = vibration_device(0, "WeVibe Nova")
    device = OggDevice("test", "WeVibe Nova", "sensor:phone", raw)
    assert not device.native_available
    raw["DeviceMessages"]["RawWriteCmd"] = {"Endpoints": ["tx"]}
    assert device.native_available
    raw["DeviceName"] = "WeVibe Nova 2"
    assert not device.native_available


def test_vibration_features_retain_protocol_indexes():
    raw = vibration_device()
    raw["DeviceMessages"]["ScalarCmd"].insert(0, {"ActuatorType": "Constrict", "StepCount": 100})
    device = OggDevice("test", "Test", "manual:local", raw)
    assert device.motor_count == 2
    assert [index for index, _ in device.vibration_features] == [1, 2]


def test_storage_never_saves_running_or_transient_connection_state():
    device = OggDevice("test", "Test", "manual:local", vibration_device())
    device.running = True
    device.connected = True
    device.mode = "pulse"
    device.remaining = 12
    stored = device.stored()
    assert not {"running", "connected", "mode", "remaining"}.intersection(stored)
    restored = OggDevice(**stored)
    assert not restored.running
    assert not restored.connected
    assert restored.mode == "idle"


def test_binding_updates_route_and_original_display_spelling_but_not_key():
    raw = vibration_device(3, "WeVibe Nova")
    device = OggDevice("original-key", "WeVibe Nova", "first", raw)
    moved = vibration_device(72, "WeVibe Nova")
    moved["DeviceDisplayName"] = "Bedroom Nova"
    device.update_binding("second", moved)
    assert device.key == "original-key"
    assert device.alias == "Bedroom Nova"
    assert device.raw is moved
    assert device.source == "second"
    assert device.index == 72
    assert device.bindings == {"first": 3, "second": 72}
    assert device.identity_display_name == "bedroom nova"


def test_display_identity_survives_a_server_that_omits_the_label():
    raw = vibration_device()
    raw["DeviceDisplayName"] = "My Nova"
    device = OggDevice("saved", "My Nova", "first", raw)
    device.update_binding("second", vibration_device(5))
    assert device.identity_display_name == "my nova"
    assert device.alias == "Test device"
    restored = OggDevice(**device.stored())
    assert restored.identity_display_name == "my nova"
    assert restored.bindings == {"first": 0, "second": 5}


def test_motor_settings_survive_shrink_restart_and_growth():
    device = OggDevice(
        "saved",
        "Test device",
        "first",
        vibration_device(),
        settings={"motor_levels": [35, 70], "intensity": 42},
    )
    device.update_binding("second", vibration_device(7, motors=1))
    assert device.settings["motor_levels"] == [35]
    assert device.motor_level_memory == [35, 70]
    device.settings["motor_levels"] = [45]
    restored = OggDevice(**device.stored())
    assert restored.settings["motor_levels"] == [45]
    restored.update_binding("third", vibration_device(9, motors=2))
    assert restored.settings["motor_levels"] == [45, 70]
    assert restored.settings["intensity"] == 42
    restored.update_binding("fourth", vibration_device(1, motors=3))
    assert restored.settings["motor_levels"] == [45, 70, 100]


def test_saved_extra_motor_levels_are_retained_and_sanitised():
    device = OggDevice(
        "saved",
        "Test device",
        "first",
        vibration_device(motors=1),
        settings={"motor_levels": [25, 65, float("nan")]},
    )
    assert device.settings["motor_levels"] == [25]
    assert device.motor_level_memory == [25, 65, 100]
    device.update_binding("second", vibration_device(motors=3))
    assert device.settings["motor_levels"] == [25, 65, 100]
