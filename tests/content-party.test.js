// Content tests for C, party and camp (CONTRACT-PHASE4.md §4.11–§4.12, §6, §9.3–§9.6, §9.10): the
// callings, spells, companions, regulars, team-ups, banter, camp scenes and talks. Every ability is
// checked against §6's closed vocabulary (and B's validateAbility once it exists), every shipped
// spell, feature, weapon art and item against a transcription of COMBAT §5.4 and §6, the charge
// tables against §4.12, and every string against the calm rules. Jev never speaks anywhere.
//   node --test tests/content-party.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

import { assertCalm, assertName, assertGesture, assertOwnWords, assertCosy, loreIndex, normaliseName, strings } from './calm.js';
import { parseTalk } from '../src/camp.js';

const ROOT = new URL('../content/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const callings = read('combat/callings.json');
const spells = read('combat/spells.json');
const regulars = read('party/regulars.json');
const teamups = read('party/teamups.json');
const banter = read('party/banter.json');
const scenes = read('camp/scenes.json');
const rules = existsSync(new URL('combat/rules.json', ROOT)) ? read('combat/rules.json') : null;
const foes = existsSync(new URL('combat/foes.json', ROOT)) ? read('combat/foes.json') : null;
const leads = existsSync(new URL('combat/leads.json', ROOT)) ? read('combat/leads.json') : null;
const COMPANION_IDS = ['milo', 'claude', 'codex', 'jev', 'tollkeeper', 'rivet', 'pip', 'dusty', 'juno', 'mae', 'lumi', 'tova', 'nell', 'whisper', 'vesperine'];
const companions = Object.fromEntries(readdirSync(new URL('party/companions/', ROOT)).filter((f) => f.endsWith('.json'))
  .map((f) => [f.slice(0, -5), read(`party/companions/${f}`)]));
const TALK_FILES = readdirSync(new URL('camp/talks/', ROOT)).filter((f) => f.endsWith('.md'));
const talkText = (f) => readFileSync(new URL(`camp/talks/${f}`, ROOT), 'utf8');

// Names LORE §21 doesn't have yet (§16.3): path features, signatures and their tricks, the tonics'
// full names and a few moves. Wave 4 adds them to LORE and empties this list.
const PENDING_NAMES = [
  'Ability up', 'Bench: tool belt', 'Bench: workshop', 'Big candle hush', 'Big clock in', 'Big fast hands', 'Big fold in', 'Big ground shake',
  'Big hunch', 'Big into the shadows', 'Big static snap', 'Brew of clear morning', 'Bridge: all cross', 'Bridge: hold fast', 'Candle hush',
  'Clock in', 'Courier: express', 'Courier: return post', 'Device', 'Fast hands', 'Fold in', 'Footnote: appendix', 'Footnote: small print',
  'Gavel: last word', 'Gavel: ruling', 'Ground shake', 'Hearthberry cordial', 'High tide', 'Hunch', 'Into the shadows', 'Name it', 'On her bicycle', 'Quick feet',
  'Slate: a clean slate', 'Slate: clean build', 'Static snap', 'Steady second', 'Steady third', 'Swipe strike', 'The toll',
  'Three Pens: fair copy', 'Three Pens: second draft', 'Troll-kin: old stories', 'Troll-kin: stone at dawn', 'Two at once', 'Two drones',
  'Wayward step',
];
// The fight's own words (COMBAT §3–§7): capitalised in every rule text, and not names LORE indexes.
const RULE_WORDS = ['Hushlands', 'Stranger', 'Acquaintance', 'Companion', 'Friend', 'Fireside', 'Integrity', 'Guard', 'Resolve', 'Buffer', 'Critical', 'Hit', 'Graze', 'Miss', 'Stride', 'Step', 'Strike', 'Strikes', 'Brace',
  'Examine', 'Seek', 'Interact', 'Assist', 'Assists', 'Talk', 'Reboot', 'Rebooted', 'Delay', 'Hide', 'Throw', 'Shove', 'Jump', 'Dip', 'Sustain',
  'Ready', 'Speed', 'Might', 'Grace', 'Grit', 'Wit', 'Heed', 'Charm', 'Light', 'Ink', 'Spark', 'Plain', 'Parting', 'Rattles', 'Dazes', 'Singes',
  'Tumbles', 'Sparked', 'Dim', 'Dark', 'Tale-lead', 'Warden', 'Scrivener', 'Weaver', 'Wayfarer', 'Titan', 'Neon', 'Nocturne', 'Gothic', 'Iron',
  'Void', 'Noir', 'Frontier'];
const PROPER = ['CONTRACT-PHASE4.md', ...RULE_WORDS, ...PENDING_NAMES.flatMap((n) => n.split(/[\s:]+/)).filter((w) => /^\p{Lu}/u.test(w))];

// ---------------------------------------------------------------------------
// §6's closed vocabulary

const KINDS = ['knack', 'spell', 'feature', 'move', 'reaction', 'passive', 'art', 'boon', 'item', 'device'];
const FIELDS = ['id', 'name', 'kind', 'circle', 'attack', 'big', 'consumes', 'meets', 'helpful', 'cannotMiss', 'outcome', 'spoken', 'costs', 'uses',
  'sustained', 'requires', 'reaction', 'passive', 'choices', 'by', 'target', 'effects', 'crit', 'upcast', 'words', 'text', 'stub', 'from'];
const PREDICATES = ['below-half', 'below-third', 'below-quarter', 'offline', 'standing', 'small', 'not-lead', 'not-elite', 'not-large', 'examined',
  'has-boon', 'has-bane', 'lingering', 'beside-ally', 'in-light', 'dim-or-dark', 'lantern-down', 'has-device', 'examined-target', 'stitched-genre'];
const TRIGGERS = ['foe-leaves-reach', 'ally-struck-beside', 'strike-at-ally', 'hit-on-ally', 'outcome-in-sight', 'self-struck', 'foe-moves-in-sight',
  'foe-enters-reach', 'readied', 'spell-in-sight', 'telegraph-at-ally', 'big-blow-on-ally'];
const RULE_IDS = ['hooklight', 'raise-lantern', 'stand-in-my-light', 'lantern-calls', 'hearth-path', 'wick-path', 'wayward-path', 'draw-the-blow',
  'unbroken', 'settle-low', 'lullaby', 'unseen-strike', 'tuck-and-roll', 'ignore-difficult', 'first-in-tick', 'burn-essence', 'cleave', 'tune-ups',
  'tollkeeper-toll', 'steady-hands', 'steady-second', 'steady-third', 'two-sustained', 'two-drones', 'swipe-strike'];
const TEMPLATES = ['drone', 'turret', 'snare', 'patch-kit', 'pop-up-cover', 'decoy'];
const KINDS_OF_DAMAGE = ['static', 'chill', 'dread', 'grind', 'warp', 'doubt', 'dust', 'quake', 'light', 'ink', 'spark', 'plain'];
const CONDITIONS = ['tumbled', 'tangled', 'drowsy', 'dazzled', 'spooked', 'beguiled', 'queasy', 'rattled', 'dazed', 'slowed', 'quickened', 'brisk',
  'winded', 'sparked', 'singed', 'soaked', 'hushed', 'unseen', 'exposed', 'singled-out', 'offline', 'lingering'];
const SURFACES = ['neon-puddle', 'candle-wax', 'candlefire', 'oil-slick', 'burning-oil', 'smog', 'gravity-well', 'dust-cloud', 'streetlight-pool',
  'moonbrew-spill', 'steam', 'water', 'foliage', 'burning-foliage', 'ice', 'rough-ground'];
const STATS = ['edge-next', 'edge-first-each-turn', 'edge-all', 'resolve-mind', 'resolve-body', 'resolve-set', 'guard', 'speed', 'speed-next-stride',
  'resist-all', 'drift', 'reboot-cost', 'initiative', 'light-radius', 'degree-next-on-foe', 'degree-next-from-foe'];
const UNTIL = /^(next-action|next-attack|next-stride|next-effect|start-of-next-turn|end-of-round|end-of-next-round|sustained|fight|rounds:\d+)$/;
const LINES = ['one', 'strike', 'two', 'three', 'area', 'weapon', 'stray', 'fixed'];
const WHO = ['self', 'ally', 'ally-or-self', 'foe', 'unit', 'offline-ally', 'tile', 'object', 'none'];
const HITS = ['foes', 'allies', 'allies-and-self', 'all'];

const isNum = (n) => (typeof n === 'number' && Number.isFinite(n)) || n === 'wit' || n === 'charm'
  || (n && typeof n === 'object' && !Array.isArray(n) && Object.keys(n).length === 1 && n.byLevel && typeof n.byLevel === 'object'
    && Object.entries(n.byLevel).every(([k, v]) => /^\d+$/.test(k) && typeof v === 'number'));
const isFrac = (f) => isNum(f) || (Array.isArray(f) && f.length === 2 && f.every((x) => Number.isInteger(x) && x > 0));

// Each verb's params (beyond do, min, to, if).
const VERB_PARAMS = {
  damage: { line: (v) => LINES.includes(v), amount: (v) => typeof v === 'number', kind: (v) => v === 'caster' || v === 'weapon' || KINDS_OF_DAMAGE.includes(v), frac: isFrac, plus: (v) => isNum(v) || v === 'bead', split: isNum },
  patch: { line: (v) => LINES.includes(v), frac: isFrac, plus: isNum, ofMax: (v) => typeof v === 'number' && v > 0 && v <= 1 },
  condition: { id: (v) => CONDITIONS.includes(v), n: isNum, data: (v) => v === null || typeof v === 'object' },
  'end-condition': { id: (v) => CONDITIONS.includes(v), class: (v) => ['boon', 'bane', 'any', 'lingering'].includes(v), count: isNum },
  move: { who: (v) => v === 'target' || v === 'self', how: (v) => ['push', 'pull', 'stride', 'step', 'teleport', 'swap'].includes(v), tiles: isNum, noSwipes: (v) => typeof v === 'boolean', into: (v) => v === 'any' || v === 'dim' },
  act: { action: (v) => ['stride', 'step', 'hide', 'brace', 'strike', 'seek'].includes(v), noSwipes: (v) => typeof v === 'boolean' },
  heat: { by: isNum, to: (v) => v === 'idle' },
  buffer: { amount: (v) => v === 'brace' || isNum(v) },
  mark: { id: (v) => ['bead', 'wanted', 'that-pile', 'drawn', 'assist'].includes(v), n: isNum, edge: isNum, edgeHot: isNum, hotAt: isNum, spend: (v) => v === 'attack' || v === 'action', until: (v) => UNTIL.test(v) },
  mod: { stat: (v) => STATS.includes(v), by: isNum, until: (v) => UNTIL.test(v) },
  degree: { by: (v) => v === 1 || v === -1 },
  reveal: { what: (v) => ['stats', 'unseen', 'intents', 'mechanic'].includes(v), radius: isNum },
  surface: { id: (v) => SURFACES.includes(v), rounds: (v) => v === null || isNum(v), area: (v) => v === null || isArea(v) },
  summon: { template: (v) => TEMPLATES.includes(v), rounds: (v) => v === null || isNum(v) },
  command: { device: (v) => v === 'drone' || v === 'turret', order: (v) => ['zap', 'assist', 'carry'].includes(v) },
  reboot: { frac: (v) => v === 0.25 },
  calm: { n: isNum },
  light: { radius: isNum, rounds: (v) => v === null || isNum(v) },
  take: { item: (v) => v === 'cordial' || v === 'brew' },
  cancel: { what: (v) => v === 'spell', maxCircle: (v) => Number.isInteger(v) },
  rule: { id: (v) => RULE_IDS.includes(v) },
};

function isArea(a) {
  return a && typeof a === 'object' && ['burst', 'square', 'line'].includes(a.shape) && Number.isInteger(a.size) && a.size > 0 && (a.at === 'self' || a.at === 'target')
    && Object.keys(a).every((k) => ['shape', 'size', 'at'].includes(k));
}

function effectProblems(effects, where) {
  const out = [];
  if (!Array.isArray(effects)) return [`${where} effects is a list`];
  effects.forEach((e, i) => {
    const at = `${where}[${i}]`;
    if (!e || typeof e !== 'object' || !Object.hasOwn(VERB_PARAMS, e.do)) { out.push(`${at} has a known verb (${e?.do})`); return; }
    const params = VERB_PARAMS[e.do];
    for (const [k, v] of Object.entries(e)) {
      if (k === 'do') continue;
      if (k === 'min') { if (v !== 'hit' && v !== 'crit') out.push(`${at}.min is hit or crit`); continue; }
      if (k === 'to') { if (!['target', 'self', 'area'].includes(v)) out.push(`${at}.to is target, self or area`); continue; }
      if (k === 'if') { if (!PREDICATES.includes(v)) out.push(`${at}.if is a predicate`); continue; }
      if (!Object.hasOwn(params, k)) out.push(`${at} has no param “${k}” for ${e.do}`);
      else if (!params[k](v)) out.push(`${at}.${k} is valid for ${e.do}: ${JSON.stringify(v)}`);
    }
    if (e.do === 'end-condition' && !e.id && !e.class) out.push(`${at} names an id or a class`);
    if (e.do === 'rule' && !e.id) out.push(`${at} names a rule`);
  });
  return out;
}

function targetProblems(t, where) {
  const out = [];
  if (!t || typeof t !== 'object') return [`${where} is a TargetSpec`];
  const keys = ['who', 'range', 'sight', 'area', 'hits', 'count', 'need'];
  for (const k of Object.keys(t)) if (!keys.includes(k)) out.push(`${where} has no field “${k}”`);
  if (!WHO.includes(t.who)) out.push(`${where}.who is valid`);
  if (!Number.isInteger(t.range) || t.range < 0) out.push(`${where}.range is a whole number`);
  if (typeof t.sight !== 'boolean') out.push(`${where}.sight is a boolean`);
  if (t.area !== null && !isArea(t.area)) out.push(`${where}.area is null or an area`);
  if (!HITS.includes(t.hits)) out.push(`${where}.hits is valid`);
  if (!Number.isInteger(t.count) || t.count < 1) out.push(`${where}.count is at least 1`);
  if (!Array.isArray(t.need) || !t.need.every((p) => PREDICATES.includes(p))) out.push(`${where}.need holds predicates`);
  return out;
}

/** C's own check of an Ability against §6's closed lists: [] when fine. */
function validate(a) {
  const out = [];
  const where = a?.id || '?';
  for (const k of Object.keys(a)) if (!FIELDS.includes(k)) out.push(`${where} has no field “${k}”`);
  for (const k of FIELDS) if (!Object.hasOwn(a, k)) out.push(`${where} has every field (${k})`);
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(a.id)) out.push(`${where} id is a slug`);
  if (!KINDS.includes(a.kind)) out.push(`${where} kind is valid`);
  if (![0, 1, 2, 3, 4, 5].includes(a.circle) || (a.kind === 'spell') !== (a.circle > 0)) out.push(`${where} circle fits its kind`);
  for (const k of ['attack', 'big', 'helpful', 'cannotMiss', 'outcome', 'spoken', 'upcast', 'stub']) if (typeof a[k] !== 'boolean') out.push(`${where}.${k} is a boolean`);
  if (a.big) out.push(`${where} is not a stray’s big move`);
  if (![null, 'cordial', 'brew', 'margin', 'spare', 'essence'].includes(a.consumes)) out.push(`${where}.consumes is valid`);
  if (![null, 'guard', 'body', 'mind'].includes(a.meets)) out.push(`${where}.meets is valid`);
  if (!Array.isArray(a.costs) || !a.costs.every((c) => [0, 1, 2, 3].includes(c))) out.push(`${where}.costs are action counts`);
  if (a.uses !== null && !(['turn', 'round', 'target-round', 'breather', 'campfire', 'fight'].includes(a.uses?.per) && isNum(a.uses?.n))) out.push(`${where}.uses is valid`);
  if (a.sustained !== null && !(a.sustained?.max === 10 && Object.keys(a.sustained).length === 1)) out.push(`${where}.sustained is null or { max: 10 }`);
  if (!Array.isArray(a.requires) || !a.requires.every((p) => ['lantern-down', 'has-device', 'examined-target', 'stitched-genre'].includes(p))) out.push(`${where}.requires is valid`);
  if (a.reaction !== null && !(TRIGGERS.includes(a.reaction?.when) && Number.isInteger(a.reaction?.range))) out.push(`${where}.reaction is valid`);
  if (a.passive !== null) {
    const p = a.passive;
    const modOk = (m) => m && STATS.includes(m.stat) && isNum(m.by) && UNTIL.test(m.until) && Object.keys(m).length === 3;
    if (!Array.isArray(p.mods) || !p.mods.every(modOk)) out.push(`${where}.passive.mods are Mods`);
    if (p.aura !== null && !(p.aura && (isNum(p.aura.radius) || p.aura.radius === 'light') && ['allies', 'allies-and-self', 'foes'].includes(p.aura.who) && p.aura.mods.every(modOk))) out.push(`${where}.passive.aura is valid`);
    if (!Array.isArray(p.rules) || !p.rules.every((r) => RULE_IDS.includes(r))) out.push(`${where}.passive.rules are rule ids`);
    if (!Array.isArray(p.summons) || !p.summons.every((s) => TEMPLATES.includes(s.template) && s.at === 'fight-start')) out.push(`${where}.passive.summons are valid`);
  }
  const set = ['by', 'choices', 'target'].filter((k) => a[k] !== null);
  if (a.passive !== null) {
    if (set.length || a.effects !== null) out.push(`${where}: a passive sets none of by, choices, target or effects`);
  } else if (a.reaction !== null) {
    if (a.target === null || a.effects === null || a.by !== null || a.choices !== null) out.push(`${where}: a reaction sets target and effects`);
  } else if (set.length !== 1 || (a.target !== null) !== (a.effects !== null)) {
    out.push(`${where} sets exactly one of by, choices, or target with effects`);
  }
  if (a.target !== null) out.push(...targetProblems(a.target, `${where}.target`), ...effectProblems(a.effects, `${where}.effects`));
  for (const [cost, v] of Object.entries(a.by || {})) {
    if (!a.costs.includes(Number(cost))) out.push(`${where}.by.${cost} is one of its costs`);
    out.push(...targetProblems(v.target, `${where}.by.${cost}.target`), ...effectProblems(v.effects, `${where}.by.${cost}.effects`));
  }
  for (const [name, v] of Object.entries(a.choices || {})) {
    if (typeof v.words !== 'string' || !v.words) out.push(`${where}.choices.${name} has words`);
    out.push(...targetProblems(v.target, `${where}.choices.${name}.target`), ...effectProblems(v.effects, `${where}.choices.${name}.effects`));
  }
  out.push(...effectProblems(a.crit, `${where}.crit`));
  if (a.stub && typeof a.from !== 'string') out.push(`${where}: a stub says when it arrives`);
  if (typeof a.text !== 'string' || a.text.length > 140) out.push(`${where}.text is at most 140 characters`);
  return out;
}

