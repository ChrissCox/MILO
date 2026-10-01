// The Riddle Note trail and the Last Bridge (module E): src/world/trail.js (CONTRACT-PHASE4.md §3.1,
// §7.7, §9.12, §17 items 9 and 21). Fifty seeded worlds, so this file takes a little while.
// Run: node --test tests/trail.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { assertTitle } from './calm.js';
import { createWorldgen, CHUNK, DECK_CLEAR, GATES, HEART, TERRAIN as T, TERRAIN_INFO } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { createNav } from '../src/world/nav.js';
import { MAP, PLACES } from '../src/world/map.js';
import { hashValue, GOLDEN_FILE } from './fixtures/make-golden.mjs';
import {
  lastBridge, northRoadEntry, bridgeLandmarks, bridgeExamineVariant, placeAt, isPlace, isVisitPlace, solveKnown, handOut, stepDone, markJoined, trailView, trailsOpen,
  STEP_KINDS, FEATURES, LAST_BRIDGE_ID, TOLLKEEPER_ID, LAST_BRIDGE_RULE, ROAD_WEIGHT, TRAIL_JOINS,
} from '../src/world/trail.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const words = read('riftgen.json');
const trails = read('trails.json');
const golden = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));

const SEEDS = ['hushlands', 'moonrise', 'another story', ...Array.from({ length: 47 }, (_, i) => `seed-${i}`)];
const worldFor = (seed) => createWorldgen({ seed, regionWords: words.regionWords });
const hush = worldFor('hushlands');
const HUSH_BRIDGE = lastBridge(hush);
const HOME = MAP.miloHome;
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const valeDist = (p) => Math.hypot(p.x - HEART.cx, p.y - HEART.cy);
const ROADISH = [T.ROAD, T.BRIDGE];
const WET = [T.RIVER, T.SEA, T.DEEP];
// §7.7's own numbers, written here as literals (never read back from trail.js, so changing the
// module's constant can't move what the tests expect): within 16 tiles of the wood's edge, a deck
// of 1–5 river tiles, and 0.25 on the road distance.
const EDGE = 16;
const DECK = [1, 5];

/** The two banks of a bridge: the ends of its deck, one step past each. */
function banks(b) {
  const [dx, dy] = b.dir === 'h' ? [1, 0] : [0, 1];
  return [{ x: b.deck[0].x - dx, y: b.deck[0].y - dy }, { x: b.deck.at(-1).x + dx, y: b.deck.at(-1).y + dy }];
}

/**
 * Every rule §7.7 and trail.js's LAST_BRIDGE_RULE put on a river crossing, checked on the bridge
 * lastBridge chose in `world` (a failed rule names itself in the message).
 */
function assertRiverRules(world, b, where) {
  const rule = LAST_BRIDGE_RULE;
  const anchor = world.anchorById.whisperwood;
  const terrain = (x, y) => (world.inHeart(x, y) ? T.HEART : world.terrainAt(x, y));
  const [a, c] = banks(b);
  const stand = b.stand;
  const far = a.x === stand.x && a.y === stand.y ? c : a;
  // South of the anchor, within 16 tiles of the wood's edge, by the crossing's midpoint.
  const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  assert.ok(mid.y > anchor.y, `${where}: the crossing is south of the wood’s anchor (${mid.y} against ${anchor.y})`);
  const off = Math.abs(Math.hypot(mid.x - anchor.x, mid.y - anchor.y) - anchor.radius);
  assert.ok(off <= EDGE, `${where}: within ${EDGE} tiles of the wood’s edge (${off.toFixed(1)})`);
  assert.ok(b.deck.length >= DECK[0] && b.deck.length <= DECK[1], `${where}: ${b.deck.length} deck tiles`);
  // The stand is the bank nearer the vale; the far bank is in the wood.
  const near = valeDist(stand) < valeDist(far)
    || (valeDist(stand) === valeDist(far) && (stand.y > far.y || (stand.y === far.y && stand.x > far.x)));
  assert.ok(near, `${where}: the stand is the bank nearer the vale (${valeDist(stand).toFixed(1)} against ${valeDist(far).toFixed(1)})`);
  assert.equal(world.regionAt(far.x, far.y), anchor.name, `${where}: its far bank is in the wood`);
  // The stand: water west, east or south of it (so nothing grows on it), and land to step onto.
  assert.ok([[-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => WET.includes(terrain(stand.x + dx, stand.y + dy))), `${where}: water beside the stand`);
  const deck = new Set(b.deck.map((p) => `${p.x},${p.y}`));
  const footing = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const t = terrain(stand.x + dx, stand.y + dy);
    return !deck.has(`${stand.x + dx},${stand.y + dy}`) && t !== T.HEART && !ROADISH.includes(t) && TERRAIN_INFO[t].walk;
  });
  assert.ok(footing, `${where}: the stand has footing off the deck`);
  // Clear of the vale, of every road and bridge, and of every point of interest.
  const tiles = [stand, ...b.deck, far];
  for (const p of tiles) assert.ok(world.heartDistance(p.x, p.y) >= rule.valeClear, `${where}: ${p.x},${p.y} is out at the wood, not by the walls`);
  for (const p of tiles) {
    for (let dy = -rule.roadClear; dy <= rule.roadClear; dy += 1) {
      for (let dx = -rule.roadClear; dx <= rule.roadClear; dx += 1) {
        assert.ok(!ROADISH.includes(terrain(p.x + dx, p.y + dy)), `${where}: a road or bridge at ${p.x + dx},${p.y + dy}, within ${rule.roadClear} of ${p.x},${p.y}`);
      }
    }
  }
  const chunks = new Set();
  for (const p of tiles) {
    for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) chunks.add(`${Math.floor((p.x + dx * rule.poiClear) / CHUNK)},${Math.floor((p.y + dy * rule.poiClear) / CHUNK)}`);
  }
  const pois = [...world.fixedPois(), ...[...chunks].flatMap((k) => { const [cx, cy] = k.split(',').map(Number); return world.chunk(cx, cy).pois; })];
  for (const poi of pois) {
    for (const p of tiles) assert.ok(cheb(poi, p) > rule.poiClear, `${where}: the ${poi.type} at ${poi.x},${poi.y} is within ${rule.poiClear} of ${p.x},${p.y}`);
  }
}

