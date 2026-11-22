// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// The Connect Handy card (type: custom:ogg-connect-handy-card): the Handy
// over Wi-Fi instead of Bluetooth, switched by hand. Ogg keeps it as the same
// device, so every other card works as before whichever way it is connected
// (custom_components/ogg/handy_wifi.py). The keys live in secrets.yaml; this
// card only ever shows whether each is there.
import { makeCover } from '../lib/cover.js';

export const CONNECT_HANDY_TAG = 'ogg-connect-handy-card';

const STYLE = `
:host{display:block}
ha-card{display:block;overflow:hidden;border-radius:24px;border:1px solid rgba(174,194,246,.13);color:#f5f6ff;
  background:radial-gradient(circle at 110% -10%,rgba(105,100,240,.24),transparent 260px),linear-gradient(160deg,#141d33,#0d1426);
  font:14px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{padding:16px 16px 14px;display:flex;flex-direction:column;gap:12px}
.head{display:flex;align-items:center;gap:12px}
.brand{flex:0 0 44px;height:44px;border-radius:15px;display:grid;place-items:center;font-size:21px;background:linear-gradient(155deg,#8f7dff,#5b6be0);color:#0b1022}
.brand.on{background:linear-gradient(155deg,#6adfd4,#31c6b8)}
.eyebrow{font-size:10px;font-weight:850;letter-spacing:.19em;color:#b8b0ff;text-transform:uppercase}
h2{margin:0;font-size:19px;letter-spacing:-.03em;font-weight:780}
.sw{margin-left:auto;position:relative;flex:0 0 58px;height:34px;border-radius:20px;border:1px solid #364563;background:#1b2741;cursor:pointer;padding:0}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:#8b97b3;transition:transform .18s,background .18s}
.sw.on{background:linear-gradient(110deg,#31c6b8,#54d4bc);border-color:transparent}
.sw.on::after{transform:translateX(24px);background:#fff}
.sw:disabled{opacity:.45;cursor:not-allowed}
.state{font-size:13px;font-weight:700}
.state.ok{color:#9adbd1}
.state.warn{color:#ffcf8a}
.muted{font-size:12px;color:#9aa7c4}
.err{font-size:12px;color:#ffbcc2}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.facts{display:flex;gap:6px;flex-wrap:wrap}
.fact{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#1b2741;border:1px solid #2b3a5a;color:#c9d3ec}
button.b{font:inherit;font-size:13px;font-weight:700;border-radius:12px;border:1px solid #364563;background:#1b2741;color:#e8ecff;padding:7px 14px;cursor:pointer}
button.b:disabled{opacity:.45;cursor:not-allowed}
button.b.go{background:linear-gradient(110deg,#8f7dff,#5b6be0);border-color:transparent;color:#0b1022}
select,input{font:inherit;font-size:13px;color:#f5f6ff;background:#0e1730;border:1px solid #2b3a5a;border-radius:10px;padding:7px 10px;min-width:0}
input{width:100%;box-sizing:border-box}
details{border-top:1px solid rgba(174,194,246,.1);padding-top:10px}
summary{cursor:pointer;font-size:13px;font-weight:700;color:#c9d3ec;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ ";color:#8b97b3}
details[open] summary::before{content:"▾ "}
.keys{display:flex;flex-direction:column;gap:8px;margin-top:10px}
label{font-size:12px;color:#9aa7c4;display:flex;flex-direction:column;gap:4px}
[hidden]{display:none!important}
`;

