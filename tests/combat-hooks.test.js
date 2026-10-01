// The kernel's remaining named proofs (module B; CONTRACT-PHASE4.md §4.3, §4.17, §6.5, §6.6, §13
// wave 1 B): the attack penalty in play (light weapons only for Strikes and Throws, reactions never
// counted, a split ability one attack), room heat from round 2, Cool down, falls at the room's
// level, Wayward, Hearth's Salve, swipe-strike, and every §6.6 hook called at its point.
//   node --test tests/combat-hooks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUse, makeRun, landHit } from '../src/combat/effects.js';
import { forcedMove } from '../src/combat/round.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { legalActions, oddsFor } from '../src/combat/battle.js';
import { hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, play, playRound, findUnit, ab, ABILITIES } from './combat-kit.js';
import { assertCalm } from './calm.js';

const still = (id) => plan(id, [], { by: 'foe' });
const noNoise = { calm: { noise: false, adaptation: true } };
const place = (b, id, x, y, patch = {}) => ({ ...b, units: b.units.map((u) => (u.id === id ? { ...u, x, y, ...patch } : u)) });
const withAbilities = (extra, opts = {}) => makeCtx({ foePlan: (bb, id) => still(id), abilityIndex: buildAbilityIndex({ callings: { abilities: [...ABILITIES, ...extra] } }), ...opts });
function round(b, ctx, plans) {
  const c = play(b, [...Object.entries(plans).map(([id, slots]) => ({ t: 'plan', unitId: id, plan: plan(id, slots) })), { t: 'commit' }], ctx);
  const r = playRound(c.battle, ctx);
  return { battle: r.battle, events: [...c.events, ...r.events] };
}
const heatOf = (events, id) => events.filter((e) => e.t === 'heat' && e.unit === id).map((e) => e.heat);

test('the attack penalty in play: a light weapon’s Strikes and Throws add 10, a knack marked attack adds 20, reactions add nothing', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const big = (id, x, y) => stray(id, { x, y, integrity: 200, maxIntegrity: 200, talkKind: id === 'f0' ? 'k0' : 'k1' });
  const b = createBattle(fightSpec({ foes: [big('f0', 2, 2)] }), [hero('milo')], noNoise, ctx);
  const x = place(b, 'milo', 1, 2);
  const strikes = round(x, ctx, { milo: [A.strike('f0'), A.strike('f0'), A.strike('f0')] });
  assert.deepEqual(heatOf(strikes.events, 'milo').slice(0, 2), [30, 40], 'Milo’s light weapon: +10 from the second Strike');
  const throws = round(x, ctx, { milo: [A.throw('f0'), A.throw('f0')] });
  assert.deepEqual(heatOf(throws.events, 'milo').slice(0, 1), [30], 'a Throw with a light weapon: +10');
  const motes = round(x, ctx, { milo: [A.use('mote', { unit: 'f0' }), A.use('mote', { unit: 'f0' })] });
  assert.deepEqual(heatOf(motes.events, 'milo').slice(0, 1), [40], 'Mote is a knack marked attack: +20 whatever the weapon');
  // Reactions: a Parting swipe is at the swiper's heat and doesn't count toward its attack index.
  const walker = makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 3, y: 2 }, { x: 4, y: 2 }])], { by: 'foe' }) });
  const w = createBattle(fightSpec({ foes: [big('f0', 2, 2)] }), [hero('milo')], noNoise, walker);
  const swipe = round(place(w, 'milo', 1, 2), walker, { milo: [A.brace()] });
  assert.ok(swipe.events.some((e) => e.t === 'reaction' && e.unit === 'milo'));
  assert.deepEqual(swipe.events.filter((e) => e.t === 'heat' && e.unit === 'milo' && e.round === 1), [], 'no heat from a reaction');
  const after = findUnit(swipe.battle, 'milo');
  assert.equal(after.attacks, 0, 'and no attack counted');
});

