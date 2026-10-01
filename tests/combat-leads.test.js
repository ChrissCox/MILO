// Module I, leads and canon foes in play (CONTRACT-PHASE4.md §4.9, §4.15, §6.6, §7.4, §9.7–§9.8, §17.20;
// COMBAT.md §8.3, §8.5): src/combat/leads.js's MECHANICS (the generic fallback with its Asides and the
// last page, and the eight shipped mechanics with their bows) and FOE_BOWS (the canon foes' bows), played
// through B's kernel. Its own scripted stub minds prove every mechanic can be won on auto.
//   node --test tests/combat-leads.test.js
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import {
  MECHANICS, FOE_BOWS, CANON_BOWS, LEAD_NUMBERS, objectsFor, asidesFor, lastPageOn, stompTiles, clerkSpec,
} from '../src/combat/leads.js';
import {
  rules, RULES_JSON, GENRES, abilities as kitAbilities, realAbilities, hero, stray, fightSpec, A, plan, playRound, findUnit, createBattle, apply,
} from './combat-kit.js';
import { stubMinds, simplePlan, runToEnd, saveBattle, restoreBattle } from '../src/combat/driver.js';
import { legalActions, oddsFor } from '../src/combat/battle.js';
import { ticksOf, oddsAgainst, speedOf } from '../src/combat/round.js';
import { foldBars, draw, degreeAt } from '../src/combat/heat.js';
import { createGrid, unitDist, footprint } from '../src/combat/grid.js';
import { foeUnit } from '../src/combat/bestiary.js';
import { strayRow } from '../src/combat/rules.js';
import * as party from '../src/party.js';
import { emptyState4 } from '../src/state4.js';
import { hashInts } from '../src/world/rng.js';
import { assertCalm, uncosyIn } from './calm.js';
import { loadD, prepareOptions } from './encounters-kit.mjs';

// The winnability proof runs its nine cells in worker threads that import this file: there, no tests register.
const test = isMainThread ? nodeTest : () => {};

const ROOT = new URL('../content/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const LEADS = read('combat/leads.json');
const FOES = read('combat/foes.json');
const SHIPPED = ['throttles-speed', 'streetlights-out', 'snuffs-candles', 'assembly-lines', 'too-big-to-see', 'alibis', 'noon-duel', 'stomps'];
const HOOKS = ['setup', 'roundStart', 'telegraphs', 'actions', 'resolve', 'damageTaken', 'tickEnd', 'roundEnd', 'phaseChange', 'bow'];
const WINS = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page']);
// Names the Log lines here carry that LORE §21 doesn't list (tests only).
const PROPER = ['Tallow', 'Aside', 'Interact', 'Examine', 'Wit', 'Clerk', 'Hollow', 'Sentry', 'Tollman', 'Hush', 'Unwritten', 'Mimic'];

// ---------- fixtures ----------

/** A 20×12 room. */
const ROOM = ['####################', ...Array.from({ length: 10 }, () => '#..................#'), '####################'];

/** A Tale-lead's UnitSpec at (x, y) (Large): a walker stray made a lead, with bars and a ranged option. */
function leadSpec({ mechanic = 'fallback', bars = [60, 60, 60], strike = 6, genre = 'neon', x = 6, y = 3, level = 1, ...over } = {}) {
  const s = stray('lead', { archetype: 'walker', genre, level, x, y, talkKind: null, temperament: 'proud' });
  return {
    ...s, name: 'Tallow', kind: 'lead', talkKind: null, rank: 'lead', size: 2, maxIntegrity: bars[0], integrity: bars[0],
    strike: { ...s.strike, amount: strike }, ranged: { range: 8, amount: strike }, flat: 2, attackEdge: 1, adapt: 3,
    lead: { mechanic, phases: bars.length, bars: [...bars], quote: 'Not today.' }, post: { x, y }, look: { ...s.look, scale: 2 }, ...over,
  };
}

function leadFight({ mechanic = 'fallback', bars, strike, genre = 'neon', objects = [], foes = [], real = null, seed = 777, level = 1, at = {}, entry = null, id = 'fight:test:w:lead' } = {}) {
  const leadUnit = leadSpec({ mechanic, bars, strike, genre, level, ...at });
  return fightSpec({
    id, seed, kind: 'lead', level, genres: [genre], arenaRows: ROOM, arenaOpts: entry ? { entry } : {}, leadUnit, objects, foes, real,
    lead: { mechanic, phases: leadUnit.lead.phases, bow: 'A bow.', quote: 'Not today.' },
  });
}

const keyOf = (t) => `${t.x},${t.y}`;
const obj = (id, kind, x, y, state) => ({ id, kind, x, y, state, flags: [], integrity: null });
const tough = (id, over = {}) => hero(id, { maxIntegrity: 300, integrity: 300, ...over });
const PARTY = () => [tough('milo'), tough('claude'), tough('codex'), tough('pip')];
const QUIET = { calm: { noise: false, adaptation: true } };
const brace = (b, id) => ({ unitId: id, slots: [A.brace()], reactions: {}, by: 'foe', changed: [false] });

/** A CombatCtx with I's mechanics and bows, and stub minds (foes Brace unless told otherwise). */
function ctxWith({ mechanics = MECHANICS, bows = FOE_BOWS, abilityIndex = kitAbilities, foePlan = brace, draft = null, revise = null, extra = null } = {}) {
  const ctx = { rules, abilities: abilityIndex, minds: null, mechanics, bows, genres: GENRES, party: {} };
  const m = stubMinds(ctx, { foePlan, draft });
  ctx.minds = { ...m, ...(revise ? { revise } : {}), ...(extra ? extra(ctx) : {}) };
  return Object.freeze(ctx);
}

const freeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) freeze(v[k]);
  }
  return v;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
/** A Battle with its lead state patched (a phase, a flag) — the kernel treats it as any other state. */
const withLead = (b, patch) => freeze({ ...clone(b), lead: { ...clone(b.lead), ...patch } });
const withData = (b, data) => withLead(b, { data: { ...clone(b.lead.data), ...data } });
const withUnit = (b, id, patch) => freeze({ ...clone(b), units: b.units.map((u) => (u.id === id ? { ...clone(u), ...patch } : clone(u))) });
const withObjects = (b, patch) => freeze({ ...clone(b), objects: b.objects.map((o) => (patch[o.id] ? { ...clone(o), ...patch[o.id] } : clone(o))) });
const objectOf = (b, id) => b.objects.find((o) => o.id === id);
/** A hook's { battle, events } taken as the new Battle. */
const hooked = (b, r) => (r?.battle ? freeze(clone(r.battle)) : b);

/** Plans the listed heroes' slots, commits, and plays the round out (Asks answered yes). */
function go(b, ctx, plans = {}) {
  const events = [];
  const take = (r) => (events.push(...r.events), r.battle);
  let battle = b;
  for (const [id, slots] of Object.entries(plans)) battle = take(apply(battle, { t: 'plan', unitId: id, plan: plan(id, slots) }, ctx));
  battle = take(playRound(take(apply(battle, { t: 'commit' }, ctx)), ctx));
  return { battle, events };
}

const asideActs = (events, round = null) => events.filter((e) => e.t === 'act' && e.unit === 'lead' && e.action?.id === 'aside' && (round === null || e.round === round));
const lines = (events) => events.filter((e) => e.t === 'line').map((e) => e.text);
const use = (ability, cost, target = null) => ({ id: 'use', ability, cost, target, extra: 0, choice: null, cheer: false, trigger: null });

// ---------- the shapes and the content they read ----------

test('MECHANICS holds the fallback and the eight shipped mechanics, each with every §6.6 hook and leads.json’s own text', () => {
  assert.deepEqual(Object.keys(MECHANICS), ['fallback', ...SHIPPED]);
  assert.ok(Object.isFrozen(MECHANICS));
  for (const [id, m] of Object.entries(MECHANICS)) {
    assert.equal(m.id, id);
    assert.ok(Object.isFrozen(m), `${id} is frozen`);
    for (const h of HOOKS) assert.equal(typeof m[h], 'function', `${id}.${h}`);
  }
  assert.equal(MECHANICS.fallback.text, null, 'the fallback has no next-phase trick to reveal');
  for (const m of LEADS.mechanics.filter((x) => x.ships)) {
    assert.equal(MECHANICS[m.id].text, m.text, `${m.id}: leads.json’s text (B’s Wit-3 Examine reads it)`);
    assert.deepEqual(objectsFor(m.id, LEADS), m.objects.map((o) => ({ kind: o.kind, count: o.count, where: o.where })), `${m.id}: objectsFor`);
  }
  assert.deepEqual(objectsFor('fallback', LEADS), []);
  assert.deepEqual(objectsFor('copies', LEADS), [], 'an unshipped mechanic places nothing');
  assert.deepEqual(objectsFor('nothing', LEADS), []);
  for (const k of ['actions', 'resolve', 'afterAction']) assert.equal(typeof FOE_BOWS[k], 'function', `FOE_BOWS.${k}`);
});

test('CANON_BOWS are foes.json’s canon bows and the Mimic’s, kind and count', () => {
  const want = Object.fromEntries([...FOES.canon, FOES.mimic].map((f) => [f.id, { kind: f.bow.kind, count: f.bow.count }]));
  assert.deepEqual(JSON.parse(JSON.stringify(CANON_BOWS)), want);
});

test('leads.json records the numbers leads.js decides, in calm words', () => {
  const rule = Object.fromEntries(LEADS.mechanics.map((m) => [m.id, m.rule]));
  const bow = Object.fromEntries(LEADS.mechanics.map((m) => [m.id, m.bow]));
  assert.match(rule['throttles-speed'], /Slowed 1.*Dazed 2.*one Aside a round/);
  assert.match(rule['streetlights-out'], /start of each round.*one Aside a round/);
  assert.match(rule['snuffs-candles'], /Snuffs 2 candles.*4 or more lit.*one Aside a round/);
  assert.match(rule['assembly-lines'], /Every 2 rounds.*one standing per line.*2 actions.*15%.*spring back/);
  assert.match(rule['too-big-to-see'], /half damage.*2 actions, after an Examine, one a round/);
  assert.match(rule.alibis, /every alibi.*clue.*evidence/);
  assert.match(rule['noon-duel'], /Last page.*first tick.*\+1 edge/);
  assert.match(rule.stomps, /60%.*third tick.*body Resolve/);
  assert.equal(bow.stomps, 'Nobody stomped for a phase.', 'COMBAT §8.3’s own words: a whole phase, played in stomps');
  assert.match(LEADS.fallback.rule, /Asides.*last page.*round 8.*Maud’s Table/);
  assert.equal(LEAD_NUMBERS.leverShare, 0.15);
  assert.equal(LEAD_NUMBERS.stompShare, 0.6);
  assert.equal(RULES_JSON.lead.lastPage, 8);
});

// ---------- Asides (§4.9, §4.15) ----------

test('Asides come by mode and phase: Storybook 1; Long Road 1 in the Opening and 2 from the Twist; Maud’s Table 2, then 3', () => {
  const ctx = ctxWith();
  const want = { storybook: [1, 1, 1], 'long-road': [1, 2, 2], 'mauds-table': [2, 3, 3] };
  const names = ['opening', 'twist', 'last-page'];
  for (const [mode, counts] of Object.entries(want)) {
    const b = createBattle(leadFight(), PARTY(), { mode }, ctx);
    assert.equal(b.lead.data.a.length, counts[0], `${mode}: round 1 plans its Opening’s Asides at creation`);
    for (let bar = 0; bar < 3; bar += 1) {
      const at = withLead(b, { bar, phase: names[bar] });
      assert.equal(asidesFor(at, rules), counts[bar], `${mode} ${names[bar]}`);
      const r = MECHANICS.fallback.roundStart(at, ctx);
      const planned = r.battle.lead.data.a;
      assert.equal(planned.length, counts[bar], `${mode} ${names[bar]}: planned at the round’s start`);
      assert.deepEqual(planned.map((e) => e[0]), [...LEAD_NUMBERS.asideTicks[counts[bar]]], `${mode} ${names[bar]}: ticks`);
      assert.equal(r.battle.lead.asides, counts[bar]);
      const tele = MECHANICS.fallback.telegraphs(r.battle, ctx);
      assert.equal(tele.length, counts[bar]);
      for (const t of tele) assert.ok(t.aside === true && t.unitId === 'lead' && t.words.startsWith('Aside: ') && t.words.length <= 60 && ['strike', 'shoot', 'move', 'mechanic'].includes(t.icon), t.words);
    }
  }
  // A hairline lead has two phases: the Last page counts as past the Opening.
  const hair = createBattle(leadFight({ bars: [40, 40] }), PARTY(), {}, ctx);
  assert.equal(asidesFor(hair, rules), 1);
  assert.equal(asidesFor(withLead(hair, { bar: 1, phase: 'last-page' }), rules), 2);
});

