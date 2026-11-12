// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Audio into vibration. Fed with an analyser's frequency bins (0-255 each)
// a few times a second, it gives two levels (0-100): the first follows the
// beat, the bass or the loudness, the second the mids and highs.
export const AUDIO_MODES = { beat: 'Beat: a pulse on every beat', updown: 'Up and down: each beat goes to the other end', bass: 'Bass: follows the low end', volume: 'Volume: follows the loudness' };

// The analyser's bytes are decibels (0 = -100 dB, 255 = -30 dB). Read as
// they are, loud music is "nearly full" everywhere and nothing stands out,
// so every byte is turned back into an amplitude first (255 = 1).
const AMP = new Float32Array(256);
for (let b = 0; b < 256; b++) AMP[b] = Math.pow(10, (b / 255 - 1) * 3.5);
const QUIET = AMP[0];

// Sensitivity (0-1) works on exponential scales, so every part of the
// slider does something:
//  - the curve: level ^ gamma, from 3 (only the loudest moments come
//    through) by 1 (as it is) to 1/3 (quiet parts are lifted well up);
//  - the gate: what counts as silence, from 0.02 down to 0.002;
//  - the beat: how far a hit must stand clear of what came before.
export const audioGamma = (sens) => Math.pow(3, 1 - 2 * sens);
export const audioGate = (sens) => 0.02 * Math.pow(10, -sens);
const beatClear = (sens) => 2.0 - 1.8 * sens;

const AVG_MS = 3000;             // what the sound has been like lately
const PEAK_HALF_MS = 8000;       // the recent peak fades away in this long
const FLUX_FRAMES = 40;          // about two seconds of onset history
const BEAT_GAP_MS = 200;         // no two beats closer than this
const PULSE_HALF_MS = 120;       // a beat's pulse halves in this long
const ONSET_EDGES = [30, 90, 180, 350, 700, 1400, 2800, 5600];   // Hz: the bands onsets are looked for in

// One band's level against what it has lately been: its recent average and
// its recent peak together. A steady sound settles around two thirds, a hit
// or a swell above it reaches full, a dip falls well away. Nothing sits at
// full for long.
class Band {
  constructor() { this.avg = 0; this.peak = 0; }

  step(v, dt) {
    this.peak = Math.max(v, this.peak * Math.pow(0.5, dt / PEAK_HALF_MS));
    const n = v / (0.5 * this.peak + this.avg || 1);
    this.avg += (v - this.avg) * Math.min(1, dt / AVG_MS);
    return Math.min(1, Math.max(0, n));
  }
}

export class AudioFeel {
  constructor(sampleRate, fftSize) {
    this.hz = sampleRate / fftSize;      // width of one bin
    this.reset();
  }

  reset() {
    this.bands = { bass: new Band(), mid: new Band(), all: new Band() };
    this.prev = null;                    // the last frame's bands, for onsets
    this.body = 0;                       // how loud it has been lately
    this.flux = [];                      // recent onset strengths
    this.fluxPeak = 0;
    this.pulse = 0;
    this.beatAt = -1e9;
    this.last = null;
    this.smooth = [0, 0];
    this.beats = 0;
    this.side = false;                   // up and down: which end the last beat went to
    this.gaps = [];                      // recent times between beats
    this.gap = 0;                        // the beat's period now (ms), 0 = not known yet
  }

  _range(from, to, n) { return [Math.max(1, Math.floor(from / this.hz)), Math.min(n - 1, Math.ceil(to / this.hz))]; }

