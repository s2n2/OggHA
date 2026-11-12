// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// Screen off: a pattern, mood, Library script or queue keeps playing when
// the phone's screen turns off (or the app goes to the background).
//
// While the page is shown, the card drives the devices live as always. When
// it is hidden, the card plays what is playing ahead in time, all at once,
// with its own code (the same follow modes, limits and stroke range), and
// hands each device's timeline to Ogg, which plays it in Home Assistant:
// vibration through ogg.play_script, a stroker through its linear runner.
// When the page is shown again the card carries on from where Ogg is.
//
// Not with a video or sound (they need the phone) or a Together partner.
import { RandomProgram } from '../lib/patterns.js';
import { duration } from '../lib/core.js';
import { limitMove } from '../lib/limits.js';

export const SO_STEP_MS = 40;                  // the card's ticks, played ahead
export const SO_AHEAD_MS = 10 * 60 * 1000;     // a pattern or mood: 10 minutes, looped
export const SO_SCRIPT_MAX_MS = 60 * 60 * 1000;
export const SO_MAX_S = 60 * 60;               // looping stops after an hour without the phone

const clamp = (v) => Math.min(100, Math.max(0, v));

// Fewer points, same shape (within `tol`): Ramer-Douglas-Peucker on [{at, pos}].
export function simplify(points, tol = 1) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = points[a], pb = points[b];
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const f = pb.at === pa.at ? 0 : (p.at - pa.at) / (pb.at - pa.at);
      const d = Math.abs(p.pos - (pa.pos + (pb.pos - pa.pos) * f));
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((p, i) => keep[i]);
}

// Levels sent now and then -> a timeline. Ogg ramps between points, as the
// live levels (every 100 ms) did; a level that stayed put is held, then steps.
export function levelTrack(sends, motor, end) {
  const out = [];
  let last = null;
  for (const s of sends) {
    const pos = Math.round((s.lv[motor] ?? s.lv[0]) * 100);
    if (last !== null && pos === last) continue;
    const prev = out[out.length - 1];
    if (prev && s.at - prev.at > 150) out.push({ at: Math.round(s.at) - 1, pos: last });
    out.push({ at: Math.round(s.at), pos });
    last = pos;
  }
  if (out.length && end > out[out.length - 1].at) out.push({ at: Math.round(end), pos: last });
  return simplify(out, 1);
}

// Stroker moves ("go to goal over dur", a newer one may cut one short) ->
// the positions it passes through and when.
export function moveTrack(moves, end) {
  const out = [];
  let pos = moves.length ? moves[0].goal : 0;
  moves.forEach((m, k) => {
    const next = moves[k + 1];
    const arrive = m.at + Math.max(20, m.dur);
    if (next && next.at < arrive) {
      pos += (m.goal - pos) * (next.at - m.at) / (arrive - m.at);
      out.push({ at: Math.round(next.at), pos: Math.round(pos * 10) / 10 });
    } else {
      out.push({ at: Math.round(arrive), pos: m.goal });
      pos = m.goal;
      if (next && next.at > arrive) out.push({ at: Math.round(next.at), pos });   // waits there
    }
  });
  if (out.length && end > out[out.length - 1].at) out.push({ at: Math.round(end), pos });
  // Nothing past the end (a loop must be exactly as long as the rest).
  const cut = out.findIndex((p) => p.at > end);
  if (cut > 0) {
    const p0 = out[cut - 1], p1 = out[cut];
    out.splice(cut, out.length - cut, { at: Math.round(end), pos: p0.pos + (p1.pos - p0.pos) * (end - p0.at) / (p1.at - p0.at) });
  } else if (cut === 0) out.splice(1);
  const clean = out.filter((p, i) => i === 0 || p.at > out[i - 1].at);
  return simplify(clean, 1).map((p) => ({ at: p.at, pos: Math.round(clamp(p.pos)) }));
}

export class ScreenOffPart {
  _soBind() {
    if (this._soVis) return;
    this._soVis = () => {
      if (document.visibilityState === 'hidden') this._soHide();
      else this._soBack();
    };
    document.addEventListener('visibilitychange', this._soVis);
  }

  // What is playing that Ogg can carry on by itself, if anything.
  _soSource() {
    if (!this._hass || !this._outs || !this._el || !this.isConnected) return null;
    if (performance.now() < (this._holdUntil || 0)) return null;
    const video = this._el('video');
    if (video && !video.paused) return null;                 // a video: the phone plays it
    if (this._auTimer) return null;                          // sound: the phone listens
    if (this._tg && this._tg.joined) return null;            // Together: the partner is live
    if (this._pt) return 'pt';
    if (this._rp && this._rp.playing && this._rp.raw) return 'rp';
    return null;
  }

