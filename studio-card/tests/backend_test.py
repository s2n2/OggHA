"""Checks limits, playlists, the PIN and the Together link (Home Assistant is stubbed).

Needs aiohttp and voluptuous.
"""
import asyncio
import importlib
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

from aiohttp import ClientSession, WSServerHandshakeError, web

NAMES = ["homeassistant", "homeassistant.components", "homeassistant.components.http",
         "homeassistant.components.websocket_api", "homeassistant.core", "homeassistant.exceptions",
         "homeassistant.helpers", "homeassistant.helpers.event", "homeassistant.helpers.storage",
         "homeassistant.helpers.entity_registry", "homeassistant.util", "homeassistant.util.dt",
         "homeassistant.config_entries", "homeassistant.const"]
ha = {n: MagicMock() for n in NAMES}
sys.modules.update(ha)


class HomeAssistantError(Exception):
    pass


ha["homeassistant.exceptions"].HomeAssistantError = HomeAssistantError
ha["homeassistant.exceptions"].Unauthorized = type("Unauthorized", (Exception,), {})
ha["homeassistant.core"].callback = lambda f: f
wsapi = ha["homeassistant.components.websocket_api"]
ha["homeassistant.components"].websocket_api = wsapi
wsapi.websocket_command = lambda schema: (lambda f: f)
wsapi.async_response = lambda f: f
wsapi.event_message = lambda i, e: {"id": i, "event": e}
ha["homeassistant.components.http"].HomeAssistantView = type("HomeAssistantView", (), {})

OGG = Path(__file__).parent.parent.parent / "custom_components/ogg"
pkg = types.ModuleType("ogg")
pkg.__path__ = [str(OGG)]
sys.modules["ogg"] = pkg
studio = types.ModuleType("ogg.studio")        # its modules, without Ogg's set-up
studio.__path__ = [str(OGG / "studio")]
sys.modules["ogg.studio"] = studio
lib = importlib.import_module("ogg.studio.library")
privacy = importlib.import_module("ogg.studio.privacy")
together = importlib.import_module("ogg.studio.together")


def fails(fn, *args):
    try:
        fn(*args)
    except HomeAssistantError:
        return True
    return False


# ---- limits
assert lib.clean_limits({}) == lib.NO_LIMITS
assert lib.clean_limits({"max": 60.4, "lo": 10, "hi": 80, "speed": 1}) == {"max": 60, "lo": 10, "hi": 80, "speed": 5}
assert lib.clean_limits({"max": 500})["max"] == 100
assert fails(lib.clean_limits, {"lo": 50, "hi": 52})
assert fails(lib.clean_limits, {"max": "x"}) and fails(lib.clean_limits, {"max": True})
script = {"actions": [{"at": 0, "pos": 100}, {"at": 500, "pos": 50}],
          "channels": {"V1": {"actions": [{"at": 0, "pos": 80}]}}}
assert lib.limit_script(script, None) is script and lib.limit_script(script, lib.NO_LIMITS) is script
cut = lib.limit_script(script, {"max": 50, "lo": 0, "hi": 100, "speed": 100})
assert [a["pos"] for a in cut["actions"]] == [50, 25] and cut["channels"]["V1"]["actions"][0]["pos"] == 40
assert script["actions"][0]["pos"] == 100                      # the saved script is untouched

# ---- playlists
assert lib.clean_playlist([{"script": " A "}, {"mood": "tease"}]) == [{"script": "A"}, {"mood": "tease"}]
for bad in ([], "x", [{"other": "x"}], [{"script": ""}], [{"script": 5}], [1], [{"script": "x"}] * 201):
    assert fails(lib.clean_playlist, bad), bad

# ---- the PIN
digest, salt = privacy.hash_pin("2468")
assert privacy.check_pin("2468", digest, salt) and not privacy.check_pin("2469", digest, salt)
assert privacy.hash_pin("2468")[0] != digest                   # a new salt each time
assert "2468" not in digest

# ---- what a partner may say
clean = together.clean_message
assert clean({"v": [50, 120.26], "x": 1, "service": "ogg.live"}) == {"v": [50.0, 100.0]}
assert clean({"v": [-5]}) == {"v": [0.0]}
for bad in ({"v": [1, 2, 3]}, {"v": ["9"]}, {"v": [float("nan")]}, {"v": [True]}, {"v": []}, {"stop": 1},
            {"accept": "yes"}, {"name": "\n \t"}, [], "x", {}):
    assert clean(bad) is None, bad
assert clean({"stop": True, "accept": False, "name": "A" * 99, "ping": True}) == {
    "stop": True, "accept": False, "name": "A" * 30, "ping": True}
