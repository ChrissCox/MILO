// The bestiary (module D, CONTRACT-PHASE4.md §7.3, §4.9, §4.15, §5.2): src/combat/bestiary.js.
// Strays, lackeys, elites, Tale-leads, canon foes and cave creatures, by §4.9's pipelines exactly.
// Runs against B's rules.js and rules.json when they're there, else the kit's transcription of §4.
//   node --test tests/bestiary.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadD, read, has } from './encounters-kit.mjs';
import { hashInts } from '../src/world/rng.js';

// §4.9's worked numbers are written at factor 1, so these pins load rules.json alone and never the
// tuned tuning.json (§18.3 item 13). Tests that want a factor build their own tuning below.
const D = await loadD({ tuning: null });
const { rules, bestiary, riftgen, words, leads, foes, genres, hooks } = D;
const { strayUnit, leadUnit, foeUnit, mechanicOf, leadMechanic, eliteBonus, roomBudget, leadShare, TEMPERAMENTS } = bestiary;
const { strayRow, integrityFactor, adaptStep } = D.rulesApi;

// A spec whose strays and lead we choose: a real riftgen spec, with its kinds swapped for ours.
const base = riftgen.wildRift({ seed: hashInts(4, 'bestiary'), tier: 4, depth: 1 });
const kind = (genre, archetype, extra = {}) => ({
  name: `Test ${archetype}`, genre, second: null, archetype, bodyKey: 'r', parts: [{ id: 'visor', layer: 0 }], count: 2, temperament: 'curious', sprite: null, ...extra,
});
const withKinds = (strays, extra = {}) => ({ ...base, strays, ...extra });

test(`the bestiary loads against ${D.mode === 'real' ? 'B’s rules' : 'the kit’s transcription of §4'}`, (t) => {
  t.diagnostic(`mode: ${D.mode}${D.why ? ` (${D.why})` : ''}`);
  assert.ok(['real', 'stub'].includes(D.mode));
  assert.equal(strayRow(rules, 'integrity', 5), 75);
  assert.equal(strayRow(rules, 'strike', 12), 23);
});

test('the pins run at factor 1: the kit’s tuning: null never loads tuning.json, and its default still does', async () => {
  for (let level = 0; level <= 14; level += 1) {
    for (const partySize of [1, 2, 3, 4]) assert.equal(integrityFactor(rules, level, partySize), 1, `level ${level}, party ${partySize}`);
  }
  const withFile = await loadD();
  assert.equal(withFile.bestiary, bestiary, 'both share one set of D’s modules');
  assert.equal(await loadD({ tuning: null }), D, 'cached per choice');
  await assert.rejects(loadD({ tuning: {} }), TypeError);
  if (D.mode !== 'real') return;
  assert.equal(rules.tuned, null, 'rules.json alone');
  const file = has('content/combat/tuning.json') ? read('combat/tuning') : null;
  assert.deepEqual(withFile.rules.tuned, file, 'the default loads tuning.json as the app does');
});

test('a level-5 elite walker has 95 Integrity and strikes for 14 at +1 edge', () => {
  const spec = withKinds([kind('neon', 'walker')]);
  const elite = strayUnit(spec, 0, 6, { level: 5, rank: 'elite', rules, foes, partySize: 4, roadLevel: 5 });
  assert.equal(elite.maxIntegrity, 95);
  assert.equal(elite.integrity, 95);
  assert.equal(elite.strike.amount + elite.flat, 14);
  assert.equal(elite.attackEdge, 1);
  assert.equal(elite.size, 2, 'elites are Large');
  assert.equal(elite.look.scale, 2);
  assert.equal(elite.rank, 'elite');
  assert.equal(elite.level, 5);
});

test('lackeys come out at 10, 38 and 80 Integrity and strike for 4, 9 and 15 at room levels 1, 5 and 10', () => {
  const spec = withKinds([kind('iron', 'walker')]);
  const want = { 1: [10, 4, 0], 5: [38, 9, 3], 10: [80, 15, 8] };
  for (const [n, [integrity, strike, level]] of Object.entries(want)) {
    const lackey = strayUnit(spec, 0, Number(n), { rank: 'lackey', rules, foes, partySize: 4, roadLevel: Number(n) });
    assert.equal(lackey.maxIntegrity, integrity, `room level ${n}`);
    assert.equal(lackey.strike.amount + lackey.flat, strike, `room level ${n}`);
    assert.equal(lackey.level, level, 'a lackey is max(0, n − 2)');
    assert.equal(lackey.adapt, 0, 'lackeys never adapt');
  }
});

