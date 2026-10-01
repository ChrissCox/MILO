// The battle (src/combat/battle.js; CONTRACT-PHASE4.md §5.4–§5.9, §6.6, §7.1, §13 wave 1 B):
// creation, COMBAT §3.7's round, modes, the commands, what every Tale-lead shares, saving and
// restoring, and the budgets for apply and a saved Battle.
//   node --test tests/combat-battle.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashInts, unit } from '../src/world/rng.js';
import {
  rules, hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, deepFreeze, OPEN,
} from './combat-kit.js';
import { oddsFor, saveBattle, restoreBattle, battleBytes, spawnFoe, unitView, sneakCheck, legalActions } from '../src/combat/battle.js';
import { noiseBanner } from '../src/combat/round.js';
import { runToEnd } from '../src/combat/driver.js';
import { makeRun, landHit, pickOutcome } from '../src/combat/effects.js';
import { oddsAgainst } from '../src/combat/round.js';
import { BANDS, shiftBars, foldBars, degreeAt, draw as drawAt } from '../src/combat/heat.js';

// ---------- COMBAT §3.7 ----------

const draw = (seed, k) => unit(hashInts(seed, 0, k)) * 100;
const initiative = (seed, i, base) => base + 2 * unit(hashInts(seed, i, 'init'));

/** A seed whose ribbon reads beetle, Milo, the Scribe, Pip, whose six picks land as §3.7's, and where nothing lags. */
function seed37() {
  const ranges = [[15, 75], [5, 85], [15, 75], [65, 80], [5, 85], [0, 20]];
  for (let s = 1; s < 5000000; s += 1) {
    const m = initiative(s, 0, 6);
    const sc = initiative(s, 1, 6);
    const p = initiative(s, 2, 5);
    const b = initiative(s, 3, 9);
    if (!(b > m && m > sc && sc > p)) continue;
    if (ranges.some(([lo, hi], k) => draw(s, k) < lo || draw(s, k) >= hi)) continue;
    let lag = false;
    for (let t = 1; t <= 3 && !lag; t += 1) for (let i = 0; i < 4 && !lag; i += 1) lag = unit(hashInts(s, 0, 1, t, i, t - 1, 'noise:neon')) < 0.2;
    if (!lag) return s;
  }
  throw new Error('no seed');
}

function setup37(seed) {
  const beetle = stray('f0', { archetype: 'crawler', temperament: 'curious', genre: 'neon', x: 8, y: 2, name: 'Glitch beetle' });
  const fight = fightSpec({
    seed, foes: [beetle], objects: [{ id: 'o0', kind: 'breaker', x: 14, y: 1, state: 'on', flags: [], integrity: null }],
    arenaOpts: { entry: [{ x: 14, y: 4 }, { x: 2, y: 3 }, { x: 4, y: 2 }] },
  });
  const beetlePlan = plan('f0', [A.stride([{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }]), A.strike('pip'), A.strike('pip')], { by: 'foe' });
  const ctx = makeCtx({ foePlan: (b, id) => (id === 'f0' ? beetlePlan : null) });
  return { fight, ctx, heroes: [hero('milo'), hero('claude'), hero('pip')] };
}

test('COMBAT §3.7’s round comes out exactly: its bars, its damage, the Buffer soaking the Graze, and the beetle sorted in tick 3', () => {
  const seed = seed37();
  const { fight, ctx, heroes } = setup37(seed);
  let b = createBattle(fight, heroes, {}, ctx);
  assert.deepEqual(b.order, ['f0', 'milo', 'claude', 'pip'], 'the ribbon reads the beetle, Milo, the Scribe, Pip');
  assert.equal(noiseBanner(b).words, 'Neon: lag. About 1 action in 5 lands a tick late.');
  assert.equal(noiseBanner(b, rules).words, 'Neon: lag. About 1 action in 5 lands a tick late.');
  assert.equal(b.telegraphs.length, 3);
  assert.deepEqual(b.telegraphs.map((t) => t.tick), [1, 2, 3]);
  // Before Run: Pip's Strikes, the first Warm, the second Hot at −1 edge.
  const pipPlan = plan('pip', [A.examine('f0'), A.strike('f0'), A.strike('f0')]);
  const [first] = oddsFor(b, 'pip', pipPlan.slots[1], ctx, { slot: 1, plan: pipPlan });
  assert.deepEqual(first.bars, [15, 60, 15, 10]);
  assert.equal(first.band, 'warm');
  assert.equal(first.heat, 45);
  assert.deepEqual(first.amounts, [14, 7, 3, 0], '"14 ? / 7 ? / 3 ? / 0"');
  assert.equal(first.known, false);
  const [second] = oddsFor(b, 'pip', pipPlan.slots[2], ctx, { slot: 2, plan: pipPlan });
  assert.deepEqual(second.bars, [20, 35, 15, 30]);
  assert.equal(second.heat, 65);
  assert.equal(second.edge, -1);
  assert.equal(second.band, 'hot');
  ({ battle: b } = play(b, [
    { t: 'plan', unitId: 'milo', plan: plan('milo', [A.stride([{ x: 14, y: 3 }]), A.stride([{ x: 14, y: 2 }]), A.interact({ object: 'o0' })]) },
    { t: 'plan', unitId: 'claude', plan: plan('claude', [A.stride([{ x: 3, y: 3 }]), A.brace(), A.use('letter', { unit: 'pip' })]) },
    { t: 'plan', unitId: 'pip', plan: pipPlan },
    { t: 'commit' },
  ], ctx));
  const all = [];
  // Tick 1: four actions, then Pip's Examine has changed her hover to 17 / 10 / 6 / 0.
  for (let i = 0; i < 4; i += 1) {
    const r = apply(b, { t: 'step' }, ctx);
    b = r.battle;
    all.push(...r.events);
  }
  assert.equal(findUnit(b, 'f0').x, 5, 'the beetle scuttled beside Pip');
  assert.equal(findUnit(b, 'f0').examined, true);
  assert.ok(all.some((e) => e.t === 'reveal' && e.text === 'Resists Static 3. Weak to Warp 3. Curious.'));
  const [after] = oddsFor(b, 'pip', b.plans.pip.slots[1], ctx, { slot: 1 });
  assert.deepEqual(after.amounts, [17, 10, 6, 0]);
  assert.equal(after.known, true);
  const rest = playRound(b, ctx);
  b = rest.battle;
  all.push(...rest.events);
  const outcomes = all.filter((e) => e.t === 'outcome');
  assert.deepEqual(outcomes.map((e) => [e.unit, e.degree, e.bars.join('/')]), [
    ['f0', 'hit', '15/60/15/10'],
    ['claude', 'hit', '5/80/15/0'],
    ['pip', 'hit', '15/60/15/10'],
    ['f0', 'graze', '5/60/15/20'],
    ['claude', 'hit', '5/80/15/0'],
    ['pip', 'crit', '20/35/15/30'],
  ]);
  const damage = all.filter((e) => e.t === 'damage');
  assert.deepEqual(damage.map((e) => [e.target, e.amount, e.kind, e.buffered, e.integrity, e.tick]), [
    ['pip', 6, 'static', 0, 10, 2],
    ['f0', 10, 'warp', 0, 10, 2],
    ['pip', 3, 'static', 3, 10, 3],
    ['f0', 17, 'warp', 0, 0, 3],
  ]);
  assert.ok(all.some((e) => e.t === 'reaction' && e.unit === 'claude' && e.id === 'shoulder' && e.tick === 3), 'the Scribe shoulders the Graze');
  assert.ok(!all.some((e) => e.t === 'reaction' && e.tick === 2), 'in tick 2 her Shoulder had nothing to lend');
  assert.ok(all.some((e) => e.t === 'buffer' && e.unit === 'claude' && e.buffer === 4 && e.tick === 2));
  assert.ok(all.some((e) => e.t === 'patch' && e.target === 'pip' && e.amount === 5 && e.integrity === 15));
  assert.ok(all.some((e) => e.t === 'object' && e.object === 'o0' && e.state === 'off'), 'Milo pulls the breaker');
  const sorted = all.find((e) => e.t === 'sorted');
  assert.equal(sorted.unit, 'f0');
  assert.equal(sorted.tick, 3);
  assert.ok(b.log.includes('Pip — Critical — 17 Warp'));
  assert.equal(b.status, 'won');
  assert.equal(findUnit(b, 'pip').integrity, 15);
});

