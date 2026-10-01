// The battle (CONTRACT-PHASE4.md §5.4–§5.9, §6.6, §7.1; COMBAT.md §3): creating a fight, the one
// reducer (`apply`), the round's lifecycle (plan, commit, step, tick and round ends), the basic
// actions, what every Tale-lead shares, sneaking, and saving and restoring. Pure: `apply` never
// mutates its input and replays exactly from the same commands.
import { hashInts, unit as unit01 } from '../world/rng.js';
import { barsFor, clampHeat, drift as driftHeat, expected } from './heat.js';
import { strayRow, STANDOFF_ROUNDS } from './rules.js';
import { createGrid, dist, footprint, unitDist } from './grid.js';
import {
  ticksOf, buildSchedule, plainTelegraphs, noiseGenres, noiseExempt, NOISE_FLAGS, unitIn, standing, hasCond, condOf, asleep, ability,
  effMode, roomLevel, idleHeatOf, hasRule, hooklight, modSum, speedOf, oddsAgainst, roomHeat, setSurface, surfaceOn, moveAlong, ribbon,
  interact, doThrow, doShove, spookSource, numOf, BASIC_COST, inEntry,
} from './round.js';
import {
  makeRun, cloneBattle, deepFreeze, emit, gridOf, dirty, U, adopt, hook, mechanicOf, setHeat, syncLantern, addMod, addMark, consumeUntil,
  endCondition, pickOutcome, landHit, rebootUnit, sortUnit, removeUnit, doStrike, doBrace, doHide, doSeek, doStride, doStep, strikeReach, canStep,
  useAbility, AskSignal, viewOf, summonDevice, deviceSpec, carrierOf, addCalm, endSustained, feintsFor, canHide, SURFACE_IDS, nextId,
  jsonCopy, leadStep, ghostInDark, flushLight,
} from './effects.js';
import { specFor, talkTargets, abilityWhy, choiceWhy, unitTargets, costsOf, dimTile, tileHolds, canonBow, talkNeed } from './abilities.js';
import { logLines, actionWords, thoughtText, thoughtWords, summary as summaryText, examineLine } from './describe.js';

const TERMINAL = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);
const plain = (v) => (v === undefined ? null : jsonCopy(v));

function freezeOut(b) {
  return deepFreeze(b);
}

// ---------- creation ----------

const EMPTY_CARRY = () => ({ cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] });

function unitFrom(spec, at, facing) {
  const u = plain(spec);
  u.x = at?.x ?? 0;
  u.y = at?.y ?? 0;
  u.facing = facing;
  u.heat = 0;
  u.buffer = 0;
  u.conditions = [];
  u.marks = [];
  u.mods = [];
  u.offline = u.side === 'party' && u.rank === 'hero' && (u.integrity ?? 1) <= 0;
  u.drops = 0;
  u.sorted = null;
  u.reactionUsed = false;
  u.attacks = 0;
  u.examined = false;
  u.revealedUntil = null;
  u.usedRound = {};
  u.carry = { ...EMPTY_CARRY(), ...(u.carry || {}) };
  u.uses = u.uses || {};
  u.reactions = u.reactions || {};
  return u;
}

function freeTile(battle, near, used, unit) {
  const grid = createGrid(battle);
  for (let r = 0; r <= 4; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const t = { x: near.x + dx, y: near.y + dy };
        if (used.has(`${t.x},${t.y}`)) continue;
        if (grid.blocksMove(t.x, t.y, unit)) continue;
        return t;
      }
    }
  }
  return near;
}

function scaleFoe(u, rules, shift) {
  if (!shift || (u.side !== 'foe' && u.side !== 'neutral')) return;
  const from = u.level;
  const to = Math.max(0, from + shift);
  if (to === from) return;
  const ri = strayRow(rules, 'integrity', to) / strayRow(rules, 'integrity', from);
  const rs = strayRow(rules, 'strike', to) / strayRow(rules, 'strike', from);
  u.maxIntegrity = Math.max(1, Math.round(u.maxIntegrity * ri));
  u.integrity = Math.max(1, Math.round(u.integrity * ri));
  if (u.strike) u.strike = { ...u.strike, amount: Math.round(u.strike.amount * rs) };
  if (u.ranged) u.ranged = { ...u.ranged, amount: Math.round(u.ranged.amount * rs) };
  if (u.lead?.bars) u.lead = { ...u.lead, bars: u.lead.bars.map((b) => Math.max(1, Math.round(b * ri))) };
}

