// The round (src/combat/round.js; CONTRACT-PHASE4.md §4.16, §5.5, §7.1): ticks, the schedule in
// ribbon order, each of the nine genre noise rules, per-actor independence, the exemptions for a
// Reboot and an urgent patch, the banner, and plain telegraphs.
//   node --test tests/combat-round.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashInts, unit } from '../src/world/rng.js';
import { draw } from '../src/combat/heat.js';
import { ticksOf, schedule, noiseBanner, plainTelegraphs, noiseGenres } from '../src/combat/round.js';
import { oddsFor } from '../src/combat/battle.js';
import { rules, hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit } from './combat-kit.js';

const bare = { conditions: [], mods: [] };

test('ticksOf: t starts at 1, Delay waits a tick, a 2-action activity resolves at the end of its last tick, and what won’t fit is lost', () => {
  const p = (slots) => plan('x', slots);
  assert.deepEqual(ticksOf(p([A.brace(), A.brace(), A.brace()]), bare).map((t) => [t.tick, t.ends, t.lost]), [[1, 1, null], [2, 2, null], [3, 3, null]]);
  assert.deepEqual(ticksOf(p([A.delay(), A.brace(), A.brace()]), bare).map((t) => [t.ends, t.lost]), [[null, null], [2, null], [3, null]]);
  assert.deepEqual(ticksOf(p([A.delay(), A.brace(), A.brace(), A.brace()]), bare).map((t) => t.lost), [null, null, null, 'wont-fit']);
  assert.deepEqual(ticksOf(p([A.brace(), A.reboot('milo')]), bare).map((t) => [t.tick, t.ends]), [[1, 1], [2, 3]]);
  assert.deepEqual(ticksOf(p([A.brace(), A.brace(), A.reboot('milo')]), bare).map((t) => t.lost), [null, null, 'wont-fit']);
  assert.deepEqual(ticksOf(p([A.ready('foe-enters-reach'), A.strike('f0')]), bare).map((t) => [t.ends, !!t.readied]), [[2, false], [null, true]]);
  assert.deepEqual(ticksOf(p([A.brace(), A.brace(), A.brace()]), { conditions: [], mods: [{ stat: 'surprised', by: 1, until: 'end-of-round' }] }).map((t) => t.lost), ['asleep', 'asleep', 'asleep']);
  assert.deepEqual(ticksOf(p([A.brace(), A.brace(), A.brace()]), { conditions: [{ id: 'slowed', n: 2, data: null }], mods: [] }).map((t) => t.lost), [null, 'slowed', 'slowed']);
  assert.deepEqual(ticksOf(p([A.brace(), A.brace(), A.brace()]), { conditions: [{ id: 'slowed', n: 1, data: { fresh: true } }], mods: [] }).map((t) => t.lost), [null, null, null], 'a condition landed mid-round waits for the next');
});

test('the schedule plays each tick in ribbon order with noise off', () => {
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 1 }), stray('f1', { x: 12, y: 3, talkKind: 'k1' })] }), [hero('milo'), hero('claude')], { calm: { noise: false, adaptation: true } }, ctx);
  const planned = play(b, [
    { t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace(), A.brace(), A.brace()]) },
    { t: 'plan', unitId: 'claude', plan: plan('claude', [A.brace(), A.brace(), A.brace()]) },
  ], ctx).battle;
  const s = schedule(planned, ctx);
  for (let t = 1; t <= 3; t += 1) {
    const ids = s.filter((e) => e.tick === t).map((e) => e.unitId);
    assert.deepEqual(ids, planned.order.filter((id) => ids.includes(id)), `tick ${t} in ribbon order`);
  }
  assert.ok(s.every((e) => e.late === false));
  assert.equal(noiseBanner(planned), null, 'no banner with noise off');
});

// ---------- noise, rule by rule ----------