// ---------- creation ----------

const three = () => [stray('f0', { x: 10, y: 1 }), stray('f1', { x: 11, y: 2, archetype: 'crawler', temperament: 'curious', talkKind: 'k1' }), stray('f2', { x: 12, y: 3, archetype: 'construct', talkKind: 'k2' })];

test('createBattle places heroes on the entry tiles in formation order, at idle heat, with the Hooklight raised', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: three() }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
  assert.deepEqual(['milo', 'claude', 'codex'].map((id) => [findUnit(b, id).x, findUnit(b, id).y]), [[1, 1], [1, 2], [1, 3]]);
  assert.deepEqual(b.units.slice(0, 3).map((u) => u.heat), [20, 25, 30]);
  assert.equal(findUnit(b, 'f1').heat, 35, 'a curious stray starts at 35');
  const lamp = b.lights.find((l) => l.id === 'hooklight');
  assert.deepEqual([lamp.x, lamp.y, lamp.radius], [1, 1, 5]);
  assert.equal(b.status, 'planning');
  assert.equal(b.round, 1);
  assert.ok(Object.isFrozen(b) && Object.isFrozen(b.units[0]));
  // The Artificer's bench drone stands ready, right after its maker on the ribbon.
  const drone = b.units.find((u) => u.kind === 'drone');
  assert.equal(drone.id, 'd0');
  assert.equal(b.order[b.order.indexOf('codex') + 1], 'd0');
  assert.equal(drone.maxIntegrity, 5);
  // Only the listed Battle fields exist (plus auto, and §18.2's standoff count `quiet`, both reported).
  assert.deepEqual(Object.keys(b).sort(), ['v', 'id', 'seed', 'attempt', 'k', 'round', 'tick', 'cursor', 'status', 'mode', 'modeNext', 'calm',
    'firstLead', 'roadLevel', 'warding', 'kind', 'level', 'genres', 'affixes', 'sight', 'weight', 'real', 'arena', 'units', 'order', 'objects',
    'surfaces', 'lights', 'sustained', 'talk', 'cheers', 'plans', 'telegraphs', 'drafted', 'schedule', 'lead', 'seen', 'memory', 'log', 'ask',
    'result', 'auto', 'quiet'].sort());
  assert.equal(b.quiet, 0);
});

test('Maud’s Table raises every party unit’s idle heat by 15; Storybook and Maud’s scale foes by the stray row at creation', () => {
  const ctx = makeCtx();
  const foes = [stray('f0', { level: 2, x: 10, y: 1 })];
  const maud = createBattle(fightSpec({ foes, level: 2 }), [hero('milo')], { mode: 'mauds-table' }, ctx);
  assert.equal(findUnit(maud, 'milo').heat, 35);
  const f = findUnit(maud, 'f0');
  assert.equal(f.maxIntegrity, Math.round(34 * (48 / 34)));
  assert.equal(f.strike.amount, Math.round(8 * (9 / 8)));
  const story = createBattle(fightSpec({ foes, level: 2 }), [hero('milo')], { mode: 'storybook' }, ctx);
  assert.equal(findUnit(story, 'f0').maxIntegrity, 20, 'level 2 → 1: 34 × 20/34');
  assert.equal(findUnit(story, 'f0').strike.amount, 6);
  assert.equal(findUnit(story, 'milo').heat, 20);
  const first = createBattle(fightSpec({ foes, level: 2 }), [hero('milo')], { mode: 'mauds-table', firstLead: true }, ctx);
  assert.equal(findUnit(first, 'f0').maxIntegrity, 20, 'the first Tale-lead’s fight uses Storybook whatever the mode');
  assert.equal(findUnit(first, 'milo').heat, 20);
});

test('a surprised side loses round 1; a doorway Talk down counts its calm and gives up the surprise', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo'), hero('claude')];
  const fight = fightSpec({ foes: [stray('f0', { x: 3, y: 1 })], surprised: 'foes' });
  let b = createBattle(fight, heroes, {}, ctx);
  const committed = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace()]) }, { t: 'commit' }], ctx);
  const r = playRound(committed.battle, ctx);
  r.events.unshift(...committed.events);
  const lost = r.events.filter((e) => e.t === 'lost' && e.unit === 'f0');
  assert.ok(lost.length >= 1 && lost.every((e) => e.why === 'asleep'));
  assert.ok(!r.events.some((e) => e.t === 'act' && e.unit === 'f0'), 'the surprised stray did nothing in round 1');
  const talked = createBattle(fight, heroes, { talk: { k0: 1 } }, ctx);
  assert.equal(talked.talk.k0.calm, 1);
  assert.equal(talked.talk.k0.need, 4, 'grumpy needs 4');
  assert.ok(!findUnit(talked, 'f0').mods.some((m) => m.stat === 'surprised'), 'talking from the doorway gives up the surprise');
  const sneaky = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1 })] }), heroes, { sneak: 'unseen' }, ctx);
  assert.ok(findUnit(sneaky, 'milo').conditions.some((c) => c.id === 'unseen'));
  assert.ok(findUnit(sneaky, 'f0').mods.some((m) => m.stat === 'surprised'));
});

