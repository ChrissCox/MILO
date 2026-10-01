import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addQuest, updateQuest, setStatus, finishQuest, deleteQuest, classifyQuest, skillFor, addStep, toggleStep, removeStep,
  addProject, completeProject, deleteProject, addThought, thoughtToQuest, boardView, boardOf, projectProgress, QUEST_PAY,
  letGo, bringBack, keepQuest, staleQuests, nudgeView, shouldNudge, markNudged, NUDGE,
} from '../src/quests.js';
import { cleanBoard, emptyBoard, BOARD_LIMITS } from '../src/state5.js';
import { createState, normalizeState } from '../src/model.js';

const NOW = Date.parse('2026-10-02T10:00:00');
const fresh = () => createState(NOW);
const add = (state, title, now = NOW) => addQuest(state, title, now);

test('a fresh state has an empty board, and the board survives normalizing', () => {
  assert.deepEqual(fresh().board, emptyBoard());
  const { state, quest } = add(fresh(), 'Order groceries');
  const again = normalizeState(JSON.parse(JSON.stringify(state)), NOW);
  assert.equal(again.board.quests.length, 1);
  assert.equal(again.board.quests[0].title, quest.title);
});

test('the classifier sorts like Habitack did', () => {
  assert.equal(classifyQuest('Order groceries').kind, 'main');
  assert.equal(classifyQuest('Buy a birthday present for mom').kind, 'main');
  assert.equal(classifyQuest('Hand in the form by Friday').kind, 'main');
  assert.equal(classifyQuest('Finish my drawing').kind, 'side');
  assert.equal(classifyQuest('Paint a doctor').kind, 'side');
  assert.equal(classifyQuest('Call someone, no rush').kind, 'side');
  assert.equal(classifyQuest('urgent: pay rent').kind, 'main');
});

test('a task is tagged with the life skill it trains', () => {
  assert.equal(skillFor('Cook dinner for Sam'), 'cooking');
  assert.equal(skillFor('Water the plants and weed the bed'), 'gardening');
  assert.equal(skillFor('Finish my drawing'), 'illumination');
  assert.equal(skillFor('Study for the anatomy exam'), 'scholarship');
  assert.equal(skillFor('Debug the login app'), 'artifice');
  assert.equal(skillFor('Take out the bins'), 'stewardship');
});

test('one-prompt capture adds a sorted, tagged quest and ignores empty words', () => {
  const { state, quest } = add(fresh(), '  Order   groceries  ');
  assert.equal(quest.title, 'Order groceries');
  assert.deepEqual([quest.kind, quest.status, quest.skill, quest.manual], ['main', 'todo', 'cooking', false]);
  assert.equal(add(state, '   ').quest, null);
  assert.equal(add(state, '   ').state, state);
  assert.equal(add(fresh(), 'x'.repeat(500)).quest.title.length, BOARD_LIMITS.title);
});

test('ids are never reused after a delete', () => {
  let { state, quest } = add(fresh(), 'One');
  const first = quest.id;
  state = deleteQuest(state, first);
  const second = add(state, 'Two').quest.id;
  assert.notEqual(first, second);
});

test('a correction sticks: a chosen priority survives a retitle', () => {
  let { state, quest } = add(fresh(), 'Finish my drawing');
  assert.equal(quest.kind, 'side');
  state = updateQuest(state, quest.id, { kind: 'main' });
  assert.equal(boardOf(state).quests[0].manual, true);
  state = updateQuest(state, quest.id, { title: 'Finish my painting' });
  assert.equal(boardOf(state).quests[0].kind, 'main');
  const auto = add(fresh(), 'Finish my drawing');
  const retitled = updateQuest(auto.state, auto.quest.id, { title: 'Pay the rent today' });
  assert.equal(boardOf(retitled).quests[0].kind, 'main');
});

