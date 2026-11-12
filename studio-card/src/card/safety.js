// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { esc } from '../lib/core.js';
import { isLimited, limitsFor, limitsText } from '../lib/limits.js';

const PRIVACY_KEY = 'oggstudio_privacy';       // the last known settings, so a locked card opens covered
const UNLOCK_KEY = 'oggstudio_unlocked';       // when this tab was last used unlocked
const PANIC_HOLD_MS = 3000;

// Methods mixed into OggStudioCard.
export class SafetyPart {
  // ---------------------------------------------------------- safety
  // Stop all: stops every Ogg device (not only this card's), halts whatever
  // this card was doing and keeps it quiet for a few seconds. Home Assistant
  // tells every other open card to do the same.
  _bindSafety() {
    const $ = this._el;
    $('stopall').addEventListener('click', () => this._panic());
    $('coverstop').addEventListener('click', () => this._panic());
    $('limbtn').addEventListener('click', () => { $('limbox').hidden = !$('limbox').hidden; this._limRender(true); });
    $('lockbtn').addEventListener('click', () => this._lock());
    $('coveropen').addEventListener('click', () => this._unlocked());
    $('pingo').addEventListener('click', () => this._pinTry());
    $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._pinTry(); });
    this.shadowRoot.addEventListener('pointerdown', () => this._touched(), true);
    if (!this._pageHide) {
      // The page is going (closed, or navigated away): leave nothing running.
      this._pageHide = () => { if (this._claimed.size) this._outStop(); };
      window.addEventListener('pagehide', this._pageHide);
    }
    try { this._privacy = JSON.parse(localStorage.getItem(PRIVACY_KEY) || 'null') || {}; } catch (_) { this._privacy = {}; }
    this._privacyShow();
  }

  _panic() {
    this._haltAll();
    this._toast('Everything stopped.');
    if (this._hass) this._hass.callService('ogg', 'studio_panic', {}, undefined, false).catch((e) => this._toast('Stop all did not reach Home Assistant: ' + (e.message || e)));
  }

  // Halt whatever this card is doing and hold its output for a moment.
  _haltAll() {
    if (!this._el) return;
    const $ = this._el;
    this._holdUntil = performance.now() + PANIC_HOLD_MS;
    if (this._recording) this._stopRecording();
    if (this._stRecording) this._stStop();
    this._tapStop();
    this._ptStop();
    this._hbKeep(true);
    if (this._live) { $('live').checked = false; this._setLive(false); }
    $('stlive').checked = false;
    if (this._st) { this._st.touch = null; this._st.pad = null; this._st.drag = null; this._st.latch = null; }
    this._stHalt();
    if (this._pl) this._pl.on = false;
    this._rpStop();
    const video = $('video');
    if (video && !video.paused) video.pause();
    this._auStop();
    this._tgStopLocal(true);
    this._outStop();
    this._plShow();
  }

  // The session tells Home Assistant this card is alive: when the browser
  // goes away (closed, crashed, off the network) it stops this card's devices.
  _sessionOpen() {
    if (this._sessionUnsub || this._sessionOpening || !this.isConnected) return;
    const conn = this._hass && this._hass.connection;
    if (!conn || !conn.subscribeMessage || !this._studio || !this._studio.saved) return;
    this._sessionOpening = true;
    conn.subscribeMessage(() => {}, { type: 'ogg/studio/session', owner: this._owner })
      .then((unsub) => { this._sessionUnsub = unsub; if (!this.isConnected) this._sessionClose(); })
      .catch(() => { this._sessionFailed = true; })
      .finally(() => { this._sessionOpening = false; });
  }

  _sessionClose() {
    const unsub = this._sessionUnsub;
    this._sessionUnsub = null;
    if (unsub) { try { Promise.resolve(unsub()).catch(() => {}); } catch (_) { /* connection gone */ } }
  }

  // Called from _update on every state change.
  _safetyUpdate() {
    const saved = this._studio && this._hass.states[this._studio.saved];
    const attrs = (saved && saved.attributes) || {};
    if (!this._sessionFailed) this._sessionOpen();
    // Someone pressed Stop all (a card, the button, an automation, a notification).
    if (saved) {
      const panic = attrs.panic || 0;
      if (this._panicSeen !== undefined && panic !== this._panicSeen) { this._haltAll(); this._toast('Everything was stopped.'); }
      this._panicSeen = panic;
    }
    this._limitsAll = attrs.limits || {};
    if (saved && attrs.settings) {
      const s = attrs.settings;
      const next = { pin: Boolean(s.pin), discreet: Boolean(s.discreet), name: s.name || 'Studio', users: s.users || [], auto_lock: Number(s.auto_lock) || 0 };
      if (JSON.stringify(next) !== JSON.stringify(this._privacy)) {
        this._privacy = next;
        try { localStorage.setItem(PRIVACY_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
      }
    }
    // Discreet: devices are "Device A", "Device B" (in the order of their real names).
    const discreet = Boolean(this._privacy.discreet);
    [...this._devices].sort((a, b) => (a.real || a.name).localeCompare(b.real || b.name)).forEach((d, i) => {
      if (!d.real) d.real = d.name;
      d.name = discreet ? `Device ${String.fromCharCode(65 + (i % 26))}` : d.real;
    });
    this._privacyShow();
    this._limRender(false);
  }

  // ---------------------------------------------------------- limits
  _limits(dev) { return limitsFor(this._limitsAll, dev.stop); }

  _limRender(force) {
    const $ = this._el;
    // Only the connected devices chosen under Devices.
    const chosen = new Set((this._outs || []).map((o, i) => (this._outDevice(i) || {}).id));
    const lims = this._devices.filter((d) => chosen.has(d.id) && this._online(d)).map((d) => [d, this._limits(d)]);
    const any = lims.filter(([, l]) => isLimited(l));
    const label = any.length ? `⚙ Limits (${any.length} set)` : '⚙ Limits';
    if ($('limbtn').textContent !== label) $('limbtn').textContent = label;
    if ($('limbox').hidden) return;
    const key = JSON.stringify(lims.map(([d, l]) => [d.id, d.name, l]));
    if (!force && (key === $('limbox').dataset.key || $('limbox').contains(this.shadowRoot.activeElement))) return;
    $('limbox').dataset.key = key;
    const slider = (dev, field, text, min, value) => `<label>${text} <b data-v="${field}">${value}%</b></label><input type="range" min="${min}" max="100" step="1" value="${value}" data-dev="${esc(dev.stop)}" data-field="${field}">`;
    const rows = lims.map(([d, l]) => {
      const vibe = d.vibe || !d.linear;
      return `<div class="limdev"><h4>${esc(d.name)}</h4>`
        + (vibe ? slider(d, 'max', 'Top intensity', 0, l.max) : '')
        + (d.linear ? slider(d, 'lo', 'Stroke range from', 0, l.lo) + slider(d, 'hi', 'Stroke range to', 0, l.hi) + slider(d, 'speed', 'Top stroke speed', 5, l.speed) : '')
        + '</div>';
    });
    $('limlist').innerHTML = rows.join('') || '<div class="hint">No connected device: add one under Devices (and switch it on) to set its limits.</div>';
    for (const input of $('limlist').querySelectorAll('input')) {
      input.addEventListener('input', () => { input.previousElementSibling.querySelector('b').textContent = `${input.value}%`; });
      input.addEventListener('change', () => this._limSet(input));
    }
  }

  _limSet(input) {
    const stop = input.dataset.dev;
    const dev = this._devices.find((d) => d.stop === stop);
    if (!dev) return;
    const lim = { ...this._limits(dev), [input.dataset.field]: Number(input.value) };
    // The range keeps a little room: moving one end pushes the other.
    if (lim.hi - lim.lo < 5) { if (input.dataset.field === 'lo') lim.hi = Math.min(100, lim.lo + 5); else lim.lo = Math.max(0, lim.hi - 5); }
    if (lim.hi - lim.lo < 5) { lim.lo = 0; lim.hi = 100; }
    this._limitsAll = { ...this._limitsAll, [stop]: lim };      // at once here; Home Assistant follows
    this._hass.callService('ogg', 'studio_set_limits', { entity_id: stop, ...lim })
      .then(() => this._toast(`Limits for ${dev.name}: ${limitsText(lim) || 'none'}.`))
      .catch((e) => this._toast('Could not save the limits: ' + (e.message || e)));
    this._limRender(true);
  }

  // ---------------------------------------------------------- privacy
  // A PIN or discreet mode covers the card until it is opened; it locks
  // again after a while unused. The PIN is checked by Home Assistant.
  get _needsLock() { return Boolean(this._privacy && (this._privacy.pin || this._privacy.discreet)); }

  _lockedNow() {
    if (!this._needsLock) return false;
    let at = 0;
    try { at = Number(sessionStorage.getItem(UNLOCK_KEY)) || 0; } catch (_) { at = this._unlockAt || 0; }
    if (!at) return true;
    const minutes = this._privacy.auto_lock || 0;
    if (minutes && !this._claimed.size && Date.now() - at > minutes * 60000) return true;
    return false;
  }

  _touched() {
    if (!this._needsLock || this._isLocked) return;
    const now = Date.now();
    if (now - (this._unlockAt || 0) < 5000) return;
    this._unlockAt = now;
    try { sessionStorage.setItem(UNLOCK_KEY, String(now)); } catch (_) { /* private mode */ }
  }

  _unlocked() {
    this._unlockAt = Date.now();
    try { sessionStorage.setItem(UNLOCK_KEY, String(this._unlockAt)); } catch (_) { /* private mode */ }
    this._el('pin').value = '';
    this._el('covermsg').textContent = '';
    this._privacyShow();
  }

  _lock() {
    this._unlockAt = 0;
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch (_) { /* private mode */ }
    this._privacyShow();
  }

  async _pinTry() {
    const $ = this._el;
    const pin = $('pin').value;
    if (!pin || this._pinBusy) return;
    this._pinBusy = true;
    try {
      const r = await this._hass.callWS({ type: 'ogg/studio/unlock', pin });
      if (r && r.ok) this._unlocked();
      else { $('pin').value = ''; $('covermsg').textContent = r && r.wait ? `Too many tries. Wait ${r.wait} s.` : 'That is not the PIN.'; }
    } catch (e) { $('covermsg').textContent = 'Could not check the PIN: ' + (e.message || e); }
    this._pinBusy = false;
  }

  _privacyShow() {
    if (!this._el) return;
    const $ = this._el;
    const p = this._privacy || {};
    // Not one of the chosen users: no card at all.
    const me = this._hass && this._hass.user && this._hass.user.id;
    const hide = Boolean(p.users && p.users.length && me && !p.users.includes(me));
    if (this.hidden !== hide) { this.hidden = hide; this.style.display = hide ? 'none' : ''; }
    const cardEl = this.shadowRoot.querySelector('ha-card');
    if (this._claimed.size) this._touched();        // driving a device counts as in use
    const locked = this._lockedNow();
    this._isLocked = locked;
    cardEl.classList.toggle('locked', locked);
    $('cover').hidden = !locked;
    const neutral = p.discreet || locked;
    const title = neutral ? (p.name || 'Studio') : (this._config.title || this._variant.name.replace(/^OggStudio\s*/, '') || 'Studio');
    if ($('title').textContent !== title) $('title').textContent = title;
    if ($('covername').textContent !== (p.name || 'Studio')) $('covername').textContent = p.name || 'Studio';
    $('sub').hidden = Boolean(p.discreet);
    $('lockbtn').hidden = !this._needsLock;
    $('coverpin').hidden = !p.pin;
    $('coveropen').hidden = Boolean(p.pin);
    if (this._needsLock && !this._lockTimer) this._lockTimer = setInterval(() => this._privacyShow(), 20000);
  }
}
