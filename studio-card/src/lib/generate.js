// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// Generated stroke scripts (standard funscript: {version, inverted, range,
// actions: [{at, pos}]}). Each generator is deterministic: the same settings
// always give the same script. Add more to GENERATORS.

// Seeded RNG (mulberry32), 32-bit unsigned, so a seed gives the same script everywhere.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0; let x = s;
    x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

// Relax / tease / edge. intensity 1-10 (6 = the original), maxBpm a hard
// cap, seed the variation, minutes the length (1-90): every section scales
// with it, so 60 is the original exactly; the cool-down fills to the end.
export function generateRelaxTeaseEdge(seed = 7, intensity = 6, maxBpm = 130, minutes = 60) {
  minutes = Math.max(1, Math.min(90, Math.round(minutes)));
  const total = minutes * 60000, f = minutes / 60;
  const D = (sec) => sec * f;                                 // a section's length at this length
  intensity = Math.max(1, Math.min(10, Math.round(intensity)));
  const k = intensity - 1;
  const tempoMult = 0.6 + 0.08 * k;
  const rangeScale = Math.min(1, 0.5 + 0.1 * k);
  const holdMult = 0.5 + 0.1 * k;

  const rnd = mulberry32(seed);
  const U = (a, b) => a + (b - a) * rnd();
  const RI = (a, b) => Math.floor(U(a, b + 1));

  const A = []; let t = 0;
  const add = (p) => A.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(p))) });
  const B = (b) => Math.min(maxBpm, b * tempoMult);            // intensity-scaled, capped bpm
  const R = (lo, hi) => { const c = (lo + hi) / 2, h = (hi - lo) / 2 * rangeScale; return [c - h, c + h]; };

  // Full strokes; tempo ramps linearly from b0 to b1 bpm.
  function strokes(dur, b0, b1, lo, hi, j = 4) {
    [lo, hi] = R(lo, hi); b0 = B(b0); b1 = B(b1);
    const st = t, e = t + dur * 1000;
    while (t < e && t < total) {
      const g = (t - st) / (e - st), h = 60000 / (b0 + (b1 - b0) * g) / 2;
      add(hi - U(0, j)); t += h; add(lo + U(0, j)); t += h;
    }
  }
  // Steady tempo; stroke length swells and fades like breathing.
  function waves(dur, b, w = 40) {
    const st = t, e = t + dur * 1000, h = 60000 / B(b) / 2;
    while (t < e && t < total) {
      const d = 55 + 40 * Math.sin(2 * Math.PI * (t - st) / (w * 1000));
      add(95); t += h; add(95 - d); t += h;
    }
  }
  // Quick shallow flicks near the top, with an occasional slow full stroke.
  function tease(dur, b = 80, de = [6, 10]) {
    const e = t + dur * 1000, h = 60000 / B(b) / 2; let n = 0, nd = RI(...de);
    while (t < e && t < total) {
      n++;
      if (n >= nd) { add(100); t += 1200; add(5); t += 1500; n = 0; nd = RI(...de); }
      else { add(U(90, 100)); t += h; add(U(65, 78)); t += h; }
    }
  }
  // Complete stop: two identical points so the device holds still.
  function hold(dur, p) { add(p); t += dur * holdMult * 1000; add(p); t += 500; }
  // Build to peak, sustain, then a hard stop at the top (raw bpm: strokes() scales and caps).
  function edge(buildS, pb, peakS, holdS) {
    strokes(D(buildS), 45, pb, 0, 100); strokes(D(peakS), pb, pb, 0, 100); if (t < total) hold(D(holdS), 100);
  }

  // ---- the programme (times at 60 minutes; D() scales them) ----
  strokes(D(300), 18, 32, 35, 75);     // 0:00 gentle warm-up
  waves(D(420), 40);                   // 5:00 relaxing waves
  tease(D(360), 75);                   // 12:00 tease
  edge(150, 100, 20, 30);              // edge 1 + stop
  strokes(D(120), 22, 28, 30, 80);     // recovery
  tease(D(300), 85);
  waves(D(240), 50);
  edge(180, 110, 30, 40);              // edge 2 + stop
  strokes(D(150), 20, 30, 40, 85);     // recovery
  tease(D(300), 90, [4, 7]);           // tease with more deep strokes
  edge(150, 115, 20, 30);              // edge 3 + stop
  strokes(D(90), 25, 30, 30, 80);      // recovery
  tease(D(180), 95);
  edge(200, 120, 40, 45);              // the final, longest edge + stop
  // Cool-down to the end, gentle at any intensity (its bpm is before scaling).
  strokes(Math.max(0, (total - t) / 1000), 30 / tempoMult, 12 / tempoMult, 40, 70);
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

export const relaxTeaseEdgeFile = (intensity, minutes = 60) => `relax_tease_edge_${Math.max(1, Math.min(90, Math.round(minutes)))}min_i${Math.max(1, Math.min(10, Math.round(intensity)))}.funscript`;
