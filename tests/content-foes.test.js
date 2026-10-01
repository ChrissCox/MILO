// Module D's content (CONTRACT-PHASE4.md §9.7, §9.8, §6, §16.3): content/combat/leads.json and
// content/combat/foes.json. leads.json holds one rule per riftgen mechanic in riftgen.json's order
// with its exact text; foes.json the canon foes, cave creatures, the Mimic, the moves rules.json
// names, and the Great Ones. Every string is calm copy in MILO's own words.
//   node --test tests/content-foes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { assertCalm, assertName, assertOwnWords, assertCosy, strings, lines, loreIndex, normaliseName, ECHOES } from './calm.js';
import { ANCHORS } from '../src/world/worldgen.js';
import { ARCHETYPES, PARTS } from '../src/world/straygen.js';
import { PALETTE } from '../src/world/sprites.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const words = read('riftgen');
const leads = read('combat/leads');
const foes = read('combat/foes');
const rulesJson = existsSync(new URL('../content/combat/rules.json', import.meta.url)) ? read('combat/rules') : null;

// Names LORE §21 doesn't have yet (§16.3): wave 4 adds them and empties this list. The fight's
// plain words that COMBAT capitalises (actions, degrees, damage kinds, stats) sit here too, since
// the index leaves them out on purpose.
const PENDING_NAMES = [
  // mechanic names and mechanic actions (COMBAT.md §8.3)
  'Throttles', 'Copies', 'Firewall', 'Reboots', 'Streetlights', 'Clock', 'Squeaky', 'Snuffs', 'Portrait', 'Old', 'Ravens', 'Assembly',
  'Shift', 'Stamped', 'Steam', 'Too', 'Sideways', 'Splits', 'Hides', 'Alibis', 'Lights', 'Sends', 'Questions', 'Noon', 'Circles', 'Posse',
  'Fair', 'Grows', 'Only', 'Stomps', 'Alarms', 'Plant', 'Three', 'Trial', 'Different', 'Tour', 'Transformation', 'Still', 'Every',
  // moves (foes.json abilities)
  'Pounce', 'Spooky', 'Glitch', 'Nightwing', 'Candle', 'Star', 'False', 'Cork-gun', 'Stomp', 'Bite', 'Pinch',
  // the fight's plain words COMBAT capitalises
  'Interact', 'Examine', 'Talk', 'Brace', 'Seek', 'Strike', 'Hit', 'Critical', 'Graze', 'Miss', 'Integrity', 'Guard', 'Resolve',
  'Might', 'Wit', 'Light', 'Spark', 'Chill', 'Plain', 'Aside', 'Colossus',
  // COMBAT.md §8.5's Great Ones
  'Ones',
];
const proper = PENDING_NAMES;

// §6's closed vocabulary (the parts of it foes.json uses are checked here; B's validateAbility
// checks the rest when it's there).
const VERBS = ['damage', 'patch', 'condition', 'end-condition', 'move', 'act', 'heat', 'buffer', 'mark', 'mod', 'degree', 'reveal', 'surface', 'summon', 'command', 'reboot', 'calm', 'light', 'take', 'cancel', 'rule'];
const WHO = ['self', 'ally', 'ally-or-self', 'foe', 'unit', 'offline-ally', 'tile', 'object', 'none'];
const KINDS = ['static', 'chill', 'dread', 'grind', 'warp', 'doubt', 'dust', 'quake', 'light', 'ink', 'spark', 'plain'];
const CONDITIONS = ['tumbled', 'tangled', 'drowsy', 'dazzled', 'spooked', 'beguiled', 'queasy', 'rattled', 'dazed', 'slowed', 'quickened', 'brisk', 'winded', 'sparked', 'singed', 'soaked', 'hushed', 'unseen', 'exposed', 'singled-out', 'offline', 'lingering'];
const SURFACES = ['neon-puddle', 'candle-wax', 'candlefire', 'oil-slick', 'burning-oil', 'smog', 'gravity-well', 'dust-cloud', 'streetlight-pool', 'moonbrew-spill', 'steam', 'water', 'foliage', 'burning-foliage', 'ice', 'rough-ground'];
const OBJECT_KINDS = ['prop', 'lever', 'junction', 'lamp', 'candle', 'line', 'console', 'lectern', 'alibi', 'clue', 'plan-tile', 'breaker', 'forge', 'bell', 'riddle-board', 'chest'];
const ABILITY_KEYS = ['id', 'name', 'kind', 'circle', 'attack', 'big', 'consumes', 'meets', 'helpful', 'cannotMiss', 'outcome', 'spoken', 'costs', 'uses', 'sustained',
  'requires', 'reaction', 'passive', 'choices', 'by', 'target', 'effects', 'crit', 'upcast', 'words', 'text', 'stub', 'from'];
