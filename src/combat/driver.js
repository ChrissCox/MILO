// The one round loop (CONTRACT-PHASE4.md §7.1 driver.js; COMBAT.md §3.2, §15): the round's view
// for the planner, committing plans with the learning record, stepping one action at a time,
// answering Asks, and playing a whole fight out (Tell me how it went, Wrap it up). The HUD, every
// auto mode and the sim use it. Saving and restoring a Battle (§5.4) live here too, beside the
// rest of what a caller drives; battle.js exports them. Nothing here waits, sleeps or reads a clock.
import { hashString } from '../world/rng.js';
import { createGrid, unitDist } from './grid.js';
import { unitIn, standing, hasCond, speedOf, plainTelegraphs, noiseBanner, targetsOf } from './round.js';
import { canStrike, jsonCopy, deepFreeze, SURFACE_IDS, CONDITION_IDS, UNTIL } from './effects.js';
import { deviceSpec } from './abilities.js';
import {
  apply, canWrapBattle, trouble as troubleFor, TERMINAL, unitFrom, scaleFoe, foePlans, decodeSchedule, scheduleOut, normaliseAction,
  EMPTY_CARRY, buildTelegraphs,
} from './battle.js';

const plain = (v) => (v === undefined ? null : jsonCopy(v));

const heroesOf = (battle) => battle.units.filter((u) => u.side === 'party' && u.rank === 'hero' && standing(u));

function draftOf(battle, id, ctx) {
  const d = ctx.minds?.draft ? ctx.minds.draft(battle, id) : null;
  return d || null;
}

/** The round as the planner shows it: telegraphs, drafts, plans, the noise banner, Cheers, Wrap it up and trouble. */
export function roundView(battle, ctx) {
  const drafts = {};
  const trouble = {};
  for (const u of heroesOf(battle)) {
    if (u.control !== 'mine') {
      const d = draftOf(battle, u.id, ctx);
      if (d) drafts[u.id] = d;
    }
    const plan = battle.plans?.[u.id] || drafts[u.id]?.plan || null;
    trouble[u.id] = plan ? troubleFor(battle, u.id, plan, ctx) : [];
  }
  return {
    telegraphs: plain(battle.telegraphs || []),
    drafts,
    plans: plain(battle.plans || {}),
    noise: noiseBanner(battle, ctx.rules),
    cheers: battle.cheers,
    canWrap: canWrapBattle(battle, ctx),
    trouble,
  };
}

