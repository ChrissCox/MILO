// Heat, edge and the outcome pick (src/combat/heat.js; CONTRACT-PHASE4.md §4.1–§4.3, §5.7).
//   node --test tests/combat-heat.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANDS, bandOf, shiftBars, barsFor, expected, attackPenalty, foldBars, drift, pick, oddsWords, draw, degreeAt, shiftDegree,
} from '../src/combat/heat.js';

const rules = JSON.parse(readFileSync(new URL('../content/combat/rules.json', import.meta.url), 'utf8'));

// §4.2's reference table, Critical / Hit / Graze / Miss, written out from the contract.
const REFERENCE = {
  cool: { 3: [35, 65, 0, 0], 2: [25, 75, 0, 0], 1: [15, 80, 5, 0], 0: [5, 80, 10, 5], '-1': [0, 75, 10, 15], '-2': [0, 65, 10, 25], '-3': [0, 55, 10, 35] },
  warm: { 3: [45, 55, 0, 0], 2: [35, 60, 5, 0], 1: [25, 60, 15, 0], 0: [15, 60, 15, 10], '-1': [5, 60, 15, 20], '-2': [0, 55, 15, 30], '-3': [0, 45, 15, 40] },
  hot: { 3: [60, 35, 5, 0], 2: [50, 35, 15, 0], 1: [40, 35, 15, 10], 0: [30, 35, 15, 20], '-1': [20, 35, 15, 30], '-2': [10, 35, 15, 40], '-3': [0, 35, 15, 50] },
};

test('the three bands are the contract’s bars, and rules.json holds the same numbers', () => {
  assert.deepEqual(BANDS.cool, [5, 80, 10, 5]);
  assert.deepEqual(BANDS.warm, [15, 60, 15, 10]);
  assert.deepEqual(BANDS.hot, [30, 35, 15, 20]);
  for (const band of ['cool', 'warm', 'hot']) {
    assert.deepEqual(rules.bands[band].bars, BANDS[band]);
    assert.equal(BANDS[band].reduce((s, x) => s + x, 0), 100);
  }
  assert.ok(Object.isFrozen(BANDS) && Object.isFrozen(BANDS.cool));
});

test('heat bands split at 30 and 60', () => {
  assert.equal(bandOf(0), 'cool');
  assert.equal(bandOf(30), 'cool');
  assert.equal(bandOf(31), 'warm');
  assert.equal(bandOf(60), 'warm');
  assert.equal(bandOf(61), 'hot');
  assert.equal(bandOf(100), 'hot');
});

test('the edge ladder makes §4.2’s reference table cell for cell, from the rule alone', () => {
  for (const band of ['cool', 'warm', 'hot']) {
    for (let edge = -3; edge <= 3; edge += 1) {
      const bars = shiftBars(BANDS[band], edge);
      assert.deepEqual(bars, REFERENCE[band][edge], `${band} at edge ${edge}`);
      assert.deepEqual(rules.edge.reference[band][String(edge)], REFERENCE[band][edge], `rules.json ${band} ${edge}`);
      assert.equal(bars.reduce((s, x) => s + x, 0), 100);
    }
  }
});

test('edge is capped at ±3 after every source is summed', () => {
  assert.deepEqual(shiftBars(BANDS.hot, 7), REFERENCE.hot[3]);
  assert.deepEqual(shiftBars(BANDS.cool, -9), REFERENCE.cool[-3]);
});

test('the expected multipliers are 0.95, 0.975 and 1.025', () => {
  assert.equal(expected(BANDS.cool), 0.95);
  assert.equal(expected(BANDS.warm), 0.975);
  assert.equal(expected(BANDS.hot), 1.025);
});

test('Storybook uses every band one step cooler; helpful floors a Miss into a Graze; a Cheer folds both into Hit', () => {
  assert.deepEqual(barsFor(80, 0, { storybook: true }), BANDS.warm);
  assert.deepEqual(barsFor(45, 0, { storybook: true }), BANDS.cool);
  assert.deepEqual(barsFor(10, 0, { storybook: true }), BANDS.cool);
  assert.deepEqual(barsFor(25, 0, { helpful: true }), [5, 80, 15, 0]);
  assert.deepEqual(barsFor(70, -1, { cheer: true }), [20, 80, 0, 0]);
});

