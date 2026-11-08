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


def test_dual_patterns_drive_each_motor_differently():
    from custom_components.ogg.patterns import DUAL_PATTERNS, sample

    shared = {"dual_steady", "dual_pulse", "dual_wave"}  # both motors in step
    for pattern in DUAL_PATTERNS:
        curves = [[sample(pattern, step / 16, motor) for step in range(16)] for motor in (0, 1)]
        assert (curves[0] == curves[1]) == (pattern in shared), pattern
        assert all(0 <= v <= 1 for curve in curves for v in curve)


def test_random_program_frequency_follows_intensity():
    import random

    from custom_components.ogg.patterns import RandomProgram

    def running_share(intensity: float) -> float:
        program, on, total, now = RandomProgram(random.Random(7)), 0, 0, 0.0
        while now < 24 * 3600:
            on += any(program.levels(now, intensity, 2))
            total += 1
            now += 0.5
        return on / total

    assert running_share(0.0) == 0
    assert running_share(0.1) < 0.03
    assert 0.1 < running_share(0.5) < 0.35
    assert running_share(1.0) > 0.6


def test_funscript_parsing_and_playback():
    from custom_components.ogg.patterns import ScriptProgram, parse_script

    script = {
        "version": "1.0", "inverted": False, "range": 100,
        "actions": [{"at": 0, "pos": 0}, {"at": 1000, "pos": 100}, {"at": 2000, "pos": 0}],
        "channels": {"V1": {"actions": [{"at": 0, "pos": 50}, {"at": 2000, "pos": 50}]}},
    }
    channels = parse_script(script)
    assert len(channels) == 2 and channels[0][1] == (1000, 1.0)
    program = ScriptProgram(channels, speed=1.0)
    assert program.levels(10.0, 2) == [0.0, 0.5]
    assert abs(program.levels(10.5, 2)[0] - 0.5) < 1e-9
    assert program.levels(11.0, 2)[0] == 1.0
    assert not program.finished(11.9) and program.finished(12.1)
    fast = ScriptProgram(channels, speed=2.0)
    fast.levels(0.0, 1)
    assert fast.levels(0.5, 1)[0] == 1.0 and fast.finished(1.1)
    looped = ScriptProgram(channels, loop=True)
    looped.levels(0.0, 1)
    assert abs(looped.levels(2.5, 1)[0] - 0.5) < 1e-9 and not looped.finished(99)
    # one-channel scripts drive both motors; inverted flips; junk is rejected
    single = ScriptProgram(parse_script({"actions": [{"at": 0, "pos": 30}]}))
    assert single.levels(0.0, 2) == [0.3, 0.3]
    assert parse_script({"inverted": True, "actions": [{"at": 0, "pos": 20}]})[0][0][1] == 0.8
    for bad in ({}, {"actions": "x"}, {"actions": [{"at": -1, "pos": 1}]}, {"actions": []}):
        try:
            parse_script(bad)
        except ValueError:
            continue
        raise AssertionError(bad)
