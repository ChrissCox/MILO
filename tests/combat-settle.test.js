// The combat kernel's settle after wave 1 (module B; CONTRACT-PHASE4.md §18.2 items 4, 5, 6, 10 and 13):
// a structured `take` that can settle the taker, heat to idle written `idle: true`, a choice's own
// `meets`, standoffs that end calmly, and grid.js's one list of walkable objects. Also review 3's items
// 1–4 (Unseen targets at −2, Borrow Void’s pair swap, Borrow Gothic and Into the shadows on dim tiles)
// and Borrow a rule lending only stitched genres, played with the live content (C’s and D’s files, read only).
//   node --test tests/combat-settle.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { oddsFor, legalActions, saveBattle, restoreBattle } from '../src/combat/battle.js';
import { applyUse, validateAbility, OBJECT_KINDS, OBJECT_STATES } from '../src/combat/effects.js';
import { stirs, STANDOFF_ROUNDS } from '../src/combat/rules.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { createGrid, WALKABLE_OBJECTS } from '../src/combat/grid.js';
import { logLines, STANDOFF_WORDS } from '../src/combat/describe.js';
import { hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ab, ABILITIES, realAbilities } from './combat-kit.js';

const noNoise = { calm: { noise: false, adaptation: true } };
const still = (id) => plan(id, [], { by: 'foe' });
const withAbilities = (extra, opts = {}) => makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, ...extra] } }), ...opts });
const patchUnit = (b, id, patch) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const at = (b, id) => [findUnit(b, id).x, findUnit(b, id).y];

function round(b, ctx, plans) {
  const c = play(b, [...Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) })), { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { battle: r.battle, events: [...c.events, ...r.events] };
}

// ---------- §18.2 item 4: take ----------

const pinchRun = ab({ id: 'pinch-and-run', outcome: false, target: { who: 'foe', range: 1 }, effects: [{ do: 'take', item: 'cordial', settle: true }] });
const pinchBrew = ab({ id: 'pinch-a-brew', outcome: false, target: { who: 'foe', range: 1 }, effects: [{ do: 'take', item: 'brew' }] });
const fox = (over = {}) => stray('f0', { x: 2, y: 1, name: 'Fetchfox', archetype: 'crawler', temperament: 'shy', abilityIds: ['pinch', 'pinch-and-run', 'pinch-a-brew'], ...over });

