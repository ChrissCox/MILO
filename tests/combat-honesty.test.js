// The odds shown are the odds used (src/combat/battle.js oddsFor and the kernel's picks;
// CONTRACT-PHASE4.md §1, §5.7, §13 wave 1 B): every pick's bars equal oddsFor computed on the
// Battle just before its action (a use's picks all read the Battle as the use began), folds included
// (Cheers, helpful, Being sure, plot armour, Kind noise); every degree lands where its k draw says;
// and over 100,000 seeded picks each degree's share is within 0.5 points of its bar.
//   node --test tests/combat-honesty.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pick, draw, degreeAt, BANDS, shiftBars, foldBars } from '../src/combat/heat.js';
import { TERMINAL } from '../src/combat/battle.js';
import { noiseGenres } from '../src/combat/round.js';
import { oddsByTarget, buildAbilityIndex } from '../src/combat/abilities.js';
import { hero, stray, fightSpec, makeCtx, createBattle, apply, A, seedAt, ab, ABILITIES } from './combat-kit.js';

const GENRES = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];

function fightFor(i) {
  const seed = seedAt(40000 + i);
  const g = GENRES[i % GENRES.length];
  const genres = i % 7 === 0 ? [g, 'starlight'] : [g];
  const foes = [
    stray('f0', { x: 10, y: 1, genre: g }),
    stray('f1', { x: 11, y: 2, genre: g, archetype: 'crawler', temperament: 'curious', talkKind: 'k1' }),
    stray('f2', { x: 12, y: 3, genre: g, archetype: i % 2 ? 'construct' : 'ghost', talkKind: 'k2' }),
  ];
  let leadUnit = null;
  if (i % 4 === 0) {
    leadUnit = stray('lead', { x: 12, y: 1, genre: g, talkKind: null, name: 'Madame Voss' });
    leadUnit.rank = 'lead';
    leadUnit.size = 2;
    leadUnit.attackEdge = 1;
    leadUnit.flat = 2;
    leadUnit.lead = { mechanic: 'fallback', phases: 2, bars: [10, 10], quote: 'Not today.' };
  }
  return fightSpec({ seed, genres, foes, leadUnit, kind: leadUnit ? 'lead' : 'room' });
}

/**
 * Heroes' plans that exercise the folds (Cheers, Being sure, Inkdarts, helpful patches, Brace) and
 * the abilities that Strike through `act`: a weapon art, Volley over an area, and a move that opens
 * with Being sure on its own user.
 */
function heroPlans(b, ctx, i) {
  const out = {};
  const foes = b.units.filter((u) => u.side === 'foe' && !u.sorted);
  for (const u of b.units) {
    if (u.side !== 'party' || u.rank !== 'hero' || u.offline) continue;
    const d = ctx.minds.draft(b, u.id);
    const firstStrike = d.plan.slots.findIndex((a) => a.id === 'strike');
    let slots = d.plan.slots.map((a, s) => ({ ...a, cheer: s === firstStrike && (i + b.round) % 3 === 0 && b.cheers > 0 && u.id === 'milo' }));
    if (u.id === 'claude' && foes.length) {
      const f = foes[(b.round + i) % foes.length];
      slots = (b.round + i) % 3 === 0
        ? [{ ...A.use('being-sure', { unit: 'milo' }) }, ...slots.slice(0, 2)]
        : (b.round + i) % 3 === 1 ? [A.use('inkdarts', { unit: f.id }, { cost: 2 }), A.brace()] : [A.use('draft', { unit: f.id }), ...slots.slice(0, 2)];
    }
    if (u.id === 'codex' && foes.length) {
      const f = foes[(b.round + i) % foes.length];
      const near = foes.find((v) => Math.max(Math.abs(v.x - u.x), Math.abs(v.y - u.y)) <= 1);
      const which = (b.round + i) % 3;
      if (which === 0 && near) slots = [A.use('pommel-tap', { unit: near.id }), ...slots.slice(0, 2)];
      else if (which === 1) slots = [A.use('volley', { tile: { x: f.x, y: f.y } }, { cost: 2 }), ...slots.slice(0, 1)];
      else slots = [A.use('snap-trick', { unit: f.id }), ...slots.slice(0, 2)];
    }
    if (u.id === 'codex' && u.integrity < u.maxIntegrity) slots = [A.brace(), ...slots.slice(0, 2)];
    out[u.id] = { unitId: u.id, slots, reactions: {}, by: 'you', changed: slots.map(() => true) };
  }
  return out;
}