function ribbonOrder(battle, ctx) {
  const scored = battle.units.map((u, i) => ({
    id: u.id,
    i,
    score: (u.speed || 0) + (u.abilities?.grace || 0) + 2 * unit01(hashInts(battle.seed, i, 'init')) + modSum(battle, u, 'initiative', ctx),
  }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.id);
}

/**
 * §7.1: a Battle from a FightSpec and the heroes (Milo first), in round 1's planning: heroes on
 * the entry tiles (or an ambush placement), idle heat, the mode's creation effects, surprise, sneak,
 * the doorway calm, the Hooklight, passive summons, the mechanic's setup, foe plans and telegraphs.
 */
export function createBattle(fight, heroes, options = {}, ctx) {
  const {
    attempt = 0, mode = 'long-road', calm = { noise: true, adaptation: true }, cheers = 0, firstLead = false, sneak = null,
    roadLevel = 1, warding = 0, memory = null, talk = {}, placement = null,
  } = options || {};
  const rules = ctx.rules;
  const arena = fight.arena;
  const creationMode = firstLead ? 'storybook' : mode;
  const units = [];
  const used = new Set();
  const draft = { arena, units, objects: fight.objects || [], surfaces: [], lights: [] };
  const ambush = placement && sneak === 'unseen' && warding >= (rules.warding?.ambush ?? 30);
  heroes.forEach((spec, i) => {
    const formation = arena.entry?.[i] || arena.entry?.[0] || { x: arena.rect.x, y: arena.rect.y };
    let at = formation;
    const want = ambush ? placement[spec.id] : null;
    if (want && dist(want, formation) <= (rules.warding?.ambushRange ?? 3)) {
      const g = createGrid({ ...draft, units });
      if (!g.blocksMove(want.x, want.y, null) && !used.has(`${want.x},${want.y}`)) at = want;
    }
    if (used.has(`${at.x},${at.y}`)) at = freeTile({ ...draft, units }, at, used, null);
    used.add(`${at.x},${at.y}`);
    units.push(unitFrom(spec, at, 'right'));
  });
  for (const spec of fight.foes || []) {
    units.push(unitFrom(spec, spec.post || { x: arena.rect.x + arena.rect.w - 1, y: arena.rect.y }, 'left'));
  }
  if (fight.leadUnit) units.push(unitFrom(fight.leadUnit, fight.leadUnit.post || { x: arena.rect.x, y: arena.rect.y }, 'left'));
  const shift = rules.modes?.[creationMode]?.foeLevel ?? 0;
  for (const u of units) scaleFoe(u, rules, shift);
  const heroUnits = units.filter((u) => u.side === 'party');
  const b = {
    v: 1, id: fight.id, seed: fight.seed >>> 0, attempt, k: 0, round: 1, tick: 0, cursor: 0, status: 'planning',
    mode, modeNext: null, calm: { noise: calm?.noise !== false, adaptation: calm?.adaptation !== false }, firstLead: !!firstLead,
    roadLevel, warding, kind: fight.kind, level: fight.level, genres: [...(fight.genres || [])], affixes: [...(fight.affixes || [])],
    sight: fight.sight, weight: fight.weight, real: fight.real ? plain(fight.real) : null, arena,
    units, order: [], objects: plain(fight.objects || []),
    surfaces: [], lights: [], sustained: [], talk: {}, cheers: Math.max(0, Math.min(rules.cheers?.max ?? 4, cheers)),
    plans: {}, telegraphs: [], drafted: {}, schedule: null, lead: null, seen: {}, memory: memory ? plain(memory) : null, log: [], ask: null,
    // quiet: whole rounds in a row with nothing happening, −1 once something has this round (§18.2's standoff).
    result: null, auto: false, quiet: 0,
  };
  for (const s of fight.surfaces || []) {
    if (!SURFACE_IDS.includes(s.id)) continue;
    b.surfaces.push({ x: s.x, y: s.y, id: s.id, rounds: s.rounds ?? null, level: fight.level });
  }
  b.surfaces.sort((p, q) => p.y - q.y || p.x - q.x);
  for (const u of units) u.heat = idleHeatOf(b, u, rules);
  // The Hooklight, raised, and lit lamps and candles.
  const milo = heroUnits.find((u) => u.kind === 'milo' || hasRule(ctx, u, 'hooklight'));
  if (milo) b.lights.push({ id: 'hooklight', x: milo.x, y: milo.y, radius: rules.sight.lanternRaised + modSum(b, milo, 'light-radius', ctx), rounds: null, source: milo.id });
  for (const o of b.objects) {
    if ((o.kind === 'lamp' || o.kind === 'candle') && o.state === 'lit' && b.lights.length < (rules.lights?.max ?? 24)) {
      b.lights.push({ id: o.id, x: o.x, y: o.y, radius: rules.lights[o.kind], rounds: null, source: o.kind });
    }
  }
  // Talking down: one entry per kind, with any doorway calm already counted.
  const talked = Object.keys(talk || {}).length > 0;
  for (const u of units) {
    if (!u.talkKind || u.side !== 'foe' || b.talk[u.talkKind]) continue;
    const need = talkNeed(rules, u.temperament, heroUnits, canonBow(ctx.abilities, u.kind));
    b.talk[u.talkKind] = { calm: Math.max(0, Math.trunc(Number(talk?.[u.talkKind]) || 0)), need, done: false };
  }
  // Surprise and sneak (a doorway Talk down gives up any surprise).
  const surprised = !talked && (fight.surprised === 'foes' || sneak === 'unseen');
  for (const u of units) {
    if (u.side === 'foe' && surprised) u.mods.push({ stat: 'surprised', by: 1, until: 'end-of-round', source: 'surprise' });
    const t = rules.temperaments?.[u.temperament];
    if (u.side === 'foe' && t?.startsDrowsy && !(u.ignores || []).includes('drowsy')) u.conditions.push({ id: 'drowsy', n: t.startsDrowsy, source: null, data: null });
    if (u.side === 'party' && sneak === 'unseen') u.conditions.push({ id: 'unseen', n: null, source: null, data: null });
  }
  // The lead's shared state.
  const leadUnit = units.find((u) => u.id === 'lead');
  if (leadUnit && leadUnit.lead) {
    const bars = [...leadUnit.lead.bars];
    const names = rules.lead?.phaseNames?.[String(bars.length)] || (bars.length === 2 ? ['opening', 'last-page'] : ['opening', 'twist', 'last-page']);
    leadUnit.maxIntegrity = bars[0];
    leadUnit.integrity = bars[0];
    const step = leadStep(b, leadUnit, rules);
    b.lead = {
      unitId: 'lead', mechanic: fight.lead?.mechanic || leadUnit.lead.mechanic || 'fallback', phase: names[0], bar: 0, bars,
      armourUsed: false, feintsLeft: feintsFor(step, rules), asides: 0, bow: { progress: 0, need: 0 }, data: {},
    };
  }
  b.order = ribbonOrder(b, ctx);
  const run = makeRun(b, ctx);
  for (const [kind, t] of Object.entries(run.b.talk)) if (t.calm >= t.need) addCalm(run, run.b.units[0], kind, 0);
  for (const u of heroUnits) {
    for (const id of u.abilityIds || []) {
      const a = ability(ctx, id);
      for (const s of a?.passive?.summons || []) if (s.at === 'fight-start') summonDevice(run, u.id, s.template, null);
    }
  }
  // Ghosts in the dark start out of sight.
  for (const u of run.b.units) ghostInDark(run, u);
  const mech = mechanicOf(run);
  if (mech?.setup) adopt(run, mech.setup(run.b, ctx));
  // Round 1's start: gravity wells, a tremor and the bright strays' cheer (no drift or room heat yet).
  roundEffects(run);
  startPlanning(run);
  run.b.log = [];
  // Setting up isn't part of round 1: the standoff count starts clean.
  run.b.quiet = 0;
  return freezeOut(run.b);
}

// ---------- planning ----------

function foePlans(run) {
  const b = run.b;
  const minds = run.ctx.minds || {};
  for (const id of b.order) {
    const u = U(run, id);
    if (!u || u.side !== 'foe' || !standing(u) || u.rank === 'device') continue;
    const plan = minds.foePlan ? minds.foePlan(b, id) : null;
    b.plans[id] = plan ? normalisePlan(plan, id, 'foe', run.ctx, b) : { unitId: id, slots: [], reactions: {}, by: 'foe', changed: [] };
  }
}

/** Telegraphs: each foe's (through ctx.minds), the lead's own, and Guttering candles. */
export function buildTelegraphs(b, ctx) {
  const list = [];
  const minds = ctx.minds || {};
  for (const id of b.order) {
    const u = unitIn(b, id);
    if (!u || u.side !== 'foe' || !standing(u)) continue;
    const plan = b.plans?.[id];
    if (!plan) continue;
    const t = minds.telegraphs ? minds.telegraphs(b, id, plan) : plainTelegraphs(b, id, plan, ctx);
    for (const x of t || []) list.push(plain(x));
  }
  if (b.lead) {
    const mech = (ctx.mechanics || {})[b.lead.mechanic] || (ctx.mechanics || {}).fallback;
    if (mech?.telegraphs) for (const x of mech.telegraphs(b, ctx) || []) list.push(plain(x));
  }
  if (noiseGenres(b, ctx.rules).includes('gothic')) {
    const g = createGrid(b, ctx.rules);
    for (const t of list) if (!t.hidden && guttered(b, ctx, t, g)) t.hidden = true;
  }
  // §18.3: a hidden telegraph shows '?', so it carries none of the eye's words.
  for (const t of list) if (t.hidden) t.adapting = null;
  return list.slice(0, 48);
}

/** Guttering candles (§4.16): a telegraph still to come whose target tiles are all Dark. */
function guttered(b, ctx, t, g = createGrid(b, ctx.rules)) {
  if (!t.tiles?.length || (b.status !== 'planning' && t.tick <= b.tick)) return false;
  return t.tiles.every((p) => g.light(p.x, p.y) === 'D');
}

function startPlanning(run) {
  const b = run.b;
  b.status = 'planning';
  b.tick = 0;
  b.cursor = 0;
  b.schedule = null;
  b.plans = {};
  foePlans(run);
  b.telegraphs = buildTelegraphs(b, run.ctx);
}

const ACTION_IDS = new Set(['stride', 'step', 'strike', 'brace', 'examine', 'seek', 'interact', 'assist', 'talk-down', 'cool-down', 'reboot',
  'delay', 'hide', 'throw', 'shove', 'jump', 'dip', 'sustain', 'ready', 'head-home', 'use', 'aside']);

/** A basic action costs §4.4's actions whatever a plan claims (a Reboot 2, or 1 as a cheaper one claims); a use keeps its own. */
function normaliseAction(a) {
  if (!a || !ACTION_IDS.has(a.id)) return null;
  const cost = BASIC_COST[a.id] ?? (a.id === 'reboot' ? (a.cost === 1 ? 1 : 2) : Number.isFinite(a.cost) ? a.cost : 1);
  return {
    id: a.id, ability: a.ability ?? null, cost,
    target: a.target ? plain(a.target) : null, extra: a.extra || 0, choice: a.choice ?? null, cheer: !!a.cheer, trigger: a.trigger ?? null,
  };
}

/** A Reboot costs 2, or 1 when the Offline ally's own `reboot-cost` mods say so (Steady hand). */
const rebootCost = (b, v, ctx) => Math.max(1, 2 + Math.min(0, v ? modSum(b, v, 'reboot-cost', ctx) : 0));

/**
 * A use can be free (0 actions) only when its ability lists 0 (Burn an essence, Surge): an unlisted 0
 * counts as 1, so it takes its tick; any cost the ability doesn't list is refused as it resolves. A
 * Reboot costs what its ally's mods allow (with the battle to read them).
 */
function legalCost(a, ctx, battle = null) {
  if (a?.id === 'reboot' && battle && ctx && a.target?.unit) a.cost = rebootCost(battle, unitIn(battle, a.target.unit), ctx);
  if (!a || a.id !== 'use' || a.cost !== 0 || !ctx || String(a.ability || '').startsWith('mech:')) return a;
  const ab = ability(ctx, a.ability);
  if (!ab || !costsOf(ab).includes(0)) a.cost = 1;
  return a;
}

function normalisePlan(plan, unitId, by, ctx = null, battle = null) {
  const slots = (plan.slots || []).map(normaliseAction).filter(Boolean).slice(0, 4).map((a) => legalCost(a, ctx, battle));
  return {
    unitId,
    slots,
    reactions: { ...(plan.reactions || {}) },
    by: plan.by || by,
    changed: slots.map((_, i) => !!plan.changed?.[i]),
  };
}

// ---------- the schedule, saved in usedRound so a restore rebuilds it exactly ----------

const LATE_FLAGS = NOISE_FLAGS.lag | NOISE_FLAGS.backlog | NOISE_FLAGS.repeat;

function encodeSchedule(b, entries) {
  entries.forEach((e, pos) => {
    const u = unitIn(b, e.unitId);
    if (!u) return;
    const key = e.flags & NOISE_FLAGS.repeat ? `#r${e.slot}` : `#s${e.slot}`;
    u.usedRound = { ...(u.usedRound || {}), [key]: pos * 256 + e.tick * 32 + e.flags };
  });
}

function decodeSchedule(b) {
  const out = [];
  for (const u of b.units) {
    for (const [key, v] of Object.entries(u.usedRound || {})) {
      const m = /^#([sr])(\d+)$/.exec(key);
      if (!m) continue;
      const flags = v % 32;
      out.push({ pos: Math.floor(v / 256), unitId: u.id, slot: Number(m[2]), tick: Math.floor((v % 256) / 32), late: !!(flags & LATE_FLAGS), flags });
    }
  }
  out.sort((p, q) => p.pos - q.pos);
  return out;
}

const scheduleOut = (entries) => entries.map(({ unitId, slot, tick, late }) => ({ unitId, slot, tick, late }));

// ---------- commit ----------

function commitRound(run) {
  const b = run.b;
  const ctx = run.ctx;
  foePlansMissing(run);
  for (const u of b.units) {
    if (u.side === 'party' && standing(u) && u.rank !== 'device' && !b.plans[u.id]) b.plans[u.id] = { unitId: u.id, slots: [], reactions: {}, by: 'you', changed: [] };
  }
  shownHabits(run);
  // Cheers: spent now, one per cheered slot, never more than the party holds.
  const cheered = clampCheers(b);
  if (cheered) {
    b.cheers = Math.max(0, b.cheers - cheered);
    emit(run, { t: 'cheer', cheers: b.cheers });
  }
  if (Object.values(b.plans).some((p) => p.by === 'auto')) b.auto = true;
  // Lost slots.
  for (const id of b.order) {
    const u = U(run, id);
    const plan = b.plans[id];
    if (!u || !plan || !standing(u)) continue;
    for (const t of ticksOf(plan, u)) {
      if (t.lost) emit(run, { t: 'lost', unit: id, action: plain(plan.slots[t.slot]), why: t.lost });
    }
  }
  const entries = buildSchedule(b, ctx).map((e) => ({ ...e, late: !!(e.flags & LATE_FLAGS) || e.late }));
  encodeSchedule(b, entries);
  b.schedule = scheduleOut(entries);
  b.status = 'running';
  b.cursor = 0;
  // Tick 1 begins; ticks nobody acts in before the first action still end (surfaces, Asides, the bow).
  const first = entries.length ? entries[0].tick : 1;
  b.tick = 1;
  emit(run, { t: 'tick', tick: 1 });
  for (let t = 1; t < first; t += 1) {
    tickEnd(run, t);
    if (TERMINAL.has(b.status)) return;
    b.tick = t + 1;
    emit(run, { t: 'tick', tick: t + 1 });
  }
  tickStart(run, b.tick, true);
  b.telegraphs = buildTelegraphs(b, ctx);
  sendTelegraphs(run);
  // Guttering candles: each stray whose plans hide in the dark this round shows as noise once.
  if (noiseGenres(b, ctx.rules).includes('gothic')) {
    for (const id of new Set(b.telegraphs.filter((t) => t.hidden && guttered(b, ctx, t)).map((t) => t.unitId))) {
      emit(run, { t: 'noise', genre: 'gothic', what: 'hidden', unit: id });
    }
  }
}

/**
 * §18.3: the habit each party slot shows is the choice made at commit, read from the plans before
 * anything resolves (what the RoundRecord learns), kept as `#c<slot>` = template × 65536 + ability in
 * usedRound until the slot acts and Battle.seen counts it.
 */
function shownHabits(run) {
  const choices = run.ctx.minds?.choices;
  if (!choices) return;
  for (const u of run.b.units) {
    const plan = run.b.plans[u.id];
    if (u.side !== 'party' || u.rank === 'device' || !standing(u) || !plan?.slots.length) continue;
    (choices(run.b, u.id, plan) || []).forEach((c, slot) => {
      if (c && Number.isInteger(c.template) && c.template >= 0 && Number.isInteger(c.ability) && c.ability >= 0 && c.ability < 65536) {
        u.usedRound = { ...(u.usedRound || {}), [`#c${slot}`]: c.template * 65536 + c.ability };
      }
    });
  }
}

/**
 * Keeps cheered slots within the Cheers the party holds (in ribbon order, then slot order; foes
 * never cheer), turning the rest off. Returns how many stay cheered.
 */
function clampCheers(b) {
  let left = b.cheers || 0;
  for (const id of b.order) {
    const plan = b.plans?.[id];
    if (!plan) continue;
    const party = unitIn(b, id)?.side === 'party';
    for (const a of plan.slots) {
      if (!a.cheer) continue;
      if (party && left > 0) left -= 1;
      else a.cheer = false;
    }
  }
  return (b.cheers || 0) - left;
}

function foePlansMissing(run) {
  const b = run.b;
  const minds = run.ctx.minds || {};
  for (const id of b.order) {
    const u = U(run, id);
    if (!u || u.side !== 'foe' || !standing(u) || u.rank === 'device' || b.plans[id]) continue;
    const plan = minds.foePlan ? minds.foePlan(b, id) : null;
    b.plans[id] = plan ? normalisePlan(plan, id, 'foe', run.ctx, b) : { unitId: id, slots: [], reactions: {}, by: 'foe', changed: [] };
  }
}

// ---------- ticks and rounds ----------

const maxTick = (b) => Math.max(3, ...(b.schedule || []).map((e) => e.tick));

function tickStart(run, t, first = false) {
  const b = run.b;
  const lead = b.lead;
  const leadUnit = U(run, 'lead');
  const revise = run.ctx.minds?.revise;
  if (!lead || !leadUnit || !standing(leadUnit) || lead.feintsLeft <= 0 || !revise) return;
  const heedy = b.units.some((u) => u.side === 'party' && standing(u) && (u.abilities?.heed ?? 0) >= 3);
  const ticks = heedy ? (first ? [t, t + 1] : [t + 1]) : [t];
  for (const tick of ticks) {
    if (lead.feintsLeft <= 0) break;
    const entry = (b.schedule || []).find((e, i) => i >= b.cursor && e.unitId === 'lead' && e.tick === tick);
    if (!entry || leadUnit.usedRound?.[`#feint${entry.slot}`]) continue;
    const next = revise(b, 'lead', tick);
    if (!next) continue;
    const plan = b.plans.lead;
    const slots = plan.slots.map((a, i) => (i === entry.slot ? legalCost(normaliseAction(next), run.ctx, b) || a : a));
    b.plans.lead = { ...plan, slots };
    leadUnit.usedRound = { ...(leadUnit.usedRound || {}), [`#feint${entry.slot}`]: 1 };
    lead.feintsLeft -= 1;
    emit(run, { t: 'feint', unit: 'lead', spotted: heedy });
  }
}

function tickEnd(run, t) {
  const b = run.b;
  // Surfaces that act on anyone who ends a tick in them.
  for (const u of [...b.units]) {
    if (!standing(u)) continue;
    const ids = new Set(footprint(u).map((p) => gridOf(run).surfaceAt(p.x, p.y)).filter(Boolean));
    for (const id of ids) surfaceOn(run, U(run, u.id), id, 'tick');
  }
  const mech = mechanicOf(run);
  if (mech?.tickEnd) hook(run, mech.tickEnd, t, run.ctx);
  if (b.lead && mech?.bow && !TERMINAL.has(b.status)) {
    const r = mech.bow(b, run.ctx) || {};
    const progress = r.progress ?? 0;
    const need = r.need ?? 0;
    if (progress !== b.lead.bow.progress || need !== b.lead.bow.need) {
      b.lead.bow = { progress, need };
      emit(run, { t: 'bow', progress, need });
    }
    if (r.done) {
      const lead = U(run, 'lead');
      if (lead && !lead.sorted) sortUnit(run, lead, 'bowed');
      finish(run, b.real ? 'yielded' : 'bowed');
      return;
    }
  }
  if (b.units.some((u) => u.usedRound?.['#home'])) {
    finish(run, 'home');
    return;
  }
  checkEnd(run);
}

function countDown(run, u) {
  const rules = run.rules;
  const keep = [];
  for (const c of u.conditions || []) {
    const info = rules.conditions[c.id];
    if (!info || c.data?.fresh) {
      keep.push(c);
      continue;
    }
    if (info.ends === 'after-turn') {
      emit(run, { t: 'condition', target: u.id, id: c.id, n: null, on: false });
      continue;
    }
    if ((info.ends === 'turns' || info.ends === 'source') && c.n !== null && c.n !== undefined) {
      const n = c.n - 1;
      if (n <= 0) {
        emit(run, { t: 'condition', target: u.id, id: c.id, n: null, on: false });
        if (c.id === 'brisk') {
          keep.push({ id: 'winded', n: null, source: null, data: null });
          emit(run, { t: 'condition', target: u.id, id: 'winded', n: null, on: true, down: true });
        }
        continue;
      }
      keep.push({ ...c, n });
      // §18.3: every count-down has an event (`down`: counted down, not landed, so no standoff reset or Log line).
      emit(run, { t: 'condition', target: u.id, id: c.id, n, on: true, down: true });
      continue;
    }
    keep.push(c);
  }
  u.conditions = keep.slice(0, 8);
}

function untilTick(list) {
  const out = [];
  for (const m of list || []) {
    if (m.until === 'end-of-round') continue;
    if (m.until === 'end-of-next-round') {
      out.push({ ...m, until: 'end-of-round' });
      continue;
    }
    const r = /^rounds:(\d+)$/.exec(m.until || '');
    if (r) {
      const n = Number(r[1]) - 1;
      if (n > 0) out.push({ ...m, until: `rounds:${n}` });
      continue;
    }
    out.push(m);
  }
  return out;
}

function roundEnd(run) {
  const b = run.b;
  for (const u of [...b.units]) {
    if (u.revealedUntil === 'end-of-round') u.revealedUntil = null;
    const ready = u.usedRound?.['#ready'];
    if (ready && b.plans?.[u.id]?.slots?.[ready - 1]) emit(run, { t: 'lost', unit: u.id, action: plain(b.plans[u.id].slots[ready - 1]), why: 'wont-fit' });
    countDown(run, u);
    u.mods = untilTick(u.mods);
    u.marks = untilTick(u.marks);
  }
  // Sustained spells without a Sustain this round end; the rest count down.
  for (const s of [...(b.sustained || [])]) {
    const caster = U(run, s.unitId);
    const kept = caster && standing(caster) && caster.usedRound?.[`#sus:${s.abilityId}`];
    if (!kept) {
      endSustained(run, s);
      continue;
    }
    s.rounds -= 1;
    if (s.rounds <= 0) endSustained(run, s);
  }
  // Devices: decoys go, timed ones count down.
  for (const u of [...b.units]) {
    if (u.rank !== 'device') continue;
    const tpl = run.rules.devices?.[u.kind];
    if (tpl?.expires === 'end-of-round') {
      removeUnit(run, u.id, 'expired');
      continue;
    }
    const left = u.uses?.['#rounds'];
    if (typeof left === 'number') {
      if (left <= 1) removeUnit(run, u.id, 'expired');
      else u.uses = { ...u.uses, '#rounds': left - 1 };
    }
  }
  // Surfaces and lights with rounds.
  let lightsChanged = false;
  for (const s of [...(b.surfaces || [])]) {
    if (s.rounds === null || s.rounds === undefined) continue;
    const n = s.rounds - 1;
    if (n > 0) {
      s.rounds = n;
      continue;
    }
    const then = run.rules.surfaces[s.id]?.then || null;
    setSurface(run, s.x, s.y, then, then ? run.rules.surfaces[then]?.rounds ?? null : null, s.level);
    emit(run, { t: 'surface', tiles: [{ x: s.x, y: s.y }], id: then || s.id, rounds: null, on: !!then });
  }
  b.lights = (b.lights || []).filter((l) => {
    if (l.rounds === null || l.rounds === undefined) return true;
    l.rounds -= 1;
    if (l.rounds > 0) return true;
    lightsChanged = true;
    return false;
  });
  if (lightsChanged) {
    dirty(run);
    emit(run, { t: 'light', lights: plain(b.lights) });
  }
  const mech = mechanicOf(run);
  if (mech?.roundEnd) {
    const r = hook(run, mech.roundEnd, run.ctx);
    if (r?.yielded && !TERMINAL.has(b.status)) {
      finish(run, 'last-page');
      return;
    }
  }
  if (checkEnd(run)) return;
  // §18.2: three whole rounds with no Integrity change, no condition landed, no calm added and no one
  // moving closer to a foe end the fight calmly, as settled.
  b.quiet = (b.quiet ?? 0) < 0 ? 0 : (b.quiet ?? 0) + 1;
  if (b.quiet >= STANDOFF_ROUNDS) standoff(run);
}

/**
 * A standoff: every foe still up settles and wanders home, and the fight ends as won (a real rift's
 * lead yields), so it pays in full, with `end`'s why 'standoff'.
 */
function standoff(run) {
  const b = run.b;
  for (const v of [...b.units]) if (v.side === 'foe' && v.rank !== 'device' && standing(v)) sortUnit(run, v, 'settled');
  const outcome = b.real && U(run, 'lead') ? 'yielded' : 'won';
  finish(run, outcome, { summary: summaryText(b, { outcome: 'standoff' }), why: 'standoff' });
}

function roundStart(run) {
  const b = run.b;
  const rules = run.rules;
  b.round += 1;
  b.tick = 0;
  b.cursor = 0;
  b.schedule = null;
  // An Ask raised before this round's plans exist answers by last round's (§18.3's auto plan).
  run.scratch.lastPlans = b.plans || {};
  b.plans = {};
  b.drafted = {};
  b.ask = null;
  if (b.modeNext) {
    b.mode = b.modeNext;
    b.modeNext = null;
  }
  const buffers = [];
  for (const u of b.units) {
    u.reactionUsed = false;
    u.attacks = 0;
    u.usedRound = {};
    if (u.buffer) {
      u.buffer = 0;
      buffers.push(u.id);
    }
    u.conditions = (u.conditions || []).map((c) => (c.data?.fresh ? { ...c, data: freshless(c.data) } : c));
    u.mods = (u.mods || []).filter((m) => m.until !== 'start-of-next-turn');
  }
  emit(run, { t: 'round', round: b.round });
  // §18.3: every drawn change has an event, Buffers cleared at the round's start included.
  for (const id of buffers) emit(run, { t: 'buffer', unit: id, buffer: 0 });
  // Drift, then room heat from round 2.
  const lantern = hooklight(b);
  const room = roomHeat(b, rules);
  for (const u of b.units) {
    if (!standing(u)) continue;
    const inLight = u.side === 'party' && lantern && lantern.radius >= rules.sight.lanternRaised && unitDist(lantern, u) <= lantern.radius;
    const amount = (inLight ? rules.heat.driftLantern : rules.heat.drift) + modSum(b, u, 'drift', run.ctx);
    let h = driftHeat(u.heat, idleHeatOf(b, u, rules), amount);
    if (b.round >= 2) h += room;
    setHeat(run, u, h);
  }
  // Lingering damage and Singed.
  for (const u of [...b.units]) {
    if (!standing(u)) continue;
    for (const c of [...(u.conditions || [])]) {
      if (c.id !== 'lingering' && c.id !== 'singed') continue;
      const kind = c.id === 'singed' ? 'light' : c.data?.kind || 'plain';
      landHit(run, { userId: c.source && U(run, c.source) ? null : null, targetId: u.id, amount: c.n || 0, kind, degree: 'hit', reactions: false, source: c.id });
      const now = U(run, u.id);
      if (!now) continue;
      const cond = (now.conditions || []).find((x) => x.id === c.id && x.data?.kind === c.data?.kind);
      if (!cond) continue;
      const turns = (cond.data?.turns ?? 3) - 1;
      if (turns <= 0) endCondition(run, now, c.id, { kind: c.id === 'lingering' ? c.data?.kind ?? null : null });
      else cond.data = { ...(cond.data || {}), turns };
    }
  }
  roundEffects(run);
  syncLantern(run);
  flushLight(run);
  const mech = mechanicOf(run);
  if (mech?.roundStart) hook(run, mech.roundStart, run.ctx);
  run.scratch.lastPlans = null;
  checkEnd(run);
  if (TERMINAL.has(b.status)) return;
  startPlanning(run);
  emit(run, { t: 'telegraphs', list: plain(b.telegraphs) });
}

/** What every round's start brings, round 1's included: gravity wells, the Kaiju tremor and bright strays' cheer. */
function roundEffects(run) {
  const b = run.b;
  const rules = run.rules;
  // Gravity wells pull 1 tile inward a turn.
  for (const u of [...b.units]) {
    if (!standing(u) || u.moves?.flies || u.moves?.hovers) continue;
    const g = gridOf(run);
    if (g.surfaceAt(u.x, u.y) !== 'gravity-well') continue;
    let best = null;
    let bestN = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const t = { x: u.x + dx, y: u.y + dy };
      if (g.surfaceAt(t.x, t.y) !== 'gravity-well' || !g.canStand(t.x, t.y, u.id)) continue;
      let n = 0;
      for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.surfaceAt(t.x + ex, t.y + ey) === 'gravity-well') n += 1;
      if (n > bestN) {
        best = t;
        bestN = n;
      }
    }
    let hereN = 0;
    for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.surfaceAt(u.x + ex, u.y + ey) === 'gravity-well') hereN += 1;
    if (best && bestN > hereN) moveAlong(run, u.id, [best], 'pull', { by: null, noSwipes: true });
  }
  // Kaiju tremor: one seeded row turns to rough ground for the round.
  if (noiseGenres(b, rules).includes('kaiju')) {
    const rect = b.arena.rect;
    const row = rect.y + (hashInts(b.seed, b.attempt, b.round, 'noise:tremor') % rect.h);
    const tiles = [];
    const g = gridOf(run);
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      if (g.surfaceAt(x, row) || ['#', ' ', 'O', '~', 'o'].includes(g.cell(x, row))) continue;
      tiles.push({ x, y: row });
    }
    for (const t of tiles) setSurface(run, t.x, t.y, 'rough-ground', 1);
    emit(run, { t: 'noise', genre: 'kaiju', what: 'tremor', unit: null });
    if (tiles.length) emit(run, { t: 'surface', tiles, id: 'rough-ground', rounds: 1, on: true });
  }
  // Bright strays cheer: one ally gets +1 edge on its first action.
  for (const n of b.units) {
    if (n.side !== 'neutral' || !standing(n)) continue;
    const allies = b.units.filter((v) => v.side === 'foe' && standing(v)).sort((p, q) => unitDist(n, p) - unitDist(n, q) || b.order.indexOf(p.id) - b.order.indexOf(q.id));
    if (allies[0]) addMod(run, allies[0], { stat: 'edge-next', by: 1, until: 'next-action', source: `cheer:${n.id}` });
  }
}

