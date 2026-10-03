// Phase 6: the company grows. Juno, Mae, Lumi and Tova's moves are written, so once one of them has
// come to camp they join the roster and fight; the companions from later phases wait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createState } from '../src/model.js';
import { recruit, heroSpec } from '../src/party.js';
import { movesReady, FIGHTING_PHASE } from '../src/company.js';
import { validateAbility, buildAbilityIndex } from '../src/combat/abilities.js';

const dir = new URL('../content/party/companions/', import.meta.url);
const companions = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => { const c = JSON.parse(readFileSync(new URL(n, dir), 'utf8')); return [c.id, c]; }));
const read = (p) => JSON.parse(readFileSync(new URL(`../content/${p}`, import.meta.url), 'utf8'));
const content = {
  party: { companions, regulars: read('party/regulars.json'), banter: read('party/banter.json'), teamups: read('party/teamups.json') },
  combat: { callings: read('combat/callings.json'), spells: read('combat/spells.json'), rules: read('combat/rules.json'), foes: read('combat/foes.json'), leads: read('combat/leads.json') },
  trails: read('trails.json'),
};
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const FOUR = ['juno', 'mae', 'lumi', 'tova', 'rivet', 'pip', 'dusty'];

test('the seven who join by Phase 6 have every move written, each a valid ability; their heart feats wait for their quests', () => {
  assert.equal(FIGHTING_PHASE, 6);
  for (const id of FOUR) {
    const c = companions[id];
    assert.ok(c.joins.phase <= 6);
    assert.equal(movesReady(c), true, `${id}’s moves are written`);
    for (const m of c.moves) {
      const a = c.abilityDefs.find((x) => x.id === m);
      assert.deepEqual(validateAbility(a), [], `${id}.${m} is valid`);
      assert.ok(a.text.length <= 140 && !a.text.includes('!'), `${id}.${m}: ${a.text}`);
    }
    assert.equal(c.abilityDefs.find((a) => a.id === c.heartFeat)?.stub, true);
  }
  // what each move does, as COMBAT.md §2 has it
  const def = (id, m) => companions[id].abilityDefs.find((a) => a.id === m);
  assert.deepEqual(def('juno', 'read-the-error').effects.map((e) => e.do), ['condition', 'reveal']);
  assert.deepEqual(def('juno', 'jack-in').uses, { per: 'breather', n: 1 });
  assert.deepEqual(def('mae', 'name-it').target.need, ['examined'], 'she names what she has looked at');
  assert.deepEqual(def('lumi', 'streetlight').target.need, ['dim-or-dark']);
  assert.equal(def('lumi', 'on-her-bicycle').passive.mods[0].stat, 'speed');
  assert.deepEqual(def('tova', 'raise-stone').effects, [{ do: 'summon', template: 'pop-up-cover', rounds: 3 }]);
  assert.deepEqual(def('tova', 'hammer-tap').effects.map((e) => e.do), ['damage', 'move']);
});

test('one of the four who has come to camp joins the roster; someone whose moves are stubs, or from a later phase, does not', () => {
  const state = createState(T0);
  for (const id of FOUR) {
    const next = recruit(state, id, T0, { content });
    assert.ok(next.party.roster[id], `${id} joins`);
    assert.equal(recruit(next, id, T0, { content }), next, 'once');
  }
  for (const id of ['nell', 'vesperine', 'whisper']) {
    assert.equal(movesReady(companions[id]), false, `${id}’s moves are still stubs`);
    assert.equal(recruit(state, id, T0, { content }), state, `${id} waits`);
  }
  assert.equal(recruit(state, 'nobody', T0, { content }), state);
});

test('once in the roster they have a fight sheet with their moves in it', () => {
  let state = createState(T0);
  for (const id of FOUR) state = recruit(state, id, T0, { content });
  const index = buildAbilityIndex({ callings: content.combat.callings, spells: content.combat.spells, companions, regulars: content.party.regulars, foes: content.combat.foes, leads: content.combat.leads });
  for (const id of FOUR) {
    const spec = heroSpec(state, id, { content, rules: content.combat.rules, abilities: index, now: T0 });
    assert.ok(spec, `${id} has a sheet`);
    assert.ok(spec.integrity > 0, `${id} has Integrity`);
    const sheet = JSON.stringify(spec);
    for (const m of companions[id].moves) assert.ok(sheet.includes(`"${m}"`), `${id} can use ${m}`);
  }
});

// ---- in the engine: the moves play in a real round ----
import { buildAbilityIndex as buildIndex } from '../src/combat/abilities.js';
import { hero, stray, fightSpec, makeCtx, createBattle, plan, play, playRound, A, ABILITIES } from './combat-kit.js';
import { speedOf } from '../src/combat/round.js';

