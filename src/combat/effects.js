// The effect language and the resolution kernel (CONTRACT-PHASE4.md §6, §7.1; COMBAT.md §3–§7).
// Every knack, spell, feature, move, item and device is data in §6's closed vocabulary; this
// module validates it and makes it happen: outcome picks, damage in §4.8's order, patches,
// conditions, movement with its triggers, reactions and the §6.5 rule registry. Pure: a run
// works on its own copy of a Battle and returns a new, frozen one.
import { hashInts } from '../world/rng.js';
import { draw, degreeAt, clampHeat, attackPenalty, bandOf } from './heat.js';
import { line, strayRow, damageSteps, adaptStep, stirs } from './rules.js';
import { createGrid, dist, footprint, unitDist, foeDistances, cameCloser } from './grid.js';
import {
  unitIn, standing, condOf, hasCond, asleep, ability, effMode, levelOf, idleHeatOf, numOf, hasRule, hooklight, inHooklight, modSum,
  speedOf, resolveOf, casterKind, oddsAgainst, defencesTo, proofreadOutcome, hitReactions, strikeAtAlly, spendUse, surfaceReact,
  burstHazards, setSurface, moveAlong, forcedMove, ribbon,
} from './round.js';
import { specFor, summonDevice, commandDevice, viewOf, nextId, dimTile, predicateHolds } from './abilities.js';

// The vocabulary and validateAbility live in abilities.js; effects.js exports them (§7.1).
export { VERBS, PREDICATES, TRIGGERS, RULE_IDS, UNTIL, DEVICE_TEMPLATES, READY_TRIGGERS, REACTION_IDS, OBJECT_KINDS, OBJECT_STATES, SURFACE_IDS, CONDITION_IDS, DAMAGE_KINDS, MOD_STATS, validateAbility } from './abilities.js';
// The devices and the planner's per-use reads live in abilities.js; the kernel's API keeps exporting them here.
export { abilityRolls, abilityAmount, deviceSpec, summonDevice, viewOf, nextId } from './abilities.js';

// ---------- a run: a mutable working copy ----------

function copy(v) {
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i += 1) out[i] = copy(v[i]);
    return out;
  }
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = copy(v[k]);
    return out;
  }
  return v;
}

/**
 * A copy with JSON's semantics (what JSON.parse(JSON.stringify(v)) gives for plain data): undefined
 * and function properties dropped, undefined array items and non-finite numbers as null.
 */
export function jsonCopy(v) {
  if (v === undefined || typeof v === 'function') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i += 1) out[i] = jsonCopy(v[i]);
    return out;
  }
  if (ArrayBuffer.isView(v)) return JSON.parse(JSON.stringify(v));
  const out = {};
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x === undefined || typeof x === 'function') continue;
    out[k] = jsonCopy(x);
  }
  return out;
}

// Parts of a Battle the kernel never changes in place: when they're already frozen, a copy shares
// them (the kernel replaces them whole when they change, e.g. `u.strike = { ...u.strike, amount }`).
const STATIC_BATTLE = new Set(['arena', 'calm', 'genres', 'affixes', 'real']);
const STATIC_UNIT = new Set(['abilities', 'look', 'resolve', 'moves', 'strike', 'ranged', 'resist', 'weak', 'ignores', 'abilityIds', 'reactions',
  'lead', 'post', 'genres']);

function copyUnit(u) {
  const out = {};
  for (const k of Object.keys(u)) {
    const v = u[k];
    out[k] = STATIC_UNIT.has(k) && v !== null && typeof v === 'object' && Object.isFrozen(v) ? v : copy(v);
  }
  return out;
}

/** A deep copy of a Battle's plain data, sharing the frozen parts that never change in place. */
export function cloneBattle(b) {
  const out = {};
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (STATIC_BATTLE.has(k) && (k === 'arena' || v === null || typeof v !== 'object' || Object.isFrozen(v))) out[k] = v;
    else if (k === 'units') out[k] = v.map(copyUnit);
    else out[k] = copy(v);
  }
  return out;
}

/** Deep-freezes plain data, skipping anything already frozen. */
export function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** Thrown when a reaction set to Ask triggers: the step stops and waits for an answer. */
export class AskSignal {
  constructor(ask) {
    this.ask = ask;
  }
}

export function makeRun(battle, ctx) {
  return { b: cloneBattle(battle), ctx, rules: ctx.rules, events: [], g: null, scratch: {} };
}
export const gridOf = (run) => run.g || (run.g = createGrid(run.b, run.rules));
export const dirty = (run) => {
  run.g = null;
};
export function emit(run, ev) {
  const { t, ...rest } = ev;
  const e = { t, round: run.b.round, tick: run.b.tick, ...rest };
  run.events.push(e);
  if (stirs(e)) stirRound(run);
}
export const U = (run, id) => unitIn(run.b, id);

// ---------- standoffs (§18.2): rules.stirs says which events are something happening ----------

/** Marks this round as one where something happened (`Battle.quiet` −1 until the round's end). */
export function stirRound(run) {
  const s = run.b.status;
  if (s === 'planning' || s === 'running' || s === 'asking') run.b.quiet = -1;
}

/** Every unit's foeDistances, to compare after something moved units about (a swap, a hook). */
const allFoeDistances = (battle) => battle.units.map((u) => [u.id, foeDistances(battle, u)]);
const anyCameCloser = (run, snap) => snap.some(([id, before]) => cameCloser(run.b, U(run, id), before));

/** Takes a hook's returned Battle into the run, keeping unit, object and lead identities. */
export function adopt(run, next) {
  if (!next || next === run.b) return;
  const c = cloneBattle(next);
  const units = new Map(run.b.units.map((u) => [u.id, u]));
  c.units = c.units.map((cu) => {
    const old = units.get(cu.id);
    if (!old) return cu;
    for (const k of Object.keys(old)) if (!(k in cu)) delete old[k];
    return Object.assign(old, cu);
  });
  const objects = new Map((run.b.objects || []).map((o) => [o.id, o]));
  c.objects = (c.objects || []).map((co) => {
    const old = objects.get(co.id);
    if (!old) return co;
    for (const k of Object.keys(old)) if (!(k in co)) delete old[k];
    return Object.assign(old, co);
  });
  if (run.b.lead && c.lead) {
    const old = run.b.lead;
    for (const k of Object.keys(old)) if (!(k in c.lead)) delete old[k];
    c.lead = Object.assign(old, c.lead);
  }
  // The kernel's own bookkeeping (auto play, the standoff count, Ask answers) stays, even when a hook's Battle leaves it out.
  for (const k of Object.keys(run.b)) if (!(k in c) && !KERNEL_KEYS.has(k)) delete run.b[k];
  Object.assign(run.b, c);
  dirty(run);
}
const KERNEL_KEYS = new Set(['auto', 'quiet', 'answers']);

/** Runs a hook that returns { battle, events } and folds it into the run. */
export function hook(run, fn, ...args) {
  if (typeof fn !== 'function') return null;
  const snap = allFoeDistances(run.b);
  const r = fn(run.b, ...args);
  if (!r) return r;
  if (r.battle) adopt(run, r.battle);
  for (const e of r.events || []) {
    run.events.push(e);
    if (stirs(e)) stirRound(run);
  }
  // A hook that brought a unit closer to a foe is something happening too (§18.2).
  if (r.battle && anyCameCloser(run, snap)) stirRound(run);
  return r;
}

export const mechanicOf = (run) => {
  const lead = run.b.lead;
  if (!lead) return null;
  const m = run.ctx.mechanics || {};
  return m[lead.mechanic] || m.fallback || null;
};

// ---------- state helpers ----------

export function setHeat(run, u, heat) {
  const h = clampHeat(heat);
  if (h === u.heat) return;
  u.heat = h;
  emit(run, { t: 'heat', unit: u.id, heat: h, band: bandOf(h) });
}

const freshNow = (run) => run.b.status === 'running' || run.b.status === 'asking';
// Conditions that shape a turn's ticks (Slowed, Winded, Quickened, Brisk): landed while a round runs,
// they wait for the next round's ticks and skip this round's countdown (`data.fresh`). Every other
// condition counts down at the end of the round it lands in (§7.1).
const TICK_SHAPING = new Set(['slowed', 'winded', 'quickened', 'brisk']);

/** Refreshes the Hooklight: it follows Milo, and drops to 0 when he's offline, Tumbled or asleep. */
export function syncLantern(run) {
  const l = (run.b.lights || []).find((x) => x.id === 'hooklight');
  if (!l) return;
  const milo = run.b.units.find((u) => u.id === l.source) || run.b.units.find((u) => u.kind === 'milo');
  if (!milo) return;
  const down = milo.offline || hasCond(milo, 'tumbled') || hasCond(milo, 'drowsy');
  let changed = false;
  if (l.x !== milo.x || l.y !== milo.y) {
    l.x = milo.x;
    l.y = milo.y;
    // §18.3: a `light` event whenever the Hooklight moves, sent after the `move` that carried Milo.
    changed = run.lightDue = true;
  }
  if (down && l.radius !== 0) {
    l.radius = 0;
    run.lightDue = true;
    flushLight(run);
  }
  if (changed) dirty(run);
  // Unseen foes inside the Hooklight are revealed (it never spoils the party's own hiding).
  if (l.radius > 0) {
    for (const v of run.b.units) {
      if (v.side === milo.side || !standing(v) || !hasCond(v, 'unseen')) continue;
      if (!footprint(v).some((t) => dist(l, t) <= l.radius)) continue;
      endCondition(run, v, 'unseen');
      emit(run, { t: 'reveal', unit: v.id, what: 'unseen', text: `The lantern finds ${v.name}.` });
    }
  }
}