test('every pick uses exactly the bars oddsFor shows just before it, and lands where its k draw says', (t) => {
  const ctx = makeCtx();
  let compared = 0;
  let folds = { cheer: 0, sure: 0, armour: 0, kind: 0, helpful: 0, act: 0 };
  let allPicks = 0;
  for (let i = 0; i < 300; i += 1) {
    const fight = fightFor(i);
    const codex = hero('codex', {
      abilityIds: [...hero('codex').abilityIds, 'pommel-tap', 'volley', 'snap-trick'], uses: { 'pommel-tap': 99 },
      strike: { amount: 7, kind: 'spark', reach: 1, range: 12, weapon: 'ranged' },
    });
    let b = createBattle(fight, [hero('milo'), hero('claude', { charges: { pool: 'full', max: 6, left: 6, circle: 1 } }), codex], { cheers: 2, mode: ['long-road', 'mauds-table', 'storybook'][i % 3] }, ctx);
    let guard = 0;
    while (!TERMINAL.has(b.status) && guard < 400) {
      guard += 1;
      if (b.status === 'planning') {
        const plans = heroPlans(b, ctx, i);
        for (const [id, p] of Object.entries(plans)) b = apply(b, { t: 'plan', unitId: id, plan: p }, ctx).battle;
        b = apply(b, { t: 'commit' }, ctx).battle;
        continue;
      }
      if (b.status === 'asking') {
        b = apply(b, { t: 'answer', yes: true }, ctx).battle;
        continue;
      }
      const entry = b.schedule[b.cursor];
      const before = b;
      const r = apply(b, { t: 'step' }, ctx);
      b = r.battle;
      for (const e of r.events) {
        if (e.t !== 'outcome' || e.by) continue;
        allPicks += 1;
        assert.equal(e.degree, pick(before.seed, before.attempt, e.k, e.bars), 'the degree is where the k draw lands');
      }
      if (!entry || r.events.some((e) => e.t === 'improvise' || e.t === 'lost')) continue;
      const action = before.plans[entry.unitId]?.slots?.[entry.slot];
      if (!action) continue;
      const shown = oddsByTarget(before, entry.unitId, action, ctx, { slot: entry.slot, plan: before.plans[entry.unitId] });
      const reactors = new Set(r.events.filter((e) => e.t === 'reaction').map((e) => e.unit));
      const mine = r.events.filter((e) => e.t === 'outcome' && !e.by && e.unit === entry.unitId && !reactors.has(e.unit));
      if (r.events.some((e) => e.t === 'reaction' && e.id === 'draw-the-blow')) continue;
      // Each pick against the row shown for its target (rows for one target are used in order; a
      // split's pieces all use its one row).
      const rows = new Map();
      for (const row of shown) rows.set(row.targetId, [...(rows.get(row.targetId) || []), row.odds]);
      const seen = new Map();
      for (const e of mine) {
        const target = e.target ?? null;
        const list = rows.get(target) || [];
        const n = seen.get(target) || 0;
        seen.set(target, n + 1);
        const o = list[Math.min(n, list.length - 1)];
        assert.ok(o, `odds were shown for ${action.id} ${action.ability || ''} on ${target}`);
        assert.deepEqual(e.bars, o.bars, `${entry.unitId} ${action.id} ${action.ability || ''} → ${target}`);
        compared += 1;
        if (action.id === 'use' && (ctx.abilities.get(action.ability)?.effects || []).some((x) => x.do === 'act')) folds.act += 1;
        if (o.cheer) folds.cheer += 1;
        if (o.helpful) folds.helpful += 1;
        // The other folds, counted per compared pick that had them (§5.7).
        const actor = before.units.find((u) => u.id === entry.unitId);
        const on = before.units.find((u) => u.id === target);
        const foe = !!on && on.side !== actor.side;
        if (noiseGenres(before, ctx.rules).includes('starlight')) folds.kind += 1;
        if (foe && ((actor.mods || []).some((m) => m.stat === 'degree-next-on-foe') || action.ability === 'snap-trick')) folds.sure += 1;
        if (target === 'lead' && before.lead && !before.lead.armourUsed && action.ability === 'draft') folds.armour += 1;
      }
    }
    assert.ok(TERMINAL.has(b.status), `fight ${i} ended`);
  }
  t.diagnostic(`compared ${compared} of ${allPicks} picks; ${JSON.stringify(folds)}`);
  assert.ok(compared > 5000, `compared ${compared} of ${allPicks} picks`);
  assert.ok(folds.cheer > 0 && folds.helpful > 0 && folds.act > 300, JSON.stringify(folds));
  assert.ok(folds.kind > 100 && folds.sure > 10 && folds.armour > 10, `each fold met in compared picks: ${JSON.stringify(folds)}`);
});

