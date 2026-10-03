// Phase 4's state (src/state4.js, src/clean.js and their wiring in src/model.js): the seven new
// sections, Phase 4's fields in Phase 3's sections, tallyAnswered and the small shared steps.
// CONTRACT-PHASE4.md §7.6, §8, §15. The capped-state size and time are measured in core.test.js.
// Run: node --test tests/state4.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import * as clean from '../src/clean.js';
import {
  STATE4_KEYS, STATE4_LIMITS, SKILL_IDS, FEATURE_IDS, CREW_AGENTS, emptyState4, normalize4, cleanTally4, markFact, markFeature,
  hearthTierOf, tallyAnswered, battleBytes, emptyMember, prunePaid, eventTime, FOUNDERS, JOINERS, isEventKey,
  EXPEDITION_KINDS, emptyEmbers, emptyXp, emptyKindle, emptyChronicle, emptyDay, emptyRoad, emptyParty, emptyOuting, emptyTally4,
  emptySatchel4, emptyStory4, KINDLE_PHASES, FORMATIONS, MODES, PLAYS, CONTROLS, REACTION_SETTINGS, ARCHETYPES, TEMPERAMENTS,
  ROOM_OUTCOMES, CARDS, FIGHT_OUTCOMES,
} from '../src/state4.js';
import * as model from '../src/model.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { loreIndex, normaliseName } from './calm.js';

const { createState, normalizeState, tallyFinished, markSeen } = model;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (d, h = 12, m = 0) => new Date(2026, 8, d, h, m, 0).getTime(); // local time, September 2026
const NOW = at(29, 14);
const L = STATE4_LIMITS;
const JUNK = [null, undefined, 0, 7, -3, 'x', true, [], [1], {}, { a: 1 }, NaN, Infinity, () => 1];

const norm = (input, now = NOW) => normalizeState(input, now);
const roundTrip = (value) => JSON.parse(JSON.stringify(value));
function assertIdempotent(state, where) {
  assert.deepEqual(norm(state), state, `${where}: idempotent`);
  assert.deepEqual(norm(roundTrip(state)), state, `${where}: idempotent through JSON`);
}
function assertNoProtoAnywhere(value, where) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Object.prototype, `${where}: a plain object`);
    for (const key of ['__proto__', 'constructor', 'prototype']) assert.ok(!Object.hasOwn(value, key), `${where}: no ${key}`);
  }
  for (const [key, child] of Object.entries(value)) assertNoProtoAnywhere(child, `${where}.${key}`);
}
const timed = (fn, runs = 200) => {
  for (let i = 0; i < 20; i += 1) fn(i);
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn(i);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
};

/* ------------------------------------------------------------------ clean.js */

test('clean.js holds the primitives, and model.js re-exports the ones it always exported, unchanged', () => {
  for (const name of ['toTime', 'clip', 'dayKey', 'dayNumber', 'dayStart', 'withoutTitle', 'SESSION_NAME_DAYS']) assert.equal(model[name], clean[name], name);
  assert.equal(clean.SESSION_NAME_DAYS, 3);
  for (const name of ['isRecord', 'UNSAFE_KEYS', 'safeCopy', 'toTime', 'clip', 'cleanCount', 'cleanInt', 'cleanMap', 'keepNewest', 'cleanMapNewest',
    'cleanRecentList', 'cleanDayKey', 'dayKey', 'dayNumber', 'dayStart', 'weekStart', 'stripUnsafe']) {
    assert.ok(name in clean, `clean.js exports ${name}`);
  }
  assert.equal(clean.cleanDayKey('2026-02-31'), null);
  assert.equal(clean.cleanCount(12.9), 12);
  assert.equal(clean.cleanInt(-4.4), -4);
  assert.deepEqual(clean.keepNewest({ a: 1, b: 3, c: 2 }, 2, (n) => n), { b: 3, c: 2 });
  // cleanMapNewest is keepNewest(cleanMap(…)) in one walk: the same entries, in the same order.
  const map = { d: 4, bad: 9, a: 1, e: 'x', b: 3, c: 2 };
  const ok = (key) => key.length === 1;
  const num = (n) => (typeof n === 'number' ? n : null);
  for (const max of [0, 1, 2, 3, 4, 5, 10]) {
    const one = clean.cleanMapNewest(map, ok, num, max, (n) => n);
    const two = clean.keepNewest(clean.cleanMap(map, ok, num), max, (n) => n);
    assert.deepEqual(Object.entries(one), Object.entries(two), `max ${max}`);
  }
  assert.deepEqual(clean.cleanMapNewest('x', ok, num, 3, (n) => n), {});
});

