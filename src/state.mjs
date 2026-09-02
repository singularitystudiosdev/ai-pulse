// State lives in git (spec §4). actions/cache is never the source of truth.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { STATE_PATH, ITEMS_CAP, PRUNE_DAYS } from './config.mjs';

export function emptyState() {
  return {
    version: 1,
    lastRunAt: null,
    items: {},
    digests: {},
    seenTexts: {},
    products: {},
    counters: { runs: 0, consecutiveEmptyRuns: 0, lastAlgoliaOk: null, cat2StarvedRuns: 0 },
  };
}

export function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) };
  } catch (e) {
    console.error(`state.json unreadable (${e.message}); starting fresh`);
    return emptyState();
  }
}

export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
}

// Drop items older than PRUNE_DAYS not in the last 3 digests, then cap at ITEMS_CAP.
export function prune(state, now = Date.now()) {
  const recentDigestIds = new Set(
    Object.entries(state.digests)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, 3)
      .flatMap(([, ids]) => ids),
  );
  const cutoff = now - PRUNE_DAYS * 86400e3;
  for (const [id, it] of Object.entries(state.items)) {
    if (Date.parse(it.firstSeen) < cutoff && !recentDigestIds.has(id)) delete state.items[id];
  }
  const entries = Object.entries(state.items).sort(([, a], [, b]) => (a.lastSeen < b.lastSeen ? 1 : -1));
  state.items = Object.fromEntries(entries.slice(0, ITEMS_CAP));
}
