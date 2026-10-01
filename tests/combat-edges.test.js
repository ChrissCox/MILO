// The kernel's smaller rules, each with its own assertion (module B: src/combat/*.js; CONTRACT-PHASE4.md
// §4.2, §4.4, §4.5, §4.17, §6.5, §7.1; COMBAT.md §4.3, §7): 0-action moves, which conditions wait for
// the next round, spawnFoe's creation effects, a repeated plan changing nothing, and the §4 and §6.5
// parts a test must catch when they go missing (Proofread on a foe, Seek 8, the ghost's round after a
// Light hit, Spooked by sight, heavy cover, a foe beside a ranged attack, an elite's own edge, the
// level cap at Road levels 1–2, hazards on Light only, Hearth 3 and 4, Unseen strike once a turn,
// Brace with a shield, the Charm Cheer, Chill on smog and on a neon puddle).
//   node --test tests/combat-edges.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRun, landHit, strikeDamage, doBrace, addCalm } from '../src/combat/effects.js';
import { ticksOf, surfaceReact } from '../src/combat/round.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { oddsFor, spawnFoe, saveBattle, restoreBattle } from '../src/combat/battle.js';
import { rules, hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ab, ABILITIES } from './combat-kit.js';

const noNoise = { calm: { noise: false, adaptation: true } };
const still = (id) => plan(id, [], { by: 'foe' });
const place = (b, id, x, y, patch = {}) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, x, y, ...patch } : u)) });
const patchUnit = (b, id, patch) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const passive = (id, list) => ab({ id, kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: list, summons: [] } });
const withAbilities = (extra, opts = {}) => makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, ...extra] } }), ...opts });
function round(b, ctx, plans) {
  const c = play(b, [...Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) })), { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { battle: r.battle, events: [...c.events, ...r.events] };
}
const partsOf = (b, ctx, id, action) => oddsFor(b, id, action, ctx, { plan: plan(id, [action]) })[0].parts;
const part = (parts, why) => parts.find((p) => p.why === why)?.n;

// ---------- 0-action moves ----------

test('a 0-action ability resolves in its tick without using it: Surge plus three actions all fit', () => {
  const surge = ab({ id: 'surge', kind: 'feature', costs: [0], outcome: false, uses: { per: 'campfire', n: 1 }, target: { who: 'self', range: 0 }, effects: [{ do: 'condition', id: 'quickened', n: 2 }] });
  const ctx = withAbilities([surge]);
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] }), [hero('milo', { abilityIds: ['surge', 'hooklight', 'mote'], uses: { surge: 1 } })], noNoise, ctx);
  const p = plan('milo', [A.use('surge', null, { cost: 0 }), A.brace(), A.brace(), A.brace()]);
  assert.deepEqual(ticksOf(p, findUnit(b, 'milo')).map((t) => [t.tick, t.ends, t.lost]), [[1, 1, null], [1, 1, null], [2, 2, null], [3, 3, null]]);
  const r = round(b, ctx, { milo: p.slots });
  const acts = r.events.filter((e) => e.t === 'act' && e.unit === 'milo');
  assert.deepEqual(acts.map((e) => [e.action.id, e.tick]), [['use', 1], ['brace', 1], ['brace', 2], ['brace', 3]], 'Surge first, then the Brace, both in tick 1');
  assert.ok(!r.events.some((e) => e.t === 'lost' && e.unit === 'milo'));
  // A 0 its ability doesn't list counts as 1 (Mote lists 1), and an unlisted cost is refused as it resolves.
  const set = apply(b, { t: 'plan', unitId: 'milo', plan: plan('milo', [A.use('mote', { unit: 'f0' }, { cost: 0 }), A.brace(), A.brace(), A.brace()]) }, ctx).battle;
  assert.equal(set.plans.milo.slots[0].cost, 1);
  assert.deepEqual(ticksOf(set.plans.milo, findUnit(set, 'milo')).map((t) => t.lost), [null, null, null, 'wont-fit']);
  const two = round(place(b, 'f0', 4, 2), ctx, { milo: [A.use('mote', { unit: 'f0' }, { cost: 2 })] });
  assert.ok(two.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.why === 'cant'), 'Mote for 2 isn’t Mote');
});

// ---------- conditions that wait for the next round ----------

