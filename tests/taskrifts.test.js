// Phase 5.3: the Board's own rifts (Gothic, Iron, Void, Frontier), found from the quests alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createRiftgen } from '../src/world/riftgen.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createState } from '../src/model.js';
import { deriveSignals, buildRealRifts, reconcileRifts } from '../src/rifts.js';
import {
  addQuest, setStatus, finishQuest, letGo, updateQuest, keepQuest, boardOf, taskFacts, isVague, dueFrom, dueWords, TASK_RIFTS,
} from '../src/quests.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const riftgen = createRiftgen({ words: readJson('riftgen.json'), genres: readJson('genres.json') });
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: readJson('riftgen.json').regionWords });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime(); // Monday 5 October 2026, noon
const fresh = () => createState(T0);
const add = (state, title, now = T0) => addQuest(state, title, now);
const kinds = (state, now) => deriveSignals({ state, now }).filter((s) => ['stale', 'crowded', 'vague', 'due'].includes(s.kind));
const keyed = (state, now) => Object.fromEntries(kinds(state, now).map((s) => [s.kind, s]));

function withDoing(state, count, now) {
  let s = state;
  for (let i = 0; i < count; i += 1) {
    const r = add(s, `Task number ${i}`, now);
    s = setStatus(r.state, r.quest.id, 'doing', now);
  }
  return s;
}

test('an empty or healthy board opens no task rifts', () => {
  assert.deepEqual(kinds(fresh(), T0), []);
  const { state } = add(fresh(), 'Order groceries');
  assert.deepEqual(kinds(state, T0 + DAY), []);
});

test('Gothic: quests that have waited a while open one rift, and no cause names a quest', () => {
  let { state } = add(fresh(), 'Call the bank');
  state = add(state, 'Sort the garage').state;
  assert.deepEqual(kinds(state, T0 + 13 * DAY), []);
  const sig = keyed(state, T0 + 15 * DAY).stale;
  assert.equal(sig.key, 'stale:board');
  assert.deepEqual(sig.signals, ['task-stale']);
  assert.match(sig.cause, /^2 quests have waited a while\.$/);
  assert.doesNotMatch(JSON.stringify(sig), /bank|garage/i);
});

test('Iron: more than five quests in progress for a day', () => {
  const state = withDoing(fresh(), 6, T0);
  assert.deepEqual(kinds(state, T0 + 2 * HOUR), [], 'not yet: a day has not passed');
  const sig = keyed(state, T0 + 25 * HOUR).crowded;
  assert.equal(sig.key, 'crowded:board');
  assert.deepEqual(sig.signals, ['too-much-in-progress']);
  assert.equal(keyed(withDoing(fresh(), 5, T0), T0 + 25 * HOUR).crowded, undefined, 'five is fine');
});

test('Void: a vague quest three days old, until it has a step or a note', () => {
  assert.equal(isVague(boardOf(add(fresh(), 'Sort my stuff out').state).quests[0]), true);
  assert.equal(isVague(boardOf(add(fresh(), 'Order groceries').state).quests[0]), false);
  const { state, quest } = add(fresh(), 'Sort my stuff out');
  assert.equal(keyed(state, T0 + 2 * DAY).vague, undefined);
  const sig = keyed(state, T0 + 4 * DAY).vague;
  assert.deepEqual([sig.key, sig.signals], ['vague:board', ['task-too-vague']]);
  const noted = updateQuest(state, quest.id, { notes: 'Start with the desk.' });
  assert.equal(keyed(noted, T0 + 4 * DAY).vague, undefined);
});

test('Frontier: a deadline within two days opens a rift once the quest has been on the board a day', () => {
  const { state, quest } = add(fresh(), 'Hand in the form by Wednesday');
  assert.equal(quest.due, dueFrom('by Wednesday', T0));
  assert.equal(keyed(state, T0 + 2 * HOUR).due, undefined, 'a quest added just now never opens one');
  const soon = keyed(state, T0 + 25 * HOUR).due;
  assert.deepEqual([soon.key, soon.signals], ['due:board', ['deadline-near']]);
  const today = keyed(state, T0 + 2 * DAY + 2 * HOUR).due;
  assert.deepEqual(today.signals, ['deadline-today']);
  const late = keyed(state, T0 + 3 * DAY).due;
  assert.deepEqual(late.signals, ['deadline-today', 'overdue']);
  assert.equal(late.cause, 'A quest is overdue.');
  assert.ok(late.urgency > today.urgency && today.urgency > soon.urgency);
});

