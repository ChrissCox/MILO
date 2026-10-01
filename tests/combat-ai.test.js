// The fast policy (src/combat/ai.js; CONTRACT-PHASE4.md §4.6, §4.15, §5.5, §6.6, §7.2, §13 H2, §15; COMBAT.md
// §8.2, §8.3, §9): each temperament plays its row, Maud's Table plays its row, the scripted player, heat's
// temper, improvising, the Minds B calls, 1,000 seeded 3v3 fights ending within 10 rounds, the
// fast-policy and Tell me how it went budgets, and (H2) how heroes work a Tale-lead's room.
//   node --test tests/combat-ai.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONALITIES, foePlan, scriptedPlan, personalityDraft, personalitySlot, improvise, makeMinds, idlesThisRound, foeTarget, shareOf, attackOptions,
  leadObjects, roomJobs, leadWork, onStomp, helpersFirst,
} from '../src/combat/ai.js';
import { stompTiles } from '../src/combat/leads.js';
import { abilityAmount } from '../src/combat/abilities.js';
import { heroSpec } from '../src/party.js';
import { referenceState } from '../scripts/sim.mjs';
import { createBattle, apply } from '../src/combat/battle.js';
import { runToEnd } from '../src/combat/driver.js';
import { hashInts } from '../src/world/rng.js';
import { unitDist } from '../src/combat/grid.js';
import { hero, stray, fightSpec, makeCtx, findUnit, rules, abilities, GENRES, playRound, plan as planOf, A, arena } from './combat-kit.js';
import { world, ctxFor, partyAt, roomsFor, medianMs, snapshots, TERMINAL } from './minds-kit.js';

function realCtx({ abilityIndex = abilities, party = null, notebooks = {} } = {}) {
  const ctx = {
    rules, abilities: abilityIndex, minds: null, mechanics: {}, bows: null, genres: GENRES,
    party: party || {
      milo: { personality: 'careful', barks: [], voice: 'words' }, claude: { personality: 'careful', barks: [], voice: 'words' },
      codex: { personality: 'steady', barks: [], voice: 'words' }, pip: { personality: 'bold', barks: [], voice: 'words' },
    },
  };
  ctx.minds = makeMinds(ctx, { notebooks });
  return Object.freeze(ctx);
}

const ctx = realCtx();
const party3 = () => [hero('milo'), hero('claude'), hero('codex')];
const firstHostile = (plan) => plan.slots.find((a) => ['strike', 'use', 'shove', 'throw'].includes(a.id)) || null;
const targetOf = (a) => a?.target?.unit || null;

// ---------------------------------------------------------------------------
// Temperaments (§4.6)

test('grumpy strikes the nearest hero', () => {
  let struck = 0;
  for (let i = 0; i < 20; i += 1) {
    const x = 3 + (i % 8);
    const f = stray('f0', { x, y: 1 + (i % 4), temperament: 'grumpy' });
    const b = createBattle(fightSpec({ foes: [f], seed: i + 1 }), [hero('milo'), hero('claude')], {}, ctx);
    const u = findUnit(b, 'f0');
    const heroes = b.units.filter((v) => v.side === 'party' && v.rank === 'hero');
    const nearest = Math.min(...heroes.map((v) => unitDist(v, u)));
    const t = foeTarget(b, u, ctx);
    assert.equal(unitDist(t, u), nearest, `case ${i}`);
    const aim = targetOf(firstHostile(foePlan(b, 'f0', ctx)));
    if (aim) {
      struck += 1;
      assert.equal(aim, t.id, `case ${i}`);
    }
  }
  assert.ok(struck > 5);
});

test('curious Examines the nearest hero first', () => {
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2, temperament: 'curious' })] }), party3(), {}, ctx);
  const p = foePlan(b, 'f0', ctx);
  assert.equal(p.slots[0].id, 'examine');
  const aim = findUnit(b, p.slots[0].target.unit);
  assert.equal(aim.rank, 'hero');
  // Only in round 1.
  const later = { ...b, round: 2 };
  assert.notEqual(foePlan(later, 'f0', ctx).slots[0]?.id, 'examine');
});

test('dramatic opens with its big move once a hero is in its reach', () => {
  const real = realCtx({ abilityIndex: world.abilities });
  const f = stray('f0', { x: 3, y: 2, temperament: 'dramatic', abilityIds: ['glitch-slash'], uses: { 'glitch-slash': 1 } });
  const b = createBattle(fightSpec({ foes: [f] }), party3(), {}, real);
  const p = foePlan(b, 'f0', real);
  assert.ok(p.slots.some((a) => a.id === 'use' && a.ability === 'glitch-slash'), JSON.stringify(p.slots.map((a) => a.ability || a.id)));
  // After its big moment, it plays like the rest.
  const done = { ...b, units: b.units.map((u) => (u.id === 'f0' ? { ...u, mods: [...u.mods, { stat: 'big-done', by: 1, until: 'fight', source: 'big' }] } : u)) };
  assert.ok(!foePlan(done, 'f0', real).slots.some((a) => a.ability === 'glitch-slash'));
});

test('shy keeps its distance: after striking it steps back, and it settles at half (B)', () => {
  const f = stray('f0', { x: 3, y: 2, temperament: 'shy' });
  const b = createBattle(fightSpec({ foes: [f] }), [hero('milo')], {}, ctx);
  const p = foePlan(b, 'f0', ctx);
  const hit = p.slots.findIndex((a) => a.id === 'strike');
  assert.ok(hit >= 0);
  const back = p.slots.slice(hit + 1).find((a) => a.id === 'step');
  assert.ok(back, `${p.slots.map((a) => a.id)}`);
  const milo = findUnit(b, 'milo');
  const d0 = Math.max(Math.abs(milo.x - 3), Math.abs(milo.y - 2));
  assert.ok(Math.max(Math.abs(milo.x - back.target.tile.x), Math.abs(milo.y - back.target.tile.y)) > Math.min(d0, 1));
});

