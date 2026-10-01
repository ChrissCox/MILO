// Abilities and action options (CONTRACT-PHASE4.md §4.4, §6, §7.1): the ability index, an
// ability's spec for a use, and the planner's options for a unit (the basic actions and its
// abilities), each with its targets or why it's greyed, and the planner's reads (legal actions,
// odds and likeliest trouble, exported from battle.js). The devices abilities summon (§6.5's
// templates) live here too. Pure. The closed vocabulary lives here (effects.js exports it).
import { createGrid, dist, footprint, unitDist } from './grid.js';
import { attackPenalty, clampHeat, expected, barsFor } from './heat.js';
import { line, damageSteps } from './rules.js';
import {
  unitIn, standing, hasCond, condOf, ability, numOf, speedOf, hooklight, inHooklight, modSum, levelOf, ticksOf, oddsAgainst,
  defencesTo, effMode, casterKind, hasRule, moveAlong, resolveOf,
} from './round.js';
import {
  strikePk, strikeDamage, canStrike, targetsOfUse, needsDegree, pkFor, leadingSure, lineAmount, jsonCopy, U, gridOf, emit, dirty,
  pickOutcome, landHit, resetCalm, addMark, carrierOf, takeCarry, patchUnit,
} from './effects.js';

// ---------- the closed vocabulary (§5.1, §5.3, §6) ----------

const freeze = (list) => Object.freeze([...list]);

export const VERBS = freeze(['damage', 'patch', 'condition', 'end-condition', 'move', 'act', 'heat', 'buffer', 'mark', 'mod', 'degree',
  'reveal', 'surface', 'summon', 'command', 'reboot', 'calm', 'light', 'take', 'cancel', 'rule']);
export const PREDICATES = freeze(['below-half', 'below-third', 'below-quarter', 'offline', 'standing', 'small', 'not-lead', 'not-elite',
  'not-large', 'examined', 'has-boon', 'has-bane', 'lingering', 'beside-ally', 'in-light', 'dim-or-dark', 'lantern-down', 'has-device',
  'examined-target', 'stitched-genre']);
export const TRIGGERS = freeze(['foe-leaves-reach', 'ally-struck-beside', 'strike-at-ally', 'hit-on-ally', 'outcome-in-sight', 'self-struck',
  'foe-moves-in-sight', 'foe-enters-reach', 'readied', 'spell-in-sight', 'telegraph-at-ally', 'big-blow-on-ally']);
export const RULE_IDS = freeze(['hooklight', 'raise-lantern', 'stand-in-my-light', 'lantern-calls', 'hearth-path', 'wick-path',
  'wayward-path', 'draw-the-blow', 'unbroken', 'settle-low', 'lullaby', 'unseen-strike', 'tuck-and-roll', 'ignore-difficult',
  'first-in-tick', 'burn-essence', 'cleave', 'tune-ups', 'tollkeeper-toll', 'steady-hands', 'steady-second', 'steady-third',
  'two-sustained', 'two-drones', 'swipe-strike']);
export const UNTIL = freeze(['next-action', 'next-attack', 'next-stride', 'next-effect', 'start-of-next-turn', 'end-of-round',
  'end-of-next-round', 'sustained', 'fight', 'rounds:<n>']);
export const DEVICE_TEMPLATES = freeze(['drone', 'turret', 'snare', 'patch-kit', 'pop-up-cover', 'decoy']);
export const READY_TRIGGERS = freeze(['foe-enters-reach', 'foe-moves-in-sight', 'strike-at-ally']);
export const REACTION_IDS = freeze(['parting-swipe', 'shoulder', 'ready', 'draw-the-blow', 'stand-in-my-light', 'proofread',
  'tuck-and-roll', 'ready-a-shot', 'sudden-shelter', 'cross-it-out']);
export const OBJECT_KINDS = freeze(['prop', 'lever', 'junction', 'lamp', 'candle', 'line', 'console', 'lectern', 'alibi', 'clue',
  'plan-tile', 'breaker', 'forge', 'bell', 'riddle-board', 'chest', 'snare', 'patch-kit', 'pop-up-cover']);
export const OBJECT_STATES = Object.freeze({
  prop: null, lever: freeze(['up', 'down']), junction: freeze(['off', 'on']), lamp: freeze(['lit', 'dark']), candle: freeze(['lit', 'dark']),
  line: freeze(['running', 'shut']), console: freeze(['idle', 'used']), lectern: freeze(['idle', 'read']), alibi: freeze(['standing', 'broken']),
  clue: freeze(['hidden', 'found']), 'plan-tile': freeze(['clear', 'marked']), breaker: freeze(['on', 'off']), forge: freeze(['cold', 'stoked']),
  bell: freeze(['still', 'rung']), 'riddle-board': freeze(['idle', 'solved']), chest: freeze(['shut', 'open']), snare: freeze(['set', 'sprung']),
  'patch-kit': freeze(['full', 'used']), 'pop-up-cover': freeze(['up', 'broken']),
});
export const SURFACE_IDS = freeze(['neon-puddle', 'candle-wax', 'candlefire', 'oil-slick', 'burning-oil', 'smog', 'gravity-well',
  'dust-cloud', 'streetlight-pool', 'moonbrew-spill', 'steam', 'water', 'foliage', 'burning-foliage', 'ice', 'rough-ground']);
export const CONDITION_IDS = freeze(['tumbled', 'tangled', 'drowsy', 'dazzled', 'spooked', 'beguiled', 'queasy', 'rattled', 'dazed',
  'slowed', 'quickened', 'brisk', 'winded', 'sparked', 'singed', 'soaked', 'hushed', 'unseen', 'exposed', 'singled-out', 'offline', 'lingering']);
export const DAMAGE_KINDS = freeze(['static', 'chill', 'dread', 'grind', 'warp', 'doubt', 'dust', 'quake', 'light', 'ink', 'spark', 'plain']);
export const MOD_STATS = freeze(['edge-next', 'edge-first-each-turn', 'edge-all', 'resolve-mind', 'resolve-body', 'resolve-set', 'guard',
  'speed', 'speed-next-stride', 'resist-all', 'drift', 'reboot-cost', 'initiative', 'light-radius', 'degree-next-on-foe', 'degree-next-from-foe']);
const ABILITY_KINDS = ['knack', 'spell', 'feature', 'move', 'reaction', 'passive', 'art', 'boon', 'item', 'device'];
const ABILITY_FIELDS = new Set(['id', 'name', 'kind', 'circle', 'attack', 'big', 'consumes', 'meets', 'helpful', 'cannotMiss', 'outcome',
  'spoken', 'costs', 'uses', 'sustained', 'requires', 'reaction', 'passive', 'choices', 'by', 'target', 'effects', 'crit', 'upcast',
  'words', 'text', 'stub', 'from']);
const VERB_PARAMS = {
  damage: ['line', 'amount', 'kind', 'frac', 'plus', 'split'],
  patch: ['line', 'frac', 'plus', 'ofMax', 'amount'],
  condition: ['id', 'n', 'data'],
  'end-condition': ['id', 'class', 'count'],
  move: ['who', 'how', 'tiles', 'noSwipes', 'into'],
  act: ['action', 'noSwipes'],
  // §18.2: heat to idle is `idle: true` (`to` stays every effect's landing parameter).
  heat: ['by', 'idle'],
  buffer: ['amount'],
  mark: ['id', 'n', 'edge', 'edgeHot', 'hotAt', 'spend', 'until'],
  mod: ['stat', 'by', 'until'],
  degree: ['by'],
  reveal: ['what', 'radius'],
  surface: ['id', 'rounds', 'area'],
  summon: ['template', 'rounds'],
  command: ['device', 'order'],
  reboot: ['frac'],
  calm: ['n'],
  light: ['radius', 'rounds'],
  // §18.2: `settle: true` sorts the taker once it has pinched (the fetchfox runs home).
  take: ['item', 'settle'],
  cancel: ['what', 'maxCircle'],
  rule: null,
};
const COMMON = ['do', 'min', 'to', 'if'];
const CHOICE_FIELDS = ['words', 'target', 'effects', 'meets'];
const LINES = ['one', 'strike', 'two', 'three', 'area', 'weapon', 'stray', 'fixed'];
const TARGET_WHO = ['self', 'ally', 'ally-or-self', 'foe', 'unit', 'offline-ally', 'tile', 'object', 'none'];

