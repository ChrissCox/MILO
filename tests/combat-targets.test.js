// Targets, moves and costs (module B: src/combat/battle.js, abilities.js, effects.js, round.js;
// CONTRACT-PHASE4.md §4.4, §5.5, §6.1–§6.3, §6.5; COMBAT.md §5, §7): an Unseen unit struck and thrown
// at, at −2, in play, a pair swapped once after both picks, `into: 'dim'` and `need` on a tile (the
// Hooklight left out for the party), a teleport onto a taken tile refused with its use kept, a stitched
// genre's rule only, §4.4's costs whatever a plan claims, once per target a round, a Dip kept for the
// next Strike, Take heart on any first action, and devices that act only when commanded.
//   node --test tests/combat-targets.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { oddsFor, legalActions } from '../src/combat/battle.js';
import { applyUse } from '../src/combat/effects.js';
import { buildAbilityIndex, dimTile } from '../src/combat/abilities.js';
import { createGrid } from '../src/combat/grid.js';
import { ticksOf, oddsAgainst } from '../src/combat/round.js';
import { hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ab, ABILITIES } from './combat-kit.js';

const noNoise = { calm: { noise: false, adaptation: true } };
const still = (id) => plan(id, [], { by: 'foe' });
const place = (b, id, x, y, patch = {}) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, x, y, ...patch } : u)) });
const patchUnit = (b, id, patch) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const withAbilities = (extra, opts = {}) => makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, ...extra] } }), ...opts });
const at = (b, id) => [findUnit(b, id).x, findUnit(b, id).y];
const unseen = [{ id: 'unseen', n: null, source: null, data: null }];

function round(b, ctx, plans) {
  const c = play(b, [...Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) })), { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { battle: r.battle, events: [...c.events, ...r.events] };
}

// ---------- Unseen ----------

test('an Unseen unit can still be struck, at −2: the Strikes on it resolve in play with the odds shown', () => {
  // A foe that isn't surprised Strikes an Unseen Milo twice.
  const twice = plan('f0', [A.strike('milo'), A.strike('milo')], { by: 'foe' });
  const ctx = makeCtx({ foePlan: () => twice });
  const made = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, integrity: 60, maxIntegrity: 60 })] }), [hero('milo')], { ...noNoise, sneak: 'unseen' }, ctx);
  const b = patchUnit(made, 'f0', { mods: [] });
  assert.ok(findUnit(b, 'milo').conditions.some((c) => c.id === 'unseen'));
  const shown = [0, 1].map((slot) => oddsFor(b, 'f0', b.plans.f0.slots[slot], ctx, { slot, plan: b.plans.f0 })[0]);
  for (const o of shown) assert.equal(o.parts.find((p) => p.why === 'Unseen')?.n, -2, 'Unseen −2 on the row');
  const r = round(b, ctx, { milo: [] });
  const picks = r.events.filter((e) => e.t === 'outcome' && e.unit === 'f0' && e.target === 'milo');
  assert.equal(picks.length, 2, 'both Strikes pick');
  assert.deepEqual(picks.map((e) => e.bars), shown.map((o) => o.bars), 'with the bars shown');
  assert.ok(!r.events.some((e) => (e.t === 'lost' || e.t === 'improvise') && e.unit === 'f0'), 'none is lost');
  // Milo, with his lantern down, Strikes an Unseen foe: offered, picked with its row, and it stays hidden.
  const ctx2 = makeCtx({ foePlan: (bb, id) => still(id) });
  const base = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1, integrity: 60, maxIntegrity: 60 })] }), [hero('milo')], noNoise, ctx2);
  const b2 = { ...patchUnit(base, 'f0', { conditions: unseen }), lights: base.lights.map((l) => ({ ...l, radius: 0 })) };
  const options = legalActions(b2, 'milo', ctx2);
  assert.deepEqual(options.find((o) => o.action.id === 'strike').targets, [{ unit: 'f0' }], 'a Strike target');
  assert.ok(options.find((o) => o.action.ability === 'mote').targets.some((t) => t.unit === 'f0'), 'and an ability’s');
  assert.ok(options.find((o) => o.action.id === 'throw' && !o.action.ability).targets.some((t) => t.unit === 'f0'), 'and a Throw’s');
  const p = plan('milo', [A.strike('f0')]);
  const row = oddsFor(b2, 'milo', p.slots[0], ctx2, { plan: p })[0];
  assert.equal(row.parts.find((x) => x.why === 'Unseen')?.n, -2);
  const r2 = round(b2, ctx2, { milo: p.slots });
  const pick = r2.events.find((e) => e.t === 'outcome' && e.unit === 'milo' && e.target === 'f0');
  assert.deepEqual(pick?.bars, row.bars, 'Milo’s Strike picks with the row shown');
  assert.ok(findUnit(r2.battle, 'f0').conditions.some((c) => c.id === 'unseen'), 'being struck doesn’t reveal it; attacking, a light or a Seek does');
  // The Throw the planner offered resolves too: shown at −2, not refused, and picked with that row.
  const thrown = plan('milo', [A.throw('f0')]);
  const throwRow = oddsFor(b2, 'milo', thrown.slots[0], ctx2, { plan: thrown })[0];
  assert.equal(throwRow.parts.find((x) => x.why === 'Unseen')?.n, -2);
  const r3 = round(b2, ctx2, { milo: thrown.slots });
  assert.ok(!r3.events.some((e) => (e.t === 'lost' || e.t === 'improvise') && e.unit === 'milo'), 'the Throw isn’t refused');
  assert.equal(r3.events.find((e) => e.t === 'act' && e.unit === 'milo')?.action.id, 'throw');
  assert.deepEqual(r3.events.find((e) => e.t === 'outcome' && e.unit === 'milo' && e.target === 'f0')?.bars, throwRow.bars, 'Milo’s Throw picks with the row shown');
});

