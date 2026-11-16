"""Six ready-made vibration scripts (5 to 30 minutes), added to the library once.

Original timelines, built here from the shapes that well-liked scripts tend to
follow: a quick climb, a beat, an irregular "can't get used to it" ride, sets
of waves, a long slow build, and tease-and-denial edges. Each uses a fixed
seed, so it comes out the same every time. Levels are 0-100 (intensity);
a device's own top-intensity limit still scales them.

Delete one and it stays deleted (the library remembers which it offered).
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable

STEP_MS = 100          # sampling step before simplifying
TOLERANCE = 1.2        # simplification: max drift from the true curve (levels)
FINE_STEP_MS = 50      # for short, sharp shapes (the heartbeat)
FINE = {"heartbeat"}

Curve = Callable[[float], float]   # seconds -> level 0-100


def _clamp(v: float) -> float:
    return 0.0 if v < 0 else 100.0 if v > 100 else v


def _smooth(x: float) -> float:
    """0..1 -> 0..1 eased (smoothstep)."""
    x = 0.0 if x < 0 else 1.0 if x > 1 else x
    return x * x * (3 - 2 * x)


def _lerp(a: float, b: float, x: float) -> float:
    return a + (b - a) * x


def _sample(curve: Curve, seconds: float, step: int = STEP_MS) -> list[tuple[int, int]]:
    """Sample, then drop points a straight line would reproduce."""
    raw = [(t, int(round(_clamp(curve(t / 1000))))) for t in range(0, int(seconds * 1000) + 1, step)]
    raw[-1] = (raw[-1][0], 0)                      # every script ends at rest
    out = [raw[0]]
    i, n = 0, len(raw)
    while i < n - 1:
        # Reach as far as a straight line from raw[i] stays within the tolerance
        # of every point it skips (at most 30 s per line).
        j = i + 1
        while j + 1 < n and (raw[j + 1][0] - raw[i][0]) <= 30_000:
            (ta, va), (tb, vb) = raw[i], raw[j + 1]
            if any(abs(va + (vb - va) * (raw[k][0] - ta) / (tb - ta) - raw[k][1]) > TOLERANCE
                   for k in range(i + 1, j + 1)):
                break
            j += 1
        out.append(raw[j])
        i = j
    return out


def _segments(parts: list[tuple[float, Curve]]) -> tuple[Curve, float]:
    """Join (length s, curve over local time) parts into one curve."""
    starts, total = [], 0.0
    for length, _ in parts:
        starts.append(total)
        total += length

    def curve(t: float) -> float:
        for (length, part), start in zip(parts, starts):
            if t < start + length:
                return part(t - start)
        return parts[-1][1](parts[-1][0])
    return curve, total


# ------------------------------------------------------------------ the six

def quickie() -> tuple[Curve, float]:
    """5 min: warm, climb in pulses, hold at the top, let go."""
    def warm(t):  # 60 s, 15 -> 45, gentle wobble
        return _lerp(15, 45, _smooth(t / 60)) + 6 * math.sin(t * 2 * math.pi / 5)

    def climb(t):  # 180 s of 2.5 s pulses rising 50 -> 88, short dips between
        base = _lerp(50, 88, t / 180)
        phase = (t % 2.5) / 2.5
        return base if phase < 0.8 else base - 25 * math.sin((phase - 0.8) / 0.2 * math.pi)

    def top(t):  # 50 s near the top with a fast flutter
        return 93 + 7 * math.sin(t * 2 * math.pi / 0.6)

    def fade(t):  # 10 s down to rest
        return _lerp(95, 0, _smooth(t / 10))
    return _segments([(60, warm), (180, climb), (50, top), (10, fade)])


def heartbeat() -> tuple[Curve, float]:
    """10 min: a lub-dub beat whose tempo and strength rise, race, then settle."""
    # (seconds, bpm at start, bpm at end, floor, peak)
    plan = [(90, 56, 64, 8, 45), (150, 64, 84, 15, 65), (150, 84, 112, 22, 85),
            (120, 112, 128, 30, 100), (90, 128, 60, 10, 55)]
    parts = []
    prev = (plan[0][3], plan[0][4])
    for length, b0, b1, floor, peak in plan:
        def part(t, length=length, b0=b0, b1=b1, floor=floor, peak=peak, prev=prev):
            # Ease from the last stage's strength over the first 20 s.
            ease = _smooth(t / 20)
            floor = _lerp(prev[0], floor, ease)
            peak = _lerp(prev[1], peak, ease)
            x = t / length
            bpm = _lerp(b0, b1, x)
            # beat phase = integral of the tempo (so tempo changes stay smooth)
            beats = (b0 * t + (b1 - b0) * t * t / (2 * length)) / 60
            p = beats % 1.0
            period = 60 / bpm
            lub = math.exp(-((p * period - 0.10) / 0.07) ** 2)
            dub = 0.65 * math.exp(-((p * period - 0.36) / 0.07) ** 2)
            return floor + (peak - floor) * max(lub, dub)
        parts.append((length, part))
        prev = (floor, peak)
    return _segments(parts)


def surprise() -> tuple[Curve, float]:
    """15 min: irregular moves you can't get used to, slowly getting bolder."""
    rnd = random.Random(15)
    total, parts, t = 900.0, [], 0.0
    while t < total - 60:
        boldness = t / total                       # 0 -> 1 over the ride
        kind = rnd.choices(["lull", "burst", "flutter", "ramp", "plateau", "stutter"],
                           [3, 2 + 2 * boldness, 2, 2, 2, 1 + boldness])[0]
        length = rnd.uniform(4, 22)
        lo = 8 + 25 * boldness
        hi = min(100, 55 + 45 * boldness + rnd.uniform(-8, 8))
        level = rnd.uniform(lo, hi)
        rate = rnd.uniform(0.25, 0.6)
        if kind == "lull":
            f = (lambda lo: lambda s: lo * 0.6 + 4 * math.sin(s * 1.3))(lo)
        elif kind == "burst":
            length = rnd.uniform(2, 6)
            f = (lambda hi: lambda s: hi)(hi)
        elif kind == "flutter":
            f = (lambda level, rate: lambda s: level + 22 * (1 if (s / rate) % 2 < 1 else -1))(level, rate)
        elif kind == "ramp":
            f = (lambda lo, hi, L: lambda s: _lerp(lo, hi, s / L))(lo, hi, length)
        elif kind == "stutter":
            f = (lambda lo, hi, rate: lambda s: hi if (s / (rate * 0.7)) % 3 < 1 else lo * 0.5)(lo, hi, rate)
        else:  # plateau
            f = (lambda level: lambda s: level + 3 * math.sin(s * 3))(level)
        parts.append((length, f))
        t += length
    parts.append((total - t - 12, lambda s: 92 + 8 * math.sin(s * 9)))   # the last minute: all in
    parts.append((12, lambda s: _lerp(95, 0, _smooth(s / 12))))
    return _segments(parts)


