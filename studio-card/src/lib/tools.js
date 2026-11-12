// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { isStroke } from './convert.js';
import { duration } from './core.js';
import { sampleAt } from './outputs.js';

// Script tools: a heatmap of how intense a script is over its length, and
// trim, repeat and stitch. Each returns a new script; the one given is kept.
export const HEAT_FULL_SPEED = 400;      // stroke speed (units/s) that reads as full heat

// Heat (0-1) per bucket: how fast a stroke script moves, how strong a
// vibration script is (the stronger of its two tracks).
export function heatmap(script, buckets) {
  const len = duration(script);
  const out = new Array(buckets).fill(0);
  if (!len || !buckets) return out;
  const tracks = [script.actions];
  if (script.channels && script.channels.V1 && script.channels.V1.actions.length) tracks.push(script.channels.V1.actions);
  const stroke = isStroke(script);
  const step = len / buckets;
  for (const actions of tracks) {
    if (stroke) {
      // Distance travelled inside each bucket, as speed.
      for (let i = 1; i < actions.length; i++) {
        const a = actions[i - 1], b = actions[i];
        const dt = b.at - a.at;
        if (dt <= 0) continue;
        const speed = Math.abs(b.pos - a.pos) / dt * 1000;
        const first = Math.min(buckets - 1, Math.floor(a.at / step)), last = Math.min(buckets - 1, Math.floor((b.at - 0.001) / step));
        for (let k = first; k <= last; k++) {
          const share = (Math.min(b.at, (k + 1) * step) - Math.max(a.at, k * step)) / step;
          out[k] = Math.max(out[k], Math.min(1, speed / HEAT_FULL_SPEED) * Math.min(1, Math.max(0, share) * 1.5));
        }
      }
    } else {
      for (let k = 0; k < buckets; k++) {
        let sum = 0;
        for (let j = 0; j < 4; j++) sum += sampleAt(actions, (k + (j + 0.5) / 4) * step);
        out[k] = Math.max(out[k], sum / 400);
      }
    }
  }
  return out;
}

// Heat as a colour: calm blue, through green and yellow, to hot red.
export function heatColor(v) {
  const x = Math.min(1, Math.max(0, v));
  const hue = 215 - 215 * Math.min(1, x * 1.15);
  return `hsl(${Math.round(hue)},${Math.round(55 + 30 * x)}%,${Math.round(22 + 30 * x)}%)`;
}

const cutTrack = (actions, from, to) => {
  if (!actions.length) return [];
  const inside = actions.filter((a) => a.at > from && a.at < to).map((a) => ({ at: Math.round(a.at - from), pos: a.pos }));
  const edge = (ms) => Math.round(sampleAt(actions, ms));
  return [{ at: 0, pos: edge(from) }, ...inside, { at: Math.round(to - from), pos: edge(to) }];
};

const withTracks = (script, main, second) => {
  const out = { ...script, actions: main };
  delete out.mood;
  delete out.channels;
  if (second && second.length) out.channels = { V1: { actions: second } };
  return out;
};
const secondOf = (script) => (script.channels && script.channels.V1 && script.channels.V1.actions.length ? script.channels.V1.actions : null);

// The part of a script between two times (ms), starting again at 0.
export function trimScript(script, from, to) {
  const len = duration(script);
  const a = Math.min(len, Math.max(0, Math.round(from))), b = Math.min(len, Math.max(0, Math.round(to)));
  if (b - a < 100) throw new Error('Nothing left: keep at least a tenth of a second');
  const second = secondOf(script);
  return withTracks(script, cutTrack(script.actions, a, b), second && cutTrack(second, a, b));
}

const shifted = (actions, by) => actions.map((a) => ({ at: a.at + by, pos: a.pos }));
// One track after another: the second starts `by` ms in; a point at the same
// time as the last one replaces it only when it differs.
const joined = (first, next, by) => {
  const out = first.slice();
  for (const a of shifted(next, by)) {
    const last = out[out.length - 1];
    if (last && a.at <= last.at) { if (a.pos === last.pos) continue; a.at = last.at + 1; }
    out.push(a);
  }
  return out;
};

// A script played n times in a row.
export function loopScript(script, n) {
  const times = Math.min(50, Math.max(1, Math.round(n)));
  const len = duration(script);
  if (!len) throw new Error('The script is empty');
  const second = secondOf(script);
  let main = [], other = [];
  for (let i = 0; i < times; i++) {
    main = joined(main, script.actions, i * len);
    if (second) other = joined(other, second, i * len);
  }
  return withTracks(script, main, second && other);
}

// Script b after script a, with a pause between them.
export function stitchScripts(a, b, gapMs = 500) {
  if (isStroke(a) !== isStroke(b)) throw new Error('A stroke script and a vibration script cannot be joined');
  const by = duration(a) + Math.max(0, Math.round(gapMs));
  const sa = secondOf(a), sb = secondOf(b);
  const second = sa || sb ? joined(sa || a.actions, sb || b.actions, by) : null;
  return withTracks(a, joined(a.actions, b.actions, by), second);
}