test('sleepy starts Drowsy, and its plan waits until it wakes (B loses the slots)', () => {
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, temperament: 'sleepy' })] }), party3(), {}, ctx);
  assert.ok(findUnit(b, 'f0').conditions.some((c) => c.id === 'drowsy'));
  assert.ok(foePlan(b, 'f0', ctx).slots.length > 0);
});

test('polite never touches an Offline hero, whatever else it does', () => {
  const real = realCtx({ abilityIndex: world.abilities });
  for (let i = 0; i < 40; i += 1) {
    const f = stray('f0', { x: 2 + (i % 5), y: 1 + (i % 4), temperament: 'polite', abilityIds: ['candle-puff'], uses: { 'candle-puff': 1 }, genre: 'gothic' });
    let b = createBattle(fightSpec({ foes: [f], seed: i + 7 }), party3(), {}, real);
    b = { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, offline: true, integrity: 0 } : u)) };
    const p = foePlan(b, 'f0', real);
    for (const a of p.slots) {
      assert.notEqual(a.target?.unit, 'milo');
      if (a.target?.tile) assert.ok(!(a.target.tile.x === findUnit(b, 'milo').x && a.target.tile.y === findUnit(b, 'milo').y));
    }
  }
});

test('lost idles one round in three', () => {
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, temperament: 'lost' })] }), party3(), {}, ctx);
  const idle = [];
  for (let round = 1; round <= 12; round += 1) {
    const r = { ...b, round };
    idle.push(idlesThisRound(r, findUnit(r, 'f0')));
    if (idlesThisRound(r, findUnit(r, 'f0'))) assert.equal(foePlan(r, 'f0', ctx).slots.length, 0);
  }
  assert.equal(idle.filter(Boolean).length, 4);
  for (let i = 0; i + 2 < idle.length; i += 1) assert.equal(idle.slice(i, i + 3).filter(Boolean).length, 1);
});

test('nosy goes for the lantern-bearer', () => {
  const f = stray('f0', { x: 8, y: 2, temperament: 'nosy' });
  const b = createBattle(fightSpec({ foes: [f] }), [hero('claude'), hero('codex'), hero('milo')], {}, ctx);
  assert.equal(foeTarget(b, findUnit(b, 'f0'), ctx).id, 'milo');
  const p = foePlan(b, 'f0', ctx);
  const aim = targetOf(firstHostile(p));
  if (aim) assert.equal(aim, 'milo');
});

test('proud duels the strongest hero', () => {
  const f = stray('f0', { x: 8, y: 2, temperament: 'proud' });
  const b = createBattle(fightSpec({ foes: [f] }), party3(), {}, ctx);
  const strongest = ['milo', 'claude', 'codex'].map((id) => findUnit(b, id)).sort((a, c) => c.maxIntegrity - a.maxIntegrity)[0];
  assert.equal(foeTarget(b, findUnit(b, 'f0'), ctx).id, strongest.id);
  assert.equal(strongest.id, 'codex');
});

// ---------------------------------------------------------------------------
// Modes (§4.15)

test('Maud’s Table focuses fire, crowds a hero who’s Rebooting, and still plays each temperament', () => {
  const foes = [
    stray('f0', { x: 10, y: 1 }), stray('f1', { x: 12, y: 3, talkKind: 'k1', temperament: 'nosy' }), stray('f2', { x: 11, y: 4, talkKind: 'k2', temperament: 'proud' }),
    stray('f3', { x: 12, y: 1, talkKind: 'k3' }),
  ];
  let b = createBattle(fightSpec({ foes }), party3(), { mode: 'mauds-table' }, ctx);
  b = { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, integrity: 5 } : u)) };
  // Grumpy strays focus fire on the Scribe; the nosy one still goes for the lantern-bearer and the proud one for the strongest.
  for (const id of ['f0', 'f3']) assert.equal(foeTarget(b, findUnit(b, id), ctx).id, 'claude', id);
  assert.equal(foeTarget(b, findUnit(b, 'f1'), ctx).id, 'milo');
  assert.equal(foeTarget(b, findUnit(b, 'f2'), ctx).id, 'codex');
  // Long Road: grumpy strikes the nearest instead.
  const lr = { ...b, mode: 'long-road' };
  assert.notEqual(foeTarget(lr, findUnit(lr, 'f0'), ctx).id, 'claude');
  // A hero beside an Offline ally is crowded, whatever the temperament.
  // Milo dozes at (1,1); the Artificer stands beside him and the Scribe well away.
  const reb = { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, offline: true, integrity: 0 } : u.id === 'codex' ? { ...u, x: 2, y: 1 } : u.id === 'claude' ? { ...u, x: 5, y: 4 } : u.id === 'd0' ? { ...u, x: 6, y: 1 } : u)) };
  for (const id of ['f0', 'f1', 'f2', 'f3']) assert.equal(foeTarget(reb, findUnit(reb, id), ctx).id, 'codex', id);
  // A curious stray still Examines first at Maud's Table.
  const cur = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2, temperament: 'curious' })] }), party3(), { mode: 'mauds-table' }, ctx);
  assert.equal(foePlan(cur, 'f0', ctx).slots[0].id, 'examine');
  // Maud's Table strays may make a third attack.
  const near = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1 })] }), party3(), { mode: 'mauds-table' }, ctx);
  assert.equal(foePlan(near, 'f0', ctx).slots.filter((a) => a.id === 'strike').length, 3);
  const plain = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1 })] }), party3(), {}, ctx);
  assert.equal(foePlan(plain, 'f0', ctx).slots.filter((a) => a.id === 'strike').length, 2);
});