test('a sleepy stray starts Drowsy; Charm 3+ in the party needs one fewer Talk down', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1, temperament: 'sleepy' })] }), [hero('milo'), hero('pip')], {}, ctx);
  assert.ok(findUnit(b, 'f0').conditions.some((c) => c.id === 'drowsy' && c.n === 1));
  assert.equal(b.talk.k0.need, 2, 'sleepy 3, one fewer with Pip’s Charm 3');
});

test('Set the ambush places the party within 3 of its formation, only at Warding 30 and only Unseen', () => {
  const ctx = makeCtx();
  const fight = fightSpec({ foes: [stray('f0', { x: 12, y: 3 })] });
  const placement = { milo: { x: 3, y: 2 } };
  const yes = createBattle(fight, [hero('milo')], { sneak: 'unseen', warding: 30, placement }, ctx);
  assert.deepEqual([findUnit(yes, 'milo').x, findUnit(yes, 'milo').y], [3, 2]);
  const lowWarding = createBattle(fight, [hero('milo')], { sneak: 'unseen', warding: 29, placement }, ctx);
  assert.deepEqual([findUnit(lowWarding, 'milo').x, findUnit(lowWarding, 'milo').y], [1, 1]);
  const seen = createBattle(fight, [hero('milo')], { warding: 30, placement }, ctx);
  assert.deepEqual([findUnit(seen, 'milo').x, findUnit(seen, 'milo').y], [1, 1]);
  const far = createBattle(fight, [hero('milo')], { sneak: 'unseen', warding: 30, placement: { milo: { x: 9, y: 1 } } }, ctx);
  assert.deepEqual([findUnit(far, 'milo').x, findUnit(far, 'milo').y], [1, 1]);
});

// ---------- the reducer ----------

test('apply never mutates its input and returns the same battle when nothing changes', () => {
  const ctx = makeCtx();
  const b = deepFreeze(createBattle(fightSpec({ foes: three() }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx));
  const snapshot = JSON.stringify(b);
  const r = runToEnd(b, ctx);
  assert.equal(JSON.stringify(b), snapshot);
  assert.ok(r.result);
  assert.equal(apply(b, { t: 'step' }, ctx).battle, b, 'step while planning changes nothing');
  assert.equal(apply(b, { t: 'answer', yes: true }, ctx).battle, b);
  assert.equal(apply(b, { t: 'nonsense' }, ctx).battle, b);
  assert.equal(apply(r.battle, { t: 'commit' }, ctx).battle, r.battle, 'a finished fight takes no more commands');
});

test('a mode switch to Storybook waits for the next round’s start, then cools the bands and scales foes’ damage, with no bar jumping', () => {
  const ctx = makeCtx();
  let b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1, level: 1 })] }), [hero('milo')], { mode: 'long-road' }, ctx);
  const before = JSON.stringify(b);
  b = apply(b, { t: 'mode', mode: 'storybook' }, ctx).battle;
  assert.equal(b.mode, 'long-road');
  assert.equal(b.modeNext, 'storybook');
  const f = findUnit(b, 'f0');
  assert.equal(f.maxIntegrity, JSON.parse(before).units.find((u) => u.id === 'f0').maxIntegrity);
  const probe = plan('milo', [A.strike('f0')]);
  assert.deepEqual(oddsFor(b, 'milo', probe.slots[0], ctx, { plan: probe })[0].band, 'cool');
  b = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace()]) }, { t: 'commit' }], ctx).battle;
  b = playRound(b, ctx).battle;
  assert.equal(b.mode, 'storybook');
  assert.equal(b.modeNext, null);
  assert.equal(findUnit(b, 'f0').maxIntegrity, f.maxIntegrity, 'Integrity stays as it was');
  const hot = { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, heat: 70 } : u)) };
  assert.equal(oddsFor(hot, 'milo', probe.slots[0], ctx, { plan: probe })[0].band, 'warm', 'Hot uses Warm’s bars in Storybook');
  assert.equal(apply(b, { t: 'mode', mode: 'mauds-table' }, ctx).battle, b, 'harder only between fights');
});

test('Head home ends the fight at the end of the current tick, keeping everything', () => {
  const ctx = makeCtx();
  let b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 1 })] }), [hero('milo'), hero('claude')], {}, ctx);
  b = play(b, [
    { t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace(), A.brace()]) },
    { t: 'plan', unitId: 'claude', plan: plan('claude', [A.brace(), A.brace()]) },
    { t: 'commit' },
  ], ctx).battle;
  let r = apply(b, { t: 'step' }, ctx);
  r = apply(r.battle, { t: 'head-home' }, ctx);
  assert.equal(r.battle.status, 'running', 'the tick finishes first');
  let x = r.battle;
  const events = [];
  while (x.status === 'running') {
    const s = apply(x, { t: 'step' }, ctx);
    events.push(...s.events);
    x = s.battle;
  }
  assert.equal(x.status, 'home');
  assert.equal(x.result.outcome, 'home');
  assert.ok(events.every((e) => e.tick <= 1), 'nothing past tick 1 resolved');
  const planning = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 1 })] }), [hero('milo')], {}, ctx);
  assert.equal(apply(planning, { t: 'head-home' }, ctx).battle.status, 'home');
});

test('the end command closes a paused fight as a win that pays the room', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: three() }), [hero('milo')], {}, ctx);
  const r = apply(b, { t: 'end', outcome: 'won', why: 'seam-closed' }, ctx);
  assert.equal(r.battle.status, 'won');
  assert.equal(r.battle.result.summary, 'The seam closed while you were away.');
  assert.ok(r.events.some((e) => e.t === 'end'));
});