// ---------- a pair's swap ----------

const swapTwo = ab({ id: 'swap-two', kind: 'feature', meets: 'mind', costs: [2], target: { who: 'unit', range: 6, hits: 'all', count: 2 }, effects: [{ do: 'move', who: 'target', how: 'swap', tiles: 6 }] });
const swapAllies = ab({ id: 'swap-allies', kind: 'feature', helpful: true, outcome: false, target: { who: 'ally-or-self', range: 6, hits: 'allies-and-self', count: 2 }, effects: [{ do: 'move', who: 'target', how: 'swap', tiles: 6 }] });

test('a picked pair swaps places once, after both picks, only when every foe’s pick landed; a Large foe that won’t fit stays put', () => {
  const ctx = withAbilities([swapTwo, swapAllies]);
  const entry = [{ x: 1, y: 1 }, { x: 5, y: 2 }, { x: 3, y: 4 }];
  const make = (seed, foes) => createBattle(fightSpec({ seed, foes, arenaOpts: { entry } }), [hero('milo'), hero('pip', { abilityIds: ['swap-two', 'swap-allies'] }), hero('claude')], noNoise, ctx);
  const pair = () => [stray('f0', { x: 8, y: 2 }), stray('f1', { x: 8, y: 4, talkKind: 'k1' })];
  const allies = round(make(6, pair()), ctx, { pip: [A.use('swap-allies', { units: ['milo', 'claude'] })] });
  assert.deepEqual([at(allies.battle, 'milo'), at(allies.battle, 'claude')], [[3, 4], [1, 1]], 'two allies trade places');
  assert.equal(allies.events.filter((e) => e.t === 'move' && e.how === 'swap').length, 2, 'once: one move each');
  let landed = 0;
  let not = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const r = round(make(seed, pair()), ctx, { pip: [A.use('swap-two', { units: ['f0', 'f1'] }, { cost: 2 })] });
    const picks = r.events.filter((e) => e.t === 'outcome' && e.unit === 'pip');
    assert.deepEqual(picks.map((e) => e.target), ['f0', 'f1'], `seed ${seed}: one pick for each foe`);
    const both = picks.every((e) => e.degree === 'hit' || e.degree === 'crit');
    assert.deepEqual([at(r.battle, 'f0'), at(r.battle, 'f1')], both ? [[8, 4], [8, 2]] : [[8, 2], [8, 4]], `seed ${seed}: ${picks.map((e) => e.degree)}`);
    assert.equal(r.events.filter((e) => e.t === 'move' && e.how === 'swap').length, both ? 2 : 0);
    if (both) landed += 1;
    else not += 1;
  }
  assert.ok(landed > 3 && not > 3, `both ways met (${landed} swapped, ${not} not)`);
  // A Large foe can't stand where a small one stood against the wall, so they don't swap even on two Hits.
  let tried = 0;
  for (let seed = 1; seed <= 200 && tried < 3; seed += 1) {
    const b = place(make(seed, [stray('f0', { x: 8, y: 2, size: 2 }), stray('f1', { x: 14, y: 4, talkKind: 'k1' })]), 'pip', 10, 1);
    const r = round(b, ctx, { pip: [A.use('swap-two', { units: ['f0', 'f1'] }, { cost: 2 })] });
    const picks = r.events.filter((e) => e.t === 'outcome' && e.unit === 'pip');
    if (picks.length !== 2 || !picks.every((e) => e.degree === 'hit' || e.degree === 'crit')) continue;
    tried += 1;
    assert.deepEqual([at(r.battle, 'f0'), at(r.battle, 'f1')], [[8, 2], [14, 4]], `seed ${seed}: no room, no swap`);
    assert.ok(!r.events.some((e) => e.t === 'move' && e.how === 'swap'));
  }
  assert.equal(tried, 3);
});

