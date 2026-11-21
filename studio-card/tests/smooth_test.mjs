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
