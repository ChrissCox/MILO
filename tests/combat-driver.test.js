// The round loop (src/combat/driver.js; CONTRACT-PHASE4.md §7.1, §13 wave 1 B proofs 4.1a): the
// round view, commit and its RoundRecord, thought bubbles and barks, Tell me how it went, and the
// properties: 1,000 seeded 3v3 fights end within 10 rounds with no stuck state; replaying the
// commands equals the battle (500 seeds, two kinds of minds); restoreBattle(saveBattle(b))
// deep-equals b at random points (500 seeds); a Try again gets different outcomes.
//   node --test tests/combat-driver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashString, createRng } from '../src/world/rng.js';
import { roundView, commit, step, answer, runToEnd, canWrap, stubMinds, simplePlan } from '../src/combat/driver.js';
import { saveBattle, restoreBattle, TERMINAL } from '../src/combat/battle.js';
import { rules, hero, stray, fightSpec, makeCtx, createBattle, apply, A, plan, findUnit, seedAt } from './combat-kit.js';

const HEROES = () => [hero('milo'), hero('claude'), hero('codex')];
const three = () => [
  stray('f0', { x: 10, y: 1 }),
  stray('f1', { x: 11, y: 2, archetype: 'crawler', temperament: 'curious', talkKind: 'k1' }),
  stray('f2', { x: 12, y: 3, archetype: 'construct', talkKind: 'k2', resolve: { body: 2, mind: 0 } }),
];
const GENRES = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];
const fightFor = (seed) => fightSpec({ seed, genres: [GENRES[seed % GENRES.length]], foes: three().map((f) => ({ ...f, genres: [GENRES[seed % GENRES.length]] })) });

/** An "empty notebook" stand-in: personality alone (confidence 35), bracing first when hurt, otherwise the plain plan. */
function personalityMinds(ctx) {
  const base = stubMinds(ctx);
  return {
    ...base,
    draft: (battle, unitId) => {
      const u = battle.units.find((x) => x.id === unitId);
      const p = simplePlan(battle, unitId, ctx, { by: 'draft' });
      const slots = u && u.integrity < u.maxIntegrity / 2 ? [{ ...A.brace() }, ...p.slots].slice(0, 3) : p.slots;
      return { unitId, plan: { ...p, slots, by: 'draft' }, confidence: 35, source: 'personality', why: [], choices: [] };
    },
  };
}

/** Drives a fight through apply, recording every command (drafts as explicit plan commands). */
function drive(battle, ctx, { onState = null, maxSteps = 5000 } = {}) {
  let b = battle;
  const commands = [];
  const send = (c) => {
    commands.push(c);
    const r = apply(b, c, ctx);
    b = r.battle;
    return r;
  };
  let steps = 0;
  while (!TERMINAL.has(b.status) && steps < maxSteps) {
    steps += 1;
    if (onState) onState(b);
    if (b.status === 'planning') {
      for (const u of b.units) {
        if (u.side !== 'party' || u.rank !== 'hero' || u.offline) continue;
        const d = ctx.minds.draft(b, u.id);
        send({ t: 'plan', unitId: u.id, plan: d.plan, draft: { confidence: d.confidence, source: d.source, choices: d.choices, layers: d.plan.slots.map(() => 'personality') } });
      }
      send({ t: 'commit' });
    } else if (b.status === 'asking') send({ t: 'answer', yes: true });
    else send({ t: 'step' });
  }
  return { battle: b, commands, steps };
}

// ---------- the view and commit ----------

test('roundView shows telegraphs, drafts for heroes not on Mine, plans, the noise banner, Cheers, Wrap it up and trouble', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo', { control: 'mine' }), hero('claude'), hero('codex')];
  const b = createBattle(fightSpec({ foes: three() }), heroes, { cheers: 2 }, ctx);
  const v = roundView(b, ctx);
  assert.deepEqual(Object.keys(v.drafts).sort(), ['claude', 'codex']);
  assert.equal(v.drafts.claude.confidence, 35);
  assert.equal(v.noise.words, 'Neon: lag. About 1 action in 5 lands a tick late.');
  assert.equal(v.cheers, 2);
  assert.equal(v.canWrap, false);
  assert.deepEqual(v.telegraphs, b.telegraphs);
  assert.ok(Array.isArray(v.trouble.claude));
});

