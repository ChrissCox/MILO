// Embers (src/embers.js, content/economy.json): earned only from real work, each payment once,
// the cap and lifetime, the backlog, daily caps, spends and charting chunks.
// CONTRACT-PHASE4.md §4.20, §7.6, §9.11, §13 (A's proofs), §15.
// Run: node --test tests/embers.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createState, normalizeState, STATE_LIMITS } from '../src/model.js';
import {
  DEFAULT_ECONOMY, economyOf, entryCost, earn, payFromSignals, spend, canAfford, walletView, chartChunks, touchesHeart, shortWords,
} from '../src/embers.js';
import { dayKey } from '../src/clean.js';
import { STATE4_LIMITS } from '../src/state4.js';
import { CHUNK, HEART } from '../src/world/worldgen.js';
import { assertCalm, assertCosy } from './calm.js';

const economy = JSON.parse(readFileSync(new URL('../content/economy.json', import.meta.url), 'utf8'));
const xpRates = JSON.parse(readFileSync(new URL('../content/xp.json', import.meta.url), 'utf8'));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (d, h = 12, m = 0) => new Date(2026, 8, d, h, m, 0).getTime(); // local time, September 2026
const NOW = at(29, 14);
const reload = (state, now) => normalizeState(JSON.parse(JSON.stringify(state)), now);
/** A state whose backlog is already paid, so each test starts from a clean wallet. */
function started({ sessions = 0, answered = 0, real = 0, designs = 0, balance = 0 } = {}) {
  const state = normalizeState({ tally: { sessionsFinished: sessions, answered, buildingsDesigned: designs }, rifts: { stitched: { real } } }, NOW);
  const paid = payFromSignals(state, NOW, economy).state;
  return { ...paid, embers: { ...paid.embers, balance, ledger: [], lifetime: balance } };
}
const bump = (state, { sessions = 0, answered = 0, real = 0, designs = 0 } = {}) => ({
  ...state,
  tally: { ...state.tally, sessionsFinished: state.tally.sessionsFinished + sessions, answered: state.tally.answered + answered, buildingsDesigned: state.tally.buildingsDesigned + designs },
  rifts: { ...state.rifts, stitched: { ...state.rifts.stitched, real: state.rifts.stitched.real + real } },
});

test('economy.json holds every number the code uses, and the code’s defaults are the file', () => {
  assert.equal(economy.version, 1);
  assertCalm(economy.about, 'economy.about', { proper: ['CONTRACT-PHASE4.md'] });
  const { version, about, ...numbers } = economy;
  assert.deepEqual(JSON.parse(JSON.stringify(numbers)), JSON.parse(JSON.stringify(DEFAULT_ECONOMY)));
  assert.deepEqual(economyOf(economy), economyOf(null));
  assert.deepEqual(economy.earn.map((e) => [e.id, e.n, e.perDay ?? null]), [['focus', 10, null], ['rest', 5, null], ['crew', 2, 10], ['answered', 1, 5], ['stitch', 5, null], ['design', 5, null], ['quest-main', 3, null], ['quest-side', 2, null]]);
});

test('entry costs follow COMBAT §12: a wild rift 5, +1 per 3 depths up to 10; real 5, story 0, field 5, cave 3, chunk 1', () => {
  const wild = Array.from({ length: 20 }, (_, i) => entryCost('wild', { depth: i + 1, economy }));
  assert.deepEqual(wild, [5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 10]);
  assert.equal(entryCost('wild', { depth: 400, economy }), 10);
  assert.equal(entryCost('wild'), 5, 'depth 1 by default');
  assert.equal(entryCost('rung', { depth: 5 }), 6, 'a ladder rung costs as a wild rift at its depth');
  assert.deepEqual(['real', 'story', 'field', 'cave', 'chunk'].map((kind) => entryCost(kind, { economy })), [5, 0, 5, 3, 1]);
  const cheaper = { ...economy, spend: { ...economy.spend, wild: { base: 5, every: 5, offset: 1, max: 10 } } };
  assert.equal(entryCost('wild', { depth: 6, economy: cheaper }), 6, 'only economy.json changes the rule');
});

test('earn pays an event key once, banks up to the cap, and counts every Ember in lifetime', () => {
  let state = started({ balance: 95 });
  const first = earn(state, { source: 'focus', key: `focus:${NOW - HOUR}`, n: 10, text: 'Focus session 13:00–13:50' }, NOW, economy);
  assert.deepEqual(first.entry, { at: NOW, n: 10, banked: 5, source: 'focus', text: 'Focus session 13:00–13:50' });
  state = first.state;
  assert.deepEqual([state.embers.balance, state.embers.lifetime], [100, 105], 'the bank caps at 100; lifetime counts past it');
  const again = earn(state, { source: 'focus', key: `focus:${NOW - HOUR}`, n: 10 }, NOW + MIN, economy);
  assert.equal(again.state, state, 'a key pays once');
  assert.equal(again.entry, null);
  const reloaded = reload(state, NOW + DAY);
  assert.equal(earn(reloaded, { source: 'focus', key: `focus:${NOW - HOUR}`, n: 10 }, NOW + DAY, economy).entry, null, 'and never again after a relaunch');
  const past = { ...reloaded, embers: { ...reloaded.embers, paid: {}, paidBefore: NOW } };
  assert.equal(earn(past, { source: 'focus', key: `focus:${NOW - HOUR}`, n: 10 }, NOW, economy).entry, null, 'a key at or before paidBefore counts as paid');
  const over = earn(state, { source: 'crew', n: 2, text: 'Watched a crew session finish' }, NOW, economy);
  assert.deepEqual([over.state.embers.balance, over.state.embers.lifetime, over.entry.banked], [100, 107, 0], 'nothing more banks at the cap, but it still counts');
  for (const n of [0, -3, 2.5, NaN, '5', 1_000_001]) assert.equal(earn(state, { source: 'x', n }, NOW, economy).state, state, String(n));
  assert.equal(earn(state, { source: 'x', key: 'Bad Key', n: 1 }, NOW, economy).entry, null);
  assert.equal(earn(state, { source: 'x', n: 1 }, 'later', economy).state, state, 'no clock, no pay');
});

