// The wilds beyond Hearthvale and walking through them (CONTRACT-PHASE3.md §3, §7.1, §9 E, §10):
// src/world/wilds.js and src/world/nav.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP, TERRAIN as VT, isWalkable as mapWalkable, findPath as mapFindPath, coastAt, naturalAt } from '../src/world/map.js';
import { PALETTE, SPRITES } from '../src/world/sprites.js';
import { createWorldgen, CHUNK, GATES, HEART, TERRAIN, TERRAIN_INFO, MIN_WATER, isBayRing } from '../src/world/worldgen.js';
import { basePaletteByCode, byCode } from '../src/world/wildsart.js';
import { createWilds, ringKind, ringDetours, hushPalette, colouriseChunk, CHUNK_PX } from '../src/world/wilds.js';
import { createNav, valeStepCost } from '../src/world/nav.js';

const T = TERRAIN;
const words = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
const wilds = createWilds({ worldgen, maxChunks: 600 });
const nav = createNav({ worldgen, wildBlocked: wilds.blocked });
const HOME = MAP.miloHome;
const inHeart = (x, y) => x >= 0 && y >= 0 && x < HEART.w && y < HEART.h;
const GATE_TILES = Object.entries(GATES).map(([id, g]) => ({ id, x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y, dir: g.dir }));
const isGate = (x, y) => GATE_TILES.some((g) => g.x === x && g.y === y);
const beyondGate = new Set(GATE_TILES.flatMap((g) => [1, 2, 3].map((k) => `${g.x + g.dir.x * k},${g.y + g.dir.y * k}`)));
const roadish = (t) => t === T.ROAD || t === T.BRIDGE;
const onRing = (x, y) => x >= -1 && y >= -1 && x <= HEART.w && y <= HEART.h && !inHeart(x, y);
const KNOWN_KINDS = new Set([
  'tree', 'tree.blossom', 'tree.birch', 'pine', 'pine.snow', 'bush', 'bush.berry', 'rock', 'rock.basalt', 'basalt.column', 'dice.stone', 'reeds',
  'crag', 'crag.snow', 'lantern.post', 'landmark.stone', 'statue', 'ruin', 'cave', 'chest', 'chest.mimic', 'note', 'hamlet', 'ore.node', 'herbs',
  'fishing.spot', 'boat',
]);
const TREES = new Set(['tree', 'tree.blossom', 'tree.birch', 'pine', 'pine.snow']);
const BLOCKING = new Set(['tree', 'tree.blossom', 'tree.birch', 'pine', 'pine.snow', 'rock', 'rock.basalt', 'basalt.column', 'dice.stone', 'crag', 'crag.snow', 'hamlet', 'ruin', 'statue']);
const NEVER_BLOCKING = new Set(['reeds', 'note', 'fishing.spot', 'herbs', 'boat']);

// An area round the vale and out to several regions, generated once and shared by the tests.
const AREA = { cx0: -5, cy0: -5, cx1: 5, cy1: 5 };
const areaChunks = [];
for (let cy = AREA.cy0; cy <= AREA.cy1; cy += 1) for (let cx = AREA.cx0; cx <= AREA.cx1; cx += 1) areaChunks.push(wilds.chunk(cx, cy));
const regionChunks = ['cinderforge', 'archive-peaks', 'glass-fen', 'painted-hills', 'dicing-downs', 'whisperwood', 'mistmere', 'greyreach']
  .map((id) => worldgen.anchorById[id]).map((a) => wilds.chunk(Math.floor(a.x / CHUNK), Math.floor(a.y / CHUNK)));
const allObjects = () => [...areaChunks, ...regionChunks].flatMap((c) => c.objects.map((o) => ({ o, c })));
// The ground's palette key at any world pixel (painting its chunk first).
function groundKey(px, py) {
  const cx = Math.floor(px / CHUNK_PX);
  const cy = Math.floor(py / CHUNK_PX);
  wilds.ground(cx, cy);
  return wilds.chunk(cx, cy).ground[(py - cy * CHUNK_PX) * CHUNK_PX + (px - cx * CHUNK_PX)];
}

function assertCalm(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.ok(!text.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji: ${text}`);
  const first = text.match(/\p{L}/u);
  if (first) assert.equal(first[0], first[0].toUpperCase(), `${where} starts with a capital: ${text}`);
}

// ---------- the ring and the gates ----------

test('the ring round the vale is walls with four gates, and walls never open', () => {
  let walls = 0;
  for (let x = -1; x <= HEART.w; x += 1) {
    for (let y = -1; y <= HEART.h; y += 1) {
      const kind = ringKind(x, y);
      if (inHeart(x, y)) { assert.equal(kind, null, `${x},${y} is the vale`); continue; }
      assert.equal(kind, isGate(x, y) ? 'gate' : 'wall', `${x},${y}`);
      if (kind === 'wall') {
        walls += 1;
        assert.equal(nav.walkable(x, y), false, `wall ${x},${y} never walkable`);
        assert.equal(wilds.blocked(x, y), true, `wall ${x},${y} is blocked`);
      } else assert.equal(nav.walkable(x, y), true, `gate ${x},${y} always walkable`);
    }
  }
  assert.equal(walls, 2 * (HEART.w + 2) + 2 * HEART.h - 4);
  assert.deepEqual(GATE_TILES.map((g) => [g.x, g.y]).sort(), [[-1, 20], [11, 44], [32, -1], [64, 14]].sort());
  for (const [x, y] of [[-2, -2], [65, 0], [0, 45], [-1, -2], [100, 100]]) assert.equal(ringKind(x, y), null, `${x},${y} is past the ring`);
  // a gate stays open even with something said to stand on it
  const stubborn = createNav({ worldgen, wildBlocked: () => true, extraBlocked: () => true });
  for (const g of GATE_TILES) assert.equal(stubborn.walkable(g.x, g.y), true, g.id);
});

test('inside the vale nav keeps the map’s own rules and costs', () => {
  for (let y = 0; y < MAP.height; y += 1) {
    for (let x = 0; x < MAP.width; x += 1) {
      assert.equal(nav.walkable(x, y), mapWalkable(x, y), `${x},${y}`);
      if (mapWalkable(x, y)) assert.equal(nav.cost(x, y), valeStepCost(x, y));
    }
  }
  // map.findPath and nav.findPath agree on cost inside the vale
  const pathCost = (path) => path.reduce((sum, p) => sum + valeStepCost(p.x, p.y), 0);
  for (const place of [{ x: 31, y: 10 }, { x: 48, y: 20 }, { x: 15, y: 21 }, { x: 17, y: 30 }, { x: 50, y: 33 }]) {
    const a = mapFindPath(HOME, place);
    const b = nav.findPath(HOME, place);
    assert.ok(b.length > 0, `reaches ${place.x},${place.y}`);
    assert.ok(Math.abs(pathCost(a) - pathCost(b)) < 0.01, `same cost to ${place.x},${place.y}`);
  }
  // vale-only nav (no wilds): nothing outside the heart, not even the gates
  const valeOnly = createNav();
  assert.equal(valeOnly.walkable(32, -1), false);
  assert.equal(valeOnly.walkable(31, 22), true);
  assert.deepEqual(valeOnly.findPath(HOME, { x: 32, y: -5 }), []);
});

test('Milo walks out of each gate and back, and never crosses the ring anywhere else', () => {
  for (const g of GATE_TILES) {
    const out = { x: g.x + g.dir.x * 4, y: g.y + g.dir.y * 4 };
    const path = nav.findPath(HOME, out);
    assert.ok(path.length > 0, `${g.id}: a way out`);
    assert.deepEqual(path.at(-1), out, `${g.id}: arrives`);
    assert.ok(path.some((p) => p.x === g.x && p.y === g.y), `${g.id}: through its gate`);
    let prev = HOME;
    for (const p of path) {
      assert.equal(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y), 1, 'four-way steps');
      assert.ok(nav.walkable(p.x, p.y), `${p.x},${p.y} walkable`);
      if (onRing(p.x, p.y)) assert.ok(isGate(p.x, p.y), `${g.id}: crosses the ring only at a gate`);
      prev = p;
    }
    const back = nav.findPath(out, HOME);
    assert.deepEqual(back.at(-1), HOME, `${g.id}: home again`);
  }
  // The only ring tiles reachable from home are the four gates.
  const seen = new Set([`${HOME.x},${HOME.y}`]);
  const queue = [HOME];
  const ringReached = new Set();
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k) || !nav.walkable(nx, ny)) continue;
      if (onRing(nx, ny)) { ringReached.add(k); continue; } // stop at the ring: we only ask how the vale meets it
      if (!inHeart(nx, ny)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  assert.deepEqual([...ringReached].sort(), GATE_TILES.map((g) => `${g.x},${g.y}`).sort());
});

test('the ring holds a thicket on land at tier 1 and the Stockade from tier 2, gatehouses at every gate', () => {
  const one = wilds.ringObjects(1);
  const two = wilds.ringObjects(2);
  assert.deepEqual(wilds.ringObjects(1), one, 'deterministic');
  for (const o of one) {
    assert.equal(o.kind, 'thicket');
    assert.equal(ringKind(o.x, o.y), 'wall', 'thickets only on walls');
    const t = wilds.terrainAt(o.x, o.y);
    assert.ok(![T.DEEP, T.SEA, T.RIVER, T.BRIDGE].includes(t), `no thicket over water at ${o.x},${o.y}`);
    assert.ok(o.frame === 0 || o.frame === 1);
    assert.ok(o.mask && typeof o.mask.n === 'boolean');
  }
  const pieces = two.filter((o) => o.kind === 'palisade' || o.kind === 'palisade.jamb');
  const byTile = new Map(pieces.map((o) => [`${o.x},${o.y}`, o]));
  assert.equal(byTile.size, one.length, 'a piece of palisade where each thicket stood');
  // The wall just south of the west and east gates ends low in the jamb, so the side-on gateway
  // stays open (sprites.js); everywhere else the palisade autotiles.
  const jambs = pieces.filter((o) => o.kind === 'palisade.jamb').map((o) => `${o.x},${o.y}`).sort();
  assert.deepEqual(jambs, GATE_TILES.filter((g) => g.dir.x !== 0).map((g) => `${g.x},${g.y + 1}`).sort());
  for (const o of [...one, ...pieces]) {
    // masks join wall to wall and never into a gate, which is the opening
    for (const [side, dx, dy] of [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]]) {
      const k = `${o.x + dx},${o.y + dy}`;
      if (isGate(o.x + dx, o.y + dy)) assert.equal(o.mask[side], false, `${o.id} doesn't join into the gate`);
      else assert.equal(o.mask[side], byTile.has(k), `${o.id} ${side} joins exactly its neighbouring wall`);
    }
  }
  const gatehouses = two.filter((o) => o.kind === 'gatehouse');
  assert.deepEqual(gatehouses.map((o) => `${o.x},${o.y}`).sort(), GATE_TILES.map((g) => `${g.x},${g.y}`).sort());
  assert.ok(gatehouses.every((o) => !o.blocks), 'gatehouses never shut a gate');
  for (const o of gatehouses) assert.equal(o.frame, o.side === 'w' || o.side === 'e' ? 1 : 0, `${o.id} faces the right way`);
  const war = two.find((o) => o.id === 'war-table');
  assert.ok(war && war.kind === 'war.table' && war.blocks, 'the war table stands at tier 2');
  assert.ok(!one.some((o) => o.id === 'war-table'), 'and not at tier 1');
  for (let x = war.x; x < war.x + war.w; x += 1) {
    assert.ok(!inHeart(x, war.y) && !onRing(x, war.y), 'outside the vale');
    assert.ok(!roadish(wilds.terrainAt(x, war.y)), 'not on the road');
    assert.ok(!beyondGate.has(`${x},${war.y}`), 'not in the gate’s way');
    assert.ok(!wilds.blocked(x, war.y), 'no prop under it');
    assert.equal(wilds.ringBlocked(x, war.y, 2), true);
    assert.equal(wilds.ringBlocked(x, war.y, 1), false);
  }
  assert.ok(Math.hypot(war.x - 32, war.y + 1) < 8, 'by the north gatehouse');
  const withTable = createNav({ worldgen, wildBlocked: wilds.blocked, extraBlocked: (x, y) => wilds.ringBlocked(x, y, 2) });
  const approach = withTable.findPath(HOME, { x: war.x, y: war.y });
  assert.ok(approach.length > 0, 'Milo can walk up to it');
  assert.ok(Math.abs(approach.at(-1).x - war.x) + Math.abs(approach.at(-1).y - war.y) <= 2);
});

