/* Ogg Together remote, built from studio-card/src/guest (npm run build). Do not edit here. */
(() => {
  // studio-card/src/lib/convert.js
  var RUN_MODES = {
    speed: "Speed: faster strokes vibrate harder",
    position: "Position: higher = stronger (vibration scripts)",
    upper: "Position above 50%: 50% and below = off, 75% = half power",
    combo: "Speed + position combined",
    down: "Speed, downstrokes only",
    up: "Speed, upstrokes only"
  };
  var isStroke = (script) => Boolean(script && script.metadata && script.metadata.type === "stroke");
  var speedIntensity = (dpos, dtMs) => dtMs > 0 ? Math.min(100, Math.abs(dpos) / dtMs * 250) : 0;
  function moveIntensity(mode, from2, to, dtMs) {
    const s = speedIntensity(to - from2, dtMs);
    if (mode === "down") return to < from2 ? s : 0;
    if (mode === "up") return to > from2 ? s : 0;
    if (mode === "combo") return s + (100 - s) * 0.35 * ((from2 + to) / 2) / 100;
    return s;
  }
  var upperHalf = (pos) => Math.max(0, Math.round((pos - 50) * 2));
  var cleanActions = (actions) => (Array.isArray(actions) ? actions : []).filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.pos)).map((x) => ({ at: Math.max(0, Math.round(x.at)), pos: Math.round(Math.min(100, Math.max(0, x.pos))) })).sort((x, y) => x.at - y.at);
  function toIntensity(actions, mode) {
    const a = cleanActions(actions);
    if (mode === "upper") return a.map((x) => ({ at: x.at, pos: upperHalf(x.pos) }));
    if (!RUN_MODES[mode] || mode === "position" || a.length < 2) return a;
    const out = [];
    const push = (at2, pos) => {
      const last2 = out[out.length - 1];
      if (last2 && last2.at >= at2) last2.pos = pos;
      else out.push({ at: at2, pos });
    };
    for (let i = 1; i < a.length; i++) {
      const v = Math.round(moveIntensity(mode, a[i - 1].pos, a[i].pos, a[i].at - a[i - 1].at));
      push(a[i - 1].at, v);
      if (a[i].at - a[i - 1].at > 1) push(a[i].at - 1, v);
    }
    push(a[a.length - 1].at, 0);
    return out;
  }
  function runScript(script, mode) {
    if (!isStroke(script)) return script;
    const out = { ...script, actions: toIntensity(script.actions, mode), metadata: { ...script.metadata, type: "vibration" } };
    if (script.channels && script.channels.V1) out.channels = { V1: { actions: toIntensity(script.channels.V1.actions, mode) } };
    return out;
  }

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
  var hashUnit = (n) => {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  // studio-card/src/lib/moods.js
  function moodTrack(start2, stroke) {
    const a = [{ at: 0, pos: start2 }];
    let t = 0, v = start2;
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
    ramp: (from2, to) => (b, end, r) => {
      const start2 = b.t;
      b.until(end, () => {
        const k = clampN((b.t - start2) / Math.max(1, end - start2), 0, 1);
        const L = (i) => from2[i] + (to[i] - from2[i]) * k;
        b.to(L(1), jit(r, L(2), 0.05)).to(L(0), jit(r, L(2), 0.05));
      });
    },
    stopstart: (lo, hi, half, n, pause) => (b, end, r) => b.until(end, () => {
      for (let i = 0; i < n; i++) b.to(hi, half).to(lo, half);
      b.hold(jit(r, pause, 0.3));
    }),
    flick: (base2, amp, half, n, pause) => (b, end, r) => b.until(end, () => {
      b.to(base2, 300);
      for (let i = 0; i < n; i++) b.to(base2 - jit(r, amp, 0.2), half).to(base2, half);
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
      const start2 = b.t;
      b.until(end, () => {
        const p = jit(r, period);
        const hi = hiFrom + (hiTo - hiFrom) * clampN((b.t - start2) / Math.max(1, end - start2), 0, 1);
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
    flicker: (lvl, base2) => (b, end, r) => b.until(end, () => {
      b.jump(base2).hold(300 + 500 * r());
      b.jump(lvl * (0.7 + 0.3 * r())).hold(BLE_PULSE + 80 * r());
    }),
    steps: (levels2, each) => (b, end) => b.until(end, () => {
      for (const x of levels2) {
        if (b.t >= end) break;
        b.jump(x).hold(Math.min(each, Math.max(1, end - b.t)));
      }
    }),
    bursts: (lvl, burst, gap, base2 = 0) => (b, end, r) => b.until(end, () => {
      b.to(lvl, 80).hold(jit(r, burst, 0.2)).to(base2, 200).hold(jit(r, gap, 0.3));
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
  var MOOD_TIP = 95;
  var MOOD_BASE = 5;
  var MOOD_EASE = 1500;
  function moodAnchor(ms) {
    let start2 = 0, i = 0, prev = MOOD_TIP;
    for (; ; ) {
      const len = 1e4 + 6e3 * hashUnit(i + 7);
      const here = i % 2 ? MOOD_BASE : MOOD_TIP;
      if (ms < start2 + len) {
        const k = i === 0 ? 1 : Math.min(1, (ms - start2) / MOOD_EASE);
        return prev + (here - prev) * (0.5 - 0.5 * Math.cos(Math.PI * k));
      }
      start2 += len;
      prev = here;
      i++;
    }
  }
  var moodSoften = (pos, k, ms = 0) => {
    const a = moodAnchor(ms);
    return a + (pos - a) * k;
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

  // studio-card/src/lib/core.js
  var PLAY = {
    name: "OggStudio Play",
    sub: "Manual, pattern, mood, library, video and sound: record any of them",
    parts: ["record", "video", "take"],
    simple: true,
    size: 10,
    description: "Everything in one card: play by hand, a pattern, a mood, a saved script, a video or sound, record any of it, and Together, script editing, a queue and the lock."
  };
  var PLAY_STROKE = { ...PLAY, parts: ["stroke", "video", "take"], hidden: true };
  var VARIANTS = {
    "oggstudio-play-card": PLAY,
    "oggstudio-card": { ...PLAY, hidden: true },
    "oggstudio-recorder-card": { ...PLAY, hidden: true },
    "oggstudio-player-card": { ...PLAY, hidden: true },
    "oggstudio-video-card": { ...PLAY, hidden: true },
    "oggstudio-stroke-card": PLAY_STROKE,
    "oggstudio-play-stroke-card": PLAY_STROKE,
    "oggstudio-video-stroke-card": PLAY_STROKE,
    "oggstudio-together-card": { ...PLAY, hidden: true }
  };
  var duration = (s) => Math.max(
    s.actions.length ? s.actions[s.actions.length - 1].at : 0,
    s.channels && s.channels.V1.actions.length ? s.channels.V1.actions[s.channels.V1.actions.length - 1].at : 0
  );

  // studio-card/src/card/screenoff.js
  var SO_AHEAD_MS = 10 * 60 * 1e3;
  var SO_SCRIPT_MAX_MS = 60 * 60 * 1e3;
  var SO_MAX_S = 60 * 60;
  function simplify(points, tol = 1) {
    if (points.length <= 2) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const pa = points[a], pb = points[b];
      let worst = -1, at2 = -1;
      for (let i = a + 1; i < b; i++) {
        const p = points[i];
        const f = pb.at === pa.at ? 0 : (p.at - pa.at) / (pb.at - pa.at);
        const d = Math.abs(p.pos - (pa.pos + (pb.pos - pa.pos) * f));
        if (d > worst) {
          worst = d;
          at2 = i;
        }
      }
      if (worst > tol) {
        keep[at2] = 1;
        stack.push([a, at2], [at2, b]);
      }
    }
    return points.filter((p, i) => keep[i]);
  }

  // studio-card/src/lib/compose.js
  var STEP_MS = 50;
  var MAX_STEP_MS = 60 * 60 * 1e3;
  var MAX_TOTAL_MS = 6 * 60 * 60 * 1e3;
  var DURATIONS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600];
  var clamp = (v) => Math.min(100, Math.max(0, v));
  var isDual = (key) => key in PATTERNS_DUAL;
  function clock(ms) {
    const s = Math.max(0, Math.round(ms / 1e3));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    const two = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
  }
  function parseTime(text) {
    const s = String(text || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!s) return null;
    if (/^\d+(:\d{1,2}){1,2}$/.test(s)) return s.split(":").reduce((n, x) => n * 60 + Number(x), 0);
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const m = /^(?:(\d+(?:\.\d+)?)h(?:ours?|rs?)?)?(?:(\d+(?:\.\d+)?)m(?:in(?:ute)?s?)?)?(?:(\d+(?:\.\d+)?)s(?:ec(?:ond)?s?)?)?$/.exec(s);
    if (!m || !m[1] && !m[2] && !m[3]) return null;
    return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  }
  function defaultName(ms, now2 = /* @__PURE__ */ new Date()) {
    const day = now2.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    const time = now2.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${clock(ms)} · ${day} ${time}`;
  }
  function cut(track, end) {
    const out = [];
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (p.at <= end) {
        out.push({ at: p.at, pos: p.pos });
        continue;
      }
      const q = track[i - 1];
      if (q && q.at < end) out.push({ at: end, pos: Math.round(q.pos + (p.pos - q.pos) * (end - q.at) / (p.at - q.at)) });
      break;
    }
    const last2 = out[out.length - 1];
    if (last2 && last2.at < end) out.push({ at: end, pos: last2.pos });
    return out;
  }
  function fill(track, ms) {
    const len = track.length ? track[track.length - 1].at : 0;
    if (!len) return [{ at: 0, pos: track.length ? track[0].pos : 0 }, { at: ms, pos: track.length ? track[0].pos : 0 }];
    const out = [];
    for (let by = 0; by < ms; by += len) {
      for (const p of track) {
        const at2 = p.at + by, last2 = out[out.length - 1];
        if (last2 && at2 <= last2.at) {
          if (p.pos !== last2.pos) out.push({ at: last2.at + 1, pos: p.pos });
          continue;
        }
        out.push({ at: at2, pos: p.pos });
      }
    }
    return cut(out, ms);
  }
  function renderPattern(key, ms, { level: level2 = 70, speed = 50, seed = 1 } = {}) {
    const top = clamp(level2), period = patternPeriod(speed) * 1e3;
    const rnd = key === PATTERN_RANDOM ? new RandomProgram(2, Math.max(0.1, top / 100), aiRandom(seed)) : null;
    const a = [], b = [];
    for (let t = 0; t <= ms; t += STEP_MS) {
      let va, vb;
      if (rnd) [va, vb] = rnd.step(t ? STEP_MS : 0).map((v) => v * 100);
      else if (isDual(key)) {
        va = patternDual(key, t / period, 0) * top;
        vb = patternDual(key, t / period, 1) * top;
      } else va = vb = patternLevel(key, t / period) * top;
      a.push({ at: t, pos: Math.round(clamp(va)) });
      b.push({ at: t, pos: Math.round(clamp(vb)) });
    }
    const dual = Boolean(rnd) || isDual(key);
    return { a: cut(simplify(a, 1.5), ms), b: dual ? cut(simplify(b, 1.5), ms) : null };
  }
  function renderMood(key, ms, { strength = 100, seed = 1 } = {}) {
    const mood2 = MOODS[key];
    if (!mood2) throw new Error("Unknown mood");
    const r = aiRandom(seed), k = clamp(strength) / 100;
    const stroke = [], a = [], b = [];
    let at2 = 0, last2 = -1, two = false;
    const add2 = (to, track, by) => {
      for (const p of track) {
        const t = p.at + by, prev = to[to.length - 1];
        if (prev && t <= prev.at) {
          if (prev.pos !== p.pos) to.push({ at: prev.at + 1, pos: p.pos });
          continue;
        }
        to.push({ at: t, pos: p.pos });
      }
    };
    for (let guard = 0; at2 < ms && guard < 1e3; guard++) {
      let i = Math.floor(r() * mood2.combos.length);
      if (mood2.combos.length > 1 && i === last2) i = (i + 1) % mood2.combos.length;
      last2 = i;
      const built = buildMood(mood2.combos[i][1], r);
      const len = Math.max(built.stroke[built.stroke.length - 1].at, ...built.vibe.map((v) => v[v.length - 1].at));
      add2(stroke, built.stroke, at2);
      add2(a, built.vibe[0], at2);
      if (built.vibe[1]) two = true;
      add2(b, built.vibe[1] || built.vibe[0], at2);
      at2 += len;
    }
    const soft = (track, fn) => track.map((p) => ({ at: p.at, pos: Math.round(clamp(fn(p))) }));
    return {
      stroke: cut(soft(stroke, (p) => k >= 1 ? p.pos : moodSoften(p.pos, k, p.at)), ms),
      a: cut(soft(a, (p) => p.pos * k), ms),
      b: two ? cut(soft(b, (p) => p.pos * k), ms) : null
    };
  }
  function renderStep(step, stroke, scripts, last2 = 0) {
    const ms = Math.min(MAX_STEP_MS, Math.max(1e3, Math.round(step.ms || 6e4)));
    if (step.type === "pause") {
      const hold = stroke ? last2 : 0;
      return { a: [{ at: 0, pos: hold }, { at: ms, pos: hold }], b: null, ms };
    }
    if (step.type === "mood") {
      const m = renderMood(step.key, ms, { strength: step.level ?? 100, seed: step.seed || 1 });
      return stroke ? { a: m.stroke, b: null, ms } : { a: m.a, b: m.b, ms };
    }
    if (step.type === "script") {
      const s = scripts && scripts.get(step.name);
      if (!s) throw new Error(`"${step.name}" is not in the library`);
      const src = !stroke && isStroke(s) ? runScript(s, "speed") : s;
      const second = src.channels && src.channels.V1 && src.channels.V1.actions.length ? src.channels.V1.actions : null;
      return { a: fill(src.actions, ms), b: !stroke && second ? fill(second, ms) : null, ms };
    }
    const p = renderPattern(step.key, ms, { level: step.level ?? 70, speed: step.speed ?? 50, seed: step.seed || 1 });
    return { a: p.a, b: stroke ? null : p.b, ms };
  }
  function composeScript(steps2, { stroke = false, title = "" } = {}, scripts = /* @__PURE__ */ new Map()) {
    if (!steps2.length) throw new Error("Add a step first");
    const A = [], B = [];
    let at2 = 0, two = false;
    const join = (to, track, by) => {
      for (const p of track) {
        const t = p.at + by, prev = to[to.length - 1];
        if (prev && t <= prev.at) {
          if (prev.pos !== p.pos) to.push({ at: prev.at + 1, pos: p.pos });
          continue;
        }
        to.push({ at: t, pos: p.pos });
      }
    };
    for (const step of steps2) {
      const last2 = A.length ? A[A.length - 1].pos : 50;
      const out = renderStep(step, stroke, scripts, last2);
      if (out.b) two = true;
      join(A, out.a, at2);
      join(B, out.b || out.a, at2);
      at2 += out.ms;
      if (at2 > MAX_TOTAL_MS) throw new Error("A script can be at most six hours long");
    }
    const script = {
      version: "1.0",
      inverted: false,
      range: 100,
      actions: A,
      metadata: { type: stroke ? "stroke" : "vibration", creator: "Ogg Queue", title: title || defaultName(at2), steps: steps2.length }
    };
    if (two) script.channels = { V1: { actions: B } };
    return script;
  }
  var stepsMs = (steps2) => steps2.reduce((n, s) => n + Math.min(MAX_STEP_MS, Math.max(1e3, Math.round(s.ms || 6e4))), 0);

  // studio-card/src/guest/queue.js
  var $ = (id) => document.getElementById(id);
  var esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var base = location.href.replace(/[?#].*$/, "").replace(/\/$/, "") + "/queue";
  var KEEP = "ogg_together_queue";
  var WHO = { his: "His", hers: "Hers" };
  var KIND = { pattern: "〰️", mood: "🎭", pause: "⏸" };
  var uid = () => Math.random().toString(36).slice(2, 9);
  var NEW = {
    pattern: () => ({ type: "pattern", key: "wave", ms: 6e4, level: 70, speed: 50 }),
    mood: () => ({ type: "mood", key: Object.keys(MOODS)[0], ms: 12e4, level: 100, seed: 1 + Math.floor(Math.random() * 1e6) }),
    pause: () => ({ type: "pause", ms: 1e4 })
  };
  var items = {};
  var seg = "hers";
  var cur = null;
  var play = null;
  var from = 0;
  var steps = [];
  var onStart = () => {
  };
  var keepGet = () => {
    try {
      return JSON.parse(localStorage.getItem(KEEP) || "{}") || {};
    } catch (_) {
      return {};
    }
  };
  var keepSet = (patch) => {
    try {
      localStorage.setItem(KEEP, JSON.stringify({ ...keepGet(), ...patch }));
    } catch (_) {
    }
  };
  var msg = (text) => {
    $("qmsg").textContent = text;
    clearTimeout(msg.t);
    msg.t = setTimeout(() => {
      $("qmsg").textContent = "";
    }, 6e3);
  };
  var now = () => {
    if (!cur) return 0;
    const len = duration(cur.script);
    if (!play) return from;
    const t = play.from + (performance.now() - play.t0);
    return play.loop ? t % Math.max(1, len) : Math.min(len, t);
  };
  function queueLevels() {
    if (!play || !cur) return null;
    const t = now();
    if (!play.loop && t >= duration(cur.script)) {
      play = null;
      from = 0;
      show();
      return [0];
    }
    return cur.levels.map((track) => Math.round(Math.max(0, Math.min(100, sampleAt(track, t)))));
  }
  function queueStop() {
    if (play) {
      from = now();
      play = null;
      show();
    }
  }
  function load(next) {
    const s = isStroke(next.script) ? runScript(next.script, "speed") : next.script;
    const levels2 = [s.actions, ...s.channels && s.channels.V1 ? [s.channels.V1.actions] : []];
    cur = { ...next, levels: levels2 };
    play = null;
    from = 0;
    show();
  }
  function start() {
    if (!cur) return;
    onStart();
    if (from >= duration(cur.script) - 100) from = 0;
    play = { t0: performance.now(), from, loop: $("qloop").checked };
    if (cur.id && items[cur.id]) fetch(`${base}/${cur.id}`, { method: "POST" }).then(refresh).catch(() => {
    });
    show();
  }
  async function loadItem(id, andPlay) {
    const r = items[id];
    try {
      const res = await fetch(`${base}/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Gone");
      load({ id, name: r ? r.name : body.name, script: body.script });
      if (andPlay) start();
    } catch (e) {
      msg(`Could not load it: ${e.message || e}`);
    }
  }
  async function refresh() {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      items = (await res.json()).items || {};
      show();
    } catch (_) {
    }
  }
  function show() {
    const all = Object.entries(items);
    const of = (s) => all.filter(([, r]) => s === "played" ? r.played : !r.played && r.for === s);
    for (const b of document.querySelectorAll("#qseg button")) {
      const n = of(b.dataset.q).length;
      b.textContent = `${b.dataset.q === "his" ? "♂ His" : b.dataset.q === "hers" ? "♀ Hers" : "✓ Played"}${n ? ` (${n})` : ""}`;
      b.classList.toggle("on", b.dataset.q === seg);
    }
    const rows = of(seg).sort((a, b) => String((seg === "played" ? b[1].played : a[1].made) || "").localeCompare(String((seg === "played" ? a[1].played : b[1].made) || "")));
    $("qlist").innerHTML = rows.map(([id, r]) => `<div class="qitem${cur && cur.id === id ? " cur" : ""}" data-id="${esc(id)}"><div class="info"><div class="nm">${esc(r.name)}</div><div class="meta">${[clock(r.duration_ms), r.by ? `from ${esc(r.by)}` : "", seg === "played" ? WHO[r.for].toLowerCase() : ""].filter(Boolean).join(" · ")}</div></div><button type="button" class="on" aria-label="Play">▶</button></div>`).join("") || `<div class="empty">${seg === "played" ? "Nothing played yet." : `Nothing in ${WHO[seg].toLowerCase()} queue yet: make one below.`}</div>`;
    const opts = [
      '<option value="">Choose one to play…</option>',
      cur && !cur.id ? `<option value="cur">${esc(cur.name)} (${clock(duration(cur.script))})</option>` : "",
      ...["his", "hers", "played"].map((s) => {
        const list = of(s);
        return list.length ? `<optgroup label="${s === "played" ? "Played" : `${WHO[s]} queue`}">${list.map(([id, r]) => `<option value="${esc(id)}">${esc(r.name)} (${clock(r.duration_ms)})</option>`).join("")}</optgroup>` : "";
      })
    ].join("");
    if ($("qpick").dataset.h !== opts) {
      $("qpick").innerHTML = opts;
      $("qpick").dataset.h = opts;
    }
    $("qpick").value = cur ? cur.id || "cur" : "";
    showPlayer();
  }
  function showPlayer() {
    const len = cur ? duration(cur.script) : 0, t = now();
    $("qcur").style.width = len ? `${(100 * t / len).toFixed(2)}%` : "0";
    $("qtime").textContent = cur ? `${clock(t)} / ${clock(len)} · ${cur.name}` : "Pick one from a queue below, or make one.";
    $("qplay").textContent = play ? "↻ Restart" : "▶ Play";
    $("qplay").disabled = !cur;
  }
  function stepsShow() {
    $("steps").innerHTML = steps.map((s, i) => {
      const sec = Math.round(s.ms / 1e3);
      const lens = (DURATIONS.includes(sec) ? DURATIONS : [...DURATIONS, sec].sort((a, b) => a - b)).map((v) => `<option value="${v}"${v === sec ? " selected" : ""}>${clock(v * 1e3)}</option>`).join("") + '<option value="custom">Custom…</option>';
      const what = s.type === "pattern" ? `<optgroup label="Patterns">${Object.entries(PATTERNS).map(([k, n]) => `<option value="${k}"${k === s.key ? " selected" : ""}>${n}</option>`).join("")}<option value="${PATTERN_RANDOM}"${s.key === PATTERN_RANDOM ? " selected" : ""}>Random</option></optgroup><optgroup label="Two motors">${Object.entries(PATTERNS_DUAL).map(([k, n]) => `<option value="${k}"${k === s.key ? " selected" : ""}>${n}</option>`).join("")}</optgroup>` : s.type === "mood" ? Object.entries(MOODS).map(([k, m]) => `<option value="${k}"${k === s.key ? " selected" : ""}>${m.icon} ${m.label}</option>`).join("") : "<option>Nothing plays</option>";
      const slider = (f, lab, min, val) => `<div class="slider"><label>${lab}</label><input type="range" min="${min}" max="100" step="5" value="${val}" data-f="${f}"><b>${val}%</b></div>`;
      return `<div class="step" data-id="${s.id}"><div class="top"><div class="handle" tabindex="0" role="button" aria-label="Drag to move step ${i + 1}">⠿</div><span class="num">${i + 1}</span><span class="kind">${KIND[s.type]}</span><select data-f="what"${s.type === "pause" ? " disabled" : ""}>${what}</select><button type="button" class="x" data-x="1" aria-label="Remove step">✕</button></div><div class="slider"><label>Time</label><select data-f="ms">${lens}</select></div>` + (s.type === "pattern" ? slider("level", "Strength", 5, s.level ?? 70) + slider("speed", "Speed", 0, s.speed ?? 50) : s.type === "mood" ? slider("level", "Strength", 20, s.level ?? 100) : "") + "</div>";
    }).join("") || '<div class="empty">Add a pattern, a mood or a pause.</div>';
    totalShow();
  }
  function totalShow() {
    const ms = stepsMs(steps);
    $("qtotal").textContent = `${steps.length} step${steps.length === 1 ? "" : "s"} · total ${clock(ms)}`;
    $("qname").placeholder = `Name (default: ${defaultName(ms)})`;
    keepSet({ steps: steps.map(({ id, ...s }) => s) });
  }
  function compose() {
    try {
      const name = $("qname").value.trim() || defaultName(stepsMs(steps));
      return composeScript(steps, { title: name });
    } catch (e) {
      msg(e.message || String(e));
      return null;
    }
  }
  async function add(who) {
    const script = compose();
    if (!script) return;
    try {
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ for: who, name: script.metadata.title, script }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Not saved");
      $("qname").value = "";
      seg = who;
      msg(`Added "${body.name}" to ${WHO[who].toLowerCase()} queue: your partner can play it now or later.`);
      await refresh();
    } catch (e) {
      msg(`Could not add it: ${e.message || e}`);
    }
  }
  function bindSteps() {
    const box = $("steps");
    const find = (el) => {
      const row = el.closest(".step");
      return row ? steps.findIndex((s) => s.id === row.dataset.id) : -1;
    };
    box.addEventListener("input", (e) => {
      const i = find(e.target), f = e.target.dataset.f;
      if (i < 0 || f !== "level" && f !== "speed") return;
      steps[i][f] = Number(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value}%`;
      totalShow();
    });
    box.addEventListener("change", (e) => {
      const i = find(e.target), f = e.target.dataset.f;
      if (i < 0) return;
      if (f === "what") steps[i].key = e.target.value;
      if (f === "ms") {
        if (e.target.value === "custom") {
          const typed = window.prompt("How long? For example 7, 45s, 1:30 or 2m", clock(steps[i].ms));
          const sec = typed === null ? null : parseTime(typed);
          if (sec !== null && sec >= 1 && sec * 1e3 <= MAX_STEP_MS) steps[i].ms = Math.round(sec) * 1e3;
          else if (typed !== null) msg("Type a time from 1 second to an hour, like 7, 45s, 1:30 or 2m.");
          stepsShow();
          return;
        }
        steps[i].ms = Number(e.target.value) * 1e3;
      }
      totalShow();
    });
    box.addEventListener("click", (e) => {
      if (!e.target.closest("[data-x]")) return;
      const i = find(e.target);
      if (i >= 0) {
        steps.splice(i, 1);
        stepsShow();
      }
    });
    box.addEventListener("keydown", (e) => {
      if (!e.target.classList.contains("handle") || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const i = find(e.target), j = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= steps.length) return;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      stepsShow();
      box.querySelector(`.step[data-id="${steps[j].id}"] .handle`).focus();
    });
    box.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".handle");
      if (!h) return;
      e.preventDefault();
      const row = h.closest(".step");
      const rows = [...box.querySelectorAll(".step")];
      const at2 = rows.indexOf(row), rects = rows.map((r) => r.getBoundingClientRect()), y0 = e.clientY;
      let to = at2;
      try {
        h.setPointerCapture(e.pointerId);
      } catch (_) {
      }
      row.classList.add("drag");
      const move = (ev) => {
        const dy = ev.clientY - y0;
        row.style.transform = `translateY(${dy}px)`;
        const mid = rects[at2].top + rects[at2].height / 2 + dy;
        to = rects.findIndex((r) => mid < r.top + r.height / 2);
        if (to < 0) to = rects.length - 1;
        const gap = rects[at2].height + 8;
        rows.forEach((r, k) => {
          if (k === at2) return;
          const shift = at2 < to && k > at2 && k <= to ? -gap : at2 > to && k < at2 && k >= to ? gap : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : "";
        });
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        rows.forEach((r) => {
          r.style.transform = "";
        });
        row.classList.remove("drag");
        if (to !== at2) {
          const [s] = steps.splice(at2, 1);
          steps.splice(to, 0, s);
          stepsShow();
        }
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
  }
  function initQueue(opts) {
    onStart = opts.onStart || onStart;
    const kept = keepGet();
    steps = (Array.isArray(kept.steps) ? kept.steps.filter((s) => s && NEW[s.type]) : []).map((s) => ({ ...s, id: uid() }));
    if (!steps.length) steps = [{ ...NEW.pattern(), id: uid() }, { ...NEW.mood(), id: uid() }];
    seg = ["his", "hers", "played"].includes(kept.seg) ? kept.seg : "hers";
    $("qseg").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) {
        seg = b.dataset.q;
        keepSet({ seg });
        show();
      }
    });
    $("qlist").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) loadItem(b.closest(".qitem").dataset.id, true);
    });
    $("qpick").addEventListener("change", () => {
      const v = $("qpick").value;
      if (v && v !== "cur") loadItem(v, false);
    });
    $("qplay").addEventListener("click", () => {
      from = play ? 0 : from;
      start();
    });
    $("qstop").addEventListener("click", () => {
      play = null;
      from = 0;
      show();
      opts.onStop && opts.onStop();
    });
    $("qloop").addEventListener("change", () => {
      if (play) {
        from = now();
        start();
      }
    });
    $("qbar").addEventListener("pointerdown", (e) => {
      if (!cur) return;
      const r = $("qbar").getBoundingClientRect();
      from = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(cur.script);
      if (play) start();
      else showPlayer();
    });
    document.querySelector("#t-queue .adds").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-add]");
      if (!b) return;
      steps.push({ ...NEW[b.dataset.add](), id: uid() });
      stepsShow();
    });
    $("qhis").addEventListener("click", () => add("his"));
    $("qhers").addEventListener("click", () => add("hers"));
    $("qtry").addEventListener("click", () => {
      const script = compose();
      if (!script) return;
      load({ name: script.metadata.title, script });
      start();
    });
    bindSteps();
    stepsShow();
    show();
    setInterval(showPlayer, 250);
    setInterval(() => {
      if (!document.hidden) refresh();
    }, 2e4);
    refresh();
  }

  // studio-card/src/guest/index.js
  var $2 = (id) => document.getElementById(id);
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
    $2("state").textContent = text;
    $2("state").classList.toggle("wait", !live);
  };
  var send = (data) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
  };
  function levels(dtMs) {
    if (tab !== "manual") {
      const q = queueLevels();
      if (q) return q;
    }
    if (tab === "manual" || !pt && !mood) return [Math.round(level)];
    if (pt) {
      const speed = Number($2("ptspeed").value);
      const k2 = Number($2("ptstr").value) / 100;
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
    const k = Number($2("moodstr").value) / 100;
    return mood.vibe.map((track) => Math.round(sampleAt(track, performance.now() - mood.t0) * k));
  }
  function nextMood(start2) {
    const m = MOODS[mood.key];
    let i;
    do {
      i = Math.floor(Math.random() * m.combos.length);
    } while (m.combos.length > 1 && i === mood.combo);
    const [name, sections] = m.combos[i];
    const built = buildMood(sections, aiRandom(Math.random() * 2 ** 32 >>> 0));
    const len = Math.max(...built.vibe.map((tr) => tr.length ? tr[tr.length - 1].at : 0));
    Object.assign(mood, { combo: i, vibe: built.vibe, len: Math.max(1e3, len), t0: performance.now(), name });
    if (start2) show2();
  }
  function show2() {
    for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
    for (const t of ["manual", "pattern", "mood", "queue"]) $2(`t-${t}`).hidden = t !== tab;
    $2("fill").style.height = `${level}%`;
    $2("pct").textContent = `${Math.round(level)}%`;
    const random = pt ? Boolean(pt.prog) : $2("ptsel").value === PATTERN_RANDOM;
    $2("speedlab").textContent = random ? "How busy" : "Speed";
    $2("ptspeedv").textContent = random ? `${$2("ptspeed").value}%` : `${patternPeriod(Number($2("ptspeed").value)).toFixed(1)} s`;
    $2("ptstrv").textContent = `${$2("ptstr").value}%`;
    $2("moodstrv").textContent = `${$2("moodstr").value}%`;
    $2("ptgo").textContent = pt ? "■ Stop" : "▶ Play";
    $2("ptgo").classList.toggle("on", Boolean(pt));
    for (const b of document.querySelectorAll("#moods button")) b.classList.toggle("on", Boolean(mood && b.dataset.mood === mood.key));
    $2("moodinfo").textContent = mood ? `${MOODS[mood.key].icon} ${MOODS[mood.key].label}: ${mood.name || ""}` : "";
    $2("toyhint").textContent = offer.length ? "Tap yours: your partner can then play them." : "None free yet: your partner is using every connected toy. If one of them is yours, ask them to take it out of their Devices, and it shows up here.";
    $2("toys").replaceChildren(...offer.map((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `toy${mine.has(d.k) ? " on" : ""}`;
      b.innerHTML = `<span>${d.name.replace(/[&<>"]/g, "")}</span>${OWNER[d.owner] ? `<span class="chip ${d.owner}">${OWNER[d.owner]}</span>` : ""}`;
      b.addEventListener("click", () => {
        if (mine.has(d.k)) mine.delete(d.k);
        else if (mine.size < 4) mine.add(d.k);
        send({ mine: [...mine] });
        show2();
      });
      return b;
    }));
  }
  function stopAll(tell) {
    level = 0;
    pt = null;
    mood = null;
    incoming = 0;
    queueStop();
    $2("in").style.width = "0";
    if ($2("buzz").checked && navigator.vibrate) navigator.vibrate(0);
    if (tell) send({ stop: true });
    send({ v: [0] });
    sent = "0";
    show2();
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
        $2("in").style.width = `${incoming}%`;
      }
      if (data.name) $2("inlbl").textContent = `From ${data.name}`;
      if (typeof data.accept === "boolean") state(data.accept ? "You are playing their toys" : "Connected: waiting for them to let you play", data.accept);
      if (Array.isArray(data.devices)) {
        offer = data.devices;
        mine = new Set([...mine].filter((k) => offer.some((d) => d.k === k)));
        show2();
      }
      if (typeof data.rec === "boolean") $2("recnote").hidden = !data.rec;
      if (typeof data.sync === "boolean") {
        $2("syncnote").hidden = !data.sync;
        $2("ctlh").textContent = data.sync ? "Both of your toys" : "Your partner's toys";
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
    const name = $2("name").value.trim();
    if (name) send({ name });
    send({ accept: false });
    if (mine.size) send({ mine: [...mine] });
  }
  $2("name").addEventListener("change", hello);
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => {
    tab = b.dataset.tab;
    if (tab === "queue") refresh();
    show2();
  });
  var pad = $2("pad");
  var at = (e) => {
    const r = pad.getBoundingClientRect();
    level = Math.min(100, Math.max(0, (r.bottom - e.clientY) / r.height * 100));
    show2();
  };
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    const now2 = Date.now();
    if (now2 - tapAt < 300) {
      level = 0;
      tapAt = 0;
      show2();
      return;
    }
    tapAt = now2;
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
  $2("ptsel").replaceChildren(new Option("🎲 Random", PATTERN_RANDOM), group("Patterns", Object.entries(PATTERNS)), group("Two motors", Object.entries(PATTERNS_DUAL)));
  $2("ptsel").value = "wave";
  var startPattern = (key) => {
    mood = null;
    queueStop();
    pt = { key, phase: 0, prog: key === PATTERN_RANDOM ? new RandomProgram(2) : null };
    show2();
  };
  $2("ptgo").addEventListener("click", () => {
    if (pt) {
      pt = null;
      show2();
    } else startPattern($2("ptsel").value);
  });
  $2("ptsel").addEventListener("change", () => {
    if (pt) startPattern($2("ptsel").value);
    else show2();
  });
  for (const id of ["ptspeed", "ptstr", "moodstr"]) $2(id).addEventListener("input", show2);
  $2("moods").replaceChildren(...Object.entries(MOODS).map(([key, m]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mood = key;
    b.textContent = `${m.icon} ${m.label}`;
    b.addEventListener("click", () => {
      if (mood && mood.key === key) {
        mood = null;
        show2();
        return;
      }
      pt = null;
      queueStop();
      mood = { key, combo: -1 };
      nextMood(true);
    });
    return b;
  }));
  $2("stop").addEventListener("click", () => {
    stopAll(true);
    state("Stopped", false);
  });
  var last = performance.now();
  setInterval(() => {
    const now2 = performance.now();
    const v = levels(now2 - last);
    last = now2;
    const key = v.join(",");
    if (key !== sent || v.some((x) => x > 0) && Date.now() - sentAt >= 500) {
      send({ v });
      sent = key;
      sentAt = Date.now();
    }
    if (Date.now() - lastIn > 1500 && incoming) {
      incoming = 0;
      $2("in").style.width = "0";
    }
    if ($2("buzz").checked && navigator.vibrate) navigator.vibrate(incoming > 3 ? Math.round(incoming * 0.9) : 0);
  }, 100);
  setInterval(() => send({ ping: true }), 1e4);
  addEventListener("pagehide", () => send({ v: [0] }));
  initQueue({ onStart: () => {
    pt = null;
    mood = null;
    show2();
  } });
  show2();
  connect();
})();
