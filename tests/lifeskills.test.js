// Chris's 24 skills (src/lifeskills.js, content/skills.json, content/xp.json): the classic curve,
// addXp and its Chronicle line, the life skills paid from real signals, and the Skills tab's view.
// CONTRACT-PHASE4.md §4.21, §7.6, §9.11, §13 (A's proofs), §15; LORE.md §12, §21; PLAN.md §4.
// Run: node --test tests/lifeskills.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createState, normalizeState, tallyAnswered, tallyFinished, finishDesign } from '../src/model.js';
import {
  SKILL_IDS, DEFAULT_RATES, xpForLevel, levelForXp, addXp, payLifeFromSignals, skillsView, ratesOf, skillName, commas,
} from '../src/lifeskills.js';
import { SKILL_IDS as STATE_SKILL_IDS, STATE4_LIMITS } from '../src/state4.js';
import { kindleStart, kindleTick } from '../src/kindle.js';
import { QUEST_SKILLS } from '../src/state5.js';
import { chartChunks } from '../src/embers.js';
import { assertCalm, assertCosy, assertOwnWords, assertName, loreIndex, normaliseName, strings } from './calm.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const skillsFile = read('skills');
const xpFile = read('xp');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 8, 29, 14, 0, 0).getTime();
const relaunch = (state, now) => normalizeState(JSON.parse(JSON.stringify(state)), now);
/** A state whose life-XP backlog is paid, so each test starts at nothing. */
const started = () => payLifeFromSignals(createState(NOW - DAY), NOW - DAY, xpFile).state;

test('the classic curve: 83 at level 2, 13,034,431 at 99, and levelForXp is its inverse', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(10), 1154);
  assert.equal(xpForLevel(50), 101333);
  assert.equal(xpForLevel(92), 6517253);
  assert.equal(xpForLevel(99), 13034431);
  assert.equal(xpForLevel(99), skillsFile.curve.at99);
  assert.equal(xpForLevel(150), 13034431, 'the curve stops at 99');
  // The formula itself, summed afresh.
  for (const level of [2, 7, 33, 64, 99]) {
    let sum = 0;
    for (let l = 1; l < level; l += 1) sum += Math.floor(l + 300 * 2 ** (l / 7));
    assert.equal(xpForLevel(level), Math.floor(sum / 4), `level ${level}`);
  }
  for (let level = 1; level <= 99; level += 1) {
    assert.equal(levelForXp(xpForLevel(level)), level, `exactly ${level}`);
    if (level > 1) assert.equal(levelForXp(xpForLevel(level) - 1), level - 1, `just under ${level}`);
  }
  assert.equal(levelForXp(200_000_000), 99);
  for (const junk of [-5, NaN, 'x', null]) assert.equal(levelForXp(junk), 1);
});

test('addXp adds whole XP, caps it, writes the Chronicle’s line and returns the drop', () => {
  const state = started();
  const first = addXp(state, 'cartography', 83, NOW, { source: 'chunk-charted', text: '2 new chunks charted' });
  assert.deepEqual(first.drop, { skill: 'cartography', amount: 83, level: 2, levelled: true });
  assert.equal(first.state.xp.skills.cartography, 83);
  assert.deepEqual(first.state.chronicle.xpLines.at(-1), { at: NOW, skill: 'cartography', n: 83, source: 'chunk-charted', text: 'Cartography 83: 2 new chunks charted' });
  assert.equal(first.state.chronicle.days['2026-09-29'].xp.cartography, 83);
  const second = addXp(first.state, 'cartography', 10.9, NOW, { source: 'chunk-charted' });
  assert.deepEqual(second.drop, { skill: 'cartography', amount: 10, level: 2, levelled: false });
  assert.equal(second.state.chronicle.xpLines.at(-1).text, 'Cartography 10');
  const named = addXp(state, 'warding', 1200, NOW, { source: 'fight', text: 'Warding 1,200: a room at the Glass Fen' }).state;
  assert.equal(named.chronicle.xpLines.at(-1).text, 'Warding 1,200: a room at the Glass Fen', 'a line that names its skill is kept');
  const full = { ...state, xp: { ...state.xp, skills: { focus: STATE4_LIMITS.xp - 5 } } };
  assert.equal(addXp(full, 'focus', 100, NOW).drop.amount, 5, 'capped at 200,000,000');
  const capped = { ...state, xp: { ...state.xp, skills: { focus: STATE4_LIMITS.xp } } };
  assert.deepEqual(addXp(capped, 'focus', 100, NOW), { state: capped, drop: null });
  for (const [skill, amount, now] of [['telepathy', 5, NOW], ['focus', 0, NOW], ['focus', -3, NOW], ['focus', 5, 'soon'], ['focus', 'x', NOW]]) {
    assert.deepEqual(addXp(state, skill, amount, now), { state, drop: null }, `${skill} ${amount}`);
  }
  assert.deepEqual(relaunch(second.state, NOW), second.state);
});

