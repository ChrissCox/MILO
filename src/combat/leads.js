// Tale-leads and canon foes in play (CONTRACT-PHASE4.md §4.9, §4.15, §6.6, §7.4, §9.7–§9.8, §17.20;
// COMBAT.md §8.3, §8.5). B's battle runs every round through a Mechanic's hooks; this module supplies
// them: the generic fallback (its Asides and *The last page*), the eight shipped mechanics built on the
// fallback's hooks, each with its bow, and the canon foes' bows (FOE_BOWS). B owns what every lead
// shares (bars, phases, plot armour, feints, a real rift's yield, ending on a bow).
//
// Pure. Hooks take a Battle and never change it: each works on its own copy through the kernel's
// run (makeRun) and hands back { battle, events }. Variety comes from hashInts(seed, attempt, round, tag).
//
// Decided here, where COMBAT §8.3 gives no number (content/combat/leads.json's `rule` text records them):
// - Asides: 1 a round at the end of tick 2, 2 at the ends of ticks 1 and 3, 3 at the ends of ticks 1–3,
//   counted at each round's start from the mode and the phase; lost while the lead is asleep or surprised,
//   and to Dazed as a planned action is (one off Dazed each, at most 2 a turn with its own actions). A
//   Strike Aside is half the Strike (rounded down, at least 1) and no attack of its turn.
//   From the Twist, a mechanic that can push takes its first Aside of the round as that push (junctions,
//   lamps, candles, clues and plan tiles); assembly lines make clerks every round instead, and too big to
//   see grows back each phase. The noon duel is the Last page's.
// - Effects at a tick's end can't Ask (B clears stored answers before ticks end), so an Ask they raise
//   counts as Never, or as Always for a hero whose round is on auto (as in *Tell me how it went*).
// - B takes any 'mech:' use as planned, so each resolve here checks what its option shows (cost, reach, sight).
import { hashInts, unit as unit01 } from '../world/rng.js';
import { createGrid, footprint, unitDist } from './grid.js';
import { strayRow } from './rules.js';
import { unitIn, standing, hasCond, condOf, asleep, effMode, speedOf, oddsAgainst, strikeAtAlly, defencesTo } from './round.js';
import {
  makeRun, emit, gridOf, dirty, U, adopt, addCondition, endCondition, pickOutcome, landHit, downUnit, addCalm, addMod, strikeDamage,
  strikePk, strikeReach, canStrike, revealLit, doStride, sortUnit, REACTION_IDS,
} from './effects.js';
import { spawnFoe, resolveBasic, TERMINAL } from './battle.js';
import { nameOf, nameIn, tileName } from './describe.js';
import { defencesFor } from './bestiary.js';

// ---------- the numbers leads.js decides (§7.4: leads.json's rule text records them) ----------

export const LEAD_NUMBERS = Object.freeze({
  // Telegraph slots clear of a plan's 0–3: an Aside at tick t is slot 3 + t, the duel 7, the stomp 8.
  slots: Object.freeze({ aside: 3, duel: 7, stomp: 8 }),
  asideTicks: Object.freeze({ 0: Object.freeze([]), 1: Object.freeze([2]), 2: Object.freeze([1, 3]), 3: Object.freeze([1, 2, 3]) }),
  throttle: Object.freeze({ slowed: 1, dazed: 2 }),
  lampsPerRound: 1,
  candlesPerRound: 2,
  candlesToLoseResistance: 4,
  clerkEvery: 2,                // rounds, in the Opening; every round from the Twist
  clerksPerLine: 1,             // standing at once
  leverShare: 0.15,             // of the current bar
  stepsToBow: 3,
  stepsPerRound: 1,
  stompShare: 0.6,
  stompTick: 3,
  duelTick: 1,
  duelEdge: 1,
});

/** Each shipped mechanic's riftgen text, equal to leads.json's `text` (B's Wit-3 Examine reads it). */
const TEXT = Object.freeze({
  'throttles-speed': 'throttles everyone’s speed until you reroute the power',
  'streetlights-out': 'turns off the streetlights one by one',
  'snuffs-candles': 'snuffs the candles; relight them to see',
  'assembly-lines': 'adds a new assembly line every few turns; shut them down',
  'too-big-to-see': 'is too big to see; name its first small step to shrink it',
  alibis: 'hides behind alibis; present evidence to break them',
  'noon-duel': 'duels at noon: time your strike',
  stomps: 'stomps the shore; stand on the crew’s plan',
});

/** leads.json's objects for a mechanic ([] for the fallback and anything that places none). */
export function objectsFor(mechanicId, leads) {
  const entry = (leads?.mechanics || []).find((m) => m.id === mechanicId);
  if (!entry || mechanicId === 'fallback') return [];
  return (entry.objects || []).map((o) => ({ kind: o.kind, count: o.count, where: o.where }));
}

// ---------- small reads ----------

const heroesOf = (b) => b.units.filter((u) => u.side === 'party' && u.rank === 'hero');
const standingHeroes = (b) => heroesOf(b).filter(standing);
const objectsOf = (b, kind) => (b.objects || []).filter((o) => o.kind === kind);
const at = (b, id) => (b.objects || []).find((o) => o.id === id) || null;
const beside = (u, o) => !!u && !!o && unitDist(u, o) <= 1;
const phaseAt = (b) => b.lead?.bar ?? 0;
const pastOpening = (b) => phaseAt(b) >= 1;
const dataOf = (b) => b.lead?.data || {};
const surprised = (u) => (u?.mods || []).some((m) => m.stat === 'surprised');
const awake = (u) => standing(u) && !asleep(u) && !surprised(u);

/**
 * Dazed takes an Aside or the duel as B's kernel takes a planned action (COMBAT §7, battle.js resolveEntry):
 * only while the lead has lost fewer than rules.lead.dazedMax this turn, and each one lost drops Dazed by 1.
 * Every count-down has its event (§18.3 item 2): `condition … on: true` with the new n, or `on: false` at 0.
 */
function dazedTakes(run, u) {
  const dazed = condOf(u, 'dazed');
  if (!dazed || !(dazed.n > 0)) return false;
  const lost = u.usedRound?.['#dazed'] || 0;
  if (lost >= (u.rank === 'lead' ? run.rules?.lead?.dazedMax ?? 2 : Infinity)) return false;
  u.usedRound = { ...(u.usedRound || {}), '#dazed': lost + 1 };
  if (dazed.n <= 1) endCondition(run, u, 'dazed');
  else {
    dazed.n -= 1;
    emit(run, { t: 'condition', target: u.id, id: 'dazed', n: dazed.n, on: true });
  }
  return true;
}
const ended = (b) => TERMINAL.has(b.status);
const USE = (ability, cost, target = null) => ({ id: 'use', ability, cost, target, extra: 0, choice: null, cheer: false, trigger: null });
const option = (act, words, targets, why = null) => ({ action: act, words, cost: act.cost, targets, why });
const key = (t) => `${t.x},${t.y}`;
const seeded = (b, tag, n, i = 0) => (n > 0 ? hashInts(b.seed >>> 0, b.attempt, b.round, i, tag) % n : 0);

/** How many Asides the lead takes this round (§4.9, §4.15): by the mode in play and its phase. */
export function asidesFor(battle, rules) {
  if (!battle?.lead) return 0;
  const row = rules?.lead?.asides?.[effMode(battle)] || [1, 1, 1];
  const n = row[Math.min(row.length - 1, phaseAt(battle))];
  return Math.max(0, Math.min(3, Number.isInteger(n) ? n : 1));
}

/** The Last page applies (§4.9): not at Maud's Table (the first lead plays as Storybook). */
export function lastPageOn(battle, rules) {
  return rules?.modes?.[effMode(battle)]?.lastPage !== false;
}

// ---------- a run of our own ----------

/** A readied action fired while one of our hooks moves someone: checked plainly, as a use would be. */
function validLite(run, u, a) {
  if (!u || !standing(u) || !a) return 'offline';
  const t = a.target?.unit ? U(run, a.target.unit) : null;
  if (a.id === 'strike') return t && standing(t) && canStrike(gridOf(run), u, t) ? null : 'out-of-reach';
  if (a.id === 'shove') return t && standing(t) && unitDist(u, t) <= 1 ? null : 'out-of-reach';
  if (a.id === 'throw') return t && standing(t) && gridOf(run).sees(u, t) ? null : 'out-of-reach';
  if (a.id === 'use') return String(a.ability || '').startsWith('mech:') || (u.abilityIds || []).includes(a.ability) ? null : 'cant';
  return null;
}

function open(battle, ctx) {
  const run = makeRun(battle, ctx);
  run.basic = resolveBasic;
  run.valid = validLite;
  return run;
}
const close = (run) => ({ battle: run.b, events: run.events });

