// The effect language and the kernel (src/combat/effects.js, round.js; CONTRACT-PHASE4.md §6,
// §4.4, §4.17, §5.1; COMBAT.md §4.3, §7): the closed vocabulary, every verb, every condition
// (its effect, how it ends, how it lands on a Critical and a Graze), every surface and its
// reactions, reactions and their settings, the Hooklight, cover and light, devices, the §6.5 rule
// registry, items used up through `consumes`, and the calm reset.
//   node --test tests/combat-effects.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERBS, PREDICATES, TRIGGERS, RULE_IDS, UNTIL, DEVICE_TEMPLATES, READY_TRIGGERS, REACTION_IDS, OBJECT_KINDS, OBJECT_STATES, SURFACE_IDS,
  validateAbility, applyUse, makeRun, addCondition, landHit,
} from '../src/combat/effects.js';
import { oddsFor, legalActions } from '../src/combat/battle.js';
import { createGrid } from '../src/combat/grid.js';
import { ticksOf, surfaceReact, moveAlong, interact, plainTelegraphs } from '../src/combat/round.js';
import { foldBars } from '../src/combat/heat.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import {
  rules, hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ABILITIES, ab, abilities, OPEN,
} from './combat-kit.js';

const still = (id) => plan(id, [], { by: 'foe' });
const quietCtx = (extra = {}) => makeCtx({ foePlan: (b, id) => still(id), ...extra });
const place = (b, id, x, y, patch = {}) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, x, y, ...patch } : u)) });
const patchUnit = (b, id, patch) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const noNoise = { calm: { noise: false, adaptation: true } };

function setup({ heroes = ['milo'], foes = [stray('f0', { x: 10, y: 2 })], ctx = quietCtx(), opts = {}, fight = {} } = {}) {
  const b = createBattle(fightSpec({ foes, ...fight }), heroes.map((h) => (typeof h === 'string' ? hero(h) : h)), { ...noNoise, ...opts }, ctx);
  return { b, ctx };
}

/** Plans each hero's slots, commits, and plays the round; returns every event and the battle after. */
function round(b, ctx, plans, { yes = true } = {}) {
  const cmds = Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) }));
  const c = play(b, [...cmds, { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx, { yes });
  return { battle: r.battle, events: [...c.events, ...r.events] };
}

// ---------- the vocabulary ----------

test('the closed vocabulary is frozen and complete', () => {
  assert.equal(VERBS.length, 21);
  assert.equal(PREDICATES.length, 20);
  assert.equal(TRIGGERS.length, 12);
  assert.equal(RULE_IDS.length, 25);
  assert.deepEqual([...READY_TRIGGERS], ['foe-enters-reach', 'foe-moves-in-sight', 'strike-at-ally']);
  assert.deepEqual(REACTION_IDS.slice(0, 3), ['parting-swipe', 'shoulder', 'ready']);
  assert.deepEqual([...DEVICE_TEMPLATES], ['drone', 'turret', 'snare', 'patch-kit', 'pop-up-cover', 'decoy']);
  assert.equal(SURFACE_IDS.length, 16);
  assert.equal(OBJECT_KINDS.length, 19);
  assert.deepEqual([...OBJECT_STATES.lever], ['up', 'down']);
  assert.ok(UNTIL.includes('rounds:<n>'));
  for (const list of [VERBS, PREDICATES, TRIGGERS, RULE_IDS, UNTIL, DEVICE_TEMPLATES, READY_TRIGGERS, REACTION_IDS, OBJECT_KINDS, SURFACE_IDS]) assert.ok(Object.isFrozen(list));
});

test('validateAbility accepts §6’s language and names every problem outside it', () => {
  for (const a of ABILITIES) assert.deepEqual(validateAbility(a), [], a.id);
  const bad = ab({ id: 'bad', target: { who: 'foe', range: 1, colour: 'red' }, effects: [{ do: 'explode' }, { do: 'condition', id: 'on-fire' }, { do: 'mod', stat: 'edge-next', by: 1, until: 'forever' }, { do: 'rule', id: 'fly' }], wings: true });
  const problems = validateAbility(bad);
  for (const bit of ['wings', 'colour', 'explode', 'on-fire', 'forever', 'fly']) assert.ok(problems.some((p) => p.includes(bit)), `names ${bit}: ${problems.join(' | ')}`);
  assert.ok(validateAbility(ab({ id: 'both', target: { who: 'self' }, effects: [], by: { 1: { target: { who: 'self' }, effects: [] } } })).some((p) => p.includes('exactly one')));
  assert.ok(validateAbility(ab({ id: 'r', kind: 'reaction', reaction: { when: 'whenever' }, effects: [] })).some((p) => p.includes('trigger')));
  assert.ok(validateAbility(ab({ id: 'p', kind: 'passive', passive: { mods: [], aura: null, rules: ['nope'], summons: [] } })).some((p) => p.includes('nope')));
  assert.deepEqual(validateAbility(ab({ id: 'stubbed', stub: true, from: 'Phase 5' })), []);
  assert.throws(() => buildAbilityIndex({ callings: { abilities: [ab({ id: 'twice' })] }, spells: { spells: [ab({ id: 'twice' })] } }), /twice/);
  const idx = buildAbilityIndex({ callings: { abilities: [ab({ id: 'once' })] } });
  assert.throws(() => idx.set('x', {}));
  assert.ok(Object.isFrozen(idx.get('once')));
});

// ---------- verbs ----------

test('damage: the line × frac at the user’s level, in its kind; Inkdarts is three darts of a third, each with its own outcome, as one attack', () => {
  const { b, ctx } = setup({ heroes: ['claude'], foes: [stray('f0', { x: 5, y: 2, genre: 'void', integrity: 60, maxIntegrity: 60 })] });
  const r = applyUse(b, 'claude', abilities.get('inkdarts'), { cost: 2, target: { unit: 'f0' } }, ctx);
  const picks = r.events.filter((e) => e.t === 'outcome');
  const hits = r.events.filter((e) => e.t === 'damage');
  assert.equal(picks.length, 3, 'three darts, three outcomes');
  assert.ok(picks.every((e) => e.degree !== 'miss'), 'Inkdarts can’t miss');
  for (const [i, d] of hits.entries()) {
    const base = { crit: 8, hit: 4, graze: 2 }[picks[i].degree];
    assert.equal(d.amount, base + 3, 'a third of 12 is 4, never 3; Void is weak to Ink 3');
  }
  assert.equal(findUnit(r.battle, 'claude').attacks, 0, 'not an attack (no heat)');
  assert.equal(findUnit(r.battle, 'claude').charges.left, 1, 'circle 1 costs a charge');
  const mote = applyUse(b, 'claude', ab({ id: 'mote' }), {}, ctx);
  assert.ok(mote.battle);
});

test('patch: never above max, never on an Offline unit; ofMax patches a share of max', () => {
  const { b, ctx } = setup({ heroes: ['milo', 'claude'] });
  const hurt = patchUnit(b, 'milo', { integrity: 4 });
  const r = applyUse(patchUnit(b, 'milo', { integrity: 15 }), 'claude', abilities.get('letter'), { cost: 2, target: { unit: 'milo' } }, ctx);
  assert.equal(findUnit(r.battle, 'milo').integrity, 18, 'a 2-action Letter can’t pass max');
  const offline = patchUnit(b, 'milo', { integrity: 0, offline: true });
  const o = applyUse(offline, 'claude', abilities.get('letter'), { cost: 2, target: { unit: 'milo' } }, ctx);
  assert.equal(findUnit(o.battle, 'milo').integrity, 0);
  const c = applyUse(hurt, 'milo', abilities.get('cordial'), { cost: 1, target: null }, ctx);
  const got = c.events.find((e) => e.t === 'patch').amount;
  assert.ok([4, 2, 8].includes(got), `a quarter of 18 by degree (${got})`);
  assert.equal(findUnit(c.battle, 'milo').carry.cordial, 1, 'one cordial used up');
});

test('items are used up through consumes, and can’t be used with none left; take pinches one', () => {
  const { b, ctx } = setup({ heroes: ['milo', 'claude'] });
  const none = patchUnit(b, 'milo', { carry: { ...findUnit(b, 'milo').carry, cordial: 0 } });
  const opts = legalActions(none, 'milo', ctx).filter((o) => o.action.ability === 'cordial');
  assert.ok(opts.length && opts.every((o) => o.why === 'No cordials left'), 'drinking, giving and throwing one all need one');
  const withOne = legalActions(b, 'claude', ctx).find((o) => o.action.id === 'use' && o.action.ability === 'cordial');
  assert.equal(withOne, undefined, 'only who has it in their list');
  const thrown = legalActions(b, 'claude', ctx).find((o) => o.action.id === 'throw' && o.action.ability === 'cordial');
  assert.deepEqual([thrown.why, thrown.targets], [null, [{ unit: 'milo' }]], 'anyone may throw the party’s cordial to an ally in range');
  const margin = applyUse(b, 'claude', abilities.get('margin-note'), { target: { unit: 'milo' } }, ctx);
  assert.equal(findUnit(margin.battle, 'claude').carry.margin, 0);
  const fox = stray('f0', { x: 2, y: 1, archetype: 'crawler', temperament: 'shy', abilityIds: ['pinch'] });
  const s = setup({ heroes: ['milo'], foes: [fox] });
  const p = applyUse(s.b, 'f0', abilities.get('pinch'), { target: { unit: 'milo' } }, s.ctx);
  assert.equal(findUnit(p.battle, 'milo').carry.cordial, 1, 'the fetchfox pinches a cordial');
});

test('act: Pounce strides in, Strikes, and a Hit or better Tumbles, with the Strike’s own degree', () => {
  let tumbledAtLeastOnce = false;
  let missedWithoutTumble = false;
  for (let s = 1; s < 60 && !(tumbledAtLeastOnce && missedWithoutTumble); s += 1) {
    const beetle = stray('f0', { x: 8, y: 2, archetype: 'crawler' });
    const { b, ctx } = setup({ heroes: ['milo'], foes: [beetle], fight: { seed: s } });
    const r = applyUse(b, 'f0', abilities.get('pounce'), { cost: 2, target: { unit: 'milo' } }, ctx);
    const strike = r.events.find((e) => e.t === 'outcome' && e.unit === 'f0');
    assert.ok(r.events.some((e) => e.t === 'move' && e.unit === 'f0'), 'it strode in');
    const tumbled = findUnit(r.battle, 'milo').conditions.some((c) => c.id === 'tumbled');
    if (strike.degree === 'hit' || strike.degree === 'crit') {
      assert.ok(tumbled || findUnit(r.battle, 'milo').offline);
      tumbledAtLeastOnce = true;
    } else {
      assert.equal(tumbled, false);
      missedWithoutTumble = true;
    }
  }
  assert.ok(tumbledAtLeastOnce && missedWithoutTumble);
});

test('move: push, pull, teleport and swap along 1-2-1 lines, stopping at walls and units; a shove off a ledge falls', () => {
  const heights = ['0000000000000000', '0000000000000000', '0000001100000000', '0000000000000000', '0000000000000000', '0000000000000000'];
  const { b, ctx } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 6, y: 2 })], fight: { arenaOpts: { heights } } });
  const beside = place(b, 'milo', 5, 2);
  const push = applyUse(beside, 'milo', ab({ id: 'shove-it', target: { who: 'foe', range: 1 }, outcome: false, effects: [{ do: 'move', how: 'push', tiles: 2 }] }), { target: { unit: 'f0' } }, ctx);
  const f = findUnit(push.battle, 'f0');
  assert.deepEqual([f.x, f.y], [8, 2]);
  assert.ok(f.conditions.some((c) => c.id === 'tumbled'), 'pushed off the height-1 step: a fall Tumbles');
  assert.ok(push.events.some((e) => e.t === 'damage' && e.target === 'f0' && e.kind === 'plain'), 'the fall deals the one line in Plain');
  const pull = applyUse(place(b, 'milo', 2, 2), 'milo', ab({ id: 'pull-it', target: { who: 'foe', range: 6 }, outcome: false, effects: [{ do: 'move', how: 'pull', tiles: 2 }] }), { target: { unit: 'f0' } }, ctx);
  assert.equal(findUnit(pull.battle, 'f0').x, 4);
  const wall = applyUse(place(place(b, 'f0', 13, 2), 'milo', 12, 2), 'milo', ab({ id: 'push-wall', target: { who: 'foe', range: 1 }, outcome: false, effects: [{ do: 'move', how: 'push', tiles: 3 }] }), { target: { unit: 'f0' } }, ctx);
  assert.equal(findUnit(wall.battle, 'f0').x, 14, 'stops at the wall');
  const tp = applyUse(b, 'milo', ab({ id: 'seam-step', target: { who: 'tile', range: 6 }, outcome: false, effects: [{ do: 'move', who: 'self', how: 'teleport', tiles: 6 }] }), { target: { tile: { x: 3, y: 3 } } }, ctx);
  assert.deepEqual([findUnit(tp.battle, 'milo').x, findUnit(tp.battle, 'milo').y], [3, 3]);
  const swap = applyUse(b, 'milo', ab({ id: 'swap-it', target: { who: 'foe', range: 12 }, outcome: false, effects: [{ do: 'move', how: 'swap' }] }), { target: { unit: 'f0' } }, ctx);
  assert.deepEqual([findUnit(swap.battle, 'milo').x, findUnit(swap.battle, 'f0').x], [6, 1]);
  assert.equal(swap.events.filter((e) => e.t === 'move' && e.how === 'swap').length, 2, 'a swap is two linked move events');
});

