// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// The Queue card's builder: steps (a pattern, a mood, a saved script or a
// pause, each for a set time) made into one script, for vibrators or for a
// stroker. Worked out here in the browser, with the same patterns and moods
// as the Play card, so what is sent is exactly what plays.
import { aiRandom } from './ai.js';
import { duration } from './core.js';
import { isStroke, runScript } from './convert.js';
import { MOODS, buildMood, moodSoften } from './moods.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM, RandomProgram, patternDual, patternLevel, patternPeriod } from './patterns.js';
import { simplify } from '../card/screenoff.js';

export const STEP_MS = 50;                       // patterns are worked out every 50 ms
export const MAX_STEP_MS = 60 * 60 * 1000;       // one step: up to an hour
export const MAX_TOTAL_MS = 6 * 60 * 60 * 1000;  // a whole script: up to six hours (Ogg's limit)
export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600];   // s

const clamp = (v) => Math.min(100, Math.max(0, v));
const isDual = (key) => key in PATTERNS_DUAL;

// 1:05, 10:00, 1:02:03
export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

// The default name: its length, then the date and time it was made.
export function defaultName(ms, now = new Date()) {
  const day = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${clock(ms)} · ${day} ${time}`;
}

export const stepLabel = (step) => {
  if (step.type === 'pause') return 'Pause';
  if (step.type === 'script') return step.name || 'Saved script';
  if (step.type === 'mood') { const m = MOODS[step.key]; return m ? `${m.icon} ${m.label}` : 'Mood'; }
  if (step.key === PATTERN_RANDOM) return 'Random';
  return PATTERNS[step.key] || PATTERNS_DUAL[step.key] || 'Pattern';
};

// A track cut at `end` ms (with a point exactly there).
function cut(track, end) {
  const out = [];
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (p.at <= end) { out.push({ at: p.at, pos: p.pos }); continue; }
    const q = track[i - 1];
    if (q && q.at < end) out.push({ at: end, pos: Math.round(q.pos + (p.pos - q.pos) * (end - q.at) / (p.at - q.at)) });
    break;
  }
  const last = out[out.length - 1];
  if (last && last.at < end) out.push({ at: end, pos: last.pos });
  return out;
}

// A track repeated until it is `ms` long.
function fill(track, ms) {
  const len = track.length ? track[track.length - 1].at : 0;
  if (!len) return [{ at: 0, pos: track.length ? track[0].pos : 0 }, { at: ms, pos: track.length ? track[0].pos : 0 }];
  const out = [];
  for (let by = 0; by < ms; by += len) {
    for (const p of track) {
      const at = p.at + by, last = out[out.length - 1];
      if (last && at <= last.at) { if (p.pos !== last.pos) out.push({ at: last.at + 1, pos: p.pos }); continue; }
      out.push({ at, pos: p.pos });
    }
  }
  return cut(out, ms);
}

// A pattern for `ms`: level (0-100) is its top, speed (0-100) its cycle.
export function renderPattern(key, ms, { level = 70, speed = 50, seed = 1 } = {}) {
  const top = clamp(level), period = patternPeriod(speed) * 1000;
  const rnd = key === PATTERN_RANDOM ? new RandomProgram(2, Math.max(0.1, top / 100), aiRandom(seed)) : null;
  const a = [], b = [];
  for (let t = 0; t <= ms; t += STEP_MS) {
    let va, vb;
    if (rnd) [va, vb] = rnd.step(t ? STEP_MS : 0).map((v) => v * 100);
    else if (isDual(key)) { va = patternDual(key, t / period, 0) * top; vb = patternDual(key, t / period, 1) * top; }
    else va = vb = patternLevel(key, t / period) * top;
    a.push({ at: t, pos: Math.round(clamp(va)) });
    b.push({ at: t, pos: Math.round(clamp(vb)) });
  }
  const dual = Boolean(rnd) || isDual(key);
  return { a: cut(simplify(a, 1.5), ms), b: dual ? cut(simplify(b, 1.5), ms) : null };
}

// A mood for `ms`: its combos one after another (never the same twice in a
// row), with small random changes. strength (0-100) softens it.
export function renderMood(key, ms, { strength = 100, seed = 1 } = {}) {
  const mood = MOODS[key];
  if (!mood) throw new Error('Unknown mood');
  const r = aiRandom(seed), k = clamp(strength) / 100;
  const stroke = [], a = [], b = [];
  let at = 0, last = -1, two = false;
  const add = (to, track, by) => {
    for (const p of track) {
      const t = p.at + by, prev = to[to.length - 1];
      if (prev && t <= prev.at) { if (prev.pos !== p.pos) to.push({ at: prev.at + 1, pos: p.pos }); continue; }
      to.push({ at: t, pos: p.pos });
    }
  };
  for (let guard = 0; at < ms && guard < 1000; guard++) {
    let i = Math.floor(r() * mood.combos.length);
    if (mood.combos.length > 1 && i === last) i = (i + 1) % mood.combos.length;
    last = i;
    const built = buildMood(mood.combos[i][1], r);
    const len = Math.max(built.stroke[built.stroke.length - 1].at, ...built.vibe.map((v) => v[v.length - 1].at));
    add(stroke, built.stroke, at);
    add(a, built.vibe[0], at);
    if (built.vibe[1]) two = true;
    add(b, built.vibe[1] || built.vibe[0], at);
    at += len;
  }
  const soft = (track, fn) => track.map((p) => ({ at: p.at, pos: Math.round(clamp(fn(p))) }));
  return {
    stroke: cut(soft(stroke, (p) => (k >= 1 ? p.pos : moodSoften(p.pos, k, p.at))), ms),
    a: cut(soft(a, (p) => p.pos * k), ms),
    b: two ? cut(soft(b, (p) => p.pos * k), ms) : null,
  };
}

// The tracks of one step, `ms` long, for vibrators (a, b) or a stroker (a).
// `scripts` maps saved names to their scripts (fetched beforehand).
export function renderStep(step, stroke, scripts, last = 0) {
  const ms = Math.min(MAX_STEP_MS, Math.max(1000, Math.round(step.ms || 60000)));
  if (step.type === 'pause') {
    const hold = stroke ? last : 0;
    return { a: [{ at: 0, pos: hold }, { at: ms, pos: hold }], b: null, ms };
  }
  if (step.type === 'mood') {
    const m = renderMood(step.key, ms, { strength: step.level ?? 100, seed: step.seed || 1 });
    return stroke ? { a: m.stroke, b: null, ms } : { a: m.a, b: m.b, ms };
  }
  if (step.type === 'script') {
    const s = scripts && scripts.get(step.name);
    if (!s) throw new Error(`"${step.name}" is not in the library`);
    // A stroke script on vibrators plays as its speed; a vibration script
    // on a stroker moves with its level.
    const src = !stroke && isStroke(s) ? runScript(s, 'speed') : s;
    const second = src.channels && src.channels.V1 && src.channels.V1.actions.length ? src.channels.V1.actions : null;
    return { a: fill(src.actions, ms), b: !stroke && second ? fill(second, ms) : null, ms };
  }
  const p = renderPattern(step.key, ms, { level: step.level ?? 70, speed: step.speed ?? 50, seed: step.seed || 1 });
  return { a: p.a, b: stroke ? null : p.b, ms };
}

// All the steps, one after another, as one script.
export function composeScript(steps, { stroke = false, title = '' } = {}, scripts = new Map()) {
  if (!steps.length) throw new Error('Add a step first');
  const A = [], B = [];
  let at = 0, two = false;
  const join = (to, track, by) => {
    for (const p of track) {
      const t = p.at + by, prev = to[to.length - 1];
      if (prev && t <= prev.at) { if (prev.pos !== p.pos) to.push({ at: prev.at + 1, pos: p.pos }); continue; }
      to.push({ at: t, pos: p.pos });
    }
  };
  for (const step of steps) {
    const last = A.length ? A[A.length - 1].pos : 50;
    const out = renderStep(step, stroke, scripts, last);
    if (out.b) two = true;
    join(A, out.a, at);
    join(B, out.b || out.a, at);
    at += out.ms;
    if (at > MAX_TOTAL_MS) throw new Error('A script can be at most six hours long');
  }
  const script = { version: '1.0', inverted: false, range: 100, actions: A,
    metadata: { type: stroke ? 'stroke' : 'vibration', creator: 'Ogg Queue', title: title || defaultName(at), steps: steps.length } };
  if (two) script.channels = { V1: { actions: B } };
  return script;
}

// How long the steps will play (without working them out).
export const stepsMs = (steps) => steps.reduce((n, s) => n + Math.min(MAX_STEP_MS, Math.max(1000, Math.round(s.ms || 60000))), 0);

export { duration };
