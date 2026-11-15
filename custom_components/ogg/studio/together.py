"""Together: a partner somewhere else, each driving the other's toys.

The host's card opens a session (``oggstudio/together``) and gets a link with
a random 128-bit token. Whoever opens the link gets a small remote page, or
joins from their own OggStudio card; either way they talk to this Home
Assistant over one websocket that needs no sign-in, and can do nothing else
with it:

* only tiny messages pass, with known keys: ``v`` (one or two levels 0-100),
  ``stop``, ``accept``, ``allow``, ``sync``, ``name``, ``ping`` and the
  toys offered and picked;
* they go to the host's card and nowhere else. The card decides what to do
  with them (its own limits, its own Stop, and only while the host has
  switched on "let my partner control my toys");
* one partner at a time, a message rate limit, and the link dies when the
  host's card closes the session or goes away, or after six hours.

Nothing is stored and nothing is logged, except the one thing a partner
can save: a script for his or hers queue (the Queue card's queues), over a
small endpoint on the same link (``.../queue``). There they can list the
queues and the played list, fetch one to play (they play it here, as levels,
like a pattern), mark it played and add their own; nothing else, and only
while the link is live, with a size and a count limit.
"""

from __future__ import annotations

import json
import math
import re
import secrets
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import voluptuous as vol
from aiohttp import WSMsgType, web
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import QUEUES

SESSIONS = "ogg_studio_together"
ALLOW = "ogg_studio_allow"          # set by privacy: may this user use OggStudio?
MAX_SESSIONS = 8
MAX_AGE = 6 * 60 * 60               # s
MAX_RATE = 40                       # messages a second from a partner
MAX_BYTES = 512
MAX_OFFER = 8                       # toys offered to a guest
MAX_MINE = 4                        # toys a guest may pick
KEY = re.compile(r"[a-z][0-9]{1,2}")
OWNERS = ("unassigned", "his", "hers")
KINDS = ("vibe", "stroke", "dual")
GUEST_JS = "/ogg/studio/together-guest.js"
MAX_QUEUE_BYTES = 1_000_000         # a script a partner adds (about an hour of a busy pattern)
MAX_QUEUE_ADDS = 30                 # scripts a partner may add in one session
GUEST_FILE = Path(__file__).parent.parent / "frontend" / "together-guest.js"


def clean_message(data: Any) -> dict[str, Any] | None:
    """Only what a partner may say; anything else is dropped."""
    if not isinstance(data, dict):
        return None
    out: dict[str, Any] = {}
    levels = data.get("v")
    if isinstance(levels, list) and 1 <= len(levels) <= 2 and all(
            isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in levels):
        out["v"] = [round(min(100.0, max(0.0, float(x))), 1) for x in levels]
    if data.get("stop") is True:
        out["stop"] = True
    if isinstance(data.get("accept"), bool):
        out["accept"] = data["accept"]
    if isinstance(data.get("name"), str):
        name = "".join(c for c in data["name"] if c.isprintable()).strip()[:30]
        if name:
            out["name"] = name
    if data.get("ping") is True:
        out["ping"] = True
    # The host offers the toys it is not using (his/hers), the guest picks
    # theirs; either side may switch Sync (both feel the same); the guest
    # says whether the host may play their toys (allow); the host says when
    # it records them.
    devices = data.get("devices")
    if isinstance(devices, list) and len(devices) <= MAX_OFFER:
        offer = []
        for item in devices:
            if not isinstance(item, dict):
                continue
            key, name = item.get("k"), item.get("name")
            if not (isinstance(key, str) and KEY.fullmatch(key) and isinstance(name, str)):
                continue
            offer.append({
                "k": key,
                "name": "".join(c for c in name if c.isprintable()).strip()[:30] or "Toy",
                "owner": item.get("owner") if item.get("owner") in OWNERS else "unassigned",
                "kind": item.get("kind") if item.get("kind") in KINDS else "vibe",
            })
        out["devices"] = offer
    mine = data.get("mine")
    if isinstance(mine, list) and len(mine) <= MAX_MINE and all(isinstance(k, str) and KEY.fullmatch(k) for k in mine):
        out["mine"] = list(dict.fromkeys(mine))
    for flag in ("sync", "rec", "allow"):
        if isinstance(data.get(flag), bool):
            out[flag] = data[flag]
    return out or None


