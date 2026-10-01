// Words for fights (src/combat/describe.js; CONTRACT-PHASE4.md §5.8, §7.1, §2 "Calm copy"): Log
// lines from real fights pass assertCalm and the cosy words, at most 100 characters; odds as bars
// and words; Examine lines; combatant labels; summaries; thought bubbles; draft readouts.
//   node --test tests/combat-describe.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCalm, assertCosy, assertOwnWords } from './calm.js';
import {
  logLines, oddsText, whyText, combatantLabel, examineLine, summary, actionWords, thoughtText, thoughtWords, draftReadout, tileName,
} from '../src/combat/describe.js';
import { runToEnd } from '../src/combat/driver.js';
import { hero, stray, fightSpec, makeCtx, createBattle, A, seedAt, findUnit, realAbilities } from './combat-kit.js';

// Fight words LORE §21 doesn't list yet (wave 4 adds them; §16.3): actions, degrees, kinds, conditions.
const PENDING_NAMES = ['Stride', 'Step', 'Strike', 'Brace', 'Examine', 'Seek', 'Interact', 'Assist', 'Talk', 'Cool', 'Reboot', 'Delay', 'Hide',
  'Throw', 'Shove', 'Jump', 'Dip', 'Sustain', 'Ready', 'Head', 'Critical', 'Hit', 'Graze', 'Miss', 'Buffer', 'Static', 'Chill', 'Dread', 'Grind',
  'Warp', 'Doubt', 'Dust', 'Quake', 'Light', 'Ink', 'Spark', 'Plain', 'Tumbled', 'Tangled', 'Drowsy', 'Dazzled', 'Spooked', 'Beguiled', 'Queasy',
  'Rattled', 'Dazed', 'Slowed', 'Quickened', 'Brisk', 'Winded', 'Sparked', 'Singed', 'Soaked', 'Hushed', 'Unseen', 'Exposed', 'Singled',
  'Lingering', 'Integrity', 'Calm', 'Noise', 'Letter', 'Draft', 'Being', 'Mote', 'Flare', 'Inkdarts', 'Full', 'Pounce', 'Glitch', 'Madame',
  'Voss', 'Tale-lead', 'Hooklight', 'Scribe', 'Artificer', 'Bench', 'Turret', 'Decoy', 'Pop-up', 'Patch'];
const calm = (text, where) => {
  assertCalm(text, where, { proper: PENDING_NAMES });
  assertCosy(text, where);
  assertOwnWords(text, where);
};

test('every Log line from 150 fights is calm, cosy and at most 100 characters', () => {
  const ctx = makeCtx();
  const genres = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'];
  const seen = new Set();
  for (let i = 0; i < 150; i += 1) {
    const g = genres[i % genres.length];
    const foes = [stray('f0', { x: 10, y: 1, genre: g }), stray('f1', { x: 11, y: 2, genre: g, archetype: 'crawler', talkKind: 'k1' })];
    const b = createBattle(fightSpec({ seed: seedAt(i), genres: [g], foes }), [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
    const r = runToEnd(b, ctx);
    for (const line of logLines(r.events, r.battle)) {
      assert.ok(line.length <= 100, line);
      if (seen.has(line)) continue;
      seen.add(line);
      calm(line, 'a Log line');
    }
    for (const line of r.battle.log) assert.ok(line.length <= 100);
    assert.ok(r.battle.log.length <= 30);
    calm(r.result.summary, 'the summary');
    assert.ok(r.result.summary.length <= 200);
  }
  assert.ok(seen.size > 40, `${seen.size} distinct lines`);
});

test('the Log reads like COMBAT §3.7: “Pip — Critical — 17 Warp”', () => {
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1, name: 'Glitch beetle' })] }), [hero('pip')], {}, makeCtx());
  const lines = logLines([
    { t: 'damage', unit: 'pip', target: 'f0', amount: 17, kind: 'warp', degree: 'crit', weak: 3, resist: 0, buffered: 0, integrity: 0, max: 20 },
    { t: 'damage', unit: 'f0', target: 'pip', amount: 3, kind: 'static', degree: 'graze', weak: 0, resist: 0, buffered: 3, integrity: 10, max: 16 },
    { t: 'outcome', unit: 'f0', target: 'pip', degree: 'miss', bars: [5, 60, 15, 20], k: 3, cheer: false, by: null },
    { t: 'sorted', unit: 'f0', how: 'settled' },
    { t: 'offline', unit: 'pip' },
    { t: 'end', result: { outcome: 'offline' } },
  ], b);
  assert.deepEqual(lines, [
    'Pip — Critical — 17 Warp',
    'Glitch beetle — Graze — 3 Static, 3 into Buffer',
    'Glitch beetle — Miss',
    'Glitch beetle is sorted, waves and goes home.',
    'Pip goes offline and dozes.',
    'Everyone went offline. Everyone’s fine.',
  ]);
});

