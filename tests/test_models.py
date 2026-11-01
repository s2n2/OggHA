"""Check persisted identity and capability-based controls."""

from copy import deepcopy

from custom_components.ogg.models import OggDevice, device_key

from .conftest import vibration_device


def test_server_scope_and_device_index_are_not_confused():
    original = vibration_device(0, "WeVibe Nova")
    assert device_key("sensor:phone_a", original) != device_key("sensor:phone_b", original)
    moved = deepcopy(original)
    moved["DeviceIndex"] = 1
    assert device_key("sensor:phone_a", original) != device_key("sensor:phone_a", moved)
    assert device_key("sensor:phone_a", original) == device_key(
        "sensor:phone_a", deepcopy(original)
    )


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