test('the pay-once keys stay bounded, and a pruned key can never pay again', () => {
  let state = started();
  for (let i = 0; i < 230; i += 1) state = earn(state, { source: 'focus', key: `focus:${NOW - (230 - i) * HOUR}`, n: 1 }, NOW, economy).state;
  assert.equal(Object.keys(state.embers.paid).length, 200);
  assert.equal(state.embers.paidBefore, NOW - 201 * HOUR);
  assert.equal(earn(state, { source: 'focus', key: `focus:${NOW - 229 * HOUR}`, n: 1 }, NOW, economy).entry, null, 'the oldest key was pruned and still counts as paid');
  assert.ok(!(`focus:${NOW - 201 * HOUR}` in state.embers.paid));
  assert.equal(earn(state, { source: 'focus', key: `focus:${NOW - 201 * HOUR}`, n: 1 }, NOW, economy).entry, null, 'the newest pruned key sits exactly at paidBefore, and still counts as paid');
  assert.ok(earn(state, { source: 'focus', key: `focus:${NOW - 201 * HOUR + 1}`, n: 1 }, NOW, economy).entry, 'a key never paid, a moment after paidBefore, pays');
  assert.deepEqual(reload(state, NOW).embers, state.embers, 'the cleaner keeps what earn kept');
});

test('the backlog pays once, as one entry past 100, banked to the cap and whole in lifetime', () => {
  const phase3 = normalizeState({ tally: { sessionsFinished: 400, answered: 30, buildingsDesigned: 3 }, rifts: { stitched: { real: 12 } } }, NOW);
  assert.equal(phase3.embers.through, null);
  const { state, paid } = payFromSignals(phase3, NOW, economy);
  const n = 400 * 2 + 30 * 1 + 12 * 5 + 3 * 5;
  assert.deepEqual(paid, [{ at: NOW, n, banked: 100, source: 'backlog', text: 'From before the Kit' }], 'every count at its rate, ignoring the daily caps');
  assert.ok(n > 100);
  assert.deepEqual([state.embers.balance, state.embers.lifetime, state.embers.backlogAt], [100, n, NOW]);
  assert.deepEqual(state.embers.through, { sessionsFinished: 400, answered: 30, stitchedReal: 12, buildingsDesigned: 3 });
  assert.equal(reload(state, NOW).embers.ledger.at(-1).n, n, 'an entry past 100 survives the cleaner');
  assert.equal(payFromSignals(state, NOW + HOUR, economy).state, state, 'nothing new: the same state');
  assert.equal(payFromSignals(reload(state, NOW + DAY), NOW + DAY, economy).paid.length, 0, 'the backlog never pays twice, even after a relaunch');
  const fresh = payFromSignals(createState(NOW), NOW, economy);
  assert.deepEqual([fresh.paid, fresh.state.embers.ledger], [[], []], 'a brand-new MILO has no backlog to pay');
  assert.deepEqual(fresh.state.embers.through, { sessionsFinished: 0, answered: 0, stitchedReal: 0, buildingsDesigned: 0 });
  // A backlog worth more than one entry holds pays the most an entry holds (1,000,000), never nothing.
  const huge = normalizeState({ tally: { sessionsFinished: 600_000 } }, NOW);
  const big = payFromSignals(huge, NOW, economy);
  assert.deepEqual(big.paid.map((e) => [e.source, e.n, e.banked]), [['backlog', STATE4_LIMITS.ledgerMax, 100]]);
  assert.deepEqual([big.state.embers.lifetime, big.state.embers.through.sessionsFinished], [STATE4_LIMITS.ledgerMax, 600_000]);
  assert.equal(reload(big.state, NOW).embers.ledger.at(-1).n, STATE4_LIMITS.ledgerMax, 'and the entry survives the cleaner');
});

test('each signal pays its rate once, from its high-water mark, across a normalise-and-reload', () => {
  let state = started();
  state = bump(state, { sessions: 1, answered: 1, real: 1, designs: 1 });
  const first = payFromSignals(state, NOW, economy);
  assert.deepEqual(first.paid.map((e) => [e.source, e.n, e.text]), [
    ['crew', 2, 'Watched a crew session finish'], ['answered', 1, 'Answered a needs-you'], ['stitch', 5, 'Stitched a real rift'], ['design', 5, 'Designed a building'],
  ]);
  for (const entry of first.paid) assertCalm(entry.text, entry.source);
  state = first.state;
  assert.equal(state.embers.balance, 13);
  for (const later of [NOW + MIN, NOW + HOUR, NOW + 3 * DAY]) {
    const again = payFromSignals(reload(state, later), later, economy);
    assert.deepEqual(again.paid, [], `nothing pays twice (${later - NOW} ms later)`);
  }
  const more = payFromSignals(bump(reload(state, NOW + HOUR), { real: 2, designs: 1 }), NOW + HOUR, economy);
  assert.deepEqual(more.paid.map((e) => [e.source, e.n, e.text]), [['stitch', 10, 'Stitched 2 real rifts'], ['design', 5, 'Designed a building']]);
  const day = more.state.chronicle.days[dayKey(NOW)];
  assert.deepEqual([day.crew, day.answered, day.stitched, day.embersIn], [1, 1, 3, 28], 'the Chronicle counts each on its day');
});

test('daily caps count Embers, reset at local midnight, and forfeit the excess', () => {
  let state = started();
  const late = at(29, 23, 50);
  state = payFromSignals(bump(state, { sessions: 8 }), late, economy).state;
  assert.equal(state.embers.balance, 10, '8 sessions in a day pay 10 Embers, not 16');
  assert.equal(state.embers.day.crew, 10);
  assert.equal(state.embers.through.sessionsFinished, 8, 'the mark always advances in full');
  const nextDay = payFromSignals(reload(state, at(30, 0, 10)), at(30, 0, 10), economy);
  assert.deepEqual(nextDay.paid, [], 'the next day pays nothing for them');
  const oneMore = payFromSignals(bump(nextDay.state, { sessions: 1 }), at(30, 0, 20), economy);
  assert.deepEqual(oneMore.paid.map((e) => e.n), [2], 'a new day, a new cap');
  assert.deepEqual(oneMore.state.embers.day, { key: '2026-09-30', crew: 2, answered: 0 });
  let answers = started();
  answers = payFromSignals(bump(answers, { answered: 4 }), NOW, economy).state;
  answers = payFromSignals(bump(answers, { answered: 4 }), NOW + MIN, economy).state;
  assert.deepEqual([answers.embers.balance, answers.embers.day.answered], [5, 5], 'answers pay at most 5 Embers a day');
  const stitched = payFromSignals(bump(started(), { real: 30 }), NOW, economy).state;
  assert.equal(stitched.embers.balance, 100, 'real stitches have no daily cap (only the bank’s)');
  assert.equal(stitched.embers.lifetime, 150);
});

