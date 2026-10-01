// The kernel's exact numbers and seeds, each pinned by its own assertion (module B: src/combat/*.js;
// CONTRACT-PHASE4.md §4.3, §4.4, §4.9, §4.15–§4.17, §6.5, §13 wave 1 B): Cool down's 30, noise
// sparing a patch only under a quarter, a hazard's reach of 1, lingering's 3 turns, Storybook
// scaling only foes, a shy stray settling at half, a Reboot's 1 at least, the raised lantern's 20
// drift, Proofread's range, the toll meeting body Resolve, Examine and Talk down needing sight, Wit
// 3+ only for 2- and 3-action spells, Cleave's half, Steady hands on a thrown cordial, Still water's
// 4 levels, first in every tick, no swipes while surprised, and §4.16's hash inputs (the Void pair's
// tick, the hum's round, Nodding off's slot, the sneak's tag and the bark's round).
//   node --test tests/combat-pins.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashInts, unit } from '../src/world/rng.js';
import { degreeAt } from '../src/combat/heat.js';
import { makeRun, landHit, addCondition, rebootUnit, pickOutcome } from '../src/combat/effects.js';
import { legalActions, sneakCheck } from '../src/combat/battle.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { noiseExempt, oddsAgainst, schedule } from '../src/combat/round.js';
import { canSwipe } from '../src/combat/grid.js';
import { rules, hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ab, ABILITIES } from './combat-kit.js';

const noNoise = { calm: { noise: false, adaptation: true } };
const still = (id) => plan(id, [], { by: 'foe' });
const place = (b, id, x, y, patch = {}) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, x, y, ...patch } : u)) });
const patchUnit = (b, id, patch) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const passive = (id, list) => ab({ id, kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: list, summons: [] } });
const withAbilities = (extra, opts = {}) => makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, ...extra] } }), ...opts });
const quiet = (opts = {}) => makeCtx({ foePlan: (bb, id) => still(id), ...opts });
const rate = (genre) => {
  const r = rules.genres[genre].noise.rate;
  return Array.isArray(r) ? r[0] / r[1] : r;
};

function round(b, ctx, plans) {
  const c = play(b, [...Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) })), { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { battle: r.battle, events: [...c.events, ...r.events] };
}

// ---------- heat, noise and hazards ----------

test('Cool down takes exactly 30 heat, and never below 0', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo')], noNoise, ctx);
  for (const [from, to] of [[70, 40], [25, 0]]) {
    const r = round(patchUnit(b, 'milo', { heat: from }), ctx, { milo: [A.cool()] });
    const at = r.events.findIndex((e) => e.t === 'act' && e.unit === 'milo');
    assert.equal(r.events.slice(at).find((e) => e.t === 'heat' && e.unit === 'milo').heat, to, `${from} → ${to}`);
  }
});

test('Maud’s Table’s +15 idle heat is the party’s only; strays keep their temperament’s', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2, temperament: 'grumpy' })] }), [hero('milo')], { ...noNoise, mode: 'mauds-table' }, ctx);
  assert.deepEqual([findUnit(b, 'milo').heat, findUnit(b, 'f0').heat], [20 + 15, rules.heat.temperaments.grumpy]);
});

test('low cover counts only on a tile beside the target and not beside the attacker', () => {
  const rows = ['################', '#..............#', '#...o..........#', '#..............#', '#..............#', '################'];
  const ctx = quiet();
  const b = createBattle(fightSpec({ arenaRows: rows, foes: [stray('f0', { x: 5, y: 2 })] }), [hero('milo')], noNoise, ctx);
  const cover = (x) => oddsAgainst(place(b, 'milo', x, 2), ctx, 'milo', 'f0', { harmful: true, meets: 'guard', attack: true }).parts.find((p) => p.why === 'low cover')?.n;
  assert.equal(cover(2), -1, 'from 2 away the o beside the beetle is cover');
  assert.equal(cover(3), undefined, 'from beside the o it isn’t');
});

