// Ogg Together: the partner's remote. Built into custom_components/ogg/frontend/together-guest.js (npm run build).
//
// The partner opens the host's link and gets this page. It plays the host's
// toys by hand, with Ogg's patterns or with a mood: the patterns and moods
// run here, and only levels (0-100) travel to the host's card, which keeps
// them inside the host's limits. If the partner's own toys are on the same
// Ogg, the host offers them (his/hers shown) and the partner picks theirs:
// the host can then play them.
import { aiRandom } from '../lib/ai.js';
import { MOODS, buildMood } from '../lib/moods.js';
import { sampleAt } from '../lib/outputs.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM, RandomProgram, patternDual, patternLevel, patternPeriod } from '../lib/patterns.js';

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
let tapAt = 0;
let offer = [];                // toys the host offers
let mine = new Set();          // the ones picked as mine

const state = (text, live) => { $('state').textContent = text; $('state').classList.toggle('wait', !live); };
const send = (data) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); };

// ---------------------------------------------------------- the levels
function levels(dtMs) {
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
  for (const t of ['manual', 'pattern', 'mood']) $(`t-${t}`).hidden = t !== tab;
  $('fill').style.height = `${level}%`;
  $('pct').textContent = `${Math.round(level)}%`;
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
  $('toysec').hidden = !offer.length;
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
  level = 0; pt = null; mood = null; incoming = 0;
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
    if (typeof data.accept === 'boolean') state(data.accept ? 'You are playing their toys' : 'Connected: waiting for them to let you play', data.accept);
    if (Array.isArray(data.devices)) { offer = data.devices; mine = new Set([...mine].filter((k) => offer.some((d) => d.k === k))); show(); }
    if (typeof data.rec === 'boolean') $('recnote').hidden = !data.rec;
    if (typeof data.sync === 'boolean') {
      $('syncnote').hidden = !data.sync;
      $('ctlh').textContent = data.sync ? 'Both of your toys' : "Your partner's toys";
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
  if (mine.size) send({ mine: [...mine] });
}

// ---------------------------------------------------------- controls
$('name').addEventListener('change', hello);
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => { tab = b.dataset.tab; show(); });
const pad = $('pad');
const at = (e) => { const r = pad.getBoundingClientRect(); level = Math.min(100, Math.max(0, (r.bottom - e.clientY) / r.height * 100)); show(); };
pad.addEventListener('pointerdown', (e) => {
  pad.setPointerCapture(e.pointerId);
  const now = Date.now();
  if (now - tapAt < 300) { level = 0; tapAt = 0; show(); return; }
  tapAt = now;
  at(e);
});
pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') at(e); });

const group = (label, entries) => { const g = document.createElement('optgroup'); g.label = label; g.append(...entries.map(([k, t]) => new Option(t, k))); return g; };
$('ptsel').replaceChildren(new Option('🎲 Random', PATTERN_RANDOM), group('Patterns', Object.entries(PATTERNS)), group('Two motors', Object.entries(PATTERNS_DUAL)));
$('ptsel').value = 'wave';
const startPattern = (key) => { mood = null; pt = { key, phase: 0, prog: key === PATTERN_RANDOM ? new RandomProgram(2) : null }; show(); };
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
show();
connect();
