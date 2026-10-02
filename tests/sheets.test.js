// Phase 5b: character sheets. Every named person has wants, a voice, an answer to every gift, a
// day, opinions of their neighbours and callbacks to what they remember.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createState, normalizeState } from '../src/model.js';
import { cleanPeople } from '../src/state5.js';
import { allPeople, personOf, personView, meet, choose } from '../src/people.js';
import { startErrand, finishErrand, errandEvent } from '../src/errands.js';
import {
  GIFT_ITEMS, DAY_PARTS, GIFT_LOVE, GIFT_LIKE, sheetGaps, spokenLines, voiceFaults, ticCount, partOfDay, isLocal,
  wantMet, wantNow, opening, giftView, giftKind, give, giftsKnown, aboutView, about, fireTalk,
} from '../src/sheets.js';
import { ITEM_NAMES } from '../src/camplife.js';

const dir = new URL('../content/people/npcs/', import.meta.url);
const npcs = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
  const file = JSON.parse(readFileSync(new URL(n, dir), 'utf8'));
  return [file.id, file];
}));
const content = { people: { npcs } };
const people = allPeople(content);
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const fresh = () => createState(T0);
const withItems = (state, items) => ({ ...state, satchel: { ...state.satchel, materials: { ...state.satchel.materials, ...items } } });
const wendell = () => personOf(content, 'wendell');

test('every named person’s sheet is whole', () => {
  assert.deepEqual(GIFT_ITEMS, Object.keys(ITEM_NAMES));
  for (const p of people) assert.deepEqual(sheetGaps(p), [], `${p.id} lacks ${sheetGaps(p).join(', ')}`);
  assert.deepEqual(sheetGaps(null), ['person']);
  assert.ok(sheetGaps({ id: 'x', name: 'X' }).includes('sheet.wants.now'));
  assert.ok(sheetGaps({ ...wendell(), gifts: { loves: ['stone'], replies: { birch: ['A log.'] } } }).includes('gifts.replies.trout'), 'every gift needs a reply');
  assert.ok(sheetGaps({ ...wendell(), why: 'Here.' }).includes('why'), 'no sheet without a reason for the place');
});

test('a companion says what they leave behind; a local never leaves and needn’t', () => {
  for (const p of people) {
    if (isLocal(p)) assert.equal(p.camp.leaves, undefined, `${p.id} never comes to camp`);
    else assert.ok(p.camp.leaves.length > 0, `${p.id} leaves something`);
  }
  assert.equal(isLocal(personOf(content, 'mags')), true);
  assert.equal(isLocal(wendell()), false);
});

test('the voice lint: nobody uses a word they never use, or a sentence longer than their own', () => {
  for (const p of people) {
    const spoken = spokenLines(p);
    assert.ok(spoken.length >= 40, `${p.id} has a voice: ${spoken.length} lines`);
    for (const line of spoken) assert.deepEqual(voiceFaults(p, line), [], `${p.id}: ${line}`);
  }
  const p = wendell();
  assert.deepEqual(voiceFaults(p, 'It is roughly here.'), ['says “roughly”']);
  assert.equal(voiceFaults(p, `${Array.from({ length: 30 }, () => 'road').join(' ')}.`).length, 1);
  assert.deepEqual(voiceFaults(p, ''), []);
});

test('everyone has a tic of their own, used now and then, and their favourite words turn up', () => {
  const tics = people.map((p) => p.voice.tic.toLowerCase());
  for (const p of people) assert.ok(p.voice.tic.length >= 4, `${p.id}: a tic is a phrase, not a syllable`);
  assert.equal(new Set(tics).size, tics.length, 'no two people share a tic');
  for (const p of people) {
    const { lines, withTic } = ticCount(p);
    assert.ok(withTic >= 2, `${p.id} says “${p.voice.tic}” at least twice (${withTic})`);
    assert.ok(withTic <= lines / 3, `${p.id} doesn’t say “${p.voice.tic}” in every other line (${withTic} of ${lines})`);
    const all = spokenLines(p).join(' ');
    for (const word of p.voice.words) assert.ok(all.toLowerCase().includes(word.toLowerCase()), `${p.id} says “${word}”`);
    // nobody else's tic in their mouth
    for (const other of people) if (other.id !== p.id) assert.ok(!all.includes(other.voice.tic), `${p.id} doesn’t say ${other.id}’s “${other.voice.tic}”`);
  }
});