test('odds read as bars with amounts and ? until Examined, or as words', () => {
  const odds = { bars: [20, 35, 15, 30], amounts: [14, 7, 3, 0], known: false };
  assert.equal(oddsText(odds), 'Critical 20% 14? · Hit 35% 7? · Graze 15% 3? · Miss 30%');
  assert.equal(oddsText({ ...odds, known: true }), 'Critical 20% 14 · Hit 35% 7 · Graze 15% 3 · Miss 30%');
  assert.equal(oddsText({ bars: [5, 80, 10, 5], amounts: null }), 'Critical 5% · Hit 80% · Graze 10% · Miss 5%');
  assert.equal(oddsText({ bars: [20, 55, 15, 10] }, { style: 'words' }), 'Likely. A Critical is in reach.');
  assert.equal(oddsText({ bars: [5, 50, 15, 30] }, { style: 'words' }), 'About even.');
  assert.equal(oddsText({ bars: [0, 35, 15, 50] }, { style: 'words' }), 'A long shot.');
  for (const t of ['Likely. A Critical is in reach.', 'About even.', 'A long shot.']) calm(t, 'odds words');
});

test('an Examine line, a combatant label and a tile’s name', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1, archetype: 'crawler', temperament: 'curious', name: 'Glitch beetle' })] }), [hero('milo')], { calm: { noise: false, adaptation: true } }, ctx);
  assert.equal(examineLine(b, 'f0'), 'Resists Static 3. Weak to Warp 3. Curious.');
  const label = combatantLabel(b, 'f0', ctx);
  assert.match(label, /^Glitch beetle, 20 of 20 Integrity, telegraphing /);
  calm(label, 'a combatant label');
  const spooked = { ...b, units: b.units.map((u) => (u.id === 'milo' ? { ...u, conditions: [{ id: 'spooked', n: 1, source: 'f0', data: null }] } : u)) };
  assert.equal(combatantLabel(spooked, 'milo', ctx), 'Milo, 18 of 18 Integrity, Spooked 1, 20 heat');
  assert.equal(tileName(b, { x: 4, y: 4 }), 'e5');
  assert.equal(tileName(b, { x: 0, y: 0 }), 'a1');
});

test('the planner’s words: “Letter Pip”, “Stride to c4”', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1, name: 'Glitch beetle' })] }), [hero('claude'), hero('pip')], {}, ctx);
  assert.equal(actionWords(b, 'claude', A.use('letter', { unit: 'pip' }), ctx), 'Letter Pip');
  assert.equal(actionWords(b, 'claude', A.stride([{ x: 1, y: 3 }, { x: 2, y: 3 }])), 'Stride to c4');
  assert.equal(actionWords(b, 'claude', A.strike('f0')), 'Strike glitch beetle');
  assert.equal(actionWords(b, 'claude', A.assist('pip', 'f0')), 'Assist Pip on glitch beetle');
  assert.equal(actionWords(b, 'claude', A.brace()), 'Brace');
  assert.equal(actionWords(b, 'pip', A.strike('claude')), 'Strike the Scribe');
});