test('clip and cleanRecentList give what their plain forms give, fast path or not', () => {
  // The plain forms: clip always collapses and trims; cleanRecentList always walks from the end.
  const plainClip = (value, max) => {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    let cut = text.slice(0, Math.max(1, max - 1));
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };
  const plainList = (value, ok, max) => {
    const seen = new Set();
    const out = [];
    for (let i = value.length - 1; i >= 0 && out.length < max; i -= 1) {
      const item = value[i];
      if (typeof item !== 'string' || !ok(item) || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out.reverse();
  };
  const random = seeded(4242);
  const pieces = ['a', 'Bb', ' ', '  ', '\t', '\n', ' ', ' ', '﻿', '“', '🌸', 'x y', '\r\n'];
  for (let i = 0; i < 3000; i += 1) {
    const text = Array.from({ length: Math.floor(random() * 9) }, () => pieces[Math.floor(random() * pieces.length)]).join('');
    for (const max of [1, 3, 8, 40]) assert.equal(clean.clip(text, max), plainClip(text, max), JSON.stringify([text, max]));
  }
  const ok = (item) => /^[a-c]\d?$/.test(item);
  const items = ['a', 'b', 'c', 'a1', 'b2', 'd', '', 7, null];
  for (let i = 0; i < 3000; i += 1) {
    const list = Array.from({ length: Math.floor(random() * 7) }, () => items[Math.floor(random() * items.length)]);
    if (random() < 0.2) list.length += 2; // holes at the end
    for (const max of [0, 2, 4, 10]) assert.deepEqual(clean.cleanRecentList(list, ok, max), plainList(list, ok, max), JSON.stringify([list, max]));
  }
  const kept = ['a', 'b', 'c'];
  assert.notEqual(clean.cleanRecentList(kept, ok, 5), kept, 'a new list, never the one given');
});

test('weekStart is the local Monday’s day number, through both clock changes', () => {
  // 29 September 2026 is a Tuesday.
  assert.equal(clean.dayKey(clean.dayStart(clean.weekStart(NOW))), '2026-09-28');
  assert.equal(clean.weekStart(at(28, 0, 0)), clean.dayNumber(at(28)), 'a Monday starts its own week');
  assert.equal(clean.weekStart(new Date(2026, 9, 4, 23, 59).getTime()), clean.dayNumber(at(28)), 'Sunday night is still that week');
  for (let d = 0; d < 400; d += 1) {
    const day = new Date(2026, 0, 1 + d, 12).getTime();
    const monday = clean.dayStart(clean.weekStart(day));
    assert.equal(new Date(monday).getDay(), 1, new Date(day).toDateString());
    assert.ok(clean.dayNumber(day) - clean.weekStart(day) < 7);
  }
  // New in Phase 4, so no wall-clock fallback: anything that isn't a time gives null.
  for (const junk of [undefined, null, NaN, Infinity, 'soon', {}, [], true]) assert.equal(clean.weekStart(junk), null, String(junk));
  assert.equal(clean.weekStart(), null, 'a missing now is never read from the clock');
  assert.equal(clean.weekStart('2026-09-30T12:00:00'), clean.dayNumber(at(28)), 'a time as text still works');
  assert.equal(typeof clean.weekStart(0), 'number', 'the epoch is a time');
});

test('stripUnsafe drops prototype keys at every level and keeps only JSON-safe values', () => {
  const hostile = JSON.parse('{"a":{"__proto__":{"polluted":1},"b":[{"constructor":1,"c":{"prototype":2,"d":3}}]},"__proto__":{"x":1}}');
  const out = clean.stripUnsafe({ ...hostile, f: () => 1, n: NaN, u: undefined, list: [1, () => 2, undefined, Infinity], ok: 'yes' });
  assert.deepEqual(out, { a: { b: [{ c: { d: 3 } }] }, n: null, list: [1, null, null, null], ok: 'yes' }, 'as JSON would have it');
  assertNoProtoAnywhere(out, 'stripped');
  assert.equal({}.polluted, undefined);
  const deep = {};
  let at1 = deep;
  for (let i = 0; i < 20; i += 1) { at1.next = {}; at1 = at1.next; }
  assert.equal(JSON.stringify(clean.stripUnsafe(deep, 3)), '{"next":{"next":{"next":null}}}', 'past the depth, null');
  const cycle = { a: 1 };
  cycle.self = cycle;
  assert.doesNotThrow(() => clean.stripUnsafe(cycle));
});

test('battleBytes is the UTF-8 length of the JSON', () => {
  for (const value of [{ a: 'plain' }, { t: 'curly ’ “quotes” and an emoji-free ✦' }, ['Ω', 'ü', '中文'], { s: '🌸' }]) {
    assert.equal(battleBytes(value), Buffer.byteLength(JSON.stringify(value)), JSON.stringify(value));
  }
});

/* ------------------------------------------------------------------ the shape */

test('the seven sections come after story, in order, in createState and normalizeState', () => {
  assert.deepEqual([...STATE4_KEYS], ['embers', 'xp', 'kindle', 'chronicle', 'road', 'party', 'expedition']);
  const keys = Object.keys(createState(NOW));
  assert.deepEqual(keys.slice(keys.indexOf('story') + 1), [...STATE4_KEYS, 'board', 'people', 'camplife', 'commissions']);
  const saved = norm({ future: 1, story: {}, party: {} });
  const savedKeys = Object.keys(saved);
  assert.deepEqual(savedKeys.slice(savedKeys.indexOf('story') + 1), [...STATE4_KEYS, 'board', 'people', 'camplife', 'commissions', 'future'], 'unknown top-level keys still come last');
  assert.deepEqual(normalize4(undefined, { now: NOW }), emptyState4());
  const fresh = createState(NOW);
  for (const key of STATE4_KEYS) assert.deepEqual(fresh[key], emptyState4()[key], key);
  assert.notEqual(createState(NOW).party.roster.milo, createState(NOW).party.roster.milo, 'nothing is shared between states');
});

test('a save from before the Kit gets empty sections and a backlog still to pay', () => {
  const phase3 = norm({ tally: { sessionsFinished: 40, buildingsDesigned: 2 }, rifts: { stitched: { real: 3 } } });
  assert.equal(phase3.embers.through, null, 'the backlog pays once, on the next payFromSignals');
  assert.equal(phase3.xp.through, null);
  assert.equal(phase3.road.stitchedThrough, null, 'the real stitches are seeded, not paid, by party.payRealStitches');
  assert.deepEqual(Object.keys(phase3.party.roster), ['milo', 'claude', 'codex', 'jev']);
  assert.deepEqual(phase3.party.chosen, ['claude', 'codex', 'jev']);
  assert.equal(phase3.expedition, null);
  assert.equal(phase3.tally.byCrew.claude, 0);
});

test('a damaged high-water mark is seeded from today’s counts, never left to pay twice', () => {
  const counts = { tally: { sessionsFinished: 12, answered: 3, answeredFast: 2, buildingsDesigned: 1 }, rifts: { stitched: { real: 4 } } };
  for (const through of ['x', 5, [], true]) {
    const state = norm({ ...counts, embers: { balance: 10, through }, xp: { through } });
    assert.deepEqual(state.embers.through, { sessionsFinished: 12, answered: 3, stitchedReal: 4, buildingsDesigned: 1 }, String(through));
    assert.deepEqual(state.xp.through, { sessionsFinished: 12, answeredFast: 2, buildingsDesigned: 1 });
  }
  const missing = norm({ ...counts, embers: { balance: 10 }, xp: { skills: {} } });
  assert.notEqual(missing.embers.through, null, 'a section that exists without a mark is seeded too');
  assert.deepEqual(norm({ ...counts, embers: { through: null } }).embers.through, null, 'an explicit null waits for the backlog');
  const marked = norm({ ...counts, embers: { through: { sessionsFinished: 5, answered: 1, stitchedReal: 2, buildingsDesigned: 0, later: 'kept' } } });
  assert.deepEqual(marked.embers.through, { sessionsFinished: 5, answered: 1, stitchedReal: 2, buildingsDesigned: 0, later: 'kept' });
  // A section that is there but isn't a record is damage, not a save from before the Kit.
  for (const junk of [null, [], 5, 'x', true, undefined]) {
    const state = norm({ ...counts, embers: junk, xp: junk });
    assert.deepEqual(state.embers.through, { sessionsFinished: 12, answered: 3, stitchedReal: 4, buildingsDesigned: 1 }, `embers: ${String(junk)}`);
    assert.equal(state.embers.paidBefore, NOW, `embers: ${String(junk)}: every event before now counts as paid`);
    assert.deepEqual(state.xp.through, { sessionsFinished: 12, answeredFast: 2, buildingsDesigned: 1 }, `xp: ${String(junk)}`);
    assertIdempotent(state, `embers and xp: ${String(junk)}`);
  }
  assert.equal(norm(counts).embers.through, null, 'only a missing section is from before the Kit');
  assert.equal(norm(counts).xp.through, null);
  // One damaged field in a mark is seeded from its own count; the rest keep theirs.
  for (const bad of ['x', null, -1, NaN, {}, undefined]) {
    const embers = norm({ ...counts, embers: { through: { sessionsFinished: 10, answered: 1, stitchedReal: bad, buildingsDesigned: 0 } } }).embers;
    assert.deepEqual(embers.through, { sessionsFinished: 10, answered: 1, stitchedReal: 4, buildingsDesigned: 0 }, `stitchedReal: ${String(bad)}`);
    const xp = norm({ ...counts, xp: { through: { sessionsFinished: bad, answeredFast: 1, buildingsDesigned: 0 } } }).xp;
    assert.deepEqual(xp.through, { sessionsFinished: 12, answeredFast: 1, buildingsDesigned: 0 }, `sessionsFinished: ${String(bad)}`);
  }
  const partial = norm({ ...counts, embers: { through: { sessionsFinished: 10 } }, xp: { through: { answeredFast: 0 } } });
  assert.deepEqual(partial.embers.through, { sessionsFinished: 10, answered: 3, stitchedReal: 4, buildingsDesigned: 1 }, 'a missing field is seeded');
  assert.deepEqual(partial.xp.through, { sessionsFinished: 12, answeredFast: 0, buildingsDesigned: 1 });
  assert.equal(norm({ ...counts, embers: { through: { sessionsFinished: 10.7, answered: 0, stitchedReal: 0, buildingsDesigned: 0 } } }).embers.through.sessionsFinished, 10, 'a whole count');
});

test('STATE4_LIMITS holds §8’s numbers', () => {
  const contract = {
    cap: 100, ledger: 300, paid: 200, ledgerText: 60, ledgerSource: 20, ledgerMin: -100, ledgerMax: 1_000_000,
    xp: 200_000_000, days: 60, dayXp: 6, fights: 50, xpLines: 120, where: 60, summary: 200, lineSource: 20, lineText: 60,
    paidFights: 500, chosen: 3, regulars: 12, cheers: 4, warmth: 1000, weekOuting: 6, boons: 3, prepared: 20, struck: 40, accepts: 50,
    rules: 6, gifts: 3, notebookFights: 1_000_000, nooks: 50, freeReentry: 50, strayMemory: 12, seenScenes: 100, battleBytes: 49_152,
    waiting: 60, trails: 20, facts: 200, marks: 1e9, tonics: 20,
  };
  for (const [name, n] of Object.entries(contract)) assert.equal(L[name], n, `§8: ${name}`);
  // The caps A decided (§8 leaves them open), pinned so a change is deliberate.
  const decided = {
    roster: 17, others: 1, pending: 4, reactions: 8, outingHeroes: 4, uses: 12, breathers: 9, parts: 4, rooms: 32, chests: 32, entry: 4,
    weights: 40, answeredWaits: 60, features: 32, trailSteps: 12, dayPaid: 1000, travels: 1000, level: 40,
  };
  for (const [name, n] of Object.entries(decided)) assert.equal(L[name], n, `A: ${name}`);
  assert.deepEqual(Object.keys(L).sort(), [...Object.keys(contract), ...Object.keys(decided)].sort(), 'every limit is pinned');
  assert.equal(L.roster, FOUNDERS.length + L.others + L.regulars);
  assert.deepEqual([...JOINERS], ['tollkeeper']);
});

test('one bad section never costs the rest of a save', () => {
  const good = norm({
    tally: { sessionsFinished: 3, answered: 2 },
    embers: { balance: 40, lifetime: 90, through: { sessionsFinished: 3, answered: 2, stitchedReal: 0, buildingsDesigned: 0 } },
    xp: { skills: { focus: 5000 } },
    road: { xp: 1200, paidFights: { 'fight:rift:abc:w:r1': NOW } },
    kindle: { phase: 'focus', startedAt: NOW - MIN, focusEndsAt: NOW + 49 * MIN },
  });
  const boom = () => { throw new Error('boom'); };
  for (const key of STATE4_KEYS) {
    const input = roundTrip(good);
    input[key] = new Proxy({}, { get: boom, ownKeys: boom, getOwnPropertyDescriptor: boom, has: boom });
    const state = norm(input);
    for (const other of STATE4_KEYS.filter((k) => k !== key)) assert.deepEqual(state[other], good[other], `${key} broke; ${other} is kept`);
    assert.deepEqual(state.settings, good.settings, `${key} broke; the rest of the save is kept`);
    assert.deepEqual(state.tally, good.tally);
  }
  const broken = roundTrip(good);
  broken.embers = new Proxy({}, { get: boom, ownKeys: boom, getOwnPropertyDescriptor: boom, has: boom });
  const fallback = norm(broken).embers;
  assert.deepEqual(fallback.through, { sessionsFinished: 3, answered: 2, stitchedReal: 0, buildingsDesigned: 0 }, 'a broken embers section can’t pay the backlog again');
  assert.equal(fallback.paidBefore, NOW, 'nor any event from before now');
  // Phase 4's fields in Phase 3's sections fall back on their own too.
  const trap = () => new Proxy({}, { get: boom, ownKeys: boom, getOwnPropertyDescriptor: boom, has: boom });
  for (const [key, field, empty] of [['tally', 'byCrew', { claude: 0, codex: 0, jev: 0, whisper: 0 }], ['satchel', 'tonics', { cordial: 0, brew: 0 }], ['story', 'facts', {}]]) {
    const input = roundTrip(good);
    input[key] = { ...input[key], [field]: trap() };
    const state = norm(input);
    assert.deepEqual(state[key][field], empty, `${key}.${field} broke: its Phase 4 fields fall back`);
    assert.deepEqual(state.embers, good.embers, `${key}.${field} broke; embers is kept`);
    if (key === 'tally') assert.equal(state.tally.sessionsFinished, 3, 'and Phase 3’s own tally is kept');
  }
});

test('every section survives junk at every level, stays idempotent and never throws', () => {
  const inner = {
    embers: ['balance', 'lifetime', 'ledger', 'paid', 'paidBefore', 'through', 'day', 'backlogAt'],
    xp: ['skills', 'through', 'day'],
    kindle: ['phase', 'startedAt', 'focusEndsAt', 'restStartedAt', 'restEndsAt', 'earned', 'paid'],
    chronicle: ['days', 'fights', 'xpLines'],
    road: ['xp', 'paidFights', 'stitchedThrough', 'levelShown', 'firstWin'],
    party: ['roster', 'chosen', 'formation', 'cheers', 'regulars', 'outing', 'rests', 'mode', 'play', 'calm', 'strayMemory', 'firstLeadMet', 'teachDay', 'seenScenes'],
    expedition: ['runId', 'kind', 'riftId', 'key', 'since', 'source', 'depth', 'tier', 'enteredAt', 'embersPaid', 'inside', 'rooms', 'chests', 'nookUsed', 'entry', 'battle', 'card'],
  };
  const expedition = { runId: 'run:1', kind: 'wild', source: { seed: 5, tier: 2, depth: 3, weights: { neon: 1 } } };
  for (const key of STATE4_KEYS) {
    for (const value of JUNK) {
      const state = norm({ [key]: value });
      assertIdempotent(state, `${key}: ${String(value)}`);
    }
    for (const field of inner[key]) {
      for (const value of JUNK) {
        const base = key === 'expedition' ? { ...expedition } : {};
        const state = norm({ [key]: { ...base, [field]: value } });
        assertIdempotent(state, `${key}.${field}: ${String(value)}`);
      }
    }
  }
  // One level further down: a member, a regular, the outing, a ledger entry, a trail.
  const deeper = [
    (v) => ({ party: { roster: { claude: v } } }), (v) => ({ party: { roster: { claude: { notebook: v } } } }),
    (v) => ({ party: { roster: { claude: { notebook: { rules: [v], struck: [v], previous: v } } } } }),
    (v) => ({ party: { roster: { claude: { gifts: v, warmthWeek: v, reactions: { shoulder: v } } } } }),
    (v) => ({ party: { regulars: [v] } }), (v) => ({ party: { outing: { heroes: { milo: v } } } }),
    (v) => ({ embers: { ledger: [v] } }), (v) => ({ chronicle: { days: { '2026-09-29': v }, fights: [v], xpLines: [v] } }),
    (v) => ({ story: { trails: { 'first-trail': v }, facts: { 'note:a': v } } }), (v) => ({ tally: { waiting: { 'claude:a': v }, byCrew: v, features: v } }),
    (v) => ({ satchel: { tonics: v, marks: v } }), (v) => ({ settings: { hud: v, kindleBell: v } }),
    (v) => ({ expedition: { ...expedition, battle: v } }), (v) => ({ expedition: { ...expedition, source: v } }),
  ];
  for (const make of deeper) {
    for (const value of JUNK) assertIdempotent(norm(make(value)), `${JSON.stringify(make('·'))}: ${String(value)}`);
  }
});

test('hostile keys at every level of every new map stay out of every prototype', () => {
  const P = '"__proto__": {"polluted": 1}, "constructor": {"polluted": 1}, "prototype": {"polluted": 1}';
  const hostile = JSON.parse(`{
    "embers": {${P}, "paid": {${P}}, "through": {${P}}, "day": {${P}}, "ledger": [{${P}, "at": 5, "n": 3, "source": "x"}]},
    "xp": {${P}, "skills": {${P}}, "through": {${P}}, "day": {${P}}},
    "kindle": {${P}, "paid": {${P}}},
    "chronicle": {${P}, "days": {${P}, "2026-09-29": {${P}, "xp": {${P}}}}, "fights": [{${P}}], "xpLines": [{${P}}]},
    "road": {${P}, "paidFights": {${P}}},
    "party": {${P}, "roster": {${P}, "claude": {${P}, "reactions": {${P}}, "gifts": {${P}}, "warmthWeek": {${P}},
        "notebook": {${P}, "previous": {${P}}, "rules": [{${P}}]}}},
      "regulars": [{${P}, "parts": [{${P}}]}], "outing": {${P}, "heroes": {${P}, "milo": {${P}, "uses": {${P}}}}},
      "rests": {${P}, "nooks": {${P}}, "freeReentry": {${P}}}, "calm": {${P}}, "strayMemory": {${P}}, "seenScenes": {${P}}},
    "expedition": {${P}, "runId": "run:1", "kind": "cave", "source": {${P}, "poi": "poi:cave:1,2", "day": 20000}, "rooms": {${P}}, "chests": {${P}},
      "entry": {${P}}, "battle": {${P}, "v": 2, "id": "b", "units": [{${P}, "id": "milo", "conditions": [{${P}}]}]}},
    "tally": {${P}, "byCrew": {${P}}, "waiting": {${P}}, "answeredWaits": {${P}}, "features": {${P}}},
    "satchel": {${P}, "tonics": {${P}}},
    "story": {${P}, "trails": {${P}, "first-trail": {${P}, "found": {${P}}, "done": {${P}}}}, "facts": {${P}}},
    "settings": {${P}}
  }`);
  const safe = norm(hostile);
  assert.equal({}.polluted, undefined);
  for (const key of [...STATE4_KEYS, 'tally', 'satchel', 'story', 'settings']) assertNoProtoAnywhere(safe[key], key);
  assert.ok(safe.expedition && safe.expedition.battle, 'the expedition and its battle are kept, stripped');
  assert.deepEqual(safe.expedition.battle.units[0].conditions, [{}]);
  assert.deepEqual(norm(roundTrip(safe)), safe);
});

/* ------------------------------------------------------------------ each section */

test('embers: the ledger, balance, lifetime and pay-once keys are cleaned and bounded', () => {
  const ledger = [
    ...Array.from({ length: 320 }, (_, i) => ({ at: NOW - (320 - i) * MIN, n: 10, banked: 10, source: 'focus', text: `Session ${i}`, extra: 1 })),
    { at: NOW, n: 1_000_001, banked: 5, source: 'backlog' }, { at: 'x', n: 5, source: 'crew' }, { at: NOW, n: 0, source: 'crew' },
    { at: NOW, n: 5, banked: 9, source: '' }, { at: NOW, n: -4, banked: 4, source: 'wild', text: 't'.repeat(90) }, { at: NOW, n: 7.6, banked: 200, source: 's'.repeat(30) },
  ];
  const paid = Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`focus:${NOW - (230 - i) * HOUR}`, NOW - (230 - i) * HOUR]));
  const embers = norm({ embers: { balance: 140.7, lifetime: 3, ledger, paid: { ...paid, 'Bad Key': 1, 'rest:x': 'nope' }, paidBefore: -5 } }).embers;
  assert.equal(embers.balance, 100);
  assert.equal(embers.ledger.length, L.ledger);
  assert.deepEqual(embers.ledger.at(-2), { at: NOW, n: -4, banked: 0, source: 'wild', text: `${'t'.repeat(59)}…` }, 'a spend banks nothing; text is clipped to 60');
  assert.deepEqual(embers.ledger.at(-1), { at: NOW, n: 8, banked: 8, source: `${'s'.repeat(19)}…`, text: '' }, 'banked never above n; source clipped to 20');
  assert.ok(embers.ledger.every((e) => !('extra' in e)));
  assert.ok(embers.lifetime >= embers.ledger.reduce((sum, e) => sum + (e.n > 0 ? e.banked : 0), 0), 'lifetime is at least what the ledger banked');
  assert.equal(Object.keys(embers.paid).length, L.paid);
  assert.equal(embers.paidBefore, NOW - 201 * HOUR, 'the pruned keys raise paidBefore to the newest of them');
  assert.ok(!('Bad Key' in embers.paid) && !('rest:x' in embers.paid));
  assert.equal(norm({ embers: { balance: -3 } }).embers.balance, 0);
  // The cleaner only clamps: it never raises the balance, whatever the ledger says was banked.
  const banked = [{ at: NOW, n: 50, banked: 50, source: 'focus' }];
  assert.equal(norm({ embers: { balance: 3, lifetime: 60, ledger: banked } }).embers.balance, 3);
  assert.equal(norm({ embers: { balance: 42.9, ledger: banked } }).embers.balance, 42);
  assert.equal(norm({ embers: { ledger: banked } }).embers.balance, 0);
  // prunePaid on its own: nothing pruned under the cap.
  const few = { 'focus:5': 5 };
  assert.deepEqual(prunePaid(few, 2), { paid: few, paidBefore: 2 });
  assert.equal(eventTime('focus:1790000000000'), 1790000000000);
  assert.equal(eventTime('crew'), null);
});

test('embers: pay-once keys are ‘<source>:<ms>’, so a pruned key is always covered by paidBefore', () => {
  for (const key of ['focus:1790000000000', 'rest:1', 'banked-coals:1790000000000']) assert.ok(isEventKey(key), key);
  for (const key of ['focus:abc', 'focus:0', 'focus:', 'Focus:1', 'crew', 'a-very-long-source:1', `focus:${'1'.repeat(17)}`, 'focus:1:2', 5, null]) {
    assert.ok(!isEventKey(key), String(key));
  }
  assert.deepEqual(norm({ embers: { paid: { 'focus:1790000000000': NOW, 'focus:x': NOW, 'wild:rift:abc': NOW } } }).embers.paid, { 'focus:1790000000000': NOW });
});

test('session titles: never in the ledger, and gone from fights and XP lines after three days', () => {
  const title = '“Fix the login bug”';
  const fight = { id: 'fight:rift:abc:k1:r1', at: NOW, where: `The rift over ${title}`, outcome: 'won', rounds: 2, xp: 10, marks: 3, summary: `Milo kept the lantern high over ${title}.` };
  const line = { at: NOW, skill: 'seamcraft', n: 500, source: 'real-stitch', text: `Seamcraft 500: the rift over ${title}` };
  const saved = {
    embers: { ledger: [{ at: NOW, n: -5, banked: 0, source: 'real', text: `Stepped into the rift over ${title}` }] },
    chronicle: { fights: [fight], xpLines: [line] },
  };
  const fresh = norm(saved);
  assert.equal(fresh.embers.ledger[0].text, 'Stepped into the rift over a waiting session', 'the ledger never stores a title (§8.3)');
  assert.equal(fresh.chronicle.fights[0].where, fight.where, 'a fight keeps its title for three days (§2)');
  assert.equal(fresh.chronicle.fights[0].summary, fight.summary);
  assert.equal(fresh.chronicle.xpLines[0].text, line.text);
  for (const later of [NOW + 2 * DAY, NOW + 3 * DAY]) assert.deepEqual(norm(fresh, later).chronicle, fresh.chronicle, 'still within three days');
  const old = norm(roundTrip(fresh), NOW + 3 * DAY + MIN);
  assert.equal(old.chronicle.fights[0].where, 'The rift over a waiting session');
  assert.equal(old.chronicle.fights[0].summary, 'Milo kept the lantern high over a waiting session.');
  assert.equal(old.chronicle.xpLines[0].text, 'Seamcraft 500: the rift over a waiting session');
  assert.deepEqual(norm(old, NOW + 3 * DAY + MIN), old, 'idempotent once stripped');
  assert.deepEqual({ ...old.chronicle, fights: [], xpLines: [] }, { ...fresh.chronicle, fights: [], xpLines: [] }, 'nothing else moves');
  // A clipped title (no closing quote) goes too.
  const clipped = norm({ chronicle: { fights: [{ ...fight, where: `The rift over “${'A very long title '.repeat(4)}` }] } }, NOW + 4 * DAY).chronicle.fights[0].where;
  assert.equal(clipped, 'The rift over a waiting session');
});