/**
 * B clears stored answers before a tick ends, so a reaction set to Ask can't be asked about for a pick
 * made at a tick's end. It sits the pick out, as Never, so nothing an Ask guards (Proofread's uses) is
 * spent without a yes; a hero whose round is on auto answers as Always, as in Tell me how it went.
 * Returns the undo.
 */
function answerAsks(run) {
  const set = [];
  for (const u of run.b.units) {
    if (u.side !== 'party') continue;
    const yes = run.b.plans?.[u.id]?.by === 'auto' ? 1 : 0;
    for (const id of REACTION_IDS) {
      const k = `#ask:${id}`;
      if (u.usedRound && k in u.usedRound) continue;
      u.usedRound = { ...(u.usedRound || {}), [k]: yes };
      set.push([u.id, k]);
    }
  }
  return () => {
    for (const [id, k] of set) {
      const u = U(run, id);
      if (u?.usedRound && k in u.usedRound) {
        const { [k]: _, ...rest } = u.usedRound;
        u.usedRound = rest;
      }
    }
  };
}

function line(run, text) {
  emit(run, { t: 'line', text: text.length > 100 ? `${text.slice(0, 99)}…` : text });
}

const setData = (run, patch) => {
  run.b.lead.data = { ...(run.b.lead.data || {}), ...patch };
};

/**
 * What each mechanic and bow action costs. B's kernel takes any 'mech:' use as planned (its cost and its
 * target unchecked), so a resolve here is the only gate: one planned at another cost does nothing.
 */
const MECH_COST = Object.freeze({
  'mech:pull-the-lever': 2, 'mech:name-a-step': 2, 'mech:holster': 1,
  'mech:read-aloud': 2, 'mech:answer-the-riddle': 2, 'mech:light-the-forge': 1, 'mech:ring-the-bell': 1,
});
function wrongCost(run, action) {
  const need = MECH_COST[action?.ability];
  if (action?.id !== 'use' || !need || action.cost === need) return false;
  line(run, `That takes ${need === 1 ? '1 action' : `${need} actions`}.`);
  return true;
}

// ---------- lights: lamps and candles ----------

function setLit(run, o, lit, bySide = null) {
  const b = run.b;
  const state = lit ? 'lit' : 'dark';
  if (o.state === state) return false;
  o.state = state;
  emit(run, { t: 'object', object: o.id, state });
  b.lights = (b.lights || []).filter((l) => l.id !== o.id);
  let light = null;
  if (lit && b.lights.length < (run.rules.lights?.max ?? 24)) {
    light = { id: o.id, x: o.x, y: o.y, radius: run.rules.lights?.[o.kind] ?? 1, rounds: null, source: o.kind };
    b.lights.push(light);
  }
  dirty(run);
  emit(run, { t: 'light', lights: b.lights.map((l) => ({ ...l })) });
  if (light && bySide) revealLit(run, light, bySide);
  return true;
}

/** Turns `n` seeded lit objects of a kind dark (a lamp going out, candles snuffed). */
function darken(run, kind, n, tag, words) {
  for (let i = 0; i < n; i += 1) {
    const lit = objectsOf(run.b, kind).filter((o) => o.state === 'lit');
    if (!lit.length) return;
    const o = lit[seeded(run.b, tag, lit.length, i)];
    setLit(run, o, false);
    line(run, `${nameOf(run.b, 'lead')} ${words} at ${tileName(run.b, o)}.`);
  }
}

// ---------- Asides (§4.9) ----------

/** The Aside target: a hero it can strike (seeded among them), else the nearest hero to stride toward. */
function aimAside(b, ctx, lead, i) {
  const heroes = standingHeroes(b);
  if (!heroes.length) return null;
  const seen = heroes.filter((h) => !hasCond(h, 'unseen'));
  const pool = seen.length ? seen : heroes;
  const g = createGrid(b, ctx.rules);
  const strikable = pool.filter((h) => canStrike(g, lead, h));
  if (strikable.length) return ['strike', strikable[seeded(b, 'aside', strikable.length, i)].id];
  const near = [...pool].sort((p, q) => unitDist(lead, p) - unitDist(lead, q) || b.order.indexOf(p.id) - b.order.indexOf(q.id))[0];
  return ['stride', near.id];
}

/** Plans this round's Asides into lead.data.a: [[tick, 'strike' | 'stride' | 'push', target id]]. */
function planAsides(run, parts) {
  const b = run.b;
  const lead = U(run, 'lead');
  const list = [];
  if (b.lead && lead && standing(lead)) {
    const n = parts.asides ? parts.asides(b, run.rules) : asidesFor(b, run.rules);
    const ticks = LEAD_NUMBERS.asideTicks[Math.min(3, n)] || [];
    ticks.forEach((tick, i) => {
      let entry = null;
      if (i === 0 && parts.push && pastOpening(b)) {
        const o = parts.push(b, run.ctx);
        if (o) entry = [tick, 'push', o];
      }
      if (!entry) {
        const aim = aimAside(b, run.ctx, lead, i);
        if (aim) entry = [tick, ...aim];
      }
      if (entry) list.push(entry);
    });
  }
  if (b.lead) {
    setData(run, { a: list });
    b.lead.asides = list.length;
  }
}

function truncate(g, unitId, path, budget) {
  if (!path) return null;
  for (let n = path.length; n > 0; n -= 1) {
    const prefix = path.slice(0, n);
    const w = g.walk(unitId, prefix);
    if (w && w.cost <= budget) return prefix;
  }
  return [];
}

function asideStride(run, targetId) {
  const lead = U(run, 'lead');
  const target = U(run, targetId);
  if (!lead || !target) return;
  const budget = Math.max(1, Math.floor(speedOf(run.b, lead, run.ctx, { stride: true }) / 2));
  const g = gridOf(run);
  const path = truncate(g, 'lead', g.approach('lead', target.id), budget);
  if (!path || !path.length) return;
  doStride(run, 'lead', { id: 'stride', target: { path } }, { budget });
}

function asideStrike(run, targetId) {
  let lead = U(run, 'lead');
  let target = U(run, targetId);
  if (!target || !standing(target)) {
    const g = gridOf(run);
    const next = standingHeroes(run.b).filter((h) => canStrike(g, lead, h));
    target = next.length ? next[seeded(run.b, 'aside-again', next.length)] : null;
  }
  if (!target) return;
  if (!canStrike(gridOf(run), lead, target)) {
    asideStride(run, target.id);
    return;
  }
  // A warden may still draw the blow (§6.5).
  target = U(run, strikeAtAlly(run, lead, target));
  lead = U(run, 'lead');
  if (!lead || !standing(lead) || !target || !standing(target) || !canStrike(gridOf(run), lead, target)) return;
  const reach = strikeReach(lead, target);
  // An Aside is never one of the turn's attacks (§4.3): no heat, no attack penalty.
  const odds = oddsAgainst(run.b, run.ctx, 'lead', target.id, strikePk(lead, target, { reaction: true }), gridOf(run));
  const degree = pickOutcome(run, 'lead', target.id, odds);
  const t2 = U(run, target.id);
  const l2 = U(run, 'lead');
  if (degree !== 'miss' && t2 && standing(t2) && l2) {
    const { amount, kind } = strikeDamage(run, l2, t2, { ranged: reach.ranged, edge: odds.edge, dry: true });
    landHit(run, { userId: 'lead', targetId: t2.id, amount: Math.max(1, Math.floor(amount / 2)), kind, degree, source: 'aside' });
  }
}

const asideAction = (e) => ({
  id: 'aside', ability: null, cost: 1,
  target: e[1] === 'push' ? { object: e[2] } : { unit: e[2] }, extra: 0, choice: null, cheer: false, trigger: null,
});

function asideWords(b, e, parts) {
  if (e[1] === 'push') return `Aside: ${parts.pushWords ? parts.pushWords(b, at(b, e[2])) : 'its trick'}`.slice(0, 60);
  if (e[1] === 'stride') return `Aside: stride toward ${nameIn(b, e[2])}`.slice(0, 60);
  return `Aside: strike ${nameIn(b, e[2])}`.slice(0, 60);
}