test('lantern travel pays at most 10 times a local day', () => {
  let state = started();
  let paid = 0;
  for (let i = 0; i < 14; i += 1) {
    const result = addXp(state, 'wayfaring', 25, NOW + i * MIN, { source: 'lantern-travel', text: 'a lantern travel' });
    state = result.state;
    if (result.drop) paid += 1;
  }
  assert.equal(paid, 10);
  assert.deepEqual([state.xp.skills.wayfaring, state.xp.day], [250, { key: '2026-09-29', travels: 10 }]);
  const tomorrow = addXp(relaunch(state, NOW + DAY), 'wayfaring', 25, NOW + DAY, { source: 'lantern-travel' });
  assert.ok(tomorrow.drop, 'a new day, ten more');
  assert.deepEqual(tomorrow.state.xp.day, { key: '2026-09-30', travels: 1 });
  assert.ok(addXp(state, 'wayfaring', 150, NOW, { source: 'lantern-lit' }).drop, 'a first lighting isn’t a travel');
});

test('lantern travel’s daily cap comes from content/xp.json', () => {
  const travels = (options) => {
    let state = started();
    let paid = 0;
    for (let i = 0; i < 14; i += 1) {
      const result = addXp(state, 'wayfaring', 25, NOW + i * MIN, { source: 'lantern-travel', ...options });
      state = result.state;
      if (result.drop) paid += 1;
    }
    return paid;
  };
  const three = { ...xpFile, sources: xpFile.sources.map((s) => (s.id === 'lantern-travel' ? { ...s, perDay: 3 } : s)) };
  assert.equal(travels({ rates: three }), 3, 'the file’s perDay is the cap');
  assert.equal(travels({ rates: three.sources }), 3, 'its sources list works too');
  assert.equal(travels({ rates: xpFile }), 10);
  assert.equal(travels({ rates: three, perDay: 5 }), 5, 'an explicit perDay wins');
  const none = { ...xpFile, sources: xpFile.sources.map((s) => (s.id === 'lantern-travel' ? { ...s, perDay: null } : s)) };
  assert.equal(travels({ rates: none }), 10, 'a row without a cap keeps the contract’s 10');
});

test('a damaged xp section, or one damaged mark, never pays the life-XP backlog or a counter’s history again', () => {
  const counts = { tally: { sessionsFinished: 400, answered: 30, answeredFast: 20, buildingsDesigned: 3 } };
  const paid = JSON.parse(JSON.stringify(payLifeFromSignals(normalizeState(counts, NOW), NOW, xpFile).state));
  assert.equal(paid.xp.skills.command, 42000, 'the backlog is paid');
  const later = NOW + 2 * DAY;
  for (const [why, xp] of [
    ...[null, [], 5, 'x'].map((junk) => [`xp: ${JSON.stringify(junk)}`, junk]),
    ['a mark field that isn’t a number', { ...paid.xp, through: { ...paid.xp.through, sessionsFinished: 'x' } }],
    ['a mark field that’s missing', { ...paid.xp, through: { answeredFast: 20 } }],
    ['a mark that isn’t a record', { ...paid.xp, through: 7 }],
  ]) {
    const state = normalizeState({ ...paid, xp }, later);
    assert.deepEqual(payLifeFromSignals(state, later, xpFile).drops, [], `${why}: nothing pays again`);
  }
  const { xp, ...phase3 } = paid;
  assert.deepEqual(payLifeFromSignals(normalizeState(phase3, later), later, xpFile).drops.map((d) => d.skill), ['command', 'artifice'], 'only a missing section is from before the Kit');
});