function base64(bytes) {
  let s = '';
  for (const b of bytes || []) s += String.fromCharCode(b);
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

const sameAction = (a, b) => {
  if (!a || !b) return false;
  const strip = (x) => JSON.stringify({ ...x, cheer: false });
  return strip(a) === strip(b);
};

function layersOf(draft) {
  const out = [];
  for (const w of draft?.why || []) {
    if (typeof w.slot !== 'number') continue;
    out[w.slot] = w.layer === 'rail' ? 'personality' : w.layer;
  }
  const slots = draft?.plan?.slots?.length || 0;
  for (let i = 0; i < slots; i += 1) if (!out[i]) out[i] = draft.source === 'mixed' || !draft.source ? 'personality' : draft.source;
  return out;
}

/**
 * Commits a round: one explicit plan command per hero (drafts included), then commit. The
 * RoundRecord is built from the drafts and plans before anything resolves, so learning never sees
 * an outcome. auto: Let them handle it (every hero commits its own draft).
 */
export function commit(battle, plans, ctx, { auto = false, scripted = false } = {}) {
  if (!battle || battle.status !== 'planning') return { battle, events: [], record: null };
  const minds = ctx.minds || {};
  const record = { key: hashString(`${battle.id}:${battle.attempt}:${battle.round}`) >>> 0, round: battle.round, units: {} };
  let b = battle;
  const events = [];
  for (const u of heroesOf(battle)) {
    // scripted: `plans` come from the scripted player and play for every hero, as auto play.
    const forced = scripted && plans?.[u.id] ? plans[u.id] : null;
    const draft = !forced && (u.control !== 'mine' || auto) ? draftOf(battle, u.id, ctx) : null;
    const heroAuto = auto || scripted || u.control === 'choose' || u.control === 'auto';
    let plan = forced || (heroAuto ? draft?.plan : plans?.[u.id] || draft?.plan || null);
    if (!plan) plan = { unitId: u.id, slots: [], reactions: {}, by: 'you', changed: [] };
    const fromDraft = !!draft && (heroAuto || plan === draft.plan);
    const committed = {
      unitId: u.id,
      slots: plain(plan.slots || []),
      reactions: { ...(plan.reactions || {}) },
      by: heroAuto ? 'auto' : fromDraft ? 'draft' : plan.by || 'you',
      changed: (plan.slots || []).map((a, i) => (draft ? !sameAction(a, draft.plan?.slots?.[i]) : false)),
    };
    if (plan.by === 'draft' && !heroAuto && Array.isArray(plan.changed)) committed.changed = committed.changed.map((c, i) => c || !!plan.changed[i]);
    if (committed.by === 'draft' || committed.by === 'auto') committed.changed = committed.slots.map((a, i) => (draft ? !sameAction(a, draft.plan?.slots?.[i]) : false));
    const choices = minds.choices ? minds.choices(battle, u.id, committed) || [] : committed.slots.map(() => null);
    const draftChoices = draft && minds.choices ? minds.choices(battle, u.id, draft.plan) || [] : [];
    const accepted = draft ? (draft.plan?.slots || []).map((a, i) => {
      const mine = choices[i];
      const theirs = draftChoices[i];
      if (mine && theirs) return mine.template === theirs.template && mine.ability === theirs.ability && mine.relation === theirs.relation;
      return sameAction(committed.slots[i], a);
    }) : [];
    record.units[u.id] = {
      situation: base64(minds.situation ? minds.situation(battle, u.id) : new Uint8Array(16)),
      draft: draft ? { confidence: draft.confidence, choices: plain(draft.choices || []) } : null,
      plan: plain(committed),
      choices: plain(choices),
      accepted,
      auto: heroAuto,
    };
    const cmd = { t: 'plan', unitId: u.id, plan: committed };
    if (draft && (committed.by === 'draft' || committed.by === 'auto' || committed.changed.some((c) => !c))) {
      cmd.draft = { confidence: draft.confidence, source: draft.source, choices: plain(draft.choices || []), layers: layersOf(draft) };
    }
    const r = apply(b, cmd, ctx);
    b = r.battle;
    events.push(...r.events);
  }
  const r = apply(b, { t: 'commit' }, ctx);
  events.push(...r.events);
  return { battle: r.battle, events, record };
}

/** Resolves exactly one scheduled action and the reactions it triggers. */
export function step(battle, ctx) {
  const r = apply(battle, { t: 'step' }, ctx);
  const b = r.battle;
  return {
    battle: b,
    events: r.events,
    roundOver: b.status === 'planning' && (b.round !== battle.round || battle.status !== 'planning'),
    ask: b.status === 'asking' ? b.ask : null,
    result: b.result || null,
  };
}

/** Answers a pending Ask (answering isn't a note). */
export function answer(battle, yes, ctx) {
  return apply(battle, { t: 'answer', yes: !!yes }, ctx);
}

/** Wrap it up is offered once the foes' remaining Integrity is below one round of the party's expected damage. */
export function canWrap(battle, ctx) {
  return canWrapBattle(battle, ctx);
}

/**
 * Tell me how it went, and Wrap it up: plays every round from drafts (or the scripted player),
 * answers every Ask yes (Ask counts as Always) and marks every record auto.
 */
export function runToEnd(battle, ctx, { policy = 'drafts', maxRounds = 30 } = {}) {
  let b = battle;
  const events = [];
  const records = [];
  let guard = 0;
  while (b && !TERMINAL.has(b.status) && guard < 20000) {
    guard += 1;
    if (b.round > maxRounds) {
      const r = apply(b, { t: 'head-home' }, ctx);
      events.push(...r.events);
      b = r.battle;
      if (!TERMINAL.has(b.status)) {
        const s = apply(b, { t: 'step' }, ctx);
        events.push(...s.events);
        b = s.battle;
      }
      break;
    }
    if (b.status === 'planning') {
      // The scripted player: ctx.minds.scriptedPlan when the minds have one, else their drafts
      // (makeMinds' `scripted: true` drafts as the scripted player), for every hero, Mine included.
      const plans = {};
      if (policy === 'scripted') {
        for (const u of heroesOf(b)) {
          const p = ctx.minds?.scriptedPlan ? ctx.minds.scriptedPlan(b, u.id) : draftOf(b, u.id, ctx)?.plan;
          if (p) plans[u.id] = p;
        }
      }
      const c = commit(b, policy === 'scripted' ? plans : null, ctx, { auto: policy !== 'scripted', scripted: policy === 'scripted' });
      if (c.record) {
        for (const u of Object.values(c.record.units)) u.auto = true;
        records.push(c.record);
      }
      events.push(...c.events);
      if (c.battle === b) break;
      b = c.battle;
      continue;
    }
    if (b.status === 'asking') {
      const r = answer(b, true, ctx);
      events.push(...r.events);
      b = r.battle;
      continue;
    }
    const s = step(b, ctx);
    events.push(...s.events);
    if (s.battle === b) break;
    b = s.battle;
  }
  return { battle: b, events, result: b?.result || null, records };
}

// ---------- B's stub minds ----------

function truncate(grid, unitId, path, budget) {
  if (!path) return null;
  // The longest prefix that fits the budget and ends on a free tile (a path may pass through a dozing ally).
  for (let n = path.length; n > 0; n -= 1) {
    const prefix = path.slice(0, n);
    const w = grid.walk(unitId, prefix);
    if (w && w.cost <= budget) return prefix;
  }
  return [];
}

/** A plain plan: strike the nearest foe in reach and sight, else stride until it can, then strike. */
export function simplePlan(battle, unitId, ctx, { by = 'foe' } = {}) {
  const u = unitIn(battle, unitId);
  const empty = { unitId, slots: [], reactions: {}, by, changed: [] };
  if (!u || !standing(u)) return empty;
  // Foes it can see first; an Unseen one only when that's all there is (attacks on it are −2).
  const all = battle.units.filter((v) => standing(v) && v.side !== u.side && v.side !== 'neutral');
  const seen = all.filter((v) => !hasCond(v, 'unseen'));
  const foes = seen.length ? seen : all;
  if (!foes.length) return { ...empty, slots: [{ id: 'brace', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null }] };
  const grid = createGrid(battle, ctx.rules);
  const near = [...foes].sort((a, b) => unitDist(u, a) - unitDist(u, b) || battle.order.indexOf(a.id) - battle.order.indexOf(b.id))[0];
  const strike = { id: 'strike', ability: null, cost: 1, target: { unit: near.id }, extra: 0, choice: null, cheer: false, trigger: null };
  const brace = { id: 'brace', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null };
  if (canStrike(grid, u, near)) return { ...empty, slots: [strike, strike, brace] };
  if (hasCond(u, 'tangled')) return { ...empty, slots: [brace] };
  const speed = speedOf(battle, u, ctx, { stride: true });
  const best = grid.approach(u.id, near.id);
  const first = truncate(grid, u.id, best, speed);
  if (!first || !first.length) return { ...empty, slots: [brace] };
  const stride = { id: 'stride', ability: null, cost: 1, target: { path: first }, extra: 0, choice: null, cheer: false, trigger: null };
  const end = first[first.length - 1];
  const moved = { ...u, x: end.x, y: end.y };
  const moved2 = { ...battle, units: battle.units.map((v) => (v.id === u.id ? moved : v)) };
  const g2 = createGrid(moved2, ctx.rules);
  if (canStrike(g2, moved, near)) return { ...empty, slots: [stride, strike, strike] };
  const rest = best.slice(first.length);
  const second = truncate(g2, u.id, rest, speed);
  const slots = [stride];
  if (second && second.length) slots.push({ ...stride, target: { path: second } });
  slots.push(strike);
  return { ...empty, slots };
}

/**
 * B's stub Minds (§6.6): plain telegraphs from the plan, 16 zero bytes, null choices, no
 * improvising or feints; foes and drafts follow simplePlan. Pass { foePlan, draft } to script them.
 */
export function stubMinds(ctx, { foePlan = null, draft = null } = {}) {
  return {
    foePlan: (battle, unitId) => (foePlan ? foePlan(battle, unitId) : null) || simplePlan(battle, unitId, ctx, { by: 'foe' }),
    telegraphs: (battle, unitId, plan) => plainTelegraphs(battle, unitId, plan, ctx),
    draft: (battle, unitId) => {
      const custom = draft ? draft(battle, unitId) : null;
      if (custom) return custom;
      const plan = { ...simplePlan(battle, unitId, ctx, { by: 'draft' }), by: 'draft' };
      return { unitId, plan, confidence: 35, source: 'personality', why: [], choices: [] };
    },
    situation: () => new Uint8Array(16),
    choices: (battle, unitId, plan) => (plan?.slots || []).map(() => null),
    improvise: () => null,
    revise: () => null,
  };
}

// ---------- saving and restoring (§5.4; battle.js exports these) ----------
//
// A BattleSave keeps §5.4's top-level fields, compact inside, since only restoreBattle reads it:
// - a unit leaves out each field at its default (0, false, null, 'right', an empty list or map, an
//   all-zero carry). Conditions are [id, n, source, data], with a '+' before the id when it landed
//   this round (data.fresh); marks are [id, by, n, until]; mods [stat, by, until, source]. Trailing
//   nulls are dropped, and `until` is its index in UNTIL (a 'rounds:<n>' stays a string);
// - a spawned foe's static spec is saved once, and a later one with the same spec says `like`;
// - surfaces are three strings over the arena, one base-36 character a tile: the surface's index
//   in SURFACE_IDS, its rounds and its level ('.' for no surface, no rounds, or the fight's level);
// - a plan leaves out its unit id, empty reactions and an all-false `changed` (else a '0'/'1'
//   string), and each action leaves out the fields at their defaults.

const STATIC_SKIP = new Set(['x', 'y', 'facing', 'integrity', 'maxIntegrity', 'heat', 'buffer', 'conditions', 'marks', 'mods', 'offline', 'drops',
  'sorted', 'reactionUsed', 'attacks', 'examined', 'revealedUntil', 'usedRound', 'uses', 'rattled', 'carry']);
const UNIT_DEFAULTS = {
  facing: 'right', strikeAmount: 0, heat: 0, buffer: 0, offline: false, drops: 0, sorted: null, reactionUsed: false, attacks: 0,
  examined: false, revealedUntil: null, chargesLeft: 0, rattled: false,
};
const STATUSES = ['planning', 'running', 'asking', 'won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home'];
const MODES = ['storybook', 'long-road', 'mauds-table'];

const isInt = (v, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo = -1e9, hi = 1e9) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length <= 200;
const orNull = (v) => (v === undefined ? null : v);
const numbersIn = (m) => isMap(m) && Object.values(m).every((v) => isNum(v));

function trimNulls(list) {
  let n = list.length;
  while (n > 0 && (list[n - 1] === null || list[n - 1] === undefined)) n -= 1;
  return list.slice(0, n);
}
const untilOut = (u) => (UNTIL.indexOf(u) >= 0 ? UNTIL.indexOf(u) : u);
const untilIn = (v) => (isInt(v, 0, UNTIL.length - 1) ? UNTIL[v] : isStr(v) ? v : undefined);
const emptyCarry = (c) => Object.values(c || {}).every((v) => v === 0 || (Array.isArray(v) && !v.length));

function condOut(c) {
  const { fresh, ...rest } = c.data || {};
  const data = !c.data || (fresh && !Object.keys(rest).length) ? null : rest;
  return trimNulls([`${fresh ? '+' : ''}${c.id}`, orNull(c.n), orNull(c.source), data]);
}
function condIn(v) {
  if (!Array.isArray(v) || !isStr(v[0])) return null;
  const fresh = v[0].startsWith('+');
  const id = fresh ? v[0].slice(1) : v[0];
  const n = orNull(v[1]);
  const data = orNull(v[3]);
  if (!CONDITION_IDS.includes(id) || (n !== null && !isInt(n)) || (v[2] != null && !isStr(v[2])) || (data !== null && !isMap(data))) return null;
  return { id, n, source: orNull(v[2]), data: fresh ? { ...plain(data || {}), fresh: true } : plain(data) };
}
const markOut = (m) => [m.id, m.by, m.n, untilOut(m.until)];
function markIn(v) {
  if (!Array.isArray(v) || !isStr(v[0]) || !isStr(v[1]) || !isNum(v[2]) || untilIn(v[3]) === undefined) return null;
  return { id: v[0], by: v[1], n: v[2], until: untilIn(v[3]) };
}
const modOut = (m) => trimNulls([m.stat, m.by, untilOut(m.until), orNull(m.source)]);
function modIn(v) {
  if (!Array.isArray(v) || !isStr(v[0]) || !isNum(v[1]) || untilIn(v[2]) === undefined || (v[3] != null && !isStr(v[3]))) return null;
  return { stat: v[0], by: v[1], until: untilIn(v[2]), source: orNull(v[3]) };
}

function staticSpec(u) {
  const out = {};
  for (const [k, v] of Object.entries(u)) if (!STATIC_SKIP.has(k)) out[k] = plain(v);
  return out;
}

function unitOut(u, spawned) {
  const out = { id: u.id, x: u.x, y: u.y, integrity: u.integrity, maxIntegrity: u.maxIntegrity };
  const dyn = {
    facing: u.facing, strikeAmount: u.strike?.amount ?? 0, heat: u.heat, buffer: u.buffer, offline: u.offline, drops: u.drops, sorted: u.sorted,
    reactionUsed: u.reactionUsed, attacks: u.attacks, examined: u.examined, revealedUntil: u.revealedUntil, chargesLeft: u.charges?.left ?? 0,
    rattled: !!u.rattled,
  };
  for (const [k, v] of Object.entries(dyn)) if (v !== undefined && v !== UNIT_DEFAULTS[k]) out[k] = v;
  if (u.conditions?.length) out.conditions = u.conditions.map(condOut);
  if (u.marks?.length) out.marks = u.marks.map(markOut);
  if (u.mods?.length) out.mods = u.mods.map(modOut);
  if (u.usedRound && Object.keys(u.usedRound).length) out.usedRound = plain(u.usedRound);
  if (u.uses && Object.keys(u.uses).length) out.uses = plain(u.uses);
  if (!emptyCarry(u.carry)) out.carry = plain(u.carry);
  if (u.rank === 'device') out.spawn = { template: u.kind, by: u.by };
  else if (/^s\d+$/.test(u.id)) {
    const spec = staticSpec(u);
    const key = JSON.stringify({ ...spec, id: null });
    if (spawned.has(key)) out.spawn = { foe: u.kind, like: spawned.get(key) };
    else {
      spawned.set(key, u.id);
      out.spawn = { foe: u.kind, spec };
    }
  }
  return out;
}

function actionOut(a) {
  const out = { id: a.id };
  const n = normaliseAction({ id: a.id });
  for (const k of ['ability', 'cost', 'target', 'extra', 'choice', 'cheer', 'trigger']) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(n[k] ?? null)) out[k] = plain(a[k]);
  }
  return out;
}
function planOut(p) {
  const out = { by: p.by, slots: (p.slots || []).map(actionOut) };
  if (p.reactions && Object.keys(p.reactions).length) out.reactions = plain(p.reactions);
  if ((p.changed || []).some(Boolean)) out.changed = p.changed.map((c) => (c ? '1' : '0')).join('');
  return out;
}
function planIn(id, p) {
  if (!isMap(p) || !Array.isArray(p.slots) || p.slots.length > 4 || !isStr(p.by)) return null;
  const slots = p.slots.map((a) => (isMap(a) ? normaliseAction(a) : null));
  if (slots.some((a) => !a)) return null;
  if (p.reactions !== undefined && !isMap(p.reactions)) return null;
  if (p.changed !== undefined && !(isStr(p.changed) && /^[01]*$/.test(p.changed) && p.changed.length === slots.length)) return null;
  const changed = p.changed ? [...p.changed].map((c) => c === '1') : slots.map(() => false);
  return { unitId: id, slots, reactions: plain(p.reactions || {}), by: p.by, changed };
}

