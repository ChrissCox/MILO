// Phase 5.1: the people of the Hushlands — approval, conversations, memories and Come to camp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createState, normalizeState } from '../src/model.js';
import { cleanPeople, APPROACHES, PEOPLE_LIMITS } from '../src/state5.js';
import {
  allPeople, personOf, personView, choose, meet, inviteToCamp, sendHome, residents, standing, residentsOf, levelOf, pointsNow,
  nextTopic, DAY_TURNS, FLOOR, BEDS, bedsFor,
} from '../src/people.js';
import { PALETTE } from '../src/world/sprites.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { exploreFrames, clipFrames, registerLook } from '../src/world/sprites-party.js';
import { assertCalm } from './calm.js';

const dir = new URL('../content/people/npcs/', import.meta.url);
const npcs = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
  const file = JSON.parse(readFileSync(new URL(n, dir), 'utf8'));
  return [file.id, file];
}));
const content = { people: { npcs } };
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const fresh = () => createState(T0);
const wendell = () => personOf(content, 'wendell');
const indexOf = (person, topicId, approach) => person.topics.find((t) => t.id === topicId).options.findIndex((o) => o.approach === approach);

test('the three people are in the bundle, and the state starts with nobody met', () => {
  assert.deepEqual(Object.keys(npcs).sort(), ['gorrin', 'jonas', 'mags', 'wendell']);
  assert.deepEqual(fresh().people, {});
  assert.deepEqual(allPeople(content).map((p) => p.id).sort(), ['gorrin', 'jonas', 'mags', 'wendell']);
  assert.deepEqual(standing(fresh(), content).map((p) => p.id).sort(), ['gorrin', 'jonas', 'wendell'], 'Mags arrives with the story');
});

