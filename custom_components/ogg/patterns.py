"""Deterministic software envelopes and explicitly selected classic packets.

Software envelopes are Ogg designs, not reproductions of proprietary firmware
timing. Classic native pattern identifiers are documented at
https://buttplug.io/stpihkal/protocols/we-vibe/ . That protocol must not be used
for the separate 8-bit and Chorus families.
"""

from __future__ import annotations

import bisect
import math
import random
from typing import Any

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

# Two-motor patterns. On a two-motor device these replace the single-motor
# list; motor 0 is "in" and motor 1 is "out", and each has its own curve.
DUAL_PATTERNS: tuple[str, ...] = (
    "dual_steady",      # both motors steady
    "dual_pulse",       # both pulse together
    "dual_wave",        # both swell together
    "ping_pong",        # motors take turns
    "chase",            # out follows in a quarter-cycle behind
    "counter_wave",     # as one rises the other falls
    "breath_offset",    # out breathes half a cycle after in
    "heartbeat_split",  # first beat in, second beat out
    "double_pulse_split",  # first pulse in, second pulse out
    "echo_bounce",      # fading echoes bounce between motors
    "ramp_swap",        # in ramps up while out ramps down
    "steps_cross",      # in steps up while out steps down
    "tease_pulse",      # in holds a low hum while out pulses
    "rumble_pulse",     # in swells slowly while out taps quickly
    "surge_layer",      # in surges, out adds a softer wave underneath
)

# Intensity-driven random program (see RandomProgram).
RANDOM_PATTERN = "random"

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
    if (
        pattern not in SOFTWARE_PATTERNS
        and pattern not in NATIVE_PATTERNS
        and pattern not in DUAL_PATTERNS
    ):
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
    if pattern in DUAL_PATTERNS:
        return _dual(pattern, position, motor_index % 2)
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


def _dual(pattern: str, position: float, motor: int) -> float:
    """Per-motor envelopes for the two-motor patterns (motor 0=in, 1=out)."""
    wave = (1 - math.cos(2 * math.pi * position)) / 2
    inner = motor == 0
    if pattern == "dual_steady":
        value = 1.0
    elif pattern == "dual_pulse":
        value = 1.0 if position < 0.5 else 0.0
    elif pattern == "dual_wave":
        value = wave
    elif pattern == "ping_pong":
        # Hand-over with a short overlap so it never feels dead.
        value = 1.0 if ((position < 0.5 or position > 0.96) if inner else 0.46 < position) else 0.0
    elif pattern == "chase":
        shifted = (position - 0.25 * motor) % 1.0
        value = (1 - math.cos(2 * math.pi * shifted)) / 2
    elif pattern == "counter_wave":
        value = wave if inner else 1 - wave
    elif pattern == "breath_offset":
        shifted = (position - 0.5 * motor) % 1.0
        value = ((1 - math.cos(2 * math.pi * shifted)) / 2) ** 1.5
    elif pattern == "heartbeat_split":
        value = (1.0 if position < 0.13 else 0.0) if inner else (0.8 if 0.25 <= position < 0.4 else 0.0)
    elif pattern == "double_pulse_split":
        value = (1.0 if position < 0.2 else 0.0) if inner else (1.0 if 0.35 <= position < 0.55 else 0.0)
    elif pattern == "echo_bounce":
        stage = min(int(position * 6), 5)
        level = (1.0, 0.8, 0.6, 0.45, 0.3, 0.15)[stage]
        value = level if (stage % 2 == 0) == inner else 0.0
    elif pattern == "ramp_swap":
        value = position if inner else 1 - position
    elif pattern == "steps_cross":
        step = (min(int(position * 4), 3) + 1) / 4
        value = step if inner else 1.25 - step
    elif pattern == "tease_pulse":
        value = 0.4 if inner else (1.0 if (position * 2) % 1 < 0.35 else 0.0)
    elif pattern == "rumble_pulse":
        value = wave if inner else (1.0 if (position * 4) % 1 < 0.3 else 0.0)
    else:  # surge_layer
        value = wave**0.5 if inner else 0.6 * wave
    return min(1.0, max(0.0, float(value)))