test('Maud’s focus fire goes for the hero its Strikes send offline soonest: Guard counts, not only who’s lowest', () => {
  // The Artificer is lower by share (7 of 22) but wears Guard 2; the Scribe (8 of 16, Guard 0) falls in fewer blows.
  let b = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2 })] }), party3(), { mode: 'mauds-table' }, ctx);
  // (The Artificer's drone stands well away, so it lends him no cover.)
  b = { ...b, units: b.units.map((u) => (u.id === 'codex' ? { ...u, integrity: 7, guard: 2 } : u.id === 'claude' ? { ...u, integrity: 8, guard: 0 } : u.id === 'd0' ? { ...u, x: 13, y: 4 } : u)) };
  assert.ok(shareOf(findUnit(b, 'codex')) < shareOf(findUnit(b, 'claude')));
  assert.equal(foeTarget(b, findUnit(b, 'f0'), ctx).id, 'claude');
  const bare = { ...b, units: b.units.map((u) => (u.id === 'codex' ? { ...u, guard: 0 } : u)) };
  assert.equal(foeTarget(bare, findUnit(bare, 'f0'), ctx).id, 'codex', 'with its Guard gone, the Artificer is the quicker');
});

test('Maud’s Table plays surface combos: it knocks a hero off a height or onto a surface that hurts, lays a surface on two heroes, and arcs through water', () => {
  const real = realCtx({ abilityIndex: world.abilities });
  // A dais (x 2–5, y 1–3): the Artificer stands on its west edge at (2,2), the stray beside him at (3,2); a Shove pushes him off it.
  const heights = ['0000000000000000', '0011110000000000', '0011110000000000', '0011110000000000', '0000000000000000', '0000000000000000'];
  const onDais = (mode) => {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })], arenaOpts: { heights } }), party3(), { mode }, real);
    return { ...b, units: b.units.map((u) => (u.id === 'codex' ? { ...u, x: 2, y: 2 } : u.id === 'milo' ? { ...u, x: 1, y: 4 } : u.id === 'claude' ? { ...u, x: 7, y: 4 } : u.id === 'd0' ? { ...u, x: 9, y: 4 } : u)) };
  };
  const knocked = foePlan(onDais('mauds-table'), 'f0', real);
  assert.deepEqual(knocked.slots[0], { ...knocked.slots[0], id: 'shove', target: { unit: 'codex' } }, JSON.stringify(knocked.slots));
  assert.ok(!foePlan(onDais('long-road'), 'f0', real).slots.some((a) => a.id === 'shove'), 'Long Road just strikes');
  // Burning oil behind the Scribe: the Shove knocks her into it.
  const oil = createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 2 })], surfaces: [{ x: 3, y: 2, id: 'burning-oil', rounds: 2 }] }), party3(), { mode: 'mauds-table' }, real);
  const oily = { ...oil, units: oil.units.map((u) => (u.id === 'claude' ? { ...u, x: 4, y: 2 } : u.id === 'milo' ? { ...u, x: 1, y: 4 } : u.id === 'codex' ? { ...u, x: 1, y: 1 } : u.id === 'd0' ? { ...u, x: 9, y: 4 } : u)) };
  const pushed = foePlan(oily, 'f0', real);
  assert.equal(pushed.slots[0].id, 'shove', JSON.stringify(pushed.slots));
  assert.equal(pushed.slots[0].target.unit, 'claude');
  // Lay a surface: a grumpy Gothic stray drops its candle wax on two heroes standing together.
  const gothic = (mode) => createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 6, y: 2, genre: 'gothic', abilityIds: ['candle-puff'], uses: { 'candle-puff': 1 } })] }), party3(), { mode }, real);
  const laid = foePlan(gothic('mauds-table'), 'f0', real);
  assert.equal(laid.slots[0].ability, 'candle-puff', JSON.stringify(laid.slots));
  assert.ok(!foePlan(gothic('long-road'), 'f0', real).slots.some((a) => a.ability === 'candle-puff'), 'only a dramatic stray opens with it on Long Road');
  // Arcs: a Neon stray's Static arcs through water, so it picks the hero standing in it with another.
  const wet = (surfaces) => {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 2 })], surfaces }), party3(), { mode: 'mauds-table' }, real);
    return { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, x: 2, y: 1, integrity: 14, guard: 0 } : u.id === 'claude' ? { ...u, x: 2, y: 2, integrity: 16 } : u.id === 'codex' ? { ...u, x: 2, y: 4, integrity: 10, guard: 0 } : u.id === 'd0' ? { ...u, x: 9, y: 4 } : u)) };
  };
  const dry = wet([]);
  assert.equal(foeTarget(dry, findUnit(dry, 'f0'), real).id, 'codex', 'on dry ground the lowest');
  const flooded = wet([{ x: 2, y: 1, id: 'water', rounds: null }, { x: 2, y: 2, id: 'water', rounds: null }]);
  assert.ok(['milo', 'claude'].includes(foeTarget(flooded, findUnit(flooded, 'f0'), real).id), 'in the water, one of the two standing in it');
});