test('an open rift’s lead at room level 5 is a level-3 elite: 63 a bar before its multiplier, striking for 11 at +1 edge', () => {
  // A walker lead with a mechanic that fights as the fallback (xInt 1.0) meets the number bare.
  let spec = null;
  for (let i = 0; i < 4000 && !spec; i += 1) {
    const s = riftgen.wildRift({ seed: hashInts(i, 'open-lead'), tier: 4, depth: 1 });
    if (s.stage !== 'open' || s.genres.length !== 1 || s.maelstrom) continue;
    const mech = leadMechanic(s, { leads, words });
    if (!mech.fallback || mech.noFight) continue;
    const walker = { ...s, strays: s.strays.map((k) => (k.genre === s.taleLead.genre ? { ...k, archetype: 'walker' } : k)) };
    if (walker.strays.some((k) => k.genre === s.taleLead.genre)) spec = walker;
  }
  assert.ok(spec, 'found an open single-genre rift whose lead fights as the fallback');
  const lead = leadUnit(spec, { level: 5, rules, leads, foes, words, partySize: 4, roadLevel: 5, hooks });
  assert.equal(lead.archetype, 'walker');
  assert.equal(lead.level, 3);
  assert.equal(lead.lead.phases, 3);
  assert.deepEqual(lead.lead.bars, [63, 63, 63]);
  assert.equal(lead.maxIntegrity, 63);
  assert.equal(lead.strike.amount + lead.flat, 11);
  assert.equal(lead.attackEdge, 1);
  assert.deepEqual(lead.ranged, { range: 8, amount: 9 }, 'a ranged option at range 8, its Strike line');
  assert.equal(lead.size, 2);
  assert.equal(lead.id, 'lead');
  assert.equal(lead.kind, 'lead');
  assert.equal(lead.rank, 'lead');
  assert.equal(lead.lead.mechanic, 'fallback');
  assert.equal(lead.lead.quote, spec.taleLead.line);
  // With its multiplier, a shipped mechanic's bar divides by xInt (and tuning's xInt wins).
  const tuned = leadUnit(spec, { level: 5, rules, leads, foes, words, partySize: 4, roadLevel: 5, hooks, tuning: { xInt: { fallback: 1.5 } } });
  assert.deepEqual(tuned.lead.bars, [42, 42, 42], 'Math.round(63 / 1.5)');
});