class Session:
    def __init__(self, token: str, owner: Any, push: Callable[[dict[str, Any]], None]) -> None:
        self.token = token
        self.owner = owner              # the host's websocket connection
        self._push = push
        self.guest: web.WebSocketResponse | None = None
        self.closed = False
        self.born = time.monotonic()
        self._window = 0.0
        self._count = 0
        self.added = 0                  # scripts the partner added to a queue
        self.guest_name = ""

    def push(self, event: dict[str, Any]) -> None:
        if not self.closed:
            self._push(event)

    def allow(self) -> bool:
        """The rate limit for what a partner sends."""
        now = time.monotonic()
        if now - self._window >= 1:
            self._window, self._count = now, 0
        self._count += 1
        return self._count <= MAX_RATE

    @property
    def expired(self) -> bool:
        return time.monotonic() - self.born > MAX_AGE

    async def close(self) -> None:
        self.closed = True
        guest, self.guest = self.guest, None
        if guest is not None and not guest.closed:
            try:
                await guest.close()
            except Exception:  # noqa: BLE001
                pass


def _sessions(hass: HomeAssistant) -> dict[str, Session]:
    return hass.data.setdefault(SESSIONS, {})


def _live(hass: HomeAssistant, token: str) -> Session | None:
    session = _sessions(hass).get(token)
    if session is None or session.closed or session.expired:
        return None
    return session


def _base_url(hass: HomeAssistant) -> str | None:
    try:
        from homeassistant.helpers.network import get_url
        return get_url(hass, prefer_external=True, allow_internal=False, allow_ip=True)
    except Exception:  # noqa: BLE001 - no outside address set: the card uses its own
        return None


@websocket_api.websocket_command({vol.Required("type"): "ogg/studio/together"})
@callback
def ws_together(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Open a session; it lasts as long as this subscription."""
    allow = hass.data.get(ALLOW)
    if allow and not allow(connection.user.id if connection.user else None):
        connection.send_error(msg["id"], "unauthorized", "Not allowed")
        return
    sessions = _sessions(hass)
    for token, old in list(sessions.items()):
        if old.owner is connection or old.closed or old.expired:
            sessions.pop(token, None)
            hass.async_create_task(old.close())
    if len(sessions) >= MAX_SESSIONS:
        connection.send_error(msg["id"], "busy", "Too many sessions are open")
        return
    token = secrets.token_urlsafe(16)
    msg_id = msg["id"]
    session = Session(token, connection,
                      lambda event: connection.send_message(websocket_api.event_message(msg_id, event)))
    sessions[token] = session

    @callback
    def end() -> None:
        sessions.pop(token, None)
        hass.async_create_task(session.close())

    connection.subscriptions[msg_id] = end
    connection.send_result(msg_id)
    session.push({"event": "open", "token": token, "path": f"/api/ogg/studio/together/{token}",
                  "base": _base_url(hass)})


@websocket_api.websocket_command({vol.Required("type"): "ogg/studio/together_send",
                                  vol.Required("token"): str, vol.Required("data"): dict})
@websocket_api.async_response
async def ws_together_send(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                           msg: dict[str, Any]) -> None:
    """The host's card says something to its partner."""
    session = _live(hass, msg["token"])
    if session is None or session.owner is not connection:
        connection.send_error(msg["id"], "not_found", "That session has ended")
        return
    data = clean_message(msg["data"])
    guest = session.guest
    if data and guest is not None and not guest.closed:
        try:
            await guest.send_json(data)
        except Exception:  # noqa: BLE001 - the partner just left
            pass
    connection.send_result(msg["id"])


HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"}


class TogetherPage(HomeAssistantView):
    """The remote a partner sees when they open the link."""

    url = "/api/ogg/studio/together/{token}"
    name = "api:ogg:studio:together"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.Response:
        if _live(request.app["hass"], token) is None:
            return web.Response(status=404, text="This link has ended.", headers=HEADERS)
        return web.Response(text=PAGE, content_type="text/html", headers=HEADERS)


class TogetherSocket(HomeAssistantView):
    """A partner's connection: the remote page, or their own OggStudio card."""

    url = "/api/ogg/studio/together/{token}/ws"
    name = "api:ogg:studio:together:ws"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.StreamResponse:
        session = _live(request.app["hass"], token)
        if session is None:
            return web.Response(status=404, text="This link has ended.", headers=HEADERS)
        if session.guest is not None and not session.guest.closed:
            return web.Response(status=409, text="Someone is already connected.", headers=HEADERS)
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=MAX_BYTES * 4)
        await ws.prepare(request)
        session.guest = ws
        session.push({"event": "join"})
        try:
            async for message in ws:
                if session.closed or session.expired:
                    break
                if message.type is not WSMsgType.TEXT or len(message.data) > MAX_BYTES or not session.allow():
                    continue
                try:
                    data = clean_message(json.loads(message.data))
                except ValueError:
                    continue
                if data:
                    if "name" in data:
                        session.guest_name = data["name"]
                    session.push({"event": "msg", "data": data})
        finally:
            if session.guest is ws:
                session.guest = None
                session.push({"event": "leave"})
        return ws