/** The Asides planned for tick t, taken now. */
function runAsides(run, parts, t) {
  const b = run.b;
  const list = dataOf(b).a || [];
  const due = list.filter((e) => e[0] === t);
  if (!due.length) return;
  setData(run, { a: list.filter((e) => e[0] !== t) });
  for (const e of due) {
    if (ended(run.b) || !run.b.lead) return;
    run.b.lead.asides = Math.max(0, (run.b.lead.asides || 0) - 1);
    const lead = U(run, 'lead');
    if (!lead || !standing(lead)) return;
    const action = asideAction(e);
    if (!awake(lead) || dazedTakes(run, lead)) {
      emit(run, { t: 'lost', unit: 'lead', action, why: awake(lead) ? 'dazed' : 'asleep' });
      continue;
    }
    emit(run, { t: 'act', unit: 'lead', action, words: asideWords(run.b, e, parts) });
    if (e[1] === 'push') parts.doPush?.(run, e[2]);
    else if (e[1] === 'strike') asideStrike(run, e[2]);
    else asideStride(run, e[2]);
  }
}

function asideTelegraphs(b, parts) {
  const out = [];
  for (const e of dataOf(b).a || []) {
    const [tick, what, id] = e;
    const lead = unitIn(b, 'lead');
    let icon = 'strike';
    let targets = [];
    let tiles = [];
    if (what === 'push') {
      icon = 'mechanic';
      const o = at(b, id);
      tiles = o ? [{ x: o.x, y: o.y }] : [];
    } else {
      const v = unitIn(b, id);
      targets = [id];
      if (what === 'stride') icon = 'move';
      else {
        icon = lead && v && unitDist(lead, v) > 1 ? 'shoot' : 'strike';
        tiles = v ? footprint(v) : [];
      }
    }
    out.push({
      unitId: 'lead', slot: LEAD_NUMBERS.slots.aside + tick, tick, icon, words: asideWords(b, e, parts), targets, tiles,
      hidden: false, falseTarget: null, adapting: null, aside: true,
    });
  }
  return out;
}

// ---------- the Mechanic factory: the fallback's hooks, with a mechanic's parts on top ----------

/**
 * parts (all optional): setup(run), roundStart(run), roundEnd(run), phaseChange(run, from, to),
 * resolve(run, unitId, action) → true when it handled the action, actions(b, unitId, ctx) → options,
 * damageTaken(b, hit, ctx) → amount, bow(b) → { progress, need, done }, telegraphs(b, ctx) → list,
 * due(b, t) → bool and tickEnd(run, t) (before the tick's Asides), push(b, ctx) → object id, doPush(run, id),
 * pushWords(b, o), asides(b, rules) → count.
 */
function mechanic(id, parts = {}) {
  return Object.freeze({
    id,
    text: TEXT[id] ?? null,
    setup(battle, ctx) {
      if (!battle?.lead) return battle;
      const run = open(battle, ctx);
      run.b.lead.data = {};
      parts.setup?.(run);
      planAsides(run, parts);
      return run.b;
    },
    roundStart(battle, ctx) {
      if (!battle?.lead) return null;
      const run = open(battle, ctx);
      if (standing(U(run, 'lead'))) parts.roundStart?.(run);
      planAsides(run, parts);
      return close(run);
    },
    telegraphs(battle, ctx) {
      if (!battle?.lead || ended(battle) || !standing(unitIn(battle, 'lead'))) return [];
      return [...asideTelegraphs(battle, parts), ...(parts.telegraphs ? parts.telegraphs(battle, ctx) : [])];
    },
    actions(battle, unitId, ctx) {
      const u = unitIn(battle, unitId);
      if (!battle?.lead || !u || u.side !== 'party' || u.rank !== 'hero' || !standing(u)) return [];
      return parts.actions ? parts.actions(battle, unitId, ctx) : [];
    },
    resolve(battle, unitId, action, ctx) {
      if (!battle?.lead || !action) return null;
      // An Aside a plan names (§5.5's 'aside' action), resolved as the ones it takes at a tick's end.
      if (action.id === 'aside' && unitId === 'lead') {
        const id = action.target?.object || action.target?.unit;
        if (!id) return null;
        const run = open(battle, ctx);
        if (action.target?.object) parts.doPush?.(run, id);
        else if (canStrike(gridOf(run), U(run, 'lead'), U(run, id))) asideStrike(run, id);
        else asideStride(run, id);
        return close(run);
      }
      if (!parts.resolve) return null;
      const run = open(battle, ctx);
      return parts.resolve(run, unitId, action) ? close(run) : null;
    },
    damageTaken(battle, hit, ctx) {
      const amount = Math.max(0, Math.floor(Number(hit?.amount) || 0));
      return parts.damageTaken ? parts.damageTaken(battle, { ...hit, amount }, ctx) : amount;
    },
    tickEnd(battle, t, ctx) {
      if (!battle?.lead || ended(battle)) return null;
      const due = (dataOf(battle).a || []).some((e) => e[0] === t) || (parts.due ? parts.due(battle, t) : false);
      if (!due) return null;
      const run = open(battle, ctx);
      const undo = answerAsks(run);
      parts.tickEnd?.(run, t);
      if (!ended(run.b)) runAsides(run, parts, t);
      undo();
      return close(run);
    },
    roundEnd(battle, ctx) {
      if (!battle?.lead) return { battle, events: [], yielded: false };
      // The last page (§4.9): at the end of round 8, a lead facing a party still standing yields; off at Maud's Table.
      const yields = (b) => standing(unitIn(b, 'lead')) && b.round >= (ctx.rules.lead?.lastPage ?? 8) && lastPageOn(b, ctx.rules)
        && standingHeroes(b).length > 0;
      if (!parts.roundEnd && !yields(battle)) return { battle, events: [], yielded: false };
      const run = open(battle, ctx);
      parts.roundEnd?.(run);
      const yielded = yields(run.b);
      if (yielded) line(run, `${nameOf(run.b, 'lead')} reaches the last page and yields.`);
      return { ...close(run), yielded };
    },
    phaseChange(battle, from, to, ctx) {
      if (!battle?.lead || !parts.phaseChange) return null;
      const run = open(battle, ctx);
      parts.phaseChange(run, from, to);
      return close(run);
    },
    bow(battle, ctx) {
      if (!battle?.lead || !parts.bow) return { progress: 0, need: 0, done: false };
      return parts.bow(battle, ctx);
    },
  });
}

// ---------- the eight mechanics (COMBAT §8.3) ----------

// Throttles speed (neon): the party is Slowed 1 until every junction is rerouted (an Interact each);
// then the lead is Dazed 2. Bow: all of them rerouted in one phase. From the Twist an Aside throttles one again.
function slowParty(run) {
  for (const h of standingHeroes(run.b)) {
    if ((h.ignores || []).includes('slowed')) continue;
    const c = (h.conditions || []).find((x) => x.id === 'slowed');
    if (c && !c.data?.fresh && (c.n ?? 0) >= LEAD_NUMBERS.throttle.slowed) continue;
    if (c) {
      c.n = Math.max(c.n ?? 0, LEAD_NUMBERS.throttle.slowed);
      if (c.data?.fresh) {
        const { fresh, ...rest } = c.data;
        c.data = Object.keys(rest).length ? rest : null;
      }
    } else {
      if ((h.conditions || []).length >= 8) continue;
      // Landed straight onto this round's ticks (addCondition would hold a tick-shaping condition for the next round).
      h.conditions = [...(h.conditions || []), { id: 'slowed', n: LEAD_NUMBERS.throttle.slowed, source: 'lead', data: null }];
    }
    emit(run, { t: 'condition', target: h.id, id: 'slowed', n: LEAD_NUMBERS.throttle.slowed, on: true });
  }
}
const junctionsOn = (b) => objectsOf(b, 'junction').every((o) => o.state === 'on');

const throttles = mechanic('throttles-speed', {
  setup(run) {
    setData(run, { p: [] });
    if (objectsOf(run.b, 'junction').length && !junctionsOn(run.b)) slowParty(run);
  },
  roundStart(run) {
    if (objectsOf(run.b, 'junction').length && !junctionsOn(run.b)) slowParty(run);
  },
  resolve(run, unitId, action) {
    const o = action.id === 'interact' && action.target?.object ? at(run.b, action.target.object) : null;
    if (!o || o.kind !== 'junction') return false;
    const u = U(run, unitId);
    if (o.state === 'on') {
      line(run, 'That junction’s already rerouted.');
      return true;
    }
    o.state = 'on';
    emit(run, { t: 'object', object: o.id, state: 'on' });
    line(run, `${nameOf(run.b, unitId)} reroutes the power at ${tileName(run.b, o)}.`);
    const p = dataOf(run.b).p || [];
    if (!p.includes(o.id)) setData(run, { p: [...p, o.id] });
    if (junctionsOn(run.b)) {
      for (const h of heroesOf(run.b)) endCondition(run, h, 'slowed');
      const lead = U(run, 'lead');
      if (lead && standing(lead)) {
        line(run, `The power’s back on, and ${nameIn(run.b, 'lead')} reels.`);
        addCondition(run, lead, 'dazed', LEAD_NUMBERS.throttle.dazed, { source: u?.id ?? null });
      }
    }
    return true;
  },
  phaseChange(run) {
    setData(run, { p: [] });
  },
  push(b) {
    const on = objectsOf(b, 'junction').filter((o) => o.state === 'on');
    return on.length ? on[seeded(b, 'throttle', on.length)].id : null;
  },
  doPush(run, id) {
    const o = at(run.b, id);
    if (!o || o.state !== 'on') return;
    o.state = 'off';
    emit(run, { t: 'object', object: o.id, state: 'off' });
    line(run, `${nameOf(run.b, 'lead')} throttles the junction at ${tileName(run.b, o)} again.`);
  },
  pushWords: (b, o) => (o ? `throttle the junction at ${tileName(b, o)}` : 'throttle a junction'),
  bow(b) {
    const all = objectsOf(b, 'junction');
    const p = new Set(dataOf(b).p || []);
    const progress = all.filter((o) => o.state === 'on' && p.has(o.id)).length;
    return { progress, need: all.length, done: all.length > 0 && progress === all.length };
  },
});

