// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { AUDIO_MODES, AudioFeel } from '../lib/audio.js';

const AUDIO_KEY = 'oggstudio_audio';
const AUDIO_HINT = 'Sound drives the devices: a pulse on each beat, or following the bass or the loudness. Nothing is recorded or sent anywhere; only the levels reach the devices.';
const AUDIO_HINT_SHORT = 'Nothing is recorded or sent anywhere.';

// Methods mixed into OggStudioCard.
export class AudioPart {
  // ---------------------------------------------------------- audio
  // The sound is analysed here in the browser, a few times a second.
  _bindAudio() {
    const $ = this._el;
    $('aumode').replaceChildren(...Object.entries(AUDIO_MODES).map(([v, t]) => new Option(t, v)));
    let kept = {};
    try { kept = JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}') || {}; } catch (_) { /* private mode */ }
    if ([...$('ausrc').options].some((o) => o.value === kept.src)) $('ausrc').value = kept.src;
    if (AUDIO_MODES[kept.mode]) $('aumode').value = kept.mode;
    if (Number.isFinite(kept.sens)) $('ausens').value = String(kept.sens);
    const keep = () => {
      $('ausensv').textContent = `${$('ausens').value}%`;
      try { localStorage.setItem(AUDIO_KEY, JSON.stringify({ src: $('ausrc').value, mode: $('aumode').value, sens: Number($('ausens').value) })); } catch (_) { /* private mode */ }
    };
    $('ausrc').addEventListener('change', () => { this._auStop(); this._auErr = ''; keep(); this._auShow(); });
    $('aumode').addEventListener('change', keep);
    $('ausens').addEventListener('input', keep);
    $('aufile').addEventListener('change', () => {
      const f = $('aufile').files[0];
      this._auStop();
      if (this._auUrl) URL.revokeObjectURL(this._auUrl);
      this._auUrl = f ? URL.createObjectURL(f) : null;
      if (f) $('auel').src = this._auUrl; else $('auel').removeAttribute('src');
      this._auShow();
    });
    $('augo').addEventListener('click', () => (this._au ? this._auStop() : this._auStart()));
    $('ausensv').textContent = `${$('ausens').value}%`;
    this._auShow();
  }

