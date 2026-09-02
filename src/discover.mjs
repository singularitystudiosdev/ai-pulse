// Discovery channels (spec §1). HN Algolia is the only no-auth surface that
// links x.com posts (Nitter dead 2026-08, X search pay-per-usage). Algolia
// ANDs every word, so queries stay ≤2 terms; filtering happens downstream.
import { fetchJSON, sleep } from './util.mjs';

const STATUS_RE = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/g;

function harvestTweetLinks(text, into, meta) {
  // HN stores links HTML-entity-encoded (&#x2F; = /) — normalise first.
  const decoded = String(text || '').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&');
  let m;
  STATUS_RE.lastIndex = 0;
  while ((m = STATUS_RE.exec(decoded)) !== null) {
    const [, user, id] = m;
    if (/^(i|hashtag|search)$/i.test(user)) continue;
    const key = `${user.toLowerCase()}/${id}`;
    if (!into.has(key)) into.set(key, { user, id, ...meta });
  }
}

export async function discoverFromHN(queries, { numericFilters = '', hitsPerPage = 200, perQueryCap = 40 } = {}) {
  const found = new Map();
  const channels = [];
  let ok = false;
  for (const q of queries) {
    const nf = numericFilters ? `&numericFilters=${encodeURIComponent(numericFilters)}` : '';
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=comment&hitsPerPage=${hitsPerPage}${nf}`;
    try {
      const j = await fetchJSON(url);
      ok = true;
      let harvested = 0;
      for (const h of j.hits || []) {
        const meta = { hnStoryId: h.story_id ?? null, hnStoryTitle: h.story_title ?? null };
        const before = found.size;
        harvestTweetLinks(h.comment_text, found, meta);
        harvested += found.size - before;
        if (harvested >= perQueryCap) break;
      }
      channels.push({ query: q, hits: j.hits?.length ?? 0, tweets: harvested });
    } catch (e) {
      channels.push({ query: q, error: e.message });
    }
    await sleep(400);
  }
  return { ok, posts: [...found.values()], channels };
}

// Show HN stories — launches that never got tweet-linked still surface here.
export async function discoverShowHN({ query, minPoints, minComments, hits }) {
  try {
    const nf = `points>=${minPoints},num_comments>=${minComments}`;
    const j = await fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=show_hn&numericFilters=${encodeURIComponent(nf)}&hitsPerPage=${hits}`);
    return (j.hits || []).filter((h) => h.title);
  } catch (e) {
    console.error(`show_hn channel failed: ${e.message}`);
    return [];
  }
}

// HF daily papers, top by upvotes — builder-crowd signal for model releases.
export async function discoverHFPapers(limit) {
  try {
    const j = await fetchJSON('https://huggingface.co/api/daily_papers');
    return (j || [])
      .sort((a, b) => (b.paper?.upvotes ?? 0) - (a.paper?.upvotes ?? 0))
      .slice(0, limit)
      .map((p) => ({
        id: `hf:${p.paper?.id ?? p.id}`,
        title: p.paper?.title ?? p.title ?? '(untitled)',
        url: p.paper?.id ? `https://huggingface.co/papers/${p.paper.id}` : null,
        upvotes: p.paper?.upvotes ?? 0,
        authors: (p.paper?.authors || []).map((a) => a.name).filter(Boolean).slice(0, 3),
      }));
  } catch (e) {
    console.error(`hf-papers channel failed: ${e.message}`);
    return [{ error: e.message }];
  }
}

// ---------- product-discovery channels (leaderboard) ----------

// Reddit RSS — the .json route is OAuth-gated; .rss with a browser UA still
// answers (verify: each entry carries <content> HTML we mine for claims).
// Reddit enforces ~1 request/60s per IP (measured 2026-06-12), so all Reddit
// traffic in a run is paced start-to-start across BOTH functions via paceReddit.
let redditLastStart = 0;
async function paceReddit(intervalMs) {
  const wait = redditLastStart ? intervalMs - (Date.now() - redditLastStart) : 0;
  if (wait > 0) await sleep(wait);
  redditLastStart = Date.now();
}