test('finishing a quest pays Embers and XP once, even if it is reopened and finished again', () => {
  const { state: start, quest } = add(fresh(), 'Order groceries');
  let r = finishQuest(start, quest.id, NOW + 1000);
  assert.deepEqual([r.paid.embers, r.paid.skill], [QUEST_PAY.main, 'cooking']);
  assert.ok(r.paid.xp > 0);
  let state = r.state;
  assert.equal(state.embers.lifetime, QUEST_PAY.main);
  assert.ok(state.xp.skills.cooking > 0);
  assert.equal(boardOf(state).quests[0].status, 'done');
  state = setStatus(state, quest.id, 'todo', NOW + 2000);
  r = finishQuest(state, quest.id, NOW + 3000);
  assert.equal(r.paid, null);
  assert.equal(r.state.embers.lifetime, QUEST_PAY.main);
});

test('the ledger never holds a quest title', () => {
  const { state, quest } = add(fresh(), 'Surprise party for Dana');
  const done = finishQuest(state, quest.id, NOW + 1).state;
  assert.doesNotMatch(JSON.stringify([done.embers, done.chronicle, done.xp]), /Dana/);
});

test('past twelve quests in a day each pays a quarter', () => {
  let state = fresh();
  const pays = [];
  for (let i = 0; i < 14; i += 1) {
    const added = add(state, `Order groceries ${i}`, NOW + i * 10);
    const r = finishQuest(added.state, added.quest.id, NOW + i * 10 + 5);
    state = r.state;
    pays.push(r.paid.embers);
  }
  assert.deepEqual(pays.slice(0, 12), Array(12).fill(QUEST_PAY.main));
  assert.deepEqual(pays.slice(12), [1, 1]);
});

test('steps are a checklist that never finishes the quest or pays', () => {
  const { state: start, quest } = add(fresh(), 'Plan the trip');
  let state = addStep(start, quest.id, 'Book the train');
  state = addStep(state, quest.id, 'Pack');
  const [a] = boardOf(state).quests[0].steps;
  state = toggleStep(state, quest.id, a.id);
  const q = boardOf(state).quests[0];
  assert.deepEqual([q.steps[0].done, q.steps[1].done, q.status], [true, false, 'todo']);
  assert.equal(state.embers.lifetime, 0);
  state = removeStep(state, quest.id, a.id);
  assert.equal(boardOf(state).quests[0].steps.length, 1);
  assert.equal(addStep(state, quest.id, '  '), state);
});

test('a project files "Name: task" quests, finishes only when they are all done, and keeps quests when removed', () => {
  let state = addProject(fresh(), 'Garden', NOW);
  const projectId = boardOf(state).projects[0].id;
  const r = add(state, 'Garden: buy soil');
  assert.equal(r.quest.projectId, projectId);
  assert.equal(r.quest.title, 'buy soil');
  state = r.state;
  assert.equal(completeProject(state, projectId, NOW), state);
  state = finishQuest(state, r.quest.id, NOW + 10).state;
  assert.deepEqual(projectProgress(state, projectId), { total: 1, done: 1, ready: true });
  state = completeProject(state, projectId, NOW + 20);
  assert.equal(boardOf(state).projects[0].status, 'complete');
  state = deleteProject(state, projectId);
  assert.equal(boardOf(state).quests[0].projectId, null);
});

test('a pocket thought becomes a quest with its words kept as notes', () => {
  const state = addThought(fresh(), 'Call the plumber\nabout the tap', NOW);
  const id = boardOf(state).thoughts[0].id;
  const r = thoughtToQuest(state, id, NOW + 1);
  assert.equal(r.quest.title, 'Call the plumber');
  assert.match(r.quest.notes, /about the tap/);
  assert.equal(boardOf(r.state).thoughts.length, 0);
});

test('the board view groups quests, main first', () => {
  let state = fresh();
  state = add(state, 'Finish my drawing', NOW).state;
  state = add(state, 'Order groceries', NOW + 1).state;
  const doing = add(state, 'Write the report', NOW + 2);
  state = setStatus(doing.state, doing.quest.id, 'doing', NOW + 3);
  const view = boardView(state);
  assert.deepEqual(view.todo.map((q) => q.title), ['Order groceries', 'Finish my drawing']);
  assert.deepEqual(view.doing.map((q) => q.title), ['Write the report']);
  assert.equal(view.counts.open, 3);
});