test('an ability with several pieces (split) is one attack: one heat step, one attack index', () => {
  const volley = ab({ id: 'many-small-things', attack: true, meets: 'guard', costs: [2], target: { who: 'foe', range: 4 }, effects: [{ do: 'damage', line: 'one', kind: 'caster', split: 3 }] });
  const ctx = withAbilities([volley]);
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 200, maxIntegrity: 200 })] }), [hero('pip', { abilityIds: ['many-small-things'] })], noNoise, ctx);
  const r = applyUse(place(b, 'pip', 2, 2), 'pip', volley, { cost: 2, target: { unit: 'f0' } }, ctx);
  assert.equal(r.events.filter((e) => e.t === 'outcome').length, 3, 'three pieces, three outcomes');
  assert.equal(findUnit(r.battle, 'pip').attacks, 1, 'one attack');
  assert.equal(findUnit(r.battle, 'pip').heat, 45, 'the first attack adds no heat');
  const again = applyUse(r.battle, 'pip', volley, { cost: 2, target: { unit: 'f0' } }, ctx);
  assert.equal(findUnit(again.battle, 'pip').heat, 65, 'the second adds 20 once');
});

test('room heat from round 2: Neon +10 and Iron −10 after drift; Cool down takes 30', () => {
  for (const [genre, change] of [['neon', 10], ['iron', -10], ['gothic', 0]]) {
    const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
    const b = createBattle(fightSpec({ genres: [genre], foes: [stray('f0', { x: 12, y: 2, genre })] }), [hero('pip')], noNoise, ctx);
    const r1 = round(b, ctx, { pip: [A.brace()] });
    assert.equal(findUnit(r1.battle, 'pip').heat, Math.max(0, 45 + change), `${genre}: round 2 starts at idle ${change >= 0 ? '+' : ''}${change}`);
  }
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 12, y: 2, genre: 'gothic' })] }), [hero('pip')], noNoise, ctx);
  const cooled = round(b, ctx, { pip: [A.cool()] });
  assert.ok(cooled.events.some((e) => e.t === 'heat' && e.unit === 'pip' && e.heat === 15));
  const floor = round({ ...b, units: b.units.map((u) => (u.id === 'pip' ? { ...u, heat: 10 } : u)) }, ctx, { pip: [A.cool()] });
  assert.ok(floor.events.some((e) => e.t === 'heat' && e.unit === 'pip' && e.heat === 0), 'not below 0');
});

test('a fall deals the one line in Plain at the room’s level per step dropped, and Tumbles', () => {
  const heights = ['0000000000000000', '0000000000000000', '0000002000000000', '0000000000000000', '0000000000000000', '0000000000000000'];
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  for (const level of [1, 5]) {
    const b = createBattle(fightSpec({ level, foes: [stray('f0', { x: 6, y: 2, integrity: 200, maxIntegrity: 200, resist: {} })], arenaOpts: { heights } }), [hero('milo')], noNoise, ctx);
    const run = makeRun(place(b, 'milo', 5, 2), ctx);
    forcedMove(run, 'milo', 'f0', 'push', 1);
    const fall = run.events.find((e) => e.t === 'damage' && e.target === 'f0');
    assert.equal(fall.amount, { 1: 5, 5: 9 }[level] * 2, `two steps down at level ${level}`);
    assert.equal(fall.kind, 'plain');
    assert.ok(run.b.units.find((u) => u.id === 'f0').conditions.some((c) => c.id === 'tumbled'));
  }
});

test('Wayward adds 1 Speed; Hearth’s Salve never lands below a Hit; swipe-strike lets Unseen strike ride a Parting swipe', () => {
  const salve = ab({ id: 'salve', kind: 'spell', circle: 1, costs: [2], helpful: true, target: { who: 'ally-or-self', range: 1 }, effects: [{ do: 'patch', line: 'two' }] });
  const extra = [
    ab({ id: 'wayward', kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: ['wayward-path'], summons: [] } }),
    ab({ id: 'hearth', kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: ['hearth-path'], summons: [] } }),
    ab({ id: 'unseen-strike', kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: ['unseen-strike'], summons: [] } }),
    ab({ id: 'swipe-strike', kind: 'passive', costs: [], passive: { mods: [], aura: null, rules: ['swipe-strike'], summons: [] } }),
    salve,
  ];
  const ctx = withAbilities(extra);
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 3 })] }), [hero('milo', { abilityIds: ['wayward', 'hearth', 'salve'], charges: { pool: 'three-quarter', max: 2, left: 2, circle: 1 } })], noNoise, ctx);
  const far = round(b, ctx, { milo: [A.stride([{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }])] });
  assert.equal(findUnit(far.battle, 'milo').x, 6, 'Speed 4 + 1 walks 5 tiles');
  const [odds] = oddsFor(b, 'milo', A.use('salve', { unit: 'milo' }, { cost: 2 }), ctx, { plan: plan('milo', [A.use('salve', { unit: 'milo' }, { cost: 2 })]) });
  assert.equal(odds.bars[2] + odds.bars[3], 0, 'Salve with the Hearth path: at least a Hit');
  const swipeCtx = makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 4, y: 2 }, { x: 5, y: 2 }])], { by: 'foe' }), abilityIndex: ctx.abilities });
  const sk = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, integrity: 90, maxIntegrity: 90 })] }), [hero('pip', { abilityIds: ['unseen-strike', 'swipe-strike'] }), hero('claude')], noNoise, swipeCtx);
  const s = round(place(place(sk, 'pip', 2, 2), 'claude', 3, 3), swipeCtx, { pip: [A.brace()], claude: [A.brace()] });
  const swipeHit = s.events.find((e) => e.t === 'damage' && e.unit === 'pip');
  const swipePick = s.events.find((e) => e.t === 'outcome' && e.unit === 'pip');
  if (swipeHit && swipePick.degree === 'hit') assert.equal(swipeHit.amount, 7 + 5 + 3, 'the one line rides the swipe (Claude stood beside the target)');
  assert.ok(swipePick, 'Pip swiped');
});

