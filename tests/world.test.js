import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, MAP, PLACES, PLOT_IDS, LEGACY_PLACE_IDS, TERRAIN, isWalkable, findPath, placeAt, placeById, plotById, buildableArea, plotGate, terrainAt } from '../src/world/map.js';
import { SPRITES, PALETTE, MILO, CREW_ART, ICONS, mirror, sym, stamp, breathe, shiftRows, rowsToImageData } from '../src/world/sprites.js';
import { createWorld, crewRoute, makeWay, objectBoxes, paintGround, plotLook, plotOptions } from '../src/world/engine.js';
import { readFileSync } from 'node:fs';
import { createRiftgen } from '../src/world/riftgen.js';
import { createWorldgen, GATES } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { outfitPixels, spriteTable, bleedAt, bleedCover, COAT_TONES } from '../src/world/riftfx.js';
import { buildElsewhere } from '../src/world/elsewhere.js';
import { manualClock, fakeDom, flush, drive, testSpec } from './fakedom.js';

const PLOTS = { 'plot-meadow': 'Long meadow', 'plot-rise': 'Sunny rise', 'plot-birch': 'Birch hollow', 'plot-pond': 'Pondside plot', 'plot-orchard': 'Old orchard' };
const PLACE_IDS = ['camp', 'watchtower', 'townhall', ...Object.keys(PLOTS), 'harbor'];
const camp = placeById('camp');

function inArea(place, x, y) {
  const { area } = place;
  return x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h;
}

function assertValidPath(from, to, path) {
  assert.ok(path.length > 0, 'path should not be empty');
  let prev = from;
  for (const step of path) {
    assert.equal(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), 1, `non-adjacent step ${JSON.stringify(prev)} -> ${JSON.stringify(step)}`);
    assert.ok(isWalkable(step.x, step.y), `step on unwalkable tile ${step.x},${step.y}`);
    prev = step;
  }
  assert.notDeepEqual(path[0], from, 'path excludes the start');
}

// ---------- map ----------

test('map is about 64 x 44 tiles of known terrain', () => {
  assert.equal(TILE, 16);
  assert.equal(MAP.width, 64);
  assert.equal(MAP.height, 44);
  assert.equal(MAP.tiles.length, MAP.height);
  const known = new Set(Object.values(TERRAIN));
  for (const row of MAP.tiles) {
    assert.equal(row.length, MAP.width);
    for (const ch of row) assert.ok(known.has(ch), `unknown terrain ${ch}`);
  }
  const counts = {};
  for (const row of MAP.tiles) for (const ch of row) counts[ch] = (counts[ch] || 0) + 1;
  assert.ok(counts[TERRAIN.WATER] > 200, 'there is a sea and a pond');
  assert.ok(counts[TERRAIN.PATH] > 150, 'roads join the places');
  assert.ok(counts[TERRAIN.DOCK] >= 5, 'the harbor has a dock');
});

test('places match the contract', () => {
  assert.deepEqual(PLACES.map((p) => p.id).sort(), [...PLACE_IDS].sort());
  for (const place of PLACES) {
    assert.equal(typeof place.name, 'string');
    assert.ok(place.name.length > 0);
    assert.equal(typeof place.blurb, 'string');
    assert.ok(!/!/.test(place.blurb + place.name), 'calm copy has no exclamation marks');
    assert.equal(typeof place.built, 'boolean');
    assert.equal(typeof place.fogged, 'boolean');
    assert.ok(['camp', 'watchtower', 'townhall', 'plot', 'fog'].includes(place.kind), `${place.id} has a kind`);
    assert.ok(inArea(place, place.door.x, place.door.y), `${place.id} door sits inside its area`);
    assert.equal(placeAt(place.door.x, place.door.y), place.id);
    assert.equal(placeById(place.id), place);
  }
  assert.equal(placeById('camp').built, true);
  assert.equal(placeById('watchtower').built, true);
  assert.equal(placeById('harbor').fogged, true);
  assert.equal(placeById('camp').kind, 'camp');
  assert.equal(placeById('watchtower').kind, 'watchtower');
  assert.equal(placeById('harbor').kind, 'fog');
  for (const [id, name] of Object.entries(PLOTS)) {
    const place = placeById(id);
    assert.equal(place.kind, 'plot', id);
    assert.equal(place.name, name);
    assert.equal(place.built, false, id);
    assert.equal(place.fogged, false, id);
    assert.equal(plotById(id), place);
  }
  assert.deepEqual(PLOT_IDS.slice().sort(), Object.keys(PLOTS).sort());
  assert.equal(plotById('camp'), null, 'the camp is not a plot');
  assert.equal(plotById('harbor'), null, 'the harbor stays fog');
  assert.equal(placeById('nowhere'), null);
});

test('plots keep the step 1 areas and doors, and old ids map to them', () => {
  const OLD = {
    workshop: { door: { x: 48, y: 20 }, area: { x: 41, y: 15, w: 15, h: 6 } },
    'clip-studio': { door: { x: 49, y: 9 }, area: { x: 45, y: 3, w: 9, h: 7 } },
    library: { door: { x: 15, y: 21 }, area: { x: 8, y: 16, w: 8, h: 7 } },
    'game-table': { door: { x: 17, y: 30 }, area: { x: 10, y: 27, w: 8, h: 6 } },
    'building-site': { door: { x: 14, y: 9 }, area: { x: 10, y: 3, w: 9, h: 7 } },
  };
  for (const [old, where] of Object.entries(OLD)) {
    const plot = placeById(LEGACY_PLACE_IDS[old]);
    assert.ok(plot, old);
    assert.deepEqual(plot.door, where.door, `${old} keeps its door`);
    assert.deepEqual(plot.area, where.area, `${old} keeps its area`);
  }
});

test('buildable areas sit inside each plot, clear of its gate and blocked to walkers', () => {
  const expected = {
    'plot-meadow': { x: 42, y: 16, w: 13, h: 4, gate: { side: 'bottom', at: 104 } },
    'plot-rise': { x: 46, y: 4, w: 7, h: 5, gate: { side: 'bottom', at: 56 } },
    'plot-birch': { x: 9, y: 17, w: 6, h: 5, gate: { side: 'right', at: 72 } },
    'plot-pond': { x: 11, y: 28, w: 6, h: 4, gate: { side: 'right', at: 40 } },
    'plot-orchard': { x: 11, y: 4, w: 7, h: 5, gate: { side: 'bottom', at: 56 } },
  };
  for (const [id, { gate, ...box }] of Object.entries(expected)) {
    const area = buildableArea(id);
    assert.deepEqual(area, box, id);
    assert.deepEqual(plotGate(id), gate, `${id} gate`);
    assert.deepEqual(MAP.plots[id], { ...box, gate });
    assert.deepEqual(plotOptions(id), { w: box.w, h: box.h, gate });
    const place = placeById(id);
    for (let y = area.y; y < area.y + area.h; y += 1) {
      for (let x = area.x; x < area.x + area.w; x += 1) {
        assert.ok(inArea(place, x, y), `${id} buildable tile ${x},${y} is inside the plot`);
        assert.equal(isWalkable(x, y), false, `${id} buildable tile ${x},${y} is kept clear`);
        assert.equal(terrainAt(x, y), TERRAIN.GRASS, 'plots are grass until something is built');
      }
    }
    assert.ok(!inArea({ area }, place.door.x, place.door.y), `${id} gate is outside the buildable area`);
  }
  assert.equal(buildableArea('camp'), null);
  assert.equal(buildableArea('nowhere'), null);
  assert.equal(plotGate('harbor'), null);
});

test('place areas do not overlap', () => {
  for (let y = 0; y < MAP.height; y += 1) {
    for (let x = 0; x < MAP.width; x += 1) {
      const owners = PLACES.filter((p) => inArea(p, x, y));
      assert.ok(owners.length <= 1, `tile ${x},${y} belongs to ${owners.map((p) => p.id)}`);
    }
  }
});

test('every door is walkable and reachable from the camp door', () => {
  for (const place of PLACES) {
    assert.ok(isWalkable(place.door.x, place.door.y), `${place.id} door is walkable`);
    if (place.id === 'camp') continue;
    const path = findPath(camp.door, place.door);
    assertValidPath(camp.door, place.door, path);
    assert.deepEqual(path[path.length - 1], place.door, `${place.id} path ends at the door`);
  }
});

test('placeAt finds places and returns null elsewhere', () => {
  assert.equal(placeAt(0, 0), null);
  assert.equal(placeAt(-1, 5), null);
  assert.equal(placeAt(1000, 5), null);
  assert.equal(placeAt(31, 19), 'camp');
  assert.equal(placeAt(31, 8), 'watchtower');
  assert.equal(placeAt(50, 38), 'harbor');
  assert.equal(placeAt(1.5, 2), null);
});

test('isWalkable respects terrain, props and bounds', () => {
  assert.equal(isWalkable(-1, 0), false);
  assert.equal(isWalkable(0, MAP.height), false);
  assert.equal(isWalkable(31.5, 12), false);
  assert.equal(isWalkable(31, 12), true, 'the upper road');
  assert.equal(isWalkable(31, 8), false, 'the watchtower stands here');
  assert.equal(isWalkable(31, 20), false, 'the campfire');
  assert.equal(terrainAt(60, 42), TERRAIN.WATER);
  assert.equal(isWalkable(60, 42), false, 'open sea');
  assert.equal(isWalkable(50, 38), true, 'the dock');
  const tree = MAP.objects.find((o) => o.kind === 'tree');
  assert.equal(isWalkable(tree.x, tree.y), false, 'tree trunks block');
});

test('findPath basics', () => {
  assert.deepEqual(findPath({ x: 20, y: 12 }, { x: 20, y: 12 }), [], 'same tile');
  assert.deepEqual(findPath(null, { x: 1, y: 1 }), []);
  assert.deepEqual(findPath({ x: 20, y: 12 }, { x: -3, y: 12 }), [], 'out of bounds');
  assert.deepEqual(findPath({ x: 31, y: 22 }, { x: 60, y: 42 }), [], 'unreachable sea');

  const straight = findPath({ x: 16, y: 12 }, { x: 30, y: 12 });
  assertValidPath({ x: 16, y: 12 }, { x: 30, y: 12 }, straight);
  assert.equal(straight.length, 14, 'straight along the road');
  assert.ok(straight.every((p) => p.y === 12));

  // Target on the tower: the path stops at a walkable neighbour.
  const toTower = findPath(camp.door, { x: 31, y: 9 });
  assertValidPath(camp.door, { x: 31, y: 9 }, toTower);
  const end = toTower[toTower.length - 1];
  assert.ok(isWalkable(end.x, end.y));
  assert.ok(Math.abs(end.x - 31) <= 1 && Math.abs(end.y - 9) <= 1, 'ends next to the tower');

  // Starting on a blocked tile (inside the tent) still finds a way out.
  const out = findPath(MAP.tentDoor, camp.door);
  assert.ok(out.length > 0);
  assert.deepEqual(out[out.length - 1], camp.door);
});

test('findPath prefers roads but never wanders far', () => {
  const from = { x: 31, y: 22 };
  const to = placeById('plot-birch').door;
  const path = findPath(from, to);
  const manhattan = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  assert.ok(path.length <= manhattan + 6, `library walk is ${path.length} for distance ${manhattan}`);
});

test('crew slots and fixed perches are sensible', () => {
  const { slots } = MAP;
  assert.equal(slots.work.length, 4);
  assert.equal(slots.campfire.length, 5);
  assert.equal(slots.waiting.length, 4);
  for (const slot of slots.work) assert.ok(inArea(camp, slot.x, slot.y), 'working crew gather at the workbench by the camp');
  const bench = MAP.objects.find((o) => o.kind === 'crew.bench');
  assert.ok(bench, 'the crew workbench stands beside the camp');
  for (const slot of slots.work) assert.equal(slot.y, bench.y - 1, 'crew stand just behind the bench');
  for (const id of PLOT_IDS) {
    const spot = slots.design[id];
    const area = buildableArea(id);
    assert.ok(spot.x >= area.x && spot.x < area.x + area.w && spot.y >= area.y && spot.y < area.y + area.h, `${id} designer works on the plot`);
    assert.deepEqual(spot.door, placeById(id).door, 'and goes in by the gate');
    assert.ok(Math.abs(spot.inside.x - spot.door.x) + Math.abs(spot.inside.y - spot.door.y) === 1, 'one step past the gate');
  }
  for (const slot of slots.campfire) assert.ok(inArea(camp, slot.x, slot.y), 'campfire seats are in the camp');
  for (const slot of slots.waiting) {
    assert.ok(!inArea(camp, slot.x, slot.y), 'waiting spots are just outside the camp');
    assert.ok(isWalkable(slot.x, slot.y), 'waiting spots are open ground');
    const d = Math.min(...[camp.area.y + camp.area.h - 1].map((edge) => slot.y - edge));
    assert.ok(d >= 1 && d <= 2, 'close to the camp edge');
  }
  for (const key of ['jev', 'whisper']) {
    assert.ok(slots[key].px > 0 && slots[key].px < MAP.width * TILE);
    assert.ok(slots[key].py > 0 && slots[key].py < MAP.height * TILE);
  }
  assert.ok(isWalkable(MAP.miloHome.x, MAP.miloHome.y));
  assert.deepEqual(MAP.miloHome, camp.door);
});

test('every prop and decal uses a known sprite', () => {
  for (const object of MAP.objects) {
    if (object.kind === 'fence') {
      assert.equal(typeof object.mask, 'object');
      continue;
    }
    assert.ok(SPRITES[object.kind], `sprite for ${object.kind}`);
  }
  for (const [name] of MAP.decals) assert.ok(SPRITES[name], `decal sprite ${name}`);
  const kinds = new Set(MAP.objects.map((o) => o.kind));
  for (const kind of ['cabin', 'tent', 'campfire', 'flag', 'tower', 'crew.bench', 'boat', 'tree', 'pine', 'fence', 'sign.harbor']) assert.ok(kinds.has(kind), kind);
  // Plots carry nothing of their own: the kit draws whatever is there.
  for (const id of PLOT_IDS) {
    const area = buildableArea(id);
    const inside = MAP.objects.filter((o) => o.x >= area.x && o.y >= area.y && o.x < area.x + area.w && o.y < area.y + area.h);
    assert.deepEqual(inside, [], `${id} is empty`);
  }
});

// ---------- sprites ----------

test('palette is soft: named colours, no pure black', () => {
  const keys = Object.keys(PALETTE);
  // Step 2 adds six deeper steps so every building colour has a full ramp.
  assert.ok(keys.length >= 20 && keys.length <= 40, `palette has ${keys.length} colours`);
  const names = new Set();
  for (const [key, { name, hex }] of Object.entries(PALETTE)) {
    assert.equal(key.length, 1);
    assert.notEqual(key, '.');
    assert.ok(!names.has(name), `duplicate name ${name}`);
    names.add(name);
    assert.match(hex, /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, (0|1|0?\.\d+)\))$/);
    assert.notEqual(hex, '#000000');
  }
  assert.equal(PALETTE.o.hex, '#3d4038');
});