test('take is a take event ({ unit, from, item }); with settle: true the taker runs home at once; with nothing to take nothing happens', () => {
  const ctx = withAbilities([pinchRun, pinchBrew]);
  assert.deepEqual(validateAbility(pinchRun), []);
  assert.ok(validateAbility(ab({ id: 'pinch-odd', outcome: false, target: { who: 'foe', range: 1 }, effects: [{ do: 'take', item: 'cordial', settle: 'yes' }] }))
    .some((p) => /settle is a boolean/.test(p)));
  const b = createBattle(fightSpec({ foes: [fox(), stray('f1', { x: 12, y: 3, talkKind: 'k1' })] }), [hero('milo'), hero('claude')], noNoise, ctx);
  // A plain pinch: one structured event (no Log-only line), and the fox stays.
  const plain = applyUse(b, 'f0', ctx.abilities.get('pinch'), { target: { unit: 'milo' } }, ctx);
  const takes = plain.events.filter((e) => e.t === 'take');
  assert.deepEqual(takes.map(({ t, kind, unit, from, item }) => ({ t, kind, unit, from, item })), [{ t: 'take', kind: 'take', unit: 'f0', from: 'milo', item: 'cordial' }]);
  assert.equal(findUnit(plain.battle, 'milo').carry.cordial, 1);
  assert.equal(findUnit(plain.battle, 'f0').sorted, null);
  assert.ok(!plain.events.some((e) => e.t === 'line'), 'the take event carries it, not Log text');
  assert.deepEqual(logLines(takes, plain.battle), ['Fetchfox pinches a tonic.']);
  // settle: true: the take, then the fox is sorted, settled.
  const ran = applyUse(b, 'f0', pinchRun, { target: { unit: 'milo' } }, ctx);
  assert.deepEqual(ran.events.filter((e) => e.t === 'take' || e.t === 'sorted').map((e) => [e.t, e.unit, e.item ?? e.how]), [['take', 'f0', 'cordial'], ['sorted', 'f0', 'settled']]);
  assert.equal(findUnit(ran.battle, 'f0').sorted, 'settled');
  // Nothing left to take: no event, no settling, nothing changes hands.
  const empty = { ...b, units: b.units.map((u) => (u.side === 'party' ? { ...u, carry: { ...u.carry, cordial: 0 } } : u)) };
  const none = applyUse(empty, 'f0', pinchRun, { target: { unit: 'milo' } }, ctx);
  assert.ok(!none.events.some((e) => e.t === 'take' || e.t === 'sorted'));
  assert.equal(findUnit(none.battle, 'f0').sorted, null);
  // A brew comes out of the carrier's bag the same way.
  const brew = applyUse(b, 'f0', pinchBrew, { target: { unit: 'milo' } }, ctx);
  assert.deepEqual(brew.events.filter((e) => e.t === 'take').map((e) => [e.from, e.item]), [['milo', 'brew']]);
  assert.equal(findUnit(brew.battle, 'milo').carry.brew, 0);
  // In play: a fox alone in the room pinches on its turn and runs home, which ends the fight; the pinch is counted from the event.
  const foxCtx = withAbilities([pinchRun, pinchBrew], { foePlan: (bb, id) => plan(id, [A.use('pinch-and-run', { unit: 'milo' })], { by: 'foe' }) });
  const r = round(createBattle(fightSpec({ foes: [fox()] }), [hero('milo')], noNoise, foxCtx), foxCtx, { milo: [A.brace()] });
  assert.equal(r.events.filter((e) => e.t === 'take' && e.unit === 'f0' && e.item === 'cordial').length, 1);
  assert.deepEqual([r.battle.status, r.battle.result.sorted], ['won', 1]);
  assert.equal(findUnit(r.battle, 'milo').carry.cordial, 1);
  assert.ok(r.battle.log.includes('Fetchfox pinches a tonic.'));
});

// ---------- §18.2 item 6: a choice's own meets ----------

const borrow = ab({
  id: 'borrow-test', kind: 'feature', meets: 'mind', costs: [2],
  choices: {
    nocturne: { words: 'Borrow Nocturne: beguile', target: { who: 'foe', range: 6 }, effects: [{ do: 'condition', id: 'beguiled', n: 2, min: 'hit' }] },
    kaiju: { words: 'Borrow Titan: a stomp', meets: 'body', target: { who: 'self', range: 0, area: { shape: 'burst', size: 2, at: 'self' }, hits: 'foes' }, effects: [{ do: 'condition', id: 'tumbled', min: 'hit' }] },
  },
});

test('a choice’s own meets wins over the ability’s: the stomp meets body Resolve and the beguile mind, shown and used', () => {
  const ctx = withAbilities([borrow]);
  assert.deepEqual(validateAbility(borrow), []);
  const bad = (patch) => validateAbility({ ...borrow, id: 'borrow-bad', choices: { ...borrow.choices, kaiju: { ...borrow.choices.kaiju, ...patch } } });
  assert.ok(bad({ meets: 'guard' }).some((p) => /choices\.kaiju\.meets is body or mind/.test(p)));
  assert.ok(bad({ hits: 'all' }).some((p) => /choices\.kaiju\.hits is not a choice field/.test(p)));
  // A foe beside Pip with body Resolve 1 and mind Resolve 2.
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, resolve: { body: 1, mind: 2 } })] }), [hero('pip', { abilityIds: ['borrow-test'] })], noNoise, ctx);
  const stomp = A.use('borrow-test', null, { cost: 2, choice: 'kaiju' });
  const beguile = A.use('borrow-test', { unit: 'f0' }, { cost: 2, choice: 'nocturne' });
  const resolveOf = (row) => row.parts.filter((x) => /Resolve/.test(x.why)).map((x) => [x.why, x.n]);
  const shown = oddsFor(b, 'pip', stomp, ctx, { plan: plan('pip', [stomp]) })[0];
  assert.deepEqual(resolveOf(shown), [['body Resolve 1', -1]]);
  const other = oddsFor(b, 'pip', beguile, ctx, { plan: plan('pip', [beguile]) })[0];
  assert.deepEqual(resolveOf(other), [['mind Resolve 2', -2]], 'a choice without one keeps the ability’s');
  assert.notDeepEqual(shown.bars, other.bars);
  const r = round(b, ctx, { pip: [stomp] });
  assert.deepEqual(r.events.find((e) => e.t === 'outcome' && e.unit === 'pip' && e.target === 'f0')?.bars, shown.bars, 'the stomp picks with the body row');
});

