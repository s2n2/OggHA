// Checks OggStudio card logic without a browser. The card's shared logic is
// imported from frontend/src/lib; the built card is read for markup checks.
import fs from 'fs';
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import * as lib from '../src/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
Object.assign(globalThis, lib);       // the tests use the helpers by name
const src = fs.readFileSync(path.join(__dirname, '../../custom_components/ogg/frontend/oggstudio-card.js'), 'utf8');
const { isStroke, STROKE_SPEEDS, STROKE_LIMITS_RESET, parseTarget, MOODS, VIBE_PATTERNS, moodSoften } = lib;

// Card variants: each tag shows a valid subset of the parts, and every part needs a take box to save into.
{
  const { PARTS, VARIANTS } = lib;
  // One card (Play); the retired cards' names open it, hidden from the picker.
  assert.deepStrictEqual(Object.keys(VARIANTS).filter((k) => !VARIANTS[k].hidden), ['oggstudio-play-card']);
  for (const k of ['oggstudio-card', 'oggstudio-recorder-card', 'oggstudio-player-card', 'oggstudio-video-card', 'oggstudio-stroke-card', 'oggstudio-play-stroke-card', 'oggstudio-video-stroke-card', 'oggstudio-together-card']) {
    assert.ok(VARIANTS[k] && VARIANTS[k].simple && VARIANTS[k].hidden, k + ' opens the Play card');
  }
  assert.deepStrictEqual(VARIANTS['oggstudio-stroke-card'].parts, ['stroke', 'video', 'take'], 'the old stroke card opens Play on Stroke');
  for (const v of Object.values(VARIANTS)) {
    assert.ok(v.parts.every((p) => PARTS.includes(p)), v.name);
    assert.ok(v.together || v.parts.includes('take'), v.name + ' can save what it makes');
  }
  for (const p of PARTS) assert.ok(src.includes(`data-part="${p}"`), 'section for ' + p);
}

// Recording against a video: a later pass replaces earlier ones inside its span.
{
  const first = [{ at: 0, pos: 10 }, { at: 1000, pos: 20 }, { at: 2000, pos: 30 }, { at: 3000, pos: 40 }, { at: 4000, pos: 0 }];
  const redo = [{ at: 1500, pos: 90 }, { at: 2500, pos: 80 }];
  assert.deepStrictEqual(mergePasses([first, redo]).map((a) => a.at + ':' + a.pos),
    ['0:10', '1000:20', '1500:90', '2500:80', '3000:40', '4000:0']);
  // Pass recorded earlier in the video than the first one is just added in order.
  assert.deepStrictEqual(mergePasses([redo, [{ at: 100, pos: 5 }, { at: 200, pos: 6 }]]).map((a) => a.at), [100, 200, 1500, 2500]);
  assert.deepStrictEqual(mergePasses([[], first]).length, 5);
}

// Video sync: level at a video time, linear between actions.
{
  const acts = [{ at: 1000, pos: 0 }, { at: 2000, pos: 100 }, { at: 3000, pos: 40 }];
  assert.strictEqual(sampleAt(acts, 0), 0, 'silent before the first action');
  assert.strictEqual(sampleAt(acts, 1500), 50);
  assert.strictEqual(sampleAt(acts, 2000), 100);
  assert.strictEqual(sampleAt(acts, 2500), 70);
  assert.strictEqual(sampleAt(acts, 9000), 40, 'holds the last value');
  assert.strictEqual(sampleAt([], 100), 0);
  // Replay: a stroker heads for the next action.
  assert.deepStrictEqual(nextAction(acts, 0), { at: 1000, pos: 0 });
  assert.deepStrictEqual(nextAction(acts, 1500), { at: 2000, pos: 100 });
  assert.deepStrictEqual(nextAction(acts, 2000), { at: 3000, pos: 40 });
  assert.strictEqual(nextAction(acts, 3000), null, 'at the end: nothing next');
  assert.strictEqual(nextAction([], 10), null);
  const many = Array.from({ length: 10000 }, (_, i) => ({ at: i * 10, pos: i % 101 }));
  assert.strictEqual(sampleAt(many, 55555), 0.5, 'binary search finds the right pair in long scripts');
}

