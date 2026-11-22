// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { FOLLOW_AI } from '../lib/ai.js';
import { RUN_MODES, RUN_MODE_DEFAULT, fileKind, fileTitle, isStroke, normalise } from '../lib/convert.js';
import { SAMPLE_MS, SPEEDS, TAKE_SRC, VIDEO_QUEUE, decodeText, duration, encodeCode, esc, fmt } from '../lib/core.js';
import { limitLevels, limitMove } from '../lib/limits.js';
import { FOLLOW_STROKER, OUT_KEY, matchVideoScript, outLevels, parseTarget } from '../lib/outputs.js';
import { STROKE_TOP } from '../lib/stroke.js';
import { gearHtml, openDeviceSettings } from '../lib/devsettings.js';

const MAX_OUTS = 4;
// Live stroker following (see _outLinear).
const FOLLOW_SEND_MS = 60;       // a move every 60 ms (the link carries it: writes land in ~60 ms)
const FOLLOW_DELAY_MS = 40;      // the finger's path is replayed this far behind (+ link + one move = ~0.2 s)
const FOLLOW_OVERLAP_MS = 15;    // each move lasts a touch past the next one, so it never stops between them
const FOLLOW_SMOOTH_MS = 15;     // light finger smoothing (time constant)
const FOLLOW_DEADBAND = 1.5;     // % : a smaller turn back is not sent (a finger's tremor)
const FOLLOW_STEP = 0.9;         // % : on the way, every step about this big is sent (Buttplug moves in whole %)
const FOLLOW_CRAWL_MS = 1000;    // a slow finger's step covers up to this much of its path
const FOLLOW_REST_MS = 150;      // a finger still this long before a step was resting, not creeping
const FOLLOW_PACE_MS = 400;      // a creeping finger's pace is taken over this long
const FOLLOW_KEEP_MS = 1500;     // finger path kept for the replay
const FOLLOW_SETTLE_MS = 150;    // the last move after letting go (at least)
const FOLLOW_MAX_BEHIND_MS = 250; // the replay never falls further behind the finger than this
const LINEAR_TARGET_GAP_MS = 60; // the shortest gap between script moves
const OUT_FOLD_KEY = 'oggstudio_outputs_folded';
const NO_OUT = Object.freeze({ t: 'none', m: 'position', on: true });

// Methods mixed into OggStudioCard.
// The finger's path (filtered [ms, pos] samples) at a time.
function pathAt(hist, t) {
  if (t <= hist[0][0]) return hist[0][1];
  for (let i = 1; i < hist.length; i++) {
    const [t1, p1] = hist[i];
    if (t1 >= t) { const [t0, p0] = hist[i - 1]; return t1 === t0 ? p1 : p0 + (p1 - p0) * (t - t0) / (t1 - t0); }
  }
  return hist[hist.length - 1][1];
}

// The next point of the finger's path to send, between `from` and `until`:
// where it is at `until`, or, if it turned back on the way, the turn (so a
// stroke keeps its depth).
export function followStep(hist, from, until, startPos) {
  const end = pathAt(hist, until);
  let hi = { at: until, pos: end }, lo = { at: until, pos: end };
  for (const [t, p] of hist) {
    if (t <= from || t >= until) continue;
    if (p > hi.pos) hi = { at: t, pos: p };
    if (p < lo.pos) lo = { at: t, pos: p };
  }
  const up = hi.pos - Math.max(startPos, end), down = Math.min(startPos, end) - lo.pos;
  if (up > FOLLOW_DEADBAND && up >= down) return hi;
  if (down > FOLLOW_DEADBAND) return lo;
  return { at: until, pos: end };
}

