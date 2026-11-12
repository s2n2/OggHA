// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
import { FOLLOW_AI } from '../lib/ai.js';
import { RUN_MODES, RUN_MODE_DEFAULT, fileKind, fileTitle, isStroke, normalise } from '../lib/convert.js';
import { SAMPLE_MS, SPEEDS, TAKE_SRC, decodeText, duration, encodeCode, fmt } from '../lib/core.js';
import { limitLevels, limitMove } from '../lib/limits.js';
import { FOLLOW_STROKER, OUT_KEY, outLevels, parseTarget } from '../lib/outputs.js';

const MAX_OUTS = 4;
const OUT_FOLD_KEY = 'oggstudio_outputs_folded';
const NO_OUT = Object.freeze({ t: 'none', m: 'position', on: true });

// Methods mixed into OggStudioCard.
export class OutputsPart {
  // ---------------------------------------------------------- outputs
  _bindOutputs() {
    const $ = this._el;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(OUT_KEY) || 'null'); } catch (_) { /* private mode */ }
    if (saved && Array.isArray(saved.t)) {
      // Up to four devices; "none" and "off" (from the old two-row box) are no device.
      const m = Array.isArray(saved.m) ? saved.m : [];
      const on = Array.isArray(saved.on) ? saved.on : [];
      this._outs = saved.t.map((t, i) => ({ t, m: typeof m[i] === 'string' ? m[i] : 'position', on: on[i] !== false }))
        .filter((o) => o.t !== 'none' && o.t !== 'off' && (o.t === null || typeof o.t === 'string')).slice(0, MAX_OUTS);
    } else this._outs = [{ t: null, m: 'position', on: true }];    // first use: the remembered (or first) device
    let fold = false;
    try { fold = localStorage.getItem(OUT_FOLD_KEY) === '1'; } catch (_) { /* private mode */ }
    this._outFold(fold);
    $('outfold').addEventListener('click', () => this._outFold(!this._outFolded, true));
    $('outadd').addEventListener('click', () => this._outAdd());
    // The rows are drawn from the list; their controls are handled here.
    const rows = $('outrows');
    const at = (e) => { const row = e.target.closest('.outrow'); return row ? Number(row.dataset.row) : -1; };
    rows.addEventListener('change', (e) => {
      const i = at(e);
      if (i < 0 || !this._outs[i]) return;
      if (e.target.classList.contains('outt')) this._outSwitch(i, { t: e.target.value });
      else if (e.target.classList.contains('outm')) this._outSwitch(i, { m: e.target.value });
      else if (e.target.classList.contains('outon')) {
        // Active: this device follows (on by default). Off, it is left alone.
        this._outStop();
        this._outs[i].on = e.target.checked;
        this._outSave();
        if (this._simple) this._el('stlive').checked = this._anyActive;
        this._outRender();
      }
    });
    rows.addEventListener('click', (e) => {
      const i = at(e);
      if (i < 0) return;
      if (e.target.closest('.outtake')) this._outTake(i);
      else if (e.target.closest('.outdel')) this._outRemove(i);
    });
    this._outRender();
  }

  // Folded: just the count of connected devices.
  _outFold(on, save) {
    this._outFolded = Boolean(on);
    this._el('outbody').hidden = this._outFolded;
    this._el('outfold').setAttribute('aria-expanded', String(!this._outFolded));
    this._el('outbox').classList.toggle('folded', this._outFolded);
    if (this._outFolded) this._el('limbox').hidden = true;
    if (save) { try { localStorage.setItem(OUT_FOLD_KEY, this._outFolded ? '1' : '0'); } catch (_) { /* private mode */ } }
  }

  _outAdd() {
    if (this._outs.length >= MAX_OUTS) return;
    // The next device not already in the list (a stroker as a stroker).
    const used = new Set(this._outs.map((o, i) => (parseTarget(this._outTargetValue(i)) || {}).id));
    const dev = this._devices.find((d) => !used.has(d.id) && this._online(d)) || this._devices.find((d) => !used.has(d.id)) || this._devices[0];   // or one again (its other motor, say)
    const t = dev ? `${dev.id}|${dev.linear && !dev.vibe ? 'l' : 'b'}` : null;
    this._outStop();
    this._outs.push({ t, m: 'position', on: true });
    this._outSave();
    this._outRender();
    if (this._simple && this._outs.length === 1) this._autoKind();
    this._update();
  }

  _outRemove(i) {
    this._outStop();
    this._outs.splice(i, 1);
    this._outSave();
    this._outRender();
    if (this._simple) this._el('stlive').checked = this._anyActive;
    this._update();
  }

  // An output by place, or a stand-in (no device) where there is none: the
  // two pads always have a first output each (1 and 2; 3 and 4 follow too).
  _outAt(i) { return (this._outs && this._outs[i]) || NO_OUT; }
  get _outIdx() { return Array.from({ length: Math.max(2, this._outs ? this._outs.length : 0) }, (_, i) => i); }

  // Any device switched on (and chosen)?
  get _anyActive() { return Boolean(this._outs) && this._outs.some((o, i) => o.on !== false && parseTarget(this._outTargetValue(i))); }

  _outSave() {
    try { localStorage.setItem(OUT_KEY, JSON.stringify({ t: this._outs.map((o) => o.t), m: this._outs.map((o) => o.m), on: this._outs.map((o) => o.on !== false) })); } catch (_) { /* private mode */ }
  }

  _outSwitch(i, change) {
    // A device that stops being an output goes quiet (and is released).
    if (!this._outs[i]) return;
    this._outStop();
    Object.assign(this._outs[i], change);
    this._outSave();
    this._outRender();
    if (this._simple && 't' in change && i === 0) this._autoKind();
    this._update();
  }

  // The saved target if it still exists, else a sensible default.
  _outTargetValue(i) {
    const o = this._outs && this._outs[i];
    if (!o) return 'none';
    const t = o.t;
    if (t === 'none' || t === 'off') return 'none';
    const p = parseTarget(t);
    if (p && this._devices.some((d) => d.id === p.id)) return t;
    if (i > 0) return 'none';
    if (!this._registryDone) return 'none';
    const id = this._remembered && this._remembered.id;
    const dev = this._devices.find((d) => d.id === id) || this._devices.find((d) => this._online(d)) || this._devices[0];
    return dev ? `${dev.id}|${dev.linear && !dev.vibe ? 'l' : 'b'}` : 'none';
  }

  _outDevice(i) { const p = parseTarget(this._outTargetValue(i)); return p ? this._devices.find((d) => d.id === p.id) : null; }

  _controllers() {
    const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
    return (saved && saved.attributes.controllers) || {};
  }

  // Driven by another OggStudio card (another phone or browser) right now?
  _claimedBy(dev) {
    const c = dev && this._controllers()[dev.stop];
    if (!c || c.owner === this._owner) return null;
    if (this._tookAt && this._tookAt[dev.stop] && performance.now() - this._tookAt[dev.stop] < 3000) return null;   // we just took it
    return c;
  }

  _outLabel() {
    const ua = navigator.userAgent;
    const where = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'a browser';
    return `${(this._hass && this._hass.user && this._hass.user.name) || 'Someone'} on ${where}`;
  }

  _outClaim(dev) {
    if (this._claimedBy(dev)) return false;
    const now = performance.now();
    this._claimed.set(dev.stop, dev);
    if (!(now - (this._claimAt[dev.stop] || -1e9) < 4000)) {
      this._claimAt[dev.stop] = now;
      this._hass.callService('ogg', 'studio_claim', { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, undefined, false).catch(() => {});
    }
    return true;
  }

  _outTake(i) {
    const dev = this._outDevice(i);
    if (!dev) return;
    this._tookAt = this._tookAt || {};
    this._tookAt[dev.stop] = performance.now();
    this._claimAt[dev.stop] = performance.now();
    this._hass.callService('ogg', 'studio_claim', { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, undefined, false).catch(() => {});
    this._toast(`You now control ${dev.name}.`);
    this._outRender();
  }

  // Send output values (0-100; a stroker may get {goal, dur}) to the devices.
  // `path` 'partner': what a Together partner sends, for my own toys.
  _outApply(values, seconds, path) {
    if (!this._hass || !this._outs) return;
    if (this._so && path !== 'partner') return;      // screen off: Ogg plays it (screenoff.js)
    const now = performance.now();
    if (now < (this._holdUntil || 0)) return;       // Stop all was just pressed
    let targets = this._outs.map((o, i) => this._outTargetValue(i));
    values = values.map((v, i) => (this._outs[i] && this._outs[i].on === false ? null : v));   // a device switched off is left alone
    // Together, with my partner's toys picked: my controls play theirs and
    // what they send plays mine; with Sync, both play both.
    const tg = this._tg;
    const partner = tg && tg.joined && tg.partner && tg.partner.length ? tg.partner : null;
    if (partner) {
      const pv = partner.map((t, j) => { const v = values[j % 2]; return v === undefined || v === null ? (values[0] ?? null) : v; });
      if (path !== 'partner') {
        const first = pv.find((v) => v !== null && v !== undefined);
        tg.outLevel = typeof first === 'object' && first ? first.goal : (first || 0);
      }
      if (tg.sync) { targets = [...targets, ...partner]; values = [...values, ...pv]; }
      else if (path !== 'partner') { targets = partner.slice(); values = pv; }
    } else if (tg && path !== 'partner') {
      const first = values.find((v) => v !== null && v !== undefined);
      tg.outLevel = typeof first === 'object' && first ? first.goal : (first || 0);
    }
    // A stroker's move and a vibrator's level each in their own form.
    values = values.map((v, i) => { const p = parseTarget(targets[i]); return v && typeof v === 'object' && p && p.motor !== 'l' ? v.goal : v; });
    let blocked = false;
    for (const e of outLevels(targets, values, this._devices)) {
      if (!this._outClaim(e.dev)) { blocked = true; continue; }
      if (e.vibe) {
        const lv = limitLevels(this._limits(e.dev), e.levels).map((x) => Math.round(x) / 100);
        const last = this._outLast[e.dev.id];
        if (!last || lv.some((x, j) => Math.abs(x - last.lv[j]) >= 0.01) || now - last.at > 500) {
          this._outLast[e.dev.id] = { lv, at: now };
          this._sendLive(e.dev, lv, seconds);
        }
      }
      if (e.linear !== null) {
        let move = typeof e.linear === 'object' ? e.linear : { goal: e.linear, dur: 150 };
        // On the Play cards a stroker always keeps inside its stroke limits;
        // on Stroke the level is already a place in them, on Vibrate it is
        // scaled into them here.
        if (this._simple && !this._strokeKind) move = { ...move, goal: this._lim(move.goal) };
        this._outLinear(e.dev, move, now);
      }
    }
    if (blocked !== Boolean(this._outBlocked)) { this._outBlocked = blocked; this._outRender(); }
  }

  // Strokers take "go to this position over this long" moves. Ogg's
  // ogg.linear does that live; without it, Ogg's Position control is used
  // (coarse: it moves over a fixed second).
  _outLinear(dev, asked, now) {
    const last = this._linLast[dev.id];
    const move = limitMove(this._limits(dev), asked, last ? last.goal : null);
    const goal = Math.round(Math.min(100, Math.max(0, move.goal)));
    if (last && last.goal === goal && now - last.at < 1000) return;
    const live = Boolean(this._hass.services && this._hass.services.ogg && this._hass.services.ogg.linear);
    if (last && now - last.at < (live ? 80 : 400)) return;
    this._linLast[dev.id] = { goal, at: now };
    if (live) this._hass.callService('ogg', 'linear', { entity_id: dev.stop, position: goal, duration: Math.max(50, Math.round(move.dur)) }, undefined, false).catch(() => {});
    else if (dev.linear) this._hass.callService('number', 'set_value', { entity_id: dev.linear, value: goal }, undefined, false).catch(() => {});
  }

  // Stop and release every device this card was driving (not ones another
  // controller has since taken over).
  _outStop() {
    if (this._so) return;                            // screen off: Ogg is playing the timelines
    for (const [stop, dev] of this._claimed) {
      if (this._claimedBy(dev)) continue;
      this._quietStop(dev);
      if (this._hass) this._hass.callService('ogg', 'studio_claim', { entity_id: stop, owner: this._owner, release: true }, undefined, false).catch(() => {});
    }
    this._claimed.clear();
    this._claimAt = {};
    this._outLast = {};
    this._linLast = {};
    this._aiLive = [];
  }

  _outRender() {
    if (!this._el || !this._outs) return;
    const $ = this._el;
    const stroke = this._strokeKind;
    const devs = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
    const list = [];
    for (const d of devs) {
      const name = this._online(d) ? d.name : `${d.name} (offline)`;
      const vibe = d.vibe || !d.linear;   // a stroker-only device has no vibration
      if (vibe && !d.dual) list.push([`${d.id}|b`, name]);
      if (vibe && d.dual) list.push([`${d.id}|b`, `${name} · both motors`], [`${d.id}|0`, `${name} · motor 1`], [`${d.id}|1`, `${name} · motor 2`]);
      if (d.linear) list.push([`${d.id}|l`, `${name} · stroker`]);
    }
    if (!list.length) list.push(['none', 'No device found']);
    // One row per device (up to four); redrawn when the count changes.
    const box = $('outrows');
    const n = this._outs.length;
    if (box.children.length !== n) {
      box.replaceChildren(...this._outs.map((o, i) => {
        const row = document.createElement('div');
        row.className = 'outrow';
        row.dataset.row = String(i);
        row.innerHTML = `<input class="outon" type="checkbox" role="switch" title="Active: this device follows" aria-label="Device ${i + 1} active"><span class="outpad" title="Follows pad ${(i % 2) + 1}">${(i % 2) + 1}</span><select class="outt" aria-label="Device ${i + 1}"></select><select class="outm" aria-label="How device ${i + 1} follows"></select><button class="outdel" type="button" title="Remove this device" aria-label="Remove device ${i + 1}">✕</button><div class="outai" hidden></div><button class="outtake" type="button" hidden>Take control</button>`;
        return row;
      }));
    }
    const labels = ['Pad 1', 'Pad 2'];
    for (const row of box.querySelectorAll('.outrow')) {
      const i = Number(row.dataset.row);
      const o = this._outs[i];
      const sel = row.querySelector('.outt');
      const key = JSON.stringify([stroke, list]);
      if (sel.dataset.key !== key) { sel.replaceChildren(...list.map(([v, t]) => new Option(t, v))); sel.dataset.key = key; }
      const value = this._outTargetValue(i);
      if ([...sel.options].some((op) => op.value === value)) sel.value = value;
      const p = parseTarget(value);
      const dev = p && this._devices.find((d) => d.id === p.id);
      if (i < 2) labels[i] = dev ? (p.motor === 'b' ? dev.name : p.motor === 'l' ? `${dev.name} (stroker)` : `${dev.name} m${Number(p.motor) + 1}`) : `Pad ${i + 1}`;
      row.querySelector('.outon').checked = o.on !== false;
      row.querySelector('.outpad').classList.toggle('gone', n < 2);   // keeps its column, so the row does not shift
      // How it follows (stroke recorder): a stroker by position, a vibrator by a run mode.
      const msel = row.querySelector('.outm');
      const modes = p && p.motor === 'l'
        ? [[FOLLOW_STROKER, 'Stroker: follows the position'], [FOLLOW_AI, "✨ AI feel: strokes from a vibration's mood"]]
        : [[FOLLOW_AI, "✨ AI feel: patterns from the stroke's mood"], ...Object.entries(RUN_MODES).map(([v, t]) => [v, t.replace(/ \(vibration scripts\)/, '')]), [FOLLOW_STROKER, 'Stroker: level = position']];
      const mkey = JSON.stringify(modes);
      if (msel.dataset.key !== mkey) { msel.replaceChildren(...modes.map(([v, t]) => new Option(t, v))); msel.dataset.key = mkey; }
      if (!modes.some(([v]) => v === o.m)) o.m = p && p.motor !== 'l' && o.m !== FOLLOW_AI ? 'position' : modes[0][0];
      msel.value = o.m;
      const owner = dev && this._claimedBy(dev);
      const take = row.querySelector('.outtake');
      take.hidden = !owner;
      if (owner) take.textContent = `Take control (${owner.label || 'in use'})`;
      msel.hidden = Boolean(owner);
      row.classList.toggle('take', Boolean(owner));
    }
    $('outadd').hidden = n >= MAX_OUTS;
    $('limbtn').hidden = n === 0;
    if (!n) $('limbox').hidden = true;
    $('outhint').hidden = n < 2;
    // The count: devices on, chosen and connected.
    const live = this._outs.filter((o, i) => { if (o.on === false) return false; const d = this._outDevice(i); return Boolean(d && this._online(d)); }).length;
    const cnt = $('outcount');
    cnt.classList.toggle('zero', !live);
    const b = cnt.querySelector('b');
    if (b.textContent !== String(live)) b.textContent = String(live);
    this._padLabels = labels;
    for (const [i, id] of [[0, 'pad1'], [1, 'pad2']]) { const lab = this._el(id).querySelector('.lab'); if (lab.textContent !== labels[i]) lab.textContent = labels[i]; }
    const two = this._twoPads;
    this._el('pad2').hidden = !two;
    this._el('pads').classList.toggle('dual', two);
    const busy = this._devices.some((d) => this._claimedBy(d));
    const note = this._outBlocked ? 'A device is being controlled from another phone or browser: it does not follow here until you take control.'
      : busy ? 'Some devices are in use elsewhere.' : '';
    if (this._el('outnote').textContent !== note) this._el('outnote').textContent = note;
  }



  _startRecording() {
    const $ = this._el;
    this._recording = true;
    this._t0 = performance.now();
    this._samples = [[], []];
    this._last = [null, null];
    const sample = () => {
      const t = Math.round(performance.now() - this._t0);
      this._levels().forEach((v, i) => {
        const pos = Math.round(v * 100);
        if (pos !== this._last[i]) { this._samples[i].push({ at: t, pos }); this._last[i] = pos; }
      });
      $('timer').textContent = fmt(t);
    };
    sample();
    this._sampleTimer = setInterval(sample, SAMPLE_MS);
    this._setLive(true);
    this._update();
  }

  _stopRecording() {
    const $ = this._el;
    clearInterval(this._sampleTimer);
    const t = Math.round(performance.now() - this._t0);
    this._recording = false;
    this._setLive($('live').checked);
    for (const i of [0, 1]) if (this._samples[i].length) { this._samples[i].push({ at: t, pos: this._last[i] }); this._samples[i].push({ at: t + 1, pos: 0 }); }
    const take = { version: '1.0', inverted: false, range: 100, actions: this._samples[0], metadata: { creator: 'OggStudio', type: 'vibration' } };
    if (this._twoPads && this._samples[1].length) take.channels = { V1: { actions: this._samples[1] } };
    this._take = take.actions.length ? take : null;
    $('timer').textContent = '';
    this._setPad(0, 0); this._setPad(1, 0);
    this._update();
  }

  // Take and library playback run through Replay: the devices above,
  // each following its own way, and the pads or bar show it.
  _play(script) { this._playScript(script, 'Current take', null); }

  async _playSaved() {
    if (this._simple && this._libPick === 'take' && this._take) { this._play(this._take); return; }
    if (this._simple && this._libPick === 'loaded' && this._rp.raw) { this._playScript(this._rp.raw, this._rp.name, null); return; }
    const name = this._el('saved').value;
    try { this._playScript(await this._getSaved(name), name, name); } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); }
  }

  _playScript(script, name, lib) {
    if (!script) return;
    this._plOff();
    this._setCtl(this._simple ? 'library' : 'replay');
    this._rpLoad(script, name, lib);
    if (SPEEDS.includes(this._el('speed').value)) this._el('rpspeed').value = this._el('speed').value;
    this._el('rploop').checked = this._el('loop').checked;
    this._rpPlay();
  }

  _stop() { this._rpStop(); }

  async _save() {
    const name = this._el('name').value.trim();
    if (!name) { this._toast('Type a name first'); return; }
    try {
      await this._hass.callService('ogg', 'studio_save', { name, script: this._take, ...(isStroke(this._take) && RUN_MODES[this._outAt(0).m] ? { mode: this._outAt(0).m } : {}) });
      this._toast(`Saved "${name}"`);
      this._take = null;
      this._el('name').value = '';
      this._update();
    } catch (e) { this._toast(e.message || String(e)); }
  }

  // A saved script's details from the Saved script entity: kind
  // (stroke/vibration) and the run mode last used for it.
  _scriptInfo(name) {
    const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
    return (name && saved && saved.attributes.scripts && saved.attributes.scripts[name]) || null;
  }

  _setMode(name, mode) {
    this._hass.callService('ogg', 'studio_set_mode', { name, mode }, undefined, false).catch(() => {});
  }

  _download(script, name) {
    if (!script) return;
    const blob = new Blob([JSON.stringify(script)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const base = String(name).replace(/[\\/:*?"<>|]+/g, '_').replace(/(\.vib)?(\.funscript)?$/i, '');
    a.download = `${base}${isStroke(script) ? '' : '.vib'}.funscript`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async _getSaved(name) {
    const res = await this._hass.callWS({ type: 'call_service', domain: 'ogg', service: 'studio_get_script', service_data: { name }, return_response: true });
    return res.response.script;
  }

  // Copy straight from the tap: the clipboard is asked at once (phones
  // allow it only then), with the code to follow as soon as it is ready.
  _copySaved() {
    if (this._simple && this._libPick === 'take' && this._take) { this._copy(this._take); return; }
    if (this._simple && this._libPick === 'loaded' && this._rp.raw) { this._copy(this._rp.raw); return; }
    const name = this._el('saved').value;
    if (this._rp && this._rp.raw && this._rp.lib === name) { this._copy(this._rp.raw); return; }
    this._copy(() => this._getSaved(name));
  }

  _copy(script) {
    if (!script) return;
    const codeP = (async () => { const s = typeof script === 'function' ? await script() : script; if (!s) throw new Error('No script'); return encodeCode(s); })();
    let asked;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        asked = navigator.clipboard.write([new ClipboardItem({ 'text/plain': codeP.then((c) => new Blob([c], { type: 'text/plain' })) })]);
      } else asked = codeP.then((c) => navigator.clipboard.writeText(c));
    } catch (e) { asked = Promise.reject(e); }
    asked.then(async () => this._toast(`Code copied (${(await codeP).length} characters)`)).catch(async () => {
      let code;
      try { code = await codeP; } catch (e) { this._toast('Could not get the script: ' + (e.message || e)); return; }
      // No clipboard here: show the code to copy by hand.
      if (this._simple) { window.prompt('Copy this code:', code); return; }
      const out = this._el('codeout');
      out.hidden = false; out.value = code; out.select();
      this._toast('Clipboard unavailable: the code is shown in the Import box; copy it from there.');
    });
  }

  async _delete() {
    const name = this._el('saved').value;
    if (!name || !confirm(`Delete "${name}"?`)) return;
    try { await this._hass.callService('ogg', 'studio_delete', { name }); this._toast(`Deleted "${name}"`); }
    catch (e) { this._toast(e.message || String(e)); }
  }

  async _import() {
    const $ = this._el;
    const mode = 'auto';      // detected: OggStudio's marker, a .vib.funscript name, else stroke
    const inverted = $('invert').checked;
    try {
      const files = [...$('files').files];
      let script;
      if (files.length) {
        const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
        const first = parsed[0];
        if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
        if (!first.metadata || !first.metadata.title) first.metadata = { ...(first.metadata || {}), title: fileTitle(files[0].name) };
        script = normalise(first, fileKind(files[0].name, mode), inverted);
      } else if ($('paste').value.trim()) {
        script = normalise(await decodeText($('paste').value), mode, inverted);
      } else { this._toast('Paste a script or choose a file first'); return; }
      this._take = script;
      $('name').value = (script.metadata && script.metadata.title) || '';
      $('paste').value = ''; $('files').value = '';
      if (isStroke(script)) $('takemode').value = RUN_MODE_DEFAULT;
      this._toast(`Loaded ${fmt(duration(script))} ${isStroke(script) ? 'stroke' : 'vibration'} script. Play it now or save it.`);
      this._update();
    } catch (e) { this._toast('Could not import: ' + (e.message || e)); }
  }

  // A saved script named like the video (case, extension and punctuation
  // aside) is chosen for it: in the video's script list and the Library.
  _matchVideoScript() {
    const norm = (s) => String(s || '').toLowerCase().replace(/\.(funscript|json)$/, '').replace(/[^a-z0-9]+/g, '');
    const want = norm(this._vname);
    if (!want) return;
    const savedState = this._studio && this._studio.saved && this._hass && this._hass.states[this._studio.saved];
    const names = ((savedState && savedState.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
    const match = names.find((n) => norm(n) === want)
      || names.find((n) => { const k = norm(n); return k.length >= 4 && (k.startsWith(want) || want.startsWith(k)); });
    const sel = this._el('vsrc');
    if (!match) {
      // The last video's own script does not go with this one.
      if (this._vAutoScript && sel.value === this._vAutoScript) { sel.value = ''; this._loadVideoScript(); }
      this._vAutoScript = null;
      return;
    }
    this._fillVideoScripts();
    this._vAutoScript = match;
    if (sel.value !== match) { sel.value = match; this._loadVideoScript(); }
    if (this._simple) {
      this._libPick = null;
      this._hass.callService('select', 'select_option', { entity_id: this._studio.saved, option: match }).catch(() => {});
      if (!this._rp.playing) this._libPreview(match);
    }
    this._toast(`Script "${match}" goes with this video.`);
  }

  _fillVideoScripts() {
    const sel = this._el('vsrc');
    const savedState = this._studio && this._studio.saved && this._hass.states[this._studio.saved];
    const names = ((savedState && savedState.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
    const take = this._take ? `Current take (${isStroke(this._take) ? 'stroke' : 'vibration'}, ${fmt(duration(this._take))})` : null;
    const key = JSON.stringify([names, take]);
    if (sel.dataset.key === key) return;
    const current = sel.value;
    sel.replaceChildren(new Option('From a file on this device…', ''), ...(take ? [new Option(take, TAKE_SRC)] : []), ...names.map((n) => new Option(`Library: ${n}`, n)));
    sel.dataset.key = key;
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    else if (current === TAKE_SRC) { sel.value = ''; this._loadVideoScript(); }   // the take went (saved or discarded)
    this._el('vfilebox').hidden = sel.value !== '';
    // A new take while "Current take" is chosen: play the new one.
    if (sel.value === TAKE_SRC && this._vraw !== this._take) this._loadVideoScript();
  }

  // Streamed live levels: never call while the device is offline, never let
  // Home Assistant pop up an error per call (notifyOnError=false), and back
  // off after a failure so one problem gives one message.
  _sendLive(dev, levels, seconds) {
    if (!this._online(dev)) {
      this._toastOnce(`${dev.name} is not connected. Waiting for it to reconnect…`);
      return;
    }
    const now = performance.now();
    if (now < (this._liveBackoffUntil || 0)) return;
    if (this._liveProblem) { this._liveProblem = null; this._toast(''); }
    this._hass.callService('ogg', 'live', { entity_id: dev.stop, levels, seconds }, undefined, false)
      .catch((e) => {
        this._liveBackoffUntil = performance.now() + 3000;
        this._toastOnce(`Could not control ${dev.name}: ${e.message || e}. Retrying…`);
      });
  }

  _quietStop(dev) {
    if (!dev || !this._hass) return;
    this._hass.callService('ogg', 'stop_script', { entity_id: dev.stop }, undefined, false).catch(() => {});
  }

  _toastOnce(text) {
    if (this._liveProblem === text) return;
    this._liveProblem = text;
    this._toast(text);
  }

  _toast(text) { if (this._el) this._el('toast').textContent = text; }

  disconnectedCallback() {
    clearInterval(this._liveTimer); clearInterval(this._sampleTimer);
    this._stHalt();
    this._gpDetach();
    if (this._vsyncTimer) this._videoHalt();
    if (this._cast) this._castEnd(true);       // the video streams from here: stop the TV too
    if (this._vurl) { URL.revokeObjectURL(this._vurl); this._vurl = null; }
    if (this._rp && this._rp.playing) { this._plOff(); this._rpStop(); }
    this._auStop();
    this._ptStop();
    this._hbKeep(true);
    clearInterval(this._vsTimer); this._vsTimer = null;
    this._castUnprep();
    this._castUnlink();
    if (this._tap) { clearInterval(this._tapTimer); this._tap = null; }
    clearInterval(this._urecTimer); this._urecTimer = null;
    this._tgEnd();
    clearInterval(this._lockTimer); this._lockTimer = null;
    this._outStop();
    this._sessionClose();
  }
}
