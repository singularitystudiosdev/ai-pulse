// Leaderboard pass: scan every scraped text for product mentions + revenue
// claims, update the registry, recompute momentum, export docs/data/products.json.
import { CATEGORIES, SUBCAT_KEYS } from './categories.mjs';
import { slugify, seedRegistry, buildMatcher, observeMention, recomputeMomentum, extractClaim } from './products.mjs';
import { discoverReddit, discoverProductHunt, discoverRevenueTalk, discoverNewsClaims } from './discover.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT_PATH = 'docs/data/products.json';
const REDDIT_SUBREDDITS = ['SaaS', 'SideProject', 'artificial'];
const CAP = 400;

function engagementFor(item) {
  switch (item.platform) {
    case 'hn-comment': return (item.likes || 0) + 3 * (item.retweets || 0);
    case 'hn': return item.engagement || 0;
    case 'reddit': return item.score || 0;
    case 'ph': return 5; // feed entries carry no vote count
    default: return item.likes || 0;
  }
}

export async function updateProducts(state, tweetCandidates) {
  const seeded = seedRegistry(state);
  const match = buildMatcher(state.products);

  // Assemble this run's text corpus: tweets already enriched + new channels.
  const corpus = [
    ...tweetCandidates
      .filter((t) => !t.enrichError)
      .map((t) => ({ title: t.text, url: t.url, text: t.text, date: t.createdAt, platform: 'x', engagement: (t.likes || 0) + 3 * (t.retweets || 0) })),
    ...(await discoverRevenueTalk()),
    ...(await discoverNewsClaims()),
    ...(await discoverReddit(REDDIT_SUBREDDITS)),
    ...(await discoverProductHunt()),
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

  recomputeMomentum(state, now);
  const exported = exportProducts(state);
  return { seeded, corpusSize: corpus.length, matched, claims, exported };
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
    .sort((a, b) => (b.arrUsd || 0) - (a.arrUsd || 0))
    .slice(0, CAP);
  const payload = { version: 1, generatedAt: state.lastRunAt, categories: CATEGORIES, items };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload));
  return items.length;
}
