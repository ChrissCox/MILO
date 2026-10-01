// The combat kernel's settle after wave 2 (module B; CONTRACT-PHASE4.md §18.3 items 1–5 and 9): Asks
// outside a scheduled entry (the blocking loop, with wave 2's stuck fight replayed), an event for every
// change the board draws, Battle.seen from the commit, restores that keep the eye's words and Void lies
// (with the real minds too), hidden telegraphs without the eye, and the six items carried from I's review.
//   node --test tests/combat-seams.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { buildAbilityIndex, canonBow } from '../src/combat/abilities.js';
import { saveBattle, restoreBattle, legalActions, oddsFor, TERMINAL, spawnFoe } from '../src/combat/battle.js';
import { commit, step, answer, runToEnd, stubMinds } from '../src/combat/driver.js';
import { plainTelegraphs } from '../src/combat/round.js';
import { draftReadout, summary, logLines } from '../src/combat/describe.js';
import { stirs } from '../src/combat/rules.js';
import { hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ab, ABILITIES, realAbilities } from './combat-kit.js';

const quiet = { calm: { noise: false, adaptation: true } };
const J = (v) => JSON.parse(JSON.stringify(v));
const patch = (b, id, p) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, ...p } : u)) });
const noAskKeys = (b) => b.units.every((u) => !Object.keys(u.usedRound || {}).some((k) => k.startsWith('#ask')));
const toll = ab({ id: 'toll', kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: ['tollkeeper-toll'], summons: [] } });

// ---------- item 1: Asks outside a scheduled entry ----------

// The cross-check's loop, made small: in round 1 the stray walks onto a gravity well; at round 2's start
// the well pulls it beside the Artificer, who holds the Tollkeeper's toll; the toll's pick is in sight
// of the Scribe, whose Proofread is on Ask. That Ask comes outside any scheduled entry.
function tollRoom({ foeAt = { x: 10, y: 2 } } = {}) {
  const wells = [[5, 2], [6, 2], [6, 1], [7, 2]].map(([x, y]) => ({ x, y, id: 'gravity-well', rounds: null }));
  const foePlan = (b, id) => plan(id, b.round === 1 && foeAt.x > 7 ? [A.stride([{ x: 9, y: 2 }, { x: 8, y: 2 }, { x: 7, y: 2 }])] : [], { by: 'foe' });
  const ctx = makeCtx({ foePlan, abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, toll] } }) });
  const heroes = [hero('milo'), hero('claude', { reactions: { proofread: 'ask', shoulder: 'always' } }), hero('codex', { abilityIds: ['toll'] })];
  const fight = fightSpec({
    foes: [stray('f0', { ...foeAt, integrity: 40, maxIntegrity: 60 })], surfaces: wells,
    arenaOpts: { entry: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 3 }] },
  });
  return { ctx, heroes, fight };
}

