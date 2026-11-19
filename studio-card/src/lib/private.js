// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// Private mode, in the browser: one feed per page (shared by every Ogg card,
// and by the Control Deck, which carries a copy of this). For the person who
// turned private mode on, Ogg sends the live states of its entities (Home
// Assistant keeps showing everyone else what was there before); the cards are
// given Home Assistant's states with those laid over them, so for that person
// everything behaves as usual, on every device they are signed in on.
export function oggPrivate() {
  const have = window.__oggPrivate;
  if (have) {
    // An older copy (an earlier Control Deck, say) may not keep the viewers: teach it.
    if (!have.__viewers) {
      have.__viewers = true;
      if (!Array.isArray(have.viewers)) have.viewers = [];
      const before = have._event;
      have._event = function (ev) {
        if (ev && Array.isArray(ev.viewers)) this.viewers = ev.viewers;
        return before.call(this, ev);
      };
      // It may already have had the list: subscribe again for a fresh one.
      if (have.conn && typeof have._sub === 'function') have._sub(have.conn);
    }
    return have;
  }
  const p = {
    conn: null, unsub: null, on: false, mine: false, since: null, known: false,
    states: {}, version: 0, cards: new Set(), cache: null, viewers: [],
    // A card's Home Assistant object (and the card, to tell it of changes).
    attach(hass, card) {
      if (card) this.cards.add(card);
      if (hass && hass.connection && hass.connection !== this.conn) this._sub(hass.connection);
    },
    _sub(conn) {
      if (this.unsub) { try { this.unsub(); } catch (_) { /* gone */ } }
      this.conn = conn; this.unsub = null; this.states = {}; this.on = false; this.mine = false; this.known = false;
      Promise.resolve(conn.subscribeMessage((ev) => this._event(ev), { type: 'ogg/private/subscribe' }))
        .then((u) => { if (this.conn === conn) this.unsub = u; else u(); })
        .catch(() => { /* an Ogg without private mode */ });
    },
    _event(ev) {
      if (!ev || typeof ev !== 'object') return;
      if (Array.isArray(ev.viewers)) this.viewers = ev.viewers;   // who has an Ogg card open
      if ('on' in ev) {
        this.on = Boolean(ev.on); this.mine = Boolean(ev.mine); this.since = ev.since || null; this.known = true;
        this.states = ev.states && this.mine ? { ...ev.states } : {};
      } else if (ev.states && this.mine) Object.assign(this.states, ev.states);
      this.version += 1;
      this.cache = null;
      for (const card of [...this.cards]) {
        if (!card.isConnected) { this.cards.delete(card); continue; }
        try { card._oggPrivateChanged(); } catch (e) { console.warn('Ogg private mode', e); }
      }
    },
    // Home Assistant as the card should see it.
    wrap(hass) {
      if (!hass || !this.on || !this.mine) return hass;
      if (this.cache && this.cache.hass === hass && this.cache.version === this.version) return this.cache.out;
      const overlay = {};
      for (const [id, row] of Object.entries(this.states)) {
        const base = hass.states[id];
        overlay[id] = {
          ...(base || {}), entity_id: id, state: row.state, attributes: row.attributes,
          last_changed: new Date(row.last_changed * 1000).toISOString(),
          last_updated: new Date(row.last_updated * 1000).toISOString(),
        };
      }
      const out = { ...hass, states: { ...hass.states, ...overlay } };
      this.cache = { hass, version: this.version, out };
      return out;
    },
    async set(hass, on) {
      return hass.callWS({ type: 'ogg/private/set', on });
    },
  };
  p.__viewers = true;
  window.__oggPrivate = p;
  return p;
}

// A card class's `hass` goes through private mode (and it re-renders when
// the live states change).
export function privateHass(cls) {
  const desc = Object.getOwnPropertyDescriptor(cls.prototype, 'hass');
  if (!desc || !desc.set || cls.prototype._oggPrivateChanged) return;
  Object.defineProperty(cls.prototype, 'hass', {
    configurable: true,
    get: desc.get,
    set(hass) {
      const p = oggPrivate();
      this._rawHass = hass;
      p.attach(hass, this);
      desc.set.call(this, p.wrap(hass));
    },
  });
  cls.prototype._oggPrivateChanged = function () {
    if (this._rawHass) desc.set.call(this, oggPrivate().wrap(this._rawHass));
  };
}

// 👥 in a card's header: how many people have an Ogg card open (tap for who).
export const VIEWERS_STYLE = '.viewers{flex:0 0 auto;min-height:0;height:30px;padding:0 10px;border-radius:15px;font-size:12px;font-weight:800;border:1px solid rgba(174,194,246,.22);background:transparent;color:#c9d3ee;cursor:pointer;display:inline-flex;align-items:center;gap:4px}.viewers[hidden]{display:none}.viewers b{font-variant-numeric:tabular-nums}';
export const viewersBadge = () => '<button type="button" class="viewers" data-viewers hidden aria-label="People viewing Ogg">👥 <b></b></button>';
export function paintViewers(root, toast) {
  const b = root && root.querySelector('[data-viewers]');
  if (!b) return;
  const v = oggPrivate().viewers || [];
  if (!v.length) { b.hidden = true; return; }
  b.hidden = false;
  const n = String(v.length);
  if (b.querySelector('b').textContent !== n) b.querySelector('b').textContent = n;
  const names = v.map((x) => (x.pages > 1 ? `${x.name} (${x.pages} devices)` : x.name)).join(', ');
  b.title = `Viewing Ogg now: ${names}`;
  b.setAttribute('aria-label', `${n} ${v.length === 1 ? 'person' : 'people'} viewing Ogg: ${names}`);
  if (!b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => { if (toast) toast(b.title); }); }
}
