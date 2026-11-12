// Checks the patterns ported from Ogg without a browser.
import assert from 'assert';
import * as lib from '../src/lib/index.js';

const { PATTERNS, PATTERNS_DUAL, patternLevel, patternDual, patternPeriod, RandomProgram } = lib;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

// Every pattern stays within 0-1 over a whole cycle, and repeats.
for (const key of Object.keys(PATTERNS)) {
  let top = 0;
  for (let i = 0; i < 200; i++) {
    const p = (i + 0.5) / 200;      // clear of the edges, where rounding decides
    const v = patternLevel(key, p);
    assert.ok(v >= 0 && v <= 1, `${key} at ${i / 200}: ${v}`);
    near(patternLevel(key, p + 3), v, `${key} repeats`);
    top = Math.max(top, v);
  }
  assert.ok(top > 0.6, `${key} reaches ${top}`);
}
for (const key of Object.keys(PATTERNS_DUAL)) {
  const tops = [0, 0];
  for (let i = 0; i < 200; i++) for (const m of [0, 1]) {
    const v = patternDual(key, i / 200, m);
    assert.ok(v >= 0 && v <= 1.0001, `${key} motor ${m} at ${i / 200}: ${v}`);
    tops[m] = Math.max(tops[m], v);
  }
  assert.ok(tops[0] > 0.3 && tops[1] > 0.3, `${key} uses both motors: ${tops}`);
}

// The shapes match Ogg's.
near(patternLevel('wave', 0), 0, 'wave start');
near(patternLevel('wave', 0.5), 1, 'wave top');
near(patternLevel('breath', 0.25), Math.pow(0.5, 1.5), 'breath');
assert.strictEqual(patternLevel('pulse', 0.49), 1);
assert.strictEqual(patternLevel('pulse', 0.5), 0);
near(patternLevel('peak', 0.25), 0.5, 'peak');
assert.deepStrictEqual([0.05, 0.2, 0.3, 0.5].map((p) => patternLevel('heartbeat', p)), [1, 0, 0.7, 0]);
assert.deepStrictEqual([0.1, 0.3, 0.6, 0.9].map((p) => patternLevel('steps', p)), [0.25, 0.5, 0.75, 1]);
assert.deepStrictEqual([0, 0.2, 0.4, 0.6, 0.7, 0.9].map((p) => patternLevel('echo', p)), [1, 0, 0.65, 0, 0.35, 0]);
near(patternLevel('tease', 0.4), 0.5, 'tease');
assert.strictEqual(patternLevel('tease', 0.9), 0);
assert.deepStrictEqual([0.1, 0.2, 0.3, 0.45, 0.55, 0.8].map((p) => patternLevel('chachacha', p)), [1, 0, 1, 0, 1, 0]);
// Two motors: opposite, or one after the other.
near(patternDual('counter_wave', 0.5, 0) + patternDual('counter_wave', 0.5, 1), 1, 'counter wave');
assert.deepStrictEqual([patternDual('ping_pong', 0.2, 0), patternDual('ping_pong', 0.2, 1), patternDual('ping_pong', 0.7, 0), patternDual('ping_pong', 0.7, 1)], [1, 0, 0, 1]);
assert.deepStrictEqual([patternDual('ramp_swap', 0.25, 0), patternDual('ramp_swap', 0.25, 1)], [0.25, 0.75]);
assert.deepStrictEqual([0, 1].map((m) => patternDual('echo_bounce', 0.2, m)), [0, 0.8]);

// Speed: slow is 8 s a cycle, fast half a second, the middle 2 s.
near(patternPeriod(0), 8, 'slow');
near(patternPeriod(100), 0.5, 'fast');
near(patternPeriod(50), 2, 'middle');

// Random: within 0-1, it rests, and a higher intensity is on more of the time.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const onShare = (intensity, motors) => {
  const prog = new RandomProgram(motors, intensity, seeded(7));
  let on = 0, n = 0;
  for (let i = 0; i < 40000; i++) {       // 2000 s in 50 ms steps
    const lv = prog.step(50);
    assert.strictEqual(lv.length, 2);
    for (const v of lv) assert.ok(v >= 0 && v <= 1.0001, `random ${v}`);
    if (prog.seg.rest) assert.deepStrictEqual(lv, [0, 0]); else on += 1;
    n += 1;
  }
  return on / n;
};
const low = onShare(0.4, 1), high = onShare(0.9, 1);
assert.ok(low > 0.03 && low < 0.5, `low ${low}`);
assert.ok(high > 0.6 && high < 0.99, `high ${high}`);
assert.ok(onShare(0.7, 2) > 0.2);

console.log('patterns passed');