test('noise spares a patch only on an ally under a quarter of their Integrity (the Scribe’s 16: under 4)', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo'), hero('claude')], noNoise, ctx);
  const spared = (hp) => noiseExempt(patchUnit(b, 'claude', { integrity: hp }), ctx, A.use('letter', { unit: 'claude' }));
  assert.deepEqual([3, 4, 5, 7].map(spared), [true, false, false, false]);
});

test('a hazard prop’s burst reaches everyone within 1 of it, and no further', () => {
  const ctx = quiet();
  const objects = [{ id: 'o0', kind: 'prop', x: 6, y: 2, state: 'oil-drum', flags: ['hazard', 'cover-low'], integrity: null }];
  const foes = [stray('f0', { x: 5, y: 2, integrity: 60, maxIntegrity: 60 }), stray('f1', { x: 8, y: 2, talkKind: 'k1' }), stray('f2', { x: 7, y: 1, talkKind: 'k2', integrity: 60, maxIntegrity: 60 })];
  const run = makeRun(createBattle(fightSpec({ foes, objects }), [hero('milo')], noNoise, ctx), ctx);
  landHit(run, { userId: 'milo', targetId: 'f0', amount: 5, kind: 'light', degree: 'hit', reactions: false });
  const burnt = run.events.filter((e) => e.t === 'damage' && e.kind === 'plain').map((e) => e.target);
  assert.deepEqual(burnt.sort(), ['f0', 'f2'], 'the two within 1; the beetle 2 away takes nothing');
});

test('lingering damage lands for 3 turns: it ticks at three round starts, then ends', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2, integrity: 60, maxIntegrity: 60 })] }), [hero('milo')], noNoise, ctx);
  const run = makeRun(b, ctx);
  assert.ok(addCondition(run, run.b.units.find((u) => u.id === 'f0'), 'lingering', 2, { data: { kind: 'ink' } }));
  assert.equal(run.b.units.find((u) => u.id === 'f0').conditions[0].data.turns, 3);
  let x = run.b;
  const ticks = [];
  for (let i = 0; i < 5; i += 1) {
    const r = round(x, ctx, { milo: [] });
    ticks.push(r.events.filter((e) => e.t === 'damage' && e.target === 'f0' && e.kind === 'ink').length);
    x = r.battle;
  }
  assert.deepEqual(ticks, [1, 1, 1, 0, 0]);
});

test('Storybook’s ×0.75 scales only the foes’ damage, never the party’s', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, integrity: 60, maxIntegrity: 60 })] }), [hero('milo')], { ...noNoise, mode: 'storybook' }, ctx);
  const run = makeRun(b, ctx);
  assert.equal(landHit(run, { userId: 'milo', targetId: 'f0', amount: 8, kind: 'plain', degree: 'hit', reactions: false }).amount, 8, 'Milo’s 8 lands whole');
  assert.equal(landHit(run, { userId: 'f0', targetId: 'milo', amount: 8, kind: 'plain', degree: 'hit', reactions: false }).amount, 6, 'the beetle’s 8 lands as 6');
});

