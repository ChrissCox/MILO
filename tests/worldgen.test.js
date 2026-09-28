// The procedural world beyond Hearthvale (WORLD.md): src/world/worldgen.js and wildsart.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP } from '../src/world/map.js';
import { PALETTE } from '../src/world/sprites.js';
import { createWorldgen, layRoad, ANCHORS, CHUNK, GATES, GATE_LANE, DECK_CLEAR, HEART, MIN_WATER, TERRAIN, TERRAIN_INFO } from '../src/world/worldgen.js';
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

test('a fishing spot always has water to fish in within two tiles; the same pick elsewhere is herbs', () => {
  const WATERY = new Set([T.SEA, T.DEEP, T.RIVER, T.MARSH]);
  const waterNear = (x, y) => {
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (!world.inHeart(x + dx, y + dy) && WATERY.has(world.terrainAt(x + dx, y + dy))) return true;
    return false;
  };
  let fishing = 0;
  let herbs = 0;
  for (let cy = -12; cy <= 12; cy += 1) {
    for (let cx = -12; cx <= 12; cx += 1) {
      for (const p of world.chunk(cx, cy).pois) {
        if (p.type === 'fishing') { fishing += 1; assert.ok(waterNear(p.x, p.y), `the fishing spot at ${p.x},${p.y} has water beside it`); }
        if (p.type === 'herbs') herbs += 1;
      }
    }
  }
  assert.ok(fishing >= 5 && herbs >= 5, `${fishing} fishing spots, ${herbs} herbs`);
  // In the pinewood north of the vale the pick was fishing, with no water near: it's herbs, and
  // the chunk's other points of interest are just where the same draws put them.
  const pois = world.chunk(0, -2).pois.map((p) => `${p.type}:${p.x},${p.y}`);
  assert.deepEqual(pois.slice(-5), ['chest:3,-62', 'ruin:6,-43', 'cave:12,-61', 'ore:21,-61', 'herbs:22,-46']);
});

test('no stray ponds: water that doesn’t make a body of MIN_WATER tiles is land', () => {
  const WATERS = new Set([T.SEA, T.DEEP, T.RIVER]);
  const seen = new Set();
  let bodies = 0;
  let same = 0;
  for (let y = -60; y < 100; y += 1) {
    for (let x = -80; x < 150; x += 1) {
      const k = `${x},${y}`;
      if (world.inHeart(x, y) || seen.has(k) || !WATERS.has(world.naturalTerrain(x, y))) continue;
      const body = [[x, y]];
      const mine = new Set([k]);
      for (let q = 0; q < body.length && body.length < MIN_WATER; q += 1) {
        const [bx, by] = body[q];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = `${bx + dx},${by + dy}`;
          if (mine.has(nk) || world.inHeart(bx + dx, by + dy) || !WATERS.has(world.naturalTerrain(bx + dx, by + dy))) continue;
          mine.add(nk);
          body.push([bx + dx, by + dy]);
        }
      }
      for (const nk of mine) seen.add(nk);
      assert.ok(body.length >= MIN_WATER, `water at ${k} is a body of ${body.length} tiles`);
      bodies += 1;
    }
  }
  assert.ok(bodies > 3);
  // the filled ponds take the land round them, and the same seed fills the same ones
  const again = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  for (let y = 20; y < 40; y += 1) for (let x = 60; x < 90; x += 1) if (again.naturalTerrain(x, y) === world.naturalTerrain(x, y)) same += 1;
  assert.equal(same, 600, 'deterministic');
  assert.notEqual(world.naturalTerrain(64, 31), T.RIVER, 'the one-tile river by the bay is land');
});