/** Plays round 1 with empty plans made `by`, then steps to round 2's planning, answering any Ask yes. */
function tollRound(by) {
  const { ctx, heroes, fight } = tollRoom();
  const b0 = createBattle(fight, heroes, quiet, ctx);
  const c = play(b0, [...heroes.map((h) => ({ t: 'plan', unitId: h.id, plan: plan(h.id, [], { by }) })), { t: 'commit' }], ctx);
  const events = [...c.events];
  let b = c.battle;
  let asks = 0;
  for (let i = 0; i < 20 && (b.status === 'running' || b.status === 'asking'); i += 1) {
    if (b.status === 'asking') asks += 1;
    const r = apply(b, b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' }, ctx);
    b = r.battle;
    events.push(...r.events);
  }
  return { b, events, asks, ctx, heroes, fight };
}

test('an Ask raised at a round’s start can’t be answered: it sits out as Never on your plan, and the step moves on', () => {
  const { b, events, asks } = tollRound('you');
  assert.equal(b.status, 'planning', 'round 2 is planning: the step never looped');
  assert.equal(b.round, 2);
  assert.equal(asks, 0, 'nothing asked outside an entry');
  const at = events.findIndex((e) => e.t === 'round' && e.round === 2);
  const after = events.slice(at);
  assert.ok(after.some((e) => e.t === 'move' && e.unit === 'f0' && e.how === 'pull'), 'the well pulls the stray at round 2’s start');
  assert.ok(after.some((e) => e.t === 'outcome' && e.unit === 'codex' && e.target === 'f0'), 'the toll picks, beside the Artificer');
  assert.ok(!events.some((e) => e.t === 'reaction' && e.unit === 'claude'), 'Proofread sits it out (Never)');
  assert.equal(findUnit(b, 'claude').uses.proofread, 2, 'no use spent without a yes');
  assert.ok(noAskKeys(b) && b.answers === undefined, 'no answer is kept anywhere');
});

test('the same round-start Ask fires as Always on an auto plan (last round’s) and in Wrap it up', () => {
  const auto = tollRound('auto');
  assert.equal(auto.b.status, 'planning');
  assert.equal(auto.asks, 0);
  assert.ok(auto.events.some((e) => e.t === 'reaction' && e.unit === 'claude' && e.id === 'proofread'), 'on auto, her Proofread fires');
  assert.equal(findUnit(auto.b, 'claude').uses.proofread, 1);
  // Wrap it up from the middle of your round: the round-start Ask outside the entry is Always too.
  const { ctx, heroes, fight } = tollRoom();
  let b = createBattle(fight, heroes, quiet, ctx);
  b = play(b, [...heroes.map((h) => ({ t: 'plan', unitId: h.id, plan: plan(h.id, []) })), { t: 'commit' }], ctx).battle;
  const w = apply(b, { t: 'wrap' }, ctx);
  assert.ok(TERMINAL.has(w.battle.status), `Wrap it up ends (${w.battle.status})`);
  const start = w.events.findIndex((e) => e.t === 'round' && e.round === 2);
  const beforeTick = w.events.slice(start, start + w.events.slice(start).findIndex((e) => e.t === 'tick'));
  assert.ok(beforeTick.some((e) => e.t === 'outcome' && e.unit === 'codex'), 'the toll at round 2’s start');
  assert.ok(beforeTick.some((e) => e.t === 'reaction' && e.unit === 'claude' && e.id === 'proofread'), 'proofread there, as Always');
  assert.ok(noAskKeys(w.battle));
});

test('a stray pulled into the toll while the fight is set up doesn’t stop createBattle', () => {
  const { ctx, heroes, fight } = tollRoom({ foeAt: { x: 7, y: 2 } });
  const b = createBattle(fight, heroes, quiet, ctx);
  assert.deepEqual([findUnit(b, 'f0').x, findUnit(b, 'f0').y], [6, 2], 'pulled at round 1’s start, beside the Artificer');
  assert.equal(b.status, 'planning');
  assert.equal(findUnit(b, 'claude').uses.proofread, 2);
});

test('an Ask inside an entry waits for its answer, kept in Battle.answers (saved and restored) until the entry resolves, never in usedRound', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }])], { by: 'foe' }) });
  const fight = fightSpec({ foes: [stray('f0', { x: 3, y: 2 })] });
  const heroes = [hero('milo', { reactions: { 'parting-swipe': 'ask' } })];
  let b = patch(createBattle(fight, heroes, quiet, ctx), 'milo', { x: 2, y: 2 });
  b = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace()]) }, { t: 'commit' }], ctx).battle;
  for (let i = 0; i < 6 && b.status === 'running'; i += 1) b = apply(b, { t: 'step' }, ctx).battle;
  assert.equal(b.status, 'asking');
  for (const yes of [true, false]) {
    const answered = apply(b, { t: 'answer', yes }, ctx).battle;
    assert.deepEqual(answered.answers, { milo: { 'parting-swipe': yes ? 1 : 0 } });
    assert.ok(noAskKeys(answered), 'not in usedRound');
    const save = J(saveBattle(answered));
    assert.deepEqual(save.answers, answered.answers, 'saved while it waits');
    assert.deepStrictEqual(restoreBattle(save, ctx, { fight, heroes }), answered, 'and restored');
    const s = step(answered, ctx);
    assert.equal(s.ask, null, 'the same Ask never comes back');
    assert.equal(s.events.some((e) => e.t === 'reaction' && e.unit === 'milo'), yes);
    assert.equal(s.battle.answers, undefined, 'gone once the entry has resolved');
  }
  // Junk answers, or answers while planning, don't restore.
  const answered = apply(b, { t: 'answer', yes: true }, ctx).battle;
  const ended = apply(answered, { t: 'end', outcome: 'won', why: 'seam-closed' }, ctx).battle;
  assert.equal(ended.answers, undefined, 'a fight that ends drops them');
  assert.ok(restoreBattle(J(saveBattle(ended)), ctx, { fight, heroes }));
  const good = J(saveBattle(answered));
  for (const bad of [{ ...good, answers: { nobody: { shoulder: 1 } } }, { ...good, answers: { milo: { shoulder: 'yes' } } }, { ...J(saveBattle(createBattle(fight, heroes, quiet, ctx))), answers: { milo: { shoulder: 1 } } }]) {
    assert.equal(restoreBattle(bad, ctx, { fight, heroes }), null);
  }
});

