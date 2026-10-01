// Phase 3 core: real rifts (src/rifts.js), the Hearth (src/hearth.js) and the Prologue (src/story.js).
// riftgen and worldgen are built from the real content JSON. Run: node --test tests/rifts.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { createRiftgen } from '../src/world/riftgen.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createState, normalizeState, markSeen, dayNumber as modelDayNumber, finishDesign, startDesign, stopDesign, clearPlot, SESSION_NAME_DAYS, withoutTitle } from '../src/model.js';
import { CLOSED_DAYS } from '../src/ui/frontier.js';
import {
  RIFT_RULES, WARD_POST_RULES, dayNumber, deriveSignals, buildRealRifts, reconcileRifts, wardRift, unwardRift, letGoRift, letItBe,
  wildRiftsForChunk, claimLoot, stitchWild, letGoWild, stitchStory, nightWindow, clockText, whenText, dayText, plural, spanText,
  quoteTitle, bellText, sealedSummary, WILD_CAUSE, WILD_STITCH,
} from '../src/rifts.js';
import { hearthStatus, raiseHearth, wardRadius, hearthTier, WARD_RADII } from '../src/hearth.js';
import { prologueStatus, markStory, settleStory, readLetter, setTrackerHidden, PROLOGUE_STEP_IDS, STORY_RIFT_KEY } from '../src/story.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const words = readJson('riftgen.json');
const genres = readJson('genres.json');
const fortress = readJson('fortress.json');
const riftgen = createRiftgen({ words, genres });
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
// content/story.json is written by the Content module; the tests use this fixture in the §12
// shape, and check the real file too when it's there and parses.
const STORY = {
  version: 1,
  prologue: {
    id: 'prologue', title: 'The Lantern Wakes',
    steps: [
      { id: 'light', title: 'A Light on the Hook', text: 'The lantern catches.', hint: 'Open MILO and let Milo say hello.' },
      { id: 'crew', title: 'Three Stumps and a Bench', text: 'The crew find a seat.', hint: 'Start a session with Claude or Codex.' },
      { id: 'ground', title: 'Ground That’s Waiting', text: 'Plots wait round the camp.', hint: 'Open a plot and build an idea.' },
      { id: 'letter', title: 'A Letter by Paper Bird', text: 'A paper bird lands.', hint: 'Read Oriel’s letter.' },
      { id: 'first-crack', title: 'A Crack Past the Gate', text: 'Something presses on the page.', hint: 'Walk out of the north gate and mend the crack.' },
      { id: 'lantern', title: 'A Light in the Wilds', text: 'Old lanterns sleep on the roads.', hint: 'Light a lantern in the wilds.' },
      { id: 'stockade', title: 'Walls of Birch and Ash', text: 'A palisade would keep the edge.', hint: 'Raise the Stockade at the Hearth.' },
    ],
  },
  letters: { oriel: { from: 'Oriel', title: 'A letter by paper bird', lines: ['Dear Milo.'], sign: '— O.' } },
};
let REAL_STORY = null;
try {
  if (existsSync(new URL('../content/story.json', import.meta.url))) REAL_STORY = readJson('story.json');
} catch {
  REAL_STORY = null;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Local wall-clock time in September and October 2026. The 24th is a Thursday, the 25th a Friday.
const at = (d, h = 12, m = 0) => new Date(2026, 8, d, h, m, 0).getTime();
const OPEN = '\u201C';
const CLOSE = '\u201D';

function session(over = {}) {
  return {
    id: 'claude:a', agent: 'claude', sessionId: 'a', title: 'Letters to answer', project: 'Letters', cwd: 'C:\\x',
    startedAt: at(24, 20), lastActivityAt: at(24, 21), status: 'done', statusDetail: 'Finished', live: true,
    lastMessage: '', completions: [], turns: 0, model: '', source: 'cli', archived: false, waitingSince: null, ...over,
  };
}
const snapshot = (sessions = [], extra = {}) => ({ scannedAt: 0, sessions, tools: [], sources: { claude: { ok: true, live: true }, codex: { ok: true, live: false } }, capacity: { codex: null }, ...extra });
const reading = (usedPercent, resetsAt, over = {}) => ({ codex: { usedPercent, resetsAt, windowMinutes: 10080, at: at(24, 12), ...over } });
// A state where the Prologue is past its story rift, so tests see only the signal under test.
function stateWith(over = {}, now = at(24, 12)) {
  return normalizeState({
    lastSeenAt: now - HOUR,
    story: { prologue: { done: Object.fromEntries(PROLOGUE_STEP_IDS.map((id) => [id, now - DAY])) }, letterReadAt: now - DAY },
    ...over,
  }, now);
}
const derive = (sessions, now, over = {}, extra = {}) => deriveSignals({ snapshot: snapshot(sessions, extra), state: stateWith(over, now), now, story: STORY });
const only = (signals, kind) => signals.filter((s) => s.kind === kind);
const loop = ({ state, now, snap, ward = 0, isFree = null, story = STORY }) => {
  const signals = deriveSignals({ snapshot: snap, state, now, story });
  const rifts = buildRealRifts({ signals, state, now, riftgen, worldgen, wardRadius: ward, isFree });
  return { signals, rifts, ...reconcileRifts(state, rifts, now) };
};

// Calm copy (tests/core.test.js), with the proper nouns rift copy uses.
const PROPER = new Set(['Claude', 'Code', 'Codex', 'Milo', 'MILO', 'Chris', 'I', 'Oriel', 'Stockade', 'Hearth', 'Notice', 'Board', 'Commissions',
  'Mistmere', 'Tide', 'Adventurer’s', 'Kit', 'Maelstrom', 'Phase', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'X', 'Hearth’s', 'Oriel’s', 'Mistmere’s', 'Hold', 'Act', 'IV', 'VI', 'VII', 'Beginner', 'Margin', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'MILO’s']);
function assertCalm(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.ok(!text.includes('"'), `${where} uses curly quotes only: ${text}`);
  // A quoted session title is Chris's own words: the checks below read only MILO's.
  const unquoted = text.replace(/\u201C[^\u201D]*\u201D/g, 'X');
  assert.ok(!unquoted.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(unquoted), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(unquoted), `${where} has no emoji: ${text}`);
  assert.ok(!/\s{2,}/.test(unquoted), `${where} has no doubled spaces: ${text}`);
  const firstLetter = unquoted.match(/\p{L}/u);
  if (firstLetter) assert.equal(firstLetter[0], firstLetter[0].toUpperCase(), `${where} starts with a capital: ${text}`);
  const sentences = unquoted.split(/(?<=[.:?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/).slice(1).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}\u2019]+$/gu, ''));
    for (const word of tokens) {
      if (!word || PROPER.has(word)) continue;
      assert.ok(word[0] === word[0].toLowerCase(), `${where} is sentence case, "${word}" in: ${text}`);
    }
  }
}
function assertSignalCopy(sig) {
  // A building's name is a name ('The Clip studio was built on Friday.'), like a quoted title.
  const cause = sig.kind === 'built'
    ? sig.cause.replace(sig.subject.charAt(0).toUpperCase() + sig.subject.slice(1), 'X')
    : sig.cause;
  assertCalm(cause, `${sig.key} cause`);
  assertCalm(sig.stitch, `${sig.key} stitch`);
  assert.ok(sig.cause.length <= 160 && sig.stitch.length <= 140 && sig.subject.length <= 40, sig.key);
}

function withTimeZone(zone, run) {
  const before = process.env.TZ;
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    process.env.TZ = before ?? system;
  }
}

/* ------------------------------------------------------------------ rules and words */

test('the rules and the ward-post rules are the contract’s, frozen and calm', () => {
  assert.deepEqual(RIFT_RULES, { nightEndsHour: 6, nightRecentMin: 20, nightQuietMin: 45, knockHours: 24, patientKnockHours: 48, capacityPercent: 85, capacityHighPercent: 95, brightHours: 72, wardDays: 3, wallsUrgency: 0.9 });
  assert.ok(Object.isFrozen(RIFT_RULES) && Object.isFrozen(WARD_POST_RULES) && Object.isFrozen(WARD_POST_RULES[0]));
  assert.deepEqual(WARD_POST_RULES.map((r) => r.id), ['nights-off', 'patient-knock', 'capacity-95']);
  for (const rule of WARD_POST_RULES) {
    assertCalm(rule.name, `${rule.id} name`);
    assertCalm(rule.text, `${rule.id} text`);
  }
  assert.match(WARD_POST_RULES[1].text, /48 hours/);
  assert.match(WARD_POST_RULES[2].text, /95%/);
  assert.equal(dayNumber, modelDayNumber, 'one dayNumber for rifts, felled trees and the model');
});

test('times read as local HH:MM, weekdays as words, plurals right', () => {
  assert.equal(clockText(at(24, 9, 5)), '09:05');
  assert.equal(clockText(at(25, 0, 40)), '00:40');
  const now = at(24, 9); // Thursday
  assert.equal(whenText(at(24, 14, 20), now), 'today at 14:20');
  assert.equal(whenText(at(25, 9), now), 'tomorrow at 09:00');
  assert.equal(whenText(at(28, 14, 20), now), 'on Monday at 14:20');
  assert.equal(whenText(new Date(2026, 9, 1, 14, 20).getTime(), now), 'on Thursday 1 October at 14:20', 'a week or more out names the date too');
  assert.equal(dayText(at(24, 8), now), 'today');
  assert.equal(dayText(at(23, 23), now), 'yesterday');
  assert.equal(dayText(at(21, 12), now), 'on Monday');
  assert.equal(dayText(at(12, 12), now), 'on 12 September');
  assert.equal(plural(1, 'hour'), '1 hour');
  assert.equal(plural(26, 'hour'), '26 hours');
  assert.equal(plural(0, 'day'), '0 days');
  assert.equal(spanText(HOUR + 59 * MIN), '1 hour');
  assert.equal(spanText(26 * HOUR + 30 * MIN), '26 hours');
  assert.equal(spanText(71 * HOUR), '71 hours');
  assert.equal(spanText(80 * HOUR), '3 days');
  assert.equal(spanText(25 * DAY), '25 days');
});

test('session titles are quoted with curly quotes and clipped to 40, surrogate-safe', () => {
  assert.equal(quoteTitle('Letters to answer'), `${OPEN}Letters to answer${CLOSE}`);
  assert.equal(quoteTitle('   '), `${OPEN}Untitled session${CLOSE}`);
  assert.equal(quoteTitle(null), `${OPEN}Untitled session${CLOSE}`);
  assert.equal(quoteTitle('Say "hi"   there'), `${OPEN}Say \u2019hi\u2019 there${CLOSE}`, 'straight quotes never reach the copy');
  const long = quoteTitle('A very long session title that keeps going well past forty characters');
  assert.ok(long.length <= 40 && long.length >= 38, long);
  assert.ok(long.startsWith(OPEN) && long.endsWith(`…${CLOSE}`));
  for (let pad = 30; pad <= 40; pad += 1) {
    const quoted = quoteTitle(`${'x'.repeat(pad)}\u{1F319}\u{1F319}\u{1F319} and more words to clip`);
    assert.ok(quoted.length <= 40, quoted);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(quoted), `no lone high surrogate at ${pad}: ${quoted}`);
    assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(quoted), `no lone low surrogate at ${pad}`);
  }
});

test('dayNumber and the night window are DST-safe, in several time zones', () => {
  for (const zone of ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kolkata']) {
    withTimeZone(zone, () => {
      for (let d = 0; d < 366; d += 1) {
        const noon = new Date(2026, 0, 1 + d, 12).getTime();
        const early = new Date(2026, 0, 2 + d, 0, 10).getTime();
        const late = new Date(2026, 0, 1 + d, 23, 50).getTime();
        assert.equal(dayNumber(early) - dayNumber(noon), 1, `${zone} ${new Date(noon).toDateString()}`);
        assert.equal(dayNumber(late), dayNumber(noon));
        // The night runs from the bell to 06:00 by the wall clock, whatever the clocks did.
        const night = nightWindow(new Date(2026, 0, 2 + d, 1, 0).getTime(), '22:00');
        assert.ok(night, `${zone} night of ${new Date(noon).toDateString()}`);
        assert.equal(night.evening, dayNumber(noon));
        assert.deepEqual([new Date(night.start).getHours(), new Date(night.start).getMinutes()], [22, 0]);
        assert.deepEqual([new Date(night.end).getHours(), new Date(night.end).getDate()], [6, new Date(early).getDate()]);
      }
    });
  }
});

/* ------------------------------------------------------------------ Nocturne */

test('Nocturne: the bell edges at 22:00, midnight and 06:00', () => {
  const working = (now) => [session({ status: 'working', startedAt: at(24, 20), lastActivityAt: now })];
  const night = (now) => only(derive(working(now), now), 'nocturne');
  assert.deepEqual(night(at(24, 21, 59)), [], 'not before the bell');
  const [bell] = night(at(24, 22));
  assert.equal(bell.key, 'night:2026-09-24');
  assert.equal(bell.urgency, 0.3);
  assert.equal(bell.since, at(24, 22), 'a session working since before the bell: late from the bell');
  assert.deepEqual(bell.signals, ['working-past-bell']);
  assert.equal(bell.subject, 'Thursday night');
  assert.deepEqual(bell.echo, { place: 'camp', icon: 'moon' });
  assert.equal(bell.bright, false);
  assert.equal(night(at(24, 23, 30))[0].urgency, 0.525);
  const midnight = night(new Date(2026, 8, 25, 0, 0).getTime())[0];
  assert.equal(midnight.key, 'night:2026-09-24', 'the night keeps the evening’s day');
  assert.equal(midnight.urgency, 0.75, '2 hours past the bell, plus after midnight');
  assert.equal(night(at(24, 23, 59))[0].urgency, round(0.3 + 0.15 * (119 / 60)));
  assert.equal(night(at(25, 1, 0))[0].urgency, 0.9);
  assert.equal(night(at(25, 5, 59))[0].urgency, 0.95, 'capped');
  assert.deepEqual(night(at(25, 6, 0)), [], 'dawn ends it');
  assert.equal(night(at(25, 0, 40))[0].cause, 'Claude was still working at 00:40, past your evening bell (22:00).');
});

test('Nocturne: recent activity opens it, 45 quiet minutes close it', () => {
  const quietSince = (last) => [session({ status: 'done', startedAt: at(24, 21), lastActivityAt: last, completions: [last] })];
  const state = stateWith({}, at(24, 22, 45));
  const signals = (now, s = state) => only(deriveSignals({ snapshot: snapshot(quietSince(at(24, 22, 30))), state: s, now, story: STORY }), 'nocturne');
  const [open] = signals(at(24, 22, 45));
  assert.ok(open, 'active 15 minutes ago');
  assert.equal(open.since, at(24, 22, 30));
  assert.equal(open.cause, 'Claude was still working at 22:30, past your evening bell (22:00).');
  assert.deepEqual(signals(at(24, 22, 51)), [], 'not open yet, and 21 quiet minutes: no rift');
  // Once open, it stays until the crew has been quiet for 45 minutes.
  const rifts = buildRealRifts({ signals: [open], state, now: at(24, 22, 45), riftgen, worldgen });
  const opened = reconcileRifts(state, rifts, at(24, 22, 45)).state;
  assert.equal(signals(at(24, 23, 14), opened).length, 1, '44 quiet minutes');
  assert.equal(signals(at(24, 23, 14), opened)[0].since, at(24, 22, 30), 'the same episode');
  assert.deepEqual(signals(at(24, 23, 15), opened), [], '45 quiet minutes');
  // Activity before the bell doesn't count, and archived sessions don't either.
  assert.deepEqual(only(derive(quietSince(at(24, 21, 50)), at(24, 22, 5)), 'nocturne'), []);
  assert.deepEqual(only(derive([session({ status: 'working', archived: true, lastActivityAt: at(24, 23) })], at(24, 23)), 'nocturne'), []);
});