test('roads cross water only on straight decks, two tiles wide, bank to bank', () => {
  const r = world.roads();
  let decks = 0;
  for (const k of r.tiles) {
    const [x, y] = k.split(',').map(Number);
    if (world.terrainAt(x, y) !== T.BRIDGE) continue;
    decks += 1;
    const dir = world.deckAt(x, y);
    assert.ok(['ns', 'ew', 'x'].includes(dir), `the bridge at ${k} is a deck (${dir})`);
  }
  assert.ok(decks > 16, `${decks} deck tiles`);
  // layRoad: a diagonal line over a river becomes one straight deck, or two meeting on a landing,
  // squared off bank to bank; a line that only brushes the water narrows rather than jut out
  const river = (x, y) => x >= 10 && x <= 13; // a river four tiles wide, running north-south
  const laid = new Map();
  layRoad([{ x: 4, y: 0 }, { x: 20, y: 8 }], { wet: river }, (x, y, deck) => laid.set(`${x},${y}`, deck));
  const over = [...laid].filter(([k]) => river(...k.split(',').map(Number)));
  assert.ok(over.length >= 8 && over.every(([, d]) => d === 'ew'), 'the river is crossed on an east-west deck');
  const rows = new Set(over.map(([k]) => k.split(',')[1]));
  assert.equal(rows.size, 2, 'two tiles wide, straight across');
  for (const row of rows) for (let x = 10; x <= 13; x += 1) assert.equal(laid.get(`${x},${row}`), 'ew', `bank to bank on row ${row}`);
  const along = new Map();
  layRoad([{ x: 0, y: 0 }, { x: 0, y: 12 }], { wet: (x) => x === 1 }, (x, y, deck) => along.set(`${x},${y}`, deck));
  assert.ok([...along.keys()].every((k) => k.split(',')[0] !== '1'), 'a road beside the water keeps off it');
});

// ---------- rivers' ends, gates' roads and places by the bridges ----------

const OTHER_WORLDS = [42, 's5'].map((seed) => createWorldgen({ seed, regionWords: words.regionWords }));

test('rivers end by narrowing to a tip: never against the vale\'s walls, the hills or ground that takes none', () => {
  for (const w of [world, ...OTHER_WORLDS]) {
    // No river comes within two tiles of the walls, so none ends against them or leaves a stub
    // cut off between a bridge and the wall (the north gate's old pond).
    for (let y = -4; y <= HEART.h + 3; y += 1) {
      for (let x = -4; x <= HEART.w + 3; x += 1) {
        if (w.inHeart(x, y) || w.heartDistance(x, y) > 3) continue;
        assert.notEqual(w.naturalTerrain(x, y), T.RIVER, `${w.seed}: no river at ${x},${y}, beside the walls`);
      }
    }
  }
  // Where a river nears Cinderforge's basalt, or the Peaks' snow and rock, it has narrowed to a tip
  // first: never two of its tiles side by side against that ground (a river cut off square).
  const HARD = new Set([T.BASALT, T.SNOW, T.ROCK, T.MOUNTAIN]);
  for (const w of [world, OTHER_WORLDS[0]]) {
    let touching = 0;
    for (const id of ['cinderforge', 'archive-peaks']) {
      const a = w.anchorById[id];
      const r = Math.ceil(a.radius * 1.6);
      const against = new Set();
      for (let y = a.y - r; y <= a.y + r; y += 1) {
        for (let x = a.x - r; x <= a.x + r; x += 1) {
          if (w.naturalTerrain(x, y) !== T.RIVER) continue;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => HARD.has(w.naturalTerrain(x + dx, y + dy)))) against.add(`${x},${y}`);
        }
      }
      touching += against.size;
      for (const k of against) {
        const [x, y] = k.split(',').map(Number);
        assert.ok(!against.has(`${x + 1},${y}`) && !against.has(`${x},${y + 1}`), `${w.seed}: the river at ${k} meets ${id}'s ground as a tip, not cut off square`);
      }
    }
    assert.ok(touching < 12, `${w.seed}: ${touching} river tiles touch that ground at all`);
  }
  // And where the land climbs toward the hills a river has already narrowed and gone before the
  // height where it used to stop at full width (0.72): in this world, none is left past 0.71.
  for (const w of [world, OTHER_WORLDS[1]]) {
    for (let y = -140; y <= 180; y += 2) {
      for (let x = -200; x <= 200; x += 2) {
        if (w.naturalTerrain(x, y) === T.RIVER) assert.ok(w.elevationAt(x, y) < 0.71, `${w.seed}: the river at ${x},${y} has narrowed away below the hills`);
      }
    }
  }
  // The rivers are still there: the world keeps its rivers, only their ends change.
  let river = 0;
  for (let y = -100; y <= 140; y += 1) for (let x = -120; x <= 180; x += 1) if (world.naturalTerrain(x, y) === T.RIVER) river += 1;
  assert.ok(river > 1500, `${river} river tiles`);
});

