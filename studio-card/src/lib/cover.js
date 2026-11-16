// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).
//
// The cover every Ogg card wears (the Play cards, the Queue card, the
// Privacy card and, through window.oggCover, the Control Deck):
// * someone who is not one of the chosen users (Ogg's options: "Who may use
//   OggStudio") sees only a saying, and nothing else of the card;
// * with discreet cards on, everyone sees the saying with a More button; More
//   (and the PIN, when there is one) opens every Ogg card in this browser for
//   two hours, then they cover again.
// The sayings are Ogg's own, or the ones set in Ogg's options ("Cover
// sayings", kept in that Home Assistant). Each card picks its own, never
// one another card is showing, and a new one each time it covers again.

export const OPEN_MS = 2 * 60 * 60 * 1000;
const OPEN_KEY = 'ogg_cover_open_until';
const LAST_KEY = 'ogg_cover_settings';      // the last settings seen, so a card opens covered at once

export const SAYINGS = [
  'A watched kettle never boils, but a watched neighbour always does something interesting.',
  'Never trust a man who doesn\'t like a second helping.',
  'There\'s no such thing as too much gravy, only too little bread.',
  'Knitting is mostly counting, and counting is mostly forgetting where you were.',
  'If it\'s worth doing, it\'s worth doing twice, slowly.',
  'A cup of tea fixes most things. A pint fixes the rest.',
  'The cat knows more than it lets on, and so do I.',
  'Respectable is just what you call it when nobody saw.',
  'A good apron hides a multitude of sins and most of the custard.',
  'Old doesn\'t mean slow. It means you\'ve learned where to stand.',
  'Never ask a woman her age. Ask her what she\'s been up to; it\'s a better story.',
  'There\'s a time for being sensible, and it isn\'t after the second drink.',
  'Always leave a party with a song still in you.',
  'If the broom squeaks, oil it. If the husband squeaks, feed him.',
  'Some doors are best left shut, and some are best left slightly open, with a chair handy.',
  'Gossip is just news that hasn\'t been to the trouble of being true yet.',
  'Wisdom is knowing which end of the cow to stand at.',
  'Mind your own business, but keep an eye on everyone else\'s.',
  'A blush is just your face telling the truth before you\'re ready.',
  'The secret to a long life is a short memory for grudges and a long one for recipes.',
  'Nothing improves a rainy evening like a fire, a bottle and nobody needing anything.',
  'Never apologise for a good laugh, even at a funeral. Especially at a funeral.',
  'A wink is worth a thousand words, and costs a good deal less.',
  'Some things are private, dear. That\'s what makes them fun.',
  'Curiosity never killed anyone I liked.',
  'If you can\'t be good, be careful, and if you can\'t be careful, be quick.',
  'There\'s nothing in this cupboard for you, love. Go and put the kettle on.',
  'Every house has a drawer nobody talks about.',
  'The best stories start with "Well, I shouldn\'t say, but…"',
  'Hush now. Some of us are enjoying a quiet moment.',
  'A little of what you fancy does you good. A lot of it does you better, usually.',
  'Never knock on a door you aren\'t ready to have opened.',
  'If a thing\'s worth hiding, it\'s worth hiding behind something interesting.',
  'Tea\'s for company. The good bottle is for later.',
  'A closed curtain is a polite way of saying "mind your own".',
  'What happens behind the bedroom door stays there, apart from the laundry.',
  'There\'s no shame in a nap, only in being caught snoring.',
  'Folk who say they\'ve nothing to hide just haven\'t found anything good yet.',
  'Keep your boots by the door and your secrets in your apron.',
  'Life\'s too short for weak tea and dull company.',
  'If you\'re going to be wicked, at least be cheerful about it.',
  'Never trust a cake that\'s been left out on purpose.',
  'Every good evening ends with someone saying "well, just the one more".',
  'A woman with a full larder and a locked drawer fears nothing.',
  'Manners cost nothing. Neither does a knowing look.',
  'The best seat in any house is the one nearest the fire and furthest from the washing up.',
  'Some songs are best sung after the children have gone to bed.',
  'You can tell a lot about a person by what they keep in the top cupboard.',
  'There\'s always room for pudding, and usually for a bit of mischief.',
  'Leave the poor dear alone, they\'re having a private moment.',
  'If the walls had ears, they\'d be blushing by now.',
  'A good secret is like a good cheese: better for keeping, and best shared with the right person.',
  'Never ask what\'s in the pie. Just say thank you.',
  'Nobody ever regretted an early night. Well, not for the reasons you\'d think.',
  'Old witches don\'t gossip, dear. We exchange information.',
  'The kettle\'s on, the cat\'s out, and the door\'s shut. That\'s happiness.',
  'There\'s nothing to see here. Unless you\'re invited.',
  'A twinkle in the eye is worth two in the bush.',
  'Shut the door on your way out, love. And knock next time.',
  'Some things are better imagined than explained.',
];

