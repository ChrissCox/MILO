// Content tests: the wilds, the story and the Hearth read calmly, fit their shapes (CONTRACT-PHASE3.md §12)
// and point at real things (ANCHORS regions, riftgen temperaments, worldgen points of interest, satchel materials).
// Run: node --test tests/content.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ANCHORS, CHUNK, GATES, createWorldgen } from '../src/world/worldgen.js';
import { createRiftgen } from '../src/world/riftgen.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const wilds = read('wilds.json');
const story = read('story.json');
const fortress = read('fortress.json');
const words = read('riftgen.json');
const genres = read('genres.json');

const REGION_IDS = ANCHORS.filter((a) => a.id !== 'hearthvale').map((a) => a.id);
const REGION_NAME = Object.fromEntries(ANCHORS.map((a) => [a.id, a.name]));
const AUTHORS = ['Tamsin', 'Oriel', 'Brannoch', 'Pell', 'Milo'];
const TEMPERAMENTS = ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud'];
const MATERIALS = ['birch', 'ash', 'pine']; // state.satchel.materials in Phase 3
const COUNTABLE = ['crew-sessions-finished', 'buildings-designed', 'days-with-milo']; // CONTRACT-PHASE3.md §6
const POI_TYPES = ['lantern', 'ruin', 'cave', 'chest', 'note', 'hamlet', 'statue', 'landmark', 'quay', 'ore', 'herbs', 'fishing'];

// Words a region's lines should reach for, so a regional note or Glimmer is really about its place (LORE.md §8).
const REGION_WORDS = {
  whisperwood: ['Whisperwood', 'Last Bridge', 'Murmur', 'owl', 'pine'],
  mistmere: ['Mistmere', 'harbour', 'quay', 'Tide', 'chapel'],
  'painted-hills': ['Painted', 'Easelmoor', 'paint', 'madder', 'brush'],
  'ivory-college': ['College', 'Examination', 'cloister', 'lend'],
  'dicing-downs': ['Downs', 'dice', 'bones'],
  cinderforge: ['Cinderforge', 'ravine', 'forge', 'hammer', 'Cinderfolk'],
  'glass-fen': ['Fen', 'pool', 'reflection'],
  'archive-peaks': ['Stacks', 'Peaks', 'shelves', 'catalogue'],
  greyreach: ['Greyreach', 'someday', 'half done'],
  'skyward-isles': ['kite', 'Kiteworks', 'Isles', 'clouds'],
  'far-shore': ['Far Shore', 'Lighthouse', 'long grass', 'Sloe'],
};

// Words allowed a capital mid-sentence: the crew, MILO, and names from LORE.md, RIFTS.md and WORLD.md.
const PROPER = new Set([
  'Claude', 'Code', 'Codex', 'Milo', 'MILO', 'Chris', 'PC', 'I', 'I’m', 'I’ve', 'I’ll', 'I’d',
  // the Old Company and friends
  'Tamsin', 'Wick', 'Oriel', 'Brannoch', 'Deepcoal', 'Pell', 'Marrow', 'Sister', 'Nan', 'Bristle', 'Hob', 'Sloe', 'Captain', 'Mags', 'Quire', 'Bindery', 'Tollkeeper', 'Riddle', 'Notes', 'Act',
  // places and things
  'Hearthvale', 'Whisperwood', 'Mistmere', 'Harbor', 'Painted', 'Hills', 'Ivory', 'College', 'Dicing', 'Downs', 'Cinderforge',
  'Glass', 'Fen', 'Archive', 'Peaks', 'Greyreach', 'Skyward', 'Isles', 'Far', 'Shore', 'Stacks', 'Westwatch', 'Great',
  'Lighthouse', 'Lantern', 'Hook', 'Tide', 'Clock', 'Market', 'Last', 'Bridge', 'Murmur', 'Easelmoor', 'Kiteworks',
  'Examination', 'Tower', 'Tidebook', 'Small', 'Spell', 'Hush', 'Old', 'Company', 'Maker', 'Makers', 'Cinderfolk',
  'Wayfarers', 'Glimmers', 'Stockade', 'Hearth', 'Hearthward', 'Notice', 'Board', 'Adventurer', 'Kit', 'Act', 'VI',
  'Construction', 'Phase', 'Nocturne', 'Titan', 'Elsewhere', 'Bindery', 'Quiet', 'Order', 'Syndics', 'Kingdom', 'Spire',
  'War', 'Table', 'Gate', 'Bell', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Stillday', 'Hold', 'Hangar', 'Observatory', 'Chronicle',
  'Titans', 'Beginner', 'Margin', 'IV', 'VII', 'Prologue', 'WORLD.md', 'LORE.md', 'D', // a low D: a Brannoch bridge
]);