test('Nocturne: the evening bell setting, several agents, and after-midnight starts', () => {
  const now = at(25, 0, 40);
  const crew = [
    session({ status: 'working', lastActivityAt: now }),
    session({ id: 'codex:b', agent: 'codex', status: 'working', lastActivityAt: now - MIN, startedAt: at(24, 23) }),
  ];
  assert.deepEqual(only(derive(crew, now, { settings: { eveningBell: null } }), 'nocturne'), [], 'no bell, no Nocturne');
  const both = only(derive(crew, now), 'nocturne')[0];
  assert.equal(both.cause, 'Claude and Codex were still working at 00:40, past your evening bell (22:00).');
  const nameless = session({ id: 'x:1', agent: undefined, status: 'working', lastActivityAt: now });
  assert.equal(only(derive([nameless], now), 'nocturne')[0].cause, 'The crew was still working at 00:40, past your evening bell (22:00).');
  assert.equal(only(derive([crew[0], nameless], now), 'nocturne')[0].cause, 'Claude and the crew were still working at 00:40, past your evening bell (22:00).');
  assert.equal(only(derive([{ ...nameless, status: 'needs-you', waitingSince: now - 30 * HOUR }], now), 'knocking')[0].stitch, 'Answer the crew in that session.');
  // A bell after midnight belongs to the evening before.
  const late = only(derive(crew, now, { settings: { eveningBell: '00:30' } }), 'nocturne')[0];
  assert.equal(late.key, 'night:2026-09-24');
  assert.equal(late.urgency, round(0.3 + 0.15 * (10 / 60) + 0.15));
  assert.equal(late.cause, 'Claude and Codex were still working at 00:40, past your evening bell (00:30).');
  assert.deepEqual(only(derive(crew, at(25, 0, 20), { settings: { eveningBell: '00:30' } }), 'nocturne'), [], 'before a late bell');
  assert.equal(only(derive(crew, at(24, 20, 30), { settings: { eveningBell: '20:00' } }), 'nocturne')[0].urgency, 0.375);
  // A night that only began after midnight carries that signal, and its genre holds all night.
  const after = only(derive([session({ status: 'working', startedAt: at(25, 0, 15), lastActivityAt: now })], now), 'nocturne')[0];
  assert.deepEqual(after.signals, ['session-after-midnight']);
  assert.equal(after.since, at(25, 0, 15));
});

function round(value) {
  return Math.round(value * 1000) / 1000;
}

test('Nocturne: the same rift through midnight', () => {
  let state = stateWith({}, at(24, 23, 50));
  const crew = (now) => snapshot([session({ status: 'working', startedAt: at(24, 22, 30), lastActivityAt: now })]);
  const first = loop({ state, now: at(24, 23, 50), snap: crew(at(24, 23, 50)) });
  state = first.state;
  const second = loop({ state, now: at(25, 0, 10), snap: crew(at(25, 0, 10)) });
  const [a] = first.rifts;
  const [b] = second.rifts;
  assert.equal(a.id, b.id, 'same key and signals: the same rift');
  assert.equal(a.spec.name, b.spec.name);
  assert.equal(b.since, at(24, 22, 30));
  assert.ok(b.urgency > a.urgency);
  assert.deepEqual(second.sealed, []);
  assert.deepEqual(second.opened, []);
});

test('Nocturne: after it seals, late work is a new episode, whether it was belled, warded or neither', () => {
  // Working 22:00 to 01:10, quiet until 02:00, working 02:00 to 03:00, then quiet until dawn.
  const crewAt = (t) => {
    const working = t <= at(25, 1, 10) || (t >= at(25, 2) && t <= at(25, 3));
    const last = working ? t : (t < at(25, 2) ? at(25, 1, 10) : at(25, 3));
    return snapshot([session({ status: working ? 'working' : 'done', startedAt: at(24, 21, 30), lastActivityAt: last })]);
  };
  const run = (tweak = (s) => s) => {
    let state = stateWith({}, at(24, 22));
    const out = { opened: [], sealed: [], bells: 0 };
    for (let t = at(24, 22); t <= at(25, 6, 30); t += 5 * MIN) {
      const step = loop({ state, now: t, snap: crewAt(t) });
      out.opened.push(...step.opened.map((r) => r.since));
      out.sealed.push(...step.sealed.map(() => t));
      out.bells += step.bell.length;
      state = tweak(step.state, step, t);
    }
    return { ...out, state };
  };
  const belled = run();
  const secondSince = at(25, 1, 55) + 1; // just after the first seal: the new episode's first late activity MILO can place
  assert.deepEqual(belled.opened, [at(24, 22), secondSince], 'the second episode has its own since');
  assert.deepEqual(belled.sealed, [at(25, 1, 55), at(25, 3, 45)], '45 quiet minutes after each');
  assert.equal(belled.bells, 2, 'each episode reaches the walls, and rings once');
  assert.equal(belled.state.rifts.stitched.real, 2);
  // As if it never reached the walls (no bell marks): the same episodes.
  const unbelled = run((s) => ({ ...s, rifts: { ...s.rifts, belled: {} } }));
  assert.deepEqual([unbelled.opened, unbelled.sealed, unbelled.state.rifts.stitched.real], [belled.opened, belled.sealed, 2]);
  // Warded when it opened: the ward held the first episode, not the next.
  const warded = run((s, step, t) => (step.opened.length && !Object.keys(s.rifts.warded).length && !s.rifts.history.length ? wardRift(s, step.opened[0], t) : s));
  assert.deepEqual([warded.opened, warded.sealed, warded.state.rifts.stitched.real], [belled.opened, belled.sealed, 2]);
  assert.equal(warded.bells, 1, 'only the unwarded second episode rang');
  // The loot of each episode is paid once: two seals, two loots.
  const lootOf = (s) => Object.values(s.satchel.essences).reduce((a, b) => a + b, 0);
  assert.equal(lootOf(belled.state), lootOf(unbelled.state));
});

test('Nocturne: switching the evening bell off, or moving it past the night, closes it quietly', () => {
  const key = 'night:2026-09-24';
  const crew = (last, status = 'working') => snapshot([session({ status, startedAt: at(24, 22, 30), lastActivityAt: last })]);
  const bellAt = (s, eveningBell) => ({ ...s, settings: { ...s.settings, eveningBell } });
  const opened = loop({ state: stateWith({}, at(24, 23)), now: at(24, 23), snap: crew(at(24, 23)) });
  assert.deepEqual(opened.opened.map((r) => r.key), [key]);
  assert.equal(opened.state.rifts.open[key].bell, '22:00', 'it remembers the bell it stood under');
  const { id } = opened.opened[0];
  const before = opened.state;
  const t = at(24, 23, 10);
  const cases = [
    ['switched off', null, crew(t)],
    ['moved past midnight', '00:30', crew(t)],
    ['moved past now', '23:30', crew(t)],
    ['moved past the late work', '23:05', crew(at(24, 23), 'done')],
  ];
  for (const [why, bell, snap] of cases) {
    const quiet = loop({ state: bellAt(before, bell), now: t, snap });
    assert.deepEqual(quiet.sealed, [], `${why}: nothing sealed`);
    assert.deepEqual(quiet.closed.map((c) => [c.key, c.id, c.kind, c.realKind, c.subject]), [[key, id, 'real', 'nocturne', 'Thursday night']], why);
    assert.deepEqual(quiet.state.rifts.open, {}, `${why}: no longer open`);
    const [entry] = quiet.state.rifts.history;
    assert.deepEqual([entry.key, entry.id, entry.how, entry.closedAt, entry.openedAt], [key, id, 'closed', t, at(24, 23)], why);
    assert.deepEqual(quiet.state.rifts.stitched, { real: 0, wild: 0, story: 0 }, `${why}: nothing counted`);
    assert.deepEqual(quiet.state.satchel, before.satchel, `${why}: no loot`);
    assert.deepEqual(normalizeState(quiet.state, t).rifts.history[0], entry, `${why}: saved as closed`);
    assert.equal(sealedSummary(quiet.sealed), null, 'nothing for the boot summary');
  }
  // Moved but still covering the late work: it stays open under the new bell, and seals as usual
  // once the crew has been quiet for 45 minutes.
  const moved = loop({ state: bellAt(before, '22:30'), now: t, snap: crew(t) });
  assert.deepEqual([moved.sealed, moved.closed, moved.opened], [[], [], []]);
  assert.equal(moved.state.rifts.open[key].bell, '22:30');
  assert.equal(moved.state.rifts.open[key].since, before.rifts.open[key].since, 'the same episode');
  const slept = loop({ state: moved.state, now: at(24, 23, 55), snap: crew(t, 'done') });
  assert.deepEqual(slept.sealed.map((s) => s.key), [key]);
  assert.deepEqual(slept.closed, []);
  assert.equal(slept.state.rifts.stitched.real, 1, 'going to bed mends it');
  // Unmoved, it seals as it always did.
  const unmoved = loop({ state: before, now: at(24, 23, 55), snap: crew(t, 'done') });
  assert.deepEqual([unmoved.sealed.map((s) => s.key), unmoved.closed], [[key], []]);
  // After a quiet close, late work past the new bell is a new episode, with its own since (a bell
  // mark left from the closed one doesn't carry over).
  const closed = loop({ state: bellAt(before, '00:30'), now: t, snap: crew(t) }).state;
  const belledBefore = { ...closed, rifts: { ...closed.rifts, belled: { [key]: { since: before.rifts.open[key].since, at: t } } } };
  const again = loop({ state: belledBefore, now: at(25, 0, 40), snap: crew(at(25, 0, 40)) });
  assert.deepEqual(again.opened.map((r) => [r.key, r.since, r.bell]), [[key, at(25, 0, 30), '00:30']]);
  // Dawn still seals, whatever the bell did in the night.
  const dawnState = loop({ state: bellAt(before, '00:30'), now: at(25, 5), snap: crew(at(25, 5)) }).state;
  assert.equal(dawnState.rifts.open[key].bell, '00:30');
  const dawn = loop({ state: bellAt(dawnState, null), now: at(25, 6, 5), snap: crew(at(25, 5, 50), 'done') });
  assert.deepEqual([dawn.sealed.map((s) => s.key), dawn.closed], [[key], []]);
  // While the watcher can't see the crew, a moved bell changes nothing yet: the night is carried.
  const blind = loop({ state: bellAt(before, null), now: t, snap: null });
  assert.deepEqual([blind.sealed, blind.closed], [[], []]);
  assert.ok(blind.state.rifts.open[key]);
  // A Nocturne saved before it knew its bell still closes quietly when the bell is switched off.
  const legacyOpen = { ...before.rifts.open[key] };
  delete legacyOpen.bell;
  const legacy = normalizeState({ ...before, rifts: { ...before.rifts, open: { [key]: legacyOpen } } }, t);
  assert.ok(!('bell' in legacy.rifts.open[key]));
  const legacyOff = loop({ state: bellAt(legacy, null), now: t, snap: crew(t) });
  assert.deepEqual([legacyOff.sealed, legacyOff.closed.map((c) => c.key)], [[], [key]]);
});

/* ------------------------------------------------------------------ Knocking */

test('Knocking: 24 hours waiting opens it, and it walks closer as it waits', () => {
  const now = at(26, 12);
  const knock = (hours, over = {}) => only(derive([session({ status: 'needs-you', waitingSince: now - hours * HOUR, lastActivityAt: now - 200 * HOUR, ...over })], now), 'knocking');
  assert.deepEqual(knock(23.99), []);
  const [first] = knock(24);
  assert.equal(first.key, 'knock:claude:a');
  assert.equal(first.urgency, 0.35);
  assert.equal(first.since, now - 24 * HOUR, 'since is waitingSince');
  assert.equal(first.sessionId, 'claude:a');
  assert.deepEqual(first.signals, ['needs-you-unanswered']);
  assert.deepEqual(first.echo, { place: 'watchtower', icon: 'knocker' });
  assert.equal(first.subject, `${OPEN}Letters to answer${CLOSE}`);
  const [waited] = knock(26);
  assert.equal(waited.cause, `${OPEN}Letters to answer${CLOSE} has waited on you for 26 hours.`);
  assert.equal(waited.urgency, round(0.35 + (2 / 48) * 0.55));
  assert.equal(waited.stitch, 'Answer Claude in that session.');
  assert.equal(knock(48)[0].urgency, 0.625);
  assert.equal(knock(72)[0].urgency, 0.9, 'three days waiting reaches the walls');
  assert.equal(knock(500)[0].urgency, 0.95, 'capped');
  assert.equal(knock(80)[0].cause, `${OPEN}Letters to answer${CLOSE} has waited on you for 3 days.`);
  // Without waitingSince the last activity stands in.
  assert.equal(knock(0, { waitingSince: null, lastActivityAt: now - 30 * HOUR })[0].since, now - 30 * HOUR);
  assert.deepEqual(knock(30, { status: 'done' }), [], 'it stops needing you');
  assert.deepEqual(knock(30, { archived: true }), []);
  assert.equal(knock(30, { agent: 'codex', id: 'codex:t' })[0].stitch, 'Answer Codex in that session.');
});

/* ------------------------------------------------------------------ Capacity */

test('Capacity: Codex past 85% opens it until the refill', () => {
  const now = at(24, 9); // Thursday morning
  const cap = (used, resetsAt = at(24, 14, 20), over = {}) => only(derive([], now, {}, { capacity: reading(used, resetsAt, over) }), 'capacity');
  assert.deepEqual(cap(84.9), []);
  assert.equal(cap(85)[0].urgency, 0.4);
  const [high] = cap(91.6, at(28, 14, 20));
  assert.equal(high.key, `capacity:codex:${at(28, 14, 20)}`);
  assert.equal(high.cause, 'Codex has used 91% of its weekly allowance. It refills on Monday at 14:20.', 'never rounded up');
  assert.equal(high.stitch, 'Give Codex a rest, or wait for the refill.');
  assert.equal(high.since, at(24, 12) > now ? now : at(24, 12));
  assert.equal(high.subject, 'Codex');
  assert.deepEqual(high.echo, { place: 'workbench', icon: 'spark' });
  assert.equal(high.urgency, round(0.4 + (6.6 / 15) * 0.55));
  assert.equal(cap(100)[0].urgency, 0.95);
  assert.equal(cap(91)[0].cause, 'Codex has used 91% of its weekly allowance. It refills today at 14:20.');
  assert.equal(cap(91, at(25, 9))[0].cause, 'Codex has used 91% of its weekly allowance. It refills tomorrow at 09:00.');
  assert.equal(cap(91, at(24, 11), { windowMinutes: 300 })[0].cause, 'Codex has used 91% of its 5-hour allowance. It refills today at 11:00.');
  assert.deepEqual(cap(99, now), [], 'the refill has come');
  assert.deepEqual(cap(99, now - MIN), []);
  assert.deepEqual(only(derive([], now, {}, { capacity: { codex: null } }), 'capacity'), []);
  assert.deepEqual(only(derive([], now, {}, { capacity: { codex: { usedPercent: 'lots' } } }), 'capacity'), []);
});

test('Capacity: a new reading keeps the same episode', () => {
  const now = at(24, 9);
  const snapAt = (used, readAt) => snapshot([], { capacity: reading(used, at(28, 14), { at: readAt }) });
  let state = stateWith({}, now);
  const first = loop({ state, now, snap: snapAt(88, now - 5 * MIN) });
  state = first.state;
  assert.equal(first.opened.length, 1);
  const later = loop({ state, now: now + HOUR, snap: snapAt(92, now + 50 * MIN) });
  assert.equal(later.rifts[0].since, now - 5 * MIN, 'since stays at the first reading over the line');
  assert.deepEqual(later.opened, []);
  assert.deepEqual(later.sealed, []);
});