// Streetlights out (nocturne): a lamp goes dark each round; an Interact relights one. Bow: every lamp lit in
// the Last page. From the Twist an Aside turns one more off.
function relight(run, unitId, action, kind, noun) {
  const o = action.id === 'interact' && action.target?.object ? at(run.b, action.target.object) : null;
  if (!o || o.kind !== kind) return false;
  if (o.state === 'lit') {
    line(run, `That ${noun}’s already lit.`);
    return true;
  }
  setLit(run, o, true, U(run, unitId)?.side || 'party');
  line(run, `${nameOf(run.b, unitId)} relights the ${noun} at ${tileName(run.b, o)}.`);
  return true;
}
const litPush = (kind, tag) => (b) => {
  const lit = objectsOf(b, kind).filter((o) => o.state === 'lit');
  return lit.length ? lit[seeded(b, tag, lit.length)].id : null;
};
const darkPush = (verb) => (run, id) => {
  const o = at(run.b, id);
  if (!o || o.state !== 'lit') return;
  setLit(run, o, false);
  line(run, `${nameOf(run.b, 'lead')} ${verb} at ${tileName(run.b, o)}.`);
};

const streetlights = mechanic('streetlights-out', {
  setup: (run) => darken(run, 'lamp', LEAD_NUMBERS.lampsPerRound, 'lamp', 'turns off the lamp'),
  roundStart: (run) => darken(run, 'lamp', LEAD_NUMBERS.lampsPerRound, 'lamp', 'turns off the lamp'),
  resolve: (run, unitId, action) => relight(run, unitId, action, 'lamp', 'lamp'),
  push: litPush('lamp', 'lamp-push'),
  doPush: darkPush('turns off the lamp'),
  pushWords: (b, o) => (o ? `turn off the lamp at ${tileName(b, o)}` : 'turn off a lamp'),
  bow(b) {
    const all = objectsOf(b, 'lamp');
    const lit = all.filter((o) => o.state === 'lit').length;
    const last = b.lead?.phase === 'last-page';
    return { progress: last ? lit : 0, need: all.length, done: last && all.length > 0 && lit === all.length };
  },
});

// Snuffs candles (gothic): 2 snuffed each round; with 4 or more lit it loses its resistance. Bow: every
// candle lit at once. From the Twist an Aside snuffs one more.
const litCandles = (b) => objectsOf(b, 'candle').filter((o) => o.state === 'lit').length;

const snuffs = mechanic('snuffs-candles', {
  setup: (run) => darken(run, 'candle', LEAD_NUMBERS.candlesPerRound, 'candle', 'snuffs the candle'),
  roundStart: (run) => darken(run, 'candle', LEAD_NUMBERS.candlesPerRound, 'candle', 'snuffs the candle'),
  resolve: (run, unitId, action) => relight(run, unitId, action, 'candle', 'candle'),
  // With 4 or more lit, its resistance is gone: what step 4 of §4.8 took off comes back (the kernel's
  // resistance as it stood for this hit; a hit it resisted down to nothing stays nothing, since the hook
  // sees only the amount after resistance).
  damageTaken(b, hit, ctx) {
    const lead = unitIn(b, 'lead');
    if (!lead || hit.amount <= 0 || litCandles(b) < LEAD_NUMBERS.candlesToLoseResistance) return hit.amount;
    const r = defencesTo(b, ctx, lead, hit.kind, createGrid(b, ctx?.rules)).resist || 0;
    return hit.amount + r;
  },
  push: litPush('candle', 'candle-push'),
  doPush: darkPush('snuffs the candle'),
  pushWords: (b, o) => (o ? `snuff the candle at ${tileName(b, o)}` : 'snuff a candle'),
  bow(b) {
    const all = objectsOf(b, 'candle');
    const lit = litCandles(b);
    return { progress: lit, need: all.length, done: all.length > 0 && lit === all.length };
  },
});

// Assembly lines (iron): every 2 rounds (every round from the Twist) a running line makes a clerk, one
// standing per line; a lever pulled (2 actions) shuts the nearest running line and takes 15% of the
// current bar; levers spring back at the round's end. Bow: every line shut. Clerks clock off with the lead,
// and once they're talked down (one talk kind for them all, §4.6) the lines make no more.
const CLERK_KIND = 'clerk';

/** A clerk off the line: a polite lackey walker of the lead's genre (§4.9's lackey rule, at the room's n). */
export function clerkSpec(battle, rules) {
  const lead = unitIn(battle, 'lead');
  const n = Math.max(0, battle.level ?? 1);
  const lackey = rules.lackey || { levels: -2, integrity: 0.5, strike: 0.75 };
  const level = Math.max(0, n + (lackey.levels ?? -2));
  const arch = rules.archetypes?.walker || { integrity: 1, speed: 5, grace: 1, guard: 1, resolve: { body: 1, mind: 0 }, ignores: [], abilities: [] };
  const genre = (lead?.genres || battle.genres || []).find((g) => rules.genres?.[g]?.kind) || null;
  const genres = genre ? [genre] : [];
  const maxIntegrity = Math.max(1, Math.round(strayRow(rules, 'integrity', n) * (arch.integrity ?? 1) * (lackey.integrity ?? 0.5)));
  const { resist, weak } = defencesFor(genres, 'walker', level, rules);
  const temperament = 'polite';
  return {
    id: 's0', side: 'foe', name: 'Clerk', kind: 'stray', talkKind: CLERK_KIND, rank: 'lackey', level, size: 1, small: false, archetype: 'walker',
    genres, temperament, calling: null, path: null,
    abilities: { might: 0, grace: arch.grace ?? 1, grit: 0, wit: 0, heed: 0, charm: 0 },
    maxIntegrity, integrity: maxIntegrity, guard: arch.guard ?? 1, resolve: { ...(arch.resolve || { body: 1, mind: 0 }) }, speed: arch.speed ?? 5,
    moves: { flies: false, hovers: false, throughWalls: false, darksight: false },
    strike: { amount: Math.floor((lackey.strike ?? 0.75) * strayRow(rules, 'strike', n)), kind: genre ? rules.genres[genre].kind : 'plain', reach: 1, range: 0, weapon: 'natural' },
    ranged: null, keyAdjust: 0, flat: 0, attackEdge: 0, resist, weak, ignores: [...(arch.ignores || [])],
    idleHeat: rules.temperaments?.[temperament]?.heat ?? rules.heat?.temperaments?.[temperament] ?? 20, shield: false,
    charges: { pool: null, max: 0, left: 0, circle: 0 }, abilityIds: [...(arch.abilities || [])], uses: {}, reactions: {}, control: 'auto', adapt: 0,
    rattled: false, lead: null, post: null,
    look: { kind: 'stray', archetype: 'walker', bodyKey: lead?.look?.bodyKey || 'r', parts: [], eyeKey: null, genres: [genre, null], scale: 1 },
    carry: { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] },
  };
}

function freeBeside(run, o) {
  const g = gridOf(run);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const t = { x: o.x + dx, y: o.y + dy };
    if (!g.inside(t.x, t.y) || g.blocksMove(t.x, t.y, null) || g.occupant(t.x, t.y) || g.objectAt(t.x, t.y)) continue;
    return t;
  }
  return null;
}