// Game controller: bindings, held movement at a speed, learning and targets.
{
  const btn = (pressed) => ({ pressed, value: pressed ? 1 : 0 });
  const pad = (pressed = [], axes = [0, 0, 0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => btn(pressed.includes(i))), axes });
  const keys = new Set();
  const { GP_DEFAULT_MAP, GP_SPEEDS, GP_ACTIONS, gpDescribe, gpPressed, gpRaw, ST_ACTIONS, ST_DEFAULT_MAP, GP_PROFILES } = lib;
  // Standard D-pad buttons, an analog stick (proportional, with dead zone) and keyboard mode.
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([12]), keys).up, 1);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([0]), keys).rec, 1);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([], [0, -1]), keys).up, 1);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([], [0, 1]), keys).up, 0);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([], [0, -0.2]), keys).up, 0, 'stick drift is ignored');
  assert.ok(Math.abs(gpRead(GP_DEFAULT_MAP, pad([], [0, -0.625]), keys).up - 0.5) < 1e-9, 'half-way push = half speed');
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, null, new Set(['ArrowLeft'])).left, 1, 'keyboard-mode controllers work with no gamepad');
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, null, keys).up, 0);
  // Held up at 100 %/s for 100 ms = +10; never past 0..100; a stall frame is capped.
  assert.strictEqual(gpStep(50, 1, 0, 100, 100), 60);
  assert.strictEqual(gpStep(50, 0, 1, 100, 100), 40);
  assert.strictEqual(gpStep(95, 1, 0, 300, 100), 100);
  assert.strictEqual(gpStep(3, 0, 1, 300, 100), 0);
  assert.strictEqual(gpStep(50, 1, 0, 100, 5000), 60, 'a long frame gap moves at most 100 ms worth');
  let level = 0;
  for (let i = 0; i < 60; i++) level = gpStep(level, 1, 0, 60, 1000 / 60);
  assert.ok(Math.abs(level - 60) < 1e-6, 'small per-frame steps add up (no rounding loss)');
  assert.ok(GP_SPEEDS.every((s, i) => i === 0 || s > GP_SPEEDS[i - 1]), 'speeds go up');
  // Learning: hands-off calibration measures rest and jitter per axis.
  const noisy = Array.from({ length: 40 }, (_, i) => [0.01 * (i % 3), -1, 0.5 + (i % 2 ? 0.2 : -0.2), 3.29]);
  const cal = gpCalibrate(noisy);
  assert.ok(Math.abs(cal.rest[2] - 0.5) < 1e-9 && Math.abs(cal.noise[2] - 0.2) < 1e-9, 'jittery axis: rest 0.5, jitter 0.2');
  assert.strictEqual(cal.rest[1], -1);
  // Holding nothing: jitter, a trigger at rest and an idle hat are not inputs.
  assert.strictEqual(gpPickInput(pad([], [0.02, -1, 0.68, 3.29]), cal, 0), null, 'jitter inside its band is ignored');
  // The confirm (Record) button itself is never the answer; another button is.
  assert.strictEqual(gpPickInput(pad([0], [0, -1, 0.5, 3.29]), cal, 0), null);
  assert.deepStrictEqual(gpPickInput(pad([0, 5], [0, -1, 0.5, 3.29]), cal, 0), { b: 5 });
  // A stick pushed: direction from its rest point.
  assert.deepStrictEqual(gpPickInput(pad([0], [-0.9, -1, 0.5, 3.29]), cal, 0), { a: 0, d: -1 });
  // A jittery axis needs a big move, and keeps its rest point and a wider dead zone.
  assert.strictEqual(gpPickInput(pad([0], [0, -1, 0.95, 3.29]), cal, 0), null, 'move smaller than 2x jitter + 0.2');
  assert.deepStrictEqual(gpPickInput(pad([0], [0, -1, -0.6, 3.29]), cal, 0), { a: 2, d: -1, r: 0.5, z: 0.3 });
  // Hat switch (rests at 3.29, one value per direction): binds to the value.
  assert.deepStrictEqual(gpPickInput(pad([0], [0, -1, 0.5, -1]), cal, 0), { a: 3, v: -1 });
  assert.deepStrictEqual(gpPickInput(pad([0], [0, 0.95, 0.5, 0.14]), cal, 0), { a: 3, v: 0.14 }, 'furthest beyond its threshold wins');
  const hatUp = { up: [{ a: 3, v: -1 }], down: [{ a: 3, v: 0.14 }] };
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, -1]), keys).up, 1);
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, -1]), keys).down, 0);
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, 3.29]), keys).up, 0, 'idle hat is nothing');
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, 0.14]), keys).down, 1);
  // Off-centre axis with its rest point: still at rest = 0, pushed = pressed.
  const off = { down: [{ a: 2, d: -1, r: 0.5, z: 0.3 }] };
  assert.strictEqual(gpRead(off, pad([], [0, 0, 0.6]), keys).down, 0);
  assert.strictEqual(gpRead(off, pad([], [0, 0, -0.5]), keys).down, 1);
  assert.strictEqual(gpFirstButton(pad([4, 9]), 4), 9);
  assert.strictEqual(gpFirstButton(pad()), -1);
  // A button that reads as pressed all the time is ignored, for picking and for Record.
  assert.strictEqual(gpFirstButton(pad([2, 7]), -1, [2]), 7);
  assert.strictEqual(gpFirstButton(pad([2]), -1, [2]), -1);
  const stuckCal = { ...cal, stuck: [2] };
  assert.strictEqual(gpPickInput(pad([0, 2], [0, -1, 0.5, 3.29]), stuckCal, 0), null, 'stuck button is not an input');
  assert.deepStrictEqual(gpPickInput(pad([0, 2, 6], [0, -1, 0.5, 3.29]), stuckCal, 0), { b: 6 });
  assert.deepStrictEqual(gpPressed(pad([1, 4])), [1, 4]);
  // Several gamepads (Android lists extra devices): the last one pressed wins,
  // else a standard-mapped one, else the one with the most buttons.
  const phantom = { index: 0, connected: true, mapping: '', id: 'uinput-fpc', buttons: [btn(false)], axes: [] };
  const real = { ...pad(), index: 1, connected: true, mapping: '', id: 'Generic BT' };
  const std = { ...pad(), index: 2, connected: true, mapping: 'standard', id: 'Std' };
  assert.strictEqual(gpChoosePad([phantom, real], undefined).index, 1, 'more buttons beats a phantom device');
  assert.strictEqual(gpChoosePad([phantom, real, std], undefined).index, 2);
  assert.strictEqual(gpChoosePad([phantom, real, std], 1).index, 1, 'last pressed wins');
  assert.strictEqual(gpChoosePad([null, undefined], undefined), null);
  assert.ok(gpRaw({ ...real, buttons: pad([3]).buttons, axes: [0.123, -1] }).includes('pressed [3] · axes 0:0.12 1:-1.00'));
  assert.strictEqual(gpDescribe({ a: 3, v: -1 }), 'hat axis 3 at -1');
  assert.strictEqual(gpDescribe(null), 'default');
  const map = gpBuildMap({ rec: [{ b: 3 }], up: [{ a: 9, d: -1 }] });
  assert.deepStrictEqual(map.rec, [{ b: 3 }, { k: 'Enter' }, { k: 'MediaPlayPause' }]);
  assert.deepStrictEqual(map.up, [{ a: 9, d: -1 }, { k: 'ArrowUp' }], 'learned action: what was learned, plus its keyboard keys');
  assert.deepStrictEqual(map.motor, [], 'a default that clashes with a learned control is dropped');
  assert.deepStrictEqual(map.down, [{ b: 13 }, { k: 'ArrowDown' }], 'skipped action keeps defaults but not stick axes');
  assert.deepStrictEqual(gpBuildMap({}).down, GP_DEFAULT_MAP.down, 'nothing learned = full defaults');
  assert.deepStrictEqual(Object.keys(map), GP_ACTIONS);
  // Target: video recording when this card has a video loaded, else the pads.
  assert.strictEqual(gpTargetFor(['record', 'take', 'library', 'video', 'import'], true), 'video');
  assert.strictEqual(gpTargetFor(['record', 'take', 'library', 'video', 'import'], false), 'record');
  assert.strictEqual(gpTargetFor(['video', 'take'], false), null);
  assert.strictEqual(gpTargetFor(['library', 'take', 'import'], true), null);
  assert.strictEqual(gpTargetFor(['stroke', 'take'], false), 'stroke');
  // Stroke profile: its own actions and defaults, built the same way.
  const smap = gpBuildMap({ rec: [{ b: 5 }], fast: [{ a: 9, v: 0.71 }] }, ST_DEFAULT_MAP);
  assert.deepStrictEqual(Object.keys(smap), ST_ACTIONS);
  assert.deepStrictEqual(smap.fast, [{ a: 9, v: 0.71 }, { k: 'ArrowRight' }]);
  assert.deepStrictEqual(smap.rec, [{ b: 5 }, { k: 'Enter' }, { k: 'MediaPlayPause' }]);
  assert.strictEqual(gpRead(smap, pad([], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.71]), keys).fast, 1);
  assert.strictEqual(gpRead(ST_DEFAULT_MAP, pad([1]), keys).reset, 1);
  assert.deepStrictEqual(Object.keys(gpRead(ST_DEFAULT_MAP, null, keys)), ST_ACTIONS);
  assert.deepStrictEqual(GP_PROFILES.stroke.hold, ST_ACTIONS.filter((a) => a !== 'rec'));
  assert.notStrictEqual(GP_PROFILES.stroke.mapKey, GP_PROFILES.level.mapKey, 'each card type learns its own controls');
  assert.ok(src.includes('id="gpon"') && src.includes('id="gplearnbtn"'), 'controller bar in the card');
}