test('commit sends one plan per hero, then commit, and its RoundRecord is built before anything resolves', () => {
  const ctx = makeCtx();
  const heroes = [hero('milo'), hero('claude', { control: 'choose' }), hero('codex')];
  const b = createBattle(fightSpec({ foes: three() }), heroes, {}, ctx);
  const drafts = roundView(b, ctx).drafts;
  const changed = { ...drafts.milo.plan, slots: [A.brace(), ...drafts.milo.plan.slots.slice(1)] };
  const r = commit(b, { milo: changed, codex: drafts.codex.plan, claude: plan('claude', [A.cool()]) }, ctx);
  assert.equal(r.battle.status, 'running');
  assert.equal(r.battle.k, 0, 'no outcome has been picked yet');
  assert.ok(!r.events.some((e) => e.t === 'outcome'));
  const rec = r.record;
  assert.equal(rec.key, hashString(`${b.id}:0:1`) >>> 0);
  assert.equal(rec.round, 1);
  assert.deepEqual(Object.keys(rec.units).sort(), ['claude', 'codex', 'milo']);
  assert.equal(rec.units.milo.situation, Buffer.from(new Uint8Array(16)).toString('base64'));
  assert.deepEqual(rec.units.milo.draft, { confidence: 35, choices: [] });
  assert.equal(rec.units.milo.accepted[0], false, 'the changed slot isn’t accepted');
  assert.ok(rec.units.milo.accepted.slice(1).every(Boolean), 'the rest are');
  assert.equal(rec.units.milo.auto, false);
  assert.equal(rec.units.claude.auto, true, 'a hero on Let them choose commits their own draft');
  assert.equal(r.battle.plans.claude.by, 'auto');
  assert.deepEqual(r.battle.plans.claude.slots, drafts.claude.plan.slots);
  assert.equal(r.battle.plans.milo.by, 'draft');
  assert.deepEqual(r.battle.plans.milo.changed, [true, false, false].slice(0, changed.slots.length));
  const all = commit(b, {}, ctx, { auto: true });
  assert.ok(Object.values(all.record.units).every((u) => u.auto), 'Let them handle it: everyone auto');
  assert.equal(all.battle.auto, true);
});

test('a thought bubble shows only on a drafted, unchanged slot; Jev’s are pictures', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  const b = createBattle(fightSpec({ foes: three() }), [hero('milo'), hero('claude')], { calm: { noise: false, adaptation: true } }, ctx);
  const d = roundView(b, ctx).drafts;
  const miloPlan = { ...d.milo.plan, slots: [A.brace(), A.brace()] };
  let r = commit(b, { milo: miloPlan, claude: d.claude.plan }, ctx);
  let x = r.battle;
  const events = [...r.events];
  while (x.status === 'running') {
    const s = step(x, ctx);
    events.push(...s.events);
    x = s.battle;
  }
  const thoughts = events.filter((e) => e.t === 'thought');
  assert.ok(thoughts.length >= 1 && thoughts.every((e) => e.unit === 'claude'), 'Milo’s changed slots think nothing');
  assert.match(thoughts[0].text, /It’s what I do\.$/);
  const jevCtx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
  const jev = createBattle(fightSpec({ foes: three() }), [hero('milo', { id: 'jev', kind: 'jev', name: 'Jev', abilityIds: [] })], { calm: { noise: false, adaptation: true } }, jevCtx);
  const jd = roundView(jev, jevCtx).drafts;
  r = commit(jev, { jev: jd.jev.plan }, jevCtx);
  x = r.battle;
  const jevEvents = [];
  while (x.status === 'running') {
    const s = step(x, jevCtx);
    jevEvents.push(...s.events);
    x = s.battle;
  }
  const jt = jevEvents.filter((e) => e.t === 'thought');
  assert.ok(jt.length && jt.every((e) => e.text === null && ['pile', 'tilt'].includes(e.picture)));
});