test('Wrap it up only works when the foes’ remaining Integrity is below one round of the party’s expected damage', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo'), hero('claude'), hero('codex')];
  const b = createBattle(fightSpec({ foes: three() }), heroes, {}, ctx);
  assert.equal(apply(b, { t: 'wrap' }, ctx).battle, b, 'three fresh strays are too many');
  const weak = { ...b, units: b.units.map((u) => (u.side === 'foe' ? { ...u, integrity: 3 } : u)) };
  const r = apply(weak, { t: 'wrap' }, ctx);
  assert.ok(['won', 'talked'].includes(r.battle.status));
  assert.equal(r.battle.result.auto, true);
});

test('spawnFoe adds s<i> at the end of the ribbon with a spawn event; unitView is §11.3’s shape', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 1 })] }), [hero('milo')], {}, ctx);
  const r = spawnFoe(b, stray('clerk', { x: 0, y: 0, name: 'Clerk' }), { x: 8, y: 2 });
  assert.equal(r.battle.order[r.battle.order.length - 1], 's0');
  assert.equal(findUnit(r.battle, 's0').x, 8);
  assert.equal(r.events[0].t, 'spawn');
  assert.deepEqual(Object.keys(r.events[0].unit).sort(), ['bar', 'buffer', 'conditions', 'facing', 'heat', 'id', 'integrity', 'look', 'max', 'name',
    'offline', 'rank', 'side', 'size', 'sorted', 'talkKind', 'x', 'y'].sort());
  assert.deepEqual(unitView(r.battle, 's0'), r.events[0].unit);
  const again = spawnFoe(r.battle, stray('clerk', { name: 'Clerk' }), { x: 8, y: 3 });
  assert.equal(again.battle.order[again.battle.order.length - 1], 's1');
});

test('sneakCheck lands one Cool outcome for the party from hashInts(fight.seed, ’sneak’), with dim and dark edge', () => {
  const fight = fightSpec({ foes: [stray('f0', { x: 12, y: 1, archetype: 'crawler' })] });
  const tiles = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
  const lit = sneakCheck(fight, tiles, { lightAt: () => 'L', rules });
  assert.equal(lit.odds.edge, -1, 'the watcher’s mind Resolve 1');
  assert.deepEqual(lit.odds.bars, [0, 75, 10, 15]);
  const dark = sneakCheck(fight, tiles, { lightAt: () => 'D', rules });
  assert.equal(dark.odds.edge, 1);
  const dim = sneakCheck(fight, tiles, { lightAt: () => 'd', rules });
  assert.equal(dim.odds.edge, 0);
  const u = unit(hashInts(fight.seed, 'sneak')) * 100;
  assert.equal(dark.unseen, u < dark.odds.bars[0] + dark.odds.bars[1]);
});

// ---------- leads ----------

function leadSpec(over = {}) {
  const u = stray('lead', { x: 10, y: 2, talkKind: null, name: 'Madame Voss', ...over });
  u.rank = 'lead';
  u.size = 2;
  u.attackEdge = 1;
  u.flat = 2;
  u.lead = { mechanic: 'fallback', phases: 3, bars: [12, 12, 12], quote: 'You’ll never make the deadline.' };
  return u;
}

