// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Per-device limits: nothing this card sends goes past them, whatever is
// driving (pads, a script, a mood, audio or a remote partner).
//   max    top vibration level, % of full power
//   lo, hi the stroke range a stroker stays inside, %
//   speed  top stroke speed, % of full speed
export const NO_LIMITS = { max: 100, lo: 0, hi: 100, speed: 100 };
export const LIMIT_FULL_SPEED = 400;      // position units per second at 100%

export const limitsFor = (all, stop) => ({ ...NO_LIMITS, ...((all && all[stop]) || {}) });
export const isLimited = (lim) => lim.max < 100 || lim.lo > 0 || lim.hi < 100 || lim.speed < 100;

// Vibration levels (0-100) scaled to the top level.
export const limitLevels = (lim, levels) => levels.map((v) => Math.min(100, Math.max(0, v)) * lim.max / 100);

// A stroker move squeezed into the range and slowed to the top speed.
// `from` is where the stroker was last sent (null = unknown: the far end).
export function limitMove(lim, move, from) {
  const span = lim.hi - lim.lo;
  const goal = lim.lo + Math.min(100, Math.max(0, move.goal)) * span / 100;
  let dur = move.dur;
  if (lim.speed < 100) {
    const start = from === null || from === undefined ? (goal - lim.lo > span / 2 ? lim.lo : lim.hi) : from;
    dur = Math.max(dur, Math.abs(goal - start) / (LIMIT_FULL_SPEED * lim.speed / 100) * 1000);
  }
  return { goal, dur };
}

// What to show for a device's limits ("" when there are none).
export function limitsText(lim) {
  const bits = [];
  if (lim.max < 100) bits.push(`top ${lim.max}%`);
  if (lim.lo > 0 || lim.hi < 100) bits.push(`range ${lim.lo}-${lim.hi}%`);
  if (lim.speed < 100) bits.push(`speed ${lim.speed}%`);
  return bits.join(' · ');
}