test('every person file is complete, calm, and can be won', () => {
  const worldgen = createWorldgen({ seed: 'hushlands' });
  const wilds = createWilds({ worldgen, maxChunks: 16 });
  for (const npc of allPeople(content)) {
    const where = `${npc.id}`;
    assert.match(npc.id, /^[a-z][a-z0-9-]{1,39}$/);
    assert.ok(Number.isInteger(npc.threshold) && npc.threshold >= 3, `${where} threshold`);
    assert.ok(Number.isInteger(npc.where.x) && Number.isInteger(npc.where.y), `${where} stands somewhere`);
    assert.ok(worldgen.walkable(npc.where.x, npc.where.y) && !wilds.blocked(npc.where.x, npc.where.y), `${where} stands on walkable ground`);
    for (const key of Object.keys(npc.dye)) assert.ok(PALETTE[key] && PALETTE[npc.dye[key]], `${where} dye ${key}`);
    const likes = Object.keys(npc.likes);
    assert.ok(likes.length >= 2 && likes.every((a) => APPROACHES.includes(a)), `${where} likes`);
    for (const list of [npc.dislikes, npc.resists]) assert.ok(list.every((a) => APPROACHES.includes(a)), `${where} lists`);
    assert.equal(new Set([...likes, ...npc.dislikes, ...npc.resists]).size, likes.length + npc.dislikes.length + npc.resists.length, `${where}: an approach is liked, disliked or resisted, not two of them`);
    assert.ok(npc.examine.length >= 3 && npc.examine.every((l) => l.length <= 140), `${where} examine`);
    let best = 0;
    for (const topic of npc.topics) {
      assert.match(topic.id, /^[a-z][a-z0-9-]{0,39}$/);
      assert.ok(topic.options.length >= 3, `${where}.${topic.id} offers at least three ways to answer`);
      assert.ok(topic.options.some((o) => likes.includes(o.approach)), `${where}.${topic.id} has an answer they like`);
      for (const o of topic.options) {
        assert.ok(APPROACHES.includes(o.approach), `${where}.${topic.id} approach`);
        if (o.remember) assert.ok(npc.memories[o.remember], `${where}.${topic.id} remembers a known moment`);
      }
      best += Math.max(...topic.options.map((o) => npc.likes[o.approach] || 0));
    }
    assert.ok(best >= npc.threshold + 2, `${where}: the best answers (${best}) comfortably reach Fond (${npc.threshold})`);
    const campLines = Array.isArray(npc.camp.never) ? npc.camp.never : [...npc.camp.early, ...npc.camp.ask, ...npc.camp.yes, ...npc.camp.full];
    assert.ok(campLines.length > 0, `${where}: says something about the camp`);
    const e = npc.errand || null;
    const errandLines = e ? [e.ask, e.accept, e.report, ...e.offer, ...e.waiting, ...e.done] : [];
    if (e) {
      assert.match(e.id, /^[a-z][a-z0-9-]{0,39}$/);
      assert.ok(e.steps.length >= 1 && e.steps.every((s) => ['visit', 'cook', 'give'].includes(s.kind) && s.text), `${where}: errand steps`);
      assert.ok(npc.memories[e.remember], `${where}: the errand is remembered`);
      assert.ok(e.keepsake.name && e.keepsake.text && e.approval >= 1, `${where}: the errand ends in a kindness`);
    }
    const strings = [...npc.meet, ...npc.tired, ...npc.finished, ...Object.values(npc.hello).flat(), ...campLines, ...errandLines, ...Object.values(npc.memories),
      ...npc.topics.flatMap((t) => [...t.say, ...t.options.flatMap((o) => [o.text, ...o.reply])]), ...npc.examine];
    for (const text of strings) {
      assert.ok(!text.includes('!') && !text.includes("'") && !/\bplease\b/i.test(text), `${where}: calm copy: ${text}`);
      assert.ok(text.length <= 220, `${where}: short enough: ${text}`);
    }
    // People only speak: no stage directions, no narration in what they say.
    const spoken = [...npc.meet, ...npc.tired, ...npc.finished, ...Object.values(npc.hello).flat(), ...campLines, ...errandLines,
      ...npc.topics.flatMap((t) => [...t.say, ...t.options.flatMap((o) => o.reply)])];
    for (const text of spoken) {
      assert.ok(!/^(?:He|She|They)\s+(?:is|does|doesn’t|looks|takes|sets|writes|considers|stares|nods|opens|closes|lets|turns|rearranges|says|goes|has|smiles|laughs|pauses)\b/.test(text), `${where}: that is narration, not speech: ${text}`);
      assert.ok(!/^(?:A pause|Silence|\()/i.test(text) && !/\b(?:several seconds|for some time|for a moment)\b/i.test(text), `${where}: that is a stage direction: ${text}`);
    }
    // Plain speech: no ellipses, dashes, semicolons or similes anywhere in what they say or what is said of them,
    // and never the "it's not X, it's Y" turn in their mouths.
    for (const text of [...spoken, ...npc.examine, ...Object.values(npc.memories), npc.title]) {
      assert.ok(!/…|\.\.\.|—|–|;/.test(text), `${where}: no ellipses, dashes or semicolons: ${text}`);
      assert.ok(!/\b(?:as if|as though|like an?)\b/i.test(text), `${where}: no similes: ${text}`);
    }
    for (const text of spoken) {
      assert.ok(!/\b(?:isn’t|is not|aren’t|are not|not)\b[^.?!]{0,60}[.,]\s*(?:it’s|it is|that’s|that is|they’re|they are)\b/i.test(text), `${where}: no "it’s not X, it’s Y": ${text}`);
    }
    assertCalm(npc.camp.role, `${where}.role`, { proper: ['Gorrin', 'Wendell', 'Jonas', 'Mags'] });
  }
});

test('levels follow the threshold: wary below 0, warm at half, fond at the threshold, devoted at twice', () => {
  const p = wendell(); // threshold 5
  assert.deepEqual([-1, 0, 2, 3, 4, 5, 9, 10].map((n) => levelOf(p, n)), ['wary', 'neutral', 'neutral', 'warm', 'warm', 'fond', 'fond', 'devoted']);
});

test('an approach is read, never rolled: a liked one earns, a disliked one costs, a resisted one does nothing', () => {
  const p = wendell();
  let r = choose(fresh(), p, 'plaque', indexOf(p, 'plaque', 'truth'), T0);
  assert.deepEqual([r.ok, r.delta], [true, 2]);
  assert.deepEqual(r.state.people.wendell.found.likes, ['truth']);
  assert.deepEqual(r.notes.map((n) => n.kind), ['approves', 'remembers']);
  r = choose(fresh(), p, 'plaque', indexOf(p, 'plaque', 'joke'), T0);
  assert.equal(r.delta, -1);
  assert.deepEqual(r.state.people.wendell.found.dislikes, ['joke']);
  assert.equal(r.notes[0].kind, 'frowns');
  r = choose(fresh(), p, 'middle', indexOf(p, 'middle', 'favour'), T0);
  assert.equal(r.delta, 0);
  assert.deepEqual(r.state.people.wendell.found.resists, ['favour']);
  assert.equal(r.notes[0].text, 'That doesn’t work on Wendell.');
  // the same words land the same way every time
  const again = choose(fresh(), p, 'plaque', indexOf(p, 'plaque', 'truth'), T0);
  assert.deepEqual(again.state.people.wendell, choose(fresh(), p, 'plaque', indexOf(p, 'plaque', 'truth'), T0).state.people.wendell);
});

test('approval never goes below its floor', () => {
  const p = wendell();
  let state = fresh();
  state = { ...state, people: { wendell: { ...cleanPeople({ wendell: { points: -2 } }).wendell } } };
  const r = choose(state, p, 'plaque', indexOf(p, 'plaque', 'joke'), T0);
  assert.equal(r.state.people.wendell.points, FLOOR);
});

test('the same approach twice in a row is worth a point less, and a day allows three subjects', () => {
  const p = wendell();
  let state = choose(fresh(), p, 'plaque', indexOf(p, 'plaque', 'truth'), T0).state; // +2
  let r = choose(state, p, 'middle', indexOf(p, 'middle', 'truth'), T0 + 1000);       // truth again: +1
  assert.equal(r.delta, 1);
  state = r.state;
  r = choose(state, p, 'string', indexOf(p, 'string', 'craft'), T0 + 2000);           // craft: +1
  assert.equal(r.delta, 1);
  state = r.state;
  assert.equal(state.people.wendell.turn.n, DAY_TURNS);
  const view = personView(state, p, T0 + 3000);
  assert.equal(view.topic, null);
  assert.deepEqual(view.tired, p.tired);
  assert.equal(choose(state, p, 'apology', 0, T0 + 3000).ok, false, 'no fourth subject today');
  const tomorrow = personView(state, p, T0 + DAY);
  assert.equal(tomorrow.topic?.id, 'apology');
});

test('a subject is raised once, and only when approval reaches it', () => {
  const p = wendell();
  let state = fresh();
  assert.equal(nextTopic(p, state, T0).id, 'plaque');
  state = choose(state, p, 'plaque', indexOf(p, 'plaque', 'joke'), T0).state; // -1
  assert.equal(nextTopic(p, state, T0 + DAY), null, 'the next subject needs approval 1');
  assert.deepEqual(personView(state, p, T0 + DAY).finished, p.finished);
  assert.equal(choose(state, p, 'plaque', 0, T0 + DAY).ok, false, 'it was done');
});

test('"will remember that" keeps a real entry the journal can read, once', () => {
  const p = wendell();
  const r = choose(fresh(), p, 'plaque', indexOf(p, 'plaque', 'truth'), T0);
  assert.deepEqual(r.state.people.wendell.memories.map((m) => m.id), ['said-it-aloud']);
  const view = personView(r.state, p, T0);
  assert.deepEqual(view.memories.map((m) => m.text), [p.memories['said-it-aloud']]);
  assert.equal(r.notes.at(-1).text, 'Wendell will remember that.');
});

test('Come to camp: not until they are Fond, not without a bed, and then they live there', () => {
  const p = wendell();
  let state = fresh();
  let r = inviteToCamp(state, p, T0, { beds: 2 });
  assert.deepEqual([r.ok, r.why, r.lines], [false, 'early', p.camp.early]);
  state = { ...state, people: cleanPeople({ wendell: { points: 5, seen: T0 } }) };
  assert.equal(personView(state, p, T0).camp.state, 'ask');
  r = inviteToCamp(state, p, T0, { beds: 0 });
  assert.deepEqual([r.ok, r.why], [false, 'full']);
  r = inviteToCamp(state, p, T0, { beds: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, p.camp.yes);
  assert.equal(residentsOf(r.state), 1);
  assert.deepEqual(residents(r.state, content).map((x) => x.id), ['wendell']);
  assert.deepEqual(standing(r.state, content).map((x) => x.id).sort(), ['gorrin', 'jonas'], 'a resident no longer stands in the road');
  assert.equal(personView(r.state, p, T0).camp.state, 'in');
  const home = sendHome(r.state, p, T0 + DAY);
  assert.equal(residentsOf(home), 0);
  assert.equal(standing(home, content).length, 3);
});

test('beds grow with the Hearth', () => {
  assert.deepEqual([bedsFor(1), bedsFor(2), bedsFor(8), bedsFor(99)], [BEDS[0], BEDS[1], BEDS[7], BEDS[7]]);
});

test('approval below Warm fades a point a week if you never come back; Warm and camp residents stay', () => {
  const p = wendell(); // warm at 3
  const e = (points, extra = {}) => cleanPeople({ wendell: { points, seen: T0, ...extra } }).wendell;
  assert.equal(pointsNow(p, e(2), T0 + 8 * DAY), 1);
  assert.equal(pointsNow(p, e(2), T0 + 30 * DAY), 0, 'never below Neutral');
  assert.equal(pointsNow(p, e(3), T0 + 60 * DAY), 3, 'Warm stays');
  assert.equal(pointsNow(p, e(1, { camp: T0 }), T0 + 60 * DAY), 1, 'at camp, nothing fades');
});

test('the first meeting is remembered and says who they are', () => {
  const p = wendell();
  const view = personView(fresh(), p, T0);
  assert.equal(view.met, false);
  assert.deepEqual(view.greeting, p.meet);
  const met = meet(fresh(), p, T0);
  assert.equal(personView(met, p, T0).met, true);
  assert.deepEqual(personView(met, p, T0).greeting, p.hello.neutral);
});

test('the saved people repair to something valid and keep to their limits', () => {
  for (const junk of [null, 5, 'x', [], { wendell: 'no' }, { 'BAD ID': { points: 3 } }, { wendell: { points: 'many', done: 'x', memories: [{ id: 'BAD!' }] } }]) {
    const out = cleanPeople(junk, { now: T0 });
    assert.ok(Object.values(out).every((e) => Number.isInteger(e.points) && e.points >= -2));
  }
  const big = cleanPeople(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`p-${i}`, { points: 1, seen: i + 1 }])), { now: T0 });
  assert.equal(Object.keys(big).length, PEOPLE_LIMITS.people);
  const odd = cleanPeople({ wendell: { points: 9999, turn: { day: 'x', n: 99, last: 'bogus' }, found: { likes: ['truth', 'bogus'] } } }, { now: T0 }).wendell;
  assert.deepEqual([odd.points, odd.turn.last, odd.found.likes], [PEOPLE_LIMITS.points, null, ['truth']]);
  assert.equal(normalizeState(JSON.parse(JSON.stringify({ ...fresh(), people: { wendell: { points: 3, seen: T0 } } })), T0).people.wendell.points, 3);
});

test('a person can be drawn as Milo in other colours', () => {
  const p = wendell();
  assert.equal(registerLook('coat', p.id, p.dye), true);
  assert.equal(registerLook('coat', 'milo', p.dye), false, 'a rig keeps the people it already has');
  const look = { kind: 'rig', rig: 'coat', who: p.id, likeness: null };
  const down = exploreFrames(look, 'down');
  assert.ok(down.length >= 1);
  const milo = exploreFrames({ kind: 'rig', rig: 'coat', who: 'milo', likeness: null }, 'down');
  assert.notDeepEqual(down[0].rows, milo[0].rows, 'not Milo’s colours');
  assert.equal(down[0].rows.length, milo[0].rows.length);
  assert.ok(clipFrames(look, 'ready', 'down').length > 0, 'a portrait pose exists');
});