const isNum = (v) => typeof v === 'number' || v === 'wit' || v === 'charm' || (v && typeof v === 'object' && v.byLevel && typeof v.byLevel === 'object');
const untilOk = (u) => typeof u === 'string' && (UNTIL.includes(u) || /^rounds:\d+$/.test(u));

function checkTarget(t, where, out) {
  if (!t || typeof t !== 'object') {
    out.push(`${where} is a target spec`);
    return;
  }
  for (const k of Object.keys(t)) if (!['who', 'range', 'sight', 'area', 'hits', 'count', 'need'].includes(k)) out.push(`${where}.${k} is not a target field`);
  if (!TARGET_WHO.includes(t.who)) out.push(`${where}.who is one of ${TARGET_WHO.join(', ')}`);
  if (t.range !== undefined && typeof t.range !== 'number') out.push(`${where}.range is a number`);
  if (t.area) {
    if (!['burst', 'square', 'line'].includes(t.area.shape)) out.push(`${where}.area.shape is burst, square or line`);
    if (!isNum(t.area.size)) out.push(`${where}.area.size is a number`);
    if (t.area.at && !['self', 'target'].includes(t.area.at)) out.push(`${where}.area.at is self or target`);
  }
  if (t.hits && !['foes', 'allies', 'allies-and-self', 'all'].includes(t.hits)) out.push(`${where}.hits is foes, allies, allies-and-self or all`);
  for (const p of t.need || []) if (!PREDICATES.includes(p)) out.push(`${where}.need has an unknown predicate ${p}`);
}

function checkEffects(list, where, out) {
  if (!Array.isArray(list)) {
    out.push(`${where} is a list of effects`);
    return;
  }
  list.forEach((e, i) => {
    const w = `${where}[${i}]`;
    if (!e || typeof e !== 'object') {
      out.push(`${w} is an effect`);
      return;
    }
    if (!VERBS.includes(e.do)) {
      out.push(`${w}.do is a known verb (${e.do})`);
      return;
    }
    const params = VERB_PARAMS[e.do];
    if (params) for (const k of Object.keys(e)) if (!COMMON.includes(k) && !params.includes(k)) out.push(`${w}.${k} is not a ${e.do} param`);
    if (e.min && !['hit', 'crit'].includes(e.min)) out.push(`${w}.min is hit or crit`);
    if (e.to && !['target', 'self', 'area'].includes(e.to)) out.push(`${w}.to is target, self or area`);
    if (e.if && !PREDICATES.includes(e.if)) out.push(`${w}.if is a known predicate`);
    if (e.until !== undefined && !untilOk(e.until)) out.push(`${w}.until is a known until (${e.until})`);
    switch (e.do) {
      case 'damage':
        if (e.line && !LINES.includes(e.line)) out.push(`${w}.line is a known line`);
        if (e.kind && e.kind !== 'caster' && e.kind !== 'weapon' && !DAMAGE_KINDS.includes(e.kind)) out.push(`${w}.kind is a damage kind`);
        break;
      case 'patch':
        if (e.line && !LINES.includes(e.line)) out.push(`${w}.line is a known line`);
        break;
      case 'condition':
        if (!CONDITION_IDS.includes(e.id)) out.push(`${w}.id is a condition (${e.id})`);
        break;
      case 'end-condition':
        if (e.id && !CONDITION_IDS.includes(e.id)) out.push(`${w}.id is a condition`);
        if (e.class && !['boon', 'bane', 'any', 'lingering'].includes(e.class)) out.push(`${w}.class is boon, bane, any or lingering`);
        break;
      case 'move':
        if (!['push', 'pull', 'stride', 'step', 'teleport', 'swap'].includes(e.how)) out.push(`${w}.how is a known move`);
        if (e.who && !['target', 'self'].includes(e.who)) out.push(`${w}.who is target or self`);
        break;
      case 'act':
        if (!['stride', 'step', 'hide', 'brace', 'strike', 'seek'].includes(e.action)) out.push(`${w}.action is a basic action act can take`);
        break;
      case 'mark':
        if (!['bead', 'wanted', 'that-pile', 'drawn', 'assist'].includes(e.id)) out.push(`${w}.id is a known mark`);
        break;
      case 'mod':
        if (!MOD_STATS.includes(e.stat)) out.push(`${w}.stat is a known stat (${e.stat})`);
        break;
      case 'reveal':
        if (!['stats', 'unseen', 'intents', 'mechanic'].includes(e.what)) out.push(`${w}.what is stats, unseen, intents or mechanic`);
        break;
      case 'surface':
        if (!SURFACE_IDS.includes(e.id)) out.push(`${w}.id is a surface (${e.id})`);
        break;
      case 'summon':
        if (!DEVICE_TEMPLATES.includes(e.template)) out.push(`${w}.template is a device template`);
        break;
      case 'command':
        if (!['drone', 'turret'].includes(e.device)) out.push(`${w}.device is drone or turret`);
        if (!['zap', 'assist', 'carry'].includes(e.order)) out.push(`${w}.order is zap, assist or carry`);
        break;
      case 'heat':
        if (e.idle !== undefined && typeof e.idle !== 'boolean') out.push(`${w}.idle is a boolean`);
        if (e.idle && e.by !== undefined) out.push(`${w} sets by or idle, not both`);
        break;
      case 'take':
        if (!['cordial', 'brew'].includes(e.item)) out.push(`${w}.item is cordial or brew`);
        if (e.settle !== undefined && typeof e.settle !== 'boolean') out.push(`${w}.settle is a boolean`);
        break;
      case 'rule':
        if (!RULE_IDS.includes(e.id)) out.push(`${w}.id is a known rule (${e.id})`);
        break;
      default:
    }
  });
}

