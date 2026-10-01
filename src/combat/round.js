// The round (CONTRACT-PHASE4.md §4.2, §4.3, §4.16, §5.5, §5.7; COMBAT.md §3.2, §3.5, §3.6):
// ticks, the schedule and genre noise, plain telegraphs, the stat and odds core every pick uses
// (so the odds shown are the odds used), and what happens mid-action: reactions, surfaces and
// movement with its triggers. Pure. It and effects.js import each other; neither uses the
// other's bindings at module top level, so the cycle is safe.
import { hashInts, unit as unitOf01 } from '../world/rng.js';
import { degreeAt } from './heat.js';
import { BANDS, bandOf, coolerBand, shiftBars, foldBars, attackPenalty, oddsWords, clampHeat, shiftDegree } from './heat.js';
import { modeRoomLevel, strayRow, line, surfaceGrowth } from './rules.js';
import { createGrid, dist, footprint, unitDist, foeDistances, cameCloser } from './grid.js';
import { actionWords, tileName } from './describe.js';
import {
  emit, gridOf, dirty, U, addCondition, endCondition, landHit, pickOutcome, doStrike, applySpec, syncLantern, flushLight, AskSignal,
  mechanicOf, hook, patchUnit, carrierOf, setHeat, resetCalm, consumeUntil, jsonCopy, areaTiles, revealLit, ghostInDark, canStrike, canStep,
  stirRound,
} from './effects.js';

// ---------- small lookups ----------