const SENTENCE_END = /[.?…]$/;

/** Sentences in the narration, with each piece of quoted speech counted as part of the sentence around it. */
const sentences = (text) => {
  const narration = text.replace(/“[^”]*”/g, (m) => (/[.?…]”$/.test(m) ? 'x.' : 'x'));
  return (narration.match(/[.?…](?=\s|$)/g) || []).length;
};

/**
 * Calm copy (as tests/core.test.js): no exclamation marks, no please/successfully, no emoji, curly quotes
 * and apostrophes only, a capital first letter and sentence case. Content is prose, so a new sentence
 * (after . ? … or a sign-off dash) may start with a capital; any other capital must be a known name.
 */
function assertCalm(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.equal(text, text.trim(), `${where} has no stray spaces at the ends`);
  assert.ok(!/ {2}/.test(text), `${where} has no doubled spaces: ${text}`);
  assert.ok(!text.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji: ${text}`);
  assert.ok(!text.includes('"'), `${where} uses curly quotes only: ${text}`);
  assert.ok(!text.includes('\''), `${where} uses curly apostrophes only: ${text}`);
  const firstLetter = text.match(/\p{L}/u);
  if (firstLetter) assert.equal(firstLetter[0], firstLetter[0].toUpperCase(), `${where} starts with a capital: ${text}`);
  // Quoted speech keeps its own casing; a quote that ends a sentence ends the sentence around it too.
  const quoted = (m) => (/[.?…][”’]$/.test(m) ? 'x.' : 'x');
  const unquoted = text
    .replace(/“[^”]*”/g, quoted)
    .replace(/‘[^‘]*?’(?!\p{L})/gu, quoted);
  const tokens = unquoted.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    const before = tokens[i - 1].replace(/[)”’]+$/, '');
    if (SENTENCE_END.test(before) || /^[—–]$/.test(before)) continue;
    const word = tokens[i].replace(/^[^\p{L}]+|[^\p{L}’]+$/gu, '');
    if (!word) continue;
    const base = word.replace(/’s$/, '').replace(/s’$/, 's');
    if (PROPER.has(word) || PROPER.has(base)) continue;
    assert.ok(word[0] === word[0].toLowerCase(), `${where} is sentence case, “${word}” in: ${text}`);
  }
}

/** A proper name or a chapter title ("The Stockade", "A Light on the Hook"): title case allowed, still calm. */
function assertTitle(text, where = '') {
  assert.match(text, /^\p{Lu}/u, `${where} starts with a capital`);
  assert.ok(text.length <= 40, `${where} is short: ${text}`);
  assert.ok(!/[!"'.]/.test(text), `${where} is calm, curly and has no full stop: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji`);
}

/** A fragment that finishes someone else's sentence ("It's missing …"): calm, lowercase, no full stop. */
function assertFragment(text, where = '') {
  assertCalm(`It’s missing ${text}.`, where);
  assert.equal(text[0], text[0].toLowerCase(), `${where} starts lowercase: ${text}`);
  assert.ok(!/[.?…]$/.test(text), `${where} has no full stop: ${text}`);
}

/** Every string inside a value, with a path for messages. */
function* strings(value, path = '') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k);
}

const lines = (list, where, { min = 3, max = 140 } = {}) => {
  assert.ok(Array.isArray(list), `${where} is a list`);
  assert.ok(list.length >= min, `${where} has at least ${min} lines (${list.length})`);
  list.forEach((line, i) => {
    assertCalm(line, `${where}[${i}]`);
    assert.ok(line.length <= max, `${where}[${i}] is at most ${max} chars (${line.length}): ${line}`);
  });
};

const mentions = (text, regionId) => REGION_WORDS[regionId].some((w) => text.toLowerCase().includes(w.toLowerCase()));

/* --- wilds.json */

test('wilds.json: every examine line the wilds need, three or more of each, one good line apiece', () => {
  assert.equal(wilds.version, 1);
  const flat = ['ruin', 'ruinSearched', 'cave', 'chest', 'chestOpened', 'hamlet', 'ore', 'herbs', 'fishing', 'quay', 'landmark',
    'thicket', 'palisade', 'gate', 'crag', 'tree', 'stump', 'note', 'statue'];
  assert.deepEqual(Object.keys(wilds.examine).sort(), [...flat, 'lantern', 'westwatch'].sort());
  for (const key of flat) lines(wilds.examine[key], `examine.${key}`, { max: 120 });
  assert.deepEqual(Object.keys(wilds.examine.lantern).sort(), ['lit', 'sleeping']);
  lines(wilds.examine.lantern.sleeping, 'examine.lantern.sleeping', { max: 120 });
  lines(wilds.examine.lantern.lit, 'examine.lantern.lit', { max: 120 });
  assert.deepEqual(Object.keys(wilds.examine.westwatch).sort(), ['day', 'night']);
  lines(wilds.examine.westwatch.day, 'examine.westwatch.day', { max: 120 });
  lines(wilds.examine.westwatch.night, 'examine.westwatch.night', { max: 120 });
  // The Great Lighthouse only shows at night.
  assert.ok(wilds.examine.westwatch.night.every((l) => /light/i.test(l)), 'every night line sees the light');
  assert.ok(!wilds.examine.westwatch.day.some((l) => /Lighthouse/.test(l)), 'no day line sees the Lighthouse');
  // The Stockade is birch and ash (WORLD.md §2), and a felled tree comes back the next day.
  assert.ok(wilds.examine.palisade.some((l) => /birch/i.test(l) && /ash/i.test(l)));
  assert.ok(wilds.examine.tree.some((l) => /tomorrow/.test(l)) && wilds.examine.stump.some((l) => /tomorrow/.test(l)));
  // Tree lines are picked by id whatever the tree is, so none of them names a kind of tree.
  for (const line of wilds.examine.tree) assert.ok(!/\b(birch|ash|pine|oak)\b/i.test(line), `tree line fits any tree: ${line}`);
  // A lit lantern promises only what resting there does now: it's the first lantern on Milo's
  // travel list, right after home. Nothing about waking there (there's no fainting yet).
  for (const line of [...wilds.examine.lantern.lit, ...wilds.examine.lantern.sleeping]) {
    assert.ok(!/\bwak(e|ing)\b|\bfaint/i.test(line), `a lantern promises nothing that isn’t there: ${line}`);
    if (/travel list/.test(line)) assert.match(line, /after home/, `home comes first on the travel list: ${line}`);
  }
  assert.ok(wilds.examine.lantern.lit.some((line) => /rest/i.test(line) && /travel list/.test(line)), 'one lit line says what resting does');
});

test('wilds.json: every point of interest worldgen can make has something to say', () => {
  for (const type of POI_TYPES) assert.ok(wilds.examine[type], `examine.${type}`);
  // Scan the real world around the vale and along the roads, so a new POI type can't go unexamined.
  const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const seen = new Map();
  const chunks = new Set();
  for (let cx = -6; cx <= 6; cx += 1) for (let cy = -6; cy <= 6; cy += 1) chunks.add(`${cx},${cy}`);
  for (const key of world.roads().tiles) {
    const [x, y] = key.split(',').map(Number);
    chunks.add(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
  }
  for (const key of chunks) {
    const [cx, cy] = key.split(',').map(Number);
    for (const poi of world.chunk(cx, cy).pois) seen.set(poi.type, poi);
  }
  for (const poi of world.fixedPois()) seen.set(poi.type, poi);
  for (const type of seen.keys()) assert.ok(POI_TYPES.includes(type) && wilds.examine[type], `worldgen's ${type} has examine lines`);
  assert.ok(seen.size >= 10, `a good spread of POIs was seen (${[...seen.keys()]})`);
  // Every fixed statue and landmark points at a region with its lines, and the Westwatch has its own.
  for (const poi of world.fixedPois()) {
    if (poi.type === 'statue') assert.ok(wilds.statues[poi.region], `statue in ${poi.region}`);
    if (poi.type === 'landmark' && poi.region) assert.ok(wilds.regions[poi.region], `landmark in ${poi.region}`);
    if (poi.type === 'landmark' && !poi.region) assert.equal(poi.name, 'The Westwatch');
    if (poi.type === 'quay') assert.equal(poi.region, 'mistmere');
  }
});