const TEMPERAMENTS = ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud'];

const SHIPPED = { 'throttles-speed': 'neon', 'streetlights-out': 'nocturne', 'snuffs-candles': 'gothic', 'assembly-lines': 'iron', 'too-big-to-see': 'void', alibis: 'noir', 'noon-duel': 'frontier', stomps: 'kaiju' };
const IDS = {
  neon: ['throttles-speed', 'copies', 'firewall', 'reboots-once'],
  nocturne: ['no-weakens-it', 'streetlights-out', 'clock-skips-back', 'squeaky-bicycle'],
  gothic: ['snuffs-candles', 'portrait-swap', 'old-letters', 'ravens'],
  iron: ['assembly-lines', 'shift-whistle', 'stamped-forms', 'steam-vents'],
  void: ['too-big-to-see', 'sideways', 'splits', 'hides-unseen'],
  noir: ['alibis', 'lights-out', 'red-herrings', 'questions'],
  frontier: ['noon-duel', 'circles', 'posse', 'fair-parley'],
  kaiju: ['grows-daily', 'only-the-colossus', 'stomps', 'alarms'],
  verdant: ['plant-three-seeds', 'a-tour-of-good-things'],
  starlight: ['a-transformation', 'three-small-wins'],
  summit: ['sit-still', 'a-trial-of-stillness'],
  backhalls: ['the-different-door'],
};

test('both files are version 1 with a calm about', () => {
  for (const file of [leads, foes]) {
    assert.equal(file.version, 1);
    assertCalm(file.about, 'about', { proper });
  }
  assert.deepEqual(Object.keys(leads), ['version', 'about', 'mechanics', 'fallback', 'hooks']);
  assert.deepEqual(Object.keys(foes), ['version', 'about', 'canon', 'creatures', 'caves', 'borrow', 'mimic', 'abilities', 'greatOnes']);
});

test('leads.json has 39 mechanics in riftgen’s order, with its exact text', () => {
  const want = Object.entries(words.genres).flatMap(([genre, bank]) => bank.mechanics.map((text, index) => ({ genre, index, text })));
  assert.equal(want.length, 39);
  assert.equal(leads.mechanics.length, 39);
  leads.mechanics.forEach((m, i) => {
    assert.equal(m.genre, want[i].genre, `${m.id}: genre`);
    assert.equal(m.index, want[i].index, `${m.id}: index`);
    assert.equal(m.text, want[i].text, `${m.id}: riftgen’s exact text`);
    assert.equal(m.id, IDS[m.genre][m.index], `${m.genre} ${m.index}: the contract’s id`);
  });
  assert.equal(new Set(leads.mechanics.map((m) => m.id)).size, 39, 'ids are unique');
});

test('eight mechanics ship, seven never fight, and the other 24 carry their rule, multiplier and bow as data', () => {
  const shipped = leads.mechanics.filter((m) => m.ships);
  assert.deepEqual(Object.fromEntries(shipped.map((m) => [m.id, m.genre])), SHIPPED);
  const noFight = leads.mechanics.filter((m) => m.noFight);
  assert.equal(noFight.length, 7);
  assert.ok(noFight.every((m) => ['verdant', 'starlight', 'summit', 'backhalls'].includes(m.genre)));
  assert.ok(leads.mechanics.filter((m) => ['verdant', 'starlight', 'summit', 'backhalls'].includes(m.genre)).every((m) => m.noFight && !m.ships));
  const rest = leads.mechanics.filter((m) => !m.ships && !m.noFight);
  assert.equal(rest.length, 24);
  for (const m of leads.mechanics) {
    assertName(m.name, `${m.id}.name`);
    assertCalm(m.rule, `${m.id}.rule`, { proper });
    assertCalm(m.bow, `${m.id}.bow`, { proper });
    assert.ok(m.rule.length <= 220 && m.bow.length <= 140, `${m.id}: short`);
    if (m.noFight) {
      assert.equal(m.xInt, null, `${m.id}: a puzzle has no multiplier`);
      assert.match(m.rule, /^No fight: /);
    } else assert.ok(typeof m.xInt === 'number' && m.xInt >= 0.5 && m.xInt <= 2, `${m.id}: xInt ${m.xInt}`);
    assert.ok(Array.isArray(m.objects));
    if (!m.ships) assert.deepEqual(m.objects, [], `${m.id}: objects only for what ships`);
  }
  // COMBAT §8.3's multipliers for the eight.
  const xInt = Object.fromEntries(shipped.map((m) => [m.id, m.xInt]));
  assert.deepEqual(xInt, { 'throttles-speed': 1.2, 'streetlights-out': 1.1, 'snuffs-candles': 1.2, 'assembly-lines': 1.2, 'too-big-to-see': 1.6, alibis: 1.6, 'noon-duel': 1.0, stomps: 1.1 });
});

