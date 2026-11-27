// Stroker smoothing in the card: cleaned timelines (lib/smooth.js) and live
// following (OutputsPart._outLinear), without a browser.
import assert from 'assert';
import { smoothActions, smoothPoints, smoothedFor, SMOOTH_MIN_SEGMENT_MS } from '../src/lib/smooth.js';
import { NO_LIMITS } from '../src/lib/limits.js';
import { OutputsPart } from '../src/card/outputs.js';
import { aiVibeToStroke } from '../src/lib/ai.js';

globalThis.HTMLElement = globalThis.HTMLElement || class {};
globalThis.window = globalThis.window || Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} });
const { OggQueueCard } = await import('../src/card/queuecard.js');

const turns = (pts) => pts.filter((b, i) => i > 0 && i < pts.length - 1 && (b[1] - pts[i - 1][1]) * (pts[i + 1][1] - b[1]) < 0);

// A clean script is left as it is; a dense, wobbly recording keeps its strokes only.
{
  const clean = Array.from({ length: 12 }, (_, i) => [i * 400, i % 2 ? 90 : 10]);
  assert.deepStrictEqual(smoothPoints(clean), clean);
  let seed = 3; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rec = Array.from({ length: 160 }, (_, k) => ({ at: k * 50, pos: Math.round(50 + 35 * Math.sin(2 * Math.PI * k * 50 / 1800) + (rand() * 5 - 2.5)) }));
  const out = smoothActions(rec);
  assert.ok(out.length < rec.length / 3, `fewer points (${out.length})`);
  const t = turns(out.map((a) => [a.at, a.pos]));
  assert.ok(t.length >= 8 && t.length <= 9, `the real strokes only (${t.length})`);
  assert.ok(out.every((a, i) => i === 0 || a.at - out[i - 1].at >= SMOOTH_MIN_SEGMENT_MS), 'no move too quick for Bluetooth');
  assert.strictEqual(out[0].at, 0); assert.strictEqual(out[out.length - 1].at, rec[rec.length - 1].at);
  // Pauses stay; the cache returns the same cleaned copy.
  assert.deepStrictEqual(smoothPoints([[0, 10], [500, 90], [2500, 90], [3000, 10]]), [[0, 10], [500, 90], [2500, 90], [3000, 10]]);
  assert.strictEqual(smoothedFor(rec, 1), smoothedFor(rec, 1));
  assert.notStrictEqual(smoothedFor(rec, 2), smoothedFor(rec, 1));
}

// Live following: a finger dragged with a little tremor, held, then let go.
{
  const calls = [];
  const card = {
    _linLast: {}, _linFollow: {},
    _hass: { services: { ogg: { linear: {} } }, callService: (d, s, data) => { calls.push({ ...data, at: now }); return Promise.resolve(); } },
    _limits: () => NO_LIMITS,
  };
  const dev = { id: 'h', stop: 'button.h', linear: 'number.h' };
  const send = (move, now) => OutputsPart.prototype._outLinear.call(card, dev, move, now);
  let now = 1000;
  let seed = 9; const jit = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 3;
  for (let t = 0; t <= 600; t += 20, now += 20) send({ goal: (t / 600) * 80 + jit(), dur: 120 }, now);   // drag 0 -> 80
  const dragged = calls.length;
  for (let t = 0; t < 600; t += 20, now += 20) send({ goal: 80 + jit() * 0.6, dur: 120 }, now);           // held at 80, trembling
  const atRest = calls.length;
  send({ goal: 81, settle: true }, now);                                                              // let go
  send({ goal: 81, settle: true }, now + 20);                                                         // (next tick)
  assert.ok(dragged >= 5 && dragged <= 12, `a steady run of moves while dragging (${dragged})`);
  assert.ok(calls.slice(0, dragged).every((c, i) => i === 0 || c.at - calls[i - 1].at >= 60), 'paced for Bluetooth');
  // Each move lands before the next replaces it (the Handy starts a new
  // move from wherever it is, so a move cut short never reaches its turn).
  assert.ok(calls.slice(0, dragged).every((c, i) => i === 0 || c.at - calls[i - 1].at >= calls[i - 1].duration - 15), 'no move is cut short');
  if (process.env.SHOW) console.log(calls);
  assert.ok(calls.every((c) => c.duration >= 60), 'each follow move lasts as long as the finger took');
  // The finger's path, replayed: steady, in order.
  const drag = calls.slice(1, dragged);
  assert.ok(drag.every((c, i) => i === 0 || c.position >= drag[i - 1].position - 2), 'it replays the drag in order (no guessing ahead, no overshoot)');
  assert.ok(atRest - dragged <= 3, `a still finger is not chased (${atRest - dragged} moves while held: the replay's tail and at most one tremor)`);
  assert.ok(calls.length - atRest <= 1, 'letting go sends at most one gentle move');
  assert.ok(Math.abs(calls[calls.length - 1].position - 80) <= 3, 'it ends where the finger did');
}