function freshless(data) {
  const { fresh, ...rest } = data || {};
  return Object.keys(rest).length ? rest : null;
}

// ---------- ending ----------

function checkEnd(run) {
  const b = run.b;
  if (TERMINAL.has(b.status)) return true;
  const heroes = b.units.filter((u) => u.side === 'party' && u.rank === 'hero');
  if (heroes.length && heroes.every((u) => u.offline)) {
    finish(run, 'offline');
    return true;
  }
  const lead = U(run, 'lead');
  if (lead && lead.sorted && b.real) {
    finish(run, 'yielded');
    return true;
  }
  const foes = b.units.filter((u) => u.side === 'foe' && u.rank !== 'device');
  if (foes.length && foes.every((u) => u.sorted)) {
    if (lead?.sorted === 'bowed') finish(run, 'bowed');
    else if (foes.every((u) => u.sorted === 'talked')) finish(run, 'talked');
    else finish(run, 'won');
    return true;
  }
  return false;
}

function finish(run, outcome, { summary = null, why = null } = {}) {
  const b = run.b;
  if (TERMINAL.has(b.status)) return;
  b.status = outcome;
  b.ask = null;
  clearAsks(b);
  const foes = b.units.filter((u) => u.side === 'foe' && u.rank !== 'device');
  const result = {
    fightId: b.id,
    outcome,
    rounds: b.round,
    sorted: foes.filter((u) => u.sorted).length,
    calmed: Object.entries(b.talk || {}).filter(([, t]) => t.done).map(([k]) => k),
    bow: outcome === 'bowed',
    // A real rift's lead yields, on its last bar or at the last page (§18.3), naming the real cause.
    real: (outcome === 'yielded' || outcome === 'last-page') && b.real ? { cause: b.real.cause } : null,
    auto: !!b.auto,
    summary: '',
  };
  result.summary = (summary || summaryText(b, result)).slice(0, 200);
  b.result = result;
  for (const s of [...(b.sustained || [])]) endSustained(run, s);
  b.plans = {};
  b.schedule = null;
  b.telegraphs = [];
  emit(run, why ? { t: 'end', result: plain(result), why } : { t: 'end', result: plain(result) });
}

