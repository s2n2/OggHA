/* Ogg Together remote, built from studio-card/src/guest (npm run build). Do not edit here. */
(() => {
  // studio-card/src/lib/outputs.js
  function sampleAt(actions, ms) {
    if (!actions || !actions.length || ms < actions[0].at) return 0;
    let lo = 0, hi = actions.length - 1;
    if (ms >= actions[hi].at) return actions[hi].pos;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (actions[mid].at <= ms) lo = mid;
      else hi = mid;
    }
    const a = actions[lo], b = actions[hi];
    return b.at === a.at ? b.pos : a.pos + (b.pos - a.pos) * (ms - a.at) / (b.at - a.at);
  }

  // studio-card/src/lib/stroke.js
  var STROKE_TOP = 400;

  // studio-card/src/lib/ai.js
  var clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function aiRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = s + 1831565813 >>> 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // studio-card/src/lib/moods.js
  function moodTrack(start, stroke) {
    const a = [{ at: 0, pos: start }];
    let t = 0, v = start;
    const b = {
      get t() {
        return t;
      },
      get v() {
        return v;
      },
      to(p, ms) {
        p = clampN(Math.round(p), 0, 100);
        if (stroke) ms = Math.max(ms, Math.abs(p - v) / (STROKE_TOP / 1e3));
        t += Math.max(1, Math.round(ms));
        v = p;
        a.push({ at: t, pos: p });
        return b;
      },
      hold(ms) {
        t += Math.max(1, Math.round(ms));
        a.push({ at: t, pos: v });
        return b;
      },
      jump(p) {
        return b.to(p, 1);
      },
      until(end, fn) {
        let g = 0;
        while (t < end && g++ < 4e3) fn();
        return b;
      },
      done() {
        return a;
      }
    };
    return b;
  }
  var jit = (r, x, by = 0.1) => x * (1 - by + 2 * by * r());
  var BLE_PULSE = 250;
  var MS = {
    strokes: (lo, hi, half) => (b, end, r) => b.until(end, () => {
      const h = jit(r, half);
      b.to(hi, h).to(lo, h);
    }),
    breathe: (lo, hi, half) => (b, end, r) => b.until(end, () => {
      const h = jit(r, half);
      b.to(hi, h).hold(350).to(lo, h).hold(550);
    }),
    park: (pos) => (b, end) => {
      b.to(pos, 700);
      if (b.t < end) b.hold(end - b.t);
    },
    ramp: (from, to) => (b, end, r) => {
      const start = b.t;
      b.until(end, () => {
        const k = clampN((b.t - start) / Math.max(1, end - start), 0, 1);
        const L = (i) => from[i] + (to[i] - from[i]) * k;
        b.to(L(1), jit(r, L(2), 0.05)).to(L(0), jit(r, L(2), 0.05));
      });
    },
    stopstart: (lo, hi, half, n, pause) => (b, end, r) => b.until(end, () => {
      for (let i = 0; i < n; i++) b.to(hi, half).to(lo, half);
      b.hold(jit(r, pause, 0.3));
    }),
    flick: (base, amp, half, n, pause) => (b, end, r) => b.until(end, () => {
      b.to(base, 300);
      for (let i = 0; i < n; i++) b.to(base - jit(r, amp, 0.2), half).to(base, half);
      b.hold(jit(r, pause, 0.3));
    }),
    gasp: () => (b, end, r) => b.until(end, () => {
      b.to(92, 900).hold(jit(r, 1100, 0.3)).to(8, 250).hold(700).to(60, 1500).hold(500);
    }),
    clutch: (lo, hi) => (b, end, r) => b.until(end, () => {
      b.to(lo + (hi - lo) * r(), 200).hold(500 + 900 * r());
    }),
    reach: (top, bottom, up, down) => (b, end, r) => b.until(end, () => {
      b.to(top, jit(r, up)).hold(jit(r, 800, 0.3)).to(bottom, jit(r, down)).hold(300);
    }),
    steps: (ranges, each, half) => (b, end) => b.until(end, () => {
      for (const [lo, hi] of ranges) {
        if (b.t >= end) break;
        const stop = Math.min(end, b.t + each);
        while (b.t < stop) b.to(hi, half).to(lo, half);
      }
    }),
    edge: () => (b, end, r) => b.until(end, () => {
      for (let i = 0; i < 8; i++) {
        const h = 450 - i * 25;
        b.to(95, h).to(15, h);
      }
      b.to(90, 300).hold(1500 + 1500 * r());
    }),
    mix: () => (b, end, r) => b.until(end, () => {
      const big = r() < 0.35;
      const amp = big ? 85 : 25 + 20 * r();
      const h = big ? 500 : 180 + 120 * r();
      b.to(55 + amp / 2, h).to(55 - amp / 2, h);
    }),
    surprise: () => (b, end, r) => b.until(end, () => {
      const k = r();
      if (k < 0.25) b.hold(600 + 1200 * r());
      else if (k < 0.5) for (let i = 0; i < 3; i++) b.to(70, 150).to(45, 150);
      else if (k < 0.75) b.to(98, 1200).to(3, 1200);
      else b.to(100 * r(), 200).hold(700);
    })
  };
  var MV = {
    level: (x) => (b, end) => {
      b.to(x, 300);
      if (b.t < end) b.hold(end - b.t);
    },
    ramp: (lo, hi) => (b, end) => {
      b.to(lo, 200);
      b.to(hi, Math.max(200, end - b.t));
    },
    wave: (lo, hi, period, phase = 0) => (b, end, r) => {
      if (phase) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase)), 300);
      b.until(end, () => {
        const p = jit(r, period);
        for (let k = 1; k <= 8; k++) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (k / 8 + phase))), p / 8);
      });
    },
    waveUp: (lo, hiFrom, hiTo, period) => (b, end, r) => {
      const start = b.t;
      b.until(end, () => {
        const p = jit(r, period);
        const hi = hiFrom + (hiTo - hiFrom) * clampN((b.t - start) / Math.max(1, end - start), 0, 1);
        for (let k = 1; k <= 8; k++) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / 8)), p / 8);
      });
    },
    // Pulses stay at least BLE_PULSE long, on and off: updates go out about
    // every 100 ms and Bluetooth adds delay, so shorter taps can be missed.
    pulses: (lvl, on, off, offFirst = false) => (b, end, r) => {
      on = Math.max(BLE_PULSE, on);
      off = Math.max(BLE_PULSE, off);
      if (offFirst) b.jump(0).hold(off);
      b.until(end, () => {
        b.jump(lvl).hold(on).jump(0).hold(Math.max(BLE_PULSE, jit(r, off, 0.15)));
      });
    },
    heartbeat: (lvl, bpm, delay = 0) => (b, end) => {
      const per = 6e4 / bpm, on1 = Math.max(220, per * 0.24), gap = Math.max(220, per * 0.2), on2 = Math.max(220, per * 0.22);
      const dub = per >= on1 + gap + on2 + BLE_PULSE;
      if (delay) b.jump(0).hold(delay);
      b.until(end, () => {
        b.jump(lvl).hold(on1).jump(0);
        if (dub) b.hold(gap).jump(lvl * 0.7).hold(on2).jump(0).hold(per - on1 - gap - on2);
        else b.hold(Math.max(BLE_PULSE, per - on1));
      });
    },
    buzz: (lvl) => (b, end, r) => b.until(end, () => {
      b.jump(Math.min(100, lvl + 6 + 4 * r())).hold(170).jump(lvl - 12).hold(170);
    }),
    // a ~3 Hz texture
    flicker: (lvl, base) => (b, end, r) => b.until(end, () => {
      b.jump(base).hold(300 + 500 * r());
      b.jump(lvl * (0.7 + 0.3 * r())).hold(BLE_PULSE + 80 * r());
    }),
    steps: (levels2, each) => (b, end) => b.until(end, () => {
      for (const x of levels2) {
        if (b.t >= end) break;
        b.jump(x).hold(Math.min(each, Math.max(1, end - b.t)));
      }
    }),
    bursts: (lvl, burst, gap, base = 0) => (b, end, r) => b.until(end, () => {
      b.to(lvl, 80).hold(jit(r, burst, 0.2)).to(base, 200).hold(jit(r, gap, 0.3));
    }),
    swell: (lo, hi, rise, fall, top) => (b, end) => b.until(end, () => {
      b.to(hi, rise).hold(top).to(lo, fall).hold(300);
    }),
    gasp: () => (b, end, r) => b.until(end, () => {
      b.to(25, 900).hold(jit(r, 1100, 0.3)).jump(95).hold(250).to(10, 700).hold(700).to(40, 1500).hold(500);
    }),
    clutch: (lo, hi) => (b, end, r) => b.until(end, () => {
      b.jump(lo + (hi - lo) * r()).hold(500 + 900 * r());
    }),
    random: (lo, hi) => (b, end, r) => b.until(end, () => {
      b.to(lo + (hi - lo) * r(), 150 + 500 * r()).hold(200 + 800 * r());
    }),
    edge: () => (b, end, r) => b.until(end, () => {
      b.to(70 + 20 * r(), 3600).jump(0).hold(1500 + 1500 * r());
    }),
    surprise: () => (b, end, r) => b.until(end, () => {
      const k = r();
      if (k < 0.25) b.jump(0).hold(600 + 1200 * r());
      else if (k < 0.5) for (let i = 0; i < 3; i++) b.jump(90).hold(BLE_PULSE).jump(0).hold(BLE_PULSE);
      else if (k < 0.75) b.to(80, 1200).to(10, 1200);
      else b.jump(30 + 70 * r()).hold(700);
    })
  };
  var MOODS = {
    rest: { icon: "🌙", label: "Rest", combos: [
      ["Still breath", [[3e4, MS.park(85), MV.wave(0, 12, 6e3)]]],
      ["Slow drift", [[3e4, MS.breathe(70, 90, 2500), MV.wave(4, 15, 8e3)]]],
      ["Quiet", [[2e4, MS.park(90), MV.level(0)], [1e4, MS.breathe(75, 90, 3e3), MV.heartbeat(10, 50)]]]
    ] },
    soft: { icon: "☁️", label: "Soft", combos: [
      ["Feather", [[3e4, MS.strokes(60, 90, 1300), MV.wave(8, 30, 5e3)]]],
      ["Cloud", [[3e4, MS.breathe(40, 80, 1800), MV.swell(10, 35, 2500, 2500, 800)]]],
      ["Gentle steps", [[3e4, MS.strokes(55, 85, 1e3), MV.steps([10, 18, 26, 18], 1500)]]]
    ] },
    tease: { icon: "😏", label: "Tease", combos: [
      ["Heartbeat tease", [[12e3, MS.flick(88, 12, 250, 4, 1500), MV.heartbeat(35, 62)], [6e3, MS.strokes(20, 90, 1500), MV.wave(10, 40, 4e3)], [12e3, MS.flick(85, 15, 220, 3, 2e3), MV.heartbeat(40, 70)]]],
      ["Stop-start", [[3e4, MS.stopstart(30, 85, 500, 4, 2200), MV.bursts(55, 2e3, 2200)]]],
      ["Almost", [[9e3, MS.ramp([65, 85, 700], [35, 95, 350]), MV.ramp(10, 70)], [3e3, MS.park(90), MV.level(0)], [9e3, MS.ramp([60, 85, 700], [30, 95, 320]), MV.ramp(15, 75)], [3e3, MS.park(92), MV.level(0)]]]
    ] },
    wave: { icon: "🌊", label: "Wave", combos: [
      ["Ocean", [[3e4, MS.strokes(10, 90, 1500), MV.wave(15, 75, 6e3)]]],
      ["Rolling", [[3e4, MS.breathe(20, 85, 1100), MV.swell(20, 70, 2200, 2200, 400)]]],
      ["Tide", [[15e3, MS.strokes(40, 80, 1200), MV.wave(20, 55, 5e3)], [15e3, MS.strokes(10, 95, 1400), MV.wave(30, 85, 5e3)]]]
    ] },
    gasp: { icon: "😮", label: "Gasp", combos: [
      ["Catch breath", [[3e4, MS.gasp(), MV.gasp()]]],
      ["Sudden", [[8e3, MS.strokes(60, 85, 600), MV.level(20)], [1500, MS.strokes(5, 95, 250), MV.level(95)], [4e3, MS.park(90), MV.level(5)], [8e3, MS.strokes(55, 85, 650), MV.level(25)], [1500, MS.strokes(5, 95, 250), MV.level(100)], [4e3, MS.park(90), MV.level(5)]]],
      ["Hold it", [[5e3, MS.strokes(70, 95, 300), MV.wave(30, 60, 1500)], [2500, MS.park(95), MV.level(0)], [1200, MS.strokes(5, 95, 280), MV.level(100)], [3e3, MS.park(60), MV.level(15)], [5e3, MS.strokes(70, 95, 300), MV.wave(30, 60, 1500)], [2500, MS.park(95), MV.level(0)], [1200, MS.strokes(5, 95, 280), MV.level(100)], [3e3, MS.park(60), MV.level(15)]]]
    ] },
    build: { icon: "📈", label: "Build", combos: [
      ["Climb", [[3e4, MS.ramp([65, 85, 900], [5, 95, 280]), MV.ramp(10, 95)]]],
      ["Stairs", [[3e4, MS.ramp([60, 85, 800], [10, 95, 320]), MV.steps([15, 30, 45, 60, 75, 90], 5e3)]]],
      ["Wave up", [[3e4, MS.ramp([50, 80, 1200], [5, 95, 350]), MV.waveUp(10, 40, 100, 2500)]]]
    ] },
    buzz: { icon: "🐝", label: "Buzz", combos: [
      ["Hum", [[3e4, MS.strokes(40, 60, 150), MV.buzz(75)]]],
      ["Hive", [[3e4, MS.strokes(30, 50, 130), MV.flicker(95, 60)]]],
      ["Static", [[3e4, MS.strokes(35, 55, 120), MV.random(55, 95)]]]
    ] },
    edge: { icon: "🎯", label: "Edge", combos: [
      ["Brink", [[3e4, MS.edge(), MV.edge()]]],
      ["Hold back", [[3e4, MS.stopstart(10, 95, 280, 6, 3500), MV.bursts(90, 2400, 3500)]]],
      ["Slow burn", [[22e3, MS.ramp([50, 85, 900], [10, 95, 300]), MV.ramp(20, 90)], [6e3, MS.park(92), MV.heartbeat(15, 50)]]]
    ] },
    frantic: { icon: "⚡", label: "Frantic", combos: [
      ["Rush", [[3e4, MS.strokes(25, 75, 110), MV.buzz(90)]]],
      ["Scramble", [[3e4, MS.mix(), MV.random(60, 100)]]],
      ["Flurry", [[3e4, MS.stopstart(30, 70, 100, 10, 400), MV.pulses(100, 900, 250)]]]
    ] },
    steady: { icon: "🎵", label: "Steady", combos: [
      ["Metronome", [[3e4, MS.strokes(20, 80, 600), MV.level(55)]]],
      ["Groove", [[3e4, MS.strokes(25, 85, 500), MV.pulses(65, 500, 500)]]],
      ["Cruise", [[3e4, MS.strokes(15, 85, 700), MV.wave(45, 65, 3e3)]]]
    ] },
    step: { icon: "🪜", label: "Step", combos: [
      ["Staircase", [[3e4, MS.steps([[70, 90], [55, 90], [40, 90], [25, 90], [10, 90]], 6e3, 600), MV.steps([20, 35, 50, 65, 80], 6e3)]]],
      ["Up and down", [[3e4, MS.steps([[70, 90], [50, 90], [30, 90], [10, 90], [30, 90], [50, 90]], 2500, 450), MV.steps([20, 40, 60, 80, 60, 40], 2500)]]],
      ["Terraces", [[3e4, MS.steps([[60, 90], [60, 90], [30, 90], [30, 90], [5, 95], [5, 95], [80, 92]], 2e3, 500), MV.steps([30, 30, 60, 60, 90, 90, 0], 2e3)]]]
    ] },
    bold: { icon: "🔥", label: "Bold", combos: [
      ["Pound", [[3e4, MS.strokes(5, 70, 300), MV.bursts(100, 250, 250, 60)]]],
      ["Full force", [[3e4, MS.strokes(5, 95, 330), MV.level(95)]]],
      ["Thunder", [[3e4, MS.breathe(5, 95, 350), MV.swell(70, 100, 400, 400, 300)]]]
    ] },
    embrace: { icon: "🤗", label: "Embrace", combos: [
      ["Hug", [[3e4, MS.breathe(10, 60, 1600), MV.wave(35, 70, 5e3), MV.wave(35, 70, 5e3, 0.5)]]],
      ["Hold close", [[3e4, MS.breathe(5, 30, 1200), MV.level(60), MV.swell(30, 75, 2e3, 2e3, 1e3)]]],
      ["Wrap", [[3e4, MS.strokes(5, 55, 1400), MV.swell(40, 80, 1800, 1800, 1500), MV.wave(40, 80, 5400, 0.5)]]]
    ] },
    tip: { icon: "👆", label: "Tip", combos: [
      ["Flicks", [[3e4, MS.flick(92, 12, 160, 6, 900), MV.flicker(70, 10)]]],
      ["Circling", [[3e4, MS.strokes(78, 98, 400), MV.wave(20, 55, 2e3)]]],
      ["Taps", [[3e4, MS.flick(95, 20, 200, 2, 1100), MV.pulses(60, 200, 1100)]]]
    ] },
    long: { icon: "↕️", label: "Long", combos: [
      ["Full length", [[3e4, MS.strokes(2, 98, 1300), MV.wave(25, 75, 2600)]]],
      ["Slow and deep", [[3e4, MS.breathe(2, 98, 1800), MV.swell(20, 80, 1800, 1800, 600)]]],
      ["Long pulls", [[3e4, MS.strokes(5, 95, 900), MV.pulses(70, 900, 900)]]]
    ] },
    surprise: { icon: "🎲", label: "Surprise", combos: [
      ["Wildcard", [[3e4, MS.surprise(), MV.surprise()]]],
      ["Jumble", [[8e3, MS.mix(), MV.random(30, 100)], [4e3, MS.park(90), MV.level(0)], [8e3, MS.strokes(5, 95, 300), MV.pulses(100, 300, 200)], [6e3, MS.flick(88, 15, 200, 3, 900), MV.heartbeat(40, 70)]]],
      ["Plot twist", [[1e4, MS.strokes(60, 90, 1200), MV.wave(10, 30, 4e3)], [2500, MS.strokes(5, 95, 250), MV.level(100)], [8e3, MS.breathe(40, 80, 1500), MV.heartbeat(30, 60)], [2500, MS.strokes(20, 80, 110), MV.buzz(90)]]]
    ] },
    grasp: { icon: "✊", label: "Grasp", combos: [
      ["Clutch", [[3e4, MS.clutch(10, 90), MV.clutch(30, 95)]]],
      ["Grip and release", [[3e4, MS.stopstart(5, 40, 400, 3, 1500), MV.bursts(85, 1500, 1500, 10)]]],
      ["Reach", [[3e4, MS.reach(95, 10, 600, 1400), MV.swell(20, 90, 600, 1400, 900)]]]
    ] },
    squeeze: { icon: "🫳", label: "Squeeze", combos: [
      ["Tight", [[3e4, MS.strokes(2, 25, 500), MV.bursts(85, 800, 400, 50)]]],
      ["Pulse squeeze", [[3e4, MS.strokes(5, 30, 300), MV.pulses(80, 300, 300), MV.pulses(80, 300, 300, true)]]],
      ["Hold squeeze", [[3e4, MS.breathe(2, 30, 700), MV.swell(40, 90, 700, 700, 900)]]]
    ] },
    heartbeat: { icon: "💓", label: "Heartbeat", combos: [
      ["Calm heart", [[3e4, MS.breathe(60, 80, 500), MV.heartbeat(45, 60)]]],
      ["Racing heart", [[3e4, MS.strokes(40, 70, 250), MV.heartbeat(70, 110)]]],
      ["Heart to heart", [[3e4, MS.strokes(30, 80, 500), MV.heartbeat(55, 75), MV.heartbeat(55, 75, 400)]]]
    ] },
    ripple: { icon: "〰️", label: "Ripple", combos: [
      ["Ripples", [[3e4, MS.strokes(50, 80, 250), MV.wave(30, 60, 800)]]],
      ["Shimmer", [[3e4, MS.strokes(40, 70, 180), MV.buzz(50)]]],
      ["Rings", [[3e4, MS.breathe(30, 80, 600), MV.swell(10, 60, 300, 900, 200)]]]
    ] },
    deep: { icon: "⬇️", label: "Deep", combos: [
      ["Depths", [[3e4, MS.strokes(2, 45, 900), MV.level(65)]]],
      ["Grind", [[3e4, MS.strokes(2, 20, 600), MV.wave(55, 85, 2400)]]],
      ["Plunge", [[3e4, MS.reach(80, 2, 900, 400), MV.bursts(90, 800, 900, 30)]]]
    ] },
    peak: { icon: "🌋", label: "Peak", combos: [
      ["Summit", [[2e4, MS.ramp([40, 85, 600], [2, 98, 260]), MV.ramp(40, 100)], [1e4, MS.strokes(2, 98, 260), MV.level(100)]]],
      ["Crescendo", [[3e4, MS.ramp([30, 80, 500], [2, 98, 250]), MV.steps([50, 60, 70, 80, 90, 100], 5e3)]]],
      ["Release", [[18e3, MS.strokes(5, 95, 280), MV.bursts(100, 700, 150, 80)], [8e3, MS.breathe(50, 90, 1500), MV.wave(10, 40, 4e3)], [4e3, MS.park(85), MV.heartbeat(20, 55)]]]
    ] },
    afterglow: { icon: "🌅", label: "Afterglow", combos: [
      ["Glow", [[3e4, MS.breathe(60, 90, 2500), MV.wave(5, 25, 7e3)]]],
      ["Linger", [[3e4, MS.strokes(50, 85, 2e3), MV.heartbeat(18, 50)]]],
      ["Warm", [[3e4, MS.park(80), MV.swell(5, 20, 3e3, 4e3, 2e3)]]]
    ] },
    playful: { icon: "🎈", label: "Playful", combos: [
      ["Tickle", [[3e4, MS.flick(85, 20, 150, 3, 600), MV.flicker(70, 0)]]],
      ["Bounce", [[3e4, MS.mix(), MV.pulses(60, 200, 300)]]],
      ["Peekaboo", [[3e4, MS.stopstart(40, 90, 300, 2, 900), MV.bursts(70, 600, 900)]]]
    ] }
  };
  function buildMood(sections, r) {
    const s = moodTrack(85, true), v1 = moodTrack(0, false), v2 = moodTrack(0, false);
    let end = 0, two = false;
    for (const [ms, sf, vf, vf2] of sections) {
      end += Math.round(jit(r, ms));
      sf(s, end, r);
      vf(v1, end, r);
      if (vf2) {
        two = true;
        vf2(v2, end, r);
      }
      const m = Math.max(s.t, v1.t, v2.t, end);
      for (const b of [s, v1, v2]) if (b.t < m) b.hold(m - b.t);
      end = m;
    }
    v1.to(0, 300);
    v2.to(0, 300);
    s.hold(300);
    return { stroke: s.done(), vibe: two ? [v1.done(), v2.done()] : [v1.done()] };
  }

  // studio-card/src/lib/patterns.js
  var PATTERNS = {
    steady: "Steady",
    pulse: "Pulse",
    wave: "Wave",
    breath: "Breath",
    ramp: "Ramp",
    peak: "Peak",
    heartbeat: "Heartbeat",
    double_pulse: "Double pulse",
    steps: "Steps",
    echo: "Echo",
    surge: "Surge",
    surf: "Surf",
    bounce: "Bounce",
    massage: "Massage",
    tease: "Tease",
    chachacha: "Cha-cha-cha",
    tempo: "Tempo"
  };
  var PATTERNS_DUAL = {
    dual_pulse: "Dual pulse",
    dual_wave: "Dual wave",
    ping_pong: "Ping-pong",
    chase: "Chase",
    counter_wave: "Counter wave",
    breath_offset: "Breath offset",
    heartbeat_split: "Heartbeat split",
    double_pulse_split: "Double pulse split",
    echo_bounce: "Echo bounce",
    ramp_swap: "Ramp swap",
    steps_cross: "Steps cross",
    tease_pulse: "Tease + pulse",
    rumble_pulse: "Rumble + pulse",
    surge_layer: "Surge layer"
  };
  var PATTERN_RANDOM = "random";
  var frac = (x) => (x % 1 + 1) % 1;
  var wave = (pos) => (1 - Math.cos(2 * Math.PI * pos)) / 2;
  var step4 = (pos) => (Math.min(Math.floor(pos * 4), 3) + 1) / 4;
  var ECHO = [1, 0, 0.65, 0, 0.35, 0];
  var BOUNCE = [1, 0.8, 0.6, 0.45, 0.3, 0.15];
  function patternLevel(key, phase) {
    const pos = frac(phase);
    switch (key) {
      case "steady":
        return 1;
      case "pulse":
        return pos < 0.5 ? 1 : 0;
      case "wave":
      case "tide":
        return wave(pos);
      case "breath":
        return Math.pow(wave(pos), 1.5);
      case "ramp":
        return pos;
      case "peak":
        return 1 - Math.abs(2 * pos - 1);
      case "heartbeat":
        return pos < 0.13 ? 1 : pos >= 0.25 && pos < 0.4 ? 0.7 : 0;
      case "double_pulse":
        return pos < 0.2 || pos >= 0.35 && pos < 0.55 ? 1 : 0;
      case "steps":
      case "step":
        return step4(pos);
      case "echo":
        return ECHO[Math.min(Math.floor(pos * 6), 5)];
      case "surge":
      case "crest":
        return Math.sqrt(wave(pos));
      case "surf":
        return wave(pos) * (0.65 + 0.35 * Math.pow(Math.sin(6 * Math.PI * pos), 2));
      case "bounce":
        return Math.abs(Math.sin(2 * Math.PI * pos)) * (1 - 0.4 * pos);
      case "massage":
        return 0.3 + 0.7 * wave(pos);
      case "tease":
        return pos < 0.8 ? pos * 1.25 : 0;
      case "chachacha":
        return pos < 0.14 || pos >= 0.25 && pos < 0.39 || pos >= 0.5 && pos < 0.64 ? 1 : 0;
      case "tempo":
        return frac(pos * 3) < 0.5 ? 1 : 0;
      default:
        return 0;
    }
  }
  function patternDual(key, phase, motor) {
    const pos = frac(phase);
    const inner = motor === 0;
    switch (key) {
      case "dual_steady":
        return 1;
      case "dual_pulse":
        return pos < 0.5 ? 1 : 0;
      case "dual_wave":
        return wave(pos);
      case "ping_pong":
        return (inner ? pos < 0.5 || pos > 0.96 : pos > 0.46) ? 1 : 0;
      case "chase":
        return wave(frac(pos - 0.25 * motor));
      case "counter_wave":
        return inner ? wave(pos) : 1 - wave(pos);
      case "breath_offset":
        return Math.pow(wave(frac(pos - 0.5 * motor)), 1.5);
      case "heartbeat_split":
        return inner ? pos < 0.13 ? 1 : 0 : pos >= 0.25 && pos < 0.4 ? 0.8 : 0;
      case "double_pulse_split":
        return (inner ? pos < 0.2 : pos >= 0.35 && pos < 0.55) ? 1 : 0;
      case "echo_bounce": {
        const stage = Math.min(Math.floor(pos * 6), 5);
        return stage % 2 === 0 === inner ? BOUNCE[stage] : 0;
      }
      case "ramp_swap":
        return inner ? pos : 1 - pos;
      case "steps_cross":
        return inner ? step4(pos) : 1.25 - step4(pos);
      case "tease_pulse":
        return inner ? 0.4 : frac(pos * 2) < 0.35 ? 1 : 0;
      case "rumble_pulse":
        return inner ? wave(pos) : frac(pos * 4) < 0.3 ? 1 : 0;
      case "surge_layer":
        return inner ? Math.sqrt(wave(pos)) : 0.6 * wave(pos);
      default:
        return patternLevel(key, phase);
    }
  }
  var BURST_MEAN_S = 14;
  var RandomProgram = class {
    constructor(motors = 1, intensity = 0.75, rng = Math.random) {
      this.motors = motors;
      this.intensity = intensity;
      this.rng = rng;
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
      const keys = this.motors > 1 ? Object.keys(PATTERNS_DUAL) : Object.keys(PATTERNS).filter((k) => k !== "steady");
      this.seg = { key: keys[Math.min(keys.length - 1, Math.floor(r() * keys.length))], level: 0.3 + 0.7 * r(), period: 0.6 + r() * 5.4 };
    }
    // One step of dt milliseconds: the two motors' levels (0-1).
    step(dtMs) {
      const dt = dtMs / 1e3;
      this.left -= dt;
      this.t += dt;
      if (this.left <= 0) this._next(Boolean(this.seg.rest));
      const s = this.seg;
      if (s.rest) return [0, 0];
      if (s.steps) {
        const v2 = s.steps[Math.floor(this.t / s.every) % s.steps.length];
        return [v2, v2];
      }
      const ph = this.t / s.period;
      if (this.motors > 1) return [0, 1].map((m) => patternDual(s.key, ph, m) * s.level);
      const v = patternLevel(s.key, ph) * s.level;
      return [v, v];
    }
  };
  var patternPeriod = (speed) => 8 * Math.pow(0.5 / 8, Math.min(100, Math.max(0, speed)) / 100);

  // studio-card/src/guest/index.js
  var $ = (id) => document.getElementById(id);
  var OWNER = { his: "His", hers: "Hers", unassigned: "" };
  var url = location.href.replace(/^http/, "ws").replace(/[?#].*$/, "").replace(/\/$/, "") + "/ws";
  var ws = null;
  var tries = 0;
  var ended = false;
  var tab = "manual";
  var level = 0;
  var pt = null;
  var mood = null;
  var sent = "";
  var sentAt = 0;
  var incoming = 0;
  var lastIn = 0;
  var tapAt = 0;
  var offer = [];
  var mine = /* @__PURE__ */ new Set();
  var state = (text, live) => {
    $("state").textContent = text;
    $("state").classList.toggle("wait", !live);
  };
  var send = (data) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
  };
  function levels(dtMs) {
    if (tab === "manual" || !pt && !mood) return [Math.round(level)];
    if (pt) {
      const speed = Number($("ptspeed").value);
      const k2 = Number($("ptstr").value) / 100;
      if (pt.prog) {
        pt.prog.intensity = 0.4 + 0.58 * speed / 100;
        return pt.prog.step(dtMs).map((v) => Math.round(v * 100 * k2));
      }
      pt.phase += dtMs / 1e3 / patternPeriod(speed);
      const dual = pt.key in PATTERNS_DUAL;
      return (dual ? [0, 1].map((m) => patternDual(pt.key, pt.phase, m)) : [patternLevel(pt.key, pt.phase)]).map((v) => Math.round(v * 100 * k2));
    }
    const t = performance.now() - mood.t0;
    if (t >= mood.len) nextMood(false);
    const k = Number($("moodstr").value) / 100;
    return mood.vibe.map((track) => Math.round(sampleAt(track, performance.now() - mood.t0) * k));
  }
  function nextMood(start) {
    const m = MOODS[mood.key];
    let i;
    do {
      i = Math.floor(Math.random() * m.combos.length);
    } while (m.combos.length > 1 && i === mood.combo);
    const [name, sections] = m.combos[i];
    const built = buildMood(sections, aiRandom(Math.random() * 2 ** 32 >>> 0));
    const len = Math.max(...built.vibe.map((tr) => tr.length ? tr[tr.length - 1].at : 0));
    Object.assign(mood, { combo: i, vibe: built.vibe, len: Math.max(1e3, len), t0: performance.now(), name });
    if (start) show();
  }
  function show() {
    for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
    for (const t of ["manual", "pattern", "mood"]) $(`t-${t}`).hidden = t !== tab;
    $("fill").style.height = `${level}%`;
    $("pct").textContent = `${Math.round(level)}%`;
    const random = pt ? Boolean(pt.prog) : $("ptsel").value === PATTERN_RANDOM;
    $("speedlab").textContent = random ? "How busy" : "Speed";
    $("ptspeedv").textContent = random ? `${$("ptspeed").value}%` : `${patternPeriod(Number($("ptspeed").value)).toFixed(1)} s`;
    $("ptstrv").textContent = `${$("ptstr").value}%`;
    $("moodstrv").textContent = `${$("moodstr").value}%`;
    $("ptgo").textContent = pt ? "■ Stop" : "▶ Play";
    $("ptgo").classList.toggle("on", Boolean(pt));
    for (const b of document.querySelectorAll("#moods button")) b.classList.toggle("on", Boolean(mood && b.dataset.mood === mood.key));
    $("moodinfo").textContent = mood ? `${MOODS[mood.key].icon} ${MOODS[mood.key].label}: ${mood.name || ""}` : "";
    $("toysec").hidden = !offer.length;
    $("toys").replaceChildren(...offer.map((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `toy${mine.has(d.k) ? " on" : ""}`;
      b.innerHTML = `<span>${d.name.replace(/[&<>"]/g, "")}</span>${OWNER[d.owner] ? `<span class="chip ${d.owner}">${OWNER[d.owner]}</span>` : ""}`;
      b.addEventListener("click", () => {
        if (mine.has(d.k)) mine.delete(d.k);
        else if (mine.size < 4) mine.add(d.k);
        send({ mine: [...mine] });
        show();
      });
      return b;
    }));
  }
  function stopAll(tell) {
    level = 0;
    pt = null;
    mood = null;
    incoming = 0;
    $("in").style.width = "0";
    if ($("buzz").checked && navigator.vibrate) navigator.vibrate(0);
    if (tell) send({ stop: true });
    send({ v: [0] });
    sent = "0";
    show();
  }
  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0;
      state("Waiting for your partner…", false);
      hello();
    };
    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (data.stop) {
        stopAll(false);
        state("Your partner pressed Stop", true);
      }
      if (Array.isArray(data.v)) {
        incoming = Math.max(...data.v);
        lastIn = Date.now();
        $("in").style.width = `${incoming}%`;
      }
      if (data.name) $("inlbl").textContent = `From ${data.name}`;
      if (typeof data.accept === "boolean") state(data.accept ? "You are playing their toys" : "Connected: waiting for them to let you play", data.accept);
      if (Array.isArray(data.devices)) {
        offer = data.devices;
        mine = new Set([...mine].filter((k) => offer.some((d) => d.k === k)));
        show();
      }
      if (typeof data.rec === "boolean") $("recnote").hidden = !data.rec;
      if (typeof data.sync === "boolean") {
        $("syncnote").hidden = !data.sync;
        $("ctlh").textContent = data.sync ? "Both of your toys" : "Your partner's toys";
      }
    };
    ws.onclose = () => {
      ws = null;
      if (ended) return;
      if (++tries > 5) {
        ended = true;
        state("This link has ended", false);
        return;
      }
      state("Connection lost: trying again…", false);
      setTimeout(connect, 1500 * tries);
    };
  }
  function hello() {
    const name = $("name").value.trim();
    if (name) send({ name });
    send({ accept: false });
    if (mine.size) send({ mine: [...mine] });
  }
  $("name").addEventListener("change", hello);
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => {
    tab = b.dataset.tab;
    show();
  });
  var pad = $("pad");
  var at = (e) => {
    const r = pad.getBoundingClientRect();
    level = Math.min(100, Math.max(0, (r.bottom - e.clientY) / r.height * 100));
    show();
  };
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    const now = Date.now();
    if (now - tapAt < 300) {
      level = 0;
      tapAt = 0;
      show();
      return;
    }
    tapAt = now;
    at(e);
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.buttons || e.pointerType === "touch") at(e);
  });
  var group = (label, entries) => {
    const g = document.createElement("optgroup");
    g.label = label;
    g.append(...entries.map(([k, t]) => new Option(t, k)));
    return g;
  };
  $("ptsel").replaceChildren(new Option("🎲 Random", PATTERN_RANDOM), group("Patterns", Object.entries(PATTERNS)), group("Two motors", Object.entries(PATTERNS_DUAL)));
  $("ptsel").value = "wave";
  var startPattern = (key) => {
    mood = null;
    pt = { key, phase: 0, prog: key === PATTERN_RANDOM ? new RandomProgram(2) : null };
    show();
  };
  $("ptgo").addEventListener("click", () => {
    if (pt) {
      pt = null;
      show();
    } else startPattern($("ptsel").value);
  });
  $("ptsel").addEventListener("change", () => {
    if (pt) startPattern($("ptsel").value);
    else show();
  });
  for (const id of ["ptspeed", "ptstr", "moodstr"]) $(id).addEventListener("input", show);
  $("moods").replaceChildren(...Object.entries(MOODS).map(([key, m]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mood = key;
    b.textContent = `${m.icon} ${m.label}`;
    b.addEventListener("click", () => {
      if (mood && mood.key === key) {
        mood = null;
        show();
        return;
      }
      pt = null;
      mood = { key, combo: -1 };
      nextMood(true);
    });
    return b;
  }));
  $("stop").addEventListener("click", () => {
    stopAll(true);
    state("Stopped", false);
  });
  var last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const v = levels(now - last);
    last = now;
    const key = v.join(",");
    if (key !== sent || v.some((x) => x > 0) && Date.now() - sentAt >= 500) {
      send({ v });
      sent = key;
      sentAt = Date.now();
    }
    if (Date.now() - lastIn > 1500 && incoming) {
      incoming = 0;
      $("in").style.width = "0";
    }
    if ($("buzz").checked && navigator.vibrate) navigator.vibrate(incoming > 3 ? Math.round(incoming * 0.9) : 0);
  }, 100);
  setInterval(() => send({ ping: true }), 1e4);
  addEventListener("pagehide", () => send({ v: [0] }));
  show();
  connect();
})();
