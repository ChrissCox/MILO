// The fast policy (CONTRACT-PHASE4.md §4.6, §4.15, §6.6 Minds, §7.2, §13 H2; COMBAT.md §3.2, §3.3, §8.2, §8.3, §9):
// strays' plans by temperament and role, the scripted player the sim and the notebook tests use,
// the companions' personalities (the notebook's third layer), how both work a Tale-lead's room,
// improvising when a plan meets the round, and makeMinds, which puts the minds together for B's kernel. Pure: every choice that
// needs variety is a seeded hash of the battle; nothing reads a clock or Math.random.
//   The small tactical helpers here (who's in reach, the best attack, a clean path) are shared with
//   notebook.js, which resolves a note's relative choice back into an Action with them.
import { hashInts, unit as unit01 } from '../world/rng.js';
import { createGrid, unitDist, dist, footprint } from './grid.js';
import { unitIn, standing, hasCond, condOf, effMode, ability, levelOf, BASIC_COST, hooklight, modSum, speedOf, numOf } from './round.js';
import { clampHeat, attackPenalty } from './heat.js';
import { specFor, costsOf, unitTargets, abilityWhy, abilityAmount, talkTargets } from './abilities.js';
import { canStrike, strikeReach } from './effects.js';
import { nameOf } from './describe.js';
import { draftFor, situationOf, choicesOf, abilityHash } from './notebook.js';
import { telegraphsOf, counterFor, counterKind, revise as reviseLead, focusOf, knockWorth, surfaceMove } from './strays.js';
import { stompTiles } from './leads.js';

// ---------------------------------------------------------------------------
// Personalities (the companion files and regulars.json name these ids)

/** { [id]: { prefers, avoids, talksFirst, patchAt, attacks, words } } */
export const PERSONALITIES = Object.freeze({
  careful: Object.freeze({ prefers: Object.freeze(['reboot', 'patch', 'examine', 'attack', 'close', 'brace']), avoids: Object.freeze(['third-attack']), talksFirst: false, patchAt: 0.5, attacks: 2, words: 'plays it careful' }),
  bold: Object.freeze({ prefers: Object.freeze(['reboot', 'attack', 'close', 'patch', 'brace']), avoids: Object.freeze(['brace']), talksFirst: false, patchAt: 0.3, attacks: 3, words: 'goes in bold' }),
  steady: Object.freeze({ prefers: Object.freeze(['reboot', 'patch', 'cool', 'attack', 'close', 'brace']), avoids: Object.freeze([]), talksFirst: false, patchAt: 0.4, attacks: 2, words: 'keeps steady' }),
  quick: Object.freeze({ prefers: Object.freeze(['reboot', 'attack', 'close', 'patch', 'brace']), avoids: Object.freeze([]), talksFirst: false, patchAt: 0.4, attacks: 3, words: 'moves quickly' }),
  guarding: Object.freeze({ prefers: Object.freeze(['reboot', 'guard', 'patch', 'attack', 'close', 'brace']), avoids: Object.freeze([]), talksFirst: false, patchAt: 0.5, attacks: 2, words: 'guards the others' }),
  talker: Object.freeze({ prefers: Object.freeze(['reboot', 'talk', 'patch', 'attack', 'close', 'brace']), avoids: Object.freeze([]), talksFirst: true, patchAt: 0.5, attacks: 2, words: 'talks first' }),
  patcher: Object.freeze({ prefers: Object.freeze(['reboot', 'patch', 'attack', 'close', 'brace']), avoids: Object.freeze([]), talksFirst: false, patchAt: 0.75, attacks: 2, words: 'patches first' }),
});

const personalityOf = (ctx, unitId) => {
  const p = ctx?.party?.[unitId]?.personality;
  return PERSONALITIES[p] ? p : 'careful';
};

// ---------------------------------------------------------------------------
// Small helpers

const BASIC = { ability: null, target: null, extra: 0, choice: null, cheer: false, trigger: null };

/** A plain Action (§5.5). */
export function act(id, extra = {}) {
  return { id, ...BASIC, cost: BASIC_COST[id] ?? (id === 'reboot' ? 2 : 1), ...extra };
}

export const shareOf = (u) => (u && u.maxIntegrity > 0 ? u.integrity / u.maxIntegrity : 0);

/** Standing units opposed to `u` (never neutrals); a foe's list includes the party's devices. */
export function foesOf(b, u) {
  const out = [];
  for (const v of b.units) {
    if (!standing(v) || v.side === u.side || v.side === 'neutral') continue;
    if (u.side === 'party' && v.rank === 'device') continue;
    out.push(v);
  }
  return out;
}

/** Standing heroes on `u`'s side (devices left out), self included when asked. */
export function alliesOf(b, u, { self = false } = {}) {
  const out = [];
  for (const v of b.units) {
    if (!standing(v) || v.side !== u.side || v.rank === 'device') continue;
    if (!self && v.id === u.id) continue;
    out.push(v);
  }
  return out;
}

export const ribbonIndex = (b, id) => {
  const i = b.order.indexOf(id);
  return i < 0 ? 999 : i;
};

/** The nearest of a list to `from` (ties by the ribbon). */
export function nearestOf(b, list, from) {
  let best = null;
  let bd = Infinity;
  for (const v of list) {
    const d = unitDist(from, v);
    if (d < bd || (d === bd && best && ribbonIndex(b, v.id) < ribbonIndex(b, best.id))) {
      best = v;
      bd = d;
    }
  }
  return best;
}

/** The lowest Integrity share of a list (ties: nearer to `from`, then the ribbon). */
export function weakestOf(b, list, from) {
  let best = null;
  for (const v of list) {
    if (!best) { best = v; continue; }
    const sv = shareOf(v);
    const sb = shareOf(best);
    if (sv < sb - 1e-9) best = v;
    else if (Math.abs(sv - sb) < 1e-9) {
      const dv = unitDist(from, v);
      const db = unitDist(from, best);
      if (dv < db || (dv === db && ribbonIndex(b, v.id) < ribbonIndex(b, best.id))) best = v;
    }
  }
  return best;
}

const HOSTILE_ICONS = new Set(['strike', 'bite', 'shoot', 'cast', 'area', 'shove', 'surface', 'mechanic', 'summon']);

/**
 * The next hostile intent the party can see (the foe's telegraph that lands first, then by the
 * ribbon): { unitId, targets (what's shown: a false target, or none when hidden), tiles, tick, icon, hidden }.
 */
export function threatOf(b) {
  let best = null;
  for (const t of b.telegraphs || []) {
    const u = unitIn(b, t.unitId);
    if (!u || u.side !== 'foe' || !standing(u) || !HOSTILE_ICONS.has(t.icon)) continue;
    if (b.status !== 'planning' && t.tick <= b.tick) continue;
    if (!best || t.tick < best.tick || (t.tick === best.tick && ribbonIndex(b, t.unitId) < ribbonIndex(b, best.unitId))) best = t;
  }
  if (!best) return null;
  const targets = best.hidden ? [] : best.falseTarget ? [best.falseTarget] : [...(best.targets || [])];
  return { unitId: best.unitId, targets, tiles: best.hidden ? [] : best.tiles || [], tick: best.tick, icon: best.icon, hidden: !!best.hidden, aside: !!best.aside };
}

const hurtCache = new WeakMap();
/** Surface ids that hurt right now (rules.json's `hurts`). */
function hurting(rules) {
  if (!rules) return new Set();
  let s = hurtCache.get(rules);
  if (!s) {
    s = new Set(Object.entries(rules.surfaces || {}).filter(([, v]) => v.hurts).map(([k]) => k));
    hurtCache.set(rules, s);
  }
  return s;
}

/** True when a tile's surface would hurt `u` right now (floaters and fliers ignore surfaces). */
export function hurtsAt(g, rules, u, x, y) {
  if (u?.moves?.flies || u?.moves?.hovers) return false;
  const id = g.surfaceAt(x, y);
  return !!id && hurting(rules).has(id);
}

const cleanPath = (g, rules, u, path) => {
  for (const t of path) {
    for (const p of footprint({ x: t.x, y: t.y, size: u.size || 1 })) if (hurtsAt(g, rules, u, p.x, p.y)) return false;
  }
  return true;
};

/** A unit's tick budget this round, as B's ticksOf counts it (Quickened 4; Slowed and Winded lose ticks; surprised none). */
export function tickLimit(u) {
  const conds = (u?.conditions || []).filter((c) => !c?.data?.fresh);
  const has = (id) => conds.find((c) => c.id === id);
  const quick = !!(has('quickened') || has('brisk'));
  if ((u?.mods || []).some((m) => m.stat === 'surprised')) return 0;
  return (quick ? 4 : 3) - (has('slowed')?.n || 0) - (has('winded') ? 1 : 0);
}

/** The tick the next slot of a plan would start in (§5.5). */
export function nextTick(plan) {
  let t = 1;
  for (const a of plan?.slots || []) {
    if (!a || a.id === 'delay') { t += 1; continue; }
    const fixed = a.id === 'reboot' ? (Number(a.cost) === 1 ? 1 : 2) : BASIC_COST[a.id];
    const cost = fixed ?? (a.id === 'use' && Number(a.cost) === 0 ? 0 : Math.max(1, Math.trunc(Number(a.cost) || 1)));
    t += cost;
  }
  return t;
}

/** Ticks left for the next slot. */
export const ticksLeft = (plan, u) => tickLimit(u) - nextTick(plan) + 1;

// ---------------------------------------------------------------------------
// What a unit can do: its attacks, patches and helps, from its abilities (cached per ability index)

const infoCache = new WeakMap();

