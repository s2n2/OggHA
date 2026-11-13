// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// Private mode, in the browser: one feed per page (shared by every Ogg card,
// and by the Control Deck, which carries a copy of this). For the person who
// turned private mode on, Ogg sends the live states of its entities (Home
// Assistant keeps showing everyone else what was there before); the cards are
// given Home Assistant's states with those laid over them, so for that person
// everything behaves as usual, on every device they are signed in on.
export function oggPrivate() {
  if (window.__oggPrivate) return window.__oggPrivate;
  const p = {
    conn: null, unsub: null, on: false, mine: false, since: null, known: false,
    states: {}, version: 0, cards: new Set(), cache: null,
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