// ---------- determinism ----------

test('the same seed makes the same wilds, ground and all; another seed makes other wilds', () => {
  const again = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: words.regionWords }) });
  for (const [cx, cy] of [[1, -1], [-1, 0], [0, 1], [-4, 0], [3, 3], [-2, 6]]) {
    const a = wilds.chunk(cx, cy);
    const b = again.chunk(cx, cy);
    assert.deepEqual(b.tiles, a.tiles, `tiles ${cx},${cy}`);
    assert.deepEqual(b.objects, a.objects, `objects ${cx},${cy}`);
    assert.deepEqual(b.pois, a.pois, `pois ${cx},${cy}`);
    assert.deepEqual(b.hush, a.hush, `hush ${cx},${cy}`);
    wilds.ground(cx, cy);
    // the other one painted in uneven slices, out of order: the same pixels
    for (const [from, to] of [[300, 364], [0, 64], [64, 128], [128, 300], [364, 512]]) again.ground(cx, cy, { from, to });
    assert.equal(again.chunk(cx, cy).groundRows, CHUNK_PX);
    assert.ok(Buffer.from(b.ground).equals(Buffer.from(a.ground)), `ground ${cx},${cy}`);
  }
  assert.deepEqual(again.ringObjects(2), wilds.ringObjects(2));
  const other = createWilds({ worldgen: createWorldgen({ seed: 'another story', regionWords: words.regionWords }) });
  let differ = 0;
  for (let cx = -4; cx < 4; cx += 1) {
    const a = JSON.stringify(wilds.chunk(cx, -3).objects.map((o) => [o.kind, o.x, o.y]));
    const b = JSON.stringify(other.chunk(cx, -3).objects.map((o) => [o.kind, o.x, o.y]));
    if (a !== b) differ += 1;
  }
  assert.ok(differ >= 6, `${differ} of 8 chunks differ`);
});

test('a chunk never depends on which of its neighbours happen to be cached', () => {
  const fen = worldgen.anchorById['glass-fen'];
  const spots = [[1, -1], [-1, 0], [Math.floor(fen.x / CHUNK), Math.floor(fen.y / CHUNK)], [-4, 0], [3, -4]];
  for (const [cx, cy] of spots) {
    const alone = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: words.regionWords }) });
    const crowded = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: words.regionWords }) });
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) { crowded.chunk(cx + dx, cy + dy); crowded.ground(cx + dx, cy + dy); }
    const a = alone.chunk(cx, cy);
    const b = crowded.chunk(cx, cy);
    assert.deepEqual(b.objects, a.objects, `objects ${cx},${cy}`);
    alone.ground(cx, cy);
    crowded.ground(cx, cy);
    assert.ok(Buffer.from(a.ground).equals(Buffer.from(b.ground)), `ground ${cx},${cy}`);
  }
});

test('chunks are cached, dropped and listed nearest first', () => {
  const small = createWilds({ worldgen, maxChunks: 4 });
  const first = small.chunk(10, 10);
  assert.equal(small.chunk(10, 10), first, 'cached');
  for (let i = 0; i < 6; i += 1) small.chunk(20 + i, 10);
  assert.ok(small.cached().length <= 4, 'at most maxChunks kept');
  assert.notEqual(small.chunk(10, 10), first, 'evicted, then made again');
  assert.deepEqual(small.chunk(10, 10).objects, first.objects, 'identically');
  assert.equal(small.drop(10, 10), true);
  assert.ok(!small.cached().includes('10,10'));
  const keys = wilds.keysAround({ x: 40, y: -5 }, 1);
  assert.equal(keys.length, 9);
  assert.equal(keys[0], '1,-1', 'the chunk Milo stands in first');
  assert.deepEqual(new Set(keys), new Set(['0,-2', '1,-2', '2,-2', '0,-1', '1,-1', '2,-1', '0,0', '1,0', '2,0']));
  assert.equal(wilds.keysAround({ x: 0, y: 0 }, 2).length, 25);
});

// ---------- objects ----------

test('no objects on roads, bridges, the ring, the gates’ way, the vale or points of interest', () => {
  const poiTiles = new Set();
  for (const c of [...areaChunks, ...regionChunks]) for (const p of c.pois) poiTiles.add(`${p.x},${p.y}`);
  for (const p of wilds.fixedPois()) poiTiles.add(`${p.x},${p.y}`);
  let count = 0;
  let fallbacks = 0;
  for (const { o, c } of allObjects()) {
    count += 1;
    assert.ok(KNOWN_KINDS.has(o.kind), `known kind ${o.kind}`);
    assert.ok(o.id && Number.isInteger(o.x) && Number.isInteger(o.y) && o.w >= 1 && o.h >= 1, `${o.id} shape`);
    assert.ok(Number.isInteger(o.dx) && Number.isInteger(o.dy) && typeof o.blocks === 'boolean');
    const x0 = c.cx * CHUNK;
    const y0 = c.cy * CHUNK;
    assert.ok(o.x >= x0 && o.y >= y0 && o.x + o.w <= x0 + CHUNK && o.y + o.h <= y0 + CHUNK, `${o.id} inside its chunk`);
    const onItsTile = /^(poi|lantern):/.test(o.place || '') && o.place.endsWith(`:${o.x},${o.y}`);
    if (BLOCKING.has(o.kind) && !onItsTile) assert.equal(o.blocks, true, `${o.kind} blocks`);
    if (onItsTile && o.kind !== 'note') fallbacks += 1; // a note is paper under a stone; on its own tile is natural
    if (NEVER_BLOCKING.has(o.kind)) assert.equal(o.blocks, false, `${o.kind} doesn't block`);
    const ownPoi = o.place && o.place.startsWith('poi:') || o.place && o.place.startsWith('lantern:');
    for (let y = o.y; y < o.y + o.h; y += 1) {
      for (let x = o.x; x < o.x + o.w; x += 1) {
        const k = `${x},${y}`;
        assert.ok(!inHeart(x, y) && !onRing(x, y), `${o.id} outside the vale and its ring`);
        assert.ok(!beyondGate.has(k), `${o.id} not in a gate's way`);
        const t = wilds.terrainAt(x, y);
        if (o.kind === 'boat') { assert.ok([T.SEA, T.DEEP, T.RIVER].includes(t), 'the boat floats'); continue; }
        const onOwnTile = ownPoi && poiTiles.has(k) && (o.place.endsWith(`:${x},${y}`));
        if (onOwnTile) {
          assert.equal(o.blocks, false, `${o.id}: a prop on its own tile never blocks`);
          continue;
        }
        assert.ok(!roadish(t), `${o.id} (${o.kind}) not on a road or bridge at ${k}`);
        assert.ok(!poiTiles.has(k), `${o.id} not on a point of interest`);
        if (!ownPoi) {
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) assert.ok(!poiTiles.has(`${x + dx},${y + dy}`), `${o.id} not beside a point of interest`);
        }
      }
    }
    if (TREES.has(o.kind)) {
      assert.ok(Math.abs(o.dx) <= 4 && Math.abs(o.dy) <= 2, 'tree jitter dx ±4, dy ±2');
      // canopies (about two tiles tall) stay off roads
      for (let d = -1; d <= 1; d += 1) for (let k = 1; k <= 2; k += 1) assert.ok(!roadish(wilds.terrainAt(o.x + d, o.y - k)), `${o.id} canopy off the road`);
      assert.equal(o.id, `tree:${o.x},${o.y}`);
      assert.ok(['birch', 'ash', 'pine'].includes(o.wood));
    }
  }
  assert.ok(count > 3000, `${count} objects checked`);
  assert.ok(fallbacks <= 2, `${fallbacks} props had no room beside their tile`);
  // a point of interest's own tile never blocks, so Milo can stand at it
  for (const c of [...areaChunks, ...regionChunks]) for (const p of c.pois) assert.equal(wilds.blocked(p.x, p.y), false, `${p.id} stands clear`);
});

test('no two trees stand within a tile, even across chunk edges, and forests are dense', () => {
  const trees = new Map();
  for (const { o } of allObjects()) if (TREES.has(o.kind)) trees.set(`${o.x},${o.y}`, o);
  for (const o of trees.values()) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx || dy) assert.ok(!trees.has(`${o.x + dx},${o.y + dy}`), `${o.id} has room`);
      }
    }
  }
  // Blocking props are never side by side either (so they can't wall a way off).
  const blockers = new Map();
  for (const { o } of allObjects()) if (o.blocks && !o.kind.startsWith('crag') && !o.place) blockers.set(`${o.x},${o.y}`, o);
  for (const o of blockers.values()) {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) assert.ok(!blockers.has(`${o.x + dx},${o.y + dy}`), `${o.id} stands apart`);
  }
  // How much of each wood holds a tree. With no two trees within a tile, a quarter of the tiles is
  // the most there can ever be (one tree to each 2x2); the vale's own groves hold 18-24%. The wilds
  // roll a tree on most wood tiles (80% forest, 78% birch, 92% pine) and space them in three
  // rounds, which comes to about a sixth. The contract's "about 45%" and "about 50%" can't be
  // tree coverage under the spacing rule (see the module's report).
  const woods = { [T.FOREST]: [0, 0], [T.BIRCH]: [0, 0], [T.PINE]: [0, 0] };
  for (const c of [...areaChunks, ...regionChunks]) {
    const occupied = new Set(c.objects.filter((o) => TREES.has(o.kind)).map((o) => `${o.x},${o.y}`));
    for (let j = 0; j < CHUNK; j += 1) {
      for (let i = 0; i < CHUNK; i += 1) {
        const w = woods[c.tiles[j * CHUNK + i]];
        if (!w) continue;
        w[0] += 1;
        if (occupied.has(`${c.cx * CHUNK + i},${c.cy * CHUNK + j}`)) w[1] += 1;
      }
    }
  }
  for (const [t, [tiles, trees]] of Object.entries(woods)) {
    assert.ok(tiles > 400, `${tiles} tiles of wood ${t} sampled`);
    const share = trees / tiles;
    assert.ok(share >= 0.15 && share <= 0.25, `trees on ${(100 * share).toFixed(1)}% of wood ${t}`);
  }
});

test('each kind of land gets its own props, and every point of interest its sprite', () => {
  const kindsBy = {};
  for (const { o, c } of allObjects()) {
    const t = c.tiles[(o.y - c.cy * CHUNK) * CHUNK + (o.x - c.cx * CHUNK)];
    (kindsBy[o.kind] ||= new Set()).add(t);
  }
  const only = (kind, allowed) => {
    if (!kindsBy[kind]) return;
    for (const t of kindsBy[kind]) assert.ok(allowed.includes(t), `${kind} on terrain ${t}`);
  };
  only('tree.birch', [T.BIRCH]);
  only('pine', [T.PINE]);
  only('pine.snow', [T.SNOW]);
  only('crag', [T.MOUNTAIN]);
  only('crag.snow', [T.MOUNTAIN]);
  only('basalt.column', [T.BASALT]);
  only('rock.basalt', [T.BASALT]);
  only('dice.stone', [T.DOWNS]);
  only('reeds', [T.MARSH]);
  for (const kind of ['tree', 'tree.birch', 'pine', 'crag', 'basalt.column', 'rock.basalt', 'reeds', 'dice.stone', 'lantern.post', 'statue', 'landmark.stone']) {
    assert.ok(kindsBy[kind], `${kind} appears somewhere`);
  }
  const art = { lantern: ['lantern.post'], landmark: ['landmark.stone'], statue: ['statue'], ruin: ['ruin'], cave: ['cave'], chest: ['chest', 'chest.mimic'], note: ['note'], hamlet: ['hamlet'], ore: ['ore.node'], herbs: ['herbs'], fishing: ['fishing.spot'] };
  for (const c of [...areaChunks, ...regionChunks]) {
    for (const p of c.pois) {
      if (p.type === 'quay') continue;
      const prop = c.objects.find((o) => o.id === p.id);
      assert.ok(prop, `${p.id} has its prop`);
      assert.ok(art[p.type].includes(prop.kind), `${p.id} drawn as ${prop.kind}`);
      assert.equal(prop.place, p.id);
      if (p.type === 'chest') assert.equal(prop.kind, p.mimic ? 'chest.mimic' : 'chest');
      // the prop stands on or right beside the tile Milo stands on
      const near = p.x >= prop.x - 1 && p.x <= prop.x + prop.w && p.y >= prop.y - 1 && p.y <= prop.y + prop.h;
      assert.ok(near, `${p.id} prop is beside it`);
    }
  }
  // the quay has a dock (painted in the ground) and Captain Sloe's boat
  const quay = wilds.fixedPois().find((p) => p.type === 'quay');
  const quayChunk = wilds.chunk(Math.floor(quay.x / CHUNK), Math.floor(quay.y / CHUNK));
  assert.ok(quayChunk.objects.some((o) => o.kind === 'boat' && o.place === quay.id), 'a boat at the quay');
});