/** Problems with an ability against §6's closed vocabulary ([] when it's fine). */
export function validateAbility(a) {
  const out = [];
  if (!a || typeof a !== 'object') return ['is an ability object'];
  const where = a.id || 'ability';
  for (const k of Object.keys(a)) if (!ABILITY_FIELDS.has(k)) out.push(`${where}.${k} is not an ability field`);
  if (typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(a.id)) out.push(`${where}.id is a slug`);
  if (typeof a.name !== 'string' || !a.name) out.push(`${where}.name is a name`);
  if (!ABILITY_KINDS.includes(a.kind)) out.push(`${where}.kind is one of ${ABILITY_KINDS.join(', ')}`);
  if (a.circle !== undefined && ![0, 1, 2, 3, 4, 5].includes(a.circle)) out.push(`${where}.circle is 0–5`);
  for (const f of ['attack', 'big', 'helpful', 'cannotMiss', 'outcome', 'spoken', 'upcast', 'stub']) {
    if (a[f] !== undefined && typeof a[f] !== 'boolean') out.push(`${where}.${f} is a boolean`);
  }
  if (a.consumes !== undefined && a.consumes !== null && !['cordial', 'brew', 'margin', 'spare', 'essence'].includes(a.consumes)) out.push(`${where}.consumes is a known carry`);
  if (a.meets !== undefined && a.meets !== null && !['guard', 'body', 'mind'].includes(a.meets)) out.push(`${where}.meets is guard, body, mind or null`);
  if (a.costs !== undefined && (!Array.isArray(a.costs) || a.costs.some((c) => ![0, 1, 2, 3].includes(c)))) out.push(`${where}.costs is a list of 0–3`);
  if (a.uses) {
    if (!['turn', 'round', 'target-round', 'breather', 'campfire', 'fight'].includes(a.uses.per)) out.push(`${where}.uses.per is known`);
    if (!isNum(a.uses.n)) out.push(`${where}.uses.n is a number`);
  }
  if (a.sustained && typeof a.sustained.max !== 'number') out.push(`${where}.sustained.max is a number`);
  for (const p of a.requires || []) if (!PREDICATES.includes(p)) out.push(`${where}.requires has an unknown predicate ${p}`);
  if (a.reaction) {
    if (!TRIGGERS.includes(a.reaction.when)) out.push(`${where}.reaction.when is a known trigger (${a.reaction.when})`);
    if (a.reaction.range !== undefined && typeof a.reaction.range !== 'number') out.push(`${where}.reaction.range is a number`);
  }
  if (a.passive) {
    for (const m of a.passive.mods || []) if (!MOD_STATS.includes(m.stat) || !untilOk(m.until || 'fight')) out.push(`${where}.passive.mods has an unknown stat or until`);
    if (a.passive.aura) {
      for (const m of a.passive.aura.mods || []) if (!MOD_STATS.includes(m.stat)) out.push(`${where}.passive.aura.mods has an unknown stat`);
      if (!['allies', 'allies-and-self', 'foes'].includes(a.passive.aura.who)) out.push(`${where}.passive.aura.who is allies, allies-and-self or foes`);
    }
    for (const r of a.passive.rules || []) if (!RULE_IDS.includes(r)) out.push(`${where}.passive.rules has an unknown rule ${r}`);
    for (const s of a.passive.summons || []) if (!DEVICE_TEMPLATES.includes(s.template)) out.push(`${where}.passive.summons has an unknown template`);
  }
  const hasBy = a.by !== undefined && a.by !== null;
  const hasChoices = a.choices !== undefined && a.choices !== null;
  const hasFlat = (a.target !== undefined && a.target !== null) || (a.effects !== undefined && a.effects !== null);
  if (a.kind === 'passive') {
    if (hasBy || hasChoices) out.push(`${where} is a passive with no by or choices`);
  } else if (a.kind === 'reaction') {
    if (!a.reaction) out.push(`${where} is a reaction with a trigger`);
    if (a.effects) checkEffects(a.effects, `${where}.effects`, out);
    if (a.target) checkTarget(a.target, `${where}.target`, out);
  } else if (!a.stub) {
    const set = [hasBy, hasChoices, hasFlat].filter(Boolean).length;
    if (set !== 1) out.push(`${where} sets exactly one of by, choices, or target with effects`);
  }
  if (hasBy) {
    for (const [cost, s] of Object.entries(a.by)) {
      if (!['0', '1', '2', '3'].includes(cost)) out.push(`${where}.by.${cost} is an action count`);
      checkTarget(s?.target, `${where}.by.${cost}.target`, out);
      checkEffects(s?.effects, `${where}.by.${cost}.effects`, out);
    }
  }
  if (hasChoices) {
    for (const [c, s] of Object.entries(a.choices)) {
      // §18.2: a choice may carry its own `meets` ('body' or 'mind'), which wins over the ability's.
      for (const k of Object.keys(s || {})) if (!CHOICE_FIELDS.includes(k)) out.push(`${where}.choices.${c}.${k} is not a choice field`);
      if (s?.meets !== undefined && s.meets !== null && !['body', 'mind'].includes(s.meets)) out.push(`${where}.choices.${c}.meets is body or mind`);
      checkTarget(s?.target, `${where}.choices.${c}.target`, out);
      checkEffects(s?.effects, `${where}.choices.${c}.effects`, out);
    }
  }
  if (hasFlat && a.kind !== 'reaction') {
    checkTarget(a.target, `${where}.target`, out);
    checkEffects(a.effects, `${where}.effects`, out);
  }
  if (a.crit !== undefined) checkEffects(a.crit, `${where}.crit`, out);
  return out;
}


const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** A Map that can't change once built (set, delete and clear throw). */
function frozenMap(entries) {
  const map = new Map(entries);
  const refuse = () => {
    throw new Error('The ability index is frozen');
  };
  Object.defineProperty(map, 'set', { value: refuse });
  Object.defineProperty(map, 'delete', { value: refuse });
  Object.defineProperty(map, 'clear', { value: refuse });
  return Object.freeze(map);
}

const CANON_BOWS = new WeakMap();

/**
 * Every ability in one frozen Map<id, Ability>: callings.json's abilities, spells.json's spells,
 * each companion's abilityDefs, regulars.json's abilityDefs, foes.json's abilities and
 * leads.json's abilities. Throws on a duplicate id.
 */
export function buildAbilityIndex({ callings = null, spells = null, companions = null, regulars = null, foes = null, leads = null } = {}) {
  const lists = [
    ['callings.json', callings?.abilities],
    ['spells.json', spells?.spells],
    ...Object.entries(isRecord(companions) ? companions : {}).map(([id, c]) => [`companions/${id}.json`, c?.abilityDefs]),
    ['regulars.json', regulars?.abilityDefs],
    ['foes.json', foes?.abilities],
    ['leads.json', leads?.abilities],
  ];
  const entries = new Map();
  const where = new Map();
  for (const [file, list] of lists) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (!isRecord(a) || typeof a.id !== 'string') throw new Error(`${file} has an ability without an id`);
      if (entries.has(a.id)) throw new Error(`Ability ${a.id} is in both ${where.get(a.id)} and ${file}`);
      entries.set(a.id, deepFreeze(JSON.parse(JSON.stringify(a))));
      where.set(a.id, file);
    }
  }
  const index = frozenMap(entries);
  // foes.json's canon bows, by foe id (a canon foe's unit `kind`), for the Talk-down needs (§18.3).
  const bows = {};
  for (const c of Array.isArray(foes?.canon) ? foes.canon : []) {
    if (isRecord(c) && typeof c.id === 'string' && isRecord(c.bow)) bows[c.id] = Object.freeze({ kind: c.bow.kind, count: c.bow.count });
  }
  CANON_BOWS.set(index, Object.freeze(bows));
  return index;
}

/**
 * A kind's Talk-down need (§4.6): its temperament's, less one with Charm 3+ in the party, at least
 * rules' min. A canon kind whose bow is talking or the bell (the Sentries, the bell-ringers) needs its
 * foes.json `bow.count` instead, with the same Charm and floor (§18.3), from the start, doorway calm included.
 */
export function talkNeed(rules, temperament, heroes, bow = null) {
  const t = rules.temperaments?.[temperament] || { talk: 3 };
  let need = t.talk ?? 3;
  if (t.talkWith && heroes.some((h) => t.talkWith.ids.includes(h.kind) || t.talkWith.ids.includes(h.id))) need = t.talkWith.talk;
  if (bow && (bow.kind === 'talk-down' || bow.kind === 'bell') && Number.isInteger(bow.count)) need = bow.count;
  if (heroes.some((h) => (h.abilities?.charm ?? 0) >= (rules.talk?.charm ?? 3))) need -= 1;
  return Math.max(rules.talk?.min ?? 2, need);
}

/** A canon foe kind's bow ({ kind, count }), from the foes.json the ability index was built with; null for none. */
export function canonBow(index, kind) {
  return (index && kind && CANON_BOWS.get(index)?.[kind]) || null;
}

/** The action counts an ability allows. */
export function costsOf(a) {
  if (Array.isArray(a?.costs) && a.costs.length) return a.costs;
  if (a?.by) return Object.keys(a.by).map(Number).sort((x, y) => x - y);
  return [1];
}

/** The { target, effects } an ability uses for this use (its `by` for the cost, its choice, or its own). */
export function specFor(a, use = {}) {
  if (!a) return null;
  if (a.by) {
    const cost = String(use.cost ?? costsOf(a)[0]);
    return a.by[cost] || null;
  }
  if (a.choices) return a.choices[choiceKey(a, use.choice)] || null;
  return { target: a.target || (a.kind === 'reaction' ? { who: 'unit', range: a.reaction?.range ?? 99 } : { who: 'self', range: 0 }), effects: a.effects || [] };
}

export const targetSpecFor = (a, use) => specFor(a, use)?.target || null;

/** The choice a use plays: the one it names, or the ability's first when it names none it has. */
export function choiceKey(a, choice) {
  if (!a?.choices) return null;
  return choice && a.choices[choice] ? choice : Object.keys(a.choices)[0];
}

// ---------- options ----------

const action = (id, cost, extra = {}) => ({ id, ability: null, cost, target: null, extra: 0, choice: null, cheer: false, trigger: null, ...extra });
const option = (act, words, targets, why = null) => ({ action: act, words, cost: act.cost, targets, why });

const BOONS = new Set(['quickened', 'brisk', 'unseen']);

