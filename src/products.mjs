// Product registry: seeded from data/seed-products.json (verified claims with
// dated sources), then updated every run by matching scraped text against the
// name dictionary and extracting ARR/MRR claims. A number without a source
// URL never enters the ledger.
import { readFileSync, existsSync } from 'node:fs';
import { CATEGORIES, NEW_WINDOW_DAYS, MOMENTUM, MATCH_MIN_LEN, LEDGER_ALIASES } from './categories.mjs';

const SEED_PATH = 'data/arr-ledger.json';
const CLAIM_RE = /\$\s?([\d,.]+)\s?(k|m|mm|b|million|billion)?\s?(?:\/(?:year|yr|mo|month))?\s?(arr|mrr|revenue|annualized|annual recurring revenue)\b/i;
const MULTIPLIERS = { k: 1 / 12 / 1000, m: 1, mm: 1, million: 1, billion: 1000, b: 1000 };

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// One alternation regex over all names+aliases — one pass per text, cheap.
export function buildMatcher(registry) {
  const entries = [];
  for (const p of Object.values(registry)) {
    for (const n of [p.name, ...(p.aliases || [])]) {
      if (n.length >= MATCH_MIN_LEN) entries.push([n, p]);
    }
  }
  entries.sort((a, b) => b[0].length - a[0].length); // longest name wins a span
  const re = new RegExp(`\\b(${entries.map(([n]) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'ig');
  return (text) => {
    const found = new Map();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(String(text || ''))) !== null) {
      const name = entries.find(([n]) => n.toLowerCase() === m[1].toLowerCase())?.[0];
      if (name) found.set(slugify(name), name);
    }
    return found; // Map slug -> matched name
  };
}

export function seedRegistry(state) {
  if (!existsSync(SEED_PATH)) return 0;
  let seeds;
  try {
    seeds = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  } catch (e) {
    console.error(`seed-products.json unreadable: ${e.message}`);
    return 0;
  }
  const now = new Date().toISOString();
  let added = 0;
  for (const s of seeds) {
    const slug = slugify(s.name.split(' (')[0]); // "Pocket (AI notetaker…)" -> pocket
    const existing = state.products[slug];
    if (existing && (existing.arrUsd || !s.arrUsd)) continue; // ledger never downgrades a live entry
    const basis = String(s.basis || '').toLowerCase();
    // A quarterly net-new-ARR delta is not a run-rate: keep the number for
    // provenance but never let it rank in Top ARR.
    const excludeFromArr = /net-new/.test(basis);
    state.products[slug] = {
      slug,
      name: s.name.split(' (')[0],
      url: s.url,
      category: LEDGER_ALIASES[s.category] || s.category,
      subcat: s.subcat || null,
      tagline: s.tagline || null,
      aliases: s.aliases || [],
      seeded: true,
      arrUsd: excludeFromArr ? null : (s.arrUsd ?? null),
      arrUsdReported: s.arrUsd ?? null,
      basis: s.basis || null,
      stale: !!s.stale,
      confidence: s.confidence ?? 'medium',
      arrAsOf: s.asOf ?? null,
      arrSource: s.sourceUrl ? { url: s.sourceUrl, date: s.asOf, quote: s.quote ?? null, confidence: s.confidence ?? 'medium' } : null,
      arrHistory: s.arrUsd && s.asOf ? [{ usd: s.arrUsd, asOf: s.asOf, sourceUrl: s.sourceUrl }] : [],
      momentum: 0,
      mentions: [],
      firstSeen: s.asOf ?? new Date().toISOString(),
      lastSeen: s.asOf ?? new Date().toISOString(),
    };
    added++;
  }
  for (const path of ['data/yc-physical-seed.json', 'data/physical-registry-seed.json']) {
    added += mergeSeedFile(state, path);
  }
  return added;
}

// Landscape seeds (YC companies API, robotics directories): coverage rows,
// most without claims. Ledger rows always win — a seed never downgrades one.
function mergeSeedFile(state, path) {
  if (!existsSync(path)) return 0;
  let seeds;
  try {
    seeds = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`${path} unreadable: ${e.message}`);
    return 0;
  }
  let added = 0;
  for (const s of seeds) {
    if (!s?.name) continue;
    const slug = slugify(s.name.split(' (')[0]);
    if (!slug || state.products[slug]) continue;
    state.products[slug] = {
      slug,
      name: s.name.split(' (')[0],
      url: s.url || null,
      category: 'physical',
      subcat: s.subcat || 'industrial',
      tagline: s.tagline || null,
      aliases: [],
      seeded: true,
      arrUsd: s.arrUsd ?? null,
      arrUsdReported: s.arrUsd ?? null,
      basis: s.yc ? 'YC companies API listing' : (s.sourceUrl ? `listed by ${s.sourceUrl}` : null),
      stale: false,
      confidence: s.arrUsd ? 'medium' : null,
      arrAsOf: s.asOf ?? null,
      arrSource: s.arrUsd && (s.claimSource || s.sourceUrl)
        ? { url: s.claimSource || s.sourceUrl, date: s.asOf, quote: null, confidence: 'medium' }
        : null,
      arrHistory: [],
      momentum: 0,
      mentions: [],
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    added++;
  }
  return added;
}

// Extract a revenue claim (USD) from text, as {usd, quote} or null.
export function extractClaim(text) {
  const m = CLAIM_RE.exec(String(text || ''));
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num) || num <= 0) return null;
  const mult = m[2] ? MULTIPLIERS[m[2].toLowerCase()] : 1;
  if (!mult) return null;
  let usd = num * mult;
  if (/\bmrr\b/i.test(m[3])) usd *= 12; // MRR -> annualized
  return { usd: Math.round(usd), kind: m[3].toLowerCase() };
}

// Record a mention; if it carries a fresh ARR/MRR claim, update the ledger.
export function observeMention(state, { slug, name, platform, url, date, engagement, text }) {
  const p = state.products[slug];
  if (!p) return;
  const iso = date || new Date().toISOString();
  p.mentions.push({ platform, url, date: iso, engagement: Math.round(engagement || 0) });
  if (p.mentions.length > 40) p.mentions.sort((a, b) => (a.date < b.date ? 1 : -1)).length = 40;
  p.lastSeen = iso > p.lastSeen ? iso : p.lastSeen;

  if (text) {
    const claim = extractClaim(text);
    // A figure under $1M/yr is a stray number from the surrounding text,
    // not a company's recurring revenue — drop it.
    if (claim && claim.usd >= 1e6 && (!p.arrUsd || claim.usd !== p.arrUsd)) {
      // Accept the newest claim that differs; keep the history for the chart.
      p.arrUsd = claim.usd;
      p.arrAsOf = iso;
      p.arrSource = { url, date: iso, quote: String(text).slice(0, 200), confidence: 'scraped' };
      p.arrHistory.push({ usd: claim.usd, asOf: iso, sourceUrl: url, platform });
      if (p.arrHistory.length > 12) p.arrHistory.shift();
    }
  }
}

export function recomputeMomentum(state, now = Date.now()) {
  for (const p of Object.values(state.products)) {
    let m = 0;
    for (const men of p.mentions) {
      const ageDays = (now - Date.parse(men.date)) / 86400e3;
      if (ageDays > 30 || !Number.isFinite(ageDays)) continue;
      m += (men.engagement || 1) / Math.pow(ageDays + 2, MOMENTUM.gravity);
    }
    // ARR growth bonus: recent upward claim movement is the strongest signal.
    const h = p.arrHistory || [];
    if (h.length >= 2) {
      const [newest, prev] = [h[h.length - 1], h[h.length - 2]];
      const dDays = Math.max(1, (Date.parse(newest.asOf) - Date.parse(prev.asOf)) / 86400e3);
      const growth = (newest.usd - prev.usd) / Math.max(prev.usd, 1);
      m *= 1 + Math.max(0, Math.min(1.5, growth)) * MOMENTUM.arrGrowthWeight * (30 / dDays > 1 ? 1 : 0.5);
    }
    p.momentum = Math.round(m * 10) / 10;
    p.isNew = (now - Date.parse(p.firstSeen)) / 86400e3 <= NEW_WINDOW_DAYS;
  }
}

export function categoryOf(product) {
  return CATEGORIES[product.category] ? product.category : 'dev';
}