// ---------- into: 'dim' and `need` on a tile ----------

const gothic = ab({ id: 'step-between-shadows', kind: 'feature', outcome: false, costs: [2], target: { who: 'tile', range: 6, need: ['dim-or-dark'] }, effects: [{ do: 'move', who: 'self', how: 'teleport', tiles: 6, into: 'dim' }] });
const blink = ab({ id: 'blink-to-shadow', kind: 'feature', outcome: false, target: { who: 'tile', range: 6 }, effects: [{ do: 'move', who: 'self', how: 'teleport', tiles: 6, into: 'dim' }] });
const shadeSnare = ab({ id: 'shade-snare', kind: 'feature', outcome: false, target: { who: 'tile', range: 6, need: ['dim-or-dark'] }, effects: [{ do: 'summon', template: 'snare' }] });
// A lit room with one dim corner: (13, 3), (14, 3), (13, 4) and (14, 4).
const CORNER = ['LLLLLLLLLLLLLLLL', 'LLLLLLLLLLLLLLLL', 'LLLLLLLLLLLLLLLL', 'LLLLLLLLLLLLLDDL', 'LLLLLLLLLLLLLDDL', 'LLLLLLLLLLLLLLLL'];

test('into: ‘dim’ steps onto a tile that isn’t Lit, the nearest when none is aimed at; an aimed Lit tile is refused, and so is a tile failing its need', () => {
  const ctx = withAbilities([gothic]);
  const make = (x, y, extra = {}) => place(createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })], arenaOpts: { lights: CORNER } }), [hero('milo'), hero('pip', { abilityIds: ['into-the-shadows', 'step-between-shadows'] })], noNoise, ctx), 'pip', x, y, extra);
  const opt = legalActions(make(12, 2), 'pip', ctx).find((o) => o.action.ability === 'into-the-shadows');
  assert.deepEqual([opt.targets, opt.why], [null, null], 'offered with no target, as the planner sends it');
  const hides = (r) => r.events.some((e) => e.t === 'outcome' && e.unit === 'pip' && e.target === null);
  // Nothing aimed at: the nearest tile that isn't Lit, then Hide.
  const free = round(make(12, 2), ctx, { pip: [A.use('into-the-shadows', null)] });
  assert.deepEqual(at(free.battle, 'pip'), [13, 3]);
  assert.ok(hides(free), 'and hides there, watched by the beetle');
  // Aimed at a dim tile: there. At a Lit one: refused, so no step and no Hide.
  assert.deepEqual(at(round(make(12, 2), ctx, { pip: [A.use('into-the-shadows', { tile: { x: 13, y: 3 } })] }).battle, 'pip'), [13, 3]);
  const lit = round(make(12, 2), ctx, { pip: [A.use('into-the-shadows', { tile: { x: 11, y: 2 } })] });
  assert.deepEqual(at(lit.battle, 'pip'), [12, 2], 'no step into the light');
  assert.ok(!hides(lit) && lit.events.some((e) => (e.t === 'lost' || e.t === 'improvise') && e.unit === 'pip'), 'it can’t happen, so it doesn’t');
  // No dim tile within a step and standing in the light: no step, and no Hide either.
  const far = round(make(6, 2), ctx, { pip: [A.use('into-the-shadows', null)] });
  assert.deepEqual(at(far.battle, 'pip'), [6, 2]);
  assert.ok(!hides(far));
  // Already in the dark: stays, and hides.
  const there = round(make(13, 4), ctx, { pip: [A.use('into-the-shadows', null)] });
  assert.deepEqual(at(there.battle, 'pip'), [13, 4]);
  assert.ok(hides(there));
  // Step between shadows: its `need` (dim-or-dark) holds on the tile, and so does `into`.
  assert.deepEqual(at(round(make(10, 2), ctx, { pip: [A.use('step-between-shadows', { tile: { x: 9, y: 2 } }, { cost: 2 })] }).battle, 'pip'), [10, 2], 'a Lit tile is refused');
  assert.deepEqual(at(round(make(10, 2), ctx, { pip: [A.use('step-between-shadows', { tile: { x: 13, y: 4 } }, { cost: 2 })] }).battle, 'pip'), [13, 4], 'a dim one is fine');
  // The Hooklight never spoils the party’s own shadows: a tile only it lights counts as dim for them (Decided).
  // Milo enters at (12, 4), so his lantern is there and lights the whole dim corner.
  const lanterned = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })], arenaOpts: { lights: CORNER, entry: [{ x: 12, y: 4 }, { x: 10, y: 2 }] } }),
    [hero('milo'), hero('pip', { abilityIds: ['step-between-shadows'] })], noNoise, ctx);
  assert.deepEqual([at(lanterned, 'milo'), at(lanterned, 'pip')], [[12, 4], [10, 2]]);
  const lantern = lanterned.lights.find((l) => l.id === 'hooklight');
  assert.deepEqual([lantern.x, lantern.y, lantern.radius], [12, 4, 5], 'the lantern is on Milo’s tile');
  const lg = createGrid(lanterned, ctx.rules);
  assert.deepEqual([lg.light(14, 3), lg.light(14, 3, { skip: 'hooklight' })], ['L', 'D'], '(14, 3) is Lit only by the Hooklight');
  assert.deepEqual([dimTile(lg, findUnit(lanterned, 'pip'), { x: 14, y: 3 }), dimTile(lg, findUnit(lanterned, 'f0'), { x: 14, y: 3 })], [true, false], 'dim for the party, Lit for a foe');
  assert.deepEqual(at(round(lanterned, ctx, { pip: [A.use('step-between-shadows', { tile: { x: 14, y: 3 } }, { cost: 2 })] }).battle, 'pip'), [14, 3], 'Pip steps into it');
  assert.deepEqual(at(applyUse(lanterned, 'f0', ctx.abilities.get('step-between-shadows'), { cost: 2, target: { tile: { x: 14, y: 3 } } }, ctx).battle, 'f0'), [8, 2], 'a foe can’t');
  // `need` alone refuses a Lit tile (a snare set only in the shadows), and `into` alone does too.
  const snares = withAbilities([shadeSnare, blink]);
  const s = place(createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })], arenaOpts: { lights: CORNER } }), [hero('milo'), hero('pip', { abilityIds: ['shade-snare', 'blink-to-shadow'] })], noNoise, snares), 'pip', 10, 2);
  const snared = (tile) => round(s, snares, { pip: [A.use('shade-snare', { tile })] }).battle.objects.some((o) => o.kind === 'snare');
  assert.deepEqual([snared({ x: 9, y: 2 }), snared({ x: 13, y: 3 })], [false, true]);
  assert.deepEqual(at(round(s, snares, { pip: [A.use('blink-to-shadow', { tile: { x: 9, y: 2 } })] }).battle, 'pip'), [10, 2]);
  // And as a use resolves, whoever sends it: a teleport or a step `into: 'dim'` never ends on a Lit tile.
  assert.deepEqual(at(applyUse(s, 'pip', snares.abilities.get('blink-to-shadow'), { target: { tile: { x: 9, y: 2 } } }, snares).battle, 'pip'), [10, 2]);
  assert.deepEqual(at(applyUse(s, 'pip', snares.abilities.get('blink-to-shadow'), { target: { tile: { x: 13, y: 3 } } }, snares).battle, 'pip'), [13, 3]);
  assert.deepEqual(at(applyUse(make(12, 2), 'pip', ctx.abilities.get('into-the-shadows'), { target: { tile: { x: 11, y: 2 } } }, ctx).battle, 'pip'), [12, 2]);
});

