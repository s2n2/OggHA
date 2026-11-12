// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Outputs: up to two devices (or motors) follow a recorder live. A target
// is "deviceId|motor": motor 0 or 1, b = both motors, l = linear (stroker).
// "none" = record only, "off" = no second output.
export const OUT_KEY = 'oggstudio_outputs';
export const FOLLOW_STROKER = 'stroker';
export const parseTarget = (t) => { const m = /^(.+)\|([01bl])$/.exec(t || ''); return m ? { id: m[1], motor: m[2] } : null; };

// Per-device levels from output values: two outputs on one device become
// one command (motor 1 and motor 2), "both" drives every motor.
export function outLevels(targets, values, devices) {
  const out = new Map();
  targets.forEach((t, i) => {
    const p = parseTarget(t);
    const dev = p && devices.find((d) => d.id === p.id);
    const v = values[i];
    if (!dev || v === null || v === undefined) return;
    const e = out.get(dev.id) || { dev, levels: dev.dual ? [0, 0] : [0], vibe: false, linear: null };
    if (p.motor === 'l') e.linear = v;
    else {
      e.vibe = true;
      if (p.motor === 'b') e.levels = e.levels.map((x) => Math.max(x, v));
      else { const m = Math.min(Number(p.motor), e.levels.length - 1); e.levels[m] = Math.max(e.levels[m], v); }
    }
    out.set(dev.id, e);
  });
  return [...out.values()];
}
export const STROKE_MIN_SPAN = 2;

// Range rail: what a touch at v grabs. Near a limit = that limit, inside
// the band = the whole range, outside = the nearer limit (which jumps there).
export function railGrab(lim, v, tol) {
  const du = Math.abs(v - lim.upper), dl = Math.abs(v - lim.lower);
  if (Math.min(du, dl) <= tol) return du <= dl ? { mode: 'upper' } : { mode: 'lower' };
  if (v > lim.lower && v < lim.upper) return { mode: 'move', off: v - lim.lower };
  return { mode: v > lim.upper ? 'upper' : 'lower' };
}

// New limits while dragging on the rail.
export function railDrag(lim, grab, v) {
  const r = (x) => Math.round(Math.min(100, Math.max(0, x)));
  if (grab.mode === 'upper') return { lower: lim.lower, upper: Math.max(lim.lower + STROKE_MIN_SPAN, r(v)) };
  if (grab.mode === 'lower') return { lower: Math.min(lim.upper - STROKE_MIN_SPAN, r(v)), upper: lim.upper };
  const span = lim.upper - lim.lower;
  const lower = Math.min(100 - span, r(v - grab.off));
  return { lower, upper: lower + span };
}

// Touching the position lane: until the stroker reaches the finger it moves
// no faster than the last speed used (Slow if none), so a touch far from
// where it is never makes it jump. After that it follows the finger.
export function approachStep(pos, target, vel, dtMs) {
  const step = vel * Math.min(dtMs, 100);
  const d = target - pos;
  if (Math.abs(d) <= step) return { pos: target, caught: true };
  return { pos: pos + Math.sign(d) * step, caught: false };
}

// Level (0-100) of a script track at time ms: linear between actions,
// 0 before the first action, holds the last value after the end.
export function sampleAt(actions, ms) {
  if (!actions || !actions.length || ms < actions[0].at) return 0;
  let lo = 0, hi = actions.length - 1;
  if (ms >= actions[hi].at) return actions[hi].pos;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (actions[mid].at <= ms) lo = mid; else hi = mid; }
  const a = actions[lo], b = actions[hi];
  return b.at === a.at ? b.pos : a.pos + (b.pos - a.pos) * (ms - a.at) / (b.at - a.at);
}

// The next action after ms (a stroker heads for it), or null at the end.
export function nextAction(actions, ms) {
  if (!actions || !actions.length || ms >= actions[actions.length - 1].at) return null;
  let lo = 0, hi = actions.length - 1;
  if (ms < actions[0].at) return actions[0];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (actions[mid].at <= ms) lo = mid; else hi = mid; }
  return actions[hi];
}

// Merge recording passes made against a video. A later pass replaces
// whatever earlier passes recorded inside its time span (punch-in).
export function mergePasses(passes) {
  let out = [];
  for (const pass of passes) {
    if (!pass.length) continue;
    const from = pass[0].at, to = pass[pass.length - 1].at;
    out = out.filter((a) => a.at < from || a.at > to).concat(pass);
  }
  out.sort((a, b) => a.at - b.at);
  return out.filter((a, i) => i === 0 || a.at !== out[i - 1].at || (out[i - 1] = a, false));
}
