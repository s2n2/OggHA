"""Stroke scripts to vibration: the run modes.

A stroke script (funscript for a stroker such as the Handy, pos = position)
is kept as it is and converted when it plays on a vibration device. The card
does the same maths in JavaScript (frontend/oggstudio-card.js).
"""

from __future__ import annotations

import math
from typing import Any

RUN_MODES = ("speed", "position", "upper", "combo", "down", "up")
DEFAULT_RUN_MODE = "speed"


def is_stroke(script: dict[str, Any]) -> bool:
    metadata = script.get("metadata")
    return isinstance(metadata, dict) and metadata.get("type") == "stroke"


def _speed(dpos: float, dt_ms: float) -> float:
    """A full 0-100 stroke in a quarter second (400 %/s) = 100%."""
    return min(100.0, abs(dpos) / dt_ms * 250) if dt_ms > 0 else 0.0


def move_intensity(mode: str, start: float, end: float, dt_ms: float) -> float:
    """Intensity for one move from position start to end in dt_ms."""
    s = _speed(end - start, dt_ms)
    if mode == "down":
        return s if end < start else 0.0
    if mode == "up":
        return s if end > start else 0.0
    if mode == "combo":
        # Speed sets the strength; position fills up to 35% of the headroom.
        return s + (100 - s) * 0.35 * ((start + end) / 2) / 100
    return s


def _round(value: float) -> int:
    return int(math.floor(value + 0.5))   # same as JavaScript Math.round


def to_intensity(actions: list[dict[str, int]], mode: str) -> list[dict[str, int]]:
    """Each move holds its intensity for the whole move, ending at 0."""
    if mode == "upper":
        # Position above 50% as power: 50 and below = 0, 75 = 50, 100 = 100.
        return [{"at": a["at"], "pos": max(0, _round((a["pos"] - 50) * 2))} for a in actions]
    if mode not in RUN_MODES or mode == "position" or len(actions) < 2:
        return [dict(a) for a in actions]
    out: list[dict[str, int]] = []

    def push(at: int, pos: int) -> None:
        if out and out[-1]["at"] >= at:
            out[-1]["pos"] = pos
        else:
            out.append({"at": at, "pos": pos})

    for a, b in zip(actions, actions[1:]):
        v = _round(move_intensity(mode, a["pos"], b["pos"], b["at"] - a["at"]))
        push(a["at"], v)
        if b["at"] - a["at"] > 1:
            push(b["at"] - 1, v)
    push(actions[-1]["at"], 0)
    return out


def run_script(script: dict[str, Any], mode: str | None) -> dict[str, Any]:
    """The script ready for a vibration device."""
    if not is_stroke(script):
        return script
    mode = mode if mode in RUN_MODES else DEFAULT_RUN_MODE
    out = {**script, "actions": to_intensity(script["actions"], mode),
           "metadata": {**script.get("metadata", {}), "type": "vibration"}}
    if "channels" in script:
        out["channels"] = {"V1": {"actions": to_intensity(script["channels"]["V1"]["actions"], mode)}}
    return out