test('the cleaner repairs anything and keeps to its limits', () => {
  for (const junk of [null, 7, 'x', [], { quests: 'no' }, { quests: [null, 3, { title: '' }, { title: 'ok', status: 'bogus', kind: 'huge' }] }]) {
    assert.ok(Array.isArray(cleanBoard(junk, { now: NOW }).quests));
  }
  const many = cleanBoard({ quests: Array.from({ length: 500 }, (_, i) => ({ id: 'q-1', title: `Quest ${i}` })) }, { now: NOW });
  assert.equal(many.quests.length, BOARD_LIMITS.quests);
  assert.equal(new Set(many.quests.map((q) => q.id)).size, BOARD_LIMITS.quests, 'ids are made unique');
  const odd = cleanBoard({ quests: [{ title: 'ok', status: 'bogus', kind: 'huge', skill: 'nope', projectId: 'p-9' }] }, { now: NOW }).quests[0];
  assert.deepEqual([odd.status, odd.kind, odd.skill, odd.projectId], ['todo', 'side', 'stewardship', null]);
  assert.equal(cleanBoard(JSON.parse('{"__proto__":{"x":1},"quests":[]}')).x, undefined);
});

const DAY = 24 * 60 * 60 * 1000;

test('letting a quest go is gentle: it leaves the board, pays nothing, and can come back', () => {
  const { state: start, quest } = add(fresh(), 'Sort the garage');
  let state = letGo(start, quest.id, NOW + 1000);
  assert.equal(boardOf(state).quests[0].status, 'let-go');
  assert.equal(state.embers.lifetime, 0);
  const view = boardView(state);
  assert.deepEqual([view.todo.length, view.letGoCount, view.counts.open], [0, 1, 0]);
  state = bringBack(state, quest.id, NOW + 2000);
  assert.equal(boardOf(state).quests[0].status, 'todo');
  assert.equal(boardView(state).counts.open, 1);
});

test('a quest that has waited a while is nudged, and Keep starts its clock again', () => {
  const { state, quest } = add(fresh(), 'Call the bank');
  assert.deepEqual(staleQuests(state, NOW + 13 * DAY), []);
  assert.equal(staleQuests(state, NOW + 14 * DAY).length, 1);
  assert.deepEqual(nudgeView(state, NOW + 14 * DAY).stale, [quest.id]);
  const kept = keepQuest(state, quest.id, NOW + 14 * DAY);
  assert.deepEqual(staleQuests(kept, NOW + 20 * DAY), []);
  assert.equal(staleQuests(kept, NOW + 28 * DAY).length, 1);
});

test('a quest in progress waits a week; done and let-go quests never nudge', () => {
  const a = add(fresh(), 'Write the report');
  let state = setStatus(a.state, a.quest.id, 'doing', NOW);
  assert.equal(staleQuests(state, NOW + 6 * DAY).length, 0);
  assert.equal(staleQuests(state, NOW + NUDGE.doingDays * DAY).length, 1);
  assert.equal(staleQuests(letGo(state, a.quest.id, NOW + DAY), NOW + 90 * DAY).length, 0);
  state = finishQuest(state, a.quest.id, NOW + DAY).state;
  assert.equal(staleQuests(state, NOW + 90 * DAY).length, 0);
});

test('too much in progress at once is noticed', () => {
  let state = fresh();
  for (let i = 0; i < 6; i += 1) {
    const r = add(state, `Task ${i}`, NOW + i);
    state = setStatus(r.state, r.quest.id, 'doing', NOW + i);
  }
  assert.equal(nudgeView(state, NOW + 10).crowded, true);
  assert.equal(nudgeView(fresh(), NOW).crowded, false);
});

test('Milo says it once a day at most', () => {
  const { state } = add(fresh(), 'Call the bank');
  const later = NOW + 15 * DAY;
  assert.equal(shouldNudge(state, later), true);
  const said = markNudged(state, later);
  assert.equal(shouldNudge(said, later + 1000), false);
  assert.equal(shouldNudge(said, later + DAY), true);
  assert.equal(shouldNudge(fresh(), later), false, 'nothing is stale on an empty board');
  assert.equal(normalizeState(JSON.parse(JSON.stringify(said)), later).board.nudgedDay, boardOf(said).nudgedDay);
});