/** §5.4: a Battle's dynamic fields, compact, for expedition.battle (restoreBattle rebuilds the rest). */
export function saveBattle(b) {
  const running = b.status === 'running' || b.status === 'asking';
  const { w, h, x: rx, y: ry } = b.arena.rect;
  const grid = new Array(w * h).fill('.');
  const rounds = new Array(w * h).fill('.');
  const levels = new Array(w * h).fill('.');
  for (const s of b.surfaces || []) {
    const i = (s.y - ry) * w + (s.x - rx);
    const index = SURFACE_IDS.indexOf(s.id);
    if (s.x < rx || s.x >= rx + w || i < 0 || i >= grid.length || index < 0) continue;
    grid[i] = index.toString(36);
    if (s.rounds !== null && s.rounds !== undefined) rounds[i] = Math.max(0, Math.min(35, s.rounds)).toString(36);
    if (s.level !== b.level) levels[i] = Math.max(0, Math.min(35, s.level)).toString(36);
  }
  const strip = (list) => (list.every((c) => c === '.') ? '' : list.join(''));
  const spawned = new Map();
  return {
    v: 2, id: b.id, seed: b.seed, attempt: b.attempt, k: b.k, round: b.round, tick: b.tick, cursor: b.cursor, status: b.status,
    mode: b.mode, modeNext: b.modeNext, calm: plain(b.calm), firstLead: b.firstLead, roadLevel: b.roadLevel, warding: b.warding,
    levels: Object.fromEntries(b.units.filter((u) => u.side === 'party' && u.rank === 'hero').map((u) => [u.id, u.level])),
    units: b.units.map((u) => unitOut(u, spawned)),
    order: [...b.order],
    objects: (b.objects || []).map((o) => {
      const out = { id: o.id, state: o.state };
      if (o.integrity !== null && o.integrity !== undefined) out.integrity = o.integrity;
      if (o.by) out.spawn = { kind: o.kind, x: o.x, y: o.y, flags: [...(o.flags || [])], by: o.by };
      return out;
    }),
    surfaces: { grid: grid.join(''), rounds: strip(rounds), levels: strip(levels) },
    lights: plain(b.lights), sustained: plain(b.sustained), talk: plain(b.talk), cheers: b.cheers,
    plans: running ? Object.fromEntries(Object.entries(b.plans || {}).map(([id, p]) => [id, planOut(p)])) : null,
    drafted: plain(b.drafted), lead: plain(b.lead), seen: plain(b.seen), memory: plain(b.memory),
    log: [...b.log], ask: plain(b.ask), result: plain(b.result), auto: !!b.auto,
    // The standoff count (§18.2), left out at 0.
    ...(b.quiet ? { quiet: b.quiet } : {}),
    // §18.3: Ask answers waiting for their entry's replay, and the words the running round's telegraphs hold.
    ...(b.answers ? { answers: plain(b.answers) } : {}),
    ...(running ? heldOut(b) : {}),
  };
}