test('Capacity: a wobbling refill time, or a switch to the fuller window, keeps the episode', () => {
  const now = at(24, 9);
  const refill = at(24, 14, 20); // the 5-hour window
  const key = `capacity:codex:${refill}`;
  const snapAt = (used, resetsAt, t, over = {}) => snapshot([], { capacity: reading(used, resetsAt, { at: t, windowMinutes: 300, ...over }) });
  let state = stateWith({}, now);
  const first = loop({ state, now, snap: snapAt(90, refill, now) });
  assert.deepEqual(first.opened.map((r) => r.key), [key]);
  state = first.state;
  // Older Codex builds give the refill as seconds from each reading, so it wobbles a little.
  let seals = 0;
  let opens = 0;
  for (let i = 1; i <= 6; i += 1) {
    const t = now + i * 5 * MIN;
    const step = loop({ state, now: t, snap: snapAt(90 + i / 10, refill + (i % 2 ? 2000 * i : -3000 * i), t) });
    seals += step.sealed.length;
    opens += step.opened.length;
    assert.deepEqual(step.rifts.map((r) => [r.key, r.since]), [[key, now]], `reading ${i}`);
    state = step.state;
  }
  assert.deepEqual([seals, opens, state.rifts.stitched.real, state.rifts.history.length], [0, 0, 0, 0], 'nothing sealed, nothing paid out');
  assert.deepEqual(state.satchel.essences, {});
  // Let go, it stays let go through the wobble; warded, the ward holds through it.
  const t1 = now + 40 * MIN;
  const [rift] = loop({ state, now: t1, snap: snapAt(91, refill, t1) }).rifts;
  const released = letGoRift(state, rift, t1);
  const wobble = loop({ state: released, now: t1 + 5 * MIN, snap: snapAt(91, refill + 9 * MIN, t1 + 5 * MIN) });
  assert.deepEqual([wobble.rifts, wobble.opened, wobble.sealed], [[], [], []], 'still let go');
  assert.deepEqual(wobble.signals.map((s) => [s.key, s.since]), [[key, now]]);
  const elsewhere = loop({ state: released, now: t1 + 5 * MIN, snap: snapAt(91, refill + 2 * HOUR, t1 + 5 * MIN) });
  assert.deepEqual(elsewhere.opened.map((r) => r.key), [`capacity:codex:${refill + 2 * HOUR}`], 'a refill two hours off is another window');
  const warded = wardRift(state, rift, t1);
  const holding = loop({ state: warded, now: t1 + 5 * MIN, snap: snapAt(99, refill - 4000, t1 + 5 * MIN) });
  assert.deepEqual(holding.rifts.map((r) => [r.key, r.stage, r.atWalls]), [[key, rift.stage, false]]);
  // The weekly window fills past the 5-hour one. Usage only climbs inside a window, so Codex is
  // still over the line on the 5-hour one until it refills: the same episode, in the new words.
  const weekly = at(28, 14, 20);
  const t2 = now + HOUR;
  const switched = loop({ state, now: t2, snap: snapAt(93, weekly, t2, { windowMinutes: 10080 }) });
  assert.deepEqual([switched.opened, switched.sealed], [[], []]);
  assert.deepEqual(switched.rifts.map((r) => [r.key, r.since]), [[key, now]]);
  assert.equal(switched.rifts[0].cause, 'Codex has used 93% of its weekly allowance. It refills on Monday at 14:20.');
  // The 5-hour refill ends that episode; the weekly window, still over the line, is a new one.
  const refilled = loop({ state: switched.state, now: refill, snap: snapAt(93, weekly, refill, { windowMinutes: 10080 }) });
  assert.deepEqual(refilled.sealed.map((s) => s.key), [key]);
  assert.deepEqual(refilled.opened.map((r) => [r.key, r.since]), [[`capacity:codex:${weekly}`, refill]]);
  assert.equal(refilled.state.rifts.stitched.real, 1, 'one episode, one seal');
});

test('Capacity: a refill time a few seconds past the key’s ends the episode once, at the refill', () => {
  // The first reading over the line keys the rift on its refill R. Later readings of the same
  // window give R+8 s (Codex's refill times move by seconds). Passes land either side of R.
  const refill = at(28, 14, 20);
  const key = `capacity:codex:${refill}`;
  const t0 = at(26, 9);
  const t1 = t0 + HOUR;
  const snapAt = (used, resetsAt, readAt) => snapshot([], { capacity: reading(used, resetsAt, { at: readAt }) });
  const run = ({ used = 99, drift = 8000, then = (s) => s } = {}) => {
    let state = stateWith({ hearth: { tier: 2 } }, t0);
    const first = loop({ state, now: t0, snap: snapAt(used, refill, t0) });
    const seen = { opened: first.opened.map((r) => r.key), bells: first.bell.length, sealed: [], after: [] };
    const second = loop({ state: first.state, now: t1, snap: snapAt(used, refill + drift, t1) });
    state = then(second.state, second.rifts[0], t1);
    for (const t of [refill - 10_000, refill + 4_000, refill + 6_000, refill + 13_000, refill + HOUR]) {
      const step = reconcileRifts(state, buildRealRifts({ signals: deriveSignals({ snapshot: snapAt(used, refill + drift, t1), state, now: t, story: STORY }), state, now: t, riftgen, worldgen }), t);
      seen.opened.push(...step.opened.map((r) => r.key));
      seen.bells += step.bell.length;
      seen.sealed.push(...step.sealed.map((s) => [s.key, s.loot.length > 0]));
      if (t > refill) seen.after.push(...Object.keys(step.state.rifts.open));
      state = step.state;
    }
    return { ...seen, state };
  };
  const plain = run();
  assert.deepEqual(plain.opened, [key], 'nothing opens after the refill');
  assert.equal(plain.bells, 1, 'the Gate Bell rang once, for the one episode');
  assert.deepEqual(plain.sealed, [[key, true]], 'one seal, with its loot');
  assert.deepEqual(plain.after, []);
  assert.equal(plain.state.rifts.stitched.real, 1);
  assert.deepEqual(plain.state.rifts.history.map((h) => [h.key, h.how]), [[key, 'sealed']]);
  // Below the walls there's no bell mark to go by: the history knows the window has closed.
  const quieter = run({ used: 90 });
  assert.deepEqual([quieter.opened, quieter.bells, quieter.sealed, quieter.state.rifts.stitched.real], [[key], 0, [[key, true]], 1]);
  // Warded: no bell past the first, one seal.
  const warded = run({ then: (s, rift, t) => wardRift(s, rift, t) });
  assert.deepEqual([warded.opened, warded.bells, warded.sealed], [[key], 1, [[key, true]]]);
  // Let go: nothing comes back and nothing pays out.
  const released = run({ then: (s, rift, t) => letGoRift(s, rift, t) });
  assert.deepEqual([released.opened, released.bells, released.sealed, released.after], [[key], 1, [], []]);
  assert.deepEqual([released.state.rifts.stitched.real, released.state.satchel.essences], [0, {}]);
  // A refill time a few seconds early seals it once too.
  const early = run({ drift: -8000 });
  assert.deepEqual([early.opened, early.bells, early.sealed, early.state.rifts.stitched.real], [[key], 1, [[key, true]], 1]);
  // A new window after the refill is a new episode, as it should be.
  const nextWeek = refill + 7 * DAY;
  const later = loop({ state: plain.state, now: refill + DAY, snap: snapAt(96, nextWeek, refill + DAY) });
  assert.deepEqual(later.opened.map((r) => r.key), [`capacity:codex:${nextWeek}`]);
});

test('Knocking: a session missing from one look comes back as the same episode, and never pays twice', () => {
  const waiting = at(24, 9);
  let t = waiting + 30 * HOUR;
  let state = stateWith({}, t);
  const key = 'knock:claude:a';
  const knocking = session({ status: 'needs-you', waitingSince: waiting, lastActivityAt: waiting });
  const pass = (sessions) => {
    const result = loop({ state, now: t, snap: snapshot(sessions) });
    state = result.state;
    t += 30_000;
    return result;
  };
  const essences = () => Object.values(state.satchel.essences).reduce((a, b) => a + b, 0);
  assert.deepEqual(pass([knocking]).opened.map((r) => r.key), [key]);
  // The watcher skips a half-written registry file for a round: the session reads as stopped.
  const gap = pass([{ ...knocking, status: 'stopped', waitingSince: null }]);
  assert.deepEqual(gap.sealed.map((s) => s.key), [key]);
  const paid = essences();
  assert.ok(paid > 0);
  // Back, still waiting since the same moment: it stands again with no news.
  const back = pass([knocking]);
  assert.deepEqual(back.rifts.map((r) => r.key), [key], 'it stands, since the session is still waiting');
  assert.deepEqual([back.opened, back.sealed, back.bell], [[], [], []], 'no second "opened" bubble');
  assert.equal(state.rifts.open[key].resumed, true);
  assert.deepEqual(normalizeState(state, t), state, 'saves cleanly');
  // Answered for real: it closes quietly, with no second seal, count or loot.
  t += 2 * HOUR;
  const answered = pass([{ ...knocking, status: 'done', waitingSince: null }]);
  assert.deepEqual(answered.sealed, []);
  assert.deepEqual(answered.closed.map((c) => [c.key, c.realKind]), [[key, 'knocking']]);
  assert.deepEqual([state.rifts.stitched.real, essences()], [1, paid]);
  assert.deepEqual(state.rifts.history.map((h) => [h.key, h.how, h.since]), [[key, 'sealed', waiting]], 'one history entry for one episode');
  // A new wait is a new episode: news when it opens, and a seal with loot when it's answered.
  t += 30 * HOUR;
  const again = pass([{ ...knocking, waitingSince: t - 26 * HOUR }]);
  assert.deepEqual(again.opened.map((r) => r.key), [key]);
  assert.equal(state.rifts.open[key].resumed, undefined);
  const done = pass([{ ...knocking, status: 'done', waitingSince: null }]);
  assert.deepEqual(done.sealed.map((s) => s.key), [key]);
  assert.equal(state.rifts.stitched.real, 2);
});

test('A closed Knocking’s name keeps its session’s title only while the War Table shows it', () => {
  assert.equal(SESSION_NAME_DAYS, CLOSED_DAYS, 'as long as the War Table lists closed rifts');
  const now = at(26, 12);
  const title = 'Letters to answer';
  let state = stateWith({}, now);
  const open = loop({ state, now, snap: snapshot([session({ status: 'needs-you', waitingSince: now - 30 * HOUR, title })]) });
  const sealed = loop({ state: open.state, now: now + HOUR, snap: snapshot([]) });
  state = sealed.state;
  const [entry] = state.rifts.history;
  assert.equal(entry.key, 'knock:claude:a');
  assert.ok(entry.name.includes(title), 'named for its session while it’s listed as closed');
  assert.ok(normalizeState(state, now + HOUR + 2 * DAY).rifts.history[0].name.includes(title));
  const later = normalizeState(state, now + HOUR + SESSION_NAME_DAYS * DAY + MIN).rifts.history[0];
  assert.ok(!later.name.includes(title) && !later.name.includes('“'), `no title after three days: ${later.name}`);
  assert.equal(later.name, withoutTitle(entry.name));
  assert.equal(normalizeState({ ...state, rifts: { ...state.rifts, history: [later] } }, now + 40 * DAY).rifts.history[0].name, later.name, 'and it stays that way');
  // Every name riftgen can give a Knocking reads well without its title.
  for (let i = 0; i < 80; i += 1) {
    const subject = quoteTitle(i % 2 ? `Session ${i}` : 'A “quoted” title that runs on well past forty characters');
    const spec = riftgen.realRift({ key: `knock:claude:s${i}`, subject, signals: ['needs-you-unanswered'], urgency: (i % 10) / 10 });
    const name = withoutTitle(spec.name);
    assert.ok(!name.includes('“') && !name.includes('”') && !/Session|quoted/.test(name), name);
    assert.match(name, /^[A-Z]/);
    assert.ok(name.includes('a waiting session') || name.startsWith('A waiting session'), name);
  }
  // Nights, capacity and buildings name no session, so they keep their names.
  const night = { key: 'night:2026-09-20', id: 'rift:abc', name: 'Still Up for Sunday night', genres: ['nocturne'], kind: 'real', openedAt: 1, closedAt: at(20, 23), how: 'sealed' };
  assert.equal(normalizeState({ ...state, rifts: { ...state.rifts, history: [night] } }, now).rifts.history[0].name, night.name);
});

/* ------------------------------------------------------------------ Built (bright) */

test('Built: a new building opens a bright rift for 72 hours', () => {
  const plots = (builtAt, name = null, blueprintName = 'Clip studio') => ({ 'plot-rise': builtPlot(builtAt, name, blueprintName) });
  const now = at(26, 12); // Saturday
  const built = (builtAt, name, blueprintName) => only(derive([], now, { plots: plots(builtAt, name, blueprintName) }), 'built');
  const [fresh] = built(now - 2 * HOUR);
  assert.equal(fresh.key, `built:plot-rise:${now - 2 * HOUR}`);
  assert.equal(fresh.bright, true);
  assert.equal(fresh.urgency, 0.3);
  assert.equal(fresh.subject, 'the Clip studio');
  assert.equal(fresh.cause, 'The Clip studio was built today.');
  assert.equal(fresh.stitch, 'Nothing to mend. Visit before it fades.');
  assert.deepEqual(fresh.echo, { place: 'plot-rise', icon: 'star' });
  assert.deepEqual(fresh.signals, ['milestone-reached']);
  assert.equal(built(at(25, 20))[0].cause, 'The Clip studio was built yesterday.');
  assert.equal(built(at(24, 12, 1))[0].cause, 'The Clip studio was built on Thursday.');
  assert.deepEqual(built(now - 72 * HOUR), [], 'it fades after 72 hours');
  assert.equal(built(now - HOUR, 'The sorting office')[0].cause, 'The sorting office was built today.');
  assert.equal(built(now - HOUR, 'Chris’s draft room')[0].cause, 'Chris’s draft room was built today.');
  const [rift] = buildRealRifts({ signals: [fresh], state: stateWith({}, now), now, riftgen, worldgen, wardRadius: 12 });
  assert.equal(rift.atWalls, false, 'bright rifts are never at the walls');
  assert.equal(rift.stage, 'hairline');
  assert.equal(rift.towards, 'painted-hills', 'Starlight faces the Painted Hills');
});

test('Built: a redesign is the same building, so it never opens a second bright rift', () => {
  const t0 = at(24, 12);
  const snap = snapshot([]);
  const look = (name) => builtPlot(0, null, name).blueprint;
  const design = (s, t, name, opts) => finishDesign(startDesign(s, 'plot-rise', { title: name }), 'plot-rise', { blueprint: look(name), by: 'codex' }, t, opts);
  const brights = (run) => run.rifts.filter((r) => r.bright).map((r) => r.key);
  let state = design(stateWith({}, t0), t0, 'Clip studio');
  const key = `built:plot-rise:${t0}`;
  const first = loop({ state, now: t0 + HOUR, snap });
  assert.deepEqual(first.opened.map((r) => r.key), [key], 'a new building shines');
  const { id } = first.opened[0];
  state = first.state;
  // A new look is drawn up: the building stands behind its scaffold, and so does its rift.
  state = startDesign(state, 'plot-rise', null);
  assert.equal(state.plots['plot-rise'].status, 'designing');
  const drawing = loop({ state, now: t0 + 2 * HOUR, snap });
  assert.deepEqual(brights(drawing), [key]);
  assert.deepEqual([drawing.sealed, drawing.opened, drawing.closed], [[], [], []], 'nothing seals while it’s redesigned');
  // The new look lands: builtAt moves, the day it first stood doesn't, and the rift is the same one.
  state = finishDesign(drawing.state, 'plot-rise', { blueprint: look('Cozy clip studio'), by: 'claude' }, t0 + 3 * HOUR);
  assert.deepEqual([state.plots['plot-rise'].builtAt, state.plots['plot-rise'].firstBuiltAt], [t0 + 3 * HOUR, t0]);
  const relooked = loop({ state, now: t0 + 3 * HOUR, snap });
  assert.deepEqual(relooked.rifts.filter((r) => r.bright).map((r) => [r.key, r.id]), [[key, id]]);
  assert.deepEqual([relooked.sealed, relooked.opened], [[], []]);
  assert.equal(relooked.rifts[0].cause, 'The Cozy clip studio was built today.', 'its words follow the new name');
  // A redesign that's given up, a save, and a look-only redesign the next day: still the one rift.
  state = stopDesign(startDesign(relooked.state, 'plot-rise', null), 'plot-rise');
  state = normalizeState(state, t0 + DAY);
  state = design(state, t0 + DAY, 'Clip studio', { keepPlan: true });
  const nextDay = loop({ state, now: t0 + DAY, snap });
  assert.deepEqual(brights(nextDay), [key]);
  assert.equal(nextDay.rifts[0].cause, 'The Cozy clip studio was built yesterday.', 'built the day it first stood (a look-only redesign keeps the name)');
  assert.deepEqual(nextDay.state.rifts.history, [], 'nothing has closed on the way');
  // 72 hours after it first stood, it fades once, with no loot; a redesign after that opens nothing.
  const faded = loop({ state: nextDay.state, now: t0 + 72 * HOUR, snap });
  assert.deepEqual(faded.sealed.map((s) => [s.key, s.bright, s.loot.length]), [[key, true, 0]]);
  assert.equal(faded.state.rifts.history.length, 1);
  const lateLook = design(faded.state, t0 + 80 * HOUR, 'Clip studio');
  assert.deepEqual(loop({ state: lateLook, now: t0 + 80 * HOUR, snap }).rifts, []);
  // A building saved before it knew its first day: its builtAt stands in, until normalised.
  const legacy = { ...lateLook, plots: { ...lateLook.plots, 'plot-rise': { ...lateLook.plots['plot-rise'], firstBuiltAt: undefined, builtAt: t0 + 80 * HOUR } } };
  assert.deepEqual(brights(loop({ state: legacy, now: t0 + 81 * HOUR, snap })), [`built:plot-rise:${t0 + 80 * HOUR}`]);
  // Cleared and built again, it's a new building, and it shines.
  const rebuilt = design(clearPlot(lateLook, 'plot-rise'), t0 + 5 * DAY, 'Game table');
  assert.equal(rebuilt.plots['plot-rise'].firstBuiltAt, t0 + 5 * DAY);
  assert.deepEqual(loop({ state: rebuilt, now: t0 + 5 * DAY, snap }).opened.map((r) => r.key), [`built:plot-rise:${t0 + 5 * DAY}`]);
  // A first design still being drawn up has no building yet, so nothing shines for it.
  const drafting = startDesign(clearPlot(lateLook, 'plot-rise'), 'plot-rise', { title: 'Game table' });
  assert.deepEqual(loop({ state: drafting, now: t0 + 5 * DAY, snap }).rifts, []);
});