function noisyRound(genres, seed, { heroes = [hero('milo'), hero('claude'), hero('codex')], foes = null, plans = null, mode = 'long-road', ctx = null } = {}) {
  const c = ctx || makeCtx({ foePlan: (b, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
  const f = foes || [stray('f0', { x: 12, y: 1, genre: genres[0] }), stray('f1', { x: 12, y: 3, genre: genres[0], talkKind: 'k1' }), stray('f2', { x: 13, y: 2, genre: genres[0], talkKind: 'k2' })];
  const b = createBattle(fightSpec({ seed, genres, foes: f }), heroes, { mode }, c);
  const cmds = heroes.map((h) => ({ t: 'plan', unitId: h.id, plan: plans?.[h.id] || plan(h.id, [A.brace(), A.brace(), A.brace()]) }));
  return { ...play(b, [...cmds, { t: 'commit' }], c), ctx: c };
}

test('Neon lag: about 1 action in 5 lands a tick late, after every other action of the next tick', () => {
  let total = 0;
  let late = 0;
  for (let s = 1; s <= 300; s += 1) {
    const { battle } = noisyRound(['neon'], s);
    for (const e of battle.schedule) {
      total += 1;
      if (e.late) late += 1;
    }
    const byTick = {};
    battle.schedule.forEach((e, i) => { (byTick[e.tick] ||= []).push({ ...e, i }); });
    for (const list of Object.values(byTick)) {
      const firstLate = list.findIndex((e) => e.late);
      if (firstLate >= 0) assert.ok(list.slice(firstLate).every((e) => e.late), 'late actions come after the tick’s own');
    }
  }
  assert.ok(Math.abs(late / total - 0.2) < 0.03, `lag rate ${(late / total).toFixed(3)} over ${total}`);
  const { battle, ctx } = noisyRound(['neon'], 7);
  const r = playRound(battle, ctx);
  assert.equal(r.events.filter((e) => e.t === 'noise' && e.what === 'lag').length, battle.schedule.filter((e) => e.late).length, 'each lag shows as it resolves');
});

test('Void out of order: in a tick with 2+ actions, one seeded adjacent pair swaps about 1 tick in 4', () => {
  let ticks = 0;
  let swapped = 0;
  for (let s = 1; s <= 300; s += 1) {
    const { battle, ctx } = noisyRound(['void'], s);
    const quiet = createBattle(fightSpec({ seed: s, genres: ['void'], foes: battle.units.filter((u) => u.side === 'foe') }), [hero('milo'), hero('claude'), hero('codex')], { calm: { noise: false, adaptation: true } }, ctx);
    const base = schedule({ ...quiet, plans: battle.plans }, ctx);
    for (let t = 1; t <= 3; t += 1) {
      const a = battle.schedule.filter((e) => e.tick === t).map((e) => e.unitId).join();
      const q = base.filter((e) => e.tick === t).map((e) => e.unitId).join();
      ticks += 1;
      if (a !== q) swapped += 1;
    }
  }
  assert.ok(Math.abs(swapped / ticks - 0.25) < 0.04, `swap rate ${(swapped / ticks).toFixed(3)}`);
});

test('Nocturne nodding off: about 1 action in 6 is slept through', () => {
  let acts = 0;
  let slept = 0;
  for (let s = 1; s <= 200; s += 1) {
    const { battle, ctx } = noisyRound(['nocturne'], s);
    const r = playRound(battle, ctx);
    acts += battle.schedule.length;
    slept += r.events.filter((e) => e.t === 'noise' && e.what === 'slept').length;
    assert.equal(r.events.filter((e) => e.t === 'noise' && e.what === 'slept').length, r.events.filter((e) => e.t === 'lost' && e.why === 'asleep').length);
  }
  assert.ok(Math.abs(slept / acts - 1 / 6) < 0.03, `slept ${(slept / acts).toFixed(3)}`);
});

test('Iron backlog: at most 4 actions resolve in a tick; the rest wait for the next (the last tick’s at the end)', () => {
  for (let s = 1; s <= 40; s += 1) {
    const { battle } = noisyRound(['iron'], s);
    const count = (t) => battle.schedule.filter((e) => e.tick === t).length;
    assert.ok(count(1) <= 4 && count(2) <= 4, `seed ${s}: ${count(1)}, ${count(2)}`);
    assert.equal(battle.schedule.length, 18, 'nothing is lost, only delayed');
  }
});

test('Frontier fastest gun: within each tick the fastest actor (by Speed, ties by the ribbon) acts first', () => {
  const { battle } = noisyRound(['frontier'], 3, { foes: [stray('f0', { x: 12, y: 1, genre: 'frontier', archetype: 'crawler' }), stray('f1', { x: 12, y: 3, genre: 'frontier', talkKind: 'k1' })] });
  for (let t = 1; t <= 3; t += 1) assert.equal(battle.schedule.find((e) => e.tick === t).unitId, 'f0', 'the crawler (Speed 6) goes first');
  // A tie for fastest goes to the first on the ribbon, so nothing moves.
  const heroes = [hero('milo', { speed: 5 }), hero('claude'), hero('codex')];
  const foes = [stray('f0', { x: 12, y: 1, genre: 'frontier' }), stray('f1', { x: 12, y: 3, genre: 'frontier', talkKind: 'k1' })];
  for (let s = 1; s <= 20; s += 1) {
    const tie = noisyRound(['frontier'], s, { heroes, foes });
    const quiet = schedule({ ...tie.battle, calm: { noise: false, adaptation: true } }, tie.ctx);
    assert.deepEqual(tie.battle.schedule.map((e) => e.unitId), quiet.map((e) => e.unitId), `seed ${s}: all at Speed 5, ribbon order`);
    assert.ok(!playRound(tie.battle, tie.ctx).events.some((e) => e.t === 'noise' && e.what === 'fastest'));
  }
});

test('Gothic guttering candles: telegraphs over all-dark tiles are hidden until they happen', () => {
  const lights = ['DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'];
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [A.brace(), A.stride([{ x: 11, y: 1 }]), A.brace()], { by: 'foe' }) });
  const on = createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 12, y: 1, genre: 'gothic' })], arenaOpts: { lights } }), [hero('claude')], {}, ctx);
  assert.ok(on.telegraphs.some((t) => t.icon === 'move' && t.hidden));
  const off = createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 12, y: 1, genre: 'gothic' })], arenaOpts: { lights } }), [hero('claude')], { calm: { noise: false, adaptation: true } }, ctx);
  assert.ok(off.telegraphs.every((t) => !t.hidden));
  // Until they happen: once the round reaches the stride's tick, it shows.
  let b = play(on, [{ t: 'plan', unitId: 'claude', plan: plan('claude', [A.brace(), A.brace(), A.brace()]) }, { t: 'commit' }], ctx).battle;
  const move = (x) => x.telegraphs.find((t) => t.icon === 'move');
  assert.equal(b.tick, 1);
  assert.equal(move(b).hidden, true, 'still hidden in tick 1');
  while (b.status === 'running' && b.tick < 2) b = apply(b, { t: 'step' }, ctx).battle;
  assert.equal(b.tick, 2);
  assert.equal(move(b).hidden, false, 'shown in its own tick');
});

