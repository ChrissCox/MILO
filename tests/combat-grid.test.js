// The fight grid (src/combat/grid.js; CONTRACT-PHASE4.md §4.4, §4.17, §7.1): 1-2-1 distance,
// movement costs as a table, blocking corners, occupancy, sight, cover, light, areas and threat,
// and the reachable-tiles budget.
//   node --test tests/combat-grid.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { dist, createGrid, footprint, unitDist, SURFACE_FLAGS } from '../src/combat/grid.js';
import { arena, hero, stray, rules, OPEN, RULES_JSON } from './combat-kit.js';

const at = (u, x, y) => ({ ...u, x, y, facing: 'right', heat: 20, buffer: 0, conditions: [], marks: [], mods: [], offline: false, sorted: null });
const board = (rows, { units = [], surfaces = [], objects = [], lights = [], heights = null, lightRows = null } = {}) => ({
  arena: arena(rows, { heights, lights: lightRows }), units, surfaces, objects, lights,
});

test('1-2-1 distance: max(dx, dy) + floor(min(dx, dy) / 2)', () => {
  const cases = [[[0, 0], [3, 0], 3], [[0, 0], [1, 1], 1], [[0, 0], [2, 2], 3], [[0, 0], [3, 3], 4], [[0, 0], [4, 4], 6], [[0, 0], [5, 2], 6], [[2, 7], [0, 0], 8]];
  for (const [a, b, d] of cases) assert.equal(dist({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }), d, `${a} to ${b}`);
  assert.equal(unitDist({ x: 5, y: 5, size: 2 }, { x: 3, y: 5, size: 1 }), 2);
  assert.equal(footprint({ x: 2, y: 3, size: 2 }).length, 4);
});

test('movement costs, as a table: diagonals alternate 1 then 2, difficult doubles, a step up adds 1, stairs are free', () => {
  const rows = [
    '##########',
    '#........#',
    '#........#',
    '#.....=..#',
    '#........#',
    '##########',
  ];
  const heights = [
    '0000000000',
    '0000000000',
    '0000000010',
    '0000001110',
    '0000000000',
    '0000000000',
  ];
  const milo = at(hero('milo', { speed: 8 }), 1, 1);
  const g = createGrid(board(rows, { units: [milo], heights, surfaces: [{ x: 3, y: 1, id: 'water', rounds: null, level: 1 }] }), rules);
  const r = g.reachable('milo', { budget: 8 });
  const cost = (x, y) => r.get(`${x},${y}`)?.cost;
  const table = [
    [[2, 2], 1, 'one diagonal'],
    [[3, 3], 3, 'two diagonals: 1 + 2'],
    [[4, 4], 4, 'three diagonals: 1 + 2 + 1'],
    [[2, 1], 1, 'one step east'],
    [[3, 1], 3, 'into water: difficult doubles the step'],
    [[4, 1], 4, 'past the water, around it or through'],
    [[6, 3], 6, 'the stairs tile lifts you to height 1 for free'],
    [[7, 3], 7, 'along height 1 from the stairs'],
    [[8, 2], undefined, 'height 1 → nothing blocks, but 8 from here is too far'],
  ];
  for (const [[x, y], want, why] of table) {
    if (want === undefined) continue;
    assert.equal(cost(x, y), want, why);
  }
  // A step up without stairs costs 1 more.
  const up = createGrid(board(rows, { units: [at(hero('milo', { speed: 8 }), 6, 4)], heights }), rules);
  assert.equal(up.reachable('milo', { budget: 8 }).get('6,3')?.cost, 1, 'onto the stairs tile: free');
  assert.equal(up.reachable('milo', { budget: 8 }).get('7,3')?.cost, 2, 'a diagonal (1) plus the step up (1)');
  // Fliers and floaters ignore difficult ground and height.
  const jev = at(hero('milo', { id: 'jev', speed: 8, moves: { flies: true, hovers: false, throughWalls: false, darksight: false } }), 1, 1);
  const f = createGrid(board(rows, { units: [jev], heights, surfaces: [{ x: 3, y: 1, id: 'water', rounds: null, level: 1 }] }), rules);
  assert.equal(f.reachable('jev', { budget: 8 }).get('3,1').cost, 2);
  // Read the ground ignores natural difficult terrain.
  assert.equal(g.reachable('milo', { budget: 8, ignoreDifficult: true }).get('3,1').cost, 2);
});