/**
 * §18.3: what a running round's telegraphs hold that the minds can't rebuild from the Battle: each
 * unit's eye (`eye`: { unitId: words }) and each Void lie (`lies`: [unitId, slot, false target], plus
 * the targets shown when they aren't the plan's). Left out when there are none.
 */
function heldOut(b) {
  const eye = {};
  const lies = [];
  for (const t of b.telegraphs || []) {
    if (t.adapting && !(t.unitId in eye)) eye[t.unitId] = t.adapting;
    if (!t.falseTarget) continue;
    const lie = [t.unitId, t.slot, t.falseTarget];
    const shown = [...(t.targets || [])];
    if (JSON.stringify(shown) !== JSON.stringify(targetsOf(b.plans?.[t.unitId]?.slots?.[t.slot]))) lie.push(shown);
    lies.push(lie);
  }
  return { ...(Object.keys(eye).length ? { eye } : {}), ...(lies.length ? { lies } : {}) };
}

/**
 * The telegraphs restoreBattle hands the minds as the ones being replaced (what `telegraphsOf` holds
 * the eye's words and Void lies from while a round runs): the plain telegraphs, carrying the saved
 * words and lies. Null for anything it can't trust.
 */
function heldIn(b, ctx, s) {
  const ids = new Set(b.units.map((u) => u.id));
  if (s.eye !== undefined && !(isMap(s.eye) && Object.entries(s.eye).every(([id, w]) => ids.has(id) && isStr(w)))) return null;
  const okLie = (l) => Array.isArray(l) && (l.length === 3 || l.length === 4) && ids.has(l[0]) && isInt(l[1], 0, 3) && ids.has(l[2])
    && (l.length === 3 || (Array.isArray(l[3]) && l[3].length <= 16 && l[3].every((id) => ids.has(id))));
  if (s.lies !== undefined && !(Array.isArray(s.lies) && s.lies.length <= 48 && s.lies.every(okLie))) return null;
  const lies = new Map((s.lies || []).map((l) => [`${l[0]}:${l[1]}`, l]));
  const out = [];
  for (const id of b.order) {
    const u = unitIn(b, id);
    if (!u || u.side !== 'foe' || !standing(u) || !b.plans[id]) continue;
    for (const t of plainTelegraphs(b, id, b.plans[id], ctx)) {
      const lie = lies.get(`${id}:${t.slot}`);
      out.push({ ...t, adapting: s.eye?.[id] ?? null, falseTarget: lie ? lie[2] : null, targets: lie?.[3] ? [...lie[3]] : t.targets });
    }
  }
  return out;
}