/** Sends the `light` event a Hooklight change left waiting. */
export function flushLight(run) {
  if (!run.lightDue) return;
  run.lightDue = false;
  emit(run, { t: 'light', lights: copy(run.b.lights) });
}

/** A light arriving reveals the other side's Unseen units inside it (COMBAT §7: revealed when it's lit). */
export function revealLit(run, light, side) {
  if (!light || !(light.radius > 0)) return;
  for (const v of run.b.units) {
    if (v.side === side || !standing(v) || !hasCond(v, 'unseen')) continue;
    if (!footprint(v).some((t) => dist(light, t) <= light.radius)) continue;
    endCondition(run, v, 'unseen');
    emit(run, { t: 'reveal', unit: v.id, what: 'unseen', text: `The light finds ${v.name}.` });
  }
}

/** A foe ghost that ends a move wholly in the dark slips out of sight (§4.9: Unseen in the dark). */
export function ghostInDark(run, u) {
  if (!u || !standing(u) || u.archetype !== 'ghost' || u.side === 'party' || hasCond(u, 'unseen')) return;
  const g = gridOf(run);
  if (footprint(u).every((t) => g.light(t.x, t.y) === 'D')) addCondition(run, u, 'unseen', null, { degree: 'hit' });
}

export function addMod(run, u, mod) {
  if (!u || !mod?.stat) return false;
  u.mods = u.mods || [];
  const existing = u.mods.find((m) => m.stat === mod.stat && m.source === (mod.source ?? null) && m.until === mod.until);
  if (existing) {
    existing.by = mod.by;
    return true;
  }
  if (u.mods.length >= 6) u.mods.shift();
  u.mods.push({ stat: mod.stat, by: mod.by, until: mod.until || 'end-of-round', source: mod.source ?? null });
  return true;
}

export function addMark(run, target, mark) {
  target.marks = target.marks || [];
  const i = target.marks.findIndex((m) => m.id === mark.id && m.by === mark.by);
  if (i >= 0) target.marks.splice(i, 1);
  if (mark.id === 'bead' || mark.id === 'wanted') {
    // A bead or a wanted poster is one at a time: drawing another moves it.
    for (const v of run.b.units) {
      const j = (v.marks || []).findIndex((m) => m.id === mark.id && m.by === mark.by);
      if (j >= 0) {
        v.marks.splice(j, 1);
        endCondition(run, v, 'singled-out');
      }
    }
  }
  if (target.marks.length >= 4) target.marks.shift();
  target.marks.push({ id: mark.id, by: mark.by, n: mark.n ?? 1, until: mark.until || 'end-of-next-round' });
}

/**
 * Consumes what ends with the holder's next action, attack or stride: its own mods, a Drawn mark
 * on it, and Assist marks it was given on its target.
 */
export function consumeUntil(run, u, until, keep = null) {
  if (!u) return;
  if (u.mods?.length) u.mods = u.mods.filter((m) => m.until !== until || m.stat === keep);
  if (u.marks?.length) u.marks = u.marks.filter((m) => !(m.until === until && m.id === 'drawn'));
  for (const v of run.b.units) {
    if (v.marks?.length) v.marks = v.marks.filter((m) => !(m.until === until && m.by === u.id && m.id === 'assist'));
  }
}

/** Ends a kind's calm when a harmful outcome lands on one of that kind. */
export function resetCalm(run, target) {
  const kind = target?.talkKind;
  if (!kind) return;
  const t = run.b.talk?.[kind];
  if (!t || t.done || t.calm === 0) return;
  t.calm = 0;
  emit(run, { t: 'calm', kind, calm: 0, need: t.need });
}

// ---------- conditions ----------

export function addCondition(run, target, id, n = null, { source = null, data = null, degree = 'hit', helpful = false } = {}) {
  if (!target || target.sorted) return false;
  if (target.offline && id !== 'offline') return false;
  const info = run.rules.conditions[id];
  if (!info) return false;
  if ((target.ignores || []).includes(id)) return false;
  if (degree === 'miss') return false;
  let value = info.numbered ? Math.max(1, Math.trunc(Number(n ?? 1))) : n === null || n === undefined ? null : Math.max(1, Math.trunc(Number(n)));
  if (degree === 'crit' && info.numbered && info.crit === 'double') value *= 2;
  if (degree === 'graze') {
    if (helpful) {
      if (info.numbered && value >= 2) value = Math.floor(value / 2);
    } else {
      if (!info.numbered || info.graze === 'none') return false;
      value = Math.floor(value / 2);
      if (value <= 0) return false;
    }
  }
  target.conditions = target.conditions || [];
  const match = (c) => c.id === id && (id !== 'lingering' || c.data?.kind === data?.kind);
  const existing = target.conditions.find(match);
  let extra = null;
  if (id === 'singed' || id === 'lingering') extra = { ...(data || {}), turns: run.rules.lingerTurns ?? 3 };
  else if (data) extra = { ...data };
  if (freshNow(run) && TICK_SHAPING.has(id)) extra = { ...(extra || {}), fresh: true };
  if (existing) {
    const higher = value !== null && (existing.n === null || value > existing.n);
    if (!higher && !(id === 'singed' || id === 'lingering')) return false;
    if (higher) existing.n = value;
    if (extra?.turns) existing.data = { ...(existing.data || {}), turns: extra.turns };
    if (source && !existing.source) existing.source = source;
    emit(run, { t: 'condition', target: target.id, id, n: existing.n, on: true });
    return true;
  }
  if (target.conditions.length >= 8) return false;
  target.conditions.push({ id, n: value, source: source ?? null, data: extra });
  emit(run, { t: 'condition', target: target.id, id, n: value, on: true });
  if (id === 'soaked') endCondition(run, target, 'singed');
  if ((id === 'tumbled' || id === 'drowsy') && target.kind === 'milo') syncLantern(run);
  if (id === 'unseen' || id === 'tumbled') dirty(run);
  return true;
}

export function endCondition(run, target, id, { kind = null } = {}) {
  if (!target?.conditions?.length) return false;
  const before = target.conditions.length;
  const ended = target.conditions.filter((c) => c.id === id && (kind === null || c.data?.kind === kind));
  if (!ended.length) return false;
  target.conditions = target.conditions.filter((c) => !ended.includes(c));
  if (target.conditions.length !== before) {
    emit(run, { t: 'condition', target: target.id, id, n: null, on: false });
    if (id === 'brisk') addCondition(run, target, 'winded', null, { degree: 'hit' });
  }
  return true;
}

const BOONS = new Set(['quickened', 'brisk', 'unseen']);

/** Ends conditions by class: 'boon', 'bane' (every other but Offline), 'lingering' or 'any'. */
export function endClass(run, target, cls, count = 99) {
  let left = count;
  for (const c of [...(target.conditions || [])]) {
    if (left <= 0) break;
    const isBoon = BOONS.has(c.id);
    const fits = cls === 'any' ? c.id !== 'offline' : cls === 'boon' ? isBoon : cls === 'lingering' ? c.id === 'lingering' || c.id === 'singed' : !isBoon && c.id !== 'offline';
    if (!fits) continue;
    endCondition(run, target, c.id, { kind: c.id === 'lingering' ? c.data?.kind ?? null : null });
    left -= 1;
  }
  if (cls === 'boon' || cls === 'any') {
    const before = (target.mods || []).length;
    target.mods = (target.mods || []).filter((m) => !(m.by > 0 && m.until !== 'fight'));
    if (target.mods.length !== before) left -= 1;
  }
  return count - left;
}

// ---------- predicates ----------

/** A predicate (§6.2) on an effect's target; the user's own (lantern-down, has-device, stitched-genre) need no target. */
export function predicate(run, p, user, target) {
  const own = p === 'lantern-down' || p === 'has-device' || p === 'stitched-genre';
  return (own || !!target) && predicateHolds(run.b, gridOf(run), p, user, target || user);
}

// ---------- picks ----------

/** Picks one outcome from the odds, emits it, and lets Proofread-style reactions move it. */
export function pickOutcome(run, actorId, targetId, odds, { proofread = true } = {}) {
  const b = run.b;
  const k = b.k;
  const u = draw(b.seed, b.attempt, k);
  let degree = degreeAt(u, odds.bars);
  b.k = k + 1;
  if (odds.armour && b.lead && !b.lead.armourUsed) {
    if (degreeAt(u, odds.unfolded) !== 'miss') b.lead.armourUsed = true;
  }
  emit(run, { t: 'outcome', unit: actorId, target: targetId, degree, bars: [...odds.bars], k, cheer: !!odds.cheer, by: null });
  if (odds.unkind && degree === 'crit' && degreeAt(u, odds.unkind) === 'hit') emit(run, { t: 'noise', genre: 'starlight', what: 'kind', unit: actorId });
  const actor = actorId ? U(run, actorId) : null;
  const target = targetId ? U(run, targetId) : null;
  if (actor && target && actor.side !== target.side) {
    if (actor.mods?.some((m) => m.stat === 'degree-next-on-foe')) actor.mods = actor.mods.filter((m) => m.stat !== 'degree-next-on-foe');
    if (target.mods?.some((m) => m.stat === 'degree-next-from-foe' || m.stat === 'resolve-set')) {
      target.mods = target.mods.filter((m) => !(m.until === 'next-effect' && (m.stat === 'degree-next-from-foe' || m.stat === 'resolve-set')));
    }
  }
  if (proofread && actor) degree = proofreadOutcome(run, actor, target, degree);
  // A hero's Critical may earn one bark this round.
  if (degree === 'crit' && actor && actor.side === 'party' && target && target.side !== actor.side) bark(run, actor.id, 'critical');
  return degree;
}