test('in play an Aside lands at the end of its tick: half the Strike, and never one of the turn’s attacks', () => {
  const ctx = ctxWith();
  for (const mode of ['long-road', 'storybook']) {
    const b = withLead(createBattle(leadFight({ bars: [200, 200, 200] }), PARTY(), { mode }, ctx), { bar: 1, phase: 'twist' });
    const r1 = go(b, ctx);
    const r2 = go(r1.battle, ctx);
    const events = [...r1.events, ...r2.events];
    // Round 1 was planned in the Opening; round 2 in the Twist.
    const want = mode === 'long-road' ? [[2], [1, 3]] : [[2], [2]];
    assert.deepEqual(asideActs(events, 1).map((e) => e.tick), want[0], `${mode}: round 1`);
    assert.deepEqual(asideActs(events, 2).map((e) => e.tick), want[1], `${mode}: round 2`);
    const lead = findUnit(r2.battle, 'lead');
    const scale = mode === 'storybook' ? 0.75 : 1;
    let checked = 0;
    events.forEach((e, i) => {
      if (!(e.t === 'act' && e.unit === 'lead' && e.action.id === 'aside')) return;
      const target = e.action.target.unit;
      const dmg = events.slice(i + 1).find((x) => x.t === 'damage' && x.unit === 'lead' && x.target === target);
      const out = events.slice(i + 1).find((x) => x.t === 'outcome' && x.unit === 'lead' && x.target === target);
      assert.ok(out, 'an Aside Strike picks an outcome');
      if (!dmg || out.degree === 'miss') return;
      const ranged = unitDist(findUnit(r2.battle, target), lead) > 1;
      const base = Math.max(1, Math.floor(((ranged ? lead.ranged.amount : lead.strike.amount) + lead.flat) / 2));
      const a = Math.floor(base * scale);
      const want2 = out.degree === 'crit' ? a * 2 : out.degree === 'graze' ? Math.floor(a / 2) : a;
      assert.equal(dmg.amount, want2, `${mode}: ${out.degree} for half the Strike`);
      checked += 1;
    });
    assert.ok(checked >= 2, `${mode}: Aside damage checked (${checked})`);
    assert.equal(events.filter((e) => e.t === 'heat' && e.unit === 'lead' && e.tick > 0).length, 0, 'an Aside adds no heat (a Neon room warms everyone at the round’s start)');
  }
  // After two attacks of its own, an Aside still picks with no attack penalty: it's never one of the turn's attacks.
  const fresh = createBattle(leadFight(), PARTY(), QUIET, ctx);
  const [tick1, , aim] = fresh.lead.data.a[0];
  const busy = withUnit(fresh, 'lead', { attacks: 2 });
  const ra = MECHANICS.fallback.tickEnd(busy, tick1, ctx);
  const pickA = ra.events.find((e) => e.t === 'outcome' && e.unit === 'lead' && e.target === aim);
  const leadU = findUnit(busy, 'lead');
  const targetU = findUnit(busy, aim);
  const asReaction = oddsAgainst(busy, ctx, 'lead', aim, { harmful: true, meets: 'guard', attack: true, reaction: true, ranged: unitDist(leadU, targetU) > 1 });
  const asAttack = oddsAgainst(busy, ctx, 'lead', aim, { harmful: true, meets: 'guard', attack: true, reaction: false, ranged: unitDist(leadU, targetU) > 1 });
  assert.notDeepEqual(asReaction.bars, asAttack.bars, 'a third attack would be at −2 and 40 heat more');
  assert.deepEqual(pickA.bars, asReaction.bars);
  // An Ask can't be asked at a tick's end: it sits the Aside out (as Never), so Proofread's uses aren't spent
  // without a yes; on auto it counts as Always. (Milo only Cools down, so the Scribe's reaction is still hers.)
  const asking = [tough('milo'), tough('claude', { reactions: { shoulder: 'always', proofread: 'ask' }, uses: { proofread: 2 } }), tough('codex'), tough('pip')];
  const still = ctxWith({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  const goBy = (b0, by) => go(asking.reduce((bb, h) => apply(bb, { t: 'plan', unitId: h.id, plan: plan(h.id, h.id === 'milo' ? [A.cool()] : [], { by }) }, still).battle, b0), still);
  const fired = (r) => r.events.some((e) => e.t === 'reaction' && e.unit === 'claude' && e.id === 'proofread');
  let proofread = 0;
  for (let seed = 1; seed < 60 && !proofread; seed += 1) {
    const b0 = createBattle(leadFight({ bars: [200, 200, 200], seed }), asking, QUIET, still);
    const [mine, auto] = [goBy(b0, 'you'), goBy(b0, 'auto')];
    for (const r of [mine, auto]) assert.ok(r.battle.round === 2 && !r.events.some((e) => e.t === 'ask'), 'no Ask for an Aside, and the round finished');
    if (!mine.events.some((e) => e.t === 'outcome' && e.unit === 'lead' && e.bars && e.degree !== 'miss')) continue;
    assert.ok(!fired(mine) && findUnit(mine.battle, 'claude').uses.proofread === 2, 'your round: her Proofread sits it out, no use spent');
    assert.ok(fired(auto), 'on auto: her Proofread fired, as Always');
    proofread += 1;
  }
  assert.equal(proofread, 1, 'an Aside that landed, proofread only on auto');
  // A Stride Aside moves half the lead's Speed (rounded down, at least 1) toward the nearest hero it can't strike.
  const far = createBattle(leadFight({ bars: [200, 200, 200], at: { x: 15, y: 8 } }), PARTY(), QUIET, ctx);
  const [strideTick, what, toward0] = far.lead.data.a[0];
  const leadFar = findUnit(far, 'lead');
  const half = Math.max(1, Math.floor(speedOf(far, leadFar, ctx, { stride: true }) / 2));
  const rs = MECHANICS.fallback.tickEnd(far, strideTick, ctx);
  const walk = createGrid(far, rules).walk('lead', rs.events.filter((e) => e.t === 'move' && e.unit === 'lead').flatMap((e) => e.path));
  assert.ok(what === 'stride' && walk && walk.cost <= half && walk.cost >= Math.max(1, half - 1), `a stride of half its Speed (${half}): cost ${walk?.cost}`);
  assert.ok(unitDist(findUnit(rs.battle, 'lead'), findUnit(far, toward0)) < unitDist(leadFar, findUnit(far, toward0)), 'toward its hero');
  // An 'aside' a plan names reaches resolve too (B's resolveBasic): half a Strike on its target.
  const planned = ctxWith({ foePlan: (bb, id) => (id === 'lead' ? plan(id, [{ ...A.brace(), id: 'aside', target: { unit: 'milo' } }], { by: 'foe' }) : brace(bb, id)) });
  const rp = go(createBattle(leadFight({ bars: [200, 200, 200] }), PARTY(), QUIET, planned), planned);
  const pick = rp.events.find((e) => e.t === 'outcome' && e.unit === 'lead' && e.target === 'milo' && e.tick === 1);
  assert.ok(pick, 'the planned Aside picks against Milo in its tick');
  const hitMilo = rp.events.find((e) => e.t === 'damage' && e.unit === 'lead' && e.target === 'milo' && e.tick === 1);
  if (pick.degree === 'hit') assert.equal(hitMilo.amount, Math.floor((6 + 2) / 2));
});

test('Dazed takes an Aside or the duel as it takes the lead’s own actions: one off Dazed each, never more than 2 in a turn (COMBAT §7)', () => {
  const ctx = ctxWith({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
  const dz = (n, id = 'dazed') => ({ id, n, source: null, data: null });
  const withConds = (b, conds, more = {}) => withUnit(b, 'lead', { conditions: [...findUnit(b, 'lead').conditions, ...conds], ...more });
  const lostIn = (r) => r.events.filter((e) => e.t === 'lost' && e.unit === 'lead').map((e) => `${e.action.id}@${e.tick}:${e.why}`);
  const dazedN = (b) => findUnit(b, 'lead').conditions.find((c) => c.id === 'dazed')?.n ?? 0;
  // Through the hook: lost, one off Dazed and one of the turn's 2, and gone from the plan; Dazed 1 ends with it.
  const b0 = createBattle(leadFight(), PARTY(), {}, ctx);
  const aside = (b) => MECHANICS.fallback.tickEnd(b, b0.lead.data.a[0][0], ctx);
  const one = aside(withConds(b0, [dz(2)]));
  assert.deepEqual([lostIn(one), dazedN(one.battle), findUnit(one.battle, 'lead').usedRound['#dazed'], one.battle.lead.data.a], [['aside@0:dazed'], 1, 1, []]);
  assert.deepEqual([one.events.some((e) => e.t === 'damage'), one.events.filter((e) => e.t === 'condition' && e.id === 'dazed').map((e) => [e.target, e.n, e.on])], [false, [['lead', 1, true]]], 'no hit, and the count-down has its event (§18.3 item 2)');
  assert.ok(aside(withConds(b0, [dz(1)])).events.some((e) => e.t === 'condition' && e.target === 'lead' && e.id === 'dazed' && e.on === false), 'Dazed 1 ends');
  // Two already lost this turn: the Aside goes ahead and Dazed waits. Asleep: lost, and Dazed isn't touched.
  const past = aside(withConds(b0, [dz(2)], { usedRound: { '#dazed': 2 } }));
  assert.deepEqual([lostIn(past), asideActs(past.events).length, dazedN(past.battle)], [[], 1, 2]);
  const slept = aside(withConds(b0, [dz(1, 'drowsy'), dz(2)]));
  assert.deepEqual([lostIn(slept), dazedN(slept.battle)], [['aside@0:asleep'], 2]);
  // In play at Maud's Table (Asides at the ends of ticks 1 and 3), the lead planning three Braces.
  const table = createBattle(leadFight({ bars: [300, 300, 300], strike: 1 }), PARTY(), { mode: 'mauds-table', ...QUIET }, ctx);
  const d2 = go(withConds(table, [dz(2)]), ctx);
  assert.deepEqual([lostIn(d2), dazedN(d2.battle), asideActs(d2.events).map((e) => e.tick)], [['brace@1:dazed', 'aside@1:dazed'], 0, [3]], 'Dazed 2: two lost');
  const perRound = [];
  for (let b = withConds(table, [dz(4)]), round = 1; round <= 3; round += 1) {
    const r = go(b, ctx);
    perRound.push(lostIn(r).length);
    b = r.battle;
  }
  assert.deepEqual(perRound, [2, 2, 0], 'Dazed 4: two a turn, two turns running');
  // Long Road's Twist (two Asides), with Throttles speed's own Dazed 2: two lost, never three.
  const road = createBattle(leadFight({ mechanic: 'throttles-speed', bars: [300, 300, 300], strike: 1 }), PARTY(), QUIET, ctx);
  const rt = go(withConds(freeze(clone(MECHANICS['throttles-speed'].setup(withLead(road, { bar: 1, phase: 'twist' }), ctx))), [dz(2)]), ctx);
  assert.deepEqual([lostIn(rt).length, dazedN(rt.battle)], [2, 0], lostIn(rt).join(', '));
  // The noon duel: lost with the tick-1 Brace to Dazed 2 and fought the next round; past the 2 a turn, fought at once.
  const n0 = createBattle(leadFight({ mechanic: 'noon-duel', genre: 'frontier', bars: [300, 300, 300] }), PARTY(), QUIET, ctx);
  const noon = freeze({ ...clone(hooked(n0, MECHANICS['noon-duel'].roundStart(withLead(n0, { bar: 2, phase: 'last-page' }), ctx))), telegraphs: [] });
  const n1 = go(withConds(noon, [dz(2)]), ctx);
  assert.deepEqual([lostIn(n1), dazedN(n1.battle)], [['brace@1:dazed', 'aside@1:dazed'], 0]);
  const duelIn = (r) => r.events.some((e) => e.t === 'act' && e.unit === 'lead' && /^Noon: a duel with/.test(e.words));
  assert.ok(duelIn(go(n1.battle, ctx)), 'the next round’s duel is fought');
  const capped = MECHANICS['noon-duel'].tickEnd(withConds(noon, [dz(2)], { usedRound: { '#dazed': 2 } }), 1, ctx);
  assert.ok(duelIn(capped) && dazedN(capped.battle) === 2);
});

test('easing to Storybook mid-fight changes the Asides from the next round’s start, never before', () => {
  const ctx = ctxWith();
  const b = withLead(createBattle(leadFight({ bars: [200, 200, 200] }), PARTY(), {}, ctx), { bar: 1, phase: 'twist' });
  let r = go(b, ctx);
  assert.equal(r.battle.lead.data.a.length, 2, 'round 2 in the Twist on Long Road: 2');
  r = { ...r, battle: apply(r.battle, { t: 'mode', mode: 'storybook' }, ctx).battle };
  assert.equal(r.battle.lead.data.a.length, 2, 'the switch waits for the next round');
  const r2 = go(r.battle, ctx);
  assert.deepEqual([asideActs(r2.events, 2).length, r2.battle.mode, r2.battle.lead.data.a.length], [2, 'storybook', 1], 'round 3: Storybook’s 1');
});

// ---------- plot armour and feints (B's, in play with I's mechanics) ----------

test('plot armour: once a phase, the first effect on its Resolve that lands a Graze or better lands one degree worse; a Miss and Strikes never use it', () => {
  const ctx = ctxWith();
  const entry = [{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
  let used = 0;
  let missKept = 0;
  for (let seed = 1; seed < 400 && (used < 3 || missKept < 1); seed += 1) {
    const b = createBattle(leadFight({ bars: [300, 300, 300], seed, entry }), PARTY(), {}, ctx);
    const shove = A.shove('lead');
    const folded = oddsFor(b, 'milo', shove, ctx)[0].bars;
    const plain = oddsFor(withLead(b, { armourUsed: true }), 'milo', shove, ctx)[0].bars;
    assert.deepEqual(folded, foldBars(plain, { armour: true }), 'the planner shows the armour folded in');
    assert.deepEqual(oddsFor(b, 'milo', A.strike('lead'), ctx)[0].bars, oddsFor(withLead(b, { armourUsed: true }), 'milo', A.strike('lead'), ctx)[0].bars, 'a Strike meets Guard: never armoured');
    const r = go(b, ctx, { milo: [shove] });
    const out = r.events.find((e) => e.t === 'outcome' && e.unit === 'milo' && e.target === 'lead');
    assert.deepEqual(out.bars, folded, 'the odds shown are the odds used');
    const unfoldedMiss = degreeAt(draw(b.seed, b.attempt, out.k), plain) === 'miss';
    if (unfoldedMiss) {
      assert.equal(r.battle.lead.armourUsed, false, 'a Miss doesn’t use it');
      missKept += 1;
    } else {
      assert.equal(r.battle.lead.armourUsed, true);
      used += 1;
      // Used for the phase: the next round's Shove shows plain bars, until a new phase.
      const next = oddsFor(r.battle, 'milo', shove, ctx)[0].bars;
      const fresh = oddsFor(withLead(r.battle, { armourUsed: false }), 'milo', shove, ctx)[0].bars;
      assert.deepEqual(fresh, foldBars(next, { armour: true }));
    }
  }
  assert.ok(used >= 3 && missKept >= 1, `used ${used}, kept by a miss ${missKept}`);
  // A new phase brings it back: break a bar of 1.
  const b = createBattle(leadFight({ bars: [1, 300, 300], entry }), PARTY(), {}, ctx);
  const armoured = withLead(b, { armourUsed: true });
  let broke = null;
  for (let seed = 1; seed < 50 && !broke; seed += 1) {
    const r = go(freeze({ ...clone(armoured), seed }), ctx, { milo: [A.strike('lead')], claude: [A.strike('lead')] });
    if (r.battle.lead.bar === 1) broke = r;
  }
  assert.ok(broke, 'a bar broke');
  assert.equal(broke.battle.lead.armourUsed, false, 'each phase has its own plot armour');
});

test('feints by step: a hairline lead in a room at the party’s level gets step 3 and one feint, spotted a tick early at Heed 3+', async () => {
  const D = await loadD();
  const find = (tier, stage) => {
    for (let i = 0; i < 4000; i += 1) {
      const s = D.riftgen.wildRift({ seed: hashInts(i, 'feint'), tier, depth: 1 });
      if (s.stage === stage && ['neon', 'iron', 'frontier', 'noir'].includes(s.taleLead?.genre) && !s.maelstrom) return s;
    }
    return null;
  };
  const hair = find(1, 'hairline');
  assert.ok(hair, 'a hairline spec');
  const fight = D.encounters.prepareElsewhere(hair, prepareOptions(D, 'wild', { roadLevel: 1, partySize: 4 })).encounters.rooms.find((r) => r.fight.leadUnit).fight;
  assert.equal(fight.level, 1);
  assert.equal(fight.leadUnit.adapt, 3, 'step 3 at the party’s level');
  // The lead's minds feint on its tick-2 action (a Brace in place of whatever it planned).
  const heedy = ctxWith({ foePlan: null, revise: (b, id, tick) => (id === 'lead' && tick === 2 ? A.brace() : null) });
  const party4 = [tough('milo'), tough('claude'), tough('codex'), tough('pip')];
  const b = createBattle(fight, party4, { roadLevel: 1, ...QUIET }, heedy);
  assert.equal(b.lead.feintsLeft, 1, 'one feint a phase');
  assert.ok(b.plans.lead.slots.length >= 2, 'the lead plans a tick-2 action');
  const r = go(b, heedy);
  const feints = r.events.filter((e) => e.t === 'feint' && e.round === 1);
  assert.deepEqual([feints.length, feints[0].spotted, feints[0].tick, r.battle.lead.feintsLeft], [1, true, 1, 0], 'one feint, spotted by Milo’s Heed 3 in tick 1 for its tick-2 action');
  const revised = r.events.find((e) => e.t === 'act' && e.unit === 'lead' && e.round === 1 && e.tick === 2);
  assert.equal(revised?.action.id, 'brace', 'the feint replaced its tick-2 action');
  // Nobody with Heed 3: it isn't spotted, and shows in its own tick.
  const dim = [tough('claude'), tough('codex'), tough('pip')];
  const r2 = go(createBattle(fight, dim, { roadLevel: 1, ...QUIET }, heedy), heedy);
  const f2 = r2.events.filter((e) => e.t === 'feint' && e.round === 1);
  assert.deepEqual([f2.length, f2[0].spotted, f2[0].tick], [1, false, 2]);
  // A room two or more above the party: step 4, two feints a phase; Storybook: none.
  const high = createBattle(fight, party4, { roadLevel: 1, mode: 'mauds-table' }, heedy);
  assert.equal(high.lead.feintsLeft, 2, 'Maud’s Table adapts a step more');
  assert.equal(createBattle(fight, party4, { roadLevel: 1, mode: 'storybook' }, heedy).lead.feintsLeft, 0);
  assert.equal(createBattle({ ...fight, level: 3 }, party4, { roadLevel: 1 }, heedy).lead.feintsLeft, 2, 'step 4');
});

// ---------- the last page, the first lead and real rifts ----------

test('the last page: at the end of round 8 a lead facing a party that’s still standing yields, but never at Maud’s Table', () => {
  const strike = (b, id) => ({ unitId: id, slots: [A.strike(b.units.find((u) => u.side === 'party' && u.rank === 'hero' && !u.offline)?.id || 'milo')], reactions: {}, by: 'foe', changed: [false] });
  const ctx = ctxWith({ foePlan: strike });
  const play8 = (mode, opts = {}) => {
    let b = createBattle(leadFight({ bars: [5000, 5000, 5000], strike: 1 }), PARTY(), { mode, ...opts }, ctx);
    const seen = [];
    for (let i = 0; i < 12 && b.status === 'planning'; i += 1) {
      const r = go(b, ctx, { milo: [A.use('mote', { unit: 'lead' })] });
      seen.push(...r.events);
      b = r.battle;
    }
    return { b, seen };
  };
  for (const mode of ['long-road', 'storybook']) {
    const { b, seen } = play8(mode);
    assert.deepEqual([b.status, b.result.outcome, b.result.rounds], ['last-page', 'last-page', 8], mode);
    assert.ok(lines(seen).includes('Tallow reaches the last page and yields.'));
  }
  const maud = play8('mauds-table');
  assert.ok(maud.b.status === 'planning' && maud.b.round > 8 && !lastPageOn(maud.b, rules), 'Maud’s Table plays on');
  // The first lead Chris meets plays as Storybook, so its last page holds even at Maud's Table.
  const first = play8('mauds-table', { firstLead: true });
  assert.equal(first.b.status, 'last-page');
  // The hook itself: before round 8, or with no one standing, no yield.
  const ctx2 = ctxWith();
  const b = createBattle(leadFight(), PARTY(), {}, ctx2);
  assert.equal(MECHANICS.fallback.roundEnd(freeze({ ...clone(b), round: 7 }), ctx2).yielded, false);
  assert.equal(MECHANICS.fallback.roundEnd(freeze({ ...clone(b), round: 8 }), ctx2).yielded, true);
  const down = freeze({ ...clone(b), round: 8, units: b.units.map((u) => (u.side === 'party' ? { ...clone(u), offline: true, integrity: 0 } : clone(u))) });
  assert.equal(MECHANICS.fallback.roundEnd(down, ctx2).yielded, false);
});

test('the first lead uses every Storybook modifier, whatever the mode: its Asides, bars, damage, adaptation and last page', () => {
  const ctx = ctxWith();
  const spec = leadFight({ bars: [120, 120, 120] });
  const first = createBattle(spec, PARTY(), { mode: 'mauds-table', firstLead: true }, ctx);
  const plain = createBattle(spec, PARTY(), { mode: 'long-road' }, ctx);
  for (let bar = 0; bar < 3; bar += 1) assert.equal(asidesFor(withLead(first, { bar }), rules), 1, 'Storybook’s one Aside in every phase');
  assert.ok(first.lead.feintsLeft === 0 && lastPageOn(first, rules), 'no adaptation, no feints, and its last page');
  const ratio = strayRow(rules, 'integrity', 0) / strayRow(rules, 'integrity', 1);
  assert.deepEqual([first.lead.bars, plain.lead.bars], [[120, 120, 120].map((x) => Math.max(1, Math.round(x * ratio))), [120, 120, 120]], 'one level down');
  // Its Asides deal Storybook's ×0.75.
  const r = go(first, ctx);
  const act = asideActs(r.events, 1)[0];
  const out = act && r.events.find((e) => e.t === 'outcome' && e.unit === 'lead' && e.round === 1 && e.target === act.action.target.unit);
  const dmg = act && r.events.find((e) => e.t === 'damage' && e.unit === 'lead' && e.round === 1 && e.target === act.action.target.unit);
  assert.ok(act && out);
  if (dmg) {
    const lead = findUnit(first, 'lead');
    const ranged = unitDist(findUnit(first, act.action.target.unit), lead) > 1;
    const a = Math.floor(Math.max(1, Math.floor(((ranged ? lead.ranged.amount : lead.strike.amount) + lead.flat) / 2)) * 0.75);
    assert.equal(dmg.amount, out.degree === 'crit' ? a * 2 : out.degree === 'graze' ? Math.floor(a / 2) : a);
  }
});

test('a real rift’s lead yields and names its cause, when its bars run out and when it bows', () => {
  const real = { key: 'real:habitack', cause: 'The Habitack checks are still red.' };
  const entry = [{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 8, y: 3 }, { x: 8, y: 4 }];
  const ctx = ctxWith();
  let yielded = null;
  for (let seed = 1; seed < 60 && !yielded; seed += 1) {
    let b = createBattle(leadFight({ bars: [3, 3], real, seed, entry }), PARTY(), {}, ctx);
    for (let i = 0; i < 4 && b.status === 'planning'; i += 1) b = go(b, ctx, Object.fromEntries(['milo', 'claude', 'codex', 'pip'].map((id) => [id, [A.strike('lead'), A.strike('lead')]]))).battle;
    if (b.status === 'yielded') yielded = b;
  }
  assert.ok(yielded, 'the bars ran out');
  assert.deepEqual(yielded.result.real, { cause: real.cause });
  // A bow in a real rift yields too: three junctions rerouted in one phase.
  const junctions = [obj('o0', 'junction', 5, 5, 'off'), obj('o1', 'junction', 6, 5, 'off'), obj('o2', 'junction', 9, 2, 'off')];
  const fight = leadFight({ mechanic: 'throttles-speed', bars: [300, 300, 300], real, objects: junctions, entry: [{ x: 5, y: 4 }, { x: 6, y: 6 }, { x: 9, y: 3 }, { x: 1, y: 1 }] });
  const b = createBattle(fight, PARTY(), {}, ctx);
  const r = go(b, ctx, { milo: [A.interact({ object: 'o0' })], claude: [A.interact({ object: 'o1' })], codex: [A.interact({ object: 'o2' })] });
  assert.deepEqual([r.battle.status, r.battle.result.real], ['yielded', { cause: real.cause }]);
});

// ---------- the eight mechanics (COMBAT §8.3) ----------

test('Throttles speed: the party is Slowed 1 until every junction is rerouted, then the lead is Dazed 2; the bow is all three in one phase', () => {
  const ctx = ctxWith();
  const junctions = [obj('o0', 'junction', 5, 6, 'off'), obj('o1', 'junction', 6, 6, 'off'), obj('o2', 'junction', 9, 2, 'off')];
  const entry = [{ x: 5, y: 5 }, { x: 6, y: 7 }, { x: 9, y: 3 }, { x: 1, y: 1 }];
  const b = createBattle(leadFight({ mechanic: 'throttles-speed', bars: [300, 300, 300], objects: junctions, entry }), PARTY(), QUIET, ctx);
  for (const h of b.units.filter((u) => u.side === 'party' && u.rank === 'hero')) {
    const c = h.conditions.find((x) => x.id === 'slowed');
    assert.ok(c && c.n === 1 && !c.data?.fresh, `${h.id} is Slowed 1 from round 1`);
    assert.equal(ticksOf(plan(h.id, [A.brace(), A.brace(), A.brace()]), h)[2].lost, 'slowed', 'the third action is lost');
  }
  // Round 1: two rerouted; an Interact on a rerouted junction does nothing more.
  let r = go(b, ctx, { milo: [A.interact({ object: 'o0' }), A.interact({ object: 'o0' })], claude: [A.interact({ object: 'o1' })] });
  assert.deepEqual([objectOf(r.battle, 'o0').state, objectOf(r.battle, 'o1').state], ['on', 'on']);
  assert.ok(lines(r.events).includes('That junction’s already rerouted.'));
  assert.deepEqual(r.battle.lead.bow, { progress: 2, need: 3 });
  for (const h of r.battle.units.filter((u) => u.side === 'party' && u.rank === 'hero')) {
    const c = h.conditions.find((x) => x.id === 'slowed');
    assert.ok(c && !c.data?.fresh, `${h.id} is Slowed again at round 2’s start, on this round’s ticks`);
  }
  // A phase passes: the third alone is no bow, but the power comes back on and the lead reels.
  const twist = withLead(hooked(r.battle, MECHANICS['throttles-speed'].phaseChange(r.battle, 'opening', 'twist', ctx)), { bar: 1, phase: 'twist' });
  assert.deepEqual(twist.lead.data.p, []);
  const r2 = go(twist, ctx, { codex: [A.interact({ object: 'o2' })] });
  assert.equal(r2.battle.status, 'planning', 'no bow: not all three in one phase');
  assert.ok(r2.events.some((e) => e.t === 'condition' && e.target === 'lead' && e.id === 'dazed' && e.n === 2), 'Dazed 2');
  assert.ok(r2.events.some((e) => e.t === 'condition' && e.id === 'slowed' && e.on === false), 'the Slowed ends');
  assert.ok(r2.battle.units.filter((u) => u.side === 'party' && u.rank === 'hero').every((h) => !h.conditions.some((c) => c.id === 'slowed')), 'nobody Slowed while the power’s on');
  // From the Twist its first Aside throttles a junction again.
  const planned = r2.battle.lead.data.a;
  assert.equal(planned[0][1], 'push');
  assert.ok(['o0', 'o1', 'o2'].includes(planned[0][2]));
  const pushed = MECHANICS['throttles-speed'].tickEnd(withUnit(r2.battle, 'lead', { conditions: [] }), planned[0][0], ctx);
  assert.equal(objectOf(pushed.battle, planned[0][2]).state, 'off');
  assert.ok(pushed.events.some((e) => e.t === 'act' && e.action.id === 'aside' && e.words.startsWith('Aside: throttle the junction at')));
  // All three in one phase: the bow.
  const r3 = go(b, ctx, { milo: [A.interact({ object: 'o0' })], claude: [A.interact({ object: 'o1' })], codex: [A.interact({ object: 'o2' })] });
  assert.deepEqual([r3.battle.status, r3.battle.result.bow, findUnit(r3.battle, 'lead').sorted], ['bowed', true, 'bowed']);
});

test('Streetlights out: a lamp goes dark each round and an Interact relights it; the bow is every lamp lit in the Last page', () => {
  const ctx = ctxWith();
  const lamps = [obj('o0', 'lamp', 4, 6, 'lit'), obj('o1', 'lamp', 6, 6, 'lit'), obj('o2', 'lamp', 9, 1, 'lit'), obj('o3', 'lamp', 12, 8, 'lit')];
  const entry = [{ x: 4, y: 5 }, { x: 6, y: 7 }, { x: 9, y: 2 }, { x: 12, y: 7 }];
  const b = createBattle(leadFight({ mechanic: 'streetlights-out', genre: 'nocturne', objects: lamps, entry, bars: [300, 300, 300] }), PARTY(), QUIET, ctx);
  const dark = (x) => x.objects.filter((o) => o.kind === 'lamp' && o.state === 'dark').map((o) => o.id);
  assert.equal(dark(b).length, 1, 'one lamp goes dark in round 1');
  assert.ok(!b.lights.some((l) => l.id === dark(b)[0]) && b.lights.filter((l) => l.source === 'lamp').length === 3, 'its light goes with it');
  const next = go(b, ctx);
  assert.equal(dark(next.battle).length, 2, 'another at round 2’s start');
  // Relighting brings its light back; a lit lamp stays lit.
  const who = { o0: 'milo', o1: 'claude', o2: 'codex', o3: 'pip' };
  const plans = Object.fromEntries(dark(next.battle).map((id) => [who[id], [A.interact({ object: id })]]));
  const lit = Object.keys(who).find((id) => !dark(next.battle).includes(id));
  plans[who[lit]] = [A.interact({ object: lit })];
  const r = go(next.battle, ctx, plans);
  assert.ok(lines(r.events).includes('That lamp’s already lit.'));
  for (const id of dark(next.battle)) {
    const at = r.events.findIndex((e) => e.t === 'object' && e.object === id && e.state === 'lit');
    assert.ok(at >= 0, `${id} relit`);
    assert.ok(r.events.slice(at).find((e) => e.t === 'light')?.lights.some((l) => l.id === id && l.radius === rules.lights.lamp), `${id}: its light is back`);
  }
  assert.ok(r.battle.status === 'planning' && MECHANICS['streetlights-out'].bow(r.battle, ctx).progress === 0, 'all lit in the Opening is no bow');
  // In the Last page, every lamp lit ends it as a bow.
  const last = withLead(next.battle, { bar: 2, phase: 'last-page' });
  const r2 = go(last, ctx, Object.fromEntries(dark(last).map((id) => [who[id], [A.interact({ object: id })]])));
  assert.equal(r2.battle.status, 'bowed');
  // From the Twist the first Aside turns another off.
  const twist = withLead(next.battle, { bar: 1, phase: 'twist' });
  const rs = hooked(twist, MECHANICS['streetlights-out'].roundStart(twist, ctx));
  assert.equal(rs.lead.data.a[0][1], 'push');
  const before = dark(rs).length;
  const pushed = hooked(rs, MECHANICS['streetlights-out'].tickEnd(rs, rs.lead.data.a[0][0], ctx));
  assert.equal(dark(pushed).length, before + 1);
});

test('Snuffs candles: two snuffed each round; with 4 or more lit it loses its resistance; the bow is every candle lit at once', () => {
  const ctx = ctxWith();
  // Six candles around Milo's tile, so he can reach every one.
  const candles = [[3, 7], [4, 7], [5, 7], [3, 9], [4, 9], [5, 9]].map(([x, y], i) => obj(`o${i}`, 'candle', x, y, 'lit'));
  const entry = [{ x: 4, y: 8 }, { x: 8, y: 8 }, { x: 10, y: 8 }, { x: 12, y: 8 }];
  const fight = leadFight({ mechanic: 'snuffs-candles', genre: 'gothic', objects: candles, entry, bars: [300, 300, 300] });
  const b = createBattle(fight, PARTY(), QUIET, ctx);
  const litIds = (x) => x.objects.filter((o) => o.kind === 'candle' && o.state === 'lit').map((o) => o.id);
  const darkIds = (x) => x.objects.filter((o) => o.kind === 'candle' && o.state === 'dark').map((o) => o.id);
  assert.deepEqual([litIds(b).length, b.lights.filter((l) => l.source === 'candle').length], [4, 4], 'two snuffed in round 1, their lights with them');
  const m = MECHANICS['snuffs-candles'];
  assert.equal(findUnit(b, 'lead').resist.dread, 3);
  assert.equal(m.damageTaken(b, { target: 'lead', amount: 5, kind: 'dread', degree: 'hit', source: 'test' }, ctx), 8, '4 lit: its resistance comes back off');
  assert.equal(m.damageTaken(b, { target: 'lead', amount: 5, kind: 'ink', degree: 'hit', source: 'test' }, ctx), 5, 'a kind it doesn’t resist');
  assert.equal(m.damageTaken(b, { target: 'lead', amount: 0, kind: 'dread', degree: 'hit', source: 'test' }, ctx), 0, 'nothing through stays nothing');
  const three = withObjects(b, { [litIds(b)[0]]: { state: 'dark' } });
  assert.equal(m.damageTaken(three, { target: 'lead', amount: 5, kind: 'dread', degree: 'hit', source: 'test' }, ctx), 5, '3 lit: it resists');
  // It adds back only the resistance the kernel used: a ghost lead inside the lantern's light has none to Plain.
  const ghost = createBattle({ ...fight, leadUnit: { ...fight.leadUnit, archetype: 'ghost', resist: { dread: 3, plain: 3 } } }, PARTY(), QUIET, ctx);
  assert.equal(m.damageTaken(ghost, { target: 'lead', amount: 5, kind: 'plain', degree: 'hit', source: 'test' }, ctx), 5, 'in the Hooklight');
  const unlit = freeze({ ...clone(ghost), lights: ghost.lights.filter((l) => l.id !== 'hooklight') });
  assert.equal(m.damageTaken(unlit, { target: 'lead', amount: 5, kind: 'plain', degree: 'hit', source: 'test' }, ctx), 8, 'out of it');
  // In play: relight the two in round 1, and every candle lit at once is the bow.
  const [d0, d1] = darkIds(b);
  const r1 = go(b, ctx, { milo: [A.interact({ object: d0 }), A.interact({ object: d1 })] });
  assert.deepEqual([r1.battle.status, r1.events.find((e) => e.t === 'end').round], ['bowed', 1]);
  // A lit candle stays lit; left alone, two more go out at round 2's start.
  const r0 = go(b, ctx, { milo: [A.interact({ object: litIds(b)[0] })] });
  assert.ok(lines(r0.events).includes('That candle’s already lit.'));
  assert.ok(!r0.events.some((e) => e.t === 'object' && e.object === litIds(b)[0] && e.round === 1), 'no toggling it dark');
  assert.equal(litIds(r0.battle).length, 2, 'two more at round 2’s start');
  const allLit = withObjects(r0.battle, Object.fromEntries(candles.map((c) => [c.id, { state: 'lit' }])));
  assert.deepEqual(m.bow(allLit, ctx), { progress: 6, need: 6, done: true });
  // From the Twist its first Aside snuffs one more.
  const twist = withLead(allLit, { bar: 1, phase: 'twist' });
  const rs = hooked(twist, m.roundStart(twist, ctx));
  assert.deepEqual([litIds(rs).length, rs.lead.data.a[0][1]], [4, 'push']);
  assert.equal(litIds(hooked(rs, m.tickEnd(rs, rs.lead.data.a[0][0], ctx))).length, 3);
});

test('Assembly lines: a line makes a clerk through spawnFoe every 2 rounds; a lever (2 actions) shuts one and takes 15%; the bow is every line shut', () => {
  const ctx = ctxWith();
  const objects = [obj('o0', 'line', 14, 1, 'running'), obj('o1', 'line', 16, 1, 'running'), obj('o2', 'line', 18, 1, 'running'),
    obj('o3', 'lever', 3, 6, 'up'), obj('o4', 'lever', 5, 6, 'up'), obj('o5', 'lever', 9, 8, 'up')];
  const entry = [{ x: 3, y: 5 }, { x: 5, y: 7 }, { x: 9, y: 7 }, { x: 1, y: 1 }];
  const b = createBattle(leadFight({ mechanic: 'assembly-lines', genre: 'iron', objects, entry, bars: [100, 100, 100] }), PARTY(), QUIET, ctx);
  const m = MECHANICS['assembly-lines'];
  // The lever is a mechanic action: offered beside one, greyed away from them.
  const near = legalActions(b, 'milo', ctx).find((o) => o.action.ability === 'mech:pull-the-lever');
  assert.ok(near && near.why === null && near.cost === 2 && near.targets.some((t) => t.object === 'o3'));
  assert.equal(legalActions(b, 'pip', ctx).find((o) => o.action.ability === 'mech:pull-the-lever').why, 'Stand beside a lever');
  // Round 1: no clerk; Milo pulls; an Interact on a lever or a line does nothing.
  const r1 = go(b, ctx, { milo: [use('mech:pull-the-lever', 2, { object: 'o3' })], claude: [A.interact({ object: 'o4' })] });
  assert.equal(r1.events.filter((e) => e.t === 'spawn' && e.round === 1).length, 0, 'no clerk in round 1');
  const shut = r1.battle.objects.filter((o) => o.kind === 'line' && o.state === 'shut').map((o) => o.id);
  assert.deepEqual(shut, ['o0'], 'the nearest running line shuts');
  const hit = r1.events.find((e) => e.t === 'damage' && e.target === 'lead' && e.unit === 'milo');
  assert.deepEqual([hit.amount, findUnit(r1.battle, 'lead').integrity], [Math.round(0.15 * 100), 100 - 15], '15% of the current bar');
  assert.equal(objectOf(r1.battle, 'o4').state, 'up');
  assert.ok(lines(r1.events).includes('A lever takes both hands: pull it with 2 actions.'));
  assert.equal(objectOf(r1.battle, 'o3').state, 'up', 'levers spring back at the round’s end');
  // Round 2's start: a running line makes one clerk, through spawnFoe.
  const spawns = r1.events.filter((e) => e.t === 'spawn');
  assert.equal(spawns.length, 1);
  const clerk = findUnit(r1.battle, spawns[0].unit.id);
  assert.ok(/^s\d+$/.test(clerk.id) && clerk.name === 'Clerk' && clerk.rank === 'lackey', clerk.id);
  assert.ok(['o1', 'o2'].some((id) => unitDist(clerk, objectOf(r1.battle, id)) <= 1), 'beside a running line');
  assert.ok(r1.battle.order.at(-1) === clerk.id, 'at the end of the ribbon');
  assert.ok(r1.battle.talk.clerk && !r1.battle.talk.clerk.done, 'clerks can be talked down');
  // Round 3 (the Opening): none; round 4: one more from another line.
  const r2 = go(r1.battle, ctx);
  assert.equal(r2.events.filter((e) => e.t === 'spawn').length, 0);
  const r3 = go(r2.battle, ctx);
  const more = r3.events.filter((e) => e.t === 'spawn');
  assert.equal(more.length, 1);
  const pairs = r3.battle.lead.data.c;
  assert.equal(new Set(pairs.map(([line]) => line)).size, pairs.length, 'one standing clerk per line');
  // From the Twist, every round.
  const twist = withLead(r1.battle, { bar: 1, phase: 'twist' });
  assert.equal(go(twist, ctx).events.filter((e) => e.t === 'spawn' && e.round === 3).length, 1, 'round 3, odd, in the Twist');
  // Every line shut is the bow.
  const two = withObjects(r1.battle, { o1: { state: 'shut' } });
  const r4 = go(two, ctx, { milo: [use('mech:pull-the-lever', 2, { object: 'o3' })] });
  assert.equal(r4.battle.status, 'bowed');
  // With the lead settled, its clerks clock off.
  const settled = withUnit(r3.battle, 'lead', { sorted: 'settled', integrity: 0 });
  const off = m.tickEnd(settled, 1, ctx);
  assert.ok(off.battle.units.filter((u) => u.name === 'Clerk').every((u) => u.sorted === 'settled'));
});

test('clerks talked down stay talked down: the lines make no more, and the levers still work', () => {
  const ctx = ctxWith();
  const objects = [obj('o0', 'line', 14, 1, 'running'), obj('o1', 'line', 16, 1, 'running'), obj('o2', 'line', 18, 1, 'running'),
    obj('o3', 'lever', 3, 9, 'up'), obj('o4', 'lever', 5, 9, 'up'), obj('o5', 'lever', 9, 9, 'up')];
  const b = createBattle(leadFight({ mechanic: 'assembly-lines', genre: 'iron', objects, bars: [300, 300, 300], entry: [{ x: 13, y: 2 }, { x: 15, y: 2 }, { x: 17, y: 2 }, { x: 1, y: 1 }] }), PARTY(), QUIET, ctx);
  const r1 = go(b, ctx);
  const clerk = r1.battle.units.find((u) => u.name === 'Clerk');
  assert.ok(clerk, 'round 2’s clerk');
  const talkers = r1.battle.units.filter((u) => u.side === 'party' && unitDist(u, clerk) <= 1).map((u) => u.id);
  assert.ok(talkers.length >= 2, `two heroes beside it (${talkers})`);
  const r2 = go(r1.battle, ctx, Object.fromEntries(talkers.map((id) => [id, [A.talk(clerk.id)]])));
  assert.ok(findUnit(r2.battle, clerk.id).sorted === 'talked' && r2.battle.talk.clerk.done);
  // Round 4 would make one (and every round in the Twist): none comes, in either; untalked, round 4 does.
  const r3 = go(r2.battle, ctx);
  assert.equal(r3.events.filter((e) => e.t === 'spawn').length, 0, 'no clerk after the clerks were talked down');
  assert.equal(go(withLead(r2.battle, { bar: 1, phase: 'twist' }), ctx).events.filter((e) => e.t === 'spawn').length, 0, 'none in the Twist either');
  assert.ok(r3.battle.round === 4 && r3.battle.units.filter((u) => u.name === 'Clerk').every((u) => u.sorted), 'no clerk stands past talking to');
  assert.equal(go(go(r1.battle, ctx).battle, ctx).events.filter((e) => e.t === 'spawn').length, 1, 'untalked, round 4 makes a clerk');
  // The lines still run, and the levers are still offered.
  assert.ok(r3.battle.objects.some((o) => o.kind === 'line' && o.state === 'running'));
  assert.ok(legalActions(r3.battle, 'pip', ctx).find((o) => o.action.ability === 'mech:pull-the-lever'));
});

test('a mechanic or bow action planned at another cost, or out of sight, does nothing (B takes any mech: use as planned)', () => {
  const ctx = ctxWith();
  // Name a step from behind a wall: the option is greyed, and planning it anyway names nothing.
  const WALLED = ['####################', ...Array.from({ length: 10 }, () => '#.......#..........#'), '####################'];
  const leadUnit = leadSpec({ mechanic: 'too-big-to-see', genre: 'void', bars: [300, 300, 300], x: 12, y: 4 });
  const f = fightSpec({ id: 'fight:test:w:lead', seed: 5, kind: 'lead', level: 1, genres: ['void'], arenaRows: WALLED, arenaOpts: { entry: [{ x: 10, y: 4 }, { x: 2, y: 2 }, { x: 11, y: 7 }, { x: 13, y: 7 }] }, leadUnit, objects: [],
    lead: { mechanic: 'too-big-to-see', phases: 3, bow: 'A bow.', quote: 'Not today.' } });
  const r1 = go(createBattle(f, PARTY(), QUIET, ctx), ctx, { milo: [A.examine('lead')] });
  assert.ok(findUnit(r1.battle, 'lead').examined && !createGrid(r1.battle, rules).sees(findUnit(r1.battle, 'claude'), findUnit(r1.battle, 'lead')), 'the Scribe is behind the wall');
  assert.equal(legalActions(r1.battle, 'claude', ctx).find((o) => o.action.ability === 'mech:name-a-step').why, 'It’s out of sight');
  const blind = go(r1.battle, ctx, { claude: [use('mech:name-a-step', 2, { unit: 'lead' })] });
  assert.equal(blind.battle.lead.data.n, 0, 'out of sight: no step named');
  assert.ok(lines(blind.events).includes('It’s out of sight. Name a step where you can see it.'));
  // In sight, at the wrong cost (1 action, or none): nothing; at 2 actions, it names the step.
  const step = (cost) => go(r1.battle, ctx, { codex: [use('mech:name-a-step', cost, { unit: 'lead' })] });
  assert.ok(lines(step(1).events).includes('That takes 2 actions.'));
  assert.deepEqual([0, 1, 2].map((cost) => step(cost).battle.lead.data.n), [0, 0, 1]);
  for (const t of [...lines(blind.events), ...lines(step(1).events)]) assertCalm(t, 'a Log line', { proper: PROPER });
  // A lever and a holster at the wrong cost; a bow's action too (Read aloud takes 2).
  const lv = [obj('o0', 'line', 14, 1, 'running'), obj('o1', 'lever', 3, 6, 'up')];
  const bl = createBattle(leadFight({ mechanic: 'assembly-lines', genre: 'iron', objects: lv, entry: [{ x: 3, y: 5 }, { x: 5, y: 7 }, { x: 9, y: 7 }, { x: 1, y: 1 }], bars: [100, 100, 100] }), PARTY(), QUIET, ctx);
  const pulled = go(bl, ctx, { milo: [use('mech:pull-the-lever', 1, { object: 'o1' })] });
  assert.ok(objectOf(pulled.battle, 'o0').state === 'running' && findUnit(pulled.battle, 'lead').integrity === 100, 'a one-action pull shuts nothing');
  const hol = MECHANICS['noon-duel'].resolve(withData(withLead(createBattle(leadFight({ mechanic: 'noon-duel', genre: 'frontier' }), PARTY(), QUIET, ctx), { bar: 2, phase: 'last-page' }), { w: 'milo', h: 0 }), 'milo', use('mech:holster', 2), ctx);
  assert.equal(hol.battle.lead.data.h, 0, 'a holster is 1 action');
  const bctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const cave = createBattle(caveFight([canonFoe('unwritten', { x: 12, y: 3 })], [obj('o0', 'lectern', 4, 4, 'idle')], { entry: [{ x: 4, y: 3 }, { x: 8, y: 8 }, { x: 9, y: 8 }, { x: 2, y: 1 }] }), quiet(PARTY()), {}, bctx);
  const quick = FOE_BOWS.resolve(cave, 'milo', use('mech:read-aloud', 1, { object: 'o0' }), bctx);
  assert.ok(objectOf(quick.battle, 'o0').state === 'idle' && !quick.battle.talk.unwritten.done, 'a one-action reading reads nothing');
  assert.equal(FOE_BOWS.resolve(cave, 'milo', use('mech:read-aloud', 2, { object: 'o0' }), bctx).battle.talk.unwritten.done, true, 'at 2 actions it reads');
});

test('a clerk is §4.9’s lackey at the room’s n: a polite walker of the lead’s genre, with every UnitSpec field', () => {
  const ctx = ctxWith();
  for (const [n, integrity, strike] of [[1, 10, 4], [5, 38, 9], [10, 80, 15]]) {
    const b = createBattle(leadFight({ mechanic: 'assembly-lines', genre: 'iron', level: n }), PARTY(), QUIET, ctx);
    const c = clerkSpec(b, rules);
    assert.deepEqual([c.maxIntegrity, c.strike.amount, c.level, c.temperament, c.strike.kind, c.genres, c.resist.grind],
      [integrity, strike, Math.max(0, n - 2), 'polite', 'grind', ['iron'], strayRow(rules, 'resist', c.level)], `n ${n}`);
    assert.deepEqual(Object.keys(c), Object.keys(stray('x')), 'every §5.2 field, in order');
  }
});

test('Too big to see: half damage until a step is named this phase; Name a step needs an Examine and comes one a round; three is the bow', () => {
  const ctx = ctxWith();
  const m = MECHANICS['too-big-to-see'];
  const b = createBattle(leadFight({ mechanic: 'too-big-to-see', genre: 'void', bars: [300, 300, 300] }), PARTY(), QUIET, ctx);
  const hit = (x) => m.damageTaken(x, { target: 'lead', amount: 9, kind: 'plain', degree: 'hit', source: 't' }, ctx);
  assert.equal(hit(b), 4, 'half, rounded down');
  assert.equal(legalActions(b, 'claude', ctx).find((o) => o.action.ability === 'mech:name-a-step').why, 'Examine it first');
  const early = go(b, ctx, { claude: [use('mech:name-a-step', 2, { unit: 'lead' })] });
  assert.equal(early.battle.lead.data.n, 0, 'named before any Examine: nothing');
  assert.ok(lines(early.events).includes('It’s too big to see. Examine it first.'));
  // Round 1: Milo Examines in tick 1; the Scribe's step (ticks 1–2) comes after it.
  const r1 = go(b, ctx, { milo: [A.examine('lead')], claude: [use('mech:name-a-step', 2, { unit: 'lead' })], codex: [use('mech:name-a-step', 2, { unit: 'lead' })] });
  assert.deepEqual([r1.battle.lead.data.n, r1.battle.lead.data.s], [1, 1], 'one step named, and shrunk');
  assert.ok(lines(r1.events).includes('One step at a time: it’s already shrinking this round.'));
  assert.equal(hit(r1.battle), 9, 'shrunk: full damage for the phase');
  assert.equal(legalActions(r1.battle, 'claude', ctx).find((o) => o.action.ability === 'mech:name-a-step').why, null, 'a new round');
  // A new phase: it grows back.
  const grown = hooked(r1.battle, m.phaseChange(r1.battle, 'opening', 'twist', ctx));
  assert.deepEqual([grown.lead.data.s, hit(grown)], [0, 4]);
  // Three named: the bow.
  const r2 = go(r1.battle, ctx, { claude: [use('mech:name-a-step', 2, { unit: 'lead' })] });
  assert.equal(r2.battle.lead.data.n, 2);
  const r3 = go(r2.battle, ctx, { codex: [use('mech:name-a-step', 2, { unit: 'lead' })] });
  assert.equal(r3.battle.status, 'bowed');
});

test('Alibis: half damage while every alibi stands; a clue found is evidence, and evidence breaks an alibi; the bow is all of them broken', () => {
  const ctx = ctxWith();
  const m = MECHANICS.alibis;
  const objects = [obj('o0', 'alibi', 3, 6, 'standing'), obj('o1', 'alibi', 5, 6, 'standing'), obj('o2', 'alibi', 9, 8, 'standing'),
    obj('o3', 'clue', 3, 5, 'hidden'), obj('o4', 'clue', 5, 7, 'hidden'), obj('o5', 'clue', 9, 7, 'hidden')];
  const entry = [{ x: 3, y: 5 }, { x: 5, y: 7 }, { x: 9, y: 7 }, { x: 1, y: 1 }];
  const b = createBattle(leadFight({ mechanic: 'alibis', genre: 'noir', objects, entry, bars: [300, 300, 300] }), PARTY(), QUIET, ctx);
  const hit = (x) => m.damageTaken(x, { target: 'lead', amount: 9, kind: 'plain', degree: 'hit', source: 't' }, ctx);
  assert.equal(hit(b), 4);
  // Milo presents nothing first (no evidence), then finds his clue (he stands on it) and presents it.
  const r1 = go(b, ctx, { milo: [A.interact({ object: 'o0' }), A.interact({ object: 'o3' }), A.interact({ object: 'o0' })] });
  assert.ok(lines(r1.events).includes('An alibi needs evidence. Find a clue first.'));
  assert.deepEqual([objectOf(r1.battle, 'o3').state, objectOf(r1.battle, 'o0').state, r1.battle.lead.data.e], ['found', 'broken', 0], 'found, broken, and the evidence spent');
  assert.equal(hit(r1.battle), 9, 'an alibi down: full damage');
  assert.deepEqual(r1.battle.lead.bow, { progress: 1, need: 3 });
  const r2 = go(r1.battle, ctx, { claude: [A.interact({ object: 'o4' }), A.interact({ object: 'o1' })], codex: [A.interact({ object: 'o5' }), A.interact({ object: 'o2' })] });
  assert.equal(r2.battle.status, 'bowed');
});

test('Noon duel: in the Last page the one higher on the ribbon strikes first at +1 edge, in place of its Asides; won, then holstered, is the bow', () => {
  let won = null;
  for (let seed = 1; seed < 300 && !won; seed += 1) {
    const ctx = ctxWith();
    const b0 = createBattle(leadFight({ mechanic: 'noon-duel', genre: 'frontier', bars: [300, 300, 300], seed }), PARTY(), QUIET, ctx);
    const last = hooked(b0, MECHANICS['noon-duel'].roundStart(withLead(b0, { bar: 2, phase: 'last-page' }), ctx));
    const b = freeze({ ...clone(last), telegraphs: [] });
    assert.deepEqual(b.lead.data.a, [], 'no Asides in the Last page');
    const tele = MECHANICS['noon-duel'].telegraphs(b, ctx);
    const duelist = b.order.find((id) => findUnit(b, id).side === 'party' && findUnit(b, id).rank === 'hero');
    assert.deepEqual([tele.length, tele[0].tick, tele[0].targets], [1, 1, [duelist]], 'in tick 1, with the hero highest on the ribbon');
    const r = go(b, ctx);
    const outs = r.events.filter((e) => e.t === 'outcome' && e.round === 1 && e.tick === 1 && [e.unit, e.target].includes('lead') && [e.unit, e.target].includes(duelist));
    assert.ok(outs.length >= 1 && outs.length <= 2);
    const leadFirst = b.order.indexOf('lead') < b.order.indexOf(duelist);
    assert.equal(outs[0].unit, leadFirst ? 'lead' : duelist, 'the higher on the ribbon shoots first');
    // Its bars carry the +1 edge: the same shot without it shows one step less.
    const first = findUnit(b, outs[0].unit);
    const pk = { harmful: true, meets: 'guard', attack: true, reaction: true, ranged: unitDist(first, findUnit(b, outs[0].target)) > 1, light: false };
    const flat = oddsAgainst(b, ctx, first.id, outs[0].target, pk);
    const boosted = oddsAgainst(freeze({ ...clone(b), units: b.units.map((u) => (u.id === first.id ? { ...clone(u), mods: [{ stat: 'edge-next', by: 1, until: 'next-attack', source: 'noon' }] } : clone(u))) }), ctx, first.id, outs[0].target, pk);
    assert.equal(boosted.edge, Math.min(3, flat.edge + 1));
    assert.deepEqual(outs[0].bars, boosted.bars, 'the odds used');
    if (r.battle.lead.data.w === duelist) won = { r, duelist, ctx };
  }
  assert.ok(won, 'a duel won');
  const { r, duelist, ctx } = won;
  const holster = legalActions(r.battle, duelist, ctx).find((o) => o.action.ability === 'mech:holster');
  assert.ok(holster && holster.why === null);
  const other = r.battle.units.find((u) => u.side === 'party' && u.rank === 'hero' && u.id !== duelist);
  assert.equal(legalActions(r.battle, other.id, ctx).find((o) => o.action.ability === 'mech:holster').why, 'Only the duel’s winner holsters');
  const early = go(r.battle, ctx, { [other.id]: [use('mech:holster', 1)] });
  assert.equal(early.battle.lead.data.h, 0, 'only the winner holsters');
  assert.ok(lines(early.events).includes('Win the duel first.'));
  const done = go(r.battle, ctx, { [duelist]: [use('mech:holster', 1)] });
  assert.equal(done.battle.status, 'bowed');
  // The +1 edge never costs a shooter a mod: six held before the duel (a unit's cap) are the same six after.
  const six = Array.from({ length: 6 }, (_, i) => ({ stat: 'guard', by: 1, until: 'fight', source: `test:${i}` }));
  const n0 = createBattle(leadFight({ mechanic: 'noon-duel', genre: 'frontier', bars: [300, 300, 300] }), PARTY(), QUIET, ctx);
  const noon = hooked(n0, MECHANICS['noon-duel'].roundStart(withLead(n0, { bar: 2, phase: 'last-page' }), ctx));
  const first = noon.order.find((id) => findUnit(noon, id).side === 'party' && findUnit(noon, id).rank === 'hero');
  const shot = MECHANICS['noon-duel'].tickEnd(withUnit(withUnit(noon, first, { mods: six }), 'lead', { mods: six }), 1, ctx);
  assert.ok(shot.events.filter((e) => e.t === 'outcome').length >= 1, 'the duel was fought');
  assert.deepEqual([findUnit(shot.battle, first).mods, findUnit(shot.battle, 'lead').mods], [six, six]);
});

test('Stomps: about 60% of the floor telegraphed each round, the plan tiles and fliers spared; a whole phase with nobody stomped is the bow', () => {
  const ctx = ctxWith();
  const plans = [obj('o0', 'plan-tile', 2, 8, 'clear'), obj('o1', 'plan-tile', 3, 8, 'clear'), obj('o2', 'plan-tile', 4, 8, 'clear'), obj('o3', 'plan-tile', 5, 8, 'clear')];
  const fight = leadFight({ mechanic: 'stomps', genre: 'kaiju', objects: plans, bars: [300, 300, 300], entry: [{ x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }] });
  const b = createBattle(fight, PARTY(), QUIET, ctx);
  // The share, over many rounds and attempts.
  let open = 0;
  let stomped = 0;
  for (let round = 1; round <= 40; round += 1) {
    const at = freeze({ ...clone(b), round, attempt: round % 3 });
    const tiles = stompTiles(at);
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    for (const p of plans) assert.ok(!set.has(`${p.x},${p.y}`), 'plan tiles are safe');
    assert.deepEqual(stompTiles(at), tiles, 'deterministic');
    assert.deepEqual(stompTiles(withUnit(at, 'lead', { x: 12, y: 3 })), tiles, 'the same wherever the lead stands');
    open += 18 * 10 - 4;
    stomped += tiles.length;
  }
  assert.ok(stomped / open > 0.55 && stomped / open < 0.65, `share ${stomped / open}`);
  const tele = MECHANICS.stomps.telegraphs(b, ctx).find((t) => t.icon === 'area');
  assert.equal(tele.tick, 3);
  assert.deepEqual(tele.tiles, stompTiles(b));
  // Everyone on a plan tile: clean stomps, but the bow waits for the whole phase ("Nobody stomped for a phase").
  const r1 = go(b, ctx);
  assert.ok(lines(r1.events).includes('Tallow stomps.'));
  const r2 = go(r1.battle, ctx);
  assert.deepEqual([r1.battle.lead.data.st, r2.battle.lead.data.st, r2.battle.lead.data.x, r2.battle.status], [1, 2, 0, 'planning'], 'two clean stomps are not yet a phase');
  assert.deepEqual(MECHANICS.stomps.bow(r2.battle, ctx), { progress: 0, need: 1, done: false });
  // The Opening's bar runs out with nobody stomped in it: the lead bows at the end of that tick.
  const everyone = Object.fromEntries(['milo', 'claude', 'codex', 'pip'].map((id) => [id, [A.strike('lead')]]));
  const strikeDown = (battle) => go(withUnit(battle, 'lead', { x: 3, y: 6, integrity: 1 }), ctx, everyone);
  const bowed = strikeDown(r2.battle);
  const turned = bowed.events.find((e) => e.t === 'phase' && e.unit === 'lead');
  assert.ok(turned?.tick === 1 && bowed.battle.status === 'bowed', 'the Opening ended in tick 1, and it bowed');
  assert.ok(!bowed.events.some((e) => e.t === 'act' && e.unit === 'lead' && e.words === 'Stomp'), 'at once, before the next stomp');
  // A phase that ends before its first stomp, or with someone stomped in it, is no bow.
  for (const [why, from] of [['no stomp yet: nothing was dodged', b], ['someone was stomped this phase', withData(r2.battle, { x: 1 })]]) {
    const r = strikeDown(from);
    assert.deepEqual([r.battle.lead.phase, r.battle.status, r.battle.lead.data.k], ['twist', 'planning', 0], why);
  }
  assert.equal(go(withData(r2.battle, { x: 1 }), ctx).battle.lead.data.x, 1, 'a clean stomp later in the phase doesn’t wipe out an earlier catch');
  // A grounded hero on a stomp tile is caught (a pick against body Resolve); a flier above it isn't.
  const tiles = stompTiles(b);
  const caughtAt = tiles.find((t) => t.x > 8);
  const flierAt = tiles.find((t) => t.x > 8 && (t.x !== caughtAt.x || t.y !== caughtAt.y));
  const mixed = createBattle(fight, [tough('milo'), tough('claude'), tough('codex'), tough('pip', { moves: { flies: true, hovers: false, throughWalls: false, darksight: true } })], QUIET, ctx);
  const placed = withUnit(withUnit(mixed, 'codex', { x: caughtAt.x, y: caughtAt.y }), 'pip', { x: flierAt.x, y: flierAt.y });
  const r3 = go(placed, ctx);
  const picks = r3.events.filter((e) => e.t === 'outcome' && e.unit === 'lead' && e.round === 1 && e.tick === 3);
  assert.deepEqual(picks.map((e) => e.target), ['codex']);
  const lead = findUnit(placed, 'lead');
  const d = r3.events.find((e) => e.t === 'damage' && e.unit === 'lead' && e.target === 'codex');
  const base = lead.strike.amount + lead.flat;
  if (picks[0].degree !== 'miss') {
    assert.equal(d.amount, picks[0].degree === 'crit' ? base * 2 : picks[0].degree === 'graze' ? Math.floor(base / 2) : base);
    assert.equal(r3.battle.lead.data.x, 1, 'a phase with someone stomped');
    assert.equal(MECHANICS.stomps.bow(r3.battle, ctx).progress, 0);
  }
  // A new phase starts clean.
  const fresh = hooked(r3.battle, MECHANICS.stomps.phaseChange(r3.battle, 'opening', 'twist', ctx));
  assert.equal(fresh.lead.data.st, 0);
  assert.equal(fresh.lead.data.x, 0);
});

test('a stomp covers exactly what its planning telegraph showed, however the lead moves in the round', () => {
  const plans = [obj('o0', 'plan-tile', 2, 8, 'clear'), obj('o1', 'plan-tile', 3, 8, 'clear'), obj('o2', 'plan-tile', 4, 8, 'clear'), obj('o3', 'plan-tile', 5, 8, 'clear')];
  // The lead strides away in tick 1; Milo strides onto its old tile in tick 2.
  const leadMoves = (bb, id) => (id === 'lead' ? plan(id, [A.strideTo({ x: 10, y: 3 }), A.brace(), A.brace()], { by: 'foe' }) : brace(bb, id));
  const ctx = ctxWith({ foePlan: leadMoves });
  let onOld = 0;
  let caughtThere = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const fight = leadFight({ mechanic: 'stomps', genre: 'kaiju', objects: plans, bars: [300, 300, 300], seed, entry: [{ x: 5, y: 4 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }] });
    let b = createBattle(fight, PARTY(), QUIET, ctx);
    const shown = new Set(b.telegraphs.find((t) => t.icon === 'area').tiles.map(keyOf));
    assert.deepEqual([...shown].sort(), stompTiles(b).map(keyOf).sort());
    b = apply(b, { t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace(), A.strideTo({ x: 6, y: 4 }), A.brace()]) }, ctx).battle;
    b = apply(b, { t: 'commit' }, ctx).battle;
    const events = [];
    for (let guard = 0; guard < 60 && b.status === 'running'; guard += 1) {
      const r = apply(b, { t: 'step' }, ctx);
      b = r.battle;
      events.push(...r.events);
      if (b.round === 1 && b.status === 'running') {
        const now = b.telegraphs.find((t) => t.icon === 'area');
        if (now) assert.deepEqual(new Set(now.tiles.map(keyOf)), shown, `seed ${seed}: the warning holds through tick ${b.tick}`);
      }
    }
    const milo = findUnit(b, 'milo');
    if (milo.x === 6 && milo.y === 4) onOld += 1;
    // Every stomp pick is against someone standing on a tile the planning telegraph showed.
    const at0 = events.findIndex((x) => x.t === 'act' && x.unit === 'lead' && x.words === 'Stomp' && x.round === 1);
    assert.ok(at0 >= 0, `seed ${seed}: it stomped`);
    const next = events.findIndex((x, i) => i > at0 && x.t === 'act');
    const picks = events.slice(at0 + 1, next < 0 ? undefined : next).filter((x) => x.t === 'outcome' && x.unit === 'lead');
    for (const e of picks) {
      const v = findUnit(b, e.target);
      assert.ok(footprint(v).some((p) => shown.has(keyOf(p))), `seed ${seed}: ${e.target} was warned`);
      if (e.target === 'milo' && milo.x === 6 && milo.y === 4) caughtThere += 1;
    }
    if (milo.x === 6 && milo.y === 4 && shown.has('6,4')) assert.ok(picks.some((e) => e.target === 'milo'), `seed ${seed}: shown, and stomped`);
  }
  assert.ok(onOld >= 5, `Milo reached the lead’s old tile (${onOld} seeds)`);
  assert.ok(caughtThere >= 1, 'and a stomp there was warned of');
});

test('from the Twist a stomps lead’s first Aside tramples a plan tile, which the round’s telegraphed stomp then covers', () => {
  const ctx = ctxWith();
  const plans = [obj('o0', 'plan-tile', 2, 8, 'clear'), obj('o1', 'plan-tile', 3, 8, 'clear'), obj('o2', 'plan-tile', 4, 8, 'clear'), obj('o3', 'plan-tile', 5, 8, 'clear')];
  const fight = leadFight({ mechanic: 'stomps', genre: 'kaiju', objects: plans, bars: [300, 300, 300], entry: [{ x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }] });
  const b0 = createBattle(fight, PARTY(), QUIET, ctx);
  assert.ok(!b0.lead.data.a.some((e) => e[1] === 'push'), 'no trample in the Opening');
  const b = hooked(b0, MECHANICS.stomps.roundStart(withLead(b0, { bar: 1, phase: 'twist' }), ctx));
  const [tick, what, id] = b.lead.data.a[0];
  const o = objectOf(b, id);
  assert.ok(what === 'push' && tick === 1 && o.kind === 'plan-tile', 'its first Aside, at tick 1, tramples a plan tile');
  const tele = MECHANICS.stomps.telegraphs(b, ctx);
  assert.ok(tele.find((t) => t.aside && t.icon === 'mechanic' && t.words.startsWith('Aside: trample the plan at')), 'the trample is telegraphed');
  const area = tele.find((t) => t.icon === 'area');
  assert.ok(area.tiles.some((t) => t.x === o.x && t.y === o.y), 'and the stomp shows the trampled tile from the start');
  for (const p of plans.filter((q) => q.id !== id)) assert.ok(!area.tiles.some((t) => t.x === p.x && t.y === p.y), 'the other plan tiles stay safe');
  // In play: whoever stays on the trampled tile is picked against; it's clear again next round.
  const standing0 = b.units.find((u) => u.side === 'party' && u.x === o.x && u.y === o.y);
  const r = go(freeze({ ...clone(b), telegraphs: tele }), ctx);
  assert.ok(lines(r.events).some((t) => t.startsWith('Tallow tramples the plan at')));
  if (standing0) assert.ok(r.events.some((e) => e.t === 'outcome' && e.unit === 'lead' && e.target === standing0.id && e.tick === 3), 'caught on the trampled tile');
  assert.equal(r.battle.round, 2);
  assert.ok(!(r.battle.lead.data.t || []).includes(id) || r.battle.lead.data.a.some((e) => e[1] === 'push' && e[2] === id), 'a new round starts it clear (or tramples it again)');
  // A trample lost with its Aside (Dazed) only shrinks the stomp.
  const dazed = withUnit(b, 'lead', { conditions: [{ id: 'dazed', n: 2, source: null, data: null }] });
  const lost = hooked(dazed, MECHANICS.stomps.tickEnd(dazed, 1, ctx));
  assert.ok(!stompTiles(lost).some((t) => t.x === o.x && t.y === o.y), 'lost: the plan tile is safe again');
  assert.ok(stompTiles(lost).every((t) => area.tiles.some((s) => s.x === t.x && s.y === t.y)), 'and nothing new is covered');
});

test('from the Twist an alibis lead’s first Aside hides a found clue again while its evidence waits', () => {
  const ctx = ctxWith();
  const objects = [obj('o0', 'alibi', 3, 6, 'standing'), obj('o1', 'alibi', 5, 6, 'standing'), obj('o2', 'alibi', 9, 8, 'standing'),
    obj('o3', 'clue', 3, 5, 'found'), obj('o4', 'clue', 5, 7, 'hidden'), obj('o5', 'clue', 9, 7, 'hidden')];
  const b0 = createBattle(leadFight({ mechanic: 'alibis', genre: 'noir', objects, bars: [300, 300, 300], entry: [{ x: 3, y: 5 }, { x: 5, y: 7 }, { x: 9, y: 7 }, { x: 1, y: 1 }] }), PARTY(), QUIET, ctx);
  const twist = withData(withLead(b0, { bar: 1, phase: 'twist' }), { e: 1 });
  const b = hooked(twist, MECHANICS.alibis.roundStart(twist, ctx));
  assert.deepEqual(b.lead.data.a[0], [1, 'push', 'o3'], 'its first Aside goes for the found clue');
  assert.ok(MECHANICS.alibis.telegraphs(b, ctx).some((t) => t.aside && t.icon === 'mechanic' && t.words.startsWith('Aside: hide the clue at')));
  const r = hooked(b, MECHANICS.alibis.tickEnd(b, 1, ctx));
  assert.ok(objectOf(r, 'o3').state === 'hidden' && r.lead.data.e === 0, 'hidden again, and the evidence goes with it');
  // Found again, it's evidence again: every alibi can still be broken.
  const again = go(r, ctx, { milo: [A.interact({ object: 'o3' }), A.interact({ object: 'o0' })] });
  assert.equal(objectOf(again.battle, 'o0').state, 'broken');
  // Spent first, there's nothing to hide: presenting at tick 1 beats the tick-1 Aside.
  const spent = go(b, ctx, { milo: [A.interact({ object: 'o0' })] });
  assert.ok(objectOf(spent.battle, 'o0').state === 'broken' && objectOf(spent.battle, 'o3').state === 'found', 'broken, and the clue stays found');
  // No evidence waiting: no push, a plain Aside.
  const none = hooked(b0, MECHANICS.alibis.roundStart(withLead(b0, { bar: 1, phase: 'twist' }), ctx));
  assert.ok(!none.lead.data.a.some((e) => e[1] === 'push'));
});

test('the fallback: the other 24 mechanics (and Maelstroms) fight as a plain lead with Asides and no bow', async () => {
  const D = await loadD();
  const ctx = ctxWith();
  const b = createBattle(leadFight(), PARTY(), {}, ctx);
  assert.deepEqual([MECHANICS.fallback.bow(b, ctx), MECHANICS.fallback.actions(b, 'milo', ctx), MECHANICS.fallback.damageTaken(b, { target: 'lead', amount: 7, kind: 'plain', degree: 'hit', source: 't' }, ctx)],
    [{ progress: 0, need: 0, done: false }, [], 7]);
  assert.equal(MECHANICS.fallback.tickEnd(withData(b, { a: [] }), 2, ctx), null, 'nothing due, nothing done');
  assert.equal(MECHANICS.fallback.resolve(b, 'milo', A.interact({ unit: 'claude' }), ctx), null, 'not its to resolve');
  // D maps every unshipped fighting mechanic to the fallback; B then uses MECHANICS.fallback.
  let checked = 0;
  for (const m of D.leads.mechanics.filter((x) => !x.ships && !x.noFight)) {
    for (let i = 0; i < 400; i += 1) {
      const s = D.riftgen.wildRift({ seed: hashInts(i, 'fallback'), tier: 2, depth: 1 });
      if (s.taleLead?.genre !== m.genre || s.maelstrom) continue;
      const f = D.encounters.prepareElsewhere({ ...s, taleLead: { ...s.taleLead, mechanic: m.text } }, prepareOptions(D, 'wild', { roadLevel: 2 }))
        .encounters.rooms.find((r) => r.fight.leadUnit)?.fight;
      if (!f) break;
      assert.equal(f.lead.mechanic, 'fallback', m.id);
      const battle = createBattle(f, PARTY(), { roadLevel: 2 }, ctx);
      assert.equal(battle.lead.mechanic, 'fallback');
      assert.equal(battle.lead.data.a.length, 1, `${m.id}: its Opening Aside`);
      checked += 1;
      break;
    }
  }
  assert.ok(checked >= 20, `unshipped mechanics checked: ${checked}`);
});

// ---------- the canon foes' bows (COMBAT §8.5) ----------

const REAL = realAbilities();
const canonFoe = (id, at, n = 1) => foeUnit(id === 'mimic' ? FOES.mimic : FOES.canon.find((f) => f.id === id), n, { level: n, rank: 'stray', rules, foes: FOES, partySize: 4, roadLevel: 1, id: 'f0', post: at });
const second = (id, at, n = 1) => ({ ...canonFoe(id, at, n), id: 'f1' });
const toll = () => tough('codex', { id: 'tollkeeper', kind: 'tollkeeper', name: 'The Tollkeeper', abilities: { might: 3, grace: -1, grit: 2, wit: 2, heed: 1, charm: 0 }, abilityIds: ['riddle-me'] });
function caveFight(foes, objects = [], { entry = null, seed = 99 } = {}) {
  return fightSpec({ id: 'fight:cave:3,4:20480:r1', seed, kind: 'cave', genres: [], arenaRows: ROOM, arenaOpts: entry ? { entry } : {}, foes, objects });
}
const quiet = (heroes) => heroes.map((h) => ({ ...h, abilityIds: h.abilityIds.filter((id) => id === 'riddle-me') }));
function paysLikeTalking(battle) {
  assert.equal(battle.status, 'talked');
  const s4 = emptyState4();
  const state = { ...s4, satchel: { materials: {}, essences: {}, essenceGenres: {}, relics: [], marks: 0, tonics: { cordial: 0, brew: 0 } } };
  const paid = party.payFight(state, battle.id, { weight: 2, n: 1, deepRank: 0, xp: 20, marks: 8, essences: [], relic: null, tonics: { cordial: 0, brew: 0 } }, battle.result, 1, { rules });
  assert.equal(paid.paid, true, 'the room pays');
  assert.ok(paid.xp > 0);
}

test('the Mimic’s bow: someone Interacts to open it, and it settles back into a chest, paying as a talk-down', () => {
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const b = createBattle(caveFight([canonFoe('mimic', { x: 4, y: 3 })], [], { entry: [{ x: 3, y: 3 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }] }), quiet(PARTY()), {}, ctx);
  assert.ok(legalActions(b, 'milo', ctx).find((o) => o.action.id === 'interact').targets.some((t) => t.unit === 'f0'), 'an Interact on the foe beside you');
  const r = go(b, ctx, { milo: [A.interact({ unit: 'f0' })] });
  assert.deepEqual([findUnit(r.battle, 'f0').sorted, r.battle.talk.mimic.done, r.battle.result.calmed], ['talked', true, ['mimic']]);
  paysLikeTalking(r.battle);
});

test('the Unwritten settle to listen: the Scribe’s Interact beside one, or 2 actions at a lectern', () => {
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const entry = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 8, y: 8 }, { x: 1, y: 1 }];
  const fight = caveFight([canonFoe('unwritten', { x: 4, y: 3 }), second('unwritten', { x: 12, y: 8 })], [obj('o0', 'lectern', 8, 9, 'idle')], { entry });
  const b = createBattle(fight, quiet(PARTY()), {}, ctx);
  // Milo's Interact is no reading.
  const r0 = go(b, ctx, { milo: [A.interact({ unit: 'f0' })] });
  assert.equal(findUnit(r0.battle, 'f0').sorted, null);
  const r1 = go(b, ctx, { claude: [A.interact({ unit: 'f0' })] });
  assert.equal(r1.battle.status, 'talked', 'the whole kind settles');
  paysLikeTalking(r1.battle);
  // The lectern: offered to a hero beside it, greyed for the rest; an Interact there alone is no reading.
  const offer = FOE_BOWS.actions(b, 'codex', ctx).find((o) => o.action.ability === 'mech:read-aloud');
  assert.deepEqual([offer.why, offer.cost], [null, 2]);
  assert.equal(FOE_BOWS.actions(b, 'milo', ctx).find((o) => o.action.ability === 'mech:read-aloud').why, 'Stand beside the lectern');
  assert.ok(legalActions(b, 'codex', ctx).some((o) => o.action.ability === 'mech:read-aloud'), 'B merges it into the legal actions');
  const r2 = go(b, ctx, { codex: [A.interact({ object: 'o0' })] });
  assert.ok(objectOf(r2.battle, 'o0').state === 'idle' && lines(r2.events).includes('Reading aloud takes 2 actions at the lectern.'));
  const r3 = go(b, ctx, { codex: [use('mech:read-aloud', 2, { object: 'o0' })] });
  assert.deepEqual([objectOf(r3.battle, 'o0').state, r3.battle.status], ['read', 'talked']);
});

test('the Tollmen wave you across: the Tollkeeper’s Riddle me beside one, or a Wit 3+ hero’s 2 actions at the riddle board', () => {
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const entry = [{ x: 1, y: 1 }, { x: 8, y: 8 }, { x: 1, y: 2 }, { x: 3, y: 3 }];
  const heroes = quiet([tough('milo'), tough('claude'), tough('codex'), toll()]);
  const fight = caveFight([canonFoe('tollmen', { x: 4, y: 3 })], [obj('o0', 'riddle-board', 8, 9, 'idle')], { entry });
  const b = createBattle(fight, heroes, {}, ctx);
  // A plain Interact is no riddle, even the Tollkeeper's (§6.6: only `open`, `walk` and `read` take one).
  assert.equal(FOE_BOWS.resolve(b, 'tollkeeper', A.interact({ unit: 'f0' }), ctx), null);
  const r1 = go(b, ctx, { tollkeeper: [A.interact({ unit: 'f0' })] });
  assert.ok(findUnit(r1.battle, 'f0').sorted === null && r1.battle.status !== 'talked', 'the Tollkeeper’s Interact settles nobody');
  // Riddle me, landed beside one: its Drawn mark answers the riddle.
  let landed = 0;
  let missed = 0;
  for (let seed = 1; seed < 80 && (landed < 1 || missed < 1); seed += 1) {
    const bs = createBattle({ ...fight, seed }, heroes, {}, ctx);
    const r = go(bs, ctx, { tollkeeper: [use('riddle-me', 1, { unit: 'f0' })] });
    const out = r.events.find((e) => e.t === 'outcome' && e.unit === 'tollkeeper');
    if (out.degree === 'hit' || out.degree === 'crit') {
      assert.equal(r.battle.status, 'talked');
      landed += 1;
    } else {
      assert.equal(findUnit(r.battle, 'f0').sorted, null, 'a riddle that doesn’t land answers nothing');
      missed += 1;
    }
  }
  assert.ok(landed && missed, `landed ${landed}, missed ${missed}`);
  // Only his Riddle me, and only beside one: his Drawn mark from 2 tiles off, or Milo's beside, answers nothing.
  const riddled = (by, at) => FOE_BOWS.afterAction(withUnit(withUnit(b, 'f0', { marks: [{ id: 'drawn', by, n: 1, until: 'next-action' }] }), by, at), by, use('riddle-me', 1, { unit: 'f0' }), ctx)?.battle.talk.tollmen.done === true;
  assert.deepEqual([riddled('tollkeeper', { x: 3, y: 3 }), riddled('tollkeeper', { x: 6, y: 3 }), riddled('milo', { x: 4, y: 4 })], [true, false, false]);
  // The riddle board: the Scribe (Wit 3) can answer; Milo (Wit 0) can't.
  const board = FOE_BOWS.actions(b, 'claude', ctx).find((o) => o.action.ability === 'mech:answer-the-riddle');
  assert.equal(board.why, null);
  const byMilo = createBattle({ ...fight, arena: { ...fight.arena, entry: [{ x: 8, y: 8 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 3 }] } }, heroes, {}, ctx);
  assert.equal(FOE_BOWS.actions(byMilo, 'milo', ctx).find((o) => o.action.ability === 'mech:answer-the-riddle').why, 'Needs Wit 3');
  const refused = go(byMilo, ctx, { milo: [use('mech:answer-the-riddle', 2, { object: 'o0' })] });
  assert.equal(objectOf(refused.battle, 'o0').state, 'idle');
  const r2 = go(b, ctx, { claude: [use('mech:answer-the-riddle', 2, { object: 'o0' })] });
  assert.deepEqual([objectOf(r2.battle, 'o0').state, r2.battle.status], ['solved', 'talked']);
  paysLikeTalking(r2.battle);
});

test('cinder golems sit down, warm: an Interact stokes the forge, then a Light hit lights it', () => {
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const entry = [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
  const b = createBattle(caveFight([canonFoe('cinder-golems', { x: 14, y: 3 })], [obj('o0', 'forge', 8, 9, 'cold')], { entry }), quiet(PARTY()), {}, ctx);
  assert.equal(FOE_BOWS.actions(b, 'milo', ctx).filter((o) => o.action.ability === 'mech:light-the-forge').length, 0, 'nothing to light while it’s cold');
  const cold = go(b, ctx, { milo: [use('mech:light-the-forge', 1, { object: 'o0' })] });
  assert.ok(findUnit(cold.battle, 'f0').sorted === null && lines(cold.events).includes('The forge needs stoking, then a Light hit.'), 'a cold forge won’t light');
  const r1 = go(b, ctx, { claude: [A.interact({ object: 'o0' })] });
  assert.deepEqual([objectOf(r1.battle, 'o0').state, findUnit(r1.battle, 'f0').sorted], ['stoked', null], 'stoked alone settles nobody');
  assert.equal(FOE_BOWS.actions(r1.battle, 'milo', ctx).find((o) => o.action.ability === 'mech:light-the-forge').why, null, 'Milo’s lantern');
  assert.equal(FOE_BOWS.actions(r1.battle, 'claude', ctx).find((o) => o.action.ability === 'mech:light-the-forge').why, 'Needs a Light hit: Milo’s lantern, or a Dip');
  const r2 = go(r1.battle, ctx, { milo: [use('mech:light-the-forge', 1, { object: 'o0' })] });
  assert.equal(r2.battle.status, 'talked');
  paysLikeTalking(r2.battle);
});

test('Hush hounds heel when the same hero walks beside one two turns running', () => {
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const entry = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 1 }];
  const heroes = quiet(PARTY());
  const fight = caveFight([canonFoe('hush-hounds', { x: 4, y: 3 })], [], { entry });
  // A hound already holding 6 mods (a unit's cap) keeps every one: the walk is kept on its talk entry.
  const six = Array.from({ length: 6 }, (_, i) => ({ stat: 'guard', by: -1, until: 'fight', source: `test:${i}` }));
  const b = withUnit(createBattle(fight, heroes, {}, ctx), 'f0', { mods: six });
  const walk = (id) => ({ [id]: [A.interact({ unit: 'f0' }), A.interact({ unit: 'f0' })] });
  const r1 = go(b, ctx, walk('milo'));
  assert.ok(findUnit(r1.battle, 'f0').sorted === null && lines(r1.events).includes('Milo has already walked with it this turn.'), 'twice in a turn is one turn');
  assert.deepEqual([findUnit(r1.battle, 'f0').mods, r1.battle.talk['hush-hounds'].walk], [six, { milo: [1, 1] }], 'no mod of the hound’s is lost');
  assert.deepEqual(restoreBattle(JSON.parse(JSON.stringify(saveBattle(r1.battle))), ctx, { fight, heroes }), r1.battle, 'the walk survives a save');
  // Another hero doesn't carry Milo's walk on: it's the same hero, two turns running.
  const r2 = go(r1.battle, ctx, walk('claude'));
  assert.equal(findUnit(r2.battle, 'f0').sorted, null, 'Milo, then the Scribe: nobody has walked it twice');
  // A turn missed starts Milo's count again.
  const r3 = go(r2.battle, ctx, walk('milo'));
  assert.equal(findUnit(r3.battle, 'f0').sorted, null, 'Milo missed a turn');
  const r4 = go(r3.battle, ctx, walk('milo'));
  assert.equal(r4.battle.status, 'talked');
  paysLikeTalking(r4.battle);
  // The Scribe's own second turn running settles them too.
  assert.equal(go(r2.battle, ctx, walk('claude')).battle.status, 'talked');
  // Walking with a hound you can't reach is no walk.
  assert.equal(FOE_BOWS.resolve(r1.battle, 'codex', A.interact({ unit: 'f0' }), ctx), null);
});