/** §18.3: Ask answers are { unitId: { reactionId: 0 | 1 } }, only while a round runs. */
function okAnswers(s, ids) {
  if (s.answers === undefined) return true;
  if (!(s.status === 'running' || s.status === 'asking') || !isMap(s.answers)) return false;
  return Object.entries(s.answers).every(([id, m]) => ids.has(id) && isMap(m) && Object.values(m).every((v) => v === 0 || v === 1));
}

function inferCreationShift(save, fight, rules) {
  const byId = new Map((fight.foes || []).map((f) => [f.id, f]));
  if (fight.leadUnit) byId.set('lead', fight.leadUnit);
  const shifts = save.firstLead ? [rules.modes.storybook.foeLevel] : [...new Set(['long-road', 'mauds-table', 'storybook'].map((m) => rules.modes[m].foeLevel))];
  for (const shift of shifts) {
    let ok = true;
    for (const su of save.units) {
      const spec = byId.get(su.id);
      if (!spec || !spec.strike) continue;
      const u = plain(spec);
      scaleFoe(u, rules, shift);
      if (u.strike.amount !== (su.strikeAmount ?? 0)) {
        ok = false;
        break;
      }
    }
    if (ok) return shift;
  }
  return null;
}

/** Whether a save's top-level fields can be trusted: enums, whole numbers in range, and shapes (§5.4). */
function trustTop(s, rules, fight, heroes) {
  if (!isInt(s.attempt) || !isInt(s.k) || !isInt(s.round, 1, 9999) || !isInt(s.tick, 0, 4) || !isInt(s.cursor, 0, 999)) return false;
  if (!STATUSES.includes(s.status) || !MODES.includes(s.mode) || !(s.modeNext === null || s.modeNext === 'storybook')) return false;
  if (!isMap(s.calm) || typeof s.calm.noise !== 'boolean' || typeof s.calm.adaptation !== 'boolean') return false;
  if (typeof s.firstLead !== 'boolean' || typeof s.auto !== 'boolean') return false;
  if (s.quiet !== undefined && !isInt(s.quiet, -1, 99)) return false;
  if (!isInt(s.roadLevel, 1, 99) || !isInt(s.warding, 0, 99) || !isInt(s.cheers, 0, rules.cheers?.max ?? 4)) return false;
  const running = s.status === 'running' || s.status === 'asking';
  if (running && s.tick < 1) return false;
  if (s.status === 'planning' && (s.tick !== 0 || s.cursor !== 0)) return false;
  if ((s.status === 'asking') !== isMap(s.ask)) return false;
  if (s.ask !== null && !(isMap(s.ask) && isStr(s.ask.unitId) && isStr(s.ask.reactionId))) return false;
  if (TERMINAL.has(s.status) !== isMap(s.result)) return false;
  if (!isMap(s.levels) || !isMap(s.talk) || !numbersIn(s.seen) || !isMap(s.drafted) || !(s.memory === null || isMap(s.memory))) return false;
  if (!Array.isArray(s.log) || s.log.length > 30 || !s.log.every((l) => typeof l === 'string')) return false;
  for (const t of Object.values(s.talk)) if (!isMap(t) || !isInt(t.calm) || !isInt(t.need, 1, 99) || typeof t.done !== 'boolean') return false;
  const okLight = (l) => isMap(l) && isStr(l.id) && isInt(l.x, -999, 9999) && isInt(l.y, -999, 9999) && isInt(l.radius, 0, 99) && (l.rounds === null || isInt(l.rounds, 0, 999));
  if (!Array.isArray(s.lights) || s.lights.length > (rules.lights?.max ?? 24) || !s.lights.every(okLight)) return false;
  const okSustained = (x) => isMap(x) && isStr(x.unitId) && isStr(x.abilityId) && isInt(x.rounds, 0, 99) && isInt(x.cost, 0, 3);
  if (!Array.isArray(s.sustained) || s.sustained.length > 8 || !s.sustained.every(okSustained)) return false;
  if (!Array.isArray(s.objects) || s.objects.length > 24 || !s.objects.every((o) => isMap(o) && isStr(o.id) && isStr(o.state))) return false;
  if (!Array.isArray(s.units) || !s.units.length || s.units.length > 16 || !Array.isArray(s.order) || s.order.length !== s.units.length) return false;
  const ids = new Set(s.units.map((u) => (isMap(u) && isStr(u.id) ? u.id : null)));
  if (ids.has(null) || ids.size !== s.units.length || !s.order.every((id) => ids.has(id)) || new Set(s.order).size !== s.order.length) return false;
  // The heroes are exactly the saved ones, built at the levels they fought at.
  const heroIds = Object.keys(s.levels);
  if (heroes.length !== heroIds.length || heroes.some((hs) => !hs || s.levels[hs.id] !== hs.level || !ids.has(hs.id))) return false;
  if (fight.leadUnit) {
    const l = s.lead;
    if (!isMap(l) || !Array.isArray(l.bars) || !l.bars.length || l.bars.length > 3 || !l.bars.every((x) => isInt(x, 1)) || !isInt(l.bar, 0, l.bars.length - 1)) return false;
    if (!isStr(l.phase) || typeof l.armourUsed !== 'boolean' || !isInt(l.feintsLeft, 0, 9) || !isInt(l.asides) || !isMap(l.bow) || !isMap(l.data)) return false;
  } else if (s.lead !== null) return false;
  return true;
}