test('every sprite grid is rectangular, consistent across frames and palette-only', () => {
  for (const [name, frames] of Object.entries(SPRITES)) {
    assert.ok(Array.isArray(frames) && frames.length > 0, `${name} has frames`);
    const h = frames[0].length;
    const w = frames[0][0].length;
    assert.ok(w > 0 && h > 0);
    frames.forEach((rows, index) => {
      assert.equal(rows.length, h, `${name}#${index} height`);
      rows.forEach((row, y) => {
        assert.equal(row.length, w, `${name}#${index} row ${y} width`);
        for (const ch of row) assert.ok(ch === '.' || PALETTE[ch], `${name}#${index} row ${y} has '${ch}'`);
      });
    });
  }
  for (const [id, rows] of Object.entries(ICONS)) {
    for (const row of rows) for (const ch of row) assert.ok(ch === '.' || PALETTE[ch], `icon ${id}`);
  }
});

test('Milo walks in four directions with idle breathing', () => {
  for (const dir of ['down', 'up', 'left', 'right']) {
    const frames = SPRITES[`milo.${dir}`];
    assert.ok(frames.length >= 3, `${dir} has a 3-frame walk`);
    for (const rows of frames) {
      assert.equal(rows.length, 20);
      assert.equal(rows[0].length, 16);
    }
    assert.notDeepEqual(frames[1], frames[0], `${dir} walk frames differ`);
    assert.notDeepEqual(frames[2], frames[1]);
    const breath = SPRITES[`milo.breath.${dir}`][0];
    assert.notDeepEqual(breath, frames[0], `${dir} breathes`);
  }
  assert.deepEqual(MILO.left[0], mirror(MILO.right[0]));
});

test('crew characters each have their own look', () => {
  for (const id of ['claude', 'codex', 'helper', 'helper1', 'helper2', 'helper3', 'ollama']) {
    assert.ok(SPRITES[`${id}.stand`], `${id} stands`);
    assert.equal(SPRITES[`${id}.work`].length, 2, `${id} has a work loop`);
    assert.notDeepEqual(SPRITES[`${id}.work`][0], SPRITES[`${id}.work`][1]);
  }
  assert.equal(SPRITES['jev.idle'].length, 2);
  assert.equal(SPRITES['whisper.idle'].length, 2);
  const colours = (rows) => new Set(rows.join('').replace(/[.o]/g, ''));
  assert.ok(colours(CREW_ART.claude.stand).has('r'), 'Claude wears warm clay');
  assert.ok(colours(CREW_ART.codex.stand).has('e'), 'Codex wears slate blue');
  assert.ok(!colours(CREW_ART.claude.stand).has('e'));
  assert.ok(!colours(CREW_ART.codex.stand).has('r'));
});

test('grid helpers are pure and predictable', () => {
  assert.deepEqual(mirror(['ab.']), ['.ba']);
  assert.deepEqual(sym(['ab']), ['abba']);
  assert.deepEqual(stamp(['....', '....'], ['x.', '.o'], 1, 0), ['.x..', '..o.']);
  assert.deepEqual(stamp(['..'], ['oo'], 1, 0), ['.o'], 'clips at the edge');
  assert.deepEqual(breathe(['aa', 'bb', 'cc'], 1), ['..', 'aa', 'cc']);
  assert.deepEqual(shiftRows(['ab..', 'cd..'], 1, 0, 1), ['.ab.', 'cd..']);
});

// ---------- engine ----------