  _soHide() {
    if (this._so) return;
    const kind = this._soSource();
    if (!kind) return;
    let plan;
    try { plan = this._soRender(kind); } catch (e) { console.warn('Ogg Studio: screen-off playback could not be prepared', e); return; }
    if (!plan.tracks.size) return;
    this._so = { ...plan, kind, t0: performance.now(), devs: [...plan.tracks.values()].map((t) => t.dev) };
    // Each device's timeline to Ogg (it replaces the live control).
    for (const tr of plan.tracks.values()) {
      const common = { entity_id: tr.dev.stop, loop: plan.loop, ...(plan.loop ? { max_seconds: SO_MAX_S } : {}) };
      const vibe = tr.vibe.length ? [0, 1].slice(0, tr.dev.dual ? 2 : 1).map((m) => levelTrack(tr.vibe, m, plan.len)) : null;
      if (vibe && vibe[0].length) {
        const script = { actions: vibe[0] };
        if (vibe[1] && vibe[1].length) script.channels = { V1: { actions: vibe[1] } };
        this._hass.callService('ogg', 'play_script', { ...common, script, output: 'vibrate' }, undefined, false).catch(() => {});
      }
      const lin = tr.lin.length ? moveTrack(tr.lin, plan.len) : null;
      if (lin && lin.length) this._hass.callService('ogg', 'play_script', { ...common, script: { actions: lin }, output: 'linear' }, undefined, false).catch(() => {});
    }
    if (this._mediaShow) this._mediaShow();
  }

  // Shown again: carry on here from where Ogg is.
  _soBack() {
    const so = this._so;
    if (!so) return;
    this._so = null;
    const gone = performance.now() - so.t0;
    const at = so.loop ? gone % so.len : gone;
    this._outLast = {};
    this._linLast = {};
    if (so.kind === 'rp' && this._rp) {
      if (!so.loop && at >= so.len) {
        // It finished while the screen was off.
        if (this._pl && this._pl.on) { this._pl.on = false; this._pl.i = -1; if (this._plShow) this._plShow(); }
        this._mood = null;
        this._rpStop();
        this._toast('Finished while the screen was off.');
      } else {
        const cp = [...so.cps].reverse().find((c) => c.at <= at) || so.cps[0];
        if (cp) {
          const rp = this._rp;
          Object.assign(rp, { raw: cp.raw, name: cp.name, len: cp.len, lib: cp.lib, convs: cp.raw === rp.raw ? rp.convs : {} });
          const t = cp.t + (at - cp.at) * cp.speed;
          rp.t = t >= cp.len ? (so.loop && cp.len > 0 ? t % cp.len : cp.len) : t;
          rp.last = performance.now();
          this._mood = cp.mood ? { ...cp.mood } : null;
          if (this._pl && cp.pl !== null) this._pl.i = cp.pl;
          this._rpShow();
          if (this._plShow) this._plShow();
        }
      }
    }
    // A device Ogg was playing that this card no longer drives: stop it.
    setTimeout(() => {
      if (this._so) return;
      for (const dev of so.devs) {
        if (!this._outLast[dev.id] && !this._linLast[dev.id]) this._quietStop(dev);
      }
    }, 600);
    if (this._mediaShow) this._mediaShow();
  }

  // Stop Ogg's timelines (the page is closing, or Stop all).
  _soEnd() {
    const so = this._so;
    if (!so) return;
    this._so = null;
    for (const dev of so.devs) this._quietStop(dev);
  }