test('a use’s picks all read the battle as it began: a creature’s cover holds though an earlier pick sorts it, Pounce strikes and Into the shadows hides with the rows shown before they move', () => {
  const twin = ab({ id: 'twin-darts', kind: 'knack', attack: true, meets: 'guard', target: { who: 'foe', range: 8, count: 2 }, effects: [{ do: 'damage', line: 'one', kind: 'ink' }] });
  const ctx = makeCtx({ foePlan: () => ({ slots: [] }), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, twin] } }) });
  const picksOf = (b, id, action) => {
    const p = { unitId: id, slots: [action], reactions: {}, by: 'you', changed: [false] };
    const shown = oddsByTarget(b, id, action, ctx, { slot: 0, plan: p });
    let x = apply(apply(b, { t: 'plan', unitId: id, plan: p }, ctx).battle, { t: 'commit' }, ctx).battle;
    const events = [];
    for (let guard = 0; x.status === 'running' && guard < 50; guard += 1) {
      const r = apply(x, { t: 'step' }, ctx);
      events.push(...r.events);
      x = r.battle;
    }
    return { shown, events, used: events.filter((e) => e.t === 'outcome' && e.unit === id && !e.by) };
  };
  // A Volley (Strikes through `act`) and two darts (the use's own picks) at a beetle behind a nearly
  // sorted one: the near one gives the far one low cover.
  const uses = [['volley', A.use('volley', { tile: { x: 7, y: 2 } }, { cost: 2 })], ['twin-darts', A.use('twin-darts', { units: ['f0', 'f1'] })]];
  for (const [id, action] of uses) {
    let kept = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const foes = [stray('f0', { x: 6, y: 2, integrity: 1, maxIntegrity: 20, genre: 'gothic' }), stray('f1', { x: 7, y: 2, genre: 'gothic', talkKind: 'k1' })];
      const fight = fightSpec({ seed, genres: ['gothic'], foes, arenaOpts: { entry: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 2 }] } });
      const codex = hero('codex', { abilityIds: ['volley', 'twin-darts'], strike: { amount: 7, kind: 'spark', reach: 1, range: 12, weapon: 'ranged' } });
      const b = createBattle(fight, [hero('milo'), hero('claude'), codex], { calm: { noise: false, adaptation: true } }, ctx);
      const { shown, events, used } = picksOf(b, 'codex', action);
      assert.equal(shown.find((r) => r.targetId === 'f1').odds.parts.find((p) => p.why === 'low cover')?.n, -1, 'the near beetle is cover');
      assert.deepEqual(used.map((e) => e.target), ['f0', 'f1']);
      for (const e of used) assert.deepEqual(e.bars, shown.find((r) => r.targetId === e.target).odds.bars, `${id}, seed ${seed}: ${e.target}`);
      const sortedAt = events.findIndex((e) => e.t === 'sorted' && e.unit === 'f0');
      if (sortedAt >= 0 && sortedAt < events.indexOf(used[1])) kept += 1;
    }
    assert.ok(kept > 10, `${id}: the cover counted though its creature was sorted first (${kept} of 40)`);
  }
  // Pounce from behind low cover: its Strike picks with the row the planner showed (cover −1, from
  // where Milo started), though the stride ends beside the beetle with the cover no longer between them.
  const rows = ['################', '#..............#', '#....o.........#', '#..............#', '#..............#', '################'];
  for (let seed = 1; seed <= 20; seed += 1) {
    const fight = fightSpec({ seed, arenaRows: rows, arenaOpts: { entry: [{ x: 1, y: 2 }] }, foes: [stray('f0', { x: 6, y: 2, integrity: 60, maxIntegrity: 60 })] });
    const b = createBattle(fight, [hero('milo', { abilityIds: ['pounce'] })], { calm: { noise: false, adaptation: true } }, ctx);
    const { shown, events, used } = picksOf(b, 'milo', A.use('pounce', { unit: 'f0' }, { cost: 2 }));
    assert.equal(shown.length, 1);
    assert.equal(shown[0].odds.parts.find((p) => p.why === 'low cover')?.n, -1);
    assert.ok(events.some((e) => e.t === 'move' && e.unit === 'milo'), 'it strides in first');
    assert.deepEqual(used.map((e) => e.bars), [shown[0].odds.bars], `seed ${seed}`);
  }
  // Into the shadows: its Hide picks with the row shown before its step, against the watcher who saw
  // it then, though the step takes it out of that watcher's sight behind a pillar.
  const pillar = ['################', '#..............#', '#..............#', '#............O.#', '#..............#', '################'];
  const shade = [...Array(6)].map((_, y) => [...Array(16)].map((__, x) => (x === 13 && y === 2 ? 'D' : 'L')).join(''));
  for (let seed = 1; seed <= 20; seed += 1) {
    const fight = fightSpec({ seed, arenaRows: pillar, arenaOpts: { lights: shade }, foes: [stray('f0', { x: 12, y: 4, resolve: { body: 0, mind: 2 } })] });
    const made = createBattle(fight, [hero('milo'), hero('pip', { abilityIds: ['into-the-shadows'] })], { calm: { noise: false, adaptation: true } }, ctx);
    const b = { ...made, units: made.units.map((u) => (u.id === 'pip' ? { ...u, x: 12, y: 2 } : u)) };
    const { shown, events, used } = picksOf(b, 'pip', A.use('into-the-shadows', null));
    assert.equal(shown[0]?.odds.parts.find((p) => p.why === 'Resolve 2')?.n, -2, 'the watcher’s mind Resolve 2');
    assert.ok(events.some((e) => e.t === 'move' && e.unit === 'pip'), 'it steps first');
    assert.deepEqual(used.map((e) => e.bars), [shown[0].odds.bars], `seed ${seed}`);
  }
});