test('a crew session watched to the end pays 100 Command once, across a relaunch', () => {
  let state = { ...started(), firstSeenAt: NOW - DAY };
  state = tallyFinished(state, { sessions: [{ id: 'claude:a', agent: 'claude', completions: [NOW - MIN] }] }, NOW);
  const paid = payLifeFromSignals(state, NOW, xpFile);
  assert.deepEqual(paid.drops, [{ skill: 'command', amount: 100, level: 2, levelled: true }]);
  assert.equal(paid.state.chronicle.xpLines.at(-1).text, 'Command 100: a crew session finished');
  assert.equal(payLifeFromSignals(relaunch(paid.state, NOW + HOUR), NOW + HOUR, xpFile).drops.length, 0, 'once');
  assert.equal(payLifeFromSignals(paid.state, NOW + MIN, xpFile).state, paid.state, 'nothing new: the same state');
});

test('a needs-you answered within 15 minutes pays 100 Command; a slower one pays none', () => {
  const snap = (sessions) => ({ sessions, sources: { claude: { ok: true } } });
  const waiting = (id, since) => ({ id, agent: 'claude', status: 'needs-you', live: true, waitingSince: since, lastActivityAt: since, completions: [] });
  let state = started();
  state = tallyAnswered(state, snap([waiting('claude:fast', NOW - 10 * MIN), waiting('claude:slow', NOW - 2 * HOUR)]), NOW - 5 * MIN);
  state = tallyAnswered(state, snap([
    { ...waiting('claude:fast', NOW - 10 * MIN), status: 'working', lastActivityAt: NOW - 2 * MIN },
    { ...waiting('claude:slow', NOW - 2 * HOUR), status: 'working', lastActivityAt: NOW - MIN },
  ]), NOW);
  assert.deepEqual([state.tally.answered, state.tally.answeredFast], [2, 1]);
  const paid = payLifeFromSignals(state, NOW, xpFile);
  assert.deepEqual(paid.drops.map((d) => [d.skill, d.amount]), [['command', 100]], 'only the fast answer pays XP');
  assert.equal(paid.state.chronicle.xpLines.at(-1).text, 'Command 100: a needs-you answered in time');
  assert.deepEqual(payLifeFromSignals(relaunch(paid.state, NOW), NOW, xpFile).drops, []);
});

test('a first design pays 1,000 Artifice once; a redesign pays nothing', () => {
  // core.test.js's drawable blueprint: a 12×12 emblem and five levels.
  const emblem = ['............', '..oooooooo..', '.occcccccco.', '.ocrrccuuco.', '.ocrrccuuco.', '.occcccccco.',
    '.oceeeeeeco.', '.oceeeeeeco.', '.occcccccco.', '..oooooooo..', '....o..o....', '...oo..oo...'];
  const blueprint = {
    version: 1, name: 'Clip studio', tagline: 'Where stream highlights get cut', purpose: 'Turns your drawing streams into short clips.',
    style: { shape: 'workshop', walls: 'plank', wallColor: 'woodLight', roof: 'gable', roofColor: 'clay', trim: 'cream', door: 'arched', windows: 'square', chimney: false, flag: 'blossom', awning: 'none' },
    emblem, props: [{ kind: 'easel', side: 'left' }], yard: 'flowers',
    levels: [1, 2, 3, 4, 5].map((n) => ({ level: n, title: `Level ${n} feature`, summary: `What level ${n} does.`, proof: `A check for level ${n} passes.` })),
  };
  let state = started();
  state = finishDesign(state, 'plot-rise', { blueprint, by: 'claude' }, NOW);
  assert.equal(state.tally.buildingsDesigned, 1);
  const paid = payLifeFromSignals(state, NOW, xpFile);
  assert.deepEqual(paid.drops.map((d) => [d.skill, d.amount]), [['artifice', 1000]]);
  assert.equal(paid.state.chronicle.xpLines.at(-1).text, 'Artifice 1,000: a first design');
  const redesigned = finishDesign(paid.state, 'plot-rise', { blueprint, by: 'codex' }, NOW + HOUR);
  assert.deepEqual(payLifeFromSignals(redesigned, NOW + HOUR, xpFile).drops, [], 'a redesign isn’t a first design');
});