test('wave 2’s stuck fight (rift:1kdmrs4, room r4: a round-start pull past the Tollkeeper, Proofread on Ask) ends, each Ask asked once', async () => {
  const sim = await import('../scripts/sim.mjs');
  const enc = await import('../src/combat/encounters.js');
  const { hashInts } = await import('../src/world/rng.js');
  const world = sim.loadWorld({ tuning: 'file' });
  let fight = null;
  for (let seed = 0; seed < 2000 && !fight; seed += 1) {
    const tier = 1 + (seed % 4);
    const spec = world.riftgen.wildRift({ seed: hashInts(seed, 'winnable'), tier, depth: 1 + (seed % 3) });
    if (spec.id !== 'rift:1kdmrs4') continue;
    const prep = enc.prepareElsewhere(spec, {
      riftgen: world.riftgen, genres: world.content.genres, words: world.words, kind: 'wild', roadLevel: world.rules.tiers[tier - 1], partySize: 4,
      rules: world.rules, leads: world.content.combat.leads, foes: world.content.combat.foes, tuning: world.tuning, hooks: world.hooks,
    });
    fight = prep.encounters.rooms.find((r) => r.fightId.endsWith(':r4'))?.fight || null;
  }
  assert.ok(fight, 'the stuck room is still generated');
  const heroes = sim.partyAt(world, 1, 4);
  const ctx = sim.ctxFor(world, heroes);
  const scribe = heroes.find((h) => h.id === 'claude');
  assert.equal(scribe?.reactions?.proofread ?? world.rules.reactions.proofread, 'ask', 'the Scribe’s Proofread is on Ask');
  // As the cross-check drove it: auto commits, every Ask answered yes.
  let b = createBattle(fight, heroes, { roadLevel: 1 }, ctx);
  const asked = new Set();
  let roundStartToll = false;
  for (let guard = 0; guard < 400 && !TERMINAL.has(b.status); guard += 1) {
    if (b.status === 'planning') b = commit(b, null, ctx, { auto: true }).battle;
    else if (b.status === 'asking') {
      const key = JSON.stringify([b.round, b.tick, b.cursor, b.ask.unitId, b.ask.reactionId]);
      assert.ok(!asked.has(key), `asked again after an answer: ${key}`);
      asked.add(key);
      b = answer(b, true, ctx).battle;
    } else {
      const s = step(b, ctx);
      const at = s.events.findIndex((e) => e.t === 'round');
      if (at >= 0 && s.events.slice(at).some((e) => e.t === 'outcome' && e.unit === 'tollkeeper')) roundStartToll = true;
      b = s.battle;
    }
  }
  assert.ok(TERMINAL.has(b.status), `the fight ends (${b.status}, round ${b.round})`);
  assert.ok(roundStartToll, 'the toll still picks at a round’s start, the path that used to loop');
  // And Tell me how it went, which used to run 10,057 events and stop unfinished.
  const r = runToEnd(createBattle(fight, heroes, { roadLevel: 1 }, ctx), ctx);
  assert.ok(r.result, 'Tell me how it went finishes');
  assert.ok(r.events.length < 2000, `${r.events.length} events`);
});

// ---------- item 2: every drawn change has an event ----------

/** What a board knows after folding events: lights, telegraphs, and each unit's Buffer and conditions. */
function boardOf(b) {
  return {
    lights: J(b.lights), telegraphs: J(b.telegraphs),
    units: Object.fromEntries(b.units.map((u) => [u.id, { buffer: u.buffer || 0, conditions: Object.fromEntries((u.conditions || []).map((c) => [c.id, c.n ?? null])) }])),
  };
}
function fold(board, events) {
  const unit = (id) => (board.units[id] ||= { buffer: 0, conditions: {} });
  for (const e of events) {
    if (e.t === 'light') board.lights = J(e.lights);
    else if (e.t === 'telegraphs') board.telegraphs = J(e.list);
    else if (e.t === 'buffer') unit(e.unit).buffer = e.buffer;
    else if (e.t === 'condition' && e.on) unit(e.target).conditions[e.id] = e.n ?? null;
    else if (e.t === 'condition') delete unit(e.target).conditions[e.id];
    else if (e.t === 'offline') board.units[e.unit] = { buffer: 0, conditions: {} };
    else if (e.t === 'spawn' && e.unit) board.units[e.unit.id] = { buffer: 0, conditions: {} };
  }
}
/** The board's differences from the Battle (standing units only), or null. */
function drift(board, b) {
  const real = boardOf(b);
  const out = [];
  if (!isDeepStrictEqual(board.lights, real.lights)) out.push('lights');
  if (!isDeepStrictEqual(board.telegraphs, real.telegraphs)) out.push('telegraphs');
  for (const u of b.units) {
    if (u.sorted) continue;
    const m = board.units[u.id] || { buffer: 0, conditions: {} };
    if (m.buffer !== real.units[u.id].buffer) out.push(`${u.id} buffer`);
    if (!isDeepStrictEqual(m.conditions, real.units[u.id].conditions)) out.push(`${u.id} conditions`);
  }
  return out.length ? out : null;
}