// ---------- resolving an action ----------

/** §4.4: a Jump reaches 2 + Might tiles, at least 1. */
const jumpRange = (run, u) => Math.max(1, run.rules.actions.jumpBase + (u.abilities?.might ?? 0));

function validWhy(run, u, a) {
  const b = run.b;
  const g = gridOf(run);
  const tgt = a.target || {};
  const unitT = tgt.unit ? U(run, tgt.unit) : null;
  // Spooked: a move whose first tile is closer to the source can't happen (COMBAT §7).
  const first = tgt.path?.[0] || tgt.tile || null;
  const spook = ['stride', 'step', 'jump'].includes(a.id) && first ? spookSource(run, u) : null;
  if (spook && !hasCond(u, 'tumbled') && unitDist({ x: first.x, y: first.y, size: u.size || 1 }, spook) < unitDist(u, spook)) return 'spooked';
  switch (a.id) {
    case 'stride': {
      if (hasCond(u, 'tangled')) return 'tangled';
      if (hasCond(u, 'tumbled')) return null;
      const speed = speedOf(b, u, run.ctx, { stride: true });
      const ignoreDifficult = hasRule(run.ctx, u, 'ignore-difficult');
      if (tgt.path) {
        const w = g.walk(u.id, tgt.path, { ignoreDifficult });
        return w && w.cost <= speed ? null : 'blocked';
      }
      if (tgt.tile) return g.path(u.id, tgt.tile, { budget: speed, ignoreDifficult }) ? null : 'blocked';
      return 'blocked';
    }
    case 'step': {
      const t = tgt.tile || tgt.path?.[0];
      if (hasCond(u, 'tangled')) return 'tangled';
      return canStep(g, u, t) ? null : 'blocked';
    }
    case 'strike': case 'shove': {
      if (tgt.object) return (b.objects || []).some((o) => o.id === tgt.object) ? null : 'target-gone';
      // An Unseen target can still be struck, at −2 (COMBAT §7); only a Seek, a light or its own attack reveals it.
      if (!unitT || !standing(unitT)) return 'target-gone';
      const reach = a.id === 'shove' ? unitDist(u, unitT) <= 1 : strikeReach(u, unitT).ok;
      if (!reach) return 'out-of-reach';
      // In reach but out of sight: high cover, or two blocking corners, between them (§4.17).
      return g.sees(u, unitT) ? null : 'blocked';
    }
    case 'throw': {
      const range = Math.max(1, run.rules.actions.throwBase + run.rules.actions.throwMight * (u.abilities?.might ?? 0));
      if (a.ability === 'cordial') {
        if (!carrierOf(run, u, 'cordial')) return 'none-left';
        const at = tgt.tile || (unitT && standing(unitT) ? unitT : null);
        if (!at) return 'target-gone';
        return unitDist(u, at) <= range && g.sees(u, at) ? null : 'out-of-reach';
      }
      if (!unitT || !standing(unitT)) return 'target-gone';
      return unitDist(u, unitT) <= range && g.sees(u, unitT) ? null : 'out-of-reach';
    }
    case 'examine': return unitT && !unitT.sorted && g.sees(u, unitT) ? null : 'target-gone';
    case 'talk-down': return unitT && talkTargets(b, g, u).includes(unitT.id) ? null : 'target-gone';
    case 'assist': {
      const [allyId, foeId] = tgt.units || [];
      const ally = allyId ? U(run, allyId) : null;
      const foe = foeId ? U(run, foeId) : null;
      return ally && standing(ally) && foe && standing(foe) ? null : 'target-gone';
    }
    case 'reboot':
      if (!unitT || !unitT.offline || (unitT.drops || 0) >= 2 || unitDist(u, unitT) > 1) return 'target-gone';
      return a.cost < rebootCost(b, unitT, run.ctx) ? 'cant' : null;
    case 'interact': {
      if (tgt.object) {
        const o = (b.objects || []).find((x) => x.id === tgt.object);
        return o && unitDist(u, o) <= 1 ? null : 'target-gone';
      }
      if (unitT) return unitT.id === u.id || unitDist(u, unitT) <= 1 ? null : 'out-of-reach';
      return 'target-gone';
    }
    case 'jump': {
      if (hasCond(u, 'tangled')) return 'tangled';
      return tgt.tile && g.canJump(u.id, tgt.tile, jumpRange(run, u)) ? null : 'blocked';
    }
    case 'hide': return canHide(run, u) ? null : 'cant';
    case 'sustain': return (b.sustained || []).some((s) => s.unitId === u.id && (!a.ability || s.abilityId === a.ability)) ? null : 'cant';
    case 'ready': return (b.warding || 0) >= (run.rules.warding?.ready ?? 10) ? null : 'cant';
    case 'use': {
      if (String(a.ability || '').startsWith('mech:')) return null;
      const ab = ability(run.ctx, a.ability);
      if (!ab || !(u.abilityIds || []).includes(ab.id) || !costsOf(ab).includes(a.cost)) return 'cant';
      // Borrow a rule lends only a genre the user has stitched, whatever a plan names (COMBAT §5).
      if (abilityWhy(b, u, ab, a.cost, run.ctx) || choiceWhy(u, ab, a.choice)) return 'cant';
      const ids = tgt.units || (tgt.unit ? [tgt.unit] : []);
      const spec = specFor(ab, a);
      if (!spec) return 'cant';
      const t = spec.target || { who: 'self' };
      const who = t.who;
      for (const id of ids) {
        const v = U(run, id);
        if (!v || v.sorted) return 'target-gone';
        if (v.offline && who !== 'offline-ally' && who !== 'unit') return 'target-gone';
        if (who === 'offline-ally' && !v.offline) return 'target-gone';
      }
      return useWhy(run, u, ab, a, spec, ids);
    }
    default: return null;
  }
}