test('heat, buffer, mod, mark, reveal, calm, light and cancel do what §6.3 says', () => {
  const { b, ctx } = setup({ heroes: ['milo', 'claude'], foes: [stray('f0', { x: 4, y: 2, genre: 'noir', temperament: 'polite' })] });
  const hot = applyUse(b, 'milo', ab({ id: 'warm-up', outcome: false, target: { who: 'self' }, effects: [{ do: 'heat', by: 30 }] }), {}, ctx);
  assert.equal(findUnit(hot.battle, 'milo').heat, 50);
  // §18.2: heat to idle is `idle: true`; `to` stays the landing parameter, so `to: 'idle'` is refused and does nothing.
  const settle = ab({ id: 'settle-down', outcome: false, target: { who: 'self' }, effects: [{ do: 'heat', idle: true }] });
  assert.deepEqual(validateAbility(settle), []);
  const idle = applyUse(hot.battle, 'milo', settle, {}, ctx);
  assert.equal(findUnit(idle.battle, 'milo').heat, 20);
  const old = ab({ id: 'settle-old', outcome: false, target: { who: 'self' }, effects: [{ do: 'heat', to: 'idle' }] });
  assert.ok(validateAbility(old).some((p) => /to is target, self or area/.test(p)), 'to: idle is refused');
  assert.equal(findUnit(applyUse(hot.battle, 'milo', old, {}, ctx).battle, 'milo').heat, 50, 'and the kernel no longer reads it');
  assert.ok(validateAbility(ab({ id: 'settle-both', outcome: false, target: { who: 'self' }, effects: [{ do: 'heat', idle: true, by: -10 }] })).some((p) => /by or idle/.test(p)));
  assert.ok(validateAbility(ab({ id: 'settle-odd', outcome: false, target: { who: 'self' }, effects: [{ do: 'heat', idle: 'yes' }] })).some((p) => /idle is a boolean/.test(p)));
  // On a target: an ally's heat to its own idle (Maud's +15 included when it applies).
  const ally = applyUse(patchUnit(b, 'claude', { heat: 70 }), 'milo', ab({ id: 'calm-them', helpful: true, outcome: false, target: { who: 'ally', range: 6 }, effects: [{ do: 'heat', idle: true }] }), { target: { unit: 'claude' } }, ctx);
  assert.equal(findUnit(ally.battle, 'claude').heat, findUnit(b, 'claude').heat, 'the Scribe back to her idle');
  const buf = applyUse(b, 'milo', ab({ id: 'shelter', helpful: true, outcome: false, target: { who: 'self' }, effects: [{ do: 'buffer', amount: 'brace' }] }), {}, ctx);
  assert.equal(findUnit(buf.battle, 'milo').buffer, 4);
  const sure = applyUse(b, 'claude', abilities.get('being-sure'), { target: { unit: 'milo' } }, ctx);
  assert.ok(findUnit(sure.battle, 'milo').mods.some((m) => m.stat === 'degree-next-on-foe'));
  const probe = plan('milo', [A.strike('f0')]);
  const sureOdds = oddsFor(place(sure.battle, 'milo', 3, 2), 'milo', probe.slots[0], ctx, { plan: probe })[0];
  const plainOdds = oddsFor(place(b, 'milo', 3, 2), 'milo', probe.slots[0], ctx, { plan: probe })[0];
  assert.equal(sureOdds.bars[3], 0, 'one degree better: no Miss left');
  assert.ok(plainOdds.bars[3] > 0);
  const bead = applyUse(b, 'milo', ab({ id: 'bead', outcome: false, target: { who: 'foe', range: 12 }, effects: [{ do: 'mark', id: 'bead', n: 2 }] }), { target: { unit: 'f0' } }, ctx);
  const fb = findUnit(bead.battle, 'f0');
  assert.ok(fb.marks.some((m) => m.id === 'bead' && m.by === 'milo' && m.n === 2) && fb.conditions.some((c) => c.id === 'singled-out'));
  const seen = applyUse(b, 'milo', ab({ id: 'look', outcome: false, target: { who: 'foe', range: 12 }, effects: [{ do: 'reveal', what: 'stats' }] }), { target: { unit: 'f0' } }, ctx);
  assert.equal(findUnit(seen.battle, 'f0').examined, true);
  const calm = applyUse(b, 'milo', ab({ id: 'soothe-it', outcome: false, target: { who: 'foe', range: 12 }, effects: [{ do: 'calm', n: 1 }] }), { target: { unit: 'f0' } }, ctx);
  assert.equal(calm.battle.talk.k0.calm, 1);
  const lit = applyUse(b, 'milo', ab({ id: 'little-light', outcome: false, target: { who: 'tile', range: 6 }, effects: [{ do: 'light', radius: 2, rounds: 10 }] }), { target: { tile: { x: 6, y: 3 } } }, ctx);
  assert.ok(lit.battle.lights.some((l) => l.source === 'little-light' && l.radius === 2 && l.rounds === 10));
  assert.ok(lit.events.some((e) => e.t === 'light'));
  const cancel = applyUse(b, 'claude', ab({ id: 'cross-it-out', outcome: false, target: { who: 'none' }, effects: [{ do: 'cancel', what: 'spell', maxCircle: 3 }] }), {}, ctx);
  assert.deepEqual(cancel.battle.units.map((u) => u.integrity), b.units.map((u) => u.integrity), 'a stub in Phase 4');
});

// ---------- conditions ----------

test('a condition landed by a Critical doubles its number; a Graze halves it, and a yes-or-no one (or one that halves to 0) doesn’t land', () => {
  const { b, ctx } = setup({ heroes: ['milo'] });
  const land = (id, n, degree, helpful = false) => {
    const run = makeRun(b, ctx);
    const target = run.b.units.find((u) => u.id === 'f0');
    const ok = addCondition(run, target, id, n, { degree, helpful });
    return ok ? target.conditions.find((c) => c.id === id)?.n ?? true : false;
  };
  for (const id of ['tangled', 'drowsy', 'dazzled', 'spooked', 'beguiled', 'queasy', 'rattled', 'dazed', 'slowed', 'sparked', 'singed', 'soaked', 'hushed', 'exposed']) {
    assert.equal(land(id, 2, 'crit'), 4, `${id} doubles on a Critical`);
    assert.equal(land(id, 2, 'hit'), 2, `${id} as written on a Hit`);
    assert.equal(land(id, 2, 'graze'), 1, `${id} halves on a Graze`);
    assert.equal(land(id, 1, 'graze'), false, `${id} 1 halves to 0 and doesn’t land`);
    assert.equal(land(id, 2, 'miss'), false);
  }
  for (const id of ['tumbled', 'quickened', 'brisk', 'winded', 'unseen', 'singled-out']) {
    assert.ok(land(id, null, 'crit') !== false, `${id} lands on a Critical`);
    assert.ok(land(id, null, 'hit') !== false, `${id} lands on a Hit`);
    assert.equal(land(id, null, 'graze'), false, `${id} doesn’t land on a Graze`);
  }
  assert.equal(land('rattled', 2, 'graze', true), 1, 'a helpful Graze halves numbers of 2 or more');
  assert.equal(land('rattled', 1, 'graze', true), 1);
  // Refreshing: to the higher number.
  const run = makeRun(b, ctx);
  const t = run.b.units.find((u) => u.id === 'f0');
  addCondition(run, t, 'spooked', 1, {});
  addCondition(run, t, 'spooked', 3, {});
  addCondition(run, t, 'spooked', 2, {});
  assert.equal(t.conditions.filter((c) => c.id === 'spooked').length, 1);
  assert.equal(t.conditions.find((c) => c.id === 'spooked').n, 3);
  // Constructs and ghosts ignore theirs.
  const run2 = makeRun(createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2, archetype: 'construct', ignores: ['queasy', 'drowsy', 'beguiled'] })] }), [hero('milo')], {}, ctx), ctx);
  assert.equal(addCondition(run2, run2.b.units.find((u) => u.id === 'f0'), 'drowsy', 2, {}), false);
});

test('each condition’s effect on the odds: Tumbled, Tangled, Drowsy, Dazzled, Spooked, Queasy, Rattled, Unseen, Exposed', () => {
  const { b, ctx } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 2, y: 1 })] });
  const probe = plan('milo', [A.strike('f0')]);
  const edge = (battle) => oddsFor(battle, 'milo', probe.slots[0], ctx, { plan: probe })[0].edge;
  const base = edge(b);
  const withCond = (id, n = 1, on = 'f0', source = null) => patchUnit(b, on, { conditions: [{ id, n, source, data: null }] });
  assert.equal(edge(withCond('tumbled', null)), base + 1, 'melee against a Tumbled target +1');
  assert.equal(edge(withCond('tangled')), base + 1, 'attacks on a Tangled target +1');
  assert.equal(edge(withCond('tangled', 1, 'milo')), base - 1, 'a Tangled attacker −1');
  assert.equal(edge(withCond('drowsy')), base + 1);
  assert.equal(edge(withCond('dazzled')), base + 1);
  assert.equal(edge(withCond('dazzled', 1, 'milo')), base - 1);
  assert.equal(edge(withCond('spooked', 1, 'milo', 'f0')), base - 1, 'Spooked while it can see the source');
  assert.equal(edge(withCond('queasy', 1, 'milo')), base - 1);
  assert.equal(edge(withCond('rattled', 2, 'milo')), base - 2, 'Rattled N is −N');
  assert.equal(edge(patchUnit(b, 'milo', { rattled: true })), base - 1, 'a Reboot’s Rattled 1');
  assert.equal(edge(withCond('exposed')), base + 1);
  assert.equal(edge(withCond('unseen', null)), base - 2, 'attacks on an Unseen target −2');
  assert.equal(edge(withCond('unseen', null, 'milo')), base + 1, 'its first attack from hiding +1');
  // A ranged attack on a Tumbled target: −1.
  const archer = patchUnit(b, 'milo', { strike: { amount: 7, kind: 'plain', reach: 1, range: 12, weapon: 'ranged' } });
  const far = place(archer, 'f0', 8, 1);
  const tumbledFar = patchUnit(far, 'f0', { conditions: [{ id: 'tumbled', n: null, source: null, data: null }] });
  assert.equal(edge(tumbledFar), edge(far) - 1);
});