test('the eight shipped mechanics name the objects their rooms need (§9.7)', () => {
  const objects = Object.fromEntries(leads.mechanics.filter((m) => m.ships).map((m) => [m.id, m.objects.map((o) => `${o.count} ${o.kind}`).join(', ')]));
  assert.deepEqual(objects, {
    'throttles-speed': '3 junction', 'streetlights-out': '4 lamp', 'snuffs-candles': '6 candle', 'assembly-lines': '3 line, 3 lever',
    'too-big-to-see': '', alibis: '3 alibi, 3 clue', 'noon-duel': '', stomps: '4 plan-tile',
  });
  for (const m of leads.mechanics) {
    for (const o of m.objects) {
      assert.ok(OBJECT_KINDS.includes(o.kind), `${m.id}: ${o.kind} is a §5.3 object kind`);
      assert.ok(['wall', 'floor', 'edge', 'lead-side'].includes(o.where), `${m.id}: ${o.where}`);
      assert.ok(Number.isInteger(o.count) && o.count >= 1 && o.count <= 8);
    }
  }
});

test('the fallback has its multiplier, rule and bow, and hooks are names with a companion and a talk', () => {
  assert.equal(leads.fallback.xInt, 1.0);
  assertCalm(leads.fallback.rule, 'fallback.rule', { proper });
  assertCalm(leads.fallback.bow, 'fallback.bow', { proper });
  assert.ok(Array.isArray(leads.hooks));
  for (const h of leads.hooks) {
    assert.equal(typeof h.name, 'string');
    assert.equal(typeof h.companion, 'string');
    assert.equal(typeof h.talk, 'string');
  }
});

test('canon foes: the six of COMBAT §8.5, each with its archetype, temperament, look and bow', () => {
  const want = {
    'hollow-sentries': ['construct', 'talk-down', 3], unwritten: ['ghost', 'read', 1], tollmen: ['walker', 'riddle', 1],
    'cinder-golems': ['construct', 'forge', 1], 'hush-hounds': ['crawler', 'walk', 2], 'drowned-bell-ringers': ['ghost', 'bell', 3],
  };
  assert.deepEqual(foes.canon.map((f) => f.id), Object.keys(want));
  for (const f of foes.canon) {
    const [archetype, bow, count] = want[f.id];
    assert.equal(f.archetype, archetype, f.id);
    assert.equal(f.bow.kind, bow, f.id);
    assert.equal(f.bow.count, count, f.id);
    assertCalm(f.bow.text, `${f.id}.bow`, { proper });
    checkFoe(f);
  }
});

function checkFoe(f) {
  assert.ok(ARCHETYPES[f.archetype], `${f.id}: archetype`);
  assert.ok(TEMPERAMENTS.includes(f.temperament), `${f.id}: temperament`);
  assert.notEqual(f.temperament, 'dramatic', `${f.id}: without a genre there’s no big move to open with`);
  assert.equal(typeof f.name, 'string');
  assert.equal(typeof f.one, 'string');
  if (f.look.sprite) assert.equal(typeof f.look.sprite, 'string');
  else {
    assert.ok(PALETTE[f.look.bodyKey], `${f.id}: body key ${f.look.bodyKey} is a palette key`);
    for (const p of f.look.parts) assert.ok(PARTS[p], `${f.id}: part ${p}`);
  }
  lines(f.examine, `${f.id}.examine`, { min: 3, max: 120, proper });
}