/**
 * Whether a use's targets are still legal as it resolves: the extra charges it upcasts with, then its
 * range (Wit 3+ adds 1 to 2- and 3-action spells), sight, side and `need` for each unit, and the
 * range, sight and `need` of a tile or an object, and the move it makes there (§5.5: a plan that can't happen improvises).
 */
function useWhy(run, u, ab, a, spec, ids) {
  const t = spec.target || { who: 'self' };
  const extra = a.extra || 0;
  if (extra) {
    if (!(extra > 0 && Number.isInteger(extra)) || !ab.upcast || ab.kind !== 'spell' || extra > ab.circle) return 'cant';
    if (u.charges?.pool !== 'pact' && (u.charges?.left || 0) < ab.circle + extra) return 'cant';
  }
  const g = gridOf(run);
  const wit = (u.abilities?.wit ?? 0) >= 3 && ab.kind === 'spell' && (a.cost || 1) >= 2 ? 1 : 0;
  const range = (t.range ?? 1) + wit;
  const tgt = a.target || {};
  const aimed = tgt.tile || tgt.path?.[tgt.path.length - 1] || null;
  if (t.who === 'tile') {
    if (!aimed || !g.inside(aimed.x, aimed.y)) return 'blocked';
    if (unitDist(u, aimed) > range) return 'out-of-reach';
    if (t.sight !== false && !g.sees(u, aimed)) return 'out-of-reach';
    if (!(t.need || []).every((p) => tileHolds(run.b, g, p, u, aimed))) return 'blocked';
    return moveWhy(run, u, spec, aimed);
  }
  if (t.who === 'none' && aimed) return moveWhy(run, u, spec, aimed);
  if (t.who === 'object') {
    const o = (run.b.objects || []).find((x) => x.id === tgt.object);
    if (!o) return 'target-gone';
    return unitDist(u, o) > range ? 'out-of-reach' : null;
  }
  if (t.who === 'self' || t.who === 'none') return null;
  if (!ids.length) return 'target-gone';
  const legal = new Set(unitTargets(run.b, g, u, t, { wit }));
  for (const id of ids) {
    if (legal.has(id)) continue;
    const v = U(run, id);
    return v && unitDist(u, v) > range ? 'out-of-reach' : 'target-gone';
  }
  // Once per target a round (Soothe): a target it has already had this round can't have it again.
  return usedOn(u, ab, ids) ? 'cant' : null;
}

