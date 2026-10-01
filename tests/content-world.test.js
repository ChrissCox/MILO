// World content (module E): content/examine.json, content/trails.json, the cave note in wilds.json,
// fortress.json's constructionFrom, and wildtext's cave action (CONTRACT-PHASE4.md §3.1, §7.7, §9.12).
// Run: node --test tests/content-world.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { assertCalm, assertTitle, assertOwnWords, assertCosy, lines, strings, loreIndex, normaliseName } from './calm.js';
import { ARCHETYPES } from '../src/world/straygen.js';
import { PLACES } from '../src/world/map.js';
import { poiView } from '../src/ui/wildtext.js';
import { STEP_KINDS, FEATURES, READ_TARGETS, LAST_BRIDGE_ID, solveKnown } from '../src/world/trail.js';
import { CAVE_CREATURES } from '../src/world/caves.js';

const url = (name) => new URL(`../content/${name}`, import.meta.url);
const read = (name) => JSON.parse(readFileSync(url(name), 'utf8'));
const maybe = (name) => (existsSync(url(name)) ? read(name) : null);
const examine = read('examine.json');
const trails = read('trails.json');
const wilds = read('wilds.json');
const story = read('story.json');
const fortress = read('fortress.json');

// Names these files use that LORE.md §21 doesn't have yet (§16.3): wave 4 adds them to the index.
// "Hushlands" is the world itself (LORE.md's title), which the index never lists by name.
// "Ollama" is the hearth-sprite crew member's name (LORE.md §5 names it, but not in §21).
const PENDING_NAMES = ['Hushlands', 'Ollama'];

const GROUPS = ['vale', 'camp', 'company', 'creatures', 'foes', 'elsewhere', 'wilds', 'sky', 'things'];
const VARIANTS = ['day', 'night', 'dawn', 'dusk', 'lit', 'sleeping', 'opened', 'read', 'rain', 'snow', 'spring', 'summer', 'autumn', 'winter'];
// Things there's only one of may have a single line (§9.12).
const UNIQUE = new Set(['things.hooklight']);
const HOOKLIGHT = 'Lit from the Hook. The big one stays home, so home stays safe.';
// The weather kinds the sky can show (§7.6's Sky).
const WEATHER = ['clear', 'rain', 'snow', 'mist', 'wind', 'leaves'];
// The sky's Examine variant is the daypart, never the season (§9.12's "season or daypart", settled
// for K1's examineKey): A's sky.js DAYPARTS once it's there.
const SKY_FILE = new URL('../src/sky.js', import.meta.url);
const DAYPARTS = existsSync(SKY_FILE) ? [...(await import('../src/sky.js')).DAYPARTS] : ['dawn', 'day', 'dusk', 'night'];
// The canon foes of COMBAT §8.5 and the Mimic, by foes.json id.
const CANON = ['hollow-sentries', 'unwritten', 'tollmen', 'cinder-golems', 'hush-hounds', 'drowned-bell-ringers'];

/**
 * How an examineKey resolves to lines (the rule K1's examineLine follows): an entry that's a list
 * is its lines; an entry with variants gives the variant's lines, or when there's no variant (or
 * none of that name) its first variant's.
 */
function resolve({ group, id, variant = null }) {
  const entry = examine.groups[group]?.[id];
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === 'object') return entry[variant] || Object.values(entry)[0] || [];
  return [];
}

/** Every line examine.json holds, as [where, line]. */
function* examineLines() {
  for (const [group, entries] of Object.entries(examine.groups)) {
    for (const [id, entry] of Object.entries(entries)) {
      if (Array.isArray(entry)) for (const [i, line] of entry.entries()) yield [`${group}.${id}[${i}]`, line];
      else for (const [variant, list] of Object.entries(entry)) for (const [i, line] of list.entries()) yield [`${group}.${id}.${variant}[${i}]`, line];
    }
  }
}

/* --- examine.json */

