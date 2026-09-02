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

export async function discoverFromHN(queries, { numericFilters = '', hitsPerPage = 100, perQueryCap = 40 } = {}) {
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
