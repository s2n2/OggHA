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
import { ScreenOffPart } from './card/screenoff.js';
import { OggPrivacyCard, PRIVACY_TAG } from './card/privacy.js';
import { OggQueueCard, QUEUE_TAG } from './card/queuecard.js';
import { EASY_TAG, OggEasyCard } from './card/easy.js';
import { privateHass } from './lib/private.js';

// Each part's methods join the card (later parts win on a shared name).
for (const part of [StrokePart, GamepadPart, VideoPart, CastPart, ReplayPart, OutputsPart, SafetyPart, ToolsPart, AudioPart, TogetherPart, PlayPart, ScreenOffPart]) {
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
    if (key !== 'constructor') Object.defineProperty(OggStudioCard.prototype, key, desc);
  }
}

// Private mode: for whoever turned it on, the card sees the live states.
privateHass(OggStudioCard);

if (!customElements.get(PRIVACY_TAG)) {
  customElements.define(PRIVACY_TAG, OggPrivacyCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: PRIVACY_TAG, name: 'Ogg Privacy', description: "Private mode: Ogg's toys stop showing their status to everyone else; you still see them as usual.", preview: true });
}

if (!customElements.get(QUEUE_TAG)) {
  customElements.define(QUEUE_TAG, OggQueueCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: QUEUE_TAG, name: 'Ogg Queue', description: 'Make a queue of patterns, moods and scripts, each for a set time; add it to his or hers queue and send your partner a link to play it.', preview: true });
}

if (!customElements.get(EASY_TAG)) {
  customElements.define(EASY_TAG, OggEasyCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: EASY_TAG, name: 'Ogg Easy', description: 'The simple one: Connect now, pick your toys, then Play now, Queue & replay, or Other (video and sound).', preview: true });
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
