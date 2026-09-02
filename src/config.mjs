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

// ---- leaderboard depth knobs (channels live-verified 2026-09-02) ----
// App Store charts: the only no-auth consumer-revenue proxy. customerreviews
// RSS is dead (empty envelope for every id tested) — not used. Genre-scoped
// top-grossing feeds verified 2026-09-02: Entertainment (6016) and Health &
// Fitness (6013) have clean AI density; Photo & Video (6008) is dense but
// ~25/45 AI names are template clones (needs the blocklists below);
// Food & Drink (6006), Education (6024) and Utilities (6002) are hijacked by
// translator / thrift-scanner / AI-cleaner junk — never auto-register those.
export const APPSTORE_CHART_FEEDS = [
  { kind: 'top-grossing', url: 'https://itunes.apple.com/us/rss/topgrossingapplications/limit=100/json' },
  { kind: 'top-grossing-entertainment', url: 'https://itunes.apple.com/us/rss/topgrossingapplications/limit=100/genre=6016/json' },
  { kind: 'top-grossing-health', url: 'https://itunes.apple.com/us/rss/topgrossingapplications/limit=100/genre=6013/json' },
  { kind: 'top-grossing-photo-video', url: 'https://itunes.apple.com/us/rss/topgrossingapplications/limit=100/genre=6008/json' },
  { kind: 'top-free-productivity', url: 'https://itunes.apple.com/us/rss/topfreeapplications/limit=100/genre=6007/json' },
];
// Serial template-clone publishers flooding the Photo & Video grossing chart
// (verified 2026-09-02) — their apps never auto-register.
export const APPSTORE_PUBLISHER_BLOCKLIST = [
  'cool summer', 'scaleup', 'lyrebird', 'xlabs', 'deep flow', 'deep link meta',
  'tpc invest', 'ylee studio', 'hubx', 'viral vision', 'spark dynamic',
  'flarial', 'deepix', 'aiby', 'prequel',
];
// Name patterns that are junk even from an unknown publisher.
export const APPSTORE_NAME_BLOCKLIST =
  /\b(cleaner|keyboard|font|translator|thrift|coin|sneaker|legit check|value scan|widget|wallpaper)\b/i;
// Ben's Bites moved to Substack (news.bensbites.com serves HTML); theresanaiforthat
// and toolify.ai are Cloudflare-walled unauth — not usable from Actions.
export const NEWSLETTERS = [
  { name: 'Bens Bites', url: 'https://bensbites.substack.com/feed' },
  { name: 'The Rundown AI', url: 'https://www.therundown.ai/feed' },
];
// Per-run rotation: every run gives ROTATE_PRODUCTS_PER_RUN tracked products a
// dedicated Reddit/HN/News mention sweep. Pool = tracked products with an ARR
// figure, so the whole pool recycles every pool/8 runs (~6h at a 30-min cadence).
export const PRODUCT_ROTATION_POOL = 48;
export const ROTATE_PRODUCTS_PER_RUN = 8;
export const REDDIT_SUBREDDITS = [
  'SaaS', 'SideProject', 'artificial', 'robotics', 'MachineLearning', 'startups',
  'ChatGPT', 'OpenAI', 'Singularity', 'ArtificialInteligence', 'Entrepreneur', 'Apps',
];
// Reddit enforces ~1 RSS request / 60s per IP unauth since 2026-06-11
// (lapcatsoftware.com/articles/2026/6/3.html) — auth does not lift it. Budget
// 2 sub feeds + 3 product searches per run: subs recycle in 6 runs, the
// 48-product search pool in 16 runs (~8h at a 30-min cadence).
export const REDDIT_INTERVAL_MS = 60_000;
export const REDDIT_SUBS_PER_RUN = 2;
export const REDDIT_SEARCH_PER_RUN = 3;

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
