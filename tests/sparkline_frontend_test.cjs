'use strict';
// No Home Assistant or browser required: validate envelope parity and life-cycle safeguards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const js = fs.readFileSync(require('node:path').join(__dirname, '..', 'custom_components', 'ogg', 'frontend', 'ogg-control-deck-card.js'), 'utf8');
let Card;
const sandbox = {
  customElements: { get: () => undefined, define: (_tag, cls) => { Card = cls; } },
  HTMLElement: class {},
  window: { customCards: [] },
  document: { visibilityState: 'visible' },
  performance: { now: () => 2000 },
  setInterval: () => 7, clearInterval: () => {},
};
vm.runInNewContext(js, sandbox);
assert.equal(typeof Card, 'function');
const card = Object.create(Card.prototype);
card._elementMap = new Map();
card.isConnected = true;
card._sparkTimer = null;
const attrs = { line: {}, fill: {}, dot: {} };
const target = (kind) => ({setAttribute: (key, val) => { attrs[kind][key] = val; }, style: {opacity: '0'}});
const view = {spark: {points: [], active: true, startedAt: 1000, pattern: 'wave', period: 2, intensity: 70}, refs: {'spark-line': target('line'), 'spark-fill': target('fill'), 'spark-dot': target('dot')}};
card._elementMap.set('device', view);
card._tickSparks();
assert.equal(view.spark.points.length, 1);
assert(Math.abs(view.spark.points[0] - 70) < 1e-8, 'Wave peak should be 70% at half cycle');
assert.match(attrs.line.d, /^M95\.00,10\.20$/);
assert.match(attrs.fill.d, /L95,27 Z$/);
for(let j = 0; j < 100; j++) card._tickSparks();
assert.equal(view.spark.points.length, 56, 'History must be bounded');
view.spark.active = false;
for(let j = 0; j < 56; j++) card._tickSparks();
assert.equal(view.spark.points.every(v => v === 0), true, 'Stop returns graph to zero');
assert.equal(card._sparkTimer, null, 'Idle updates cancel ticker');
const src = js.match(/const sampleEnvelope = (\(name, phase\) => \{[\s\S]*?\n  \});/);
assert(src);
const sample = vm.runInNewContext(src[1], sandbox);
for (const pattern of ['steady','pulse','wave','breath','ramp','heartbeat','double_pulse','steps','echo','surge','peak','tide','surf','bounce','massage','tease','chachacha','tempo']) {
  for (const phase of [0, 0.05, 0.11, 0.17, 0.26, 0.37, 0.5, 0.79, 0.99]) {
    const val = sample(pattern,phase);
    assert(val >= 0 && val <= 1, `${pattern} envelope out of range: ${val}`);
  }
}
assert.equal(sample('steady',0.3), 1);
assert.equal(sample('pulse',0.2), 1);
assert.equal(sample('pulse',0.7), 0);
assert.equal(sample('wave',0.5), 1);
assert.equal(sample('wave',0), 0);
console.log('Sparkline frontend checks passed (envelopes, history, stop, idle timer).');