test('a stray’s Integrity follows §4.9’s pipeline at every archetype, level, deep rank and party size', () => {
  const archetypes = ['walker', 'crawler', 'floater', 'flier', 'ghost', 'construct'];
  const spec = withKinds(archetypes.map((a) => kind('noir', a)));
  const tuning = { integrityFactor: { 3: { 1: 0.6, 2: 0.8 }, 7: { 4: 1.1 } } };
  const tuned = D.mode === 'real' ? D.rulesApi.loadRules(read('combat/rules'), tuning) : { ...rules, tuning };
  let checked = 0;
  for (const [a, archetype] of archetypes.entries()) {
    const m = rules.archetypes[archetype].integrity;
    for (let level = 0; level <= 14; level += 1) {
      for (const deepRank of [0, 1, 3]) {
        for (const partySize of [1, 2, 3, 4]) {
          for (const rank of ['stray', 'elite']) {
            const unit = strayUnit(spec, a, level, { level, rank, rules: tuned, foes, deepRank, partySize, roadLevel: level });
            const elite = rank === 'elite' ? eliteBonus(tuned, level) : 0;
            const want = Math.round((Math.round(strayRow(tuned, 'integrity', level) * m) + elite) * (1 + 0.1 * deepRank) * integrityFactor(tuned, level, partySize));
            assert.equal(unit.maxIntegrity, want, `${archetype} ${rank} level ${level}, deep ${deepRank}, party ${partySize}`);
            assert.equal(unit.flat, (rank === 'elite' ? 2 : 0) + deepRank, 'elite +2 and deep rank +1 each');
            assert.equal(unit.strike.amount, strayRow(tuned, 'strike', level));
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 2000);
  assert.equal(eliteBonus(rules, 0), 10);
  assert.equal(eliteBonus(rules, 1), 10);
  assert.equal(eliteBonus(rules, 2), 15);
  assert.equal(eliteBonus(rules, 4), 15);
  assert.equal(eliteBonus(rules, 5), 20);
  assert.equal(eliteBonus(rules, 11), 20);
});

// A tuning file whose every factor is off 1 (so a factor applied where §4.9 has none shows), and
// its own xInt for the fallback and every shipped mechanic.
const TUNING = {
  integrityFactor: Object.fromEntries(Array.from({ length: 15 }, (_, level) => [level, Object.fromEntries([1, 2, 3, 4].map((p) => [p, Number((0.62 + 0.09 * p + 0.017 * level).toFixed(3))]))])),
  xInt: { fallback: 1.37, ...Object.fromEntries(leads.mechanics.filter((m) => m.ships).map((m, i) => [m.id, Number((0.85 + 0.19 * i).toFixed(2))])) },
};
const TUNED = D.mode === 'real' ? D.rulesApi.loadRules(read('combat/rules'), TUNING) : { ...rules, tuning: TUNING };

test('a lead’s bars follow §4.9’s pipeline at every stage, level, deep rank and party size: its share and tuning’s xInt, and no integrityFactor', () => {
  // Leads fighting as the fallback and as each of the eight shipped mechanics.
  const specs = new Map();
  for (let i = 0; i < 6000 && specs.size < 9; i += 1) {
    const s = riftgen.wildRift({ seed: hashInts(i, 'lead-table'), tier: 1 + (i % 8), depth: 1 + (i % 12) });
    const mech = leadMechanic(s, { leads, words, tuning: TUNING });
    if (!specs.has(mech.fights)) specs.set(mech.fights, s);
  }
  assert.deepEqual([...specs.keys()].sort(), ['fallback', ...leads.mechanics.filter((m) => m.ships).map((m) => m.id)].sort());
  let checked = 0;
  let factorShows = 0;
  for (const [id, s0] of specs) {
    for (const stage of ['hairline', 'open', 'gaping']) {
      const spec = { ...s0, stage };
      const mech = leadMechanic(spec, { leads, words, tuning: TUNING });
      assert.equal(mech.xInt, TUNING.xInt[id], `${id}: tuning’s xInt wins`);
      for (let n = 0; n <= 14; n += 1) {
        for (const deepRank of [0, 1, 3]) {
          for (const partySize of [1, 2, 3, 4]) {
            const lead = leadUnit(spec, { level: n, rules: TUNED, leads, foes, tuning: TUNING, words, partySize, deepRank, roadLevel: n, hooks });
            const L = Math.max(0, n - (stage === 'gaping' ? 1 : 2));
            const m = TUNED.archetypes[lead.archetype].integrity;
            const share = leadShare(TUNED.budgets, stage === 'hairline' ? 'moderate' : 'severe', partySize, spec.depth);
            const body = Math.round(strayRow(TUNED, 'integrity', L) * m) + eliteBonus(TUNED, L);
            const bar = Math.round(body * (1 + 0.1 * deepRank) * share / TUNING.xInt[id]);
            const where = `${id} ${stage} n ${n}, deep ${deepRank}, party ${partySize}`;
            assert.equal(lead.level, L, where);
            assert.deepEqual(lead.lead.bars, Array(stage === 'hairline' ? 2 : 3).fill(bar), where);
            assert.equal(lead.maxIntegrity, bar, where);
            assert.equal(lead.flat, 2 + deepRank, `${where}: elite +2 and +1 a deep rank`);
            assert.equal(lead.strike.amount, strayRow(TUNED, 'strike', L), where);
            assert.deepEqual(lead.ranged, { range: 8, amount: strayRow(TUNED, 'strike', L) }, where);
            assert.equal(lead.attackEdge, 1);
            if (Math.round(body * (1 + 0.1 * deepRank) * integrityFactor(TUNED, L, partySize) * share / TUNING.xInt[id]) !== bar) factorShows += 1;
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked === 9 * 3 * 15 * 3 * 4, `${checked} leads`);
  assert.ok(factorShows > checked * 0.8, `a factor would show in ${factorShows} of ${checked}`);
});

test('lackeys, canon foes, cave creatures and the Mimic take deep ranks and the tuning factor by §4.9’s pipeline', () => {
  const spec = withKinds(['walker', 'crawler', 'floater', 'flier', 'ghost', 'construct'].map((a) => kind('iron', a)));
  let checked = 0;
  for (const [k, stray] of spec.strays.entries()) {
    const m = TUNED.archetypes[stray.archetype].integrity;
    for (let n = 0; n <= 14; n += 1) {
      for (const deepRank of [0, 1, 3]) {
        for (const partySize of [1, 2, 3, 4]) {
          const lackey = strayUnit(spec, k, n, { rank: 'lackey', rules: TUNED, foes, deepRank, partySize, roadLevel: n });
          const want = Math.max(1, Math.round(Math.round(strayRow(TUNED, 'integrity', n) * m * 0.5) * (1 + 0.1 * deepRank) * integrityFactor(TUNED, n, partySize)));
          const where = `a ${stray.archetype} lackey in a level-${n} room, deep ${deepRank}, party ${partySize}`;
          assert.equal(lackey.maxIntegrity, want, where);
          assert.equal(lackey.level, Math.max(0, n - 2), where);
          assert.equal(lackey.strike.amount, Math.floor(0.75 * strayRow(TUNED, 'strike', n)), where);
          assert.equal(lackey.flat, deepRank, `${where}: +1 a deep rank`);
          checked += 1;
        }
      }
    }
  }
  // foes.json's own: a canon foe, each cave creature (Murmurs as lackeys) and the Mimic.
  const all = [foes.canon.find((f) => f.id === 'hollow-sentries'), ...foes.creatures, foes.mimic];
  for (const foe of all) {
    const m = TUNED.archetypes[foe.archetype].integrity;
    for (const n of [1, 4, 7, 11, 13]) {
      for (const deepRank of [0, 1, 3]) {
        for (const partySize of [1, 3]) {
          for (const rank of foe.rank ? [foe.rank] : ['stray', 'elite']) {
            const u = foeUnit(foe, n, { level: rank === 'elite' ? n - 1 : n, rank, rules: TUNED, foes, partySize, roadLevel: n, deepRank });
            const where = `${foe.id} ${rank} at ${n}, deep ${deepRank}, party ${partySize}`;
            let want;
            if (rank === 'lackey') want = Math.max(1, Math.round(Math.round(strayRow(TUNED, 'integrity', n) * m * 0.5) * (1 + 0.1 * deepRank) * integrityFactor(TUNED, n, partySize)));
            else {
              const L = rank === 'elite' ? n - 1 : n;
              want = Math.round((Math.round(strayRow(TUNED, 'integrity', L) * m) + (rank === 'elite' ? eliteBonus(TUNED, L) : 0)) * (1 + 0.1 * deepRank) * integrityFactor(TUNED, L, partySize));
            }
            assert.equal(u.maxIntegrity, want, where);
            const bite = Number.isFinite(foe.bite);
            assert.equal(u.flat, bite ? 0 : (rank === 'elite' ? 2 : 0) + deepRank, `${where}: +1 a deep rank${bite ? ', but a bite stays a bite' : ''}`);
            if (bite) assert.equal(u.strike.amount + u.flat, foe.bite);
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 1200, `${checked} foes`);
});

test('archetypes set the body: speed, Grace, Guard, Resolve, reach, movement and what they ignore', () => {
  const want = {
    walker: { speed: 5, grace: 1, guard: 1, body: 1, mind: 0, range: 0 },
    crawler: { speed: 6, grace: 3, guard: 0, body: 0, mind: 1, range: 0, abilities: ['pounce'] },
    floater: { speed: 4, grace: 0, guard: 0, body: 0, mind: 1, range: 8, hovers: true },
    flier: { speed: 6, grace: 3, guard: 0, body: 0, mind: 1, range: 0, flies: true },
    ghost: { speed: 5, grace: 1, guard: 0, body: 0, mind: 1, range: 0, throughWalls: true, ignores: ['tangled', 'tumbled'] },
    construct: { speed: 4, grace: -1, guard: 1, body: 2, mind: 0, range: 0, ignores: ['queasy', 'drowsy', 'beguiled'] },
  };
  for (const [archetype, w] of Object.entries(want)) {
    const u = strayUnit(withKinds([kind('gothic', archetype)]), 0, 3, { rules, foes, roadLevel: 3 });
    assert.equal(u.speed, w.speed, archetype);
    assert.equal(u.abilities.grace, w.grace, archetype);
    assert.equal(u.guard, w.guard, archetype);
    assert.deepEqual(u.resolve, { body: w.body, mind: w.mind }, archetype);
    assert.equal(u.strike.range, w.range, archetype);
    assert.equal(u.moves.hovers, Boolean(w.hovers), archetype);
    assert.equal(u.moves.flies, Boolean(w.flies), archetype);
    assert.equal(u.moves.throughWalls, Boolean(w.throughWalls), archetype);
    assert.equal(u.moves.darksight, archetype === 'ghost', archetype);
    assert.deepEqual(u.ignores, w.ignores || [], archetype);
    for (const id of w.abilities || []) assert.ok(u.abilityIds.includes(id), `${archetype} has ${id}`);
    assert.ok(u.abilityIds.includes(rules.genres.gothic.abilities[0]), 'a Gothic stray has its genre’s big move');
    assert.equal(u.idleHeat, rules.temperaments.curious.heat);
    assert.equal(u.strike.kind, 'dread');
    assert.equal(u.strike.weapon, 'natural');
    assert.equal(u.control, 'auto');
  }
});

test('resistances and weaknesses: the genre’s own kind, both genres’ in a fusion, only the first genre’s weakness, each kind once', () => {
  const r = (level) => strayRow(rules, 'resist', level);
  const plain = strayUnit(withKinds([kind('neon', 'walker')]), 0, 5, { rules, foes, roadLevel: 5 });
  assert.deepEqual(plain.resist, { static: r(5) });
  assert.deepEqual(plain.weak, { warp: r(5) });
  const fusion = strayUnit(withKinds([kind('neon', 'walker', { second: 'gothic' })]), 0, 5, { rules, foes, roadLevel: 5 });
  assert.deepEqual(fusion.genres, ['neon', 'gothic']);
  assert.deepEqual(fusion.resist, { static: r(5), dread: r(5) });
  assert.deepEqual(fusion.weak, { warp: r(5) }, 'only its own genre’s weakness');
  const ghost = strayUnit(withKinds([kind('noir', 'ghost')]), 0, 4, { rules, foes, roadLevel: 4 });
  assert.deepEqual(ghost.resist, { doubt: r(4), plain: r(4) });
  assert.deepEqual(ghost.weak, { light: r(4) }, 'Noir’s weakness and the ghost’s are the same kind, counted once');
  const construct = strayUnit(withKinds([kind('iron', 'construct')]), 0, 12, { rules, foes, roadLevel: 12 });
  assert.deepEqual(construct.weak, { static: r(12), spark: r(12) });
  assert.equal(strayRow(rules, 'resist', 16), 3 + Math.floor((3 * 15) / 4), 'past 12: 3 + ⌊3(n − 1)/4⌋');
});

test('a kind counts once (§18.2 item 2): one both resisted and weak is neither, for strays, leads and canon foes alike, through defencesFor', () => {
  const { defencesFor } = bestiary;
  const r = (level) => strayRow(rules, 'resist', level);
  // The cross-check's five: a kind in both lists is removed from both.
  const cases = [
    [['nocturne', 'frontier'], 'walker', ['chill'], []],
    [['iron', 'neon'], 'construct', ['grind'], ['spark']],
    [['neon', 'void'], 'walker', ['static'], []],
    [['frontier', 'nocturne'], 'walker', ['dust'], []],
    [['kaiju'], 'ghost', ['quake'], ['light']],
  ];
  const at = (kinds, level) => Object.fromEntries(kinds.map((k) => [k, r(level)]));
  for (const [[genre, second], archetype, resist, weak] of cases) {
    const where = `${genre}${second ? ` + ${second}` : ''} ${archetype}`;
    const unit = strayUnit(withKinds([kind(genre, archetype, { second: second || null })]), 0, 6, { rules, foes, roadLevel: 6 });
    assert.deepEqual([unit.resist, unit.weak], [at(resist, 6), at(weak, 6)], `${where}: the stray`);
    assert.deepEqual(defencesFor([genre, second], archetype, 6, rules), { resist: at(resist, 6), weak: at(weak, 6) }, `${where}: defencesFor`);
    assert.deepEqual(defencesFor([genre, second], archetype, 6, { rules }), { resist: at(resist, 6), weak: at(weak, 6) }, `${where}: with { rules }`);
  }
  // Every genre pair, archetype and a spread of levels: no kind is in both lists, and every kind
  // that's only in one stays, worked out here apart from bestiary.js.
  const fighting = Object.keys(rules.genres).filter((g) => rules.genres[g].kind);
  const kindsOf = (v) => (Array.isArray(v) ? v : Object.keys(v || {}));
  let overlaps = 0;
  for (const g1 of fighting) for (const g2 of [null, ...fighting.filter((g) => g !== g1)]) for (const archetype of Object.keys(rules.archetypes)) {
    const arch = rules.archetypes[archetype];
    const res = new Set([rules.genres[g1].kind, g2 && rules.genres[g2].kind, ...kindsOf(arch.resist)].filter(Boolean));
    const wk = new Set([rules.genres[g1].weak, ...kindsOf(arch.weak)].filter(Boolean));
    const both = [...res].filter((k) => wk.has(k));
    overlaps += both.length ? 1 : 0;
    for (const level of [0, 3, 12, 17]) {
      const d = defencesFor([g1, g2], archetype, level, rules);
      assert.deepEqual(Object.keys(d.resist).sort(), [...res].filter((k) => !both.includes(k)).sort(), `${g1}+${g2} ${archetype}: resist`);
      assert.deepEqual(Object.keys(d.weak).sort(), [...wk].filter((k) => !both.includes(k)).sort(), `${g1}+${g2} ${archetype}: weak`);
      for (const v of [...Object.values(d.resist), ...Object.values(d.weak)]) assert.equal(v, r(level));
      if (level === 3) {
        const unit = strayUnit(withKinds([kind(g1, archetype, { second: g2 })]), 0, 3, { rules, foes, roadLevel: 3 });
        assert.deepEqual({ resist: unit.resist, weak: unit.weak }, d, `${g1}+${g2} ${archetype}: the stray is defencesFor’s`);
      }
    }
  }
  assert.ok(overlaps >= 20, `${overlaps} genre and archetype pairs name a kind in both lists`);
  // A lead (its own genre only) and a canon foe with kinds of its own follow the same rule.
  for (const genre of fighting) {
    const spec = { ...base, genres: [genre], taleLead: { ...base.taleLead, genre } };
    const lead = leadUnit(spec, { level: 6, rules, leads, foes, words, partySize: 4, roadLevel: 6 });
    assert.deepEqual({ resist: lead.resist, weak: lead.weak }, defencesFor([genre], lead.archetype, lead.level, rules), `a ${genre} lead is defencesFor’s`);
    assert.ok(!Object.keys(lead.resist).some((k) => Object.hasOwn(lead.weak, k)), `no ${genre} lead kind is in both lists`);
  }
  const golem = foes.canon.find((f) => f.id === 'cinder-golems');
  const odd = foeUnit({ ...golem, archetype: 'construct', resist: ['spark', 'quake'], weak: ['ink'] }, 5, { rules, foes, roadLevel: 5 });
  assert.deepEqual([odd.resist, odd.weak], [{ quake: r(5) }, { ink: r(5) }], 'a construct told to resist Spark is neither resistant nor weak to it');
  assert.deepEqual({ resist: odd.resist, weak: odd.weak }, defencesFor([], 'construct', 5, rules, { resist: ['spark', 'quake'], weak: ['ink'] }));
  assert.throws(() => defencesFor(['neon'], 'walker', 3), /needs the rules/);
});

test('a bright stray stands aside and cheers: side neutral, no talk kind, never adapting', () => {
  const u = strayUnit(withKinds([kind('neon', 'walker'), kind('starlight', 'flier')]), 1, 3, { rules, foes, roadLevel: 3 });
  assert.equal(u.side, 'neutral');
  assert.equal(u.talkKind, null);
  assert.equal(u.adapt, 0);
  assert.deepEqual(u.abilityIds.filter((id) => Object.values(rules.genres).some((g) => g.abilities.includes(id))), [], 'no big move');
  const foe = strayUnit(withKinds([kind('neon', 'walker'), kind('starlight', 'flier')]), 0, 3, { rules, foes, roadLevel: 3 });
  assert.equal(foe.side, 'foe');
  assert.equal(foe.talkKind, 'k0');
});

test('foes adapt by rank and level, Long Road, with leads and lackeys measured by the room', () => {
  const spec = withKinds([kind('void', 'walker')]);
  assert.equal(strayUnit(spec, 0, 3, { rules, foes, roadLevel: 3 }).adapt, 1, 'an on-level stray: step 1');
  assert.equal(strayUnit(spec, 0, 5, { rules, foes, roadLevel: 3 }).adapt, 2, 'a stray 2 above: step 2');
  assert.equal(strayUnit(spec, 0, 1, { rules, foes, roadLevel: 3 }).adapt, 0, 'a stray 2 below: step 0');
  assert.equal(strayUnit(spec, 0, 3, { level: 2, rank: 'elite', rules, foes, roadLevel: 3 }).adapt, 2, 'an elite: step 2');
  const lead = (n, road) => {
    const s = { ...base, stage: 'open' };
    return leadUnit(s, { level: n, rules, leads, foes, words, roadLevel: road, hooks }).adapt;
  };
  assert.equal(lead(3, 3), 3, 'an on-level lead plans for your habit');
  assert.equal(lead(5, 3), 4, 'a lead whose room is 2 above plans for your two');
  assert.equal(lead(5, 5), 3, 'its own level (3) sits 2 below, but it measures by its room');
  assert.equal(adaptStep({ rank: 'lead', level: 3, roomLevel: 5, roadLevel: 5 }, { mode: 'storybook', adaptation: true, rules }), 0, 'Storybook never adapts (B applies it)');
});

test('specs are Long Road and mode-free, frozen, and the same every time', () => {
  const spec = withKinds([kind('frontier', 'crawler'), kind('kaiju', 'construct')]);
  const a = strayUnit(spec, 0, 4, { rules, foes, roadLevel: 4, id: 'f3', post: { x: 7, y: 2 } });
  const b = strayUnit(spec, 0, 4, { rules, foes, roadLevel: 4, id: 'f3', post: { x: 7, y: 2 } });
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.strike) && Object.isFrozen(a.look.parts));
  assert.equal(a.id, 'f3');
  assert.deepEqual(a.post, { x: 7, y: 2 });
  const text = JSON.stringify([a, leadUnit({ ...base }, { level: 4, rules, leads, foes, words, roadLevel: 4, hooks })]);
  assert.ok(!/storybook|mauds|long-road/i.test(text), 'no mode is baked into a spec');
  // Every field §5.2 lists, in its order.
  assert.deepEqual(Object.keys(a), ['id', 'side', 'name', 'kind', 'talkKind', 'rank', 'level', 'size', 'small', 'archetype', 'genres', 'temperament',
    'calling', 'path', 'abilities', 'maxIntegrity', 'integrity', 'guard', 'resolve', 'speed', 'moves', 'strike', 'ranged', 'keyAdjust', 'flat', 'attackEdge',
    'resist', 'weak', 'ignores', 'idleHeat', 'shield', 'charges', 'abilityIds', 'uses', 'reactions', 'control', 'adapt', 'rattled', 'lead', 'post', 'look', 'carry']);
  assert.deepEqual(a.carry, { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] });
});

test('a lead’s bars shrink with the party by the same share as the budget, and its phases follow the stage', () => {
  const byStage = { hairline: 2, open: 3, gaping: 3 };
  for (const [stage, phases] of Object.entries(byStage)) {
    const s = { ...base, stage };
    const full = leadUnit(s, { level: 7, rules, leads, foes, words, partySize: 4, roadLevel: 7, hooks });
    assert.equal(full.lead.phases, phases, stage);
    assert.equal(full.lead.bars.length, phases, stage);
    assert.equal(full.level, stage === 'gaping' ? 6 : 5, `${stage}: from ${stage === 'gaping' ? 1 : 2} below`);
    for (const [size, share] of [[3, 0.75], [2, 0.5], [1, 0.25]]) {
      assert.equal(leadShare(rules.budgets, stage === 'hairline' ? 'moderate' : 'severe', size, s.depth), share);
      const small = leadUnit(s, { level: 7, rules, leads, foes, words, partySize: size, roadLevel: 7, hooks });
      const m = rules.archetypes[full.archetype].integrity;
      const xInt = leadMechanic(s, { leads, words }).xInt;
      const want = Math.round((Math.round(strayRow(rules, 'integrity', full.level) * m) + eliteBonus(rules, full.level)) * share / xInt);
      assert.equal(small.lead.bars[0], want, `${stage}, ${size} heroes`);
    }
  }
  // Depth past 3 grows every budget per hero, so the share stays the same.
  assert.equal(leadShare(rules.budgets, 'severe', 3, 9), 0.75);
  assert.equal(roomBudget(rules.budgets, 'severe', 3, 9), 90 + 3 * 10);
  // A lead never goes below level 0.
  assert.equal(leadUnit({ ...base, stage: 'open' }, { level: 1, rules, leads, foes, words, roadLevel: 1, hooks }).level, 0);
});

test('a lead’s mechanic: shipped ones fight as themselves, the rest and every Maelstrom lead as the fallback', () => {
  const shipped = new Set(leads.mechanics.filter((m) => m.ships).map((m) => m.id));
  let seen = 0;
  let asFallback = 0;
  for (let i = 0; i < 1500; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'mechanic'), tier: 1 + (i % 8), depth: 1 });
    const mech = mechanicOf(spec, leads, words);
    assert.notEqual(mech.id, 'fallback', 'every riftgen mechanic is in leads.json');
    assert.equal(words.genres[mech.genre].mechanics[mech.index], spec.taleLead.mechanic);
    assert.equal(mech.entry.text, spec.taleLead.mechanic);
    const fights = leadMechanic(spec, { leads, words });
    if (spec.maelstrom || !shipped.has(mech.id)) { assert.equal(fights.fights, 'fallback'); asFallback += 1; } else assert.equal(fights.fights, mech.id);
    if (mech.noFight) assert.ok(['verdant', 'starlight', 'summit', 'backhalls'].includes(mech.genre));
    seen += 1;
  }
  assert.ok(seen === 1500 && asFallback > 100);
  assert.deepEqual(mechanicOf({ taleLead: { mechanic: 'something riftgen never says' } }, leads, words), { id: 'fallback', genre: null, index: -1, entry: null, noFight: false });
});

test('a lead stays a puzzle when its mechanic is a no-fight one or it’s bright or Backhalls itself, whichever way a fusion pairs them', () => {
  const { isPuzzleLead } = bestiary;
  const text = (genre, i) => words.genres[genre].mechanics[i];
  const lead = (genre, mechanic) => ({ ...base, genres: [genre], taleLead: { ...base.taleLead, genre, mechanic } });
  const shadow = leads.mechanics.find((m) => m.ships);
  const puzzle = leads.mechanics.find((m) => m.noFight);
  assert.equal(isPuzzleLead(lead('neon', text(shadow.genre, shadow.index)), { leads, words, rules }), false, 'a shadow lead with a fighting mechanic fights');
  assert.equal(isPuzzleLead(lead('neon', text(puzzle.genre, puzzle.index)), { leads, words, rules }), true, 'a no-fight mechanic never fights');
  for (const genre of ['verdant', 'starlight', 'summit', 'backhalls']) {
    assert.equal(isPuzzleLead(lead(genre, text(shadow.genre, shadow.index)), { leads, words, rules }), true, `a ${genre} lead with a shadow mechanic stays a puzzle`);
    assert.equal(isPuzzleLead(lead(genre, text(shadow.genre, shadow.index)), { leads, words }), true, `${genre}, without rules`);
  }
  assert.equal(isPuzzleLead({ ...base, taleLead: null }, { leads, words, rules }), true, 'no lead, no fight');
});

test('a fusion lead can carry its second genre’s mechanic, and mechanicOf finds it there', () => {
  let found = null;
  for (let i = 0; i < 6000 && !found; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'fusion-mech'), tier: 8, depth: 1 });
    if (spec.genres.length < 2) continue;
    const own = words.genres[spec.taleLead.genre].mechanics.includes(spec.taleLead.mechanic);
    if (!own) found = spec;
  }
  assert.ok(found, 'a fusion lead with its second genre’s mechanic');
  const mech = mechanicOf(found, leads, words);
  assert.notEqual(mech.genre, found.taleLead.genre);
  assert.ok(found.genres.includes(mech.genre));
});

test('a lead wears its display name, never a company name unless it’s a planned hook', () => {
  let clashes = 0;
  for (let i = 0; i < 3000; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'lead-name'), tier: 1 + (i % 8), depth: 1 });
    const unit = leadUnit(spec, { level: 3, rules, leads, foes, words, roadLevel: 3, hooks });
    const clash = D.leadname.companyNamesIn(spec.taleLead.name);
    if (clash.length) clashes += 1;
    assert.deepEqual(D.leadname.companyNamesIn(unit.name), [], unit.name);
    assert.ok(unit.name.length <= 40, unit.name);
    if (clash.length) {
      const kept = leadUnit(spec, { level: 3, rules, leads, foes, words, roadLevel: 3, hooks: [clash[0]] });
      assert.ok(kept.name.includes(clash[0]) || spec.taleLead.name.length > 40, 'a hooked name keeps its own');
    }
  }
  assert.ok(clashes > 50, `${clashes} leads needed another name`);
});