// ---------- a teleport onto a taken tile ----------

const hop = ab({ id: 'shadow-hop', kind: 'feature', outcome: false, costs: [2], uses: { per: 'breather', n: 1 }, target: { who: 'tile', range: 6 }, effects: [{ do: 'move', who: 'self', how: 'teleport', tiles: 6 }] });

test('a teleport aimed at a foe’s tile, an ally’s, a lever’s or a wall can’t happen: refused as it resolves, with its once-a-Breather use kept', () => {
  const ctx = withAbilities([hop]);
  const objects = [{ id: 'o0', kind: 'lever', x: 7, y: 3, state: 'up', flags: [], integrity: null }];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 2 })], objects, arenaOpts: { entry: [{ x: 5, y: 2 }, { x: 3, y: 2 }] } }),
    [hero('milo', { abilityIds: ['shadow-hop'], uses: { 'shadow-hop': 1 } }), hero('pip')], noNoise, ctx);
  const hopTo = (tile) => round(b, ctx, { milo: [A.use('shadow-hop', { tile }, { cost: 2 })] });
  // Taken tiles fail the free-tile check; a wall can't even be seen into.
  for (const [tile, why] of [[{ x: 8, y: 2 }, 'blocked'], [{ x: 3, y: 2 }, 'blocked'], [{ x: 7, y: 3 }, 'blocked'], [{ x: 8, y: 0 }, 'out-of-reach']]) {
    const r = hopTo(tile);
    const refused = r.events.find((e) => e.t === 'improvise' && e.unit === 'milo');
    assert.deepEqual([refused?.why, refused?.to.id], [why, 'brace'], `${tile.x},${tile.y}: refused, so Milo Braces`);
    assert.deepEqual(at(r.battle, 'milo'), [5, 2], 'no move');
    assert.ok(!r.events.some((e) => e.t === 'move' && e.unit === 'milo'));
    assert.equal(findUnit(r.battle, 'milo').uses['shadow-hop'], 1, 'and the use isn’t spent');
  }
  const free = hopTo({ x: 9, y: 3 });
  assert.deepEqual(at(free.battle, 'milo'), [9, 3], 'a free tile is fine');
  assert.equal(findUnit(free.battle, 'milo').uses['shadow-hop'], 0);
});