test('session titles: double curly quotes mark a title; anything else quoted in single ones is kept', () => {
  // Phase 3 quotes a title in “…” (rifts.js quoteTitle), and that's what's taken out. So a ledger
  // text, a FightSummary or an XP line quotes anything that isn't a title (a lead's name, a bark)
  // in ‘…’, which is kept however old it gets.
  const saved = {
    embers: { ledger: [{ at: NOW, n: -5, banked: 0, source: 'field', text: 'Challenged ‘The Glass Warden’' }] },
    chronicle: {
      fights: [{ id: 'fight:rift:abc:w:field', at: NOW, where: 'Where ‘The Glass Warden’ roams', outcome: 'bowed', rounds: 4, xp: 60, marks: 9, summary: 'The Warden said ‘Well played’ and bowed.' }],
      xpLines: [{ at: NOW, skill: 'seamcraft', n: 300, source: 'wild-stitch', text: 'Seamcraft 300: ‘The Glass Fen’ stitched' }],
    },
  };
  for (const later of [NOW, NOW + 30 * DAY]) {
    const back = norm(roundTrip(saved), later);
    assert.equal(back.embers.ledger[0].text, 'Challenged ‘The Glass Warden’');
    assert.deepEqual(back.chronicle.fights, saved.chronicle.fights);
    assert.deepEqual(back.chronicle.xpLines, saved.chronicle.xpLines);
  }
  assert.equal(norm({ embers: { ledger: [{ ...saved.embers.ledger[0], text: 'Challenged “The Glass Warden”' }] } }).embers.ledger[0].text, 'Challenged a waiting session', 'in “…”, it reads as a title');
  // Both in one text: only the “…” goes, and the ‘…’ stays.
  const both = { ...saved.chronicle.fights[0], summary: 'The Warden said ‘Well played’ over “Fix the login bug”.' };
  assert.equal(norm({ chronicle: { fights: [both] } }, NOW).chronicle.fights[0].summary, both.summary, 'within three days, all of it');
  assert.equal(norm({ chronicle: { fights: [both] } }, NOW + 4 * DAY).chronicle.fights[0].summary, 'The Warden said ‘Well played’ over a waiting session.');
  assert.equal(norm({ embers: { ledger: [{ ...saved.embers.ledger[0], text: '‘Well played’ over “Letters”' }] } }).embers.ledger[0].text, '‘Well played’ over a waiting session');
});

test('xp: only the 24 skills, whole and capped at 200,000,000', () => {
  const xp = norm({ xp: { skills: { focus: 1200.9, warding: 3e8, woodcutting: -4, telepathy: 50, command: 0 }, day: { key: '2026-09-29', travels: 3.5 }, note: 'kept' } }).xp;
  assert.deepEqual(xp.skills, { focus: 1200, warding: L.xp });
  assert.deepEqual(xp.day, { key: '2026-09-29', travels: 3 });
  assert.equal(xp.note, 'kept');
});

test('kindle: a phase with missing or backward times is idle, and a later clock never moves it', () => {
  const focus = { phase: 'focus', startedAt: NOW - 10 * MIN, focusEndsAt: NOW + 40 * MIN, earned: false, paid: { focus: null, rest: null } };
  assert.equal(norm({ kindle: focus }).kindle.phase, 'focus');
  for (const later of [NOW + HOUR, NOW + 3 * DAY]) assert.deepEqual(norm({ kindle: focus }, later).kindle, norm({ kindle: focus }).kindle, 'never advanced');
  assert.equal(norm({ kindle: { ...focus, focusEndsAt: NOW - 20 * MIN } }).kindle.phase, 'idle', 'ends before it starts');
  assert.equal(norm({ kindle: { ...focus, startedAt: null } }).kindle.phase, 'idle');
  assert.equal(norm({ kindle: { phase: 'rest', restStartedAt: NOW, restEndsAt: 'soon' } }).kindle.phase, 'idle');
  assert.equal(norm({ kindle: { phase: 'napping' } }).kindle.phase, 'idle');
  assert.equal(norm({ kindle: { ...focus, focusEndsAt: focus.startedAt } }).kindle.phase, 'idle', 'a focus that ends as it starts');
  const rest = { phase: 'rest', restStartedAt: NOW, restEndsAt: NOW + 15 * MIN };
  assert.equal(norm({ kindle: rest }).kindle.phase, 'rest');
  assert.equal(norm({ kindle: { ...rest, restEndsAt: NOW } }).kindle.phase, 'idle', 'a rest that ends as it starts');
  assert.deepEqual(norm({ kindle: { ...focus, paid: { focus: 'x', rest: NOW } } }).kindle.paid, { focus: null, rest: NOW });
  // Only a rest saved as earned is honoured: one saved without it, or with junk, is Banked Coals.
  assert.equal(norm({ kindle: rest }).kindle.earned, false, 'a rest saved without `earned` isn’t earned');
  for (const junk of ['yes', 1, null, {}]) assert.equal(norm({ kindle: { ...rest, earned: junk } }).kindle.earned, false, JSON.stringify(junk));
  assert.equal(norm({ kindle: { ...rest, earned: true } }).kindle.earned, true);
});

test('chronicle: 60 days, 50 fights and 120 XP lines, each day’s six largest skills', () => {
  const days = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [clean.dayKey(NOW - i * DAY), { focus: i, xp: { focus: 5, command: 900, artifice: 4, cooking: 3, mining: 2, warding: 7, wayfaring: 1, bogus: 99, seamcraft: 0 } }]));
  // As saved: newest last.
  const fights = Array.from({ length: 60 }, (_, i) => ({ id: `fight:rift:a${i}:w:r1`, at: NOW - (60 - i) * MIN, where: 'w'.repeat(70), outcome: 'won', rounds: 3, xp: 40, marks: 12, summary: 's'.repeat(250) }));
  const xpLines = Array.from({ length: 130 }, (_, i) => ({ at: NOW - (130 - i) * MIN, skill: 'focus', n: 1000 + i, source: 'focus-session', text: 'Focus 1,000: a session' }));
  const chronicle = norm({ chronicle: { days: { ...days, '2026-02-31': {} }, fights: [...fights, { id: 'nope' }], xpLines: [...xpLines, { skill: 'telepathy' }] } }).chronicle;
  assert.equal(Object.keys(chronicle.days).length, L.days);
  assert.ok(!(clean.dayKey(NOW - 65 * DAY) in chronicle.days), 'the oldest days go');
  assert.deepEqual(chronicle.days[clean.dayKey(NOW)].xp, { focus: 5, command: 900, artifice: 4, cooking: 3, mining: 2, warding: 7 }, 'non-zero skills, the six largest');
  assert.equal(chronicle.fights.length, L.fights);
  assert.deepEqual([chronicle.fights[0].id, chronicle.fights.at(-1).id], ['fight:rift:a10:w:r1', 'fight:rift:a59:w:r1'], 'the newest 50 fights are kept, newest last');
  assert.equal(chronicle.fights[0].where.length, L.where);
  assert.equal(chronicle.fights[0].summary.length, L.summary);
  assert.equal(chronicle.xpLines.length, L.xpLines);
  assert.deepEqual([chronicle.xpLines[0].n, chronicle.xpLines.at(-1).n], [1010, 1129], 'the newest 120 XP lines are kept, newest last');
});

test('road: pay-once fight keys keep the newest 500; the real-stitch mark is null until seen', () => {
  const paidFights = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`fight:rift:x${i}:w:r1`, NOW - (520 - i) * MIN]));
  const road = norm({ road: { xp: 3800.5, paidFights: { ...paidFights, 'stitch:rift:abc': NOW, 'bad key': NOW }, stitchedThrough: 'x', levelShown: 0, firstWin: 'yes' } }).road;
  assert.equal(road.xp, 3800);
  assert.equal(Object.keys(road.paidFights).length, L.paidFights);
  assert.ok('stitch:rift:abc' in road.paidFights, 'a stitch key pays once too');
  assert.ok(!('fight:rift:x0:w:r1' in road.paidFights), 'the oldest go');
  assert.deepEqual([road.stitchedThrough, road.levelShown, road.firstWin], [null, 1, false]);
  assert.equal(norm({ road: { stitchedThrough: 4 } }).road.stitchedThrough, 4);
  assert.equal(norm({ road: { stitchedThrough: 0 } }).road.stitchedThrough, 0);
});

test('party: the founders are always there, chosen ids must be on the roster, regulars bring their members', () => {
  const regular = { id: 'reg-3k9z', riftId: 'rift:abc', riftSeed: 77, name: 'Chrome beetle', genre: 'neon', second: null, archetype: 'crawler',
    bodyKey: 'e', parts: [{ id: 'antenna', layer: 0 }, { id: 'x', layer: 9 }, 'junk'], eyeKey: null, temperament: 'shy', calling: 'skirmisher', lead: false, mechanic: null, joinedAt: NOW, strayIndex: 2 };
  const party = norm({ party: {
    roster: { claude: { warmth: 5000, control: 'boss', path: 'Three Pens', boons: ['a', 'a', 'b', 'c', 'd'] }, con: {}, 'reg-orphan': {}, tollkeeper: { joinedAt: NOW }, 'NOT-A-SLUG': {} },
    chosen: ['milo', 'claude', 'claude', 'ghost', 'tollkeeper', 'codex', 'jev'],
    regulars: [regular, regular, { ...regular, id: 'reg-2', archetype: 'dragon' }],
    cheers: 9, formation: 'circle', mode: 'hard', play: 'auto',
  } }).party;
  assert.deepEqual(Object.keys(party.roster), ['milo', 'claude', 'codex', 'jev', 'tollkeeper', 'reg-3k9z'], 'founders first; a device name, a regular without its record and a non-slug go');
  assert.equal(party.roster.claude.warmth, L.warmth);
  assert.equal(party.roster.claude.control, 'review');
  assert.equal(party.roster.claude.path, null);
  assert.deepEqual(party.roster.claude.boons, ['a', 'b', 'c']);
  assert.equal(party.roster.codex.joinedAt, 0, 'always his: joined from the start');
  assert.equal(party.roster['reg-3k9z'].joinedAt, NOW, 'a regular’s member joins when the regular did');
  assert.deepEqual(party.chosen, ['claude', 'tollkeeper', 'codex'], 'never milo, no repeats, on the roster, at most 3');
  assert.equal(party.regulars.length, 1);
  assert.deepEqual(party.regulars[0].parts, [{ id: 'antenna', layer: 0 }, { id: 'x', layer: 0 }]);
  assert.equal(party.regulars[0].strayIndex, 2, 'a regular keeps fields it doesn’t know');
  assert.deepEqual([party.cheers, party.formation, party.mode, party.play], [4, 'line', 'long-road', 'guided']);
  assert.deepEqual(norm({ party: { chosen: [] } }).party.chosen, [], 'going alone is a choice that’s kept');
  assert.deepEqual(norm({ party: { chosen: 'x' } }).party.chosen, ['claude', 'codex', 'jev']);
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`friend-${i}`, {}]));
  assert.equal(Object.keys(norm({ party: { roster: many } }).party.roster).length, 4 + 1, 'the roster is bounded: one named companion beyond the founders');
  const crowd = norm({ party: { roster: { ...many, rivet: {}, tollkeeper: { warmth: 12 } } } }).party.roster;
  assert.deepEqual(Object.keys(crowd), ['milo', 'claude', 'codex', 'jev', 'tollkeeper'], 'the Tollkeeper, the one Phase 4 recruits, is kept first');
  assert.equal(crowd.tollkeeper.warmth, 12);
  assert.deepEqual(Object.keys(norm({ party: { roster: { rivet: {} } } }).party.roster), ['milo', 'claude', 'codex', 'jev', 'rivet'], 'any one other name fits while he hasn’t joined');
});

test('party: a notebook’s meta, reactions, gifts and the calm settings are cleaned', () => {
  const member = norm({ party: { roster: { claude: {
    reactions: { shoulder: 'always', 'parting-swipe': 'sometimes', ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`r${i}`, 'ask'])) },
    prepared: ['inkdarts', 'inkdarts', 'full-stop', 'Bad Id'],
    gifts: { margin: 7, spare: -1, through: 'x' },
    notebook: {
      count: 50000.7, fights: 2e6, rules: [...Array.from({ length: 8 }, (_, i) => ({ if: `if-${i}`, then: `then-${i}`, extra: 1 })), { if: 'x' }],
      struck: [...Array.from({ length: 45 }, (_, i) => `${i}:${i}`), '1:1', 'bad'], accepts: '10x1a0'.repeat(20), previous: { count: 5, at: 'never' },
    },
  } } } }).party.roster.claude;
  assert.equal(Object.keys(member.reactions).length, L.reactions);
  assert.equal(member.reactions.shoulder, 'always');
  assert.ok(!('parting-swipe' in member.reactions));
  assert.deepEqual(member.prepared, ['inkdarts', 'full-stop']);
  assert.deepEqual(member.gifts, { margin: 3, spare: 0, through: null });
  assert.equal(member.notebook.count, 50000);
  assert.equal(member.notebook.fights, L.notebookFights);
  assert.equal(member.notebook.rules.length, L.rules);
  assert.deepEqual(member.notebook.rules[0], { if: 'if-0', then: 'then-0' });
  assert.equal(member.notebook.struck.length, L.struck);
  assert.equal(member.notebook.struck[0], '0:0', 'the first 40 are kept; nothing struck is dropped by the cleaner below the cap');
  const struck = (list) => norm({ party: { roster: { claude: { notebook: { struck: list } } } } }).party.roster.claude.notebook.struck;
  assert.deepEqual(struck(['1:1', '2:2', '1:1', '3:3', '2:2']), ['1:1', '2:2', '3:3'], 'a habit struck twice is kept once, at its first place');
  const repeats = [...Array.from({ length: 39 }, (_, i) => `${i}:${i}`), '0:0', '5:5', '39:39'];
  assert.deepEqual(struck(repeats), [...repeats.slice(0, 39), '39:39'], 'a repeat never takes a place under the cap');
  assert.equal(member.notebook.accepts.length, L.accepts);
  assert.match(member.notebook.accepts, /^[01]+$/);
  assert.equal(member.notebook.previous, null);
  const calm = norm({ party: { calm: { noise: 'no', odds: 'numbers', playback: 3, ghosts: true, later: 1 } } }).party.calm;
  assert.deepEqual(calm, { noise: true, adaptation: true, odds: 'bars', fastFoes: true, playback: 1, ghosts: true, later: 1 });
  assert.deepEqual(emptyMember(0), createState(NOW).party.roster.milo);
});

test('party: the outing, rests, stray memory and scenes are bounded', () => {
  const party = norm({ party: {
    outing: { startedAt: NOW, breathers: 40, breatherFight: 'fight:rift:a:w:r1', heroes: { milo: { integrity: 12.4, charges: 2, uses: { 'second-breath': 1, bad: 'x' }, rattled: 1 }, 'Bad Id': {} } },
    rests: { lanternDay: 20000.2, nooks: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`rift:n${i}`, NOW - (60 - i)])), freeReentry: { 'cave:1,-2': NOW, 'poi:x': NOW } },
    strayMemory: { ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`genre${String.fromCharCode(97 + i)}`, { habit: '3:4', count: i }])), neon: { habit: 'bad', count: 3 } },
    seenScenes: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`arrival-${i}`, NOW - (120 - i)])),
    teachDay: 'tonight',
  } }).party;
  assert.deepEqual(party.outing.heroes, { milo: { integrity: 12, charges: 2, uses: { 'second-breath': 1 }, rattled: false } });
  assert.equal(party.outing.breathers, L.breathers);
  assert.equal(party.rests.lanternDay, 20000);
  assert.equal(Object.keys(party.rests.nooks).length, L.nooks);
  assert.deepEqual(party.rests.freeReentry, { 'cave:1,-2': NOW });
  assert.equal(Object.keys(party.strayMemory).length, L.strayMemory);
  assert.ok(!('neon' in party.strayMemory));
  assert.equal(Object.keys(party.seenScenes).length, L.seenScenes);
  assert.equal(party.teachDay, null);
});