test('conditions that take actions: Drowsy and a surprise sleep through, Dazed loses N (a lead never more than 2), Slowed and Winded lose the last', () => {
  const u = { conditions: [], mods: [] };
  const three = plan('x', [A.brace(), A.brace(), A.brace()]);
  assert.deepEqual(ticksOf(three, { ...u, conditions: [{ id: 'slowed', n: 1, data: null }] }).map((t) => t.lost), [null, null, 'slowed']);
  assert.deepEqual(ticksOf(three, { ...u, conditions: [{ id: 'winded', n: null, data: null }] }).map((t) => t.lost), [null, null, 'winded']);
  const four = plan('x', [A.brace(), A.brace(), A.brace(), A.strike('f0')]);
  assert.deepEqual(ticksOf(four, { ...u, conditions: [{ id: 'quickened', n: 1, data: null }] }).map((t) => t.ends), [1, 2, 3, 4]);
  assert.deepEqual(ticksOf(plan('x', [A.brace(), A.brace(), A.brace(), A.brace()]), { ...u, conditions: [{ id: 'brisk', n: 1, data: null }] }).map((t) => t.lost), [null, null, null, 'wont-fit'], 'Brisk’s fourth may only Stride or Strike');
  const { b, ctx } = setup({ heroes: ['milo'] });
  const dazed = patchUnit(b, 'milo', { conditions: [{ id: 'dazed', n: 2, source: null, data: null }] });
  const r = round(dazed, ctx, { milo: [A.brace(), A.brace(), A.brace()] });
  assert.deepEqual(r.events.filter((e) => e.t === 'lost' && e.unit === 'milo').map((e) => e.why), ['dazed', 'dazed']);
  assert.ok(!findUnit(r.battle, 'milo').conditions.some((c) => c.id === 'dazed'), 'Dazed drops by 1 for each action lost');
  const asleep = patchUnit(b, 'milo', { conditions: [{ id: 'drowsy', n: 1, source: null, data: null }] });
  const s = round(asleep, ctx, { milo: [A.brace(), A.brace()] });
  assert.deepEqual(s.events.filter((e) => e.t === 'lost' && e.unit === 'milo').map((e) => e.why), ['asleep', 'asleep']);
  assert.ok(!findUnit(s.battle, 'milo').conditions.some((c) => c.id === 'drowsy'), 'Drowsy 1 counts down at the round’s end');
  // A Tale-lead never loses more than 2 in a turn to Dazed.
  const lead = stray('lead', { x: 12, y: 2, talkKind: null });
  lead.rank = 'lead';
  lead.size = 2;
  lead.lead = { mechanic: 'fallback', phases: 2, bars: [40, 40], quote: 'q' };
  const lctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }) });
  const lb = createBattle(fightSpec({ kind: 'lead', leadUnit: lead }), [hero('milo')], noNoise, lctx);
  const dazedLead = patchUnit(lb, 'lead', { conditions: [{ id: 'dazed', n: 3, source: null, data: null }] });
  const lr = round(dazedLead, lctx, { milo: [A.brace()] });
  assert.deepEqual(lr.events.filter((e) => e.t === 'lost' && e.unit === 'lead').map((e) => e.why), ['dazed', 'dazed'], 'two lost, not three');
  assert.ok(lr.events.some((e) => e.t === 'act' && e.unit === 'lead' && e.tick === 3), 'the third happens');
  assert.equal(findUnit(lr.battle, 'lead').conditions.find((c) => c.id === 'dazed')?.n, 1, 'Dazed 1 is left for its next turn');
});

test('how conditions end: counting down, Tumbled standing up, Tangled and lingering by an Interact, Drowsy on damage, Brisk into Winded, Assist and Soaked ending Singed', () => {
  const { b, ctx } = setup({ heroes: ['milo', 'claude'], foes: [stray('f0', { x: 3, y: 1 })] });
  const cond = (id, n, data = null) => ({ id, n, source: null, data });
  let x = patchUnit(b, 'milo', { conditions: [cond('spooked', 2), cond('tumbled', null)] });
  let r = round(x, ctx, { milo: [A.stride([{ x: 2, y: 2 }])] });
  const milo = findUnit(r.battle, 'milo');
  assert.deepEqual([milo.x, milo.y], [1, 1], 'a Tumbled unit’s Stride only stands it up');
  assert.ok(!milo.conditions.some((c) => c.id === 'tumbled'));
  assert.equal(milo.conditions.find((c) => c.id === 'spooked').n, 1, 'Spooked 2 counts down to 1');
  x = patchUnit(b, 'milo', { conditions: [cond('tangled', 3), cond('lingering', 2, { kind: 'static', turns: 3 })] });
  assert.ok(legalActions(x, 'milo', ctx).find((o) => o.action.id === 'stride').why === 'Tangled');
  r = round(x, ctx, { milo: [A.interact({ unit: 'milo' })] });
  assert.ok(!findUnit(r.battle, 'milo').conditions.some((c) => c.id === 'tangled' || c.id === 'lingering'), 'an Interact frees and shakes off');
  x = patchUnit(b, 'f0', { conditions: [cond('drowsy', 3)] });
  r = round(place(x, 'milo', 2, 1), ctx, { milo: [A.strike('f0')] });
  const hit = r.events.find((e) => e.t === 'damage' && e.target === 'f0');
  if (hit && hit.amount > 0) assert.ok(!findUnit(r.battle, 'f0').conditions.some((c) => c.id === 'drowsy'), 'Drowsy ends when it takes damage');
  x = patchUnit(b, 'milo', { conditions: [cond('brisk', 1)] });
  r = round(x, ctx, { milo: [A.brace()] });
  assert.ok(findUnit(r.battle, 'milo').conditions.some((c) => c.id === 'winded'), 'Brisk ends into Winded');
  x = patchUnit(b, 'claude', { conditions: [cond('singed', 2, { turns: 3 })] });
  r = round(x, ctx, { milo: [A.assist('claude', 'f0')] });
  assert.ok(!findUnit(r.battle, 'claude').conditions.some((c) => c.id === 'singed'), 'an Assist ends Singed');
  const run = makeRun(patchUnit(b, 'milo', { conditions: [cond('singed', 2, { turns: 3 })] }), ctx);
  addCondition(run, run.b.units.find((u) => u.id === 'milo'), 'soaked', 1, {});
  assert.ok(!run.b.units.find((u) => u.id === 'milo').conditions.some((c) => c.id === 'singed'), 'Soaked ends Singed');
});

test('lingering damage and Singed tick at the start of the holder’s turn with no outcome, for 3 turns', () => {
  const { b, ctx } = setup({ heroes: ['milo'] });
  let x = patchUnit(b, 'milo', { integrity: 18, conditions: [{ id: 'singed', n: 2, source: null, data: { turns: 3 } }] });
  const ticks = [];
  for (let i = 0; i < 4; i += 1) {
    const r = round(x, ctx, { milo: [A.brace()] });
    ticks.push(r.events.filter((e) => e.t === 'damage' && e.target === 'milo' && e.kind === 'light').length);
    assert.ok(!r.events.some((e) => e.t === 'outcome' && e.unit === null && e.target === 'milo'), 'no outcome is picked');
    x = r.battle;
  }
  assert.deepEqual(ticks, [1, 1, 1, 0]);
});

test('Soaked makes Spark and Static a weakness and Light a resistance at the level’s value; Hushed stops spoken spells; Sparked stops reactions', () => {
  const { b, ctx } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 2, y: 1, genre: 'nocturne' })] });
  const soaked = patchUnit(b, 'f0', { conditions: [{ id: 'soaked', n: 2, source: null, data: null }] });
  const run = makeRun(soaked, ctx);
  const r1 = landHit(run, { targetId: 'f0', amount: 5, kind: 'spark', degree: 'hit', reactions: false });
  assert.equal(r1.amount, 8, 'weak to Spark 3 at level 1');
  const r2 = landHit(run, { targetId: 'f0', amount: 5, kind: 'light', degree: 'hit', reactions: false });
  assert.equal(r2.amount, 2, 'resists Light 3');
  const hushed = setup({ heroes: [hero('claude', { abilityIds: ['letter', 'shout'] })] });
  const shout = ab({ id: 'shout', spoken: true, outcome: false, target: { who: 'self' }, effects: [{ do: 'heat', by: 1 }] });
  const ctx2 = makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, shout] } }) });
  const h = patchUnit(createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] }), [hero('claude', { abilityIds: ['shout'] })], noNoise, ctx2), 'claude', { conditions: [{ id: 'hushed', n: 1, source: null, data: null }] });
  assert.equal(legalActions(h, 'claude', ctx2).find((o) => o.action.ability === 'shout').why, 'Hushed');
  assert.ok(hushed.b);
  // A real Stride out of the stray's reach (king's steps from (3, 1)): a swipe, unless it's Sparked.
  const away = [{ x: 4, y: 1 }, { x: 5, y: 1 }];
  const awake = round(place(place(b, 'f0', 2, 1), 'milo', 3, 1), ctx, { milo: [A.stride(away)] });
  assert.deepEqual([findUnit(awake.battle, 'milo').x, findUnit(awake.battle, 'milo').y], [5, 1], 'the Stride happened');
  assert.ok(awake.events.some((e) => e.t === 'reaction' && e.unit === 'f0' && e.id === 'parting-swipe'), 'an awake stray swipes');
  const sparked = patchUnit(place(b, 'f0', 2, 1), 'f0', { conditions: [{ id: 'sparked', n: 1, source: null, data: null }] });
  const leave = round(place(sparked, 'milo', 3, 1), ctx, { milo: [A.stride(away)] });
  assert.deepEqual([findUnit(leave.battle, 'milo').x, findUnit(leave.battle, 'milo').y], [5, 1], 'the same Stride happened');
  assert.ok(!leave.events.some((e) => e.t === 'reaction'), 'no Parting swipe from a Sparked stray');
});

test('Beguiled can’t target its charmer and drifts toward them with its first action; it ends when the charmer’s side strikes it', () => {
  const { b, ctx } = setup({ heroes: ['milo', 'claude'], foes: [stray('f0', { x: 8, y: 2 })], ctx: makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace()], { by: 'foe' }) }) });
  const beg = patchUnit(b, 'f0', { conditions: [{ id: 'beguiled', n: 2, source: 'milo', data: null }] });
  const r = round(beg, ctx, { milo: [A.brace()] });
  assert.ok(r.events.some((e) => e.t === 'improvise' && e.unit === 'f0' && e.why === 'beguiled'));
  assert.ok(findUnit(r.battle, 'f0').x < 8, 'it drifted toward Milo');
  const struck = round(place(beg, 'claude', 7, 2), ctx, { claude: [A.strike('f0')] });
  const hit = struck.events.find((e) => e.t === 'damage' && e.target === 'f0');
  if (hit) assert.ok(!findUnit(struck.battle, 'f0').conditions.some((c) => c.id === 'beguiled'));
});

// ---------- surfaces ----------

test('surfaces: water is difficult and puts out Singed; leaving it Soaks; oil and ice Tumble on a Stride but never on a Step; fliers ignore them', () => {
  const surfaces = [
    { x: 3, y: 1, id: 'water', rounds: null }, { x: 5, y: 2, id: 'oil-slick', rounds: null }, { x: 5, y: 3, id: 'ice', rounds: null },
    { x: 8, y: 1, id: 'moonbrew-spill', rounds: null },
  ];
  const { b, ctx } = setup({ heroes: ['milo'], fight: { surfaces } });
  const singed = patchUnit(b, 'milo', { conditions: [{ id: 'singed', n: 2, source: null, data: { turns: 3 } }] });
  const r = round(singed, ctx, { milo: [A.stride([{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }])] });
  const m = findUnit(r.battle, 'milo');
  assert.ok(!m.conditions.some((c) => c.id === 'singed'), 'water puts out Singed');
  assert.ok(m.conditions.some((c) => c.id === 'soaked' && c.n >= 1), 'leaving water: Soaked 2 (counted down once)');
  let tumbles = 0;
  let steps = 0;
  for (let s = 1; s <= 40; s += 1) {
    const f = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 12, y: 4 })], surfaces }), [hero('milo')], noNoise, ctx);
    const on = place(f, 'milo', 4, 2);
    const stride = round(on, ctx, { milo: [A.stride([{ x: 5, y: 2 }])] });
    if (findUnit(stride.battle, 'milo').conditions.some((c) => c.id === 'tumbled')) tumbles += 1;
    const step = round(on, ctx, { milo: [A.step({ x: 5, y: 2 })] });
    if (findUnit(step.battle, 'milo').conditions.some((c) => c.id === 'tumbled')) steps += 1;
  }
  assert.ok(tumbles > 0, 'Striding onto oil Tumbles on a Hit or better');
  assert.equal(steps, 0, 'Stepping onto a slippery tile is always safe');
  const jev = hero('milo', { id: 'jev', kind: 'jev', moves: { flies: true, hovers: false, throughWalls: false, darksight: false }, abilityIds: [] });
  const fl = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 4 })], surfaces }), [jev], noNoise, ctx);
  const fly = round(place(fl, 'jev', 4, 2), ctx, { jev: [A.stride([{ x: 5, y: 2 }, { x: 5, y: 3 }])] });
  assert.ok(!findUnit(fly.battle, 'jev').conditions.some((c) => c.id === 'tumbled'), 'fliers ignore surfaces');
  // Floaters (hovering) ignore them too: over the seeds where a walker Tumbled, they never do, and water doesn't Soak them.
  let floated = 0;
  for (let s = 1; s <= 40; s += 1) {
    const hover = hero('milo', { moves: { flies: false, hovers: true, throughWalls: false, darksight: false } });
    const f = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 12, y: 4 })], surfaces }), [hover], noNoise, ctx);
    const on = round(place(f, 'milo', 4, 2), ctx, { milo: [A.stride([{ x: 5, y: 2 }, { x: 5, y: 3 }])] });
    assert.ok(!findUnit(on.battle, 'milo').conditions.some((c) => c.id === 'tumbled'), `seed ${s}: a floater never slips`);
    const wet = round(place(f, 'milo', 2, 1), ctx, { milo: [A.stride([{ x: 3, y: 1 }, { x: 4, y: 1 }])] });
    assert.ok(!findUnit(wet.battle, 'milo').conditions.some((c) => c.id === 'soaked'), `seed ${s}: nor is Soaked`);
    floated += 1;
  }
  assert.equal(floated, 40);
});