/** COMBAT §8.3: "A line every 2 rounds makes a clerk": one running line (seeded among those whose clerk isn't standing). */
function makeClerks(run) {
  const b = run.b;
  const due = pastOpening(b) || b.round % LEAD_NUMBERS.clerkEvery === 0;
  const lead = U(run, 'lead');
  const pairs = (dataOf(b).c || []).filter(([, clerk]) => standing(U(run, clerk)));
  setData(run, { c: pairs });
  // Talking the clerks down settled their whole kind (§4.6): a clerk made later would arrive past talking to.
  if (!due || !lead || !standing(lead) || b.talk?.[CLERK_KIND]?.done || run.b.units.length >= 16) return;
  const lines = objectsOf(b, 'line').filter((o) => o.state === 'running' && !pairs.some(([lineId]) => lineId === o.id) && freeBeside(run, o));
  if (!lines.length) return;
  const o = lines[seeded(b, 'clerk', lines.length)];
  const r = spawnFoe(run.b, clerkSpec(run.b, run.rules), freeBeside(run, o), run.ctx);
  const made = r.events.find((e) => e.t === 'spawn')?.unit?.id;
  if (r.battle === run.b || !made) return;
  adopt(run, r.battle);
  run.events.push(...r.events);
  setData(run, { c: [...pairs, [o.id, made]] });
  line(run, `The line at ${tileName(run.b, o)} makes a clerk.`);
}

/** A share of the lead's current bar, off its Integrity (a lever's 15%): not a hit, so nothing soaks it. */
function takeShare(run, byId, share) {
  const lead = U(run, 'lead');
  if (!lead || !standing(lead) || !run.b.lead) return;
  const amount = Math.max(1, Math.round(share * run.b.lead.bars[run.b.lead.bar]));
  lead.integrity = Math.max(0, lead.integrity - amount);
  emit(run, {
    t: 'damage', unit: byId, target: 'lead', amount, kind: 'plain', degree: 'none', weak: 0, resist: 0, buffered: 0,
    integrity: lead.integrity, max: lead.maxIntegrity,
  });
  if (lead.integrity <= 0) downUnit(run, lead, byId);
}

const assembly = mechanic('assembly-lines', {
  setup(run) {
    setData(run, { c: [] });
  },
  roundStart: makeClerks,
  actions(b, unitId) {
    const u = unitIn(b, unitId);
    const levers = objectsOf(b, 'lever');
    if (!levers.length) return [];
    const running = objectsOf(b, 'line').some((o) => o.state === 'running');
    const up = levers.filter((o) => o.state === 'up');
    const near = up.filter((o) => beside(u, o));
    const why = !running ? 'Every line’s shut' : !up.length ? 'The levers are down until the round ends' : !near.length ? 'Stand beside a lever' : null;
    return [option(USE('mech:pull-the-lever', 2), 'Pull the lever', (near.length ? near : up).map((o) => ({ object: o.id })), why)];
  },
  resolve(run, unitId, action) {
    const o = action.target?.object ? at(run.b, action.target.object) : null;
    if (action.id === 'interact' && o && o.kind === 'lever') {
      line(run, 'A lever takes both hands: pull it with 2 actions.');
      return true;
    }
    if (action.id === 'interact' && o && o.kind === 'line') {
      line(run, 'Shut a line with its lever.');
      return true;
    }
    if (action.id !== 'use' || action.ability !== 'mech:pull-the-lever') return false;
    if (wrongCost(run, action)) return true;
    const u = U(run, unitId);
    const lever = o && o.kind === 'lever' ? o : objectsOf(run.b, 'lever').find((x) => x.state === 'up' && beside(u, x));
    if (!lever || lever.state !== 'up' || !beside(u, lever)) {
      line(run, 'There’s no lever to hand.');
      return true;
    }
    lever.state = 'down';
    emit(run, { t: 'object', object: lever.id, state: 'down' });
    const lines = objectsOf(run.b, 'line').filter((x) => x.state === 'running').sort((p, q) => unitDist(lever, p) - unitDist(lever, q));
    if (!lines.length) {
      line(run, `${nameOf(run.b, unitId)} pulls the lever, but every line’s already shut.`);
      return true;
    }
    const shut = lines[0];
    shut.state = 'shut';
    emit(run, { t: 'object', object: shut.id, state: 'shut' });
    line(run, `${nameOf(run.b, unitId)} pulls the lever, and the line at ${tileName(run.b, shut)} shuts down.`);
    takeShare(run, unitId, LEAD_NUMBERS.leverShare);
    return true;
  },
  roundEnd(run) {
    for (const o of objectsOf(run.b, 'lever')) {
      if (o.state !== 'down') continue;
      o.state = 'up';
      emit(run, { t: 'object', object: o.id, state: 'up' });
    }
  },
  due(b) {
    const lead = unitIn(b, 'lead');
    return !!lead?.sorted && (dataOf(b).c || []).some(([, id]) => standing(unitIn(b, id)));
  },
  tickEnd(run) {
    const lead = U(run, 'lead');
    if (!lead?.sorted) return;
    const clerks = (dataOf(run.b).c || []).map(([, id]) => U(run, id)).filter(standing);
    if (!clerks.length) return;
    line(run, 'The lines stop, and the clerks clock off.');
    for (const c of clerks) sortUnit(run, c, 'settled');
    setData(run, { c: [] });
  },
  bow(b) {
    const all = objectsOf(b, 'line');
    const shut = all.filter((o) => o.state === 'shut').length;
    return { progress: shut, need: all.length, done: all.length > 0 && shut === all.length };
  },
});

// Too big to see (void): half damage until a step is named this phase; "Name a step" (2 actions, after an
// Examine, one a round) shrinks it; it grows back each phase. Bow: three steps named.
const tooBig = mechanic('too-big-to-see', {
  setup(run) {
    setData(run, { n: 0, r: 0, s: 0 });
  },
  actions(b, unitId, ctx) {
    const u = unitIn(b, unitId);
    const lead = unitIn(b, 'lead');
    if (!lead || !standing(lead)) return [];
    const d = dataOf(b);
    const g = createGrid(b, ctx?.rules);
    const why = !lead.examined ? 'Examine it first' : d.r === b.round ? 'One step a round' : !g.sees(u, lead) ? 'It’s out of sight' : null;
    return [option(USE('mech:name-a-step', 2), 'Name a step', [{ unit: 'lead' }], why)];
  },
  resolve(run, unitId, action) {
    if (action.id !== 'use' || action.ability !== 'mech:name-a-step') return false;
    if (wrongCost(run, action)) return true;
    const lead = U(run, 'lead');
    const d = dataOf(run.b);
    if (!lead || !standing(lead)) return true;
    if (!lead.examined) {
      line(run, 'It’s too big to see. Examine it first.');
      return true;
    }
    if (d.r === run.b.round) {
      line(run, 'One step at a time: it’s already shrinking this round.');
      return true;
    }
    // The same gate the option shows: it has to be in sight when the step is named.
    if (!gridOf(run).sees(U(run, unitId), lead)) {
      line(run, 'It’s out of sight. Name a step where you can see it.');
      return true;
    }
    setData(run, { n: (d.n || 0) + 1, r: run.b.round, s: 1 });
    line(run, `${nameOf(run.b, unitId)} names its first small step, and ${nameIn(run.b, 'lead')} shrinks.`);
    return true;
  },
  damageTaken: (b, hit) => (dataOf(b).s ? hit.amount : Math.floor(hit.amount / 2)),
  phaseChange(run) {
    if (!dataOf(run.b).s) return;
    setData(run, { s: 0 });
    line(run, `${nameOf(run.b, 'lead')} grows too big to see again.`);
  },
  bow(b) {
    const n = dataOf(b).n || 0;
    return { progress: Math.min(n, LEAD_NUMBERS.stepsToBow), need: LEAD_NUMBERS.stepsToBow, done: n >= LEAD_NUMBERS.stepsToBow };
  },
});

// Alibis (noir): half damage while every alibi stands; an Interact on a clue finds evidence, and an Interact
// on an alibi with evidence in hand breaks it. Bow: every alibi broken.
const alibisStand = (b) => {
  const all = objectsOf(b, 'alibi');
  return all.length > 0 && all.every((o) => o.state === 'standing');
};