const stroke = [{ at: 0, pos: 0 }, { at: 250, pos: 100 }, { at: 500, pos: 0 }, { at: 1500, pos: 50 }];
const flat = (acts) => acts.map((a) => `${a.at}:${a.pos}`).join(' ');
assert.deepStrictEqual(toIntensity(stroke, 'position').map((a) => a.pos), [0, 100, 0, 50]);
// Position above 50%: 50 and below = off, 75 = half power, 100 = full.
assert.deepStrictEqual(toIntensity([{ at: 0, pos: 30 }, { at: 1, pos: 50 }, { at: 2, pos: 75 }, { at: 3, pos: 100 }], 'upper').map((a) => a.pos), [0, 0, 50, 100]);
assert.strictEqual(liveIntensity('upper', 75, 0), 50);
// File names: ".vib.funscript" marks a vibration track.
{
  const { fileKind, fileTitle } = lib;
  assert.strictEqual(fileKind('Clip.vib.funscript', 'auto'), 'vibration');
  assert.strictEqual(fileKind('Clip.funscript', 'auto'), 'auto');
  assert.strictEqual(fileKind('Clip.vib.funscript', 'stroke'), 'stroke', 'an explicit choice wins');
  assert.strictEqual(fileTitle('Clip.vib.funscript'), 'Clip');
  assert.strictEqual(fileTitle('Clip.funscript'), 'Clip');
}
// 100 units in 0.25 s = full speed; 50 units in 1 s = 12.5%. Each move holds its level.
assert.strictEqual(flat(toIntensity(stroke, 'speed')), '0:100 249:100 250:100 499:100 500:13 1499:13 1500:0');
// Downstrokes only: the up moves are silent, and the reverse.
assert.strictEqual(flat(toIntensity(stroke, 'down')), '0:0 249:0 250:100 499:100 500:0 1499:0 1500:0');
assert.strictEqual(flat(toIntensity(stroke, 'up')), '0:100 249:100 250:0 499:0 500:13 1499:13 1500:0');
// Combined: speed first, position fills 35% of the headroom; full speed stays 100.
assert.strictEqual(moveIntensity('combo', 0, 100, 250), 100);
assert.strictEqual(moveIntensity('combo', 100, 100, 1000), 35, 'a hold at the top still registers');
assert.strictEqual(moveIntensity('combo', 0, 0, 1000), 0);
assert.strictEqual(Math.round(moveIntensity('combo', 40, 60, 1000)), 22, '5% speed + 35% of 95 headroom at 50');
assert.ok(moveIntensity('combo', 80, 90, 500) > moveIntensity('combo', 10, 20, 500), 'higher = stronger at the same speed');
assert.ok(moveIntensity('combo', 10, 30, 200) > moveIntensity('combo', 10, 30, 800), 'faster = stronger at the same place');
// Live: velocity in %/s; 400 %/s = full.
assert.strictEqual(liveIntensity('speed', 50, -400), 100);
assert.strictEqual(liveIntensity('down', 50, 200), 0);
assert.strictEqual(liveIntensity('down', 50, -200), 50);
assert.strictEqual(liveIntensity('position', 70, 0), 70);