test('a hero who plays their own draft (Let them choose, Let them handle it) thinks aloud on each drafted slot, as on Review', () => {
  const play1 = (control, opts = {}) => {
    const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }) });
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1, integrity: 90, maxIntegrity: 90 })] }), [hero('milo', { control: 'mine' }), hero('claude', { control })], { calm: { noise: false, adaptation: true } }, ctx);
    const drafts = roundView(b, ctx).drafts;
    const r = commit(b, { milo: plan('milo', [A.brace()]), claude: drafts.claude?.plan }, ctx, opts);
    let x = r.battle;
    const events = [...r.events];
    while (x.status === 'running') {
      const s = step(x, ctx);
      events.push(...s.events);
      x = s.battle;
    }
    return { by: r.battle.plans.claude.by, slots: r.battle.plans.claude.slots.length, thoughts: events.filter((e) => e.t === 'thought' && e.unit === 'claude').length };
  };
  const review = play1('review');
  const choose = play1('choose');
  const handle = play1('review', { auto: true });
  assert.equal(review.by, 'draft');
  assert.equal(choose.by, 'auto');
  assert.equal(handle.by, 'auto');
  assert.ok(review.thoughts > 0);
  assert.equal(choose.thoughts, review.thoughts, 'Let them choose: the same bubbles');
  assert.equal(handle.thoughts, review.thoughts, 'Let them handle it: the same bubbles');
});

test('in play, a drafted ability thinks in its own name: “Being sure on Milo, like you would.”', () => {
  const slots = { claude: [A.use('being-sure', { unit: 'milo' }), A.use('letter', { unit: 'milo' }, { cost: 2 })], milo: [A.use('the-lantern-calls', null, { cost: 3 })] };
  const draft = (bb, id) => (slots[id] ? { unitId: id, plan: plan(id, slots[id], { by: 'draft' }), confidence: 60, source: 'habit', why: [], choices: [] } : null);
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [], { by: 'foe' }), draft });
  const heroes = [hero('milo', { abilityIds: ['the-lantern-calls'], uses: { 'the-lantern-calls': 1 } }), hero('claude', { integrity: 5 })];
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 2 })] }), heroes, { calm: { noise: false, adaptation: true } }, ctx);
  let x = commit(b, {}, ctx).battle;
  const events = [];
  while (x.status === 'running') {
    const s = step(x, ctx);
    events.push(...s.events);
    x = s.battle;
  }
  assert.deepEqual(events.filter((e) => e.t === 'thought').map((e) => `${e.unit}: ${e.text}`), [
    'claude: Being sure on Milo, like you would.', 'milo: The lantern calls, like you would.', 'claude: Letter on Milo, like you would.',
  ]);
});

test('at most one bark a round, from the companions’ own barks, on a Critical or when someone goes offline', () => {
  const ctx = makeCtx();
  let barks = 0;
  const kinds = new Set();
  for (let s = 0; s < 150; s += 1) {
    const r = runToEnd(createBattle(fightFor(seedAt(s)), HEROES(), {}, ctx), ctx);
    const perRound = {};
    for (const e of r.events.filter((x) => x.t === 'bark')) perRound[e.round] = (perRound[e.round] || 0) + 1;
    assert.ok(Object.values(perRound).every((n) => n <= 1));
    barks += Object.keys(perRound).length;
    for (const e of r.events.filter((x) => x.t === 'bark')) {
      assert.ok(['There it is.', 'Just a moment.', 'Noted.', 'Built. Tests pass.'].includes(e.text));
      kinds.add(e.text === 'Just a moment.' ? 'offline' : 'critical');
    }
  }
  assert.ok(barks > 0);
  assert.deepEqual([...kinds].sort(), ['critical', 'offline'], 'barks come on a Critical and when someone goes offline');
});

