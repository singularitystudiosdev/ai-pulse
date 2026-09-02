// Machine feed for the Pages front-end: flat, newest-first, capped. The site
// fetches data/feed.json directly — no backend, no auth, same commit cycle.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FEED_PATH = 'data/feed.json';
const CAP = 200;

export function exportFeed(state) {
  const items = Object.values(state.items)
    .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : -1))
    .slice(0, CAP)
    .map(({ hnStoryTitle, hnStoryId, lastSeen, renderedOn, ...keep }) => keep);
  const payload = { version: 1, generatedAt: state.lastRunAt, count: items.length, items };
  mkdirSync(dirname(FEED_PATH), { recursive: true });
  writeFileSync(FEED_PATH, JSON.stringify(payload));
  return items.length;
}
