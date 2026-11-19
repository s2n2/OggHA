// Ogg Together: the partner's remote. Built into custom_components/ogg/frontend/together-guest.js (npm run build).
//
// The partner opens the host's link and gets this page. It plays the host's
// toys by hand, with Ogg's patterns or with a mood: the patterns and moods
// run here, and only levels (0-100) travel to the host's card, which keeps
// them inside the host's limits. If the partner's own toys are on the same
// Ogg, the host offers them (his/hers shown) and the partner picks theirs:
// the host can then play them. The Queue tab (queue.js) plays his and hers
// queues and makes new ones to add to them.
import { aiRandom } from '../lib/ai.js';
import { MOODS, buildMood } from '../lib/moods.js';
import { sampleAt } from '../lib/outputs.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM, RandomProgram, patternDual, patternLevel, patternPeriod } from '../lib/patterns.js';
import { STROKE_LIMITS_RESET, strokeSetLimit, strokeStep, strokeVel } from '../lib/stroke.js';
import { initQueue, queueLevels, queueStop, refresh as queueRefresh } from './queue.js';

const $ = (id) => document.getElementById(id);
const OWNER = { his: 'His', hers: 'Hers', unassigned: '' };
const url = location.href.replace(/^http/, 'ws').replace(/[?#].*$/, '').replace(/\/$/, '') + '/ws';

let ws = null;
let tries = 0;
let ended = false;
let tab = 'manual';
let level = 0;                 // the pad (0-100)
let pt = null;                 // a pattern playing: { key, phase, prog }
let mood = null;               // a mood playing: { key, combo, vibe, len, t0 }
let sent = '';
let sentAt = 0;
let incoming = 0;
let lastIn = 0;
let ctl = 'vibe';              // the manual control: vibe pad or stroker
let ctlPicked = false;         // picked by hand (else it follows the host's toys)
let hostKinds = [];            // what kinds of toys I play (from the host)
// The stroker, as on the Play card: a range, a position, and three speeds to
// hold or latch (a speed is % of top speed: 100% = a full stroke in 1/4 s).
const st = { pos: 50, dir: 1, lower: 0, upper: 100, last: null, hold: null, latch: null, drag: null };
let pcts = [30, 55, 100];
try { const p = JSON.parse(localStorage.getItem('ogg_together_stroke_speeds') || 'null'); if (Array.isArray(p) && p.length === 3) pcts = p.map((v) => Math.min(100, Math.max(5, Number(v) || 30))); } catch (_) { /* private browsing */ }
let spring = false;            // drop to 0 when let go
try { spring = localStorage.getItem('ogg_together_spring') === '1'; } catch (_) { /* private browsing */ }
let offer = [];                // toys the host offers
let mine = new Set();          // the ones picked as mine
let allow = true;              // may my partner play my toys?
let sync = false;              // both feel the same (either of us may switch it)
let theyLet = false;           // may I play theirs (their switch)?
try { allow = localStorage.getItem('ogg_together_allow') !== '0'; } catch (_) { /* private browsing */ }

const state = (text, live) => { $('state').textContent = text; $('state').classList.toggle('wait', !live); };
const send = (data) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); };

// ---------------------------------------------------------- the levels
function levels(dtMs) {
  if (tab !== 'manual') { const q = queueLevels(); if (q) return q; }
  if (tab === 'manual' && ctl === 'stroke') return [Math.round(st.pos)];
  if (tab === 'manual' || (!pt && !mood)) return [Math.round(level)];
  if (pt) {
    const speed = Number($('ptspeed').value);
    const k = Number($('ptstr').value) / 100;
    if (pt.prog) {
      pt.prog.intensity = 0.4 + 0.58 * speed / 100;
      return pt.prog.step(dtMs).map((v) => Math.round(v * 100 * k));
    }
    pt.phase += dtMs / 1000 / patternPeriod(speed);
    const dual = pt.key in PATTERNS_DUAL;
    return (dual ? [0, 1].map((m) => patternDual(pt.key, pt.phase, m)) : [patternLevel(pt.key, pt.phase)]).map((v) => Math.round(v * 100 * k));
  }
  const t = performance.now() - mood.t0;
  if (t >= mood.len) nextMood(false);
  const k = Number($('moodstr').value) / 100;
  return mood.vibe.map((track) => Math.round(sampleAt(track, performance.now() - mood.t0) * k));
}

function nextMood(start) {
  const m = MOODS[mood.key];
  let i;
  do { i = Math.floor(Math.random() * m.combos.length); } while (m.combos.length > 1 && i === mood.combo);
  const [name, sections] = m.combos[i];
  const built = buildMood(sections, aiRandom((Math.random() * 2 ** 32) >>> 0));
  const len = Math.max(...built.vibe.map((tr) => (tr.length ? tr[tr.length - 1].at : 0)));
  Object.assign(mood, { combo: i, vibe: built.vibe, len: Math.max(1000, len), t0: performance.now(), name });
  if (start) show();
}