test('cave creatures and the regions’ lists: every region’s caves resolve to foes that exist', () => {
  const ids = new Set([...foes.canon, ...foes.creatures].map((f) => f.id));
  assert.equal(ids.size, foes.canon.length + foes.creatures.length, 'unique ids');
  for (const f of foes.creatures) {
    checkFoe(f);
    if (f.rank) assert.equal(f.rank, 'lackey');
    for (const id of f.abilities) assert.ok(foes.abilities.some((a) => a.id === id), `${f.id}: ${id}`);
  }
  const listed = {
    cinderforge: ['cinder-beetles', 'cinder-golems'], 'glass-fen': ['glass-eels', 'fen-herons'], 'archive-peaks': ['inkwyrms', 'unwritten'],
    mistmere: ['kite-crabs', 'fog-seals'], whisperwood: ['murmurs', 'fetchfoxes'], 'dicing-downs': ['dicing-frogs'], 'skyward-isles': ['sky-rays'], greyreach: ['hush-hounds'],
  };
  assert.deepEqual(foes.caves, listed);
  for (const list of Object.values(foes.caves)) for (const id of list) assert.ok(ids.has(id), id);
  // Every region in the world resolves: its own list, or the nearest listed region's.
  for (const anchor of ANCHORS) {
    const own = foes.caves[anchor.id];
    const borrowed = foes.caves[foes.borrow[anchor.id]];
    assert.ok(own || borrowed, `${anchor.id} resolves to a list`);
    assert.ok(!(own && foes.borrow[anchor.id]), `${anchor.id}: a listed region borrows nothing`);
    if (!own) {
      // The nearest listed region, anchor centre to anchor centre (painted-hills → Mistmere and
      // ivory-college → the Glass Fen, as §9.8 decides).
      const near = ANCHORS.filter((a) => foes.caves[a.id]).sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))[0];
      assert.equal(foes.borrow[anchor.id], near.id, `${anchor.id} borrows the nearest listed region`);
    }
  }
  assert.equal(foes.borrow['painted-hills'], 'mistmere');
  assert.equal(foes.borrow['ivory-college'], 'glass-fen');
  // The fetchfox's pinch is B's `take`, once a fight, and it settles the fox as it takes (§18.2
  // item 4: `settle: true`, so it pinches and runs home). The cordial comes back in the room's loot
  // (§9.8, Decided; encounters.rewardsFor from B's take events), and its words say both, and
  // nothing more: no fox drops it again or comes back.
  const pinch = foes.abilities.find((a) => a.id === 'fetchfox-pinch');
  assert.deepEqual(pinch.effects, [{ do: 'take', item: 'cordial', settle: true }]);
  assert.deepEqual(pinch.uses, { per: 'fight', n: 1 }, 'a fox pinches at most once a fight');
  const fox = foes.creatures.find((f) => f.id === 'fetchfoxes');
  for (const text of [pinch.text, fox.special, ...fox.examine]) assert.ok(!/drops? (it )?again|comes? back/i.test(text), `the fetchfox promises only what it does: ${text}`);
  assert.match(pinch.text, /home with it\.$/, 'the pinch says the fox runs home with it');
  assert.match(fox.special, /runs home with it\. The cordial turns up again in the room’s loot\.$/);
});

test('the Mimic bites for 1, looks like a chest, and settles the moment it’s opened', () => {
  const m = foes.mimic;
  assert.equal(m.id, 'mimic');
  assert.equal(m.archetype, 'construct');
  assert.equal(m.bite, 1);
  assert.deepEqual(m.bow.kind, 'open');
  assert.equal(m.look.sprite, 'chest.mimic');
  assert.ok(m.abilities.includes('mimic-bite'));
  checkFoe(m);
});