// Import: stroke scripts are kept as positions and marked; vibration as they are.
const two = normalise({ actions: stroke, channels: { V1: { actions: [{ at: 0, pos: 30 }] } } }, 'vibration', false);
assert.deepStrictEqual(two.channels.V1.actions, [{ at: 0, pos: 30 }]);
assert.strictEqual(normalise({ actions: [{ at: 0, pos: 20 }] }, 'vibration', true).actions[0].pos, 80);
assert.throws(() => normalise({ actions: [] }, 'vibration', false));
assert.strictEqual(normalise({ actions: stroke }, 'auto', false).metadata.type, 'stroke', 'unmarked funscripts are stroke scripts');
assert.strictEqual(normalise({ actions: stroke, metadata: { type: 'vibration' } }, 'auto', false).metadata.type, 'vibration');
const raw = normalise({ actions: stroke }, 'stroke', false);
assert.ok(isStroke(raw) && flat(raw.actions) === flat(stroke));
const run = runScript(raw, 'speed');
assert.strictEqual(run.metadata.type, 'vibration');
assert.strictEqual(flat(run.actions), flat(toIntensity(stroke, 'speed')));
assert.strictEqual(runScript(two, 'speed'), two, 'vibration scripts play unchanged');

// Stroke recorder: holding a speed strokes between the limits.
{
  // Speed is device speed: 100% = 400 units/s, whatever the range.
  const V = (pct) => pct / 100 * 400 / 1000;
  let r = strokeStep(20, 1, 20, 80, V(50), 60);
  assert.ok(Math.abs(r.pos - 32) < 1e-9 && r.dir === 1 && !r.turns.length, '50% = 200 units/s = 12 units in 60 ms');
  const short = strokeStep(40, 1, 40, 60, V(100), 20), long = strokeStep(0, 1, 0, 100, V(100), 20);
  assert.strictEqual(short.pos - 40, long.pos - 0, 'same speed on a short range as on the full range');
  r = strokeStep(75, 1, 20, 80, V(100), 25);   // 10 units: 5 up to the limit, 5 back down
  assert.ok(Math.abs(r.pos - 75) < 1e-9 && r.dir === -1);
  assert.strictEqual(r.turns.length, 1);
  assert.strictEqual(r.turns[0].pos, 80);
  assert.ok(Math.abs(r.turns[0].frac - 0.5) < 1e-9, 'turn half way through the tick');
  // A 20-wide range at 100%: up and back (40 units) in 100 ms; the full range takes 500 ms.
  let pos = 40, dir = 1; const turns = [];
  for (let i = 0; i < 5; i++) { r = strokeStep(pos, dir, 40, 60, V(100), 20); pos = r.pos; dir = r.dir; turns.push(...r.turns.map((t) => t.pos)); }
  assert.ok(Math.abs(pos - 40) < 1e-6, 'short range: shorter cycle, not slower movement');
  assert.deepStrictEqual(turns, [60, 40]);
  // Outside the range it heads in and then strokes.
  r = strokeStep(95, 1, 20, 80, V(50), 45);
  assert.ok(r.pos < 95 && r.dir === -1, 'above the range: comes down');
  r = strokeStep(5, -1, 20, 80, V(50), 20);
  assert.ok(r.pos > 5 && r.dir === 1);
  assert.deepStrictEqual(strokeStep(50, 1, 50, 50, V(50), 20), { pos: 50, dir: 1, turns: [] }, 'no range: no movement');
  assert.strictEqual(strokeStep(20, 1, 20, 80, V(30), 5000).pos, strokeStep(20, 1, 20, 80, V(30), 100).pos, 'a long timer gap moves at most 100 ms worth');
  assert.ok(STROKE_SPEEDS.every((x, i) => i === 0 || x.pct > STROKE_SPEEDS[i - 1].pct), 'slow, medium, fast');

  // Set limit pairs with the limit set before it; the first replaces the nearer end.
  let lim = { ...STROKE_LIMITS_RESET };
  lim = strokeSetLimit(lim, 30);
  assert.deepStrictEqual(lim, { lower: 30, upper: 100, last: 'lower' });
  lim = strokeSetLimit(lim, 70.4);
  assert.deepStrictEqual(lim, { lower: 30, upper: 70, last: 'upper' }, 'above the other limit = upper');
  assert.deepStrictEqual(strokeSetLimit(lim, 50), { lower: 50, upper: 70, last: 'lower' }, 'below the last limit = lower');
  assert.deepStrictEqual(strokeSetLimit({ lower: 30, upper: 70, last: 'lower' }, 10), { lower: 10, upper: 30, last: 'lower' });
  assert.deepStrictEqual(strokeSetLimit({ ...STROKE_LIMITS_RESET }, 80), { lower: 0, upper: 80, last: 'upper' });
  assert.strictEqual(strokeSetLimit(lim, 71), null, 'on top of the other limit: refused');

  // Range rail: grab a limit near it, the band in the middle, the nearer limit outside.
  const L = { lower: 30, upper: 70 };
  assert.deepStrictEqual(railGrab(L, 72, 5), { mode: 'upper' });
  assert.deepStrictEqual(railGrab(L, 27, 5), { mode: 'lower' });
  assert.deepStrictEqual(railGrab(L, 50, 5), { mode: 'move', off: 20 });
  assert.deepStrictEqual(railGrab(L, 90, 5), { mode: 'upper' });
  assert.deepStrictEqual(railGrab(L, 5, 5), { mode: 'lower' });
  assert.deepStrictEqual(railGrab({ lower: 48, upper: 52 }, 50.5, 5), { mode: 'upper' }, 'narrow range: the nearer limit');
  assert.deepStrictEqual(railDrag(L, { mode: 'upper' }, 85.4), { lower: 30, upper: 85 });
  assert.deepStrictEqual(railDrag(L, { mode: 'upper' }, 10), { lower: 30, upper: 32 }, 'upper never goes below lower');
  assert.deepStrictEqual(railDrag(L, { mode: 'lower' }, 99), { lower: 68, upper: 70 });
  assert.deepStrictEqual(railDrag(L, { mode: 'move', off: 20 }, 60), { lower: 40, upper: 80 }, 'whole range moves, same width');
  assert.deepStrictEqual(railDrag(L, { mode: 'move', off: 20 }, 99), { lower: 60, upper: 100 }, 'stops at the top');
  assert.deepStrictEqual(railDrag(L, { mode: 'move', off: 20 }, -5), { lower: 0, upper: 40 }, 'stops at the bottom');

  // First touch on the position bar: no faster than the last speed, then it follows the finger.
  let a = approachStep(0, 100, V(30), 20);
  assert.ok(Math.abs(a.pos - 2.4) < 1e-9 && !a.caught, '30%: 2.4 units per 20 ms');
  assert.ok(Math.abs(approachStep(0, 100, V(100), 20).pos - 8) < 1e-9, '100%: 8 units per 20 ms');
  assert.deepStrictEqual(approachStep(49, 50, V(30), 20), { pos: 50, caught: true }, 'close enough: caught');
  let p2 = 0, t = 0, caught = false;
  while (!caught && t < 5000) { const q = approachStep(p2, 100, V(30), 20); p2 = q.pos; caught = q.caught; t += 20; }
  assert.ok(t >= 820 && t <= 860, 'a full-range jump at 30% takes about 0.83 s, not an instant');
}