export class OutputsPart {
  // ---------------------------------------------------------- outputs
  _bindOutputs() {
    const $ = this._el;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(OUT_KEY) || 'null'); } catch (_) { /* private mode */ }
    // Embedded (the Easy card's stroker): its toys come from the Easy card.
    if (this._config && this._config.outputs) saved = this._config.outputs;
    if (saved && Array.isArray(saved.t)) {
      // Up to four devices; "none" and "off" (from the old two-row box) are no device.
      const m = Array.isArray(saved.m) ? saved.m : [];
      const on = Array.isArray(saved.on) ? saved.on : [];
      this._outs = saved.t.map((t, i) => ({ t, m: typeof m[i] === 'string' ? m[i] : 'position', on: on[i] !== false }))
        .filter((o) => o.t !== 'none' && o.t !== 'off' && (o.t === null || typeof o.t === 'string')).slice(0, MAX_OUTS);
    } else this._outs = [{ t: null, m: 'position', on: true }];    // first use: the remembered (or first) device
    let fold = false;
    try { fold = localStorage.getItem(OUT_FOLD_KEY) === '1'; } catch (_) { /* private mode */ }
    this._outFold(fold);
    $('outfold').addEventListener('click', () => this._outFold(!this._outFolded, true));
    $('outadd').addEventListener('click', () => this._outAdd());
    // The rows are drawn from the list; their controls are handled here.
    const rows = $('outrows');
    const at = (e) => { const row = e.target.closest('.outrow'); return row ? Number(row.dataset.row) : -1; };
    rows.addEventListener('change', (e) => {
      const i = at(e);
      if (i < 0 || !this._outs[i]) return;
      if (e.target.classList.contains('outt')) this._outSwitch(i, { t: e.target.value });
      else if (e.target.classList.contains('outm')) this._outSwitch(i, { m: e.target.value });
      else if (e.target.classList.contains('outon')) {
        // Active: this device follows (on by default). Off, it is left alone.
        this._outStop();
        this._outs[i].on = e.target.checked;
        this._outSave();
        if (this._simple) this._el('stlive').checked = this._anyActive;
        this._outRender();
      }
    });
    rows.addEventListener('click', (e) => {
      // The toys as chips (like the Easy card): tap to use one, ⚙ for its settings.
      const gear = e.target.closest('.gear');
      const chip = e.target.closest('.ochip');
      if (gear) { e.stopPropagation(); this._outSettings(gear.dataset.gear); return; }
      if (chip) this._outChip(chip.dataset.dev);
    });
    rows.addEventListener('keydown', (e) => {
      const gear = e.target.closest('.gear');
      if (gear && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); this._outSettings(gear.dataset.gear); }
    });
    this._outRender();
  }

  // Folded: just the count of connected devices.
  _outFold(on, save) {
    this._outFolded = Boolean(on);
    this._el('outbody').hidden = this._outFolded;
    this._el('outfold').setAttribute('aria-expanded', String(!this._outFolded));
    this._el('outbox').classList.toggle('folded', this._outFolded);
    if (this._outFolded) this._el('limbox').hidden = true;
    if (save) { try { localStorage.setItem(OUT_FOLD_KEY, this._outFolded ? '1' : '0'); } catch (_) { /* private mode */ } }
  }

  _outAdd() {
    if (this._outs.length >= MAX_OUTS) return;
    // The next device not already in the list (a stroker as a stroker).
    const used = new Set(this._outs.map((o, i) => (parseTarget(this._outTargetValue(i)) || {}).id));
    const dev = this._devices.find((d) => !used.has(d.id) && this._online(d)) || this._devices.find((d) => !used.has(d.id)) || this._devices[0];   // or one again (its other motor, say)
    const t = dev ? `${dev.id}|${dev.linear && !dev.vibe ? 'l' : 'b'}` : null;
    this._outStop();
    this._outs.push({ t, m: 'position', on: true });
    this._outSave();
    this._outRender();
    if (this._simple && this._outs.length === 1) this._autoKind();
    this._update();
  }

  // Which output (index) a device is, if it is used here (and switched on).
  _outIndexOf(id) {
    return (this._outs || []).findIndex((o, i) => o.on !== false && (parseTarget(this._outTargetValue(i)) || {}).id === id);
  }

  // Tap a toy: use it here (as a stroker if that is all it does), or stop using it.
  _outChip(id) {
    const dev = this._devices.find((d) => d.id === id);
    if (!dev) return;
    const i = this._outIndexOf(id);
    if (i >= 0) {
      if (this._claimedBy(dev)) { this._outTake(i); return; }   // in use elsewhere: take control
      this._outRemove(i);
      return;
    }
    // Forget a switched-off entry for it, then add it (up to four).
    this._outs = this._outs.filter((o, j) => !(o.on === false && (parseTarget(this._outTargetValue(j)) || {}).id === id));
    if (this._outs.length >= MAX_OUTS) { this._toast('Up to four toys at once: tap one to stop using it first.'); this._outRender(); return; }
    this._outStop();
    this._outs.push({ t: `${dev.id}|${dev.linear && !dev.vibe ? 'l' : 'b'}`, m: 'position', on: true });
    this._outSave();
    this._outRender();
    if (this._simple) { this._el('stlive').checked = this._anyActive; if (this._outs.length === 1) this._autoKind(); }
    this._update();
  }

  // ⚙: the toy's settings: how it follows and which motor (when used here), and its limits.
  _outSettings(stop) {
    const dev = this._devices.find((d) => d.stop === stop);
    if (!dev) return;
    const i = this._outIndexOf(dev.id);
    const extra = [];
    if (i >= 0) {
      const p = parseTarget(this._outTargetValue(i));
      const vibe = dev.vibe || !dev.linear;
      const motors = [];
      if (vibe && !dev.dual) motors.push(['b', 'Vibration']);
      if (vibe && dev.dual) motors.push(['b', 'Both motors'], ['0', 'Motor 1'], ['1', 'Motor 2']);
      if (dev.linear) motors.push(['l', 'Stroker']);
      if (motors.length > 1) extra.push({ label: 'Plays', options: motors, value: p.motor, onChange: (v) => { this._outSwitch(i, { t: `${dev.id}|${v}` }); this._outSettings(stop); } });
      const modes = p.motor === 'l'
        ? [[FOLLOW_STROKER, 'Stroker: follows the position'], [FOLLOW_AI, "✨ AI feel: strokes from a vibration's mood"]]
        : [[FOLLOW_AI, "✨ AI feel: patterns from the stroke's mood"], ...Object.entries(RUN_MODES).map(([v, t]) => [v, t.replace(/ \(vibration scripts\)/, '')]), [FOLLOW_STROKER, 'Stroker: level = position']];
      extra.push({ label: 'How it follows a stroke', options: modes, value: this._outs[i].m, onChange: (v) => this._outSwitch(i, { m: v }) });
    }
    openDeviceSettings(this.shadowRoot, {
      hass: this._hass, dev, allLimits: this._limitsAll, extra,
      note: i >= 0 ? '' : 'Not used on this card: tap the toy to use it here.',
      onLimits: (s, lim) => { this._limitsAll = { ...this._limitsAll, [s]: lim }; },
      toast: (t) => this._toast(t),
    });
  }

  _outRemove(i) {
    this._outStop();
    this._outs.splice(i, 1);
    this._outSave();
    this._outRender();
    if (this._simple) this._el('stlive').checked = this._anyActive;
    this._update();
  }

  // An output by place, or a stand-in (no device) where there is none: the
  // two pads always have a first output each (1 and 2; 3 and 4 follow too).
  _outAt(i) { return (this._outs && this._outs[i]) || NO_OUT; }
  get _outIdx() { return Array.from({ length: Math.max(2, this._outs ? this._outs.length : 0) }, (_, i) => i); }

  // Any device switched on (and chosen)?
  get _anyActive() { return Boolean(this._outs) && this._outs.some((o, i) => o.on !== false && parseTarget(this._outTargetValue(i))); }

  _outSave() {
    if (this._config && this._config.outputs) return;   // embedded: never over your own Play card's devices
    try { localStorage.setItem(OUT_KEY, JSON.stringify({ t: this._outs.map((o) => o.t), m: this._outs.map((o) => o.m), on: this._outs.map((o) => o.on !== false) })); } catch (_) { /* private mode */ }
  }

  _outSwitch(i, change) {
    // A device that stops being an output goes quiet (and is released).
    if (!this._outs[i]) return;
    this._outStop();
    Object.assign(this._outs[i], change);
    this._outSave();
    this._outRender();
    if (this._simple && 't' in change && i === 0) this._autoKind();
    this._update();
  }

  // The saved target if it still exists, else a sensible default.
  _outTargetValue(i) {
    const o = this._outs && this._outs[i];
    if (!o) return 'none';
    const t = o.t;
    if (t === 'none' || t === 'off') return 'none';
    const p = parseTarget(t);
    if (p && this._devices.some((d) => d.id === p.id)) return t;
    if (i > 0) return 'none';
    if (!this._registryDone) return 'none';
    const id = this._remembered && this._remembered.id;
    const dev = this._devices.find((d) => d.id === id) || this._devices.find((d) => this._online(d)) || this._devices[0];
    return dev ? `${dev.id}|${dev.linear && !dev.vibe ? 'l' : 'b'}` : 'none';
  }

  _outDevice(i) { const p = parseTarget(this._outTargetValue(i)); return p ? this._devices.find((d) => d.id === p.id) : null; }

  _controllers() {
    const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
    return (saved && saved.attributes.controllers) || {};
  }

  // Driven by another OggStudio card (another phone or browser) right now?
  _claimedBy(dev) {
    const c = dev && this._controllers()[dev.stop];
    if (!c || c.owner === this._owner) return null;
    if (this._tookAt && this._tookAt[dev.stop] && performance.now() - this._tookAt[dev.stop] < 3000) return null;   // we just took it
    return c;
  }

  _outLabel() {
    const ua = navigator.userAgent;
    const where = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'a browser';
    return `${(this._hass && this._hass.user && this._hass.user.name) || 'Someone'} on ${where}`;
  }

  _outClaim(dev) {
    if (this._claimedBy(dev)) return false;
    const now = performance.now();
    this._claimed.set(dev.stop, dev);
    if (!(now - (this._claimAt[dev.stop] || -1e9) < 4000)) {
      this._claimAt[dev.stop] = now;
      this._hass.callService('ogg', 'studio_claim', { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, undefined, false).catch(() => {});
    }
    return true;
  }

  _outTake(i) {
    const dev = this._outDevice(i);
    if (!dev) return;
    this._tookAt = this._tookAt || {};
    this._tookAt[dev.stop] = performance.now();
    this._claimAt[dev.stop] = performance.now();
    this._hass.callService('ogg', 'studio_claim', { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, undefined, false).catch(() => {});
    this._toast(`You now control ${dev.name}.`);
    this._outRender();
  }

  // Send output values (0-100; a stroker may get {goal, dur}) to the devices.
  // `path` 'partner': what a Together partner sends, for my own toys.
  _outApply(values, seconds, path, only) {
    if (!this._hass || !this._outs) return;
    if (this._so && path !== 'partner') return;      // screen off: Ogg plays it (screenoff.js)
    const now = performance.now();
    if (now < (this._holdUntil || 0)) return;       // Stop all was just pressed
    let targets = this._outs.map((o, i) => this._outTargetValue(i));
    values = values.map((v, i) => (this._outs[i] && this._outs[i].on === false ? null : v));   // a device switched off is left alone
    // Together, with my partner's toys picked: my controls play theirs and
    // what they send plays mine; with Sync, both play both.
    const tg = this._tg;
    const partner = tg && tg.joined && tg.partnerAllow !== false && tg.partner && tg.partner.length ? tg.partner : null;
    if (only) {
      // Together's "Their toys" control: just those toys.
      targets = only.slice();
    } else if (partner) {
      const pv = partner.map((t, j) => { const v = values[j % 2]; return v === undefined || v === null ? (values[0] ?? null) : v; });
      if (path !== 'partner') {
        const first = pv.find((v) => v !== null && v !== undefined);
        tg.outLevel = typeof first === 'object' && first ? first.goal : (first || 0);
      }
      // With Sync, my controls play both; without it, my controls stay on my
      // toys and Together's "Their toys" control plays theirs.
      if (tg.sync) { targets = [...targets, ...partner]; values = [...values, ...pv]; }
    } else if (tg && path !== 'partner') {
      const first = values.find((v) => v !== null && v !== undefined);
      tg.outLevel = typeof first === 'object' && first ? first.goal : (first || 0);
    }
    // A stroker's move and a vibrator's level each in their own form.
    values = values.map((v, i) => { const p = parseTarget(targets[i]); return v && typeof v === 'object' && p && p.motor !== 'l' ? v.goal : v; });
    let blocked = false;
    for (const e of outLevels(targets, values, this._devices)) {
      if (!this._outClaim(e.dev)) { blocked = true; continue; }
      if (e.vibe) {
        const lv = limitLevels(this._limits(e.dev), e.levels).map((x) => Math.round(x) / 100);
        const last = this._outLast[e.dev.id];
        if (!last || lv.some((x, j) => Math.abs(x - last.lv[j]) >= 0.01) || now - last.at > 500) {
          this._outLast[e.dev.id] = { lv, at: now };
          this._sendLive(e.dev, lv, seconds);
        }
      }
      if (e.linear !== null) {
        let move = typeof e.linear === 'object' ? e.linear : { goal: e.linear, dur: 150 };
        // On the Play cards a stroker always keeps inside its stroke limits;
        // on Stroke the level is already a place in them, on Vibrate it is
        // scaled into them here.
        if (this._simple && !this._strokeKind) move = { ...move, goal: this._lim(move.goal) };
        this._outLinear(e.dev, move, now);
      }
    }
    if (blocked !== Boolean(this._outBlocked)) { this._outBlocked = blocked; this._outRender(); }
  }

  // Strokers take "go to this position over this long" moves. Ogg's
  // ogg.linear does that live; without it, Ogg's Position control is used
  // (coarse: it moves over a fixed second).
  //
  // Three kinds of move:
  // - target (a script's next point, a held speed's next limit): sent as it is.
  // - follow (a finger, a pad, a level): the finger's own path, replayed
  //   about 0.2 s behind in 60 ms moves. Each move covers exactly the path
  //   the finger took in that time (so the stroker moves at the finger's
  //   speed, never a guess), with a move ending at every turn (so strokes
  //   keep their depth), never faster than the stroker can go. Small changes
  //   (a finger at rest or lifting) are not sent.
  // - settle (the finger let go): one move to where it ended.
  _outLinear(dev, asked, now) {
    const last = this._linLast[dev.id];
    const live = Boolean(this._hass.services && this._hass.services.ogg && this._hass.services.ogg.linear);
    const lim = this._limits(dev);
    const clamp = (x) => Math.round(Math.min(100, Math.max(0, x)));
    const top = (STROKE_TOP / 1000) * (lim.speed < 100 ? lim.speed / 100 : 1);   // units per ms it can go
    this._linFollow = this._linFollow || {};
    let move;
    if (asked.target) {
      this._linFollow[dev.id] = null;
      move = limitMove(lim, asked, last ? last.goal : null);
      const goal = clamp(move.goal);
      if (last && last.goal === goal && now - last.at < 1000) return;
      if (last && now - last.at < (live ? LINEAR_TARGET_GAP_MS : 400)) return;
    } else if (asked.settle) {
      this._linFollow[dev.id] = null;
      move = limitMove(lim, { goal: asked.goal, dur: FOLLOW_SETTLE_MS }, last ? last.goal : null);
      if (!last || Math.abs(clamp(move.goal) - last.goal) < FOLLOW_DEADBAND) return;
      move.dur = Math.max(move.dur, Math.abs(move.goal - last.goal) / top);
    } else {
      const raw = limitMove(lim, { goal: asked.goal, dur: 0 }, null).goal;
      let f = this._linFollow[dev.id];
      if (!f) f = this._linFollow[dev.id] = { pos: raw, at: now, hist: [[now, raw]], tau: null };
      const dt = Math.max(0, now - f.at);
      f.pos += (raw - f.pos) * (1 - Math.exp(-dt / FOLLOW_SMOOTH_MS));
      f.at = now;
      f.hist.push([now, f.pos]);
      while (f.hist.length > 2 && f.hist[1][0] < now - FOLLOW_KEEP_MS) f.hist.shift();
      if (!last) {
        // The first move: straight to the finger (from wherever it is).
        f.tau = now;
        f.sent = f.pos;
        move = { goal: f.pos, dur: FOLLOW_SETTLE_MS };
      } else {
        // Each move lands before the next replaces it: the Handy starts a
        // new move from wherever it is, so a stroke cut short by the next
        // one (sent every 60-80 ms while it took 200) never reached its
        // turn, and fast strokes came out shallow and wandering (measured).
        if (now - last.at < Math.max(live ? FOLLOW_SEND_MS : 400, (last.dur || 0) - FOLLOW_OVERLAP_MS)) return;
        const until = now - FOLLOW_DELAY_MS;
        const sent = f.sent ?? last.goal;
        // Faster than it can go, it skips the finger's smaller wiggles
        // (the biggest turn in the time it was busy wins) and stays close.
        // A finger creeping (a step or so from the last move) is not behind:
        // its step covers all the time it took.
        const creeping = Math.abs(pathAt(f.hist, until) - sent) <= 2 * FOLLOW_STEP;
        const from = Math.max(f.tau === null ? until - FOLLOW_SEND_MS : f.tau, until - (creeping ? FOLLOW_CRAWL_MS : FOLLOW_MAX_BEHIND_MS));
        if (until <= from) return;
        const pick = followStep(f.hist, from, until, last.goal);
        const d = pick.pos - last.goal;
        const dir = Math.sign(d);
        // On the way every whole step goes (a slow finger moves smoothly,
        // not a hop every few hundred ms); a small turn back is tremor.
        // Not sent: the next move covers this bit of path too.
        if (Math.abs(d) < (f.dir && dir !== f.dir ? FOLLOW_DEADBAND : FOLLOW_STEP)) return;
        // Since when the finger has been on its way from the last move: a
        // finger that rested there, then moved, takes only the time it moved.
        let left = from;
        for (const [t, p] of f.hist) {
          if (t > pick.at) break;
          if (t >= from && (p - sent) * dir <= 0.25) left = t;
        }
        let took = pick.at - (left - from > FOLLOW_REST_MS ? left : from);
        // One creeping on: the step at its pace over the last moments, so
        // the steps join up (a screen moves a slow finger a pixel at a time).
        if (creeping) {
          const span = Math.min(FOLLOW_PACE_MS, until - f.hist[0][0]);
          const pace = span > 0 ? Math.abs(pathAt(f.hist, until) - pathAt(f.hist, until - span)) / span : 0;
          if (pace > 0) took = Math.min(took, Math.abs(d) / pace);
        }
        f.tau = pick.at;
        f.sent = pick.pos;
        f.dir = dir;
        // The time the finger took for this bit of path, and never faster than the stroker goes.
        move = { goal: pick.pos, dur: Math.max(took, FOLLOW_SEND_MS, Math.abs(d) / top) + FOLLOW_OVERLAP_MS };
      }
    }
    const goal = clamp(move.goal);
    this._linLast[dev.id] = { goal, at: now, dur: move.dur };
    if (live) this._hass.callService('ogg', 'linear', { entity_id: dev.stop, position: goal, duration: Math.max(50, Math.round(move.dur)) }, undefined, false).catch(() => {});
    else if (dev.linear) this._hass.callService('number', 'set_value', { entity_id: dev.linear, value: goal }, undefined, false).catch(() => {});
  }

  // Stop and release every device this card was driving (not ones another
  // controller has since taken over).
  _outStop() {
    if (this._so) return;                            // screen off: Ogg is playing the timelines
    for (const [stop, dev] of this._claimed) {
      if (this._claimedBy(dev)) continue;
      this._quietStop(dev);
      if (this._hass) this._hass.callService('ogg', 'studio_claim', { entity_id: stop, owner: this._owner, release: true }, undefined, false).catch(() => {});
    }
    this._claimed.clear();
    this._claimAt = {};
    this._outLast = {};
    this._linLast = {};
    this._linFollow = {};
    this._aiLive = [];
  }

  _outRender() {
    if (!this._el || !this._outs) return;
    const $ = this._el;
    const stroke = this._strokeKind;
    const devs = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
    const list = [];
    for (const d of devs) {
      const name = this._online(d) ? d.name : `${d.name} (offline)`;   // (kept for the empty message)
      const vibe = d.vibe || !d.linear;   // a stroker-only device has no vibration
      if (vibe && !d.dual) list.push([`${d.id}|b`, name]);
      if (vibe && d.dual) list.push([`${d.id}|b`, `${name} · both motors`], [`${d.id}|0`, `${name} · motor 1`], [`${d.id}|1`, `${name} · motor 2`]);
      if (d.linear) list.push([`${d.id}|l`, `${name} · stroker`]);
    }
    // The toys as chips: connected ones, plus any used here that are offline.
    const box = $('outrows');
    const n = this._outs.length;
    const labels = ['Pad 1', 'Pad 2'];
    const used = new Map();
    this._outs.forEach((o, i) => {
      const p = parseTarget(this._outTargetValue(i));
      const dev = p && this._devices.find((d) => d.id === p.id);
      if (i < 2) labels[i] = dev ? (p.motor === 'b' ? dev.name : p.motor === 'l' ? `${dev.name} (stroker)` : `${dev.name} m${Number(p.motor) + 1}`) : `Pad ${i + 1}`;
      // Keep each output's follow mode valid for what it plays.
      const strokerOut = p && p.motor === 'l';
      const ok = strokerOut ? [FOLLOW_STROKER, FOLLOW_AI] : [FOLLOW_AI, FOLLOW_STROKER, ...Object.keys(RUN_MODES)];
      if (!ok.includes(o.m)) o.m = strokerOut ? FOLLOW_STROKER : 'position';
      if (dev && o.on !== false && !used.has(dev.id)) used.set(dev.id, i);
    });
    const chips = devs.filter((d) => this._online(d) || used.has(d.id));
    const html = chips.length ? chips.map((d) => {
      const i = used.has(d.id) ? used.get(d.id) : -1;
      const owner = i >= 0 && this._claimedBy(d);
      const pad = i >= 0 && n > 1 ? `<span class="opad" title="Follows pad ${(i % 2) + 1}">${(i % 2) + 1}</span>` : '';
      const kind = d.linear && !d.vibe ? '↕' : '';
      return `<button type="button" class="ochip${i >= 0 ? ' on' : ''}${this._online(d) ? '' : ' off'}${owner ? ' take' : ''}" data-dev="${esc(d.id)}" aria-pressed="${i >= 0}" title="${owner ? `In use (${esc(owner.label || 'elsewhere')}): tap to take control` : i >= 0 ? 'Used here: tap to stop' : 'Tap to use it here'}">${gearHtml(d)}<span class="onm">${esc(d.name)}${kind ? ` <i>${kind}</i>` : ''}</span>${pad}${owner ? '<span class="obusy">in use</span>' : ''}${this._online(d) ? '' : '<span class="obusy">offline</span>'}</button>`;
    }).join('') : `<span class="hint">${list.length && list[0][0] !== 'none' ? 'No toy connected: switch one on.' : 'No device found.'}</span>`;
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
    $('outadd').hidden = true;
    $('limbtn').hidden = true;
    $('limbox').hidden = true;
    $('outhint').hidden = n < 2;
    // The count: devices on, chosen and connected.
    const live = this._outs.filter((o, i) => { if (o.on === false) return false; const d = this._outDevice(i); return Boolean(d && this._online(d)); }).length;
    const cnt = $('outcount');
    cnt.classList.toggle('zero', !live);
    const b = cnt.querySelector('b');
    if (b.textContent !== String(live)) b.textContent = String(live);
    this._padLabels = labels;
    for (const [i, id] of [[0, 'pad1'], [1, 'pad2']]) { const lab = this._el(id).querySelector('.lab'); if (lab.textContent !== labels[i]) lab.textContent = labels[i]; }
    const two = this._twoPads;
    this._el('pad2').hidden = !two;
    this._el('pads').classList.toggle('dual', two);
    const busy = this._devices.some((d) => this._claimedBy(d));
    const note = this._outBlocked ? 'A device is being controlled from another phone or browser: it does not follow here until you take control.'
      : busy ? 'Some devices are in use elsewhere.' : '';
    if (this._el('outnote').textContent !== note) this._el('outnote').textContent = note;
  }



  _startRecording() {
    const $ = this._el;
    this._recording = true;
    this._t0 = performance.now();
    this._samples = [[], []];
    this._last = [null, null];
    const sample = () => {
      const t = Math.round(performance.now() - this._t0);
      this._levels().forEach((v, i) => {
        const pos = Math.round(v * 100);
        if (pos !== this._last[i]) { this._samples[i].push({ at: t, pos }); this._last[i] = pos; }
      });
      $('timer').textContent = fmt(t);
    };
    sample();
    this._sampleTimer = setInterval(sample, SAMPLE_MS);
    this._setLive(true);
    this._update();
  }

  _stopRecording() {
    const $ = this._el;
    clearInterval(this._sampleTimer);
    const t = Math.round(performance.now() - this._t0);
    this._recording = false;
    this._setLive($('live').checked);
    for (const i of [0, 1]) if (this._samples[i].length) { this._samples[i].push({ at: t, pos: this._last[i] }); this._samples[i].push({ at: t + 1, pos: 0 }); }
    const take = { version: '1.0', inverted: false, range: 100, actions: this._samples[0], metadata: { creator: 'OggStudio', type: 'vibration' } };
    if (this._twoPads && this._samples[1].length) take.channels = { V1: { actions: this._samples[1] } };
    this._take = take.actions.length ? take : null;
    $('timer').textContent = '';
    this._setPad(0, 0); this._setPad(1, 0);
    this._update();
  }

  // Take and library playback run through Replay: the devices above,
  // each following its own way, and the pads or bar show it.
  _play(script) { this._playScript(script, 'Current take', null); }

  async _playSaved() {
    if (this._simple && this._libPick === 'take' && this._take) { this._play(this._take); return; }
    if (this._simple && this._libPick === 'loaded' && this._rp.raw) { this._playScript(this._rp.raw, this._rp.name, null); return; }
    const name = this._el('saved').value;
    try { this._playScript(await this._getSaved(name), name, name); } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); }
  }

  _playScript(script, name, lib) {
    if (!script) return;
    this._plOff();
    this._setCtl(this._simple ? 'library' : 'replay');
    this._rpLoad(script, name, lib);
    if (SPEEDS.includes(this._el('speed').value)) this._el('rpspeed').value = this._el('speed').value;
    this._el('rploop').checked = this._el('loop').checked;
    this._rpPlay();
  }

  _stop() { this._rpStop(); }

  async _save() {
    const name = this._el('name').value.trim();
    if (!name) { this._toast('Type a name first'); return; }
    try {
      await this._hass.callService('ogg', 'studio_save', { name, script: this._take, ...(isStroke(this._take) && RUN_MODES[this._outAt(0).m] ? { mode: this._outAt(0).m } : {}) });
      this._toast(`Saved "${name}"`);
      this._take = null;
      this._el('name').value = '';
      this._update();
    } catch (e) { this._toast(e.message || String(e)); }
  }

  // A saved script's details from the Saved script entity: kind
  // (stroke/vibration) and the run mode last used for it.
  _scriptInfo(name) {
    const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
    return (name && saved && saved.attributes.scripts && saved.attributes.scripts[name]) || null;
  }

  _setMode(name, mode) {
    this._hass.callService('ogg', 'studio_set_mode', { name, mode }, undefined, false).catch(() => {});
  }

  _download(script, name) {
    if (!script) return;
    const blob = new Blob([JSON.stringify(script)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const base = String(name).replace(/[\\/:*?"<>|]+/g, '_').replace(/(\.vib)?(\.funscript)?$/i, '');
    a.download = `${base}${isStroke(script) ? '' : '.vib'}.funscript`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async _getSaved(name) {
    const res = await this._hass.callWS({ type: 'call_service', domain: 'ogg', service: 'studio_get_script', service_data: { name }, return_response: true });
    return res.response.script;
  }

  // Copy straight from the tap: the clipboard is asked at once (phones
  // allow it only then), with the code to follow as soon as it is ready.
  _copySaved() {
    if (this._simple && this._libPick === 'take' && this._take) { this._copy(this._take); return; }
    if (this._simple && this._libPick === 'loaded' && this._rp.raw) { this._copy(this._rp.raw); return; }
    const name = this._el('saved').value;
    if (this._rp && this._rp.raw && this._rp.lib === name) { this._copy(this._rp.raw); return; }
    this._copy(() => this._getSaved(name));
  }

  _copy(script) {
    if (!script) return;
    const codeP = (async () => { const s = typeof script === 'function' ? await script() : script; if (!s) throw new Error('No script'); return encodeCode(s); })();
    let asked;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        asked = navigator.clipboard.write([new ClipboardItem({ 'text/plain': codeP.then((c) => new Blob([c], { type: 'text/plain' })) })]);
      } else asked = codeP.then((c) => navigator.clipboard.writeText(c));
    } catch (e) { asked = Promise.reject(e); }
    asked.then(async () => this._toast(`Code copied (${(await codeP).length} characters)`)).catch(async () => {
      let code;
      try { code = await codeP; } catch (e) { this._toast('Could not get the script: ' + (e.message || e)); return; }
      // No clipboard here: show the code to copy by hand.
      if (this._simple) { window.prompt('Copy this code:', code); return; }
      const out = this._el('codeout');
      out.hidden = false; out.value = code; out.select();
      this._toast('Clipboard unavailable: the code is shown in the Import box; copy it from there.');
    });
  }

  async _delete() {
    const name = this._el('saved').value;
    if (!name || !confirm(`Delete "${name}"?`)) return;
    try { await this._hass.callService('ogg', 'studio_delete', { name }); this._toast(`Deleted "${name}"`); }
    catch (e) { this._toast(e.message || String(e)); }
  }

  async _import() {
    const $ = this._el;
    const mode = 'auto';      // detected: OggStudio's marker, a .vib.funscript name, else stroke
    const inverted = $('invert').checked;
    try {
      const files = [...$('files').files];
      let script;
      if (files.length) {
        const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
        const first = parsed[0];
        if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
        if (!first.metadata || !first.metadata.title) first.metadata = { ...(first.metadata || {}), title: fileTitle(files[0].name) };
        script = normalise(first, fileKind(files[0].name, mode), inverted);
      } else if ($('paste').value.trim()) {
        script = normalise(await decodeText($('paste').value), mode, inverted);
      } else { this._toast('Paste a script or choose a file first'); return; }
      this._take = script;
      $('name').value = (script.metadata && script.metadata.title) || '';
      $('paste').value = ''; $('files').value = '';
      if (isStroke(script)) $('takemode').value = RUN_MODE_DEFAULT;
      this._toast(`Loaded ${fmt(duration(script))} ${isStroke(script) ? 'stroke' : 'vibration'} script. Play it now or save it.`);
      this._update();
    } catch (e) { this._toast('Could not import: ' + (e.message || e)); }
  }

  // A saved script named like the video (case, extension and punctuation
  // aside) is chosen for it: in the video's script list and the Library.
  _matchVideoScript(tries = 0) {
    if (!this._vname) return;
    const savedState = this._studio && this._studio.saved && this._hass && this._hass.states[this._studio.saved];
    if (!savedState) {
      // The saved scripts are not known yet (the card is still loading): look again shortly.
      clearTimeout(this._vMatchT);
      if (tries < 20) this._vMatchT = setTimeout(() => this._matchVideoScript(tries + 1), 500);
      return;
    }
    const names = (savedState.attributes.options || []).filter((n) => n && !/^\(.*\)$/.test(n));
    const info = savedState.attributes.scripts || {};
    const match = matchVideoScript(this._vname, names, Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v && v.saved])));
    const sel = this._el('vsrc');
    if (!match) {
      // The last video's own script does not go with this one.
      if (this._vAutoScript && sel.value === this._vAutoScript) { sel.value = ''; this._loadVideoScript(); }
      this._vAutoScript = null;
      return;
    }
    this._fillVideoScripts();
    this._vAutoScript = match;
    if (sel.value !== match) { sel.value = match; this._loadVideoScript(); }
    if (this._simple) {
      this._libPick = null;
      this._hass.callService('select', 'select_option', { entity_id: this._studio.saved, option: match }).catch(() => {});
      if (!this._rp.playing) this._libPreview(match);
    }
    this._toast(`Script "${match}" goes with this video.`);
  }

  // A queued script in the video's list: its value is this prefix and its id.
  _fillVideoScripts() {
    const sel = this._el('vsrc');
    const savedState = this._studio && this._studio.saved && this._hass.states[this._studio.saved];
    const names = ((savedState && savedState.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
    const take = this._take ? `Current take (${isStroke(this._take) ? 'stroke' : 'vibration'}, ${fmt(duration(this._take))})` : null;
    // His and hers queues and the played list (the Queue card's), as there.
    const queues = (savedState && savedState.attributes.queues) || {};
    const people = (savedState && savedState.attributes.settings && savedState.attributes.settings.people) || {};
    const whose = (w) => (people[w] && people[w].name ? `${people[w].name}'s queue` : `${w === 'his' ? 'His' : 'Hers'} queue`);
    const rows = Object.entries(queues);
    const groups = [['his', whose('his')], ['hers', whose('hers')], ['played', 'Played']].map(([k, label]) => {
      const list = rows.filter(([, r]) => (k === 'played' ? r.played : !r.played && r.for === k));
      if (!list.length) return null;
      const g = document.createElement('optgroup');
      g.label = label;
      const mmss = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      g.append(...list.map(([id, r]) => new Option(`${r.name} (${mmss(r.duration_ms || 0)})`, `${VIDEO_QUEUE}${id}`)));
      return g;
    }).filter(Boolean);
    const lib = names.length ? Object.assign(document.createElement('optgroup'), { label: 'Saved scripts' }) : null;
    if (lib) lib.append(...names.map((n) => new Option(n, n)));
    const key = JSON.stringify([names, take, rows.map(([id, r]) => [id, r.name, r.for, Boolean(r.played)]), people]);
    if (sel.dataset.key === key) return;
    const current = sel.value;
    sel.replaceChildren(new Option('From a file on this device…', ''), ...(take ? [new Option(take, TAKE_SRC)] : []), ...groups, ...(lib ? [lib] : []));
    sel.dataset.key = key;
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    else if (current === TAKE_SRC) { sel.value = ''; this._loadVideoScript(); }   // the take went (saved or discarded)
    this._el('vfilebox').hidden = sel.value !== '';
    // A new take while "Current take" is chosen: play the new one.
    if (sel.value === TAKE_SRC && this._vraw !== this._take) this._loadVideoScript();
  }

  // Streamed live levels: never call while the device is offline, never let
  // Home Assistant pop up an error per call (notifyOnError=false), and back
  // off after a failure so one problem gives one message.
  _sendLive(dev, levels, seconds) {
    if (!this._online(dev)) {
      this._toastOnce(`${dev.name} is not connected. Waiting for it to reconnect…`);
      return;
    }
    const now = performance.now();
    if (now < (this._liveBackoffUntil || 0)) return;
    if (this._liveProblem) { this._liveProblem = null; this._toast(''); }
    this._hass.callService('ogg', 'live', { entity_id: dev.stop, levels, seconds }, undefined, false)
      .catch((e) => {
        this._liveBackoffUntil = performance.now() + 3000;
        this._toastOnce(`Could not control ${dev.name}: ${e.message || e}. Retrying…`);
      });
  }

  _quietStop(dev) {
    if (!dev || !this._hass) return;
    this._hass.callService('ogg', 'stop_script', { entity_id: dev.stop }, undefined, false).catch(() => {});
  }

  _toastOnce(text) {
    if (this._liveProblem === text) return;
    this._liveProblem = text;
    this._toast(text);
  }

  _toast(text) { if (this._el) this._el('toast').textContent = text; }

  disconnectedCallback() {
    clearInterval(this._liveTimer); clearInterval(this._sampleTimer);
    this._stHalt();
    this._gpDetach();
    if (this._vsyncTimer) this._videoHalt();
    if (this._cast) this._castEnd(true);       // the video streams from here: stop the TV too
    if (this._vurl) { URL.revokeObjectURL(this._vurl); this._vurl = null; }
    if (this._rp && this._rp.playing) { this._plOff(); this._rpStop(); }
    this._auStop();
    this._ptStop();
    this._hbKeep(true);
    clearInterval(this._vsTimer); this._vsTimer = null;
    this._castUnprep();
    this._castUnlink();
    if (this._tap) { clearInterval(this._tapTimer); this._tap = null; }
    clearInterval(this._urecTimer); this._urecTimer = null;
    this._tgEnd();
    clearInterval(this._lockTimer); this._lockTimer = null;
    this._outStop();
    this._sessionClose();
  }
}