// ---------- damage ----------

/** A foe or hero dropping to 0: offline, sorted, a device gone, or a lead's next bar. */
export function downUnit(run, target, byId) {
  if (target.id === 'lead' && run.b.lead) {
    leadBar(run, byId);
    return;
  }
  if (target.rank === 'device') {
    target.integrity = 0;
    removeUnit(run, target.id, 'broken');
    return;
  }
  if (target.side === 'party') {
    const unbroken = (target.abilityIds || []).map((id) => ability(run.ctx, id)).find((a) => a && (a.passive?.rules || []).includes('unbroken'));
    if (unbroken && (target.uses?.[unbroken.id] ?? 1) > 0) {
      target.uses = { ...(target.uses || {}), [unbroken.id]: 0 };
      target.integrity = 1;
      emit(run, { t: 'line', text: `${target.name} stays up at 1 Integrity.` });
      return;
    }
    target.integrity = 0;
    target.offline = true;
    target.drops = (target.drops || 0) + 1;
    target.buffer = 0;
    target.conditions = [];
    emit(run, { t: 'offline', unit: target.id });
    endSustainedBy(run, target.id);
    if (target.kind === 'milo') syncLantern(run);
    bark(run, target.id, 'offline');
    return;
  }
  sortUnit(run, target, 'settled');
}

export function sortUnit(run, target, how) {
  if (target.sorted) return;
  target.sorted = how;
  target.integrity = how === 'settled' ? 0 : target.integrity;
  target.conditions = [];
  emit(run, { t: 'sorted', unit: target.id, how });
  endSustainedBy(run, target.id);
  dirty(run);
}

export function removeUnit(run, id, why) {
  const u = U(run, id);
  if (!u) return;
  run.b.units = run.b.units.filter((v) => v.id !== id);
  run.b.order = run.b.order.filter((v) => v !== id);
  if (run.b.plans) delete run.b.plans[id];
  if (run.b.schedule) run.b.schedule = run.b.schedule.map((e) => e);
  emit(run, { t: 'gone', unit: id, why });
  dirty(run);
}

function endSustainedBy(run, unitId) {
  const mine = (run.b.sustained || []).filter((s) => s.unitId === unitId);
  for (const s of mine) endSustained(run, s);
}

export function endSustained(run, s) {
  run.b.sustained = (run.b.sustained || []).filter((x) => x !== s && !(x.unitId === s.unitId && x.abilityId === s.abilityId));
  const source = `sustained:${s.unitId}:${s.abilityId}`;
  for (const v of run.b.units) {
    if (v.mods?.length) v.mods = v.mods.filter((m) => !(m.until === 'sustained' && m.source === source));
  }
  emit(run, { t: 'line', text: `${U(run, s.unitId)?.name || 'Someone'}’s spell fades.` });
}

function phaseNames(n, rules) {
  return rules.lead?.phaseNames?.[String(n)] || (n === 2 ? ['opening', 'last-page'] : ['opening', 'twist', 'last-page']);
}

export function feintsFor(adapt, rules) {
  return rules.lead?.feints?.[String(adapt)] ?? (adapt >= 4 ? 2 : adapt >= 3 ? 1 : 0);
}

/** A lead's adaptation step now: by the room's n and the mode in play, 0 with the switch off (§4.15). */
export function leadStep(battle, u, rules) {
  return adaptStep({ rank: 'lead', level: u?.level ?? 0, roomLevel: battle.level, roadLevel: battle.roadLevel },
    { mode: effMode(battle), adaptation: battle.calm?.adaptation !== false, rules });
}

function leadBar(run, byId) {
  const lead = run.b.lead;
  const u = U(run, 'lead');
  if (!u) return;
  const names = phaseNames(lead.bars.length, run.rules);
  if (lead.bar + 1 < lead.bars.length) {
    const from = lead.phase;
    lead.bar += 1;
    lead.phase = names[lead.bar];
    u.maxIntegrity = lead.bars[lead.bar];
    u.integrity = lead.bars[lead.bar];
    lead.armourUsed = false;
    lead.feintsLeft = feintsFor(leadStep(run.b, u, run.rules), run.rules);
    emit(run, { t: 'bar', unit: 'lead', bar: lead.bar, integrity: u.integrity, max: u.maxIntegrity });
    emit(run, { t: 'phase', unit: 'lead', phase: lead.phase, quote: u.lead?.quote || '' });
    const mech = mechanicOf(run);
    if (mech?.phaseChange) hook(run, mech.phaseChange, from, lead.phase, run.ctx);
    return;
  }
  u.integrity = 0;
  sortUnit(run, u, 'settled');
}

function bark(run, unitId, on) {
  const b = run.b;
  if (b.units.some((v) => v.usedRound?.['#bark'])) return;
  const who = run.ctx.party?.[unitId];
  const list = (who?.barks || []).filter((x) => x.on === on);
  if (!list.length) return;
  const pickIndex = hashInts(b.seed, b.attempt, b.round, 'bark') % list.length;
  const chosen = list[pickIndex];
  const u = U(run, unitId);
  u.usedRound = u.usedRound || {};
  u.usedRound['#bark'] = 1;
  emit(run, { t: 'bark', unit: unitId, text: who.voice === 'pictures' ? null : chosen.say ?? null, gesture: chosen.does ?? null });
}

/**
 * Lands damage through §4.8's order after the base (step 1): Storybook's ×0.75 for foes' damage,
 * the degree, weakness or resistance, a lead's damageTaken, Tuck and roll, Stand in my light,
 * then Buffer (the target's, or a shoulderer's pool).
 */
export function landHit(run, { userId = null, targetId, amount, kind, degree, reactions = true, source = null }) {
  const target = U(run, targetId);
  if (!target || target.sorted || target.offline) return { dealt: 0, amount: 0 };
  if (degree === 'miss') return { dealt: 0, amount: 0 };
  const user = userId ? U(run, userId) : null;
  const scale = user && user.side !== 'party' && effMode(run.b) === 'storybook' ? run.rules.modes.storybook.damage : 1;
  const r = reactions && user ? hitReactions(run, user, target, degree) : { halve: false, less: 0, bufferFrom: target };
  const { resist, weak } = defencesTo(run.b, run.ctx, target, kind, gridOf(run));
  const mech = target.id === 'lead' ? mechanicOf(run) : null;
  // §18.3: the hit also reports the amount before resistance (`before`) and what resistance took (`resisted`).
  const taken = mech?.damageTaken ? (a, r = {}) => mech.damageTaken(run.b, { target: 'lead', amount: a, before: r.before ?? a, resisted: r.resisted ?? 0, kind, degree, source: source || userId }, run.ctx) : null;
  const pool = r.bufferFrom;
  const steps = damageSteps({ amount, degree, weak, resist, scale, taken, halve: r.halve, less: r.less, buffer: pool.buffer || 0 });
  if (steps.buffered) {
    pool.buffer = steps.bufferLeft;
    emit(run, { t: 'buffer', unit: pool.id, buffer: pool.buffer });
  }
  target.integrity = Math.max(0, target.integrity - steps.dealt);
  emit(run, {
    t: 'damage', unit: userId, target: target.id, amount: steps.amount, kind, degree, weak: steps.weakAdded, resist: steps.resisted,
    buffered: steps.buffered, integrity: target.integrity, max: target.maxIntegrity,
  });
  // An arc's own damage never arcs again (COMBAT §4.3: half that hit's damage to everyone in it, once).
  afterHarm(run, user, target, { kind, amount: steps.amount, dealt: steps.dealt, surfaces: source !== 'arc' });
  return { dealt: steps.dealt, amount: steps.amount };
}

/** What follows any harm landing: calm resets, waking, Beguiled lifting, the ghost's Light mark, surface reactions, going down. */
export function afterHarm(run, user, target, { kind = null, amount = 0, dealt = 0, surfaces = true } = {}) {
  resetCalm(run, target);
  if (amount > 0 && hasCond(target, 'drowsy')) endCondition(run, target, 'drowsy');
  const beg = condOf(target, 'beguiled');
  if (beg && user) {
    const charmer = beg.source ? U(run, beg.source) : null;
    if (charmer && charmer.side === user.side) endCondition(run, target, 'beguiled');
  }
  if (kind === 'light' && target.archetype === 'ghost') addMod(run, target, { stat: 'light-hit', by: 1, until: 'end-of-next-round', source: 'light' });
  if (surfaces && kind && amount > 0) surfaceReact(run, footprint(target), kind, { amount, hitUnit: target.id });
  if (target.integrity <= 0 && !target.offline && !target.sorted) downUnit(run, target, user?.id ?? null);
  else if (!target.sorted && target.temperament === 'shy' && target.side === 'foe' && target.rank !== 'lead') {
    const at = run.rules.temperaments?.shy?.settlesAt ?? 0.5;
    if (target.integrity <= Math.floor(target.maxIntegrity * at)) sortUnit(run, target, 'settled');
  }
}