test('a board built only from events matches the Battle after every step: the Hooklight moving, count-downs (Dazed too), Buffers cleared, telegraphs', () => {
  const foePlan = (bb, id) => plan(id, [A.stride([{ x: 5, y: 1 }]), A.strike('milo')], { by: 'foe' });
  const ctx = makeCtx({ foePlan });
  const heroes = [hero('milo'), hero('claude')];
  let b = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2, integrity: 90, maxIntegrity: 90 })] }), heroes, quiet, ctx);
  b = patch(b, 'milo', { conditions: [{ id: 'soaked', n: 3, source: null, data: null }] });
  b = patch(b, 'claude', { conditions: [{ id: 'brisk', n: 1, source: null, data: null }] });
  b = patch(b, 'f0', { conditions: [{ id: 'dazed', n: 3, source: null, data: null }] });
  const board = boardOf(b);
  const all = [];
  const send = (cmd) => {
    const r = apply(b, cmd, ctx);
    b = r.battle;
    all.push(r.events);
    fold(board, r.events);
    if (!TERMINAL.has(b.status)) assert.equal(drift(board, b), null, `after ${cmd.t} in round ${b.round}, tick ${b.tick}`);
    return r;
  };
  for (let round = 1; round <= 2; round += 1) {
    send({ t: 'plan', unitId: 'milo', plan: plan('milo', round === 1 ? [A.stride([{ x: 2, y: 1 }, { x: 3, y: 1 }]), A.brace()] : [A.brace()]) });
    send({ t: 'plan', unitId: 'claude', plan: plan('claude', [A.brace()]) });
    send({ t: 'commit' });
    while (b.status === 'running' || b.status === 'asking') send(b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' });
  }
  const flat = all.flat();
  // The Hooklight: a light event right after the move that carried Milo, at his new tile.
  const milo = all.find((ev) => ev.some((e) => e.t === 'move' && e.unit === 'milo'));
  const mi = milo.findIndex((e) => e.t === 'move' && e.unit === 'milo');
  const li = milo.findIndex((e) => e.t === 'light');
  assert.ok(li > mi, 'light follows Milo’s move');
  assert.deepEqual(milo[li].lights.find((l) => l.id === 'hooklight') && [milo[li].lights[0].x, milo[li].lights[0].y], [3, 1]);
  // Count-downs: Soaked at the round’s end, Dazed as it takes an action, Brisk counting out into Winded.
  const downs = flat.filter((e) => e.t === 'condition' && e.down);
  assert.ok(downs.some((e) => e.target === 'milo' && e.id === 'soaked' && e.n === 2 && e.on));
  assert.ok(downs.some((e) => e.target === 'f0' && e.id === 'dazed' && e.n === 2 && e.on));
  assert.ok(downs.some((e) => e.target === 'claude' && e.id === 'winded' && e.on));
  assert.ok(downs.every((e) => !stirs(e)), 'a count-down isn’t a condition landing (standoffs)');
  assert.deepEqual(logLines(downs, b), [], 'nor a Log line');
  // Buffers the round’s start clears, after its round event.
  const r2 = all.find((ev) => ev.some((e) => e.t === 'round' && e.round === 2));
  const ri = r2.findIndex((e) => e.t === 'round');
  assert.ok(r2.slice(ri).some((e) => e.t === 'buffer' && e.unit === 'claude' && e.buffer === 0), 'Buffer to 0');
  // Telegraphs re-sent when a step changes them (the stray’s Strike follows Milo).
  assert.ok(all.some((ev) => ev.some((e) => e.t === 'act' && e.unit === 'milo') && ev.some((e) => e.t === 'telegraphs')), 'telegraphs follow Milo’s stride');
});

