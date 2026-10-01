// The Chronicle (src/chronicle.js): a day's totals, fights and XP lines, and the day and week views
// that read them with the Ember ledger. CONTRACT-PHASE4.md §7.6, §8.3; COMBAT.md §12, §13.
// Run: node --test tests/chronicle.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, normalizeState } from '../src/model.js';
import { note, noteFight, noteXp, dayView, weekView, DAY_COUNTS } from '../src/chronicle.js';
import { earn, spend, payFromSignals } from '../src/embers.js';
import { kindleStart, kindleTick } from '../src/kindle.js';
import { dayKey } from '../src/clean.js';
import { STATE4_LIMITS } from '../src/state4.js';

const economy = JSON.parse(readFileSync(new URL('../content/economy.json', import.meta.url), 'utf8'));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (m, d, h = 12, min = 0) => new Date(2026, m - 1, d, h, min, 0).getTime(); // local time, 2026
const NOW = at(9, 29, 14); // a Tuesday
const L = STATE4_LIMITS;
const fight = (i, over = {}) => ({ id: `fight:rift:abc${i}:w:r1`, at: NOW + i, where: 'A neon rift', outcome: 'won', rounds: 3, xp: 40, marks: 12, summary: 'Milo kept the lantern high.', ...over });

test('note adds to the day now falls on, and returns the same state when there’s nothing to add', () => {
  const state = createState(NOW);
  const noted = note(state, NOW, { embersIn: 10, focus: 1, xp: { focus: 1000 } });
  assert.deepEqual(noted.chronicle.days['2026-09-29'], { embersIn: 10, embersOut: 0, focus: 1, rests: 0, crew: 0, answered: 0, stitched: 0, fights: 0, xp: { focus: 1000 } });
  const twice = note(noted, NOW + HOUR, { embersIn: 5, rests: 1, xp: { focus: 1000, hearthkeeping: 400 } });
  assert.deepEqual(twice.chronicle.days['2026-09-29'], { embersIn: 15, embersOut: 0, focus: 1, rests: 1, crew: 0, answered: 0, stitched: 0, fights: 0, xp: { focus: 2000, hearthkeeping: 400 } });
  assert.equal(note(twice, NOW, {}), twice);
  assert.equal(note(twice, NOW, { embersIn: 0, xp: { focus: 0, telepathy: 9 } }), twice);
  assert.equal(note(twice, 'soon', { focus: 1 }), twice, 'no clock, no change');
  assert.equal(note(null, NOW, { focus: 1 }), null);
  assert.equal(state.chronicle.days['2026-09-29'], undefined, 'the state given is left alone');
  assert.deepEqual([...DAY_COUNTS], ['embersIn', 'embersOut', 'focus', 'rests', 'crew', 'answered', 'stitched', 'fights']);
});

test('a day keeps its six largest skills, and the Chronicle keeps 60 days', () => {
  let state = createState(NOW);
  const skills = ['focus', 'command', 'artifice', 'warding', 'cartography', 'wayfaring', 'woodcutting', 'seamcraft'];
  skills.forEach((skill, i) => { state = note(state, NOW, { xp: { [skill]: (i + 1) * 100 } }); });
  assert.deepEqual(Object.keys(state.chronicle.days['2026-09-29'].xp).sort(), ['artifice', 'cartography', 'seamcraft', 'warding', 'wayfaring', 'woodcutting']);
  for (let d = 1; d <= 70; d += 1) state = note(state, NOW - d * DAY, { focus: 1 });
  const days = Object.keys(state.chronicle.days).sort();
  assert.equal(days.length, L.days);
  assert.equal(days.at(-1), '2026-09-29');
  assert.equal(days[0], dayKey(NOW - 59 * DAY), 'the oldest days go');
  assert.deepEqual(normalizeState(state, NOW).chronicle, state.chronicle, 'the cleaner keeps what note kept');
});