test('notes from the Old Company: at least 24, short, from the five, signed by their writers, about a third regional', () => {
  const { notes } = wilds;
  assert.ok(notes.length >= 24, `${notes.length} notes`);
  const ids = new Set();
  notes.forEach((note, i) => {
    const where = note.id || `notes[${i}]`;
    assert.deepEqual(Object.keys(note).sort(), ['from', 'id', 'region', 'text'], where);
    assert.equal(note.id, `note-${String(i + 1).padStart(2, '0')}`, 'ids run in order');
    assert.ok(!ids.has(note.id), `${where} is unique`);
    ids.add(note.id);
    assert.ok(AUTHORS.includes(note.from), `${where} from ${note.from}`);
    assert.ok(note.region === null || REGION_IDS.includes(note.region), `${where} region ${note.region} is an anchor`);
    assertCalm(note.text, where);
    assert.ok(note.text.length <= 280, `${where} is at most 280 chars (${note.text.length})`);
    // Signed like a real letter, by the one who wrote it.
    const initial = note.from[0];
    const sign = note.text.match(/— ([^—]+)$/);
    assert.ok(sign, `${where} is signed: ${note.text}`);
    const name = sign[1];
    assert.ok(name === `${initial}.` || name.startsWith(note.from) || name.includes(` ${note.from}`)
      || (note.from === 'Brannoch' && name === 'B.D.'), `${where} is signed by ${note.from}: ${name}`);
    if (note.region) assert.ok(mentions(note.text, note.region), `${where} is really about ${note.region}: ${note.text}`);
    // Pell's Tidebook is Act II's collection quest, twelve pages along the coast (LORE.md §14), so no road note is one.
    assert.ok(!/Tidebook/.test(note.text) || !/\bpage\b/i.test(note.text), `${where} isn’t a Tidebook page: ${note.text}`);
  });
  for (const author of AUTHORS) {
    const count = notes.filter((n) => n.from === author).length;
    assert.ok(count >= 4, `${author} wrote ${count}`);
  }
  const regional = notes.filter((n) => n.region);
  const share = regional.length / notes.length;
  assert.ok(share >= 0.25 && share <= 0.45, `about a third are regional (${regional.length} of ${notes.length})`);
  assert.ok(new Set(regional.map((n) => n.region)).size >= 8, 'regional notes are spread across the regions');
  // Never generic: nearly every note names someone or somewhere from the lore beyond its own signature.
  const lore = /Tamsin|Oriel|Brannoch|Pell|Milo|Company|Stacks|Whisperwood|Downs|Lighthouse|Hearthvale|Hush|Fen|College|Tidebook|Last Bridge|Greyreach|Easelmoor|ravine|kite|harbour|Spell|wick|scarf/;
  const unnamed = notes.filter((n) => !lore.test(n.text.replace(/— [^—]+$/, '')));
  assert.deepEqual(unnamed.map((n) => n.id), [], 'every note names someone, somewhere or something from the lore, beyond its signature');
});