test('Long Road and Maud’s ranged strays get into cover after shooting, keeping their target in range; Storybook stays plain', () => {
  const rows = ['################', '#..............#', '#......o.......#', '#..............#', '#..............#', '################'];
  const at = (mode) => {
    const b = createBattle(fightSpec({ arenaRows: rows, foes: [stray('f0', { x: 7, y: 3, archetype: 'floater' })] }), party3(), { mode }, ctx);
    return { ...b, units: b.units.map((u) => (u.id === 'd0' ? { ...u, x: 13, y: 4 } : u)) };
  };
  const p = foePlan(at('long-road'), 'f0', ctx);
  const moved = p.slots.find((a, i) => a.id === 'stride' && p.slots.slice(0, i).some((x) => x.id === 'strike'));
  assert.ok(moved, JSON.stringify(p.slots.map((a) => a.id)));
  const end = moved.target.path.at(-1);
  assert.equal(end.x, 8, `into the low cover’s lee (${end.x},${end.y})`);
  const s = foePlan(at('storybook'), 'f0', ctx);
  assert.ok(!s.slots.some((a, i) => a.id === 'stride' && s.slots.slice(0, i).some((x) => x.id === 'strike')), 'Storybook: no cover play');
});

test('attack amounts never depend on what was scored before: Wick and Hearth Milo in either order, and a foe in either mode', () => {
  const amounts = (b, id, c) => {
    const u = findUnit(b, id);
    return attackOptions(b, u, c).map((o) => [o.action.ability || o.action.id, o.amount]);
  };
  const direct = (b, id, c) => {
    const u = findUnit(b, id);
    return attackOptions(b, u, c).map((o) => [o.action.ability || o.action.id, o.variant ? (abilityAmount(b, c, id, o.variant.a, { cost: o.variant.cost, choice: o.variant.choice, extra: 0, target: null, cheer: false })?.amount ?? 0) : o.amount]);
  };
  const room = roomsFor(world, { level: 3, room: 'moderate', partySize: 1, seed: 3, count: 1 })[0];
  const milo = (path) => [heroSpec(referenceState(['milo'], { paths: { milo: path } }), 'milo', { content: world.content, rules: world.rules, abilities: world.abilities, level: 3 })];
  const runs = [['wick', 'hearth'], ['hearth', 'wick']].map((order) => order.map((path) => {
    const heroes = milo(path);
    const c = ctxFor(world, heroes);
    const b = createBattle(room.fights[0], heroes, { roadLevel: 3 }, c);
    const got = amounts(b, 'milo', c);
    assert.deepEqual(got, direct(b, 'milo', c), `${path} Milo`);
    return [path, got];
  }));
  assert.deepEqual(Object.fromEntries(runs[0]), Object.fromEntries(runs[1]));
  assert.notDeepEqual(runs[0][0][1], runs[0][1][1], 'the paths do score differently');
  const heroes = milo('wick');
  const c = ctxFor(world, heroes);
  const foe = room.fights[0].foes.find((f) => f.side === 'foe').id;
  for (const mode of ['long-road', 'storybook', 'mauds-table', 'long-road']) {
    const b = createBattle(room.fights[0], heroes, { roadLevel: 3, mode }, c);
    assert.deepEqual(amounts(b, foe, c), direct(b, foe, c), mode);
  }
});

test('Storybook is plain and polite: every stray goes for the nearest, and nobody counters', () => {
  const foes = [stray('f0', { x: 10, y: 1, temperament: 'nosy' }), stray('f1', { x: 12, y: 3, talkKind: 'k1', temperament: 'proud' })];
  const b = createBattle(fightSpec({ foes }), [hero('claude'), hero('codex'), hero('milo')], { mode: 'storybook' }, ctx);
  for (const id of ['f0', 'f1']) {
    const u = findUnit(b, id);
    const t = foeTarget(b, u, ctx);
    const heroes = b.units.filter((v) => v.side === 'party' && v.rank === 'hero');
    const dist = (v) => Math.max(Math.abs(v.x - u.x), Math.abs(v.y - u.y));
    assert.equal(dist(t), Math.min(...heroes.map(dist)));
  }
});

// ---------------------------------------------------------------------------
// The scripted player and personalities

test('the scripted player patches the lowest under half, else strikes the weakest in reach, else closes in', () => {
  const real = realCtx({ abilityIndex: world.abilities });
  const [milo, tollkeeper, jev, claude] = partyAt(world, 1, 4);
  const foes = [stray('f0', { x: 5, y: 2, integrity: 10 }), stray('f1', { x: 6, y: 3, talkKind: 'k1' })];
  const b = createBattle(fightSpec({ foes }), [milo, claude], {}, real);
  // Nobody hurt: the Scribe's Full stop on the weakest in reach, twice, then a Brace.
  const p = scriptedPlan(b, 'claude', real);
  assert.deepEqual(p.slots.map((a) => a.id), ['use', 'use', 'brace']);
  assert.ok(p.slots.slice(0, 2).every((a) => a.target.unit === 'f0'));
  // Milo under half: she patches him first.
  const hurt = { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, integrity: 5 } : u)) };
  const q = scriptedPlan(hurt, 'claude', real);
  assert.equal(q.slots[0].id, 'use');
  const a = world.abilities.get(q.slots[0].ability);
  assert.ok(a && JSON.stringify(a).includes('"patch"'));
  // Nothing in reach: a melee hero closes in.
  const far = createBattle(fightSpec({ foes: [stray('f0', { x: 13, y: 4 })] }), [milo, tollkeeper], {}, real);
  const r = scriptedPlan(far, 'tollkeeper', real);
  assert.equal(r.slots[0].id, 'stride');
  assert.ok(jev);
});

test('every personality the companions name has a row, and a personality draft is its own Draft', () => {
  for (const file of Object.values(world.content.party.companions)) assert.ok(PERSONALITIES[file.personality], file.id);
  for (const p of Object.values(world.content.party.regulars.personalityByTemperament)) assert.ok(PERSONALITIES[p], p);
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2 })] }), party3(), {}, ctx);
  const d = personalityDraft(b, 'claude', ctx);
  assert.equal(d.confidence, 35);
  assert.equal(d.source, 'personality');
  assert.equal(d.plan.by, 'draft');
  assert.ok(d.why.every((w) => w.text));
});