/** Each (cost, choice) of an ability, with the role the minds read it as. */
export function abilityVariants(ctx, id) {
  const index = ctx?.abilities;
  if (!index) return [];
  let cache = infoCache.get(index);
  if (!cache) {
    cache = new Map();
    infoCache.set(index, cache);
  }
  if (cache.has(id)) return cache.get(id);
  const a = ability(ctx, id);
  const out = [];
  if (a && !a.stub && a.kind !== 'passive' && a.kind !== 'reaction') {
    const choices = a.choices ? Object.keys(a.choices) : [null];
    for (const cost of costsOf(a)) {
      for (const choice of choices) {
        const spec = specFor(a, { cost, choice });
        if (!spec) continue;
        out.push(Object.freeze({ a, cost, choice, spec, role: roleOf(a, spec) }));
      }
    }
  }
  const frozen = Object.freeze(out);
  cache.set(id, frozen);
  return frozen;
}

/** How the minds read an ability's spec: attack, area-attack, hinder, patch, patch-area, reboot, help, move, place, object, self or none. */
export function roleOf(a, spec) {
  const t = spec?.target || { who: 'self' };
  const effects = spec?.effects || [];
  const has = (verb) => effects.some((e) => e.do === verb);
  const damage = has('damage') || effects.some((e) => e.do === 'act' && e.action === 'strike') || (!!a.attack && !a.helpful);
  if (has('reboot')) return 'reboot';
  if (has('patch')) return t.area && t.who !== 'ally' && t.who !== 'ally-or-self' ? 'patch-area' : 'patch';
  if (t.area && (t.hits || (a.helpful ? 'allies-and-self' : 'foes')) !== 'allies-and-self' && t.hits !== 'allies' && !a.helpful) return damage ? 'area-attack' : 'area-hinder';
  if (t.who === 'foe' || (t.who === 'unit' && !a.helpful)) return damage ? 'attack' : 'hinder';
  if (t.who === 'tile') return effects.some((e) => e.do === 'move' && (e.who === 'self' || !e.who)) ? 'move' : 'place';
  if (t.who === 'object') return 'object';
  if (t.who === 'ally' || t.who === 'ally-or-self' || t.who === 'offline-ally') return 'help';
  if (t.who === 'self' || t.who === 'none') return a.helpful || has('buffer') || has('mod') || has('condition') ? 'self' : 'self';
  return 'none';
}

const witBonus = (u, a, cost) => ((u.abilities?.wit ?? 0) >= 3 && a.kind === 'spell' && cost >= 2 ? 1 : 0);

/** The units a variant can be aimed at from where `u` stands (range, sight, need; per-target uses). */
export function variantTargets(b, g, u, v) {
  const t = v.spec.target || { who: 'self' };
  if (t.who === 'self' || t.who === 'none' || t.who === 'tile' || t.who === 'object') return [];
  let ids = unitTargets(b, g, u, t, { wit: witBonus(u, v.a, v.cost) });
  if (v.a.uses?.per === 'target-round') ids = ids.filter((id) => !(u.usedRound?.[`${v.a.id}@${id}`] > 0));
  return ids;
}

// Amounts are cached per ctx and per frozen battle only: an amount depends on the battle (its mode
// moves a foe's level) and on the unit as that battle holds it (path, abilities, conditions), and a
// frozen battle never changes. B's working copies (not frozen) are never cached.
const amountCache = new WeakMap();
/** A variant's damage (or patch) base amount for `u`, before the degree and defences. */
function variantAmount(b, ctx, u, v, targetId = null) {
  let per = null;
  const key = `${u.id}:${v.a.id}:${v.cost}:${v.choice}`;
  if (targetId === null && ctx && Object.isFrozen(b)) {
    let byBattle = amountCache.get(ctx);
    if (!byBattle) amountCache.set(ctx, (byBattle = new WeakMap()));
    per = byBattle.get(b);
    if (!per) byBattle.set(b, (per = new Map()));
    if (per.has(key)) return per.get(key);
  }
  let amount = 0;
  try {
    const r = abilityAmount(b, ctx, u.id, v.a, { cost: v.cost, choice: v.choice, extra: 0, target: null, cheer: false }, targetId);
    amount = r ? r.amount : 0;
  } catch {
    amount = 0;
  }
  if (per) per.set(key, amount);
  return amount;
}

export const strikeAmount = (u) => (u.strike?.amount || 0) + (u.keyAdjust || 0) + (u.flat || 0);

/**
 * The unit's attack options on single foes now: the Strike, then each attack variant it can use
 * (no stubs, charges and uses in hand, no Hushed spell), with its base amount. cost ≤ `left`.
 * Once-a-fight moves (a stray's big move) are left for the temperament to call on.
 */
export function attackOptions(b, u, ctx, { left = 3, big = false } = {}) {
  const out = [];
  if (u.strike && strikeAmount(u) > 0) out.push({ action: act('strike'), variant: null, amount: strikeAmount(u), cost: 1 });
  for (const id of u.abilityIds || []) {
    for (const v of abilityVariants(ctx, id)) {
      if (v.role !== 'attack' || v.cost > left || v.cost < 1) continue;
      if (!big && (v.a.big || v.a.uses?.per === 'fight')) continue;
      if (abilityWhy(b, u, v.a, v.cost, ctx)) continue;
      out.push({ action: act('use', { ability: v.a.id, cost: v.cost, choice: v.choice }), variant: v, amount: variantAmount(b, ctx, u, v), cost: v.cost });
    }
  }
  return out;
}

/** The foes an attack option reaches from where `u` stands. */
export function optionTargets(b, g, u, opt, foes) {
  if (!opt.variant) return foes.filter((v) => canStrike(g, u, v));
  const ids = new Set(variantTargets(b, g, u, opt.variant));
  return foes.filter((v) => ids.has(v.id));
}

/** A number for how good an attack option is on a target: its amount, with known weakness, resistance and a ranged shot beside a foe. */
function attackScore(b, u, opt, target, besideFoe) {
  let s = opt.amount;
  const kind = opt.variant ? null : u.strike?.kind;
  if (kind && target.examined) s += (target.weak?.[kind] || 0) - (target.resist?.[kind] || 0);
  const ranged = opt.variant ? (opt.variant.spec.target?.range ?? 1) > 1 && unitDist(u, target) > 1 : strikeReach(u, target).ranged;
  if (ranged && besideFoe) s -= 2;
  // Multi-action attacks are worth their actions only when they hit harder than that many Strikes.
  return s / Math.max(1, opt.cost) + (opt.cost > 1 ? 0 : 0.01);
}

/**
 * The best attack on the target `pick` chooses among the foes in reach: { action, target } or null.
 * pick(list) → a unit from the list (the weakest, a given one…).
 */
export function bestAttack(b, g, u, ctx, foes, pick, { left = 3, options = null } = {}) {
  const opts = options || attackOptions(b, u, ctx, { left });
  const besideFoe = foes.some((v) => v.rank !== 'device' && unitDist(v, u) <= 1);
  let best = null;
  for (const opt of opts) {
    const reach = optionTargets(b, g, u, opt, foes);
    if (!reach.length) continue;
    const target = pick(reach);
    if (!target) continue;
    const score = attackScore(b, u, opt, target, besideFoe);
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && shareOf(target) < shareOf(best.target))) {
      best = { opt, target, score };
    }
  }
  if (!best) return null;
  return { action: { ...best.opt.action, target: { unit: best.target.id } }, target: best.target, option: best.opt };
}

/** The farthest any attack option reaches (1 for a melee Strike). */
export function attackRange(b, u, ctx) {
  let r = u.strike ? Math.max(1, u.strike.range || 0, u.ranged?.range || 0) : 0;
  for (const id of u.abilityIds || []) {
    for (const v of abilityVariants(ctx, id)) {
      if (v.role !== 'attack' || v.a.big || v.cost > 1) continue;
      r = Math.max(r, (v.spec.target?.range ?? 1) + witBonus(u, v.a, v.cost));
    }
  }
  return r;
}

/**
 * Ways to patch an ally (or self) now: patch abilities, then the party's cordials (drink one, hand
 * one to an ally beside you, or throw one). [{ action (no target), variant, amount, cost, reach(ally) → bool, consumes }]
 */
export function patchOptions(b, g, u, ctx, { left = 3 } = {}) {
  const out = [];
  for (const id of u.abilityIds || []) {
    for (const v of abilityVariants(ctx, id)) {
      if ((v.role !== 'patch' && v.role !== 'patch-area') || v.cost > left || v.cost < 1) continue;
      if (abilityWhy(b, u, v.a, v.cost, ctx)) continue;
      const t = v.spec.target || { who: 'self' };
      const amount = variantAmount(b, ctx, u, v);
      const area = v.role === 'patch-area';
      const ids = t.who === 'self' || area ? null : new Set(variantTargets(b, g, u, v));
      out.push({
        action: act('use', { ability: v.a.id, cost: v.cost, choice: v.choice }), variant: v, amount: Math.max(1, amount), cost: v.cost,
        area, self: t.who === 'self', consumes: !!v.a.consumes, charges: v.a.kind === 'spell' && v.a.circle > 0,
        reaches: (ally) => (t.who === 'self' || area ? ally.id === u.id || (area && unitDist(u, ally) <= (t.area?.size ?? 1)) : ids.has(ally.id)),
      });
    }
  }
  return out;
}

/** The best patch for an ally: { action } or null. Free patches first; tonics and charges when it's worse. */
export function bestPatch(b, g, u, ctx, ally, { left = 3, options = null } = {}) {
  const opts = options || patchOptions(b, g, u, ctx, { left });
  const urgent = shareOf(ally) < 0.25;
  let best = null;
  for (const o of opts) {
    if (!o.reaches(ally)) continue;
    let score = o.amount / Math.max(1, o.cost);
    if (o.consumes) score -= urgent ? 2 : 6;
    if (o.charges) score -= urgent ? 1 : 4;
    if (!best || score > best.score) best = { o, score };
  }
  if (!best) return null;
  const o = best.o;
  const target = o.area || o.self ? null : { unit: ally.id };
  return { action: { ...o.action, target }, option: o };
}

// ---------------------------------------------------------------------------
// Who and what matters (shared with notebook.js)

