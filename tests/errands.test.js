// Phase 5.5: errands for people, and Act I's chapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createState, normalizeState } from '../src/model.js';
import { cleanPeople } from '../src/state5.js';
import { personOf, personView, inviteToCamp, standing, levelOf } from '../src/people.js';
import { errandOf, errandView, startErrand, giveStep, errandEvent, finishErrand, errandList } from '../src/errands.js';
import { ACT1_CHAPTER_IDS, actOpen, actStatus, settleAct, chapterDone, SEEDS_QUESTS } from '../src/acts.js';
import { RECIPE_IDS } from '../src/camplife.js';
import { PLACES } from '../src/world/map.js';
import { GATES } from '../src/world/worldgen.js';

const dir = new URL('../content/people/npcs/', import.meta.url);
const npcs = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
  const file = JSON.parse(readFileSync(new URL(n, dir), 'utf8'));
  return [file.id, file];
}));
const content = { people: { npcs } };
const story = JSON.parse(readFileSync(new URL('../content/story.json', import.meta.url), 'utf8'));
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const fresh = () => createState(T0);
const person = (id) => personOf(content, id);
const warm = (state, id, points) => ({ ...state, people: { ...state.people, ...cleanPeople({ [id]: { points, met: T0, seen: T0 } }) } });
const withBirch = (state, n) => ({ ...state, satchel: { ...state.satchel, materials: { ...state.satchel.materials, birch: n } } });

test('every errand step names something real', () => {
  const places = new Set([...PLACES.map((p) => p.id), ...Object.keys(GATES), 'landmark:last-bridge']);
  for (const npc of Object.values(npcs)) {
    const errand = errandOf(npc);
    if (!errand) continue;
    for (const step of errand.steps) {
      if (step.kind === 'visit') assert.ok(places.has(step.target), `${npc.id}: ${step.target} is a place`);
      if (step.kind === 'cook') assert.ok(RECIPE_IDS.includes(step.target), `${npc.id}: ${step.target} is a recipe`);
      if (step.kind === 'give') assert.ok(Number.isInteger(step.n) && step.n > 0 && typeof step.item === 'string', `${npc.id}: a give step`);
    }
  }
});

test('an errand is offered only once they have warmed to you', () => {
  const p = person('wendell');
  assert.equal(errandView(fresh(), p, T0).state, 'hidden');
  assert.equal(errandView(warm(fresh(), 'wendell', 1), p, T0).state, 'hidden');
  assert.equal(levelOf(p, 3), 'warm');
  assert.equal(errandView(warm(fresh(), 'wendell', 3), p, T0).state, 'offer');
  const cool = warm(fresh(), 'wendell', 1);
  assert.equal(startErrand(cool, p, T0), cool, 'it can’t be taken on before it’s offered');
});

test('Wendell’s errand: stand at both ends, tell him, and he approves, remembers and gives a keepsake', () => {
  const p = person('wendell');
  let state = startErrand(warm(fresh(), 'wendell', 3), p, T0);
  assert.equal(errandView(state, p, T0).state, 'doing');
  assert.equal(finishErrand(state, p, T0).ok, false, 'not before it is done');
  state = errandEvent(state, content, { kind: 'visit', target: 'landmark:last-bridge' }, T0 + 1000);
  assert.deepEqual(errandView(state, p, T0).steps.map((s) => s.done), [true, false]);
  assert.equal(errandEvent(state, content, { kind: 'visit', target: 'gate:w' }, T0 + 1500), state, 'another place changes nothing');
  state = errandEvent(state, content, { kind: 'visit', target: 'townhall' }, T0 + 2000);
  assert.equal(errandView(state, p, T0).state, 'ready');
  const r = finishErrand(state, p, T0 + 3000);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, p.errand.done);
  assert.deepEqual(r.notes.map((n) => n.kind), ['approves', 'remembers', 'gift']);
  assert.equal(r.notes[2].text, 'Wendell gave you a length of string.');
  assert.equal(r.state.people.wendell.points, 5);
  assert.equal(r.levelled, true, 'two points take him from Warm to Fond');
  assert.ok(r.state.people.wendell.memories.some((m) => m.id === 'stood-at-both-ends'));
  assert.deepEqual(r.state.satchel.relics.map((x) => x.name), ['A length of string']);
  assert.equal(errandView(r.state, p, T0 + 4000).state, 'done');
  assert.equal(finishErrand(r.state, p, T0 + 5000).ok, false, 'it finishes once');
  assert.equal(startErrand(r.state, p, T0 + 5000), r.state, 'and is not offered again');
  const saved = normalizeState(JSON.parse(JSON.stringify(r.state)), T0 + 6000);
  assert.equal(errandView(saved, p, T0 + 6000).state, 'done', 'it survives a save');
});

