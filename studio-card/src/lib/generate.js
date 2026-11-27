// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// Generated stroke scripts (standard funscript: {version, inverted, range,
// actions: [{at, pos}]}). Each generator is deterministic: the same settings
// always give the same script. Add more alongside this one.

export const VARIATIONS = 100;          // Variation 1-100

// Seeded RNG (mulberry32), 32-bit unsigned, so a seed gives the same script everywhere.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0; let x = s;
    x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

// Relax / tease / edge.
// * seed (Variation 1-100) draws the whole plan: the warm-up, how many edges
//   (2-5) and how each builds and where it stops, the sections between them
//   (waves, tease, slow deep strokes, one zone, pulses) with their own tempo,
//   depth and timing, and how long each part lasts.
// * intensity 1-10: tempo x0.6-1.32 (1.0 at 6), stroke length 50-100% (full
//   from 6), the stops after each edge x0.5-1.4.
// * maxBpm caps every tempo. minutes 1-90: the plan fills it, the cool-down
//   to the end.
// * cruel (off by default): surprise freezes in waves and tease, fake-out
//   edges in about half the tease sections, each edge's stop 1-1.5x as long,
//   and a denied ending (barely moving) in place of the cool-down. Waves and
//   tease run at CRUEL_SEG_SCALE of their length to make room; freezes and
//   fake-outs happen inside them. Cruel draws from its own random stream, so
//   with it off the script is exactly as before.
export const CRUEL_SEG_SCALE = 0.9;
export function generateRelaxTeaseEdge(seed = 7, intensity = 6, maxBpm = 130, minutes = 60, cruel = false) {
  minutes = Math.max(1, Math.min(90, Math.round(minutes)));
  intensity = Math.max(1, Math.min(10, Math.round(intensity)));
  const total = minutes * 60000;
  const k = intensity - 1;
  const tempoMult = 0.6 + 0.08 * k;
  const rangeScale = Math.min(1, 0.5 + 0.1 * k);
  const holdMult = 0.5 + 0.1 * k;

  // The plan comes from its own stream, so it is the same at every length and intensity.
  const rnd = mulberry32(Math.imul((seed >>> 0) + 1, 0x9E3779B1));
  const U = (a, b) => a + (b - a) * rnd();
  const RI = (a, b) => Math.floor(U(a, b + 1));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  // Cruel mode's own stream: nothing in it is drawn with cruel off.
  const crnd = mulberry32(Math.imul((seed >>> 0) + 1, 0x85EBCA6B) ^ 0xC2B2AE35);
  const CU = (a, b) => a + (b - a) * crnd();
  const segScale = cruel ? CRUEL_SEG_SCALE : 1;

  const A = []; let t = 0;
  const add = (p) => A.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(p))) });
  const B = (b) => Math.min(maxBpm, b * tempoMult);            // intensity-scaled, capped bpm
  const R = (lo, hi) => { const c = (lo + hi) / 2, h = (hi - lo) / 2 * rangeScale; return [c - h, c + h]; };
  const live = (e) => t < e && t < total;

  // ---- the building blocks (dur in seconds, bpm before intensity) ----
  // Strokes; tempo ramps from b0 to b1.
  // clip: the last half-stroke is cut short so it ends on time (the slow denied ending).
  function strokes(dur, b0, b1, lo, hi, j = 4, clip = false) {
    [lo, hi] = R(lo, hi); b0 = B(b0); b1 = B(b1);
    const st = t, e = t + dur * 1000;
    while (live(e)) {
      const g = (t - st) / (e - st), h = 60000 / (b0 + (b1 - b0) * g) / 2;
      if (!clip) { add(hi - U(0, j)); t += h; add(lo + U(0, j)); t += h; continue; }
      add(hi - U(0, j)); t += Math.max(1000, Math.min(h, e - t)); if (!live(e)) break;
      add(lo + U(0, j)); t += Math.max(1000, Math.min(h, e - t));
    }
  }
  // Tempo in steps, b0 to b1.
  function stairs(dur, b0, b1, steps, lo, hi) {
    for (let i = 0; i < steps; i++) { const b = b0 + (b1 - b0) * (steps > 1 ? i / (steps - 1) : 1); strokes(dur / steps, b, b, lo, hi); }
  }
  // Steady tempo; the stroke swells and fades like breathing, from `top` down.
  function waves(dur, b, w, top, depth, swing) {
    dur *= segScale;
    const st = t, e = t + dur * 1000, h = 60000 / B(b) / 2, ph = U(0, 2 * Math.PI);
    let next = nextFreeze();
    while (live(e)) {
      if (t >= next) { freeze(e); next = nextFreeze(); continue; }
      const d = depth + swing * Math.sin(ph + 2 * Math.PI * (t - st) / (w * 1000));
      add(top); t += h; add(top - d); t += h;
    }
  }
  // Quick shallow flicks in a band, now and then one slow full stroke.
  function tease(dur, b, de, hiBand, loBand) {
    dur *= segScale;
    const e = t + dur * 1000, h = 60000 / B(b) / 2; let n = 0, nd = RI(...de);
    let next = nextFreeze();
    let fakeAt = cruel && crnd() < 0.5 ? t + CU(0.3, 0.8) * dur * 1000 : Infinity;
    while (live(e)) {
      if (t >= fakeAt) { fakeOut(e); fakeAt = Infinity; continue; }
      if (t >= next) { freeze(e); next = nextFreeze(); continue; }
      n++;
      if (n >= nd) { add(100); t += U(900, 1600); add(U(0, 10)); t += U(1100, 2000); n = 0; nd = RI(...de); }
      else { add(U(...hiBand)); t += h; add(U(...loBand)); t += h; }
    }
  }
  // Slow, deep strokes that linger at each end.
  function slowDeep(dur, b, hang) {
    const [lo, hi] = R(0, 100), e = t + dur * 1000, h = 60000 / B(b) / 2;
    while (live(e)) { add(hi); t += hang; add(hi); t += h; add(lo); t += hang; add(lo); t += h; }
  }
  // Bursts of short quick strokes between slow full ones.
  function pulse(dur, bFast, bSlow, lo, hi) {
    [lo, hi] = R(lo, hi);
    const e = t + dur * 1000, hf = 60000 / B(bFast) / 2, hs = 60000 / B(bSlow) / 2, mid = (lo + hi) / 2;
    let fast = rnd() < 0.5, until = t + U(3000, 9000);
    while (live(e)) {
      if (t >= until) { fast = !fast; until = t + U(3000, 9000); }
      const half = (hi - lo) / 2 * (fast ? 0.45 : 1), h = fast ? hf : hs, c = fast ? hi - half : mid;
      add(c + half - U(0, 3)); t += h; add(c - half + U(0, 3)); t += h;
    }
  }
  // A complete stop: two points at the same place so the device holds still.
  // (Cruel: cut short at the end, as its stops run longer.)
  function hold(dur, p) {
    if (t >= total) return;
    let ms = dur * holdMult * 1000;
    if (cruel) { ms = Math.min(ms, total - t - 500); if (ms < 1000) return; }
    add(p); t += ms; add(p); t += 500;
  }

  // ---- cruel mode (never reached with it off) ----
  // The next surprise freeze, 40-120 s on.
  function nextFreeze() { return cruel ? t + CU(40, 120) * 1000 : Infinity; }
  // Stops dead high up for 4-12 s, then carries on. Inside the section: skipped if it would not fit.
  function freeze(e) {
    const ms = CU(4, 12) * 1000, p = CU(70, 100);
    if (t + ms + 500 > Math.min(e, total)) return;
    add(p); t += ms; add(p); t += 500;
  }
  // A sudden 15-25 s build to near the peak, a hard stop, then back to teasing.
  function fakeOut(e) {
    const stop = CU(8, 15) * holdMult, room = (Math.min(e, total) - t) / 1000 - stop - 0.5;
    if (room < 10) return;
    strokes(Math.min(CU(15, 25), room), 60, 110, 0, 100);
    hold(stop / holdMult, 100);
  }

  // ---- the plan (seconds as at 60 minutes, scaled to fit) ----
  const plan = [];
  const warm = pick(['ramp', 'waves', 'slow']);
  if (warm === 'ramp') { const a = U(15, 22), b = U(26, 36), lo = U(28, 42), hi = U(68, 82); plan.push([U(200, 380), (d) => strokes(d, a, b, lo, hi)]); }
  else if (warm === 'waves') { const b = U(25, 38), w = U(25, 60); plan.push([U(200, 380), (d) => waves(d, b, w, 85, 30, 20)]); }
  else { const b = U(14, 22), hang = U(400, 1200); plan.push([U(200, 380), (d) => slowDeep(d, b, hang)]); }

  const middle = {
    waves: () => { const b = U(32, 60), w = U(18, 70), top = pick([95, 90, 75]), depth = U(28, Math.min(55, top - 25)), swing = U(12, Math.min(40, top - depth - 5)); return (d) => waves(d, b, w, top, depth, swing); },
    tease: () => { const b = U(68, 100), de = pick([[3, 5], [4, 7], [6, 10], [9, 15]]), hiB = pick([[90, 100], [82, 96], [70, 88]]), lo = hiB[0] - U(14, 30); return (d) => tease(d, b, de, hiB, [lo - 6, lo + 6]); },
    slow: () => { const b = U(16, 30), hang = U(250, 1100); return (d) => slowDeep(d, b, hang); },
    zone: () => { const z = pick([[50, 100], [0, 50], [25, 75], [60, 100], [0, 40]]), a = U(28, 55), b = a + U(-10, 18); return (d) => strokes(d, a, b, z[0], z[1], 3); },
    pulse: () => { const f = U(85, 120), s = U(20, 35), z = pick([[0, 100], [20, 100], [0, 80]]); return (d) => pulse(d, f, s, z[0], z[1]); },
    strokes: () => { const a = U(20, 34), b = U(24, 40), lo = U(20, 45), hi = U(70, 90); return (d) => strokes(d, a, b, lo, hi); },
  };
  const kinds = Object.keys(middle);
  const edges = RI(2, 5);
  const peak0 = U(90, 106), peak1 = U(114, 128);
  let last = '';
  for (let i = 0; i < edges; i++) {
    // Between edges: one to three sections, never the same kind twice running.
    const gaps = i === 0 ? RI(1, 3) : RI(1, 2);
    for (let g = 0; g < gaps; g++) {
      let kind = pick(kinds);
      while (kind === last) kind = pick(kinds);
      last = kind;
      plan.push([U(140, 380) * (5 / (edges + 3)), middle[kind]()]);
    }
    // The edge: builds (a ramp or steps), holds at the peak, then stops dead.
    const pb = peak0 + (peak1 - peak0) * (edges > 1 ? i / (edges - 1) : 1) + U(-4, 4);
    const final = i === edges - 1;
    const build = pick(['ramp', 'ramp', 'stairs']), from = U(38, 58), steps = RI(3, 5);
    const peakLo = pick([0, 0, 0, 15, 25]);
    const stopAt = pick([100, 100, 100, 90, 50, 0]);
    const buildS = U(110, 200) * (final ? 1.3 : 1), peakS = U(15, 35) * (final ? 1.4 : 1), holdS = U(18, 45) * (final ? 1.25 : 1);
    plan.push([buildS, (d) => (build === 'stairs' ? stairs(d, from, pb, steps, 0, 100) : strokes(d, from, pb, 0, 100))]);
    plan.push([peakS, (d) => strokes(d, pb, pb, peakLo, 100)]);
    plan.push([holdS, (d) => hold(d, stopAt), true]);
    if (!final && rnd() < 0.6) { const a = U(18, 26), b = U(24, 32); plan.push([U(60, 150), (d) => strokes(d, a, b, 30, 80)]); }   // a recovery
  }

  // Scale the plan to the length, leaving the cool-down (3-8% at 60 min).
  const cool = U(110, 290);
  const sum = plan.reduce((n, [s]) => n + s, 0);
  let scale = (3600 - cool) / sum * (minutes / 60);
  if (cruel) {
    // Each stop 1-1.5x as long. The plan is scaled with the stops at the length
    // they really run (x holdMult), so it still leaves the whole cool-down;
    // never larger than without cruel.
    let rest = 0, stops = 0;
    for (const p of plan) { if (p[2]) { p[0] *= CU(1, 1.5); stops += p[0]; } else rest += p[0]; }
    scale = Math.min(scale, (3600 - cool) * (minutes / 60) / (rest + stops * holdMult));
  }
  for (const [s, run] of plan) { if (t >= total) break; run(s * scale); }

  // Cool-down to the end, gentle at any intensity (its bpm is before scaling).
  // Cruel: denied, barely moving, very shallow and slow.
  const rest = Math.max(0, (total - t) / 1000);
  if (cruel) strokes(rest, 10 / tempoMult, 8 / tempoMult, 48, 60, 2, true);
  else strokes(rest, 30 / tempoMult, 12 / tempoMult, 40, 70);
  add(50);

  return { version: '1.0', inverted: false, range: 100, actions: A };
}

// The fastest move in a script, in position units per second.
export function peakSpeed(actions) {
  let top = 0;
  for (let i = 1; i < actions.length; i++) {
    const dt = actions[i].at - actions[i - 1].at;
    if (dt > 0) top = Math.max(top, Math.abs(actions[i].pos - actions[i - 1].pos) / dt * 1000);
  }
  return top;
}

// Sorted, strictly increasing times, positions 0-100.
export function checkScript(script) {
  const a = script.actions;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isInteger(a[i].at) || !Number.isInteger(a[i].pos) || a[i].pos < 0 || a[i].pos > 100) return `point ${i} is out of range`;
    if (i && a[i].at <= a[i - 1].at) return `point ${i} is not after the one before`;
  }
  return '';
}

export const relaxTeaseEdgeFile = (intensity, minutes = 60, seed, cruel = false) => `relax_tease_edge_${Math.max(1, Math.min(90, Math.round(minutes)))}min_i${Math.max(1, Math.min(10, Math.round(intensity)))}${seed ? `_v${seed}` : ''}${cruel ? '_cruel' : ''}.funscript`;
