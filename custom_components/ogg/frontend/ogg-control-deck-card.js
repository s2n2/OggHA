/*
 * Ogg Control Deck Card v1.0.6
 * A mobile-first Home Assistant card for IntiHA v0.3.0b14 and Ogg v0.1.2.
 * No dependencies, no hard-coded device IDs, no external network requests.
 * Apache-2.0 license.
 */
(() => {
  const TAG = 'ogg-control-deck-card';
  if (customElements.get(TAG)) return;

  const CYCLE_OPTIONS = [1, 2, 3, 5, 10, 15, 30];
  const SPARK_INTERVAL_MS = 140;
  const SPARK_POINTS = 56; // About eight seconds of requested and device-reported intensity.
  // Mirror Ogg's software envelopes for a lightweight frontend-only preview.
  // Native device firmware may produce a different physical waveform.
  const sampleEnvelope = (name, phase) => {
    const position = ((Number(phase) % 1) + 1) % 1;
    const wave = (1 - Math.cos(2 * Math.PI * position)) / 2;
    switch (name) {
      case 'steady': return 1;
      case 'pulse': return position < 0.5 ? 1 : 0;
      case 'wave': case 'tide': return wave;
      case 'breath': return wave ** 1.5;
      case 'ramp': return position;
      case 'peak': return 1 - Math.abs(2 * position - 1);
      case 'heartbeat': return position < 0.13 ? 1 : position >= 0.25 && position < 0.4 ? 0.7 : 0;
      case 'double_pulse': return position < 0.2 || (position >= 0.35 && position < 0.55) ? 1 : 0;
      case 'steps': case 'step': return (Math.min(Math.floor(position * 4), 3) + 1) / 4;
      case 'echo': return [1, 0, 0.65, 0, 0.35, 0][Math.min(Math.floor(position * 6), 5)];
      case 'surge': case 'crest': return wave ** 0.5;
      case 'surf': return wave * (0.65 + 0.35 * Math.sin(6 * Math.PI * position) ** 2);
      case 'bounce': return Math.abs(Math.sin(2 * Math.PI * position)) * (1 - 0.4 * position);
      case 'massage': return 0.3 + 0.7 * wave;
      case 'tease': return position < 0.8 ? position * 1.25 : 0;
      case 'chachacha': return position < 0.14 || (position >= 0.25 && position < 0.39) || (position >= 0.5 && position < 0.64) ? 1 : 0;
      case 'tempo': return (position * 3) % 1 < 0.5 ? 1 : 0;
      default: return 1; // Unknown pattern: show its intensity setpoint, not invented movement.
    }
  };
  const INTENSITY_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const fmtPercent = (v) => `${Number(v)}%`;
  const PULSE_OPTIONS = [0.5, 1, 2, 3, 5, 10, 15, 30, 60];
  const VALID = (s) => !!s && s.state !== 'unknown' && s.state !== 'unavailable';
  const pretty = (v) => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
  const fmtSecs = (v) => `${Number(v)}s`;
  const icon = (name) => {
    const paths = {
      pulse: '<path d="M2 12h4l2-7 4 14 2-7h8"/>',
      stop: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
      power: '<path d="M12 2v10"/><path d="M5.6 5.6a9 9 0 1 0 12.8 0"/>',
      server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M12 7h6M12 17h6"/>',
      nodes: '<circle cx="12" cy="4" r="2.3"/><circle cx="5" cy="19" r="2.3"/><circle cx="19" cy="19" r="2.3"/><path d="m11 6-5 10m7-10 5 10M7 19h10"/>',
      timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
      chevron: '<path d="m7 10 5 5 5-5"/>',
      bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
      play: '<path d="m8 5 12 7-12 7z"/>',
      shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.91 1.91-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.5V20h-2.7v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.82.33l-.06.06-1.91-1.91.06-.06A1.65 1.65 0 0 0 7.9 15a1.65 1.65 0 0 0-1.5-1H6v-2.7h.4a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06 1.91-1.91.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.5V5h2.7v.4a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.82-.33l.06-.06 1.91 1.91-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.5 1h.1V14h-.1a1.65 1.65 0 0 0-1.5 1Z"/>',
      lock: '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.pulse}</svg>`;
  };

  const CSS = `
    :host{display:block;--ink:#f5f6ff;--muted:#9aa7c4;--surface:#111a30;--border:rgba(174,194,246,.13);font-family:var(--primary-font-family,Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif);color-scheme:dark}
    *{box-sizing:border-box}
    button,select{font:inherit;touch-action:manipulation}
    button{cursor:pointer}button:disabled,select:disabled{cursor:not-allowed;opacity:.43}
    button:focus-visible,select:focus-visible{outline:3px solid #8ee3ee;outline-offset:3px}
    ha-card{display:block;container-type:inline-size;border:1px solid #293552;border-radius:26px;overflow:hidden;background:#0a1122;box-shadow:0 20px 55px rgba(0,0,0,.22);color:var(--ink)}
    .deck{position:relative;padding:22px;overflow:hidden;isolation:isolate}
    .deck:before{content:"";position:absolute;z-index:-1;top:-130px;right:-110px;width:340px;height:340px;background:radial-gradient(circle,rgba(105,100,240,.24),transparent 67%);pointer-events:none}
    .deck:after{content:"";position:absolute;z-index:-1;top:130px;left:-145px;width:300px;height:350px;background:radial-gradient(circle,rgba(44,199,191,.09),transparent 70%);pointer-events:none}
    .hero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:22px}
    .hero-left{display:flex;align-items:center;gap:12px;min-width:0}
    .brand{flex:none;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:16px;background:linear-gradient(155deg,#6adfd4,#667ee8);box-shadow:0 8px 25px rgba(74,169,210,.2)}
    .brand svg{width:26px;height:26px;color:#091929;stroke-width:2.2}
    .eyebrow{font-size:10px;font-weight:850;letter-spacing:.19em;color:#9ce2d9;margin:0 0 3px;text-transform:uppercase}
    h2{font-size:24px;letter-spacing:-.045em;line-height:1.07;margin:0;font-weight:750;color:#f6f8ff}
    .subtitle{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.35}
    .live-badge{flex:none;display:flex;align-items:center;gap:5px;border:1px solid rgba(100,218,189,.23);background:rgba(40,124,115,.17);padding:8px 10px;border-radius:30px;font-size:11px;color:#9adbd1;white-space:nowrap}
    .live-badge .dot{width:7px;height:7px;border-radius:50%;background:#58d6b2;box-shadow:0 0 0 4px rgba(64,194,164,.11)}
    .live-badge.zero{border-color:rgba(174,194,246,.14);color:var(--muted);background:rgba(169,184,217,.08)}
    .live-badge.zero .dot{background:#72809f;box-shadow:none}
    .live-badge strong{font-variant-numeric:tabular-nums;font-weight:800;color:#e7fff9}
    /* Two compact tiles always share one row, even inside a narrow dashboard
       section. Split each tile into a title/gear row and a status/switch row:
       this avoids horizontal collisions without doubling the card height. */
    .masters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}
    .master{display:grid;grid-template-rows:auto auto;align-content:space-between;min-width:0;min-height:67px;gap:6px;padding:9px 11px;border-radius:16px;border:1px solid var(--border);background:rgba(255,255,255,.045)}
    .master-top,.master-bottom{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
    .master-label{display:flex;align-items:center;gap:5px;min-width:0}
    .master-label svg{width:14px;height:14px;color:#a9a0ff;flex:none}
    .master-name{font-size:12px;line-height:1.1;font-weight:720;letter-spacing:-.01em;white-space:nowrap;min-width:0}
    .master-status{font-size:10px;line-height:1.15;color:var(--muted);white-space:nowrap;min-width:0}
    .master-status.on{color:#83e1cd}
    .settings-link{display:grid;place-items:center;flex:none;width:27px;height:27px;color:#a8b8da;border:1px solid rgba(174,194,246,.18);border-radius:9px;background:rgba(255,255,255,.035);text-decoration:none;transition:color .15s ease,background .15s ease}
    .settings-link svg{width:16px;height:16px}
    .settings-link:hover{background:rgba(152,168,249,.14);color:#edf2ff}
    .settings-link:focus-visible{outline:3px solid #8ee3ee;outline-offset:2px}
    .toggle{position:relative;flex:none;width:46px;height:28px;border:1px solid #505e76;background:#2a3550;border-radius:99px;padding:0;transition:.18s ease;box-shadow:none}
    .toggle:after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#d4daed;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s ease,background .18s ease}
    .toggle[aria-checked="true"]{background:linear-gradient(110deg,#31c6b8,#54d4bc);border-color:transparent}
    .toggle[aria-checked="true"]:after{transform:translateX(18px);background:#072a2d}
    .master .toggle{width:40px;height:24px}
    .master .toggle:after{width:16px;height:16px;top:3px;left:3px}
    .master .toggle[aria-checked="true"]:after{transform:translateX(16px)}
    .toggle.small{width:43px;height:27px}.toggle.small:after{width:19px;height:19px}.toggle.small[aria-checked="true"]:after{transform:translateX(16px)}
    .pulse-zone{border:1px solid rgba(142,123,250,.24);border-radius:21px;padding:16px;background:linear-gradient(125deg,rgba(112,95,217,.16),rgba(42,136,157,.065));margin-bottom:20px}
    .pulse-top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}
    .small-label{display:flex;align-items:center;gap:8px;color:#dee2fa;font-size:13px;font-weight:650}
    .small-label svg{width:16px;height:16px;color:#c1aeff}
    .select-shell{position:relative;display:flex;align-items:center;min-width:0}
    .select-shell select{appearance:none;-webkit-appearance:none;width:100%;background:#26324e;border:1px solid #455475;border-radius:12px;color:#fff;min-height:39px;padding:8px 32px 8px 11px;line-height:1.2;font-size:14px;font-weight:700;outline:none;cursor:pointer}
    .select-shell select:focus-visible{outline:2px solid #8bdfef}
    .select-shell svg{position:absolute;pointer-events:none;right:10px;width:13px;height:13px;color:#a6b5d7}
    .global-select{width:115px;flex:none}
    .pulse-actions{display:grid;grid-template-columns:minmax(0,1fr) 106px;gap:9px}
    .cta{min-height:54px;border:0;border-radius:15px;display:flex;align-items:center;justify-content:center;gap:9px;font-size:14px;font-weight:780;letter-spacing:-.01em;transition:transform .12s ease,filter .15s ease}
    .cta:active:not(:disabled),.device-action:active:not(:disabled){transform:scale(.98)}
    .cta svg{width:19px;height:19px}
    .cta.primary{color:#081b23;background:linear-gradient(115deg,#80f3d7,#7bccfa);box-shadow:0 5px 23px rgba(66,223,214,.14)}
    .cta.primary:hover:not(:disabled){filter:brightness(1.075)}
    .cta.stop-all{color:#ffbcc2;background:rgba(244,100,118,.09);border:1px solid rgba(239,115,134,.26)}
    .section-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 2px 11px}
    .section-head h3{font-size:14px;letter-spacing:-.01em;color:#e8edff;margin:0;font-weight:760}
    .section-head span{font-size:11px;color:var(--muted);text-align:right}
    .device-list{display:flex;flex-direction:column;gap:10px}
    .device{border:1px solid var(--border);border-radius:19px;padding:14px;background:linear-gradient(145deg,rgba(255,255,255,.056),rgba(255,255,255,.025));transition:border-color .15s ease,background .15s ease}
    .device.running{border-color:rgba(104,227,206,.37);background:linear-gradient(145deg,rgba(52,194,174,.1),rgba(115,107,215,.045))}
    .device-top{display:grid;grid-template-columns:36px minmax(0,1fr);grid-template-rows:auto auto;align-items:start;gap:7px 9px;margin-bottom:12px;min-width:0}
    .device-avatar{grid-column:1;grid-row:1/3}
    .device-heading{grid-column:2;grid-row:1}
    .permission{grid-column:2;grid-row:2;justify-self:start}
    .device-avatar{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:12px;background:#263252;border:1px solid rgba(158,170,251,.18)}
    .device-avatar svg{color:#a7b7f8;width:19px;height:19px}
    .device.running .device-avatar{background:rgba(67,190,169,.16);border-color:rgba(67,190,169,.25)}
    .device.running .device-avatar svg{color:#80ebd6}
    .device-heading{min-width:0;flex:1}
    .device-name-row{display:grid;grid-template-columns:minmax(0,1fr) 82px;align-items:center;gap:9px;min-width:0}
    .sparkline{height:31px;width:82px;min-width:0;flex:none;display:flex;align-items:center;justify-content:center;padding:3px 5px;border:1px solid rgba(103,213,194,.16);border-radius:10px;background:linear-gradient(110deg,rgba(65,211,184,.07),rgba(109,128,238,.065));color:#79e4d3;overflow:hidden}
    .sparkline svg{width:100%;height:100%;display:block;overflow:visible}
    .sparkline .spark-fill{fill:rgba(79,219,189,.11)}
    .sparkline .spark-line{stroke:rgba(147,183,209,.65);stroke-width:1.6;stroke-dasharray:3 2;stroke-linecap:round;stroke-linejoin:round;fill:none;vector-effect:non-scaling-stroke}
    .sparkline .spark-actual{stroke:#80ebdb;stroke-width:2.15;stroke-linecap:round;stroke-linejoin:round;fill:none;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 2px rgba(88,229,202,.45))}
    .sparkline .spark-dot{fill:#c3fff1;stroke:#59d3b8;stroke-width:1.1}
    .sparkline.idle{opacity:.48}
    .device-heading strong{display:-webkit-box;min-width:0;color:#f5f7ff;font-size:15px;line-height:1.25;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;letter-spacing:-.013em}
    .device-caption{display:block;color:var(--muted);font-size:11px;margin-top:3px;font-variant-numeric:tabular-nums}
    .permission{border:1px solid rgba(143,163,200,.2);border-radius:20px;background:rgba(255,255,255,.045);color:#92a2be;font-size:10px;font-weight:800;letter-spacing:.01em;min-height:31px;padding:5px 10px;white-space:nowrap;display:flex;align-items:center;gap:5px;max-width:120px}
    .permission svg{width:12px;height:12px}
    .permission.allowed{color:#8ddccc;background:rgba(56,200,170,.08);border-color:rgba(56,200,170,.17)}
    .permission.blocked{color:#efbbbf;background:rgba(245,103,119,.09);border-color:rgba(245,103,119,.2)}
    .device-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 45px;gap:8px;margin-bottom:12px}
    .run-wrap{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #364563;background:#17243e;border-radius:13px;min-height:45px;padding:7px 9px 7px 12px}
    .run-wrap span{font-size:12px;font-weight:720;color:#d2dcf3}
    .device-action{border:1px solid rgba(118,200,239,.35);background:#24395a;color:#bef2ff;border-radius:13px;display:flex;align-items:center;justify-content:center;gap:7px;min-height:45px;font-size:12px;font-weight:760;transition:.12s ease}
    .device-action.pulse svg{width:17px;height:17px}
    .device-action.stop{color:#e9adb7;background:rgba(246,104,121,.08);border-color:rgba(246,104,121,.2)}
    .device-action.stop svg{width:17px;height:17px}
    .config-grid{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(0,.9fr) minmax(0,.77fr);gap:9px}
    .control-group{display:flex;flex-direction:column;gap:5px;min-width:0}
    .control-group label{color:#99a9c5;font-weight:620;font-size:10.5px;line-height:1.1;letter-spacing:.01em;margin-left:3px}
    .control-group .select-shell select{font-size:13px;min-height:40px;font-weight:650;background:#17233c;border-color:#364563}
    .control-group .select-shell svg{right:10px}
    .empty{border:1px dashed #3b4967;border-radius:17px;padding:23px 18px;text-align:center;background:rgba(255,255,255,.027);display:none}
    .empty svg{color:#97a9e1;width:27px;height:27px}
    .empty strong{display:block;margin:8px 0 4px;color:#e7edff;font-size:14px}
    .empty p{margin:0;font-size:12px;line-height:1.45;color:var(--muted)}
    .foot{display:flex;align-items:center;justify-content:center;gap:6px;padding-top:15px;color:#8290ad;font-size:10px;text-align:center;line-height:1.4}
    .foot svg{height:12px;width:12px}
    .toast{display:none;position:relative;background:#51273a;color:#ffe1e7;border:1px solid #a95974;border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;line-height:1.35}
    /* All size rules follow the actual card container, not browser width. */
    @container (max-width:520px){.deck{padding:15px}.hero{margin-bottom:16px}.brand{width:42px;height:42px;border-radius:13px}h2{font-size:22px}.master{padding:9px 10px;min-height:65px}.master-name{font-size:11.5px}.pulse-zone{padding:12px}.device{padding:12px}.device-main{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 43px;gap:7px}.run-wrap{padding:5px 7px 5px 9px}.run-wrap span{font-size:11px}.live-badge{padding:7px 8px;font-size:10px}.permission{font-size:9px;padding:5px 7px}.pulse-actions{grid-template-columns:minmax(0,1fr) 95px}.config-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.control-group.pattern-setting{grid-column:1/-1}}
    @container (max-width:355px){.hero{flex-wrap:wrap}.live-badge{margin-left:54px}.global-select{width:100px}.pulse-top{gap:8px}.small-label{font-size:12px;gap:5px}.master{padding:8px 8px}.master-label svg{width:12px;height:12px}.master-name{font-size:11px}.settings-link{width:24px;height:24px}.settings-link svg{width:14px;height:14px}.device-main{grid-template-columns:minmax(0,1fr) 80px 42px}.device-name-row{grid-template-columns:minmax(0,1fr) 72px;gap:6px}}
    @container (max-width:285px){.master-label svg{display:none}.master-name{font-size:10.5px}.master{padding:8px 7px}.masters{gap:6px}.master-status{font-size:9px}}
    @media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;animation:none!important}}
  `;

  class OggControlDeckCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._registryEntities = null;
      this._registryDevices = null;
      this._autoCache = null;
      this._hass = null;
      this._loadingRegistry = false;
      this._loadedFor = null;
      this._elementMap = new Map();
      this._refreshRequest = null;
      this._unsubRegistry = [];
      this._subscribedConnection = null;
      this._busy = new Set();
      this._sparkTimer = null;
    }

    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error('Invalid Ogg Control Deck configuration');
      if (config.devices !== undefined && !Array.isArray(config.devices)) {
        throw new Error('devices must be a list of entity mappings');
      }
      this._config = { title: 'Control deck', ...config };
      this._createShell();
      this._schedule();
    }

    set hass(hass) {
      const old = this._hass;
      this._hass = hass;
      if (old?.connection !== hass?.connection) {
        this._loadedFor = null;
        this._registryEntities = null;
        this._registryDevices = null;
        this._autoCache = null;
        this._detachRegistry();
      }
      this._loadRegistry();
      this._subscribeRegistry();
      this._schedule();
    }

    connectedCallback() {
      this._startSparkTimer();
      this._loadRegistry();
      this._subscribeRegistry();
      this._schedule();
    }

    disconnectedCallback() {
      this._stopSparkTimer();
      this._detachRegistry();
      if (this._refreshRequest !== null) cancelAnimationFrame(this._refreshRequest);
      this._refreshRequest = null;
    }

    getCardSize() { return 6 + Math.max(0, this._elementMap.size) * 3; }
    getGridOptions() { return { columns: 12, rows: 'auto', min_columns: 6 }; }
    static getStubConfig() { return { title: 'Control deck' }; }

    _createShell() {
      if (this._shell) {
        this.shadowRoot.querySelector('#title').textContent = this._config.title;
        return;
      }
      const style = document.createElement('style');
      style.textContent = CSS;
      this.shadowRoot.appendChild(style);
      const root = document.createElement('ha-card');
      root.innerHTML = `
        <div class="deck">
          <header class="hero">
            <div class="hero-left"><div class="brand">${icon('pulse')}</div>
              <div><div class="eyebrow">INTIHA × OGG</div><h2 id="title">Control deck</h2><div class="subtitle">Your devices, all in one place</div></div>
            </div>
            <div class="live-badge zero" id="live"><span class="dot"></span><strong id="count">0</strong> connected</div>
          </header>
          <section class="masters" aria-label="Server controls">
            <div class="master"><div class="master-top"><div class="master-label">${icon('server')}<span class="master-name">HA Server</span></div><a id="server-settings" class="settings-link" href="/config/integrations/integration/intiha" aria-label="Open IntiHA settings" title="IntiHA settings">${icon('settings')}</a></div><div class="master-bottom"><span class="master-status" id="server-status">Loading</span><button id="server" class="toggle" type="button" role="switch" aria-label="HA Server" aria-checked="false"></button></div></div>
            <div class="master"><div class="master-top"><div class="master-label">${icon('nodes')}<span class="master-name">Ogg</span></div><a id="ogg-settings" class="settings-link" href="/config/integrations/integration/ogg" aria-label="Open Ogg settings" title="Ogg settings">${icon('settings')}</a></div><div class="master-bottom"><span class="master-status" id="ogg-status">Loading</span><button id="ogg" class="toggle" type="button" role="switch" aria-label="Ogg controller" aria-checked="false"></button></div></div>
          </section>
          <div class="toast" id="toast" role="status" aria-live="polite"></div>
          <section class="pulse-zone" aria-label="Global pulse controls">
            <div class="pulse-top"><div class="small-label">${icon('timer')}<span>Pulse duration</span></div>
              <div class="select-shell global-select"><select id="duration" aria-label="Pulse duration for all devices"></select>${icon('chevron')}</div>
            </div>
            <div class="pulse-actions">
              <button id="pulse-all" class="cta primary" type="button">${icon('pulse')}<span>Pulse all</span></button>
              <button id="stop-all" class="cta stop-all" type="button">${icon('stop')}<span>Stop all</span></button>
            </div>
          </section>
          <div class="section-head"><h3>Connected devices</h3><span id="list-subtitle">Live from Ogg</span></div>
          <div id="devices" class="device-list"></div>
          <div id="empty" class="empty">${icon('nodes')}<strong id="empty-title">No connected devices</strong><p id="empty-detail">Devices appear here when Ogg connects to them.</p></div>
          <div class="foot">${icon('shield')}<span>Connections and commands by IntiHA & Ogg · card v0.1.13</span></div>
        </div>`;
      this.shadowRoot.appendChild(root);
      this._shell = root;
      this._refs = {};
      for (const id of ['title', 'live', 'count', 'server', 'ogg', 'server-settings', 'ogg-settings', 'server-status', 'ogg-status', 'duration', 'pulse-all', 'stop-all', 'devices', 'empty', 'empty-title', 'empty-detail', 'list-subtitle', 'toast']) {
        this._refs[id] = root.querySelector(`#${id}`);
      }
      this._refs.title.textContent = this._config.title;
      this._refs.server.addEventListener('click', () => this._masterToggle('server'));
      this._refs.ogg.addEventListener('click', () => this._masterToggle('ogg'));
      for (const id of ['server-settings', 'ogg-settings']) {
        this._refs[id].addEventListener('click', (event) => this._openSettings(event));
      }
      this._refs.duration.addEventListener('change', (e) => this._setNumber(this._hub.pulse_duration, e.target.value));
      this._refs['pulse-all'].addEventListener('click', () => this._press(this._hub.pulse_all));
      this._refs['stop-all'].addEventListener('click', () => this._press(this._hub.stop_all));
    }

    _schedule() {
      if (!this._shell || !this._hass || this._refreshRequest !== null) return;
      this._refreshRequest = requestAnimationFrame(() => {
        this._refreshRequest = null;
        if (this.isConnected) this._update();
      });
    }

    async _loadRegistry() {
      const hass = this._hass;
      if (!hass || !hass.callWS || this._loadingRegistry || this._loadedFor === hass.connection) return;
      this._loadingRegistry = true;
      try {
        const [entityResult, deviceResult] = await Promise.allSettled([
          hass.callWS({ type: 'config/entity_registry/list' }),
          hass.callWS({ type: 'config/device_registry/list' }),
        ]);
        if (this._hass?.connection !== hass.connection) return;
        if (entityResult.status === 'rejected') throw entityResult.reason;
        this._registryEntities = Array.isArray(entityResult.value) ? entityResult.value : [];
        this._registryDevices = deviceResult.status === 'fulfilled' && Array.isArray(deviceResult.value) ? deviceResult.value : [];
        this._autoCache = null;
        this._loadedFor = hass.connection;
        this._registryError = null;
      } catch (err) {
        this._registryError = String(err?.message || err);
        this._loadedFor = hass.connection; // Avoid retry storms on every state update.
        // Manual 'devices' YAML mapping still works when registry access is restricted.
      } finally {
        this._loadingRegistry = false;
        this._schedule();
      }
    }

    _subscribeRegistry() {
      if (!this.isConnected || !this._hass?.connection?.subscribeEvents || this._subscribedConnection === this._hass.connection) return;
      const connection = this._hass.connection;
      this._subscribedConnection = connection;
      for (const eventName of ['entity_registry_updated', 'device_registry_updated']) {
        this._hass.connection.subscribeEvents(() => {
          this._loadedFor = null;
          this._loadRegistry();
        }, eventName).then((unsubscribe) => {
          if (this.isConnected && this._subscribedConnection === connection) this._unsubRegistry.push(unsubscribe);
          else unsubscribe();
        }).catch(() => {});
      }
    }

    _detachRegistry() {
      this._subscribedConnection = null;
      for (const unsubscribe of this._unsubRegistry.splice(0)) {
        try { unsubscribe(); } catch (_) { /* old connection */ }
      }
    }

    _nameKey(name) {
      const key = String(name || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      // Generic product families do not establish individual identity.
      return ['device', 'we vibe', 'we vibe 8bit', 'bluetooth device', 'intiha device'].includes(key) ? '' : key;
    }

    _autoEntities() {
      if (this._autoCache) return this._autoCache;
      const groups = new Map();
      const hub = {};
      const entityList = this._registryEntities || [];
      const knownKeys = {
        connected: ':connected', run: ':run', pulse: ':pulse', stop: ':stop',
        pattern: ':pattern', period: ':period', intensity: ':intensity', commands: ':connect_this_device',
        status: ':status', battery: ':battery', remaining: ':remaining',
      };
      const hubKeys = {
        enabled: ':enabled', pulse_duration: ':pulse_duration',
        pulse_all: ':pulse_all', stop_all: ':stop_all',
      };
      const deviceNames = new Map((this._registryDevices || []).map((device) => [device.id, device.name_by_user || device.name || '']));
      for (const entry of entityList) {
        if (entry.disabled_by || !entry.entity_id) continue;
        const uid = String(entry.unique_id || '');
        const prefix = entry.entity_id.split('.')[0];
        if (entry.platform === 'intiha' && prefix === 'switch' && uid.endsWith('_server_enabled')) {
          hub.inti_server = entry.entity_id;
          continue;
        }
        if (entry.platform !== 'ogg') continue;
        const segments = uid.split(':');
        const key = segments[segments.length - 1];
        if (segments.length === 2 && hubKeys[key]) {
          hub[key] = entry.entity_id;
          continue;
        }
        if (segments.length < 3 || !entry.device_id) continue;
        if (!groups.has(entry.device_id)) groups.set(entry.device_id, { id: entry.device_id, name: deviceNames.get(entry.device_id) || '' });
        const group = groups.get(entry.device_id);
        for (const [field, suffix] of Object.entries(knownKeys)) {
          if (uid.endsWith(suffix) && key === suffix.slice(1)) { group[field] = entry.entity_id; break; }
        }
      }
      // IntiHA's private feedback sensors remain server-local, outside Ogg's
      // standard Buttplug protocol. Match only a uniquely named HA device;
      // otherwise leave feedback absent instead of displaying another motor's
      // activity. Explicit card mappings can resolve different aliases.
      const feedbackByName = new Map();
      for (const entry of entityList) {
        if (entry.disabled_by || entry.platform !== 'intiha' || !entry.entity_id?.startsWith('sensor.')
            || !String(entry.unique_id || '').endsWith('_reported_intensity') || !entry.device_id) continue;
        const registeredName = deviceNames.get(entry.device_id) || '';
        const key = this._nameKey(registeredName);
        if (!key) continue;
        if (!feedbackByName.has(key)) feedbackByName.set(key, []);
        feedbackByName.get(key).push(entry.entity_id);
      }
      const devices = [...groups.values()].filter((d) => d.connected && (d.pulse || d.run));
      for (const d of devices) {
        const matches = feedbackByName.get(this._nameKey(d.name)) || [];
        if (matches.length === 1) d.reported_intensity = matches[0];
      }
      this._autoCache = { hub, devices };
      return this._autoCache;
    }

    _resolve() {
      const detected = this._autoEntities();
      const c = this._config || {};
      const hub = {
        inti_server: c.inti_server || detected.hub.inti_server || 'switch.intiha_server_enabled',
        enabled: c.ogg_enabled || detected.hub.enabled || 'switch.ogg_enabled',
        pulse_duration: c.pulse_duration || detected.hub.pulse_duration || 'number.ogg_pulse_duration',
        pulse_all: c.pulse_all || detected.hub.pulse_all || 'button.ogg_pulse_all',
        stop_all: c.stop_all || detected.hub.stop_all || 'button.ogg_stop_all',
      };
      const configured = c.devices || [];
      const devices = configured.length ? configured.map((d, i) => ({ id: `config-${i}`, ...d })) : detected.devices;
      // Optional alias -> IntiHA entity mapping, useful when Ogg and IntiHA
      // call the same device different names. Never change Ogg's routing.
      const overrides = c.reported_intensity_entities || {};
      for (const d of devices) {
        const mapped = overrides[d.name] || overrides[d.connected] || overrides[d.id];
        if (typeof mapped === 'string' && mapped.startsWith('sensor.')) d.reported_intensity = mapped;
      }
      return { hub, devices };
    }

    _state(entityId) { return entityId ? this._hass?.states?.[entityId] : undefined; }
    _available(entityId) {
      const state = this._state(entityId);
      if (!state || state.state === 'unavailable') return false;
      // Home Assistant buttons are often 'unknown' until their first press.
      // Unknown is normal for a stateless button, unlike a switch or select.
      return entityId.startsWith('button.') || state.state !== 'unknown';
    }
    _friendlyName(device) {
      if (device.name) return device.name;
      const sensor = this._state(device.connected) || this._state(device.run);
      const friendly = String(sensor?.attributes?.friendly_name || 'Device');
      return friendly.replace(/\s+(Connected|Run|Pulse)$/i, '') || 'Device';
    }

    _update() {
      const { hub, devices } = this._resolve();
      this._hub = hub;
      const r = this._refs;
      const server = this._state(hub.inti_server);
      const ogg = this._state(hub.enabled);
      this._setSwitch(r.server, server, 'HA Server');
      this._setSwitch(r.ogg, ogg, 'Ogg controller');
      this._setStatus(r['server-status'], server);
      this._setStatus(r['ogg-status'], ogg);

      const duration = this._state(hub.pulse_duration);
      this._fillOptions(r.duration, PULSE_OPTIONS, Number(duration?.state), fmtSecs, 'Select duration');
      r.duration.disabled = !VALID(duration);
      const visible = devices.filter((d) => {
        const state = this._state(d.connected);
        // Ogg's connected binary_sensor is authoritative for actual command reachability.
        return state?.state === 'on';
      });
      visible.sort((a, b) => this._friendlyName(a).localeCompare(this._friendlyName(b)));
      r.count.textContent = visible.length;
      r.live.classList.toggle('zero', visible.length === 0);
      r['list-subtitle'].textContent = visible.length === 1 ? '1 available' : `${visible.length} available`;
      r['pulse-all'].disabled = !this._available(hub.pulse_all) || visible.length === 0 || ogg?.state !== 'on';
      r['stop-all'].disabled = !this._available(hub.stop_all);
      this._reconcileDevices(visible);
      this._startSparkTimer();

      const empty = r.empty;
      empty.style.display = visible.length ? 'none' : 'block';
      if (!visible.length) {
        r['empty-title'].textContent = 'No connected devices';
        r['empty-detail'].textContent = !this._registryEntities && !this._config?.devices?.length && this._registryError
          ? 'Automatic discovery was blocked. See the README for manual entity mapping.'
          : ogg?.state !== 'on' ? 'Switch on Ogg to see devices it can control.'
            : 'Known devices will appear automatically as soon as Ogg reports them connected.';
      }
    }

    _setSwitch(button, state, label) {
      const on = state?.state === 'on';
      button.setAttribute('aria-checked', String(on));
      button.setAttribute('aria-label', `${label}: ${on ? 'on' : 'off'}`);
      button.disabled = !VALID(state);
      button.title = button.disabled ? `${label} entity unavailable` : `Turn ${label} ${on ? 'off' : 'on'}`;
    }

    _setStatus(node, state) {
      const on = state?.state === 'on';
      node.textContent = !VALID(state) ? 'Unavailable' : on ? 'Enabled' : 'Off';
      node.classList.toggle('on', on);
    }

    _fillOptions(select, choices, value, formatter, placeholder) {
      // Never replace the selected control while it is open, especially on mobile.
      const current = [...choices];
      if (Number.isFinite(value) && !current.some((v) => Math.abs(Number(v) - value) < .001)) current.push(value);
      current.sort((a, b) => Number(a) - Number(b));
      const key = JSON.stringify(current);
      if (select.dataset.key !== key) {
        const fragment = document.createDocumentFragment();
        for (const choice of current) {
          const option = document.createElement('option');
          option.value = String(choice);
          option.textContent = formatter(choice);
          fragment.appendChild(option);
        }
        select.replaceChildren(fragment);
        select.dataset.key = key;
      }
      if (document.activeElement !== select && this.shadowRoot.activeElement !== select) {
        if (Number.isFinite(value)) select.value = String(current.find((v) => Math.abs(v - value) < .001));
        else select.selectedIndex = -1;
      }
      select.title = placeholder;
    }

    _reconcileDevices(visible) {
      const parent = this._refs.devices;
      const keep = new Set(visible.map((d) => String(d.id)));
      for (const [id, view] of this._elementMap) {
        if (!keep.has(id)) { view.root.remove(); this._elementMap.delete(id); }
      }
      for (const d of visible) {
        let view = this._elementMap.get(String(d.id));
        if (!view) {
          view = this._makeDevice(d);
          this._elementMap.set(String(d.id), view);
        }
        // Do not move an already correctly positioned node: that would close
        // an open native dropdown whenever Home Assistant updates a sensor.
        const position = visible.indexOf(d);
        if (parent.children[position] !== view.root) {
          parent.insertBefore(view.root, parent.children[position] || null);
        }
        this._refreshDevice(d, view);
      }
    }

    _makeDevice(device) {
      const el = document.createElement('article');
      el.className = 'device';
      el.innerHTML = `
        <div class="device-top">
          <div class="device-avatar">${icon('bolt')}</div>
          <div class="device-heading"><div class="device-name-row"><strong data-role="name"></strong><div data-role="sparkline" class="sparkline idle" title="Dashed: target. Bright: device-reported intensity when available; not motor RPM." aria-hidden="true"><svg viewBox="0 0 96 30" preserveAspectRatio="none"><path data-role="spark-fill" class="spark-fill"></path><path data-role="spark-line" class="spark-line"></path><path data-role="spark-actual" class="spark-actual"></path><circle data-role="spark-dot" class="spark-dot" r="2.2" cx="95" cy="27"></circle></svg></div></div><span data-role="caption" class="device-caption">Connected · Ready</span></div>
          <button data-role="permission" class="permission allowed" type="button" aria-label="Toggle command permission">${icon('shield')}<span data-role="permission-text">Allowed</span></button>
        </div>
        <div class="device-main">
          <div class="run-wrap"><span>Run</span><button data-role="run" class="toggle small" type="button" role="switch" aria-label="Continuous run" aria-checked="false"></button></div>
          <button data-role="pulse" class="device-action pulse" type="button">${icon('pulse')}<span>Pulse</span></button>
          <button data-role="stop" class="device-action stop" type="button" title="Stop device" aria-label="Stop device">${icon('stop')}</button>
        </div>
        <div class="config-grid">
          <div class="control-group pattern-setting"><label>Pattern</label><div class="select-shell"><select data-role="pattern" aria-label="Device pattern"></select>${icon('chevron')}</div></div>
          <div class="control-group"><label>Cycle time</label><div class="select-shell"><select data-role="cycle" aria-label="Pattern cycle time"></select>${icon('chevron')}</div></div>
          <div class="control-group"><label>Intensity</label><div class="select-shell"><select data-role="intensity" aria-label="Device intensity"></select>${icon('chevron')}</div></div>
        </div>`;
      const refs = {};
      for (const part of ['name','caption','sparkline','spark-fill','spark-line','spark-actual','spark-dot','permission','permission-text','run','pulse','stop','pattern','cycle','intensity']) refs[part] = el.querySelector(`[data-role="${part}"]`);
      const view = { root: el, refs, device, spark: { points: [], actualPoints: [], active: false, startedAt: 0, pattern: 'steady', period: 2, intensity: 0, reportedEntity: null, reportedLevel: null } };
      this._paintSpark(view);
      refs.permission.addEventListener('click', () => this._togglePermission(view.device));
      refs.run.addEventListener('click', () => this._toggleRun(view.device));
      refs.pulse.addEventListener('click', () => this._press(view.device.pulse));
      refs.stop.addEventListener('click', () => this._press(view.device.stop));
      refs.pattern.addEventListener('change', (event) => this._select(view.device.pattern, event.target.value));
      refs.cycle.addEventListener('change', (event) => this._setNumber(view.device.period, event.target.value));
      refs.intensity.addEventListener('change', (event) => this._setNumber(view.device.intensity, event.target.value));
      return view;
    }

    _refreshDevice(device, view) {
      view.device = device;
      const r = view.refs;
      const name = this._friendlyName(device);
      r.name.textContent = name;
      const status = this._state(device.status)?.state;
      const running = this._state(device.run)?.state === 'on';
      const pulsing = status === 'pulse';
      view.root.classList.toggle('running', running || pulsing);
      const graph = view.spark;
      const active = running || pulsing || status === 'continuous';
      if (active && !graph.active) graph.startedAt = performance.now();
      graph.active = active;
      graph.pattern = String(this._state(device.pattern)?.state || 'steady');
      const cycleSeconds = Number(this._state(device.period)?.state);
      graph.period = Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? cycleSeconds : 2;
      const power = Number(this._state(device.intensity)?.state);
      graph.intensity = Number.isFinite(power) ? Math.min(100, Math.max(0, power)) : 0;
      graph.reportedEntity = device.reported_intensity || null;
      const feedback = this._state(graph.reportedEntity);
      const feedbackLevel = Number(feedback?.state);
      const lastRead = Date.parse(feedback?.attributes?.last_read || feedback?.last_updated || '');
      // A displayed zero must mean a *fresh* GATT report. Unavailable, stale,
      // unknown or another server's sensor must never masquerade as zero.
      graph.reportedAt = lastRead;
      graph.reportedLevel = VALID(feedback) && Number.isFinite(feedbackLevel)
        && feedbackLevel >= 0 && feedbackLevel <= 100
        && Number.isFinite(lastRead) && (Date.now() - lastRead) < 5000
        ? feedbackLevel : null;
      r.sparkline.title = graph.reportedLevel === null
        ? 'Dashed: target pattern. Device-reported feedback unavailable or unmapped.'
        : `Dashed target · solid device-reported: ${graph.reportedLevel}% (not physical motor RPM)`;
      r.sparkline.classList.toggle('idle', !active && graph.reportedLevel === null);
      this._paintSpark(view);
      const remaining = Number(this._state(device.remaining)?.state);
      const battery = Number(this._state(device.battery)?.state);
      const details = [pulsing ? 'Pulsing' : running ? 'Running' : 'Connected · Ready'];
      if (pulsing && Number.isFinite(remaining) && remaining > 0) details.push(`${remaining.toFixed(1)}s left`);
      if (Number.isFinite(battery) && this._available(device.battery)) details.push(`${Math.round(battery)}% battery`);
      r.caption.textContent = details.join('  ·  ');
      const permitted = !device.commands || this._state(device.commands)?.state === 'on';
      const permissionAvailable = !!device.commands && this._available(device.commands);
      r.permission.style.display = device.commands ? 'inline-flex' : 'none';
      r.permission.classList.toggle('allowed', permitted);
      r.permission.classList.toggle('blocked', !permitted);
      r['permission-text'].textContent = permitted ? 'Allowed' : 'Blocked';
      r.permission.disabled = !permissionAvailable;
      r.permission.title = 'Ogg command permission (does not disconnect Bluetooth)';
      r.permission.setAttribute('aria-label', `${name}: ${permitted ? 'block' : 'allow'} Ogg commands`);
      this._setSwitch(r.run, this._state(device.run), `${name} Run`);
      r.run.disabled = !permitted || !this._available(device.run);
      r.pulse.disabled = !permitted || !this._available(device.pulse);
      r.stop.disabled = !this._available(device.stop);
      r.pulse.setAttribute('aria-label', `Pulse ${name}`);
      r.stop.setAttribute('aria-label', `Stop ${name}`);
      const pattern = this._state(device.pattern);
      const patternSelect = r.pattern;
      const options = Array.isArray(pattern?.attributes?.options) ? pattern.attributes.options : [];
      const optionsKey = JSON.stringify(options);
      if (patternSelect.dataset.key !== optionsKey) {
        patternSelect.replaceChildren(...options.map((opt) => {
          const option = document.createElement('option');
          option.value = String(opt);
          option.textContent = pretty(opt);
          return option;
        }));
        patternSelect.dataset.key = optionsKey;
      }
      if (this.shadowRoot.activeElement !== patternSelect) patternSelect.value = pattern?.state || '';
      patternSelect.disabled = !VALID(pattern) || !options.length;
      patternSelect.setAttribute('aria-label', `${name} pattern`);
      const period = this._state(device.period);
      this._fillOptions(r.cycle, CYCLE_OPTIONS, Number(period?.state), fmtSecs, `${name} cycle time`);
      r.cycle.disabled = !VALID(period);
      r.cycle.setAttribute('aria-label', `${name} pattern cycle time`);
      const intensity = this._state(device.intensity);
      this._fillOptions(r.intensity, INTENSITY_OPTIONS, Number(intensity?.state), fmtPercent, `${name} intensity`);
      r.intensity.disabled = !VALID(intensity) || !permitted;
      r.intensity.setAttribute('aria-label', `${name} intensity`);
    }

    _startSparkTimer() {
      if (!this.isConnected || this._sparkTimer !== null || !this._elementMap.size) return;
      // One shared timer for the whole card, never one timer per device.
      this._sparkTimer = setInterval(() => this._tickSparks(), SPARK_INTERVAL_MS);
    }

    _stopSparkTimer() {
      if (this._sparkTimer !== null) clearInterval(this._sparkTimer);
      this._sparkTimer = null;
    }

    _tickSparks() {
      if (!this.isConnected || !this._elementMap.size) { this._stopSparkTimer(); return; }
      if (document.visibilityState === 'hidden') return;
      const now = performance.now();
      let anyActivity = false;
      for (const view of this._elementMap.values()) {
        const graph = view.spark;
        const envelope = graph.active ? sampleEnvelope(graph.pattern, (now - graph.startedAt) / (graph.period * 1000)) : 0;
        const level = Math.max(0, Math.min(100, envelope * graph.intensity));
        graph.points.push(level);
        if (!graph.actualPoints) graph.actualPoints = [];
        const reportIsFresh = Number.isFinite(graph.reportedAt) && Date.now() - graph.reportedAt < 5000;
        graph.actualPoints.push(reportIsFresh ? (graph.reportedLevel ?? null) : null);
        if (graph.points.length > SPARK_POINTS) graph.points.shift();
        if (graph.actualPoints.length > SPARK_POINTS) graph.actualPoints.shift();
        this._paintSpark(view);
        if (graph.active || graph.points.some((v) => v > 0)
            || graph.actualPoints.some((v) => v !== null && v > 0)) anyActivity = true;
      }
      // Idle cards do not consume mobile battery redrawing an empty baseline.
      if (!anyActivity) this._stopSparkTimer();
    }

    _paintSpark(view) {
      const values = view.spark.points;
      // Right-align incoming samples: the line rolls left as fresh data arrives.
      const y = (value) => (27 - Math.max(0, Math.min(100, value)) * 0.24).toFixed(2);
      const coords = values.map((v, i) => {
        const x = 95 - (values.length - 1 - i) * (95 / (SPARK_POINTS - 1));
        return `${x.toFixed(2)},${y(v)}`;
      });
      const baseline = 'M0,27 L95,27';
      const line = coords.length ? `M${coords.join(' L')}` : baseline;
      view.refs['spark-line'].setAttribute('d', line);
      view.refs['spark-fill'].setAttribute('d', coords.length ? `${line} L95,27 Z` : `${baseline} Z`);
      const reports = view.spark.actualPoints || [];
      let actualPath = '';
      for (let i = 0; i < reports.length; i++) {
        const val = reports[i];
        if (val === null || !Number.isFinite(val)) continue;
        const x = 95 - (reports.length - 1 - i) * (95 / (SPARK_POINTS - 1));
        const previous = i > 0 ? reports[i - 1] : null;
        actualPath += `${previous === null || !Number.isFinite(previous) ? 'M' : ' L'}${x.toFixed(2)},${y(val)}`;
      }
      if (view.refs['spark-actual']) view.refs['spark-actual'].setAttribute('d', actualPath);
      const latest = reports.length ? reports[reports.length - 1] : null;
      view.refs['spark-dot'].setAttribute('cy', y(latest === null ? 0 : latest));
      view.refs['spark-dot'].style.opacity = latest !== null && Number.isFinite(latest) ? '1' : '0';
    }

    _openSettings(event) {
      // Preserve native Ctrl/Command-click, middle-click, and new-tab actions.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.currentTarget;
      if (!link?.getAttribute('href')) return;
      event.preventDefault();
      const path = link.getAttribute('href');
      // Standard Home Assistant frontend client-side navigation, including the mobile app.
      history.pushState(null, '', path);
      window.dispatchEvent(new Event('location-changed'));
    }

    async _masterToggle(kind) {
      const id = kind === 'server' ? this._hub.inti_server : this._hub.enabled;
      const on = this._state(id)?.state === 'on';
      await this._call('switch', on ? 'turn_off' : 'turn_on', id);
    }
    async _togglePermission(device) {
      if (!device.commands) return;
      const on = this._state(device.commands)?.state === 'on';
      await this._call('switch', on ? 'turn_off' : 'turn_on', device.commands);
    }
    async _toggleRun(device) {
      const on = this._state(device.run)?.state === 'on';
      await this._call('switch', on ? 'turn_off' : 'turn_on', device.run);
    }
    async _press(entityId) { await this._call('button', 'press', entityId); }
    async _select(entityId, option) { await this._call('select', 'select_option', entityId, { option }); }
    async _setNumber(entityId, raw) {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      await this._call('number', 'set_value', entityId, { value });
    }
    async _call(domain, service, entityId, values = {}) {
      if (!this._hass || !entityId || !this._available(entityId)) return;
      const key = `${domain}:${service}:${entityId}`;
      if (this._busy.has(key)) return;
      this._busy.add(key);
      try {
        await this._hass.callService(domain, service, { entity_id: entityId, ...values });
      } catch (error) {
        this._showError(error?.message || `Could not ${service} ${entityId}`);
      } finally {
        this._busy.delete(key);
        this._schedule();
      }
    }
    _showError(text) {
      const toast = this._refs?.toast;
      if (!toast) return;
      toast.textContent = text;
      toast.style.display = 'block';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { if (toast) toast.style.display = 'none'; }, 7000);
    }
  }

  customElements.define(TAG, OggControlDeckCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: TAG,
    name: 'Ogg Control Deck',
    description: 'A mobile-first control card for IntiHA and Ogg, showing only connected devices.',
    preview: true,
  });
})();