test('every ability rules.json and foes.json name resolves, and each is in §6’s closed language', async () => {
  const byId = new Map(foes.abilities.map((a) => [a.id, a]));
  assert.equal(byId.size, foes.abilities.length, 'ability ids are unique');
  const named = new Set([...foes.creatures.flatMap((f) => f.abilities), ...foes.mimic.abilities]);
  if (rulesJson) {
    for (const a of Object.values(rulesJson.archetypes)) for (const id of a.abilities || []) named.add(id);
    for (const [genre, g] of Object.entries(rulesJson.genres)) {
      for (const id of g.abilities || []) named.add(id);
      if (g.fights) assert.equal((g.abilities || []).filter((id) => byId.get(id)?.big).length, 1, `${genre} names one big move`);
    }
  }
  for (const id of named) assert.ok(byId.has(id), `${id} resolves in foes.json`);
  // One big move per shadow genre, and the crawler's Pounce and the ghost's rider.
  assert.equal(foes.abilities.filter((a) => a.big).length, 8);
  assert.ok(byId.has('pounce'));
  let validate = null;
  if (existsSync(new URL('../src/combat/effects.js', import.meta.url))) {
    try { ({ validateAbility: validate } = await import('../src/combat/effects.js')); } catch { validate = null; }
  }
  for (const a of foes.abilities) {
    assert.deepEqual(Object.keys(a), ABILITY_KEYS, `${a.id}: every field of §6.1, in order`);
    assert.equal(a.kind, 'move');
    assertName(a.name, `${a.id}.name`);
    assertCalm(a.text, `${a.id}.text`, { proper });
    assert.ok(a.text.length <= 140, `${a.id}: text ≤ 140`);
    assert.ok(WHO.includes(a.target.who), `${a.id}: target ${a.target.who}`);
    assert.ok(a.costs.every((c) => [1, 2, 3].includes(c)));
    for (const e of a.effects) {
      assert.ok(VERBS.includes(e.do), `${a.id}: verb ${e.do}`);
      if (e.do === 'condition') assert.ok(CONDITIONS.includes(e.id), `${a.id}: condition ${e.id}`);
      if (e.do === 'surface') assert.ok(SURFACES.includes(e.id), `${a.id}: surface ${e.id}`);
      if (e.do === 'damage') assert.ok(e.kind === 'caster' || KINDS.includes(e.kind), `${a.id}: kind ${e.kind}`);
      if (e.min) assert.ok(['hit', 'crit'].includes(e.min));
    }
    if (a.meets) assert.ok(['guard', 'body', 'mind'].includes(a.meets));
    if (validate) assert.deepEqual(validate(a), [], `${a.id}: B’s validateAbility`);
  }
});

test('no id in foes.json or leads.json is shared with another content file’s abilities', () => {
  const mine = new Set(foes.abilities.map((a) => a.id));
  for (const [file, key] of [['combat/callings', 'abilities'], ['combat/spells', 'spells']]) {
    if (!existsSync(new URL(`../content/${file}.json`, import.meta.url))) continue;
    for (const a of read(file)[key] || []) assert.ok(!mine.has(a.id), `${a.id} is in both foes.json and ${file}.json`);
  }
});

test('the Great Ones are data only: the Tollkeeper talks, the Cloud Leviathan never fights, the rest bow', () => {
  const kinds = Object.fromEntries(foes.greatOnes.map((g) => [g.id, g.kind]));
  assert.deepEqual(kinds, {
    tollkeeper: 'talk', 'drowned-bell': 'bow', 'blank-sovereign': 'bow', 'cinder-wyrm': 'bow', 'mirror-heron': 'bow', 'grey-stag': 'bow',
    'someday-king': 'bow', 'cloud-leviathan': 'no-fight',
  });
  for (const g of foes.greatOnes) {
    assert.match(g.from, /^Phase \d+$/);
    assertCalm(g.bow, `${g.id}.bow`, { proper });
  }
});

test('every string is calm, in MILO’s own words, and cosy', () => {
  for (const [file, data] of [['leads', leads], ['foes', foes]]) {
    for (const [path, text] of strings(data)) {
      assertOwnWords(text, `${file}.${path}`);
      assertCosy(text, `${file}.${path}`);
      assert.ok(!/[!"']/.test(text), `${file}.${path}: curly quotes, no exclamation marks`);
    }
  }
});

test('the names D adds to the fight collide with nothing in LORE’s index, unless they’re the thing itself', () => {
  const index = loreIndex();
  const all = new Map();
  for (const [group, names] of Object.entries(index)) for (const n of names) all.set(n, group);
  const echoes = new Set(ECHOES.map(normaliseName));
  const names = [
    ...leads.mechanics.map((m) => m.name),
    ...foes.abilities.map((a) => a.name),
  ];
  for (const name of names) {
    const n = normaliseName(name);
    assert.ok(!all.has(n) || echoes.has(n), `${name} collides with LORE §21’s ${all.get(n)}`);
  }
  // The canon foes and creatures are LORE's own names.
  for (const f of [...foes.canon, ...foes.creatures]) {
    assert.ok(all.has(normaliseName(f.name)), `${f.name} is in LORE §21`);
  }
});
