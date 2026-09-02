// Leaderboard view: category → sortKey → ranked product rows. Data comes from
// data/products.json (agent-committed). fx patterns: tab-pill (animated active
// tab), ticker (ARR count-up), reveal (IO stagger), lift (hover).
'use strict';

const BCATS = {
  physical: { emoji: '🦾', name: 'Physical AI', subcats: { military: '🎖 Military', consumer: '📱 Consumer', industrial: '🏭 Industrial' } },
  dev: { emoji: '🛠', name: 'Developer SaaS' },
  normie: { emoji: '🧑‍💻', name: 'Normie SaaS' },
  agents: { emoji: '🤖', name: 'Agents & Automation' },
  creative: { emoji: '🎨', name: 'Creative & Video AI' },
  voice: { emoji: '🗣️', name: 'Voice AI' },
};

let products = [];
let boardCat = 'all';
let boardSub = null;
let sortKey = 'arr';
const $ = (id) => document.getElementById(id);

function fmtArr(usd) {
  if (!usd) return null;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${Math.round(usd / 1e6)}M`;
  return `$${Math.round(usd / 1e3)}k`;
}

function platformIcon(p) {
  return { x: '𝕏', hn: 'Y', reddit: 'R', ph: 'P' }[p] || p;
}

function ranked() {
  let list = products.filter((p) => boardCat === 'all' || p.category === boardCat);
  if (boardCat === 'physical' && boardSub) list = list.filter((p) => p.subcat === boardSub);
  if (sortKey === 'new') {
    list = list.slice().sortKey((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
  } else if (sortKey === 'momentum') {
    list = list.slice().sortKey((a, b) => (b.momentum || 0) - (a.momentum || 0));
  } else {
    list = list.slice().sortKey((a, b) => (b.arrUsd || 0) - (a.arrUsd || 0) || (b.momentum || 0) - (a.momentum || 0));
  }
  return list;
}

// fx ticker: spring count-up on the ARR number, IO-triggered, once.
function ticker(el, target, fmt) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.textContent = fmt(target); return; }
  let cur = 0, vel = 0, started = false;
  const step = () => {
    vel += (target - cur) * 0.066; vel *= 0.86; cur += vel;
    el.textContent = fmt(Math.max(0, cur));
    if (Math.abs(target - cur) < target * 0.005) { el.textContent = fmt(target); return; }
    requestAnimationFrame(step);
  };
  new IntersectionObserver((es, io) => es.forEach((e) => {
    if (e.isIntersecting && !el._started) { el._started = true; io.disconnect(); requestAnimationFrame(step); }
  }), { threshold: 0.4 }).observe(el);
}

function row(p, i) {
  const el = document.createElement('a');
  el.className = 'row fx-reveal-item';
  el.href = p.url || '#';
  el.target = '_blank';
  el.rel = 'noopener';
  el.style.setProperty('--i', Math.min(i, 14));

  const rank = document.createElement('span');
  rank.className = 'rank' + (i === 0 && sortKey === 'arr' ? ' gold' : '');
  rank.textContent = String(i + 1);

  const main = document.createElement('span');
  main.className = 'row-main';
  const nameLine = document.createElement('span');
  nameLine.className = 'row-name';
  nameLine.append(Object.assign(document.createElement('span'), { textContent: p.name }));
  if (p.isNew) {
    const fire = document.createElement('span');
    fire.className = 'fire';
    fire.title = `first spotted ${new Date(p.firstSeen).toISOString().slice(0, 10)}`;
    fire.textContent = '🔥 NEW';
    nameLine.append(fire);
  }
  if (p.tagline) {
    const tag = document.createElement('span');
    tag.className = 'row-tag';
    tag.textContent = p.tagline;
    main.append(nameLine, tag);
  } else main.append(nameLine);

  const meta = document.createElement('span');
  meta.className = 'row-meta';
  // platform provenance chips + mention count
  for (const pf of (p.platforms || []).slice(0, 4)) {
    const chip = document.createElement('span');
    chip.className = `pf pf-${pf}`;
    chip.textContent = platformIcon(pf);
    chip.title = `seen on ${pf}`;
    meta.append(chip);
  }
  const mc = document.createElement('span');
  mc.className = 'mentions';
  mc.textContent = `${p.mentions} mention${p.mentions === 1 ? '' : 's'}`;
  meta.append(mc);
  main.append(meta);

  const arr = document.createElement('span');
  arr.className = 'arr';
  if (p.arrUsd) {
    const num = document.createElement('span');
    num.className = 'arr-num fx-ticker';
    arr.append(num);
    const label = document.createElement('span');
    label.className = 'arr-label';
    label.textContent = ' ARR';
    arr.append(label);
    arr.title = p.arrSource ? `source: ${p.arrSource.url}` : '';
    const src = document.createElement('a');
    src.className = 'arr-src';
    src.href = p.arrSource?.url || '#';
    src.target = '_blank';
    src.rel = 'noopener';
    src.textContent = '↗';
    src.title = p.arrSource ? `claimed ${new Date(p.arrSource.date).toISOString().slice(0, 10)}${p.arrSource.quote ? ' — "' + p.arrSource.quote.slice(0, 80) + '"' : ''}` : '';
    src.addEventListener('click', (e) => e.stopPropagation());
    arr.append(src);
    const fmt = (v) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`;
    ticker(num, p.arrUsd, fmt);
  } else {
    const unk = document.createElement('span');
    unk.className = 'arr-unknown';
    unk.textContent = 'ARR n/a';
    arr.append(unk);
  }

  const mom = document.createElement('span');
  mom.className = 'mom';
  const bar = document.createElement('span');
  bar.className = 'mom-bar';
  const fill = document.createElement('span');
  fill.className = 'mom-fill';
  fill.style.width = momentumPct(p) + '%';
  bar.append(fill);
  mom.append(bar);
  const mv = document.createElement('span');
  mv.className = 'mom-val';
  mv.textContent = p.momentum ? fmtShort(p.momentum) : '—';
  mom.append(mv);

  el.append(rank, main, arr, mom);
  return el;
}

