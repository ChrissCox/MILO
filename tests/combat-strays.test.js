// Strays that read you (src/combat/strays.js; CONTRACT-PHASE4.md §4.15, §4.16, §6.6, §7.2; COMBAT.md
// §3.6): counterFor at each adaptation step, a counter changing the plan and showing the eye, Noir's
// hidden intents, Void's false targets (1 in 3 over 100,000 telegraphs), a lead's feints, and a
// genre's memory across fights.
//   node --test tests/combat-strays.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { counterFor, counterKind, counterWords, stepOf, telegraphsOf, noirHidden, revise, genreMemory, rememberHabits } from '../src/combat/strays.js';
import { makeMinds, foeTarget, foePlan } from '../src/combat/ai.js';
import { TEMPLATE_IDS as T, abilityHash } from '../src/combat/notebook.js';
import { createBattle, apply, buildTelegraphs } from '../src/combat/battle.js';
import { commit, step, answer } from '../src/combat/driver.js';
import { hashInts } from '../src/world/rng.js';
import { standing } from '../src/combat/round.js';
import { actionWords } from '../src/combat/describe.js';
import { assertCalm } from './calm.js';
import { hero, stray, fightSpec, rules, abilities, GENRES, findUnit, A, plan as planOf, playRound } from './combat-kit.js';
import { world, ctxFor, partyAt, roomsFor } from './minds-kit.js';

function realCtx() {
  const ctx = {
    rules, abilities, minds: null, mechanics: {}, bows: null, genres: GENRES,
    party: { milo: { personality: 'careful', barks: [], voice: 'words' }, claude: { personality: 'careful', barks: [], voice: 'words' }, codex: { personality: 'steady', barks: [], voice: 'words' } },
  };
  ctx.minds = makeMinds(ctx);
  return Object.freeze(ctx);
}
const ctx = realCtx();
const heroes = () => [hero('milo'), hero('claude'), hero('codex')];
const k = (template, ability = 0) => `${template}:${ability}`;

function battleAt({ rank = 'stray', level = 1, roadLevel = 1, mode = 'long-road', round = 1, seen = {}, memory = null, adaptation = true, genre = 'neon' } = {}) {
  const f = stray('f0', { x: 8, y: 2, rank, level, genre });
  const b = createBattle(fightSpec({ foes: [f], level, genres: [genre] }), heroes(), { roadLevel, mode, calm: { noise: true, adaptation }, memory }, ctx);
  return { ...b, round, seen };
}

test('adaptation steps follow rank, level and mode (B’s adaptStep)', () => {
  assert.equal(stepOf(battleAt({ rank: 'lackey' }), findUnit(battleAt({ rank: 'lackey' }), 'f0'), ctx), 0);
  const s = (o) => { const b = battleAt(o); return stepOf(b, findUnit(b, 'f0'), ctx); };
  assert.equal(s({}), 1);
  assert.equal(s({ rank: 'elite' }), 2);
  assert.equal(s({ level: 3, roadLevel: 1 }), 2, 'two above the party: one up');
  assert.equal(s({ level: 1, roadLevel: 3 }), 0, 'two below: one down');
  assert.equal(s({ mode: 'mauds-table' }), 2);
  assert.equal(s({ mode: 'storybook' }), 0);
  assert.equal(s({ adaptation: false }), 0);
});

test('counterFor: step 0 never; step 1 the first habit seen twice', () => {
  assert.equal(counterFor(battleAt({ rank: 'lackey', seen: { [k(11)]: 5 } }), 'f0', ctx), null);
  assert.equal(counterFor(battleAt({ seen: { [k(11)]: 1 } }), 'f0', ctx), null, 'seen once is nothing yet');
  const c = counterFor(battleAt({ seen: { [k(30)]: 1, [k(20, 7)]: 2, [k(11)]: 5 } }), 'f0', ctx);
  assert.equal(c.habit, k(20, 7), 'the first to reach two, not the most');
  assert.equal(c.step, 1);
});

test('counterFor: step 2 from round 2 counters the most-used habit, or the genre’s memory when that’s higher', () => {
  const seen = { [k(30)]: 1, [k(11)]: 4, [k(1)]: 2 };
  assert.equal(counterFor(battleAt({ rank: 'elite', round: 1, seen }), 'f0', ctx), null, 'not in round 1');
  assert.equal(counterFor(battleAt({ rank: 'elite', round: 2, seen }), 'f0', ctx).habit, k(11));
  const remembered = counterFor(battleAt({ rank: 'elite', round: 2, seen, memory: { habit: k(20, 9), count: 9 } }), 'f0', ctx);
  assert.equal(remembered.habit, k(20, 9));
  assert.match(remembered.words, /Neon remembers/);
  assert.equal(counterFor(battleAt({ rank: 'elite', round: 2, seen, memory: { habit: k(20, 9), count: 3 } }), 'f0', ctx).habit, k(11), 'a lower memory loses');
});