test('over 100,000 seeded picks from the bars the planner shows, each degree’s share is within 0.5 points of its bar', () => {
  // The bars a planner shows across every band and edge, with each fold of §5.7.
  const shown = [];
  for (const band of ['cool', 'warm', 'hot']) {
    for (let edge = -3; edge <= 3; edge += 1) {
      const bars = shiftBars(BANDS[band], edge);
      shown.push(bars, foldBars(bars, { kind: true }), foldBars(bars, { helpful: true }), foldBars(bars, { cheer: true }), foldBars(bars, { sure: true }), foldBars(bars, { armour: true }));
    }
  }
  const N = 100000;
  const counts = [0, 0, 0, 0];
  const expectedShare = [0, 0, 0, 0];
  const names = ['crit', 'hit', 'graze', 'miss'];
  for (let k = 0; k < N; k += 1) {
    const bars = shown[k % shown.length];
    const degree = degreeAt(draw(777, 0, k), bars);
    counts[names.indexOf(degree)] += 1;
    for (let j = 0; j < 4; j += 1) expectedShare[j] += bars[j] / 100;
  }
  for (let j = 0; j < 4; j += 1) {
    const got = (100 * counts[j]) / N;
    const want = (100 * expectedShare[j]) / N;
    assert.ok(Math.abs(got - want) <= 0.5, `${names[j]}: ${got.toFixed(2)} vs ${want.toFixed(2)}`);
  }
  // And per bar set, with enough samples each.
  for (const bars of [BANDS.cool, BANDS.warm, BANDS.hot, [20, 35, 15, 30]]) {
    const c = [0, 0, 0, 0];
    for (let k = 0; k < N; k += 1) c[names.indexOf(pick(31337, 2, k, bars))] += 1;
    c.forEach((n, j) => assert.ok(Math.abs((100 * n) / N - bars[j]) <= 0.5, `${bars}: ${names[j]}`));
  }
});
