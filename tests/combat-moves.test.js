// Lines, moves and reactions that meet them (module B: src/combat/grid.js, effects.js, round.js,
// battle.js; CONTRACT-PHASE4.md §4.3, §4.4, §4.17, §6.5, §7.1): a Strike needs a clear line, Step and
// Jump respect walls, corners and height, forced moves stop at corners, one rule says who can
// Parting-swipe (the grid lists exactly the swipes that fire), Draw the blow never cancels an attack,
// Shoulder never makes a hit worse, Wayward is in speedOf, and readied Throws and Shoves are reactions.
//   node --test tests/combat-moves.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, canSwipe } from '../src/combat/grid.js';
import { makeRun, landHit, applyUse } from '../src/combat/effects.js';
import { forcedMove, speedOf } from '../src/combat/round.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { legalActions, oddsFor } from '../src/combat/battle.js';
import { rules, hero, stray, fightSpec, makeCtx, createBattle, A, plan, play, playRound, findUnit, ab, ABILITIES } from './combat-kit.js';

const noNoise = { calm: { noise: false, adaptation: true } };
const still = (id) => plan(id, [], { by: 'foe' });
const place = (b, id, x, y, patch = {}) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, x, y, ...patch } : u)) });
function round(b, ctx, plans) {
  const c = play(b, [...Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) })), { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { battle: r.battle, events: [...c.events, ...r.events] };
}
const at = (b, id) => [findUnit(b, id).x, findUnit(b, id).y];

// ---------- a Strike needs a clear line ----------

const WALLED = ['##########', '#...#....#', '#...#....#', '#...#....#', '##########'];

test('a floater behind a solid wall never hits: no odds row, no Strike target, and its Strikes never pick', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.strike('milo'), A.strike('milo'), A.strike('milo')], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { archetype: 'floater', x: 6, y: 2 })], arenaRows: WALLED, arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  const g = createGrid(b, rules);
  assert.equal(g.sees(findUnit(b, 'f0'), findUnit(b, 'milo')), false);
  assert.equal(g.cover('f0', 'milo'), null, 'high cover blocks the line');
  assert.deepEqual(oddsFor(b, 'f0', A.strike('milo'), ctx, { plan: b.plans.f0 }), [], 'no row through a blocked line');
  assert.deepEqual(legalActions(b, 'f0', ctx).find((o) => o.action.id === 'strike').targets, [], 'Milo isn’t a Strike target');
  const r = round(b, ctx, { milo: [A.brace()] });
  assert.equal(r.events.filter((e) => e.t === 'outcome' && e.unit === 'f0').length, 0, 'never picks');
  assert.equal(r.events.filter((e) => e.t === 'damage' && e.target === 'milo').length, 0);
  assert.equal(r.events.filter((e) => e.t === 'lost' && e.unit === 'f0').length, 3, 'each Strike improvises (the stub minds have nothing) and is lost');
  // The same floater with the wall gone: a row, and it picks.
  const open = createBattle(fightSpec({ foes: [stray('f0', { archetype: 'floater', x: 6, y: 2 })], arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  assert.equal(oddsFor(open, 'f0', A.strike('milo'), ctx, { plan: open.plans.f0 }).length, 1);
  assert.ok(round(open, ctx, { milo: [A.brace()] }).events.some((e) => e.t === 'outcome' && e.unit === 'f0'));
});

test('a drone’s zap needs its own clear line to the target', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const rows = ['##########', '#........#', '#........#', '#..#.....#', '##########'];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 3, integrity: 80, maxIntegrity: 80 })], arenaRows: rows, arenaOpts: { entry: [{ x: 2, y: 1 }] } }), [hero('codex')], noNoise, ctx);
  const drone = b.units.find((u) => u.kind === 'drone');
  const g = createGrid(b, rules);
  assert.equal(g.sees({ x: 2, y: 1 }, { x: 6, y: 3 }), true, 'the Artificer sees the stray');
  const hidden = place(b, drone.id, 2, 3);
  assert.equal(createGrid(hidden, rules).sees({ x: 2, y: 3 }, { x: 6, y: 3 }), false, 'the drone, behind the wall, doesn’t');
  const zap = ctx.abilities.get('drone-zap');
  assert.ok(!applyUse(hidden, 'codex', zap, { target: { unit: 'f0' } }, ctx).events.some((e) => e.t === 'outcome' && e.unit === drone.id));
  assert.ok(applyUse(place(b, drone.id, 2, 2), 'codex', zap, { target: { unit: 'f0' } }, ctx).events.some((e) => e.t === 'outcome' && e.unit === drone.id), 'in sight, it zaps');
});