test('a shy stray settles at half its Integrity, and not a point sooner', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, temperament: 'shy', integrity: 20, maxIntegrity: 20 })] }), [hero('milo')], noNoise, ctx);
  const run = makeRun(b, ctx);
  landHit(run, { userId: 'milo', targetId: 'f0', amount: 9, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(run.b.units.find((u) => u.id === 'f0').sorted, null, '11 of 20: still here');
  landHit(run, { userId: 'milo', targetId: 'f0', amount: 1, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(run.b.units.find((u) => u.id === 'f0').sorted, 'settled', '10 of 20: settled');
});

test('a Reboot brings anyone back with at least 1 Integrity, however small their quarter', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo'), hero('claude', { maxIntegrity: 3, integrity: 0 })], noNoise, ctx);
  const run = makeRun(b, ctx);
  const claude = run.b.units.find((u) => u.id === 'claude');
  assert.ok(claude.offline && rebootUnit(run, 'milo', claude, 0.25));
  assert.equal(claude.integrity, 1);
});

test('allies drift 20 toward idle only inside the raised lantern; at radius 3 it’s the usual 10', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 12, y: 2, genre: 'gothic' })] }), [hero('milo'), hero('claude')], noNoise, ctx);
  for (const [radius, heat] of [[5, 60], [3, 70]]) {
    const hot = { ...patchUnit(b, 'claude', { heat: 80 }), lights: b.lights.map((l) => (l.id === 'hooklight' ? { ...l, radius } : l)) };
    const r = round(hot, ctx, { milo: [], claude: [] });
    assert.equal(findUnit(r.battle, 'claude').heat, heat, `radius ${radius}`);
  }
});

// ---------- reactions and the §6.5 rules ----------

test('Proofread reaches an outcome only within its range (12)', () => {
  const ctx = quiet();
  const heroes = [hero('milo'), hero('claude', { reactions: { shoulder: 'always', proofread: 'always' } })];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, integrity: 60, maxIntegrity: 60 })] }), heroes, noNoise, ctx);
  for (const [x, moved] of [[12, true], [14, false]]) {
    const run = makeRun(place(b, 'claude', x, 4), ctx);
    const degree = pickOutcome(run, 'milo', 'f0', { bars: [0, 0, 100, 0] });
    assert.equal(degree, moved ? 'hit' : 'graze', `the Scribe at ${x}, 4`);
    assert.equal(run.events.some((e) => e.t === 'outcome' && e.by === 'claude'), moved);
  }
});

test('the Tollkeeper’s toll meets the mover’s body Resolve', () => {
  const walk = [{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }];
  const ctx = withAbilities([passive('toll', ['tollkeeper-toll'])], { foePlan: (bb, id) => plan(id, bb.round === 1 ? [A.stride(walk)] : [], { by: 'foe' }) });
  const toll = hero('codex', { id: 'toll', kind: 'tollkeeper', name: 'The Tollkeeper', abilityIds: ['toll'], reactions: { 'parting-swipe': 'never' } });
  const b = place(createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2, archetype: 'construct' })] }), [toll], noNoise, ctx), 'toll', 6, 3);
  const expect = oddsAgainst(place(b, 'f0', 7, 2), ctx, 'toll', 'f0', { harmful: true, meets: 'body' });
  assert.equal(expect.parts.find((p) => p.why === 'body Resolve 2')?.n, -2, 'a construct’s body Resolve 2');
  const r = round(b, ctx, { toll: [A.brace()] });
  const pick = r.events.find((e) => e.t === 'outcome' && e.unit === 'toll' && e.target === 'f0');
  assert.deepEqual(pick.bars, expect.bars);
});

test('Examine and Talk down need line of sight', () => {
  const rows = ['################', '#...#..........#', '#...#..........#', '#...#..........#', '#...#..........#', '################'];
  const ctx = quiet();
  const b = createBattle(fightSpec({ arenaRows: rows, foes: [stray('f0', { x: 8, y: 2 })] }), [hero('milo')], noNoise, ctx);
  const options = legalActions(b, 'milo', ctx);
  assert.deepEqual(options.find((o) => o.action.id === 'examine').targets, []);
  assert.deepEqual(options.find((o) => o.action.id === 'talk-down').targets, []);
  const looked = round(b, ctx, { milo: [A.examine('f0')] });
  assert.ok(!looked.events.some((e) => e.t === 'reveal'), 'nothing examined through the wall');
  assert.ok(looked.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'target-gone'), 'Milo Braces instead');
  const talked = round(b, ctx, { milo: [A.talk('f0')] });
  assert.ok(!talked.events.some((e) => e.t === 'calm'), 'no calm through the wall');
});

