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
import secrets
import time
from collections.abc import Callable
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


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Together</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#12141a;color:#e8eaf0;font:16px/1.4 system-ui,sans-serif;display:flex;justify-content:center}
main{width:100%;max-width:440px;padding:16px;display:flex;flex-direction:column;gap:12px;min-height:100vh}
h1{font-size:18px;margin:0}
#state{font-size:14px;color:#9aa3b5}
#pad{position:relative;flex:1;min-height:260px;border-radius:16px;background:#1c2030;border:1px solid #2c3246;
  touch-action:none;overflow:hidden;user-select:none;-webkit-user-select:none}
#fill{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(#7c5cff,#3b82f6);opacity:.85}
#pct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:600;
  pointer-events:none}
.lbl{font-size:13px;color:#9aa3b5;margin-bottom:4px}
.meter{height:14px;border-radius:7px;background:#1c2030;overflow:hidden}
#in{height:100%;width:0;background:#f59e0b;transition:width .1s linear}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
label{font-size:14px;display:flex;gap:6px;align-items:center}
button{font:inherit;border:0;border-radius:12px;padding:14px;color:#fff;background:#c0392b;font-weight:600;width:100%}
input[type=text]{flex:1;font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #2c3246;background:#1c2030;
  color:inherit;min-width:0}
</style></head><body><main>
<h1>Together</h1>
<div id="state">Connecting…</div>
<div class="row"><input id="name" type="text" maxlength="30" placeholder="Your name (optional)"></div>
<div><div class="lbl">Slide to send. Let go to hold, double-tap to drop to zero.</div></div>
<div id="pad"><div id="fill"></div><div id="pct">0%</div></div>
<div><div class="lbl" id="inlbl">From your partner</div><div class="meter"><div id="in"></div></div></div>
<div class="row"><label><input id="buzz" type="checkbox"> Vibrate this phone with what they send</label></div>
<button id="stop">■ Stop both</button>
</main><script>
(() => {
  const $ = id => document.getElementById(id);
  const url = location.href.replace(/^http/, 'ws').replace(/[?#].*$/, '').replace(/\/$/, '') + '/ws';
  let ws = null, level = 0, sent = -1, incoming = 0, lastIn = 0, tapAt = 0, tries = 0, ended = false;
  const state = text => { $('state').textContent = text; };
  const show = () => { $('fill').style.height = level + '%'; $('pct').textContent = Math.round(level) + '%'; };
  const send = data => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); };
  const stopAll = tell => {
    level = 0; incoming = 0; show(); $('in').style.width = '0';
    if (navigator.vibrate) navigator.vibrate(0);
    if (tell) send({ stop: true });
    send({ v: [0] }); sent = 0;
  };
  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; state('Connected. Waiting for your partner…'); hello(); };
    ws.onmessage = event => {
      let data; try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.stop) { stopAll(false); state('Your partner pressed Stop.'); }
      if (Array.isArray(data.v)) { incoming = Math.max(...data.v); lastIn = Date.now(); $('in').style.width = incoming + '%'; }
      if (data.name) $('inlbl').textContent = 'From ' + data.name;
      if (typeof data.accept === 'boolean') state(data.accept ? 'Connected. You are driving their toys.' : 'Connected. They have not handed you control yet.');
    };
    ws.onclose = event => {
      ws = null;
      if (ended) return;
      if (++tries > 5) { ended = true; state('This link has ended.'); return; }
      state('Connection lost. Trying again…'); setTimeout(connect, 1500 * tries);
    };
  }
  const hello = () => { const name = $('name').value.trim(); if (name) send({ name }); send({ accept: false }); };
  $('name').addEventListener('change', hello);
  const pad = $('pad');
  const at = event => { const r = pad.getBoundingClientRect(); level = Math.min(100, Math.max(0, (r.bottom - event.clientY) / r.height * 100)); show(); };
  pad.addEventListener('pointerdown', event => {
    pad.setPointerCapture(event.pointerId);
    const now = Date.now();
    if (now - tapAt < 300) { level = 0; show(); tapAt = 0; return; }
    tapAt = now; at(event);
  });
  pad.addEventListener('pointermove', event => { if (event.buttons || event.pointerType === 'touch') at(event); });
  $('stop').addEventListener('click', () => { stopAll(true); state('Stopped.'); });
  setInterval(() => {
    const value = Math.round(level);
    if (value !== sent || value > 0) { send({ v: [value] }); sent = value; }
    if (Date.now() - lastIn > 1500 && incoming) { incoming = 0; $('in').style.width = '0'; }
    if ($('buzz').checked && navigator.vibrate) navigator.vibrate(incoming > 3 ? Math.round(incoming * 0.9) : 0);
  }, 100);
  setInterval(() => send({ ping: true }), 10000);
  addEventListener('pagehide', () => send({ v: [0] }));
  connect();
})();
</script></body></html>
"""
