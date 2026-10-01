// Shared fixtures for the combat kernel's tests (module B, CONTRACT-PHASE4.md §13 wave 1): the
// real rules.json, fixed level-1 blocks (Milo, the Scribe, the Artificer, Pip and strays), B's own
// stand-in abilities written in §6's language, arenas drawn as text, and a ctx with stub minds.
// Not a test file (no test() calls); combat-*.test.js import it.
import { readFileSync, readdirSync } from 'node:fs';
import { loadRules } from '../src/combat/rules.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { stubMinds } from '../src/combat/driver.js';
import { createBattle, apply } from '../src/combat/battle.js';
import { hashInts } from '../src/world/rng.js';

export const RULES_JSON = JSON.parse(readFileSync(new URL('../content/combat/rules.json', import.meta.url), 'utf8'));
export const rules = loadRules(RULES_JSON);
export const GENRES = JSON.parse(readFileSync(new URL('../content/genres.json', import.meta.url), 'utf8')).genres.map((g) => g.id);

/** An Ability with §6.1's defaults filled in. */
export function ab(partial) {
  const named = partial.id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return {
    id: partial.id, name: partial.name || named, kind: 'move', circle: 0, attack: false, big: false, consumes: null, meets: null,
    helpful: false, cannotMiss: false, outcome: true, spoken: false, costs: [1], uses: null, sustained: null, requires: [], reaction: null,
    passive: null, choices: null, by: null, target: null, effects: null, crit: [], upcast: false,
    words: (partial.name || partial.id).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    text: 'A test ability.', stub: false, from: null, ...partial,
  };
}

const passive = (id, p) => ab({ id, kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: [], summons: [], ...p } });