test('every §6.6 hook is called at its point: mechanic actions and resolve, bows’ actions, resolve and afterAction, and the minds’ improvise and choices', () => {
  const calls = [];
  const mechanic = {
    id: 'fallback',
    actions: (b, unitId) => (b.units.find((u) => u.id === unitId)?.side === 'party' ? [{ action: { id: 'use', ability: 'mech:reroute', cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null }, words: 'Reroute', cost: 1, targets: null, why: null }] : []),
    resolve: (b, unitId, action) => {
      calls.push(`resolve:${action.ability || action.id}`);
      if (action.ability !== 'mech:reroute') return null;
      return { battle: { ...b, lead: { ...b.lead, data: { rerouted: (b.lead.data.rerouted || 0) + 1 } } }, events: [{ t: 'line', round: b.round, tick: b.tick, text: 'A junction clicks over.' }] };
    },
  };
  const bows = {
    actions: () => [{ action: { id: 'use', ability: 'mech:ring-bell', cost: 2, target: null, extra: 0, choice: null, cheer: false, trigger: null }, words: 'Ring the bell', cost: 2, targets: null, why: null }],
    resolve: (b, unitId, action) => {
      calls.push(`bow-resolve:${action.id}`);
      return null;
    },
    afterAction: (b, unitId, action) => {
      calls.push(`after:${unitId}:${action.id}`);
      return { battle: b, events: [] };
    },
  };
  const lead = stray('lead', { x: 12, y: 2, talkKind: null });
  lead.rank = 'lead';
  lead.size = 2;
  lead.lead = { mechanic: 'fallback', phases: 2, bars: [30, 30], quote: 'q' };
  const base = makeCtx({ foePlan: (bb, id) => still(id) });
  const minds = {
    ...base.minds,
    improvise: (b, unitId, action, why) => {
      calls.push(`improvise:${unitId}:${why}`);
      return { id: 'cool-down', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null };
    },
    choices: (b, unitId, p) => p.slots.map((a) => ({ slot: 0, template: a.id === 'brace' ? 7 : 3, ability: 0, relation: 1, cost: 1 })),
  };
  const ctx = makeCtx({ minds, mechanics: { fallback: mechanic }, bows });
  const b = createBattle(fightSpec({ leadUnit: lead, kind: 'lead', foes: [stray('f0', { x: 10, y: 3 })] }), [hero('claude')], noNoise, ctx);
  const opts = legalActions(b, 'claude', ctx);
  assert.ok(opts.some((o) => o.action.ability === 'mech:reroute'), 'mechanic actions merge into legalActions');
  assert.ok(opts.some((o) => o.action.ability === 'mech:ring-bell'), 'and bows’ actions');
  const r = round(b, ctx, { claude: [A.use('mech:reroute'), A.strike('f0'), A.brace()] });
  assert.equal(r.battle.lead.data.rerouted, 1, 'mechanic.resolve handled the mech action');
  assert.ok(calls.includes('improvise:claude:out-of-reach'), 'a Strike out of reach asks the minds to improvise');
  assert.ok(r.events.some((e) => e.t === 'improvise' && e.unit === 'claude' && e.to.id === 'cool-down'));
  assert.ok(calls.some((c) => c.startsWith('after:claude:')), 'bows.afterAction after each action');
  assert.equal(r.battle.seen['7:0'], 1, 'Battle.seen counts the habits shown (from minds.choices)');
  assert.ok(r.battle.seen['3:0'] >= 1);
  const miloCtx = makeCtx({ foePlan: (bb, id) => still(id) });
  const mb = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 3 })] }), [hero('milo')], noNoise, miloCtx);
  const m = round(mb, miloCtx, { milo: [A.strike('f0')] });
  assert.ok(m.events.some((e) => e.t === 'improvise' && e.unit === 'milo' && e.to.id === 'brace'), 'Milo Braces when his plan meets the round');
  assert.ok(findUnit(m.battle, 'milo'));
  assert.ok(apply(mb, { t: 'commit' }, miloCtx).battle);
  assert.ok(landHit && ab);
});

