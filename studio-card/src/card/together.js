// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

const TG_LINK = /^https?:\/\/[^\s/]+(\/[^\s?#]*)?\/api\/ogg\/studio\/together\/[\w-]+\/?$/;
const TG_FRESH_MS = 1500;      // a level older than this no longer counts

// Methods mixed into OggStudioCard.
export class TogetherPart {
  // ---------------------------------------------------------- together
  // Two people, two places: each one's slider drives the other's devices,
  // by feel and inside the limits each has set. Only levels (0-100) travel;
  // a partner never reaches Home Assistant itself. Whoever starts shares a
  // link; the other opens it in a browser, or joins from their own card.
  _bindTogether() {
    const $ = this._el;
    $('tgstart').addEventListener('click', () => this._tgStart());
    $('tgjoin').addEventListener('click', () => this._tgJoin());
    $('tglink').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._tgJoin(); });
    $('tgcopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('tgshare').value); this._toast('Link copied. Send it only to your partner: whoever has it can join.'); }
      catch (_) { $('tgshare').select(); this._toast('Copy the selected link.'); }
    });
    $('tgsend').addEventListener('input', () => { $('tgsendv').textContent = `${$('tgsend').value}%`; });
    $('tgaccept').addEventListener('change', () => this._tgShow());
    $('tgstop').addEventListener('click', () => { this._tgStopLocal(true); this._toast('Stopped both sides.'); });
    $('tgend').addEventListener('click', () => this._tgEnd());
    $('tgsync').addEventListener('change', () => { if (this._tg) { this._tg.sync = $('tgsync').checked; this._tgSend({ sync: this._tg.sync }); } this._tgShow(); });
    $('tgrec').addEventListener('click', () => this._tgRecToggle());
    this._tgShow();
  }

  _tgNew(role) {
    if (this._tg) this._tgEnd();
    const tg = { role, joined: false, theirs: false, name: '', in: null, link: '', token: null, sentAccept: null, lastOut: 0, outAt: 0, pingAt: 0, driving: false,
      offer: {}, offerKey: '', partner: [], sync: false, rec: null, outLevel: 0 };
    this._tg = tg;
    clearInterval(this._tgTimer);
    this._tgTimer = setInterval(() => this._tgTick(), 100);
    return tg;
  }

  async _tgStart() {
    const conn = this._hass && this._hass.connection;
    if (!conn || !conn.subscribeMessage) { this._toast('Not connected to Home Assistant.'); return; }
    const tg = this._tgNew('host');
    try {
      const unsub = await conn.subscribeMessage((ev) => this._tgEvent(tg, ev), { type: 'ogg/studio/together' });
      if (this._tg !== tg) { unsub(); return; }
      tg.unsub = unsub;
    } catch (e) {
      if (this._tg === tg) this._tgEnd();
      this._toast('Could not start a session: ' + (e.message || e));
    }
    this._tgShow();
  }

  _tgEvent(tg, ev) {
    if (this._tg !== tg || !ev) return;
    if (ev.event === 'open') { tg.token = ev.token; tg.link = String(ev.base || location.origin).replace(/\/+$/, '') + ev.path; }
    else if (ev.event === 'join') this._tgJoined(tg);
    else if (ev.event === 'leave') {
      tg.joined = false; tg.theirs = false; tg.in = null; tg.sentAccept = null; tg.partner = []; tg.offerKey = '';
      if (tg.rec) this._tgRecToggle();
      this._outStop();
      this._toast('Your partner left. The link still works if they come back.');
    }
    else if (ev.event === 'msg') this._tgMsg(tg, ev.data || {});
    this._tgShow();
  }

  _tgJoined(tg) {
    tg.joined = true;
    tg.sentAccept = null;          // the tick tells them where we stand
    const discreet = this._privacy && this._privacy.discreet;
    const name = !discreet && this._hass && this._hass.user && String(this._hass.user.name || '').trim();
    if (name) this._tgSend({ name: name.slice(0, 30) });
    tg.offerKey = '';               // the tick offers them the toys I am not using
    if (tg.sync) this._tgSend({ sync: true });
  }

  // Toys I am not using, offered to my partner as theirs to pick (his/hers shown).
  _tgOffer() {
    const used = new Set((this._outs || []).map((o, i) => (this._outDevice(i) || {}).id));
    const list = this._devices.filter((d) => !used.has(d.id) && this._online(d)).slice(0, 8);
    const offer = {};
    const items = list.map((d, n) => {
      const k = `d${n}`;
      offer[k] = `${d.id}|${d.linear && !d.vibe ? 'l' : 'b'}`;
      return { k, name: String(d.name || 'Toy').slice(0, 30), owner: this._whose(d), kind: d.linear && !d.vibe ? 'stroke' : d.dual ? 'dual' : 'vibe' };
    });
    return { offer, items };
  }

  _whose(d) {
    const st = d && d.owner && this._hass && this._hass.states[d.owner];
    return st && ['his', 'hers'].includes(st.state) ? st.state : 'unassigned';
  }

  // Record what my partner sends, to play again later (they are told).
  _tgRecToggle() {
    const tg = this._tg;
    if (!tg) return;
    if (tg.rec) {
      const rec = tg.rec;
      tg.rec = null;
      this._tgSend({ rec: false });
      const t = Math.round(performance.now() - rec.t0);
      const acts = rec.acts;
      if (acts.length) acts.push({ at: t, pos: acts[acts.length - 1].pos }, { at: t + 1, pos: 0 });
      if (acts.length > 2) {
        this._take = { version: '1.0', inverted: false, range: 100, actions: acts,
          metadata: { creator: 'Ogg', type: 'vibration', title: `From ${tg.name || 'my partner'}` } };
        this._libPick = 'take';
        if (this._simple && this._ctl !== 'library') this._setCtl('library');
        if (this._rp && !this._rp.playing) this._rpLoad(this._take, 'Current take', null);
        this._update();
        this._toast('Recorded: it is the current take in the Library, to play or save.');
      } else this._toast('Nothing came from your partner while recording.');
    } else {
      if (!tg.joined) { this._toast('Your partner has not joined yet.'); return; }
      tg.rec = { t0: performance.now(), acts: [], last: null, seen: null };
      this._tgSend({ rec: true });
    }
    this._tgShow();
  }

  _tgJoin() {
    const $ = this._el;
    const link = $('tglink').value.trim();
    if (!TG_LINK.test(link)) { this._toast('That is not a Together link: paste the whole link you were sent.'); return; }
    if (location.protocol === 'https:' && link.startsWith('http:')) { this._toast('This page is secure (https) and the link is not, so the browser will not connect. Open the link itself in a browser instead.'); return; }
    let ws;
    try { ws = new WebSocket(link.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws'); }
    catch (e) { this._toast('Could not connect: ' + (e.message || e)); return; }
    const tg = this._tgNew('guest');
    tg.ws = ws;
    ws.addEventListener('open', () => { if (this._tg !== tg) return; $('tglink').value = ''; this._tgJoined(tg); this._tgShow(); });
    ws.addEventListener('message', (e) => {
      if (this._tg !== tg) return;
      let data = null;
      try { data = JSON.parse(e.data); } catch (_) { return; }
      if (data && typeof data === 'object') { this._tgMsg(tg, data); this._tgShow(); }
    });
    ws.addEventListener('close', () => {
      if (this._tg !== tg) return;
      this._toast(tg.joined ? 'The session has ended.' : 'Could not join: the link has ended, or someone has already joined it.');
      this._tgEnd();
    });
    this._tgShow();
  }

  _tgSend(data) {
    const tg = this._tg;
    if (!tg || !tg.joined) return;
    if (tg.role === 'host') { if (tg.token) this._hass.callWS({ type: 'ogg/studio/together_send', token: tg.token, data }).catch(() => {}); }
    else if (tg.ws && tg.ws.readyState === 1) tg.ws.send(JSON.stringify(data));
  }

  _tgMsg(tg, d) {
    if (Array.isArray(d.v) && d.v.length && d.v.every((x) => Number.isFinite(x))) tg.in = { v: d.v.slice(0, 2).map((x) => Math.min(100, Math.max(0, x))), at: performance.now() };
    if (typeof d.accept === 'boolean') tg.theirs = d.accept;
    if (typeof d.name === 'string') tg.name = d.name.slice(0, 30);
    if (Array.isArray(d.mine) && tg.role === 'host') {
      // The toys my partner says are theirs (from those I offered).
      const before = tg.partner.join();
      tg.partner = d.mine.map((k) => tg.offer[k]).filter(Boolean).slice(0, 4);
      if (tg.partner.join() !== before) { this._outStop(); this._toast(tg.partner.length ? 'Your partner picked their toys: your controls now play them.' : 'Your partner put their toys back.'); }
    }
    if (typeof d.sync === 'boolean' && tg.role === 'guest') tg.sync = d.sync;
    if (typeof d.rec === 'boolean' && tg.role === 'guest') this._toast(d.rec ? 'Your partner is recording what you send.' : 'Your partner stopped recording.');
    if (d.stop === true) { this._tgStopLocal(false); this._toast('Your partner stopped both sides.'); }
  }

  // My devices follow my partner only while I say so, on the Together tab.
  get _tgAccepting() { const tg = this._tg; return Boolean(tg && tg.joined && (this._simple || this._ctl === 'together') && this._el('tgaccept').checked); }

  _tgTick() {
    const tg = this._tg;
    if (!tg || !this._el) return;
    const $ = this._el;
    const now = performance.now();
    const accept = this._tgAccepting;
    if (tg.joined) {
      if (accept !== tg.sentAccept) { tg.sentAccept = accept; this._tgSend({ accept }); }
      if (tg.role === 'host') {
        const { offer, items } = this._tgOffer();
        const key = JSON.stringify(items);
        if (key !== tg.offerKey) { tg.offerKey = key; tg.offer = offer; this._tgSend({ devices: items }); }
      }
      // What my partner feels: my controls' level (the Play card), or the slider.
      const out = this._simple ? Math.round(tg.outLevel || 0) : (Number($('tgsend').value) || 0);
      if (out !== tg.lastOut || (out > 0 && now - tg.outAt >= 500)) { tg.lastOut = out; tg.outAt = now; this._tgSend({ v: [out] }); }
      if (now - tg.pingAt >= 10000) { tg.pingAt = now; this._tgSend({ ping: true }); }
    }
    const fresh = Boolean(tg.in && now - tg.in.at < TG_FRESH_MS);
    $('tgin').style.width = `${fresh ? Math.max(...tg.in.v) : 0}%`;
    if (tg.rec) {
      // Recording what they send (a held level is kept, not ramped).
      const t = Math.round(now - tg.rec.t0);
      const pos = Math.round(fresh ? Math.max(...tg.in.v) : 0);
      const acts = tg.rec.acts;
      if (pos !== tg.rec.last) {
        const prev = acts[acts.length - 1];
        if (prev && tg.rec.seen !== null && tg.rec.seen > prev.at && tg.rec.seen < t) acts.push({ at: tg.rec.seen, pos: prev.pos });
        acts.push({ at: t, pos });
        tg.rec.last = pos;
      }
      tg.rec.seen = t;
    }
    if (accept && fresh) {
      tg.driving = true;
      const v = tg.in.v;
      this._outApply(this._outIdx.map((i) => this._mapLevel(i, v[i % 2] ?? v[0])), 0.6, 'partner');
    } else if (tg.driving) {
      tg.driving = false;
      this._outStop();
    }
  }

  // Stop here: nothing in, nothing out. With `tell`, the partner's side stops too.
  _tgStopLocal(tell) {
    const tg = this._tg;
    if (!tg || !this._el) return;
    const $ = this._el;
    $('tgaccept').checked = false;
    $('tgsend').value = '0';
    $('tgsendv').textContent = '0%';
    tg.in = null;
    if (tell) this._tgSend({ stop: true });
    if (tg.driving) { tg.driving = false; this._outStop(); }
    this._tgShow();
  }

  _tgEnd() {
    const tg = this._tg;
    if (!tg) return;
    this._tg = null;
    clearInterval(this._tgTimer);
    this._tgTimer = null;
    if (tg.rec) this._tgRecToggle();
    tg.partner = [];
    if (tg.unsub) { try { Promise.resolve(tg.unsub()).catch(() => {}); } catch (_) { /* connection gone */ } }
    if (tg.ws) { try { tg.ws.close(); } catch (_) { /* already closed */ } }
    if (tg.driving) this._outStop();
    if (this._el) {
      const $ = this._el;
      $('tgaccept').checked = false;
      $('tgsend').value = '0';
      $('tgsendv').textContent = '0%';
      $('tgin').style.width = '0';
    }
    this._tgShow();
  }

  _tgShow() {
    if (!this._el) return;
    if (this._mediaShow) this._mediaShow();          // the section's badge
    const $ = this._el;
    const tg = this._tg;
    $('tgidle').hidden = Boolean(tg);
    $('tglive').hidden = !tg;
    const tab = this.shadowRoot.querySelector('.ctltabs [data-ctl="together"]');
    if (tab) tab.classList.toggle('live', Boolean(tg));
    if (!tg) return;
    $('tgsharebox').hidden = tg.role !== 'host' || !tg.link;
    if ($('tgshare').value !== tg.link) $('tgshare').value = tg.link;
    const who = tg.name || 'Your partner';
    let text;
    if (!tg.joined) text = tg.role === 'host' ? 'Waiting for your partner to open the link…' : 'Connecting…';
    else if (this._simple) text = `${who} is here · ${tg.sync ? 'synced: you both feel the same' : $('tgaccept').checked ? 'they play your toys' : 'they cannot play your toys yet'}`;
    else text = `${who} is here · ${tg.theirs ? 'your slider drives their devices' : 'they have not let you control yet'} · ${$('tgaccept').checked ? 'they drive your devices' : 'your devices do not follow them'}`;
    if ($('tgstat').textContent !== text) $('tgstat').textContent = text;
    // Whose toys are whose (his / hers), and what plays what.
    const chip = (d) => { const o = this._whose(d); return o === 'unassigned' ? '' : `<span class="tgchip ${o}">${o === 'his' ? 'His' : 'Hers'}</span>`; };
    const esc = (t) => String(t).replace(/[&<>"]/g, '');
    const mineList = (this._outs || []).map((o, i) => this._outDevice(i)).filter(Boolean);
    const theirs = tg.partner.map((t) => this._devices.find((d) => d.id === t.split('|')[0])).filter(Boolean);
    const row = (label, list, empty) => `<div class="tgrow"><span class="tglab">${label}</span>${list.length ? list.map((d) => `<span class="tgtoy">${esc(d.name)}${chip(d)}</span>`).join('') : `<span class="tgnone">${empty}</span>`}</div>`;
    const html = tg.role !== 'host' ? '' : row('Your toys', mineList, 'none chosen under Devices')
      + row('Their toys', theirs, tg.joined ? 'they can pick theirs on their page' : 'when they join');
    if ($('tgtoys').innerHTML !== html) $('tgtoys').innerHTML = html;
    $('tgsync').checked = tg.sync;
    $('tgsync').disabled = !tg.joined;
    $('tgrec').textContent = tg.rec ? '■ Stop recording' : '● Record partner';
    $('tgrec').classList.toggle('on', Boolean(tg.rec));
    $('tgrec').disabled = !tg.joined || tg.role !== 'host';
    $('tgsendbox').hidden = this._simple;
  }
}