// Every seed's world and bridge, built once for the tests that sweep them.
let sweep = null;
function allBridges() {
  if (sweep) return sweep;
  sweep = SEEDS.map((seed) => {
    const world = seed === 'hushlands' ? hush : worldFor(seed);
    return { seed, world, bridge: seed === 'hushlands' ? HUSH_BRIDGE : lastBridge(world) };
  });
  return sweep;
}

/* --- the Last Bridge */

test('the Last Bridge in hushlands: a short river crossing at the Whisperwood’s southern edge, west of the north road', () => {
  const b = HUSH_BRIDGE;
  assert.equal(b.id, LAST_BRIDGE_ID);
  assert.equal(b.dry, false, 'hushlands has a river crossing near the wood’s edge');
  assert.ok(Object.isFrozen(b) && Object.isFrozen(b.deck) && Object.isFrozen(b.stand), 'frozen');
  assert.ok(b.deck.length >= 1 && b.deck.length <= 5, `${b.deck.length} deck tiles`);
  for (const p of b.deck) assert.equal(hush.terrainAt(p.x, p.y), T.RIVER, 'the deck spans the river');
  assert.ok(b.deck.some((p) => p.x === b.x && p.y === b.y), 'x, y is a deck tile');
  const entry = northRoadEntry(hush);
  const anchor = hush.anchorById.whisperwood;
  assert.ok(Math.abs(Math.hypot(entry.x - anchor.x, entry.y - anchor.y) - anchor.radius) < 1, 'the entry is on the wood’s edge');
  // §17.21: about 40 tiles west of where the north road enters the wood, on the edge but not on the road.
  assert.ok(entry.x - b.stand.x >= 30 && entry.x - b.stand.x <= 50, `${entry.x - b.stand.x} tiles west of the road’s entry`);
  const mid = b.deck[Math.floor(b.deck.length / 2)];
  assert.ok(mid.y > anchor.y, 'south of the wood’s anchor');
  assert.ok(Math.abs(Math.hypot(mid.x - anchor.x, mid.y - anchor.y) - anchor.radius) <= EDGE, 'within 16 tiles of the edge');
  assert.equal(ROAD_WEIGHT, 0.25);
});

test('the placement rule’s numbers are §7.7’s: the Whisperwood, 16 tiles of its edge, a deck of 1–5, 0.25 on the road', () => {
  assert.equal(LAST_BRIDGE_RULE.region, 'whisperwood');
  assert.equal(LAST_BRIDGE_RULE.edge, 16);
  assert.deepEqual(LAST_BRIDGE_RULE.deck, [1, 5]);
  assert.equal(LAST_BRIDGE_RULE.roadWeight, 0.25);
  assert.equal(ROAD_WEIGHT, 0.25);
  assert.deepEqual([EDGE, ...DECK], [16, 1, 5]);
});

test('the Last Bridge is deterministic over 50 seeds, and the same in a freshly made world', () => {
  for (const { seed, world, bridge } of allBridges()) {
    assert.ok(bridge, `${seed} has a Last Bridge`);
    assert.deepEqual(lastBridge(world), bridge, `${seed}: asked again, the same bridge`);
  }
  for (const seed of ['hushlands', 'moonrise', 'seed-3']) {
    assert.deepEqual(lastBridge(worldFor(seed)), allBridges().find((s) => s.seed === seed).bridge, `${seed} in a new world`);
  }
});

test('over 50 seeds its shape holds: a straight deck of 1–5 tiles, the stand at the end nearer the vale, the far end in the wood', () => {
  let dry = 0;
  for (const { seed, world, bridge: b } of allBridges()) {
    const [dx, dy] = b.dir === 'h' ? [1, 0] : [0, 1];
    b.deck.forEach((p, i) => i && assert.deepEqual([p.x - b.deck[i - 1].x, p.y - b.deck[i - 1].y], [dx, dy], `${seed}: a straight deck`));
    const ends = [{ x: b.deck[0].x - dx, y: b.deck[0].y - dy }, { x: b.deck.at(-1).x + dx, y: b.deck.at(-1).y + dy }];
    assert.ok(ends.some((e) => e.x === b.stand.x && e.y === b.stand.y), `${seed}: the stand is at the deck’s end`);
    const far = ends.find((e) => e.x !== b.stand.x || e.y !== b.stand.y);
    assert.ok(TERRAIN_INFO[world.terrainAt(b.stand.x, b.stand.y)].walk, `${seed}: the stand is walkable ground`);
    assert.ok(valeDist(b.stand) <= valeDist(far), `${seed}: the stand is the end nearer the vale (${valeDist(b.stand).toFixed(1)} against ${valeDist(far).toFixed(1)})`);
    if (b.dry) {
      dry += 1;
      assert.equal(b.deck.length, LAST_BRIDGE_RULE.dryDeck);
      assert.ok(valeDist(b.stand) < valeDist(far), `${seed}: the footbridge’s stand is its vale end, off the wood’s`);
    } else {
      assert.ok(b.deck.length >= 1 && b.deck.length <= 5, `${seed}: ${b.deck.length} deck tiles`);
      for (const p of b.deck) assert.equal(world.terrainAt(p.x, p.y), T.RIVER, `${seed}: river under the deck`);
      assert.equal(world.regionAt(far.x, far.y), world.anchorById.whisperwood.name, `${seed}: its far bank is in the wood`);
      assert.ok(TERRAIN_INFO[world.terrainAt(far.x, far.y)].walk, `${seed}: land at the far end too`);
      for (const p of [...b.deck, b.stand, far]) assert.ok(world.heartDistance(p.x, p.y) >= LAST_BRIDGE_RULE.valeClear, `${seed}: out at the wood, not by the walls`);
    }
  }
  assert.ok(dry >= 1 && dry <= 12, `a few worlds with no crossing get the footbridge (${dry} of 50)`);
});