test('a Strike whose target has moved out of sight improvises (Milo Braces, why blocked)', () => {
  const rows = ['##########', '#........#', '#........#', '#...#....#', '##########'];
  const walk = makeCtx({ foePlan: (bb, id) => plan(id, bb.round === 1 ? [A.stride([{ x: 5, y: 2 }, { x: 6, y: 3 }])] : [], { by: 'foe' }) });
  const archer = hero('milo', { strike: { amount: 5, kind: 'plain', reach: 1, range: 12, weapon: 'ranged' } });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 1 })], arenaRows: rows, arenaOpts: { entry: [{ x: 2, y: 3 }] } }), [archer], noNoise, walk);
  const g = createGrid(b, rules);
  assert.equal(g.sees({ x: 2, y: 3 }, { x: 5, y: 1 }), true, 'in sight when planned');
  assert.equal(g.sees({ x: 2, y: 3 }, { x: 6, y: 3 }), false, 'behind the wall once it has moved');
  const r = round(b, walk, { milo: [A.delay(), A.strike('f0')] });
  assert.deepEqual(at(r.battle, 'f0'), [6, 3]);
  const imp = r.events.find((e) => e.t === 'improvise' && e.unit === 'milo');
  assert.ok(imp, 'the Strike improvises');
  assert.equal(imp.why, 'blocked');
  assert.equal(imp.to.id, 'brace');
  assert.ok(!r.events.some((e) => e.t === 'outcome' && e.unit === 'milo' && e.target === 'f0'));
});

test('melee Strikes and Shoves don’t reach diagonally between two blocking corners', () => {
  const rows = ['######', '#.#..#', '#..#.#', '#....#', '######'];
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.strike('milo'), A.shove('milo')], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1 })], arenaRows: rows, arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  assert.equal(createGrid(b, rules).sees(findUnit(b, 'milo'), findUnit(b, 'f0')), false, 'walls at (3, 2) and (2, 1)');
  const opts = legalActions(b, 'milo', ctx);
  assert.equal(opts.find((o) => o.action.id === 'strike').why, 'Nothing in reach');
  assert.deepEqual(oddsFor(b, 'milo', A.shove('f0'), ctx, { plan: plan('milo', [A.shove('f0')]) }), [], 'no Shove row across the corners');
  // Approaching it, the grid ends where a Strike can see it: round to (4, 1) or (4, 2), never the corner tile (2, 2).
  const far = place(b, 'milo', 1, 3);
  const path = createGrid(far, rules).approach('milo', 'f0');
  const end = path[path.length - 1];
  assert.notDeepEqual(end, { x: 2, y: 2 });
  assert.equal(createGrid(far, rules).sees(end, findUnit(far, 'f0')), true, `ends at (${end.x}, ${end.y}), in sight`);
  assert.deepEqual(opts.find((o) => o.action.id === 'shove' && !o.action.choice).targets, []);
  const r = round(b, ctx, { milo: [A.strike('f0')] });
  assert.ok(!r.events.some((e) => e.t === 'outcome' && e.target !== 'milo' && e.unit === 'milo'), 'Milo’s Strike never picks');
  assert.ok(r.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'blocked'));
  assert.ok(!r.events.some((e) => e.t === 'outcome' && e.unit === 'f0'), 'nor do the beetle’s Strike and Shove');
});