test('counterFor: step 3 plans from round 1 (with memory), and step 4 names the top two', () => {
  const lead3 = counterFor(battleAt({ rank: 'lead', round: 1, memory: { habit: k(1), count: 2 } }), 'f0', ctx);
  assert.equal(lead3.step, 3);
  assert.equal(lead3.habit, k(1));
  const four = counterFor(battleAt({ rank: 'lead', level: 3, roadLevel: 1, round: 1, seen: { [k(30)]: 2, [k(11)]: 4, [k(1)]: 3 } }), 'f0', ctx);
  assert.equal(four.step, 4);
  assert.deepEqual(four.habits, [k(11), k(1)]);
  assert.match(four.words, / and /);
});

test('a countered habit changes the plan and shows the eye with its words', () => {
  // The Scribe is the lowest and the nearest; a grumpy stray goes for her until it has seen the party patch the lowest twice.
  const f = stray('f0', { x: 3, y: 2, temperament: 'grumpy' });
  let b = createBattle(fightSpec({ foes: [f] }), heroes(), {}, ctx);
  b = { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, integrity: 4 } : u.id === 'milo' ? { ...u, x: 8, y: 4 } : u.id === 'codex' ? { ...u, x: 9, y: 1 } : u.id === 'd0' ? { ...u, x: 12, y: 1 } : u)) };
  const before = foeTarget(b, findUnit(b, 'f0'), ctx);
  const seen = { ...b, seen: { [k(T['patch-lowest'], abilityHash('letter'))]: 2 } };
  const counter = counterFor(seen, 'f0', ctx);
  assert.equal(counterKind(counter.habit), 'spread');
  const after = foeTarget(seen, findUnit(seen, 'f0'), ctx);
  assert.notEqual(after.id, 'claude', 'it spreads its hits');
  assert.equal(before.id, 'claude');
  const tel = telegraphsOf(seen, 'f0', foePlan(seen, 'f0', ctx), ctx);
  assert.ok(tel.length && tel.every((t) => t.adapting === counter.words));
  assert.equal(counter.words, 'Spreading its hits: you’ve patched the most hurt ally twice.');
  assert.ok(telegraphsOf(b, 'f0', foePlan(b, 'f0', ctx), ctx).every((t) => t.adapting === null), 'no eye before it’s seen anything');
});

test('the eye shows exactly where a counter changed the plan, over real rooms, nine habits and both modes that adapt', () => {
  const party = partyAt(world, 3, 4);
  const rctx = ctxFor(world, party);
  const eyes = {};
  const shown = {};
  for (const mode of ['long-road', 'mauds-table']) {
    for (const habit of ['31:0', '14:0', '30:0', '20:0', '11:0', '12:0', '1:0', '4:0', '5:0']) {
      for (const r of roomsFor(world, { level: 3, room: 'moderate', partySize: 4, seed: 11, count: 16 })) {
        const b0 = createBattle(r.fights[0], party, { roadLevel: 3, mode }, rctx);
        // Round 2; the party has shown the habit three times, and Milo is the most hurt.
        const units = b0.units.map((u) => (u.id === 'milo' ? { ...u, integrity: Math.max(1, Math.floor(u.maxIntegrity * 0.3)) } : u));
        const b = Object.freeze({ ...b0, round: 2, seen: { [habit]: 3 }, units });
        const plainB = Object.freeze({ ...b, seen: {} });
        for (const f of b.units.filter((u) => u.side === 'foe' && !u.sorted)) {
          const plan = foePlan(b, f.id, rctx);
          const plain = foePlan(plainB, f.id, rctx);
          const counter = counterFor(b, f.id, rctx);
          for (const t of telegraphsOf(b, f.id, plan, rctx)) {
            const changed = JSON.stringify(plan.slots[t.slot]) !== JSON.stringify(plain.slots[t.slot]);
            // A hidden intent (a Noir stray in the dark) shows no eye.
            assert.equal(!!t.adapting, changed && !t.hidden, `${mode} ${habit} ${f.id} slot ${t.slot}`);
            if (!t.adapting) continue;
            eyes[`${mode} ${habit}`] = (eyes[`${mode} ${habit}`] || 0) + 1;
            assert.equal(t.adapting, counter.words);
            shown[habit] = (shown[habit] || 0) + 1;
            // Spreading its hits never aims at the most hurt hero (Milo), at Maud's Table included. (A
            // Void stray's telegraph may show Milo as its false target; its real aim is the plan's.)
            const aim = t.falseTarget ? [plan.slots[t.slot]?.target?.unit].filter(Boolean) : t.targets || [];
            if (habit === '20:0') assert.ok(!aim.includes('milo'), `${mode} ${f.id}: ${t.adapting} ${JSON.stringify(aim)}`);
          }
        }
      }
    }
  }
  assert.equal(shown['31:0'] || 0, 0, 'cooling down has no counter, so no eye');
  for (const h of ['14:0', '30:0', '20:0']) assert.ok(shown[h] > 0, `${h}: ${JSON.stringify(eyes)}`);
  assert.ok(eyes['mauds-table 20:0'] > 0 && eyes['long-road 20:0'] > 0);
});

