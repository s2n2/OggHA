// Ogg Together: the partner's Queue tab. Built into custom_components/ogg/frontend/together-guest.js (npm run build).
//
// His and hers queues (the Queue card's), over the link: pick one and play
// it, or make one from patterns, moods and pauses and add it to his or hers
// queue. A script plays here, as levels sent like a pattern's, so the host's
// card keeps it inside the host's limits. Nothing else of Home Assistant is
// reachable from here (custom_components/ogg/studio/together.py).
import { isStroke, runScript } from '../lib/convert.js';
import { MOODS } from '../lib/moods.js';
import { sampleAt } from '../lib/outputs.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM } from '../lib/patterns.js';
import { DURATIONS, MAX_STEP_MS, clock, composeScript, defaultName, duration, parseTime, stepsMs } from '../lib/compose.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const base = location.href.replace(/[?#].*$/, '').replace(/\/$/, '') + '/queue';
const KEEP = 'ogg_together_queue';
const WHO = { his: 'His', hers: 'Hers' };
const KIND = { pattern: '〰️', mood: '🎭', pause: '⏸' };
const uid = () => Math.random().toString(36).slice(2, 9);
const NEW = {
  pattern: () => ({ type: 'pattern', key: 'wave', ms: 60000, level: 70, speed: 50 }),
  mood: () => ({ type: 'mood', key: Object.keys(MOODS)[0], ms: 120000, level: 100, seed: 1 + Math.floor(Math.random() * 1e6) }),
  pause: () => ({ type: 'pause', ms: 10000 }),
};

let items = {};               // the queues (no scripts)
let seg = 'hers';
let cur = null;               // {id?, name, script, levels: [tracks]}
let play = null;              // {t0, from, loop}
let from = 0;
let steps = [];
let onStart = () => {};

