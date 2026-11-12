// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

// Ogg's built-in patterns, worked out here in the browser so they can be
// seen on the pads, recorded, and kept inside the limits like everything
// else. Each gives a level (0-1) for a phase: one whole number per cycle.
export const PATTERNS = {
  steady: 'Steady', pulse: 'Pulse', wave: 'Wave', breath: 'Breath', ramp: 'Ramp', peak: 'Peak',
  heartbeat: 'Heartbeat', double_pulse: 'Double pulse', steps: 'Steps', echo: 'Echo', surge: 'Surge',
  surf: 'Surf', bounce: 'Bounce', massage: 'Massage', tease: 'Tease', chachacha: 'Cha-cha-cha', tempo: 'Tempo',
};
// Two motors, each with its own part.
export const PATTERNS_DUAL = {
  dual_pulse: 'Dual pulse', dual_wave: 'Dual wave', ping_pong: 'Ping-pong', chase: 'Chase', counter_wave: 'Counter wave',
  breath_offset: 'Breath offset', heartbeat_split: 'Heartbeat split', double_pulse_split: 'Double pulse split',
  echo_bounce: 'Echo bounce', ramp_swap: 'Ramp swap', steps_cross: 'Steps cross', tease_pulse: 'Tease + pulse',
  rumble_pulse: 'Rumble + pulse', surge_layer: 'Surge layer',
};
export const PATTERN_RANDOM = 'random';

const frac = (x) => ((x % 1) + 1) % 1;
const wave = (pos) => (1 - Math.cos(2 * Math.PI * pos)) / 2;
const step4 = (pos) => (Math.min(Math.floor(pos * 4), 3) + 1) / 4;
const ECHO = [1, 0, 0.65, 0, 0.35, 0];
const BOUNCE = [1, 0.8, 0.6, 0.45, 0.3, 0.15];

export function patternLevel(key, phase) {
  const pos = frac(phase);
  switch (key) {
    case 'steady': return 1;
    case 'pulse': return pos < 0.5 ? 1 : 0;
    case 'wave': case 'tide': return wave(pos);
    case 'breath': return Math.pow(wave(pos), 1.5);
    case 'ramp': return pos;
    case 'peak': return 1 - Math.abs(2 * pos - 1);
    case 'heartbeat': return pos < 0.13 ? 1 : (pos >= 0.25 && pos < 0.4 ? 0.7 : 0);
    case 'double_pulse': return pos < 0.2 || (pos >= 0.35 && pos < 0.55) ? 1 : 0;
    case 'steps': case 'step': return step4(pos);
    case 'echo': return ECHO[Math.min(Math.floor(pos * 6), 5)];
    case 'surge': case 'crest': return Math.sqrt(wave(pos));
    case 'surf': return wave(pos) * (0.65 + 0.35 * Math.pow(Math.sin(6 * Math.PI * pos), 2));
    case 'bounce': return Math.abs(Math.sin(2 * Math.PI * pos)) * (1 - 0.4 * pos);
    case 'massage': return 0.3 + 0.7 * wave(pos);
    case 'tease': return pos < 0.8 ? pos * 1.25 : 0;
    case 'chachacha': return pos < 0.14 || (pos >= 0.25 && pos < 0.39) || (pos >= 0.5 && pos < 0.64) ? 1 : 0;
    case 'tempo': return frac(pos * 3) < 0.5 ? 1 : 0;
    default: return 0;
  }
}

// motor 0 is the inner motor, 1 the outer one.
export function patternDual(key, phase, motor) {
  const pos = frac(phase);
  const inner = motor === 0;
  switch (key) {
    case 'dual_steady': return 1;
    case 'dual_pulse': return pos < 0.5 ? 1 : 0;
    case 'dual_wave': return wave(pos);
    case 'ping_pong': return (inner ? (pos < 0.5 || pos > 0.96) : pos > 0.46) ? 1 : 0;
    case 'chase': return wave(frac(pos - 0.25 * motor));
    case 'counter_wave': return inner ? wave(pos) : 1 - wave(pos);
    case 'breath_offset': return Math.pow(wave(frac(pos - 0.5 * motor)), 1.5);
    case 'heartbeat_split': return inner ? (pos < 0.13 ? 1 : 0) : (pos >= 0.25 && pos < 0.4 ? 0.8 : 0);
    case 'double_pulse_split': return (inner ? pos < 0.2 : (pos >= 0.35 && pos < 0.55)) ? 1 : 0;
    case 'echo_bounce': { const stage = Math.min(Math.floor(pos * 6), 5); return (stage % 2 === 0) === inner ? BOUNCE[stage] : 0; }
    case 'ramp_swap': return inner ? pos : 1 - pos;
    case 'steps_cross': return inner ? step4(pos) : 1.25 - step4(pos);
    case 'tease_pulse': return inner ? 0.4 : (frac(pos * 2) < 0.35 ? 1 : 0);
    case 'rumble_pulse': return inner ? wave(pos) : (frac(pos * 4) < 0.3 ? 1 : 0);
    case 'surge_layer': return inner ? Math.sqrt(wave(pos)) : 0.6 * wave(pos);
    default: return patternLevel(key, phase);
  }
}

// Random: bursts of a pattern (or a run of random steps) with rests between.
// `intensity` (0-1) sets how much of the time something is on.
const BURST_MEAN_S = 14;
export class RandomProgram {
  constructor(motors = 1, intensity = 0.75, rng = Math.random) {
    this.motors = motors; this.intensity = intensity; this.rng = rng;
    this._next(true);
  }

  _next(burst) {
    const r = this.rng;
    this.t = 0;
    if (!burst) {
      const duty = Math.min(0.96, Math.max(0.05, this.intensity * this.intensity));
      this.seg = { rest: true };
      this.left = Math.min(300, Math.max(0.4, -Math.log(1 - r() * 0.999) * BURST_MEAN_S * (1 - duty) / duty));
      return;
    }
    this.left = 3 + r() * 22;
    if (r() < 0.3) {
      const n = 3 + Math.floor(r() * 6);
      this.seg = { steps: Array.from({ length: n }, () => 0.15 + 0.85 * r()), every: 0.4 + r() * 2.1 };
      return;
    }
    const keys = this.motors > 1 ? Object.keys(PATTERNS_DUAL) : Object.keys(PATTERNS).filter((k) => k !== 'steady');
    this.seg = { key: keys[Math.min(keys.length - 1, Math.floor(r() * keys.length))], level: 0.3 + 0.7 * r(), period: 0.6 + r() * 5.4 };
  }

  // One step of dt milliseconds: the two motors' levels (0-1).
  step(dtMs) {
    const dt = dtMs / 1000;
    this.left -= dt;
    this.t += dt;
    if (this.left <= 0) this._next(Boolean(this.seg.rest));
    const s = this.seg;
    if (s.rest) return [0, 0];
    if (s.steps) { const v = s.steps[Math.floor(this.t / s.every) % s.steps.length]; return [v, v]; }
    const ph = this.t / s.period;
    if (this.motors > 1) return [0, 1].map((m) => patternDual(s.key, ph, m) * s.level);
    const v = patternLevel(s.key, ph) * s.level;
    return [v, v];
  }
}

// Speed slider (0-100) to the length of one cycle: 8 s down to 0.5 s.
export const patternPeriod = (speed) => 8 * Math.pow(0.5 / 8, Math.min(100, Math.max(0, speed)) / 100);
