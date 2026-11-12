// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

export const TAG = 'oggstudio-card';
export const VERSION = '0.23.0';
export const DEVICE_KEY = 'oggstudio_device';
export const SPEEDS = ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'];
export const SAMPLE_MS = 100;
export const LIVE_MS = 100;
export const VIDEO_TICK_MS = 100;
// Casting goes through Home Assistant: these integrations can play a video URL.
export const CAST_PLATFORMS = ['cast', 'dlna_dmr', 'kodi', 'apple_tv'];
export const CAST_DRIFT = 0.4;          // s: re-align the video here when the TV is further off
export const CAST_GRACE = 3500;         // ms after a command from here before the TV's state is followed again
export const VIDEO_OFFSET_KEY = 'oggstudio_video_offset';
export const PARTS = ['record', 'stroke', 'take', 'library', 'video', 'import'];
export const NO_DEVICE = 'none';           // record without a device
export const TAKE_SRC = 'take';      // "Current take" in script lists (never a saved name)
// One card: Play. The earlier cards are retired; their names open the
// Play card (hidden from the card picker) so dashboards keep working.
const PLAY = { name: 'OggStudio Play', sub: 'Manual, pattern, mood, library, video and sound: record any of them', parts: ['record', 'video', 'take'], simple: true, size: 10,
  description: 'Everything in one card: play by hand, a pattern, a mood, a saved script, a video or sound, record any of it, and Together, script editing, a queue and the lock.' };
const PLAY_STROKE = { ...PLAY, parts: ['stroke', 'video', 'take'], hidden: true };
export const VARIANTS = {
  'oggstudio-play-card': PLAY,
  'oggstudio-card': { ...PLAY, hidden: true },
  'oggstudio-recorder-card': { ...PLAY, hidden: true },
  'oggstudio-player-card': { ...PLAY, hidden: true },
  'oggstudio-video-card': { ...PLAY, hidden: true },
  'oggstudio-stroke-card': PLAY_STROKE,
  'oggstudio-play-stroke-card': PLAY_STROKE,
  'oggstudio-video-stroke-card': PLAY_STROKE,
  'oggstudio-together-card': { ...PLAY, hidden: true },
};
// Pointer capture can fail (a pointer already gone); never let it stop a press.
export const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ } };
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export async function encodeCode(script) {
  const json = JSON.stringify(script);
  if (window.CompressionStream) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    return 'ogg1:' + b64(await new Response(stream).arrayBuffer());
  }
  return 'ogg0:' + b64(new TextEncoder().encode(json));
}

export async function decodeText(text) {
  const value = text.trim();
  if (value.startsWith('ogg1:')) {
    if (!window.DecompressionStream) throw new Error('This browser cannot read compressed codes');
    const stream = new Blob([unb64(value.slice(5))]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  if (value.startsWith('ogg0:')) return JSON.parse(new TextDecoder().decode(unb64(value.slice(5))));
  return JSON.parse(value);
}

export const duration = (s) => Math.max(
  s.actions.length ? s.actions[s.actions.length - 1].at : 0,
  s.channels && s.channels.V1.actions.length ? s.channels.V1.actions[s.channels.V1.actions.length - 1].at : 0);
export const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;

// The Play card's Library list: entries that are not saved scripts.
export const LIB_TAKE = '\u0001take';
export const LIB_FILE = '\u0001file';
export const LIB_LOADED = '\u0001loaded';