test('the road meets each gate one lane wide, on the gate\'s own line, and widens beyond', () => {
  for (const w of [world, ...OTHER_WORLDS]) {
    for (const [id, g] of Object.entries(GATES)) {
      const [sx, sy] = g.dir.x === 0 ? [1, 0] : [0, 1];
      for (let k = 1; k <= GATE_LANE; k += 1) {
        const x = g.edge.x + g.dir.x * k;
        const y = g.edge.y + g.dir.y * k;
        assert.ok([T.ROAD, T.BRIDGE].includes(w.terrainAt(x, y)), `${w.seed} ${id}: road on the gate's line at ${x},${y}`);
        assert.ok(![T.ROAD, T.BRIDGE].includes(w.terrainAt(x + sx, y + sy)), `${w.seed} ${id}: one lane at ${x + sx},${y + sy}`);
        assert.equal(w.deckAt(x + sx, y + sy), null);
      }
    }
  }
  // The north gate's road is two lanes wide again just past its narrow stretch.
  const n = GATES['gate:n'];
  assert.equal(world.terrainAt(n.edge.x + 1, n.edge.y - GATE_LANE - 1), T.ROAD);
});

test('lanterns, landmarks and statues stand clear of every bridge; a road\'s lanterns at its side', () => {
  let near = 0;
  for (const w of [world, ...OTHER_WORLDS, createWorldgen({ seed: 'another story', regionWords: words.regionWords })]) {
    const roads = w.roads();
    for (const p of w.fixedPois()) {
      if (p.type === 'quay' || p.region === 'skyward-isles') continue;
      for (let dy = -DECK_CLEAR; dy <= DECK_CLEAR; dy += 1) {
        for (let dx = -DECK_CLEAR; dx <= DECK_CLEAR; dx += 1) {
          if (w.inHeart(p.x + dx, p.y + dy)) continue;
          assert.notEqual(w.terrainAt(p.x + dx, p.y + dy), T.BRIDGE, `${w.seed}: ${p.type} at ${p.x},${p.y} has a bridge at ${p.x + dx},${p.y + dy}`);
        }
      }
      if (p.type === 'lantern' && !p.region) {
        const roadside = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roads.tiles.has(`${p.x + dx},${p.y + dy}`));
        assert.ok(roadside, `${w.seed}: the lantern at ${p.x},${p.y} stands at the roadside`);
        near += 1;
      }
    }
  }
  assert.ok(near > 20, `${near} road lanterns checked`);
  // The one that stood on the deck west of the vale now stands on the bank by the road (the other,
  // at -76,14, keeps its place: the river it stood over now rises clear of Cinderforge's road).
  const ids = world.fixedPois().filter((p) => p.type === 'lantern').map((p) => `${p.x},${p.y}`);
  assert.ok(!ids.includes('-8,-26'), 'off the deck west of the vale');
  assert.ok(ids.includes('-76,14'), 'the Cinderforge road lantern is on dry road now');
  assert.notEqual(world.terrainAt(-76, 14), T.BRIDGE);
});

test('every name and note the world gives out takes curly apostrophes, never straight ones', () => {
  const texts = [];
  for (const p of world.fixedPois()) texts.push(p.name, p.note);
  for (let cy = -4; cy < 4; cy += 1) for (let cx = -4; cx < 4; cx += 1) for (const p of world.chunk(cx, cy).pois) texts.push(p.name, p.note);
  for (const a of ANCHORS) texts.push(a.name);
  for (const t of TERRAIN_INFO) texts.push(t.name);
  for (let i = 0; i < 40; i += 1) texts.push(world.regionAt(i * 211 - 4000, i * 97 - 2000));
  const said = texts.filter((s) => typeof s === 'string');
  assert.ok(said.some((s) => s.includes('Sloe')), 'the quay is among them');
  for (const s of said) assert.ok(!s.includes("'"), `“${s}” has a straight apostrophe`);
  // And in the source: no quoted string literal in worldgen.js carries one (comments aside).
  const src = readFileSync(new URL('../src/world/worldgen.js', import.meta.url), 'utf8');
  const literals = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).flatMap((line) => line.match(/"[^"\n]*"|`[^`\n]*`/g) || []);
  for (const lit of literals) assert.ok(!/[A-Za-z]'[A-Za-z]/.test(lit), `${lit} has a straight apostrophe`);
});
