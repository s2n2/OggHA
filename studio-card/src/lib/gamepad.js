// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Game controller. Up/down move the level at the chosen speed while held,
// left/right step that speed, buttons start/stop recording, zero the level
// and (two motors) pick which motor the controller drives. A binding is a
// button {b}, an axis direction {a, d} (analog sticks are proportional) or
// a key {k} for controllers in keyboard mode.
export const GP_SPEEDS = [15, 30, 60, 100, 180, 300];   // % per second while held
export const GP_SPEED_DEFAULT = 3;
export const GP_ACTIONS = ['up', 'down', 'left', 'right', 'rec', 'zero', 'motor', 'panic'];
export const GP_LABELS = { up: 'Up (level up)', down: 'Down (level down)', left: 'Left (slower)', right: 'Right (faster)', rec: 'Record start/stop', zero: 'Level to 0', motor: 'Switch motor', panic: 'Stop everything' };
export const GP_DEFAULT_MAP = {
  up: [{ b: 12 }, { a: 1, d: -1 }, { k: 'ArrowUp' }],
  down: [{ b: 13 }, { a: 1, d: 1 }, { k: 'ArrowDown' }],
  left: [{ b: 14 }, { a: 0, d: -1 }, { k: 'ArrowLeft' }],
  right: [{ b: 15 }, { a: 0, d: 1 }, { k: 'ArrowRight' }],
  rec: [{ b: 0 }, { k: 'Enter' }, { k: 'MediaPlayPause' }],
  zero: [{ b: 1 }, { k: 'Escape' }, { k: 'Backspace' }],
  motor: [{ b: 3 }],
  panic: [{ b: 8 }],
};
export const GP_MAP_KEY = 'oggstudio_pad_map';
export const GP_SPEED_KEY = 'oggstudio_pad_speed';
export const GP_ON_KEY = 'oggstudio_pad_on';
export const GP_DEAD = 0.25;
export const GP_POLL_MS = 20;
export const GP_HAT_TOL = 0.12;        // hat switch: one axis, one value per direction
export const GP_REST_SAMPLES = 40;     // ~0.8 s of hands-off readings when learning
export const GP_HOLD_ACTIONS = ['up', 'down', 'left', 'right', 'zero', 'motor', 'panic'];

// How hard one action is pressed, 0..1.
export function gpStrength(binds, pad, keys) {
  let best = 0;
  for (const bind of binds || []) {
    let v = 0;
    if (bind.k !== undefined) v = keys && keys.has(bind.k) ? 1 : 0;
    else if (!pad) continue;
    else if (bind.b !== undefined) { const btn = pad.buttons && pad.buttons[bind.b]; v = btn && btn.pressed ? 1 : 0; }
    else if (bind.a !== undefined && bind.v !== undefined) v = Math.abs(((pad.axes && pad.axes[bind.a]) ?? 99) - bind.v) < GP_HAT_TOL ? 1 : 0;
    else if (bind.a !== undefined) {
      const dead = bind.z || GP_DEAD;
      const raw = (((pad.axes && pad.axes[bind.a]) || 0) - (bind.r || 0)) * bind.d;
      v = raw > dead ? (raw - dead) / (1 - dead) : 0;
    }
    best = Math.max(best, Math.min(1, v));
  }
  return best;
}

export function gpRead(map, pad, keys) {
  const out = {};
  for (const action of Object.keys(map)) out[action] = gpStrength(map[action], pad, keys);
  return out;
}

// New level after dtMs with up/down held (strengths 0..1).
export function gpStep(level, up, down, speed, dtMs) {
  return Math.min(100, Math.max(0, level + (up - down) * speed * Math.min(dtMs, 100) / 1000));
}

// Learning, step 1: hands off. Each axis's resting value and how much it
// jitters, from a run of axis readings.
export function gpCalibrate(samples) {
  const len = Math.max(0, ...samples.map((x) => x.length));
  const rest = [], noise = [];
  for (let i = 0; i < len; i++) {
    const vals = samples.map((x) => x[i] || 0);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    rest.push(mean);
    noise.push(Math.max(0, ...vals.map((v) => Math.abs(v - mean))));
  }
  return { rest, noise };
}

// How far an axis must move from rest to count: well clear of its jitter.
export const gpThreshold = (cal, i) => Math.max(0.35, 2 * ((cal && cal.noise[i]) || 0) + 0.2);
export const round2 = (v) => Math.round(v * 100) / 100;

// Learning, later steps: what is being held right now? A pressed button
// (other than the Record button used to confirm), else the axis furthest
// beyond its own jitter. Hat switches (one axis resting outside -1..1,
// a value per direction) bind to that value; other axes to a direction,
// measured from their resting point.
export function gpPickInput(pad, cal, confirmButton) {
  if (!pad) return null;
  const b = gpFirstButton(pad, confirmButton, cal && cal.stuck);
  if (b >= 0) return { b };
  const axes = pad.axes || [];
  let best = -1, score = 1;
  for (let i = 0; i < axes.length; i++) {
    const s = Math.abs(axes[i] - ((cal && cal.rest[i]) || 0)) / gpThreshold(cal, i);
    if (s > score) { score = s; best = i; }
  }
  if (best < 0) return null;
  const v = axes[best], rest = (cal && cal.rest[best]) || 0;
  if (Math.abs(rest) > 1.05) return { a: best, v: round2(v) };
  const bind = { a: best, d: v > rest ? 1 : -1 };
  if (Math.abs(rest) > 0.05) bind.r = round2(rest);
  const dead = round2(Math.max(GP_DEAD, ((cal && cal.noise[best]) || 0) + 0.1));
  if (dead > GP_DEAD) bind.z = dead;
  return bind;
}

