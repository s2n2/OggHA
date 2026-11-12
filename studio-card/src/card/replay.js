// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { AiLive, FOLLOW_AI, aiRandom, aiStrokeToVibe, aiVibeToStroke, moodAt } from '../lib/ai.js';
import { RUN_MODES, fileKind, fileTitle, isStroke, liveIntensity, normalise, runScript, toIntensity } from '../lib/convert.js';
import { SPEEDS, capture, decodeText, duration, esc, fmt } from '../lib/core.js';
import { GP_POLL_MS } from '../lib/gamepad.js';
import { MOODS, buildMood, moodSoften } from '../lib/moods.js';
import { FOLLOW_STROKER, nextAction, parseTarget, sampleAt } from '../lib/outputs.js';

// Methods mixed into OggStudioCard.
export class ReplayPart {
  // ---------------------------------------------------------- record / replay
  // Replay runs here in the browser: the script moves the pads or the
  // stroke bar, every device that follows gets it its own way, and it works
  // with no device at all. Touching the pads or bar overrides it until let go.
  _bindReplay() {
    const $ = this._el;
    this._rp = { raw: null, conv: null, name: '', lib: null, playing: false, t: 0, len: 0, last: 0, outAt: 0 };
    let ctl = null;
    try { ctl = localStorage.getItem(`oggstudio_ctl:${this.localName}`); } catch (_) { /* private mode */ }
    const kept = this._simple ? ['pattern', 'mood', 'library'] : ['replay', 'mood', 'audio', 'together'];
    const modes = this._variant.modes;
    this._ctl = this._togetherOnly ? 'together' : modes ? (modes.includes(ctl) ? ctl : modes[0]) : kept.includes(ctl) ? ctl : 'record';
    for (const b of this.shadowRoot.querySelectorAll('.ctltabs button')) b.addEventListener('click', () => this._setCtl(b.dataset.ctl));
    $('rpspeed').replaceChildren(...SPEEDS.map((x) => new Option(x, x)));
    $('rpspeed').value = '1x';
    $('rppick').addEventListener('click', () => this._rpPicker(!$('rppop').hidden ? false : true));
    $('rpfile').addEventListener('change', () => this._rpFromFiles());
    $('rpplay').addEventListener('click', () => this._rpToggle());
    for (const b of this.shadowRoot.querySelectorAll('.moodbtn')) b.addEventListener('click', () => this._moodPlay(b.dataset.mood));
    $('moodnext').addEventListener('click', () => { if (this._mood) this._moodNext(!this._rp.playing); });
    $('moodstop').addEventListener('click', () => { this._plOff(); this._rpStop(); });
    let strength = 100;
    try { strength = Number(localStorage.getItem('oggstudio_mood_strength')) || 100; } catch (_) { /* private mode */ }
    $('moodstr').value = String(strength);
    const showStrength = () => { $('moodstrv').textContent = `${$('moodstr').value}%`; };
    showStrength();
    $('moodstr').addEventListener('input', showStrength);
    $('moodstr').addEventListener('change', () => { try { localStorage.setItem('oggstudio_mood_strength', $('moodstr').value); } catch (_) { /* private mode */ } });
    const bar = $('rpbar');
    const seek = (e) => { const r = bar.getBoundingClientRect(); this._rp.t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * this._rp.len; this._rpShow(); if (this._rp.playing) this._rpTick(); };
    bar.addEventListener('pointerdown', (e) => { if (!this._rp.raw) return; e.preventDefault(); capture(bar, e); seek(e); bar.dataset.drag = '1'; });
    bar.addEventListener('pointermove', (e) => { if (bar.dataset.drag) seek(e); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(type, () => { delete bar.dataset.drag; });
    this.shadowRoot.addEventListener('pointerdown', (e) => {
      if ($('rppop').hidden) return;
      const path = e.composedPath();
      if (!path.includes($('rppop')) && !path.includes($('rppick'))) this._rpPicker(false);
    });
    this._ctlShow();
    this._rpShow();
  }

  _setCtl(mode) {
    if (mode === this._ctl) return;
    const from = this._ctl;
    // One recording does not run across by-hand, the video's clock and the rest.
    if (from === 'record') {
      if (this._recording) this._stopRecording();
      if (this._stRecording) this._stStop();
      if (this._live) { this._el('live').checked = false; this._setLive(false); }
      if (this._el('stlive').checked) { this._el('stlive').checked = false; this._stRun(); }
    } else {
      this._plOff();
      this._rpStop();
      if (!this._simple) this._auStop();     // the Play card's sound is its own section
      this._ptStop();
      if (from === 'video') { this._hbKeep(true); const video = this._el('video'); if (!video.paused) video.pause(); this._vaSet(false); }
    }
    if (mode !== 'mood') this._mood = null;
    this._ctl = mode;
    try { localStorage.setItem(`oggstudio_ctl:${this.localName}`, mode); } catch (_) { /* private mode */ }
    this._ctlShow();
  }

  _ctlShow() {
    const $ = this._el;
    const ctl = this._ctl;
    const simple = this._simple;
    for (const b of this.shadowRoot.querySelectorAll('.ctltabs button')) b.classList.toggle('on', b.dataset.ctl === ctl);
    $('rpbox').hidden = !(ctl === 'replay' || (simple && ctl === 'library'));
    // The Library has its own play controls: here only the progress of what plays.
    $('rpbox').classList.toggle('lib', simple && ctl === 'library');
    $('ptbox').hidden = ctl !== 'pattern';
    $('moodbox').hidden = ctl !== 'mood';
    $('aubox').hidden = simple ? false : !(ctl === 'audio' || (ctl === 'video' && this._vaudio));
    if (simple) {
      // The video's sound sits under the video; any other sound in the Sound section.
      const home = this._vaudio ? $('vaubox') : $('sndbox');
      if ($('aubox').parentElement !== home) home.appendChild($('aubox'));
    }
    $('tgbox').hidden = simple ? false : ctl !== 'together';
    if (simple) { $('tlbox').hidden = false; $('plbox').hidden = false; }
    $('urecrow').hidden = true;      // its parts sit elsewhere on the Play card
    if (simple) {
      // Controls (pads or stroke bar), Video and Sound are all there; the
      // pads or stroke bar sit at the top of Controls, above the tabs.
      for (const sec of this.shadowRoot.querySelectorAll('[data-part="record"],[data-part="stroke"]')) {
        sec.classList.toggle('off', !this._parts.includes(sec.dataset.part));
        if (sec.parentElement !== $('ctlbox')) $('ctlbox').insertBefore(sec, $('ctlhead').nextSibling);
      }
      // Vibrate / Stroke sits with the devices.
      const kind = $('ukind');
      if (kind.parentElement !== $('outbody')) $('outbody').insertBefore(kind, $('outbody').firstChild);
      // Rec (and its time): left of "Drop to 0" under the pads, or under a stroker's speeds.
      const recHome = this._strokeKind ? this.shadowRoot.querySelector('[data-part="stroke"] .stside') : $('spring').closest('.row');
      if (recHome) {
        recHome.classList.add('urecslot');
        if ($('urec').parentElement !== recHome) recHome.insertBefore($('urec'), this._strokeKind ? null : recHome.firstChild);
        if ($('utimer').parentElement !== recHome) recHome.insertBefore($('utimer'), $('urec').nextSibling);
      }
      // The controller and Import live under Extras; the Library is a Controls tab.
      const gslot = $('xgpslot');
      const lib = this.shadowRoot.querySelector('section[data-part="library"]');
      if (lib.parentElement !== $('libslot')) $('libslot').appendChild(lib);
      lib.classList.toggle('off', ctl !== 'library');
      // Opening the Library shows the chosen script's preview.
      if (ctl === 'library' && !this._rp.raw && !this._rp.playing && !this._libPick) this._libPreview($('saved').value);
      // Together, the script tools and the queue have sections of their own.
      if ($('tgbox').parentElement !== $('tgsec')) $('tgsec').appendChild($('tgbox'));
      if ($('tlbox').parentElement !== $('tlslot')) $('tlslot').appendChild($('tlbox'));
      if ($('plbox').parentElement !== $('plslot')) $('plslot').appendChild($('plbox'));
      const imp = this.shadowRoot.querySelector('section[data-part="import"]');
      if (imp.parentElement !== $('extrabox')) $('extrabox').appendChild(imp);
      imp.classList.remove('off');
      if (gslot) gslot.appendChild($('gp'));
      $('gp').hidden = !gslot;
    }
    this._outRender();
    for (const id of ['rec', 'timer', 'strec', 'liverow', 'stliverow']) $(id).hidden = ctl !== 'record' || (simple && id !== 'liverow' && id !== 'stliverow');
    this._rpShow();
    if (simple) { $('stlive').checked = this._anyActive; this._vsideShow(); this._urecShow(); this._mediaShow(); }
  }

  _rpPicker(open) {
    const $ = this._el;
    if (!open) { $('rppop').hidden = true; return; }
    const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
    const names = ((saved && saved.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
    const item = (label, tag, fn, heat) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.heat = heat; b.innerHTML = `<span>${esc(label)}</span><small>${esc(tag)}</small>`; b.addEventListener('click', () => { this._plOff(); fn(); }); return b; };
    const items = [];
    if (this._take) items.push(item('Current take', `${isStroke(this._take) ? 'stroke' : 'vibration'} · ${fmt(duration(this._take))}`, () => this._rpLoad(this._take, 'Current take', null), '\u0000take'));
    for (const n of names) {
      const info = this._scriptInfo(n);
      items.push(item(n, info ? `${info.kind === 'stroke' ? 'stroke' : 'vibration'} · ${fmt(info.duration_ms || 0)}` : '', async () => {
        try { this._rpLoad(await this._getSaved(n), n, n); } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); }
      }, n));
    }
    if (!items.length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'No saved scripts yet: record one, or load a file below.'; items.push(d); }
    $('rplist').replaceChildren(...items);
    $('rppop').hidden = false;
    this._pickHeats();
  }

  async _rpFromFiles() {
    const files = [...this._el('rpfile').files];
    if (!files.length) return;
    try {
      const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
      const first = parsed[0];
      if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
      this._plOff();
      this._rpLoad(normalise(first, fileKind(files[0].name, 'auto'), Boolean(first.inverted)), fileTitle(files[0].name), null);
      if (this._libFileWait) { this._libPick = 'loaded'; this._libLoaded = fileTitle(files[0].name); this._update(); }
    } catch (e) { this._toast('Could not read the file: ' + (e.message || e)); }
    this._el('rpfile').value = '';
    this._libFileWait = false;
  }

  _rpLoad(script, name, lib) {
    this._rpStop();
    const rp = this._rp;
    rp.raw = script; rp.name = name; rp.lib = lib; rp.t = 0; rp.len = duration(script);
    const info = lib && this._scriptInfo(lib);
    rp.convs = {};
    this._useRemembered(lib, script);
    this._outRender();
    this._rpPicker(false);
    this._rpShow();
  }

  // The vibration version (pads in the vibrate view) of the loaded script.
  // Each output's value for a script at ms (vibrate view): a stroke script
  // is mapped per device by its follow type; a vibration script plays as
  // it is (its second track to the second output).
  // Each output's value for a script at ms: its track (the second output
  // takes a second track if there is one) mapped by that output's way of
  // following. Position (and a stroker) passes it straight through.
  _mapScript(raw, ms, cache) {
    if (raw.mood) {
      // A mood: vibrators get its vibration tracks (scaled by Strength), strokers its strokes.
      const k = this._moodStrength();
      return this._outIdx.map((i) => {
        const p = parseTarget(this._outTargetValue(i));
        this._aiLabel(i, null);
        if (p && p.motor === 'l') return moodSoften(sampleAt(raw.actions, ms), k, ms);
        return sampleAt(raw.mood.vibe[i % 2] || raw.mood.vibe[0], ms) * k;
      });
    }
    return this._outIdx.map((i) => {
      const v1 = (i % 2) && raw.channels && raw.channels.V1 && raw.channels.V1.actions;
      const second = Boolean(v1 && v1.length);
      const track = second ? v1 : raw.actions;
      const p = parseTarget(this._outTargetValue(i));
      const m = this._outAt(i).m;
      if (m === FOLLOW_AI) {
        // Stroke into a vibrator, or vibration into a stroker: by feel. Same kind: as it is.
        const linear = Boolean(p && p.motor === 'l');
        if (linear === isStroke(raw)) { this._aiLabel(i, null); return sampleAt(track, ms); }
        const key = `ai:${second ? 1 : 0}:${linear ? 's' : 'v'}`;
        if (!cache[key]) cache[key] = linear ? aiVibeToStroke(track) : aiStrokeToVibe(track);
        this._aiLabel(i, moodAt(cache[key].moods, ms));
        return sampleAt(cache[key].actions, ms);
      }
      this._aiLabel(i, null);
      if (m === FOLLOW_STROKER || m === 'position' || (p && p.motor === 'l')) return sampleAt(track, ms);
      const key = `${second ? 1 : 0}:${m}`;
      if (!cache[key]) cache[key] = toIntensity(track, m);
      return sampleAt(cache[key], ms);
    });
  }

  // A stroker's next move from a script at ms: its next action (or, with AI
  // feel on a vibration script, the next planned stroke) and how long to take.
  _moodStrength() { return Number(this._el('moodstr').value || 100) / 100; }

  _goalFrom(i, raw, ms, rate, cache) {
    const g = this._goalFromRaw(i, raw, ms, rate, cache);
    return g && this._simple && this._strokeKind ? { ...g, goal: this._lim(g.goal) } : g;
  }

  _goalFromRaw(i, raw, ms, rate, cache) {
    if (raw.mood) {
      const next = nextAction(raw.actions, ms);
      return next ? { goal: moodSoften(next.pos, this._moodStrength(), next.at), dur: (next.at - ms) / (rate || 1) } : null;
    }
    const v1 = (i % 2) && raw.channels && raw.channels.V1 && raw.channels.V1.actions;
    const second = Boolean(v1 && v1.length);
    let src = second ? v1 : raw.actions;
    if (this._outAt(i).m === FOLLOW_AI && !isStroke(raw)) {
      const key = `ai:${second ? 1 : 0}:s`;
      if (!cache[key]) cache[key] = aiVibeToStroke(src);
      src = cache[key].actions;
      this._aiLabel(i, moodAt(cache[key].moods, ms));
    }
    const next = nextAction(src, ms);
    return next ? { goal: next.pos, dur: (next.at - ms) / (rate || 1) } : null;
  }

  // Live AI feel per output (one engine each, restarted when stopped).
  _aiLiveFor(i, kind) {
    this._aiLive = this._aiLive || [];
    if (!this._aiLive[i] || this._aiLive[i].kind !== kind) this._aiLive[i] = new AiLive(kind);
    return this._aiLive[i];
  }

  // Stroke in -> vibration level by feel (stroke recorder, stroke video slider).
  _aiStroke(i, pos, vel) {
    const eng = this._aiLiveFor(i, 'stroke');
    const v = eng.level(performance.now(), pos, Math.sign(vel));
    this._aiLabel(i, eng.label);
    return v;
  }

  // What each output's AI feel is doing now, shown under it.
  _aiLabel(i, label) {
    this._aiLabels = this._aiLabels || [];
    this._aiLabels[i] = label;
    const now = performance.now();
    if (now - (this._aiShownAt || 0) < 250 || !this._el) return;
    this._aiShownAt = now;
    [...this.shadowRoot.querySelectorAll('.outai')].forEach((el, j) => {
      const l = this._outAt(j).m === FOLLOW_AI ? this._aiLabels[j] : null;
      el.hidden = !l;
      if (l && el.textContent !== `✨ ${l}`) el.textContent = `✨ ${l}`;
    });
  }

  // A live value (pad, slider) mapped by an output's way of following.
  _mapLive(i, value, vel) {
    const p = parseTarget(this._outTargetValue(i));
    const m = this._outAt(i).m;
    if (p && p.motor === 'l' && m === FOLLOW_AI) {
      // Vibration in, stroker out: strokes planned from the vibration's mood.
      const eng = this._aiLiveFor(i, 'vibe');
      const move = eng.move(performance.now(), value);
      this._aiLabel(i, eng.label);
      return move;
    }
    if (m === FOLLOW_AI) { this._aiLabel(i, null); return value; }   // vibration to a vibrator: as it is
    if (p && p.motor === 'l') return { goal: value, dur: 150 };
    if (m === FOLLOW_STROKER || m === 'position') return value;
    return Math.min(100, Math.max(0, liveIntensity(m, value, vel)));
  }

  // A level that is already an intensity (sound, a partner's slider): a
  // vibrator takes it as it is, whatever its way of following; a stroker
  // gets AI feel strokes, or goes to that position.
  _mapLevel(i, value) {
    const p = parseTarget(this._outTargetValue(i));
    if (p && p.motor === 'l') return this._mapLive(i, value, 0);
    return Math.min(100, Math.max(0, value));
  }

  // Pads (vibrate recorder, live): each output follows its pad its own way.
  _padOut() {
    const now = performance.now();
    this._padVel = this._padVel || [0, 0];
    this._padPrev = this._padPrev || [null, null];
    for (const k of [0, 1]) {
      const v = this._vals[k];
      const prev = this._padPrev[k];
      const dt = prev ? now - prev.at : 0;
      this._padVel[k] = this._padVel[k] * 0.6 + (dt > 0 ? (v - prev.v) / dt * 1000 : 0) * 0.4;
      this._padPrev[k] = { v, at: now };
    }
    // Devices 1 and 3 follow the first pad, 2 and 4 the second.
    const out = this._outIdx.map((i) => (i % 2 && !this._twoPads ? null : this._mapLive(i, this._vals[i % 2], this._padVel[i % 2])));
    this._outApply(out, 1.0);
  }

  // A saved stroke script's remembered run mode becomes the first device's follow type.
  _useRemembered(lib, script) {
    const info = lib && this._scriptInfo(lib);
    const p = parseTarget(this._outTargetValue(0));
    if (info && info.mode && RUN_MODES[info.mode] && isStroke(script) && p && p.motor !== 'l' && this._outs[0]) { this._outs[0].m = info.mode; this._outSave(); }
  }

  // The script converted with one run mode (cached per mode).
  _rpConv(mode) {
    const rp = this._rp;
    rp.convs = rp.convs || {};
    if (!rp.convs[mode]) rp.convs[mode] = runScript(rp.raw, mode);
    return rp.convs[mode];
  }

  _rpToggle() { if (this._rp.playing) { this._plOff(); this._rpStop(); } else this._rpPlay(); }

  // A mood: one of its three combos at random (a different one each time).
  _moodPlay(key) {
    if (this._mood && this._mood.key === key && this._rp.playing) { this._rpStop(); return; }   // tap again: stop
    this._setCtl('mood');
    this._mood = { key, combo: -1 };
    this._moodNext(true);
  }

  _moodNext(start) {
    const mood = MOODS[this._mood.key];
    let i;
    do { i = Math.floor(Math.random() * mood.combos.length); } while (mood.combos.length > 1 && i === this._mood.combo);
    this._mood.combo = i;
    const [name, sections] = mood.combos[i];
    const built = buildMood(sections, aiRandom((Math.random() * 2 ** 32) >>> 0));
    const title = `${mood.label}: ${name}`;
    const script = { version: '1.0', inverted: false, range: 100, actions: built.stroke,
      metadata: { creator: 'OggStudio', type: 'stroke', title }, mood: { vibe: built.vibe } };
    const rp = this._rp;
    if (!start && rp.playing) { rp.raw = script; rp.name = title; rp.len = duration(script); rp.t = 0; rp.convs = {}; this._rpShow(); return; }
    this._rpLoad(script, title, null);
    this._el('rpspeed').value = '1x';
    this._rpPlay();
  }

  _rpPlay() {
    const rp = this._rp;
    if (!rp.raw) { this._rpPicker(true); return; }
    if (rp.t >= rp.len) rp.t = 0;
    this._ptStop();
    if (this._simple) this._soundOff();
    const video = this._el('video');
    if (video && !video.paused && !this._simple) video.pause();     // one thing drives the devices at a time (the Play card's video plays on)
    if (rp.lib && isStroke(rp.raw) && RUN_MODES[this._outAt(0).m]) this._setMode(rp.lib, this._outAt(0).m);
    rp.playing = true;
    this._outRender();
    rp.last = performance.now();
    rp.outAt = 0;
    clearInterval(this._rpTimer);
    this._rpTimer = setInterval(() => this._rpTick(), GP_POLL_MS);
    this._rpTick();
    this._rpShow();
  }

  _rpStop() {
    const rp = this._rp;
    if (!rp || !rp.playing) return;
    rp.playing = false;
    clearInterval(this._rpTimer);
    this._rpTimer = null;
    this._outStop();
    this._stOutAt = 0;
    if (this._st) this._stRun();     // lets the stroke timer stop if nothing else needs it
    this._outRender();
    this._rpShow();
  }

  _rpSpeed() { return parseFloat(this._el('rpspeed').value) || 1; }

  // Raw position (stroke view) at the replay time.
  _rpPos() {
    const rp = this._rp;
    if (!rp.raw) return 0;
    const pos = sampleAt(rp.raw.actions, rp.t);
    return rp.raw.mood ? moodSoften(pos, this._moodStrength(), rp.t) : pos;
  }

  // A stroker's next move from the script: the next action and how long to get there.
  _rpGoal() {
    const rp = this._rp;
    const next = rp.raw && nextAction(rp.raw.actions, rp.t);
    return next ? { goal: next.pos, dur: (next.at - rp.t) / this._rpSpeed() } : null;
  }

  _rpTick() {
    const rp = this._rp;
    if (!rp.playing || !this._el) return;
    const now = performance.now();
    rp.t += Math.min(250, now - rp.last) * this._rpSpeed();
    rp.last = now;
    if (rp.t >= rp.len && this._pl && this._pl.on) { rp.t = rp.len; this._plNext(); return; }   // next in the queue
    if (rp.t >= rp.len && rp.raw.mood && this._mood) { this._moodNext(false); return; }   // next combo of the mood
    if (rp.t >= rp.len) {
      if (this._el('rploop').checked && rp.len > 0) rp.t = 0;
      else { rp.t = rp.len; this._rpStop(); this._toast(`Replay of "${rp.name}" finished.`); return; }
    }
    if (this._strokeKind) {
      this._stRun();                 // the stroke timer moves the bar and drives the devices
    } else if (rp.raw) {
      // Vibrate view: each device (and its pad) follows its own way; a
      // vibration script plays as it is (second track on pad 2).
      const targets = this._outIdx.map((i) => parseTarget(this._outTargetValue(i)));
      const vals = this._mapScript(rp.raw, rp.t, rp.convs || (rp.convs = {}));
      for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, vals[i]);
      if (now - rp.outAt >= 100 || targets.some((t) => t && t.motor === 'l')) {
        if (now - rp.outAt >= 100) rp.outAt = now;
        const out = this._outIdx.map((i) => {
          const k = i % 2;
          if (targets[i] && targets[i].motor === 'l') return (this._padActive && this._padActive[k]) ? { goal: this._vals[k], dur: 150 } : (this._goalFrom(i, rp.raw, rp.t, this._rpSpeed(), rp.convs) || { goal: this._vals[k], dur: 150 });
          return i < 2 || (this._padActive && this._padActive[k]) ? this._vals[k] : vals[i];
        });
        this._outApply(out, 0.6);
      }
    }
    if (now - (rp.shownAt || 0) >= 100) { rp.shownAt = now; this._rpShow(); }
  }