test('over 60 seeded fights, every step’s events keep the board equal to the Battle', () => {
  const GENRES = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];
  const ctx = makeCtx();
  let steps = 0;
  for (let s = 0; s < 60; s += 1) {
    const g = GENRES[s % GENRES.length];
    const foes = [stray('f0', { x: 10, y: 1, genre: g }), stray('f1', { x: 11, y: 2, archetype: 'crawler', talkKind: 'k1', genre: g }), stray('f2', { x: 12, y: 3, talkKind: 'k2', genre: g })];
    let b = createBattle(fightSpec({ seed: 1000 + s, genres: [g], foes }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
    const board = boardOf(b);
    for (let guard = 0; guard < 400 && !TERMINAL.has(b.status); guard += 1) {
      const r = b.status === 'planning' ? commit(b, null, ctx, { auto: true }) : b.status === 'asking' ? answer(b, true, ctx) : step(b, ctx);
      b = r.battle;
      fold(board, r.events);
      steps += 1;
      if (!TERMINAL.has(b.status)) assert.equal(drift(board, b), null, `seed ${s}, round ${b.round}, tick ${b.tick}`);
    }
  }
  assert.ok(steps > 1000, `${steps} steps`);
});

// ---------- item 3: Battle.seen from the commit ----------

test('Battle.seen counts the habit chosen at commit (what the RoundRecord learns), read before the slot resolves', () => {
  // Minds that call a Stride "closed in" (1) when it ends nearer the stray than the hero stands now,
  // else "moved to a new spot" (7): after the Stride resolves, the same Stride reads as 7.
  const base = makeCtx();
  const nearest = (b, x, y) => Math.min(...b.units.filter((u) => u.side === 'foe').map((u) => Math.max(Math.abs(u.x - x), Math.abs(u.y - y))));
  const choices = (b, id, p) => (p?.slots || []).map((a, slot) => {
    const u = b.units.find((x) => x.id === id);
    if (a.id !== 'stride') return { slot, template: 2, ability: 0, relation: 0, cost: 1 };
    const end = a.target.path[a.target.path.length - 1];
    return { slot, template: nearest(b, end.x, end.y) < nearest(b, u.x, u.y) ? 1 : 7, ability: 0, relation: 0, cost: 1 };
  });
  const ctx = makeCtx({ minds: { ...stubMinds(base, { foePlan: (bb, id) => plan(id, [], { by: 'foe' }) }), choices } });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo')], quiet, ctx);
  const c = commit(b, { milo: plan('milo', [A.stride([{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }])]) }, ctx);
  assert.deepEqual(c.record.units.milo.choices.map((x) => x.template), [1], 'the record learns “closed in”');
  assert.equal(findUnit(c.battle, 'milo').usedRound['#c0'], 1 * 65536 + 0, 'kept from the commit');
  const s = step(c.battle, ctx);
  assert.deepEqual(s.battle.seen, { '1:0': 1 }, 'seen counts “closed in”, not “moved to a new spot”');
  assert.equal(choices(s.battle, 'milo', c.battle.plans.milo)[0].template, 7, 'read after resolving, it would have been 7');
  // A lost slot shows nothing; a new round starts clean.
  const r = playRound(s.battle, ctx);
  assert.equal(findUnit(r.battle, 'milo').usedRound['#c0'], undefined);
});

test('with the real minds, each step adds to Battle.seen exactly the committed choice of the hero slot that acted', async () => {
  const sim = await import('../scripts/sim.mjs');
  const world = sim.loadWorld({ tuning: 'file' });
  const heroes = sim.partyAt(world, 2, 4);
  const ctx = sim.ctxFor(world, heroes);
  let checked = 0;
  for (const room of ['moderate', 'lead']) {
    for (const r of sim.roomsFor(world, { level: 2, room, partySize: 4, seed: 11, count: 4 })) {
      let b = createBattle(r.fights[0], heroes, { roadLevel: 2 }, ctx);
      let record = null;
      for (let guard = 0; guard < 400 && !TERMINAL.has(b.status); guard += 1) {
        if (b.status === 'planning') ({ battle: b, record } = commit(b, null, ctx));
        else if (b.status === 'asking') b = answer(b, true, ctx).battle;
        else {
          const entry = b.schedule[b.cursor];
          const s = step(b, ctx);
          const delta = {};
          for (const [k, n] of Object.entries(s.battle.seen)) if (n !== (b.seen[k] || 0)) delta[k] = n - (b.seen[k] || 0);
          const acted = entry && record.units[entry.unitId] && s.events.some((e) => e.t === 'act' && e.unit === entry.unitId);
          const ch = acted ? record.units[entry.unitId].choices[entry.slot] : null;
          assert.deepEqual(delta, ch ? { [`${ch.template}:${ch.ability}`]: 1 } : {}, `${r.fights[0].id} round ${b.round}`);
          if (ch) checked += 1;
          b = s.battle;
        }
      }
    }
  }
  assert.ok(checked > 50, `${checked} hero actions checked`);
});

// ---------- items 4 and 5: telegraphs that hold words, saved; hidden ones without the eye ----------

// Minds that hold words the way H's do: while a round runs, the eye's words and each Void lie come from
// the telegraphs being replaced; at planning they're fresh (the eye counts Battle.seen, which grows).
function holdingMinds(ctx) {
  const base = stubMinds(ctx, { foePlan: (b, id) => plan(id, [A.strike('milo'), A.strike('claude')], { by: 'foe' }) });
  return {
    ...base,
    choices: (b, id, p) => (p?.slots || []).map((a, slot) => ({ slot, template: 3, ability: 0, relation: 0, cost: 1 })),
    telegraphs(b, id, p) {
      const list = plainTelegraphs(b, id, p, ctx);
      const before = b.status === 'running' || b.status === 'asking' ? b.telegraphs || [] : null;
      const held = before?.find((t) => t.unitId === id && t.adapting);
      const count = Object.values(b.seen).reduce((s, n) => s + n, 0);
      for (const t of list) {
        t.adapting = held ? held.adapting : `Spreading its hits: you’ve done that ${count} times.`;
        const was = before?.find((x) => x.unitId === id && x.slot === t.slot);
        t.falseTarget = was ? was.falseTarget : t.targets[0] === 'milo' ? 'claude' : null;
      }
      return list;
    },
  };
}

test('a save while the round runs keeps the eye’s words and the Void lies, so a restore shows the same telegraphs', () => {
  const base = makeCtx();
  const ctx = makeCtx({ minds: holdingMinds(base) });
  const fight = fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 90, maxIntegrity: 90 }), stray('f1', { x: 4, y: 1, talkKind: 'k1', integrity: 90, maxIntegrity: 90 })] });
  const heroes = [hero('milo'), hero('claude')];
  let b = createBattle(fight, heroes, quiet, ctx);
  let held = 0;
  let differs = 0;
  for (let guard = 0; guard < 60 && b.round <= 3 && !TERMINAL.has(b.status); guard += 1) {
    b = b.status === 'planning' ? commit(b, { milo: plan('milo', [A.strike('f0'), A.brace()]), claude: plan('claude', [A.strike('f0'), A.brace()]) }, ctx).battle
      : b.status === 'asking' ? answer(b, true, ctx).battle : step(b, ctx).battle;
    const save = J(saveBattle(b));
    const back = restoreBattle(save, ctx, { fight, heroes });
    assert.deepStrictEqual(back, b, `round ${b.round} tick ${b.tick} cursor ${b.cursor}`);
    if (save.eye && save.lies) held += 1;
    // Fresh words would differ: the eye counts habits that grew since planning.
    if (b.status === 'running' && b.telegraphs.some((t) => t.adapting && !t.adapting.includes(`${Object.values(b.seen).reduce((s, n) => s + n, 0)} times`))) differs += 1;
  }
  assert.ok(held > 3 && differs > 3, `${held} saves held words, ${differs} of them words a fresh build wouldn’t give`);
  // What it can’t trust doesn't restore.
  const running = J(saveBattle(play(createBattle(fight, heroes, quiet, ctx), [{ t: 'commit' }], ctx).battle));
  assert.ok(running.eye && running.lies);
  for (const bad of [{ ...running, eye: { nobody: 'x' } }, { ...running, eye: { f0: 7 } }, { ...running, lies: [['f0', 9, 'claude']] }, { ...running, lies: [['f0', 0, 'nobody']] },
    { ...J(saveBattle(createBattle(fight, heroes, quiet, ctx))), eye: { f0: 'x' } }]) {
    assert.equal(restoreBattle(bad, ctx, { fight, heroes }), null);
  }
});

