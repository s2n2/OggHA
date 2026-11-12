// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { FOLLOW_AI } from '../lib/ai.js';
import { RUN_MODES, RUN_MODE_DEFAULT, liveIntensity } from '../lib/convert.js';
import { capture, duration, fmt } from '../lib/core.js';
import { GP_POLL_MS } from '../lib/gamepad.js';
import { FOLLOW_STROKER, approachStep, parseTarget, railDrag, railGrab } from '../lib/outputs.js';
import { STROKE_LIMITS_RESET, STROKE_LIMIT_KEY, STROKE_SPEEDS, STROKE_SPEED_KEY, okPct, strokeSetLimit, strokeStep, strokeVel } from '../lib/stroke.js';

// Methods mixed into OggStudioCard.
export class StrokePart {
  // ---------------------------------------------------------- stroke recorder
  _bindStroke() {
    const $ = this._el;
    const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
    const lim = load(STROKE_LIMIT_KEY, null);
    const okLim = lim && Number.isFinite(lim.lower) && Number.isFinite(lim.upper) && lim.upper - lim.lower >= 2;
    // pad / touch: speed held on the controller / on screen; drag: finger on the bar.
    this._st = { pos: 50, dir: 1, vel: 0, pad: null, touch: null, latch: null, drag: null, moving: null,
      ...(okLim ? { lower: lim.lower, upper: lim.upper, last: lim.last || null } : { ...STROKE_LIMITS_RESET }) };
    this._stRecording = false;
    $('stlive').addEventListener('change', () => { if ($('stlive').checked) this._stRun(); });
    $('strec').addEventListener('click', () => (this._stRecording ? this._stStop() : this._stStart()));
    $('stlimit').addEventListener('click', () => this._stSetLimit());
    $('streset').addEventListener('click', () => this._stReset());
    const pcts = load(STROKE_SPEED_KEY, null);
    this._stPcts = STROKE_SPEEDS.map((sp, i) => (Array.isArray(pcts) && okPct(pcts[i]) ? pcts[i] : sp.pct));
    // Speed sliders: changes apply straight away, saved when let go.
    for (const r of this.shadowRoot.querySelectorAll('.stpctr')) {
      const i = Number(r.dataset.speed);
      r.value = String(this._stPcts[i]);
      r.title = '';
      r.addEventListener('input', () => { this._stPcts[i] = Number(r.value); this._stShow(); this._gpStatus(); });
      r.addEventListener('change', () => this._gpSave(STROKE_SPEED_KEY, this._stPcts));
    }
    for (const btn of this.shadowRoot.querySelectorAll('.stlatch')) {
      const i = Number(btn.dataset.speed);
      btn.addEventListener('click', () => { this._st.latch = this._st.latch === i ? null : i; this._stRun(); });
    }
    for (const btn of this.shadowRoot.querySelectorAll('.sthold')) {
      const speed = Number(btn.dataset.speed);
      const release = () => { if (this._st.touch === speed) { this._st.touch = null; this._stRun(); } };
      // Pressing a speed takes over from a latched one: it runs while held and stops on release.
      // Holding the latched speed's own button unlatches it (runs while held,
      // stops on release); holding another speed overrides the latch until let go.
      const press = () => { if (this._st.latch === speed) this._st.latch = null; this._st.touch = speed; this._stRun(); };
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(btn, e); press(); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
      btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(); });
    }
    const level = (el, e) => { const r = el.getBoundingClientRect(); return Math.min(100, Math.max(0, (1 - (e.clientY - r.top) / r.height) * 100)); };
    // Position lane: the stroker heads for the finger (speed-limited until it gets there).
    const lane = $('stlane');
    lane.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(lane, e);
      lane.classList.add('active');
      this._st.caught = false;
      this._st.drag = level(lane, e);
      this._stRun();
    });
    lane.addEventListener('pointermove', (e) => { if (this._st.drag !== null) this._st.drag = level(lane, e); });
    const laneUp = () => { if (this._st.drag === null) return; this._st.drag = null; lane.classList.remove('active'); this._stRun(); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) lane.addEventListener(type, laneUp);
    lane.addEventListener('contextmenu', (e) => e.preventDefault());
    lane.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 2, ArrowDown: -2, PageUp: 10, PageDown: -10 };
      if (e.key in steps) { e.preventDefault(); e.stopPropagation(); this._st.pos = Math.min(100, Math.max(0, this._st.pos + steps[e.key])); this._stMark(); this._stRun(); }
    });
    // Range rail: drag a limit, or the band to move the whole range.
    const rail = $('strail');
    let grab = null;
    rail.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(rail, e);
      rail.classList.add('active');
      const v = level(rail, e);
      grab = railGrab(this._st, v, 22 / rail.getBoundingClientRect().height * 100);   // ~22 px either side of a limit
      if (grab.mode !== 'move') Object.assign(this._st, railDrag(this._st, grab, v));
      this._stShow();
    });
    rail.addEventListener('pointermove', (e) => {
      if (!grab) return;
      Object.assign(this._st, railDrag(this._st, grab, level(rail, e)));
      this._stShow();
    });
    const railUp = () => {
      if (!grab) return;
      // A limit dragged by hand counts as the last one set (for Set limit's pairing).
      if (grab.mode !== 'move') this._st.last = grab.mode;
      grab = null;
      rail.classList.remove('active');
      this._stSaveLimits();
      this._stShow();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rail.addEventListener(type, railUp);
    rail.addEventListener('contextmenu', (e) => e.preventDefault());
    rail.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 2, ArrowDown: -2, PageUp: 10, PageDown: -10 };
      if (!(e.key in steps)) return;
      e.preventDefault(); e.stopPropagation();
      Object.assign(this._st, railDrag(this._st, { mode: 'move', off: 0 }, this._st.lower + steps[e.key]));
      this._stSaveLimits();
      this._stShow();
    });
    this._stShow();
  }

  _stSpeed() {
    const st = this._st;
    return st.drag !== null ? null : st.touch ?? st.pad ?? st.latch ?? null;
  }

  // One timer while anything moves, records or follows live; it stops
  // itself when all of that ends.
  _stRun() {
    if (!this._st || this._stTimer || !this.isConnected) { this._stShow(); return; }
    this._stLast = performance.now();
    this._stTimer = setInterval(() => this._stTick(), GP_POLL_MS);
    this._stTick();
  }

  _stTick() {
    const st = this._st;
    const now = performance.now();
    const dt = Math.max(0, now - this._stLast);
    this._stLast = now;
    const before = st.pos;
    const speed = this._stSpeed();
    if (speed !== st.moving) {
      this._stMark(now - dt);       // a hold starts, stops or changes speed here
      st.moving = speed;
    }
    if (speed !== null) st.lastSpeed = speed;
    if (speed !== null) {
      const r = strokeStep(st.pos, st.dir, st.lower, st.upper, strokeVel(this._stPcts[speed]), dt);
      for (const t of r.turns) this._stMark(now - dt + t.frac * dt, t.pos);
      st.pos = r.pos; st.dir = r.dir;
    } else if (st.drag !== null) {
      if (st.caught) st.pos = st.drag;
      else {
        const r = approachStep(st.pos, st.drag, strokeVel(this._stPcts[st.lastSpeed ?? 0]), dt);
        st.pos = r.pos; st.caught = r.caught;
      }
      if (Math.abs(st.pos - before) > 0.5 && now - (this._stDragMark || 0) >= 50) { this._stDragMark = now; this._stMark(now); }
    } else if (this._rp && this._rp.playing) {
      st.pos = this._simple ? this._lim(this._rpPos()) : this._rpPos();   // replaying: the script moves the bar (inside the limits on the Play card)
    }
    const vel = dt > 0 ? (st.pos - before) / dt * 1000 : 0;
    st.vel = st.vel * 0.6 + vel * 0.4;
    if (speed !== null) st.dir = st.dir || 1;
    this._stLive(now);
    this._stShow();
    const busy = speed !== null || st.drag !== null || this._stRecording || (this._el('stlive').checked && !this._simple) || Boolean(this._rp && this._rp.playing);
    if (!busy) this._stHalt();
  }

  _stHalt() {
    clearInterval(this._stTimer);
    this._stTimer = null;
    if (this._stOutAt) { this._stOutAt = 0; this._outStop(); }
  }

  // Live feedback: a vibration device follows the stroke using the chosen
  // run mode, sent at most every 100 ms (and refreshed every 500 ms).
  // Live: every output follows the stroke its own way, at most every 100 ms.
  // A vibrator gets an intensity from its run mode; a stroker gets the next
  // limit and how long to take (or the bar position when moved by hand).
  _stLive(now) {
    const replaying = Boolean(this._rp && this._rp.playing);
    const on = this._stRecording || this._el('stlive').checked || replaying;
    if (!on) { if (this._stOutAt) { this._stOutAt = 0; this._outStop(); } return; }
    // Vibrators every 100 ms; a stroker's next target as soon as it turns (every tick).
    const full = !this._stOutAt || now - this._stOutAt >= 100;
    if (full) this._stOutAt = now;
    const st = this._st;
    const speed = this._stSpeed();
    const fromScript = replaying && speed === null && st.drag === null;
    const values = this._outs.map((o, i) => {
      const p = parseTarget(this._outTargetValue(i));
      if (!p || (!full && p.motor !== 'l')) return null;
      if (fromScript && this._rp.raw.mood && p.motor !== 'l') return this._mapScript(this._rp.raw, this._rp.t, {})[i];
      if (o.m === FOLLOW_AI && p.motor !== 'l') {
        // A vibrator follows the stroke by feel: from the script, or live.
        if (fromScript) return this._mapScript(this._rp.raw, this._rp.t, this._rp.convs || (this._rp.convs = {}))[i];
        return this._aiStroke(i, st.pos, st.vel);
      }
      if (p.motor === 'l' || o.m === FOLLOW_STROKER) {
        if (p.motor !== 'l') return Math.round(st.pos);   // stroker mode on a vibrator: position
        if (fromScript) return this._goalFrom(i, this._rp.raw, this._rp.t, this._rpSpeed(), this._rp.convs || (this._rp.convs = {})) || { goal: st.pos, dur: 120 };
        if (speed === null) return { goal: st.pos, dur: 120 };
        const goal = st.dir > 0 ? st.upper : st.lower;
        return { goal, dur: Math.abs(goal - st.pos) / strokeVel(this._stPcts[speed]) };
      }
      return Math.min(100, Math.max(0, liveIntensity(o.m, st.pos, st.vel)));
    });
    this._outApply(values, 0.6);
  }

  _stMark(when, pos) {
    if (!this._stRecording) return;
    const at = Math.max(0, Math.round((when ?? performance.now()) - this._st0));
    const p = Math.round(pos ?? this._st.pos);
    const acts = this._stActs;
    const last = acts[acts.length - 1];
    if (last && at <= last.at) last.pos = p; else acts.push({ at, pos: p });
  }

  _stStart() {
    if (this._stRecording) return;
    this._stRecording = true;
    this._st0 = performance.now();
    this._stActs = [];
    this._stMark(this._st0);
    this._stRun();
    this._toast('Recording: hold a speed to stroke.');
  }

  _stStop() {
    if (!this._stRecording) return;
    this._stMark();
    this._stRecording = false;
    const acts = this._stActs;
    this._stActs = [];
    if (acts.length < 2 || acts[acts.length - 1].at < 200) { this._toast('Nothing recorded.'); this._stShow(); return; }
    this._take = { version: '1.0', inverted: false, range: 100, actions: acts, metadata: { creator: 'OggStudio', type: 'stroke' } };
    const m = this._outAt(0).m;
    this._el('takemode').value = RUN_MODES[m] ? m : RUN_MODE_DEFAULT;
    this._toast(`Recorded ${fmt(duration(this._take))} of strokes. Save it below, or download the .funscript for a Handy.`);
    this._update();
    this._stRun();   // stops live feedback if nothing else needs it
  }

  _stSetLimit() {
    const st = this._st;
    const next = strokeSetLimit(st, st.pos);
    if (!next) { this._toast('That is where the other limit is: move first, then set the limit.'); return; }
    Object.assign(st, next);
    this._stSaveLimits();
    this._toast(`${next.last === 'upper' ? 'Upper' : 'Lower'} limit set: range ${st.lower}–${st.upper}.`);
    this._stShow();
  }

  _stSaveLimits() {
    const st = this._st;
    this._gpSave(STROKE_LIMIT_KEY, { lower: st.lower, upper: st.upper, last: st.last });
  }

  _stReset() {
    Object.assign(this._st, STROKE_LIMITS_RESET);
    this._gpSave(STROKE_LIMIT_KEY, null);
    this._toast('Limits reset: full range 0–100.');
    this._stShow();
  }

  _stShow() {
    if (!this._el || !this._st) return;
    const $ = this._el;
    const st = this._st;
    const pos = Math.round(st.pos);
    for (const id of ['stband', 'stshade']) { $(id).style.top = `${100 - st.upper}%`; $(id).style.height = `${st.upper - st.lower}%`; }
    $('stpos').style.bottom = `${st.pos}%`;
    // Limit numbers sit outside the band, so they stay readable on a narrow range.
    $('stup').style.top = st.upper > 90 ? `calc(${100 - st.upper}% + 6px)` : `calc(${100 - st.upper}% - 18px)`; $('stup').textContent = String(st.upper);
    $('stlo').style.bottom = st.lower < 10 ? `calc(${st.lower}% + 6px)` : `calc(${st.lower}% - 18px)`; $('stlo').textContent = String(st.lower);
    $('stpct').textContent = String(pos);
    $('stlane').setAttribute('aria-valuenow', String(pos));
    $('strail').setAttribute('aria-valuetext', `range ${st.lower} to ${st.upper}`);
    const speed = this._stSpeed();
    for (const b of this.shadowRoot.querySelectorAll('.sthold')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
    for (const b of this.shadowRoot.querySelectorAll('.stpv')) { const t = `${this._stPcts[Number(b.dataset.speed)]}%`; if (b.textContent !== t) b.textContent = t; }
    for (const b of this.shadowRoot.querySelectorAll('.stlatch')) {
      const on = Number(b.dataset.speed) === st.latch;
      if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.textContent = on ? '■ Latched' : '⟳ Latch'; b.setAttribute('aria-pressed', String(on)); }
    }
    $('strec').textContent = this._stRecording ? '■ Stop recording' : '● Record';
    $('strec').classList.toggle('on', this._stRecording);
    const bits = [`Range ${st.lower}–${st.upper}`];
    if (speed !== null) bits.push(`${STROKE_SPEEDS[speed].name} ${this._stPcts[speed]}%${st.latch === speed && st.touch === null && st.pad === null ? ' (latched)' : ''}`);
    if (this._stRecording) bits.push(`● ${fmt(performance.now() - this._st0)}`);
    if (this._outs && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) bits.push('no device: recording only');
    const text = bits.join(' · ');
    if ($('stinfo').textContent !== text) $('stinfo').textContent = text;
  }
}
