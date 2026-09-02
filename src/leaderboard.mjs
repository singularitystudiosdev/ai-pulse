// Leaderboard pass: scan every scraped text for product mentions + revenue
// claims, update the registry, recompute momentum, export docs/data/products.json.
import { CATEGORIES, SUBCAT_KEYS } from './categories.mjs';
import { slugify, seedRegistry, buildMatcher, observeMention, recomputeMomentum, extractClaim, registerProduct } from './products.mjs';
import {
  discoverReddit, discoverProductHunt, discoverRevenueTalk, discoverNewsClaims,
  discoverAppStoreCharts, discoverPHCategory, discoverNewsletters,
  discoverHNFrontPage, discoverRedditSearch, discoverHNProductTalk, discoverNewsProductTalk,
} from './discover.mjs';
import {
  APPSTORE_CHART_FEEDS, APPSTORE_PUBLISHER_BLOCKLIST, APPSTORE_NAME_BLOCKLIST,
  NEWSLETTERS, REDDIT_SUBREDDITS, REDDIT_SUBS_PER_RUN,
  REDDIT_SEARCH_PER_RUN, REDDIT_INTERVAL_MS, PRODUCT_ROTATION_POOL, ROTATE_PRODUCTS_PER_RUN,
} from './config.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT_PATH = 'docs/data/products.json';
const CAP = 600; // registry passed 455 — the old 400 silently sliced claim-less Tier-2 rows off the board

// An app-store chart name worth registering when no registry row matched.
// Only the top-grossing feed carries a revenue signal — the free charts are
// full of GPT wrappers and keyword-stuffed names that pollute the board.
const AI_APP_RE = /\b(ai|a\.i\.|gpt|chatbot|copilot|claude|gemini|grok|llm|agent|companion)\b/i;
const CHART_REGISTER_MAX_RANK = 50;
// The free charts are wrapper-heavy, but the productivity top-25 is clean
// (assistant incumbents) — a narrower gate than grossing.
const CHART_FREE_MAX_RANK = 25;

// Chart names often carry a brand token for a product already registered
// ("Gemini Notebook" ≈ Google Gemini). Map tokens -> registry slugs so
// variants become mentions instead of duplicate rows.
const CHART_BRAND_ALIASES = [
  ['chatgpt', 'chatgpt'],
  ['grok', 'grok'],
  ['perplexity', 'perplexity'],
  ['character.ai', 'character-ai'],
  ['gemini', 'google-gemini'],
  ['copilot', 'microsoft-copilot'],
  ['claude', 'claude-by-anthropic'],
  ['deepseek', 'deepseek-ai-assistant'],
];

function engagementFor(item) {
  switch (item.platform) {
    case 'hn-comment': return (item.likes || 0) + 3 * (item.retweets || 0);
    case 'hn': case 'hn-front': case 'hn-product': return item.engagement || 0;
    case 'reddit': case 'reddit-search': return item.score || 2;
    case 'ph': case 'ph-ai': return 5; // feed entries carry no vote count
    case 'newsletter': return 3;
    default: return item.likes || 0;
  }
}

// Tracked products with a claimed figure — the per-product rotation pool.
function rotationPool(state) {
  return Object.values(state.products)
    .filter((p) => p.arrUsdReported)
    .sort((a, b) => (b.arrUsdReported || 0) - (a.arrUsdReported || 0));
}

export async function updateProducts(state, tweetCandidates) {
  const seeded = seedRegistry(state);
  const match = buildMatcher(state.products);
  const runs = state.counters.runs || 0;

  // Rotation: this run's focus products get dedicated Reddit/HN/News sweeps so
  // mention counts grow for the long tail, not just whatever HN links to X.
  const pool = rotationPool(state).slice(0, PRODUCT_ROTATION_POOL);
  const rotOffset = (runs * ROTATE_PRODUCTS_PER_RUN) % Math.max(pool.length, 1);
  const focus = pool.slice(rotOffset, rotOffset + ROTATE_PRODUCTS_PER_RUN);
  const focusNames = focus.map((p) => p.name);

  // Reddit subs rotate too — the unauth rate limit (1 req/60s) caps us at 2
  // sub feeds + 3 product searches per run; all Reddit traffic is paced
  // start-to-start inside discover.mjs.
  const subOffset = (runs * REDDIT_SUBS_PER_RUN) % REDDIT_SUBREDDITS.length;
  const subs = [];
  for (let i = 0; i < Math.min(REDDIT_SUBS_PER_RUN, REDDIT_SUBREDDITS.length); i++) {
    subs.push(REDDIT_SUBREDDITS[(subOffset + i) % REDDIT_SUBREDDITS.length]);
  }

  // The Reddit-search pool needs its OWN stride: focusNames advances by
  // ROTATE_PRODUCTS_PER_RUN (period 6 over a 48 pool), so slicing it would
  // cover only 18 of 48 products forever. Stride 3 has period 16 — exact
  // full coverage, no repeats within a cycle.
  const redditOffset = (runs * REDDIT_SEARCH_PER_RUN) % Math.max(pool.length, 1);
  const redditNames = pool.slice(redditOffset, redditOffset + REDDIT_SEARCH_PER_RUN).map((p) => p.name);

  // Assemble this run's text corpus: tweets already enriched + all channels.
  const corpus = [
    ...tweetCandidates
      .filter((t) => !t.enrichError)
      .map((t) => ({ title: t.text, url: t.url, text: t.text, date: t.createdAt, platform: 'x', engagement: (t.likes || 0) + 3 * (t.retweets || 0) })),
    ...(await discoverRevenueTalk()),
    ...(await discoverNewsClaims()),
    ...(await discoverReddit(subs, { intervalMs: REDDIT_INTERVAL_MS })),
    ...(await discoverProductHunt()),
    ...(await discoverPHCategory()),
    ...(await discoverNewsletters(NEWSLETTERS)),
    ...(await discoverHNFrontPage()),
    ...(await discoverRedditSearch(redditNames, { intervalMs: REDDIT_INTERVAL_MS })),
    ...(await discoverHNProductTalk(focusNames)),
    ...(await discoverNewsProductTalk(focusNames)),
  ];

  const now = Date.now();
  let matched = 0;
  let claims = 0;
  for (const item of corpus) {
    const hits = match(`${item.title || ''} ${item.text || ''}`);
    if (!hits.size) continue;
    for (const [slug] of hits) {
      if (!state.products[slug]) continue;
      matched++;
      observeMention(state, {
        slug,
        platform: item.platform,
        url: item.url,
        date: item.date,
        engagement: engagementFor(item),
        text: item.text,
      });
      if (extractClaim(item.text)) claims++;
    }
  }

  // App Store charts: mentions for known apps (rank-scaled engagement) and
  // candidate registration for AI-named apps nobody tracks yet.
  const charts = await discoverAppStoreCharts(APPSTORE_CHART_FEEDS);
  const { registered, chartMentions } = ingestCharts(state, charts, match, now);

  recomputeMomentum(state, now);
  const exported = exportProducts(state);
  return {
    seeded, corpusSize: corpus.length, matched, claims, exported,
    charts: charts.length, chartMentions: chartMentions, chartRegistered: registered,
    focus: focusNames, redditFocus: redditNames, subs,
  };
}