export async function discoverReddit(subreddits, { perSub = 25, intervalMs = 60_000 } = {}) {
  const out = [];
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
  for (const sub of subreddits) {
    await paceReddit(intervalMs);
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/.rss?limit=${perSub}`, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      for (const block of xml.split(/<entry>/i).slice(1)) {
        const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
        const link = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
        const content = (block.match(/<content[^>]*>(?:&lt;|<)[\s\S]*?<\/(?:content|div)>/i) || [])[0] || '';
        const updated = (block.match(/<updated>([^<]+)<\/updated>/i) || [])[1] || null;
        if (title && link) out.push({ title, url: link, text: title + ' ' + decodeEntities(content), date: updated, platform: 'reddit', sub });
      }
    } catch (e) {
      console.error(`reddit r/${sub} failed: ${e.message}`);
    }
  }
  return out;
}

// Product Hunt launch feed (Atom). Titles only — harvest, never query.
// The front feed and the ?category= filtered feed share one parser; the
// /topics/<slug>/feed path 404s, only the query param works (2026-09-02).
export async function discoverProductHunt(url = 'https://www.producthunt.com/feed', platform = 'ph') {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/atom+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const out = [];
    for (const block of xml.split(/<entry>/i).slice(1)) {
      const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
      const link = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
      const updated = (block.match(/<updated>([^<]+)<\/updated>/i) || [])[1] || null;
      if (title && link) out.push({ title, url: link.trim(), text: title, date: updated, platform });
    }
    return out;
  } catch (e) {
    console.error(`producthunt feed failed: ${e.message}`);
    return [];
  }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ');
}

// Product-metric chatter on HN: founder claims live in comments like
// "we hit $40k MRR" — these queries surface them.
export async function discoverRevenueTalk({ hitsPerPage = 75 } = {}) {
  const out = [];
  const queries = ['ARR', 'MRR', 'bootstrapped revenue'];
  for (const q of queries) {
    const nf = `created_at_i>${Math.floor((Date.now() - 7 * 86400e3) / 1000)}`;
    try {
      const j = await fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=comment&hitsPerPage=${hitsPerPage}&numericFilters=${encodeURIComponent(nf)}`);
      for (const h of j.hits || []) {
        if (!h.comment_text) continue;
        out.push({
          title: h.story_title || '(HN thread)',
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          text: h.comment_text,
          date: h.created_at,
          platform: 'hn',
          engagement: (h.story_points || 0) + 2 * (h.story_comment_count || 0),
        });
      }
    } catch (e) {
      console.error(`hn revenue-talk "${q}" failed: ${e.message}`);
    }
    await sleep(400);
  }
  return out;
}