export function predicateHolds(battle, grid, p, user, u) {
  switch (p) {
    case 'below-half': return u.integrity < u.maxIntegrity / 2;
    case 'below-third': return u.integrity < u.maxIntegrity / 3;
    case 'below-quarter': return u.integrity < u.maxIntegrity / 4;
    case 'offline': return !!u.offline;
    case 'standing': return standing(u);
    case 'small': return !!u.small;
    case 'not-lead': return u.rank !== 'lead';
    case 'not-elite': return u.rank !== 'elite' && u.rank !== 'lead';
    case 'not-large': return (u.size || 1) === 1;
    case 'examined': case 'examined-target': return !!u.examined;
    case 'has-boon': return (u.conditions || []).some((c) => BOONS.has(c.id)) || (u.mods || []).some((m) => m.by > 0);
    case 'has-bane': return (u.conditions || []).some((c) => !BOONS.has(c.id) && c.id !== 'offline');
    case 'lingering': return (u.conditions || []).some((c) => c.id === 'lingering' || c.id === 'singed');
    case 'beside-ally': return battle.units.some((v) => standing(v) && v.side === user.side && v.id !== user.id && unitDist(v, u) <= 1);
    case 'in-light': return footprint(u).some((t) => grid.light(t.x, t.y) === 'L');
    case 'dim-or-dark': return footprint(u).some((t) => grid.light(t.x, t.y) !== 'L');
    case 'lantern-down': return (hooklight(battle)?.radius ?? 1) === 0;
    case 'has-device': return battle.units.some((v) => v.rank === 'device' && !v.sorted && v.by === user.id);
    case 'stitched-genre': return (user.carry?.stitched || []).length > 0;
    default: return false;
  }
}

/**
 * A tile that isn't Lit for a mover (`into: 'dim'`, and `dim-or-dark` on a tile): for the party the
 * Hooklight doesn't count, since it never spoils the party's own hiding (§6.5); a Large mover needs one such tile.
 */
export function dimTile(grid, mover, tile) {
  const skip = mover?.side === 'party' ? 'hooklight' : null;
  return !!tile && footprint({ x: tile.x, y: tile.y, size: mover?.size || 1 }).some((t) => grid.light(t.x, t.y, { skip }) !== 'L');
}

/** A `need` predicate on a tile target: light on the tile, the user's own on the user, a unit's on whoever stands there. */
export function tileHolds(battle, grid, p, user, tile) {
  if (p === 'dim-or-dark') return dimTile(grid, user, tile);
  if (p === 'in-light') return grid.light(tile.x, tile.y) === 'L';
  if (['lantern-down', 'has-device', 'stitched-genre'].includes(p)) return predicateHolds(battle, grid, p, user, user);
  const v = unitIn(battle, grid.occupant(tile.x, tile.y));
  return !!v && predicateHolds(battle, grid, p, user, v);
}

/** Units a TargetSpec can pick for a user (range, sight, side and `need`). */
export function unitTargets(battle, grid, user, t, { wit = 0 } = {}) {
  const who = t?.who || 'unit';
  const range = (t?.range ?? 1) + wit;
  const out = [];
  for (const v of battle.units) {
    if (v.sorted) continue;
    if (who === 'offline-ally') {
      if (v.side !== user.side || !v.offline) continue;
    } else {
      if (v.offline && who !== 'unit') continue;
      if (who === 'ally' && (v.side !== user.side || v.id === user.id)) continue;
      if (who === 'ally-or-self' && v.side !== user.side) continue;
      if (who === 'foe' && (v.side === user.side || v.side === 'neutral')) continue;
      if (who === 'unit' && v.side === 'neutral' && user.side === 'party') continue;
    }
    if (v.id !== user.id && unitDist(user, v) > range) continue;
    if (t?.sight !== false && v.id !== user.id && !grid.sees(user, v)) continue;
    if ((t?.need || []).some((p) => !predicateHolds(battle, grid, p, user, v))) continue;
    out.push(v.id);
  }
  return out;
}

function carrierHas(battle, u, item) {
  const key = item === 'essence' ? 'essences' : item;
  if (item === 'cordial' || item === 'brew') return battle.units.some((v) => v.side === u.side && (v.carry?.[key] || 0) > 0);
  return (u.carry?.[key] || 0) > 0;
}

/** Why an ability can't be used now (null when it can). */
export function abilityWhy(battle, u, a, cost, ctx) {
  const grid = createGrid(battle, ctx?.rules);
  if (a.stub) return a.from ? `Arrives in ${a.from}` : 'Not yet';
  if (a.kind === 'spell' && a.circle > 0) {
    if ((u.charges?.circle || 0) < a.circle) return `Needs circle ${a.circle}`;
    const need = u.charges?.pool === 'pact' ? 1 : a.circle;
    if ((u.charges?.left || 0) < need) return 'No charges left';
  }
  if (a.uses) {
    const n = numOf(a.uses.n, u);
    if ((a.uses.per === 'turn' || a.uses.per === 'round') && (u.usedRound?.[a.id] || 0) >= n) return 'Used this round';
    if (['breather', 'campfire', 'fight'].includes(a.uses.per) && (u.uses?.[a.id] ?? n) <= 0) return a.uses.per === 'fight' ? 'Used this fight' : `Used until the next ${a.uses.per === 'breather' ? 'Breather' : 'Campfire'}`;
  }
  if (a.consumes && !carrierHas(battle, u, a.consumes)) return a.consumes === 'cordial' ? 'No cordials left' : a.consumes === 'brew' ? 'No brews left' : 'None carried';
  // Burn an essence spends a carried essence (§6.5), so with none it would spend its use for nothing.
  if ((specFor(a, { cost })?.effects || []).some((e) => e.do === 'rule' && e.id === 'burn-essence') && !carrierHas(battle, u, 'essence')) return 'None carried';
  if (a.spoken && hasCond(u, 'hushed')) return 'Hushed';
  for (const p of a.requires || []) if (!predicateHolds(battle, grid, p, u, u)) return REQUIRE_WORDS[p] || 'Not now';
  return null;
}

const REQUIRE_WORDS = { 'lantern-down': 'The lantern is up', 'has-device': 'No device out', 'examined-target': 'Examine it first', 'stitched-genre': 'No genre stitched yet' };

/**
 * Why a use's choice can't be played (null when it can). An ability that needs a stitched genre lends
 * "the rule of a genre you've stitched" (COMBAT §5): each choice is keyed by its genre, so Borrow a rule
 * offers only the genres in the user's `carry.stitched`.
 */
export function choiceWhy(u, a, choice) {
  if (!a?.choices || !(a.requires || []).includes('stitched-genre')) return null;
  return (u?.carry?.stitched || []).includes(choiceKey(a, choice)) ? null : 'Not a genre you’ve stitched';
}

const INTERACTABLE = new Set(['lever', 'junction', 'lamp', 'candle', 'line', 'console', 'lectern', 'alibi', 'clue', 'plan-tile', 'breaker',
  'forge', 'bell', 'riddle-board', 'chest', 'patch-kit']);

function canHideHere(battle, grid, u) {
  if (u.side !== 'party' && inHooklight(battle, u)) return false;
  const tiles = footprint(u);
  const skip = u.side === 'party' ? 'hooklight' : null;
  if (tiles.some((t) => grid.light(t.x, t.y, { skip }) !== 'L')) return true;
  if (tiles.some((t) => grid.hides(t.x, t.y))) return true;
  return tiles.some((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid.highCover(t.x + dx, t.y + dy)));
}

function dipSource(battle, grid, u) {
  for (const t of footprint(u)) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const s = grid.surfaceAt(t.x + dx, t.y + dy);
        if (s === 'candlefire' || s === 'burning-oil' || s === 'burning-foliage') return 'light';
        if (s === 'neon-puddle') return 'spark';
        const o = grid.objectAt(t.x + dx, t.y + dy);
        if (o && o.kind === 'candle' && o.state === 'lit') return 'light';
      }
    }
  }
  return null;
}