test('Keeping clear of its friends: against area habits a stray steps in apart from the others, and the eye says so', () => {
  const foes = [stray('f0', { x: 8, y: 3 }), stray('f1', { x: 5, y: 3, talkKind: 'k1' })];
  let b = createBattle(fightSpec({ foes }), [hero('milo'), hero('claude')], {}, ctx);
  b = { ...b, round: 2, units: b.units.map((u) => (u.id === 'milo' ? { ...u, x: 3, y: 2 } : u.id === 'claude' ? { ...u, x: 1, y: 4 } : u)) };
  const plain = foePlan(b, 'f0', ctx);
  const plainEnd = plain.slots[0].target.path.at(-1);
  assert.ok(Math.max(Math.abs(plainEnd.x - 5), Math.abs(plainEnd.y - 3)) <= 1, 'without a counter it stops beside its friend');
  const seen = { ...b, seen: { [k(T['hit-area'])]: 3 } };
  const p = foePlan(seen, 'f0', ctx);
  const end = p.slots[0].target.path.at(-1);
  assert.ok(Math.max(Math.abs(end.x - 5), Math.abs(end.y - 3)) > 1, `apart from its friend (${end.x},${end.y})`);
  assert.ok(Math.max(Math.abs(end.x - 3), Math.abs(end.y - 2)) <= 1, 'still beside Milo');
  assert.deepEqual(p.changed, [true, false, false]);
  const tel = telegraphsOf(seen, 'f0', p, ctx);
  assert.equal(tel.find((t) => t.slot === 0).adapting, 'Keeping clear of its friends: you’ve caught several strays at once three times.');
  assert.ok(tel.filter((t) => t.slot > 0).every((t) => t.adapting === null), 'only the changed slot');
});

test('step 4 plays both habits it names: spreading its hits and striking before you brace', () => {
  const f = stray('f0', { x: 4, y: 2, rank: 'lead', level: 3 });
  let b = createBattle(fightSpec({ foes: [f], level: 3 }), heroes(), { roadLevel: 1 }, ctx);
  b = { ...b, round: 2, order: ['milo', 'f0', 'claude', 'codex', 'd0'], units: b.units.map((u) => (u.id === 'claude' ? { ...u, integrity: 4 } : u.id === 'd0' ? { ...u, x: 13, y: 4 } : u)) };
  const one = { ...b, seen: { [k(T['patch-lowest'])]: 4 } };
  const two = { ...b, seen: { [k(T['patch-lowest'])]: 4, [k(T.brace)]: 3 } };
  assert.equal(counterFor(two, 'f0', ctx).step, 4);
  assert.deepEqual(counterFor(two, 'f0', ctx).habits, [k(T['patch-lowest']), k(T.brace)]);
  // Spreading alone: Milo (the nearest of the two not being patched, and first in the ribbon). Both: the Artificer, who acts after it.
  assert.equal(foeTarget(one, findUnit(one, 'f0'), ctx).id, 'milo');
  assert.equal(foeTarget(two, findUnit(two, 'f0'), ctx).id, 'codex');
  const p = foePlan(two, 'f0', ctx);
  assert.ok(p.slots.some((a) => a.target?.unit === 'codex'));
  const tel = telegraphsOf(two, 'f0', p, ctx);
  assert.ok(tel.some((t) => t.adapting === 'Spreading its hits: you’ve patched the most hurt ally and braced four times.'));
  assert.ok(tel.every((t) => !!t.adapting === !!p.changed[t.slot]));
});

test('a counter that changes nothing shows no eye: a habit nothing counters, or keeping its distance for a stray that isn’t the most hurt', () => {
  const cool = battleAt({ round: 2, seen: { [k(T['cool-down'])]: 3 } });
  const c = counterFor(cool, 'f0', ctx);
  assert.equal(c.habit, k(T['cool-down']), 'the counter still names what it saw');
  const p = foePlan(cool, 'f0', ctx);
  assert.ok(p.changed.every((x) => !x));
  assert.ok(telegraphsOf(cool, 'f0', p, ctx).every((t) => t.adapting === null));
  // Two strays; the party strikes the most hurt stray. Only the most hurt one (f1) keeps its distance.
  const foes = [stray('f0', { x: 3, y: 2 }), stray('f1', { x: 3, y: 3, talkKind: 'k1', integrity: 5 })];
  const b = { ...createBattle(fightSpec({ foes }), heroes(), {}, ctx), round: 2, seen: { [k(T['hit-weakest'])]: 3 } };
  const hale = foePlan(b, 'f0', ctx);
  assert.ok(hale.changed.every((x) => !x) && telegraphsOf(b, 'f0', hale, ctx).every((t) => t.adapting === null));
  const hurt = foePlan(b, 'f1', ctx);
  assert.ok(hurt.changed.some(Boolean), JSON.stringify(hurt.slots.map((a) => a.id)));
  assert.ok(telegraphsOf(b, 'f1', hurt, ctx).some((t) => /^Keeping its distance/.test(t.adapting || '')));
});