export const unitIn = (battle, id) => {
  const list = battle.units;
  for (let i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
  return null;
};
export const standing = (u) => !!u && !u.sorted && !u.offline;
export const condOf = (u, id) => (u?.conditions || []).find((c) => c.id === id) || null;
export const hasCond = (u, id) => !!condOf(u, id);
export const condN = (u, id) => condOf(u, id)?.n ?? 0;
export const asleep = (u) => hasCond(u, 'drowsy');
export const ability = (ctx, id) => (id && ctx?.abilities?.get ? ctx.abilities.get(id) || null : null);

/** The mode a fight's numbers use: the first Tale-lead always plays as Storybook. */
export const effMode = (battle) => (battle.firstLead ? 'storybook' : battle.mode);

/** The room's level after the mode (Storybook max(1, n − 1), Maud's Table n + 1). */
export const roomLevel = (battle, rules) => modeRoomLevel(rules, battle.level, effMode(battle));

/** A unit's level for edge: foes shift with the mode; at Road levels 1–2 nothing counts as more than 2 above. */
export function levelOf(battle, u, rules) {
  if (!u) return 0;
  if (u.side === 'party') return u.level;
  const shift = rules?.modes?.[effMode(battle)]?.foeLevel ?? 0;
  let lvl = Math.max(0, u.level + shift);
  if (battle.roadLevel <= 2) lvl = Math.min(lvl, battle.roadLevel + 2);
  return lvl;
}

/** Idle heat: the spec's, plus Maud's Table's +15 for party units while that mode applies. */
export function idleHeatOf(battle, u, rules) {
  const maud = u.side === 'party' && u.rank !== 'device' && effMode(battle) === 'mauds-table' ? rules?.heat?.maudsIdle ?? 15 : 0;
  return clampHeat((u.idleHeat || 0) + maud);
}

/** Num: a number, { byLevel }, 'wit' or 'charm' (the user's ability, at least 1). */
export function numOf(value, u) {
  if (typeof value === 'number') return value;
  if (value === 'wit' || value === 'charm') return Math.max(1, u?.abilities?.[value] ?? 1);
  if (value && typeof value === 'object' && value.byLevel) {
    const lvl = u?.level ?? 1;
    let best = null;
    let bestKey = -Infinity;
    for (const [k, v] of Object.entries(value.byLevel)) {
      const key = Number(k);
      if (key <= lvl && key > bestKey) {
        bestKey = key;
        best = v;
      }
    }
    if (best === null) {
      const keys = Object.keys(value.byLevel).map(Number).sort((a, b) => a - b);
      best = keys.length ? value.byLevel[String(keys[0])] : 0;
    }
    return Number(best) || 0;
  }
  return 0;
}

const passivesOf = (ctx, u) => {
  const out = [];
  for (const id of u.abilityIds || []) {
    const a = ability(ctx, id);
    if (a && a.kind === 'passive' && a.passive && !a.stub) out.push(a);
  }
  return out;
};

/** True when a unit has a passive with the named rule (§6.5). */
export function hasRule(ctx, u, ruleId) {
  if (!u) return false;
  for (const a of passivesOf(ctx, u)) if ((a.passive.rules || []).includes(ruleId)) return true;
  return false;
}

/** The Hooklight entry in Battle.lights, or null. */
export const hooklight = (battle) => (battle.lights || []).find((l) => l.id === 'hooklight') || null;
export function inHooklight(battle, tile) {
  const l = hooklight(battle);
  return !!l && l.radius > 0 && (tile.size ? footprint(tile).some((t) => dist(l, t) <= l.radius) : dist(l, tile) <= l.radius);
}

function auraRadius(battle, owner, radius, ctx) {
  if (radius === 'light') {
    const l = hooklight(battle);
    return l && owner.kind === 'milo' ? l.radius : 0;
  }
  return numOf(radius, owner);
}

/** The sum of a stat's modifiers on a unit: its own mods, its passives, and auras around it. */
export function modSum(battle, u, stat, ctx) {
  let sum = 0;
  for (const m of u.mods || []) if (m.stat === stat) sum += m.by;
  for (const a of passivesOf(ctx, u)) for (const m of a.passive.mods || []) if (m.stat === stat) sum += numOf(m.by, u);
  for (const v of battle.units) {
    if (!standing(v)) continue;
    for (const a of passivesOf(ctx, v)) {
      const aura = a.passive.aura;
      if (!aura || !(aura.mods || []).some((m) => m.stat === stat)) continue;
      const self = v.id === u.id;
      const ok = aura.who === 'foes' ? v.side !== u.side && !self : v.side === u.side && (aura.who === 'allies-and-self' || !self);
      if (!ok) continue;
      const r = auraRadius(battle, v, aura.radius, ctx);
      if (r <= 0 || unitDist(v, u) > r) continue;
      for (const m of aura.mods) if (m.stat === stat) sum += numOf(m.by, v);
    }
  }
  return sum;
}

/** Speed; for a Stride, also its next-Stride mods and Wayward's one more tile (§6.5 `wayward-path`). */
export function speedOf(battle, u, ctx, { stride = false } = {}) {
  let s = (u.speed || 0) + modSum(battle, u, 'speed', ctx);
  if (stride) s += modSum(battle, u, 'speed-next-stride', ctx) + (hasRule(ctx, u, 'wayward-path') ? 1 : 0);
  return Math.max(0, s);
}

export function guardOf(battle, u, ctx) {
  const brisk = hasCond(u, 'brisk') ? 1 : 0;
  return Math.max(0, Math.min(2, (u.guard || 0) + modSum(battle, u, 'guard', ctx) + brisk));
}

export function resolveOf(battle, u, which, ctx) {
  const set = (u.mods || []).filter((m) => m.stat === 'resolve-set').map((m) => m.by);
  let r = (u.resolve?.[which] || 0) + modSum(battle, u, `resolve-${which}`, ctx);
  if (set.length) r = Math.max(r, ...set);
  return Math.max(0, Math.min(2, r));
}

const CASTER_KINDS = { milo: 'light', claude: 'ink', codex: 'spark', jev: 'plain', tollkeeper: 'plain' };

/** The user's own kind for `kind: 'caster'`: Light for Milo, Ink, Spark, Plain…, or a genre's kind. */
export function casterKind(u, rules) {
  if (CASTER_KINDS[u.kind]) return CASTER_KINDS[u.kind];
  const g = u.genres?.[0];
  if (g && rules?.genres?.[g]?.kind) return rules.genres[g].kind;
  return u.strike?.kind || 'plain';
}

export const isShadow = (u, rules) => (u.genres || []).some((g) => rules?.genres?.[g]?.shadow);

/** Genre noise that plays this round: none with the switch off or in Storybook; the room's first genre on Long Road; every genre at Maud's Table. */
export function noiseGenres(battle, rules) {
  if (!battle.calm?.noise || effMode(battle) === 'storybook') return [];
  const genres = battle.genres || [];
  const picked = effMode(battle) === 'mauds-table' ? genres : genres.slice(0, 1);
  const out = [];
  for (const g of [...picked, ...genres.filter((x) => x === 'starlight')]) {
    if (rules?.genres?.[g]?.noise && !out.includes(g)) out.push(g);
  }
  return out;
}
const noiseRate = (rules, g) => {
  const r = rules.genres[g]?.noise?.rate;
  if (Array.isArray(r)) return r[0] / r[1];
  return typeof r === 'number' ? r : 0;
};

// ---------- ticks ----------

const fresh = (c) => !!c?.data?.fresh;

/** §4.4's fixed costs (a Reboot is 2, or 1 when its ally's mods allow; a use costs what its ability lists). */
export const BASIC_COST = Object.freeze({
  stride: 1, step: 1, strike: 1, brace: 1, examine: 1, seek: 1, interact: 1, assist: 1, 'talk-down': 1, 'cool-down': 1, hide: 1, throw: 1,
  shove: 1, jump: 1, dip: 1, sustain: 1, ready: 2, delay: 0, 'head-home': 0,
});

/**
 * §5.5: ticks for each slot. t starts at 1; Delay waits a tick; any other action starts at t and
 * resolves at the end of t + cost − 1. An action that would end after the unit's last tick is lost.
 * A Ready's next slot fires as a reaction instead ({ readied: true }).
 */
export function ticksOf(plan, u) {
  const out = [];
  const conds = (u?.conditions || []).filter((c) => !fresh(c));
  const has = (id) => conds.find((c) => c.id === id);
  const slowed = has('slowed')?.n || 0;
  const winded = has('winded') ? 1 : 0;
  const brisk = !!has('brisk') && !has('quickened');
  const quick = !!(has('quickened') || has('brisk'));
  const surprised = (u?.mods || []).some((m) => m.stat === 'surprised');
  const full = quick ? 4 : 3;
  const max = surprised ? 0 : full - slowed - winded;
  let t = 1;
  let readied = -1;
  let readyEnds = null;
  (plan?.slots || []).forEach((a, slot) => {
    if (slot === readied) {
      out.push({ slot, tick: readyEnds, ends: null, lost: null, readied: true });
      return;
    }
    if (!a || a.id === 'delay') {
      out.push({ slot, tick: t, ends: null, lost: null });
      t += 1;
      return;
    }
    // 0-action moves (Head home, Burn an essence, Surge) resolve in tick t and t doesn't advance. A
    // basic action takes §4.4's cost whatever the plan says (a Reboot 2, or 1); a use's cost is checked
    // against its ability when the plan is set (battle.js's legalCost).
    const fixed = a.id === 'reboot' ? (Number(a.cost) === 1 ? 1 : 2) : BASIC_COST[a.id];
    const cost = fixed ?? (a.id === 'use' && Number(a.cost) === 0 ? 0 : Math.max(1, Math.trunc(Number(a.cost) || 1)));
    const ends = cost === 0 ? t : t + cost - 1;
    let lost = null;
    if (ends > max) {
      if (surprised) lost = 'asleep';
      else if (ends > full) lost = 'wont-fit';
      else if (slowed > 0) lost = 'slowed';
      else lost = 'winded';
    } else if (brisk && ends === 4 && a.id !== 'stride' && a.id !== 'strike') lost = 'wont-fit';
    out.push({ slot, tick: t, ends, lost });
    if (!lost && a.id === 'ready') {
      readied = slot + 1;
      readyEnds = ends;
    }
    if (cost > 0) t = ends + 1;
  });
  return out;
}

// ---------- the schedule and noise ----------

export const NOISE_FLAGS = Object.freeze({ lag: 1, swap: 2, backlog: 4, fastest: 8, repeat: 16 });

function patchUnder(battle, ctx, action, rules) {
  if (!action || action.id !== 'use') return false;
  const a = ability(ctx, action.ability);
  if (!a) return false;
  const spec = a.by?.[String(action.cost)] || (a.choices && action.choice ? a.choices[action.choice] : null) || a;
  const heals = (spec.effects || []).some((e) => e.do === 'patch');
  if (!heals) return false;
  const ids = action.target?.units || (action.target?.unit ? [action.target.unit] : []);
  return ids.some((id) => {
    const t = unitIn(battle, id);
    return t && t.side === 'party' && t.integrity < t.maxIntegrity / 4;
  });
}

/** Noise never delays or sleeps through a Reboot, or a patch on an ally under a quarter of their Integrity. */
export function noiseExempt(battle, ctx, action) {
  if (!action) return false;
  if (action.id === 'reboot') return true;
  if (action.id === 'use') {
    const a = ability(ctx, action.ability);
    const spec = a && (a.by?.[String(action.cost)] || (a.choices && action.choice ? a.choices[action.choice] : null) || a);
    if ((spec?.effects || []).some((e) => e.do === 'reboot' || (e.do === 'rule' && e.id === 'lantern-calls'))) return true;
  }
  return patchUnder(battle, ctx, action, ctx?.rules);
}

/** The round's schedule with noise flags (internal): [{ unitId, slot, tick, late, flags }]. */
export function buildSchedule(battle, ctx) {
  const rules = ctx.rules;
  let entries = [];
  battle.order.forEach((id, ribbon) => {
    const u = unitIn(battle, id);
    const plan = battle.plans?.[id];
    if (!u || !plan || u.sorted || u.offline) return;
    for (const t of ticksOf(plan, u)) {
      if (t.lost || t.ends === null || t.readied) continue;
      entries.push({ unitId: id, slot: t.slot, tick: t.ends, late: false, flags: 0, ribbon });
    }
  });
  // Borrow a rule (Frontier): a unit with first-in-tick acts first in every tick.
  const first = (id) => ((unitIn(battle, id)?.mods || []).some((m) => m.stat === 'first-in-tick') ? 0 : 1);
  entries.sort((a, b) => a.tick - b.tick || first(a.unitId) - first(b.unitId) || a.ribbon - b.ribbon || a.slot - b.slot);
  const genres = noiseGenres(battle, rules);
  const ids = new Set(genres.map((g) => rules.genres[g].noise.id));
  const exempt = (e) => noiseExempt(battle, ctx, battle.plans[e.unitId]?.slots?.[e.slot]);
  const maxTick = () => Math.max(3, ...entries.map((e) => e.tick));
  const byTick = () => {
    const m = new Map();
    for (const e of entries) {
      if (!m.has(e.tick)) m.set(e.tick, []);
      m.get(e.tick).push(e);
    }
    return m;
  };
  const flatten = (m) => [...m.keys()].sort((a, b) => a - b).flatMap((t) => m.get(t));
  if (ids.has('fastest-gun')) {
    const m = byTick();
    for (const [tick, list] of m) {
      if (list.length < 2) continue;
      let fast = null;
      for (const e of list) {
        const u = unitIn(battle, e.unitId);
        if (!fast || u.speed > fast.speed) fast = u;
      }
      // A Reboot or an urgent patch ahead of the fastest keeps its place (noise never delays them).
      const at = list.findIndex((e) => e.unitId === fast.id);
      const kept = list.slice(0, at).filter(exempt);
      const front = list.filter((e) => e.unitId === fast.id);
      const rest = list.filter((e) => e.unitId !== fast.id && !kept.includes(e));
      if (at > kept.length) for (const e of front) e.flags |= NOISE_FLAGS.fastest;
      m.set(tick, [...kept, ...front, ...rest]);
    }
    entries = flatten(m);
  }
  if (ids.has('lag')) {
    const rate = noiseRate(rules, 'neon');
    const late = [];
    const keep = [];
    for (const e of entries) {
      const h = hashInts(battle.seed, battle.attempt, battle.round, e.tick, e.ribbon, e.slot, 'noise:neon');
      if (!exempt(e) && unitOf01(h) < rate) {
        e.flags |= NOISE_FLAGS.lag;
        e.late = true;
        late.push(e);
      } else keep.push(e);
    }
    const m = new Map();
    for (const e of keep) {
      if (!m.has(e.tick)) m.set(e.tick, []);
      m.get(e.tick).push(e);
    }
    for (const e of late) {
      e.tick = Math.min(4, e.tick + 1);
      if (!m.has(e.tick)) m.set(e.tick, []);
    }
    for (const e of late) m.get(e.tick).push(e);
    entries = flatten(m);
  }
  if (ids.has('out-of-order')) {
    const rate = noiseRate(rules, 'void');
    const m = byTick();
    for (const [tick, list] of m) {
      if (list.length < 2) continue;
      const h = hashInts(battle.seed, battle.attempt, battle.round, tick, 'noise:void-pair');
      if (unitOf01(h) >= rate) continue;
      const i = hashInts(h, 'pair') % (list.length - 1);
      if (exempt(list[i]) || exempt(list[i + 1])) continue;
      [list[i], list[i + 1]] = [list[i + 1], list[i]];
      list[i].flags |= NOISE_FLAGS.swap;
      list[i + 1].flags |= NOISE_FLAGS.swap;
    }
    entries = flatten(m);
  }
  if (ids.has('backlog')) {
    const cap = rules.genres.iron.noise.cap || 4;
    const m = byTick();
    const last = maxTick();
    for (let tick = 1; tick <= last; tick += 1) {
      const list = m.get(tick) || [];
      if (list.length <= cap) continue;
      const exempts = list.filter(exempt);
      const others = list.filter((e) => !exempt(e));
      const room = Math.max(0, cap - exempts.length);
      const stay = new Set([...exempts, ...others.slice(0, room)]);
      const wait = list.filter((e) => !stay.has(e));
      for (const e of wait) e.flags |= NOISE_FLAGS.backlog;
      if (tick === last) {
        // The last tick's overflow waits for the end of the round: after everything else in it.
        m.set(tick, [...list.filter((e) => stay.has(e)), ...wait]);
        continue;
      }
      m.set(tick, list.filter((e) => stay.has(e)));
      for (const e of wait) e.tick = tick + 1;
      m.set(tick + 1, [...wait, ...(m.get(tick + 1) || [])]);
    }
    entries = flatten(m);
  }
  if (ids.has('hum')) {
    const foes = entries.filter((e) => unitIn(battle, e.unitId)?.side === 'foe');
    if (foes.length) {
      const h = hashInts(battle.seed, battle.attempt, battle.round, 'noise:hum');
      const src = foes[h % foes.length];
      entries.push({ ...src, tick: maxTick(), late: true, flags: src.flags | NOISE_FLAGS.repeat });
    }
  }
  return entries.map(({ unitId, slot, tick, late, flags }) => ({ unitId, slot, tick, late, flags }));
}

/** §7.1: the round's schedule in ribbon order, then noise. */
export function schedule(battle, ctx) {
  return buildSchedule(battle, ctx).map(({ unitId, slot, tick, late }) => ({ unitId, slot, tick, late }));
}

const GENRE_WORDS = {
  neon: 'Neon', nocturne: 'Nocturne', gothic: 'Gothic', iron: 'Iron', void: 'Void', noir: 'Noir', frontier: 'Frontier', kaiju: 'Titan',
  verdant: 'Verdant', starlight: 'Starlight', summit: 'Summit', backhalls: 'Backhalls',
};
export const genreName = (g) => GENRE_WORDS[g] || g;
const NOISE_WORDS = {
  lag: 'lag. About 1 action in 5 lands a tick late.',
  'nodding-off': 'nodding off. About 1 action in 6 is slept through.',
  'out-of-order': 'out of order. About 1 tick in 4, two actions swap places.',
  backlog: 'backlog. At most 4 actions resolve in a tick; the rest wait.',
  'fastest-gun': 'fastest gun. The fastest goes first in every tick.',
  'guttering-candles': 'guttering candles. Plans over dark tiles stay hidden until they happen.',
  tremor: 'tremor. A row of tiles turns to rough ground each round.',
  hum: 'the hum. One stray action repeats at the end of the round.',
  'kind-noise': 'kind noise. About 1 Hit in 10 becomes a Critical.',
};

/** The noise banner shown before Run: 'Neon: lag. About 1 action in 5 lands a tick late.' */
export function noiseBanner(battle, rules = null) {
  const r = rules;
  const genres = r ? noiseGenres(battle, r) : defaultNoiseGenres(battle);
  if (!genres.length) return null;
  const words = genres.map((g) => `${genreName(g)}: ${NOISE_WORDS[(r?.genres?.[g]?.noise?.id) || DEFAULT_NOISE[g]]}`).join(' ');
  return { genres, words };
}
const DEFAULT_NOISE = { neon: 'lag', nocturne: 'nodding-off', gothic: 'guttering-candles', iron: 'backlog', void: 'out-of-order', frontier: 'fastest-gun', kaiju: 'tremor', backhalls: 'hum', starlight: 'kind-noise' };
function defaultNoiseGenres(battle) {
  if (!battle.calm?.noise || effMode(battle) === 'storybook') return [];
  const genres = battle.genres || [];
  const picked = effMode(battle) === 'mauds-table' ? genres : genres.slice(0, 1);
  const out = [];
  for (const g of [...picked, ...genres.filter((x) => x === 'starlight')]) if (DEFAULT_NOISE[g] && !out.includes(g)) out.push(g);
  return out;
}

// ---------- plain telegraphs ----------

function iconFor(battle, u, action, ctx) {
  switch (action.id) {
    case 'strike': {
      if (u.strike?.range > 0) return 'shoot';
      if (u.strike?.weapon === 'natural') return 'bite';
      return 'strike';
    }
    case 'stride': case 'step': case 'jump': return 'move';
    case 'brace': case 'assist': return 'brace';
    case 'shove': return 'shove';
    case 'talk-down': return 'talk';
    case 'hide': return 'hide';
    case 'examine': case 'seek': return 'examine';
    case 'delay': case 'cool-down': case 'ready': case 'sustain': return 'wait';
    case 'throw': return 'shoot';
    case 'reboot': return 'patch';
    case 'interact': return 'mechanic';
    case 'aside': return 'mechanic';
    case 'use': {
      if (String(action.ability || '').startsWith('mech:')) return 'mechanic';
      const a = ability(ctx, action.ability);
      if (!a) return 'cast';
      const spec = a.by?.[String(action.cost)] || (a.choices && action.choice ? a.choices[action.choice] : null) || a;
      const effects = spec.effects || [];
      if (spec.target?.area) return 'area';
      if (effects.some((e) => e.do === 'summon')) return 'summon';
      if (effects.some((e) => e.do === 'surface')) return 'surface';
      if (effects.some((e) => e.do === 'patch')) return 'patch';
      if (effects.some((e) => e.do === 'act' && e.action === 'strike')) return u.strike?.weapon === 'natural' ? 'bite' : 'strike';
      if (effects.some((e) => e.do === 'move' && e.how === 'push')) return 'shove';
      return 'cast';
    }
    default: return 'strike';
  }
}

/** The units an action names (a telegraph's real targets). */
export function targetsOf(action) {
  const t = action?.target;
  if (!t) return [];
  if (t.units) return [...t.units];
  if (t.unit) return [t.unit];
  return [];
}

function tilesOf(battle, u, action, ctx) {
  const t = action?.target;
  const a = action?.id === 'use' ? ability(ctx, action.ability) : null;
  const spec = a && (a.by?.[String(action.cost)] || (a.choices && action.choice ? a.choices[action.choice] : null) || a);
  const area = spec?.target?.area;
  if (area && u) {
    const wit = (u.abilities?.wit ?? 0) >= 3 && a.kind === 'spell' && (action.cost || 1) >= 2 ? 1 : 0;
    const tiles = areaTiles(battle, createGrid(battle, ctx?.rules), u, area, t, wit, area.at === 'self' || spec.target.who === 'self');
    if (tiles) return tiles;
  }
  if (!t) return [];
  if (t.path?.length) return [t.path[t.path.length - 1]];
  if (t.tile) return [t.tile];
  const ids = targetsOf(action);
  const out = [];
  for (const id of ids) {
    const v = unitIn(battle, id);
    if (v) out.push(...footprint(v));
  }
  return out;
}

/** Plain telegraphs straight from a plan (B's stub minds; H's telegraphsOf builds on them). */
export function plainTelegraphs(battle, unitId, plan, ctx = null) {
  const u = unitIn(battle, unitId);
  if (!u || !plan) return [];
  const out = [];
  for (const t of ticksOf(plan, u)) {
    const action = plan.slots[t.slot];
    if (!action || t.lost || t.ends === null) continue;
    out.push({
      unitId, slot: t.slot, tick: Math.min(4, t.ends),
      icon: iconFor(battle, u, action, ctx),
      words: actionWords(battle, unitId, action, ctx).slice(0, 60),
      targets: targetsOf(action), tiles: tilesOf(battle, u, action, ctx),
      hidden: false, falseTarget: null, adapting: null, aside: action.id === 'aside',
    });
  }
  return out;
}

// ---------- edge and odds ----------

const shadowLit = (battle, target, rules) => isShadow(target, rules) && inHooklight(battle, target);

const ATTACK_WORDS = ['first attack', 'second attack', 'third attack', 'fourth attack', 'fifth attack'];

/**
 * The edge parts of an outcome (§4.2's sources), from `actor` on `target` (null for an unaimed
 * pick such as Hide). `pk` says what kind of pick it is (see oddsAgainst).
 */
export function edgeParts(battle, ctx, actor, target, pk, grid) {
  const rules = ctx.rules;
  const parts = [];
  const add = (why, n) => {
    if (n) parts.push({ why, n });
  };
  if (pk.surface) {
    if (target && pk.meets) add(`${pk.meets} Resolve ${resolveOf(battle, target, pk.meets, ctx)}`, -resolveOf(battle, target, pk.meets, ctx));
    return parts;
  }
  const harmful = !!pk.harmful && !!target;
  const isAttack = !!pk.attack;
  // The actor's own state: on everything it does.
  if (actor) {
    const rattled = Math.max(condN(actor, 'rattled'), actor.rattled ? 1 : 0);
    add(`Rattled ${rattled}`, -rattled);
    const spooked = condOf(actor, 'spooked');
    if (spooked) {
      const src = spooked.source ? unitIn(battle, spooked.source) : null;
      if (!src || (standing(src) && grid.sees(actor, src))) add('Spooked', -1);
    }
  }
  // Take heart's edge is on the first action each turn, whatever it is; a reaction isn't one of the three.
  const firstAction = () => (actor && !pk.reaction && !actor.usedRound?.['#acted'] ? modSum(battle, actor, 'edge-first-each-turn', ctx) : 0);
  if (!harmful) {
    if (actor) {
      const next = modSum(battle, actor, 'edge-next', ctx) + modSum(battle, actor, 'edge-all', ctx);
      add('a boost', next);
      add('first action', firstAction());
    }
    if (pk.resolveOverride !== null && pk.resolveOverride !== undefined) add(`Resolve ${pk.resolveOverride}`, -pk.resolveOverride);
    return parts;
  }
  const ranged = !!pk.ranged;
  // Level difference.
  const diff = levelOf(battle, actor, rules) - levelOf(battle, target, rules);
  if (diff >= 2) add(`${diff} levels above`, Math.min(2, Math.floor(diff / 2)));
  if (diff <= -2) add(`${-diff} levels below`, -Math.min(2, Math.floor(-diff / 2)));
  // Height.
  const ah = Math.max(...footprint(actor).map((t) => grid.height(t.x, t.y)));
  const th = Math.max(...footprint(target).map((t) => grid.height(t.x, t.y)));
  if (ah > th) add('high ground', 1);
  if (shadowLit(battle, target, rules)) add('in the lantern’s light', 1);
  if ((target.marks || []).some((m) => m.id === 'assist' && m.by === actor.id)) add('Assist', 1);
  for (const m of target.marks || []) {
    if (m.id !== 'that-pile' || m.by === actor.id) continue;
    const marker = unitIn(battle, m.by);
    if (!marker || marker.side !== actor.side) continue;
    const hot = markSpec(ctx, marker, 'that-pile');
    const edge = hot && hot.edgeHot && marker.heat >= (hot.hotAt ?? 60) ? hot.edgeHot : m.n || 1;
    add('that pile', edge);
  }
  if (hasCond(target, 'exposed')) add('Exposed', 1);
  if (isAttack && actor.attackEdge) add('its own attack', actor.attackEdge);
  add('a boost', modSum(battle, actor, 'edge-next', ctx) + modSum(battle, actor, 'edge-all', ctx));
  add('first action', firstAction());
  // Conditions on the target (attacks on it).
  if (isAttack || pk.meets === 'guard') {
    if (hasCond(target, 'tumbled')) add('Tumbled', ranged ? -1 : 1);
    if (hasCond(target, 'tangled')) add('Tangled', 1);
    if (hasCond(target, 'drowsy')) add('Drowsy', 1);
    if (hasCond(target, 'dazzled')) add('Dazzled', 1);
    if (hasCond(target, 'unseen')) add('Unseen', -2);
    // The actor's own conditions on its attacks.
    if (hasCond(actor, 'tangled')) add('Tangled', -1);
    if (hasCond(actor, 'dazzled')) add('Dazzled', -1);
    if (hasCond(actor, 'unseen') || pk.fromHiding) add('from hiding', 1);
  }
  if (hasCond(actor, 'queasy')) add('Queasy', -1);
  // Cover and darkness, for anything aimed at a unit.
  if (!pk.area) {
    const c = grid.cover(actor.id, target.id);
    if (c === 1) add('low cover', -1);
    if (c === 2) add('heavy cover', -2);
    const dark = footprint(target).every((t) => grid.light(t.x, t.y) === 'D');
    if (dark && !actor.moves?.darksight) add('in the dark', -1);
  }
  // Defences.
  if (pk.meets === 'guard') {
    const g = guardOf(battle, target, ctx);
    add(`Guard ${g}`, -g);
  } else if (pk.meets === 'body' || pk.meets === 'mind') {
    const r = resolveOf(battle, target, pk.meets, ctx);
    add(`${pk.meets} Resolve ${r}`, -r);
  }
  // The attack penalty.
  if (isAttack && !pk.reaction) {
    const index = pk.attackIndex ?? actor.attacks ?? 0;
    let e = attackPenalty(index).edge;
    if (index === 1 && hasRule(ctx, actor, 'steady-second')) e = 0;
    if (index === 2 && hasRule(ctx, actor, 'steady-third')) e = -1;
    add(ATTACK_WORDS[Math.min(index, 4)], e);
  }
  if (ranged) {
    const besideFoe = battle.units.some((v) => standing(v) && v.side !== actor.side && v.side !== 'neutral' && v.rank !== 'device' && unitDist(v, actor) <= 1);
    if (besideFoe) add('a foe beside you', -1);
    // Dust clouds between the two.
    const a = footprint(actor)[0];
    const b = footprint(target)[0];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    let dust = 0;
    for (let i = 1; i < steps; i += 1) {
      const x = a.x + Math.round(((b.x - a.x) * i) / steps);
      const y = a.y + Math.round(((b.y - a.y) * i) / steps);
      if (grid.surfaceAt(x, y) === 'dust-cloud') dust += 1;
    }
    if (dust >= (rules.surfaces?.['dust-cloud']?.rangedThrough ?? 2)) add('dust cloud', -1);
  }
  return parts;
}

/** A mark's spec from the marker's abilities (edgeHot, hotAt, spend), or null. */
export function markSpec(ctx, marker, id) {
  for (const aid of marker.abilityIds || []) {
    const a = ability(ctx, aid);
    if (!a) continue;
    const pools = [a.effects || [], ...Object.values(a.by || {}).map((s) => s.effects || []), ...Object.values(a.choices || {}).map((s) => s.effects || [])];
    for (const list of pools) for (const e of list) if (e.do === 'mark' && e.id === id) return e;
  }
  return null;
}

/** True when the lead's plot armour applies to this pick (§4.9). */
export function armourFor(battle, target, pk) {
  if (!target || target.id !== 'lead' || !battle.lead || battle.lead.armourUsed) return false;
  return !!pk.harmful && (pk.meets === 'body' || pk.meets === 'mind');
}

/**
 * The Odds for one pick (§5.7), and the bars it uses. pk: { harmful, meets, attack, reaction,
 * light, ranged, helpful, cannotMiss, cheer, surface, area, resolveOverride, attackIndex, heat, counted, sure }.
 */
export function oddsAgainst(battle, ctx, actorId, targetId, pk, grid = null) {
  const rules = ctx.rules;
  const g = grid || createGrid(battle, rules);
  const actor = actorId ? unitIn(battle, actorId) : null;
  const target = targetId ? unitIn(battle, targetId) : null;
  let heat = 0;
  if (!pk.surface && actor) {
    heat = pk.heat ?? actor.heat;
    // A counted attack (an ability's own picks and its `act` Strikes) already carries its heat.
    if (pk.attack && !pk.reaction && !pk.counted) {
      const index = pk.attackIndex ?? actor.attacks ?? 0;
      const light = !!pk.light;
      heat += attackPenalty(index, { light }).heat;
    }
  }
  heat = clampHeat(heat);
  const band0 = bandOf(heat);
  const band = effMode(battle) === 'storybook' ? coolerBand(band0) : band0;
  const parts = edgeParts(battle, ctx, actor, target, pk, g);
  const raw = parts.reduce((s, p) => s + p.n, 0);
  const edge = Math.max(-3, Math.min(3, raw));
  const kind = noiseGenres(battle, rules).includes('starlight');
  const sure = !!(pk.harmful && actor && target && target.side !== actor.side && (pk.sure || (actor.mods || []).some((m) => m.stat === 'degree-next-on-foe')));
  const worse = !!(pk.harmful && actor && target && target.side !== actor.side && (target.mods || []).some((m) => m.stat === 'degree-next-from-foe'));
  const armour = armourFor(battle, target, pk);
  const bars = foldBars(shiftBars(BANDS[band], edge), {
    kind, helpful: !!(pk.helpful || pk.cannotMiss), cheer: !!pk.cheer, sure, armour: armour || worse,
  });
  const words = oddsWords(bars, { likely: rules.odds?.likely, even: rules.odds?.even, crit: rules.odds?.crit });
  const known = !target || !actor || target.side === actor.side || target.side === 'party' || !!target.examined;
  return {
    bars, band, heat, edge, parts, amounts: null, known,
    helpful: !!(pk.helpful || pk.cannotMiss), cheer: !!pk.cheer,
    words: words.words, critInReach: words.critInReach, changeable: false,
    armour, unfolded: armour ? foldBars(shiftBars(BANDS[band], edge), { kind, helpful: !!(pk.helpful || pk.cannotMiss), cheer: !!pk.cheer, sure, armour: worse }) : null,
    // The same bars without Kind noise, so a pick can tell when the noise turned its Hit kind.
    unkind: kind ? foldBars(shiftBars(BANDS[band], edge), { kind: false, helpful: !!(pk.helpful || pk.cannotMiss), cheer: !!pk.cheer, sure, armour: armour || worse }) : null,
  };
}

/** Resistances and weaknesses of a unit to a kind right now (soaked, the lantern and ghosts, Hearth). */
export function defencesTo(battle, ctx, target, kind, grid) {
  const rules = ctx.rules;
  let resist = target.resist?.[kind] || 0;
  let weak = target.weak?.[kind] || 0;
  if (kind === 'plain' && target.archetype === 'ghost' && resist) {
    const lit = inHooklight(battle, target);
    const litMark = (target.mods || []).some((m) => m.stat === 'light-hit');
    const inFire = footprint(target).some((t) => rules.surfaces?.[grid.surfaceAt(t.x, t.y)]?.ghostsLoseResist || grid.surfaceAt(t.x, t.y) === 'candle-wax');
    if (lit || litMark || inFire) resist = 0;
  }
  const soaked = condOf(target, 'soaked');
  if (soaked) {
    const v = strayRow(rules, 'resist', target.level);
    if (kind === 'spark' || kind === 'static') weak = Math.max(weak, v);
    if (kind === 'light') resist = Math.max(resist, v);
  }
  const all = modSum(battle, target, 'resist-all', ctx) + hearthResist(battle, ctx, target);
  if (all > resist) resist = all;
  return { resist, weak };
}

function hearthResist(battle, ctx, target) {
  if (target.side !== 'party') return 0;
  for (const u of battle.units) {
    if (!standing(u) || u.side !== 'party' || !hasRule(ctx, u, 'hearth-path')) continue;
    const l = hooklight(battle);
    if (!l || l.radius <= 0 || unitDist(l, target) > l.radius) continue;
    return u.level >= 10 ? 4 : u.level >= 5 ? 3 : 2;
  }
  return 0;
}

/** Room heat (§4.3): Neon rooms +10 and Iron rooms −10 a round from round 2. */
export function roomHeat(battle, rules) {
  let n = 0;
  for (const g of battle.genres || []) n += rules.heat?.room?.[g] || 0;
  return n;
}

// ---------- reactions ----------

const REACTION_WORDS = {
  'parting-swipe': 'Parting swipe at', shoulder: 'Shoulder the hit on', ready: 'Fire the readied action at', 'draw-the-blow': 'Draw the blow from',
  'stand-in-my-light': 'Stand in my light for', proofread: 'Proofread the outcome on', 'tuck-and-roll': 'Tuck and roll from',
  'ready-a-shot': 'Ready a shot at', 'sudden-shelter': 'Sudden shelter from',
};

export function settingOf(run, reactor, id) {
  if (reactor.side !== 'party') return 'always';
  const plan = run.b.plans?.[reactor.id];
  return plan?.reactions?.[id] || reactor.reactions?.[id] || run.rules.reactions?.[id] || run.rules.reactions?.default || 'always';
}

export function canReact(run, reactor) {
  if (!standing(reactor) || reactor.reactionUsed || reactor.rank === 'device') return false;
  if (asleep(reactor) || hasCond(reactor, 'sparked')) return false;
  if ((reactor.mods || []).some((m) => m.stat === 'surprised')) return false;
  return true;
}

// How many scheduled entries are resolving (battle.js's resolveEntry, through inEntry). An Ask can be
// answered only there: the step waits, and replays the entry with the answer (Battle.answers).
let entryDepth = 0;

/** Runs one scheduled entry's resolution; Asks raised inside it pause the step (§18.3). */
export function inEntry(fn) {
  entryDepth += 1;
  try {
    return fn();
  } finally {
    entryDepth -= 1;
  }
}

/**
 * §18.3: an Ask raised outside a scheduled entry (a round's start or end, a tick's end, the ticks a
 * commit ends before the first action) can't be answered, so it resolves as Never, or as Always on an
 * auto plan (this round's, or at a round's start the last round's) and in Wrap it up.
 */
function askedOutside(run, reactor) {
  if (run.scratch?.autoAsk) return true;
  const plan = run.b.plans?.[reactor.id] || run.scratch?.lastPlans?.[reactor.id] || null;
  return plan?.by === 'auto';
}

/** Whether a reaction fires: its setting, Under half by the subject, and Ask by a stored answer. */
export function wants(run, reactor, id, trigger, subject) {
  const s = settingOf(run, reactor, id);
  if (s === 'never') return false;
  if (s === 'under-half') return !!subject && subject.integrity < subject.maxIntegrity / 2;
  if (s === 'ask') {
    if (!entryDepth) return askedOutside(run, reactor);
    // Answers live in Battle.answers for the entry being replayed, never in usedRound (§18.3).
    const answer = run.b.answers?.[reactor.id]?.[id];
    if (answer === 1) return true;
    if (answer === 0) return false;
    const name = subject ? (subject.name?.startsWith('The ') ? `the ${subject.name.slice(4)}` : subject.name) : 'them';
    throw new AskSignal({ unitId: reactor.id, reactionId: id, trigger, words: `${REACTION_WORDS[id] || `${id.replace(/-/g, ' ')} for`} ${name}?`.replace(/^./, (c) => c.toUpperCase()) });
  }
  return true;
}

/** Uses left: this round's, per target this round (with the subject, `target-round`), or the stored count. */
export function abilityUsesLeft(run, u, a, targetId = null) {
  if (!a.uses) return true;
  const n = numOf(a.uses.n, u);
  if (a.uses.per === 'turn' || a.uses.per === 'round') return (u.usedRound?.[a.id] || 0) < n;
  if (a.uses.per === 'target-round') return !targetId || (u.usedRound?.[`${a.id}@${targetId}`] || 0) < n;
  return (u.uses?.[a.id] ?? n) > 0;
}

export function spendUse(run, u, a, targetId = null) {
  if (!a?.uses) return;
  const n = numOf(a.uses.n, u);
  u.usedRound = u.usedRound || {};
  if (a.uses.per === 'turn' || a.uses.per === 'round') u.usedRound[a.id] = (u.usedRound[a.id] || 0) + 1;
  else if (a.uses.per === 'target-round') u.usedRound[`${a.id}@${targetId}`] = (u.usedRound[`${a.id}@${targetId}`] || 0) + 1;
  else {
    u.uses = u.uses || {};
    u.uses[a.id] = Math.max(0, (u.uses[a.id] ?? n) - 1);
  }
}

/** The calling reactions a unit has for a trigger. */
export function reactionAbilities(run, u, trigger, subjectId = null) {
  const out = [];
  for (const id of u.abilityIds || []) {
    const a = ability(run.ctx, id);
    if (a && a.kind === 'reaction' && !a.stub && a.reaction?.when === trigger && abilityUsesLeft(run, u, a, subjectId)) out.push(a);
  }
  return out;
}

export function markReacted(run, reactor, id, trigger, a = null, targetId = null) {
  reactor.reactionUsed = true;
  if (a) spendUse(run, reactor, a, targetId);
  emit(run, { t: 'reaction', unit: reactor.id, id, trigger });
}

export const ribbon = (run) => run.b.order.map((id) => U(run, id)).filter(Boolean);

export function proofreadOutcome(run, actor, target, degree) {
  for (const r of ribbon(run)) {
    if (!canReact(run, r)) continue;
    const subject = target || actor;
    const list = reactionAbilities(run, r, 'outcome-in-sight', subject.id);
    for (const a of list) {
      const grid = gridOf(run);
      const range = a.reaction?.range || 99;
      if (!grid.sees(r, subject) || unitDist(r, subject) > range) continue;
      const up = actor.side === r.side;
      const next = shiftDegree(degree, up ? 1 : -1);
      if (next === degree) continue;
      if (!wants(run, r, a.id, 'outcome-in-sight', subject)) continue;
      markReacted(run, r, a.id, 'outcome-in-sight', a, subject.id);
      const by = (a.effects || []).find((e) => e.do === 'degree')?.by ?? (up ? 1 : -1);
      const moved = shiftDegree(degree, up ? Math.abs(by) : -Math.abs(by));
      emit(run, { t: 'outcome', unit: actor.id, target: target?.id ?? null, degree: moved, bars: null, k: null, cheer: false, by: r.id });
      return moved;
    }
  }
  return degree;
}

/**
 * Reactions to a hit that's landing: self-struck (Tuck and roll halves, Sudden shelter braces),
 * hit-on-ally (Stand in my light takes the `one` line off) and ally-struck-beside (Shoulder lends
 * Buffer). Returns { halve, less, bufferFrom }.
 */
export function hitReactions(run, user, target, degree) {
  const out = { halve: false, less: 0, bufferFrom: target };
  if (!user || !target || user.side === target.side || degree === 'miss') return out;
  // Self-struck.
  if (canReact(run, target)) {
    for (const a of reactionAbilities(run, target, 'self-struck', target.id)) {
      if (!wants(run, target, a.id, 'self-struck', target)) continue;
      markReacted(run, target, a.id, 'self-struck', a, target.id);
      if (a.id === 'tuck-and-roll' || (a.effects || []).some((e) => e.do === 'rule' && e.id === 'tuck-and-roll')) out.halve = true;
      else runReactionEffects(run, target, a, target);
      break;
    }
  }
  // Hit on an ally in range.
  for (const r of ribbon(run)) {
    if (r.id === target.id || r.side !== target.side || !canReact(run, r)) continue;
    let used = false;
    for (const a of reactionAbilities(run, r, 'hit-on-ally', target.id)) {
      if (unitDist(r, target) > (a.reaction?.range ?? 4)) continue;
      if (!wants(run, r, a.id, 'hit-on-ally', target)) continue;
      markReacted(run, r, a.id, 'hit-on-ally', a, target.id);
      if (a.id === 'stand-in-my-light' || (a.effects || []).some((e) => e.do === 'rule' && e.id === 'stand-in-my-light')) out.less += line(run.rules, 'one', r.level);
      else runReactionEffects(run, r, a, target);
      used = true;
      break;
    }
    if (used) break;
  }
  // Shoulder: an ally within 1 lends its Buffer to the hit, only when it's more than the ally's own
  // (the hit meets one pool, so a smaller one would only make it worse).
  for (const r of ribbon(run)) {
    if (r.id === target.id || r.side !== target.side || !canReact(run, r) || !((r.buffer || 0) > (target.buffer || 0))) continue;
    if (unitDist(r, target) > 1) continue;
    if (!wants(run, r, 'shoulder', 'ally-struck-beside', target)) continue;
    markReacted(run, r, 'shoulder', 'ally-struck-beside');
    out.bufferFrom = r;
    break;
  }
  return out;
}

export function runReactionEffects(run, reactor, a, subject) {
  const spec = { target: a.target || { who: 'unit', range: a.reaction?.range ?? 99 }, effects: a.effects || [] };
  applySpec(run, reactor.id, a, spec, { cost: 0, target: { unit: subject.id }, choice: null, extra: 0, cheer: false }, { reaction: true });
}

/**
 * Where a warden would take a blow aimed at an ally (§6.5 draw-the-blow): where it stands when the
 * attacker's Strike can land there, else the first tile beside the ally one Step away that it can;
 * null when neither, and then the reaction doesn't fire.
 */
function drawSpot(run, user, target, r) {
  const grid = gridOf(run);
  if (canStrike(grid, user, r)) return { x: r.x, y: r.y, stay: true };
  for (const t of footprint(target)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const s = { x: t.x + dx, y: t.y + dy };
      if (unitDist({ ...s, size: r.size || 1 }, target) > 1 || !canStep(grid, r, s)) continue;
      if (canStrike(grid, user, { ...r, x: s.x, y: s.y })) return s;
    }
  }
  return null;
}