/** B's stand-in abilities (C, D and I write the real ones). */
export const ABILITIES = [
  passive('hooklight', { rules: ['hooklight'] }),
  ab({ id: 'raise-lantern', kind: 'feature', target: { who: 'self', range: 0 }, effects: [{ do: 'rule', id: 'raise-lantern' }], outcome: false }),
  ab({ id: 'mote', kind: 'knack', attack: true, meets: 'guard', target: { who: 'foe', range: 8 }, effects: [{ do: 'damage', line: 'strike', kind: 'caster' }] }),
  ab({ id: 'flare', kind: 'knack', attack: true, meets: 'guard', target: { who: 'foe', range: 1 }, effects: [{ do: 'damage', line: 'strike', kind: 'caster' }, { do: 'move', how: 'push', tiles: 1, min: 'hit' }] }),
  ab({ id: 'stand-in-my-light', kind: 'reaction', costs: [], reaction: { when: 'hit-on-ally', range: 4 }, uses: { per: 'campfire', n: 2 }, effects: [{ do: 'rule', id: 'stand-in-my-light' }] }),
  ab({ id: 'the-lantern-calls', kind: 'feature', costs: [3], uses: { per: 'campfire', n: 1 }, target: { who: 'none', range: 0 }, outcome: false, effects: [{ do: 'rule', id: 'lantern-calls' }] }),
  ab({
    id: 'letter', kind: 'move', helpful: true, costs: [1, 2, 3],
    by: {
      1: { target: { who: 'ally', range: 1 }, effects: [{ do: 'patch', line: 'one' }] },
      2: { target: { who: 'ally-or-self', range: 6 }, effects: [{ do: 'patch', line: 'two' }] },
      3: { target: { who: 'self', range: 0, area: { shape: 'burst', size: 2, at: 'self' }, hits: 'allies-and-self' }, effects: [{ do: 'patch', line: 'area' }] },
    },
  }),
  ab({ id: 'draft', kind: 'move', meets: 'mind', target: { who: 'foe', range: 6 }, effects: [{ do: 'end-condition', class: 'boon', count: 1, min: 'hit' }] }),
  ab({ id: 'being-sure', kind: 'move', helpful: true, outcome: false, target: { who: 'ally-or-self', range: 6 }, effects: [{ do: 'mod', stat: 'degree-next-on-foe', by: 1, until: 'next-effect' }] }),
  ab({ id: 'proofread', kind: 'reaction', costs: [], reaction: { when: 'outcome-in-sight', range: 12 }, uses: { per: 'campfire', n: 2 }, effects: [{ do: 'degree', by: 1 }] }),
  ab({ id: 'full-stop', kind: 'knack', attack: true, meets: 'guard', target: { who: 'foe', range: 8 }, effects: [{ do: 'damage', line: 'strike', kind: 'ink' }, { do: 'mod', stat: 'speed-next-stride', by: -2, until: 'next-stride', min: 'hit' }] }),
  ab({ id: 'inkdarts', kind: 'spell', circle: 1, cannotMiss: true, costs: [2], meets: 'guard', target: { who: 'foe', range: 8 }, upcast: true, effects: [{ do: 'damage', line: 'two', frac: [1, 3], kind: 'ink', split: 3 }] }),
  passive('bench-drone', { summons: [{ template: 'drone', at: 'fight-start' }] }),
  ab({ id: 'drone-zap', kind: 'feature', target: { who: 'foe', range: 6 }, outcome: false, requires: ['has-device'], effects: [{ do: 'command', device: 'drone', order: 'zap' }] }),
  ab({ id: 'pop-up-cover', kind: 'feature', uses: { per: 'breather', n: 2 }, target: { who: 'tile', range: 3 }, outcome: false, effects: [{ do: 'summon', template: 'pop-up-cover' }] }),
  ab({
    id: 'device', kind: 'move', costs: [2], outcome: false, uses: { per: 'turn', n: 1 },
    choices: {
      turret: { words: 'Turret', target: { who: 'tile', range: 2 }, effects: [{ do: 'summon', template: 'turret' }] },
      snare: { words: 'Snare', target: { who: 'tile', range: 3 }, effects: [{ do: 'summon', template: 'snare' }] },
      'patch-kit': { words: 'Patch kit', target: { who: 'tile', range: 2 }, effects: [{ do: 'summon', template: 'patch-kit' }] },
    },
  }),
  ab({ id: 'pounce', kind: 'move', costs: [2], target: { who: 'foe', range: 7 }, effects: [{ do: 'act', action: 'stride' }, { do: 'act', action: 'strike' }, { do: 'condition', id: 'tumbled', min: 'hit' }] }),
  ab({ id: 'spooky-touch', kind: 'move', target: { who: 'foe', range: 1 }, effects: [{ do: 'act', action: 'strike' }, { do: 'condition', id: 'spooked', n: 1, min: 'hit' }] }),
  ab({ id: 'glitch-slash', kind: 'move', big: true, attack: true, meets: 'guard', target: { who: 'foe', range: 1 }, effects: [{ do: 'damage', line: 'stray', frac: 1.5, kind: 'static' }] }),
  ab({ id: 'cordial', name: 'Hearthberry cordial', kind: 'item', helpful: true, consumes: 'cordial', costs: [1, 2], by: { 1: { target: { who: 'self', range: 0 }, effects: [{ do: 'patch', ofMax: 0.25 }] }, 2: { target: { who: 'ally', range: 1 }, effects: [{ do: 'patch', ofMax: 0.25 }] } } }),
  ab({ id: 'brew-of-clear-morning', name: 'Brew of clear morning', kind: 'item', helpful: true, outcome: false, consumes: 'brew', costs: [1, 2], by: { 1: { target: { who: 'self', range: 0 }, effects: [{ do: 'end-condition', class: 'bane', count: 1 }] }, 2: { target: { who: 'ally', range: 1 }, effects: [{ do: 'end-condition', class: 'bane', count: 1 }] } } }),
  ab({ id: 'margin-note', kind: 'item', helpful: true, consumes: 'margin', target: { who: 'ally-or-self', range: 6 }, effects: [{ do: 'end-condition', class: 'bane', count: 1 }, { do: 'patch', line: 'one' }] }),
  ab({ id: 'spare-part', kind: 'item', outcome: false, consumes: 'spare', target: { who: 'tile', range: 2 }, effects: [{ do: 'summon', template: 'turret', rounds: 3 }] }),
  ab({ id: 'pinch', kind: 'move', outcome: false, target: { who: 'foe', range: 1 }, effects: [{ do: 'take', item: 'cordial' }] }),
  // Written like C's weapon arts, Volley, Ready a shot and "-trick" moves, and a line from the user.
  ab({ id: 'pommel-tap', name: 'Pommel tap', kind: 'art', attack: true, uses: { per: 'breather', n: 3 }, target: { who: 'foe', range: 1 }, effects: [{ do: 'act', action: 'strike' }, { do: 'condition', id: 'dazed', n: 1, min: 'hit' }] }),
  ab({ id: 'volley', name: 'Volley', kind: 'feature', attack: true, costs: [2], target: { who: 'tile', range: 12, area: { shape: 'burst', size: 1, at: 'target' }, hits: 'foes' }, effects: [{ do: 'act', action: 'strike' }] }),
  ab({ id: 'ready-a-shot', name: 'Ready a shot', kind: 'reaction', attack: true, costs: [], reaction: { when: 'foe-moves-in-sight', range: 12 }, target: { who: 'foe', range: 12 }, effects: [{ do: 'act', action: 'strike' }] }),
  ab({ id: 'snap-trick', name: 'Snap trick', kind: 'move', attack: true, meets: 'guard', target: { who: 'foe', range: 6 }, effects: [{ do: 'mod', stat: 'degree-next-on-foe', by: 1, until: 'next-effect', to: 'self' }, { do: 'damage', line: 'one', kind: 'caster' }] }),
  ab({ id: 'ink-line', name: 'Ink line', kind: 'knack', attack: true, meets: 'body', costs: [2], target: { who: 'tile', range: 8, area: { shape: 'line', size: 4, at: 'self' }, hits: 'foes' }, effects: [{ do: 'damage', line: 'one', kind: 'ink' }] }),
  ab({ id: 'little-light', name: 'Little light', kind: 'knack', helpful: true, outcome: false, target: { who: 'tile', range: 6 }, effects: [{ do: 'light', radius: 2, rounds: 3 }] }),
  // Written like a regular's Into the shadows: a step into a tile that isn't Lit (the nearest, with none aimed at), then Hide.
  ab({ id: 'into-the-shadows', outcome: false, target: { who: 'none', range: 0 }, effects: [{ do: 'move', who: 'self', how: 'step', tiles: 1, into: 'dim' }, { do: 'act', action: 'hide' }] }),
];