test('expedition: kept only with a kind, a run id and a source it can be rebuilt from', () => {
  const wild = { runId: 'run:7', kind: 'wild', riftId: 'rift:abc', source: { seed: 4294967295, tier: 3, depth: 4, weights: { neon: 1.25, 'Bad Genre': 2, void: -1 }, rungs: 2 }, depth: 4, tier: 3, enteredAt: NOW, embersPaid: 6, inside: true, rooms: { r0: 'won', r1: 'lost', lead: 'bowed' }, chests: { 'loot:1': NOW }, entry: { milo: 18, claude: 'x' }, card: 'victory' };
  const kept = norm({ expedition: wild }).expedition;
  assert.deepEqual(kept.source, { seed: 4294967295, tier: 3, depth: 4, weights: { neon: 1.25 }, rungs: 2 });
  assert.deepEqual(kept.rooms, { r0: 'won', lead: 'bowed' });
  assert.deepEqual(kept.entry, { milo: 18 });
  assert.equal(kept.battle, null);
  assert.equal(kept.card, 'victory');
  const real = { runId: 'run:8', kind: 'real', key: 'knock:claude:abc', since: NOW - DAY, source: { key: 'knock:claude:abc', subject: '“Letters”', signals: ['needs-you-unanswered', 'BAD'], urgency: 0.123456, tier: 1, cause: 'c', since: NOW - DAY } };
  assert.equal(norm({ expedition: real }).expedition.source.urgency, 0.123456, 'a real rift’s urgency is kept exactly, so a resume rebuilds the same rift');
  const caveDay = clean.dayNumber(NOW);
  const cave = norm({ expedition: { runId: 'run:9', kind: 'cave', riftId: 'cave:-40,12', source: { poi: 'poi:cave:-40,12', day: caveDay } } }).expedition;
  assert.deepEqual(cave.source, { poi: 'poi:cave:-40,12', day: caveDay });
  assert.equal(cave.riftId, 'cave:-40,12', 'a cave’s place id is kept as its riftId');
  for (const riftId of ['cave:x,1', 'cave:-40', 'poi:cave:-40,12', 'rift:', 5]) {
    assert.equal(norm({ expedition: { runId: 'run:9', kind: 'cave', riftId, source: { poi: 'poi:cave:-40,12', day: caveDay } } }).expedition.riftId, null, String(riftId));
  }
  const field = norm({ expedition: { runId: 'run:10', kind: 'field', source: { seed: 1, tier: 6, depth: 2, weights: {}, x: -300, y: 40 } } }).expedition;
  assert.deepEqual([field.source.x, field.source.y], [-300, 40]);
  // A real rift's signals are distinct, and its urgency is within 0 to 1.
  const realSource = (over) => norm({ expedition: { ...real, source: { ...real.source, ...over } } }).expedition.source;
  assert.deepEqual(realSource({ signals: ['long-wait', 'needs-you-unanswered', 'long-wait', 'needs-you-unanswered'] }).signals, ['long-wait', 'needs-you-unanswered'], 'a repeated signal is kept once');
  for (const [urgency, kept] of [[-0.5, 0], [-1e-9, 0], [0, 0], [1, 1], [1.5, 1], ['high', 0]]) assert.equal(realSource({ urgency }).urgency, kept, `urgency ${urgency}`);
  // Only the six kinds: a real rift's source under any other kind isn't kept.
  for (const bad of [{ ...wild, kind: 'dream' }, { ...real, kind: 'dream' }, { ...real, kind: 'Real' }, { ...real, kind: '' }, { ...wild, runId: '' }, { ...wild, source: { tier: 3 } }, { ...real, source: { key: 'nope' } }, { runId: 'r', kind: 'cave', source: { poi: 'x', day: caveDay } }]) {
    assert.equal(norm({ expedition: bad }).expedition, null, JSON.stringify(bad));
  }
});

test('expedition: a BattleSave is kept stripped and whole, or dropped over its cap, and the expedition stays', () => {
  const base = { runId: 'run:1', kind: 'wild', source: { seed: 1, tier: 1, depth: 1, weights: {} } };
  const battle = { v: 2, id: 'fight:rift:a:w:r1', round: 3, units: [{ id: 'milo', conditions: [{ id: 'tumbled', n: null, data: { deep: { deeper: [1, 2] } } }] }], log: ['Milo braces.'] };
  assert.deepEqual(norm({ expedition: { ...base, battle } }).expedition.battle, battle);
  for (const bad of [{ ...battle, v: 1 }, { ...battle, id: 5 }, { ...battle, id: '' }, [battle], 'battle']) {
    const exp = norm({ expedition: { ...base, battle: bad } }).expedition;
    assert.equal(exp.battle, null, JSON.stringify(bad).slice(0, 40));
    assert.equal(exp.runId, 'run:1', 'the expedition stays');
  }
  const huge = { ...battle, pad: '' };
  huge.pad = 'z'.repeat(L.battleBytes - battleBytes(huge));
  assert.equal(battleBytes(huge), L.battleBytes);
  assert.deepEqual(norm({ expedition: { ...base, battle: huge } }).expedition.battle, huge, 'exactly at the cap is kept');
  assert.equal(norm({ expedition: { ...base, battle: { ...huge, pad: `${huge.pad}z` } } }).expedition.battle, null, 'one byte over is dropped');
  assert.equal(norm({ expedition: { ...base, battle } }, NOW + 30 * DAY).expedition.battle.round, 3, 'a later clock never prunes a live fight');
});

test('the caps A chose keep what they should when fed more than they hold', () => {
  const heroes = ['milo', 'claude', 'codex', 'jev', 'tollkeeper', 'reg-a1'];
  // A member's pending choices keep the first four; a week's outing warmth stops at +6.
  const member = (over) => norm({ party: { roster: { claude: over } } }).party.roster.claude;
  assert.deepEqual(member({ pending: ['boon', 'boon', 'path', 'path', 'path', 'boon', 'x'] }).pending, ['boon', 'boon', 'path', 'path'], 'the first four, in order');
  for (const [outing, kept] of [[5, 5], [6, 6], [7, 6], [99, 6]]) {
    assert.equal(member({ warmthWeek: { week: 20000, outing } }).warmthWeek.outing, kept, `a week's outing warmth of ${outing}`);
  }
  // The outing's heroes and an expedition's entry Integrity: Milo and three, the first four.
  const party = norm({ party: { outing: { heroes: Object.fromEntries(heroes.map((id) => [id, { integrity: 10 }])) } } }).party;
  assert.deepEqual(Object.keys(party.outing.heroes), heroes.slice(0, L.outingHeroes));
  const base = { runId: 'run:1', kind: 'wild', source: { seed: 1, tier: 1, depth: 1, weights: {} } };
  const rooms = Object.fromEntries(Array.from({ length: L.rooms + 8 }, (_, i) => [`r${i}`, 'won']));
  const expedition = norm({ expedition: { ...base, rooms, entry: Object.fromEntries(heroes.map((id, i) => [id, 10 + i])) } }).expedition;
  assert.deepEqual(Object.keys(expedition.entry), heroes.slice(0, L.entry));
  assert.deepEqual(Object.keys(expedition.rooms), Object.keys(rooms).slice(0, L.rooms), 'the first 32 rooms settled are kept');
  // Features first used and answered waits keep the newest.
  const features = Object.fromEntries(Array.from({ length: L.features + 8 }, (_, i) => [`feature-${i}`, NOW - (40 - i) * MIN]));
  const answeredWaits = Object.fromEntries(Array.from({ length: L.answeredWaits + 10 }, (_, i) => [`claude:w${i}`, NOW - (70 - i) * MIN]));
  const tally = norm({ tally: { features, answeredWaits } }).tally;
  assert.deepEqual(Object.keys(tally.features).sort(), Object.keys(features).slice(8).sort(), 'the newest 32 features');
  assert.deepEqual(Object.keys(tally.answeredWaits).sort(), Object.keys(answeredWaits).slice(10).sort(), 'the newest 60 answered waits');
  assertIdempotent(norm({ tally: { features, answeredWaits }, expedition: { ...base, rooms } }), 'the capped maps');
});

test('fed more than they hold, the notebook keeps the newest accepts and the stray memory the habits seen most', () => {
  // accepts: the newest 50 are the last 50 characters (newest last), in a pattern that tells the ends apart.
  const accepts = `${'0'.repeat(30)}${'1'.repeat(10)}${'10'.repeat(20)}${'1'.repeat(4)}0`;
  const member = norm({ party: { roster: { claude: { notebook: { accepts } } } } }).party.roster.claude;
  assert.equal(member.notebook.accepts, accepts.slice(-L.accepts));
  assert.notEqual(member.notebook.accepts, accepts.slice(0, L.accepts), 'the oldest go, never the newest');
  // strayMemory: the 12 genres whose habit has come up most are kept.
  const genres = Array.from({ length: L.strayMemory + 3 }, (_, i) => `genre${String.fromCharCode(97 + i)}`);
  const strayMemory = Object.fromEntries(genres.map((genre, i) => [genre, { habit: `${i}:1`, count: ((i * 7) % 15) + 1 }]));
  const kept = norm({ party: { strayMemory } }).party.strayMemory;
  const byCount = [...genres].sort((a, b) => strayMemory[b].count - strayMemory[a].count);
  assert.deepEqual(Object.keys(kept).sort(), byCount.slice(0, L.strayMemory).sort());
  for (const genre of byCount.slice(L.strayMemory)) assert.ok(!(genre in kept), `${genre}, seen ${strayMemory[genre].count} times, goes`);
  assert.deepEqual(kept[byCount[0]], strayMemory[byCount[0]]);
});

/* ------------------------------------------------------------------ a whole save, kept */

// A save with every Phase 4 field set, valid and away from its default. The idempotence and junk
// tests can't see a cleaner that quietly drops or resets a valid field (the result is still well
// formed and idempotent), so these compare a whole save with what a reload gives back (§8.1:
// nothing valid is lost, counters never go down, unknown sub-keys survive).
const ago = (hours) => NOW - hours * HOUR;
function wholeSave() {
  const base = createState(NOW);
  const today = clean.dayKey(NOW);
  const yesterday = clean.dayKey(NOW - DAY);
  const member = (joinedAt, n) => ({
    joinedAt,
    warmth: 40 + n, warmthWeek: { week: clean.weekStart(NOW), outing: 4, later: n }, habitDay: clean.dayNumber(NOW) - n,
    path: `quiet-order-${n}`, boons: ['steady-hands', 'second-wind', `boon-${n}`], pending: ['boon', 'path'], control: n % 2 ? 'mine' : 'choose',
    reactions: { 'parting-swipe': 'always', shoulder: 'under-half', ready: 'never', brace: 'ask' }, prepared: ['little-light', `page-${n}`],
    gifts: { margin: 2, spare: 1, through: 17 + n, later: n },
    notebook: {
      count: 1234 + n, fights: 12 + n, rules: [{ if: 'anyone-below-half', then: 'patch-them-first' }, { if: 'a-lead-telegraphs', then: 'brace' }],
      struck: ['12:4242', `3:${n + 7}`], accepts: '1101001110', previous: { count: 1200 + n, at: ago(3 + n) }, later: n,
    },
    later: { note: 'a field a later phase adds' },
  });
  const regular = {
    id: 'reg-1a2b3c', riftId: 'rift:abc123', riftSeed: 123456, name: 'A curious crawler', genre: 'neon', second: 'noir', archetype: 'crawler',
    bodyKey: 'R', parts: [{ id: 'neon-fin', layer: 0 }, { id: 'noir-hat', layer: 1 }], eyeKey: 'u', temperament: 'curious', calling: 'chorister',
    lead: true, mechanic: 'noon-duel', joinedAt: ago(2), strayIndex: 3,
  };
  return {
    ...base,
    settings: { ...base.settings, hud: 'quiet', kindleBell: false },
    tally: {
      ...base.tally, daysSeen: 12, lastDay: yesterday, sessionsFinished: 10, finishedIds: ['claude:a', 'claude:b', 'codex:c', 'jev:d', 'whisper:e'], buildingsDesigned: 1,
      byCrew: { claude: 5, codex: 3, jev: 1, whisper: 1 }, answered: 3, answeredFast: 2,
      waiting: { 'claude:w1': NOW - 5 * MIN }, answeredWaits: { 'claude:a': ago(2) }, focusSessions: 3, restsHonoured: 2, chunksCharted: 9,
      features: { kindle: ago(3), chronicle: ago(2) }, later: 1,
    },
    satchel: { ...base.satchel, marks: 120, tonics: { cordial: 2, brew: 1, later: 1 } },
    rifts: { ...base.rifts, stitched: { ...base.rifts.stitched, real: 2 } },
    story: {
      ...base.story,
      trails: { 'riddle-notes': { found: { 'first-note': ago(3), 'second-note': ago(2) }, done: { 'first-note': ago(2) }, joinedAt: ago(1), later: 1 } },
      facts: { 'note:first-note': ago(3), 'examined:neon:crawler': ago(1), 'glimmer:poi:ruin:12,-4': ago(2), 'riddle:bridge-1': ago(1) },
    },
    embers: {
      balance: 37, lifetime: 950,
      ledger: [
        { at: ago(30), n: 905, banked: 100, source: 'backlog', text: 'From before the Kit' },
        { at: ago(2), n: 10, banked: 0, source: 'focus', text: 'Focus session 11:00–11:50' },
        { at: ago(1), n: -5, banked: 0, source: 'wild', text: 'Stepped into a wild rift' },
      ],
      paid: { [`focus:${ago(3)}`]: ago(2), [`rest:${ago(2)}`]: ago(2) + 15 * MIN },
      paidBefore: ago(300),
      through: { sessionsFinished: 10, answered: 3, stitchedReal: 2, buildingsDesigned: 1 },
      day: { key: today, crew: 4, answered: 1, later: 1 },
      backlogAt: ago(30),
      later: { kept: true },
    },
    xp: {
      skills: { focus: 3000, command: 500, hearthkeeping: 400, cartography: 360 },
      through: { sessionsFinished: 10, answeredFast: 2, buildingsDesigned: 1, later: 1 },
      day: { key: today, travels: 3 },
      later: 1,
    },
    kindle: {
      phase: 'rest', startedAt: NOW - 60 * MIN, focusEndsAt: NOW - 10 * MIN, restStartedAt: NOW - 10 * MIN, restEndsAt: NOW + 5 * MIN, earned: true,
      paid: { focus: NOW - 60 * MIN, rest: ago(5) }, later: 1,
    },
    chronicle: {
      days: {
        [yesterday]: { embersIn: 905, embersOut: 5, focus: 2, rests: 1, crew: 6, answered: 2, stitched: 2, fights: 1, xp: { focus: 2000, hearthkeeping: 400, command: 300 } },
        [today]: { embersIn: 10, embersOut: 1, focus: 1, rests: 1, crew: 4, answered: 1, stitched: 1, fights: 2, xp: { focus: 1000, command: 200, cartography: 40 } },
      },
      fights: [
        { id: 'fight:rift:abc123:w:r1', at: ago(20), where: 'A neon rift, the second room', outcome: 'won', rounds: 3, xp: 40, marks: 12, summary: 'Milo kept the lantern high, and the crawler settled.' },
        { id: 'fight:rift:abc123:w:lead', at: ago(1), where: 'A neon rift’s lead room', outcome: 'bowed', rounds: 5, xp: 90, marks: 30, summary: 'The lead bowed out at ‘The last page’.' },
      ],
      xpLines: [
        { at: ago(2), skill: 'focus', n: 1000, source: 'focus-session', text: 'Focus 1,000: focus session 11:00–11:50' },
        { at: ago(1), skill: 'cartography', n: 40, source: 'chunk-charted', text: 'Cartography 40: a new chunk charted' },
      ],
      later: 1,
    },
    road: { xp: 1234, paidFights: { 'fight:rift:abc123:w:r1': ago(20), 'stitch:rift:abc123': ago(19) }, stitchedThrough: 2, levelShown: 3, firstWin: true, later: 1 },
    party: {
      roster: { milo: member(0, 0), claude: member(0, 1), codex: member(0, 2), jev: member(0, 3), tollkeeper: member(ago(50), 4), [regular.id]: member(ago(2), 5) },
      chosen: ['tollkeeper', regular.id, 'claude'],
      formation: 'wedge',
      cheers: 2,
      regulars: [regular],
      outing: {
        startedAt: ago(1), breathers: 1, breatherFight: 'fight:rift:abc123:w:r1', freeBreather: true, warmed: true,
        heroes: {
          milo: { integrity: 18, charges: 2, uses: { 'second-breath': 1 }, rattled: true, later: 1 },
          tollkeeper: { integrity: 26, charges: 1, uses: { riddle: 2, 'toll-gate': 1 }, rattled: true },
        },
        later: 1,
      },
      rests: { lanternDay: clean.dayNumber(NOW), nooks: { 'rift:abc123': ago(1), 'cave:-40,12': NOW - 30 * MIN }, freeReentry: { 'rift:abc123': ago(1) }, later: 1 },
      mode: 'storybook',
      play: 'command',
      calm: { noise: false, adaptation: false, odds: 'words', fastFoes: false, playback: 2, ghosts: true, later: 1 },
      strayMemory: { neon: { habit: '12:4242', count: 3 }, noir: { habit: '4:17', count: 9 } },
      firstLeadMet: true,
      teachDay: clean.dayNumber(NOW) - 1,
      seenScenes: { 'scribe-acquaintance': ago(3), 'first-night': ago(40) },
      later: { kept: true },
    },
    expedition: {
      runId: 'run:knock:abc', kind: 'real', riftId: 'rift:abc123', key: 'knock:claude:abc', since: ago(26),
      source: { key: 'knock:claude:abc', subject: '“Letters”', signals: ['needs-you-unanswered', 'long-wait'], urgency: 0.625, tier: 2, cause: 'A session waited for an answer', since: ago(26), later: 1 },
      depth: 3, tier: 2, enteredAt: ago(1), embersPaid: 5, inside: true,
      rooms: { r0: 'won', r1: 'talked', lead: 'bowed' }, chests: { 'loot:1': ago(1), 'loot:2': NOW - 20 * MIN }, nookUsed: true,
      entry: { milo: 18, claude: 20, tollkeeper: 26 },
      battle: { v: 2, id: 'fight:rift:abc123:real:r1', round: 2, units: [{ id: 'milo', integrity: 12, conditions: [{ id: 'braced', n: 1 }] }] },
      card: 'victory',
      later: 1,
    },
  };
}