test('a damaged embers section, or one damaged mark, never pays the backlog or a counter’s history again', () => {
  const counts = { tally: { sessionsFinished: 400, answered: 30, answeredFast: 20, buildingsDesigned: 3 }, rifts: { stitched: { real: 12 } } };
  const paid = payFromSignals(normalizeState(counts, NOW), NOW, economy).state;
  assert.equal(paid.embers.ledger.at(-1).source, 'backlog', 'the backlog is paid');
  const later = NOW + 2 * DAY;
  const saved = JSON.parse(JSON.stringify(paid));
  const cases = [
    ...[null, [], 5, 'x', true].map((junk) => [`embers: ${JSON.stringify(junk)}`, { ...saved, embers: junk }]),
    ['a mark field that isn’t a number', { ...saved, embers: { ...saved.embers, through: { ...saved.embers.through, stitchedReal: 'x', buildingsDesigned: null } } }],
    ['a mark field that’s missing', { ...saved, embers: { ...saved.embers, through: { answered: 30 } } }],
    ['a negative mark field', { ...saved, embers: { ...saved.embers, through: { ...saved.embers.through, sessionsFinished: -1 } } }],
    ['a mark that isn’t a record', { ...saved, embers: { ...saved.embers, through: 'x' } }],
  ];
  for (const [why, damaged] of cases) {
    const state = normalizeState(damaged, later);
    const again = payFromSignals(state, later, economy);
    assert.deepEqual(again.paid, [], `${why}: nothing pays again`);
    assert.equal(again.state.embers.balance, state.embers.balance, why);
    const next = payFromSignals(bump(again.state, { sessions: 1, real: 1 }), later + MIN, economy);
    assert.deepEqual(next.paid.map((e) => [e.source, e.n]), [['crew', 2], ['stitch', 5]], `${why}: new work still pays`);
  }
  // A kindle key from before the damage can't pay again either (paidBefore is raised to now).
  const broken = normalizeState({ ...saved, embers: null }, later);
  assert.equal(earn(broken, { source: 'focus', key: `focus:${later - HOUR}`, n: 10 }, later, economy).entry, null);
  assert.ok(earn(broken, { source: 'focus', key: `focus:${later + MIN}`, n: 10 }, later + HOUR, economy).entry, 'a session after the damage still pays');
  // Only a save with no embers at all is from before the Kit.
  const { embers, ...phase3 } = saved;
  assert.equal(payFromSignals(normalizeState(phase3, later), later, economy).paid[0].source, 'backlog');
});

test('the ledger never stores a session title, whoever writes it', () => {
  const state = started({ balance: 20 });
  const stepped = spend(state, { n: 5, what: 'real', text: 'Stepped into the rift over “Fix the login bug”' }, NOW, economy).state;
  assert.equal(stepped.embers.ledger.at(-1).text, 'Stepped into the rift over a waiting session');
  const clipped = spend(state, { n: 5, what: 'real', text: `Stepped into the rift over “${'A very long title '.repeat(5)}` }, NOW, economy).state;
  assert.equal(clipped.embers.ledger.at(-1).text, 'Stepped into the rift over a waiting session', 'a title without its closing quote goes too');
  const earned = earn(state, { source: 'focus', key: `focus:${NOW - HOUR}`, n: 10, text: 'Focus session for “Letters”' }, NOW, economy).state;
  assert.equal(earned.embers.ledger.at(-1).text, 'Focus session for a waiting session');
  for (const entry of [...stepped.embers.ledger, ...earned.embers.ledger]) {
    assert.ok(!entry.text.includes('“'), entry.text);
    assertCalm(entry.text, 'a ledger line without its title');
  }
  assert.deepEqual(reload(stepped, NOW + 30 * DAY).embers.ledger, stepped.embers.ledger, 'and stays that way');
});

test('a counter that went down lowers its mark, so only new work pays', () => {
  const state = payFromSignals(bump(started(), { sessions: 3 }), NOW, economy).state;
  const damaged = { ...state, tally: { ...state.tally, sessionsFinished: 2 } };
  const lowered = payFromSignals(damaged, NOW + MIN, economy);
  assert.deepEqual(lowered.paid, []);
  assert.equal(lowered.state.embers.through.sessionsFinished, 2);
  assert.deepEqual(payFromSignals(bump(lowered.state, { sessions: 1 }), NOW + 2 * MIN, economy).paid.map((e) => e.n), [2]);
});

test('spends refuse calmly and change nothing; a story rift costs 0', () => {
  const state = started({ balance: 3 });
  const short = spend(state, { n: entryCost('wild', { economy }), what: 'wild' }, NOW, economy);
  assert.deepEqual([short.ok, short.state, short.reason], [false, state, 'That needs 5 Embers. You have 3.']);
  assertCalm(short.reason, 'short of Embers');
  assert.equal(shortWords(1, 0), 'That needs 1 Ember. You have 0.');
  const story = spend(state, { n: entryCost('story', { economy }), what: 'story' }, NOW, economy);
  assert.deepEqual([story.ok, story.state, story.reason], [true, state, null], 'the crack is free and writes nothing');
  const cave = spend(state, { n: 3, what: 'cave' }, NOW, economy);
  assert.equal(cave.ok, true);
  assert.equal(cave.state.embers.balance, 0);
  assert.deepEqual(cave.state.embers.ledger.at(-1), { at: NOW, n: -3, banked: 0, source: 'cave', text: 'Went into a cave' });
  assert.equal(cave.state.embers.lifetime, state.embers.lifetime, 'spending never lowers lifetime');
  assert.equal(cave.state.chronicle.days[dayKey(NOW)].embersOut, 3);
  for (const n of [-1, 1.5, NaN, 'x']) {
    const refused = spend(state, { n, what: 'wild' }, NOW, economy);
    assert.deepEqual([refused.ok, refused.state], [false, state], String(n));
    assertCalm(refused.reason, 'a spend that can’t be paid');
  }
  assert.equal(canAfford(state, 3), true);
  assert.equal(canAfford(state, 4), false);
  assert.equal(canAfford(state, 0), true);
  for (const words of ['Stepped into a wild rift', 'Went a rung deeper', 'Stepped into a real rift', 'Challenged a field boss', 'Went into a cave']) {
    assert.equal(spend(started({ balance: 20 }), { n: 5, what: { 'Stepped into a wild rift': 'wild', 'Went a rung deeper': 'rung', 'Stepped into a real rift': 'real', 'Challenged a field boss': 'field', 'Went into a cave': 'cave' }[words] }, NOW, economy).state.embers.ledger.at(-1).text, words);
    assertCalm(words, 'spend words');
  }
});

