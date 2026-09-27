// Core tests: state model (with step 2 plots), recap, greeting, live alerts, skills, built text.
// Run: node --test tests/core.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, normalizeState, markSeen, dayKey, toTime, looksLikeSavedState, DEFAULT_SETTINGS,
  PLOT_IDS, LEGACY_PLACE_IDS, canonicalPlaceId, emptyPlot, cleanSuggestion, cleanSuggestions, ideaFromText, checkBlueprint,
  plotOf, buildingName, builtNames, setSuggestions, startDesign, finishDesign, stopDesign, renamePlot, clearPlot,
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

const EMPTY_PLOT = { status: 'empty', suggestions: [], asked: null, idea: null, blueprint: null, designedBy: null, builtAt: null, name: null };

test('createState has the contract shape and calm defaults', () => {
  const state = createState(NOW);
  assert.deepEqual(state, {
    version: 1,
    user: { name: 'Chris' },
    milo: { name: 'Milo', tile: null },
    lastSeenAt: null,
    lastGreetedDay: null,
    settings: { motion: true, notifications: true, greeting: true, designer: 'auto' },
    skills: {},
    panel: null,
    plots: {
      'plot-meadow': EMPTY_PLOT, 'plot-rise': EMPTY_PLOT, 'plot-birch': EMPTY_PLOT, 'plot-pond': EMPTY_PLOT, 'plot-orchard': EMPTY_PLOT,
    },
  });
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
  assert.deepEqual(state.settings, { motion: true, notifications: false, greeting: true, designer: 'auto' });
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
  assert.deepEqual(state.settings, { motion: false, notifications: true, greeting: true, sound: 'soft', designer: 'auto' });
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
const built = (over = {}) => ({ status: 'built', suggestions: [], asked: null, idea: idea(), blueprint: blueprint(), designedBy: 'codex', builtAt: NOW, name: null, ...over });

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
