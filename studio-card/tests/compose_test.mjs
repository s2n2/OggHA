// The Queue card's builder: steps made into one script.
import assert from 'assert';
import { clock, composeScript, defaultName, parseTime, renderMood, renderPattern, stepsMs } from '../src/lib/compose.js';
import { duration } from '../src/lib/core.js';

const sorted = (t) => t.every((p, i) => i === 0 || p.at > t[i - 1].at);
const inRange = (t) => t.every((p) => Number.isInteger(p.pos) && p.pos >= 0 && p.pos <= 100);

assert.strictEqual(clock(600000), '10:00');
assert.strictEqual(clock(65000), '1:05');
assert.strictEqual(clock(3723000), '1:02:03');
assert.ok(defaultName(600000, new Date(2026, 10, 15, 14, 32)).startsWith('10:00 · '));

// A pattern: exactly its length, inside its level, far fewer points than samples.
const wave = renderPattern('wave', 60000, { level: 60, speed: 50 });
assert.strictEqual(wave.a[wave.a.length - 1].at, 60000);
assert.ok(sorted(wave.a) && inRange(wave.a));
assert.ok(Math.max(...wave.a.map((p) => p.pos)) <= 60 && Math.max(...wave.a.map((p) => p.pos)) >= 55);
assert.ok(wave.a.length < 1200 / 2, `simplified: ${wave.a.length}`);
assert.strictEqual(wave.b, null);
// Two-motor patterns give a second track; random does too, and the same seed gives the same.
assert.ok(renderPattern('ping_pong', 10000, { level: 80 }).b);
assert.deepStrictEqual(renderPattern('random', 20000, { seed: 3 }), renderPattern('random', 20000, { seed: 3 }));

// A mood: its length, both kinds, and softer is lower.
const m = renderMood('peak', 90000, { seed: 5 });
for (const t of [m.stroke, m.a]) { assert.strictEqual(t[t.length - 1].at, 90000); assert.ok(sorted(t) && inRange(t)); }
const soft = renderMood('peak', 90000, { seed: 5, strength: 40 });
assert.ok(Math.max(...soft.a.map((p) => p.pos)) <= 40);

// Steps one after another: the lengths add up, tracks stay in order.
const steps = [
  { type: 'pattern', key: 'pulse', ms: 30000, level: 50, speed: 40 },
  { type: 'pause', ms: 5000 },
  { type: 'mood', key: 'playful', ms: 60000 },
  { type: 'script', name: 'Mine', ms: 20000 },
];
const mine = { actions: [{ at: 0, pos: 0 }, { at: 3000, pos: 100 }], metadata: { type: 'vibration' } };
const script = composeScript(steps, { title: 'Test' }, new Map([['Mine', mine]]));
assert.strictEqual(stepsMs(steps), 115000);
assert.strictEqual(duration(script), 115000);
assert.ok(sorted(script.actions) && inRange(script.actions));
assert.strictEqual(script.metadata.type, 'vibration');
assert.strictEqual(script.metadata.title, 'Test');
// The pause is silent.
const at = (t, ms) => { let v = 0; for (const p of t) { if (p.at > ms) break; v = p.pos; } return v; };
assert.strictEqual(at(script.actions, 32000), 0);

// For a stroker: a stroke script, one track.
const st = composeScript(steps, { stroke: true }, new Map([['Mine', mine]]));
assert.strictEqual(st.metadata.type, 'stroke');
assert.ok(!st.channels && sorted(st.actions));
assert.strictEqual(duration(st), 115000);

// A missing saved script says so; an empty list says so.
assert.throws(() => composeScript([{ type: 'script', name: 'Gone', ms: 1000 }]), /Gone/);
assert.throws(() => composeScript([]), /step/);

// Typed times.
for (const [text, sec] of [['7', 7], ['45s', 45], ['1:30', 90], ['2m', 120], ['1m30s', 90], ['1.5 min', 90], ['1:02:03', 3723], ['1h', 3600], ['10 sec', 10]]) {
  assert.strictEqual(parseTime(text), sec, text);
}
for (const bad of ['', 'soon', '1:2:3:4', 'm']) assert.strictEqual(parseTime(bad), null, bad);

console.log('compose ok');