const page = () => (window.__oggCoverPage = window.__oggCoverPage || { covers: new Set() });

// The studio's entity (it carries the settings): found once per page.
export function studioSettings(hass) {
  if (!hass || !hass.states) return null;
  const p = page();
  let st = p.id && hass.states[p.id];
  if (!st) {
    for (const [id, s] of Object.entries(hass.states)) {
      if (id.startsWith('select.') && s.attributes && s.attributes.settings && s.attributes.scripts !== undefined) { p.id = id; st = s; break; }
    }
  }
  const settings = st && st.attributes.settings;
  if (settings) { try { localStorage.setItem(LAST_KEY, JSON.stringify(settings)); } catch (_) { /* private browsing */ } }
  if (settings) return settings;
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (_) { return null; }
}

export const openUntil = () => { try { return Number(localStorage.getItem(OPEN_KEY)) || 0; } catch (_) { return page().until || 0; } };
// Every cover on the page (a card off the page now catches up when it next updates).
const tellAll = () => { for (const c of [...page().covers]) c.refresh(); };
export function openAll() {
  const until = Date.now() + OPEN_MS;
  page().until = until;
  try { localStorage.setItem(OPEN_KEY, String(until)); } catch (_) { /* private browsing */ }
  tellAll();
}
export function closeAll() {
  page().until = 0;
  try { localStorage.removeItem(OPEN_KEY); } catch (_) { /* private browsing */ }
  tellAll();
}
window.addEventListener('storage', (e) => { if (e.key === OPEN_KEY) tellAll(); });

// Lock now from any card: discreet covers close again, and PIN-locked cards lock.
export const LOCK_EVENT = 'ogg-lock-all';
export function lockAll() {
  closeAll();
  try { sessionStorage.removeItem('oggstudio_unlocked'); } catch (_) { /* private browsing */ }
  window.dispatchEvent(new Event(LOCK_EVENT));
}

// What a card should show: nothing over it, the saying alone, or the saying with More.
export function coverMode(settings, userId, now = Date.now(), until = openUntil()) {
  if (!settings) return 'none';
  const users = Array.isArray(settings.users) ? settings.users : [];
  if (users.length && userId && !users.includes(userId)) return 'quote';
  if (settings.discreet && now >= until) return 'more';
  return 'none';
}

export function sayingsFor(settings) {
  const own = settings && Array.isArray(settings.quotes) ? settings.quotes.filter((q) => typeof q === 'string' && q.trim()) : [];
  return own.length ? own : SAYINGS;
}