test('surface reactions follow the damage kind: Spark arcs through water, Chill glazes it to ice, Light lights wax and burns oil and foliage, Ink collapses a well', () => {
  const surfaces = [
    { x: 2, y: 1, id: 'water', rounds: null }, { x: 3, y: 1, id: 'water', rounds: null }, { x: 4, y: 1, id: 'water', rounds: null },
    { x: 7, y: 2, id: 'candle-wax', rounds: null }, { x: 9, y: 2, id: 'oil-slick', rounds: null }, { x: 11, y: 2, id: 'foliage', rounds: null },
    { x: 13, y: 2, id: 'gravity-well', rounds: null }, { x: 2, y: 3, id: 'ice', rounds: null }, { x: 4, y: 3, id: 'moonbrew-spill', rounds: null },
  ];
  const foes = [stray('f0', { x: 2, y: 1 }), stray('f1', { x: 4, y: 1, talkKind: 'k1' })];
  const { b, ctx } = setup({ heroes: ['milo'], foes, fight: { surfaces } });
  const react = (tiles, kind, amount = 6, hitUnit = null) => {
    const run = makeRun(b, ctx);
    surfaceReact(run, tiles, kind, { amount, hitUnit });
    return run;
  };
  const arc = react([{ x: 2, y: 1 }], 'spark', 6, 'f0');
  assert.ok(arc.events.some((e) => e.t === 'damage' && e.target === 'f1' && e.amount === 3), 'half the hit arcs to f1 in the connected water');
  assert.ok(arc.b.units.find((u) => u.id === 'f1').conditions.some((c) => c.id === 'sparked'));
  const ice = react([{ x: 3, y: 1 }], 'chill');
  assert.deepEqual(ice.b.surfaces.filter((s) => s.y === 1 && s.x <= 4).map((s) => s.id), ['ice', 'ice', 'ice']);
  const wax = react([{ x: 7, y: 2 }], 'light');
  assert.equal(wax.b.surfaces.find((s) => s.x === 7).id, 'candlefire');
  assert.equal(wax.b.surfaces.find((s) => s.x === 7).rounds, 2);
  assert.equal(react([{ x: 9, y: 2 }], 'light').b.surfaces.find((s) => s.x === 9).id, 'burning-oil');
  assert.equal(react([{ x: 11, y: 2 }], 'light').b.surfaces.find((s) => s.x === 11).id, 'burning-foliage');
  assert.equal(react([{ x: 13, y: 2 }], 'ink').b.surfaces.find((s) => s.x === 13), undefined);
  assert.equal(react([{ x: 2, y: 3 }], 'light').b.surfaces.find((s) => s.x === 2 && s.y === 3).id, 'water');
  assert.equal(react([{ x: 4, y: 3 }], 'light').b.surfaces.find((s) => s.x === 4 && s.y === 3).id, 'steam');
  assert.equal(react([{ x: 7, y: 2 }], 'static').b.surfaces.find((s) => s.x === 7).id, 'candle-wax', 'the wrong kind does nothing');
});

test('burning surfaces Singe anyone who ends a tick in them, and burn out after their rounds (oil into smog)', () => {
  const surfaces = [{ x: 1, y: 1, id: 'burning-oil', rounds: 2 }];
  const { b, ctx } = setup({ heroes: ['milo'], fight: { surfaces } });
  let r = round(b, ctx, { milo: [A.brace()] });
  assert.ok(r.events.some((e) => e.t === 'condition' && e.target === 'milo' && e.id === 'singed'));
  r = round(r.battle, ctx, { milo: [A.brace()] });
  assert.equal(r.battle.surfaces.find((s) => s.x === 1 && s.y === 1)?.id, 'smog');
});

test('surface numbers grow by 1 at room level 4', () => {
  const surfaces = [{ x: 1, y: 1, id: 'neon-puddle', rounds: null }];
  for (const [level, n] of [[1, 1], [4, 2]]) {
    const { b, ctx } = setup({ heroes: ['milo'], fight: { surfaces, level } });
    const r = round(b, ctx, { milo: [A.brace()] });
    assert.equal(r.events.find((e) => e.t === 'condition' && e.id === 'soaked').n, n, `level ${level}`);
  }
});

test('hazard props burst once on a Light hit: the two line in Plain to everyone within 1, then rubble', () => {
  const objects = [{ id: 'o0', kind: 'prop', x: 6, y: 2, state: 'oil-drum', flags: ['hazard', 'cover-low'], integrity: null }];
  const { b, ctx } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 5, y: 2, integrity: 60, maxIntegrity: 60 })], fight: { objects } });
  const run = makeRun(b, ctx);
  landHit(run, { userId: 'milo', targetId: 'f0', amount: 5, kind: 'light', degree: 'hit', reactions: false });
  assert.equal(run.b.objects[0].state, 'rubble');
  assert.ok(run.events.some((e) => e.t === 'damage' && e.target === 'f0' && e.kind === 'plain' && e.amount >= 12 - 3));
  const again = landHit(run, { userId: 'milo', targetId: 'f0', amount: 5, kind: 'light', degree: 'hit', reactions: false });
  assert.ok(again);
  assert.equal(run.events.filter((e) => e.t === 'object').length, 1, 'once');
});

test('the rest of the surfaces: smog and steam block sight, a gravity well pulls inward and costs double to leave, dust clouds blunt ranged attacks, streetlight pools light, moonbrew Drowses, foliage hides', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const surfaces = [
    { x: 5, y: 1, id: 'smog', rounds: null }, { x: 5, y: 3, id: 'steam', rounds: 2 },
    ...[9, 10, 11].flatMap((x) => [1, 2, 3].map((y) => ({ x, y, id: 'gravity-well', rounds: null }))),
    { x: 6, y: 4, id: 'dust-cloud', rounds: null }, { x: 7, y: 4, id: 'dust-cloud', rounds: null },
    { x: 13, y: 4, id: 'streetlight-pool', rounds: null }, { x: 2, y: 4, id: 'foliage', rounds: null },
  ];
  const lights = ['DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'];
  const b = createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 14, y: 4, genre: 'gothic' })], surfaces, arenaOpts: { lights } }), [hero('claude')], noNoise, ctx);
  const g = createGrid({ ...b, lights: [] }, rules);
  assert.equal(g.sees({ x: 4, y: 1 }, { x: 6, y: 1 }), false, 'smog blocks sight');
  assert.equal(g.sees({ x: 4, y: 3 }, { x: 6, y: 3 }), false, 'steam blocks sight');
  assert.equal(g.light(13, 4), 'L', 'a streetlight pool is a lit circle');
  assert.equal(g.hides(2, 4), true, 'you can hide in foliage');
  assert.equal(g.difficult(2, 4), true);
  // Leaving the well costs double: one step out of it is 2.
  const inWell = place(b, 'claude', 9, 1);
  const r = createGrid(inWell, rules).reachable('claude', { budget: 2 });
  assert.equal(r.get('8,1').cost, 2, 'one tile out of the well costs 2');
  // At the start of the turn, a unit in the well is pulled one tile inward.
  const edge = place(b, 'claude', 11, 3);
  const pulled = round(edge, ctx, { claude: [A.brace()] });
  assert.ok(pulled.events.some((e) => e.t === 'move' && e.unit === 'claude' && e.how === 'pull'));
  assert.deepEqual([findUnit(pulled.battle, 'claude').x, findUnit(pulled.battle, 'claude').y], [10, 2], 'pulled one tile toward the middle');
  // A ranged Strike through 2+ tiles of dust cloud: −1.
  const archer = place(patchUnit(b, 'claude', { strike: { amount: 7, kind: 'plain', reach: 1, range: 12, weapon: 'ranged' } }), 'claude', 5, 4);
  const probe = plan('claude', [A.strike('f0')]);
  const parts = oddsFor({ ...archer, units: archer.units.map((u) => (u.id === 'f0' ? { ...u, x: 9, y: 4 } : u)) }, 'claude', probe.slots[0], ctx, { plan: probe })[0].parts;
  assert.ok(parts.some((p) => p.why === 'dust cloud' && p.n === -1));
  // Moonbrew: entering it Drowses on a Hit or better against mind Resolve.
  let drowsed = 0;
  for (let s = 1; s <= 30; s += 1) {
    const mb = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 14, y: 4 })], surfaces: [{ x: 3, y: 2, id: 'moonbrew-spill', rounds: null }] }), [hero('codex')], noNoise, ctx);
    const walk = round(place(mb, 'codex', 2, 2), ctx, { codex: [A.stride([{ x: 3, y: 2 }])] });
    if (walk.events.some((e) => e.t === 'condition' && e.id === 'drowsy' && e.target === 'codex')) drowsed += 1;
  }
  assert.ok(drowsed > 0 && drowsed < 30, `Drowsy on some entries (${drowsed} of 30)`);
});

// ---------- reactions ----------

test('Parting swipe: leaving a foe’s reach without Stepping draws one; a Step or a flier draws none; Never turns it off', () => {
  const { b, ctx } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 3, y: 2 })] });
  const near = place(b, 'milo', 2, 2);
  const stride = round(near, ctx, { milo: [A.stride([{ x: 1, y: 2 }, { x: 1, y: 3 }])] });
  assert.ok(stride.events.some((e) => e.t === 'reaction' && e.unit === 'f0' && e.id === 'parting-swipe'));
  assert.ok(stride.events.some((e) => e.t === 'outcome' && e.unit === 'f0' && e.target === 'milo'));
  const step = round(near, ctx, { milo: [A.step({ x: 1, y: 2 })] });
  assert.ok(!step.events.some((e) => e.t === 'reaction'));
  const heroSwipe = setup({ heroes: ['milo'], foes: [stray('f0', { x: 3, y: 2 })], ctx: makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 4, y: 2 }, { x: 5, y: 2 }])], { by: 'foe' }) }) });
  const swiped = round(place(heroSwipe.b, 'milo', 2, 2), heroSwipe.ctx, { milo: [A.brace()] });
  assert.ok(swiped.events.some((e) => e.t === 'reaction' && e.unit === 'milo' && e.id === 'parting-swipe'), 'heroes swipe too (Always)');
  const never = patchUnit(place(heroSwipe.b, 'milo', 2, 2), 'milo', { reactions: { 'parting-swipe': 'never' } });
  assert.ok(!round(never, heroSwipe.ctx, { milo: [A.brace()] }).events.some((e) => e.t === 'reaction'));
});

test('Shoulder lends a Buffer pool to one hit on an ally beside, and only when there’s something to lend; Under half waits for a hurt ally', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.strike('milo'), A.strike('milo')], { by: 'foe' }) });
  const { b } = setup({ heroes: ['milo', hero('claude', { reactions: { shoulder: 'always' } })], foes: [stray('f0', { x: 3, y: 2 })], ctx });
  const x = place(place(b, 'milo', 2, 2), 'claude', 2, 3, { buffer: 0 });
  const braced = patchUnit(x, 'claude', { buffer: 4 });
  const run = makeRun(braced, ctx);
  landHit(run, { userId: 'f0', targetId: 'milo', amount: 3, kind: 'static', degree: 'hit' });
  landHit(run, { userId: 'f0', targetId: 'milo', amount: 3, kind: 'static', degree: 'hit' });
  const dmg = run.events.filter((e) => e.t === 'damage');
  assert.deepEqual(dmg.map((e) => e.buffered), [3, 0], 'the pool lends 3 once; one reaction a round');
  assert.equal(run.b.units.find((u) => u.id === 'claude').buffer, 1);
  const empty = makeRun(x, ctx);
  landHit(empty, { userId: 'f0', targetId: 'milo', amount: 3, kind: 'static', degree: 'hit' });
  assert.ok(!empty.events.some((e) => e.t === 'reaction'), 'nothing to lend, no Shoulder');
  const underHalf = patchUnit(patchUnit(x, 'claude', { buffer: 4, reactions: { shoulder: 'under-half' } }), 'milo', { integrity: 18 });
  const uh = makeRun(underHalf, ctx);
  landHit(uh, { userId: 'f0', targetId: 'milo', amount: 3, kind: 'static', degree: 'hit' });
  assert.ok(!uh.events.some((e) => e.t === 'reaction'), 'Milo isn’t under half');
  const hurt = makeRun(patchUnit(underHalf, 'milo', { integrity: 8 }), ctx);
  landHit(hurt, { userId: 'f0', targetId: 'milo', amount: 3, kind: 'static', degree: 'hit' });
  assert.ok(hurt.events.some((e) => e.t === 'reaction' && e.id === 'shoulder'));
});