test('walletView shows the balance, cap, lifetime and today’s in and out', () => {
  let state = started({ balance: 40 });
  state = earn(state, { source: 'rest', key: `rest:${NOW - HOUR}`, n: 5 }, NOW, economy).state;
  state = spend(state, { n: 5, what: 'wild' }, NOW + MIN, economy).state;
  assert.deepEqual(walletView(state, NOW + 2 * MIN), { balance: 40, cap: 100, lifetime: 45, today: { earned: 5, spent: 5 } });
  assert.deepEqual(walletView(state, NOW + DAY).today, { earned: 0, spent: 0 }, 'a new day starts at nothing');
  assert.deepEqual(walletView(null, NOW), { balance: 0, cap: 100, lifetime: 0, today: { earned: 0, spent: 0 } });
});

test('the heart’s chunks are the ones that touch Hearthvale, as worldgen draws it', () => {
  assert.equal(CHUNK, 32);
  for (let cx = -3; cx <= 4; cx += 1) {
    for (let cy = -3; cy <= 4; cy += 1) {
      const touches = cx * CHUNK < HEART.w && (cx + 1) * CHUNK > HEART.x && cy * CHUNK < HEART.h && (cy + 1) * CHUNK > HEART.y;
      assert.equal(touchesHeart(`${cx},${cy}`), touches, `${cx},${cy}`);
    }
  }
  assert.equal(touchesHeart('nope'), false);
});

test('chartChunks: free on the heart and on explored chunks, 1 Ember and 40 Cartography otherwise, skipped when empty, nothing with free', () => {
  let state = started({ balance: 2 });
  state = { ...state, wilds: { ...state.wilds, explored: ['5,5'] } };
  const result = chartChunks(state, ['0,0', '1,1', '5,5', '6,5', '7,5', '8,5', '9,5', '6,5', 'bad'], NOW, { economy, xp: xpRates });
  assert.deepEqual(result.charted, ['0,0', '1,1', '6,5', '7,5'], 'the heart’s chunks are free; two more are bought');
  assert.deepEqual(result.skipped, ['8,5', '9,5'], 'with an empty wallet the rest stay under fog');
  const next = result.state;
  assert.equal(next.embers.balance, 0);
  assert.deepEqual(next.wilds.explored, ['5,5', '0,0', '1,1', '6,5', '7,5']);
  assert.equal(next.xp.skills.cartography, 80, '40 Cartography a bought chunk');
  assert.equal(next.tally.chunksCharted, 4);
  assert.deepEqual(next.embers.ledger.at(-1), { at: NOW, n: -2, banked: 0, source: 'chunk', text: 'Charted 2 new chunks' });
  assert.equal(next.chronicle.xpLines.at(-1).text, 'Cartography 80: 2 new chunks charted');
  assert.deepEqual(chartChunks(next, ['5,5', '6,5'], NOW, { economy }), { state: next, charted: [], skipped: [] }, 'explored already: nothing to do');
  const tablet = chartChunks(next, ['20,20', '21,20'], NOW, { economy, xp: xpRates, free: true });
  assert.deepEqual(tablet.charted, ['20,20', '21,20']);
  assert.deepEqual([tablet.state.embers.balance, tablet.state.embers.ledger.length, tablet.state.xp.skills.cartography], [0, next.embers.ledger.length, 80], 'a ruin tablet costs nothing and pays nothing');
  // A day's chunk spends fold into one ledger entry.
  let walker = started({ balance: 10 });
  for (let i = 0; i < 4; i += 1) walker = chartChunks(walker, [`${30 + i},0`], NOW + i * MIN, { economy, xp: xpRates }).state;
  assert.deepEqual(walker.embers.ledger.map((e) => [e.n, e.text]), [[-4, 'Charted 4 new chunks']]);
  const tomorrow = chartChunks(walker, ['40,0'], NOW + DAY, { economy }).state;
  assert.equal(tomorrow.embers.ledger.length, 2, 'a new day, a new entry');
  assert.deepEqual(reload(tomorrow, NOW + DAY).embers, tomorrow.embers);
});

test('chartChunks keeps the fog list at its cap, like markExplored', () => {
  const explored = Array.from({ length: STATE_LIMITS.explored }, (_, i) => `${i + 100},0`);
  const state = { ...started({ balance: 5 }), wilds: { ...createState(NOW).wilds, explored } };
  const next = chartChunks(state, ['-50,-50'], NOW, { economy }).state;
  assert.equal(next.wilds.explored.length, STATE_LIMITS.explored);
  assert.equal(next.wilds.explored.at(-1), '-50,-50');
});

test('a day’s chunk spends share one entry only down to −100, so a reload keeps every Ember spent', () => {
  const row = (from, n) => Array.from({ length: n }, (_, i) => `${from + i},20`);
  let state = chartChunks(started({ balance: 100 }), row(10, 100), NOW, { economy, xp: xpRates }).state;
  assert.deepEqual(state.embers.ledger.map((e) => [e.n, e.text]), [[-100, 'Charted 100 new chunks']]);
  state = { ...state, embers: { ...state.embers, balance: 5 } };
  state = chartChunks(state, row(200, 5), NOW + MIN, { economy, xp: xpRates }).state;
  assert.deepEqual(state.embers.ledger.map((e) => [e.n, e.text]), [[-100, 'Charted 100 new chunks'], [-5, 'Charted 5 new chunks']], 'past −100 a new entry starts');
  assert.deepEqual(reload(state, NOW + HOUR).embers.ledger, state.embers.ledger, 'the cleaner keeps both (it drops an entry below −100)');
  assert.equal(state.chronicle.days[dayKey(NOW)].embersOut, 105);
});

