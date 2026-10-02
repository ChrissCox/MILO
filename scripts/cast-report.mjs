// The cast report and the map report (PLAN.md Phase 5b): who the named people are, what each
// sheet still lacks, how each one sounds, and who stands where and why.
//   node scripts/cast-report.mjs          the whole report
//   node scripts/cast-report.mjs --check  exit 1 if any sheet has a gap, a voice fault or no reason for its place
import { readFileSync, readdirSync } from 'node:fs';

import { sheetGaps, spokenLines, voiceFaults, ticCount, isLocal } from '../src/sheets.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';

const dir = new URL('../content/people/npcs/', import.meta.url);
const people = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')));
const riftgen = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: riftgen.regionWords });
const wilds = createWilds({ worldgen, maxChunks: 64 });

const arrives = (p) => {
  const a = p.after;
  if (a === undefined) return 'from the start';
  if (typeof a === 'string') return `after the chapter “${a}”`;
  if (a?.genre) return `after a ${a.genre} rift is mended`;
  if (a?.built) return `after ${a.built} building${a.built === 1 ? '' : 's'}`;
  return 'from the start';
};

let problems = 0;
const flag = (text) => { problems += 1; return `  ! ${text}`; };

console.log('THE CAST\n');
for (const p of people) {
  const spoken = spokenLines(p);
  const { withTic } = ticCount(p);
  console.log(`${p.name}, ${p.title} (${p.id}): ${isLocal(p) ? 'named local, never leaves' : 'companion'}; ${arrives(p)}`);
  console.log(`  voice: ${p.voice?.rhythm ?? ''} Tic “${p.voice?.tic ?? ''}” in ${withTic} of ${spoken.length} lines; at most ${p.voice?.maxWords ?? '?'} words a sentence.`);
  console.log(`  wants: ${p.sheet?.wants?.now ?? ''}${p.sheet?.wants?.next ? ` Then: ${p.sheet.wants.next}` : ''}`);
  console.log(`  loves: ${(p.gifts?.loves || []).join(', ') || 'nothing yet'}; likes: ${(p.gifts?.likes || []).join(', ') || 'nothing'}`);
  for (const gap of sheetGaps(p)) console.log(flag(`sheet lacks ${gap}`));
  for (const line of spoken) for (const fault of voiceFaults(p, line)) console.log(flag(`${fault}: ${line}`));
  console.log('');
}

console.log('WHO STANDS WHERE\n');
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
for (const p of people) {
  const at = p.where;
  const place = worldgen.inHeart(at.x, at.y) ? 'the vale' : (wilds.hushRegion?.(at.x, at.y)?.name || worldgen.regionAt?.(at.x, at.y) || 'the wilds');
  console.log(`${p.name.padEnd(20)} ${`${at.x},${at.y}`.padEnd(9)} ${String(typeof place === 'string' ? place : place?.name ?? 'the wilds').padEnd(18)} ${p.why ?? ''}`);
  if (typeof p.why !== 'string' || p.why.length < 30) console.log(flag(`${p.id} stands there for no reason`));
  const ok = worldgen.inHeart(at.x, at.y) ? worldgen.walkable(at.x, at.y) : worldgen.walkable(at.x, at.y) && !wilds.blocked(at.x, at.y);
  if (!ok) console.log(flag(`${p.id} can't stand at ${at.x},${at.y}`));
  for (const o of people) if (o.id < p.id && d(o.where, at) < 5) console.log(flag(`${p.id} stands on top of ${o.id}`));
}
console.log(`\n${people.length} people, ${people.reduce((n, p) => n + spokenLines(p).length, 0)} spoken lines, ${problems} problem${problems === 1 ? '' : 's'}.`);
if (process.argv.includes('--check') && problems) process.exit(1);
