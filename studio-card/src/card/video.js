// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { FOLLOW_AI } from '../lib/ai.js';
import { RUN_MODE_DEFAULT, fileKind, isStroke, liveIntensity, normalise } from '../lib/convert.js';
import { DEVICE_KEY, LIB_FILE, LIB_LOADED, LIB_TAKE, LIVE_MS, NO_DEVICE, SPEEDS, TAKE_SRC, VIDEO_OFFSET_KEY, VIDEO_TICK_MS, capture, decodeText, duration, fmt } from '../lib/core.js';
import { FOLLOW_STROKER, mergePasses, parseTarget, sampleAt } from '../lib/outputs.js';

// Methods mixed into OggStudioCard.
export class VideoPart {
  // ---------------------------------------------------------- video sync
  _bindVideo() {
    const $ = this._el;
    const video = $('video');
    let offset = 150;
    try { const saved = Number(localStorage.getItem(VIDEO_OFFSET_KEY)); if (Number.isFinite(saved) && localStorage.getItem(VIDEO_OFFSET_KEY) !== null) offset = saved; } catch (_) { /* private mode */ }
    $('voff').value = String(offset);
    const showOffset = () => { $('voffv').textContent = `${Number($('voff').value) > 0 ? '+' : ''}${$('voff').value} ms`; };
    showOffset();
    $('voff').addEventListener('input', () => {
      showOffset();
      try { localStorage.setItem(VIDEO_OFFSET_KEY, $('voff').value); } catch (_) { /* private mode */ }
      this._videoSend(true);
    });
    $('vfile').addEventListener('change', () => {
      const file = $('vfile').files[0];
      this._vname = file ? file.name.replace(/\.[^.]+$/, '') : '';
      this._vfileObj = file || null;
      if (this._cast) this._castEnd(true);
      this._castUnlink();
      this._castUnprep();
      this._videoHalt();
      if (this._vrec) this._vrecToggle();
      if (this._vrecHas()) this._vrecReset();
      if (this._vurl) URL.revokeObjectURL(this._vurl);
      this._vurl = file ? URL.createObjectURL(file) : null;   // local only, never uploaded
      video.hidden = !file;
      if (file) { video.src = this._vurl; video.load(); } else { video.removeAttribute('src'); }
      this._videoStatus();
      if (file) this._matchVideoScript();
    });
    $('vsrc').addEventListener('change', () => this._loadVideoScript());
    $('vscriptfile').addEventListener('change', () => this._loadVideoScript());
    $('vgo').addEventListener('click', () => this._videoGo());
    $('vstop').addEventListener('click', () => {
      if (this._cast) this._castEnd(true);      // Stop also stops the TV
      video.pause(); try { video.currentTime = 0; } catch (_) { /* not loaded */ } this._videoHalt();
    });
    video.addEventListener('play', () => this._castCmd('media_play'));
    video.addEventListener('pause', () => { if (!video.ended) this._castCmd('media_pause'); });
    video.addEventListener('seeked', () => this._castCmd('media_seek', { seek_position: Math.round(video.currentTime * 10) / 10 }));
    video.addEventListener('play', () => this._videoRun());
    video.addEventListener('playing', () => this._videoRun());
    video.addEventListener('pause', () => this._videoHalt());
    video.addEventListener('ended', () => this._videoHalt());
    video.addEventListener('emptied', () => this._videoHalt());
    video.addEventListener('seeked', () => this._videoSend(true));
    video.addEventListener('timeupdate', () => this._videoStatus());
    video.addEventListener('loadedmetadata', () => this._videoStatus());
    // Recording against the video clock.
    this._hvals = [0, 0];
    this._vpasses = [[], []];
    this._bindHBar($('hb1'), 0);
    this._bindHBar($('hb2'), 1);
    video.addEventListener('seeking', () => this._vrecBreak());
    $('vrec').addEventListener('click', () => this._vrecToggle());
    $('vrecuse').addEventListener('click', () => this._vrecUse());
    $('vrecdl').addEventListener('click', () => this._vrecDownload());
    $('vrecclear').addEventListener('click', () => { if (confirm('Discard this recording?')) this._vrecReset(); });
    this._bindCast();
  }