/** Who matters to `u` now: foes, allies, the party, the threat and whom it aims at, the lowest ally, the lead. */
export function relations(b, u) {
  const foes = foesOf(b, u);
  const allies = alliesOf(b, u);
  const party = alliesOf(b, u, { self: true });
  const threat = threatOf(b);
  const threatened = threat ? threat.targets.map((id) => unitIn(b, id)).find((v) => v && v.side === u.side && v.id !== u.id && standing(v) && v.rank === 'hero') || null : null;
  return {
    foes, allies, party, threat, threatened,
    threatFoe: threat ? unitIn(b, threat.unitId) : null,
    lowAlly: weakestOf(b, allies, u),
    lowParty: weakestOf(b, party, u),
    lead: b.units.find((v) => v.rank === 'lead' && standing(v) && v.side !== u.side) || null,
  };
}

export const minDist = (p, list) => list.reduce((m, v) => Math.min(m, unitDist(p, v)), Infinity);

/**
 * A tile's cover against a foe (0, 1 low, 2 high), from the neighbour the line to the foe leaves by
 * (as B's trace counts cover beside the target): straight toward it, or diagonally when the line runs
 * near a diagonal. A wall off to one side is no cover.
 */
export function coverAt(g, tile, foe) {
  if (!foe) return 0;
  const dx0 = foe.x - tile.x;
  const dy0 = foe.y - tile.y;
  if (!dx0 && !dy0) return 0;
  const ax = Math.abs(dx0);
  const ay = Math.abs(dy0);
  const nx = tile.x + (ax * 2 >= ay ? Math.sign(dx0) : 0);
  const ny = tile.y + (ay * 2 >= ax ? Math.sign(dy0) : 0);
  if (unitDist({ x: nx, y: ny }, foe) === 0) return 0;
  if (g.highCover(nx, ny)) return 2;
  if (g.lowCover(nx, ny)) return 1;
  return 0;
}

// What an Interact works. Not the bell or the riddle board: their bows are `mech:` actions (ringing
// from the lectern, answering with Wit), so an Interact there only says so (§18.3).
const OBJECT_READY = new Set(['lever', 'junction', 'lamp', 'candle', 'line', 'console', 'lectern', 'alibi', 'clue', 'plan-tile', 'breaker', 'forge', 'chest', 'patch-kit']);
const DONE_STATES = new Set(['used', 'read', 'broken', 'found', 'marked', 'stoked', 'rung', 'solved', 'open', 'shut-down']);
export const workable = (o) => OBJECT_READY.has(o.kind) && !DONE_STATES.has(o.state) && !(o.kind === 'lamp' && o.state === 'lit') && !(o.kind === 'candle' && o.state === 'lit')
  && !(o.kind === 'junction' && o.state === 'on') && !(o.kind === 'line' && o.state === 'shut') && !(o.kind === 'chest' && o.state === 'open');
export const besideWorkable = (b, tile) => (b.objects || []).some((o) => workable(o) && unitDist(tile, o) <= 1);

/** An area use aimed to catch the most foes and no allies (null when it would catch none). */
export function aimArea(b, g, u, v, rel) {
  const t = v.spec.target || {};
  const self = t.who === 'self' || t.who === 'none' || t.area?.at === 'self';
  const size = (typeof t.area?.size === 'number' ? t.area.size : 1) + ((u.abilities?.wit ?? 0) >= 3 && v.a.kind === 'spell' && v.cost >= 2 ? 1 : 0);
  const score = (tiles) => {
    const ids = g.caught(tiles);
    let foes = 0;
    let allies = 0;
    for (const id of ids) {
      const w = unitIn(b, id);
      if (!w || !standing(w)) continue;
      if (w.side === u.side) allies += 1;
      else if (w.side !== 'neutral') foes += 1;
    }
    return allies ? -1 : foes;
  };
  const base = { a: v.a.id, cost: v.cost, choice: v.choice };
  if (self) {
    if (t.area?.shape === 'line') return null;
    const s = score(g.area(t.area?.shape || 'burst', size, { x: u.x, y: u.y }, { x: u.x, y: u.y }));
    return s >= 1 ? act('use', { ability: base.a, cost: base.cost, choice: base.choice }) : null;
  }
  const range = t.range ?? 6;
  let best = null;
  for (const f of rel.foes) {
    if (unitDist(u, f) > range || !g.sees(u, f)) continue;
    const aim = { x: f.x, y: f.y };
    const tiles = t.area?.shape === 'line' ? g.area('line', size, aim, { x: u.x, y: u.y }) : g.area(t.area?.shape || 'burst', size, aim, { x: u.x, y: u.y });
    const s = score(tiles);
    if (s >= 1 && (!best || s > best.s)) best = { s, aim };
  }
  if (!best) return null;
  const target = t.who === 'tile' ? { tile: best.aim } : { unit: g.occupant(best.aim.x, best.aim.y) };
  return act('use', { ability: base.a, cost: base.cost, choice: base.choice, target });
}


// ---------------------------------------------------------------------------
// Moving

/** Truncates a path to what `u` can stride this action, ending on a tile it can stand on. */
export function truncatePath(g, u, path, budget) {
  if (!path) return null;
  for (let n = path.length; n > 0; n -= 1) {
    const prefix = path.slice(0, n);
    const w = g.walk(u.id, prefix);
    if (w && w.cost <= budget) return prefix;
  }
  return [];
}

/**
 * A clean Stride toward a goal: the reachable tile (within this action's Speed, no surface that
 * hurts right now on the way, as few Parting swipes as it can) that scores lowest on `score(x, y)`
 * (null skips a tile). Returns the path, or null when no tile is better than staying.
 */
