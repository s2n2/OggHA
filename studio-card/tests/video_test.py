"""Checks the cast relay: ranges, and a TV fetching through it from a fake browser.

Needs aiohttp and voluptuous (Home Assistant itself is stubbed).
"""
import asyncio
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

from aiohttp import ClientSession, web

ha = {n: types.ModuleType(n) for n in ["homeassistant", "homeassistant.components", "homeassistant.components.http",
                                       "homeassistant.components.websocket_api", "homeassistant.core"]}
sys.modules.update(ha)
ha["homeassistant.components"].websocket_api = ha["homeassistant.components.websocket_api"]
ha["homeassistant.components.websocket_api"].websocket_command = lambda schema: (lambda f: f)
ha["homeassistant.components.websocket_api"].event_message = lambda i, e: {"id": i, "event": e}
ha["homeassistant.components.http"].HomeAssistantView = type("HomeAssistantView", (), {"json": staticmethod(lambda d: web.json_response(d))})
ha["homeassistant.core"].HomeAssistant = object
ha["homeassistant.core"].callback = lambda f: f
spec = importlib.util.spec_from_file_location("video", Path(__file__).parent.parent.parent / "custom_components/ogg/studio/video.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

# ---- ranges
assert v.parse_range(None, 100) is None
assert v.parse_range("bytes=0-", 100) == (0, 99)
assert v.parse_range("bytes=10-19", 100) == (10, 19)
assert v.parse_range("bytes=90-500", 100) == (90, 99)
assert v.parse_range("bytes=-10", 100) == (90, 99)
assert v.parse_range("bytes=0-1,5-6", 100) is None          # several ranges: send it all
for bad in ("bytes=100-", "bytes=50-10", "bytes=-0"):
    try:
        v.parse_range(bad, 100)
        raise AssertionError(bad)
    except ValueError:
        pass
assert v.link_name("../My clip (1).MP4") == "My_clip_1.mp4"
assert v.link_name("x.exe") == "x.mp4"

# ---- old stored videos are deleted, nothing else
with tempfile.TemporaryDirectory() as d:
    f = Path(d) / "oggstudio"
    f.mkdir()
    (f / "My_clip-1234.mp4").write_bytes(b"x")
    (f / "My_clip-99.webm.part").write_bytes(b"x")
    assert v._remove_stored([f, Path(d) / "missing"]) == 2 and not f.exists()
    f.mkdir()
    (f / "mine.txt").write_text("keep")
    assert v._remove_stored([f]) == 0 and (f / "mine.txt").exists()


# ---- end to end: a TV fetching ranges, the "browser" answering from its file
async def main():
    hass = types.SimpleNamespace(data={})
    video = os.urandom(5 * v.BLOCK + 12345)
    asked = []
    data_view = v.RelayDataView(hass)

    def send(event):           # the websocket event to the browser: answer it like the card does
        asked.append(event)
        async def reply():
            await asyncio.sleep(0.01)
            relay.answer(event["req"], video[event["start"]:event["start"] + event["length"]])
        asyncio.get_running_loop().create_task(reply())

    relay = v.Relay("abc", "u1", len(video), "video/mp4", send)
    hass.data[v.RELAYS] = {"abc": relay}
    tv_view = v.RelayView(hass)
    app = web.Application()
    app.router.add_get("/r/{sid}/{name}", lambda r: tv_view.get(r, r.match_info["sid"], r.match_info["name"]))
    app.router.add_post("/d/{sid}/{req}", lambda r: data_view.post(r, r.match_info["sid"], r.match_info["req"]))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    async with ClientSession() as s:
        async with s.get(f"{base}/r/abc/x.mp4") as r:
            assert r.status == 200 and r.headers["Accept-Ranges"] == "bytes"
            assert await r.read() == video
        async with s.get(f"{base}/r/abc/x.mp4", headers={"Range": "bytes=3000000-3100000"}) as r:
            assert r.status == 206 and r.headers["Content-Range"] == f"bytes 3000000-3100000/{len(video)}"
            assert await r.read() == video[3000000:3100001]
        async with s.get(f"{base}/r/abc/x.mp4", headers={"Range": "bytes=-500"}) as r:
            assert await r.read() == video[-500:]
        async with s.head(f"{base}/r/abc/x.mp4") as r:
            assert r.status == 200 and int(r.headers["Content-Length"]) == len(video)
        async with s.get(f"{base}/r/abc/x.mp4", headers={"Range": f"bytes={len(video)}-"}) as r:
            assert r.status == 416
        # The TV stops reading part way (a seek): what it no longer needs is not waited for.
        n = len(asked)
        async with s.get(f"{base}/r/abc/x.mp4") as r:
            await r.content.read(1000)
        await asyncio.sleep(0.2)
        assert len(asked) - n <= v.AHEAD + 2, len(asked) - n
        assert not relay._pending, relay._pending
        # The browser can answer a block it was asked for; a stranger or an old request is ignored.
        async with s.post(f"{base}/d/abc/999999", data=b"x") as r:
            assert (await r.json())["used"] is False
        async with s.post(f"{base}/d/nope/1", data=b"x") as r:
            assert r.status == 404
        # Ending the cast ends the link.
        relay.close()
        hass.data[v.RELAYS].pop("abc")
        async with s.get(f"{base}/r/abc/x.mp4") as r:
            assert r.status == 404
    # A browser that stops answering: the TV request ends, it does not hang forever.
    v.WAIT = 0.3
    silent = v.Relay("s", "u1", 3 * v.BLOCK, "video/mp4", lambda e: None)
    hass.data[v.RELAYS]["s"] = silent
    async with ClientSession() as s:
        try:
            async with asyncio.timeout(5):
                async with s.get(f"{base}/r/s/x.mp4") as r:
                    body = await r.read()
            raise AssertionError(f"got {len(body)} bytes from a silent browser")
        except Exception as err:  # noqa: BLE001 - the connection is closed on the TV
            assert not isinstance(err, (AssertionError, TimeoutError)), err
    await runner.cleanup()

asyncio.run(main())
print("OggStudio cast relay passed")