/* ------------------------------------------------------------------ every number from economy.json */

// economy.json with every number changed, to prove the code reads each one from the file (§9.11).
const CHANGED = Object.freeze({
  version: 1,
  about: 'Every number changed.',
  cap: 40,
  ledger: 5,
  earn: [{ id: 'focus', n: 12 }, { id: 'rest', n: 6 }, { id: 'crew', n: 3, perDay: 9 }, { id: 'answered', n: 2, perDay: 3 }, { id: 'stitch', n: 4 }, { id: 'design', n: 7 }],
  spend: { wild: { base: 2, every: 2, offset: 2, max: 6 }, real: 7, story: 1, field: 8, cave: 4, chunk: 2 },
});

test('a changed economy.json changes every cost', () => {
  const wild = Array.from({ length: 12 }, (_, i) => entryCost('wild', { depth: i + 1, economy: CHANGED }));
  // Offset 2, not the file's 1: depth 3 costs the base (with offset 1 it would cost 3), and depth 1,
  // below the offset, costs the base too, never less.
  assert.deepEqual(wild, [2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6], 'min(max, base + floor(max(0, depth − offset) / every)) with the file’s numbers');
  assert.equal(entryCost('rung', { depth: 5, economy: CHANGED }), 3);
  const atOffset = (offset) => entryCost('wild', { depth: 4, economy: { ...CHANGED, spend: { ...CHANGED.spend, wild: { ...CHANGED.spend.wild, offset } } } });
  assert.deepEqual([0, 1, 2, 4].map(atOffset), [4, 3, 3, 2], 'each offset moves the steps, 0 included');
  assert.deepEqual(['real', 'story', 'field', 'cave', 'chunk'].map((kind) => entryCost(kind, { economy: CHANGED })), [7, 1, 8, 4, 2]);
  // A chunk at 2 Embers: with 5, two are bought and the third waits under fog.
  const charted = chartChunks(started({ balance: 5 }), ['10,20', '11,20', '12,20'], NOW, { economy: CHANGED, xp: xpRates });
  assert.deepEqual([charted.charted, charted.skipped, charted.state.embers.balance], [['10,20', '11,20'], ['12,20'], 1]);
  assert.deepEqual(charted.state.embers.ledger.map((e) => e.n), [-4]);
});

test('a changed economy.json changes what each signal pays, and its daily cap', () => {
  // The backlog at the file's rates: 2 sessions × 3, an answer × 2, a stitch × 4 and a design × 7.
  const before = normalizeState({ tally: { sessionsFinished: 2, answered: 1, buildingsDesigned: 1 }, rifts: { stitched: { real: 1 } } }, NOW);
  assert.deepEqual(payFromSignals(before, NOW, CHANGED).paid.map((e) => [e.source, e.n]), [['backlog', 19]]);
  // Each signal: crew 3 each up to 9 Embers a day, answers 2 each up to 3, stitches 4, designs 7.
  const paid = payFromSignals(bump(started(), { sessions: 5, answered: 4, real: 2, designs: 1 }), NOW, CHANGED);
  assert.deepEqual(paid.paid.map((e) => [e.source, e.n]), [['crew', 9], ['answered', 3], ['stitch', 8], ['design', 7]]);
  assert.deepEqual([paid.state.embers.balance, paid.state.embers.day.crew, paid.state.embers.day.answered], [27, 9, 3]);
});

test('the bank’s cap and the ledger’s length come from economy.json, never past the save’s own 100 and 300', () => {
  assert.deepEqual([economy.cap, economy.ledger], [STATE4_LIMITS.cap, STATE4_LIMITS.ledger], 'the file holds §8.3’s limits');
  // Lowered: the bank holds 40, and the ledger keeps its newest 5.
  let state = payFromSignals(bump(started(), { sessions: 5, answered: 4, real: 2, designs: 1 }), NOW, CHANGED).state;
  state = payFromSignals(bump(state, { designs: 3 }), NOW + MIN, CHANGED).state;
  assert.deepEqual([state.embers.balance, state.embers.lifetime, state.embers.ledger.at(-1).banked], [40, 48, 13], '27 banked, then 13 of the next 21');
  assert.deepEqual([walletView(state, NOW, { economy: CHANGED }).cap, walletView(state, NOW, { economy: CHANGED }).balance], [40, 40]);
  assert.equal(state.embers.ledger.length, 5);
  const cave = spend(state, { n: entryCost('cave', { economy: CHANGED }), what: 'cave' }, NOW + 2 * MIN, CHANGED);
  assert.deepEqual([cave.ok, cave.state.embers.balance], [true, 36]);
  assert.deepEqual(cave.state.embers.ledger.map((e) => e.source), ['answered', 'stitch', 'design', 'design', 'cave'], 'the newest 5 entries');
  assert.equal(reload(cave.state, NOW + DAY).embers.balance, 36);
  // An earning past the fifth entry is written last too, and the oldest goes.
  const focus = earn(cave.state, { source: 'focus', key: `focus:${NOW}`, n: 12, text: 'Focus session 14:00–14:50' }, NOW + 3 * MIN, CHANGED);
  assert.deepEqual(focus.state.embers.ledger.map((e) => e.source), ['stitch', 'design', 'design', 'cave', 'focus'], 'an earning at the limit is kept; the oldest entry goes');
  assert.deepEqual(focus.state.embers.ledger.at(-1), focus.entry);
  assert.deepEqual(reload(focus.state, NOW + DAY).embers.ledger, focus.state.embers.ledger);
  // And at the file's own 300: each new earning is the newest entry, and the oldest goes.
  const answers = Array.from({ length: STATE4_LIMITS.ledger }, (_, i) => ({ at: NOW - (300 - i) * MIN, n: 1, banked: 1, source: 'answered', text: `Answer ${i}` }));
  let long = reload({ ...started(), embers: { ...started().embers, ledger: answers } }, NOW);
  assert.equal(long.embers.ledger.length, STATE4_LIMITS.ledger);
  for (const [i, source] of ['focus', 'rest'].entries()) {
    const paid = earn(long, { source, n: 5, text: `Earned ${source}` }, NOW + (i + 1) * MIN, economy);
    long = paid.state;
    assert.equal(long.embers.ledger.length, STATE4_LIMITS.ledger);
    assert.deepEqual(long.embers.ledger.at(-1), paid.entry, `the ${source} earning is the newest entry`);
    assert.equal(long.embers.ledger[0].text, `Answer ${i + 1}`, 'the oldest went');
  }
  const over = { ...state, embers: { ...state.embers, balance: 60 } };
  assert.equal(spend(over, { n: 50, what: 'wild' }, NOW, CHANGED).reason, shortWords(50, 40), 'a spend counts no more than the cap');
  // Raised: the save holds at most 100 Embers and 300 entries, so the file can't raise either.
  const raised = { ...economy, cap: 150, ledger: 500 };
  assert.deepEqual([economyOf(raised).cap, economyOf(raised).ledger], [STATE4_LIMITS.cap, STATE4_LIMITS.ledger]);
  const full = payFromSignals(bump(started({ balance: 95 }), { designs: 3 }), NOW, raised).state;
  assert.equal(full.embers.balance, 100, 'the bank stops at 100');
  assert.equal(reload(full, NOW + DAY).embers.balance, 100, 'and a reload agrees');
  assert.equal(walletView(full, NOW, { economy: raised }).cap, 100);
});

