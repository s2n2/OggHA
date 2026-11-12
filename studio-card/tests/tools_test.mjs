// Checks limits, script tools and audio feel without a browser.
import assert from 'assert';
import * as lib from '../src/lib/index.js';

const { limitsFor, isLimited, limitLevels, limitMove, limitsText, heatmap, heatColor, trimScript, loopScript, stitchScripts, duration, AudioFeel } = lib;

// ---- limits
const none = limitsFor({}, 'button.a_stop');
assert.deepStrictEqual(none, { max: 100, lo: 0, hi: 100, speed: 100 });
assert.strictEqual(isLimited(none), false);
assert.strictEqual(limitsText(none), '');
const lim = limitsFor({ 'button.a_stop': { max: 60, lo: 20, hi: 80, speed: 50 } }, 'button.a_stop');
assert.strictEqual(isLimited(lim), true);
assert.deepStrictEqual(limitLevels(lim, [100, 50, 150, -5]), [60, 30, 60, 0]);
assert.deepStrictEqual(limitLevels(none, [100, 37]), [100, 37]);
// A move stays inside the range, however far it asks to go.
for (const goal of [0, 25, 100, 300, -40]) {
  const m = limitMove(lim, { goal, dur: 10 }, 50);
  assert.ok(m.goal >= 20 && m.goal <= 80, `goal ${goal} -> ${m.goal}`);
  // ...and never faster than the top speed (200 units/s at 50%).
  assert.ok(Math.abs(m.goal - 50) / m.dur * 1000 <= 200.001 || m.goal === 50, `speed for ${goal}`);
}
assert.deepStrictEqual(limitMove(none, { goal: 70, dur: 120 }, 10), { goal: 70, dur: 120 });
// Unknown start: assume the far end, so the first move is not a lunge.
assert.strictEqual(limitMove(lim, { goal: 100, dur: 1 }, null).dur, 300);
assert.strictEqual(limitsText(lim), 'top 60% · range 20-80% · speed 50%');

// ---- script tools
const vib = { actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 0 }] };
const heat = heatmap(vib, 4);
assert.strictEqual(heat.length, 4);
assert.ok(heat[1] > heat[0] && heat[2] > heat[3]);
assert.ok(heat.every((v) => v >= 0 && v <= 1));
assert.deepStrictEqual(heatmap({ actions: [] }, 8), new Array(8).fill(0));
assert.ok(/^hsl\(\d+,\d+%,\d+%\)$/.test(heatColor(0.5)));
assert.notStrictEqual(heatColor(0), heatColor(1));

const cut = trimScript(vib, 500, 1500);
assert.strictEqual(duration(cut), 1000);
assert.strictEqual(cut.actions[0].at, 0);
assert.strictEqual(cut.actions[0].pos, 50);
assert.strictEqual(cut.actions[cut.actions.length - 1].pos, 50);
assert.ok(cut.actions.some((a) => a.at === 500 && a.pos === 100));
assert.throws(() => trimScript(vib, 500, 550));
assert.strictEqual(vib.actions.length, 3);            // the original is kept

const twice = loopScript(vib, 2);
assert.strictEqual(duration(twice), 4000);
assert.ok(twice.actions.some((a) => a.at === 3000 && a.pos === 100));
for (let i = 1; i < twice.actions.length; i++) assert.ok(twice.actions[i].at > twice.actions[i - 1].at);
assert.throws(() => loopScript({ actions: [] }, 2));

const b = { actions: [{ at: 0, pos: 40 }, { at: 500, pos: 40 }] };
const both = stitchScripts(vib, b, 250);
assert.strictEqual(duration(both), 2000 + 250 + 500);
assert.ok(both.actions.some((a) => a.at === 2250 && a.pos === 40));
// Two-track scripts keep both tracks through every tool.
const two = { actions: vib.actions, channels: { V1: { actions: [{ at: 0, pos: 10 }, { at: 2000, pos: 90 }] } } };
assert.strictEqual(trimScript(two, 0, 1000).channels.V1.actions.pop().pos, 50);
assert.strictEqual(duration({ actions: loopScript(two, 3).channels.V1.actions }), 6000);
assert.ok(stitchScripts(two, b).channels.V1.actions.length >= 4);
// A mood tag does not survive an edit: the result is a plain script.
assert.strictEqual('mood' in trimScript({ ...vib, mood: { x: 1 } }, 0, 1000), false);

// ---- audio feel
const { audioGamma, audioGate } = lib;
const rate = 48000, fft = 2048;
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// A frame: bass and mid levels (analyser bytes) with a little jitter, as real sound has.
const frame = (bass, mid, jitter = 0) => {
  const bins = new Uint8Array(fft / 2);
  const hz = rate / fft;
  for (let i = 1; i < bins.length; i++) {
    const f = i * hz;
    const v = f < 200 ? bass : f < 8000 ? mid : 0;
    bins[i] = v ? Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * jitter))) : 0;
  }
  return bins;
};
const run = (feel, frames, make, mode, sens, t0 = 0) => {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(feel.step(make(i), t0 + i * 50, mode, sens));
  return out;
};
const avg = (rs, k = 0) => rs.reduce((a, r) => a + r.levels[k], 0) / rs.length;

