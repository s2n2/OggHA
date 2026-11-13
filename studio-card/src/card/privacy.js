// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// The Privacy card (type: custom:ogg-privacy-card): one switch for private
// mode. On, Ogg's toys stop showing their status to everyone else in Home
// Assistant; whoever turned it on still sees everything as usual, on every
// device they are signed in on (lib/private.js, custom_components/ogg/private.py).
import { oggPrivate } from '../lib/private.js';

export const PRIVACY_TAG = 'ogg-privacy-card';

const STYLE = `
:host{display:block}
ha-card{overflow:hidden;border-radius:24px;border:1px solid rgba(174,194,246,.13);color:#f5f6ff;
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
.state.on{color:#9adbd1}
.state.other{color:#ffcf8a}
.muted{font-size:12px;color:#9aa7c4}
.err{font-size:12px;color:#ffbcc2}
[hidden]{display:none!important}
`;

export class OggPrivacyCard extends HTMLElement {
  setConfig(config) { this._config = config || {}; }
  getCardSize() { return 2; }
  static getStubConfig() { return {}; }

  set hass(hass) {
    this._hass = hass;
    oggPrivate().attach(hass, this);
    this._render();
  }

  _oggPrivateChanged() { this._render(); }

  connectedCallback() { this._render(); }

  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="wrap">
        <div class="head"><div class="brand" id="brand">🕶</div>
          <div><div class="eyebrow">Ogg</div><h2>Private mode</h2></div>
          <button class="sw" id="sw" type="button" role="switch" aria-checked="false" aria-label="Private mode"></button></div>
        <div class="state" id="state"></div>
        <div class="muted" id="info"></div>
        <div class="err" id="err" hidden></div>
      </div></ha-card>`;
      this.shadowRoot.getElementById('sw').addEventListener('click', () => this._toggle());
    }
    const $ = (id) => this.shadowRoot.getElementById(id);
    const p = oggPrivate();
    const mineOn = p.on && p.mine;
    const otherOn = p.on && !p.mine;
    $('sw').classList.toggle('on', p.on);
    $('sw').setAttribute('aria-checked', String(p.on));
    $('sw').disabled = !p.known || otherOn || this._busy;
    $('brand').classList.toggle('on', mineOn);
    const st = $('state');
    st.className = `state${mineOn ? ' on' : otherOn ? ' other' : ''}`;
    st.textContent = !p.known ? 'Checking…' : mineOn ? 'On: only you see what your toys are doing'
      : otherOn ? 'On for someone else' : 'Off';
    $('info').textContent = !p.known ? ''
      : mineOn ? `Everyone else sees Ogg's toys as they were${p.since ? ` at ${new Date(p.since * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}, and nothing goes into history. You see them as usual here and on your other devices. Turn it off to show them again.`
      : otherOn ? 'Someone has private mode on: what Ogg\'s toys show here is held until they turn it off.'
      : 'Turn on so Ogg\'s toys stop showing their status to everyone else in Home Assistant. You keep seeing them as usual, on all your devices.';
  }

  async _toggle() {
    const p = oggPrivate();
    if (!this._hass || this._busy) return;
    this._busy = true;
    const err = this.shadowRoot.getElementById('err');
    err.hidden = true;
    this._render();
    try {
      await p.set(this._hass, !(p.on && p.mine));
    } catch (e) {
      err.textContent = (e && e.message) || String(e);
      err.hidden = false;
    }
    this._busy = false;
    this._render();
  }
}