test('step reports the round’s end, Asks and the result; answer resumes', () => {
  const ctx = makeCtx({ foePlan: (bb, id) => plan(id, [A.stride([{ x: 4, y: 2 }, { x: 5, y: 2 }])], { by: 'foe' }) });
  const b0 = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 })] }), [hero('milo', { reactions: { 'parting-swipe': 'ask' } })], { calm: { noise: false, adaptation: true } }, ctx);
  const b = { ...b0, units: b0.units.map((u) => (u.id === 'milo' ? { ...u, x: 2, y: 2 } : u)) };
  let x = commit(b, { milo: plan('milo', [A.brace()]) }, ctx).battle;
  let asked = null;
  let over = false;
  for (let i = 0; i < 10 && !over; i += 1) {
    const s = step(x, ctx);
    x = s.battle;
    if (s.ask) {
      asked = s.ask;
      x = answer(x, true, ctx).battle;
    }
    over = s.roundOver;
  }
  assert.equal(asked.reactionId, 'parting-swipe');
  assert.ok(over);
  assert.equal(x.status, 'planning');
  assert.equal(x.round, 2);
});

test('Tell me how it went plays a whole fight on auto in at most 100 ms (median), every record marked auto', () => {
  const ctx = makeCtx();
  const times = [];
  for (let s = 0; s < 40; s += 1) {
    const b = createBattle(fightFor(seedAt(s)), HEROES(), {}, ctx);
    const t0 = performance.now();
    const r = runToEnd(b, ctx);
    times.push(performance.now() - t0);
    assert.ok(r.result);
    assert.equal(r.result.auto, true);
    assert.ok(r.records.length >= 1 && r.records.every((rec) => Object.values(rec.units).every((u) => u.auto)));
  }
  times.sort((a, b) => a - b);
  assert.ok(times[20] <= 100, `median ${times[20].toFixed(1)} ms`);
});

test('Wrap it up is offered only when the foes’ remaining Integrity is below one round of the party’s expected damage', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: three() }), HEROES(), {}, ctx);
  assert.equal(canWrap(b, ctx), false);
  const low = { ...b, units: b.units.map((u) => (u.side === 'foe' ? { ...u, integrity: 2 } : u)) };
  assert.equal(canWrap(low, ctx), true);
});

// ---------- the properties ----------

test('1,000 seeded 3v3 fights end within 10 rounds with no stuck state', () => {
  const ctx = makeCtx();
  const outcomes = {};
  let maxRound = 0;
  for (let s = 0; s < 1000; s += 1) {
    const b = createBattle(fightFor(seedAt(s)), HEROES(), { mode: ['long-road', 'storybook', 'mauds-table'][s % 3] }, ctx);
    const r = runToEnd(b, ctx, { maxRounds: 10 });
    assert.ok(r.result, `seed ${s} ended`);
    assert.ok(['won', 'talked', 'offline'].includes(r.result.outcome), `seed ${s}: ${r.result.outcome}`);
    assert.ok(r.battle.round <= 10, `seed ${s} took ${r.battle.round} rounds`);
    outcomes[r.result.outcome] = (outcomes[r.result.outcome] || 0) + 1;
    maxRound = Math.max(maxRound, r.battle.round);
  }
  assert.ok(outcomes.won > 0);
  assert.ok(maxRound <= 10);
});