test('Wit 3+ reaches 1 further only with 2- and 3-action spells', () => {
  const ctx = quiet();
  const b = place(createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2, integrity: 60, maxIntegrity: 60 })] }), [hero('claude', { abilityIds: [...hero('claude').abilityIds, 'mote'] })], noNoise, ctx), 'claude', 1, 2);
  const options = legalActions(b, 'claude', ctx);
  assert.ok(options.find((o) => o.action.ability === 'inkdarts').targets.some((t) => t.unit === 'f0'), 'Inkdarts (a 2-action spell, 8 + 1) reaches 9');
  assert.ok(!options.find((o) => o.action.ability === 'mote').targets.some((t) => t.unit === 'f0'), 'Mote (a 1-action knack, 8) doesn’t');
  const mote = round(b, ctx, { claude: [A.use('mote', { unit: 'f0' })] });
  assert.ok(!mote.events.some((e) => e.t === 'outcome' && e.unit === 'claude'), 'so in play it never picks');
  const darts = round(b, ctx, { claude: [A.use('inkdarts', { unit: 'f0' }, { cost: 2 })] });
  assert.ok(darts.events.some((e) => e.t === 'outcome' && e.unit === 'claude' && e.target === 'f0'));
});

test('Cleave: a second foe beside the first takes half the Strike, at the same degree', () => {
  const cleave = ab({ id: 'cleave', kind: 'art', target: { who: 'foe', range: 1 }, effects: [{ do: 'act', action: 'strike' }, { do: 'rule', id: 'cleave' }] });
  const ctx = withAbilities([cleave]);
  const axe = hero('codex', { abilityIds: ['cleave'], strike: { amount: 8, kind: 'plain', reach: 1, range: 0, weapon: 'standard' } });
  const foes = [stray('f0', { x: 3, y: 2, integrity: 80, maxIntegrity: 80 }), stray('f1', { x: 3, y: 3, talkKind: 'k1', integrity: 80, maxIntegrity: 80 })];
  const seen = new Set();
  for (let seed = 1; seed <= 200 && seen.size < 2; seed += 1) {
    const b = place(createBattle(fightSpec({ seed, foes }), [axe], noNoise, ctx), 'codex', 2, 2);
    const r = round(b, ctx, { codex: [A.use('cleave', { unit: 'f0' })] });
    const main = r.events.find((e) => e.t === 'damage' && e.target === 'f0');
    const side = r.events.find((e) => e.t === 'damage' && e.target === 'f1');
    if (!main) continue;
    assert.equal(side.degree, main.degree);
    assert.equal(side.amount, { crit: 8, hit: 4, graze: 2 }[main.degree], `seed ${seed}: half of the ${main.amount}`);
    seen.add(main.degree);
  }
  assert.deepEqual([...seen].sort(), ['graze', 'hit'], 'a Hit halves 8 to 4, a Graze 4 to 2 (a Guard 1 beetle is never Critted here)');
});

test('Steady hands: a thrown cordial patches a third of max Integrity, not a quarter', () => {
  const ctx = withAbilities([passive('steady-h', ['steady-hands'])]);
  for (const [ids, amount] of [[['steady-h'], 5], [[], 4]]) {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo', { abilityIds: [...hero('milo').abilityIds, ...ids] }), hero('claude', { integrity: 2 })], noNoise, ctx);
    const r = round(b, ctx, { milo: [A.throw('claude', { ability: 'cordial' })] });
    assert.equal(r.events.find((e) => e.t === 'patch' && e.target === 'claude').amount, amount, `the Scribe’s 16: ${amount}`);
  }
});