const ABILITIES = [
  ...callings.abilities,
  ...spells.spells,
  ...Object.values(companions).flatMap((c) => c.abilityDefs || []),
  ...regulars.abilityDefs,
];
const byId = new Map(ABILITIES.map((a) => [a.id, a]));

// ---------------------------------------------------------------------------

test('every content file C owns has version 1 and a calm about', () => {
  for (const [name, file] of Object.entries({ callings, spells, regulars, teamups, banter, scenes })) {
    assert.equal(file.version, 1, `${name} is version 1`);
    assertCalm(file.about, `${name}.about`, { proper: PROPER });
  }
  for (const [id, file] of Object.entries(companions)) assert.equal(file.version, 1, `${id}.json is version 1`);
  assert.deepEqual(TALK_FILES.sort(), ['first-night.md', 'tollkeeper-riddles.md']);
});

test('every file C creates stays at or under 1,500 lines (§2), code, content and tests alike', () => {
  const REPO = new URL('../', import.meta.url);
  const files = [
    'src/party.js', 'src/camp.js', 'tests/party.test.js', 'tests/camp.test.js', 'tests/content-party.test.js',
    'content/combat/callings.json', 'content/combat/spells.json', 'content/party/regulars.json', 'content/party/teamups.json',
    'content/party/banter.json', 'content/camp/scenes.json',
    ...Object.keys(companions).map((id) => `content/party/companions/${id}.json`),
    ...TALK_FILES.map((f) => `content/camp/talks/${f}`),
  ];
  for (const file of files) {
    const text = readFileSync(new URL(file, REPO), 'utf8');
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    assert.ok(lines <= 1500, `${file} has ${lines} lines`);
  }
});

