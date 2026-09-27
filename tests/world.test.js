import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, MAP, PLACES, PLOT_IDS, LEGACY_PLACE_IDS, TERRAIN, isWalkable, findPath, placeAt, placeById, plotById, buildableArea, plotGate, terrainAt } from '../src/world/map.js';
import { SPRITES, PALETTE, MILO, CREW_ART, ICONS, mirror, sym, stamp, breathe, shiftRows } from '../src/world/sprites.js';
import { createWorld, crewRoute, makeWay, objectBoxes, paintGround, plotLook, plotOptions } from '../src/world/engine.js';

const PLOTS = { 'plot-meadow': 'Long meadow', 'plot-rise': 'Sunny rise', 'plot-birch': 'Birch hollow', 'plot-pond': 'Pondside plot', 'plot-orchard': 'Old orchard' };
const PLACE_IDS = ['camp', 'watchtower', ...Object.keys(PLOTS), 'harbor'];
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
    assert.ok(['camp', 'watchtower', 'plot', 'fog'].includes(place.kind), `${place.id} has a kind`);
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

// A frame clock the test drives: advance(ms, each) runs the animation frames due in that time.
function manualClock() {
  const clock = { t: 1000, frames: new Map(), next: 1 };
  clock.performance = { now: () => clock.t };
  clock.requestAnimationFrame = (cb) => {
    const id = clock.next;
    clock.next += 1;
    clock.frames.set(id, cb);
    return id;
  };
  clock.cancelAnimationFrame = (id) => clock.frames.delete(id);
  clock.advance = (ms, each = () => {}) => {
    for (let left = ms; left > 0; left -= 16) {
      clock.t += 16;
      const due = [...clock.frames.values()];
      clock.frames.clear();
      for (const cb of due) cb(clock.t);
      if (each(clock.t) === false) return;
    }
  };
  return clock;
}

function fakeDom({ width = 1000, height = 700, clock = null } = {}) {
  const listeners = {};
  const draws = [];
  const makeContext = () => new Proxy({}, {
    get(target, prop) {
      if (prop === 'drawImage') return (image, ...args) => draws.push({ image, args });
      if (prop === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const timers = new Set();
  const win = {
    devicePixelRatio: 1,
    performance: clock ? clock.performance : performance,
    requestAnimationFrame(cb) {
      if (clock) return clock.requestAnimationFrame(cb);
      const id = setTimeout(() => {
        timers.delete(id);
        cb(performance.now());
      }, 16);
      timers.add(id);
      return id;
    },
    cancelAnimationFrame(id) {
      if (clock) return clock.cancelAnimationFrame(id);
      clearTimeout(id);
      timers.delete(id);
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = {
    hidden: false,
    defaultView: win,
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      const context = makeContext();
      return { width: 1, height: 1, getContext: () => context };
    },
  };
  const context = makeContext();
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    ownerDocument: doc,
    clientWidth: width,
    clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    hasAttribute: () => false,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener(type) {
      delete listeners[type];
    },
  };
  return { canvas, listeners, draws, cleanup: () => timers.forEach((id) => clearTimeout(id)) };
}

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