// ---------- a genre you've stitched ----------

const borrow = ab({
  id: 'borrow-two', kind: 'feature', outcome: false, costs: [2], uses: { per: 'breather', n: 1 }, requires: ['stitched-genre'],
  choices: {
    iron: { words: 'Borrow Iron: go Brisk', target: { who: 'ally-or-self', range: 6 }, effects: [{ do: 'condition', id: 'brisk' }] },
    frontier: { words: 'Borrow Frontier: first in every tick', target: { who: 'self', range: 0 }, effects: [{ do: 'rule', id: 'first-in-tick' }] },
  },
});

test('a genre’s rule is lent only once that genre is stitched (COMBAT §5): the others are greyed, and refused in play with the use kept', () => {
  const ctx = withAbilities([borrow]);
  const make = (stitched) => createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }),
    [hero('milo', { abilityIds: ['borrow-two'], uses: { 'borrow-two': 1 }, carry: { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched } }), hero('pip')], noNoise, ctx);
  const offered = (b) => Object.fromEntries(legalActions(b, 'milo', ctx).filter((o) => o.action.ability === 'borrow-two').map((o) => [o.action.choice, o.why]));
  assert.deepEqual(offered(make([])), { iron: 'No genre stitched yet', frontier: 'No genre stitched yet' });
  const ironOnly = make(['iron']);
  assert.deepEqual(offered(ironOnly), { iron: null, frontier: 'Not a genre you’ve stitched' });
  assert.deepEqual(offered(make(['frontier', 'iron'])), { iron: null, frontier: null });
  // In play: Frontier, not stitched, can't happen, and the once-a-Breather use is kept.
  const refused = round(ironOnly, ctx, { milo: [A.use('borrow-two', null, { cost: 2, choice: 'frontier' })] });
  const why = refused.events.find((e) => e.t === 'improvise' && e.unit === 'milo');
  assert.deepEqual([why?.why, why?.to.id], ['cant', 'brace']);
  assert.ok(!findUnit(refused.battle, 'milo').mods.some((m) => m.stat === 'first-in-tick'));
  assert.equal(findUnit(refused.battle, 'milo').uses['borrow-two'], 1, 'the use is kept');
  // Iron, stitched, lands and spends it.
  const lent = round(ironOnly, ctx, { milo: [A.use('borrow-two', { unit: 'pip' }, { cost: 2, choice: 'iron' })] });
  assert.ok(findUnit(lent.battle, 'pip').conditions.some((c) => c.id === 'brisk'), 'Pip goes Brisk');
  assert.equal(findUnit(lent.battle, 'milo').uses['borrow-two'], 0);
  // A plan naming no choice plays the first (Iron here), so it needs that genre too.
  const unnamed = (b) => round(b, ctx, { milo: [A.use('borrow-two', { unit: 'pip' }, { cost: 2 })] });
  assert.ok(findUnit(unnamed(ironOnly).battle, 'pip').conditions.some((c) => c.id === 'brisk'));
  assert.ok(unnamed(make(['frontier'])).events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'cant'));
});