// ---------------------------------------------------------------------------
// Improvising and the Minds B calls

test('improvising gives a legal action for a gone target or a blocked path, and B marks it', () => {
  const real = realCtx();
  const foes = [stray('f0', { x: 4, y: 2, integrity: 1, maxIntegrity: 20 }), stray('f1', { x: 6, y: 3, talkKind: 'k1' })];
  let b = createBattle(fightSpec({ foes }), [hero('milo'), hero('claude')], {}, real);
  const gone = { ...b, units: b.units.map((u) => (u.id === 'f0' ? { ...u, sorted: 'settled', integrity: 0 } : u)) };
  const alt = improvise(gone, 'claude', { id: 'strike', ability: null, cost: 1, target: { unit: 'f0' }, extra: 0, choice: null, cheer: false, trigger: null }, 'target-gone', real);
  assert.ok(alt);
  assert.notEqual(alt.target?.unit, 'f0');
  // In play: B emits improvise with the minds' answer.
  const plans = {
    milo: planOf('milo', [A.strideTo({ x: 3, y: 2 }), A.strike('f0'), A.brace()]),
    claude: planOf('claude', [A.brace(), A.delay(), A.strike('f0')]),
  };
  for (const [id, p] of Object.entries(plans)) b = apply(b, { t: 'plan', unitId: id, plan: p }, real).battle;
  b = apply(b, { t: 'commit' }, real).battle;
  const r = playRound(b, real);
  const imp = r.events.find((e) => e.t === 'improvise' && e.unit === 'claude');
  if (findUnit(r.battle, 'f0').sorted) assert.ok(imp || r.events.some((e) => e.t === 'lost' && e.unit === 'claude'));
});

test('the minds give B every hook, deterministically', () => {
  const minds = makeMinds(ctx);
  for (const k of ['foePlan', 'telegraphs', 'draft', 'situation', 'choices', 'improvise', 'revise', 'scriptedPlan']) assert.equal(typeof minds[k], 'function', k);
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 }), stray('f1', { x: 10, y: 3, talkKind: 'k1', genre: 'noir' })] }), party3(), {}, ctx);
  assert.deepEqual(minds.foePlan(b, 'f0'), minds.foePlan(b, 'f0'));
  assert.deepEqual(minds.draft(b, 'claude'), minds.draft(b, 'claude'));
  assert.equal(minds.situation(b, 'claude').length, 16);
  assert.equal(minds.revise(b, 'f0', 1), null, 'only leads feint');
});

// ---------------------------------------------------------------------------
// Fights end, and fast

test('1,000 seeded 3v3 fights with the real minds end within 10 rounds with no stuck state', () => {
  const ARCH = ['walker', 'crawler', 'floater', 'flier', 'ghost', 'construct'];
  const TEMPS = ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud'];
  const GEN = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];
  const real = realCtx({ abilityIndex: world.abilities });
  let over = 0;
  const outcomes = {};
  for (let seed = 0; seed < 1000; seed += 1) {
    const foes = [0, 1, 2].map((i) => {
      const archetype = ARCH[hashInts(seed, i, 'a') % ARCH.length];
      const genre = GEN[hashInts(seed, 'g') % GEN.length];
      const big = world.content.combat.rules.genres[genre].abilities;
      return stray(`f${i}`, {
        x: 9 + (hashInts(seed, i, 'x') % 5), y: 1 + (hashInts(seed, i, 'y') % 4), archetype, genre, temperament: TEMPS[hashInts(seed, i, 't') % TEMPS.length],
        talkKind: `k${i}`, abilityIds: [...(archetype === 'crawler' ? ['pounce'] : []), ...big], uses: Object.fromEntries(big.map((id) => [id, 1])),
      });
    });
    const b = createBattle(fightSpec({ foes, seed: hashInts(seed, 'fight'), genres: [foes[0].genres[0]] }), party3(), {}, real);
    const r = runToEnd(b, real, { maxRounds: 30 });
    outcomes[r.battle.status] = (outcomes[r.battle.status] || 0) + 1;
    assert.ok(TERMINAL.has(r.battle.status), `seed ${seed} ended ${r.battle.status}`);
    if (r.battle.round > 10) over += 1;
  }
  assert.equal(over, 0, `${over} fights went past round 10 (${JSON.stringify(outcomes)})`);
});

test('budgets: a fast-policy decision ≤ 0.3 ms and Tell me how it went ≤ 100 ms (medians)', () => {
  const snap = snapshots({ level: 3, count: 8, seed: 3 });
  const foeCalls = [];
  const heroCalls = [];
  for (const b of snap.battles) {
    for (const u of b.units) {
      if (u.side === 'foe' && !u.sorted) foeCalls.push([b, u.id]);
      if (u.side === 'party' && u.rank === 'hero' && !u.offline) heroCalls.push([b, u.id]);
    }
  }
  const foeMs = medianMs((i) => { const [b, id] = foeCalls[i % foeCalls.length]; foePlan(b, id, snap.ctx); }, { runs: 400 });
  const heroMs = medianMs((i) => { const [b, id] = heroCalls[i % heroCalls.length]; scriptedPlan(b, id, snap.ctx); }, { runs: 400 });
  assert.ok(foeMs <= 0.3, `a stray’s plan ${foeMs.toFixed(3)} ms`);
  assert.ok(heroMs <= 0.3, `the scripted player ${heroMs.toFixed(3)} ms`);
  const heroes = partyAt(world, 3, 4);
  const real = ctxFor(world, heroes);
  const rooms = roomsFor(world, { level: 3, room: 'moderate', partySize: 4, seed: 12, count: 30 });
  const fightMs = medianMs((i) => runToEnd(createBattle(rooms[i % rooms.length].fights[0], heroes, { roadLevel: 3 }, real), real), { warm: 5, runs: 30 });
  assert.ok(fightMs <= 100, `a whole fight ${fightMs.toFixed(1)} ms`);
  assert.ok(shareOf(heroes[0]) === 1);
});