def _queue_json(body: Any, status: int = 200) -> web.Response:
    return web.json_response(body, status=status, headers=HEADERS)


class TogetherQueue(HomeAssistantView):
    """His and hers queues for the partner: the list, and adding one."""

    url = "/api/ogg/studio/together/{token}/queue"
    name = "api:ogg:studio:together:queue"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.Response:
        hass = request.app["hass"]
        queues = hass.data.get(QUEUES)
        if _live(hass, token) is None or queues is None:
            return _queue_json({"error": "ended"}, 404)
        return _queue_json({"items": queues.summary})

    async def post(self, request: web.Request, token: str) -> web.Response:
        hass = request.app["hass"]
        session, queues = _live(hass, token), hass.data.get(QUEUES)
        if session is None or queues is None:
            return _queue_json({"error": "ended"}, 404)
        if session.added >= MAX_QUEUE_ADDS:
            return _queue_json({"error": "That is enough for one session"}, 429)
        if (request.content_length or 0) > MAX_QUEUE_BYTES:
            return _queue_json({"error": "That script is too long"}, 413)
        try:
            raw = await request.content.read(MAX_QUEUE_BYTES + 1)
            if len(raw) > MAX_QUEUE_BYTES:
                return _queue_json({"error": "That script is too long"}, 413)
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ValueError
            by = f"{session.guest_name} (Together)" if session.guest_name else "Together"
            item_id = queues.add(body.get("for"), body.get("name"), body.get("script"), by)
        except (ValueError, UnicodeDecodeError):
            return _queue_json({"error": "That is not a script"}, 400)
        except HomeAssistantError as err:
            return _queue_json({"error": str(err)}, 400)
        session.added += 1
        session.push({"event": "queued", "id": item_id, "name": queues.items[item_id]["name"]})
        return _queue_json({"id": item_id, "name": queues.items[item_id]["name"]})


class TogetherQueueItem(HomeAssistantView):
    """One queued script for the partner to play (GET), or played (POST)."""

    url = "/api/ogg/studio/together/{token}/queue/{item_id}"
    name = "api:ogg:studio:together:queue:item"
    requires_auth = False

    async def get(self, request: web.Request, token: str, item_id: str) -> web.Response:
        hass = request.app["hass"]
        queues = hass.data.get(QUEUES)
        if _live(hass, token) is None or queues is None:
            return _queue_json({"error": "ended"}, 404)
        try:
            return _queue_json({"script": queues.script(item_id), **queues.summary[item_id]})
        except HomeAssistantError as err:
            return _queue_json({"error": str(err)}, 404)

    async def post(self, request: web.Request, token: str, item_id: str) -> web.Response:
        hass = request.app["hass"]
        queues = hass.data.get(QUEUES)
        if _live(hass, token) is None or queues is None:
            return _queue_json({"error": "ended"}, 404)
        try:
            queues.played(item_id)
        except HomeAssistantError as err:
            return _queue_json({"error": str(err)}, 404)
        return _queue_json({"ok": True})