test('every region has an arrival line, a Hush line and an unfinished statue with its Glimmer', () => {
  assert.deepEqual(Object.keys(wilds.regions).sort(), [...REGION_IDS].sort());
  assert.deepEqual(Object.keys(wilds.statues).sort(), [...REGION_IDS].sort());
  assert.equal(REGION_IDS.length, 11);
  for (const id of REGION_IDS) {
    const { arrive, hush } = wilds.regions[id];
    assert.deepEqual(Object.keys(wilds.regions[id]).sort(), ['arrive', 'hush']);
    assertCalm(arrive, `${id}.arrive`);
    assertCalm(hush, `${id}.hush`);
    assert.ok(arrive.length <= 120, `${id}.arrive ≤ 120 (${arrive.length})`);
    assert.ok(hush.length <= 120, `${id}.hush ≤ 120 (${hush.length})`);
    assert.ok(arrive.includes(REGION_NAME[id].replace(/^The /, '')), `${id} arrival names ${REGION_NAME[id]}`);
    assert.ok(hush.includes('Hush'), `${id} waits in the Hush`);
    assert.ok(/\b(in time|wake|when it’s ready|comes|again)\b/.test(hush), `${id} will wake in time: ${hush}`);
    assert.ok(!/forever|never (wake|come back|return)|lost for good|gone for good|dead|dying/.test(hush), `${id} Hush line is gentle: ${hush}`);
  }
  const missing = new Set(['her left hand']); // Hearthvale's own statue (LORE.md §8.1)
  for (const id of REGION_IDS) {
    const statue = wilds.statues[id];
    assert.deepEqual(Object.keys(statue).sort(), ['glimmer', 'missing']);
    assertFragment(statue.missing, `${id}.missing`);
    assert.ok(statue.missing.length <= 60, `${id}.missing is short`);
    assert.ok(/^(her|the|everything)\b/.test(statue.missing), `${id} names a piece of Tamsin: ${statue.missing}`);
    assert.ok(!missing.has(statue.missing), `${id} is missing something different: ${statue.missing}`);
    missing.add(statue.missing);
    assertCalm(statue.glimmer, `${id}.glimmer`);
    assert.ok(statue.glimmer.length <= 220, `${id}.glimmer ≤ 220 (${statue.glimmer.length})`);
    assert.ok(/Tamsin/.test(statue.glimmer), `${id} Glimmer remembers Tamsin`);
    assert.ok(mentions(statue.glimmer, id), `${id} Glimmer happened there: ${statue.glimmer}`);
    // A Glimmer rises where something happened (LORE.md §1); the vale's own moments belong to its own statue.
    assert.ok(!/Hearthvale|Lantern Hook|on the hook/i.test(statue.glimmer), `${id} Glimmer isn’t set in the vale: ${statue.glimmer}`);
  }
  // The Painted Hills statue holds a brush with no bristles (LORE.md §8.4).
  assert.match(wilds.statues['painted-hills'].missing, /bristles/);
});