test('only the tick-shaping conditions wait for the next round: a Dazzled 1 landed mid-round ends with it, a Slowed 1 takes the next round’s action', () => {
  const dazzle = ab({ id: 'dazzle', outcome: false, target: { who: 'foe', range: 8 }, effects: [{ do: 'condition', id: 'dazzled', n: 1 }] });
  const slow = ab({ id: 'slow-it', outcome: false, target: { who: 'foe', range: 8 }, effects: [{ do: 'condition', id: 'slowed', n: 1 }] });
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.brace(), A.brace(), A.brace()], { by: 'foe' }), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, dazzle, slow] } }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 2 })] }), [hero('milo', { abilityIds: ['dazzle', 'slow-it'] })], noNoise, ctx);
  const d = round(b, ctx, { milo: [A.use('dazzle', { unit: 'f0' })] });
  assert.ok(d.events.some((e) => e.t === 'condition' && e.target === 'f0' && e.id === 'dazzled' && e.on && e.round === 1));
  assert.ok(!findUnit(d.battle, 'f0').conditions.some((c) => c.id === 'dazzled'), 'Dazzled 1 counts down at the end of the round it landed in');
  const s = round(b, ctx, { milo: [A.use('slow-it', { unit: 'f0' })] });
  const slowed = findUnit(s.battle, 'f0').conditions.find((c) => c.id === 'slowed');
  assert.equal(slowed?.n, 1, 'Slowed 1 waits for the round it shapes');
  const next = round(s.battle, ctx, { milo: [A.brace()] });
  assert.deepEqual(next.events.filter((e) => e.t === 'lost' && e.unit === 'f0').map((e) => e.why), ['slowed'], 'round 2: one action lost');
  assert.ok(!findUnit(next.battle, 'f0').conditions.some((c) => c.id === 'slowed'), 'then it ends');
});

// ---------- spawnFoe and a repeated plan ----------

test('spawnFoe gives a foe the creation effects every foe gets: the mode’s scaling and a Talk down entry for its kind', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const fight = fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] });
  const story = createBattle(fight, [hero('milo')], { ...noNoise, mode: 'storybook' }, ctx);
  const made = findUnit(story, 'f0');
  const r = spawnFoe(story, stray('x', { talkKind: 'k7', temperament: 'shy' }), { x: 11, y: 2 }, ctx);
  const s0 = findUnit(r.battle, 's0');
  assert.deepEqual([s0.maxIntegrity, s0.integrity, s0.strike.amount, s0.level], [made.maxIntegrity, made.integrity, made.strike.amount, made.level], 'scaled as the created f0 was');
  assert.deepEqual(r.battle.talk.k7, { calm: 0, need: rules.temperaments.shy.talk, done: false }, 'its kind can be talked down');
  const firstLead = createBattle(fight, [hero('milo')], { ...noNoise, firstLead: true }, ctx);
  assert.equal(findUnit(spawnFoe(firstLead, stray('x'), { x: 11, y: 2 }, ctx).battle, 's0').maxIntegrity, made.maxIntegrity, 'the first lead’s fight is Storybook');
  const road = createBattle(fight, [hero('milo')], noNoise, ctx);
  assert.equal(findUnit(spawnFoe(road, stray('x'), { x: 11, y: 2 }, ctx).battle, 's0').maxIntegrity, findUnit(road, 'f0').maxIntegrity, 'Long Road: as built');
  const bare = spawnFoe(story, stray('x', { talkKind: 'k8' }), { x: 11, y: 2 });
  assert.ok(bare.battle.talk.k8, 'without ctx the kind still gets its entry');
  // Through a mechanic's roundStart (how leads.js makes clerks): scaled, planned, and restored as it was.
  const lead = stray('lead', { x: 12, y: 3, talkKind: null });
  lead.rank = 'lead';
  lead.size = 2;
  lead.lead = { mechanic: 'fallback', phases: 2, bars: [40, 40], quote: 'q' };
  const clerks = {
    id: 'fallback',
    roundStart: (bb, c) => (bb.round === 2 ? spawnFoe(bb, stray('clerk', { talkKind: 'k9', name: 'Clerk' }), { x: 9, y: 2 }, c) : { battle: bb, events: [] }),
  };
  const mctx = makeCtx({ foePlan: (bb, id) => still(id), mechanics: { fallback: clerks } });
  const leadFight = fightSpec({ kind: 'lead', leadUnit: lead, foes: [stray('f0', { x: 10, y: 2 })] });
  const lb = createBattle(leadFight, [hero('milo')], { ...noNoise, mode: 'storybook' }, mctx);
  const after = round(lb, mctx, { milo: [A.brace()] });
  const clerk = findUnit(after.battle, 's0');
  assert.equal(clerk.maxIntegrity, findUnit(lb, 'f0').maxIntegrity, 'the clerk is scaled like the room’s strays');
  assert.ok(after.battle.plans.s0 && after.battle.talk.k9);
  assert.ok(after.events.some((e) => e.t === 'spawn' && e.unit?.id === 's0'));
  const back = restoreBattle(JSON.parse(JSON.stringify(saveBattle(after.battle))), mctx, { fight: leadFight, heroes: [hero('milo')] });
  assert.deepStrictEqual(back, after.battle, 'and a scaled spawn restores as it was');
});