  async _loadVideoScript() {
    const $ = this._el;
    const fromFile = $('vsrc').value === '';
    $('vfilebox').hidden = !fromFile;
    this._vraw = null;
    try {
      if (fromFile) {
        const files = [...$('vscriptfile').files];
        if (!files.length) { this._vscript = null; this._videoStatus(); return; }
        const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
        const first = parsed[0];
        if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
        this._vraw = normalise(first, fileKind(files[0].name, 'auto'), Boolean(first.inverted));
        this._vscriptName = files[0].name;
      } else if ($('vsrc').value === TAKE_SRC) {
        if (!this._take) { this._vscript = null; this._videoStatus(); return; }
        this._vraw = this._take;
        this._vscriptName = 'Current take';
      } else {
        this._vraw = await this._getSaved($('vsrc').value);
        this._vscriptName = $('vsrc').value;
      }
      this._vscript = this._vraw;      // mapped per device as it plays
      this._vconvs = {};
      if (!fromFile && $('vsrc').value !== TAKE_SRC) this._useRemembered($('vsrc').value, this._vraw);
      this._outRender();
      this._videoSend(true);
    } catch (e) {
      this._vscript = null;
      this._toast('Could not load the script: ' + (e.message || e));
    }
    this._videoStatus();
  }


  // Is the outputs box in a recorder on this card? Then the video drives
  // those devices (with their follow modes); else the playback device.
  get _outsHere() { const box = this._el && this._el('outbox'); return Boolean(box && box.parentElement && box.parentElement.classList.contains('outslot')); }

  // Video slider value: what it records, or what the script is doing now
  // (position for a stroke script in the stroke view, else intensity).
  _videoValue() {
    if (this._vHeld) return this._hvals[0];
    const video = this._el('video');
    const ms = video.currentTime * 1000 + Number(this._el('voff').value || 0);
    if (!this._vraw) return 0;
    if (this._strokeKindRec && isStroke(this._vraw)) return sampleAt(this._vraw.actions, ms);
    return this._mapScript(this._vraw, ms, this._vconvs || (this._vconvs = {}))[0];
  }

  get _strokeKindRec() { return this._recKind === 'stroke'; }

  // The slider has the devices: recording with it, or holding it over a script.
  get _vHeld() { return Boolean(this._vrec || this._hbActive || (this._tap && this._tap.video && !this._vraw)); }

