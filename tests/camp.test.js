// Camp tests (C, CONTRACT-PHASE4.md §7.5, §9.10; COMBAT.md §2.6–§2.7, §3.8): the talk grammar
// (Jev never speaks), choices with requirements that never lock, the Tollkeeper's riddles ending
// in his joining, [likes] and its one Cheer, camp scenes waiting for Acquaintance, the camp's day
// on the real clock, and teaching once a night.
//   node --test tests/camp.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as camp from '../src/camp.js';
import { emptyState4 } from '../src/state4.js';
import { assertCalm } from './calm.js';

const ROOT = new URL('../content/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const talk = (id) => camp.parseTalk(readFileSync(new URL(`camp/talks/${id}.md`, ROOT), 'utf8'));
const content = {
  sky: read('sky.json'),
  camp: { scenes: read('camp/scenes.json') },
  party: { companions: { tollkeeper: read('party/companions/tollkeeper.json') } },
};
const at = (h, m = 0, day = 29) => new Date(2026, 8, day, h, m).getTime(); // late September: sunrise 07:05, sunset 19:30
const NOW = at(20, 30);

function makeState() {
  return { ...emptyState4(), settings: { eveningBell: '22:00' }, story: { trails: {}, facts: {} }, tally: { byCrew: {}, features: {} } };
}
const warm = (state, id, warmth) => ({ ...state, party: { ...state.party, roster: { ...state.party.roster, [id]: { ...state.party.roster[id], warmth } } } });

// ---------------------------------------------------------------------------
// The grammar

test('the talk parser rejects any line for Jev, with its line number', () => {
  const lines = (speaker) => `---\nid: x\nwith: none\nonce: true\n---\n# a\nMilo: Hello.\n${speaker}: Hello back.\n> Fine. [end]\n`;
  for (const speaker of ['Jev', 'jev', 'Jev, the Judgebird', 'The Judgebird', 'The Judgebird Jev', 'Jev’s voice', 'Old Jev', 'A judgebird']) {
    assert.throws(() => camp.parseTalk(lines(speaker)), /talk line 8: Jev never speaks/, speaker);
  }
  assert.equal(camp.parseTalk(lines('Rajevna')).nodes.a.lines[1].speaker, 'Rajevna', 'only Jev’s own name is refused');
  const ok = camp.parseTalk('---\nid: x\nwith: jev\nonce: true\n---\n# a\n(Jev tilts its head.)\n> Fine. [end]\n');
  assert.equal(ok.with, 'jev', 'Jev can be in a talk');
  assert.deepEqual(ok.nodes.a.lines, [{ speaker: null, text: null, gesture: 'Jev tilts its head.' }], 'in stage directions');
});

test('the talk parser says what’s wrong and where', () => {
  const head = '---\nid: x\nwith: none\nonce: false\n---\n';
  const cases = [
    ['# a\n> Go. [next: b]\n', /line 7: \[next: b\] names no node/],
    ['# a\n> Go. [shout: loud]\n', /line 7: unknown tag \[shout\]/],
    ['Milo: Too early.\n# a\n', /line 6: text before the first # node/],
    ['# a\nsomething odd\n', /line 7: a line is/],
    ['# a\n> Go. [needs: friendship 3]\n', /line 7: a requirement is/],
    ['# a\n> Go. [next: a] [end]\n', /line 7: a choice goes \[next\] or \[end\], not both/],
    ['# a\n> [end]\n', /line 7: a choice needs its words/],
    ['# a\n> Go. [needs: warmth claude] [end]\n', /line 7: warmth needs a number/],
    ['# a\n> Go. [end] and then\n', /line 7: stray text among the tags: “and then”/],
  ];
  for (const [body, error] of cases) assert.throws(() => camp.parseTalk(head + body), error);
  assert.throws(() => camp.parseTalk('# a\n'), /line 1: a talk starts with front matter/);
  assert.throws(() => camp.parseTalk('---\nid: x\nwith: none\nonce: maybe\n---\n# a\n'), /“once” is true or false/);
  assert.throws(() => camp.parseTalk('---\nid: x\nwith: none\nonce: true\n---\n'), /at least one # node/);
  // CRLF and a BOM parse the same.
  const text = readFileSync(new URL('camp/talks/first-night.md', ROOT), 'utf8');
  assert.deepEqual(camp.parseTalk(`\uFEFF${text.replace(/\n/g, '\r\n')}`), camp.parseTalk(text));
});

test('requirements read in words, and greyed choices say why', () => {
  const r = (text) => camp.parseRequirement(text);
  assert.equal(r('with jev').words, 'With Jev');
  assert.equal(r('with claude').words, 'With the Scribe');
  assert.equal(r('warmth tollkeeper 60').words, 'Friend warmth with the Tollkeeper');
  assert.equal(r('warmth mae 10').words, 'Acquaintance warmth with Mae');
  assert.equal(r('fact note:note-20 “Once you’ve read Brannoch’s note”').words, 'Once you’ve read Brannoch’s note');
  assert.equal(r('fact riddle:river').words, 'Once you’ve answered that riddle');
  assert.equal(r('trail first-trail:first-trail-2').words, 'Once you’ve followed the trail that far');
  for (const req of ['with jev', 'warmth tollkeeper 60', 'fact glimmer:poi:ruin:1,2', 'trail first-trail:x']) assertCalm(r(req).words, req);
  const view = camp.talkView(talk('tollkeeper-riddles'), makeState(), { now: NOW });
  const market = view.choices.find((c) => c.text === 'The Tide Market.');
  assert.equal(market.met, false);
  assert.equal(market.why, 'Once you’ve read Brannoch’s note');
  const read20 = { ...makeState(), story: { trails: {}, facts: { 'note:note-20': NOW } } };
  assert.equal(camp.talkView(talk('tollkeeper-riddles'), read20, { now: NOW }).choices.find((c) => c.text === 'The Tide Market.').met, true);
  assert.equal(camp.talkView(talk('tollkeeper-riddles'), makeState(), { now: NOW, facts: ['note:note-20'] }).choices.find((c) => c.text === 'The Tide Market.').met, true, 'facts can be passed in');
  const jev = camp.talkView(talk('first-night'), makeState(), { now: NOW, party: ['milo', 'claude'] }).choices.find((c) => c.needs.length);
  assert.deepEqual([jev.met, jev.why], [false, 'With Jev']);
  assert.equal(camp.talkView(talk('first-night'), makeState(), { now: NOW }).choices.find((c) => c.needs.length).met, true, 'Jev goes out by default');
  // §9.10: an answered choice with no next or end comes back greyed; a requirement’s words come first.
  const again = camp.talkView(talk('tollkeeper-riddles'), makeState(), { now: NOW, node: 'first', picked: ['first.2', 'first.3'] }).choices;
  const byId = Object.fromEntries(again.map((c) => [c.id, [c.met, c.why]]));
  assert.deepEqual(byId['first.2'], [false, 'You’ve said that one.']);
  assert.deepEqual(byId['first.3'], [false, 'Once you’ve read Brannoch’s note']);
  assert.deepEqual(byId['first.1'], [true, null], 'the others stay open');
  assertCalm(byId['first.2'][1], 'said line');
});

/**
 * Walks every way through a talk: at each node, every choice that can be picked; a choice with
 * no next or end comes back to its node greyed. Returns the choice ids that ended each path, and
 * fails on any node where nothing can be picked (a lock).
 */
function walk(t, state, opts = {}) {
  const ends = [];
  const seen = new Set();
  const visit = (node, picked, depth) => {
    const key = `${node}|${[...picked].sort().join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    assert.ok(depth < 50, 'the walk ends');
    const view = camp.talkView(t, state, { ...opts, node, picked: [...picked] });
    const open = view.choices.filter((c) => c.met);
    assert.ok(open.length > 0, `something can be picked at ${node} (picked ${[...picked].join(', ') || 'nothing'})`);
    for (const c of open) {
      const r = camp.chooseLine(t, state, c.id, 0, opts);
      if (r.done) ends.push(c.id);
      else if (r.next === node) visit(node, new Set([...picked, c.id]), depth + 1);
      else visit(r.next, new Set(), depth + 1);
    }
  };
  visit(t.start, new Set(), 0);
  return ends;
}

test('every path through the Tollkeeper’s riddles reaches [join: tollkeeper], and nothing locks', () => {
  const t = talk('tollkeeper-riddles');
  const joinId = Object.values(t.nodes).flatMap((n) => n.choices).find((c) => c.join === 'tollkeeper').id;
  const plain = makeState();
  const friendly = warm({ ...plain, story: { trails: {}, facts: { 'note:note-20': 1 } } }, 'tollkeeper', 60);
  for (const state of [plain, friendly]) {
    const ends = walk(t, state, { now: NOW });
    assert.ok(ends.length > 0);
    assert.deepEqual([...new Set(ends)], [joinId], 'the only way out is the third right answer, which carries the join');
  }
  // Three riddles, answered in order: the facts are set, and he joins.
  let state = plain;
  for (const id of ['first.1', 'second.1', 'third.1']) {
    const r = camp.chooseLine(t, state, id, NOW);
    state = r.state;
    if (id === 'third.1') assert.equal(r.done, true);
  }
  assert.ok(state.story.facts['riddle:river'] && state.story.facts['riddle:footsteps'] && state.story.facts['riddle:word']);
  assert.ok(state.party.roster.tollkeeper, 'the Tollkeeper joins');
  assert.equal(state.story.trails['first-trail'].joinedAt, NOW);
  // A wrong answer replies and comes back to the same riddle, greyed.
  const wrong = camp.chooseLine(t, plain, 'first.2', NOW);
  assert.deepEqual([wrong.next, wrong.done, wrong.reply], ['first', false, 'A fair guess. Misers count all day.']);
  assert.equal(wrong.state, plain);
  // A choice whose needs aren't met changes nothing.
  const locked = camp.chooseLine(t, plain, 'first.3', NOW);
  assert.deepEqual([locked.state === plain, locked.next, locked.done], [true, 'first', false]);
  // At Friend warmth he'll settle for two.
  const skip = camp.chooseLine(t, friendly, 'first.4', NOW);
  assert.equal(skip.next, 'third');
  assert.equal(camp.chooseLine(t, plain, 'first.4', NOW).next, 'first');
  // The join passes the content on to party.recruit: the trail trails.json ends with him records it,
  // even with no clock (the epoch's first moment, as a riddle's fact is kept).
  const trails = read('trails.json');
  const renamed = { ...content, trails: { ...trails, trails: trails.trails.map((x) => (x.end?.joins === 'tollkeeper' ? { ...x, id: 'river-trail' } : x)) } };
  for (const now of [NOW, undefined, 0]) {
    let s = plain;
    for (const id of ['first.1', 'second.1', 'third.1']) s = camp.chooseLine(t, s, id, now, { content: renamed }).state;
    assert.ok(s.party.roster.tollkeeper, `now ${now}: he joins`);
    assert.deepEqual([Object.keys(s.story.trails), s.story.trails['river-trail'].joinedAt], [['river-trail'], now || 1], `now ${now}`);
  }
});

test('every path through the first night ends, and [likes] gives one Cheer a talk', () => {
  const t = talk('first-night');
  assert.ok(walk(t, makeState(), { now: NOW }).length > 0);
  assert.ok(walk(t, makeState(), { now: NOW, party: ['milo'] }).length > 0, 'without Jev too');
  let state = makeState();
  let r = camp.chooseLine(t, state, 'fire.1', NOW);
  assert.deepEqual([r.next, r.liked], ['notes', null]);
  r = camp.chooseLine(t, r.state, 'notes.2', NOW);
  assert.equal(r.done, true);
  assert.equal(r.liked, 'The Scribe liked that.');
  assertCalm(r.liked, 'liked line');
  assert.equal(r.state.party.cheers, 1, 'one Cheer');
  assert.equal(r.state.party.roster.claude.warmth, 0, 'no warmth in Phase 4');
  assert.ok(r.state.party.seenScenes['talk:first-night'], 'a once-only talk is marked done');
  state = r.state;
  const again = camp.chooseLine(t, state, 'tea.1', NOW);
  assert.equal(again.liked, null, 'a liked choice pays once per talk');
  assert.equal(again.state.party.cheers, 1);
  const listen = camp.chooseLine(t, makeState(), 'fire.4', NOW);
  assert.equal(listen.next, 'fire');
  assert.equal(listen.reply, '“It’s good company,” Milo says. “It never needs anything.”');
});

// ---------------------------------------------------------------------------
// Scenes

test('arrivals play first, once each, at any waking hour and never while the camp is asleep, and a regular’s arrival names them', () => {
  let state = makeState();
  assert.equal(camp.nextScene(state, at(12), { content }).id, 'arrival-claude', 'by day too');
  assert.equal(camp.nextScene(state, at(6, 30), { content }).id, 'arrival-claude', 'and at dawn');
  for (const [h, m] of [[22, 30], [23, 59], [3, 0]]) assert.equal(camp.nextScene(state, at(h, m), { content }), null, `an arrival waits at ${h}:${m} while the camp sleeps`);
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const scene = camp.nextScene(state, NOW, { content });
    if (!scene) break;
    ids.push(scene.id);
    state = camp.sceneSeen(state, scene.id, NOW);
  }
  assert.deepEqual(ids, ['arrival-claude', 'arrival-codex', 'arrival-jev'], 'the Tollkeeper’s waits until he joins');
  assert.equal(camp.sceneSeen(state, 'arrival-claude', NOW + 1), state, 'seen once');
  const regular = { id: 'reg-abc', name: 'Glitch drone', genre: 'neon', archetype: 'walker', calling: 'chorister', temperament: 'shy', parts: [], joinedAt: NOW };
  state = { ...state, party: { ...state.party, regulars: [regular], roster: { ...state.party.roster, 'reg-abc': state.party.roster.claude } } };
  assert.equal(camp.nextScene(state, at(23), { content }), null, 'a regular’s arrival waits for morning too');
  const scene = camp.nextScene(state, NOW, { content });
  assert.equal(scene.id, 'arrival-regular:reg-abc');
  assert.equal(scene.lines[0].speaker, 'reg-abc');
  assert.equal(scene.lines[0].text, 'Can I sit by the fire a while?');
  state = camp.sceneSeen(state, scene.id, NOW);
  state = { ...state, party: { ...state.party, roster: { ...state.party.roster, tollkeeper: state.party.roster.claude } } };
  assert.equal(camp.nextScene(state, NOW, { content }).id, 'arrival-tollkeeper');
});

test('each companion’s camp scene waits for Acquaintance, plays at night, and never once the camp is asleep', () => {
  let state = makeState();
  for (const id of ['arrival-claude', 'arrival-codex', 'arrival-jev']) state = camp.sceneSeen(state, id, NOW);
  assert.equal(camp.nextScene(warm(state, 'claude', 9), NOW, { content }), null, 'Stranger warmth: not yet');
  const ready = warm(state, 'claude', 10);
  const scene = camp.nextScene(ready, NOW, { content });
  assert.equal(scene.id, 'camp-claude');
  assert.deepEqual(scene.needs.map((r) => [r.kind, r.id, r.n]), [['warmth', 'claude', 10]]);
  assert.equal(camp.nextScene(ready, at(13), { content }), null, 'not in the middle of the day');
  assert.equal(camp.nextScene(ready, at(23), { content }), null, 'past the bell the talk waits');
  assert.equal(camp.nextScene(camp.sceneSeen(ready, 'camp-claude', NOW), NOW, { content }), null, 'once');
  for (const line of scene.lines) if (line.text) assertCalm(line.text, 'scene line');
});

// ---------------------------------------------------------------------------
// The camp's day

test('the camp keeps the real clock: dawn, day, dusk, evening, the last hour before the bell, and asleep', () => {
  const part = (h, m = 0) => camp.campDay(makeState(), at(h, m), { content }).part;
  assert.equal(part(6, 30), 'dawn');
  assert.equal(part(12), 'day');
  assert.equal(part(19, 15), 'dusk');
  assert.equal(part(20, 30), 'evening');
  assert.equal(part(21, 30), 'night');
  assert.deepEqual([part(20, 59), part(21, 0)], ['evening', 'night'], 'the last hour before the bell starts on the hour');
  assert.equal(part(22, 30), 'asleep');
  assert.equal(part(3), 'asleep');
  const late = { ...makeState(), settings: { eveningBell: '00:30' } };
  assert.equal(camp.campDay(late, at(23, 45), { content }).part, 'night', 'a bell after midnight');
  assert.equal(camp.campDay(late, at(1), { content }).part, 'asleep');
  assert.equal(camp.campDay(makeState(), at(22, 30), { content }).bell, true);
  assert.equal(camp.campDay(makeState(), at(12), { content }).bell, false);
});

test('where everyone is: Jev on the Watchtower roof, the Tollkeeper at his bridge by day, a busy Wayfarer away, the party out with Milo away', () => {
  let state = makeState();
  state = { ...state, party: { ...state.party, roster: { ...state.party.roster, tollkeeper: state.party.roster.claude } } };
  const where = (s, now, extra = {}) => Object.fromEntries(camp.campDay(s, now, { content, ...extra }).places.map((p) => [p.id, [p.where, p.pose]]));
  const noon = where(state, at(12));
  assert.deepEqual(noon.jev, ['tower', 'sit']);
  assert.deepEqual(noon.tollkeeper, ['bridge', 'stand']);
  assert.deepEqual(noon.claude, ['fire', 'sit']);
  assert.deepEqual(where(state, at(19, 15)).tollkeeper, ['fire', 'sit'], 'he comes by lantern at dusk');
  assert.deepEqual(where(state, at(23)).claude, ['bedroll', 'sleep']);
  assert.deepEqual(where(state, at(23)).jev, ['tower', 'sleep']);
  const snapshot = { sessions: [{ agent: 'claude', status: 'working', title: 'x' }], sources: { claude: { ok: true } } };
  assert.deepEqual(where(state, at(12), { snapshot }).claude, ['away', 'stand']);
  const out = { ...state, expedition: { inside: true } };
  assert.deepEqual(where(out, at(12)).codex, ['away', 'stand']);
  assert.ok(!('milo' in where(state, at(12))), 'Milo walks where you send him');
});

test('teaching happens once a real night, and a lesson before dawn still counts for the evening before', () => {
  let state = makeState();
  assert.equal(camp.canTeach(state, at(21)), true);
  state = camp.markTaught(state, 'claude', 'jev', '12:345', at(21));
  assert.equal(camp.canTeach(state, at(23)), false);
  assert.equal(camp.canTeach(state, at(2, 0, 30)), false, 'two in the morning is still that night');
  assert.deepEqual([camp.canTeach(state, at(5, 59, 30)), camp.canTeach(state, at(6, 0, 30))], [false, true], 'the night ends at six');
  assert.equal(camp.canTeach(state, at(20, 0, 30)), true, 'the next evening');
  assert.equal(camp.markTaught(state, 'claude', 'jev', '12:345', at(23)), state, 'once a night');
  const fresh = makeState();
  assert.equal(camp.markTaught(fresh, 'claude', 'claude', '12:345', at(21)), fresh, 'someone else learns it');
  assert.equal(camp.markTaught(fresh, 'claude', 'tollkeeper', '12:345', at(21)), fresh, 'both are in the company');
  assert.equal(camp.markTaught(fresh, 'claude', 'jev', 'not-a-habit', at(21)), fresh);
});

test('a missing now never reads the wall clock: it counts as the epoch, the same every time', () => {
  const real = Date.now;
  Date.now = () => { throw new Error('the camp read the wall clock'); };
  try {
    const state = makeState();
    const taught = camp.markTaught(state, 'claude', 'jev', '12:345', undefined);
    assert.equal(taught.party.teachDay, camp.markTaught(state, 'claude', 'jev', '12:345', 0).party.teachDay);
    assert.equal(camp.canTeach(taught, undefined), false);
    assert.equal(camp.canTeach(taught, null), false);
    assert.deepEqual(camp.campDay(state, undefined, { content }), camp.campDay(state, 0, { content }));
    assert.deepEqual(camp.nextScene(state, undefined, { content }), camp.nextScene(state, 0, { content }));
    // A riddle's fact is kept, not dropped: A's markFact refuses the epoch itself, so it's the epoch's first moment.
    const t = talk('tollkeeper-riddles');
    for (const now of [undefined, null, 0]) {
      const r = camp.chooseLine(t, state, 'first.1', now);
      assert.equal(r.state.story.facts['riddle:river'], 1, `a missing now (${now}) still records the riddle`);
      assert.equal(r.next, 'second');
    }
  } finally {
    Date.now = real;
  }
});