test('every ability uses only §6’s closed vocabulary (C’s own check of the lists)', () => {
  const problems = ABILITIES.flatMap(validate);
  assert.deepEqual(problems, []);
  assert.ok(ABILITIES.length > 120, `there are ${ABILITIES.length} abilities`);
});

test('every ability passes B’s validateAbility', async (t) => {
  const url = new URL('../src/combat/effects.js', import.meta.url);
  if (!existsSync(url)) { t.skip('src/combat/effects.js hasn’t landed yet; C’s own §6 check above stands in'); return; }
  const { validateAbility } = await import(url);
  const problems = ABILITIES.flatMap((a) => validateAbility(a).map((p) => `${a.id}: ${p}`));
  assert.deepEqual(problems, []);
});

test('no item, spell, move, feature or foe ability shares an id', () => {
  const seen = new Map();
  const add = (list, where) => {
    for (const a of list || []) {
      assert.ok(!seen.has(a.id), `${a.id} is in both ${seen.get(a.id)} and ${where}`);
      seen.set(a.id, where);
    }
  };
  add(callings.abilities, 'callings.json');
  add(spells.spells, 'spells.json');
  for (const [id, c] of Object.entries(companions)) add(c.abilityDefs, `companions/${id}.json`);
  add(regulars.abilityDefs, 'regulars.json');
  add(foes?.abilities, 'foes.json');
  add(leads?.abilities, 'leads.json');
});

test('the charge tables and highest circles equal §4.12 cell for cell', () => {
  assert.deepEqual(callings.charges, {
    full: [2, 3, 4, 5, 7, 8, 10, 11, 13, 14, 15, 16],
    'three-quarter': [2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    half: [0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7],
    pact: [1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3],
  });
  assert.deepEqual(callings.circles, {
    full: { 1: 1, 3: 2, 5: 3, 7: 4, 9: 5 },
    pact: { 1: 1, 3: 2, 5: 3, 7: 4, 9: 5 },
    'three-quarter': { 1: 1, 3: 2, 6: 3, 9: 4 },
    half: { 2: 1, 5: 2, 9: 3 },
  });
});

test('the nine callings equal §4.11: build, key, Resolve, armour, charges and kit', () => {
  const want = {
    lanternkeeper: ['middle', 'heed', { body: 0, mind: 1 }, 'light', null, false, 'three-quarter', 'light'],
    warden: ['sturdy', 'might', { body: 1, mind: 0 }, 'mail', 5, true, null, 'standard'],
    mender: ['light', 'heed', { body: 0, mind: 1 }, 'mail', null, true, 'full', 'light'],
    scrivener: ['light', 'wit', { body: 0, mind: 1 }, 'none', null, false, 'full', 'light'],
    tinker: ['sturdy', 'wit', { body: 1, mind: 0 }, 'mail', null, true, 'half', 'standard'],
    skirmisher: ['middle', 'grace', { body: 1, mind: 0 }, 'light', null, false, null, 'light'],
    longshot: ['middle', 'grace', { body: 1, mind: 0 }, 'mail', null, false, 'half', 'ranged'],
    chorister: ['middle', 'charm', { body: 0, mind: 1 }, 'light', null, false, 'full', 'light'],
    weaver: ['light', 'charm', { body: 0, mind: 1 }, 'light', null, false, 'pact', 'standard'],
  };
  assert.deepEqual(callings.callings.map((c) => c.id), Object.keys(want));
  for (const c of callings.callings) {
    assert.deepEqual([c.build, c.key, c.resolve, c.armour, c.plateFrom, c.shield, c.charges, c.weapon], want[c.id], c.id);
    assertName(c.name, `${c.id}.name`);
    assert.deepEqual(Object.keys(c.levels), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], `${c.id} lists every level`);
    assert.ok(c.levels['3'].includes('path'), `${c.id} picks a path at 3`);
    for (const lv of ['4', '8', '12']) assert.ok(c.levels[lv].includes('boon'), `${c.id} picks a boon at ${lv}`);
  }
  assert.deepEqual(callings.callings.filter((c) => c.maxLevel === 12).map((c) => c.id), ['scrivener', 'tinker', 'skirmisher']);
  assert.deepEqual(callings.weaponArts, { light: 'tripping-cut', standard: 'pommel-tap', heavy: 'cleave', ranged: 'pinning-shot' });
  assert.deepEqual(callings.boons, ['ability-up', 'early-riser', 'good-boots', 'steady-hands']);
  assert.deepEqual(callings.items, ['cordial', 'brew-of-clear-morning']);
  assert.deepEqual(callings.gifts, { margin: 'margin-note', spare: 'spare-part' });
});

test('features by level equal §9.4 (levels 1, 2 and 5 for all nine; 6–12 for the three Wayfarer callings)', () => {
  const lv = (id, n) => callings.callings.find((c) => c.id === id).levels[String(n)].filter((x) => x !== 'path' && x !== 'boon');
  const want = {
    lanternkeeper: { 1: ['hooklight', 'raise-lantern', 'stand-in-my-light', 'mote', 'flare'], 2: ['scarf'], 5: ['the-lantern-calls'] },
    warden: { 1: ['draw-the-blow', 'hold-here', 'second-breath'], 2: ['surge'], 5: ['steady-second'], 10: ['unbroken'], 11: ['steady-third'] },
    mender: { 1: ['soothe', 'reach-out'], 2: ['still-water'], 5: [] },
    scrivener: { 1: ['pages', 'proofread'], 2: ['turn-back-a-page'], 5: [], 7: ['turn-back-a-page'], 9: [], 10: ['two-sustained'], 11: [] },
    tinker: { 1: ['bench-drone', 'drone-order', 'pop-up-cover', 'quick-fix'], 2: ['tune-ups'], 5: [], 7: ['pop-up-cover'], 10: ['two-drones'] },
    skirmisher: { 1: ['unseen-strike'], 2: ['slip'], 5: ['tuck-and-roll'], 7: ['quick-feet'], 10: ['swipe-strike'] },
    longshot: { 1: ['ready-a-shot', 'bead'], 2: ['read-the-ground'], 5: ['steady-second'], 7: ['volley'], 10: ['steady-aim'] },
    chorister: { 1: ['heartening-verse', 'hum-off-key', 'lullaby'], 2: ['hum-along'], 5: [], 10: ['last-verse'] },
    weaver: { 1: ['loose-thread', 'burn-an-essence'], 2: ['borrow-a-rule'], 5: [], 7: ['borrow-a-rule'] },
  };
  for (const [id, levels] of Object.entries(want)) for (const [n, ids] of Object.entries(levels)) assert.deepEqual(lv(id, n), ids, `${id} at ${n}`);
  // Circle 3 at 5 for the full and pact casters and circle 2 for the half casters come from the circles table, not a feature.
  assert.equal(callings.circles.full['5'], 3);
  assert.equal(callings.circles.half['5'], 2);
  // Data only above level 5 for the non-Wayfarer callings: what B's registry doesn't cover waits as a stub.
  for (const id of ['second-wick', 'tide-turns', 'volley', 'steady-aim', 'last-verse']) assert.equal(byId.get(id).stub, true, `${id} is a stub`);
});

