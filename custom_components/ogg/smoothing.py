"""Clean up stroker timelines so a Bluetooth stroker moves smoothly.

A stroker (The Handy) takes one "go to X over T ms" move per script point,
and each move is a Bluetooth write that takes 100-300 ms to land through a
proxy. A dense or wobbly timeline (a finger recording sampled every 50 ms,
a vibration-like mood) asks for more moves than the link can carry: the
ones that get through arrive late and out of rhythm, so the stroker rushes,
stops and lurches. This keeps what matters - every real turn, every pause,
real changes of speed - and drops the rest:

1. Shape: points that lie within TOLERANCE of a straight line between their
   neighbours are dropped (Douglas-Peucker on position over time).
2. Wobble: a reversal of less than MIN_TRAVEL is a wobble, not a stroke.
3. Pace: no move is shorter than MIN_SEGMENT_MS. A run of strokes faster
   than that is played at the fastest pace the link carries, same depth.

Pure Python, no Home Assistant: the card has the same steps (lib/smooth.js).
"""

from __future__ import annotations

TOLERANCE = 2.5        # % off a straight line that still counts as straight
MIN_TRAVEL = 4.0       # % : a smaller reversal is a wobble
FLAT = 1.0             # % : a leg this flat is a pause, not a move
HOLD_MS = 250          # a pause at least this long is kept
MIN_SEGMENT_MS = 150   # the shortest move that reliably reaches the stroker

Point = tuple[float, float]   # (ms, position 0-100)


def smooth_stroke(
    points: list[Point],
    *,
    tolerance: float = TOLERANCE,
    min_travel: float = MIN_TRAVEL,
    min_segment_ms: float = MIN_SEGMENT_MS,
) -> list[Point]:
    """Return a cleaned copy of a stroke timeline (same times, fewer points)."""
    pts = _clean(points)
    if len(pts) <= 2:
        return pts
    pts = _shape(pts, tolerance, min_travel)
    pts = _drop_wobble(pts, min_travel)
    pts = _min_segments(pts, min_segment_ms)
    return pts


def _clean(points: list[Point]) -> list[Point]:
    out: list[Point] = []
    for at, pos in sorted(((float(a), float(p)) for a, p in points), key=lambda x: x[0]):
        pos = min(100.0, max(0.0, pos))
        if out and at <= out[-1][0]:
            out[-1] = (out[-1][0], pos)   # same time: the later value wins
        else:
            out.append((at, pos))
    return out


def _extremes(pts: list[Point], min_travel: float) -> list[int]:
    """Indices of the real turns (reversals of at least min_travel), plus the ends."""
    out = [0]
    direction = 0
    best = 0                      # the most extreme point of the current swing
    for i in range(1, len(pts)):
        p = pts[i][1]
        if direction == 0:
            if abs(p - pts[0][1]) >= min_travel:
                direction = 1 if p > pts[0][1] else -1
                best = i
            continue
        if (p - pts[best][1]) * direction > 0:
            best = i              # further the same way
        elif abs(p - pts[best][1]) >= min_travel:
            out.append(best)      # it turned back far enough: that was a turn
            direction = -direction
            best = i
    if best and best != out[-1]:
        out.append(best)
    if out[-1] != len(pts) - 1:
        out.append(len(pts) - 1)
    return out


def _shape(pts: list[Point], tolerance: float, min_travel: float = MIN_TRAVEL) -> list[Point]:
    """Douglas-Peucker on position error at each point's own time.

    Run between the real turns (found first, in one pass), so a long
    zigzag script stays fast: each run is one stroke.
    """
    keep = [False] * len(pts)
    stack = []
    marks = _extremes(pts, min_travel)
    for lo, hi in zip(marks, marks[1:]):
        keep[lo] = keep[hi] = True
        stack.append((lo, hi))
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        (t0, p0), (t1, p1) = pts[lo], pts[hi]
        span = t1 - t0
        worst, at = -1.0, -1
        for k in range(lo + 1, hi):
            t, p = pts[k]
            line = p0 + (p1 - p0) * ((t - t0) / span if span else 0.0)
            err = abs(p - line)
            if err > worst:
                worst, at = err, k
        if worst > tolerance:
            keep[at] = True
            stack.append((lo, at))
            stack.append((at, hi))
    return [p for p, k in zip(pts, keep) if k]


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def _drop_wobble(pts: list[Point], min_travel: float) -> list[Point]:
    """Remove reversals smaller than min_travel (pauses are kept)."""
    changed = True
    while changed and len(pts) > 2:
        changed = False
        out: list[Point] = []
        i = 0
        n = len(pts)
        while i < n:
            if i + 1 < n:
                (ta, a), (tb, b) = pts[i], pts[i + 1]
                travel = abs(b - a)
                hold = travel < FLAT and tb - ta >= HOLD_MS
                prev = out[-1][1] if out else None
                nxt = pts[i + 2][1] if i + 2 < n else None
                if travel < min_travel and not hold and prev is not None and nxt is not None:
                    lo, hi = min(a, b), max(a, b)
                    if prev < lo - 1e-9 and nxt < lo - 1e-9:
                        # A small double peak: one peak, at its highest.
                        out.append(pts[i] if a >= b else pts[i + 1])
                        i += 2
                        changed = True
                        continue
                    if prev > hi + 1e-9 and nxt > hi + 1e-9:
                        out.append(pts[i] if a <= b else pts[i + 1])
                        i += 2
                        changed = True
                        continue
                    if _sign(a - prev) != _sign(b - a) and _sign(b - a) != _sign(nxt - b):
                        # A wobble in the middle of a stroke: straight through.
                        i += 2
                        changed = True
                        continue
            out.append(pts[i])
            i += 1
        if out[-1] != pts[-1]:
            out.append(pts[-1])   # the end of the timeline always stays
        pts = out
    return pts


def _turn(prev: Point, here: Point, nxt: Point) -> bool:
    return _sign(here[1] - prev[1]) * _sign(nxt[1] - here[1]) < 0


def _min_segments(pts: list[Point], min_segment_ms: float) -> list[Point]:
    """No move shorter than min_segment_ms; fast strokes keep their depth."""
    if min_segment_ms <= 0:
        return pts
    changed = True
    while changed and len(pts) > 2:
        changed = False
        out = [pts[0]]
        i = 1
        n = len(pts)
        while i < n - 1:
            here = pts[i]
            if here[0] - out[-1][0] < min_segment_ms:
                turn = _turn(out[-1], here, pts[i + 1])
                if turn and len(out) > 1 and not _turn(out[-2], out[-1], here):
                    out.pop()     # a turn beats the shape point just before it
                    changed = True
                    continue
                later = out[-1][0] + min_segment_ms
                if turn and pts[i + 1][0] - later >= min_segment_ms:
                    # One move too quick, with room after it: turn a moment later.
                    out.append((later, here[1]))
                    i += 1
                elif turn and i + 1 < n - 1 and _turn(here, pts[i + 1], pts[i + 2]):
                    i += 2        # strokes too fast to carry: skip a pair, keep the depth
                else:
                    i += 1        # a point on the way: go straight past it
                changed = True
                continue
            out.append(here)
            i += 1
        last = pts[-1]
        if len(out) > 1 and last[0] - out[-1][0] < min_segment_ms:
            out.pop()             # the timeline keeps its end; the point just before goes
            changed = True
        out.append(last)
        pts = out
    return pts