test('strays speak for all nine temperaments riftgen gives them, as lost travellers from other books', () => {
  assert.deepEqual(Object.keys(wilds.strays).sort(), [...TEMPERAMENTS].sort());
  for (const t of TEMPERAMENTS) lines(wilds.strays[t], `strays.${t}`, { max: 100 });
  // Whatever riftgen composes, its stray has lines.
  const riftgen = createRiftgen({ words, genres });
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed += 1) {
    const spec = riftgen.wildRift({ seed, tier: 1 + (seed % 8), depth: 1 });
    for (const stray of spec.strays) seen.add(stray.temperament);
  }
  for (const t of seen) assert.ok(wilds.strays[t], `riftgen temperament ${t} has lines`);
  assert.deepEqual([...seen].sort(), [...TEMPERAMENTS].sort(), 'riftgen uses exactly these nine');
  // Lost rather than wicked: they talk about their own story, never threaten.
  const all = TEMPERAMENTS.flatMap((t) => wilds.strays[t]);
  assert.ok(all.filter((l) => /book|chapter|page|story|seam|thread|binding|volume|cover/.test(l)).length >= 12, 'strays talk about their books');
  for (const line of all) assert.ok(!/\b(kill|destroy|devour|blood|die|hate|fear)\b/i.test(line), `cosy, not scary: ${line}`);
});

test('hamlets greet you, mimics are friendly, chopping has its lines, and the later features say when', () => {
  lines(wilds.hamlets.greetings, 'hamlets.greetings', { max: 120 });
  lines(wilds.mimic, 'mimic', { max: 120 });
  assert.deepEqual(Object.keys(wilds.chop).sort(), [...MATERIALS].sort());
  for (const kind of MATERIALS) lines(wilds.chop[kind], `chop.${kind}`, { max: 100 });
  assert.deepEqual(Object.keys(wilds.notes_later).sort(), ['cave', 'ferry', 'gathering']);
  for (const [key, text] of Object.entries(wilds.notes_later)) {
    assertCalm(text, `notes_later.${key}`);
    assert.ok(text.length <= 120, `notes_later.${key} is short`);
  }
  // Caves open in Phase 4 (CONTRACT-PHASE4.md §9.12): the cave note no longer promises the Kit.
  assert.match(wilds.notes_later.cave, /\bopen\b/);
  assert.doesNotMatch(wilds.notes_later.cave, /Adventurer’s Kit/);
  assert.match(wilds.notes_later.gathering, /Notice Board/);
  assert.match(wilds.notes_later.ferry, /Act VI/);
});

test('loot ranges are inclusive integers over the satchel’s materials, as §12 sets them', () => {
  assert.deepEqual(wilds.loot, {
    chest: { birch: [8, 20], ash: [3, 10], pine: [0, 6] },
    ruin: { birch: [0, 10], ash: [4, 12], pine: [0, 4] },
    tabletChance: 0.25,
    mimicChance: 0.12,
  });
  for (const source of ['chest', 'ruin']) {
    const table = wilds.loot[source];
    for (const [material, range] of Object.entries(table)) {
      assert.ok(MATERIALS.includes(material), `${source}.${material} is a satchel material`);
      assert.ok(Array.isArray(range) && range.length === 2, `${source}.${material} is [min, max]`);
      const [min, max] = range;
      assert.ok(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && min <= max, `${source}.${material} ${range}`);
    }
    assert.ok(Object.values(table).some(([, max]) => max > 0), `${source} gives something`);
  }
  for (const key of ['tabletChance', 'mimicChance']) assert.ok(wilds.loot[key] > 0 && wilds.loot[key] < 1, key);
});

test('no line is said twice, across the wilds and the story', () => {
  const said = new Map();
  const skip = /(^|\.)(id|from|region|version)$|^about$/;
  for (const [file, value] of [['wilds', wilds], ['story', story]]) {
    for (const [path, text] of strings(value)) {
      // The Prologue's step "A Letter by Paper Bird" and the letter it brings share their name, as §6 and §12 have it.
      if (skip.test(path) || /^prologue\.(id|title)$|\.id$|^letters\.\w+\.title$/.test(path)) continue;
      const key = text.toLowerCase();
      assert.ok(!said.has(key), `“${text}” appears at ${said.get(key)} and ${file}.${path}`);
      said.set(key, `${file}.${path}`);
    }
  }
  assert.ok(said.size > 200, `${said.size} lines`);
});

