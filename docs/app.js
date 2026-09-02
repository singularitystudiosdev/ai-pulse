// ai-pulse front-end. Static + zero deps: the learner is content-based
// filtering on implicit feedback, computed entirely in this browser from a
// keyword/category/author profile in localStorage — nothing ever leaves the
// device. Favorites weigh 3x clicks (standard implicit-feedback weighting).
'use strict';

const KEY = 'ai-pulse.v1';
const FAV_W = 3, CLICK_W = 1;
const CATS = { 1: '🧠 Model release', 2: '🚀 SaaS launch', 3: '🦾 Embodied AI', 4: '🔥 Viral' };
const HINT_AT = 3; // events before For You activates

let items = [];
let sort = 'velocity';
let catFilter = 'all';
let hideSeen = false;

const $ = (id) => document.getElementById(id);

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.profile) return s;
  } catch { /* corrupted state -> fresh */ }
  return { favs: {}, seen: {}, profile: { cats: {}, kw: {}, authors: {} }, events: 0 };
}

let store = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(store));

// Favorites carry their own snapshot (url/title/category) so chips keep working
// even after the item rotates out of feed.json. Legacy entries stored a bare
// timestamp — hydrate what we can from the live feed, drop the rest.
function favMeta(item) {
  return { ts: Date.now(), url: item.url, text: item.text, category: item.category, user: item.user };
}

function hydrateFavs() {
  const byId = new Map(items.map((i) => [i.id, i]));
  let changed = false;
  for (const [id, v] of Object.entries(store.favs)) {
    if (typeof v === 'number') {
      const it = byId.get(id);
      if (it) { store.favs[id] = favMeta(it); store.favs[id].ts = v; changed = true; }
      else { delete store.favs[id]; changed = true; }
    }
  }
  if (changed) save();
}

// Same tokenizer as the pipeline (src/util.mjs) so profile terms line up.
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#]\w+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function learn(item, weight) {
  const p = store.profile;
  p.cats[item.category] = (p.cats[item.category] || 0) + weight;
  p.authors[item.user] = (p.authors[item.user] || 0) + weight;
  for (const t of tokenize(item.text).slice(0, 40)) {
    p.kw[t] = (p.kw[t] || 0) + weight;
  }
  store.events += 1;
  save();
}

function norm(v, max) { return max > 0 ? v / max : 0; }

// affinity in [0,1]: category, keyword overlap, author — the classic
// content-based profile match, each component normalized against the profile max.
function affinity(item) {
  if (store.events < HINT_AT) return { score: 0, because: [] };
  const p = store.profile;
  const maxCat = Math.max(1, ...Object.values(p.cats));
  const maxAuth = Math.max(1, ...Object.values(p.authors));
  const kwVals = Object.values(p.kw).sort((a, b) => b - a).slice(0, 30);
  const kwMass = kwVals.reduce((s, w) => s + w, 0) || 1;
  const toks = tokenize(item.text).slice(0, 40);
  let kwSum = 0;
  const hits = [];
  for (const t of toks) {
    const w = p.kw[t] || 0;
    kwSum += w;
    if (w > 0) hits.push([t, w]);
  }
  const cat = (p.cats[item.category] || 0) / maxCat;
  const kw = kwSum / kwMass;
  const auth = (p.authors[item.user] || 0) / maxAuth;
  return {
    score: 0.35 * cat + 0.45 * kw + 0.2 * auth,
    because: hits.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t),
  };
}

function ranked() {
  let list;
  if (catFilter === 'fav') list = items.filter((i) => store.favs[i.id]);
  else if (catFilter === 'all') list = items;
  else list = items.filter((i) => i.category === +catFilter);
  if (hideSeen) list = list.filter((i) => !store.seen[i.id]);
  const maxV = Math.max(...list.map((i) => i.velocity || 0), 1);
  return list.map((i) => {
    const a = affinity(i);
    const personal = 0.55 * norm(i.velocity || 0, maxV) + 0.45 * a.score;
    return { ...i, _score: sort === 'foryou' ? personal : (i.velocity || 0), _because: a.because };
  }).sort((a, b) => b._score - a._score);
}