test('drowned bell-ringers adjourn after three Talk downs, or the bell rung at the lectern; Hollow Sentries need three too', () => {
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const entry = [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 2 }, { x: 8, y: 8 }];
  const heroes = quiet([tough('milo'), tough('claude'), tough('codex'), tough('pip', { abilities: { might: -1, grace: 1, grit: 1, wit: 2, heed: 0, charm: 0 } })]);
  for (const id of ['drowned-bell-ringers', 'hollow-sentries']) {
    const b = createBattle(caveFight([canonFoe(id, { x: 5, y: 3 })], [obj('o0', 'lectern', 8, 9, 'idle'), obj('o1', 'bell', 9, 9, 'still')], { entry }), heroes, {}, ctx);
    assert.ok([2, 3].includes(b.talk[id].need), `${id}: at creation, its temperament’s need or (§18.3 item 9, B) its bow.count`);
    const r1 = go(b, ctx, { milo: [A.talk('f0')] });
    assert.deepEqual([r1.battle.talk[id].need, findUnit(r1.battle, 'f0').sorted], [3, null], `${id}: three Talk downs, after the first action`);
    const r2 = go(r1.battle, ctx, { milo: [A.talk('f0')], claude: [A.talk('f0')] });
    assert.equal(r2.battle.status, 'talked', id);
    paysLikeTalking(r2.battle);
  }
  // Charm 3+ in the party: one fewer, at least 2.
  const charmed = quiet([tough('milo'), tough('claude'), tough('codex'), tough('pip')]);
  const c = createBattle(caveFight([canonFoe('hollow-sentries', { x: 5, y: 3 })], [], { entry }), charmed, {}, ctx);
  assert.equal(go(c, ctx, { milo: [A.talk('f0')] }).battle.talk['hollow-sentries'].need, 2);
  // The bell, rung at the lectern (COMBAT §8.5): from beside the lectern, never from beside the bell alone.
  const bell0 = createBattle(caveFight([canonFoe('drowned-bell-ringers', { x: 5, y: 3 })], [obj('o0', 'lectern', 8, 9, 'idle'), obj('o1', 'bell', 10, 9, 'still')], { entry }), heroes, {}, ctx);
  const bell = withUnit(bell0, 'codex', { x: 10, y: 8 });
  const offer = FOE_BOWS.actions(bell, 'pip', ctx).find((o) => o.action.ability === 'mech:ring-the-bell');
  assert.equal(offer.why, null, 'beside the lectern');
  assert.equal(FOE_BOWS.actions(bell, 'milo', ctx).find((o) => o.action.ability === 'mech:ring-the-bell').why, 'Stand beside the lectern');
  assert.equal(FOE_BOWS.actions(bell, 'codex', ctx).find((o) => o.action.ability === 'mech:ring-the-bell').why, 'Stand beside the lectern', 'beside the bell alone');
  for (const tried of [use('mech:ring-the-bell', 1, { object: 'o1' }), A.interact({ object: 'o1' })]) {
    const r = go(bell, ctx, { codex: [tried] });
    assert.ok(objectOf(r.battle, 'o1').state === 'still' && findUnit(r.battle, 'f0').sorted === null, `${tried.id}: not from beside the bell`);
    assert.ok(lines(r.events).includes('The bell is rung from the lectern.'), tried.id);
  }
  const rung = go(bell, ctx, { pip: [use('mech:ring-the-bell', 1, { object: 'o1' })] });
  assert.equal(objectOf(rung.battle, 'o1').state, 'rung');
  assert.equal(rung.battle.status, 'talked');
});

