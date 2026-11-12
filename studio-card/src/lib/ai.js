// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { cleanActions } from './convert.js';
import { sampleAt } from './outputs.js';
import { STROKE_TOP } from './stroke.js';

// ---------------------------------------------------------- AI feel
// "How it makes you feel" mapping between stroke and vibration. Instead of
// number-for-number, it reads the intent of the last few seconds (a mood)
// and answers with a matching feel: stroke moods become vibration patterns,
// vibration moods become planned strokes. Moods switch only once they have
// lasted a moment, and patterns re-roll every 10-24 s to stay interesting.
export const FOLLOW_AI = 'ai';
export const AI_STEP = 50;          // ms between analysed samples
export const AI_HALF = 30;          // samples either side for scripts (3 s window)
export const AI_LIVE_MS = 3000;     // live: the last 3 s
export const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Small seeded random generator: the same script previews the same way.
export function aiRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const aiSeed = (acts) => (acts.length * 7919 + (acts.length ? acts[acts.length - 1].at : 0) * 31 + (acts.length ? acts[0].pos : 0)) >>> 0;
export const hashUnit = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

// Stroke window (positions every AI_STEP ms): speed, stroke rate and length,
// depth, how much of the time it moves, and whether it is speeding up.
export function strokeFeatures(p) {
  const n = p.length;
  if (n < 3) return { speed: 0, rate: 0, amp: 0, center: n ? p[0] : 50, activity: 0, trend: 1 };
  let dist = 0, moving = 0, dir = 0, ext = p[0], extI = 0, prevExt = p[0];
  const halves = [];
  for (let i = 1; i < n; i++) {
    const d = p[i] - p[i - 1];
    dist += Math.abs(d);
    if (Math.abs(d) > 0.4) moving++;
    if (dir >= 0) {
      if (p[i] >= ext) { ext = p[i]; extI = i; } else if (ext - p[i] > 4) { halves.push(Math.abs(ext - prevExt)); prevExt = ext; dir = -1; ext = p[i]; extI = i; }
    } else if (p[i] <= ext) { ext = p[i]; extI = i; } else if (p[i] - ext > 4) { halves.push(Math.abs(ext - prevExt)); prevExt = ext; dir = 1; ext = p[i]; extI = i; }
  }
  const secs = (n - 1) * AI_STEP / 1000;
  const real = halves.filter((a) => a >= 4);
  let lo = 100, hi = 0, sum = 0;
  for (const v of p) { lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
  const amp = real.length ? real.reduce((a, b) => a + b, 0) / real.length : hi - lo;
  const third = Math.max(2, Math.floor(n / 3));
  const travel = (from, to) => { let t = 0; for (let i = from + 1; i < to; i++) t += Math.abs(p[i] - p[i - 1]); return t; };
  const early = travel(0, third), late = travel(n - third, n);
  return {
    speed: dist / secs,
    rate: real.length / 2 / secs,
    amp,
    center: sum / n,
    activity: moving / (n - 1),
    trend: early > 5 ? late / early : (late > 20 ? 3 : 1),
  };
}

// prev: the mood before, or true when it was intense in the last few seconds.
export function strokeMood(f, prev) {
  const hot = prev === true || ['intense', 'frantic', 'build', 'edge'].includes(prev);
  if (f.speed < 12) return hot ? 'edge' : 'rest';
  if (hot && f.speed < 45 && f.activity < 0.5) return 'edge';     // winding down right after a peak
  if (f.rate > 2.0 && f.amp < 35) return 'frantic';
  if (f.speed > 230 && f.amp >= 30) return 'intense';
  if (f.trend > 1.6 && f.speed > 40) return 'build';
  if (f.speed >= 110) return 'rhythm';
  if (f.amp >= 40 && f.activity > 0.6) return 'glide';
  return 'tease';
}

// Vibration patterns: (seconds into the pattern, stroke tempo Hz, level 0-1, context) -> 0-100.
export const sine01 = (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
export const VIBE_PATTERNS = {
  breath: (t) => 6 + 6 * Math.sin(2 * Math.PI * 0.15 * t),
  off: () => 0,
  // Pulses here stay about 200 ms or longer, so Bluetooth toys do not miss them.
  heartbeat: (t, f, L) => { const per = 1 / clampN(f, 0.75, 1.2); const x = (t % per) / per; return (x < 0.24 ? 1 : x >= 0.5 && x < 0.74 ? 0.7 : 0) * (28 + 45 * L); },
  flicker: (t, f, L) => { const slot = Math.floor(t / 0.7); return hashUnit(slot) < 0.45 && t - slot * 0.7 < 0.25 ? 35 + 30 * L : 4; },
  slowwave: (t, f, L) => 10 + (25 + 30 * L) * sine01(0.3 * t),
  swell: (t, f, L, c) => 15 + (35 + 45 * L) * (1 - c.pos / 100),          // deeper = stronger
  tide: (t, f, L) => 30 + 25 * L + 15 * Math.sin(2 * Math.PI * 0.2 * t),
  strokepulse: (t, f, L, c) => (c.dir < 0 ? 45 + 45 * L : 12 + 10 * L),    // a pulse on every downstroke
  steps: (t, f, L) => 28 + Math.floor(((t * f / 2) % 1) * 4) * (10 + 8 * L),
  throb: (t, f, L) => 35 + (25 + 30 * L) * sine01(f * t),
  pound: (t, f, L) => (((t * f) % 1) < Math.max(0.35, 0.2 * f) ? 100 : 55 + 20 * L),
  surge: (t, f) => 60 + 40 * ((t * f) % 1),
  high: (t, f, L) => 84 + 8 * L + 4 * Math.sin(2 * Math.PI * 3 * t),
  flutter: (t, f, L) => (Math.sin(2 * Math.PI * 3 * t) > 0 ? 85 + 10 * L : 55),
  buzz: (t) => 86 + 8 * Math.sign(Math.sin(2 * Math.PI * 3 * t)),
  stutter: (t, f, L) => (((t * 2.5) % 1) < 0.5 ? 80 + 15 * L : 25),
  ramp: (t, f, L, c) => 30 + Math.min(60, Math.floor(c.tm / 1.5) * 10) + 8 * L,
  risingwave: (t, f, L, c) => 20 + (35 + 45 * Math.min(1, c.tm / 8)) * sine01(0.6 * t),
};
export const STROKE_MOOD_PATTERNS = {
  rest: ['breath', 'off'], edge: ['heartbeat', 'off', 'heartbeat'], tease: ['heartbeat', 'flicker', 'slowwave'],
  glide: ['swell', 'tide', 'slowwave'], rhythm: ['strokepulse', 'steps', 'throb'], build: ['ramp', 'risingwave', 'steps'],
  intense: ['pound', 'surge', 'high'], frantic: ['flutter', 'buzz', 'stutter'],
};

// Shared mood keeper: a new mood must last `hold` s; patterns re-roll every 10-24 s.
export class MoodKeeper {
  constructor(seed, table) { this.r = aiRandom(seed); this.table = table; this.mood = null; this.cand = null; this.candAt = 0; this.pat = null; this.patAt = 0; this.patUntil = 0; this.moodAt = 0; }
  // Switch once a new mood has held most (70%) of the last `hold` seconds,
  // so one odd reading neither switches nor resets the wait.
  update(t, mood, hold) {
    if (this.mood === null) { this.mood = mood; this.moodAt = t; this.hist = [{ t, mood }]; this.pick(t); return; }
    this.hist.push({ t, mood });
    while (this.hist.length > 1 && this.hist[0].t < t - hold) this.hist.shift();
    if (mood !== this.mood && t - this.hist[0].t >= hold * 0.8) {
      const share = this.hist.filter((h) => h.mood === mood).length / this.hist.length;
      if (share >= 0.7) { this.mood = mood; this.moodAt = t; this.pick(t); }
    }
    if (t >= this.patUntil) this.pick(t);
  }
  pick(t) {
    const list = this.table[this.mood];
    let p = list[Math.floor(this.r() * list.length)];
    if (p === this.pat && new Set(list).size > 1) p = list.find((x) => x !== this.pat);
    this.pat = p; this.patAt = t; this.patUntil = t + 10 + this.r() * 14;
  }
  get label() { return `${this.mood} · ${this.pat}`; }
}

export class StrokeToVibe {
  constructor(seed) { this.k = new MoodKeeper(seed, STROKE_MOOD_PATTERNS); }
  step(t, f, ctx) {
    if (['intense', 'frantic', 'build'].includes(this.k.mood)) this.hotAt = t;
    const hot = this.hotAt !== undefined && t - this.hotAt < 4;
    let mood = strokeMood(f, hot || this.k.mood);
    if (mood === 'edge' && this.k.mood === 'edge' && t - this.k.moodAt > 6) mood = 'rest';
    this.k.update(t, mood, mood === 'rest' || mood === 'edge' ? 0.5 : 0.9);
    const L = this.k.mood === 'edge' ? 0.12 : clampN(0.6 * f.speed / 320 + 0.4 * f.amp / 100, 0, 1);
    const tempo = clampN(f.rate || 1, 0.3, 4);
    return clampN(VIBE_PATTERNS[this.k.pat](t - this.k.patAt, tempo, L, { ...ctx, tm: t - this.k.moodAt }), 0, 100);
  }
}

// Vibration window (levels every AI_STEP ms): level, swing, pulse rate, rise, roughness.
export function vibeFeatures(v) {
  const n = v.length;
  if (n < 3) return { mean: n ? v[0] : 0, std: 0, max: n ? v[0] : 0, pulseRate: 0, trend: 0 };
  let sum = 0, max = 0;
  for (const x of v) { sum += x; max = Math.max(max, x); }
  const mean = sum / n;
  let sq = 0;
  for (const x of v) sq += (x - mean) * (x - mean);
  const std = Math.sqrt(sq / n);
  const hyst = Math.max(6, std * 0.5);
  let side = 0, cross = 0;
  for (const x of v) {
    if (x > mean + hyst / 2 && side <= 0) { if (side < 0) cross++; side = 1; } else if (x < mean - hyst / 2 && side >= 0) { if (side > 0) cross++; side = -1; }
  }
  const secs = (n - 1) * AI_STEP / 1000;
  const third = Math.max(1, Math.floor(n / 3));
  const avg = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += v[i]; return s / (to - from); };
  const a = avg(0, third), b = avg(third, n - third), c = avg(n - third, n);
  let lo = 0, hi = 0;
  for (let i = 1; i < n; i++) { if (v[i] < v[lo]) lo = i; if (v[i] >= v[hi]) hi = i; }
  // A real build: steadily up, lowest at the start and highest at the end.
  const rising = b > a + 4 && c > b + 4 && lo <= n * 0.2 && hi >= n * 0.8;
  return { mean, std, max, pulseRate: cross / 2 / secs, trend: c - a, rising };
}

export function vibeMood(f) {
  if (f.mean < 4 && f.max < 10) return 'rest';
  if (f.pulseRate > 3.5 && f.mean > 35) return 'buzz';
  if (f.trend > 15 && f.rising) return 'build';     // a sustained rise, not one side of a wave
  if (f.mean > 68 && f.std < 15) return 'strong';
  if (f.mean < 25) return 'tease';            // anything faint is teasing, whatever its shape
  if (f.std >= 14 && f.pulseRate >= 0.4) return f.mean < 35 ? 'tease' : 'pulse';
  if (f.std >= 10) return 'wave';
  if (f.mean < 30) return 'tease';
  return 'steady';
}

// Stroke styles: (features, half-stroke number, seconds in mood, time) -> the
// next stroke's centre and length (0-100), full cycle time (s), and pauses.
export const STROKE_STYLES = {
  park: () => ({ center: 85, amp: 0, period: 2 }),
  tiptease: (f) => ({ center: 82, amp: 14 + 12 * f.mean / 100, period: 2.2 - 0.8 * f.mean / 100, pauseEvery: 4, pauseLen: 0.8 }),
  slowfull: (f) => ({ center: 50, amp: 70, period: 3.2 - 1.2 * f.mean / 100 }),
  stopstart: () => ({ center: 70, amp: 30, period: 1.6, pauseEvery: 2, pauseLen: 1.2 }),
  swell: (f) => ({ center: 55, amp: 30 + 55 * f.mean / 100, period: 2.4 - 1.2 * f.mean / 100 }),
  tidal: (f) => ({ center: 60 - 20 * f.mean / 100, amp: 40 + 30 * f.mean / 100, period: 2.0 }),
  beat: (f) => ({ center: 55, amp: 35 + 45 * f.max / 100, period: clampN(1 / Math.max(f.pulseRate, 0.1), 0.45, 3) }),
  doublebeat: (f) => ({ center: 60, amp: 25 + 35 * f.max / 100, period: clampN(0.5 / Math.max(f.pulseRate, 0.1), 0.4, 2) }),
  metronome: (f) => ({ center: 55, amp: 45, period: 1.5 - 0.7 * f.mean / 100 }),
  longshort: (f, k) => ({ center: 50, amp: k % 4 < 2 ? 70 : 30, period: 1.2 - 0.5 * f.mean / 100 }),
  drift: (f, k, tm, t) => ({ center: 50 + 25 * Math.sin(0.15 * 2 * Math.PI * t), amp: 40, period: 1.3 - 0.5 * f.mean / 100 }),
  pound: (f) => ({ center: 40, amp: 80, period: 0.75 - 0.25 * f.mean / 100 }),
  fullfast: () => ({ center: 50, amp: 92, period: 0.6 }),
  mixed: (f, k) => (k % 6 < 2 ? { center: 45, amp: 85, period: 1.0 } : { center: 60, amp: 30, period: 0.36 }),
  vibrato: () => ({ center: 40, amp: 18, period: 0.3 }),
  shudder: (f, k) => (k % 10 < 2 ? { center: 50, amp: 70, period: 0.7 } : { center: 30, amp: 12, period: 0.26 }),
  climb: (f, k, tm) => ({ center: 55 - 10 * Math.min(1, tm / 10), amp: 30 + 60 * Math.min(1, tm / 10), period: 1.6 - 1.0 * Math.min(1, tm / 10) }),
};
export const VIBE_MOOD_STYLES = {
  rest: ['park'], tease: ['tiptease', 'slowfull', 'stopstart'], wave: ['swell', 'tidal', 'slowfull'],
  pulse: ['beat', 'doublebeat', 'beat'], steady: ['metronome', 'longshort', 'drift'],
  strong: ['pound', 'fullfast', 'mixed'], buzz: ['vibrato', 'shudder'], build: ['climb', 'climb', 'swell'],
};

// Plans strokes from the vibration's mood: one half-stroke at a time, never
// faster than the device's top speed.
export class VibeToStroke {
  constructor(seed) { this.k = new MoodKeeper(seed, VIBE_MOOD_STYLES); this.half = 0; this.pos = 85; this.dir = 1; this.nextAt = 0; this.paused = false; }
  // Next move {goal, dur ms} if one is due at t (s), else null (moving or pausing).
  plan(t, f) {
    this.k.update(t, vibeMood(f), 1.0);
    if (t < this.nextAt) return null;
    const P = STROKE_STYLES[this.k.pat](f, this.half, t - this.k.moodAt, t);
    if (P.amp < 2) {
      const goal = clampN(P.center, 0, 100);
      const dur = Math.max(800, Math.abs(goal - this.pos) / (STROKE_TOP / 1000));
      this.pos = goal; this.nextAt = t + dur / 1000;
      return { goal, dur };
    }
    if (P.pauseEvery && this.half > 0 && this.half % (P.pauseEvery * 2) === 0 && !this.paused) { this.paused = true; this.nextAt = t + P.pauseLen; return null; }
    this.paused = false;
    this.dir = -this.dir;
    const goal = clampN(P.center + this.dir * P.amp / 2, 0, 100);
    const dur = Math.max(P.period * 500, Math.abs(goal - this.pos) / (STROKE_TOP / 1000));
    this.half += 1; this.pos = goal; this.nextAt = t + dur / 1000;
    return { goal, dur };
  }
}

export const resample = (actions, from, to) => { const out = []; for (let ms = from; ms <= to; ms += AI_STEP) out.push(sampleAt(actions, ms)); return out; };

// Scripts: stroke actions -> vibration actions (with the moods it found).
export function aiStrokeToVibe(actions) {
  const a = cleanActions(actions);
  if (a.length < 2) return { actions: a.map((x) => ({ at: x.at, pos: 0 })), moods: [] };
  const end = a[a.length - 1].at;
  const pos = resample(a, 0, end);
  const eng = new StrokeToVibe(aiSeed(a));
  const out = [], moods = [];
  let last = null;
  for (let k = 0; k < pos.length; k++) {
    const f = strokeFeatures(pos.slice(Math.max(0, k - AI_HALF), k + AI_HALF + 1));
    const dir = k + 1 < pos.length ? Math.sign(pos[k + 1] - pos[k]) : 0;
    const v = Math.round(eng.step(k * AI_STEP / 1000, f, { pos: pos[k], dir }));
    if (!moods.length || moods[moods.length - 1].label !== eng.k.label) moods.push({ at: k * AI_STEP, label: eng.k.label });
    if (v !== last) {
      if (last !== null && out.length && out[out.length - 1].at < k * AI_STEP - AI_STEP) out.push({ at: k * AI_STEP - AI_STEP, pos: last });
      out.push({ at: k * AI_STEP, pos: v });
      last = v;
    }
  }
  out.push({ at: end, pos: last ?? 0 }, { at: end + 1, pos: 0 });
  return { actions: out, moods };
}

// Scripts: vibration actions -> stroke actions (planned strokes).
export function aiVibeToStroke(actions) {
  const a = cleanActions(actions);
  if (!a.length) return { actions: [], moods: [] };
  const end = a[a.length - 1].at;
  const lv = resample(a, 0, end);
  const eng = new VibeToStroke(aiSeed(a));
  const out = [{ at: 0, pos: eng.pos }], moods = [];
  // Every 50 ms: the mood is read; a stroke is planned whenever the last one ends.
  for (let k = 0; k < lv.length; k++) {
    const t = k * AI_STEP / 1000;
    const f = vibeFeatures(lv.slice(Math.max(0, k - AI_HALF), k + AI_HALF + 1));
    const due = t >= eng.nextAt;
    const before = eng.pos;
    const move = eng.plan(t, f);
    if (!moods.length || moods[moods.length - 1].label !== eng.k.label) moods.push({ at: Math.round(t * 1000), label: eng.k.label });
    if (move) out.push({ at: Math.round(t * 1000 + move.dur), pos: Math.round(move.goal) });
    else if (due) out.push({ at: Math.round(eng.nextAt * 1000), pos: Math.round(before) });   // a pause: hold
  }
  const clean = [];
  for (const x of out) { const l = clean[clean.length - 1]; if (l && x.at <= l.at) l.pos = x.pos; else clean.push(x); }
  return { actions: clean, moods };
}

export const moodAt = (moods, ms) => { let m = null; for (const x of moods) { if (x.at > ms) break; m = x.label; } return m; };

// Live: the last 3 s of input, analysed every update.
export class AiLive {
  constructor(kind) { this.kind = kind; this.buf = []; this.eng = kind === 'stroke' ? new StrokeToVibe((Math.random() * 2 ** 32) >>> 0) : new VibeToStroke((Math.random() * 2 ** 32) >>> 0); this.last = null; }
  window(now) {
    const from = now - AI_LIVE_MS;
    while (this.buf.length > 2 && this.buf[1].at < from) this.buf.shift();
    const out = [];
    for (let ms = Math.max(from, this.buf[0].at); ms <= now; ms += AI_STEP) out.push(sampleAt(this.buf, ms));
    return out;
  }
  // Stroke in (position) -> vibration level.
  level(now, pos, dir) {
    this.buf.push({ at: now, pos });
    return this.eng.step(now / 1000, strokeFeatures(this.window(now)), { pos, dir });
  }
  // Vibration in (level) -> next stroke move (or the last one while it runs).
  move(now, level) {
    this.buf.push({ at: now, pos: level });
    const m = this.eng.plan(now / 1000, vibeFeatures(this.window(now)));
    if (m) this.last = m;
    return this.last || { goal: this.eng.pos, dur: 300 };
  }
  get label() { return this.eng.k.label; }
}