// A transcription of COMBAT §5.4 and §6 (and §9.4–§9.5's Decided numbers). Each row lists costs,
// circle, range, area, uses, amounts and riders; `effects` rows must each match an effect (by its
// params) somewhere in the ability.
const B = (m) => ({ byLevel: m });
const TABLE = {
  // knacks
  mote: { costs: [1], attack: true, range: 8, effects: [['damage', { line: 'strike', kind: 'light' }]] },
  flare: { costs: [1], attack: true, range: 1, effects: [['damage', { line: 'strike', kind: 'light' }], ['move', { how: 'push', tiles: 1, min: 'hit' }]] },
  'loose-thread': { costs: [1], attack: true, range: 10, effects: [['damage', { line: 'strike', kind: 'caster', split: B({ 1: 1, 5: 2, 11: 3 }), frac: B({ 1: 1, 5: 0.6667, 11: 0.5 }) }]] },
  'full-stop': { costs: [1], attack: true, range: 8, effects: [['damage', { line: 'strike', kind: 'ink' }], ['mod', { stat: 'speed-next-stride', by: -2, min: 'hit' }]] },
  'hum-off-key': { costs: [1], attack: true, spoken: true, effects: [['damage', { line: 'strike' }], ['condition', { id: 'rattled', n: 1, min: 'hit' }]] },
  'ink-blot': { costs: [1], attack: true, range: 6, effects: [['damage', { line: 'strike', kind: 'ink' }], ['move', { how: 'push', tiles: 1 }]] },
  'little-light': { costs: [1], range: 6, effects: [['light', { radius: 2, rounds: 10 }]] },
  'steady-hand': { costs: [1], range: 1, effects: [['end-condition', { id: 'spooked' }], ['mod', { stat: 'reboot-cost', by: -1 }]] },
  // circle 1
  salve: { circle: 1, costs: [2], range: 1, effects: [['patch', { line: 'two' }]] },
  'kind-word': { circle: 1, costs: [1], range: 12, effects: [['patch', { line: 'one' }], ['end-condition', { id: 'spooked' }]] },
  'take-heart': { circle: 1, costs: [2], sustained: true, count: 3, effects: [['mod', { stat: 'edge-first-each-turn', by: 1 }]] },
  inkdarts: { circle: 1, costs: [2], cannotMiss: true, range: 8, effects: [['damage', { line: 'two', frac: [1, 3], split: 3 }]] },
  'sudden-shelter': { circle: 1, reaction: 'self-struck', effects: [['buffer', { amount: 'brace' }]] },
  lullaby: { circle: 1, costs: [2], meets: 'mind', area: ['burst', 2], effects: [['rule', { id: 'lullaby' }]] },
  tangleweed: { circle: 1, costs: [2], sustained: true, meets: 'body', area: ['square', 2], effects: [['condition', { id: 'tangled', n: 1, min: 'hit' }]] },
  // circle 2
  'hold-still': { circle: 2, costs: [2], sustained: true, meets: 'mind', range: 8, effects: [['condition', { id: 'slowed', n: 1, min: 'hit' }]] },
  'step-through-the-seam': { circle: 2, costs: [1], range: 6, effects: [['move', { how: 'teleport', tiles: 6 }]] },
  quiet: { circle: 2, costs: [2], sustained: true, meets: 'mind', area: ['burst', 2], effects: [['condition', { id: 'hushed' }]] },
  fogcloak: { circle: 2, costs: [2], sustained: true, area: ['burst', 1], effects: [['condition', { id: 'unseen' }]] },
  'clear-morning': { circle: 2, costs: [1], range: 6, effects: [['end-condition', { count: 1 }]] },
  // circles 3–5 (stubs)
  hearthburst: { circle: 3, costs: [3], stub: true, meets: 'body', area: ['burst', 2], effects: [['damage', { line: 'area', kind: 'light' }]] },
  'neon-line': { circle: 3, costs: [3], stub: true, meets: 'body', area: ['line', 8], effects: [['damage', { line: 'area' }]] },
  tidesong: { circle: 3, costs: [3], stub: true, range: 6, count: 4, effects: [['patch', { line: 'area' }]] },
  brisk: { circle: 3, costs: [2], stub: true, sustained: true, effects: [['condition', { id: 'brisk' }]] },
  'cross-it-out': { circle: 3, stub: true, reaction: 'spell-in-sight', effects: [['cancel', { maxCircle: 3 }]] },
  'send-home': { stub: true, costs: [2], meets: 'mind' },
  'candle-wall': { stub: true, costs: [2], sustained: true },
  'the-long-song': { stub: true, costs: [3], sustained: true, meets: 'mind', area: ['burst', 3], effects: [['condition', { id: 'drowsy', n: 1, min: 'hit' }]] },
  'rewrite-the-room': { stub: true, costs: [3] },
  // the Lanternkeeper
  hooklight: { rules: ['hooklight'] },
  'raise-lantern': { costs: [1], effects: [['rule', { id: 'raise-lantern' }]] },
  'stand-in-my-light': { reaction: 'hit-on-ally', reactionRange: 4, uses: ['campfire', B({ 1: 2, 5: 3, 9: 4 })], effects: [['rule', { id: 'stand-in-my-light' }]] },
  // Scarf pulls an ally, or a Small foe, 2 tiles toward him from up to 3 away (COMBAT §5.4).
  scarf: { costs: [1], range: 3, effects: [['move', { how: 'pull', tiles: 2, noSwipes: true }]], choice: {
    ally: { target: { who: 'ally', range: 3, need: [] }, effects: [['move', { who: 'target', how: 'pull', tiles: 2, noSwipes: true }]] },
    foe: { target: { who: 'foe', range: 3, need: ['small'] }, effects: [['move', { who: 'target', how: 'pull', tiles: 2, noSwipes: true }]] } } },
  'the-lantern-calls': { costs: [3], uses: ['campfire', 1], area: ['burst', 6], effects: [['rule', { id: 'lantern-calls' }]] },
  // §6.5 wayward-path: +1 Speed (the passive), and once a Breather a mote to a tile within 8 that he steps into.
  'wayward-path': { rules: ['wayward-path'] },
  'wayward-step': { costs: [1], uses: ['breather', 1], range: 8, effects: [['move', { who: 'self', how: 'teleport', tiles: 8 }]] },
  // the Warden
  'draw-the-blow': { reaction: 'strike-at-ally', reactionRange: 2, effects: [['rule', { id: 'draw-the-blow' }]] },
  'hold-here': { costs: [1], uses: ['breather', 1], meets: 'mind', area: ['burst', 2], effects: [['mark', { id: 'drawn', spend: 'attack', min: 'hit' }]] },
  'second-breath': { costs: [1], uses: ['breather', 1], effects: [['patch', { line: 'two' }]] },
  surge: { uses: ['breather', 1], effects: [['condition', { id: 'quickened' }]] },
  'steady-second': { rules: ['steady-second'] },
  // the Mender
  soothe: { costs: [1], range: 1, uses: ['target-round', 1], need: ['below-half'], effects: [['patch', { line: 'one' }]] },
  'reach-out': { costs: [1], range: 6, uses: ['breather', 2], effects: [['reboot', { frac: 0.25 }]] },
  'still-water': { costs: [2], uses: ['breather', 1], meets: 'mind', area: ['burst', 4], effects: [['condition', { id: 'spooked', n: 2, min: 'hit' }], ['rule', { id: 'settle-low' }]] },
  // the Scrivener
  proofread: { reaction: 'outcome-in-sight', uses: ['campfire', B({ 1: 2, 5: 3, 9: 4 })], effects: [['degree', { by: 1 }]] },
  'turn-back-a-page': { uses: ['campfire', B({ 2: 1, 7: 2 })] },
  'two-sustained': { rules: ['two-sustained'] },
  // the Tinker
  'bench-drone': { summons: ['drone'] },
  'drone-order': { costs: [1], effects: [['command', { device: 'drone', order: 'zap' }], ['command', { order: 'assist' }], ['command', { order: 'carry' }]] },
  'pop-up-cover': { costs: [1], uses: ['breather', B({ 1: 2, 7: 3 })], effects: [['summon', { template: 'pop-up-cover' }]] },
  // Quick fix: 1 action patches an ally beside you for the 1-action line, or 2 actions one within 6 for the 2-action line.
  'quick-fix': { costs: [1, 2], uses: ['campfire', 'wit'], per: {
    1: { target: { who: 'ally-or-self', range: 1, area: null }, effects: [['patch', { line: 'one' }]] },
    2: { target: { who: 'ally-or-self', range: 6, area: null }, effects: [['patch', { line: 'two' }]] } } },
  'tune-ups': { rules: ['tune-ups'] },
  'two-drones': { rules: ['two-drones'] },
  // the Skirmisher
  'unseen-strike': { rules: ['unseen-strike'] },
  slip: { costs: [1], effects: [['act', { action: 'stride', noSwipes: true }], ['act', { action: 'hide' }]] },
  'tuck-and-roll': { reaction: 'self-struck', effects: [['rule', { id: 'tuck-and-roll' }]] },
  'swipe-strike': { rules: ['swipe-strike'] },
  // the Longshot
  'ready-a-shot': { reaction: 'foe-moves-in-sight', effects: [['act', { action: 'strike' }]] },
  bead: { costs: [1], effects: [['mark', { id: 'bead', n: B({ 1: 2, 5: 4, 10: 6 }) }], ['condition', { id: 'singled-out' }]] },
  'read-the-ground': { rules: ['ignore-difficult'] },
  // the Chorister
  'heartening-verse': { costs: [1], range: 6, uses: ['campfire', 'charm'], effects: [['heat', { by: -20 }], ['mod', { stat: 'edge-next', by: B({ 1: 1, 10: 2 }) }]] },
  // Hum along at 2: allies within 6 have +1 mind Resolve (never above 2, which B's clamp keeps).
  'hum-along': { aura: { radius: 6, who: 'allies', mods: [['resolve-mind', 1, 'fight']] } },
  // the Weaver
  // B's burn-essence rule spends the essence itself (§6.5), so the feature doesn't `consume` one as
  // well (that spent two); `stitched-genre` keeps it for a Weaver who carries an essence.
  'burn-an-essence': { costs: [0], uses: ['campfire', 1], consumes: null, requires: ['stitched-genre'], effects: [['rule', { id: 'burn-essence' }]] },
  'borrow-a-rule': { costs: [2], uses: ['breather', B({ 2: 1, 7: 2 })], effects: [['summon', { template: 'decoy' }], ['condition', { id: 'beguiled', n: 2, min: 'hit' }],
    ['condition', { id: 'brisk' }], ['move', { how: 'swap' }], ['reveal', { what: 'unseen' }], ['rule', { id: 'first-in-tick' }], ['condition', { id: 'tumbled', min: 'hit' }]] },
  // weapon arts: once a Breather, a Strike whose rider lands with the Strike's degree
  'tripping-cut': { costs: [1], attack: true, uses: ['breather', 1], range: 1, effects: [['act', { action: 'strike' }], ['condition', { id: 'tumbled', min: 'hit' }]] },
  'pommel-tap': { costs: [1], attack: true, uses: ['breather', 1], range: 1, effects: [['act', { action: 'strike' }], ['condition', { id: 'dazed', n: 1, min: 'hit' }]] },
  cleave: { costs: [1], attack: true, uses: ['breather', 1], range: 1, effects: [['act', { action: 'strike' }], ['rule', { id: 'cleave' }]] },
  'pinning-shot': { costs: [1], attack: true, uses: ['breather', 1], range: 12, effects: [['act', { action: 'strike' }], ['condition', { id: 'tangled', n: 1, min: 'hit' }]] },
  // items and gifts
  // Drinking one is 1 action, and giving one to an ally beside you is 2 (COMBAT §6).
  cordial: { costs: [1, 2], consumes: 'cordial', effects: [['patch', { ofMax: 0.25 }]], per: {
    1: { target: { who: 'self', range: 0, area: null }, effects: [['patch', { ofMax: 0.25 }]] },
    2: { target: { who: 'ally', range: 1, area: null }, effects: [['patch', { ofMax: 0.25 }]] } } },
  'brew-of-clear-morning': { costs: [1, 2], consumes: 'brew', effects: [['end-condition', { count: 1 }]], per: {
    1: { target: { who: 'self', range: 0, area: null }, effects: [['end-condition', { count: 1 }]] },
    2: { target: { who: 'ally', range: 1, area: null }, effects: [['end-condition', { count: 1 }]] } } },
  'margin-note': { costs: [1], consumes: 'margin', range: 6, effects: [['end-condition', { class: 'bane', count: 1 }], ['patch', { line: 'one' }]] },
  'spare-part': { costs: [1], consumes: 'spare', effects: [['summon', { template: 'turret', rounds: 3 }]] },
  // boons
  'early-riser': { mods: [['initiative', 2]] },
  'good-boots': { mods: [['speed', 1]] },
  'steady-hands': { rules: ['steady-hands'] },
  // companion moves (§9.4)
  draft: { costs: [1], meets: 'mind', effects: [['end-condition', { class: 'boon', count: 1, min: 'hit' }]] },
  // Letter (COMBAT §3.4): 1 action patches an ally beside her for the 1-action line; 2 reach 6 tiles for
  // the 2-action line; 3 patch everyone within 2 tiles for the 3-action area line.
  letter: { costs: [1, 2, 3], per: {
    1: { target: { who: 'ally-or-self', range: 1, area: null }, effects: [['patch', { line: 'one' }]] },
    2: { target: { who: 'ally-or-self', range: 6, area: null }, effects: [['patch', { line: 'two' }]] },
    3: { target: { who: 'self', area: ['burst', 2, 'self'], hits: 'allies-and-self' }, effects: [['patch', { line: 'area' }]] } } },
  'being-sure': { costs: [1], effects: [['mod', { stat: 'degree-next-on-foe', by: 1 }], ['mod', { stat: 'degree-next-from-foe', by: -1 }]] },
  device: { costs: [2], uses: ['turn', 1], effects: [['summon', { template: 'turret' }], ['summon', { template: 'snare' }], ['summon', { template: 'patch-kit' }]] },
  verdict: { costs: [1], effects: [['mark', { id: 'that-pile', edge: 1, edgeHot: 2, hotAt: 60, until: 'end-of-next-round' }], ['mod', { stat: 'resolve-set', by: 2 }]] },
  'tollkeeper-toll': { rules: ['tollkeeper-toll'] },
  'riddle-me': { costs: [1], meets: 'mind', effects: [['mark', { id: 'drawn', spend: 'action', min: 'hit' }]] },
};