test('points of interest carry the contract’s ids and shapes; entities have calm labels', () => {
  for (const c of [...areaChunks, ...regionChunks]) {
    for (const p of c.pois) {
      assert.equal(p.id, p.type === 'lantern' ? `lantern:${p.x},${p.y}` : `poi:${p.type}:${p.x},${p.y}`);
      assert.ok(typeof p.name === 'string' && p.name && Number.isInteger(p.depth) && p.depth >= 1);
      assert.equal(wilds.poiAt(p.x, p.y), p);
      assert.ok(nav.walkable(p.x, p.y) || wilds.terrainAt(p.x, p.y) === T.SKY, `${p.id} can be stood on`);
    }
  }
  assert.equal(wilds.poiAt(31, 22), null, 'nothing wild in the vale');
  const entities = wilds.entitiesIn({ x0: -60, y0: -60, x1: 120, y1: 110 }, { tier: 2, lit: new Set(), opened: {}, felled: {} });
  const kinds = new Set(entities.map((e) => e.kind));
  for (const kind of ['lantern', 'poi', 'tree', 'gate', 'war-table']) assert.ok(kinds.has(kind), `entities include ${kind}`);
  for (const e of entities) {
    assertCalm(e.label, e.id);
    assert.ok(Number.isInteger(e.x) && Number.isInteger(e.y));
    if (e.kind === 'gate') assert.ok(['gate:n', 'gate:w', 'gate:e', 'gate:sw'].includes(e.id));
    if (e.kind === 'tree') assert.match(e.id, /^tree:-?\d+,-?\d+$/);
    if (e.kind === 'lantern') assert.match(e.id, /^lantern:-?\d+,-?\d+$/);
    if (e.kind === 'poi') assert.match(e.id, /^poi:[a-z]+:-?\d+,-?\d+$/);
  }
  const lantern = entities.find((e) => e.kind === 'lantern');
  const tree = entities.find((e) => e.kind === 'tree');
  const lit = wilds.entitiesIn({ x: lantern.x, y: lantern.y, w: 1, h: 1 }, { lit: { [lantern.id]: 1 } })[0];
  assert.equal(lit.lit, true);
  assert.match(lit.label, /lit/i);
  const felled = wilds.entitiesIn({ x: tree.x, y: tree.y, w: 1, h: 1 }, { felled: { [tree.id]: 7 }, day: 7 }).find((e) => e.kind === 'tree');
  assert.equal(felled.felled, true);
  assert.equal(felled.label, 'Stump');
  const notToday = wilds.entitiesIn({ x: tree.x, y: tree.y, w: 1, h: 1 }, { felled: { [tree.id]: 6 }, day: 7 }).find((e) => e.kind === 'tree');
  assert.equal(notToday.felled, false, 'yesterday’s stump has grown back');
  assert.match(tree.label, /· chop$/);
  assert.ok(!wilds.entitiesIn({ x0: -60, y0: -60, x1: 120, y1: 110 }).some((e) => e.kind === 'war-table'), 'no war table at tier 1');
});

test('felled trees are stumps that still block; lit lanterns and opened chests change frame', () => {
  const c = wilds.chunk(1, -1);
  const tree = c.objects.find((o) => o.wood);
  const state = { felled: new Set([tree.id]) };
  const seen = wilds.objectsIn(tree.x, tree.y, tree.x, tree.y, state).find((o) => o.id === tree.id);
  assert.equal(seen.kind, 'stump');
  assert.equal(seen.blocks, true);
  assert.equal(wilds.blocked(tree.x, tree.y), true);
  const lanternChunk = wilds.chunk(Math.floor(-12 / CHUNK), Math.floor(18 / CHUNK));
  const post = lanternChunk.objects.find((o) => o.kind === 'lantern.post');
  assert.ok(post, 'a lantern post near the west road');
  assert.equal(wilds.objectsIn(post.x, post.y, post.x, post.y, { lit: [post.id] })[0].frame, 1);
  assert.equal(wilds.objectsIn(post.x, post.y, post.x, post.y)[0].frame, 0);
  const inView = wilds.objectsIn(32, -32, 63, -1);
  assert.ok(inView.length > 0 && inView.every((o) => o.x >= 32 && o.x <= 63 && o.y >= -32 && o.y <= -1));
});

// ---------- walking the world ----------

test('every fixed point of interest and every road tile can be reached from home, in hops of up to 60 tiles', () => {
  const roads = worldgen.roads();
  const roadKeys = new Set([...roads.tiles, ...ringDetours(worldgen).tiles.map((d) => `${d.x},${d.y}`)]);
  const roadTiles = [...roadKeys].map((k) => k.split(',').map(Number))
    .filter(([x, y]) => roadish(wilds.terrainAt(x, y)) && !onRing(x, y));
  // The Skyward Isles are reached by kite and the Far Shore by Captain Sloe's ferry (WORLD.md §5).
  const fixed = wilds.fixedPois().filter((p) => p.region !== 'skyward-isles' && p.region !== 'far-shore');
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of roadTiles) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (const p of fixed) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  x0 -= 12; y0 -= 12; x1 += 12; y1 += 12;
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const parent = new Int32Array(W * H).fill(-2);
  const depth = new Int32Array(W * H);
  const idx = (x, y) => (y - y0) * W + (x - x0);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  parent[idx(HOME.x, HOME.y)] = -1;
  queue[tail++] = idx(HOME.x, HOME.y);
  while (head < tail) {
    const i = queue[head++];
    const x = (i % W) + x0;
    const y = Math.floor(i / W) + y0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const j = idx(nx, ny);
      if (parent[j] !== -2 || !nav.walkable(nx, ny)) continue;
      parent[j] = i;
      depth[j] = depth[i] + 1;
      queue[tail++] = j;
    }
  }
  const unreachedRoads = roadTiles.filter(([x, y]) => parent[idx(x, y)] === -2);
  assert.deepEqual(unreachedRoads, [], 'every road tile off the ring is reachable');
  const unreachedPois = fixed.filter((p) => parent[idx(p.x, p.y)] === -2).map((p) => p.id);
  assert.deepEqual(unreachedPois, [], 'every fixed point of interest is reachable');

  // Now walk there with findPath itself, a hop of at most 60 tiles at a time along the way.
  const hops = new Map();
  const waypointsTo = (x, y) => {
    const chain = [];
    for (let i = idx(x, y); i !== -1; i = parent[i]) chain.push(i);
    chain.reverse();
    const points = [];
    for (let k = 0; k < chain.length; k += 50) points.push(chain[k]);
    if (points.at(-1) !== chain.at(-1)) points.push(chain.at(-1));
    return points.map((i) => ({ x: (i % W) + x0, y: Math.floor(i / W) + y0 }));
  };
  const targets = [...fixed.map((p) => [p.x, p.y]), ...roadTiles.filter((_, i) => i % 23 === 0)];
  for (const [x, y] of targets) {
    const points = waypointsTo(x, y);
    for (let k = 1; k < points.length; k += 1) hops.set(`${points[k - 1].x},${points[k - 1].y}>${points[k].x},${points[k].y}`, [points[k - 1], points[k]]);
  }
  for (const [key, [a, b]] of hops) {
    assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 60, `${key} is a short hop`);
    const path = nav.findPath(a, b);
    assert.ok(path.length > 0, `findPath ${key}`);
    assert.deepEqual(path.at(-1), b, `arrives ${key}`);
  }
  assert.ok(hops.size > 200, `${hops.size} hops walked`);
});

// Stretches of road near the vale whose two ends aren't joined by road within a few tiles, outside
// the vale and its walls (the gates count as road). worldgen's line, two tiles wide.
function roadGaps(w, wg) {
  const line = (a, b, visit) => {
    let x0 = Math.round(a.x); let y0 = Math.round(a.y);
    const x1 = Math.round(b.x); const y1 = Math.round(b.y);
    const dx = Math.abs(x1 - x0); const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      visit(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const ok = (x, y) => isGate(x, y) || (!inHeart(x, y) && !onRing(x, y) && roadish(w.terrainAt(x, y)));
  const snap = (p) => {
    for (let r = 0; r <= 2; r += 1) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (ok(Math.round(p.x) + dx, Math.round(p.y) + dy)) return [Math.round(p.x) + dx, Math.round(p.y) + dy];
    }
    return null;
  };
  const gaps = [];
  for (const p of wg.roads().paths) {
    for (let i = 1; i < p.points.length; i += 1) {
      const a = p.points[i - 1];
      const b = p.points[i];
      let close = false;
      line(a, b, (x, y) => { if (wg.heartDistance(x, y) <= 12) close = true; });
      if (!close) continue;
      const s = snap(a);
      const t = snap(b);
      const at = `${p.from}→${p.to} (${a.x},${a.y})-(${b.x},${b.y})`;
      if (!s || !t) { gaps.push(at); continue; }
      const box = [Math.min(s[0], t[0]) - 8, Math.min(s[1], t[1]) - 8, Math.max(s[0], t[0]) + 8, Math.max(s[1], t[1]) + 8];
      const seen = new Set([`${s[0]},${s[1]}`]);
      const queue = [s];
      let joined = false;
      while (queue.length && !joined) {
        const [x, y] = queue.shift();
        if (x === t[0] && y === t[1]) joined = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const k = `${nx},${ny}`;
          if (nx < box[0] || ny < box[1] || nx > box[2] || ny > box[3] || seen.has(k) || !ok(nx, ny)) continue;
          seen.add(k);
          queue.push([nx, ny]);
        }
      }
      if (!joined) gaps.push(at);
    }
  }
  return gaps;
}

test('roads meet the vale only at its gates: none runs on its walls or cuts its corners', () => {
  // worldgen keeps its roads clear of the ring (a road two tiles wide runs on its line and the
  // tiles east and south of it, so no line runs within two tiles of the vale), in every world
  for (const seed of ['hushlands', 's5', 's7', 'another story', 42]) {
    const wg = seed === 'hushlands' ? worldgen : createWorldgen({ seed, regionWords: words.regionWords });
    const w = seed === 'hushlands' ? wilds : createWilds({ worldgen: wg });
    for (let x = -1; x <= HEART.w; x += 1) {
      for (let y = -1; y <= HEART.h; y += 1) {
        if (ringKind(x, y) !== 'wall' || GATE_TILES.some((g) => Math.abs(g.x - x) + Math.abs(g.y - y) === 1)) continue;
        assert.ok(!roadish(wg.terrainAt(x, y)), `${seed}: no road on the wall at ${x},${y}`);
        assert.ok(!roadish(w.terrainAt(x, y)), `${seed}: none in the wilds either`);
      }
    }
    assert.deepEqual(ringDetours(wg).tiles, [], `${seed}: nothing left for the wilds to move`);
    // every stretch of road near the vale stays joined outside it
    assert.deepEqual(roadGaps(w, wg), [], seed);
  }
  const det = ringDetours(worldgen);
  assert.equal(ringDetours(worldgen), det, 'worked out once per world');
});

