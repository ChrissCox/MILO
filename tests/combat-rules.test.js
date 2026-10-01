// The rule tables (src/combat/rules.js; CONTRACT-PHASE4.md §4.7–§4.9, §4.15, §7.1): loading and
// validating rules.json, the lines past 12, hero and stray Integrity, adaptation steps, §4.8's
// damage order as a table, Buffer as a pool, and the time-to-down targets.
//   node --test tests/combat-rules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRules, line, heroIntegrity, strayRow, integrityFactor, adaptStep, condition, surface, damageSteps, modeRoomLevel, surfaceGrowth,
} from '../src/combat/rules.js';
import { RULES_JSON, rules } from './combat-kit.js';

test('loadRules freezes the rules and throws with the path of the first problem', () => {
  assert.ok(Object.isFrozen(rules) && Object.isFrozen(rules.lines.one));
  assert.deepEqual(rules.tuning, RULES_JSON.tuning, 'rules.json’s own pass criteria stay (H’s tune.mjs reads them)');
  assert.equal(rules.tuned, null, 'no tuning.json yet');
  const broken = JSON.parse(JSON.stringify(RULES_JSON));
  broken.lines.two = [1, 2, 3];
  assert.throws(() => loadRules(broken), /lines\.two/);
  const noBands = JSON.parse(JSON.stringify(RULES_JSON));
  delete noBands.bands;
  assert.throws(() => loadRules(noBands), /bands/);
  const badCond = JSON.parse(JSON.stringify(RULES_JSON));
  badCond.conditions.tumbled.crit = 'triple';
  assert.throws(() => loadRules(badCond), /conditions\.tumbled\.crit/);
  assert.throws(() => loadRules({ ...RULES_JSON, version: 2 }), /version/);
  const tuned = loadRules(RULES_JSON, { version: 1, integrityFactor: { 3: { 2: 0.9 } }, xInt: {} });
  assert.deepEqual(tuned.tuning, RULES_JSON.tuning, 'tuning.json never overwrites rules.json’s tuning');
  assert.deepEqual(tuned.tuned.integrityFactor, { 3: { 2: 0.9 } });
  assert.equal(integrityFactor(tuned, 3, 2), 0.9);
  assert.equal(integrityFactor(tuned, 3, 4), 1);
  assert.equal(integrityFactor(rules, 5, 4), 1, 'without tuning.json the factor is 1');
});

test('the lines are §4.8’s, and past 12 each adds its last step', () => {
  assert.deepEqual([1, 5, 10, 12].map((l) => line(rules, 'one', l)), [5, 9, 15, 17]);
  assert.deepEqual([1, 5, 10, 12].map((l) => line(rules, 'strike', l)), [7, 13, 22, 26]);
  assert.deepEqual([1, 5, 12].map((l) => line(rules, 'two', l)), [12, 22, 42]);
  assert.deepEqual([13, 14].map((l) => line(rules, 'one', l)), [18, 19]);
  assert.deepEqual([13, 14].map((l) => line(rules, 'strike', l)), [28, 30]);
  assert.deepEqual([13, 14].map((l) => line(rules, 'two', l)), [45, 48]);
  assert.deepEqual([13, 14].map((l) => line(rules, 'three', l)), [66, 70]);
  assert.deepEqual([13, 14].map((l) => line(rules, 'area', l)), [49, 52]);
});

test('hero Integrity: Milo (Middle, Grit +2) has 18 at level 1 and 64 at 5; past 12 each build adds its last step', () => {
  assert.equal(heroIntegrity(rules, 'middle', 1, 2), 18);
  assert.equal(heroIntegrity(rules, 'middle', 5, 2), 64);
  assert.equal(heroIntegrity(rules, 'sturdy', 5, 1), 70);
  assert.equal(heroIntegrity(rules, 'light', 10, 0), 91, 'Grit 0 takes 1 a level after the first');
  assert.equal(heroIntegrity(rules, 'sturdy', 13, 1), 182);
  assert.equal(heroIntegrity(rules, 'middle', 13, 1), 156);
  assert.equal(heroIntegrity(rules, 'light', 13, 1), 130);
});

test('the stray rows match §4.9 and continue past 12 by the Decided formulas', () => {
  assert.deepEqual([0, 1, 5, 10, 12].map((n) => strayRow(rules, 'integrity', n)), [15, 20, 75, 160, 194]);
  assert.deepEqual([0, 1, 5, 10, 12].map((n) => strayRow(rules, 'strike', n)), [5, 6, 12, 20, 23]);
  assert.deepEqual([0, 1, 5, 10, 12].map((n) => strayRow(rules, 'resist', n)), [2, 3, 6, 9, 11]);
  assert.equal(strayRow(rules, 'integrity', 14), 194 + 34);
  assert.equal(strayRow(rules, 'strike', 14), 23 + 3);
  assert.equal(strayRow(rules, 'strike', 13), 24);
  assert.equal(strayRow(rules, 'resist', 14), 3 + Math.floor((3 * 13) / 4));
  for (let n = 1; n <= 12; n += 1) assert.equal(strayRow(rules, 'resist', n), 3 + Math.floor((3 * (n - 1)) / 4), `the resistance formula holds at ${n}`);
});