test('noteFight writes a fight once, counts it on its day, and keeps the newest 50', () => {
  let state = createState(NOW);
  state = noteFight(state, NOW, fight(0));
  assert.deepEqual(state.chronicle.fights, [fight(0)]);
  assert.equal(state.chronicle.days['2026-09-29'].fights, 1);
  assert.equal(noteFight(state, NOW, fight(0)), state, 'the same summary twice is written once');
  const retried = noteFight(state, NOW, fight(0, { at: NOW + HOUR, outcome: 'offline' }));
  assert.equal(retried.chronicle.fights.length, 2, 'a Try again is its own fight in the Chronicle');
  const noAt = noteFight(state, NOW + 5, { ...fight(9), at: undefined });
  assert.equal(noAt.chronicle.fights.at(-1).at, NOW + 5, 'without an at, it’s now');
  for (const bad of [null, {}, fight(1, { id: 'nope' }), fight(1, { outcome: 'died' }), fight(1, { at: 'x' })]) assert.equal(noteFight(state, NOW, bad), state, JSON.stringify(bad));
  const long = noteFight(state, NOW, fight(2, { where: 'w'.repeat(99), summary: 's'.repeat(300) })).chronicle.fights.at(-1);
  assert.deepEqual([long.where.length, long.summary.length], [L.where, L.summary]);
  for (let i = 1; i <= 60; i += 1) state = noteFight(state, NOW, fight(i));
  assert.equal(state.chronicle.fights.length, L.fights);
  assert.equal(state.chronicle.fights.at(-1).id, fight(60).id, 'newest last');
});

test('noteXp writes an XP line at now, adds it to the day, and keeps the newest 120', () => {
  let state = createState(NOW);
  state = noteXp(state, NOW, { skill: 'focus', n: 1000, source: 'focus-session', text: 'Focus 1,000: focus session 09:10–10:00' });
  assert.deepEqual(state.chronicle.xpLines, [{ at: NOW, skill: 'focus', n: 1000, source: 'focus-session', text: 'Focus 1,000: focus session 09:10–10:00' }]);
  assert.equal(state.chronicle.days['2026-09-29'].xp.focus, 1000);
  for (const bad of [null, { skill: 'telepathy', n: 5 }, { skill: 'focus', n: 0 }, { skill: 'focus', n: -4 }]) assert.equal(noteXp(state, NOW, bad), state);
  for (let i = 0; i < 130; i += 1) state = noteXp(state, NOW + i, { skill: 'warding', n: 10, source: 'fight', text: 'Warding 10: a fight' });
  assert.equal(state.chronicle.xpLines.length, L.xpLines);
  assert.equal(state.chronicle.xpLines.at(-1).at, NOW + 129);
});

test('a session title in a fight or an XP line is shown for three days, then the Chronicle drops it', () => {
  const where = 'The rift over “Fix the login bug”';
  let state = noteFight(createState(NOW), NOW, fight(0, { at: NOW, where, summary: 'Rivet held the door for “Fix the login bug”.' }));
  state = noteXp(state, NOW, { skill: 'seamcraft', n: 500, source: 'real-stitch', text: 'Seamcraft 500: the rift over “Fix the login bug”' });
  assert.equal(dayView(state, NOW, { now: NOW }).fights[0].where, where, 'written with its title');
  assert.equal(state.chronicle.xpLines[0].text, 'Seamcraft 500: the rift over “Fix the login bug”');
  const later = normalizeState(JSON.parse(JSON.stringify(state)), NOW + 4 * DAY);
  const day = dayView(later, NOW, { now: NOW + 4 * DAY });
  assert.deepEqual([day.fights[0].where, day.fights[0].summary], ['The rift over a waiting session', 'Rivet held the door for a waiting session.']);
  assert.equal(day.xpLines[0].text, 'Seamcraft 500: the rift over a waiting session');
  const late = noteFight(createState(NOW + 4 * DAY), NOW + 4 * DAY, fight(1, { at: NOW, where }));
  assert.equal(late.chronicle.fights[0].where, 'The rift over a waiting session', 'a fight written down days later is written without it');
});