test('over 50 seeds every river bridge keeps the placement rule: south of the anchor, near the wood’s edge, clear of roads and places', () => {
  let river = 0;
  for (const { seed, world, bridge: b } of allBridges()) {
    if (b.dry) continue;
    assertRiverRules(world, b, seed);
    river += 1;
  }
  assert.ok(river >= 38, `${river} river bridges checked`);
});

/**
 * A made-up world for the placement rule's corner cases: grass everywhere, a wood of radius 30 at
 * (31, −60) north of the vale, the north road straight up x = 31 (so it enters the wood at
 * (31, −30)), and short east–west river ponds wherever a case puts them. `ground` overrides tiles
 * ('x,y' → a TERRAIN id); `pois` are fixed points of interest.
 */
function madeWorld({ ponds = [], ground = {}, pois = [], wood = { x: 31, y: -60, radius: 30 } } = {}) {
  const anchor = { ...wood, name: 'the Whisperwood' };
  const tiles = new Map(Object.entries(ground));
  for (const { x, y, n } of ponds) for (let k = 0; k < n; k += 1) tiles.set(`${x + k},${y}`, T.RIVER);
  const inHeart = (x, y) => x >= 0 && y >= 0 && x < HEART.w && y < HEART.h;
  return {
    seed: 12345,
    anchorById: { whisperwood: anchor },
    inHeart,
    heartDistance: (x, y) => Math.hypot(Math.max(0, -x, x - (HEART.w - 1)), Math.max(0, -y, y - (HEART.h - 1))),
    terrainAt: (x, y) => tiles.get(`${x},${y}`) ?? (x === 31 && y <= -1 && y >= anchor.y ? T.ROAD : T.GRASS),
    regionAt: (x, y) => (Math.hypot(x - anchor.x, y - anchor.y) <= anchor.radius ? anchor.name : 'the Greyreach'),
    roads: () => ({ paths: [{ from: 'gate:n', to: 'whisperwood', points: [{ x: 31, y: -1 }, { x: 31, y: anchor.y }] }], tiles: new Set() }),
    fixedPois: () => pois,
    chunk: () => ({ pois: [] }),
  };
}
// Two good crossings. A sits right on the wood's edge but far from the road's way in; B is two
// tiles inside the edge and near the road (still more than three tiles off it). The rule's
// score (|distance − radius| + ROAD_WEIGHT × distance to the way in) picks B: about 4.0 to 9.6.
const POND_A = { x: 5, y: -48, n: 2 };
const POND_B = { x: 23, y: -33, n: 2 };
const STAND_B = { x: 25, y: -33 };

test('the placement rule picks the lowest score: the crossing near the road beats the one exactly on the edge', () => {
  const world = madeWorld({ ponds: [POND_A, POND_B] });
  const b = lastBridge(world);
  assert.equal(b.dry, false);
  assert.deepEqual(b.deck, [{ x: 23, y: -33 }, { x: 24, y: -33 }], 'crossing B');
  assert.deepEqual(b.stand, STAND_B, 'its east bank, the one nearer the vale');
  assert.equal(b.dir, 'h');
  assertRiverRules(world, b, 'the made-up world');
  // Without B, A is the one.
  assert.deepEqual(lastBridge(madeWorld({ ponds: [POND_A] })).stand, { x: 7, y: -48 });
});

test('a crossing whose stand has no footing, or has a place beside it, is passed over for the next best', () => {
  // B's stand boxed in by rock on its other three sides: the Tollkeeper would have nowhere to step.
  const boxed = madeWorld({ ponds: [POND_A, POND_B], ground: { '26,-33': T.MOUNTAIN, '25,-34': T.MOUNTAIN, '25,-32': T.MOUNTAIN } });
  const b = lastBridge(boxed);
  assert.notDeepEqual(b.stand, STAND_B, 'not the boxed-in stand');
  assert.deepEqual(b.stand, { x: 7, y: -48 }, 'crossing A instead');
  assertRiverRules(boxed, b, 'boxed in');
  // A point of interest two tiles from B's stand: its prop would stand where the Tollkeeper does.
  const crowded = madeWorld({ ponds: [POND_A, POND_B], pois: [{ type: 'ruin', x: 26, y: -31 }] });
  const c = lastBridge(crowded);
  assert.deepEqual(c.stand, { x: 7, y: -48 }, 'crossing A again');
  assertRiverRules(crowded, c, 'crowded');
});

test('a crossing level with the wood’s anchor isn’t south of it, so a world with only that one gets the footbridge', () => {
  // On the anchor's own row, two tiles inside the edge, with its far bank in the wood: good in every
  // way but one.
  const world = madeWorld({ ponds: [{ x: 3, y: -60, n: 2 }] });
  const b = lastBridge(world);
  assert.equal(b.dry, true, 'the footbridge on the north road');
  for (const p of [...b.deck, b.stand]) assert.equal(world.terrainAt(p.x, p.y), T.ROAD);
  assert.ok(b.deck.some((p) => p.x === 31 && p.y === -30), 'where the road enters the wood');
  assert.deepEqual(b.deck, [{ x: 31, y: -31 }, { x: 31, y: -30 }, { x: 31, y: -29 }], 'three road tiles across the way in');
  assert.deepEqual(b.stand, { x: 31, y: -28 }, 'its stand is the end nearer the vale, not the wood’s end at (31, −32)');
  assert.equal(b.dir, 'v');
  // A step south of the row, the same crossing counts.
  assert.equal(lastBridge(madeWorld({ ponds: [{ x: 3, y: -59, n: 2 }] })).dry, false);
});