/** Draw the blow (strike-at-ally): a warden steps in and becomes the target. Returns the new target id. */
export function strikeAtAlly(run, user, target) {
  if (!user || !target || user.side === target.side) return target?.id;
  for (const r of ribbon(run)) {
    if (r.id === target.id || r.side !== target.side || !canReact(run, r)) continue;
    for (const a of reactionAbilities(run, r, 'strike-at-ally', target.id)) {
      if (unitDist(r, target) > (a.reaction?.range ?? 2)) continue;
      // It fires only when the warden will be a target the Strike can land on (§6.5), so it never cancels the attack.
      const spot = drawSpot(run, user, target, r);
      if (!spot) continue;
      if (!wants(run, r, a.id, 'strike-at-ally', target)) continue;
      markReacted(run, r, a.id, 'strike-at-ally', a, target.id);
      if (!spot.stay) moveAlong(run, r.id, [{ x: spot.x, y: spot.y }], 'step', { noSwipes: true });
      return r.id;
    }
    // A readied action on strike-at-ally.
    if (fireReady(run, r, 'strike-at-ally', user)) return target.id;
  }
  return target.id;
}

/** Fires a unit's readied slot if its trigger matches (§4.4 Ready). */
export function fireReady(run, r, trigger, subject) {
  const slot = r.usedRound?.['#ready'];
  if (!slot || !canReact(run, r)) return false;
  const plan = run.b.plans?.[r.id];
  const readyAction = plan?.slots?.[slot - 2];
  if (!readyAction || readyAction.trigger !== trigger) return false;
  const action = plan.slots[slot - 1];
  if (!action || !readyFits(run, r, subject)) return false;
  if (!wants(run, r, 'ready', 'readied', subject)) return false;
  markReacted(run, r, 'ready', 'readied');
  delete r.usedRound['#ready'];
  const fired = action.id === 'strike' || action.id === 'use' || action.id === 'throw' || action.id === 'shove'
    ? { ...action, target: action.target?.unit || action.target?.units ? action.target : { unit: subject.id } }
    : action;
  run.basic?.(run, r.id, fired, { reaction: true, slot: slot - 1 });
  return true;
}