  // One reading. sens 0-1: how easily it reacts. Returns { levels, beat }.
  step(bins, now, mode = 'beat', sens = 0.5) {
    const dt = this.last === null ? 50 : Math.min(250, Math.max(1, now - this.last));
    this.last = now;
    const n = bins.length;
    const top = this._range(30, 8000, n)[1];
    if (!this.amp || this.amp.length !== top + 1) this.amp = new Float32Array(top + 1);
    const amp = this.amp;
    for (let i = 0; i <= top; i++) amp[i] = AMP[bins[i]];
    const mean = (from, to) => {
      const [a, b] = this._range(from, to, n);
      let sum = 0;
      for (let i = a; i <= b; i++) sum += amp[i];
      return b >= a ? sum / (b - a + 1) : 0;
    };
    const bass = mean(30, 180), mid = mean(300, 4000), all = mean(30, 8000);
    const live = all >= audioGate(sens);
    const gamma = audioGamma(sens);
    const curve = (x) => (x <= 0 ? 0 : Math.pow(x, gamma));
    const nBass = this.bands.bass.step(bass, dt);
    const nMid = this.bands.mid.step(mid, dt);
    const nAll = this.bands.all.step(all, dt);

    // An onset: how much louder each band got since the last frame, the low
    // end counted in full and the rest (snares, claps, small speakers) in
    // part. Whole bands, not single bins: hiss and held notes flicker bin
    // by bin without being hits.
    const now_ = ONSET_EDGES.slice(0, -1).map((from, k) => mean(from, ONSET_EDGES[k + 1]));
    let flux = 0, body = 0;
    now_.forEach((v, k) => {
      const w = k < 3 ? 1 : 0.5;
      body += v * w;
      if (this.prev && v > this.prev[k]) flux += (v - this.prev[k]) * w;
    });
    this.prev = now_;
    this.body += (body - this.body) * Math.min(1, dt / AVG_MS);

    // A beat stands clear of the onsets of the last two seconds.
    let beat = false;
    const hist = this.flux;
    if (hist.length >= 6) {
      const avg = hist.reduce((x, y) => x + y, 0) / hist.length;
      const dev = Math.sqrt(hist.reduce((x, y) => x + (y - avg) * (y - avg), 0) / hist.length);
      beat = live && flux > QUIET && flux > this.body * 0.2 && flux > avg * 1.2 + dev * beatClear(sens) && now - this.beatAt > BEAT_GAP_MS;
    }
    hist.push(flux);
    while (hist.length > FLUX_FRAMES) hist.shift();
    this.fluxPeak = Math.max(flux, this.fluxPeak * Math.pow(0.5, dt / 4000));
    if (beat) {
      // The tempo: the middle of the recent gaps between beats.
      const g = now - this.beatAt;
      if (g >= 250 && g <= 2000) {
        this.gaps.push(g);
        while (this.gaps.length > 8) this.gaps.shift();
        const sorted = [...this.gaps].sort((x, y) => x - y);
        this.gap = sorted[Math.floor(sorted.length / 2)];
      }
      this.beatAt = now;
      this.beats += 1;
      this.side = !this.side;
      // A harder hit gives a stronger pulse.
      this.pulse = curve(0.45 + 0.55 * Math.min(1, flux / (this.fluxPeak || flux)));
    } else this.pulse *= Math.pow(0.5, dt / PULSE_HALF_MS);
    if (!live) this.pulse = 0;

    // Rise at once, fall a little slower: motors feel better for it.
    const ease = (prev, v) => (v >= prev ? v : prev + (v - prev) * Math.min(1, dt / 120));
    if (mode === 'updown') {
      // One beat up, the next down (the second motor the other way): a
      // stroker strokes to the music, a vibrator goes high and low.
      this.smooth = this.side ? [1, 0] : [0, 1];
      if (!this.beats) this.smooth = [0, 0];
      return { levels: this.smooth.map((v) => v * 100), beat, gap: this.gap };
    }
    let first;
    if (mode === 'beat') first = this.pulse;            // nothing between the beats
    else first = ease(this.smooth[0], live ? curve(mode === 'bass' ? nBass : nAll) : 0);
    const second = ease(this.smooth[1], live ? curve(nMid) : 0);
    this.smooth = [first, second];
    return { levels: this.smooth.map((v) => Math.round(Math.min(1, v) * 100)), beat, gap: this.gap };
  }
}