test('a crossing deeper in the wood than 16 tiles from its edge is passed over; one just inside 16 counts', () => {
  // Banks (24, −50) and (27, −50): the midpoint is about 11.4 tiles from the anchor, 18.6 inside
  // the edge. Everything else about it is good (south, far bank in the wood, clear of the road).
  const deep = madeWorld({ ponds: [{ x: 25, y: -50, n: 2 }] });
  assert.equal(lastBridge(deep).dry, true, 'too deep: the footbridge instead');
  // Banks (24, −45) and (27, −45): about 16.0 from the anchor, 14.0 inside the edge.
  const near = madeWorld({ ponds: [{ x: 25, y: -45, n: 2 }] });
  const b = lastBridge(near);
  assert.equal(b.dry, false);
  assert.deepEqual(b.deck, [{ x: 25, y: -45 }, { x: 26, y: -45 }]);
  assertRiverRules(near, b, 'just inside 16');
});

test('a crossing of more than five river tiles is too long; five is the most', () => {
  // Both on the wood's edge (distance 30 from the anchor), well west of the road.
  const long = madeWorld({ ponds: [{ x: 3, y: -54, n: 6 }] });
  assert.equal(lastBridge(long).dry, true, 'six tiles: no bridge there');
  const five = lastBridge(madeWorld({ ponds: [{ x: 3, y: -54, n: 5 }] }));
  assert.equal(five.dry, false);
  assert.equal(five.deck.length, 5);
});

test('a footbridge keeps clear of a place and a bridge by the road, and of the vale, moving along the road if it must', () => {
  const tilesOf = (b) => [...b.deck, b.stand];
  // A ruin two tiles east of the road's way in: the deck can't take the tiles beside it.
  const ruin = { type: 'ruin', x: 33, y: -30 };
  const crowded = madeWorld({ pois: [ruin] });
  const a = lastBridge(crowded);
  assert.equal(a.dry, true);
  for (const p of a.deck) assert.ok(cheb(p, ruin) > DECK_CLEAR, `the deck at ${p.x},${p.y} is clear of the ruin`);
  for (const p of tilesOf(a)) assert.equal(crowded.terrainAt(p.x, p.y), T.ROAD, 'still on the road');
  assert.ok(!a.deck.some((p) => p.y === -30), 'moved off the way in');
  // A bridge two tiles east of the way in (where another road crosses a stream): the same.
  const bridged = madeWorld({ ground: { '33,-30': T.BRIDGE } });
  const c = lastBridge(bridged);
  for (const p of tilesOf(c)) assert.ok(cheb(p, { x: 33, y: -30 }) > DECK_CLEAR, `${p.x},${p.y} is clear of the other bridge`);
  // A wood so close that the road enters it five tiles from the walls: the footbridge moves up the
  // road until every tile of it is at least 12 from the vale, stand included.
  const close = madeWorld({ wood: { x: 31, y: -30, radius: 25 } });
  const d = lastBridge(close);
  assert.equal(d.dry, true);
  for (const p of tilesOf(d)) {
    assert.ok(close.heartDistance(p.x, p.y) >= 12, `${p.x},${p.y} is ${close.heartDistance(p.x, p.y)} from the vale`);
    assert.equal(close.terrainAt(p.x, p.y), T.ROAD);
  }
  assert.ok(valeDist(d.stand) < Math.min(...d.deck.map(valeDist)), 'its stand still the vale end');
});

test('the Last Bridge is never on a road tile unless it’s the dry footbridge, which stands on the north road', () => {
  for (const { seed, world, bridge: b } of allBridges()) {
    const tiles = [...b.deck, b.stand];
    if (b.dry) {
      for (const p of tiles) assert.equal(world.terrainAt(p.x, p.y), T.ROAD, `${seed}: the footbridge is on the road`);
      const path = world.roads().paths.find((p) => p.from === 'gate:n' && p.to === 'whisperwood');
      assert.ok(path, 'the north road');
    } else {
      for (const p of tiles) {
        assert.ok(![T.ROAD, T.BRIDGE].includes(world.terrainAt(p.x, p.y)), `${seed}: ${p.x},${p.y} isn’t road`);
        assert.ok(!world.roads().tiles.has(`${p.x},${p.y}`), `${seed}: nor under one`);
      }
    }
  }
});