// ---------- §18.2 item 10: standoffs ----------

test('three whole rounds with nothing happening end the fight calmly: settled, won (paid in full), end’s why standoff', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  let b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 }), stray('f1', { x: 12, y: 4, talkKind: 'k1' })] }), [hero('milo'), hero('claude')], noNoise, ctx);
  // Bracing, cooling down and heat drifting aren't anything happening.
  const plans = { milo: [A.brace()], claude: [A.brace(), A.cool()] };
  const seen = [];
  for (let i = 0; i < 2; i += 1) {
    b = round(b, ctx, plans).battle;
    seen.push([b.status, b.round, b.quiet]);
  }
  assert.deepEqual(seen, [['planning', 2, 1], ['planning', 3, 2]]);
  const last = round(b, ctx, plans);
  const end = last.events.find((e) => e.t === 'end');
  assert.equal(end?.why, 'standoff');
  assert.deepEqual([last.battle.status, end.result.outcome, end.result.rounds, end.result.sorted], ['won', 'won', 3, 2]);
  assert.ok(['won', 'talked', 'bowed', 'yielded', 'last-page'].includes(end.result.outcome), '§5.9: it pays the room in full');
  assert.ok(end.result.summary.startsWith(STANDOFF_WORDS), end.result.summary);
  assert.equal(STANDOFF_WORDS, 'They’ve lost interest and wandered home.');
  assert.equal(STANDOFF_ROUNDS, 3);
  assert.ok(last.battle.log.includes(STANDOFF_WORDS));
  assert.deepEqual(last.battle.units.filter((u) => u.side === 'foe').map((u) => u.sorted), ['settled', 'settled'], 'they wander home');
  assert.ok(last.events.filter((e) => e.t === 'end').length === 1 && last.events.filter((e) => e.t === 'end' && !e.why).length === 0);
  // A Tale-lead that only Braces settles too: a plain lead's room is won, a real rift's lead yields with its cause.
  const lead = () => ({ ...stray('lead', { x: 10, y: 2, talkKind: null, name: 'Madame Voss' }), rank: 'lead', size: 2, lead: { mechanic: 'fallback', phases: 3, bars: [12, 12, 12], quote: 'q' } });
  const bracing = makeCtx({ foePlan: () => plan('lead', [A.brace()], { by: 'foe' }) });
  const endOf = (fight) => {
    let x = createBattle(fight, [hero('milo')], noNoise, bracing);
    for (let i = 0; i < 3; i += 1) x = round(x, bracing, { milo: [A.brace()] }).battle;
    return [x.status, x.result?.real ?? null, findUnit(x, 'lead').sorted, x.log.includes(STANDOFF_WORDS)];
  };
  assert.deepEqual(endOf(fightSpec({ leadUnit: lead(), kind: 'lead' })), ['won', null, 'settled', true]);
  assert.deepEqual(endOf(fightSpec({ leadUnit: lead(), kind: 'lead', real: { key: 'real:1', cause: 'The checks are still red.' } })), ['yielded', { cause: 'The checks are still red.' }, 'settled', true]);
  // Setting the fight up isn't part of round 1: a ghost slipping out of sight in the dark as it's made doesn't count.
  const dark = createBattle(fightSpec({ foes: [stray('g0', { x: 12, y: 2, archetype: 'ghost' })], arenaOpts: { lights: Array(6).fill('D'.repeat(16)) } }), [hero('milo')], noNoise, ctx);
  assert.ok(findUnit(dark, 'g0').conditions.some((c) => c.id === 'unseen'));
  assert.equal(dark.quiet, 0);
});