test('sending the same plan again returns the same battle; a changed Cheer or draft doesn’t', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })] }), [hero('milo')], { ...noNoise, cheers: 1 }, ctx);
  const p = plan('milo', [A.brace(), A.brace()]);
  const a1 = apply(b, { t: 'plan', unitId: 'milo', plan: p }, ctx);
  const a2 = apply(a1.battle, { t: 'plan', unitId: 'milo', plan: JSON.parse(JSON.stringify(p)) }, ctx);
  assert.equal(a2.battle, a1.battle);
  assert.deepEqual(a2.events, []);
  const cheered = apply(a1.battle, { t: 'plan', unitId: 'milo', plan: plan('milo', [{ ...A.brace(), cheer: true }, A.brace()]) }, ctx);
  assert.notEqual(cheered.battle, a1.battle);
  const draft = { confidence: 40, source: 'habit', choices: [], layers: ['habit', 'habit'] };
  const d1 = apply(a1.battle, { t: 'plan', unitId: 'milo', plan: { ...p, by: 'draft' }, draft }, ctx);
  assert.notEqual(d1.battle, a1.battle, 'a draft is new');
  assert.equal(apply(d1.battle, { t: 'plan', unitId: 'milo', plan: { ...p, by: 'draft' }, draft }, ctx).battle, d1.battle, 'the same draft again isn’t');
});

// ---------- §4 and §6.5 parts ----------

test('Proofread moves a foe’s outcome down a degree', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.strike('milo')], { by: 'foe' }) });
  const order = ['crit', 'hit', 'graze', 'miss'];
  let moved = 0;
  for (let s = 1; s <= 60; s += 1) {
    const b = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 3, y: 2 })] }), [hero('milo'), hero('claude', { reactions: { proofread: 'always' } })], noNoise, ctx);
    const r = round(place(place(b, 'milo', 2, 2), 'claude', 1, 4), ctx, { milo: [A.brace()], claude: [A.brace()] });
    const by = r.events.find((e) => e.t === 'outcome' && e.by === 'claude' && e.unit === 'f0');
    if (!by) continue;
    const first = r.events.find((e) => e.t === 'outcome' && !e.by && e.unit === 'f0');
    assert.equal(order.indexOf(by.degree), order.indexOf(first.degree) + 1, `seed ${s}: down one for a foe`);
    moved += 1;
  }
  assert.ok(moved >= 3, `moved ${moved}`);
});

test('Seek finds the Unseen within 6, and within 8 at Heed 3+', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const hidden = (who) => {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 9, y: 2 })] }), [hero(who)], noNoise, ctx);
    return patchUnit(place(b, who, 2, 2), 'f0', { conditions: [{ id: 'unseen', n: null, source: null, data: null }] });
  };
  const found = (who) => !findUnit(round(hidden(who), ctx, { [who]: [A.seek()] }).battle, 'f0').conditions.some((c) => c.id === 'unseen');
  assert.equal(found('milo'), true, 'Milo, Heed 3: 7 tiles is within 8');
  assert.equal(found('claude'), false, 'the Scribe, Heed 2: 7 tiles is past 6');
});