// The sensitivity scales are exponential and run the right way.
assert.ok(Math.abs(audioGamma(0.5) - 1) < 1e-9 && audioGamma(0) > 2.9 && audioGamma(1) < 0.34);
assert.ok(audioGate(0) > audioGate(0.5) && audioGate(0.5) > audioGate(1));

// Silence gives nothing.
let feel = new AudioFeel(rate, fft);
for (const r of run(feel, 20, () => frame(0, 0), 'beat', 0.5)) { assert.deepStrictEqual(r.levels, [0, 0]); assert.strictEqual(r.beat, false); }

// A kick every 500 ms over steady, loud mids: about two beats a second,
// a strong pulse on each and nothing in between.
feel = new AudioFeel(rate, fft);
let rs = run(feel, 200, (i) => frame(i % 10 === 0 ? 235 : 150, 170, 6), 'beat', 0.5);
assert.ok(feel.beats >= 17 && feel.beats <= 22, `beats ${feel.beats}`);
assert.ok(Math.max(...rs.map((r) => r.levels[0])) >= 80);
assert.ok(rs.every((r) => r.levels.every((v) => v >= 0 && v <= 100)));
const between = rs.filter((r, i) => i > 20 && i % 10 >= 6);
assert.ok(avg(between) < 15, `between beats ${avg(between)}`);
assert.ok(avg(rs.slice(20)) < 45, `beat mode is not stuck on full: ${avg(rs.slice(20))}`);

// Up and down: each beat goes to the other end.
feel = new AudioFeel(rate, fft);
rs = run(feel, 200, (i) => frame(i % 10 === 0 ? 235 : 150, 170, 6), 'updown', 0.5);
{
  let flips = 0;
  for (let i = 1; i < rs.length; i++) if (rs[i].levels[0] !== rs[i - 1].levels[0]) flips += 1;
  assert.ok(rs.every((r) => [0, 100].includes(r.levels[0])), 'only the two ends');
  assert.ok(Math.abs(flips - feel.beats) <= 1, `flips ${flips} beats ${feel.beats}`);
  assert.ok(rs.filter((r) => r.beat).every((r) => r.levels[0] + r.levels[1] === 100));
  // The tempo: a kick every 500 ms.
  assert.ok(Math.abs(rs[rs.length - 1].gap - 500) <= 50, `gap ${rs[rs.length - 1].gap}`);
}

// Loud sound with no beat (a held chord, a fan, hiss): no stream of pulses,
// and no mode sits at full.
for (const mode of ['beat', 'bass', 'volume']) {
  feel = new AudioFeel(rate, fft);
  rs = run(feel, 400, () => frame(215, 205, 8), mode, 0.5).slice(200);
  assert.ok(avg(rs) < (mode === 'beat' ? 10 : 80), `${mode} on steady sound: ${avg(rs)}`);
  if (mode === 'beat') assert.ok(feel.beats < 6, `beats in steady sound: ${feel.beats}`);
}

// Volume follows the loudness: up with a loud passage, down with a quiet one.
feel = new AudioFeel(rate, fft);
rs = run(feel, 240, (i) => (Math.floor(i / 40) % 2 ? frame(120, 120, 6) : frame(215, 215, 6)), 'volume', 0.5);
const loud = rs.filter((r, i) => i >= 80 && Math.floor(i / 40) % 2 === 0 && i % 40 > 3 && i % 40 < 30);
const soft = rs.filter((r, i) => i >= 80 && Math.floor(i / 40) % 2 === 1 && i % 40 > 8);
assert.ok(avg(loud) > 55 && avg(loud, 1) > 55, `loud ${avg(loud)}`);
assert.ok(avg(soft) < 15, `soft ${avg(soft)}`);
// ...and it ends with the sound.
const after = run(feel, 30, () => frame(0, 0), 'bass', 0.5, 240 * 50);
assert.deepStrictEqual(after[after.length - 1].levels, [0, 0]);

// More sensitivity: more comes through, at every step of the slider.
const music = (i) => frame(i % 10 === 0 ? 225 : i % 10 === 5 ? 195 : 150, 140 + 40 * Math.sin(i / 7), 6);
for (const mode of ['beat', 'bass', 'volume']) {
  let prev = -1, first = null;
  for (const sens of [0, 0.25, 0.5, 0.75, 1]) {
    seed = 7;
    feel = new AudioFeel(rate, fft);
    const level = avg(run(feel, 300, music, mode, sens).slice(60));
    if (process.env.SHOW) console.log(mode, sens, level.toFixed(1));
    assert.ok(level >= prev && (sens < 1 || level > first), `${mode} at ${sens}: ${level} after ${prev}`);
    assert.ok(level < 90, `${mode} at ${sens} is not stuck on full: ${level}`);
    prev = level;
    if (first === null) first = level;
  }
}
// Quiet sound is silence at low sensitivity and heard at high.
feel = new AudioFeel(rate, fft);
assert.strictEqual(avg(run(feel, 100, (i) => frame(i % 10 === 0 ? 150 : 90, 95, 6), 'beat', 0.1)), 0);
feel = new AudioFeel(rate, fft);
run(feel, 100, (i) => frame(i % 10 === 0 ? 150 : 90, 95, 6), 'beat', 0.9);
assert.ok(feel.beats >= 7, `quiet beats ${feel.beats}`);

console.log('limits, script tools and audio feel passed');