function variants(a) {
  if (a.by) return Object.values(a.by);
  if (a.choices) return Object.values(a.choices);
  if (a.target) return [{ target: a.target, effects: a.effects }];
  return [];
}
const subset = (want, got) => Object.entries(want).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));

/** One variant (a cost's `by` entry or a choice) against its row: the target's cells, then exactly its effects. */
function variantIs(where, got, want) {
  assert.ok(got, `${where} exists`);
  for (const [k, v] of Object.entries(want.target)) {
    const cell = k === 'area' && v ? [got.target.area?.shape, got.target.area?.size, got.target.area?.at] : got.target[k];
    assert.deepEqual(cell, v, `${where} target ${k}`);
  }
  assert.equal(got.effects.length, want.effects.length, `${where} has ${want.effects.length} effect(s)`);
  want.effects.forEach(([verb, params], i) => assert.ok(got.effects[i].do === verb && subset(params, got.effects[i]), `${where} effect ${i} is ${verb} ${JSON.stringify(params)}`));
}

test('every shipped spell, knack, calling feature, weapon art and item equals the transcription of COMBAT §5.4 and §6', () => {
  for (const [id, row] of Object.entries(TABLE)) {
    const a = byId.get(id);
    assert.ok(a, `${id} exists`);
    const vs = variants(a);
    const effects = vs.flatMap((v) => v.effects);
    if (row.costs) assert.deepEqual(a.costs, row.costs, `${id} costs`);
    if (row.circle !== undefined) assert.equal(a.circle, row.circle, `${id} circle`);
    for (const k of ['attack', 'cannotMiss', 'spoken', 'meets', 'consumes', 'stub']) if (row[k] !== undefined) assert.equal(a[k], row[k], `${id} ${k}`);
    if (row.sustained) assert.deepEqual(a.sustained, { max: 10 }, `${id} is sustained`);
    if (row.range !== undefined) assert.ok(vs.some((v) => v.target.range === row.range), `${id} range ${row.range}`);
    if (row.count !== undefined) assert.ok(vs.some((v) => v.target.count === row.count), `${id} count ${row.count}`);
    if (row.need) assert.ok(vs.some((v) => JSON.stringify(v.target.need) === JSON.stringify(row.need)), `${id} needs ${row.need}`);
    if (row.requires) assert.deepEqual(a.requires, row.requires, `${id} requires`);
    if (row.area) assert.ok(vs.some((v) => v.target.area?.shape === row.area[0] && v.target.area?.size === row.area[1]), `${id} area ${row.area}`);
    if (row.uses) assert.deepEqual([a.uses?.per, a.uses?.n], row.uses, `${id} uses`);
    if (row.reaction) assert.equal(a.reaction?.when, row.reaction, `${id} reacts to ${row.reaction}`);
    if (row.reactionRange) assert.equal(a.reaction?.range, row.reactionRange, `${id} reaction range`);
    if (row.rules) assert.deepEqual(a.passive?.rules, row.rules, `${id} rules`);
    if (row.summons) assert.deepEqual(a.passive?.summons.map((s) => s.template), row.summons, `${id} summons`);
    if (row.mods) assert.deepEqual(a.passive?.mods.map((m) => [m.stat, m.by]), row.mods, `${id} mods`);
    for (const [verb, params] of row.effects || []) {
      assert.ok(effects.some((e) => e.do === verb && subset(params, e)), `${id} has ${verb} ${JSON.stringify(params)}`);
    }
    // Each action count's own range, area and effect, and each choice's own target.
    if (row.per) {
      assert.deepEqual(Object.keys(a.by || {}), a.costs.map(String), `${id} has a variant for each cost`);
      for (const [cost, want] of Object.entries(row.per)) variantIs(`${id} at ${cost} action(s)`, a.by[cost], want);
    }
    if (row.choice) {
      assert.deepEqual(Object.keys(a.choices || {}), Object.keys(row.choice), `${id}’s choices`);
      for (const [key, want] of Object.entries(row.choice)) variantIs(`${id}’s ${key} choice`, a.choices[key], want);
    }
    if (row.aura) {
      const aura = a.passive?.aura;
      assert.deepEqual([aura?.radius, aura?.who], [row.aura.radius, row.aura.who], `${id} aura`);
      assert.deepEqual(aura.mods.map((m) => [m.stat, m.by, m.until]), row.aura.mods, `${id} aura mods`);
    }
  }
  // The knacks and spells of §9.5, shipped in full, and the stubs.
  const shipped = ['mote', 'flare', 'loose-thread', 'full-stop', 'hum-off-key', 'ink-blot', 'little-light', 'steady-hand', 'salve', 'kind-word', 'take-heart',
    'inkdarts', 'sudden-shelter', 'lullaby', 'tangleweed', 'hold-still', 'step-through-the-seam', 'quiet', 'fogcloak', 'clear-morning'];
  const stubs = ['hearthburst', 'neon-line', 'tidesong', 'brisk', 'cross-it-out', 'send-home', 'candle-wall', 'the-long-song', 'rewrite-the-room'];
  assert.deepEqual(spells.spells.map((s) => s.id), [...shipped, ...stubs]);
  for (const id of shipped) assert.equal(byId.get(id).stub, false, `${id} ships`);
  for (const id of stubs) assert.ok(byId.get(id).stub && byId.get(id).circle >= 3, `${id} is a circle 3–5 stub`);
  for (const s of spells.spells.filter((x) => x.circle === 0)) assert.equal(s.kind, 'knack', `${s.id} is a knack`);
});