/** True when a `target-round` ability has had its uses this round on any of these targets. */
function usedOn(u, ab, ids) {
  if (ab.uses?.per !== 'target-round') return false;
  const n = numOf(ab.uses.n, u);
  return ids.some((id) => (u.usedRound?.[`${ab.id}@${id}`] || 0) >= n);
}

/**
 * The move a use makes to the tile it aims at must be one that can happen: a path within its tiles
 * (a step draws no Parting swipe), a free tile to teleport to, and a tile that isn't Lit for `into: 'dim'`.
 */
function moveWhy(run, u, spec, tile) {
  const g = gridOf(run);
  for (const e of spec.effects || []) {
    if (e.do !== 'move' || e.who === 'target' || !['step', 'stride', 'teleport'].includes(e.how)) continue;
    if (e.into === 'dim' && !dimTile(g, u, tile)) return 'blocked';
    const ok = e.how === 'teleport' ? g.canStand(tile.x, tile.y, u.id) : !!g.path(u.id, tile, { noSwipes: !!e.noSwipes || e.how === 'step', budget: numOf(e.tiles ?? 1, u) });
    if (!ok) return 'blocked';
  }
  return null;
}

function lose(run, unitId, action, why) {
  emit(run, { t: 'lost', unit: unitId, action: plain(action), why });
}

function resolveEntry(run, entry) {
  const b = run.b;
  const u = U(run, entry.unitId);
  if (!u) return;
  const plan = b.plans[entry.unitId];
  let action = plan?.slots?.[entry.slot];
  if (!action) return;
  const flags = decodeSchedule(b)[b.cursor]?.flags ?? 0;
  const noiseAt = (what, genre) => emit(run, { t: 'noise', genre, what, unit: u.id });
  if (flags & NOISE_FLAGS.fastest) noiseAt('fastest', 'frontier');
  if (flags & NOISE_FLAGS.lag) noiseAt('lag', 'neon');
  if (flags & NOISE_FLAGS.swap) noiseAt('swap', 'void');
  if (flags & NOISE_FLAGS.backlog) noiseAt('backlog', 'iron');
  if (flags & NOISE_FLAGS.repeat) noiseAt('repeat', 'backhalls');
  if (!standing(u)) return lose(run, u.id, action, 'offline');
  if ((u.mods || []).some((m) => m.stat === 'surprised')) return lose(run, u.id, action, 'asleep');
  if (asleep(u)) return lose(run, u.id, action, 'asleep');
  const dazed = condOf(u, 'dazed');
  if (dazed && dazed.n > 0) {
    const lostSoFar = u.usedRound?.['#dazed'] || 0;
    const cap = u.rank === 'lead' ? run.rules.lead?.dazedMax ?? 2 : Infinity;
    if (lostSoFar < cap) {
      u.usedRound = { ...(u.usedRound || {}), '#dazed': lostSoFar + 1 };
      if (dazed.n <= 1) endCondition(run, u, 'dazed');
      else {
        dazed.n -= 1;
        emit(run, { t: 'condition', target: u.id, id: 'dazed', n: dazed.n, on: true, down: true });
      }
      return lose(run, u.id, action, 'dazed');
    }
  }
  if (noiseGenres(b, run.rules).includes('nocturne') && !noiseExempt(b, run.ctx, action)) {
    const i = b.order.indexOf(u.id);
    const r = run.rules.genres.nocturne.noise.rate;
    const rate = Array.isArray(r) ? r[0] / r[1] : r;
    if (unit01(hashInts(b.seed, b.attempt, b.round, entry.tick, i, entry.slot, 'noise:nocturne')) < rate) {
      noiseAt('slept', 'nocturne');
      return lose(run, u.id, action, 'asleep');
    }
  }
  // Beguiled: the first action each round drifts toward the charmer.
  const beg = condOf(u, 'beguiled');
  if (beg && !u.usedRound?.['#beguiled']) {
    u.usedRound = { ...(u.usedRound || {}), '#beguiled': 1 };
    const charmer = beg.source ? U(run, beg.source) : null;
    if (charmer && standing(charmer) && unitDist(u, charmer) > 1) {
      const g = gridOf(run);
      let path = null;
      for (const t of footprint(charmer)) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const p = g.path(u.id, { x: t.x + dx, y: t.y + dy }, { budget: Infinity, noSwipes: true });
          if (p && p.length && (!path || p.length < path.length)) path = p;
        }
      }
      const step = path?.[0] && g.canStand(path[0].x, path[0].y, u.id) ? path[0] : null;
      if (step) {
        const to = { id: 'step', ability: null, cost: 1, target: { tile: step }, extra: 0, choice: null, cheer: false, trigger: null };
        emit(run, { t: 'improvise', unit: u.id, from: plain(action), to, why: 'beguiled' });
        action = to;
      }
    }
  }
  // Beguiled units can't target their charmer.
  if (beg && action.target?.unit === beg.source) {
    return lose(run, u.id, action, 'beguiled');
  }
  const why = validWhy(run, u, action);
  if (why) {
    let alt = null;
    if (u.kind === 'milo' && u.side === 'party') alt = { id: 'brace', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null };
    else if (run.ctx.minds?.improvise) alt = normaliseAction(run.ctx.minds.improvise(b, u.id, plain(action), why));
    if (alt && validWhy(run, U(run, u.id), alt)) alt = null;
    if (!alt) return lose(run, u.id, action, 'wont-fit');
    emit(run, { t: 'improvise', unit: u.id, from: plain(action), to: plain(alt), why });
    action = alt;
  } else if (u.side === 'party' && (plan.by === 'draft' || plan.by === 'auto') && !plan.changed?.[entry.slot] && b.drafted?.[u.id]) {
    // A drafted slot left as drafted, whether you accepted it (draft) or the hero played it (auto).
    const layer = b.drafted[u.id].layers?.[entry.slot] || 'personality';
    const t = thoughtText(layer, thoughtWords(b, u.id, action, run.ctx), run.ctx.party?.[u.id]);
    if (t.text || t.picture) emit(run, { t: 'thought', unit: u.id, text: t.text, picture: t.picture });
  }
  emit(run, { t: 'act', unit: u.id, action: plain(action), words: actionWords(b, u.id, action, run.ctx) });
  const shown = u.side === 'party' ? U(run, u.id).usedRound?.[`#c${entry.slot}`] : undefined;
  const before = b.k;
  resolveBasic(run, u.id, action, { slot: entry.slot });
  const after = U(run, u.id);
  if (after) {
    // Counted once it has resolved, so the turn's first action picks with its first-action edge.
    after.usedRound = { ...(after.usedRound || {}), '#acted': (after.usedRound?.['#acted'] || 0) + 1 };
    consumeUntil(run, after, 'next-action');
    if (b.k > before) consumeUntil(run, after, 'next-effect');
  }
  // Dramatic strays: their big moment opens their kind to talking.
  if (action.id === 'use' && ability(run.ctx, action.ability)?.big && after?.talkKind) {
    for (const v of b.units) if (v.talkKind === after.talkKind) addMod(run, v, { stat: 'big-done', by: 1, until: 'fight', source: 'big' });
  }
  // Habits shown this fight (adaptation reads Battle.seen): the choice made at commit (§18.3), read before it resolved.
  if (after && shown !== undefined) {
    const key = `${Math.floor(shown / 65536)}:${shown % 65536}`;
    b.seen[key] = (b.seen[key] || 0) + 1;
  }
  if (run.ctx.bows?.afterAction) hook(run, run.ctx.bows.afterAction, u.id, plain(action), run.ctx);
  syncLantern(run);
}