function builtPlot(builtAt, name = null, blueprintName = 'Clip studio') {
  return {
    status: 'built', suggestions: [], asked: null, idea: null, designedBy: 'codex', builtAt, name,
    blueprint: {
      version: 1, name: blueprintName, tagline: 'Where clips get cut', purpose: 'Cuts clips.',
      style: { shape: 'workshop', walls: 'plank', wallColor: 'woodLight', roof: 'gable', roofColor: 'clay', trim: 'cream', door: 'arched', windows: 'square', chimney: false, flag: 'blossom', awning: 'none' },
      emblem: Array.from({ length: 12 }, () => '.'.repeat(12)), props: [], yard: 'flowers',
      levels: [1, 2, 3, 4, 5].map((n) => ({ level: n, title: `Level ${n}`, summary: `Level ${n} does a thing.`, proof: `Check ${n} passes.` })),
    },
  };
}

/* ------------------------------------------------------------------ Story */

test('Story: the crack past the north gate while its step is current', () => {
  const now = at(24, 12);
  const upToLetter = normalizeState({
    lastSeenAt: now - DAY, tally: { buildingsDesigned: 1, sessionsFinished: 1, finishedIds: ['claude:a'] },
    story: { letterReadAt: now - HOUR },
  }, now);
  const signals = deriveSignals({ snapshot: snapshot([session()]), state: upToLetter, now, story: STORY });
  const [crack] = only(signals, 'story');
  assert.ok(crack);
  assert.equal(crack.key, STORY_RIFT_KEY);
  assert.equal(crack.urgency, 0.2);
  assert.equal(crack.since, now - HOUR, 'since the letter was read');
  assert.equal(crack.cause, 'Something from another story is pressing on the page, just past the north gate.');
  assert.equal(crack.stitch, 'Step through and mend it.');
  assert.deepEqual(crack.echo, { place: 'camp', icon: 'crack' });
  assert.equal(crack.subject, 'the north gate');
  // Not yet (the letter is unread), and not after.
  assert.deepEqual(only(deriveSignals({ snapshot: snapshot([session()]), state: { ...upToLetter, story: { ...upToLetter.story, letterReadAt: null } }, now, story: STORY }), 'story'), []);
  assert.deepEqual(only(derive([session()], now), 'story'), []);
  for (const ward of [0, 12, 28, 48]) {
    const blocked = new Set([`32,${-1 - ward - 4}`, `32,${-1 - ward - 5}`]);
    const isFree = (x, y) => !blocked.has(`${x},${y}`) && worldgen.walkable(x, y);
    const [rift] = buildRealRifts({ signals: [crack], state: upToLetter, now, riftgen, worldgen, wardRadius: ward, isFree });
    assert.equal(rift.kind, 'story');
    assert.equal(rift.stage, 'hairline');
    assert.equal(rift.x, 32, 'straight out of the north gate');
    assert.ok(rift.y <= -1 - ward - 6, `ward ${ward}: the first free tile going north, y ${rift.y}`);
    for (let y = -1 - ward - 4; y > rift.y; y -= 1) assert.ok(!isFree(32, y) || !worldgen.walkable(32, y), `skipped a free tile at ${y}`);
    assert.ok(worldgen.heartDistance(rift.x, rift.y) > ward);
    assert.equal(rift.towards, 'whisperwood');
    assert.equal(rift.beyond, Math.round(worldgen.heartDistance(rift.x, rift.y) - ward));
    assert.equal(rift.atWalls, false);
    assert.equal(rift.warded, null);
  }
  // It can't be let go or warded.
  const [rift] = buildRealRifts({ signals: [crack], state: upToLetter, now, riftgen, worldgen });
  assert.equal(letGoRift(upToLetter, rift, now), upToLetter);
  assert.equal(wardRift(upToLetter, rift, now), upToLetter);
});

test('Story: stitching the crack completes its step, once', () => {
  const now = at(24, 12);
  let state = normalizeState({ lastSeenAt: now - DAY, tally: { buildingsDesigned: 1, finishedIds: ['claude:a'], sessionsFinished: 1 }, story: { letterReadAt: now - HOUR } }, now);
  const first = loop({ state, now, snap: snapshot([session()]) });
  state = first.state;
  const crack = first.rifts.find((r) => r.kind === 'story');
  assert.ok(state.rifts.open[STORY_RIFT_KEY]);
  // A watcher that sees no sessions for a moment doesn't take the crack away.
  const blip = loop({ state, now: now + MIN, snap: snapshot([]) });
  assert.ok(blip.rifts.some((r) => r.kind === 'story'), 'still there');
  const hiccup = loop({ state, now: now + MIN, snap: null });
  assert.ok(hiccup.rifts.some((r) => r.kind === 'story'));
  // Stitched in its Elsewhere (the shell may call stitchWild or stitchStory).
  const stitched = stitchWild(state, crack, now + HOUR);
  assert.ok(stitched.story.prologue.done['first-crack']);
  assert.equal(stitched.rifts.stitched.story, 1);
  assert.equal(stitched.rifts.history[0].how, 'stitched');
  assert.equal(stitched.rifts.history[0].key, STORY_RIFT_KEY);
  assert.ok(!stitched.rifts.open[STORY_RIFT_KEY]);
  assert.ok(Object.values(stitched.satchel.essences).reduce((a, b) => a + b, 0) > 0, 'its loot is in the satchel');
  assert.equal(stitchStory(stitched, crack, now + 2 * HOUR), stitched, 'once only');
  assert.equal(prologueStatus(stitched, STORY, { hasSessions: true }).current, 'lantern');
  const after = loop({ state: stitched, now: now + 2 * HOUR, snap: snapshot([session()]) });
  assert.deepEqual(after.sealed, [], 'nothing left to seal');
  assert.ok(!after.rifts.some((r) => r.kind === 'story'));
  // Marking the step done another way lets the loop close it: it seals, counted once.
  const marked = markStory(state, 'first-crack', now + HOUR);
  const closed = loop({ state: marked, now: now + HOUR, snap: snapshot([session()]) });
  assert.equal(closed.sealed.length, 1);
  assert.equal(closed.state.rifts.stitched.story, 1);
  assert.equal(stitchStory(closed.state, crack, now + 2 * HOUR), closed.state);
  // Without its step done, the crack is never sealed by a signal going away.
  const quiet = reconcileRifts(state, [], now + MIN);
  assert.deepEqual(quiet.sealed, []);
  assert.equal(quiet.state.rifts.stitched.story, 0);
});

/* ------------------------------------------------------------------ ward-post */

test('Ward-post: nights off on Friday and Saturday nights, from tier 2', () => {
  const crew = (now) => [session({ status: 'working', lastActivityAt: now })];
  const held = (now, over) => only(derive(crew(now), now, { settings: { wardPost: 'nights-off' }, hearth: { tier: 2 }, ...over }), 'nocturne')[0]?.held;
  assert.equal(held(at(25, 23)), 'nights-off', 'Friday evening');
  assert.equal(held(at(26, 1)), 'nights-off', 'after midnight, still Friday’s night');
  assert.equal(held(at(26, 23)), 'nights-off', 'Saturday evening');
  assert.equal(held(at(27, 3)), 'nights-off', 'Saturday’s night into Sunday');
  assert.equal(held(at(24, 23)), null, 'Thursday');
  assert.equal(held(at(25, 3)), null, 'Thursday’s night into Friday');
  assert.equal(held(at(27, 23)), null, 'Sunday');
  assert.equal(only(derive(crew(at(25, 23)), at(25, 23), { settings: { wardPost: 'nights-off' }, hearth: { tier: 1 } }), 'nocturne')[0].held, null, 'no ward-post at the Camp');
});

test('Ward-post: the patient knock and capacity at 95%', () => {
  const now = at(26, 12);
  const post = (rule) => ({ settings: { wardPost: rule }, hearth: { tier: 2 } });
  const knock = (hours, over) => only(derive([session({ status: 'needs-you', waitingSince: now - hours * HOUR })], now, over), 'knocking')[0];
  assert.equal(knock(30, post('patient-knock')).held, 'patient-knock');
  assert.equal(knock(47.9, post('patient-knock')).held, 'patient-knock');
  assert.equal(knock(48, post('patient-knock')).held, null);
  assert.equal(knock(30, post('capacity-95')).held, null, 'another rule holds nothing here');
  assert.equal(knock(30, { settings: { wardPost: 'patient-knock' } }).held, null, 'tier 1');
  const cap = (used, over) => only(derive([], now, over, { capacity: reading(used, at(28, 14)) }), 'capacity')[0];
  assert.equal(cap(91, post('capacity-95')).held, 'capacity-95');
  assert.equal(cap(95, post('capacity-95')).held, null);
  assert.equal(cap(91, post('nights-off')).held, null);
});

test('Held rifts are listed, but never placed, belled or counted as open', () => {
  const now = at(26, 12);
  let state = stateWith({ settings: { wardPost: 'patient-knock' }, hearth: { tier: 2 } }, now);
  const snap = snapshot([
    session({ status: 'needs-you', waitingSince: now - 30 * HOUR }),
    session({ id: 'claude:b', title: 'Other', status: 'needs-you', waitingSince: now - 80 * HOUR }),
  ]);
  const first = loop({ state, now, snap });
  const held = first.rifts.find((r) => r.held);
  const open = first.rifts.find((r) => !r.held);
  assert.equal(held.held, 'patient-knock');
  assert.deepEqual([held.x, held.y, held.beyond, held.towards, held.atWalls], [null, null, null, null, false]);
  assert.ok(held.spec && held.spec.name, 'still named for the list');
  assert.equal(first.rifts.at(-1), held, 'held ones come last');
  assert.ok(open.atWalls, '80 hours: at the walls');
  assert.deepEqual(first.bell.map((r) => r.key), [open.key]);
  assert.deepEqual(Object.keys(first.state.rifts.open), [open.key]);
  assert.deepEqual(first.opened.map((r) => r.key), [open.key]);
  // A rift that was open and becomes held is quietly not open: not sealed, no loot.
  state = first.state;
  const toHeld = loop({ state: { ...state, settings: { ...state.settings, wardPost: 'patient-knock' } }, now, snap: snapshot([session({ id: 'claude:b', title: 'Other', status: 'needs-you', waitingSince: now - 30 * HOUR })]) });
  assert.deepEqual(toHeld.sealed, []);
  assert.deepEqual(Object.keys(toHeld.state.rifts.open), []);
});

/* ------------------------------------------------------------------ placement */

// The ring round the vale, and each gate tile with the three tiles beyond it, stay clear of rifts.
const GATEWAYS = new Set([[32, -1, 0, -1], [-1, 20, -1, 0], [64, 14, 1, 0], [11, 44, 0, 1]]
  .flatMap(([x, y, dx, dy]) => [0, 1, 2, 3].map((k) => `${x + dx * k},${y + dy * k}`)));
const clearOfGateways = (world, { x, y }) => world.heartDistance(x, y) > 1.5 && !GATEWAYS.has(`${x},${y}`);

test('No rift stands on the ring or in a gateway, even with no ward', () => {
  // Signals whose rifts would face each gate, as close to the walls as they come.
  const facing = [['nocturne', 'working-past-bell'], ['knocking', 'needs-you-unanswered'], ['capacity', 'crew-capacity-high'], ['built', 'milestone-reached']];
  let checked = 0;
  for (let k = 0; k < 40; k += 1) {
    const signals = facing.map(([kind, id]) => ({ key: `${kind === 'nocturne' ? 'night' : kind === 'knocking' ? 'knock' : kind}:g${k}`, kind, signals: [id], urgency: 0.95, since: 1e12 + k, cause: 'A cause.', stitch: 'Mend it.', subject: 'x', bright: kind === 'built', held: null, echo: null }));
    // An engine that calls the gateways and the ring free, and little else nearby: the rule must hold anyway.
    const isFree = k % 2 ? null : (x, y) => GATEWAYS.has(`${x},${y}`) || worldgen.heartDistance(x, y) <= 1.5 || ((x + 3 * y) & 31) === 0;
    for (const rift of buildRealRifts({ signals, state: createState(), now: 1e12, riftgen, worldgen, wardRadius: 0, isFree })) {
      assert.ok(clearOfGateways(worldgen, rift), `${rift.key} at ${rift.x},${rift.y}`);
      checked += 1;
    }
  }
  assert.equal(checked, 160);
});

test('A rift is never inside the ward or the vale: seeds × tiers × urgencies (property)', () => {
  const worlds = ['hushlands', 'another story', 'lantern-7'].map((seed) => createWorldgen({ seed, regionWords: words.regionWords }));
  const radii = [0, 12, 28, 48, 72, 100, 140, 200];
  let placed = 0;
  for (const [w, world] of worlds.entries()) {
    for (const ward of radii) {
      for (const urgency of [0, 0.3, 0.55, 0.9, 0.95]) {
        const signals = [];
        for (let k = 0; k < 3; k += 1) {
          const base = { urgency, since: 1e12 + k, stitch: 'Mend it.', cause: 'A cause.', subject: `thing ${k}`, bright: false, held: null, echo: { place: 'camp', icon: 'moon' } };
          signals.push({ ...base, key: `knock:claude:w${w}k${k}`, kind: 'knocking', signals: ['needs-you-unanswered'] });
          signals.push({ ...base, key: `capacity:codex:${1e12 + k * 7 + w}`, kind: 'capacity', signals: ['crew-capacity-high'] });
          signals.push({ ...base, key: `night:2026-09-${10 + k + w}`, kind: 'nocturne', signals: ['working-past-bell'] });
          signals.push({ ...base, key: `built:plot-rise:${1e12 + k + w}`, kind: 'built', signals: ['milestone-reached'], bright: true, urgency: 0.3 });
        }
        signals.push({ key: STORY_RIFT_KEY, kind: 'story', signals: ['sync-error'], urgency: 0.2, since: 1e12, stitch: 'Step through.', cause: 'A crack.', subject: 'the north gate', bright: false, held: null, echo: { place: 'camp', icon: 'crack' } });
        // Half the time, a world crowded with objects: only some tiles are free.
        const crowded = urgency > 0.5 ? (x, y) => world.walkable(x, y) && ((x * 7 + y * 13) & 3) === 0 : (x, y) => world.walkable(x, y);
        const rifts = buildRealRifts({ signals, state: createState(), now: 1e12, riftgen, worldgen: world, wardRadius: ward, isFree: crowded });
        assert.equal(rifts.length, signals.length);
        for (const rift of rifts) {
          assert.ok(Number.isInteger(rift.x) && Number.isInteger(rift.y), `${rift.key} is placed`);
          assert.ok(!world.inHeart(rift.x, rift.y), `${rift.key} is outside the vale`);
          assert.ok(world.heartDistance(rift.x, rift.y) > ward, `${rift.key} at ${rift.x},${rift.y} is outside ward ${ward}`);
          assert.ok(clearOfGateways(world, rift), `${rift.key} at ${rift.x},${rift.y} keeps off the ring and the gateways`);
          assert.ok(rift.beyond >= 0);
          placed += 1;
        }
        // Rifts don't pile onto one tile.
        const tiles = rifts.map((r) => `${r.x},${r.y}`);
        assert.equal(new Set(tiles).size, tiles.length, `ward ${ward}: every rift has its own tile`);
      }
    }
  }
  assert.ok(placed > 1500);
});

