// Kindle and Banked Coals (src/kindle.js): the 50/15 focus timer on absolute times, paying each
// finished session and honoured rest once, however often it ticks and however often MILO relaunches.
// CONTRACT-PHASE4.md §4.20, §4.21, §4.23, §7.6, §13 (A's proofs), §15.
// Run: node --test tests/kindle.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createState, normalizeState } from '../src/model.js';
import { kindleStart, bankedCoals, kindleStop, kindleTick, kindleView, nextAlarm, FOCUS_MS, REST_MS } from '../src/kindle.js';
import { payFromSignals } from '../src/embers.js';
import { hearthStatus } from '../src/hearth.js';
import { assertCalm, assertCosy } from './calm.js';

const economy = JSON.parse(readFileSync(new URL('../content/economy.json', import.meta.url), 'utf8'));
const xp = JSON.parse(readFileSync(new URL('../content/xp.json', import.meta.url), 'utf8'));
const fortress = JSON.parse(readFileSync(new URL('../content/fortress.json', import.meta.url), 'utf8'));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = new Date(2026, 8, 29, 9, 10, 0).getTime(); // 09:10 local, 29 September 2026
const opts = { economy, xp };
const relaunch = (state, now) => normalizeState(JSON.parse(JSON.stringify(state)), now);
/** A state whose backlog is paid, with an empty wallet. */
function fresh() {
  const state = payFromSignals(createState(T - HOUR), T - HOUR, economy).state;
  return { ...state, embers: { ...state.embers, balance: 0 } };
}
const kinds = (events) => events.map((e) => e.t);

test('the timer is 50 minutes of focus and 15 of rest', () => {
  assert.equal(FOCUS_MS, 50 * MIN);
  assert.equal(REST_MS, 15 * MIN);
});

test('a 50/15 cycle under a moving clock pays 10 and 5 Embers, 1,000 Focus and 400 Hearthkeeping, once each, across relaunches', () => {
  let state = fresh();
  const start = kindleStart(state, T, opts);
  assert.deepEqual(start.events, [{ t: 'focus-started', id: `focus:${T}`, at: T }]);
  state = start.state;
  assert.deepEqual([state.kindle.phase, state.kindle.startedAt, state.kindle.focusEndsAt], ['focus', T, T + FOCUS_MS]);
  // Ticks every few minutes, with a relaunch at T+20 minutes (the saved state normalised at a later clock).
  for (let m = 1; m < 50; m += 7) {
    const tick = kindleTick(state, T + m * MIN, opts);
    assert.equal(tick.state, state, `nothing moves at ${m} minutes`);
    if (m === 22) state = relaunch(state, T + 20 * MIN);
  }
  const done = kindleTick(state, T + 51 * MIN, opts);
  assert.deepEqual(kinds(done.events), ['focus-done', 'rest-started']);
  assert.deepEqual(done.events[0], { t: 'focus-done', id: `focus:${T}`, at: T + FOCUS_MS });
  state = done.state;
  assert.deepEqual([state.embers.balance, state.xp.skills.focus, state.tally.focusSessions], [10, 1000, 1]);
  assert.deepEqual(state.embers.ledger.at(-1), { at: T + FOCUS_MS, n: 10, banked: 10, source: 'focus', text: 'Focus session 09:10–10:00' }, 'paid from when it ended');
  assert.deepEqual(state.chronicle.xpLines.at(-1), { at: T + FOCUS_MS, skill: 'focus', n: 1000, source: 'focus-session', text: 'Focus 1,000: focus session 09:10–10:00' });
  assert.deepEqual([state.kindle.phase, state.kindle.restStartedAt, state.kindle.restEndsAt, state.kindle.earned], ['rest', T + FOCUS_MS, T + FOCUS_MS + REST_MS, true], 'the rest starts at once');
  // A relaunch mid-rest, then more ticks: nothing pays twice.
  for (const later of [T + 52 * MIN, T + 55 * MIN, T + 60 * MIN]) {
    state = relaunch(state, later);
    const again = kindleTick(state, later, opts);
    assert.deepEqual(again.events, [], `no second focus pay at ${(later - T) / MIN} minutes`);
    assert.equal(again.state, state);
  }
  const rested = kindleTick(state, T + 66 * MIN, opts);
  assert.deepEqual(rested.events, [{ t: 'rest-done', id: `rest:${T + FOCUS_MS}`, at: T + FOCUS_MS + REST_MS }]);
  state = rested.state;
  assert.deepEqual([state.embers.balance, state.xp.skills.hearthkeeping, state.tally.restsHonoured, state.kindle.phase], [15, 400, 1, 'idle']);
  assert.deepEqual(state.embers.ledger.at(-1), { at: T + 65 * MIN, n: 5, banked: 5, source: 'rest', text: 'Rest honoured 10:00–10:15' });
  assert.equal(state.chronicle.xpLines.at(-1).text, 'Hearthkeeping 400: honoured rest 10:00–10:15');
  for (const later of [T + 67 * MIN, T + 2 * HOUR, T + 3 * DAY]) {
    state = relaunch(state, later);
    assert.deepEqual(kindleTick(state, later, opts).events, [], 'the cycle is over; nothing more pays');
  }
  assert.equal(state.embers.lifetime, 15);
  const day = state.chronicle.days['2026-09-29'];
  assert.deepEqual([day.focus, day.rests, day.embersIn, day.xp.focus, day.xp.hearthkeeping], [1, 1, 15, 1000, 400]);
});

