// The content manifest and Phase 4's area check (CONTRACT-PHASE4.md §9.1, §13 waves 0 and 1 G):
// electron/content.cjs, which main and the world preview read content through, and
// src/content4.js's phase4Problem (presence, version 1 and each file's top-level keys).
//   node --test tests/content-manifest.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, readFile, writeFile, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { phase4Problem, FILE_KEYS, COMPANION_KEYS, REQUIRED_COMPANIONS, PHASE4_TALKS } from '../src/content4.js';

const require = createRequire(import.meta.url);
const manifest = require('../electron/content.cjs');
const { loadContent, CONTENT_DIR, LIMITS, PHASE3_KEYS } = manifest;

const ORDER = ['genres', 'riftgen', 'fortress', 'wilds', 'story', 'skills', 'xp', 'economy', 'spells', 'examine', 'trails', 'sky', 'combat', 'party', 'camp'];

// Main's reader before Phase 4 (electron/main.cjs at 0b8f5ae, readContentFile), word for word
// but for the report.
async function oldMainRead(name) {
  const file = path.join(CONTENT_DIR, `${name}.json`);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('it is missing or too large');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
// The world preview's reader before Phase 4 (scripts/world-preview-main.cjs at 0b8f5ae).
function oldPreviewRead(name) {
  try {
    return JSON.parse(readFileSync(path.join(CONTENT_DIR, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function tempRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'milo-content-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, relative, text) {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}
// A JSON object of exactly `bytes` bytes: {"pad":""} is ten.
const sized = (bytes, fill = 'x') => `{"pad":"${fill.repeat(bytes - 10)}"}`;

// For the rest of the test, directory listings come back in reverse name order, so the order the
// bundle has is the manifest's own sort, never the file system's (NTFS already lists by name).
// → { calls }, how many listings it turned round.
function reverseListings(t) {
  const fsp = require('node:fs/promises');
  const original = fsp.readdir;
  const seen = { calls: 0 };
  const nameOf = (entry) => (typeof entry === 'string' ? entry : entry.name);
  fsp.readdir = async function reversed(...args) {
    seen.calls += 1;
    const entries = await original.apply(this, args);
    return entries.sort((a, b) => (nameOf(a) < nameOf(b) ? 1 : nameOf(a) > nameOf(b) ? -1 : 0));
  };
  t.after(() => { fsp.readdir = original; });
  return seen;
}

test('the five Phase 3 keys come out exactly as main’s and the preview’s old readers made them', async () => {
  const reports = [];
  const bundle = await loadContent({ report: (m) => reports.push(m) });
  assert.deepEqual(reports, [], 'nothing to report with the real content folder');
  for (const key of PHASE3_KEYS) {
    const main = await oldMainRead(key);
    assert.ok(main, `${key}.json reads`);
    assert.deepEqual(bundle[key], main, `${key}: deep-equal to main’s old reader`);
    assert.equal(JSON.stringify(bundle[key]), JSON.stringify(main), `${key}: the same bytes over IPC`);
    assert.deepEqual(bundle[key], oldPreviewRead(key), `${key}: and to the preview’s`);
  }
  assert.deepEqual(PHASE3_KEYS, ['genres', 'riftgen', 'fortress', 'wilds', 'story']);
});

test('the bundle has §9.1’s keys in order, with Phase 4’s groups shaped or null', async () => {
  const bundle = await loadContent();
  assert.deepEqual(Object.keys(bundle), ORDER);
  const shapes = { combat: ['rules', 'callings', 'spells', 'leads', 'foes', 'anims', 'tuning'], party: ['companions', 'regulars', 'teamups', 'banter'], camp: ['scenes', 'talks'] };
  for (const [group, keys] of Object.entries(shapes)) {
    if (bundle[group] === null) continue; // not written yet
    assert.deepEqual(Object.keys(bundle[group]), keys, `${group}'s keys`);
  }
  for (const key of ['skills', 'xp', 'economy', 'spells', 'examine', 'trails', 'sky']) {
    assert.ok(bundle[key] === null || (typeof bundle[key] === 'object' && !Array.isArray(bundle[key])), `${key} is an object or null`);
  }
});

test('a missing file is null, a missing folder makes its group null, and only Phase 3’s absences are reported', async (t) => {
  const root = await tempRoot(t);
  await put(root, 'genres.json', '{"version":1}');
  await put(root, 'combat/rules.json', '{"version":1,"about":"Rules."}');
  await mkdir(path.join(root, 'party'), { recursive: true });
  const reports = [];
  const bundle = await loadContent({ dir: root, report: (m) => reports.push(m) });
  assert.deepEqual(Object.keys(bundle), ORDER);
  assert.deepEqual(bundle.genres, { version: 1 });
  assert.equal(bundle.riftgen, null);
  assert.equal(bundle.skills, null);
  assert.deepEqual(bundle.combat, { rules: { version: 1, about: 'Rules.' }, callings: null, spells: null, leads: null, foes: null, anims: null, tuning: null });
  assert.deepEqual(bundle.party, { companions: null, regulars: null, teamups: null, banter: null }, 'a missing sub-folder makes its own key null');
  assert.equal(bundle.camp, null, 'a missing folder makes its group null');
  assert.deepEqual(reports.sort(), ['fortress', 'riftgen', 'story', 'wilds'].map((n) => `Content ${n}.json unavailable: it is missing`));
});

test('directories read in name order, filtered by name; BOMs go, and a talk’s CRLF becomes LF', async (t) => {
  const listings = reverseListings(t);
  const root = await tempRoot(t);
  const bom = '﻿';
  await put(root, 'party/companions/tollkeeper.json', `${bom}{"id":"tollkeeper"}`);
  await put(root, 'party/companions/claude.json', '{"id":"claude"}');
  await put(root, 'party/companions/codex.json', '{"id":"codex"}');
  await put(root, 'party/companions/Jev.json', '{"id":"shouting"}');
  await put(root, 'party/companions/-jev.json', '{"id":"dash"}');
  await put(root, 'party/companions/notes.md', 'Not a companion.');
  await put(root, 'party/companions/readme.txt', 'Not one either.');
  await put(root, `party/companions/${'a'.repeat(41)}.json`, '{"id":"long"}');
  await put(root, 'party/companions/list.json', '["an array"]');
  await put(root, 'party/companions/broken.json', '{"id":');
  await put(root, 'camp/talks/first-night.md', `${bom}# first\r\nMilo: Hello.\r\n`);
  await put(root, 'camp/talks/tollkeeper-riddles.md', 'Tollkeeper: A riddle.\n');
  await put(root, 'camp/talks/stray.json', '{}');
  await put(root, 'camp/scenes.json', `${bom}{"version":1}`);
  const reports = [];
  const bundle = await loadContent({ dir: root, report: (m) => reports.push(m) });
  assert.equal(listings.calls, 2, 'both folders were listed, back to front');
  assert.deepEqual(Object.keys(bundle.party.companions), ['broken', 'claude', 'codex', 'list', 'tollkeeper'], 'sorted, and only lowercase .json names');
  assert.deepEqual(bundle.party.companions.tollkeeper, { id: 'tollkeeper' }, 'a BOM is stripped before parsing');
  assert.equal(bundle.party.companions.list, null, 'a JSON array is null');
  assert.equal(bundle.party.companions.broken, null, 'broken JSON is null');
  assert.deepEqual(Object.keys(bundle.camp.talks), ['first-night', 'tollkeeper-riddles'], 'talks sorted too');
  assert.deepEqual(bundle.camp.talks, { 'first-night': '# first\nMilo: Hello.\n', 'tollkeeper-riddles': 'Tollkeeper: A riddle.\n' });
  assert.deepEqual(bundle.camp.scenes, { version: 1 });
  assert.ok(reports.some((m) => m.startsWith('Content party/companions/list.json unavailable: it is not an object')), reports.join('\n'));
  assert.ok(reports.some((m) => m.startsWith('Content party/companions/broken.json unavailable')), reports.join('\n'));
});

test('caps are §9.1’s: 1 MiB a file, 200 files and 8 MiB a bundle', () => {
  assert.deepEqual({ ...LIMITS }, { fileBytes: 1_048_576, files: 200, bundleBytes: 8_388_608 });
  assert.ok(Object.isFrozen(LIMITS));
});

test('caps: a file of exactly 1 MiB reads, and one byte more is null', async (t) => {
  const exactly = await tempRoot(t);
  await put(exactly, 'examine.json', sized(LIMITS.fileBytes));
  assert.equal((await stat(path.join(exactly, 'examine.json'))).size, 1_048_576);
  const reports = [];
  const kept = await loadContent({ dir: exactly, report: (m) => reports.push(m) });
  assert.equal(kept.examine?.pad?.length, LIMITS.fileBytes - 10, 'exactly 1 MiB reads');
  assert.ok(!reports.some((m) => m.includes('examine')), reports.join('\n'));

  const over = await tempRoot(t);
  await put(over, 'examine.json', sized(LIMITS.fileBytes + 1));
  assert.equal((await stat(path.join(over, 'examine.json'))).size, 1_048_577);
  const heard = [];
  const dropped = await loadContent({ dir: over, report: (m) => heard.push(m) });
  assert.equal(dropped.examine, null, 'one byte more is null');
  assert.ok(heard.includes('Content examine.json unavailable: it is too large'), heard.join('\n'));
});

test('caps: the 201st file by name and every one after it are null', async (t) => {
  reverseListings(t);
  const root = await tempRoot(t);
  const names = Array.from({ length: LIMITS.files + 5 }, (_, i) => `c${String(i).padStart(3, '0')}`);
  for (const [i, name] of names.entries()) await put(root, `party/companions/${name}.json`, `{"n":${i}}`);
  const reports = [];
  const bundle = await loadContent({ dir: root, report: (m) => reports.push(m) });
  const companions = bundle.party.companions;
  assert.deepEqual(Object.keys(companions), names, 'every file named, in name order');
  // By name, not by position: the first 200 names read, c200 to c204 are left out.
  for (const [i, name] of names.entries()) {
    if (i < LIMITS.files) assert.deepEqual(companions[name], { n: i }, `${name} reads`);
    else assert.equal(companions[name], null, `${name} is past 200 files`);
  }
  assert.ok(reports.includes('Content party/companions/c200.json unavailable: the bundle is full'), reports.join('\n'));
  assert.ok(!reports.some((m) => m.includes('c199')), 'the 200th file was never refused');
});

test('caps: a bundle landing exactly on 8 MiB keeps its last file, and one byte more leaves it out', async (t) => {
  reverseListings(t);
  const root = await tempRoot(t);
  const names = Array.from({ length: 9 }, (_, i) => `h${i}`);
  // Seven files of exactly 1 MiB, then 1 MiB less ten bytes, then {"pad":""}: 8 MiB to the byte.
  for (let i = 0; i < 7; i += 1) await put(root, `party/companions/h${i}.json`, sized(LIMITS.fileBytes, 'y'));
  await put(root, 'party/companions/h7.json', sized(LIMITS.fileBytes - 10, 'y'));
  await put(root, 'party/companions/h8.json', sized(10));
  let total = 0;
  for (const name of names) total += (await stat(path.join(root, 'party', 'companions', `${name}.json`))).size;
  assert.equal(total, 8_388_608, 'exactly 8 MiB on disk');
  const reports = [];
  const exact = await loadContent({ dir: root, report: (m) => reports.push(m) });
  assert.deepEqual(Object.keys(exact.party.companions), names);
  for (const name of names) assert.notEqual(exact.party.companions[name], null, `${name} is kept`);
  assert.deepEqual(exact.party.companions.h8, { pad: '' }, 'the last file, landing on 8 MiB exactly, is kept');
  assert.ok(!reports.some((m) => m.includes('party/')), reports.join('\n'));

  // {"pad":"z"} is one byte more: the bundle would be 8 MiB and a byte, so h8 is left out.
  await put(root, 'party/companions/h8.json', sized(11, 'z'));
  const heard = [];
  const over = await loadContent({ dir: root, report: (m) => heard.push(m) });
  assert.deepEqual(Object.keys(over.party.companions), names);
  for (const name of names.slice(0, 8)) assert.notEqual(over.party.companions[name], null, `${name} is still kept`);
  assert.equal(over.party.companions.h8, null, 'one byte past 8 MiB');
  assert.ok(heard.includes('Content party/companions/h8.json unavailable: the bundle is full'), heard.join('\n'));
});

test('nothing outside content/ is read through a link', async (t) => {
  const root = await tempRoot(t);
  const outside = await tempRoot(t);
  await put(outside, 'secret.json', '{"secret":true}');
  await mkdir(path.join(root, 'combat'), { recursive: true });
  try {
    await symlink(path.join(outside, 'secret.json'), path.join(root, 'combat', 'rules.json'), 'file');
  } catch {
    t.skip('this account can’t make symbolic links');
    return;
  }
  const bundle = await loadContent({ dir: root });
  assert.equal(bundle.combat.rules, null);
});

test('a folder linked in from outside content/ is never read either', async (t) => {
  const root = await tempRoot(t);
  const outside = await tempRoot(t);
  await put(outside, 'combat/rules.json', '{"version":1}');
  await put(outside, 'companions/claude.json', '{"id":"claude"}');
  await put(root, 'party/regulars.json', '{"version":1}');
  try {
    await symlink(path.join(outside, 'combat'), path.join(root, 'combat'), 'junction');
    await symlink(path.join(outside, 'companions'), path.join(root, 'party', 'companions'), 'junction');
  } catch {
    t.skip('this account can’t make folder links');
    return;
  }
  const bundle = await loadContent({ dir: root });
  assert.equal(bundle.combat, null, 'a linked group folder is no folder');
  assert.equal(bundle.party.companions, null, 'a linked sub-folder is no folder');
  assert.deepEqual(bundle.party.regulars, { version: 1 });
});

// ---------------------------------------------------------------------------
// phase4Problem

// Each file's top-level keys, copied by hand from the contract's shapes (§9.2–§9.12), apart from
// `version` and `about`. Written out here, not read from src/content4.js, so a key its FILE_KEYS
// drops or adds shows up as a difference.
const SECTION_9 = {
  // §9.11
  'skills.json': ['curve', 'families', 'skills'],
  'xp.json': ['sources'],
  'economy.json': ['cap', 'ledger', 'earn', 'spend'],
  'spells.json': ['spells'],
  'sky.json': ['sun', 'twilight', 'tints', 'seasons', 'weather', 'particles'],
  // §9.2: all 40 of rules.json's keys, in the contract's order.
  'combat/rules.json': [
    'bands', 'edge', 'heat', 'actions', 'lights', 'lines', 'integrity', 'strays', 'archetypes', 'lackey',
    'elite', 'lead', 'genres', 'hidden', 'temperaments', 'gentle', 'conditions', 'surfaces', 'surfaceGrowth', 'hazard',
    'budgets', 'tiers', 'deepRank', 'road', 'rewards', 'work', 'workPast12', 'adapt', 'modes', 'rests',
    'cheers', 'warmth', 'warding', 'tuning', 'sight', 'weapons', 'armour', 'cover', 'timing', 'odds',
  ],
  // §9.3, §9.5, §9.7, §9.8, §9.9
  'combat/callings.json': ['charges', 'circles', 'callings', 'paths', 'abilities', 'weaponArts', 'boons', 'items', 'gifts'],
  'combat/spells.json': ['spells'],
  'combat/leads.json': ['mechanics', 'fallback', 'hooks'],
  'combat/foes.json': ['canon', 'creatures', 'caves', 'mimic', 'abilities', 'greatOnes'],
  'combat/anims.json': ['poses', 'flourishes', 'effects', 'spells', 'clipPoses'],
  // tuning.json's two tables the rules read; `measured` and `fights` are the run's record.
  'combat/tuning.json': ['integrityFactor', 'xInt'],
  // §9.6: regulars.json; teamups.json and banter.json are data only.
  'party/regulars.json': ['callingByArchetype', 'personalityByTemperament', 'ask', 'noRoom', 'signatures', 'tricks', 'abilityDefs', 'barks'],
  'party/teamups.json': [],
  'party/banter.json': [],
  // §9.10, §9.12
  'camp/scenes.json': ['scenes'],
  'examine.json': ['groups'],
  'trails.json': ['tiers', 'trails'],
};
// §9.6: what every companion file has, the ten data-only ones included.
const SECTION_9_6_COMPANION = ['id', 'name', 'pronoun', 'calling', 'paths', 'joins', 'service', 'fieldSkill', 'damageKind', 'examine'];
// Which area each file switches off (§9.1).
const AREA_OF = (where) => {
  if (where.startsWith('combat/')) return 'combat';
  if (where.startsWith('party/') || where.startsWith('camp/')) return 'party';
  return ['examine.json', 'trails.json'].includes(where) ? 'world' : 'groundwork';
};
// The object in a bundle that holds a file, and the file's key in it: 'combat/rules.json' is
// bundle.combat.rules, 'sky.json' is bundle.sky.
const slot = (bundle, where) => {
  const parts = where.replace(/\.json$/, '').split('/');
  return parts.length === 1 ? [bundle, parts[0]] : [bundle[parts[0]], parts[1]];
};

// A bundle whose every Phase 4 file is well formed: version 1 and every top-level key §9 names.
function wellFormed() {
  const file = (keys) => Object.fromEntries([['version', 1], ['about', 'A file.'], ...keys.map((key) => [key, {}])]);
  const at = (where) => file(SECTION_9[where]);
  const companion = (id) => ({ ...file(SECTION_9_6_COMPANION), id });
  return {
    skills: at('skills.json'), xp: at('xp.json'), economy: at('economy.json'), spells: at('spells.json'), sky: at('sky.json'),
    examine: at('examine.json'), trails: at('trails.json'),
    combat: {
      rules: at('combat/rules.json'), callings: at('combat/callings.json'), spells: at('combat/spells.json'), leads: at('combat/leads.json'),
      foes: at('combat/foes.json'), anims: at('combat/anims.json'), tuning: null,
    },
    party: {
      companions: Object.fromEntries([...REQUIRED_COMPANIONS].sort().map((id) => [id, companion(id)])),
      regulars: at('party/regulars.json'), teamups: at('party/teamups.json'), banter: at('party/banter.json'),
    },
    camp: { scenes: at('camp/scenes.json'), talks: Object.fromEntries(PHASE4_TALKS.map((id) => [id, `---\nid: ${id}\n---\n# first\n`])) },
  };
}
const edit = (bundle, change) => { const copy = structuredClone(bundle); change(copy); return copy; };
const MESSAGE = /^content\/\S+ (?:is missing|can’t be read|isn’t version 1|has no “[A-Za-z0-9]+”|names another id|is empty)$/;

test('phase4Problem passes a well-formed bundle, and ignores Phase 3’s keys', () => {
  const full = wellFormed();
  assert.deepEqual(phase4Problem(full), { groundwork: null, combat: null, party: null, world: null });
  assert.deepEqual(Object.keys(phase4Problem(full)), ['groundwork', 'combat', 'party', 'world']);
  assert.equal(full.genres, undefined, 'no Phase 3 keys in it at all');
  assert.deepEqual(phase4Problem({ ...full, genres: null, riftgen: 'broken' }), phase4Problem(full));
  assert.equal(phase4Problem(edit(full, (b) => { delete b.skills.about; })).groundwork, null, 'about is documentation');
});

test('phase4Problem names each area’s first missing file, and only that area switches off', () => {
  const empty = phase4Problem({});
  assert.deepEqual(empty, {
    groundwork: 'content/skills.json is missing',
    combat: 'content/combat/rules.json is missing',
    party: 'content/party/companions/ is missing',
    world: 'content/examine.json is missing',
  });
  for (const nothing of [null, undefined, 'bundle', [], 42]) assert.deepEqual(phase4Problem(nothing), empty, String(nothing));
  const full = wellFormed();
  const cases = [
    [(b) => { b.economy = null; }, 'groundwork', 'content/economy.json is missing'],
    [(b) => { b.combat.foes = null; }, 'combat', 'content/combat/foes.json is missing'],
    [(b) => { b.combat = null; }, 'combat', 'content/combat/rules.json is missing'],
    [(b) => { b.party.banter = null; }, 'party', 'content/party/banter.json is missing'],
    [(b) => { b.party = null; }, 'party', 'content/party/companions/ is missing'],
    [(b) => { b.party.companions = {}; }, 'party', 'content/party/companions/ is missing'],
    [(b) => { delete b.party.companions.tollkeeper; }, 'party', 'content/party/companions/tollkeeper.json is missing'],
    [(b) => { delete b.party.companions.milo; }, 'party', 'content/party/companions/milo.json is missing'],
    [(b) => { delete b.party.companions.vesperine; }, 'party', 'content/party/companions/vesperine.json is missing'],
    [(b) => { delete b.party.companions.pip; delete b.party.companions.milo; }, 'party', 'content/party/companions/milo.json is missing'],
    [(b) => { b.party.companions = { milo: b.party.companions.milo }; }, 'party', 'content/party/companions/claude.json is missing'],
    [(b) => { b.camp = null; }, 'party', 'content/camp/scenes.json is missing'],
    [(b) => { b.camp.talks = null; }, 'party', 'content/camp/talks/ is missing'],
    [(b) => { delete b.camp.talks['first-night']; }, 'party', 'content/camp/talks/first-night.md is missing'],
    [(b) => { b.trails = null; }, 'world', 'content/trails.json is missing'],
  ];
  for (const [change, area, message] of cases) {
    const result = phase4Problem(edit(full, change));
    assert.equal(result[area], message, message);
    for (const other of Object.keys(result)) if (other !== area) assert.equal(result[other], null, `${message}: only ${area} switches off`);
  }
});

test('phase4Problem finds malformed files: the wrong version, a missing key, a bad companion or talk', () => {
  const full = wellFormed();
  const cases = [
    [(b) => { b.skills.version = 2; }, 'groundwork', 'content/skills.json isn’t version 1'],
    [(b) => { b.xp.version = '1'; }, 'groundwork', 'content/xp.json isn’t version 1'],
    [(b) => { delete b.sky.version; }, 'groundwork', 'content/sky.json isn’t version 1'],
    [(b) => { delete b.sky.tints; }, 'groundwork', 'content/sky.json has no “tints”'],
    [(b) => { b.economy.spend = null; }, 'groundwork', 'content/economy.json has no “spend”'],
    [(b) => { b.spells = ['not', 'an', 'object']; }, 'groundwork', 'content/spells.json can’t be read'],
    [(b) => { delete b.combat.rules.odds; }, 'combat', 'content/combat/rules.json has no “odds”'],
    [(b) => { delete b.combat.anims.clipPoses; }, 'combat', 'content/combat/anims.json has no “clipPoses”'],
    [(b) => { b.combat.tuning = { version: 1, integrityFactor: {} }; }, 'combat', 'content/combat/tuning.json has no “xInt”'],
    [(b) => { b.combat.tuning = { version: 2, integrityFactor: {}, xInt: {} }; }, 'combat', 'content/combat/tuning.json isn’t version 1'],
    [(b) => { b.party.companions.pip = null; }, 'party', 'content/party/companions/pip.json can’t be read'],
    [(b) => { b.party.companions.claude = null; }, 'party', 'content/party/companions/claude.json can’t be read'],
    [(b) => { delete b.party.companions.mae.fieldSkill; }, 'party', 'content/party/companions/mae.json has no “fieldSkill”'],
    [(b) => { b.party.companions.jev.id = 'judgebird'; }, 'party', 'content/party/companions/jev.json names another id'],
    [(b) => { b.party.companions.codex.version = 4; }, 'party', 'content/party/companions/codex.json isn’t version 1'],
    [(b) => { delete b.party.regulars.tricks; }, 'party', 'content/party/regulars.json has no “tricks”'],
    [(b) => { b.camp.talks['tollkeeper-riddles'] = null; }, 'party', 'content/camp/talks/tollkeeper-riddles.md can’t be read'],
    [(b) => { b.camp.talks['first-night'] = ' \n\n'; }, 'party', 'content/camp/talks/first-night.md is empty'],
    [(b) => { b.camp.talks.extra = 42; }, 'party', 'content/camp/talks/extra.md can’t be read'],
    [(b) => { delete b.examine.groups; }, 'world', 'content/examine.json has no “groups”'],
  ];
  for (const [change, area, message] of cases) {
    const result = phase4Problem(edit(full, change));
    assert.equal(result[area], message, message);
    assert.match(message, MESSAGE);
    assert.ok(!message.includes("'"), `${message}: curly apostrophes`);
    for (const other of Object.keys(result)) if (other !== area) assert.equal(result[other], null, `${message}: only ${area} switches off`);
  }
  const tuned = edit(full, (b) => { b.combat.tuning = { version: 1, integrityFactor: {}, xInt: {}, measured: '2026-10-01', fights: 200 }; });
  assert.equal(phase4Problem(tuned).combat, null, 'a written tuning.json is fine');
});

test('phase4Problem knows each file’s keys from §9, key for key, and every companion’s from §9.6', () => {
  assert.equal(SECTION_9['combat/rules.json'].length, 40);
  assert.equal(new Set(SECTION_9['combat/rules.json']).size, 40);
  assert.deepEqual(Object.keys(FILE_KEYS).sort(), Object.keys(SECTION_9).sort(), 'the same files');
  for (const [where, keys] of Object.entries(SECTION_9)) assert.deepEqual(FILE_KEYS[where], keys, where);
  assert.deepEqual(FILE_KEYS, SECTION_9);
  assert.deepEqual(COMPANION_KEYS, SECTION_9_6_COMPANION);
  assert.ok(Object.isFrozen(FILE_KEYS) && Object.isFrozen(COMPANION_KEYS));
});

test('phase4Problem switches off the file’s area for each key §9 names, missing or null, one at a time', () => {
  const full = wellFormed();
  let cases = 0;
  for (const [where, keys] of Object.entries(SECTION_9)) {
    const area = AREA_OF(where);
    for (const key of keys) {
      const message = `content/${where} has no “${key}”`;
      for (const change of [(file) => { delete file[key]; }, (file) => { file[key] = null; }]) {
        const result = phase4Problem(edit(full, (b) => {
          const [holder, name] = slot(b, where);
          // tuning.json may be absent, so it's written whole first, then broken.
          if (holder[name] === null) holder[name] = Object.fromEntries([['version', 1], ...keys.map((k) => [k, {}])]);
          change(holder[name]);
        }));
        assert.equal(result[area], message, message);
        for (const other of Object.keys(result)) if (other !== area) assert.equal(result[other], null, `${message}: only ${area} switches off`);
        cases += 1;
      }
    }
  }
  // Every key of every companion file, the ten data-only ones included.
  for (const id of REQUIRED_COMPANIONS) {
    for (const key of SECTION_9_6_COMPANION) {
      const message = `content/party/companions/${id}.json has no “${key}”`;
      for (const change of [(file) => { delete file[key]; }, (file) => { file[key] = null; }]) {
        const result = phase4Problem(edit(full, (b) => change(b.party.companions[id])));
        assert.equal(result.party, message, message);
        assert.deepEqual([result.groundwork, result.combat, result.world], [null, null, null], message);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 2 * (Object.values(SECTION_9).flat().length + REQUIRED_COMPANIONS.length * SECTION_9_6_COMPANION.length));
  // Keys §9 doesn't name aren't needed: a file with only version and its §9 keys passes.
  const bare = edit(full, (b) => {
    for (const where of Object.keys(SECTION_9)) {
      const [holder, name] = slot(b, where);
      if (holder[name]) delete holder[name].about;
    }
  });
  assert.deepEqual(phase4Problem(bare), { groundwork: null, combat: null, party: null, world: null });
});

test('phase4Problem needs §9.6’s fifteen companions, and a hostile bundle never throws', () => {
  // §9.6's fifteen files, named by §5.1's ids: Milo, the four who join in Phase 4 (party.js's
  // PHASE4_COMPANIONS, §7.5), then the data-only ten.
  assert.deepEqual(REQUIRED_COMPANIONS, [
    'milo', 'claude', 'codex', 'jev', 'tollkeeper',
    'rivet', 'pip', 'dusty', 'juno', 'mae', 'lumi', 'tova', 'nell', 'whisper', 'vesperine',
  ]);
  assert.deepEqual(REQUIRED_COMPANIONS.slice(0, 5), ['milo', 'claude', 'codex', 'jev', 'tollkeeper'], '§7.5’s PHASE4_COMPANIONS come first');
  assert.ok(Object.isFrozen(REQUIRED_COMPANIONS));
  const hostile = { get skills() { throw new Error('no'); }, combat: Object.create(null) };
  const result = phase4Problem(hostile);
  assert.equal(result.groundwork, 'the content');
  assert.equal(result.combat, 'content/combat/rules.json is missing');
  const polluted = JSON.parse('{"party":{"companions":{"__proto__":{"version":1}}}}');
  assert.match(phase4Problem(polluted).party, MESSAGE);
  assert.equal({}.version, undefined, 'nothing leaked onto Object.prototype');
});

test('phase4Problem passes the real content folder in all four areas', async () => {
  // Wave 1's content is all in, so this is the check that the shipped files and phase4Problem
  // agree: a content regression, or a check stricter than the real files, fails here rather than
  // quietly switching fights, groundwork or the world off in the app.
  const reports = [];
  const real = phase4Problem(await loadContent({ report: (m) => reports.push(m) }));
  assert.deepEqual(real, { groundwork: null, combat: null, party: null, world: null });
  assert.deepEqual(reports, [], 'and no file in it is unreadable');
});

test('the real content without milo.json switches the party area off, and only that area', async () => {
  const bundle = await loadContent();
  const before = phase4Problem(bundle);
  const companions = bundle.party?.companions;
  if (companions && typeof companions === 'object') delete companions.milo;
  const after = phase4Problem(bundle);
  assert.notEqual(after.party, null, 'no fight starts without Milo');
  const others = Object.keys(companions || {}).length;
  assert.equal(after.party, others ? 'content/party/companions/milo.json is missing' : 'content/party/companions/ is missing');
  for (const area of ['groundwork', 'combat', 'world']) assert.equal(after[area], before[area], `${area} is unchanged`);
});
