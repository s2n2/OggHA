// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { clampN, hashUnit } from './ai.js';
import { STROKE_TOP } from './stroke.js';

// ---------------------------------------------------------- moods
// Mood buttons: three hand-made combos per mood. A combo is a list of
// aligned sections, each filling the same time with a stroke pattern (for
// strokers) and one or two vibration patterns (for vibrators; a second
// track goes to the second device, for alternating moods). Small random
// variations each time; when a combo ends, a different one follows.
export function moodTrack(start, stroke) {
  const a = [{ at: 0, pos: start }];
  let t = 0, v = start;
  const b = {
    get t() { return t; },
    get v() { return v; },
    to(p, ms) {
      p = clampN(Math.round(p), 0, 100);
      if (stroke) ms = Math.max(ms, Math.abs(p - v) / (STROKE_TOP / 1000));   // within the device's top speed
      t += Math.max(1, Math.round(ms)); v = p; a.push({ at: t, pos: p });
      return b;
    },
    hold(ms) { t += Math.max(1, Math.round(ms)); a.push({ at: t, pos: v }); return b; },
    jump(p) { return b.to(p, 1); },
    until(end, fn) { let g = 0; while (t < end && g++ < 4000) fn(); return b; },
    done() { return a; },
  };
  return b;
}

export const jit = (r, x, by = 0.1) => x * (1 - by + 2 * by * r());
export const BLE_PULSE = 250;   // shortest on or off pulse (ms) that reliably reaches a Bluetooth toy

// Stroke patterns: (track, section end, random) fill until the end.
export const MS = {
  strokes: (lo, hi, half) => (b, end, r) => b.until(end, () => { const h = jit(r, half); b.to(hi, h).to(lo, h); }),
  breathe: (lo, hi, half) => (b, end, r) => b.until(end, () => { const h = jit(r, half); b.to(hi, h).hold(350).to(lo, h).hold(550); }),
  park: (pos) => (b, end) => { b.to(pos, 700); if (b.t < end) b.hold(end - b.t); },
  ramp: (from, to) => (b, end, r) => {
    const start = b.t;
    b.until(end, () => {
      const k = clampN((b.t - start) / Math.max(1, end - start), 0, 1);
      const L = (i) => from[i] + (to[i] - from[i]) * k;
      b.to(L(1), jit(r, L(2), 0.05)).to(L(0), jit(r, L(2), 0.05));
    });
  },
  stopstart: (lo, hi, half, n, pause) => (b, end, r) => b.until(end, () => { for (let i = 0; i < n; i++) b.to(hi, half).to(lo, half); b.hold(jit(r, pause, 0.3)); }),
  flick: (base, amp, half, n, pause) => (b, end, r) => b.until(end, () => { b.to(base, 300); for (let i = 0; i < n; i++) b.to(base - jit(r, amp, 0.2), half).to(base, half); b.hold(jit(r, pause, 0.3)); }),
  gasp: () => (b, end, r) => b.until(end, () => { b.to(92, 900).hold(jit(r, 1100, 0.3)).to(8, 250).hold(700).to(60, 1500).hold(500); }),
  clutch: (lo, hi) => (b, end, r) => b.until(end, () => { b.to(lo + (hi - lo) * r(), 200).hold(500 + 900 * r()); }),
  reach: (top, bottom, up, down) => (b, end, r) => b.until(end, () => { b.to(top, jit(r, up)).hold(jit(r, 800, 0.3)).to(bottom, jit(r, down)).hold(300); }),
  steps: (ranges, each, half) => (b, end) => b.until(end, () => { for (const [lo, hi] of ranges) { if (b.t >= end) break; const stop = Math.min(end, b.t + each); while (b.t < stop) b.to(hi, half).to(lo, half); } }),
  edge: () => (b, end, r) => b.until(end, () => { for (let i = 0; i < 8; i++) { const h = 450 - i * 25; b.to(95, h).to(15, h); } b.to(90, 300).hold(1500 + 1500 * r()); }),
  mix: () => (b, end, r) => b.until(end, () => { const big = r() < 0.35; const amp = big ? 85 : 25 + 20 * r(); const h = big ? 500 : 180 + 120 * r(); b.to(55 + amp / 2, h).to(55 - amp / 2, h); }),
  surprise: () => (b, end, r) => b.until(end, () => {
    const k = r();
    if (k < 0.25) b.hold(600 + 1200 * r());
    else if (k < 0.5) for (let i = 0; i < 3; i++) b.to(70, 150).to(45, 150);
    else if (k < 0.75) b.to(98, 1200).to(3, 1200);
    else b.to(100 * r(), 200).hold(700);
  }),
};