test('an Ask pauses the step until it’s answered; yes fires the reaction, no doesn’t', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }])], { by: 'foe' }) });
  const { b } = setup({ heroes: [hero('milo', { reactions: { 'parting-swipe': 'ask' } })], foes: [stray('f0', { x: 3, y: 2 })], ctx });
  const x = place(b, 'milo', 2, 2);
  const c = play(x, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.brace()]) }, { t: 'commit' }], ctx).battle;
  let first = apply(c, { t: 'step' }, ctx);
  for (let i = 0; i < 4 && first.battle.status === 'running'; i += 1) first = apply(first.battle, { t: 'step' }, ctx);
  assert.equal(first.battle.status, 'asking');
  assert.equal(first.battle.ask.unitId, 'milo');
  assert.equal(first.battle.ask.reactionId, 'parting-swipe');
  assert.match(first.battle.ask.words, /^Parting swipe at glitch beetle\?$/i);
  assert.equal(first.events[0].t, 'ask');
  assert.ok(!first.events.some((e) => e.t === 'move'), 'the stride hasn’t resolved yet');
  const yes = apply(apply(first.battle, { t: 'answer', yes: true }, ctx).battle, { t: 'step' }, ctx);
  assert.ok(yes.events.some((e) => e.t === 'reaction' && e.unit === 'milo'));
  const no = apply(apply(first.battle, { t: 'answer', yes: false }, ctx).battle, { t: 'step' }, ctx);
  assert.ok(!no.events.some((e) => e.t === 'reaction'));
  assert.ok(no.events.some((e) => e.t === 'move' && e.unit === 'f0'), 'the stray walks on');
});

test('Ready (Warding 10): the next slot fires as a reaction on its trigger, for each READY_TRIGGERS entry, and is lost if it doesn’t', () => {
  // The stray walks in during tick 3, after Milo's Ready (ticks 1–2) is armed.
  const walkIn = makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace(), A.stride([{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }])], { by: 'foe' }) });
  const { b } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 8, y: 2 })], ctx: walkIn, opts: { warding: 10 } });
  const x = place(b, 'milo', 2, 2);
  const low = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })] }), [hero('milo')], { ...noNoise, warding: 9 }, walkIn);
  assert.ok(legalActions(low, 'milo', walkIn).filter((o) => o.action.id === 'ready').every((o) => o.why));
  const fire = (trigger, ctx) => round(x, ctx, { milo: [A.ready(trigger), A.strike('f0')] });
  const enters = fire('foe-enters-reach', walkIn);
  assert.ok(enters.events.some((e) => e.t === 'reaction' && e.unit === 'milo' && e.id === 'ready' && e.trigger === 'readied'));
  const moves = fire('foe-moves-in-sight', walkIn);
  assert.ok(moves.events.some((e) => e.t === 'reaction' && e.id === 'ready'));
  const bites = makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace(), A.strike('claude')], { by: 'foe' }) });
  const two = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 3 })] }), [hero('milo'), hero('claude')], { ...noNoise, warding: 10 }, bites);
  const setupTwo = place(place(two, 'milo', 2, 2), 'claude', 2, 3);
  const struck = round(setupTwo, bites, { milo: [A.ready('strike-at-ally'), A.strike('f0')] });
  assert.ok(struck.events.some((e) => e.t === 'reaction' && e.unit === 'milo' && e.id === 'ready'));
  const idle = makeCtx({ foePlan: (bb, id) => still(id) });
  const lost = round(place(createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })] }), [hero('milo')], { ...noNoise, warding: 10 }, idle), 'milo', 2, 2), idle, { milo: [A.ready('foe-enters-reach'), A.strike('f0')] });
  assert.ok(lost.events.some((e) => e.t === 'lost' && e.unit === 'milo'), 'a readied action that never fires is lost at the round’s end');
});

test('Stand in my light takes the one line off a hit on an ally within 4, and Proofread moves an outcome a degree', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const { b } = setup({ heroes: [hero('milo', { reactions: { 'stand-in-my-light': 'always' } }), hero('claude', { reactions: { proofread: 'always' } })], foes: [stray('f0', { x: 4, y: 2, integrity: 80, maxIntegrity: 80 })], ctx });
  const run = makeRun(place(b, 'claude', 3, 2), ctx);
  landHit(run, { userId: 'f0', targetId: 'claude', amount: 9, kind: 'static', degree: 'hit' });
  const d = run.events.find((e) => e.t === 'damage');
  assert.equal(d.amount, 4, 'the one line (5) comes off');
  assert.equal(run.b.units.find((u) => u.id === 'milo').uses['stand-in-my-light'], 1);
  let moved = false;
  for (let s = 1; s < 40 && !moved; s += 1) {
    const fb = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 4, y: 2, integrity: 80, maxIntegrity: 80 })] }), [hero('milo'), hero('claude', { reactions: { proofread: 'always' } })], noNoise, ctx);
    const r = round(place(fb, 'milo', 3, 2), ctx, { milo: [A.strike('f0')] });
    const by = r.events.find((e) => e.t === 'outcome' && e.by === 'claude');
    if (by) {
      const first = r.events.find((e) => e.t === 'outcome' && !e.by);
      assert.equal(['crit', 'hit', 'graze', 'miss'].indexOf(by.degree), ['crit', 'hit', 'graze', 'miss'].indexOf(first.degree) - 1, 'up one for an ally');
      moved = true;
    }
  }
  assert.ok(moved);
});

// ---------- the Hooklight, cover and light ----------

test('the Hooklight: radius 5 raised, dropping when Milo is offline, Tumbled or asleep, raised again by an action', () => {
  const { b, ctx } = setup({ heroes: ['milo', 'claude'] });
  const lamp = (x) => x.lights.find((l) => l.id === 'hooklight').radius;
  assert.equal(lamp(b), 5);
  const run = makeRun(b, ctx);
  addCondition(run, run.b.units.find((u) => u.id === 'milo'), 'tumbled', null, {});
  assert.equal(lamp(run.b), 0);
  assert.ok(run.events.some((e) => e.t === 'light'));
  const dropped = run.b;
  const up = applyUse({ ...dropped, units: dropped.units.map((u) => (u.id === 'milo' ? { ...u, conditions: [] } : u)) }, 'milo', abilities.get('raise-lantern'), {}, ctx);
  assert.equal(lamp(up.battle), 5);
  const asleep = makeRun(b, ctx);
  addCondition(asleep, asleep.b.units.find((u) => u.id === 'milo'), 'drowsy', 1, {});
  assert.equal(lamp(asleep.b), 0);
  const off = makeRun(b, ctx);
  landHit(off, { targetId: 'milo', amount: 40, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(lamp(off.b), 0);
  assert.ok(off.events.some((e) => e.t === 'offline'));
});

test('inside the Hooklight: +1 edge on shadow foes, ghosts lose their Plain resistance, Unseen foes are revealed, allies drift 20; the party can still hide', () => {
  const lights = ['DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'];
  const ghost = stray('f0', { x: 3, y: 1, archetype: 'ghost', genre: 'gothic', resist: { dread: 3, plain: 3 }, weak: { light: 3 } });
  const { b, ctx } = setup({ heroes: ['milo', 'claude'], foes: [ghost, stray('f1', { x: 13, y: 4, genre: 'noir', talkKind: 'k1' })], fight: { arenaOpts: { lights }, genres: ['gothic'] } });
  const probe = plan('claude', [A.strike('f0')]);
  const lit = oddsFor(place(b, 'claude', 2, 1), 'claude', probe.slots[0], ctx, { plan: probe })[0];
  assert.ok(lit.parts.some((p) => p.why === 'in the lantern’s light' && p.n === 1));
  const run = makeRun(b, ctx);
  const plainHit = landHit(run, { targetId: 'f0', amount: 6, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(plainHit.amount, 6, 'no Plain resistance inside the light');
  const far = makeRun(place(b, 'f0', 12, 1), ctx);
  assert.equal(landHit(far, { targetId: 'f0', amount: 6, kind: 'plain', degree: 'hit', reactions: false }).amount, 3);
  const hidden = patchUnit(place(b, 'f1', 4, 2), 'f1', { conditions: [{ id: 'unseen', n: null, source: null, data: null }] });
  const r = round(hidden, ctx, { milo: [A.brace()] });
  assert.ok(!findUnit(r.battle, 'f1').conditions.some((c) => c.id === 'unseen'), 'the lantern finds it');
  const warm = patchUnit(b, 'claude', { heat: 65 });
  const drift = round(place(warm, 'claude', 2, 2), ctx, { milo: [A.brace()] });
  assert.equal(findUnit(drift.battle, 'claude').heat, 45, 'drift 20 inside the raised lantern');
  const hide = legalActions(place(b, 'claude', 2, 2), 'claude', ctx).find((o) => o.action.id === 'hide');
  assert.equal(hide.why, null, 'the Hooklight never spoils the party’s own hiding');
  const foeHide = legalActions(b, 'f0', ctx).find((o) => o.action.id === 'hide');
  assert.ok(foeHide.why, 'foes can’t Hide within it');
});

test('darkness is −1 unless you have darksight; high ground is +1; the level difference counts per 2 levels', () => {
  const lights = ['DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'];
  const heights = ['0000000000000000', '0000000000000000', '0000000000000000', '0000000000000000', '0000000000000000', '0000000000000000'];
  const { b, ctx } = setup({ heroes: ['claude', 'pip'], foes: [stray('f0', { x: 12, y: 3 })], fight: { arenaOpts: { lights, heights } } });
  const probe = (id) => plan(id, [A.strike('f0')]);
  const parts = (battle, id) => oddsFor(battle, id, probe(id).slots[0], ctx, { plan: probe(id) })[0].parts;
  const x = place(place(b, 'claude', 11, 3), 'pip', 12, 2);
  assert.ok(parts(x, 'claude').some((p) => p.why === 'in the dark' && p.n === -1));
  assert.ok(!parts(x, 'pip').some((p) => p.why === 'in the dark'), 'Pip has darksight');
  const high = { ...x, arena: { ...x.arena, height: heights.map((r, y) => (y === 3 ? '00000000000100000' .slice(0, 16) : r)).join('') } };
  assert.ok(parts(high, 'claude').some((p) => p.why === 'high ground' && p.n === 1));
  const bigger = { ...patchUnit(x, 'f0', { level: 5 }), roadLevel: 5 };
  assert.ok(parts(bigger, 'claude').some((p) => p.n === -2 && /levels below/.test(p.why)), 'four levels below: −2');
  const three = { ...patchUnit(x, 'f0', { level: 4 }), roadLevel: 5 };
  const p3 = parts(three, 'claude').find((p) => /levels below/.test(p.why));
  assert.equal(p3?.n, -1, 'three levels below: −1');
});

// ---------- devices and rules ----------

test('each device template: the drone zaps, the turret lasts its rounds, the snare Tangles and goes, the patch kit patches once, pop-up cover is low cover that breaks, the decoy goes at the round’s end', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => (id === 'f1' && bb.round === 1 && bb.units.some((u) => u.kind === 'snare')) ? plan(id, [A.stride([{ x: 7, y: 3 }, { x: 6, y: 3 }])], { by: 'foe' }) : still(id) });
  const { b } = setup({ heroes: ['codex'], foes: [stray('f0', { x: 5, y: 1 }), stray('f1', { x: 8, y: 3, talkKind: 'k1' })], ctx });
  const zap = applyUse(b, 'codex', abilities.get('drone-zap'), { target: { unit: 'f0' } }, ctx);
  assert.ok(zap.events.some((e) => e.t === 'outcome' && e.unit === 'd0' && e.target === 'f0'));
  const spare = applyUse(b, 'codex', abilities.get('spare-part'), { target: { tile: { x: 2, y: 2 } } }, ctx);
  const turret = spare.battle.units.find((u) => u.kind === 'turret');
  assert.ok(turret && spare.events.some((e) => e.t === 'spawn' && e.unit?.id === turret.id));
  assert.equal(findUnit(spare.battle, 'codex').carry.spare, 0);
  let t = spare.battle;
  const gone = [];
  for (let i = 0; i < 3; i += 1) {
    const r = round(t, ctx, { codex: [A.brace()] });
    gone.push(...r.events.filter((e) => e.t === 'gone'));
    t = r.battle;
  }
  assert.ok(gone.some((e) => e.unit === turret.id && e.why === 'expired'), 'the Spare Part turret lasts 3 rounds');
  const snare = applyUse(b, 'codex', abilities.get('device'), { cost: 2, choice: 'snare', target: { tile: { x: 7, y: 3 } } }, ctx);
  assert.ok(snare.battle.objects.some((o) => o.kind === 'snare' && o.state === 'set'));
  const walk = makeCtx({ foePlan: (bb, id) => (id === 'f1' ? plan(id, [A.stride([{ x: 7, y: 3 }, { x: 6, y: 3 }])], { by: 'foe' }) : still(id)) });
  const replanned = { ...snare.battle, plans: { ...snare.battle.plans, f1: plan('f1', [A.stride([{ x: 7, y: 3 }, { x: 6, y: 3 }])], { by: 'foe' }) } };
  const sprung = round(replanned, walk, { codex: [A.brace()] });
  assert.ok(sprung.events.some((e) => e.t === 'object' && e.state === 'sprung'));
  assert.ok(!sprung.battle.objects.some((o) => o.kind === 'snare'), 'then it’s gone');
  const kit = applyUse(b, 'codex', abilities.get('device'), { cost: 2, choice: 'patch-kit', target: { tile: { x: 2, y: 1 } } }, ctx);
  const hurt = patchUnit(kit.battle, 'codex', { integrity: 5 });
  const kitId = kit.battle.objects.find((o) => o.kind === 'patch-kit').id;
  const used = round(hurt, ctx, { codex: [A.interact({ object: kitId }), A.interact({ object: kitId })] });
  assert.deepEqual(used.events.filter((e) => e.t === 'patch').map((e) => e.amount), [12], 'the two line, once');
  const cover = applyUse(b, 'codex', abilities.get('pop-up-cover'), { target: { tile: { x: 3, y: 1 } } }, ctx);
  const c = cover.battle.objects.find((o) => o.kind === 'pop-up-cover');
  assert.equal(c.integrity, 12, '10 + 2 × level');
  assert.equal(findUnit(cover.battle, 'codex').uses['pop-up-cover'], 1);
  const decoyAb = ab({ id: 'decoy-now', outcome: false, target: { who: 'tile', range: 3 }, effects: [{ do: 'summon', template: 'decoy' }] });
  const dctx = makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, decoyAb] } }) });
  const dec = applyUse(createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 1 })] }), [hero('codex')], noNoise, dctx), 'codex', decoyAb, { target: { tile: { x: 3, y: 3 } } }, dctx);
  const decoy = dec.battle.units.find((u) => u.kind === 'decoy');
  assert.equal(decoy.maxIntegrity, 1);
  const after = round(dec.battle, dctx, { codex: [A.brace()] });
  assert.ok(after.events.some((e) => e.t === 'gone' && e.unit === decoy.id && e.why === 'expired'));
});