test('a road that did hug the vale would still be moved off its walls and round its corners', () => {
  // ringDetours stays as a guard: a world whose roads run along the north wall and cut the
  // north-east corner (as roads could before worldgen kept them clear).
  const base = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const paths = [
    { from: 'west', to: 'corner', points: [{ x: 36, y: -2 }, { x: 62, y: -2 }] },
    { from: 'corner', to: 'south', points: [{ x: 62, y: -2 }, { x: 66, y: 2 }, { x: 66, y: 8 }] },
  ];
  const laid = new Set();
  const line = (a, b) => {
    let x0 = a.x; let y0 = a.y;
    const dx = Math.abs(b.x - x0); const dy = -Math.abs(b.y - y0);
    const sx = x0 < b.x ? 1 : -1; const sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (const [lx, ly] of [[0, 0], [1, 0], [0, 1]]) if (!inHeart(x0 + lx, y0 + ly)) laid.add(`${x0 + lx},${y0 + ly}`);
      if (x0 === b.x && y0 === b.y) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  for (const p of paths) for (let i = 1; i < p.points.length; i += 1) line(p.points[i - 1], p.points[i]);
  const hugging = {
    ...base,
    roads: () => ({ ...base.roads(), paths }),
    terrainAt: (x, y) => {
      if (inHeart(x, y)) return T.HEART;
      if (!laid.has(`${x},${y}`)) return base.terrainAt(x, y);
      const t = base.naturalTerrain(x, y);
      return t === T.RIVER || t === T.SEA ? T.BRIDGE : T.ROAD;
    },
  };
  const det = ringDetours(hugging);
  const at = (x, y) => det.at(x, y) ?? hugging.terrainAt(x, y);
  assert.ok(det.tiles.some((d) => ringKind(d.x, d.y) === 'wall'), 'the road on the wall is moved');
  for (let x = -1; x <= HEART.w; x += 1) {
    for (let y = -1; y <= HEART.h; y += 1) {
      if (ringKind(x, y) !== 'wall' || GATE_TILES.some((g) => Math.abs(g.x - x) + Math.abs(g.y - y) === 1)) continue;
      assert.ok(!roadish(at(x, y)), `no road on the wall at ${x},${y}`);
    }
  }
  for (const d of det.tiles) assert.ok(!inHeart(d.x, d.y) && !isGate(d.x, d.y), `${d.x},${d.y} is outside the vale`);
  // the two ends are joined round the corner, on road and deck, outside the walls
  const ok = (x, y) => !inHeart(x, y) && !onRing(x, y) && roadish(at(x, y));
  const seen = new Set(['40,-2']);
  const queue = [[40, -2]];
  for (let q = 0; q < queue.length; q += 1) {
    const [x, y] = queue[q];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !ok(x + dx, y + dy) || Math.abs(x + dx - 50) > 30 || Math.abs(y + dy) > 20) continue;
      seen.add(k);
      queue.push([x + dx, y + dy]);
    }
  }
  assert.ok(seen.has('66,6'), 'round the corner by road');
  // and any deck it lays runs straight
  // (a landing where it turns the corner)
  for (const d of det.tiles) if (d.terrain === T.BRIDGE) assert.ok(['ns', 'ew', 'x'].includes(det.deckAt(d.x, d.y)), `a deck at ${d.x},${d.y} runs one way`);
});

test('findPath is optimal and four-way; an unwalkable goal falls back within 3; budgets hold', () => {
  // Compare with Dijkstra on the same costs round a few spots in the wilds.
  const dijkstra = (from, to, r) => {
    const dist = new Map([[`${from.x},${from.y}`, 0]]);
    const open = [[0, from.x, from.y]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, x, y] = open.shift();
      if (x === to.x && y === to.y) return d;
      if (d > dist.get(`${x},${y}`)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (Math.abs(nx - from.x) > r || Math.abs(ny - from.y) > r) continue;
        const c = nav.cost(nx, ny);
        if (!Number.isFinite(c)) continue;
        const k = `${nx},${ny}`;
        if (d + c < (dist.get(k) ?? Infinity)) { dist.set(k, d + c); open.push([d + c, nx, ny]); }
      }
    }
    return Infinity;
  };
  const trips = [[{ x: 32, y: -3 }, { x: 40, y: -18 }], [{ x: -3, y: 20 }, { x: -20, y: 30 }], [{ x: 70, y: 14 }, { x: 80, y: 0 }], [{ x: 11, y: 47 }, { x: 0, y: 60 }]];
  for (const [from, to] of trips) {
    const goal = nav.nearestWalkable(to, 3);
    const path = nav.findPath(from, goal, { margin: 12 });
    assert.ok(path.length > 0, `${from.x},${from.y} to ${goal.x},${goal.y}`);
    let prev = from;
    let total = 0;
    for (const p of path) {
      assert.equal(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y), 1);
      total += nav.cost(p.x, p.y);
      prev = p;
    }
    const r = Math.max(Math.abs(goal.x - from.x), Math.abs(goal.y - from.y)) + 12;
    const best = dijkstra(from, goal, r);
    assert.ok(total <= best + path.length * 0.001 + 1e-6, `optimal: ${total.toFixed(3)} vs ${best.toFixed(3)}`);
  }
  // the heuristic is admissible: no step costs less than minCost
  const minStep = Math.min(...TERRAIN_INFO.filter((t) => t.walk).map((t) => t.cost), 1);
  assert.equal(nav.minCost, minStep);
  // an unwalkable goal (a tree) falls back to the nearest walkable tile within 3
  const tree = wilds.chunk(1, -1).objects.find((o) => o.wood && o.x > 40 && o.y < -10);
  const toTree = nav.findPath({ x: 32, y: -2 }, { x: tree.x, y: tree.y });
  const end = toTree.at(-1);
  assert.ok(Math.abs(end.x - tree.x) <= 1 && Math.abs(end.y - tree.y) <= 1 && nav.walkable(end.x, end.y), 'beside the tree');
  // deep sea: nowhere to stand within 3
  assert.deepEqual(nav.findPath(HOME, { x: 90, y: 64 }), []);
  assert.equal(nav.nearestWalkable({ x: 90, y: 64 }, 3), null);
  // already there
  assert.deepEqual(nav.findPath(HOME, HOME), []);
  // a node budget: a long walk that needs more nodes than allowed gives up rather than hanging
  assert.deepEqual(nav.findPath(HOME, { x: -110, y: 10 }, { maxNodes: 200 }), []);
  assert.ok(nav.findPath(HOME, { x: 32, y: -20 }).length > 0);
  // extraBlocked shuts a tile (the war table, a stray), but never a gate
  const shut = createNav({ worldgen, wildBlocked: wilds.blocked, extraBlocked: (x, y) => x === 32 && y === -3 });
  assert.equal(shut.walkable(32, -3), false);
  assert.ok(!shut.findPath({ x: 32, y: -1 }, { x: 32, y: -6 }).some((p) => p.x === 32 && p.y === -3));
});

// ---------- the ground ----------

const validCodes = new Set(Object.keys(PALETTE).filter((k) => k !== 'x').map((k) => k.charCodeAt(0)));

test('ground uses only palette keys, leaves the vale clear and paints every wild pixel', () => {
  for (const [cx, cy] of [[1, -1], [-1, 0], [0, 1], [1, 1], [2, 0], [-1, -1], [-4, 0], [3, -4], [-1, 5], [2, 3], [5, -1], [-5, -5]]) {
    wilds.ground(cx, cy);
    const c = wilds.chunk(cx, cy);
    assert.equal(c.groundRows, CHUNK_PX);
    assert.equal(c.ground.length, CHUNK_PX * CHUNK_PX);
    for (let ly = 0; ly < CHUNK_PX; ly += 1) {
      for (let lx = 0; lx < CHUNK_PX; lx += 1) {
        const code = c.ground[ly * CHUNK_PX + lx];
        const x = Math.floor((cx * CHUNK_PX + lx) / 16);
        const y = Math.floor((cy * CHUNK_PX + ly) / 16);
        if (inHeart(x, y)) assert.equal(code, 0, `heart pixel ${cx},${cy}:${lx},${ly} stays clear`);
        else if (!validCodes.has(code)) assert.fail(`${cx},${cy}:${lx},${ly} has key ${String.fromCharCode(code)} (${code})`);
      }
    }
  }
  // chunks entirely inside the vale are clear and cost nothing
  assert.equal(wilds.ground(0, 0), true);
  assert.ok(wilds.chunk(0, 0).ground.every((k) => k === 0));
  assert.deepEqual(wilds.chunk(0, 0).objects, []);
});

test('the ground carries each region’s own look', () => {
  const keysOver = (terrain, chunkList) => {
    const counts = {};
    for (const c of chunkList) {
      wilds.ground(c.cx, c.cy);
      for (let j = 0; j < CHUNK; j += 1) {
        for (let i = 0; i < CHUNK; i += 1) {
          if (c.tiles[j * CHUNK + i] !== terrain) continue;
          const k = String.fromCharCode(c.ground[(j * 16 + 8) * CHUNK_PX + i * 16 + 8]);
          counts[k] = (counts[k] || 0) + 1;
        }
      }
    }
    return counts;
  };
  const has = (counts, keys, what) => assert.ok(keys.some((k) => counts[k] > 0), `${what}: ${JSON.stringify(counts)}`);
  const all = [...areaChunks, ...regionChunks];
  has(keysOver(T.SNOW, all), ['c', 'f', 'C'], 'snow');
  has(keysOver(T.BASALT, all), ['z', 'S', 'o'], 'basalt');
  has(keysOver(T.ROAD, all), ['p', 'P'], 'road');
  has(keysOver(T.BRIDGE, all), ['n', 'b', 'B', 'o'], 'bridge');
  has(keysOver(T.DEEP, all), ['W'], 'deep sea');
  has(keysOver(T.MOOR, all), ['S', 'G', 'V', 'v'], 'moor');
  has(keysOver(T.MARSH, all), ['j', 'q', 'w', 'W', 'f'], 'marsh');
  has(keysOver(T.ROCK, all), ['S', 's', 'z'], 'rock');
  has(keysOver(T.DOWNS, all), ['j', 'g', 'h'], 'downs');
  const painted = keysOver(T.PAINTED, all);
  assert.ok(['k', 'e', 'u', 'v'].filter((k) => painted[k]).length >= 1 || Object.keys(painted).length > 0, 'painted hills');
  // Painted hills show madder, woad and weld in their rows somewhere.
  const hills = wilds.chunk(Math.floor(worldgen.anchorById['painted-hills'].x / CHUNK), Math.floor(worldgen.anchorById['painted-hills'].y / CHUNK));
  wilds.ground(hills.cx, hills.cy);
  const dyes = new Set();
  for (const code of hills.ground) if ('keuv'.includes(String.fromCharCode(code))) dyes.add(String.fromCharCode(code));
  assert.ok(dyes.size >= 3, `dyes in the painted hills: ${[...dyes].join('')}`);
  // Sky isles: grass on top, rock underneath, over the sea.
  const isles = worldgen.anchorById['skyward-isles'];
  const isle = wilds.chunk(Math.floor(isles.x / CHUNK), Math.floor(isles.y / CHUNK));
  wilds.ground(isle.cx, isle.cy);
  const isleKeys = new Set([...isle.ground].map((k) => String.fromCharCode(k)));
  for (const k of ['h', 'G', 'S', 'z', 'W']) assert.ok(isleKeys.has(k), `sky isle key ${k}`);
});

