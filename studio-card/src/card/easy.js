// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// The Easy card (type: custom:ogg-easy-card): everything a partner needs,
// nothing more.
// * Connect now: IntiHA and Ogg on (Disconnect: both off, so toys sleep).
// * The toys, with their live level, to pick which play.
// * Manual: one or two sliders (as many as the toys and motors need),
//   Ogg's patterns and moods, saved scripts; Record and Save ("His save" /
//   "Hers save" and the date and time).
// * Queue & replay: the Queue card. Other: load a code or file, or make a
//   script (shown under Script until saved), then video and sound (the Play card's).
// Patterns, moods and scripts play in Home Assistant (ogg.play_script), so
// they carry on with the screen off; the sliders drive the toys live.
import { esc } from '../lib/core.js';
import { isStroke, runScript } from '../lib/convert.js';
import { aiVibeToStroke } from '../lib/ai.js';
import { limitMove, limitsFor } from '../lib/limits.js';
import { MOODS } from '../lib/moods.js';
import { sampleAt } from '../lib/outputs.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM, patternPeriod } from '../lib/patterns.js';
import { clock, duration, renderMood, renderPattern } from '../lib/compose.js';
import { heatColor, heatmap } from '../lib/tools.js';
import { VIEWERS_STYLE, oggPrivate, paintViewers, viewersBadge } from '../lib/private.js';
import { lockAll, makeCover, studioSettings } from '../lib/cover.js';
import { GEAR_STYLE, gearHtml, openDeviceSettings } from '../lib/devsettings.js';
import { OUT_KEY } from '../lib/outputs.js';
import { LOADED_SRC, loadedScript, onLoadedScript, readScript, setLoadedScript } from '../lib/loaded.js';
import { checkScript, generateRelaxTeaseEdge, peakSpeed, relaxTeaseEdgeFile } from '../lib/generate.js';
import { normalise } from '../lib/convert.js';
import { LIMIT_FULL_SPEED } from '../lib/limits.js';

// A vibration track as strokes for a stroker (cached per track).
const STROKES = new WeakMap();
const strokesFor = (track) => {
  if (!STROKES.has(track)) STROKES.set(track, aiVibeToStroke(track).actions);
  return STROKES.get(track);
};

export const EASY_TAG = 'ogg-easy-card';
const KEEP = 'ogg_easy_card';
const LOOP_MS = 10 * 60 * 1000;        // patterns and moods: ten minutes, looped by Ogg
const WHO = { his: 'His', hers: 'Hers' };

const STYLE = `
:host{display:block;--ink:#eef1ff;--muted:#93a0bf;--line:rgba(174,194,246,.14);--field:#16213a;--edge:#2e3c5c}
ha-card{display:block;overflow:hidden;border-radius:24px;border:1px solid rgba(174,194,246,.13);color:var(--ink);
  background:radial-gradient(circle at 110% -10%,rgba(255,120,180,.16),transparent 280px),radial-gradient(circle at -10% 0,rgba(49,198,184,.16),transparent 260px),linear-gradient(160deg,#141d33,#0d1426);
  font:15px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{padding:16px;display:flex;flex-direction:column;gap:12px}
.head{display:flex;align-items:center;gap:12px}
.brand{flex:0 0 44px;height:44px;border-radius:15px;display:grid;place-items:center;font-size:22px;background:linear-gradient(155deg,#6adfd4,#ff8fc0)}
.eyebrow{font-size:10px;font-weight:850;letter-spacing:.19em;color:#9ce2d9;text-transform:uppercase}
h2{margin:0;font-size:20px;letter-spacing:-.03em;font-weight:780}
.pill{margin-left:auto;font-size:11.5px;font-weight:750;padding:6px 10px;border-radius:30px;border:1px solid rgba(174,194,246,.18);color:var(--muted)}
.pill.on{border-color:rgba(100,218,189,.35);background:rgba(40,124,115,.2);color:#9adbd1}
.scan{flex:0 0 auto;margin-left:-6px;width:28px;height:28px;min-height:0;padding:0;border-radius:50%;border:1px solid rgba(174,194,246,.18);background:transparent;color:var(--muted);display:grid;place-items:center}
.scan svg{width:14px;height:14px;display:block}
.scan.spin{color:#9adbd1;border-color:rgba(100,218,189,.35)}
.scan.spin svg{animation:ogg-spin .9s linear infinite}
.scan[hidden]{display:none}
${VIEWERS_STYLE}
.head .viewers{height:24px;padding:0 9px;margin-top:3px;border-radius:12px;font-size:11.5px}
.lockb{flex:0 0 auto;width:34px;height:34px;min-height:0;padding:0;border-radius:11px;font-size:15px;display:grid;place-items:center}
.lockb[hidden]{display:none}
@keyframes ogg-spin{to{transform:rotate(360deg)}}
button{border:1px solid rgba(118,200,239,.3);background:#22385a;color:#c4f1ff;border-radius:16px;min-height:48px;padding:4px 12px;font:inherit;font-size:14.5px;line-height:1.15;font-weight:780;cursor:pointer}
button:disabled{opacity:.4;cursor:default}
button.go{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
button.stop{color:#ffbcc2;background:rgba(244,100,118,.1);border-color:rgba(239,115,134,.32)}
button.rec{background:#5a2433;border-color:rgba(255,110,130,.5);color:#ffd2da}
button.rec.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710}
.big{min-height:58px;font-size:17px;width:100%}
.row{display:flex;gap:8px;align-items:center}.row>*{flex:1 1 0;min-width:0}
.devs{display:flex;gap:6px;flex-wrap:wrap}
${GEAR_STYLE}
.dev{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;min-height:38px;border-radius:20px;padding:0 12px;font-size:12.5px;background:transparent;border-color:var(--edge);color:var(--muted)}
.dev.on{background:#23405f;border-color:#67e0c8;color:#e9fffb}
.chip{font-size:10px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;border-radius:8px;padding:1px 6px;border:1px solid}
.chip.his{color:#bcd3ff;border-color:rgba(120,170,255,.45)}
.chip.hers{color:#ffc4e2;border-color:rgba(255,130,190,.45)}
.lv{display:inline-flex;flex-direction:column;justify-content:center;gap:2px;width:38px;height:14px}
.lv i{display:block;height:4px;border-radius:2px;background:#22304d;overflow:hidden;position:relative}
.lv i b{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2fbfa9,#8ff0dc);transition:width .2s linear}
.lv.lin i{height:6px}
.lv.lin i b{width:8px!important;left:var(--p,0%);margin-left:-4px;border-radius:2px;background:#ffb3d9;transition:left .25s linear}
.pct{font-size:11px;font-weight:800;color:#e9fffb;font-variant-numeric:tabular-nums;min-width:28px;text-align:right}
.hint{font-size:12.5px;color:var(--muted)}
.scbar{position:relative;height:16px;border-radius:8px;background:#18233d;overflow:hidden;cursor:pointer;touch-action:none}
.scbar canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;opacity:.9}
.scbar i{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.28);border-right:2px solid #fff}
.sctime{font-size:12px;color:var(--muted);margin-top:-4px}
.modes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.modes button{min-height:64px;font-size:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.modes button span{font-size:22px}
.modes button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
.kinds{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.kinds button{min-height:44px;font-size:13px;padding:2px 4px}
.kinds button.on{background:#2b4f74;border-color:#67e0c8;color:#e9fffb}
.pads{display:grid;grid-template-columns:1fr;gap:10px}
.pads.two{grid-template-columns:1fr 1fr}
.pad{position:relative;height:230px;border-radius:20px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;cursor:ns-resize}
.pad .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(0deg,#2fbfa9,#67e0c8)}
.pad.b .fill{background:linear-gradient(0deg,#8f7dff,#ff8fc0)}
.pad .lab{position:absolute;top:10px;left:12px;right:12px;font-size:12px;font-weight:750;color:#e9ecfb;text-shadow:0 1px 4px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#k-manual{position:relative}
.ctlsw{position:absolute;top:8px;right:8px;z-index:3;display:flex;border:1px solid #3a4a6c;border-radius:999px;overflow:hidden;background:rgba(14,21,39,.85)}
.ctlsw button{min-height:0;height:26px;padding:0 10px;border:0;border-radius:0;background:transparent;font-size:11.5px;font-weight:750;color:var(--muted)}
.ctlsw button.on{background:#22385a;color:#c4f1ff}
#strokesec .sthead{padding-right:150px;min-height:28px;align-items:center}
.strokesec{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.sthead{font-size:13px;font-weight:800;color:#d5dcf7;display:flex;gap:6px;align-items:baseline}
.sthead span{font-weight:650;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.strow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:10px;align-items:stretch}
.stside{display:flex;flex-direction:column;gap:10px;justify-content:center}
.stside .sl{flex-direction:column;align-items:stretch;gap:4px}
.stside .sl span{display:flex;justify-content:space-between}
.pad.l{background:#141d33}
.pad.l .fill{background:linear-gradient(0deg,rgba(255,143,192,.18),rgba(255,207,138,.12))}
.pad.l .dot{position:absolute;left:14px;right:14px;height:14px;margin-bottom:-7px;border-radius:9px;background:linear-gradient(90deg,#ff8fc0,#ffcf8a);box-shadow:0 0 14px rgba(255,160,170,.55);bottom:50%}
.pad .val{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:32px;font-weight:850;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.55);font-variant-numeric:tabular-nums}
select{width:100%;box-sizing:border-box;background:var(--field);color:var(--ink);border:1px solid var(--edge);border-radius:14px;padding:12px;font:inherit;font-size:15px;font-weight:650}
.sl{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--muted)}
.sl span{flex:0 0 66px}.sl b{flex:0 0 40px;text-align:right;color:#e9ecfb}
input[type=range]{flex:1;accent-color:#67e0c8;height:30px;margin:0}
.moods{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.moods button{min-height:48px;font-size:13px;padding:2px 4px}
.moods button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
.panel{display:flex;flex-direction:column;gap:10px}
.recrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.recrow button{flex:1 1 0}
.recinfo{flex:1 1 100%;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.sw{display:flex;align-items:center;gap:8px;font-weight:750;font-size:13.5px;color:#d5dcf7;flex:0 0 auto}
.sw input{width:22px;height:22px;accent-color:#67e0c8}
.toast{min-height:16px;font-size:12.5px;color:#ffcf8a}
.row > .ren{flex:0 0 auto;min-height:48px;padding:0 14px;font-size:13.5px}
.embed{margin:0 -4px}
.loadbox{display:flex;flex-direction:column;gap:8px;margin:0 4px;padding:12px;border-radius:18px;border:1px solid var(--line);background:rgba(20,29,51,.6)}
.loadbox textarea{box-sizing:border-box;width:100%;min-height:64px;resize:vertical;background:var(--field);color:var(--ink);border:1px solid var(--edge);border-radius:14px;padding:10px;font:13px/1.35 ui-monospace,Consolas,monospace}
.loadbox input[type=text],.loadbox input[type=number]{box-sizing:border-box;width:100%;background:var(--field);color:var(--ink);border:1px solid var(--edge);border-radius:14px;padding:12px;font:inherit;font-size:15px;font-weight:650}
.loadbox .lfile{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
.loadbox .lfile input{position:absolute;inset:0;opacity:0;cursor:pointer}
.loadbox .x{flex:0 0 48px}
#loadedbox .row input{flex:2 1 0}
.loadbox .sub{border-top:1px solid var(--line);padding-top:10px;margin-top:4px}
.loadbox .ends{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin:-6px 0 0 76px;padding-right:66px}
.loadbox .sl span{flex:0 0 66px}
.loadbox .sl b{flex:0 0 56px;white-space:nowrap}
.loadbox .warn{color:#ffcf8a}
.gprev{display:flex;flex-direction:column;gap:2px}
.gprev canvas{display:block;width:100%;height:72px;border-radius:12px;background:#121a2e;border:1px solid var(--line)}
.gaxis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
[hidden]{display:none!important}
`;

