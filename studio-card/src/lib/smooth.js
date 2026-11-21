// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Clean up stroker timelines so a Bluetooth stroker moves smoothly: the same
// steps as Ogg's custom_components/ogg/smoothing.py (keep the two in step).
// A stroker takes one "go to X over T ms" Bluetooth write per point, and
// each write takes 100-300 ms to land through a proxy, so dense or wobbly
// timelines arrive late and out of rhythm. Kept: every real turn, every
// pause, real changes of speed. Dropped: points on a straight line, wobbles
// smaller than MIN_TRAVEL, and moves quicker than MIN_SEGMENT_MS.
export const SMOOTH_TOLERANCE = 2.5;    // % off a straight line that still counts as straight
export const SMOOTH_MIN_TRAVEL = 4;     // % : a smaller reversal is a wobble
export const SMOOTH_FLAT = 1;           // % : a leg this flat is a pause
export const SMOOTH_HOLD_MS = 250;      // a pause at least this long is kept
export const SMOOTH_MIN_SEGMENT_MS = 150;

const sign = (x) => (x > 0) - (x < 0);
const isTurn = (a, b, c) => sign(b[1] - a[1]) * sign(c[1] - b[1]) < 0;

function clean(points) {
  const out = [];
  for (const [at, p] of points.map((x) => [Number(x[0]), Number(x[1])]).sort((a, b) => a[0] - b[0])) {
    const pos = Math.min(100, Math.max(0, p));
    if (out.length && at <= out[out.length - 1][0]) out[out.length - 1] = [out[out.length - 1][0], pos];
    else out.push([at, pos]);
  }
  return out;
}

function extremes(pts, minTravel) {
  const out = [0];
  let dir = 0, best = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i][1];
    if (dir === 0) {
      if (Math.abs(p - pts[0][1]) >= minTravel) { dir = p > pts[0][1] ? 1 : -1; best = i; }
      continue;
    }
    if ((p - pts[best][1]) * dir > 0) best = i;
    else if (Math.abs(p - pts[best][1]) >= minTravel) { out.push(best); dir = -dir; best = i; }
  }
  if (best && best !== out[out.length - 1]) out.push(best);
  if (out[out.length - 1] !== pts.length - 1) out.push(pts.length - 1);
  return out;
}

function shape(pts, tolerance, minTravel) {
  const keep = new Array(pts.length).fill(false);
  const stack = [];
  const marks = extremes(pts, minTravel);
  for (let m = 0; m + 1 < marks.length; m++) { keep[marks[m]] = keep[marks[m + 1]] = true; stack.push([marks[m], marks[m + 1]]); }
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const [t0, p0] = pts[lo], [t1, p1] = pts[hi];
    const span = t1 - t0;
    let worst = -1, at = -1;
    for (let k = lo + 1; k < hi; k++) {
      const [t, p] = pts[k];
      const err = Math.abs(p - (p0 + (p1 - p0) * (span ? (t - t0) / span : 0)));
      if (err > worst) { worst = err; at = k; }
    }
    if (worst > tolerance) { keep[at] = true; stack.push([lo, at], [at, hi]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function dropWobble(pts, minTravel) {
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    const out = [];
    const n = pts.length;
    let i = 0;
    while (i < n) {
      if (i + 1 < n) {
        const [ta, a] = pts[i], [tb, b] = pts[i + 1];
        const travel = Math.abs(b - a);
        const hold = travel < SMOOTH_FLAT && tb - ta >= SMOOTH_HOLD_MS;
        const prev = out.length ? out[out.length - 1][1] : null;
        const nxt = i + 2 < n ? pts[i + 2][1] : null;
        if (travel < minTravel && !hold && prev !== null && nxt !== null) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          if (prev < lo - 1e-9 && nxt < lo - 1e-9) { out.push(a >= b ? pts[i] : pts[i + 1]); i += 2; changed = true; continue; }
          if (prev > hi + 1e-9 && nxt > hi + 1e-9) { out.push(a <= b ? pts[i] : pts[i + 1]); i += 2; changed = true; continue; }
          if (sign(a - prev) !== sign(b - a) && sign(b - a) !== sign(nxt - b)) { i += 2; changed = true; continue; }
        }
      }
      out.push(pts[i]);
      i += 1;
    }
    if (out[out.length - 1] !== pts[n - 1]) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

function minSegments(pts, minMs) {
  if (minMs <= 0) return pts;
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    const out = [pts[0]];
    const n = pts.length;
    let i = 1;
    while (i < n - 1) {
      const here = pts[i];
      const last = out[out.length - 1];
      if (here[0] - last[0] < minMs) {
        const turn = isTurn(last, here, pts[i + 1]);
        if (turn && out.length > 1 && !isTurn(out[out.length - 2], last, here)) { out.pop(); changed = true; continue; }
        const later = out[out.length - 1][0] + minMs;
        if (turn && pts[i + 1][0] - later >= minMs) { out.push([later, here[1]]); i += 1; }
        else if (turn && i + 1 < n - 1 && isTurn(here, pts[i + 1], pts[i + 2])) i += 2;
        else i += 1;
        changed = true;
        continue;
      }
      out.push(here);
      i += 1;
    }
    const end = pts[n - 1];
    if (out.length > 1 && end[0] - out[out.length - 1][0] < minMs) { out.pop(); changed = true; }
    out.push(end);
    pts = out;
  }
  return pts;
}

// [[ms, pos 0-100], ...] -> a cleaned copy (same start and end).
export function smoothPoints(points, { tolerance = SMOOTH_TOLERANCE, minTravel = SMOOTH_MIN_TRAVEL, minSegmentMs = SMOOTH_MIN_SEGMENT_MS } = {}) {
  let pts = clean(points || []);
  if (pts.length <= 2) return pts;
  pts = shape(pts, tolerance, minTravel);
  pts = dropWobble(pts, minTravel);
  return minSegments(pts, minSegmentMs);
}

// Funscript actions [{at, pos}] -> cleaned actions (whole numbers).
export function smoothActions(actions, opts) {
  return smoothPoints((actions || []).map((a) => [a.at, a.pos]), opts).map(([at, pos]) => ({ at: Math.round(at), pos: Math.round(pos) }));
}

// A script's cleaned actions for a stroker playing it at `rate` (cached).
const CACHE = new WeakMap();
export function smoothedFor(actions, rate = 1) {
  if (!Array.isArray(actions) || actions.length < 3) return actions;
  let byRate = CACHE.get(actions);
  if (!byRate) CACHE.set(actions, byRate = new Map());
  const key = Math.round((rate || 1) * 100);
  if (!byRate.has(key)) byRate.set(key, smoothActions(actions, { minSegmentMs: SMOOTH_MIN_SEGMENT_MS * (rate || 1) }));
  return byRate.get(key);
}