// What each field falls back to, for the shapes that have no empty value of their own.
const REGULAR_DEFAULTS = { riftId: null, riftSeed: 0, second: null, bodyKey: 'r', parts: [], eyeKey: null, temperament: 'shy', lead: false, mechanic: null, joinedAt: 0 };
const HERO_DEFAULTS = { integrity: 0, charges: 0, uses: {}, rattled: false };
const EXPEDITION_DEFAULTS = {
  riftId: null, key: null, since: null, depth: 1, tier: 1, enteredAt: 0, embersPaid: 0, inside: false, rooms: {}, chests: {}, nookUsed: false, entry: {}, battle: null, card: null,
};
const REAL_SOURCE_DEFAULTS = { subject: '', signals: [], urgency: 0, tier: 1, cause: '', since: null };
const FIGHT_DEFAULTS = { where: '', rounds: 0, xp: 0, marks: 0, summary: '' };
const TRAIL_DEFAULTS = { found: {}, done: {}, joinedAt: null };

/** Fails on any field of `empty` that `value` leaves missing or at its default (records are walked into). */
function assertAwayFromDefaults(value, empty, where, skip = []) {
  for (const key of Object.keys(empty)) {
    if (skip.includes(key)) continue;
    assert.ok(clean.isRecord(value) && Object.hasOwn(value, key), `${where}.${key} is set`);
    const fallback = empty[key];
    if (clean.isRecord(fallback) && Object.keys(fallback).length) assertAwayFromDefaults(value[key], fallback, `${where}.${key}`);
    else assert.notDeepEqual(value[key], fallback, `${where}.${key} is away from its default`);
  }
}

test('the whole save sets every Phase 4 field away from its default', () => {
  const save = wholeSave();
  assertAwayFromDefaults(save.embers, emptyEmbers(), 'embers');
  assertAwayFromDefaults(save.xp, emptyXp(), 'xp');
  assertAwayFromDefaults(save.kindle, emptyKindle(), 'kindle');
  assertAwayFromDefaults(save.chronicle, emptyChronicle(), 'chronicle');
  for (const [key, day] of Object.entries(save.chronicle.days)) assertAwayFromDefaults(day, emptyDay(), `chronicle.days.${key}`);
  for (const fight of save.chronicle.fights) assertAwayFromDefaults(fight, FIGHT_DEFAULTS, `fight ${fight.id}`);
  assertAwayFromDefaults(save.road, emptyRoad(), 'road');
  assertAwayFromDefaults(save.party, emptyParty(), 'party', ['roster', 'outing']);
  assert.ok(Object.keys(save.party.roster).length > FOUNDERS.length, 'a named companion and a regular have joined');
  for (const [id, member] of Object.entries(save.party.roster)) {
    // The founders joined "from the start" (0); everyone else's joinedAt is checked.
    assertAwayFromDefaults(member, emptyMember(0), `party.roster.${id}`, FOUNDERS.includes(id) ? ['joinedAt'] : []);
  }
  assertAwayFromDefaults(save.party.outing, emptyOuting(), 'party.outing', ['heroes']);
  assert.ok(Object.keys(save.party.outing.heroes).length > 1);
  for (const [id, hero] of Object.entries(save.party.outing.heroes)) assertAwayFromDefaults(hero, HERO_DEFAULTS, `party.outing.heroes.${id}`);
  for (const regular of save.party.regulars) assertAwayFromDefaults(regular, REGULAR_DEFAULTS, `regular ${regular.id}`);
  assertAwayFromDefaults(save.expedition, EXPEDITION_DEFAULTS, 'expedition');
  assertAwayFromDefaults(save.expedition.source, REAL_SOURCE_DEFAULTS, 'expedition.source');
  assertAwayFromDefaults(save.tally, emptyTally4(), 'tally');
  assertAwayFromDefaults(save.satchel, emptySatchel4(), 'satchel');
  assertAwayFromDefaults(save.story, emptyStory4(), 'story');
  for (const [id, trail] of Object.entries(save.story.trails)) assertAwayFromDefaults(trail, TRAIL_DEFAULTS, `story.trails.${id}`);
  assertAwayFromDefaults(save.settings, { hud: model.DEFAULT_SETTINGS.hud, kindleBell: model.DEFAULT_SETTINGS.kindleBell }, 'settings');
});

test('a whole Phase 4 save comes back from a reload exactly as it was, however late the clock', () => {
  const save = wholeSave();
  for (const clock of [NOW, NOW + HOUR, NOW + 45 * DAY]) {
    const back = norm(roundTrip(save), clock);
    for (const key of [...STATE4_KEYS, 'tally', 'satchel', 'story', 'settings']) {
      assert.deepEqual(back[key], save[key], `${key}, reloaded ${(clock - NOW) / HOUR} hours later`);
    }
    assert.deepEqual(norm(back, clock), back, 'and again');
  }
});

test('an expedition of every kind comes back exactly as it was saved', () => {
  const sources = {
    wild: { seed: 4294967295, tier: 3, depth: 4, weights: { neon: 1.25, noir: 2 }, rungs: 2, later: 1 },
    rung: { seed: 17, tier: 4, depth: 9, weights: { 'the-hush': 1 }, rungs: 5 },
    real: wholeSave().expedition.source,
    story: { key: 'story:prologue-crack', subject: 'The first crack', signals: ['story'], urgency: 0.5, tier: 1, cause: 'The Prologue’s crack', since: ago(40) },
    cave: { poi: 'poi:cave:-40,12', day: clean.dayNumber(NOW), later: 1 },
    field: { seed: 99, tier: 5, depth: 3, weights: { neon: 2, noir: 1 }, x: -120, y: 44 },
  };
  assert.deepEqual(Object.keys(sources).sort(), [...EXPEDITION_KINDS].sort());
  for (const [kind, source] of Object.entries(sources)) {
    const expedition = { ...wholeSave().expedition, runId: `run:${kind}`, kind, source, riftId: kind === 'cave' ? 'cave:-40,12' : 'rift:abc123' };
    const back = norm(roundTrip({ ...createState(NOW), expedition }), NOW + 45 * DAY).expedition;
    assert.deepEqual(back, expedition, kind);
  }
  // A field boss is rebuilt from where it roams, so a source without both x and y can't be kept.
  const { x, y, ...placeless } = sources.field;
  assert.deepEqual([x, y], [-120, 44]);
  for (const where of [{ x: -120 }, { y: 44 }, { x: 'west', y: 44 }, {}]) {
    const expedition = { runId: 'run:field', kind: 'field', source: { ...placeless, ...where } };
    assert.equal(norm({ expedition }).expedition, null, JSON.stringify(where));
  }
});

test('§18.2: a cave keeps its place id and entry day, and a wild or field source keeps worldgen’s spawn exactly', () => {
  // Item 3: riftId 'cave:<x>,<y>', source { poi: 'poi:cave:<x>,<y>', day }. Without a day, or with
  // another place's id, the cave can't be rebuilt (caves.js caveFromSource), so the expedition goes.
  const day = clean.dayNumber(NOW);
  const cave = (source) => norm({ expedition: { runId: 'run:cave', kind: 'cave', riftId: 'cave:12,-61', source } }).expedition;
  for (const kept of [{ poi: 'poi:cave:12,-61', day }, { poi: 'poi:cave:12,-61', day: 0 }]) assert.deepEqual(cave(kept).source, kept);
  assert.equal(cave({ poi: 'poi:cave:12,-61', day }).riftId, 'cave:12,-61');
  for (const bad of [{ poi: 'poi:cave:12,-61' }, { poi: 'cave:12,-61', day }, { poi: 'poi:ruin:12,-61', day }, { poi: 'poi:cave:12,-61', day: day + 0.5 }, { poi: 'poi:cave:12,-61', day: `${day}` }]) {
    assert.equal(cave(bad), null, JSON.stringify(bad));
  }
  // Item 9: L1 stores the spawn's inputs, weights included, since the rift record carries no weights.
  const world = createWorldgen({ seed: 'hushlands' });
  let spawns = 0;
  let mixed = 0;
  let affine = 0;
  // Chunks near the Hearth and out past depth 7, where the far lands mix every genre.
  const chunks = [];
  for (let cx = -20; cx <= 20; cx += 2) for (let cy = -20; cy <= 20; cy += 2) chunks.push([cx, cy]);
  for (let i = -90; i <= 90; i += 15) chunks.push([i, 90], [90, i], [i, -90], [-90, i]);
  for (const spawnDay of [day, day + 1, day + 40]) {
    for (const [cx, cy] of chunks) {
      for (const spawn of world.wildRiftSpawns(cx, cy, spawnDay)) {
        spawns += 1;
        if (Object.values(spawn.weights).every((w) => w === 1.2)) mixed += 1;
        if (Object.values(spawn.weights).some((w) => !Number.isInteger(w) && w !== 1.2)) affine += 1;
        const wild = { seed: spawn.seed, tier: spawn.tier, depth: spawn.depth, weights: spawn.weights, rungs: 0 };
        for (const [kind, source] of [['wild', wild], ['rung', { ...wild, rungs: 3 }], ['field', { ...spawn }]]) {
          const expedition = norm(roundTrip({ expedition: { runId: `run:${kind}`, kind, riftId: 'rift:abc123', source } }), NOW + 45 * DAY).expedition;
          assert.deepEqual(expedition && expedition.source, source, `${kind} at ${spawn.x},${spawn.y} on day ${spawnDay}`);
        }
      }
    }
  }
  assert.ok(spawns > 150 && mixed > 0 && affine > 0, `${spawns} spawns: ${mixed} in the far lands' mix, ${affine} with a region's pull`);
});

/* ------------------------------------------------------------------ every number, id and choice at its edges */

// The whole save above holds one value per field, well inside every bound, so a cleaner whose bound
// is too tight, or that resets a value past its bound instead of holding it there, still passes it.
// These put each field at its edges, one field at a time, into the whole save, reload it through
// JSON at a clock 45 days on, and read that one field back.
const LATE = NOW + 45 * DAY;
const TODAY = clean.dayKey(NOW);
const REG = 'reg-1a2b3c';
const getIn = (value, path) => path.reduce((here, key) => (here === null || here === undefined ? undefined : here[key]), value);
function setIn(value, path, next) {
  const copy = roundTrip(value);
  let here = copy;
  for (const key of path.slice(0, -1)) here = here[key];
  here[path.at(-1)] = next;
  return copy;
}
const reload = (save, clock = LATE) => norm(roundTrip(save), clock);
// A small seeded generator (mulberry32), so every run tries the same values.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 0 … n − 1 in a seeded shuffled order. Rank r is the r-th newest, so times saved in this order aren't in time order. */
function shuffledRanks(n, seed) {
  const random = seeded(seed);
  const ranks = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  return ranks;
}
/** Whole values from lo to cap: both ends, their neighbours, the middle and a seeded spread over every order of magnitude. */
function valuesUpTo(lo, cap, seed) {
  const random = seeded(seed);
  const span = Math.log(cap - lo + 1);
  const values = new Set([lo, lo + 1, Math.floor((lo + cap) / 2), cap - 1, cap]);
  for (let i = 0; i < 10; i += 1) values.add(lo + Math.floor(Math.exp(random() * span)) - 1);
  return [...values].filter((v) => v >= lo && v <= cap).sort((a, b) => a - b);
}
/**
 * Every value from lo to cap comes back exactly, however late the clock; a value past cap reads as
 * cap, never less (never back at a default); a fraction reads as the whole number below it.
 */
function assertBounded({ path, lo = 0, cap, prepare = (save) => save }, seed) {
  const where = path.join('.');
  const base = prepare(wholeSave());
  assert.notEqual(getIn(base, path), undefined, `${where} is in the whole save`);
  for (const value of valuesUpTo(lo, cap, seed)) {
    const back = reload(setIn(base, path, value));
    assert.equal(getIn(back, path), value, `${where}: ${value} is kept`);
    assert.equal(getIn(norm(back, NOW), path), value, `${where}: ${value} is kept at an earlier clock too`);
  }
  for (const value of [cap + 1, cap * 3 + 0.5]) assert.equal(getIn(reload(setIn(base, path, value)), path), cap, `${where}: ${value} reads as ${cap}`);
  const small = Math.min(cap - 1, lo + 12);
  assert.equal(getIn(reload(setIn(base, path, small + 0.75)), path), small, `${where}: ${small + 0.75} reads as ${small}`);
}