/** The talk kinds a unit could Talk down now (in sight, not settled, dramatic ones after their big moment). */
export function talkTargets(battle, grid, u) {
  const out = [];
  for (const v of battle.units) {
    if (!standing(v) || v.side === u.side || v.side === 'neutral' || !v.talkKind) continue;
    const t = battle.talk?.[v.talkKind];
    if (!t || t.done) continue;
    if (v.temperament === 'dramatic' && !(v.mods || []).some((m) => m.stat === 'big-done')) continue;
    if (!grid.sees(u, v)) continue;
    out.push(v.id);
  }
  return out;
}

/** §4.4's basic actions for a unit, each with its targets or why it's greyed. */
export function basicActions(battle, unitId, ctx) {
  const u = unitIn(battle, unitId);
  if (!u || !standing(u) || u.rank === 'device') return [];
  const rules = ctx.rules;
  const grid = createGrid(battle, rules);
  const out = [];
  const foes = battle.units.filter((v) => standing(v) && v.side !== u.side && v.side !== 'neutral');
  const tangled = hasCond(u, 'tangled');
  out.push(option(action('stride', 1), 'Stride', 'path', tangled ? 'Tangled' : speedOf(battle, u, ctx, { stride: true }) <= 0 ? 'Can’t move' : null));
  out.push(option(action('step', 1), 'Step', 'tile', tangled ? 'Tangled' : null));
  // Unseen foes are targets too: attacks on them are −2 (COMBAT §7), which their odds show.
  const strikeTargets = foes.filter((v) => canStrike(grid, u, v)).map((v) => ({ unit: v.id }));
  out.push(option(action('strike', 1), 'Strike', strikeTargets, strikeTargets.length ? null : 'Nothing in reach'));
  out.push(option(action('brace', 1), 'Brace', null));
  const sightTargets = battle.units.filter((v) => v.id !== u.id && !v.sorted && v.side !== u.side && grid.sees(u, v)).map((v) => ({ unit: v.id }));
  out.push(option(action('examine', 1), 'Examine', sightTargets, sightTargets.length ? null : 'Nothing in sight'));
  out.push(option(action('seek', 1), 'Seek', null));
  const interact = [];
  for (const o of battle.objects || []) if (INTERACTABLE.has(o.kind) && unitDist(u, o) <= 1) interact.push({ object: o.id });
  for (const v of battle.units) if (v.side === u.side && v.id !== u.id && standing(v) && hasCond(v, 'drowsy') && unitDist(u, v) <= 1) interact.push({ unit: v.id });
  for (const v of foes) if (unitDist(u, v) <= 1) interact.push({ unit: v.id });
  if ((u.conditions || []).some((c) => ['lingering', 'singed', 'tangled'].includes(c.id))) interact.push({ unit: u.id });
  out.push(option(action('interact', 1), 'Interact', interact, interact.length ? null : 'Nothing to use here'));
  const allies = battle.units.filter((v) => standing(v) && v.side === u.side && v.id !== u.id && v.rank !== 'device');
  const assist = [];
  for (const a of allies) for (const f of foes) if (grid.sees(u, f)) assist.push({ units: [a.id, f.id] });
  out.push(option(action('assist', 1), 'Assist', assist, assist.length ? null : 'No one to help'));
  const talk = talkTargets(battle, grid, u).map((id) => ({ unit: id }));
  out.push(option(action('talk-down', 1), 'Talk down', talk, talk.length ? null : 'No one to talk down'));
  out.push(option(action('cool-down', 1), 'Cool down', null, u.heat <= 0 ? 'Already cool' : null));
  const offline = battle.units.filter((v) => v.side === u.side && v.offline && (v.drops || 0) < 2 && unitDist(u, v) <= 1);
  const rebootCost = offline.length ? Math.max(1, 2 + Math.min(0, ...offline.map((v) => modSum(battle, v, 'reboot-cost', ctx)))) : 2;
  out.push(option(action('reboot', rebootCost), 'Reboot', offline.map((v) => ({ unit: v.id })), offline.length ? null : 'No one to reboot'));
  out.push(option(action('delay', 0), 'Delay', null));
  out.push(option(action('hide', 1), 'Hide', null, canHideHere(battle, grid, u) ? null : 'Needs dim light, foliage or high cover'));
  const throwRange = Math.max(1, rules.actions.throwBase + rules.actions.throwMight * (u.abilities?.might ?? 0));
  const throwTargets = foes.filter((v) => unitDist(u, v) <= throwRange && grid.sees(u, v)).map((v) => ({ unit: v.id }));
  out.push(option(action('throw', 1), 'Throw', throwTargets, throwTargets.length ? null : 'Nothing in range'));
  // A thrown cordial patches everyone within 1 of the ally it lands on (§4.4).
  const catchers = allies.filter((v) => unitDist(u, v) <= throwRange && grid.sees(u, v)).map((v) => ({ unit: v.id }));
  const cordials = carrierHas(battle, u, 'cordial');
  out.push(option(action('throw', 1, { ability: 'cordial' }), 'Throw a cordial', catchers, !cordials ? 'No cordials left' : catchers.length ? null : 'No one in range'));
  const shove = foes.filter((v) => unitDist(u, v) <= 1 && grid.sees(u, v)).map((v) => ({ unit: v.id }));
  out.push(option(action('shove', 1), 'Shove', shove, shove.length ? null : 'Nothing beside you'));
  // Or shove to Tumble on a Critical (never a Large foe).
  const tumble = foes.filter((v) => unitDist(u, v) <= 1 && grid.sees(u, v) && (v.size || 1) === 1).map((v) => ({ unit: v.id }));
  out.push(option(action('shove', 1, { choice: 'tumble' }), 'Shove to tumble', tumble, tumble.length ? null : 'Nothing beside you to tumble'));
  out.push(option(action('jump', 1), 'Jump', 'tile', tangled ? 'Tangled' : null));
  const dip = dipSource(battle, grid, u);
  out.push(option(action('dip', 1), 'Dip', null, dip ? null : 'Nothing lit or charged to dip in'));
  const mine = (battle.sustained || []).filter((s) => s.unitId === u.id);
  for (const s of mine) out.push(option(action('sustain', 1, { ability: s.abilityId }), 'Sustain', null));
  if (!mine.length) out.push(option(action('sustain', 1), 'Sustain', null, 'Nothing to sustain'));
  const readyWhy = (battle.warding || 0) < (rules.warding?.ready ?? 10) ? `Needs Warding ${rules.warding?.ready ?? 10}` : null;
  for (const trigger of ['foe-enters-reach', 'foe-moves-in-sight', 'strike-at-ally']) {
    out.push(option(action('ready', 2, { trigger }), 'Ready', null, readyWhy));
  }
  if (u.side === 'party') out.push(option(action('head-home', 0), 'Head home', null));
  return out;
}

/** A unit's own abilities as options: one per action count and choice, with targets or why greyed. */
export function abilityActions(battle, unitId, ctx) {
  const u = unitIn(battle, unitId);
  if (!u || !standing(u)) return [];
  const grid = createGrid(battle, ctx.rules);
  const out = [];
  for (const id of u.abilityIds || []) {
    const a = ability(ctx, id);
    if (!a || a.kind === 'passive' || a.kind === 'reaction') continue;
    const choices = a.choices ? Object.keys(a.choices) : [null];
    for (const cost of costsOf(a)) {
      for (const choice of choices) {
        const spec = specFor(a, { cost, choice });
        if (!spec) continue;
        const why = abilityWhy(battle, u, a, cost, ctx) || choiceWhy(u, a, choice);
        const t = spec.target || { who: 'self' };
        const wit = (u.abilities?.wit ?? 0) >= 3 && a.kind === 'spell' && cost >= 2 ? 1 : 0;
        let targets = null;
        let spent = false;
        if (t.who === 'tile') targets = 'tile';
        else if (t.who === 'object') {
          targets = (battle.objects || []).filter((o) => unitDist(u, o) <= (t.range ?? 1) + wit).map((o) => ({ object: o.id }));
        } else if (t.who !== 'self' && t.who !== 'none') {
          const all = unitTargets(battle, grid, u, t, { wit });
          // Once per target a round (Soothe): whoever has had it this round isn't offered it again.
          const ids = a.uses?.per === 'target-round' ? all.filter((id) => (u.usedRound?.[`${a.id}@${id}`] || 0) < numOf(a.uses.n, u)) : all;
          spent = all.length > 0 && !ids.length;
          const count = t.count || 1;
          targets = count > 1 ? (ids.length ? [{ units: ids.slice(0, count) }] : []) : ids.map((x) => ({ unit: x }));
        }
        const act = action('use', cost, { ability: a.id, choice });
        const words = choice && a.choices[choice]?.words ? a.choices[choice].words : a.words || a.name;
        const empty = Array.isArray(targets) && !targets.length;
        out.push(option(act, words, targets, why || (spent ? 'Used on them this round' : empty ? 'No one in range' : null)));
      }
    }
  }
  return out;
}