// ---------- Step, Jump and forced moves ----------

test('a Step is a one-tile walk: never between two blocking corners, never up two height steps', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const corners = createBattle(fightSpec({ foes: [stray('f0', { x: 4, y: 3 })], arenaRows: ['######', '#.#..#', '#..#.#', '#....#', '######'], arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  const squeeze = round(corners, ctx, { milo: [A.step({ x: 3, y: 1 })] });
  assert.deepEqual(at(squeeze.battle, 'milo'), [2, 2], 'no squeeze between the corners');
  assert.ok(squeeze.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'blocked'));
  const heights = ['000000', '000000', '002100', '000000'];
  const ledge = createBattle(fightSpec({ foes: [stray('f0', { x: 4, y: 1 })], arenaRows: ['######', '#....#', '#....#', '######'], arenaOpts: { heights, entry: [{ x: 1, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  assert.deepEqual(at(round(ledge, ctx, { milo: [A.step({ x: 2, y: 2 })] }).battle, 'milo'), [1, 2], 'not up two steps');
  const low = place(ledge, 'milo', 4, 2);
  assert.deepEqual(at(round(low, ctx, { milo: [A.step({ x: 3, y: 2 })] }).battle, 'milo'), [3, 2], 'one step up is fine');
  assert.deepEqual(at(round(ledge, ctx, { milo: [A.step({ x: 3, y: 2 })] }).battle, 'milo'), [1, 2], 'nor two tiles at once');
});

test('a Jump needs a clear line and at most one height step up; it clears deep water, low props and creatures', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const rows = ['##########', '#...#....#', '#.~.o....#', '#........#', '##########'];
  const heights = ['0000000000', '0000000000', '0000000000', '0000001200', '0000000000'];
  const make = (x, y) => createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 1 }), stray('f1', { x: 2, y: 3, talkKind: 'k1' })], arenaRows: rows, arenaOpts: { heights, entry: [{ x, y }] } }), [hero('codex', { abilityIds: [] })], noNoise, ctx);
  const jump = (b, tile) => at(round(b, ctx, { codex: [A.jump(tile)] }).battle, 'codex');
  assert.deepEqual(jump(make(3, 1), { x: 5, y: 1 }), [3, 1], 'not through the wall at (4, 1)');
  assert.deepEqual(jump(make(1, 2), { x: 3, y: 2 }), [3, 2], 'over deep water');
  assert.deepEqual(jump(make(3, 2), { x: 5, y: 2 }), [5, 2], 'over a low prop');
  assert.deepEqual(jump(make(1, 3), { x: 3, y: 3 }), [3, 3], 'over a creature');
  assert.deepEqual(jump(make(5, 3), { x: 7, y: 3 }), [5, 3], 'not up two height steps');
  assert.deepEqual(jump(make(5, 3), { x: 6, y: 3 }), [6, 3], 'up one height step');
  const g = createGrid(make(3, 1), rules);
  assert.equal(g.canJump('codex', { x: 5, y: 1 }, 2), false);
  assert.equal(g.canJump('codex', { x: 2, y: 2 }, 2), false, 'nor onto deep water');
});

test('a push or pull stops rather than squeeze a unit between two blocking corners', () => {
  const rows = ['######', '#....#', '#...##', '#..#.#', '######'];
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })], arenaRows: rows, arenaOpts: { entry: [{ x: 2, y: 1 }] } }), [hero('codex')], noNoise, ctx);
  const run = makeRun(b, ctx);
  forcedMove(run, 'codex', 'f0', 'push', 2);
  assert.deepEqual([run.b.units.find((u) => u.id === 'f0').x, run.b.units.find((u) => u.id === 'f0').y], [3, 2], 'walls at (4, 2) and (3, 3): it stays');
  const open = makeRun(place(b, 'f0', 2, 2, {}), ctx);
  forcedMove(open, 'codex', 'f0', 'push', 1);
  assert.deepEqual([open.b.units.find((u) => u.id === 'f0').x, open.b.units.find((u) => u.id === 'f0').y], [2, 3], 'a straight push still goes');
});