test('Still water settles strays 4 or more levels below the party, not 3', () => {
  const water = ab({ id: 'still-water', costs: [2], meets: 'mind', target: { who: 'self', area: { shape: 'burst', size: 4, at: 'self' }, hits: 'foes' }, effects: [{ do: 'rule', id: 'settle-low' }] });
  const ctx = withAbilities([water]);
  for (const [level, settled] of [[1, 'settled'], [2, null]]) {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1, level, integrity: 40, maxIntegrity: 40 })] }), [hero('claude', { abilityIds: ['still-water'] })], { ...noNoise, roadLevel: 5 }, ctx);
    const r = round(b, ctx, { claude: [A.use('still-water', null, { cost: 2 })] });
    assert.equal(findUnit(r.battle, 'f0').sorted, settled, `a level-${level} stray at Road level 5`);
  }
});

test('first in every tick: a unit borrowing Frontier’s rule leads each tick from the back of the ribbon', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo'), hero('claude'), hero('codex')], noNoise, ctx);
  const last = b.order.filter((id) => ['milo', 'claude', 'codex'].includes(id)).at(-1);
  const borrowed = patchUnit(b, last, { mods: [{ stat: 'first-in-tick', by: 1, until: 'end-of-next-round', source: 'borrow-a-rule' }] });
  const plans = ['milo', 'claude', 'codex'].map((id) => ({ t: 'plan', unitId: id, plan: plan(id, [A.brace(), A.brace(), A.brace()]) }));
  const s = schedule(play(borrowed, plans, ctx).battle, ctx);
  for (let t = 1; t <= 3; t += 1) assert.equal(s.find((e) => e.tick === t).unitId, last, `tick ${t}`);
  assert.notEqual(schedule(play(b, plans, ctx).battle, ctx).find((e) => e.tick === 1).unitId, last, 'without it, the ribbon leads');
});

test('a surprised foe makes no Parting swipe; once awake it does', () => {
  const ctx = quiet();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1 })] }), [hero('milo')], { ...noNoise, sneak: 'unseen' }, ctx);
  const foe = findUnit(b, 'f0');
  assert.ok(foe.mods.some((m) => m.stat === 'surprised'));
  assert.equal(canSwipe(foe), false);
  assert.equal(canSwipe({ ...foe, mods: [] }), true);
  const away = [A.stride([{ x: 1, y: 2 }, { x: 1, y: 3 }])];
  const swipes = (x) => round(x, ctx, { milo: away }).events.filter((e) => e.t === 'reaction' && e.id === 'parting-swipe').length;
  assert.equal(swipes(b), 0, 'surprised: none');
  assert.equal(swipes(patchUnit(b, 'f0', { mods: [] })), 1, 'awake: one');
});

// ---------- §4.16's hash inputs ----------

test('Void’s pair is drawn per tick: hashInts(seed, attempt, round, tick, ‘noise:void-pair’)', () => {
  const ctx = quiet();
  let swapped = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const b0 = createBattle(fightSpec({ seed, genres: ['void'], foes: [stray('f0', { x: 12, y: 2, genre: 'void' })] }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
    const b = play(b0, ['milo', 'claude', 'codex'].map((id) => ({ t: 'plan', unitId: id, plan: plan(id, [A.brace(), A.brace(), A.brace()]) })), ctx).battle;
    const base = schedule({ ...b, calm: { noise: false, adaptation: true } }, ctx);
    const got = schedule(b, ctx);
    for (let t = 1; t <= 3; t += 1) {
      const list = base.filter((e) => e.tick === t).map((e) => e.unitId);
      const h = hashInts(b.seed, b.attempt, b.round, t, 'noise:void-pair');
      if (unit(h) < rate('void')) {
        const i = hashInts(h, 'pair') % (list.length - 1);
        [list[i], list[i + 1]] = [list[i + 1], list[i]];
        swapped += 1;
      }
      assert.deepEqual(got.filter((e) => e.tick === t).map((e) => e.unitId), list, `seed ${seed}, tick ${t}`);
    }
  }
  assert.ok(swapped > 10);
});

test('the hum repeats the stray action drawn by hashInts(seed, attempt, round, ‘noise:hum’), a new one each round', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace()], { by: 'foe' }) });
  const foes = [stray('f0', { x: 12, y: 1, genre: 'backhalls' }), stray('f1', { x: 12, y: 3, genre: 'backhalls', talkKind: 'k1' }), stray('f2', { x: 13, y: 2, genre: 'backhalls', talkKind: 'k2' })];
  const b = createBattle(fightSpec({ seed: 99, genres: ['backhalls'], foes }), [hero('milo')], {}, ctx);
  const picked = new Set();
  for (let r = 1; r <= 10; r += 1) {
    const s = schedule({ ...b, round: r }, ctx);
    const hum = s.at(-1);
    const stray = s.slice(0, -1).filter((e) => e.unitId.startsWith('f'));
    const want = stray[hashInts(b.seed, b.attempt, r, 'noise:hum') % stray.length];
    assert.deepEqual([hum.unitId, hum.slot, hum.late], [want.unitId, want.slot, true], `round ${r}`);
    picked.add(`${hum.unitId}:${hum.slot}`);
  }
  assert.ok(picked.size > 2, 'the draw moves with the round');
});