// Script moves (targets) go as they are, and a follow move after them does not lurch.
{
  const calls = [];
  const card = { _linLast: {}, _linFollow: {}, _hass: { services: { ogg: { linear: {} } }, callService: (d, s, data) => { calls.push(data); return Promise.resolve(); } }, _limits: () => NO_LIMITS };
  const dev = { id: 'h', stop: 'button.h' };
  OutputsPart.prototype._outLinear.call(card, dev, { goal: 90, dur: 600, target: true }, 0);
  OutputsPart.prototype._outLinear.call(card, dev, { goal: 10, dur: 500, target: true }, 600);
  assert.deepStrictEqual(calls.map((c) => [c.position, c.duration]), [[90, 600], [10, 500]]);
}
// A vibration recording (or pattern) on a stroker: strokes that follow its
// feel, never its levels as positions (a pulse was a jump).
{
  const pulses = [];
  for (let t = 0; t < 30000; t += 1000) pulses.push({ at: t, pos: 0 }, { at: t + 50, pos: 75 }, { at: t + 500, pos: 75 }, { at: t + 550, pos: 0 });
  const jumps = (a) => a.slice(1).filter((x, i) => Math.abs(x.pos - a[i].pos) >= 30 && x.at - a[i].at <= 60).length;
  assert.ok(jumps(pulses) > 40, 'the recording is all jumps as positions');
  const card = Object.create(OggQueueCard.prototype);
  Object.defineProperty(card, '_saved', { value: { attributes: { limits: {} } } });
  const out = card._forDevice({ stop: 'button.h', linear: 'number.h', vibe: false }, { actions: pulses });
  assert.strictEqual(out.output, 'linear');
  assert.strictEqual(jumps(out.script.actions), 0, 'no jumps on the stroker');
  const strokes = turns(out.script.actions.map((a) => [a.at, a.pos]));
  assert.ok(strokes.length > 20, `it strokes (${strokes.length} turns)`);
  assert.deepStrictEqual(out.script.actions, aiVibeToStroke(pulses).actions.map((a) => ({ at: a.at, pos: a.pos })));
  // A stroke recording stays as it was recorded.
  const stroke = { actions: [{ at: 0, pos: 10 }, { at: 600, pos: 90 }, { at: 1200, pos: 10 }], metadata: { type: 'stroke' } };
  assert.deepStrictEqual(card._forDevice({ stop: 'button.h', linear: 'number.h', vibe: false }, stroke).script.actions, stroke.actions);
}
console.log('stroker smoothing passed');

// Finger strokes faster than the stroker can go: it keeps full-depth strokes
// at its own top speed (each move to a turn, none cut short), never shallow
// wandering in the middle.
{
  const calls = [];
  let now = 0;
  const card = { _linLast: {}, _linFollow: {}, _limits: () => NO_LIMITS,
    _hass: { services: { ogg: { linear: {} } }, callService: (d, s, data) => { calls.push({ ...data, at: now }); return Promise.resolve(); } } };
  const dev = { id: 'h', stop: 'button.h' };
  for (now = 0; now <= 4000; now += 20) OutputsPart.prototype._outLinear.call(card, dev, { goal: 50 + 42 * Math.sin(2 * Math.PI * now / 300), dur: 120 }, now);
  const later = calls.filter((c) => c.at > 1000);
  const depth = later.slice(1).map((c, i) => Math.abs(c.position - later[i].position));
  depth.sort((a, b) => a - b);
  assert.ok(depth[depth.length >> 1] >= 60, `fast finger strokes stay deep (${depth[depth.length >> 1]}%)`);
  assert.ok(calls.every((c, i) => i === 0 || c.at - calls[i - 1].at >= calls[i - 1].duration - 15), 'no fast move is cut short');
}