test('a focus session pays 1,000 Focus and an honoured rest 400 Hearthkeeping, each once with its line', () => {
  let state = started();
  state = kindleTick(kindleStart(state, NOW, { xp: xpFile }).state, NOW + 70 * MIN, { xp: xpFile }).state;
  assert.deepEqual([state.xp.skills.focus, state.xp.skills.hearthkeeping], [1000, 400]);
  assert.deepEqual(state.chronicle.xpLines.slice(-2).map((l) => [l.skill, l.n, l.source]), [['focus', 1000, 'focus-session'], ['hearthkeeping', 400, 'rest-honoured']]);
  state = kindleTick(relaunch(state, NOW + 2 * HOUR), NOW + 2 * HOUR, { xp: xpFile }).state;
  assert.deepEqual([state.xp.skills.focus, state.xp.skills.hearthkeeping], [1000, 400], 'once');
});

test('the life-XP backlog pays once, uncapped, one line per skill', () => {
  const phase3 = normalizeState({ tally: { sessionsFinished: 350, answered: 6, answeredFast: 4, buildingsDesigned: 3 } }, NOW);
  assert.equal(phase3.xp.through, null);
  const paid = payLifeFromSignals(phase3, NOW, xpFile);
  assert.deepEqual(paid.drops.map((d) => [d.skill, d.amount]), [['command', 35400], ['artifice', 3000]]);
  assert.deepEqual(paid.state.chronicle.xpLines.map((l) => l.text), ['Command 35,400: from before the Kit', 'Artifice 3,000: from before the Kit']);
  assert.deepEqual(paid.state.xp.through, { sessionsFinished: 350, answeredFast: 4, buildingsDesigned: 3 });
  assert.deepEqual(payLifeFromSignals(relaunch(paid.state, NOW + DAY), NOW + DAY, xpFile).drops, [], 'never twice');
  const empty = payLifeFromSignals(createState(NOW), NOW, xpFile);
  assert.deepEqual([empty.drops, empty.state.chronicle.xpLines], [[], []], 'nothing to pay, nothing written');
  assert.notEqual(empty.state.xp.through, null);
});

test('a changed xp.json changes what every life-XP source pays', () => {
  const changedRates = { 'crew-session': 33, 'answered-fast': 44, 'building-designed': 555, 'chunk-charted': 7 };
  const changed = { ...xpFile, sources: xpFile.sources.map((row) => (Object.hasOwn(changedRates, row.id) ? { ...row, xp: changedRates[row.id] } : row)) };
  for (const [id, n] of Object.entries(changedRates)) assert.equal(ratesOf(changed)[id].xp, n, id);
  // The backlog: 2 sessions × 33 and a fast answer × 44 in Command, a design × 555 in Artifice.
  const before = normalizeState({ tally: { sessionsFinished: 2, answered: 1, answeredFast: 1, buildingsDesigned: 1 } }, NOW);
  let state = payLifeFromSignals(before, NOW, changed).state;
  assert.deepEqual([state.xp.skills.command, state.xp.skills.artifice], [110, 555]);
  // New work: 3 sessions, a fast answer and a design.
  const { tally } = state;
  state = { ...state, tally: { ...tally, sessionsFinished: tally.sessionsFinished + 3, answered: tally.answered + 1, answeredFast: tally.answeredFast + 1, buildingsDesigned: tally.buildingsDesigned + 1 } };
  const paid = payLifeFromSignals(state, NOW + MIN, changed);
  assert.deepEqual(paid.drops.map((d) => [d.skill, d.amount]), [['command', 99], ['command', 44], ['artifice', 555]]);
  // Charting: 7 Cartography a chunk bought.
  const wallet = { ...paid.state, embers: { ...paid.state.embers, balance: 2 } };
  assert.equal(chartChunks(wallet, ['10,20', '11,20'], NOW + MIN, { xp: changed }).state.xp.skills.cartography, 14);
});