// ---------- the basic actions ----------

test('Throw reaches 3 + 2 × Might (at least 1) for the one line in Plain; a thrown cordial patches everyone within 1', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 4, y: 2, integrity: 90, maxIntegrity: 90 })] }), [hero('milo'), hero('claude', { abilities: { might: 2, grace: 1, grit: 1, wit: 3, heed: 2, charm: 0 } })], noNoise, ctx);
  const x = place(place(b, 'milo', 1, 2), 'claude', 1, 3);
  const miloThrow = legalActions(x, 'milo', ctx).find((o) => o.action.id === 'throw');
  assert.deepEqual(miloThrow.targets, [], 'Might −1: 3 + 2 × −1 = 1 tile, and the stray is 3 away');
  const far = legalActions(place(x, 'f0', 7, 3), 'claude', ctx).find((o) => o.action.id === 'throw');
  assert.equal(far.targets.length, 1, 'Might 2: 7 tiles');
  const hit = round(place(x, 'milo', 3, 2), ctx, { milo: [A.throw('f0')] });
  const d = hit.events.find((e) => e.t === 'damage' && e.target === 'f0');
  const o = hit.events.find((e) => e.t === 'outcome' && e.unit === 'milo');
  if (d) assert.equal(d.amount, { crit: 10, hit: 5, graze: 2 }[o.degree], 'the one line in Plain');
  const hurt = { ...x, units: x.units.map((u) => (u.side === 'party' ? { ...u, integrity: 4 } : u)) };
  const splash = round(hurt, ctx, { milo: [{ ...A.throw(null), ability: 'cordial', target: { tile: { x: 1, y: 3 } } }] });
  assert.equal(splash.events.filter((e) => e.t === 'patch').length, 2, 'both within 1 of the tile');
  assert.equal(findUnit(splash.battle, 'milo').carry.cordial, 1);
});

test('Shove: a Hit pushes 1 (none against a larger foe); a Critical pushes 2 or Tumbles; a Large foe can’t be Tumbled', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  let pushed = 0;
  for (let s = 1; s < 60; s += 1) {
    const b = createBattle(fightSpec({ seed: s, foes: [stray('f0', { x: 3, y: 2, resolve: { body: 0, mind: 0 } })] }), [hero('codex')], noNoise, ctx);
    const r = round(place(b, 'codex', 2, 2), ctx, { codex: [A.shove('f0', s % 2 ? 'tumble' : null)] });
    const pick = r.events.find((e) => e.t === 'outcome' && e.unit === 'codex');
    const f = findUnit(r.battle, 'f0');
    if (pick.degree === 'hit') assert.equal(f.x, 4);
    if (pick.degree === 'crit' && s % 2) assert.ok(f.conditions.some((c) => c.id === 'tumbled'));
    if (pick.degree === 'crit' && !(s % 2)) assert.equal(f.x, 5);
    if (f.x > 3) pushed += 1;
  }
  assert.ok(pushed > 0);
  const big = stray('f0', { x: 3, y: 2, resolve: { body: 0, mind: 0 } });
  big.size = 2;
  for (let s = 1; s < 30; s += 1) {
    const b = createBattle(fightSpec({ seed: s, foes: [big] }), [hero('codex')], noNoise, ctx);
    const r = round(place(b, 'codex', 2, 2), ctx, { codex: [A.shove('f0', 'tumble')] });
    const f = findUnit(r.battle, 'f0');
    assert.equal(f.x, 3, 'a larger foe isn’t pushed');
    assert.ok(!f.conditions.some((c) => c.id === 'tumbled'), 'nor Tumbled by a shove');
  }
});