  _rpShow() {
    if (this._el) this._el('rpbox').classList.toggle('empty', !(this._rp && this._rp.raw));
    if (this._simple && this._mediaShow) this._mediaShow();
    if (!this._el || !this._rp) return;
    const $ = this._el;
    const rp = this._rp;
    $('rpname').textContent = rp.raw ? rp.name : 'Choose a script…';
    this._heatShow();
    $('rpfill').style.width = rp.len ? `${Math.min(100, rp.t / rp.len * 100)}%` : '0';
    const kind = rp.raw ? (isStroke(rp.raw) ? 'stroke script' : 'vibration script') : '';
    const parts = rp.raw ? [`${fmt(rp.t)} / ${fmt(rp.len)}`, kind] : ['Pick a saved script, the current take or a file'];
    if (rp.raw && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) parts.push('no device: showing only');
    if (rp.playing) parts.push(this._strokeKind ? 'touch the bar or a speed to take over' : 'touch a pad to take over');
    $('rpinfo').textContent = parts.join(' · ');
    $('rpplay').textContent = rp.playing ? '■ Stop' : '▶ Replay';
    const mood = this._mood && MOODS[this._mood.key];
    for (const b of this.shadowRoot.querySelectorAll('.moodbtn')) b.classList.toggle('on', Boolean(mood && rp.playing && b.dataset.mood === this._mood.key));
    $('moodfill').style.width = mood && rp.len ? `${Math.min(100, rp.t / rp.len * 100)}%` : '0';
    $('moodinfo').textContent = mood
      ? `${mood.icon} ${rp.name} (${this._mood.combo + 1} of ${mood.combos.length}) · ${fmt(rp.t)} / ${fmt(rp.len)}${rp.playing ? '' : ' · stopped'}`
      : 'Pick how you want it to feel. Each mood has three combos, picked at random; a new one follows when it ends.';
    $('rpplay').classList.toggle('stop', rp.playing);
  }
}