export const abilities = buildAbilityIndex({ callings: { abilities: ABILITIES } });

/** The live ability index from C's and D's content files (read only), or null when one is missing. */
export function realAbilities() {
  const read = (p) => JSON.parse(readFileSync(new URL(`../content/${p}`, import.meta.url), 'utf8'));
  try {
    const companions = {};
    for (const f of readdirSync(new URL('../content/party/companions/', import.meta.url))) {
      if (f.endsWith('.json')) companions[f.slice(0, -5)] = read(`party/companions/${f}`);
    }
    return buildAbilityIndex({
      callings: read('combat/callings.json'), spells: read('combat/spells.json'), companions, regulars: read('party/regulars.json'),
      foes: read('combat/foes.json'), leads: read('combat/leads.json'),
    });
  } catch {
    return null;
  }
}

const ZERO = { might: 0, grace: 0, grit: 0, wit: 0, heed: 0, charm: 0 };
const carry = (extra = {}) => ({ cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [], ...extra });

/** A hero's UnitSpec at level 1 (override anything). */
export function hero(id, over = {}) {
  const base = {
    milo: {
      name: 'Milo', kind: 'milo', calling: 'lanternkeeper', path: null, small: true,
      abilities: { might: -1, grace: 2, grit: 2, wit: 0, heed: 3, charm: 1 }, maxIntegrity: 18, integrity: 18, guard: 0,
      resolve: { body: 0, mind: 2 }, speed: 4, strike: { amount: 5, kind: 'plain', reach: 1, range: 0, weapon: 'light' }, keyAdjust: 0,
      idleHeat: 20, shield: false, charges: { pool: 'three-quarter', max: 2, left: 2, circle: 1 },
      abilityIds: ['hooklight', 'raise-lantern', 'mote', 'flare', 'stand-in-my-light', 'cordial', 'brew-of-clear-morning'],
      uses: { 'stand-in-my-light': 2 }, look: { kind: 'rig', rig: 'coat', who: 'milo', likeness: null }, carry: carry({ cordial: 2, brew: 1 }),
    },
    claude: {
      name: 'The Scribe', kind: 'claude', calling: 'scrivener', path: null, small: false,
      abilities: { might: -1, grace: 1, grit: 1, wit: 3, heed: 2, charm: 0 }, maxIntegrity: 16, integrity: 16, guard: 0,
      resolve: { body: 0, mind: 1 }, speed: 5, strike: { amount: 5, kind: 'ink', reach: 1, range: 0, weapon: 'light' }, keyAdjust: 0,
      idleHeat: 25, shield: false, charges: { pool: 'full', max: 2, left: 2, circle: 1 },
      abilityIds: ['letter', 'draft', 'being-sure', 'proofread', 'full-stop', 'inkdarts', 'margin-note'],
      uses: { proofread: 2 }, reactions: { shoulder: 'always', proofread: 'never' }, look: { kind: 'rig', rig: 'robe', who: 'claude', likeness: null },
      carry: carry({ margin: 1 }),
    },
    codex: {
      name: 'The Artificer', kind: 'codex', calling: 'tinker', path: null, small: false,
      abilities: { might: 0, grace: 1, grit: 2, wit: 3, heed: 1, charm: -1 }, maxIntegrity: 22, integrity: 22, guard: 1,
      resolve: { body: 1, mind: 0 }, speed: 5, strike: { amount: 7, kind: 'spark', reach: 1, range: 0, weapon: 'standard' }, keyAdjust: 0,
      idleHeat: 30, shield: true, charges: { pool: 'half', max: 0, left: 0, circle: 0 },
      abilityIds: ['bench-drone', 'drone-zap', 'pop-up-cover', 'device', 'spare-part'], uses: {},
      look: { kind: 'rig', rig: 'robe', who: 'codex', likeness: null }, carry: carry({ spare: 1 }),
    },
    pip: {
      name: 'Pip', kind: 'pip', calling: 'weaver', path: null, small: true,
      abilities: { might: -1, grace: 1, grit: 1, wit: 2, heed: 0, charm: 3 }, maxIntegrity: 16, integrity: 16, guard: 0,
      resolve: { body: 0, mind: 1 }, speed: 4, strike: { amount: 7, kind: 'warp', reach: 1, range: 0, weapon: 'standard' }, keyAdjust: 0,
      idleHeat: 45, shield: false, charges: { pool: 'pact', max: 1, left: 1, circle: 1 }, abilityIds: [], uses: {},
      look: { kind: 'rig', rig: 'coat', who: 'pip', likeness: null }, carry: carry(),
    },
  }[id];
  return {
    id, side: 'party', talkKind: null, rank: 'hero', level: 1, size: 1, archetype: null, genres: [], temperament: null,
    moves: { flies: false, hovers: false, throughWalls: false, darksight: id === 'pip' }, ranged: null, flat: 0, attackEdge: 0,
    resist: {}, weak: {}, ignores: [], reactions: {}, control: 'review', adapt: 0, rattled: false, lead: null, post: null, ...base, ...over,
  };
}