const ago = (t) => {
  if (!t) return '';
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

export class OggConnectHandyCard extends HTMLElement {
  setConfig(config) { this._config = config || {}; }
  getCardSize() { return 3; }
  static getStubConfig() { return {}; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first || !this._unsub) this._subscribe();
    this._render();
  }

  connectedCallback() { if (this._hass && !this._unsub) this._subscribe(); this._render(); }

  disconnectedCallback() {
    const unsub = this._unsub;
    this._unsub = null;
    if (unsub) Promise.resolve(unsub).then((f) => (typeof f === 'function' ? f() : null)).catch(() => {});
  }

  _subscribe() {
    if (!this._hass || !this._hass.connection || this._subscribing) return;
    this._subscribing = true;
    this._unsub = this._hass.connection.subscribeMessage((status) => { this._st = status; this._render(); }, { type: 'ogg/handy_wifi/subscribe' })
      .catch((e) => { this._st = null; this._err = (e && e.message) || 'Ogg is not set up'; this._unsub = null; this._render(); })
      .finally(() => { this._subscribing = false; });
  }

  async _ws(msg) {
    this._busy = true;
    this._err = '';
    this._render();
    try {
      return await this._hass.callWS(msg);
    } catch (e) {
      this._err = (e && e.message) || String(e);
      return null;
    } finally {
      this._busy = false;
      this._render();
    }
  }

  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="wrap">
        <div class="head"><div class="brand" id="brand">📶</div>
          <div><div class="eyebrow">Ogg</div><h2>Connect Handy</h2></div>
          <button class="sw" id="sw" type="button" role="switch" aria-checked="false" aria-label="The Handy over Wi-Fi"></button></div>
        <div class="state" id="state">Checking…</div>
        <div class="facts" id="facts"></div>
        <div class="muted" id="info"></div>
        <div class="row" id="pickrow" hidden><span class="muted">The Handy is</span><select id="pick" aria-label="Which stroker is the Handy"></select></div>
        <div class="row"><button class="b" id="test" type="button">Test</button><span class="muted" id="checked"></span></div>
        <div class="err" id="err" hidden></div>
        <details id="keysbox"><summary>Keys</summary>
          <div class="keys">
            <div class="muted" id="keysinfo"></div>
            <label>Connection key (on the Handy's app or handyfeeling.com)
              <input id="ck" type="password" autocomplete="off" spellcheck="false" inputmode="text"></label>
            <label>Application ID (handyfeeling.com developer portal)
              <input id="app" type="password" autocomplete="off" spellcheck="false"></label>
            <div class="row"><button class="b go" id="save" type="button">Save to secrets.yaml</button></div>
          </div>
        </details>
      </div></ha-card>`;
      const $ = (id) => this.shadowRoot.getElementById(id);
      $('sw').addEventListener('click', () => this._ws({ type: 'ogg/handy_wifi/set', on: !(this._st && this._st.on) }));
      $('test').addEventListener('click', () => this._ws({ type: 'ogg/handy_wifi/test' }));
      $('pick').addEventListener('change', (e) => this._ws({ type: 'ogg/handy_wifi/set', device_key: e.target.value }));
      $('save').addEventListener('click', async () => {
        const ck = $('ck').value.trim(), app = $('app').value.trim();
        if (!ck && !app) { this._err = 'Enter a key to save'; this._render(); return; }
        const msg = { type: 'ogg/handy_wifi/keys' };
        if (ck) msg.connection_key = ck;
        if (app) msg.app_id = app;
        const ok = await this._ws(msg);
        if (ok) { $('ck').value = ''; $('app').value = ''; this._saved = true; this._render(); }
      });
    }
    if (!this._ocov) this._ocov = makeCover(this.shadowRoot.querySelector('ha-card'));
    if (this._hass) this._ocov.update(this._hass);
    const $ = (id) => this.shadowRoot.getElementById(id);
    const st = this._st;
    const keys = st && st.keys ? st.keys : {};
    const hasKeys = Boolean(keys.connection_key && keys.app_id);
    const on = Boolean(st && st.on);
    $('sw').classList.toggle('on', on);
    $('sw').setAttribute('aria-checked', String(on));
    $('sw').disabled = !st || this._busy || (!on && !hasKeys) || !st.device;
    $('brand').classList.toggle('on', on && st.online);
    $('test').disabled = !st || this._busy || !hasKeys;

    let state = 'Checking…', cls = '', info = '';
    if (st) {
      const name = st.device ? st.device.name : 'The Handy';
      if (!st.device) {
        state = 'No stroker yet'; cls = 'warn';
        info = 'Connect the Handy to Ogg by Bluetooth once, so Ogg knows it; then it can use Wi-Fi too.';
      } else if (!hasKeys) {
        state = 'Bluetooth'; cls = '';
        info = 'To use Wi-Fi, add the Handy\'s connection key and an Application ID under Keys.';
      } else if (!on) {
        state = 'Bluetooth'; cls = '';
        info = `${name} goes over Bluetooth: everything works, with live control (finger, pads) at its quickest. Wi-Fi suits scripts and videos, and use away from home: put the Handy on Wi-Fi (its app or button), then switch this on.`;
      } else if (!st.ogg_enabled) {
        state = 'Wi-Fi: Ogg is off'; cls = 'warn';
        info = 'Turn Ogg on to reach the Handy.';
      } else if (st.online) {
        state = `Wi-Fi: ${name} is connected`; cls = 'ok';
        info = "Everything works as usual. Scripts and videos are sent ahead, so they stay smooth and in time. Live control (finger, pads) runs the delay below behind, as every move goes through Ohdoki's servers: Bluetooth is better for that. Switch off to go back to Bluetooth.";
      } else {
        state = 'Wi-Fi: the Handy is not on Wi-Fi'; cls = 'warn';
        info = 'Put the Handy on Wi-Fi (its app or button) and check it is switched on. Ogg checks every 10 seconds.';
      }
    }
    $('state').textContent = state;
    $('state').className = `state${cls ? ' ' + cls : ''}`;
    $('info').textContent = info;

    const facts = [];
    if (st && on && st.online) {
      if (st.firmware) facts.push(`firmware ${st.firmware}`);
      if (st.lead_ms) facts.push(`live delay ${(st.lead_ms / 1000).toFixed(1)} s`);
      if (st.rtt_ms) facts.push(`round trip ${st.rtt_ms} ms`);
      if (st.playing) facts.push('streaming');
    }
    $('facts').innerHTML = facts.map((f) => `<span class="fact">${f}</span>`).join('');
    $('checked').textContent = st && st.checked_at ? `checked ${ago(st.checked_at)}` : '';

    const strokers = (st && st.strokers) || [];
    $('pickrow').hidden = strokers.length < 2;
    const pick = $('pick');
    const want = strokers.map((s) => `${s.key}|${s.name}`).join(',');
    if (pick.dataset.list !== want) {
      pick.dataset.list = want;
      pick.innerHTML = strokers.map((s) => `<option value="${s.key}"></option>`).join('');
      [...pick.options].forEach((o, i) => { o.textContent = strokers[i].name; });
    }
    if (st && st.device) pick.value = st.device.key;

    const admin = Boolean(st && st.is_admin);
    $('ck').disabled = $('app').disabled = $('save').disabled = !admin || this._busy;
    $('ck').placeholder = keys.connection_key ? `saved (${st.connection_key_hint})` : 'not set';
    $('app').placeholder = keys.app_id ? 'saved' : 'not set';
    $('keysinfo').textContent = !st ? '' : !admin ? 'An administrator sets the keys.'
      : this._saved ? 'Saved in secrets.yaml.'
      : 'Kept in secrets.yaml (ogg_handy_connection_key, ogg_handy_app_id), never shown here.';
    if (st && !hasKeys && admin && !this._opened) { this._opened = true; $('keysbox').open = true; }

    const err = this._err || (st && on ? st.last_error : '') || '';
    $('err').textContent = err;
    $('err').hidden = !err || (st && st.online && !this._err);
  }
}