const theirs = FOUR.flatMap((id) => companions[id].abilityDefs.filter((a) => !a.stub));
const engineCtx = (seed) => makeCtx({ foePlan: (b, id) => plan(id, [], { by: 'foe' }), abilityIndex: buildIndex({ callings: { abilities: [...ABILITIES, ...theirs] } }) });
const calm = { calm: { noise: false, adaptation: true } };
/** A fight with one hero holding `moves` at (2, 2) and a stray at `at`, seeded; plays one round of `slots`. */
function round(moves, slots, { at = { x: 3, y: 2 }, seed = 1, foe = {} } = {}) {
  const ctx = engineCtx(seed);
  const b = createBattle(fightSpec({ seed, foes: [stray('f0', { ...at, integrity: 200, maxIntegrity: 200, resolve: { body: 0, mind: 0 }, ...foe })], arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo', { abilityIds: moves })], calm, ctx);
  const c = play(b, [{ t: 'plan', unitId: 'milo', plan: plan('milo', slots) }, { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { events: [...c.events, ...r.events], battle: r.battle };
}

test('Tova’s Hammer tap strikes in quake and knocks a foe back; Raise stone stands a slab of cover', () => {
  let struck = 0;
  let pushed = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const { events } = round(['hammer-tap'], [A.use('hammer-tap', { unit: 'f0' })], { seed });
    if (events.some((e) => e.t === 'damage' && e.target === 'f0')) struck += 1;
    if (events.some((e) => (e.t === 'move' || e.t === 'push' || e.t === 'forced') && (e.unit === 'f0' || e.target === 'f0'))) pushed += 1;
  }
  assert.ok(struck >= 6, `it lands most of the time (${struck} of 12)`);
  assert.ok(pushed >= 1, `and a Hit knocks it back (${pushed} of 12)`);
  const { battle } = round(['raise-stone'], [A.use('raise-stone', { tile: { x: 2, y: 3 } })], { at: { x: 9, y: 2 } });
  const devices = battle.units.filter((u) => u.rank === 'device' || u.template === 'pop-up-cover');
  const objects = (battle.objects || []).filter((o) => /cover/.test(JSON.stringify(o)));
  assert.ok(devices.length + objects.length >= 1, 'a slab stands where she raised it');
});

test('Juno’s Read the error and Mae’s Name it leave their conditions on a foe that fails its Resolve', () => {
  const conditions = (battle) => (battle.units.find((u) => u.id === 'f0')?.conditions || []).map((c) => c.id);
  let dazed = 0;
  for (let seed = 1; seed <= 12; seed += 1) if (conditions(round(['read-the-error'], [A.use('read-the-error', { unit: 'f0' })], { seed, at: { x: 6, y: 2 } }).battle).includes('dazed')) dazed += 1;
  assert.ok(dazed >= 4, `Dazed on a Hit (${dazed} of 12)`);
  let exposed = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const { battle } = round(['name-it'], [A.examine('f0'), A.use('name-it', { unit: 'f0' })], { seed, at: { x: 6, y: 2 } });
    if (conditions(battle).includes('exposed')) exposed += 1;
  }
  assert.ok(exposed >= 4, `Exposed once she has looked (${exposed} of 12)`);
});

test('Lumi on her bicycle strides further than she would on foot', () => {
  const ctx = engineCtx(1);
  const make = (moves) => createBattle(fightSpec({ foes: [stray('f0', { x: 14, y: 2 })], arenaOpts: { entry: [{ x: 2, y: 2 }] } }), [hero('milo', { abilityIds: moves })], calm, ctx);
  const speed = (b) => speedOf(b, b.units.find((x) => x.id === 'milo'), ctx);
  assert.ok(speed(make(['on-her-bicycle'])) >= speed(make([])) + 4, 'four tiles further');
});

test('Dusty’s Wanted singles a foe out, Pip’s Many small things lands hits, and Rivet’s whistle patches an ally who is hurt', () => {
  const conditions = (battle) => (battle.units.find((u) => u.id === 'f0')?.conditions || []).map((c) => c.id);
  let singled = 0;
  let small = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    if (conditions(round(['wanted'], [A.use('wanted', { unit: 'f0' })], { seed, at: { x: 6, y: 2 } }).battle).includes('singled-out')) singled += 1;
    if (round(['many-small-things'], [A.use('many-small-things', { unit: 'f0' }, { cost: 2 })], { seed, at: { x: 5, y: 2 } }).events.some((e) => e.t === 'damage' && e.target === 'f0')) small += 1;
  }
  assert.ok(singled >= 4, `Wanted singles out (${singled} of 12)`);
  assert.ok(small >= 8, `three small hits land most of the time (${small} of 12)`);
  // Rivet's Shift change: Claude is hurt, Milo is Rivet, and the whistle patches her.
  const ctx = engineCtx(1);
  const hurt = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })], arenaOpts: { entry: [{ x: 2, y: 2 }, { x: 3, y: 2 }] } }),
    [hero('milo', { abilityIds: ['shift-change'] }), hero('claude', { integrity: 4 })], calm, ctx);
  const c = play(hurt, [{ t: 'plan', unitId: 'milo', plan: plan('milo', [A.use('shift-change', { unit: 'claude' })]) }, { t: 'commit' }], ctx);
  const after = playRound(c.battle, ctx).battle;
  assert.ok(after.units.find((u) => u.id === 'claude').integrity > 4, 'she is patched');
});