// ---------- §4.4's costs ----------

test('a basic action costs §4.4’s actions whatever a plan claims; a Reboot costs 1 only while its ally’s mods allow it', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo'), hero('claude', { integrity: 0 }), hero('codex')], noNoise, ctx);
  assert.ok(findUnit(b, 'claude').offline);
  const planned = (slots) => apply(b, { t: 'plan', unitId: 'milo', plan: plan('milo', slots) }, ctx).battle.plans.milo.slots.map((a) => a.cost);
  assert.deepEqual(planned([{ ...A.reboot('claude'), cost: 1 }, A.brace(), A.brace()]), [2, 1, 1], 'a Reboot is 2');
  assert.deepEqual(planned([{ ...A.brace(), cost: 3 }, { ...A.ready('foe-enters-reach'), cost: 1 }, { ...A.strike('f0'), cost: 0 }, { ...A.delay(), cost: 2 }]), [1, 2, 1, 0]);
  assert.deepEqual(planned([{ ...A.stride([{ x: 2, y: 1 }]), cost: 3 }, { ...A.home(), cost: 1 }]), [1, 0]);
  assert.deepEqual(ticksOf(plan('milo', [{ ...A.brace(), cost: 3 }, A.brace()]), findUnit(b, 'milo')).map((t) => t.ends), [1, 2], 'ticksOf reads §4.4 too');
  const cheap = round(b, ctx, { milo: [{ ...A.reboot('claude'), cost: 1 }, A.brace(), A.brace()] });
  assert.equal(cheap.events.find((e) => e.t === 'act' && e.unit === 'milo' && e.action.id === 'reboot').tick, 2, 'a Reboot claimed at 1 still takes two ticks');
  assert.ok(cheap.events.some((e) => e.t === 'lost' && e.unit === 'milo' && e.why === 'wont-fit'), 'so the last Brace doesn’t fit');
  // Steady hand: the Offline ally's next Reboot costs 1, then the mod is spent.
  const eased = patchUnit(b, 'claude', { mods: [{ stat: 'reboot-cost', by: -1, until: 'fight', source: 'steady-hand' }] });
  const quick = round(eased, ctx, { milo: [{ ...A.reboot('claude'), cost: 1 }, A.brace(), A.brace()] });
  assert.equal(quick.events.find((e) => e.t === 'act' && e.unit === 'milo' && e.action.id === 'reboot').tick, 1);
  assert.equal(findUnit(quick.battle, 'claude').offline, false);
  assert.ok(!findUnit(quick.battle, 'claude').mods.some((m) => m.stat === 'reboot-cost'), 'for the next Reboot only');
  // A 1-action Reboot whose allowance has gone by the time it resolves can't happen: Milo Braces.
  const set = play(eased, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [{ ...A.reboot('claude'), cost: 1 }]) }, { t: 'commit' }], ctx).battle;
  const s = apply(patchUnit(set, 'claude', { mods: [] }), { t: 'step' }, ctx);
  assert.ok(s.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'cant' && e.to.id === 'brace'));
  assert.equal(findUnit(s.battle, 'claude').offline, true);
});

