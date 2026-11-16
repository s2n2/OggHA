// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// The Queue card (type: custom:ogg-queue-card), on its own:
// * a player: pick a script (built here, from his or hers queue, played,
//   saved), play it on the toys you choose, speed, loop, copy its code;
// * a builder: patterns, moods, saved scripts and pauses, each for a set
//   time, in an order you drag; save it to his or hers queue, to the
//   scripts, or copy its code;
// * his and hers queues and the played list, with Send: a link that opens
//   this dashboard with it ready to play.
// Ogg plays the script in Home Assistant (ogg.play_script), so it carries on
// with the screen off. Playing one also hands it to any Play card on the
// page as its current take.
import { decodeText, encodeCode, esc } from '../lib/core.js';
import { isStroke, runScript } from '../lib/convert.js';
import { limitMove, limitsFor } from '../lib/limits.js';
import { MOODS } from '../lib/moods.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM } from '../lib/patterns.js';
import { heatColor, heatmap } from '../lib/tools.js';
import { DURATIONS, MAX_STEP_MS, clock, composeScript, defaultName, duration, parseTime, stepsMs } from '../lib/compose.js';
import { oggPrivate } from '../lib/private.js';
import { makeCover } from '../lib/cover.js';
import { sampleAt } from '../lib/outputs.js';

export const QUEUE_TAG = 'ogg-queue-card';
const KEEP = 'ogg_queue_card';          // this browser's draft, devices and tab
const SPEEDS = ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'];
const LINK = 'ogg_queue';               // ?ogg_queue=<id>: open with it ready
const WHO = { his: 'His', hers: 'Hers' };

const STYLE = `
:host{display:block;--ink:#eef1ff;--muted:#93a0bf;--line:rgba(174,194,246,.14);--field:#16213a;--edge:#2e3c5c}
ha-card{display:block;overflow:hidden;border-radius:24px;border:1px solid rgba(174,194,246,.13);color:var(--ink);
  background:radial-gradient(circle at 110% -10%,rgba(255,120,180,.16),transparent 280px),radial-gradient(circle at -10% 0,rgba(105,100,240,.2),transparent 260px),linear-gradient(160deg,#141d33,#0d1426);
  font:14px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{padding:16px;display:flex;flex-direction:column;gap:12px}
.head{display:flex;align-items:center;gap:12px}
.brand{flex:0 0 44px;height:44px;border-radius:15px;display:grid;place-items:center;font-size:21px;background:linear-gradient(155deg,#ff8fc0,#8f7dff)}
.eyebrow{font-size:10px;font-weight:850;letter-spacing:.19em;color:#ffb3d9;text-transform:uppercase}
h2{margin:0;font-size:19px;letter-spacing:-.03em;font-weight:780}
h3{margin:0 0 8px;font-size:13px;font-weight:800;color:#d5dcf7;display:flex;align-items:center;gap:8px}
h3 .n{margin-left:auto;font-size:11px;color:var(--muted);font-weight:600}
.shead{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 2px;border:0;background:none;color:#eef1ff;text-align:left;border-radius:10px}
.shead .st{flex:1;font-size:14px;font-weight:780;letter-spacing:-.01em}
.shead .n{font-size:11px;color:var(--muted);font-weight:650}
.shead .chev{font-size:13px;color:#a8b8da;transition:transform .18s ease}
.fold.folded .chev{transform:rotate(-90deg)}
.fold.folded .sbody{display:none}
.sbody{display:flex;flex-direction:column;gap:10px}
section{border:1px solid var(--line);border-radius:18px;padding:12px;background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:10px}
select,input[type=text],textarea{width:100%;box-sizing:border-box;background:var(--field);color:var(--ink);border:1px solid var(--edge);border-radius:14px;padding:11px 12px;font:inherit;font-size:14px;font-weight:650}
textarea{min-height:64px;font-family:monospace;font-size:11px;font-weight:400}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>*{flex:1 1 0;min-width:0}
.prow{flex-wrap:nowrap}.prow select{flex:1 1 auto}.row>.ren{flex:0 0 auto;align-self:stretch;padding:0 14px;font-size:13.5px}
button{border:1px solid rgba(118,200,239,.3);background:#22385a;color:#c4f1ff;border-radius:14px;min-height:46px;padding:4px 8px;font:inherit;font-size:13.5px;line-height:1.15;font-weight:780;cursor:pointer}
button:disabled{opacity:.4;cursor:default}
button.stop{color:#ffbcc2;background:rgba(244,100,118,.09);border-color:rgba(239,115,134,.3)}
button.go{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
button.his{background:rgba(110,160,255,.14);border-color:rgba(120,170,255,.45);color:#bcd3ff}
button.hers{background:rgba(230,90,160,.14);border-color:rgba(255,130,190,.45);color:#ffc4e2}
button.small{min-height:36px;border-radius:11px;padding:0 10px;font-size:12px;flex:0 0 auto}
.bar{position:relative;height:16px;border-radius:8px;background:#18233d;overflow:hidden;cursor:pointer;touch-action:none}
.bar canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;opacity:.9}
.bar i{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.28);border-right:2px solid #fff}
.time{text-align:center;font-size:12.5px;color:#cfd7f3;font-variant-numeric:tabular-nums}
.sw{display:flex;align-items:center;gap:8px;flex:0 0 auto;font-weight:750;font-size:13px;color:#d5dcf7;cursor:pointer;user-select:none}
.sw input{appearance:none;-webkit-appearance:none;width:50px;height:30px;border-radius:16px;background:#1b2741;border:1px solid #364563;position:relative;margin:0;cursor:pointer}
.sw input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#c9cfe4;transition:transform .15s}
.sw input:checked{background:linear-gradient(110deg,#31c6b8,#54d4bc);border-color:transparent}
.sw input:checked::after{transform:translateX(20px);background:#fff}
.devs{display:flex;gap:6px;flex-wrap:wrap}
.dev{flex:0 0 auto;min-height:36px;border-radius:20px;padding:0 12px;font-size:12px;background:transparent;border-color:var(--edge);color:var(--muted)}
.dev.on{background:#23405f;border-color:#67e0c8;color:#e9fffb}
.dev.off{opacity:.55}
.dev{display:inline-flex;align-items:center;gap:6px}
.lv{display:inline-flex;flex-direction:column;justify-content:center;gap:2px;width:38px;height:14px}
.lv i{display:block;height:4px;border-radius:2px;background:#22304d;overflow:hidden;position:relative}
.lv i b{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2fbfa9,#8ff0dc);transition:width .2s linear}
.lv.lin i b{width:8px!important;left:var(--p,0%);margin-left:-4px;border-radius:2px;background:#ffb3d9;transition:left .25s linear}
.lv.lin i{height:6px}
.pct{font-size:11px;font-weight:800;color:#e9fffb;font-variant-numeric:tabular-nums;min-width:28px;text-align:right}
.dev.off .lv,.dev.off .pct{display:none}
.dev.simdev{cursor:default;border-style:dashed;border-color:rgba(255,190,90,.5);background:rgba(255,190,90,.07);color:#ffe2b0}
.src{font-size:11.5px;color:var(--muted);align-self:center;flex:1 1 100%}
.sim{flex:1 1 100%;font-size:12px;font-weight:700;color:#ffcf8a;background:rgba(255,190,90,.08);border:1px solid rgba(255,190,90,.3);border-radius:12px;padding:7px 10px}
.chip{display:inline-block;font-size:10px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;border-radius:8px;padding:1px 6px;margin-left:5px;border:1px solid}
.chip.his{color:#bcd3ff;border-color:rgba(120,170,255,.45)}
.chip.hers{color:#ffc4e2;border-color:rgba(255,130,190,.45)}
.seg{display:flex;border:1px solid var(--edge);border-radius:14px;overflow:hidden}
.seg button{flex:1;border:0;border-radius:0;background:transparent;color:var(--muted);min-height:40px}
.seg button.on{background:#23405f;color:#e9fffb}
.steps{display:flex;flex-direction:column;gap:12px}
.step{--k:#67e0c8;--kt:rgba(103,224,200,.12);border:1px solid var(--edge);border-left:5px solid var(--k);border-radius:16px;
  background:linear-gradient(100deg,var(--kt),#111a2f 55%);box-shadow:0 3px 12px rgba(0,0,0,.28);padding:9px 9px 9px 8px;display:flex;flex-direction:column;gap:6px;transition:transform .12s}
.step.k-pattern{--k:#31c6b8;--kt:rgba(49,198,184,.16)}
.step.k-mood{--k:#ff8fc0;--kt:rgba(255,143,192,.15)}
.step.k-script{--k:#7aa8ff;--kt:rgba(122,168,255,.15)}
.step.k-pause{--k:#8b97b3;--kt:rgba(139,151,179,.12)}
.step.drag{opacity:.85;box-shadow:0 10px 30px rgba(0,0,0,.45);border-color:#67e0c8;transition:none;position:relative;z-index:2}
.step .top{display:flex;gap:6px;align-items:center}
.step .top select{padding:8px 10px;border-radius:11px;font-size:13px}
.step .what{flex:1 1 0;min-width:0}
.sl select{flex:1;padding:6px 10px;border-radius:10px;font-size:13px}
.kind{flex:0 0 auto;font-size:15px}
.handle{flex:0 0 34px;height:38px;display:grid;place-items:center;border-radius:10px;color:var(--muted);cursor:grab;touch-action:none;font-size:18px;user-select:none}
.handle:active{cursor:grabbing}
.num{flex:0 0 22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11.5px;font-weight:850;color:#0b1022;background:var(--k)}
.x{flex:0 0 34px;min-height:34px;padding:0;border-radius:10px;background:transparent;border-color:transparent;color:var(--muted);font-size:15px}
.sl{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted)}
.sl span{flex:0 0 58px}.sl b{flex:0 0 36px;text-align:right;color:#d5dcf7;font-variant-numeric:tabular-nums}
input[type=range]{flex:1;accent-color:#67e0c8;height:26px;margin:0}
.adds{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.adds button{min-height:40px;font-size:12px;padding:0 2px}
.total{display:flex;align-items:center;gap:10px;font-size:12.5px;color:#cfd7f3}
.total span{flex:0 0 auto;white-space:nowrap;font-weight:750}
.total canvas{flex:1 1 0;min-width:0;width:100%;height:10px;border-radius:5px;background:#18233d;image-rendering:pixelated}
.tabs{display:flex;gap:6px}
.tabs button{flex:1;min-height:38px;font-size:12.5px;background:transparent;border-color:var(--edge);color:var(--muted)}
.tabs button.on.his{background:rgba(110,160,255,.16);border-color:rgba(120,170,255,.6);color:#d9e6ff}
.tabs button.on.hers{background:rgba(230,90,160,.16);border-color:rgba(255,130,190,.6);color:#ffd9ec}
.tabs button.on.played{background:#23405f;border-color:#67e0c8;color:#e9fffb}
.list{display:flex;flex-direction:column;gap:6px}
.item{display:flex;align-items:center;gap:8px;border:1px solid var(--edge);border-radius:14px;padding:8px 8px 8px 12px;background:#121b31}
.item.cur{border-color:#67e0c8}
.item .info{flex:1;min-width:0}
.item .nm{font-weight:780;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .meta{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{font-size:12.5px;color:var(--muted);text-align:center;padding:10px}
.hint{font-size:11.5px;color:var(--muted)}
.gift{border:1px solid rgba(255,130,190,.45);background:linear-gradient(110deg,rgba(230,90,160,.16),rgba(143,125,255,.14));border-radius:16px;padding:10px 12px;display:flex;align-items:center;gap:10px}
.gift .info{flex:1;font-size:13px}
.toast{min-height:16px;font-size:12.5px;color:#ffcf8a}
ha-card.embedded{background:transparent;border:0;border-radius:0}
ha-card.embedded .wrap{padding:0}
ha-card.embedded .head{display:none}
[hidden]{display:none!important}
`;