test('its stand is reachable from the vale by nav, in hops of at most 60 tiles, in all 50 worlds', () => {
  let hops = 0;
  for (const { seed, world, bridge: b } of allBridges()) {
    const wilds = createWilds({ worldgen: world, maxChunks: 96 });
    const nav = createNav({ worldgen: world, wildBlocked: wilds.blocked, extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
    assert.ok(nav.walkable(b.stand.x, b.stand.y), `${seed}: nothing grows on the stand`);
    const path = nav.findPath(HOME, b.stand, { maxNodes: 400000, margin: 80 });
    assert.ok(path.length > 0, `${seed}: a way there from home`);
    assert.deepEqual(path.at(-1), b.stand, `${seed}: it arrives`);
    const points = [HOME];
    for (let k = 50; k < path.length; k += 50) points.push(path[k]);
    if (points.at(-1) !== path.at(-1)) points.push(path.at(-1));
    for (let k = 1; k < points.length; k += 1) {
      const [a, c] = [points[k - 1], points[k]];
      assert.ok(Math.abs(a.x - c.x) + Math.abs(a.y - c.y) <= 60, `${seed}: a short hop`);
      const hop = nav.findPath(a, c);
      assert.ok(hop.length > 0 && hop.at(-1).x === c.x && hop.at(-1).y === c.y, `${seed}: the hop ${a.x},${a.y} to ${c.x},${c.y} walks`);
      hops += 1;
    }
  }
  assert.ok(hops >= 100, `${hops} hops walked`);
});

test('no place stands on a bridge: fixed points of interest and the Last Bridge, with its own deck exempt', () => {
  let checked = 0;
  for (const { seed, world, bridge: b } of allBridges()) {
    const deck = new Set(b.deck.map((p) => `${p.x},${p.y}`));
    const isBridge = (x, y) => world.terrainAt(x, y) === T.BRIDGE || deck.has(`${x},${y}`);
    const places = [
      ...world.fixedPois().filter((p) => p.type !== 'quay' && p.region !== 'skyward-isles').map((p) => ({ ...p, id: `${p.type}:${p.x},${p.y}` })),
      { id: LAST_BRIDGE_ID, x: b.stand.x, y: b.stand.y },
    ];
    for (const p of places) {
      for (let dy = -DECK_CLEAR; dy <= DECK_CLEAR; dy += 1) {
        for (let dx = -DECK_CLEAR; dx <= DECK_CLEAR; dx += 1) {
          const x = p.x + dx;
          const y = p.y + dy;
          if (world.inHeart(x, y)) continue;
          // The one named exemption: the Last Bridge's own deck, beside its own stand.
          if (p.id === LAST_BRIDGE_ID && deck.has(`${x},${y}`)) continue;
          assert.ok(!isBridge(x, y), `${seed}: ${p.id} has a bridge at ${x},${y}`);
        }
      }
      checked += 1;
    }
  }
  assert.ok(checked > 1000, `${checked} places checked`);
});

test('worldgen’s golden chunks are unchanged: the bridge is an overlay, read off the world without moving it', () => {
  const b = HUSH_BRIDGE;
  const chunks = new Set();
  for (const p of [...b.deck, b.stand]) {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) chunks.add(`${Math.floor(p.x / CHUNK) + dx},${Math.floor(p.y / CHUNK) + dy}`);
  }
  let compared = 0;
  for (const at of chunks) {
    const want = golden.groups.worldgen[`hushlands:chunk:${at}`];
    if (!want) continue;
    const [cx, cy] = at.split(',').map(Number);
    const c = hush.chunk(cx, cy);
    assert.equal(hashValue({ tiles: c.tiles, pois: c.pois }), want, `hushlands chunk ${at}`);
    compared += 1;
  }
  assert.ok(compared >= 4, `${compared} golden chunks round the bridge`);
  assert.equal(hashValue(hush.fixedPois()), golden.groups.worldgen['hushlands:fixed'], 'no new fixed place');
  assert.ok(!hush.fixedPois().some((p) => /bridge|toll/i.test(`${p.type} ${p.name}`)), 'the bridge isn’t a fixed point of interest');
});

test('the bridge’s landmarks: the bridge, and the Tollkeeper at its stand until he joins', () => {
  const b = HUSH_BRIDGE;
  const both = bridgeLandmarks(b);
  assert.deepEqual(both.map((l) => [l.id, l.kind]), [[LAST_BRIDGE_ID, 'last-bridge'], [TOLLKEEPER_ID, 'tollkeeper']]);
  assert.deepEqual([both[1].x, both[1].y], [b.stand.x, b.stand.y]);
  assert.deepEqual(both[0].deck, b.deck);
  assert.deepEqual(bridgeLandmarks(b, { joined: true }).map((l) => l.id), [LAST_BRIDGE_ID]);
  assert.deepEqual(bridgeLandmarks(null), []);
  for (const l of both) assertTitle(l.label, l.id);
  assert.ok(both.every((l) => l.dry === false), 'hushlands’ bridge is over its river');
});

test('a dry footbridge says so: its landmarks carry dry, and its Examine lines are the ones for a bridge that’s walked', () => {
  const examine = JSON.parse(readFileSync(new URL('../content/examine.json', import.meta.url), 'utf8'));
  const lines = examine.groups.things['last-bridge'];
  assert.equal(bridgeExamineVariant(HUSH_BRIDGE), 'sleeping');
  assert.ok(lines.sleeping.every((l) => /wake/.test(l)), 'over the river it waits for the wood to wake');
  const dry = allBridges().filter((s) => s.bridge.dry);
  assert.ok(dry.length >= 1, 'some worlds have the footbridge');
  for (const { seed, bridge } of dry) {
    assert.ok(bridgeLandmarks(bridge).every((l) => l.dry === true), `${seed}: both landmarks know it’s dry`);
    assert.equal(bridgeExamineVariant(bridge), 'opened', `${seed}: its Examine is the walked footbridge’s`);
    assert.ok(lines.opened.length >= 3 && lines.opened.every((l) => /road/.test(l) && !/won’t|till/.test(l)));
  }
});

test('placeAt names the place a step lands on: the bridge, a gate, a vale place, or nothing', () => {
  const b = HUSH_BRIDGE;
  assert.equal(placeAt(b.stand, { bridge: b }), LAST_BRIDGE_ID);
  assert.equal(placeAt({ x: b.stand.x, y: b.stand.y + 2 }, { bridge: b }), LAST_BRIDGE_ID, 'two tiles from the Tollkeeper counts');
  assert.equal(placeAt({ x: b.stand.x + 5, y: b.stand.y + 5 }, { bridge: b }), null);
  assert.equal(placeAt(b.stand), null, 'without the bridge, just ground');
  for (const [id, g] of Object.entries(GATES)) {
    assert.equal(placeAt({ x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y }), id);
    assert.equal(placeAt(g.edge), id);
  }
  for (const place of PLACES) assert.equal(placeAt({ x: place.area.x, y: place.area.y }), place.id);
  assert.equal(placeAt({ x: 1.5, y: 2 }), null);
  assert.equal(placeAt(null), null);
  for (const id of [LAST_BRIDGE_ID, TOLLKEEPER_ID, 'gate:n', 'camp', 'watchtower', 'war-table']) assert.ok(isPlace(id), id);
  assert.ok(!isPlace('landmark:nowhere'));
});

/* --- progress */

const DAY = Date.UTC(2026, 8, 29, 9, 0);
const MIN = 60000;
const fresh = (extra = {}) => ({ story: { prologue: { done: {} }, trails: {} }, party: { roster: {} }, ...extra });
const cracked = () => fresh({ story: { prologue: { done: { 'first-crack': DAY - 60 * MIN } }, trails: {} } });
const FIRST = trails.trails[0];
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };

test('the first note waits for the crack past the gate to be mended, then turns up in the next chest', () => {
  const before = fresh();
  const early = handOut(before, trails, 'chest', DAY);
  assert.equal(early.state, before, 'a chest before first-crack keeps its note');
  assert.equal(early.trailId, null);
  assert.equal(trailsOpen(before), false);
  const open = deepFreeze(cracked());
  assert.equal(trailsOpen(open), true);
  const found = handOut(open, trails, 'chest', DAY);
  assert.notEqual(found.state, open);
  assert.equal(found.trailId, 'first-trail');
  assert.equal(found.stepId, FIRST.steps[0].id);
  assert.deepEqual(found.state.story.trails['first-trail'], { found: { [FIRST.steps[0].id]: DAY }, done: {}, joinedAt: null });
  assert.equal(handOut(found.state, trails, 'chest', DAY + MIN).state, found.state, 'only the first chest');
  assert.equal(handOut(open, trails, 'bottle', DAY).state, open, 'not from somewhere a note isn’t');
  assert.equal(handOut(open, trails, 'chest', Number.NaN).state, open, 'needs a real time');
});

test('each note is solved by its own feature or visit, in order, and hands over the next one', () => {
  let state = deepFreeze(handOut(cracked(), trails, 'chest', DAY).state);
  const events = FIRST.steps.map((s) => ({ kind: s.solve.kind, target: s.solve.target }));
  // Solving a later step first does nothing: its note hasn't been found.
  assert.equal(stepDone(state, trails, events.at(-1), DAY + MIN), state);
  // Something no step wants does nothing either.
  assert.equal(stepDone(state, trails, { kind: 'feature', target: 'map' }, DAY + MIN), state);
  assert.equal(stepDone(state, trails, { kind: 'shout', target: 'kindle' }, DAY + MIN), state);
  assert.equal(stepDone(state, trails, null, DAY + MIN), state);
  events.forEach((event, i) => {
    const at = DAY + (i + 1) * 10 * MIN;
    const next = stepDone(state, trails, event, at);
    assert.notEqual(next, state, `step ${i + 1} solved`);
    const saved = next.story.trails['first-trail'];
    assert.equal(saved.done[FIRST.steps[i].id], at);
    if (FIRST.steps[i + 1]) assert.equal(saved.found[FIRST.steps[i + 1].id], at, 'the next note is handed over');
    assert.equal(stepDone(next, trails, event, at + MIN), next, 'solving it again changes nothing');
    state = deepFreeze(next);
  });
  const view = trailView(state, trails, DAY + DAY);
  assert.equal(view.done, true);
  assert.equal(view.atBridge, true, 'the Tollkeeper waits at the bridge');
  assert.equal(view.step, null);
  assert.equal(view.steps.length, FIRST.steps.length);
  assert.ok(view.steps.every((s) => s.done));
  // He joins: the trail records it once, and the bridge no longer waits.
  const joined = markJoined(state, trails, 'tollkeeper', DAY + DAY);
  assert.equal(joined.story.trails['first-trail'].joinedAt, DAY + DAY);
  assert.equal(markJoined(joined, trails, 'tollkeeper', DAY + DAY + MIN), joined);
  assert.equal(markJoined(state, trails, 'nobody', DAY), state);
  assert.equal(trailView(joined, trails, DAY).atBridge, false);
  // A Tollkeeper already in the roster counts as joined too.
  const roster = { ...state, party: { roster: { tollkeeper: { joinedAt: DAY } } } };
  assert.equal(trailView(roster, trails, DAY).atBridge, false);
});

test('the trail view shows the notes found so far, never the ones still to come', () => {
  assert.deepEqual(trailView(fresh(), trails, DAY), { trail: null, step: null, steps: [], done: false, atBridge: false });
  const state = handOut(cracked(), trails, 'chest', DAY).state;
  const view = trailView(state, trails, DAY);
  assert.deepEqual(view.trail, { id: 'first-trail', title: FIRST.title, tier: 'easy', tierName: 'Birch-bark', from: 'Tamsin' });
  assert.equal(view.steps.length, 1, 'only the first note');
  assert.deepEqual(view.steps[0], { id: FIRST.steps[0].id, riddle: FIRST.steps[0].riddle, sign: '— T.', hint: FIRST.steps[0].hint, done: false });
  assert.deepEqual(view.step, {
    id: FIRST.steps[0].id, riddle: FIRST.steps[0].riddle, sign: '— T.', hint: FIRST.steps[0].hint, kind: 'feature', target: 'kindle', foundAt: DAY,
  });
  assert.equal(view.done, false);
  assert.equal(view.atBridge, false);
  const after = stepDone(state, trails, { kind: 'feature', target: 'kindle' }, DAY + 50 * MIN);
  const two = trailView(after, trails, DAY + 50 * MIN);
  assert.deepEqual(two.steps.map((s) => [s.id, s.done]), [[FIRST.steps[0].id, true], [FIRST.steps[1].id, false]]);
  assert.equal(two.step.id, FIRST.steps[1].id);
  assert.deepEqual(trailView(after, trails, DAY), two, 'the same view whatever the time');
});