test('the devices’ numbers come from rules.json: Pop-up cover 10 + 2 × level, the Bench drone 5 × level', (t) => {
  if (!rules?.devices) { t.skip('rules.json has no devices table yet'); return; }
  assert.equal(rules.devices['pop-up-cover'].integrity, 10);
  assert.equal(rules.devices['pop-up-cover'].perLevel, 2);
  assert.equal(rules.devices.drone.integrity, 5);
  assert.match(byId.get('pop-up-cover').text, /10 plus 2 a level/);
  assert.match(byId.get('bench-drone').text, /5 Integrity a level/);
});

test('every id one of C’s files names resolves', () => {
  const pathIds = new Set(callings.paths.map((p) => p.id));
  for (const c of callings.callings) {
    for (const [lv, list] of Object.entries(c.levels)) for (const id of list) {
      if (id === 'path' || id === 'boon') continue;
      assert.ok(byId.has(id), `${c.id} level ${lv} names ${id}`);
    }
    for (const id of c.spells) assert.ok(byId.has(id) && byId.get(id).kind === 'knack' || byId.get(id)?.kind === 'spell', `${c.id}’s spell ${id}`);
  }
  for (const p of callings.paths) {
    assert.ok(callings.callings.some((c) => c.id === p.calling), `${p.id}’s calling`);
    assert.ok(COMPANION_IDS.includes(p.companion), `${p.id}’s companion`);
    for (const list of Object.values(p.levels)) for (const id of list) assert.ok(byId.has(id), `${p.id} names ${id}`);
    assert.ok(Math.abs(p.heat) <= 10, `${p.id} shifts idle heat by at most 10`);
  }
  for (const id of [...Object.values(callings.weaponArts), ...callings.boons, ...callings.items, ...Object.values(callings.gifts)]) assert.ok(byId.has(id), id);
  for (const [id, c] of Object.entries(companions)) {
    for (const p of c.paths) assert.ok(pathIds.has(p), `${id}’s path ${p}`);
    for (const m of c.moves) assert.ok(byId.has(m), `${id}’s move ${m}`);
    if (c.heartFeat) assert.equal(byId.get(c.heartFeat)?.from, 'Fireside warmth', `${id}’s heart feat is a stub`);
  }
  for (const id of [...Object.values(regulars.signatures), ...Object.values(regulars.tricks)]) assert.ok(byId.has(id), id);
});

test('all fifteen companion files exist with the fields §9.6 asks for, and none carries idle heat', () => {
  assert.deepEqual(Object.keys(companions).sort(), [...COMPANION_IDS].sort());
  const PERSONALITIES = ['careful', 'bold', 'steady', 'quick', 'guarding', 'talker', 'patcher'];
  const FIELD_SKILLS = ['light', 'read', 'pick', 'sort', 'hear', 'riddle', 'heave', 'unfold', 'track', 'investigate', 'jack-in', 'nightsight', 'stonespeak', 'tideread', 'pass-through'];
  for (const [id, c] of Object.entries(companions)) {
    assert.equal(c.id, id);
    for (const k of ['name', 'pronoun', 'calling', 'paths', 'joins', 'service', 'fieldSkill', 'damageKind', 'examine']) assert.ok(c[k] !== undefined && c[k] !== null, `${id}.${k}`);
    assert.ok(!Object.hasOwn(c, 'idleHeat'), `${id} carries no idle heat (it’s rules.json’s)`);
    assert.ok(callings.callings.some((k) => k.id === c.calling), `${id}’s calling`);
    assert.ok(KINDS_OF_DAMAGE.includes(c.damageKind), `${id}’s damage kind`);
    assert.ok(PERSONALITIES.includes(c.personality), `${id}’s personality`);
    assert.ok(FIELD_SKILLS.includes(c.fieldSkill), `${id}’s field skill`);
    assert.ok(['he', 'she', 'they', 'it'].includes(c.pronoun), `${id}’s pronoun`);
    assert.equal(c.paths.length, id === 'milo' ? 3 : 2, `${id}’s paths`);
    if (rules) assert.ok(Number.isFinite(rules.heat.companions[id]), `rules.json has ${id}’s idle heat`);
  }
  for (const id of ['milo', 'claude', 'codex', 'jev']) assert.equal(companions[id].joins.how, 'start');
  assert.deepEqual(companions.tollkeeper.joins, { phase: 4, how: 'trail', trail: 'first-trail' });
  for (const id of COMPANION_IDS.slice(5)) {
    assert.ok(companions[id].joins.phase > 4, `${id} joins after Phase 4`);
    assert.ok(['rift', 'hearth', 'story', 'bell'].includes(companions[id].joins.how), `${id} joins by ${companions[id].joins.how}`);
    // Everyone who joins by Phase 6 fights now: their moves are real and only their heart feats wait. Everyone later is still a stub.
    const phase6 = companions[id].joins.phase <= 6;
    for (const a of companions[id].abilityDefs) assert.equal(a.stub, phase6 ? a.id === companions[id].heartFeat : true, `${id}’s ${a.id} is ${phase6 && a.id !== companions[id].heartFeat ? 'real' : 'a stub'}`);
  }
  // The Scribe's own reaction defaults (COMBAT §3.7 plays her Shoulder on Always).
  assert.deepEqual(companions.claude.reactions, { shoulder: 'always', proofread: 'ask' });
  // Ability spreads are +3/+2/+2/+1/+0/−1 as set per character (§4.11); Milo's are canon.
  assert.deepEqual(companions.milo.abilities, { might: -1, grace: 2, grit: 2, wit: 0, heed: 3, charm: 1 });
  for (const c of [...Object.values(companions), ...Object.entries(regulars.spreads).map(([id, abilities]) => ({ id: `regular ${id}`, abilities }))]) {
    assert.deepEqual(Object.keys(c.abilities).sort(), ['charm', 'grace', 'grit', 'heed', 'might', 'wit'], `${c.id} has all six abilities`);
    assert.deepEqual(Object.values(c.abilities).sort((a, b) => b - a), [3, 2, 2, 1, 0, -1], `${c.id}’s spread is +3/+2/+2/+1/+0/−1`);
  }
  // The key ability of each named companion's calling is +3.
  for (const c of Object.values(companions)) {
    const calling = callings.callings.find((k) => k.id === c.calling);
    assert.equal(c.abilities[calling.key], 3, `${c.id}’s key ability is +3`);
  }
});

