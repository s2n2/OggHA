"""Deterministic software envelopes and explicitly selected classic packets.

Software envelopes are Ogg designs, not reproductions of proprietary firmware
timing. Classic native pattern identifiers are documented at
https://buttplug.io/stpihkal/protocols/we-vibe/ . That protocol must not be used
for the separate 8-bit and Chorus families.
"""

from __future__ import annotations

import math

SOFTWARE_PATTERNS: tuple[str, ...] = (
    "steady",
    "pulse",
    "wave",
    "breath",
    "ramp",
    "heartbeat",
    "double_pulse",
    "steps",
    "echo",
    "surge",
)

NATIVE_PATTERNS: dict[str, int] = {
    "steady": 0x03,
    "peak": 0x04,
    "pulse": 0x05,
    "echo": 0x06,
    "wave": 0x07,
    "tide": 0x08,
    "surf": 0x0E,
    "bounce": 0x0F,
    "massage": 0x10,
    "tease": 0x11,
    "crest": 0x12,
    "chachacha": 0x13,
    "step": 0x14,
    "ramp": 0x15,
    "tempo": 0x16,
    "heartbeat": 0x17,
}

MOTOR_MODES: tuple[str, ...] = ("together", "alternating", "motor_1", "motor_2")
CLASSIC_MODELS: frozenset[str] = frozenset(
    {
        "wevibe bloom",
        "wevibe ditto",
        "wevibe jive",
        "wevibe pivot",
        "wevibe rave",
        "wevibe verge",
        "wevibe wish",
        "wevibe 4 plus",
        "wevibe gala",
        "wevibe nova",
        "wevibe sync",
        "wevibe classic",
    }
)


def is_classic_candidate(device_name: str, step_counts: list[int]) -> bool:
    """Recognise an exact classic model; this is not permission to send raw data.

    Require both an exact upstream model name and the classic 15-step features.
    User selection is still required because v3 does not expose a protocol ID.
    In particular, a prefix match for 'Nova' or 'Sync' would include newer,
    incompatible models and is deliberately not used.
    """
    if not isinstance(device_name, str):
        return False
    normalised = " ".join(device_name.lower().replace("we-vibe", "wevibe").split())
    return (
        normalised in CLASSIC_MODELS
        and len(step_counts) in (1, 2)
        and all(value == 15 for value in step_counts)
    )


def sample(
    pattern: str,
    phase: float,
    motor_index: int = 0,
    motor_mode: str = "together",
) -> float:
    """Sample a normalised cycle, returning an envelope in the range 0..1.

    The caller supplies monotonic elapsed time divided by cycle duration and
    multiplies the returned value by that motor's selected intensity. Alternate
    mode offsets odd motors by half a cycle; for steady it alternates on/off.
    Native-only names have deliberate software approximations for fallback.
    """
    if not isinstance(phase, (int, float)) or not math.isfinite(phase):
        raise ValueError("Pattern phase must be finite")
    if pattern not in SOFTWARE_PATTERNS and pattern not in NATIVE_PATTERNS:
        raise ValueError("Unknown pattern")
    if motor_mode == "alternate":
        motor_mode = "alternating"
    if motor_mode not in MOTOR_MODES:
        raise ValueError("Unknown motor mode")
    if not isinstance(motor_index, int) or motor_index < 0:
        raise ValueError("Motor index must be non-negative")
    if motor_mode == "motor_1" and motor_index != 0:
        return 0.0
    if motor_mode == "motor_2" and motor_index != 1:
        return 0.0
    position = float(phase) % 1.0
    if motor_mode == "alternating":
        position = (position + (motor_index % 2) * 0.5) % 1.0
        if pattern == "steady":
            return 1.0 if position < 0.5 else 0.0
    wave = (1 - math.cos(2 * math.pi * position)) / 2
    if pattern == "steady":
        value = 1.0
    elif pattern == "pulse":
        value = 1.0 if position < 0.5 else 0.0
    elif pattern in ("wave", "tide"):
        value = wave
    elif pattern == "breath":
        value = wave**1.5
    elif pattern == "ramp":
        value = position
    elif pattern == "peak":
        value = 1 - abs(2 * position - 1)
    elif pattern == "heartbeat":
        value = 1.0 if position < 0.13 else 0.7 if 0.25 <= position < 0.4 else 0.0
    elif pattern == "double_pulse":
        value = 1.0 if position < 0.2 or 0.35 <= position < 0.55 else 0.0
    elif pattern in ("steps", "step"):
        value = (min(int(position * 4), 3) + 1) / 4
    elif pattern == "echo":
        stage = min(int(position * 6), 5)
        value = (1.0, 0.0, 0.65, 0.0, 0.35, 0.0)[stage]
    elif pattern in ("surge", "crest"):
        value = wave**0.5
    elif pattern == "surf":
        value = wave * (0.65 + 0.35 * math.sin(6 * math.pi * position) ** 2)
    elif pattern == "bounce":
        value = abs(math.sin(2 * math.pi * position)) * (1 - 0.4 * position)
    elif pattern == "massage":
        value = 0.3 + 0.7 * wave
    elif pattern == "tease":
        value = position * 1.25 if position < 0.8 else 0.0
    elif pattern == "chachacha":
        value = 1.0 if position < 0.14 or 0.25 <= position < 0.39 or 0.5 <= position < 0.64 else 0.0
    else:  # tempo: three evenly spaced bursts.
        value = 1.0 if (position * 3) % 1 < 0.5 else 0.0
    return min(1.0, max(0.0, float(value)))


def build_classic_packet(pattern: str, levels: list[float]) -> bytes:
    """Encode a native classic-family command after explicit profile opt-in.

    A single motor is mirrored across the two classic nibbles, matching the
    upstream single-motor driver. For dual motors, index 0 is the high nibble
    and index 1 the low nibble. Zero disables the corresponding motor bit; zero
    intensity nibbles alone do not reliably stop classic-family hardware.
    """
    if pattern not in NATIVE_PATTERNS:
        raise ValueError("This pattern has no classic native command")
    if len(levels) not in (1, 2):
        raise ValueError("The classic profile requires one or two motors")
    if any(
        isinstance(value, bool)
        or not isinstance(value, (float, int))
        or not math.isfinite(value)
        or not 0 <= value <= 1
        for value in levels
    ):
        raise ValueError("Motor levels must be between zero and one")
    internal, external = (levels[0], levels[-1])
    mask = (0x02 if internal > 0 else 0) | (0x01 if external > 0 else 0)
    if mask == 0:
        return bytes((0x0F, 0, 0, 0, 0, 0, 0, 0))

    def quantise(value: float) -> int:
        return max(1, min(15, int(value * 15 + 0.5))) if value > 0 else 0

    packed = (quantise(internal) << 4) | quantise(external)
    return bytes((0x0F, NATIVE_PATTERNS[pattern], 0, packed, 0, mask, 0, 0))