const keepGet = () => { try { return JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch (_) { return {}; } };
const keepSet = (patch) => { try { localStorage.setItem(KEEP, JSON.stringify({ ...keepGet(), ...patch })); } catch (_) { /* private browsing */ } };
const uid = () => Math.random().toString(36).slice(2, 9);
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};
const kindOf = (s) => (isStroke(s) ? 'stroke' : 'vibration');

function paint(canvas, script, buckets) {
  canvas.width = buckets; canvas.height = 1;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, buckets, 1);
  if (!script) return;
  heatmap(script, buckets).forEach((v, i) => { ctx.fillStyle = heatColor(v); ctx.fillRect(i, 0, 1, 1); });
}

const KIND = { pattern: ['〰️', 'Pattern'], mood: ['🎭', 'Mood'], script: ['📜', 'Saved script'], pause: ['⏸', 'Pause'] };

const NEW_STEP = {
  pattern: () => ({ type: 'pattern', key: 'wave', ms: 60000, level: 70, speed: 50 }),
  mood: () => ({ type: 'mood', key: Object.keys(MOODS)[0], ms: 120000, level: 100, seed: 1 + Math.floor(Math.random() * 1e6) }),
  script: (names) => ({ type: 'script', name: names[0] || '', ms: 60000 }),
  pause: () => ({ type: 'pause', ms: 15000 }),
};

export class OggQueueCard extends HTMLElement {
  setConfig(config) { this._config = config || {}; }
  getCardSize() { return 12; }
  static getStubConfig() { return {}; }

  constructor() {
    super();
    const kept = keepGet();
    this._steps = Array.isArray(kept.steps) ? kept.steps.filter((s) => s && NEW_STEP[s.type]).map((s) => ({ ...s, id: uid() })) : [];
    if (!this._steps.length) this._steps = [{ ...NEW_STEP.pattern(), id: uid() }, { ...NEW_STEP.mood(), id: uid() }];
    this._stroke = Boolean(kept.stroke);
    this._tab = ['his', 'hers', 'played'].includes(kept.tab) ? kept.tab : 'his';
    this._pick = Array.isArray(kept.devices) ? new Set(kept.devices) : null;   // stop entities; null = by his/hers
    this._devices = [];
    this._cur = null;          // what the player has: {src, id, name, script, for}
    this._play = null;         // {t0, from, speed, loop, devs}
    this._from = 0;            // ms: where Play starts
    this._speed = '1x';
    this._loop = false;
    this._scripts = new Map(); // saved scripts fetched for the builder
  }