def ocean_waves() -> tuple[Curve, float]:
    """20 min: sets of rolling waves (every seventh the biggest) on a rising, then ebbing tide."""
    rnd = random.Random(20)
    total = 1200.0
    waves, t = [], 0.0
    n = 0
    while t < total:
        period = rnd.uniform(9, 16)
        n += 1
        big = n % 7 == 0
        waves.append((t, period, 1.0 if big else rnd.uniform(0.45, 0.8)))
        t += period

    def curve(s: float) -> float:
        tide = _lerp(12, 70, _smooth(s / 900)) if s < 900 else _lerp(70, 20, _smooth((s - 900) / 300))
        for start, period, size in reversed(waves):
            if s >= start:
                x = (s - start) / period
                break
        swell = math.sin(math.pi * x) ** 2 * size           # rise and fall of one wave
        chop = 3 * math.sin(s * 2 * math.pi / 1.7)           # small surface ripple
        return tide + (100 - tide) * 0.75 * swell + chop
    return curve, total


def slow_burn() -> tuple[Curve, float]:
    """25 min: breathe low, then climb very slowly with resting plateaus, to a long peak."""
    total = 1500.0

    def curve(s: float) -> float:
        breath = math.sin(s * 2 * math.pi / 6)                # a slow 6 s breath
        if s < 180:                                           # warm-up: 3 min low
            return 15 + 8 * breath
        if s < 1320:                                          # the burn: 19 min
            x = (s - 180) / 1140
            # a staircase eased into a ramp: climb, rest, climb...
            steps = 6
            k = x * steps
            stair = (math.floor(k) + _smooth((k % 1) * 1.6)) / steps
            base = _lerp(22, 85, stair)
            return base + (6 + 6 * x) * breath
        if s < 1480:                                          # the peak: long, waving
            return 90 + 10 * math.sin((s - 1320) * 2 * math.pi / 4)
        return _lerp(92, 0, _smooth((s - 1480) / 20))
    return curve, total