// ---------------------------------------------------------- what is shown
function show() {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const t of ['manual', 'pattern', 'mood', 'queue']) $(`t-${t}`).hidden = t !== tab;
  $('fill').style.height = `${level}%`;
  $('pct').textContent = `${Math.round(level)}%`;
  $('vibepane').hidden = ctl !== 'vibe';
  $('strokepane').hidden = ctl !== 'stroke';
  for (const b of document.querySelectorAll('#ctlsw button')) b.classList.toggle('on', b.dataset.ctl === ctl);
  $('ctlinfo').textContent = hostKinds.includes('stroke') ? (hostKinds.length > 1 ? 'Their toys: a stroker and a vibrator' : 'Their toy is a stroker') : hostKinds.length ? 'Their toys vibrate' : '';
  stShow();
  $('spring').checked = spring;
  const random = pt ? Boolean(pt.prog) : $('ptsel').value === PATTERN_RANDOM;
  $('speedlab').textContent = random ? 'How busy' : 'Speed';
  $('ptspeedv').textContent = random ? `${$('ptspeed').value}%` : `${patternPeriod(Number($('ptspeed').value)).toFixed(1)} s`;
  $('ptstrv').textContent = `${$('ptstr').value}%`;
  $('moodstrv').textContent = `${$('moodstr').value}%`;
  $('ptgo').textContent = pt ? '■ Stop' : '▶ Play';
  $('ptgo').classList.toggle('on', Boolean(pt));
  for (const b of document.querySelectorAll('#moods button')) b.classList.toggle('on', Boolean(mood && b.dataset.mood === mood.key));
  $('moodinfo').textContent = mood ? `${MOODS[mood.key].icon} ${MOODS[mood.key].label}: ${mood.name || ''}` : '';
  // Their toys: offered by the host, picked here.
  // The switches: mine (my toys), and Sync (shared by both of us).
  $('allow').checked = allow;
  $('allow').disabled = !mine.size;
  $('allowhint').textContent = !mine.size ? 'Pick your toys above first.' : allow ? 'They can play your toys now.' : 'Paused: your toys do not follow them.';
  $('sync').checked = sync;
  $('synchint').textContent = sync ? 'On: you both feel the same. It shows on their screen too.' : 'Off: you play their toys, they play yours.';
  $('syncnote').hidden = !sync;
  $('ctlh').textContent = sync ? 'Both of your toys' : "Your partner's toys";
  $('toyhint').textContent = offer.length ? 'Tap yours: your partner can then play them.'
    : 'None free yet: your partner is using every connected toy. If one of them is yours, ask them to take it out of their Devices, and it shows up here.';
  $('toys').replaceChildren(...offer.map((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `toy${mine.has(d.k) ? ' on' : ''}`;
    b.innerHTML = `<span>${d.name.replace(/[&<>"]/g, '')}</span>${OWNER[d.owner] ? `<span class="chip ${d.owner}">${OWNER[d.owner]}</span>` : ''}`;
    b.addEventListener('click', () => {
      if (mine.has(d.k)) mine.delete(d.k); else if (mine.size < 4) mine.add(d.k);
      send({ mine: [...mine] });
      show();
    });
    return b;
  }));
}

function stopAll(tell) {
  level = 0; pt = null; mood = null; incoming = 0; st.hold = null; st.latch = null; st.drag = null;
  queueStop();
  $('in').style.width = '0';
  if ($('buzz').checked && navigator.vibrate) navigator.vibrate(0);
  if (tell) send({ stop: true });
  send({ v: [0] }); sent = '0';
  show();
}

// ---------------------------------------------------------- the link
function connect() {
  ws = new WebSocket(url);
  ws.onopen = () => { tries = 0; state('Waiting for your partner…', false); hello(); };
  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (_) { return; }
    if (data.stop) { stopAll(false); state('Your partner pressed Stop', true); }
    if (Array.isArray(data.v)) { incoming = Math.max(...data.v); lastIn = Date.now(); $('in').style.width = `${incoming}%`; }
    if (data.name) $('inlbl').textContent = `From ${data.name}`;
    if (typeof data.accept === 'boolean') { theyLet = data.accept; state(data.accept ? 'You are playing their toys' : 'Connected: waiting for them to let you play', data.accept); }
    if (Array.isArray(data.devices)) { offer = data.devices; mine = new Set([...mine].filter((k) => offer.some((d) => d.k === k))); show(); }
    if (typeof data.rec === 'boolean') $('recnote').hidden = !data.rec;
    if (typeof data.sync === 'boolean') { sync = data.sync; show(); }
    if (Array.isArray(data.kinds)) {
      hostKinds = data.kinds;
      // A stroker alone: its control; otherwise the vibe pad (unless picked by hand).
      if (!ctlPicked) ctl = hostKinds.includes('stroke') && !hostKinds.some((k) => k !== 'stroke') ? 'stroke' : 'vibe';
      show();
    }
  };
  ws.onclose = () => {
    ws = null;
    if (ended) return;
    if (++tries > 5) { ended = true; state('This link has ended', false); return; }
    state('Connection lost: trying again…', false);
    setTimeout(connect, 1500 * tries);
  };
}

