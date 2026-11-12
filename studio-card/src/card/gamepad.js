// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { esc } from '../lib/core.js';
import { GP_ACTIONS, GP_ON_KEY, GP_POLL_MS, GP_PROFILES, GP_REST_SAMPLES, GP_SPEEDS, GP_SPEED_DEFAULT, GP_SPEED_KEY, ST_ACTIONS, gpBuildMap, gpCalibrate, gpChoosePad, gpDescribe, gpFirstButton, gpPickInput, gpPressed, gpRaw, gpRead, gpState, gpStep, gpTargetFor } from '../lib/gamepad.js';
import { STROKE_SPEEDS } from '../lib/stroke.js';

// Methods mixed into OggStudioCard.
export class GamepadPart {
  // ---------------------------------------------------------- game controller
  _bindGamepad() {
    const $ = this._el;
    const parts = this._baseParts;
    $('gp').hidden = !(parts.includes('record') || parts.includes('video') || parts.includes('stroke'));
    this._gpLearning = null;
    this._gpStatusHtml = null;
    const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
    this._gpMaps = {};
    for (const [name, prof] of Object.entries(GP_PROFILES)) {
      const map = load(prof.mapKey, null);
      this._gpMaps[name] = map && typeof map === 'object' ? gpBuildMap(map, prof.defaults) : { ...prof.defaults };
    }
    const speed = Number(load(GP_SPEED_KEY, GP_SPEED_DEFAULT));
    this._gpSpeed = Number.isInteger(speed) && speed >= 0 && speed < GP_SPEEDS.length ? speed : GP_SPEED_DEFAULT;
    $('gpon').checked = load(GP_ON_KEY, false) === true;
    $('gpon').addEventListener('change', () => { this._gpSave(GP_ON_KEY, $('gpon').checked); gpState.owner = this; this._gpRun(); this._gpStatus(); });
    $('gplearnbtn').addEventListener('click', () => this._gpLearnStart());
    $('gpskip').addEventListener('click', () => this._gpLearnSkip());
    $('gpreset').addEventListener('click', () => { this._gpSave(this._gpProf.mapKey, null); this._gpMap = { ...this._gpProf.defaults }; this._gpLearnEnd('Controller: default controls restored.'); });
    $('gpcancel').addEventListener('click', () => this._gpLearnEnd(''));
    this._gpStatus();
    this._gpRun();
  }

  connectedCallback() { this._gpAttach(); }