// Google News RSS — fresh press coverage carrying ARR claims (verified
// 2026-09-02: 66 items in 7d for '"$" ARR'). Links are news.google redirects.
export async function discoverNewsClaims({ days = 7 } = {}) {
  const out = [];
  const queries = ['"ARR" AI startup', '"hits $" ARR', 'AI startup revenue milestone',
    '"humanoid robot" funding', '"robot startup" revenue', 'defense drone contract'];
  for (const q of queries) {
    try {
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)} when:${days}d&hl=en-US&gl=US&ceid=US:en`, {
        headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      for (const block of xml.split(/<item>/i).slice(1)) {
        const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
        const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
        const pub = (block.match(/<pubDate>([^<]+)<\/pubDate>/i) || [])[1] || null;
        const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || [])[1] || '';
        if (title) out.push({ title, url: link.trim(), text: title + ' ' + desc.replace(/<[^>]+>/g, ' '), date: pub, platform: 'news' });
      }
    } catch (e) {
      console.error(`google-news "${q}" failed: ${e.message}`);
    }
    await sleep(800);
  }
  return out;
}

// ---------- deep channels (each live-verified 2026-09-02) ----------

function cdata(s) {
  return String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// RSS 2.0 — newsletters and per-product news searches.
function parseRSS2(xml) {
  const out = [];
  for (const block of String(xml).split(/<item>/i).slice(1)) {
    const title = cdata((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = cdata((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
    const pub = (block.match(/<pubDate>([^<]+)<\/pubDate>/i) || [])[1] || null;
    const desc = cdata((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1]) || '';
    if (title && link) out.push({ title: title.trim(), url: link.trim(), text: title + ' ' + desc.replace(/<[^>]+>/g, ' '), date: pub ? new Date(pub).toISOString() : null });
  }
  return out;
}

// Reddit Atom (r/<sub> and /search.rss share the shape): title, link, content
// HTML, updated. Content is entity-encoded — decode and strip tags for claims.
function parseRedditAtom(xml, platform, extra = {}) {
  const out = [];
  for (const block of String(xml).split(/<entry>/i).slice(1)) {
    const title = cdata((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const content = (block.match(/<content[^>]*>([\s\S]*?)<\/content>/i) || [])[1] || '';
    const updated = (block.match(/<updated>([^<]+)<\/updated>/i) || [])[1] || null;
    if (title && link) out.push({
      title: cdata(title).trim(), url: link.trim(),
      text: cdata(title).trim() + ' ' + decodeEntities(content),
      date: updated, platform, ...extra,
    });
  }
  return out;
}

// App Store charts (US) — rank-order is a revenue proxy, not a dollar figure.
export async function discoverAppStoreCharts(feeds) {
  const out = [];
  for (const f of feeds) {
    try {
      const j = await fetchJSON(f.url, { timeoutMs: 30000 });
      for (const [i, e] of (j.feed?.entry || []).entries()) {
        out.push({
          name: e['im:name']?.label ?? null,
          appId: e.id?.attributes?.['im:id'] ?? null,
          url: e.id?.label ?? null,
          artist: e['im:artist']?.label ?? null,
          price: e['im:price']?.attributes?.amount ?? null,
          genre: e.category?.attributes?.label ?? null,
          rank: i + 1,
          kind: f.kind,
          date: null,
          platform: 'appstore',
        });
      }
    } catch (e) {
      console.error(`appstore ${f.kind} failed: ${e.message}`);
    }
    await sleep(800);
  }
  return out;
}

// Product Hunt AI category feed.
export async function discoverPHCategory() {
  return discoverProductHunt('https://www.producthunt.com/feed?category=artificial-intelligence', 'ph-ai');
}

// Curated AI newsletters (RSS 2.0).
export async function discoverNewsletters(list) {
  const out = [];
  for (const n of list) {
    try {
      const res = await fetch(n.url, {
        headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const item of parseRSS2(await res.text())) out.push({ ...item, platform: 'newsletter', source: n.name });
    } catch (e) {
      console.error(`newsletter ${n.name} failed: ${e.message}`);
    }
    await sleep(800);
  }
  return out;
}

const AI_TOPIC_RE = /\b(ai|a\.i\.|gpt|llm|agent|claude|gemini|robot|humanoid|voice|image|video)\b/i;

// HN front page — AI stories that never said "Show HN" and never got tweet-linked.
export async function discoverHNFrontPage({ hits = 60 } = {}) {
  try {
    const j = await fetchJSON(`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${hits}`);
    return (j.hits || [])
      .filter((h) => h.title && AI_TOPIC_RE.test(h.title))
      .map((h) => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        text: h.title,
        date: h.created_at,
        platform: 'hn-front',
        engagement: (h.points || 0) + 2 * (h.num_comments || 0),
      }));
  } catch (e) {
    console.error(`hn front page failed: ${e.message}`);
    return [];
  }
}

// Per-product mention sweep — Reddit site search. Unauth 429s are common;
// keep the 8s spacing measured on 2026-09-02 and accept misses.
export async function discoverRedditSearch(names, { limit = 15, intervalMs = 60_000 } = {}) {
  const out = [];
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
  for (const name of names) {
    await paceReddit(intervalMs);
    try {
      const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(`"${name}"`)}&sort=new&limit=${limit}`;
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      out.push(...parseRedditAtom(await res.text(), 'reddit-search', { sub: 'search' }));
    } catch (e) {
      console.error(`reddit search "${name}" failed: ${e.message}`);
    }
  }
  return out;
}

// Per-product mention sweep — HN stories+comments naming the product, 7d window.
export async function discoverHNProductTalk(names, { hitsPerPage = 20 } = {}) {
  const out = [];
  const nf = `created_at_i>${Math.floor((Date.now() - 7 * 86400e3) / 1000)}`;
  for (const name of names) {
    try {
      const j = await fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`"${name}"`)}&hitsPerPage=${hitsPerPage}&numericFilters=${encodeURIComponent(nf)}`);
      for (const h of j.hits || []) {
        const isStory = !!h.title;
        const text = isStory ? (h.title + ' ' + (h.story_text || '')) : h.comment_text;
        if (!text) continue;
        out.push({
          title: isStory ? h.title : (h.story_title || '(HN thread)'),
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          text,
          date: h.created_at,
          platform: 'hn-product',
          engagement: (h.points || h.story_points || 0) + 2 * ((h.num_comments || 0) + (h.story_comment_count || 0)),
        });
      }
    } catch (e) {
      console.error(`hn product "${name}" failed: ${e.message}`);
    }
    await sleep(400);
  }
  return out;
}

// Per-product mention sweep — Google News, 7d window. Links are redirects;
// titles + descriptions still carry claims.
export async function discoverNewsProductTalk(names, { days = 7 } = {}) {
  const out = [];
  for (const name of names) {
    try {
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)} when:${days}d&hl=en-US&gl=US&ceid=US:en`, {
        headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const item of parseRSS2(await res.text())) out.push({ ...item, platform: 'news-product' });
    } catch (e) {
      console.error(`news product "${name}" failed: ${e.message}`);
    }
    await sleep(800);
  }
  return out;
}