/** The basic actions (§4.4) and 'use'; shared by the schedule, readied actions and wrap-ups. */
function resolveBasic(run, unitId, action, opts = {}) {
  const b = run.b;
  const u = U(run, unitId);
  if (!u) return null;
  const tgt = action.target || {};
  const rules = run.rules;
  switch (action.id) {
    case 'stride': return doStride(run, unitId, action);
    case 'step': return doStep(run, unitId, action);
    case 'strike': return doStrike(run, unitId, action, { reaction: !!opts.reaction });
    case 'brace': return doBrace(run, unitId, { cheer: !!action.cheer });
    case 'seek': return doSeek(run, unitId);
    case 'hide': return doHide(run, unitId);
    case 'delay': return null;
    case 'cool-down':
      setHeat(run, u, Math.max(0, u.heat - rules.heat.coolDown));
      return null;
    case 'examine': {
      const v = tgt.unit ? U(run, tgt.unit) : null;
      if (!v) return null;
      v.examined = true;
      if (v.side !== u.side) v.revealedUntil = 'fight';
      emit(run, { t: 'reveal', unit: v.id, what: 'stats', text: examineLine(b, v.id) });
      // Wit 3+ reads the lead's mechanic in its own words (leads.json's `text`, carried on the
      // Mechanic); the fallback and the bare lead have nothing more to show.
      const mech = b.lead && b.lead.mechanic !== 'fallback' ? (run.ctx.mechanics || {})[b.lead.mechanic] : null;
      const words = mech && typeof mech.text === 'string' ? mech.text.trim().replace(/\.$/, '') : '';
      if (v.id === 'lead' && (u.abilities?.wit ?? 0) >= 3 && words) {
        emit(run, { t: 'reveal', unit: v.id, what: 'mechanic', text: `Next phase, it ${words}.` });
      }
      return null;
    }
    case 'interact': return interact(run, u, action);
    case 'assist': {
      const [allyId, foeId] = tgt.units || [];
      const ally = U(run, allyId);
      const foe = U(run, foeId);
      if (!ally || !foe) return null;
      const odds = oddsAgainst(b, run.ctx, u.id, ally.id, { helpful: true, cheer: !!action.cheer }, gridOf(run));
      pickOutcome(run, u.id, ally.id, odds);
      addMark(run, foe, { id: 'assist', by: ally.id, n: 1, until: 'next-action' });
      endCondition(run, ally, 'lingering');
      endCondition(run, ally, 'singed');
      return null;
    }
    case 'talk-down': {
      const v = tgt.unit ? U(run, tgt.unit) : null;
      if (!v?.talkKind) return null;
      const double = u.kind === 'dusty' && (v.temperament === 'proud' || v.temperament === 'grumpy');
      addCalm(run, u, v.talkKind, double ? 2 : 1);
      return null;
    }
    case 'reboot': {
      const v = tgt.unit ? U(run, tgt.unit) : null;
      if (v) rebootUnit(run, u.id, v, rules.actions.reboot);
      return null;
    }
    // A readied Throw or Shove is a reaction: no heat, no attack counted, no penalty (§4.3).
    case 'throw': return doThrow(run, u, action, { reaction: !!opts.reaction });
    case 'shove': return doShove(run, u, action, { reaction: !!opts.reaction });
    case 'jump': {
      const t = tgt.tile;
      if (t && gridOf(run).canJump(u.id, t, jumpRange(run, u))) moveAlong(run, u.id, [t], 'jump', {});
      return null;
    }
    case 'dip': {
      const g = gridOf(run);
      let kind = null;
      for (const t of footprint(u)) {
        for (let dy = -1; dy <= 1 && !kind; dy += 1) {
          for (let dx = -1; dx <= 1 && !kind; dx += 1) {
            const s = g.surfaceAt(t.x + dx, t.y + dy);
            if (s === 'candlefire' || s === 'burning-oil' || s === 'burning-foliage') kind = 'light';
            else if (s === 'neon-puddle') kind = 'spark';
            const o = g.objectAt(t.x + dx, t.y + dy);
            if (!kind && o && o.kind === 'candle' && o.state === 'lit') kind = 'light';
          }
        }
      }
      if (kind) addMod(run, u, { stat: 'dip', by: rules.dip?.plus ?? 2, until: 'next-attack', source: kind });
      return null;
    }
    case 'sustain': {
      const s = (b.sustained || []).find((x) => x.unitId === u.id && (!action.ability || x.abilityId === action.ability));
      const a = s && ability(run.ctx, s.abilityId);
      if (!s || !a) return null;
      u.usedRound = { ...(u.usedRound || {}), [`#sus:${a.id}`]: 1 };
      useAbility(run, u.id, a, { cost: s.cost, target: plain(s.target), choice: null, extra: 0, cheer: false }, { sustain: true });
      return null;
    }
    case 'ready': {
      if (typeof opts.slot === 'number') u.usedRound = { ...(u.usedRound || {}), '#ready': opts.slot + 2 };
      return null;
    }
    case 'head-home': {
      u.usedRound = { ...(u.usedRound || {}), '#home': 1 };
      return null;
    }
    case 'use': {
      const id = action.ability || '';
      if (id.startsWith('mech:')) {
        const mech = mechanicOf(run);
        let r = mech?.resolve ? hook(run, mech.resolve, unitId, plain(action), run.ctx) : null;
        if (!r && run.ctx.bows?.resolve) r = hook(run, run.ctx.bows.resolve, unitId, plain(action), run.ctx);
        return null;
      }
      const a = ability(run.ctx, id);
      if (!a) return null;
      useAbility(run, unitId, a, { cost: action.cost, target: plain(action.target), choice: action.choice, extra: action.extra || 0, cheer: !!action.cheer }, { reaction: !!opts.reaction });
      return null;
    }
    case 'aside': {
      const mech = mechanicOf(run);
      if (mech?.resolve) hook(run, mech.resolve, unitId, plain(action), run.ctx);
      return null;
    }
    default: return null;
  }
}

// ---------- the step ----------

/** §18.3: an Ask's answer, kept in Battle.answers until the entry it paused has resolved. */
function setAnswer(b, ask, yes) {
  if (!ask) return;
  b.answers = { ...(b.answers || {}), [ask.unitId]: { ...(b.answers?.[ask.unitId] || {}), [ask.reactionId]: yes ? 1 : 0 } };
}

function clearAsks(b) {
  delete b.answers;
}

function afterEntry(run, entry) {
  const b = run.b;
  if (TERMINAL.has(b.status)) return;
  const next = b.schedule[b.cursor];
  const from = Math.max(1, entry ? entry.tick : b.tick);
  // Ends ticks from `from` up to (not including) `to`, starting each one after the first (§5.8's tick).
  const endTicks = (to) => {
    for (let t = from; t < to; t += 1) {
      b.tick = t;
      if (t > from) emit(run, { t: 'tick', tick: t });
      tickEnd(run, t);
      if (TERMINAL.has(b.status)) return false;
    }
    return true;
  };
  if (!next) {
    if (!endTicks(maxTick(b) + 1)) return;
    roundEnd(run);
    if (TERMINAL.has(b.status)) return;
    roundStart(run);
    return;
  }
  if (next.tick > from) {
    if (!endTicks(next.tick)) return;
    b.tick = next.tick;
    emit(run, { t: 'tick', tick: next.tick });
    tickStart(run, next.tick);
  }
}

function stepRun(run) {
  const b = run.b;
  const entry = b.schedule?.[b.cursor] || null;
  if (entry) {
    b.tick = entry.tick;
    inEntry(() => resolveEntry(run, entry));
    clearAsks(b);
    flushLight(run);
    if (TERMINAL.has(b.status)) return;
    b.cursor += 1;
    if (checkEnd(run)) return;
  }
  afterEntry(run, entry);
}

// ---------- the reducer ----------

function appendLog(b, events) {
  const lines = logLines(events, b);
  if (!lines.length) return;
  b.log = [...(b.log || []), ...lines].slice(-30);
}

/**
 * §18.3: the board draws telegraphs only from events, so whenever the list differs from the one it
 * last got (this run's last `telegraphs` event, else the list the command started with) it's sent.
 */
function sendTelegraphs(run) {
  const sent = run.events.findLast((e) => e.t === 'telegraphs');
  if (JSON.stringify(sent ? sent.list : run.tele0 || []) !== JSON.stringify(run.b.telegraphs)) emit(run, { t: 'telegraphs', list: plain(run.b.telegraphs) });
}

function done(run) {
  const b = run.b;
  flushLight(run);
  if (b.status === 'running' || b.status === 'asking' || b.status === 'planning') {
    b.telegraphs = buildTelegraphs(b, run.ctx);
    sendTelegraphs(run);
  }
  appendLog(b, run.events);
  return { battle: freezeOut(b), events: run.events };
}

function openRun(battle, ctx) {
  const run = makeRun(battle, ctx);
  run.basic = resolveBasic;
  run.valid = validWhy;
  run.tele0 = battle.telegraphs;
  return run;
}

function withRun(battle, ctx, fn) {
  const run = openRun(battle, ctx);
  fn(run);
  return done(run);
}