test('a session that ended while MILO was closed pays once, from its absolute times', () => {
  const started = kindleStart(fresh(), T, opts).state;
  const back = relaunch(started, T + 5 * HOUR);
  const tick = kindleTick(back, T + 5 * HOUR, opts);
  assert.deepEqual(kinds(tick.events), ['focus-done', 'rest-started', 'rest-done'], 'the focus and its rest both ran out while closed');
  assert.deepEqual(tick.state.embers.ledger.slice(-2).map((e) => [e.at, e.n]), [[T + FOCUS_MS, 10], [T + FOCUS_MS + REST_MS, 5]]);
  assert.equal(tick.state.kindle.phase, 'idle');
  assert.deepEqual(kindleTick(relaunch(tick.state, T + 6 * HOUR), T + 6 * HOUR, opts).events, []);
});

test('a focus session ends at exactly 50 minutes and its rest at exactly 15 more, and the view agrees with the tick', () => {
  const focusing = kindleStart(fresh(), T, opts).state;
  const early = kindleTick(focusing, T + FOCUS_MS - 1, opts);
  assert.deepEqual([early.events, early.state], [[], focusing], 'a moment before 50 minutes nothing moves');
  assert.equal(kindleView(focusing, T + FOCUS_MS - 1).phase, 'focus');
  const done = kindleTick(focusing, T + FOCUS_MS, opts);
  assert.deepEqual(kinds(done.events), ['focus-done', 'rest-started'], 'at 50 minutes exactly the session is done');
  assert.deepEqual([done.state.embers.balance, done.state.tally.focusSessions, done.state.xp.skills.focus], [10, 1, 1000], 'and paid');
  assert.deepEqual(done.state.embers.ledger.at(-1).at, T + FOCUS_MS);
  assert.deepEqual([kindleView(focusing, T + FOCUS_MS).phase, kindleView(focusing, T + FOCUS_MS).left], ['rest', REST_MS], 'the view is resting from that moment too');
  const resting = done.state;
  const restEnd = T + FOCUS_MS + REST_MS;
  assert.deepEqual(kindleTick(resting, restEnd - 1, opts), { state: resting, events: [] }, 'a moment before the rest’s 15 minutes nothing moves');
  assert.equal(kindleView(resting, restEnd - 1).phase, 'rest');
  assert.equal(kindleView(focusing, restEnd - 1).phase, 'rest', 'the view reads an unticked session’s rest the same');
  const rested = kindleTick(resting, restEnd, opts);
  assert.deepEqual(kinds(rested.events), ['rest-done']);
  assert.deepEqual([rested.state.embers.balance, rested.state.tally.restsHonoured, rested.state.kindle.phase], [15, 1, 'idle'], 'at 15 minutes exactly the rest is honoured');
  assert.deepEqual([kindleView(resting, restEnd).phase, kindleView(focusing, restEnd).phase], ['idle', 'idle']);
});

test('a broken rest pays nothing: a new focus started during it', () => {
  let state = kindleTick(kindleStart(fresh(), T, opts).state, T + 51 * MIN, opts).state;
  assert.equal(state.kindle.phase, 'rest');
  const early = kindleStart(state, T + 58 * MIN, opts);
  assert.deepEqual(kinds(early.events), ['rest-broken', 'focus-started']);
  state = early.state;
  assert.deepEqual([state.kindle.phase, state.kindle.startedAt], ['focus', T + 58 * MIN]);
  const later = kindleTick(state, T + 70 * MIN, opts).state;
  assert.equal(later.tally.restsHonoured, 0);
  assert.equal(later.embers.balance, 10, 'only the focus session paid');
  assert.equal(kindleStart(later, T + 71 * MIN, opts).state, later, 'kindling while a session runs changes nothing');
});