function ruleCtx(extra) {
  return makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, ...extra] } }) });
}
const passive = (id, rulesList) => ab({ id, kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: rulesList, summons: [] } });

test('the §6.5 rules: lantern-calls, hearth-path, wick-path, wayward-path, unbroken, settle-low, lullaby, unseen-strike, tuck-and-roll', () => {
  const extra = [passive('hearth', ['hearth-path']), passive('wick', ['wick-path']), passive('wayward', ['wayward-path']), passive('unbroken-p', ['unbroken']),
    passive('unseen-strike', ['unseen-strike']), passive('swipe-p', ['swipe-strike']),
    ab({ id: 'tuck-and-roll', kind: 'reaction', costs: [], reaction: { when: 'self-struck', range: 0 }, effects: [{ do: 'rule', id: 'tuck-and-roll' }] }),
    ab({ id: 'still-water', costs: [2], meets: 'mind', target: { who: 'self', area: { shape: 'burst', size: 4, at: 'self' }, hits: 'foes' }, effects: [{ do: 'condition', id: 'spooked', n: 2, min: 'hit' }, { do: 'rule', id: 'settle-low' }] }),
    ab({ id: 'lullaby', kind: 'spell', circle: 1, costs: [2], meets: 'mind', target: { who: 'tile', range: 6, area: { shape: 'burst', size: 2, at: 'target' }, hits: 'foes' }, effects: [{ do: 'rule', id: 'lullaby' }] })];
  const ctx = ruleCtx(extra);
  const heroes = [hero('milo', { abilityIds: ['the-lantern-calls', 'hearth', 'mote', 'wick', 'wayward'], uses: { 'the-lantern-calls': 1 } }), hero('claude'), hero('pip')];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2, integrity: 80, maxIntegrity: 80 })] }), heroes, noNoise, ctx);
  const down = patchUnit(patchUnit(b, 'claude', { offline: true, integrity: 0, drops: 1 }), 'pip', { offline: true, integrity: 0, drops: 2 });
  const calls = applyUse(down, 'milo', ctx.abilities.get('the-lantern-calls'), { cost: 3 }, ctx);
  assert.equal(findUnit(calls.battle, 'claude').offline, false, 'back, as if Rebooted');
  assert.equal(findUnit(calls.battle, 'claude').integrity, 4);
  assert.equal(findUnit(calls.battle, 'pip').offline, true, 'a second drop stays down');
  const run = makeRun(place(b, 'claude', 2, 1), ctx);
  const hit = landHit(run, { userId: 'f0', targetId: 'claude', amount: 6, kind: 'static', degree: 'hit', reactions: false });
  assert.equal(hit.amount, 4, 'Hearth: allies in his light resist all damage by 2');
  const mote = applyUse(place(b, 'f0', 5, 1), 'milo', ctx.abilities.get('mote'), { target: { unit: 'f0' } }, ctx);
  const d = mote.events.find((e) => e.t === 'damage');
  const pick = mote.events.find((e) => e.t === 'outcome');
  if (d) assert.equal(d.amount, { crit: 18, hit: 9, graze: 4 }[pick.degree], 'Wick: Mote deals 2 more (7 + 2) in Light');
  assert.equal(legalActions(b, 'milo', ctx).length > 0, true);
  const unbroken = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })] }), [hero('codex', { abilityIds: ['unbroken-p'], uses: { 'unbroken-p': 1 } })], noNoise, ctx);
  const u = makeRun(unbroken, ctx);
  landHit(u, { targetId: 'codex', amount: 50, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(u.b.units.find((x) => x.id === 'codex').integrity, 1);
  landHit(u, { targetId: 'codex', amount: 50, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(u.b.units.find((x) => x.id === 'codex').offline, true, 'once per Campfire');
  // settle-low: strays 4 or more levels below the party settle.
  const low = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1, level: 0 })] }), [hero('claude', { abilityIds: ['still-water'] })], { ...noNoise, roadLevel: 5 }, ctx);
  const still2 = applyUse(low, 'claude', ctx.abilities.get('still-water'), { cost: 2 }, ctx);
  assert.equal(findUnit(still2.battle, 'f0').sorted, 'settled');
  // lullaby: lowest Integrity first, until the total would pass twice the two line (24 at level 1).
  const sheep = [stray('f0', { x: 6, y: 2, integrity: 10, maxIntegrity: 10 }), stray('f1', { x: 7, y: 2, integrity: 12, maxIntegrity: 12, talkKind: 'k1' }), stray('f2', { x: 6, y: 3, integrity: 8, maxIntegrity: 8, talkKind: 'k2' })];
  // Drowsy 2 lands only on a Hit or better (4 on a Critical), and only foes it puts to sleep count.
  const seen = new Set();
  for (let seed = 1; seed <= 400 && seen.size < 3; seed += 1) {
    const lull = createBattle(fightSpec({ foes: sheep, seed }), [hero('claude', { abilityIds: ['lullaby'] })], noNoise, ctx);
    const l = applyUse(lull, 'claude', ctx.abilities.get('lullaby'), { cost: 2, target: { tile: { x: 6, y: 2 } } }, ctx);
    const picks = l.events.filter((e) => e.t === 'outcome').map((e) => [e.target, e.degree]);
    let used = 0;
    const order = ['f2', 'f0', 'f1'];
    for (const id of order) {
      const hp = { f2: 8, f0: 10, f1: 12 }[id];
      const pick = picks.find(([t]) => t === id);
      if (used + hp > 24) {
        assert.equal(pick, undefined, `seed ${seed}: ${id} would pass the budget, so it isn’t picked`);
        continue;
      }
      assert.ok(pick, `seed ${seed}: ${id} fits, so it’s picked`);
      const drowsy = findUnit(l.battle, id).conditions.find((c) => c.id === 'drowsy');
      if (pick[1] === 'hit' || pick[1] === 'crit') {
        assert.equal(drowsy?.n, pick[1] === 'crit' ? 4 : 2, `seed ${seed}: ${id} sleeps on a ${pick[1]}`);
        used += hp;
      } else assert.equal(drowsy, undefined, `seed ${seed}: a ${pick[1]} never lands Drowsy`);
    }
    assert.deepEqual(picks.map(([t]) => t), order.filter((id) => picks.some(([t]) => t === id)), 'lowest Integrity first');
    if (picks.length === 2 && picks.every(([, d]) => d === 'hit' || d === 'crit')) seen.add('8 + 10 fit; the 12 would pass');
    if (picks.some(([, d]) => d === 'graze')) seen.add('a Graze');
    if (picks.length === 3) seen.add('a foe it didn’t put to sleep left room for the 12');
  }
  assert.equal(seen.size, 3, [...seen].join(', '));
  // unseen-strike: once a turn, a Strike with an ally beside the target adds the one line.
  const sk = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 80, maxIntegrity: 80 })] }), [hero('pip', { abilityIds: ['unseen-strike'] }), hero('claude')], noNoise, ctx);
  const flank = place(place(sk, 'pip', 2, 2), 'claude', 3, 3);
  const s = round(flank, ctx, { pip: [A.strike('f0'), A.strike('f0')] });
  const dmg = s.events.filter((e) => e.t === 'damage' && e.unit === 'pip');
  const outs = s.events.filter((e) => e.t === 'outcome' && e.unit === 'pip');
  if (dmg.length && outs[0].degree === 'hit') assert.equal(dmg[0].amount, 7 + 5 + 3, 'Strike 7, plus the one line 5, plus Neon’s weakness to Warp 3');
  // tuck-and-roll halves a hit on the skirmisher.
  const tr = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })] }), [hero('pip', { abilityIds: ['tuck-and-roll'] })], noNoise, ctx);
  const t = makeRun(tr, ctx);
  const halved = landHit(t, { userId: 'f0', targetId: 'pip', amount: 9, kind: 'static', degree: 'hit' });
  assert.equal(halved.amount, 4);
});