test('replaying a fight’s commands from the same inputs gives a deep-equal battle (500 seeds, stub minds and a personality-only notebook)', () => {
  for (const kind of ['stub', 'personality']) {
    for (let s = 0; s < 250; s += 1) {
      const mk = () => {
        const base = makeCtx();
        return kind === 'stub' ? base : makeCtx({ minds: personalityMinds(base) });
      };
      const ctx = mk();
      const inputs = [fightFor(seedAt(10000 + s)), HEROES(), { mode: s % 5 === 0 ? 'mauds-table' : 'long-road', cheers: s % 3 }];
      const first = drive(createBattle(...inputs, ctx), ctx);
      const again = mk();
      let b = createBattle(...inputs, again);
      for (const c of first.commands) b = apply(b, c, again).battle;
      assert.deepStrictEqual(b, first.battle, `${kind} seed ${s}`);
      // Any minds replay the same, since every hero plan is an explicit command: only foes plan by mind.
      if (s % 5) continue;
      const other = makeCtx({ minds: { ...personalityMinds(makeCtx()), foePlan: again.minds.foePlan } });
      let c2 = createBattle(...inputs, other);
      for (const c of first.commands) c2 = apply(c2, c, other).battle;
      assert.deepStrictEqual(c2, first.battle, `${kind} seed ${s} with other drafts`);
    }
  }
});

test('restoreBattle(saveBattle(b)) deep-equals b at random points over 500 seeds', () => {
  const ctx = makeCtx();
  let checked = 0;
  for (let s = 0; s < 500; s += 1) {
    const fight = fightFor(seedAt(20000 + s));
    const heroes = HEROES();
    const states = [];
    drive(createBattle(fight, heroes, { mode: ['long-road', 'storybook', 'mauds-table'][s % 3] }, ctx), ctx, { onState: (b) => states.push(b) });
    const rng = createRng(s + 1);
    for (let i = 0; i < 3; i += 1) {
      const b = states[rng.int(0, states.length - 1)];
      const save = JSON.parse(JSON.stringify(saveBattle(b)));
      assert.deepStrictEqual(restoreBattle(save, ctx, { fight, heroes }), b, `seed ${s}, ${b.status} r${b.round} t${b.tick} c${b.cursor}`);
      checked += 1;
    }
  }
  assert.equal(checked, 1500);
});

test('a Try again (attempt + 1) keeps the ribbon but gets different outcomes', () => {
  const ctx = makeCtx();
  let differ = 0;
  for (let s = 0; s < 20; s += 1) {
    const fight = fightFor(seedAt(30000 + s));
    const first = createBattle(fight, HEROES(), { attempt: 0 }, ctx);
    const retry = createBattle(fight, HEROES(), { attempt: 1 }, ctx);
    assert.deepEqual(retry.order, first.order);
    const a = runToEnd(first, ctx).events.filter((e) => e.t === 'outcome').map((e) => e.degree).join();
    const b = runToEnd(retry, ctx).events.filter((e) => e.t === 'outcome').map((e) => e.degree).join();
    if (a !== b) differ += 1;
  }
  assert.ok(differ >= 19, `${differ} of 20 differ`);
});

test('rules the driver leans on are the real ones', () => {
  assert.equal(rules.version, 1);
  assert.ok(findUnit);
});


test('the scripted player plays every hero, Mine included: ctx.minds.scriptedPlan when the minds have one, else their drafts', () => {
  const heroes = HEROES().map((h) => ({ ...h, control: 'mine' }));
  const ctx = makeCtx();
  const r = runToEnd(createBattle(fightFor(seedAt(3)), heroes, {}, ctx), ctx, { policy: 'scripted', maxRounds: 10 });
  assert.ok(r.records.length > 0 && TERMINAL.has(r.battle.status));
  for (const rec of r.records) {
    for (const [id, u] of Object.entries(rec.units)) assert.ok(u.auto && u.plan.slots.length > 0, `round ${rec.round}: ${id} played the scripted plan, not an empty one`);
  }
  assert.equal(r.battle.result.auto, true);
  let asked = 0;
  const base = makeCtx();
  const scripted = makeCtx({ minds: { ...base.minds, scriptedPlan: (b, id) => { asked += 1; return plan(id, [A.brace()]); } } });
  const s = runToEnd(createBattle(fightFor(seedAt(3)), heroes, {}, scripted), scripted, { policy: 'scripted', maxRounds: 2 });
  assert.ok(asked >= 3, 'asked for each hero');
  assert.deepEqual(Object.values(s.records[0].units).map((u) => u.plan.slots.map((a) => a.id)), [['brace'], ['brace'], ['brace']]);
});