/** Patches Integrity (never above max, never on an Offline unit). */
export function patchUnit(run, userId, target, amount) {
  if (!target || target.offline || target.sorted) return 0;
  const a = Math.max(0, Math.floor(amount));
  const before = target.integrity;
  target.integrity = Math.min(target.maxIntegrity, target.integrity + a);
  const healed = target.integrity - before;
  emit(run, { t: 'patch', unit: userId, target: target.id, amount: healed, integrity: target.integrity, max: target.maxIntegrity });
  return healed;
}

const DEGREE_SCALE = { crit: 2, hit: 1, graze: 0.5, miss: 0 };
const scaleBy = (amount, degree) => (degree === 'graze' ? Math.floor(amount / 2) : degree === 'crit' ? amount * 2 : degree === 'miss' ? 0 : amount);

/** Reboots an Offline ally at a quarter of max Integrity (at least 1), Rattled 1 until the next Breather. */
export function rebootUnit(run, byId, target, frac = 0.25) {
  if (!target || !target.offline || (target.drops || 0) >= 2) return false;
  target.offline = false;
  target.integrity = Math.max(1, Math.floor(target.maxIntegrity * frac));
  target.rattled = true;
  // Steady hand's cheaper Reboot is for the next one only.
  if (target.mods?.length) target.mods = target.mods.filter((m) => m.stat !== 'reboot-cost');
  emit(run, { t: 'reboot', unit: target.id, by: byId });
  emit(run, { t: 'patch', unit: byId, target: target.id, amount: target.integrity, integrity: target.integrity, max: target.maxIntegrity });
  if (target.kind === 'milo') syncLantern(run);
  dirty(run);
  return true;
}

// ---------- basic actions an ability can take (act) ----------

/** The Strike amount and kind against a target: the weapon (or ranged option), key, flat, Dip, Bead and Unseen strike. */
export function strikeDamage(run, u, target, { ranged = false, edge = 0, swipe = false, dry = false } = {}) {
  let amount = ranged && u.ranged && !(u.strike?.range > 0) ? u.ranged.amount : u.strike?.amount || 0;
  amount += (u.keyAdjust || 0) + (u.flat || 0);
  let kind = u.strike?.kind || 'plain';
  const dip = (u.mods || []).find((m) => m.stat === 'dip');
  if (dip) {
    amount += dip.by;
    kind = dip.source || kind;
  }
  const bead = (target.marks || []).find((m) => m.id === 'bead' && m.by === u.id);
  if (bead) amount += bead.n || 0;
  if (hasRule(run.ctx, u, 'unseen-strike') && (!swipe || hasRule(run.ctx, u, 'swipe-strike')) && !(u.usedRound?.['unseen-strike'] > 0)) {
    const allyBeside = run.b.units.some((v) => standing(v) && v.side === u.side && v.id !== u.id && unitDist(v, target) <= 1);
    if (edge > 0 || allyBeside) {
      amount += line(run.rules, 'one', u.level);
      if (!dry) u.usedRound = { ...(u.usedRound || {}), 'unseen-strike': 1 };
    }
  }
  return { amount, kind };
}

/** How a unit's Strike reaches a target: { ok, ranged, light }. */
export function strikeReach(u, target) {
  const d = unitDist(u, target);
  const range = u.strike?.range || 0;
  if (range === 0 && d <= 1) return { ok: true, ranged: false };
  if (range > 0 && d <= range) return { ok: true, ranged: true };
  if (u.ranged && d <= u.ranged.range && d > 1) return { ok: true, ranged: true };
  if (range > 0 && d <= 1 && !u.ranged) return { ok: true, ranged: true };
  return { ok: false, ranged: false };
}

/** Whether a unit's Strike can land on a target now: in reach and in sight (§4.17: a line through high cover blocks it). */
export function canStrike(grid, u, target) {
  return !!u && !!target && strikeReach(u, target).ok && grid.sees(u, target);
}

/**
 * The pick kind of a unit's Strike on a target (so oddsFor and the Strike agree). `ability`: the
 * Strike is an ability's `act`, and that ability is the attack (§4.3: one attack, counted once at its
 * own rate, never the light weapon's); `counted`: its heat is already on the unit.
 */
export function strikePk(u, target, { reaction = false, cheer = false, attackIndex = null, heat = null, ability = false, counted = false, sure = false, fromHiding = false } = {}) {
  const reach = strikeReach(u, target);
  return {
    harmful: true, meets: 'guard', attack: true, reaction, light: !ability && u.strike?.weapon === 'light', ranged: reach.ranged, cheer,
    attackIndex, heat, counted, sure, fromHiding,
  };
}

/** A Drawn unit spends its next attack on whoever drew it, when it can reach them. */
function redirectDrawn(run, u, targetId) {
  const mark = (u.marks || []).find((m) => m.id === 'drawn');
  if (!mark) return targetId;
  const marker = U(run, mark.by);
  u.marks = u.marks.filter((m) => m !== mark);
  if (marker && standing(marker) && marker.id !== targetId && canStrike(gridOf(run), u, marker)) {
    emit(run, { t: 'line', text: `${u.name} turns to ${marker.name}.` });
    return marker.id;
  }
  return targetId;
}

/**
 * A Strike (or a Parting swipe, with reaction: true). `counted`: { attackIndex } when the Strike is an
 * ability's `act` and the ability already counted the attack; `planned`: { id, odds } read as that
 * ability began, used when the Strike still lands on that target. Returns { degree } or null when it can't reach.
 */
export function doStrike(run, unitId, action, { reaction = false, swipe = false, abilityId = null, counted = null, sure = false, planned = null } = {}) {
  let u = U(run, unitId);
  let targetId = action.target?.unit || action.target?.units?.[0];
  if (action.target?.object) return strikeObject(run, unitId, action.target.object);
  if (!u || !standing(u) || !targetId) return null;
  if (!reaction) targetId = redirectDrawn(run, u, targetId);
  let target = U(run, targetId);
  if (!target || !standing(target)) return null;
  if (!canStrike(gridOf(run), u, target)) return null;
  if (!reaction) {
    const newId = strikeAtAlly(run, u, target);
    u = U(run, unitId);
    target = U(run, newId);
    if (!target || !standing(target) || !u || !standing(u)) return null;
    if (!canStrike(gridOf(run), u, target)) return null;
  }
  const pk = strikePk(u, target, {
    reaction, cheer: !!action.cheer, ability: !!counted, counted: !!counted, attackIndex: counted ? counted.attackIndex : null, fromHiding: !!counted?.fromHiding, sure,
  });
  const odds = planned?.odds && planned.id === target.id ? planned.odds : oddsAgainst(run.b, run.ctx, u.id, target.id, pk, gridOf(run));
  if (!reaction && !counted) {
    const pen = attackPenalty(u.attacks || 0, { light: pk.light });
    if (pen.heat) setHeat(run, u, u.heat + pen.heat);
    u.attacks = (u.attacks || 0) + 1;
  }
  if (hasCond(u, 'unseen')) endCondition(run, u, 'unseen');
  const degree = pickOutcome(run, u.id, target.id, odds);
  u = U(run, unitId);
  target = U(run, target.id);
  if (degree !== 'miss' && target && standing(target)) {
    const { amount, kind } = strikeDamage(run, u, target, { ranged: pk.ranged, edge: odds.edge, swipe });
    landHit(run, { userId: u.id, targetId: target.id, amount, kind, degree, source: abilityId || 'strike' });
    if (abilityId === 'cleave' || hasCleave(run, abilityId)) cleave(run, u, target, amount, kind, degree);
  } else if (target) resetCalm(run, target);
  consumeUntil(run, U(run, unitId), 'next-attack');
  return { degree, targetId: target?.id ?? targetId };
}

const hasCleave = (run, abilityId) => {
  const a = ability(run.ctx, abilityId);
  const spec = a && specFor(a, {});
  return !!spec && (spec.effects || []).some((e) => e.do === 'rule' && e.id === 'cleave');
};

function cleave(run, u, first, amount, kind, degree) {
  const second = run.b.units.find((v) => standing(v) && v.side !== u.side && v.side !== 'neutral' && v.id !== first.id && unitDist(v, first) <= 1 && unitDist(v, u) <= 1);
  if (second) landHit(run, { userId: u.id, targetId: second.id, amount: Math.floor(amount / 2), kind, degree, source: 'cleave' });
}

function strikeObject(run, unitId, objectId) {
  const u = U(run, unitId);
  const o = (run.b.objects || []).find((x) => x.id === objectId);
  if (!u || !o || unitDist(u, o) > Math.max(1, u.strike?.range || 0)) return null;
  const { amount, kind } = strikeDamage(run, u, { marks: [] }, {});
  if (kind === 'light' && (o.flags || []).includes('hazard')) burstHazards(run, [{ x: o.x, y: o.y }]);
  if (typeof o.integrity === 'number') {
    o.integrity = Math.max(0, o.integrity - amount);
    if (o.integrity === 0) {
      o.state = o.kind === 'pop-up-cover' ? 'broken' : o.kind === 'alibi' ? 'broken' : o.state;
      emit(run, { t: 'object', object: o.id, state: o.state });
      dirty(run);
    }
  }
  return { degree: 'hit' };
}

