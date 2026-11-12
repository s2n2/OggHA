// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { CAST_DRIFT, CAST_GRACE, CAST_PLATFORMS, duration, esc } from '../lib/core.js';

const LOCAL_CAST = 'local';      // a TV this browser casts to itself

// Methods mixed into OggStudioCard.
export class CastPart {
  // Casting. A TV fetches what it plays, so a video that only exists in this
  // browser cannot be cast directly (Chrome's own cast refuses it, and the
  // Home Assistant app has no cast at all). Instead Home Assistant relays it,
  // in memory only: the TV's media player (Google Cast, DLNA, ...) is given a
  // private link, and each part of the video the TV asks for is read from the
  // local file here and passed on. Nothing is stored; the link ends with the
  // cast. The video here stays the clock: muted, it follows where the
  // TV says it is, and the devices sync to it as usual. Play, pause and seek
  // here are sent to the TV; pausing on the TV pauses here too.
  _bindCast() {
    const $ = this._el;
    $('vcast').addEventListener('click', () => this._castPicker($('castpop').hidden));
    this.shadowRoot.addEventListener('pointerdown', (e) => {
      if ($('castpop').hidden) return;
      const path = e.composedPath();
      if (!path.includes($('castpop')) && !path.includes($('vcast')) && !path.includes($('vscast'))) this._castPicker(false);
    });
    this._castShow();
  }

  _castTargets() {
    const plat = this._mpPlatform || {};
    const states = (this._hass && this._hass.states) || {};
    return Object.entries(states).map(([id, st]) => ({ ...st, entity_id: id }))
      .filter((st) => st.entity_id.startsWith('media_player.') && CAST_PLATFORMS.includes(plat[st.entity_id])
        && st.state !== 'unavailable' && ((st.attributes.supported_features || 0) & 512))
      .sort((x, y) => CAST_PLATFORMS.indexOf(plat[x.entity_id]) - CAST_PLATFORMS.indexOf(plat[y.entity_id])
        || String(x.attributes.friendly_name || x.entity_id).localeCompare(String(y.attributes.friendly_name || y.entity_id)));
  }

  _castName(entity) {
    if (entity === LOCAL_CAST) return 'the TV';
    const st = this._hass && this._hass.states[entity];
    return (st && st.attributes.friendly_name) || entity;
  }