test('Jump leaps 2 + Might tiles (at least 1); Dip makes the next Strike deal Light and 2 more', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2, integrity: 90, maxIntegrity: 90 })], objects: [{ id: 'o0', kind: 'candle', x: 3, y: 1, state: 'lit', flags: [], integrity: null }] }), [hero('codex')], noNoise, ctx);
  const j = round(b, ctx, { codex: [A.jump({ x: 3, y: 2 })] });
  assert.deepEqual([findUnit(j.battle, 'codex').x, findUnit(j.battle, 'codex').y], [3, 2]);
  const tooFar = round(b, ctx, { codex: [A.jump({ x: 5, y: 1 })] });
  assert.ok(tooFar.events.some((e) => e.t === 'lost' || e.t === 'improvise'), 'beyond 2 + Might is refused');
  const dipped = round(place(place(b, 'codex', 3, 2), 'f0', 4, 2), ctx, { codex: [A.dip(), A.strike('f0')] });
  const hit = dipped.events.find((e) => e.t === 'damage' && e.unit === 'codex');
  const pick = dipped.events.find((e) => e.t === 'outcome' && e.unit === 'codex');
  if (hit) {
    assert.equal(hit.kind, 'light');
    assert.equal(hit.amount, { crit: 18, hit: 9, graze: 4 }[pick.degree], 'Strike 7 + 2 from the dip');
  }
  assert.ok(!findUnit(dipped.battle, 'codex').mods.some((m) => m.stat === 'dip'), 'spent on the Strike');
});

test('Examine reveals stats (and at Wit 3+ a Tale-lead’s next trick, in its own words); Seek finds the Unseen and a Noir stray’s intents', () => {
  // I's Mechanics carry leads.json's `text`; the kernel reads it, never the mechanic's id.
  const alibis = { id: 'alibis', text: 'hides behind alibis; present evidence to break them' };
  const ctx = makeCtx({ foePlan: (bb, id) => still(id), mechanics: { alibis, fallback: { id: 'fallback', text: 'a plain Tale-lead' } } });
  const leadOf = (mechanic) => {
    const u = stray('lead', { x: 12, y: 2, talkKind: null, genre: 'noir' });
    u.rank = 'lead';
    u.size = 2;
    u.lead = { mechanic, phases: 2, bars: [20, 20], quote: 'q' };
    return u;
  };
  const b = createBattle(fightSpec({ leadUnit: leadOf('alibis'), lead: { mechanic: 'alibis', phases: 2, bow: 'x', quote: 'q' }, kind: 'lead', foes: [stray('f0', { x: 4, y: 2, genre: 'noir' })] }), [hero('claude'), hero('milo')], noNoise, ctx);
  const ex = round(b, ctx, { claude: [A.examine('lead')] });
  assert.ok(ex.events.some((e) => e.t === 'reveal' && e.what === 'stats'));
  const next = ex.events.find((e) => e.t === 'reveal' && e.what === 'mechanic');
  assert.equal(next?.text, 'Next phase, it hides behind alibis; present evidence to break them.', 'the Scribe has Wit 3');
  assertCalm(next.text, 'the Examine line');
  assert.equal(findUnit(ex.battle, 'lead').examined, true);
  const milo = round(b, ctx, { milo: [A.examine('lead')] });
  assert.ok(milo.events.some((e) => e.t === 'reveal' && e.what === 'stats'));
  assert.ok(!milo.events.some((e) => e.t === 'reveal' && e.what === 'mechanic'), 'Milo has Wit 0: stats only');
  const plainLead = createBattle(fightSpec({ leadUnit: leadOf('fallback'), kind: 'lead' }), [hero('claude')], noNoise, ctx);
  assert.ok(!round(plainLead, ctx, { claude: [A.examine('lead')] }).events.some((e) => e.t === 'reveal' && e.what === 'mechanic'), 'the fallback has nothing more to show');
  const wordless = makeCtx({ foePlan: (bb, id) => still(id), mechanics: { alibis: { id: 'alibis' } } });
  const quiet = createBattle(fightSpec({ leadUnit: leadOf('alibis'), kind: 'lead' }), [hero('claude')], noNoise, wordless);
  assert.ok(!round(quiet, wordless, { claude: [A.examine('lead')] }).events.some((e) => e.t === 'reveal' && e.what === 'mechanic'), 'nor a mechanic without words');
  const hidden = { ...b, lights: [], units: b.units.map((u) => (u.id === 'f0' ? { ...u, conditions: [{ id: 'unseen', n: null, source: null, data: null }], x: 6 } : u)) };
  const sk = round(place(hidden, 'claude', 2, 2), ctx, { claude: [A.seek()] });
  assert.ok(!findUnit(sk.battle, 'f0').conditions.some((c) => c.id === 'unseen'), 'found within 6');
  assert.ok(sk.events.some((e) => e.t === 'reveal' && e.unit === 'f0' && e.what === 'intent'));
});