// Every counter Phase 4 keeps (§8.1: counters never go down), with its bound and the least it can
// hold in the whole save.
const DAY_COUNTS = ['embersIn', 'embersOut', 'focus', 'rests', 'crew', 'answered', 'stitched', 'fights'];
const MEMBER_COUNTERS = [[['warmth'], L.warmth], [['notebook', 'count'], 1e9], [['notebook', 'fights'], L.notebookFights], [['notebook', 'previous', 'count'], 1e9], [['gifts', 'through'], 1e9]];
// byCrew never passes sessionsFinished all together (§8.2), so each agent is tried with room for all of it.
const roomForOne = (save) => ({ ...save, tally: { ...save.tally, finishedIds: [], sessionsFinished: 1e9, byCrew: { claude: 0, codex: 0, jev: 0, whisper: 0 } } });
const COUNTERS = [
  { path: ['embers', 'lifetime'], lo: 100, cap: 1e9 }, // the whole save's ledger banked 100
  { path: ['embers', 'paidBefore'], cap: 8.64e15 },
  ...['sessionsFinished', 'answered', 'stitchedReal', 'buildingsDesigned'].map((field) => ({ path: ['embers', 'through', field], cap: 1e9 })),
  ...SKILL_IDS.map((skill) => ({ path: ['xp', 'skills', skill], lo: 1, cap: L.xp, prepare: (save) => setIn(save, ['xp', 'skills', skill], 1) })),
  ...['sessionsFinished', 'answeredFast', 'buildingsDesigned'].map((field) => ({ path: ['xp', 'through', field], cap: 1e9 })),
  { path: ['road', 'xp'], cap: 1e9 },
  { path: ['road', 'stitchedThrough'], cap: 1e9 },
  { path: ['road', 'levelShown'], lo: 1, cap: L.level },
  ...DAY_COUNTS.map((field) => ({ path: ['chronicle', 'days', TODAY, field], cap: 1e9 })),
  { path: ['chronicle', 'days', TODAY, 'xp', 'focus'], lo: 1, cap: L.xp },
  ...['claude', 'tollkeeper', REG].flatMap((id) => MEMBER_COUNTERS.map(([field, cap]) => ({ path: ['party', 'roster', id, ...field], cap }))),
  { path: ['party', 'strayMemory', 'noir', 'count'], cap: 1e6 },
  ...CREW_AGENTS.map((agent) => ({ path: ['tally', 'byCrew', agent], cap: 1e9, prepare: roomForOne })),
  { path: ['tally', 'answered'], lo: 2, cap: 1e9 }, // never below the save's 2 fast answers
  { path: ['tally', 'answeredFast'], cap: 1e9, prepare: (save) => setIn(save, ['tally', 'answered'], 1e9) },
  ...['focusSessions', 'restsHonoured', 'chunksCharted'].map((field) => ({ path: ['tally', field], cap: 1e9 })),
  { path: ['satchel', 'marks'], cap: L.marks },
];
// The other whole numbers the cleaners bound: any value up to the bound is kept too.
const AMOUNTS = [
  { path: ['embers', 'balance'], cap: L.cap },
  { path: ['embers', 'ledger', 0, 'banked'], cap: L.cap }, // the backlog's entry, n 905
  { path: ['embers', 'day', 'crew'], cap: L.dayPaid },
  { path: ['embers', 'day', 'answered'], cap: L.dayPaid },
  { path: ['xp', 'day', 'travels'], cap: L.travels },
  { path: ['party', 'cheers'], cap: L.cheers },
  ...['claude', REG].flatMap((id) => [[['warmthWeek', 'outing'], L.weekOuting], [['gifts', 'margin'], L.gifts], [['gifts', 'spare'], L.gifts]]
    .map(([field, cap]) => ({ path: ['party', 'roster', id, ...field], cap }))),
  { path: ['party', 'outing', 'breathers'], cap: L.breathers },
  ...['milo', 'tollkeeper'].flatMap((id) => [{ path: ['party', 'outing', 'heroes', id, 'integrity'], cap: 1e4 }, { path: ['party', 'outing', 'heroes', id, 'charges'], cap: 100 }]),
  { path: ['party', 'outing', 'heroes', 'milo', 'uses', 'second-breath'], cap: 99 },
  { path: ['expedition', 'embersPaid'], cap: 1000 },
  { path: ['expedition', 'entry', 'milo'], cap: 1e4 },
  { path: ['chronicle', 'fights', 1, 'rounds'], cap: 999 },
  { path: ['chronicle', 'fights', 1, 'xp'], cap: 1e9 },
  { path: ['chronicle', 'fights', 1, 'marks'], cap: 1e9 },
  { path: ['chronicle', 'xpLines', 1, 'n'], lo: 1, cap: L.xp },
  ...['cordial', 'brew'].map((tonic) => ({ path: ['satchel', 'tonics', tonic], cap: L.tonics })),
];

test('counters never go down: each keeps any value up to its bound through a reload, and past it reads as the bound', () => {
  assert.equal(COUNTERS.length, 71, 'the table holds all 71 counters');
  COUNTERS.forEach((counter, i) => assertBounded(counter, 1000 + i));
});

test('every other bounded number keeps any value up to its bound through a reload, and past it reads as the bound', () => {
  AMOUNTS.forEach((amount, i) => assertBounded(amount, 2000 + i));
});

// For each id and text: the longest the cleaner accepts is kept, and one character more (or one
// digit more) isn't: it's dropped, nulled or clipped as `over` says.
const clipAt = (n) => (text) => `${text.slice(0, n - 1)}…`;
const A = (n, head) => head.padEnd(n, 'a');
const GONE = () => undefined;
const NULL = () => null;
const field = (path, max, over, gives = NULL) => ({ path, max, over, gives });
const key = (path, entry, max, over) => ({
  path, max, over, gives: GONE, keeps: () => entry,
  put: (save, k) => setIn(save, [...path, k], entry), read: (state, k) => getIn(state, [...path, k]),
});
function withRegularId(save, id) {
  const copy = roundTrip(save);
  copy.party.regulars[0].id = id;
  copy.party.roster = Object.fromEntries(Object.entries(copy.party.roster).map(([who, member]) => [who === REG ? id : who, member]));
  copy.party.chosen = copy.party.chosen.map((who) => (who === REG ? id : who));
  return copy;
}
const inExpedition = (kind, source) => (save) => ({ ...save, expedition: { ...save.expedition, kind, riftId: null, source } });
const EDGES = [
  // Keys
  key(['road', 'paidFights'], ago(1), A(96, 'fight:rift:'), [A(97, 'fight:rift:')]),
  key(['embers', 'paid'], ago(1), `${'a'.repeat(12)}:${'9'.repeat(16)}`, [`${'a'.repeat(13)}:${'9'.repeat(16)}`, `${'a'.repeat(12)}:${'9'.repeat(17)}`]),
  key(['party', 'seenScenes'], ago(1), A(64, 'scene:'), [A(65, 'scene:')]),
  key(['expedition', 'rooms'], 'won', A(64, 'room:'), [A(65, 'room:')]),
  key(['expedition', 'chests'], ago(1), A(64, 'loot:'), [A(65, 'loot:')]),
  key(['story', 'facts'], ago(1), A(64, 'glimmer:poi:'), [A(65, 'glimmer:poi:')]),
  key(['tally', 'features'], ago(1), A(40, 'feature-'), [A(41, 'feature-')]),
  key(['tally', 'waiting'], ago(1), A(64, 'claude:'), [A(65, 'claude:'), 'claude:has space']),
  key(['tally', 'answeredWaits'], ago(1), A(64, 'claude:'), [A(65, 'claude:')]),
  key(['party', 'rests', 'nooks'], ago(1), 'cave:-9999999,-9999999', ['cave:-99999999,-9999999', 'cave:-9999999,-99999999']),
  key(['party', 'rests', 'freeReentry'], ago(1), `rift:${'z'.repeat(13)}`, [`rift:${'z'.repeat(14)}`]),
  key(['party', 'strayMemory'], { habit: '999:99999', count: 1 }, A(24, 'g'), [A(25, 'g')]),
  key(['party', 'roster', 'claude', 'reactions'], 'always', A(40, 'reaction-'), [A(41, 'reaction-')]),
  key(['party', 'outing', 'heroes', 'milo', 'uses'], 1, A(40, 'use-'), [A(41, 'use-')]),
  key(['story', 'trails'], { found: {}, done: {}, joinedAt: null }, A(40, 'trail-'), [A(41, 'trail-')]),
  key(['story', 'trails', 'riddle-notes', 'found'], ago(1), A(40, 'step-'), [A(41, 'step-')]),
  { ...key(['expedition', 'source', 'weights'], 2, A(24, 'w'), [A(25, 'w')]), prepare: inExpedition('wild', { seed: 7, tier: 2, depth: 3, weights: {}, rungs: 0 }) },
  // A member's ids and notebook
  field(['party', 'roster', 'claude', 'path'], A(40, 'path-'), [A(41, 'path-')]),
  field(['party', 'roster', 'claude', 'boons', 2], A(40, 'boon-'), [A(41, 'boon-')], GONE),
  field(['party', 'roster', 'claude', 'prepared', 1], A(40, 'page-'), [A(41, 'page-')], GONE),
  field(['party', 'roster', 'claude', 'notebook', 'rules', 1, 'if'], A(40, 'if-'), [A(41, 'if-')], GONE),
  field(['party', 'roster', 'claude', 'notebook', 'rules', 1, 'then'], A(40, 'then-'), [A(41, 'then-')], GONE),
  field(['party', 'roster', 'claude', 'notebook', 'struck', 1], '999:99999', ['1000:1', '1:100000'], GONE),
  field(['party', 'roster', 'claude', 'notebook', 'accepts'], '10'.repeat(25), [`0${'10'.repeat(25)}`, `1111${'10'.repeat(25)}`], (text) => text.slice(-L.accepts)),
  field(['party', 'strayMemory', 'noir', 'habit'], '999:99999', ['1000:1', '1:100000'], GONE),
  // Day numbers
  ...[['party', 'rests', 'lanternDay'], ['party', 'teachDay'], ['party', 'roster', 'claude', 'habitDay'], ['party', 'roster', 'claude', 'warmthWeek', 'week']]
    .map((path) => field(path, 1e8, [1e8 + 1])),
  // A regular
  { path: ['party', 'regulars', 0, 'id'], max: `reg-${'a'.repeat(36)}`, over: [`reg-${'a'.repeat(37)}`], put: withRegularId,
    read: (state, id) => [state.party.regulars[0]?.id, Object.hasOwn(state.party.roster, id), state.party.chosen.includes(id)],
    keeps: (id) => [id, true, true], gives: () => [undefined, false, false] },
  field(['party', 'regulars', 0, 'riftId'], `rift:${'z'.repeat(13)}`, [`rift:${'z'.repeat(14)}`]),
  field(['party', 'regulars', 0, 'riftSeed'], 0xffffffff, [0x100000000], () => 0),
  field(['party', 'regulars', 0, 'name'], A(40, 'Name'), [A(41, 'Name')], clipAt(40)),
  field(['party', 'regulars', 0, 'genre'], A(24, 'g'), [A(25, 'g')], GONE),
  field(['party', 'regulars', 0, 'second'], A(24, 'g'), [A(25, 'g')]),
  field(['party', 'regulars', 0, 'calling'], A(40, 'calling-'), [A(41, 'calling-')], GONE),
  field(['party', 'regulars', 0, 'mechanic'], A(40, 'mechanic-'), [A(41, 'mechanic-')]),
  field(['party', 'regulars', 0, 'parts', 1, 'id'], A(40, 'part-'), [A(41, 'part-')], GONE),
  // The outing and the expedition
  field(['party', 'outing', 'breatherFight'], A(96, 'fight:rift:'), [A(97, 'fight:rift:')]),
  field(['expedition', 'runId'], A(80, 'run:'), [A(81, 'run:')], GONE),
  field(['expedition', 'riftId'], 'cave:-9999999,-9999999', ['cave:-99999999,-9999999', `rift:${'z'.repeat(14)}`]),
  field(['expedition', 'key'], A(159, 'capacity:'), [A(160, 'capacity:')]),
  field(['expedition', 'source', 'key'], A(159, 'capacity:'), [A(160, 'capacity:')], GONE),
  field(['expedition', 'source', 'subject'], A(40, 'Subject'), [A(41, 'Subject')], clipAt(40)),
  field(['expedition', 'source', 'cause'], A(160, 'Cause'), [A(161, 'Cause')], clipAt(160)),
  field(['expedition', 'source', 'signals', 1], A(40, 'signal-'), [A(41, 'signal-')], GONE),
  field(['expedition', 'source', 'urgency'], 1, [1.5], () => 1),
  field(['expedition', 'source', 'tier'], 99, [100], () => 1),
  field(['expedition', 'depth'], 9999, [10000], () => 1),
  field(['expedition', 'tier'], 99, [100], () => 1),
  // What a wild rift or a field boss is rebuilt from
  ...[['seed', 0xffffffff, 0x100000000, GONE], ['depth', 9999, 10000, () => 1], ['tier', 99, 100, () => 1], ['rungs', 9999, 10000, () => 9999]].map(([name, max, over, gives]) => (
    { ...field(['expedition', 'source', name], max, [over], gives), prepare: inExpedition('wild', { seed: 7, tier: 2, depth: 3, weights: { neon: 1 }, rungs: 1 }) })),
  ...['x', 'y'].flatMap((axis) => [1e6, -1e6].map((max) => (
    { ...field(['expedition', 'source', axis], max, [max + Math.sign(max)], GONE), prepare: inExpedition('field', { seed: 7, tier: 2, depth: 3, weights: {}, x: -40, y: 12 }) }))),
  // A cave: the wilds' place id and the day it was entered (§18.2 item 3)
  { ...field(['expedition', 'source', 'poi'], 'poi:cave:-9999999,-9999999', ['poi:cave:-99999999,1', 'poi:ruin:-40,12', 'cave:-40,12'], GONE),
    prepare: inExpedition('cave', { poi: 'poi:cave:-40,12', day: 20000 }) },
  { ...field(['expedition', 'source', 'day'], 1e8, [1e8 + 1, 20000.5, -1, null, '20000'], GONE), prepare: inExpedition('cave', { poi: 'poi:cave:-40,12', day: 20000 }) },
  // The Chronicle and the ledger
  field(['chronicle', 'fights', 1, 'id'], A(96, 'fight:rift:'), [A(97, 'fight:rift:')], GONE),
  field(['chronicle', 'fights', 1, 'where'], A(60, 'Where'), [A(61, 'Where')], clipAt(60)),
  field(['chronicle', 'fights', 1, 'summary'], A(200, 'Summary'), [A(201, 'Summary')], clipAt(200)),
  field(['chronicle', 'xpLines', 1, 'source'], A(20, 'source-'), [A(21, 'source-')], clipAt(20)),
  field(['chronicle', 'xpLines', 1, 'text'], A(60, 'Text'), [A(61, 'Text')], clipAt(60)),
  field(['embers', 'ledger', 2, 'source'], A(20, 'source-'), [A(21, 'source-')], clipAt(20)),
  field(['embers', 'ledger', 2, 'text'], A(60, 'Text'), [A(61, 'Text')], clipAt(60)),
  field(['embers', 'ledger', 2, 'n'], L.ledgerMin, [L.ledgerMin - 1], GONE),
  field(['embers', 'ledger', 2, 'n'], L.ledgerMax, [L.ledgerMax + 1], GONE),
];

test('the longest id and text each cleaner accepts is kept, and one character more isn’t', () => {
  for (const edge of EDGES) {
    const where = edge.path.join('.');
    const base = (edge.prepare || ((save) => save))(wholeSave());
    const put = edge.put || ((save, value) => setIn(save, edge.path, value));
    const read = edge.read || ((state) => getIn(state, edge.path));
    const keeps = edge.keeps || ((value) => value);
    assert.deepEqual(read(reload(put(base, edge.max)), edge.max), keeps(edge.max), `${where}: ${JSON.stringify(edge.max)} is kept`);
    assert.deepEqual(read(norm(put(base, edge.max), NOW), edge.max), keeps(edge.max), `${where}: kept at the clock it was saved`);
    for (const over of edge.over) {
      assert.deepEqual(read(reload(put(base, over)), over), edge.gives(over), `${where}: ${JSON.stringify(over)}`);
    }
  }
});