function hello() {
  const name = $('name').value.trim();
  if (name) send({ name });
  send({ accept: false });
  send({ allow });
  if (mine.size) send({ mine: [...mine] });
}

// ---------------------------------------------------------- controls
$('name').addEventListener('change', hello);
$('allow').addEventListener('change', () => {
  allow = $('allow').checked;
  try { localStorage.setItem('ogg_together_allow', allow ? '1' : '0'); } catch (_) { /* private browsing */ }
  send({ allow });
  show();
});
$('sync').addEventListener('change', () => { sync = $('sync').checked; send({ sync }); show(); });
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => { tab = b.dataset.tab; if (tab === 'queue') queueRefresh(); show(); });
const pad = $('pad');
const at = (e) => { const r = pad.getBoundingClientRect(); level = Math.min(100, Math.max(0, (r.bottom - e.clientY) / r.height * 100)); show(); };
pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); at(e); });
pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') at(e); });
// Drop to 0: the pad springs back to zero when it is let go.
const letGo = () => { if (spring) { level = 0; show(); } };
pad.addEventListener('pointerup', letGo);
pad.addEventListener('pointercancel', letGo);
$('spring').addEventListener('change', () => {
  spring = $('spring').checked;
  try { localStorage.setItem('ogg_together_spring', spring ? '1' : '0'); } catch (_) { /* private browsing */ }
});
// Vibe or stroke, by hand.
$('ctlsw').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ctl]');
  if (!b) return;
  ctlPicked = true;
  if (b.dataset.ctl !== ctl) { level = 0; st.hold = null; st.latch = null; ctl = b.dataset.ctl; }
  show();
});
// ---------------------------------------------------------- the stroker
function stShow() {
  $('stband').style.bottom = `${st.lower}%`;
  $('stband').style.top = `${100 - st.upper}%`;
  $('stup').style.top = `calc(${100 - st.upper}% + 6px)`;
  $('stup').textContent = Math.round(st.upper);
  $('stlo').style.bottom = `calc(${st.lower}% + 6px)`;
  $('stlo').textContent = Math.round(st.lower);
  $('stshade').style.bottom = `${st.lower}%`;
  $('stshade').style.top = `${100 - st.upper}%`;
  $('stpos').style.bottom = `${st.pos}%`;
  $('stpct').textContent = Math.round(st.pos);
  for (const b of document.querySelectorAll('.sthold')) b.classList.toggle('on', Number(b.dataset.speed) === st.hold);
  for (const b of document.querySelectorAll('.stlatch')) {
    const on = Number(b.dataset.speed) === st.latch;
    b.classList.toggle('on', on);
    b.textContent = on ? '■ Latched' : '⟳ Latch';
  }
  for (const i of [0, 1, 2]) {
    const r = document.querySelector(`.stpctr[data-speed="${i}"]`);
    if (document.activeElement !== r) r.value = String(pcts[i]);
    document.querySelector(`.stpv[data-speed="${i}"]`).textContent = `${pcts[i]}%`;
  }
}
const yPct = (el, e) => { const r = el.getBoundingClientRect(); return Math.min(100, Math.max(0, (r.bottom - e.clientY) / r.height * 100)); };
// The range: drag an end, or the middle to move the whole range.
const rail = $('strail');
let railGrab = null;
rail.addEventListener('pointerdown', (e) => {
  rail.setPointerCapture(e.pointerId);
  const p = yPct(rail, e);
  railGrab = Math.abs(p - st.upper) < 9 ? { end: 'upper' } : Math.abs(p - st.lower) < 9 ? { end: 'lower' } : { end: 'move', from: p, lo: st.lower, hi: st.upper };
});
rail.addEventListener('pointermove', (e) => {
  if (!railGrab || !(e.buttons || e.pointerType === 'touch')) return;
  const p = yPct(rail, e);
  if (railGrab.end === 'upper') st.upper = Math.max(st.lower + 5, Math.round(p));
  else if (railGrab.end === 'lower') st.lower = Math.min(st.upper - 5, Math.round(p));
  else {
    const span = railGrab.hi - railGrab.lo;
    const lo = Math.min(100 - span, Math.max(0, railGrab.lo + p - railGrab.from));
    st.lower = Math.round(lo); st.upper = Math.round(lo + span);
  }
  st.last = null;
  stShow();
});
const railUp = () => { railGrab = null; };
rail.addEventListener('pointerup', railUp);
rail.addEventListener('pointercancel', railUp);
// The position: drag to move it (a hold or latch lets go).
const lane = $('stlane');
lane.addEventListener('pointerdown', (e) => { lane.setPointerCapture(e.pointerId); st.latch = null; st.hold = null; st.drag = yPct(lane, e); st.pos = st.drag; stShow(); });
lane.addEventListener('pointermove', (e) => { if (st.drag !== null && (e.buttons || e.pointerType === 'touch')) { st.drag = yPct(lane, e); st.pos = st.drag; stShow(); } });
const laneUp = () => { st.drag = null; };
lane.addEventListener('pointerup', laneUp);
lane.addEventListener('pointercancel', laneUp);
// The speeds: hold to stroke, Latch to keep going.
for (const b of document.querySelectorAll('.sthold')) {
  const i = Number(b.dataset.speed);
  b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } st.hold = i; stShow(); });
  const up = () => { if (st.hold === i) { st.hold = null; stShow(); } };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}