// ---------- saving, replaying and the scripted player ----------

/** I's scripted stub minds: patch and reboot, work the mechanic's objects, else strike the nearest. */
const act = (id, extra = {}) => ({ id, ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null, ...extra });
const USEFUL = { junction: ['off'], lamp: ['dark'], candle: ['dark'], clue: ['hidden'], forge: ['cold'] };

function toward(g, u, tile, speed) {
  let best = null;
  let bestD = unitDist(u, tile);
  let bestC = 0;
  for (const [k, v] of g.reachable(u.id, { budget: speed })) {
    const [x, y] = k.split(',').map(Number);
    const d = unitDist({ x, y, size: u.size || 1 }, tile);
    if (d < bestD || (d === bestD && best && v.cost < bestC)) {
      best = { x, y };
      bestD = d;
      bestC = v.cost;
    }
  }
  const path = best ? g.path(u.id, best, { budget: speed }) : null;
  return path && path.length ? { path, near: bestD <= 1 } : null;
}

function workPlan(b, unitId, ctx) {
  const u = findUnit(b, unitId);
  const empty = { unitId, slots: [], reactions: {}, by: 'draft', changed: [] };
  if (!u || u.offline || u.sorted) return empty;
  const g = createGrid(b, ctx.rules);
  const strikes = () => simplePlan(b, unitId, ctx, { by: 'draft' }).slots;
  const fill = (slots, used) => {
    let ticks = used;
    for (const a of strikes().filter((x) => x.id === 'strike' || x.id === 'brace')) {
      if (ticks >= 3) break;
      slots.push(a);
      ticks += a.cost;
    }
    return { ...empty, slots };
  };
  const heroes = b.units.filter((v) => v.side === 'party' && v.rank === 'hero' && !v.offline && !v.sorted);
  const idx = heroes.findIndex((v) => v.id === unitId);
  const down = b.units.find((v) => v.side === 'party' && v.rank === 'hero' && v.offline && (v.drops || 0) < 2 && unitDist(u, v) <= 1);
  if (down) return { ...empty, slots: [act('reboot', { cost: 2, target: { unit: down.id } })] };
  if ((u.abilityIds || []).includes('letter')) {
    const low = heroes.filter((v) => v.integrity < v.maxIntegrity / 2 && unitDist(u, v) <= 6 && (v.id === u.id || g.sees(u, v)))
      .sort((p, q) => p.integrity / p.maxIntegrity - q.integrity / q.maxIntegrity)[0];
    if (low) return fill([act('use', { ability: 'letter', cost: 2, target: { unit: low.id } })], 2);
  }
  if (b.lead?.mechanic === 'stomps') {
    const tiles = new Set(stompTiles(b).map(keyOf));
    if (tiles.has(keyOf(u)) && !u.moves?.flies) {
      const speed = speedOf(b, u, ctx, { stride: true });
      const safe = new Set((b.objects || []).filter((o) => o.kind === 'plan-tile').map(keyOf));
      let best = null;
      let bc = Infinity;
      for (const [k, v] of g.reachable(u.id, { budget: speed })) {
        if (tiles.has(k)) continue;
        const c = v.cost - (safe.has(k) ? 0.5 : 0);
        if (c < bc) {
          bc = c;
          best = k;
        }
      }
      if (best) {
        const [x, y] = best.split(',').map(Number);
        const path = g.path(u.id, { x, y }, { budget: speed });
        if (path?.length) {
          const moved = { ...b, units: b.units.map((v) => (v.id === u.id ? { ...v, x, y } : v)) };
          return { ...empty, slots: [act('stride', { target: { path } }), ...simplePlan(moved, unitId, ctx, { by: 'draft' }).slots.filter((a) => a.id === 'strike').slice(0, 2)] };
        }
      }
    }
    return { ...empty, slots: strikes() };
  }
  const mech = b.lead ? ctx.mechanics[b.lead.mechanic] || ctx.mechanics.fallback : null;
  const ready = [...(mech ? mech.actions(b, unitId, ctx) : []), ...(ctx.bows ? ctx.bows.actions(b, unitId, ctx) : [])].find((o) => !o.why);
  if (ready) return fill([{ ...ready.action, target: Array.isArray(ready.targets) ? ready.targets[0] || null : null }], ready.cost);
  if (b.lead?.mechanic === 'too-big-to-see' && !findUnit(b, 'lead')?.examined && idx === 0) return fill([act('examine', { target: { unit: 'lead' } })], 1);
  const data = b.lead?.data || {};
  const useful = (b.objects || []).filter((o) => (USEFUL[o.kind] || []).includes(o.state) || (o.kind === 'alibi' && o.state === 'standing' && data.e > 0)
    || (o.kind === 'lever' && o.state === 'up' && (b.objects || []).some((x) => x.kind === 'line' && x.state === 'running')));
  if (useful.length && idx >= 0 && idx < useful.length) {
    const o = [...useful].sort((p, q) => unitDist(u, p) - unitDist(u, q) || (p.id < q.id ? -1 : 1))[0];
    if (unitDist(u, o) <= 1) return o.kind === 'lever' ? fill([], 0) : fill([act('interact', { target: { object: o.id } })], 1);
    if (!(u.conditions || []).some((c) => c.id === 'tangled')) {
      const t = toward(g, u, o, speedOf(b, u, ctx, { stride: true }));
      if (t) return { ...empty, slots: [act('stride', { target: { path: t.path } }), ...(t.near && o.kind !== 'lever' ? [act('interact', { target: { object: o.id } })] : [])] };
    }
  }
  return { ...empty, slots: strikes() };
}