const keepGet = () => { try { return JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch (_) { return {}; } };
const keepSet = (patch) => { try { localStorage.setItem(KEEP, JSON.stringify({ ...keepGet(), ...patch })); } catch (_) { /* private browsing */ } };
const msg = (text) => { $('qmsg').textContent = text; clearTimeout(msg.t); msg.t = setTimeout(() => { $('qmsg').textContent = ''; }, 6000); };

// ---------------------------------------------------------- playing
const now = () => {
  if (!cur) return 0;
  const len = duration(cur.script);
  if (!play) return from;
  const t = play.from + (performance.now() - play.t0);
  return play.loop ? t % Math.max(1, len) : Math.min(len, t);
};

// Levels for this tick while a script plays (null when none does).
export function queueLevels() {
  if (!play || !cur) return null;
  const t = now();
  if (!play.loop && t >= duration(cur.script)) { play = null; from = 0; show(); return [0]; }
  return cur.levels.map((track) => Math.round(Math.max(0, Math.min(100, sampleAt(track, t)))));
}

export function queueStop() { if (play) { from = now(); play = null; show(); } }

function load(next) {
  // A stroke script plays as its speed (levels).
  const s = isStroke(next.script) ? runScript(next.script, 'speed') : next.script;
  const levels = [s.actions, ...(s.channels && s.channels.V1 ? [s.channels.V1.actions] : [])];
  cur = { ...next, levels };
  play = null;
  from = 0;
  show();
}

function start() {
  if (!cur) return;
  onStart();
  if (from >= duration(cur.script) - 100) from = 0;
  play = { t0: performance.now(), from, loop: $('qloop').checked };
  if (cur.id && items[cur.id]) fetch(`${base}/${cur.id}`, { method: 'POST' }).then(refresh).catch(() => {});
  show();
}

async function loadItem(id, andPlay) {
  const r = items[id];
  try {
    const res = await fetch(`${base}/${id}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Gone');
    load({ id, name: r ? r.name : body.name, script: body.script });
    if (andPlay) start();
  } catch (e) { msg(`Could not load it: ${e.message || e}`); }
}

// ---------------------------------------------------------- the lists
export async function refresh() {
  try {
    const res = await fetch(base);
    if (!res.ok) return;
    items = (await res.json()).items || {};
    show();
  } catch (_) { /* offline: try later */ }
}

function show() {
  const all = Object.entries(items);
  const of = (s) => all.filter(([, r]) => (s === 'played' ? r.played : !r.played && r.for === s));
  for (const b of document.querySelectorAll('#qseg button')) {
    const n = of(b.dataset.q).length;
    b.textContent = `${b.dataset.q === 'his' ? '♂ His' : b.dataset.q === 'hers' ? '♀ Hers' : '✓ Played'}${n ? ` (${n})` : ''}`;
    b.classList.toggle('on', b.dataset.q === seg);
  }
  const rows = of(seg).sort((a, b) => String((seg === 'played' ? b[1].played : a[1].made) || '').localeCompare(String((seg === 'played' ? a[1].played : b[1].made) || '')));
  $('qlist').innerHTML = rows.map(([id, r]) => `<div class="qitem${cur && cur.id === id ? ' cur' : ''}" data-id="${esc(id)}"><div class="info"><div class="nm">${esc(r.name)}</div>`
    + `<div class="meta">${[clock(r.duration_ms), r.by ? `from ${esc(r.by)}` : '', seg === 'played' ? WHO[r.for].toLowerCase() : ''].filter(Boolean).join(' · ')}</div></div>`
    + '<button type="button" class="on" aria-label="Play">▶</button></div>').join('')
    || `<div class="empty">${seg === 'played' ? 'Nothing played yet.' : `Nothing in ${WHO[seg].toLowerCase()} queue yet: make one below.`}</div>`;
  const opts = ['<option value="">Choose one to play…</option>',
    cur && !cur.id ? `<option value="cur">${esc(cur.name)} (${clock(duration(cur.script))})</option>` : '',
    ...['his', 'hers', 'played'].map((s) => {
      const list = of(s);
      return list.length ? `<optgroup label="${s === 'played' ? 'Played' : `${WHO[s]} queue`}">${list.map(([id, r]) => `<option value="${esc(id)}">${esc(r.name)} (${clock(r.duration_ms)})</option>`).join('')}</optgroup>` : '';
    })].join('');
  if ($('qpick').dataset.h !== opts) { $('qpick').innerHTML = opts; $('qpick').dataset.h = opts; }
  $('qpick').value = cur ? (cur.id || 'cur') : '';
  showPlayer();
}

function showPlayer() {
  const len = cur ? duration(cur.script) : 0, t = now();
  $('qcur').style.width = len ? `${(100 * t / len).toFixed(2)}%` : '0';
  $('qtime').textContent = cur ? `${clock(t)} / ${clock(len)} · ${cur.name}` : 'Pick one from a queue below, or make one.';
  $('qplay').textContent = play ? '↻ Restart' : '▶ Play';
  $('qplay').disabled = !cur;
}

// ---------------------------------------------------------- making one
function stepsShow() {
  $('steps').innerHTML = steps.map((s, i) => {
    const sec = Math.round(s.ms / 1000);
    const lens = (DURATIONS.includes(sec) ? DURATIONS : [...DURATIONS, sec].sort((a, b) => a - b))
      .map((v) => `<option value="${v}"${v === sec ? ' selected' : ''}>${clock(v * 1000)}</option>`).join('') + '<option value="custom">Custom…</option>';
    const what = s.type === 'pattern'
      ? `<optgroup label="Patterns">${Object.entries(PATTERNS).map(([k, n]) => `<option value="${k}"${k === s.key ? ' selected' : ''}>${n}</option>`).join('')}<option value="${PATTERN_RANDOM}"${s.key === PATTERN_RANDOM ? ' selected' : ''}>Random</option></optgroup>`
        + `<optgroup label="Two motors">${Object.entries(PATTERNS_DUAL).map(([k, n]) => `<option value="${k}"${k === s.key ? ' selected' : ''}>${n}</option>`).join('')}</optgroup>`
      : s.type === 'mood' ? Object.entries(MOODS).map(([k, m]) => `<option value="${k}"${k === s.key ? ' selected' : ''}>${m.icon} ${m.label}</option>`).join('')
        : '<option>Nothing plays</option>';
    const slider = (f, lab, min, val) => `<div class="slider"><label>${lab}</label><input type="range" min="${min}" max="100" step="5" value="${val}" data-f="${f}"><b>${val}%</b></div>`;
    return `<div class="step" data-id="${s.id}"><div class="top"><div class="handle" tabindex="0" role="button" aria-label="Drag to move step ${i + 1}">⠿</div><span class="num">${i + 1}</span><span class="kind">${KIND[s.type]}</span>`
      + `<select data-f="what"${s.type === 'pause' ? ' disabled' : ''}>${what}</select><button type="button" class="x" data-x="1" aria-label="Remove step">✕</button></div>`
      + `<div class="slider"><label>Time</label><select data-f="ms">${lens}</select></div>`
      + (s.type === 'pattern' ? slider('level', 'Strength', 5, s.level ?? 70) + slider('speed', 'Speed', 0, s.speed ?? 50) : s.type === 'mood' ? slider('level', 'Strength', 20, s.level ?? 100) : '')
      + '</div>';
  }).join('') || '<div class="empty">Add a pattern, a mood or a pause.</div>';
  totalShow();
}

function totalShow() {
  const ms = stepsMs(steps);
  $('qtotal').textContent = `${steps.length} step${steps.length === 1 ? '' : 's'} · total ${clock(ms)}`;
  $('qname').placeholder = `Name (default: ${defaultName(ms)})`;
  keepSet({ steps: steps.map(({ id, ...s }) => s) });
}

function compose() {
  try {
    const name = $('qname').value.trim() || defaultName(stepsMs(steps));
    return composeScript(steps, { title: name });
  } catch (e) { msg(e.message || String(e)); return null; }
}

async function add(who) {
  const script = compose();
  if (!script) return;
  try {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ for: who, name: script.metadata.title, script }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Not saved');
    $('qname').value = '';
    seg = who;
    msg(`Added "${body.name}" to ${WHO[who].toLowerCase()} queue: your partner can play it now or later.`);
    await refresh();
  } catch (e) { msg(`Could not add it: ${e.message || e}`); }
}

function bindSteps() {
  const box = $('steps');
  const find = (el) => { const row = el.closest('.step'); return row ? steps.findIndex((s) => s.id === row.dataset.id) : -1; };
  box.addEventListener('input', (e) => {
    const i = find(e.target), f = e.target.dataset.f;
    if (i < 0 || (f !== 'level' && f !== 'speed')) return;
    steps[i][f] = Number(e.target.value);
    e.target.nextElementSibling.textContent = `${e.target.value}%`;
    totalShow();
  });
  box.addEventListener('change', (e) => {
    const i = find(e.target), f = e.target.dataset.f;
    if (i < 0) return;
    if (f === 'what') steps[i].key = e.target.value;
    if (f === 'ms') {
      if (e.target.value === 'custom') {
        const typed = window.prompt('How long? For example 7, 45s, 1:30 or 2m', clock(steps[i].ms));
        const sec = typed === null ? null : parseTime(typed);
        if (sec !== null && sec >= 1 && sec * 1000 <= MAX_STEP_MS) steps[i].ms = Math.round(sec) * 1000;
        else if (typed !== null) msg('Type a time from 1 second to an hour, like 7, 45s, 1:30 or 2m.');
        stepsShow();
        return;
      }
      steps[i].ms = Number(e.target.value) * 1000;
    }
    totalShow();
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-x]')) return;
    const i = find(e.target);
    if (i >= 0) { steps.splice(i, 1); stepsShow(); }
  });
  box.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('handle') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = find(e.target), j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    stepsShow();
    box.querySelector(`.step[data-id="${steps[j].id}"] .handle`).focus();
  });
  box.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.handle');
    if (!h) return;
    e.preventDefault();
    const row = h.closest('.step');
    const rows = [...box.querySelectorAll('.step')];
    const at = rows.indexOf(row), rects = rows.map((r) => r.getBoundingClientRect()), y0 = e.clientY;
    let to = at;
    try { h.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    row.classList.add('drag');
    const move = (ev) => {
      const dy = ev.clientY - y0;
      row.style.transform = `translateY(${dy}px)`;
      const mid = rects[at].top + rects[at].height / 2 + dy;
      to = rects.findIndex((r) => mid < r.top + r.height / 2);
      if (to < 0) to = rects.length - 1;
      const gap = rects[at].height + 8;
      rows.forEach((r, k) => {
        if (k === at) return;
        const shift = at < to && k > at && k <= to ? -gap : at > to && k < at && k >= to ? gap : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      rows.forEach((r) => { r.style.transform = ''; });
      row.classList.remove('drag');
      if (to !== at) { const [s] = steps.splice(at, 1); steps.splice(to, 0, s); stepsShow(); }
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------- set up
export function initQueue(opts) {
  onStart = opts.onStart || onStart;
  const kept = keepGet();
  steps = (Array.isArray(kept.steps) ? kept.steps.filter((s) => s && NEW[s.type]) : []).map((s) => ({ ...s, id: uid() }));
  if (!steps.length) steps = [{ ...NEW.pattern(), id: uid() }, { ...NEW.mood(), id: uid() }];
  seg = ['his', 'hers', 'played'].includes(kept.seg) ? kept.seg : 'hers';
  $('qseg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { seg = b.dataset.q; keepSet({ seg }); show(); } });
  $('qlist').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) loadItem(b.closest('.qitem').dataset.id, true); });
  $('qpick').addEventListener('change', () => { const v = $('qpick').value; if (v && v !== 'cur') loadItem(v, false); });
  $('qplay').addEventListener('click', () => { from = play ? 0 : from; start(); });
  $('qstop').addEventListener('click', () => { play = null; from = 0; show(); opts.onStop && opts.onStop(); });
  $('qloop').addEventListener('change', () => { if (play) { from = now(); start(); } });
  $('qbar').addEventListener('pointerdown', (e) => {
    if (!cur) return;
    const r = $('qbar').getBoundingClientRect();
    from = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(cur.script);
    if (play) start(); else showPlayer();
  });
  document.querySelector('#t-queue .adds').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-add]');
    if (!b) return;
    steps.push({ ...NEW[b.dataset.add](), id: uid() });
    stepsShow();
  });
  $('qhis').addEventListener('click', () => add('his'));
  $('qhers').addEventListener('click', () => add('hers'));
  $('qtry').addEventListener('click', () => {
    const script = compose();
    if (!script) return;
    load({ name: script.metadata.title, script });
    start();
  });
  bindSteps();
  stepsShow();
  show();
  setInterval(showPlayer, 250);
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  refresh();
}