test('the §6.5 rules: draw-the-blow, ignore-difficult, first-in-tick, burn-essence, cleave, tune-ups, tollkeeper-toll, steady-hands, steady-second and -third, two-sustained, two-drones', () => {
  const extra = [
    ab({ id: 'draw-the-blow', kind: 'reaction', costs: [], reaction: { when: 'strike-at-ally', range: 2 }, effects: [{ do: 'rule', id: 'draw-the-blow' }] }),
    passive('read-the-ground', ['ignore-difficult']), passive('tune', ['tune-ups']), passive('toll', ['tollkeeper-toll']), passive('steady-h', ['steady-hands']),
    passive('steady-2', ['steady-second']), passive('steady-3', ['steady-third']), passive('two-s', ['two-sustained']), passive('two-d', ['two-drones']),
    ab({ id: 'borrow-frontier', costs: [2], outcome: false, target: { who: 'self' }, effects: [{ do: 'rule', id: 'first-in-tick' }] }),
    ab({ id: 'burn-an-essence', costs: [0], outcome: false, target: { who: 'self' }, effects: [{ do: 'rule', id: 'burn-essence' }] }),
    ab({ id: 'cleave', kind: 'art', target: { who: 'foe', range: 1 }, effects: [{ do: 'act', action: 'strike' }, { do: 'rule', id: 'cleave' }] }),
    ab({ id: 'focus-a', kind: 'spell', circle: 1, sustained: { max: 10 }, costs: [2], helpful: true, outcome: false, target: { who: 'self' }, effects: [{ do: 'mod', stat: 'edge-first-each-turn', by: 1, until: 'sustained' }] }),
    ab({ id: 'focus-b', kind: 'spell', circle: 1, sustained: { max: 10 }, costs: [2], helpful: true, outcome: false, target: { who: 'self' }, effects: [{ do: 'mod', stat: 'guard', by: 1, until: 'sustained' }] }),
  ];
  const ctx = ruleCtx(extra);
  const warden = hero('codex', { id: 'toll', kind: 'tollkeeper', name: 'The Tollkeeper', abilityIds: ['draw-the-blow', 'toll'], reactions: { 'draw-the-blow': 'always' } });
  const bite = makeCtx({ foePlan: (bb, id) => plan(id, [A.strike('milo')], { by: 'foe' }), abilityIndex: ctx.abilities });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })] }), [hero('milo'), warden], noNoise, bite);
  const drawn = round(place(place(b, 'milo', 2, 2), 'toll', 4, 3), bite, { milo: [A.brace()] });
  const pick = drawn.events.find((e) => e.t === 'outcome' && e.unit === 'f0');
  assert.equal(pick.target, 'toll', 'the warden becomes the target');
  const ground = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })], surfaces: [{ x: 2, y: 1, id: 'water', rounds: null }] }), [hero('milo', { abilityIds: ['read-the-ground'] })], noNoise, ctx);
  const opt = legalActions(ground, 'milo', ctx).find((o) => o.action.id === 'stride');
  assert.ok(opt);
  const walked = round(ground, ctx, { milo: [A.stride([{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }])] });
  assert.equal(findUnit(walked.battle, 'milo').x, 5, 'water costs normal with Read the ground (4 tiles for Speed 4)');
  const first = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2, archetype: 'crawler' })] }), [hero('pip', { abilityIds: ['borrow-frontier'] })], noNoise, ctx);
  const borrowed = round(first, ctx, { pip: [A.use('borrow-frontier', null, { cost: 2 })] });
  const next = play(borrowed.battle, [{ t: 'plan', unitId: 'pip', plan: plan('pip', [A.brace()]) }, { t: 'commit' }], ctx).battle;
  assert.equal(next.schedule[0].unitId, 'pip', 'next round Pip acts first in every tick');
  const weaver = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('pip', { abilityIds: ['burn-an-essence'], charges: { pool: 'pact', max: 1, left: 0, circle: 1 }, carry: { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 2, stitched: [] } })], noNoise, ctx);
  const burnt = applyUse(weaver, 'pip', ctx.abilities.get('burn-an-essence'), { cost: 0 }, ctx);
  assert.equal(findUnit(burnt.battle, 'pip').charges.left, 1);
  assert.equal(findUnit(burnt.battle, 'pip').carry.essences, 1);
  const two = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 80, maxIntegrity: 80 }), stray('f1', { x: 3, y: 3, talkKind: 'k1', integrity: 80, maxIntegrity: 80 })] }), [hero('codex', { abilityIds: ['cleave'] })], noNoise, ctx);
  const cl = applyUse(place(two, 'codex', 2, 2), 'codex', ctx.abilities.get('cleave'), { target: { unit: 'f0' } }, ctx);
  const main = cl.events.find((e) => e.t === 'damage' && e.target === 'f0');
  const side = cl.events.find((e) => e.t === 'damage' && e.target === 'f1');
  if (main) assert.ok(side, 'a second foe beside the first takes half');
  const tinker = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('codex', { abilityIds: ['bench-drone', 'tune'] })], noNoise, ctx);
  const drone = tinker.units.find((u) => u.kind === 'drone');
  assert.deepEqual([drone.guard, drone.maxIntegrity], [2, 7], 'Tune-ups: +1 Guard (at most 2), 2 × level more Integrity');
  const tollB = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })] }), [hero('codex', { id: 'toll', kind: 'tollkeeper', abilityIds: ['toll'] })], noNoise, makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }])], { by: 'foe' }), abilityIndex: ctx.abilities }));
  let stopped = false;
  for (let s = 1; s < 20 && !stopped; s += 1) {
    const tb = { ...place(tollB, 'toll', 6, 3), seed: s };
    const r = round(tb, makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }])], { by: 'foe' }), abilityIndex: ctx.abilities }), { toll: [A.brace()] });
    if (findUnit(r.battle, 'f0').x === 7) stopped = true;
  }
  assert.ok(stopped, 'a foe moving beside the Tollkeeper stops there on a Hit or better');
  const hands = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo', { abilityIds: ['cordial', 'steady-h'], integrity: 3 })], noNoise, ctx);
  const drink = applyUse(hands, 'milo', ctx.abilities.get('cordial'), { cost: 1 }, ctx);
  const got = drink.events.find((e) => e.t === 'patch').amount;
  assert.ok([6, 3, 12].includes(got) || got === 15, `a third of 18 by degree (${got})`);
  const probe = plan('milo', [A.strike('f0'), A.strike('f0'), A.strike('f0')]);
  const steadyB = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 2 })] }), [hero('milo', { abilityIds: ['steady-2', 'steady-3'] })], noNoise, ctx);
  const p2 = oddsFor(place(steadyB, 'milo', 1, 2), 'milo', probe.slots[1], ctx, { slot: 1, plan: probe })[0].parts;
  const p3 = oddsFor(place(steadyB, 'milo', 1, 2), 'milo', probe.slots[2], ctx, { slot: 2, plan: probe })[0].parts;
  assert.ok(!p2.some((p) => p.why === 'second attack'), 'steady second: no −1');
  assert.equal(p3.find((p) => p.why === 'third attack')?.n, -1, 'steady third: −1 instead of −2');
  const scribe = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('claude', { abilityIds: ['focus-a', 'focus-b', 'two-s'], charges: { pool: 'full', max: 4, left: 4, circle: 1 } })], noNoise, ctx);
  const onA = applyUse(scribe, 'claude', ctx.abilities.get('focus-a'), { cost: 2 }, ctx);
  const onB = applyUse(onA.battle, 'claude', ctx.abilities.get('focus-b'), { cost: 2 }, ctx);
  assert.equal(onB.battle.sustained.length, 2, 'two sustained at once');
  const one = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('claude', { abilityIds: ['focus-a', 'focus-b'], charges: { pool: 'full', max: 4, left: 4, circle: 1 } })], noNoise, ctx);
  const oneB = applyUse(applyUse(one, 'claude', ctx.abilities.get('focus-a'), { cost: 2 }, ctx).battle, 'claude', ctx.abilities.get('focus-b'), { cost: 2 }, ctx);
  assert.deepEqual(oneB.battle.sustained.map((s) => s.abilityId), ['focus-b'], 'one at a time without it');
  const drones = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('codex', { abilityIds: ['bench-drone', 'two-d'] })], noNoise, ctx);
  const again = applyUse(drones, 'codex', ab({ id: 'another', outcome: false, target: { who: 'tile', range: 3 }, effects: [{ do: 'summon', template: 'drone' }] }), { target: { tile: { x: 3, y: 3 } } }, ctx);
  assert.equal(again.battle.units.filter((u) => u.kind === 'drone').length, 2);
  const single = applyUse(tinker, 'codex', ab({ id: 'another', outcome: false, target: { who: 'tile', range: 3 }, effects: [{ do: 'summon', template: 'drone' }] }), { target: { tile: { x: 3, y: 3 } } }, ctx);
  assert.equal(single.battle.units.filter((u) => u.kind === 'drone').length, 1);
});

test('sustained spells end in each of their four ways: not sustained, the caster offline, the fight’s end, and after 10 rounds', () => {
  const heart = ab({ id: 'take-heart', kind: 'spell', circle: 1, sustained: { max: 10 }, costs: [2], helpful: true, outcome: false, target: { who: 'self' }, effects: [{ do: 'mod', stat: 'edge-first-each-turn', by: 1, until: 'sustained' }] });
  const ctx = ruleCtx([heart]);
  const make = () => createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('claude', { abilityIds: ['take-heart'], charges: { pool: 'full', max: 4, left: 4, circle: 1 } }), hero('milo')], noNoise, ctx);
  let r = round(make(), ctx, { claude: [A.use('take-heart', null, { cost: 2 })] });
  assert.equal(r.battle.sustained.length, 1);
  const lapse = round(r.battle, ctx, { claude: [A.brace()] });
  assert.equal(lapse.battle.sustained.length, 0, 'ends when not sustained in a round');
  assert.ok(!findUnit(lapse.battle, 'claude').mods.some((m) => m.until === 'sustained'));
  let kept = r.battle;
  // Nothing else happens in these rounds, so the standoff count is held at 0 to let all ten run (§18.2).
  for (let i = 0; i < 12 && kept.sustained.length; i += 1) kept = round({ ...kept, quiet: 0 }, ctx, { claude: [A.sustain('take-heart')] }).battle;
  assert.equal(kept.sustained.length, 0, 'after 10 rounds');
  assert.ok(kept.round >= 11);
  const off = makeRun(r.battle, ctx);
  landHit(off, { targetId: 'claude', amount: 99, kind: 'plain', degree: 'hit', reactions: false });
  assert.equal(off.b.sustained.length, 0, 'the caster going offline ends it');
  const ended = apply(r.battle, { t: 'end', outcome: 'won', why: 'seam-closed' }, ctx);
  assert.equal(ended.battle.sustained.length, 0, 'the fight’s end ends it');
});

test('a kind’s calm resets to 0 when any harmful outcome lands on one of that kind; enough calm settles the whole kind', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const { b } = setup({ heroes: ['milo', 'claude'], foes: [stray('f0', { x: 3, y: 2, temperament: 'polite' }), stray('f1', { x: 5, y: 2, temperament: 'polite' })], ctx });
  const x = place(b, 'milo', 2, 2);
  const talked = round(x, ctx, { claude: [A.talk('f1')] });
  assert.equal(talked.battle.talk.k0.calm, 1);
  let reset = false;
  for (let s = 1; s < 10 && !reset; s += 1) {
    const r = round({ ...talked.battle, seed: s }, ctx, { milo: [A.strike('f0')] });
    if (r.events.some((e) => e.t === 'damage' && e.target === 'f0')) {
      assert.equal(r.battle.talk.k0.calm, 0);
      assert.ok(r.events.some((e) => e.t === 'calm' && e.calm === 0));
      reset = true;
    }
  }
  assert.ok(reset);
  const two = round(talked.battle, ctx, { claude: [A.talk('f1')] });
  assert.ok(two.battle.talk.k0.done);
  assert.deepEqual(two.battle.units.filter((u) => u.side === 'foe').map((u) => u.sorted), ['talked', 'talked']);
  assert.equal(two.battle.status, 'talked');
});

// ---------- attacks through act, arcs, lines, Spooked and Unseen (fixes, round 1) ----------

/** Steps to the round's end; for each step where `who` picks, oddsFor on the Battle just before it and the outcomes it used. */
function stepChecked(b, ctx, who) {
  const picks = [];
  let x = b;
  while (x.status === 'running' || x.status === 'asking') {
    if (x.status === 'asking') {
      x = apply(x, { t: 'answer', yes: true }, ctx).battle;
      continue;
    }
    const entry = x.schedule[x.cursor];
    const before = x;
    const r = apply(x, { t: 'step' }, ctx);
    x = r.battle;
    const used = r.events.filter((e) => e.t === 'outcome' && !e.by && e.unit === who);
    if (entry?.unitId === who && used.length) {
      const action = before.plans[who].slots[entry.slot];
      picks.push({ action, used, after: x, events: r.events, shown: oddsFor(before, who, action, ctx, { slot: entry.slot, plan: before.plans[who] }) });
    }
  }
  return { battle: x, picks };
}

const heatsIn = (events, who, rnd = 1) => events.filter((e) => e.t === 'heat' && e.unit === who && e.round === rnd).map((e) => e.heat);

test('an ability that Strikes through act is one attack: counted once at 20 heat, with the odds it shows', () => {
  const ctx = quietCtx();
  const f0 = stray('f0', { x: 2, y: 1, integrity: 99, maxIntegrity: 99 });
  const { b } = setup({ heroes: [hero('codex', { abilityIds: ['pommel-tap'], uses: { 'pommel-tap': 3 } })], foes: [f0], ctx });
  const tap = A.use('pommel-tap', { unit: 'f0' });
  const c = play(b, [{ t: 'plan', unitId: 'codex', plan: plan('codex', [tap, tap]) }, { t: 'commit' }], ctx);
  const { picks } = stepChecked(c.battle, ctx, 'codex');
  assert.equal(picks.length, 2);
  for (const p of picks) assert.deepEqual(p.used.map((e) => e.bars), p.shown.map((o) => o.bars), 'the bars shown are the bars used');
  assert.deepEqual(picks.map((p) => p.shown[0].heat), [30, 50], 'the first at idle heat, the second 20 hotter, once');
  assert.deepEqual(picks.map((p) => p.shown[0].parts.find((x) => /attack/.test(x.why))?.n ?? 0), [0, -1], 'only the second takes −1');
  assert.equal(findUnit(picks[0].after, 'codex').attacks, 1, 'one use, one attack');
  assert.deepEqual(heatsIn(picks.flatMap((p) => p.events), 'codex'), [50]);
});