/* ------------------------------------------------------------------ the source scan */

// Only `earn` raises the balance, and only payFromSignals and kindleTick call it. The scan reads
// every file under src/ as code (comments, strings and regular expressions blanked), so a word in a
// comment or a line of copy never counts, and checks three ways around it: importing `earn` (under
// any name, or through a namespace or a dynamic import), calling or passing it from anywhere else,
// and writing an Embers balance or lifetime anywhere but in the functions allowed to.

const REGEX_AFTER_WORD = /^(?:return|typeof|instanceof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

/**
 * A source as the scan reads it, at the same offsets: `code` has comments, strings, template text
 * and regular expressions blanked to spaces (a template's `${…}` stays code); `bare` has only the
 * comments blanked. Newlines are kept, so line numbers still match.
 */
const lexed = new Map();
function lex(source) {
  if (!lexed.has(source)) lexed.set(source, lexOnce(source));
  return lexed.get(source);
}
function lexOnce(source) {
  const code = source.split('');
  const bare = source.split('');
  const blank = (chars, from, to) => { for (let k = from; k < to; k += 1) if (chars[k] !== '\n') chars[k] = ' '; };
  const n = source.length;
  const holes = []; // the brace depth at each open `${`
  let depth = 0;
  let prev = '';
  let word = '';
  let i = 0;
  const template = (from) => { // template text, from just after ` (or the } closing a ${…}) to the next ` or ${
    let j = from;
    while (j < n && source[j] !== '`' && !(source[j] === '$' && source[j + 1] === '{')) j += source[j] === '\\' ? 2 : 1;
    blank(code, from, j);
    word = '';
    if (j < n && source[j] === '$') {
      holes.push(depth);
      prev = '{';
      return j + 2;
    }
    prev = '`';
    return j + 1;
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + (next === '/' ? 0 : 2);
      blank(code, i, stop);
      blank(bare, i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(code, i + 1, j);
      i = j + 1;
      prev = c;
      word = '';
    } else if (c === '`') {
      i = template(i + 1);
    } else if (c === '}' && holes.length && holes.at(-1) === depth) {
      holes.pop();
      i = template(i + 1);
    } else if (c === '/' && (prev === '' || '([{,;:=!&|?+-*%<>~^'.includes(prev) || REGEX_AFTER_WORD.test(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n' && (source[j] !== '/' || inClass)) {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += 1;
      }
      blank(code, i + 1, j);
      i = j + 1;
      while (i < n && /[a-z]/i.test(source[i])) i += 1;
      prev = '/';
      word = '';
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(source[j])) j += 1;
      word = source.slice(i, j);
      prev = source[j - 1];
      i = j;
    } else {
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      if (!/\s/.test(c)) {
        prev = c;
        word = '';
      }
      i += 1;
    }
  }
  return { code: code.join(''), bare: bare.join('') };
}

/** For each opening bracket in code, the index of the one that closes it (one pass, kept per code). */
const bracketTables = new Map();
function closing(code, open) {
  if (!bracketTables.has(code)) {
    const table = new Map();
    const stack = [];
    for (let k = 0; k < code.length; k += 1) {
      const c = code[k];
      if (c === '(' || c === '[' || c === '{') stack.push(k);
      else if ((c === ')' || c === ']' || c === '}') && stack.length) table.set(stack.pop(), k);
    }
    bracketTables.set(code, table);
  }
  return bracketTables.get(code).get(open) ?? code.length;
}

/** Text with every nested bracket group blanked, leaving its first level. */
function firstLevel(text) {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if ('([{'.includes(ch)) depth += 1;
    out += depth ? ' ' : ch;
    if (')]}'.includes(ch)) depth -= 1;
  }
  return out;
}

/** Each top-level function declaration (not a function expression): { name, start, end }. */
function topFunctions(code) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (depth === 0 && c === 'f' && !/[\w$.]/.test(code[i - 1] ?? '')) {
      const m = /^function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(code.slice(i, i + 200));
      if (!m || !/(?:^|[;{}])\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?$/.test(code.slice(Math.max(0, i - 60), i))) continue;
      const open = code.indexOf('{', closing(code, i + m[0].length - 1));
      const end = closing(code, open);
      out.push({ name: m[1], start: i, end });
      i = end;
    }
  }
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;
const EARN_CALLERS = Object.freeze({ 'embers.js': ['payFromSignals', 'payQuest'], 'kindle.js': ['kindleTick'] });