test('payLifeFromSignals takes at most 1 ms (median)', () => {
  const base = relaunch({ ...started(), chronicle: { days: {}, fights: [], xpLines: Array.from({ length: 120 }, (_, i) => ({ at: NOW - i, skill: 'command', n: 100, source: 'crew-session', text: 'Command 100' })) } }, NOW);
  const times = [];
  for (let i = 0; i < 220; i += 1) {
    const input = { ...base, tally: { ...base.tally, sessionsFinished: base.tally.sessionsFinished + 1 + (i % 3), answeredFast: i % 2 } };
    const start = performance.now();
    payLifeFromSignals(input, NOW + i, xpFile);
    if (i >= 20) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[100] <= 1, `median ${times[100].toFixed(3)} ms`);
});

test('skillsView lists the 24 skills with levels, the next level’s XP, guides and today’s source', () => {
  const state = addXp(started(), 'focus', 1154, NOW).state;
  const view = skillsView(state, { skills: skillsFile });
  assert.deepEqual(view.map((s) => s.id), [...SKILL_IDS]);
  const focus = view.find((s) => s.id === 'focus');
  assert.deepEqual([focus.name, focus.family, focus.level, focus.xp, focus.next], ['Focus', 'life', 10, 1154, xpForLevel(11)]);
  assert.equal(focus.source, 'Rises from every focus session you finish: 1,000 a session.');
  assert.equal(focus.guide[0].level, 10);
  assert.deepEqual(skillsView(state, skillsFile), view, 'the file itself works too');
  const top = skillsView(addXp(started(), 'mining', 2e8, NOW).state, skillsFile).find((s) => s.id === 'mining');
  assert.deepEqual([top.level, top.next], [99, null]);
  const bare = skillsView(null, null);
  assert.equal(bare.length, 24);
  assert.deepEqual([bare[0].name, bare[0].level, bare[0].guide, bare[0].source], ['Artifice', 1, [], '']);
});

test('content/skills.json: the 24 skills in LORE §12’s order, LORE §21’s names and Mantles, calm guides', () => {
  assert.equal(skillsFile.version, 1);
  assertCalm(skillsFile.about, 'skills.about', { proper: ['LORE', 'XP'] });
  assert.deepEqual(skillsFile.curve, { kind: 'classic', max: 99, at99: 13034431 });
  assert.deepEqual(Object.keys(skillsFile.families), ['life', 'gathering', 'making']);
  assert.deepEqual(skillsFile.skills.map((s) => s.id), [...SKILL_IDS]);
  assert.equal(STATE_SKILL_IDS, SKILL_IDS, 'one list, from state4.js');
  const lore = loreIndex();
  assert.deepEqual(skillsFile.skills.map((s) => normaliseName(s.name)), lore.Skills.slice().sort((a, b) => SKILL_IDS.indexOf(a) - SKILL_IDS.indexOf(b)));
  const families = { life: 9, gathering: 5, making: 10 };
  for (const [family, n] of Object.entries(families)) assert.equal(skillsFile.skills.filter((s) => s.family === family).length, n, family);
  const mantles = new Set(lore.Mantles);
  const phases = /^(Phase ([4-9]|10)|Later)$/;
  for (const skill of skillsFile.skills) {
    assert.equal(skill.name, skillName(skill.id));
    assertName(skill.name, `${skill.id}.name`);
    assert.match(skill.mantle, /^Mantle of /);
    assert.ok(mantles.has(normaliseName(skill.mantle.replace(/^Mantle of /, ''))), `${skill.id}: ${skill.mantle} is LORE §21’s`);
    for (const key of ['lore', 'risesFrom', 'phase4']) assertCalm(skill[key], `${skill.id}.${key}`);
    assert.ok(Array.isArray(skill.unlocks));
    let last = 0;
    for (const unlock of skill.unlocks) {
      assert.ok(Number.isInteger(unlock.level) && unlock.level > last && unlock.level <= 99, `${skill.id} unlocks rise`);
      last = unlock.level;
      assertCalm(unlock.text, `${skill.id} unlock ${unlock.level}`);
      assert.match(unlock.from, phases);
    }
    if (skill.family === 'gathering') assert.equal(skill.resources.length >= 4, true, `${skill.id} lists its resources`);
  }
  for (const [path, text] of strings(skillsFile)) {
    assertOwnWords(text, path);
    assertCosy(text, path);
  }
  // Every skill with a Phase 4 source says so; the rest say where XP will come from.
  const sources = new Set([...xpFile.sources.map((s) => s.skill), ...QUEST_SKILLS]); // quests train the life skills they are tagged with
  for (const skill of skillsFile.skills) {
    if (sources.has(skill.id) || ['warding', 'command', 'artifice'].includes(skill.id)) assert.match(skill.phase4, /^Rises from/, skill.id);
    else assert.match(skill.phase4, /^Comes with /, skill.id);
  }
});