test('a dramatic kind can be talked down only after its big moment; the cheer command spends a held Cheer at commit', () => {
  const big = { id: 'use', ability: 'glitch-slash', cost: 1, target: { unit: 'milo' }, extra: 0, choice: null, cheer: false, trigger: null };
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, bb.round === 1 ? [big] : [], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2, temperament: 'dramatic', abilityIds: ['glitch-slash'] })] }), [hero('milo'), hero('claude')], noNoise, ctx);
  const x = place(b, 'milo', 2, 2);
  assert.equal(legalActions(x, 'claude', ctx).find((o) => o.action.id === 'talk-down').why, 'No one to talk down');
  const after = round(x, ctx, { milo: [A.brace()] }).battle;
  assert.ok(findUnit(after, 'f0').mods.some((m) => m.stat === 'big-done'));
  assert.equal(legalActions(after, 'claude', ctx).find((o) => o.action.id === 'talk-down').why, null);
  const cheerCtx = makeCtx({ foePlan: (bb, id) => still(id) });
  let c = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })] }), [hero('milo')], { ...noNoise, cheers: 1 }, cheerCtx);
  c = apply(c, { t: 'plan', unitId: 'milo', plan: plan('milo', [A.strike('f0'), A.strike('f0')]) }, cheerCtx).battle;
  c = apply(c, { t: 'cheer', unitId: 'milo', slot: 0, on: true }, cheerCtx).battle;
  assert.equal(c.plans.milo.slots[0].cheer, true);
  assert.equal(apply(c, { t: 'cheer', unitId: 'milo', slot: 1, on: true }, cheerCtx).battle, c, 'only as many as are held');
  const committed = apply(c, { t: 'commit' }, cheerCtx);
  assert.equal(committed.battle.cheers, 0);
  assert.ok(committed.events.some((e) => e.t === 'cheer' && e.cheers === 0));
});

test('a mechanic’s roundEnd can yield: The last page ends the fight as last-page', () => {
  const lead = stray('lead', { x: 12, y: 2, talkKind: null });
  lead.rank = 'lead';
  lead.size = 2;
  lead.lead = { mechanic: 'fallback', phases: 2, bars: [40, 40], quote: 'q' };
  const ctx = makeCtx({ foePlan: (bb, id) => still(id), mechanics: { fallback: { id: 'fallback', roundEnd: (b) => ({ battle: b, events: [], yielded: b.round >= 2 }) } } });
  let b = createBattle(fightSpec({ leadUnit: lead, kind: 'lead' }), [hero('milo')], noNoise, ctx);
  b = round(b, ctx, { milo: [A.brace()] }).battle;
  assert.equal(b.status, 'planning');
  const r = round(b, ctx, { milo: [A.brace()] });
  assert.equal(r.battle.status, 'last-page');
  assert.equal(r.battle.result.outcome, 'last-page');
});


test('the planner offers a thrown cordial to an ally in range, and a Shove to Tumble on anything beside but a Large foe', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => still(id) });
  const big = stray('f1', { x: 2, y: 2, talkKind: 'k1' });
  big.size = 2;
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1 }), big] }), [hero('milo'), hero('claude')], noNoise, ctx);
  const opts = legalActions(b, 'milo', ctx);
  const toss = opts.find((o) => o.action.id === 'throw' && o.action.ability === 'cordial');
  assert.deepEqual([toss.words, toss.targets, toss.why], ['Throw a cordial', [{ unit: 'claude' }], null], 'Might −1 throws 1 tile: the Scribe beside him');
  assert.deepEqual(opts.find((o) => o.action.id === 'shove' && !o.action.choice).targets, [{ unit: 'f0' }, { unit: 'f1' }]);
  const tumble = opts.find((o) => o.action.id === 'shove' && o.action.choice === 'tumble');
  assert.deepEqual([tumble.words, tumble.targets], ['Shove to tumble', [{ unit: 'f0' }]], 'never the Large one');
  const dry = { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, carry: { ...u.carry, cordial: 0 } } : u)) };
  assert.equal(legalActions(dry, 'milo', ctx).find((o) => o.action.id === 'throw' && o.action.ability === 'cordial').why, 'No cordials left');
});