test('the seam at the vale’s edge disappears: grass noise carries on across it', async () => {
  let paintGround;
  try {
    ({ paintGround } = await import('../src/world/engine.js'));
  } catch (error) {
    assert.fail(`engine.js didn't import: ${error.message}`);
  }
  const W = MAP.width * 16;
  const H = MAP.height * 16;
  const data = new Uint8ClampedArray(W * H * 4);
  paintGround(data);
  const rgbKey = new Map(Object.entries(PALETTE).filter(([, v]) => v.hex.startsWith('#')).map(([k, v]) => [parseInt(v.hex.slice(1), 16), k]));
  const valeKey = (x, y) => rgbKey.get((data[(y * W + x) * 4] << 16) | (data[(y * W + x) * 4 + 1] << 8) | data[(y * W + x) * 4 + 2]);
  const wildKey = (px, py) => {
    const cx = Math.floor(px / CHUNK_PX);
    const cy = Math.floor(py / CHUNK_PX);
    wilds.ground(cx, cy);
    return String.fromCharCode(wilds.chunk(cx, cy).ground[(py - cy * CHUNK_PX) * CHUNK_PX + (px - cx * CHUNK_PX)]);
  };
  let pairs = 0;
  let same = 0;
  const compare = (vk, wk) => {
    if (!'gj'.includes(vk) || !'gj'.includes(wk)) return;
    pairs += 1;
    if (vk === wk) same += 1;
  };
  for (let y = 0; y < H; y += 1) {
    compare(valeKey(0, y), wildKey(-1, y));
    compare(valeKey(W - 1, y), wildKey(W, y));
  }
  for (let x = 0; x < W; x += 1) {
    compare(valeKey(x, 0), wildKey(x, -1));
    compare(valeKey(x, H - 1), wildKey(x, H));
  }
  assert.ok(pairs > 800, `${pairs} grass pixels either side of the edge`);
  assert.ok(same / pairs > 0.93, `grass matches across the edge ${(100 * same / pairs).toFixed(1)}%`);
  // water: the wild sea just outside the bay reads the same depth as the vale's own
  let wet = 0;
  let wetSame = 0;
  for (let x = 28 * 16; x < W; x += 1) {
    const vk = valeKey(x, H - 1);
    const wk = wildKey(x, H);
    if (!'wW'.includes(vk) || !'wWf'.includes(wk)) continue;
    wet += 1;
    if (vk === wk) wetSame += 1;
  }
  assert.ok(wet > 100 && wetSame / wet > 0.85, `sea matches across the bay ${wetSame}/${wet}`);
});

test('the wall runs unbroken round the vale: land holds its thicket or palisade, and only the bay’s water is open', () => {
  // Painting and objects agree on every ring tile: a wall tile painted as land always holds its
  // thicket (tier 1) and palisade (tier 2), and a wall tile of water (only where the vale's own
  // water carries on out through the ring, the bay) is painted as water and holds nothing.
  const WATERS = new Set([T.SEA, T.DEEP, T.RIVER]);
  const wetKey = new Set(['w', 'W', 'f'].map((k) => k.charCodeAt(0)));
  // the bay: where the vale's own waterline crosses the top quarter of a ring tile (worldgen)
  const bayWater = isBayRing;
  assert.ok(bayWater(27, 44) && !bayWater(26, 44), 'the wall runs on to where the bay is plainly open water');
  const one = new Set(wilds.ringObjects(1).filter((o) => o.kind === 'thicket').map((o) => `${o.x},${o.y}`));
  const two = new Set(wilds.ringObjects(2).filter((o) => o.kind.startsWith('palisade')).map((o) => `${o.x},${o.y}`));
  let land = 0;
  let water = 0;
  for (let x = -1; x <= HEART.w; x += 1) {
    for (let y = -1; y <= HEART.h; y += 1) {
      if (ringKind(x, y) !== 'wall') continue;
      let wet = 0;
      for (let ly = 0; ly < 16; ly += 1) for (let lx = 0; lx < 16; lx += 1) if (wetKey.has(groundKey(x * 16 + lx, y * 16 + ly))) wet += 1;
      const k = `${x},${y}`;
      const terrain = wilds.terrainAt(x, y);
      if (WATERS.has(terrain)) {
        water += 1;
        assert.ok(bayWater(x, y), `${k}: the ring is water only where the vale's bay carries on out`);
        assert.equal(wet, 256, `${k}: water on the ring is painted all water`);
        assert.ok(!one.has(k) && !two.has(k), `${k}: nothing stands in the water`);
      } else {
        land += 1;
        assert.ok(!bayWater(x, y), `${k}: the bay's water is open`);
        assert.equal(wet, 0, `${k}: land on the ring is painted dry under its wall (${wet} of 256 wet)`);
        assert.ok(one.has(k), `${k}: a thicket on every wall tile of land`);
        assert.ok(two.has(k), `${k}: and the palisade at tier 2`);
      }
    }
  }
  assert.ok(land > 150 && water > 10, `${land} tiles of wall on land, ${water} of the bay`);
  // Under the south wall, where it meets the bay, the shore carries straight on from the vale's own
  // down to the south-west: no step in it anywhere (the vale's coast stops at x 23, the shore doesn't).
  let prev = null;
  for (let X = 16 * 16; X < 27 * 16; X += 1) {
    let shore = null;
    for (let Y = HEART.h * 16; Y < (HEART.h + 8) * 16 && shore === null; Y += 1) if (wetKey.has(groundKey(X, Y))) shore = Y;
    assert.ok(shore !== null, `water below the wall at x ${X}`);
    if (prev !== null) assert.ok(Math.abs(shore - prev) <= 6, `the shore under the wall steps ${shore - prev} px at x ${X}`);
    prev = shore;
  }
  // in other worlds too: the ring is land wherever the vale's own edge is
  for (const seed of ['another story', 42]) {
    const wg = createWorldgen({ seed, regionWords: words.regionWords });
    for (let x = -1; x <= HEART.w; x += 1) {
      for (let y = -1; y <= HEART.h; y += 1) {
        if (ringKind(x, y) !== 'wall' || !WATERS.has(wg.terrainAt(x, y))) continue;
        assert.ok(bayWater(x, y), `${seed}: ${x},${y} is water beside the vale's land`);
      }
    }
  }
});

test('bridges are clean straight decks: planks across the way over, rails at the water, never a blob', () => {
  const det = ringDetours(worldgen);
  const deckOf = (x, y) => det.deckAt(x, y) || worldgen.deckAt(x, y);
  const keyCode = (k) => k.charCodeAt(0);
  const PLANK = new Set(['n', 'b', 'B', 'o'].map(keyCode));
  const walks = (x, y) => TERRAIN_INFO[wilds.terrainAt(x, y)].walk;
  const decks = [];
  for (const c of [...areaChunks, ...regionChunks]) {
    for (let j = 0; j < CHUNK; j += 1) for (let i = 0; i < CHUNK; i += 1) if (c.tiles[j * CHUNK + i] === T.BRIDGE) decks.push({ x: c.cx * CHUNK + i, y: c.cy * CHUNK + j });
  }
  assert.ok(decks.length > 20, `${decks.length} deck tiles`);
  const isDeck = new Set(decks.map((d) => `${d.x},${d.y}`));
  let straight = 0;
  for (const { x, y } of decks) {
    const dir = deckOf(x, y);
    assert.ok(['ns', 'ew', 'x'].includes(dir), `the deck at ${x},${y} runs one way (${dir})`);
    // never a plank floating on its own, joined only at a corner
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roadish(wilds.terrainAt(x + dx, y + dy))), `the deck at ${x},${y} is joined on`);
    // painted square to its tile, all plank and rail
    let off = 0;
    for (let ly = 0; ly < 16; ly += 1) for (let lx = 0; lx < 16; lx += 1) if (!PLANK.has(groundKey(x * 16 + lx, y * 16 + ly))) off += 1;
    assert.equal(off, 0, `the deck at ${x},${y} fills its tile`);
    if (dir === 'x') continue;
    straight += 1;
    // its ends land on ground (or more deck), never in open water
    for (const [dx, dy] of dir === 'ns' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]) assert.ok(walks(x + dx, y + dy), `the deck at ${x},${y} lands at ${x + dx},${y + dy}`);
    // planks lie across the way over: in the middle of the tile, each plank is one key along its
    // length and they repeat every four pixels across
    for (let a = 4; a < 12; a += 1) {
      const line = [];
      for (let b = 4; b < 12; b += 1) line.push(dir === 'ns' ? groundKey(x * 16 + b, y * 16 + a) : groundKey(x * 16 + a, y * 16 + b));
      assert.ok(line.every((k) => k === line[0]), `the deck at ${x},${y}: planks run across it`);
      const next = dir === 'ns' ? groundKey(x * 16 + 8, y * 16 + a + 4 - (a >= 8 ? 8 : 0)) : groundKey(x * 16 + a + 4 - (a >= 8 ? 8 : 0), y * 16 + 8);
      assert.equal(next, line[0], `the deck at ${x},${y}: a plank every four pixels`);
    }
    // a rail (ink at the very edge) along each long side that meets the water
    for (const [dx, dy, px, py] of dir === 'ns' ? [[-1, 0, 0, 8], [1, 0, 15, 8]] : [[0, -1, 8, 0], [0, 1, 8, 15]]) {
      const t = wilds.terrainAt(x + dx, y + dy);
      if ([T.RIVER, T.SEA, T.DEEP].includes(t)) assert.equal(groundKey(x * 16 + px, y * 16 + py), keyCode('o'), `the deck at ${x},${y} is railed`);
    }
  }
  assert.ok(straight > 20, `${straight} straight deck tiles`);
  // and no planks spill onto the ground round a deck (the deep plank shade is only ever a deck's)
  for (const { x, y } of decks) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (isDeck.has(`${x + dx},${y + dy}`) || inHeart(x + dx, y + dy) || wilds.terrainAt(x + dx, y + dy) === T.BRIDGE) continue;
        let spill = 0;
        for (let ly = 0; ly < 16; ly += 1) for (let lx = 0; lx < 16; lx += 1) if (groundKey((x + dx) * 16 + lx, (y + dy) * 16 + ly) === keyCode('B')) spill += 1;
        assert.equal(spill, 0, `no planks on ${x + dx},${y + dy} beside the deck at ${x},${y}`);
      }
    }
  }
});

test('no stray ponds: every lake, river and marsh pool is a proper size', () => {
  // Terrain: every body of water (a bridge counts as the water under it) has MIN_WATER tiles.
  const WET = new Set([T.SEA, T.DEEP, T.RIVER, T.BRIDGE]);
  const seen = new Set();
  let bodies = 0;
  for (const c of areaChunks) {
    for (let j = 0; j < CHUNK; j += 1) {
      for (let i = 0; i < CHUNK; i += 1) {
        const x = c.cx * CHUNK + i;
        const y = c.cy * CHUNK + j;
        const k = `${x},${y}`;
        if (seen.has(k) || !WET.has(c.tiles[j * CHUNK + i])) continue;
        const body = [[x, y]];
        const mine = new Set([k]);
        for (let q = 0; q < body.length && body.length < MIN_WATER; q += 1) {
          const [bx, by] = body[q];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = `${bx + dx},${by + dy}`;
            if (mine.has(nk) || !WET.has(wilds.terrainAt(bx + dx, by + dy))) continue;
            mine.add(nk);
            body.push([bx + dx, by + dy]);
          }
        }
        for (const nk of mine) seen.add(nk);
        // (a body that runs into the vale's own water is the bay)
        const vale = body.some(([bx, by]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inHeart(bx + dx, by + dy)));
        assert.ok(body.length >= MIN_WATER || vale, `water at ${k} is a body of ${body.length} tiles`);
        bodies += 1;
      }
    }
  }
  assert.ok(bodies > 5);
  // Paint: every patch of water in the marsh (its pools) is a good two tiles across or more, with
  // no specks and slivers: in the Glass Fen, and on the marsh by the bay east of the vale.
  const fen = worldgen.anchorById['glass-fen'];
  const wetKey = new Set(['w', 'W', 'f'].map((k) => k.charCodeAt(0)));
  for (const [cx0, cy0] of [[Math.floor(fen.x / CHUNK) - 1, Math.floor(fen.y / CHUNK) - 1], [2, 0]]) {
    const W = 3 * CHUNK_PX;
    const wet = new Uint8Array(W * W);
    for (let j = 0; j < 3; j += 1) {
      for (let i = 0; i < 3; i += 1) {
        wilds.ground(cx0 + i, cy0 + j);
        const g = wilds.chunk(cx0 + i, cy0 + j).ground;
        for (let y = 0; y < CHUNK_PX; y += 1) for (let x = 0; x < CHUNK_PX; x += 1) wet[(j * CHUNK_PX + y) * W + i * CHUNK_PX + x] = wetKey.has(g[y * CHUNK_PX + x]) ? 1 : 0;
      }
    }
    const label = new Int32Array(W * W);
    const marshTile = new Uint8Array(9 * CHUNK * CHUNK);
    for (let j = 0; j < 3 * CHUNK; j += 1) for (let i = 0; i < 3 * CHUNK; i += 1) marshTile[j * 3 * CHUNK + i] = wilds.terrainAt(cx0 * CHUNK + i, cy0 * CHUNK + j) === T.MARSH ? 1 : 0;
    let pools = 0;
    for (let p = 0; p < W * W; p += 1) {
      if (!wet[p] || label[p]) continue;
      const list = [p];
      label[p] = 1;
      let edge = false;
      let marsh = false;
      for (let q = 0; q < list.length; q += 1) {
        const r = list[q];
        const x = r % W;
        const y = Math.floor(r / W);
        if (x === 0 || y === 0 || x === W - 1 || y === W - 1) edge = true;
        if (marshTile[Math.floor(y / 16) * 3 * CHUNK + Math.floor(x / 16)]) marsh = true;
        // (eight ways round, so a lily pad on the water doesn't cut a pixel of it off)
        for (const n of [x > 0 ? r - 1 : -1, x < W - 1 ? r + 1 : -1, r - W, r + W, x > 0 ? r - W - 1 : -1, x < W - 1 ? r - W + 1 : -1, x > 0 ? r + W - 1 : -1, x < W - 1 ? r + W + 1 : -1]) {
          if (n < 0 || n >= W * W || !wet[n] || label[n]) continue;
          label[n] = 1;
          list.push(n);
        }
      }
      if (edge) continue;
      if (marsh) pools += 1;
      assert.ok(list.length >= 180, `a patch of water at ${cx0 * CHUNK_PX + (p % W)},${cy0 * CHUNK_PX + Math.floor(p / W)} is only ${list.length} px`);
    }
    if (cx0 !== 2) assert.ok(pools >= 8, `${pools} pools in the fen`);
  }
});