// ---------- devices ----------

export function deviceSpec(run, maker, template, at) {
  const d = run.rules.devices?.[template];
  const level = maker.level;
  const tune = hasRule(run.ctx, maker, 'tune-ups');
  const integrity = d.fixed ? d.integrity : d.integrity * level + (tune ? 2 * level : 0);
  const id = nextId(run.b.units.map((u) => u.id), 'd');
  return {
    id, side: maker.side, name: DEVICE_NAMES[template] || template, kind: template, talkKind: null, rank: 'device', level, size: 1, small: !!d.small,
    archetype: null, genres: [], temperament: null, calling: null, path: null,
    abilities: { might: 0, grace: 0, grit: 0, wit: 0, heed: 0, charm: 0 },
    maxIntegrity: integrity, integrity, guard: Math.min(2, d.guard + (tune ? 1 : 0)), resolve: { body: 0, mind: 0 }, speed: d.speed,
    moves: { flies: !!d.flies, hovers: false, throughWalls: false, darksight: false },
    strike: { amount: d.zap ? line(run.rules, d.zap.line, level) : 0, kind: d.zap?.kind || 'spark', reach: 1, range: d.zap?.range || 0, weapon: 'natural' },
    ranged: null, keyAdjust: maker.keyAdjust || 0, flat: 0, attackEdge: 0, resist: {}, weak: {}, ignores: ['drowsy', 'queasy', 'beguiled', 'spooked'],
    idleHeat: maker.idleHeat, shield: false, charges: { pool: null, max: 0, left: 0, circle: 0 }, abilityIds: [], uses: {}, reactions: {},
    control: 'auto', adapt: 0, rattled: false, lead: null, post: null, by: maker.id,
    look: { kind: 'device', template }, carry: { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] },
  };
}

const DEVICE_NAMES = { drone: 'Bench drone', turret: 'Turret', decoy: 'Decoy', snare: 'Snare', 'patch-kit': 'Patch kit', 'pop-up-cover': 'Pop-up cover' };

export function nextId(ids, prefix) {
  const used = new Set(ids);
  let i = 0;
  while (used.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}

/** Makes a device: a unit joining the ribbon right after its maker, or an object on a tile. */
export function summonDevice(run, makerId, template, tile, rounds = null) {
  const maker = U(run, makerId);
  const d = run.rules.devices?.[template];
  if (!maker || !d) return null;
  const g = gridOf(run);
  let at = tile;
  if (!at || g.blocksMove(at.x, at.y, null) || g.occupant(at.x, at.y) || g.objectAt(at.x, at.y)) {
    at = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const t = { x: maker.x + dx, y: maker.y + dy };
      if (!g.blocksMove(t.x, t.y, null) && !g.occupant(t.x, t.y) && !g.objectAt(t.x, t.y)) {
        at = t;
        break;
      }
    }
  }
  if (!at) return null;
  if (d.unit) {
    if (run.b.units.length >= 16) return null;
    if (template === 'drone') {
      const cap = hasRule(run.ctx, maker, 'two-drones') ? 2 : 1;
      const mine = run.b.units.filter((v) => v.kind === 'drone' && v.by === maker.id && !v.sorted);
      if (mine.length >= cap) return null;
    }
    const spec = deviceSpec(run, maker, template, at);
    const unit = { ...spec, x: at.x, y: at.y, facing: maker.facing, heat: maker.heat, buffer: 0, conditions: [], marks: [], mods: [], offline: false, drops: 0, sorted: null, reactionUsed: false, attacks: 0, examined: false, revealedUntil: null, usedRound: {} };
    if (rounds) unit.uses = { '#rounds': rounds };
    run.b.units.push(unit);
    const i = run.b.order.indexOf(maker.id);
    run.b.order.splice(i + 1, 0, unit.id);
    dirty(run);
    emit(run, { t: 'spawn', unit: viewOf(unit), object: null });
    return unit.id;
  }
  if ((run.b.objects || []).length >= 24) return null;
  const id = nextId((run.b.objects || []).map((o) => o.id), 'o');
  const integrity = template === 'pop-up-cover' ? d.integrity + d.perLevel * maker.level : null;
  const obj = { id, kind: template, x: at.x, y: at.y, state: d.state, flags: template === 'pop-up-cover' ? ['cover-low'] : [], integrity, by: maker.id };
  run.b.objects = [...(run.b.objects || []), obj];
  dirty(run);
  emit(run, { t: 'spawn', unit: null, object: { ...obj } });
  return id;
}

export function commandDevice(run, makerId, template, order, use, a) {
  const maker = U(run, makerId);
  const dev = run.b.units.find((v) => v.kind === template && v.by === makerId && standing(v));
  if (!maker || !dev) return;
  if (order === 'zap') {
    const targetId = use.target?.unit;
    const target = targetId ? U(run, targetId) : null;
    if (!target || !standing(target) || unitDist(dev, target) > (dev.strike.range || 6) || !gridOf(run).sees(dev, target)) return;
    const pk = { harmful: true, meets: 'guard', attack: false, reaction: true, ranged: true, heat: maker.heat };
    const odds = oddsAgainst(run.b, run.ctx, dev.id, target.id, pk, gridOf(run));
    const degree = pickOutcome(run, dev.id, target.id, odds);
    if (degree !== 'miss') landHit(run, { userId: dev.id, targetId: target.id, amount: dev.strike.amount + (maker.keyAdjust || 0), kind: dev.strike.kind, degree, source: 'zap' });
    else resetCalm(run, target);
  } else if (order === 'assist') {
    const [allyId, foeId] = use.target?.units || [];
    const foe = foeId ? U(run, foeId) : null;
    if (foe && allyId) addMark(run, foe, { id: 'assist', by: allyId, n: 1, until: 'end-of-next-round' });
  } else if (order === 'carry') {
    const to = use.target?.tile;
    if (to) {
      const path = gridOf(run).path(dev.id, to, { budget: run.rules.devices.drone.carry ?? 5, noSwipes: true });
      if (path?.length) moveAlong(run, dev.id, path, 'stride', { noSwipes: true });
    }
    const allyId = use.target?.unit || use.target?.units?.[0];
    const ally = allyId ? U(run, allyId) : null;
    const d2 = U(run, dev.id);
    if (ally && d2 && unitDist(d2, ally) <= 1 && carrierOf(run, maker, 'cordial')) {
      takeCarry(run, maker, 'cordial');
      const third = hasRule(run.ctx, ally, 'steady-hands') ? 1 / 3 : 0.25;
      patchUnit(run, dev.id, ally, Math.floor(ally.maxIntegrity * third));
    }
  }
}

/** A UnitView (§11.3). */
export function viewOf(u, battle = null) {
  const lead = battle?.lead && u.id === 'lead' ? { phase: battle.lead.phase, bar: battle.lead.bar, bars: [...battle.lead.bars] } : null;
  return {
    id: u.id, side: u.side, rank: u.rank, talkKind: u.talkKind ?? null, look: jsonCopy(u.look), x: u.x, y: u.y, size: u.size || 1, facing: u.facing,
    name: u.name, integrity: u.integrity, max: u.maxIntegrity, buffer: u.buffer || 0, offline: !!u.offline, sorted: u.sorted ?? null,
    conditions: (u.conditions || []).map((c) => ({ id: c.id, n: c.n ?? null })), heat: u.heat, bar: lead,
  };
}

// ---------- the planner's reads (exported from battle.js) ----------
// abilities.js and effects.js import each other; neither uses the other's bindings at module top level.

/**
 * The unit's slots that will resolve before `slot` and haven't yet. While planning, that's the
 * plan's earlier slots; once the round runs, it's what the schedule puts between the cursor and
 * this slot (so a lagged or swapped slot counts where it really lands).
 */