test('with the real minds, a restore at every step equals the live Battle, the eye’s words and Void lies included', async () => {
  const sim = await import('../scripts/sim.mjs');
  const world = sim.loadWorld({ tuning: 'file' });
  const heroes = sim.partyAt(world, 2, 4);
  const ctx = sim.ctxFor(world, heroes);
  const stats = { saves: 0, eye: 0, lies: 0, answers: 0 };
  const voidish = (f) => [...f.foes, f.leadUnit].some((u) => (u?.genres || []).includes('void'));
  const rooms = [
    ...sim.roomsFor(world, { level: 2, room: 'lead', partySize: 4, seed: 7, count: 3 }),
    ...sim.roomsFor(world, { level: 2, room: 'moderate', partySize: 4, seed: 7, count: 60 }).filter((r) => voidish(r.fights[0])).slice(0, 3),
  ];
  for (const r of rooms) {
    const fight = r.fights[0];
    let b = createBattle(fight, heroes, { roadLevel: 2 }, ctx);
    for (let guard = 0; guard < 500 && !TERMINAL.has(b.status); guard += 1) {
      b = b.status === 'planning' ? commit(b, null, ctx).battle : b.status === 'asking' ? answer(b, guard % 2 === 0, ctx).battle : step(b, ctx).battle;
      const save = J(saveBattle(b));
      assert.deepStrictEqual(restoreBattle(save, ctx, { fight, heroes }), b, `${fight.id} round ${b.round} tick ${b.tick} cursor ${b.cursor}`);
      stats.saves += 1;
      if (save.eye) stats.eye += 1;
      if (save.lies) stats.lies += 1;
      if (save.answers) stats.answers += 1;
    }
  }
  assert.ok(stats.eye > 10 && stats.lies > 10 && stats.answers > 0, JSON.stringify(stats));
});