test('the vale’s beach runs straight on out of it along the bay, with no step in the coast', () => {
  // East of the vale the shore meets the sea where the vale's own coast would (map.js coastAt),
  // sand above it, for the first few tiles, and bends to the wilds' own shore further on.
  const wetKey = new Set(['w', 'W', 'f'].map((k) => k.charCodeAt(0)));
  const sandKey = new Set(['p', 'P'].map((k) => k.charCodeAt(0)));
  for (let X = HEART.w * 16; X < (HEART.w + 6) * 16; X += 4) {
    let Yw = null;
    for (let Y = 28 * 16; Y < 44 * 16 && Yw === null; Y += 1) if (wetKey.has(groundKey(X, Y))) Yw = Y;
    const coast = coastAt((X + 0.5) / 16) * 16;
    assert.ok(Yw !== null && Math.abs(Yw - coast) <= 10, `the shore at x ${X} is at ${Yw}, the vale's line at ${coast.toFixed(0)}`);
    let sand = 0;
    for (let Y = Yw - 12; Y < Yw; Y += 1) if (sandKey.has(groundKey(X, Y))) sand += 1;
    assert.ok(sand >= 6, `a beach above the water at x ${X}`);
  }
  // and the tiles agree with the vale's own: beach where its beach is, sea where its sea is
  for (let x = HEART.w + 1; x < HEART.w + 5; x += 1) {
    for (let y = 30; y < 40; y += 1) {
      const vale = naturalAt(x + 0.5, y + 13 / 16);
      const t = wilds.terrainAt(x, y);
      if (vale === VT.WATER) assert.ok([T.SEA, T.DEEP].includes(t), `${x},${y} is sea as the vale's is`);
      else if (vale === VT.SAND) assert.equal(t, T.SAND, `${x},${y} is beach as the vale's is`);
    }
  }
});

test('the frontier within 60 tiles of the vale can all be walked to from its gates', () => {
  for (const [seed, wg, w, n] of [['hushlands', worldgen, wilds, nav], ...[42, 's5'].map((sd) => {
    const g = createWorldgen({ seed: sd, regionWords: words.regionWords });
    const wl = createWilds({ worldgen: g, maxChunks: 400 });
    return [sd, g, wl, createNav({ worldgen: g, wildBlocked: wl.blocked })];
  })]) {
    // flood from the gates over what Milo can walk (far enough out to find the long way round)
    const R = 60;
    const OUT = R + 50;
    const x0 = -OUT;
    const y0 = -OUT;
    const BW = HEART.w + 2 * OUT;
    const BH = HEART.h + 2 * OUT;
    const seen = new Uint8Array(BW * BH);
    const queue = [];
    for (const g of GATE_TILES) { seen[(g.y - y0) * BW + (g.x - x0)] = 1; queue.push(g.x, g.y); }
    for (let q = 0; q < queue.length; q += 2) {
      const x = queue[q];
      const y = queue[q + 1];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < x0 || ny < y0 || nx >= x0 + BW || ny >= y0 + BH || inHeart(nx, ny)) continue;
        const i = (ny - y0) * BW + (nx - x0);
        if (seen[i] || !n.walkable(nx, ny)) continue;
        seen[i] = 1;
        queue.push(nx, ny);
      }
    }
    const shut = [];
    for (let y = -R; y < HEART.h + R; y += 1) {
      for (let x = -R; x < HEART.w + R; x += 1) {
        if (inHeart(x, y) || wg.heartDistance(x, y) > R || seen[(y - y0) * BW + (x - x0)] || !n.walkable(x, y)) continue;
        shut.push(`${x},${y}`);
      }
    }
    assert.deepEqual(shut.slice(0, 12), [], `${seed}: ${shut.length} walkable tiles near the vale no gate reaches`);
    // what opened them is part of the world: footbridges run straight, and the land agrees
    for (const [k, t] of wg.roads().fixes) {
      const [x, y] = k.split(',').map(Number);
      assert.equal(w.terrainAt(x, y), t, `${seed}: the wilds see ${k} as worldgen does`);
      if (t === T.BRIDGE) assert.ok(['ns', 'ew', 'x'].includes(wg.deckAt(x, y)), `${seed}: the footbridge at ${k} runs one way`);
    }
  }
});

test('nothing stands in the water: props keep dry ground under them, and the Glass Fen keeps its pools', () => {
  const fen = worldgen.anchorById['glass-fen'];
  const fcx = Math.floor(fen.x / CHUNK);
  const fcy = Math.floor(fen.y / CHUNK);
  const fenChunks = [];
  for (let cy = fcy - 1; cy <= fcy + 1; cy += 1) for (let cx = fcx - 1; cx <= fcx + 1; cx += 1) fenChunks.push(wilds.chunk(cx, cy));
  const WATERS = new Set([T.SEA, T.DEEP, T.RIVER]);
  const wetKey = new Set(['w', 'W', 'f'].map((k) => k.charCodeAt(0)));
  const keyAt = (px, py) => {
    const cx = Math.floor(px / CHUNK_PX);
    const cy = Math.floor(py / CHUNK_PX);
    wilds.ground(cx, cy);
    return wilds.chunk(cx, cy).ground[(py - cy * CHUNK_PX) * CHUNK_PX + (px - cx * CHUNK_PX)];
  };
  // Water pixels in a rect (w and W: f is foam on water, but also the light on snow).
  const deep = new Set(['w', 'W'].map((k) => k.charCodeAt(0)));
  const wetIn = (x0, y0, x1, y1) => {
    let n = 0;
    for (let py = y0; py < y1; py += 1) for (let px = x0; px < x1; px += 1) if (deep.has(keyAt(px, py))) n += 1;
    return n;
  };
  // The ground a prop's sprite stands on: its whole width (a statue's plinth is wider than its
  // tile) from half a tile up its footprint to a little below it, 3 px round.
  const baseRect = (o) => {
    const w = SPRITES[o.kind][0][0].length;
    const cx = (o.x + o.w / 2) * 16 + o.dx;
    const bottom = (o.y + o.h) * 16 + o.dy;
    return [Math.floor(cx - w / 2) - 3, bottom - 8, Math.ceil(cx + w / 2) + 3, bottom + 4];
  };
  // Every point of interest's prop on land, whether beside a pool, a lake or a river.
  let props = 0;
  let shrubs = 0;
  const kinds = new Set();
  for (const c of [...areaChunks, ...regionChunks, ...fenChunks]) {
    for (const p of c.pois) {
      const o = c.objects.find((x) => x.id === p.id);
      const t = o && wilds.terrainAt(o.x, o.y);
      if (!o || WATERS.has(t) || roadish(t) || t === T.SKY) continue; // on the water, a bridge or an isle
      assert.equal(wetIn(...baseRect(o)), 0, `${o.id}: the ${o.kind} stands on dry ground`);
      props += 1;
      kinds.add(o.kind);
    }
    // and the bushes and rocks, the marsh's too (its reeds may stand in the pools): nothing under
    // the bottom of the sprite
    for (const o of c.objects) {
      if (!['bush', 'bush.berry', 'rock', 'rock.basalt', 'dice.stone'].includes(o.kind)) continue;
      const w = SPRITES[o.kind][0][0].length;
      const cx = (o.x + 0.5) * 16 + o.dx;
      const bottom = (o.y + 1) * 16 + o.dy;
      assert.equal(wetIn(Math.floor(cx - w / 2), bottom - 6, Math.ceil(cx + w / 2), bottom), 0, `${o.id} stands on dry ground`);
      shrubs += 1;
    }
  }
  assert.ok(shrubs > 300, `${shrubs} bushes and rocks checked`);
  assert.ok(props > 200 && kinds.has('statue') && kinds.has('lantern.post'), `${props} props checked: ${[...kinds]}`);
  // In the marsh, where Milo stands at a point of interest is dry too (away from open water).
  let checked = 0;
  const types = new Set();
  let marshPx = 0;
  let poolPx = 0;
  for (const c of fenChunks) {
    for (const p of c.pois) {
      if (wilds.terrainAt(p.x, p.y) !== T.MARSH) continue;
      let open = false;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (WATERS.has(wilds.terrainAt(p.x + dx, p.y + dy))) open = true;
      if (open) continue;
      assert.equal(wetIn(p.x * 16 - 3, p.y * 16 - 3, p.x * 16 + 19, p.y * 16 + 19), 0, `${p.id}: Milo's tile is dry`);
      checked += 1;
      types.add(p.type);
    }
    wilds.ground(c.cx, c.cy);
    for (let j = 0; j < CHUNK; j += 1) {
      for (let i = 0; i < CHUNK; i += 1) {
        if (c.tiles[j * CHUNK + i] !== T.MARSH) continue;
        for (let k = 0; k < 256; k += 17) {
          marshPx += 1;
          if (wetKey.has(c.ground[(j * 16 + (k >> 4)) * CHUNK_PX + i * 16 + (k & 15)])) poolPx += 1;
        }
      }
    }
  }
  assert.ok(checked >= 4, `${checked} points of interest in the marsh: ${[...types]}`);
  assert.ok(poolPx / marshPx > 0.12, `pools cover ${(100 * poolPx / marshPx).toFixed(0)}% of the marsh`);
});

// ---------- the Hush and colour ----------

test('worldgen’s regions, reproduced: the Hush lies over exactly the regions', () => {
  // wilds reproduces worldgen's private regionDistance; tierAt uses it, so they must agree.
  let checked = 0;
  for (let y = -200; y <= 240; y += 7) {
    for (let x = -360; x <= 240; x += 7) {
      let tier = null;
      for (const a of worldgen.anchors) {
        if (a.radius && wilds.regionDistance(a, x, y) < 1) { tier = a.tier; break; }
      }
      if (tier === null) tier = Math.min(8, worldgen.depthAt(x, y));
      assert.equal(tier, worldgen.tierAt(x, y), `tier at ${x},${y}`);
      checked += 1;
    }
  }
  assert.ok(checked > 5000);
  // Deep inside each region the Hush is whole; far from all of them there is none.
  for (const a of worldgen.anchors.filter((r) => r.radius && r.id !== 'skyward-isles')) {
    assert.equal(wilds.hushAt(a.x, a.y), 255, `${a.id} waits in the Hush`);
    assert.equal(wilds.hushRegion(a.x, a.y)?.id, a.id);
  }
  assert.equal(wilds.hushAt(31, 22), 0, 'never over the vale');
  assert.equal(wilds.hushAt(-20, 20), 0, 'not between regions');
  const whisper = wilds.chunk(Math.floor(worldgen.anchorById.whisperwood.x / CHUNK), Math.floor(worldgen.anchorById.whisperwood.y / CHUNK));
  assert.ok(whisper.hush.every((v) => v >= 0 && v <= 255));
  assert.ok(whisper.hush.some((v) => v === 255));
  assert.equal(whisper.hush.wide.length, 34 * 34, 'a one-tile border for seamless fades');
  // the fade is dithered: some tiles part way
  let partial = 0;
  for (const c of areaChunks) for (const v of c.hush) if (v > 0 && v < 255) partial += 1;
  assert.ok(partial > 20, `${partial} tiles in the Hush's edge`);
});

