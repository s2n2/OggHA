"""Stroker timelines cleaned for a Bluetooth stroker (custom_components/ogg/smoothing.py)."""

from __future__ import annotations

import importlib.util
import math
import random
from pathlib import Path

# Load the module on its own: it needs nothing from Home Assistant.
_spec = importlib.util.spec_from_file_location(
    "ogg_smoothing", Path(__file__).resolve().parents[1] / "custom_components" / "ogg" / "smoothing.py"
)
sm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sm)
smooth = sm.smooth_stroke


def turns(points):
    return [b for a, b, c in zip(points, points[1:], points[2:]) if (b[1] - a[1]) * (c[1] - b[1]) < 0]


def test_a_clean_stroke_script_is_left_alone():
    points = [(i * 400, 10 if i % 2 == 0 else 90) for i in range(20)]
    assert smooth(points) == [(float(a), float(p)) for a, p in points]


def test_a_dense_recording_keeps_every_stroke_and_drops_the_rest():
    points = [(i, 50 + 40 * math.sin(2 * math.pi * i / 1200)) for i in range(0, 6000, 60)]
    out = smooth(points)
    assert len(out) < len(points) / 3
    peaks = [p for _, p in turns(out)]
    assert len(peaks) == 10 and all(p >= 88 or p <= 12 for p in peaks)   # 6 s of 1.2 s strokes
    assert out[0] == (0.0, 50.0) and out[-1][0] == points[-1][0]       # same start and end
    assert min(b[0] - a[0] for a, b in zip(out, out[1:])) >= sm.MIN_SEGMENT_MS


def test_tremor_and_small_wobbles_are_not_strokes():
    r = random.Random(1)
    points = [(i, 50 + 35 * math.sin(2 * math.pi * i / 1800) + r.uniform(-2.5, 2.5)) for i in range(0, 8000, 50)]
    out = smooth(points)
    # 8 s of 1.8 s strokes: 8 or 9 real turns, not the tremor's dozens.
    assert 8 <= len(turns(out)) <= 9
    # A 3% flick at the end (a finger lifting) is not a stroke either.
    end = points[-1]
    flick = points + [(end[0] + 50, end[1] + 3), (end[0] + 100, end[1] - 1)]
    assert len(turns(smooth(flick))) == len(turns(out))


def test_a_pause_is_kept():
    points = [(0, 10), (500, 90), (2500, 90), (3000, 10)]
    assert smooth(points) == [(0.0, 10.0), (500.0, 90.0), (2500.0, 90.0), (3000.0, 10.0)]


def test_strokes_too_fast_for_bluetooth_keep_their_depth_at_a_pace_it_carries():
    points = [(i * 110, 25 if i % 2 == 0 else 75) for i in range(46)]   # 'Rush': 110 ms strokes
    out = smooth(points)
    assert min(b[0] - a[0] for a, b in zip(out, out[1:])) >= sm.MIN_SEGMENT_MS
    assert {p for _, p in out} == {25.0, 75.0}                           # same depth
    assert out[-1][0] == points[-1][0]


def test_one_quick_move_turns_a_moment_later_instead_of_being_lost():
    points = [(0, 60), (300, 85), (400, 5), (1000, 95)]
    out = smooth(points)
    assert [p for _, p in out] == [60.0, 85.0, 5.0, 95.0]
    assert out[2][0] == 300 + sm.MIN_SEGMENT_MS


def test_speed_up_stretches_the_shortest_move():
    points = [(i * 200, 20 if i % 2 == 0 else 80) for i in range(10)]
    # At 2x a 200 ms script move lasts 100 ms: too quick, so it is paced.
    out = smooth(points, min_segment_ms=sm.MIN_SEGMENT_MS * 2)
    assert min(b[0] - a[0] for a, b in zip(out, out[1:])) >= sm.MIN_SEGMENT_MS * 2


def test_a_long_script_is_quick():
    import time
    points = [(i * 250, 5 if i % 2 == 0 else 95) for i in range(20000)]
    began = time.perf_counter()
    smooth(points)
    assert time.perf_counter() - began < 2.0


def test_odd_input_is_cleaned_not_refused():
    assert smooth([]) == []
    assert smooth([(0, 50)]) == [(0.0, 50.0)]
    assert smooth([(100, 150), (0, -20), (100, 40)]) == [(0.0, 0.0), (100.0, 40.0)]