test('an Integrity change, a condition landing, calm added or anyone coming closer to a foe (a hook’s move too) keeps a round from being quiet; a Buffer-soaked hit, moving away, a Brace or heat don’t', () => {
  const expose = ab({ id: 'expose-it', outcome: false, target: { who: 'foe', range: 12 }, effects: [{ do: 'condition', id: 'exposed', n: 1 }] });
  const nick = ab({ id: 'nick', outcome: false, target: { who: 'foe', range: 12 }, effects: [{ do: 'damage', line: 'fixed', amount: 2, kind: 'plain' }] });
  const swapIn = ab({ id: 'swap-in', outcome: false, target: { who: 'foe', range: 12 }, effects: [{ do: 'move', how: 'swap' }] });
  const entry = [{ x: 3, y: 1 }, { x: 3, y: 2 }];
  /** Round 1 quiet, then round 2 with `plans`; returns the standoff count after round 2 (0: something happened; 2: nothing did). */
  const afterRound2 = (plans, { foePlan = null, patch = (b) => b, bows = null } = {}) => {
    const ctx = withAbilities([expose, nick, swapIn], { foePlan: (bb, id) => (foePlan && bb.round === 2 ? foePlan(bb, id) : still(id)), bows });
    const heroes = [hero('milo', { integrity: 10, abilityIds: [...hero('milo').abilityIds, 'expose-it', 'nick', 'swap-in'] }), hero('claude')];
    let b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 }), stray('f1', { x: 12, y: 4, talkKind: 'k1' })], arenaOpts: { entry } }), heroes, noNoise, ctx);
    b = round(b, ctx, { milo: [A.brace()] }).battle;
    assert.equal(b.quiet, 1);
    return round(patch(b), ctx, plans).battle.quiet;
  };
  const toward = (bb, id) => (id === 'milo' && bb.round === 2 ? { battle: patchUnit(bb, 'f0', { x: 11 }), events: [] } : null);
  const exposing = (bb, id) => (id === 'milo' && bb.round === 2
    ? { battle: patchUnit(bb, 'f0', { conditions: [{ id: 'exposed', n: 1, source: 'milo', data: null }] }), events: [{ t: 'condition', round: bb.round, tick: bb.tick, target: 'f0', id: 'exposed', n: 1, on: true }] }
    : null);
  const cases = {
    damage: afterRound2({ milo: [A.use('nick', { unit: 'f0' })] }),
    'a patch': afterRound2({ claude: [A.use('letter', { unit: 'milo' })] }),
    'a condition landing': afterRound2({ milo: [A.use('expose-it', { unit: 'f0' })] }),
    'calm added': afterRound2({ milo: [A.talk('f0')] }),
    'a hero coming closer': afterRound2({ milo: [A.stride([{ x: 4, y: 1 }])] }),
    'a foe coming closer': afterRound2({ milo: [A.brace()] }, { foePlan: (bb, id) => plan(id, id === 'f0' ? [A.stride([{ x: 11, y: 2 }])] : [], { by: 'foe' }) }),
    'a hook bringing a foe closer': afterRound2({ milo: [A.brace()] }, { bows: { afterAction: (bb, id) => toward(bb, id) } }),
    'a swap bringing Milo beside the other foe': afterRound2({ milo: [A.use('swap-in', { unit: 'f0' })] }),
    'a hook landing a condition': afterRound2({ milo: [A.brace()] }, { bows: { afterAction: (bb, id) => exposing(bb, id) } }),
    // A hook's Battle built without the kernel's bookkeeping keeps the count (nothing else happens here).
    'a hook’s Battle leaving the count out': afterRound2({ milo: [A.brace()] }, { bows: { afterAction: (bb) => ({ battle: (({ quiet, auto, ...rest }) => rest)(bb), events: [] }) } }),
    'a hit all into Buffer': afterRound2({ milo: [A.use('nick', { unit: 'f0' })] }, { patch: (b) => patchUnit(b, 'f0', { buffer: 10 }) }),
    'moving away': afterRound2({ milo: [A.stride([{ x: 2, y: 1 }])] }),
    'a Brace and a Cool down': afterRound2({ milo: [A.brace()], claude: [A.cool()] }),
  };
  assert.deepEqual(cases, {
    damage: 0, 'a patch': 0, 'a condition landing': 0, 'calm added': 0, 'a hero coming closer': 0, 'a foe coming closer': 0, 'a hook bringing a foe closer': 0,
    'a swap bringing Milo beside the other foe': 0, 'a hook landing a condition': 0, 'a hook’s Battle leaving the count out': 2, 'a hit all into Buffer': 2, 'moving away': 2, 'a Brace and a Cool down': 2,
  });
});