test('adaptStep starts by rank, moves one step for 2+ levels either way, and follows the mode and the switch', () => {
  const at = (rank, level, roadLevel, mode = 'long-road', adaptation = true, roomLevel = undefined) => adaptStep({ rank, level, roomLevel, roadLevel }, { mode, adaptation, rules });
  assert.deepEqual(['lackey', 'stray', 'elite', 'lead'].map((r) => at(r, 3, 3)), [0, 1, 2, 3]);
  assert.equal(at('stray', 5, 3), 2, 'two above: one up');
  assert.equal(at('stray', 1, 3), 0, 'two below: one down');
  assert.equal(at('elite', 3, 3, 'mauds-table'), 3);
  assert.equal(at('lead', 3, 3, 'mauds-table'), 4);
  assert.equal(at('lead', 9, 3, 'mauds-table'), 4, 'never past 4');
  assert.equal(at('lead', 3, 3, 'storybook'), 0);
  assert.equal(at('lead', 3, 3, 'long-road', false), 0, 'the switch sets every step to 0');
  assert.equal(at('lead', 1, 3, 'long-road', true, 3), 3, 'a lead compares its room’s n, not its own lower level');
  assert.equal(at('lead', 3, 3, 'long-road', true, 5), 4, 'a lead’s room 2+ above adapts at 4');
  assert.equal(at('lackey', 1, 3, 'long-road', true, 3), 0);
  assert.equal(at('hero', 3, 3), 0);
});

test('damageSteps runs §4.8’s eight steps in order (a table test)', () => {
  const table = [
    // [input, dealt, buffered, why]
    [{ amount: 7, degree: 'hit', buffer: 0 }, 7, 0, 'as written'],
    [{ amount: 7, degree: 'crit', weak: 3, buffer: 0 }, 17, 0, 'the degree first, then the weakness: 7 × 2 + 3'],
    [{ amount: 7, degree: 'graze', weak: 3, buffer: 0 }, 6, 0, 'a Graze halves down, then + 3'],
    [{ amount: 6, degree: 'hit', resist: 3, buffer: 0 }, 3, 0, 'resistance subtracts'],
    [{ amount: 2, degree: 'hit', resist: 5, buffer: 0 }, 0, 0, 'never below 0'],
    [{ amount: 7, degree: 'miss', weak: 3, buffer: 0 }, 0, 0, 'a Miss does nothing, weakness or not'],
    [{ amount: 9, degree: 'hit', scale: 0.75, buffer: 0 }, 6, 0, 'Storybook’s ×0.75 rounds down before the degree'],
    [{ amount: 9, degree: 'crit', scale: 0.75, buffer: 0 }, 12, 0, '×0.75 then ×2'],
    [{ amount: 10, degree: 'hit', taken: (a) => Math.floor(a / 2), buffer: 0 }, 5, 0, 'a lead’s damageTaken after the weakness'],
    [{ amount: 10, degree: 'hit', weak: 2, halve: true, buffer: 0 }, 6, 0, 'Tuck and roll halves after the weakness'],
    [{ amount: 10, degree: 'hit', less: 5, buffer: 0 }, 5, 0, 'Stand in my light takes the one line off'],
    [{ amount: 10, degree: 'hit', halve: true, less: 3, buffer: 0 }, 2, 0, 'halve, then less'],
    [{ amount: 6, degree: 'graze', buffer: 4 }, 0, 3, 'the Buffer soaks the Graze of 3'],
    [{ amount: 10, degree: 'hit', buffer: 4 }, 6, 4, 'Buffer soaks last; the rest comes off Integrity'],
  ];
  for (const [input, dealt, buffered, why] of table) {
    const r = damageSteps(input);
    assert.equal(r.dealt, dealt, why);
    assert.equal(r.buffered, buffered, why);
  }
  const w = damageSteps({ amount: 7, degree: 'crit', weak: 3, buffer: 0 });
  assert.equal(w.weakAdded, 3);
  const res = damageSteps({ amount: 2, degree: 'hit', resist: 5, buffer: 0 });
  assert.equal(res.resisted, 2);
});

test('Buffer is a pool: a Buffer of 4 against hits of 3 and 3 soaks 3, then 1', () => {
  const first = damageSteps({ amount: 3, degree: 'hit', buffer: 4 });
  assert.deepEqual([first.buffered, first.dealt, first.bufferLeft], [3, 0, 1]);
  const second = damageSteps({ amount: 3, degree: 'hit', buffer: first.bufferLeft });
  assert.deepEqual([second.buffered, second.dealt, second.bufferLeft], [1, 2, 0]);
});

test('time to down: a Middle hero survives 3, 5 and 6 on-level stray Strikes at levels 1, 5 and 10; Sturdy and Light within one', () => {
  const survives = (build, L) => Math.floor(heroIntegrity(rules, build, L, 1) / strayRow(rules, 'strike', L));
  assert.deepEqual([1, 5, 10].map((L) => survives('middle', L)), [3, 5, 6]);
  for (const build of ['sturdy', 'light']) {
    [1, 5, 10].forEach((L, i) => assert.ok(Math.abs(survives(build, L) - [3, 5, 6][i]) <= 1, `${build} at ${L}: ${survives(build, L)}`));
  }
});

test('conditions and surfaces read back with their ids; the room level follows the mode; surfaces grow at level 4', () => {
  assert.deepEqual(condition(rules, 'tumbled'), { id: 'tumbled', ...RULES_JSON.conditions.tumbled });
  assert.equal(condition(rules, 'nope'), null);
  assert.equal(surface(rules, 'oil-slick').meets, 'body');
  assert.equal(surface(rules, 'nope'), null);
  assert.equal(modeRoomLevel(rules, 1, 'storybook'), 1, 'never below 1');
  assert.equal(modeRoomLevel(rules, 5, 'storybook'), 4);
  assert.equal(modeRoomLevel(rules, 5, 'mauds-table'), 6);
  assert.deepEqual([1, 2, 3, 4, 6, 7, 10].map((l) => surfaceGrowth(rules, l)), [0, 0, 0, 1, 1, 2, 3]);
});