const alibis = mechanic('alibis', {
  setup(run) {
    setData(run, { e: 0 });
  },
  resolve(run, unitId, action) {
    const o = action.id === 'interact' && action.target?.object ? at(run.b, action.target.object) : null;
    if (!o || (o.kind !== 'clue' && o.kind !== 'alibi')) return false;
    const d = dataOf(run.b);
    if (o.kind === 'clue') {
      if (o.state === 'found') {
        line(run, 'That clue’s already found.');
        return true;
      }
      o.state = 'found';
      emit(run, { t: 'object', object: o.id, state: 'found' });
      setData(run, { e: (d.e || 0) + 1 });
      line(run, `${nameOf(run.b, unitId)} finds a clue. That’s evidence.`);
      return true;
    }
    if (o.state === 'broken') {
      line(run, 'That alibi’s already broken.');
      return true;
    }
    if (!(d.e > 0)) {
      line(run, 'An alibi needs evidence. Find a clue first.');
      return true;
    }
    o.state = 'broken';
    emit(run, { t: 'object', object: o.id, state: 'broken' });
    setData(run, { e: d.e - 1 });
    line(run, `${nameOf(run.b, unitId)} presents the evidence, and an alibi breaks.`);
    return true;
  },
  damageTaken: (b, hit) => (alibisStand(b) ? Math.floor(hit.amount / 2) : hit.amount),
  // From the Twist, an Aside covers its tracks while evidence waits unspent: a found clue is hidden again
  // and the evidence goes with it (to be found again, so every alibi can still be broken).
  push(b) {
    if (!(dataOf(b).e > 0)) return null;
    const found = objectsOf(b, 'clue').filter((o) => o.state === 'found');
    return found.length ? found[seeded(b, 'alibi-push', found.length)].id : null;
  },
  doPush(run, id) {
    const o = at(run.b, id);
    const d = dataOf(run.b);
    if (!o || o.kind !== 'clue' || o.state !== 'found' || !(d.e > 0)) return;
    o.state = 'hidden';
    emit(run, { t: 'object', object: o.id, state: 'hidden' });
    setData(run, { e: d.e - 1 });
    line(run, `${nameOf(run.b, 'lead')} covers its tracks, and the clue at ${tileName(run.b, o)} is hidden again.`);
  },
  pushWords: (b, o) => (o ? `hide the clue at ${tileName(b, o)}` : 'hide a clue'),
  bow(b) {
    const all = objectsOf(b, 'alibi');
    const broken = all.filter((o) => o.state === 'broken').length;
    return { progress: broken, need: all.length, done: all.length > 0 && broken === all.length };
  },
});

// Noon duel (frontier): in the Last page, at the end of tick 1 each round, a duel with the standing hero
// highest on the ribbon: whoever stands higher strikes first, at +1 edge, then the other. The hero wins it
// by landing a Hit or better while the lead's shot doesn't. Bow: the duel won, then Holster (1 action).
const lastPage = (b) => b.lead?.phase === 'last-page';
const duelist = (b) => standingHeroes(b).sort((p, q) => b.order.indexOf(p.id) - b.order.indexOf(q.id))[0] || null;
const landed = (d) => d === 'hit' || d === 'crit';

function duelShot(run, fromId, toId, edge) {
  const u = U(run, fromId);
  const v = U(run, toId);
  if (!u || !v || !standing(u) || !standing(v)) return null;
  // The +1 edge is a mod only while the odds are read; the list is put back as it was, so a full one loses nothing.
  const kept = (u.mods || []).map((m) => ({ ...m }));
  if (edge) addMod(run, u, { stat: 'edge-next', by: edge, until: 'next-attack', source: 'noon' });
  const ranged = unitDist(u, v) > 1;
  const odds = oddsAgainst(run.b, run.ctx, u.id, v.id, { harmful: true, meets: 'guard', attack: true, reaction: true, ranged, light: false }, gridOf(run));
  U(run, fromId).mods = kept;
  const degree = pickOutcome(run, u.id, v.id, odds);
  const a = U(run, fromId);
  const t = U(run, toId);
  if (degree !== 'miss' && a && t && standing(t)) {
    const { amount, kind } = strikeDamage(run, a, t, { ranged: ranged && !!a.ranged, edge: odds.edge, dry: true });
    landHit(run, { userId: a.id, targetId: t.id, amount, kind, degree, source: 'duel' });
  }
  return degree;
}

const noonDuel = mechanic('noon-duel', {
  setup(run) {
    setData(run, { w: null, h: 0 });
  },
  // In the Last page the duel takes the place of its Asides.
  asides: (b, rules) => (lastPage(b) ? 0 : asidesFor(b, rules)),
  due: (b, t) => lastPage(b) && t === LEAD_NUMBERS.duelTick && !dataOf(b).h,
  tickEnd(run, t) {
    if (!lastPage(run.b) || t !== LEAD_NUMBERS.duelTick || dataOf(run.b).h) return;
    const lead = U(run, 'lead');
    const hero = duelist(run.b);
    if (!lead || !hero || !standing(lead)) return;
    const action = { id: 'aside', ability: null, cost: 1, target: { unit: hero.id }, extra: 0, choice: null, cheer: false, trigger: null };
    if (!awake(lead) || dazedTakes(run, lead)) {
      emit(run, { t: 'lost', unit: 'lead', action, why: awake(lead) ? 'dazed' : 'asleep' });
      return;
    }
    emit(run, { t: 'act', unit: 'lead', action, words: `Noon: a duel with ${nameIn(run.b, hero.id)}`.slice(0, 60) });
    line(run, `Noon. ${nameOf(run.b, 'lead')} and ${nameIn(run.b, hero.id)} face each other.`);
    const leadFirst = run.b.order.indexOf('lead') < run.b.order.indexOf(hero.id);
    const first = leadFirst ? 'lead' : hero.id;
    const second = leadFirst ? hero.id : 'lead';
    const d1 = duelShot(run, first, second, LEAD_NUMBERS.duelEdge);
    const d2 = standing(U(run, first)) && standing(U(run, second)) && !ended(run.b) ? duelShot(run, second, first, 0) : null;
    const heroShot = leadFirst ? d2 : d1;
    const leadShot = leadFirst ? d1 : d2;
    if (landed(heroShot) && !landed(leadShot) && standing(U(run, hero.id)) && !ended(run.b)) {
      setData(run, { w: hero.id });
      line(run, `${nameOf(run.b, hero.id)} wins the duel. Now holster.`);
    }
  },
  telegraphs(b) {
    if (!lastPage(b) || dataOf(b).h || (b.status !== 'planning' && b.tick > LEAD_NUMBERS.duelTick)) return [];
    const hero = duelist(b);
    if (!hero) return [];
    return [{
      unitId: 'lead', slot: LEAD_NUMBERS.slots.duel, tick: LEAD_NUMBERS.duelTick, icon: 'shoot', words: `Noon: a duel with ${nameIn(b, hero.id)}`.slice(0, 60),
      targets: [hero.id], tiles: footprint(hero), hidden: false, falseTarget: null, adapting: null, aside: false,
    }];
  },
  actions(b, unitId) {
    const d = dataOf(b);
    if (!lastPage(b) || !d.w || d.h) return [];
    return [option(USE('mech:holster', 1), 'Holster', null, d.w === unitId ? null : 'Only the duel’s winner holsters')];
  },
  resolve(run, unitId, action) {
    if (action.id !== 'use' || action.ability !== 'mech:holster') return false;
    if (wrongCost(run, action)) return true;
    const d = dataOf(run.b);
    if (d.w !== unitId || d.h) {
      line(run, 'Win the duel first.');
      return true;
    }
    setData(run, { h: 1 });
    line(run, `${nameOf(run.b, unitId)} holsters, and ${nameIn(run.b, 'lead')} tips its hat.`);
    return true;
  },
  bow(b) {
    const d = dataOf(b);
    const progress = (d.w ? 1 : 0) + (d.h ? 1 : 0);
    return { progress, need: 2, done: !!d.w && !!d.h };
  },
});

// Stomps (kaiju): a telegraphed stomp at the end of tick 3 over about 60% of the room's floor (each tile's
// own seeded draw); the crew's plan tiles are safe, and fliers and floaters are above it. It meets body
// Resolve and deals the lead's Strike in its kind. Bow (COMBAT's "Nobody stomped for a phase"): the Opening
// or the Twist ends with at least one stomp in it and no hero stomped (the last bar's end settles the lead).
// From the Twist an Aside tramples a plan tile, which that round's stomp then covers.

/** The plan tiles trampled this round (lead.data.t), and the one a planned Aside will trample. */
const trampled = (b) => new Set([...(dataOf(b).t || []), ...(dataOf(b).a || []).filter((e) => e[1] === 'push').map((e) => e[2])]);

/**
 * This round's stomp tiles: about 60% of the arena's open floor, less the plan tiles still clear, plus any
 * plan tile trampled this round. The set is fixed for the round, whoever moves: what the planning
 * telegraph shows is what the stomp at the end of tick 3 covers (the lead's own tiles included, since the
 * stomp only ever meets the party). A trample lost with its Aside only shrinks it.
 */
