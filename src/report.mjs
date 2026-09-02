// Registry report — coverage health at a glance: rows per category, claim
// quality, mention coverage, and the gap to board targets. `npm run report`.
import { readFileSync } from 'node:fs';
import { loadState } from './state.mjs';

// Board coverage targets per category (the user's ask: ~50+ per board).
const TARGETS = { normie: 50, dev: 50, agents: 50, creative: 50, voice: 50, physical: 260 };

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : '—';
}

export function report(state) {
  const prods = Object.values(state.products);
  const by = {};
  for (const p of prods) {
    const b = (by[p.category] ??= { rows: 0, claimed: 0, mentioned: 0, mentions: 0, stale: 0, lowConfidence: 0, chartOnly: 0 });
    b.rows++;
    if (p.arrUsdReported) b.claimed++;
    if (p.mentions.length) b.mentioned++;
    b.mentions += p.mentions.length;
    if (p.stale) b.stale++;
    if (p.confidence === 'low') b.lowConfidence++;
    if ((p.basis || '').includes('App Store')) b.chartOnly++;
  }

  console.log(`registry: ${prods.length} rows · state runs=${state.counters.runs} · lastRun=${state.lastRunAt}`);
  console.log('\ncategory    rows  target  claims  mention-cov  mentions  chart-only  stale  low-conf');
  for (const [cat, b] of Object.entries(by).sort((a, z) => (TARGETS[z[0]] ?? 0) - (TARGETS[a[0]] ?? 0))) {
    const target = TARGETS[cat];
    const gap = target != null && b.rows < target ? `  ← ${target - b.rows} to go` : (target != null ? '  ✓' : '');
    console.log(
      `${cat.padEnd(11)}${String(b.rows).padStart(4)}  ${String(target ?? '—').padStart(6)}  ${pct(b.claimed, b.rows).padStart(6)}  ${pct(b.mentioned, b.rows).padStart(11)}  ${String(b.mentions).padStart(8)}  ${String(b.chartOnly).padStart(10)}  ${String(b.stale).padStart(5)}  ${String(b.lowConfidence).padStart(8)}${gap}`,
    );
  }

  // Claim provenance: a number without a dated source never entered, but
  // provenance quality still varies — surface the mix.
  const sources = {};
  for (const p of prods) {
    const t = p.arrSource?.url ? new URL(p.arrSource.url).host : (p.arrUsdReported ? '(no source url)' : null);
    if (t) sources[t] = (sources[t] || 0) + 1;
  }
  const top = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) {
    console.log('\ntop claim sources:');
    for (const [host, n] of top) console.log(`  ${String(n).padStart(4)}  ${host}`);
  }

  const seedRows = (() => {
    try {
      return JSON.parse(readFileSync('data/agent-seed.json', 'utf8')).length;
    } catch {
      return 0;
    }
  })();
  console.log(`\nagent-seed.json: ${seedRows} rows (drop verified claim rows here — they merge on next run, never downgrade)`);
  return by;
}

const state = loadState();
report(state);