test('what counts as something happening, event by event (a lead’s bow moving on counts, Decided)', () => {
  const yes = [{ t: 'damage', amount: 3, buffered: 1 }, { t: 'patch', amount: 2 }, { t: 'offline' }, { t: 'reboot' }, { t: 'sorted' }, { t: 'bar' },
    { t: 'condition', on: true }, { t: 'calm', calm: 1 }, { t: 'bow', progress: 1 }];
  const no = [{ t: 'damage', amount: 3, buffered: 3 }, { t: 'patch', amount: 0 }, { t: 'condition', on: false }, { t: 'calm', calm: 0 }, { t: 'bow', progress: 0 },
    { t: 'heat' }, { t: 'buffer' }, { t: 'move' }, { t: 'outcome' }, { t: 'take' }, { t: 'line' }];
  assert.deepEqual(yes.map((e) => stirs(e)), yes.map(() => true));
  assert.deepEqual(no.map((e) => stirs(e)), no.map(() => false));
});

test('the standoff count is saved and restored with the fight (−1 once something has happened this round), and junk is refused', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const fight = fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] });
  const heroes = [hero('milo')];
  assert.equal('quiet' in saveBattle(createBattle(fight, heroes, noNoise, ctx)), false, 'left out at 0');
  let b = createBattle(fight, heroes, noNoise, ctx);
  for (let i = 0; i < 2; i += 1) b = round(b, ctx, { milo: [A.brace()] }).battle;
  const save = JSON.parse(JSON.stringify(saveBattle(b)));
  assert.equal(save.quiet, 2);
  assert.deepEqual(restoreBattle(save, ctx, { fight, heroes }), b);
  const moving = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.stride([{ x: 2, y: 1 }]), A.brace()]) }, { t: 'commit' }], ctx).battle;
  const stepped = apply(moving, { t: 'step' }, ctx).battle;
  assert.deepEqual([stepped.status, stepped.quiet], ['running', -1]);
  assert.deepEqual(restoreBattle(JSON.parse(JSON.stringify(saveBattle(stepped))), ctx, { fight, heroes }), stepped);
  for (const junk of [4.5, 'two', -2, null]) assert.equal(restoreBattle({ ...save, quiet: junk }, ctx, { fight, heroes }), null, `quiet ${junk}`);
  // And the rest of that round, and two more, don't end it: coming closer reset the count.
  const after = round(playRound(stepped, ctx).battle, ctx, { milo: [A.brace()] }).battle;
  assert.deepEqual([after.status, after.quiet], ['planning', 1]);
});

// ---------- §18.2 item 13: walkable objects ----------