test('a ghost loses its Plain resistance for the round after a Light hit', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const ghost = stray('f0', { x: 10, y: 2, archetype: 'ghost', genre: 'gothic', resist: { plain: 3 }, weak: {}, integrity: 60, maxIntegrity: 60 });
  const b = createBattle(fightSpec({ genres: ['gothic'], foes: [ghost] }), [hero('claude')], noNoise, ctx);
  const cold = makeRun(b, ctx);
  assert.equal(landHit(cold, { targetId: 'f0', amount: 6, kind: 'plain', degree: 'hit', reactions: false }).amount, 3, 'resists Plain 3 outside the light');
  const lit = makeRun(b, ctx);
  landHit(lit, { targetId: 'f0', amount: 4, kind: 'light', degree: 'hit', reactions: false });
  assert.equal(landHit(lit, { targetId: 'f0', amount: 6, kind: 'plain', degree: 'hit', reactions: false }).amount, 6, 'after a Light hit: none');
});

test('Spooked is −1 only while it can see what spooked it', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const rows = ['##########', '#...#....#', '#...#....#', '#........#', '##########'];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1 }), stray('f1', { x: 6, y: 1, talkKind: 'k1' })], arenaRows: rows, arenaOpts: { entry: [{ x: 2, y: 1 }] } }), [hero('milo')], noNoise, ctx);
  const spooked = (b2) => patchUnit(b2, 'milo', { conditions: [{ id: 'spooked', n: 2, source: 'f1', data: null }] });
  assert.equal(part(partsOf(spooked(b), ctx, 'milo', A.strike('f0')), 'Spooked'), undefined, 'the spooker is behind the wall');
  assert.equal(part(partsOf(spooked(place(b, 'f1', 3, 3)), ctx, 'milo', A.strike('f0')), 'Spooked'), -1, 'in sight: −1');
});

test('heavy cover is −2, and a foe beside a ranged attack is −1', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const rows = ['############', '#..........#', '#..........#', '#......O...#', '#..........#', '############'];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 8, y: 3 }), stray('f1', { x: 2, y: 4, talkKind: 'k1' })], arenaRows: rows, arenaOpts: { entry: [{ x: 7, y: 2 }] } }), [hero('milo')], noNoise, ctx);
  assert.equal(part(partsOf(b, ctx, 'milo', A.strike('f0')), 'heavy cover'), -2, 'the pillar’s corner beside the target');
  const archer = hero('claude', { strike: { amount: 5, kind: 'ink', reach: 1, range: 12, weapon: 'ranged' } });
  const r = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 }), stray('f1', { x: 3, y: 2, talkKind: 'k1' })] }), [archer], noNoise, ctx);
  const beside = place(r, 'claude', 2, 2);
  assert.equal(part(partsOf(beside, ctx, 'claude', A.strike('f0')), 'a foe beside you'), -1);
  assert.equal(part(partsOf(place(r, 'claude', 2, 4), ctx, 'claude', A.strike('f0')), 'a foe beside you'), undefined, 'none beside: nothing');
});

test('an elite’s or lead’s own attacks are +1; at Road levels 1–2 nothing counts as more than 2 levels above', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const elite = stray('f0', { x: 3, y: 2, attackEdge: 1, rank: 'elite' });
  const b = createBattle(fightSpec({ foes: [elite] }), [hero('milo')], noNoise, ctx);
  assert.equal(part(partsOf(place(b, 'milo', 2, 2), ctx, 'f0', A.strike('milo')), 'its own attack'), 1);
  const big = stray('f0', { x: 3, y: 2, level: 6 });
  for (const [roadLevel, heroSees, foeSees] of [[1, -1, 1], [2, -1, 1], [3, -2, 2]]) {
    const x = place(createBattle(fightSpec({ foes: [big], level: 6 }), [hero('milo')], { ...noNoise, roadLevel }, ctx), 'milo', 2, 2);
    const mine = partsOf(x, ctx, 'milo', A.strike('f0')).find((p) => /levels below/.test(p.why));
    const theirs = partsOf(x, ctx, 'f0', A.strike('milo')).find((p) => /levels above/.test(p.why));
    assert.equal(mine?.n, heroSees, `Road level ${roadLevel}: Milo on the level-6 stray`);
    assert.equal(theirs?.n, foeSees, `Road level ${roadLevel}: the stray on Milo`);
  }
});