test('Kaiju tremor: at each round’s start one seeded row turns to rough ground for the round', () => {
  const { battle, ctx } = noisyRound(['kaiju'], 5);
  const r = playRound(battle, ctx);
  const tremor = r.events.find((e) => e.t === 'noise' && e.what === 'tremor');
  assert.ok(tremor);
  const rough = r.battle.surfaces.filter((s) => s.id === 'rough-ground');
  assert.ok(rough.length > 0 && rough.every((s) => s.y === rough[0].y && s.rounds === 1));
  assert.equal(rough[0].y, battle.arena.rect.y + (hashInts(battle.seed, battle.attempt, 2, 'noise:tremor') % battle.arena.rect.h));
});

test('Backhalls hum: one seeded queued stray action repeats at the end of the round', () => {
  const { battle } = noisyRound(['backhalls'], 9, { foes: [stray('f0', { x: 12, y: 1, genre: 'neon' }), stray('f1', { x: 12, y: 3, talkKind: 'k1' })] });
  const last = battle.schedule[battle.schedule.length - 1];
  assert.ok(last.unitId.startsWith('f') && last.late);
  assert.equal(battle.schedule.filter((e) => e.unitId === last.unitId && e.slot === last.slot).length, 2);
});

test('Starlight kind noise folds a tenth of the Hit bar into Critical before the pick, so the bars shown are the bars used', () => {
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [], { by: 'foe' }) });
  const b = createBattle(fightSpec({ genres: ['neon', 'starlight'], foes: [stray('f0', { x: 2, y: 1 })] }), [hero('milo')], { mode: 'mauds-table' }, ctx);
  const probe = plan('milo', [A.strike('f0')]);
  const [odds] = oddsFor(b, 'milo', probe.slots[0], ctx, { plan: probe });
  const quiet = createBattle(fightSpec({ genres: ['neon'], foes: [stray('f0', { x: 2, y: 1 })] }), [hero('milo')], { mode: 'mauds-table', calm: { noise: false, adaptation: true } }, ctx);
  const [plain] = oddsFor(quiet, 'milo', probe.slots[0], ctx, { plan: probe });
  assert.equal(odds.bars[0], plain.bars[0] + Math.floor(plain.bars[1] / 10));
  assert.equal(odds.bars[1], plain.bars[1] - Math.floor(plain.bars[1] / 10));
  assert.deepEqual(noiseGenres(b, rules), ['neon', 'starlight']);
});