// AI feel: moods read from the intent of the last few seconds.
{
  // Stroke windows: triangle strokes of a given length and half-stroke time, sampled every 50 ms.
  const strokes = (amp, halfMs, secs = 3, center = 50) => Array.from({ length: secs * 20 + 1 }, (_, k) => {
    const ph = (k * 50 / halfMs) % 2; return center - amp / 2 + amp * (ph < 1 ? ph : 2 - ph);
  });
  const mood = (w, prev) => strokeMood(strokeFeatures(w), prev);
  assert.strictEqual(mood(Array(61).fill(40)), 'rest', 'still');
  assert.strictEqual(mood(Array(61).fill(40), 'intense'), 'edge', 'stopping right after intense');
  assert.strictEqual(mood(strokes(20, 600)), 'tease', 'slow short strokes');
  assert.strictEqual(mood(strokes(80, 1200)), 'glide', 'slow long strokes');
  assert.strictEqual(mood(strokes(60, 400)), 'rhythm', 'steady medium strokes');
  assert.strictEqual(mood(strokes(80, 250)), 'intense', 'fast long strokes');
  assert.strictEqual(mood(strokes(20, 100)), 'frantic', 'very fast short strokes');
  const speeding = [...strokes(30, 800, 1.5), ...strokes(70, 250, 1.5).map((x) => x)];
  assert.strictEqual(mood(speeding), 'build', 'speeding up');

  // A script that teases, settles into rhythm, goes intense, then stops.
  const seg = (amp, halfMs, ms, t0) => { const out = []; for (let t = 0; t < ms; t += halfMs) out.push({ at: t0 + t, pos: (out.length % 2 ? 50 + amp / 2 : 50 - amp / 2) }); return out; };
  const script = [...seg(20, 600, 8000, 0), ...seg(60, 400, 8000, 8000), ...seg(85, 250, 8000, 16000), { at: 24000, pos: 50 }, { at: 30000, pos: 50 }];
  const v1 = aiStrokeToVibe(script), v2 = aiStrokeToVibe(script);
  assert.deepStrictEqual(v1, v2, 'a script always maps the same way (seeded)');
  assert.ok(v1.actions.every((x) => x.pos >= 0 && x.pos <= 100), 'levels within 0-100');
  const order = [...new Set(v1.moods.map((m) => m.label.split(' · ')[0]))];
  for (const [a, b] of [['tease', 'rhythm'], ['rhythm', 'intense']]) assert.ok(order.indexOf(a) >= 0 && order.indexOf(a) < order.indexOf(b), `${a} before ${b}: ${order}`);
  assert.ok(['edge', 'rest'].includes(order[order.length - 1]), 'ends calm: ' + order);
  const avg = (from, to) => { const xs = []; for (let t = from; t < to; t += 50) xs.push(sampleAt(v1.actions, t)); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(avg(17000, 23500) > avg(1500, 7500) + 25, 'intense feels much stronger than tease');
  // Moods hold for a moment and patterns do not flicker.
  for (let i = 1; i < v1.moods.length; i++) assert.ok(v1.moods[i].at - v1.moods[i - 1].at >= 500, 'no mood flicker');

  // AI feel patterns: on/off pulses at least ~200 ms at every tempo.
  {
    for (const [name, fn] of Object.entries(VIBE_PATTERNS)) for (const f of [0.5, 1, 2, 4]) {
      const runs = []; let on = fn(0, f, 0.5, { pos: 50, dir: 1, tm: 0 }) > 5, len = 0;
      for (let ms = 0; ms <= 10000; ms += 10) { const now = fn(ms / 1000, f, 0.5, { pos: 50, dir: 1, tm: ms / 1000 }) > 5; if (now === on) len += 10; else { runs.push(len); on = now; len = 10; } }
      const bad = runs.slice(1).filter((x) => x < 190);
      assert.ok(!bad.length, `AI pattern ${name} at ${f} Hz: pulses of ${bad.slice(0, 5).join(',')} ms`);
    }
  }
  // Vibration windows.
  const wave = (fn) => Array.from({ length: 61 }, (_, k) => fn(k * 0.05));
  const vm = (fn) => vibeMood(vibeFeatures(wave(fn)));
  assert.strictEqual(vm(() => 0), 'rest');
  assert.strictEqual(vm(() => 85), 'strong', 'steady high');
  assert.strictEqual(vm(() => 50), 'steady');
  assert.strictEqual(vm((t) => ((t % 1) < 0.12 || ((t % 1) > 0.2 && (t % 1) < 0.3) ? 40 : 0)), 'tease', 'heartbeat');
  assert.strictEqual(vm((t) => 50 + 30 * Math.sin(2 * Math.PI * 0.3 * t)), 'wave', 'smooth swells');
  assert.strictEqual(vm((t) => ((t * 1.5) % 1 < 0.5 ? 80 : 0)), 'pulse', 'on/off pulses');
  assert.strictEqual(vm((t) => 78 + 17 * Math.sign(Math.sin(2 * Math.PI * 8 * t))), 'buzz', 'fast high buzz');
  assert.strictEqual(vm((t) => 10 + 20 * t), 'build', 'rising');

  // Vibration script -> planned strokes: in range, never faster than the device's top speed.
  const vib = [];
  for (let t = 0; t <= 10000; t += 100) vib.push({ at: t, pos: (t % 1000) < 120 || ((t % 1000) > 200 && (t % 1000) < 300) ? 35 : 0 });   // heartbeat tease
  for (let t = 10100; t <= 20000; t += 100) vib.push({ at: t, pos: 88 });                                                          // strong
  const s1 = aiVibeToStroke(vib), s2 = aiVibeToStroke(vib);
  assert.deepStrictEqual(s1, s2, 'seeded');
  assert.ok(s1.actions.every((x) => x.pos >= 0 && x.pos <= 100));
  for (let i = 1; i < s1.actions.length; i++) {
    const a0 = s1.actions[i - 1], a1 = s1.actions[i];
    assert.ok(Math.abs(a1.pos - a0.pos) / Math.max(1, a1.at - a0.at) <= 0.4 + 0.02, `stroke ${i} within top speed`);
  }
  const stats = (from, to) => {
    const xs = s1.actions.filter((x) => x.at >= from && x.at < to);
    const lens = xs.slice(1).map((x, i) => Math.abs(x.pos - xs[i].pos)).filter((d) => d > 2);
    return { len: lens.reduce((a, b) => a + b, 0) / (lens.length || 1), n: lens.length };
  };
  const tease = stats(2000, 9500), strong = stats(12500, 19500);
  assert.ok(strong.len > tease.len + 20, `strong strokes are longer (${tease.len.toFixed(0)} vs ${strong.len.toFixed(0)})`);
  assert.ok(strong.n > tease.n, 'and more of them');
  const moods = [...new Set(s1.moods.map((m) => m.label.split(' · ')[0]))];
  assert.ok(moods.includes('tease') && moods.includes('strong'), 'moods: ' + moods);
}

// Moods: every mood has three combos; tracks stay in range, aligned, within the stroker's top speed.
{
  const keys = Object.keys(MOODS);
  for (const k of ['rest', 'soft', 'tease', 'wave', 'gasp', 'build', 'buzz', 'edge', 'frantic', 'steady', 'step', 'bold', 'embrace', 'tip', 'long', 'surprise', 'grasp', 'squeeze']) assert.ok(keys.includes(k), 'mood ' + k);
  assert.ok(keys.length >= 24);
  let n = 0;
  for (const [key, mood] of Object.entries(MOODS)) {
    assert.strictEqual(mood.combos.length, 3, key + ' has three combos');
    for (const [name, sections] of mood.combos) {
      for (const seed of [1, 99]) {
        const b = buildMood(sections, aiRandom(seed));
        const end = b.stroke[b.stroke.length - 1].at;
        assert.ok(end >= 20000 && end <= 45000, `${key}/${name}: ${end} ms long`);
        for (const tr of b.vibe) {
          assert.ok(tr.every((x) => x.pos >= 0 && x.pos <= 100), `${key}/${name} vibe in range`);
          assert.ok(Math.abs(tr[tr.length - 1].at - end) <= 300, `${key}/${name} tracks aligned`);
          assert.strictEqual(tr[tr.length - 1].pos, 0, 'ends quiet');
        }
        for (let i = 1; i < b.stroke.length; i++) {
          const a0 = b.stroke[i - 1], a1 = b.stroke[i];
          assert.ok(a1.at >= a0.at && Math.abs(a1.pos - a0.pos) / Math.max(1, a1.at - a0.at) <= 0.4 + 1e-9, `${key}/${name} stroke within top speed`);
        }
        n++;
      }
    }
  }
  assert.strictEqual(n, keys.length * 3 * 2);
  // Strength softens strokers: depth toward the tip, so half strength = half the travel (and speed).
  assert.strictEqual(moodSoften(95, 0.5, 0), 95, 'starts at the tip');
  assert.strictEqual(moodSoften(5, 0.5, 0), 50);
  assert.strictEqual(moodSoften(5, 1, 0), 5, 'full strength: unchanged');
  assert.strictEqual(Math.abs(moodSoften(5, 0.5, 0) - moodSoften(85, 0.5, 0)), 40, '80 units of travel become 40');
  assert.strictEqual(Math.round(moodSoften(5, 0.5, 17500)), 5, 'later, softer strokes sit at the base');
  assert.strictEqual(Math.round(moodSoften(95, 0.5, 17500)), 50);
  // The end switches every 10-16 s and eases across (no jump bigger than a few units per 100 ms).
  let ends = new Set(), last = moodAnchor(0), maxJump = 0;
  for (let ms = 0; ms < 120000; ms += 100) { const a = moodAnchor(ms); maxJump = Math.max(maxJump, Math.abs(a - last)); last = a; if (Math.abs(a - 95) < 0.5) ends.add('tip'); if (Math.abs(a - 5) < 0.5) ends.add('base'); }
  assert.ok(ends.has('tip') && ends.has('base'), 'visits both ends');
  assert.ok(maxJump < 10, 'eases across: ' + maxJump.toFixed(1));
  // Bluetooth: no on or off pulse shorter than 200 ms, in any mood combo.
  const shortRuns = (sample, total, step = 10) => {
    const runs = []; let on = sample(0) > 5, len = 0;
    for (let ms = 0; ms <= total; ms += step) { const now = sample(ms) > 5; if (now === on) len += step; else { runs.push(len); on = now; len = step; } }
    return runs.slice(1).filter((x) => x < 200);   // the first run can be cut short by the start
  };
  for (const [key, mood] of Object.entries(MOODS)) for (const [name, sections] of mood.combos) {
    const b = buildMood(sections, aiRandom(5));
    for (const tr of b.vibe) { const end = tr[tr.length - 1].at - 400; const bad = shortRuns((ms) => sampleAt(tr, ms), end); assert.ok(!bad.length, `${key}/${name}: pulses of ${bad.join(',')} ms`); }
  }
  // Alternating moods give the second device its own track.
  assert.strictEqual(buildMood(MOODS.squeeze.combos[1][1], aiRandom(3)).vibe.length, 2);
  assert.strictEqual(buildMood(MOODS.tease.combos[0][1], aiRandom(3)).vibe.length, 1);
}

// Outputs: two outputs become one command per device.
{
  const devs = [{ id: 'sync', dual: true }, { id: 'bond' }, { id: 'handy', linear: 'number.handy_linear_0' }];
  const short = (r) => r.map((e) => `${e.dev.id}:${e.levels.join('/')}${e.linear !== null ? ' lin=' + JSON.stringify(e.linear) : ''}${e.vibe ? '' : ' novibe'}`);
  assert.deepStrictEqual(parseTarget('sync|1'), { id: 'sync', motor: '1' });
  assert.strictEqual(parseTarget('none'), null);
  assert.deepStrictEqual(short(outLevels(['sync|0', 'sync|1'], [40, 70], devs)), ['sync:40/70'], 'two motors of one device: one command');
  assert.deepStrictEqual(short(outLevels(['sync|b', 'bond|b'], [40, 70], devs)), ['sync:40/40', 'bond:70'], 'two devices');
  assert.deepStrictEqual(short(outLevels(['sync|0', 'off'], [40, 70], devs)), ['sync:40/0'], 'motor 1 only: motor 2 off');
  assert.deepStrictEqual(short(outLevels(['handy|l', 'bond|b'], [{ goal: 80, dur: 200 }, 55], devs)), ['handy:0 lin={"goal":80,"dur":200} novibe', 'bond:55'], 'a stroker and a vibrator');
  assert.deepStrictEqual(short(outLevels(['gone|b', 'none'], [40, 70], devs)), [], 'missing devices and record-only are skipped');
  assert.deepStrictEqual(short(outLevels(['bond|b', 'sync|1'], [30, null], devs)), ['bond:30'], 'no value: not sent');
}

// Device choice: remembered > configured > first connected (never an old, offline device).
{
  const flat = src.replace(/\r\n/g, '\n');
  const body = (name) => { const s = flat.indexOf(`    ${name}(`); assert.ok(s > 0, name); return flat.slice(flat.indexOf('{', s), flat.indexOf('\n    }\n', s) + 6); };
  const card = { _hass: { states: { 'binary_sensor.old': { state: 'off' }, 'binary_sensor.sync': { state: 'on' } } }, _config: {} };
  card._online = new Function('dev', body('_online'));
  global.NO_DEVICE = 'none';
  card._pickDevice = new Function(body('_pickDevice'));
  card._devices = [
    { id: 'a', name: 'Aardvark (old)', connected: 'binary_sensor.old' },
    { id: 's', name: 'Sync 2', connected: 'binary_sensor.sync' },
    { id: 'b', name: 'Bond', connected: 'binary_sensor.old' },
  ];
  assert.strictEqual(card._pickDevice(), 's', 'defaults to a connected device');
  card._remembered = { id: 'b', name: 'Bond' };
  assert.strictEqual(card._pickDevice(), 'b', 'remembered choice wins even while offline');
  card._remembered = { id: 'gone', name: 'Sync 2' };
  assert.strictEqual(card._pickDevice(), 's', 're-paired device found by name');
  card._remembered = null; card._config = { device: 'Bond' };
  assert.strictEqual(card._pickDevice(), 'b', 'configured device used when nothing remembered');
  card._deviceId = 'a';
  assert.strictEqual(card._pickDevice(), 'a', 'current selection kept');
  card._deviceId = 'none';
  assert.strictEqual(card._pickDevice(), 'none', 'No device stays chosen');
  card._deviceId = null; card._remembered = { id: 'none', name: '' };
  assert.strictEqual(card._pickDevice(), 'none', 'No device is remembered');
  card._remembered = null; card._config = {}; card._devices = []; card._deviceId = null;
  assert.strictEqual(card._pickDevice(), undefined, 'device list not loaded yet: wait');
  card._registryDone = true;
  assert.strictEqual(card._pickDevice(), 'none', 'no Ogg devices at all: No device');
}

(async () => {
  const script = { version: '1.0', actions: [{ at: 0, pos: 10 }, { at: 100, pos: 90 }] };
  const code = await encodeCode(script);
  assert.ok(code.startsWith('ogg1:'));
  assert.deepStrictEqual(await decodeText(code), script);
  assert.deepStrictEqual(await decodeText(JSON.stringify(script)), script);
  console.log('OggStudio card logic passed (import conversion, share codes):', code.slice(0, 24) + '...');
})().catch((e) => { console.error(e); process.exit(1); });