test('due dates are read from the words, and Chris can set or clear them', () => {
  assert.equal(dueFrom('Pay rent tomorrow', T0), new Date(2026, 9, 6, 23, 59, 59, 999).getTime());
  assert.equal(dueFrom('Hand in essay by Friday', T0), new Date(2026, 9, 9, 23, 59, 59, 999).getTime());
  assert.equal(dueFrom('Dentist on 10/20', T0), new Date(2026, 9, 20, 23, 59, 59, 999).getTime());
  assert.equal(dueFrom('Party Oct 31', T0), new Date(2026, 9, 31, 23, 59, 59, 999).getTime());
  assert.equal(dueFrom('Friday movie night', T0), null, 'a bare weekday is not a deadline');
  assert.equal(dueFrom('Tidy up, no rush tomorrow', T0), null);
  const { state, quest } = add(fresh(), 'Pay rent tomorrow');
  const cleared = updateQuest(state, quest.id, { due: null });
  assert.equal(boardOf(cleared).quests[0].due, null);
  const retitled = updateQuest(cleared, quest.id, { title: 'Pay rent today' }, T0);
  assert.equal(boardOf(retitled).quests[0].due, null, 'a date Chris chose stays chosen');
  assert.equal(dueWords(new Date(2026, 9, 5, 23).getTime(), T0), 'Due today');
  assert.equal(dueWords(new Date(2026, 9, 6, 23).getTime(), T0), 'Due tomorrow');
  assert.equal(dueWords(new Date(2026, 9, 4, 23).getTime(), T0), 'Overdue');
  assert.equal(dueWords(new Date(2026, 9, 9, 23).getTime(), T0), 'Due Friday');
  assert.equal(dueWords(new Date(2026, 9, 20, 23).getTime(), T0), 'Due Oct 20');
});

test('each task rift is made in its own genre', () => {
  let state = add(fresh(), 'Call the bank').state;
  state = add(state, 'Sort my stuff out').state;
  state = add(state, 'Hand in the form by Wednesday').state;
  state = withDoing(state, 6, T0);
  const now = T0 + 16 * DAY;
  const signals = kinds(state, now);
  assert.equal(signals.length, 4);
  const rifts = buildRealRifts({ signals, state, now, riftgen, worldgen });
  assert.equal(rifts.length, 4);
  const genreOf = Object.fromEntries(rifts.map((r) => [r.realKind, r.spec.genres[0]]));
  assert.deepEqual(genreOf, { stale: 'gothic', crowded: 'iron', vague: 'void', due: genreOf.due });
  assert.ok(['frontier', 'gothic'].includes(genreOf.due), `overdue and due now: ${genreOf.due}`);
  for (const r of rifts) assert.equal(r.echo.place, 'townhall');
});

test('a task rift seals once when the trouble is mended, and only once', () => {
  let { state } = add(fresh(), 'Call the bank');
  const now = T0 + 15 * DAY;
  const open = (s, t) => buildRealRifts({ signals: deriveSignals({ state: s, now: t }), state: s, now: t, riftgen, worldgen });
  let step = reconcileRifts(state, open(state, now), now);
  state = step.state;
  assert.equal(step.opened.length, 1);
  assert.equal(step.opened[0].realKind, 'stale');
  assert.ok(state.rifts.open['stale:board']);
  // the same trouble a little later is the same episode: nothing new
  step = reconcileRifts(state, open(state, now + HOUR), now + HOUR);
  assert.equal(step.opened.length, 0);
  assert.equal(step.state.rifts.open['stale:board'].since, state.rifts.open['stale:board'].since);
  // Keep it, and the rift seals
  const kept = keepQuest(boardOf(state).quests.length ? state : state, boardOf(state).quests[0].id, now + 2 * HOUR);
  step = reconcileRifts(kept, open(kept, now + 2 * HOUR), now + 2 * HOUR);
  assert.equal(step.sealed.length, 1);
  assert.equal(step.state.rifts.stitched.real, 1);
  assert.equal(step.state.rifts.open['stale:board'], undefined);
  // and when the same board goes stale again later, it is a new episode
  const later = now + 40 * DAY;
  const again = reconcileRifts(step.state, open(step.state, later), later);
  assert.equal(again.opened.length, 1);
});

test('the same trouble is one rift however many quests it is about', () => {
  let state = fresh();
  for (let i = 0; i < 6; i += 1) state = add(state, `Old chore ${i}`).state;
  assert.equal(kinds(state, T0 + 20 * DAY).filter((s) => s.kind === 'stale').length, 1);
  let one = state;
  for (const q of boardOf(state).quests.slice(0, 5)) one = letGo(one, q.id, T0 + 20 * DAY);
  const sig = keyed(one, T0 + 21 * DAY).stale;
  assert.equal(sig.cause, 'A quest has waited a while.');
});

test('finishing the quest that was due seals the Frontier rift and pays the quest as usual', () => {
  const { state, quest } = add(fresh(), 'Hand in the form by Wednesday');
  const now = T0 + 2 * DAY;
  assert.ok(keyed(state, now).due);
  const done = finishQuest(state, quest.id, now).state;
  assert.equal(keyed(done, now).due, undefined);
  assert.deepEqual(taskFacts(done, now).due, []);
});

test('the numbers the rifts rest on', () => {
  assert.deepEqual({ ...TASK_RIFTS }, { crowdedHours: 24, vagueDays: 3, dueDays: 2, settleHours: 24 });
});