const ARCH = {
  walker: { speed: 5, grace: 1, guard: 1, resolve: { body: 1, mind: 0 }, mult: 1 },
  crawler: { speed: 6, grace: 3, guard: 0, resolve: { body: 0, mind: 1 }, mult: 1 },
  floater: { speed: 4, grace: 0, guard: 0, resolve: { body: 0, mind: 1 }, mult: 0.8 },
  flier: { speed: 6, grace: 3, guard: 0, resolve: { body: 0, mind: 1 }, mult: 0.8 },
  ghost: { speed: 5, grace: 1, guard: 0, resolve: { body: 0, mind: 1 }, mult: 0.8 },
  construct: { speed: 4, grace: -1, guard: 1, resolve: { body: 2, mind: 0 }, mult: 1.25 },
};

/** A stray's UnitSpec (level-1 lines by default). */
export function stray(id, { archetype = 'walker', genre = 'neon', temperament = 'grumpy', level = 1, x = 0, y = 0, talkKind = 'k0', ...over } = {}) {
  const a = ARCH[archetype];
  const kind = RULES_JSON.genres[genre]?.kind || 'plain';
  const weak = RULES_JSON.genres[genre]?.weak;
  const res = [3, 3, 3, 4, 5, 6][level] ?? 3;
  const integrity = Math.round(RULES_JSON.strays.integrity[level] * a.mult);
  return {
    id, side: 'foe', name: over.name || 'Glitch beetle', kind: 'stray', talkKind, rank: 'stray', level, size: 1, small: false, archetype,
    genres: [genre], temperament, calling: null, path: null, abilities: { ...ZERO, grace: a.grace }, maxIntegrity: integrity, integrity,
    guard: a.guard, resolve: { ...a.resolve }, speed: a.speed,
    moves: { flies: archetype === 'flier', hovers: archetype === 'floater', throughWalls: archetype === 'ghost', darksight: archetype === 'ghost' },
    strike: { amount: RULES_JSON.strays.strike[level], kind, reach: 1, range: archetype === 'floater' ? 8 : 0, weapon: 'natural' }, ranged: null,
    keyAdjust: 0, flat: 0, attackEdge: 0, resist: { [kind]: res }, weak: weak ? { [weak]: res } : {}, ignores: [],
    idleHeat: RULES_JSON.heat.temperaments[temperament], shield: false, charges: { pool: null, max: 0, left: 0, circle: 0 },
    abilityIds: archetype === 'crawler' ? ['pounce'] : [], uses: {}, reactions: {}, control: 'auto', adapt: 1, rattled: false, lead: null,
    post: { x, y }, look: { kind: 'stray', archetype, bodyKey: 'r', parts: [], eyeKey: null, genres: [genre, null], scale: 1 },
    carry: carry(), ...over,
  };
}