test('dayView lists the day’s totals, XP, ledger, XP lines and fights, newest first', () => {
  let state = payFromSignals(createState(NOW - DAY), NOW - DAY, economy).state;
  state = earn(state, { source: 'focus', key: `focus:${NOW - 2 * HOUR}`, n: 10, text: 'Focus session 12:00–12:50' }, NOW - HOUR, economy).state;
  state = spend(state, { n: 5, what: 'wild' }, NOW, economy).state;
  state = earn(state, { source: 'rest', key: `rest:${NOW - DAY}`, n: 5, text: 'Rest honoured' }, NOW - DAY, economy).state;
  state = noteXp(state, NOW - HOUR, { skill: 'focus', n: 1000, source: 'focus-session', text: 'Focus 1,000: focus session' });
  state = noteFight(state, NOW, fight(1));
  state = noteFight(state, NOW - DAY, fight(2, { at: NOW - DAY }));
  const view = dayView(state, '2026-09-29', { now: NOW });
  assert.equal(view.day, '2026-09-29');
  assert.deepEqual(view.totals, { embersIn: 10, embersOut: 5, focus: 0, rests: 0, crew: 0, answered: 0, stitched: 0, fights: 1 });
  assert.deepEqual(view.xp, [{ skill: 'focus', n: 1000 }]);
  assert.deepEqual(view.ledger.map((e) => [e.n, e.source]), [[-5, 'wild'], [10, 'focus']], 'every Ember with its source, newest first');
  assert.deepEqual(view.xpLines.map((l) => l.skill), ['focus']);
  assert.deepEqual(view.fights.map((f) => f.id), [fight(1).id]);
  assert.deepEqual(dayView(state, null, { now: NOW }), view, 'no day means today');
  assert.deepEqual(dayView(state, NOW + 3 * HOUR, { now: NOW }), view, 'a time means its day');
  const yesterday = dayView(state, '2026-09-28', { now: NOW });
  assert.deepEqual(yesterday.ledger.map((e) => e.source), ['rest']);
  assert.deepEqual(yesterday.fights.map((f) => f.id), [fight(2).id]);
  const empty = dayView(state, '2026-01-01', { now: NOW });
  assert.deepEqual([empty.totals.embersIn, empty.ledger, empty.xp], [0, [], []]);
  assert.equal(dayView(state, 'someday', {}).day, '', 'no day and no clock: an empty view, never Date.now');
  view.ledger[0].n = 999;
  assert.notEqual(state.embers.ledger.at(-2).n, 999, 'views are copies');
});

test('weekView runs Monday to Sunday with each day and the week’s totals', () => {
  let state = createState(NOW);
  state = note(state, at(9, 28, 9), { focus: 2, embersIn: 20, xp: { focus: 2000 } }); // Monday
  state = note(state, at(9, 29, 9), { focus: 1, embersIn: 10, embersOut: 5, fights: 2, xp: { focus: 1000, warding: 90 } });
  state = note(state, at(10, 4, 23, 30), { rests: 1, embersIn: 5 }); // Sunday night
  state = note(state, at(10, 5, 0, 30), { focus: 9 }); // the next Monday
  state = note(state, at(9, 27, 23), { focus: 9 }); // the Sunday before
  const week = weekView(state, '2026-10-01', { now: NOW });
  assert.equal(week.start, '2026-09-28');
  assert.deepEqual(week.days.map((d) => d.day), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepEqual(week.days[1], { day: '2026-09-29', embersIn: 10, embersOut: 5, focus: 1, fights: 2 });
  assert.deepEqual(week.totals, { embersIn: 35, embersOut: 5, focus: 3, rests: 1, crew: 0, answered: 0, stitched: 0, fights: 2 });
  assert.deepEqual(week.xp, [{ skill: 'focus', n: 3000 }, { skill: 'warding', n: 90 }]);
  assert.deepEqual(weekView(state, null, { now: NOW }), week, 'no day means this week');
  assert.equal(weekView(state, at(10, 4, 23, 59), { now: NOW }).start, '2026-09-28', 'a Sunday belongs to the week before it');
  // Weeks through both clock changes are always seven calendar days.
  for (const day of ['2026-03-09', '2026-03-29', '2026-10-26', '2026-11-02']) {
    const w = weekView(state, day, { now: NOW });
    assert.equal(w.days.length, 7, day);
    assert.equal(new Date(`${w.start}T12:00:00`).getDay(), 1, `${day} starts on a Monday`);
    assert.equal(new Set(w.days.map((d) => d.day)).size, 7);
  }
  assert.deepEqual(weekView(state, 'never', {}), { start: '', days: [], totals: { embersIn: 0, embersOut: 0, focus: 0, rests: 0, crew: 0, answered: 0, stitched: 0, fights: 0 }, xp: [] });
});

test('a Kindle cycle and a day of signals are all written down', () => {
  let state = payFromSignals(createState(NOW - DAY), NOW - DAY, economy).state;
  state = kindleTick(kindleStart(state, NOW, { economy }).state, NOW + 70 * MIN, { economy }).state;
  state = payFromSignals({ ...state, tally: { ...state.tally, sessionsFinished: 2, answered: 1 } }, NOW + 2 * HOUR, economy).state;
  const view = dayView(state, null, { now: NOW + 3 * HOUR });
  assert.deepEqual([view.totals.focus, view.totals.rests, view.totals.crew, view.totals.answered, view.totals.embersIn], [1, 1, 2, 1, 20]);
  assert.deepEqual(view.ledger.map((e) => e.source), ['answered', 'crew', 'rest', 'focus']);
  assert.deepEqual(view.xpLines.map((l) => l.skill), ['hearthkeeping', 'focus']);
});