test('the hush palette pulls colours 55% toward their grey and lifts them 6%', () => {
  const byKey = hushPalette();
  const grass = [0xaa, 0xd4, 0x8f];
  const grey = 0.299 * grass[0] + 0.587 * grass[1] + 0.114 * grass[2];
  const expected = grass.map((c) => Math.round((c + (grey - c) * 0.55) + (255 - (c + (grey - c) * 0.55)) * 0.06));
  assert.deepEqual(byKey.g, expected);
  const base = basePaletteByCode();
  const byCodeHush = hushPalette(base);
  assert.deepEqual(byCodeHush['g'.charCodeAt(0)], expected, 'same by code');
  assert.ok(!('x' in byKey), 'the translucent shadow has no hush colour');
  for (const [k, rgb] of Object.entries(byKey)) {
    const [r, g, b] = rgb;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const orig = base[k.charCodeAt(0)];
    assert.ok(spread <= Math.max(...orig) - Math.min(...orig), `${k} is greyer`);
  }
});

test('colouriseChunk: base, hush and bleeds, dithered by world pixels, and the vale stays clear', () => {
  const base = basePaletteByCode();
  const hush = hushPalette(base);
  const c = wilds.chunk(0, 1); // half vale, half wild, next to the bay
  wilds.ground(0, 1);
  const plain = colouriseChunk(c.ground, { base, originX: 0, originY: CHUNK_PX });
  for (let ly = 0; ly < CHUNK_PX; ly += 1) {
    const inVale = 32 + Math.floor(ly / 16) < HEART.h;
    for (const lx of [0, 100, 511]) assert.equal(plain[(ly * CHUNK_PX + lx) * 4 + 3], inVale ? 0 : 255, `alpha at ${lx},${ly}`);
  }
  // fully hushed: every wild pixel takes the hush colour of its key
  const full = new Uint8Array(1024).fill(255);
  const hushed = colouriseChunk(c.ground, { base, hush, hushMask: full, originX: 0, originY: CHUNK_PX });
  let checked = 0;
  for (let p = 0; p < c.ground.length; p += 97) {
    const code = c.ground[p];
    if (!code) continue;
    assert.deepEqual([...hushed.subarray(p * 4, p * 4 + 3)], hush[code]);
    checked += 1;
  }
  assert.ok(checked > 500);
  // a bleed overrides the hush inside its inner radius, and never touches the vale
  const neon = [];
  for (let k = 0; k < 128; k += 1) neon[k] = [255, 0, 128];
  const bleed = { x: 200, y: 330, inner: 30, outer: 60, palette: neon, wobble: 0 }; // in the wild half
  const bled = colouriseChunk(c.ground, { base, hush, hushMask: full, bleeds: [bleed], originX: 0, originY: CHUNK_PX });
  const at = (x, y) => [...bled.subarray((y * CHUNK_PX + x) * 4, (y * CHUNK_PX + x) * 4 + 4)];
  assert.deepEqual(at(bleed.x, bleed.y), [255, 0, 128, 255], 'the inner bleed wins');
  for (let y = 0; y < 12 * 16; y += 3) for (let x = 0; x < CHUNK_PX; x += 5) assert.equal(bled[(y * CHUNK_PX + x) * 4 + 3], 0, 'the vale stays clear');
  // the fade dithers in 2x2 blocks indexed by world pixels: shift the origin by one block, and
  // the pattern shifts with the world, not with the chunk
  const keys = new Uint8Array(64 * 64).fill('g'.charCodeAt(0));
  const mask = new Uint8Array(16).fill(128);
  const a = colouriseChunk(keys, { base, hush, hushMask: mask, width: 64, originX: 0, originY: 0 });
  const b = colouriseChunk(keys, { base, hush, hushMask: mask, width: 64, originX: 2, originY: 0 });
  const px = (buf, x, y) => buf[(y * 64 + x) * 4];
  let dithered = 0;
  for (let y = 20; y < 44; y += 1) {
    for (let x = 20; x < 42; x += 1) {
      assert.equal(px(b, x, y), px(a, x + 2, y), `world pixel ${x + 2},${y}`);
      if (px(a, x, y) !== px(a, x + 2, y)) dithered += 1;
    }
  }
  assert.ok(dithered > 0, 'half hushed is a real dither');
  for (let y = 20; y < 44; y += 2) for (let x = 20; x < 44; x += 2) {
    assert.equal(px(a, x, y), px(a, x + 1, y + 1), '2x2 blocks');
  }
  // two overlapping bleeds interleave (a fusion)
  const teal = [];
  for (let k = 0; k < 128; k += 1) teal[k] = [0, 128, 128];
  const fusion = colouriseChunk(keys, { base, width: 64, bleeds: [{ x: 32, y: 32, inner: 40, outer: 50, palette: neon }, { x: 32, y: 32, inner: 40, outer: 50, palette: teal }] });
  const seenColours = new Set();
  for (let p = 0; p < 64 * 64; p += 1) seenColours.add(fusion[p * 4]);
  assert.ok(seenColours.has(255) && seenColours.has(0), 'both genres show');
  // sliced colouring matches whole colouring
  const whole = colouriseChunk(c.ground, { base, hush, hushMask: c.hush, originX: 0, originY: CHUNK_PX });
  const sliced = new Uint8ClampedArray(whole.length);
  for (let r = 0; r < CHUNK_PX; r += 64) colouriseChunk(c.ground, { base, hush, hushMask: c.hush, originX: 0, originY: CHUNK_PX, from: r, to: r + 64, out: sliced });
  assert.ok(Buffer.from(sliced.buffer).equals(Buffer.from(whole.buffer)));
  // map art at 4 px a tile reads the same hush mask (tileSize)
  const small = new Uint8Array(128 * 128).fill('g'.charCodeAt(0));
  const topHalf = new Uint8Array(1024);
  for (let j = 0; j < 12; j += 1) for (let i = 0; i < 32; i += 1) topHalf[j * 32 + i] = 255;
  const mapArt = colouriseChunk(small, { base, hush, hushMask: topHalf, width: 128, tileSize: 4 });
  assert.deepEqual([...mapArt.subarray(0, 3)], hush['g'.charCodeAt(0)], 'top rows hushed');
  assert.deepEqual([...mapArt.subarray((100 * 128 + 5) * 4, (100 * 128 + 5) * 4 + 3)], base['g'.charCodeAt(0)], 'bottom rows not');
  // palettes by key work as well as by code
  const keyed = Object.fromEntries(Object.entries(PALETTE).filter(([, v]) => v.hex.startsWith('#')).map(([k, v]) => [k, [1, 3, 5].map((i) => parseInt(v.hex.slice(i, i + 2), 16))]));
  assert.deepEqual(colouriseChunk(keys, { base: keyed, width: 64 }), colouriseChunk(keys, { base, width: 64 }));
});

test('the Hush’s edge is a narrow band, two or three tiles, and the same across chunk edges', () => {
  // Every tile part way into the Hush is right beside the region's edge (a tile on the other side
  // of it among its eight neighbours): the dithered edge is a tile either side, however a region's
  // own edge runs.
  let partial = 0;
  const at = (x, y) => wilds.hushAt(x, y);
  for (const c of areaChunks) {
    for (let j = 0; j < CHUNK; j += 1) {
      for (let i = 0; i < CHUNK; i += 1) {
        const v = c.hush[j * CHUNK + i];
        if (v === 0 || v === 255) continue;
        partial += 1;
        const x = c.cx * CHUNK + i;
        const y = c.cy * CHUNK + j;
        let across = false;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((at(x + dx, y + dy) >= 128) !== (v >= 128)) across = true;
        assert.ok(across, `${x},${y} (${v}) is right at the region's edge`);
      }
    }
  }
  assert.ok(partial > 100, `${partial} tiles in the Hush's edge`);
  // The edge is wholly in the region's own tiles' reach: inside a region is 255 two tiles in.
  const whisper = worldgen.anchorById.whisperwood;
  assert.equal(at(whisper.x, whisper.y), 255);
  // A chunk's border values are its neighbours' own, so a fade crosses the edge without a step:
  // colouring two chunks apart gives the very pixels of colouring them as one picture.
  let pair = null;
  for (const c of areaChunks) {
    const right = areaChunks.find((d) => d.cx === c.cx + 1 && d.cy === c.cy);
    if (!right) continue;
    let edge = 0;
    for (let j = 0; j < CHUNK; j += 1) {
      const a = c.hush[j * CHUNK + CHUNK - 1];
      const b = right.hush[j * CHUNK];
      if (a !== b || (a > 0 && a < 255)) edge += 1;
      assert.equal(c.hush.wide[(j + 1) * (CHUNK + 2) + CHUNK + 1], b, `${c.key}: its border is its neighbour's own`);
      assert.equal(right.hush.wide[(j + 1) * (CHUNK + 2)], a, `${right.key}: and back`);
    }
    if (edge > 3 && !pair) pair = [c, right];
  }
  assert.ok(pair, 'a pair of chunks the Hush’s edge crosses between');
  const base = basePaletteByCode();
  const hush = hushPalette(base);
  const [a, b] = pair;
  wilds.ground(a.cx, a.cy);
  wilds.ground(b.cx, b.cy);
  const W = 2 * CHUNK_PX;
  const keys = new Uint8Array(W * CHUNK_PX);
  for (let y = 0; y < CHUNK_PX; y += 1) {
    keys.set(a.ground.subarray(y * CHUNK_PX, (y + 1) * CHUNK_PX), y * W);
    keys.set(b.ground.subarray(y * CHUNK_PX, (y + 1) * CHUNK_PX), y * W + CHUNK_PX);
  }
  const mask = new Uint8Array(2 * CHUNK * CHUNK);
  const wide = new Uint8Array((2 * CHUNK + 2) * (CHUNK + 2));
  for (let j = -1; j <= CHUNK; j += 1) {
    for (let i = -1; i <= 2 * CHUNK; i += 1) {
      const v = at(a.cx * CHUNK + i, a.cy * CHUNK + j);
      wide[(j + 1) * (2 * CHUNK + 2) + i + 1] = v;
      if (i >= 0 && j >= 0 && i < 2 * CHUNK && j < CHUNK) mask[j * 2 * CHUNK + i] = v;
    }
  }
  mask.wide = wide;
  const whole = colouriseChunk(keys, { base, hush, hushMask: mask, width: W, originX: a.cx * CHUNK_PX, originY: a.cy * CHUNK_PX });
  for (const [c, ox] of [[a, 0], [b, CHUNK_PX]]) {
    const own = colouriseChunk(c.ground, { base, hush, hushMask: c.hush, originX: c.cx * CHUNK_PX, originY: c.cy * CHUNK_PX });
    let differ = 0;
    for (let y = 0; y < CHUNK_PX; y += 1) {
      for (let x = 0; x < CHUNK_PX; x += 1) {
        const p = (y * CHUNK_PX + x) * 4;
        const q = (y * W + x + ox) * 4;
        if (own[p] !== whole[q] || own[p + 1] !== whole[q + 1] || own[p + 2] !== whole[q + 2]) differ += 1;
      }
    }
    assert.equal(differ, 0, `${c.key} coloured alone matches the joined picture`);
  }
});

// ---------- budgets (§10) ----------