  // Play what is playing ahead in time with the card's own ticks on a
  // stand-in (the card itself is left as it is), catching what each device
  // would be sent: levels for a vibrator, moves for a stroker.
  _soRender(kind) {
    const real = performance.now;
    const t0 = real.call(performance);
    let vt = t0;
    const sim = Object.create(this);
    const tracks = new Map();
    const track = (dev) => {
      if (!tracks.has(dev.id)) tracks.set(dev.id, { dev, vibe: [], lin: [] });
      return tracks.get(dev.id);
    };
    // Its own copies of what the ticks change.
    Object.assign(sim, {
      _vals: [...(this._vals || [0, 0])], _padPrev: [null, null], _padVel: [0, 0], _padActive: [false, false],
      _outLast: {}, _linLast: {}, _aiLive: [], _aiLabels: [], _claimed: new Map(), _claimAt: {},
      _tg: null, _holdUntil: 0, _stLast: t0, _stOutAt: 0, _outBlocked: this._outBlocked,
      _mood: this._mood ? { ...this._mood } : null,
      _pl: this._pl ? { ...this._pl } : null,
    });
    if (this._st) sim._st = { ...this._st, drag: null, touch: null };
    if (this._pt) {
      const prog = this._pt.prog;
      sim._pt = { ...this._pt, last: t0, outAt: 0, prev: null, shownAt: 0, prog: prog ? new RandomProgram(prog.motors, prog.intensity) : null };
    }
    if (this._rp) sim._rp = { ...this._rp, last: t0, outAt: 0, shownAt: 0, convs: this._rp.convs || {} };
    // What the devices would be sent, caught.
    sim._sendLive = (dev, lv) => { if (this._online(dev)) track(dev).vibe.push({ at: vt - t0, lv }); };
    sim._outLinear = (dev, asked) => {
      const tr = track(dev);
      const last = tr.lin[tr.lin.length - 1];
      const move = limitMove(this._limits(dev), asked, last ? last.goal : null);
      const goal = Math.round(clamp(move.goal));
      if (last && last.goal === goal && vt - t0 - last.at < 1000) return;
      tr.lin.push({ at: vt - t0, goal, dur: Math.max(50, Math.round(move.dur)) });
    };
    sim._outClaim = () => true;
    for (const f of ['_outRender', '_toast', '_toastOnce', '_stShow', '_ptShow', '_rpShow', '_aiLabel', '_mediaShow',
      '_heatShow', '_plShow', '_stRun', '_stHalt', '_outStop', '_quietStop', '_tgShow', '_vlimShow', '_stMark', '_setMode', '_outSave']) sim[f] = () => {};
    sim._setPad = (i, v) => { sim._vals[i] = Math.round(clamp(v)); };
    let ended = false;
    sim._rpStop = () => { ended = true; if (sim._rp) sim._rp.playing = false; };
    // The queue's next one, from the scripts fetched when it started.
    sim._plNext = () => {
      const pl = sim._pl;
      let i = pl.i + 1;
      if (i >= pl.items.length) { if (!pl.loop) { ended = true; return; } i = 0; }
      const it = pl.items[i];
      pl.i = i;
      if (it.mood) { sim._mood = { key: it.mood, combo: -1 }; sim._moodNext(false); return; }
      const script = this._plCache && this._plCache.get(it.script);
      if (!script) { ended = true; return; }
      sim._mood = null;
      Object.assign(sim._rp, { raw: script, name: it.script, lib: it.script, len: duration(script), t: 0, convs: {} });
    };
    // How long: a pattern or mood 10 minutes (looped); a script to its end
    // (or once round, looped); a queue to its end.
    const rp = sim._rp;
    const speed = () => sim._rpSpeed();
    let len = SO_AHEAD_MS;
    let loop = true;
    if (kind === 'rp' && !this._mood && !(this._pl && this._pl.on)) {
      const once = (rp.len - (this._el('rploop').checked ? 0 : rp.t)) / speed();
      loop = this._el('rploop').checked;
      len = Math.min(SO_SCRIPT_MAX_MS, Math.max(SO_STEP_MS, loop ? rp.len / speed() : once));
    } else if (kind === 'rp' && this._pl && this._pl.on && !this._pl.loop) {
      len = SO_SCRIPT_MAX_MS;
      loop = false;
    }
    const cps = [];
    const mark = () => {
      const last = cps[cps.length - 1];
      if (last && last.raw === rp.raw) return;
      cps.push({ at: vt - t0, raw: rp.raw, name: rp.name, len: rp.len, lib: rp.lib, t: rp.t, speed: speed(),
        mood: sim._mood ? { ...sim._mood } : null, pl: sim._pl ? sim._pl.i : null });
    };
    if (kind === 'rp') mark();
    performance.now = () => vt;
    try {
      while (vt - t0 < len && !ended) {
        vt += SO_STEP_MS;
        if (kind === 'pt') sim._ptTick();
        else {
          sim._rpTick();
          if (this._strokeKind && rp.playing && !ended) sim._stTick();
          mark();
        }
      }
    } finally {
      performance.now = real;
    }
    const end = Math.min(len, vt - t0);
    if (ended) loop = false;
    return { tracks, len: Math.max(SO_STEP_MS, end), loop, cps };
  }
}