  set hass(hass) {
    this._rawHass = hass;
    oggPrivate().attach(hass, this);
    this._hass = oggPrivate().wrap(hass);
    if (!this.shadowRoot) this._build();
    if (this._config && this._config.embedded) this.shadowRoot.querySelector('ha-card').classList.add('embedded');
    if (!this._ocov) this._ocov = makeCover(this.shadowRoot.querySelector('ha-card'));
    this._ocov.update(this._hass);
    if (!this._regLoaded) { this._regLoaded = true; this._loadRegistry(); }
    this._refresh();
  }

  _oggPrivateChanged() { if (this._rawHass) this.hass = this._rawHass; }

  connectedCallback() { if (!this.shadowRoot) this._build(); }
  disconnectedCallback() { clearInterval(this._tick); this._tick = null; }

  // ------------------------------------------------------------ Home Assistant
  get _saved() { return this._studio && this._hass && this._hass.states[this._studio]; }
  get _queues() { const s = this._saved; return (s && s.attributes.queues) || {}; }
  get _names() {
    const s = this._saved;
    return ((s && s.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
  }

  async _loadRegistry() {
    try {
      const [entities, devices] = await Promise.all([
        this._hass.callWS({ type: 'config/entity_registry/list' }),
        this._hass.callWS({ type: 'config/device_registry/list' }),
      ]);
      const names = new Map(devices.map((d) => [d.id, d.name_by_user || d.name || 'Toy']));
      const by = new Map();
      for (const e of entities) {
        if (e.disabled_by || e.platform !== 'ogg') continue;
        const u = String(e.unique_id || '');
        if (u.endsWith(':studio_saved_script')) { this._studio = e.entity_id; continue; }
        if (!e.device_id || u.split(':').length < 3 || /:studio_/.test(u)) continue;
        const d = by.get(e.device_id) || { id: e.device_id, name: names.get(e.device_id) };
        if (u.endsWith(':stop')) d.stop = e.entity_id;
        if (u.endsWith(':owner')) d.owner = e.entity_id;
        if (u.endsWith(':connected')) d.connected = e.entity_id;
        if (u.endsWith(':motor_level_1')) d.dual = true;
        if (u.endsWith(':linear_0')) { d.linear = true; d.position = e.entity_id; }
        if (u.endsWith(':status')) d.status = e.entity_id;
        if (u.endsWith(':intensity') || u.endsWith(':motor_level_0')) d.vibe = true;
        by.set(e.device_id, d);
      }
      this._devices = [...by.values()].filter((d) => d.stop).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      this._toast('Could not read the toys: ' + (e.message || e));
    }
    this._refresh();
  }

  // His and hers as people (Ogg's options: Configure > Studio), or just his/hers.
  get _people() { const s = this._saved; return (s && s.attributes.settings && s.attributes.settings.people) || {}; }
  get _me() { return (this._rawHass && this._rawHass.user && this._rawHass.user.id) || ''; }
  _person(who) { const p = this._people[who]; return p && p.name ? p.name : ''; }
  // "Sam's queue" / "hers queue"; "Sam" / "Hers".
  _queueOf(who) { const n = this._person(who); return n ? `${n}'s queue` : `${WHO[who].toLowerCase()} queue`; }
  _label(who) { return this._person(who) || WHO[who]; }
  _isMe(who) { const p = this._people[who]; return Boolean(p && p.id && p.id === this._me); }

  _whose(d) { const s = d.owner && this._hass.states[d.owner]; return s && WHO[s.state] ? s.state : ''; }
  _online(d) { const s = d.connected && this._hass.states[d.connected]; return !s || s.state === 'on'; }

  // The toys Play uses (connected ones only): the ones picked here, else his
  // (or hers) for a script from his (or hers) queue, else every connected
  // toy. None: Play simulates (the player runs, nothing is sent).
  // Embedded in the Easy card, it plays on the toys picked there (stop entities).
  set externalTargets(stops) { this._external = Array.isArray(stops) ? stops : null; if (this._$) this._showDevs(); }

  _targets() {
    if (this._external) return this._devices.filter((d) => this._online(d) && this._external.includes(d.stop));
    const online = this._devices.filter((d) => this._online(d));
    if (this._pick) return online.filter((d) => this._pick.has(d.stop));
    const who = this._cur && this._cur.for;
    const theirs = who ? online.filter((d) => this._whose(d) === who) : [];
    return theirs.length ? theirs : online;
  }

  // ------------------------------------------------------------ layout
  _build() {
    this.attachShadow({ mode: 'open' });
    const speeds = SPEEDS.map((s) => `<option${s === '1x' ? ' selected' : ''}>${s}</option>`).join('');
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="wrap">
      <div class="head"><div class="brand">💌</div><div><div class="eyebrow">Ogg</div><h2 id="title">Queue</h2></div></div>
      <div class="gift" id="gift" hidden><div class="info" id="giftinfo"></div><button class="go small" id="giftplay" type="button">▶ Play</button></div>
      <section>
        <div class="row prow"><select id="pick" aria-label="Script to play"></select><button type="button" id="ren" class="ren" aria-label="Rename this script" title="Rename">✏️ Rename</button></div>
        <div class="bar" id="bar"><canvas id="heat"></canvas><i id="cursor"></i></div>
        <div class="time" id="time">Nothing loaded</div>
        <div class="row"><select id="speed" aria-label="Speed">${speeds}</select><label class="sw"><input type="checkbox" id="loop"> Loop</label></div>
        <div class="devs" id="devs"></div>
        <div class="row"><button id="play" type="button">▶ Play</button><button id="stop" class="stop" type="button">■ Stop</button><button id="code" type="button">Copy code</button><button id="del" type="button">Delete</button></div>
      </section>
      <section class="fold" id="qsec">
        <button type="button" class="shead" id="qhead" aria-expanded="true" aria-controls="qbody"><span class="st">📋 His &amp; hers queues</span><span class="n" id="qcount"></span><span class="chev" aria-hidden="true">▾</span></button>
        <div class="sbody" id="qbody">
        <div class="tabs"><button type="button" class="his" data-tab="his"></button><button type="button" class="hers" data-tab="hers"></button><button type="button" class="played" data-tab="played"></button></div>
        <div class="list" id="list"></div>
        <div class="hint">▶ loads it above and plays it. Send copies a link: it opens this dashboard with that one ready to play.</div>
        </div>
      </section>
      <section class="fold" id="msec">
        <button type="button" class="shead" id="mhead" aria-expanded="true" aria-controls="mbody"><span class="st">🎨 Make a queue</span><span class="n" id="count"></span><span class="chev" aria-hidden="true">▾</span></button>
        <div class="sbody" id="mbody">
        <div class="seg" role="radiogroup" aria-label="For"><button type="button" id="forvibe">〰️ For vibrators</button><button type="button" id="forstroke">↕️ For a stroker</button></div>
        <div class="steps" id="steps"></div>
        <div class="adds"><button type="button" data-add="pattern">+ Pattern</button><button type="button" data-add="mood">+ Mood</button><button type="button" data-add="script">+ Script</button><button type="button" data-add="pause">+ Pause</button></div>
        <div class="total"><span id="total"></span><canvas id="preview"></canvas></div>
        <input type="text" id="name" maxlength="60" aria-label="Name" autocomplete="off">
        <div class="row"><button type="button" class="his" id="tohis">♂ Add to his queue</button><button type="button" class="hers" id="tohers">♀ Add to hers queue</button></div>
        <div class="row"><button type="button" id="try">▶ Try it</button><button type="button" id="toscripts">Save to scripts</button><button type="button" id="bcode">Copy code</button></div>
        <div class="row"><button type="button" class="small" id="opencode">Open a code…</button><button type="button" class="small" id="clear">Start again</button><span></span></div>
        <div id="codebox" hidden><textarea id="codein" placeholder="Paste a code (ogg1:…) or funscript"></textarea><div class="row" style="margin-top:6px"><button type="button" class="small" id="codego">Load it</button><span></span></div></div>
        </div>
      </section>
      <div class="toast" id="toast" role="status"></div>
    </div></ha-card>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._$ = $;
    const fold = (key, sec, head, folded, save) => {
      $(sec).classList.toggle('folded', folded);
      $(head).setAttribute('aria-expanded', String(!folded));
      if (save) keepSet({ fold: { ...(keepGet().fold || {}), [key]: folded } });
    };
    const kept = keepGet().fold || {};
    fold('q', 'qsec', 'qhead', Boolean(kept.q));
    fold('m', 'msec', 'mhead', Boolean(kept.m));
    $('qhead').addEventListener('click', () => fold('q', 'qsec', 'qhead', !$('qsec').classList.contains('folded'), true));
    $('mhead').addEventListener('click', () => fold('m', 'msec', 'mhead', !$('msec').classList.contains('folded'), true));
    $('pick').addEventListener('change', () => this._choose($('pick').value));
    $('speed').addEventListener('change', () => { this._speed = $('speed').value; if (this._play) this._start(this._now()); });
    $('loop').addEventListener('change', () => { this._loop = $('loop').checked; if (this._play) this._start(this._now()); });
    $('play').addEventListener('click', () => this._start(this._from));
    $('stop').addEventListener('click', () => this._halt());
    $('code').addEventListener('click', () => this._cur && this._copyCode(this._cur.script));
    $('del').addEventListener('click', () => this._delete());
    $('ren').addEventListener('click', () => this._rename());
    $('devs').addEventListener('click', (e) => this._toggleDev(e.target.closest('button')));
    this._bindBar($('bar'));
    $('forvibe').addEventListener('click', () => this._setStroke(false));
    $('forstroke').addEventListener('click', () => this._setStroke(true));
    this.shadowRoot.querySelector('.adds').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-add]');
      if (b) this._addStep(b.dataset.add);
    });
    this._bindSteps($('steps'));
    $('tohis').addEventListener('click', () => this._toQueue('his'));
    $('tohers').addEventListener('click', () => this._toQueue('hers'));
    $('try').addEventListener('click', () => this._try());
    $('toscripts').addEventListener('click', () => this._toScripts());
    $('bcode').addEventListener('click', async () => { const s = await this._compose(); if (s) this._copyCode(s); });
    $('opencode').addEventListener('click', () => { $('codebox').hidden = !$('codebox').hidden; });
    $('codego').addEventListener('click', () => this._openCode());
    $('clear').addEventListener('click', () => {
      if (!confirm('Clear the steps and start again?')) return;
      this._steps = [{ ...NEW_STEP.pattern(), id: uid() }];
      this._stepsChanged(true);
    });
    this.shadowRoot.querySelector('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      this._tab = b.dataset.tab; keepSet({ tab: this._tab }); this._showList();
    });
    $('list').addEventListener('click', (e) => this._listAction(e.target.closest('button')));
    $('giftplay').addEventListener('click', () => { const id = this._gift; $('gift').hidden = true; if (id) this._loadQueued(id, true); });
    this._showStroke();
    this._showSteps();
  }

  _toast(text) {
    const t = this._$ && this._$('toast');
    if (!t) return;
    t.textContent = text;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.textContent = ''; }, 6000);
  }

  // ------------------------------------------------------------ follow HA
  _refresh() {
    if (!this._$ || !this._hass) return;
    const $ = this._$;
    if (this._config && this._config.title) $('title').textContent = this._config.title;
    const people = this._people;
    $('tohis').textContent = `♂ Add to ${this._queueOf('his')}`;
    $('tohers').textContent = `♀ Add to ${this._queueOf('hers')}`;
    if (!this._tabSet) {
      // Open on your own queue once Ogg knows who you are (his or hers).
      const mine = this._isMe('his') ? 'his' : this._isMe('hers') ? 'hers' : null;
      if (mine) { this._tabSet = true; if (!this._gift) this._tab = mine; this._key = null; }
    }
    const key = JSON.stringify([this._names, this._queues, people]);
    if (key !== this._key) {
      this._key = key;
      this._fillPick();
      this._showList();
      this._showSteps(true);
      this._link();
    }
    this._showDevs();
    this._showPlayer();
  }

  _fillPick() {
    const $ = this._$;
    const q = Object.entries(this._queues);
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    const group = (label, rows) => (rows.length ? `<optgroup label="${esc(label)}">${rows.join('')}</optgroup>` : '');
    const qrow = ([id, r]) => opt(`q:${id}`, `${r.name} (${clock(r.duration_ms)})`);
    const html = [opt('', 'Choose a script to play…'),
      this._cur && ['build', 'code'].includes(this._cur.src) ? opt('cur', `${this._cur.name} (${clock(duration(this._cur.script))})`) : '',
      group('His queue', q.filter(([, r]) => r.for === 'his' && !r.played).map(qrow)),
      group('Hers queue', q.filter(([, r]) => r.for === 'hers' && !r.played).map(qrow)),
      group('Played', q.filter(([, r]) => r.played).map(qrow)),
      group('Saved scripts', this._names.map((n) => opt(`s:${n}`, n)))].join('');
    if ($('pick').dataset.html !== html) { $('pick').innerHTML = html; $('pick').dataset.html = html; }
    $('pick').value = this._curValue();
  }

  _curValue() {
    const c = this._cur;
    if (!c) return '';
    return c.src === 'queue' ? `q:${c.id}` : c.src === 'saved' ? `s:${c.name}` : 'cur';
  }

  _showDevs() {
    const $ = this._$;
    if (this._external) {
      const n = this._targets().length;
      const html = n ? `<span class="src">Plays on the ${n === 1 ? 'toy' : `${n} toys`} picked above.</span>`
        : '<span class="sim">⚠️ No toy picked above: Play simulates (nothing is sent to a toy).</span>';
      if ($('devs').dataset.html !== html) { $('devs').innerHTML = html; $('devs').dataset.html = html; }
      return;
    }
    const targets = new Set(this._targets().map((d) => d.stop));
    const online = this._devices.filter((d) => this._online(d));
    const note = !targets.size ? '<span class="sim">⚠️ No toy selected: Play simulates (the player runs, nothing is sent to a toy).</span>'
      : `<span class="src">${this._pick ? 'Plays on the toys you picked.' : 'Plays on his toys for his queue, hers for hers, else every connected toy. Tap to choose.'}</span>`;
    const c = this._cur;
    const simLin = Boolean(c && isStroke(c.script)), simDual = Boolean(c && !simLin && c.script.channels && c.script.channels.V1);
    const sim = targets.size ? '' : `<span class="dev on simdev" role="img" aria-label="Simulated toy">🧪 Simulated<span class="lv${simLin ? ' lin' : ''}" data-lv="__sim" aria-hidden="true"><i><b></b></i>${simDual ? '<i><b></b></i>' : ''}</span><span class="pct" data-pct="__sim"></span></span>`;
    const html = online.length ? online.map((d) => {
      const w = this._whose(d);
      const lin = d.linear && !d.vibe;
      return `<button type="button" class="dev${targets.has(d.stop) ? ' on' : ''}${this._online(d) ? '' : ' off'}" data-stop="${esc(d.stop)}" aria-pressed="${targets.has(d.stop)}">${esc(d.name)}${w ? `<span class="chip ${w}">${WHO[w]}</span>` : ''}`
        + `<span class="lv${lin ? ' lin' : ''}" data-lv="${esc(d.stop)}" aria-hidden="true"><i><b></b></i>${!lin && d.dual ? '<i><b></b></i>' : ''}</span><span class="pct" data-pct="${esc(d.stop)}"></span></button>`;
    }).join('') + (this._pick ? '<button type="button" class="dev" data-auto="1">Auto</button>' : '') + sim + note
      : sim + '<span class="sim">⚠️ No toys connected: Play simulates (the player runs, nothing is sent to a toy).</span>';
    if ($('devs').dataset.html !== html) { $('devs').innerHTML = html; $('devs').dataset.html = html; }
    this._showLevels();
  }

  // Live: each connected toy's level (vibration) or position (stroker).
  _showLevels() {
    const root = this.shadowRoot;
    this._showSim();
    for (const d of this._devices) {
      const lv = root.querySelector(`[data-lv="${CSS.escape(d.stop)}"]`);
      const pct = root.querySelector(`[data-pct="${CSS.escape(d.stop)}"]`);
      if (!lv || !pct) continue;
      if (d.linear && !d.vibe) {
        const s = d.position && this._hass.states[d.position];
        const v = s ? Math.max(0, Math.min(100, Number(s.state) || 0)) : 0;
        lv.style.setProperty('--p', `${v}%`);
        pct.textContent = `↕${Math.round(v)}`;
        continue;
      }
      const st = d.status && this._hass.states[d.status];
      const out = (st && Array.isArray(st.attributes.output) ? st.attributes.output : []).map((x) => Math.max(0, Math.min(100, Number(x) || 0)));
      const bars = lv.querySelectorAll('b');
      bars.forEach((b, i) => { b.style.width = `${out[i] ?? out[0] ?? 0}%`; });
      pct.textContent = `${Math.round(Math.max(0, ...out))}%`;
    }
  }

  // The simulated toy follows the script as it plays (as a toy would).
  _showSim() {
    const root = this.shadowRoot;
    const lv = root.querySelector('[data-lv="__sim"]'), pct = root.querySelector('[data-pct="__sim"]');
    if (!lv || !pct) return;
    const c = this._cur, p = this._play;
    const t = this._now();
    const at = (acts) => (p && c ? Math.max(0, Math.min(100, sampleAt(acts, t))) : 0);
    if (c && isStroke(c.script)) {
      const v = c ? Math.max(0, Math.min(100, sampleAt(c.script.actions, t))) : 0;
      lv.style.setProperty('--p', `${v}%`);
      pct.textContent = `↕${Math.round(v)}`;
      return;
    }
    const levels = c ? [at(c.script.actions), ...(c.script.channels && c.script.channels.V1 ? [at(c.script.channels.V1.actions)] : [])] : [0];
    lv.querySelectorAll('b').forEach((b, i) => { b.style.width = `${levels[i] ?? levels[0]}%`; });
    pct.textContent = `${Math.round(Math.max(...levels))}%`;
  }

  _toggleDev(b) {
    if (!b) return;
    if (b.dataset.auto) { this._pick = null; keepSet({ devices: null }); this._showDevs(); return; }
    const stop = b.dataset.stop;
    const pick = this._pick || new Set(this._targets().map((d) => d.stop));
    if (pick.has(stop)) pick.delete(stop); else pick.add(stop);
    this._pick = pick;
    keepSet({ devices: [...pick] });
    this._showDevs();
  }

  // ------------------------------------------------------------ the player
  async _choose(value) {
    if (!value || value === 'cur') return;
    if (value.startsWith('q:')) { await this._loadQueued(value.slice(2), false); return; }
    const name = value.slice(2);
    try {
      const script = await this._getSaved(name);
      this._load({ src: 'saved', name, script });
    } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); }
  }

  async _getSaved(name) {
    const res = await this._hass.callWS({ type: 'call_service', domain: 'ogg', service: 'studio_get_script', service_data: { name }, return_response: true });
    return res.response.script;
  }

  async _loadQueued(id, andPlay) {
    const r = this._queues[id];
    if (!r) { this._toast('That one is no longer in the queue.'); return; }
    try {
      const res = await this._hass.callWS({ type: 'call_service', domain: 'ogg', service: 'studio_queue_get', service_data: { id }, return_response: true });
      this._load({ src: 'queue', id, name: r.name, for: r.for, script: res.response.script });
      if (andPlay) this._start(0);
    } catch (e) { this._toast('Could not load it: ' + (e.message || e)); }
  }

  // It becomes what the player has (and any Play card's current take).
  _load(cur) {
    if (this._play) this._halt(true);
    this._cur = cur;
    this._from = 0;
    paint(this._$('heat'), cur.script, 240);
    this._fillPick();
    this._showList();
    this._showDevs();
    this._showPlayer();
    window.dispatchEvent(new CustomEvent('ogg-queue-load', { detail: { script: cur.script, name: cur.name } }));
  }

  _now() {
    const p = this._play;
    if (!p) return this._from;
    const len = duration(p.script);
    const t = p.from + (Date.now() - p.t0) * p.factor;
    return p.loop ? t % Math.max(1, len) : Math.min(len, t);
  }

  _showPlayer() {
    const $ = this._$;
    const c = this._cur;
    const len = c ? duration(c.script) : 0;
    const t = c ? this._now() : 0;
    $('cursor').style.width = len ? `${(100 * t / len).toFixed(2)}%` : '0';
    $('time').textContent = c ? `${clock(t)} / ${clock(len)} · ${kindOf(c.script)} script${c.for ? ` · ${this._queueOf(c.for)}` : ''}` : 'Choose one above, try what you are making, or play one from a queue.';
    $('play').disabled = !c;
    $('code').disabled = !c;
    $('del').disabled = !c || c.src === 'code';
    $('ren').disabled = !c;
    $('play').textContent = this._play ? '↻ Restart' : '▶ Play';
    this._showSim();
    if (this._play && !this._play.loop && t >= len) this._ended();
  }

  _bindBar(bar) {
    const seek = (e) => {
      if (!this._cur) return;
      const r = bar.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(this._cur.script);
      if (this._play) this._start(t); else { this._from = t; this._showPlayer(); }
    };
    bar.addEventListener('pointerdown', seek);
  }

  // The script for one toy, inside its limits, from `from` ms.
  _forDevice(d, script) {
    const lim = limitsFor(this._saved && this._saved.attributes.limits, d.stop);
    if (d.linear && !d.vibe) {
      // A stroker: positions, inside its range and top speed.
      let prev = null;
      const actions = script.actions.map((a, i) => {
        const dur = i ? a.at - script.actions[i - 1].at : 500;
        const m = limitMove(lim, { goal: a.pos, dur }, prev);
        prev = m.goal;
        return { at: a.at, pos: Math.round(m.goal) };
      });
      return { script: { actions }, output: 'linear' };
    }
    const v = isStroke(script) ? runScript(script, 'speed') : script;
    const scale = (acts) => acts.map((a) => ({ at: a.at, pos: Math.round(a.pos * lim.max / 100) }));
    const out = { actions: scale(v.actions) };
    if (d.dual && v.channels && v.channels.V1) out.channels = { V1: { actions: scale(v.channels.V1.actions) } };
    return { script: out, output: 'vibrate' };
  }

  async _start(from) {
    const c = this._cur;
    if (!c || !this._hass) return;
    const devs = this._targets();
    const len = duration(c.script);
    from = from >= len - 100 ? 0 : Math.max(0, Math.round(from));
    const factor = parseFloat(this._speed) || 1;
    const loop = this._loop;
    // From the middle: Home Assistant starts there and (looping) goes round
    // from the beginning, so it carries on with this phone off.
    const calls = devs.map((d) => {
      const { script: s, output } = this._forDevice(d, c.script);
      return this._hass.callService('ogg', 'play_script', {
        entity_id: d.stop, script: s, output, speed: factor, loop,
        ...(from > 0 ? { start_ms: from } : {}),
        ...(loop ? { max_seconds: 21600 } : {}),
      });
    });
    this._play = { t0: Date.now(), from, factor, loop, script: c.script, devs };
    clearInterval(this._tick);
    this._tick = setInterval(() => this._showPlayer(), devs.length ? 250 : 100);
    this._showPlayer();
    try {
      await Promise.all(calls);
      if (c.src === 'queue') this._hass.callService('ogg', 'studio_queue_played', { id: c.id }).catch(() => {});
      this._toast(devs.length ? `Playing "${c.name}" on ${devs.map((d) => d.name).join(', ')}.` : `Simulating "${c.name}": no toy is selected, so nothing is sent.`);
    } catch (e) {
      this._toast('Could not play: ' + (e.message || e));
      this._halt(true);
    }
  }

  _ended() {
    const p = this._play;
    this._play = null;
    this._from = 0;
    clearInterval(this._tick); this._tick = null;
    this._showPlayer();
  }

  _halt(quiet) {
    const p = this._play;
    this._from = p ? this._now() : this._from;
    this._play = null;
    clearInterval(this._tick); this._tick = null;
    const devs = p ? p.devs : this._targets();
    for (const d of devs) this._hass.callService('ogg', 'stop_script', { entity_id: d.stop }).catch(() => {});
    if (!quiet) this._toast('Stopped.');
    this._showPlayer();
  }

  // Saved scripts and queue items are renamed in Home Assistant; one being
  // built (or opened from code) just takes the new name until it is saved.
  async _rename() {
    const c = this._cur;
    if (!c) { this._toast('Choose a script first.'); return; }
    const next = (window.prompt('New name for this script:', c.name) || '').trim();
    if (!next || next === c.name) return;
    try {
      if (c.src === 'queue') await this._hass.callService('ogg', 'studio_queue_rename', { id: c.id, name: next });
      else if (c.src === 'saved') await this._hass.callService('ogg', 'studio_rename', { name: c.name, new_name: next });
      else if (c.script) c.script = { ...c.script, metadata: { ...(c.script.metadata || {}), title: next } };
      c.name = next;
      this._fillPick(); this._showPlayer();
      this._toast(`Renamed to "${next}".`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  async _delete() {
    const c = this._cur;
    if (!c) return;
    if (c.src === 'build') { this._cur = null; this._fillPick(); this._showPlayer(); paint(this._$('heat'), null, 240); return; }
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      if (c.src === 'queue') await this._hass.callService('ogg', 'studio_queue_delete', { id: c.id });
      else await this._hass.callService('ogg', 'studio_delete', { name: c.name });
      if (this._play) this._halt(true);
      this._cur = null;
      paint(this._$('heat'), null, 240);
      this._toast(`Deleted "${c.name}".`);
      this._fillPick(); this._showPlayer();
    } catch (e) { this._toast(e.message || String(e)); }
  }

  // ------------------------------------------------------------ copying
  async _copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      this._toast(done);
      return;
    } catch (_) { /* not a secure page: copy by hand */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    this.shadowRoot.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    if (ok) this._toast(done); else window.prompt('Copy this:', text);
  }

  async _copyCode(script) {
    try { const code = await encodeCode(script); await this._copyText(code, `Code copied (${code.length} characters). Paste it into Open a code, or the Play card's Import.`); }
    catch (e) { this._toast(e.message || String(e)); }
  }

  _linkFor(id) {
    const u = new URL(window.location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set(LINK, id);
    return u.toString();
  }

  // Who sent it to whom, as the person looking sees it.
  _giftLine(r) {
    const me = this._me;
    const sender = r.by ? `<b>${esc(r.by)}</b>` : 'Someone';
    const fromMe = Boolean(me && r.by_id && r.by_id === me);
    const toMe = this._isMe(r.for);
    const them = this._person(r.for) ? `<b>${esc(this._person(r.for))}</b>` : `${WHO[r.for].toLowerCase()} queue`;
    if (fromMe && toMe) return 'You saved for yourself:';
    if (fromMe) return `You sent ${them}`;
    if (toMe) return `${sender} sent you`;
    if (this._person(r.for)) return `${sender} sent ${them}`;
    return r.by ? `${sender} sent` : 'For you:';
  }

  // Opened from a Send link: offer it at the top.
  _link() {
    if (window.__oggQueueLink === undefined) {
      try { window.__oggQueueLink = new URLSearchParams(window.location.search).get(LINK) || null; } catch (_) { window.__oggQueueLink = null; }
    }
    const id = window.__oggQueueLink;
    if (!id || this._gifted || !this._studio) return;
    const r = this._queues[id];
    const $ = this._$;
    this._gifted = true;
    if (!r) { this._toast('The script in that link is no longer in the queue.'); return; }
    this._gift = id;
    $('giftinfo').innerHTML = `💌 ${this._giftLine(r)} <b>${esc(r.name)}</b> · ${clock(r.duration_ms)}${r.played ? ' · played before' : ''}`;
    $('gift').hidden = false;
    this._tab = r.played ? 'played' : r.for;
    this._loadQueued(id, false);
    this.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ the builder
  _setStroke(on) { this._stroke = on; keepSet({ stroke: on }); this._showStroke(); this._stepsChanged(false); }
  _showStroke() {
    this._$('forvibe').classList.toggle('on', !this._stroke);
    this._$('forstroke').classList.toggle('on', this._stroke);
    this._$('forvibe').setAttribute('aria-checked', String(!this._stroke));
    this._$('forstroke').setAttribute('aria-checked', String(this._stroke));
  }

  _addStep(type) {
    const names = this._names;
    if (type === 'script' && !names.length) { this._toast('There are no saved scripts yet.'); return; }
    const last = [...this._steps].reverse().find((s) => s.type === type);
    const step = last && type !== 'mood' ? { ...last } : NEW_STEP[type](names);
    step.id = uid();
    this._steps.push(step);
    this._stepsChanged(true);
    const all = this._$('steps').children;
    if (all.length) all[all.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _stepsChanged(redraw) {
    keepSet({ steps: this._steps.map(({ id, ...s }) => s) });
    if (redraw) this._showSteps(true); else this._showTotal();
  }

  _whatOptions(step) {
    const o = (v, t) => `<option value="${esc(v)}"${v === (step.type === 'script' ? step.name : step.key) ? ' selected' : ''}>${esc(t)}</option>`;
    if (step.type === 'pattern') {
      return `<optgroup label="Patterns">${Object.entries(PATTERNS).map(([k, t]) => o(k, t)).join('')}${o(PATTERN_RANDOM, 'Random')}</optgroup>`
        + `<optgroup label="Two motors">${Object.entries(PATTERNS_DUAL).map(([k, t]) => o(k, t)).join('')}</optgroup>`;
    }
    if (step.type === 'mood') return Object.entries(MOODS).map(([k, m]) => o(k, `${m.icon} ${m.label}`)).join('');
    if (step.type === 'script') {
      const names = this._names.includes(step.name) || !step.name ? this._names : [step.name, ...this._names];
      return names.map((n) => o(n, n)).join('') || '<option value="">No saved scripts</option>';
    }
    return '<option>Nothing plays</option>';
  }

  _lenOptions(step) {
    const s = Math.round((step.ms || 60000) / 1000);
    const all = DURATIONS.includes(s) ? DURATIONS : [...DURATIONS, s].sort((a, b) => a - b);
    return all.map((v) => `<option value="${v}"${v === s ? ' selected' : ''}>${clock(v * 1000)}</option>`).join('')
      + '<option value="custom">Custom…</option>';
  }

  _showSteps(full) {
    const box = this._$('steps');
    if (full || box.children.length !== this._steps.length) {
      box.innerHTML = this._steps.map((s, i) => {
        const sliders = s.type === 'pattern'
          ? `<label class="sl"><span>Strength</span><input type="range" min="5" max="100" step="5" value="${s.level ?? 70}" data-f="level"><b>${s.level ?? 70}%</b></label>`
            + `<label class="sl"><span>Speed</span><input type="range" min="0" max="100" step="5" value="${s.speed ?? 50}" data-f="speed"><b>${s.speed ?? 50}%</b></label>`
          : s.type === 'mood'
            ? `<label class="sl"><span>Strength</span><input type="range" min="20" max="100" step="5" value="${s.level ?? 100}" data-f="level"><b>${s.level ?? 100}%</b></label>` : '';
        return `<div class="step k-${s.type}" data-id="${s.id}">
          <div class="top"><div class="handle" tabindex="0" role="button" aria-label="Drag to move step ${i + 1} (or use the arrow keys)">⠿</div><span class="num">${i + 1}</span>
            <span class="kind" title="${KIND[s.type][1]}">${KIND[s.type][0]}</span>
            <select class="what" data-f="what" aria-label="${KIND[s.type][1]}"${s.type === 'pause' ? ' disabled' : ''}>${this._whatOptions(s)}</select>
            <button type="button" class="x" data-act="x" aria-label="Remove step">✕</button></div>
          <label class="sl"><span>Time</span><select data-f="ms" aria-label="How long">${this._lenOptions(s)}</select></label>${sliders}</div>`;
      }).join('') || '<div class="empty">Add a pattern, a mood, a script or a pause.</div>';
    }
    this._showTotal();
  }

  _showTotal() {
    const ms = stepsMs(this._steps);
    this._$('count').textContent = `${this._steps.length} step${this._steps.length === 1 ? '' : 's'}`;
    this._$('total').textContent = `Total ${clock(ms)}`;
    this._$('name').placeholder = `Name (default: ${defaultName(ms)})`;
    clearTimeout(this._prevT);
    this._prevT = setTimeout(async () => {
      const s = await this._compose(true);
      paint(this._$('preview'), s, 120);
    }, 350);
  }

  _bindSteps(box) {
    const find = (el) => { const row = el.closest('.step'); return row ? this._steps.findIndex((s) => s.id === row.dataset.id) : -1; };
    box.addEventListener('input', (e) => {
      const i = find(e.target), f = e.target.dataset.f;
      if (i < 0 || (f !== 'level' && f !== 'speed')) return;
      this._steps[i][f] = Number(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value}%`;
      this._stepsChanged(false);
    });
    box.addEventListener('change', (e) => {
      const i = find(e.target), f = e.target.dataset.f;
      if (i < 0) return;
      const step = this._steps[i];
      if (f === 'what') { if (step.type === 'script') step.name = e.target.value; else step.key = e.target.value; }
      if (f === 'ms' && e.target.value === 'custom') {
        const typed = window.prompt('How long? For example 7, 45s, 1:30 or 2m', clock(step.ms || 60000));
        const sec = typed === null ? null : parseTime(typed);
        if (typed !== null && (sec === null || sec < 1 || sec * 1000 > MAX_STEP_MS)) this._toast('Type a time from 1 second to an hour, like 7, 45s, 1:30 or 2m.');
        if (sec !== null && sec >= 1 && sec * 1000 <= MAX_STEP_MS) step.ms = Math.round(sec) * 1000;
        this._stepsChanged(true);
        return;
      }
      if (f === 'ms') step.ms = Number(e.target.value) * 1000;
      this._stepsChanged(false);
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act="x"]');
      if (!b) return;
      const i = find(b);
      if (i >= 0) { this._steps.splice(i, 1); this._stepsChanged(true); }
    });
    // Keyboard: arrows move the step.
    box.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('handle') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const i = find(e.target), j = e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= this._steps.length) return;
      [this._steps[i], this._steps[j]] = [this._steps[j], this._steps[i]];
      this._stepsChanged(true);
      box.querySelector(`.step[data-id="${this._steps[j].id}"] .handle`).focus();
    });
    // Drag the handle: the step follows the finger, the others make room.
    box.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.handle');
      if (!h) return;
      e.preventDefault();
      const row = h.closest('.step');
      const rows = [...box.querySelectorAll('.step')];
      const from = rows.indexOf(row);
      const rects = rows.map((r) => r.getBoundingClientRect());
      const y0 = e.clientY;
      let to = from;
      try { h.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      row.classList.add('drag');
      const move = (ev) => {
        const dy = ev.clientY - y0;
        row.style.transform = `translateY(${dy}px)`;
        const mid = rects[from].top + rects[from].height / 2 + dy;
        to = rects.findIndex((r) => mid < r.top + r.height / 2);
        if (to < 0) to = rects.length - 1;
        const gap = rects[from].height + 8;
        rows.forEach((r, k) => {
          if (k === from) return;
          const shift = from < to && k > from && k <= to ? -gap : from > to && k < from && k >= to ? gap : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        rows.forEach((r) => { r.style.transform = ''; });
        row.classList.remove('drag');
        if (to !== from) {
          const [s] = this._steps.splice(from, 1);
          this._steps.splice(to, 0, s);
          this._stepsChanged(true);
        }
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  }

  // The steps as one script (saved scripts fetched first).
  async _compose(quiet) {
    try {
      for (const s of this._steps) {
        if (s.type === 'script' && s.name && !this._scripts.has(s.name)) this._scripts.set(s.name, await this._getSaved(s.name));
      }
      const name = this._$('name').value.trim();
      return composeScript(this._steps, { stroke: this._stroke, title: name || defaultName(stepsMs(this._steps)) }, this._scripts);
    } catch (e) {
      if (!quiet) this._toast(e.message || String(e));
      return null;
    }
  }

  _nameFor(script) { return this._$('name').value.trim() || defaultName(duration(script)); }

  async _try() {
    const script = await this._compose();
    if (!script) return;
    this._load({ src: 'build', name: script.metadata.title, script });
    this._start(0);
  }

  async _toQueue(who) {
    const script = await this._compose();
    if (!script) return;
    const name = this._nameFor(script);
    try {
      const res = await this._hass.callWS({ type: 'call_service', domain: 'ogg', service: 'studio_queue_add', service_data: { for: who, name, script }, return_response: true });
      this._$('name').value = '';
      this._tab = who; keepSet({ tab: who });
      this._lastAdded = res.response.id;
      this._toast(`Added "${res.response.name}" to ${this._queueOf(who)}. Tap Send on it to share the link.`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  async _toScripts() {
    const script = await this._compose();
    if (!script) return;
    const name = this._nameFor(script);
    try {
      await this._hass.callService('ogg', 'studio_save', { name, script });
      this._$('name').value = '';
      this._toast(`Saved "${name}" to your scripts.`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  async _openCode() {
    const text = this._$('codein').value;
    if (!text.trim()) { this._toast('Paste a code first.'); return; }
    try {
      const s = await decodeText(text);
      if (!s || !Array.isArray(s.actions) || !s.actions.length) throw new Error('That is not a script');
      this._load({ src: 'code', name: (s.metadata && s.metadata.title) || 'Opened code', script: s });
      this._$('codein').value = '';
      this._$('codebox').hidden = true;
      this._toast('Loaded: press Play, or add it to a queue from the Play card.');
    } catch (e) { this._toast('Could not read the code: ' + (e.message || e)); }
  }

  // ------------------------------------------------------------ the lists
  _showList() {
    const $ = this._$;
    if (!$) return;
    const all = Object.entries(this._queues);
    const of = (tab) => all.filter(([, r]) => (tab === 'played' ? r.played : !r.played && r.for === tab));
    for (const b of this.shadowRoot.querySelectorAll('.tabs button')) {
      const t = b.dataset.tab, n = of(t).length;
      b.textContent = `${t === 'his' ? `♂ ${this._label('his')}` : t === 'hers' ? `♀ ${this._label('hers')}` : '✓ Played'}${n ? ` (${n})` : ''}`;
      b.classList.toggle('on', t === this._tab);
    }
    const waiting = of('his').length + of('hers').length;
    $('qcount').textContent = `${waiting} waiting · ${of('played').length} played`;
    const rows = of(this._tab).sort((a, b) => String((this._tab === 'played' ? b[1].played : a[1].made) || '').localeCompare(String((this._tab === 'played' ? a[1].played : b[1].made) || '')));
    const cur = this._cur && this._cur.src === 'queue' ? this._cur.id : null;
    $('list').innerHTML = rows.map(([id, r]) => {
      const meta = [clock(r.duration_ms), r.kind === 'stroke' ? 'stroker' : r.motors > 1 ? 'two motors' : '',
        r.by_id && r.by_id === this._me ? 'from you' : r.by ? `from ${esc(r.by)}` : '', this._tab === 'played' ? `played ${when(r.played)}${r.plays > 1 ? ` (${r.plays}×)` : ''} · ${esc(this._label(r.for))}` : when(r.made)].filter(Boolean).join(' · ');
      const again = this._tab === 'played' ? `<button type="button" class="small" data-act="again" title="Back into ${esc(this._queueOf(r.for))}">↺</button>` : '';
      return `<div class="item${id === cur ? ' cur' : ''}" data-id="${esc(id)}"><div class="info"><div class="nm">${esc(r.name)}</div><div class="meta">${meta}</div></div>
        <button type="button" class="go small" data-act="play" aria-label="Play">▶</button>${again}<button type="button" class="small" data-act="send">Send</button><button type="button" class="small x" data-act="del" aria-label="Delete">✕</button></div>`;
    }).join('') || `<div class="empty">${this._tab === 'played' ? 'Nothing played yet.' : `Nothing in ${esc(this._queueOf(this._tab))} yet: make one below and add it.`}</div>`;
  }

  async _listAction(b) {
    if (!b) return;
    const id = b.closest('.item').dataset.id, r = this._queues[id];
    if (!r) return;
    const act = b.dataset.act;
    if (act === 'play') { await this._loadQueued(id, true); return; }
    if (act === 'send') { this._copyText(this._linkFor(id), `Link to "${r.name}" copied: send it to your partner. It opens this dashboard with it ready to play.`); return; }
    try {
      if (act === 'again') { await this._hass.callService('ogg', 'studio_queue_requeue', { id }); this._toast(`"${r.name}" is back in ${this._queueOf(r.for)}.`); }
      if (act === 'del' && confirm(`Delete "${r.name}"?`)) {
        await this._hass.callService('ogg', 'studio_queue_delete', { id });
        if (this._cur && this._cur.src === 'queue' && this._cur.id === id) { if (this._play) this._halt(true); this._cur = null; paint(this._$('heat'), null, 240); this._showPlayer(); }
      }
    } catch (e) { this._toast(e.message || String(e)); }
  }
}