const p2safe = (p) => String(p).replace(/[^a-z]/g, '');
const fmtShort = (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

function momentumPct(p) {
  const max = Math.max(...products.map((x) => x.momentum || 0), 1);
  return Math.max(3, Math.min(100, ((p.momentum || 0) / max) * 100));
}

function renderBoard() {
  const grid = b$('board-rows');
  grid.textContent = '';
  const list = ranked();
  document.getElementById('board-empty').hidden = list.length > 0;
  list.forEach((p, i) => grid.append(row(p, i)));
  document.getElementById('board-count').textContent =
    `${list.length} product${list.length === 1 ? '' : 's'}`;
}

function wireBoard() {
  for (const chip of document.querySelectorAll('[data-bcat]')) {
    chip.addEventListener('click', () => {
      boardCat = chip.dataset.bcat;
      boardSub = null;
      for (const c of document.querySelectorAll('[data-bcat]')) c.classList.toggle('active', c === chip);
      renderBoard();
    });
  }
  for (const chip of document.querySelectorAll('[data-bsub]')) {
    chip.addEventListener('click', () => {
      boardSub = chip.dataset.bsub;
      for (const c of document.querySelectorAll('[data-bsub]')) c.classList.toggle('active', c === chip);
      renderBoard();
    });
  }
  const pill = document.getElementById('sortKey-pill');
  for (const tab of document.querySelectorAll('[data-bsort]')) {
    tab.addEventListener('click', () => {
      sortKey = tab.dataset.bsort;
      for (const t of document.querySelectorAll('[data-bsort]')) t.classList.toggle('is-active', t === tab);
      movePill(tab);
      renderBoard();
    });
  }
  movePill(document.querySelector('[data-bsort].is-active'));
  window.addEventListener('resize', () => {
    const active = document.querySelector('[data-bsort].is-active');
    if (active) movePill(active);
  });
}

function movePill(btn) {
  const pill = document.getElementById('sortKey-pill');
  if (!pill || !btn) return;
  pill.style.left = btn.offsetLeft + 'px';
  pill.style.width = btn.offsetWidth + 'px';
}

async function loadBoard() {
  try {
    const res = await fetch(`data/products.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    products = data.items || [];
    const when = data.generatedAt ? new Date(data.generatedAt) : null;
    document.getElementById('board-updated').textContent = when
      ? `updated ${when.toISOString().slice(11, 16)} UTC`
      : '';
  } catch (e) {
    console.error('products load failed:', e);
    document.getElementById('board-updated').textContent = 'unavailable';
  }
  renderBoard();
}
