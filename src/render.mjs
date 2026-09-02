// README marker injection + archive (spec §5). The card image is the one thing
// only this chain can render without auth.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, FEED_START, FEED_END, ARCHIVE_START, ARCHIVE_END, ARCHIVE_DIR } from './config.mjs';
import { utcDate } from './util.mjs';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function tweetCell(it) {
  const label = clip(esc(it.text), 110);
  const img = it.image ? `<br>![card](${it.image})` : '';
  return `[${label}](${it.url})${img}`;
}

// Channel-aware cells: only hn-comment rows are X posts, so only they get an
// X handle and ♥/RT signals — HN/HF rows would render fake handles otherwise.
function authorCell(it) {
  if (it.channel === 'hn-comment') return `[@${it.user}](https://x.com/${it.user})`;
  return esc(it.authorName || it.user);
}

function signalCell(it) {
  if (it.channel === 'hn-comment') return `${it.likes}♥ ${it.retweets}RT · v ${it.velocity}`;
  return `${it.reason.split(' · ')[0]} · v ${it.velocity}`;
}

function table(items) {
  const head = '| post | source | signal | why it\'s here |\n|---|---|---|---|\n';
  const rows = items.map((it) => {
    return `| ${tweetCell(it)} | ${authorCell(it)} | ${signalCell(it)} | ${esc(it.reason)} |`;
  });
  return head + rows.join('\n') + '\n';
}

export function renderFeed(items, state) {
  const updated = state.lastRunAt ? state.lastRunAt.replace('T', ' ').slice(0, 16) + ' UTC' : '—';
  let md = `\n> **Last updated:** ${updated} · runs every 30 min · 0 secrets, no X API\n\n`;
  for (const cat of [1, 2, 3, 4]) {
    const rows = items.filter((i) => i.category === cat);
    md += `### ${CATEGORIES[cat].emoji} ${CATEGORIES[cat].name} (${rows.length})\n\n`;
    if (!rows.length) { md += '_nothing cleared the floor this run_\n\n'; continue; }
    md += table(rows) + '\n';
  }
  md += '<sub>Known bias: sourced from what HN commenters + Show HN + HF upvoters surface, so long-tail SaaS launches are under-represented.</sub>\n';
  return md;
}

export function writeReadme(items, state) {
  const base = existsSync('README.md') ? readFileSync('README.md', 'utf8') : defaultReadme();
  const feed = renderFeed(items, state);
  const archives = listArchives();
  const archiveBlock = archives.length
    ? archives.map((d) => `- [${d}](${ARCHIVE_DIR}/${d}.md)`).join('\n') + `\n- [index](${ARCHIVE_DIR}/index.md)`
    : '_no archives yet_';
  let out = inject(base, FEED_START, FEED_END, feed);
  out = inject(out, ARCHIVE_START, ARCHIVE_END, archiveBlock);
  writeFileSync('README.md', out);
}

function inject(text, start, end, body) {
  const open = text.indexOf(start);
  const close = text.indexOf(end);
  if (open === -1 || close === -1 || close < open) return `${text}\n${start}\n${body}\n${end}\n`;
  return text.slice(0, open + start.length) + '\n' + body + '\n' + text.slice(close);
}

function defaultReadme() {
  return [
    '# ai-pulse — AI on X, ranked',
    '',
    '> Fresh X/Twitter AI posts (model releases, SaaS launches, embodied AI, viral posts),',
    '> discovered via HN Algolia + Hugging Face + fxtwitter. No X API, no auth, 0 secrets.',
    '',
    FEED_START, FEED_END, '',
    '## Archive', '', ARCHIVE_START, ARCHIVE_END, '',
  ].join('\n');
}

function listArchives() {
  if (!existsSync(ARCHIVE_DIR)) return [];
  return readFileSync(join(ARCHIVE_DIR, 'index.md'), 'utf8')
    .match(/\d{4}-\d{2}-\d{2}/g) || [];
}

export function writeArchive(items, counts) {
  const date = utcDate();
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  let md = `# Feed ${date}\n\n`;
  for (const cat of [1, 2, 3, 4]) {
    const rows = items.filter((i) => i.category === cat);
    md += `## ${CATEGORIES[cat].emoji} ${CATEGORIES[cat].name} (${rows.length})\n\n`;
    md += rows.length ? table(rows) + '\n' : '_none_\n\n';
  }
  writeFileSync(join(ARCHIVE_DIR, `${date}.md`), md);

  const indexPath = join(ARCHIVE_DIR, 'index.md');
  const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '# Archive index\n\n';
  if (!existing.includes(date)) {
    const lines = existing.split('\n');
    const insertAt = lines.findIndex((l) => l.startsWith('- '));
    lines.splice(insertAt === -1 ? lines.length : insertAt, 0, `- ${date} (${items.length} posts)`);
    writeFileSync(indexPath, lines.join('\n'));
  }
}