const workers = (ctx) => ({ draft: (b, id) => ({ unitId: id, plan: workPlan(b, id, ctx), confidence: 35, source: 'personality', why: [], choices: [] }) });

/** One synthetic fight per mechanic, with its objects and a party near them. */
function mechanicFight(id, seed = 5, bars = [40, 40, 40]) {
  const objects = {
    'throttles-speed': [obj('o0', 'junction', 3, 7, 'off'), obj('o1', 'junction', 9, 9, 'off'), obj('o2', 'junction', 15, 2, 'off')],
    'streetlights-out': [obj('o0', 'lamp', 3, 7, 'lit'), obj('o1', 'lamp', 9, 9, 'lit'), obj('o2', 'lamp', 15, 2, 'lit'), obj('o3', 'lamp', 16, 9, 'lit')],
    'snuffs-candles': [[3, 7], [5, 8], [9, 9], [12, 8], [15, 2], [16, 9]].map(([x, y], i) => obj(`o${i}`, 'candle', x, y, 'lit')),
    'assembly-lines': [obj('o0', 'line', 14, 1, 'running'), obj('o1', 'line', 16, 1, 'running'), obj('o2', 'line', 18, 1, 'running'), obj('o3', 'lever', 3, 7, 'up'), obj('o4', 'lever', 9, 9, 'up'), obj('o5', 'lever', 15, 7, 'up')],
    'too-big-to-see': [],
    alibis: [obj('o0', 'alibi', 3, 8, 'standing'), obj('o1', 'alibi', 9, 9, 'standing'), obj('o2', 'alibi', 16, 3, 'standing'), obj('o3', 'clue', 4, 7, 'hidden'), obj('o4', 'clue', 10, 8, 'hidden'), obj('o5', 'clue', 15, 8, 'hidden')],
    'noon-duel': [],
    stomps: [obj('o0', 'plan-tile', 2, 8, 'clear'), obj('o1', 'plan-tile', 3, 8, 'clear'), obj('o2', 'plan-tile', 12, 8, 'clear'), obj('o3', 'plan-tile', 13, 8, 'clear')],
    fallback: [],
  }[id];
  const genre = { 'throttles-speed': 'neon', 'streetlights-out': 'nocturne', 'snuffs-candles': 'gothic', 'assembly-lines': 'iron', 'too-big-to-see': 'void', alibis: 'noir', 'noon-duel': 'frontier', stomps: 'kaiju', fallback: 'neon' }[id];
  return leadFight({ mechanic: id, genre, objects, seed, bars, strike: 6, at: { x: 10, y: 4 } });
}