/** Brace: a helpful outcome; Buffer = 3 + level (+2 with a shield), by degree, the larger of old and new. */
export function doBrace(run, unitId, { cheer = false, amount = null } = {}) {
  const u = U(run, unitId);
  if (!u || !standing(u)) return null;
  const odds = oddsAgainst(run.b, run.ctx, u.id, u.id, { helpful: true, cheer }, gridOf(run));
  const degree = pickOutcome(run, u.id, u.id, odds);
  const base = amount ?? run.rules.actions.brace + u.level + (u.shield ? run.rules.actions.shield : 0);
  const got = scaleBy(base, degree === 'miss' ? 'graze' : degree);
  if (got > (u.buffer || 0)) {
    u.buffer = got;
    emit(run, { t: 'buffer', unit: u.id, buffer: got });
  }
  return { degree };
}

/** Hide: needs Dim or Dark, foliage or high cover; a Hit or better against the watchers' best mind Resolve. */
export function canHide(run, u) {
  const g = gridOf(run);
  if (!u) return false;
  if (u.side !== 'party' && inHooklight(run.b, u)) return false;
  const tiles = footprint(u);
  // The Hooklight never spoils the party's own hiding.
  const skip = u.side === 'party' ? 'hooklight' : null;
  if (tiles.some((t) => g.light(t.x, t.y, { skip }) !== 'L')) return true;
  if (tiles.some((t) => g.hides(t.x, t.y))) return true;
  return tiles.some((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.highCover(t.x + dx, t.y + dy)));
}

export function hidePk(run, u) {
  const g = gridOf(run);
  const watchers = run.b.units.filter((v) => standing(v) && v.side !== u.side && v.side !== 'neutral' && v.rank !== 'device' && g.sees(v, u));
  const best = watchers.reduce((m, v) => Math.max(m, resolveOf(run.b, v, 'mind', run.ctx)), 0);
  return { pk: { harmful: false, resolveOverride: best }, watchers };
}

/** start: { odds } read when an ability using it began (null odds: nobody watched then). */
export function doHide(run, unitId, { start = null } = {}) {
  const u = U(run, unitId);
  if (!u || !standing(u) || !canHide(run, u)) return null;
  const { pk, watchers } = hidePk(run, u);
  let degree = 'hit';
  const odds = start ? start.odds : watchers.length ? oddsAgainst(run.b, run.ctx, u.id, null, pk, gridOf(run)) : null;
  if (odds) degree = pickOutcome(run, u.id, null, odds);
  if (degree === 'hit' || degree === 'crit') addCondition(run, u, 'unseen', null, { degree: 'hit' });
  return { degree };
}

/** Seek: reveals hidden intents and Unseen foes within 6 (8 at Heed 3+). */
export function doSeek(run, unitId) {
  const u = U(run, unitId);
  if (!u) return null;
  const range = (u.abilities?.heed ?? 0) >= 3 ? run.rules.actions.seekHeed : run.rules.actions.seek;
  for (const v of run.b.units) {
    if (!standing(v) || v.side === u.side || unitDist(u, v) > range) continue;
    if (hasCond(v, 'unseen')) {
      endCondition(run, v, 'unseen');
      emit(run, { t: 'reveal', unit: v.id, what: 'unseen', text: `${v.name} is found.` });
    }
    if ((v.genres || []).includes('noir') && v.revealedUntil !== 'fight') {
      v.revealedUntil = 'end-of-round';
      emit(run, { t: 'reveal', unit: v.id, what: 'intent', text: `${v.name}’s plans show for the round.` });
    }
  }
  return { degree: 'hit' };
}

/** Stride (or its standing-up when Tumbled). */
export function doStride(run, unitId, action, { noSwipes = false, budget = null } = {}) {
  const u = U(run, unitId);
  if (!u || !standing(u)) return null;
  if (hasCond(u, 'tangled')) return null;
  if (hasCond(u, 'tumbled')) {
    endCondition(run, u, 'tumbled');
    consumeUntil(run, u, 'next-stride');
    return { degree: 'hit', stood: true };
  }
  const g = gridOf(run);
  const ignoreDifficult = hasRule(run.ctx, u, 'ignore-difficult');
  const speed = budget ?? speedOf(run.b, u, run.ctx, { stride: true });
  let tiles = action.target?.path || null;
  if (tiles) {
    const w = g.walk(u.id, tiles, { noSwipes, ignoreDifficult });
    if (!w || w.cost > speed) tiles = null;
  }
  if (!tiles && action.target?.tile) tiles = g.path(u.id, action.target.tile, { noSwipes, ignoreDifficult, budget: speed });
  if (!tiles) return null;
  if (!tiles.length) return { degree: 'hit' };
  moveAlong(run, unitId, tiles, 'stride', { noSwipes });
  consumeUntil(run, U(run, unitId), 'next-stride');
  return { degree: 'hit' };
}

/** A Step is a one-tile walk (§4.4): a king's step with no squeeze between corners and no climb of two, onto a free tile. */
export function canStep(grid, u, tile) {
  return !!u && !!tile && !!grid.walk(u.id, [tile], { noSwipes: true });
}

export function doStep(run, unitId, action) {
  const u = U(run, unitId);
  if (!u || !standing(u) || hasCond(u, 'tangled')) return null;
  const t = action.target?.tile || action.target?.path?.[0];
  if (!canStep(gridOf(run), u, t)) return null;
  moveAlong(run, unitId, [t], 'step', { noSwipes: true });
  return { degree: 'hit' };
}

/** A tile beside a target that a unit can stride to within its speed, nearest first. */
export function approachTile(run, u, target, budget) {
  return gridOf(run).approach(u.id, target.id, { budget });
}

// ---------- abilities ----------

export function targetsOfUse(run, u, a, spec, use) {
  const t = spec.target || { who: 'self' };
  const g = gridOf(run);
  const hits = t.hits || (a.helpful ? 'allies-and-self' : 'foes');
  const fitsHits = (v) => {
    if (!v || v.sorted) return false;
    if (hits === 'all') return true;
    if (hits === 'foes') return v.side !== u.side && v.side !== 'neutral';
    if (hits === 'allies') return v.side === u.side && v.id !== u.id;
    return v.side === u.side;
  };
  const wit = (u.abilities?.wit ?? 0) >= 3 && a.kind === 'spell' && (use.cost || 1) >= 2 ? 1 : 0;
  if (t.area) {
    const tiles = areaTiles(run.b, g, u, t.area, use.target, wit, t.area.at === 'self' || t.who === 'self');
    if (!tiles) return { units: [], tiles: [] };
    let units = g.caught(tiles).map((id) => U(run, id)).filter(fitsHits);
    if (!a.helpful && !(spec.effects || []).some((e) => e.do === 'reboot')) units = units.filter((v) => !v.offline);
    return { units: units.map((v) => v.id), tiles };
  }
  if (t.who === 'self') return { units: [u.id], tiles: [] };
  if (t.who === 'tile') return { units: [], tiles: use.target?.tile ? [use.target.tile] : [] };
  if (t.who === 'object' || t.who === 'none') return { units: [], tiles: use.target?.tile ? [use.target.tile] : [], object: use.target?.object || null };
  const ids = use.target?.units || (use.target?.unit ? [use.target.unit] : []);
  return { units: ids.filter((id) => U(run, id)), tiles: [] };
}

/**
 * An area's tiles for a use (null when it has nowhere to land). A burst or square sits on the user
 * (`self`: `at: 'self'`, or a self-targeted use) or the aimed tile or unit; a line runs from the user
 * toward the aimed tile (`self`), or starts on the aimed tile and runs on away from the user
 * (`at: 'target'`). Wit 3+ widens by `wit`.
 */
export function areaTiles(battle, g, u, area, target, wit = 0, self = area.at === 'self') {
  const size = numOf(area.size, u) + wit;
  let aim = target?.tile || target?.path?.[target.path.length - 1] || null;
  if (!aim && target?.unit) {
    const v = unitIn(battle, target.unit);
    aim = v ? { x: v.x, y: v.y } : null;
  }
  const me = { x: u.x, y: u.y };
  if (area.shape === 'line') {
    if (!aim || (aim.x === me.x && aim.y === me.y)) return null;
    if (self || area.at !== 'target') return g.area('line', size, aim, me);
    const steps = Math.max(Math.abs(aim.x - me.x), Math.abs(aim.y - me.y));
    return g.area('line', steps + size - 1, aim, me).slice(steps - 1);
  }
  if (!self && !aim) return null;
  return g.area(area.shape, size, self ? me : aim, me);
}

function payCosts(run, u, a, use, targetIds) {
  if (a.kind === 'spell' && a.circle > 0) {
    const pact = u.charges?.pool === 'pact';
    const cost = pact ? 1 : a.circle + (use.extra || 0);
    u.charges = { ...u.charges, left: Math.max(0, (u.charges?.left || 0) - cost) };
  }
  if (a.uses) {
    if (a.uses.per === 'target-round') for (const id of targetIds.length ? targetIds : [null]) spendUse(run, u, a, id);
    else spendUse(run, u, a);
  }
  if (a.consumes) takeCarry(run, u, a.consumes);
}

/** Who carries an item: tonics are the party's, on Milo's spec; gifts and essences on the user's own. */
export function carrierOf(run, u, item) {
  const key = item === 'essence' ? 'essences' : item;
  if (item === 'cordial' || item === 'brew') {
    return run.b.units.find((v) => v.side === 'party' && (v.carry?.[key] || 0) > 0 && v.kind === 'milo')
      || run.b.units.find((v) => v.side === 'party' && (v.carry?.[key] || 0) > 0) || null;
  }
  return (u.carry?.[key] || 0) > 0 ? u : null;
}

export function takeCarry(run, u, item) {
  const key = item === 'essence' ? 'essences' : item;
  const c = carrierOf(run, u, item);
  if (!c) return false;
  c.carry = { ...c.carry, [key]: Math.max(0, (c.carry[key] || 0) - 1) };
  return true;
}