for (const b of document.querySelectorAll('.stlatch')) b.addEventListener('click', () => { const i = Number(b.dataset.speed); st.latch = st.latch === i ? null : i; stShow(); });
for (const r of document.querySelectorAll('.stpctr')) r.addEventListener('input', () => {
  pcts[Number(r.dataset.speed)] = Number(r.value);
  try { localStorage.setItem('ogg_together_stroke_speeds', JSON.stringify(pcts)); } catch (_) { /* private browsing */ }
  stShow();
});
$('stlimit').addEventListener('click', () => { const l = strokeSetLimit(st, st.pos); if (l) Object.assign(st, l); stShow(); });
$('streset').addEventListener('click', () => { Object.assign(st, STROKE_LIMITS_RESET); stShow(); });
// The stroke moves smoothly between the 100 ms sends.
let stLast = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = now - stLast;
  stLast = now;
  const speed = st.drag !== null ? null : st.hold ?? st.latch;
  if (speed === null || speed === undefined || ctl !== 'stroke') return;
  const r = strokeStep(st.pos, st.dir || 1, st.lower, st.upper, strokeVel(pcts[speed]), dt);
  st.pos = r.pos; st.dir = r.dir;
  $('stpos').style.bottom = `${st.pos}%`;
  $('stpct').textContent = Math.round(st.pos);
}, 30);

const group = (label, entries) => { const g = document.createElement('optgroup'); g.label = label; g.append(...entries.map(([k, t]) => new Option(t, k))); return g; };
$('ptsel').replaceChildren(new Option('🎲 Random', PATTERN_RANDOM), group('Patterns', Object.entries(PATTERNS)), group('Two motors', Object.entries(PATTERNS_DUAL)));
$('ptsel').value = 'wave';
const startPattern = (key) => { mood = null; queueStop(); pt = { key, phase: 0, prog: key === PATTERN_RANDOM ? new RandomProgram(2) : null }; show(); };
$('ptgo').addEventListener('click', () => { if (pt) { pt = null; show(); } else startPattern($('ptsel').value); });
$('ptsel').addEventListener('change', () => { if (pt) startPattern($('ptsel').value); else show(); });
for (const id of ['ptspeed', 'ptstr', 'moodstr']) $(id).addEventListener('input', show);

$('moods').replaceChildren(...Object.entries(MOODS).map(([key, m]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.mood = key;
  b.textContent = `${m.icon} ${m.label}`;
  b.addEventListener('click', () => {
    if (mood && mood.key === key) { mood = null; show(); return; }
    pt = null;
    queueStop();
    mood = { key, combo: -1 };
    nextMood(true);
  });
  return b;
}));
$('stop').addEventListener('click', () => { stopAll(true); state('Stopped', false); });

// ---------------------------------------------------------- every tick
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const v = levels(now - last);
  last = now;
  const key = v.join(',');
  if (key !== sent || (v.some((x) => x > 0) && Date.now() - sentAt >= 500)) { send({ v }); sent = key; sentAt = Date.now(); }
  if (Date.now() - lastIn > 1500 && incoming) { incoming = 0; $('in').style.width = '0'; }
  if ($('buzz').checked && navigator.vibrate) navigator.vibrate(incoming > 3 ? Math.round(incoming * 0.9) : 0);
}, 100);
setInterval(() => send({ ping: true }), 10000);
addEventListener('pagehide', () => send({ v: [0] }));
initQueue({ onStart: () => { pt = null; mood = null; show(); } });
show();
connect();