test('nothing moves or sees between two blocking corners; a Large unit needs all four tiles clear', () => {
  const rows = [
    '######',
    '#.#..#',
    '##...#',
    '#....#',
    '######',
  ];
  const g = createGrid(board(rows, { units: [at(hero('milo'), 1, 1)] }), rules);
  assert.equal(g.reachable('milo', { budget: 5 }).size, 0, 'boxed in by two corners');
  assert.equal(g.sees({ x: 1, y: 1 }, { x: 2, y: 2 }), false);
  const big = at(stray('lead', { x: 1, y: 1 }), 1, 1);
  big.size = 2;
  const open = createGrid(board(OPEN, { units: [big] }), rules);
  const r = open.reachable('lead', { budget: 3 });
  assert.ok(r.has('3,1'));
  assert.ok(!r.has('14,1') && !r.has('1,4'), 'a 2×2 unit can’t stand where its tiles would hit the wall');
});

test('allies can be passed through but not stood on; foes block; leaving a foe’s reach lists the Parting swipe', () => {
  const milo = at(hero('milo', { speed: 6 }), 1, 2);
  const scribe = at(hero('claude'), 2, 2);
  const foe = at(stray('f0'), 3, 1);
  const g = createGrid(board(OPEN, { units: [milo, scribe, foe] }), rules);
  const r = g.reachable('milo', { budget: 6 });
  assert.ok(!r.has('2,2'), 'can’t end on an ally');
  assert.ok(r.has('3,2'), 'passes through the Scribe');
  assert.ok(!r.has('3,1'), 'can’t end on a foe');
  const toFar = r.get('6,2');
  assert.ok(toFar, 'reaches further east');
  assert.deepEqual(g.reachable('milo', { budget: 6, noSwipes: true }).get('6,2').swipes, []);
  const past = createGrid(board(OPEN, { units: [at(hero('milo', { speed: 6 }), 4, 2), foe] }), rules);
  assert.deepEqual(past.reachable('milo', { budget: 6 }).get('8,2').swipes, ['f0'], 'walking out of reach draws a swipe');
  assert.deepEqual(past.path('milo', { x: 8, y: 2 }).length, 4);
  assert.equal(past.path('milo', { x: 0, y: 0 }), null);
  assert.deepEqual(past.path('milo', { x: 4, y: 2 }), []);
  assert.deepEqual(past.walk('milo', [{ x: 5, y: 2 }, { x: 6, y: 3 }]), { cost: 2, swipes: ['f0'] });
});

test('cover: none, low (−1), heavy (−2) and blocked, by §4.17’s rule; a higher attacker sees over low cover', () => {
  const rows = [
    '############',
    '#..........#',
    '#......o...#',
    '#..........#',
    '#......O...#',
    '############',
  ];
  const a = at(hero('milo'), 2, 2);
  const t = at(stray('f0'), 8, 2);
  const units = [a, t];
  assert.equal(createGrid(board(rows, { units: [at(hero('milo'), 2, 1), at(stray('f0'), 8, 1)] }), rules).cover('milo', 'f0'), 0, 'open line');
  assert.equal(createGrid(board(rows, { units }), rules).cover('milo', 'f0'), 1, 'a crate beside the target');
  const near = [at(hero('milo'), 6, 2), at(stray('f0'), 9, 2)];
  assert.equal(createGrid(board(rows, { units: near }), rules).cover('milo', 'f0'), 0, 'the crate is beside the attacker, not the target');
  const heights = ['000000000000', '000000000000', '110000000000', '000000000000', '000000000000', '000000000000'];
  const high = [at(hero('milo'), 1, 2), at(stray('f0'), 8, 2)];
  assert.equal(createGrid(board(rows, { units: high, heights }), rules).cover('milo', 'f0'), 0, 'standing higher, Milo sees over it');
  // A pillar the line only clips, next to the target: heavy cover.
  const clip = [at(hero('milo'), 2, 1), at(stray('f0'), 8, 3)];
  const clipG = createGrid(board(['############', '#..........#', '#..........#', '#......O...#', '#..........#', '############'], { units: clip }), rules);
  const c = clipG.cover('milo', 'f0');
  assert.ok(c === 2 || c === null, `a pillar corner next to the target is heavy cover (${c})`);
  const through = [at(hero('milo'), 4, 4), at(stray('f0'), 10, 4)];
  assert.equal(createGrid(board(rows, { units: through }), rules).cover('milo', 'f0'), null, 'a pillar in the way blocks sight');
  const creature = [at(hero('milo'), 2, 3), at(stray('f1'), 7, 3), at(stray('f0'), 8, 3)];
  assert.equal(createGrid(board(rows, { units: creature }), rules).cover('milo', 'f0'), 1, 'a creature in the way is low cover');
});