export function stompTiles(battle) {
  const rect = battle?.arena?.rect;
  if (!rect) return [];
  const gone = trampled(battle);
  const plans = objectsOf(battle, 'plan-tile');
  const safe = new Set(plans.filter((o) => !gone.has(o.id)).map(key));
  const covered = new Set(plans.filter((o) => gone.has(o.id)).map(key));
  const out = [];
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const c = battle.arena.cells[(y - rect.y) * rect.w + (x - rect.x)];
      const k = `${x},${y}`;
      if ((c !== '.' && c !== '=') || safe.has(k)) continue;
      if (covered.has(k) || unit01(hashInts(battle.seed >>> 0, battle.attempt, battle.round, x, y, 'stomp')) < LEAD_NUMBERS.stompShare) out.push({ x, y });
    }
  }
  return out;
}

const stomps = mechanic('stomps', {
  setup(run) {
    setData(run, { st: 0, x: 0, t: [] });
  },
  roundStart(run) {
    if ((dataOf(run.b).t || []).length) setData(run, { t: [] });
  },
  push(b) {
    const gone = trampled(b);
    const clear = objectsOf(b, 'plan-tile').filter((o) => !gone.has(o.id));
    return clear.length ? clear[seeded(b, 'trample', clear.length)].id : null;
  },
  doPush(run, id) {
    const o = at(run.b, id);
    const t = dataOf(run.b).t || [];
    if (!o || o.kind !== 'plan-tile' || t.includes(id)) return;
    setData(run, { t: [...t, id] });
    line(run, `${nameOf(run.b, 'lead')} tramples the plan at ${tileName(run.b, o)}.`);
  },
  pushWords: (b, o) => (o ? `trample the plan at ${tileName(b, o)}` : 'trample the plan'),
  due: (b, t) => t === LEAD_NUMBERS.stompTick,
  tickEnd(run, t) {
    if (t !== LEAD_NUMBERS.stompTick) return;
    const lead = U(run, 'lead');
    if (!lead || !standing(lead)) return;
    const action = { id: 'aside', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null };
    if (!awake(lead)) {
      emit(run, { t: 'lost', unit: 'lead', action, why: 'asleep' });
      return;
    }
    const tiles = new Set(stompTiles(run.b).map(key));
    emit(run, { t: 'act', unit: 'lead', action, words: 'Stomp' });
    line(run, `${nameOf(run.b, 'lead')} stomps.`);
    let stomped = false;
    for (const id of run.b.order) {
      const v = U(run, id);
      if (!v || v.side !== 'party' || !standing(v) || v.moves?.flies || v.moves?.hovers) continue;
      if (!footprint(v).some((p) => tiles.has(key(p)))) continue;
      const l2 = U(run, 'lead');
      if (!l2 || !standing(l2) || ended(run.b)) break;
      const odds = oddsAgainst(run.b, run.ctx, 'lead', v.id, { harmful: true, meets: 'body', area: true }, gridOf(run));
      const degree = pickOutcome(run, 'lead', v.id, odds);
      if (degree === 'miss') continue;
      if (v.rank === 'hero') stomped = true;
      landHit(run, { userId: 'lead', targetId: v.id, amount: (l2.strike?.amount || 0) + (l2.keyAdjust || 0) + (l2.flat || 0), kind: l2.strike?.kind || 'quake', degree, source: 'stomp' });
    }
    const d = dataOf(run.b);
    if (run.b.lead) setData(run, { st: (d.st || 0) + 1, x: stomped || d.x ? 1 : 0 });
  },
  telegraphs(b) {
    if (b.status !== 'planning' && b.tick > LEAD_NUMBERS.stompTick) return [];
    return [{
      unitId: 'lead', slot: LEAD_NUMBERS.slots.stomp, tick: LEAD_NUMBERS.stompTick, icon: 'area', words: 'Stomp: stand on the plan',
      targets: [], tiles: stompTiles(b), hidden: false, falseTarget: null, adapting: null, aside: false,
    }];
  },
  phaseChange(run) {
    const d = dataOf(run.b);
    setData(run, { st: 0, x: 0, k: d.k || (d.st > 0 && !d.x) ? 1 : 0 });
  },
  bow(b) {
    const k = dataOf(b).k ? 1 : 0;
    return { progress: k, need: 1, done: k === 1 };
  },
});

// ---------- the fallback, and the set B reads ----------

/** The generic lead for the other 24 mechanics and Maelstroms: its bars, phases and quote, Asides and the last page. */
const fallback = mechanic('fallback', {});

export const MECHANICS = Object.freeze({
  fallback,
  'throttles-speed': throttles,
  'streetlights-out': streetlights,
  'snuffs-candles': snuffs,
  'assembly-lines': assembly,
  'too-big-to-see': tooBig,
  alibis,
  'noon-duel': noonDuel,
  stomps,
});

// ---------- the canon foes' bows (COMBAT §8.5, §9.8) ----------

/** foes.json's canon bows and the Mimic's, by foe id (a canon foe's unit `kind`). */
export const CANON_BOWS = Object.freeze({
  'hollow-sentries': Object.freeze({ kind: 'talk-down', count: 3 }),
  unwritten: Object.freeze({ kind: 'read', count: 1 }),
  tollmen: Object.freeze({ kind: 'riddle', count: 1 }),
  'cinder-golems': Object.freeze({ kind: 'forge', count: 1 }),
  'hush-hounds': Object.freeze({ kind: 'walk', count: 2 }),
  'drowned-bell-ringers': Object.freeze({ kind: 'bell', count: 3 }),
  mimic: Object.freeze({ kind: 'open', count: 1 }),
});

const BOW_ACTIONS = new Set(['mech:read-aloud', 'mech:answer-the-riddle', 'mech:light-the-forge', 'mech:ring-the-bell']);
const canonOf = (u) => (u && u.side === 'foe' ? CANON_BOWS[u.kind] || null : null);
const standingKind = (b, kind) => b.units.filter((v) => v.side === 'foe' && v.kind === kind && standing(v));
const hasKind = (b, kind) => standingKind(b, kind).length > 0;

/** A canon foe's bow: its whole kind settles, and pays, exactly as talking it down does (addCalm to its need). */
function bowKind(run, byId, foe) {
  const kind = foe?.talkKind;
  const t = kind ? run.b.talk?.[kind] : null;
  const by = U(run, byId);
  if (!t || t.done || !by) return false;
  addCalm(run, by, kind, Math.max(1, t.need - t.calm));
  return true;
}

/** Light for the forge (COMBAT §8.5: "a Light hit on it"): Milo's lantern within 8 in sight, or a Light Strike beside it. */
function lightsForge(b, u, o, rules = null) {
  if (!u || !o) return false;
  if (u.kind === 'milo') return unitDist(u, o) <= 8 && createGrid(b, rules).sees(u, o);
  const light = u.strike?.kind === 'light' || (u.mods || []).some((m) => m.stat === 'dip' && m.source === 'light');
  return light && beside(u, o);
}

function bowOptions(b, unitId, ctx) {
  const u = unitIn(b, unitId);
  if (!u || u.side !== 'party' || u.rank !== 'hero' || !standing(u)) return [];
  const out = [];
  if (hasKind(b, 'unwritten')) {
    for (const o of objectsOf(b, 'lectern').filter((x) => x.state === 'idle')) {
      out.push(option(USE('mech:read-aloud', 2), 'Read aloud', [{ object: o.id }], beside(u, o) ? null : 'Stand beside the lectern'));
    }
  }
  if (hasKind(b, 'tollmen')) {
    for (const o of objectsOf(b, 'riddle-board').filter((x) => x.state === 'idle')) {
      const why = (u.abilities?.wit ?? 0) < 3 ? 'Needs Wit 3' : beside(u, o) ? null : 'Stand beside the riddle board';
      out.push(option(USE('mech:answer-the-riddle', 2), 'Answer the riddle', [{ object: o.id }], why));
    }
  }
  if (hasKind(b, 'cinder-golems')) {
    for (const o of objectsOf(b, 'forge').filter((x) => x.state === 'stoked')) {
      out.push(option(USE('mech:light-the-forge', 1), 'Light the forge', [{ object: o.id }], lightsForge(b, u, o, ctx?.rules) ? null : 'Needs a Light hit: Milo’s lantern, or a Dip'));
    }
  }
  if (hasKind(b, 'drowned-bell-ringers')) {
    for (const o of objectsOf(b, 'bell').filter((x) => x.state === 'still')) {
      out.push(option(USE('mech:ring-the-bell', 1), 'Ring the bell', [{ object: o.id }], atLectern(b, u) ? null : 'Stand beside the lectern'));
    }
  }
  return out;
}