test('hazard props burst on a Light hit only', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const objects = [{ id: 'o0', kind: 'prop', x: 6, y: 2, state: 'oil-drum', flags: ['hazard', 'cover-low'], integrity: null }];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 5, y: 2, integrity: 60, maxIntegrity: 60 })], objects }), [hero('milo')], noNoise, ctx);
  for (const kind of ['plain', 'static', 'spark', 'ink', 'warp', 'chill']) {
    const run = makeRun(b, ctx);
    landHit(run, { userId: 'milo', targetId: 'f0', amount: 5, kind, degree: 'hit', reactions: false });
    assert.equal(run.b.objects[0].state, 'oil-drum', `${kind} doesn’t burst it`);
  }
  const lit = makeRun(b, ctx);
  landHit(lit, { userId: 'milo', targetId: 'f0', amount: 5, kind: 'light', degree: 'hit', reactions: false });
  assert.equal(lit.b.objects[0].state, 'rubble');
});

test('the Hearth path: allies in his light resist all damage by 2, 3 from level 5 and 4 from level 10', () => {
  const ctx = withAbilities([passive('hearth', ['hearth-path'])]);
  for (const [level, resist] of [[1, 2], [4, 2], [5, 3], [9, 3], [10, 4]]) {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] }), [hero('milo', { level, abilityIds: ['hearth', 'hooklight'] }), hero('claude')], noNoise, ctx);
    const run = makeRun(place(b, 'claude', 2, 1), ctx);
    assert.equal(landHit(run, { userId: 'f0', targetId: 'claude', amount: 9, kind: 'static', degree: 'hit', reactions: false }).amount, 9 - resist, `Milo level ${level}`);
  }
});

test('Unseen strike adds the one line once a turn', () => {
  const ctx = withAbilities([passive('unseen-strike', ['unseen-strike'])]);
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 80, maxIntegrity: 80 })] }), [hero('pip', { abilityIds: ['unseen-strike'] }), hero('claude')], noNoise, ctx);
  const run = makeRun(place(place(b, 'pip', 2, 2), 'claude', 3, 3), ctx);
  const pip = run.b.units.find((u) => u.id === 'pip');
  const f0 = run.b.units.find((u) => u.id === 'f0');
  assert.equal(strikeDamage(run, pip, f0).amount, 7 + 5, 'an ally beside the target: the one line');
  assert.equal(strikeDamage(run, pip, f0).amount, 7, 'once a turn');
  assert.equal(strikeDamage(run, pip, f0, { edge: 1 }).amount, 7, 'edge doesn’t make it twice');
});

test('Brace gives 3 + level Buffer, and 2 more with a shield, by degree', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const scale = { crit: 2, hit: 1, graze: 0.5, miss: 0.5 };
  let seen = 0;
  for (let s = 1; s <= 12; s += 1) {
    const b = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 10, y: 2 })] }), [hero('codex'), hero('milo')], noNoise, ctx);
    for (const [id, base] of [['codex', 3 + 1 + 2], ['milo', 3 + 1]]) {
      const run = makeRun(b, ctx);
      const { degree } = doBrace(run, id);
      assert.equal(run.b.units.find((u) => u.id === id).buffer, Math.floor(base * scale[degree]), `${id} (${degree})`);
      seen += 1;
    }
  }
  assert.equal(seen, 24);
});

test('with a Charm 3+ hero in the party, each kind talked down gives a Cheer', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  for (const [who, cheers] of [['pip', 1], ['milo', 0]]) {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] }), [hero(who)], noNoise, ctx);
    const run = makeRun(b, ctx);
    addCalm(run, run.b.units[0], 'k0', run.b.talk.k0.need);
    assert.equal(run.b.talk.k0.done, true);
    assert.equal(run.b.cheers, cheers, `${who}: Charm ${hero(who).abilities.charm}`);
  }
});