test('ground painter runs in Node and paints soft terrain colours', () => {
  const w = MAP.width * TILE;
  const h = MAP.height * TILE;
  const data = new Uint8ClampedArray(w * h * 4);
  const types = paintGround(data);
  assert.equal(types.length, w * h);
  const pixel = (x, y) => {
    const i = (y * w + x) * 4;
    return `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  const water = new Set([PALETTE.w.hex, PALETTE.W.hex, PALETTE.f.hex]);
  assert.ok(water.has(pixel(60 * TILE + 8, 42 * TILE + 8)), 'the sea is blue');
  assert.ok([PALETTE.p.hex, PALETTE.P.hex].includes(pixel(20 * TILE + 8, 12 * TILE + 8)), 'the road is sand');
  let black = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) throw new Error('ground must be opaque');
    if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) black += 1;
  }
  assert.equal(black, 0, 'no pure black on the ground');
});

test('createWorld works end to end with motion off', async () => {
  const { canvas, listeners, cleanup } = fakeDom();
  const events = [];
  const world = createWorld(canvas, {
    motion: () => false,
    onPlaceClick: (id) => events.push(['place', id]),
    onCrewClick: (id) => events.push(['crew', id]),
    onMiloMove: (tile) => events.push(['move', tile.x, tile.y]),
    onHover: (info) => events.push(['hover', info && info.id]),
  });
  try {
    assert.equal(canvas.width, 1000);
    assert.equal(canvas.height, 700);
    assert.equal(world.scale, 3, '1000 x 700 draws at 3x');
    assert.deepEqual(world.miloTile(), MAP.miloHome);

    world.setCrew([
      { id: 'claude', state: 'working', label: 'Claude', count: 1 },
      { id: 'codex', state: 'needs-you', label: 'Codex', count: 1 },
      { id: 'jev', state: 'idle', label: 'Jev', count: 0 },
      { id: 'whisper', state: 'offline', label: 'Whisper', count: 0 },
      { id: 'mystery', state: 'done', label: 'Helper', count: 0 },
      { id: 'ollama', state: 'offline', label: 'Ollama', count: 0 },
      null,
    ]);
    world.setCrew(undefined);

    await world.entrance();
    assert.deepEqual(world.miloTile(), MAP.miloHome, 'entrance lands at the camp door at once');

    await world.walkTo('watchtower');
    assert.deepEqual(world.miloTile(), placeById('watchtower').door);
    await world.walkTo({ x: 20, y: 12 });
    assert.deepEqual(world.miloTile(), { x: 20, y: 12 });
    await world.walkTo('nowhere');
    await world.walkTo({ x: NaN, y: 1 });
    assert.ok(events.some((e) => e[0] === 'move'));

    // Screen position sits above Milo's head, inside the canvas.
    const pos = world.miloScreenPos();
    assert.ok(pos.x > 0 && pos.x < 1000 && pos.y > 0 && pos.y < 700);

    // Arrow keys step one tile.
    listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
    assert.deepEqual(world.miloTile(), { x: 21, y: 12 });
    listeners.keyup({ key: 'ArrowRight' });

    // Click the tower: Milo walks to its door and the place opens.
    await world.walkTo({ x: 31, y: 12 });
    const head = world.miloScreenPos();
    listeners.pointerdown({ button: 0, clientX: head.x, clientY: head.y - 90 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(events.filter((e) => e[0] === 'place').pop(), ['place', 'watchtower']);

    // Enter at a door opens that place too.
    listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.deepEqual(events.filter((e) => e[0] === 'place').pop(), ['place', 'watchtower']);

    // Hovering the tower reports it; moving away clears it.
    listeners.pointermove({ clientX: head.x, clientY: head.y - 90 });
    assert.deepEqual(events.filter((e) => e[0] === 'hover').pop(), ['hover', 'watchtower']);
    listeners.pointerleave();
    assert.deepEqual(events.filter((e) => e[0] === 'hover').pop(), ['hover', null]);

    const full = world.renderMap(1);
    assert.ok(full);
    world.setPaused(true);
    world.setPaused(false);
    world.resize();
  } finally {
    world.dispose();
    world.dispose();
    cleanup();
  }
});

test('createWorld walks over time when motion is on', async () => {
  const { canvas, cleanup } = fakeDom();
  const world = createWorld(canvas, { startTile: { x: 20, y: 12 } });
  try {
    assert.deepEqual(world.miloTile(), { x: 20, y: 12 });
    const started = Date.now();
    await world.walkTo({ x: 22, y: 12 });
    assert.deepEqual(world.miloTile(), { x: 22, y: 12 });
    assert.ok(Date.now() - started >= 200, 'the walk takes a moment');
    // A new walk supersedes an old one; both promises settle.
    const first = world.walkTo({ x: 26, y: 12 });
    const second = world.walkTo({ x: 23, y: 12 });
    await Promise.all([first, second]);
    assert.deepEqual(world.miloTile(), { x: 23, y: 12 });
  } finally {
    world.dispose();
    cleanup();
  }
});

test('an unwalkable start tile falls back to the camp door', () => {
  const { canvas, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => false, startTile: { x: 60, y: 42 } });
  try {
    assert.deepEqual(world.miloTile(), MAP.miloHome);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('bigger windows never zoom in past a roomy view', () => {
  const scaleAt = (width, height) => {
    const { canvas, cleanup } = fakeDom({ width, height });
    const world = createWorld(canvas, { motion: () => false });
    try {
      return world.scale;
    } finally {
      world.dispose();
      cleanup();
    }
  };
  assert.equal(scaleAt(960, 608), 2, 'the smallest window');
  assert.equal(scaleAt(1000, 668), 3);
  assert.equal(scaleAt(1280, 788), 3, 'the default window');
  assert.equal(scaleAt(1280, 900), 3, 'a slightly taller window keeps 3x');
  assert.equal(scaleAt(1440, 868), 3, '1440 x 900 keeps about 30 x 18 tiles in view');
  assert.equal(scaleAt(1280, 1360), 3, 'half of a 2560 x 1440 screen');
  assert.equal(scaleAt(1664, 1024), 4, '4x once 26 x 16 tiles still fit');
  assert.equal(scaleAt(2560, 1360), 4, 'maximized');
  for (const [width, height] of [[960, 608], [1000, 668], [1280, 788], [1440, 868], [1664, 1024], [2560, 1360]]) {
    const tilesWide = width / (scaleAt(width, height) * TILE);
    assert.ok(tilesWide >= 20, `${width} x ${height} shows ${tilesWide.toFixed(1)} tiles across`);
  }
});

test('the camera keeps Milo and his cabin clear of the shell overlays', () => {
  const cabin = objectBoxes().find((box) => box.kind === 'cabin');
  const headTop = MAP.miloHome.y * TILE + 13 - 19;
  for (const [width, height] of [[960, 608], [1000, 668], [1280, 788], [1440, 868], [2560, 1360]]) {
    const { canvas, cleanup } = fakeDom({ width, height });
    const world = createWorld(canvas, { motion: () => false });
    try {
      world.entrance();
      world.setInsets({ top: 60 }); // the crew strip's bottom edge plus a little air
      const pos = world.miloScreenPos();
      const cabinTop = pos.y + (cabin.sy - headTop) * world.scale;
      assert.ok(cabinTop >= 60, `${width} x ${height}: the cabin roof starts at ${Math.round(cabinTop)} px, below the strip`);
      assert.ok(pos.y > 60 && pos.y + 20 * world.scale < height, 'Milo is fully in view');

      // An open panel on the right: Milo is centred in what is left of the view.
      world.setInsets({ top: 60, right: 404 });
      const shifted = world.miloScreenPos();
      assert.ok(shifted.x < width - 404 - 8 * world.scale, `${width} x ${height}: Milo at ${Math.round(shifted.x)} stays left of the panel`);
      world.setInsets({});
      assert.ok(Math.abs(world.miloScreenPos().x - pos.x) < 1, 'closing the panel brings the view back');
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

test('keepClear reports Milo, the campfire circle and every crew member on screen', () => {
  const { canvas, cleanup } = fakeDom({ width: 1000, height: 668 });
  const world = createWorld(canvas, { motion: () => false });
  try {
    world.entrance();
    world.setCrew([
      { id: 'claude', state: 'done', label: 'Claude', count: 1 },
      { id: 'codex', state: 'needs-you', label: 'Codex', count: 1 },
      { id: 'jev', state: 'idle', label: 'Jev', count: 0 },
    ]);
    const rects = world.keepClear();
    const kinds = rects.map((rect) => rect.id || rect.kind).sort();
    assert.deepEqual(kinds, ['campfire', 'claude', 'codex', 'jev', 'milo']);
    const pos = world.miloScreenPos();
    const milo = rects.find((rect) => rect.kind === 'milo');
    assert.ok(Math.abs(milo.x + milo.w / 2 - pos.x) <= world.scale && Math.abs(milo.y - pos.y) <= world.scale);
    const fire = rects.find((rect) => rect.kind === 'campfire');
    assert.ok(fire.y + fire.h <= pos.y, 'the fire sits just north of Milo at home');
    const seated = rects.find((rect) => rect.id === 'claude');
    assert.ok(seated.x < fire.x + fire.w && seated.x + seated.w > fire.x, 'resting crew sit in the fire circle');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('on launch Milo walks out of his tent to where he was left', async () => {
  const saved = { x: 31, y: 10 };
  for (const motion of [false, true]) {
    const { canvas, cleanup } = fakeDom();
    const moves = [];
    const world = createWorld(canvas, { motion: () => motion, startTile: saved, onMiloMove: (tile) => moves.push(tile) });
    try {
      await world.entrance();
      assert.deepEqual(world.miloTile(), saved, `motion ${motion}: back where he was`);
      if (moves.length) assert.deepEqual(moves[moves.length - 1], saved, 'the last saved tile is the restored one');
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

test('no rock or bush hides behind a taller sprite and reads as perched on it', () => {
  const opaque = (ch) => ch !== undefined && ch !== '.' && ch !== 'x';
  const boxes = objectBoxes().filter((box) => SPRITES[box.sprite]);
  for (const back of boxes.filter((box) => ['rock', 'bush', 'bush.berry'].includes(box.kind))) {
    const rows = SPRITES[back.sprite][0];
    let total = 0;
    let worst = 0;
    for (const front of boxes) {
      if (front === back || front.baseY < back.baseY) continue;
      const frontRows = SPRITES[front.sprite][0];
      let covered = 0;
      total = 0;
      rows.forEach((row, py) => [...row].forEach((ch, px) => {
        if (!opaque(ch)) return;
        total += 1;
        if (opaque(frontRows[back.sy + py - front.sy]?.[back.sx + px - front.sx])) covered += 1;
      }));
      worst = Math.max(worst, covered / total);
    }
    assert.ok(worst <= 0.2, `${back.kind} at ${back.x},${back.y} is ${Math.round(worst * 100)}% hidden`);
  }
  assert.ok(boxes.some((box) => box.kind === 'rock' && box.x === 44 && box.y === 22), 'the Workshop rock moved to open grass');
});

// ---------- plots in the world ----------

const STUDIO = {
  version: 1,
  name: 'Clip studio',
  tagline: 'Cuts and captions stream clips',
  purpose: 'Turns drawing streams into short clips.',
  style: { shape: 'shop', walls: 'plaster', wallColor: 'lavender', roof: 'shingle', roofColor: 'slateDeep', trim: 'cream', door: 'double', windows: 'tall', chimney: true, flag: 'blossom', awning: 'none' },
  emblem: ['............', '..oooooooo..', '.orrrrrrrro.', '.orrcrrrrro.', '.orrccrrrro.', '.orrcccrrro.', '.orrccccrro.', '.orrcccrrro.', '.orrccrrrro.', '.orrcrrrrro.', '.orrrrrrrro.', '..oooooooo..'],
  props: [{ kind: 'camera', side: 'left' }, { kind: 'easel', side: 'front' }],
  yard: 'path',
  levels: [],
};

test('plotLook reads plot state calmly, whatever arrives', () => {
  assert.deepEqual(plotLook(undefined), { status: 'empty', key: 'empty' });
  assert.deepEqual(plotLook({ status: 'weird' }), { status: 'empty', key: 'empty' });
  assert.deepEqual(plotLook({ status: 'designing' }), { status: 'designing', key: 'designing' });
  assert.equal(plotLook({ status: 'built', blueprint: null }).status, 'empty', 'built without a blueprint shows an empty plot');
  const built = plotLook({ status: 'built', blueprint: STUDIO, name: null });
  assert.equal(built.status, 'built');
  assert.equal(built.name, 'Clip studio');
  assert.equal(plotLook({ status: 'built', blueprint: STUDIO, name: 'Stream room' }).name, 'Stream room', 'a rename wins');
  assert.equal(plotLook({ status: 'built', blueprint: { ...STUDIO } }).key, built.key, 'the same design keeps its key');
  assert.notEqual(plotLook({ status: 'built', blueprint: { ...STUDIO, yard: 'stone' } }).key, built.key);
});

test('the world draws every plot: empty, building site, or built', () => {
  const { canvas, draws, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => false });
  try {
    const plotDraws = () => {
      draws.length = 0;
      world.renderMap(1);
      const hits = {};
      for (const id of PLOT_IDS) {
        const area = buildableArea(id);
        hits[id] = draws.filter(({ image, args }) => args[0] === area.x * TILE && args[1] === area.y * TILE && image.width === area.w * TILE && image.height === area.h * TILE).length;
      }
      return hits;
    };
    for (const [id, count] of Object.entries(plotDraws())) assert.ok(count >= 2, `${id} shows its empty plot (ground and signpost)`);
    world.setPlots({
      'plot-rise': { status: 'built', blueprint: STUDIO, name: null },
      'plot-pond': { status: 'designing', idea: { title: 'Game table' } },
      'plot-meadow': null,
      'plot-orchard': 'nonsense',
    });
    for (const [id, count] of Object.entries(plotDraws())) assert.ok(count >= 2, `${id} is drawn after setPlots`);
    assert.equal(world.plotLabel('plot-rise'), 'Clip studio');
    assert.equal(world.plotLabel('plot-pond'), 'Pondside plot · being designed');
    assert.equal(world.plotLabel('plot-meadow'), 'Long meadow · empty plot');
    assert.equal(world.plotLabel('camp'), "Milo's camp");
    world.setPlots({ 'plot-rise': { status: 'built', blueprint: STUDIO, name: 'Stream room' } });
    assert.equal(world.plotLabel('plot-rise'), 'Stream room', 'renames show at once');
    // Motion off: the reveal is instant and nothing is left waiting.
    world.celebrate('plot-rise');
    world.celebrate('nowhere');
    world.setPlots(undefined);
    assert.equal(world.plotLabel('plot-rise'), 'Sunny rise · empty plot', 'a cleared plot is empty again');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('hovering a plot names it', async () => {
  const { canvas, listeners, cleanup } = fakeDom();
  const hovers = [];
  const world = createWorld(canvas, { motion: () => false, onHover: (info) => hovers.push(info) });
  try {
    const rise = placeById('plot-rise');
    await world.walkTo('plot-rise');
    assert.deepEqual(world.miloTile(), rise.door);
    const head = world.miloScreenPos();
    const area = buildableArea('plot-rise');
    // Milo's head is 19 px above his feet (13 px into the gate tile); aim at the plot's middle.
    const feetY = rise.door.y * TILE + 13;
    const aim = { x: head.x + ((area.x + area.w / 2) * TILE - (rise.door.x * TILE + 8)) * world.scale, y: head.y + ((area.y + area.h / 2) * TILE - (feetY - 19)) * world.scale };
    listeners.pointermove({ clientX: aim.x, clientY: aim.y });
    assert.deepEqual(hovers.pop(), { kind: 'place', id: 'plot-rise', x: aim.x, y: aim.y, label: 'Sunny rise · empty plot' });
    world.setPlots({ 'plot-rise': { status: 'built', blueprint: STUDIO } });
    listeners.pointermove({ clientX: aim.x + 1, clientY: aim.y });
    assert.equal(hovers.pop().label, 'Clip studio');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('a designing crew member works at the plot, and goes back after', () => {
  const { canvas, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => false });
  try {
    world.walkTo('plot-rise');
    world.setCrew([
      { id: 'codex', state: 'designing', plotId: 'plot-rise', label: 'Codex', count: 0 },
      { id: 'claude', state: 'designing', plotId: 'nowhere', label: 'Claude', count: 0 },
    ]);
    const rects = world.keepClear();
    const codex = rects.find((r) => r.id === 'codex');
    const pos = world.miloScreenPos();
    const area = buildableArea('plot-rise');
    const toWorld = (sx, sy) => ({ x: (sx - pos.x) / world.scale + placeById('plot-rise').door.x * TILE + 8, y: (sy - pos.y) / world.scale + placeById('plot-rise').door.y * TILE + 13 - 19 });
    const feet = toWorld(codex.x + codex.w / 2, codex.y + codex.h);
    assert.ok(feet.x > area.x * TILE && feet.x < (area.x + area.w) * TILE, 'Codex stands on the plot');
    assert.ok(feet.y > area.y * TILE && feet.y <= (area.y + area.h) * TILE + 1, 'inside its front edge');
    assert.ok(rects.some((r) => r.id === 'claude'), 'an unknown plot means the workbench instead');
    world.setCrew([{ id: 'codex', state: 'done', label: 'Codex', count: 1 }]);
    const back = world.keepClear().find((r) => r.id === 'codex');
    assert.ok(back, 'Codex heads back to the fire');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('with motion on, construction animates and the reveal plays out', async () => {
  const { canvas, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => true, startTile: placeById('plot-orchard').door });
  try {
    world.setPlots({ 'plot-orchard': { status: 'designing' } });
    world.setCrew([{ id: 'claude', state: 'designing', plotId: 'plot-orchard', label: 'Claude', count: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    world.celebrate('plot-orchard'); // before the plot says built: the reveal waits for it
    world.setPlots({ 'plot-orchard': { status: 'built', blueprint: STUDIO } });
    await new Promise((resolve) => setTimeout(resolve, 80));
    world.setPlots({ 'plot-orchard': { status: 'built', blueprint: STUDIO } });
    world.celebrate('plot-orchard'); // after: starts at once
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(world.plotLabel('plot-orchard'), 'Clip studio');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('a repaint from before the reveal began still draws a real frame', () => {
  const { canvas, draws, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => true, startTile: placeById('plot-orchard').door });
  try {
    world.setPlots({ 'plot-orchard': { status: 'built', blueprint: STUDIO } });
    world.celebrate('plot-orchard');
    draws.length = 0;
    // A static paint can carry a frame time older than the reveal (here, time 0).
    world.renderMap(1, { time: 0 });
    assert.ok(draws.length > 0, 'the map was drawn');
    assert.ok(draws.every((draw) => draw.image), 'every drawImage got an image, never a missing reveal step');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('speech bubbles keep off a plot while it goes up and just after it is built', () => {
  const { canvas, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => false, startTile: placeById('plot-rise').door });
  const plotRects = () => world.keepClear().filter((rect) => rect.kind === 'plot').map((rect) => rect.id);
  try {
    assert.deepEqual(plotRects(), [], 'empty plots are fine to talk over');
    world.setPlots({ 'plot-rise': { status: 'designing' } });
    assert.deepEqual(plotRects(), ['plot-rise'], 'a building site is kept clear');
    const rect = world.keepClear().find((r) => r.kind === 'plot');
    const area = buildableArea('plot-rise');
    assert.equal(Math.round(rect.w), area.w * TILE * world.scale);
    assert.equal(Math.round(rect.h), area.h * TILE * world.scale);
    world.setPlots({ 'plot-rise': { status: 'built', blueprint: STUDIO } });
    world.celebrate('plot-rise');
    assert.deepEqual(plotRects(), ['plot-rise'], 'the new building stays clear for a while');
    world.setPlots({ 'plot-rise': { status: 'empty' } });
    assert.deepEqual(plotRects(), [], 'a cleared plot is not');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('with a panel open, Milo stays in view out to the east edge of the map', () => {
  // The east road (x = 56) runs from the Long meadow up to Sunny rise; a panel covers the right.
  for (const [width, height, panel] of [[1440, 868, 412], [1280, 788, 404], [1000, 668, 390]]) {
    for (const tile of [{ x: 56, y: 16 }, { x: 55, y: 20 }, { x: 56, y: 12 }]) {
      const { canvas, cleanup } = fakeDom({ width, height });
      const world = createWorld(canvas, { motion: () => false, startTile: tile });
      try {
        assert.deepEqual(world.miloTile(), tile);
        world.setInsets({ top: 62, right: panel });
        const pos = world.miloScreenPos();
        assert.ok(pos.x + 8 * world.scale <= width - panel, `${width} x ${height} at ${tile.x},${tile.y}: Milo at ${Math.round(pos.x)} is left of the panel`);
        world.setInsets({ top: 62 });
        const shut = world.miloScreenPos();
        assert.ok(shut.x + 8 * world.scale <= width, 'and on screen with the panel shut');
      } finally {
        world.dispose();
        cleanup();
      }
    }
  }
});

test('crew walk in and out of a plot through its gate, and never back in', () => {
  const slot = MAP.slots.design['plot-rise'];
  const camp = MAP.slots.campfire[0];
  const home = { x: camp.x, y: camp.y };
  // Finished at the design spot: out through the gate first, then home.
  const done = crewRoute({ from: { x: slot.x, y: slot.y }, to: home, leaving: slot, arrived: true });
  assert.deepEqual(done.slice(0, 2), [slot.inside, slot.door]);
  // Still walking in when the plans landed: turn round where it stands, no walk in and out again.
  const road = findPath(MAP.miloHome, slot.door);
  const midway = road[Math.floor(road.length / 2)];
  const back = crewRoute({ from: midway, to: home, leaving: slot, arrived: false });
  assert.ok(!back.some((tile) => tile.x === slot.inside.x && tile.y === slot.inside.y), 'never steps inside the plot');
  assert.ok(back.every((tile) => isWalkable(tile.x, tile.y)), 'never walks through a fence');
  // Going to design: to the gate, then just inside.
  const going = crewRoute({ from: MAP.miloHome, to: { x: slot.x, y: slot.y }, into: slot });
  assert.deepEqual(going.at(-2), slot.door);
  assert.deepEqual(going.at(-1), slot.inside);
});

test('from a plot gate there is always a way to step aside off the crew route', () => {
  const seat = MAP.slots.campfire[1];
  for (const id of PLOT_IDS) {
    const slot = MAP.slots.design[id];
    const door = placeById(id).door;
    const leaving = crewRoute({ from: { x: slot.x, y: slot.y }, to: { x: seat.x, y: seat.y }, leaving: slot, arrived: true });
    const coming = crewRoute({ from: { x: seat.x, y: seat.y }, to: { x: slot.x, y: slot.y }, into: slot });
    for (const [name, route] of [['out', leaving], ['in', coming]]) {
      assert.ok(route.some((tile) => tile.x === door.x && tile.y === door.y), `${id} ${name}: the crew walk goes through the gate`);
      const way = makeWay(door, { route, busy: [route[0]] });
      assert.ok(way, `${id} ${name}: Milo has somewhere to step`);
      assert.ok(way.path.length >= 1 && way.path.length <= 3, `${id} ${name}: a step or two, not a walk (${way.path.length})`);
      assert.deepEqual(way.path.at(-1), way.to);
      assert.ok(!route.some((tile) => tile.x === way.to.x && tile.y === way.to.y), `${id} ${name}: off the crew's way`);
      assert.ok(!route.some((tile) => tile.x === way.to.x && tile.y === way.to.y - 1), `${id} ${name}: not just south of it, where passing crew would walk behind him`);
      assert.ok(way.path.every((tile) => isWalkable(tile.x, tile.y)), `${id} ${name}: never through a fence or into the plot`);
      assert.ok(!way.path.some((tile) => tile.x === route[0].x && tile.y === route[0].y), `${id} ${name}: never through a busy tile`);
    }
  }
  // The orchard's gate is a gap in the fence: with the one tile outside it taken, Milo can't move.
  const orchard = placeById('plot-orchard').door;
  assert.equal(makeWay(orchard, { busy: [{ x: orchard.x, y: orchard.y + 1 }] }), null, 'nowhere to step');
});

// Share of Milo's on-screen box that a crew member's box covers (0 when apart or side by side).
function crewOverMilo(world, id) {
  const rects = world.keepClear();
  const m = rects.find((r) => r.kind === 'milo');
  const c = rects.find((r) => r.kind === 'crew' && r.id === id);
  if (!m || !c) return 0;
  const w = Math.min(m.x + m.w, c.x + c.w) - Math.max(m.x, c.x);
  const h = Math.min(m.y + m.h, c.y + c.h) - Math.max(m.y, c.y);
  return w > 0 && h > 0 ? (w * h) / (m.w * m.h) : 0;
}

// Milo waits at a plot's gate while Codex walks in to design, or out when the plans land.
function gateWalk(plotId, direction) {
  const clock = manualClock();
  const { canvas, listeners, draws, cleanup } = fakeDom({ clock });
  const door = placeById(plotId).door;
  const moves = [];
  const places = [];
  const world = createWorld(canvas, {
    motion: () => true,
    startTile: door,
    onMiloMove: (tile) => moves.push(tile),
    onPlaceClick: (id) => places.push(id),
  });
  world.setPlots({ [plotId]: { status: 'designing' } });
  if (direction === 'out') {
    world.setCrew([{ id: 'codex', state: 'designing', plotId, label: 'Codex', count: 0 }]); // already at work there
    clock.advance(200);
    world.setPlots({ [plotId]: { status: 'built', blueprint: STUDIO } });
    world.celebrate(plotId);
    world.setCrew([{ id: 'codex', state: 'done', label: 'Codex', count: 1 }]);
  } else {
    world.setCrew([{ id: 'codex', state: 'idle', label: 'Codex', count: 0 }]); // resting by the fire
    clock.advance(200);
    world.setCrew([{ id: 'codex', state: 'designing', plotId, label: 'Codex', count: 0 }]);
  }
  const at = (tile) => tile.x === door.x && tile.y === door.y;
  const run = { clock, listeners, world, door, moves, places, worst: 0, asideAt: null, cleanup };
  run.play = (ms, stop = () => false) => clock.advance(ms, (t) => {
    draws.length = 0;
    run.worst = Math.max(run.worst, crewOverMilo(world, 'codex'));
    if (run.asideAt === null && !at(world.miloTile())) run.asideAt = t;
    return !stop(t);
  });
  return run;
}