function slotsBefore(battle, unitId, plan, slot) {
  const running = battle.status === 'running' || battle.status === 'asking';
  const sched = running ? battle.schedule || [] : [];
  const at = sched.findIndex((e) => e.unitId === unitId && e.slot === slot);
  if (!running || at < 0) return plan.slots.map((_, s) => s).filter((s) => s < slot);
  const out = [];
  for (let i = battle.cursor; i < at; i += 1) if (sched[i].unitId === unitId) out.push(sched[i].slot);
  return out;
}

/**
 * The battle as the unit would stand before `slot`: its tile, attacks, heat, charges and uses after the
 * slots that resolve before it. With `examine` (legalActions), an earlier Examine has examined its target
 * too (§18.3), so Name a step can follow it in one plan; odds keep '?' until the Examine resolves (COMBAT §3.7).
 */
export function project(battle, unitId, plan, slot, ctx, { examine = false } = {}) {
  const u0 = unitIn(battle, unitId);
  if (!u0 || !plan) return battle;
  const before = slotsBefore(battle, unitId, plan, slot);
  if (!before.length) return battle;
  const u = JSON.parse(JSON.stringify(u0));
  const examined = new Set();
  for (const s of before) {
    const a = plan.slots[s];
    if (!a) continue;
    if (examine && a.id === 'examine' && a.target?.unit && a.target.unit !== unitId) examined.add(a.target.unit);
    // Each earlier action is one taken this turn (the first-action edge reads it).
    if (a.id !== 'delay') u.usedRound = { ...(u.usedRound || {}), '#acted': (u.usedRound?.['#acted'] || 0) + 1 };
    if ((a.id === 'stride' || a.id === 'step' || a.id === 'jump') && a.target) {
      const end = a.target.path?.length ? a.target.path[a.target.path.length - 1] : a.target.tile;
      if (end) {
        u.x = end.x;
        u.y = end.y;
      }
    }
    const attack = a.id === 'strike' || a.id === 'throw' || a.id === 'shove' || (a.id === 'use' && (ability(ctx, a.ability)?.attack
      || (specFor(ability(ctx, a.ability), a)?.effects || []).some((e) => e.do === 'act' && e.action === 'strike')));
    if (attack) {
      const light = (a.id === 'strike' || a.id === 'throw') && u.strike?.weapon === 'light';
      u.heat = clampHeat(u.heat + attackPenalty(u.attacks || 0, { light }).heat);
      u.attacks = (u.attacks || 0) + 1;
    }
    if (a.id === 'cool-down') u.heat = Math.max(0, u.heat - ctx.rules.heat.coolDown);
    if (a.id === 'use') {
      const ab = ability(ctx, a.ability);
      if (ab?.kind === 'spell' && ab.circle > 0) u.charges = { ...u.charges, left: Math.max(0, u.charges.left - (u.charges.pool === 'pact' ? 1 : ab.circle + (a.extra || 0))) };
      if (ab?.uses && ['breather', 'campfire', 'fight'].includes(ab.uses.per)) u.uses = { ...u.uses, [ab.id]: Math.max(0, (u.uses?.[ab.id] ?? numOf(ab.uses.n, u)) - 1) };
      if (ab?.uses && (ab.uses.per === 'turn' || ab.uses.per === 'round')) u.usedRound = { ...u.usedRound, [ab.id]: (u.usedRound?.[ab.id] || 0) + 1 };
      if (ab?.uses?.per === 'target-round') {
        for (const id of a.target?.units || (a.target?.unit ? [a.target.unit] : [])) u.usedRound = { ...u.usedRound, [`${ab.id}@${id}`]: (u.usedRound?.[`${ab.id}@${id}`] || 0) + 1 };
      }
    }
  }
  const seen = (v) => (examined.has(v.id) && !v.examined ? { ...v, examined: true, revealedUntil: v.side !== u.side ? 'fight' : v.revealedUntil } : v);
  return { ...battle, units: battle.units.map((v) => (v.id === unitId ? u : seen(v))) };
}

/** Every legal action for a unit at a plan slot: basic, its abilities, and mechanic and bow actions. */
export function legalActions(battle, unitId, ctx, { slot = 0, plan = null } = {}) {
  const p = plan || battle.plans?.[unitId] || null;
  const b = project(battle, unitId, p, slot, ctx, { examine: true });
  const out = [...basicActions(b, unitId, ctx), ...abilityActions(b, unitId, ctx)];
  if (b.lead) {
    const mech = (ctx.mechanics || {})[b.lead.mechanic] || (ctx.mechanics || {}).fallback;
    if (mech?.actions) out.push(...(mech.actions(b, unitId, ctx) || []));
  }
  if (ctx.bows?.actions) out.push(...(ctx.bows.actions(b, unitId, ctx) || []));
  return out;
}

function rollsFor(b, ctx, unitId, action, grid) {
  const u = unitIn(b, unitId);
  if (!u || !action) return [];
  const tgt = action.target || {};
  const target = tgt.unit ? unitIn(b, tgt.unit) : null;
  switch (action.id) {
    // No row through a blocked line (§4.17: grid.cover null): such a Strike never picks, it improvises.
    // A target out of reach still shows, since it may come to you before the slot (COMBAT §3.7).
    case 'strike': return target && grid.sees(u, target) ? [{ targetId: target.id, pk: strikePk(u, target, { cheer: !!action.cheer }), dmg: 'strike' }] : [];
    case 'throw':
      if (action.ability === 'cordial' || !target) return [];
      return [{ targetId: target.id, pk: { harmful: true, meets: 'guard', attack: true, light: u.strike?.weapon === 'light', ranged: true, cheer: !!action.cheer }, dmg: 'throw' }];
    case 'shove': return target && grid.sees(u, target) ? [{ targetId: target.id, pk: { harmful: true, meets: 'body', attack: true, cheer: !!action.cheer } }] : [];
    case 'brace': return [{ targetId: u.id, pk: { helpful: true, cheer: !!action.cheer } }];
    case 'assist': return tgt.units?.[0] ? [{ targetId: tgt.units[0], pk: { helpful: true, cheer: !!action.cheer } }] : [];
    case 'hide': return hideRoll(b, ctx, u);
    case 'sustain': {
      // A Sustain lands the spell's effects again, on the targets it was cast on.
      const s = (b.sustained || []).find((x) => x.unitId === u.id && (!action.ability || x.abilityId === action.ability));
      const a = s && ability(ctx, s.abilityId);
      if (!a) return [];
      const use = { cost: s.cost, target: s.target, choice: null, extra: 0, cheer: false };
      return abilityRolls(b, ctx, unitId, a, use).map((r) => ({ ...r, dmg: r.act ? 'strike' : 'ability', a, use }));
    }
    case 'use': {
      const a = ability(ctx, action.ability);
      if (!a) return [];
      const use = { cost: action.cost, target: action.target, choice: action.choice, extra: action.extra || 0, cheer: !!action.cheer };
      return abilityRolls(b, ctx, unitId, a, use).map((r) => ({ ...r, dmg: r.act ? 'strike' : 'ability', a, use }));
    }
    default: return [];
  }
}

/** The pick plan of an ability use: one entry per target it rolls for, with its pick kind. */
export function abilityRolls(battle, ctx, unitId, a, use, extra = {}) {
  const run = { b: battle, ctx, rules: ctx.rules, events: [], g: null, scratch: {} };
  const u = unitIn(battle, unitId);
  if (!u || !a) return [];
  const spec = specFor(a, use);
  if (!spec) return [];
  const effects = spec.effects || [];
  const firstAct = effects.findIndex((e) => e.do === 'act');
  const before = firstAct < 0 ? effects : effects.slice(0, firstAct);
  const acts = effects.filter((e) => e.do === 'act');
  const { units } = targetsOfUse(run, u, a, spec, use);
  const sure = leadingSure(spec);
  // An `act` Strike rolls only on what it can reach, unless the use moves its user first (Pounce).
  const movesFirst = acts.some((e) => e.action === 'stride' || e.action === 'step');
  const out = [];
  for (const id of units) {
    const v = unitIn(battle, id);
    if (!v) continue;
    const own = a.outcome !== false && before.some((e) => needsDegree(e, u, e.to === 'self' ? u : v, a));
    if (own) out.push({ targetId: id, pk: pkFor(run, u, a, v, use, extra) });
    for (const e of acts) {
      if (e.action === 'strike' && v.side !== u.side && (movesFirst || canStrike(gridOf(run), u, v))) {
        out.push({ targetId: id, pk: strikePk(u, v, { cheer: !!use.cheer, reaction: !!extra.reaction, ability: true, sure }), act: true });
      }
      if (e.action === 'brace') out.push({ targetId: u.id, pk: { helpful: true, cheer: !!use.cheer }, act: true });
    }
  }
  // A Hide it makes picks once, against the watchers' best mind Resolve (from where the user stands now).
  if (acts.some((e) => e.action === 'hide')) out.push(...hideRoll(battle, ctx, u).map((r) => ({ ...r, act: true })));
  return out;
}

