// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// The ⚙ on a toy's chip: that toy's settings in a small pop-up, the same on
// every card. Its limits (kept in Home Assistant for every card: nothing goes
// past them), and on the Play card how it follows and which motor.
import { esc } from './core.js';
import { limitsFor, limitsText } from './limits.js';

const STYLE = `
.ogg-dset{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,9,20,.62);backdrop-filter:blur(3px)}
.ogg-dset .box{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:20px;border:1px solid #33415f;background:#101a30;color:#e9ecfb;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,.5);font:inherit}
.ogg-dset .top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.ogg-dset h3{margin:0;font-size:16px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ogg-dset .x{min-height:34px;width:34px;padding:0;border-radius:50%;border:1px solid #3a4a6c;background:transparent;color:#c4d0ee;font-size:15px;cursor:pointer}
.ogg-dset .grp{display:flex;flex-direction:column;gap:4px;margin:10px 0}
.ogg-dset label{font-size:12.5px;font-weight:750;color:#9aa6c8;display:flex;justify-content:space-between}
.ogg-dset label b{color:#bef2ff}
.ogg-dset input[type=range]{width:100%;accent-color:#67e0c8}
.ogg-dset select{width:100%;padding:9px 10px;border-radius:12px;border:1px solid #364563;background:#17233c;color:#fff;font:inherit}
.ogg-dset .hint{font-size:12px;color:#9aa6c8;margin-top:8px;line-height:1.4}
.ogg-dset .sep{height:1px;background:#26324d;margin:12px 0}
`;

const ensureStyle = (root) => {
  if (root.querySelector('style[data-ogg-dset]')) return;
  const s = document.createElement('style');
  s.dataset.oggDset = '1';
  s.textContent = STYLE;
  root.appendChild(s);
};

// The gear on a chip (a span, since the chip itself is a button).
export const gearHtml = (dev) => `<span class="gear" data-gear="${esc(dev.stop)}" role="button" tabindex="0" title="Settings for ${esc(dev.name)}" aria-label="Settings for ${esc(dev.name)}">⚙</span>`;
export const GEAR_STYLE = '.gear{display:inline-grid;place-items:center;width:20px;height:20px;margin-left:-4px;border-radius:50%;font-size:13px;line-height:1;opacity:.75;cursor:pointer}.gear:hover,.gear:focus-visible{opacity:1;background:rgba(255,255,255,.1);outline:none}';

// root: the card's shadow root. dev: { name, stop, vibe, linear }.
// allLimits: Ogg's limits (by stop entity). extra: [{ label, options:[[value, text]], value, onChange }].
// onLimits(stop, lim): the card's own copy, updated at once.
export function openDeviceSettings(root, { hass, dev, allLimits, extra = [], note = '', onLimits, toast }) {
  ensureStyle(root);
  root.querySelector('.ogg-dset')?.remove();
  let lim = limitsFor(allLimits, dev.stop);
  const vibe = dev.vibe || !dev.linear;
  const slider = (field, text, min) => `<div class="grp"><label>${text} <b data-v="${field}">${lim[field]}%</b></label><input type="range" min="${min}" max="100" step="1" value="${lim[field]}" data-field="${field}"></div>`;
  const wrap = document.createElement('div');
  wrap.className = 'ogg-dset';
  wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Settings for ${esc(dev.name)}">
    <div class="top"><h3>⚙ ${esc(dev.name)}</h3><button type="button" class="x" aria-label="Close">✕</button></div>
    ${extra.map((x, i) => `<div class="grp"><label>${esc(x.label)}</label><select data-extra="${i}">${x.options.map(([v, t]) => `<option value="${esc(v)}"${v === x.value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`).join('')}
    ${note ? `<div class="hint">${esc(note)}</div>` : ''}
    ${extra.length || note ? '<div class="sep"></div>' : ''}
    ${vibe ? slider('max', 'Top intensity', 0) : ''}
    ${dev.linear ? slider('lo', 'Stroke range from', 0) + slider('hi', 'Stroke range to', 0) + slider('speed', 'Top stroke speed', 5) : ''}
    <div class="hint">Limits: nothing goes past these, whatever is driving (pads, scripts, moods, audio or a partner). They are kept in Home Assistant for every card.</div>
  </div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.x')) close(); });
  for (const sel of wrap.querySelectorAll('select[data-extra]')) sel.addEventListener('change', () => extra[Number(sel.dataset.extra)].onChange(sel.value));
  for (const input of wrap.querySelectorAll('input[data-field]')) {
    input.addEventListener('input', () => { wrap.querySelector(`[data-v="${input.dataset.field}"]`).textContent = `${input.value}%`; });
    input.addEventListener('change', () => {
      const field = input.dataset.field;
      lim = { ...lim, [field]: Number(input.value) };
      // The stroke range keeps a little room: moving one end pushes the other.
      if (lim.hi - lim.lo < 5) { if (field === 'lo') lim.hi = Math.min(100, lim.lo + 5); else lim.lo = Math.max(0, lim.hi - 5); }
      if (lim.hi - lim.lo < 5) { lim.lo = 0; lim.hi = 100; }
      for (const f of ['lo', 'hi']) {
        const el = wrap.querySelector(`input[data-field="${f}"]`);
        if (el) { el.value = String(lim[f]); wrap.querySelector(`[data-v="${f}"]`).textContent = `${lim[f]}%`; }
      }
      if (onLimits) onLimits(dev.stop, lim);
      hass.callService('ogg', 'studio_set_limits', { entity_id: dev.stop, ...lim })
        .then(() => toast && toast(`Limits for ${dev.name}: ${limitsText(lim) || 'none'}.`))
        .catch((e) => toast && toast('Could not save the limits: ' + (e.message || e)));
    });
  }
  root.appendChild(wrap);
  wrap.querySelector('.x').focus();
  return close;
}
