// The procedural world beyond Hearthvale (WORLD.md): src/world/worldgen.js and wildsart.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP } from '../src/world/map.js';
import { PALETTE } from '../src/world/sprites.js';
import { createWorldgen, ANCHORS, CHUNK, GATES, HEART, TERRAIN, TERRAIN_INFO } from '../src/world/worldgen.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { basePaletteByCode, byCode, colourise, paintRegion } from '../src/world/wildsart.js';
import { buildGenrePalette } from '../src/world/genres.js';

const words = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
const genres = JSON.parse(readFileSync(new URL('../content/genres.json', import.meta.url), 'utf8'));
const fortress = JSON.parse(readFileSync(new URL('../content/fortress.json', import.meta.url), 'utf8'));
const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
const T = TERRAIN;
const WARDS = fortress.tiers.map((t) => t.wardRadius);

test('the Hearth climbs from camp to kingdom, its ward always widening, and every defence is real', () => {
  const kinds = new Set(['crew-sessions-finished', 'buildings-designed', 'days-with-milo', 'focus-sessions', 'building-level', 'quests-finished', 'delve-finished', 'calendar-connected', 'buildings-at-level', 'residents', 'story-act', 'skill-level']);
  assert.equal(fortress.tiers[0].id, 'camp');
  assert.equal(fortress.tiers[0].wardRadius, 0, 'the camp is only the vale');
  fortress.tiers.forEach((tier, i) => {
    assert.equal(tier.tier, i + 1);
    assert.ok(tier.name && tier.look, tier.id);
    if (i > 0) {
      assert.ok(tier.wardRadius > fortress.tiers[i - 1].wardRadius, `${tier.id} ward grows`);
      assert.ok(tier.requirements.length > 0, `${tier.id} needs real progress`);
      assert.ok(tier.construction > fortress.tiers[i - 1].construction, `${tier.id} Construction`);
    }
    for (const r of tier.requirements) {
      assert.ok(kinds.has(r.kind), `${tier.id}: ${r.kind}`);
      assert.ok(r.count > 0 && r.text, `${tier.id}: ${r.kind}`);
    }
    assert.ok(tier.defences.length > 0 && tier.defences.every((d) => d.name && d.real), `${tier.id} defences are real`);
  });
  assert.ok(!JSON.stringify(fortress).includes('!'), 'calm copy');
});

test('the same seed makes the same world, anywhere; another seed makes another', () => {
  const again = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  for (const [cx, cy] of [[0, 0], [-3, 2], [5, -4], [400, -300], [-9000, 12000]]) {
    assert.deepEqual(again.chunk(cx, cy).tiles, world.chunk(cx, cy).tiles, `chunk ${cx},${cy}`);
    assert.deepEqual(again.chunk(cx, cy).pois, world.chunk(cx, cy).pois, `pois ${cx},${cy}`);
  }
  assert.deepEqual(again.wildRiftSpawns(-4, -5, 9), world.wildRiftSpawns(-4, -5, 9));
  const other = createWorldgen({ seed: 'another story', regionWords: words.regionWords });
  let differ = 0;
  for (let cx = -6; cx < 6; cx += 1) differ += other.chunk(cx, -5).tiles.some((t, i) => t !== world.chunk(cx, -5).tiles[i]) ? 1 : 0;
  assert.ok(differ >= 6, `${differ} of 12 chunks differ`);
});

test('the story keeps its shape under every seed: regions stay near their places in the Long Road', () => {
  for (const seed of ['hushlands', 'another story', 42]) {
    const w = createWorldgen({ seed });
    for (const base of ANCHORS) {
      const a = w.anchorById[base.id];
      assert.ok(Math.abs(a.x - base.x) <= 8 && Math.abs(a.y - base.y) <= 8, `${seed}: ${base.id} jitter`);
    }
    assert.equal(w.anchorById.hearthvale.x, 32);
  }
});

test('Hearthvale is untouched: every tile is the vale, walkable, with no roads, points of interest or rifts in it', () => {
  for (let y = 0; y < HEART.h; y += 1) {
    for (let x = 0; x < HEART.w; x += 1) {
      assert.equal(world.terrainAt(x, y), T.HEART);
      assert.ok(world.walkable(x, y));
    }
  }
  assert.equal(HEART.w, MAP.width);
  assert.equal(HEART.h, MAP.height);
  for (const key of world.roads().tiles) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(!world.inHeart(x, y), `road tile ${key} is inside the vale`);
  }
  for (let cy = -1; cy <= 2; cy += 1) {
    for (let cx = -1; cx <= 2; cx += 1) {
      for (const p of world.chunk(cx, cy).pois) assert.ok(!world.inHeart(p.x, p.y), `${p.type} at ${p.x},${p.y} is inside the vale`);
      for (let day = 0; day < 20; day += 1) {
        for (const s of world.wildRiftSpawns(cx, cy, day)) assert.ok(!world.inHeart(s.x, s.y), `a wild rift at ${s.x},${s.y} on day ${day}`);
      }
    }
  }
});