// Vibration patterns.
export const MV = {
  level: (x) => (b, end) => { b.to(x, 300); if (b.t < end) b.hold(end - b.t); },
  ramp: (lo, hi) => (b, end) => { b.to(lo, 200); b.to(hi, Math.max(200, end - b.t)); },
  wave: (lo, hi, period, phase = 0) => (b, end, r) => {
    if (phase) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase)), 300);
    b.until(end, () => { const p = jit(r, period); for (let k = 1; k <= 8; k++) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (k / 8 + phase))), p / 8); });
  },
  waveUp: (lo, hiFrom, hiTo, period) => (b, end, r) => {
    const start = b.t;
    b.until(end, () => { const p = jit(r, period); const hi = hiFrom + (hiTo - hiFrom) * clampN((b.t - start) / Math.max(1, end - start), 0, 1); for (let k = 1; k <= 8; k++) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / 8)), p / 8); });
  },
  // Pulses stay at least BLE_PULSE long, on and off: updates go out about
  // every 100 ms and Bluetooth adds delay, so shorter taps can be missed.
  pulses: (lvl, on, off, offFirst = false) => (b, end, r) => { on = Math.max(BLE_PULSE, on); off = Math.max(BLE_PULSE, off); if (offFirst) b.jump(0).hold(off); b.until(end, () => { b.jump(lvl).hold(on).jump(0).hold(Math.max(BLE_PULSE, jit(r, off, 0.15))); }); },
  heartbeat: (lvl, bpm, delay = 0) => (b, end) => {
    // Lub-dub when there is time for reliable pulses, else (a racing heart) single beats.
    const per = 60000 / bpm, on1 = Math.max(220, per * 0.24), gap = Math.max(220, per * 0.2), on2 = Math.max(220, per * 0.22);
    const dub = per >= on1 + gap + on2 + BLE_PULSE;
    if (delay) b.jump(0).hold(delay);
    b.until(end, () => {
      b.jump(lvl).hold(on1).jump(0);
      if (dub) b.hold(gap).jump(lvl * 0.7).hold(on2).jump(0).hold(per - on1 - gap - on2);
      else b.hold(Math.max(BLE_PULSE, per - on1));
    });
  },
  buzz: (lvl) => (b, end, r) => b.until(end, () => { b.jump(Math.min(100, lvl + 6 + 4 * r())).hold(170).jump(lvl - 12).hold(170); }),   // a ~3 Hz texture
  flicker: (lvl, base) => (b, end, r) => b.until(end, () => { b.jump(base).hold(300 + 500 * r()); b.jump(lvl * (0.7 + 0.3 * r())).hold(BLE_PULSE + 80 * r()); }),
  steps: (levels, each) => (b, end) => b.until(end, () => { for (const x of levels) { if (b.t >= end) break; b.jump(x).hold(Math.min(each, Math.max(1, end - b.t))); } }),
  bursts: (lvl, burst, gap, base = 0) => (b, end, r) => b.until(end, () => { b.to(lvl, 80).hold(jit(r, burst, 0.2)).to(base, 200).hold(jit(r, gap, 0.3)); }),
  swell: (lo, hi, rise, fall, top) => (b, end) => b.until(end, () => { b.to(hi, rise).hold(top).to(lo, fall).hold(300); }),
  gasp: () => (b, end, r) => b.until(end, () => { b.to(25, 900).hold(jit(r, 1100, 0.3)).jump(95).hold(250).to(10, 700).hold(700).to(40, 1500).hold(500); }),
  clutch: (lo, hi) => (b, end, r) => b.until(end, () => { b.jump(lo + (hi - lo) * r()).hold(500 + 900 * r()); }),
  random: (lo, hi) => (b, end, r) => b.until(end, () => { b.to(lo + (hi - lo) * r(), 150 + 500 * r()).hold(200 + 800 * r()); }),
  edge: () => (b, end, r) => b.until(end, () => { b.to(70 + 20 * r(), 3600).jump(0).hold(1500 + 1500 * r()); }),
  surprise: () => (b, end, r) => b.until(end, () => {
    const k = r();
    if (k < 0.25) b.jump(0).hold(600 + 1200 * r());
    else if (k < 0.5) for (let i = 0; i < 3; i++) b.jump(90).hold(BLE_PULSE).jump(0).hold(BLE_PULSE);
    else if (k < 0.75) b.to(80, 1200).to(10, 1200);
    else b.jump(30 + 70 * r()).hold(700);
  }),
};

