// Product categories for the leaderboard. 'physical' carries subcategories —
// the user asked to drill Physical AI into Military / Consumer / etc.
export const CATEGORIES = {
  physical: {
    emoji: '🦾',
    name: 'Physical AI',
    blurb: 'real-world hardware × AI',
    subcats: {
      military: { emoji: '🎖', name: 'Military & Defense' },
      consumer: { emoji: '📱', name: 'Consumer Devices' },
      industrial: { emoji: '🏭', name: 'Industrial & Robotics' },
    },
  },
  dev: { emoji: '🛠', name: 'Developer SaaS', blurb: 'tools developers pay for' },
  normie: { emoji: '🧑‍💻', name: 'Normie SaaS', blurb: 'simple apps normal people use' },
  agents: { emoji: '🤖', name: 'Agents & Automation', blurb: 'work the software does itself' },
  creative: { emoji: '🎨', name: 'Creative & Video AI', blurb: 'images, video, music, slides' },
  voice: { emoji: '🗣️', name: 'Voice AI', blurb: 'speaks, listens, calls' },
};

export const SUBCAT_KEYS = ['military', 'consumer', 'industrial'];

// Days a product keeps its 🔥 badge after first being registered.
export const NEW_WINDOW_DAYS = 14;

// Momentum: gravity-weighted engagement over recent mentions (HN-gravity
// family, same 1.8 exponent as the feed ranking) plus ARR-growth bonus.
export const MOMENTUM = { halfLifeDays: 14, gravity: 1.8, arrGrowthWeight: 0.35 };

// Sources that may add/update products. Registered products are matched by
// name; anything else that looks like a launch becomes a candidate.
export const MATCH_MIN_LEN = 3;

// The verified ledger (data/arr-ledger.json) uses market-analyst slugs;
// map them onto the board's internal categories. "normie" keeps the user's
// own name for the consumer bucket.
export const LEDGER_ALIASES = {
  'physical-ai': 'physical',
  'dev-saas': 'dev',
  'consumer-ai': 'normie',
  'agentic-automation': 'agents',
  'generative-media': 'creative',
  'voice-ai': 'voice',
};