test('Placement: nudged to a free tile within 6, closer when more urgent, the same spot for the same cause', () => {
  const sig = (urgency) => ({ key: 'knock:claude:z', kind: 'knocking', signals: ['needs-you-unanswered'], urgency, since: 5, cause: 'Waiting.', stitch: 'Answer.', subject: 'x', bright: false, held: null, echo: null });
  const base = worldgen.placeRealRift(riftgen.realRift({ key: 'knock:claude:z', subject: 'x', signals: ['needs-you-unanswered'], urgency: 0.5, tier: 1, cause: 'Waiting.' }), { urgency: 0.5, wardRadius: 12 });
  const blockedHere = (x, y) => !(Math.abs(x - base.x) <= 2 && Math.abs(y - base.y) <= 2) && worldgen.walkable(x, y);
  const [nudged] = buildRealRifts({ signals: [sig(0.5)], state: createState(), now: 10, riftgen, worldgen, wardRadius: 12, isFree: blockedHere });
  assert.ok(blockedHere(nudged.x, nudged.y), 'on a free tile');
  assert.ok(Math.hypot(nudged.x - base.x, nudged.y - base.y) <= 6, 'within 6 tiles');
  assert.ok(Math.hypot(nudged.x - base.x, nudged.y - base.y) >= 3, 'the nearest free one, just past the blocked patch');
  const [plain] = buildRealRifts({ signals: [sig(0.5)], state: createState(), now: 10, riftgen, worldgen, wardRadius: 12 });
  assert.deepEqual([plain.x, plain.y], [base.x, base.y], 'no nudge needed');
  const [again] = buildRealRifts({ signals: [sig(0.5)], state: createState(), now: 99, riftgen, worldgen, wardRadius: 12 });
  assert.deepEqual([again.id, again.x, again.y, again.spec.name], [plain.id, plain.x, plain.y, plain.spec.name], 'same cause, same rift, same place');
  const beyond = [0.1, 0.4, 0.7, 0.95].map((u) => buildRealRifts({ signals: [sig(u)], state: createState(), now: 10, riftgen, worldgen, wardRadius: 12 })[0].beyond);
  for (let i = 1; i < beyond.length; i += 1) assert.ok(beyond[i] <= beyond[i - 1] + 1, `urgency step ${i}: ${beyond}`);
  assert.ok(beyond[3] < beyond[0] - 10, 'urgent rifts come much closer');
  // A throwing isFree counts as not free, and never breaks the loop.
  const [odd] = buildRealRifts({ signals: [sig(0.5)], state: createState(), now: 10, riftgen, worldgen, wardRadius: 12, isFree: () => { throw new Error('x'); } });
  assert.ok(worldgen.heartDistance(odd.x, odd.y) > 12);
  // Without a worldgen or riftgen nothing is placed, and nothing throws.
  const [unplaced] = buildRealRifts({ signals: [sig(0.5)], state: createState(), now: 10, riftgen, worldgen: null });
  assert.deepEqual([unplaced.x, unplaced.y], [null, null]);
  const none = buildRealRifts({ signals: [sig(0.5)], state: createState(), now: 10, riftgen: null, worldgen });
  assert.deepEqual([...none], []);
  assert.equal(none.incomplete, true);
  assert.deepEqual(buildRealRifts({ signals: [null, 'x', { key: 'k' }], riftgen, worldgen }), []);
});

test('Placement: when nothing near is free, the search widens in steps to 30 tiles, and past that keeps a safe spot outside the ward', () => {
  const knock = (id, urgency = 0.5) => ({ key: `knock:claude:${id}`, kind: 'knocking', signals: ['needs-you-unanswered'], urgency, since: 5, cause: 'Waiting.', stitch: 'Answer.', subject: 'x', bright: false, held: null, echo: null });
  const baseOf = (sig, ward) => worldgen.placeRealRift(riftgen.realRift({ key: sig.key, subject: 'x', signals: sig.signals, urgency: sig.urgency, tier: 1, cause: 'Waiting.' }), { urgency: sig.urgency, wardRadius: ward });
  const safe = (rift, ward) => Number.isInteger(rift.x) && Number.isInteger(rift.y) && !worldgen.inHeart(rift.x, rift.y)
    && worldgen.heartDistance(rift.x, rift.y) > ward && clearOfGateways(worldgen, rift);
  for (const ward of [0, 12, 48]) {
    const sig = knock('z');
    const base = baseOf(sig, ward);
    const out = (rift) => Math.hypot(rift.x - base.x, rift.y - base.y);
    // An engine that calls a wide patch round the spot busy (a thick wood, a camp of objects).
    for (const busy of [8, 15, 22, 28]) {
      const isFree = (x, y) => Math.hypot(x - base.x, y - base.y) > busy && worldgen.walkable(x, y);
      const [rift] = buildRealRifts({ signals: [sig], state: createState(), now: 10, riftgen, worldgen, wardRadius: ward, isFree });
      assert.ok(isFree(rift.x, rift.y), `ward ${ward}, busy ${busy}: on a tile the engine calls free, not ${rift.x},${rift.y}`);
      assert.ok(out(rift) <= busy + 2, `ward ${ward}, busy ${busy}: the nearest room, ${out(rift).toFixed(1)} tiles out`);
      assert.ok(safe(rift, ward), `ward ${ward}, busy ${busy}: outside the ward and the vale`);
      assert.equal(rift.beyond, Math.round(worldgen.heartDistance(rift.x, rift.y) - ward));
    }
    // Busy for further than the search reaches: it keeps its own spot, which is outside the ward.
    for (const isFree of [() => false, (x, y) => Math.hypot(x - base.x, y - base.y) > 40]) {
      const [rift] = buildRealRifts({ signals: [sig], state: createState(), now: 10, riftgen, worldgen, wardRadius: ward, isFree });
      assert.deepEqual([rift.x, rift.y], [base.x, base.y], `ward ${ward}: the spot it faces its region from`);
      assert.ok(safe(rift, ward));
    }
  }
  // Several urgent rifts, with everything near the ward busy: each finds room further out, on a tile of its own.
  const ward = 12;
  const signals = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => knock(id, 0.9 + i * 0.01));
  const band = (x, y) => worldgen.heartDistance(x, y) > ward + 20 && worldgen.walkable(x, y);
  const rifts = buildRealRifts({ signals, state: createState(), now: 10, riftgen, worldgen, wardRadius: ward, isFree: band });
  assert.equal(rifts.length, signals.length);
  for (const rift of rifts) {
    assert.ok(band(rift.x, rift.y), `${rift.key} at ${rift.x},${rift.y} is on a free tile`);
    assert.ok(safe(rift, ward));
  }
  assert.equal(new Set(rifts.map((r) => `${r.x},${r.y}`)).size, rifts.length, 'every rift has its own tile');
  // With nothing free anywhere, they still never share a tile or cross the ward.
  const nowhere = buildRealRifts({ signals, state: createState(), now: 10, riftgen, worldgen, wardRadius: ward, isFree: () => false });
  assert.ok(nowhere.every((rift) => safe(rift, ward)));
  assert.equal(new Set(nowhere.map((r) => `${r.x},${r.y}`)).size, nowhere.length);
  // The story's crack, with a wide band north of the gate busy: the nearest free tile beside it.
  const crack = { key: STORY_RIFT_KEY, kind: 'story', signals: ['sync-error'], urgency: 0.2, since: 5, stitch: 'Step through.', cause: 'A crack.', subject: 'the north gate', bright: false, held: null, echo: null };
  const column = (x, y) => Math.abs(x - 32) > 8 && worldgen.walkable(x, y);
  const [story] = buildRealRifts({ signals: [crack], state: createState(), now: 10, riftgen, worldgen, wardRadius: ward, isFree: column });
  assert.ok(column(story.x, story.y), `the crack at ${story.x},${story.y} is on a free tile`);
  assert.ok(Math.abs(story.x - 32) <= 12 && safe(story, ward));
  // Wild rifts, with the ground round each spawn busy: still on a free tile in their own chunk.
  const day = dayNumber(at(24, 12));
  let checked = 0;
  for (let cx = -3; cx <= 3; cx += 1) {
    for (let cy = -3; cy <= 3; cy += 1) {
      const spawns = worldgen.wildRiftSpawns(cx, cy, day, { wardRadius: ward });
      const isFree = (x, y) => worldgen.walkable(x, y) && spawns.every((s) => Math.hypot(x - s.x, y - s.y) > 9);
      for (const rift of wildRiftsForChunk({ worldgen, riftgen, cx, cy, day, wardRadius: ward, isFree })) {
        assert.ok(isFree(rift.x, rift.y), `wild ${rift.id} at ${rift.x},${rift.y} is on a free tile`);
        assert.ok(rift.x >= cx * 32 && rift.x < cx * 32 + 32 && rift.y >= cy * 32 && rift.y < cy * 32 + 32, 'in its own chunk');
        assert.ok(safe(rift, ward));
        checked += 1;
      }
    }
  }
  assert.ok(checked > 3, `${checked} wild rifts checked`);
});

/* ------------------------------------------------------------------ wild rifts */

test('Wild rifts: every day, labelled wild, never inside the ward, closed ones stay closed', () => {
  const today = dayNumber(at(24, 12));
  const seen = new Set();
  let count = 0;
  for (const ward of [0, 12, 48, 140]) {
    for (let day = today; day < today + 6; day += 1) {
      for (let cy = -4; cy <= 4; cy += 1) {
        for (let cx = -4; cx <= 5; cx += 1) {
          const isFree = (x, y) => worldgen.walkable(x, y) && (x + y) % 5 !== 0;
          for (const rift of wildRiftsForChunk({ worldgen, riftgen, cx, cy, day, wardRadius: ward, isFree })) {
            assert.equal(rift.kind, 'wild');
            assert.equal(rift.key, null);
            assert.equal(rift.atWalls, false);
            assert.ok(!worldgen.inHeart(rift.x, rift.y));
            assert.ok(worldgen.heartDistance(rift.x, rift.y) > ward, `wild ${rift.id} at ${rift.x},${rift.y} inside ward ${ward}`);
            assert.ok(clearOfGateways(worldgen, rift), `wild ${rift.id} at ${rift.x},${rift.y} keeps off the gateways`);
            assert.ok(rift.x >= cx * 32 && rift.x < cx * 32 + 32 && rift.y >= cy * 32 && rift.y < cy * 32 + 32, 'in its own chunk');
            assert.equal(rift.cause, WILD_CAUSE);
            assert.equal(rift.since, new Date(new Date(rift.since).setHours(0, 0, 0, 0)).getTime(), 'since the start of the day');
            seen.add(rift.id);
            count += 1;
          }
        }
      }
    }
  }
  assert.ok(count > 100, `${count} wild rifts`);
  assertCalm(WILD_CAUSE, 'wild cause');
  assertCalm(WILD_STITCH, 'wild stitch');
  assert.match(WILD_CAUSE, /wild/);
  // The same chunk and day always gives the same rifts; another day, others.
  const pick = (day, closed) => wildRiftsForChunk({ worldgen, riftgen, cx: 2, cy: -3, day, wardRadius: 12, closed });
  let day = today;
  while (!pick(day).length) day += 1;
  const rifts = pick(day);
  assert.deepEqual(pick(day).map((r) => [r.id, r.x, r.y]), rifts.map((r) => [r.id, r.x, r.y]));
  const id = rifts[0].id;
  for (const closed of [new Set([id]), [id], { [id]: day }, { [id]: true }]) assert.ok(!pick(day, closed).some((r) => r.id === id), JSON.stringify([...(closed instanceof Set ? closed : [closed])]));
  assert.ok(pick(day, { [id]: day - 1 }).some((r) => r.id === id), 'closed yesterday is not closed today');
  for (const junk of [{}, { worldgen }, { worldgen, riftgen, cx: 0.5, cy: 0, day }, { worldgen, riftgen, cx: 0, cy: 0, day: NaN }]) assert.deepEqual(wildRiftsForChunk(junk), []);
});

test('Wild rifts: stitch, let go, the ladder and loot', () => {
  const now = at(24, 12);
  const today = dayNumber(now);
  let day = today;
  let wild = [];
  for (let cx = 3; !wild.length; cx += 1) wild = wildRiftsForChunk({ worldgen, riftgen, cx, cy: -3, day, wardRadius: 0 });
  const [rift] = wild;
  let state = createState(now);
  state = stitchWild(state, rift, now);
  assert.equal(state.rifts.closedWild[rift.id], today);
  assert.equal(state.rifts.stitched.wild, 1);
  assert.equal(state.rifts.deepest, rift.spec.depth);
  assert.equal(state.rifts.history[0].how, 'stitched');
  assert.equal(state.rifts.history[0].kind, 'wild');
  assert.equal(state.rifts.history[0].key, null);
  assert.ok(state.rifts.visited[rift.id], 'its loot was claimed');
  const essences = Object.values(state.satchel.essences).reduce((a, b) => a + b, 0);
  assert.ok(essences > 0);
  assert.equal(stitchWild(state, rift, now + MIN), state, 'once a day');
  // The ladder: a deeper rung, stitched from its spec alone.
  const deeper = riftgen.deeper(rift.spec);
  const rung = stitchWild(state, { kind: 'wild', spec: deeper }, now + HOUR);
  assert.equal(rung.rifts.stitched.wild, 2);
  assert.equal(rung.rifts.deepest, Math.max(rift.spec.depth, deeper.depth));
  // Let go: closed for today, no loot, not counted.
  const other = wildRiftsForChunk({ worldgen, riftgen, cx: 9, cy: 9, day, wardRadius: 0 })[0] || { id: 'rift:zz9', kind: 'wild', spec: { id: 'rift:zz9', genres: ['noir'], name: 'The Rainy Case', depth: 1, loot: [] } };
  const released = letGoWild(state, other, now);
  assert.equal(released.rifts.closedWild[other.id], today);
  assert.equal(released.rifts.stitched.wild, 1);
  assert.equal(released.rifts.history[0].how, 'let-go');
  assert.deepEqual(released.satchel, state.satchel);
  assert.equal(letGoWild(state, { kind: 'real', key: 'knock:x', since: 1, spec: rift.spec }, now), state, 'only wild rifts');
  // Tomorrow the day's closures are gone.
  assert.deepEqual(normalizeState(released, now + DAY).rifts.closedWild, {});
});

