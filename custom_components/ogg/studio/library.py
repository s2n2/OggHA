"""Saved scripts (funscript timelines) kept in Home Assistant storage."""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import MAX_NAME_LENGTH, MAX_SCRIPTS, SPEEDS, STORAGE_KEY, STORAGE_VERSION
from .convert import RUN_MODES, is_stroke

MAX_ACTIONS = 200_000
CLAIM_SECONDS = 12   # a controller refreshes its claim every few seconds
MAX_MS = 6 * 60 * 60 * 1000
MAX_PLAYLISTS = 50
MAX_PLAYLIST_ITEMS = 200
NO_LIMITS = {"max": 100, "lo": 0, "hi": 100, "speed": 100}


def clean_limits(data: Any) -> dict[str, int]:
    """Per-device safety limits: top intensity, stroke range and top stroke speed (all %)."""
    def num(key: str, low: int) -> int:
        value = data.get(key, NO_LIMITS[key]) if isinstance(data, dict) else NO_LIMITS[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise HomeAssistantError(f"Invalid limit: {key}")
        return int(round(min(100, max(low, value))))
    limits = {"max": num("max", 0), "lo": num("lo", 0), "hi": num("hi", 0), "speed": num("speed", 5)}
    if limits["hi"] - limits["lo"] < 5:
        raise HomeAssistantError("The stroke range must be at least 5% long")
    return limits


def limit_script(script: dict[str, Any], limits: dict[str, int] | None) -> dict[str, Any]:
    """A vibration script scaled to a device's top intensity."""
    if not limits or limits["max"] >= 100:
        return script
    k = limits["max"] / 100

    def scale(actions: list[dict[str, int]]) -> list[dict[str, int]]:
        return [{"at": a["at"], "pos": int(round(a["pos"] * k))} for a in actions]

    out = {**script, "actions": scale(script["actions"])}
    if "channels" in script:
        out["channels"] = {"V1": {"actions": scale(script["channels"]["V1"]["actions"])}}
    return out


def clean_playlist(items: Any) -> list[dict[str, str]]:
    """A playlist: saved scripts and moods, in order."""
    if not isinstance(items, list) or not items or len(items) > MAX_PLAYLIST_ITEMS:
        raise HomeAssistantError("A playlist needs a list of items")
    clean = []
    for item in items:
        if not isinstance(item, dict):
            raise HomeAssistantError("Invalid playlist item")
        kind = "script" if "script" in item else "mood" if "mood" in item else None
        value = item.get(kind) if kind else None
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_NAME_LENGTH:
            raise HomeAssistantError("A playlist item is a saved script or a mood")
        clean.append({kind: value.strip()})
    return clean


def _clean_actions(raw: Any) -> list[dict[str, int]]:
    if not isinstance(raw, list) or len(raw) > MAX_ACTIONS:
        raise HomeAssistantError("A script needs a list of actions")
    actions = []
    for item in raw:
        if not isinstance(item, dict):
            raise HomeAssistantError("Invalid script action")
        at, pos = item.get("at"), item.get("pos")
        if isinstance(at, bool) or not isinstance(at, (int, float)) or not 0 <= at <= MAX_MS:
            raise HomeAssistantError("Invalid action time")
        if isinstance(pos, bool) or not isinstance(pos, (int, float)) or not math.isfinite(pos):
            raise HomeAssistantError("Invalid action position")
        actions.append({"at": int(at), "pos": int(round(min(100, max(0, pos))))})
    actions.sort(key=lambda action: action["at"])
    return actions


def clean_script(script: Any) -> dict[str, Any]:
    """Validate and normalise a funscript (with optional second motor)."""
    if not isinstance(script, dict):
        raise HomeAssistantError("A script must be a funscript object")
    clean: dict[str, Any] = {
        "version": "1.0",
        "inverted": bool(script.get("inverted", False)),
        "range": 100,
        "actions": _clean_actions(script.get("actions")),
    }
    channels = script.get("channels")
    if isinstance(channels, dict) and isinstance(channels.get("V1"), dict):
        clean["channels"] = {"V1": {"actions": _clean_actions(channels["V1"].get("actions"))}}
    if not clean["actions"]:
        raise HomeAssistantError("The script has no actions")
    metadata = script.get("metadata")
    if isinstance(metadata, dict):
        clean["metadata"] = {
            k: v for k, v in metadata.items()
            if isinstance(k, str) and isinstance(v, (str, int, float, bool)) and len(str(v)) < 500
        }
    return clean


def script_info(script: dict[str, Any]) -> dict[str, Any]:
    second = script.get("channels", {}).get("V1", {}).get("actions") or [{"at": 0}]
    first = script["actions"] or [{"at": 0}]
    duration = max(first[-1]["at"], second[-1]["at"])
    return {"duration_ms": duration, "motors": 2 if "channels" in script else 1,
            "actions": len(script["actions"]), "kind": "stroke" if is_stroke(script) else "vibration"}


class Library:
    """Named scripts plus the shared playback speed."""

    def __init__(self, hass: HomeAssistant, entry_id: str = "") -> None:
        self.hass = hass
        self._store = Store[dict[str, Any]](hass, STORAGE_VERSION, STORAGE_KEY)
        self.scripts: dict[str, dict[str, Any]] = {}
        self.selected: str | None = None
        self.speed = "1x"
        self._listeners: set[Callable[[], None]] = set()
        # Which OggStudio card (phone/browser) is driving each device live.
        # Kept in memory only; a claim lapses if it is not refreshed.
        self.claims: dict[str, dict[str, Any]] = {}
        self.limits: dict[str, dict[str, int]] = {}       # stop entity -> limits
        self.playlists: dict[str, dict[str, Any]] = {}    # name -> {items, loop}
        self.panic_at = 0                                  # ms; cards halt when it changes
        self.settings: dict[str, Any] = {}                 # what the cards need of the options

    async def _async_old_studio_data(self) -> dict[str, Any] | None:
        """The library of the separate OggStudio integration (before it joined Ogg)."""
        ids = [e.entry_id for e in self.hass.config_entries.async_entries("oggstudio")]
        if not ids:
            # Its entry may be gone already; its storage file stays behind.
            folder = Path(self.hass.config.path(".storage"))
            names = await self.hass.async_add_executor_job(
                lambda: sorted(p.name for p in folder.glob("oggstudio.*")) if folder.is_dir() else [])
            ids = [n.split(".", 1)[1] for n in names]
        for entry_id in ids:
            old = await Store[dict[str, Any]](self.hass, STORAGE_VERSION, f"oggstudio.{entry_id}").async_load()
            if old:
                return old
        return None

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data is None:
            # First start inside Ogg: take over what the OggStudio integration kept.
            data = await self._async_old_studio_data()
            if data:
                await self._store.async_save(data)
        data = data or {}
        scripts = data.get("scripts", {})
        if isinstance(scripts, dict):
            for name, record in scripts.items():
                try:
                    self.scripts[name] = {
                        "script": clean_script(record.get("script")),
                        "saved": record.get("saved"),
                    }
                    if record.get("mode") in RUN_MODES:
                        self.scripts[name]["mode"] = record["mode"]
                except (HomeAssistantError, AttributeError):
                    continue
        for entity_id, limits in (data.get("limits") or {}).items():
            try:
                self.limits[entity_id] = clean_limits(limits)
            except HomeAssistantError:
                continue
        for name, record in (data.get("playlists") or {}).items():
            try:
                self.playlists[name] = {"items": clean_playlist(record.get("items")), "loop": bool(record.get("loop"))}
            except (HomeAssistantError, AttributeError):
                continue
        if data.get("speed") in SPEEDS:
            self.speed = data["speed"]
        if data.get("selected") in self.scripts:
            self.selected = data["selected"]

    def _save(self) -> None:
        self._store.async_delay_save(
            lambda: {"scripts": self.scripts, "speed": self.speed, "selected": self.selected,
                     "limits": self.limits, "playlists": self.playlists}, 1
        )

    @callback
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _notify(self) -> None:
        for listener in tuple(self._listeners):
            listener()

    @staticmethod
    def _name(name: Any) -> str:
        if not isinstance(name, str) or not name.strip():
            raise HomeAssistantError("Give the script a name")
        name = " ".join(name.split())
        if len(name) > MAX_NAME_LENGTH:
            raise HomeAssistantError(f"Names can be at most {MAX_NAME_LENGTH} characters")
        return name

    def save(self, name: Any, script: Any, mode: str | None = None) -> str:
        name = self._name(name)
        if name not in self.scripts and len(self.scripts) >= MAX_SCRIPTS:
            raise HomeAssistantError("The library is full; delete some scripts first")
        clean = clean_script(script)
        clean.setdefault("metadata", {})["title"] = name
        self.scripts[name] = {"script": clean, "saved": dt_util.utcnow().isoformat()}
        if mode in RUN_MODES and is_stroke(clean):
            self.scripts[name]["mode"] = mode
        self.selected = name
        self._save()
        self._notify()
        return name

    def delete(self, name: Any) -> None:
        name = self._name(name)
        if self.scripts.pop(name, None) is None:
            raise HomeAssistantError("No saved script has that name")
        if self.selected == name:
            self.selected = next(iter(sorted(self.scripts)), None)
        self._save()
        self._notify()

    def rename(self, name: Any, new_name: Any) -> None:
        name, new_name = self._name(name), self._name(new_name)
        if name not in self.scripts:
            raise HomeAssistantError("No saved script has that name")
        if new_name in self.scripts and new_name != name:
            raise HomeAssistantError("A script with the new name already exists")
        self.scripts[new_name] = self.scripts.pop(name)
        self.scripts[new_name]["script"].setdefault("metadata", {})["title"] = new_name
        if self.selected == name:
            self.selected = new_name
        self._save()
        self._notify()

    def get(self, name: Any) -> dict[str, Any]:
        name = self._name(name)
        if name not in self.scripts:
            raise HomeAssistantError("No saved script has that name")
        return self.scripts[name]["script"]

    def mode(self, name: str) -> str | None:
        """Run mode last used for a saved stroke script."""
        record = self.scripts.get(name)
        return record.get("mode") if record else None

    def set_mode(self, name: Any, mode: str) -> None:
        name = self._name(name)
        record = self.scripts.get(name)
        if record is None:
            raise HomeAssistantError("No saved script has that name")
        if mode not in RUN_MODES:
            raise HomeAssistantError("Unknown run mode")
        if not is_stroke(record["script"]) or record.get("mode") == mode:
            return
        record["mode"] = mode
        self._save()
        self._notify()

    def select(self, name: str) -> None:
        if name in self.scripts:
            self.selected = name
            self._save()
            self._notify()

    def set_speed(self, speed: str) -> None:
        if speed not in SPEEDS:
            raise HomeAssistantError("Unknown speed")
        self.speed = speed
        self._save()
        self._notify()

    def claim(self, entity_id: str, owner: str, label: str = "", release: bool = False) -> None:
        """Claim (or refresh, or release) live control of a device."""
        now = time.monotonic()
        changed = self._prune(now)
        current = self.claims.get(entity_id)
        if release:
            if current and current["owner"] == owner:
                del self.claims[entity_id]
                changed = True
        else:
            if not current or current["owner"] != owner or current["label"] != label:
                changed = True
            self.claims[entity_id] = {"owner": owner, "label": label[:80], "until": now + CLAIM_SECONDS}
            async_call_later(self.hass, CLAIM_SECONDS + 0.5, self._expire)
        if changed:
            self._notify()

    def release_owner(self, owner: str) -> list[str]:
        """Drop every claim of one card; returns the devices it was driving."""
        gone = [k for k, v in self.claims.items() if v["owner"] == owner]
        for key in gone:
            del self.claims[key]
        if gone:
            self._notify()
        return gone

    def set_limits(self, entity_id: str, limits: Any) -> None:
        clean = clean_limits(limits)
        if clean == NO_LIMITS:
            self.limits.pop(entity_id, None)
        else:
            self.limits[entity_id] = clean
        self._save()
        self._notify()

    def save_playlist(self, name: Any, items: Any, loop: bool = False) -> str:
        name = self._name(name)
        if name not in self.playlists and len(self.playlists) >= MAX_PLAYLISTS:
            raise HomeAssistantError("Too many playlists; delete one first")
        self.playlists[name] = {"items": clean_playlist(items), "loop": bool(loop)}
        self._save()
        self._notify()
        return name

    def delete_playlist(self, name: Any) -> None:
        if self.playlists.pop(self._name(name), None) is None:
            raise HomeAssistantError("No playlist has that name")
        self._save()
        self._notify()

    def panic(self) -> None:
        """Everything stops: claims go, and every card halts when it sees the new time."""
        self.claims.clear()
        self.panic_at = max(self.panic_at + 1, int(time.time() * 1000))
        self._notify()

    def set_settings(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        self._notify()

    def _prune(self, now: float) -> bool:
        gone = [k for k, v in self.claims.items() if v["until"] <= now]
        for key in gone:
            del self.claims[key]
        return bool(gone)

    @callback
    def _expire(self, _now: Any) -> None:
        if self._prune(time.monotonic()):
            self._notify()

    @property
    def controllers(self) -> dict[str, dict[str, str]]:
        return {k: {"owner": v["owner"], "label": v["label"]} for k, v in self.claims.items()}

    @property
    def speed_factor(self) -> float:
        return float(self.speed.rstrip("x"))