test('against “struck another stray” the nearest stray hits once and steps back; the most hurt one doesn’t', () => {
  // f0 stands beside the heroes, unhurt; f1 is farther off and the most hurt.
  const foes = [stray('f0', { x: 2, y: 2 }), stray('f1', { x: 8, y: 3, talkKind: 'k1', integrity: 5 })];
  const b0 = createBattle(fightSpec({ foes }), heroes(), {}, ctx);
  const b = { ...b0, round: 2, seen: { [k(T['hit-other'])]: 3 } };
  assert.equal(counterKind(k(T['hit-other'])), 'keep-distance');
  const plain = foePlan({ ...b, seen: {} }, 'f0', ctx);
  assert.ok(plain.slots.filter((a) => a?.id === 'strike').length >= 2, 'without a counter it strikes and strikes again');
  const p = foePlan(b, 'f0', ctx);
  assert.equal(p.slots.filter((a) => a?.id === 'strike').length, 1, JSON.stringify(p.slots.map((a) => a?.id)));
  assert.ok(p.slots.some((a) => a?.id === 'step'), 'then steps back');
  const tel = telegraphsOf(b, 'f0', p, ctx);
  assert.ok(tel.some((t) => t.adapting === 'Keeping its distance: you’ve struck another stray three times.'));
  assert.ok(tel.every((t) => !!t.adapting === !!p.changed[t.slot]));
  const far = foePlan(b, 'f1', ctx);
  assert.ok(far.changed.every((x) => !x), 'the most hurt stray isn’t the one that habit strikes');
});

test('against “hindered a stray” it goes for whoever has the hindering move, and bites only while they stand', () => {
  // Milo is nearest and first in the ribbon; the Scribe has Draft, the move the party hindered with.
  const f = stray('f0', { x: 3, y: 1, temperament: 'grumpy' });
  const habit = k(T['hinder-other'], abilityHash('draft'));
  const b0 = createBattle(fightSpec({ foes: [f] }), heroes(), {}, ctx);
  const b = { ...b0, round: 2, seen: { [habit]: 2 } };
  assert.equal(counterKind(habit), 'go-for-source');
  assert.equal(foeTarget({ ...b, seen: {} }, findUnit(b, 'f0'), ctx).id, 'milo');
  assert.equal(foeTarget(b, findUnit(b, 'f0'), ctx).id, 'claude');
  const p = foePlan(b, 'f0', ctx);
  assert.ok(p.slots.some((a) => a?.target?.unit === 'claude'));
  const tel = telegraphsOf(b, 'f0', p, ctx);
  assert.ok(tel.some((t) => t.adapting === 'Going for whoever hinders it: you’ve hindered a stray twice.'));
  // With the Scribe offline, nobody standing has Draft: the counter doesn't bite, and no eye shows.
  const gone = { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, integrity: 0, offline: true } : u)) };
  const q = foePlan(gone, 'f0', ctx);
  assert.ok(q.changed.every((x) => !x) && telegraphsOf(gone, 'f0', q, ctx).every((t) => t.adapting === null));
  // A basic action's habit names no ability, so there's no one to go for.
  assert.equal(foeTarget({ ...b, seen: { [k(T['hinder-other'])]: 2 } }, findUnit(b, 'f0'), ctx).id, 'milo');
});

test('the eye keeps the words it planned with while the round runs, though the heroes’ habits keep counting', () => {
  const party = partyAt(world, 3, 4);
  const rctx = ctxFor(world, party);
  let checked = 0;
  let drifted = 0;
  for (const r of roomsFor(world, { level: 3, room: 'moderate', partySize: 4, seed: 23, count: 12 })) {
    const b0 = createBattle(r.fights[0], party, { roadLevel: 3, mode: 'mauds-table' }, rctx);
    // Round 2 with Milo hurt: "patched the most hurt ally" leads by insertion, tied with habits the heroes will show again.
    const units = b0.units.map((u) => (u.id === 'milo' ? { ...u, integrity: Math.max(1, Math.floor(u.maxIntegrity * 0.3)) } : u));
    const b1 = { ...b0, units, round: 2, seen: { [k(T['patch-lowest'])]: 2, [k(T.reposition)]: 2, [k(T['close-in'])]: 2, [k(T['hit-weakest'])]: 2, [k(T['hit-other'])]: 2, [k(T.brace)]: 2 } };
    const plans = { ...b1.plans };
    for (const u of b1.units) if (u.side === 'foe' && !u.sorted) plans[u.id] = foePlan(b1, u.id, rctx);
    let b = { ...b1, plans };
    b = { ...b, telegraphs: buildTelegraphs(b, rctx) };
    const planned = new Map(b.telegraphs.filter((t) => t.adapting).map((t) => [t.unitId, t.adapting]));
    if (!planned.size) continue;
    const heroPlans = Object.fromEntries(party.map((h) => [h.id, rctx.minds.scriptedPlan(b, h.id)]));
    let s = commit(b, heroPlans, rctx).battle;
    for (let i = 0; i < 16 && (s.status === 'running' || s.status === 'asking'); i += 1) {
      s = s.status === 'asking' ? answer(s, true, rctx).battle : step(s, rctx).battle;
      // Only this round: the next round plans afresh (and reads afresh).
      if (s.round !== 2 || (s.status !== 'running' && s.status !== 'asking')) break;
      for (const t of s.telegraphs || []) {
        if (!t.adapting || !planned.has(t.unitId)) continue;
        assert.equal(t.adapting, planned.get(t.unitId));
        checked += 1;
        // A fresh read now would name another habit: the words held anyway.
        if (counterFor(s, t.unitId, rctx)?.words !== t.adapting) drifted += 1;
      }
    }
  }
  assert.ok(checked > 0);
  assert.ok(drifted > 0, 'some rounds’ habits moved the fresh read');
});