  async _auStart() {
    const $ = this._el;
    if (this._simple) { this._ptStop(); if (this._rp && this._rp.playing) this._rpStop(); }   // the newest one started has the devices
    const src = $('ausrc').value;
    let stream = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('this browser cannot analyse sound');
      const ctx = this._auCtx || (this._auCtx = new AC());
      if (ctx.state === 'suspended') await ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;       // sharp onsets: the feel does its own smoothing
      let node;
      if (src === 'mic' || src === 'tab') {
        if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('the microphone and shared audio need Home Assistant opened over https (or in its app). A music file or the video works anywhere');
        if (src === 'mic') stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        else {
          if (!navigator.mediaDevices.getDisplayMedia) throw new Error('this browser cannot share audio from another tab');
          // Ask for the sound too, and stay on this page once it is shared.
          const opts = { video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false }, systemAudio: 'include', selfBrowserSurface: 'exclude' };
          let controller = null;
          try { if (window.CaptureController) { controller = new window.CaptureController(); opts.controller = controller; } } catch (_) { controller = null; }
          stream = await navigator.mediaDevices.getDisplayMedia(opts);
          try { if (controller && controller.setFocusBehavior) controller.setFocusBehavior('focus-capturing-application'); } catch (_) { /* not a tab or window */ }
        }
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error(src === 'mic' ? 'no microphone was found' : 'the share had no sound. Start again, pick a browser tab (or the entire screen) and switch on "Also share tab audio" (or "Also share system audio") before pressing Share. A shared window never has sound');
        if (ctx.state === 'suspended') await ctx.resume();
        for (const t of stream.getVideoTracks()) t.enabled = false;
        node = ctx.createMediaStreamSource(stream);
        node.connect(an);              // analysed only: never played back here
        track.addEventListener('ended', () => { if (this._au && this._au.stream === stream) this._auStop(); });
      } else {
        const el = src === 'video' ? $('video') : $('auel');
        if (!el.currentSrc && !el.src) throw new Error(src === 'video' ? 'load a video in Video sync first' : 'choose a music file first');
        this._auNodes = this._auNodes || new Map();
        node = this._auNodes.get(el);
        if (!node) { node = ctx.createMediaElementSource(el); node.connect(ctx.destination); this._auNodes.set(el, node); }
        node.connect(an);
        if (src === 'file') el.play().catch(() => {});
      }
      this._rpStop();
      this._au = { src, an, node, stream, feel: new AudioFeel(ctx.sampleRate, an.fftSize), bins: new Uint8Array(an.frequencyBinCount), outAt: 0 };
      clearInterval(this._auTimer);
      this._auTimer = setInterval(() => this._auTick(), 50);
      this._auErr = '';
      this._toast('');
    } catch (e) {
      if (stream) for (const t of stream.getTracks()) t.stop();
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      this._auErr = denied ? 'Not started: permission was not given.' : `Not started: ${e.message || e}.`;
      this._toast(this._auErr);
    }
    this._auShow();
  }

  _auTick() {
    const au = this._au;
    if (!au || !this._el) return;
    const $ = this._el;
    const now = performance.now();
    au.an.getByteFrequencyData(au.bins);
    const r = au.feel.step(au.bins, now, $('aumode').value, Number($('ausens').value) / 100);
    $('aum1').style.width = `${r.levels[0]}%`;
    $('aum2').style.width = `${r.levels[1]}%`;
    if (!r.beat && now - au.outAt < 100) return;     // a beat goes out at once
    au.outAt = now;
    if (this._vsOn && !this._vraw) {
      this._vsSound(r);
      if (now - (au.shownAt || 0) > 1000) { au.shownAt = now; this._auShow(); }
      return;
    }
    if (this._simple) {
      // The pads (or the stroke bar) show it, so Record can follow it.
      if (this._strokeKind) { const st = this._st; if (st.drag === null && this._stSpeed() === null) { st.pos = this._lim(r.levels[0]); this._stShow(); } }
      else for (const i of [0, 1]) if (!this._padActive[i]) this._setPad(i, r.levels[i]);
    }
    if (this._simple) {
      if (this._strokeKind) {
        // Stroke: the sound is a position; each device follows it its own
        // way (a stroker goes there, a vibrator with AI feel gets patterns
        // from the movement, as with any stroke).
        const pos = this._lim(r.levels[0]);
        const dt = now - (au.posAt || now);
        const vel = dt > 0 && au.pos !== undefined ? (pos - au.pos) / dt * 1000 : 0;
        au.pos = pos; au.posAt = now;
        this._strokeOut(pos, vel);
      } else this._outApply(this._outIdx.map((i) => (this._isLinear(i) ? { goal: r.levels[0], dur: 180 } : this._mapLevel(i, r.levels[i % 2]))), 0.6);
      if (this._ctl === 'video' && !this._hbActive && !this._vrec) this._showHBar(0, this._strokeKind ? this._lim(r.levels[0]) : r.levels[0]);
    } else this._outApply(this._outIdx.map((i) => this._mapLevel(i, r.levels[i % 2])), 0.6);
    if (now - (au.shownAt || 0) > 1000) { au.shownAt = now; this._auShow(); }
  }

  _auStop() {
    const au = this._au;
    if (!au) return;
    this._au = null;
    clearInterval(this._auTimer);
    this._auTimer = null;
    try { au.node.disconnect(au.an); } catch (_) { /* already gone */ }
    if (au.stream) for (const t of au.stream.getTracks()) t.stop();
    if (au.src === 'file' && this._el) this._el('auel').pause();
    if (this._simple && this._el && !this._strokeKind) for (const i of [0, 1]) if (!this._padActive[i]) this._setPad(i, 0);
    this._outStop();
    this._auShow();
  }

  _auShow() {
    if (this._mediaShow) this._mediaShow();
    if (!this._el) return;
    const $ = this._el;
    const au = this._au;
    $('aufilebox').hidden = $('ausrc').value !== 'file';
    $('augo').textContent = au ? '■ Stop' : '♪ Start';
    $('augo').classList.toggle('stop', Boolean(au));
    if (!au) { $('aum1').style.width = '0'; $('aum2').style.width = '0'; }
    const from = { mic: 'the microphone', file: 'the music file', video: 'the video', tab: 'the shared audio' };
    const dev = this._outDevice(0);
    const to = dev ? '' : ' · no device is chosen under Devices, so nothing is driven';
    $('auinfo').textContent = au ? `Listening to ${from[au.src]} · ${au.feel.beats} beats${to}` : (this._auErr || (this._simple ? AUDIO_HINT_SHORT : AUDIO_HINT));
    const tab = this.shadowRoot.querySelector('.ctltabs [data-ctl="audio"]');
    if (tab) tab.classList.toggle('live', Boolean(au));
  }
}
