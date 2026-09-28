// Core tests: state model (step 2 plots, Phase 3 tally, Hearth, satchel, wilds, rifts and story), recap, greeting, live alerts, skills, built text.
// Run: node --test tests/core.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createState, normalizeState, markSeen, dayKey, toTime, looksLikeSavedState, DEFAULT_SETTINGS,
  PLOT_IDS, LEGACY_PLACE_IDS, canonicalPlaceId, emptyPlot, cleanSuggestion, cleanSuggestions, ideaFromText, checkBlueprint,
  plotOf, buildingName, builtNames, setSuggestions, startDesign, finishDesign, stopDesign, renamePlot, clearPlot,
  dayNumber, dayStart, tallyFinished, cleanEveningBell, addMaterials, markFelled, lightLantern, markPoi, markExplored,
  STATE_LIMITS, WARD_POSTS,
} from '../src/model.js';
import { buildRecap, greeting, diffSnapshots, alertText, agentName, truncate, AWAY_THRESHOLD_MS, builtText, designerName } from '../src/recap.js';
import { SKILLS, evaluateSkills, skillForPlace, hasLevelTree } from '../src/skills.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (h, m = 0) => new Date(2026, 8, 26, h, m, 0).getTime(); // local time, 26 Sep 2026
const NOW = at(14);
const OPEN = '\u201C';
const CLOSE = '\u201D';
const q = (title) => `${OPEN}${title}${CLOSE}`;

function session(over = {}) {
  return {
    id: 'claude:a', agent: 'claude', sessionId: 'a', title: 'Habitack development', project: 'Habitack',
    cwd: 'C:\\Users\\chris\\Projects\\Habitack', startedAt: NOW - 5 * HOUR, lastActivityAt: NOW - HOUR,
    status: 'done', statusDetail: 'Finished', live: false, lastMessage: '', completions: [], turns: 0,
    model: '', source: 'cli', archived: false, ...over,
  };
}

// Words that are allowed to be capitalised mid-sentence.
const PROPER = new Set(['Claude', 'Code', 'Codex', 'Milo', 'MILO', 'Chris', 'GitHub', 'PRs', 'CI', 'PC', 'I', 'I\u2019m', 'Sam']);