test('thought bubbles speak in the hero’s voice by layer, and Jev’s are pictures', () => {
  assert.deepEqual(thoughtText('habit', 'Patch Milo', { voice: 'words' }), { text: 'Patching Milo, like you would.', picture: null });
  assert.deepEqual(thoughtText('rule', 'Patch Milo', { voice: 'words' }), { text: 'Patching Milo. Your rule.', picture: null });
  assert.deepEqual(thoughtText('personality', 'Talk first', { voice: 'words' }), { text: 'Talking first. It’s what I do.', picture: null });
  assert.deepEqual(thoughtText('habit', 'Stride to c4', null), { text: 'Striding to c4, like you would.', picture: null });
  assert.deepEqual(thoughtText('habit', 'Step to c4', null).text, 'Stepping to c4, like you would.');
  assert.deepEqual(thoughtText('habit', 'Strike glitch beetle', { voice: 'pictures' }), { text: null, picture: 'pile' });
  assert.deepEqual(thoughtText('habit', 'Brace', { voice: 'pictures' }), { text: null, picture: 'tilt' });
  for (const t of ['Patching Milo, like you would.', 'Patching Milo. Your rule.', 'Talking first. It’s what I do.']) calm(t, 'a thought');
});

// Only a basic action's verb becomes an -ing word, including where an ability's name starts with one.
const GERUNDS = {
  Stride: 'Striding', Step: 'Stepping', Strike: 'Striking', Brace: 'Bracing', Examine: 'Examining', Seek: 'Seeking', Interact: 'Interacting',
  Assist: 'Assisting', Talk: 'Talking', Cool: 'Cooling', Reboot: 'Rebooting', Delay: 'Delaying', Hide: 'Hiding', Throw: 'Throwing',
  Shove: 'Shoving', Jump: 'Jumping', Dip: 'Dipping', Sustain: 'Sustaining', Ready: 'Readying', Head: 'Heading', Patch: 'Patching',
};

test('every live ability thinks in its own name, as a noun, with whom or where it’s for; only basic verbs become -ing words', (t) => {
  const index = realAbilities();
  if (!index) return t.skip('the party and foe content isn’t there yet');
  const ctx = makeCtx({ abilityIndex: index });
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 2 })] }), [hero('milo'), hero('claude'), hero('pip')], {}, ctx);
  let n = 0;
  for (const a of index.values()) {
    if (a.stub || a.kind === 'passive' || a.kind === 'reaction') continue;
    const choice = a.choices ? Object.keys(a.choices)[0] : null;
    const cost = a.by ? Number(Object.keys(a.by)[0]) : (a.costs || [1])[0];
    const spec = a.by ? a.by[String(cost)] : a.choices ? a.choices[choice] : a;
    const who = spec?.target?.who || 'self';
    const many = (spec?.target?.count || 1) > 1;
    let target = null;
    let suffix = '';
    if (who === 'foe') [target, suffix] = [{ unit: 'f0' }, ' on glitch beetle'];
    else if (['ally', 'ally-or-self', 'unit', 'offline-ally'].includes(who)) [target, suffix] = many ? [{ units: ['milo', 'pip'] }, ' on Milo and Pip'] : [{ unit: 'milo' }, ' on Milo'];
    else if (who === 'tile') [target, suffix] = [{ tile: { x: 3, y: 2 } }, ' at d3'];
    const words = thoughtWords(b, 'claude', { ...A.use(a.id, target, { cost }), choice }, ctx);
    const [first, ...rest] = a.name.split(' ');
    const lead = GERUNDS[first] ? [GERUNDS[first], ...rest].join(' ') : a.name.charAt(0).toUpperCase() + a.name.slice(1);
    for (const [layer, end] of [['habit', ', like you would.'], ['rule', '. Your rule.'], ['personality', '. It’s what I do.']]) {
      const text = thoughtText(layer, words, { voice: 'words' }).text;
      assert.equal(text, `${lead}${suffix}${end}`, a.id);
      assert.doesNotMatch(text, /inging/, a.id);
      calm(text, `${a.id}’s thought`);
    }
    n += 1;
  }
  assert.ok(n > 40, `${n} abilities`);
  // Basic actions keep their verbs: an Interact names what it's used on.
  const lever = { ...b, objects: [{ id: 'o0', kind: 'lever', x: 2, y: 1, state: 'up', flags: [], integrity: null }] };
  assert.equal(thoughtText('habit', thoughtWords(lever, 'milo', A.interact({ object: 'o0' }), ctx)).text, 'Interacting with the lever, like you would.');
  assert.equal(thoughtText('habit', thoughtWords(b, 'milo', A.strike('f0'), ctx)).text, 'Striking glitch beetle, like you would.');
  assert.equal(thoughtText('habit', thoughtWords(b, 'milo', A.talk('f0'), ctx)).text, 'Talking down glitch beetle, like you would.');
});