test('stitchWild mends wild rifts only: a real rift is refused, the story’s crack goes to stitchStory', () => {
  const now = at(24, 12);
  // A real rift's seam won't take the thread, whether it comes as the Rift or as its bare spec.
  const { rifts: [real], state: withReal } = loop({ state: stateWith({}, now), now, snap: snapshot([], { capacity: reading(90, at(28, 14)) }) });
  assert.equal(real.spec.kind, 'real');
  for (const rift of [real, real.spec, { kind: 'wild', spec: real.spec }, { id: real.id, key: real.key, genres: real.spec.genres }]) {
    assert.equal(stitchWild(withReal, rift, now), withReal, 'no wild stitch, no loot');
    assert.equal(letGoWild(withReal, rift, now), withReal);
    assert.equal(stitchStory(withReal, rift, now), withReal, 'and it isn’t the story’s crack');
  }
  // The story's crack, as its bare spec: riftgen makes it a real rift with the story's key.
  const upToCrack = normalizeState({ lastSeenAt: now - DAY, tally: { buildingsDesigned: 1, finishedIds: ['claude:a'], sessionsFinished: 1 }, story: { letterReadAt: now - HOUR } }, now);
  const opened = loop({ state: upToCrack, now, snap: snapshot([session()]) });
  const crack = opened.rifts.find((r) => r.kind === 'story');
  assert.deepEqual([crack.spec.kind, crack.spec.key], ['real', STORY_RIFT_KEY]);
  const bySpec = stitchWild(opened.state, crack.spec, now + HOUR);
  assert.ok(bySpec.story.prologue.done['first-crack'], 'the Prologue moves on');
  assert.deepEqual(bySpec.rifts.stitched, { real: 0, wild: 0, story: 1 });
  assert.deepEqual(bySpec.rifts.closedWild, {});
  assert.deepEqual([bySpec.rifts.history[0].key, bySpec.rifts.history[0].kind, bySpec.rifts.history[0].how], [STORY_RIFT_KEY, 'story', 'stitched']);
  assert.ok(!bySpec.rifts.open[STORY_RIFT_KEY]);
  assert.ok(bySpec.rifts.visited[crack.id], 'its loot was claimed');
  assert.equal(prologueStatus(bySpec, STORY, { hasSessions: true }).current, 'lantern');
  assert.deepEqual(stitchWild(opened.state, crack, now + HOUR), bySpec, 'the same as stitching the Rift');
  assert.equal(stitchWild(bySpec, crack.spec, now + 2 * HOUR), bySpec, 'once only');
  for (const rift of [crack, crack.spec]) assert.equal(letGoWild(opened.state, rift, now), opened.state, 'the crack can’t be let go');
  // Nor is a wild rift the story's crack.
  let wild = [];
  for (let cx = 3; !wild.length; cx += 1) wild = wildRiftsForChunk({ worldgen, riftgen, cx, cy: -3, day: dayNumber(now), wardRadius: 0 });
  for (const rift of [wild[0], wild[0].spec]) assert.equal(stitchStory(opened.state, rift, now), opened.state);
});

test('claimLoot adds essences, relics and materials once per rift', () => {
  const now = at(24, 12);
  const spec = {
    id: 'rift:abc123',
    loot: [
      { item: 'Neon shard', qty: 3, genre: 'neon' },
      { item: 'Maelstrom glass', qty: 1, genre: null },
      { item: 'Flickering lamp of Kiro', qty: 1, genre: 'neon', relic: true, text: 'Once belonged to Kiro, who filed everything.' },
      { item: 'Birch', qty: 4, genre: null },
      { item: '', qty: 9 }, 'junk',
    ],
  };
  const state = createState(now);
  const claimed = claimLoot(state, spec, now, { materials: { ash: 5, pine: -2, stone: 3 } });
  assert.deepEqual(claimed.satchel.essences, { 'Neon shard': 3, 'Maelstrom glass': 1 });
  assert.deepEqual(claimed.satchel.essenceGenres, { 'Neon shard': 'neon' }, 'each essence’s genre, as its loot said (Maelstrom glass has none)');
  assert.deepEqual(claimed.satchel.materials, { birch: 4, ash: 5, pine: 0 });
  assert.deepEqual(claimed.satchel.relics, [{ name: 'Flickering lamp of Kiro', text: 'Once belonged to Kiro, who filed everything.', genre: 'neon', at: now }]);
  assert.equal(claimed.rifts.visited['rift:abc123'], now);
  assert.equal(claimLoot(claimed, spec, now + HOUR), claimed, 'once per rift');
  assert.equal(state.satchel.materials.birch, 0, 'the state given is left alone');
  assert.equal(claimLoot(state, { loot: [] }, now), state, 'no id, nothing claimed');
  assert.equal(claimLoot(state, spec, now, { riftId: 'not an id' }), state);
  const byId = claimLoot(state, { loot: spec.loot }, now, { riftId: 'rift:other' });
  assert.ok(byId.rifts.visited['rift:other']);
  // visited keeps the newest 300.
  let many = state;
  for (let i = 0; i < 305; i += 1) many = claimLoot(many, { id: `rift:m${i}`, loot: [] }, now + i);
  assert.equal(Object.keys(many.rifts.visited).length, 300);
  assert.ok(!many.rifts.visited['rift:m0'] && many.rifts.visited['rift:m304']);
  assert.deepEqual(normalizeState(claimed, now).satchel, claimed.satchel, 'the satchel survives a save');
});

/* ------------------------------------------------------------------ reconcile: seals, bells, let go, wards */

test('Seals: a signal that clears seals its rift, into history, with its loot', () => {
  const now = at(24, 9);
  let state = stateWith({}, now);
  const snapAt = (used) => snapshot([], { capacity: reading(used, at(28, 14)) });
  const first = loop({ state, now, snap: snapAt(90) });
  assert.equal(first.opened.length, 1);
  const rift = first.opened[0];
  assert.equal(first.state.rifts.open[rift.key].id, rift.id);
  state = first.state;
  const quiet = loop({ state, now: now + HOUR, snap: snapAt(84) });
  assert.equal(quiet.sealed.length, 1);
  const [sealed] = quiet.sealed;
  assert.deepEqual([sealed.key, sealed.id, sealed.name, sealed.kind, sealed.bright], [rift.key, rift.id, rift.spec.name, 'real', false]);
  assert.deepEqual(sealed.genres, rift.spec.genres);
  assert.deepEqual(sealed.loot, rift.spec.loot.map(({ item, qty, genre, relic, text }) => (relic ? { item, qty, genre, relic, text } : { item, qty, genre })));
  assert.equal(quiet.state.rifts.stitched.real, 1);
  assert.deepEqual(quiet.state.rifts.open, {});
  assert.deepEqual(quiet.state.rifts.history[0], { key: rift.key, id: rift.id, name: rift.spec.name, genres: rift.spec.genres, kind: 'real', openedAt: now, closedAt: now + HOUR, how: 'sealed', since: rift.since });
  const essences = rift.spec.loot.filter((l) => !l.relic);
  for (const item of essences) assert.equal(quiet.state.satchel.essences[item.item], item.qty);
  assert.equal(sealedSummary(quiet.sealed), 'While you were away, the Codex capacity rift sealed itself.');
  // The refill passing seals it too.
  const refilled = loop({ state, now: at(28, 14), snap: snapAt(99) });
  assert.equal(refilled.sealed.length, 1);
  assert.deepEqual(normalizeState(quiet.state, now + HOUR), quiet.state, 'the sealed state saves cleanly');
});

test('Seals at boot come together for one quiet summary; a bright rift fades with no loot', () => {
  const now = at(26, 12);
  let state = stateWith({ plots: { 'plot-rise': builtPlot(now - HOUR) } }, now);
  const snap = snapshot([
    session({ status: 'needs-you', waitingSince: now - 30 * HOUR }),
    session({ id: 'claude:b', title: 'Second', status: 'needs-you', waitingSince: now - 40 * HOUR }),
  ]);
  const first = loop({ state, now, snap });
  assert.equal(first.opened.length, 3);
  assert.ok(first.opened.some((r) => r.bright));
  state = first.state;
  // MILO closed for four days; both sessions were answered and the building's glow faded.
  const boot = loop({ state, now: now + 4 * DAY, snap: snapshot([session({ status: 'done' })]) });
  assert.equal(boot.sealed.length, 3);
  assert.equal(sealedSummary(boot.sealed), 'While you were away, 2 rifts sealed themselves.');
  const bright = boot.sealed.find((s) => s.bright);
  assert.deepEqual(bright.loot, []);
  assert.equal(boot.state.rifts.stitched.real, 2, 'a fading bright rift mended nothing');
  assert.equal(boot.state.rifts.history.filter((h) => h.how === 'sealed').length, 3);
  assert.equal(sealedSummary([bright]), null, 'bright rifts never bubble');
  assert.equal(sealedSummary(boot.sealed.filter((s) => s.key === 'knock:claude:a')), `While you were away, the rift over ${OPEN}Letters to answer${CLOSE} sealed itself.`);
  assert.equal(sealedSummary([{ realKind: 'nocturne', subject: 'Friday night', kind: 'real' }]), 'While you were away, the rift from Friday night sealed itself.');
  assert.equal(sealedSummary([{ kind: 'story' }]), 'While you were away, the crack past the north gate sealed itself.');
  assert.equal(sealedSummary([]), null);
  for (const line of [sealedSummary(boot.sealed), sealedSummary([boot.sealed[0]])]) assertCalm(line, 'summary');
});

test('A watcher hiccup never seals everything', () => {
  const now = at(26, 12);
  let state = stateWith({}, now);
  const snap = snapshot([session({ status: 'needs-you', waitingSince: now - 30 * HOUR })], { capacity: reading(92, at(28, 14)) });
  state = loop({ state, now, snap }).state;
  assert.equal(Object.keys(state.rifts.open).length, 2);
  for (const bad of [null, undefined, {}, { sources: { claude: { ok: false }, codex: { ok: false } }, sessions: [] }, { sessions: [], sources: null }]) {
    const hiccup = loop({ state, now: now + MIN, snap: bad });
    assert.deepEqual(hiccup.sealed, [], `no seals for ${JSON.stringify(bad)}`);
    assert.equal(hiccup.rifts.length, 2, 'the open rifts stay standing');
    assert.ok(hiccup.rifts.every((r) => Number.isInteger(r.x)), 'and in place');
    assert.deepEqual(hiccup.rifts.map((r) => r.id).sort(), Object.values(state.rifts.open).map((o) => o.id).sort());
    assert.ok(hiccup.signals.every((s) => s.carried === true));
  }
  // Time-based ends still apply: the refill passes while the watcher is quiet.
  const refilled = loop({ state, now: at(28, 14), snap: null });
  assert.deepEqual(refilled.sealed.map((s) => s.realKind), ['capacity']);
  // And a night carried through a hiccup ends at dawn.
  let night = stateWith({}, at(24, 23));
  night = loop({ state: night, now: at(24, 23), snap: snapshot([session({ status: 'working', lastActivityAt: at(24, 23) })]) }).state;
  assert.equal(loop({ state: night, now: at(25, 5), snap: null }).sealed.length, 0);
  assert.equal(loop({ state: night, now: at(25, 6), snap: null }).sealed.length, 1);
  // An incomplete list (riftgen missing) never seals.
  const blind = reconcileRifts(state, buildRealRifts({ signals: [], state, now, riftgen: null, worldgen }), now);
  assert.deepEqual(blind.sealed, []);
  assert.equal(blind.state, state);
});

test('One source down: the rifts resting on it stay as they are, the rest follow what’s seen', () => {
  const now = at(24, 23, 30); // Thursday night
  const both = { claude: { ok: true, live: true }, codex: { ok: true, live: false } };
  const codexDown = { claude: { ok: true, live: true }, codex: { ok: false, live: false, error: 'Couldn’t read Codex’s sessions this time.' } };
  const claudeDown = { claude: { ok: false, live: false, error: 'Couldn’t read Claude Code’s sessions this time.' }, codex: { ok: true, live: false } };
  const claudeKnock = session({ status: 'needs-you', waitingSince: now - 30 * HOUR, lastActivityAt: now - 30 * HOUR });
  const codexKnock = session({ id: 'codex:b', agent: 'codex', sessionId: 'b', title: 'Port the parser', status: 'needs-you', waitingSince: now - 40 * HOUR, lastActivityAt: now - 40 * HOUR });
  const codexNight = session({ id: 'codex:c', agent: 'codex', sessionId: 'c', title: 'Night build', status: 'working', startedAt: at(24, 22, 10), lastActivityAt: now });
  const capacity = reading(92, at(28, 14));
  const nightKey = 'night:2026-09-24';
  const capKey = `capacity:codex:${at(28, 14)}`;
  let state = stateWith({}, now);
  const first = loop({ state, now, snap: snapshot([claudeKnock, codexKnock, codexNight], { sources: both, capacity }) });
  state = first.state;
  const keys = [capKey, 'knock:claude:a', 'knock:codex:b', nightKey].sort();
  assert.deepEqual(Object.keys(state.rifts.open).sort(), keys);
  assert.deepEqual(state.rifts.open[nightKey].agents, ['codex'], 'the night rests on Codex');
  assert.deepEqual(first.rifts.find((r) => r.key === nightKey).agents, ['codex']);
  // Codex can't be read for a moment: the watcher hands over Claude's sessions and no capacity.
  const t1 = now + 5 * MIN;
  const codexHiccup = loop({ state, now: t1, snap: snapshot([claudeKnock], { sources: codexDown, capacity: { codex: null } }) });
  assert.deepEqual(codexHiccup.sealed, [], 'nothing of Codex’s seals, and no loot is paid');
  assert.deepEqual(codexHiccup.rifts.map((r) => r.key).sort(), keys);
  assert.deepEqual(codexHiccup.signals.filter((s) => s.carried).map((s) => s.key).sort(), [capKey, 'knock:codex:b', nightKey].sort());
  assert.equal(codexHiccup.state.rifts.stitched.real, 0);
  // A capacity reading beside a Codex source that isn't ok isn't trusted either.
  const halfRead = loop({ state, now: t1, snap: snapshot([claudeKnock], { sources: codexDown, capacity: reading(40, at(28, 14)) }) });
  assert.deepEqual(halfRead.sealed, []);
  // What Claude's source does see still counts: an answered session seals while Codex is down.
  const answered = loop({ state, now: t1, snap: snapshot([{ ...claudeKnock, status: 'done' }], { sources: codexDown, capacity: { codex: null } }) });
  assert.deepEqual(answered.sealed.map((s) => s.key), ['knock:claude:a']);
  // Codex back: its answered session, a reading under the line and a quiet crew seal for real.
  const back = loop({ state: codexHiccup.state, now: now + HOUR, snap: snapshot([claudeKnock, { ...codexKnock, status: 'done' }, { ...codexNight, status: 'done' }], { sources: both, capacity: reading(40, at(28, 14)) }) });
  assert.deepEqual(back.sealed.map((s) => s.key).sort(), [capKey, 'knock:codex:b', nightKey].sort());
  // Claude can't be read: its knock stays, Codex's rifts follow Codex.
  const claudeHiccup = loop({ state, now: t1, snap: snapshot([codexKnock, codexNight], { sources: claudeDown, capacity }) });
  assert.deepEqual(claudeHiccup.sealed, []);
  assert.deepEqual(claudeHiccup.signals.filter((s) => s.carried).map((s) => s.key), ['knock:claude:a']);
  const codexAnswered = loop({ state, now: t1, snap: snapshot([{ ...codexKnock, status: 'done' }, codexNight], { sources: claudeDown, capacity }) });
  assert.deepEqual(codexAnswered.sealed.map((s) => s.key), ['knock:codex:b']);
  // A night both worked in rests on both: either source down carries it.
  let shared = loop({ state, now: t1, snap: snapshot([claudeKnock, codexKnock, codexNight, session({ id: 'claude:n', status: 'working', startedAt: at(24, 23), lastActivityAt: t1 })], { sources: both, capacity }) }).state;
  assert.deepEqual(shared.rifts.open[nightKey].agents, ['claude', 'codex']);
  assert.deepEqual(normalizeState(shared, t1).rifts.open[nightKey].agents, ['claude', 'codex'], 'saved with the state');
  const quietClaude = session({ id: 'claude:n', status: 'done', startedAt: at(24, 23), lastActivityAt: t1 });
  const late = now + 2 * HOUR; // everyone seen has been quiet for over 45 minutes
  const carried = loop({ state: shared, now: late, snap: snapshot([claudeKnock, quietClaude], { sources: codexDown, capacity: { codex: null } }) });
  assert.ok(!carried.sealed.some((s) => s.key === nightKey), 'Codex may still be working');
  shared = loop({ state: shared, now: late, snap: snapshot([claudeKnock, quietClaude, codexKnock, { ...codexNight, status: 'done', lastActivityAt: t1 }], { sources: both, capacity }) }).state;
  assert.ok(!shared.rifts.open[nightKey], 'seen quiet by both, it seals');
  // Without Codex on this PC at all, a night Claude worked seals as usual when Claude goes quiet.
  const noCodex = { claude: { ok: true, live: true }, codex: { ok: false, live: false, error: 'Couldn’t find Codex’s folder on this PC.' } };
  let solo = stateWith({}, at(24, 23));
  solo = loop({ state: solo, now: at(24, 23), snap: snapshot([session({ status: 'working', lastActivityAt: at(24, 23) })], { sources: noCodex }) }).state;
  assert.deepEqual(solo.rifts.open[nightKey].agents, ['claude']);
  const sleep = loop({ state: solo, now: at(24, 23, 45), snap: snapshot([session({ status: 'done', lastActivityAt: at(24, 23) })], { sources: noCodex }) });
  assert.deepEqual(sleep.sealed.map((s) => s.key), [nightKey]);
});