// ---------- Parting swipes: one rule ----------

test('who can Parting-swipe is one rule: the grid’s swipe lists are exactly the swipes that fire', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const foes = [
    stray('f0', { x: 3, y: 2 }),
    stray('f1', { archetype: 'floater', x: 3, y: 3, talkKind: 'k1' }),
    stray('f2', { x: 5, y: 1, talkKind: 'k2' }),
    stray('f3', { x: 6, y: 3, talkKind: 'k3' }),
    stray('f4', { x: 8, y: 2, talkKind: 'k4' }),
  ];
  const b0 = createBattle(fightSpec({ foes }, ), [hero('milo', { maxIntegrity: 999, integrity: 999 })], noNoise, ctx);
  // f2 is Sparked, f3 asleep: neither can react.
  const b = {
    ...b0,
    units: b0.units.map((u) => (u.id === 'f2' ? { ...u, conditions: [{ id: 'sparked', n: 2, source: null, data: null }] } : u.id === 'f3' ? { ...u, conditions: [{ id: 'drowsy', n: 2, source: null, data: null }] } : u)),
  };
  assert.equal(canSwipe(findUnit(b, 'f1')), false, 'a ranged-only floater never swipes');
  assert.equal(canSwipe(findUnit(b, 'f2')), false, 'nor a Sparked stray');
  assert.equal(canSwipe(findUnit(b, 'f3')), false, 'nor a Drowsy one');
  assert.equal(canSwipe(findUnit(b, 'f0')), true);
  const paths = [
    [2, 2, [{ x: 2, y: 3 }, { x: 2, y: 4 }]],
    [4, 2, [{ x: 4, y: 3 }, { x: 5, y: 4 }]],
    [4, 2, [{ x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 1 }]],
    [2, 3, [{ x: 2, y: 4 }, { x: 3, y: 4 }]],
    [7, 2, [{ x: 7, y: 1 }, { x: 8, y: 1 }, { x: 9, y: 1 }]],
    [9, 2, [{ x: 10, y: 2 }, { x: 11, y: 2 }]],
  ];
  let fired = 0;
  for (const [x, y, path] of paths) {
    const start = place(b, 'milo', x, y);
    const listed = createGrid(start, rules).walk('milo', path).swipes;
    const r = round(start, ctx, { milo: [A.stride(path)] });
    const swiped = r.events.filter((e) => e.t === 'reaction' && e.id === 'parting-swipe').map((e) => e.unit);
    assert.deepEqual(swiped, listed, `from (${x}, ${y})`);
    fired += swiped.length;
    assert.ok(!swiped.includes('f1') && !swiped.includes('f2') && !swiped.includes('f3'));
  }
  assert.ok(fired >= 3, `some swipes fired (${fired})`);
  // A stray that can't see the mover (across two blocking corners) can't swipe it either.
  const corner = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1 })], arenaRows: ['######', '#.#..#', '#..#.#', '#....#', '######'], arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  assert.deepEqual(createGrid(corner, rules).walk('milo', [{ x: 2, y: 3 }]).swipes, []);
  assert.ok(!round(corner, ctx, { milo: [A.stride([{ x: 2, y: 3 }])] }).events.some((e) => e.t === 'reaction'), 'no swipe across the corners');
  // reachable agrees: moving past the floater alone lists nothing.
  const floater = createBattle(fightSpec({ foes: [stray('f0', { archetype: 'floater', x: 3, y: 1 })], arenaOpts: { entry: [{ x: 2, y: 1 }] } }), [hero('milo')], noNoise, ctx);
  assert.deepEqual(createGrid(floater, rules).reachable('milo', { budget: 4 }).get('2,4').swipes, []);
});