test('grid.WALKABLE_OBJECTS is the one fixed list of objects you can walk onto, and the grid moves by it', () => {
  assert.deepEqual([...WALKABLE_OBJECTS], ['clue', 'plan-tile', 'snare', 'patch-kit']);
  assert.ok(Object.isFrozen(WALKABLE_OBJECTS));
  for (const f of [() => WALKABLE_OBJECTS.add('lever'), () => WALKABLE_OBJECTS.delete('clue'), () => WALKABLE_OBJECTS.clear()]) assert.throws(f);
  assert.equal(WALKABLE_OBJECTS.size, 4);
  for (const kind of OBJECT_KINDS) {
    const state = OBJECT_STATES[kind]?.[0] ?? 'idle';
    const b = createBattle(fightSpec({ objects: [{ id: 'o0', kind, x: 5, y: 2, state, flags: [], integrity: null }] }), [hero('milo')], noNoise, makeCtx());
    assert.equal(createGrid(b).blocksMove(5, 2), !WALKABLE_OBJECTS.has(kind), kind);
  }
});

// ---------- review 3's items 1–4 with the live content ----------

const real = realAbilities();
// A lit room with one dim corner: (13, 3), (14, 3), (13, 4) and (14, 4).
const CORNER = ['LLLLLLLLLLLLLLLL', 'LLLLLLLLLLLLLLLL', 'LLLLLLLLLLLLLLLL', 'LLLLLLLLLLLLLDDL', 'LLLLLLLLLLLLLDDL', 'LLLLLLLLLLLLLLLL'];