function bowResolve(run, unitId, action) {
  const b = run.b;
  const u = U(run, unitId);
  if (!u || u.side !== 'party') return false;
  const t = action.target || {};
  const o = t.object ? at(b, t.object) : null;
  const foe = t.unit ? U(run, t.unit) : null;
  const who = nameOf(b, unitId);
  if (action.id === 'use') {
    if (BOW_ACTIONS.has(action.ability) && wrongCost(run, action)) return true;
    switch (action.ability) {
      case 'mech:read-aloud': {
        const lectern = o?.kind === 'lectern' ? o : objectsOf(b, 'lectern').find((x) => beside(u, x));
        const f = standingKind(b, 'unwritten')[0];
        if (!lectern || !beside(u, lectern) || lectern.state !== 'idle' || !f) {
          line(run, 'There’s nothing here to read to.');
          return true;
        }
        lectern.state = 'read';
        emit(run, { t: 'object', object: lectern.id, state: 'read' });
        line(run, `${who} reads aloud, and the Unwritten settle down to listen.`);
        bowKind(run, unitId, f);
        return true;
      }
      case 'mech:answer-the-riddle': {
        const board = o?.kind === 'riddle-board' ? o : objectsOf(b, 'riddle-board').find((x) => beside(u, x));
        const f = standingKind(b, 'tollmen')[0];
        if (!board || !beside(u, board) || board.state !== 'idle' || !f || (u.abilities?.wit ?? 0) < 3) {
          line(run, 'The riddle board needs someone with Wit 3 beside it.');
          return true;
        }
        board.state = 'solved';
        emit(run, { t: 'object', object: board.id, state: 'solved' });
        line(run, `${who} answers the riddle, and the Tollmen wave the party across.`);
        bowKind(run, unitId, f);
        return true;
      }
      case 'mech:light-the-forge': {
        const forge = o?.kind === 'forge' ? o : objectsOf(b, 'forge').find((x) => x.state === 'stoked');
        const f = standingKind(b, 'cinder-golems')[0];
        if (!forge || forge.state !== 'stoked' || !f || !lightsForge(b, u, forge, run.rules)) {
          line(run, 'The forge needs stoking, then a Light hit.');
          return true;
        }
        line(run, `${who} lights the forge, and the cinder golems sit down, warm.`);
        bowKind(run, unitId, f);
        return true;
      }
      case 'mech:ring-the-bell': return ringBell(run, u, o?.kind === 'bell' ? o : objectsOf(b, 'bell')[0]);
      default: return false;
    }
  }
  if (action.id !== 'interact') return false;
  if (o) {
    switch (o.kind) {
      case 'forge':
        if (!hasKind(b, 'cinder-golems')) return false;
        if (o.state === 'stoked') {
          line(run, 'The forge is stoked. Now it needs a Light hit.');
          return true;
        }
        o.state = 'stoked';
        emit(run, { t: 'object', object: o.id, state: 'stoked' });
        line(run, `${who} stokes the forge. Now it needs a Light hit.`);
        return true;
      case 'bell':
        if (!hasKind(b, 'drowned-bell-ringers')) return false;
        line(run, 'The bell is rung from the lectern.');
        return true;
      case 'lectern':
        if (!hasKind(b, 'unwritten') && !hasKind(b, 'drowned-bell-ringers')) return false;
        line(run, hasKind(b, 'unwritten') ? 'Reading aloud takes 2 actions at the lectern.' : 'Ring the bell from here to adjourn the meeting.');
        return true;
      case 'riddle-board':
        if (!hasKind(b, 'tollmen')) return false;
        line(run, 'The riddle board takes 2 actions and Wit 3.');
        return true;
      default: return false;
    }
  }
  const bow = canonOf(foe);
  if (!bow || !standing(foe) || unitDist(u, foe) > 1) return false;
  switch (bow.kind) {
    case 'open':
      line(run, `${who} opens the chest, and it settles back into being a chest.`);
      return bowKind(run, unitId, foe);
    case 'read':
      if (u.kind !== 'claude') return false;
      line(run, `${who} reads to ${nameIn(b, foe.id)}, and the Unwritten settle down to listen.`);
      return bowKind(run, unitId, foe);
    case 'walk': return walkHound(run, u, foe, bow);
    default: return false;
  }
}

/** The bell is rung at the lectern (COMBAT §8.5, §9.8): the ringer stands beside a lectern. */
const atLectern = (b, u) => objectsOf(b, 'lectern').some((l) => beside(u, l));

function ringBell(run, u, bell) {
  const b = run.b;
  const f = standingKind(b, 'drowned-bell-ringers')[0];
  if (!bell || bell.state !== 'still' || !f || !atLectern(b, u)) {
    line(run, bell?.state === 'still' && f ? 'The bell is rung from the lectern.' : 'There’s no bell to hand.');
    return true;
  }
  bell.state = 'rung';
  emit(run, { t: 'object', object: bell.id, state: 'rung' });
  line(run, `${nameOf(b, u.id)} rings the bell, and the meeting is adjourned.`);
  bowKind(run, u.id, f);
  return true;
}

/**
 * Walked (COMBAT §8.5): a hero spends an Interact beside one two turns running. Each hero's own streak is
 * kept on the kind's talk entry as `walk: { [heroId]: [round, streak] }`, never as a mod (a unit holds at
 * most 6, and a full list would lose one).
 */
function walkHound(run, u, hound, bow) {
  const b = run.b;
  const t = b.talk?.[hound.talkKind];
  if (!t || t.done) return false;
  const [last = 0, had = 0] = t.walk?.[u.id] || [];
  if (last === b.round) {
    line(run, `${nameOf(b, u.id)} has already walked with it this turn.`);
    return true;
  }
  const streak = last === b.round - 1 ? had + 1 : 1;
  t.walk = { ...(t.walk || {}), [u.id]: [b.round, streak] };
  if (streak >= bow.count) {
    line(run, `${nameOf(b, u.id)} walks beside ${nameIn(b, hound.id)} again, and it heels.`);
    bowKind(run, u.id, hound);
  } else line(run, `${nameOf(b, u.id)} walks beside ${nameIn(b, hound.id)}. Next turn too, and it heels.`);
  return true;
}

/**
 * The talk kinds whose Talk-down count is below their bow's: three for the Sentries and the bell-ringers
 * (less one with Charm 3+ in the party, at least 2), where B's creation gave them their temperament's.
 */
function lowNeeds(b, rules) {
  const charm = b.units.some((v) => v.side === 'party' && v.rank === 'hero' && (v.abilities?.charm ?? 0) >= (rules?.talk?.charm ?? 3));
  const out = [];
  for (const [kind, t] of Object.entries(b.talk || {})) {
    if (t.done) continue;
    const bow = canonOf(b.units.find((v) => v.talkKind === kind));
    if (!bow || (bow.kind !== 'talk-down' && bow.kind !== 'bell')) continue;
    const need = Math.max(rules?.talk?.min ?? 2, bow.count - (charm ? 1 : 0));
    if (t.need < need) out.push([kind, need]);
  }
  return out;
}

function raiseNeeds(run) {
  for (const [kind, need] of lowNeeds(run.b, run.rules)) {
    const t = run.b.talk[kind];
    t.need = need;
    emit(run, { t: 'calm', kind, calm: Math.min(t.calm, need), need });
  }
}

/** The Tollkeeper's Riddle me, landed (its Drawn mark) on a Tollman beside him, answers its riddle. */
function riddleMe(run, unitId, action) {
  const u = U(run, unitId);
  const foe = action.target?.unit ? U(run, action.target.unit) : null;
  if (!u || u.kind !== 'tollkeeper' || action.id !== 'use' || action.ability !== 'riddle-me') return false;
  if (!foe || canonOf(foe)?.kind !== 'riddle' || !standing(foe) || unitDist(u, foe) > 1) return false;
  if (!(foe.marks || []).some((m) => m.id === 'drawn' && m.by === u.id)) return false;
  line(run, `${nameOf(run.b, unitId)} asks a riddle, and the Tollmen wave the party across.`);
  return bowKind(run, unitId, foe);
}

export const FOE_BOWS = Object.freeze({
  actions(battle, unitId, ctx) {
    return battle ? bowOptions(battle, unitId, ctx) : [];
  },
  resolve(battle, unitId, action, ctx) {
    if (!battle || !action) return null;
    const run = open(battle, ctx);
    return bowResolve(run, unitId, action) ? close(run) : null;
  },
  afterAction(battle, unitId, action, ctx) {
    if (!battle || ended(battle)) return null;
    const tollman = action?.id === 'use' && action.ability === 'riddle-me';
    if (!tollman && !lowNeeds(battle, ctx?.rules).length) return null;
    const run = open(battle, ctx);
    if (tollman) riddleMe(run, unitId, action);
    if (!ended(run.b)) raiseNeeds(run);
    return run.events.length ? close(run) : null;
  },
});