test('examine.json has the nine groups, and every entry is three or more calm lines of at most 120 characters', () => {
  assert.equal(examine.version, 1);
  assertCalm(examine.about, 'examine.about', { proper: PENDING_NAMES });
  assert.deepEqual(Object.keys(examine.groups), GROUPS);
  for (const [group, entries] of Object.entries(examine.groups)) {
    assert.ok(Object.keys(entries).length > 0, `${group} has entries`);
    for (const [id, entry] of Object.entries(entries)) {
      const where = `${group}.${id}`;
      assert.match(id, /^[a-z][a-z0-9-]*$/, `${where} is a slug`);
      if (Array.isArray(entry)) {
        lines(entry, where, { min: UNIQUE.has(where) ? 1 : 3, max: 120, proper: PENDING_NAMES });
      } else {
        assert.ok(entry && typeof entry === 'object', `${where} is a list or lines by variant`);
        assert.ok(Object.keys(entry).length >= 1, `${where} has a variant`);
        for (const [variant, list] of Object.entries(entry)) {
          assert.ok(VARIANTS.includes(variant), `${where}: “${variant}” is one of §9.12’s variants`);
          lines(list, `${where}.${variant}`, { min: 3, max: 120, proper: PENDING_NAMES });
        }
      }
    }
  }
});

test('examine.json holds at least 150 lines of its own, on top of the wilds’ 73', () => {
  const own = [...examineLines()].length;
  assert.ok(own >= 150, `${own} lines in examine.json`);
  let phase3 = 0;
  for (const [, text] of strings(wilds.examine)) if (typeof text === 'string') phase3 += 1;
  assert.ok(phase3 >= 73, `${phase3} lines in wilds.examine`);
});

test('no line in examine.json is said twice, or already said by the wilds, the story or a Riddle Note', () => {
  const said = new Map();
  const skip = /(^|\.)(id|from|region|version|kind|target|found|landmark|talk|joins|tier|sign)$|^about$/;
  for (const [file, value] of [['wilds', wilds], ['story', story], ['trails', trails]]) {
    for (const [path, text] of strings(value)) {
      if (skip.test(path) || /\.(id|title|name)$/.test(path)) continue;
      said.set(text.toLowerCase(), `${file}.${path}`);
    }
  }
  for (const [where, line] of examineLines()) {
    const k = line.toLowerCase();
    assert.ok(!said.has(k), `“${line}” appears at ${said.get(k)} and examine.${where}`);
    said.set(k, `examine.${where}`);
  }
});

test('examine.json uses no other game’s words, and nothing a cosy world never says', () => {
  for (const [where, line] of examineLines()) {
    assertOwnWords(line, where);
    assertCosy(line, where);
  }
});

test('every row of §9.12’s examineKey table resolves to lines', () => {
  const rows = [];
  // milo, a crew member, a party follower, the Tollkeeper (a regular follower falls back to `regular`).
  // The crew are engine.js's CREW_ORDER (claude, codex, ollama: every helper tool sits at the camp
  // once it's installed, and the engine's hit test answers { kind: 'crew', id }), plus the two it
  // perches, PERCHED (jev, whisper); src/world/engine.js:68 and :70.
  for (const id of ['milo', 'claude', 'codex', 'ollama', 'jev', 'whisper', 'tollkeeper', 'regular']) rows.push({ group: 'company', id });
  // a vale place, by its kind: camp holds the camp's own, vale the rest
  const placeKinds = new Set([...PLACES.map((p) => p.kind), 'campfire', 'watchtower', 'plot', 'building', 'hook', 'gate', 'war-table', 'bell']);
  for (const kind of placeKinds) rows.push({ group: examine.groups.camp[kind] ? 'camp' : 'vale', id: kind });
  // a lantern, lit or not
  rows.push({ group: 'wilds', id: 'lantern', variant: 'lit' }, { group: 'wilds', id: 'lantern' });
  // Read at a ruin or a statue
  rows.push({ group: 'things', id: 'ruin', variant: 'read' }, { group: 'things', id: 'statue', variant: 'read' });
  // a tree, rock or bush, by its place kind (and the kinds of tree the wilds grow)
  for (const id of ['tree', 'rock', 'bush', 'pine', 'birch']) rows.push({ group: 'wilds', id });
  for (const variant of ['spring', 'summer', 'autumn', 'winter', null]) rows.push({ group: 'wilds', id: 'tree', variant });
  // a rift, an echo
  rows.push({ group: 'elsewhere', id: 'rift' }, { group: 'elsewhere', id: 'echo' });
  // a stray or an encounter post, by archetype, asleep or not
  for (const archetype of Object.keys(ARCHETYPES)) {
    rows.push({ group: 'creatures', id: archetype }, { group: 'creatures', id: archetype, variant: 'sleeping' });
  }
  // the Tale-lead and a field boss
  rows.push({ group: 'foes', id: 'tale-lead' });
  // a canon foe or cave creature, by its foes.json id (the file's own ids when it's there)
  const foes = maybe('combat/foes.json');
  const foeIds = new Set([...CANON, 'mimic', ...Object.values(CAVE_CREATURES).flat()]);
  if (foes) {
    for (const list of [foes.canon, foes.creatures]) for (const f of Array.isArray(list) ? list : []) foeIds.add(f.id);
    if (foes.mimic?.id) foeIds.add(foes.mimic.id);
    for (const list of Object.values(foes.caves || {})) for (const id of list) foeIds.add(id);
  }
  for (const id of foeIds) rows.push({ group: 'foes', id });
  // inside an Elsewhere: the stitch, the exit, a chest (opened or not), a curio, the nook
  for (const id of ['stitch', 'exit', 'curio', 'nook']) rows.push({ group: 'elsewhere', id });
  rows.push({ group: 'elsewhere', id: 'chest' }, { group: 'elsewhere', id: 'chest', variant: 'opened' });
  // the Last Bridge: waiting over its river (the default), or the dry footbridge on the north road
  rows.push({ group: 'things', id: 'last-bridge' }, { group: 'things', id: 'last-bridge', variant: 'sleeping' }, { group: 'things', id: 'last-bridge', variant: 'opened' });
  // the sky, by weather, with the daypart as the variant (A's sky.json kinds too, once it's there)
  const sky = maybe('sky.json');
  const weather = new Set(WEATHER);
  for (const kinds of Object.values(sky?.weather || {})) for (const kind of Object.keys(kinds || {})) weather.add(kind);
  for (const kind of weather) {
    for (const variant of [null, ...DAYPARTS]) rows.push({ group: 'sky', id: kind, variant });
  }
  for (const row of rows) {
    const found = resolve(row);
    assert.ok(Array.isArray(found) && found.length >= 1, `${row.group}.${row.id}${row.variant ? ` (${row.variant})` : ''} has lines`);
  }
  // Every Phase 4 wild point of interest still reads from wilds.examine, unchanged.
  for (const type of ['ruin', 'cave', 'chest', 'note', 'hamlet', 'statue', 'landmark', 'quay', 'ore', 'herbs', 'fishing']) {
    assert.ok(wilds.examine[type], `wilds.examine.${type}`);
  }
  assert.ok(rows.length > 90, `${rows.length} rows checked`);
});