test('Jev never speaks anywhere: gestures for barks, pictures for thoughts, no lines in talks, scenes or banter', () => {
  const jev = companions.jev;
  assert.equal(jev.pronoun, 'it');
  assert.equal(jev.voice, 'pictures');
  for (const bark of jev.barks) {
    assert.ok(!Object.hasOwn(bark, 'say'), 'no bark says anything');
    assertGesture(bark.does, 'jev bark', { proper: PROPER });
  }
  for (const [path, value] of strings(jev)) assert.ok(!/(^|\.)say$/.test(path), `jev.json has no say (${path}: ${value})`);
  for (const scene of scenes.scenes) for (const line of scene.lines) {
    if (line.speaker === 'jev') assert.fail(`${scene.id} gives Jev a line`);
  }
  for (const b of banter.banter) for (const line of b.lines) assert.ok(line.speaker !== 'jev', `${b.id} gives Jev a line`);
  for (const file of TALK_FILES) {
    const talk = parseTalk(talkText(file));
    for (const node of Object.values(talk.nodes)) for (const line of node.lines) assert.notEqual(line.speaker, 'jev', `${file} gives Jev a line`);
  }
  assert.throws(() => parseTalk('---\nid: x\nwith: none\nonce: true\n---\n# a\nJev: hello.\n> Ok. [end]\n'), /line 7: Jev never speaks/);
});

test('every name is in LORE §21 or C’s pending list', () => {
  const index = loreIndex();
  const known = new Set(Object.values(index).flat());
  const people = loreIndex({ raw: true }).People;
  const pending = new Set(PENDING_NAMES.map(normaliseName));
  const ok = (name) => known.has(normaliseName(name)) || pending.has(normaliseName(name));
  const names = [
    ...ABILITIES.map((a) => a.name), ...callings.paths.map((p) => p.name), ...callings.callings.map((c) => c.name),
    ...teamups.teamups.map((t) => t.name),
  ];
  for (const c of Object.values(companions)) {
    if (c.quest) names.push(c.quest.name);
    if (c.likeness) names.push(c.likeness.name);
    for (const t of c.titles) names.push(t.title);
    // A companion's short name is a person's name in the index ("Dusty" of "Sheriff Dusty Calloway").
    assert.ok(ok(c.name) || people.some((p) => new RegExp(`\\b${c.name}\\b`).test(p)), `${c.id}’s name “${c.name}” is in LORE §21`);
    if (c.fullName) assert.ok(ok(c.fullName), `${c.id}’s full name “${c.fullName}” is in LORE §21`);
  }
  const missing = [...new Set(names)].filter((n) => !ok(n));
  assert.deepEqual(missing, [], 'every name is in LORE §21 or PENDING_NAMES');
  for (const n of names) assertName(n, `name ${n}`);
});

const PROSE = new Set(['text', 'about', 'service', 'sleeps', 'lives', 'look', 'say', 'reply']);

test('every string a player reads is calm, cosy and our own words', () => {
  const files = { callings, spells, regulars, teamups, banter, scenes, ...Object.fromEntries(Object.entries(companions).map(([id, c]) => [`companions/${id}`, c])) };
  let checked = 0;
  for (const [name, file] of Object.entries(files)) {
    for (const [path, text] of strings(file)) {
      assertOwnWords(text, `${name}.${path}`);
      assertCosy(text, `${name}.${path}`);
      const key = path.split('.').pop().replace(/\[\d+\]$/, '');
      if (key === 'examine' || path.includes('.examine[')) {
        assertCalm(text, `${name}.${path}`, { proper: PROPER });
        assert.ok(text.length <= 120, `${name}.${path} is at most 120 characters`);
        checked += 1;
      } else if (PROSE.has(key)) {
        assertCalm(text, `${name}.${path}`, { proper: PROPER });
        checked += 1;
      } else if (key === 'gesture' || key === 'does') {
        assertGesture(key === 'does' ? text : `(${text})`, `${name}.${path}`, { proper: PROPER });
        checked += 1;
      }
    }
  }
  for (const c of Object.values(companions)) assert.ok(c.examine.length >= 3, `${c.id} has at least 3 examine lines`);
  assert.ok(checked > 250, `checked ${checked} strings`);
});

test('talks parse, read calmly, and keep their promises', () => {
  for (const file of TALK_FILES) {
    const talk = parseTalk(talkText(file));
    assert.equal(`${talk.id}.md`, file, 'a talk’s id is its file name');
    for (const node of Object.values(talk.nodes)) {
      for (const line of node.lines) {
        if (line.text) assertCalm(line.text, `${file} line`, { proper: PROPER });
        if (line.gesture) assertCalm(line.gesture, `${file} stage direction`, { proper: PROPER });
      }
      for (const c of node.choices) {
        assertCalm(c.text, `${file} choice`, { proper: PROPER });
        if (c.reply) assertCalm(c.reply, `${file} reply`, { proper: PROPER });
        for (const r of c.needs) assertCalm(r.words, `${file} requirement`, { proper: PROPER });
      }
    }
  }
  const riddles = parseTalk(talkText('tollkeeper-riddles.md'));
  assert.equal(riddles.with, 'tollkeeper');
  assert.deepEqual(Object.keys(riddles.nodes), ['first', 'second', 'third'], 'three riddles');
  const joins = Object.values(riddles.nodes).flatMap((n) => n.choices).filter((c) => c.join);
  assert.equal(joins.length, 1);
  assert.equal(joins[0].join, 'tollkeeper');
  assert.ok(joins[0].id.startsWith('third.'), 'the third right answer carries the join');
  const first = parseTalk(talkText('first-night.md'));
  assert.ok(Object.values(first.nodes).flatMap((n) => n.choices).some((c) => c.needs.some((r) => r.kind === 'with' && r.id === 'jev')), 'first-night has a choice with Jev');
});

test('regulars take their calling from archetype, a signature per fighting genre, and a once-a-fight trick', () => {
  assert.deepEqual(regulars.callingByArchetype, { construct: 'warden', crawler: 'skirmisher', flier: 'longshot', ghost: 'mender', floater: 'weaver', walker: 'chorister' });
  assert.deepEqual(Object.keys(regulars.personalityByTemperament).sort(), ['curious', 'dramatic', 'grumpy', 'lost', 'nosy', 'polite', 'proud', 'shy', 'sleepy']);
  const fighting = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];
  assert.deepEqual(Object.keys(regulars.signatures), fighting);
  for (const g of fighting) {
    const trick = byId.get(regulars.tricks[g]);
    assert.equal(regulars.tricks[g], `${regulars.signatures[g]}-trick`);
    assert.deepEqual(trick.uses, { per: 'fight', n: 1 }, `${g}’s trick is once a fight`);
  }
  assert.equal(regulars.ask[0], 'Can I sit by the fire a while?');
  assert.equal(regulars.noRoom[0], 'Another time, then.');
  for (const line of [...regulars.ask, ...regulars.noRoom]) assertCalm(line, 'regulars line');
  assert.deepEqual(Object.keys(regulars.spreads).sort(), ['chorister', 'longshot', 'mender', 'skirmisher', 'warden', 'weaver']);
});

// §9.6 (Decided): a trick is its signature's effects at +1 degree, once a fight. The mod lasts only
// until the trick's own action ends (`next-action`): a `next-effect` one outlived a trick that caught
// no foe (it picked nothing) and lifted the regular's next attack instead.
const SURE = { do: 'mod', stat: 'degree-next-on-foe', by: 1, until: 'next-action', to: 'self' };
const TRICK_OWN = ['id', 'name', 'words', 'text', 'uses', 'target', 'effects'];