test('budgets: a chunk in 20 ms, a 64-row ground slice in 12 ms, colouring in 25 ms', () => {
  const fresh = createWilds({ worldgen, maxChunks: 400 });
  // warm the JIT on a few chunks first
  for (let i = 0; i < 4; i += 1) { fresh.chunk(30 + i, 30); fresh.ground(30 + i, 30); }
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const p90 = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.9)];
  const chunkTimes = [];
  const sliceTimes = [];
  const colourTimes = [];
  const base = basePaletteByCode();
  const hush = hushPalette(base);
  const spots = [[-8, -6], [-7, -6], [-6, -6], [2, -5], [3, -5], [-4, 1], [-3, 1], [2, 3], [3, 3], [-1, 5], [0, 5], [3, -1], [-3, -3], [4, 2], [-5, 3], [1, -3]];
  // and the Glass Fen, where every marsh tile has pools to work out
  const fen = worldgen.anchorById['glass-fen'];
  const fenSpots = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) fenSpots.push([Math.floor(fen.x / CHUNK) + dx, Math.floor(fen.y / CHUNK) + dy]);
  const fenSlices = [];
  for (const [cx, cy] of [...spots, ...fenSpots]) {
    const inFen = fenSpots.some(([x, y]) => x === cx && y === cy);
    let t = performance.now();
    fresh.chunk(cx, cy);
    chunkTimes.push(performance.now() - t);
    for (let r = 0; r < CHUNK_PX; r += 64) {
      t = performance.now();
      fresh.ground(cx, cy, { from: r, to: r + 64 });
      sliceTimes.push(performance.now() - t);
      if (inFen) fenSlices.push(performance.now() - t);
    }
    const c = fresh.chunk(cx, cy);
    t = performance.now();
    colouriseChunk(c.ground, { base, hush, hushMask: c.hush, bleeds: [{ x: 256, y: 256, inner: 26, outer: 80, palette: base, wobble: 20, seed: 3 }], originX: cx * CHUNK_PX, originY: cy * CHUNK_PX });
    colourTimes.push(performance.now() - t);
  }
  assert.ok(median(chunkTimes) <= 20, `chunk() median ${median(chunkTimes).toFixed(1)} ms`);
  assert.ok(p90(chunkTimes) <= 40, `chunk() p90 ${p90(chunkTimes).toFixed(1)} ms`);
  assert.ok(median(sliceTimes) <= 8, `slice median ${median(sliceTimes).toFixed(1)} ms`);
  assert.ok(p90(sliceTimes) <= 12, `slice p90 ${p90(sliceTimes).toFixed(1)} ms`);
  assert.ok(median(fenSlices) <= 8 && p90(fenSlices) <= 12, `Glass Fen slices: median ${median(fenSlices).toFixed(1)}, p90 ${p90(fenSlices).toFixed(1)} ms`);
  assert.ok(median(colourTimes) <= 25, `colouriseChunk median ${median(colourTimes).toFixed(1)} ms`);
  // a hop's path is quick too
  const t = performance.now();
  for (let i = 0; i < 5; i += 1) nav.findPath(HOME, { x: 32 + i, y: -30 });
  assert.ok((performance.now() - t) / 5 < 60, 'findPath through the gate in well under a frame budget per call');
});

// ---------- the Stockade's banners, and the Hush's small pockets ----------

test('the Stockade raises two banners either side of the north gate, clear of the road, the table and the bell', () => {
  const north = GATE_TILES.find((g) => g.id === 'gate:n');
  assert.equal(wilds.ringObjects(1).filter((o) => o.kind === 'banner').length, 0, 'no banners at the camp');
  const banners = wilds.ringObjects(2).filter((o) => o.kind === 'banner');
  assert.equal(banners.length, 2, 'two banners from tier 2');
  assert.deepEqual(banners.map((b) => Math.sign(b.x - north.x)).sort(), [-1, 1], 'one each side of the gate');
  const war = wilds.warTable();
  const bell = wilds.ringObjects(2).find((o) => o.kind === 'gate.bell');
  for (const b of banners) {
    assert.ok(Math.abs(b.x - north.x) >= 2 && Math.abs(b.x - north.x) <= 5 && north.y - b.y >= 1 && north.y - b.y <= 2, `${b.id} stands just outside the wall by the gate`);
    assert.ok(!onRing(b.x, b.y) && !inHeart(b.x, b.y) && !beyondGate.has(`${b.x},${b.y}`), `${b.id} is off the wall and out of the gate's way`);
    const t = wilds.terrainAt(b.x, b.y);
    assert.ok(TERRAIN_INFO[t].walk && !roadish(t) && ![T.SEA, T.DEEP, T.RIVER].includes(t), `${b.id} stands on open land`);
    assert.ok(!(Math.abs(b.y - war.y) <= 1 && b.x >= war.x - 1 && b.x <= war.x + war.w), `${b.id} is clear of the war table`);
    assert.ok(Math.abs(b.x - bell.x) >= 2 || b.y !== bell.y, `${b.id} is clear of the Gate Bell`);
    assert.equal(b.blocks, false);
    assert.equal(Math.sign(b.dx), Math.sign(north.x - b.x), `${b.id} leans in toward the gate`);
    // nothing of the wilds' own stands on a banner's tile, at any tier
    assert.ok(!wilds.objectsIn(b.x - 1, b.y - 1, b.x + 1, b.y + 1).some((o) => Math.abs(o.x - b.x) <= 1 && Math.abs(o.y - b.y) <= 1), `${b.id} has room`);
    assert.ok(SPRITES.banner, 'the banner sprite exists');
  }
  assert.notEqual(banners[0].phase, banners[1].phase, 'they sway out of step');
  // in other worlds they find their places too, never on the road
  for (const seed of [42, 's5']) {
    const wg = createWorldgen({ seed, regionWords: words.regionWords });
    const other = createWilds({ worldgen: wg, maxChunks: 16 });
    const list = other.ringObjects(2).filter((o) => o.kind === 'banner');
    assert.equal(list.length, 2, `${seed}: two banners`);
    for (const b of list) assert.ok(!roadish(other.terrainAt(b.x, b.y)), `${seed}: ${b.id} is off the road`);
  }
});

test('the Hush ignores small pockets: no hole in a region, and no speck of one, of 16 tiles or fewer', () => {
  // The two holes that showed as dithered blotches in the Whisperwood and across the road east of
  // it lie wholly in the Hush now.
  for (const [x, y] of [[12, -26], [13, -25], [52, -14], [52, -12]]) assert.equal(wilds.hushAt(x, y), 255, `${x},${y} is in the Hush`);
  // And no pocket of either side of a region's edge is that small anywhere near (four-way).
  const X0 = -150;
  const Y0 = -150;
  const W = 330;
  const H = 330;
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) inside[y * W + x] = wilds.hushAt(X0 + x, Y0 + y) >= 128 ? 1 : 0;
  const seen = new Uint8Array(W * H);
  let pockets = 0;
  for (let i = 0; i < W * H; i += 1) {
    if (seen[i]) continue;
    const me = inside[i];
    const list = [i];
    seen[i] = 1;
    let edge = false;
    for (let q = 0; q < list.length; q += 1) {
      const j = list[q];
      const x = j % W;
      const y = Math.floor(j / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge = true; continue; }
        const n = ny * W + nx;
        if (seen[n] || inside[n] !== me) continue;
        seen[n] = 1;
        list.push(n);
      }
    }
    if (edge || list.length > 16) continue;
    // the vale's own tiles are never in the Hush: a pocket against them isn't one
    if (list.some((j) => { const x = X0 + (j % W); const y = Y0 + Math.floor(j / W); return x >= -1 && y >= -1 && x <= HEART.w && y <= HEART.h; })) continue;
    pockets += 1;
    assert.fail(`a ${me ? 'speck' : 'hole'} of ${list.length} tiles at ${X0 + (i % W)},${Y0 + Math.floor(i / W)}`);
  }
  assert.equal(pockets, 0);
  // The region a hole's hush belongs to is the one round it.
  assert.equal(wilds.hushRegion(12, -26)?.id, 'whisperwood');
});

// ---------- the Gate Bell ----------

test('the Gate Bell stands on its own post beside the north road, clear of every other piece of the Stockade and of the trees', async () => {
  const { PALISADE_CELL } = await import('../src/world/scene-art.js');
  // Sprite boxes worked out here as the engine places objects (placeObject): centred on the tiles'
  // middle plus dx, feet on their bottom edge plus dy; the palisade is its composed cell.
  const box = (o) => {
    const rows = o.kind === 'palisade' ? null : SPRITES[o.kind][(o.frame || 0) % SPRITES[o.kind].length];
    const w = rows ? rows[0].length : PALISADE_CELL.w;
    const h = rows ? rows.length : PALISADE_CELL.h;
    const cx = (o.x + (o.w || 1) / 2) * 16 + (o.dx || 0);
    const by = (o.y + (o.h || 1)) * 16 + (o.dy || 0);
    return { x0: Math.round(cx - w / 2), x1: Math.round(cx - w / 2) + w, y0: by - h, y1: by };
  };
  const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const north = GATE_TILES.find((g) => g.id === 'gate:n');
  for (const [seed, w] of [['hushlands', wilds], ...[42, 's5', 7].map((s) => [s, createWilds({ worldgen: createWorldgen({ seed: s, regionWords: words.regionWords }), maxChunks: 64 })])]) {
    assert.equal(w.ringObjects(1).filter((o) => o.kind === 'gate.bell').length, 0, `${seed}: no bell at the camp`);
    const ring = w.ringObjects(2);
    const bells = ring.filter((o) => o.kind === 'gate.bell');
    assert.equal(bells.length, 1, `${seed}: one Gate Bell from tier 2`);
    const [bell] = bells;
    assert.equal(bell.place, 'gate:n');
    assert.deepEqual({ x: bell.x, y: bell.y }, w.bellSpot(), `${seed}: where bellSpot says`);
    // Freestanding on open ground just outside the wall, off the road but beside it.
    assert.ok(!onRing(bell.x, bell.y) && !inHeart(bell.x, bell.y) && !beyondGate.has(`${bell.x},${bell.y}`), `${seed}: off the wall and out of the gateway`);
    assert.ok(bell.y < north.y && north.y - bell.y <= 4 && Math.abs(bell.x - north.x) <= 3, `${seed}: just outside the north gate (${bell.x},${bell.y})`);
    const t = w.terrainAt(bell.x, bell.y);
    assert.ok(TERRAIN_INFO[t].walk && !roadish(t) && ![T.SEA, T.DEEP, T.RIVER].includes(t), `${seed}: on open land`);
    if (seed === 'hushlands') assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roadish(w.terrainAt(bell.x + dx, bell.y + dy))), 'beside the road');
    // Its sprite overlaps no other ring object's: not the palisade's stakes, the gatehouse, a banner or the War Table.
    const mine = box(bell);
    for (const o of ring) {
      if (o === bell) continue;
      assert.ok(!overlap(mine, box(o)), `${seed}: the bell (${JSON.stringify(mine)}) is clear of ${o.id} (${JSON.stringify(box(o))})`);
    }
    // Nor does any tree, rock or prop of the wilds' own stand over it, at any tier (the wilds'
    // pines and birches crowd right up to it: a tree a tile off would hide its post).
    for (let cy = Math.floor((bell.y - 8) / CHUNK); cy <= Math.floor((bell.y + 3) / CHUNK); cy += 1) for (let cx = Math.floor((bell.x - 8) / CHUNK); cx <= Math.floor((bell.x + 8) / CHUNK); cx += 1) w.chunk(cx, cy);
    assert.ok(w.objectsIn(bell.x - 8, bell.y - 8, bell.x + 8, bell.y).some((o) => TREES.has(o.kind)), `${seed}: trees stand near the gate`);
    for (const o of w.objectsIn(bell.x - 3, bell.y - 3, bell.x + 3, bell.y + 3)) {
      if (!SPRITES[o.kind]) continue;
      assert.ok(!overlap(mine, box(o)), `${seed}: the bell is clear of ${o.id}`);
    }
    // And the vale's own props just inside the wall (the tree line) stand clear of it too.
    for (const o of MAP.objects) {
      if (o.y > 3 || !SPRITES[o.kind]) continue;
      assert.ok(!overlap(mine, box(o)), `${seed}: the bell is clear of the vale's ${o.kind} at ${o.x},${o.y}`);
    }
  }
});