async def async_setup_together(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_together)
    websocket_api.async_register_command(hass, ws_together_send)
    hass.http.register_view(TogetherPage())
    hass.http.register_view(TogetherSocket())
    hass.http.register_view(TogetherQueue())
    hass.http.register_view(TogetherQueueItem())
    if GUEST_FILE.exists():
        # The partner's remote (the page's script); public, like the cards.
        from homeassistant.components.http import StaticPathConfig
        try:
            await hass.http.async_register_static_paths([StaticPathConfig(GUEST_JS, str(GUEST_FILE), False)])
        except RuntimeError:
            pass        # kept across a reload


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Together</title>
<style>
:root{color-scheme:dark;--ink:#f5f6ff;--muted:#9aa7c4;--line:rgba(174,194,246,.13)}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at 110% -10%,rgba(105,100,240,.24),transparent 300px),radial-gradient(circle at -10% 40%,rgba(44,199,191,.09),transparent 280px),#0a1122;
  color:var(--ink);font:15px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;display:flex;justify-content:center;min-height:100vh}
main{width:100%;max-width:460px;padding:18px;display:flex;flex-direction:column;gap:12px}
.head{display:flex;align-items:center;gap:12px}
.brand{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(155deg,#6adfd4,#667ee8);color:#091929;font-size:22px}
.eyebrow{font-size:10px;font-weight:850;letter-spacing:.19em;color:#9ce2d9;text-transform:uppercase}
h1{margin:0;font-size:22px;letter-spacing:-.04em}
.pill{margin-left:auto;font-size:11px;padding:6px 10px;border-radius:30px;border:1px solid rgba(100,218,189,.23);background:rgba(40,124,115,.17);color:#9adbd1}
.pill.wait{border-color:rgba(174,194,246,.14);color:var(--muted);background:rgba(169,184,217,.08)}
section{border:1px solid var(--line);border-radius:19px;padding:14px;background:linear-gradient(145deg,rgba(255,255,255,.056),rgba(255,255,255,.025))}
h2{margin:0 0 8px;font-size:14px;font-weight:760}
.muted{color:var(--muted);font-size:12px}
input[type=text],select{width:100%;font:inherit;padding:10px 12px;border-radius:12px;border:1px solid #364563;background:#17233c;color:#fff}
button{font:inherit;font-weight:760;border-radius:13px;border:1px solid rgba(118,200,239,.35);background:#24395a;color:#bef2ff;min-height:44px;padding:0 12px;cursor:pointer}
button.on{background:linear-gradient(110deg,#31c6b8,#54d4bc);color:#072a2d;border-color:transparent}
.toys{display:flex;flex-wrap:wrap;gap:8px}
.toy{display:flex;align-items:center;gap:6px;min-height:40px}
.chip{font-size:10px;font-weight:800;padding:3px 8px;border-radius:20px;border:1px solid rgba(143,163,200,.25);color:#92a2be}
.chip.his{color:#9fd3ff;border-color:rgba(110,180,255,.4);background:rgba(70,140,230,.12)}
.chip.hers{color:#ffb3d9;border-color:rgba(255,130,190,.4);background:rgba(230,90,160,.12)}
.tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.tabs button{white-space:nowrap;font-size:13px;padding:0 6px;min-height:40px}
button.on .chip{color:#072a2d;border-color:rgba(7,42,45,.35);background:rgba(255,255,255,.35)}
#pad{position:relative;height:min(200px,30vh);border-radius:19px;background:#17243e;border:1px solid #364563;touch-action:none;overflow:hidden;user-select:none;-webkit-user-select:none}
#fill{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(0deg,#31c6b8,#7bccfa)}
#pct{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;font-size:34px;font-weight:800;pointer-events:none}
.row{display:flex;gap:8px;align-items:center}
.row > *{flex:1}
.slider{display:flex;align-items:center;gap:8px;margin-top:8px}
.slider label{flex:0 0 70px;font-size:11px;color:#99a9c5}
.slider input{flex:1}
.slider b{flex:0 0 44px;text-align:right;font-size:12px}
.moods{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.moods button{min-height:38px;font-size:12px;padding:0 6px}
.meter{height:12px;border-radius:6px;background:#17243e;overflow:hidden;margin-top:6px}
#in{height:100%;width:0;background:linear-gradient(90deg,#8f7dff,#b49cff);transition:width .1s linear}
.note{font-size:12px;padding:8px 10px;border-radius:12px;background:rgba(244,100,118,.1);border:1px solid rgba(239,115,134,.3);color:#ffc9d1}
.note.sync{background:rgba(49,198,184,.12);border-color:rgba(84,212,188,.4);color:#c8fff4}
#stop{min-height:54px;background:rgba(244,100,118,.12);border-color:rgba(239,115,134,.38);color:#ffbcc2;font-size:15px}
.qbar{position:relative;height:14px;border-radius:7px;background:#17243e;overflow:hidden;margin-top:8px;cursor:pointer;touch-action:none}
.qbar i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#31c6b8,#7bccfa)}
.qtime{text-align:center;font-size:12px;color:#c9d3ee;margin-top:6px;font-variant-numeric:tabular-nums}
.seg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px}
.seg button{min-height:36px;font-size:12px;padding:0 4px;background:transparent;border-color:#364563;color:var(--muted)}
.seg button.on.his{background:rgba(70,140,230,.16);border-color:rgba(110,180,255,.55);color:#d6e8ff}
.seg button.on.hers{background:rgba(230,90,160,.16);border-color:rgba(255,130,190,.55);color:#ffd9ec}
.seg button.on.played{background:#24395a;border-color:#54d4bc;color:#e9fffb}
.qlist{display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:260px;overflow:auto}
.qitem{display:flex;align-items:center;gap:8px;border:1px solid #364563;border-radius:13px;padding:6px 6px 6px 10px;background:#121b31}
.qitem.cur{border-color:#54d4bc}
.qitem .info{flex:1;min-width:0}
.qitem .nm{font-weight:760;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qitem .meta{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qitem button{min-height:36px;flex:0 0 auto;padding:0 12px}
.empty{font-size:12px;color:var(--muted);text-align:center;padding:8px}
.steps{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.step{border:1px solid #364563;border-radius:15px;background:#121b31;padding:8px;transition:transform .12s}
.step.drag{opacity:.9;box-shadow:0 10px 30px rgba(0,0,0,.45);border-color:#54d4bc;transition:none;position:relative;z-index:2}
.step .top{display:flex;gap:6px;align-items:center}
.step .top select{flex:1;min-width:0;padding:8px 10px;font-size:13px}
.handle{flex:0 0 32px;height:36px;display:grid;place-items:center;color:var(--muted);cursor:grab;touch-action:none;font-size:18px;user-select:none;-webkit-user-select:none}
.num{flex:0 0 14px;font-size:11px;color:var(--muted);font-weight:800;text-align:center}
.kind{flex:0 0 auto;font-size:15px}
.x{flex:0 0 34px;min-height:34px;padding:0;background:transparent;border-color:transparent;color:var(--muted)}
.step .slider select{flex:1;padding:6px 10px;font-size:13px}
.adds{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.adds button{min-height:38px;font-size:12.5px}
.total{font-size:12px;color:#c9d3ee;margin-top:8px;font-weight:700}
#qhis{background:rgba(70,140,230,.14);border-color:rgba(110,180,255,.45);color:#cfe3ff}
#qhers{background:rgba(230,90,160,.14);border-color:rgba(255,130,190,.45);color:#ffd0e8}
.sub{margin:14px 0 4px;font-size:13px;font-weight:760}
.opt{display:flex;flex-direction:column;gap:2px;margin-top:10px}
.opt:first-of-type{margin-top:4px}
.sw{display:flex;align-items:center;gap:10px;font-weight:760;font-size:14px;cursor:pointer;user-select:none;-webkit-user-select:none}
.sw input{appearance:none;-webkit-appearance:none;flex:0 0 50px;width:50px;height:30px;border-radius:16px;background:#1b2741;border:1px solid #364563;position:relative;margin:0;cursor:pointer}
.sw input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#c9cfe4;transition:transform .15s}
.sw input:checked{background:linear-gradient(110deg,#31c6b8,#54d4bc);border-color:transparent}
.sw input:checked::after{transform:translateX(20px);background:#fff}
.sw input:disabled{opacity:.4;cursor:default}
.opt .muted{padding-left:60px}
.qmsg{min-height:16px;font-size:12px;color:#ffcf8a;margin-top:6px}
[hidden]{display:none!important}
</style></head><body><main>
<div class="head"><div class="brand">🤝</div><div><div class="eyebrow">Ogg</div><h1>Together</h1></div><span class="pill wait" id="state">Connecting…</span></div>
<input id="name" type="text" maxlength="30" placeholder="Your name (optional)">
<div class="note" id="recnote" hidden>● Your partner is recording what you send, to play again later.</div>
<div class="note sync" id="syncnote" hidden>⇄ Synced: you both feel the same.</div>
<section id="toysec"><h2>Which toys are yours?</h2><div class="muted" id="toyhint">Tap yours: your partner can then play them.</div><div class="toys" id="toys" style="margin-top:8px"></div></section>
<section id="optsec"><h2>Together</h2>
  <div class="opt"><label class="sw"><input type="checkbox" id="allow" checked> Let my partner play my toys</label><div class="muted" id="allowhint"></div></div>
  <div class="opt"><label class="sw"><input type="checkbox" id="sync"> ⇄ Sync both</label><div class="muted" id="synchint">Off: you play their toys, they play yours.</div></div>
</section>
<section><h2 id="ctlh">Your partner's toys</h2>
  <div class="tabs"><button data-tab="manual" class="on">✋ Manual</button><button data-tab="pattern">〰 Pattern</button><button data-tab="mood">◎ Mood</button><button data-tab="queue">📋 Queue</button></div>
  <div id="t-manual"><div id="pad"><div id="fill"></div><div id="pct">0%</div></div><div class="muted" style="margin-top:6px">Slide up and down. Double-tap to drop to zero.</div></div>
  <div id="t-pattern" hidden><div class="row"><select id="ptsel"></select><button id="ptgo" style="flex:0 0 96px">▶ Play</button></div>
    <div class="slider"><label id="speedlab">Speed</label><input id="ptspeed" type="range" min="0" max="100" step="5" value="50"><b id="ptspeedv"></b></div>
    <div class="slider"><label>Strength</label><input id="ptstr" type="range" min="20" max="100" step="5" value="100"><b id="ptstrv"></b></div></div>
  <div id="t-mood" hidden><div class="moods" id="moods"></div>
    <div class="slider"><label>Strength</label><input id="moodstr" type="range" min="20" max="100" step="5" value="100"><b id="moodstrv"></b></div>
    <div class="muted" id="moodinfo" style="margin-top:6px"></div></div>
  <div id="t-queue" hidden>
    <div class="row"><select id="qpick" aria-label="Script to play"></select></div>
    <div class="qbar" id="qbar"><i id="qcur"></i></div>
    <div class="qtime" id="qtime">Pick one from a queue below, or make one.</div>
    <div class="row" style="margin-top:8px"><button id="qplay">▶ Play</button><button id="qstop" style="background:rgba(244,100,118,.12);border-color:rgba(239,115,134,.38);color:#ffbcc2">■ Stop</button><label class="muted" style="flex:0 0 auto;display:flex;gap:6px;align-items:center"><input id="qloop" type="checkbox"> Loop</label></div>
    <div class="seg" id="qseg"><button type="button" class="his" data-q="his">♂ His</button><button type="button" class="hers" data-q="hers">♀ Hers</button><button type="button" class="played" data-q="played">✓ Played</button></div>
    <div class="qlist" id="qlist"></div>
    <div class="sub">🎨 Make one</div>
    <div class="muted">Patterns, moods and pauses, each for a set time. Drag ⠿ to reorder.</div>
    <div class="steps" id="steps"></div>
    <div class="adds"><button type="button" data-add="pattern">+ Pattern</button><button type="button" data-add="mood">+ Mood</button><button type="button" data-add="pause">+ Pause</button></div>
    <div class="total" id="qtotal"></div>
    <input id="qname" type="text" maxlength="60" style="margin-top:8px" autocomplete="off" aria-label="Name">
    <div class="row" style="margin-top:8px"><button type="button" class="his" id="qhis">♂ Add to his queue</button><button type="button" class="hers" id="qhers">♀ Add to hers queue</button></div>
    <div class="row" style="margin-top:8px"><button type="button" id="qtry">▶ Try it now</button></div>
    <div class="qmsg" id="qmsg" role="status"></div>
  </div>
</section>
<section><h2 id="inlbl">From your partner</h2><div class="meter"><div id="in"></div></div>
  <label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="buzz" type="checkbox"> Vibrate this phone with what they send</label></section>
<button id="stop">■ Stop both</button>
</main><script src="/ogg/studio/together-guest.js"></script></body></html>
"""