test('every list and map past its cap keeps exactly the entries its rule says', () => {
  const save = wholeSave();
  const names = (n, head) => Array.from({ length: n }, (_, i) => `${head}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  // A keep-newest map is saved with its times out of saved order, so its newest N are neither its
  // first N nor its last N: a cleaner that keeps by place instead of by time is caught.
  let seed = 100;
  const scattered = (keys) => {
    const ranks = shuffledRanks(keys.length, (seed += 1));
    return Object.fromEntries(keys.map((k, i) => [k, NOW - (ranks[i] + 1) * MIN]));
  };
  // What keep-newest gives: the N newest, in the order they were saved.
  const newest = (cap) => (map) => {
    const entries = Object.entries(map);
    const kept = new Set([...entries].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([k]) => k));
    const out = entries.filter(([k]) => kept.has(k));
    assert.notDeepEqual(out, entries.slice(0, cap), 'the fixture tells the newest from the first saved');
    assert.notDeepEqual(out, entries.slice(-cap), 'the fixture tells the newest from the last saved');
    return Object.fromEntries(out);
  };
  const cases = [
    // [what, path, value saved, what comes back]
    ['prepared (the first 20)', ['party', 'roster', 'claude', 'prepared'], names(L.prepared + 3, 'page-'), (v) => v.slice(0, L.prepared)],
    ['boons (the first 3)', ['party', 'roster', 'claude', 'boons'], names(L.boons + 3, 'boon-'), (v) => v.slice(0, L.boons)],
    ['uses (the first 12)', ['party', 'outing', 'heroes', 'milo', 'uses'], Object.fromEntries(names(L.uses + 3, 'use-').map((k) => [k, 1])), (v) => Object.fromEntries(Object.entries(v).slice(0, L.uses))],
    ['signals (the first 6)', ['expedition', 'source', 'signals'], names(9, 'signal-'), (v) => v.slice(0, 6)],
    ['parts (the first 4)', ['party', 'regulars', 0, 'parts'], names(L.parts + 3, 'part-').map((id) => ({ id, layer: 1 })), (v) => v.slice(0, L.parts)],
    // Keep-newest, each 3 past its cap (and the biggest well past it).
    ['chests (the newest 32)', ['expedition', 'chests'], scattered(names(L.chests + 3, 'loot-')), newest(L.chests)],
    ['found steps (the newest 12)', ['story', 'trails', 'riddle-notes', 'found'], scattered(names(L.trailSteps + 3, 'step-')), newest(L.trailSteps)],
    ['done steps (the newest 12)', ['story', 'trails', 'riddle-notes', 'done'], scattered(names(L.trailSteps + 3, 'step-')), newest(L.trailSteps)],
    ['free re-entry (the newest 50)', ['party', 'rests', 'freeReentry'], scattered(names(L.freeReentry + 3, 'rift:f')), newest(L.freeReentry)],
    ['nooks (the newest 50)', ['party', 'rests', 'nooks'], scattered(names(L.nooks + 3, 'rift:n')), newest(L.nooks)],
    ['nooks, well past the cap', ['party', 'rests', 'nooks'], scattered(names(2 * L.nooks, 'rift:n')), newest(L.nooks)],
    ['seen scenes (the newest 100)', ['party', 'seenScenes'], scattered(names(L.seenScenes + 3, 'scene-')), newest(L.seenScenes)],
    ['seen scenes, well past the cap', ['party', 'seenScenes'], scattered(names(L.seenScenes + 40, 'scene-')), newest(L.seenScenes)],
    ['waits (the newest 60)', ['tally', 'waiting'], scattered(names(L.waiting + 3, 'claude:w')), newest(L.waiting)],
    ['waits, well past the cap', ['tally', 'waiting'], scattered(names(L.waiting + 30, 'claude:w')), newest(L.waiting)],
    ['answered waits (the newest 60)', ['tally', 'answeredWaits'], scattered(names(L.answeredWaits + 3, 'claude:a')), newest(L.answeredWaits)],
    ['features (the newest 32)', ['tally', 'features'], scattered(names(L.features + 3, 'feature-')), newest(L.features)],
    ['facts (the newest 200)', ['story', 'facts'], scattered(names(L.facts + 3, 'note:n')), newest(L.facts)],
    ['pay-once fight keys (the newest 500)', ['road', 'paidFights'], scattered(names(L.paidFights + 3, 'fight:rift:x')), newest(L.paidFights)],
  ];
  // Compared as entries, so a map's order counts too.
  const inOrder = (value) => (Array.isArray(value) ? value : Object.entries(value));
  for (const [what, path, value, expected] of cases) {
    assert.deepEqual(inOrder(getIn(reload(setIn(save, path, value)), path)), inOrder(expected(value)), what);
  }
  // Trails: the 20 whose latest time (joined, a step found or a step done) is newest. They're saved
  // out of time order, and each one's latest time is in one of its three fields in turn, the others
  // a month older, so every field decides which trails stay.
  const OLD = NOW - 30 * DAY;
  const trailIds = names(L.trails + 6, 'trail-');
  const trailRanks = shuffledRanks(trailIds.length, 20);
  const latestOf = {};
  const trails = Object.fromEntries(trailIds.map((id, i) => {
    const t = NOW - (trailRanks[i] + 1) * HOUR;
    latestOf[id] = { t, field: ['joinedAt', 'found', 'done'][i % 3] };
    const old = OLD - i * MIN;
    const field = latestOf[id].field;
    return [id, { found: { 'step-a': field === 'found' ? t : old, 'step-b': old - DAY }, done: field === 'done' ? { 'step-a': t } : { 'step-b': old }, joinedAt: field === 'joinedAt' ? t : old }];
  }));
  const kept = Object.keys(reload(setIn(save, ['story', 'trails'], trails)).story.trails);
  const byLatest = [...trailIds].sort((a, b) => latestOf[b].t - latestOf[a].t);
  assert.deepEqual(kept, trailIds.filter((id) => byLatest.slice(0, L.trails).includes(id)), 'trails (the newest 20 by their latest time, in the order saved)');
  const dropped = byLatest.slice(L.trails);
  assert.deepEqual(new Set(dropped.map((id) => latestOf[id].field)), new Set(['joinedAt', 'found', 'done']), 'the fixture drops trails whose latest time is in each field');
  assert.notDeepEqual(kept, trailIds.slice(-L.trails), 'and isn’t simply the last 20 saved');
  // Weights: the first 40 genres, on a wild rift's source.
  const weights = Object.fromEntries(names(L.weights + 3, 'w-').map((k, i) => [k, i + 1]));
  const wild = inExpedition('wild', { seed: 7, tier: 2, depth: 3, weights, rungs: 0 })(save);
  assert.deepEqual(Object.entries(reload(wild).expedition.source.weights), Object.entries(weights).slice(0, L.weights), 'weights (the first 40)');
  // Regulars: the first 12, each with its member on the roster, and nobody else's.
  const regulars = Array.from({ length: L.regulars + 3 }, (_, i) => ({ ...save.party.regulars[0], id: `reg-r${i}` }));
  const party = reload({ ...save, party: { ...save.party, regulars, chosen: [] } }).party;
  assert.deepEqual(party.regulars.map((r) => r.id), regulars.slice(0, L.regulars).map((r) => r.id), 'regulars (the first 12)');
  assert.deepEqual(Object.keys(party.roster), [...FOUNDERS, 'tollkeeper', ...regulars.slice(0, L.regulars).map((r) => r.id)]);
});

test('every choice §8.3 names is kept as saved', () => {
  const choices = {
    kindle: ['idle', 'focus', 'rest'],
    formation: ['line', 'pairs', 'loose', 'wedge'],
    mode: ['storybook', 'long-road', 'mauds-table'],
    play: ['guided', 'command', 'choose', 'handle'],
    control: ['mine', 'review', 'choose'],
    reaction: ['ask', 'always', 'under-half', 'never'],
    archetype: ['walker', 'crawler', 'floater', 'flier', 'ghost', 'construct'],
    temperament: ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud'],
    room: ['won', 'talked', 'bowed', 'yielded', 'last-page'],
    card: ['offline', 'victory', 'bow', 'yielded'],
    outcome: ['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home'],
  };
  // The lists state4.js exports are these, and no more (§8.3, §5.9; riftgen's nine temperaments).
  assert.deepEqual(
    [KINDLE_PHASES, FORMATIONS, MODES, PLAYS, CONTROLS, REACTION_SETTINGS, ARCHETYPES, TEMPERAMENTS, ROOM_OUTCOMES, CARDS, FIGHT_OUTCOMES].map((list) => [...list]),
    Object.values(choices),
  );
  const both = [true, false];
  const cases = [
    [['kindle', 'phase'], choices.kindle], [['kindle', 'earned'], both],
    [['party', 'formation'], choices.formation], [['party', 'mode'], choices.mode], [['party', 'play'], choices.play],
    [['party', 'calm', 'odds'], ['bars', 'words']], [['party', 'calm', 'playback'], [1, 2, 4]],
    ...['noise', 'adaptation', 'fastFoes', 'ghosts'].map((f) => [['party', 'calm', f], both]),
    ...['claude', 'tollkeeper', REG].map((id) => [['party', 'roster', id, 'control'], choices.control]),
    [['party', 'roster', 'claude', 'reactions', 'shoulder'], choices.reaction], [['party', 'roster', 'claude', 'pending', 0], ['path', 'boon']],
    [['party', 'regulars', 0, 'archetype'], choices.archetype], [['party', 'regulars', 0, 'temperament'], choices.temperament],
    [['party', 'regulars', 0, 'lead'], both], [['party', 'regulars', 0, 'parts', 0, 'layer'], [0, 1]],
    [['party', 'regulars', 0, 'bodyKey'], ['r', 'R', 'z', 'Z', '0', '9']], [['party', 'regulars', 0, 'eyeKey'], ['u', 'U', '7', null]],
    [['party', 'outing', 'freeBreather'], both], [['party', 'outing', 'warmed'], both], [['party', 'outing', 'heroes', 'milo', 'rattled'], both],
    [['party', 'firstLeadMet'], both], [['road', 'firstWin'], both],
    [['expedition', 'inside'], both], [['expedition', 'nookUsed'], both],
    [['expedition', 'rooms', 'r0'], choices.room], [['expedition', 'card'], [...choices.card, null]],
    [['chronicle', 'fights', 1, 'outcome'], choices.outcome],
    [['settings', 'hud'], ['adventure', 'quiet']], [['settings', 'kindleBell'], both],
  ];
  const save = wholeSave();
  for (const [path, values] of cases) {
    for (const value of values) assert.equal(getIn(reload(setIn(save, path, value)), path), value, `${path.join('.')}: ${value}`);
  }
});

/* ------------------------------------------------------------------ Phase 4's fields in Phase 3's sections */

test('settings: the HUD’s mode is cleaned explicitly and the Kindle bell defaults on', () => {
  assert.equal(norm({ settings: {} }).settings.hud, 'adventure');
  assert.equal(norm({ settings: { hud: 'quiet' } }).settings.hud, 'quiet');
  for (const junk of ['Quiet', 'loud', 1, null]) assert.equal(norm({ settings: { hud: junk } }).settings.hud, 'adventure', String(junk));
  assert.equal(norm({ settings: {} }).settings.kindleBell, true);
  assert.equal(norm({ settings: { kindleBell: false } }).settings.kindleBell, false);
  assert.equal(norm({ settings: { kindleBell: 'off' } }).settings.kindleBell, true);
  assert.deepEqual([model.DEFAULT_SETTINGS.hud, model.DEFAULT_SETTINGS.kindleBell], ['adventure', true]);
});

test('satchel and story: Marks, tonics, trails and facts are cleaned and bounded', () => {
  const satchel = norm({ satchel: { marks: 2e9, tonics: { cordial: 30, brew: 2.5, elixir: 1 } } }).satchel;
  assert.deepEqual([satchel.marks, satchel.tonics], [L.marks, { cordial: L.tonics, brew: 2, elixir: 1 }]);
  const facts = Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`note:n${i}`, NOW - (230 - i) * MIN]));
  const trails = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`trail-${i}`, { found: { 'step-1': NOW - (25 - i) * HOUR }, done: {}, joinedAt: null }]));
  const story = norm({ story: { facts: { ...facts, 'Bad Fact': NOW, 'glimmer:poi:glimmer:-12,40': NOW }, trails: { ...trails, 'first-trail': { found: { 'step-1': NOW, 'Bad Step': NOW }, done: { 'step-1': 'x' }, joinedAt: NOW, note: 1 } } } }).story;
  assert.equal(Object.keys(story.facts).length, L.facts);
  assert.ok('glimmer:poi:glimmer:-12,40' in story.facts);
  assert.ok(!('Bad Fact' in story.facts));
  assert.equal(Object.keys(story.trails).length, L.trails);
  assert.deepEqual(story.trails['first-trail'], { found: { 'step-1': NOW }, done: {}, joinedAt: NOW, note: 1 });
});

test('tally: byCrew is seeded from the finished ids, never goes down and never passes sessionsFinished', () => {
  const ids = ['claude:a', 'claude:b', 'codex:c', 'jev:d', 'ollama:e', 'whisper:f'];
  assert.deepEqual(norm({ tally: { finishedIds: ids, sessionsFinished: 6 } }).tally.byCrew, { claude: 2, codex: 1, jev: 1, whisper: 1 });
  assert.deepEqual(norm({ tally: { finishedIds: ids, sessionsFinished: 30, byCrew: { claude: 20, codex: 0 } } }).tally.byCrew, { claude: 20, codex: 1, jev: 1, whisper: 1 }, 'a saved count above the ids is kept');
  const over = norm({ tally: { finishedIds: [], sessionsFinished: 5, byCrew: { claude: 4, codex: 4, jev: 4 } } }).tally.byCrew;
  assert.deepEqual(over, { claude: 4, codex: 1, jev: 0, whisper: 0 }, 'never more than sessionsFinished all together');
  const fast = norm({ tally: { answered: 3, answeredFast: 9 } }).tally;
  assert.deepEqual([fast.answered, fast.answeredFast], [3, 3], 'a fast answer is an answer');
  assert.deepEqual(cleanTally4({ finishedIds: ['codex:x'], sessionsFinished: 1 }).byCrew, { claude: 0, codex: 1, jev: 0, whisper: 0 });
  // An agent is the part of an id before its colon: a bare 'claude' or 'codex' names no agent.
  assert.deepEqual(cleanTally4({ finishedIds: ['claude', 'codex', 'claude:a'], sessionsFinished: 3 }).byCrew, { claude: 1, codex: 0, jev: 0, whisper: 0 }, 'a bare agent name isn’t a session of that agent');
  const waiting = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`claude:w${i}`, NOW - (70 - i) * MIN]));
  assert.equal(Object.keys(norm({ tally: { waiting: { ...waiting, 'has space': NOW } } }).tally.waiting).length, L.waiting);
  assert.deepEqual(norm({ tally: { features: { kindle: NOW, 'Bad Id': NOW, muster: 'x' } } }).tally.features, { kindle: NOW });
});

test('tallyFinished counts each session for its agent in byCrew', () => {
  const state = { ...createState(NOW), firstSeenAt: NOW - DAY };
  const sessions = [
    { id: 'claude:a', agent: 'claude', completions: [NOW - HOUR] },
    { id: 'codex:b', agent: 'codex', completions: [NOW - HOUR] },
    { id: 'claude:c', completions: [NOW - MIN] },
    { id: 'ollama:d', agent: 'ollama', completions: [NOW - MIN] },
    { id: 'claude:e', agent: 'claude', completions: [] },
  ];
  const next = tallyFinished(state, { sessions }, NOW);
  assert.equal(next.tally.sessionsFinished, 4);
  assert.deepEqual(next.tally.byCrew, { claude: 2, codex: 1, jev: 0, whisper: 0 });
  assert.equal(tallyFinished(next, { sessions }, NOW), next, 'nothing new: the same state');
  assert.deepEqual(norm(next).tally.byCrew, next.tally.byCrew);
  const bare = tallyFinished({ ...state, tally: { finishedIds: [] } }, { sessions: sessions.slice(0, 1) }, NOW);
  assert.deepEqual(bare.tally.byCrew, { claude: 1, codex: 0, jev: 0, whisper: 0 }, 'a tally without byCrew starts it');
  assert.deepEqual(markSeen(createState(NOW), NOW).tally.byCrew, { claude: 0, codex: 0, jev: 0, whisper: 0 });
});

/* ------------------------------------------------------------------ tallyAnswered */

const live = (over = {}) => ({ id: 'claude:s1', agent: 'claude', status: 'needs-you', live: true, archived: false, waitingSince: NOW - 10 * MIN, lastActivityAt: NOW - 10 * MIN, completions: [], ...over });
const snap = (sessions, sources = { claude: { ok: true }, codex: { ok: true } }) => ({ sessions, sources });

test('tallyAnswered remembers a wait, then counts it once when a later look shows it answered', () => {
  let state = createState(NOW);
  state = tallyAnswered(state, snap([live()]), NOW);
  assert.deepEqual(state.tally.waiting, { 'claude:s1': NOW - 10 * MIN });
  assert.equal(state.tally.answered, 0);
  assert.equal(tallyAnswered(state, snap([live()]), NOW + MIN), state, 'still waiting: the same state');
  const answered = tallyAnswered(state, snap([live({ status: 'working', lastActivityAt: NOW + 2 * MIN })]), NOW + 3 * MIN);
  assert.deepEqual([answered.tally.answered, answered.tally.answeredFast], [1, 1], 'answered within 15 minutes is fast');
  assert.deepEqual(answered.tally.waiting, {});
  assert.equal(tallyAnswered(answered, snap([live({ status: 'working' })]), NOW + 4 * MIN), answered, 'counted once');
  assert.equal(tallyAnswered(answered, snap([live()]), NOW + 5 * MIN), answered, 'a stale look at the same wait never counts again');
  const again = tallyAnswered(answered, snap([live({ waitingSince: NOW + 6 * MIN })]), NOW + 7 * MIN);
  assert.deepEqual(again.tally.waiting, { 'claude:s1': NOW + 6 * MIN }, 'a new wait is remembered');
  const done = tallyAnswered(again, snap([live({ status: 'done', lastActivityAt: NOW + 50 * MIN })]), NOW + HOUR);
  assert.deepEqual([done.tally.answered, done.tally.answeredFast], [2, 1], 'answered after 44 minutes: counted, not fast');
  assertIdempotent(norm(done), 'after answers');
});

test('tallyAnswered: fast is min(now, lastActivityAt) − waitingSince ≤ 15 minutes, not when MILO saw it', () => {
  const since = NOW - 10 * MIN;
  const waiting = tallyAnswered(createState(NOW), snap([live({ waitingSince: since })]), NOW);
  const answer = (look, lastActivityAt) => tallyAnswered(waiting, snap([live({ status: 'done', waitingSince: since, lastActivityAt })]), look).tally;
  // Answered 5 minutes into the wait, but MILO was closed and only looks 3 hours later.
  assert.deepEqual([answer(since + 3 * HOUR, since + 5 * MIN).answered, answer(since + 3 * HOUR, since + 5 * MIN).answeredFast], [1, 1], 'answered within 15 minutes, seen later: fast');
  // Activity stamped after now (a clock ahead of MILO's) counts as now.
  assert.equal(answer(since + 10 * MIN, since + 2 * HOUR).answeredFast, 1, 'a lastActivityAt after now is clamped to now: fast');
  assert.equal(answer(since + 20 * MIN, since + 2 * HOUR).answeredFast, 0, 'clamped to now, 20 minutes: not fast');
  // Exactly at the line, and just past it.
  assert.equal(answer(since + HOUR, since + 15 * MIN).answeredFast, 1, '15 minutes exactly is fast');
  assert.equal(answer(since + HOUR, since + 15 * MIN + 1).answeredFast, 0, 'a moment past 15 minutes is not');
  assert.equal(answer(since + 12 * MIN, null).answeredFast, 1, 'no activity time: now is used');
  assert.equal(answer(since + 16 * MIN, null).answeredFast, 0);
});

test('tallyAnswered: a completion after the wait counts; vanishing, ending, archiving or a source down never does', () => {
  const waiting = tallyAnswered(createState(NOW), snap([live()]), NOW);
  const completed = tallyAnswered(waiting, snap([live({ completions: [NOW + MIN] })]), NOW + 2 * MIN);
  assert.equal(completed.tally.answered, 1, 'a finished turn after the wait began is an answer');
  for (const [why, look] of [
    ['it vanished', snap([])], ['its process ended', snap([live({ status: 'done', live: false })])],
    ['it was archived', snap([live({ status: 'done', archived: true })])], ['its source is down', snap([live({ status: 'working' })], { claude: { ok: false } })],
    ['no sources at all', snap([live({ status: 'working' })], {})],
  ]) {
    const next = tallyAnswered(waiting, look, NOW + 5 * MIN);
    assert.equal(next, waiting, `${why}: never an answer, and the wait is kept`);
  }
  const back = tallyAnswered(tallyAnswered(waiting, snap([]), NOW + DAY), snap([live({ status: 'working', lastActivityAt: NOW + 2 * DAY - MIN })]), NOW + 2 * DAY);
  assert.equal(back.tally.answered, 1, 'a session that comes back live and answered still counts');
  assert.equal(back.tally.answeredFast, 0);
  const stale = tallyAnswered(waiting, snap([]), NOW + 8 * DAY);
  assert.deepEqual(stale.tally.waiting, {}, 'a wait is kept for at most 7 days');
  const codex = tallyAnswered(createState(NOW), snap([live({ id: 'codex:x', agent: 'codex' })]), NOW);
  assert.equal(codex.tally.answered, 0);
  assert.deepEqual(codex.tally.waiting, {}, 'only Claude sessions wait on you');
  const bare = tallyAnswered(createState(NOW), snap([live({ id: 'claude', agent: undefined })]), NOW);
  assert.deepEqual(bare.tally.waiting, {}, 'a session named just ‘claude’, with no agent, isn’t a Claude session');
  assert.deepEqual(tallyAnswered(createState(NOW), snap([live({ id: 'claude:x', agent: undefined })]), NOW).tally.waiting, { 'claude:x': NOW - 10 * MIN }, 'its id’s prefix names the agent');
  for (const junk of [null, {}, { sessions: 'x' }, { sessions: [null, 5, { id: 7 }] }]) assert.equal(tallyAnswered(waiting, junk, NOW), waiting);
  assert.equal(tallyAnswered(waiting, snap([]), 'soon'), waiting, 'no clock, no change');
});

test('tallyAnswered: a completion counts only after the wait began and by now; a wait is kept for 7 days, then dropped', () => {
  const since = NOW - 10 * MIN;
  const waiting = tallyAnswered(createState(NOW), snap([live({ waitingSince: since })]), NOW);
  assert.deepEqual(waiting.tally.waiting, { 'claude:s1': since });
  const look = (completions, now = NOW + MIN) => tallyAnswered(waiting, snap([live({ waitingSince: since, completions })]), now);
  assert.equal(look([since]), waiting, 'a turn that finished as the wait began doesn’t answer it');
  assert.equal(look([since - MIN]), waiting, 'nor one before it');
  assert.equal(look([NOW + 2 * MIN]), waiting, 'nor one stamped after now');
  assert.equal(look([since + 1]).tally.answered, 1, 'a moment after the wait began answers it');
  assert.equal(look([NOW + MIN]).tally.answered, 1, 'and so does one at now');
  // A wait nobody answers is kept for 7 days from when it began, then dropped.
  const gone = snap([]);
  assert.equal(tallyAnswered(waiting, gone, since + 7 * DAY - MIN), waiting, 'kept at 7 days less a minute');
  assert.equal(tallyAnswered(waiting, gone, since + 7 * DAY), waiting, 'kept at 7 days exactly');
  assert.deepEqual(tallyAnswered(waiting, gone, since + 7 * DAY + MIN).tally.waiting, {}, 'dropped at 7 days and a minute');
  assert.equal(tallyAnswered(waiting, gone, since + 7 * DAY + MIN).tally.answered, 0, 'and never counted');
});

test('tallyAnswered at its caps keeps the newest wait and the newest answered wait, so an answer counts once', () => {
  // 60 waits and 60 answered waits already saved, their times out of saved order, so the oldest of
  // each is neither the first nor the last saved.
  const waitRanks = shuffledRanks(L.waiting, 61);
  const doneRanks = shuffledRanks(L.answeredWaits, 62);
  const waits = Object.fromEntries(waitRanks.map((r, i) => [`claude:w${i}`, NOW - HOUR - r * MIN]));
  const answeredWaits = Object.fromEntries(doneRanks.map((r, i) => [`claude:d${i}`, NOW - 2 * DAY - r * MIN]));
  const oldest = (map) => Object.entries(map).sort((a, b) => a[1] - b[1])[0][0];
  const without = (map, key) => Object.entries(map).filter(([k]) => k !== key);
  for (const map of [waits, answeredWaits]) assert.ok(![Object.keys(map)[0], Object.keys(map).at(-1)].includes(oldest(map)), 'the fixture’s oldest is in the middle');
  const base = createState(NOW);
  let state = norm({ ...base, tally: { ...base.tally, answered: 7, answeredFast: 2, waiting: waits, answeredWaits } });
  assert.deepEqual([Object.entries(state.tally.waiting), Object.entries(state.tally.answeredWaits)], [Object.entries(waits), Object.entries(answeredWaits)], 'full lists reload whole');

  // A 61st wait: it's kept, and the oldest wait goes.
  const since = NOW - 5 * MIN;
  const needs = (over = {}) => snap([live({ id: 'claude:new', waitingSince: since, ...over })]);
  state = tallyAnswered(state, needs(), NOW);
  assert.deepEqual(Object.entries(state.tally.waiting), [...without(waits, oldest(waits)), ['claude:new', since]], 'the new wait is kept; the oldest goes');

  // Answered: counted once, and remembered as the newest answered wait while the oldest goes.
  const answered = tallyAnswered(state, needs({ status: 'working', lastActivityAt: NOW + MIN }), NOW + 2 * MIN);
  assert.deepEqual([answered.tally.answered, answered.tally.answeredFast], [8, 3]);
  assert.ok(!('claude:new' in answered.tally.waiting));
  assert.deepEqual(Object.entries(answered.tally.answeredWaits), [...without(answeredWaits, oldest(answeredWaits)), ['claude:new', since]], 'the answered wait is kept; the oldest goes');

  // A stale look at the same wait never makes it wait again, so it's never counted twice, before a reload or after one.
  for (const [where, from] of [['as it is', answered], ['after a reload', norm(roundTrip(answered), NOW + 3 * MIN)]]) {
    assert.equal(tallyAnswered(from, needs(), NOW + 4 * MIN), from, `${where}: a stale look changes nothing`);
    const again = tallyAnswered(tallyAnswered(from, needs(), NOW + 4 * MIN), needs({ status: 'working' }), NOW + 5 * MIN);
    assert.deepEqual([again.tally.answered, again.tally.answeredFast], [8, 3], `${where}: still counted once`);
  }
});

test('tallyAnswered takes at most 1 ms (median) over a full snapshot', () => {
  const sessions = Array.from({ length: 200 }, (_, i) => live({ id: `claude:s${i}`, status: i % 3 ? 'needs-you' : 'working', waitingSince: NOW - i * MIN, completions: Array.from({ length: 50 }, (_, c) => NOW - c * MIN) }));
  const waiting = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`claude:s${i * 3}`, NOW - HOUR]));
  const state = { ...createState(NOW), tally: { ...createState(NOW).tally, waiting } };
  const median = timed(() => tallyAnswered(state, snap(sessions), NOW));
  assert.ok(median <= 1, `median ${median.toFixed(3)} ms`);
});

/* ------------------------------------------------------------------ small steps */

test('markFact and markFeature record a first time once; hearthTierOf reads the tier', () => {
  const state = createState(NOW);
  const noted = markFact(state, 'note:brannoch-1', NOW);
  assert.deepEqual(noted.story.facts, { 'note:brannoch-1': NOW });
  assert.equal(markFact(noted, 'note:brannoch-1', NOW + HOUR), noted, 'once');
  assert.equal(markFact(state, 'Bad Fact', NOW), state);
  assert.equal(markFact(state, 'note:x', 'soon'), state, 'no clock, no change');
  assert.equal(model.markFact, markFact);
  assert.equal(model.markFeature, markFeature);
  assert.equal(model.tallyAnswered, tallyAnswered);
  const facts = Object.fromEntries(Array.from({ length: L.facts }, (_, i) => [`note:n${i}`, NOW - (L.facts - i) * MIN]));
  const full = markFact({ ...state, story: { ...state.story, facts } }, 'riddle:1', NOW);
  assert.equal(Object.keys(full.story.facts).length, L.facts);
  assert.ok('riddle:1' in full.story.facts && !('note:n0' in full.story.facts), 'the newest 200 are kept');
  const used = markFeature(state, 'kindle', NOW);
  assert.deepEqual(used.tally.features, { kindle: NOW });
  assert.equal(markFeature(used, 'kindle', NOW + HOUR), used);
  assert.equal(markFeature(state, 'teleport', NOW), state, 'only trail.FEATURES');
  assert.equal(hearthTierOf(state), 1);
  assert.equal(hearthTierOf({ hearth: { tier: 2.9 } }), 2);
  assert.equal(hearthTierOf({ hearth: { tier: 40 } }), 8);
  assert.equal(hearthTierOf(null), 1);
});

test('the id lists agree with the contract, LORE and the other modules', async () => {
  assert.deepEqual([...FEATURE_IDS], ['kindle', 'rest', 'chronicle', 'command', 'examine', 'muster', 'fight', 'talk-down', 'map', 'skills',
    'war-table', 'ward', 'stitch', 'step-through', 'lantern', 'notebook']);
  assert.deepEqual([...CREW_AGENTS], ['claude', 'codex', 'jev', 'whisper']);
  const lore = loreIndex().Skills;
  assert.deepEqual([...SKILL_IDS].sort(), [...lore].sort(), 'the 24 skills are LORE §21’s');
  assert.equal(SKILL_IDS.length, 24);
  const trailFile = new URL('../src/world/trail.js', import.meta.url);
  if (existsSync(trailFile)) {
    const trail = await import(trailFile.href);
    if (Array.isArray(trail.FEATURES)) assert.deepEqual([...FEATURE_IDS], [...trail.FEATURES], 'trail.js FEATURES');
  }
  assert.equal(normaliseName('Mantle of the Ward'), 'mantle of the ward');
});

test('normalisers never pay, award or advance anything, however late the clock', () => {
  const state = norm({
    tally: { sessionsFinished: 9, answered: 2, focusSessions: 1 },
    embers: { balance: 3, through: { sessionsFinished: 1, answered: 0, stitchedReal: 0, buildingsDesigned: 0 } },
    kindle: { phase: 'focus', startedAt: NOW - 60 * MIN, focusEndsAt: NOW - 10 * MIN },
    road: { xp: 10 },
    party: { roster: { claude: { warmth: 4 } }, cheers: 1 },
  });
  for (const later of [NOW + HOUR, NOW + 10 * DAY]) {
    const next = norm(state, later);
    for (const key of STATE4_KEYS) assert.deepEqual(next[key], state[key], `${key} at a later clock`);
    assert.equal(next.tally.focusSessions, 1);
  }
});
