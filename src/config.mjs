// Central knobs — spec §1-§4. All times UTC.
export const QUERIES = [
  'x.com', 'x.com humanoid', 'x.com robot', 'x.com launch',
  'x.com funding', 'x.com demo', 'x.com startup',
];
export const ALGOLIA_WINDOW_HOURS = 72; // lookback for HN comments (MAX_AGE_HOURS still gates freshness)
export const MAX_AGE_HOURS = 36;        // hard gate: older than this = the wave passed
export const MIN_TEXT_LEN = 60;
export const MIN_LIKES = 25;
export const PER_STORY_CAP = 2;         // one controversial tweet spawns many comments
export const PER_AUTHOR_CAP = 2;
export const QUOTAS = { 1: 5, 2: 4, 3: 3, 4: 3 }; // per-digest per-category max (15 rows)
export const HF_TOP = 5;                // top HF daily papers by upvotes -> cat 1
export const SHOW_HN = { query: 'AI', minPoints: 5, minComments: 2, hits: 30 };

export const GRAVITY = 1.8;
export const ITEMS_CAP = 5000;
export const PRUNE_DAYS = 30;
export const JACCARD_THRESHOLD = 0.65;
export const NEARDUP_WINDOW_HOURS = 72;

export const STATE_PATH = 'data/state.json';
export const README_PATH = 'README.md';
export const ARCHIVE_DIR = 'archive';
export const FEED_START = '<!--START_SECTION:feed-->';
export const FEED_END = '<!--END_SECTION:feed-->';
export const ARCHIVE_START = '<!--START_SECTION:archive-->';
export const ARCHIVE_END = '<!--END_SECTION:archive-->';

export const CATEGORIES = {
  1: { name: 'Model releases', emoji: '🧠' },
  2: { name: 'AI SaaS launches', emoji: '🚀' },
  3: { name: 'Embodied AI', emoji: '🦾' },
  4: { name: 'Viral AI posts', emoji: '🔥' },
};