test('Milo steps aside at a plot gate so crew never walk through him, then steps back', () => {
  for (const id of PLOT_IDS) {
    for (const direction of ['out', 'in']) {
      const run = gateWalk(id, direction);
      try {
        run.play(22_000);
        const label = `${id}, crew walking ${direction}`;
        assert.ok(run.asideAt !== null, `${label}: Milo made way`);
        assert.ok(run.worst <= 0.12, `${label}: at most a brush past his feet, never on top of him (${Math.round(run.worst * 100)}% of Milo covered)`);
        assert.deepEqual(run.world.miloTile(), run.door, `${label}: back at the gate once they're by`);
        assert.deepEqual(run.moves, [], `${label}: his spot stays the gate (nothing new to save)`);
      } finally {
        run.world.dispose();
        run.cleanup();
      }
    }
  }
});

test('Milo waits for the reveal before stepping aside for the designer', () => {
  const run = gateWalk('plot-orchard', 'out');
  try {
    const start = run.clock.t;
    run.play(4000, () => run.asideAt !== null);
    const waited = run.asideAt - start;
    assert.ok(waited >= 1000 && waited <= 1600, `he steps aside as the designer sets off, not at once (${waited} ms)`);
  } finally {
    run.world.dispose();
    run.cleanup();
  }
});

test('while Milo has stepped aside, Enter still opens the plot and Chris can walk him away', () => {
  const run = gateWalk('plot-rise', 'out');
  try {
    run.play(6000, () => run.asideAt !== null);
    assert.ok(run.asideAt !== null, 'Milo made way');
    run.play(600);
    assert.notDeepEqual(run.world.miloTile(), run.door);
    run.listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.deepEqual(run.places, ['plot-rise'], 'Enter opens the plot he is waiting at');
    run.world.walkTo(MAP.miloHome);
    run.play(22_000);
    assert.deepEqual(run.world.miloTile(), MAP.miloHome, 'Chris sent him home, so he does not go back to the gate');
    assert.deepEqual(run.moves.at(-1), MAP.miloHome, 'and the new spot is saved');
    assert.ok(run.worst <= 0.12, `and nobody walked through him (${Math.round(run.worst * 100)}%)`);
  } finally {
    run.world.dispose();
    run.cleanup();
  }
});

test('a building being redesigned stays standing behind a scaffold', () => {
  const look = plotLook({ status: 'designing', blueprint: STUDIO, name: 'Stream room' });
  assert.equal(look.status, 'designing');
  assert.equal(look.redesign, true);
  assert.equal(look.name, 'Stream room');
  assert.notEqual(look.key, plotLook({ status: 'built', blueprint: STUDIO }).key);
  const { canvas, draws, cleanup } = fakeDom();
  const world = createWorld(canvas, { motion: () => false });
  try {
    world.setPlots({ 'plot-rise': { status: 'built', blueprint: STUDIO } });
    world.setPlots({ 'plot-rise': { status: 'designing', blueprint: STUDIO, name: 'Stream room' } });
    assert.equal(world.plotLabel('plot-rise'), 'Stream room · being redesigned');
    draws.length = 0;
    world.renderMap(1);
    assert.ok(draws.length > 0 && draws.every((draw) => draw.image), 'drawn from the building with its scaffold');
    assert.ok(world.keepClear().some((rect) => rect.kind === 'plot' && rect.id === 'plot-rise'), 'bubbles keep off it while it is worked on');
    world.setPlots({ 'plot-rise': { status: 'built', blueprint: { ...STUDIO, yard: 'stone' } } });
    world.celebrate('plot-rise');
    assert.equal(world.plotLabel('plot-rise'), 'Clip studio');
  } finally {
    world.dispose();
    cleanup();
  }
});

// ---------- the wilds (Phase 3, CONTRACT-PHASE3.md §3, §7.4 and §9 G) ----------