// ---------- once per target a round ----------

const soothe = ab({ id: 'soothe', kind: 'knack', helpful: true, uses: { per: 'target-round', n: 1 }, target: { who: 'ally', range: 1, need: ['below-half'] }, effects: [{ do: 'patch', line: 'one' }] });

test('once per target a round: Soothe patches each ally once a round, isn’t offered on them again, and comes back next round', () => {
  const ctx = withAbilities([soothe]);
  const made = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo', { abilityIds: ['soothe'] }), hero('claude', { integrity: 2 }), hero('codex', { integrity: 3 })], noNoise, ctx);
  const b = place(made, 'codex', 2, 1);
  const p = plan('milo', [A.use('soothe', { unit: 'claude' }), A.use('soothe', { unit: 'claude' }), A.use('soothe', { unit: 'codex' })]);
  const offered = (slot, pl = p) => legalActions(b, 'milo', ctx, { slot, plan: pl }).find((o) => o.action.ability === 'soothe');
  assert.deepEqual(offered(0).targets, [{ unit: 'claude' }, { unit: 'codex' }]);
  assert.deepEqual(offered(1).targets, [{ unit: 'codex' }], 'after the Scribe’s, only the Artificer is offered');
  const both = plan('milo', [A.use('soothe', { unit: 'claude' }), A.use('soothe', { unit: 'codex' }), A.brace()]);
  assert.deepEqual([offered(2, both).targets, offered(2, both).why], [[], 'Used on them this round']);
  const r = round(b, ctx, { milo: p.slots });
  assert.deepEqual(r.events.filter((e) => e.t === 'patch' && e.unit === 'milo').map((e) => e.target), ['claude', 'codex'], 'once each');
  assert.ok(r.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'cant'), 'the second on the Scribe can’t happen');
  const next = round(r.battle, ctx, { milo: [A.use('soothe', { unit: 'claude' })] });
  assert.ok(next.events.some((e) => e.t === 'patch' && e.unit === 'milo' && e.target === 'claude'), 'a new round, a new Soothe');
});

// ---------- the Dip ----------

