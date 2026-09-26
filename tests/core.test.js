// Module B (Core) tests: state model, recap, greeting, live alerts, skills.
// Run: node --test tests/core.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, normalizeState, markSeen, dayKey, toTime, looksLikeSavedState, DEFAULT_SETTINGS } from '../src/model.js';
import { buildRecap, greeting, diffSnapshots, alertText, agentName, truncate, AWAY_THRESHOLD_MS } from '../src/recap.js';
import { SKILLS, evaluateSkills, skillForPlace } from '../src/skills.js';

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
const PROPER = new Set(['Claude', 'Codex', 'Milo', 'MILO', 'Chris', 'GitHub', 'PRs', 'CI', 'PC', 'I', 'I\u2019m', 'Sam']);

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

test('createState has the contract shape and calm defaults', () => {
  const state = createState(NOW);
  assert.deepEqual(state, {
    version: 1,
    user: { name: 'Chris' },
    milo: { name: 'Milo', tile: null },
    lastSeenAt: null,
    lastGreetedDay: null,
    settings: { motion: true, notifications: true, greeting: true },
    skills: {},
    panel: null,
  });
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
  assert.deepEqual(state.settings, { motion: true, notifications: false, greeting: true });
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
  assert.deepEqual(state.settings, { motion: false, notifications: true, greeting: true, sound: 'soft' });
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

test('SKILLS lists the six skills with the contract places and levels', () => {
  assert.deepEqual(SKILLS.map((s) => [s.id, s.place]), [
    ['watchkeeping', 'watchtower'], ['dispatch', 'workshop'], ['timekeeping', 'harbor'],
    ['lore', 'library'], ['voice', 'camp'], ['tinkering', 'building-site'],
  ]);
  const titles = Object.fromEntries(SKILLS.map((s) => [s.id, s.levels.map((l) => l.title)]));
  assert.deepEqual(titles, {
    watchkeeping: ['Reads your agent sessions', 'Live status and task alerts', 'Watches GitHub PRs and CI', 'Notices an agent stuck in a loop'],
    dispatch: ['Launches one agent run', 'Runs agents side by side', 'Second agent reviews the first', 'Chains research, build, test'],
    timekeeping: ['Reads your calendar', 'Deadline warnings', 'Agent runs on a timetable', 'Morning briefing'],
    lore: ['Remembers decisions per project', 'Recall across projects'],
    voice: ['Push to talk', 'Spoken briefings'],
    tinkering: ['Scaffolds a new app', 'Writes its level tree'],
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
  assert.equal(skillForPlace('harbor').id, 'timekeeping');
  assert.equal(skillForPlace('clip-studio'), null);
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