// A slow finger (5 %/s, whole screen pixels): the stroker creeps with it in
// small steps that join up, not a hop of a few % every few hundred ms with
// stops between (measured on the Handy as jumpy slow control).
{
  const calls = [];
  let now = 0;
  const card = { _linLast: {}, _linFollow: {}, _limits: () => NO_LIMITS,
    _hass: { services: { ogg: { linear: {} } }, callService: (d, s, data) => { calls.push({ ...data, at: now }); return Promise.resolve(); } } };
  const dev = { id: 'h', stop: 'button.h' };
  const px = 100 / 380;
  for (now = 0; now <= 4600; now += 20) {
    const finger = now < 300 ? 40 : now > 4300 ? 60 : 40 + 20 * (now - 300) / 4000;
    OutputsPart.prototype._outLinear.call(card, dev, { goal: Math.round(finger / px) * px, dur: 120 }, now);
  }
  const moving = calls.filter((c) => c.at > 600 && c.at < 4300);
  assert.ok(moving.length >= 15, `a slow finger moves it in small steps (${moving.length})`);
  for (let i = 1; i < moving.length; i++) {
    const c = moving[i], prev = moving[i - 1];
    const speed = Math.abs(c.position - prev.position) / c.duration * 1000;
    assert.ok(speed <= 10, `no hop faster than twice the finger (${speed.toFixed(1)} %/s)`);
    assert.ok(c.at - prev.at <= prev.duration + 100, `steps join up (gap ${c.at - prev.at - prev.duration} ms)`);
  }
}

// A finger at rest with a pixel or two of shake sends nothing.
{
  const calls = [];
  let now = 0, seed = 5;
  const card = { _linLast: {}, _linFollow: {}, _limits: () => NO_LIMITS,
    _hass: { services: { ogg: { linear: {} } }, callService: (d, s, data) => { calls.push({ ...data, at: now }); return Promise.resolve(); } } };
  const dev = { id: 'h', stop: 'button.h' };
  for (now = 0; now <= 4000; now += 20) {
    seed = (seed * 16807) % 2147483647;
    OutputsPart.prototype._outLinear.call(card, dev, { goal: 50 + (seed / 2147483647 - 0.5) * 0.8, dur: 120 }, now);
  }
  assert.strictEqual(calls.length, 1, `a resting finger sends only its first move (${calls.length})`);
}
console.log('slow finger following passed');

// The Play card spreads the slider under the video over the stroke range (as
// it does a script and a recording), and a recording starts from the
// stroker's own place on that slider, so starting one does not jump it.
{
  const { PlayPart } = await import('../src/card/play.js');
  const card = { _simple: true, _st: { lower: 30, upper: 90, pos: 60 } };
  const lim = (v) => PlayPart.prototype._lim.call(card, v);
  const unlim = (p) => PlayPart.prototype._unlim.call(card, p);
  assert.strictEqual(lim(0), 30);
  assert.strictEqual(lim(100), 90);
  for (const pos of [30, 45, 60, 77, 90]) assert.strictEqual(lim(Math.round(unlim(pos))), pos, `slider and stroker agree at ${pos}`);
  assert.strictEqual(unlim(10), 0);
  assert.strictEqual(unlim(95), 100);
  card._st = { lower: 50, upper: 50 };
  assert.strictEqual(unlim(50), 0);
  console.log('video slider range mapping passed');
}

// The Handy over Wi-Fi plays each move a lead behind (its connected sensor's
// lead_ms): a script is read that far ahead, so the strokes land on time.
{
  const { ReplayPart } = await import('../src/card/replay.js');
  const actions = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 0 }];
  const card = {
    _simple: false, _strokeKind: true, _lim: (v) => v,
    _outTargetValue: () => 'dev1|l', _outAt: () => ({ m: 'position' }),
    _devices: [{ id: 'dev1', connected: 'binary_sensor.h_connected' }],
    _hass: { states: { 'binary_sensor.h_connected': { state: 'on', attributes: {} } } },
  };
  for (const k of ['_goalFrom', '_goalFromRaw', '_outLead']) card[k] = ReplayPart.prototype[k];
  const bt = card._goalFrom(0, { actions }, 500, 1, {});
  assert.deepStrictEqual([bt.goal, Math.round(bt.dur)], [100, 500], 'Bluetooth: the next point as it is');
  card._hass.states['binary_sensor.h_connected'].attributes = { transport: 'wifi', lead_ms: 800 };
  const wifi = card._goalFrom(0, { actions }, 500, 1, {});
  assert.deepStrictEqual([wifi.goal, Math.round(wifi.dur)], [0, 700], 'Wi-Fi: read 0.8 s ahead');
  console.log('Wi-Fi lead passed');
}