test('each trick is exactly its signature at +1 degree: one degree better on its own pick, or twice as big when automatic', () => {
  for (const [g, sigId] of Object.entries(regulars.signatures)) {
    const sig = byId.get(sigId);
    const trick = byId.get(regulars.tricks[g]);
    for (const k of FIELDS.filter((f) => !TRICK_OWN.includes(f))) assert.deepEqual(trick[k], sig[k], `${trick.id}.${k} is the signature’s`);
    assert.equal(trick.cannotMiss, false, `${trick.id}: never cannotMiss as well, or a Miss would climb two degrees`);
    if (sig.outcome) {
      // Being sure's mod on itself, first: Miss → Graze, Graze → Hit, Hit → Critical on its own pick.
      assert.deepEqual(trick.effects, [SURE, ...sig.effects], `${trick.id} leads with the +1 degree and then does what ${sig.id} does`);
      assert.deepEqual(trick.target, sig.target, `${trick.id} targets as ${sig.id} does`);
      assert.equal(trick.text, 'Its genre signature, once a fight and one degree better.');
    } else {
      // An automatic signature lands as a Hit, so +1 degree is a Critical: every number doubles.
      assert.equal(trick.effects.length, sig.effects.length, `${trick.id} has ${sig.id}’s effects`);
      sig.effects.forEach((e, i) => {
        const t = trick.effects[i];
        assert.deepEqual(Object.keys(t), Object.keys(e), `${trick.id} effect ${i} has the same fields`);
        for (const k of Object.keys(e)) {
          const doubles = typeof e[k] === 'number' && (k === 'tiles' || k === 'by');
          assert.deepEqual(t[k], doubles ? e[k] * 2 : e[k], `${trick.id} effect ${i}.${k}`);
        }
        assert.ok(!Object.keys(e).some((k) => typeof e[k] === 'number' && !['tiles', 'by'].includes(k)), `${sig.id}: every number is one that doubles`);
      });
      const range = sig.target.who === 'tile' ? sig.target.range * 2 : sig.target.range;
      assert.deepEqual(trick.target, { ...sig.target, range }, `${trick.id} reaches its doubled tile`);
      assert.equal(trick.text, 'Its genre signature, once a fight and twice as big.');
    }
  }
  // Transcribed: the three automatic ones, twice as big.
  assert.deepEqual(byId.get('into-the-shadows-trick').effects, [{ do: 'move', who: 'self', how: 'step', tiles: 2, into: 'dim' }, { do: 'act', action: 'hide' }]);
  assert.deepEqual(byId.get('clock-in-trick').effects, [{ do: 'heat', by: -20 }, { do: 'mod', stat: 'edge-next', by: 2, until: 'next-action' }]);
  // Clock in's edge is for "their next action": on its own user it would end with the action that gave it.
  for (const id of ['clock-in', 'clock-in-trick']) assert.equal(byId.get(id).target.who, 'ally', `${id} is for an ally, as its words say`);
  assert.deepEqual(byId.get('fold-in-trick').effects, [{ do: 'move', who: 'self', how: 'teleport', tiles: 8 }]);
  assert.equal(byId.get('fold-in-trick').target.range, 8);
});

// §6.5's registry: rules an ability *does* (an effect) and rules a passive *has*. An effect naming a
// passive's rule does nothing in the kernel (Wayward step once did exactly that).
const ACTION_RULES = ['raise-lantern', 'stand-in-my-light', 'lantern-calls', 'draw-the-blow', 'settle-low', 'lullaby', 'tuck-and-roll', 'first-in-tick',
  'burn-essence', 'cleave'];

test('every rule an effect names is one the kernel acts on, and every passive’s rule is a standing one', () => {
  const effectsOf = (a) => [...variants(a).flatMap((v) => v.effects || []), ...(a.crit || [])];
  // Stubs never act in Phase 4 (Jev's Snap judgement, a heart feat from Fireside warmth, is data only).
  for (const a of ABILITIES.filter((x) => !x.stub)) {
    for (const e of effectsOf(a).filter((x) => x.do === 'rule')) assert.ok(ACTION_RULES.includes(e.id), `${a.id}’s effect names ${e.id}, a standing rule`);
    for (const r of a.passive?.rules || []) assert.ok(RULE_IDS.includes(r) && !ACTION_RULES.includes(r), `${a.id}’s passive names ${r}`);
  }
});

test('camp scenes: an arrival for each Phase 4 companion and a regular, and each one’s camp scene at Acquaintance', () => {
  const arrivals = scenes.scenes.filter((s) => s.when === 'arrival').map((s) => s.who);
  assert.deepEqual(arrivals, ['claude', 'codex', 'jev', 'tollkeeper', 'regular']);
  for (const id of ['claude', 'codex', 'jev', 'tollkeeper']) {
    const own = scenes.scenes.find((s) => s.who === id && s.when === 'night');
    assert.ok(own, `${id} has a camp scene`);
    assert.equal(own.needs, `warmth ${id} 10`, `${id}’s scene opens at Acquaintance`);
  }
  for (const s of scenes.scenes) {
    assert.ok(['arrival', 'rain', 'night', 'dawn'].includes(s.when), `${s.id}.when`);
    assert.ok(s.who === 'regular' || COMPANION_IDS.includes(s.who), `${s.id}.who`);
    for (const line of s.lines) if (line.speaker) assert.ok(line.speaker === 'regular' || COMPANION_IDS.includes(line.speaker), `${s.id} speaker ${line.speaker}`);
  }
});

// A rough price for a path feature, in 1-action lines a round: what it patches or deals (by its
// line and fraction, times its pieces and targets), or a nominal worth for an edge, a condition
// or a mark, scaled by how often it can be used (a Breather ~ every 3 rounds, a Campfire ~ 6, a fight ~ 4).
function perRound(a) {
  const often = { turn: 1, round: 1, 'target-round': 1, breather: 1 / 3, campfire: 1 / 6, fight: 1 / 4 }[a.uses?.per] ?? 1;
  const LINE = { one: 1, strike: 1.4, two: 2.4, three: 3.6, area: 2.6 };
  let worth = 0;
  for (const v of variants(a)) {
    const targets = v.target.area ? 2 : v.target.count;
    for (const e of v.effects) {
      const frac = Array.isArray(e.frac) ? e.frac[0] / e.frac[1] : typeof e.frac === 'number' ? e.frac : 1;
      if (e.do === 'patch' || e.do === 'damage') worth += e.ofMax ? 1 : LINE[e.line] * frac * (e.split || 1) * targets;
      else if (e.do === 'condition') worth += (e.n || 1) * 0.6 * targets;
      else if (e.do === 'summon') worth += 0.8;
      else if (e.do === 'mark' || e.do === 'mod' || e.do === 'reveal' || e.do === 'move' || e.do === 'end-condition') worth += 0.3 * targets;
    }
  }
  for (const m of a.passive?.mods || []) worth += 0.4;
  if (a.passive?.aura) worth += 0.3 * a.passive.aura.mods.length * (a.passive.aura.who === 'foes' ? 2 : 2);
  worth += (a.passive?.summons || []).length * 0.2;
  return worth * often;
}

test('each path feature is worth at most about one 1-action line a round', () => {
  const PATHS = ['three-pens', 'footnote', 'bench', 'slate', 'gavel', 'courier', 'bridge', 'troll-kin'];
  for (const pid of PATHS) {
    const path = callings.paths.find((p) => p.id === pid);
    for (const id of Object.values(path.levels).flat()) {
      const a = byId.get(id);
      assert.ok(a.name === path.name || a.name.startsWith(`${path.name}: `), `${id} is named by its path (${a.name})`);
      const worth = perRound(a);
      assert.ok(worth <= 1.25, `${id} is worth about ${worth.toFixed(2)} of a 1-action line a round`);
    }
  }
});

// §15: the content suites (C's, D's and E's) together take at most 1.5 s. C's share is timed here
// as the work its checks do (read and parse every file, both §6 checks, every calm check, every
// talk), with a warm-up and the median of five, against a third of the budget.
test('C’s content checks fit their share of §15’s 1.5 s for the content suites (median of 5, after a warm-up)', async () => {
  const { validateAbility } = await import('../src/combat/effects.js');
  const once = () => {
    const files = {
      callings: read('combat/callings.json'), spells: read('combat/spells.json'), regulars: read('party/regulars.json'),
      teamups: read('party/teamups.json'), banter: read('party/banter.json'), scenes: read('camp/scenes.json'),
      ...Object.fromEntries(COMPANION_IDS.map((id) => [`companions/${id}`, read(`party/companions/${id}.json`)])),
    };
    const all = [...files.callings.abilities, ...files.spells.spells, ...COMPANION_IDS.flatMap((id) => files[`companions/${id}`].abilityDefs || []), ...files.regulars.abilityDefs];
    for (const a of all) assert.deepEqual([...validate(a), ...validateAbility(a)], [], a.id);
    for (const [name, file] of Object.entries(files)) {
      for (const [path, text] of strings(file)) {
        assertOwnWords(text, `${name}.${path}`);
        assertCosy(text, `${name}.${path}`);
        if (PROSE.has(path.split('.').pop().replace(/\[\d+\]$/, ''))) assertCalm(text, `${name}.${path}`, { proper: PROPER });
      }
    }
    for (const f of TALK_FILES) parseTalk(talkText(f));
  };
  once();
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    once();
    times.push(performance.now() - t0);
  }
  const median = times.sort((p, q) => p - q)[2];
  assert.ok(median <= 500, `C’s content checks took ${median.toFixed(1)} ms (median), over 500`);
});