test('modes and the switch: Storybook has no noise, Long Road the room’s own, Maud’s Table every genre at once', () => {
  const ctx = makeCtx();
  const mk = (mode, noise = true) => createBattle(fightSpec({ genres: ['neon', 'iron'], foes: [stray('f0', { x: 12, y: 1 })] }), [hero('milo')], { mode, calm: { noise, adaptation: true } }, ctx);
  assert.deepEqual(noiseGenres(mk('storybook'), rules), []);
  assert.deepEqual(noiseGenres(mk('long-road'), rules), ['neon']);
  assert.deepEqual(noiseGenres(mk('mauds-table'), rules), ['neon', 'iron']);
  assert.deepEqual(noiseGenres(mk('mauds-table', false), rules), []);
  assert.equal(noiseBanner(mk('mauds-table'), rules).words, 'Neon: lag. About 1 action in 5 lands a tick late. Iron: backlog. At most 4 actions resolve in a tick; the rest wait.');
});

test('noise never delays or sleeps through a Reboot, or a patch on an ally under a quarter of their Integrity', () => {
  const heroes = [hero('milo'), hero('claude'), hero('codex')];
  let voidHeld = 0;
  for (const genre of ['neon', 'nocturne', 'void', 'iron']) {
    let checked = 0;
    for (let s = 1; s <= 120; s += 1) {
      const ctx = makeCtx({ foePlan: (b, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
      const b0 = createBattle(fightSpec({ seed: s, genres: [genre], foes: [stray('f0', { x: 12, y: 1, genre }), stray('f1', { x: 12, y: 3, genre, talkKind: 'k1' }), stray('f2', { x: 13, y: 2, genre, talkKind: 'k2' })] }), heroes, { mode: 'mauds-table' }, ctx);
      const b = { ...b0, units: b0.units.map((u) => (u.id === 'codex' ? { ...u, offline: true, integrity: 0, x: 2, y: 3 } : u.id === 'milo' ? { ...u, integrity: 3, x: 1, y: 2 } : u.id === 'claude' ? { ...u, x: 1, y: 3 } : u)) };
      const r = play(b, [
        { t: 'plan', unitId: 'claude', plan: plan('claude', [A.use('letter', { unit: 'milo' }), A.reboot('codex')]) },
        { t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace(), A.brace(), A.brace()]) },
        { t: 'commit' },
      ], ctx);
      const sched = r.battle.schedule;
      if (genre === 'void') {
        // A swap never moves them: each keeps its place in its tick, and at least once the pair drawn held one.
        const quiet = schedule({ ...r.battle, calm: { noise: false, adaptation: true } }, ctx);
        for (const slot of [0, 1]) {
          const at = (list) => {
            const e = list.find((x) => x.unitId === 'claude' && x.slot === slot);
            return list.filter((x) => x.tick === e.tick).indexOf(e);
          };
          assert.equal(at(sched), at(quiet), `void ${s}: slot ${slot} keeps its place`);
        }
        for (let t = 1; t <= 3; t += 1) {
          const list = quiet.filter((e) => e.tick === t);
          const h = hashInts(r.battle.seed, r.battle.attempt, r.battle.round, t, 'noise:void-pair');
          if (list.length < 2 || unit(h) >= 0.25) continue;
          const i = hashInts(h, 'pair') % (list.length - 1);
          if ([list[i], list[i + 1]].some((e) => e.unitId === 'claude')) voidHeld += 1;
        }
      }
      const letter = sched.find((e) => e.unitId === 'claude' && e.slot === 0);
      const reboot = sched.find((e) => e.unitId === 'claude' && e.slot === 1);
      assert.equal(letter.tick, 1, `${genre} ${s}: the urgent patch keeps its tick`);
      assert.equal(reboot.tick, 3, `${genre} ${s}: the Reboot keeps its tick`);
      assert.equal(letter.late || reboot.late, false);
      const played = playRound(r.battle, ctx);
      const lost = played.events.filter((e) => e.t === 'lost' && e.unit === 'claude');
      assert.equal(lost.length, 0, `${genre} ${s}: never slept through`);
      checked += 1;
    }
    assert.equal(checked, 120);
  }
  assert.ok(voidHeld > 0, `a Void swap was drawn on an exempt action and held (${voidHeld})`);
});

test('per-actor noise draws are independent: over 100,000 draws each rate is within 0.5 points, and Lag and Nodding off correlate below 0.01', () => {
  let lag = 0;
  let nod = 0;
  let both = 0;
  const N = 100000;
  let n = 0;
  for (let round = 1; n < N; round += 1) {
    for (let tick = 1; tick <= 3 && n < N; tick += 1) {
      for (let i = 0; i < 8 && n < N; i += 1) {
        const slot = tick - 1;
        const a = unit(hashInts(4242, 0, round, tick, i, slot, 'noise:neon')) < 0.2 ? 1 : 0;
        const b = unit(hashInts(4242, 0, round, tick, i, slot, 'noise:nocturne')) < 1 / 6 ? 1 : 0;
        lag += a;
        nod += b;
        both += a * b;
        n += 1;
      }
    }
  }
  const pa = lag / N;
  const pb = nod / N;
  assert.ok(Math.abs(pa - 0.2) <= 0.005, `lag ${pa}`);
  assert.ok(Math.abs(pb - 1 / 6) <= 0.005, `nodding off ${pb}`);
  const corr = (both / N - pa * pb) / Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
  assert.ok(Math.abs(corr) < 0.01, `correlation ${corr}`);
  let pair = 0;
  for (let k = 0; k < N; k += 1) if (unit(hashInts(99, 0, 1 + Math.floor(k / 3), 1 + (k % 3), 'noise:void-pair')) < 0.25) pair += 1;
  assert.ok(Math.abs(pair / N - 0.25) <= 0.005, `void pairs ${pair / N}`);
});

test('plain telegraphs come straight from a foe’s plan: tick, icon, words, targets and tiles', () => {
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [A.stride([{ x: 11, y: 1 }, { x: 10, y: 1 }]), A.strike('milo'), A.use('glitch-slash', { unit: 'milo' })], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 1, abilityIds: ['glitch-slash'] })] }), [hero('milo')], { calm: { noise: false, adaptation: true } }, ctx);
  const t = plainTelegraphs(b, 'f0', b.plans.f0, ctx);
  assert.deepEqual(t.map((x) => [x.tick, x.icon]), [[1, 'move'], [2, 'bite'], [3, 'cast']]);
  assert.equal(t[0].words, 'Stride to k2');
  assert.equal(t[1].words, 'Strike Milo');
  assert.deepEqual(t[1].targets, ['milo']);
  assert.deepEqual(t[0].tiles, [{ x: 10, y: 1 }]);
  assert.ok(t.every((x) => x.words.length <= 60 && x.hidden === false && x.falseTarget === null && x.adapting === null && x.aside === false));
  assert.deepEqual(b.telegraphs, t, 'B’s stub minds use them as they are');
  assert.equal(findUnit(b, 'f0').x, 12);
  assert.ok(apply(b, { t: 'commit' }, ctx).battle.status === 'running');
});

