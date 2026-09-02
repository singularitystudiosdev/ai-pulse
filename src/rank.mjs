// Velocity + floors + caps + quotas (spec §3). Floors gate BEFORE ranking.
import { GRAVITY, MAX_AGE_HOURS, MIN_TEXT_LEN, MIN_LIKES, PER_STORY_CAP, PER_AUTHOR_CAP, QUOTAS, NEARDUP_WINDOW_HOURS, JACCARD_THRESHOLD } from './config.mjs';
import { ageHours, tokenize, jaccard } from './util.mjs';
import { classify } from './classify.mjs';

export function velocity({ likes, retweets, views, ageH }) {
  if (ageH == null) return 0;
  return (likes + 3 * retweets + 0.15 * (views || 0)) / Math.pow(ageH + 2, GRAVITY);
}

function followerFloor(followers) {
  return Math.min(500, Math.max(15, (followers || 0) * 0.001));
}

// Gate: hard floors + follower-scaled floor + classify. Returns null or enriched item.
export function gate(tweet, { hnStoryId, hnStoryTitle, channel, seenTexts, now }) {
  const { category, matched } = classify(tweet.text);
  const ageH = ageHours(tweet.createdAt);
  const reasons = [];
  if (ageH == null || ageH > MAX_AGE_HOURS) reasons.push(`age ${ageH?.toFixed(0)}h > ${MAX_AGE_HOURS}h`);
  if ((tweet.likes || 0) < MIN_LIKES) reasons.push(`likes ${(tweet.likes || 0)} < ${MIN_LIKES}`);
  if ((tweet.text || '').length < MIN_TEXT_LEN) reasons.push(`text < ${MIN_TEXT_LEN} chars`);
  if ((tweet.likes || 0) < followerFloor(tweet.authorFollowers)) reasons.push('likes below follower-scaled floor');
  if (reasons.length) return { dropped: reasons.join('; ') };

  const v = velocity({ likes: tweet.likes, retweets: tweet.retweets, views: tweet.views, ageH });
  const tokens = tokenize(tweet.text);
  for (const [key, id] of Object.entries(seenTexts)) {
    const seenAt = Date.parse(key.slice(0, 24)); // keys are `${iso}|${itemId}`
    if (Number.isNaN(seenAt) || now - seenAt > NEARDUP_WINDOW_HOURS * 3.6e6) continue;
    if (jaccard(new Set(tokens), new Set(tokenize(key.slice(25)))) >= JACCARD_THRESHOLD) {
      return { dropped: `near-dup of ${id}` };
    }
  }

  const age = ageH < 1 ? '<1h' : `${Math.round(ageH)}h`;
  const via = hnStoryTitle ? ` · via HN: "${hnStoryTitle.slice(0, 70)}"` : '';
  const kw = matched.length ? ` · matched "${matched.join('", "')}"` : '';
  return {
    item: {
      id: tweet.id,
      user: tweet.user,
      authorName: tweet.authorName,
      url: tweet.url,
      text: (tweet.text || '').slice(0, 300),
      image: tweet.image || null,
      category,
      likes: tweet.likes || 0,
      retweets: tweet.retweets || 0,
      views: tweet.views || 0,
      followers: tweet.authorFollowers || 0,
      velocity: Math.round(v * 10) / 10,
      reason: `${v < 10 ? v.toFixed(1) : Math.round(v)} velocity · ${tweet.likes}♥ ${tweet.retweets}RT · ${tweet.views ?? 0} views · ${age} old${kw}${via}`,
      channel,
      hnStoryId: hnStoryId || null,
      hnStoryTitle: hnStoryTitle || null,
      firstSeen: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      renderedOn: null,
    },
  };
}

// Apply per-author and per-HN-story caps, then per-category velocity quotas.
export function select(items) {
  const byAuthor = new Map();
  const byStory = new Map();
  const kept = [];
  for (const it of items.sort((a, b) => b.velocity - a.velocity)) {
    const a = (byAuthor.get(it.user) || 0) + 1;
    if (a > PER_AUTHOR_CAP) continue;
    const s = it.hnStoryId ? ((byStory.get(it.hnStoryId) || 0) + 1) : 1;
    if (it.hnStoryId && s > PER_STORY_CAP) continue;
    byAuthor.set(it.user, a);
    if (it.hnStoryId) byStory.set(it.hnStoryId, s);
    kept.push(it);
  }
  // Round-robin fill by category quota, always preferring higher velocity.
  const out = [];
  const pools = Object.fromEntries(Object.keys(QUOTAS).map((c) => [c, kept.filter((i) => i.category === +c)]));
  for (let round = 0; ; round++) {
    let added = false;
    for (const c of Object.keys(QUOTAS)) {
      if (out.filter((i) => i.category === +c).length >= QUOTAS[c]) continue;
      const next = pools[c][round];
      if (next) { out.push(next); added = true; }
    }
    if (!added) break;
  }
  return out;
}