test('the eye’s words are calm for every habit, count and memory', () => {
  for (let t = 1; t < 50; t += 1) {
    for (const n of [2, 3, 7]) assertCalm(counterWords(k(t), n), `counter ${t}`, { proper: ['Tale-lead'] });
    assertCalm(counterWords(k(t), 4, { genre: 'kaiju', second: k(30) }), `memory ${t}`, { proper: ['Tale-lead', 'Titan'] });
  }
});

test('a Noir stray’s intents hide until a Seek, an Examine or the lantern’s light', () => {
  const f = stray('f0', { x: 13, y: 4, genre: 'noir', temperament: 'grumpy' });
  const b = createBattle(fightSpec({ foes: [f], genres: ['noir'] }), heroes(), {}, ctx);
  assert.ok(b.telegraphs.filter((t) => t.unitId === 'f0').every((t) => t.hidden), 'hidden at first');
  assert.ok(noirHidden(b, findUnit(b, 'f0')));
  const examined = { ...b, units: b.units.map((u) => (u.id === 'f0' ? { ...u, examined: true, revealedUntil: 'fight' } : u)) };
  assert.ok(!noirHidden(examined, findUnit(examined, 'f0')));
  const sought = { ...b, units: b.units.map((u) => (u.id === 'f0' ? { ...u, revealedUntil: 'end-of-round' } : u)) };
  assert.ok(telegraphsOf(sought, 'f0', b.plans.f0, ctx).every((t) => !t.hidden));
  const lit = { ...b, lights: b.lights.map((l) => (l.id === 'hooklight' ? { ...l, x: 12, y: 4 } : l)) };
  assert.ok(telegraphsOf(lit, 'f0', b.plans.f0, ctx).every((t) => !t.hidden), 'the lantern’s light shows it');
  // In play: a Seek reveals them for the round.
  let r = apply(b, { t: 'plan', unitId: 'milo', plan: planOf('milo', [A.seek()]) }, ctx).battle;
  r = apply(r, { t: 'commit' }, ctx).battle;
  r = playRound(r, ctx).battle;
  assert.ok(r.round === 2);
});

test('a Void stray names a false target 1 time in 3 (within a point over 100,000 telegraphs), only with another target, and never once Examined', () => {
  // Beside all three heroes, so each is a legal target for its Strikes.
  const f = stray('f0', { x: 2, y: 2, genre: 'void', temperament: 'grumpy' });
  const base = createBattle(fightSpec({ foes: [f], genres: ['void'] }), heroes(), {}, ctx);
  const plan = planOf('f0', [A.strike('milo'), A.strike('milo'), A.strike('claude')], { by: 'foe' });
  const tileKey = (p) => `${p.x},${p.y}`;
  let total = 0;
  let fake = 0;
  for (let i = 0; total < 100000; i += 1) {
    const b = { ...base, seed: hashInts(i, 'void'), round: 1 + (i % 9), attempt: i % 3 };
    for (const t of telegraphsOf(b, 'f0', plan, ctx)) {
      total += 1;
      const realId = plan.slots[t.slot].target.unit;
      if (t.falseTarget) {
        fake += 1;
        assert.notEqual(t.falseTarget, realId);
        assert.ok(t.words.length <= 60);
        // Everything drawn is the false target's (§18.3): its words, its targets and its tiles, never the real target's.
        const shown = findUnit(b, t.falseTarget);
        const real = findUnit(b, realId);
        assert.equal(t.words, actionWords(b, 'f0', { ...plan.slots[t.slot], target: { unit: shown.id } }, ctx).slice(0, 60));
        assert.deepEqual(t.targets, [shown.id]);
        assert.deepEqual(t.tiles.map(tileKey), [tileKey(shown)]);
        assert.ok(!t.tiles.some((p) => tileKey(p) === tileKey(real)), `${t.words}: ${JSON.stringify(t.tiles)}`);
      } else {
        assert.deepEqual(t.targets, [realId], 'no lie: the real target');
      }
    }
  }
  const rate = fake / total;
  assert.ok(Math.abs(rate - 1 / 3) <= 0.01, `rate ${(rate * 100).toFixed(2)}%`);
  const examined = { ...base, units: base.units.map((u) => (u.id === 'f0' ? { ...u, examined: true } : u)) };
  for (let i = 0; i < 300; i += 1) assert.ok(telegraphsOf({ ...examined, seed: i }, 'f0', plan, ctx).every((t) => !t.falseTarget));
  const alone = createBattle(fightSpec({ foes: [f], genres: ['void'] }), [hero('milo')], {}, ctx);
  for (let i = 0; i < 300; i += 1) assert.ok(telegraphsOf({ ...alone, seed: i }, 'f0', planOf('f0', [A.strike('milo')], { by: 'foe' }), ctx).every((t) => !t.falseTarget));
});

