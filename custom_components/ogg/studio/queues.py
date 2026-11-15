"""His and hers queues: scripts one partner makes for the other to play.

The Queue card (``type: custom:ogg-queue-card``) builds a script from
patterns, moods and saved scripts and saves it to his or hers queue. The
partner picks one, plays it, and it moves to the played list, where it can
be played again. A link opens the dashboard with one of them ready to play.

Kept in its own storage file, apart from the library; the card sees the
lists (without the scripts) on the saved-script entity and fetches a script
when it is played.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import MAX_NAME_LENGTH
from .library import clean_script, script_info

STORAGE_KEY = "ogg_studio_queues"
WHO = ("his", "hers")
MAX_ITEMS = 200          # queued and played, both queues together
MAX_PLAYED = 60          # the oldest played ones go first


def _who(value: Any) -> str:
    if value not in WHO:
        raise HomeAssistantError("Choose his or hers queue")
    return value


def _name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HomeAssistantError("Give it a name")
    name = " ".join(value.split())
    if len(name) > MAX_NAME_LENGTH:
        raise HomeAssistantError(f"Names can be at most {MAX_NAME_LENGTH} characters")
    return name


class Queues:
    """Scripts waiting in his or hers queue, and the ones already played."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store[dict[str, Any]](hass, 1, STORAGE_KEY)
        self.items: dict[str, dict[str, Any]] = {}     # id -> record (with its script)
        self._listeners: set[Callable[[], None]] = set()

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        for item_id, record in (data.get("items") or {}).items():
            try:
                self.items[str(item_id)] = {
                    "name": _name(record.get("name")),
                    "for": _who(record.get("for")),
                    "script": clean_script(record.get("script")),
                    "made": record.get("made"),
                    "by": str(record.get("by") or "")[:40],
                    "played": record.get("played"),
                    "plays": int(record.get("plays") or 0),
                }
            except (HomeAssistantError, AttributeError, TypeError, ValueError):
                continue

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"items": self.items}, 1)

    @callback
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _changed(self) -> None:
        self._save()
        for listener in tuple(self._listeners):
            listener()

    def _get(self, item_id: Any) -> dict[str, Any]:
        record = self.items.get(item_id) if isinstance(item_id, str) else None
        if record is None:
            raise HomeAssistantError("That one is no longer in the queue")
        return record

    def add(self, who: Any, name: Any, script: Any, by: str = "") -> str:
        who, name = _who(who), _name(name)
        clean = clean_script(script)
        clean.setdefault("metadata", {})["title"] = name
        if len(self.items) >= MAX_ITEMS:
            self._drop_oldest_played()
        if len(self.items) >= MAX_ITEMS:
            raise HomeAssistantError("The queues are full; delete some first")
        item_id = secrets.token_hex(6)
        self.items[item_id] = {"name": name, "for": who, "script": clean, "made": dt_util.utcnow().isoformat(),
                               "by": by[:40], "played": None, "plays": 0}
        self._changed()
        return item_id

    def script(self, item_id: Any) -> dict[str, Any]:
        return self._get(item_id)["script"]

    def played(self, item_id: Any) -> None:
        """It has been played: it moves to (or stays on) the played list."""
        record = self._get(item_id)
        record["played"] = dt_util.utcnow().isoformat()
        record["plays"] += 1
        played = sorted((r["played"], k) for k, r in self.items.items() if r["played"])
        for _, key in played[:max(0, len(played) - MAX_PLAYED)]:
            del self.items[key]
        self._changed()

    def requeue(self, item_id: Any, who: Any = None) -> None:
        """Back into a queue (its own, or the other one's)."""
        record = self._get(item_id)
        record["played"] = None
        if who is not None:
            record["for"] = _who(who)
        self._changed()

    def rename(self, item_id: Any, name: Any) -> None:
        record = self._get(item_id)
        record["name"] = _name(name)
        record["script"].setdefault("metadata", {})["title"] = record["name"]
        self._changed()

    def delete(self, item_id: Any) -> None:
        self._get(item_id)
        del self.items[item_id]
        self._changed()

    def _drop_oldest_played(self) -> None:
        played = sorted((r["played"], k) for k, r in self.items.items() if r["played"])
        if played:
            del self.items[played[0][1]]

    @property
    def summary(self) -> dict[str, dict[str, Any]]:
        """What the card lists: everything but the scripts themselves."""
        out = {}
        for item_id, r in self.items.items():
            info = script_info(r["script"])
            out[item_id] = {"name": r["name"], "for": r["for"], "made": r["made"], "by": r["by"],
                            "played": r["played"], "plays": r["plays"],
                            "duration_ms": info["duration_ms"], "kind": info["kind"], "motors": info["motors"]}
        return out