/** An arena from rows of cells ('#', '.', 'o', 'O', '~', '=', ' '), with optional height and light rows. */
export function arena(rows, { heights = null, lights = null, x = 0, y = 0, entry = null, seed = 1 } = {}) {
  const h = rows.length;
  const w = rows[0].length;
  return {
    rect: { x, y, w, h },
    cells: rows.join(''),
    height: heights ? heights.join('') : '0'.repeat(w * h),
    light: lights ? lights.join('') : 'L'.repeat(w * h),
    mouths: [],
    entry: entry || [{ x: x + 1, y: y + 1 }, { x: x + 1, y: y + 2 }, { x: x + 1, y: y + 3 }, { x: x + 2, y: y + 1 }],
    seed,
  };
}

export const OPEN = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

/** A FightSpec around an arena and foes. */
export function fightSpec({ id = 'fight:test:w:r0', seed = 12345, level = 1, genres = ['neon'], arenaRows = OPEN, arenaOpts = {}, foes = [], leadUnit = null, lead = null, objects = [], surfaces = [], kind = 'room', real = null, surprised = null, affixes = [] } = {}) {
  return {
    id, room: 'r0', kind, seed, level, deepRank: 0, budget: 60, weight: 3, stage: null, genres, affixes, arena: arena(arenaRows, arenaOpts),
    foes, leadUnit, objects, surfaces, lead, sight: 6, surprised, real,
    rewards: { weight: 3, n: level, deepRank: 0, xp: 30, marks: 12, essences: [], relic: null, tonics: { cordial: 0, brew: 0 } },
  };
}