// ---------- Draw the blow and Shoulder ----------

const DRAW = ab({ id: 'draw-the-blow', kind: 'reaction', costs: [], reaction: { when: 'strike-at-ally', range: 2 }, target: { who: 'ally', range: 2 }, effects: [{ do: 'rule', id: 'draw-the-blow' }] });

test('Draw the blow fires only when the warden can be struck after its Step; otherwise the attack goes ahead', () => {
  const index = buildAbilityIndex({ callings: { abilities: [...ABILITIES, DRAW] } });
  const rows = ['##########', '#........#', '##########'];
  const bite = makeCtx({ abilityIndex: index, foePlan: (bb, id) => plan(id, [A.strike('milo'), A.strike('milo')], { by: 'foe' }) });
  const heroes = [hero('milo'), hero('codex', { abilityIds: ['draw-the-blow'], reactions: { 'draw-the-blow': 'always' } })];
  // A corridor: no tile beside Milo that the beetle can reach, so the warden can't draw it.
  const corridor = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1 })], arenaRows: rows, arenaOpts: { entry: [{ x: 4, y: 1 }, { x: 6, y: 1 }] } }), heroes, noNoise, bite);
  const c = round(corridor, bite, { milo: [A.brace()], codex: [A.brace()] });
  assert.ok(!c.events.some((e) => e.t === 'reaction' && e.id === 'draw-the-blow'), 'it doesn’t fire');
  assert.equal(c.events.filter((e) => e.t === 'outcome' && e.unit === 'f0' && e.target === 'milo').length, 2, 'both Strikes go ahead');
  assert.equal(findUnit(c.battle, 'codex').reactionUsed, false, 'its reaction is kept');
  // Open ground: it Steps in beside Milo and the beetle, and takes the blow.
  const open = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })], arenaOpts: { entry: [{ x: 2, y: 2 }, { x: 2, y: 4 }] } }), heroes, noNoise, bite);
  const o = round(open, bite, { milo: [A.brace()], codex: [A.brace()] });
  assert.ok(o.events.some((e) => e.t === 'reaction' && e.id === 'draw-the-blow'));
  const moved = o.events.find((e) => e.t === 'move' && e.unit === 'codex');
  assert.deepEqual([moved.how, moved.path], ['step', [{ x: 2, y: 3 }]], 'one Step in, beside Milo and the beetle');
  assert.equal(o.events.find((e) => e.t === 'outcome' && e.unit === 'f0').target, 'codex');
  // A ranged attacker: the warden where it stands is already a target, so it doesn't move.
  const shoot = makeCtx({ abilityIndex: index, foePlan: (bb, id) => plan(id, [A.strike('milo')], { by: 'foe' }) });
  const range = createBattle(fightSpec({ foes: [stray('f0', { archetype: 'floater', x: 9, y: 2 })], arenaOpts: { entry: [{ x: 2, y: 2 }, { x: 3, y: 4 }] } }), heroes, noNoise, shoot);
  const s = round(range, shoot, { milo: [A.brace()], codex: [A.brace()] });
  assert.equal(s.events.find((e) => e.t === 'outcome' && e.unit === 'f0').target, 'codex');
  assert.ok(!s.events.some((e) => e.t === 'move' && e.unit === 'codex'));
});

