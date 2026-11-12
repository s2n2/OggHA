// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { duration, esc, fmt } from '../lib/core.js';
import { MOODS } from '../lib/moods.js';
import { heatColor, heatmap, loopScript, stitchScripts, trimScript } from '../lib/tools.js';

const QUEUE_KEY = 'oggstudio_queue';
const TAKE_HEAT = '\u0000take';

const paintHeat = (canvas, heat) => {
  canvas.width = heat.length;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  heat.forEach((v, i) => { ctx.fillStyle = heatColor(v); ctx.fillRect(i, 0, 1, 1); });
};

// Methods mixed into OggStudioCard.
export class ToolsPart {
  // ---------------------------------------------------------- script tools
  // A heatmap on the replay bar and in the picker; trim, repeat and stitch
  // (each result becomes the current take); and a queue of scripts and moods.
  _bindTools() {
    const $ = this._el;
    $('tlbtn').addEventListener('click', () => { $('tlbox').hidden = !$('tlbox').hidden; $('plbox').hidden = true; this._toolsUpdate(); });
    $('plbtn').addEventListener('click', () => { $('plbox').hidden = !$('plbox').hidden; $('tlbox').hidden = true; this._toolsUpdate(); this._plShow(); });
    $('tlstart').addEventListener('click', () => this._tlTrim(false));
    $('tlend').addEventListener('click', () => this._tlTrim(true));
    $('tlloop').addEventListener('click', () => this._tlEdit((raw) => loopScript(raw, Number($('tln').value)), `Repeated ${$('tln').value} times.`));
    $('tlstitch').addEventListener('click', () => this._tlStitch());
    $('tln').replaceChildren(...[2, 3, 4, 5, 8, 10, 20].map((n) => new Option(`× ${n}`, String(n))));
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null'); } catch (_) { /* private mode */ }
    const items = kept && Array.isArray(kept.items) ? kept.items.filter((it) => it && (typeof it.script === 'string' || typeof it.mood === 'string')) : [];
    this._pl = { items, loop: Boolean(kept && kept.loop), i: -1, on: false, run: 0, busy: false };
    $('plloop').checked = this._pl.loop;
    $('plloop').addEventListener('change', () => { this._pl.loop = $('plloop').checked; this._plKeep(); });
    $('pladdbtn').addEventListener('click', () => {
      const v = $('pladd').value;
      if (!v) return;
      this._pl.items.push(v.startsWith('m:') ? { mood: v.slice(2) } : { script: v.slice(2) });
      this._plKeep(); this._plShow();
    });
    $('plplay').addEventListener('click', () => { if (this._pl.on) { this._plOff(); this._rpStop(); } else this._plPlay(0); });
    $('plsaved').addEventListener('change', () => this._plLoadSaved());
    $('plsave').addEventListener('click', () => this._plSave());
    $('pldel').addEventListener('click', () => this._plDelete());
    $('pllist').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = Number(b.parentElement.dataset.i), pl = this._pl;
      const act = b.dataset.act;
      if (act === 'go') { this._plPlay(i); return; }
      if (pl.on) { this._plOff(); this._rpStop(); }
      if (act === 'x') pl.items.splice(i, 1);
      const j = act === 'up' ? i - 1 : act === 'down' ? i + 1 : -1;
      if (j >= 0 && j < pl.items.length) [pl.items[i], pl.items[j]] = [pl.items[j], pl.items[i]];
      this._plKeep(); this._plShow();
    });
    this._plShow();
  }

  _savedNames() {
    const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
    return ((saved && saved.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
  }

  // Called from _update: the lists that follow the library.
  _toolsUpdate() {
    if (!this._pl) return;
    const $ = this._el;
    const names = this._savedNames();
    const saved = this._studio && this._hass.states[this._studio.saved];
    const lists = Object.keys((saved && saved.attributes.playlists) || {}).sort((a, b) => a.localeCompare(b));
    const key = JSON.stringify([names, lists]);
    if ($('tlbox').dataset.key === key) return;
    $('tlbox').dataset.key = key;
    $('tlother').replaceChildren(new Option(names.length ? 'Choose a saved script…' : 'No saved scripts yet', ''), ...names.map((n) => new Option(n, n)));
    $('pladd').replaceChildren(new Option('Add a script or mood…', ''), ...names.map((n) => new Option(n, `s:${n}`)),
      ...Object.entries(MOODS).map(([k, m]) => new Option(`${m.icon} Mood: ${m.label}`, `m:${k}`)));
    $('plsaved').replaceChildren(new Option(lists.length ? 'Open a saved queue…' : 'No saved queues yet', ''), ...lists.map((n) => new Option(n, n)));
  }

  // ---- heatmap
  _heatShow() {
    const rp = this._rp;
    if (!this._el || !rp || this._heatFor === rp.raw) return;
    this._heatFor = rp.raw;
    const canvas = this._el('rpheat');
    this._el('rpbar').classList.toggle('heat', Boolean(rp.raw));
    if (rp.raw) paintHeat(canvas, heatmap(rp.raw, 240));
  }

  // Small heatmaps under the picker's entries, fetched one at a time.
  async _pickHeats() {
    const run = (this._heatRun = (this._heatRun || 0) + 1);
    this._heatCache = this._heatCache || {};
    for (const b of [...this._el('rplist').querySelectorAll('button[data-heat]')]) {
      const name = b.dataset.heat;
      let heat;
      if (name === TAKE_HEAT) heat = this._take && heatmap(this._take, 80);
      else {
        const info = this._scriptInfo(name);
        const key = `${name}:${(info && info.duration_ms) || 0}`;
        heat = this._heatCache[key];
        if (!heat) {
          try { heat = this._heatCache[key] = heatmap(await this._getSaved(name), 80); } catch (_) { continue; }
        }
      }
      if (run !== this._heatRun || this._el('rppop').hidden) return;
      if (!heat) continue;
      const c = document.createElement('canvas');
      c.className = 'pkheat';
      paintHeat(c, heat);
      b.appendChild(c);
    }
  }

  // ---- trim, repeat, stitch
  _tlEdit(fn, done) {
    const rp = this._rp;
    if (!rp.raw) { this._toast('Choose a script first.'); return; }
    if (rp.raw.mood) { this._toast('A mood cannot be edited: it is made new each time.'); return; }
    try {
      const out = fn(rp.raw);
      out.metadata = { ...(out.metadata || {}) };
      this._plOff();
      this._take = out;
      this._rpLoad(out, 'Current take', null);
      this._update();
      this._toast(`${done} It is now the current take (${fmt(duration(out))}): save it under a name to keep it.`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  _tlTrim(end) {
    const t = this._rp.t, len = this._rp.len;
    this._tlEdit((raw) => (end ? trimScript(raw, 0, t) : trimScript(raw, t, len)), end ? `Cut everything after ${fmt(t)}.` : `Cut everything before ${fmt(t)}.`);
  }

  async _tlStitch() {
    const name = this._el('tlother').value;
    if (!name) { this._toast('Choose the script to add first.'); return; }
    let other;
    try { other = await this._getSaved(name); } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); return; }
    this._tlEdit((raw) => stitchScripts(raw, other), `Added "${name}" after it.`);
  }

  // ---- queue
  _plKeep() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify({ items: this._pl.items, loop: this._pl.loop })); } catch (_) { /* private mode */ }
  }

  _plLabel(it) {
    if (it.mood) { const m = MOODS[it.mood]; return m ? `${m.icon} Mood: ${m.label}` : `Mood: ${it.mood}`; }
    return it.script;
  }

  _plShow() {
    if (!this._el || !this._pl) return;
    if (this._mediaShow) this._mediaShow();      // the Queue section's badge
    const $ = this._el;
    const pl = this._pl;
    const label = pl.items.length ? `☰ Queue (${pl.items.length})` : '☰ Queue';
    if ($('plbtn').textContent !== label) $('plbtn').textContent = label;
    $('plbtn').classList.toggle('on', pl.on);
    $('plplay').textContent = pl.on ? '■ Stop queue' : '▶ Play queue';
    $('plplay').classList.toggle('stop', pl.on);
    if ($('plbox').hidden) return;
    $('pllist').innerHTML = pl.items.map((it, i) => `<div class="plitem${pl.on && i === pl.i ? ' on' : ''}" data-i="${i}">`
      + `<button type="button" class="plname" data-act="go">${i + 1}. ${esc(this._plLabel(it))}</button>`
      + `<button type="button" data-act="up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>`
      + `<button type="button" data-act="down" aria-label="Move down"${i < pl.items.length - 1 ? '' : ' disabled'}>↓</button>`
      + '<button type="button" data-act="x" aria-label="Remove">✕</button></div>').join('')
      || '<div class="hint">Add scripts and moods; they play in order.</div>';
  }

  // The queue stops following (what is playing carries on).
  _plOff() {
    const pl = this._pl;
    if (!pl || !pl.on) return;
    pl.on = false; pl.i = -1; pl.run += 1;
    this._plShow();
  }

  _plNext() {
    const pl = this._pl;
    if (pl.busy) return;
    pl.busy = true;
    this._plPlay(pl.i + 1).finally(() => { pl.busy = false; });
  }

  async _plPlay(start) {
    const pl = this._pl;
    if (!pl.items.length) { this._toast('The queue is empty.'); return; }
    const run = (pl.run += 1);
    let i = start, done = false;
    for (let tried = 0; tried < pl.items.length; tried++, i++) {
      if (i >= pl.items.length) {
        if (!pl.loop) { done = true; break; }
        i = 0;
      }
      const it = pl.items[i];
      pl.on = true; pl.i = i;
      this._plShow();
      if (it.mood) {
        if (!MOODS[it.mood]) continue;
        this._mood = { key: it.mood, combo: -1 };
        this._moodNext(true);
        return;
      }
      let script;
      try { script = await this._getSaved(it.script); } catch (_) { script = null; }
      if (run !== pl.run) return;                 // stopped, or another start, meanwhile
      if (!script) { this._toast(`"${it.script}" is no longer in the library: skipped.`); continue; }
      this._mood = null;
      this._rpLoad(script, it.script, it.script);
      this._rpPlay();
      return;
    }
    pl.on = false; pl.i = -1;
    this._rpStop();
    this._plShow();
    this._toast(done ? 'The queue has finished.' : 'Nothing in the queue could be played.');
  }

  _plLoadSaved() {
    const $ = this._el;
    const name = $('plsaved').value;
    const saved = this._studio && this._hass.states[this._studio.saved];
    const list = name && saved && saved.attributes.playlists && saved.attributes.playlists[name];
    if (!list) return;
    if (this._pl.on) { this._plOff(); this._rpStop(); }
    this._pl.items = (list.items || []).map((it) => ({ ...it }));
    this._pl.loop = Boolean(list.loop);
    $('plloop').checked = this._pl.loop;
    $('plname').value = name;
    this._plKeep(); this._plShow();
  }

  async _plSave() {
    const name = this._el('plname').value.trim();
    if (!name) { this._toast('Type a name for the queue first.'); return; }
    if (!this._pl.items.length) { this._toast('The queue is empty.'); return; }
    try {
      await this._hass.callService('ogg', 'studio_save_playlist', { name, items: this._pl.items, loop: this._pl.loop });
      this._toast(`Saved the queue "${name}".`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  async _plDelete() {
    const name = this._el('plsaved').value || this._el('plname').value.trim();
    if (!name || !confirm(`Delete the saved queue "${name}"?`)) return;
    try { await this._hass.callService('ogg', 'studio_delete_playlist', { name }); this._toast(`Deleted the queue "${name}".`); }
    catch (e) { this._toast(e.message || String(e)); }
  }
}