test('each gate is a real gap in the vale\'s tree line, and a road starts right outside it', () => {
  const blocked = new Set();
  for (const o of MAP.objects) {
    if (o.blocks === false) continue;
    for (let y = o.y; y < o.y + (o.h || 1); y += 1) for (let x = o.x; x < o.x + (o.w || 1); x += 1) blocked.add(`${x},${y}`);
  }
  for (const [id, gate] of Object.entries(GATES)) {
    const { edge, dir } = gate;
    assert.ok(world.inHeart(edge.x, edge.y), `${id} edge is inside the vale`);
    assert.ok(!world.inHeart(edge.x + dir.x, edge.y + dir.y), `${id} leads out of the vale`);
    assert.ok(!blocked.has(`${edge.x},${edge.y}`), `${id} edge is free of trees and fences`);
    assert.equal(MAP.tiles[edge.y][edge.x], '.', `${id} edge is grass`);
    assert.ok([T.ROAD, T.BRIDGE].includes(world.terrainAt(edge.x + dir.x, edge.y + dir.y)), `${id} has a road outside`);
  }
});

test('the roads join every region to the vale, walking only on road, bridge and the vale itself', () => {
  const passable = (x, y) => [T.ROAD, T.BRIDGE, T.HEART].includes(world.terrainAt(x, y));
  const seen = new Set(['32,22']);
  const queue = [[32, 22]];
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !passable(x + dx, y + dy)) continue;
      seen.add(k);
      queue.push([x + dx, y + dy]);
    }
  }
  const nearRoad = (px, py) => {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) if (seen.has(`${px + dx},${py + dy}`)) return true;
    return false;
  };
  for (const a of world.anchors) {
    if (['hearthvale', 'skyward-isles', 'far-shore'].includes(a.id)) continue; // by kite and by ferry
    assert.ok(nearRoad(a.x, a.y), `${a.name} is on the road network`);
  }
  const westwatch = world.fixedPois().find((p) => p.name === 'The Westwatch');
  assert.ok(nearRoad(westwatch.x, westwatch.y), 'the Westwatch is on the road network');
  // Every tile of road is walkable ground (bridges over rivers and inlets included).
  for (const k of seen) {
    const [x, y] = k.split(',').map(Number);
    assert.ok(world.walkable(x, y), `${k} is walkable`);
  }
});

test('landmarks, lanterns and statues stand on ground you can reach (the Skyward Isles on their isles)', () => {
  const fixed = world.fixedPois();
  for (const type of ['landmark', 'lantern', 'statue', 'quay']) assert.ok(fixed.some((p) => p.type === type), `there is a ${type}`);
  for (const p of fixed) {
    if (p.region === 'skyward-isles') assert.equal(world.terrainAt(p.x, p.y), T.SKY, p.name);
    else assert.ok(world.walkable(p.x, p.y) && !world.inHeart(p.x, p.y), `${p.name} at ${p.x},${p.y}`);
  }
  // One of Tamsin's unfinished statues in every region; Captain Sloe's quay on Mistmere's shore.
  assert.equal(fixed.filter((p) => p.type === 'statue').length, ANCHORS.length - 1);
  const quay = fixed.find((p) => p.type === 'quay');
  assert.equal(quay.region, 'mistmere');
  const water = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => [T.SEA, T.DEEP].includes(world.terrainAt(quay.x + dx, quay.y + dy)));
  assert.ok(water, 'the quay is on the water');
  // The regions are what the story says they are.
  const at = (id) => { const a = world.anchorById[id]; return world.terrainAt(a.x, a.y); };
  assert.ok([T.BASALT, T.ROAD].includes(at('cinderforge')));
  assert.ok([T.MARSH, T.RIVER, T.ROAD, T.BRIDGE].includes(at('glass-fen')));
  assert.equal(at('skyward-isles'), T.SKY);
  assert.ok(world.walkable(world.anchorById['far-shore'].x, world.anchorById['far-shore'].y));
});

