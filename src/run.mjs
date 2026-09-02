// Orchestrator: discover → enrich → gate → select → merge state → render (spec §6).
import { QUERIES, ALGOLIA_WINDOW_HOURS, HF_TOP, SHOW_HN, STATE_PATH } from './config.mjs';
import { discoverFromHN, discoverShowHN, discoverHFPapers } from './discover.mjs';
import { enrichAll } from './enrich.mjs';
import { gate, select } from './rank.mjs';
import { loadState, saveState, prune } from './state.mjs';
import { writeReadme, writeArchive } from './render.mjs';
import { exportFeed } from './feed.mjs';
import { updateProducts } from './leaderboard.mjs';
import { fetchJSON, tokenize, sleep } from './util.mjs';

const now = Date.now();

async function main() {
  const state = loadState();
  state.counters.runs++;
  const sinceI = Math.floor((now - ALGOLIA_WINDOW_HOURS * 3.6e6) / 1000);

  // 1. Discovery: HN comments (4 queries) + Show HN stories + HF daily papers.
  const hn = await discoverFromHN(QUERIES, { numericFilters: `created_at_i>${sinceI}` });
  const stories = await discoverShowHN(SHOW_HN);
  const papers = await discoverHFPapers(HF_TOP);
  if (hn.ok) state.counters.lastAlgoliaOk = new Date(now).toISOString();

  // 2. Enrich tweet candidates via fxtwitter.
  const candidates = await enrichAll(hn.posts, { max: 45 });

  // 3. Gate: floors, follower-scaled floor, near-dup vs 72h window, classify.
  const gated = [];
  const drops = [];
  for (const t of candidates) {
    if (t.enrichError) { drops.push(`${t.id}: ${t.enrichError}`); continue; }
    if (state.items[t.id]) { state.items[t.id].lastSeen = new Date(now).toISOString(); continue; }
    const r = gate(t, {
      channel: 'hn-comment',
      hnStoryId: t.hnStoryId, hnStoryTitle: t.hnStoryTitle,
      seenTexts: state.seenTexts, now,
    });
    if (r.dropped) { drops.push(`${t.id}: ${r.dropped}`); continue; }
    gated.push(r.item);
  }

  // Show HN stories and HF papers become cat-2 / cat-1 rows directly.
  const linkRows = buildLinkRows(stories, papers);

  // 4. Select with caps + quotas, merge into state.
  const picks = select([...gated, ...linkRows]);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const it of gated) counts[it.category]++;
  const today = new Date(now).toISOString().slice(0, 10);
  const ids = picks.map((p) => p.id);
  for (const it of picks) {
    it.renderedOn = today;
    state.items[it.id] = it;
    if (it.text) state.seenTexts[`${new Date(now).toISOString()}|${tokenize(it.text).join(' ')}`] = it.id;
  }
  state.digests[today] = [...new Set([...(state.digests[today] || []), ...ids])];
  if (!picks.length) state.counters.consecutiveEmptyRuns++;
  else state.counters.consecutiveEmptyRuns = 0;
  state.lastRunAt = new Date(now).toISOString();
  prune(state, now);
  saveState(state);

  // 5. Render: archive first so the README's archive section sees it; then the
  // JSON exports the Pages site reads (feed + product leaderboard).
  writeArchive(picks);
  writeReadme(picks, state);
  exportFeed(state);
  const products = await updateProducts(state, candidates);
  saveState(state);

  console.log(`products: seeded=${products.seeded} corpus=${products.corpusSize} matched=${products.matched} claims=${products.claims} exported=${products.exported}`);

  console.log(`runs=${state.counters.runs} candidates=${candidates.length} gated=${gated.length} picks=${picks.length} found=${counts[1]}/${counts[2]}/${counts[3]}/${counts[4]} drops=${drops.length}`);
  if (drops.length) console.log(`drop sample: ${drops.slice(0, 8).join(' | ')}`);
}

// Show HN (points/comments floors) -> cat 2. HF papers (top by upvotes) -> cat 1.
function buildLinkRows(stories, papers) {
  const rows = [];
  for (const s of stories.slice(0, 6)) {
    rows.push({
      id: `hn:${s.objectID}`,
      user: s.author,
      authorName: null,
      url: s.url || `https://news.ycombinator.com/item?id=${s.objectID}`,
      text: s.title || '(untitled)',
      image: null,
      category: 2,
      likes: s.points || 0,
      retweets: s.num_comments || 0,
      views: 0,
      followers: 0,
      velocity: (s.points || 0) + 2 * (s.num_comments || 0),
      reason: `${s.points} HN points · ${s.num_comments} comments · Show HN`,
      channel: 'hn-story',
      hnStoryId: s.objectID,
      hnStoryTitle: s.title,
      firstSeen: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      renderedOn: null,
    });
  }
  for (const p of papers.slice(0, HF_TOP)) {
    if (p.error || !p.url) continue;
    rows.push({
      id: p.id,
      user: (p.authors[0] || 'huggingface').replace(/\s+/g, ''),
      authorName: p.authors[0] || null,
      url: p.url,
      text: p.title,
      image: null,
      category: 1,
      likes: p.upvotes || 0,
      retweets: 0,
      views: 0,
      followers: 0,
      velocity: p.upvotes || 0,
      reason: `${p.upvotes} HF upvotes · "${p.title.slice(0, 70)}" · model release`,
      channel: 'hf-papers',
      hnStoryId: null,
      hnStoryTitle: null,
      firstSeen: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      renderedOn: null,
    });
  }
  return rows;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