test('A new episode under the same key seals the old one and opens the new', () => {
  const now = at(26, 12);
  let state = stateWith({}, now);
  state = loop({ state, now, snap: snapshot([session({ status: 'needs-you', waitingSince: now - 30 * HOUR })]) }).state;
  const next = loop({ state, now: now + 3 * DAY, snap: snapshot([session({ status: 'needs-you', waitingSince: now + 2 * DAY - HOUR })]) });
  assert.equal(next.sealed.length, 1);
  assert.equal(next.opened.length, 1);
  assert.equal(next.state.rifts.open['knock:claude:a'].since, now + 2 * DAY - HOUR);
});

test('The Gate Bell rings once per episode, with a note only from the Stockade on', () => {
  const now = at(26, 12);
  const snap = (hours) => snapshot([session({ status: 'needs-you', waitingSince: now - hours * HOUR })]);
  let state = stateWith({}, now);
  const near = loop({ state, now, snap: snap(64) });
  assert.deepEqual(near.bell, [], 'not at the walls yet');
  state = near.state;
  const walls = loop({ state, now: now + 8 * HOUR, snap: snap(64) });
  assert.equal(walls.rifts[0].atWalls, true);
  assert.deepEqual(walls.bell.map((r) => r.key), ['knock:claude:a']);
  assert.equal(walls.notify, false, 'tier 1: a bubble only');
  assert.deepEqual(walls.state.rifts.belled['knock:claude:a'], { since: now - 64 * HOUR, at: now + 8 * HOUR });
  state = walls.state;
  assert.deepEqual(loop({ state, now: now + 9 * HOUR, snap: snap(64) }).bell, [], 'once');
  // The Stockade: a desktop note, unless the Gate Bell is off.
  const stockade = { ...state, hearth: { tier: 2, raisedAt: {} } };
  assert.equal(reconcileRifts(stockade, [], now).notify, true);
  assert.equal(reconcileRifts({ ...stockade, settings: { ...stockade.settings, gateBell: false } }, [], now).notify, false);
  assert.equal(reconcileRifts(state, [], now, { tier: 2 }).notify, true, 'the tier can be passed in');
  const note = bellText(walls.bell[0]);
  assert.equal(note.title, 'A rift is at the walls');
  assert.equal(note.body, walls.bell[0].cause);
  assertCalm(note.title, 'bell title');
  assertCalm(note.body, 'bell body');
  assertCalm(bellText(null).body, 'bell fallback');
  // A new episode rings again.
  const again = loop({ state, now: now + 5 * DAY, snap: snapshot([session({ status: 'needs-you', waitingSince: now + 5 * DAY - 80 * HOUR })]) });
  assert.equal(again.bell.length, 1);
});

test('Nothing changed: reconcile hands back the same state', () => {
  const now = at(26, 12);
  const snap = snapshot([session({ status: 'needs-you', waitingSince: now - 30 * HOUR })]);
  const { state } = loop({ state: stateWith({}, now), now, snap });
  const same = loop({ state, now, snap });
  assert.equal(same.state, state);
  assert.deepEqual([same.opened, same.sealed, same.bell], [[], [], []]);
  for (const junk of [null, 'x', 5]) assert.doesNotThrow(() => reconcileRifts(junk, junk, now));
});

test('Let go: gone until the episode changes; bright rifts are let be, the story can’t be let go', () => {
  const now = at(26, 12);
  const snapFor = (since) => snapshot([session({ status: 'needs-you', waitingSince: since })]);
  let state = stateWith({}, now);
  const first = loop({ state, now, snap: snapFor(now - 30 * HOUR) });
  const [rift] = first.rifts;
  state = letGoRift(first.state, rift, now + MIN);
  assert.deepEqual(state.rifts.letGo['knock:claude:a'], { since: rift.since, at: now + MIN });
  assert.ok(!state.rifts.open['knock:claude:a']);
  assert.equal(state.rifts.history[0].how, 'let-go');
  assert.equal(state.rifts.stitched.real, 0);
  const hidden = loop({ state, now: now + HOUR, snap: snapFor(now - 30 * HOUR) });
  assert.deepEqual(hidden.rifts, [], 'omitted while it is the same episode');
  assert.deepEqual([hidden.sealed, hidden.opened, hidden.bell], [[], [], []]);
  assert.ok(hidden.state.rifts.letGo['knock:claude:a'], 'still let go');
  // Still let go after a month of the same wait.
  assert.deepEqual(loop({ state, now: now + 40 * DAY, snap: snapFor(now - 30 * HOUR) }).rifts, []);
  // A new episode (it was answered and is waiting again) comes back.
  const back = loop({ state, now: now + 3 * DAY, snap: snapFor(now + DAY) });
  assert.equal(back.rifts.length, 1);
  assert.equal(back.opened.length, 1);
  assert.ok(!back.state.rifts.letGo['knock:claude:a'], 'the old let-go is tidied away');
  // A let-go night stays let go all night, even after a quiet spell.
  let night = stateWith({}, at(24, 23));
  const crew = (t) => snapshot([session({ status: 'working', startedAt: at(24, 22, 30), lastActivityAt: t })]);
  const nightRift = loop({ state: night, now: at(24, 23), snap: crew(at(24, 23)) });
  night = letGoRift(nightRift.state, nightRift.rifts[0], at(24, 23));
  const quietThenBack = loop({ state: night, now: at(25, 1), snap: snapshot([session({ status: 'working', startedAt: at(25, 0, 50), lastActivityAt: at(25, 1) })]) });
  assert.deepEqual(quietThenBack.rifts, []);
  // Bright: let be.
  const brightState = stateWith({ plots: { 'plot-rise': builtPlot(now - HOUR) } }, now);
  const brightRun = loop({ state: brightState, now, snap: snapshot([]) });
  const [bright] = brightRun.rifts;
  const beenLetBe = letGoRift(brightRun.state, bright, now);
  assert.deepEqual(beenLetBe, letItBe(brightRun.state, bright, now));
  assert.equal(beenLetBe.rifts.history[0].how, 'sealed', 'a bright rift is let be, never let go');
  assert.deepEqual(loop({ state: beenLetBe, now: now + MIN, snap: snapshot([]) }).rifts, [], 'and hidden');
  assert.equal(letItBe(state, rift, now), state, 'only bright rifts are let be');
  assert.equal(letGoRift(state, { kind: 'wild', key: 'x', since: 1 }, now), state);
});

test('Wards: three days, the stage held, never at the walls; gone once they lapse or the episode moves', () => {
  const now = at(26, 12);
  const snap = snapshot([session({ status: 'needs-you', waitingSince: now - 30 * HOUR })]);
  let state = stateWith({}, now);
  const first = loop({ state, now, snap });
  const [rift] = first.rifts;
  assert.equal(rift.stage, 'open');
  state = wardRift(first.state, rift, now);
  assert.deepEqual(state.rifts.warded['knock:claude:a'], { since: rift.since, until: now + 3 * DAY, stage: 'open' });
  // A day later it would be gaping and at the walls; warded, it holds.
  const held = loop({ state, now: now + 2 * DAY, snap });
  const [warded] = held.rifts;
  assert.ok(warded.urgency >= 0.9);
  assert.equal(warded.stage, 'open');
  assert.equal(warded.spec.stage, 'open');
  assert.equal(warded.id, rift.id, 'the same rift');
  assert.deepEqual(warded.warded, { until: now + 3 * DAY, stage: 'open' });
  assert.equal(warded.atWalls, false);
  assert.deepEqual(held.bell, []);
  assert.ok(Number.isInteger(warded.x));
  // Re-warding keeps the stage it was warded at.
  assert.equal(wardRift(held.state, warded, now + 2 * DAY).rifts.warded['knock:claude:a'].stage, 'open');
  // After three days the ward lapses: the real stage, the walls and the bell.
  const lapsed = loop({ state: held.state, now: now + 3 * DAY, snap });
  assert.equal(lapsed.rifts[0].warded, null);
  assert.equal(lapsed.rifts[0].stage, 'gaping');
  assert.equal(lapsed.rifts[0].atWalls, true);
  assert.equal(lapsed.bell.length, 1);
  assert.ok(!lapsed.state.rifts.warded['knock:claude:a'], 'the lapsed ward is tidied away');
  // Taking the ward down.
  const down = unwardRift(state, 'knock:claude:a');
  assert.ok(!down.rifts.warded['knock:claude:a']);
  assert.equal(unwardRift(down, 'knock:claude:a'), down);
  assert.equal(loop({ state: down, now: now + 2 * DAY, snap }).rifts[0].stage, 'gaping');
  // A new episode is not warded.
  const moved = loop({ state, now: now + DAY, snap: snapshot([session({ status: 'needs-you', waitingSince: now - 40 * HOUR })]) });
  assert.equal(moved.rifts[0].warded, null);
  assert.ok(!moved.state.rifts.warded['knock:claude:a']);
  // Only real, standing rifts can be warded.
  for (const other of [{ ...rift, bright: true }, { ...rift, kind: 'story' }, { ...rift, held: 'patient-knock' }, { ...rift, kind: 'wild' }, null]) {
    assert.equal(wardRift(state, other, now), state);
  }
});

/* ------------------------------------------------------------------ calm copy everywhere */

test('Every cause and stitch is calm, plain and within its length', () => {
  const now = at(25, 1, 30);
  const titles = ['Letters to answer', 'fix: the "big" refactor', 'x'.repeat(90), '\u{1F319} moon notes', 'ALL CAPS TITLE', ''];
  const sessions = [];
  titles.forEach((title, i) => {
    sessions.push(session({ id: `claude:k${i}`, title, status: 'needs-you', waitingSince: now - (24 + i * 17) * HOUR }));
    sessions.push(session({ id: `codex:k${i}`, agent: 'codex', title, status: 'needs-you', waitingSince: now - (25 + i * 31) * HOUR }));
  });
  sessions.push(session({ id: 'claude:w', status: 'working', lastActivityAt: now }));
  const plots = { 'plot-rise': builtPlot(now - HOUR), 'plot-pond': builtPlot(now - 50 * HOUR, 'The sorting office'), 'plot-birch': builtPlot(now - 30 * HOUR, 'Chris’s draft room') };
  let checked = 0;
  for (const used of [85, 91.5, 100]) {
    for (const windowMinutes of [10080, 1440, 300, 0]) {
      for (const resetsAt of [now + HOUR, now + 30 * HOUR, now + 4 * DAY, now + 10 * DAY]) {
        const signals = derive(sessions, now, { plots }, { capacity: reading(used, resetsAt, { windowMinutes }) });
        for (const sig of signals) {
          assertSignalCopy(sig);
          checked += 1;
        }
      }
    }
  }
  const upToLetter = normalizeState({ lastSeenAt: now - DAY, tally: { buildingsDesigned: 1, finishedIds: ['claude:a'], sessionsFinished: 1 }, story: { letterReadAt: now - HOUR } }, now);
  for (const sig of deriveSignals({ snapshot: snapshot([session()]), state: upToLetter, now, story: STORY })) assertSignalCopy(sig);
  assert.ok(checked > 500, `${checked} signals checked`);
});

/* ------------------------------------------------------------------ the Hearth */

const FORTRESS = {
  version: 1,
  tiers: [
    { id: 'camp', tier: 1, name: 'The Camp', look: 'A tent.', wardRadius: 0, requirements: [], materials: {}, construction: 1, defences: [{ name: 'The Lantern Hook', real: 'Sanctuary.' }], unlocks: ['Plots'] },
    {
      id: 'stockade', tier: 2, name: 'The Stockade', look: 'A palisade.', wardRadius: 12,
      requirements: [
        { kind: 'crew-sessions-finished', count: 20, text: 'Watch 20 crew sessions finish' },
        { kind: 'buildings-designed', count: 1, text: 'Design your first building' },
        { kind: 'days-with-milo', count: 7, text: 'Spend a week with MILO' },
      ],
      materials: { birch: 80, ash: 30 }, construction: 5, constructionFrom: 'Phase 4',
      defences: [{ name: 'The War Table', real: 'Every open rift on one map.' }], unlocks: ['A gate'],
    },
    {
      id: 'hold', tier: 3, name: 'The Hold', look: 'Stone walls.', wardRadius: 28,
      requirements: [{ kind: 'focus-sessions', count: 30, text: 'Complete 30 focus sessions' }, { kind: 'building-level', count: 1, text: 'Prove a building’s level 1' }, { kind: 'mystery', count: 2, text: 'Something new' }],
      materials: { birch: 150, stone: 200, 'maelstrom-glass': 1 }, construction: 15, defences: [], unlocks: [],
    },
  ],
};

test('hearthStatus reads the Stockade’s requirements from real counts', () => {
  const state = normalizeState({ tally: { sessionsFinished: 12, buildingsDesigned: 1, daysSeen: 3, lastDay: '2026-09-24' }, satchel: { materials: { birch: 50, ash: 30 } } }, at(24, 12));
  const status = hearthStatus(state, FORTRESS);
  assert.equal(status.tier, 1);
  assert.equal(status.def.id, 'camp');
  assert.equal(status.wardRadius, 0);
  const next = status.next;
  assert.deepEqual([next.id, next.tier, next.name, next.look], ['stockade', 2, 'The Stockade', 'A palisade.']);
  assert.deepEqual(next.requirements, [
    { kind: 'crew-sessions-finished', count: 20, have: 12, met: false, text: 'Watch 20 crew sessions finish', future: false },
    { kind: 'buildings-designed', count: 1, have: 1, met: true, text: 'Design your first building', future: false },
    { kind: 'days-with-milo', count: 7, have: 3, met: false, text: 'Spend a week with MILO', future: false },
  ]);
  assert.deepEqual(next.materials, [{ id: 'birch', name: 'birch', need: 80, have: 50, met: false }, { id: 'ash', name: 'ash', need: 30, have: 30, met: true }]);
  assert.equal(next.construction, 5);
  assert.equal(next.constructionFrom, 'Phase 4');
  assert.equal(next.ready, false);
  assert.deepEqual(next.defences, [{ name: 'The War Table', real: 'Every open rift on one map.' }]);
  assert.deepEqual(next.unlocks, ['A gate']);
  const { ok, reason, state: same } = raiseHearth(state, FORTRESS, at(24, 12));
  assert.equal(ok, false);
  assert.equal(same, state);
  assert.equal(reason, 'Not yet. Still to do: watch 20 crew sessions finish (12 of 20), spend a week with MILO (3 of 7) and 30 more birch.');
  assertCalm(reason, 'not ready');
});