test('every word of the wilds and the story is calm copy with curly quotes', () => {
  let checked = 0;
  for (const [file, value] of [['wilds', wilds], ['story', story]]) {
    for (const [path, text] of strings(value)) {
      if (/(^|\.)(id|region)$/.test(path)) {
        assert.match(text, /^[a-z0-9-]+$/, `${file}.${path} is an id`);
        continue;
      }
      if (/\.from$/.test(path)) continue;
      if (/^prologue\.(title|steps\[\d+\]\.title)$/.test(path) || /^act1\.(title|chapters\[\d+\]\.title)$/.test(path)) assertTitle(text, `${file}.${path}`);
      else if (/\.missing$/.test(path)) assertFragment(text, `${file}.${path}`);
      else if (/\.sign$/.test(path)) assert.match(text, /^— \p{Lu}\.$/u, `${file}.${path}`);
      else assertCalm(text, `${file}.${path}`);
      checked += 1;
    }
  }
  assert.ok(checked > 220, `${checked} strings checked`);
});

/* --- story.json */

test('the Prologue is the seven steps of §6, in order, told in the story voice with a plain hint', () => {
  assert.equal(story.version, 1);
  assert.equal(story.prologue.id, 'prologue');
  assert.equal(story.prologue.title, 'The Lantern Wakes');
  const expected = [
    ['light', 'A Light on the Hook'],
    ['crew', 'Three Stumps and a Bench'],
    ['ground', 'Ground That’s Waiting'],
    ['letter', 'A Letter by Paper Bird'],
    ['first-crack', 'A Crack Past the Gate'],
    ['lantern', 'A Light in the Wilds'],
    ['stockade', 'Walls of Birch and Ash'],
  ];
  assert.deepEqual(story.prologue.steps.map((s) => [s.id, s.title]), expected);
  for (const step of story.prologue.steps) {
    // Conditions live in code, keyed by id; content only tells the story.
    assert.deepEqual(Object.keys(step).sort(), ['hint', 'id', 'text', 'title'], step.id);
    assertCalm(step.text, `${step.id}.text`);
    assertCalm(step.hint, `${step.id}.hint`);
    assert.ok(step.hint.length <= 90, `${step.id}.hint ≤ 90 (${step.hint.length})`);
    // §12: "one or two sentences in the story voice", so a short card, not a scene.
    const count = sentences(step.text);
    assert.ok(count >= 1 && count <= 2, `${step.id}.text is one or two sentences (${count}): ${step.text}`);
    assert.ok(step.text.length <= 200, `${step.id}.text is short (${step.text.length})`);
    assert.ok(!/focus|timer|kindle/i.test(step.text + step.hint), `${step.id}: no focus timer yet`);
  }
  const step = Object.fromEntries(story.prologue.steps.map((s) => [s.id, s]));
  assert.match(step['first-crack'].text, /north gate/);
  assert.match(step['first-crack'].text, /can’t come in/, 'the vale is sanctuary');
  assert.match(step['first-crack'].hint, /north gate/);
  assert.match(step.letter.hint, /Oriel’s letter/);
  assert.match(step.stockade.hint, /birch and ash/);
  assert.match(step.lantern.hint, /lantern/);
});

test('Oriel’s letter comes by paper bird and builds to tea', () => {
  assert.deepEqual(Object.keys(story.letters), ['oriel']);
  const letter = story.letters.oriel;
  assert.deepEqual(Object.keys(letter).sort(), ['from', 'lines', 'sign', 'title']);
  assert.equal(letter.from, 'Oriel');
  assert.equal(letter.title, 'A letter by paper bird');
  assert.equal(letter.sign, '— O.');
  assert.equal(letter.lines[0], 'You’re awake. Good.');
  assert.equal(letter.lines.at(-1), 'Tea soon.');
  assert.ok(letter.lines.length >= 4 && letter.lines.length <= 9, `${letter.lines.length} lines`);
  letter.lines.forEach((line, i) => {
    assertCalm(line, `letter[${i}]`);
    assert.ok(line.length <= 280, `letter[${i}] ≤ 280`);
  });
  const body = letter.lines.join(' ');
  assert.ok(body.length <= 1400, `a letter, not a book (${body.length})`);
  assert.match(body, /Milo/, 'she writes to Milo');
  assert.match(body, /Tamsin/, 'and remembers Tamsin');
});

/* --- fortress.json */