/** §4.4: an ability use is an attack when it's marked `attack: true` or its effects make a Strike. */
export const isAttackUse = (a, spec) => !!a?.attack || (spec?.effects || []).some((e) => e.do === 'act' && e.action === 'strike');

/**
 * True when the use opens with a `degree-next-on-foe` mod on its own user (*Being sure* folded into a
 * move, C's "-trick" moves): effects run in order (§6.3), so that mod is on the user by its first pick.
 */
export function leadingSure(spec) {
  for (const e of spec?.effects || []) {
    if (e.do === 'mod' && e.stat === 'degree-next-on-foe' && e.to === 'self' && !e.min && !e.if) return true;
    if (e.do !== 'mod' && e.do !== 'heat' && e.do !== 'reveal') return false;
  }
  return false;
}

/** The pick kind of an ability use on one target (oddsFor and the use agree through this). */
export function pkFor(run, u, a, target, use, extra = {}) {
  const spec = specFor(a, use);
  const harmful = !a.helpful && !!target && target.id !== u.id;
  // §18.2: a choice's own `meets` wins over the ability's (Borrow a rule's Titan stomp meets body).
  const meets = spec?.meets || a.meets || (harmful && a.attack ? 'guard' : null);
  const ranged = !!(a.attack && (spec?.target?.range || 0) > 1);
  const hearthSalve = a.id === 'salve' && hasRule(run.ctx, u, 'hearth-path');
  return {
    harmful, meets, attack: isAttackUse(a, spec), reaction: !!extra.reaction, light: false, ranged, helpful: !!a.helpful, cannotMiss: !!a.cannotMiss,
    cheer: !!use.cheer || hearthSalve, area: !!spec?.target?.area, abilityId: a.id,
    attackIndex: extra.attackIndex ?? null, heat: extra.heat ?? null, counted: !!extra.counted, sure: leadingSure(spec) || !!extra.sure, fromHiding: !!extra.fromHiding,
  };
}

/** Whether an effect reads the outcome (and so makes its target pick one). `on` is who it lands on. */
export function needsDegree(e, u, on, a) {
  if (e.min) return true;
  switch (e.do) {
    case 'damage': case 'patch': case 'condition': case 'buffer': return true;
    case 'move': return (e.how === 'push' || e.how === 'pull' || e.how === 'swap') && !!on && on.side !== u.side && !a.helpful;
    case 'mark': case 'mod': return !!on && on.side !== u.side && !a.helpful;
    case 'rule': return e.id === 'lullaby';
    default: return false;
  }
}

export function lineAmount(run, u, e, target, a, use) {
  const rules = run.rules;
  let base;
  const name = e.line || 'one';
  if (name === 'weapon') return strikeDamage(run, u, target || { marks: [] }, {}).amount + numOf(e.plus ?? 0, u);
  if (name === 'stray') base = strayRow(rules, 'strike', levelOf(run.b, u, rules));
  else if (name === 'fixed') base = numOf(e.amount ?? 0, u);
  else base = line(rules, name, Math.max(1, u.level));
  let amount;
  if (Array.isArray(e.frac)) amount = Math.floor((base * e.frac[0]) / e.frac[1]);
  else if (e.frac !== undefined) amount = Math.floor(base * numOf(e.frac, u));
  else amount = base;
  if (a.upcast && use.extra > 0) amount += use.extra * Math.floor(amount / 4);
  if (e.plus === 'bead') {
    const bead = (target?.marks || []).find((m) => m.id === 'bead' && m.by === u.id);
    amount += bead?.n || 0;
  } else if (e.plus !== undefined) amount += numOf(e.plus, u);
  if (name !== 'fixed') amount += (u.keyAdjust || 0) + (u.flat || 0);
  if (a.id === 'mote' && hasRule(run.ctx, u, 'wick-path')) amount += 2;
  return Math.max(0, amount);
}

const meetsDegree = (degree, min) => !min || (min === 'crit' ? degree === 'crit' : degree === 'hit' || degree === 'crit');

function applyEffect(run, u, a, spec, e, tgt, state, use) {
  const target = tgt ? U(run, tgt) : null;
  const on = e.to === 'self' ? U(run, u.id) : target;
  // Lullaby picks only for the foes its budget reaches, inside the rule.
  const lazy = e.do === 'rule' && e.id === 'lullaby';
  const degree = !lazy && (state.acted || needsDegree(e, u, on, a)) ? state.degree() : 'hit';
  const helpfulOn = !!on && on.side === u.side;
  if (e.if && !predicate(run, e.if, u, on)) return;
  if (!meetsDegree(degree, e.min)) return;
  const harmful = !!on && on.side !== u.side && !a.helpful;
  const landsMove = !harmful || degree === 'hit' || degree === 'crit' || e.min;
  switch (e.do) {
    case 'damage': {
      if (!on) return;
      const kind = e.kind === 'caster' || !e.kind ? casterKind(u, run.rules) : e.kind === 'weapon' ? strikeDamage(run, u, on, {}).kind : e.kind;
      const pieces = Math.max(1, numOf(e.split ?? 1, u));
      const amount = lineAmount(run, u, e, on, a, use);
      for (let i = 0; i < pieces; i += 1) {
        // A piece with nobody left to land on picks nothing.
        const v = U(run, on.id);
        if (!v || v.sorted || v.offline) break;
        const d = i === 0 ? degree : state.pickAgain();
        landHit(run, { userId: u.id, targetId: v.id, amount, kind, degree: d, source: a.id });
      }
      // The area's own tiles react too, except where a hit on a unit already arced through them.
      if (kind && spec.target?.area && state.first) surfaceReact(run, state.tiles, kind, { amount, noArcNear: state.units });
      return;
    }
    case 'patch': {
      if (!on) return;
      let amount;
      if (e.ofMax !== undefined) {
        const frac = run.b.units.some((v) => v.side === u.side && hasRule(run.ctx, v, 'steady-hands') && v.id === u.id) && a.kind === 'item' ? 1 / 3 : numOf(e.ofMax, u);
        amount = Math.floor(on.maxIntegrity * frac);
      } else amount = lineAmount(run, u, e, on, a, use);
      patchUnit(run, u.id, on, scaleBy(amount, degree === 'miss' ? 'graze' : degree));
      return;
    }
    case 'condition': {
      if (!on) return;
      addCondition(run, on, e.id, e.n !== undefined ? numOf(e.n, u) : null, { source: u.id, data: e.data || null, degree, helpful: helpfulOn });
      if (harmful) resetCalm(run, on);
      return;
    }
    case 'end-condition': {
      if (!on) return;
      if (e.id) endCondition(run, on, e.id);
      else endClass(run, on, e.class || 'bane', e.count ?? 1);
      return;
    }
    case 'move': {
      const n = numOf(e.tiles ?? 1, u);
      if (e.how === 'push' || e.how === 'pull') {
        if (!on || !landsMove) return;
        if (e.how === 'push' && (on.size || 1) > (u.size || 1)) return;
        forcedMove(run, u.id, on.id, e.how, degree === 'crit' && !e.min ? n : n);
        if (harmful) resetCalm(run, on);
      } else if (e.how === 'swap') {
        // Two picked units (count 2) trade places once, after both picks, and only when every foe's
        // pick landed; otherwise the user trades with its target.
        const pair = use.target?.units?.length === 2 ? use.target.units : null;
        if (!pair) {
          if (landsMove) swapUnits(run, u, U(run, u.id), on);
          return;
        }
        const s = state.shared.swap || (state.shared.swap = { n: 0, ok: true });
        s.n += 1;
        if (!on || !standing(on) || !landsMove) s.ok = false;
        if (s.n === 2 && s.ok) swapUnits(run, u, U(run, pair[0]), U(run, pair[1]));
      } else if (e.how === 'teleport') {
        const who = e.who === 'target' ? on : U(run, u.id);
        const to = use.target?.tile;
        if (!who || !to || !gridOf(run).canStand(to.x, to.y, who.id) || (e.into === 'dim' && !dimTile(gridOf(run), who, to))) return;
        moveAlong(run, who.id, [to], 'teleport', { by: u.id, noSwipes: true });
      } else {
        const who = e.who === 'target' ? on : U(run, u.id);
        if (!who) return;
        const noSwipes = !!e.noSwipes || e.how === 'step';
        const aimed = use.target?.path || use.target?.tile;
        const path = (use.target?.path || (use.target?.tile ? gridOf(run).path(who.id, use.target.tile, { noSwipes, budget: n }) : null) || []).slice(0, n);
        // `into: 'dim'` ends on a tile that isn't Lit: the one aimed at, or with none aimed at, the nearest within reach.
        const steps = e.into === 'dim' && !aimed ? dimPath(gridOf(run), who, n, noSwipes) : path;
        if (e.into === 'dim' && steps.length && !dimTile(gridOf(run), who, steps[steps.length - 1])) return;
        if (steps.length) moveAlong(run, who.id, steps, e.how === 'step' ? 'step' : 'stride', { by: u.id, noSwipes });
      }
      return;
    }
    case 'act': {
      state.acted = true;
      const res = actBasic(run, u.id, e, tgt, use, state);
      if (res && res.degree) state.actDegree = res.degree;
      return;
    }
    case 'heat': {
      const who = on || U(run, u.id);
      if (e.idle === true) setHeat(run, who, idleHeatOf(run.b, who, run.rules));
      else setHeat(run, who, who.heat + numOf(e.by ?? 0, u));
      return;
    }
    case 'buffer': {
      const who = on || U(run, u.id);
      const base = e.amount === 'brace' ? run.rules.actions.brace + who.level + (who.shield ? run.rules.actions.shield : 0) : numOf(e.amount ?? 0, u);
      const got = scaleBy(base, degree === 'miss' ? 'graze' : degree);
      if (got > (who.buffer || 0)) {
        who.buffer = got;
        emit(run, { t: 'buffer', unit: who.id, buffer: got });
      }
      return;
    }
    case 'mark': {
      if (!on || (harmful && !(degree === 'hit' || degree === 'crit') && a.outcome !== false)) return;
      addMark(run, on, { id: e.id, by: u.id, n: numOf(e.n ?? e.edge ?? 1, u), until: e.until || (e.id === 'bead' ? 'fight' : e.id === 'drawn' ? (e.spend === 'attack' ? 'next-attack' : 'next-action') : 'end-of-next-round') });
      if (e.id === 'bead' || e.id === 'wanted') addCondition(run, on, 'singled-out', null, { source: u.id, degree: 'hit' });
      if (harmful) resetCalm(run, on);
      return;
    }
    case 'mod': {
      const who = on || U(run, u.id);
      if (harmful && !(degree === 'hit' || degree === 'crit') && a.outcome !== false) return;
      let by = numOf(e.by ?? 0, u);
      if (!harmful && degree === 'graze' && Math.abs(by) >= 2 && !String(e.stat).startsWith('edge')) by = Math.trunc(by / 2);
      const until = e.until || 'end-of-round';
      const source = a.sustained ? `sustained:${u.id}:${a.id}` : a.id;
      addMod(run, who, { stat: e.stat, by, until, source });
      return;
    }
    case 'degree': return;
    case 'reveal': {
      const radius = numOf(e.radius ?? 0, u);
      const list = radius > 0 ? run.b.units.filter((v) => v.side !== u.side && unitDist(v, on || u) <= radius) : on ? [on] : [];
      for (const v of list) revealUnit(run, v, e.what, u);
      return;
    }
    case 'surface': {
      const tiles = e.area ? gridOf(run).area(e.area.shape, numOf(e.area.size, u), use.target?.tile || { x: on?.x ?? u.x, y: on?.y ?? u.y }, u) : state.tiles.length ? state.tiles : use.target?.tile ? [use.target.tile] : on ? footprint(on) : [];
      if (!state.first) return;
      for (const t of tiles) setSurface(run, t.x, t.y, e.id, e.rounds ?? null);
      emit(run, { t: 'surface', tiles, id: e.id, rounds: e.rounds ?? null, on: true });
      return;
    }
    case 'summon': {
      if (!state.first) return;
      summonDevice(run, u.id, e.template, use.target?.tile || null, e.rounds ?? null);
      return;
    }
    case 'command': {
      if (!state.first) return;
      commandDevice(run, u.id, e.device, e.order, use, a);
      return;
    }
    case 'reboot': {
      if (!on) return;
      rebootUnit(run, u.id, on, numOf(e.frac ?? 0.25, u));
      return;
    }
    case 'calm': {
      if (!on?.talkKind) return;
      addCalm(run, u, on.talkKind, numOf(e.n ?? 1, u));
      return;
    }
    case 'light': {
      if (!state.first) return;
      const at = use.target?.tile || (on ? { x: on.x, y: on.y } : { x: u.x, y: u.y });
      const lights = run.b.lights || [];
      if (lights.length >= (run.rules.lights?.max ?? 24)) return;
      const id = nextId(lights.map((l) => l.id), 'l');
      lights.push({ id, x: at.x, y: at.y, radius: numOf(e.radius ?? 2, u), rounds: e.rounds ?? null, source: a.id });
      run.b.lights = lights;
      dirty(run);
      emit(run, { t: 'light', lights: copy(run.b.lights) });
      revealLit(run, lights[lights.length - 1], u.side);
      return;
    }
    case 'take': {
      // §18.2: a pinch is a `take` event (`kind: 'take'` too, as §18.2 writes it); with `settle: true`
      // the taker is sorted at once, since it pinches and runs home. Nothing to take: no event, no settling.
      if (!state.first) return;
      const c = run.b.units.find((v) => v.side !== u.side && v.side !== 'neutral' && (v.carry?.[e.item] || 0) > 0);
      if (!c) return;
      c.carry = { ...c.carry, [e.item]: c.carry[e.item] - 1 };
      emit(run, { t: 'take', kind: 'take', unit: u.id, from: c.id, item: e.item });
      const me = U(run, u.id);
      if (e.settle === true && me && standing(me)) sortUnit(run, me, 'settled');
      return;
    }
    case 'cancel': return;
    case 'rule': {
      applyRule(run, u, a, e, on, state, use);
      return;
    }
    default:
  }
}