test('every crew member and perched helper the world draws has Examine lines, read off engine.js itself', () => {
  // Read as text, not imported (engine.js draws on a canvas): a helper added to the crew later
  // needs company lines before this passes.
  const engine = readFileSync(new URL('../src/world/engine.js', import.meta.url), 'utf8');
  const listed = (name) => {
    const m = engine.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`));
    assert.ok(m, `engine.js still has ${name}`);
    return [...m[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((x) => x[1]);
  };
  const crew = listed('CREW_ORDER');
  const perched = listed('PERCHED');
  assert.ok(crew.includes('ollama'), 'the hearth-sprite sits with the crew');
  for (const id of [...crew, ...perched]) {
    assert.ok(resolve({ group: 'company', id }).length >= 3, `company.${id} has lines`);
  }
});

test('the variants fit what picks them: a chest opens, a lantern is lit, strays sleep, ruins and statues are read', () => {
  const { groups } = examine;
  assert.deepEqual(Object.keys(groups.elsewhere.chest), ['sleeping', 'opened']);
  assert.deepEqual(Object.keys(groups.wilds.lantern), ['sleeping', 'lit']);
  for (const archetype of Object.keys(ARCHETYPES)) assert.deepEqual(Object.keys(groups.creatures[archetype]), ['day', 'sleeping'], archetype);
  assert.deepEqual(Object.keys(groups.things.ruin), ['read']);
  assert.deepEqual(Object.keys(groups.things.statue), ['read']);
  for (const line of [...groups.things.ruin.read, ...groups.things.statue.read]) assert.match(line, /Scribe/, 'Read is the Scribe’s extra line');
  assert.deepEqual(Object.keys(groups.wilds.tree), ['spring', 'summer', 'autumn', 'winter']);
  assert.deepEqual(Object.keys(groups.things['last-bridge']), ['sleeping', 'opened'], 'the bridge over its river first, the dry footbridge when it’s walked');
  // The sky's variant is the daypart: every weather has its own lines for each of the four, day first.
  assert.deepEqual([...DAYPARTS].sort(), ['dawn', 'day', 'dusk', 'night'], 'the dayparts A’s sky gives');
  for (const kind of WEATHER) assert.deepEqual(Object.keys(groups.sky[kind]), ['day', 'night', 'dawn', 'dusk'], `the sky’s ${kind} has lines for every daypart`);
  for (const line of groups.creatures.walker.sleeping) assert.match(line, /asleep|nodded|snor|sleep/i);
});

test('the sky’s lines fit their daypart, so Examine never gives daytime lines at night', () => {
  // Each daypart resolves to its own lines, never another's (the leaves at night once read “The
  // ground is crunchy and bright.”), and no line says it's another time of day.
  const wrong = {
    day: /\b(night|nights|stars?|moon|moonlight|dark)\b/i,
    night: /\b(sun|sunny|sunshine|sunlight|daylight|day|dawn|dusk|evening)\b/i,
    dawn: /\b(dusk|evening|sunset|tonight)\b/i,
    dusk: /\b(dawn|morning|sunrise)\b/i,
  };
  const sky = examine.groups.sky;
  for (const kind of new Set([...WEATHER, ...Object.keys(sky)])) {
    for (const part of DAYPARTS) {
      assert.deepEqual(resolve({ group: 'sky', id: kind, variant: part }), sky[kind][part], `sky.${kind} at ${part} has its own lines`);
      for (const line of sky[kind][part]) assert.doesNotMatch(line, wrong[part], `sky.${kind}.${part}: ${line}`);
    }
  }
  assert.ok(!resolve({ group: 'sky', id: 'leaves', variant: 'night' }).includes('The ground is crunchy and bright. Autumn has arrived all at once.'));
});

test('the Hooklight’s line is canon, and the Last Bridge says its deck waits for the wood to wake, unless it’s the dry footbridge', () => {
  assert.deepEqual(examine.groups.things.hooklight, [HOOKLIGHT]);
  const bridge = examine.groups.things['last-bridge'];
  // Over a river (every world with a crossing near the wood, hushlands included): the deck isn't walked.
  assert.deepEqual(resolve({ group: 'things', id: 'last-bridge' }), bridge.sleeping, 'with no variant, the bridge over its river');
  for (const line of bridge.sleeping) {
    assert.match(line, /Hush|wake/, `every Last Bridge line says the deck waits (§17.9): ${line}`);
    assert.match(line, /deck|over|across/, `and that it isn’t crossed yet: ${line}`);
  }
  // The dry footbridge on the north road is road underfoot, walked like the rest: its lines never say
  // it won't take anyone across.
  for (const line of bridge.opened) {
    assert.match(line, /road/, `the footbridge is on the road: ${line}`);
    assert.doesNotMatch(line, /won’t|wait|not a day|till|before it/, `and never says it can’t be crossed: ${line}`);
  }
});

test('Jev never speaks, even when examined', () => {
  for (const line of examine.groups.company.jev) assert.ok(!/[“”]/.test(line), `no words in Jev’s mouth: ${line}`);
});

/* --- trails.json */

test('trails.json: the four tiers of Riddle Notes, by LORE’s names', () => {
  assert.equal(trails.version, 1);
  assertCalm(trails.about, 'trails.about');
  assert.deepEqual(trails.tiers, {
    easy: { name: 'Birch-bark' },
    medium: { name: 'Parchment' },
    hard: { name: 'Sealed' },
    elder: { name: 'Written in five hands' },
  });
  for (const [id, tier] of Object.entries(trails.tiers)) assertTitle(tier.name, `tiers.${id}`);
});

test('the first trail: five steps from a chest to the Last Bridge, Kindle first, in Tamsin’s hand', () => {
  const first = trails.trails.find((t) => t.id === 'first-trail');
  assert.ok(first, 'first-trail');
  assert.equal(trails.trails[0], first, 'it’s the first trail');
  assert.equal(first.tier, 'easy');
  assert.equal(first.from, 'Tamsin');
  assertTitle(first.title, 'first-trail.title');
  const index = new Set(Object.values(loreIndex()).flat());
  assert.ok(index.has(normaliseName(first.title)), `“${first.title}” is in LORE §21`);
  assert.ok(first.steps.length >= 4 && first.steps.length <= 5, `${first.steps.length} steps`);
  const [one] = first.steps;
  assert.equal(one.found, 'chest');
  assert.deepEqual(one.solve, { kind: 'feature', target: 'kindle' }, 'Kindle is introduced by the first step');
  for (const step of first.steps.slice(1)) assert.equal(step.found, 'given', `${step.id} is handed over when the one before is solved`);
  assert.deepEqual(first.steps.at(-1).solve, { kind: 'visit', target: LAST_BRIDGE_ID });
  assert.deepEqual(first.end, { landmark: LAST_BRIDGE_ID, talk: 'tollkeeper-riddles', joins: 'tollkeeper' });
  assert.ok('smallSpell' in first.reward);
  assert.equal(new Set(first.steps.map((s) => s.id)).size, first.steps.length, 'step ids are unique');
});

test('every trail step’s kind and target resolve against STEP_KINDS, FEATURES and real places', () => {
  assert.deepEqual([...STEP_KINDS], ['feature', 'visit', 'examine', 'read']);
  assert.deepEqual([...FEATURES], ['kindle', 'rest', 'chronicle', 'command', 'examine', 'muster', 'fight', 'talk-down', 'map', 'skills',
    'war-table', 'ward', 'stitch', 'step-through', 'lantern', 'notebook']);
  for (const trail of trails.trails) {
    assert.match(trail.id, /^[a-z0-9-]+$/);
    assert.ok(trails.tiers[trail.tier], `${trail.id}'s tier`);
    for (const step of trail.steps) {
      assert.match(step.id, /^[a-z0-9-]+$/);
      assert.ok(['chest', 'given'].includes(step.found), `${step.id}.found`);
      assert.ok(STEP_KINDS.includes(step.solve.kind), `${step.id}: ${step.solve.kind} is a step kind`);
      assert.ok(solveKnown(step.solve), `${step.id}: ${step.solve.kind} ${step.solve.target} is real`);
      // Nothing waits on a note placed at random, and every step is ordinary use within a week.
      assert.ok(!(step.solve.kind === 'read' && step.solve.target === 'note'), `${step.id} never depends on a randomly placed note`);
      if (step.solve.kind === 'read') assert.ok(READ_TARGETS.includes(step.solve.target));
    }
  }
  // A few things that aren't real, for contrast.
  assert.equal(solveKnown({ kind: 'feature', target: 'teleport' }), false);
  assert.equal(solveKnown({ kind: 'visit', target: 'the-moon' }), false);
  assert.equal(solveKnown({ kind: 'dance', target: 'kindle' }), false);
});