// ---------------------------------------------------------------------------
// Tale-lead fights: working the room (H2, COMBAT §8.3). Real lead rooms (D's encounters, I's mechanics,
// untuned), the reference party at level 3; planning only, on frozen copies of the Battle.

const leadHeroes = partyAt(world, 3, 4);
const leadCtx = ctxFor(world, leadHeroes);
const leadBattles = (mechanic, count = 3, { level = 3, seed = 0x7e5 } = {}) => roomsFor(world, { level, room: 'lead', partySize: 4, seed, count, mechanic })
  .map((r) => createBattle(r.fights[0], leadHeroes, { roadLevel: level }, leadCtx));
const heroesIn = (b) => b.units.filter((u) => u.side === 'party' && u.rank === 'hero').sort((p, q) => b.order.indexOf(p.id) - b.order.indexOf(q.id));
/** A frozen copy of a Battle with some units and the lead's state changed, for planning. */
function tweak(b, units = {}, lead = null) {
  return Object.freeze({
    ...b,
    units: Object.freeze(b.units.map((u) => (units[u.id] ? Object.freeze({ ...u, ...units[u.id] }) : u))),
    ...(lead ? { lead: Object.freeze({ ...b.lead, ...lead }) } : {}),
  });
}
const interactsWith = (plan, id) => plan.slots.filter((a) => a.id === 'interact' && a.target?.object === id).length;
const endOf = (a) => (a?.id === 'stride' && a.target?.path?.length ? a.target.path[a.target.path.length - 1] : null);
const hitOf = (u) => (u.strike?.amount || 0) + (u.keyAdjust || 0) + (u.flat || 0);
const WORKED = ['throttles-speed', 'streetlights-out', 'snuffs-candles', 'assembly-lines', 'alibis'];
const floorAt = (b, t) => b.arena.cells[(t.y - b.arena.rect.y) * b.arena.rect.w + (t.x - b.arena.rect.x)] === '.';

test('a lead’s room is shared out: one hero an object, at most half the party (all of it for the junctions), and the hardest hitter keeps fighting', () => {
  let seen = 0;
  for (const m of WORKED) {
    for (const b of leadBattles(m)) {
      const objs = leadObjects(b);
      const jobs = roomJobs(b);
      assert.ok(objs.length > 0, `${m}: something to work`);
      const ids = [...jobs.values()].map((o) => o.id);
      assert.equal(new Set(ids).size, ids.length, `${m}: one hero an object`);
      for (const o of jobs.values()) assert.ok(objs.includes(o), `${m}: only what’s worth working`);
      const heroes = heroesIn(b);
      if (m === 'throttles-speed') assert.equal(jobs.size, Math.min(heroes.length, objs.length), 'every junction has a hero');
      else {
        assert.ok(jobs.size >= 1 && jobs.size <= Math.ceil(heroes.length / 2), `${m}: ${jobs.size} at work`);
        const hitter = heroes.reduce((best, h) => (hitOf(h) > hitOf(best) ? h : best), heroes[0]);
        assert.ok(!jobs.has(hitter.id), `${m}: ${hitter.id} keeps fighting`);
      }
      seen += 1;
    }
  }
  assert.equal(seen, 15);
  // Nothing to work outside a lead fight, or in the fallback's room.
  const stray0 = createBattle(roomsFor(world, { level: 3, room: 'moderate', partySize: 4, seed: 5, count: 1 })[0].fights[0], leadHeroes, { roadLevel: 3 }, leadCtx);
  assert.deepEqual(leadObjects(stray0), []);
  assert.equal(roomJobs(stray0).size, 0);
  assert.equal(leadWork(stray0, 'milo', leadCtx, { left: 3 }), null);
  for (const b of leadBattles('fallback', 2)) assert.equal(roomJobs(b).size, 0);
});

test('a hero with a job works it: the scripted player’s first action reaches or works it, the draft’s turn does too, and nothing is worked twice in a turn', () => {
  let jobs = 0;
  for (const m of WORKED) {
    for (const b of leadBattles(m, 2)) {
      for (const [id, o] of roomJobs(b)) {
        const u = findUnit(b, id);
        const d0 = unitDist(u, o);
        const works = (a) => (a.id === 'interact' && a.target?.object === o.id) || (a.id === 'use' && a.ability === 'mech:pull-the-lever' && a.cost === 2)
          || (endOf(a) && unitDist({ ...endOf(a), size: u.size || 1 }, o) < d0);
        const scripted = scriptedPlan(b, id, leadCtx);
        assert.ok(scripted.slots[0] && works(scripted.slots[0]), `${m} ${id}: ${JSON.stringify(scripted.slots[0])}`);
        const draft = personalityDraft(b, id, leadCtx).plan;
        assert.ok(draft.slots.some(works), `${m} ${id}: the draft works the ${o.kind}`);
        for (const p of [scripted, draft]) assert.ok(interactsWith(p, o.id) <= 1, `${m} ${id}: once a turn`);
        jobs += 1;
      }
    }
  }
  assert.ok(jobs >= 12, `${jobs} jobs`);
});