test('the Stockade costs birch and ash from the wilds, needs only what MILO can count, and its ward-post is §5’s', () => {
  // Construction has no source until Phase 5, so it isn't asked for yet (CONTRACT-PHASE4.md §3.2).
  assert.equal(fortress.constructionFrom, 'Phase 5');
  const [camp, stockade] = fortress.tiers;
  assert.equal(camp.id, 'camp');
  assert.deepEqual(camp.materials, {});
  assert.equal(stockade.id, 'stockade');
  assert.equal(stockade.tier, 2);
  assert.deepEqual(stockade.materials, { birch: 80, ash: 30 });
  for (const material of Object.keys(stockade.materials)) assert.ok(MATERIALS.includes(material), `${material} can be gathered in Phase 3`);
  assert.deepEqual(stockade.requirements.map((r) => r.kind).sort(), [...COUNTABLE].sort(), 'every Stockade need is a real count');
  const names = stockade.defences.map((d) => d.name);
  assert.deepEqual(names, ['The War Table', 'The Gate Bell', 'The first ward-post']);
  const post = stockade.defences.find((d) => d.name === 'The first ward-post').real;
  assert.match(post, /^One rule you choose, and can take down again: /);
  assert.ok(!/auto-ward/.test(post), 'no inside words');
  // The rule names are the ones the War Table's chooser shows (src/rifts.js WARD_POST_RULES), in sentence case.
  assert.match(post, /weekend nights off/);
  assert.match(post, /Friday and Saturday/);
  assert.match(post, /Nocturne/);
  assert.match(post, /a patient knock/);
  assert.match(post, /48 hours/);
  assert.match(post, /room to run/);
  assert.match(post, /95%/);
  assert.ok(!/someday/.test(post), 'no quests yet: the old someday rule is gone');
  // Birch and ash are a few afternoons in the wilds, not a grind (chop yields from §8: birch 4–7, ash 3–5).
  const chops = stockade.materials.birch / 5.5 + stockade.materials.ash / 4;
  assert.ok(chops >= 10 && chops <= 40, `about ${Math.round(chops)} trees`);
  const chest = wilds.loot.chest;
  const chests = stockade.materials.birch / ((chest.birch[0] + chest.birch[1]) / 2);
  assert.ok(chests >= 3, `chests help but don't hand it over (${chests.toFixed(1)} chests of birch)`);
});

test('the Stockade’s look is what the wilds raise: a gatehouse at each gate, and the bell and banners by the north gate', async () => {
  const { createWilds } = await import('../src/world/wilds.js');
  const stockade = fortress.tiers.find((t) => t.id === 'stockade');
  const ring = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: words.regionWords }), maxChunks: 16 }).ringObjects(2);
  assert.equal(ring.filter((o) => o.kind === 'gatehouse').length, Object.keys(GATES).length, 'a gatehouse at every gate');
  const banners = ring.filter((o) => o.kind === 'banner');
  const bell = ring.find((o) => o.kind === 'gate.bell');
  assert.ok(banners.length >= 1 && bell, 'the Stockade raises banners and the Gate Bell');
  for (const o of [...banners, bell]) assert.equal(o.place, 'gate:n', `${o.id} stands by the north gate`);
  assert.match(stockade.look, /a gatehouse at each gate/);
  assert.match(stockade.look, /bell and banners by the north gate/);
  assert.doesNotMatch(stockade.look, /watchtower/i, 'no banners fly on the watchtower');
});

test('fortress.json reads as calm copy with curly apostrophes', () => {
  let checked = 0;
  for (const [path, text] of strings(fortress)) {
    if (/(^|\.)(id|kind)$/.test(path) || path === 'constructionFrom') continue;
    // Tier and defence names are proper names ("The Stockade", "The Gate Bell"), so they keep their capitals.
    if (/\.name$/.test(path)) {
      assertTitle(text, `fortress.${path}`);
      continue;
    }
    assertCalm(text, `fortress.${path}`);
    assert.ok(!/auto-ward/.test(text), `fortress.${path} says what a rule does, not what MILO calls it inside: ${text}`);
    checked += 1;
  }
  assert.ok(checked > 60, `${checked} strings checked`);
});

test('the ward-post rules in src/rifts.js are the five the Stockade and the Hold describe, by the same names', async () => {
  const { WARD_POST_RULES } = await import('../src/rifts.js');
  assert.ok(Array.isArray(WARD_POST_RULES), 'src/rifts.js exports WARD_POST_RULES');
  assert.deepEqual(WARD_POST_RULES.map((r) => r.id).sort(), ['capacity-95', 'crowd-monday', 'nights-off', 'patient-knock', 'stillday-nights']);
  const post = fortress.tiers[1].defences.find((d) => d.name === 'The first ward-post').real;
  const towers = fortress.tiers[2].defences.find((d) => d.name === 'Ward-towers').real;
  // The Hearth's defence text and the War Table's chooser call each rule by one name: the Stockade's three, then the Hold's two.
  for (const rule of WARD_POST_RULES) {
    const text = ['stillday-nights', 'crowd-monday'].includes(rule.id) ? towers : post;
    const name = String(rule.name);
    assert.ok(text.includes(name[0].toLowerCase() + name.slice(1)), `the Hearth names “${name}”: ${text}`);
  }
});