// A saved script named like a video goes with it: exactly, or a recording
// saved as "<video> · 5:24 · <date>"; of several, the newest.
{
  const { matchVideoScript } = await import('../src/lib/outputs.js');
  const names = ['1000001279 · 0:33 · Sat 21 Nov', '1000001279 · 5:24 · Sun 22 Nov 09:01', 'Quickie (5 min)', 'Beach Day'];
  const saved = { '1000001279 · 0:33 · Sat 21 Nov': '2026-11-21T10:51:02', '1000001279 · 5:24 · Sun 22 Nov 09:01': '2026-11-21T20:01:12' };
  assert.strictEqual(matchVideoScript('1000001279', names, saved), '1000001279 · 5:24 · Sun 22 Nov 09:01');
  assert.strictEqual(matchVideoScript('beach_day', names, saved), 'Beach Day');
  assert.strictEqual(matchVideoScript('Beach Day.funscript', names, saved), 'Beach Day');
  assert.strictEqual(matchVideoScript('holiday', names, saved), null);
  assert.strictEqual(matchVideoScript('', names, saved), null);
  console.log('video script matching passed');
}

// Android's photo picker names a video only by a number: the script recorded
// with that very file (its size) still goes with it, whatever its name.
{
  const { matchVideoScript, videoKey } = await import('../src/lib/outputs.js');
  const names = ['Beach Day', 'Sunset ride', '1000001279 · 5:24 · Sun 22 Nov 09:01'];
  const saved = { 'Beach Day': '2026-11-20', 'Sunset ride': '2026-11-22' };
  const keys = { 'Sunset ride': 'size:52428801' };
  assert.strictEqual(videoKey({ size: 52428801 }), 'size:52428801');
  assert.strictEqual(videoKey(null), '');
  assert.strictEqual(matchVideoScript('1000002222', names, saved, keys, 'size:52428801'), 'Sunset ride');
  assert.strictEqual(matchVideoScript('Beach Day', names, saved, keys, 'size:1'), 'Beach Day');   // a different file: by name
  console.log('video script by file passed');
}