test('alibis: clues are found only as far as they’re needed, and an alibi is worked only with evidence in hand', () => {
  const b = leadBattles('alibis', 1)[0];
  assert.equal(b.objects.filter((o) => o.kind === 'alibi' && o.state === 'standing').length, 3);
  assert.deepEqual(leadObjects(b).map((o) => o.kind), ['clue', 'clue', 'clue']);
  assert.deepEqual(leadObjects(tweak(b, {}, { data: { ...b.lead.data, e: 1 } })).map((o) => o.kind).sort(), ['alibi', 'clue', 'clue']);
});

test('stomps: a hero on this round’s stomp steps off it first, and no hero’s stride ends on one', () => {
  let moved = 0;
  for (const b0 of leadBattles('stomps', 3)) {
    const tiles = stompTiles(b0);
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const taken = new Set(b0.units.map((u) => `${u.x},${u.y}`));
    const h = heroesIn(b0).find((u) => !u.moves?.flies && !u.moves?.hovers);
    const spot = set.has(`${h.x},${h.y}`) ? { x: h.x, y: h.y }
      : tiles.find((t) => !taken.has(`${t.x},${t.y}`) && !b0.objects.some((o) => o.x === t.x && o.y === t.y) && floorAt(b0, t) && unitDist(t, findUnit(b0, 'lead')) > 2);
    const b = tweak(b0, { [h.id]: spot });
    assert.equal(onStomp(b, findUnit(b, h.id), leadCtx), true);
    for (const plan of [scriptedPlan(b, h.id, leadCtx), personalityDraft(b, h.id, leadCtx).plan]) {
      const end = endOf(plan.slots[0]);
      assert.ok(end, `${h.id} strides first: ${JSON.stringify(plan.slots[0])}`);
      assert.ok(!set.has(`${end.x},${end.y}`), `${h.id} ends off the stomp`);
      moved += 1;
    }
    for (const u of heroesIn(b).filter((v) => !v.moves?.flies && !v.moves?.hovers)) {
      for (const plan of [scriptedPlan(b, u.id, leadCtx), personalityDraft(b, u.id, leadCtx).plan]) {
        for (const a of plan.slots) if (endOf(a)) assert.ok(!set.has(`${endOf(a).x},${endOf(a).y}`), `${u.id}’s stride ends off the stomp`);
      }
    }
  }
  assert.equal(moved, 6);
});

test('too big to see: one hero Examines it, then one names a step each round (2 actions)', () => {
  for (const b of leadBattles('too-big-to-see', 3)) {
    const heroes = heroesIn(b).map((u) => u.id);
    const examines = (plans) => plans.filter((p) => p.slots.some((a) => a.id === 'examine' && a.target?.unit === 'lead')).length;
    assert.equal(examines(heroes.map((id) => scriptedPlan(b, id, leadCtx))), 1);
    assert.equal(examines(heroes.map((id) => personalityDraft(b, id, leadCtx).plan)), 1);
    const seen = tweak(b, { lead: { examined: true } });
    const steps = (plans) => plans.flatMap((p) => p.slots).filter((a) => a.id === 'use' && a.ability === 'mech:name-a-step');
    for (const list of [steps(heroes.map((id) => scriptedPlan(seen, id, leadCtx))), steps(heroes.map((id) => personalityDraft(seen, id, leadCtx).plan))]) {
      assert.equal(list.length, 1);
      assert.equal(list[0].cost, 2);
    }
  }
});

test('the noon duel’s winner holsters, and nobody else tries', () => {
  for (const b0 of leadBattles('noon-duel', 2)) {
    const winner = heroesIn(b0)[1].id;
    const b = tweak(b0, {}, { phase: 'last-page', bar: b0.lead.bars.length - 1, data: { ...b0.lead.data, w: winner, h: 0 } });
    const holsters = (p) => p.slots.filter((a) => a.ability === 'mech:holster').length;
    for (const u of heroesIn(b)) {
      const scripted = scriptedPlan(b, u.id, leadCtx);
      assert.equal(holsters(scripted), u.id === winner ? 1 : 0, `${u.id} scripted`);
      assert.equal(holsters(personalityDraft(b, u.id, leadCtx).plan), u.id === winner ? 1 : 0, `${u.id} draft`);
      if (u.id === winner) assert.equal(scripted.slots[0].ability, 'mech:holster');
    }
  }
});