test('a Tale-lead’s bars run Opening, Twist and Last page, calling phaseChange, and the last bar sorts it', () => {
  const calls = [];
  const spy = {
    id: 'spy',
    setup: (b) => { calls.push('setup'); return b; },
    roundStart: (b) => { calls.push('roundStart'); return { battle: b, events: [] }; },
    telegraphs: () => { calls.push('telegraphs'); return []; },
    actions: () => [],
    resolve: () => null,
    damageTaken: (b, hit) => { calls.push(`damageTaken:${hit.amount}`); return hit.amount; },
    tickEnd: (b, t) => { calls.push(`tickEnd:${t}`); return { battle: b, events: [] }; },
    roundEnd: (b) => { calls.push('roundEnd'); return { battle: b, events: [], yielded: false }; },
    phaseChange: (b, from, to) => { calls.push(`phase:${from}>${to}`); return { battle: b, events: [] }; },
    bow: () => ({ progress: 0, need: 3, done: false }),
  };
  const ctx = makeCtx({ mechanics: { fallback: spy }, foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  const fight = fightSpec({ foes: [], leadUnit: leadSpec(), lead: { mechanic: 'fallback', phases: 3, bow: 'x', quote: 'q' }, kind: 'lead' });
  let b = createBattle(fight, [hero('milo'), hero('claude'), hero('pip')], {}, ctx);
  assert.equal(b.lead.phase, 'opening');
  assert.deepEqual(b.lead.bars, [12, 12, 12]);
  assert.equal(findUnit(b, 'lead').maxIntegrity, 12);
  assert.ok(calls.includes('setup') && calls.includes('telegraphs'));
  const events = [];
  // Knock the bars down directly through Strikes placed beside the lead.
  b = { ...b, units: b.units.map((u) => (u.side === 'party' ? { ...u, x: 9, y: 1 + ['milo', 'claude', 'pip'].indexOf(u.id), strike: { ...u.strike, amount: 9 } } : u)) };
  for (let round = 0; round < 12 && b.status !== 'won'; round += 1) {
    b = play(b, ['milo', 'claude', 'pip'].map((id) => ({ t: 'plan', unitId: id, plan: plan(id, [A.strike('lead'), A.brace()]) })).concat([{ t: 'commit' }]), ctx).battle;
    const r = playRound(b, ctx);
    b = r.battle;
    events.push(...r.events);
  }
  assert.equal(b.status, 'won');
  assert.deepEqual(events.filter((e) => e.t === 'phase').map((e) => e.phase), ['twist', 'last-page']);
  assert.ok(events.filter((e) => e.t === 'phase').every((e) => e.quote === 'You’ll never make the deadline.'));
  assert.deepEqual(calls.filter((c) => c.startsWith('phase:')), ['phase:opening>twist', 'phase:twist>last-page']);
  assert.ok(calls.some((c) => c.startsWith('damageTaken:')) && calls.includes('tickEnd:1') && calls.includes('tickEnd:3') && calls.includes('roundEnd') && calls.includes('roundStart'));
  assert.ok(events.some((e) => e.t === 'bar' && e.bar === 1));
  assert.equal(events.find((e) => e.t === 'sorted' && e.unit === 'lead').how, 'settled');
});

test('a bare lead works with no mechanics; a real rift’s lead yields and names the cause; bow().done ends as bowed', () => {
  const heroes = [hero('milo'), hero('claude')];
  const strong = (b) => ({ ...b, units: b.units.map((u) => (u.side === 'party' ? { ...u, x: 9, y: 1 + (u.id === 'claude' ? 1 : 0), strike: { ...u.strike, amount: 60 } } : u)) });
  const run = (b, ctx) => {
    let x = b;
    for (let i = 0; i < 6 && !['won', 'yielded', 'bowed'].includes(x.status); i += 1) {
      x = play(x, heroes.map((h) => ({ t: 'plan', unitId: h.id, plan: plan(h.id, [A.strike('lead'), A.strike('lead')]) })).concat([{ t: 'commit' }]), ctx).battle;
      x = playRound(x, ctx).battle;
    }
    return x;
  };
  const bare = makeCtx({ foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  const plainFight = fightSpec({ leadUnit: leadSpec(), kind: 'lead' });
  assert.equal(run(strong(createBattle(plainFight, heroes, {}, bare)), bare).status, 'won');
  const realFight = fightSpec({ leadUnit: leadSpec(), kind: 'lead', real: { key: 'real:1', cause: 'The Habitack checks are still red.' } });
  const yielded = run(strong(createBattle(realFight, heroes, {}, bare)), bare);
  assert.equal(yielded.status, 'yielded');
  assert.deepEqual(yielded.result.real, { cause: 'The Habitack checks are still red.' });
  const bowing = makeCtx({ mechanics: { fallback: { id: 'b', bow: (b) => ({ progress: 1, need: 1, done: b.round >= 1 }) } }, foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  let b = createBattle(plainFight, heroes, {}, bowing);
  b = play(b, [{ t: 'commit' }], bowing).battle;
  const r = playRound(b, bowing);
  assert.equal(r.battle.status, 'bowed');
  assert.equal(r.battle.result.bow, true);
  assert.equal(findUnit(r.battle, 'lead').sorted, 'bowed');
});

test('plot armour folds into the bars of the first Resolve effect each phase and marks itself used on a Graze or better', () => {
  const ctx = makeCtx({ foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  let b = createBattle(fightSpec({ leadUnit: leadSpec(), kind: 'lead' }), [hero('claude')], {}, ctx);
  b = { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, x: 9, y: 2 } : u)) };
  const draft = A.use('draft', { unit: 'lead' });
  const [armoured] = oddsFor(b, 'claude', draft, ctx, { plan: plan('claude', [draft]) });
  const [strike] = oddsFor(b, 'claude', A.strike('lead'), ctx, { plan: plan('claude', [A.strike('lead')]) });
  assert.equal(armoured.bars[0], 0, 'one degree worse: no Critical left');
  assert.deepEqual(armoured.bars, foldBars(shiftBars(BANDS[armoured.band], armoured.edge), { armour: true }), 'the Resolve effect’s bars are the folded ones');
  assert.deepEqual(strike.bars, shiftBars(BANDS[strike.band], strike.edge), 'a Strike meeting Guard shows its bars unfolded');
  // In play: a Guard Strike never uses it up.
  const struck = play(b, [{ t: 'plan', unitId: 'claude', plan: plan('claude', [A.strike('lead'), A.strike('lead')]) }, { t: 'commit' }], ctx).battle;
  let s = struck;
  while (s.status === 'running') s = apply(s, { t: 'step' }, ctx).battle;
  assert.equal(s.lead.armourUsed, false, 'Strikes leave the armour for the phase’s first Resolve effect');
  // It's used up when the unfolded degree is a Graze or better, and kept on an unfolded Miss.
  const odds = oddsAgainst(b, ctx, 'claude', 'lead', { harmful: true, meets: 'mind' });
  assert.ok(odds.armour);
  const ks = { crit: null, hit: null, graze: null, miss: null };
  for (let k = 0; k < 400 && Object.values(ks).includes(null); k += 1) {
    const d = degreeAt(drawAt(b.seed, b.attempt, k), odds.unfolded);
    if (ks[d] === null) ks[d] = k;
  }
  for (const [degree, used] of [['crit', true], ['hit', true], ['graze', true], ['miss', false]]) {
    const run = makeRun({ ...b, k: ks[degree] }, ctx);
    pickOutcome(run, 'claude', 'lead', odds);
    assert.equal(run.b.lead.armourUsed, used, `an unfolded ${degree}`);
  }
  b = play(b, [{ t: 'plan', unitId: 'claude', plan: plan('claude', [draft, draft]) }, { t: 'commit' }], ctx).battle;
  let used = false;
  let x = b;
  const events = [];
  while (x.status === 'running') {
    const r = apply(x, { t: 'step' }, ctx);
    events.push(...r.events);
    x = r.battle;
    if (x.lead?.armourUsed) used = true;
  }
  const picks = events.filter((e) => e.t === 'outcome' && e.unit === 'claude');
  if (used) assert.notDeepEqual(picks[0].bars, picks[1]?.bars ?? picks[0].bars.map((n) => n + 1), 'the second pick is no longer armoured');
  assert.ok(picks.length >= 1);
});

test('feints: revise replaces the lead’s queued action, spotted a tick early by a hero with Heed 3+', () => {
  const lead = leadSpec();
  lead.adapt = 3;
  const minds = (heedy) => {
    const ctx0 = makeCtx({ foePlan: () => plan('lead', [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
    const m = { ...ctx0.minds, revise: (b, id, tick) => (tick === 2 ? A.cool() : null) };
    return makeCtx({ minds: m });
  };
  for (const heedy of [true, false]) {
    const ctx = minds(heedy);
    const hero1 = heedy ? hero('milo') : hero('claude');
    let b = createBattle(fightSpec({ leadUnit: lead, kind: 'lead', level: 1 }), [hero1], { roadLevel: 1, calm: { noise: false, adaptation: true } }, ctx);
    assert.equal(b.lead.feintsLeft, 1, 'step 3 feints once a phase');
    const committed = play(b, [{ t: 'commit' }], ctx);
    const r = playRound(committed.battle, ctx);
    r.events.unshift(...committed.events);
    const feint = r.events.find((e) => e.t === 'feint');
    assert.ok(feint, 'a feint happened');
    assert.equal(feint.spotted, heedy);
    assert.equal(feint.tick, heedy ? 1 : 2, heedy ? 'spotted at the start of the tick before' : 'at its own tick');
    assert.ok(r.events.some((e) => e.t === 'act' && e.unit === 'lead' && e.action.id === 'cool-down'));
  }
});

// ---------- saving ----------

test('restoreBattle(saveBattle(b)) deep-equals b through a whole fight, and a bad save gives null', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo'), hero('claude'), hero('codex')];
  const fight = fightSpec({ foes: three(), surfaces: [{ x: 6, y: 2, id: 'water', rounds: null }, { x: 7, y: 2, id: 'candle-wax', rounds: null }] });
  let b = createBattle(fight, heroes, {}, ctx);
  let checked = 0;
  const check = (x) => {
    const back = restoreBattle(JSON.parse(JSON.stringify(saveBattle(x))), ctx, { fight, heroes });
    assert.deepStrictEqual(back, x, `round ${x.round} tick ${x.tick} cursor ${x.cursor} ${x.status}`);
    checked += 1;
  };
  check(b);
  const r = runToEnd(b, ctx);
  assert.ok(r.result);
  // Walk the same fight step by step, checking every state.
  let guard = 0;
  while (!['won', 'talked', 'offline', 'home'].includes(b.status) && guard < 300) {
    guard += 1;
    if (b.status === 'planning') {
      check(b);
      const plans = Object.fromEntries(heroes.map((h) => [h.id, ctx.minds.draft(b, h.id).plan]));
      for (const h of heroes) if (findUnit(b, h.id) && !findUnit(b, h.id).offline) b = apply(b, { t: 'plan', unitId: h.id, plan: plans[h.id] }, ctx).battle;
      b = apply(b, { t: 'commit' }, ctx).battle;
    } else b = apply(b, b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' }, ctx).battle;
    check(b);
  }
  assert.ok(checked > 10);
  assert.equal(restoreBattle({ ...saveBattle(b), v: 1 }, ctx, { fight, heroes }), null);
  assert.equal(restoreBattle({ ...saveBattle(b), id: 'fight:other:w:r1' }, ctx, { fight, heroes }), null);
  assert.equal(restoreBattle(null, ctx, { fight, heroes }), null);
  assert.equal(restoreBattle({ ...saveBattle(b), units: [{ id: 'nobody' }] }, ctx, { fight, heroes }), null);
});

test('a save at every cap stays within 49,152 bytes, and restores; a typical one is far smaller', (t) => {
  // The worst case §5.4 allows: 16 units (heroes, eight foes, the lead and clerks off two different
  // lines), each with 8 lingering conditions (the longest), 4 marks and 6 long mods; every tile of a
  // 20×16 arena under a timed surface at another level; 24 lights, 8 sustained spells, 24 objects
  // (half the fight's own); a 4-slot plan for every unit; drafts for four heroes; the lead's data
  // at its 1,024-byte cap; 30 Log lines of 100 characters; an Ask pending with two answers per hero
  // waiting (§18.3); every hero slot's commit habit; and 48 telegraphs, each holding a Void lie and
  // every foe the eye's 100 characters.
  const ctx = makeCtx();
  // No drone at the start, so twelve foes can each telegraph four slots.
  const heroes = [hero('milo'), hero('claude'), hero('codex', { abilityIds: ['drone-zap', 'pop-up-cover', 'device', 'spare-part'] }), hero('pip')];
  const rows = ['#'.repeat(20), ...Array.from({ length: 14 }, () => `#${'.'.repeat(18)}#`), '#'.repeat(20)];
  const foes = Array.from({ length: 8 }, (_, i) => stray(`f${i}`, { x: 10 + (i % 4), y: 3 + Math.floor(i / 4) * 3, talkKind: `k${i}` }));
  const lead = leadSpec();
  lead.post = { x: 16, y: 10 };
  const lamps = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, kind: 'lamp', x: 2 + i, y: 13, state: 'lit', flags: [], integrity: null }));
  const fight = fightSpec({ foes, leadUnit: lead, objects: lamps, arenaRows: rows, kind: 'lead' });
  let b0 = createBattle(fight, heroes, {}, ctx);
  const typical = battleBytes(saveBattle(b0));
  for (let i = 0; b0.units.length < 16; i += 1) {
    const clerk = { ...stray('clerk', { name: i % 2 ? 'Night clerk' : 'Day clerk', talkKind: `line${i % 2}`, genre: i % 2 ? 'iron' : 'neon' }), rank: 'lackey' };
    b0 = spawnFoe(b0, clerk, { x: 3 + i, y: 11 }).battle;
  }
  const kinds = ['static', 'chill', 'dread', 'grind', 'warp', 'doubt', 'dust', 'quake'];
  const path = [{ x: 13, y: 13 }, { x: 14, y: 14 }, { x: 15, y: 13 }, { x: 16, y: 14 }, { x: 17, y: 13 }, { x: 18, y: 14 }];
  const full = {
    ...b0, status: 'asking', tick: 3, cursor: 9,
    units: b0.units.map((u, i) => ({
      ...u, heat: 100, buffer: 13, integrity: 99, maxIntegrity: 144, drops: 1, attacks: 3, examined: true, revealedUntil: 'end-of-round',
      conditions: kinds.map((k) => ({ id: 'lingering', n: 13, source: 'f7', data: { kind: k, turns: 3, fresh: true } })),
      marks: Array.from({ length: 4 }, (_, i) => ({ id: 'that-pile', by: `f${i}`, n: 2, until: 'end-of-next-round' })),
      mods: Array.from({ length: 6 }, (_, i) => ({ stat: 'degree-next-from-foe', by: -1, until: 'rounds:10', source: `sustained:claude:take-heart-${i}` })),
      // The schedule as commit encodes it (position × 256 + tick × 32 + noise flags), four slots a unit.
      usedRound: {
        ...Object.fromEntries([0, 1, 2, 3].map((s) => [`#s${s}`, (i * 4 + s) * 256 + Math.min(3, s + 1) * 32 + 31])),
        '#acted': 3, '#dazed': 2, '#beguiled': 1, '#feint0': 1, '#sus:take-heart': 1, 'stand-in-my-light': 1, mote: 1,
        ...(u.side === 'party' ? Object.fromEntries([0, 1, 2, 3].map((s) => [`#c${s}`, 255 * 65536 + 65535])) : {}),
      },
      uses: { 'stand-in-my-light': 2, 'the-lantern-calls': 1, 'pop-up-cover': 2, proofread: 2 },
      carry: { cordial: 3, brew: 2, margin: 1, spare: 1, essences: 2, stitched: ['neon', 'gothic', 'noir'] },
    })),
    lights: [b0.lights[0], ...Array.from({ length: 23 }, (_, i) => ({ id: `l${i}`, x: i % 18, y: 1, radius: 3, rounds: 10, source: 'little-light' }))],
    sustained: Array.from({ length: 8 }, (_, i) => ({ unitId: 'claude', abilityId: `take-heart-${i}`, rounds: 10, target: { units: ['milo', 'codex', 'pip'] }, cost: 2 })),
    objects: [...b0.objects, ...Array.from({ length: 12 }, (_, i) => ({ id: `o${12 + i}`, kind: 'pop-up-cover', x: 2 + i, y: 12, state: 'up', flags: ['cover-low'], integrity: 20, by: 'codex' }))],
    surfaces: Array.from({ length: 14 * 18 }, (_, i) => ({ x: 1 + (i % 18), y: 1 + Math.floor(i / 18), id: 'burning-foliage', rounds: 12, level: 12 })),
    plans: Object.fromEntries(b0.units.map((u) => [u.id, plan(u.id, [A.stride(path), A.use('inkdarts', { units: ['lead', 'f1', 's12'] }, { cost: 2, extra: 1 }), A.strike('s13'), A.assist('milo', 's14')], { reactions: { 'parting-swipe': 'under-half', shoulder: 'always', proofread: 'ask' }, by: 'draft', changed: [true, false, true, false] })])),
    drafted: Object.fromEntries(heroes.map((h) => [h.id, { confidence: 100, source: 'personality', choices: [0, 1, 2, 3].map((s) => ({ slot: s, template: 255, ability: 65535 })), layers: ['personality', 'personality', 'personality', 'personality'] }])),
    lead: { ...b0.lead, data: { objects: ['x'.repeat(1000)] } },
    log: Array.from({ length: 30 }, () => `${'’'.repeat(4)}${'x'.repeat(96)}`),
    seen: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`${200 + i}:${60000 + i}`, 99])),
    memory: { habit: '255:65535', count: 999 },
    ask: { unitId: 'claude', reactionId: 'proofread', trigger: 'outcome-in-sight', words: 'Proofread the outcome on the Artificer?' },
    talk: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, { calm: 3, need: 4, done: false }])),
    answers: Object.fromEntries(heroes.map((h) => [h.id, { proofread: 1, 'parting-swipe': 0 }])),
    telegraphs: b0.units.filter((u) => u.side === 'foe').flatMap((u) => [0, 1, 2, 3].map((s) => ({
      unitId: u.id, slot: s, tick: Math.min(3, s + 1), icon: 'strike', words: 'Strike Pip', targets: ['pip'], tiles: [], hidden: false,
      falseTarget: 'pip', adapting: `Spreading its hits: you’ve patched the most hurt ally ${'x'.repeat(46)}`, aside: false,
    }))),
  };
  assert.equal(full.telegraphs.length, 48, 'the telegraph cap');
  assert.ok(full.telegraphs.every((x) => x.adapting.length === 100), 'the eye’s words at their cap');
  assert.ok(battleBytes(full.lead.data) <= 1024, 'the lead’s data at its cap');
  const save = saveBattle(full);
  const bytes = battleBytes(save);
  t.diagnostic(`capped save ${bytes} bytes; typical ${typical}`);
  assert.ok(bytes <= 49152, `the capped save is ${bytes} bytes`);
  assert.ok(typical < 20000, `a typical save is ${typical} bytes`);
  // Its compact encodings come back whole (the made-up sustained spells aside, which need no ability to restore).
  const back = restoreBattle(JSON.parse(JSON.stringify(save)), ctx, { fight, heroes });
  assert.ok(back, 'the capped save restores');
  for (const k of ['units', 'surfaces', 'lights', 'objects', 'plans', 'drafted', 'lead', 'log', 'seen', 'talk', 'ask', 'answers']) assert.deepEqual(back[k], full[k], k);
  assert.equal(Object.keys(save.eye).length, 12, 'one eye a foe');
  assert.equal(save.lies.length, 48, 'every lie, with the targets it showed');
  assert.equal(battleBytes({ a: '’' }), JSON.stringify({ a: '’' }).length + 2, 'UTF-8 bytes, not characters');
});