  _gpAttach() {
    if (this._gpHandlers) return;
    const typing = (e) => {
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      return Boolean(t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && t.type !== 'checkbox')));
    };
    const names = (e) => [e.code, e.key].filter(Boolean);
    const h = {
      keydown: (e) => {
        if (!this._el || typing(e)) return;
        if (this._gpLearning) {
          if (e.key === 'Tab') return;
          e.preventDefault(); e.stopPropagation();
          if (e.repeat) return;
          // On Android a gamepad's D-pad and buttons often also arrive as
          // keys; with a gamepad present, learn from the gamepad only.
          if (this._gpPad()) { this._gpLearning.keys = (this._gpLearning.keys || 0) + 1; if (this._gpLearning.keys <= 3) this._gpLog(`key ignored while learning (gamepad present): code=${e.code} key=${e.key}`); return; }
          this._gpLearnKey(e.code || e.key);
          return;
        }
        if (!this._el('gpon').checked || !this._gpUsable() || !this._gpIsOwner()) return;
        const n = names(e);
        if (!Object.values(this._gpMap).some((binds) => binds.some((b) => b.k !== undefined && n.includes(b.k)))) return;
        e.preventDefault(); e.stopPropagation();
        // With a gamepad present its own readings count; key echoes of its
        // buttons (Android) would otherwise fire the wrong action.
        if (this._gpPad()) return;
        n.forEach((k) => this._gpKeys.add(k));
        this._gpRun();
      },
      keyup: (e) => { names(e).forEach((k) => this._gpKeys.delete(k)); },
      blur: () => this._gpKeys.clear(),
      connected: (e) => {
        if (!this._el || !this._gpUsable()) return;
        if (!this._el('gpon').checked) { this._el('gpon').checked = true; this._gpSave(GP_ON_KEY, true); }
        this._toast(`Controller connected: ${e.gamepad && e.gamepad.id ? e.gamepad.id : 'game controller'}`);
        if (gpState.owner === this || !gpState.owner) this._gpLogPads();
        this._gpRun();
        this._gpStatus();
      },
      disconnected: () => { this._gpFloat = [null, null]; this._gpStatus(); },
    };
    window.addEventListener('keydown', h.keydown, true);
    window.addEventListener('keyup', h.keyup, true);
    window.addEventListener('blur', h.blur);
    window.addEventListener('gamepadconnected', h.connected);
    window.addEventListener('gamepaddisconnected', h.disconnected);
    this._gpHandlers = h;
    this._gpRun();
  }

  _gpDetach() {
    const h = this._gpHandlers;
    if (h) {
      window.removeEventListener('keydown', h.keydown, true);
      window.removeEventListener('keyup', h.keyup, true);
      window.removeEventListener('blur', h.blur);
      window.removeEventListener('gamepadconnected', h.connected);
      window.removeEventListener('gamepaddisconnected', h.disconnected);
    }
    this._gpHandlers = null;
    clearInterval(this._gpTimer);
    this._gpTimer = null;
    this._gpKeys.clear();
    if (gpState.owner === this) gpState.owner = null;
  }

  _gpSave(key, value) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  }

  _gpUsable() { return Boolean(this._el && this.isConnected && !this._el('gp').hidden); }

  _gpIsOwner() {
    if (gpState.owner && gpState.owner !== this && gpState.owner._gpUsable() && gpState.owner._el('gpon').checked) return false;
    gpState.owner = this;
    return true;
  }

  _gpPad() {
    let pads = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; this._gpBlocked = false; } catch (_) { this._gpBlocked = true; }
    this._gpPrevPressed = this._gpPrevPressed || {};
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const now = gpPressed(p);
      const before = this._gpPrevPressed[p.index];
      if (before && now.some((i) => !before.includes(i))) this._gpActive = p.index;   // a new press
      this._gpPrevPressed[p.index] = now;
    }
    this._gpPadCount = pads.filter((p) => p && p.connected).length;
    return gpChoosePad(pads, this._gpActive);
  }

  // Learn controls reports what it sees to the Home Assistant log
  // (Settings > System > Logs), so a controller's quirks can be diagnosed.
  _gpLog(message) {
    if (!this._hass) return;
    this._hass.callService('system_log', 'write', { message: `OggStudio controller: ${message}`, level: 'warning', logger: 'oggstudio.card' }, undefined, false).catch(() => {});
  }

  _gpLogPads() {
    let pads = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch (_) { /* blocked */ }
    const live = pads.filter((p) => p && p.connected);
    this._gpLog(`${live.length} gamepad(s): ${live.map((p) => gpRaw(p)).join(' || ') || 'none'} · chosen #${this._gpPad() ? this._gpPad().index : '-'} · secure=${window.isSecureContext} · ${navigator.userAgent}`);
  }

  _gpTarget() {
    // The Play card: whatever its mode shows.
    if (this._simple) return this._ctl === 'video' ? (this._vurl ? 'video' : null) : gpTargetFor(this._parts.filter((p) => p !== 'video'), false);
    return gpTargetFor(this._parts, Boolean(this._vurl));
  }

  // The stroke recorder has its own controls (and its own learned map).
  get _gpProfName() { return this._gpLearning ? this._gpLearning.prof : (this._gpTarget() === 'stroke' ? 'stroke' : 'level'); }
  get _gpProf() { return GP_PROFILES[this._gpProfName]; }
  get _gpMap() { return this._gpMaps[this._gpProfName]; }
  set _gpMap(map) { this._gpMaps[this._gpProfName] = map; }

  // Polls the controller every GP_POLL_MS while it is on (or learning).
  // A timer rather than animation frames: those stall in some web views.
  _gpRun() {
    if (this._gpTimer || !this._el || !this.isConnected) return;
    this._gpLast = performance.now();
    this._gpTimer = setInterval(() => {
      if (!this._el || !this.isConnected || (!this._el('gpon').checked && !this._gpLearning)) {
        clearInterval(this._gpTimer); this._gpTimer = null; this._gpKeys.clear();
        return;
      }
      const now = performance.now();
      const dt = now - this._gpLast;
      this._gpLast = now;
      this._gpTick(dt);
    }, GP_POLL_MS);
  }

  _gpTick(dt) {
    const pad = this._gpPad();
    this._gpPadId = pad ? pad.id : '';
    if (this._gpLearning) { this._gpLearnPoll(pad); return; }
    if (!this._gpUsable() || !this._gpIsOwner()) return;
    const s = gpRead(this._gpMap, pad, this._gpKeys);
    const pressed = (a) => s[a] > 0.5 && !(this._gpPrev[a] > 0.5);
    if (pressed('panic')) { this._gpPrev = s; this._panic(); return; }
    if (this._gpProfName === 'stroke') {
      if (pressed('rec')) this._gpRec();
      if (pressed('limit')) this._stSetLimit();
      if (pressed('reset')) this._stReset();
      const held = s.fast > 0.5 ? 2 : s.med > 0.5 ? 1 : s.slow > 0.5 ? 0 : null;
      if (held !== this._st.pad) { if (held !== null && held === this._st.latch) this._st.latch = null; this._st.pad = held; this._stRun(); }
      this._gpPrev = s;
      this._gpStatus();
      return;
    }
    if (pressed('right')) this._gpSetSpeed(1);
    if (pressed('left')) this._gpSetSpeed(-1);
    if (pressed('motor')) this._gpCycleMotor();
    if (pressed('rec')) this._gpRec();
    const target = this._gpTarget();
    if (target && pressed('zero')) {
      this._gpFloat = [null, null];
      this._gpApply(target, () => 0);
    } else if (target && (s.up || s.down)) {
      const speed = GP_SPEEDS[this._gpSpeed];
      this._gpApply(target, (v, i) => (this._gpFloat[i] = gpStep(this._gpFloat[i] ?? v, s.up, s.down, speed, dt)));
    } else {
      this._gpFloat = [null, null];
    }
    this._gpPrev = s;
    this._gpStatus();
  }

  _gpMotors() {
    if (this._gpTarget() === 'video' || !this._twoPads) return [0];
    return this._gpMotor === 2 ? [0, 1] : [this._gpMotor];
  }

  _gpApply(target, fn) {
    const motors = this._gpMotors();
    if (target === 'video') {
      if (!this._vrec && !(this._tap && this._tap.video)) { this._gpHint('Controller: press record first to record against the video'); return; }
      // The video tick (every 100 ms) samples and sends the bars.
      for (const i of motors) { this._hvals[i] = Math.round(Math.min(100, Math.max(0, fn(this._hvals[i], i)))); this._showHBar(i, this._hvals[i]); }
    } else {
      for (const i of motors) this._setPad(i, fn(this._vals[i], i));   // the live timer sends it
    }
  }

  _gpHint(text) {
    if (this._gpHinted === text) return;
    this._gpHinted = text;
    this._toast(text);
    clearTimeout(this._gpHintTimer);
    this._gpHintTimer = setTimeout(() => { this._gpHinted = null; }, 4000);
  }

  _gpSetSpeed(delta) {
    this._gpSpeed = Math.min(GP_SPEEDS.length - 1, Math.max(0, this._gpSpeed + delta));
    this._gpSave(GP_SPEED_KEY, this._gpSpeed);
  }

  _gpCycleMotor() {
    if (this._gpTarget() === 'video' || !this._twoPads) return;
    this._gpMotor = (this._gpMotor + 1) % 3;
    this._gpFloat = [null, null];
  }

  _gpRec() {
    const $ = this._el;
    const target = this._gpTarget();
    if (this._simple) { this._urecToggle(); return; }
    if ((target === 'stroke' || target === 'record') && this._ctl === 'mood') {
      if (this._rp.playing) this._rpStop(); else if (this._mood) this._moodNext(true);
    } else if ((target === 'stroke' || target === 'record') && this._ctl === 'replay') {
      this._rpToggle();
    } else if (target === 'stroke') {
      if (this._stRecording) this._stStop(); else this._stStart();
    } else if (target === 'video') {
      this._vrecToggle();
      const video = $('video');
      if (this._vrec && video.paused) this._videoGo();
      else if (!this._vrec && !video.paused) video.pause();
    } else if (target === 'record') {
      if ($('rec').disabled) { this._toast('The device is not connected'); return; }
      if (this._recording) this._stopRecording(); else this._startRecording();
    }
  }

  _gpStatus() {
    if (!this._el) return;
    const $ = this._el;
    const open = $('gpon').checked || Boolean(this._gpLearning);
    if ($('gpmore').hidden === open) { $('gpmore').hidden = !open; $('gp').classList.toggle('on', open); }
    let html = '';
    const stroke = this._gpProfName === 'stroke';
    if (this._gpLearning) html = '';
    else if (!$('gpon').checked) html = stroke ? 'Hold a speed to stroke, set and reset limits, record' : 'Up/down = level, left/right = speed, A = record';
    else if (stroke) {
      const st = this._st;
      const sp = this._stSpeed();
      const bits = [sp !== null && sp !== undefined ? `<b>${STROKE_SPEEDS[sp].name} ${this._stPcts[sp]}%</b>` : 'hold a speed to stroke'];
      if (this._gpPadId) bits.push(esc(this._gpPadId.replace(/\s*\(.*$/, '').slice(0, 28)) + (this._gpPadCount > 1 && this._gpActive === undefined ? ` (1 of ${this._gpPadCount}: press a button to choose)` : ''));
      else if (this._gpBlocked || !window.isSecureContext) bits.push('no gamepad: this page is not HTTPS, so only keyboard-mode controllers work');
      else bits.push('press a button on the controller');
      html = bits.join(' · ');
    } else {
      const bits = [`Speed <b>${this._gpSpeed + 1}/${GP_SPEEDS.length}</b> (${GP_SPEEDS[this._gpSpeed]}%/s)`];
      if (this._gpTarget() !== 'video' && this._twoPads) bits.push(['Pad 1', 'Pad 2', 'Both pads'][this._gpMotor]);
      const target = this._gpTarget();
      bits.push(target === 'video' ? '→ video' : target === 'record' ? '→ pads' : '');
      if (this._gpPadId) bits.push(esc(this._gpPadId.replace(/\s*\(.*$/, '').slice(0, 28)) + (this._gpPadCount > 1 && this._gpActive === undefined ? ` (1 of ${this._gpPadCount}: press a button to choose)` : ''));
      else if (this._gpBlocked || !window.isSecureContext) bits.push('no gamepad: this page is not HTTPS, so only keyboard-mode controllers work');
      else bits.push('press a button on the controller');
      html = bits.filter(Boolean).join(' · ');
    }
    if (this._gpStatusHtml !== html) { this._gpStatusHtml = html; $('gpstat').innerHTML = html; }
  }

  // Learn controls: (1) hands off while axes are measured, (2) press the
  // button for Record, (3) for each other control: hold it, press Record.
  _gpLearnStart() {
    const $ = this._el;
    if (!$('gpon').checked) { $('gpon').checked = true; this._gpSave(GP_ON_KEY, true); }
    this._gpLearning = { prof: this._gpProfName, phase: 'wake', learned: {}, step: 0, samples: [], cal: null, recBtn: -1, recKey: null, wait: true, last: '' };
    $('gplearn').hidden = false; $('gplearnrow').hidden = false; $('gpraw').hidden = false; $('gplearnbtn').hidden = true;
    this._gpLog('learn started');
    this._gpLogPads();
    this._gpStatus();
    this._gpLearnShow();
    this._gpRun();
  }

  _gpLearnShow() {
    const L = this._gpLearning;
    if (!L || !this._el) return;
    const recName = L.recKey ? `key ${L.recKey}` : `button ${L.recBtn}`;
    const text = {
      wake: 'Press any button on the controller to wake it, then let go. (Keyboard-mode controller: press the key you want for Record.)',
      rest: 'Hands off the controller for a moment...',
      rec: 'Press the button you want for Record start/stop.',
      hold: `${L.step + 1}/${this._gpProf.hold.length}: hold ${this._gpProf.labels[this._gpProf.hold[L.step]].toUpperCase()}, then press Record (${recName}) to confirm. Nothing held, or Skip = keep the default.`,
    }[L.phase];
    const t = (L.last ? `✓ ${L.last}. ` : '') + text;
    if (this._el('gplearn').textContent !== t) this._el('gplearn').textContent = t;
  }

  _gpLearnPoll(pad) {
    const L = this._gpLearning;
    L.ticks = (L.ticks || 0) + 1;
    if (L.ticks % 5 === 0 && this._el) this._el('gpraw').textContent = `${gpRaw(pad)}${this._gpPadCount > 1 ? ` (of ${this._gpPadCount} gamepads)` : ''}`;
    if (L.phase === 'wake') {
      if (pad) { L.phase = 'rest'; L.samples = []; L.restPressed = null; this._gpLearnShow(); }
      return;
    }
    if (!pad) return;
    if (L.phase === 'rest') {
      // Buttons must stay the same for the whole hands-off run; any that
      // are down throughout are stuck and ignored from now on.
      const pressed = gpPressed(pad).join(',');
      if (pressed !== L.restPressed) { L.restPressed = pressed; L.samples = []; }
      L.samples.push([...pad.axes]);
      if (L.samples.length >= GP_REST_SAMPLES) {
        L.cal = gpCalibrate(L.samples);
        L.cal.stuck = gpPressed(pad);
        L.padIndex = pad.index;
        L.phase = 'rec'; L.wait = true;
        this._gpLog(`calibrated pad #${pad.index}: rest [${L.cal.rest.map((v) => v.toFixed(2)).join(' ')}] jitter [${L.cal.noise.map((v) => v.toFixed(2)).join(' ')}] stuck buttons [${L.cal.stuck.join(',')}]`);
        this._gpLearnShow();
      }
      return;
    }
    const stuck = L.cal ? L.cal.stuck : [];
    if (L.phase === 'rec') {
      const b = gpFirstButton(pad, -1, stuck);
      if (L.wait) { if (b < 0) L.wait = false; return; }
      if (b >= 0) { this._gpLog(`record button: ${gpRaw(pad)}`); this._gpLearnSetRec({ b }); }
      return;
    }
    // hold: confirm on the rising edge of the Record button.
    const recDown = L.recBtn >= 0 && !stuck.includes(L.recBtn) && Boolean(pad.buttons[L.recBtn] && pad.buttons[L.recBtn].pressed);
    if (L.wait) { if (!recDown) L.wait = false; return; }
    if (recDown) {
      const bind = gpPickInput(pad, L.cal, L.recBtn);
      this._gpLog(`${this._gpProf.hold[L.step]} confirmed -> ${gpDescribe(bind)} · ${gpRaw(pad)}`);
      this._gpLearnNext(bind);
    }
  }

  _gpLearnSetRec(bind) {
    const L = this._gpLearning;
    L.learned.rec = [bind];
    if (bind.b !== undefined) L.recBtn = bind.b; else L.recKey = bind.k;
    L.last = `Record = ${gpDescribe(bind)}`;
    L.phase = 'hold'; L.step = 0; L.wait = true;
    this._gpLearnShow();
  }

  // Keys while learning: a key for Record (keyboard-mode pads), the Record
  // key confirms what is held, any other key binds straight away.
  _gpLearnKey(k) {
    const L = this._gpLearning;
    if (L.phase !== 'hold') { this._gpLearnSetRec({ k }); return; }
    if (k === L.recKey) this._gpLearnNext(gpPickInput(this._gpPad(), L.cal, L.recBtn));
    else this._gpLearnNext({ k });
  }

  _gpLearnSkip() {
    const L = this._gpLearning;
    if (!L) return;
    if (L.phase === 'hold') { this._gpLearnNext(null); return; }
    // Record skipped: keep the default (button 0) and confirm with it.
    L.recBtn = 0; L.last = 'Record = button 0 (default)';
    if (!L.cal && L.samples.length) { L.cal = gpCalibrate(L.samples); L.cal.stuck = []; }
    L.phase = 'hold'; L.step = 0; L.wait = true;
    this._gpLearnShow();
  }

  _gpLearnNext(bind) {
    const L = this._gpLearning;
    if (!L || L.phase !== 'hold') return;
    const prof = this._gpProf;
    const action = prof.hold[L.step];
    if (bind) {
      const same = JSON.stringify(bind);
      for (const a of Object.keys(L.learned)) L.learned[a] = L.learned[a].filter((b) => JSON.stringify(b) !== same);
      L.learned[action] = [bind];
    }
    L.last = `${prof.labels[action]} = ${gpDescribe(bind)}`;
    L.wait = true;
    L.step += 1;
    if (L.step < prof.hold.length) { this._gpLearnShow(); return; }
    this._gpSave(prof.mapKey, L.learned);
    this._gpMap = gpBuildMap(L.learned, prof.defaults);
    this._gpLog(`learn finished: ${JSON.stringify(L.learned)}`);
    this._gpLearnEnd('Controller: controls saved for this browser.');
  }

  _gpLearnEnd(message) {
    const $ = this._el;
    const map = this._gpMap;
    this._gpLearning = null;
    $('gplearn').hidden = true; $('gplearnrow').hidden = true; $('gpraw').hidden = true; $('gplearnbtn').hidden = false;
    // Treat everything as held so nothing fires until it is released.
    this._gpPrev = Object.fromEntries([...GP_ACTIONS, ...ST_ACTIONS, ...Object.keys(map)].map((a) => [a, 1]));
    this._gpKeys.clear();
    this._toast(message);
    this._gpStatus();
  }
}