test('points of interest fill the wilds and are all on walkable ground', () => {
  const counts = {};
  for (let cy = -6; cy < 6; cy += 1) {
    for (let cx = -8; cx < 6; cx += 1) {
      for (const p of world.chunk(cx, cy).pois) {
        counts[p.type] = (counts[p.type] || 0) + 1;
        if (p.region !== 'skyward-isles') assert.ok(world.walkable(p.x, p.y), `${p.type} at ${p.x},${p.y}`);
      }
    }
  }
  for (const type of ['lantern', 'ruin', 'cave', 'chest', 'hamlet']) assert.ok(counts[type] > 0, `some ${type}s (${JSON.stringify(counts)})`);
  assert.ok(counts.lantern >= 12, `lanterns along the roads (${counts.lantern})`);
});

test('wild rifts never open inside the Hearthward, at any tier, on any day', () => {
  for (const ward of WARDS) {
    for (let day = 0; day < 6; day += 1) {
      for (let cy = -10; cy <= 10; cy += 2) {
        for (let cx = -12; cx <= 10; cx += 2) {
          for (const s of world.wildRiftSpawns(cx, cy, day, { wardRadius: ward })) {
            assert.ok(world.heartDistance(s.x, s.y) > ward, `ward ${ward}: ${s.x},${s.y}`);
            assert.ok(world.walkable(s.x, s.y), `${s.x},${s.y} is walkable`);
            assert.ok(s.tier >= 1 && s.tier <= 8 && s.depth >= 1);
          }
        }
      }
    }
  }
});

test('the wilds hold new rifts every day, and more of them further out', () => {
  const count = (cx0, cx1, cy0, cy1, day) => {
    let n = 0;
    for (let cy = cy0; cy < cy1; cy += 1) for (let cx = cx0; cx < cx1; cx += 1) n += world.wildRiftSpawns(cx, cy, day, { wardRadius: 12 }).length;
    return n;
  };
  const spots = (day) => {
    const out = [];
    for (let cy = -4; cy < 2; cy += 1) for (let cx = -6; cx < 0; cx += 1) out.push(...world.wildRiftSpawns(cx, cy, day).map((s) => `${s.x},${s.y}`));
    return out;
  };
  const [monday, tuesday] = [spots(0), spots(1)];
  assert.ok(monday.length > 0 && tuesday.length > 0);
  assert.ok(monday.filter((spot) => tuesday.includes(spot)).length < monday.length / 2, 'different days, different rifts');
  let near = 0;
  let far = 0;
  for (let day = 0; day < 8; day += 1) {
    near += count(-2, 4, -2, 3, day); // around the vale
    far += count(-7, -1, -8, -3, day); // the Greyreach side
  }
  assert.ok(far > near, `further out is busier (near ${near}, far ${far})`);
});

test('no rift ever opens on the Far Shore', () => {
  const shore = world.anchorById['far-shore'];
  for (let day = 0; day < 30; day += 1) {
    for (let cy = Math.floor((shore.y - 40) / CHUNK); cy <= Math.floor((shore.y + 40) / CHUNK); cy += 1) {
      for (let cx = Math.floor((shore.x - 40) / CHUNK); cx <= Math.floor((shore.x + 40) / CHUNK); cx += 1) {
        for (const s of world.wildRiftSpawns(cx, cy, day)) {
          assert.ok(Math.hypot(s.x - shore.x, s.y - shore.y) > shore.radius * 1.5, `a rift at ${s.x},${s.y} on day ${day}`);
        }
      }
    }
  }
  assert.ok(world.standingBleeds().every((b) => Math.hypot(b.x - shore.x, b.y - shore.y) > shore.radius * 2));
});

test('real rifts open on the frontier, facing their genre, and the more urgent the closer to the walls', () => {
  const rifts = createRiftgen({ words, genres });
  const spec = rifts.realRift({ key: 'repo:test', subject: 'the test repo', signals: ['check-failing'] });
  for (const ward of [0, 12, 48, 140]) {
    const spots = [0.05, 0.35, 0.65, 0.95].map((urgency) => world.placeRealRift(spec, { urgency, wardRadius: ward }));
    for (const s of spots) {
      assert.ok(!world.inHeart(s.x, s.y), 'never inside the vale');
      assert.ok(world.heartDistance(s.x, s.y) > ward, `outside ward ${ward}`);
      assert.ok(world.walkable(s.x, s.y), 'on land you can walk to');
      assert.equal(s.towards, 'cinderforge', 'Neon rifts face Cinderforge');
    }
    for (let i = 1; i < spots.length; i += 1) assert.ok(spots[i].beyond <= spots[i - 1].beyond + 1, `ward ${ward}: urgency ${i} is no further out`);
    assert.ok(spots[3].beyond < spots[0].beyond, `ward ${ward}: urgent rifts come closest`);
  }
  // The same cause is always the same spot.
  assert.deepEqual(world.placeRealRift(spec, { urgency: 0.5, wardRadius: 12 }), world.placeRealRift(spec, { urgency: 0.5, wardRadius: 12 }));
  // Titans rise from the sea.
  const titan = rifts.realRift({ key: 'quest:finals', subject: 'finals', signals: ['big-deadline-approaching'] });
  const spot = world.placeRealRift(titan, { urgency: 0.5, wardRadius: 12 });
  assert.ok([T.SEA, T.DEEP].includes(world.terrainAt(spot.x, spot.y)), 'a Titan is at sea');
});