function ingestCharts(state, charts, match, now) {
  let registered = 0;
  let chartMentions = 0;
  for (const c of charts) {
    if (!c.name) continue;
    const engagement = Math.max(1, 100 - c.rank); // chart position as engagement proxy
    const mention = { platform: 'appstore', url: c.url, date: new Date(now).toISOString(), engagement };
    const hits = match(c.name);
    if (!hits.size) {
      // Brand-token fallback: "Gemini Notebook" attributes to Google Gemini.
      for (const [token, slug] of CHART_BRAND_ALIASES) {
        if (c.name.toLowerCase().includes(token) && state.products[slug]) { hits.set(slug, token); break; }
      }
    }
    if (hits.size) {
      for (const [slug] of hits) {
        const p = state.products[slug];
        if (!p) continue;
        // Chart position barely moves day to day — one mention per app per
        // week, or every run would compound chart-scaled momentum.
        const lastChart = (p.mentions || []).filter((m) => m.platform === 'appstore').map((m) => Date.parse(m.date)).sort().pop();
        if (Number.isFinite(lastChart) && now - lastChart < 6 * 86400e3) continue;
        chartMentions++;
        observeMention(state, { slug, platform: mention.platform, url: mention.url, date: mention.date, engagement, text: null });
      }
    } else if (((c.kind.startsWith('top-grossing') && c.rank <= CHART_REGISTER_MAX_RANK)
      || (c.kind === 'top-free-productivity' && c.rank <= CHART_FREE_MAX_RANK))
      && AI_APP_RE.test(c.name)
      && !APPSTORE_NAME_BLOCKLIST.test(c.name)
      && !(c.artist && APPSTORE_PUBLISHER_BLOCKLIST.some((pub) => c.artist.toLowerCase().includes(pub)))) {
      const added = registerProduct(state, {
        name: c.name,
        url: c.url,
        category: 'normie',
        subcat: null,
        tagline: `${c.genre ?? 'App Store app'} · ${c.kind.replace(/-/g, ' ')} #${c.rank} US`,
        basis: `App Store ${c.kind} chart #${c.rank} (US, ${new Date(now).toISOString().slice(0, 10)})`,
        mentions: [mention],
      });
      if (added) registered++;
    }
  }
  return { registered, chartMentions };
}

// Site JSON: flat array, category-grouped client-side. Sources included so
// every number on the board is one click from its origin.
export function exportProducts(state) {
  const items = Object.values(state.products)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      url: p.url,
      category: p.category,
      subcat: p.subcat,
      tagline: p.tagline,
      arrUsd: p.arrUsd,
      arrUsdReported: p.arrUsdReported ?? p.arrUsd,
      // Revenue proxy for the claim-less tail: headcount × revenue/employee,
      // the standard private-market heuristic. Explicitly a guess.
      arrEstimateUsd: !p.arrUsd && p.teamSize >= 5 ? p.teamSize * 200_000 : null,
      estimateBasis: !p.arrUsd && p.teamSize >= 5 ? `team of ${p.teamSize} × $200k/yr per employee` : null,
      teamSize: p.teamSize ?? null,
      basis: p.basis || null,
      stale: p.stale ?? false,
      confidence: p.confidence || 'medium',
      arrAsOf: p.arrAsOf,
      arrSource: p.arrSource,
      momentum: p.momentum,
      isNew: p.isNew ?? false,
      mentions: p.mentions.length,
      platforms: [...new Set((p.mentions || []).map((m) => m.platform))],
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen,
      topPosts: (p.mentions || [])
        .slice()
        .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
        .slice(0, 3)
        .map((m) => ({ url: m.url, platform: m.platform, date: m.date })),
    }))
    .sort((a, b) => (b.arrUsd || 0) - (a.arrUsd || 0)
      || (b.arrUsdReported || 0) - (a.arrUsdReported || 0)
      || (b.mentions || 0) - (a.mentions || 0))
    .slice(0, CAP);
  const payload = { version: 1, generatedAt: state.lastRunAt, categories: CATEGORIES, items };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload));
  return items.length;
}