test('a lead’s temperament is the one the wilds show for it', () => {
  for (let i = 0; i < 50; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'temperament'), tier: 5, depth: 1 });
    const unit = leadUnit(spec, { level: 7, rules, leads, foes, words, roadLevel: 7, hooks });
    assert.equal(unit.temperament, TEMPERAMENTS[hashInts(spec.seed >>> 0, 'lead') % 9]);
    assert.equal(unit.idleHeat, rules.temperaments[unit.temperament].heat);
  }
  assert.deepEqual([...TEMPERAMENTS], Object.keys(rules.temperaments), 'riftgen’s temperaments, in rules.json’s order');
});

test('canon foes, cave creatures and the Mimic: no genre, their archetype’s lines, their own bows’ talk kind', () => {
  const sentry = foeUnit(foes.canon.find((f) => f.id === 'hollow-sentries'), 4, { rules, foes, roadLevel: 4 });
  assert.equal(sentry.kind, 'hollow-sentries');
  assert.equal(sentry.talkKind, 'hollow-sentries');
  assert.equal(sentry.name, 'Hollow Sentry');
  assert.deepEqual(sentry.genres, []);
  assert.equal(sentry.maxIntegrity, Math.round(strayRow(rules, 'integrity', 4) * 1.25));
  assert.equal(sentry.strike.kind, 'plain');
  assert.deepEqual(sentry.weak, { spark: strayRow(rules, 'resist', 4) }, 'a construct is weak to Spark');
  assert.equal(sentry.look.kind, 'stray');
  const beetle = foeUnit(foes.creatures.find((f) => f.id === 'cinder-beetles'), 2, { rules, foes, roadLevel: 2 });
  assert.equal(beetle.kind, 'creature');
  assert.equal(beetle.name, 'Cinder beetle');
  assert.ok(beetle.abilityIds.includes('pounce'));
  const murmur = foeUnit(foes.creatures.find((f) => f.id === 'murmurs'), 5, { rules, foes, roadLevel: 5 });
  assert.equal(murmur.rank, 'lackey', 'Murmurs come as a swarm of lackeys');
  assert.equal(murmur.level, 3);
  const fox = foeUnit(foes.creatures.find((f) => f.id === 'fetchfoxes'), 2, { rules, foes, roadLevel: 2 });
  assert.equal(fox.temperament, 'shy');
  assert.ok(fox.abilityIds.includes('fetchfox-pinch'));
  const mimic = foeUnit(foes.mimic, 3, { rules, foes, roadLevel: 3, post: { x: 4, y: 5 } });
  assert.equal(mimic.kind, 'mimic');
  assert.equal(mimic.strike.amount + mimic.flat, 1, 'its bite tickles: 1 damage');
  assert.deepEqual(mimic.look, { kind: 'sprite', name: 'chest.mimic' });
  assert.ok(mimic.abilityIds.includes('mimic-bite'));
});

test('bestiary sources never read the clock or Math.random', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['src/combat/bestiary.js', 'src/combat/encounters.js', 'src/world/arena.js', 'src/world/leadname.js']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/Date\.now|Math\.random|performance\.now|document\.|window\./.test(text), `${file} is pure`);
  }
  assert.ok(has('src/combat/bestiary.js'));
  void genres;
});
