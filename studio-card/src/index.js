/* OggStudio card: record, import, save and replay patterns on Ogg devices.
 * Scripts are funscript JSON ({actions:[{at,pos}]}, pos 0-100 = intensity);
 * a second motor is stored as channels.V1. Share codes are "ogg1:" + base64
 * of gzip(JSON) ("ogg0:" + base64(JSON) where CompressionStream is missing).
 */
import { TAG, VARIANTS } from './lib/core.js';
import { OggStudioCard } from './card/card.js';
import { StrokePart } from './card/stroke.js';
import { GamepadPart } from './card/gamepad.js';
import { VideoPart } from './card/video.js';
import { CastPart } from './card/cast.js';
import { ReplayPart } from './card/replay.js';
import { OutputsPart } from './card/outputs.js';
import { SafetyPart } from './card/safety.js';
import { ToolsPart } from './card/tools.js';
import { AudioPart } from './card/audio.js';
import { TogetherPart } from './card/together.js';
import { PlayPart } from './card/play.js';

// Each part's methods join the card (later parts win on a shared name).
for (const part of [StrokePart, GamepadPart, VideoPart, CastPart, ReplayPart, OutputsPart, SafetyPart, ToolsPart, AudioPart, TogetherPart, PlayPart]) {
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
    if (key !== 'constructor') Object.defineProperty(OggStudioCard.prototype, key, desc);
  }
}

if (!customElements.get(TAG)) {
  window.customCards = window.customCards || [];
  for (const [tag, variant] of Object.entries(VARIANTS)) {
    if (customElements.get(tag)) continue;
    const cls = tag === TAG ? OggStudioCard : class extends OggStudioCard { static get variant() { return variant; } };
    customElements.define(tag, cls);
    // The picker offers the Play cards (vibrator, stroker) and Together;
    // the other cards still work where they are already used.
    if (!variant.hidden) window.customCards.push({ type: tag, name: variant.name, description: variant.description, preview: true });
  }
}