test('the world goes on forever: far chunks, deep tiers and names for places nobody has named', () => {
  for (const [cx, cy] of [[1000, 1000], [-2500, 300], [77, -4000]]) {
    const c = world.chunk(cx, cy);
    assert.equal(c.tiles.length, CHUNK * CHUNK);
    assert.ok(c.tiles.every((t) => t < TERRAIN_INFO.length && t !== T.HEART));
    for (const p of c.pois) assert.ok(p.depth > 100, 'depth keeps growing');
  }
  assert.ok(world.depthAt(20000, 0) > 300);
  assert.equal(world.tierAt(20000, 0), 8);
  assert.equal(world.tierAt(32, 22), 1);
  const name = world.regionAt(5000, -5000);
  assert.match(name, /^the [A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.equal(world.regionAt(5000, -5000), name);
  assert.equal(world.regionAt(10, 10), 'Hearthvale');
  assert.equal(world.regionAt(world.anchorById.greyreach.x, world.anchorById.greyreach.y), 'The Greyreach');
});

test('the Greyreach is a patchwork of genres that never closes', () => {
  const grey = world.anchorById.greyreach;
  const ids = new Set(genres.genres.map((g) => g.id));
  const patches = world.standingBleeds().filter((b) => b.place === 'greyreach');
  assert.ok(patches.length >= 12);
  assert.ok(new Set(patches.map((b) => b.genre)).size >= 4, 'many genres');
  for (const b of patches) {
    assert.ok(ids.has(b.genre));
    assert.ok(Math.hypot(b.x - grey.x, b.y - grey.y) < grey.radius * 1.4);
    assert.ok(![T.SEA, T.DEEP].includes(world.naturalTerrain(b.x, b.y)));
  }
  assert.deepEqual(createWorldgen({ seed: 'hushlands' }).standingBleeds(), world.standingBleeds());
});

test('a chunk generates quickly enough to stream while walking', () => {
  const fresh = createWorldgen({ seed: 'streaming' });
  fresh.roads();
  const started = performance.now();
  for (let i = 0; i < 48; i += 1) fresh.chunk(i - 24, (i % 7) - 3);
  const each = (performance.now() - started) / 48;
  assert.ok(each < 40, `${each.toFixed(1)} ms per chunk`);
});

test('the wilds are painted in world palette keys, so genres recolour them like the vale', () => {
  const region = paintRegion(world, -8, -6, 24, 20, 8);
  const keys = new Set(Object.keys(PALETTE).map((k) => k.charCodeAt(0)));
  let clear = 0;
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const code = region.keys[y * region.width + x];
      const tx = -8 + Math.floor(x / 8);
      const ty = -6 + Math.floor(y / 8);
      if (world.inHeart(tx, ty)) { assert.equal(code, 0, 'the vale is left for its own map'); clear += 1; } else assert.ok(keys.has(code), `pixel ${x},${y}`);
    }
  }
  assert.ok(clear > 0);
  const base = basePaletteByCode();
  const plain = colourise(region.keys, region.width, region.height, base);
  const neon = byCode(buildGenrePalette(genres.genres.find((g) => g.id === 'neon')));
  const bled = colourise(region.keys, region.width, region.height, base, [{ x: 20, y: 20, inner: 24, outer: 40, wobble: 0, palette: neon }]);
  const at = (data, x, y) => Array.from(data.slice((y * region.width + x) * 4, (y * region.width + x) * 4 + 3));
  assert.notDeepEqual(at(bled, 20, 20), at(plain, 20, 20), 'recoloured inside the bleed');
  assert.deepEqual(at(bled, 5, 150), at(plain, 5, 150), 'untouched far from it');
  // Every size paints without gaps.
  for (const size of [1, 2, 4, 16]) {
    const r = paintRegion(world, 100, 100, 6, 5, size);
    assert.ok(r.keys.every((code) => keys.has(code)), `size ${size}`);
  }
});