  _castPicker(open) {
    const $ = this._el;
    if (!open) { $('castpop').hidden = true; this._castUnprep(); return; }
    if (!this._vurl) { this._toast('Choose a video first'); return; }
    if (this._canCastLocal && !this._cast) this._castPrepare();
    const item = (label, tag, fn) => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<span>${esc(label)}</span><small>${esc(tag)}</small>`; b.addEventListener('click', fn); return b; };
    const items = [];
    if (this._cast) items.push(item(`■ Stop casting to ${this._castName(this._cast.entity)}`, '', () => { this._castPicker(false); this._castEnd(true); }));
    if (this._castLink) items.push(item('■ Stop casting from this phone', 'Back to the video file here', () => { this._castPicker(false); this._castUnlink('Casting stopped.'); }));
    // Android's own cast, from this phone (wherever it is).
    if (this._canCastLocal && !this._cast) {
      const b = item('📱 Cast from this phone', this._castPrepText(), () => this._castLocalGo());
      b.id = 'castlocal';
      items.push(b);
    }
    const targets = this._castTargets();
    if (targets.length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'Through Home Assistant (TVs at home):'; items.push(d); }
    const plat = this._mpPlatform || {};
    for (const st of targets) {
      if (this._cast && this._cast.entity === st.entity_id) continue;
      const kind = { cast: 'Cast', dlna_dmr: 'DLNA', kodi: 'Kodi', apple_tv: 'Apple TV' }[plat[st.entity_id]] || '';
      items.push(item(st.attributes.friendly_name || st.entity_id, `${kind} · ${st.state}`, () => this._castStart(st.entity_id)));
    }
    if (!targets.length && !this._canCastLocal) {
      const d = document.createElement('div'); d.className = 'hint';
      d.textContent = 'No TV found: add your Chromecast or TV to Home Assistant (the Google Cast or DLNA integration) and it shows here.';
      items.push(d);
    }
    $('castlist').replaceChildren(...items);
    $('castpop').hidden = false;
  }

  // Chrome (not in the Home Assistant app) and Safari can cast from here.
  get _canCastLocal() { return typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype; }
  get _inHaApp() { return /Home ?Assistant\//i.test(navigator.userAgent || ''); }

  // Cast from this phone: Android's own cast (the icon Chrome puts on a
  // video). It only casts a video that comes from a link, and ours is a
  // file on this phone, so the video is switched to play from Home
  // Assistant's relay (in memory, nothing stored); the TV is given that
  // link. While cast, the video here stands for the TV: its time and
  // pause are the TV's, and the devices follow it as usual. The link is
  // made ready when this menu opens, so the picker opens from the tap.
  _castPrepare() {
    const file = this._vfileObj;
    if (this._castLink || this._inHaApp) return;
    const old = this._castPrep;
    if (old && old.fileObj === file) return;
    this._castUnprep();
    if (!file) return;
    const cast = { entity: LOCAL_CAST, prep: true, fileObj: file, state: 'Getting the link ready…' };
    this._castPrep = cast;
    this._castRelay(file, cast).then((url) => {
      if (this._castPrep !== cast) return;
      cast.url = new URL(url, location.origin).href;
      cast.state = 'Android cast: Chromecast and Google TV';
      this._castPrepSay();
    }).catch((e) => {
      if (this._castPrep !== cast) return;
      cast.state = 'Could not get a link: ' + ((e && e.message) || e);
      this._castPrepSay();
    });
  }

  _castPrepText() {
    if (this._inHaApp) return 'Not in the Home Assistant app: tap for how';
    if (this._castLink) return this._castLink.connected ? 'Casting now' : 'Ready: tap, or the cast icon on the video';
    return (this._castPrep && this._castPrep.state) || 'Android cast: Chromecast and Google TV';
  }

  _castPrepSay() {
    const el = this._el && this._el('castlocal');
    if (el) el.querySelector('small').textContent = this._castPrepText();
  }

  _castUnprep() {
    const cast = this._castPrep;
    if (!cast) return;
    this._castPrep = null;
    cast.cancelled = true;
    if (cast.unsub) { try { cast.unsub(); } catch (_) { /* connection gone */ } }
  }

  // From the tap.
  _castLocalGo() {
    const $ = this._el;
    if (this._inHaApp) {
      $('castpop').hidden = true;
      this._toast("The Home Assistant app cannot cast a video. Open this dashboard in Chrome to cast, or use Android's Screen cast (quick settings) with ⛶ full screen.");
      return;
    }
    const video = $('video');
    let link = this._castLink;
    if (!link) {
      const cast = this._castPrep;
      if (!cast || !cast.url) { this._toast(cast && cast.state ? cast.state : 'Getting the link ready… tap again in a moment.'); return; }
      this._castPrep = null;
      cast.prep = false;
      link = { cast, url: cast.url, blob: this._vurl };
      this._castLink = link;
      this._castLinkVideo(true);
    }
    $('castpop').hidden = true;
    try {
      video.remote.prompt().catch((e) => {
        if (e && e.name === 'NotAllowedError') return;             // no TV chosen
        this._toast('Now tap the cast icon on the video (top corner) to choose the TV.');
      });
    } catch (_) { this._toast('Now tap the cast icon on the video (top corner) to choose the TV.'); }
  }

  // Switch the video between the file here and the relay's link, keeping its place.
  _castLinkVideo(toLink) {
    const link = this._castLink;
    const video = this._el('video');
    const at = video.currentTime || 0;
    const playing = !video.paused;
    if (toLink) {
      video.removeAttribute('disableremoteplayback');
      video.disableRemotePlayback = false;
      video.src = link.url;
      if (!link.bound) {
        link.bound = true;
        video.remote.onconnect = () => {
          if (this._castLink !== link) return;
          link.connected = true;
          this._castWake(true);
          this._toast('Casting. The devices follow the TV.');
          this._castShow();
        };
        video.remote.ondisconnect = () => {
          if (this._castLink !== link || !link.connected) return;
          link.connected = false;
          this._castUnlink('Casting stopped.');
        };
      }
    } else {
      video.src = link.blob;
      video.setAttribute('disableremoteplayback', '');
    }
    const back = () => {
      video.removeEventListener('loadedmetadata', back);
      try { if (at > 0.5) video.currentTime = at; } catch (_) { /* fine */ }
      if (playing) video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', back);
    video.load();
  }

  // Back to the file here; the relay's link ends.
  _castUnlink(message) {
    const link = this._castLink;
    if (!link) return;
    if (this._el && this._vurl === link.blob) this._castLinkVideo(false);
    this._castLink = null;
    const cast = link.cast;
    cast.cancelled = true;
    if (cast.unsub) { try { cast.unsub(); } catch (_) { /* connection gone */ } }
    this._castWake(false);
    if (message) this._toast(message);
    this._castShow();
  }

  // Open the relay: Home Assistant asks for blocks of the file, this answers them.
  async _castRelay(file, cast) {
    let ready;
    const link = new Promise((ok, fail) => { ready = ok; setTimeout(() => fail(new Error('Home Assistant did not open the link (update OggStudio?)')), 10000); });
    const answer = async (req, start, length) => {
      try {
        const body = await file.slice(start, start + length).arrayBuffer();
        if (this._cast !== cast && this._castPrep !== cast && !(this._castLink && this._castLink.cast === cast)) return;
        const r = await this._hass.fetchWithAuth(`/api/ogg/studio/relay_data/${cast.relay}/${req}`, { method: 'POST', body });
        if (r.ok) { cast.sent = (cast.sent || 0) + length; this._castShowSoon(); }
      } catch (_) { /* the TV asks again */ }
    };
    cast.unsub = await this._hass.connection.subscribeMessage((m) => {
      if (m.ready) { cast.relay = m.id; ready(m.url); } else if (m.req !== undefined) answer(m.req, m.start, m.length);
    }, { type: 'ogg/studio/relay', name: file.name, size: file.size, mime: file.type || 'video/mp4' }, { resubscribe: false });
    if (this._cast !== cast && this._castPrep !== cast) { cast.unsub(); throw new Error('cancelled'); }
    return link;
  }

  _castShowSoon() {
    if (this._castShowTimer) return;
    this._castShowTimer = setTimeout(() => { this._castShowTimer = null; this._castShow(); }, 500);
  }

  // Keep the screen on while casting: the video streams from this device.
  async _castWake(on) {
    try {
      if (!on) { if (this._wake) await this._wake.release(); this._wake = null; return; }
      if (navigator.wakeLock && !this._wake && document.visibilityState === 'visible') {
        this._wake = await navigator.wakeLock.request('screen');
        this._wake.addEventListener('release', () => { this._wake = null; });
      }
    } catch (_) { /* not allowed here */ }
    if (!this._wakeBound) {
      this._wakeBound = true;
      document.addEventListener('visibilitychange', () => { if (this._cast) this._castWake(true); });
    }
  }

  async _castStart(entity) {
    this._castPicker(false);
    this._castUnlink();
    const file = this._vfileObj;
    if (!file) { this._toast('Choose a video first'); return; }
    if (this._cast) this._castEnd(this._cast.entity !== entity);
    const video = this._el('video');
    const cast = { entity, phase: 'starting', startAt: video.currentTime || 0, since: performance.now() };
    this._cast = cast;
    this._castShow();
    try {
      const url = await this._castRelay(file, cast);
      if (this._cast !== cast) return;
      cast.file = cast.relay;               // the TV's media id carries the relay id
      cast.since = performance.now();
      this._castWake(true);
      this._castWasMuted = video.muted;
      video.muted = true;                   // the sound comes from the TV
      this._castQuiet('pause');
      await this._hass.callService('media_player', 'play_media', {
        entity_id: entity, media_content_id: url, media_content_type: file.type || 'video/mp4',
      });
      if (!this._castTimer) this._castTimer = setInterval(() => this._castSync(), 250);
    } catch (e) {
      if (this._cast !== cast) return;
      this._castEnd(false, cast.cancelled ? undefined : 'Could not cast: ' + ((e && e.message) || e));
    }
  }

  // Stop casting (and the TV, if asked). The link to the video ends here.
  _castEnd(stopTv, message) {
    const cast = this._cast;
    if (!cast) return;
    cast.cancelled = true;
    this._cast = null;
    clearInterval(this._castTimer);
    this._castTimer = null;
    if (cast.unsub) { try { cast.unsub(); } catch (_) { /* connection gone */ } }
    this._castWake(false);
    const video = this._el && this._el('video');
    if (video && this._castWasMuted !== undefined) { video.muted = this._castWasMuted; this._castWasMuted = undefined; }
    if (cast.rv) {
      const rv = cast.rv;
      try { rv.pause(); rv.removeAttribute('src'); rv.load(); } catch (_) { /* gone */ }
      rv.remove();
    } else if (stopTv && cast.relay && this._hass) this._hass.callService('media_player', 'media_stop', { entity_id: cast.entity }, undefined, false).catch(() => {});
    this._toast(message || 'Casting stopped.');
    this._castShow();
  }

  // Change the video here without it being sent back to the TV: the event
  // each change causes (play, pause, seeked) is expected and skipped once.
  _castQuiet(kind) {
    const cast = this._cast;
    const video = this._el('video');
    if (kind === 'play' ? !video.paused : kind === 'pause' ? video.paused : false) return;
    const key = typeof kind === 'string' ? kind : 'seek';
    if (cast) { cast.expect = cast.expect || {}; cast.expect[key] = { n: ((cast.expect[key] && cast.expect[key].n) || 0) + 1, until: performance.now() + 2000 }; }
    try {
      const r = kind === 'play' ? video.play() : kind === 'pause' ? video.pause() : (video.currentTime = kind.seek);
      if (r && r.catch) r.catch(() => {});
    } catch (_) { /* not loaded yet */ }
  }

  _castExpected(kind) {
    const e = this._cast && this._cast.expect && this._cast.expect[kind];
    if (!e || !e.n || performance.now() > e.until) return false;
    e.n -= 1;
    return true;
  }

  // Play, pause or seek here: tell the TV.
  _castCmd(service, data) {
    const cast = this._cast;
    if (!cast) return;
    if (this._castExpected(service === 'media_play' ? 'play' : service === 'media_pause' ? 'pause' : 'seek') || cast.phase !== 'on') return;
    cast.cmdUntil = performance.now() + CAST_GRACE;
    if (service === 'media_seek') cast.pos = null;
    if (cast.rv) {
      const rv = cast.rv;
      try {
        if (service === 'media_play') rv.play().catch(() => {});
        else if (service === 'media_pause') rv.pause();
        else if (service === 'media_seek') rv.currentTime = data.seek_position;
      } catch (e) { this._toast('The TV did not take that: ' + ((e && e.message) || e)); }
      return;
    }
    this._hass.callService('media_player', service, { entity_id: cast.entity, ...(data || {}) }, undefined, false)
      .catch((e) => this._toast('The TV did not take that: ' + ((e && e.message) || e)));
  }

  // Where the TV is now, from what Home Assistant last heard from it.
  _castTvPos(st) {
    const cast = this._cast;
    const a = st.attributes;
    if (!Number.isFinite(a.media_position)) return null;
    if (a.media_position_updated_at !== cast.stamp) {
      cast.fresh = cast.stamp !== undefined;    // seen arriving: time it from now
      cast.stamp = a.media_position_updated_at;
      cast.seenAt = Date.now();
    }
    if (st.state !== 'playing') return a.media_position;
    const since = cast.fresh ? Date.now() - cast.seenAt : Math.max(0, Date.now() - Date.parse(a.media_position_updated_at));
    return a.media_position + (Number.isFinite(since) ? since : 0) / 1000;
  }

  _castSync() {
    const cast = this._cast;
    if (!cast || !cast.relay || !this._el) return;
    if (cast.rv) { this._castSyncLocal(cast); return; }
    const st = this._hass.states[cast.entity];
    const video = this._el('video');
    if (!st) return;
    const now = performance.now();
    const ours = cast.file && String(st.attributes.media_content_id || '').includes(cast.file);
    if (cast.phase === 'starting') {
      if (ours && (st.state === 'playing' || st.state === 'paused')) {
        cast.phase = 'on';
        cast.lostAt = 0;
        this._toast(`Casting to ${this._castName(cast.entity)}. The devices follow the TV.`);
        if (cast.startAt > 1) {
          this._hass.callService('media_player', 'media_seek', { entity_id: cast.entity, seek_position: Math.round(cast.startAt * 10) / 10 }, undefined, false).catch(() => {});
          cast.cmdUntil = now + CAST_GRACE;
          this._castQuiet({ seek: cast.startAt });
        }
        this._castQuiet('play');
        this._castShow();
      } else if (now - cast.since > 30000) {
        this._castEnd(false, `${this._castName(cast.entity)} did not start the video. Chromecasts play MP4 (H.264) and WebM; check Home Assistant can reach the TV.`);
      }
      return;
    }
    // Something else on the TV now, or it was turned off.
    if (!ours || ['off', 'idle', 'standby', 'unavailable'].includes(st.state)) {
      if (!cast.lostAt) cast.lostAt = now;
      if (now - cast.lostAt > 4000) {
        this._castQuiet('pause');
        this._castEnd(false, `${this._castName(cast.entity)} stopped playing the video.`);
      }
      return;
    }
    cast.lostAt = 0;
    if (now < (cast.cmdUntil || 0)) { this._castShow(); return; }   // the TV is still catching up with us
    const pos = this._castTvPos(st);
    const playing = st.state === 'playing';
    if (playing && video.paused && !video.ended) this._castQuiet('play');
    if (!playing && !video.paused) this._castQuiet('pause');
    if (pos !== null && Number.isFinite(video.duration) && Math.abs(video.currentTime - pos) > CAST_DRIFT && pos < video.duration) {
      this._castQuiet({ seek: pos });
    }
    this._castShow();
  }

  // The same, for a TV the browser cast to: it reports where it is itself.
  _castSyncLocal(cast) {
    const rv = cast.rv;
    const video = this._el('video');
    const now = performance.now();
    if (cast.phase === 'starting') {
      if (rv.remote.state === 'connected' && !rv.paused) {
        cast.phase = 'on';
        this._toast('Casting to the TV. The devices follow it.');
        if (cast.startAt > 1) this._castQuiet({ seek: cast.startAt });
        this._castQuiet('play');
        this._castShow();
      } else if (now - cast.since > 60000) {
        this._castEnd(false, 'The TV did not start the video. It must be able to reach Home Assistant at ' + location.origin + ' (a home-only or VPN address will not do).');
      }
      return;
    }
    if (now < (cast.cmdUntil || 0)) { this._castShow(); return; }
    if (!rv.paused && video.paused && !video.ended) this._castQuiet('play');
    if (rv.paused && !video.paused) this._castQuiet('pause');
    const pos = rv.currentTime;
    if (Number.isFinite(pos) && Number.isFinite(video.duration) && Math.abs(video.currentTime - pos) > CAST_DRIFT && pos < video.duration) this._castQuiet({ seek: pos });
    this._castShow();
  }

  _castShow() {
    if (!this._el) return;
    const btn = this._el('vcast');
    const cast = this._cast;
    const link = this._castLink && this._castLink.connected;
    const text = link ? '📺 On TV' : !cast ? '📺 Cast' : cast.phase === 'starting' ? '📺 …' : '📺 On TV';
    if (btn.textContent !== text) btn.textContent = text;
    btn.classList.toggle('on', Boolean(link || (cast && cast.phase === 'on')));
    this._videoStatus();
  }
}