test('Shoulder lends only a bigger pool than the struck ally’s own, so it never makes a hit worse', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 80, maxIntegrity: 80 })] }), [hero('milo'), hero('claude', { reactions: { shoulder: 'always' } })], noNoise, ctx);
  const set = (bb, id, patch) => ({ ...bb, units: bb.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  const smaller = makeRun(set(set(b, 'milo', { x: 2, y: 2, buffer: 4 }), 'claude', { x: 2, y: 3, buffer: 1 }), ctx);
  landHit(smaller, { userId: 'f0', targetId: 'milo', amount: 6, kind: 'plain', degree: 'hit' });
  assert.ok(!smaller.events.some((e) => e.t === 'reaction' && e.id === 'shoulder'), 'her 1 is less than his 4');
  assert.equal(smaller.b.units.find((u) => u.id === 'milo').integrity, 16, 'his own Buffer takes 4 of the 6');
  const bigger = makeRun(set(set(b, 'milo', { x: 2, y: 2, buffer: 4 }), 'claude', { x: 2, y: 3, buffer: 5 }), ctx);
  landHit(bigger, { userId: 'f0', targetId: 'milo', amount: 6, kind: 'plain', degree: 'hit' });
  assert.ok(bigger.events.some((e) => e.t === 'reaction' && e.id === 'shoulder'));
  assert.equal(bigger.b.units.find((u) => u.id === 'milo').integrity, 17, 'her 5 takes 5 of the 6');
  assert.equal(bigger.b.units.find((u) => u.id === 'milo').buffer, 4, 'his own pool untouched');
});

// ---------- Wayward and readied reactions ----------

test('Wayward’s one more tile is in speedOf for a Stride, so the planner and minds budget it', () => {
  const way = ab({ id: 'wayward', kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: ['wayward-path'], summons: [] } });
  const ctx = makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, way] } }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 13, y: 4 })] }), [hero('milo', { abilityIds: ['wayward', 'hooklight'] })], noNoise, ctx);
  const milo = findUnit(b, 'milo');
  assert.equal(speedOf(b, milo, ctx, { stride: true }), 5);
  assert.equal(speedOf(b, milo, ctx), 4, 'Speed itself (initiative) is unchanged');
  const plain = createBattle(fightSpec({ foes: [stray('f0', { x: 13, y: 4 })] }), [hero('milo')], noNoise, ctx);
  assert.equal(speedOf(plain, findUnit(plain, 'milo'), ctx, { stride: true }), 4);
  const far = round(b, ctx, { milo: [A.stride([{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }])] });
  assert.deepEqual(at(far.battle, 'milo'), [6, 1]);
});

test('a readied Throw or Shove is a reaction: no heat, no attack counted, no penalty', () => {
  const walkIn = makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.stride([{ x: 4, y: 2 }, { x: 3, y: 2 }]), A.brace()], { by: 'foe' }) });
  for (const act of [A.throw('f0'), A.shove('f0')]) {
    const b0 = createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 2, integrity: 90, maxIntegrity: 90 })] }), [hero('codex')], { ...noNoise, warding: 10 }, walkIn);
    // The Artificer's Ready resolves first in tick 2, then the beetle walks in.
    const x = { ...place(b0, 'codex', 2, 2), order: ['codex', 'f0'] };
    let b = play(x, [{ t: 'plan', unitId: 'codex', plan: plan('codex', [A.ready('foe-enters-reach'), act]) }, { t: 'commit' }], walkIn).battle;
    let fired = null;
    while (b.status === 'running' && !fired) {
      const r = play(b, [{ t: 'step' }], walkIn);
      b = r.battle;
      if (r.events.some((e) => e.t === 'reaction' && e.unit === 'codex' && e.id === 'ready')) fired = r;
    }
    assert.ok(fired, `the readied ${act.id} fired`);
    const pick = fired.events.find((e) => e.t === 'outcome' && e.unit === 'codex' && e.target === 'f0');
    assert.ok(pick, `${act.id} picked`);
    assert.equal(findUnit(b, 'codex').attacks, 0, 'not counted toward the attack index');
    assert.equal(findUnit(b, 'codex').heat, 30, 'no heat');
    assert.ok(!fired.events.some((e) => e.t === 'heat' && e.unit === 'codex'));
  }
});