test('the sheet is plain and only speaks: no stage directions, ellipses, dashes, similes or "it’s not X, it’s Y"', () => {
  for (const p of people) {
    const prose = [...Object.values(p.sheet.wants), ...Object.values(p.sheet.favourites), ...p.sheet.aversions, p.sheet.temperament, p.sheet.strangers, p.sheet.friends, p.sheet.opensUp, p.sheet.goesQuiet,
      p.voice.rhythm, p.voice.hello, p.voice.goodbye, p.voice.pleased, p.voice.putOut, ...Object.values(p.arc), p.why];
    for (const text of [...spokenLines(p), ...prose]) {
      assert.ok(!text.includes('!') && !text.includes("'") && !/\bplease\b/i.test(text), `${p.id}: calm: ${text}`);
      assert.ok(!/…|\.\.\.|—|–|;/.test(text), `${p.id}: no ellipses, dashes or semicolons: ${text}`);
      assert.ok(!/\b(?:as if|as though|like an?)\b/i.test(text), `${p.id}: no similes: ${text}`);
      assert.ok(text.length <= 220, `${p.id}: short: ${text}`);
    }
    // (what they say of a neighbour may well begin "She has": that is speech about someone)
    const ofOthers = new Set(Object.values(p.thinks).flat());
    for (const text of spokenLines(p)) {
      assert.ok(ofOthers.has(text) || !/^(?:He|She|They)\s+(?:is|does|doesn’t|looks|takes|sets|writes|considers|stares|nods|opens|closes|lets|turns|says|goes|has|smiles|laughs|pauses)\b/.test(text), `${p.id}: narration: ${text}`);
      assert.ok(!/\b(?:isn’t|is not|aren’t|are not|not)\b[^.?!]{0,60}[.,]\s*(?:it’s|it is|that’s|that is|they’re|they are)\b/i.test(text), `${p.id}: no "it’s not X, it’s Y": ${text}`);
    }
  }
});

test('what they think of each other, and what they recall, point at real people and real memories', () => {
  for (const p of people) {
    for (const id of Object.keys(p.thinks)) assert.ok(npcs[id] && id !== p.id, `${p.id} thinks of ${id}`);
    for (const id of Object.keys(p.recalls)) assert.ok(p.memories[id], `${p.id} recalls a memory they can have: ${id}`);
    assert.ok(Object.keys(p.recalls).length >= 3);
    for (const item of [...p.gifts.loves, ...(p.gifts.likes || [])]) assert.ok(GIFT_ITEMS.includes(item), `${p.id} likes a real thing: ${item}`);
    assert.equal(new Set([...p.gifts.loves, ...(p.gifts.likes || [])]).size, p.gifts.loves.length + (p.gifts.likes || []).length);
  }
});

test('a gift always gets an answer; one they love earns approval, once a day, and is used up', () => {
  const p = wendell();
  let state = withItems(meet(fresh(), p, T0), { stone: 2, trout: 1, ash: 1 });
  assert.deepEqual(giftView(state, p).map((g) => [g.item, g.have]).sort(), [['ash', 1], ['stone', 2], ['trout', 1]]);
  assert.deepEqual([giftKind(p, 'stone'), giftKind(p, 'ash'), giftKind(p, 'trout')], ['loves', 'likes', 'plain']);
  let r = give(state, p, 'trout', T0);
  assert.deepEqual([r.ok, r.delta, r.kind, r.lines, r.notes], [true, 0, 'plain', p.gifts.replies.trout, []]);
  assert.equal(r.state.satchel.materials.trout, 0);
  assert.equal(r.state.people.wendell.gift, null, 'a plain gift doesn’t use up the day');
  r = give(r.state, p, 'stone', T0 + 1000);
  assert.deepEqual([r.delta, r.kind, r.notes.map((n) => n.kind)], [GIFT_LOVE, 'loves', ['approves']]);
  assert.equal(r.state.people.wendell.points, 2);
  const again = give(r.state, p, 'stone', T0 + 2000);
  assert.deepEqual([again.ok, again.delta, again.lines], [true, 0, p.gifts.replies.stone], 'he still answers, and it still goes');
  assert.equal(again.state.satchel.materials.stone, 0);
  const tomorrow = give(again.state, p, 'ash', T0 + DAY);
  assert.equal(tomorrow.delta, GIFT_LIKE);
  assert.deepEqual(giftsKnown(tomorrow.state, p), { loves: ['stone'], likes: ['ash'], plain: ['trout'] });
  assert.equal(give(tomorrow.state, p, 'ash', T0 + DAY).ok, false, 'nothing left to give');
});

test('a gift needs a meeting, something in hand and a real thing', () => {
  const p = wendell();
  assert.equal(give(withItems(fresh(), { stone: 1 }), p, 'stone', T0).ok, false, 'not before they’ve met');
  const met = meet(fresh(), p, T0);
  assert.equal(give(met, p, 'stone', T0).ok, false);
  assert.equal(give(withItems(met, { stone: 1 }), p, 'cabbage', T0).ok, false);
  assert.equal(give(withItems(met, { stone: 1 }), p, 'stone', NaN).ok, false);
  assert.deepEqual(giftView(met, p), []);
});

test('the gift day and what was given survive a save, and junk is repaired', () => {
  const p = wendell();
  const r = give(withItems(meet(fresh(), p, T0), { stone: 1 }), p, 'stone', T0);
  const back = normalizeState(JSON.parse(JSON.stringify(r.state)), T0);
  assert.equal(back.people.wendell.gift, r.state.people.wendell.gift);
  assert.deepEqual(back.people.wendell.found.gifts, ['stone']);
  const odd = cleanPeople({ wendell: { points: 1, gift: 'never', found: { gifts: ['stone', 'BAD!', 5] } } }, { now: T0 }).wendell;
  assert.deepEqual([odd.gift, odd.found.gifts], [null, ['stone']]);
});