test('a Void stray’s false target is one its action could really reach, from where it will stand', () => {
  // It strides to (2,1), then strikes Milo. From there the Scribe is in reach and the Artificer (1,3) isn’t.
  const f = stray('f0', { x: 5, y: 1, genre: 'void', temperament: 'grumpy' });
  const base = createBattle(fightSpec({ foes: [f], genres: ['void'] }), heroes(), {}, ctx);
  const plan = planOf('f0', [A.stride([{ x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }]), A.strike('milo')], { by: 'foe' });
  const named = new Set();
  let lies = 0;
  for (let i = 0; i < 600; i += 1) {
    for (const t of telegraphsOf({ ...base, seed: hashInts(i, 'reach') }, 'f0', plan, ctx)) {
      if (!t.falseTarget) continue;
      lies += 1;
      named.add(t.falseTarget);
    }
  }
  assert.ok(lies > 150 && lies < 250, `${lies} lies in 600`);
  assert.deepEqual([...named], ['claude'], 'only the Scribe could be struck from there');
  // From where it stands now nobody is in reach, so a Strike aimed at Milo has no other legal target.
  const now = planOf('f0', [A.strike('milo')], { by: 'foe' });
  for (let i = 0; i < 300; i += 1) assert.ok(telegraphsOf({ ...base, seed: hashInts(i, 'reach') }, 'f0', now, ctx).every((t) => !t.falseTarget));
});

test('a Void stray’s lie holds while the round runs, though the heroes move out of its reach', () => {
  let checked = 0;
  let fresh = 0;
  for (let seed = 1; seed < 400 && checked < 12; seed += 1) {
    const f = stray('f0', { x: 2, y: 2, genre: 'void', temperament: 'grumpy' });
    const b = createBattle(fightSpec({ foes: [f], genres: ['void'], seed }), heroes(), {}, ctx);
    const planned = new Map(b.telegraphs.filter((t) => t.unitId === 'f0' && t.falseTarget).map((t) => [t.slot, t.falseTarget]));
    if (!planned.size) continue;
    // Everyone walks away east along the room before the stray acts.
    const away = { milo: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }], claude: [], codex: [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }] };
    const plans = Object.fromEntries(Object.entries(away).map(([id, path]) => [id, planOf(id, path.length ? [A.stride(path)] : [A.brace()])]));
    let s = commit(b, plans, ctx).battle;
    for (let i = 0; i < 20 && s.round === 1 && (s.status === 'running' || s.status === 'asking'); i += 1) {
      s = s.status === 'asking' ? answer(s, true, ctx).battle : step(s, ctx).battle;
      if (s.round !== 1 || (s.status !== 'running' && s.status !== 'asking')) break;
      for (const t of s.telegraphs.filter((x) => x.unitId === 'f0' && planned.has(x.slot))) {
        const was = planned.get(t.slot);
        if (!standing(findUnit(s, was)) || s.plans.f0.slots[t.slot]?.target?.unit === was) continue;
        assert.equal(t.falseTarget, was, `seed ${seed} slot ${t.slot}`);
        assert.deepEqual(t.targets, [was], 'what it shows is still the false target');
        checked += 1;
        // Read afresh (as at planning), the heroes’ moves would have changed it.
        const again = telegraphsOf({ ...s, status: 'planning' }, 'f0', s.plans.f0, ctx).find((x) => x.slot === t.slot);
        if (again?.falseTarget !== was) fresh += 1;
      }
    }
  }
  assert.ok(checked > 0, 'some lies were checked mid-round');
  assert.ok(fresh > 0, 'and some would have changed if read afresh');
});