// A new saying for one card: not one another card is showing, nor its last one
// (unless there are too few to go round).
export function pickSaying(list, taken, last, rnd = Math.random) {
  if (!list.length) return '';
  let pool = list.filter((q) => !taken.has(q) && q !== last);
  if (!pool.length) pool = list.filter((q) => q !== last);
  if (!pool.length) pool = list;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

export const sayingFor = (settings, rnd = Math.random) => pickSaying(sayingsFor(settings), new Set(), null, rnd);

const STYLE = `
.ogg-covered > :not(.ogg-cover){display:none!important}
.ogg-cover{display:flex;flex-direction:column;gap:12px;padding:20px 18px;color:#eef1ff;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.ogg-cover[hidden],.ogg-cover [hidden]{display:none!important}
.ogg-cover .oc-name{font-size:10px;font-weight:850;letter-spacing:.19em;text-transform:uppercase;color:#b8b0ff}
.ogg-cover blockquote{margin:0;font-size:16px;line-height:1.5;font-style:italic;color:#e9ecfb}
.ogg-cover blockquote::before{content:"“";font-size:28px;line-height:0;vertical-align:-10px;margin-right:2px;color:#8f7dff}
.ogg-cover .oc-row{display:flex;gap:8px;align-items:center}
.ogg-cover button{border:1px solid rgba(118,200,239,.3);background:#22385a;color:#c4f1ff;border-radius:14px;min-height:40px;padding:0 16px;font:inherit;font-size:13px;font-weight:780;cursor:pointer}
.ogg-cover input{flex:1;min-width:0;box-sizing:border-box;background:#16213a;color:#eef1ff;border:1px solid #2e3c5c;border-radius:12px;padding:9px 12px;font:inherit}
.ogg-cover .oc-msg{font-size:12px;color:#ffcf8a;min-height:0}
`;

// A cover inside a card: host is the card's root (usually its ha-card).
// update(hass) returns true while the card is covered.
export function makeCover(host) {
  const root = host.getRootNode();
  if (root && !root.querySelector('style[data-ogg-cover]')) {
    const s = document.createElement('style');
    s.dataset.oggCover = '1';
    s.textContent = STYLE;
    (root.head || root).appendChild(s);
  }
  const el = document.createElement('div');
  el.className = 'ogg-cover';
  el.hidden = true;
  el.innerHTML = '<div class="oc-name"></div><blockquote></blockquote>'
    + '<div class="oc-row oc-more"><button type="button" class="oc-go">More</button></div>'
    + '<div class="oc-row oc-pin" hidden><input type="password" inputmode="numeric" autocomplete="off" aria-label="PIN" placeholder="PIN"><button type="button" class="oc-open">Open</button></div>'
    + '<div class="oc-msg"></div>';
  host.insertBefore(el, host.firstChild);
  const $ = (s) => el.querySelector(s);
  let hass = null, mode = 'none', settings = null, timer = null;
  const cover = {
    covered: false,
    onChange: null,
    update(h) { hass = h || hass; return cover.refresh(); },
    refresh() {
      settings = studioSettings(hass);
      const me = hass && hass.user && hass.user.id;
      mode = coverMode(settings, me);
      const covered = mode !== 'none';
      el.hidden = !covered;
      host.classList.toggle('ogg-covered', covered);
      if (covered) {
        const name = mode === 'more' ? String((settings && settings.name) || '') : '';
        $('.oc-name').textContent = name;
        $('.oc-name').hidden = !name;
        // A new saying each time it covers (and when the list changes).
        const list = sayingsFor(settings);
        if (!cover.covered || !cover.saying || !list.includes(cover.saying)) {
          const taken = new Set([...page().covers].filter((c) => c !== cover && c.covered && c.saying).map((c) => c.saying));
          cover.saying = pickSaying(list, taken, cover.saying);
        }
        if ($('blockquote').textContent !== cover.saying) $('blockquote').textContent = cover.saying;
        $('.oc-more').hidden = mode !== 'more' || !$('.oc-pin').hidden;
        if (mode !== 'more') $('.oc-pin').hidden = true;
      } else { $('.oc-pin').hidden = true; $('.oc-msg').textContent = ''; }
      if (covered !== cover.covered) { cover.covered = covered; if (cover.onChange) cover.onChange(covered); }
      if (!timer && settings && settings.discreet) timer = setInterval(() => cover.refresh(), 30000);
      return covered;
    },
  };
  $('.oc-go').addEventListener('click', () => {
    if (settings && settings.pin) { $('.oc-more').hidden = true; $('.oc-pin').hidden = false; $('input').focus(); return; }
    openAll();
  });
  const tryPin = async () => {
    const pin = $('input').value;
    if (!pin || !hass) return;
    try {
      const r = await hass.callWS({ type: 'ogg/studio/unlock', pin });
      if (r && r.ok) { $('input').value = ''; $('.oc-msg').textContent = ''; $('.oc-pin').hidden = true; openAll(); return; }
      $('input').value = '';
      $('.oc-msg').textContent = r && r.wait ? `Too many tries. Wait ${r.wait} s.` : 'That is not it.';
    } catch (e) { $('.oc-msg').textContent = `Could not check: ${e.message || e}`; }
  };
  $('.oc-open').addEventListener('click', tryPin);
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
  page().covers.add(cover);
  return cover;
}

// For the Control Deck (a separate file) and anything else on the page.
window.oggCover = window.oggCover || { makeCover, openAll, closeAll, lockAll, coverMode, sayingFor };
