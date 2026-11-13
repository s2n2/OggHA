"""Private mode: Ogg's toys stop showing their status to everyone else.

Home Assistant has one state per entity, the same for every user. While
private mode is on, Ogg's entities stop writing their state to it: other
users (and history, the logbook and automations) keep seeing what was there
when it was turned on. The user who turned it on gets the live states over a
websocket feed (``ogg/private/subscribe``), on every device they are signed
in on, and Ogg's cards show those instead: for them everything behaves as
usual. Only that user (or the owner of the Home Assistant instance) can turn
it off; then the live states are written again.

The toys keep working for everyone; only what they show is held.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

DATA = "ogg_private"
STORAGE_KEY = "ogg_private"


class PrivateMode:
    """Who has private mode on, Ogg's entities, and the owner's live feed."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.owner: str | None = None          # user id
        self.since: float | None = None
        self.entities: dict[str, Entity] = {}  # entity_id -> entity
        self.live: dict[str, dict[str, Any]] = {}
        self.subscribers: dict[int, tuple[Any, int, str | None]] = {}
        self._store: Store = Store(hass, 1, STORAGE_KEY)
        self._next = 0

    @property
    def active(self) -> bool:
        return self.owner is not None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        owner = data.get("owner")
        if isinstance(owner, str) and owner:
            self.owner = owner
            self.since = data.get("since")

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"owner": self.owner, "since": self.since}, 1)

    # ------------------------------------------------------------ entities
    @callback
    def capture(self, entity: Entity) -> bool:
        """While on: keep the live state for the owner, not in HA. True = held."""
        if not self.active or not entity.entity_id:
            return False
        if self.hass.states.get(entity.entity_id) is None:
            return False        # a new entity gets its first state (it must exist)
        calculated = entity._async_calculate_state()  # noqa: SLF001
        row = {"state": calculated.state, "attributes": dict(calculated.attributes)}
        old = self.live.get(entity.entity_id)
        if old is not None and old["state"] == row["state"] and old["attributes"] == row["attributes"]:
            return True
        now = time.time()
        row["last_changed"] = now if old is None or old["state"] != row["state"] else old["last_changed"]
        row["last_updated"] = now
        self.live[entity.entity_id] = row
        self._send({entity.entity_id: row})
        return True

    @callback
    def snapshot(self) -> dict[str, dict[str, Any]]:
        """The live state of every Ogg entity now (for a new owner session)."""
        out: dict[str, dict[str, Any]] = {}
        now = time.time()
        for entity_id, entity in self.entities.items():
            if entity.hass is None:
                continue
            try:
                calculated = entity._async_calculate_state()  # noqa: SLF001
            except Exception:  # noqa: BLE001 - one odd entity must not stop the feed
                continue
            old = self.live.get(entity_id)
            row = {"state": calculated.state, "attributes": dict(calculated.attributes),
                   "last_changed": old["last_changed"] if old and old["state"] == calculated.state else now,
                   "last_updated": now}
            self.live[entity_id] = row
            out[entity_id] = row
        return out

    # ------------------------------------------------------------ on / off
    @callback
    def turn_on(self, user_id: str) -> None:
        if self.owner == user_id:
            return
        self.owner = user_id
        self.since = time.time()
        self.live = {}
        self._save()
        self._tell_all()

    @callback
    def turn_off(self) -> None:
        if not self.active:
            return
        self.owner = None
        self.since = None
        self.live = {}
        self._save()
        # Everyone sees the live states again.
        for entity in list(self.entities.values()):
            if entity.hass is not None and entity.entity_id:
                entity.async_write_ha_state()
        self._tell_all()

    # ------------------------------------------------------------ the feed
    def _status(self, user_id: str | None) -> dict[str, Any]:
        mine = self.active and user_id == self.owner
        return {"on": self.active, "mine": mine, "since": self.since if mine else None}

    def _send(self, states: dict[str, dict[str, Any]]) -> None:
        for connection, msg_id, user_id in list(self.subscribers.values()):
            if user_id == self.owner:
                connection.send_message(websocket_api.event_message(msg_id, {"states": states}))

    def _tell_all(self) -> None:
        for connection, msg_id, user_id in list(self.subscribers.values()):
            event = self._status(user_id)
            if event["mine"]:
                event["states"] = self.snapshot()
            connection.send_message(websocket_api.event_message(msg_id, event))

    def subscribe(self, connection: Any, msg_id: int) -> int:
        self._next += 1
        user = connection.user
        self.subscribers[self._next] = (connection, msg_id, user.id if user else None)
        return self._next


def private_mode(hass: HomeAssistant | None) -> PrivateMode | None:
    return hass.data.get(DATA) if hass is not None else None


class PrivateStateMixin(Entity):
    """Ogg's entities: while private mode is on, the state is held from HA."""

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        mode = private_mode(self.hass)
        if mode is not None and self.entity_id:
            mode.entities[self.entity_id] = self

    async def async_will_remove_from_hass(self) -> None:
        mode = private_mode(self.hass)
        if mode is not None:
            mode.entities.pop(self.entity_id, None)
            mode.live.pop(self.entity_id, None)
        await super().async_will_remove_from_hass()

    @callback
    def _async_write_ha_state(self) -> None:
        mode = private_mode(self.hass)
        if mode is not None and mode.capture(self):
            return
        super()._async_write_ha_state()


async def async_setup_private(hass: HomeAssistant) -> None:
    """Private mode's state and its websocket commands (once)."""
    if DATA in hass.data:
        return
    mode = PrivateMode(hass)
    await mode.async_load()
    hass.data[DATA] = mode
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_set)


@websocket_api.websocket_command({vol.Required("type"): "ogg/private/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Whether private mode is on; for its owner, the live states too."""
    mode: PrivateMode = hass.data[DATA]
    key = mode.subscribe(connection, msg["id"])

    @callback
    def unsubscribe() -> None:
        mode.subscribers.pop(key, None)

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    user_id = connection.user.id if connection.user else None
    event = mode._status(user_id)  # noqa: SLF001
    if event["mine"]:
        event["states"] = mode.snapshot()
    connection.send_message(websocket_api.event_message(msg["id"], event))


@websocket_api.websocket_command({vol.Required("type"): "ogg/private/set", vol.Required("on"): bool})
@callback
def ws_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Turn private mode on (for yourself) or off (if it is yours)."""
    mode: PrivateMode = hass.data[DATA]
    user = connection.user
    if user is None:
        raise Unauthorized
    if msg["on"]:
        if mode.active and mode.owner != user.id:
            connection.send_error(msg["id"], "in_use", "Private mode is already on for someone else")
            return
        mode.turn_on(user.id)
    else:
        if mode.active and mode.owner != user.id and not user.is_owner:
            connection.send_error(msg["id"], "not_yours", "Only the person who turned private mode on can turn it off")
            return
        mode.turn_off()
    connection.send_result(msg["id"], {"on": mode.active})