test('foldBars runs §5.7’s order: kind noise, helpful, Cheer, being sure, plot armour', () => {
  assert.deepEqual(foldBars([30, 35, 15, 20], { kind: true }), [33, 32, 15, 20]);
  assert.deepEqual(foldBars([15, 60, 15, 10], { sure: true }), [75, 15, 10, 0]);
  assert.deepEqual(foldBars([15, 60, 15, 10], { armour: true }), [0, 15, 60, 25]);
  assert.deepEqual(foldBars([15, 60, 15, 10], { helpful: true, armour: true }), [0, 15, 60, 25]);
  assert.deepEqual(foldBars([15, 60, 15, 10], { cheer: true, sure: true }), [100, 0, 0, 0]);
  for (const opts of [{ kind: true }, { helpful: true }, { cheer: true }, { sure: true }, { armour: true }]) {
    assert.equal(foldBars([5, 80, 10, 5], opts).reduce((s, x) => s + x, 0), 100);
  }
});

test('the attack penalty adds 20 heat (10 light) from the second attack and −1 edge per attack after the first', () => {
  assert.deepEqual(attackPenalty(0), { heat: 0, edge: 0 });
  assert.deepEqual(attackPenalty(1), { heat: 20, edge: -1 });
  assert.deepEqual(attackPenalty(2), { heat: 20, edge: -2 });
  assert.deepEqual(attackPenalty(1, { light: true }), { heat: 10, edge: -1 });
  assert.deepEqual(attackPenalty(2, { light: true }), { heat: 10, edge: -2 });
  // Pip's three Strikes at idle 45: 45, then 65, then 85.
  let heat = 45;
  const used = [];
  for (let i = 0; i < 3; i += 1) {
    heat += attackPenalty(i).heat;
    used.push(heat);
  }
  assert.deepEqual(used, [45, 65, 85]);
});

test('drift moves 10 (or 20) toward idle and never past it', () => {
  assert.equal(drift(65, 45), 55);
  assert.equal(drift(50, 45), 45);
  assert.equal(drift(20, 45), 30);
  assert.equal(drift(40, 45), 45);
  assert.equal(drift(85, 45, 20), 65);
  assert.equal(drift(45, 45), 45);
});

test('an outcome is unit(hashInts(seed, attempt, k)) against the bars, Critical first', () => {
  const bars = [15, 60, 15, 10];
  for (let k = 0; k < 200; k += 1) {
    const u = draw(99, 0, k);
    const expectedDegree = u < 15 ? 'crit' : u < 75 ? 'hit' : u < 90 ? 'graze' : 'miss';
    assert.equal(pick(99, 0, k, bars), expectedDegree);
    assert.equal(degreeAt(u, bars), expectedDegree);
  }
  // A Try again (attempt + 1) draws a different sequence.
  const a = Array.from({ length: 40 }, (_, k) => pick(7, 0, k, bars)).join();
  const b = Array.from({ length: 40 }, (_, k) => pick(7, 1, k, bars)).join();
  assert.notEqual(a, b);
});

test('over 100,000 seeded picks every degree lands within 0.5 points of its bar', () => {
  for (const bars of [BANDS.cool, BANDS.warm, BANDS.hot, [20, 35, 15, 30], [5, 80, 15, 0], [0, 45, 15, 40]]) {
    const counts = { crit: 0, hit: 0, graze: 0, miss: 0 };
    const N = 100000;
    for (let k = 0; k < N; k += 1) counts[pick(12345, 0, k, bars)] += 1;
    ['crit', 'hit', 'graze', 'miss'].forEach((d, i) => {
      const share = (100 * counts[d]) / N;
      assert.ok(Math.abs(share - bars[i]) <= 0.5, `${d} ${share.toFixed(2)} vs ${bars[i]} for ${bars}`);
    });
  }
});

test('odds read as words: likely at 70, about even at 40, a long shot below; a Critical in reach at 20', () => {
  assert.deepEqual(oddsWords([5, 80, 10, 5]), { words: 'likely', critInReach: false });
  assert.deepEqual(oddsWords([20, 35, 15, 30]), { words: 'about even', critInReach: true });
  assert.deepEqual(oddsWords([0, 35, 15, 50]), { words: 'a long shot', critInReach: false });
  assert.deepEqual(oddsWords([10, 60, 15, 15]), { words: 'likely', critInReach: false });
});

test('a degree moves one step at a time and stays within Critical…Miss', () => {
  assert.equal(shiftDegree('graze', 1), 'hit');
  assert.equal(shiftDegree('crit', 1), 'crit');
  assert.equal(shiftDegree('hit', -1), 'graze');
  assert.equal(shiftDegree('miss', -1), 'miss');
});