test('restoreBattle refuses what it can’t trust: bad enums, numbers, orders, cursors and heroes', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo'), hero('claude')];
  const fight = fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] });
  let b = createBattle(fight, heroes, {}, ctx);
  const planning = JSON.parse(JSON.stringify(saveBattle(b)));
  b = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace()]) }, { t: 'commit' }], ctx).battle;
  const running = JSON.parse(JSON.stringify(saveBattle(b)));
  assert.ok(restoreBattle(planning, ctx, { fight, heroes }) && restoreBattle(running, ctx, { fight, heroes }), 'good saves restore');
  const unit0 = (s, patch) => ({ ...s, units: s.units.map((u, i) => (i === 0 ? { ...u, ...patch } : u)) });
  for (const [what, bad, list = heroes] of [
    ['a status it doesn’t know', { ...planning, status: 'bogus' }],
    ['k as a string', { ...planning, k: 'x' }],
    ['a round below 1', { ...planning, round: -4 }],
    ['Integrity as words', unit0(planning, { integrity: 'lots' })],
    ['Integrity past its max', unit0(planning, { integrity: 99 })],
    ['a unit off the arena', unit0(planning, { x: 400 })],
    ['a condition it doesn’t know', unit0(planning, { conditions: [['on-fire', 1]] })],
    ['an order with no Milo', { ...planning, order: planning.order.filter((id) => id !== 'milo') }],
    ['an order listing someone twice', { ...planning, order: [...planning.order.slice(1), planning.order[1]] }],
    ['running with no plans', { ...running, plans: null }],
    ['a cursor past the schedule', { ...running, cursor: 40 }],
    ['asking with no Ask', { ...running, status: 'asking' }],
    ['a result while still planning', { ...planning, result: { outcome: 'won' } }],
    ['Cheers past the cap', { ...planning, cheers: 12 }],
    ['a hero built at another level', planning, [hero('milo', { level: 2 }), hero('claude')]],
    ['a hero who wasn’t in the fight', planning, [hero('milo'), hero('claude'), hero('codex')]],
    ['a lead where the room has none', { ...planning, lead: { bars: [10], bar: 0 } }],
    ['a broken surface grid', { ...planning, surfaces: { grid: 'x', rounds: '', levels: '' } }],
  ]) {
    assert.equal(restoreBattle(bad, ctx, { fight, heroes: list }), null, what);
  }
});

