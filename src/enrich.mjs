// Enrichment: fxtwitter returns exact post text plus engagement counts.
// cdn.syndication.twimg.com works but leaves view_count null, so it is not
// usable for velocity scoring.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export async function enrichTweet({ user, id }) {
  const res = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fxtwitter HTTP ${res.status}`);
  const data = await res.json();
  const t = data?.tweet;
  if (!t) throw new Error(data?.error ?? 'no tweet in fxtwitter response');
  return {
    id: `${t.author?.screen_name ?? user}/${id}`,
    user: t.author?.screen_name ?? user,
    authorName: t.author?.name ?? null,
    authorFollowers: t.author?.followers ?? null,
    text: t.text ?? '',
    createdAt: t.created_at ?? null,
    likes: t.likes ?? 0,
    retweets: t.retweets ?? 0,
    replies: t.replies ?? 0,
    views: t.views ?? 0,
    image: t.media?.photos?.[0]?.url || t.media?.videos?.[0]?.thumbnail_url || null,
    url: `https://x.com/${t.author?.screen_name ?? user}/status/${id}`,
  };
}

// Serial with a small gap — one host, no burst needed at our volumes.
export async function enrichAll(posts, { max = 40, delayMs = 250 } = {}) {
  const out = [];
  for (const p of posts.slice(0, max)) {
    try {
      out.push(await enrichTweet(p));
    } catch (e) {
      out.push({ ...p, enrichError: e.message });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}