/** A saved unit's dynamic fields over a unit built from its spec; false for anything it can't trust. */
function restoreUnit(u, su, arena) {
  const r = arena.rect;
  const d = { ...UNIT_DEFAULTS, ...su };
  if (!isInt(d.x, r.x, r.x + r.w - 1) || !isInt(d.y, r.y, r.y + r.h - 1) || !isInt(d.maxIntegrity, 1) || !isInt(d.integrity, 0, d.maxIntegrity)) return false;
  if (!isNum(d.heat, 0, 100) || !isNum(d.buffer, 0) || !isInt(d.drops, 0, 99) || !isInt(d.attacks, 0, 99) || !isInt(d.chargesLeft, 0, 99) || !isInt(d.strikeAmount, 0)) return false;
  if (!['left', 'right'].includes(d.facing) || ![null, 'settled', 'talked', 'bowed'].includes(d.sorted) || ![null, 'end-of-round', 'fight'].includes(d.revealedUntil)) return false;
  if (!['offline', 'reactionUsed', 'examined', 'rattled'].every((k) => typeof d[k] === 'boolean')) return false;
  const conditions = (su.conditions || []).map(condIn);
  const marks = (su.marks || []).map(markIn);
  const mods = (su.mods || []).map(modIn);
  if (!Array.isArray(su.conditions || []) || conditions.length > 8 || conditions.some((c) => !c)) return false;
  if (!Array.isArray(su.marks || []) || marks.length > 4 || marks.some((m) => !m)) return false;
  if (!Array.isArray(su.mods || []) || mods.length > 6 || mods.some((m) => !m)) return false;
  if (!numbersIn(su.usedRound || {}) || !numbersIn(su.uses || {}) || (su.carry !== undefined && !isMap(su.carry))) return false;
  const carry = su.carry ? plain(su.carry) : Object.fromEntries(Object.entries({ ...EMPTY_CARRY(), ...(u.carry || {}) }).map(([k, v]) => [k, Array.isArray(v) ? [] : 0]));
  Object.assign(u, {
    x: d.x, y: d.y, facing: d.facing, integrity: d.integrity, maxIntegrity: d.maxIntegrity, heat: d.heat, buffer: d.buffer, conditions, marks, mods,
    offline: d.offline, drops: d.drops, sorted: d.sorted, reactionUsed: d.reactionUsed, attacks: d.attacks, examined: d.examined,
    revealedUntil: d.revealedUntil, usedRound: plain(su.usedRound || {}), uses: plain(su.uses || {}), rattled: d.rattled, carry,
  });
  if (u.strike) u.strike = { ...u.strike, amount: d.strikeAmount };
  if (u.charges) u.charges = { ...u.charges, left: d.chargesLeft };
  return true;
}