function ago(iso) {
  if (!iso) return '';
  const h = (Date.now() - Date.parse(iso)) / 3.6e6;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmt(n) {
  if (n == null) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function signal(i) {
  if (i.channel === 'hn-comment') return `${fmt(i.likes)}♥ ${fmt(i.retweets)}RT · v ${fmt(Math.round(i.velocity))}`;
  if (i.channel === 'hf-papers') return `${fmt(i.likes)} HF↑`;
  if (i.channel === 'hn-story') return `${fmt(i.likes)} HN pts`;
  return `v ${fmt(Math.round(i.velocity))}`;
}

function card(item, idx) {
  const el = document.createElement('article');
  el.className = 'card' + (store.seen[item.id] ? ' seen' : '');
  el.style.animationDelay = `${Math.min(idx * 35, 600)}ms`;

  const top = document.createElement('div');
  top.className = 'card-top';
  const badge = document.createElement('span');
  badge.className = `badge c${item.category}`;
  badge.textContent = CATS[item.category] || 'post';
  top.append(badge);
  if (Date.now() - Date.parse(item.firstSeen) < 6 * 3.6e6) {
    const nw = document.createElement('span');
    nw.className = 'new-badge';
    nw.textContent = '● NEW';
    top.append(nw);
  }
  if (store.seen[item.id]) {
    const st = document.createElement('span');
    st.className = 'seen-tag';
    st.textContent = '✓ seen';
    top.append(st);
  }
  const star = document.createElement('button');
  star.className = 'star' + (store.favs[item.id] ? ' on' : '');
  star.setAttribute('aria-label', store.favs[item.id] ? 'unstar' : 'star');
  star.setAttribute('aria-pressed', String(!!store.favs[item.id]));
  star.textContent = '★';
  star.addEventListener('click', () => {
    if (store.favs[item.id]) { delete store.favs[item.id]; }
    else { store.favs[item.id] = favMeta(item); learn(item, FAV_W); }
    star.classList.toggle('on', !!store.favs[item.id]);
    star.setAttribute('aria-pressed', String(!!store.favs[item.id]));
    renderFavBar();
    stats();
  });
  top.append(star);
  el.append(top);

  const body = document.createElement('div');
  body.className = 'card-body';
  const h = document.createElement('h3');
  h.className = 'card-title';
  const a = document.createElement('a');
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = item.text && item.text.length > 140 ? item.text.slice(0, 139) + '…' : (item.text || item.url);
  a.addEventListener('click', () => {
    if (!store.seen[item.id]) { store.seen[item.id] = Date.now(); learn(item, CLICK_W); }
    el.classList.add('seen');
    stats();
  });
  h.append(a);
  body.append(h);
  if (item.image) {
    const img = document.createElement('img');
    img.className = 'card-img';
    img.loading = 'lazy';
    img.alt = 'post image';
    img.src = item.image;
    body.append(img);
  }
  el.append(body);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const s = document.createElement('span');
  s.className = 'signal';
  s.textContent = signal(item);
  const t = document.createElement('span');
  t.textContent = item.user && item.channel === 'hn-comment' ? `@${item.user}` : (item.authorName || '');
  const age = document.createElement('span');
  age.textContent = ago(item.firstSeen);
  meta.append(s, t, age);
  el.append(meta);

  const why = document.createElement('span');
  why.className = 'why';
  why.textContent = item.reason || '';
  why.title = item.reason || '';
  el.append(why);

  if (sort === 'foryou' && item._because && item._because.length) {
    const b = document.createElement('div');
    b.className = 'because';
    b.textContent = `↳ for you: ${item._because.join(', ')}`;
    el.append(b);
  }
  return el;
}

function render() {
  const grid = $('grid');
  grid.textContent = '';
  const list = ranked();
  $('empty').hidden = list.length > 0;
  $('learn-hint').hidden = !(sort === 'foryou' && store.events < HINT_AT);
  list.forEach((item, i) => grid.append(card(item, i)));
  renderFavBar();
  stats();
}

// Sticky favorites tray under the header: one chip per star, newest first.
// Chips are self-contained links — click opens the post, ✕ unstards.
function renderFavBar() {
  const bar = $('favbar');
  const wrap = $('favbar-chips');
  const favs = Object.entries(store.favs)
    .map(([id, v]) => ({ id, ...(typeof v === 'number' ? { ts: v } : v) }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  bar.hidden = favs.length === 0;
  wrap.textContent = '';
  for (const f of favs) {
    const chip = document.createElement('a');
    chip.className = 'fav-chip';
    chip.href = f.url || '#';
    chip.target = '_blank';
    chip.rel = 'noopener';
    const icon = document.createElement('span');
    icon.textContent = (CATS[f.category] || '★').split(' ')[0];
    const label = document.createElement('span');
    const txt = f.text || f.url || id;
    label.textContent = txt.length > 34 ? txt.slice(0, 33) + '…' : txt;
    chip.append(icon, label);
    chip.addEventListener('click', () => {
      const it = items.find((i) => i.id === id);
      if (it && !store.seen[id]) { store.seen[id] = Date.now(); learn(it, CLICK_W); }
      stats();
    });
    const x = document.createElement('button');
    x.className = 'fx';
    x.setAttribute('aria-label', 'remove from favorites');
    x.textContent = '✕';
    x.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      delete store.favs[id];
      save();
      render();
    });
    chip.append(x);
    wrap.append(chip);
  }
}

function stats() {
  const seen = Object.keys(store.seen).length;
  const favs = Object.keys(store.favs).length;
  const mode = sort === 'foryou' ? '✨ For You' : '⚡ Velocity';
  $('stats').textContent = `${items.length} posts · ${mode} · ${seen} seen · ${favs} starred`;
  if (store.events >= HINT_AT) {
    const top = Object.entries(store.profile.kw).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
    if (top.length) $('stats').textContent += ` · learning: ${top.join(', ')}`;
  }
}

function wire() {
  const setSort = (s) => {
    sort = s;
    for (const t of [[$('tab-velocity'), 'velocity'], [$('tab-foryou'), 'foryou']]) {
      t[0].classList.toggle('active', t[1] === s);
      t[0].setAttribute('aria-selected', String(t[1] === s));
    }
    render();
  };
  $('tab-velocity').addEventListener('click', () => setSort('velocity'));
  $('tab-foryou').addEventListener('click', () => setSort('foryou'));

  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      catFilter = chip.dataset.cat;
      for (const c of document.querySelectorAll('.chip')) c.classList.toggle('active', c === chip);
      render();
    });
  }

  $('hide-seen').addEventListener('change', (e) => { hideSeen = e.target.checked; render(); });

  // Run button: opens the workflow's dispatch page (GitHub's own Run button —
  // dispatching needs an auth token, so we can't do it from a static page),
  // then polls feed.json until the agent's fresh commit lands.
  const ACTIONS_URL = 'https://github.com/singularitystudiosdev/ai-pulse/actions/workflows/feed.yml';
  const POLL_MS = 30_000;
  const POLL_MAX_MS = 12 * 60_000;
  let baseline = null;
  let watchTimer = null;

  const setRun = (state) => {
    const btn = $('run-btn');
    const label = $('run-label');
    btn.classList.remove('busy', 'fresh');
    if (state === 'busy') { btn.classList.add('busy'); label.textContent = '⏳ agent running — watching…'; }
    else if (state === 'fresh') { btn.classList.add('fresh'); label.textContent = '✓ fresh data landed'; }
    else label.textContent = '▶ Run agent now';
  };

  async function pollForFresh() {
    try {
      const res = await fetch(`data/feed.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return false;
      const data = await res.json();
      if (baseline && data.generatedAt && data.generatedAt !== baseline) {
        items = data.items || [];
        baseline = data.generatedAt;
        $('updated').textContent = `updated ${new Date(data.generatedAt).toISOString().slice(11, 16)} UTC`;
        setRun('fresh');
        render();
        setTimeout(() => setRun('idle'), 8000);
        return true;
      }
    } catch { /* next tick */ }
    return false;
  }

  $('run-btn').addEventListener('click', () => {
    if (watchTimer) return; // already watching
    // capture the current generatedAt as the "before" snapshot
    fetch(`data/feed.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { baseline = d.generatedAt || null; })
      .catch(() => {});
    setRun('busy');
    window.open(ACTIONS_URL, '_blank', 'noopener');
    const started = Date.now();
    watchTimer = setInterval(async () => {
      if (Date.now() - started > POLL_MAX_MS) {
        clearInterval(watchTimer); watchTimer = null;
        setRun('idle');
        return;
      }
      if (await pollForFresh()) { clearInterval(watchTimer); watchTimer = null; }
    }, POLL_MS);
  });

  $('reset').addEventListener('click', () => {
    localStorage.removeItem(KEY);
    store = load();
    render();
  });
}

async function boot() {
  wire();
  try {
    const res = await fetch(`data/feed.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items = data.items || [];
    hydrateFavs();
    const when = data.generatedAt ? new Date(data.generatedAt) : null;
    $('updated').textContent = when
      ? `updated ${when.toISOString().slice(11, 16)} UTC`
      : 'updated recently';
  } catch (e) {
    $('updated').textContent = 'feed unavailable — try again soon';
    console.error('feed load failed:', e);
  }
  render();
}

boot();