// Make a script: relax / tease / edge. Intensity 6 is the original
// generator exactly; every intensity ends at 60:00 with clean points.
{
  const { generateRelaxTeaseEdge, checkScript, peakSpeed, relaxTeaseEdgeFile, mulberry32 } = await import('../src/lib/generate.js');
  function original(seed = 7, peakBpm = 120) {
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s;
      x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61);
      return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    const U = (a, b) => a + (b - a) * rnd();
    const RI = (a, b) => Math.floor(U(a, b + 1));
    const A = []; let t = 0;
    const add = (p) => A.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(p))) });
    const scale = (b) => b * peakBpm / 120;
    function strokes(dur, b0, b1, lo, hi, j = 4) { const st = t, e = t + dur * 1000;
      while (t < e) { const f = (t - st) / (e - st), h = 60000 / (b0 + (b1 - b0) * f) / 2; add(hi - U(0, j)); t += h; add(lo + U(0, j)); t += h; } }
    function waves(dur, b, w = 40) { const st = t, e = t + dur * 1000, h = 60000 / b / 2;
      while (t < e) { const d = 55 + 40 * Math.sin(2 * Math.PI * (t - st) / (w * 1000)); add(95); t += h; add(95 - d); t += h; } }
    function tease(dur, b = 80, de = [6, 10]) { const e = t + dur * 1000, h = 60000 / b / 2; let n = 0, nd = RI(...de);
      while (t < e) { n++; if (n >= nd) { add(100); t += 1200; add(5); t += 1500; n = 0; nd = RI(...de); } else { add(U(90, 100)); t += h; add(U(65, 78)); t += h; } } }
    function hold(dur, p) { add(p); t += dur * 1000; add(p); t += 500; }
    function edge(buildS, pb, peakS, holdS) { pb = scale(pb); strokes(buildS, 45, pb, 0, 100); strokes(peakS, pb, pb, 0, 100); hold(holdS, 100); }
    strokes(300, 18, 32, 35, 75); waves(420, 40); tease(360, 75); edge(150, 100, 20, 30); strokes(120, 22, 28, 30, 80);
    tease(300, 85); waves(240, 50); edge(180, 110, 30, 40); strokes(150, 20, 30, 40, 85); tease(300, 90, [4, 7]);
    edge(150, 115, 20, 30); strokes(90, 25, 30, 30, 80); tease(180, 95); edge(200, 120, 40, 45);
    strokes(Math.max(0, (3600000 - t) / 1000), 30, 12, 40, 70); add(50);
    return { version: '1.0', inverted: false, range: 100, actions: A };
  }
  assert.deepStrictEqual(generateRelaxTeaseEdge(7, 6, 130), original(7, 120));
  assert.deepStrictEqual(generateRelaxTeaseEdge(42, 6, 130), original(42, 120));
  assert.deepStrictEqual(generateRelaxTeaseEdge(7, 8), generateRelaxTeaseEdge(7, 8));      // same seed, same script
  assert.notDeepStrictEqual(generateRelaxTeaseEdge(8, 8), generateRelaxTeaseEdge(7, 8));
  const r = mulberry32(7); assert.strictEqual(r(), mulberry32(7)());
  for (const i of [1, 6, 10]) {
    for (const max of [80, 130, 150]) {
      const g = generateRelaxTeaseEdge(7, i, max);
      assert.deepStrictEqual(Object.keys(g), ['version', 'inverted', 'range', 'actions']);
      assert.strictEqual(checkScript(g), '', `intensity ${i} max ${max}`);
      const end = g.actions[g.actions.length - 1].at;
      assert.ok(end >= 3600000 && end - 3600000 < 6000, `intensity ${i} max ${max} ends at ${end}`);
    }
  }
  const p6 = peakSpeed(generateRelaxTeaseEdge(7, 6, 130).actions), p10 = peakSpeed(generateRelaxTeaseEdge(7, 10, 130).actions), p1 = peakSpeed(generateRelaxTeaseEdge(7, 1, 130).actions);
  assert.ok(p6 > 370 && p6 < 430, `peak at 6: ${p6}`);
  assert.ok(p10 > 400 && p10 < 470, `peak at 10: ${p10}`);
  assert.ok(p1 < p6 / 2, `gentle at 1: ${p1}`);
  assert.strictEqual(relaxTeaseEdgeFile(8), 'relax_tease_edge_60min_i8.funscript');
  assert.strictEqual(relaxTeaseEdgeFile(8, 25), 'relax_tease_edge_25min_i8.funscript');
  assert.deepStrictEqual(generateRelaxTeaseEdge(7, 6, 130, 60), original(7, 120));         // 60 min: the original
  for (const min of [1, 2, 5, 15, 30, 45, 61, 75, 90]) {
    for (const i of [1, 6, 10]) {
      const g = generateRelaxTeaseEdge(7, i, 130, min);
      assert.strictEqual(checkScript(g), '', `${min} min intensity ${i}`);
      const end = g.actions[g.actions.length - 1].at;
      assert.ok(end >= min * 60000 && end - min * 60000 < 6000, `${min} min intensity ${i} ends at ${end}`);
    }
  }
  assert.ok(peakSpeed(generateRelaxTeaseEdge(7, 6, 130, 20).actions) > 370, 'a short one still reaches its edges');
  console.log(`make a script passed (peaks: i1 ${Math.round(p1)}, i6 ${Math.round(p6)}, i10 ${Math.round(p10)} units/s)`);
}

// A pasted code or funscript loads as a script with a name, and stays loaded.
{
  globalThis.localStorage = globalThis.localStorage || (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
  const { readScript, setLoadedScript, loadedScript, onLoadedScript, LOADED_SRC } = await import('../src/lib/loaded.js');
  const { encodeCode } = await import('../src/lib/core.js');
  const fun = await readScript('{"actions":[{"at":0,"pos":10},{"at":500,"pos":90}]}', 'Night drive.funscript');
  assert.strictEqual(fun.name, 'Night drive');
  assert.strictEqual(fun.script.metadata.type, 'stroke');
  const vib = await readScript('{"actions":[{"at":0,"pos":10},{"at":500,"pos":90}]}', 'Buzz.vib.funscript');
  assert.strictEqual(vib.script.metadata.type, 'vibration');
  const code = await encodeCode({ actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 60 }], metadata: { type: 'vibration', title: 'Shared one' } });
  const fromCode = await readScript(code);
  assert.strictEqual(fromCode.name, 'Shared one');
  assert.strictEqual(fromCode.script.metadata.type, 'vibration');
  await assert.rejects(readScript('hello'));
  await assert.rejects(readScript('{"foo":1}'));
  let seen = 0; const off = onLoadedScript(() => { seen++; });
  setLoadedScript(fromCode);
  assert.strictEqual(loadedScript().name, 'Shared one');
  assert.ok(JSON.parse(localStorage.getItem('ogg_loaded_script')).script.actions.length === 2);
  setLoadedScript(null); off(); setLoadedScript(null);
  assert.strictEqual(loadedScript(), null);
  assert.strictEqual(seen, 2);
  assert.ok(LOADED_SRC.startsWith('\u0001'));
  console.log('load a code passed');
}