test('a hidden telegraph carries none of the eye’s words, whoever hid it', () => {
  const base = makeCtx();
  const sloppy = {
    ...stubMinds(base, { foePlan: (b, id) => plan(id, [A.strike('milo')], { by: 'foe' }) }),
    telegraphs: (b, id, p) => plainTelegraphs(b, id, p, base).map((t) => ({ ...t, adapting: 'Watching you: you’ve struck first twice.', hidden: id === 'f1' })),
  };
  const ctx = makeCtx({ minds: sloppy });
  // Gothic: Milo’s tile is Dark (no lantern, a dark room), so Guttering candles hide f0’s Strike.
  const darkRows = Array.from({ length: 6 }, () => 'D'.repeat(16));
  const b = createBattle(fightSpec({ genres: ['gothic'], arenaOpts: { lights: darkRows }, foes: [stray('f0', { x: 12, y: 2, genre: 'gothic' }), stray('f1', { x: 13, y: 3, talkKind: 'k1', genre: 'gothic' })] }), [hero('milo')], {}, ctx);
  const dark = patch({ ...b, lights: [] }, 'milo', { x: 1, y: 1 });
  const c = apply(dark, { t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace()]) }, ctx).battle; // planning: every telegraph still to come
  const f0 = c.telegraphs.find((t) => t.unitId === 'f0');
  const f1 = c.telegraphs.find((t) => t.unitId === 'f1');
  assert.ok(f0.hidden && f1.hidden, 'one guttered, one hidden by its mind');
  assert.equal(f0.adapting, null);
  assert.equal(f1.adapting, null);
});

// ---------- item 9: carried from I's review ----------

test('a real rift’s lead that reaches the last page yields naming the real cause', () => {
  const lastPage = { id: 'lp', roundEnd: (b) => ({ battle: b, events: [], yielded: b.round >= 1 }) };
  const ctx = makeCtx({ mechanics: { fallback: lastPage }, foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  const lead = stray('lead', { x: 10, y: 2, talkKind: null, name: 'Madame Voss' });
  Object.assign(lead, { rank: 'lead', size: 2, lead: { mechanic: 'fallback', phases: 3, bars: [40, 40, 40], quote: 'q' } });
  const real = { key: 'real:1', cause: 'The Habitack checks are still red.' };
  const b = play(createBattle(fightSpec({ leadUnit: lead, kind: 'lead', real }), [hero('milo')], quiet, ctx), [{ t: 'commit' }], ctx).battle;
  const r = playRound(b, ctx);
  assert.equal(r.battle.status, 'last-page');
  assert.deepEqual(r.battle.result.real, { cause: real.cause });
  const plainRoom = playRound(play(createBattle(fightSpec({ leadUnit: lead, kind: 'lead' }), [hero('milo')], quiet, ctx), [{ t: 'commit' }], ctx).battle, ctx);
  assert.equal(plainRoom.battle.result.real, null, 'a wild lead has no real cause');
});

test('the Sentries and the bell-ringers need their bow’s count to talk down from the doorway on (foes.json’s bow.count)', () => {
  const foes = { canon: [
    { id: 'hollow-sentries', bow: { kind: 'talk-down', count: 3 } }, { id: 'drowned-bell-ringers', bow: { kind: 'bell', count: 3 } }, { id: 'tollmen', bow: { kind: 'riddle', count: 1 } },
  ] };
  const index = buildAbilityIndex({ callings: { abilities: ABILITIES }, foes });
  const ctx = makeCtx({ abilityIndex: index, foePlan: (b, id) => plan(id, [], { by: 'foe' }) });
  const canon = (id, kind, x) => ({ ...stray(id, { x, y: 2, temperament: 'polite', talkKind: kind }), kind });
  const units = [canon('f0', 'hollow-sentries', 10), canon('f1', 'drowned-bell-ringers', 11), canon('f2', 'tollmen', 12)];
  const fight = fightSpec({ foes: units });
  const plainNeed = createBattle(fightSpec({ foes: [stray('f9', { x: 10, y: 2, temperament: 'polite', talkKind: 'plain' })] }), [hero('milo')], quiet, ctx).talk.plain.need;
  const b = createBattle(fight, [hero('milo')], { ...quiet, talk: { 'hollow-sentries': plainNeed, 'drowned-bell-ringers': plainNeed } }, ctx);
  assert.deepEqual([b.talk['hollow-sentries'].need, b.talk['drowned-bell-ringers'].need, b.talk.tollmen.need], [3, 3, plainNeed]);
  assert.ok(!b.talk['hollow-sentries'].done && !b.talk['drowned-bell-ringers'].done, `a doorway calm of ${plainNeed} doesn’t settle them`);
  const charmed = createBattle(fight, [hero('milo'), hero('pip')], quiet, ctx);
  assert.equal(charmed.talk['hollow-sentries'].need, 2, 'Charm 3+ in the party: one fewer');
  const spawned = spawnFoe(createBattle(fightSpec({ foes: [] }), [hero('milo')], quiet, ctx), canon('x', 'hollow-sentries', 9), { x: 9, y: 2 }, ctx).battle;
  assert.equal(spawned.talk['hollow-sentries'].need, 3, 'one that joins later too');
  const live = realAbilities();
  if (live) {
    assert.deepEqual(canonBow(live, 'hollow-sentries'), { kind: 'talk-down', count: 3 });
    assert.deepEqual(canonBow(live, 'drowned-bell-ringers'), { kind: 'bell', count: 3 });
  }
});

test('a lead’s damageTaken hears the amount before resistance, and what it gives back isn’t shown as resisted', () => {
  const heard = [];
  const snuffs = { id: 's', damageTaken: (b, hit) => { heard.push(hit); return hit.before; } };
  const ctx = makeCtx({ mechanics: { fallback: snuffs }, foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  const lead = stray('lead', { x: 3, y: 1, talkKind: null, name: 'Madame Voss', resist: { plain: 50 } });
  Object.assign(lead, { rank: 'lead', size: 2, lead: { mechanic: 'fallback', phases: 3, bars: [90, 90, 90], quote: 'q' } });
  let b = createBattle(fightSpec({ leadUnit: lead, kind: 'lead' }), [hero('milo', { strike: { amount: 6, kind: 'plain', reach: 1, range: 0, weapon: 'standard' } })], quiet, ctx);
  b = patch(b, 'milo', { x: 2, y: 1 });
  const r = playRound(play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.strike('lead'), A.strike('lead')]) }, { t: 'commit' }], ctx).battle, ctx);
  const hits = r.events.filter((e) => e.t === 'damage' && e.target === 'lead');
  assert.ok(heard.length && hits.length, 'the Strikes landed');
  assert.ok(heard.every((h) => h.amount === 0 && h.before > 0 && h.resisted === h.before), 'resisted to nothing, and the hook still hears the amount before');
  assert.ok(hits.every((e) => e.amount > 0 && e.resist === 0), 'given back in full: nothing shows as resisted');
});