test('a later note found in a chest waits for the step before it, and the view moves on to the next unfinished trail', () => {
  const two = {
    tiers: trails.tiers,
    trails: [
      { id: 'a', tier: 'easy', title: 'A', steps: [
        { id: 'a-1', found: 'chest', riddle: ['One.'], sign: '— T.', solve: { kind: 'feature', target: 'map' }, hint: 'Map.' },
        { id: 'a-2', found: 'chest', riddle: ['Two.'], sign: '— T.', solve: { kind: 'feature', target: 'skills' }, hint: 'Skills.' },
      ] },
      { id: 'b', tier: 'medium', title: 'B', steps: [
        { id: 'b-1', found: 'chest', riddle: ['Three.'], sign: '— T.', solve: { kind: 'feature', target: 'muster' }, hint: 'Muster.' },
      ] },
    ],
  };
  let state = handOut(cracked(), two, 'chest', DAY).state;
  assert.deepEqual(Object.keys(state.story.trails), ['a']);
  // The next chest: a-2 waits for a-1, so it's b's first note that turns up.
  const second = handOut(state, two, 'chest', DAY + MIN);
  assert.deepEqual([second.trailId, second.stepId], ['b', 'b-1']);
  state = stepDone(second.state, two, { kind: 'feature', target: 'map' }, DAY + 2 * MIN);
  assert.equal(state.story.trails.a.found['a-2'], undefined, 'a chest note isn’t handed over, it’s found');
  const third = handOut(state, two, 'chest', DAY + 3 * MIN);
  assert.deepEqual([third.trailId, third.stepId], ['a', 'a-2']);
  state = stepDone(third.state, two, { kind: 'feature', target: 'skills' }, DAY + 4 * MIN);
  assert.equal(trailView(state, two, DAY).trail.id, 'b', 'a is finished (no companion to wait for), so the view shows b');
  state = stepDone(state, two, { kind: 'feature', target: 'muster' }, DAY + 5 * MIN);
  assert.equal(trailView(state, two, DAY).trail.id, 'b', 'everything done: the last one started');
  assert.equal(trailView(state, two, DAY).atBridge, false, 'no bridge at the end of these');
});

/* --- §18.2 item 13: markJoined is the one writer of story.trails[…].joinedAt, and C's recruit calls it */

test('markJoined records the join once, however C’s recruit hands it the trails: trails.json, the content bundle, or nothing', () => {
  // TRAIL_JOINS is trails.json's end.joins turned round, so recruit without content marks the same trail.
  const joins = Object.fromEntries(trails.trails.filter((t) => typeof t.end?.joins === 'string').map((t) => [t.end.joins, t.id]));
  assert.deepEqual({ ...TRAIL_JOINS }, joins);
  const at = DAY + 0.6;
  const want = { found: {}, done: {}, joinedAt: Math.round(at) };
  for (const given of [trails, { trails }, null, undefined]) {
    const state = deepFreeze(fresh());
    const joined = markJoined(state, given, 'tollkeeper', at);
    assert.deepEqual(joined.story.trails, { 'first-trail': want }, `given ${given === trails ? 'trails.json' : given ? 'the bundle' : String(given)}`);
    assert.equal(markJoined(joined, given, 'tollkeeper', at + MIN), joined, 'once');
    assert.equal(markJoined(state, given, 'claude', at), state, 'a founder joins no trail');
  }
  // With trails in hand it reads them, never the fallback: here the only trail ends with someone else.
  const other = { trails: [{ ...FIRST, id: 'second-trail', end: { ...FIRST.end, joins: 'someone' } }] };
  const plain = fresh();
  assert.equal(markJoined(plain, other, 'tollkeeper', DAY), plain, 'no trail there ends with him');
  assert.deepEqual(markJoined(plain, other, 'someone', DAY).story.trails, { 'second-trail': { found: {}, done: {}, joinedAt: DAY } });
  // Only a real time: never 0, a negative, NaN or a string, which A's cleaner would read as never.
  for (const bad of [0, -5, Number.NaN, '1', null]) assert.equal(markJoined(plain, trails, 'tollkeeper', bad), plain, String(bad));
});

test('handOut and stepDone never write a join: a saved joinedAt stays exactly as it was, and a new trail starts at null', () => {
  const walk = (start) => {
    const seen = [];
    let state = handOut(start, trails, 'chest', DAY).state;
    seen.push(state.story.trails['first-trail'].joinedAt);
    FIRST.steps.forEach((s, i) => {
      state = stepDone(state, trails, { kind: s.solve.kind, target: s.solve.target }, DAY + (i + 1) * MIN);
      seen.push(state.story.trails['first-trail'].joinedAt);
    });
    return { state, seen };
  };
  assert.deepEqual(walk(cracked()).seen, Array(FIRST.steps.length + 1).fill(null), 'no join until markJoined');
  // A join already saved (even one A's cleaner would drop) is carried through untouched.
  for (const saved of [DAY - MIN, 'soon']) {
    const start = cracked();
    start.story.trails['first-trail'] = { found: {}, done: {}, joinedAt: saved };
    const { state, seen } = walk(start);
    assert.deepEqual(seen, Array(FIRST.steps.length + 1).fill(saved), `joinedAt ${String(saved)} is kept`);
    assert.equal(Object.keys(state.story.trails['first-trail']).join(), 'found,done,joinedAt');
  }
  // The source agrees: in trail.js only markJoined hands withProgress a joinedAt.
  const src = readFileSync(new URL('../src/world/trail.js', import.meta.url), 'utf8');
  const writers = [...src.matchAll(/withProgress\([^;]*joinedAt[^;]*\);/g)].map((m) => m[0]);
  assert.equal(writers.length, 1, writers.join('\n'));
  assert.match(writers[0], /joinedAt: Math\.round\(now\)/);
  const body = src.slice(src.indexOf('export function markJoined'), src.indexOf('export function trailView'));
  assert.ok(body.includes(writers[0]), 'and that one is in markJoined');
});

const A_STATE = new URL('../src/state4.js', import.meta.url);
test('what markJoined writes comes back unchanged from A’s cleaner', { skip: !existsSync(A_STATE) && 'src/state4.js isn’t written yet' }, async () => {
  const { cleanStory4 } = await import('../src/state4.js');
  let state = handOut(cracked(), trails, 'chest', DAY).state;
  FIRST.steps.forEach((s, i) => { state = stepDone(state, trails, { kind: s.solve.kind, target: s.solve.target }, DAY + (i + 1) * MIN); });
  for (const s of [state, fresh()]) {
    const joined = markJoined(s, trails, 'tollkeeper', DAY + DAY + 0.4);
    const clean = cleanStory4(JSON.parse(JSON.stringify(joined.story)));
    assert.deepEqual(clean.trails, joined.story.trails);
  }
});