test('in a lead fight the nearest hero walks to one who’s offline to Reboot them, Slowed or not', () => {
  let checked = 0;
  for (const b0 of leadBattles('fallback', 4)) {
    const heroes = heroesIn(b0);
    // The last hero on the ribbon went offline 4 to 6 tiles from the nearest of the others, on open floor.
    const last = heroes[heroes.length - 1];
    const up = heroes.filter((w) => w.id !== last.id);
    const taken = new Set(b0.units.map((u) => `${u.x},${u.y}`));
    const { rect } = b0.arena;
    let spot = null;
    for (let y = rect.y; y < rect.y + rect.h && !spot; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w && !spot; x += 1) {
        const t = { x, y };
        const d = Math.min(...up.map((w) => unitDist(w, t)));
        if (d >= 4 && d <= 6 && floorAt(b0, t) && !taken.has(`${x},${y}`) && !b0.objects.some((o) => o.x === x && o.y === y)) spot = t;
      }
    }
    if (!spot) continue;
    const down = { ...last, ...spot };
    const near = up.reduce((best, w) => (unitDist(w, down) < unitDist(best, down) ? w : best), up[0]);
    for (const slowed of [false, true]) {
      const units = { [down.id]: { ...spot, offline: true, integrity: 0, drops: 0 } };
      if (slowed) units[near.id] = { conditions: [...(near.conditions || []), { id: 'slowed', n: 1, source: 'lead', data: null }] };
      const b = tweak(b0, units);
      for (const first of [scriptedPlan(b, near.id, leadCtx).slots[0], personalityDraft(b, near.id, leadCtx).plan.slots[0]]) {
        assert.ok(endOf(first) && unitDist({ ...endOf(first), size: near.size || 1 }, down) < unitDist(near, down), `${near.id} walks toward ${down.id}${slowed ? ' (Slowed)' : ''}: ${JSON.stringify(first)}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 2, `${checked} cases`);
});

test('a hero goes for the lead’s helpers first when one is in reach; elsewhere the list is left alone', () => {
  const lead = { id: 'lead', rank: 'lead' };
  const helper = { id: 'f0', rank: 'stray' };
  const inLead = { lead: { unitId: 'lead' } };
  assert.deepEqual(helpersFirst(inLead, [lead, helper]), [helper]);
  assert.deepEqual(helpersFirst(inLead, [lead]), [lead]);
  assert.deepEqual(helpersFirst({ lead: null }, [lead, helper]), [lead, helper]);
  // Real rooms: the Tollkeeper beside the helper strikes it before the lead.
  let checked = 0;
  for (const b0 of leadBattles('fallback', 4)) {
    const f = b0.units.find((u) => u.side === 'foe' && u.id !== 'lead' && !u.sorted);
    if (!f) continue;
    const taken = new Set(b0.units.map((u) => `${u.x},${u.y}`));
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: f.x + dx, y: f.y + dy }))
      .find((t) => !taken.has(`${t.x},${t.y}`) && floorAt(b0, t) && !b0.objects.some((o) => o.x === t.x && o.y === t.y));
    if (!spot) continue;
    const b = tweak(b0, { tollkeeper: spot });
    const hit = scriptedPlan(b, 'tollkeeper', leadCtx).slots.find((a) => a.id === 'strike' || (a.id === 'use' && a.target?.unit));
    assert.equal(hit?.target?.unit, f.id);
    checked += 1;
  }
  assert.ok(checked >= 1);
});

test('against a Tale-lead every personality keeps to two attacks, Braces even when hot, and one Examine does for the party', () => {
  const hostile = (b, a) => a.id === 'strike' || a.id === 'throw' || (a.id === 'use' && b.units.some((v) => v.side === 'foe' && v.id === a.target?.unit));
  let most = 0;
  let oneLook = 0;
  for (const m of ['fallback', 'noon-duel', 'stomps']) {
    for (const b0 of leadBattles(m, 3)) {
      const b = tweak(b0, Object.fromEntries(heroesIn(b0).map((u) => [u.id, { heat: 70 }])));
      for (const u of heroesIn(b)) {
        const n = personalityDraft(b, u.id, leadCtx).plan.slots.filter((a) => hostile(b, a)).length;
        most = Math.max(most, n);
        assert.ok(n <= 2, `${m} ${u.id}: ${n} attacks`);
      }
      if (heroesIn(b0).filter((u) => personalityDraft(b0, u.id, leadCtx).plan.slots.some((a) => a.id === 'examine')).length <= 1) oneLook += 1;
    }
  }
  assert.equal(most, 2);
  assert.equal(oneLook, 9);
  // A stray room is as before: a hot hero presses on to a third attack when it can.
  const snap = snapshots({ level: 3, count: 6, seed: 21 });
  let three = 0;
  for (const b0 of snap.battles) {
    const b = tweak(b0, Object.fromEntries(heroesIn(b0).map((u) => [u.id, { heat: 70 }])));
    for (const u of heroesIn(b)) if (personalityDraft(b, u.id, snap.ctx).plan.slots.filter((a) => hostile(b, a)).length >= 3) three += 1;
  }
  assert.ok(three > 0, 'somebody hot makes a third attack in a stray room');
});

test('against a Tale-lead a guard steps beside the ally in danger only where it can still strike, never out of reach', () => {
  // The first lead's rooms (three heroes at level 1): the Tollkeeper guards the others. Before §18.3's
  // 35% rule put personality in more slots, he could stride beside Jev out of the lead's reach and stride back.
  const heroes = partyAt(world, 1, 3);
  const ctx = ctxFor(world, heroes);
  let moved = 0;
  for (const r of roomsFor(world, { level: 1, room: 'lead', partySize: 3, seed: 0xf1257, count: 60 })) {
    const b = createBattle(r.fights[0], heroes, { roadLevel: 1, firstLead: true }, ctx);
    const u = findUnit(b, 'tollkeeper');
    const reach = (at) => b.units.some((v) => v.side === 'foe' && !v.sorted && v.integrity > 0 && unitDist(at, v) <= Math.max(1, at.strike?.range || 0));
    if (!u || !reach(u)) continue;
    const first = personalityDraft(b, 'tollkeeper', ctx).plan.slots[0];
    if (first?.id !== 'stride') continue;
    moved += 1;
    const end = first.target.path.at(-1);
    assert.ok(reach({ ...u, x: end.x, y: end.y }), `${r.fights[0].id}: from (${u.x},${u.y}) to (${end.x},${end.y})`);
  }
  assert.ok(moved > 0, 'some guards moved');
});

test('budget: the scripted player in a lead fight still decides in ≤ 0.3 ms (median)', () => {
  const calls = [];
  for (const m of ['fallback', ...WORKED, 'too-big-to-see', 'noon-duel', 'stomps']) for (const b of leadBattles(m, 2)) for (const u of heroesIn(b)) calls.push([b, u.id]);
  const ms = medianMs((i) => { const [b, id] = calls[i % calls.length]; scriptedPlan(b, id, leadCtx); }, { runs: 400 });
  assert.ok(ms <= 0.3, `${ms.toFixed(3)} ms`);
});
