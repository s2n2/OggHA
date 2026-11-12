// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Stroke recorder. Holding (or latching) a speed strokes between the lower
// and upper limits at that device speed, whatever the range: a speed is a
// % of top speed, and 100% = a full 0-100 stroke in a quarter second
// (400 units/s, the same scale as the Speed run mode).
export const STROKE_TOP = 400;   // position units per second at 100%
export const STROKE_SPEEDS = [{ name: 'Slow', pct: 30 }, { name: 'Medium', pct: 55 }, { name: 'Fast', pct: 100 }];
export const STROKE_PCT_MIN = 5;   // the Handy's slowest smooth speed is about 8% (32 mm/s)
export const okPct = (v) => Number.isInteger(v) && v >= STROKE_PCT_MIN && v <= 100;
export const STROKE_SPEED_KEY = 'oggstudio_stroke_speeds';
export const strokeVel = (pct) => pct / 100 * STROKE_TOP / 1000;               // units per ms
export const STROKE_MODE_KEY = 'oggstudio_stroke_mode';
export const STROKE_LIMIT_KEY = 'oggstudio_stroke_limits';

// Move for dtMs at vel (units per ms). Returns the new position and
// direction, and each turn (a limit reached) with how far through dtMs it
// happened. Outside the range it heads into it at the same speed.
export function strokeStep(pos, dir, lower, upper, vel, dtMs) {
  const span = upper - lower;
  if (span < 1) return { pos, dir, turns: [] };
  if (pos < lower) dir = 1; else if (pos > upper) dir = -1;
  const total = vel * Math.min(dtMs, 100);
  let left = total;
  const turns = [];
  for (let guard = 0; guard < 64 && left > 1e-9; guard++) {
    const target = dir > 0 ? upper : lower;
    const dist = (target - pos) * dir;
    if (left < dist) { pos += left * dir; left = 0; break; }
    pos = target; left -= dist; dir = -dir;
    turns.push({ pos: target, frac: (total - left) / total });
  }
  return { pos, dir, turns };
}

// Set limit: the new limit pairs with the one set before it (since the
// last reset): above it = the upper limit, below = the lower. The first
// one after a reset replaces whichever end is nearer.
export function strokeSetLimit(lim, pos) {
  const p = Math.round(Math.min(100, Math.max(0, pos)));
  const keep = lim.last ? lim[lim.last] : (Math.abs(p - lim.lower) <= Math.abs(p - lim.upper) ? lim.upper : lim.lower);
  if (Math.abs(p - keep) < 2) return null;   // both limits in one place: no range
  return p > keep ? { lower: keep, upper: p, last: 'upper' } : { lower: p, upper: keep, last: 'lower' };
}
export const STROKE_LIMITS_RESET = { lower: 0, upper: 100, last: null };