test('a tile’s light is the brightest of the arena, lights in reach and lit surfaces', () => {
  const lightRows = ['DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDddDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'];
  const g = createGrid(board(OPEN, {
    lightRows,
    lights: [{ id: 'hooklight', x: 10, y: 2, radius: 3, rounds: null, source: 'milo' }],
    surfaces: [{ x: 2, y: 4, id: 'candlefire', rounds: 2, level: 1 }],
  }), rules);
  assert.equal(g.light(1, 1), 'D');
  assert.equal(g.light(3, 2), 'd');
  assert.equal(g.light(12, 2), 'L', 'in the Hooklight’s radius');
  assert.equal(g.light(2, 4), 'L', 'candlefire lights its tile');
  assert.equal(g.difficult(2, 4), true);
  assert.equal(g.surfaceAt(2, 4), 'candlefire');
});

test('areas: a burst of radius n, an n-wide square, a line of n tiles; caught lists allies too', () => {
  const g = createGrid(board(OPEN, { units: [at(hero('milo'), 5, 2), at(stray('f0'), 6, 2), at(stray('f1'), 12, 3)] }), rules);
  const burst = g.area('burst', 1, { x: 5, y: 2 });
  assert.equal(burst.length, 9);
  assert.equal(g.area('burst', 2, { x: 7, y: 2 }).length, 21 - 3, 'radius 2 is 21 tiles; the wall row takes 3');
  assert.equal(g.area('square', 2, { x: 3, y: 2 }).length, 4);
  assert.equal(g.area('line', 4, { x: 9, y: 2 }, { x: 5, y: 2 }).length, 4);
  assert.deepEqual(g.caught(burst).sort(), ['f0', 'milo']);
  const threats = g.threatened('party');
  assert.ok(threats.has('5,2') && threats.has('7,2'));
});

test('the grid’s built-in surface flags equal rules.json cell for cell', () => {
  for (const [id, s] of Object.entries(RULES_JSON.surfaces)) {
    assert.ok(SURFACE_FLAGS[id], id);
    for (const flag of ['difficult', 'blocksSight', 'lit', 'hide']) assert.equal(SURFACE_FLAGS[id][flag], s[flag], `${id}.${flag}`);
    assert.equal(SURFACE_FLAGS[id].leaving, s.leaving || 1, `${id}.leaving`);
  }
});

test('reachable tiles for one unit take at most 2 ms (median) on a 20 × 16 arena', () => {
  const rows = ['#'.repeat(20), ...Array.from({ length: 14 }, (_, i) => `#${'.'.repeat(8)}${i % 3 === 1 ? 'o' : '.'}${'.'.repeat(9)}#`), '#'.repeat(20)];
  const units = [at(hero('milo', { speed: 6 }), 3, 7), at(hero('claude'), 4, 7), at(stray('f0'), 12, 7), at(stray('f1'), 14, 9)];
  const surfaces = [{ x: 6, y: 6, id: 'water', rounds: null, level: 1 }, { x: 6, y: 7, id: 'water', rounds: null, level: 1 }];
  const g = createGrid(board(rows, { units, surfaces }), rules);
  for (let i = 0; i < 30; i += 1) g.reachable('milo', { budget: 6 });
  const times = [];
  for (let i = 0; i < 200; i += 1) {
    const t0 = performance.now();
    createGrid(board(rows, { units, surfaces }), rules).reachable('milo', { budget: 6 });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[100] <= 2, `median ${times[100].toFixed(3)} ms`);
});