// [name, sections]; a section is [ms, stroke, vibe, second vibe?].
export const MOODS = {
  rest: { icon: '🌙', label: 'Rest', combos: [
    ['Still breath', [[30000, MS.park(85), MV.wave(0, 12, 6000)]]],
    ['Slow drift', [[30000, MS.breathe(70, 90, 2500), MV.wave(4, 15, 8000)]]],
    ['Quiet', [[20000, MS.park(90), MV.level(0)], [10000, MS.breathe(75, 90, 3000), MV.heartbeat(10, 50)]]],
  ] },
  soft: { icon: '☁️', label: 'Soft', combos: [
    ['Feather', [[30000, MS.strokes(60, 90, 1300), MV.wave(8, 30, 5000)]]],
    ['Cloud', [[30000, MS.breathe(40, 80, 1800), MV.swell(10, 35, 2500, 2500, 800)]]],
    ['Gentle steps', [[30000, MS.strokes(55, 85, 1000), MV.steps([10, 18, 26, 18], 1500)]]],
  ] },
  tease: { icon: '😏', label: 'Tease', combos: [
    ['Heartbeat tease', [[12000, MS.flick(88, 12, 250, 4, 1500), MV.heartbeat(35, 62)], [6000, MS.strokes(20, 90, 1500), MV.wave(10, 40, 4000)], [12000, MS.flick(85, 15, 220, 3, 2000), MV.heartbeat(40, 70)]]],
    ['Stop-start', [[30000, MS.stopstart(30, 85, 500, 4, 2200), MV.bursts(55, 2000, 2200)]]],
    ['Almost', [[9000, MS.ramp([65, 85, 700], [35, 95, 350]), MV.ramp(10, 70)], [3000, MS.park(90), MV.level(0)], [9000, MS.ramp([60, 85, 700], [30, 95, 320]), MV.ramp(15, 75)], [3000, MS.park(92), MV.level(0)]]],
  ] },
  wave: { icon: '🌊', label: 'Wave', combos: [
    ['Ocean', [[30000, MS.strokes(10, 90, 1500), MV.wave(15, 75, 6000)]]],
    ['Rolling', [[30000, MS.breathe(20, 85, 1100), MV.swell(20, 70, 2200, 2200, 400)]]],
    ['Tide', [[15000, MS.strokes(40, 80, 1200), MV.wave(20, 55, 5000)], [15000, MS.strokes(10, 95, 1400), MV.wave(30, 85, 5000)]]],
  ] },
  gasp: { icon: '😮', label: 'Gasp', combos: [
    ['Catch breath', [[30000, MS.gasp(), MV.gasp()]]],
    ['Sudden', [[8000, MS.strokes(60, 85, 600), MV.level(20)], [1500, MS.strokes(5, 95, 250), MV.level(95)], [4000, MS.park(90), MV.level(5)], [8000, MS.strokes(55, 85, 650), MV.level(25)], [1500, MS.strokes(5, 95, 250), MV.level(100)], [4000, MS.park(90), MV.level(5)]]],
    ['Hold it', [[5000, MS.strokes(70, 95, 300), MV.wave(30, 60, 1500)], [2500, MS.park(95), MV.level(0)], [1200, MS.strokes(5, 95, 280), MV.level(100)], [3000, MS.park(60), MV.level(15)], [5000, MS.strokes(70, 95, 300), MV.wave(30, 60, 1500)], [2500, MS.park(95), MV.level(0)], [1200, MS.strokes(5, 95, 280), MV.level(100)], [3000, MS.park(60), MV.level(15)]]],
  ] },
  build: { icon: '📈', label: 'Build', combos: [
    ['Climb', [[30000, MS.ramp([65, 85, 900], [5, 95, 280]), MV.ramp(10, 95)]]],
    ['Stairs', [[30000, MS.ramp([60, 85, 800], [10, 95, 320]), MV.steps([15, 30, 45, 60, 75, 90], 5000)]]],
    ['Wave up', [[30000, MS.ramp([50, 80, 1200], [5, 95, 350]), MV.waveUp(10, 40, 100, 2500)]]],
  ] },
  buzz: { icon: '🐝', label: 'Buzz', combos: [
    ['Hum', [[30000, MS.strokes(40, 60, 150), MV.buzz(75)]]],
    ['Hive', [[30000, MS.strokes(30, 50, 130), MV.flicker(95, 60)]]],
    ['Static', [[30000, MS.strokes(35, 55, 120), MV.random(55, 95)]]],
  ] },
  edge: { icon: '🎯', label: 'Edge', combos: [
    ['Brink', [[30000, MS.edge(), MV.edge()]]],
    ['Hold back', [[30000, MS.stopstart(10, 95, 280, 6, 3500), MV.bursts(90, 2400, 3500)]]],
    ['Slow burn', [[22000, MS.ramp([50, 85, 900], [10, 95, 300]), MV.ramp(20, 90)], [6000, MS.park(92), MV.heartbeat(15, 50)]]],
  ] },
  frantic: { icon: '⚡', label: 'Frantic', combos: [
    ['Rush', [[30000, MS.strokes(25, 75, 110), MV.buzz(90)]]],
    ['Scramble', [[30000, MS.mix(), MV.random(60, 100)]]],
    ['Flurry', [[30000, MS.stopstart(30, 70, 100, 10, 400), MV.pulses(100, 900, 250)]]],
  ] },
  steady: { icon: '🎵', label: 'Steady', combos: [
    ['Metronome', [[30000, MS.strokes(20, 80, 600), MV.level(55)]]],
    ['Groove', [[30000, MS.strokes(25, 85, 500), MV.pulses(65, 500, 500)]]],
    ['Cruise', [[30000, MS.strokes(15, 85, 700), MV.wave(45, 65, 3000)]]],
  ] },
  step: { icon: '🪜', label: 'Step', combos: [
    ['Staircase', [[30000, MS.steps([[70, 90], [55, 90], [40, 90], [25, 90], [10, 90]], 6000, 600), MV.steps([20, 35, 50, 65, 80], 6000)]]],
    ['Up and down', [[30000, MS.steps([[70, 90], [50, 90], [30, 90], [10, 90], [30, 90], [50, 90]], 2500, 450), MV.steps([20, 40, 60, 80, 60, 40], 2500)]]],
    ['Terraces', [[30000, MS.steps([[60, 90], [60, 90], [30, 90], [30, 90], [5, 95], [5, 95], [80, 92]], 2000, 500), MV.steps([30, 30, 60, 60, 90, 90, 0], 2000)]]],
  ] },
  bold: { icon: '🔥', label: 'Bold', combos: [
    ['Pound', [[30000, MS.strokes(5, 70, 300), MV.bursts(100, 250, 250, 60)]]],
    ['Full force', [[30000, MS.strokes(5, 95, 330), MV.level(95)]]],
    ['Thunder', [[30000, MS.breathe(5, 95, 350), MV.swell(70, 100, 400, 400, 300)]]],
  ] },
  embrace: { icon: '🤗', label: 'Embrace', combos: [
    ['Hug', [[30000, MS.breathe(10, 60, 1600), MV.wave(35, 70, 5000), MV.wave(35, 70, 5000, 0.5)]]],
    ['Hold close', [[30000, MS.breathe(5, 30, 1200), MV.level(60), MV.swell(30, 75, 2000, 2000, 1000)]]],
    ['Wrap', [[30000, MS.strokes(5, 55, 1400), MV.swell(40, 80, 1800, 1800, 1500), MV.wave(40, 80, 5400, 0.5)]]],
  ] },
  tip: { icon: '👆', label: 'Tip', combos: [
    ['Flicks', [[30000, MS.flick(92, 12, 160, 6, 900), MV.flicker(70, 10)]]],
    ['Circling', [[30000, MS.strokes(78, 98, 400), MV.wave(20, 55, 2000)]]],
    ['Taps', [[30000, MS.flick(95, 20, 200, 2, 1100), MV.pulses(60, 200, 1100)]]],
  ] },
  long: { icon: '↕️', label: 'Long', combos: [
    ['Full length', [[30000, MS.strokes(2, 98, 1300), MV.wave(25, 75, 2600)]]],
    ['Slow and deep', [[30000, MS.breathe(2, 98, 1800), MV.swell(20, 80, 1800, 1800, 600)]]],
    ['Long pulls', [[30000, MS.strokes(5, 95, 900), MV.pulses(70, 900, 900)]]],
  ] },
  surprise: { icon: '🎲', label: 'Surprise', combos: [
    ['Wildcard', [[30000, MS.surprise(), MV.surprise()]]],
    ['Jumble', [[8000, MS.mix(), MV.random(30, 100)], [4000, MS.park(90), MV.level(0)], [8000, MS.strokes(5, 95, 300), MV.pulses(100, 300, 200)], [6000, MS.flick(88, 15, 200, 3, 900), MV.heartbeat(40, 70)]]],
    ['Plot twist', [[10000, MS.strokes(60, 90, 1200), MV.wave(10, 30, 4000)], [2500, MS.strokes(5, 95, 250), MV.level(100)], [8000, MS.breathe(40, 80, 1500), MV.heartbeat(30, 60)], [2500, MS.strokes(20, 80, 110), MV.buzz(90)]]],
  ] },
  grasp: { icon: '✊', label: 'Grasp', combos: [
    ['Clutch', [[30000, MS.clutch(10, 90), MV.clutch(30, 95)]]],
    ['Grip and release', [[30000, MS.stopstart(5, 40, 400, 3, 1500), MV.bursts(85, 1500, 1500, 10)]]],
    ['Reach', [[30000, MS.reach(95, 10, 600, 1400), MV.swell(20, 90, 600, 1400, 900)]]],
  ] },
  squeeze: { icon: '🫳', label: 'Squeeze', combos: [
    ['Tight', [[30000, MS.strokes(2, 25, 500), MV.bursts(85, 800, 400, 50)]]],
    ['Pulse squeeze', [[30000, MS.strokes(5, 30, 300), MV.pulses(80, 300, 300), MV.pulses(80, 300, 300, true)]]],
    ['Hold squeeze', [[30000, MS.breathe(2, 30, 700), MV.swell(40, 90, 700, 700, 900)]]],
  ] },
  heartbeat: { icon: '💓', label: 'Heartbeat', combos: [
    ['Calm heart', [[30000, MS.breathe(60, 80, 500), MV.heartbeat(45, 60)]]],
    ['Racing heart', [[30000, MS.strokes(40, 70, 250), MV.heartbeat(70, 110)]]],
    ['Heart to heart', [[30000, MS.strokes(30, 80, 500), MV.heartbeat(55, 75), MV.heartbeat(55, 75, 400)]]],
  ] },
  ripple: { icon: '〰️', label: 'Ripple', combos: [
    ['Ripples', [[30000, MS.strokes(50, 80, 250), MV.wave(30, 60, 800)]]],
    ['Shimmer', [[30000, MS.strokes(40, 70, 180), MV.buzz(50)]]],
    ['Rings', [[30000, MS.breathe(30, 80, 600), MV.swell(10, 60, 300, 900, 200)]]],
  ] },
  deep: { icon: '⬇️', label: 'Deep', combos: [
    ['Depths', [[30000, MS.strokes(2, 45, 900), MV.level(65)]]],
    ['Grind', [[30000, MS.strokes(2, 20, 600), MV.wave(55, 85, 2400)]]],
    ['Plunge', [[30000, MS.reach(80, 2, 900, 400), MV.bursts(90, 800, 900, 30)]]],
  ] },
  peak: { icon: '🌋', label: 'Peak', combos: [
    ['Summit', [[20000, MS.ramp([40, 85, 600], [2, 98, 260]), MV.ramp(40, 100)], [10000, MS.strokes(2, 98, 260), MV.level(100)]]],
    ['Crescendo', [[30000, MS.ramp([30, 80, 500], [2, 98, 250]), MV.steps([50, 60, 70, 80, 90, 100], 5000)]]],
    ['Release', [[18000, MS.strokes(5, 95, 280), MV.bursts(100, 700, 150, 80)], [8000, MS.breathe(50, 90, 1500), MV.wave(10, 40, 4000)], [4000, MS.park(85), MV.heartbeat(20, 55)]]],
  ] },
  afterglow: { icon: '🌅', label: 'Afterglow', combos: [
    ['Glow', [[30000, MS.breathe(60, 90, 2500), MV.wave(5, 25, 7000)]]],
    ['Linger', [[30000, MS.strokes(50, 85, 2000), MV.heartbeat(18, 50)]]],
    ['Warm', [[30000, MS.park(80), MV.swell(5, 20, 3000, 4000, 2000)]]],
  ] },
  playful: { icon: '🎈', label: 'Playful', combos: [
    ['Tickle', [[30000, MS.flick(85, 20, 150, 3, 600), MV.flicker(70, 0)]]],
    ['Bounce', [[30000, MS.mix(), MV.pulses(60, 200, 300)]]],
    ['Peekaboo', [[30000, MS.stopstart(40, 90, 300, 2, 900), MV.bursts(70, 600, 900)]]],
  ] },
};