// ---------- fixes, round 1: round 1's start, the last tick's backlog, the fastest gun, and noise events ----------

test('round 1 starts like every other: a Kaiju tremor, bright strays’ cheer and gravity wells from the fight’s first moment', () => {
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [], { by: 'foe' }) });
  const b = createBattle(fightSpec({ seed: 5, genres: ['kaiju'], foes: [stray('f0', { x: 12, y: 1, genre: 'kaiju' })] }), [hero('milo')], {}, ctx);
  const rough = b.surfaces.filter((s) => s.id === 'rough-ground');
  assert.ok(rough.length > 0 && rough.every((s) => s.rounds === 1));
  assert.equal(rough[0].y, b.arena.rect.y + (hashInts(b.seed, b.attempt, 1, 'noise:tremor') % b.arena.rect.h), 'round 1’s own row');
  const bright = stray('n0', { x: 13, y: 1, genre: 'starlight', talkKind: null, side: 'neutral' });
  const cheered = createBattle(fightSpec({ genres: ['neon', 'starlight'], foes: [stray('f0', { x: 12, y: 1 }), bright] }), [hero('milo')], {}, ctx);
  assert.ok(findUnit(cheered, 'f0').mods.some((m) => m.stat === 'edge-next' && m.source === 'cheer:n0'), 'the bright stray cheers its neighbour in round 1');
  const wells = [{ x: 6, y: 2, id: 'gravity-well', rounds: null }, { x: 7, y: 2, id: 'gravity-well', rounds: null }, { x: 8, y: 2, id: 'gravity-well', rounds: null }];
  const pulled = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 2 })], surfaces: wells }), [hero('milo')], {}, ctx);
  assert.deepEqual([findUnit(pulled, 'f0').x, findUnit(pulled, 'f0').y], [7, 2], 'a well pulls inward before round 1 is planned');
});