const keepGet = () => { try { return JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch (_) { return {}; } };
const keepSet = (patch) => { try { localStorage.setItem(KEEP, JSON.stringify({ ...keepGet(), ...patch })); } catch (_) { /* private browsing */ } };
const stamp = (d = new Date()) => `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

export class OggEasyCard extends HTMLElement {
  setConfig(config) { this._config = config || {}; }
  getCardSize() { return 10; }
  static getStubConfig() { return {}; }

  constructor() {
    super();
    const kept = keepGet();
    this._mode = ['play', 'queue', 'other'].includes(kept.mode) ? kept.mode : 'play';
    this._kind = ['manual', 'pattern', 'mood', 'script'].includes(kept.kind) ? kept.kind : 'manual';
    this._pick = Array.isArray(kept.devices) ? new Set(kept.devices) : null;   // stop entities; null = every connected toy
    this._devices = [];
    this._pads = [0, 0];
    this._playing = null;     // {kind, tracks: {a, b}, t0, loop, label}
    this._rec = null;         // {t0, a: [], b: [], two}
    this._take = null;
  }

  set hass(hass) {
    this._rawHass = hass;
    oggPrivate().attach(hass, this);
    this._hass = oggPrivate().wrap(hass);
    if (!this.shadowRoot) this._build();
    if (!this._ocov) this._ocov = makeCover(this.shadowRoot.querySelector('ha-card'));
    this._ocov.update(this._hass);
    if (!this._regLoaded) { this._regLoaded = true; this._loadRegistry(); }
    for (const child of [this._queueCard, this._mediaCard, this._strokeCard]) if (child) child.hass = hass;
    this._refresh();
  }

  _oggPrivateChanged() { if (this._rawHass) this.hass = this._rawHass; }
  connectedCallback() {
    if (!this._offLoaded) this._offLoaded = onLoadedScript(() => { this._showLoaded(); this._refresh(); const m = this._mediaCard; if (m && m._hass && m._fillVideoScripts) m._fillVideoScripts(); });
  }
  disconnectedCallback() { if (this._offLoaded) { this._offLoaded(); this._offLoaded = null; } this._halt(true); clearInterval(this._recTimer); this._recTimer = null; }

  // ------------------------------------------------------------ Home Assistant
  async _loadRegistry() {
    try {
      const [entities, devices] = await Promise.all([
        this._hass.callWS({ type: 'config/entity_registry/list' }),
        this._hass.callWS({ type: 'config/device_registry/list' }),
      ]);
      const names = new Map(devices.map((d) => [d.id, d.name_by_user || d.name || 'Toy']));
      const by = new Map();
      for (const e of entities) {
        if (e.disabled_by) continue;
        const u = String(e.unique_id || '');
        if (e.platform === 'intiha' && e.entity_id.startsWith('switch.') && /enabled$/.test(u) && !/connect/.test(u)) { this._intiha = e.entity_id; continue; }
        if (e.platform !== 'ogg') continue;
        if (e.entity_id.startsWith('switch.') && u.split(':').length === 2 && u.endsWith(':enabled')) { this._oggSwitch = e.entity_id; continue; }
        if (e.entity_id.startsWith('switch.') && u.split(':').length === 2 && u.endsWith(':search')) { this._searchSwitch = e.entity_id; continue; }
        if (u.endsWith(':studio_saved_script')) { this._studio = e.entity_id; continue; }
        if (!e.device_id || u.split(':').length < 3 || /:studio_/.test(u)) continue;
        const d = by.get(e.device_id) || { id: e.device_id, name: names.get(e.device_id) };
        if (u.endsWith(':stop')) d.stop = e.entity_id;
        if (u.endsWith(':owner')) d.owner = e.entity_id;
        if (u.endsWith(':connect_this_device') && e.entity_id.startsWith('switch.')) d.commands = e.entity_id;
        if (u.endsWith(':connected')) d.connected = e.entity_id;
        if (u.endsWith(':status')) d.status = e.entity_id;
        if (u.endsWith(':motor_level_1')) d.dual = true;
        if (u.endsWith(':linear_0')) { d.linear = true; d.position = e.entity_id; }
        if (u.endsWith(':intensity') || u.endsWith(':motor_level_0')) d.vibe = true;
        by.set(e.device_id, d);
      }
      this._devices = [...by.values()].filter((d) => d.stop).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { this._toast(`Could not read the toys: ${e.message || e}`); }
    this._refresh();
  }

  _st(id) { return id && this._hass && this._hass.states[id]; }
  _online(d) { const s = this._st(d.connected); return Boolean(s && s.state === 'on'); }
  _whose(d) { const s = this._st(d.owner); return s && WHO[s.state] ? s.state : ''; }
  get _connected() {
    const on = (id) => { const s = this._st(id); return s ? s.state === 'on' : null; };
    return { intiha: on(this._intiha), ogg: on(this._oggSwitch) };
  }

  // The toys that play: the ones picked (connected), else every connected toy.
  _targets() {
    const online = this._devices.filter((d) => this._online(d));
    return this._pick ? online.filter((d) => this._pick.has(d.stop)) : online;
  }

  // Which slider each toy follows: one toy with two motors gets both (a, b);
  // with two or more toys, they take turns (1st a, 2nd b, 3rd a…).
  _channels() {
    const t = this._targets().filter((d) => d.vibe || d.linear);
    if (t.length === 1) return { two: Boolean(t[0].dual), map: [{ d: t[0], ch: t[0].dual ? 'ab' : 'a' }] };
    return { two: t.length > 1, map: t.map((d, i) => ({ d, ch: i % 2 ? 'b' : 'a' })) };
  }

  // The sliders' channels: vibrators only (a stroker has its own control).
  _vibeChannels() {
    const t = this._targets().filter((d) => d.vibe);
    if (t.length === 1) return { two: Boolean(t[0].dual), map: [{ d: t[0], ch: t[0].dual ? 'ab' : 'a' }] };
    return { two: t.length > 1, map: t.map((d, i) => ({ d, ch: i % 2 ? 'b' : 'a' })) };
  }

  _strokers() { return this._targets().filter((d) => d.linear && !d.vibe); }

  // One control at a time, with a switch in the corner: vibration by default,
  // the stroker when only strokers are picked. Picking one by hand keeps it
  // (until the picked toys change), so a stroke can be recorded for a partner
  // with only a vibrator here, and the other way round.
  _showSections(toysChanged) {
    if (!this._$) return;
    if (toysChanged) this._ctlPicked = false;
    if (!this._ctlPicked) {
      const strokers = this._strokers();
      const auto = strokers.length && !this._targets().some((d) => d.vibe) ? 'stroke' : 'vibe';
      if (auto !== this._ctl) this._setCtl(auto, false);
    }
    const ctl = this._ctl || 'vibe';
    this._$('vibesec').hidden = ctl !== 'vibe';
    this._$('strokesec').hidden = ctl !== 'stroke';
    for (const b of this._$('ctlsw').querySelectorAll('button')) b.classList.toggle('on', b.dataset.ctl === ctl);
    const names = this._strokers().map((d) => d.name);
    this._$('stnames').textContent = names.length ? names.join(', ') : 'no stroker picked: it only records';
    this._strokeEmbed();
  }

  // The Play card's own stroke controls (range, position, Fast / Medium /
  // Slow, Latch, limits), playing the strokers picked here.
  _strokeEmbed() {
    const strokers = this._strokers();
    const key = this._ctl === 'stroke' ? JSON.stringify(strokers.map((d) => d.id)) : '';
    if (key === this._stEmbedKey) return;
    this._stEmbedKey = key;
    this._strokeRelease();
    if (this._strokeCard) { this._strokeCard.remove(); this._strokeCard = null; }
    if (!key) return;
    const card = document.createElement('oggstudio-play-card');
    const t = strokers.length ? strokers.map((d) => `${d.id}|l`) : [null];
    card.setConfig({ stroke_only: true, outputs: { t, m: t.map(() => 'position'), on: t.map(() => strokers.length > 0) } });
    this._$('stembed').appendChild(card);
    if (this._rawHass) card.hass = this._rawHass;
    this._strokeCard = card;
  }

  // Let go of the embedded stroke controls (a latch or a hold stops).
  _strokeRelease() {
    const c = this._strokeCard;
    if (!c || !c._st) return;
    c._st.touch = null; c._st.pad = null; c._st.latch = null; c._st.drag = null;
    if (c._stHalt) c._stHalt();
    if (c._outStop) c._outStop();
  }

  _strokePos() { const c = this._strokeCard; return c && c._st ? c._st.pos : 50; }

  _setCtl(ctl, byHand) {
    if (byHand) this._ctlPicked = true;
    if (ctl === this._ctl) { this._showSections(); return; }
    // Leaving a control lets go of it.
    this._strokeRelease();
    if (this._pads.some((v) => v > 0)) { this._pads = [0, 0]; this._showPads(); this._manual(); }
    this._ctl = ctl;
    this._showSections();
  }

  // ------------------------------------------------------------ layout
  _build() {
    this.attachShadow({ mode: 'open' });
    const ptOpts = `<optgroup label="Patterns">${Object.entries(PATTERNS).map(([k, n]) => `<option value="${k}"${k === 'wave' ? ' selected' : ''}>${n}</option>`).join('')}<option value="${PATTERN_RANDOM}">🎲 Random</option></optgroup>`
      + `<optgroup label="Two motors">${Object.entries(PATTERNS_DUAL).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</optgroup>`;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="wrap">
      <div class="head"><div class="brand">💞</div><div><div class="eyebrow">Ogg</div><h2 id="title">Easy</h2>${viewersBadge()}</div><span class="pill" id="pill">Off</span><button type="button" class="scan" id="scan" title="Search for toys" aria-label="Search for toys" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/></svg></button><button type="button" class="lockb" id="lockb" title="Lock (covers every Ogg card)" aria-label="Lock" hidden>🔒</button></div>
      <button class="go big" id="connect" type="button">🔌 Connect now</button>
      <div class="devs" id="devs"></div>
      <div class="modes"><button type="button" data-mode="play"><span>▶</span>Manual</button><button type="button" data-mode="queue"><span>📋</span>Queue &amp; replay</button><button type="button" data-mode="other"><span>⋯</span>Other</button></div>
      <div class="panel" id="p-play">
        <div class="kinds"><button type="button" data-kind="manual">✋ Manual</button><button type="button" data-kind="pattern">〰️ Pattern</button><button type="button" data-kind="mood">🎭 Mood</button><button type="button" data-kind="script">📜 Script</button></div>
        <div id="k-manual" class="panel">
          <div class="ctlsw" id="ctlsw" role="group" aria-label="Vibrate or stroke"><button type="button" data-ctl="vibe" title="Vibration sliders">〰️ Vibe</button><button type="button" data-ctl="stroke" title="Stroker control">↕️ Stroke</button></div>
          <div id="vibesec" class="panel"><div class="pads" id="pads"></div><label class="sw"><input type="checkbox" id="spring"> Drop to 0 when I let go</label><div class="hint" id="padhint">Slide up and down. Double-tap to drop to zero.</div></div>
          <div id="strokesec" class="strokesec" hidden>
            <div class="sthead">↕️ Stroker <span id="stnames"></span></div>
            <div id="stembed"></div>
          </div>
        </div>
        <div id="k-pattern" class="panel">
          <select id="ptsel" aria-label="Pattern">${ptOpts}</select>
          <label class="sl"><span>Strength</span><input type="range" id="ptstr" min="5" max="100" step="5" value="70"><b id="ptstrv">70%</b></label>
          <label class="sl"><span id="ptspeedl">Speed</span><input type="range" id="ptspeed" min="0" max="100" step="5" value="50"><b id="ptspeedv"></b></label>
          <button class="go big" id="ptgo" type="button">▶ Play pattern</button>
        </div>
        <div id="k-mood" class="panel">
          <div class="moods" id="moods">${Object.entries(MOODS).map(([k, m]) => `<button type="button" data-mood="${k}">${m.icon} ${esc(m.label)}</button>`).join('')}</div>
          <label class="sl"><span>Strength</span><input type="range" id="moodstr" min="20" max="100" step="5" value="100"><b id="moodstrv">100%</b></label>
        </div>
        <div id="k-script" class="panel">
          <div class="row"><select id="scsel" aria-label="Saved script"></select><button type="button" id="scren" class="ren" aria-label="Rename this script" title="Rename">✏️ Rename</button></div>
          <div class="scbar" id="scbar" title="Tap to jump there"><canvas id="scheat"></canvas><i id="sccur"></i></div>
          <div class="sctime" id="sctime"></div>
          <div class="row"><button class="go" id="scgo" type="button">▶ Play</button><label class="sw"><input type="checkbox" id="scloop"> Loop</label></div>
        </div>
        <div class="recrow"><button class="rec" id="rec" type="button">● Record</button><button id="save" type="button" disabled>💾 Save</button><span class="recinfo" id="recinfo">Record what plays, then save it.</span></div>
        <button class="stop big" id="stopall" type="button" title="Stop everything Ogg is playing, on every card">■ Stop all</button>
      </div>
      <div class="panel embed" id="p-queue"></div>
      <div class="panel embed" id="p-other">
        <div class="loadbox" id="loadbox">
          <div class="sthead">📥 Load a code or script</div>
          <textarea id="codein" placeholder="Paste a code (ogg1:…) or a funscript" spellcheck="false" autocomplete="off"></textarea>
          <div class="row"><button type="button" id="codego">Load it</button><button type="button" class="lfile" id="codefilebtn">📂 From a file<input type="file" id="codefile" accept=".funscript,.json,application/json" aria-label="Load a script from a file on this device"></button></div>
          <div class="sthead sub">✨ Make a script <span>Relax, tease, edge · for a stroker</span></div>
          <label class="sl"><span>Length</span><input type="range" id="glen" min="1" max="90" step="1" value="60"><b id="glenv">60 min</b></label>
          <label class="sl"><span>Intensity</span><input type="range" id="gint" min="1" max="10" step="1" value="6"><b id="gintv">6</b></label>
          <div class="ends"><span>Gentle</span><span>Intense</span></div>
          <label class="sl"><span>Max bpm</span><input type="range" id="gbpm" min="80" max="150" step="5" value="130"><b id="gbpmv">130</b></label>
          <label class="sl"><span>Variation</span><input type="number" id="gseed" min="0" max="4294967295" step="1" value="7" inputmode="numeric" aria-label="Variation (the same number always makes the same script)"></label>
          <div class="gprev" id="gprev" hidden><canvas id="gcan" aria-label="Preview: position over time, coloured by speed"></canvas><div class="gaxis"><span>0:00</span><span id="gmid"></span><span id="gend"></span></div></div>
          <div class="row"><button type="button" id="gmake">✨ Make it</button><button type="button" id="gload" class="go" disabled>📥 Load it</button></div>
          <button type="button" id="gdl">⬇ Save as .funscript</button>
          <div class="hint" id="ginfo">The same settings always make the same script. Variation changes the details.</div>
          <div id="loadedbox" class="panel sub" hidden>
            <div class="hint" id="loadedinfo"></div>
            <div class="row"><input type="text" id="loadname" maxlength="60" aria-label="Name to save it as" autocomplete="off"><button type="button" id="loadsave" class="go">💾 Save</button><button type="button" id="loadclear" class="stop x" title="Clear it (not saved)" aria-label="Clear the loaded script">✕</button></div>
          </div>
        </div>
      </div>
      <div class="toast" id="toast" role="status"></div>
    </div></ha-card>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._$ = $;
    $('connect').addEventListener('click', () => this._connect());
    $('devs').addEventListener('click', (e) => {
      const gear = e.target.closest('.gear');
      if (gear) { e.stopPropagation(); this._devSettings(gear.dataset.gear); return; }
      this._toggleDev(e.target.closest('button'));
    });
    $('devs').addEventListener('keydown', (e) => {
      const gear = e.target.closest('.gear');
      if (gear && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); this._devSettings(gear.dataset.gear); }
    });
    this.shadowRoot.querySelector('.modes').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) this._setMode(b.dataset.mode); });
    this.shadowRoot.querySelector('.kinds').addEventListener('click', (e) => { const b = e.target.closest('button[data-kind]'); if (b) this._setKind(b.dataset.kind); });
    $('ptgo').addEventListener('click', () => { if (this._playing && this._playing.kind === 'pattern') this._halt(); else this._playPattern(); });
    $('ptsel').addEventListener('change', () => { if (this._playing && this._playing.kind === 'pattern') this._playPattern(); this._showPlay(); });
    for (const id of ['ptstr', 'ptspeed']) $(id).addEventListener('input', () => { this._showPlay(); this._again('pattern', () => this._playPattern()); });
    $('moods').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mood]');
      if (!b) return;
      if (this._playing && this._playing.kind === 'mood' && this._playing.key === b.dataset.mood) this._halt(); else this._playMood(b.dataset.mood);
    });
    $('moodstr').addEventListener('input', () => { this._showPlay(); this._again('mood', () => this._playMood(this._playing.key)); });
    $('scgo').addEventListener('click', () => { if (this._playing && this._playing.kind === 'script') this._halt(); else this._playScript(); });
    $('scsel').addEventListener('change', () => { this._scFrom = 0; this._scLoad(); });
    // The script's shape (like the Queue card): tap to jump there, playing or not.
    $('scbar').addEventListener('pointerdown', (e) => {
      const s = this._scCache && this._scCache.script;
      if (!s) return;
      const r = $('scbar').getBoundingClientRect();
      const at = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(s);
      if (this._playing && this._playing.kind === 'script') this._playScript(at);
      else { this._scFrom = at; this._scShow(); }
    });
    $('scren').addEventListener('click', () => this._rename());
    $('codego').addEventListener('click', () => this._loadCode());
    $('codefile').addEventListener('change', () => this._loadFile());
    $('loadsave').addEventListener('click', () => this._saveLoaded());
    $('loadclear').addEventListener('click', () => { setLoadedScript(null); this._toast('Cleared the loaded script.'); });
    for (const id of ['glen', 'gint', 'gbpm']) $(id).addEventListener('input', () => { $(`${id}v`).textContent = `${$(id).value}${id === 'glen' ? ' min' : ''}`; this._genChanged(); });
    $('gseed').addEventListener('input', () => this._genChanged());
    $('gmake').addEventListener('click', () => this._genMake());
    $('gload').addEventListener('click', () => this._genLoad());
    $('gdl').addEventListener('click', () => this._genDownload());
    this._showLoaded();
    $('scan').addEventListener('click', () => this._search());
    $('lockb').addEventListener('click', () => lockAll());
    $('rec').addEventListener('click', () => this._recToggle());
    $('save').addEventListener('click', () => this._save());
    $('stopall').addEventListener('click', () => this._stopAll());
    this._bindPads();
    $('ctlsw').addEventListener('click', (e) => { const b = e.target.closest('button[data-ctl]'); if (b) this._setCtl(b.dataset.ctl, true); });
    this._setMode(this._mode, true);
    this._setKind(this._kind, true);
  }

  _toast(text) {
    const t = this._$ && this._$('toast');
    if (!t) return;
    t.textContent = text;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.textContent = ''; }, 6000);
  }

  _setMode(mode, quiet) {
    this._mode = mode;
    if (!quiet) keepSet({ mode });
    for (const b of this.shadowRoot.querySelectorAll('.modes button')) b.classList.toggle('on', b.dataset.mode === mode);
    for (const m of ['play', 'queue', 'other']) this._$(`p-${m}`).hidden = m !== mode;
    // The Queue card and the media sections join when first wanted.
    if (mode === 'queue' && !this._queueCard) {
      this._queueCard = document.createElement('ogg-queue-card');
      this._queueCard.setConfig({ embedded: true });
      this._queueCard.externalTargets = this._targets().map((d) => d.stop);
      this._$('p-queue').appendChild(this._queueCard);
      if (this._rawHass) this._queueCard.hass = this._rawHass;
    }
    if (mode === 'other') this._media();
  }

  // Video and sound: the Play card's own sections, folded, for the toys picked here.
  _media() {
    const key = JSON.stringify(this._targets().map((d) => d.stop));
    if (this._mediaCard && this._mediaKey === key) return;
    this._mediaKey = key;
    const t = []; const m = []; const on = [];
    for (const { d, ch } of this._channels().map) {
      const motor = d.linear && !d.vibe ? 'l' : 'b';
      t.push(`${d.id}|${motor}`); m.push('position'); on.push(true);
    }
    try { if (t.length) localStorage.setItem(OUT_KEY, JSON.stringify({ t, m, on })); } catch (_) { /* private browsing */ }
    if (this._mediaCard) this._mediaCard.remove();
    this._mediaCard = document.createElement('oggstudio-play-card');
    this._mediaCard.setConfig({ media_only: true });
    this._$('p-other').appendChild(this._mediaCard);
    if (this._rawHass) this._mediaCard.hass = this._rawHass;
  }

  _setKind(kind, quiet) {
    if (kind !== this._kind && this._playing) this._halt(true);
    this._kind = kind;
    if (!quiet) keepSet({ kind });
    this._showPlay();
  }

  // ------------------------------------------------------------ connecting
  async _connect() {
    const c = this._connected;
    const turnOn = !(c.intiha || c.ogg);
    if (!turnOn) this._halt(true);
    try {
      const calls = [];
      if (this._intiha) calls.push(this._hass.callService('switch', turnOn ? 'turn_on' : 'turn_off', { entity_id: this._intiha }));
      if (this._oggSwitch) calls.push(this._hass.callService('switch', turnOn ? 'turn_on' : 'turn_off', { entity_id: this._oggSwitch }));
      if (!calls.length) { this._toast('Ogg is not set up yet.'); return; }
      await Promise.all(calls);
      this._toast(turnOn ? 'Connecting: switch your toys on and they appear here in a moment.' : 'Disconnected: your toys can sleep now.');
    } catch (e) { this._toast(e.message || String(e)); }
  }

  // ------------------------------------------------------------ what is shown
  _refresh() {
    if (!this._$ || !this._hass) return;
    const $ = this._$;
    paintViewers(this.shadowRoot, (t) => this._toast(t));
    // Stop all on another card (or this one) stops what this card plays too.
    const studio = this._studio && this._hass.states[this._studio];
    const panic = studio ? studio.attributes.panic || 0 : undefined;
    if (panic !== undefined) {
      if (this._panicSeen !== undefined && panic !== this._panicSeen && (this._playing || this._pads.some((v) => v > 0))) { this._halt(true); this._toast('Everything was stopped.'); }
      this._panicSeen = panic;
    }
    // The people here, in place of "Easy" (a title set on the card still shows).
    const people = this.shadowRoot.querySelector('[data-viewers]');
    $('title').hidden = Boolean(people && !people.hidden && !(this._config && this._config.title));
    if (this._config && this._config.title) $('title').textContent = this._config.title;
    const c = this._connected;
    const anyOn = Boolean(c.intiha || c.ogg);
    const online = this._devices.filter((d) => this._online(d));
    $('connect').textContent = anyOn ? '⏻ Disconnect' : '🔌 Connect now';
    $('connect').className = anyOn ? 'stop big' : 'go big';
    $('pill').textContent = !anyOn ? 'Off' : online.length ? `${online.length} toy${online.length === 1 ? '' : 's'} connected` : 'Looking for toys…';
    $('pill').classList.toggle('on', anyOn && online.length > 0);
    const searching = Boolean(this._st(this._searchSwitch) && this._st(this._searchSwitch).state === 'on');
    $('scan').hidden = !c.ogg || !this._searchSwitch;
    const privacy = studioSettings(this._hass) || {};
    $('lockb').hidden = !privacy.discreet && !privacy.pin;
    $('scan').classList.toggle('spin', searching);
    $('scan').title = searching ? 'Searching for toys… (tap to stop)' : 'Search for toys';
    this._showDevs();
    this._showLevels();
    const names = this._names();
    const sc = $('scsel');
    // A loaded or made script (not saved yet) comes first.
    const loaded = loadedScript();
    const values = [...(loaded ? [LOADED_SRC] : []), ...names];
    const html = (loaded ? `<option value="${LOADED_SRC}">📄 ${esc(loaded.name)} · not saved</option>` : '')
      + (names.length ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('') : loaded ? '' : '<option value="">No saved scripts yet</option>');
    if (sc.dataset.h !== html) {
      const v = this._wantScript && values.includes(this._wantScript) ? this._wantScript : sc.value;
      sc.innerHTML = html; sc.dataset.h = html;
      if (values.includes(v)) { sc.value = v; if (v === this._wantScript) this._wantScript = null; }
      this._scLoad();
    }
    this._$('scren').disabled = !values.length;
    if (this._queueCard) this._queueCard.externalTargets = this._targets().map((d) => d.stop);
    const key = JSON.stringify([this._channels().map.map((x) => [x.d.stop, x.ch]), this._strokers().map((d) => d.stop)]);
    if (key !== this._chKey) { this._chKey = key; this._showPads(); this._showSections(true); if (this._mode === 'other') this._media(); }
  }

  _names() {
    const s = this._st(this._studio);
    return ((s && s.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
  }

  _showDevs() {
    const $ = this._$;
    const online = this._devices.filter((d) => this._online(d));
    const targets = new Set(this._targets().map((d) => d.stop));
    const html = online.length ? online.map((d) => {
      const w = this._whose(d), lin = d.linear && !d.vibe;
      return `<button type="button" class="dev${targets.has(d.stop) ? ' on' : ''}" data-stop="${esc(d.stop)}" aria-pressed="${targets.has(d.stop)}">${gearHtml(d)}${esc(d.name)}${w ? `<span class="chip ${w}">${WHO[w]}</span>` : ''}`
        + `<span class="lv${lin ? ' lin' : ''}" data-lv="${esc(d.stop)}" aria-hidden="true"><i><b></b></i>${!lin && d.dual ? '<i><b></b></i>' : ''}</span><span class="pct" data-pct="${esc(d.stop)}"></span></button>`;
    }).join('') : `<span class="hint">${this._connected.intiha || this._connected.ogg ? 'No toys yet: switch them on and keep them close.' : 'Press Connect now, then switch your toys on.'}</span>`;
    if ($('devs').dataset.h !== html) { $('devs').innerHTML = html; $('devs').dataset.h = html; }
  }

  _showLevels() {
    const root = this.shadowRoot;
    for (const d of this._devices) {
      const lv = root.querySelector(`[data-lv="${CSS.escape(d.stop)}"]`), pct = root.querySelector(`[data-pct="${CSS.escape(d.stop)}"]`);
      if (!lv || !pct) continue;
      if (d.linear && !d.vibe) {
        const s = this._st(d.position), v = s ? Math.max(0, Math.min(100, Number(s.state) || 0)) : 0;
        lv.style.setProperty('--p', `${v}%`);
        pct.textContent = `↕${Math.round(v)}`;
        continue;
      }
      const s = this._st(d.status);
      const out = (s && Array.isArray(s.attributes.output) ? s.attributes.output : []).map((x) => Math.max(0, Math.min(100, Number(x) || 0)));
      lv.querySelectorAll('b').forEach((b, i) => { b.style.width = `${out[i] ?? out[0] ?? 0}%`; });
      pct.textContent = `${Math.round(Math.max(0, ...out))}%`;
    }
  }

  // ⚙ on a toy: its limits (kept in Home Assistant for every card).
  _devSettings(stop) {
    const dev = this._devices.find((d) => d.stop === stop);
    const s = this._st(this._studio);
    if (!dev) return;
    openDeviceSettings(this.shadowRoot, { hass: this._hass, dev, allLimits: s && s.attributes.limits, toast: (t) => this._toast(t) });
  }

  _toggleDev(b) {
    if (!b || !b.dataset.stop) return;
    const pick = this._pick || new Set(this._targets().map((d) => d.stop));
    if (pick.has(b.dataset.stop)) pick.delete(b.dataset.stop); else pick.add(b.dataset.stop);
    this._pick = pick;
    keepSet({ devices: [...pick] });
    if (this._playing) this._resend();
    this._refresh();
  }

  _showPads() {
    const { two, map } = this._vibeChannels();
    const label = (ch) => map.filter((x) => x.ch.includes(ch)).map((x) => (x.ch === 'ab' ? `${x.d.name} · motor ${ch === 'a' ? 1 : 2}` : x.d.name)).join(' + ') || 'No vibrator';
    this._$('padhint').textContent = 'Slide up and down. Double-tap to drop to zero.';
    const box = this._$('pads');
    box.classList.toggle('two', two);
    box.innerHTML = (two ? ['a', 'b'] : ['a']).map((ch, i) => `<div class="pad ${ch}" data-i="${i}" role="slider" aria-label="${esc(label(ch))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(this._pads[i])}" tabindex="0"><div class="fill" style="height:${this._pads[i]}%"></div><div class="lab">${esc(label(ch))}</div><div class="val">${Math.round(this._pads[i])}%</div></div>`).join('');
  }

  _showPlay() {
    this._scShow();
    const $ = this._$;
    for (const b of this.shadowRoot.querySelectorAll('.kinds button')) b.classList.toggle('on', b.dataset.kind === this._kind);
    for (const k of ['manual', 'pattern', 'mood', 'script']) $(`k-${k}`).hidden = k !== this._kind;
    const p = this._playing;
    const random = $('ptsel').value === PATTERN_RANDOM;
    $('ptspeedl').textContent = random ? 'How busy' : 'Speed';
    $('ptspeedv').textContent = random ? `${$('ptspeed').value}%` : `${patternPeriod(Number($('ptspeed').value)).toFixed(1)} s`;
    $('ptstrv').textContent = `${$('ptstr').value}%`;
    $('moodstrv').textContent = `${$('moodstr').value}%`;
    $('ptgo').textContent = p && p.kind === 'pattern' ? '■ Stop pattern' : '▶ Play pattern';
    $('ptgo').className = p && p.kind === 'pattern' ? 'stop big' : 'go big';
    for (const b of this.shadowRoot.querySelectorAll('#moods button')) b.classList.toggle('on', Boolean(p && p.kind === 'mood' && p.key === b.dataset.mood));
    $('scgo').textContent = p && p.kind === 'script' ? '■ Stop' : '▶ Play';
    $('scgo').className = p && p.kind === 'script' ? 'stop' : 'go';
    $('rec').textContent = this._rec ? `■ Stop ${clock(performance.now() - this._rec.t0)}` : '● Record';
    $('rec').classList.toggle('on', Boolean(this._rec));
    $('save').disabled = !this._take;
    if (!this._rec) $('recinfo').textContent = this._take ? `Recorded ${clock(this._takeLen)}. Save it as "${this._saveName()}".` : 'Record what plays, then save it.';
  }

  // ------------------------------------------------------------ manual
  _bindPads() {
    const box = this._$('pads');
    const set = (pad, e) => {
      const r = pad.getBoundingClientRect();
      if (!r.height) return;
      const i = Number(pad.dataset.i);
      this._pads[i] = Math.round(Math.min(100, Math.max(0, (r.bottom - e.clientY) / r.height * 100)));
      pad.querySelector('.fill').style.height = `${this._pads[i]}%`;
      pad.querySelector('.val').textContent = `${this._pads[i]}%`;
      pad.setAttribute('aria-valuenow', String(this._pads[i]));
      this._manual();
    };
    let tapAt = 0;
    let zeroed = false;     // a double-tap dropped it: the finger is ignored until it lifts
    box.addEventListener('pointerdown', (e) => {
      const pad = e.target.closest('.pad');
      if (!pad) return;
      try { pad.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      const now = Date.now();
      if (now - tapAt < 300) { this._pads[Number(pad.dataset.i)] = 0; tapAt = 0; zeroed = true; this._showPads(); this._manual(); return; }
      zeroed = false;
      tapAt = now;
      set(pad, e);
    });
    box.addEventListener('pointermove', (e) => { const pad = e.target.closest('.pad'); if (pad && !zeroed && (e.buttons || e.pointerType === 'touch')) set(pad, e); });
    // Drop to 0: a slider springs back to zero when it is let go.
    const spring = this._$('spring');
    spring.checked = Boolean(keepGet().spring);
    spring.addEventListener('change', () => keepSet({ spring: spring.checked }));
    const release = (e) => {
      zeroed = false;
      const pad = e.target.closest('.pad');
      if (!pad || !spring.checked) return;
      this._pads[Number(pad.dataset.i)] = 0;
      this._showPads();
      this._manual();
    };
    box.addEventListener('pointerup', release);
    box.addEventListener('pointercancel', release);
    box.addEventListener('keydown', (e) => {
      const pad = e.target.closest('.pad');
      if (!pad || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const i = Number(pad.dataset.i);
      this._pads[i] = Math.max(0, Math.min(100, this._pads[i] + (e.key === 'ArrowUp' ? 5 : -5)));
      this._showPads(); this._manual();
    });
  }

  // The sliders drive the toys live (Ogg stops them a moment after the last level).
  _manual() {
    if (this._playing) { const keep = [...this._pads]; this._halt(true); this._pads = keep; this._showPads(); }
    clearInterval(this._liveTimer);
    this._send();
    if (this._pads.some((v) => v > 0)) this._liveTimer = setInterval(() => this._send(), 400);
  }

  _send() {
    const lim = this._st(this._studio);
    const limits = lim && lim.attributes.limits;
    for (const { d, ch } of this._vibeChannels().map) {
      const max = limitsFor(limits, d.stop).max / 100;
      const a = this._pads[0], b = this._pads[1] ?? a;
      const levels = ch === 'ab' ? [a, b] : ch === 'b' ? (d.dual ? [b, b] : [b]) : (d.dual ? [a, a] : [a]);
      this._hass.callService('ogg', 'live', { entity_id: d.stop, levels: levels.map((v) => Math.round(v * max) / 100), seconds: 1 }).catch(() => {});
    }
    if (!this._pads.some((v) => v > 0)) { clearInterval(this._liveTimer); this._liveTimer = null; }
  }

  // ------------------------------------------------------------ patterns, moods, scripts
  _again(kind, fn) {
    if (!this._playing || this._playing.kind !== kind) return;
    clearTimeout(this._againT);
    this._againT = setTimeout(fn, 400);
  }

  _playPattern() {
    const $ = this._$;
    const p = renderPattern($('ptsel').value, LOOP_MS, { level: Number($('ptstr').value), speed: Number($('ptspeed').value), seed: 1 + Math.floor(Math.random() * 1e6) });
    this._start({ kind: 'pattern', tracks: { a: p.a, b: p.b || p.a }, loop: true, label: $('ptsel').selectedOptions[0].textContent });
  }

  _playMood(key) {
    const m = renderMood(key, LOOP_MS, { strength: Number(this._$('moodstr').value), seed: 1 + Math.floor(Math.random() * 1e6) });
    this._start({ kind: 'mood', key, tracks: { a: m.a, b: m.b || m.a, stroke: m.stroke }, loop: true, label: `${MOODS[key].icon} ${MOODS[key].label}` });
  }

  // The chosen script (cached by name), for its shape and to play.
  async _scGet(name) {
    if (name === LOADED_SRC) {
      const l = loadedScript();
      if (!l) throw new Error('the loaded script was cleared');
      if (!this._scCache || this._scCache.name !== name || this._scCache.script !== l.script) this._scCache = { name, script: l.script };
      return l.script;
    }
    if (this._scCache && this._scCache.name === name) return this._scCache.script;
    const res = await this._hass.callWS({ type: 'call_service', domain: 'ogg', service: 'studio_get_script', service_data: { name }, return_response: true });
    this._scCache = { name, script: res.response.script };
    return this._scCache.script;
  }

  async _scLoad() {
    const name = this._$('scsel').value;
    if (!name || !this._hass) { this._scCache = null; this._scShow(); return; }
    try { await this._scGet(name); } catch (_) { this._scCache = null; }
    this._scShow(true);
  }

  // The shape, where it is (playing, or where it will start) and the time.
  _scShow(repaint) {
    const $ = this._$;
    if (!$) return;
    const c = this._scCache && this._scCache.name === $('scsel').value ? this._scCache : null;
    const canvas = $('scheat');
    if (repaint || canvas.dataset.n !== (c ? c.name : '')) {
      canvas.dataset.n = c ? c.name : '';
      canvas.width = 160; canvas.height = 1;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 160, 1);
        if (c) heatmap(c.script, 160).forEach((v, i) => { ctx.fillStyle = heatColor(v); ctx.fillRect(i, 0, 1, 1); });
      }
    }
    const len = c ? duration(c.script) : 0;
    const p = this._playing && this._playing.kind === 'script' && c && (this._playing.src || this._playing.label) === c.name ? this._playing : null;
    let at = this._scFrom || 0;
    if (p) { at = performance.now() - p.t0; if (p.loop && len) at %= len; }
    at = Math.min(at, len);
    $('sccur').style.left = len ? `${(at / len) * 100}%` : '0';
    $('sccur').hidden = !c;
    $('sctime').textContent = c ? `${clock(at)} / ${clock(len)}${p ? '' : at ? ' · plays from here' : ''}` : '';
    clearTimeout(this._scTimer);
    if (p) this._scTimer = setTimeout(() => this._scShow(), 250);
  }

  async _playScript(from) {
    const name = this._$('scsel').value;
    if (!name) { this._toast('There are no saved scripts yet.'); return; }
    try {
      const s = await this._scGet(name);
      const v = isStroke(s) ? runScript(s, 'speed') : s;
      const at = Math.max(0, from ?? this._scFrom ?? 0);
      this._scFrom = 0;
      this._start({ kind: 'script', tracks: { a: v.actions, b: (v.channels && v.channels.V1 && v.channels.V1.actions) || v.actions, stroke: isStroke(s) ? s.actions : null }, loop: this._$('scloop').checked, src: name, label: name === LOADED_SRC ? (loadedScript() || {}).name || 'the loaded script' : name }, at);
      this._scShow(true);
    } catch (e) { this._toast(`Could not load the script: ${e.message || e}`); }
  }

  _start(play, from = 0) {
    clearInterval(this._liveTimer); this._liveTimer = null;
    this._pads = [0, 0]; this._showPads();
    const len = Math.max(...[play.tracks.a, play.tracks.b].map((t) => (t.length ? t[t.length - 1].at : 0)));
    const at = from > 0 && from < len ? from : 0;
    this._playing = { ...play, t0: performance.now() - at, from: at, len };
    this._resend();
    this._showPlay();
  }

  // Each toy's part, inside its limits, to Ogg.
  _resend() {
    const p = this._playing;
    if (!p) return;
    const devs = this._channels().map;
    if (!devs.length) { this._toast('No toy is connected: press Connect now.'); return; }
    const lim = this._st(this._studio);
    const limits = lim && lim.attributes.limits;
    for (const other of this._devices) if (!devs.some((x) => x.d === other) && this._online(other)) this._hass.callService('ogg', 'stop_script', { entity_id: other.stop }).catch(() => {});
    for (const { d, ch } of devs) {
      const L = limitsFor(limits, d.stop);
      let script, output;
      if (d.linear && !d.vibe) {
        let prev = null;
        // A vibration pattern or recording played as positions made the
        // stroker jump (a pulse is a jump); strokes that follow its feel instead.
        const src = p.tracks.stroke || strokesFor(p.tracks.a);
        script = { actions: src.map((a, i) => { const m = limitMove(L, { goal: a.pos, dur: i ? a.at - src[i - 1].at : 500 }, prev); prev = m.goal; return { at: a.at, pos: Math.round(m.goal) }; }) };
        output = 'linear';
      } else {
        const scale = (t) => t.map((a) => ({ at: a.at, pos: Math.round(a.pos * L.max / 100) }));
        const first = ch === 'b' ? p.tracks.b : p.tracks.a;
        script = { actions: scale(first) };
        if (d.dual) script.channels = { V1: { actions: scale(ch === 'ab' ? p.tracks.b : first) } };
        output = 'vibrate';
      }
      this._hass.callService('ogg', 'play_script', { entity_id: d.stop, script, output, speed: 1, loop: p.loop, ...(p.from ? { start_ms: Math.round(p.from) } : {}), ...(p.loop ? { max_seconds: 21600 } : {}) })
        .catch((e) => this._toast(`Could not play on ${d.name}: ${e.message || e}`));
    }
    this._toast(`Playing ${p.label}.`);
  }

  // ■ Stop all: everything Ogg plays, on every card and every toy (like the Play card's).
  _stopAll() {
    this._halt(true);
    this._toast('Everything stopped.');
    if (this._hass) this._hass.callService('ogg', 'studio_panic', {}, undefined, false).catch((e) => this._toast('Stop all did not reach Home Assistant: ' + (e.message || e)));
  }

  _halt(quiet) {
    clearInterval(this._liveTimer); this._liveTimer = null;
    this._strokeRelease();
    const had = this._playing || this._pads.some((v) => v > 0);
    this._playing = null;
    this._pads = [0, 0];
    if (this._$) this._showPads();
    if (had && this._hass) {
      for (const d of this._devices) if (this._online(d)) this._hass.callService('ogg', 'stop_script', { entity_id: d.stop }).catch(() => {});
    }
    if (this._$) this._showPlay();
    if (!quiet) this._toast('Stopped.');
  }

  // ------------------------------------------------------------ record and save
  // What plays now, as the two sliders' levels (0-100).
  _levelsNow() {
    const p = this._playing;
    if (!p) return [this._pads[0], this._pads[1]];
    let t = performance.now() - p.t0;
    if (p.loop) t %= Math.max(1, p.len); else if (t > p.len) { this._playing = null; this._showPlay(); return [0, 0]; }
    return [sampleAt(p.tracks.a, t), sampleAt(p.tracks.b, t)].map((v) => Math.round(v));
  }

  _recToggle() {
    if (this._rec) {
      const r = this._rec;
      this._rec = null;
      clearInterval(this._recTimer); this._recTimer = null;
      const t = Math.round(performance.now() - r.t0);
      if (!r.a.length || t < 1000) { this._toast('Nothing to keep yet: record a little longer.'); this._showPlay(); return; }
      // A vibration take ends at rest; a stroke ends where it was.
      const end = (track) => (r.stroke ? [...track, { at: t, pos: track[track.length - 1].pos }]
        : [...track, { at: t, pos: track[track.length - 1].pos }, { at: t + 1, pos: 0 }]);
      this._take = { version: '1.0', inverted: false, range: 100, actions: end(r.a), metadata: { type: r.stroke ? 'stroke' : 'vibration', creator: 'Ogg Easy' } };
      if (r.two) this._take.channels = { V1: { actions: end(r.b) } };
      this._takeLen = t;
      this._showPlay();
      return;
    }
    const stroke = this._kind === 'manual' && this._ctl === 'stroke' && !this._playing;
    const two = !stroke && this._channels().two;
    this._rec = { t0: performance.now(), a: [], b: [], two, stroke, last: null };
    this._recTimer = setInterval(() => {
      const r = this._rec;
      if (!r) return;
      const t = Math.round(performance.now() - r.t0);
      const [a, b] = r.stroke ? [Math.round(this._strokePos()), 0] : this._levelsNow();
      const key = `${a},${b}`;
      if (key !== r.last) {
        if (r.a.length && r.seen) { r.a.push({ at: r.seen, pos: r.a[r.a.length - 1].pos }); r.b.push({ at: r.seen, pos: r.b[r.b.length - 1].pos }); }
        r.a.push({ at: t, pos: a }); r.b.push({ at: t, pos: b }); r.last = key;
      }
      r.seen = t;
      this._$('recinfo').textContent = `Recording ${clock(t)}…`;
      this._$('rec').textContent = `■ Stop ${clock(t)}`;
    }, 100);
    this._showPlay();
  }

  // "His save" or "Hers save" (whoever is signed in, as Ogg's options say), and the date and time.
  _saveName() {
    const s = this._st(this._studio);
    const people = (s && s.attributes.settings && s.attributes.settings.people) || {};
    const me = this._rawHass && this._rawHass.user && this._rawHass.user.id;
    const who = people.his && people.his.id === me ? 'His' : people.hers && people.hers.id === me ? 'Hers' : 'My';
    return `${who} save · ${stamp()}`;
  }

  // The ↻ beside the count: search for toys (tap again to stop searching).
  async _search() {
    const s = this._st(this._searchSwitch);
    if (!s) return;
    const on = s.state !== 'on';
    try {
      await this._hass.callService('switch', on ? 'turn_on' : 'turn_off', { entity_id: this._searchSwitch });
      if (on) this._toast('Searching for toys: switch them on and keep them close.');
    } catch (e) { this._toast(e.message || String(e)); }
  }

  async _rename() {
    const sel = this._$('scsel');
    const name = sel.value;
    if (!name) { this._toast('There are no saved scripts yet.'); return; }
    if (name === LOADED_SRC) {
      const l = loadedScript();
      const next = l && (window.prompt('New name for the loaded script:', l.name) || '').trim();
      if (next && next !== l.name) setLoadedScript({ ...l, name: next });
      return;
    }
    const next = (window.prompt('New name for this script:', name) || '').trim();
    if (!next || next === name) return;
    try {
      await this._hass.callService('ogg', 'studio_rename', { name, new_name: next });
      this._wantScript = next;
      this._toast(`Renamed to "${next}".`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  // ------------------------------------------------------------ a loaded or made script
  // Shown under Manual's Script (and the video's script list) until saved.
  async _loadCode() {
    const text = this._$('codein').value;
    if (!text.trim()) { this._toast('Paste a code first.'); return; }
    try {
      this._useLoaded(await readScript(text));
      this._$('codein').value = '';
    } catch (e) { this._toast('Could not read the code: ' + (e.message || e)); }
  }

  async _loadFile() {
    const input = this._$('codefile');
    const f = input.files && input.files[0];
    if (!f) return;
    try { this._useLoaded(await readScript(await f.text(), f.name)); } catch (e) { this._toast(`Could not read ${f.name}: ${e.message || e}`); }
    input.value = '';
  }

  _useLoaded(l, how = 'Loaded') {
    setLoadedScript(l);
    this._wantScript = LOADED_SRC;
    this._scFrom = 0;
    this._refresh();
    this._$('loadname').value = l.name;
    this._toast(`${how} "${l.name}": play it from Manual → Script, or with a video below. Save it to keep it.`);
  }

  _showLoaded() {
    const $ = this._$;
    if (!$) return;
    const l = loadedScript();
    $('loadedbox').hidden = !l;
    if (!l) { this._loadedFor = null; return; }
    const kind = isStroke(l.script) ? 'stroke' : l.script.channels ? 'two motors' : 'vibration';
    $('loadedinfo').textContent = `📄 ${l.name} · ${clock(duration(l.script))} · ${kind} · not saved. It is under Manual → Script and in the video's script list.`;
    if (this._loadedFor !== l.script) { this._loadedFor = l.script; if (this.shadowRoot.activeElement !== $('loadname')) $('loadname').value = l.name; }
  }

  async _saveLoaded() {
    const l = loadedScript();
    if (!l) return;
    const name = (this._$('loadname').value || l.name).trim().slice(0, 60);
    if (!name) { this._toast('Give it a name first.'); return; }
    const over = this._names().includes(name);
    if (over && !window.confirm(`There is already a script called "${name}". Save over it?`)) return;
    try {
      await this._hass.callService('ogg', 'studio_save', { name, script: l.script });
      const wasPicked = this._$('scsel').value === LOADED_SRC;
      setLoadedScript(null);
      if (wasPicked) this._wantScript = name;
      this._scCache = null;
      this._toast(`${over ? 'Saved over' : 'Saved'} "${name}": it is under Script, and on the Queue card.`);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  // Make a script: relax / tease / edge, 60 minutes (lib/generate.js).
  _genSettings() {
    const $ = this._$;
    const seed = Math.floor(Number($('gseed').value));
    return { minutes: Number($('glen').value) || 60, intensity: Number($('gint').value) || 6, maxBpm: Number($('gbpm').value) || 130, seed: Number.isFinite(seed) && seed >= 0 ? seed % 4294967296 : 7 };
  }

  _genBuild() {
    const g = this._genSettings();
    const key = `${g.seed}|${g.intensity}|${g.maxBpm}|${g.minutes}`;
    if (!this._gen || this._gen.key !== key) {
      const raw = generateRelaxTeaseEdge(g.seed, g.intensity, g.maxBpm, g.minutes);
      const bad = checkScript(raw);
      if (bad) throw new Error(`the made script is wrong (${bad})`);
      const script = normalise({ ...raw, metadata: { type: 'stroke', title: `Relax tease edge ${g.minutes} min i${g.intensity}` } }, 'stroke', false);
      this._gen = { key, g, raw, script, peak: peakSpeed(raw.actions) };
    }
    return this._gen;
  }

  // The fastest move against a stroker's top speed (Ogg's speed limit uses the same figure).
  _genInfo() {
    const $ = this._$;
    let gen;
    try { gen = this._genBuild(); } catch (e) { $('ginfo').textContent = e.message || String(e); return; }
    const fast = gen.peak > LIMIT_FULL_SPEED;
    $('ginfo').className = `hint${fast ? ' warn' : ''}`;
    $('ginfo').textContent = `${clock(gen.raw.actions[gen.raw.actions.length - 1].at)} · ${gen.raw.actions.length} points · fastest move ${Math.round(gen.peak)} units/s.`
      + (fast ? ` A stroker tops out at about ${LIMIT_FULL_SPEED}, so the fastest strokes come out shorter: lower Max bpm or Intensity to stay inside it.` : ' Inside a stroker\'s top speed.');
  }

  // Settings changed: once made, the preview follows them.
  _genChanged() {
    this._genInfo();
    if (!this._genShown) return;
    clearTimeout(this._genT);
    this._genT = setTimeout(() => this._genPreview(), 150);
  }

  // Make it: the script's shape (position over time, coloured by speed) to look at first.
  _genMake() {
    try {
      this._genShown = true;
      this._genPreview();
      this._$('gload').disabled = false;
    } catch (e) { this._toast(e.message || String(e)); }
  }

  _genPreview() {
    const $ = this._$;
    let gen;
    try { gen = this._genBuild(); } catch (e) { this._toast(e.message || String(e)); return; }
    $('gprev').hidden = false;
    this._genInfo();
    const a = gen.raw.actions, len = a[a.length - 1].at;
    $('gmid').textContent = clock(len / 2);
    $('gend').textContent = clock(len);
    const c = $('gcan');
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(160, Math.round((c.clientWidth || 320) * dpr)), h = Math.round(72 * dpr);
    c.width = w; c.height = h;
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const pad = 4 * dpr, y = (pos) => pad + (100 - pos) / 100 * (h - 2 * pad);
    // Each column: the lowest and highest point it passes through.
    let i = 0;
    const at = (t) => {                       // the position at t (moves are straight lines)
      while (i < a.length - 1 && a[i + 1].at <= t) i++;
      const p = a[i], q = a[Math.min(a.length - 1, i + 1)];
      return q.at > p.at && t > p.at ? p.pos + (q.pos - p.pos) * Math.min(1, (t - p.at) / (q.at - p.at)) : p.pos;
    };
    for (let x = 0; x < w; x++) {
      const t0 = len * x / w, t1 = len * (x + 1) / w;
      let lo = at(t0), hi = lo;
      const speed = (j) => (j > 0 && j < a.length && a[j].at > a[j - 1].at ? Math.abs(a[j].pos - a[j - 1].pos) / (a[j].at - a[j - 1].at) * 1000 : 0);
      let fast = speed(i + 1);
      for (let j = i + 1; j < a.length && a[j].at < t1; j++) { lo = Math.min(lo, a[j].pos); hi = Math.max(hi, a[j].pos); fast = Math.max(fast, speed(j), speed(j + 1)); }
      const end = at(t1); lo = Math.min(lo, end); hi = Math.max(hi, end);
      ctx.fillStyle = heatColor(fast / 430);   // blue slow, red at the fastest edges
      ctx.fillRect(x, y(hi), 1, Math.max(dpr, y(lo) - y(hi)));
    }
  }

  // Load it: into the player, as a loaded script (not saved yet).
  _genLoad() {
    try {
      const { g, script } = this._genBuild();
      this._useLoaded({ name: `Relax tease edge ${g.minutes}m i${g.intensity} v${g.seed}${g.maxBpm !== 130 ? ` ${g.maxBpm}bpm` : ''}`, script }, 'Loaded');
      this._genInfo();
    } catch (e) { this._toast(e.message || String(e)); }
  }

  _genDownload() {
    try {
      const { g, raw } = this._genBuild();
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: relaxTeaseEdgeFile(g.intensity, g.minutes) });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { this._toast(e.message || String(e)); }
  }

  async _save() {
    if (!this._take) return;
    const name = this._saveName();
    try {
      await this._hass.callService('ogg', 'studio_save', { name, script: this._take });
      this._take = null;
      this._toast(`Saved "${name}": it is under Script, and on the Queue card.`);
    } catch (e) { this._toast(e.message || String(e)); }
    this._showPlay();
  }
}
