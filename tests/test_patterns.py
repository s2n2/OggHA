"""Verify envelopes and device-protocol boundaries, including genuine stop bytes."""

import math

import pytest

from custom_components.ogg.patterns import (
    MOTOR_MODES,
    NATIVE_PATTERNS,
    SOFTWARE_PATTERNS,
    build_classic_packet,
    is_classic_candidate,
    sample,
)


@pytest.mark.parametrize(
    "pattern", tuple(dict.fromkeys(SOFTWARE_PATTERNS + tuple(NATIVE_PATTERNS)))
)
@pytest.mark.parametrize("mode", MOTOR_MODES)
def test_envelopes_are_bounded_periodic_and_finite(pattern, mode):
    for motor in range(2):
        for phase in [0.0, 0.1, 0.249, 0.5, 0.77, 0.999, 1.0, 3.1]:
            value = sample(pattern, phase, motor, mode)
            assert math.isfinite(value)
            assert 0 <= value <= 1
            assert sample(pattern, phase + 4, motor, mode) == pytest.approx(value)


def test_single_motor_selection_and_alternation():
    assert sample("steady", 0.1, 0, "motor_2") == 0
    assert sample("steady", 0.1, 1, "motor_2") == 1
    assert sample("steady", 0.1, 0, "alternate") == 1
    assert sample("steady", 0.1, 1, "alternate") == 0
    assert sample("steady", 0.6, 0, "alternate") == 0
    assert sample("steady", 0.6, 1, "alternate") == 1


def test_classic_native_stop_clears_pattern_and_motor_flags():
    assert build_classic_packet("pulse", [0, 0]) == bytes([0x0F, 0, 0, 0, 0, 0, 0, 0])
    assert build_classic_packet("pulse", [1, 0]) == bytes([0x0F, 5, 0, 0xF0, 0, 2, 0, 0])
    assert build_classic_packet("wave", [0, 1]) == bytes([0x0F, 7, 0, 0x0F, 0, 1, 0, 0])
    assert build_classic_packet("steady", [1]) == bytes([0x0F, 3, 0, 0xFF, 0, 3, 0, 0])


@pytest.mark.parametrize("levels", [[], [0, 0, 0], [-0.1], [1.1], [float("nan")], [True]])
def test_native_packet_rejects_invalid_values(levels):
    with pytest.raises(ValueError):
        build_classic_packet("pulse", levels)


@pytest.mark.parametrize(
    "name",
    [
        "WeVibe Moxie",
        "WeVibe Vector",
        "WeVibe Chorus",
        "WeVibe Nova 2",
        "WeVibe Nova2",
        "WeVibe Sync 2",
        "WeVibe Sync O",
        "WeVibe Melt",
        "Unknown",
        "WeVibe Jive 2",
    ],
)
def test_newer_or_unknown_models_never_assumed_classic(name):
    assert not is_classic_candidate(name, [15, 15])


def test_classic_gate_requires_exact_model_and_feature_resolution():
    assert is_classic_candidate("We-Vibe Nova", [15, 15])
    assert is_classic_candidate("WeVibe Jive", [15])
    assert not is_classic_candidate("WeVibe Nova", [255, 255])
    assert not is_classic_candidate("WeVibe Nova", [])