def edge_ladder() -> tuple[Curve, float]:
    """30 min: tease-and-denial. Climb to the edge, hold, stop dead; each edge higher."""
    rnd = random.Random(30)
    parts: list[tuple[float, Curve]] = [(180, lambda s: _lerp(8, 35, _smooth(s / 180)) + 5 * math.sin(s * 1.2))]
    edges = 8
    for i in range(edges):
        x = i / (edges - 1)
        peak = _lerp(72, 97, x)
        climb = rnd.uniform(120, 150) - 30 * x
        hold = rnd.uniform(8, 14) + 10 * x
        deny = rnd.uniform(22, 38)
        start = 20 + 10 * x
        parts.append((climb, (lambda a, b, L: lambda s: _lerp(a, b, _smooth(s / L) ** 1.4) + 4 * math.sin(s * 2.1))(start, peak, climb)))
        parts.append((hold, (lambda p: lambda s: p + 3 * math.sin(s * 2 * math.pi / 0.7))(peak)))
        # Denied: straight to nothing, then a few teasing flicks before the next climb.
        flicks = sorted(rnd.uniform(6, deny - 3) for _ in range(2 + (i % 3)))
        def denied(s, flicks=flicks, peak=peak):
            for f in flicks:
                if f <= s < f + 0.5:
                    return peak * 0.55
            return 0
        parts.append((deny, denied))
    used = sum(L for L, _ in parts)
    finale = 1800 - used - 25
    parts.append((finale, lambda s: 94 + 6 * math.sin(s * 2 * math.pi / 0.5)))
    parts.append((25, lambda s: _lerp(95, 0, _smooth(s / 25))))
    return _segments(parts)


STARTERS: list[tuple[str, str, Callable[[], tuple[Curve, float]]]] = [
    ("quickie", "Starter · Quickie (5 min)", quickie),
    ("heartbeat", "Starter · Heartbeat (10 min)", heartbeat),
    ("surprise", "Starter · Surprise ride (15 min)", surprise),
    ("waves", "Starter · Ocean waves (20 min)", ocean_waves),
    ("slow_burn", "Starter · Slow burn (25 min)", slow_burn),
    ("edge_ladder", "Starter · Edge ladder (30 min)", edge_ladder),
]


def build(key: str) -> dict:
    for k, name, make in STARTERS:
        if k == key:
            curve, seconds = make()
            actions = _sample(curve, seconds, FINE_STEP_MS if key in FINE else STEP_MS)
            return {
                "version": "1.0", "inverted": False, "range": 100,
                "actions": [{"at": at, "pos": pos} for at, pos in actions],
                "metadata": {"title": name, "type": "vibration", "creator": "Ogg starter scripts"},
            }
    raise KeyError(key)


def build_all() -> list[tuple[str, str, dict]]:
    """(key, name, funscript) for each starter."""
    return [(k, name, build(k)) for k, name, _ in STARTERS]