test('a Dip waits for the next Strike: a Throw or a Shove first doesn’t use it up', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const surfaces = [{ x: 1, y: 2, id: 'candlefire', rounds: null }];
  const dipped = (b) => (findUnit(b, 'milo').mods || []).some((m) => m.stat === 'dip');
  for (const second of [A.throw('f0'), A.shove('f0')]) {
    let struck = 0;
    for (let seed = 1; seed <= 40 && struck < 2; seed += 1) {
      // A Large beetle, so a Shove's Hit can't push it out of reach.
      const b = createBattle(fightSpec({ seed, foes: [stray('f0', { x: 2, y: 1, size: 2, integrity: 90, maxIntegrity: 90 })], surfaces }), [hero('milo')], noNoise, ctx);
      let x = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.dip(), second, A.strike('f0')]) }, { t: 'commit' }], ctx).battle;
      x = apply(apply(x, { t: 'step' }, ctx).battle, { t: 'step' }, ctx).battle;
      assert.ok(dipped(x), `${second.id}: still dipped after it`);
      const s = apply(x, { t: 'step' }, ctx);
      const pick = s.events.find((e) => e.t === 'outcome' && e.unit === 'milo');
      assert.ok(pick, 'the Strike picks');
      assert.ok(!dipped(s.battle), 'the Strike uses it');
      const dmg = s.events.find((e) => e.t === 'damage' && e.unit === 'milo');
      if (pick.degree !== 'hit') continue;
      struck += 1;
      assert.deepEqual([dmg.kind, dmg.amount], ['light', 5 + 2], 'Light, and 2 more');
    }
    assert.equal(struck, 2);
  }
});

// ---------- Take heart ----------

test('Take heart’s +1 is on the first action each turn whatever it is: a Brace shows it and picks with it; a reaction never gets it', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const heart = [{ stat: 'edge-first-each-turn', by: 1, until: 'sustained', source: 'sustained:claude:take-heart' }];
  const b = patchUnit(createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), [hero('milo'), hero('claude')], noNoise, ctx), 'milo', { mods: heart });
  const p = plan('milo', [A.brace(), A.brace()]);
  const rows = [0, 1].map((slot) => oddsFor(b, 'milo', p.slots[slot], ctx, { slot, plan: p })[0]);
  assert.equal(rows[0].parts.find((x) => x.why === 'first action')?.n, 1, 'a helpful first action gets it');
  assert.ok(!rows[1].parts.some((x) => x.why === 'first action'), 'the second doesn’t');
  assert.notDeepEqual(rows[0].bars, rows[1].bars);
  const r = round(b, ctx, { milo: p.slots });
  assert.deepEqual(r.events.filter((e) => e.t === 'outcome' && e.unit === 'milo').map((e) => e.bars), rows.map((o) => o.bars), 'and picks with it');
  const strike = oddsAgainst(b, ctx, 'milo', 'f0', { harmful: true, meets: 'guard', attack: true }).parts;
  const swipe = oddsAgainst(b, ctx, 'milo', 'f0', { harmful: true, meets: 'guard', attack: true, reaction: true }).parts;
  assert.equal(strike.find((x) => x.why === 'first action')?.n, 1);
  assert.ok(!swipe.some((x) => x.why === 'first action'), 'a Parting swipe isn’t one of the three actions');
});

// ---------- devices ----------

test('a device takes no plan and acts only when it’s commanded', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 4, y: 3, integrity: 60, maxIntegrity: 60 })] }), [hero('milo'), hero('claude'), hero('codex')], noNoise, ctx);
  const d = b.units.find((u) => u.rank === 'device');
  assert.ok(d, 'the Bench drone stands ready');
  const refused = apply(b, { t: 'plan', unitId: d.id, plan: plan(d.id, [A.stride([{ x: d.x + 1, y: d.y }]), A.strike('f0'), A.strike('f0')]) }, ctx);
  assert.equal(refused.battle, b, 'its plan changes nothing');
  assert.deepEqual(refused.events, []);
  const idle = round(b, ctx, { milo: [A.brace()] });
  assert.ok(!idle.events.some((e) => e.unit === d.id && ['act', 'move', 'outcome'].includes(e.t)), 'uncommanded, it does nothing');
  const zapped = round(b, ctx, { codex: [A.use('drone-zap', { unit: 'f0' })] });
  assert.ok(zapped.events.some((e) => e.t === 'outcome' && e.unit === d.id && e.target === 'f0'), 'commanded, it zaps');
});
