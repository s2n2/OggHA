// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Run modes: how a stroke script (pos = position) becomes vibration
// intensity at playback. Stroke scripts are stored as they are; the same
// maths runs in Home Assistant (convert.py) for saved scripts.
export const RUN_MODES = {
  speed: 'Speed: faster strokes vibrate harder',
  position: 'Position: higher = stronger (vibration scripts)',
  upper: 'Position above 50%: 50% and below = off, 75% = half power',
  combo: 'Speed + position combined',
  down: 'Speed, downstrokes only',
  up: 'Speed, upstrokes only',
};
export const RUN_MODE_DEFAULT = 'speed';
export const runModeOptions = () => Object.entries(RUN_MODES).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
export const isStroke = (script) => Boolean(script && script.metadata && script.metadata.type === 'stroke');
// File names: the funscript convention for a vibration track is "name.vib.funscript"
// (stroke: plain "name.funscript"), so the type survives outside OggStudio.
export const VIB_FILE = /\.vib\.(funscript|json)$/i;
export const fileKind = (name, kind) => (kind === 'auto' && VIB_FILE.test(name || '') ? 'vibration' : kind);
export const fileTitle = (name) => String(name || '').replace(/(\.vib)?\.(funscript|json)$/i, '');

// Speed of a move as intensity: a full 0-100 stroke in a quarter second
// (400 %/s) = 100%.
export const speedIntensity = (dpos, dtMs) => (dtMs > 0 ? Math.min(100, Math.abs(dpos) / dtMs * 250) : 0);

// Intensity for one move of a stroke script. Combined: speed sets the
// strength and position fills up to 35% of what is left above it, so fast
// strokes still reach 100%, slow deep strokes and holds high up still
// register, and nothing jumps when a stroke turns round.
export function moveIntensity(mode, from, to, dtMs) {
  const s = speedIntensity(to - from, dtMs);
  if (mode === 'down') return to < from ? s : 0;
  if (mode === 'up') return to > from ? s : 0;
  if (mode === 'combo') return s + (100 - s) * 0.35 * ((from + to) / 2) / 100;
  return s;
}

// Position above 50% as power: 50 and below = 0, then 0-100 over the top half.
export const upperHalf = (pos) => Math.max(0, Math.round((pos - 50) * 2));

export const cleanActions = (actions) => (Array.isArray(actions) ? actions : [])
  .filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.pos))
  .map((x) => ({ at: Math.max(0, Math.round(x.at)), pos: Math.round(Math.min(100, Math.max(0, x.pos))) }))
  .sort((x, y) => x.at - y.at);

// Stroke actions -> vibration intensity. Each move holds its intensity
// for the whole move (a step, not a ramp), ending at 0.
export function toIntensity(actions, mode) {
  const a = cleanActions(actions);
  if (mode === 'upper') return a.map((x) => ({ at: x.at, pos: upperHalf(x.pos) }));
  if (!RUN_MODES[mode] || mode === 'position' || a.length < 2) return a;
  const out = [];
  const push = (at, pos) => {
    const last = out[out.length - 1];
    if (last && last.at >= at) last.pos = pos; else out.push({ at, pos });
  };
  for (let i = 1; i < a.length; i++) {
    const v = Math.round(moveIntensity(mode, a[i - 1].pos, a[i].pos, a[i].at - a[i - 1].at));
    push(a[i - 1].at, v);
    if (a[i].at - a[i - 1].at > 1) push(a[i].at - 1, v);
  }
  push(a[a.length - 1].at, 0);
  return out;
}

// A script ready for a vibration device: stroke scripts converted with
// the run mode, vibration scripts unchanged.
export function runScript(script, mode) {
  if (!isStroke(script)) return script;
  const out = { ...script, actions: toIntensity(script.actions, mode), metadata: { ...script.metadata, type: 'vibration' } };
  if (script.channels && script.channels.V1) out.channels = { V1: { actions: toIntensity(script.channels.V1.actions, mode) } };
  return out;
}

// Imported scripts. kind: 'stroke' (positions, converted at playback),
// 'vibration' (pos = intensity) or 'auto' (what the script says it is,
// else stroke: most funscripts are made for stroke devices).
export function normalise(input, kind, inverted) {
  const type = kind === 'auto' ? (input.metadata && input.metadata.type === 'vibration' ? 'vibration' : 'stroke') : kind;
  const flip = (acts) => (inverted ? acts.map((x) => ({ at: x.at, pos: 100 - x.pos })) : acts);
  const script = { version: '1.0', inverted: false, range: 100, actions: flip(cleanActions(input.actions)) };
  const v1 = input.channels && (input.channels.V1 || input.channels.v1);
  if (v1 && Array.isArray(v1.actions)) script.channels = { V1: { actions: flip(cleanActions(v1.actions)) } };
  if (!script.actions.length) throw new Error('The script has no actions');
  script.metadata = { creator: 'OggStudio', type, ...(input.metadata && input.metadata.title ? { title: String(input.metadata.title) } : {}) };
  return script;
}

// Live: intensity now from position and velocity (% per second).
export function liveIntensity(mode, pos, vel) {
  if (mode === 'position') return pos;
  if (mode === 'upper') return upperHalf(pos);
  return moveIntensity(mode, pos - vel / 10, pos, 100);   // the last 100 ms of movement
}