/** Every way a tree ({ path, source }[], paths under src/) reaches embers.earn other than payFromSignals and kindleTick. */
function earnScan(files) {
  const problems = [];
  const calls = [];
  for (const { path, source } of files) {
    const { code } = lex(source);
    const at = (index) => `${path}:${lineOf(source, index)}`;
    const handled = new Set();
    let fns = null;
    const specifier = (quote) => source.slice(quote + 1, source.indexOf(source[quote], quote + 1));
    const fromEmbers = (quote) => /(?:^|\/)embers\.js$/.test(specifier(quote));
    const namespaces = [];
    for (const m of code.matchAll(/\b(import|export)\b([^;'"`()]*?)\bfrom\s*(?=['"])/g)) {
      if (!fromEmbers(m.index + m[0].length)) continue;
      const clause = m[2];
      if (m[1] === 'export' && clause.includes('*')) problems.push(`${at(m.index)}: re-exports all of embers.js`);
      const star = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      if (star && m[1] === 'import') namespaces.push({ name: star[1], index: m.index + m[1].length + star.index });
      for (const t of clause.matchAll(/\bearn\b/g)) {
        const index = m.index + m[1].length + t.index;
        handled.add(index);
        const plain = m[1] === 'import' && path === 'kindle.js' && /^\s*\{[^}]*\}\s*$/.test(clause) && !/\bearn\s+as\b/.test(clause);
        if (!plain) problems.push(`${at(index)}: ${m[1]}s earn from embers.js`);
      }
    }
    for (const { name, index } of namespaces) {
      for (const use of code.matchAll(new RegExp(String.raw`(?<![\w$.])${name.replaceAll('$', '\\$')}(?![\w$])`, 'g'))) {
        if (use.index >= index && use.index < index + 40) continue; // the import itself
        const member = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(code.slice(use.index + name.length));
        if (!member || member[1] === 'earn') problems.push(`${at(use.index)}: reaches earn through the embers.js namespace ${name}`);
      }
    }
    const dynamic = [...code.matchAll(/\bimport\s*\(\s*(?=['"`])/g)].some((m) => fromEmbers(m.index + m[0].length));
    for (const t of code.matchAll(/\bearn\b/g)) {
      if (handled.has(t.index)) continue;
      if (dynamic) {
        problems.push(`${at(t.index)}: earn, in a file that imports embers.js dynamically`);
        continue;
      }
      if (!Object.hasOwn(EARN_CALLERS, path)) continue; // another module's own `earn` is not embers.earn
      const before = code.slice(Math.max(0, t.index - 30), t.index);
      const after = code.slice(t.index + 4, t.index + 40);
      if (/\??\.\s*$/.test(before)) continue; // a property, such as the economy's earn table
      if (/[{,]\s*$/.test(before) && /^\s*:/.test(after)) continue; // an object key
      if (path === 'embers.js' && /(?:^|[;{}])\s*export\s+function\s+$/.test(before)) continue; // the declaration
      if (/^\s*\(/.test(after)) {
        const owner = (fns ??= topFunctions(code)).find((f) => f.start <= t.index && t.index <= f.end)?.name ?? '(top level)';
        calls.push(`${path}:${owner}`);
        if (!EARN_CALLERS[path].includes(owner)) problems.push(`${at(t.index)}: earn is called from ${owner}`);
        continue;
      }
      problems.push(`${at(t.index)}: earn is passed around or renamed`);
    }
  }
  return { problems, calls };
}

/** Every write to an Embers balance or lifetime, outside earn (both), spend and spendChunks (the balance, down). */
function balanceScan(files) {
  const WRITERS = { balance: ['earn', 'spend', 'spendChunks'], lifetime: ['earn'] };
  const OP = String.raw`(?:(?:\*\*|<<|>>>?|\?\?|&&|\|\||[-+*/%&|^])?=(?!=)|\+\+|--)`;
  const problems = [];
  for (const { path, source } of files) {
    if (path === 'state4.js') continue; // the empty values and the cleaner, which only clamps (state4.test.js)
    const { code, bare } = lex(source);
    const writes = [];
    for (const m of code.matchAll(new RegExp(String.raw`\??\.\s*(balance|lifetime)\s*${OP}`, 'g'))) writes.push([m.index, m[1]]);
    for (const m of code.matchAll(/(?:\+\+|--)\s*[\w$.?\])]*\.\s*(balance|lifetime)\b/g)) writes.push([m.index, m[1]]);
    for (const m of bare.matchAll(new RegExp(String.raw`\[\s*(['"\`])(balance|lifetime)\1\s*\]\s*${OP}`, 'g'))) writes.push([m.index, m[2]]);
    // Object literals that become an embers section: an `embers` key's or variable's value, or one
    // that spreads an embers object; and Object.assign with an embers object.
    for (let open = /embers/i.test(code) ? code.indexOf('{') : -1; open >= 0; open = code.indexOf('{', open + 1)) {
      const end = closing(code, open);
      const inner = firstLevel(code.slice(open + 1, end));
      const embersy = /\bembers\s*[:=]\s*$/i.test(code.slice(Math.max(0, open - 40), open)) || /\.\.\.\s*[\w$.?]*embers/i.test(inner);
      if (!embersy) continue;
      for (const part of inner.split(',')) {
        const key = /^\s*(balance|lifetime)\s*(?::|$)/.exec(part);
        if (key) writes.push([open, key[1]]);
      }
      const computed = /\[\s*(['"`])(balance|lifetime)\1\s*\]\s*:/.exec(bare.slice(open, end));
      if (computed) writes.push([open, computed[2]]);
    }
    for (const m of code.matchAll(/\bObject\s*\.\s*assign\s*\(/g)) {
      const args = bare.slice(m.index, closing(code, m.index + m[0].length - 1));
      const field = /\b(balance|lifetime)\b/.exec(args);
      if (/embers/i.test(args) && field) writes.push([m.index, field[1]]);
    }
    const fns = topFunctions(code);
    for (const [index, field] of writes) {
      const owner = fns.find((f) => f.start <= index && index <= f.end)?.name ?? '(top level)';
      if (path === 'embers.js' && WRITERS[field].includes(owner)) continue;
      problems.push(`${path}:${lineOf(source, index)}: writes an Embers ${field} (in ${owner})`);
    }
  }
  return problems;
}

function srcTree() {
  const root = new URL('../src/', import.meta.url);
  const files = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir), `${prefix}${name}/`);
      else if (name.endsWith('.js')) files.push({ path: `${prefix}${name}`, source: readFileSync(url, 'utf8') });
    }
  };
  walk(root, '');
  return files;
}

test('only earn raises the balance, and only payFromSignals and kindleTick call it (a source scan)', () => {
  const tree = srcTree();
  assert.ok(tree.length > 40 && tree.some((f) => f.path === 'world/engine.js'), 'the scan reads all of src/');
  const { problems, calls } = earnScan(tree);
  assert.deepEqual(problems, []);
  assert.ok(calls.includes('embers.js:payFromSignals') && calls.includes('kindle.js:kindleTick') && calls.length >= 3, calls.join(', '));
  assert.deepEqual(balanceScan(tree), []);
});

test('the source scan catches every way around it that it looks for', () => {
  const tree = srcTree();
  const change = (path, extra) => {
    assert.ok(tree.some((f) => f.path === path), path);
    return tree.map((f) => (f.path === path ? { ...f, source: `${f.source}\n${extra}\n` } : f));
  };
  const earnWays = {
    'a top-level arrow in embers.js': change('embers.js', "export const bonus = (s, now) => earn(s, { source: 'bonus', n: 5, text: 'A bonus' }, now);"),
    'a function expression named like a caller': change('embers.js', 'const late = function payFromSignals(s, now) { return earn(s, { n: 1 }, now); };'),
    'earn renamed inside embers.js': change('embers.js', 'const give = earn;'),
    'earn exported again under another name': change('embers.js', 'export { earn as give };'),
    'earn imported under another name': change('chronicle.js', "import { earn as give } from './embers.js';\nexport function gift(s, now) { return give(s, { source: 'gift', n: 5 }, now).state; }"),
    'earn imported plainly elsewhere': change('lifeskills.js', "import { earn } from './embers.js';"),
    'earn re-exported from another file': change('state4.js', "export { earn } from './embers.js';"),
    'all of embers.js re-exported': change('clean.js', "export * from './embers.js';"),
    'earn through a namespace': change('sky.js', "import * as E from './embers.js';\nexport const warm = (s, now) => E.earn(s, { n: 1 }, now);"),
    'a namespace passed around': change('sky.js', "import * as E from './embers.js';\nexport const all = E;"),
    'earn through a dynamic import': change('commands.js', "export async function lucky(s, now) { const { earn } = await import('./embers.js'); return earn(s, { n: 1 }, now); }"),
    'kindle.js passing earn on': change('kindle.js', 'export { earn };'),
    'kindle.js calling earn from another function': change('kindle.js', 'export function extra(s, now) { return earn(s, { n: 1 }, now); }'),
  };
  for (const [why, files] of Object.entries(earnWays)) assert.ok(earnScan(files).problems.length > 0, why);
  const balanceWays = {
    'a direct raise in lifeskills': change('lifeskills.js', 'export function sneak(state) { return { ...state, embers: { ...state.embers, balance: 100 } }; }'),
    'an embers key built from a spread': change('chronicle.js', 'export const sneak = (state) => ({ ...state, embers: { ...embersOf(state), lifetime: 5 } });'),
    'a property assignment': change('ui/frontier.js', 'export function sneak(state) { state.embers.balance += 5; }'),
    'an increment': change('ui/frontier.js', 'export function sneak(state) { ++state.embers.balance; }'),
    'a computed property': change('ui/frontier.js', "export function sneak(state) { state.embers['balance'] = 100; }"),
    'Object.assign': change('ui/frontier.js', 'export function sneak(state) { Object.assign(state.embers, { balance: 100 }); }'),
    'a raise inside embers.js outside earn': change('embers.js', 'export function gift(state) { return { ...state, embers: { ...embersOf(state), balance: 100 } }; }'),
    'lifetime written outside earn': change('embers.js', 'export function refund(state) { return { ...state, embers: { ...embersOf(state), lifetime: 0 } }; }'),
  };
  for (const [why, files] of Object.entries(balanceWays)) assert.ok(balanceScan(files).length > 0, why);
  // Words in comments, copy and regular expressions never count.
  const quiet = change('chronicle.js', "// earn(state) and embers.balance = 5 in a comment\nexport const WORDS = ['earn(', 'embers: { balance: 100 }', `${'earn'}(x) embers.balance = 1`];\nconst re = /earn\\(|balance = /;");
  assert.deepEqual(earnScan(quiet).problems, []);
  assert.deepEqual(balanceScan(quiet), []);
});

test('payFromSignals takes at most 1 ms (median) on a full wallet and Chronicle', () => {
  let state = started();
  const ledger = Array.from({ length: 300 }, (_, i) => ({ at: NOW - i * MIN, n: 2, banked: 2, source: 'crew', text: 'Watched a crew session finish' }));
  const days = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [dayKey(NOW - i * DAY), { embersIn: 10, embersOut: 5, focus: 2, rests: 2, crew: 3, answered: 1, stitched: 0, fights: 4, xp: { focus: 2000 } }]));
  state = reload({ ...state, embers: { ...state.embers, ledger }, chronicle: { ...state.chronicle, days } }, NOW);
  const runs = [];
  for (let i = 0; i < 220; i += 1) {
    const input = bump(state, { sessions: 1 + (i % 3), answered: i % 2, real: i % 5 === 0 ? 1 : 0 });
    const start = performance.now();
    payFromSignals(input, NOW + i, economy);
    if (i >= 20) runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  assert.ok(runs[100] <= 1, `median ${runs[100].toFixed(3)} ms`);
});

test('the ledger’s own words are calm and cosy', () => {
  let state = started({ balance: 50 });
  state = payFromSignals(bump(state, { sessions: 3, answered: 2, real: 1, designs: 2 }), NOW, economy).state;
  state = chartChunks(state, ['60,60'], NOW, { economy }).state;
  state = spend(state, { n: 5, what: 'field' }, NOW, economy).state;
  for (const entry of state.embers.ledger) {
    assertCalm(entry.text, entry.source);
    assertCosy(entry.text, entry.source);
    assert.ok(entry.text.length <= 60 && entry.source.length <= 20);
  }
});