/** The foes' remaining Integrity is below one round of the party's expected damage. */
export function canWrapBattle(battle, ctx) {
  if (TERMINAL.has(battle.status)) return false;
  const rules = ctx.rules;
  let party = 0;
  for (const u of battle.units) {
    if (u.side !== 'party' || !standing(u) || u.rank === 'device') continue;
    const amount = (u.strike?.amount || 0) + (u.keyAdjust || 0) + (u.flat || 0);
    party += 3 * amount * expected(barsFor(u.heat, 0, { storybook: effMode(battle) === 'storybook' }));
  }
  let foes = 0;
  for (const u of battle.units) {
    if (u.side !== 'foe' || u.sorted) continue;
    foes += u.integrity;
    if (u.id === 'lead' && battle.lead) foes += battle.lead.bars.slice(battle.lead.bar + 1).reduce((s, x) => s + x, 0);
  }
  return foes < party;
}

function autoPlay(run, maxRounds = 30) {
  const b = run.b;
  b.auto = true;
  // Wrap it up answers every Ask as Always, the ones outside an entry included (§18.3).
  run.scratch.autoAsk = true;
  const minds = run.ctx.minds || {};
  let guard = 0;
  while (!TERMINAL.has(b.status) && guard < 5000) {
    guard += 1;
    if (b.round > maxRounds) {
      finish(run, 'home');
      break;
    }
    if (b.status === 'planning') {
      for (const u of b.units) {
        if (u.side !== 'party' || !standing(u) || u.rank === 'device') continue;
        const d = minds.draft ? minds.draft(b, u.id) : null;
        b.plans[u.id] = normalisePlan(d?.plan || { slots: [] }, u.id, 'auto', run.ctx, b);
        b.plans[u.id].by = 'auto';
      }
      commitRound(run);
      continue;
    }
    if (b.status === 'asking') {
      setAnswer(b, b.ask, true);
      b.status = 'running';
      b.ask = null;
    }
    const snapshot = cloneBattle(b);
    const mark = run.events.length;
    try {
      stepRun(run);
    } catch (err) {
      if (!(err instanceof AskSignal)) throw err;
      adopt(run, snapshot);
      run.events.length = mark;
      run.lightDue = false;
      setAnswer(run.b, err.ask, true);
    }
  }
}

/**
 * §7.1's one reducer. Commands: plan, cheer, commit, step, answer, mode, head-home, wrap, end.
 * Returns { battle, events }; the same battle when the command changes nothing.
 */
export function apply(battle, command, ctx) {
  const same = { battle, events: [] };
  if (!battle || !command || TERMINAL.has(battle.status)) return same;
  switch (command.t) {
    case 'plan': {
      if (battle.status !== 'planning') return same;
      const u = unitIn(battle, command.unitId);
      // Devices act only when commanded (§6.5), so they take no plan.
      if (!u || u.side !== 'party' || u.rank === 'device' || !standing(u) || !command.plan) return same;
      const next = normalisePlan(command.plan, u.id, 'you', ctx, battle);
      // Cheers beyond what the party holds don't stick (the other plans keep theirs).
      const others = Object.entries(battle.plans || {}).filter(([id]) => id !== u.id).reduce((n, [, p]) => n + p.slots.filter((x) => x.cheer).length, 0);
      let left = Math.max(0, (battle.cheers || 0) - others);
      for (const x of next.slots) {
        if (!x.cheer) continue;
        if (left > 0) left -= 1;
        else x.cheer = false;
      }
      const d = command.draft;
      const drafted = d ? { confidence: d.confidence ?? 0, source: d.source || 'personality', choices: plain(d.choices || []), layers: [...(d.layers || [])] }
        : command.plan.by !== 'draft' ? undefined : battle.drafted?.[u.id];
      // The same plan (and draft) again changes nothing: the same battle back.
      if (JSON.stringify(next) === JSON.stringify(battle.plans?.[u.id]) && JSON.stringify(drafted) === JSON.stringify(battle.drafted?.[u.id])) return same;
      return withRun(battle, ctx, (run) => {
        run.b.plans[u.id] = next;
        if (drafted) run.b.drafted[u.id] = plain(drafted);
        else delete run.b.drafted[u.id];
      });
    }
    case 'cheer': {
      if (battle.status !== 'planning') return same;
      const plan = battle.plans?.[command.unitId];
      const slot = plan?.slots?.[command.slot];
      if (!slot || slot.cheer === !!command.on) return same;
      const used = Object.values(battle.plans).reduce((s, p) => s + p.slots.filter((a) => a.cheer).length, 0);
      if (command.on && used >= battle.cheers) return same;
      return withRun(battle, ctx, (run) => {
        run.b.plans[command.unitId].slots[command.slot].cheer = !!command.on;
      });
    }
    case 'commit': {
      if (battle.status !== 'planning') return same;
      return withRun(battle, ctx, (run) => {
        commitRound(run);
        if (!run.b.schedule?.length) afterEntry(run, null);
      });
    }
    case 'step': {
      if (battle.status !== 'running') return same;
      const run = openRun(battle, ctx);
      try {
        stepRun(run);
      } catch (err) {
        if (!(err instanceof AskSignal)) throw err;
        const asking = { ...battle, status: 'asking', ask: plain(err.ask) };
        const ev = [{ t: 'ask', round: battle.round, tick: battle.tick, ask: plain(err.ask) }];
        return { battle: deepFreeze(asking), events: ev };
      }
      return done(run);
    }
    case 'answer': {
      if (battle.status !== 'asking' || !battle.ask) return same;
      return withRun(battle, ctx, (run) => {
        if (U(run, run.b.ask.unitId)) setAnswer(run.b, run.b.ask, command.yes);
        run.b.ask = null;
        run.b.status = 'running';
      });
    }
    case 'mode': {
      if (command.mode !== 'storybook' || battle.mode === 'storybook' || battle.modeNext === 'storybook') return same;
      return withRun(battle, ctx, (run) => {
        run.b.modeNext = 'storybook';
      });
    }
    case 'head-home': {
      return withRun(battle, ctx, (run) => {
        if (run.b.status === 'planning') finish(run, 'home');
        else {
          const u = run.b.units.find((x) => x.side === 'party') || run.b.units[0];
          u.usedRound = { ...(u.usedRound || {}), '#home': 1 };
        }
      });
    }
    case 'wrap': {
      if (!canWrapBattle(battle, ctx)) return same;
      return withRun(battle, ctx, (run) => autoPlay(run, command.maxRounds || 30));
    }
    case 'end': {
      if (command.outcome !== 'won') return same;
      return withRun(battle, ctx, (run) => finish(run, 'won', { summary: command.why === 'seam-closed' ? 'The seam closed while you were away.' : null }));
    }
    default: return same;
  }
}

/**
 * For leads.js: a foe the fight makes, id s<i>, at the end of the ribbon, with a `spawn` event. Pass the
 * hook's ctx as the fourth argument: the foe then gets the creation effects createBattle gives every
 * foe (§4.15: the mode's level shift scaling its Integrity and Strike, Storybook for the first lead).
 * A new kind gets its Talk down entry either way (its need from rules.json's temperaments with ctx).
 */
export function spawnFoe(battle, spec, at, ctx = null) {
  if (!battle || !spec || !at || battle.units.length >= 16) return { battle, events: [] };
  const rules = ctx?.rules || null;
  const b = cloneBattle(battle);
  const id = nextId(b.units.map((u) => u.id), 's');
  const u = unitFrom({ ...spec, id }, at, 'left');
  if (rules) scaleFoe(u, rules, rules.modes?.[effMode(b)]?.foeLevel ?? 0);
  u.heat = idleHeatOf(b, u, rules);
  if (u.talkKind && u.side === 'foe' && !b.talk?.[u.talkKind]) {
    const heroes = b.units.filter((v) => v.side === 'party' && v.rank === 'hero');
    b.talk = { ...(b.talk || {}), [u.talkKind]: { calm: 0, need: talkNeed(rules || {}, u.temperament, heroes, canonBow(ctx?.abilities, u.kind)), done: false } };
  }
  b.units.push(u);
  b.order.push(id);
  const ev = { t: 'spawn', round: b.round, tick: b.tick, unit: viewOf(u, b), object: null };
  return { battle: deepFreeze(b), events: [ev] };
}

/** §11.3's UnitView. */
export function unitView(battle, unitId) {
  const u = unitIn(battle, unitId);
  return u ? viewOf(u, battle) : null;
}

// ---------- saving and restoring: in driver.js, beside the other things a caller drives ----------

export { TERMINAL, normalisePlan, resolveBasic };
// Kernel-internal, for driver.js's saveBattle and restoreBattle (not a public API).
export { unitFrom, scaleFoe, foePlans, decodeSchedule, scheduleOut, normaliseAction, EMPTY_CARRY };
export { saveBattle, restoreBattle } from './driver.js';
// The planner's reads live beside the other options in abilities.js; battle.js exports them (§7.1).
export { legalActions, oddsFor, trouble, project } from './abilities.js';
export { sneakCheck, battleBytes } from './round.js';