/** Whether a readied slot could happen right now (a readied action is checked like any other). */
function readyFits(run, r, subject) {
  const slot = r.usedRound?.['#ready'];
  const action = run.b.plans?.[r.id]?.slots?.[slot - 1];
  if (!action || !run.valid) return !!action;
  const fired = ['strike', 'use', 'throw', 'shove'].includes(action.id) && !(action.target?.unit || action.target?.units) ? { ...action, target: { unit: subject.id } } : action;
  return !run.valid(run, r, fired);
}

// ---------- surfaces ----------

export const surfaceLevel = (run) => roomLevel(run.b, run.rules);

export function setSurface(run, x, y, id, rounds = null, level = null) {
  const b = run.b;
  const grid = gridOf(run);
  if (!grid.inside(x, y) || ['#', ' ', 'O'].includes(grid.cell(x, y))) return false;
  b.surfaces = (b.surfaces || []).filter((s) => !(s.x === x && s.y === y));
  if (id) b.surfaces.push({ x, y, id, rounds: rounds ?? run.rules.surfaces[id]?.rounds ?? null, level: level ?? surfaceLevel(run) });
  b.surfaces.sort((p, q) => p.y - q.y || p.x - q.x);
  dirty(run);
  return true;
}

function connected(run, start, id) {
  const seen = new Set();
  const out = [];
  const stack = [start];
  while (stack.length) {
    const t = stack.pop();
    const key = `${t.x},${t.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (gridOf(run).surfaceAt(t.x, t.y) !== id) continue;
    out.push(t);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stack.push({ x: t.x + dx, y: t.y + dy });
  }
  return out;
}

/** A damage kind reaching surfaces: arcs, ice, candlefire, burning oil or foliage, steam, clearing. */
export function surfaceReact(run, tiles, kind, { amount = 0, hitUnit = null, noArcNear = null } = {}) {
  const done = new Set();
  for (const t of tiles) {
    const id = gridOf(run).surfaceAt(t.x, t.y);
    if (!id || done.has(`${t.x},${t.y}`)) continue;
    const info = run.rules.surfaces[id];
    const to = info?.reacts?.[kind];
    // Hazard props burst on a Light hit.
    if (!to) continue;
    const region = connected(run, t, id);
    for (const r of region) done.add(`${r.x},${r.y}`);
    if (to === 'arc' && noArcNear?.length && gridOf(run).caught(region).some((uid) => noArcNear.includes(uid))) continue;
    if (to === 'arc') {
      const half = Math.floor(amount / 2);
      const hitIds = gridOf(run).caught(region).filter((uid) => uid !== hitUnit);
      emit(run, { t: 'surface', tiles: region, id, rounds: null, on: true });
      for (const uid of hitIds) {
        const v = U(run, uid);
        if (!v || v.moves?.flies || v.moves?.hovers) continue;
        if (half > 0) landHit(run, { userId: null, targetId: uid, amount: half, kind, degree: 'hit', reactions: false, source: 'arc' });
        const vv = U(run, uid);
        if (vv) addCondition(run, vv, 'sparked', 1 + surfaceGrowth(run.rules, surfaceLevel(run)), { degree: 'hit' });
      }
      const hit = hitUnit ? U(run, hitUnit) : null;
      if (hit && !hit.moves?.flies) addCondition(run, hit, 'sparked', 1 + surfaceGrowth(run.rules, surfaceLevel(run)), { degree: 'hit' });
      continue;
    }
    const area = to === 'clear' && info.clears ? regionAround(t, info.clears) : region;
    for (const r of area) {
      if (to === 'clear') {
        if (gridOf(run).surfaceAt(r.x, r.y) === id) setSurface(run, r.x, r.y, null);
      } else setSurface(run, r.x, r.y, to, run.rules.surfaces[to]?.rounds ?? null);
    }
    emit(run, { t: 'surface', tiles: area, id: to === 'clear' ? id : to, rounds: to === 'clear' ? null : run.rules.surfaces[to]?.rounds ?? null, on: to !== 'clear' });
  }
  if (kind === 'light') burstHazards(run, tiles);
}

function regionAround(t, size) {
  const out = [];
  for (let y = t.y; y < t.y + size; y += 1) for (let x = t.x; x < t.x + size; x += 1) out.push({ x, y });
  return out;
}

/** Hazard props within reach of a Light hit burst once: the `two` line in Plain on everyone within 1. */
export function burstHazards(run, tiles) {
  const b = run.b;
  const hz = run.rules.hazard || { line: 'two', kind: 'plain', radius: 1 };
  for (const o of b.objects || []) {
    if (o.kind !== 'prop' || !(o.flags || []).includes('hazard') || o.state === 'rubble') continue;
    if (!tiles.some((t) => dist(t, o) <= 1)) continue;
    o.state = 'rubble';
    o.flags = (o.flags || []).filter((f) => f !== 'hazard' && f !== 'cover-high').concat((o.flags || []).includes('cover-low') ? [] : ['cover-low']);
    emit(run, { t: 'object', object: o.id, state: 'rubble' });
    dirty(run);
    const amount = line(run.rules, hz.line, surfaceLevel(run));
    const near = b.units.filter((u) => !u.sorted && !u.offline && unitDist(u, o) <= hz.radius).map((u) => u.id);
    for (const id of near) landHit(run, { userId: null, targetId: id, amount, kind: hz.kind, degree: 'hit', reactions: false, source: 'hazard' });
  }
}

/** A surface's effects on a unit (on entering, striding in, ending a tick in it, or a turn). */
export function surfaceOn(run, u, id, when) {
  const info = run.rules.surfaces[id];
  if (!info || info.when !== when || !u || u.sorted || u.offline) return false;
  if (u.moves?.flies || u.moves?.hovers) return false;
  if (!info.on?.length) return false;
  const grow = surfaceGrowth(run.rules, surfaceLevel(run));
  let degree = 'hit';
  if (info.meets) {
    const odds = oddsAgainst(run.b, run.ctx, null, u.id, { surface: true, meets: info.meets, harmful: true }, gridOf(run));
    degree = pickOutcome(run, null, u.id, odds, { proofread: false });
  }
  for (const e of info.on) {
    if (e.min === 'hit' && degree !== 'hit' && degree !== 'crit') continue;
    if (e.do === 'condition') {
      const n = e.n ? e.n + grow : null;
      if (addCondition(run, u, e.id, n, { degree, source: `surface:${id}` }) && (e.id === 'tumbled')) return true;
    } else if (e.do === 'end-condition') endCondition(run, u, e.id);
  }
  return false;
}

// ---------- movement ----------

const facingOf = (dx, u) => (dx > 0 ? 'right' : dx < 0 ? 'left' : u.facing || 'right');

/**
 * Moves a unit along tiles, one at a time, running what each step triggers: Parting swipes on a
 * Stride or Jump, slippery and sticky surfaces, snares, the Tollkeeper's toll, readied actions and
 * the lantern following Milo. Returns { walked, stopped }.
 */
export function moveAlong(run, unitId, tiles, how, { by = null, noSwipes = false } = {}) {
  const u = U(run, unitId);
  const walked = [];
  if (!u || !tiles?.length) return { walked, stopped: false };
  const voluntary = how === 'stride' || how === 'jump';
  const flush = () => {
    if (!walked.length) return;
    emit(run, { t: 'move', unit: unitId, by, path: walked.splice(0).map((t) => ({ x: t.x, y: t.y })), how });
    flushLight(run);
  };
  const tolled = new Set();
  const readied = new Set();
  let stopped = false;
  // A unit coming closer to a foe is something happening (§18.2's standoff): any tile on the way counts.
  const before = foeDistances(run.b, u);
  let closer = false;
  const spook = voluntary || how === 'step' || how === 'teleport' ? spookSource(run, u) : null;
  const spookFrom = spook ? unitDist(u, spook) : 0;
  for (const t of tiles) {
    const me = U(run, unitId);
    if (!me || !standing(me)) {
      stopped = true;
      break;
    }
    // Spooked: it can't move closer to what spooked it (COMBAT §7).
    if (spook && unitDist({ x: t.x, y: t.y, size: me.size || 1 }, spook) < spookFrom) {
      stopped = true;
      break;
    }
    // Parting swipes when leaving someone's reach: the grid's one rule (canSwipe, beside and seeing
    // the mover here but not at the next tile), so the planner's swipe list is what fires.
    if (voluntary && !noSwipes && !me.moves?.flies) {
      const g = gridOf(run);
      const there = new Set(g.swipersAt(t.x, t.y, me.id));
      const here = new Set(g.swipersAt(me.x, me.y, me.id));
      const leavers = ribbon(run).filter((v) => here.has(v.id) && !there.has(v.id));
      for (const v of leavers) {
        if (!canReact(run, v)) continue;
        if (!wants(run, v, 'parting-swipe', 'foe-leaves-reach', me)) continue;
        flush();
        markReacted(run, v, 'parting-swipe', 'foe-leaves-reach');
        doStrike(run, v.id, { id: 'strike', target: { unit: me.id } }, { reaction: true, swipe: true });
        const after = U(run, unitId);
        if (!after || !standing(after) || hasCond(after, 'tumbled')) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
    const cur = U(run, unitId);
    const fromWater = footprint(cur).some((p) => gridOf(run).surfaceAt(p.x, p.y) === 'water');
    const dx = t.x - cur.x;
    cur.facing = facingOf(dx, cur);
    cur.x = t.x;
    cur.y = t.y;
    walked.push(t);
    dirty(run);
    if (!closer && cameCloser(run.b, cur, before)) {
      closer = true;
      stirRound(run);
    }
    if (cur.kind === 'milo') syncLantern(run);
    // Surfaces.
    const g = gridOf(run);
    const here = footprint(cur).map((p) => g.surfaceAt(p.x, p.y)).filter(Boolean);
    const toWater = here.includes('water');
    if (fromWater && !toWater && !cur.moves?.flies && !cur.moves?.hovers) {
      const soak = run.rules.surfaces.water?.leave?.[0];
      if (soak) addCondition(run, cur, 'soaked', soak.n + surfaceGrowth(run.rules, surfaceLevel(run)), { degree: 'hit', source: 'surface:water' });
    }
    for (const id of new Set(here)) {
      surfaceOn(run, cur, id, 'enter');
      if (how === 'stride' && surfaceOn(run, cur, id, 'stride')) {
        stopped = true;
      }
    }
    // Snares.
    const snare = (run.b.objects || []).find((o) => o.kind === 'snare' && o.state === 'set' && footprint(cur).some((p) => p.x === o.x && p.y === o.y));
    if (snare) {
      const maker = snare.by || null;
      const makerUnit = maker ? U(run, maker) : null;
      if (!makerUnit || makerUnit.side !== cur.side) {
        const odds = oddsAgainst(run.b, run.ctx, maker || null, cur.id, { surface: true, meets: 'body', harmful: true }, gridOf(run));
        const degree = pickOutcome(run, maker || null, cur.id, odds, { proofread: false });
        snare.state = 'sprung';
        emit(run, { t: 'object', object: snare.id, state: 'sprung' });
        if ((degree === 'hit' || degree === 'crit') && addCondition(run, cur, 'tangled', 1, { degree, source: maker })) stopped = true;
        run.b.objects = run.b.objects.filter((o) => o !== snare);
        dirty(run);
      }
    }
    // The Tollkeeper's toll.
    for (const k of ribbon(run)) {
      if (tolled.has(k.id) || !standing(k) || k.side === cur.side || !hasRule(run.ctx, k, 'tollkeeper-toll')) continue;
      if (unitDist(k, cur) > 1) continue;
      tolled.add(k.id);
      flush();
      const odds = oddsAgainst(run.b, run.ctx, k.id, cur.id, { harmful: true, meets: 'body' }, gridOf(run));
      const degree = pickOutcome(run, k.id, cur.id, odds);
      if (degree === 'hit' || degree === 'crit') {
        emit(run, { t: 'line', text: `${k.name} stops ${cur.name} at the toll.` });
        stopped = true;
      }
    }
    // Readied actions and Ready a shot.
    for (const r of ribbon(run)) {
      if (readied.has(r.id) || r.side === cur.side || !canReact(run, r)) continue;
      const enters = unitDist(r, cur) <= 1;
      const sees = gridOf(run).sees(r, cur);
      if (enters && r.usedRound?.['#ready'] && fireReadyCheck(run, r, 'foe-enters-reach') && readyFits(run, r, cur)) {
        readied.add(r.id);
        flush();
        fireReady(run, r, 'foe-enters-reach', cur);
      } else if (sees && r.usedRound?.['#ready'] && fireReadyCheck(run, r, 'foe-moves-in-sight') && readyFits(run, r, cur)) {
        readied.add(r.id);
        flush();
        fireReady(run, r, 'foe-moves-in-sight', cur);
      } else if (sees) {
        for (const a of reactionAbilities(run, r, 'foe-moves-in-sight', cur.id)) {
          if (unitDist(r, cur) > (a.reaction?.range ?? 12)) continue;
          if (!wants(run, r, a.id, 'foe-moves-in-sight', cur)) continue;
          readied.add(r.id);
          flush();
          markReacted(run, r, a.id, 'foe-moves-in-sight', a, cur.id);
          runReactionEffects(run, r, a, cur);
          break;
        }
      }
      const after = U(run, unitId);
      if (!after || !standing(after)) {
        stopped = true;
        break;
      }
    }
    if (stopped) break;
  }
  flush();
  ghostInDark(run, U(run, unitId));
  return { walked, stopped };
}

/** The standing unit a Spooked unit is spooked by, or null. */
export function spookSource(run, u) {
  const c = condOf(u, 'spooked');
  const src = c?.source ? U(run, c.source) : null;
  return src && standing(src) ? src : null;
}

function fireReadyCheck(run, r, trigger) {
  const slot = r.usedRound?.['#ready'];
  const a = run.b.plans?.[r.id]?.slots?.[slot - 2];
  return !!a && a.trigger === trigger;
}

/** A forced move along a 1-2-1 line: push (away), pull (toward); stops at walls, units and void; a ledge drop is a fall. */
export function forcedMove(run, userId, targetId, how, tiles, { noSwipes = true } = {}) {
  const user = U(run, userId);
  const target = U(run, targetId);
  if (!user || !target || tiles <= 0) return;
  const g = gridOf(run);
  const from = footprint(user)[0];
  const at = footprint(target)[0];
  let dx = Math.sign(at.x - from.x);
  let dy = Math.sign(at.y - from.y);
  if (how === 'pull') {
    dx = -dx;
    dy = -dy;
  }
  if (dx === 0 && dy === 0) return;
  const path = [];
  let cx = target.x;
  let cy = target.y;
  let fall = 0;
  let h = Math.max(...footprint(target).map((t) => g.height(t.x, t.y)));
  for (let i = 0; i < tiles; i += 1) {
    const nx = cx + dx;
    const ny = cy + dy;
    // Nothing is pushed or pulled between two blocking corners, as nothing walks between them.
    if (!g.canStand(nx, ny, target.id) || g.betweenCorners(cx, cy, dx, dy, target.id)) break;
    const nh = Math.max(...footprint({ x: nx, y: ny, size: target.size || 1 }).map((t) => g.height(t.x, t.y)));
    if (nh > h + 1 && !target.moves?.flies) break;
    if (nh < h && target.rank === 'lead') break;
    if (nh < h && !target.moves?.flies && !target.moves?.hovers) fall += h - nh;
    h = nh;
    path.push({ x: nx, y: ny });
    cx = nx;
    cy = ny;
  }
  if (!path.length) return;
  moveAlong(run, targetId, path, how, { by: userId, noSwipes });
  if (fall > 0) {
    const t2 = U(run, targetId);
    if (t2 && standing(t2)) {
      addCondition(run, t2, 'tumbled', null, { degree: 'hit', source: userId });
      landHit(run, { userId: null, targetId, amount: line(run.rules, 'one', surfaceLevel(run)) * fall, kind: 'plain', degree: 'hit', reactions: false, source: 'fall' });
    }
  }
}

// ---------- Interact, Throw and Shove (the basic actions battle.js resolves) ----------

const plainCopy = (v) => (v === undefined ? null : jsonCopy(v));

const TOGGLE = {
  lever: { up: 'down', down: 'up' }, junction: { off: 'on', on: 'off' }, lamp: { lit: 'dark', dark: 'lit' }, candle: { lit: 'dark', dark: 'lit' },
  line: { running: 'shut' }, console: { idle: 'used' }, lectern: { idle: 'read' }, alibi: { standing: 'broken' }, clue: { hidden: 'found' },
  'plan-tile': { clear: 'marked' }, breaker: { on: 'off' }, forge: { cold: 'stoked' }, bell: { still: 'rung' }, 'riddle-board': { idle: 'solved' },
  chest: { shut: 'open' }, 'patch-kit': { full: 'used' },
};

export function interact(run, u, action) {
  const b = run.b;
  const tgt = action.target || {};
  const mech = mechanicOf(run);
  if (mech?.resolve) {
    const r = hook(run, mech.resolve, u.id, plainCopy(action), run.ctx);
    if (r) return null;
  }
  if (run.ctx.bows?.resolve) {
    const r = hook(run, run.ctx.bows.resolve, u.id, plainCopy(action), run.ctx);
    if (r) return null;
  }
  if (tgt.object) {
    const o = (b.objects || []).find((x) => x.id === tgt.object);
    const next = o && TOGGLE[o.kind]?.[o.state];
    if (!o || !next) return null;
    o.state = next;
    emit(run, { t: 'object', object: o.id, state: next });
    if (o.kind === 'lamp' || o.kind === 'candle') {
      b.lights = (b.lights || []).filter((l) => l.id !== o.id);
      if (next === 'lit' && b.lights.length < (run.rules.lights?.max ?? 24)) b.lights.push({ id: o.id, x: o.x, y: o.y, radius: run.rules.lights[o.kind], rounds: null, source: o.kind });
      dirty(run);
      emit(run, { t: 'light', lights: plainCopy(b.lights) });
      if (next === 'lit') revealLit(run, b.lights.find((l) => l.id === o.id), u.side);
    }
    if (o.kind === 'patch-kit') {
      const maker = o.by ? U(run, o.by) : null;
      patchUnit(run, u.id, U(run, u.id), line(run.rules, run.rules.devices['patch-kit'].line, maker?.level ?? u.level));
    }
    return null;
  }
  const v = tgt.unit ? U(run, tgt.unit) : null;
  if (!v) return null;
  if (v.id === u.id) {
    endCondition(run, u, 'lingering');
    endCondition(run, u, 'singed');
    endCondition(run, u, 'tangled');
    return null;
  }
  if (v.side === u.side && hasCond(v, 'drowsy')) endCondition(run, v, 'drowsy');
  return null;
}

export function doThrow(run, u, action, { reaction = false } = {}) {
  const b = run.b;
  const rules = run.rules;
  if (action.ability === 'cordial') {
    const carrier = carrierOf(run, u, 'cordial');
    if (!carrier) return null;
    carrier.carry = { ...carrier.carry, cordial: carrier.carry.cordial - 1 };
    const at = action.target?.tile || (action.target?.unit ? U(run, action.target.unit) : null);
    if (!at) return null;
    for (const v of b.units) {
      if (v.side !== u.side || !standing(v) || unitDist(v, { x: at.x, y: at.y }) > 1) continue;
      const third = hasRule(run.ctx, u, 'steady-hands') ? 1 / 3 : 0.25;
      patchUnit(run, u.id, v, Math.floor(v.maxIntegrity * third));
    }
    return null;
  }
  const target = U(run, action.target?.unit);
  if (!target) return null;
  const light = u.strike?.weapon === 'light';
  const pk = { harmful: true, meets: 'guard', attack: true, light, ranged: true, cheer: !!action.cheer, reaction };
  const odds = oddsAgainst(b, run.ctx, u.id, target.id, pk, gridOf(run));
  // A readied Throw is a reaction: no heat, no penalty, and it isn't counted (§4.3).
  if (!reaction) {
    const pen = attackPenalty(u.attacks || 0, { light });
    if (pen.heat) setHeat(run, u, u.heat + pen.heat);
    u.attacks = (u.attacks || 0) + 1;
  }
  if (hasCond(u, 'unseen')) endCondition(run, u, 'unseen');
  const degree = pickOutcome(run, u.id, target.id, odds);
  const t2 = U(run, target.id);
  if (degree !== 'miss' && t2) {
    landHit(run, { userId: u.id, targetId: t2.id, amount: line(rules, 'one', Math.max(1, u.level)) + (u.keyAdjust || 0) + (u.flat || 0), kind: 'plain', degree, source: 'throw' });
  } else if (t2) resetCalm(run, t2);
  // A Dip waits for the next Strike (§4.4): a Throw doesn't use it up.
  consumeUntil(run, U(run, u.id), 'next-attack', 'dip');
  return { degree };
}

export function doShove(run, u, action, { reaction = false } = {}) {
  const target = U(run, action.target?.unit);
  if (!target) return null;
  const pk = { harmful: true, meets: 'body', attack: true, cheer: !!action.cheer, reaction };
  const odds = oddsAgainst(run.b, run.ctx, u.id, target.id, pk, gridOf(run));
  // A readied Shove is a reaction: no heat, no penalty, and it isn't counted (§4.3).
  if (!reaction) {
    const pen = attackPenalty(u.attacks || 0, {});
    if (pen.heat) setHeat(run, u, u.heat + pen.heat);
    u.attacks = (u.attacks || 0) + 1;
  }
  // A Shove is an attack: it gives a hider away (COMBAT §7, Unseen).
  if (hasCond(u, 'unseen')) endCondition(run, u, 'unseen');
  const degree = pickOutcome(run, u.id, target.id, odds);
  const t2 = U(run, target.id);
  if (!t2) return { degree };
  resetCalm(run, t2);
  const larger = (t2.size || 1) > (u.size || 1);
  if (degree === 'crit' && action.choice === 'tumble' && (t2.size || 1) === 1) {
    addCondition(run, t2, 'tumbled', null, { degree: 'hit', source: u.id });
  } else if (degree === 'crit' && !larger) forcedMove(run, u.id, t2.id, 'push', 2);
  else if (degree === 'hit' && !larger) forcedMove(run, u.id, t2.id, 'push', 1);
  consumeUntil(run, U(run, u.id), 'next-attack', 'dip');
  return { degree };
}

// ---------- sneaking and sizes (exported from battle.js) ----------

/** §4.17: one sneak outcome for the whole party on the Cool band, from hashInts(fight.seed, 'sneak'). */
export function sneakCheck(fight, tiles, { lightAt, rules }) {
  const parts = [];
  const n = tiles.length || 1;
  const foliage = new Set((fight.surfaces || []).filter((s) => s.id === 'foliage').map((s) => `${s.x},${s.y}`));
  let dim = 0;
  let dark = 0;
  for (const t of tiles) {
    const l = lightAt ? lightAt(t.x, t.y) : 'L';
    if (l === 'D' || l === 'dark' || foliage.has(`${t.x},${t.y}`)) dark += 1;
    else if (l === 'd' || l === 'dim') dim += 1;
  }
  if (dark * 2 > n) parts.push({ why: 'dark or foliage', n: rules.sneak?.dark ?? 2 });
  else if ((dark + dim) * 2 > n) parts.push({ why: 'dim light', n: rules.sneak?.dim ?? 1 });
  const watchers = [...(fight.foes || []), ...(fight.leadUnit ? [fight.leadUnit] : [])].filter((f) => f.side === 'foe');
  const sharp = watchers.reduce((m, f) => Math.max(m, f.resolve?.mind || 0), 0);
  if (sharp) parts.push({ why: `mind Resolve ${sharp}`, n: -sharp });
  const edge = Math.max(-3, Math.min(3, parts.reduce((s, p) => s + p.n, 0)));
  const bars = shiftBars(BANDS.cool, edge);
  const w = oddsWords(bars, { likely: rules.odds?.likely, even: rules.odds?.even, crit: rules.odds?.crit });
  const odds = { bars, band: 'cool', heat: 0, edge, parts, amounts: null, known: true, helpful: false, cheer: false, words: w.words, critInReach: w.critInReach, changeable: false };
  const degree = degreeAt(unitOf01(hashInts(fight.seed >>> 0, 'sneak')) * 100, bars);
  return { odds, unseen: degree === 'hit' || degree === 'crit' };
}

/** UTF-8 bytes of JSON.stringify(value), the one size measure. */
export function battleBytes(value) {
  const s = JSON.stringify(value);
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

export { tileName, BANDS as BAND_BARS };