/** A CombatCtx: rules, the stand-in abilities, stub minds (or yours), mechanics and party voices. */
export function makeCtx({ minds = null, mechanics = {}, bows = null, party = null, foePlan = null, draft = null, abilityIndex = abilities } = {}) {
  const ctx = {
    rules, abilities: abilityIndex, minds: null, mechanics, bows, genres: GENRES,
    party: party || {
      milo: { personality: 'careful', barks: [{ on: 'critical', say: 'There it is.' }, { on: 'offline', say: 'Just a moment.' }], voice: 'words' },
      claude: { personality: 'careful', barks: [{ on: 'critical', say: 'Noted.' }], voice: 'words' },
      codex: { personality: 'steady', barks: [{ on: 'critical', say: 'Built. Tests pass.' }], voice: 'words' },
      jev: { personality: 'quick', barks: [{ on: 'critical', does: '(hops once)' }], voice: 'pictures' },
    },
  };
  ctx.minds = minds || stubMinds(ctx, { foePlan, draft });
  return Object.freeze(ctx);
}

const act = (id, extra = {}) => ({ id, ability: null, cost: id === 'reboot' || id === 'ready' ? 2 : id === 'delay' || id === 'head-home' ? 0 : 1, target: null, extra: 0, choice: null, cheer: false, trigger: null, ...extra });
export const A = {
  stride: (path) => act('stride', { target: { path } }),
  strideTo: (tile) => act('stride', { target: { tile } }),
  step: (tile) => act('step', { target: { tile } }),
  strike: (unit, extra = {}) => act('strike', { target: { unit }, ...extra }),
  brace: () => act('brace'),
  examine: (unit) => act('examine', { target: { unit } }),
  seek: () => act('seek'),
  interact: (target) => act('interact', { target }),
  assist: (ally, foe) => act('assist', { target: { units: [ally, foe] } }),
  talk: (unit) => act('talk-down', { target: { unit } }),
  cool: () => act('cool-down'),
  reboot: (unit) => act('reboot', { target: { unit } }),
  delay: () => act('delay'),
  hide: () => act('hide'),
  throw: (unit, extra = {}) => act('throw', { target: { unit }, ...extra }),
  shove: (unit, choice = null) => act('shove', { target: { unit }, choice }),
  jump: (tile) => act('jump', { target: { tile } }),
  dip: () => act('dip'),
  sustain: (ability = null) => act('sustain', { ability }),
  ready: (trigger) => act('ready', { trigger }),
  home: () => act('head-home'),
  use: (ability, target = null, extra = {}) => act('use', { ability, target, ...extra }),
};

export const plan = (unitId, slots, extra = {}) => ({ unitId, slots, reactions: {}, by: 'you', changed: slots.map(() => false), ...extra });

/** Applies commands in order, collecting events. */
export function play(battle, commands, ctx) {
  let b = battle;
  const events = [];
  for (const c of commands) {
    const r = apply(b, c, ctx);
    b = r.battle;
    events.push(...r.events);
  }
  return { battle: b, events };
}

/** Steps until the round is back to planning (or the fight ends), answering Asks with `yes`. */
export function playRound(battle, ctx, { yes = true } = {}) {
  let b = battle;
  const events = [];
  let guard = 0;
  while ((b.status === 'running' || b.status === 'asking') && guard < 500) {
    guard += 1;
    const r = apply(b, b.status === 'asking' ? { t: 'answer', yes } : { t: 'step' }, ctx);
    b = r.battle;
    events.push(...r.events);
  }
  return { battle: b, events };
}

export const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};

export const findUnit = (battle, id) => battle.units.find((u) => u.id === id);
export const seedAt = (i) => hashInts(0x5eed, i);
export { createBattle, apply };