test('a restore that hands back only each telegraph’s unit, slot, eye and lie gets the same telegraphs mid-round (§18.3)', () => {
  let checked = 0;
  let lies = 0;
  let eyes = 0;
  let fresh = 0;
  for (let seed = 1; seed < 200 && checked < 60; seed += 1) {
    // A Void stray that has seen the party patch the most hurt ally twice: it spreads its hits (the eye), and lies 1 time in 3.
    const f = stray('f0', { x: 2, y: 2, genre: 'void', temperament: 'grumpy' });
    const b0 = createBattle(fightSpec({ foes: [f], genres: ['void'], seed }), heroes(), {}, ctx);
    const b1 = { ...b0, seen: { [k(T['patch-lowest'], abilityHash('letter'))]: 2 }, units: b0.units.map((u) => (u.id === 'claude' ? { ...u, integrity: 4 } : u.id === 'd0' ? { ...u, x: 12, y: 1 } : u)) };
    const b2 = { ...b1, plans: { ...b1.plans, f0: foePlan(b1, 'f0', ctx) } };
    const b = { ...b2, telegraphs: buildTelegraphs(b2, ctx) };
    // Milo and the Artificer walk off east before the stray acts, so a fresh read would lie differently or not at all.
    const away = { milo: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }], codex: [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }] };
    const plans = { milo: planOf('milo', [A.stride(away.milo)]), claude: planOf('claude', [A.brace()]), codex: planOf('codex', [A.stride(away.codex)]) };
    let s = commit(b, plans, ctx).battle;
    for (let i = 0; i < 12 && s.round === 1 && s.status === 'running'; i += 1) {
      const saved = (s.telegraphs || []).map((t) => ({ unitId: t.unitId, slot: t.slot, adapting: t.adapting, falseTarget: t.falseTarget }));
      const live = telegraphsOf(s, 'f0', s.plans.f0, ctx);
      assert.deepEqual(telegraphsOf({ ...s, telegraphs: saved }, 'f0', s.plans.f0, ctx), live, `seed ${seed} tick ${s.tick}`);
      checked += 1;
      lies += live.filter((t) => t.falseTarget).length;
      eyes += live.filter((t) => t.adapting).length;
      // Read with nothing handed back, the telegraphs would differ (the case the saved fields are for).
      if (JSON.stringify(telegraphsOf({ ...s, telegraphs: [] }, 'f0', s.plans.f0, ctx)) !== JSON.stringify(live)) fresh += 1;
      s = step(s, ctx).battle;
    }
  }
  assert.ok(checked >= 30 && lies > 0 && eyes > 0 && fresh > 0, `${checked} checks, ${lies} lies, ${eyes} eyes, ${fresh} fresh reads differ`);
});

test('the eye’s words are grammatical: “you’ve gone”, never “you’ve went”; counts in words to nine, figures from 10', () => {
  assert.equal(counterWords(k(T['hit-lead']), 5), 'Holding back a moment: you’ve gone for the Tale-lead five times.');
  assert.equal(counterWords(k(T['hit-lead']), 4, { genre: 'kaiju', second: k(T['hit-lead']) }), 'Holding back a moment: Titan remembers you’ve gone for the Tale-lead and gone for the Tale-lead.');
  assert.equal(counterWords(k(T['patch-lowest']), 6), 'Spreading its hits: you’ve patched the most hurt ally six times.');
  assert.equal(counterWords(k(T['patch-lowest']), 9), 'Spreading its hits: you’ve patched the most hurt ally nine times.');
  assert.equal(counterWords(k(T['patch-lowest']), 10), 'Spreading its hits: you’ve patched the most hurt ally 10 times.');
  const IRREGULAR = new Set(['gone', 'struck', 'caught', 'set', 'sought', 'kept', 'done']);
  const WORDS = ['once', 'twice', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  for (let t = 1; t < 50; t += 1) {
    for (let n = 1; n <= 12; n += 1) {
      const w = counterWords(k(t), n);
      const done = /you’ve ([a-z]+)/.exec(w)[1];
      assert.ok(/ed$/.test(done) || IRREGULAR.has(done), `${t}: “you’ve ${done}” in “${w}”`);
      if (n <= 9) assert.ok(w.endsWith(`${WORDS[n - 1]}${n > 2 ? ' times' : ''}.`) && !/\d/.test(w), w);
      else assert.ok(w.endsWith(` ${n} times.`), w);
    }
    // The second habit reads after the same “you’ve”.
    const both = counterWords(k(T.brace), 3, { second: k(t) });
    const second = / and ([a-z]+)/.exec(both)?.[1];
    assert.ok(second && (/ed$/.test(second) || IRREGULAR.has(second)), `${t}: “and ${second}” in “${both}”`);
  }
  // In play: a lead that has seen the party go for it five times holds back, and says so as the tests above.
  const four = counterFor(battleAt({ rank: 'lead', level: 3, roadLevel: 1, round: 1, seen: { [k(T['hit-lead'])]: 6 } }), 'f0', ctx);
  assert.equal(four.words, 'Holding back a moment: you’ve gone for the Tale-lead six times.');
});

test('a hidden intent shows no eye: the counter’s words would give it away', () => {
  const f = stray('f0', { x: 3, y: 2, temperament: 'grumpy', genre: 'noir' });
  let b = createBattle(fightSpec({ foes: [f], genres: ['noir'] }), heroes(), {}, ctx);
  b = { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, integrity: 4 } : u.id === 'milo' ? { ...u, x: 8, y: 4 } : u.id === 'codex' ? { ...u, x: 9, y: 1 } : u.id === 'd0' ? { ...u, x: 12, y: 1 } : u)) };
  // Milo carries the lantern away, so the stray stands in the dark.
  b = { ...b, lights: b.lights.map((l) => (l.id === 'hooklight' ? { ...l, x: 8, y: 4 } : l)) };
  const seen = { ...b, seen: { [k(T['patch-lowest'], abilityHash('letter'))]: 2 } };
  const p = foePlan(seen, 'f0', ctx);
  assert.ok(p.changed.some(Boolean), 'the counter changed the plan');
  const tel = telegraphsOf(seen, 'f0', p, ctx);
  assert.ok(tel.length && tel.every((t) => t.hidden && t.adapting === null));
  const shown = { ...seen, units: seen.units.map((u) => (u.id === 'f0' ? { ...u, examined: true, revealedUntil: 'fight' } : u)) };
  assert.ok(telegraphsOf(shown, 'f0', p, ctx).some((t) => !t.hidden && t.adapting), 'once it’s Examined, the eye shows');
});