/** §5.4: a Battle from a BattleSave, the FightSpec and the heroes; null for anything it can't trust. */
export function restoreBattle(save, ctx, { fight, heroes } = {}) {
  try {
    if (!isMap(save) || save.v !== 2 || !fight || save.id !== fight.id || !isInt(save.seed, 0, 0xffffffff) || save.seed !== (fight.seed >>> 0)) return null;
    if (!Array.isArray(heroes) || !Array.isArray(save.units)) return null;
    const rules = ctx.rules;
    if (!trustTop(save, rules, fight, heroes)) return null;
    const shift = inferCreationShift(save, fight, rules);
    if (shift === null) return null;
    const specs = new Map();
    for (const hs of heroes) specs.set(hs.id, plain(hs));
    for (const f of fight.foes || []) specs.set(f.id, plain(f));
    if (fight.leadUnit) specs.set('lead', plain(fight.leadUnit));
    const arena = fight.arena;
    const b = {
      v: 1, id: save.id, seed: save.seed >>> 0, attempt: save.attempt, k: save.k, round: save.round, tick: save.tick, cursor: save.cursor,
      status: save.status, mode: save.mode, modeNext: save.modeNext, calm: plain(save.calm), firstLead: save.firstLead,
      roadLevel: save.roadLevel, warding: save.warding, kind: fight.kind, level: fight.level, genres: [...(fight.genres || [])],
      affixes: [...(fight.affixes || [])], sight: fight.sight, weight: fight.weight, real: fight.real ? plain(fight.real) : null, arena,
      units: [], order: [...save.order], objects: [], surfaces: [], lights: plain(save.lights), sustained: plain(save.sustained),
      talk: plain(save.talk), cheers: save.cheers, plans: {}, telegraphs: [], drafted: plain(save.drafted), schedule: null,
      lead: plain(save.lead), seen: plain(save.seen), memory: plain(save.memory), log: [...save.log], ask: plain(save.ask),
      result: plain(save.result), auto: save.auto, quiet: save.quiet ?? 0,
    };
    const run = { b, ctx, rules, events: [], g: null, scratch: {} };
    const spawnedSpecs = new Map();
    for (const su of save.units) {
      let spec = specs.get(su.id);
      const sp = su.spawn;
      if (sp !== undefined && !isMap(sp)) return null;
      if (!spec && sp?.template) {
        const maker = b.units.find((x) => x.id === sp.by) || specs.get(sp.by);
        if (!maker || !rules.devices?.[sp.template]) return null;
        spec = deviceSpec(run, { ...maker, id: sp.by }, sp.template, { x: su.x, y: su.y });
        spec.id = su.id;
      } else if (!spec && sp?.like) {
        const like = spawnedSpecs.get(sp.like);
        if (!like) return null;
        spec = { ...plain(like), id: su.id };
      } else if (!spec && isMap(sp?.spec)) spec = { ...plain(sp.spec), id: su.id };
      if (!spec) return null;
      if (sp?.spec) spawnedSpecs.set(su.id, sp.spec);
      const u = unitFrom(spec, { x: 0, y: 0 }, 'right');
      if (spec.id !== 'lead' && !sp) scaleFoe(u, rules, u.side === 'foe' || u.side === 'neutral' ? shift : 0);
      if (spec.id === 'lead') scaleFoe(u, rules, shift);
      if (!restoreUnit(u, su, arena)) return null;
      if (spec.id === 'lead' && u.lead && b.lead) u.lead = { ...u.lead, bars: [...b.lead.bars] };
      b.units.push(u);
    }
    // Objects: the FightSpec's with their saved states, then the ones the fight made.
    const specObjects = new Map((fight.objects || []).map((o) => [o.id, o]));
    for (const so of save.objects) {
      if (so.spawn) {
        const sp = so.spawn;
        if (!isMap(sp) || !isStr(sp.kind) || !isInt(sp.x) || !isInt(sp.y) || !Array.isArray(sp.flags) || !isStr(sp.by)) return null;
        b.objects.push({ id: so.id, kind: sp.kind, x: sp.x, y: sp.y, state: so.state, flags: [...sp.flags], integrity: orNull(so.integrity), by: sp.by });
        continue;
      }
      const o = specObjects.get(so.id);
      if (!o) return null;
      const obj = { ...plain(o), state: so.state, integrity: so.integrity ?? o.integrity ?? null };
      if (o.kind === 'prop' && so.state === 'rubble') {
        obj.flags = (o.flags || []).filter((f) => f !== 'hazard' && f !== 'cover-high').concat((o.flags || []).includes('cover-low') ? [] : ['cover-low']);
      }
      b.objects.push(obj);
    }
    // Surfaces from the three strings.
    const { w, h, x: rx, y: ry } = arena.rect;
    const sf = save.surfaces;
    if (!isMap(sf) || !isStr0(sf.grid, w * h) || !isStr0(sf.rounds, w * h, true) || !isStr0(sf.levels, w * h, true)) return null;
    for (let i = 0; i < sf.grid.length; i += 1) {
      if (sf.grid[i] === '.') continue;
      const id = SURFACE_IDS[parseInt(sf.grid[i], 36)];
      const rc = sf.rounds ? sf.rounds[i] : '.';
      const lc = sf.levels ? sf.levels[i] : '.';
      if (!id || (rc !== '.' && Number.isNaN(parseInt(rc, 36))) || (lc !== '.' && Number.isNaN(parseInt(lc, 36)))) return null;
      b.surfaces.push({ x: rx + (i % w), y: ry + Math.floor(i / w), id, rounds: rc === '.' ? null : parseInt(rc, 36), level: lc === '.' ? fight.level : parseInt(lc, 36) });
    }
    b.surfaces.sort((p, q) => p.y - q.y || p.x - q.x);
    if (b.status === 'running' || b.status === 'asking') {
      if (!isMap(save.plans)) return null;
      for (const [id, p] of Object.entries(save.plans)) {
        const plan = specs.has(id) || b.units.some((u) => u.id === id) ? planIn(id, p) : null;
        if (!plan) return null;
        b.plans[id] = plan;
      }
      const entries = decodeSchedule(b);
      if (b.cursor > entries.length || entries.some((e) => !b.plans[e.unitId]?.slots?.[e.slot] || !isInt(e.tick, 1, 4))) return null;
      b.schedule = scheduleOut(entries);
    } else if (b.status === 'planning') {
      foePlans({ b, ctx, rules, events: [], g: null, scratch: {} });
    } else if (save.plans !== null) return null;
    if (b.sustained.some((x) => !b.units.some((u) => u.id === x.unitId))) return null;
    if (!okAnswers(save, new Set(b.units.map((u) => u.id)))) return null;
    if (save.answers !== undefined) b.answers = plain(save.answers);
    // A running round's telegraphs hold the eye's words and Void lies from planning (§18.3).
    const running = b.status === 'running' || b.status === 'asking';
    if (!running && (save.eye !== undefined || save.lies !== undefined)) return null;
    if (running) {
      b.telegraphs = heldIn(b, ctx, save);
      if (!b.telegraphs) return null;
    }
    b.telegraphs = TERMINAL.has(b.status) ? [] : buildTelegraphs(b, ctx);
    return deepFreeze(b);
  } catch {
    return null;
  }
}

/** A string of exactly `n` characters (or, when `empty` is allowed, ''). */
function isStr0(v, n, empty = false) {
  return typeof v === 'string' && (v.length === n || (empty && v === ''));
}