class RandomProgram:
    """Random bursts whose frequency follows the intensity setting.

    ``intensity`` (0..1) sets the share of time spent running: roughly
    intensity squared, so 100% runs almost continuously (with brief silent
    gaps for suspense), 50% about a quarter of the time and 10% only about
    1% of the time. Each burst picks a random pattern or step sequence,
    random speed, cycle time and length; two-motor devices also get the
    dual-motor patterns. Speeds are absolute (not scaled by intensity).
    """

    BURST_SECONDS = (3.0, 25.0)
    MAX_REST_SECONDS = 3600.0
    MAX_FIRST_REST_SECONDS = 300.0

    def __init__(self, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()
        self._segment: dict | None = None
        self._end = 0.0
        self._started = False

    @staticmethod
    def duty(intensity: float) -> float:
        intensity = min(1.0, max(0.0, float(intensity)))
        return min(0.96, intensity**2)

    def levels(self, now: float, intensity: float, motors: int) -> list[float]:
        motors = max(1, int(motors))
        if self._segment is None or now >= self._end:
            self._next(now, intensity, motors)
        segment = self._segment
        assert segment is not None
        if segment["kind"] == "rest":
            return [0.0] * motors
        elapsed = now - segment["start"]
        if segment["kind"] == "steps":
            step = int(elapsed / segment["step_seconds"])
            values = segment["values"]
            # Two motors step through the sequence out of phase.
            return [values[(step + index * 2) % len(values)] for index in range(motors)]
        phase = elapsed / segment["period"]
        return [
            segment["level"] * sample(segment["pattern"], phase, index, segment["mode"])
            for index in range(motors)
        ]

    def _next(self, now: float, intensity: float, motors: int) -> None:
        rng = self._rng
        duty = self.duty(intensity)
        burst_mean = sum(self.BURST_SECONDS) / 2
        resting = self._segment is not None and self._segment["kind"] == "rest"
        if duty <= 0.0:
            self._segment, self._end = {"kind": "rest", "start": now}, now + 60.0
            return
        if not resting:
            # Rest after a burst (and before the very first one).
            rest_mean = burst_mean * (1 - duty) / duty
            length = rng.expovariate(1 / rest_mean) if rest_mean > 0 else 0.0
            cap = self.MAX_FIRST_REST_SECONDS if not self._started else self.MAX_REST_SECONDS
            length = min(cap, max(0.4, length))
            self._started = True
            self._segment, self._end = {"kind": "rest", "start": now}, now + length
            return
        length = rng.uniform(*self.BURST_SECONDS)
        if rng.random() < 0.3:
            values = [
                0.0 if rng.random() < 0.2 else round(rng.uniform(0.25, 1.0), 2)
                for _ in range(rng.randint(3, 8))
            ]
            if not any(values):
                values[0] = 0.6
            self._segment = {
                "kind": "steps", "start": now, "values": values,
                "step_seconds": rng.uniform(0.4, 2.5),
            }
        else:
            if motors > 1:
                choices = [p for p in DUAL_PATTERNS if p != "dual_steady"]
            else:
                choices = [p for p in SOFTWARE_PATTERNS if p != "steady"]
            pattern = rng.choice(choices)
            mode = "together"
            self._segment = {
                "kind": "pattern", "start": now, "pattern": pattern, "mode": mode,
                "level": rng.uniform(0.3, 1.0), "period": rng.uniform(0.6, 6.0),
            }
        self._end = now + length


# ---------------------------------------------------------------------------
# Scripts (funscript timelines) for recorded and imported patterns.
MAX_SCRIPT_ACTIONS = 200_000
MAX_SCRIPT_MS = 6 * 60 * 60 * 1000


def _actions(raw: Any, inverted: bool) -> list[tuple[int, float]]:
    if not isinstance(raw, list) or len(raw) > MAX_SCRIPT_ACTIONS:
        raise ValueError("A script needs a list of actions")
    out: list[tuple[int, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Invalid script action")
        at, pos = item.get("at"), item.get("pos")
        if isinstance(at, bool) or not isinstance(at, (int, float)) or not 0 <= at <= MAX_SCRIPT_MS:
            raise ValueError("Invalid action time")
        if isinstance(pos, bool) or not isinstance(pos, (int, float)) or not math.isfinite(pos):
            raise ValueError("Invalid action position")
        level = min(100.0, max(0.0, float(pos))) / 100
        out.append((int(at), 1 - level if inverted else level))
    out.sort(key=lambda action: action[0])
    return out


def parse_script(data: Any) -> list[list[tuple[int, float]]]:
    """Funscript (plus optional second motor) -> per-motor (ms, level) lists.

    Accepts a standard funscript ``{"actions": [{"at": ms, "pos": 0-100}]}``.
    A second motor may be given as ``"channels": {"V1": {"actions": [...]}}``
    (OggStudio's extension, TCode channel names) or ``"channels": [ {...} ]``.
    ``pos`` is used directly as intensity; stroke-to-vibration conversion is
    done when importing (OggStudio), so stored scripts are plain intensity.
    """
    if not isinstance(data, dict):
        raise ValueError("A script must be a funscript object")
    inverted = bool(data.get("inverted", False))
    channels = [_actions(data.get("actions"), inverted)]
    extra = data.get("channels")
    if isinstance(extra, dict):
        for name in ("V1", "v1", "L1"):
            if isinstance(extra.get(name), dict):
                channels.append(_actions(extra[name].get("actions"), inverted))
                break
    elif isinstance(extra, list) and extra and isinstance(extra[0], dict):
        channels.append(_actions(extra[0].get("actions"), inverted))
    if not any(channels):
        raise ValueError("The script has no actions")
    return channels


def _level_at(actions: list[tuple[int, float]], at_ms: float, times: list[int]) -> float:
    if not actions:
        return 0.0
    i = bisect.bisect_right(times, at_ms)
    if i == 0:
        return actions[0][1]
    if i >= len(actions):
        return actions[-1][1]
    (t0, v0), (t1, v1) = actions[i - 1], actions[i]
    return v0 if t1 == t0 else v0 + (v1 - v0) * (at_ms - t0) / (t1 - t0)


class ScriptProgram:
    """Plays per-motor timelines with linear interpolation, speed and loop."""

    def __init__(
        self,
        channels: list[list[tuple[int, float]]],
        speed: float = 1.0,
        loop: bool = False,
        max_seconds: float | None = None,
    ) -> None:
        self.channels = [c for c in channels]
        self.max_seconds = max_seconds
        self._times = [[at for at, _ in c] for c in self.channels]
        self.speed = min(4.0, max(0.25, float(speed)))
        self.loop = bool(loop)
        self.duration_ms = max((c[-1][0] for c in self.channels if c), default=0)
        self.start: float | None = None

    def position_ms(self, now: float) -> float:
        if self.start is None:
            self.start = now
        position = (now - self.start) * 1000 * self.speed
        if self.loop and self.duration_ms > 0:
            position %= self.duration_ms
        return position

    def levels(self, now: float, motors: int) -> list[float]:
        position = self.position_ms(now)
        out = []
        for motor in range(max(1, motors)):
            # A one-channel script drives every motor.
            channel = motor if motor < len(self.channels) else 0
            out.append(_level_at(self.channels[channel], position, self._times[channel]))
        return out

    def finished(self, now: float) -> bool:
        if self.start is None:
            return False
        if self.max_seconds is not None and now - self.start >= self.max_seconds:
            return True
        if self.loop:
            return False
        return (now - self.start) * 1000 * self.speed > self.duration_ms