test('saving and restoring a lead fight at every step gives back the same Battle, Asides, clerks and mechanic objects included', () => {
  for (const id of ['fallback', ...SHIPPED]) {
    for (const seed of [3, 11]) {
      const ctx = ctxWith({ foePlan: null, extra: workers });
      const fight = mechanicFight(id, seed);
      const heroes = PARTY().map((h) => ({ ...h, maxIntegrity: 60, integrity: 60 }));
      let b = createBattle(fight, heroes, {}, ctx);
      let steps = 0;
      for (let guard = 0; guard < 400 && b.status !== 'won' && !['bowed', 'talked', 'yielded', 'last-page', 'offline', 'home'].includes(b.status); guard += 1) {
        const saved = restoreBattle(JSON.parse(JSON.stringify(saveBattle(b))), ctx, { fight, heroes });
        assert.ok(saved, `${id}: restores`);
        assert.deepEqual(saved, b, `${id}: step ${steps} restores deep-equal`);
        if (b.status === 'planning') {
          const plans = {};
          for (const u of b.units) if (u.side === 'party' && u.rank === 'hero' && !u.offline) plans[u.id] = workPlan(b, u.id, ctx);
          for (const [uid, p] of Object.entries(plans)) b = apply(b, { t: 'plan', unitId: uid, plan: p }, ctx).battle;
          b = apply(b, { t: 'commit' }, ctx).battle;
        } else b = apply(b, b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' }, ctx).battle;
        steps += 1;
      }
      assert.ok(steps > 10, `${id}: played ${steps} steps`);
    }
  }
});

test('replaying a lead fight’s commands gives the same Battle, with every mechanic', () => {
  for (const id of ['fallback', ...SHIPPED]) {
    const ctx = ctxWith({ foePlan: null, extra: workers });
    const fight = mechanicFight(id, 21);
    const commands = [];
    let b = createBattle(fight, PARTY(), {}, ctx);
    for (let guard = 0; guard < 300 && ['planning', 'running', 'asking'].includes(b.status); guard += 1) {
      const send = (c) => {
        commands.push(c);
        b = apply(b, c, ctx).battle;
      };
      if (b.status !== 'planning') send(b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' });
      else {
        for (const u of b.units) if (u.side === 'party' && u.rank === 'hero' && !u.offline) send({ t: 'plan', unitId: u.id, plan: workPlan(b, u.id, ctx) });
        send({ t: 'commit' });
      }
    }
    let again = createBattle(fight, PARTY(), {}, ctx);
    for (const c of commands) again = apply(again, c, ctx).battle;
    assert.deepEqual(again, b, id);
  }
});

// The winnability proof uses D's real encounters and C's real heroes, at the numbers as written: rules.json
// without tuning.json (integrityFactor 1, leads.json's xInt), which H's tune.mjs rewrites as it tunes; H2 repeats
// the proof with the tuned numbers and the real minds (§13).
async function realWorld() {
  const D = await loadD();
  const rulesJson = read('combat/rules.json');
  const companions = Object.fromEntries(readdirSync(new URL('party/companions/', ROOT)).map((f) => [f.slice(0, -5), read(`party/companions/${f}`)]));
  const content = {
    genres: read('genres.json'), riftgen: read('riftgen.json'),
    combat: { rules: rulesJson, callings: read('combat/callings.json'), spells: read('combat/spells.json'), leads: LEADS, foes: FOES },
    party: { companions, regulars: read('party/regulars.json'), teamups: read('party/teamups.json'), banter: read('party/banter.json') },
  };
  const heroesAt = new Map();
  const heroesFor = (road) => {
    if (!heroesAt.has(road)) {
      const s4 = emptyState4();
      const state = {
        ...s4, settings: {}, tally: { sessionsFinished: 0, finishedIds: [], byCrew: { claude: 0, codex: 0, jev: 0 }, features: {} }, hearth: { tier: 2 },
        satchel: { materials: {}, essences: {}, essenceGenres: {}, relics: [], marks: 0, tonics: { cordial: 0, brew: 0 } }, story: { trails: {}, facts: {} },
        rifts: { stitched: { real: 0, wild: 0, story: 0 } }, road: { ...s4.road, xp: rules.road.xp[road - 1] },
      };
      heroesAt.set(road, party.partySpecs(state, { content, rules, abilities: REAL }));
    }
    return heroesAt.get(road);
  };
  const ctx = { rules, abilities: REAL, minds: null, mechanics: MECHANICS, bows: FOE_BOWS, genres: GENRES, party: {} };
  ctx.minds = { ...stubMinds(ctx, {}), ...workers(ctx) };
  return { D, heroesFor, ctx: Object.freeze(ctx) };
}

const SHADOW = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];
const TIERS = [1, 2, 2, 3, 4];   // for Road levels 1–5: the tier whose n is the Road level or just below it
const SEEDS = 200;

/**
 * One cell of the proof: a mechanic (or the fallback) over 200 seeds of D's lead rooms at Road levels
 * 1–5, each won within 3 Try agains. Returns { id, wins, fights, bowed, lost }.
 */
async function runCell(id) {
  const { D, heroesFor, ctx } = await realWorld();
  const m = LEADS.mechanics.find((x) => x.id === id) || null;
  const genres = m ? [m.genre] : SHADOW;
  const pool = new Map(genres.map((g) => [g, []]));
  for (let i = 0; [...pool.values()].some((l) => l.length < SEEDS) && i < 30000; i += 1) {
    const s = D.riftgen.wildRift({ seed: hashInts(i, 'lead-proof'), tier: 1, depth: 1 });
    const g = s.taleLead?.genre;
    if (pool.has(g) && pool.get(g).length < SEEDS && !s.maelstrom) pool.get(g).push(s);
  }
  let wins = 0;
  let fights = 0;
  let bowed = 0;
  const lost = [];
  for (let i = 0; i < SEEDS; i += 1) {
    const road = 1 + (i % 5);
    const genre = m ? m.genre : SHADOW[i % 8];
    const base = pool.get(genre)[i];
    const text = m ? m.text : LEADS.mechanics.find((x) => x.genre === genre && !x.ships && !x.noFight).text;
    const spec = { ...base, tier: TIERS[road - 1], taleLead: { ...base.taleLead, mechanic: text } };
    const f = D.encounters.prepareElsewhere(spec, prepareOptions(D, 'wild', { roadLevel: road, partySize: 4, rules, tuning: null })).encounters.rooms.find((r) => r.fight.leadUnit)?.fight;
    if (!f || f.lead.mechanic !== id) {
      lost.push([i, road, f ? `fought as ${f.lead.mechanic}` : 'no lead room']);
      continue;
    }
    let won = false;
    for (let attempt = 0; attempt <= 3 && !won; attempt += 1) {
      fights += 1;
      const out = runToEnd(createBattle(f, heroesFor(road), { attempt, roadLevel: road, mode: 'long-road' }, ctx), ctx, {});
      won = WINS.has(out.result?.outcome);
      if (out.result?.outcome === 'bowed') bowed += 1;
    }
    if (won) wins += 1;
    else lost.push([i, road, f.stage]);
  }
  return { id, wins, fights, bowed, lost };
}

/** Runs a cell in a worker thread (this file, imported there, registers no tests), so the nine run side by side. */
const inWorker = (cell) => new Promise((resolve, reject) => {
  const w = new Worker(new URL(import.meta.url), { workerData: { cell } });
  w.once('message', (r) => (r?.error ? reject(new Error(r.error)) : resolve(r)));
  w.once('error', reject);
  w.once('exit', (code) => (code === 0 ? null : reject(new Error(`the ${cell} worker stopped (${code})`))));
});

/** The cells, three workers at a time (the other suites' timing budgets share the machine). */
async function allCells(cells, width = 3) {
  const out = [];
  const queue = [...cells];
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) out.push(await inWorker(queue.shift()));
  }));
  return cells.map((id) => out.find((r) => r.id === id));
}