test('a lead feints: it swaps a strike on a braced or guarded hero for one on an open hero, and keeps it otherwise', () => {
  const leadSpec = stray('lead', { x: 3, y: 2, rank: 'lead', size: 1, talkKind: null, lead: { mechanic: 'fallback', phases: 2, bars: [30, 30], quote: 'Well then.' } });
  let b = createBattle(fightSpec({ foes: [], leadUnit: leadSpec, lead: { mechanic: 'fallback', phases: 2, bow: '', quote: '' }, kind: 'lead' }), heroes(), { roadLevel: 1 }, ctx);
  assert.ok(b.lead && b.lead.feintsLeft >= 1, `feints ${b.lead?.feintsLeft}`);
  const aim = { unitId: 'lead', slots: [A.strike('milo'), A.strike('milo')], reactions: {}, by: 'foe', changed: [false, false] };
  const withPlans = (miloPlan) => ({ ...b, plans: { ...b.plans, lead: aim, milo: miloPlan } });
  // Milo braces: the lead goes for someone else.
  const braced = withPlans(planOf('milo', [A.brace()]));
  const next = revise(braced, 'lead', 1, ctx);
  if (next) assert.notEqual(next.target.unit, 'milo');
  // Milo open, nobody guarding: no feint.
  const open = { ...withPlans(planOf('milo', [A.strike('lead')])), units: b.units.map((u) => (u.id === 'claude' || u.id === 'codex' ? { ...u, x: 12, y: 4 + (u.id === 'codex' ? -2 : 0), reactions: {} } : u)) };
  assert.equal(revise(open, 'lead', 1, ctx), null);
  // No feints left: nothing.
  assert.equal(revise({ ...braced, lead: { ...braced.lead, feintsLeft: 0 } }, 'lead', 1, ctx), null);
  // Only leads feint.
  assert.equal(revise(braced, 'milo', 1, ctx), null);
});

test('a genre remembers your most-used habit across fights, and forgets nothing it needn’t', () => {
  const party = { roster: {}, strayMemory: {} };
  const rec = (choices) => ({ key: 1, round: 1, units: { milo: { choices }, claude: { choices: [] } } });
  const one = rememberHabits(party, 'neon', [rec([{ template: 11, ability: 0, relation: 3 }, { template: 11, ability: 0, relation: 3 }, { template: 30, ability: 0, relation: 1 }])]);
  assert.deepEqual(genreMemory(one, 'neon'), { habit: '11:0', count: 2 });
  assert.equal(genreMemory(one, 'gothic'), null);
  const two = rememberHabits(one, 'neon', [rec([{ template: 11, ability: 0 }])]);
  assert.deepEqual(genreMemory(two, 'neon'), { habit: '11:0', count: 3 }, 'the same habit adds up');
  const three = rememberHabits(two, 'neon', [rec([{ template: 30, ability: 0 }])]);
  assert.equal(three, two, 'a habit used less than the one remembered changes nothing');
  const four = rememberHabits(two, 'neon', [rec([1, 2, 3, 4].map(() => ({ template: 1, ability: 0 })))]);
  assert.deepEqual(genreMemory(four, 'neon'), { habit: '1:0', count: 4 });
  assert.equal(rememberHabits(party, 'neon', []), party);
  assert.equal(rememberHabits(party, 'Bad!', [rec([{ template: 1, ability: 0 }])]), party);
  // At most 12 genres, the least-used going first.
  let many = party;
  for (let i = 0; i < 14; i += 1) many = rememberHabits(many, `genre-${String.fromCharCode(97 + i)}`, [rec(new Array(i + 1).fill({ template: 1, ability: 0 }))]);
  assert.equal(Object.keys(many.strayMemory).length, 12);
  assert.ok(!many.strayMemory['genre-a'] && many.strayMemory['genre-n']);
});
