"""Vibration to strokes by feel: the card's aiVibeToStroke (lib/ai.js), in Python.

A vibration script played as positions makes a stroker jump at every pulse.
This reads the vibration's mood every 50 ms (level, swing, pulse rate, rise)
and plans strokes that match its feel. It is a line-for-line port of the
card's JavaScript and gives the same strokes for the same script
(studio-card/tests/feel_test.py checks that against node).
"""

from __future__ import annotations

import math
from typing import Any

AI_STEP = 50          # ms between analysed samples
AI_HALF = 30          # samples either side (3 s window)
STROKE_TOP = 320      # position units per second at 100% (as the card: a stroker's real top speed)


def _round(x: float) -> int:
    """JavaScript's Math.round (halves up)."""
    return math.floor(x + 0.5)


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _i32(x: int) -> int:
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x & 0x80000000 else x


def _imul(a: int, b: int) -> int:
    return _i32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))


def ai_random(seed: int):
    """The card's seeded generator (mulberry32), bit for bit."""
    state = [seed & 0xFFFFFFFF]

    def nxt() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        s = state[0]
        t = _imul(s ^ (s >> 15), 1 | s)
        t = _i32((t + _imul(t ^ ((t & 0xFFFFFFFF) >> 7), 61 | t)) ^ t)
        return ((t ^ ((t & 0xFFFFFFFF) >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def clean_actions(actions: Any) -> list[dict[str, int]]:
    out = []
    for x in actions if isinstance(actions, list) else []:
        if not isinstance(x, dict):
            continue
        at, pos = x.get("at"), x.get("pos")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (at, pos)):
            continue
        out.append({"at": max(0, _round(at)), "pos": _round(min(100, max(0, pos)))})
    return sorted(out, key=lambda a: a["at"])


def ai_seed(acts: list[dict[str, int]]) -> int:
    if not acts:
        return 0
    return (len(acts) * 7919 + acts[-1]["at"] * 31 + acts[0]["pos"]) & 0xFFFFFFFF


def sample_at(actions: list[dict[str, int]], ms: float) -> float:
    if not actions or ms < actions[0]["at"]:
        return 0
    lo, hi = 0, len(actions) - 1
    if ms >= actions[hi]["at"]:
        return actions[hi]["pos"]
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if actions[mid]["at"] <= ms:
            lo = mid
        else:
            hi = mid
    a, b = actions[lo], actions[hi]
    return b["pos"] if b["at"] == a["at"] else a["pos"] + (b["pos"] - a["pos"]) * (ms - a["at"]) / (b["at"] - a["at"])


def vibe_features(v: list[float]) -> dict[str, Any]:
    n = len(v)
    if n < 3:
        return {"mean": v[0] if n else 0, "std": 0, "max": v[0] if n else 0, "pulseRate": 0, "trend": 0, "rising": False}
    total = 0.0
    top = 0.0
    for x in v:
        total += x
        top = max(top, x)
    mean = total / n
    sq = 0.0
    for x in v:
        sq += (x - mean) * (x - mean)
    std = math.sqrt(sq / n)
    hyst = max(6, std * 0.5)
    side = 0
    cross = 0
    for x in v:
        if x > mean + hyst / 2 and side <= 0:
            if side < 0:
                cross += 1
            side = 1
        elif x < mean - hyst / 2 and side >= 0:
            if side > 0:
                cross += 1
            side = -1
    secs = (n - 1) * AI_STEP / 1000
    third = max(1, n // 3)

    def avg(start: int, end: int) -> float:
        s = 0.0
        for i in range(start, end):
            s += v[i]
        return s / (end - start)

    a, b, c = avg(0, third), avg(third, n - third), avg(n - third, n)
    lo = hi = 0
    for i in range(1, n):
        if v[i] < v[lo]:
            lo = i
        if v[i] >= v[hi]:
            hi = i
    rising = b > a + 4 and c > b + 4 and lo <= n * 0.2 and hi >= n * 0.8
    return {"mean": mean, "std": std, "max": top, "pulseRate": cross / 2 / secs, "trend": c - a, "rising": rising}


def vibe_mood(f: dict[str, Any]) -> str:
    if f["mean"] < 4 and f["max"] < 10:
        return "rest"
    if f["pulseRate"] > 3.5 and f["mean"] > 35:
        return "buzz"
    if f["trend"] > 15 and f["rising"]:
        return "build"
    if f["mean"] > 68 and f["std"] < 15:
        return "strong"
    if f["mean"] < 25:
        return "tease"
    if f["std"] >= 14 and f["pulseRate"] >= 0.4:
        return "tease" if f["mean"] < 35 else "pulse"
    if f["std"] >= 10:
        return "wave"
    if f["mean"] < 30:
        return "tease"
    return "steady"


def _style(name: str, f: dict[str, Any], k: int, tm: float, t: float) -> dict[str, float]:
    m, mx, rate = f["mean"], f["max"], f["pulseRate"]
    if name == "park":
        return {"center": 85, "amp": 0, "period": 2}
    if name == "tiptease":
        return {"center": 82, "amp": 14 + 12 * m / 100, "period": 2.2 - 0.8 * m / 100, "pauseEvery": 4, "pauseLen": 0.8}
    if name == "slowfull":
        return {"center": 50, "amp": 70, "period": 3.2 - 1.2 * m / 100}
    if name == "stopstart":
        return {"center": 70, "amp": 30, "period": 1.6, "pauseEvery": 2, "pauseLen": 1.2}
    if name == "swell":
        return {"center": 55, "amp": 30 + 55 * m / 100, "period": 2.4 - 1.2 * m / 100}
    if name == "tidal":
        return {"center": 60 - 20 * m / 100, "amp": 40 + 30 * m / 100, "period": 2.0}
    if name == "beat":
        return {"center": 55, "amp": 35 + 45 * mx / 100, "period": _clamp(1 / max(rate, 0.1), 0.45, 3)}
    if name == "doublebeat":
        return {"center": 60, "amp": 25 + 35 * mx / 100, "period": _clamp(0.5 / max(rate, 0.1), 0.4, 2)}
    if name == "metronome":
        return {"center": 55, "amp": 45, "period": 1.5 - 0.7 * m / 100}
    if name == "longshort":
        return {"center": 50, "amp": 70 if k % 4 < 2 else 30, "period": 1.2 - 0.5 * m / 100}
    if name == "drift":
        return {"center": 50 + 25 * math.sin(0.15 * 2 * math.pi * t), "amp": 40, "period": 1.3 - 0.5 * m / 100}
    if name == "pound":
        return {"center": 40, "amp": 80, "period": 0.75 - 0.25 * m / 100}
    if name == "fullfast":
        return {"center": 50, "amp": 92, "period": 0.6}
    if name == "mixed":
        return {"center": 45, "amp": 85, "period": 1.0} if k % 6 < 2 else {"center": 60, "amp": 30, "period": 0.36}
    if name == "vibrato":
        return {"center": 40, "amp": 18, "period": 0.3}
    if name == "shudder":
        return {"center": 50, "amp": 70, "period": 0.7} if k % 10 < 2 else {"center": 30, "amp": 12, "period": 0.26}
    if name == "climb":
        g = min(1, tm / 10)
        return {"center": 55 - 10 * g, "amp": 30 + 60 * g, "period": 1.6 - 1.0 * g}
    raise ValueError(name)


VIBE_MOOD_STYLES = {
    "rest": ["park"], "tease": ["tiptease", "slowfull", "stopstart"], "wave": ["swell", "tidal", "slowfull"],
    "pulse": ["beat", "doublebeat", "beat"], "steady": ["metronome", "longshort", "drift"],
    "strong": ["pound", "fullfast", "mixed"], "buzz": ["vibrato", "shudder"], "build": ["climb", "climb", "swell"],
}


class _MoodKeeper:
    def __init__(self, seed: int, table: dict[str, list[str]]) -> None:
        self.r = ai_random(seed)
        self.table = table
        self.mood: str | None = None
        self.pat: str | None = None
        self.pat_at = 0.0
        self.pat_until = 0.0
        self.mood_at = 0.0
        self.hist: list[tuple[float, str]] = []

    def update(self, t: float, mood: str, hold: float) -> None:
        if self.mood is None:
            self.mood = mood
            self.mood_at = t
            self.hist = [(t, mood)]
            self.pick(t)
            return
        self.hist.append((t, mood))
        while len(self.hist) > 1 and self.hist[0][0] < t - hold:
            self.hist.pop(0)
        if mood != self.mood and t - self.hist[0][0] >= hold * 0.8:
            share = sum(1 for _, m in self.hist if m == mood) / len(self.hist)
            if share >= 0.7:
                self.mood = mood
                self.mood_at = t
                self.pick(t)
        if t >= self.pat_until:
            self.pick(t)

    def pick(self, t: float) -> None:
        options = self.table[self.mood]
        p = options[math.floor(self.r() * len(options))]
        if p == self.pat and len(set(options)) > 1:
            p = next(x for x in options if x != self.pat)
        self.pat = p
        self.pat_at = t
        self.pat_until = t + 10 + self.r() * 14


class _VibeToStroke:
    def __init__(self, seed: int) -> None:
        self.k = _MoodKeeper(seed, VIBE_MOOD_STYLES)
        self.half = 0
        self.pos = 85.0
        self.dir = 1
        self.next_at = 0.0
        self.paused = False

    def plan(self, t: float, f: dict[str, Any]) -> dict[str, float] | None:
        self.k.update(t, vibe_mood(f), 1.0)
        if t < self.next_at:
            return None
        p = _style(self.k.pat, f, self.half, t - self.k.mood_at, t)
        if p["amp"] < 2:
            goal = _clamp(p["center"], 0, 100)
            dur = max(800, abs(goal - self.pos) / (STROKE_TOP / 1000))
            self.pos = goal
            self.next_at = t + dur / 1000
            return {"goal": goal, "dur": dur}
        every = p.get("pauseEvery")
        if every and self.half > 0 and self.half % (every * 2) == 0 and not self.paused:
            self.paused = True
            self.next_at = t + p["pauseLen"]
            return None
        self.paused = False
        self.dir = -self.dir
        goal = _clamp(p["center"] + self.dir * p["amp"] / 2, 0, 100)
        dur = max(p["period"] * 500, abs(goal - self.pos) / (STROKE_TOP / 1000))
        self.half += 1
        self.pos = goal
        self.next_at = t + dur / 1000
        return {"goal": goal, "dur": dur}


def vibe_to_stroke(actions: Any) -> list[dict[str, int]]:
    """Vibration actions -> stroke actions (planned strokes), as the card does."""
    a = clean_actions(actions)
    if not a:
        return []
    end = a[-1]["at"]
    lv = []
    ms = 0
    while ms <= end:
        lv.append(sample_at(a, ms))
        ms += AI_STEP
    eng = _VibeToStroke(ai_seed(a))
    out = [{"at": 0, "pos": eng.pos}]
    for k in range(len(lv)):
        t = k * AI_STEP / 1000
        f = vibe_features(lv[max(0, k - AI_HALF):k + AI_HALF + 1])
        due = t >= eng.next_at
        before = eng.pos
        move = eng.plan(t, f)
        if move:
            out.append({"at": _round(t * 1000 + move["dur"]), "pos": _round(move["goal"])})
        elif due:
            out.append({"at": _round(eng.next_at * 1000), "pos": _round(before)})
    clean: list[dict[str, Any]] = []
    for x in out:
        if clean and x["at"] <= clean[-1]["at"]:
            clean[-1]["pos"] = x["pos"]
        else:
            clean.append(dict(x))
    return clean


def stroker_script(script: dict[str, Any], limits: dict[str, int] | None) -> dict[str, Any]:
    """A saved script for a stroker: a stroke script as it is, a vibration
    script as strokes by feel; positions inside the device's stroke range."""
    meta = script.get("metadata")
    stroke = isinstance(meta, dict) and meta.get("type") == "stroke"
    actions = clean_actions(script.get("actions")) if stroke else vibe_to_stroke(script.get("actions"))
    lo, hi = (limits.get("lo", 0), limits.get("hi", 100)) if limits else (0, 100)
    return {"actions": [{"at": a["at"], "pos": _round(lo + a["pos"] * (hi - lo) / 100)} for a in actions]}