test('raiseHearth spends the materials and raises the tier when ready', () => {
  const now = at(24, 12);
  let state = normalizeState({ tally: { sessionsFinished: 20, buildingsDesigned: 1, daysSeen: 7, lastDay: '2026-09-24' }, satchel: { materials: { birch: 95, ash: 30, pine: 4 }, essences: { 'Neon shard': 2 } } }, now);
  assert.equal(hearthStatus(state, FORTRESS).next.ready, true);
  const raised = raiseHearth(state, FORTRESS, now);
  assert.equal(raised.ok, true);
  assert.equal(raised.reason, 'The Stockade is raised.');
  assert.deepEqual(raised.state.hearth, { tier: 2, raisedAt: { stockade: now } });
  assert.deepEqual(raised.state.satchel.materials, { birch: 15, ash: 0, pine: 4 });
  assert.deepEqual(raised.state.satchel.essences, { 'Neon shard': 2 });
  assert.equal(state.hearth.tier, 1, 'the state given is left alone');
  state = raised.state;
  assert.equal(wardRadius(state, FORTRESS), 12);
  assert.equal(hearthTier(state), 2);
  assert.deepEqual(normalizeState(state, now), state, 'the raised state saves cleanly');
  // The Hold: kinds MILO can't count yet say when they arrive, and never count as met.
  // Phase 4 changes this pin on purpose (CONTRACT-PHASE4 §13, A): Kindle counts focus sessions now.
  const hold = hearthStatus(state, FORTRESS).next;
  assert.deepEqual(hold.requirements.map((r) => [r.kind, r.have, r.met, r.future, r.note]), [
    ['focus-sessions', 0, false, false, undefined],
    ['building-level', 0, false, true, 'Arrives with Commissions'],
    ['mystery', 0, false, true, 'Arrives later'],
  ]);
  for (const r of hold.requirements.filter((req) => req.future)) assertCalm(r.note, r.kind);
  const focused = { ...state, tally: { ...state.tally, focusSessions: 30 } };
  assert.deepEqual(hearthStatus(focused, FORTRESS).next.requirements[0], { kind: 'focus-sessions', count: 30, have: 30, met: true, text: 'Complete 30 focus sessions', future: false }, 'thirty finished focus sessions meet it');
  assert.deepEqual(hold.materials.map((m) => [m.id, m.have, !!m.future, m.note]), [
    ['birch', 15, false, undefined], ['stone', 0, true, 'Mined in the vale once the Notice Board arrives'], ['maelstrom-glass', 0, false, undefined],
  ]);
  assert.equal(hold.ready, false);
  // Materials the wilds don't give yet aren't asked for: they're named once, as coming later.
  const holdReason = raiseHearth(state, FORTRESS, now).reason;
  assert.equal(holdReason, 'Not yet. Still to do: complete 30 focus sessions (0 of 30), prove a building’s level 1 (arrives with Commissions), something new (arrives later), 135 more birch and 1 more Maelstrom glass. Stone comes later.');
  assertCalm(holdReason, 'hold reason');
  const onlyLater = { tiers: [FORTRESS.tiers[0], { ...FORTRESS.tiers[1], requirements: [], materials: { stone: 5, copperstone: 2 } }] };
  assert.equal(raiseHearth(createState(), onlyLater, now).reason, 'Not yet. Stone and copperstone come later.');
  // What stands: the Camp's defences stay standing under the Stockade's.
  assert.deepEqual(hearthStatus(state, FORTRESS).def.defences.map((d) => d.name), ['The Lantern Hook', 'The War Table']);
  assert.equal(FORTRESS.tiers[1].defences.length, 1, 'the plans themselves are left alone');
  // The top tier: nothing above it.
  const top = { ...state, hearth: { tier: 3, raisedAt: {} } };
  assert.equal(hearthStatus(top, FORTRESS).next, null);
  assert.equal(raiseHearth(top, FORTRESS, now).reason, 'The Hearth is as high as it goes.');
});

test('Essences of different genres count genres, not names; Diesel cogs come from Iron rifts', () => {
  const now = at(24, 12);
  const satchelOf = (entries) => ({
    essences: Object.fromEntries(entries.map(([name, n]) => [name, n])),
    essenceGenres: Object.fromEntries(entries.filter(([, , genre]) => genre).map(([name, , genre]) => [name, genre])),
  });
  const castle = (entries) => hearthStatus(normalizeState({ hearth: { tier: 4 }, satchel: satchelOf(entries) }, now), fortress)
    .next.materials.find((m) => m.id === 'essences-of-genres');
  const twoGenres = [['Neon shard', 2, 'neon'], ['Glitch pearl', 1, 'neon'], ['Chrome scrap', 1, 'neon'], ['Grave wax', 1, 'gothic'], ['Raven quill', 1, 'gothic'], ['Portrait varnish', 1, 'gothic']];
  assert.deepEqual(castle(twoGenres), { id: 'essences-of-genres', name: 'essences of different genres', need: 6, have: 2, met: false }, 'six names from two genres are two genres');
  const sixGenres = [...twoGenres, ['Moonlit coin', 1, 'nocturne'], ['Diesel cog', 1, 'iron'], ['Case file', 1, 'noir'], ['Sunleaf', 1, 'verdant'], ['Maelstrom glass', 4, null]];
  assert.deepEqual([castle(sixGenres).have, castle(sixGenres).met], [6, true]);
  assert.equal(castle([['Neon shard', 1, 'neon'], ['Mystery dust', 5, null]]).have, 1, 'an essence of no known genre doesn’t count');
  // The Keep's diesel cogs are the Iron essence, gathered now.
  const keepNeeds = (essences) => hearthStatus(normalizeState({ hearth: { tier: 3 }, satchel: satchelOf(essences) }, now), fortress).next.materials.find((m) => m.id === 'diesel-cog');
  assert.deepEqual(keepNeeds([['Diesel cog', 40, 'iron']]), { id: 'diesel-cog', name: 'diesel cogs', need: 10, have: 40, met: true });
  assert.deepEqual(keepNeeds([['Rivet plate', 40, 'iron']]), { id: 'diesel-cog', name: 'diesel cogs', need: 10, have: 0, met: false });
  // Raising spends the cogs, then one essence from each genre asked for: the most held of each.
  const plans = {
    tiers: [
      { id: 'camp', tier: 1, name: 'The Camp', wardRadius: 0 },
      { id: 'test', tier: 2, name: 'The Test', wardRadius: 12, requirements: [], materials: { 'diesel-cog': 3, 'essences-of-genres': 2 } },
    ],
  };
  const rich = normalizeState({ satchel: satchelOf([['Neon shard', 3, 'neon'], ['Glitch pearl', 5, 'neon'], ['Grave wax', 1, 'gothic'], ['Diesel cog', 3, 'iron'], ['Maelstrom glass', 1, null]]) }, now);
  assert.equal(hearthStatus(rich, plans).next.ready, true);
  const raised = raiseHearth(rich, plans, now);
  assert.equal(raised.ok, true);
  assert.deepEqual(raised.state.satchel.essences, { 'Neon shard': 3, 'Glitch pearl': 4, 'Maelstrom glass': 1 });
  assert.deepEqual(raised.state.satchel.essenceGenres, { 'Neon shard': 'neon', 'Glitch pearl': 'neon' });
  assert.deepEqual(normalizeState(raised.state, now), raised.state, 'the raised state saves cleanly');
  const poor = normalizeState({ satchel: satchelOf([['Neon shard', 3, 'neon'], ['Glitch pearl', 5, 'neon'], ['Diesel cog', 3, 'iron']]) }, now);
  const notYet = raiseHearth(poor, { tiers: [plans.tiers[0], { ...plans.tiers[1], materials: { 'essences-of-genres': 3 } }] }, now);
  assert.equal(notYet.ok, false);
  assert.equal(notYet.reason, 'Not yet. Still to do: essences of 1 more genre.');
  const short = raiseHearth(poor, { tiers: [plans.tiers[0], { ...plans.tiers[1], materials: { 'diesel-cog': 4, 'essences-of-genres': 5 } }] }, now);
  assert.equal(short.reason, 'Not yet. Still to do: 1 more diesel cog and essences of 3 more genres.');
  for (const line of [notYet.reason, short.reason]) assertCalm(line, 'hearth reason');
});

test('the Hearth with the real fortress.json, and without any', () => {
  const real = hearthStatus(createState(), fortress);
  assert.equal(real.tier, 1);
  assert.equal(real.next.id, 'stockade');
  assert.deepEqual(real.next.requirements.map((r) => r.kind).sort(), ['buildings-designed', 'crew-sessions-finished', 'days-with-milo']);
  assert.ok(real.next.requirements.every((r) => r.future === false), 'every Stockade requirement is counted for real');
  assert.ok(real.next.materials.every((m) => ['birch', 'ash', 'pine'].includes(m.id)), 'the Stockade is built with logs from the wilds');
  for (const tier of fortress.tiers) {
    const state = normalizeState({ hearth: { tier: tier.tier } }, at(24, 12));
    assert.equal(wardRadius(state, fortress), tier.wardRadius);
    const status = hearthStatus(state, fortress);
    for (const r of status.next?.requirements ?? []) {
      if (r.future) assertCalm(r.note, `${r.kind} note`);
    }
  }
  // Every note and reason for every tier: calm, and no developer words such as "phase".
  for (const tier of fortress.tiers) {
    const state = normalizeState({ hearth: { tier: tier.tier } }, at(24, 12));
    const next = hearthStatus(state, fortress).next;
    if (!next) continue;
    for (const item of [...next.requirements, ...next.materials]) {
      if (!item.future) continue;
      assertCalm(item.note, `${tier.id}: ${item.kind ?? item.id} note`);
      assert.ok(!/phase/i.test(item.note), `${tier.id}: ${item.note}`);
    }
    const reason = raiseHearth(state, fortress, at(24, 12)).reason;
    assertCalm(reason, `${tier.id} reason`);
    assert.ok(!/phase/i.test(reason), reason);
    for (const m of next.materials.filter((x) => x.future)) assert.ok(!reason.includes(` more ${m.name}`), `${m.name} isn’t asked for yet: ${reason}`);
  }
  // Once the Stockade is raised: everything standing, and the Hold's stone and copperstone come later.
  const raisedReal = normalizeState({ hearth: { tier: 2 } }, at(24, 12));
  assert.deepEqual(hearthStatus(raisedReal, fortress).def.defences.map((d) => d.name), ['The Lantern Hook', 'The Watchtower', 'The War Table', 'The Gate Bell', 'The first ward-post']);
  assert.match(raiseHearth(raisedReal, fortress, at(24, 12)).reason, / 150 more birch\. Stone and copperstone come later\.$/);
  assert.deepEqual(hearthStatus(raisedReal, fortress).next.materials.filter((m) => m.future).map((m) => [m.id, m.note]), [
    ['stone', 'Mined in the vale once the Notice Board arrives'], ['copperstone', 'Not found in the wilds yet'],
  ]);
  assert.deepEqual(WARD_RADII, [0, 12, 28, 48, 72, 100, 140, 200]);
  for (let tier = 1; tier <= 8; tier += 1) assert.equal(wardRadius({ hearth: { tier } }, null), WARD_RADII[tier - 1]);
  for (const junk of [null, 'x', {}, { tiers: 'x' }, { tiers: [null, 5] }]) {
    assert.doesNotThrow(() => hearthStatus(junk, junk));
    assert.equal(hearthStatus(createState(), junk).next, null);
    assert.equal(raiseHearth(createState(), junk).ok, false);
    assertCalm(raiseHearth(createState(), junk).reason, 'no plans');
  }
  assert.equal(raiseHearth(null, fortress).ok, false);
  assert.equal(hearthTier({ hearth: { tier: 99 } }), 8);
});

/* ------------------------------------------------------------------ the Prologue */

test('prologueStatus: steps complete in order, and what’s already true completes on sight', () => {
  const fresh = prologueStatus(createState(), STORY);
  assert.deepEqual(fresh.steps.map((s) => s.id), PROLOGUE_STEP_IDS);
  assert.equal(fresh.current, 'light');
  assert.equal(fresh.complete, false);
  assert.equal(fresh.title, 'The Lantern Wakes');
  assert.deepEqual(fresh.steps[0], { id: 'light', title: 'A Light on the Hook', text: 'The lantern catches.', hint: 'Open MILO and let Milo say hello.', done: false, current: true, at: null });
  // Chris has used MILO for a while: greeted, sessions seen, a building designed.
  const now = at(24, 12);
  let state = normalizeState({ lastSeenAt: now - DAY, plots: { 'plot-rise': builtPlot(now - 2 * DAY) } }, now);
  let status = prologueStatus(state, STORY, { hasSessions: true });
  assert.deepEqual(status.steps.map((s) => s.done), [true, true, true, false, false, false, false]);
  assert.equal(status.current, 'letter');
  assert.deepEqual(status.steps.map((s) => s.current), [false, false, false, true, false, false, false]);
  assert.equal(prologueStatus(state, STORY).current, 'crew', 'no sessions seen, none finished');
  // Later conditions wait their turn: a lit lantern and tier 2 don't skip the letter.
  state = { ...state, wilds: { ...state.wilds, lanterns: { 'lantern:-1,-40': now } }, hearth: { tier: 2, raisedAt: {} } };
  status = prologueStatus(state, STORY, { hasSessions: true });
  assert.equal(status.current, 'letter');
  assert.ok(!status.steps[5].done && !status.steps[6].done);
  state = readLetter(state, now);
  assert.equal(state.story.letterReadAt, now);
  assert.equal(state.story.prologue.done.letter, now);
  assert.equal(prologueStatus(state, STORY, { hasSessions: true }).current, 'first-crack');
  state = markStory(state, 'first-crack', now + HOUR);
  status = prologueStatus(state, STORY, { hasSessions: true });
  assert.equal(status.complete, true, 'the lantern and the Stockade were already true');
  assert.equal(status.current, null);
  assert.ok(status.steps.every((s) => s.done && !s.current));
});

test('markStory and settleStory save steps once, in order', () => {
  const now = at(24, 12);
  let state = normalizeState({ lastSeenAt: now - DAY }, now);
  assert.equal(markStory(state, 'nope', now), state);
  assert.equal(markStory(null, 'light', now), null);
  const marked = markStory(state, 'light', now);
  assert.equal(marked.story.prologue.done.light, now);
  assert.equal(markStory(marked, 'light', now + HOUR), marked, 'the first time is kept');
  assert.equal(state.story.prologue.done.light, undefined, 'the state given is left alone');
  // Steps done on sight are saved, so they stay done when what proved them goes away.
  const settled = settleStory(state, STORY, { hasSessions: true }, now);
  assert.deepEqual(settled.completed, ['light', 'crew']);
  assert.deepEqual(Object.keys(settled.state.story.prologue.done), ['light', 'crew']);
  assert.equal(prologueStatus(settled.state, STORY, { hasSessions: false }).current, 'ground', 'crew stays done');
  assert.deepEqual(settleStory(settled.state, STORY, { hasSessions: true }, now).completed, []);
  assert.equal(settleStory(settled.state, STORY, { hasSessions: true }, now).state, settled.state);
  // A step marked ahead of its turn shows done only once the steps before it are.
  state = markStory(settled.state, 'lantern', now);
  assert.equal(prologueStatus(state, STORY).steps[5].done, false);
  // The tracker can be hidden.
  assert.equal(setTrackerHidden(state, true).story.trackerHidden, true);
  assert.equal(setTrackerHidden(setTrackerHidden(state, true), true).story.trackerHidden, true);
  assert.equal(setTrackerHidden(state, false), state);
  // Session finishes count as having seen the crew; markSeen counts as the light.
  const counted = markSeen(createState(now), now);
  assert.equal(prologueStatus(counted, STORY).current, 'crew');
  assert.equal(prologueStatus({ ...counted, tally: { ...counted.tally, sessionsFinished: 1 } }, STORY).current, 'ground');
  const designed = finishDesign(startDesign(counted, 'plot-rise', null), 'plot-rise', { blueprint: builtPlot(now).blueprint, by: 'kit' }, now);
  assert.equal(prologueStatus(designed, STORY, { hasSessions: true }).current, 'letter');
});

test('prologueStatus without content, with junk, and with the real story.json', () => {
  const bare = prologueStatus(createState(), null);
  assert.deepEqual(bare.steps.map((s) => s.id), PROLOGUE_STEP_IDS);
  for (const step of bare.steps) {
    assert.ok(step.title && step.text && step.hint, step.id);
    assertCalm(step.hint, `${step.id} fallback hint`);
    assertCalm(step.text, `${step.id} fallback text`);
    assert.ok(step.hint.length <= 90);
  }
  for (const junk of [null, 'x', 5, [], { prologue: null }, { prologue: { steps: 'x' } }, { prologue: { steps: [null, { id: 3 }, { id: 'light', title: 7 }] } }]) {
    assert.doesNotThrow(() => prologueStatus(junk, junk));
    assert.deepEqual(prologueStatus(createState(), junk).steps.map((s) => s.id), PROLOGUE_STEP_IDS);
  }
  if (REAL_STORY) {
    const real = prologueStatus(createState(), REAL_STORY);
    assert.deepEqual(REAL_STORY.prologue.steps.map((s) => s.id), PROLOGUE_STEP_IDS, 'content has the seven steps, in order');
    for (const step of real.steps) {
      assert.ok(step.title && step.text && step.hint, step.id);
      assert.ok(step.hint.length <= 90, `${step.id} hint fits`);
    }
    const now = at(24, 12);
    const upToLetter = normalizeState({ lastSeenAt: now - DAY, tally: { buildingsDesigned: 1, finishedIds: ['claude:a'], sessionsFinished: 1 }, story: { letterReadAt: now - HOUR } }, now);
    assert.equal(only(deriveSignals({ snapshot: snapshot([session()]), state: upToLetter, now, story: REAL_STORY }), 'story').length, 1, 'the real Prologue opens the crack');
  }
});