/* --- riftgen.json */

test('riftgen.json: curly apostrophes throughout, and a number or a time said once per line', () => {
  let checked = 0;
  for (const [path, text] of strings(words)) {
    assert.ok(!/["']/.test(text), `riftgen.${path} uses curly quotes and apostrophes: ${text}`);
    // fill() rolls each {num} and {time} afresh, so a joke that says one twice comes out as two.
    for (const token of ['{num}', '{time}']) assert.ok(text.split(token).length <= 2, `riftgen.${path} says ${token} once: ${text}`);
    checked += 1;
  }
  assert.ok(checked > 500, `${checked} strings`);
});

test('riftgen.json: no name or Tale-lead doubles a word, stacks two articles or says “A” before a vowel', () => {
  const STOP = new Set(['the', 'of', 'and', 'at', 'on', 'for', 'in', 'a', 'an', 'to', 'with', 'no']);
  const subject = '“Untitled session”';
  const slot = (g, token) => ({
    adj: g.adjectives, noun: g.nouns, place: g.places, name: g.names ?? ['Gorath'], title: g.titles, num: ['7'], time: ['3:07'], subject: [subject],
  }[token] ?? [`{${token}}`]);
  // Every way a pattern can fill in (a place can hold a {num} of its own).
  const expand = (pattern, g) => {
    let outs = [''];
    for (const part of pattern.split(/(\{\w+\})/)) {
      const m = /^\{(\w+)\}$/.exec(part);
      const options = m ? slot(g, m[1]).flatMap((value) => expand(value, g)) : [part];
      outs = outs.flatMap((o) => options.map((v) => o + v));
    }
    return outs;
  };
  const faults = (name) => {
    const out = [];
    const bare = name.replace(subject, 'X');
    const tokens = bare.toLowerCase().split(/[\s,:;.?]+/).filter(Boolean);
    for (let i = 1; i < tokens.length; i += 1) if (tokens[i] === tokens[i - 1]) out.push(`“${tokens[i]}” twice in a row`);
    const content = bare.toLowerCase().split(/[^\p{L}’]+/u).filter((w) => w.length > 2 && !STOP.has(w));
    const twice = content.find((w, i) => content.indexOf(w) !== i);
    if (twice) out.push(`“${twice}” twice`);
    if (/^The \S+ the\b/.test(bare) || /\bthe the\b/i.test(bare)) out.push('two articles');
    if (/\bA [AEIOU]/.test(bare)) out.push('“A” before a vowel');
    if ((bare.match(/ of /g) || []).length > 1) out.push('“of” twice');
    return out;
  };
  let checked = 0;
  const bad = [];
  for (const [id, g] of Object.entries(words.genres)) {
    for (const list of ['patterns', 'patternsReal', 'bossPatterns']) {
      for (const pattern of g[list] ?? []) {
        for (const name of expand(pattern, g)) {
          checked += 1;
          const found = faults(name);
          if (found.length) bad.push(`${id} ${list}: ${name} (${found.join(', ')})`);
        }
      }
    }
  }
  // Two-genre names are "The {adjective of one} {noun of the other}".
  for (const [a, ga] of Object.entries(words.genres)) {
    for (const [b, gb] of Object.entries(words.genres)) {
      if (a === b) continue;
      for (const adj of ga.adjectives) for (const noun of gb.nouns) {
        checked += 1;
        const found = faults(`The ${adj} ${noun}`);
        if (found.length) bad.push(`${a}+${b}: The ${adj} ${noun} (${found.join(', ')})`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} of ${checked} names read wrong`);
  // Three-genre names take an adjective from each genre, so no two genres share one.
  const owner = new Map();
  for (const [id, g] of Object.entries(words.genres)) {
    for (const adj of g.adjectives) {
      assert.ok(!owner.has(adj.toLowerCase()), `“${adj}” is an adjective of both ${owner.get(adj.toLowerCase())} and ${id}`);
      owner.set(adj.toLowerCase(), id);
    }
  }
  assert.ok(checked > 20000, `${checked} names`);
  // The one from the review: an Elsewhere banner read "Inside The Hollow Beyond Beyond Past the Stars".
  const riftgen = createRiftgen({ words, genres });
  const ids = Object.keys(words.genres);
  for (let seed = 1; seed <= 400; seed += 1) {
    const spec = riftgen.wildRift({ seed, tier: 1 + (seed % 5), weights: Object.fromEntries(ids.map((id) => [id, id === 'void' ? 1000 : 0.001])) });
    assert.deepEqual(faults(spec.name), [], spec.name);
    if (spec.taleLead?.name) assert.deepEqual(faults(spec.taleLead.name), [], spec.taleLead.name);
  }
});