test('a draft reads out for screen readers with its confidence and its why; why? joins its lines', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1, name: 'Glitch beetle' })] }), [hero('milo'), hero('claude')], {}, ctx);
  const draft = {
    unitId: 'claude',
    plan: { unitId: 'claude', slots: [A.use('letter', { unit: 'milo' }), A.stride([{ x: 2, y: 2 }]), A.use('draft', { unit: 'f0' })], reactions: {}, by: 'draft', changed: [false, false, false] },
    confidence: 38, source: 'habit', choices: [],
    why: [{ slot: 0, layer: 'habit', text: 'New to Neon.', count: null, of: null }],
  };
  const text = draftReadout(draft, b, ctx);
  assert.equal(text, 'The Scribe drafts Letter on Milo, Stride, Draft on glitch beetle. 38 percent sure: new to Neon.');
  calm(text, 'a readout');
  assert.equal(whyText(draft.why), 'New to Neon.');
  assert.equal(whyText([{ text: 'You patched the most hurt ally in 11 of 12 fights like this.' }, { text: 'Your rule.' }]), 'You patched the most hurt ally in 11 of 12 fights like this. Your rule.');
});

test('the campfire summary is calm and names what happened', () => {
  const ctx = makeCtx();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 10, y: 1 })] }), [hero('milo'), hero('claude')], {}, ctx);
  for (const outcome of ['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']) {
    const s = summary(b, { outcome });
    calm(s, outcome);
    assert.ok(s.length <= 200);
  }
  assert.match(summary(b, { outcome: 'won' }), /Milo kept the lantern high\.$/);
  assert.equal(summary(b, { outcome: 'offline' }), 'Everyone went offline. Everyone’s fine.');
  assert.ok(findUnit(b, 'milo'));
});


test('damage with no one behind it is taken, never dealt; a Beguiled stray’s lost action says Beguiled', () => {
  const ctx = makeCtx({
    foePlan: (b, id) => ({ unitId: id, slots: [A.strike('milo')], reactions: {}, by: 'foe', changed: [false] }),
    draft: (b, id) => ({ unitId: id, plan: { unitId: id, slots: [A.brace()], reactions: {}, by: 'draft', changed: [false] }, confidence: 35, source: 'personality', why: [], choices: [] }),
  });
  const b0 = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 1 })] }), [hero('milo')], { calm: { noise: false, adaptation: true } }, ctx);
  const singed = logLines([{ t: 'damage', round: 1, tick: 1, unit: null, target: 'milo', amount: 3, kind: 'light', degree: 'hit', weak: 0, resist: 0, buffered: 0, integrity: 15, max: 18 }], b0);
  assert.deepEqual(singed, ['Milo takes 3 Light.']);
  const b = { ...b0, units: b0.units.map((u) => (u.id === 'f0' ? { ...u, conditions: [{ id: 'beguiled', n: null, source: 'milo', data: null }] } : u)) };
  const r = runToEnd(b, ctx, { maxRounds: 1 });
  const lost = r.events.find((e) => e.t === 'lost' && e.unit === 'f0');
  assert.equal(lost?.why, 'beguiled');
  const line = logLines([lost], b).join();
  assert.match(line, /loses an action \(Beguiled\)/);
  calm(line, 'the Beguiled line');
  calm(singed[0], 'the singed line');
  // The other words this round of fixes added: planner options, a reveal, and the two new noises.
  const more = logLines([
    { t: 'reveal', unit: 'f0', what: 'unseen', text: 'The light finds Glitch beetle.' },
    { t: 'noise', genre: 'starlight', what: 'kind', unit: 'milo' },
    { t: 'noise', genre: 'gothic', what: 'hidden', unit: 'f0' },
    { t: 'improvise', unit: 'milo', from: A.stride([{ x: 2, y: 1 }]), to: A.brace(), why: 'spooked' },
  ], b);
  assert.equal(more.length, 4);
  for (const text of [...more, 'Throw a cordial', 'Shove to tumble', 'Nothing beside you to tumble']) calm(text, text);
});