test('a use whose target has gone out of range or sight, or that upcasts past its circle or charges, improvises', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 3, integrity: 99, maxIntegrity: 99 })] }), [hero('milo'), hero('claude')], { calm: { noise: false, adaptation: true } }, ctx);
  const offered = legalActions(b, 'milo', ctx).find((o) => o.action.ability === 'flare');
  assert.deepEqual([offered.targets, offered.why], [[], 'No one in range'], 'the planner offers Flare nobody');
  const far = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.use('flare', { unit: 'f0' })]) }, { t: 'commit' }], ctx);
  const ev = [...far.events, ...playRound(far.battle, ctx).events];
  assert.ok(ev.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'out-of-reach'), 'committed anyway, Milo Braces instead');
  assert.ok(!ev.some((e) => e.t === 'damage' && e.target === 'f0'), 'nothing lands 11 tiles away');
  // Upcasting: at most `circle` extra charges, and never more than are left.
  const near = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2, integrity: 99, maxIntegrity: 99 })] }), [hero('milo'), hero('claude')], { calm: { noise: false, adaptation: true } }, ctx);
  const up = (extra) => {
    const c = play(near, [{ t: 'plan', unitId: 'claude', plan: plan('claude', [A.use('inkdarts', { unit: 'f0' }, { cost: 2, extra })]) }, { t: 'commit' }], ctx);
    return [...c.events, ...playRound(c.battle, ctx).events];
  };
  const six = up(6);
  assert.ok(six.some((e) => e.t === 'lost' && e.unit === 'claude') && !six.some((e) => e.t === 'damage' && e.unit === 'claude'), 'six extra on a circle-1 spell never fires');
  const one = up(1);
  assert.ok(one.filter((e) => e.t === 'damage' && e.unit === 'claude').length === 3, 'one extra, with two charges, is fine');
  const poor = play({ ...near, units: near.units.map((u) => (u.id === 'claude' ? { ...u, charges: { ...u.charges, left: 1 } } : u)) }, [{ t: 'plan', unitId: 'claude', plan: plan('claude', [A.use('inkdarts', { unit: 'f0' }, { cost: 2, extra: 1 })]) }, { t: 'commit' }], ctx);
  assert.ok(![...poor.events, ...playRound(poor.battle, ctx).events].some((e) => e.t === 'damage' && e.unit === 'claude'), 'circle 1 + 1 extra needs 2 charges');
});