test('with the live content: Mote on an Unseen foe at −2, Borrow Void’s pair swap, Borrow Gothic and Into the shadows onto free dim tiles only, and only stitched genres', { skip: !real && 'C’s or D’s content files are missing' }, () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: real });
  // 1. Milo's Mote on an Unseen foe, lantern down: offered, shown at −2, and picked with that row.
  const base = createBattle(fightSpec({ foes: [stray('f0', { x: 6, y: 1 })] }), [hero('milo', { abilityIds: ['mote'] })], noNoise, ctx);
  const hidden = { ...patchUnit(base, 'f0', { conditions: [{ id: 'unseen', n: null, source: null, data: null }] }), lights: base.lights.map((l) => ({ ...l, radius: 0 })) };
  assert.ok(legalActions(hidden, 'milo', ctx).find((o) => o.action.ability === 'mote').targets.some((t) => t.unit === 'f0'));
  const mote = A.use('mote', { unit: 'f0' });
  const row = oddsFor(hidden, 'milo', mote, ctx, { plan: plan('milo', [mote]) })[0];
  assert.equal(row.parts.find((x) => x.why === 'Unseen')?.n, -2);
  assert.deepEqual(round(hidden, ctx, { milo: [mote] }).events.find((e) => e.t === 'outcome' && e.unit === 'milo')?.bars, row.bars);
  // A regular Weaver who has stitched Gothic and Void.
  const weaver = hero('pip', {
    id: 'reg-a1', name: 'Nightjar', kind: 'regular', level: 2, abilityIds: ['into-the-shadows', 'borrow-a-rule'], uses: { 'borrow-a-rule': 1 },
    carry: { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: ['gothic', 'void'] },
  });
  const make = (seed, foes, spot) => patchUnit(createBattle(fightSpec({ seed, foes, arenaOpts: { lights: CORNER } }), [hero('milo'), weaver], noNoise, ctx), 'reg-a1', spot);
  // 2. Borrow Void: two foes trade places once, and only when both picks land.
  let swapped = 0;
  let stayed = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const r = round(make(seed, [stray('f0', { x: 8, y: 2 }), stray('f1', { x: 8, y: 4, talkKind: 'k1' })], { x: 5, y: 2 }), ctx,
      { 'reg-a1': [A.use('borrow-a-rule', { units: ['f0', 'f1'] }, { cost: 2, choice: 'void' })] });
    const picks = r.events.filter((e) => e.t === 'outcome' && e.unit === 'reg-a1');
    assert.deepEqual(picks.map((e) => e.target), ['f0', 'f1']);
    const both = picks.every((e) => e.degree === 'hit' || e.degree === 'crit');
    assert.deepEqual([at(r.battle, 'f0'), at(r.battle, 'f1')], both ? [[8, 4], [8, 2]] : [[8, 2], [8, 4]], `seed ${seed}`);
    assert.equal(r.events.filter((e) => e.t === 'move' && e.how === 'swap').length, both ? 2 : 0);
    if (both) swapped += 1;
    else stayed += 1;
  }
  assert.ok(swapped > 3 && stayed > 3, `${swapped} swapped, ${stayed} stayed`);
  // 3. Borrow Gothic: a Lit tile is refused, a dim one taken.
  const gothic = (tile) => at(round(make(1, [stray('f0', { x: 8, y: 4 })], { x: 10, y: 2 }), ctx, { 'reg-a1': [A.use('borrow-a-rule', { tile }, { cost: 2, choice: 'gothic' })] }).battle, 'reg-a1');
  assert.deepEqual([gothic({ x: 9, y: 2 }), gothic({ x: 13, y: 3 })], [[10, 2], [13, 3]]);
  // A dim tile a foe stands on is refused as it resolves, and the once-a-Breather use is kept.
  const onFoe = round(make(1, [stray('f0', { x: 13, y: 4 })], { x: 10, y: 2 }), ctx, { 'reg-a1': [A.use('borrow-a-rule', { tile: { x: 13, y: 4 } }, { cost: 2, choice: 'gothic' })] });
  assert.deepEqual(at(onFoe.battle, 'reg-a1'), [10, 2]);
  assert.ok(onFoe.events.some((e) => e.t === 'lost' && e.unit === 'reg-a1') && !onFoe.events.some((e) => e.t === 'act' && e.unit === 'reg-a1'));
  assert.equal(findUnit(onFoe.battle, 'reg-a1').uses['borrow-a-rule'], 1);
  // 3b. Only a genre it has stitched (COMBAT §5): the other six are greyed, and Iron is refused in play with the use kept.
  const spot = make(1, [stray('f0', { x: 8, y: 4 })], { x: 10, y: 2 });
  const whys = Object.fromEntries(legalActions(spot, 'reg-a1', ctx).filter((o) => o.action.ability === 'borrow-a-rule').map((o) => [o.action.choice, o.why]));
  assert.deepEqual(Object.keys(whys).sort(), ['frontier', 'gothic', 'iron', 'kaiju', 'neon', 'nocturne', 'noir', 'void']);
  for (const [genre, why] of Object.entries(whys)) assert.equal(why === 'Not a genre you’ve stitched', !['gothic', 'void'].includes(genre), `${genre}: ${why}`);
  const iron = round(spot, ctx, { 'reg-a1': [A.use('borrow-a-rule', { unit: 'reg-a1' }, { cost: 2, choice: 'iron' })] });
  assert.ok(iron.events.some((e) => e.t === 'lost' && e.unit === 'reg-a1'));
  assert.ok(!findUnit(iron.battle, 'reg-a1').conditions.some((c) => c.id === 'brisk'));
  assert.equal(findUnit(iron.battle, 'reg-a1').uses['borrow-a-rule'], 1);
  // 4. Into the shadows, sent with no tile as the planner offers it: the nearest dim tile, then Hide.
  const b = make(1, [stray('f0', { x: 8, y: 4 })], { x: 12, y: 2 });
  const opt = legalActions(b, 'reg-a1', ctx).find((o) => o.action.ability === 'into-the-shadows');
  assert.deepEqual([opt.targets, opt.why], [null, null]);
  const r = round(b, ctx, { 'reg-a1': [A.use('into-the-shadows', null)] });
  assert.deepEqual(at(r.battle, 'reg-a1'), [13, 3]);
  assert.ok(r.events.some((e) => e.t === 'outcome' && e.unit === 'reg-a1' && e.target === null), 'and hides there');
  const lit = round(b, ctx, { 'reg-a1': [A.use('into-the-shadows', { tile: { x: 11, y: 2 } })] });
  assert.deepEqual(at(lit.battle, 'reg-a1'), [12, 2], 'an aimed Lit tile is refused');
});