test('every Riddle Note reads calmly, is signed by Tamsin and has a short hint', () => {
  for (const trail of trails.trails) {
    for (const step of trail.steps) {
      lines(step.riddle, `${step.id}.riddle`, { min: 2, max: 120, proper: PENDING_NAMES });
      assert.equal(step.sign, '— T.', `${step.id} is in Tamsin’s hand`);
      assertCalm(step.hint, `${step.id}.hint`);
      assert.ok(step.hint.length <= 90, `${step.id}.hint is short (${step.hint.length})`);
      for (const line of [...step.riddle, step.hint]) {
        assertOwnWords(line, step.id);
        assertCosy(line, step.id);
      }
    }
  }
});

test('the note that leads to the Last Bridge fits either bridge: it never says there’s a river', () => {
  // Most worlds' Last Bridge crosses a river, but a world with no crossing near the wood gets the dry
  // footbridge on the north road (6 of trail.test.js's 50 seeds). Both hum (the Examine lines say
  // so), and both are at the Whisperwood's edge, so the note speaks of those.
  const toBridge = trails.trails.flatMap((t) => t.steps).filter((s) => s.solve.target === LAST_BRIDGE_ID);
  assert.ok(toBridge.length >= 1);
  for (const step of toBridge) {
    for (const line of [...step.riddle, step.hint]) {
      assert.doesNotMatch(line, /\b(river|rivers|stream|water|Murmur|banks?|ford|side)\b/i, `${step.id}: “${line}”`);
    }
    assert.match(step.riddle.join(' '), /hums/, `${step.id}: the bridge that hums`);
  }
  const bridge = examine.groups.things['last-bridge'];
  assert.ok([bridge.sleeping, bridge.opened].every((list) => list.some((line) => /\bhum/.test(line))), 'and both bridges’ Examine lines say it hums');
});