  // Drive the follow-along devices from the video (outputs on this card).
  _videoOut() {
    if (this._au) return;          // Audio mode has the devices (the video's own sound drives them)
    if (this._simple && this._ctlBusy && this._vsHand == null && this._vvHand == null) return;   // the controls have the devices
    const now = performance.now();
    const value = this._videoValue();
    const dt = now - (this._vOutAt || now);
    const vel = dt > 0 ? (value - (this._vOutPos ?? value)) / dt * 1000 : 0;
    this._vOutAt = now; this._vOutPos = value;
    this._vVel = (this._vVel || 0) * 0.6 + vel * 0.4;
    const video = this._el('video');
    const ms = video.currentTime * 1000 + Number(this._el('voff').value || 0);
    const script = !this._vHeld && this._vraw && isStroke(this._vraw);
    if (this._vsOn && (!this._vraw || (this._vvHand !== null && this._vvHand !== undefined && !this._strokeKind) || (this._vsHand !== null && this._vsHand !== undefined && this._strokeKind))) return;    // the range and speed (or a finger) drive it
    if (this._strokeKindRec) {
      const values = this._outs.map((o, i) => {
        const p = parseTarget(this._outTargetValue(i));
        if (!p) return null;
        const cache = this._vconvs || (this._vconvs = {});
        if (p.motor === 'l') {
          return (script && this._goalFrom(i, this._vraw, ms, video.playbackRate, cache)) || { goal: this._simple ? this._lim(value) : value, dur: 120 };
        }
        if (o.m === FOLLOW_AI) return script ? this._mapScript(this._vraw, ms, cache)[i] : this._aiStroke(i, value, this._vVel);
        if (o.m === FOLLOW_STROKER) return this._simple ? this._lim(value) : value;
        return Math.min(100, Math.max(0, liveIntensity(o.m, value, this._vVel)));
      });
      this._outApply(values, 0.6);
      // The stroke bar shows it too (unless you are moving it).
      const st = this._st;
      if (st && st.drag === null && this._stSpeed() === null) { st.pos = this._simple ? this._lim(value) : value; this._stShow(); }
    } else {
      const held = this._vHeld;
      if (held) {
        // The slider, mapped per device like the pads.
        const h = this._hvals[0];
        for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, h);
        this._outApply(this._outIdx.map((i) => this._mapLive(i, h, this._vVel)), 0.6);
        return;
      }
      let vals = this._mapScript(this._vraw || { actions: [] }, ms, this._vconvs || (this._vconvs = {}));
      if (this._simple && this._vraw) { vals = vals.map((v) => this._vvScale(v)); if (this._vsRange) this._vsRange.pos = vals[0]; }
      for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, vals[i]);
      const out = this._outIdx.map((i) => {
        const p = parseTarget(this._outTargetValue(i));
        if (p && p.motor === 'l') {
          return (this._vraw && this._goalFrom(i, this._vraw, ms, video.playbackRate, this._vconvs || (this._vconvs = {}))) || { goal: this._vals[i % 2], dur: 150 };
        }
        return i < 2 ? this._vals[i] : vals[i];
      });
      this._outApply(out, 0.6);
    }
  }

  _videoSend(force) {
    const video = this._el && this._el('video');
    if (!this._vsyncTimer || !video || video.paused) { this._videoStatus(); return; }
    if (this._vrec) this._vrecSample();
    if (!this._vrec && !this._hbActive) this._showHBar(0, this._videoValue());
    this._videoOut();
    this._videoStatus();
  }

  _videoRun() {
    if (this._vsyncTimer || !(this._vscript || this._vrec || this._tap)) return;
    if (this._rp) this._rpStop();
    if (this._live) { this._el('live').checked = false; this._setLive(false); }
    this._vlast = null;
    this._vsentAt = 0;
    this._vsyncTimer = setInterval(() => this._videoSend(false), VIDEO_TICK_MS);
    this._videoSend(true);
  }

  _videoHalt() {
    this._vrecBreak();
    if (!this._vsyncTimer) return;
    clearInterval(this._vsyncTimer);
    this._vsyncTimer = null;
    this._vlast = null;
    this._outStop();
    this._videoStatus([0, 0]);
  }

  _showHBar(index, value) {
    const bar = this._el('hb' + (index + 1));
    const v = Math.round(Math.min(100, Math.max(0, value)));
    bar.querySelector('.fill').style[bar.classList.contains('vert') ? 'height' : 'width'] = v + '%';
    bar.style.setProperty('--v', String(v));
    bar.querySelector('.pct').textContent = v + '%';
    bar.setAttribute('aria-valuenow', String(v));
  }

  _setHBar(index, value) {
    this._hvals[index] = Math.round(Math.min(100, Math.max(0, value)));
    this._showHBar(index, this._hvals[index]);
    if (this._vHeld) { if (this._vsyncTimer) this._videoSend(false); else this._videoOut(); }
  }

  _bindHBar(bar, index) {
    let active = false;
    const fromEvent = (event) => {
      const rect = bar.getBoundingClientRect();
      this._setHBar(index, bar.classList.contains('vert') ? ((rect.bottom - event.clientY) / rect.height) * 100 : ((event.clientX - rect.left) / rect.width) * 100);
    };
    const pct = (event) => { const rect = bar.getBoundingClientRect(); return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)); };
    bar.addEventListener('pointerdown', (event) => {
      if (this._vsOn) {
        // The Play cards: hold to set the position or intensity by hand.
        event.preventDefault();
        active = true;
        bar.classList.add('active');
        capture(bar, event);
        this._vsHandSet(pct(event));
        this._showHBar(index, pct(event));
        if (this._vsWake) this._vsWake();
        return;
      }
      // Record with it, or take over a script that is playing (until let go).
      const playing = Boolean(this._vsyncTimer && this._vscript);
      const tapping = Boolean(this._tap && this._tap.video);
      // The Play card: the slider beside the video drives the devices any time.
      if (this._simple && !this._vurl) { this._toast('Choose a video first'); return; }
      if (!this._simple && !this._vrec && !playing && !tapping) { this._toast('Press ● Rec first to record with the slider (or play a script to take it over)'); return; }
      event.preventDefault();
      active = true;
      if (!this._vrec) this._hbActive = true;
      bar.classList.add('active');
      capture(bar, event);
      fromEvent(event);
      this._hbKeep();
    });
    bar.addEventListener('pointermove', (event) => {
      if (!active) return;
      if (this._vsOn) { this._vsHandSet(pct(event)); this._showHBar(index, pct(event)); } else fromEvent(event);
    });
    const release = () => {
      if (!active) return;
      active = false;
      bar.classList.remove('active');
      if (this._vsOn) { this._vsHandSet(null); return; }
      this._hbKeep(true);
      if (this._hbActive) {
        this._hbActive = false;
        if (((this._tap && this._tap.video) || this._simple) && !this._vraw && this._el('vspring').checked) this._setHBar(index, 0);
        this._videoSend(true);       // back to the script
        if (!this._vsyncTimer) { if (this._el('vspring').checked) this._outStop(); else this._hbKeep(); }
        return;
      }
      if (this._el('vspring').checked) this._setHBar(index, 0);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(type, release);
    bar.addEventListener('contextmenu', (event) => event.preventDefault());
    bar.addEventListener('keydown', (event) => {
      if (!this._vrec) return;
      const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 20, PageDown: -20 };
      if (event.key in steps) { this._setHBar(index, this._hvals[index] + steps[event.key]); event.preventDefault(); }
      else if (event.key === 'Home') { this._setHBar(index, 0); event.preventDefault(); }
      else if (event.key === 'End') { this._setHBar(index, 100); event.preventDefault(); }
    });
  }

  // Held over a paused video, or one with nothing else driving it: keep
  // the devices fed at the slider's level until let go.
  _hbKeep(stop) {
    clearInterval(this._hbTimer); this._hbTimer = null;
    if (stop || !this._simple) return;
    const tick = () => {
      if (this._vsyncTimer) return;          // the video's own clock is sending
      if (!this._hbActive && !this._vrec && !this._el('vspring').checked && this._hvals[0] > 0) { this._hbActive = true; this._videoOut(); this._hbActive = false; return; }
      if (this._vHeld) this._videoOut();
    };
    tick();
    this._hbTimer = setInterval(tick, VIDEO_TICK_MS);
  }

  _vrecToggle() {
    const $ = this._el;
    if (!this._vurl) { this._toast('Choose a video first'); return; }
    this._vrec = !this._vrec;
    if (!this._vrec) this._vrecBreak();
    this._vcur = null;
    $('vrec').classList.toggle('on', this._vrec);
    $('vrec').textContent = this._vrec ? '■ Stop rec' : '● Rec';
    for (const id of ['hb1', 'hb2']) $(id).classList.toggle('rec', this._vrec);
    if (this._vrec) {
      this._setHBar(0, 0); this._setHBar(1, 0);
      this._toast('Recording: play the video and drag the bars.');
      if (!$('video').paused) { this._videoHalt(); this._videoRun(); }
    } else {
      this._toast(this._vrecHas() ? 'Recording stopped. Use it as a take, download it, or press ● Rec to add more.' : '');
      const video = $('video');
      if (!video.paused) { clearInterval(this._vsyncTimer); this._vsyncTimer = null; this._videoRun(); }
    }
    this._videoStatus();
  }

  // Sample the bars at the video's own time (only while it plays).
  _vrecSample() {
    const video = this._el('video');
    if (!this._vrec || video.paused || video.seeking) return;
    const at = Math.round(video.currentTime * 1000);
    if (!this._vcur) this._vcur = [[], []];
    for (const i of [0]) {
      const pass = this._vcur[i];
      const pos = this._hvals[i];
      const last = pass[pass.length - 1];
      if (!last || last.pos !== pos) pass.push({ at, pos });
      else if (last.at > at) pass.push({ at, pos });
      this._vcurEnd = at;
    }
  }

  // Close the current pass (pause, seek or stop) so a later pass can replace it.
  _vrecBreak() {
    if (!this._vcur) return;
    this._vrecSample();
    this._vcur.forEach((pass, i) => {
      if (!pass.length) return;
      const end = Math.max(this._vcurEnd || 0, pass[pass.length - 1].at);
      if (end > pass[pass.length - 1].at) pass.push({ at: end, pos: pass[pass.length - 1].pos });
      this._vpasses[i].push(pass);
    });
    this._vcur = null;
  }

  _vrecHas() { return this._vpasses[0].some((p) => p.length) || this._vpasses[1].some((p) => p.length); }

  _vrecScript() {
    this._vrecBreak();
    const main = mergePasses(this._vpasses[0]);
    if (!main.length) return null;
    const end = main[main.length - 1].at;
    const stroke = this._strokeKindRec;       // the slider recorded position (stroke) or intensity
    if (!stroke && main[main.length - 1].pos !== 0) main.push({ at: end + 1, pos: 0 });
    const script = { version: '1.0', inverted: false, range: 100, actions: main,
      metadata: { creator: 'OggStudio', type: stroke ? 'stroke' : 'vibration', ...(this._vname ? { title: this._vname } : {}) } };
    const second = mergePasses(this._vpasses[1]);
    if (second.length) {
      if (second[second.length - 1].pos !== 0) second.push({ at: second[second.length - 1].at + 1, pos: 0 });
      script.channels = { V1: { actions: second } };
    }
    return script;
  }

  _vrecInfo() {
    const $ = this._el;
    const has = this._vrecHas() || Boolean(this._vcur && this._vcur[0].length);
    $('vrecdone').hidden = this._vrec || !has;
    const merged = has ? mergePasses([...this._vpasses[0], ...(this._vcur ? [this._vcur[0]] : [])]) : [];
    const passes = this._vpasses[0].filter((p) => p.length).length + (this._vcur && this._vcur[0].length ? 1 : 0);
    $('vrecinfo').textContent = has
      ? `${fmt(merged.length ? merged[merged.length - 1].at - merged[0].at : 0)} recorded${passes > 1 ? ` · ${passes} passes` : ''}`
      : (this._vrec ? 'Play the video to record' : '');
  }

  _vrecUse() {
    const script = this._vrecScript();
    if (!script) return;
    this._take = script;
    this._vraw = script;
    this._vscript = script;          // replay it with the video straight away
    this._vconvs = {};
    this._el('name').value = this._vname || '';
    this._vrecReset();
    this._toast(`Recorded ${fmt(duration(script))}. It is now the current take (save it below) and plays with this video.`);
    this._update();
  }

  _vrecDownload() {
    const script = this._vrecScript();
    if (script) this._download(script, this._vname || 'oggstudio');
  }

  _vrecReset() {
    this._vpasses = [[], []];
    this._vcur = null;
    this._videoStatus();
  }

  async _videoGo() {
    const $ = this._el;
    const video = $('video');
    if (!this._vurl) { this._toast('Choose a video first'); return; }
    if (!this._vscript && !this._vrec && !this._simple) { this._toast('Choose a script first, or press ● Rec to make one'); return; }
    try {
      if (video.ended) video.currentTime = 0;
      await video.play();          // the play event starts the sync
    } catch (e) { this._toast('The browser would not start the video: ' + (e.message || e)); }
  }

  _videoStatus(levels) {
    if (!this._el) return;
    const $ = this._el;
    const video = $('video');
    $('hb2').hidden = true;      // one slider: position or intensity, as chosen above
    const lab = this._strokeKindRec ? 'Position' : 'Intensity';
    const labEl = $('hb1').querySelector('.lab');
    if (labEl.textContent !== lab) labEl.textContent = lab;
    if (levels && !this._vrec && !this._hbActive && !this._outsHere && !(this._vsyncTimer && this._vscript)) this._showHBar(0, (levels[0] || 0) * 100);
    const parts = [];
    if (this._cast) {
      const c = this._cast;
      const tv = this._castName(c.entity);
      const st = this._hass && this._hass.states[c.entity];
      const mb = c.sent ? ` · streamed ${Math.round(c.sent / 1048576)} MB` : '';
      parts.push(c.phase === 'starting' ? `📺 starting on ${tv}…${mb}` : `📺 ${tv}: ${st ? st.state : '?'}${mb}`);
    }
    if (this._vscript) parts.push(`Script ${fmt(duration(this._vscript))}`);
    if (this._vurl && Number.isFinite(video.duration)) parts.push(`video ${fmt(video.duration * 1000)}`);
    if (this._vsyncTimer && levels) parts.push(`now ${levels.map((v) => Math.round(v * 100) + '%').join(' / ')}`);
    else if (this._vurl && this._vscript) parts.push('ready');
    $('vstat').textContent = parts.join(' · ');
    $('vgo').disabled = !(this._vurl && (this._vscript || this._vrec));
    this._vrecInfo();
    this._vsideShow();
  }

  get _noDevice() { return this._deviceId === NO_DEVICE; }
  get _device() { return this._noDevice ? null : this._devices.find((d) => d.id === this._deviceId) || this._devices[0] || null; }

  // Remember the chosen device per Home Assistant user (follows you across
  // phones), with a per-browser fallback when user data is unavailable.
  _rememberDevice(dev) {
    if (!dev) return;
    const value = { id: dev.id, name: dev.name };
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(value)); } catch (_) { /* private mode */ }
    this._remembered = value;
    this._hass?.callWS({ type: 'frontend/set_user_data', key: DEVICE_KEY, value }).catch(() => {});
  }

  async _loadRemembered() {
    try { this._remembered = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (_) { this._remembered = null; }
    try {
      const res = await this._hass.callWS({ type: 'frontend/get_user_data', key: DEVICE_KEY });
      if (res && res.value && res.value.id) this._remembered = res.value;
    } catch (_) { /* older HA or no permission: keep the browser copy */ }
    this._rememberedLoaded = true;
    this._update();
  }

  _online(dev) {
    return Boolean(dev) && (!dev.connected || this._hass.states[dev.connected]?.state === 'on');
  }

  _pickDevice() {
    const list = this._devices;
    const known = (id) => list.find((d) => d.id === id);
    if (this._deviceId && (this._deviceId === NO_DEVICE || known(this._deviceId))) return this._deviceId;
    const saved = this._remembered;
    if (saved && saved.id === NO_DEVICE) return NO_DEVICE;
    const savedDev = saved && (known(saved.id) || list.find((d) => d.name === saved.name));
    if (savedDev) return savedDev.id;
    const wanted = this._config && this._config.device;
    const match = wanted && list.find((d) => d.stop === wanted || d.name === wanted);
    if (match) return match.id;
    const online = list.find((d) => this._online(d));
    if (online || list[0]) return (online || list[0]).id;
    return this._registryDone ? NO_DEVICE : undefined;   // none at all: record only
  }

  _update() {
    if (!this._el || !this._hass) return;
    const $ = this._el;
    this._safetyUpdate();
    this._toolsUpdate();
    this._fillVideoScripts();
    const sel = $('device');
    const key = JSON.stringify([this._rememberedLoaded, ...this._devices.map((d) => [d.id, d.name, this._online(d)])]);
    if (sel.dataset.key !== key) {
      // Connected devices first; ones Ogg can't reach are marked offline.
      const ordered = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
      sel.replaceChildren(...ordered.map((d) => new Option(this._online(d) ? d.name : `${d.name} (offline)`, d.id)),
        new Option('No device (record only)', NO_DEVICE));
      sel.dataset.key = key;
      // Wait for the remembered choice before falling back to a default.
      if (this._rememberedLoaded) this._deviceId = this._pickDevice();
    }
    if (this._deviceId) sel.value = this._deviceId;
    const dev = this._device;
    const online = dev && (!dev.connected || this._hass.states[dev.connected]?.state === 'on');
    $('takeplay').disabled = !this._take;
    // Someone else took over a device this card was driving: let it go quietly.
    for (const [stop, d] of this._claimed) {
      const c = this._claimedBy(d);
      if (c) { this._claimed.delete(stop); this._toast(`${c.label || 'Another controller'} took control of ${d.name}.`); }
    }
    this._outRender();
    $('rec').textContent = this._recording ? '■ Stop recording' : '● Record';
    $('rec').classList.toggle('on', this._recording);
    $('takebox').hidden = !this._take;
    if (this._take) {
      const kind = isStroke(this._take) ? 'stroke script' : `${this._take.channels ? 2 : 1} motor${this._take.channels ? 's' : ''}`;
      $('takeinfo').textContent = `${fmt(duration(this._take))} · ${kind} · ${this._take.actions.length} points · not saved`;
    }
    this._urecShow();
    $('takemodebox').hidden = true;     // each device has its own follow type now
    const saved = this._studio && this._hass.states[this._studio.saved];
    const opts = (saved && saved.attributes.options) || [];
    // The Play card's Library also offers the current take and a file from this device.
    const extra = this._simple ? [...(this._take ? [[LIB_TAKE, '● Current take']] : []), ...(this._libLoaded ? [[LIB_LOADED, `📄 ${this._libLoaded}`]] : []), [LIB_FILE, '📂 From this device…']] : [];
    const savedKey = JSON.stringify([opts, extra]);
    if ($('saved').dataset.key !== savedKey) { $('saved').replaceChildren(...extra.map(([v, t]) => new Option(t, v)), ...opts.map((o) => new Option(o, o))); $('saved').dataset.key = savedKey; }
    if (this.shadowRoot.activeElement !== $('saved')) {
      const pick = this._libPick === 'take' && this._take ? LIB_TAKE : this._libPick === 'loaded' && this._libLoaded ? LIB_LOADED : null;
      if (pick) $('saved').value = pick; else if (saved) $('saved').value = saved.state;
    }
    // The Library shows the chosen script's preview once the list is here.
    if (this._simple && this._ctl === 'library' && this._rp && !this._rp.raw && !this._rp.playing && !this._libPick && saved && saved.state && this._libWant !== saved.state) this._libPreview(saved.state);
    const hasSaved = saved && saved.attributes.scripts && Object.keys(saved.attributes.scripts).length > 0;
    for (const id of ['code', 'delete']) $(id).disabled = !hasSaved;
    if (this._simple && this._libPick) { $('delete').disabled = true; $('code').disabled = false; }
    if (this._simple) $('libsavebox').hidden = !(this._libPick === 'take' && this._take);
    $('play').disabled = !hasSaved;
    // Stroke scripts: show the run mode, set to the one last used for it.
    const info = this._scriptInfo($('saved').value);
    $('libmodebox').hidden = true;
    const modeKey = `${$('saved').value}|${info && info.mode}`;
    if (info && info.kind === 'stroke' && $('libmode').dataset.key !== modeKey && this.shadowRoot.activeElement !== $('libmode')) {
      $('libmode').value = info.mode || RUN_MODE_DEFAULT;
      $('libmode').dataset.key = modeKey;
    }
    this._stShow();
    if (!$('speed').options.length) $('speed').replaceChildren(...SPEEDS.map((s) => new Option(s, s)));
    const speed = this._studio && this._hass.states[this._studio.speed];
    if (speed && this.shadowRoot.activeElement !== $('speed')) $('speed').value = speed.state;
  }

  _setPad(index, value) {
    const pad = this._el('pad' + (index + 1));
    const v = Math.round(Math.min(100, Math.max(0, value)));
    this._vals[index] = v;
    pad.querySelector('.fill').style.height = v + '%';
    pad.querySelector('.pct').textContent = v + '%';
    pad.setAttribute('aria-valuenow', String(v));
  }

  _bindPad(pad, index) {
    let active = false;
    const fromEvent = (event) => {
      const rect = pad.getBoundingClientRect();
      this._setPad(index, (1 - (event.clientY - rect.top) / rect.height) * 100);
    };
    this._padActive = this._padActive || [false, false];
    pad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      active = true;
      this._padActive[index] = true;
      if (this._simple && this._anyActive && !this._live && !this._recording) { this._livePad = true; this._setLive(true); }
      pad.classList.add('active');
      capture(pad, event);
      fromEvent(event);
    });
    pad.addEventListener('pointermove', (event) => { if (active) fromEvent(event); });
    const release = () => {
      if (!active) return;
      active = false;
      this._padActive[index] = false;
      pad.classList.remove('active');
      if (this._el('spring').checked && !(this._rp && this._rp.playing)) this._setPad(index, 0);
      if (this._livePad && this._el('spring').checked && !this._padActive.some(Boolean)) { this._livePad = false; if (!this._recording) this._setLive(false); }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(type, release);
    pad.addEventListener('contextmenu', (event) => event.preventDefault());
    pad.addEventListener('keydown', (event) => {
      const steps = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 };
      if (event.key in steps) { this._setPad(index, this._vals[index] + steps[event.key]); event.preventDefault(); }
      else if (event.key === 'Home') { this._setPad(index, 0); event.preventDefault(); }
      else if (event.key === 'End') { this._setPad(index, 100); event.preventDefault(); }
    });
  }

  // Pads: one, or two when a second output is chosen (one track each).
  // Two pads when a device follows the second (device 2 or 4).
  get _twoPads() { return Boolean(this._outs) && this._outs.some((o, i) => i % 2 === 1 && parseTarget(this._outTargetValue(i))); }

  _levels() {
    const levels = [this._vals[0] / 100];
    if (this._twoPads) levels.push(this._vals[1] / 100);
    return levels;
  }

  _setLive(on) {
    this._live = on;
    clearInterval(this._liveTimer);
    this._liveTimer = null;
    if (on || this._recording) {
      const send = () => this._padOut();
      send();
      this._liveTimer = setInterval(send, LIVE_MS);
    } else {
      this._outStop();
    }
  }
}