/** Calm copy: sentence case, no exclamation marks, no please/successfully, no emoji, no straight double quotes. */
function assertCalm(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.ok(!text.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji: ${text}`);
  assert.ok(!text.includes('"'), `${where} uses curly quotes only: ${text}`);
  const unquoted = text.replace(/\u201C[^\u201D]*\u201D/g, 'x'); // titles keep their own casing
  const firstLetter = text.match(/\p{L}/u);
  if (firstLetter) assert.equal(firstLetter[0], firstLetter[0].toUpperCase(), `${where} starts with a capital: ${text}`);
  const words = unquoted.split(/\s+/).slice(1).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}\u2019]+$/gu, ''));
  for (const word of words) {
    if (!word || PROPER.has(word)) continue;
    assert.ok(word[0] === word[0].toLowerCase(), `${where} is sentence case, "${word}" in: ${text}`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/* ------------------------------------------------------------------ model.js */

// Phase 3 polish adds `firstBuiltAt` (when a building first stood on the plot, kept across redesigns).
const EMPTY_PLOT = { status: 'empty', suggestions: [], asked: null, idea: null, blueprint: null, designedBy: null, builtAt: null, firstBuiltAt: null, name: null };

// Phase 3 adds these to every setting object (CONTRACT-PHASE3 §4.6).
const PHASE3_SETTINGS = { eveningBell: '22:00', gateBell: true, wardPost: null };

test('createState has the contract shape and calm defaults', () => {
  const state = createState(NOW);
  assert.deepEqual(state, {
    version: 1,
    user: { name: 'Chris' },
    milo: { name: 'Milo', tile: null },
    lastSeenAt: null,
    lastGreetedDay: null,
    settings: { motion: true, notifications: true, greeting: true, designer: 'auto', ...PHASE3_SETTINGS },
    skills: {},
    panel: null,
    plots: {
      'plot-meadow': EMPTY_PLOT, 'plot-rise': EMPTY_PLOT, 'plot-birch': EMPTY_PLOT, 'plot-pond': EMPTY_PLOT, 'plot-orchard': EMPTY_PLOT,
    },
    // Phase 3: the Hearth and the Wilds.
    firstSeenAt: null,
    tally: { daysSeen: 0, lastDay: null, sessionsFinished: 0, finishedIds: [], buildingsDesigned: 0 },
    hearth: { tier: 1, raisedAt: {} },
    satchel: { materials: { birch: 0, ash: 0, pine: 0 }, essences: {}, essenceGenres: {}, relics: [] },
    wilds: { seed: 'hushlands', at: null, wake: null, explored: [], lanterns: {}, opened: {}, notes: {}, glimmers: {}, felled: {} },
    rifts: {
      open: {}, warded: {}, letGo: {}, belled: {}, closedWild: {}, visited: {},
      stitched: { real: 0, wild: 0, story: 0 }, deepest: 0, history: [],
    },
    story: { prologue: { done: {} }, letterReadAt: null, trackerHidden: false },
  });
  assert.deepEqual(Object.keys(state).slice(9), ['firstSeenAt', 'tally', 'hearth', 'satchel', 'wilds', 'rifts', 'story'], 'new keys come after plots');
  assert.notEqual(createState().plots['plot-meadow'], createState().plots['plot-meadow'], 'plots are not shared between states');
  assert.notEqual(createState().settings, createState().settings, 'settings are not shared between states');
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

test('looksLikeSavedState tells a saved state from a damaged file', () => {
  assert.equal(looksLikeSavedState(createState()), true);
  assert.equal(looksLikeSavedState(JSON.parse(JSON.stringify(createState()))), true);
  for (const junk of [null, [], 42, 'state', {}, { settings: {}, milo: {} }, { settings: [], milo: {}, user: {} }, { settings: {}, milo: null, user: {} }]) {
    assert.equal(looksLikeSavedState(junk), false, JSON.stringify(junk));
  }
});

test('normalizeState turns any junk into a fresh state and never throws', () => {
  const fresh = createState(NOW);
  const junk = [null, undefined, 0, 42, NaN, true, '', 'garbage', '{not json', '[]', [], [1, 2], () => 1, Symbol('x'), new Date()];
  for (const input of junk) {
    assert.deepEqual(normalizeState(input, NOW), fresh, `junk ${String(input?.toString?.() ?? input)}`);
  }
  const throwing = { get user() { throw new Error('boom'); } };
  assert.deepEqual(normalizeState(throwing, NOW), fresh);
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.deepEqual(normalizeState(proxy, NOW), fresh);
  assert.doesNotThrow(() => normalizeState({ lastSeenAt: 1 }, 'not a clock'));
});

test('normalizeState parses a JSON string', () => {
  const state = normalizeState(JSON.stringify({ lastSeenAt: NOW - HOUR, panel: 'watchtower' }), NOW);
  assert.equal(state.lastSeenAt, NOW - HOUR);
  assert.equal(state.panel, 'watchtower');
});

test('normalizeState repairs each field on its own', () => {
  const state = normalizeState({
    version: 7,
    user: { name: '   ' },
    milo: { name: 12, tile: { x: 3.4, y: 7.6 } },
    lastSeenAt: 'yesterday-ish',
    lastGreetedDay: '2026-02-31',
    settings: { motion: 'no', notifications: false, greeting: 0 },
    skills: 'lots',
    panel: 42,
  }, NOW);
  assert.equal(state.version, 1);
  assert.equal(state.user.name, 'Chris');
  assert.equal(state.milo.name, 'Milo');
  assert.deepEqual(state.milo.tile, { x: 3, y: 8 });
  assert.equal(state.lastSeenAt, null);
  assert.equal(state.lastGreetedDay, null);
  assert.deepEqual(state.settings, { motion: true, notifications: false, greeting: true, designer: 'auto', ...PHASE3_SETTINGS });
  assert.deepEqual(state.skills, {});
  assert.equal(state.panel, null);
});

test('normalizeState: names, tiles and panel ids', () => {
  assert.equal(normalizeState({ user: { name: '  Chris\n  M  ' } }).user.name, 'Chris M');
  assert.equal(normalizeState({ user: { name: 'x'.repeat(200) } }).user.name.length, 40);
  assert.equal(normalizeState({ user: 'Chris' }).user.name, 'Chris');
  for (const tile of [{ x: '3', y: 4 }, { x: -1, y: 0 }, { x: NaN, y: 1 }, { x: 1 }, [1, 2], 'x', { x: 1e9, y: 1 }]) {
    assert.equal(normalizeState({ milo: { tile } }).milo.tile, null, JSON.stringify(tile));
  }
  assert.deepEqual(normalizeState({ milo: { tile: { x: 0, y: 0 } } }).milo.tile, { x: 0, y: 0 });
  assert.equal(normalizeState({ panel: '' }).panel, null);
  assert.equal(normalizeState({ panel: ' camp ' }).panel, 'camp');
  assert.equal(normalizeState({ panel: 'p'.repeat(65) }).panel, null);
});

test('normalizeState: timestamps and day keys', () => {
  for (const bad of ['abc', -5, 0, Infinity, NaN, null, {}, true]) {
    assert.equal(normalizeState({ lastSeenAt: bad }, NOW).lastSeenAt, null, String(bad));
  }
  assert.equal(normalizeState({ lastSeenAt: String(NOW - MIN) }, NOW).lastSeenAt, NOW - MIN);
  assert.equal(normalizeState({ lastSeenAt: new Date(NOW - MIN).toISOString() }, NOW).lastSeenAt, NOW - MIN);
  assert.equal(normalizeState({ lastSeenAt: NOW - 0.4 }, NOW).lastSeenAt, NOW);
  assert.equal(normalizeState({ lastSeenAt: NOW + 5 * HOUR }, NOW).lastSeenAt, NOW, 'future clamps to now');
  assert.equal(normalizeState({ lastGreetedDay: '2026-09-26' }).lastGreetedDay, '2026-09-26');
  for (const bad of ['2026-9-1', '2026-13-01', '26-09-2026', 20260926, 'today']) {
    assert.equal(normalizeState({ lastGreetedDay: bad }).lastGreetedDay, null, String(bad));
  }
  assert.equal(toTime(new Date(NOW)), NOW);
  assert.equal(toTime('nope'), null);
});

test('normalizeState: settings and skills keep unknown keys, fix known ones', () => {
  const state = normalizeState({
    settings: { motion: false, sound: 'soft' },
    skills: {
      watchkeeping: { level: 2.7, provenAt: 'x', note: 'kept' },
      dispatch: 3,
      lore: { level: -4, provenAt: NOW },
      voice: { level: 500 },
      bogus: 'str',
      '': { level: 1 },
    },
  }, NOW);
  assert.deepEqual(state.settings, { motion: false, notifications: true, greeting: true, sound: 'soft', designer: 'auto', ...PHASE3_SETTINGS });
  assert.deepEqual(state.skills, {
    watchkeeping: { level: 2, provenAt: null, note: 'kept' },
    dispatch: { level: 3, provenAt: null },
    lore: { level: 0, provenAt: NOW },
    voice: { level: 99, provenAt: null },
  });
});

test('normalizeState keeps unknown fields and stays idempotent', () => {
  const input = { future: { a: 1 }, list: [1, 2], user: { name: 'Chris', pronouns: 'he/him' }, milo: { hat: 'green' } };
  const state = normalizeState(input, NOW);
  assert.deepEqual(state.future, { a: 1 });
  assert.deepEqual(state.list, [1, 2]);
  assert.equal(state.user.pronouns, 'he/him');
  assert.equal(state.milo.hat, 'green');
  assert.deepEqual(Object.keys(state).slice(0, 8), ['version', 'user', 'milo', 'lastSeenAt', 'lastGreetedDay', 'settings', 'skills', 'panel']);
  assert.deepEqual(normalizeState(state, NOW), state);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state)), NOW), state);
});

test('normalizeState does not mutate its input and resists prototype keys', () => {
  const input = deepFreeze({ lastSeenAt: NOW - MIN, settings: { motion: false }, milo: { tile: { x: 1, y: 2 } } });
  const copy = JSON.stringify(input);
  const state = normalizeState(input, NOW);
  assert.equal(JSON.stringify(input), copy);
  assert.notEqual(state.settings, input.settings);
  assert.equal(state.settings.motion, false);

  const hostile = JSON.parse('{"__proto__":{"polluted":true},"settings":{"__proto__":{"motion":false}},"skills":{"__proto__":{"level":3},"constructor":{"level":1}},"user":{"__proto__":{"x":1}}}');
  const safe = normalizeState(hostile, NOW);
  assert.equal(Object.getPrototypeOf(safe), Object.prototype);
  assert.equal(safe.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(safe.settings), Object.prototype);
  assert.equal(safe.settings.motion, true);
  assert.deepEqual(Object.keys(safe.skills), []);
  assert.ok(!Object.hasOwn(safe, '__proto__'));
  assert.ok(!Object.hasOwn(safe.user, '__proto__'));
});

test('markSeen sets lastSeenAt and returns the state', () => {
  const state = createState(NOW);
  const result = markSeen(state, NOW + MIN);
  assert.equal(result, state);
  assert.equal(state.lastSeenAt, NOW + MIN);
  const fromJunk = markSeen(null, NOW);
  assert.equal(fromJunk.lastSeenAt, NOW);
  assert.equal(fromJunk.version, 1);
  const frozen = Object.freeze(createState(NOW));
  const copied = markSeen(frozen, NOW);
  assert.notEqual(copied, frozen);
  assert.equal(copied.lastSeenAt, NOW);
  assert.equal(frozen.lastSeenAt, null);
  const before = Date.now();
  assert.ok(markSeen(createState(), 'soon').lastSeenAt >= before);
});

test('markSeen counts each new local day once, with a new tally object (Phase 3)', () => {
  const state = createState(NOW);
  const firstTally = state.tally;
  markSeen(state, at(9));
  assert.equal(state.firstSeenAt, at(9), 'the first look is remembered');
  assert.deepEqual(state.tally, { daysSeen: 1, lastDay: '2026-09-26', sessionsFinished: 0, finishedIds: [], buildingsDesigned: 0 });
  assert.notEqual(state.tally, firstTally, 'a new tally object');
  assert.equal(firstTally.daysSeen, 0, 'the old tally is never changed in place');
  const sameDay = state.tally;
  markSeen(state, at(23, 59));
  assert.equal(state.tally, sameDay, 'the same day adds nothing');
  assert.equal(state.tally.daysSeen, 1);
  markSeen(state, new Date(2026, 8, 27, 0, 1).getTime());
  assert.equal(state.tally.daysSeen, 2);
  assert.equal(state.tally.lastDay, '2026-09-27');
  markSeen(state, at(12));
  assert.equal(state.tally.daysSeen, 2, 'a clock that jumps back never counts a day twice');
  assert.equal(state.tally.lastDay, '2026-09-27');
  assert.equal(state.firstSeenAt, at(9), 'firstSeenAt stays put');
  markSeen(state, new Date(2026, 9, 3, 8).getTime());
  assert.equal(state.tally.daysSeen, 3, 'days apart still count one each');
  // Frozen input: the copy has the new count, the original none of it.
  const frozen = deepFreeze(createState(NOW));
  const copy = markSeen(frozen, NOW);
  assert.deepEqual([copy.tally.daysSeen, copy.tally.lastDay, copy.firstSeenAt], [1, '2026-09-26', NOW]);
  assert.equal(frozen.tally.daysSeen, 0);
  assert.equal(frozen.firstSeenAt, null);
  assert.deepEqual([markSeen(null, NOW).tally.daysSeen, markSeen(null, NOW).firstSeenAt], [1, NOW]);
  // A state saved without a tally (before normalizing) starts one.
  assert.equal(markSeen({ settings: {}, milo: {}, user: {} }, NOW).tally.daysSeen, 1);
});

test('dayKey formats the local calendar day', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 0).getTime()), '2026-12-31');
  assert.equal(dayKey(at(9)), '2026-09-26');
  assert.equal(dayKey(NaN), dayKey(Date.now()));
  assert.equal(dayKey('junk'), dayKey());
  assert.match(dayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

/* ------------------------------------------------------------------ recap.js */

test('buildRecap with null lastSeenAt is a first visit: only current state', () => {
  const sessions = [
    session({ id: 'claude:1', completions: [NOW - 2 * HOUR, NOW - MIN], startedAt: NOW - MIN, status: 'working' }),
    session({ id: 'codex:2', agent: 'codex', status: 'needs-you', completions: [NOW - MIN] }),
    session({ id: 'claude:3', status: 'done', completions: [NOW - MIN] }),
  ];
  const recap = buildRecap(sessions, null, NOW);
  assert.equal(recap.awayMs, 0);
  assert.equal(recap.firstVisit, true);
  assert.deepEqual(recap.finished, []);
  assert.deepEqual(recap.started, []);
  assert.deepEqual(recap.working.map((i) => i.id), ['claude:1']);
  assert.deepEqual(recap.needsYou.map((i) => i.id), ['codex:2']);
  assert.equal(recap.quiet, false);
  assert.deepEqual(Object.keys(recap.working[0]).sort(), ['agent', 'count', 'id', 'project', 'title']);
  assert.equal(recap.working[0].count, 0);

  const allDone = buildRecap([session({ completions: [NOW - MIN] })], null, NOW);
  assert.equal(allDone.quiet, true);
  for (const junk of [undefined, 0, -1, NaN, 'x']) assert.equal(buildRecap([], junk, NOW).firstVisit, true);
});

test('buildRecap counts completions strictly after lastSeenAt', () => {
  const seen = NOW - 3 * HOUR;
  const sessions = [
    session({ id: 'claude:a', completions: [seen - HOUR, seen, seen + MIN, seen + 2 * MIN] }),
    session({ id: 'claude:b', completions: [seen - 2 * HOUR, seen - MIN] }),
    session({ id: 'codex:c', agent: 'codex', completions: [seen + HOUR], title: 'Fix portfolio build', project: 'portfolio' }),
  ];
  const recap = buildRecap(sessions, seen, NOW);
  assert.equal(recap.awayMs, 3 * HOUR);
  assert.equal(recap.firstVisit, false);
  assert.deepEqual(recap.finished, [
    { id: 'codex:c', agent: 'codex', title: 'Fix portfolio build', project: 'portfolio', count: 1 },
    { id: 'claude:a', agent: 'claude', title: 'Habitack development', project: 'Habitack', count: 2 },
  ]);
  assert.equal(recap.quiet, false);
});

test('buildRecap: started, working, needs-you, archived and ordering', () => {
  const seen = NOW - HOUR;
  const sessions = [
    session({ id: 's:equal', startedAt: seen }),
    session({ id: 's:new', startedAt: seen + MIN, status: 'stopped' }),
    session({ id: 's:newer', startedAt: seen + 2 * MIN, status: 'stopped' }),
    session({ id: 'w:old', status: 'working', lastActivityAt: NOW - 10 * MIN }),
    session({ id: 'w:fresh', status: 'working', lastActivityAt: NOW - MIN }),
    session({ id: 'w:archived', status: 'working', archived: true }),
    session({ id: 'n:1', status: 'needs-you' }),
    session({ id: 'w:fresh', status: 'done', title: 'duplicate id is ignored' }),
  ];
  const recap = buildRecap(sessions, seen, NOW);
  assert.deepEqual(recap.started.map((i) => i.id), ['s:newer', 's:new']);
  assert.deepEqual(recap.working.map((i) => i.id), ['w:fresh', 'w:old']);
  assert.deepEqual(recap.needsYou.map((i) => i.id), ['n:1']);
  assert.equal(buildRecap([], NOW + HOUR, NOW).awayMs, 0, 'lastSeenAt in the future is not negative time away');
});

test('buildRecap tolerates junk sessions', () => {
  for (const junk of [null, undefined, 'x', 7, {}, [null, 1, 'x', {}, { id: '' }, { id: 5 }]]) {
    const recap = buildRecap(junk, NOW - HOUR, NOW);
    assert.equal(recap.quiet, true, JSON.stringify(junk));
    assert.deepEqual(recap.finished, []);
  }
  const odd = buildRecap([{ id: 'x', completions: ['a', NOW - MIN, null], status: 'working', title: '  \n ' }], NOW - HOUR, NOW);
  assert.equal(odd.finished[0].count, 1);
  assert.equal(odd.finished[0].title, 'Untitled session');
  assert.equal(odd.working[0].agent, '');
  assert.equal(buildRecap({ sessions: [session({ status: 'working' })] }, null, NOW).working.length, 1, 'accepts a Snapshot');
});

test('greeting title follows the hour on the first greeting of the day', () => {
  const recap = buildRecap([], NOW - HOUR, NOW);
  const cases = [
    [0, 'Hi, Chris'], [4, 'Hi, Chris'], [5, 'Good morning, Chris'], [11, 'Good morning, Chris'],
    [12, 'Good afternoon, Chris'], [16, 'Good afternoon, Chris'], [17, 'Good evening, Chris'],
    [21, 'Good evening, Chris'], [22, 'Hi, Chris'], [23, 'Hi, Chris'],
  ];
  for (const [hour, title] of cases) {
    assert.equal(greeting(recap, { now: at(hour, 30), firstToday: true }).title, title, `hour ${hour}`);
  }
  assert.equal(greeting(recap, { now: at(11, 59), firstToday: true }).title, 'Good morning, Chris');
  assert.equal(greeting(recap, { name: 'Sam', now: at(8), firstToday: true }).title, 'Good morning, Sam');
  assert.equal(greeting(recap, { name: '   ', now: at(8), firstToday: true }).title, 'Good morning, Chris');
});

test('greeting title after the first greeting depends on time away', () => {
  const g = (away) => greeting(buildRecap([], NOW - away, NOW), { now: NOW }).title;
  assert.equal(g(AWAY_THRESHOLD_MS), 'Welcome back');
  assert.equal(g(3 * HOUR), 'Welcome back');
  assert.equal(g(AWAY_THRESHOLD_MS - 1), 'Here with you');
  assert.equal(g(MIN), 'Here with you');
  assert.equal(greeting(buildRecap([], NOW - 3 * HOUR, NOW), { now: at(8), firstToday: false }).title, 'Welcome back');
});

test('greeting lines summarize by agent with the contract wording', () => {
  const seen = NOW - 2 * HOUR;
  const sessions = [
    session({ id: 'claude:1', completions: [seen + MIN, seen + 2 * MIN] }),
    session({ id: 'claude:2', title: 'Notes cleanup', completions: [seen + 3 * MIN] }),
    session({ id: 'codex:1', agent: 'codex', title: 'Fix portfolio build', completions: [seen + HOUR] }),
    session({ id: 'claude:3', status: 'working', startedAt: seen - HOUR }),
    session({ id: 'codex:2', agent: 'codex', title: 'Tidy imports', status: 'needs-you' }),
  ];
  const out = greeting(buildRecap(sessions, seen, NOW), { now: NOW });
  assert.equal(out.title, 'Welcome back');
  assert.equal(out.hasNews, true);
  assert.deepEqual(out.lines, [
    'Claude finished 3 tasks.',
    `Codex finished ${q('Fix portfolio build')}.`,
    `Claude is still working on ${q('Habitack development')}.`,
    `Codex is waiting on you in ${q('Tidy imports')}.`,
  ]);
  out.lines.forEach((line, i) => assertCalm(line, `line ${i}`));
});

test('greeting lines: single-session counts, started, first visit, many sessions', () => {
  const seen = NOW - 2 * HOUR;
  const lines = (sessions, lastSeen = seen) => greeting(buildRecap(sessions, lastSeen, NOW), { now: NOW }).lines;
  assert.deepEqual(lines([session({ completions: [seen + 1, seen + 2] })]), [`Claude finished 2 tasks in ${q('Habitack development')}.`]);
  assert.deepEqual(lines([session({ agent: 'codex', status: 'working', startedAt: seen + MIN, title: 'New thing' })]),
    [`Codex started ${q('New thing')} and is still on it.`]);
  assert.deepEqual(lines([session({ agent: 'codex', status: 'stopped', startedAt: seen + MIN, title: 'New thing' })]),
    [`Codex started ${q('New thing')}.`]);
  assert.deepEqual(lines([
    session({ id: 'a', agent: 'codex', status: 'stopped', startedAt: seen + MIN }),
    session({ id: 'b', agent: 'codex', status: 'stopped', startedAt: seen + 2 * MIN }),
  ]), ['Codex started 2 sessions.']);
  assert.deepEqual(lines([session({ status: 'working' })], null), [`Claude is working on ${q('Habitack development')}.`]);
  assert.deepEqual(lines([session({ id: 'a', status: 'working' }), session({ id: 'b', status: 'working' })]), ['Claude is still working in 2 sessions.']);
  assert.deepEqual(lines([session({ id: 'a', status: 'working' }), session({ id: 'b', status: 'working' })], null), ['Claude is working in 2 sessions.']);
  assert.deepEqual(lines([session({ id: 'a', status: 'needs-you' }), session({ id: 'b', status: 'needs-you' })]), ['Claude is waiting on you in 2 sessions.']);
  assert.deepEqual(lines([session({ agent: 'jev', status: 'working', startedAt: seen - HOUR })]), [`Jev is still working on ${q('Habitack development')}.`]);
  assert.deepEqual(lines([session({ agent: '', status: 'needs-you' })]), [`An agent is waiting on you in ${q('Habitack development')}.`]);
});

test('greeting when nothing happened', () => {
  const quietAway = greeting(buildRecap([session()], NOW - HOUR, NOW), { now: NOW });
  assert.deepEqual(quietAway, { title: 'Welcome back', lines: ['All quiet while you were away.'], hasNews: false });
  const quietShort = greeting(buildRecap([session()], NOW - MIN, NOW), { now: NOW });
  assert.deepEqual(quietShort, { title: 'Here with you', lines: ['Nothing new since you last looked.'], hasNews: false });
  const first = greeting(buildRecap([], null, NOW), { now: at(9), firstToday: true });
  assert.deepEqual(first, { title: 'Good morning, Chris', lines: ['I\u2019m keeping watch over your crew.'], hasNews: false });
  [...quietAway.lines, ...quietShort.lines, ...first.lines, first.title].forEach((t) => assertCalm(t));
});

test('greeting keeps at most four lines, what needs Chris first', () => {
  const seen = NOW - 2 * HOUR;
  const sessions = [
    session({ id: 'c1', completions: [seen + 1] }),
    session({ id: 'x1', agent: 'codex', completions: [seen + 1] }),
    session({ id: 'c2', status: 'working', startedAt: seen - HOUR }),
    session({ id: 'x2', agent: 'codex', status: 'working', startedAt: seen - HOUR }),
    session({ id: 'x3', agent: 'codex', status: 'needs-you', title: 'Waiting one' }),
    session({ id: 'j1', agent: 'jev', status: 'stopped', startedAt: seen + 5 }),
  ];
  const out = greeting(buildRecap(sessions, seen, NOW), { now: NOW });
  assert.equal(out.lines.length, 4);
  assert.equal(out.lines[3], 'There\u2019s more in the watchtower.');
  assert.ok(out.lines.includes(`Codex is waiting on you in ${q('Waiting one')}.`));
  assert.ok(out.lines.includes(`Claude finished ${q('Habitack development')}.`));
  out.lines.forEach((line) => assertCalm(line));
});

test('greeting lines stay within 90 characters with long titles', () => {
  const long = 'An extremely long session title that goes on and on about the Habitack quest board rework';
  const seen = NOW - HOUR;
  const sessions = [
    session({ id: 'a', title: long, completions: [seen + 1, seen + 2] }),
    session({ id: 'b', agent: 'codex', title: long, status: 'working', startedAt: seen + 1 }),
    session({ id: 'c', agent: 'averyveryverylongagentname-with-extra', title: long, status: 'needs-you' }),
  ];
  const out = greeting(buildRecap(sessions, seen, NOW), { now: NOW });
  assert.equal(out.lines.length, 3);
  for (const line of out.lines) {
    assert.ok(line.length <= 90, `${line.length}: ${line}`);
    assert.ok(line.includes('\u2026'), 'long titles are shortened with an ellipsis');
    assert.ok(line.includes(OPEN) && line.includes(CLOSE));
  }
});

test('greeting never throws on junk', () => {
  for (const recap of [null, undefined, 'x', 5, {}, { finished: 'x', working: [null, 3], awayMs: 'long' }]) {
    for (const opts of [undefined, null, 'x', { now: 'x', name: 42 }]) {
      const out = greeting(recap, opts);
      assert.equal(typeof out.title, 'string');
      assert.ok(Array.isArray(out.lines) && out.lines.length >= 1 && out.lines.length <= 4);
      assert.equal(typeof out.hasNews, 'boolean');
    }
  }
});

test('agentName gives calm display names', () => {
  assert.equal(agentName('claude'), 'Claude');
  assert.equal(agentName('CODEX'), 'Codex');
  assert.equal(agentName('whisper'), 'Whisper');
  assert.equal(agentName(''), 'An agent');
  assert.equal(agentName(null), 'An agent');
});

/* ------------------------------------------------------------- diffSnapshots */

test('diffSnapshots needs a previous scan', () => {
  const next = [session({ status: 'working' })];
  assert.deepEqual(diffSnapshots(null, next), []);
  assert.deepEqual(diffSnapshots(undefined, next), []);
  assert.deepEqual(diffSnapshots('x', next), []);
  assert.deepEqual(diffSnapshots([], []), []);
  assert.deepEqual(diffSnapshots([session()], null), []);
});

test('diffSnapshots: finished via a new completion', () => {
  const prev = [session({ completions: [NOW - HOUR], status: 'done' })];
  const next = [session({ completions: [NOW - HOUR, NOW - MIN], status: 'done' })];
  const events = diffSnapshots(prev, next);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'finished');
  assert.equal(events[0].session, next[0]);
  assert.deepEqual(diffSnapshots(prev, prev.map((s) => ({ ...s }))), [], 'no change, no event');
  assert.deepEqual(diffSnapshots([session({ completions: [NOW - MIN] })], [session({ completions: [NOW - HOUR] })]), [], 'older list is not a finish');
  assert.deepEqual(diffSnapshots([session({ completions: [] })], [session({ completions: [NOW - MIN] })]).map((e) => e.type), ['finished']);
});

test('diffSnapshots: finished via working -> done, reported once', () => {
  const prev = [session({ status: 'working', completions: [NOW - HOUR] })];
  assert.deepEqual(diffSnapshots(prev, [session({ status: 'done', completions: [NOW - HOUR] })]).map((e) => e.type), ['finished']);
  assert.deepEqual(diffSnapshots(prev, [session({ status: 'done', completions: [NOW - HOUR, NOW] })]).map((e) => e.type), ['finished']);
  assert.deepEqual(diffSnapshots(prev, [session({ status: 'stopped', completions: [NOW - HOUR] })]), [], 'stopping is not finishing');
  assert.deepEqual(diffSnapshots([session({ status: 'stopped' })], [session({ status: 'done' })]), [], 'only working -> done counts');
});

test('diffSnapshots: needs-you when the status changes to it', () => {
  const next = [session({ status: 'needs-you' })];
  assert.deepEqual(diffSnapshots([session({ status: 'working' })], next).map((e) => e.type), ['needs-you']);
  assert.deepEqual(diffSnapshots([session({ status: 'done' })], next).map((e) => e.type), ['needs-you']);
  assert.deepEqual(diffSnapshots(next, next), [], 'still waiting is not new');
  assert.deepEqual(diffSnapshots([session({ id: 'other' })], [session({ id: 'new', status: 'needs-you' })]).map((e) => e.type), ['needs-you']);
});

test('diffSnapshots: started for a new working session only', () => {
  const prev = [session({ id: 'claude:old', lastActivityAt: NOW - MIN })];
  const events = diffSnapshots(prev, [
    ...prev,
    session({ id: 'codex:new', agent: 'codex', status: 'working', completions: [] }),
    session({ id: 'claude:done-long-ago', status: 'done', completions: [NOW - 5 * HOUR], lastActivityAt: NOW - 5 * HOUR }),
    session({ id: 'claude:stopped', status: 'stopped' }),
  ]);
  assert.deepEqual(events.map((e) => [e.type, e.session.id]), [['started', 'codex:new']]);
  assert.deepEqual(diffSnapshots([session({ status: 'done' })], [session({ status: 'working' })]), [], 'a known session resuming is not a start');
});

test('diffSnapshots: a new session that already finished after the last scan', () => {
  const prev = [session({ id: 'claude:old', lastActivityAt: NOW - 30 * 1000, completions: [NOW - HOUR] })];
  const quick = session({ id: 'codex:quick', agent: 'codex', status: 'done', completions: [NOW - 5 * 1000], lastActivityAt: NOW - 5 * 1000 });
  assert.deepEqual(diffSnapshots(prev, [...prev, quick]).map((e) => [e.type, e.session.id]), [['finished', 'codex:quick']]);
  assert.deepEqual(diffSnapshots([], [quick]), [], 'an empty previous scan has no horizon to compare against');
});

test('diffSnapshots tolerates junk and snapshot objects', () => {
  const prev = { scannedAt: NOW - 10000, sessions: [session({ status: 'working' })] };
  const next = { scannedAt: NOW, sessions: [null, 3, { id: '' }, session({ status: 'done' }), session({ status: 'needs-you', title: 'dup' })] };
  assert.deepEqual(diffSnapshots(prev, next).map((e) => e.type), ['finished']);
  assert.doesNotThrow(() => diffSnapshots([{ id: 'a', completions: 'x' }], [{ id: 'a', completions: [1, 'y'] }]));
});

test('diffSnapshots: one finished turn is one alert when its two signals land in different scans', () => {
  // Claude's registry flips busy -> idle and the transcript gets its end_turn at different times.
  const scan = (status, completions, lastActivityAt) => [session({ status, completions, lastActivityAt, live: true })];
  const types = (list) => list.map((event) => event.type);
  const turnEnd = NOW - 4 * MIN;

  // end_turn first (registry still busy), idle ten minutes later: one alert, at the idle flip.
  const busy = scan('working', [], NOW - 5 * MIN);
  const endTurnWhileBusy = scan('working', [turnEnd], turnEnd);
  const idle = scan('done', [turnEnd], NOW + 6 * MIN);
  assert.deepEqual(types(diffSnapshots(busy, endTurnWhileBusy, NOW)), [], 'still working: wait for the finish');
  assert.deepEqual(types(diffSnapshots(endTurnWhileBusy, idle, NOW + 7 * MIN)), ['finished']);

  // idle first, end_turn read a scan later: one alert, at the idle flip.
  const idleFirst = scan('done', [], turnEnd + 2000);
  assert.deepEqual(types(diffSnapshots(busy, idleFirst, NOW)), ['finished']);
  assert.deepEqual(types(diffSnapshots(idleFirst, scan('done', [turnEnd], turnEnd + 2000), NOW)), [], 'the late record of the same turn');

  // A whole new turn between two scans of an idle session is a new finish.
  assert.deepEqual(types(diffSnapshots(idle, scan('done', [turnEnd, NOW + 9 * MIN], NOW + 9 * MIN), NOW + 10 * MIN)), ['finished']);

  // Two turns in a row, each with end_turn before idle: two alerts, one per turn.
  const second = NOW + 20 * MIN;
  const steps = [busy, endTurnWhileBusy, idle, scan('working', [turnEnd], second - MIN), scan('working', [turnEnd, second], second), scan('done', [turnEnd, second], second + MIN)];
  const alerts = steps.slice(1).flatMap((step, i) => diffSnapshots(steps[i], step, second + 2 * MIN)).filter((event) => event.type === 'finished');
  assert.equal(alerts.length, 2);

  // A turn that ends without an end_turn (interrupted) still reports its working -> done.
  assert.deepEqual(types(diffSnapshots(scan('working', [turnEnd], second), scan('done', [turnEnd], second + MIN), second + 2 * MIN)), ['finished']);
});

test('diffSnapshots: a future-dated session (clock skew) does not hide new finishes', () => {
  const skewed = session({ id: 'claude:skewed', lastActivityAt: NOW + 2 * HOUR, completions: [NOW + 2 * HOUR] });
  const quick = session({ id: 'codex:quick', agent: 'codex', status: 'done', completions: [NOW - 5 * 1000], lastActivityAt: NOW - 5 * 1000 });
  const prev = [skewed, session({ id: 'claude:old', lastActivityAt: NOW - 30 * 1000 })];
  assert.deepEqual(diffSnapshots(prev, [...prev, quick], NOW).map((e) => [e.type, e.session.id]), [['finished', 'codex:quick']]);
});

test('truncating titles never leaves half an emoji behind', () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (const prefix of ['', 'a', 'ab', 'Garden planner ', 'Garden planner  x']) {
    const title = `${prefix}${'\u{1F331}'.repeat(40)}`.slice(0, 80);
    const clean = /[\uD800-\uDBFF]$/.test(title) ? title.slice(0, -1) : title;
    const sessions = [
      session({ id: 'claude:w', title: clean, status: 'working', startedAt: NOW - MIN }),
      session({ id: 'codex:f', agent: 'codex', title: clean, completions: [NOW - MIN] }),
    ];
    const out = greeting(buildRecap(sessions, NOW - HOUR, NOW), { now: NOW });
    for (const line of out.lines) assert.ok(!lone.test(line), `greeting line keeps whole characters: ${JSON.stringify(line)}`);
    for (const type of ['finished', 'needs-you', 'started']) {
      const text = alertText({ type, session: sessions[0] });
      assert.ok(!lone.test(text.body), `${type} alert keeps whole characters`);
    }
  }
  assert.equal(truncate('\u{1F331}\u{1F331}', 1), '…');
  assert.equal(truncate('\u{1F331}\u{1F331}\u{1F331}', 4), '\u{1F331}…');
  assert.equal(truncate('plain words here', 8), 'plain w…');
});

/* ----------------------------------------------------------------- alertText */

test('alertText uses calm one-liners with curly-quoted titles', () => {
  assert.deepEqual(alertText({ type: 'finished', session: session() }),
    { title: 'Claude finished a task', body: `${q('Habitack development')} is ready for you.` });
  assert.deepEqual(alertText({ type: 'needs-you', session: session({ agent: 'codex', title: 'Fix portfolio build' }) }),
    { title: 'Codex is waiting on you', body: `${q('Fix portfolio build')} needs you to keep going.` });
  assert.deepEqual(alertText({ type: 'started', session: session({ agent: 'codex', title: 'Fix portfolio build' }) }),
    { title: 'Codex started a task', body: `${q('Fix portfolio build')} is underway.` });
  for (const type of ['finished', 'needs-you', 'started']) {
    const { title, body } = alertText({ type, session: session() });
    assertCalm(title, `${type} title`);
    assertCalm(body, `${type} body`);
    assert.ok(!title.endsWith('.'), 'titles have no trailing period');
    assert.ok(body.endsWith('.'));
  }
});

test('alertText handles long titles and junk events', () => {
  const long = alertText({ type: 'finished', session: session({ title: 'x'.repeat(200) }) });
  assert.ok(long.body.length < 90);
  assert.ok(long.body.includes('\u2026'));
  for (const junk of [null, undefined, 'x', {}, { type: 'exploded' }, { type: 'finished' }, { type: 'finished', session: 'x' }]) {
    const out = alertText(junk);
    assertCalm(out.title);
    assertCalm(out.body);
  }
  assert.deepEqual(alertText({ type: 'finished' }), { title: 'An agent finished a task', body: `${q('Untitled session')} is ready for you.` });
  assert.deepEqual(alertText(null), { title: 'Milo has an update', body: 'Take a look when you\u2019re ready.' });
});

test('diffSnapshots events feed alertText end to end', () => {
  const prev = [session({ status: 'working' })];
  const next = [session({ status: 'done', completions: [NOW] })];
  const [event] = diffSnapshots(prev, next);
  assert.deepEqual(alertText(event), { title: 'Claude finished a task', body: `${q('Habitack development')} is ready for you.` });
});

/* ---------------------------------------------------------------- skills.js */

test('SKILLS lists the six skills: watchkeeping at the watchtower, the rest at camp', () => {
  // Step 2: plots belong to Chris's buildings, so skills no longer live at them.
  assert.deepEqual(SKILLS.map((s) => [s.id, s.place]), [
    ['watchkeeping', 'watchtower'], ['dispatch', 'camp'], ['timekeeping', 'camp'],
    ['lore', 'camp'], ['voice', 'camp'], ['tinkering', 'camp'],
  ]);
  const titles = Object.fromEntries(SKILLS.map((s) => [s.id, s.levels.map((l) => l.title)]));
  assert.deepEqual(titles, {
    watchkeeping: ['Reads your agent sessions', 'Live status and task alerts', 'Watches GitHub PRs and CI', 'Notices an agent stuck in a loop'],
    dispatch: ['Sends one task to the crew', 'Runs agents side by side', 'Second agent reviews the first', 'Chains research, build, test'],
    timekeeping: ['Reads your calendar', 'Deadline warnings', 'Agent runs on a timetable', 'Morning briefing'],
    lore: ['Remembers decisions per project', 'Recall across projects'],
    voice: ['Push to talk', 'Spoken briefings'],
    tinkering: ['Designs a building from your idea', 'Scaffolds its project folder', 'Builds level 1 with the crew'],
  });
  for (const skill of SKILLS) {
    assertCalm(skill.name, `${skill.id} name`);
    assertCalm(skill.summary, `${skill.id} summary`);
    skill.levels.forEach((l, i) => {
      assert.equal(l.level, i + 1, `${skill.id} levels are 1..n in order`);
      assertCalm(l.title, `${skill.id} L${l.level} title`);
      assertCalm(l.proof, `${skill.id} L${l.level} proof`);
    });
  }
  assert.ok(Object.isFrozen(SKILLS) && Object.isFrozen(SKILLS[0].levels[0]), 'skill data is read-only');
  assert.equal(skillForPlace('watchtower').id, 'watchkeeping');
  assert.equal(skillForPlace('camp'), null, 'camp keeps several skills, none of them its own');
  assert.equal(skillForPlace('harbor'), null);
  assert.equal(skillForPlace('plot-rise'), null);
});

const snapshotWith = (sources) => ({ scannedAt: NOW, sessions: [], tools: [], sources });
const src = (ok, live) => ({ ok, path: 'x', count: ok ? 3 : 0, live });

test('evaluateSkills locks everything without proof', () => {
  for (const junk of [null, undefined, 'x', {}, { sources: null }, { sources: [] }, snapshotWith({ claude: null, codex: 5 })]) {
    const result = evaluateSkills(junk);
    assert.deepEqual(Object.keys(result), SKILLS.map((s) => s.id));
    for (const skill of SKILLS) {
      assert.deepEqual(result[skill.id], { level: 0, next: { level: 1, title: skill.levels[0].title }, proven: [] });
    }
  }
  const neither = evaluateSkills(snapshotWith({ claude: src(false, false), codex: src(false, false) }));
  assert.equal(neither.watchkeeping.level, 0);
});

test('evaluateSkills proves watchkeeping L1 from a readable source', () => {
  const result = evaluateSkills(snapshotWith({ claude: src(false, false), codex: src(true, false) }));
  assert.deepEqual(result.watchkeeping, {
    level: 1,
    next: { level: 2, title: 'Live status and task alerts' },
    proven: [{ level: 1, title: 'Reads your agent sessions' }],
  });
});

test('evaluateSkills proves watchkeeping L2 from a live source, in order', () => {
  const result = evaluateSkills(snapshotWith({ claude: src(true, true), codex: src(false, false) }));
  assert.deepEqual(result.watchkeeping, {
    level: 2,
    next: { level: 3, title: 'Watches GitHub PRs and CI' },
    proven: [{ level: 1, title: 'Reads your agent sessions' }, { level: 2, title: 'Live status and task alerts' }],
  });
  for (const id of ['dispatch', 'timekeeping', 'lore', 'voice', 'tinkering']) {
    assert.equal(result[id].level, 0, `${id} stays locked in step 1`);
    assert.deepEqual(result[id].proven, []);
  }
  const liveOnly = evaluateSkills(snapshotWith({ claude: { ok: false, live: true } }));
  assert.equal(liveOnly.watchkeeping.level, 0, 'levels are earned in order');
  const truthyNotTrue = evaluateSkills(snapshotWith({ claude: { ok: 'yes', live: 1 } }));
  assert.equal(truthyNotTrue.watchkeeping.level, 0, 'proofs need real booleans');
});

/* ------------------------------------------------------------ step 2: plots */

const EMBLEM = [
  '............', '..oooooooo..', '.occcccccco.', '.ocrrccuuco.', '.ocrrccuuco.', '.occcccccco.',
  '.oceeeeeeco.', '.oceeeeeeco.', '.occcccccco.', '..oooooooo..', '....o..o....', '...oo..oo...',
];
function blueprint(over = {}) {
  return {
    version: 1,
    name: 'Clip studio',
    tagline: 'Where stream highlights get cut',
    purpose: 'Turns your drawing streams into short clips.',
    style: {
      shape: 'workshop', walls: 'plank', wallColor: 'woodLight', roof: 'gable', roofColor: 'clay', trim: 'cream',
      door: 'arched', windows: 'square', chimney: false, flag: 'blossom', awning: 'none',
    },
    emblem: [...EMBLEM],
    props: [{ kind: 'easel', side: 'left' }, { kind: 'camera', side: 'right' }],
    yard: 'flowers',
    levels: [1, 2, 3, 4, 5].map((n) => ({ level: n, title: `Level ${n} feature`, summary: `What level ${n} does.`, proof: `A check for level ${n} passes.` })),
    ...over,
  };
}
const idea = (over = {}) => ({ id: 'local:clip-studio', title: 'Clip studio', pitch: 'Cuts your drawing streams into clips.', why: 'You stream drawing', source: 'local', ...over });
// A building that has stood since it was built: firstBuiltAt follows builtAt unless given.
const built = (over = {}) => ({ status: 'built', suggestions: [], asked: null, idea: idea(), blueprint: blueprint(), designedBy: 'codex', builtAt: NOW, name: null, firstBuiltAt: over.builtAt ?? NOW, ...over });

test('plot ids and old step 1 ids', () => {
  assert.deepEqual(PLOT_IDS, ['plot-meadow', 'plot-rise', 'plot-birch', 'plot-pond', 'plot-orchard']);
  assert.deepEqual(LEGACY_PLACE_IDS, {
    workshop: 'plot-meadow', 'clip-studio': 'plot-rise', library: 'plot-birch', 'game-table': 'plot-pond', 'building-site': 'plot-orchard',
  });
  assert.equal(canonicalPlaceId('workshop'), 'plot-meadow');
  assert.equal(canonicalPlaceId('camp'), 'camp');
  assert.equal(canonicalPlaceId('constructor'), 'constructor', 'only own keys of the mapping count');
  assert.deepEqual(emptyPlot(), EMPTY_PLOT);
});

test('normalizeState maps old place ids and fills every plot', () => {
  const steps = { workshop: 'plot-meadow', 'clip-studio': 'plot-rise', library: 'plot-birch', 'game-table': 'plot-pond', 'building-site': 'plot-orchard' };
  for (const [old, next] of Object.entries(steps)) assert.equal(normalizeState({ panel: old }, NOW).panel, next, old);
  for (const kept of ['camp', 'watchtower', 'harbor', 'plot-rise']) assert.equal(normalizeState({ panel: kept }, NOW).panel, kept);
  // A step 1 state has no plots at all.
  const step1 = { version: 1, user: { name: 'Chris' }, milo: { name: 'Milo', tile: { x: 3, y: 4 } }, lastSeenAt: NOW - HOUR, lastGreetedDay: null, settings: { motion: true, notifications: true, greeting: true }, skills: {}, panel: 'library' };
  const state = normalizeState(step1, NOW);
  assert.deepEqual(Object.keys(state.plots), PLOT_IDS);
  for (const id of PLOT_IDS) assert.deepEqual(state.plots[id], EMPTY_PLOT, id);
  assert.equal(state.panel, 'plot-birch');
  assert.equal(state.settings.designer, 'auto');
  // Plots saved under an old id move to the new one, unless the new one is also there.
  const moved = normalizeState({ plots: { library: built() } }, NOW);
  assert.equal(moved.plots['plot-birch'].status, 'built');
  assert.ok(!('library' in moved.plots));
  const both = normalizeState({ plots: { 'plot-birch': { status: 'empty', asked: 'kept' }, library: built() } }, NOW);
  assert.equal(both.plots['plot-birch'].asked, 'kept', 'the new id wins');
  // Junk plot maps and entries become empty plots; other valid plot ids are kept, anything else dropped.
  for (const junk of [null, 'x', 5, [], [built()]]) assert.deepEqual(normalizeState({ plots: junk }, NOW).plots, createState().plots);
  const extra = normalizeState({ plots: { 'plot-hill': built(), 'Not a plot': built(), 'plot-rise': 7 } }, NOW);
  assert.equal(extra.plots['plot-hill'].status, 'built');
  assert.ok(!('Not a plot' in extra.plots));
  assert.deepEqual(extra.plots['plot-rise'], EMPTY_PLOT);
});

test('normalizeState: the designer setting', () => {
  for (const designer of ['auto', 'claude', 'codex', 'kit']) assert.equal(normalizeState({ settings: { designer } }).settings.designer, designer);
  for (const junk of ['Codex', 'fake', '', 3, null, true]) assert.equal(normalizeState({ settings: { designer: junk } }).settings.designer, 'auto', String(junk));
});

test('normalizeState: a design interrupted by closing MILO', () => {
  // A first design goes back to empty, keeping the idea so the panel can offer to try again.
  const fresh = normalizeState({ plots: { 'plot-rise': { status: 'designing', idea: idea(), suggestions: [idea()] } } }, NOW).plots['plot-rise'];
  assert.equal(fresh.status, 'empty');
  assert.deepEqual(fresh.idea, idea());
  assert.equal(fresh.blueprint, null);
  assert.deepEqual(fresh.suggestions, [idea()]);
  // A redesign goes back to the building that was already there.
  const redesign = normalizeState({ plots: { 'plot-rise': { ...built(), status: 'designing', name: 'Stream cave' } } }, NOW).plots['plot-rise'];
  assert.equal(redesign.status, 'built');
  assert.equal(redesign.name, 'Stream cave');
  assert.deepEqual(redesign.blueprint, blueprint());
});

test('normalizeState: built plots need a drawable blueprint, and stored blueprints are repaired', () => {
  const ok = normalizeState({ plots: { 'plot-pond': built() } }, NOW).plots['plot-pond'];
  assert.deepEqual(ok, built());
  for (const bad of [null, 'plans', 42, [], {}, { name: '' }, blueprint({ levels: [] })]) {
    const plot = normalizeState({ plots: { 'plot-pond': built({ blueprint: bad }) } }, NOW).plots['plot-pond'];
    assert.equal(plot.status, 'empty', JSON.stringify(bad));
    assert.equal(plot.blueprint, null);
    assert.equal(plot.designedBy, null);
    assert.equal(plot.builtAt, null);
    assert.deepEqual(plot.idea, idea(), 'the idea stays so it can be built again');
  }
  const long = normalizeState({ plots: { 'plot-pond': built({ blueprint: blueprint({ name: 'A very long building name that runs on and on' }) }) } }, NOW).plots['plot-pond'];
  assert.equal(long.status, 'built');
  assert.ok(long.blueprint.name.length <= 28, 'the name is clamped');
  assert.equal(checkBlueprint(blueprint()).name, 'Clip studio');
  assert.equal(checkBlueprint('nope'), null);
  // An empty plot never carries a building.
  const stray = normalizeState({ plots: { 'plot-pond': { status: 'empty', blueprint: blueprint(), designedBy: 'codex', builtAt: NOW, name: 'X' } } }, NOW).plots['plot-pond'];
  assert.deepEqual(stray, EMPTY_PLOT);
});

test('normalizeState: plot fields are cleaned one by one', () => {
  const plot = normalizeState({
    plots: {
      'plot-meadow': built({
        designedBy: 'jev', builtAt: 'yesterday', name: '  Stream   cave  ', asked: 'x'.repeat(300),
        suggestions: [idea(), idea(), { title: '' }, 'x', idea({ id: 'b', title: 'Game table' }), idea({ id: 'c', title: 'Draft room' }), idea({ id: 'd', title: 'Fourth' })],
        idea: { title: 'Clip studio', pitch: 'p'.repeat(200), why: 3, source: 'gemini', id: 'bad id with spaces that is far too long to be a proper id at all, really' },
        note: 'kept',
      }),
    },
  }, NOW).plots['plot-meadow'];
  assert.equal(plot.designedBy, null);
  assert.equal(plot.builtAt, null);
  assert.equal(plot.name, 'Stream cave');
  assert.equal(plot.asked.length, 110);
  assert.deepEqual(plot.suggestions.map((s) => s.title), ['Clip studio', 'Game table', 'Draft room'], 'three at most, no duplicates');
  assert.equal(plot.idea.pitch.length, 110);
  assert.ok(plot.idea.pitch.endsWith('…'));
  assert.equal(plot.idea.why, '');
  assert.equal(plot.idea.source, 'local');
  assert.equal(plot.idea.id, 'idea:clip-studio');
  assert.equal(plot.note, 'kept', 'unknown plot fields stay');
});

test('normalizeState with plots stays idempotent and prototype-safe', () => {
  const input = { panel: 'workshop', settings: { designer: 'codex' }, plots: { 'plot-rise': built({ name: 'Stream cave' }), library: { status: 'designing', idea: idea() } } };
  const state = normalizeState(input, NOW);
  assert.deepEqual(normalizeState(state, NOW), state);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state)), NOW), state);
  const hostile = JSON.parse('{"plots":{"__proto__":{"status":"built"},"plot-rise":{"__proto__":{"polluted":true},"status":"empty"}}}');
  const safe = normalizeState(hostile, NOW);
  assert.equal(Object.getPrototypeOf(safe.plots), Object.prototype);
  assert.ok(!Object.hasOwn(safe.plots, '__proto__'));
  assert.equal(safe.plots['plot-rise'].polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('suggestions and typed ideas are cleaned to the contract shape', () => {
  assert.equal(cleanSuggestion(null), null);
  assert.equal(cleanSuggestion({ title: '   ' }), null);
  const long = cleanSuggestion({ title: 'An enormously long building title here', pitch: 'x'.repeat(300), why: 'y'.repeat(300), source: 'codex' });
  assert.ok(long.title.length <= 28 && long.pitch.length <= 110 && long.why.length <= 110);
  assert.equal(long.source, 'codex');
  assert.deepEqual(cleanSuggestions([idea(), idea({ id: 'x', title: 'clip STUDIO' }), idea({ id: 'y', title: 'Library' })]).map((s) => s.id), ['local:clip-studio', 'y']);
  assert.deepEqual(cleanSuggestions('x'), []);
  const named = ideaFromText('Clip studio: turns my drawing streams into short clips');
  assert.equal(named.title, 'Clip studio');
  assert.equal(named.source, 'local');
  assert.equal(named.why, 'Your own idea');
  const sentence = ideaFromText('  a bakery   that tracks my sourdough starters and reminds me to feed them  ');
  assert.ok(sentence.title.length > 0 && sentence.title.length <= 28);
  assert.ok(sentence.pitch.length <= 110);
  assert.match(sentence.pitch, /sourdough starters/);
  assert.equal(ideaFromText('   '), null);
  assert.equal(ideaFromText(42), null);
});

test('designing a building: start, finish, and the level tree', () => {
  let state = setSuggestions(createState(), 'plot-rise', [idea(), idea({ id: 'b', title: 'Game table' }), idea({ id: 'c', title: 'Draft room' })]);
  const before = state;
  state = startDesign(state, 'plot-rise', idea());
  assert.equal(before.plots['plot-rise'].status, 'empty', 'the state given is left alone');
  assert.equal(plotOf(state, 'plot-rise').status, 'designing');
  assert.deepEqual(plotOf(state, 'plot-rise').idea, idea());
  state = finishDesign(state, 'plot-rise', { blueprint: blueprint(), by: 'codex' }, NOW);
  const plot = plotOf(state, 'plot-rise');
  assert.equal(plot.status, 'built');
  assert.equal(plot.designedBy, 'codex');
  assert.equal(plot.builtAt, NOW);
  assert.equal(plot.name, null);
  assert.equal(plot.blueprint.levels.length, 5);
  assert.equal(buildingName(plot), 'Clip studio');
  assert.deepEqual(builtNames(state), ['Clip studio']);
  assert.deepEqual(normalizeState(state, NOW).plots['plot-rise'], plot, 'a finished design survives a save');
  // Unknown designers read as Milo's kit; unusable plans never build.
  assert.equal(plotOf(finishDesign(startDesign(createState(), 'plot-pond', idea()), 'plot-pond', { blueprint: blueprint(), by: 'gemini' }), 'plot-pond').designedBy, 'kit');
  const smudged = finishDesign(startDesign(createState(), 'plot-pond', idea()), 'plot-pond', { blueprint: { name: 'x' }, by: 'codex' });
  assert.equal(plotOf(smudged, 'plot-pond').status, 'empty');
  assert.deepEqual(plotOf(smudged, 'plot-pond').idea, idea());
});

test('cancelling or failing a design goes back to what was there', () => {
  const empty = stopDesign(startDesign(createState(), 'plot-pond', idea()), 'plot-pond');
  assert.equal(plotOf(empty, 'plot-pond').status, 'empty');
  assert.deepEqual(plotOf(empty, 'plot-pond').idea, idea(), 'a failure keeps the idea for Try again');
  assert.equal(plotOf(stopDesign(startDesign(createState(), 'plot-pond', idea()), 'plot-pond', { keepIdea: false }), 'plot-pond').idea, null);
  // A redesign that is cancelled leaves the building exactly as it was.
  const standing = normalizeState({ plots: { 'plot-pond': built({ name: 'Stream cave' }) } }, NOW);
  const back = stopDesign(startDesign(standing, 'plot-pond', null), 'plot-pond');
  assert.deepEqual(plotOf(back, 'plot-pond'), plotOf(standing, 'plot-pond'));
  // A redesign that lands keeps Chris's own name.
  const redone = finishDesign(startDesign(standing, 'plot-pond', null), 'plot-pond', { blueprint: blueprint({ name: 'Cozy clip studio' }), by: 'claude' }, NOW + HOUR);
  assert.equal(plotOf(redone, 'plot-pond').name, 'Stream cave');
  assert.equal(plotOf(redone, 'plot-pond').blueprint.name, 'Cozy clip studio');
  // A look-only redesign keeps the plan (name, tagline, purpose, level tree) and takes the new look.
  const newLook = blueprint({
    name: 'Cozy clip studio', tagline: 'A new line', purpose: 'Does something else.',
    style: { ...blueprint().style, roofColor: 'lavender' },
    levels: blueprint().levels.map((level) => ({ ...level, title: `New ${level.title}`.slice(0, 50) })),
  });
  const kept = plotOf(finishDesign(startDesign(standing, 'plot-pond', null), 'plot-pond', { blueprint: newLook, by: 'codex' }, NOW + HOUR, { keepPlan: true }), 'plot-pond');
  const old = plotOf(standing, 'plot-pond').blueprint;
  assert.equal(kept.blueprint.style.roofColor, 'lavender', 'the new look');
  assert.deepEqual(kept.blueprint.levels, old.levels, 'the same level tree');
  assert.deepEqual([kept.blueprint.name, kept.blueprint.tagline, kept.blueprint.purpose], [old.name, old.tagline, old.purpose]);
  assert.equal(kept.designedBy, 'codex');
  assert.equal(kept.name, 'Stream cave');
  const rethought = plotOf(finishDesign(startDesign(standing, 'plot-pond', null), 'plot-pond', { blueprint: newLook, by: 'codex' }, NOW + HOUR), 'plot-pond');
  assert.equal(rethought.blueprint.levels[0].title, newLook.levels[0].title, 'rethinking takes the new levels too');
  const firstKeep = plotOf(finishDesign(startDesign(createState(), 'plot-pond', idea()), 'plot-pond', { blueprint: newLook, by: 'codex' }, NOW, { keepPlan: true }), 'plot-pond');
  assert.equal(firstKeep.blueprint.name, 'Cozy clip studio', 'nothing to keep on a first design');
  assert.equal(plotOf(redone, 'plot-pond').designedBy, 'claude');
});

test('renaming and clearing a building', () => {
  let state = normalizeState({ plots: { 'plot-meadow': built(), 'plot-rise': built({ blueprint: blueprint({ name: 'Game table' }) }) } }, NOW);
  state = renamePlot(state, 'plot-meadow', '  Stream   cave ');
  assert.equal(plotOf(state, 'plot-meadow').name, 'Stream cave');
  assert.equal(buildingName(plotOf(state, 'plot-meadow')), 'Stream cave');
  assert.deepEqual(builtNames(state), ['Stream cave', 'Game table']);
  assert.equal(plotOf(renamePlot(state, 'plot-meadow', '   '), 'plot-meadow').name, null, 'an empty name goes back to the blueprint');
  assert.equal(plotOf(renamePlot(state, 'plot-meadow', 'Clip studio'), 'plot-meadow').name, null, 'the blueprint name needs no rename');
  assert.equal(plotOf(renamePlot(state, 'plot-meadow', 'x'.repeat(60)), 'plot-meadow').name.length, 28);
  assert.equal(plotOf(renamePlot(createState(), 'plot-pond', 'Nope'), 'plot-pond').name, null, 'an empty plot has nothing to rename');
  const cleared = clearPlot(state, 'plot-meadow');
  assert.deepEqual(plotOf(cleared, 'plot-meadow'), EMPTY_PLOT);
  assert.equal(plotOf(cleared, 'plot-rise').status, 'built', 'other plots are untouched');
  assert.deepEqual(builtNames(cleared), ['Game table']);
  assert.equal(buildingName(EMPTY_PLOT), '');
  assert.equal(buildingName(null), '');
});

/* ------------------------------------------------------- step 2: skills proofs */

test('Tinkering and Dispatch level 1 are proven by buildings on the plots', () => {
  const snap = snapshotWith({ claude: src(true, true) });
  const at = (plots) => evaluateSkills(snap, normalizeState({ plots }, NOW));
  assert.equal(evaluateSkills(snap).tinkering.level, 0, 'no state, no buildings');
  assert.equal(evaluateSkills(snap, null).dispatch.level, 0);
  assert.equal(at({}).tinkering.level, 0);
  const byCodex = at({ 'plot-rise': built({ designedBy: 'codex' }) });
  assert.deepEqual(byCodex.tinkering, { level: 1, next: { level: 2, title: 'Scaffolds its project folder' }, proven: [{ level: 1, title: 'Designs a building from your idea' }] });
  assert.deepEqual(byCodex.dispatch, { level: 1, next: { level: 2, title: 'Runs agents side by side' }, proven: [{ level: 1, title: 'Sends one task to the crew' }] });
  assert.equal(byCodex.watchkeeping.level, 2, 'the snapshot still proves watchkeeping');
  assert.equal(at({ 'plot-rise': built({ designedBy: 'claude' }) }).dispatch.level, 1);
  const byKit = at({ 'plot-rise': built({ designedBy: 'kit' }) });
  assert.equal(byKit.tinkering.level, 1, 'Milo drew it himself: still a design from an idea');
  assert.equal(byKit.dispatch.level, 0, 'but no task went to the crew');
  // Only standing buildings with a whole level tree count. One being redesigned is still standing
  // (it comes back as it was if the redesign stops), so the camp doesn't flicker to "Not yet".
  const redesigning = evaluateSkills(snap, { plots: { 'plot-rise': { ...built({ designedBy: 'codex' }), status: 'designing' } } });
  assert.equal(redesigning.tinkering.level, 1);
  assert.equal(redesigning.dispatch.level, 1);
  const firstDesign = evaluateSkills(snap, { plots: { 'plot-rise': { ...built(), status: 'designing', blueprint: null } } });
  assert.equal(firstDesign.tinkering.level, 0, 'a first design going up is no building yet');
  const shortTree = evaluateSkills(snap, { plots: { 'plot-rise': built({ blueprint: blueprint({ levels: blueprint().levels.slice(0, 4) }) }) } });
  assert.equal(shortTree.tinkering.level, 0);
  assert.equal(shortTree.dispatch.level, 0);
  assert.equal(hasLevelTree(blueprint()), true);
  for (const bad of [null, {}, blueprint({ emblem: EMBLEM.slice(1) }), blueprint({ name: '' }), blueprint({ levels: blueprint().levels.map((l) => ({ ...l, proof: '' })) })]) {
    assert.equal(hasLevelTree(bad), false);
  }
  for (const junk of [null, 'x', { plots: 'x' }, { plots: { a: null, b: 'x' } }]) {
    assert.doesNotThrow(() => evaluateSkills(snap, junk));
    assert.equal(evaluateSkills(snap, junk).tinkering.level, 0);
  }
});

/* ---------------------------------------------------------- step 2: builtText */

test('builtText announces the building calmly', () => {
  const plot = normalizeState({ plots: { 'plot-rise': built() } }, NOW).plots['plot-rise'];
  assert.deepEqual(builtText(plot, { asked: 'codex', placeName: 'Sunny rise' }), {
    title: 'The Clip studio is built', body: 'Codex drew up the plans for Sunny rise.', says: 'Codex drew up the plans for Sunny rise.',
  });
  assert.deepEqual(builtText({ ...plot, designedBy: 'claude' }), { title: 'The Clip studio is built', body: 'Claude Code drew up the plans.', says: 'Claude Code drew up the plans.' });
  // A desktop note talks about Milo; Milo's own bubble and panel line say it in his voice.
  assert.deepEqual(builtText({ ...plot, designedBy: 'kit' }, { asked: 'codex' }),
    { title: 'The Clip studio is built', body: 'Codex didn’t answer, so Milo drew this one himself.', says: 'Codex didn’t answer, so I drew this one myself.' });
  // The real reason, when the architect gives one.
  const kitPlot = { ...plot, designedBy: 'kit' };
  assert.equal(builtText(kitPlot, { asked: 'codex', fallback: { by: 'codex', code: 'auth' } }).says, 'Codex isn’t signed in, so I drew this one myself.');
  assert.equal(builtText(kitPlot, { asked: 'codex', fallback: { by: 'codex', code: 'invalid' } }).body, 'Codex’s answer was hard to read, so Milo drew this one himself.');
  assert.equal(builtText(kitPlot, { asked: 'claude', fallback: { by: null, code: 'auth' } }).says, 'The crew isn’t signed in, so I drew this one myself.');
  assert.equal(builtText(kitPlot, { asked: 'claude', fallback: { by: null, code: 'missing' } }).says, 'I couldn’t reach the crew, so I drew this one myself.');
  // Automatic mode moved on from Claude Code: say who drew it and why.
  assert.equal(builtText({ ...plot, designedBy: 'codex' }, { asked: 'codex', skipped: ['claude'], placeName: 'Sunny rise' }).body,
    'Claude Code isn’t signed in, so Codex drew up the plans for Sunny rise.');
  // A redesign is a new look, not a new building.
  const redone = builtText({ ...plot, designedBy: 'codex' }, { asked: 'codex', redesign: true, levels: 'kept', placeName: 'Sunny rise' });
  assert.deepEqual(redone, { title: 'The Clip studio has its new look', body: 'Codex drew up the new plans. Its level tree stays as it was.', says: 'Codex drew up the new plans. Its level tree stays as it was.' });
  assert.equal(builtText(kitPlot, { asked: 'kit', redesign: true, levels: 'changed' }).says, 'I drew up the new plans myself. Its level tree changed too.');
  assert.equal(builtText({ ...plot, designedBy: 'kit' }, { asked: 'claude', placeName: 'Sunny rise' }).body, 'Claude Code didn’t answer, so Milo drew this one himself.');
  assert.equal(builtText({ ...plot, designedBy: 'kit' }, { asked: 'kit', placeName: 'Sunny rise' }).body, 'Milo drew up the plans for Sunny rise.');
  assert.equal(builtText({ ...plot, name: 'Stream cave' }).title, 'The Stream cave is built', 'Chris’s own name comes first');
  assert.equal(builtText({ ...plot, name: 'The sorting office' }).title, 'The sorting office is built');
  assert.equal(builtText({ ...plot, name: 'Chris’s draft room' }).title, 'Chris’s draft room is built');
  assert.equal(builtText({ ...plot, name: 'x'.repeat(60) }).title.length, 'The  is built'.length + 28);
  for (const junk of [null, undefined, 'x', {}, { blueprint: 'x' }]) {
    const out = builtText(junk);
    assert.equal(typeof out.title, 'string');
    assert.equal(typeof out.body, 'string');
    assert.ok(!/!/.test(out.title + out.body));
  }
  for (const by of ['claude', 'codex', 'kit']) {
    const { title, body } = builtText({ ...plot, designedBy: by }, { asked: 'codex', placeName: 'the rise' });
    assert.ok(!title.endsWith('.'), 'titles have no trailing period');
    assertCalm(body, `${by} body`);
  }
  assert.equal(designerName('claude'), 'Claude Code');
  assert.equal(designerName('codex'), 'Codex');
  assert.equal(designerName('kit'), 'Milo');
});

/* ------------------------------------------------- Phase 3: the model's new keys */

const DAY_MS = 24 * HOUR;
const on = (d, h = 12, m = 0) => new Date(2026, 8, d, h, m, 0).getTime(); // local time, September 2026

test('Phase 3 migration: a step 2 state gets its tally seeded honestly from the evidence', () => {
  const step2 = {
    lastSeenAt: on(26, 9), lastGreetedDay: '2026-09-26',
    skills: { watchkeeping: { level: 2, provenAt: on(20, 10) }, tinkering: { level: 1, provenAt: on(24, 15) }, dispatch: { level: 1, provenAt: on(20, 18) } },
    plots: { 'plot-rise': built({ builtAt: on(24, 15) }), 'plot-pond': built({ builtAt: on(22, 9) }) },
  };
  const state = normalizeState(step2, NOW);
  assert.equal(state.firstSeenAt, on(20, 10), 'the earliest evidence');
  assert.deepEqual(state.tally, { daysSeen: 4, lastDay: '2026-09-26', sessionsFinished: 0, finishedIds: [], buildingsDesigned: 2 }, 'the 20th, 22nd, 24th and 26th');
  // Seeded once: the next load keeps what the tally says, and today isn't counted twice.
  assert.deepEqual(normalizeState(state, NOW), state);
  markSeen(state, NOW);
  assert.equal(state.tally.daysSeen, 4);
  markSeen(state, NOW + DAY_MS);
  assert.equal(state.tally.daysSeen, 5);
  // Only the greeting day: firstSeenAt is that local midnight.
  const greeted = normalizeState({ lastGreetedDay: '2026-09-21' }, NOW);
  assert.equal(greeted.firstSeenAt, new Date(2026, 8, 21).getTime());
  assert.deepEqual([greeted.tally.daysSeen, greeted.tally.lastDay], [1, '2026-09-21']);
  // Nothing to go on: nothing counted.
  const bare = normalizeState({ settings: {} }, NOW);
  assert.equal(bare.firstSeenAt, null);
  assert.deepEqual(bare.tally, { daysSeen: 0, lastDay: null, sessionsFinished: 0, finishedIds: [], buildingsDesigned: 0 });
  // Evidence from the future (a clock that jumped) is left out.
  const future = normalizeState({ skills: { lore: { level: 1, provenAt: NOW + 3 * DAY_MS } }, lastGreetedDay: '2026-12-01' }, NOW);
  assert.equal(future.firstSeenAt, null);
  assert.equal(future.tally.daysSeen, 0);
});

test('Phase 3 migration: buildings designed come from built plots or Tinkering', () => {
  assert.equal(normalizeState({ skills: { tinkering: { level: 1, provenAt: NOW } } }, NOW).tally.buildingsDesigned, 1, 'Tinkering level 1 proves a design');
  assert.equal(normalizeState({ skills: { tinkering: { level: 0 } } }, NOW).tally.buildingsDesigned, 0);
  assert.equal(normalizeState({ plots: { 'plot-rise': built(), 'plot-pond': built(), 'plot-birch': { status: 'empty' } } }, NOW).tally.buildingsDesigned, 2);
  assert.equal(normalizeState({ plots: { 'plot-rise': { ...built(), status: 'designing', blueprint: null } } }, NOW).tally.buildingsDesigned, 0, 'a first design still going up is no building');
  // A saved tally is never lower than the buildings standing, and never reseeded otherwise.
  const saved = normalizeState({ tally: { daysSeen: 9, lastDay: '2026-09-25', buildingsDesigned: 0 }, plots: { 'plot-rise': built() }, lastSeenAt: NOW }, NOW);
  assert.deepEqual([saved.tally.daysSeen, saved.tally.lastDay, saved.tally.buildingsDesigned], [9, '2026-09-25', 1]);
  assert.equal(normalizeState({ tally: { buildingsDesigned: 5 } }, NOW).tally.buildingsDesigned, 5, 'a cleared building still counts');
});

test('Phase 3: the tally is cleaned field by field', () => {
  const ids = Array.from({ length: 450 }, (_, i) => `claude:s${i}`);
  const tally = normalizeState({ tally: {
    daysSeen: -3, lastDay: '2026-02-31', sessionsFinished: 'lots', buildingsDesigned: 2.9,
    finishedIds: ['claude:a', 'claude:a', 42, '', 'has space', 'x'.repeat(65), ...ids], note: 'kept',
  } }, NOW).tally;
  assert.equal(tally.daysSeen, 0);
  assert.equal(tally.lastDay, null);
  assert.equal(tally.buildingsDesigned, 2);
  assert.equal(tally.finishedIds.length, STATE_LIMITS.finishedIds);
  assert.deepEqual(tally.finishedIds.slice(-2), ['claude:s448', 'claude:s449'], 'the newest are kept');
  assert.equal(tally.sessionsFinished, 400, 'never fewer than the ids it holds');
  assert.equal(tally.note, 'kept');
  const deduped = normalizeState({ tally: { finishedIds: ['claude:a', 'codex:b', 'claude:a'], sessionsFinished: 7 } }, NOW).tally;
  assert.deepEqual(deduped.finishedIds, ['codex:b', 'claude:a'], 'a repeat keeps its newest place');
  assert.equal(deduped.sessionsFinished, 7);
});

test('Phase 3: a last day left far ahead by a wrong clock comes back to today, so days count again', () => {
  const ahead = NOW + 200 * DAY_MS;
  const saved = normalizeState({ lastSeenAt: ahead, tally: { daysSeen: 3, lastDay: dayKey(ahead) } }, NOW);
  assert.equal(saved.lastSeenAt, NOW, 'lastSeenAt is brought back too');
  assert.deepEqual([saved.tally.daysSeen, saved.tally.lastDay], [3, dayKey(NOW)], 'today, so today isn’t counted twice');
  assert.deepEqual(normalizeState(saved, NOW), saved, 'idempotent');
  let state = markSeen(saved, NOW + HOUR);
  assert.equal(state.tally.daysSeen, 3);
  for (let d = 1; d <= 30; d += 1) state = markSeen(state, NOW + d * DAY_MS);
  assert.equal(state.tally.daysSeen, 33, 'a month of real days counts a month');
  // A day ahead is left be: a clock put right around midnight, or a move west, never counts that day twice.
  const nearMidnight = normalizeState({ tally: { daysSeen: 5, lastDay: dayKey(NOW + DAY_MS) } }, NOW);
  assert.equal(nearMidnight.tally.lastDay, dayKey(NOW + DAY_MS));
  assert.equal(markSeen(structuredClone(nearMidnight), NOW).tally.daysSeen, 5);
  assert.equal(markSeen(structuredClone(nearMidnight), NOW + DAY_MS).tally.daysSeen, 5, 'that day was counted already');
  assert.equal(markSeen(structuredClone(nearMidnight), NOW + 2 * DAY_MS).tally.daysSeen, 6);
  // markSeen puts it right itself when the clock moves while MILO is open, without counting.
  const open = { ...createState(NOW), tally: { daysSeen: 2, lastDay: '2027-04-15', sessionsFinished: 0, finishedIds: [], buildingsDesigned: 0 } };
  const before = open.tally;
  const fixed = markSeen(open, NOW);
  assert.deepEqual([fixed.tally.daysSeen, fixed.tally.lastDay], [2, dayKey(NOW)]);
  assert.notEqual(fixed.tally, before, 'a new tally object');
  assert.equal(before.lastDay, '2027-04-15', 'the old one is left alone');
  assert.equal(markSeen(fixed, NOW + DAY_MS).tally.daysSeen, 3);
  // A last day that isn't a day is no day at all: the next look counts.
  assert.equal(markSeen({ ...createState(NOW), tally: { daysSeen: 2, lastDay: 'garbage' } }, NOW).tally.daysSeen, 3);
});

test('Phase 3: firstSeenAt is kept, and never after lastSeenAt or now', () => {
  assert.equal(normalizeState({ firstSeenAt: NOW - 5 * DAY_MS, lastSeenAt: NOW - HOUR }, NOW).firstSeenAt, NOW - 5 * DAY_MS);
  assert.equal(normalizeState({ firstSeenAt: new Date(NOW - DAY_MS).toISOString() }, NOW).firstSeenAt, NOW - DAY_MS);
  assert.equal(normalizeState({ firstSeenAt: NOW - HOUR, lastSeenAt: NOW - 2 * HOUR }, NOW).firstSeenAt, NOW - 2 * HOUR);
  assert.equal(normalizeState({ firstSeenAt: NOW + DAY_MS }, NOW).firstSeenAt, NOW);
  // A stored firstSeenAt wins over later evidence; junk falls back to the evidence.
  assert.equal(normalizeState({ firstSeenAt: NOW - 9 * DAY_MS, skills: { lore: { level: 1, provenAt: NOW - 20 * DAY_MS } }, lastSeenAt: NOW }, NOW).firstSeenAt, NOW - 9 * DAY_MS);
  assert.equal(normalizeState({ firstSeenAt: 'soon', lastSeenAt: NOW - HOUR }, NOW).firstSeenAt, NOW - HOUR);
});

test('tallyFinished counts each session once, after firstSeenAt and not after now', () => {
  const s = (id, completions, over = {}) => session({ id, sessionId: id, completions, ...over });
  const state = normalizeState({ firstSeenAt: NOW - 2 * DAY_MS, lastSeenAt: NOW - HOUR }, NOW);
  const sessions = [
    s('claude:a', [NOW - 3 * DAY_MS, NOW - HOUR]),  // finished after MILO was first seen
    s('claude:b', [NOW - 3 * DAY_MS]),               // only before
    s('codex:c', [NOW + HOUR]),                       // only in the future
    s('codex:d', [NOW - 2 * DAY_MS]),                // exactly at firstSeenAt: not after it
    s('claude:e', [NOW - MIN, NOW - 2 * MIN]),       // two turns: still one session
    s('x'.repeat(70), [NOW - MIN]),                  // an id the tally couldn't keep
    null, 'junk', { id: 7, completions: [NOW] },
  ];
  const before = JSON.stringify(state);
  const next = tallyFinished(state, sessions, NOW);
  assert.equal(JSON.stringify(state), before, 'the state given is left alone');
  assert.deepEqual(next.tally.finishedIds, ['claude:a', 'claude:e']);
  assert.equal(next.tally.sessionsFinished, 2);
  assert.equal(tallyFinished(next, sessions, NOW), next, 'nothing new: the same state back');
  const later = tallyFinished(next, { sessions: [s('claude:a', [NOW + MIN]), s('codex:c', [NOW + HOUR])] }, NOW + 2 * HOUR);
  assert.deepEqual(later.tally.finishedIds, ['claude:a', 'claude:e', 'codex:c'], 'a snapshot works too, and the future arrives');
  assert.equal(later.tally.sessionsFinished, 3);
  // No firstSeenAt yet (the very first launch): nothing earlier than now counts.
  const fresh = createState(NOW);
  assert.equal(tallyFinished(fresh, [s('claude:a', [NOW - MIN, NOW])], NOW), fresh);
  assert.equal(tallyFinished(fresh, [s('claude:a', [NOW + MIN])], NOW + MIN), fresh, 'at now is not after now');
  // The id list keeps the newest 400, while the count keeps going.
  const many = Array.from({ length: 420 }, (_, i) => s(`claude:m${i}`, [NOW - MIN]));
  const full = tallyFinished(state, many, NOW);
  assert.equal(full.tally.finishedIds.length, 400);
  assert.equal(full.tally.sessionsFinished, 420);
  assert.equal(full.tally.finishedIds.at(-1), 'claude:m419');
  assert.equal(normalizeState(full, NOW).tally.sessionsFinished, 420, 'the count survives a save');
  for (const junk of [null, 'x', 5]) assert.doesNotThrow(() => tallyFinished(junk, sessions, NOW));
  assert.equal(tallyFinished(state, null, NOW), state);
});

test('finishDesign counts first designs, not redesigns', () => {
  let state = normalizeState({}, NOW);
  state = finishDesign(startDesign(state, 'plot-rise', idea()), 'plot-rise', { blueprint: blueprint(), by: 'codex' }, NOW);
  assert.equal(state.tally.buildingsDesigned, 1);
  state = finishDesign(startDesign(state, 'plot-rise', null), 'plot-rise', { blueprint: blueprint({ name: 'Cozy clip studio' }), by: 'codex' }, NOW + HOUR);
  assert.equal(state.tally.buildingsDesigned, 1, 'a redesign is the same building');
  state = finishDesign(startDesign(state, 'plot-rise', null), 'plot-rise', { blueprint: blueprint(), by: 'kit' }, NOW + HOUR, { keepPlan: true });
  assert.equal(state.tally.buildingsDesigned, 1);
  const smudged = finishDesign(startDesign(state, 'plot-pond', idea()), 'plot-pond', { blueprint: { name: 'x' }, by: 'codex' }, NOW);
  assert.equal(smudged.tally.buildingsDesigned, 1, 'a design that never lands counts nothing');
  state = finishDesign(startDesign(clearPlot(state, 'plot-rise'), 'plot-rise', idea()), 'plot-rise', { blueprint: blueprint(), by: 'claude' }, NOW);
  assert.equal(state.tally.buildingsDesigned, 2, 'a new building on a cleared plot is a new design');
  assert.equal(normalizeState(state, NOW).tally.buildingsDesigned, 2);
  // A bare state (no tally yet) starts one.
  assert.equal(finishDesign({ plots: {} }, 'plot-pond', { blueprint: blueprint(), by: 'kit' }, NOW).tally.buildingsDesigned, 1);
});

test('firstBuiltAt: set by a first design, kept through redesigns, seeded from builtAt, never after it', () => {
  const plot = (s) => plotOf(s, 'plot-rise');
  const times = (s) => [plot(s).builtAt, plot(s).firstBuiltAt];
  let state = normalizeState({}, NOW);
  assert.equal(plot(state).firstBuiltAt, null, 'an empty plot has none');
  state = finishDesign(startDesign(state, 'plot-rise', idea()), 'plot-rise', { blueprint: blueprint(), by: 'codex' }, NOW);
  assert.deepEqual(times(state), [NOW, NOW], 'a first design sets both');
  state = startDesign(state, 'plot-rise', null);
  assert.equal(plot(state).firstBuiltAt, NOW, 'kept while a new look is drawn up');
  state = finishDesign(state, 'plot-rise', { blueprint: blueprint({ name: 'Cozy clip studio' }), by: 'claude' }, NOW + HOUR);
  assert.deepEqual(times(state), [NOW + HOUR, NOW], 'a redesign moves builtAt only');
  state = finishDesign(startDesign(state, 'plot-rise', null), 'plot-rise', { blueprint: blueprint(), by: 'kit' }, NOW + 2 * HOUR, { keepPlan: true });
  assert.deepEqual(times(state), [NOW + 2 * HOUR, NOW], 'a look-only redesign too');
  assert.deepEqual(times(stopDesign(startDesign(state, 'plot-rise', null), 'plot-rise')), [NOW + 2 * HOUR, NOW], 'a redesign given up changes nothing');
  assert.deepEqual(normalizeState(state, NOW + 3 * HOUR).plots['plot-rise'], plot(state), 'it survives a save');
  // A first design that fails, and a cleared plot, have no building and no first day.
  assert.equal(plotOf(stopDesign(startDesign(createState(), 'plot-pond', idea()), 'plot-pond'), 'plot-pond').firstBuiltAt, null);
  const cleared = clearPlot(state, 'plot-rise');
  assert.equal(plot(cleared).firstBuiltAt, null);
  const rebuilt = finishDesign(startDesign(cleared, 'plot-rise', idea()), 'plot-rise', { blueprint: blueprint(), by: 'codex' }, NOW + DAY_MS);
  assert.deepEqual(times(rebuilt), [NOW + DAY_MS, NOW + DAY_MS], 'a new building on a cleared plot starts again');
  // A building saved before firstBuiltAt existed: builtAt is the best evidence, and a redesign keeps it.
  const legacy = normalizeState({ plots: { 'plot-rise': { ...built({ builtAt: NOW - DAY_MS }), firstBuiltAt: undefined } } }, NOW);
  assert.deepEqual(times(legacy), [NOW - DAY_MS, NOW - DAY_MS]);
  assert.deepEqual(times(finishDesign(startDesign(legacy, 'plot-rise', null), 'plot-rise', { blueprint: blueprint(), by: 'codex' }, NOW)), [NOW, NOW - DAY_MS]);
  const unsaved = { ...createState(), plots: { ...createState().plots, 'plot-rise': { ...built({ builtAt: NOW - DAY_MS }), firstBuiltAt: undefined } } };
  assert.deepEqual(times(finishDesign(startDesign(unsaved, 'plot-rise', null), 'plot-rise', { blueprint: blueprint(), by: 'codex' }, NOW)), [NOW, NOW - DAY_MS], 'even before a save');
  // Cleaned: never after builtAt, junk falls back to builtAt, and only a built plot has one.
  const cleaned = (over) => normalizeState({ plots: { 'plot-rise': built(over) } }, NOW).plots['plot-rise'];
  assert.equal(cleaned({ builtAt: NOW, firstBuiltAt: NOW - DAY_MS }).firstBuiltAt, NOW - DAY_MS);
  assert.equal(cleaned({ builtAt: NOW, firstBuiltAt: NOW + DAY_MS }).firstBuiltAt, NOW, 'never after the current design');
  for (const junk of ['soon', -5, 0, null, {}, NaN]) assert.equal(cleaned({ builtAt: NOW, firstBuiltAt: junk }).firstBuiltAt, NOW, String(junk));
  assert.equal(cleaned({ builtAt: new Date(NOW).toISOString(), firstBuiltAt: String(NOW - HOUR) }).firstBuiltAt, NOW - HOUR, 'times as strings are read');
  assert.equal(normalizeState({ plots: { 'plot-rise': { status: 'empty', firstBuiltAt: NOW } } }, NOW).plots['plot-rise'].firstBuiltAt, null);
  assert.equal(normalizeState({ plots: { 'plot-rise': { status: 'designing', idea: idea(), firstBuiltAt: NOW } } }, NOW).plots['plot-rise'].firstBuiltAt, null, 'a first design still going up');
  assert.equal(normalizeState({ plots: { 'plot-rise': { ...built({ firstBuiltAt: NOW - HOUR }), status: 'designing' } } }, NOW).plots['plot-rise'].firstBuiltAt, NOW - HOUR, 'a redesign interrupted by closing MILO');
  // The first day is evidence Chris had MILO open.
  const evidence = normalizeState({ plots: { 'plot-rise': built({ builtAt: on(24, 15), firstBuiltAt: on(21, 10) }) } }, NOW);
  assert.equal(evidence.firstSeenAt, on(21, 10));
  assert.deepEqual([evidence.tally.daysSeen, evidence.tally.lastDay], [2, '2026-09-24']);
});

test('Phase 3: a rift closed quietly stays in the history, and an open Nocturne keeps its bell', () => {
  const history = [
    { key: 'night:2026-09-25', id: 'rift:n1', name: 'The Late Lamp', genres: ['nocturne'], kind: 'real', openedAt: NOW - HOUR, closedAt: NOW, how: 'closed' },
    { key: 'knock:claude:a', id: 'rift:k1', kind: 'real', closedAt: NOW, how: 'faded' },
  ];
  const open = {
    'night:2026-09-26': { id: 'rift:n2', since: NOW - HOUR, realKind: 'nocturne', bell: ' 7:30 ' },
    'night:2026-09-24': { id: 'rift:n3', since: NOW - DAY_MS, realKind: 'nocturne', bell: '25:00' },
    'night:2026-09-23': { id: 'rift:n4', since: NOW - 2 * DAY_MS, bell: '23:00' },
    'knock:claude:b': { id: 'rift:k2', since: NOW - DAY_MS, realKind: 'knocking', bell: '22:00' },
  };
  const rifts = normalizeState({ rifts: { history, open } }, NOW).rifts;
  assert.deepEqual(rifts.history.map((h) => h.how), ['closed'], 'closed is a way a rift ends; anything else is dropped');
  assert.equal(rifts.open['night:2026-09-26'].bell, '07:30');
  assert.ok(!('bell' in rifts.open['night:2026-09-24']), 'a bell that isn’t a time is dropped');
  assert.equal(rifts.open['night:2026-09-23'].bell, '23:00', 'a Nocturne by its key');
  assert.ok(!('bell' in rifts.open['knock:claude:b']), 'only Nocturnes keep a bell');
  assert.deepEqual(normalizeState({ rifts }, NOW).rifts, rifts, 'idempotent');
});

test('Phase 3: a history entry keeps its episode’s since, and an open rift that stood again keeps its mark', () => {
  const history = [
    { key: 'knock:claude:a', id: 'rift:k1', name: 'x', kind: 'real', closedAt: NOW, how: 'sealed', since: NOW - DAY_MS },
    { key: 'knock:claude:b', id: 'rift:k2', name: 'x', kind: 'real', closedAt: NOW, how: 'sealed', since: 'soon' },
    { key: null, id: 'rift:w1', name: 'x', kind: 'wild', closedAt: NOW, how: 'stitched', since: NOW - HOUR },
  ];
  const open = {
    'knock:claude:c': { id: 'rift:k3', since: NOW - DAY_MS, realKind: 'knocking', resumed: true },
    'knock:claude:d': { id: 'rift:k4', since: NOW - DAY_MS, realKind: 'knocking', resumed: 'yes' },
  };
  const rifts = normalizeState({ rifts: { history, open } }, NOW).rifts;
  assert.deepEqual(rifts.history.map((h) => h.since), [NOW - DAY_MS, undefined, undefined], 'a since is a time, and wild rifts have none');
  assert.equal(rifts.open['knock:claude:c'].resumed, true);
  assert.ok(!('resumed' in rifts.open['knock:claude:d']), 'only true marks it');
  assert.deepEqual(normalizeState({ rifts }, NOW).rifts, rifts, 'idempotent');
});

test('Phase 3: an essence saved with a straight apostrophe joins the curly one riftgen names now', () => {
  const satchel = normalizeState({
    satchel: {
      essences: { 'Sheriff\'s star': 2, 'Sheriff’s star': 3, 'Neon shard': 1 },
      essenceGenres: { 'Sheriff\'s star': 'frontier', 'Neon shard': 'neon' },
    },
  }, NOW).satchel;
  assert.deepEqual(satchel.essences, { 'Sheriff’s star': 5, 'Neon shard': 1 });
  assert.deepEqual(satchel.essenceGenres, { 'Sheriff’s star': 'frontier', 'Neon shard': 'neon' });
  assert.deepEqual(normalizeState({ satchel }, NOW).satchel, satchel, 'idempotent');
  const words = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
  const essences = Object.values(words.genres).flatMap((g) => g.essences);
  assert.ok(essences.includes('Sheriff’s star') && essences.every((name) => !name.includes('\'')), 'riftgen names them with curly apostrophes');
});

test('Phase 3 settings: the evening bell, the Gate Bell and the ward-post', () => {
  for (const [input, want] of [['22:00', '22:00'], ['00:30', '00:30'], [' 7:30 ', '07:30'], ['20:00', '20:00'], ['23:59', '23:59'], [null, null]]) {
    assert.equal(normalizeState({ settings: { eveningBell: input } }, NOW).settings.eveningBell, want, String(input));
  }
  for (const junk of ['24:00', '22:60', '22', '10pm', '', 2200, true, {}, undefined]) {
    assert.equal(normalizeState({ settings: { eveningBell: junk } }, NOW).settings.eveningBell, '22:00', String(junk));
  }
  assert.equal(normalizeState({ settings: {} }, NOW).settings.eveningBell, '22:00', 'missing means the default bell');
  assert.equal(cleanEveningBell('9:05'), '09:05');
  assert.equal(cleanEveningBell('nope', null), null);
  assert.equal(normalizeState({ settings: { gateBell: false } }, NOW).settings.gateBell, false);
  assert.equal(normalizeState({ settings: { gateBell: 'no' } }, NOW).settings.gateBell, true);
  assert.deepEqual(WARD_POSTS, ['nights-off', 'patient-knock', 'capacity-95']);
  for (const post of WARD_POSTS) assert.equal(normalizeState({ settings: { wardPost: post } }, NOW).settings.wardPost, post);
  for (const junk of ['Nights-off', 'someday', 3, {}, true]) assert.equal(normalizeState({ settings: { wardPost: junk } }, NOW).settings.wardPost, null, String(junk));
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS) && Object.isFrozen(WARD_POSTS));
});

test('Phase 3: the hearth, satchel and story are cleaned', () => {
  const state = normalizeState({
    hearth: { tier: 9.5, raisedAt: { stockade: NOW - HOUR, 'Bad Id': NOW, hold: 'x' }, banner: 'kept' },
    satchel: {
      materials: { birch: 12.7, ash: -4, stone: 3, 'Not ok': 2 },
      essences: { 'Neon shard': 3, 'Grave wax': 0, '': 2, ' padded ': 1, ['x'.repeat(61)]: 1 },
      essenceGenres: { 'Neon shard': 'neon', 'Grave wax': 'gothic', 'Chrome scrap': 'neon', ' padded ': 'noir' },
      relics: [{ name: 'Brass lamp of Kiro', text: 'Once belonged to Kiro.', genre: 'neon', at: NOW }, { name: '' }, 'x', { name: 'Odd', genre: 'NOT A GENRE', at: 'x' }],
    },
    story: { prologue: { done: { light: NOW - DAY_MS, crew: 'x', 'Bad Id': NOW }, extra: 1 }, letterReadAt: NOW - HOUR, trackerHidden: 'yes', chapterTwo: { a: 1 } },
  }, NOW);
  assert.deepEqual(state.hearth, { tier: 8, raisedAt: { stockade: NOW - HOUR }, banner: 'kept' });
  assert.equal(normalizeState({ hearth: { tier: 0 } }, NOW).hearth.tier, 1);
  assert.equal(normalizeState({ hearth: { tier: 'two' } }, NOW).hearth.tier, 1);
  assert.equal(normalizeState({ hearth: { tier: 2 } }, NOW).hearth.tier, 2);
  assert.deepEqual(state.satchel.materials, { birch: 12, ash: 0, stone: 3, pine: 0 });
  assert.deepEqual(state.satchel.essences, { 'Neon shard': 3 });
  assert.deepEqual(state.satchel.essenceGenres, { 'Neon shard': 'neon' }, 'a genre is kept only for an essence the satchel holds');
  assert.deepEqual(normalizeState({ satchel: { essences: { 'Neon shard': 1, 'Grave wax': 2 }, essenceGenres: { 'Neon shard': 'NOT OK', 'Grave wax': 7 } } }, NOW).satchel.essenceGenres, {});
  assert.deepEqual(state.satchel.relics, [
    { name: 'Brass lamp of Kiro', text: 'Once belonged to Kiro.', genre: 'neon', at: NOW },
    { name: 'Odd', text: '', genre: null, at: null },
  ]);
  const relics = Array.from({ length: 230 }, (_, i) => ({ name: `Relic ${i}`, text: '', genre: 'noir', at: NOW }));
  const kept = normalizeState({ satchel: { relics } }, NOW).satchel.relics;
  assert.equal(kept.length, STATE_LIMITS.relics);
  assert.equal(kept.at(-1).name, 'Relic 229', 'the newest relics are kept');
  assert.deepEqual(state.story, { prologue: { done: { light: NOW - DAY_MS }, extra: 1 }, letterReadAt: NOW - HOUR, trackerHidden: false, chapterTwo: { a: 1 } });
  assert.equal(normalizeState({ story: { trackerHidden: true } }, NOW).story.trackerHidden, true);
});

test('Phase 3: the wilds keep signed tiles, capped lists and today’s stumps', () => {
  const today = dayNumber(NOW);
  const explored = [...Array.from({ length: 20050 }, (_, i) => `${i},-${i % 7}`), '3,-3', 'bad', '1,2,3', '9999999,0'];
  const wilds = normalizeState({ wilds: {
    seed: 'another story', at: { x: -332.4, y: 40.6 }, wake: 'lantern:-12,40', explored,
    lanterns: { 'lantern:-12,40': NOW - HOUR, 'lantern:x': NOW, 'poi:ruin:1,2': NOW },
    opened: { 'poi:chest:-40,-8': NOW, 'poi:ruin:1,2': 'nope', 'tree:1,2': NOW },
    notes: { 'poi:note:5,5': NOW - DAY_MS }, glimmers: { 'poi:statue:30,-60': NOW },
    felled: { 'tree:-3,-9': today, 'tree:4,4': today - 1, 'tree:5,5': today + 1, 'poi:ruin:1,2': today, 'tree:6,6': 'today' },
    mount: 'kept',
  } }, NOW).wilds;
  assert.equal(wilds.seed, 'another story');
  assert.deepEqual(wilds.at, { x: -332, y: 41 });
  assert.equal(wilds.wake, 'lantern:-12,40');
  assert.equal(wilds.explored.length, STATE_LIMITS.explored);
  assert.equal(wilds.explored.at(-1), '3,-3', 'the newest chunk is kept');
  assert.ok(!wilds.explored.includes('0,-0') && !wilds.explored.includes('1,-1'), 'the oldest are dropped');
  assert.ok(wilds.explored.every((key) => /^-?\d+,-?\d+$/.test(key)));
  assert.equal(new Set(wilds.explored).size, wilds.explored.length, 'no repeats');
  assert.deepEqual(wilds.lanterns, { 'lantern:-12,40': NOW - HOUR });
  assert.deepEqual(wilds.opened, { 'poi:chest:-40,-8': NOW });
  assert.deepEqual(wilds.notes, { 'poi:note:5,5': NOW - DAY_MS });
  assert.deepEqual(wilds.glimmers, { 'poi:statue:30,-60': NOW });
  assert.deepEqual(wilds.felled, { 'tree:-3,-9': today, 'tree:5,5': today + 1 }, 'yesterday’s stump has grown back');
  assert.equal(wilds.mount, 'kept');
  for (const at of [{ x: 1e6 + 1, y: 0 }, { x: 0 }, { x: '1', y: 2 }, [1, 2], 'x', { x: NaN, y: 1 }]) {
    assert.equal(normalizeState({ wilds: { at } }, NOW).wilds.at, null, JSON.stringify(at));
  }
  assert.deepEqual(normalizeState({ wilds: { at: { x: -1e6, y: 1e6 } } }, NOW).wilds.at, { x: -1e6, y: 1e6 });
  for (const seed of ['', '   ', 'x'.repeat(65), 42, null]) assert.equal(normalizeState({ wilds: { seed } }, NOW).wilds.seed, 'hushlands', String(seed));
  for (const wake of ['home', 'lantern:1', 5]) assert.equal(normalizeState({ wilds: { wake } }, NOW).wilds.wake, null);
});

test('Phase 3: rifts in the state are cleaned, pruned and capped', () => {
  const today = dayNumber(NOW);
  const history = Array.from({ length: 130 }, (_, i) => ({ key: `knock:claude:s${i}`, id: `rift:${i.toString(36)}`, name: `Rift ${i}`, genres: ['gothic'], kind: 'real', openedAt: NOW - DAY_MS, closedAt: NOW - i * MIN, how: 'sealed' }));
  const visited = Object.fromEntries(Array.from({ length: 320 }, (_, i) => [`rift:v${i.toString(36)}`, NOW - (320 - i) * MIN]));
  const rifts = normalizeState({ rifts: {
    open: {
      'knock:claude:a': { id: 'rift:abc', since: NOW - 30 * HOUR, openedAt: NOW - HOUR, kind: 'story', realKind: 'knocking', name: 'The Portrait of “Letters”', genres: ['gothic', 'NOPE'], loot: [{ item: 'Grave wax', qty: 2, genre: 'gothic' }, { item: '', qty: 1 }], signals: ['needs-you-unanswered', 'BAD'], urgency: 1.7, cause: 'c'.repeat(200), echo: { place: 'watchtower', icon: 'knocker' }, bright: 'no', sessionId: 'claude:a' },
      'night:2026-09-25': { id: 'rift:n1', since: NOW - DAY_MS, signals: ['working-past-bell'], agents: ['codex', 'Bad Agent', 5, 'codex', 'claude'] },
      'night:2026-09-24': { id: 'rift:n2', since: NOW - 2 * DAY_MS, agents: 'claude' },
      'knock:claude:b': { id: 'not-a-rift', since: NOW },
      'built:plot-rise:1': { id: 'rift:x', since: 'x' },
      'wat:1': { id: 'rift:y', since: NOW },
    },
    warded: { 'knock:claude:a': { since: NOW - 30 * HOUR, until: NOW + DAY_MS, stage: 'open' }, 'night:2026-09-20': { since: NOW - 7 * DAY_MS, until: NOW - 4 * DAY_MS, stage: 'open' }, 'capacity:codex:9': { since: NOW, until: NOW + DAY_MS, stage: 'huge' } },
    letGo: { 'knock:claude:c': { since: NOW - DAY_MS, at: NOW - HOUR }, 'knock:claude:d': { since: NOW } },
    belled: { 'night:2026-09-25': { since: NOW - DAY_MS, at: NOW - DAY_MS } },
    closedWild: { 'rift:aa': today, 'rift:bb': today - 1, nope: today },
    visited,
    stitched: { real: 3.5, wild: -1, story: 'x' },
    deepest: 7,
    history: [...history, { id: 'rift:zz', closedAt: NOW, how: 'vanished' }],
    later: 'kept',
  } }, NOW).rifts;
  assert.deepEqual(Object.keys(rifts.open), ['knock:claude:a', 'night:2026-09-25', 'night:2026-09-24']);
  assert.deepEqual(rifts.open['night:2026-09-25'].agents, ['codex', 'claude'], 'the agents behind a Nocturne, deduped');
  assert.ok(!('agents' in rifts.open['night:2026-09-24']), 'no list, no agents');
  assert.ok(!('agents' in rifts.open['knock:claude:a']));
  const open = rifts.open['knock:claude:a'];
  assert.equal(open.kind, 'real', 'the kind follows the key');
  assert.equal(open.realKind, 'knocking');
  assert.deepEqual(open.genres, ['gothic']);
  assert.deepEqual(open.loot, [{ item: 'Grave wax', qty: 2, genre: 'gothic' }]);
  assert.deepEqual(open.signals, ['needs-you-unanswered']);
  assert.equal(open.urgency, 1);
  assert.equal(open.cause.length, 160);
  assert.equal(open.bright, false);
  assert.equal(open.sessionId, 'claude:a');
  assert.deepEqual(Object.keys(rifts.warded), ['knock:claude:a'], 'a lapsed ward and a bad stage are gone');
  assert.deepEqual(Object.keys(rifts.letGo), ['knock:claude:c']);
  assert.deepEqual(Object.keys(rifts.belled), ['night:2026-09-25']);
  assert.deepEqual(rifts.closedWild, { 'rift:aa': today }, 'wild rifts close with the day');
  assert.equal(Object.keys(rifts.visited).length, STATE_LIMITS.visited);
  assert.ok(!('rift:v0' in rifts.visited), 'the oldest visits are dropped');
  assert.ok(`rift:v${(319).toString(36)}` in rifts.visited, 'the newest visits are kept');
  assert.deepEqual(rifts.stitched, { real: 3, wild: 0, story: 0 });
  assert.equal(rifts.deepest, 7);
  assert.equal(rifts.history.length, STATE_LIMITS.history);
  assert.equal(rifts.history[0].name, 'Rift 0', 'newest first');
  assert.equal(rifts.later, 'kept');
  const wildEntry = normalizeState({ rifts: { history: [{ key: 'knock:x', id: 'rift:w', kind: 'wild', closedAt: NOW, how: 'stitched' }] } }, NOW).rifts.history[0];
  assert.equal(wildEntry.key, null, 'wild rifts have no key');
});

test('Phase 3 normalization is idempotent, prototype-safe and never throws on junk', () => {
  const junk = [null, undefined, 0, 7, 'x', true, [], [1], {}, { a: 1 }, NaN, () => 1];
  for (const key of ['firstSeenAt', 'tally', 'hearth', 'satchel', 'wilds', 'rifts', 'story']) {
    for (const value of junk) {
      const state = normalizeState({ [key]: value }, NOW);
      assert.deepEqual(normalizeState(state, NOW), state, `${key}: ${String(value)}`);
      assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state)), NOW), state);
    }
    for (const inner of ['materials', 'essences', 'essenceGenres', 'relics', 'explored', 'lanterns', 'felled', 'open', 'warded', 'history', 'stitched', 'prologue', 'raisedAt', 'finishedIds', 'at']) {
      for (const value of junk) assert.doesNotThrow(() => normalizeState({ [key]: { [inner]: value } }, NOW), `${key}.${inner}`);
    }
  }
  // A busy state: everything set, twice through, and through JSON.
  let busy = normalizeState({
    lastSeenAt: NOW - HOUR, firstSeenAt: NOW - 9 * DAY_MS, plots: { 'plot-rise': built() },
    tally: { daysSeen: 4, lastDay: '2026-09-26', sessionsFinished: 3, finishedIds: ['claude:a'], buildingsDesigned: 1 },
    hearth: { tier: 2, raisedAt: { stockade: NOW - DAY_MS } },
    satchel: { materials: { birch: 40, ash: 12, pine: 3 }, essences: { 'Neon shard': 2 }, essenceGenres: { 'Neon shard': 'neon' }, relics: [{ name: 'Lamp', text: 't', genre: 'neon', at: NOW }] },
    wilds: { at: { x: -40, y: -8 }, wake: 'lantern:-40,-8', explored: ['0,-1', '-1,-1'], lanterns: { 'lantern:-40,-8': NOW }, felled: { 'tree:-3,-9': dayNumber(NOW) } },
    rifts: { open: { 'story:first-crack': { id: 'rift:s', since: NOW - HOUR, openedAt: NOW - HOUR, kind: 'story', name: 'The north gate: Flicker', genres: ['neon'], loot: [{ item: 'Neon shard', qty: 1, genre: 'neon' }], signals: ['sync-error'], subject: 'the north gate', urgency: 0.2, cause: 'Something.', stitch: 'Step through.', echo: { place: 'camp', icon: 'crack' }, bright: false } }, stitched: { real: 1, wild: 2, story: 0 }, deepest: 3 },
    story: { prologue: { done: { light: NOW - DAY_MS } }, letterReadAt: NOW - HOUR },
  }, NOW);
  busy = markSeen(busy, NOW);
  assert.deepEqual(normalizeState(busy, NOW), busy);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(busy)), NOW), busy);
  // Hostile keys in every new map stay out of every prototype.
  const hostile = JSON.parse(`{
    "tally": {"__proto__": {"polluted": 1}, "finishedIds": ["__proto__"]},
    "hearth": {"__proto__": {"polluted": 1}, "raisedAt": {"__proto__": 5, "constructor": 5}},
    "satchel": {"materials": {"__proto__": 5}, "essences": {"__proto__": 3, "constructor": 2, "prototype": 1, "Neon shard": 1}, "essenceGenres": {"__proto__": "neon", "constructor": "neon", "Neon shard": "neon"}, "relics": [{"__proto__": {"polluted": 1}, "name": "x"}]},
    "wilds": {"lanterns": {"__proto__": 1}, "opened": {"__proto__": 1}, "felled": {"__proto__": 1}, "__proto__": {"polluted": 1}},
    "rifts": {"open": {"__proto__": {"id": "rift:a", "since": 5}}, "warded": {"__proto__": {}}, "letGo": {"__proto__": {}}, "belled": {"__proto__": {}}, "closedWild": {"__proto__": 1}, "visited": {"__proto__": 1}, "stitched": {"__proto__": {"real": 5}}},
    "story": {"prologue": {"done": {"__proto__": 1, "constructor": 1}}, "__proto__": {"polluted": 1}}
  }`);
  const safe = normalizeState(hostile, NOW);
  assert.equal({}.polluted, undefined);
  for (const value of [safe.tally, safe.hearth, safe.hearth.raisedAt, safe.satchel.materials, safe.satchel.essences, safe.satchel.essenceGenres, safe.wilds, safe.wilds.lanterns,
    safe.rifts.open, safe.rifts.warded, safe.rifts.closedWild, safe.rifts.stitched, safe.story, safe.story.prologue.done]) {
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.ok(!Object.hasOwn(value, '__proto__'));
    assert.equal(value.polluted, undefined);
  }
  assert.deepEqual(Object.keys(safe.satchel.essences), ['Neon shard']);
  assert.deepEqual(safe.satchel.essenceGenres, { 'Neon shard': 'neon' });
  assert.deepEqual(safe.story.prologue.done, {});
  assert.deepEqual(safe.tally.finishedIds, ['__proto__'], 'a string in a list is only a string');
});

test('Phase 3: a state at every cap stays well under the 2 MiB file limit', () => {
  const big = normalizeState({
    tally: { finishedIds: Array.from({ length: 400 }, (_, i) => `claude:${'0'.repeat(28)}${String(i).padStart(8, '0')}`) },
    satchel: {
      essences: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`Essence number ${i}`, 99])),
      essenceGenres: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`Essence number ${i}`, 'backhalls'])),
      relics: Array.from({ length: 200 }, (_, i) => ({ name: `A long relic name, number ${i}`, text: 'y'.repeat(220), genre: 'gothic', at: NOW })) },
    wilds: {
      explored: Array.from({ length: 20000 }, (_, i) => `${-9000 + i},${-4000 + (i % 500)}`),
      lanterns: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`lantern:${-9000 + i},123456`, NOW])),
      opened: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`poi:chest:${-9000 + i},123456`, NOW])),
      notes: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`poi:note:${-9000 + i},123456`, NOW])),
    },
    rifts: { history: Array.from({ length: 100 }, (_, i) => ({ key: `knock:claude:${'a'.repeat(36)}`, id: `rift:${(1e9 + i).toString(36)}`, name: 'n'.repeat(120), genres: ['gothic', 'neon'], kind: 'real', openedAt: NOW, closedAt: NOW, how: 'sealed' })) },
  }, NOW);
  const bytes = Buffer.byteLength(JSON.stringify(big, null, 2));
  assert.ok(bytes < 1.6 * 1024 * 1024, `${bytes} bytes`);
});

test('Phase 3 helpers: materials, stumps, lanterns, points of interest and the fog', () => {
  const state = createState(NOW);
  const logs = addMaterials(state, { birch: 5, ash: 2.8, pine: -3, 'Bad id': 4 });
  assert.deepEqual(logs.satchel.materials, { birch: 5, ash: 2, pine: 0 });
  assert.equal(state.satchel.materials.birch, 0, 'the state given is left alone');
  assert.equal(addMaterials(logs, { birch: 0 }), logs, 'nothing to add: the same state back');
  assert.equal(addMaterials(logs, { birch: 3 }).satchel.materials.birch, 8);
  const today = dayNumber(NOW);
  const felled = markFelled(state, 'tree:-3,-9', today);
  assert.deepEqual(felled.wilds.felled, { 'tree:-3,-9': today });
  assert.equal(markFelled(felled, 'tree:-3,-9', today), felled);
  assert.equal(markFelled(state, 'lantern:1,2', today), state, 'only tree ids');
  const lit = lightLantern(state, 'lantern:-12,40', NOW);
  assert.deepEqual(lit.wilds.lanterns, { 'lantern:-12,40': NOW });
  assert.equal(lightLantern(lit, 'lantern:-12,40', NOW + HOUR), lit, 'the first lighting is kept');
  assert.equal(lightLantern(state, 'tree:1,1', NOW), state);
  const opened = markPoi(state, 'opened', 'poi:chest:4,-60', NOW);
  assert.deepEqual(opened.wilds.opened, { 'poi:chest:4,-60': NOW });
  assert.equal(markPoi(opened, 'opened', 'poi:chest:4,-60', NOW + 1), opened);
  assert.deepEqual(markPoi(state, 'notes', 'poi:note:1,1', NOW).wilds.notes, { 'poi:note:1,1': NOW });
  assert.equal(markPoi(state, 'lanterns', 'poi:note:1,1', NOW), state);
  const seen = markExplored(state, ['0,-1', '0,-1', '1,-1', 'bad', 4]);
  assert.deepEqual(seen.wilds.explored, ['0,-1', '1,-1']);
  assert.equal(markExplored(seen, ['1,-1']), seen);
  assert.deepEqual(markExplored(seen, ['-2,3']).wilds.explored, ['0,-1', '1,-1', '-2,3']);
  const full = { ...state, wilds: { ...state.wilds, explored: Array.from({ length: 20000 }, (_, i) => `${i},0`) } };
  const more = markExplored(full, ['-1,-1']);
  assert.equal(more.wilds.explored.length, 20000);
  assert.equal(more.wilds.explored.at(-1), '-1,-1');
  assert.equal(more.wilds.explored[0], '1,0', 'the oldest drops off');
  for (const junk of [null, 'x']) {
    assert.doesNotThrow(() => addMaterials(junk, { birch: 1 }));
    assert.doesNotThrow(() => markExplored(junk, ['0,0']));
  }
});

test('dayNumber and dayStart count local calendar days', () => {
  assert.equal(dayNumber(on(27, 0, 0)) - dayNumber(on(26, 23, 59)), 1);
  assert.equal(dayNumber(on(26, 0, 0)), dayNumber(on(26, 23, 59)));
  assert.ok(Number.isInteger(dayNumber(NOW)));
  assert.equal(dayStart(dayNumber(NOW)), new Date(2026, 8, 26).getTime());
  assert.equal(dayStart(dayNumber(NOW), 22 * 60), on(26, 22));
  assert.equal(dayStart(dayNumber(NOW), 30 * 60), on(27, 6), 'minutes can run past midnight');
  assert.equal(dayNumber('junk'), dayNumber(Date.now()));
  // Every day of the year is exactly one more than the day before, through both clock changes.
  for (let d = 0; d < 366; d += 1) {
    const a = new Date(2026, 0, 1 + d, 12).getTime();
    const b = new Date(2026, 0, 2 + d, 0, 30).getTime();
    assert.equal(dayNumber(b) - dayNumber(a), 1, new Date(a).toDateString());
    assert.equal(dayStart(dayNumber(a)), new Date(2026, 0, 1 + d).getTime());
  }
});