test('the trail’s ending points at a real talk and a real companion, once their files exist', () => {
  const first = trails.trails[0];
  const talk = url(`camp/talks/${first.end.talk}.md`);
  if (existsSync(talk)) assert.match(readFileSync(talk, 'utf8'), /\[join: tollkeeper\]/, 'the riddles end with him joining');
  const companion = maybe(`party/companions/${first.end.joins}.json`);
  if (companion) {
    assert.equal(companion.id, first.end.joins);
    if (companion.joins?.trail) assert.equal(companion.joins.trail, first.id);
  }
});

/* --- the edits to Phase 3's files */

test('the cave note no longer promises the Kit and is true where it shows, and Construction waits for Phase 5', () => {
  assertCalm(wilds.notes_later.cave, 'notes_later.cave');
  assert.ok(wilds.notes_later.cave.length <= 120);
  assert.match(wilds.notes_later.cave, /\bopen\b/);
  assert.doesNotMatch(wilds.notes_later.cave, /Kit/, 'it no longer promises the Adventurer’s Kit');
  // It shows only as the panel's "later" note, when phase4World is off and there's no way in, so it
  // never says the caves are open.
  assert.doesNotMatch(wilds.notes_later.cave, /\bare open\b|open to the company|\bopen now\b/, 'it never says the way in is open');
  assert.match(wilds.notes_later.cave, /isn’t open|not open|shut|closed/);
  assert.equal(fortress.constructionFrom, 'Phase 5');
});