/** A Hide's one pick, when anyone watches: against the watchers' best mind Resolve (§4.4). */
function hideRoll(b, ctx, u) {
  const g = createGrid(b, ctx.rules);
  const watchers = b.units.filter((v) => standing(v) && v.side !== u.side && v.side !== 'neutral' && v.rank !== 'device' && g.sees(v, u));
  if (!watchers.length) return [];
  const best = watchers.reduce((m, v) => Math.max(m, resolveOf(b, v, 'mind', ctx)), 0);
  return [{ targetId: null, pk: { harmful: false, resolveOverride: best } }];
}

/**
 * The first damage (or patch) an ability use would deal a target, before the degree and defences:
 * { amount, kind, patch } or null (the planner's amounts).
 */
export function abilityAmount(battle, ctx, unitId, a, use, targetId) {
  const run = { b: battle, ctx, rules: ctx.rules, events: [], g: null, scratch: {} };
  const u0 = unitIn(battle, unitId);
  const t = targetId ? unitIn(battle, targetId) : null;
  const spec = a && specFor(a, use);
  if (!u0 || !spec) return null;
  const u = jsonCopy(u0);
  for (const e of spec.effects || []) {
    if (e.do === 'damage') {
      const kind = e.kind === 'caster' || !e.kind ? casterKind(u, ctx.rules) : e.kind === 'weapon' ? u.strike?.kind || 'plain' : e.kind;
      return { amount: lineAmount(run, u, e, t, a, use), kind, patch: false };
    }
    if (e.do === 'patch') {
      const amount = e.ofMax !== undefined && t ? Math.floor(t.maxIntegrity * numOf(e.ofMax, u)) : lineAmount(run, u, e, t, a, use);
      return { amount, kind: null, patch: true };
    }
    if (e.do === 'act' && e.action === 'strike' && t) return { ...strikeDamage(run, u, t, { dry: true }), patch: false };
  }
  return null;
}

const cleanOdds = (o) => ({
  bars: o.bars, band: o.band, heat: o.heat, edge: o.edge, parts: o.parts, amounts: o.amounts, known: o.known, helpful: o.helpful, cheer: o.cheer,
  words: o.words, critInReach: o.critInReach, changeable: o.changeable,
});

/** §7.1: the Odds for each outcome an action would pick, projected through the plan's earlier slots. */
export function oddsFor(battle, unitId, action, ctx, opts = {}) {
  return oddsByTarget(battle, unitId, action, ctx, opts).map((r) => r.odds);
}

/** oddsFor's rows with the unit each is for: [{ targetId, odds }], in the order the action picks them. */
export function oddsByTarget(battle, unitId, action, ctx, { slot = 0, plan = null } = {}) {
  const p = plan || battle.plans?.[unitId] || null;
  const b = project(battle, unitId, p, slot, ctx);
  const u = unitIn(b, unitId);
  if (!u) return [];
  const grid = createGrid(b, ctx.rules);
  const rolls = rollsFor(b, ctx, unitId, action, grid);
  const ticks = p ? ticksOf(p, u) : [];
  const myTick = ticks.find((t) => t.slot === slot)?.ends ?? slot + 1;
  const out = [];
  for (const r of rolls) {
    const o = oddsAgainst(b, ctx, unitId, r.targetId, r.pk, grid);
    const target = r.targetId ? unitIn(b, r.targetId) : null;
    if (target && r.pk.harmful && r.dmg) {
      let base = null;
      let kind = null;
      if (r.dmg === 'strike') {
        const s = strikeDamage({ b, ctx, rules: ctx.rules, g: grid }, JSON.parse(JSON.stringify(u)), target, { ranged: r.pk.ranged, edge: o.edge, dry: true });
        base = s.amount;
        kind = s.kind;
      } else if (r.dmg === 'throw') {
        base = line(ctx.rules, 'one', Math.max(1, u.level)) + (u.keyAdjust || 0) + (u.flat || 0);
        kind = 'plain';
      } else if (r.a) {
        const d = abilityAmount(b, ctx, unitId, r.a, r.use, target.id);
        if (d && !d.patch) {
          base = d.amount;
          kind = d.kind;
        }
      }
      if (base !== null) {
        const def = o.known ? defencesTo(b, ctx, target, kind, grid) : { resist: 0, weak: 0 };
        const scale = u.side !== 'party' && effMode(b) === 'storybook' ? ctx.rules.modes.storybook.damage : 1;
        o.amounts = ['crit', 'hit', 'graze', 'miss'].map((d) => damageSteps({ amount: base, degree: d, weak: def.weak, resist: def.resist, scale }).amount);
      }
    } else if (r.a && target) {
      const d = abilityAmount(b, ctx, unitId, r.a, r.use, target.id);
      if (d && d.patch) o.amounts = ['crit', 'hit', 'graze', 'graze'].map((deg) => (deg === 'crit' ? d.amount * 2 : deg === 'graze' ? Math.floor(d.amount / 2) : d.amount));
    }
    o.changeable = (b.telegraphs || []).some((t) => t.tick < myTick && ((t.icon === 'move' && (t.unitId === r.targetId || t.unitId === unitId)) || ['mechanic', 'surface', 'area'].includes(t.icon)));
    out.push({ targetId: r.targetId ?? null, odds: cleanOdds(o) });
  }
  return out;
}

/** The planner's likeliest trouble for a hero's plan. */
export function trouble(battle, unitId, plan, ctx) {
  const out = [];
  const u = unitIn(battle, unitId);
  if (!u || !plan) return out;
  const ticks = ticksOf(plan, u);
  const tickOf = (s) => ticks.find((t) => t.slot === s)?.ends ?? s + 1;
  plan.slots.forEach((a, slot) => {
    const t = ticks.find((x) => x.slot === slot);
    if (t?.lost) {
      out.push({ slot, words: 'This won’t fit in the round.' });
      return;
    }
    const targetId = a?.target?.unit;
    const target = targetId ? unitIn(battle, targetId) : null;
    if (target && target.side !== u.side && target.side !== 'neutral') {
      let before = 0;
      for (const [id, p] of Object.entries(battle.plans || {})) {
        if (id === unitId) continue;
        const v = unitIn(battle, id);
        if (!v || v.side !== u.side || !standing(v)) continue;
        const vt = ticksOf(p, v);
        p.slots.forEach((x, s2) => {
          const end = vt.find((q) => q.slot === s2)?.ends;
          if (!end || end > tickOf(slot) || x?.target?.unit !== targetId || x.id !== 'strike') return;
          before += ((v.strike?.amount || 0) + (v.keyAdjust || 0)) * expected(barsFor(v.heat, 0));
        });
      }
      if (before >= target.integrity) out.push({ slot, words: `${target.name} may be sorted before this.` });
    }
    if ((a?.id === 'stride' || a?.id === 'step') && a.target) {
      const aimed = (battle.telegraphs || []).find((x) => x.targets?.includes(unitId) && x.tick > tickOf(slot) && ['strike', 'bite', 'shoot'].includes(x.icon));
      if (aimed) out.push({ slot, words: `${unitIn(battle, aimed.unitId)?.name || 'A stray'} means to hit you here after you’ve moved.` });
    }
  });
  return out;
}

export { levelOf, condOf, dist };
