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
export async function discoverReddit(subreddits, { perSub = 25 } = {}) {
  const out = [];
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
  for (const sub of subreddits) {
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
    // Reddit's unauth rate limit is per-client and tight (measured 2026-09-02:
    // a second subreddit fetched 8s apart 429'd once, then succeeded).
    await sleep(8000);
  }
  return out;
}

// Product Hunt launch feed (Atom). Titles only — harvest, never query.
export async function discoverProductHunt() {
  try {
    const res = await fetch('https://www.producthunt.com/feed', {
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
      if (title && link) out.push({ title, url: link.trim(), text: title, date: updated, platform: 'ph' });
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