test('Gorrin’s errand takes six birch out of the satchel, and not before there are six', () => {
  const p = person('gorrin');
  let state = startErrand(warm(withBirch(fresh(), 4), 'gorrin', 3), p, T0);
  const view = errandView(state, p, T0).steps[0];
  assert.deepEqual([view.kind, view.item, view.n, view.have], ['give', 'birch', 6, 4]);
  assert.deepEqual([giveStep(state, p, 0, T0).ok, giveStep(state, p, 0, T0).why], [false, 'Not enough yet']);
  state = withBirch(state, 9);
  const given = giveStep(state, p, 0, T0 + 1000);
  assert.equal(given.ok, true);
  assert.equal(given.state.satchel.materials.birch, 3);
  assert.equal(errandView(given.state, p, T0).state, 'ready');
  assert.equal(giveStep(given.state, p, 0, T0 + 2000).ok, false, 'given once');
  assert.equal(given.state.embers.lifetime, 0, 'an errand never pays Embers');
});

test('Jonas’s errand waits on a minnow supper at the fire', () => {
  const p = person('jonas');
  let state = startErrand(warm(fresh(), 'jonas', 3), p, T0);
  assert.equal(errandEvent(state, content, { kind: 'cook', target: 'cordial' }, T0 + 1), state);
  state = errandEvent(state, content, { kind: 'cook', target: 'minnow-supper' }, T0 + 2);
  assert.equal(errandView(state, p, T0).state, 'ready');
  assert.equal(finishErrand(state, p, T0 + 3).notes.at(-1).text, 'Jonas gave you the first spoon.');
});

test('an event before the errand is taken on does nothing', () => {
  const state = warm(fresh(), 'jonas', 3);
  assert.equal(errandEvent(state, content, { kind: 'cook', target: 'minnow-supper' }, T0), state);
});

test('the Board lists errands under way, the ones ready to report first', () => {
  let state = warm(warm(fresh(), 'wendell', 3), 'jonas', 3);
  assert.deepEqual(errandList(state, content, T0), []);
  state = startErrand(state, person('wendell'), T0);
  state = startErrand(state, person('jonas'), T0);
  state = errandEvent(state, content, { kind: 'cook', target: 'minnow-supper' }, T0 + 1);
  assert.deepEqual(errandList(state, content, T0).map((e) => [e.personId, e.state]), [['jonas', 'ready'], ['wendell', 'doing']]);
});

test('Mags will never come to camp, and says so kindly however fond she is', () => {
  const p = person('mags');
  const state = warm(fresh(), 'mags', 12);
  assert.equal(personView(state, p, T0).camp.state, 'never');
  const r = inviteToCamp(state, p, T0, { beds: 9 });
  assert.deepEqual([r.ok, r.why, r.lines], [false, 'never', p.camp.never]);
});

// ---------------------------------------------------------------------------
// Act I

const cracked = (state) => ({ ...state, story: { ...state.story, prologue: { done: { ...state.story.prologue.done, 'first-crack': T0 - 1000 } } } });