test('Volley is one attack whatever it catches, and a reaction’s shot never counts', () => {
  const bow = { amount: 7, kind: 'spark', reach: 1, range: 12, weapon: 'ranged' };
  const foes = [stray('f0', { x: 6, y: 2, integrity: 99, maxIntegrity: 99 }), stray('f1', { x: 7, y: 2, talkKind: 'k1', integrity: 99, maxIntegrity: 99 }), stray('f2', { x: 6, y: 3, talkKind: 'k2', integrity: 99, maxIntegrity: 99 })];
  const ctx = quietCtx();
  const { b } = setup({ heroes: [hero('codex', { abilityIds: ['volley'], strike: bow })], foes, ctx });
  const c = play(b, [{ t: 'plan', unitId: 'codex', plan: plan('codex', [A.strike('f0'), A.use('volley', { tile: { x: 6, y: 2 } }, { cost: 2 })]) }, { t: 'commit' }], ctx);
  const { picks } = stepChecked(c.battle, ctx, 'codex');
  const volley = picks.find((p) => p.action.id === 'use');
  assert.equal(volley.used.length, 3, 'one pick per foe it catches');
  assert.deepEqual(volley.used.map((e) => e.bars), volley.shown.map((o) => o.bars));
  assert.ok(volley.shown.every((o) => o.heat === 50 && o.parts.some((x) => x.why === 'second attack' && x.n === -1)), 'every piece is the second attack');
  assert.deepEqual(heatsIn(picks.flatMap((p) => p.events), 'codex'), [50], 'its heat lands once');
  assert.equal(findUnit(picks.find((p) => p.action.id === 'strike').after, 'codex').attacks, 1, 'the Strike was the first');
  // Ready a shot fires as the beetle strides in sight; Codex's own Strike after it is still the first attack.
  const walkIn = quietCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 9, y: 2 }, { x: 8, y: 2 }])], { by: 'foe' }) });
  const shot = setup({ heroes: [hero('codex', { abilityIds: ['ready-a-shot'], strike: bow })], foes: [stray('f0', { x: 10, y: 2, integrity: 99, maxIntegrity: 99 })], ctx: walkIn });
  const c2 = play(shot.b, [{ t: 'plan', unitId: 'codex', plan: plan('codex', [A.brace(), A.strike('f0')]) }, { t: 'commit' }], walkIn);
  const all = [...c2.events, ...playRound(c2.battle, walkIn).events];
  assert.ok(all.some((e) => e.t === 'reaction' && e.id === 'ready-a-shot'), 'the shot fired');
  const strike = stepChecked(c2.battle, walkIn, 'codex').picks.find((p) => p.action.id === 'strike');
  assert.deepEqual(strike.used.map((e) => e.bars), strike.shown.map((o) => o.bars));
  assert.equal(strike.shown[0].heat, 30, 'no heat from the reaction');
  assert.ok(!strike.shown[0].parts.some((x) => /attack/.test(x.why)), 'and no −1: it’s the turn’s first attack');
  assert.deepEqual(heatsIn(all, 'codex'), [], 'nothing warmed Codex this round');
});

test('a move that opens with Being sure on its user lands its own pick one degree better, and the odds show it', () => {
  const ctx = quietCtx();
  const plainSnap = ab({ id: 'snap', kind: 'move', attack: true, meets: 'guard', target: { who: 'foe', range: 6 }, effects: [{ do: 'damage', line: 'one', kind: 'caster' }] });
  const { b } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 4, y: 1, integrity: 99, maxIntegrity: 99 })], ctx });
  const bars = (a) => applyUse(b, 'milo', a, { target: { unit: 'f0' } }, ctx).events.find((e) => e.t === 'outcome').bars;
  const trick = applyUse(b, 'milo', abilities.get('snap-trick'), { target: { unit: 'f0' } }, ctx);
  assert.deepEqual(trick.events.find((e) => e.t === 'outcome').bars, foldBars(bars(plainSnap), { sure: true }));
  const action = A.use('snap-trick', { unit: 'f0' });
  assert.deepEqual(oddsFor(b, 'milo', action, ctx, { plan: plan('milo', [action]) })[0].bars, foldBars(bars(plainSnap), { sure: true }), 'shown as used');
  assert.deepEqual(findUnit(trick.battle, 'milo').mods.filter((m) => m.stat === 'degree-next-on-foe'), [], 'spent on its own pick');
  const shake = ab({ id: 'shake', kind: 'move', costs: [2], target: { who: 'self', range: 0, area: { shape: 'burst', size: 1, at: 'self' }, hits: 'foes' }, effects: [{ do: 'mod', stat: 'degree-next-on-foe', by: 1, until: 'next-effect', to: 'self' }, { do: 'condition', id: 'tumbled', min: 'hit' }] });
  const empty = applyUse(b, 'milo', shake, { cost: 2 }, ctx);
  assert.equal(empty.events.filter((e) => e.t === 'outcome').length, 0, 'nobody beside Milo');
  assert.deepEqual(findUnit(empty.battle, 'milo').mods.filter((m) => m.stat === 'degree-next-on-foe'), [], 'and it never lifts his next attack');
});

test('a line anchored at its user runs from the user toward the aimed tile, for the use, its odds and a telegraph', () => {
  const ctx = quietCtx();
  const foes = [stray('f0', { x: 3, y: 1, integrity: 99, maxIntegrity: 99 }), stray('f1', { x: 4, y: 1, talkKind: 'k1', integrity: 99, maxIntegrity: 99 }), stray('f2', { x: 3, y: 3, talkKind: 'k2' })];
  const { b } = setup({ heroes: ['claude'], foes, ctx });
  const use = { cost: 2, target: { tile: { x: 8, y: 1 } } };
  const r = applyUse(b, 'claude', abilities.get('ink-line'), use, ctx);
  assert.deepEqual(r.events.filter((e) => e.t === 'outcome').map((e) => e.target), ['f0', 'f1'], 'both in the line, not f2');
  const action = A.use('ink-line', use.target, { cost: 2 });
  assert.equal(oddsFor(b, 'claude', action, ctx, { plan: plan('claude', [action]) }).length, 2);
  const [t] = plainTelegraphs(b, 'claude', plan('claude', [action]), ctx);
  assert.deepEqual(t.tiles, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }], 'four tiles out from the Scribe');
});

test('a Spark hit in a puddle arcs half that hit to everyone else in it, once', () => {
  const ctx = quietCtx();
  const foes = [stray('f0', { x: 5, y: 2 }), stray('f1', { x: 6, y: 2, talkKind: 'k1' }), stray('f2', { x: 7, y: 2, talkKind: 'k2' })].map((f) => ({ ...f, maxIntegrity: 100, integrity: 100, resist: {}, weak: {} }));
  const surfaces = [4, 5, 6, 7, 8].map((x) => ({ x, y: 2, id: 'neon-puddle', rounds: null }));
  const { b } = setup({ heroes: ['milo'], foes, ctx, fight: { surfaces } });
  const run = makeRun(b, ctx);
  landHit(run, { userId: 'milo', targetId: 'f0', amount: 10, kind: 'spark', degree: 'hit' });
  assert.deepEqual(run.events.filter((e) => e.t === 'damage').map((e) => `${e.target}:${e.amount}`), ['f0:10', 'f1:5', 'f2:5']);
  assert.deepEqual(run.b.units.filter((u) => u.side === 'foe').map((u) => u.integrity), [90, 95, 95]);
  assert.ok(run.b.units.filter((u) => u.side === 'foe').every((u) => u.conditions.some((c) => c.id === 'sparked')));
});

test('Spooked: no move may end a step closer to what spooked it; a Stride straight at it improvises', () => {
  const ctx = quietCtx();
  const { b } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 9, y: 2 })], ctx });
  const spooked = place(b, 'milo', 5, 2, { conditions: [{ id: 'spooked', n: 2, source: 'f0', data: null }] });
  const at = (r) => [findUnit(r.battle, 'milo').x, findUnit(r.battle, 'milo').y];
  const toward = round(spooked, ctx, { milo: [A.stride([{ x: 6, y: 2 }, { x: 7, y: 2 }])] });
  assert.ok(toward.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'spooked'), 'Milo Braces instead');
  assert.deepEqual(at(toward), [5, 2]);
  const around = round(spooked, ctx, { milo: [A.stride([{ x: 5, y: 3 }, { x: 6, y: 3 }])] });
  assert.deepEqual(at(around), [5, 3], 'the sideways step is fine; the next would be closer');
  assert.deepEqual(at(round(spooked, ctx, { milo: [A.stride([{ x: 4, y: 2 }, { x: 3, y: 2 }])] })), [3, 2], 'away is fine');
});

test('Unseen ends on a Shove; a ghost is Unseen in the dark; a light arriving finds hiders', () => {
  const ctx = quietCtx();
  const sneak = setup({ heroes: ['milo'], foes: [stray('f0', { x: 2, y: 1 })], ctx, opts: { sneak: 'unseen' } });
  assert.ok(findUnit(sneak.b, 'milo').conditions.some((c) => c.id === 'unseen'));
  const shove = round(sneak.b, ctx, { milo: [A.shove('f0')] });
  assert.ok(shove.events.some((e) => e.t === 'condition' && e.target === 'milo' && e.id === 'unseen' && !e.on), 'the Shove gives Milo away');
  // A ghost in a dark room starts out of sight; a Little light finds it; stepping back into the dark hides it again.
  const dark = { lights: OPEN.map((row) => 'D'.repeat(row.length)) };
  const ghost = stray('f0', { x: 13, y: 2, archetype: 'ghost', genre: 'gothic' });
  const g = setup({ heroes: ['milo', 'claude'], foes: [ghost], ctx, fight: { arenaOpts: dark } });
  assert.ok(findUnit(g.b, 'f0').conditions.some((c) => c.id === 'unseen'), 'Unseen in the dark');
  const lit = applyUse(place(g.b, 'claude', 9, 2, { abilityIds: ['little-light'] }), 'claude', abilities.get('little-light'), { target: { tile: { x: 12, y: 2 } } }, ctx);
  assert.ok(lit.events.some((e) => e.t === 'reveal' && e.unit === 'f0' && e.what === 'unseen'));
  assert.ok(!findUnit(lit.battle, 'f0').conditions.some((c) => c.id === 'unseen'), 'found in the light');
  const back = makeRun(lit.battle, ctx);
  moveAlong(back, 'f0', [{ x: 14, y: 3 }, { x: 14, y: 4 }], 'stride');
  assert.ok(back.b.units.find((u) => u.id === 'f0').conditions.some((c) => c.id === 'unseen'), 'back in the dark, back out of sight');
  // A lamp lit through Interact finds a hider in its light.
  const lamp = { id: 'o0', kind: 'lamp', x: 12, y: 3, state: 'dark', flags: [], integrity: null };
  const h = setup({ heroes: ['milo'], foes: [stray('f0', { x: 13, y: 3 })], ctx, fight: { arenaOpts: dark, objects: [lamp] } });
  const hidden = place(place(h.b, 'f0', 13, 3, { conditions: [{ id: 'unseen', n: null, source: null, data: null }] }), 'milo', 11, 3);
  const on = makeRun(hidden, ctx);
  interact(on, on.b.units.find((u) => u.id === 'milo'), A.interact({ object: 'o0' }));
  assert.ok(on.events.some((e) => e.t === 'reveal' && e.unit === 'f0'), 'the lamp finds the beetle');
});

test('a readied slot is checked like any other before it fires: one that can’t happen never does', () => {
  const walkIn = quietCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 9, y: 2 }, { x: 8, y: 2 }])], { by: 'foe' }) });
  const { b } = setup({ heroes: ['milo'], foes: [stray('f0', { x: 10, y: 2 })], ctx: walkIn, opts: { warding: 10 } });
  const r = round(b, walkIn, { milo: [A.ready('foe-moves-in-sight'), A.jump({ x: -1, y: 1 })] });
  assert.ok(!r.events.some((e) => e.t === 'move' && e.unit === 'milo'), 'no leap off the arena');
  assert.ok(!r.events.some((e) => e.t === 'reaction' && e.unit === 'milo'), 'so no reaction is spent');
  assert.ok(r.events.some((e) => e.t === 'lost' && e.unit === 'milo' && e.why === 'wont-fit'), 'it’s lost at the round’s end');
  assert.deepEqual([findUnit(r.battle, 'milo').x, findUnit(r.battle, 'milo').y], [1, 1]);
});