const CONTENT = Object.fromEntries(['genres', 'riftgen', 'fortress', 'wilds', 'story'].map((name) => [name, JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'))]));
const RIFTGEN = createRiftgen({ words: CONTENT.riftgen, genres: CONTENT.genres });
const WORLDGEN = createWorldgen({ seed: 'hushlands', regionWords: CONTENT.riftgen.regionWords });
const WILDS = createWilds({ worldgen: WORLDGEN });
const GATE_TILES = Object.fromEntries(Object.entries(GATES).map(([id, g]) => [id, { x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y, dir: g.dir }]));
const HEART_PX = { x0: 0, y0: 0, x1: MAP.width * TILE, y1: MAP.height * TILE };
const inHeartTile = (t) => t.x >= 0 && t.y >= 0 && t.x < MAP.width && t.y < MAP.height;
const isGateTile = (t) => Object.values(GATE_TILES).some((g) => g.x === t.x && g.y === t.y);
const onRing = (t) => t.x >= -1 && t.y >= -1 && t.x <= MAP.width && t.y <= MAP.height && !inHeartTile(t);
const settleFrames = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
function testRift(genreIds, stage, x, y, extra = {}) {
  const spec = testSpec(genreIds, stage, extra.salt || 0);
  return {
    id: spec.id, key: `test:${spec.id}`, kind: 'real', realKind: 'knocking', spec, x, y, beyond: 8, towards: null, stage: spec.stage,
    urgency: 0.5, bright: false, warded: null, held: null, atWalls: false, cause: 'A test rift.', stitch: 'Nothing to mend.', since: 0, echo: null, subject: null, ...extra,
  };
}

function wildWorld({ dom = {}, ...options } = {}) {
  const env = fakeDom(dom);
  const events = { moves: [], areas: [], explored: [], entities: [], hovers: [] };
  const world = createWorld(env.canvas, {
    motion: () => false,
    content: CONTENT,
    onMiloMove: (tile) => events.moves.push(tile),
    onAreaChange: (info) => events.areas.push(info),
    onExplore: (keys) => events.explored.push(...keys),
    onEntityClick: (entity) => events.entities.push(entity),
    onHover: (info) => events.hovers.push(info),
    ...options,
  });
  world.setWildState({ day: 20000, tier: 1, wardRadius: 0, closed: [], lit: [], opened: [], felled: {} });
  return { world, events, ...env };
}

// Where a world pixel sits on screen, from Milo's head (the one screen position the engine reports).
function screenOf(world, wx, wy) {
  const head = world.miloScreenPos();
  const tile = world.miloTile();
  return { x: head.x + (wx - (tile.x * TILE + 8)) * world.scale, y: head.y + (wy - (tile.y * TILE + 13 - 19)) * world.scale };
}

test('wilds: Milo walks out of each of the four gates and back in', async () => {
  const clock = manualClock();
  const { world, events, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
  try {
    for (const [id, gate] of Object.entries(GATE_TILES)) {
      assert.equal(await drive(clock, world.travelTo('home')), true);
      events.moves.length = 0;
      const beyond = { x: gate.x + gate.dir.x * 3, y: gate.y + gate.dir.y * 3 };
      assert.equal(await drive(clock, world.walkTo(beyond)), true, `${id}: he gets out`);
      assert.deepEqual(world.miloTile(), beyond);
      assert.ok(events.moves.some((t) => t.x === gate.x && t.y === gate.y), `${id}: through its gate tile`);
      assert.ok(events.moves.every((t) => !onRing(t) || isGateTile(t)), `${id}: never over a wall`);
      assert.equal(world.area().area, 'wilds');
      events.moves.length = 0;
      assert.equal(await drive(clock, world.walkTo(MAP.miloHome)), true, `${id}: and back home`);
      assert.deepEqual(world.miloTile(), MAP.miloHome);
      assert.ok(events.moves.some((t) => t.x === gate.x && t.y === gate.y), `${id}: in by the same gate`);
      assert.equal(world.area().area, 'vale');
    }
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: the ring round the vale is shut everywhere but the gates', async () => {
  const clock = manualClock();
  const { world, listeners, events, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
  try {
    for (const tier of [1, 2]) {
      world.setWildState({ tier, wardRadius: tier >= 2 ? 12 : 0 });
      for (let x = -1; x <= MAP.width; x += 1) {
        for (const y of [-1, MAP.height]) assert.equal(world.isWalkable(x, y), isGateTile({ x, y }), `tier ${tier}: ${x},${y}`);
      }
      for (let y = 0; y < MAP.height; y += 1) {
        for (const x of [-1, MAP.width]) assert.equal(world.isWalkable(x, y), isGateTile({ x, y }), `tier ${tier}: ${x},${y}`);
      }
    }
    const war = WILDS.warTable();
    assert.equal(world.isWalkable(war.x, war.y), false, 'the War Table stands in the way at tier 2');
    // A step at a wall goes nowhere; a walk to just past one goes round by a gate.
    assert.equal(await drive(clock, world.travelTo({ x: 0, y: 13 })), true);
    assert.deepEqual(world.miloTile(), { x: 0, y: 13 });
    listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
    listeners.keyup({ key: 'ArrowLeft' });
    clock.advance(600);
    assert.deepEqual(world.miloTile(), { x: 0, y: 13 }, 'the palisade holds');
    events.moves.length = 0;
    assert.equal(await drive(clock, world.walkTo({ x: -3, y: 13 })), true);
    assert.deepEqual(world.miloTile(), { x: -3, y: 13 });
    assert.ok(events.moves.some((t) => t.x === GATE_TILES['gate:w'].x && t.y === GATE_TILES['gate:w'].y), 'out by the west gate');
    assert.ok(events.moves.every((t) => !onRing(t) || isGateTile(t)), 'never over a wall');
    // Straight back over the wall is refused too: a walk that can only go round goes round.
    events.moves.length = 0;
    assert.equal(await drive(clock, world.walkTo({ x: 0, y: 13 })), true);
    assert.ok(events.moves.some((t) => t.x === GATE_TILES['gate:w'].x && t.y === GATE_TILES['gate:w'].y), 'in by the west gate');
    assert.ok(events.moves.every((t) => !onRing(t) || isGateTile(t)));
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: no rift, stray or seal is ever drawn inside the vale', async () => {
  const { world, draws, cleanup } = wildWorld();
  try {
    const inside = testRift(['neon'], 'gaping', 20, 20);
    const ring = testRift(['gothic'], 'open', 20, -1, { salt: 1 });
    const north = testRift(['nocturne'], 'gaping', 30, -5, { salt: 2 });
    const south = testRift(['iron', 'neon'], 'gaping', 14, 48, { salt: 3 });
    const east = testRift(['void'], 'open', 68, 20, { salt: 4 });
    world.setRifts([inside, ring, north, south, east]);
    const seen = new Set();
    const drawnRiftBits = () => draws.filter((d) => typeof d.image._milo === 'string' && /^(tear|stray|seal|letgo):/.test(d.image._milo));
    for (const tile of [{ x: 30, y: 1 }, { x: 11, y: 42 }, { x: 62, y: 19 }, { x: 1, y: 20 }, { x: 20, y: 12 }, { x: 30, y: -6 }]) {
      assert.equal(await world.travelTo(tile), true);
      world.settle();
      draws.length = 0;
      world.resize(); // a fresh still frame
      await settleFrames();
      for (const d of drawnRiftBits()) {
        seen.add(d.image._milo);
        const [x, y] = d.args;
        const clear = x + d.image.width <= HEART_PX.x0 || y + d.image.height <= HEART_PX.y0 || x >= HEART_PX.x1 || y >= HEART_PX.y1;
        assert.ok(clear, `${d.image._milo} at ${x},${y} (${d.image.width}×${d.image.height}) stays out of the vale`);
      }
    }
    const drawn = (rift) => seen.has(`tear:${rift.id}`);
    assert.ok(drawn(north) && drawn(south) && drawn(east), 'the rifts outside were drawn');
    assert.ok(!drawn(inside) && !drawn(ring), 'the ones given in the vale or on its wall never are');
    assert.ok([...seen].some((tag) => tag.startsWith('stray:')), 'and their strays');
    // Closing one near the wall: its seal is drawn outside too.
    world.closeRift(north.id, 'sealed');
    assert.equal(world.nearbyEntities().some((e) => e.id === north.id), false);
    // And the vale's own picture never has a rift in it.
    draws.length = 0;
    world.renderMap(1);
    assert.equal(drawnRiftBits().length, 0);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: travel to a lantern, home or a tile, with a calm fade when motion is on', async () => {
  const lantern = WILDS.fixedPois().find((p) => p.type === 'lantern');
  {
    const { world, events, cleanup } = wildWorld();
    try {
      assert.equal(await world.travelTo(lantern.id), true);
      assert.deepEqual(world.miloTile(), { x: lantern.x, y: lantern.y }, 'at the lantern, where he stands to light it');
      assert.deepEqual(events.moves.at(-1), { x: lantern.x, y: lantern.y }, 'the shell hears where he went');
      assert.equal(world.area().area, 'wilds');
      assert.ok(events.areas.at(-1).chunk === `${Math.floor(lantern.x / 32)},${Math.floor(lantern.y / 32)}`);
      assert.ok(world.nearbyEntities().some((e) => e.id === lantern.id && e.kind === 'lantern'), 'it is in the list, nearest first');
      assert.equal(world.nearbyEntities()[0].id, lantern.id);
      assert.equal(await world.travelTo('home'), true);
      assert.deepEqual(world.miloTile(), MAP.miloHome);
      assert.equal(await world.travelTo({ x: 40, y: -20 }), true);
      const at = world.miloTile();
      assert.ok(Math.abs(at.x - 40) <= 3 && Math.abs(at.y + 20) <= 3 && world.isWalkable(at.x, at.y), 'a tile: there or just beside it');
      assert.equal(await world.travelTo('lantern:9999,9999'), false, 'nowhere');
      assert.equal(await world.travelTo({ x: 20, y: 20 }), true, 'a walkable vale tile');
    } finally {
      world.dispose();
      cleanup();
    }
  }
  {
    const clock = manualClock();
    const { world, draws, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
    try {
      let done = false;
      const trip = world.travelTo(lantern.id).then((ok) => { done = ok; });
      clock.advance(200);
      assert.deepEqual(world.miloTile(), MAP.miloHome, 'still home while the view fades out');
      assert.ok(world.stats().fade > 0.2, 'fading');
      clock.advance(400);
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(world.miloTile(), { x: lantern.x, y: lantern.y }, 'moved while the view is dark');
      for (let i = 0; i < 12 && !done; i += 1) {
        clock.advance(120);
        await flush();
      }
      assert.equal(done, true);
      assert.ok(world.stats().fade === 0, 'and faded back in');
      assert.ok(draws.length > 0);
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

test('wilds: chopping a tree takes a moment, faces it, and a felled tree is left alone', async () => {
  {
    const { world, cleanup } = wildWorld();
    try {
      await world.travelTo({ x: 26, y: -6 });
      const tree = world.nearbyEntities().find((e) => e.kind === 'tree');
      assert.ok(tree, 'a tree nearby');
      const result = await world.chop(tree.id);
      assert.deepEqual(result, { ok: true, kind: tree.wood });
      const at = world.miloTile();
      assert.equal(Math.abs(at.x - tree.x) + Math.abs(at.y - tree.y), 1, 'beside the tree');
      world.setWildState({ felled: { [tree.id]: 20000 } });
      assert.equal((await world.chop(tree.id)).ok, false, 'a stump gives nothing more');
      assert.equal((await world.chop('tree:9999,9999')).ok, false);
      assert.equal((await world.chop('lantern:1,1')).ok, false);
    } finally {
      world.dispose();
      cleanup();
    }
  }
  {
    const clock = manualClock();
    const { world, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
    try {
      await world.travelTo({ x: 26, y: -6 });
      const tree = world.nearbyEntities().find((e) => e.kind === 'tree');
      // Walk beside it first (the walk resolves as the clock runs).
      const approach = tree.approach;
      const walk = world.walkTo(approach);
      clock.advance(3000);
      await walk;
      let result = null;
      world.chop(tree.id).then((r) => { result = r; });
      await flush();
      clock.advance(2000);
      await flush();
      assert.equal(result, null, 'still chopping after two seconds');
      assert.ok(world.stats().chopAge >= 1900);
      clock.advance(700);
      await flush();
      assert.deepEqual(result, { ok: true, kind: tree.wood }, 'done in about two and a half');
      // A walk of Chris's stops a chop: it settles, with nothing gained.
      let second = null;
      world.chop(tree.id).then((r) => { second = r; });
      await flush();
      clock.advance(500);
      world.walkTo(MAP.miloHome);
      await flush();
      assert.deepEqual(second, { ok: false, kind: tree.wood });
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

// ---------- a walk begun part way through a step ----------

const WILD_STATE = { day: 20000, tier: 1, wardRadius: 0, closed: [], lit: [], opened: [], felled: {} };
// Where Milo is drawn, in art px from the campfire (a spot that never moves), read off keepClear.
function fromFire(world) {
  const rects = world.keepClear();
  const milo = rects.find((r) => r.kind === 'milo');
  const fire = rects.find((r) => r.kind === 'campfire');
  return { x: (milo.x - fire.x) / world.scale, y: (milo.y - fire.y) / world.scale };
}
// Whether he stands exactly on his tile's feet, against `ref` ({ tile, at }) taken on a tile.
function onTileFeet(world, ref) {
  const at = fromFire(world);
  const tile = world.miloTile();
  return at.x === ref.at.x + (tile.x - ref.tile.x) * TILE && at.y === ref.at.y + (tile.y - ref.tile.y) * TILE;
}
// A world with motion on and the manual clock, Milo at home (31, 22), the vale alone or the wilds.
function stepWorld(wilds, options = {}) {
  const clock = manualClock();
  const env = fakeDom({ clock });
  const events = { moves: [], entities: [] };
  const world = createWorld(env.canvas, {
    motion: () => true,
    content: wilds ? CONTENT : undefined,
    startTile: { x: 31, y: 22 },
    onMiloMove: (tile) => events.moves.push(tile),
    onEntityClick: (entity) => events.entities.push(entity),
    ...options,
  });
  if (wilds) world.setWildState(WILD_STATE);
  clock.advance(100);
  const ref = { tile: world.miloTile(), at: fromFire(world) };
  return { world, clock, events, ref, ...env };
}

test('a walk begun part way through a step turns onto its way and ends on its tile', async () => {
  for (const wilds of [false, true]) {
    for (const after of [60, 100, 150]) {
      const label = `${wilds ? 'wilds' : 'vale'}, ${after} ms in`;
      const { world, clock, events, ref, listeners, cleanup } = stepWorld(wilds);
      try {
        assert.deepEqual(ref.tile, { x: 31, y: 22 });
        world.walkTo({ x: 31, y: 28 });
        clock.advance(after);
        assert.ok(!onTileFeet(world, ref), `${label}: part way down his first step`);
        // Then a spot off to the side: the new way begins at right angles to the step he's in.
        const value = await drive(clock, world.walkTo({ x: 26, y: 23 }));
        assert.equal(value, wilds ? true : undefined, label);
        assert.deepEqual(world.miloTile(), { x: 26, y: 23 }, label);
        assert.deepEqual(events.moves.at(-1), { x: 26, y: 23 }, `${label}: the shell hears he got there`);
        assert.ok(onTileFeet(world, ref), `${label}: standing on it`);
        // And the arrow keys walk on from there, a tile at a time.
        const [key, next] = [['ArrowRight', { x: 27, y: 23 }], ['ArrowLeft', { x: 25, y: 23 }], ['ArrowDown', { x: 26, y: 24 }], ['ArrowUp', { x: 26, y: 22 }]]
          .find(([, t]) => world.isWalkable(t.x, t.y));
        listeners.keydown({ key, preventDefault() {} });
        listeners.keyup({ key });
        clock.advance(600);
        assert.deepEqual(world.miloTile(), next, label);
        assert.ok(onTileFeet(world, ref), label);
      } finally {
        world.dispose();
        cleanup();
      }
    }
  }
});

test('a walk with nowhere to go, begun part way through a step, still leaves Milo on a tile', async () => {
  for (const wilds of [false, true]) {
    for (const where of ['his own tile', 'water he cannot reach']) {
      const label = `${wilds ? 'wilds' : 'vale'}, ${where}`;
      const { world, clock, ref, cleanup } = stepWorld(wilds);
      try {
        world.walkTo({ x: 31, y: 28 });
        clock.advance(120);
        assert.ok(!onTileFeet(world, ref), `${label}: part way down his first step`);
        const dest = where === 'his own tile' ? world.miloTile() : { x: 60, y: 42 };
        const value = await drive(clock, world.walkTo(dest));
        assert.equal(value, wilds ? where === 'his own tile' : undefined, `${label}: it says whether he got there`);
        assert.deepEqual(world.miloTile(), { x: 31, y: 22 }, label);
        assert.ok(onTileFeet(world, ref), `${label}: back on his tile, not between two`);
      } finally {
        world.dispose();
        cleanup();
      }
    }
  }
});

test('wilds: a walk to an entity or a chop begun part way through a step gets there, on a tile', async () => {
  {
    // The shell's Step through and Visit wait on walkToEntity: it has to settle.
    const { world, clock, events, ref, cleanup } = stepWorld(true);
    try {
      world.setEchoes([{ id: 'echo:rift:a', riftId: 'rift:a', place: 'plot-birch', icon: 'spark', genre: 'neon', label: 'A spark' }]);
      world.walkTo({ x: 31, y: 28 });
      clock.advance(100);
      assert.ok(!onTileFeet(world, ref), 'part way down his first step');
      assert.equal(await drive(clock, world.walkToEntity('echo:rift:a')), true);
      assert.equal(events.entities.at(-1).id, 'echo:rift:a', 'opened on arrival');
      assert.deepEqual(world.miloTile(), placeById('plot-birch').door);
      assert.ok(onTileFeet(world, ref));
    } finally {
      world.dispose();
      cleanup();
    }
  }
  {
    // Beside a tree but just stepping away: he steps back onto his tile and chops from there.
    const { world, clock, cleanup } = stepWorld(true);
    try {
      assert.equal(await drive(clock, world.travelTo({ x: 26, y: -6 })), true);
      const tree = world.nearbyEntities().find((e) => e.kind === 'tree');
      assert.equal(await drive(clock, world.walkTo(tree.approach)), true);
      const ref = { tile: world.miloTile(), at: fromFire(world) };
      const away = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => ({ x: ref.tile.x + dx * 3, y: ref.tile.y + dy * 3 }))
        .find((t) => world.isWalkable(t.x, t.y) && !(t.x === tree.x && t.y === tree.y));
      world.walkTo(away);
      clock.advance(100);
      assert.deepEqual(world.miloTile(), ref.tile, 'still beside the tree');
      assert.ok(!onTileFeet(world, ref), 'part way through his first step away');
      assert.deepEqual(await drive(clock, world.chop(tree.id)), { ok: true, kind: tree.wood });
      assert.deepEqual(world.miloTile(), ref.tile);
      assert.ok(onTileFeet(world, ref), 'chopped standing on his tile');
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

test('wilds: Milo steps through a rift into its Elsewhere, stitches it and comes back out', async () => {
  const { world, events, cleanup } = wildWorld();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const rift = { ...testRift(['frontier'], 'open', 34, -12), kind: 'wild', key: null };
    assert.equal(await world.enterElsewhere(rift), true);
    const inside = world.elsewhere();
    assert.equal(inside.riftId, rift.id);
    assert.equal(inside.name, rift.spec.name);
    assert.equal(inside.depth, rift.spec.depth);
    const area = events.areas.at(-1);
    assert.equal(area.area, 'elsewhere');
    assert.deepEqual(area.rift, { id: rift.id, name: rift.spec.name });
    assert.equal(world.area().area, 'elsewhere');
    const spawn = world.miloTile();
    assert.equal(world.isWalkable(spawn.x, spawn.y), true, 'he arrives on the scene’s own floor');
    const kinds = new Set(world.nearbyEntities().map((e) => e.kind));
    assert.ok(kinds.has('exit'), 'the way home is right behind him');
    const moves = events.moves.length;
    // Walk to the seam and open it there.
    assert.equal(await world.walkToEntity('stitch'), true);
    assert.equal(events.entities.at(-1).kind, 'stitch');
    assert.equal(events.entities.at(-1).refused, false, 'a wild seam takes the thread');
    assert.equal(events.moves.length, moves, 'steps in an Elsewhere are not saved');
    world.closeRift(rift.id, 'stitched');
    assert.equal(world.nearbyEntities().some((e) => e.kind === 'stitch'), false, 'the seam is closed');
    assert.equal(await world.walkTo('camp'), false, 'no vale places in here');
    // Leave: back out by the rift, on its approach tile in the world.
    assert.equal(await world.leaveElsewhere(), true);
    assert.equal(world.elsewhere(), null);
    const back = world.miloTile();
    assert.equal(Math.abs(back.x - rift.x) + Math.abs(back.y - rift.y), 1, 'beside the rift he went through');
    assert.deepEqual(events.moves.at(-1), back);
    assert.equal(events.areas.at(-1).area, 'wilds');
    assert.equal(await world.leaveElsewhere(), false, 'not inside any more');
    // A real rift's seam holds.
    const real = testRift(['gothic'], 'open', 34, -12, { salt: 5 });
    assert.equal(await world.enterElsewhere(real), true);
    await world.walkToEntity('stitch');
    assert.equal(events.entities.at(-1).refused, true);
    await world.leaveElsewhere();
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: a seam stitched just before motion goes off stays shut in the still frames', async () => {
  const clock = manualClock();
  let motion = true;
  const { world, draws, cleanup } = wildWorld({ dom: { clock }, motion: () => motion });
  try {
    const rift = testRift(['neon'], 'open', 28, -12);
    world.setRifts([rift]);
    assert.equal(await drive(clock, world.enterElsewhere(rift)), true);
    assert.equal(await drive(clock, world.walkToEntity('stitch')), true);
    // The seam's art in the next few frames: its tear, or the seal drawing it shut.
    const seam = () => {
      draws.length = 0;
      clock.advance(48);
      return [...new Set(draws.map((d) => d.image._milo).filter((tag) => typeof tag === 'string' && /^(tear|seal)/.test(tag)))];
    };
    assert.deepEqual(seam(), [`tear:${rift.id}`], 'open');
    world.closeRift(rift.id, 'stitched');
    clock.advance(300);
    assert.deepEqual(seam(), ['seal'], 'drawing shut');
    motion = false; // switched off part way through the seal
    assert.deepEqual(seam(), [], 'a still frame draws it shut');
    world.resize();
    assert.deepEqual(seam(), [], 'and so does the next');
    assert.equal(world.elsewhereEntities().some((e) => e.kind === 'stitch'), false);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: clicking an entity walks there and opens it on arrival; hover names it; Enter opens it', async () => {
  const { world, listeners, events, cleanup } = wildWorld();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const rift = testRift(['neon'], 'open', 35, -10);
    world.setRifts([rift]);
    world.settle();
    // Point at the tear: it rises from its tile's feet point.
    const aim = screenOf(world, rift.x * TILE + 8, rift.y * TILE + 13 - 10);
    listeners.pointermove({ clientX: aim.x, clientY: aim.y });
    const hover = events.hovers.at(-1);
    assert.equal(hover.kind, 'rift');
    assert.equal(hover.id, rift.id);
    assert.equal(hover.label, rift.spec.name, 'the label comes from the entity');
    listeners.pointerdown({ button: 0, clientX: aim.x, clientY: aim.y });
    await settleFrames(20);
    const opened = events.entities.at(-1);
    assert.equal(opened.id, rift.id, 'opened on arrival');
    const at = world.miloTile();
    assert.ok(Math.abs(at.x - rift.x) + Math.abs(at.y - rift.y) === 1, 'standing just by the tear');
    assert.ok(!world.nearbyEntities().some((e) => e.kind === 'rift' && e.x === at.x && e.y === at.y));
    // Enter at the approach tile opens it again.
    const count = events.entities.length;
    listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(events.entities.length, count + 1);
    assert.equal(events.entities.at(-1).id, rift.id);
    // A lantern by id: walked to and opened.
    const lantern = WILDS.fixedPois().find((p) => p.type === 'lantern');
    await world.travelTo({ x: lantern.x, y: lantern.y + 3 });
    assert.equal(await world.walkToEntity(lantern.id), true);
    assert.equal(events.entities.at(-1).id, lantern.id);
    assert.equal(events.entities.at(-1).kind, 'lantern');
    assert.deepEqual(world.miloTile(), { x: lantern.x, y: lantern.y });
    // Scenery and empty ground are not entities: a click there just walks.
    assert.equal(await world.walkToEntity('poi:nothing:0,0'), false);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: echoes float over their places in the vale and open like entities', async () => {
  const { world, events, draws, cleanup } = wildWorld({ startTile: MAP.miloHome });
  try {
    world.setEchoes([
      { id: 'echo:rift:a', riftId: 'rift:a', place: 'camp', icon: 'spark', genre: 'neon', label: 'A spark from the frontier' },
      { id: 'echo:rift:b', riftId: 'rift:b', place: 'nowhere', icon: 'moon', genre: 'nocturne', label: 'Lost' },
    ]);
    const echoes = world.nearbyEntities().filter((e) => e.kind === 'echo');
    assert.deepEqual(echoes.map((e) => e.id), ['echo:rift:a'], 'an unknown place is skipped');
    assert.equal(echoes[0].label, 'A spark from the frontier');
    assert.deepEqual(echoes[0].approach, placeById('camp').door);
    draws.length = 0;
    world.resize();
    await settleFrames();
    // Over the tent's peak (the tent's sprite is 32 wide, its top at y 249): the icon and its halo.
    assert.ok(draws.some((d) => d.image.width === 10 && d.image.height === 10 && d.args[0] === 579 && d.args[1] === 235), 'the icon floats over the tent');
    assert.ok(draws.some((d) => d.image.width === 18 && d.image.height === 18 && d.args[0] === 575 && d.args[1] === 231), 'in its genre’s light');
    assert.equal(await world.walkToEntity('echo:rift:a'), true);
    assert.equal(events.entities.at(-1).kind, 'echo');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: the view follows Milo past the vale’s edge, and the vale-only camera still clamps', () => {
  for (const content of [CONTENT, null]) {
    const env = fakeDom();
    const world = createWorld(env.canvas, { motion: () => false, content, startTile: { x: 0, y: 20 } });
    try {
      const pos = world.miloScreenPos();
      if (content) assert.ok(Math.abs(pos.x - 500) <= world.scale * 2, `centred on Milo at the west edge (${Math.round(pos.x)})`);
      else assert.ok(pos.x < 100, 'the vale alone clamps to the map');
    } finally {
      world.dispose();
      env.cleanup();
    }
  }
  const { world, cleanup } = wildWorld({ startTile: { x: 30, y: -12 } });
  try {
    assert.deepEqual(world.miloTile(), { x: 30, y: -12 }, 'a start tile out in the wilds (previews)');
    const pos = world.miloScreenPos();
    assert.ok(Math.abs(pos.x - 500) <= world.scale * 2 && pos.y > 0 && pos.y < 700);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: the area and the chunks seen are reported as Milo goes', async () => {
  const { world, events, cleanup } = wildWorld();
  try {
    await settleFrames(10);
    assert.equal(events.areas[0].area, 'vale');
    assert.equal(events.areas[0].regionName, 'Hearthvale');
    await world.walkTo({ x: 32, y: -6 });
    world.resize();
    await settleFrames();
    const area = events.areas.at(-1);
    assert.equal(area.area, 'wilds');
    assert.equal(area.regionId, 'whisperwood');
    assert.equal(area.regionName, 'The Whisperwood');
    assert.equal(area.hush, true, 'the Whisperwood waits in the Hush');
    assert.equal(area.chunk, '1,-1');
    assert.ok(Number.isInteger(area.tier) && Number.isInteger(area.depth));
    assert.deepEqual(world.area(), area);
    assert.ok(events.explored.includes('1,-1') && events.explored.includes('0,-1'), 'chunks in view are explored');
    assert.ok(!events.explored.includes('0,0') && !events.explored.includes('1,0'), 'the vale’s own chunks are not reported');
    assert.equal(new Set(events.explored).size, events.explored.length, 'each chunk once');
    assert.equal(await world.walkTo('camp'), false, 'a vale place from the wilds: no walk');
    assert.deepEqual(world.miloTile(), { x: 32, y: -6 }, 'and he stays put');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: streaming keeps to 25 canvases, waits while hidden, and still frames repeat exactly', async () => {
  const { world, canvas, draws, cleanup } = wildWorld();
  try {
    for (const tile of [{ x: 32, y: -8 }, { x: -12, y: 20 }, { x: 80, y: 14 }, { x: 11, y: 60 }, { x: 32, y: -40 }]) {
      await world.travelTo(tile);
      world.settle();
      assert.ok(world.stats().canvases <= 25, `${world.stats().canvases} canvases`);
    }
    // Hidden: no idle work happens.
    canvas.ownerDocument.hidden = true;
    await world.travelTo({ x: 60, y: -40 });
    const before = world.stats();
    await settleFrames(120);
    const after = world.stats();
    assert.equal(after.chunks, before.chunks, 'nothing generated while hidden');
    canvas.ownerDocument.hidden = false;
    // Still frames: the same picture twice.
    const rift = testRift(['nocturne'], 'gaping', 64, -42);
    world.setRifts([rift]);
    world.settle();
    // The last whole frame drawn (each ends with the buffer scaled up onto the canvas).
    const frame = async () => {
      draws.length = 0;
      world.resize();
      await settleFrames();
      const ends = draws.map((d, i) => (d.args.length === 8 && d.args[6] > d.args[2] ? i : -1)).filter((i) => i >= 0);
      const last = draws.slice(ends.length > 1 ? ends.at(-2) + 1 : 0, ends.at(-1) + 1);
      return last.map((d) => `${d.image._milo || `${d.image.width}x${d.image.height}`}@${d.args.join(',')}`).join('|');
    };
    const a = await frame();
    const b = await frame();
    assert.ok(a.includes(`tear:${rift.id}`));
    assert.equal(a, b);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: idle slices prepare the chunks round the view by themselves; a frame draws only what is in view', async () => {
  const { world, draws, cleanup } = wildWorld();
  try {
    assert.equal(await world.travelTo({ x: 40, y: -70 }), true);
    // The view's own chunks were made ready for the fade in; the ring round it is still to come.
    draws.length = 0;
    world.resize();
    await settleFrames();
    const chunkDraws = () => draws.filter((d) => typeof d.image._milo === 'string' && d.image._milo.startsWith('chunk:'));
    assert.ok(chunkDraws().length > 0, 'the ground under the view is drawn at once');
    assert.equal(world.stats().pending, true, 'the chunks one out are left for idle time');
    // No settle(): the idle slices (a timer here, requestIdleCallback in Electron) get there alone.
    const started = Date.now();
    while (world.stats().pending && Date.now() - started < 40000) await settleFrames(60);
    assert.equal(world.stats().pending, false, 'everything round the view is ready');
    assert.ok(world.stats().canvases <= 25);
    // A frame now draws only ready canvases, one per chunk in view.
    draws.length = 0;
    world.resize();
    await settleFrames();
    const keys = chunkDraws().map((d) => d.image._milo);
    assert.equal(new Set(keys).size, keys.length, 'each chunk once');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: the Stockade rises, the map view gets its chunks, and words drift up', async () => {
  const { world, draws, cleanup } = wildWorld({ startTile: { x: 32, y: 2 } });
  try {
    const war = WILDS.warTable();
    assert.equal(world.isWalkable(war.x, war.y), true, 'no War Table at tier 1');
    world.raiseReveal(2);
    assert.equal(world.isWalkable(war.x, war.y), false, 'raised: the War Table stands by the north gate');
    world.setWildState({ tier: 2, wardRadius: 12 });
    const canvasOf = world.paintMapChunk(0, -1, 4);
    assert.equal(canvasOf.width, 128);
    assert.equal(canvasOf.height, 128);
    assert.equal(world.paintMapChunk(0.5, 1, 4), null);
    world.floatText('+5 birch', { x: 32, y: 1 });
    draws.length = 0;
    world.resize();
    await settleFrames();
    assert.ok(draws.some((d) => d.image._milo === 'float'), 'the words are drawn');
    world.floatText('', { x: 1, y: 1 });
    world.floatText('+2', null);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: with no content the world is the vale alone, and the new calls do nothing', async () => {
  const { canvas, listeners, draws, cleanup } = fakeDom();
  const moves = [];
  const world = createWorld(canvas, { motion: () => false, onMiloMove: (t) => moves.push(t), startTile: { x: 32, y: 0 } });
  try {
    assert.equal(world.isWalkable(32, -1), false, 'no gate out');
    assert.equal(world.isWalkable(32, 0), true);
    await world.walkTo({ x: 32, y: -3 });
    assert.deepEqual(world.miloTile(), { x: 32, y: 0 }, 'he stays in the vale');
    listeners.keydown({ key: 'ArrowUp', preventDefault() {} });
    assert.deepEqual(world.miloTile(), { x: 32, y: 0 });
    assert.equal(await world.walkTo('camp'), undefined, 'walks settle as they always have');
    assert.deepEqual(world.miloTile(), placeById('camp').door);
    assert.equal(await world.travelTo('home'), false);
    assert.equal(await world.walkToEntity('lantern:28,-34'), false);
    assert.deepEqual(await world.chop('tree:1,1'), { ok: false, kind: null });
    assert.equal(await world.enterElsewhere({ id: 'rift:x', spec: {} }), false);
    assert.equal(await world.leaveElsewhere(), false);
    assert.equal(world.elsewhere(), null);
    assert.deepEqual(world.nearbyEntities(), []);
    assert.equal(world.paintMapChunk(0, -1, 4), null);
    assert.equal(world.area().area, 'vale');
    assert.equal(world.closeRift('rift:x', 'sealed'), false);
    world.setRifts([]);
    world.setEchoes([]);
    world.setWildState({ tier: 2 });
    world.raiseReveal(2);
    world.floatText('+5 birch', { x: 1, y: 1 });
    assert.equal(world.stats(), null);
    // The vale's own picture is the same with the wilds on.
    const valeDraws = () => {
      draws.length = 0;
      world.renderMap(1);
      return draws.map((d) => `${d.image.width}x${d.image.height}@${d.args.join(',')}`).join('|');
    };
    const alone = valeDraws();
    const env = fakeDom();
    const wild = createWorld(env.canvas, { motion: () => false, content: CONTENT, startTile: { x: 32, y: 0 } });
    try {
      wild.setRifts([testRift(['neon'], 'open', 40, -8)]);
      await wild.walkTo('camp');
      env.draws.length = 0;
      wild.renderMap(1);
      assert.equal(env.draws.map((d) => `${d.image.width}x${d.image.height}@${d.args.join(',')}`).join('|'), alone, 'renderMap stays the vale alone');
    } finally {
      wild.dispose();
      env.cleanup();
    }
  } finally {
    world.dispose();
    cleanup();
  }
});

// Milo holds still: over two seconds his tile and where he is drawn stay put, on ground he can stand on.
function holdsStill(world, clock, label) {
  const tile = world.miloTile();
  clock.advance(600); // the camera settles on him
  const pos = world.miloScreenPos();
  clock.advance(2000);
  assert.deepEqual(world.miloTile(), tile, `${label}: his tile holds`);
  const again = world.miloScreenPos();
  assert.ok(Math.abs(again.x - pos.x) < 0.01 && Math.abs(again.y - pos.y) < 0.01, `${label}: he stands still (${pos.x},${pos.y} → ${again.x},${again.y})`);
  assert.equal(world.isWalkable(tile.x, tile.y), true, `${label}: on ground he can stand on`);
}

test('wilds: a scene change is one at a time, and nothing begun while the view fades out survives it', async () => {
  const clock = manualClock();
  const { world, listeners, events, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
  const settles = (promise) => {
    const box = { value: 'pending' };
    promise.then((v) => { box.value = v; });
    return box;
  };
  // Clicks, keys and the shell's calls while the view goes dark: none of them starts anything.
  const meddle = async (label, extra = () => {}) => {
    assert.equal(world.stats().changing, true, `${label}: the view is fading out`);
    // The shell's walks settle at once: he didn't get there.
    const walk = settles(world.walkTo({ x: 28, y: 22 }));
    await flush();
    assert.equal(walk.value, false, `${label}: a walk asked for in the dark settles at once, not there`);
    const entity = settles(world.walkToEntity('stitch'));
    await flush();
    assert.equal(entity.value, false, `${label}: so does a walk to an entity`);
    // Clicks on the old scene and keys: whatever they'd start, holdsStill catches afterwards.
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300 });
    listeners.pointerdown({ button: 0, clientX: 700, clientY: 420 });
    listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
    listeners.keyup({ key: 'ArrowLeft' });
    listeners.keydown({ key: 'Enter', preventDefault() {} });
    listeners.pointermove({ clientX: 500, clientY: 300 });
    assert.equal(events.hovers.at(-1) ?? null, null, `${label}: nothing in a scene that is going is named`);
    extra();
    assert.deepEqual(await world.chop('tree:1,1'), { ok: false, kind: null }, `${label}: no chop`);
    assert.equal(await world.travelTo('home'), false, `${label}: another trip is refused`);
  };
  try {
    // A trip.
    const opened = events.entities.length;
    const trip = world.travelTo({ x: 40, y: -60 });
    clock.advance(100);
    await meddle('travel');
    assert.equal(await drive(clock, trip), true);
    const at = world.miloTile();
    assert.ok(Math.abs(at.x - 40) <= 3 && Math.abs(at.y + 60) <= 3, 'the trip got there');
    assert.deepEqual(events.moves.at(-1), at, 'and the last move the shell heard is where he is');
    holdsStill(world, clock, 'after the trip');
    assert.equal(events.entities.length, opened, 'nothing was opened on the way');

    // Stepping into an Elsewhere.
    assert.equal(await drive(clock, world.travelTo({ x: 30, y: -10 })), true);
    const rift = { ...testRift(['frontier'], 'open', 34, -12), kind: 'wild', key: null };
    const inside = world.enterElsewhere(rift);
    clock.advance(100);
    let out = null;
    await meddle('stepping in', () => { out = world.leaveElsewhere(); });
    assert.equal(await out, false, 'not in one yet');
    assert.equal(await drive(clock, inside), true);
    assert.equal(world.elsewhere().riftId, rift.id, 'in the Elsewhere');
    assert.equal(world.area().area, 'elsewhere');
    holdsStill(world, clock, 'inside');

    // And back out.
    const leaving = world.leaveElsewhere();
    clock.advance(100);
    const deeper = settles(world.enterElsewhere(rift));
    await meddle('stepping out');
    assert.equal(deeper.value, false, 'no second rift while stepping out');
    assert.equal(await drive(clock, leaving), true);
    assert.equal(world.elsewhere(), null);
    const back = world.miloTile();
    assert.equal(Math.abs(back.x - rift.x) + Math.abs(back.y - rift.y), 1, 'beside the rift');
    holdsStill(world, clock, 'back out');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: once Milo is placed he can walk as the view fades in, and a new trip darkens from there', async () => {
  const clock = manualClock();
  const { world, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
  try {
    const first = world.travelTo({ x: 32, y: -8 });
    clock.advance(400);
    await flush();
    assert.equal(world.stats().changing, false, 'placed in the dark');
    clock.advance(160);
    const mid = world.stats().fade;
    assert.ok(mid > 0.2 && mid < 0.9, `fading back in (${mid})`);
    // A walk now is a walk in the new place.
    const here = world.miloTile();
    const step = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => ({ x: here.x + dx, y: here.y + dy })).find((t) => world.isWalkable(t.x, t.y));
    assert.ok(step, 'somewhere to step');
    assert.equal(await drive(clock, world.walkTo(step)), true);
    assert.deepEqual(world.miloTile(), step);
    assert.equal(await drive(clock, first), true);
    // A trip begun while the view fades back in picks the fade up where it was.
    const second = world.travelTo('home');
    clock.advance(400);
    await flush();
    clock.advance(200);
    const level = world.stats().fade;
    assert.ok(level > 0.1 && level < 0.9, `fading back in (${level})`);
    const third = world.travelTo({ x: 60, y: -20 });
    assert.ok(Math.abs(world.stats().fade - level) < 0.05, `no jump to a clear view (${level} → ${world.stats().fade})`);
    assert.equal(await drive(clock, second), true, 'the trip it cut short still got there');
    assert.equal(await drive(clock, third), true);
    const at = world.miloTile();
    assert.ok(Math.abs(at.x - 60) <= 3 && Math.abs(at.y + 20) <= 3);
    assert.equal(world.stats().fade, 0);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: a walk says whether Milo got there: false with no way, true when he stands there already', async () => {
  const { world, events, cleanup } = wildWorld({ startTile: MAP.miloHome });
  try {
    await flush();
    events.moves.length = 0;
    assert.equal(await world.walkTo({ x: 5000, y: 5000 }), false, 'nowhere he can reach');
    assert.deepEqual(world.miloTile(), MAP.miloHome, 'and he stays put');
    assert.equal(events.moves.length, 0);
    assert.equal(await world.walkTo(MAP.miloHome), true, 'already there');
    // A tree can't be stood on: a walk to it ends beside it, so from beside it he is there.
    await world.travelTo({ x: 26, y: -6 });
    const tree = world.nearbyEntities().find((e) => e.kind === 'tree');
    assert.equal(await world.walkTo(tree.approach), true);
    const by = world.miloTile();
    assert.equal(await world.walkTo({ x: tree.x, y: tree.y }), true, 'beside the tree is as close as it gets');
    assert.deepEqual(world.miloTile(), by);
    // Inside an Elsewhere, off the scene's floor altogether.
    await world.travelTo({ x: 30, y: -10 });
    assert.equal(await world.enterElsewhere({ ...testRift(['frontier'], 'open', 34, -12), kind: 'wild', key: null }), true);
    const spawn = world.miloTile();
    assert.equal(await world.walkTo({ x: -40, y: -40 }), false);
    assert.deepEqual(world.miloTile(), spawn);
    await world.leaveElsewhere();
  } finally {
    world.dispose();
    cleanup();
  }
  // The vale alone settles as it always has.
  const env = fakeDom();
  const vale = createWorld(env.canvas, { motion: () => false, startTile: MAP.miloHome });
  try {
    assert.equal(await vale.walkTo({ x: 5000, y: 5000 }), undefined);
    assert.equal(await vale.walkTo(MAP.miloHome), undefined);
  } finally {
    vale.dispose();
    env.cleanup();
  }
});

test('wilds: the vale’s own picture has Milo in it only while he is in the vale', async () => {
  const { world, draws, cleanup } = wildWorld({ startTile: MAP.miloHome });
  // Milo's sprite (16 × 20) where he stands, or his shadow under it.
  const miloIn = () => {
    const t = world.miloTile();
    const x = t.x * TILE;
    const y = t.y * TILE + 13 - 19;
    draws.length = 0;
    world.renderMap(1);
    return draws.some((d) => (d.image.width === 16 && d.image.height === 20 && d.args[0] === x && d.args[1] === y)
      || (d.image.width === 10 && d.image.height === 3 && d.args[0] === x + 3 && d.args[1] === y + 18));
  };
  try {
    assert.equal(miloIn(), true, 'at home he is in it');
    await world.travelTo({ x: 30, y: -10 });
    assert.equal(await world.enterElsewhere({ ...testRift(['frontier'], 'open', 34, -12), kind: 'wild', key: null }), true);
    const spawn = world.miloTile();
    assert.ok(spawn.x >= 0 && spawn.y >= 0 && spawn.x < MAP.width && spawn.y < MAP.height, 'the scene’s tile lies over the vale’s');
    assert.equal(miloIn(), false, 'inside an Elsewhere he is not in the vale’s picture');
    await world.leaveElsewhere();
    assert.equal(miloIn(), false, 'nor out in the wilds');
    await world.travelTo('home');
    assert.equal(miloIn(), true, 'and home again he is');
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: a very wide, short window settles its idle work, and a frame repaints nothing', async () => {
  const cases = [
    { dom: { width: 3840, height: 600 } }, // the ring one chunk out holds more than the cap
    { dom: { width: 2600, height: 400 } },
    { dom: { width: 3840, height: 1100 }, scale: 1 }, // more chunks in view than the cap
  ];
  for (const { dom, scale } of cases) {
    const { world, cleanup } = wildWorld({ dom, ...(scale ? { scale } : {}) });
    const label = `${dom.width}×${dom.height}${scale ? ` at ${scale}x` : ''}`;
    try {
      assert.equal(await world.travelTo({ x: 40, y: -70 }), true);
      const ran = world.settle(1500);
      assert.ok(ran < 1500, `${label}: settled (${ran} tasks)`);
      assert.equal(world.stats().pending, false, `${label}: nothing left`);
      // Frames draw what is ready: nothing is painted, thrown out and wanted again.
      world.resize();
      await settleFrames();
      world.resize();
      await settleFrames();
      assert.equal(world.settle(), 0, `${label}: still nothing to do after frames`);
      assert.equal(world.stats().pending, false);
      if (!scale) assert.ok(world.stats().canvases <= 25, `${label}: ${world.stats().canvases} canvases`);
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

// ---------- polish: outfits, and the shell's calls for its maps and lists ----------

// Milo as the last still frame drew him: the 16 × 20 image at his feet, its pixels, and which of
// his four standing grids it is, dressed in which genre (null: his own colours). outfitPixels is
// the one right way to dress him, so the drawn picture must be exactly one of its answers.
function miloAsDrawn(world, draws) {
  const tile = world.miloTile();
  const x = tile.x * TILE;
  const y = tile.y * TILE + 13 - 19;
  const drawn = draws.filter((d) => d.image.width === 16 && d.image.height === 20 && d.args[0] === x && d.args[1] === y).at(-1);
  assert.ok(drawn && drawn.image.pixels, 'Milo was drawn where he stands');
  const pixels = [...drawn.image.pixels];
  for (const dir of ['down', 'up', 'left', 'right']) {
    const name = `milo.${dir}`;
    const rows = SPRITES[name][0];
    for (const genre of [null, ...CONTENT.genres.genres.map((g) => g.id)]) {
      const want = outfitPixels(name, rows, genre, { genres: CONTENT.genres }).data;
      if (want.length === pixels.length && want.every((v, i) => v === pixels[i])) return { dir, rows, genre, pixels };
    }
  }
  return { dir: null, rows: null, genre: undefined, pixels };
}

// His skin, eyes, hair and outline in his own colours; his coat and scarf in the genre's (the coat's
// honey keys u, U, Y in the genre's coat tones, COAT_TONES, so it changes even in a honey genre).
function assertOutfit(seen, genre, label) {
  assert.ok(seen.dir, `${label}: Milo is drawn as himself, only his clothes dressed (not the whole genre)`);
  assert.equal(seen.genre, genre, `${label}: dressed in ${genre}`);
  const base = spriteTable(null);
  const dressed = spriteTable(genre, { genres: CONTENT.genres });
  const at = (x, y) => seen.pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4);
  let coat = 0;
  seen.rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (key === 't' || key === 'o' || key === 'm') assert.deepEqual(at(x, y), base[key], `${label}: '${key}' at ${x},${y} keeps its own colour`);
    if (key === 'U' || key === 'r') {
      assert.deepEqual(at(x, y), dressed[COAT_TONES[key] || key], `${label}: '${key}' at ${x},${y} wears the genre`);
      if (key === 'U') assert.notDeepEqual(at(x, y), base.U, `${label}: the coat at ${x},${y} isn't his own honey`);
      coat += 1;
    }
  }));
  assert.ok(coat > 10, `${label}: coat and scarf seen (${coat})`);
}

test('outfits: in a Neon or Gothic Elsewhere and in a wild bleed Milo keeps his face and hair, and wears the genre on his coat', async () => {
  const { world, draws, cleanup } = wildWorld({ startTile: MAP.miloHome });
  const still = async () => {
    draws.length = 0;
    world.resize();
    await settleFrames();
  };
  try {
    await still();
    assert.equal(miloAsDrawn(world, draws).genre, null, 'at home he wears his own colours');
    // Inside a Neon Elsewhere.
    await world.travelTo({ x: 30, y: -10 });
    const neon = { ...testRift(['neon'], 'open', 34, -12), kind: 'wild', key: null };
    assert.equal(await world.enterElsewhere(neon), true);
    await still();
    assertOutfit(miloAsDrawn(world, draws), 'neon', 'in the Neon Elsewhere');
    await world.leaveElsewhere();
    // Inside a Gothic one.
    const gothic = { ...testRift(['gothic'], 'open', 34, -12, { salt: 2 }), kind: 'wild', key: null };
    assert.equal(await world.enterElsewhere(gothic), true);
    await still();
    assertOutfit(miloAsDrawn(world, draws), 'gothic', 'in the Gothic Elsewhere');
    await world.leaveElsewhere();
    // Standing in a Neon rift's bleed out in the wilds, right beside the tear.
    await world.travelTo({ x: 30, y: -10 });
    const here = world.miloTile();
    const rift = testRift(['neon'], 'open', here.x + 1, here.y, { salt: 3 });
    assert.equal(bleedAt([rift], here.x * TILE + 8, here.y * TILE + 12, { genres: CONTENT.genres }), 'neon', 'he stands in its bleed');
    world.setRifts([rift]);
    world.settle();
    await still();
    assertOutfit(miloAsDrawn(world, draws), 'neon', 'in a wild bleed');
    // Back home, out of every bleed, he is all his own colours again.
    world.setRifts([]);
    await world.travelTo('home');
    await still();
    assert.equal(miloAsDrawn(world, draws).genre, null, 'home in his own colours');
  } finally {
    world.dispose();
    cleanup();
  }
});

// ---------- dressing sprites in a bleed: whole, and never strobing ----------

// Every look Milo is drawn in out in the world (his four ways, every stride and breath), in his own
// colours or dressed in each genre: its pixels → that genre (null: his own).
let miloLookCache = null;
function miloLooks() {
  if (miloLookCache) return miloLookCache;
  miloLookCache = new Map();
  const names = Object.keys(SPRITES).filter((name) => /^milo\.(breath\.)?(down|up|left|right)$/.test(name));
  for (const name of names) {
    for (const rows of SPRITES[name]) {
      for (const genre of [null, ...CONTENT.genres.genres.map((g) => g.id)]) {
        const key = Buffer.from(outfitPixels(name, rows, genre, { genres: CONTENT.genres }).data).toString('base64');
        if (!miloLookCache.has(key)) miloLookCache.set(key, genre);
      }
    }
  }
  return miloLookCache;
}
// The genre Milo was last drawn in among these draws (null: his own colours), or undefined.
function miloDrawnIn(draws) {
  let genre;
  for (const d of draws) {
    if (d.image.width !== 16 || d.image.height !== 20 || !d.image.pixels) continue;
    const key = Buffer.from(d.image.pixels).toString('base64');
    if (miloLooks().has(key)) genre = miloLooks().get(key);
  }
  return genre;
}
// What he wore, frame by frame, as runs: 'null×40 neon×61 null×38'.
function runsOf(seen) {
  const out = [];
  for (const g of seen) {
    if (out.length && out[out.length - 1][0] === g) out[out.length - 1][1] += 1;
    else out.push([g, 1]);
  }
  return out.map(([g, n]) => `${g}×${n}`).join(' ');
}

// Open ways 24 tiles long, straight past a rift set `off` tiles south of their middle. The second
// fusion's lobes lie east and west of its tear, so that way runs through both of its stories.
const CROSSINGS = [
  { genres: ['neon'], stage: 'open', row: -42, from: 35, to: 59, off: 2, most: 2 },
  { genres: ['gothic'], stage: 'gaping', row: -59, from: 55, to: 79, off: 2, most: 2 },
  { genres: ['iron', 'neon'], stage: 'gaping', row: -30, from: 22, to: 46, off: 2, most: 4 },
  { genres: ['iron', 'neon'], stage: 'gaping', row: -30, from: 22, to: 46, off: 1, salt: 3, most: 4 },
];
const crossingRift = (c) => testRift(c.genres, c.stage, (c.from + c.to) / 2, c.row + c.off, { salt: c.salt || 0 });

test('wilds: walking through a bleed, Milo’s coat changes as he crosses its edge, and never strobes', async () => {
  for (const c of CROSSINGS) {
    const label = `${c.genres.join('+')} ${c.stage}`;
    const clock = manualClock();
    const { world, draws, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
    try {
      world.setWildState({ wardRadius: 400 }); // none of the day's wild rifts anywhere near
      const start = { x: c.from, y: c.row };
      const end = { x: c.to, y: c.row };
      for (let x = c.from; x <= c.to; x += 1) assert.ok(world.isWalkable(x, c.row), `${label}: the way is open at ${x}`);
      assert.equal(await drive(clock, world.travelTo(start)), true);
      world.setRifts([crossingRift(c)]);
      for (const [from, to] of [[start, end], [end, start]]) {
        assert.deepEqual(world.miloTile(), from);
        const seen = [];
        let done = false;
        world.walkTo(to).then(() => { done = true; });
        for (let t = 0; t < 30000 && !done; t += 16) {
          draws.length = 0;
          clock.advance(16);
          const genre = miloDrawnIn(draws);
          if (genre !== undefined) seen.push(genre);
          await flush();
        }
        assert.ok(done, `${label}: he walked it`);
        assert.deepEqual(world.miloTile(), to);
        const way = `${label}, ${from.x} to ${to.x}: ${runsOf(seen)}`;
        assert.ok(seen.length > 100, way);
        assert.equal(seen[0], null, `${way}: his own colours outside it`);
        assert.equal(seen[seen.length - 1], null, `${way}: and out the other side`);
        assert.ok(seen.some((g) => c.genres.includes(g)), `${way}: its genre on him inside it`);
        assert.ok(seen.every((g) => g === null || c.genres.includes(g)), way);
        const changes = seen.filter((g, i) => i > 0 && g !== seen[i - 1]).length;
        assert.ok(changes <= c.most, `${way}: ${changes} coat changes, at most ${c.most}`);
      }
    } finally {
      world.dispose();
      cleanup();
    }
  }
});

test('wilds: what stands where a bleed holds the ground wears its genre, and nothing in daylight colours stands inside one', async () => {
  // A view wide enough for a gaping fusion's whole bleed (33 × 21 tiles).
  const { world, draws, cleanup } = wildWorld({ dom: { width: 1600, height: 1040 } });
  const state = { felled: {}, lit: new Set(), opened: new Set(), day: 20000 };
  let inside = 0;
  let fringe = 0;
  let wide = 0;
  let outside = 0;
  // Each crossing's rift, and one set right beside a ruin (a sprite two tiles wide, at 37..38, -14).
  const spots = [
    ...CROSSINGS.map((c) => ({ label: `${c.genres.join('+')} ${c.stage}`, genres: c.genres, rift: crossingRift(c), at: { x: (c.from + c.to) / 2, y: c.row } })),
    { label: 'gothic open by a ruin', genres: ['gothic'], rift: testRift(['gothic'], 'open', 38, -12), at: { x: 34, y: -12 } },
  ];
  try {
    world.setWildState({ wardRadius: 400 });
    for (const c of spots) {
      const { label, rift } = c;
      assert.equal(await world.travelTo(c.at), true);
      world.setRifts([rift]);
      world.settle();
      draws.length = 0;
      world.resize();
      await settleFrames();
      for (let cy = Math.floor((rift.y - 8) / 32); cy <= Math.floor((rift.y + 7) / 32); cy += 1) for (let cx = Math.floor((rift.x - 12) / 32); cx <= Math.floor((rift.x + 12) / 32); cx += 1) WILDS.chunk(cx, cy);
      const objects = WILDS.objectsIn(rift.x - 12, rift.y - 8, rift.x + 12, rift.y + 7, state);
      objectBoxes(objects).forEach((box, i) => {
        const o = objects[i];
        // How much of the ground under its feet the bleed recolours (a wide sprite: its whole foot row).
        const w = o.w || 1;
        const fy = o.y + (o.h || 1) - 1;
        let cover = 0;
        for (let dx = 0; dx < w; dx += 1) cover += bleedCover(rift, o.x + dx, fy, { genres: CONTENT.genres }) / w;
        const drawn = draws.filter((d) => d.args[0] === box.sx && d.args[1] === box.sy && d.image.width === box.sw && d.image.height === box.sh);
        assert.ok(drawn.length, `${label}: ${o.id} (${box.sprite}) is drawn`);
        const tags = drawn.map((d) => d.image._milo || 'daylight');
        const where = `${label}: ${o.id} (${box.sprite}) stands on ground ${Math.round(cover * 100)}% bled, drawn ${tags}`;
        if (cover >= 0.75) {
          inside += 1;
          if (cover < 1) fringe += 1;
          if (w > 1) wide += 1;
          assert.ok(tags.every((tag) => c.genres.some((g) => tag === `dress:${g}`)), where);
        } else if (cover <= 0.25) {
          outside += 1;
          assert.ok(tags.every((tag) => !tag.startsWith('dress:')), where);
        }
      });
    }
    assert.ok(inside >= 12 && fringe >= 6 && wide >= 1 && outside >= 40, `enough sprites looked at: ${inside} inside (${fringe} on its fringe, ${wide} wide), ${outside} outside`);
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: the harbour fog thins away before the east wall, and never lies over it', async () => {
  const clock = manualClock();
  const { world, draws, cleanup } = wildWorld({ dom: { clock }, motion: () => true, startTile: { x: 62, y: 33 } });
  const harbor = placeById('harbor');
  // The bank with the wilds: the vale's own reaches 3 tiles further east and 2 further south.
  const bank = { x: (harbor.area.x - 3) * TILE, y: (harbor.area.y - 3) * TILE, w: (harbor.area.w + 9) * TILE, h: (harbor.area.h + 8) * TILE };
  const puff = SPRITES.fog[0];
  const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  try {
    for (const tier of [1, 2]) {
      world.setWildState({ tier });
      clock.advance(100);
      const walls = objectBoxes(WILDS.ringObjects(tier)).map((b) => ({ x: b.sx, y: b.sy, w: b.sw, h: b.sh, sprite: b.sprite })).filter((b) => meets(b, bank));
      assert.ok(walls.length >= 6, `tier ${tier}: the wall runs down to the water inside the bank (${walls.length})`);
      let puffs = 0;
      let layers = 0;
      // The puffs drift right across the bank and round again in under seven minutes.
      for (let step = 0; step < 220; step += 1) {
        clock.t += 1900;
        draws.length = 0;
        clock.advance(16);
        for (const d of draws) {
          if (d.image.width === puff[0].length && d.image.height === puff.length && d.alpha > 0) {
            puffs += 1;
            const at = { x: d.args[0], y: d.args[1], w: d.image.width, h: d.image.height };
            for (const wall of walls) assert.ok(!meets(at, wall), `tier ${tier}: a puff at ${at.x},${at.y} lies over the wall's ${wall.sprite} at ${wall.x},${wall.y}`);
          }
          if (d.image.width === bank.w && d.image.height === bank.h && d.args[0] === bank.x && d.args[1] === bank.y) {
            layers += 1;
            if (layers > 1) continue;
            for (const wall of walls) {
              for (let y = Math.max(wall.y, bank.y); y < Math.min(wall.y + wall.h, bank.y + bank.h); y += 1) {
                for (let x = Math.max(wall.x, bank.x); x < Math.min(wall.x + wall.w, bank.x + bank.w); x += 1) {
                  assert.equal(d.image.pixels[((y - bank.y) * bank.w + (x - bank.x)) * 4 + 3], 0, `tier ${tier}: mist at ${x},${y} over the wall`);
                }
              }
            }
          }
        }
      }
      assert.ok(puffs > 400 && layers > 0, `tier ${tier}: the fog was drawn (${puffs} puffs, ${layers} banks)`);
    }
  } finally {
    world.dispose();
    cleanup();
  }
});

test('wilds: chopping from the side, Milo leans in only a little, and his axe head lands in front of the tree', async () => {
  const clock = manualClock();
  const { world, draws, cleanup } = wildWorld({ dom: { clock }, motion: () => true });
  const state = { felled: {}, lit: new Set(), opened: new Set(), day: 20000 };
  const blank = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  try {
    assert.equal(await drive(clock, world.travelTo({ x: 26, y: -6 })), true);
    // A tree with Milo east of it (he faces left) and one with him west of it (he faces right).
    const trees = world.nearbyEntities().filter((e) => e.kind === 'tree');
    const cases = [];
    for (const side of [1, -1]) {
      const tree = trees.find((e) => world.isWalkable(e.x + side, e.y) && !cases.some((c) => c.tree.id === e.id));
      assert.ok(tree, `a tree with room ${side > 0 ? 'east' : 'west'} of it`);
      cases.push({ tree, stand: { x: tree.x + side, y: tree.y }, dir: side > 0 ? 'left' : 'right' });
    }
    for (const { tree, stand, dir } of cases) {
      assert.equal(await drive(clock, world.walkTo(stand)), true);
      world.chop(tree.id);
      await flush();
      // On to a blow landing, well into the chop (the strike frame: 400 to 625 ms into a swing).
      let age = 0;
      for (let n = 0; n < 200; n += 1) {
        draws.length = 0;
        clock.advance(16);
        age = world.stats().chopAge;
        if (draws.length && age > 700 && age % 625 >= 420 && age % 625 < 520) break; // a frame drawn then
      }
      assert.ok(age > 700 && age % 625 >= 420 && age % 625 < 520, `${dir}: a blow lands (${age} ms in)`);
      const rows = SPRITES[`milo.chop.${dir}`][1];
      const want = rowsToImageData(rows, blank).data;
      const miloAt = draws.findIndex((d) => d.image.width === rows[0].length && d.image.height === rows.length && same(d.image.pixels, want));
      assert.ok(miloAt >= 0, `${dir}: Milo is drawn striking`);
      const milo = { x: draws[miloAt].args[0], y: draws[miloAt].args[1] };
      // The tree as the world places it (a blow can shake it by a pixel), drawn before him.
      WILDS.chunk(Math.floor(tree.x / 32), Math.floor(tree.y / 32));
      const object = WILDS.objectsIn(tree.x, tree.y, tree.x, tree.y, state).find((o) => o.id === tree.id);
      const box = objectBoxes([object])[0];
      const treeAt = draws.findIndex((d) => d.image.width === box.sw && d.image.height === box.sh && d.args[1] === box.sy && Math.abs(d.args[0] - box.sx) <= 1);
      assert.ok(treeAt >= 0 && treeAt < miloAt, `${dir}: the tree is drawn, and before him`);
      const treeX = draws[treeAt].args[0];
      // He leans in to its trunk by about 2 px, no more (measured from where the trunk stands, a few
      // px off its tile's middle): his middle a tile less that from it. Beside the tree, not on it.
      const trunk = box.sx + box.sw / 2;
      const lean = TILE - Math.abs(trunk - (milo.x + 8));
      assert.ok(lean >= 1 && lean <= 3, `${dir}: leans ${lean} px in to the trunk`);
      const treeRows = SPRITES[box.sprite][0];
      const treeInk = (x, y) => { const row = treeRows[y - box.sy]; return !!row && row[x - treeX] !== undefined && row[x - treeX] !== '.'; };
      // The axe head: its steel and bright edge in the four columns on the tree's side of him.
      const cols = dir === 'left' ? [0, 1, 2, 3] : [rows[0].length - 4, rows[0].length - 3, rows[0].length - 2, rows[0].length - 1];
      const head = [];
      rows.forEach((row, y) => cols.forEach((x) => { if ('Scz'.includes(row[x])) head.push({ x: milo.x + x, y: milo.y + y }); }));
      assert.ok(head.length >= 6, `${dir}: an axe head to see (${head.length} px)`);
      assert.ok(head.some((p) => treeInk(p.x, p.y)), `${dir}: the axe head lands over the tree`);
      // Nothing drawn after him covers it.
      for (const d of draws.slice(miloAt + 1)) {
        const [x, y] = d.args;
        for (const p of head) assert.ok(!(p.x >= x && p.y >= y && p.x < x + d.image.width && p.y < y + d.image.height), `${dir}: the axe head at ${p.x},${p.y} is left in sight`);
      }
      // And he hides no more than a third of the tree: a chop, not a hug.
      let ink = 0;
      let hidden = 0;
      treeRows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === '.') return;
        ink += 1;
        const mx = treeX + x - milo.x;
        const my = box.sy + y - milo.y;
        if (rows[my] && rows[my][mx] !== undefined && rows[my][mx] !== '.') hidden += 1;
      }));
      assert.ok(hidden / ink <= 1 / 3, `${dir}: he hides ${Math.round((hidden / ink) * 100)}% of the ${box.sprite}`);
      clock.advance(2000);
      await flush();
      assert.equal(world.stats().chopAge, null, `${dir}: the chop is done`);
    }
  } finally {
    world.dispose();
    cleanup();
  }
});

test('the shell’s calls: worldgen, terrainAt, renderMap without Milo, and everything in an Elsewhere', async () => {
  const { world, draws, cleanup } = wildWorld({ startTile: MAP.miloHome });
  try {
    // The world's own generator: the same world the seed makes anywhere.
    const gen = world.worldgen;
    assert.ok(gen && typeof gen.terrainAt === 'function');
    assert.equal(world.worldgen, gen, 'one generator');
    for (const [x, y] of [[200, -300], [-90, 40], [5, -80]]) assert.equal(gen.terrainAt(x, y), WORLDGEN.terrainAt(x, y), `${x},${y}`);
    // terrainAt: the vale's own map inside, the wilds' (roads kept off the ring) beyond.
    for (let y = 0; y < MAP.height; y += 3) for (let x = 0; x < MAP.width; x += 3) assert.equal(world.terrainAt(x, y), terrainAt(x, y), `vale ${x},${y}`);
    assert.ok(['~', '='].every((ch) => MAP.tiles.some((row, y) => [...row].some((c, x) => c === ch && world.terrainAt(x, y) === ch))), 'water and paths in the vale');
    for (let x = -3; x <= MAP.width + 2; x += 1) for (const y of [-2, -1, MAP.height, MAP.height + 1]) assert.equal(world.terrainAt(x, y), WILDS.terrainAt(x, y), `ring ${x},${y}`);
    for (const [x, y] of [[40, -60], [-70, 10], [300, 200]]) assert.equal(world.terrainAt(x, y), WILDS.terrainAt(x, y));
    assert.equal(world.terrainAt(1.5, 2), null, 'whole tiles only');
    assert.equal(world.terrainAt('a', 2), null);
    // renderMap: Milo is in the vale's picture unless asked to leave him out.
    const miloIn = (options) => {
      const t = world.miloTile();
      draws.length = 0;
      world.renderMap(1, options);
      return draws.some((d) => (d.image.width === 16 && d.image.height === 20 && d.args[0] === t.x * TILE && d.args[1] === t.y * TILE - 6)
        || (d.image.width === 10 && d.image.height === 3 && d.args[0] === t.x * TILE + 3 && d.args[1] === t.y * TILE + 12));
    };
    assert.equal(miloIn(), true);
    assert.equal(miloIn({ time: null }), true);
    assert.equal(miloIn({ milo: false }), false, 'milo: false leaves him out');
    assert.equal(miloIn({ milo: true }), true);
    draws.length = 0;
    world.renderMap(2, { milo: false });
    assert.ok(draws.length > 50, 'the rest of the vale is still drawn');
    // elsewhereEntities: nothing outside one.
    assert.deepEqual(world.elsewhereEntities(), []);
    await world.travelTo({ x: 30, y: -10 });
    assert.deepEqual(world.elsewhereEntities(), [], 'nor out in the wilds');
    const rift = { ...testRift(['gothic'], 'gaping', 34, -12, { salt: 7 }), kind: 'wild', key: null };
    assert.equal(await world.enterElsewhere(rift), true);
    const all = world.elsewhereEntities();
    // Everything the scene holds that can be clicked, in view or not.
    const scene = buildElsewhere(rift.spec, RIFTGEN.layout(rift.spec), { genres: CONTENT.genres, kind: 'wild', words: CONTENT.riftgen });
    const want = [...scene.objects.filter((o) => !o.scenery).map((o) => o.id), ...scene.strays.map((s) => s.id)].sort();
    assert.deepEqual(all.map((e) => e.id).sort(), want);
    for (const kind of ['exit', 'stitch', 'tale-lead']) assert.ok(all.some((e) => e.kind === kind), `${kind} is listed`);
    assert.ok(all.some((e) => e.kind === 'stray'), 'and its strays');
    // The same shape as nearbyEntities, which lists only what's in view.
    const near = world.nearbyEntities();
    assert.ok(near.length < all.length, `more than the view holds (${near.length} of ${all.length})`);
    for (const e of near) assert.deepEqual(all.find((a) => a.id === e.id), e, `${e.id} as nearbyEntities gives it`);
    for (const e of all) {
      assert.ok(typeof e.kind === 'string' && typeof e.id === 'string' && typeof e.label === 'string' && e.label.length > 0, e.id);
      assert.ok(Number.isInteger(e.x) && Number.isInteger(e.y) && e.riftId === rift.id && e.approach, e.id);
    }
    const d = (e) => Math.hypot(e.x - world.miloTile().x, e.y - world.miloTile().y);
    for (let i = 1; i < all.length; i += 1) assert.ok(d(all[i - 1]) <= d(all[i]), 'nearest first');
    assert.deepEqual(world.elsewhereEntities().map((e) => e.id), all.map((e) => e.id), 'steady with motion off');
    // Once the seam is stitched it's gone from the list.
    world.closeRift(rift.id, 'stitched');
    assert.equal(world.elsewhereEntities().some((e) => e.kind === 'stitch'), false);
    await world.leaveElsewhere();
    assert.deepEqual(world.elsewhereEntities(), []);
  } finally {
    world.dispose();
    cleanup();
  }
  // The vale alone: no generator, no terrain, no Elsewhere; renderMap takes the option all the same.
  const env = fakeDom();
  const vale = createWorld(env.canvas, { motion: () => false, startTile: MAP.miloHome });
  try {
    assert.equal(vale.worldgen, null);
    assert.equal(vale.terrainAt(31, 22), null);
    assert.equal(vale.terrainAt(40, -60), null);
    assert.deepEqual(vale.elsewhereEntities(), []);
    const count = (options) => {
      env.draws.length = 0;
      vale.renderMap(1, options);
      return env.draws.filter((d) => d.image.width === 16 && d.image.height === 20 && d.args[0] === MAP.miloHome.x * TILE && d.args[1] === MAP.miloHome.y * TILE - 6).length;
    };
    assert.equal(count(), 1);
    assert.equal(count({ milo: false }), 0);
  } finally {
    vale.dispose();
    env.cleanup();
  }
});