test('the planner offers an action that needs the target examined after an Examine planned earlier that round; its odds keep ‘?’', () => {
  const nameStep = { action: { id: 'use', ability: 'mech:name-a-step', cost: 1, target: { unit: 'lead' }, extra: 0, choice: null, cheer: false, trigger: null }, words: 'Name a step', cost: 1, targets: [{ unit: 'lead' }] };
  const mech = { id: 'big', actions: (b) => [{ ...nameStep, why: b.units.find((u) => u.id === 'lead').examined ? null : 'Examine it first' }] };
  const ctx = makeCtx({ mechanics: { fallback: mech }, foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  const lead = stray('lead', { x: 5, y: 1, talkKind: null });
  Object.assign(lead, { rank: 'lead', size: 2, lead: { mechanic: 'fallback', phases: 3, bars: [30, 30, 30], quote: 'q' } });
  const b = createBattle(fightSpec({ leadUnit: lead, kind: 'lead' }), [hero('pip')], quiet, ctx);
  const why = (p, slot) => legalActions(b, 'pip', ctx, { slot, plan: p }).find((o) => o.action.ability === 'mech:name-a-step').why;
  assert.equal(why(plan('pip', [A.brace(), A.brace()]), 1), 'Examine it first');
  const p = plan('pip', [A.examine('lead'), A.strike('lead')]);
  assert.equal(why(p, 1), null, 'offered after the planned Examine');
  assert.equal(why(p, 0), 'Examine it first', 'but not before it');
  assert.equal(oddsFor(b, 'pip', A.strike('lead'), ctx, { slot: 1, plan: p })[0].known, false, 'odds show ‘?’ until the Examine resolves (COMBAT §3.7)');
});

test('the screen-reader draft never doubles its preposition', () => {
  const index = buildAbilityIndex({ callings: { abilities: [...ABILITIES.filter((a) => a.id !== 'full-stop'), ab({ id: 'full-stop', name: 'Full stop', words: 'Full stop on', kind: 'knack', attack: true, target: { who: 'foe', range: 8 }, effects: [] })] } });
  const ctx = makeCtx({ abilityIndex: index });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2, name: 'Rattler' })] }), [hero('milo'), hero('claude')], quiet, ctx);
  const draft = { unitId: 'claude', plan: plan('claude', [A.use('full-stop', { unit: 'f0' }), A.use('letter', { unit: 'milo' }, { cost: 2 })]), confidence: 38, why: [] };
  const words = draftReadout(draft, b, ctx);
  assert.match(words, /^The Scribe drafts Full stop on rattler, Letter on Milo\. 38 percent sure\.$/i);
  assert.doesNotMatch(words, /\bon on\b/);
});

test('a lead room’s campfire summary is about the lead', () => {
  const ctx = makeCtx({ foePlan: () => plan('lead', [], { by: 'foe' }) });
  const lead = stray('lead', { x: 10, y: 2, talkKind: null });
  Object.assign(lead, { rank: 'lead', size: 2, lead: { mechanic: 'fallback', phases: 3, bars: [9, 9, 9], quote: 'q' } });
  const b = createBattle(fightSpec({ leadUnit: lead, kind: 'lead' }), [hero('milo')], quiet, ctx);
  assert.match(summary(b, { outcome: 'won' }), /^The Tale-lead /);
  assert.doesNotMatch(summary(b, { outcome: 'won' }), /strays/);
  const strays = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2 })] }), [hero('milo')], quiet, ctx);
  assert.match(summary(strays, { outcome: 'won' }), /^The strays went home\./);
});