test('poiView’s cave action appears only with phase4World, and nothing else changes with it', () => {
  const state = { wilds: { opened: {}, notes: {}, glimmers: {} } };
  const cave = { id: 'poi:cave:12,-61', type: 'cave', x: 12, y: -61, name: 'A cave mouth' };
  const open = poiView(cave, wilds, state, { phase4World: true });
  assert.deepEqual(open.action, { id: 'enter-cave', label: 'Go in · 3 Embers', cost: 3 });
  assertCalm(open.action.label, 'the cave’s action');
  assert.equal(open.later, '');
  assert.ok(open.lines.length === 1 && wilds.examine.cave.includes(open.lines[0]));
  for (const view of [poiView(cave, wilds, state), poiView(cave, wilds, state, { phase4World: false })]) {
    assert.equal(view.action, null);
    assert.equal(view.later, wilds.notes_later.cave);
    assert.deepEqual(view.lines, open.lines);
  }
  for (const type of ['chest', 'ruin', 'note', 'statue', 'hamlet', 'ore', 'herbs', 'fishing', 'quay', 'landmark']) {
    const poi = { id: `poi:${type}:5,-40`, type, x: 5, y: -40, name: `A ${type}`, region: type === 'statue' ? 'whisperwood' : undefined };
    assert.deepEqual(poiView(poi, wilds, state, { phase4World: true }), poiView(poi, wilds, state), `${type} is as it was`);
  }
});

test('the cave door’s price is economy.json’s spend.cave, never a number of wildtext’s own (§18.2 item 14)', { skip: !existsSync(url('economy.json')) && 'content/economy.json isn’t written yet' }, () => {
  const economy = read('economy.json');
  const state = { wilds: { opened: {}, notes: {}, glimmers: {} } };
  const cave = { id: 'poi:cave:12,-61', type: 'cave', x: 12, y: -61, name: 'A cave mouth' };
  const door = (econ) => poiView(cave, wilds, state, { phase4World: true, economy: econ }).action;
  const n = economy.spend.cave;
  assert.deepEqual(door(economy), { id: 'enter-cave', label: `Go in · ${n} ${n === 1 ? 'Ember' : 'Embers'}`, cost: n });
  // Without the file passed, A's defaults, which A's own test pins to economy.json, so the same price.
  assert.deepEqual(door(null), door(economy));
  // Change the file's price and the door follows: cost and label.
  const priced = (cave2) => ({ ...economy, spend: { ...economy.spend, cave: cave2 } });
  assert.deepEqual(door(priced(4)), { id: 'enter-cave', label: 'Go in · 4 Embers', cost: 4 });
  assert.deepEqual(door(priced(1)), { id: 'enter-cave', label: 'Go in · 1 Ember', cost: 1 });
  assert.deepEqual(door(priced(0)), { id: 'enter-cave', label: 'Go in', cost: 0 });
  // "Ember" (one) as embers.js's shortWords says it; LORE §21 lists only "Embers" (wave 4).
  for (const price of [4, 1, 0]) assertCalm(door(priced(price)).label, `the door at ${price}`, { proper: ['Ember'] });
  // Nothing else in the panel moves with the price, and with phase4World off there's still no door.
  assert.deepEqual({ ...poiView(cave, wilds, state, { phase4World: true, economy: priced(7) }), action: null }, { ...poiView(cave, wilds, state, { phase4World: true }), action: null });
  assert.equal(poiView(cave, wilds, state, { economy: priced(7) }).action, null);
  const code = readFileSync(new URL('../src/ui/wildtext.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert.deepEqual(code.filter((l) => /cost:\s*\d|Go in · \d/.test(l)), [], 'no price written into wildtext.js’s code');
});