test('every mechanic and the fallback can be won on auto by I’s scripted player: Long Road, a party of 4, within 3 Try agains, on 100% of 200 seeds', async (t) => {
  const results = await allCells([...SHIPPED, 'fallback']);
  t.diagnostic(results.map((r) => `${r.id}: ${r.wins}/${SEEDS} in ${r.fights} fights, ${r.bowed} bowed`).join('; '));
  for (const r of results) assert.equal(r.wins, SEEDS, `${r.id}: lost ${JSON.stringify(r.lost)}`);
});

if (!isMainThread && workerData?.cell) {
  runCell(workerData.cell).then((r) => parentPort.postMessage(r), (e) => parentPort.postMessage({ error: String(e?.stack || e) }));
}

// §15: Tell me how it went, a whole fight, ≤ 100 ms with stub minds, here with each mechanic (B measures it
// without). The median of 10 fights after a warm-up, in this thread's CPU time (Windows counts it in 15.6 ms
// steps), so the suite running beside it doesn't count; the wall-clock median is reported alongside.
test('Tell me how it went stays within §15’s 100 ms for a whole lead fight, with every mechanic', (t) => {
  const cpu = typeof process.threadCpuUsage === 'function' ? () => process.threadCpuUsage() : () => process.cpuUsage();
  const ms = (a, b) => (b.user - a.user + b.system - a.system) / 1000;
  const report = [];
  for (const id of ['fallback', ...SHIPPED]) {
    const ctx = ctxWith({ foePlan: null });
    const heroes = PARTY().map((h) => ({ ...h, maxIntegrity: 60, integrity: 60 }));
    const [times, walls] = [[], []];
    for (let seed = 0; seed <= 10; seed += 1) {
      const b = createBattle(mechanicFight(id, seed + 1, [80, 80, 80]), heroes, { mode: 'long-road' }, ctx);
      const [c0, w0] = [cpu(), performance.now()];
      const out = runToEnd(b, ctx, {});
      const [w1, c1] = [performance.now(), cpu()];
      assert.ok(out.result, `${id}: the fight ends`);
      if (seed === 0) continue;   // the warm-up
      times.push(ms(c0, c1));
      walls.push(w1 - w0);
    }
    const median = (xs) => [...xs].sort((p, q) => p - q)[xs.length >> 1];
    report.push(`${id} ${median(times).toFixed(1)} ms cpu, ${median(walls).toFixed(1)} ms wall`);
    assert.ok(median(times) <= 100, `${id}: a whole fight’s median ${median(times).toFixed(1)} ms`);
  }
  t.diagnostic(report.join('; '));
});

