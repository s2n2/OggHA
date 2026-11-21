// Stroker smoothing in the card: cleaned timelines (lib/smooth.js) and live
// following (OutputsPart._outLinear), without a browser.
import assert from 'assert';
import { smoothActions, smoothPoints, smoothedFor, SMOOTH_MIN_SEGMENT_MS } from '../src/lib/smooth.js';
import { NO_LIMITS } from '../src/lib/limits.js';
import { OutputsPart } from '../src/card/outputs.js';

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
  assert.ok(dragged >= 4 && dragged <= 6, `a move every ~140 ms while dragging (${dragged})`);
  assert.ok(calls.slice(0, dragged).every((c, i) => i === 0 || c.at - calls[i - 1].at >= 140), 'paced for Bluetooth');
  if (process.env.SHOW) console.log(calls);
  assert.ok(calls.every((c) => c.duration >= 200), 'each follow move outlasts the gap, so it never stops between moves');
  assert.ok(atRest - dragged <= 2, `a still finger is not chased (${atRest - dragged} moves while held)`);
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
console.log('stroker smoothing passed');