test('Act I opens when the Prologue’s crack is mended, and its words come from story.json', () => {
  assert.equal(actOpen(fresh()), false);
  assert.equal(actStatus(fresh(), story).open, false);
  assert.equal(actStatus(fresh(), story).current, null);
  const status = actStatus(cracked(fresh()), story);
  assert.equal(status.open, true);
  assert.equal(status.title, 'Act I: Hearthvale Rekindled');
  assert.deepEqual(status.chapters.map((c) => c.id), [...ACT1_CHAPTER_IDS]);
  assert.deepEqual(story.act1.chapters.map((c) => c.id), [...ACT1_CHAPTER_IDS]);
  assert.equal(status.current, 'first-rift');
  for (const c of status.chapters) assert.ok(c.title && c.text && c.hint, c.id);
  const closed = fresh();
  const settled = settleAct(closed, story, T0);
  assert.equal(settled.state, closed, 'nothing changes before it opens');
  assert.deepEqual(settled.completed, []);
});

test('chapters complete on real things, in any order, and stay done', () => {
  let state = cracked(fresh());
  // a real rift sealed
  state = { ...state, rifts: { ...state.rifts, stitched: { ...state.rifts.stitched, real: 1 } } };
  let r = settleAct(state, story, T0);
  assert.deepEqual(r.completed, ['first-rift']);
  assert.equal(chapterDone(r.state, 'first-rift'), true);
  assert.deepEqual(settleAct(r.state, story, T0 + 1).completed, [], 'settled once');
  state = { ...r.state, rifts: { ...r.state.rifts, stitched: { ...r.state.rifts.stitched, real: 0 } } };
  assert.equal(actStatus(state, story).chapters[0].done, true, 'it stays done');
  // the Tollkeeper, out of order
  state = { ...state, party: { ...state.party, roster: { ...state.party.roster, tollkeeper: {} } } };
  r = settleAct(state, story, T0 + 2);
  assert.deepEqual(r.completed, ['tollkeeper']);
  assert.equal(actStatus(r.state, story).current, 'laser-awl');
  // five flowers
  const q = (n) => ({ id: `q-${n}`, title: `Chore ${n}`, status: 'done' });
  state = { ...r.state, board: { ...r.state.board, quests: Array.from({ length: SEEDS_QUESTS }, (_, i) => q(i + 1)) } };
  assert.deepEqual(settleAct(state, story, T0 + 3).completed, ['nans-seeds']);
  const saved = normalizeState(JSON.parse(JSON.stringify(settleAct(state, story, T0 + 3).state)), T0 + 4);
  assert.deepEqual(Object.keys(saved.story.act1.done).sort(), ['first-rift', 'nans-seeds', 'tollkeeper']);
});

test('Mags arrives once the first rift is sealed, meeting her is a chapter, and someone at camp is another', () => {
  let state = cracked(fresh());
  assert.ok(!standing(state, content).some((p) => p.id === 'mags'));
  state = settleAct({ ...state, rifts: { ...state.rifts, stitched: { ...state.rifts.stitched, real: 1 } } }, story, T0).state;
  assert.ok(standing(state, content).some((p) => p.id === 'mags'), 'she is on the road');
  state = { ...state, people: cleanPeople({ mags: { met: T0 + 5, seen: T0 + 5 } }) };
  assert.deepEqual(settleAct(state, story, T0 + 6).completed, ['laser-awl']);
  state = { ...state, people: cleanPeople({ mags: { met: T0 + 5, seen: T0 + 5 }, wendell: { points: 5, met: T0, seen: T0, camp: T0 + 7 } }) };
  assert.deepEqual(settleAct(state, story, T0 + 8).completed.sort(), ['invitation', 'laser-awl']);
});

test('nothing in Act I settles before it opens', () => {
  const state = { ...fresh(), rifts: { ...fresh().rifts, stitched: { real: 3, wild: 0, story: 0 } } };
  assert.deepEqual(settleAct(state, story, T0).completed, []);
});
