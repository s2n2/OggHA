// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// A script loaded from a code or a file (the Easy card's Other) but not saved
// yet: one per browser, shown in the script lists ("📄 name · not saved")
// until it is saved or cleared. Kept in this browser only (never in Home
// Assistant) so it is still there after a reload.
import { decodeText } from './core.js';
import { fileKind, fileTitle, normalise } from './convert.js';

const KEY = 'ogg_loaded_script';
export const LOADED_SRC = '\u0001loadedscript';   // its value in script lists (never a saved name)

let current;                 // undefined: not read yet; null: none
const listeners = new Set();

export function loadedScript() {
  if (current === undefined) {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      current = v && v.name && v.script && Array.isArray(v.script.actions) ? v : null;
    } catch (_) { current = null; }
  }
  return current;
}

export function setLoadedScript(value) {
  current = value && value.script ? { name: String(value.name || 'Loaded script').slice(0, 60), script: value.script } : null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current)); else localStorage.removeItem(KEY);
  } catch (_) { /* too big or private browsing: kept until the page reloads */ }
  for (const fn of listeners) { try { fn(current); } catch (_) { /* a card that went */ } }
}

export function onLoadedScript(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// A pasted code (ogg1:/ogg0:) or funscript JSON, or a file's text, as a script
// and a name. `fileName` (a file's) gives the kind (.vib.funscript) and name.
export async function readScript(text, fileName = '') {
  const raw = await decodeText(String(text || ''));
  if (!raw || !Array.isArray(raw.actions)) throw new Error('That is not a script');
  const script = normalise(raw, fileKind(fileName, 'auto'), Boolean(raw.inverted));
  if (raw.metadata && raw.metadata.creator === 'OggStudio' && raw.metadata.video_key) script.metadata.video_key = raw.metadata.video_key;
  const name = ((raw.metadata && raw.metadata.title) || fileTitle(fileName) || 'Loaded code').trim().slice(0, 60);
  return { name, script };
}