# his/hers toys offered, picked, Sync and Record notices
assert clean({"devices": [{"k": "d0", "name": "Lush\n", "owner": "hers", "kind": "vibe"},
                          {"k": "D0", "name": "bad key"}, {"k": "d1", "name": "X", "owner": "boss", "kind": "laser"}]}) == {
    "devices": [{"k": "d0", "name": "Lush", "owner": "hers", "kind": "vibe"},
                {"k": "d1", "name": "X", "owner": "unassigned", "kind": "vibe"}]}
assert clean({"devices": [{"k": f"d{i}", "name": "t"} for i in range(9)]}) is None
assert clean({"mine": ["d0", "d0", "d2"], "sync": True, "rec": False}) == {"mine": ["d0", "d2"], "sync": True, "rec": False}
for bad in ({"mine": ["d0"] * 5}, {"mine": ["d0; drop"]}, {"mine": "d0"}, {"sync": 1}, {"rec": "yes"}):
    assert clean(bad) is None, bad


# ---- end to end: host card <-> partner over the link
class Conn:
    user = types.SimpleNamespace(id="u1")

    def __init__(self, events):
        self.events = events
        self.subscriptions = {}
        self.errors = []

    def send_message(self, message):
        self.events.append(message["event"])

    def send_result(self, msg_id, result=None):
        pass

    def send_error(self, msg_id, code, text):
        self.errors.append(code)


async def main():
    hass = types.SimpleNamespace(data={}, async_create_task=lambda coro: asyncio.ensure_future(coro))
    app = web.Application()
    app["hass"] = hass
    for view in (together.TogetherPage(), together.TogetherSocket()):
        app.router.add_get(view.url, lambda request, view=view: view.get(request, request.match_info["token"]))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}/api/ogg/studio/together"

    events = []
    conn = Conn(events)
    together.ws_together(hass, conn, {"id": 7, "type": "ogg/studio/together"})
    token = events[0]["token"]
    assert events[0]["event"] == "open" and len(token) >= 22 and events[0]["path"].endswith(token)

    async with ClientSession() as http:
        async with http.get(f"{base}/nope") as r:
            assert r.status == 404
        async with http.get(f"{base}/{token}") as r:
            assert r.status == 200 and "<title>Together</title>" in await r.text()
            assert r.headers["Cache-Control"] == "no-store"
        try:
            await http.ws_connect(f"{base}/nope/ws")
            raise AssertionError("wrong token accepted")
        except WSServerHandshakeError as err:
            assert err.status == 404
        guest = await http.ws_connect(f"{base}/{token}/ws")
        await asyncio.sleep(0.05)
        assert events[-1] == {"event": "join"}
        try:
            await http.ws_connect(f"{base}/{token}/ws")
            raise AssertionError("second partner accepted")
        except WSServerHandshakeError as err:
            assert err.status == 409

        await guest.send_json({"v": [42], "service": "x"})
        await guest.send_str("not json")
        await guest.send_str('{"v":[1],"pad":"' + "x" * 600 + '"}')         # too long: dropped
        await guest.send_json({"stop": True})
        await asyncio.sleep(0.05)
        assert [e["data"] for e in events if e["event"] == "msg"] == [{"v": [42.0]}, {"stop": True}]

        # the rate limit
        before = len(events)
        for _ in range(200):
            await guest.send_json({"v": [5]})
        await asyncio.sleep(0.1)
        assert len(events) - before <= together.MAX_RATE

        # host to partner, cleaned; only the owner of the session may send
        await together.ws_together_send(hass, conn, {"id": 8, "token": token, "data": {"v": [77], "junk": 1}})
        assert (await guest.receive_json()) == {"v": [77.0]}
        other = Conn([])
        await together.ws_together_send(hass, other, {"id": 9, "token": token, "data": {"v": [1]}})
        assert other.errors == ["not_found"]

        # the host's card goes: the link dies and the partner is dropped
        conn.subscriptions[7]()
        await asyncio.sleep(0.05)
        assert (await guest.receive()).type.name in ("CLOSE", "CLOSED", "CLOSING")
        async with http.get(f"{base}/{token}") as r:
            assert r.status == 404
    await runner.cleanup()

    # users who are not allowed cannot open a session
    hass.data[together.ALLOW] = lambda user_id: False
    blocked = Conn([])
    together.ws_together(hass, blocked, {"id": 1, "type": "ogg/studio/together"})
    assert blocked.errors == ["unauthorized"]


asyncio.run(main())
print("backend ok")