// Strength for strokers: strokes are scaled toward one end, so a softer
// setting gives shorter strokes at the same timing (which is also slower).
// That end switches between the tip and the base every 10-16 s, easing
// across over 1.5 s, so softer still visits both.
export const MOOD_TIP = 95, MOOD_BASE = 5, MOOD_EASE = 1500;
export function moodAnchor(ms) {
  let start = 0, i = 0, prev = MOOD_TIP;
  for (;;) {
    const len = 10000 + 6000 * hashUnit(i + 7);
    const here = i % 2 ? MOOD_BASE : MOOD_TIP;
    if (ms < start + len) {
      const k = i === 0 ? 1 : Math.min(1, (ms - start) / MOOD_EASE);
      return prev + (here - prev) * (0.5 - 0.5 * Math.cos(Math.PI * k));
    }
    start += len; prev = here; i++;
  }
}
export const moodSoften = (pos, k, ms = 0) => { const a = moodAnchor(ms); return a + (pos - a) * k; };

// Build a combo: a stroke track and one or two vibration tracks, aligned at every section.
export function buildMood(sections, r) {
  const s = moodTrack(85, true), v1 = moodTrack(0, false), v2 = moodTrack(0, false);
  let end = 0, two = false;
  for (const [ms, sf, vf, vf2] of sections) {
    end += Math.round(jit(r, ms));
    sf(s, end, r); vf(v1, end, r);
    if (vf2) { two = true; vf2(v2, end, r); }
    const m = Math.max(s.t, v1.t, v2.t, end);
    for (const b of [s, v1, v2]) if (b.t < m) b.hold(m - b.t);
    end = m;
  }
  v1.to(0, 300); v2.to(0, 300); s.hold(300);
  return { stroke: s.done(), vibe: two ? [v1.done(), v2.done()] : [v1.done()] };
}