// First pressed button, skipping `except` and any button that reads as
// pressed all the time (some pads report one permanently).
export function gpFirstButton(pad, except, stuck) {
  const buttons = (pad && pad.buttons) || [];
  for (let i = 0; i < buttons.length; i++) {
    if (i !== except && buttons[i] && buttons[i].pressed && !(stuck && stuck.includes(i))) return i;
  }
  return -1;
}

export const gpPressed = (pad) => [...((pad && pad.buttons) || [])].map((b, i) => (b && b.pressed ? i : -1)).filter((i) => i >= 0);

// Of several gamepads (Android often lists extra input devices), the one
// the user last pressed a button on; before that, a standard-mapped one,
// else the one with the most buttons.
export function gpChoosePad(pads, lastActive) {
  const live = pads.filter((p) => p && p.connected);
  return live.find((p) => p.index === lastActive)
    || live.find((p) => p.mapping === 'standard')
    || live.sort((a, b) => (b.buttons || []).length - (a.buttons || []).length)[0] || null;
}

// One line of what a pad reads now, for the raw readout and the log.
export const gpRaw = (pad) => (!pad ? 'no gamepad' : `#${pad.index} "${String(pad.id).slice(0, 40)}" ${pad.mapping || 'no-mapping'} · pressed [${gpPressed(pad).join(',')}] · axes ${[...pad.axes].map((v, i) => `${i}:${v.toFixed(2)}`).join(' ')}`);

export const gpDescribe = (b) => (!b ? 'default' : b.k !== undefined ? `key ${b.k}` : b.b !== undefined ? `button ${b.b}`
  : b.v !== undefined ? `hat axis ${b.a} at ${b.v}` : `axis ${b.a} ${b.d > 0 ? '+' : '-'}`);

// Turn learned bindings into a full map: a learned action uses what was
// learned plus its default keyboard keys, the rest keep their defaults;
// anything learned for one action is dropped from the others.
export function gpBuildMap(learned, defaultMap = GP_DEFAULT_MAP) {
  const key = (b) => JSON.stringify(b);
  const taken = new Set(Object.values(learned).flat().map(key));
  const map = {};
  for (const action of Object.keys(defaultMap)) {
    const own = learned[action] && learned[action].length ? learned[action] : [];
    // Once anything is learned, default stick axes go: on a pad whose axes
    // rest off-centre or jitter they would fire on their own.
    const defaults = defaultMap[action].filter((b) => !taken.has(key(b))
      && (own.length ? b.k !== undefined : !(taken.size && b.a !== undefined)));
    map[action] = [...own, ...defaults];
  }
  return map;
}

// Which card section the controller drives: video recording when a video
// is loaded in this card, otherwise the Record pads.
export function gpTargetFor(parts, hasVideo) {
  if (parts.includes('video') && hasVideo) return 'video';
  if (parts.includes('stroke')) return 'stroke';
  if (parts.includes('record')) return 'record';
  return null;
}

// Stroke recorder controls: hold a speed to stroke, set or reset limits.
export const ST_ACTIONS = ['rec', 'slow', 'med', 'fast', 'limit', 'reset', 'panic'];
export const ST_LABELS = { rec: 'Record start/stop', slow: 'Slow stroke (hold)', med: 'Medium stroke (hold)', fast: 'Fast stroke (hold)', limit: 'Set range limit', reset: 'Reset range limits', panic: 'Stop everything' };
export const ST_DEFAULT_MAP = {
  rec: [{ b: 0 }, { k: 'Enter' }, { k: 'MediaPlayPause' }],
  slow: [{ b: 14 }, { k: 'ArrowLeft' }],
  med: [{ b: 13 }, { k: 'ArrowDown' }],
  fast: [{ b: 15 }, { k: 'ArrowRight' }],
  limit: [{ b: 12 }, { b: 2 }, { k: 'ArrowUp' }, { k: 'Space' }],
  reset: [{ b: 1 }, { k: 'Escape' }, { k: 'Backspace' }],
  panic: [{ b: 8 }],
};
// Which actions a controller profile has, and where its learned map lives.
export const GP_PROFILES = {
  level: { actions: GP_ACTIONS, labels: GP_LABELS, defaults: GP_DEFAULT_MAP, hold: GP_HOLD_ACTIONS, mapKey: GP_MAP_KEY },
  stroke: { actions: ST_ACTIONS, labels: ST_LABELS, defaults: ST_DEFAULT_MAP, hold: ['slow', 'med', 'fast', 'limit', 'reset', 'panic'], mapKey: 'oggstudio_pad_map_stroke' },
};
export const gpState = { owner: null };   // with several OggStudio cards on screen, only one listens