/** The cheapest path within `budget` to the nearest tile that isn't Lit for the mover ([] when it stands on one, or none is near). */
function dimPath(grid, who, budget, noSwipes) {
  if (dimTile(grid, who, who)) return [];
  let best = null;
  for (const [key, r] of grid.reachable(who.id, { budget, noSwipes })) {
    const [x, y] = key.split(',').map(Number);
    if (!dimTile(grid, who, { x, y })) continue;
    if (!best || r.cost < best.cost || (r.cost === best.cost && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, cost: r.cost };
  }
  return best ? grid.path(who.id, best, { budget, noSwipes }) || [] : [];
}

/** Two standing units trade places, when each can stand where the other stood (a Large one may not fit). */
function swapUnits(run, by, p, q) {
  if (!p || !q || p.id === q.id || !standing(p) || !standing(q)) return false;
  const pt = { x: p.x, y: p.y };
  const qt = { x: q.x, y: q.y };
  const snap = allFoeDistances(run.b);
  [p.x, p.y, q.x, q.y] = [qt.x, qt.y, pt.x, pt.y];
  dirty(run);
  if (!gridOf(run).canStand(p.x, p.y, p.id) || !gridOf(run).canStand(q.x, q.y, q.id)) {
    [p.x, p.y, q.x, q.y] = [pt.x, pt.y, qt.x, qt.y];
    dirty(run);
    return false;
  }
  emit(run, { t: 'move', unit: p.id, by: by.id, path: [qt], how: 'swap' });
  emit(run, { t: 'move', unit: q.id, by: by.id, path: [pt], how: 'swap' });
  if (anyCameCloser(run, snap)) stirRound(run);
  syncLantern(run);
  return true;
}

function revealUnit(run, v, what, by) {
  if (what === 'unseen' && hasCond(v, 'unseen')) {
    endCondition(run, v, 'unseen');
    emit(run, { t: 'reveal', unit: v.id, what: 'unseen', text: `${v.name} is found.` });
  } else if (what === 'intents') {
    v.revealedUntil = v.revealedUntil === 'fight' ? 'fight' : 'end-of-round';
    emit(run, { t: 'reveal', unit: v.id, what: 'intent', text: `${v.name}’s plans show.` });
  } else if (what === 'stats') {
    v.examined = true;
    v.revealedUntil = 'fight';
    emit(run, { t: 'reveal', unit: v.id, what: 'stats', text: `${v.name} is examined.` });
  } else if (what === 'mechanic') {
    emit(run, { t: 'reveal', unit: v.id, what: 'mechanic', text: `${v.name}’s next trick shows.` });
  }
}

/** Adds calm to a kind; enough settles every stray of it (talked down, full rewards). */
export function addCalm(run, u, kind, n = 1) {
  const t = run.b.talk?.[kind];
  if (!t || t.done) return false;
  t.calm += n;
  emit(run, { t: 'calm', kind, calm: Math.min(t.calm, t.need), need: t.need });
  if (t.calm >= t.need) {
    t.done = true;
    for (const v of run.b.units) if (v.talkKind === kind && !v.sorted) sortUnit(run, v, 'talked');
    if (run.b.units.some((v) => v.side === 'party' && !v.offline && (v.abilities?.charm ?? 0) >= (run.rules.talk?.charm ?? 3))) {
      const max = run.rules.cheers?.max ?? 4;
      if (run.b.cheers < max) {
        run.b.cheers += 1;
        emit(run, { t: 'cheer', cheers: run.b.cheers });
      }
    }
  }
  return true;
}

function applyRule(run, u, a, e, on, state, use) {
  switch (e.id) {
    case 'raise-lantern': {
      const l = (run.b.lights || []).find((x) => x.id === 'hooklight');
      const milo = run.b.units.find((v) => v.kind === 'milo');
      if (l && milo && standing(milo) && !hasCond(milo, 'tumbled') && !hasCond(milo, 'drowsy')) {
        l.radius = run.rules.sight.lanternRaised + modSum(run.b, milo, 'light-radius', run.ctx);
        l.x = milo.x;
        l.y = milo.y;
        dirty(run);
        emit(run, { t: 'light', lights: copy(run.b.lights) });
      }
      return;
    }
    case 'lantern-calls': {
      if (!state.first) return;
      for (const v of run.b.units) if (v.side === u.side && v.offline && unitDist(u, v) <= 6) rebootUnit(run, u.id, v, 0.25);
      return;
    }
    case 'settle-low': {
      if (on && on.side !== u.side && (on.rank === 'stray' || on.rank === 'lackey') && levelOf(run.b, on, run.rules) <= run.b.roadLevel - 4) sortUnit(run, on, 'settled');
      return;
    }
    case 'lullaby': {
      // Drowsy 2 on a Hit or better, lowest Integrity first, while the Drowsy foes' Integrity stays
      // within twice the user's `two` line; only foes it puts to sleep count toward that (§6.5).
      if (!on || on.side === u.side) return;
      const budget = 2 * line(run.rules, 'two', u.level);
      const used = state.shared.lullaby || 0;
      if (used + on.integrity > budget) return;
      const d = state.degree();
      if (d !== 'hit' && d !== 'crit') return;
      if (addCondition(run, on, 'drowsy', 2, { source: u.id, degree: d })) state.shared.lullaby = used + on.integrity;
      return;
    }
    case 'first-in-tick': addMod(run, u, { stat: 'first-in-tick', by: 1, until: 'end-of-next-round', source: a.id }); return;
    case 'burn-essence': {
      if (!state.first) return;
      if (takeCarry(run, u, 'essence')) {
        u.charges = { ...u.charges, left: Math.min(u.charges.max, (u.charges.left || 0) + 1) };
        emit(run, { t: 'line', text: `${u.name} burns an essence for a charge.` });
      }
      return;
    }
    case 'cleave': return;
    default:
  }
}

function actBasic(run, userId, e, tgt, use, state = {}) {
  const u = U(run, userId);
  if (!u) return null;
  switch (e.action) {
    case 'strike': {
      const planned = state.strikeOdds && tgt ? { id: tgt, odds: state.strikeOdds(tgt) } : null;
      const opts = { abilityId: use.abilityId || null, reaction: !!state.reaction, counted: state.counted || null, sure: !!state.sure, planned };
      return doStrike(run, userId, { id: 'strike', target: { unit: tgt }, cheer: !!use.cheer }, opts);
    }
    case 'stride': {
      if (use.target?.path || use.target?.tile) return doStride(run, userId, { target: use.target }, { noSwipes: !!e.noSwipes });
      const target = tgt ? U(run, tgt) : null;
      if (!target) return null;
      if (unitDist(u, target) <= 1 && gridOf(run).sees(u, target)) return { degree: null };
      const path = approachTile(run, u, target, speedOf(run.b, u, run.ctx, { stride: true }));
      return path ? doStride(run, userId, { target: { path } }, { noSwipes: !!e.noSwipes }) : null;
    }
    case 'step': return use.target?.tile ? doStep(run, userId, { target: use.target }) : null;
    case 'hide': return doHide(run, userId, { start: state.hideOdds ? state.hideOdds() : null });
    case 'brace': return doBrace(run, userId, { cheer: !!use.cheer });
    case 'seek': return doSeek(run, userId);
    default: return null;
  }
}

// ---------- using an ability ----------

/**
 * Uses an ability inside a run: pays its costs, finds its targets, picks outcomes (one per target,
 * or per piece of a split), and runs its effects in order on each target (an `act` hands the
 * following effects its own degree). opts.reaction: fired as a reaction (no heat, no penalty).
 */
export function applySpec(run, userId, a, spec, use, opts = {}) {
  const u = U(run, userId);
  if (!u) return null;
  const found = targetsOfUse(run, u, a, spec, use);
  let ids = found.units;
  if ((spec.effects || []).some((e) => e.do === 'rule' && e.id === 'lullaby')) {
    ids = [...ids].sort((p, q) => (U(run, p)?.integrity ?? 0) - (U(run, q)?.integrity ?? 0));
  }
  // The use is one attack (§4.3), counted once before anything picks, whatever its targets, pieces
  // and `act` Strikes; a reaction never counts. Every pick reads the Battle as it stood when the use
  // began (§5.7's row), with this attack's index and its heat already on the user.
  let counted = null;
  if (isAttackUse(a, spec) && !opts.reaction) {
    // Its first attack from hiding keeps the +1 for all its picks, though the attack gives it away.
    counted = { attackIndex: u.attacks || 0, fromHiding: hasCond(u, 'unseen') };
    const pen = attackPenalty(u.attacks || 0, { light: false });
    if (pen.heat) setHeat(run, u, u.heat + pen.heat);
    u.attacks = (u.attacks || 0) + 1;
    if (hasCond(u, 'unseen')) endCondition(run, u, 'unseen');
  }
  // Being sure (and plot armour, and Being sure's worse degree on a target) holds for the whole use,
  // which is one effect: every pick of it on a target uses that target's one set of odds (§5.7's row).
  const sure = leadingSure(spec) || (u.mods || []).some((m) => m.stat === 'degree-next-on-foe');
  const pkOpts = { ...opts, attackIndex: counted ? counted.attackIndex : null, counted: !!counted, fromHiding: !!counted?.fromHiding, sure };
  const effects = spec.effects || [];
  // Every target's odds come from the Battle as the use begins, as oddsFor shows them: an earlier
  // target sorted, moved or lit mid-use never changes a later target's row (its cover, say).
  const start = a.outcome === false && !effects.some((e) => e.do === 'act') ? null : { b: cloneBattle(run.b), ctx: run.ctx, rules: run.rules, events: [], g: null };
  const atStart = (tgt, pkOf) => {
    const v = start && unitIn(start.b, tgt);
    const me = start && unitIn(start.b, u.id);
    return v && me ? oddsAgainst(start.b, run.ctx, me.id, tgt, pkOf(me, v), gridOf(start)) : null;
  };
  const oddsNow = (tgt) => atStart(tgt, (me, v) => pkFor(run, me, a, v, use, pkOpts));
  const strikeOdds = (tgt) => atStart(tgt, (me, v) => strikePk(me, v, {
    cheer: !!use.cheer, reaction: !!opts.reaction, ability: true, counted: !!counted, attackIndex: counted ? counted.attackIndex : null, fromHiding: !!counted?.fromHiding, sure,
  }));
  const hideOdds = () => {
    const me = start && unitIn(start.b, u.id);
    if (!me) return null;
    const { pk, watchers } = hidePk(start, me);
    return { odds: watchers.length ? oddsAgainst(start.b, run.ctx, me.id, null, pk, gridOf(start)) : null };
  };
  const shared = {};
  const runFor = (tgt, index) => {
    let picked = null;
    let odds = null;
    const pickNow = () => {
      if (a.outcome === false || !tgt) return 'hit';
      odds = odds || oddsNow(tgt);
      return odds ? pickOutcome(run, u.id, tgt, odds) : 'hit';
    };
    const state = {
      first: index === 0,
      tiles: found.tiles,
      units: ids,
      acted: false,
      actDegree: null,
      reaction: !!opts.reaction,
      counted,
      sure,
      shared,
      strikeOdds,
      hideOdds,
      degree: () => {
        if (state.acted) return state.actDegree || 'hit';
        if (!picked) picked = pickNow();
        return picked;
      },
      pickAgain: pickNow,
    };
    for (const e of effects) applyEffect(run, U(run, u.id) || u, a, spec, e, tgt, state, use);
    if (Array.isArray(a.crit) && a.crit.length && (picked === 'crit' || state.actDegree === 'crit')) {
      for (const e of a.crit) applyEffect(run, U(run, u.id) || u, a, spec, e, tgt, state, use);
    }
  };
  if (!ids.length) runFor(null, 0);
  else ids.forEach((id, i) => runFor(id, i));
  // A use's own leading Being sure is for its own picks only, even when it caught nobody.
  const me = U(run, u.id);
  if (leadingSure(spec) && me?.mods?.length) me.mods = me.mods.filter((m) => !(m.stat === 'degree-next-on-foe' && m.source === a.id));
  return { targets: ids };
}

/** A whole ability use inside a run (costs, sustained, effects). */
export function useAbility(run, userId, a, use, opts = {}) {
  const u = U(run, userId);
  if (!u || !a) return null;
  const spec = specFor(a, use);
  if (!spec) return null;
  const found = targetsOfUse(run, u, a, spec, use);
  if (!opts.sustain) payCosts(run, u, a, use, found.units);
  // Pact charges always cast at the highest circle (§4.12): a pact spell is upcast to it for free.
  if (u.charges?.pool === 'pact' && a.kind === 'spell' && a.circle > 0 && a.upcast) use = { ...use, extra: Math.max(0, (u.charges.circle || 0) - a.circle) };
  if (a.sustained && !opts.sustain) {
    const mine = (run.b.sustained || []).filter((s) => s.unitId === u.id);
    const cap = hasRule(run.ctx, u, 'two-sustained') ? 2 : 1;
    while (mine.length >= cap) endSustained(run, mine.shift());
    if ((run.b.sustained || []).length < 8) {
      run.b.sustained = [...(run.b.sustained || []), { unitId: u.id, abilityId: a.id, rounds: a.sustained.max ?? 10, target: copy(use.target ?? null), cost: use.cost || 1 }];
    }
    u.usedRound = { ...(u.usedRound || {}), [`#sus:${a.id}`]: 1 };
  }
  return applySpec(run, userId, a, spec, { ...use, abilityId: a.id }, opts);
}

/** §7.1: applies an ability use to a Battle, returning a new one and its events. */
export function applyUse(battle, unitId, a, use, ctx) {
  const run = makeRun(battle, ctx);
  try {
    useAbility(run, unitId, a, { cost: 1, target: null, choice: null, extra: 0, cheer: false, ...use });
  } catch (err) {
    if (err instanceof AskSignal) return { battle, events: [], ask: err.ask };
    throw err;
  }
  return { battle: deepFreeze(run.b), events: run.events };
}