export function strideTo(g, rules, u, speed, score, { noSwipes = true, stay = null } = {}) {
  const tries = noSwipes ? [true, false] : [false];
  for (const ns of tries) {
    const reach = g.reachable(u.id, { budget: speed, noSwipes: ns });
    let best = null;
    for (const [key, info] of reach) {
      const comma = key.indexOf(',');
      const x = Number(key.slice(0, comma));
      const y = Number(key.slice(comma + 1));
      const s = score(x, y);
      if (s === null || s === undefined) continue;
      const total = s * 1000 + info.cost * 10 + info.swipes.length * 100;
      if (!best || total < best.total || (total === best.total && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, total, s };
    }
    if (!best || (stay !== null && best.s >= stay)) continue;
    const path = g.path(u.id, { x: best.x, y: best.y }, { noSwipes: ns, budget: speed });
    if (path && path.length && cleanPath(g, rules, u, path)) return path;
    // The cheapest path crosses a hurting surface: take the best tile whose path doesn't.
    const ranked = [];
    for (const [key, info] of reach) {
      const [x, y] = key.split(',').map(Number);
      const s = score(x, y);
      if (s === null || s === undefined || (stay !== null && s >= stay)) continue;
      ranked.push({ x, y, total: s * 1000 + info.cost * 10 + info.swipes.length * 100 });
    }
    ranked.sort((p, q) => p.total - q.total || p.y - q.y || p.x - q.x);
    for (const c of ranked.slice(0, 8)) {
      const p = g.path(u.id, { x: c.x, y: c.y }, { noSwipes: ns, budget: speed });
      if (p && p.length && cleanPath(g, rules, u, p)) return p;
    }
  }
  return null;
}

/** A Stride toward a unit: to beside it (melee) along the cheapest clean path, cut to this action's Speed. */
export function approachUnit(b, g, rules, u, target, speed) {
  if (!target) return null;
  let full = g.approach(u.id, target.id, { noSwipes: true });
  if (!full) full = g.approach(u.id, target.id);
  if (full && full.length) {
    const cut = truncatePath(g, u, full, speed);
    if (cut && cut.length && cleanPath(g, rules, u, cut)) return cut;
  }
  // No clean way along the cheapest line: the reachable tile nearest the target.
  const d0 = unitDist(u, target);
  return strideTo(g, rules, u, speed, (x, y) => {
    const d = unitDist({ x, y, size: u.size || 1 }, target);
    return d < d0 ? d : null;
  }, { stay: d0 });
}

/**
 * A Stride to a tile from which an attack of range `range` reaches some foe in sight; the nearest such
 * tile. With `cover` (the units to hide from), a firing tile in cover comes first; with `minDist`, no
 * tile nearer than that to a foe (keeping its distance).
 */
export function approachRange(b, g, rules, u, foes, range, speed, { cover = null, minDist: keep = 0 } = {}) {
  if (!foes.length) return null;
  const near = nearestOf(b, foes, u);
  const d0 = near ? unitDist(u, near) : Infinity;
  const firing = (probe) => {
    for (const v of foes) if (unitDist(probe, v) <= range && g.sees(probe, v)) return true;
    return false;
  };
  const scoreHere = (probe) => (cover ? 2 - coverFrom(g, probe, cover) : 0);
  const here = { x: u.x, y: u.y, size: u.size || 1 };
  const hereOk = firing(here) && (!keep || minDist(here, foes) >= keep);
  return strideTo(g, rules, u, speed, (x, y) => {
    const probe = { x, y, size: u.size || 1 };
    if (keep && minDist(probe, foes) < keep) return null;
    if (firing(probe)) return scoreHere(probe);
    let best = Infinity;
    for (const v of foes) best = Math.min(best, unitDist(probe, v));
    return best < d0 ? 10 + best : null;
  }, { stay: hereOk ? scoreHere(here) : range >= d0 && !keep ? 0 : 10 + d0 });
}

const moveAction = (path) => act('stride', { target: { path, tile: { ...path[path.length - 1] } } });

// ---------------------------------------------------------------------------
// Grids and projections

const gridCache = new WeakMap();

/**
 * A grid for a battle: kept for a frozen battle (one the kernel has settled), built fresh for B's
 * working copy, which it hands the minds mid-step and changes between calls.
 */
export function gridFor(b, rules) {
  if (!Object.isFrozen(b)) return createGrid(b, rules);
  let g = gridCache.get(b);
  if (!g) {
    g = createGrid(b, rules);
    gridCache.set(b, g);
  }
  return g;
}

// B's slotsBefore: while planning, the plan's earlier slots; once the round runs, what the schedule
// puts between the cursor and this slot.
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
 * The battle as the unit would stand before `slot` (B's `project`, the same rules with shallow copies):
 * its tile, attacks and heat, charges, uses and the actions taken this turn.
 */
export function projectAt(battle, unitId, plan, slot, ctx) {
  const u0 = unitIn(battle, unitId);
  if (!u0 || !plan) return battle;
  const before = slotsBefore(battle, unitId, plan, slot);
  if (!before.length) return battle;
  const u = { ...u0, usedRound: { ...(u0.usedRound || {}) }, uses: { ...(u0.uses || {}) }, charges: u0.charges ? { ...u0.charges } : u0.charges };
  for (const s of before) {
    const a = plan.slots[s];
    if (!a) continue;
    if (a.id !== 'delay') u.usedRound['#acted'] = (u.usedRound['#acted'] || 0) + 1;
    if ((a.id === 'stride' || a.id === 'step' || a.id === 'jump') && a.target) {
      const end = a.target.path?.length ? a.target.path[a.target.path.length - 1] : a.target.tile;
      if (end) {
        u.x = end.x;
        u.y = end.y;
      }
    }
    const ab = a.id === 'use' ? ability(ctx, a.ability) : null;
    const attack = a.id === 'strike' || a.id === 'throw' || a.id === 'shove' || (a.id === 'use' && (ab?.attack || (specFor(ab, a)?.effects || []).some((e) => e.do === 'act' && e.action === 'strike')));
    if (attack) {
      const light = (a.id === 'strike' || a.id === 'throw') && u.strike?.weapon === 'light';
      u.heat = clampHeat(u.heat + attackPenalty(u.attacks || 0, { light }).heat);
      u.attacks = (u.attacks || 0) + 1;
    }
    if (a.id === 'cool-down') u.heat = Math.max(0, u.heat - ctx.rules.heat.coolDown);
    if (ab) {
      if (ab.kind === 'spell' && ab.circle > 0) u.charges = { ...u.charges, left: Math.max(0, u.charges.left - (u.charges.pool === 'pact' ? 1 : ab.circle + (a.extra || 0))) };
      if (ab.uses && ['breather', 'campfire', 'fight'].includes(ab.uses.per)) u.uses[ab.id] = Math.max(0, (u.uses[ab.id] ?? numOf(ab.uses.n, u)) - 1);
      if (ab.uses && (ab.uses.per === 'turn' || ab.uses.per === 'round')) u.usedRound[ab.id] = (u.usedRound[ab.id] || 0) + 1;
      if (ab.uses?.per === 'target-round') {
        for (const id of a.target?.units || (a.target?.unit ? [a.target.unit] : [])) u.usedRound[`${ab.id}@${id}`] = (u.usedRound[`${ab.id}@${id}`] || 0) + 1;
      }
    }
  }
  Object.freeze(u);
  return Object.freeze({ ...battle, units: Object.freeze(battle.units.map((v) => (v.id === unitId ? u : v))) });
}

// ---------------------------------------------------------------------------
// Building a plan one slot at a time

/**
 * A plan built slot by slot: decide(b, slot, left, plan) → Action | null, where `b` is the battle
 * projected through the plan so far (B's `project`: tile, heat, attacks, charges, uses).
 */
export function buildPlan(battle, unitId, ctx, decide, by) {
  const u0 = unitIn(battle, unitId);
  const plan = { unitId, slots: [], reactions: { ...(u0?.reactions || {}) }, by, changed: [] };
  if (!u0 || !standing(u0)) return plan;
  for (let slot = 0; slot < 4; slot += 1) {
    const left = ticksLeft(plan, u0);
    if (left <= 0) break;
    const b = slot === 0 ? battle : projectAt(battle, unitId, plan, slot, ctx);
    const a = decide(b, slot, left, plan);
    if (!a) break;
    plan.slots.push(a);
    plan.changed.push(false);
  }
  return plan;
}

const attacksSoFar = (b, u) => u.attacks || 0;
const didThisTurn = (plan, id) => (plan.slots || []).some((a) => a.id === id);

function offlineBeside(b, u) {
  return b.units.find((v) => v.side === u.side && v.offline && !v.sorted && (v.drops || 0) < 2 && v.rank === 'hero' && unitDist(u, v) <= 1) || null;
}

function rebootAction(b, u, ctx, left) {
  const v = offlineBeside(b, u);
  if (!v) return null;
  const cost = Math.max(1, 2 + Math.min(0, modSum(b, v, 'reboot-cost', ctx)));
  if (cost > left) return null;
  return act('reboot', { cost, target: { unit: v.id } });
}

// ---------------------------------------------------------------------------
// The scripted player (the sim, the notebook tests and the tuning suite): patch the lowest under
// half, else strike the weakest in reach, else close in; at most two attacks a turn, then Brace.

export function scriptedPlan(battle, unitId, ctx) {
  const rules = ctx.rules;
  return buildPlan(battle, unitId, ctx, (b, slot, left, plan) => {
    const u = unitIn(b, unitId);
    if (!u || !standing(u)) return null;
    const g = gridFor(b, rules);
    const reboot = rebootAction(b, u, ctx, left);
    if (reboot) return reboot;
    const first = leadFirst(b, g, u, ctx, left);
    if (first) return first;
    const hurt = alliesOf(b, u, { self: true }).filter((v) => shareOf(v) < 0.5);
    if (hurt.length) {
      const low = weakestOf(b, hurt, u);
      const p = bestPatch(b, g, u, ctx, low, { left });
      if (p) return p.action;
    }
    const work = leadWork(b, unitId, ctx, { left, plan });
    if (work) return work;
    const foes = foesOf(b, u);
    if (!foes.length) return didThisTurn(plan, 'brace') ? null : act('brace');
    if (attacksSoFar(b, u) < 2) {
      const hit = bestAttack(b, g, u, ctx, foes, (list) => weakestOf(b, helpersFirst(b, list), u), { left });
      if (hit) return hit.action;
    }
    if (!foes.some((v) => optionReach(b, g, u, ctx, v))) {
      const path = offStomp(b, u, ctx, closeIn(b, g, rules, u, ctx, foes));
      if (path && path.length) return moveAction(path);
    }
    return didThisTurn(plan, 'brace') ? null : act('brace');
  }, 'you');
}

/** True when some attack option reaches a foe now. */
function optionReach(b, g, u, ctx, v) {
  if (canStrike(g, u, v)) return true;
  const r = attackRange(b, u, ctx);
  return r > 1 && unitDist(u, v) <= r && g.sees(u, v);
}

/** Close in: melee toward the nearest foe; a ranged hero to the nearest tile that has a foe in range. */
export function closeIn(b, g, rules, u, ctx, foes) {
  if (hasCond(u, 'tangled')) return null;
  const speed = speedOf(b, u, ctx, { stride: true });
  if (speed <= 0) return null;
  const range = attackRange(b, u, ctx);
  if (range > 1) {
    const p = approachRange(b, g, rules, u, foes, range, speed);
    if (p) return p;
  }
  return approachUnit(b, g, rules, u, nearestOf(b, foes, u), speed);
}

// ---------------------------------------------------------------------------
// Tale-lead fights: working the room (COMBAT §8.3; CONTRACT §7.4, §13 H2), with what I's leads.js offers,
// the way a player would. Only while a lead stands (`battle.lead`), so a stray room plays as before.

const heroesUp = (b) => b.units.filter((v) => v.side === 'party' && v.rank === 'hero' && standing(v)).sort((p, q) => ribbonIndex(b, p.id) - ribbonIndex(b, q.id));
const leadUp = (b) => (b.lead ? standing(unitIn(b, b.lead.unitId || 'lead')) : false);
const tileKey = (t) => `${t.x},${t.y}`;
const covers = (u, x, y, tiles) => footprint({ x, y, size: u.size || 1 }).some((t) => tiles.has(tileKey(t)));

/** A hero's targets in a lead fight: the lead's helpers first while any is in reach; elsewhere the list as it is. */
export function helpersFirst(b, list) {
  if (!b.lead || list.length < 2) return list;
  const others = list.filter((v) => v.id !== (b.lead.unitId || 'lead') && v.rank !== 'device');
  return others.length && others.length < list.length ? others : list;
}

/**
 * What's worth working now, by mechanic: junctions off, lamps and candles dark, levers up while a line
 * runs; for alibis, the clues still needed (one per standing alibi evidence doesn't cover) and as many
 * standing alibis as there's evidence in hand.
 */
export function leadObjects(b) {
  if (!b.lead || !leadUp(b)) return [];
  const objs = b.objects || [];
  const of = (kind, state) => objs.filter((o) => o.kind === kind && o.state === state);
  switch (b.lead.mechanic) {
    case 'throttles-speed': return of('junction', 'off');
    case 'streetlights-out': return of('lamp', 'dark');
    case 'snuffs-candles': return of('candle', 'dark');
    case 'assembly-lines': return of('line', 'running').length ? of('lever', 'up') : [];
    case 'alibis': {
      const e = Math.max(0, b.lead.data?.e || 0);
      const alibis = of('alibi', 'standing');
      return [...of('clue', 'hidden').slice(0, Math.max(0, alibis.length - e)), ...alibis.slice(0, e)];
    }
    default: return [];
  }
}

/**
 * Who works what: nearest pairs first (then the ribbon, then the object's id), one hero an object, at
 * most half the standing heroes (rounded up), and with three or more the hardest hitter keeps fighting;
 * Throttles speed takes everyone it needs (every junction, or all stay Slowed). → Map(heroId → object)
 */
export function roomJobs(b) {
  const objs = leadObjects(b);
  const jobs = new Map();
  if (!objs.length) return jobs;
  const heroes = heroesUp(b);
  const all = b.lead.mechanic === 'throttles-speed';
  const cap = all ? heroes.length : Math.max(1, Math.ceil(heroes.length / 2));
  const hitter = !all && heroes.length >= 3 ? heroes.reduce((m, h) => (strikeAmount(h) > strikeAmount(m) ? h : m), heroes[0]) : null;
  const pairs = [];
  for (const h of heroes) if (h !== hitter) for (const o of objs) pairs.push({ h, o, d: unitDist(h, o) });
  pairs.sort((p, q) => p.d - q.d || ribbonIndex(b, p.h.id) - ribbonIndex(b, q.h.id) || (p.o.id < q.o.id ? -1 : p.o.id > q.o.id ? 1 : 0));
  const taken = new Set();
  for (const { h, o } of pairs) {
    if (jobs.size >= cap) break;
    if (jobs.has(h.id) || taken.has(o.id)) continue;
    jobs.set(h.id, o);
    taken.add(o.id);
  }
  return jobs;
}

/** The first standing hero on the ribbon for whom `ok(hero)` holds: one hero does a once-a-round job. */
function designated(b, ok) {
  return heroesUp(b).find(ok)?.id ?? null;
}

/** A mechanic's ready option (no `why`) for `unitId` with this ability, as an Action, or null. */
function mechanicOption(b, unitId, ctx, abilityId, left) {
  for (const o of ctx.mechanics?.[b.lead?.mechanic]?.actions?.(b, unitId, ctx) || []) {
    if (o.why || o.action?.ability !== abilityId || (o.cost ?? 1) > left) continue;
    const target = Array.isArray(o.targets) ? o.targets[0] || null : null;
    if (!Array.isArray(o.targets) || target) return { ...o.action, target };
  }
  return null;
}

/** This round's stomp tiles when `u` can be stomped (Stomps loaded; fliers and floaters are above it), else null. */
function stompSet(b, u, ctx) {
  if (b.lead?.mechanic !== 'stomps' || !ctx.mechanics?.stomps || !leadUp(b) || u.moves?.flies || u.moves?.hovers) return null;
  return new Set(stompTiles(b).map(tileKey));
}

/** Whether `u` stands on this round's stomp. */
export function onStomp(b, u, ctx) {
  const tiles = stompSet(b, u, ctx);
  return !!tiles && covers(u, u.x, u.y, tiles);
}

/** A path cut short so it never ends on this round's stomp; null when no safe prefix is left. */
function offStomp(b, u, ctx, path) {
  const tiles = path && stompSet(b, u, ctx);
  if (!tiles) return path;
  for (let n = path.length; n > 0; n -= 1) if (!covers(u, path[n - 1].x, path[n - 1].y, tiles)) return path.slice(0, n);
  return null;
}

/** A Stride that brings `u` nearer `v` (beside it best), as far as this action goes, never ending on a stomp. */
function walkToward(b, g, u, ctx, v) {
  if (hasCond(u, 'tangled')) return null;
  const speed = speedOf(b, u, ctx, { stride: true });
  const d0 = unitDist(u, v);
  if (speed <= 0) return null;
  const path = offStomp(b, u, ctx, strideTo(g, ctx.rules, u, speed, (x, y) => {
    const d = unitDist({ x, y, size: u.size || 1 }, v);
    return d <= 1 ? 0 : d < d0 ? d : null;
  }, { stay: d0 }));
  return path && path.length ? moveAction(path) : null;
}

/**
 * Before a hero's own play in a lead fight: the standing hero nearest one who's offline walks over (the
 * Reboot follows this turn when it fits, else next), and a hero on this round's stomp steps off it (to a
 * plan tile first).
 */
function leadFirst(b, g, u, ctx, left) {
  if (!b.lead || !leadUp(b) || left < 1) return null;
  if (!offlineBeside(b, u)) {
    const heroes = heroesUp(b);
    const down = b.units.filter((v) => v.side === u.side && v.rank === 'hero' && v.offline && !v.sorted && (v.drops || 0) < 2)
      .sort((p, q) => unitDist(u, p) - unitDist(u, q) || ribbonIndex(b, p.id) - ribbonIndex(b, q.id))
      .find((v) => !heroes.some((w) => w.id !== u.id && (unitDist(w, v) < unitDist(u, v) || (unitDist(w, v) === unitDist(u, v) && ribbonIndex(b, w.id) < ribbonIndex(b, u.id)))));
    const walk = down ? walkToward(b, g, u, ctx, down) : null;
    if (walk) return walk;
  }
  const tiles = stompSet(b, u, ctx);
  if (!tiles || !covers(u, u.x, u.y, tiles) || hasCond(u, 'tangled')) return null;
  const plans = new Set((b.objects || []).filter((o) => o.kind === 'plan-tile').map(tileKey));
  const path = strideTo(g, ctx.rules, u, speedOf(b, u, ctx, { stride: true }), (x, y) => (covers(u, x, y, tiles) ? null : covers(u, x, y, plans) ? 0 : 1));
  return path && path.length ? moveAction(path) : null;
}

/**
 * One slot of the room's work, or null: the duel's winner holsters; against a lead too big to see, the
 * first standing hero on the ribbon Examines it, then names a step each round; otherwise this hero's roomJobs object: pull its
 * lever (2 actions) or interact when beside it, else walk toward it. `plan` is the turn so far, which is
 * projected for tiles and costs but not for what it does to the room, so a job is planned once a turn.
 */
export function leadWork(b, unitId, ctx, { left, plan = null }) {
  const u = unitIn(b, unitId);
  if (!b.lead || !leadUp(b) || !ctx.mechanics || !u || !standing(u)) return null;
  const planned = (pred) => (plan?.slots || []).some((a) => a && pred(a));
  if (planned((a) => String(a.ability || '').startsWith('mech:'))) return null;
  const mech = b.lead.mechanic;
  if (mech === 'noon-duel') return mechanicOption(b, unitId, ctx, 'mech:holster', left);
  const g = gridFor(b, ctx.rules);
  if (mech === 'too-big-to-see') {
    const lead = unitIn(b, b.lead.unitId || 'lead');
    // One hero, the first standing on the ribbon (whoever's plan is being made, since a plan projects only its own hero).
    if (designated(b, () => true) !== unitId) return null;
    const step = mechanicOption(b, unitId, ctx, 'mech:name-a-step', left);
    if (step) return step;
    return !lead.examined && !planned((a) => a.id === 'examine') && g.sees(u, lead) ? act('examine', { target: { unit: lead.id } }) : null;
  }
  const o = roomJobs(b).get(unitId);
  if (!o || planned((a) => a.id === 'interact' && a.target?.object === o.id)) return null;
  if (unitDist(u, o) > 1) return walkToward(b, g, u, ctx, o);
  return o.kind === 'lever' ? mechanicOption(b, unitId, ctx, 'mech:pull-the-lever', left) : act('interact', { target: { object: o.id } });
}

/** A personality's steps in a lead fight: `lead-first` right after its Reboot, and the room's work before its first attack. */
const leadStepsCache = new WeakMap();
function leadSteps(prefers) {
  if (!leadStepsCache.has(prefers)) {
    const out = prefers.flatMap((s) => (s === 'attack' ? ['lead-work', s] : s === 'reboot' ? [s, 'lead-first'] : [s]));
    leadStepsCache.set(prefers, out.includes('lead-work') ? out : [...out, 'lead-work']);
  }
  return leadStepsCache.get(prefers);
}

// ---------------------------------------------------------------------------
// Personalities: a hero's own turn when the notebook has nothing (the third layer, COMBAT §3.3)

/**
 * One slot of a hero's own play, by personality and heat: Hot (61+) presses on with attacks and
 * skips the Brace; Cool (30 or less) steadies with a Brace instead of a third attack.
 */
export function personalitySlot(b, unitId, ctx, { slot, left, plan }) {
  const u = unitIn(b, unitId);
  if (!u || !standing(u)) return null;
  const rules = ctx.rules;
  const p = PERSONALITIES[personalityOf(ctx, unitId)];
  const g = gridFor(b, rules);
  const hot = u.heat >= 61;
  const cool = u.heat <= 30;
  const foes = foesOf(b, u);
  // A Tale-lead's fight runs long and hits hard: every personality keeps two attacks a turn and patches
  // anyone under half, as the scripted player does (bolder and quicker ones still go first to the attack).
  const leadFight = !!b.lead && leadUp(b);
  const maxAttacks = leadFight ? Math.min(2, p.attacks) : hot ? 3 : cool ? Math.min(2, p.attacks) : p.attacks;
  const patchAt = leadFight ? Math.max(0.5, p.patchAt) : p.patchAt;
  for (const step of b.lead ? leadSteps(p.prefers) : p.prefers) {
    let a = null;
    switch (step) {
      case 'reboot': a = rebootAction(b, u, ctx, left); break;
      case 'lead-first': a = leadFirst(b, g, u, ctx, left); break;
      case 'lead-work': a = leadWork(b, unitId, ctx, { left, plan }); break;
      case 'patch': {
        const hurt = alliesOf(b, u, { self: true }).filter((v) => shareOf(v) < patchAt);
        if (hurt.length) a = bestPatch(b, g, u, ctx, weakestOf(b, hurt, u), { left })?.action || null;
        break;
      }
      case 'examine': {
        if (b.round !== 1 || slot !== 0) break;
        // Against a Tale-lead one Examine does for the party: the first on the ribbon who'd look (and a lead
        // too big to see is Examined as the room's work, by leadWork).
        if (leadFight && (b.lead.mechanic === 'too-big-to-see' || designated(b, (h) => PERSONALITIES[personalityOf(ctx, h.id)].prefers.includes('examine')) !== unitId)) break;
        const fresh = foes.filter((v) => !v.examined && (v.rank === 'elite' || v.rank === 'lead') && g.sees(u, v));
        if (fresh.length) a = act('examine', { target: { unit: nearestOf(b, fresh, u).id } });
        break;
      }
      case 'talk': {
        const kinds = talkTargets(b, g, u).map((id) => unitIn(b, id)).filter(Boolean);
        const going = kinds.find((v) => (b.talk?.[v.talkKind]?.calm || 0) > 0);
        const gentle = b.round === 1 && slot === 0 ? kinds.find((v) => ['shy', 'polite', 'lost', 'sleepy'].includes(v.temperament) && (b.talk?.[v.talkKind]?.need || 9) <= 2) : null;
        const v = going || gentle;
        if (v) a = act('talk-down', { target: { unit: v.id } });
        break;
      }
      case 'guard': {
        const threat = threatOf(b);
        const ward = threat ? threat.targets.map((id) => unitIn(b, id)).find((v) => v && v.side === u.side && v.id !== u.id && standing(v)) : null;
        if (ward && unitDist(u, ward) > 1 && slot === 0) {
          const speed = speedOf(b, u, ctx, { stride: true });
          // Against a Tale-lead a guard keeps its attacks: beside the ward where a foe is still in reach,
          // and not at all when that can't be had and it can strike from where it stands.
          const striking = (x, y) => foes.some((v) => optionReach(b, g, { ...u, x, y }, ctx, v));
          const keep = leadFight && foes.some((v) => optionReach(b, g, u, ctx, v));
          const tile = (x, y) => (unitDist({ x, y, size: u.size || 1 }, ward) > 1 ? null : !leadFight || striking(x, y) ? 0 : keep ? null : 1);
          const path = speed > 0 && !hasCond(u, 'tangled') ? strideTo(g, rules, u, speed, tile) : null;
          if (path) a = moveAction(path);
        }
        break;
      }
      case 'attack': {
        if (attacksSoFar(b, u) >= maxAttacks) break;
        const threat = threatOf(b);
        const pick = p === PERSONALITIES.guarding && threat
          ? (list) => list.find((v) => v.id === threat.unitId) || weakestOf(b, helpersFirst(b, list), u)
          : p === PERSONALITIES.bold ? (list) => nearestOf(b, helpersFirst(b, list), u) : (list) => weakestOf(b, helpersFirst(b, list), u);
        a = bestAttack(b, g, u, ctx, foes, pick, { left })?.action || null;
        break;
      }
      case 'close': {
        if (!foes.length || foes.some((v) => optionReach(b, g, u, ctx, v))) break;
        const path = offStomp(b, u, ctx, closeIn(b, g, rules, u, ctx, foes));
        if (path && path.length) a = moveAction(path);
        break;
      }
      case 'cool': if (u.heat >= 61 && left >= 1) a = act('cool-down'); break;
      case 'brace': if ((leadFight || !hot) && !didThisTurn(plan, 'brace')) a = act('brace'); break;
      default: break;
    }
    if (a) return a;
  }
  // Nothing fits: a hot hero with an attack left still presses on (not against a Tale-lead); otherwise Brace once.
  if (hot && !leadFight && attacksSoFar(b, u) < 3) {
    const hit = bestAttack(b, g, u, ctx, foes, (list) => weakestOf(b, helpersFirst(b, list), u), { left });
    if (hit) return hit.action;
  }
  return didThisTurn(plan, 'brace') ? null : act('brace');
}

const SETTING_WORDS = { ask: 'ask', always: 'always', 'under-half': 'under half', never: 'never' };
const REACTION_NAMES = {
  'parting-swipe': 'Parting swipe', shoulder: 'Shoulder', ready: 'Ready', 'draw-the-blow': 'Draw the blow', 'stand-in-my-light': 'Stand in my light',
  proofread: 'Proofread', 'tuck-and-roll': 'Tuck and roll', 'ready-a-shot': 'Ready a shot', 'sudden-shelter': 'Sudden shelter', 'cross-it-out': 'Cross it out',
};

/** The why? line for a hero's reaction settings (never drafted from notes: they're Member.reactions). */
export function reactionWhy(u) {
  const list = Object.entries(u?.reactions || {}).map(([id, s]) => `${REACTION_NAMES[id] || id.replace(/-/g, ' ')} ${SETTING_WORDS[s] || s}`);
  if (!list.length) return null;
  return { slot: 'reaction', layer: 'rule', text: `Reactions as you set them: ${list.join(', ')}.`, count: null, of: null };
}

/** The why? line for a slot from personality alone, in the planner's voice. */
export function personalityWhy(battle, unitId, ctx, slot) {
  const p = PERSONALITIES[personalityOf(ctx, unitId)];
  return { slot, layer: 'personality', text: `Nothing like this in the notebook yet. ${nameOf(battle, unitId)} ${p.words}.`, count: null, of: null };
}

/** §7.2: a hero's draft from personality alone (confidence 35). */
export function personalityDraft(battle, unitId, ctx) {
  const plan = buildPlan(battle, unitId, ctx, (b, slot, left, sofar) => personalitySlot(b, unitId, ctx, { slot, left, plan: sofar }), 'draft');
  const u = unitIn(battle, unitId);
  const why = plan.slots.map((_, slot) => personalityWhy(battle, unitId, ctx, slot));
  const r = reactionWhy(u);
  if (r) why.push(r);
  const choices = choicesOf(battle, unitId, plan, ctx).map((c, slot) => (c ? { slot, template: c.template, ability: c.ability } : null)).filter(Boolean);
  return { unitId, plan, confidence: 35, source: 'personality', why, choices };
}

// ---------------------------------------------------------------------------
// Strays' plans by temperament and role (§4.6), with the mode's AI row (§4.15) and adaptation

const TARGET_BY = {
  nosy: (b, u, heroes) => heroes.find((v) => v.kind === 'milo' || v.id === hooklight(b)?.source) || null,
  proud: (b, u, heroes) => [...heroes].filter((v) => v.rank === 'hero').sort((p, q) => q.maxIntegrity - p.maxIntegrity || q.integrity - p.integrity || ribbonIndex(b, p.id) - ribbonIndex(b, q.id))[0] || null,
};

/** A lost stray idles one round in three (a seeded offset per stray). */
export function idlesThisRound(b, u) {
  if (u.temperament !== 'lost') return false;
  const offset = hashInts(b.seed, ribbonIndex(b, u.id), 'lost') % 3;
  return (b.round + offset) % 3 === 0;
}

const isRanged = (u) => (u.strike?.range || 0) > 1 || !!u.ranged;
const NO_COUNTERS = Object.freeze(new Set());

/** Whether `u` is the most hurt of its side's standing foes (the one a "strike the most hurt" habit picks). */
function mostHurtOfItsSide(b, u) {
  const share = shareOf(u);
  if (share >= 1) return false;
  return alliesOf(b, u).every((v) => shareOf(v) > share + 1e-9 || (Math.abs(shareOf(v) - share) < 1e-9 && ribbonIndex(b, v.id) > ribbonIndex(b, u.id)));
}

/**
 * Whether `u` is the stray a "struck another stray" habit goes for: the nearest of its side to some
 * hero, and not the most hurt (that one is "the most hurt stray in reach").
 */
function nearestToAHero(b, u) {
  if (mostHurtOfItsSide(b, u)) return false;
  const side = alliesOf(b, u, { self: true });
  return foesOf(b, u).some((h) => h.rank === 'hero' && nearestOf(b, side, h)?.id === u.id);
}

/**
 * The heroes behind a habit that names an ability (its key's second half, notebook.js's
 * abilityHash): the standing heroes who have that ability. → Set of ids (empty for a basic action).
 */
export function habitSources(b, u, counter, kind = 'go-for-source') {
  const out = new Set();
  for (const h of counter?.habits?.length ? counter.habits : counter?.habit ? [counter.habit] : []) {
    if (counterKind(h) !== kind) continue;
    const hash = Number(String(h).split(':')[1]) || 0;
    if (!hash) continue;
    for (const v of foesOf(b, u)) if (v.rank === 'hero' && (v.abilityIds || []).some((id) => abilityHash(id) === hash)) out.add(v.id);
  }
  return out;
}

/**
 * The counters that change `u`'s plan (§4.15): the kinds of each habit the counter names (both at
 * step 4), kept only where they bite for this foe. Keeping its distance from "strike the most hurt
 * stray" is the most hurt stray's; from "struck another stray", the nearest stray's (not the most
 * hurt); from "close in", a ranged foe's. Holding back from "go for the Tale-lead" is the lead's.
 * Going for whoever hinders it needs a standing hero with the hindering ability. 'plain' (a habit
 * nothing counters) never changes a plan.
 */
export function activeCounters(b, u, counter) {
  if (!counter || !u) return NO_COUNTERS;
  const out = new Set();
  for (const h of counter.habits?.length ? counter.habits : [counter.habit]) {
    const kind = counterKind(h);
    const template = Number(String(h).split(':')[0]);
    if (kind === 'plain') continue;
    if (kind === 'keep-distance' && !(template === 11 ? mostHurtOfItsSide(b, u) : template === 13 ? nearestToAHero(b, u) : isRanged(u))) continue;
    if (kind === 'hold-back' && (template === 10 || template === 15) && u.rank !== 'lead') continue;
    if (kind === 'go-for-source' && !habitSources(b, u, { habits: [h] }).size) continue;
    out.add(kind);
  }
  return out.size ? out : NO_COUNTERS;
}

/** The heroes a counter leaves a foe to aim at (each filter kept only when someone's left). */
function counterPool(b, u, ctx, pool, kinds, counter = null) {
  let out = pool;
  const narrow = (list) => {
    if (list.length) out = list;
  };
  if (kinds.has('go-for-source')) {
    // Whoever hinders it: the heroes with the ability the habit names.
    const from = habitSources(b, u, counter);
    narrow(out.filter((v) => from.has(v.id)));
  }
  if (kinds.has('spread') && out.length > 1) {
    const low = weakestOf(b, out, u);
    narrow(out.filter((v) => v.id !== low.id));
  }
  if (kinds.has('uncovered')) {
    const g = gridFor(b, ctx.rules);
    narrow(out.filter((v) => g.cover(u.id, v.id) === 0));
  }
  if (kinds.has('before-brace')) {
    // Whoever acts after it in the ribbon: its blow lands in each tick before their Brace can.
    const i = ribbonIndex(b, u.id);
    narrow(out.filter((v) => ribbonIndex(b, v.id) > i));
  }
  return out;
}

/**
 * The hero a foe goes for this round, before reach: a counter's pool first (its own counter when
 * none is given), then at Maud's Table a hero who's Rebooting, then its temperament (nosy, proud),
 * then Maud's focus fire, else the nearest.
 */
export function foeTarget(b, u, ctx, given = undefined) {
  const heroes = foesOf(b, u);
  if (!heroes.length) return null;
  const mode = effMode(b);
  const counter = mode === 'storybook' ? null : given === undefined ? counterFor(b, u.id, ctx) : given;
  const kinds = activeCounters(b, u, counter);
  const realHeroes = heroes.filter((v) => v.rank === 'hero');
  // Decoys draw telegraphs when they're nearer than a hero (§6.5).
  const decoy = heroes.filter((v) => v.kind === 'decoy');
  const nearHero = nearestOf(b, realHeroes.length ? realHeroes : heroes, u);
  const nearDecoy = nearestOf(b, decoy, u);
  if (nearDecoy && (!nearHero || unitDist(u, nearDecoy) < unitDist(u, nearHero))) return nearDecoy;
  const pool = counterPool(b, u, ctx, realHeroes.length ? realHeroes : heroes, kinds, counter);
  if (mode === 'mauds-table') {
    // Crowd a hero who's Rebooting (beside an Offline ally who can still come back).
    const rebooting = pool.filter((v) => b.units.some((w) => w.side === v.side && w.offline && !w.sorted && (w.drops || 0) < 2 && unitDist(v, w) <= 1));
    if (rebooting.length) return nearestOf(b, rebooting, u);
  }
  if (mode !== 'storybook') {
    const pickBy = TARGET_BY[u.temperament];
    const t = pickBy ? pickBy(b, u, pool) : null;
    if (t) return t;
  }
  if (mode === 'mauds-table') return focusOf(b, u, ctx, pool) || nearestOf(b, pool, u);
  return nearestOf(b, pool, u);
}

export { counterKind };

const sameSlot = (p, q) => !!p && !!q && JSON.stringify(p) === JSON.stringify(q);

/**
 * §7.2: a foe's plan for the round, by temperament and role, the mode and adaptation. When a counter
 * bites, the plan it would have made without one is made too, and each slot the counter changed is
 * marked in `changed` (B keeps it with the plan, saves included): the adapting eye shows on those
 * slots' telegraphs, and only there.
 */
export function foePlan(battle, unitId, ctx) {
  const u0 = unitIn(battle, unitId);
  const empty = { unitId, slots: [], reactions: {}, by: 'foe', changed: [] };
  if (!u0 || !standing(u0) || u0.side !== 'foe' || u0.rank === 'device') return empty;
  if (idlesThisRound(battle, u0)) return empty;
  const counter = effMode(battle) === 'storybook' ? null : counterFor(battle, unitId, ctx);
  const kinds = activeCounters(battle, u0, counter);
  const plan = planWith(battle, unitId, ctx, counter, kinds);
  if (!kinds.size) return plan;
  const plain = planWith(battle, unitId, ctx, null, NO_COUNTERS);
  plan.changed = plan.slots.map((a, i) => !sameSlot(a, plain.slots[i]));
  return plan;
}

/** A tile's worst cover against the heroes (0 none, 1 low, 2 high); devices don't count, and with no heroes, none. */
const coverFrom = (g, tile, heroes) => {
  let m = 2;
  let any = false;
  for (const h of heroes) {
    if (h.rank !== 'hero') continue;
    any = true;
    m = Math.min(m, coverAt(g, tile, h));
  }
  return any ? m : 0;
};

/** The plan with a given counter (null and no kinds: the plan it would make without one). */
function planWith(battle, unitId, ctx, counter, kinds) {
  const rules = ctx.rules;
  const mode = effMode(battle);
  const u0 = unitIn(battle, unitId);
  const target0 = foeTarget(battle, u0, ctx, counter);
  const tactical = mode !== 'storybook';
  // Whom the counter leaves it to aim at: every other blow keeps to them while any is in reach.
  const heroes0 = foesOf(battle, u0);
  const real0 = heroes0.filter((v) => v.rank === 'hero');
  const allowed = kinds.size ? new Set(counterPool(battle, u0, ctx, real0.length ? real0 : heroes0, kinds, counter).map((v) => v.id)) : null;
  const keep = (list) => {
    if (!allowed) return list;
    const in_ = list.filter((v) => allowed.has(v.id));
    return in_.length ? in_ : list;
  };
  return buildPlan(battle, unitId, ctx, (b, slot, left, sofar) => {
    const u = unitIn(b, unitId);
    if (!u || !standing(u)) return null;
    const g = gridFor(b, rules);
    const heroes = foesOf(b, u);
    if (!heroes.length) return null;
    const target = target0 && standing(unitIn(b, target0.id) || {}) ? unitIn(b, target0.id) : nearestOf(b, heroes, u);
    const speed = speedOf(b, u, ctx, { stride: true });
    const canMove = speed > 0 && !hasCond(u, 'tangled');
    const ranged = isRanged(u);
    const keepAway = kinds.has('keep-distance');
    // Curious: examines the nearest hero first (round 1's first action), in every mode.
    if (u.temperament === 'curious' && b.round === 1 && slot === 0) {
      const near = nearestOf(b, heroes.filter((v) => v.rank === 'hero' && g.sees(u, v)), u);
      if (near) return act('examine', { target: { unit: near.id } });
    }
    // Hold back: a counter to heroes who go for whoever acts first; its first action is a Brace.
    if (kinds.has('hold-back') && slot === 0 && !u.buffer) return act('brace');
    // Dramatic: opens with its biggest move, once it's in range.
    if (u.temperament === 'dramatic' && !(u.mods || []).some((m) => m.stat === 'big-done')) {
      const big = bigMove(b, g, u, ctx, heroes, left);
      if (big) return big;
      if (slot === 0 && canMove) {
        const path = approachUnit(b, g, rules, u, target, speed);
        if (path) return moveAction(path);
      }
    }
    // Maud's Table: surface combos. Lay a surface on two or more heroes; knock a hero onto a surface that hurts, or off a height.
    if (mode === 'mauds-table' && attacksSoFar(b, u) < 3) {
      const lay = attacksSoFar(b, u) === 0 ? surfaceMove(b, g, u, ctx, heroes, left) : null;
      if (lay) return lay;
      let knock = null;
      for (const v of didThisTurn(sofar, 'shove') ? [] : keep(heroes)) {
        if (unitDist(u, v) > 1 || !g.sees(u, v)) continue;
        const w = knockWorth(g, rules, u, v);
        if (w > 0 && (!knock || w > knock.w || (w === knock.w && v.id === target.id))) knock = { v, w };
      }
      if (knock) return act('shove', { target: { unit: knock.v.id } });
    }
    // A crawler pounces from 2 or more tiles away.
    if (left >= 2 && unitDist(u, target) > 1 && attacksSoFar(b, u) === 0 && !keepAway) {
      const pounce = pounceAt(b, g, u, ctx, target, left);
      if (pounce) return pounce;
    }
    // A shy stray hits and runs (one attack, then a step back), as does the most hurt stray keeping
    // its distance (a ranged one keeps shooting from range); Maud's Table presses a third attack.
    const hitAndRun = u.temperament === 'shy' || (keepAway && !ranged);
    const maxAttacks = hitAndRun ? 1 : mode === 'mauds-table' ? 3 : 2;
    if (attacksSoFar(b, u) < maxAttacks) {
      const options = attackOptions(b, u, ctx, { left, big: mode === 'mauds-table' });
      const onTarget = bestAttack(b, g, u, ctx, heroes, (list) => list.find((v) => v.id === target.id) || null, { left, options });
      if (onTarget) return onTarget.action;
      // Someone else in reach: a stray set on one hero (nosy, proud, Maud's focus) keeps going for them while it can.
      const committed = mode === 'mauds-table' || (tactical && (u.temperament === 'nosy' || u.temperament === 'proud'));
      const other = bestAttack(b, g, u, ctx, heroes, (list) => (mode === 'mauds-table' ? weakestOf(b, keep(list), u) : nearestOf(b, keep(list), u)), { left, options });
      if (other && (!committed || !canMove || slot >= 2 || attacksSoFar(b, u) > 0)) return other.action;
    }
    // After attacking, a stray that hits and runs steps back; a floater (or a ranged foe keeping its distance) never stays beside a hero.
    const beside = heroes.filter((v) => unitDist(v, u) <= 1);
    if (beside.length && canMove && ((hitAndRun && attacksSoFar(b, u) > 0) || ((u.archetype === 'floater' || (keepAway && ranged)) && slot < 2))) {
      const step = stepAway(b, g, rules, u, beside, tactical ? heroes : null);
      if (step) return step;
    }
    if (attacksSoFar(b, u) === 0 && canMove && slot < 2) {
      let path = null;
      const spreadOut = kinds.has('spread-out');
      if (kinds.has('high-ground')) path = strideTo(g, rules, u, speed, (x, y) => (g.height(x, y) > g.height(u.x, u.y) ? unitDist({ x, y, size: u.size || 1 }, target) : null));
      if (!path && ranged) path = approachRange(b, g, rules, u, [target], Math.max(u.strike?.range || 0, u.ranged?.range || 0), speed, { cover: tactical ? heroes : null, minDist: keepAway ? 2 : 0 });
      if (!path && spreadOut) path = approachApart(b, g, rules, u, target, speed);
      if (!path) path = approachUnit(b, g, rules, u, target, speed);
      if (!path && target0) {
        const near = nearestOf(b, heroes, u);
        if (near && near.id !== target.id) path = approachUnit(b, g, rules, u, near, speed);
      }
      if (path) return moveAction(path);
    }
    // Long Road and Maud's: a ranged foe that has shot and has an action left gets into cover, keeping its target in range.
    if (tactical && ranged && attacksSoFar(b, u) > 0 && canMove && !beside.length && !didThisTurn(sofar, 'stride') && coverFrom(g, u, heroes) === 0) {
      const range = Math.max(u.strike?.range || 0, u.ranged?.range || 0);
      const path = strideTo(g, rules, u, speed, (x, y) => {
        const p = { x, y, size: u.size || 1 };
        const c = coverFrom(g, p, heroes);
        return c > 0 && unitDist(p, target) <= range && minDist(p, heroes) >= 2 ? 2 - c : null;
      });
      if (path) return moveAction(path);
    }
    // A ghost in the dark slips out of sight; everyone else braces once.
    if (u.archetype === 'ghost' && !hasCond(u, 'unseen') && footprint(u).every((t) => g.light(t.x, t.y) !== 'L') && !didThisTurn(sofar, 'hide')) return act('hide');
    return didThisTurn(sofar, 'brace') ? null : act('brace');
  }, 'foe');
}

/** Beside the target on a tile no other stray of its side stands beside (a counter to area habits), or null. */
function approachApart(b, g, rules, u, target, speed) {
  const friends = alliesOf(b, u);
  if (!friends.length) return null;
  const d0 = unitDist(u, target);
  const apart = (p) => friends.every((f) => unitDist(p, f) > 1);
  if (d0 <= 1 && apart(u)) return null;
  return strideTo(g, rules, u, speed, (x, y) => {
    const p = { x, y, size: u.size || 1 };
    if (!apart(p)) return null;
    const d = unitDist(p, target);
    return d < d0 || (d <= 1 && !apart(u)) ? d : null;
  });
}

/** A stray's big move when a hero is in its reach: { action } or null (Storybook still lets it show off). */
function bigMove(b, g, u, ctx, heroes, left) {
  for (const id of u.abilityIds || []) {
    for (const v of abilityVariants(ctx, id)) {
      if (!v.a.big || v.cost > left) continue;
      if (abilityWhy(b, u, v.a, v.cost, ctx)) continue;
      const t = v.spec.target || { who: 'self' };
      if (t.who === 'self' || t.who === 'none') {
        const size = t.area?.size ?? 1;
        if (heroes.some((h) => unitDist(u, h) <= size)) return act('use', { ability: v.a.id, cost: v.cost, choice: v.choice });
        continue;
      }
      if (t.who === 'tile') {
        const range = t.range ?? 6;
        const h = nearestOf(b, heroes.filter((x) => unitDist(u, x) <= range && g.sees(u, x)), u);
        if (h) return act('use', { ability: v.a.id, cost: v.cost, choice: v.choice, target: { tile: { x: h.x, y: h.y } } });
        continue;
      }
      const ids = new Set(variantTargets(b, g, u, v));
      const h = nearestOf(b, heroes.filter((x) => ids.has(x.id)), u);
      if (h) return act('use', { ability: v.a.id, cost: v.cost, choice: v.choice, target: { unit: h.id } });
    }
  }
  return null;
}

/** Pounce (a crawler's 2-action Stride-and-Strike) at a target it can reach. */
function pounceAt(b, g, u, ctx, target, left) {
  for (const id of u.abilityIds || []) {
    for (const v of abilityVariants(ctx, id)) {
      if (v.cost !== 2 || v.cost > left) continue;
      const effects = v.spec.effects || [];
      if (!effects.some((e) => e.do === 'act' && e.action === 'stride') || !effects.some((e) => e.do === 'act' && e.action === 'strike')) continue;
      if (abilityWhy(b, u, v.a, v.cost, ctx)) continue;
      if (!variantTargets(b, g, u, v).includes(target.id)) continue;
      // Only when a Stride of its Speed really gets it beside the target.
      const path = g.approach(u.id, target.id, { budget: speedOf(b, u, ctx, { stride: true }) });
      if (!path) continue;
      return act('use', { ability: v.a.id, cost: 2, choice: v.choice, target: { unit: target.id } });
    }
  }
  return null;
}

/**
 * A Step (no Parting swipe) to the free neighbour farthest from the given units, when it's farther;
 * with `cover` (the heroes, on Long Road and at Maud's Table), the one with the best cover first.
 */
function stepAway(b, g, rules, u, from, cover = null) {
  let best = null;
  const d0 = Math.min(...from.map((v) => unitDist(u, v)));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const t = { x: u.x + dx, y: u.y + dy };
    if (!g.walk(u.id, [t], { noSwipes: true }) || hurtsAt(g, rules, u, t.x, t.y)) continue;
    const d = Math.min(...from.map((v) => unitDist({ x: t.x, y: t.y, size: u.size || 1 }, v)));
    const c = cover ? coverFrom(g, t, cover) : 0;
    if (d > d0 && (!best || c > best.c || (c === best.c && d > best.d))) best = { t, d, c };
  }
  return best ? act('step', { target: { tile: best.t } }) : null;
}

// ---------------------------------------------------------------------------
// When a plan meets the round (§5.5): a companion improvises from personality; a foe re-picks by temperament

/**
 * §7.2: what `unitId` does instead of an action that can't happen now (`why`), or null. B checks the
 * answer is legal before using it. Never a note: B marks it `improvise`, and learning never sees it.
 */
export function improvise(battle, unitId, action, why, ctx) {
  const u = unitIn(battle, unitId);
  if (!u || !standing(u)) return null;
  const rules = ctx.rules;
  const g = gridFor(battle, rules);
  const foes = foesOf(battle, u);
  const cost = Math.max(1, Number(action?.cost) || 1);
  // A blocked Stride goes as near its old goal as it cleanly can.
  if ((action?.id === 'stride' || action?.id === 'step') && why !== 'tangled' && why !== 'spooked') {
    const goal = action.target?.path?.[action.target.path.length - 1] || action.target?.tile;
    const speed = speedOf(battle, u, ctx, { stride: true });
    if (goal && speed > 0 && !hasCond(u, 'tangled')) {
      const d0 = dist(u, goal);
      const path = strideTo(g, rules, u, speed, (x, y) => {
        const d = dist({ x, y }, goal);
        return d < d0 ? d : null;
      }, { stay: d0 });
      if (path) return moveAction(path);
    }
  }
  // A patch whose ally is gone or fine: the lowest ally who still needs one.
  if (action?.id === 'use') {
    const v = abilityVariants(ctx, action.ability).find((x) => x.cost === action.cost) || abilityVariants(ctx, action.ability)[0];
    if (v && (v.role === 'patch' || v.role === 'help')) {
      const hurt = alliesOf(battle, u, { self: true }).filter((w) => shareOf(w) < 0.75);
      if (hurt.length) {
        const p = bestPatch(battle, g, u, ctx, weakestOf(battle, hurt, u), { left: cost });
        if (p) return p.action;
      }
    }
  }
  if (foes.length) {
    const target = u.side === 'foe' ? foeTarget(battle, u, ctx) : null;
    const pick = (list) => (target && list.find((v) => v.id === target.id)) || weakestOf(battle, list, u);
    const hit = bestAttack(battle, g, u, ctx, foes, pick, { left: cost });
    if (hit) return hit.action;
    const speed = speedOf(battle, u, ctx, { stride: true });
    if (speed > 0 && !hasCond(u, 'tangled')) {
      const path = u.side === 'foe' ? approachUnit(battle, g, rules, u, target || nearestOf(battle, foes, u), speed) : closeIn(battle, g, rules, u, ctx, foes);
      if (path) return moveAction(path);
    }
  }
  return act('brace');
}

// ---------------------------------------------------------------------------
// The minds (§6.6)

/** A Draft wrapping the scripted player's plan (makeMinds' `scripted: true`). */
function scriptedDraft(battle, unitId, ctx) {
  const plan = { ...scriptedPlan(battle, unitId, ctx), by: 'draft' };
  const choices = choicesOf(battle, unitId, plan, ctx).map((c, slot) => (c ? { slot, template: c.template, ability: c.ability } : null)).filter(Boolean);
  return { unitId, plan, confidence: 100, source: 'rule', why: plan.slots.map((_, slot) => ({ slot, layer: 'rule', text: 'The scripted player’s choice.', count: null, of: null })), choices };
}

/**
 * §6.6's Minds for B's kernel: strays' plans and telegraphs (with adaptation, hidden and false
 * intents), heroes' drafts from their notebooks (else personality), situations and choices, and
 * improvising and feints. `notebooks`: { [unitId]: Notebook }. `scripted`: every hero drafts as
 * the scripted player (the sim, the tuning suite and tests).
 */
export function makeMinds(ctx, { notebooks = {}, scripted = false } = {}) {
  return {
    foePlan: (battle, unitId) => foePlan(battle, unitId, ctx),
    telegraphs: (battle, unitId, plan) => telegraphsOf(battle, unitId, plan, ctx),
    draft: (battle, unitId) => {
      if (scripted) return scriptedDraft(battle, unitId, ctx);
      const nb = notebooks?.[unitId];
      return nb ? draftFor(nb, battle, unitId, ctx) : personalityDraft(battle, unitId, ctx);
    },
    situation: (battle, unitId) => situationOf(battle, unitId, ctx),
    choices: (battle, unitId, plan) => choicesOf(battle, unitId, plan, ctx),
    improvise: (battle, unitId, action, why) => improvise(battle, unitId, action, why, ctx),
    revise: (battle, unitId, tick) => reviseLead(battle, unitId, tick, ctx),
    scriptedPlan: (battle, unitId) => scriptedPlan(battle, unitId, ctx),
  };
}

// Exported for tests and the sim.
export { unit01 as unitDraw, levelOf, condOf };
