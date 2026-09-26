import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, MAP, PLACES, TERRAIN, isWalkable, findPath, placeAt, placeById, terrainAt } from '../src/world/map.js';
import { SPRITES, PALETTE, MILO, CREW_ART, ICONS, mirror, sym, stamp, breathe, shiftRows } from '../src/world/sprites.js';
import { createWorld, objectBoxes, paintGround } from '../src/world/engine.js';

const PLACE_IDS = ['camp', 'watchtower', 'workshop', 'clip-studio', 'library', 'game-table', 'building-site', 'harbor'];
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
    assert.ok(inArea(place, place.door.x, place.door.y), `${place.id} door sits inside its area`);
    assert.equal(placeAt(place.door.x, place.door.y), place.id);
    assert.equal(placeById(place.id), place);
  }
  assert.equal(placeById('camp').built, true);
  assert.equal(placeById('watchtower').built, true);
  assert.equal(placeById('harbor').fogged, true);
  for (const id of ['workshop', 'clip-studio', 'library', 'game-table', 'building-site', 'harbor']) assert.equal(placeById(id).built, false, id);
  assert.equal(placeById('nowhere'), null);
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
  const to = placeById('library').door;
  const path = findPath(from, to);
  const manhattan = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  assert.ok(path.length <= manhattan + 6, `library walk is ${path.length} for distance ${manhattan}`);
});

test('crew slots and fixed perches are sensible', () => {
  const { slots } = MAP;
  assert.equal(slots.work.length, 4);
  assert.equal(slots.campfire.length, 5);
  assert.equal(slots.waiting.length, 4);
  const workshop = placeById('workshop');
  for (const slot of slots.work) assert.ok(inArea(workshop, slot.x, slot.y), 'work slots are in the Workshop row');
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
  for (const kind of ['cabin', 'tent', 'campfire', 'flag', 'tower', 'scaffold', 'boat', 'tree', 'pine', 'fence']) assert.ok(kinds.has(kind), kind);
  for (const id of ['library', 'workshop', 'clip-studio', 'game-table', 'building-site', 'harbor']) assert.ok(kinds.has(`sign.${id}`), `signpost for ${id}`);
});

// ---------- sprites ----------

test('palette is soft: named colours, no pure black', () => {
  const keys = Object.keys(PALETTE);
  assert.ok(keys.length >= 20 && keys.length <= 34, `palette has ${keys.length} colours`);
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

function fakeDom({ width = 1000, height = 700 } = {}) {
  const listeners = {};
  const makeContext = () => new Proxy({}, {
    get(target, prop) {
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
    performance,
    requestAnimationFrame(cb) {
      const id = setTimeout(() => {
        timers.delete(id);
        cb(performance.now());
      }, 16);
      timers.add(id);
      return id;
    },
    cancelAnimationFrame(id) {
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
  return { canvas, listeners, cleanup: () => timers.forEach((id) => clearTimeout(id)) };
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