const C_PARTY = new URL('../src/party.js', import.meta.url);
test('C’s recruit marks the Tollkeeper’s trail exactly as markJoined does', { skip: !existsSync(C_PARTY) && 'src/party.js isn’t written yet' }, async () => {
  // §18.2 item 13: recruit calls markJoined, so the two can never disagree about the join.
  const { recruit } = await import('../src/party.js');
  let done = handOut(cracked(), trails, 'chest', DAY).state;
  FIRST.steps.forEach((s, i) => { done = stepDone(done, trails, { kind: s.solve.kind, target: s.solve.target }, DAY + (i + 1) * MIN); });
  const already = { ...done, story: { ...done.story, trails: { 'first-trail': { ...done.story.trails['first-trail'], joinedAt: DAY } } } };
  for (const start of [done, fresh(), already]) {
    const state = deepFreeze(JSON.parse(JSON.stringify(start)));
    const now = DAY + DAY;
    const byRecruit = recruit(state, 'tollkeeper', now);
    assert.ok(byRecruit.party.roster.tollkeeper, 'he joins the roster');
    assert.deepEqual(byRecruit.story.trails, markJoined(state, trails, 'tollkeeper', now).story.trails);
    assert.deepEqual(byRecruit.story.trails, markJoined(state, null, 'tollkeeper', now).story.trails);
  }
});

test('the progress functions are pure: they never change their input, and junk in gives the state back', () => {
  const state = deepFreeze(cracked());
  assert.doesNotThrow(() => handOut(state, trails, 'chest', DAY));
  for (const bad of [null, 'x', 42]) {
    assert.equal(stepDone(bad, trails, { kind: 'feature', target: 'kindle' }, DAY), bad);
    assert.equal(markJoined(bad, trails, 'tollkeeper', DAY), bad);
    assert.equal(handOut(bad, trails, 'chest', DAY).state, bad);
  }
  assert.equal(stepDone(state, null, { kind: 'feature', target: 'kindle' }, DAY), state);
  assert.equal(stepDone(state, { trails: 'nope' }, { kind: 'feature', target: 'kindle' }, DAY), state);
  assert.deepEqual(trailView(null, trails, DAY).steps, []);
  // A saved trail with junk in it doesn't throw.
  const junk = { ...state, story: { ...state.story, trails: { 'first-trail': { found: 'x', done: [1], joinedAt: 'soon' } } } };
  assert.doesNotThrow(() => trailView(junk, trails, DAY));
  assert.doesNotThrow(() => stepDone(junk, trails, { kind: 'feature', target: 'kindle' }, DAY));
});

test('every visit target a step may name is one placeAt returns for some tile, and every place placeAt returns may be visited', () => {
  // Every tile in and round the vale, and round the Last Bridge (with it), as onSceneStep would see them.
  const returned = new Set();
  for (let y = -4; y < MAP.height + 4; y += 1) for (let x = -4; x < MAP.width + 4; x += 1) returned.add(placeAt({ x, y }));
  const b = HUSH_BRIDGE;
  for (let y = b.stand.y - 4; y <= b.stand.y + 4; y += 1) for (let x = b.stand.x - 6; x <= b.stand.x + 6; x += 1) returned.add(placeAt({ x, y }, { bridge: b }));
  returned.delete(null);
  // Every id anything could name as a place: vale places and their kinds, the gates, the landmarks.
  const named = new Set([...PLACES.map((p) => p.id), ...PLACES.map((p) => p.kind), ...Object.keys(GATES), LAST_BRIDGE_ID, TOLLKEEPER_ID,
    'war-table', 'watchtower', 'plot', 'building', 'hook', 'bell', 'campfire', 'landmark:nowhere']);
  for (const id of named) {
    if (solveKnown({ kind: 'visit', target: id })) assert.ok(returned.has(id), `a visit to ${id} can be done: some tile is ${id}`);
  }
  for (const id of returned) assert.ok(solveKnown({ kind: 'visit', target: id }), `${id} can be named by a visit step`);
  assert.ok(returned.has(LAST_BRIDGE_ID) && returned.has('gate:n'));
});

test('steps know their kinds and targets: every FEATURES id and a real place pass, anything else doesn’t', () => {
  assert.deepEqual([...STEP_KINDS], ['feature', 'visit', 'examine', 'read']);
  for (const id of FEATURES) assert.ok(solveKnown({ kind: 'feature', target: id }), id);
  assert.ok(solveKnown({ kind: 'visit', target: LAST_BRIDGE_ID }));
  assert.ok(solveKnown({ kind: 'examine', target: 'watchtower' }));
  // The War Table and the Tollkeeper are things to examine, never places to stand: no tile is either.
  for (const id of ['war-table', TOLLKEEPER_ID]) {
    assert.ok(solveKnown({ kind: 'examine', target: id }), `examine ${id}`);
    assert.ok(!solveKnown({ kind: 'visit', target: id }), `visit ${id} could never be done`);
    assert.ok(isPlace(id) && !isVisitPlace(id), id);
  }
  assert.ok(solveKnown({ kind: 'read', target: 'tablet' }));
  assert.ok(!solveKnown({ kind: 'read', target: 'the-sky' }));
  assert.ok(!solveKnown({ kind: 'visit', target: 'kindle' }));
  assert.ok(!solveKnown(null));
});

test('the world modules are pure: no clock, no randomness and no DOM in trail, caves or fieldboss', () => {
  for (const name of ['trail', 'caves', 'fieldboss']) {
    const src = readFileSync(new URL(`../src/world/${name}.js`, import.meta.url), 'utf8')
      .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    for (const banned of [/Date\.now\s*\(/, /Math\.random\s*\(/, /performance\.now\s*\(/, /\bdocument\./, /\bwindow\./, /new Date\s*\(/]) {
      assert.ok(!banned.test(src), `${name}.js avoids ${banned}`);
    }
    assert.ok(src.split('\n').length <= 1500, `${name}.js stays under 1,500 lines`);
  }
});