test('Iron backlog: the last tick’s overflow waits for the end of the round, marked late', () => {
  let checked = 0;
  for (let s = 1; s <= 40; s += 1) {
    const { battle, ctx } = noisyRound(['iron'], s);
    const three = battle.schedule.filter((e) => e.tick === 3);
    if (three.length <= 4) continue;
    assert.ok(three.slice(4).every((e) => e.late), `seed ${s}: past the fourth, tick 3 waits`);
    const r = playRound(battle, ctx);
    assert.equal(r.events.filter((e) => e.t === 'noise' && e.what === 'backlog').length, battle.schedule.filter((e) => e.late).length, 'each wait shows');
    checked += 1;
  }
  assert.ok(checked > 30);
});

test('Frontier fastest gun never puts a Reboot behind the fastest; everything else still yields to it', () => {
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
  const f0 = stray('f0', { x: 12, y: 1, genre: 'frontier', archetype: 'crawler' });
  const b0 = createBattle(fightSpec({ genres: ['frontier'], foes: [f0] }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
  const b = { ...b0, order: ['claude', 'milo', 'codex', 'f0'], units: b0.units.map((u) => (u.id === 'codex' ? { ...u, offline: true, integrity: 0, x: 2, y: 2 } : u.id === 'claude' ? { ...u, x: 1, y: 2 } : u)) };
  const r = play(b, [
    { t: 'plan', unitId: 'claude', plan: plan('claude', [A.reboot('codex')]) },
    { t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace(), A.brace(), A.brace()]) },
    { t: 'commit' },
  ], ctx);
  const tick = (t) => r.battle.schedule.filter((e) => e.tick === t).map((e) => e.unitId);
  assert.deepEqual(tick(1), ['f0', 'milo'], 'the fastest first');
  assert.deepEqual(tick(2), ['claude', 'f0', 'milo'], 'the Reboot keeps its place ahead of it');
});

test('noise shows as it happens: Gothic’s hidden plans at commit, and Starlight’s Hit turned Critical', () => {
  const lights = Array.from({ length: 6 }, () => 'D'.repeat(16));
  const ctx = makeCtx({ foePlan: (b, id) => plan(id, [A.brace(), A.stride([{ x: 11, y: 1 }]), A.brace()], { by: 'foe' }) });
  const b = createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 12, y: 1, genre: 'gothic' })], arenaOpts: { lights } }), [hero('claude')], {}, ctx);
  const c = play(b, [{ t: 'plan', unitId: 'claude', plan: plan('claude', [A.brace()]) }, { t: 'commit' }], ctx);
  assert.deepEqual(c.events.filter((e) => e.t === 'noise' && e.what === 'hidden').map((e) => [e.genre, e.unit]), [['gothic', 'f0']]);
  // Kind noise: a Critical whose draw fell in the slice the noise moved from Hit.
  const quiet = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  let kind = 0;
  for (let s = 1; s <= 200; s += 1) {
    const sb = createBattle(fightSpec({ seed: s, genres: ['neon', 'starlight'], foes: [stray('f0', { x: 2, y: 1, integrity: 99, maxIntegrity: 99 })] }), [hero('milo')], { mode: 'mauds-table' }, quiet);
    const r = play(sb, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.strike('f0')]) }, { t: 'commit' }, { t: 'step' }], quiet);
    const out = r.events.find((e) => e.t === 'outcome' && e.unit === 'milo');
    const probe = plan('milo', [A.strike('f0')]);
    const [unkind] = oddsFor({ ...sb, calm: { noise: false, adaptation: true } }, 'milo', probe.slots[0], quiet, { plan: probe });
    const inSlice = out.degree === 'crit' && draw(sb.seed, sb.attempt, out.k) >= unkind.bars[0];
    assert.equal(r.events.some((e) => e.t === 'noise' && e.what === 'kind' && e.unit === 'milo'), inSlice, `seed ${s}`);
    if (inSlice) kind += 1;
  }
  assert.ok(kind > 0, 'kind noise showed at least once');
});