test('Cheers can’t be spent past what the party holds, through the plan command or at commit', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  const foes = [stray('f0', { x: 2, y: 1, integrity: 99, maxIntegrity: 99 })];
  const cheered = [A.strike('f0', { cheer: true }), A.strike('f0', { cheer: true }), A.strike('f0', { cheer: true })];
  for (const cheers of [0, 1]) {
    const b = createBattle(fightSpec({ foes }), [hero('milo')], { cheers, calm: { noise: false, adaptation: true } }, ctx);
    const planned = apply(b, { t: 'plan', unitId: 'milo', plan: plan('milo', cheered) }, ctx).battle;
    assert.equal(planned.plans.milo.slots.filter((a) => a.cheer).length, cheers, `${cheers} held, ${cheers} stick`);
    const c = play(planned, [{ t: 'commit' }], ctx);
    const picks = [...c.events, ...playRound(c.battle, ctx).events].filter((e) => e.t === 'outcome' && e.unit === 'milo');
    assert.equal(picks.filter((e) => e.cheer).length, cheers);
    assert.ok(picks.filter((e) => !e.cheer).every((e) => e.bars[2] + e.bars[3] > 0), 'the rest keep their Graze and Miss');
  }
});

test('a lead’s feints after a phase change follow its step now: the mode, the adaptation switch and the first lead', () => {
  const ctx = makeCtx();
  const lead = () => ({ ...leadSpec(), adapt: 3 });
  for (const [what, opts, want] of [['Long Road', {}, 1], ['Storybook', { mode: 'storybook' }, 0], ['adaptation off', { calm: { noise: true, adaptation: false } }, 0], ['the first lead', { firstLead: true }, 0], ['Maud’s Table', { mode: 'mauds-table' }, 2]]) {
    const b = createBattle(fightSpec({ leadUnit: lead(), kind: 'lead' }), [hero('milo')], opts, ctx);
    assert.equal(b.lead.feintsLeft, want, `${what} at creation`);
    const run = makeRun(b, ctx);
    landHit(run, { userId: 'milo', targetId: 'lead', amount: 99, kind: 'plain', degree: 'hit' });
    assert.equal(run.b.lead.phase, 'twist');
    assert.equal(run.b.lead.feintsLeft, want, `${what} after the Opening`);
  }
});

test('each tick that begins says so, in order, even ticks nobody acts in', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] }), [hero('milo')], { calm: { noise: false, adaptation: true } }, ctx);
  const c = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.delay(), A.brace()]) }, { t: 'commit' }], ctx);
  const ev = [...c.events, ...playRound(c.battle, ctx).events];
  assert.deepEqual(ev.filter((e) => e.t === 'tick').map((e) => e.tick), [1, 2, 3]);
  const at = (t) => ev.findIndex((e) => e.t === 'tick' && e.tick === t);
  const brace = ev.findIndex((e) => e.t === 'act' && e.action.id === 'brace');
  assert.ok(at(2) < brace && brace < at(3), 'the Brace resolves in tick 2');
  assert.ok(ev.filter((e) => e.t === 'tick').every((e) => e.round === 1));
});

test('one apply takes at most 1 ms (median) and the legal actions list is quick', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo'), hero('claude'), hero('codex')];
  const times = [];
  for (let s = 0; s < 30; s += 1) {
    let b = createBattle(fightSpec({ foes: three(), seed: 1000 + s }), heroes, {}, ctx);
    let guard = 0;
    while (!['won', 'talked', 'offline', 'home'].includes(b.status) && guard < 200) {
      guard += 1;
      if (b.status === 'planning') {
        for (const h of heroes) if (!findUnit(b, h.id)?.offline) b = apply(b, { t: 'plan', unitId: h.id, plan: ctx.minds.draft(b, h.id).plan }, ctx).battle;
        b = apply(b, { t: 'commit' }, ctx).battle;
        continue;
      }
      const t0 = performance.now();
      b = apply(b, b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' }, ctx).battle;
      times.push(performance.now() - t0);
    }
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  assert.ok(median <= 1, `median apply ${median.toFixed(3)} ms over ${times.length}`);
  const b = createBattle(fightSpec({ foes: three() }), heroes, {}, ctx);
  const options = legalActions(b, 'milo', ctx);
  assert.ok(options.some((o) => o.action.id === 'stride' && o.targets === 'path'));
  assert.ok(options.some((o) => o.action.id === 'use' && o.action.ability === 'mote'));
  assert.ok(options.find((o) => o.action.id === 'ready').why.includes('Warding 10'), 'Ready is greyed below Warding 10');
});