test('Nodding off sleeps through exactly the actions hashInts(seed, attempt, round, tick, i, slot, ‘noise:nocturne’) says', () => {
  const ctx = quiet();
  let slept = 0;
  let checked = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const b0 = createBattle(fightSpec({ seed, genres: ['nocturne'], foes: [stray('f0', { x: 12, y: 2, genre: 'nocturne' })] }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
    let b = play(b0, [...['milo', 'claude', 'codex'].map((id) => ({ t: 'plan', unitId: id, plan: plan(id, [A.brace(), A.brace(), A.brace()]) })), { t: 'commit' }], ctx).battle;
    while (b.status === 'running') {
      const e = b.schedule[b.cursor];
      const want = unit(hashInts(b.seed, b.attempt, b.round, e.tick, b.order.indexOf(e.unitId), e.slot, 'noise:nocturne')) < rate('nocturne');
      const r = apply(b, { t: 'step' }, ctx);
      assert.equal(r.events.some((x) => x.t === 'noise' && x.what === 'slept' && x.unit === e.unitId), want, `seed ${seed}: ${e.unitId} slot ${e.slot}`);
      slept += want ? 1 : 0;
      checked += 1;
      b = r.battle;
    }
  }
  assert.ok(checked > 200 && slept > 20, `${slept} of ${checked}`);
});

test('the sneak lands from hashInts(fight.seed, ‘sneak’), seed by seed', () => {
  const tiles = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
  let unseen = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const fight = fightSpec({ seed, foes: [stray('f0', { x: 12, y: 1 })] });
    const r = sneakCheck(fight, tiles, { lightAt: () => 'd', rules });
    const want = ['crit', 'hit'].includes(degreeAt(unit(hashInts(seed, 'sneak')) * 100, r.odds.bars));
    assert.equal(r.unseen, want, `seed ${seed}`);
    unseen += want ? 1 : 0;
  }
  assert.ok(unseen > 50 && unseen < 200);
});

test('a Critical’s bark is chosen by hashInts(seed, attempt, round, ‘bark’), a new one each round', () => {
  const barks = [{ on: 'critical', say: 'One.' }, { on: 'critical', say: 'Two.' }, { on: 'critical', say: 'Three.' }];
  const ctx = quiet({ party: { milo: { personality: 'careful', barks, voice: 'words' } } });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, integrity: 90, maxIntegrity: 90 })] }), [hero('milo')], noNoise, ctx);
  const said = new Set();
  for (let r = 1; r <= 12; r += 1) {
    const run = makeRun({ ...b, round: r }, ctx);
    assert.equal(pickOutcome(run, 'milo', 'f0', { bars: [100, 0, 0, 0] }), 'crit');
    const bark = run.events.find((e) => e.t === 'bark');
    assert.equal(bark.text, barks[hashInts(b.seed, b.attempt, r, 'bark') % 3].say, `round ${r}`);
    said.add(bark.text);
  }
  assert.equal(said.size, 3);
});