test('stopping a focus early pays nothing and ends the cycle; Banked Coals on its own rests but pays nothing', () => {
  const focusing = kindleStart(fresh(), T, opts).state;
  const stopped = kindleStop(focusing, T + 30 * MIN, opts);
  assert.deepEqual(stopped.events, [{ t: 'stopped', id: `focus:${T}`, at: T + 30 * MIN }]);
  assert.equal(stopped.state.kindle.phase, 'idle');
  const after = kindleTick(stopped.state, T + 2 * HOUR, opts);
  assert.deepEqual([after.events, after.state.embers.balance, after.state.tally.focusSessions], [[], 0, 0]);
  assert.equal(kindleStop(after.state, T + 3 * HOUR, opts).state, after.state, 'nothing to stop');

  const coals = bankedCoals(fresh(), T, opts);
  assert.deepEqual(coals.events, [{ t: 'rest-started', id: `rest:${T}`, at: T }]);
  assert.deepEqual([coals.state.kindle.phase, coals.state.kindle.earned], ['rest', false]);
  assert.equal(bankedCoals(coals.state, T + MIN, opts).state, coals.state, 'already resting');
  const over = kindleTick(coals.state, T + 16 * MIN, opts);
  assert.deepEqual(kinds(over.events), ['rest-done']);
  assert.deepEqual([over.state.embers.balance, over.state.tally.restsHonoured, over.state.xp.skills.hearthkeeping ?? 0], [0, 0, 0], 'rests can’t be farmed');

  const mid = bankedCoals(focusing, T + 20 * MIN, opts);
  assert.deepEqual(kinds(mid.events), ['stopped', 'rest-started'], 'Banked Coals during a focus stops it, unpaid');
  assert.equal(kindleTick(mid.state, T + 2 * HOUR, opts).state.embers.balance, 0);

  const restStop = kindleStop(kindleTick(focusing, T + 52 * MIN, opts).state, T + 55 * MIN, opts);
  assert.deepEqual([restStop.state.kindle.phase, restStop.state.kindle.earned], ['idle', false], 'nothing is left earned');
  assert.equal(kindleTick(restStop.state, T + 2 * HOUR, opts).state.tally.restsHonoured, 0, 'a stopped rest isn’t honoured');
});

test('a rest saved without `earned` is Banked Coals: it ends, but isn’t honoured', () => {
  const base = fresh();
  const saved = { ...base, kindle: { phase: 'rest', startedAt: null, focusEndsAt: null, restStartedAt: T, restEndsAt: T + REST_MS, paid: { focus: null, rest: null } } };
  const state = relaunch(saved, T + MIN);
  assert.deepEqual([state.kindle.phase, state.kindle.earned], ['rest', false]);
  const over = kindleTick(state, T + REST_MS + MIN, opts);
  assert.deepEqual(kinds(over.events), ['rest-done']);
  assert.deepEqual([over.state.embers.balance, over.state.tally.restsHonoured, over.state.xp.skills.hearthkeeping ?? 0], [0, 0, 0]);
  const honoured = kindleTick(relaunch({ ...saved, kindle: { ...saved.kindle, earned: true } }, T + MIN), T + REST_MS + MIN, opts).state;
  assert.deepEqual([honoured.embers.balance, honoured.tally.restsHonoured], [5, 1], 'the same rest saved as earned is honoured');
});

test('kindleStart, bankedCoals and kindleStop pay what had finished first', () => {
  const focusing = kindleStart(fresh(), T, opts).state;
  const next = kindleStart(focusing, T + 70 * MIN, opts);
  assert.deepEqual(kinds(next.events), ['focus-done', 'rest-started', 'rest-done', 'focus-started']);
  assert.equal(next.state.embers.balance, 15, 'the finished session and its honoured rest paid before the new one began');
  const stop = kindleStop(focusing, T + 55 * MIN, opts);
  assert.deepEqual(kinds(stop.events), ['focus-done', 'rest-started', 'stopped']);
  assert.equal(stop.state.embers.balance, 10);
});

test('Kindle pays at the rates in economy.json and xp.json, not its own', () => {
  const rate = (list, id, key, n) => list.map((row) => (row.id === id ? { ...row, [key]: n } : row));
  const options = {
    economy: { ...economy, earn: rate(rate(economy.earn, 'focus', 'n', 12), 'rest', 'n', 6) },
    xp: { ...xp, sources: rate(rate(xp.sources, 'focus-session', 'xp', 1234), 'rest-honoured', 'xp', 77) },
  };
  let state = kindleStart(fresh(), T, options).state;
  state = kindleTick(state, T + FOCUS_MS + REST_MS, options).state;
  assert.deepEqual(state.embers.ledger.map((e) => [e.source, e.n]), [['focus', 12], ['rest', 6]]);
  assert.deepEqual([state.embers.balance, state.xp.skills.focus, state.xp.skills.hearthkeeping], [18, 1234, 77]);
  assert.deepEqual(state.chronicle.xpLines.map((line) => line.text), ['Focus 1,234: focus session 09:10–10:00', 'Hearthkeeping 77: honoured rest 10:00–10:15']);
});