// ---------- copy and purity ----------

test('every Log line and telegraph leads.js writes is calm, cosy and short', () => {
  const texts = new Set();
  const words = new Set();
  for (const id of ['fallback', ...SHIPPED]) {
    for (const seed of [1, 2, 3, 4]) {
      const ctx = ctxWith({ foePlan: null, extra: workers });
      const fight = mechanicFight(id, seed);
      let b = createBattle(fight, PARTY(), {}, ctx);
      const r = runToEnd(withLead(b, { bar: id === 'noon-duel' ? 2 : 0, phase: id === 'noon-duel' ? 'last-page' : 'opening' }), ctx, {});
      b = r.battle;
      for (const e of r.events) {
        if (e.t === 'line') texts.add(e.text);
        if (e.t === 'act' && e.action?.id === 'aside') words.add(e.words);
        if (e.t === 'telegraphs') for (const t of e.list) if (t.unitId === 'lead') words.add(t.words);
      }
    }
  }
  // The bows' lines, from the canon tests' shapes.
  const ctx = ctxWith({ abilityIndex: REAL, foePlan: null });
  const b = createBattle(caveFight([canonFoe('hush-hounds', { x: 4, y: 3 })], [obj('o0', 'forge', 8, 9, 'cold'), obj('o1', 'lectern', 9, 9, 'idle')], { entry: [{ x: 3, y: 3 }, { x: 8, y: 8 }, { x: 9, y: 8 }, { x: 2, y: 1 }] }), quiet(PARTY()), {}, ctx);
  for (const e of go(b, ctx, { milo: [A.interact({ unit: 'f0' }), A.interact({ unit: 'f0' })], claude: [A.interact({ object: 'o0' }), A.interact({ object: 'o0' })], codex: [A.interact({ object: 'o1' })] }).events) {
    if (e.t === 'line') texts.add(e.text);
  }
  // The bell tried from beside it, and the greyed bell's why.
  const bellRoom = createBattle(caveFight([canonFoe('drowned-bell-ringers', { x: 5, y: 3 })], [obj('o0', 'lectern', 8, 9, 'idle'), obj('o1', 'bell', 10, 9, 'still')], { entry: [{ x: 3, y: 3 }, { x: 10, y: 8 }, { x: 1, y: 2 }, { x: 2, y: 1 }] }), quiet(PARTY()), {}, ctx);
  for (const e of go(bellRoom, ctx, { claude: [A.interact({ object: 'o1' })] }).events) if (e.t === 'line') texts.add(e.text);
  assert.ok(texts.has('The bell is rung from the lectern.'));
  for (const o of FOE_BOWS.actions(bellRoom, 'milo', ctx)) if (o.why) words.add(o.why);
  assert.ok(texts.size >= 15, `lines seen: ${texts.size}`);
  for (const t of texts) {
    assertCalm(t, 'a Log line', { proper: PROPER });
    assert.ok(t.length <= 100, t);
    assert.deepEqual(uncosyIn(t), [], t);
  }
  for (const w of words) {
    assert.ok(w.length <= 60, w);
    assertCalm(w, 'a telegraph', { proper: PROPER });
    assert.deepEqual(uncosyIn(w), [], w);
  }
});

test('leads.js is pure: no clock, no randomness, no DOM, and none of the modules Phase 4 keeps out', () => {
  const src = readFileSync(new URL('../src/combat/leads.js', import.meta.url), 'utf8');
  for (const bad of [/Date\.now/, /Math\.random/, /performance\.now/, /\bdocument\./, /\bwindow\./, /from '\.\.\/model\.js'/, /hearth\.js/, /rifts\.js/, /architect/, /watch\//]) {
    assert.ok(!bad.test(src), `leads.js avoids ${bad}`);
  }
  assert.ok(src.split('\n').length <= 1500, 'at most 1,500 lines');
  // Hooks never change the Battle they're given (a frozen one would throw).
  const ctx = ctxWith();
  const b = createBattle(mechanicFight('assembly-lines'), PARTY(), {}, ctx);
  const before = JSON.stringify(b);
  const args = { setup: [], roundStart: [], telegraphs: [], actions: ['milo'], resolve: ['milo', A.interact({ object: 'o3' })], damageTaken: [{ target: 'lead', amount: 5, kind: 'plain', degree: 'hit', source: 't' }],
    tickEnd: [2], roundEnd: [], phaseChange: ['opening', 'twist'], bow: [] };
  for (const m of Object.values(MECHANICS)) for (const [hook, extra] of Object.entries(args)) m[hook](b, ...extra, ctx);
  assert.equal(JSON.stringify(b), before);
  assert.ok(Object.isFrozen(b));
});