test('a person’s talk moves on once their want is met', () => {
  const p = wendell();
  let state = { ...fresh(), people: cleanPeople({ wendell: { points: 3, met: T0, seen: T0 } }) };
  assert.equal(wantMet(state, p), false);
  assert.equal(wantNow(state, p), p.sheet.wants.now);
  assert.deepEqual(personView(state, p, T0).greeting, p.hello.warm);
  state = startErrand(state, p, T0);
  state = errandEvent(state, content, { kind: 'visit', target: 'landmark:last-bridge' }, T0 + 1);
  state = errandEvent(state, content, { kind: 'visit', target: 'townhall' }, T0 + 2);
  state = finishErrand(state, p, T0 + 3).state;
  assert.equal(wantMet(state, p), true);
  assert.equal(wantNow(state, p), p.sheet.wants.next);
  const view = personView(state, p, T0 + 4);
  assert.deepEqual(view.greeting, p.helloAfter[view.level]);
  assert.notDeepEqual(view.greeting, p.hello[view.level]);
  // someone with no errand keeps their one want
  const mags = personOf(content, 'mags');
  assert.equal(wantNow(state, mags), mags.sheet.wants.now);
});

test('the part of the day follows the clock', () => {
  const at = (h) => partOfDay(new Date(2026, 9, 5, h, 30).getTime());
  assert.deepEqual([5, 6, 11, 12, 17, 18, 21, 22, 2].map(at), ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night']);
  assert.deepEqual(DAY_PARTS, ['morning', 'afternoon', 'evening', 'night']);
});

test('what they say first: their hello, their day, or something they remember; the same all morning', () => {
  const p = wendell();
  let state = meet(fresh(), p, T0);
  state = choose(state, p, 'plaque', p.topics[0].options.findIndex((o) => o.approach === 'truth'), T0).state; // remembers said-it-aloud
  const seen = new Set();
  for (let d = 0; d < 40; d += 1) {
    const now = T0 + d * DAY;
    const said = opening(p, state, now, { hello: 'HELLO' });
    assert.equal(said, opening(p, state, now + 60_000, { hello: 'HELLO' }), 'steady within the hour');
    seen.add(said);
  }
  assert.ok(seen.has('HELLO') && seen.has(p.day.afternoon) && seen.has(p.recalls['said-it-aloud'][0]), [...seen].join(' | '));
  const rainy = new Set();
  for (let d = 0; d < 40; d += 1) rainy.add(opening(p, state, T0 + d * DAY, { hello: 'HELLO', weather: 'rain' }));
  assert.ok(rainy.has(p.day.rain) && !rainy.has(p.day.afternoon), 'in the rain they talk about the rain');
  assert.equal(opening(null, state, T0, { hello: 'HELLO' }), 'HELLO');
  // nothing remembered yet: never an empty line
  for (let d = 0; d < 20; d += 1) assert.ok(opening(p, meet(fresh(), p, T0), T0 + d * DAY, { hello: 'HELLO' }).length > 0);
});

test('they talk about the people you’ve met, and nobody else', () => {
  const p = wendell();
  let state = meet(fresh(), p, T0);
  assert.deepEqual(aboutView(state, content, p), []);
  state = meet(state, personOf(content, 'gorrin'), T0);
  assert.deepEqual(aboutView(state, content, p), [{ id: 'gorrin', name: 'Gorrin' }]);
  assert.deepEqual(about(p, 'gorrin'), p.thinks.gorrin);
  assert.deepEqual(about(p, 'nobody'), []);
});

test('by the fire, one resident says something about another, the same all day', () => {
  assert.equal(fireTalk(fresh(), content, T0), null);
  const one = { ...fresh(), people: cleanPeople({ wendell: { points: 5, met: T0, seen: T0, camp: T0 } }) };
  assert.equal(fireTalk(one, content, T0), null, 'it takes two');
  const two = { ...fresh(), people: cleanPeople({ wendell: { points: 5, met: T0, seen: T0, camp: T0 }, gorrin: { points: 6, met: T0, seen: T0, camp: T0 + 1 } }) };
  const said = fireTalk(two, content, T0);
  assert.ok(['wendell', 'gorrin'].includes(said.who) && ['wendell', 'gorrin'].includes(said.about) && said.who !== said.about);
  assert.deepEqual(said.lines, npcs[said.who].thinks[said.about]);
  assert.deepEqual(fireTalk(two, content, T0 + 3600_000), said);
  const days = new Set();
  for (let d = 0; d < 12; d += 1) days.add(fireTalk(two, content, T0 + d * DAY).who);
  assert.equal(days.size, 2, 'they take turns');
});

test('Chris can tell any two people apart by a single line', () => {
  const firsts = people.map((p) => p.meet[0]);
  assert.equal(new Set(firsts).size, firsts.length);
  const all = people.flatMap((p) => spokenLines(p));
  const twice = all.filter((l, i) => all.indexOf(l) !== i);
  assert.deepEqual(twice, [], 'nobody says a line somebody else says');
});