test('focus sessions count toward the Hold', () => {
  let state = fresh();
  for (let i = 0; i < 3; i += 1) {
    const t = T + i * 2 * HOUR;
    state = kindleTick(kindleStart(state, t, opts).state, t + 70 * MIN, opts).state;
  }
  assert.equal(state.tally.focusSessions, 3);
  const status = hearthStatus({ ...state, hearth: { tier: 2, raisedAt: {} } }, fortress);
  const req = status.next.requirements.find((r) => r.kind === 'focus-sessions');
  assert.deepEqual([req.have, req.met, req.future], [3, false, false]);
});

test('kindleView and nextAlarm read the clock without paying', () => {
  const idle = fresh();
  assert.deepEqual(kindleView(idle, T), { phase: 'idle', endsAt: null, left: 0, words: 'The lantern’s ready when you are.' });
  assert.equal(nextAlarm(idle), null);
  const focusing = kindleStart(idle, T, opts).state;
  assert.deepEqual(kindleView(focusing, T + 16 * MIN), { phase: 'focus', endsAt: T + FOCUS_MS, left: 34 * MIN, words: 'Focus: 34 minutes left.' });
  assert.equal(kindleView(focusing, T + 49 * MIN + 30000).words, 'Focus: under a minute left.');
  assert.deepEqual(nextAlarm(focusing), { id: `focus:${T}`, at: T + FOCUS_MS, title: 'The focus session is done', body: 'Rest for fifteen minutes.' });
  const view = kindleView(focusing, T + 51 * MIN);
  assert.deepEqual([view.phase, view.endsAt, view.words], ['rest', T + 65 * MIN, 'Resting: 14 minutes left.'], 'the view follows the clock before a tick');
  assert.equal(focusing.embers.balance, 0, 'and pays nothing');
  assert.equal(kindleView(focusing, T + 3 * HOUR).phase, 'idle');
  const resting = kindleTick(focusing, T + 51 * MIN, opts).state;
  assert.deepEqual(nextAlarm(resting), { id: `rest:${T + FOCUS_MS}`, at: T + 65 * MIN, title: 'The rest is over', body: 'Kindle the lantern again when you’re ready.' });
  assert.equal(kindleView(resting, T + 64 * MIN).words, 'Resting: 1 minute left.');
  for (const text of [kindleView(idle, T).words, kindleView(focusing, T).words, kindleView(resting, T + 52 * MIN).words, nextAlarm(focusing).body, nextAlarm(resting).body]) {
    assertCalm(text, 'kindle words');
    assertCosy(text, 'kindle words');
  }
  for (const title of [nextAlarm(focusing).title, nextAlarm(resting).title]) assertCalm(`${title}.`, 'alarm title');
});

test('junk never throws or moves the timer', () => {
  const state = fresh();
  for (const junk of [null, 5, 'x', [], {}]) {
    assert.deepEqual(kindleTick(junk, T, opts), { state: junk, events: [] });
    assert.doesNotThrow(() => kindleView(junk, T));
    assert.doesNotThrow(() => nextAlarm(junk));
  }
  for (const now of [undefined, NaN, 'soon']) {
    assert.equal(kindleStart(state, now, opts).state, state, `no clock (${String(now)}), no change`);
    assert.equal(kindleTick(state, now, opts).state, state);
  }
  const noOpts = kindleTick(kindleStart(state, T).state, T + 51 * MIN);
  assert.equal(noOpts.state.embers.balance, 10, 'without content, the rates are economy.json’s and xp.json’s');
  assert.equal(noOpts.state.xp.skills.focus, 1000);
});

test('kindleTick takes at most 1 ms (median), paying or not', () => {
  const ledger = Array.from({ length: 300 }, (_, i) => ({ at: T - i * MIN, n: 10, banked: 10, source: 'focus', text: 'Focus session 09:10–10:00' }));
  const base = relaunch({ ...fresh(), embers: { ...fresh().embers, ledger } }, T);
  const focusing = kindleStart(base, T, opts).state;
  const times = [];
  for (let i = 0; i < 220; i += 1) {
    const now = i % 2 ? T + 10 * MIN : T + 70 * MIN;
    const start = performance.now();
    kindleTick(focusing, now, opts);
    if (i >= 20) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[100] <= 1, `median ${times[100].toFixed(3)} ms`);
});
