"""Together: a partner somewhere else, each driving the other's toys.

The host's card opens a session (``oggstudio/together``) and gets a link with
a random 128-bit token. Whoever opens the link gets a small remote page, or
joins from their own OggStudio card; either way they talk to this Home
Assistant over one websocket that needs no sign-in, and can do nothing else
with it:

* only tiny messages pass, with known keys: ``v`` (one or two levels 0-100),
  ``stop``, ``accept``, ``name`` and ``ping``;
* they go to the host's card and nowhere else. The card decides what to do
  with them (its own limits, its own Stop, and only while the host has
  switched on "let my partner control my toys");
* one partner at a time, a message rate limit, and the link dies when the
  host's card closes the session or goes away, or after six hours.

Nothing is stored and nothing is logged.
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
    # theirs; the host also says when it syncs both or records them.
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
    for flag in ("sync", "rec"):
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
                    session.push({"event": "msg", "data": data})
        finally:
            if session.guest is ws:
                session.guest = None
                session.push({"event": "leave"})
        return ws


async def async_setup_together(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_together)
    websocket_api.async_register_command(hass, ws_together_send)
    hass.http.register_view(TogetherPage())
    hass.http.register_view(TogetherSocket())
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
.tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
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
[hidden]{display:none!important}
</style></head><body><main>
<div class="head"><div class="brand">🤝</div><div><div class="eyebrow">Ogg</div><h1>Together</h1></div><span class="pill wait" id="state">Connecting…</span></div>
<input id="name" type="text" maxlength="30" placeholder="Your name (optional)">
<div class="note" id="recnote" hidden>● Your partner is recording what you send, to play again later.</div>
<div class="note sync" id="syncnote" hidden>⇄ Synced: you both feel the same.</div>
<section id="toysec" hidden><h2>Which toys are yours?</h2><div class="muted">Tap yours: your partner can then play them.</div><div class="toys" id="toys" style="margin-top:8px"></div></section>
<section><h2 id="ctlh">Your partner's toys</h2>
  <div class="tabs"><button data-tab="manual" class="on">✋ Manual</button><button data-tab="pattern">〰 Pattern</button><button data-tab="mood">◎ Mood</button></div>
  <div id="t-manual"><div id="pad"><div id="fill"></div><div id="pct">0%</div></div><div class="muted" style="margin-top:6px">Slide up and down. Double-tap to drop to zero.</div></div>
  <div id="t-pattern" hidden><div class="row"><select id="ptsel"></select><button id="ptgo" style="flex:0 0 96px">▶ Play</button></div>
    <div class="slider"><label id="speedlab">Speed</label><input id="ptspeed" type="range" min="0" max="100" step="5" value="50"><b id="ptspeedv"></b></div>
    <div class="slider"><label>Strength</label><input id="ptstr" type="range" min="20" max="100" step="5" value="100"><b id="ptstrv"></b></div></div>
  <div id="t-mood" hidden><div class="moods" id="moods"></div>
    <div class="slider"><label>Strength</label><input id="moodstr" type="range" min="20" max="100" step="5" value="100"><b id="moodstrv"></b></div>
    <div class="muted" id="moodinfo" style="margin-top:6px"></div></div>
</section>
<section><h2 id="inlbl">From your partner</h2><div class="meter"><div id="in"></div></div>
  <label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="buzz" type="checkbox"> Vibrate this phone with what they send</label></section>
<button id="stop">■ Stop both</button>
</main><script src="/ogg/studio/together-guest.js"></script></body></html>
"""