test('Chill clears smog in a 2 × 2 square and glazes a neon puddle to ice', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const surfaces = [
    { x: 3, y: 1, id: 'smog', rounds: null }, { x: 4, y: 1, id: 'smog', rounds: null }, { x: 3, y: 2, id: 'smog', rounds: null }, { x: 4, y: 2, id: 'smog', rounds: null },
    { x: 5, y: 1, id: 'smog', rounds: null }, { x: 9, y: 3, id: 'neon-puddle', rounds: null }, { x: 10, y: 3, id: 'neon-puddle', rounds: null },
  ];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 1 })], surfaces }), [hero('milo')], noNoise, ctx);
  const run = makeRun(b, ctx);
  surfaceReact(run, [{ x: 3, y: 1 }], 'chill');
  const at = (x, y) => run.b.surfaces.find((s) => s.x === x && s.y === y)?.id ?? null;
  assert.deepEqual([at(3, 1), at(4, 1), at(3, 2), at(4, 2)], [null, null, null, null], 'the 2 × 2 square is clear');
  assert.equal(at(5, 1), 'smog', 'past it, smog stays');
  surfaceReact(run, [{ x: 9, y: 3 }], 'chill');
  assert.deepEqual([at(9, 3), at(10, 3)], ['ice', 'ice']);
});

test('a Reboot brings an ally back at a quarter, Rattled 1 (−1 on everything it does) until its next Breather', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 4, y: 2 })] }), [hero('milo'), hero('claude')], noNoise, ctx);
  const down = patchUnit(place(place(b, 'milo', 2, 2), 'claude', 3, 3), 'claude', { offline: true, integrity: 0, drops: 1 });
  const r = round(down, ctx, { milo: [A.reboot('claude')] });
  const claude = findUnit(r.battle, 'claude');
  assert.deepEqual([claude.offline, claude.integrity, claude.rattled], [false, 4, true]);
  assert.equal(part(partsOf(r.battle, ctx, 'claude', A.strike('f0')), 'Rattled 1'), -1);
});

test('the Tollkeeper’s toll picks once per foe per move, however many tiles of it pass beside him', () => {
  const toll = passive('toll', ['tollkeeper-toll']);
  const walk = [{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }];
  const ctx = withAbilities([toll], { foePlan: (bb, id) => plan(id, bb.round === 1 ? [A.stride(walk)] : [], { by: 'foe' }) });
  let walkedOn = 0;
  for (let s = 1; s <= 30; s += 1) {
    const b = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 8, y: 2 })] }), [hero('codex', { id: 'toll', kind: 'tollkeeper', name: 'The Tollkeeper', abilityIds: ['toll'], reactions: { 'parting-swipe': 'never' } })], noNoise, ctx);
    const r = round(place(b, 'toll', 6, 3), ctx, { toll: [A.brace()] });
    const picks = r.events.filter((e) => e.t === 'outcome' && e.unit === 'toll' && e.target === 'f0');
    assert.equal(picks.length, 1, `seed ${s}: one toll outcome for the move`);
    if (findUnit(r.battle, 'f0').x < 7) walkedOn += 1;
  }
  assert.ok(walkedOn > 0, `on a Graze or a Miss it walks on past him, still beside him, without a second toll (${walkedOn})`);
});

test('a Sparked unit makes no reactions at all: no Shoulder, no Stand in my light', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 80, maxIntegrity: 80 })] }), [hero('milo', { reactions: { 'stand-in-my-light': 'always' } }), hero('claude', { reactions: { shoulder: 'always' } })], noNoise, ctx);
  const sparked = [{ id: 'sparked', n: 1, source: null, data: null }];
  const setup = (spark) => place(place(b, 'milo', 2, 3, { conditions: spark === 'milo' ? sparked : [] }), 'claude', 2, 2, { buffer: 5, conditions: spark === 'claude' ? sparked : [] });
  const hit = (x) => {
    const run = makeRun(x, ctx);
    landHit(run, { userId: 'f0', targetId: 'milo', amount: 6, kind: 'plain', degree: 'hit' });
    return run.events.filter((e) => e.t === 'reaction').map((e) => e.id);
  };
  assert.deepEqual(hit(setup(null)), ['shoulder'], 'awake, the Scribe shoulders');
  assert.deepEqual(hit(setup('claude')), [], 'Sparked, she doesn’t');
  const onClaude = (spark) => {
    const run = makeRun(setup(spark), ctx);
    landHit(run, { userId: 'f0', targetId: 'claude', amount: 9, kind: 'plain', degree: 'hit' });
    return run.events.filter((e) => e.t === 'reaction').map((e) => e.id);
  };
  assert.ok(onClaude(null).includes('stand-in-my-light'), 'awake, Milo stands in');
  assert.ok(!onClaude('milo').includes('stand-in-my-light'), 'Sparked, he doesn’t');
});