test('content/xp.json: §4.21’s rows, and the code’s defaults are the file', () => {
  assert.equal(xpFile.version, 1);
  assertCalm(xpFile.about, 'xp.about', { proper: ['CONTRACT-PHASE4.md', 'PLAN.md', 'COMBAT.md', 'XP'] });
  assert.deepEqual(xpFile.sources.map((s) => [s.id, s.skill, s.xp, s.perDay ?? null]), [
    ['focus-session', 'focus', 1000, null], ['rest-honoured', 'hearthkeeping', 400, null], ['crew-session', 'command', 100, null],
    ['answered-fast', 'command', 100, null], ['building-designed', 'artifice', 1000, null], ['spell-knack', 'spellcraft', 5, null],
    ['spell-circle', 'spellcraft', 40, null], ['chunk-charted', 'cartography', 40, null], ['lantern-lit', 'wayfaring', 150, null],
    ['lantern-travel', 'wayfaring', 25, 10], ['log-chopped', 'woodcutting', 25, null], ['wild-stitch', 'seamcraft', 300, null],
    ['wild-stitch-depth', 'seamcraft', 30, null], ['real-stitch', 'seamcraft', 500, null],
    ['quest-main', 'stewardship', 300, null], ['quest-side', 'stewardship', 150, null],
  ]);
  assert.deepEqual(DEFAULT_RATES.map((r) => [r.id, r.skill, r.xp, r.perDay ?? null]), xpFile.sources.map((s) => [s.id, s.skill, s.xp, s.perDay ?? null]));
  assert.deepEqual(ratesOf(xpFile), ratesOf(null));
  assert.deepEqual(ratesOf(xpFile.sources), ratesOf(null));
  for (const source of xpFile.sources) {
    assert.ok(SKILL_IDS.includes(source.skill));
    assertCalm(source.text, source.id);
  }
  assert.equal(commas(13034431), '13,034,431');
});

test('every XP line reads calmly', () => {
  let state = started();
  state = { ...state, tally: { ...state.tally, sessionsFinished: 3, answered: 2, answeredFast: 2, buildingsDesigned: 1 } };
  state = payLifeFromSignals(state, NOW, xpFile).state;
  state = kindleTick(kindleStart(state, NOW, { xp: xpFile }).state, NOW + 70 * MIN, { xp: xpFile }).state;
  state = addXp(state, 'woodcutting', 25, NOW, { source: 'log-chopped', text: 'a log chopped' }).state;
  state = addXp(state, 'seamcraft', 390, NOW, { source: 'wild-stitch', text: 'a wild stitch at depth 3' }).state;
  state = addXp(state, 'wayfaring', 150, NOW, { source: 'lantern-lit' }).state;
  const lines = state.chronicle.xpLines;
  assert.ok(lines.length >= 7);
  for (const line of lines) {
    assertCalm(line.text, line.source);
    assertCosy(line.text, line.source);
    assert.ok(line.text.length <= STATE4_LIMITS.lineText && line.source.length <= STATE4_LIMITS.lineSource);
  }
});
