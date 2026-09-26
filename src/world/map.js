// MILO world map: terrain rows, places, props and pathfinding. Pure data and
// functions, safe to import in Node (no DOM).
//
// Layout (tiles, x right, y down; the map is 64 x 44):
//   north-west  Building site (10-18, 3-9)       north  Watchtower (28-35, 3-10)
//   north-east  Clip studio (45-53, 3-9)
//   west        Library (7-15, 15-23)            centre Milo's camp (24-39, 13-24)
//   east        Workshop row (41-55, 15-20)
//   south-west  Game table (9-17, 27-33)         pond (18-24, 23-28)
//   south-east  Harbor under fog, by the sea (44-59, 31-43)
// One-tile sandy roads join everything: an upper road (y 12), the camp's east and
// west roads (y 21), a south road (x 31) and a lower road (y 30).

import { SPRITES } from './sprites.js';

export const TILE = 16;

const W = 64;
const H = 44;

export const TERRAIN = {
  GRASS: '.',
  PATH: '=',
  WATER: '~',
  SAND: ',',
  SOIL: ':',
  DOCK: '#',
};
const WALKABLE_TERRAIN = new Set(['.', '=', ',', ':', '#']);

// ---------- deterministic noise ----------

export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

// ---------- places ----------

export const PLACES = [
  {
    id: 'camp',
    name: "Milo's camp",
    blurb: "Home base. Milo keeps the fire going, and the crew rests here when they're done.",
    built: true,
    fogged: false,
    door: { x: 31, y: 22 },
    area: { x: 24, y: 13, w: 16, h: 12 },
  },
  {
    id: 'watchtower',
    name: 'Watchtower',
    blurb: 'Where Milo keeps an eye on your agent sessions.',
    built: true,
    fogged: false,
    door: { x: 31, y: 10 },
    area: { x: 28, y: 3, w: 8, h: 8 },
  },
  {
    id: 'workshop',
    name: 'Workshop row',
    blurb: "Crew who are working gather at these benches. Later it's where agent runs get dispatched.",
    built: false,
    fogged: false,
    door: { x: 48, y: 20 },
    area: { x: 41, y: 15, w: 15, h: 6 },
  },
  {
    id: 'clip-studio',
    name: 'Clip studio',
    blurb: 'An easel on an empty plot. One day it cuts and captions stream clips.',
    built: false,
    fogged: false,
    door: { x: 49, y: 9 },
    area: { x: 45, y: 3, w: 9, h: 7 },
  },
  {
    id: 'library',
    name: 'Library',
    blurb: 'A quiet plot for project memory: decisions, notes and what was tried.',
    built: false,
    fogged: false,
    door: { x: 15, y: 21 },
    area: { x: 8, y: 16, w: 8, h: 7 },
  },
  {
    id: 'game-table',
    name: 'Game table',
    blurb: 'A stump table waiting for dice. Campaign prep will live here.',
    built: false,
    fogged: false,
    door: { x: 17, y: 30 },
    area: { x: 10, y: 27, w: 8, h: 6 },
  },
  {
    id: 'building-site',
    name: 'Building site',
    blurb: 'The first beams are up. New apps get scaffolded here.',
    built: false,
    fogged: false,
    door: { x: 14, y: 9 },
    area: { x: 10, y: 3, w: 9, h: 7 },
  },
  {
    id: 'harbor',
    name: 'Harbor',
    blurb: 'Schedules and deadlines come in by boat. Connect a calendar to clear the fog.',
    built: false,
    fogged: true,
    door: { x: 50, y: 33 },
    area: { x: 44, y: 31, w: 16, h: 13 },
  },
];

const PLACE_BY_ID = Object.fromEntries(PLACES.map((place) => [place.id, place]));

export function placeById(id) {
  return PLACE_BY_ID[id] || null;
}

// ---------- water shapes (analytic, so shores are smooth at pixel level) ----------

// First water row of the sea, in tile units, for a column x (tile units, continuous).
export function coastAt(x) {
  if (x < 23) return H + 8;
  const s = smoothstep((x - 24) / 21);
  return 35.1 + 9.6 * (1 - s) + 0.45 * Math.sin(x * 0.55) + 0.3 * Math.sin(x * 1.3 + 1);
}

// Beach width in tiles, a little deeper by the harbor.
export function beachAt(x) {
  return 1.5 + 1.1 * smoothstep((x - 43) / 3) * (1 - smoothstep((x - 56) / 3));
}

export const POND = { cx: 21, cy: 25.6, rx: 3.5, ry: 2.25 };

export function pondContains(x, y) {
  const dx = (x - POND.cx) / POND.rx;
  const dy = (y - POND.cy) / POND.ry;
  const a = Math.atan2(dy, dx);
  const r = 1 + 0.07 * Math.sin(3 * a + 0.6) + 0.05 * Math.sin(5 * a + 2);
  return dx * dx + dy * dy < r * r;
}

// Terrain from the analytic shapes at a point in tile units, or null for plain land.
export function naturalAt(x, y) {
  if (y >= coastAt(x)) return TERRAIN.WATER;
  if (pondContains(x, y)) return TERRAIN.WATER;
  if (y >= coastAt(x) - beachAt(x)) return TERRAIN.SAND;
  return null;
}

// ---------- terrain ----------

const cells = Array.from({ length: H }, () => new Array(W).fill(TERRAIN.GRASS));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const put = (x, y, ch) => {
  if (inBounds(x, y)) cells[y][x] = ch;
};
const fill = (x0, y0, x1, y1, ch) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) put(x, y, ch);
};

// Sea, beach and pond: a tile takes whatever lies under a character's feet.
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const natural = naturalAt(x + 0.5, y + 13 / 16);
    if (natural) put(x, y, natural);
  }
}

// Roads, one tile wide.
fill(31, 10, 31, 16, TERRAIN.PATH); // north road to the watchtower
fill(14, 12, 49, 12, TERRAIN.PATH); // upper road
fill(14, 9, 14, 11, TERRAIN.PATH); // building-site gate
fill(49, 9, 49, 11, TERRAIN.PATH); // clip-studio gate
fill(15, 21, 26, 21, TERRAIN.PATH); // west road to the library
fill(37, 21, 54, 21, TERRAIN.PATH); // east road along the workshop row
fill(31, 23, 31, 30, TERRAIN.PATH); // south road
fill(17, 30, 50, 30, TERRAIN.PATH); // lower road
fill(50, 30, 50, 33, TERRAIN.PATH); // harbor spur

// Camp clearing: a soft round yard around the fire.
const CLEARING = [
  [17, 30, 33],
  [18, 28, 35],
  [19, 27, 35],
  [20, 27, 36],
  [21, 26, 37],
  [22, 28, 34],
  [23, 30, 32],
];
for (const [y, x0, x1] of CLEARING) fill(x0, y, x1, y, TERRAIN.PATH);
fill(26, 17, 26, 18, TERRAIN.PATH); // cabin door
put(27, 18, TERRAIN.PATH);
fill(36, 17, 36, 18, TERRAIN.PATH); // tent door

// Plot footprints: cleared soil, staked out, inside each fenced plot.
const PLOTS = {
  'building-site': { x0: 12, y0: 5, x1: 16, y1: 7 },
  'clip-studio': { x0: 47, y0: 5, x1: 51, y1: 7 },
  library: { x0: 10, y0: 18, x1: 12, y1: 20 },
  'game-table': { x0: 12, y0: 29, x1: 14, y1: 31 },
  workshop: { x0: 42, y0: 17, x1: 54, y1: 19 },
};
for (const plot of Object.values(PLOTS)) fill(plot.x0, plot.y0, plot.x1, plot.y1, TERRAIN.SOIL);

// Dock out over the water.
fill(50, 34, 50, 40, TERRAIN.DOCK);
put(51, 40, TERRAIN.DOCK);
put(49, 40, TERRAIN.DOCK);

// ---------- objects ----------

const objects = [];
const blocked = new Set();
const key = (x, y) => y * W + x;
let objectCount = 0;

// Adds a prop. Footprint (x, y, w, h) is in tiles; the sprite sits on the
// footprint's bottom-centre plus (dx, dy) pixels.
function add(kind, x, y, { w = 1, h = 1, place = null, blocks = true, dx = 0, dy = 0 } = {}) {
  const object = { id: `${kind}#${objectCount += 1}`, kind, x, y, w, h, place, blocks, dx, dy };
  objects.push(object);
  if (blocks) for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) blocked.add(key(xx, yy));
  return object;
}

const placeOfTile = (x, y) => {
  for (const place of PLACES) {
    const { area } = place;
    if (x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h) return place.id;
  }
  return null;
};

// Fences around plots, with gates. Each fence tile records its neighbours for autotiling.
const fenceTiles = new Set();
function fenceRect(x0, y0, x1, y1, gates = []) {
  const open = new Set(gates.map(([x, y]) => key(x, y)));
  for (let x = x0; x <= x1; x += 1) for (const y of [y0, y1]) if (!open.has(key(x, y))) fenceTiles.add(key(x, y));
  for (let y = y0; y <= y1; y += 1) for (const x of [x0, x1]) if (!open.has(key(x, y))) fenceTiles.add(key(x, y));
}
fenceRect(10, 3, 18, 9, [[14, 9]]);
fenceRect(45, 3, 53, 9, [[49, 9]]);
fenceRect(8, 16, 15, 22, [[15, 21]]);
fenceRect(10, 27, 17, 32, [[17, 30]]);
// Workshop row: back and sides only; the front opens onto the road.
for (let x = 41; x <= 55; x += 1) fenceTiles.add(key(x, 15));
for (let y = 16; y <= 19; y += 1) {
  fenceTiles.add(key(41, y));
  fenceTiles.add(key(55, y));
}
for (const k of fenceTiles) {
  const x = k % W;
  const y = Math.floor(k / W);
  const fence = add('fence', x, y, { place: placeOfTile(x, y) });
  fence.mask = {
    n: fenceTiles.has(key(x, y - 1)),
    s: fenceTiles.has(key(x, y + 1)),
    e: fenceTiles.has(key(x + 1, y)),
    w: fenceTiles.has(key(x - 1, y)),
  };
}

// Milo's camp
add('cabin', 26, 15, { w: 3, h: 2, place: 'camp' });
add('tent', 35, 15, { w: 3, h: 2, place: 'camp' });
add('flag', 38, 16, { place: 'camp', dx: 3 });
add('campfire', 31, 20, { place: 'camp' });
add('log.bench', 30, 19, { w: 3, place: 'camp' });
add('stump', 29, 20, { place: 'camp', dy: -2 });
add('stump', 33, 20, { place: 'camp', dy: -2 });
add('lantern', 30, 24, { place: 'camp', dx: 3 });
add('lantern', 32, 24, { place: 'camp', dx: -3 });
add('barrel', 29, 16, { place: 'camp', dx: -2 });
add('woodpile', 25, 16, { place: 'camp', dx: -4 });
add('garden', 27, 23, { w: 2, place: 'camp', dx: -4 });
add('crate', 37, 19, { place: 'camp', dx: 2 });
add('barrel', 37, 18, { place: 'camp', dx: 4, dy: -3 });

// Watchtower
add('tower', 30, 8, { w: 3, h: 2, place: 'watchtower' });

// Building site
add('scaffold', 12, 6, { w: 2, h: 2, place: 'building-site' });
add('planks', 15, 7, { place: 'building-site' });
add('crate', 16, 5, { place: 'building-site' });
add('barrel', 17, 6, { place: 'building-site' });
add('sign.building-site', 13, 10, { place: 'building-site' });

// Clip studio
add('easel', 49, 6, { place: 'clip-studio' });
add('stool', 49, 7, { place: 'clip-studio', blocks: false, dy: -3 });
add('crate', 51, 5, { place: 'clip-studio', dx: 4 });
add('sign.clip-studio', 48, 10, { place: 'clip-studio' });

// Library
add('crate', 10, 19, { place: 'library' });
add('crate', 10, 19, { place: 'library', dy: -5, dx: 5, blocks: false });
add('barrel', 12, 20, { place: 'library' });
add('sign.library', 16, 22, { place: 'library' });
add('stump', 16, 19, { place: 'library' }); // Whisper's perch

// Game table
add('stump.table', 12, 30, { w: 2, place: 'game-table' });
add('stool', 12, 30, { place: 'game-table', dx: -9, dy: 1, blocks: false });
add('stool', 13, 30, { place: 'game-table', dx: 9, dy: 1, blocks: false });
add('sign.game-table', 18, 29, { place: 'game-table' });

// Workshop row: four stations with crew standing behind them.
const STATIONS = [
  { x: 43, kind: 'desk' },
  { x: 46, kind: 'workbench' },
  { x: 49, kind: 'desk' },
  { x: 52, kind: 'workbench' },
];
for (const station of STATIONS) {
  add(station.kind, station.x, 18, { place: 'workshop' });
  blocked.add(key(station.x, 17));
}
add('sign.workshop', 42, 20, { place: 'workshop', dy: 2 });

// Harbor (fogged)
add('crate', 46, 33, { place: 'harbor' });
add('crate', 47, 33, { place: 'harbor', dy: -3 });
add('barrel', 48, 32, { place: 'harbor' });
add('lamp.post', 51, 33, { place: 'harbor', dx: 2 });
add('boat', 52, 37, { w: 2, place: 'harbor', dx: -2 });
add('sign.harbor', 49, 33, { place: 'harbor', dx: -3 });

// Pond details
add('rock', 24, 26, { dx: 2 });
add('reeds', 17, 25, { blocks: false, dx: 8 });
add('reeds', 24, 24, { blocks: false, dx: 2 });
add('bush.berry', 20, 22, { dx: -4 });

// ---------- trees ----------

function terrainAtRaw(x, y) {
  return inBounds(x, y) ? cells[y][x] : null;
}

function nearNonGrass(x, y, radius) {
  for (let yy = y - radius; yy <= y + radius; yy += 1) {
    for (let xx = x - radius; xx <= x + radius; xx += 1) {
      if (!inBounds(xx, yy)) continue;
      if (cells[yy][xx] !== TERRAIN.GRASS || blocked.has(key(xx, yy))) return true;
    }
  }
  return false;
}

function inAnyArea(x, y, margin) {
  return PLACES.some(({ area }) => x >= area.x - margin && y >= area.y - margin && x < area.x + area.w + margin && y < area.y + area.h + margin);
}

// Groves: [x, y, radius] in tiles.
const GROVES = [
  [3, 11, 5], [2, 24, 4], [22, 6, 4], [23, 15, 2.5], [38, 7, 3.5], [41, 11, 2], [59, 7, 5.5], [60, 17, 4.5],
  [44, 26, 4.5], [57, 26, 3.5], [4, 38, 7], [23, 38, 6], [13, 41, 5], [37, 27, 2.5], [26, 31, 2.5], [5, 30, 2.5],
];

function treeDensity(x, y) {
  const edge = Math.min(x, W - 1 - x, y, coastAt(x) > H ? H - 1 - y : 99);
  if (edge <= 1) return 0.95;
  if (edge <= 2) return 0.7;
  let best = 0.05;
  for (const [cx, cy, r] of GROVES) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) best = Math.max(best, 0.8 - (d / r) * 0.4);
  }
  return best;
}

const treeTiles = [];
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (cells[y][x] !== TERRAIN.GRASS || blocked.has(key(x, y))) continue;
    const edge = Math.min(x, W - 1 - x, y);
    if (edge > 1) {
      if (nearNonGrass(x, y, 1) || inAnyArea(x, y, 1)) continue;
      // Keep canopies (which rise about two tiles) off roads and plots.
      if ([-1, 0, 1].some((d) => [TERRAIN.PATH, TERRAIN.SOIL].includes(terrainAtRaw(x + d, y - 2)))) continue;
    }
    if (hash2(x, y, 7) > treeDensity(x, y)) continue;
    const crowded = treeTiles.some(([tx, ty]) => Math.abs(tx - x) < 2 && Math.abs(ty - y) < 2);
    if (crowded) continue;
    treeTiles.push([x, y]);
  }
}
for (const [x, y] of treeTiles) {
  const roll = hash2(x, y, 11);
  let kind = 'tree';
  if (roll < 0.26 || (y < 2 && roll < 0.5)) kind = 'pine';
  else if (roll > 0.91) kind = 'tree.blossom';
  else if (roll > 0.86 && y > 2) kind = 'bush';
  const dx = Math.round((hash2(x, y, 13) - 0.5) * 8);
  const dy = Math.round((hash2(x, y, 17) - 0.5) * 4);
  add(kind, x, y, { dx, dy });
}

// A few bushes and rocks near the roads, clear of the path itself.
const SCATTER = [
  ['bush', 21, 19], ['rock', 27, 14], ['bush', 35, 11], ['bush.berry', 38, 23], ['rock', 44, 22],
  ['bush', 20, 32], ['rock', 34, 32], ['bush', 45, 28], ['rock', 5, 26], ['bush.berry', 26, 9],
  ['rock', 57, 22], ['bush', 34, 9], ['rock', 12, 25], ['bush', 28, 25], ['bush.berry', 35, 25],
  ['rock', 19, 14], ['bush', 42, 10], ['rock', 55, 11],
];

// Sprite box of an object, placed the way the engine draws it (bottom-centre of its footprint).
function spriteBox({ kind, x, y, w = 1, h = 1, dx = 0, dy = 0 }) {
  const rows = SPRITES[kind] && SPRITES[kind][0];
  if (!rows) return null;
  const baseX = (x + w / 2) * TILE + dx;
  const baseY = (y + h) * TILE + dy;
  return { rows, sx: Math.round(baseX - rows[0].length / 2), sy: Math.round(baseY - rows.length), baseY };
}

const opaque = (ch) => ch !== undefined && ch !== '.' && ch !== 'x';

/** Share of `back`'s visible pixels that `front` paints over (0..1). */
function coveredShare(back, front) {
  let total = 0;
  let covered = 0;
  back.rows.forEach((row, py) => {
    for (let px = 0; px < row.length; px += 1) {
      if (!opaque(row[px])) continue;
      total += 1;
      const fy = back.sy + py - front.sy;
      const fx = back.sx + px - front.sx;
      if (opaque(front.rows[fy]?.[fx])) covered += 1;
    }
  });
  return total ? covered / total : 0;
}

// A scatter prop sitting behind a taller sprite (a tree crown, the cabin roof) reads as perched
// on top of it, so it is left out.
export const MAX_SCATTER_HIDDEN = 0.2;
function hiddenBehindSomething(candidate) {
  const box = spriteBox(candidate);
  if (!box) return false;
  return objects.some((object) => {
    const other = spriteBox(object);
    return other && other.baseY >= box.baseY && coveredShare(box, other) > MAX_SCATTER_HIDDEN;
  });
}

for (const [kind, x, y] of SCATTER) {
  if (terrainAtRaw(x, y) !== TERRAIN.GRASS || blocked.has(key(x, y))) continue;
  if (hiddenBehindSomething({ kind, x, y })) continue;
  add(kind, x, y);
}

// ---------- exported map ----------

export const MAP = {
  width: W,
  height: H,
  tiles: cells.map((row) => row.join('')),
  objects,
  plots: PLOTS,
  slots: {
    // Crew stand behind the Workshop row stations.
    work: STATIONS.map((station) => ({ x: station.x, y: 17, station: station.kind })),
    // Seats: three on the log bench just north of the fire, two stumps beside it.
    campfire: [
      { x: 31, y: 19, seat: 'bench', dx: 0 },
      { x: 30, y: 19, seat: 'bench', dx: 4 },
      { x: 32, y: 19, seat: 'bench', dx: -4 },
      { x: 29, y: 20, seat: 'stump', dx: 0 },
      { x: 33, y: 20, seat: 'stump', dx: 0 },
    ],
    // Just outside the camp's south gate, either side of the road.
    waiting: [
      { x: 29, y: 25 },
      { x: 33, y: 25 },
      { x: 28, y: 26 },
      { x: 34, y: 26 },
    ],
    // Pixel positions (feet) for the two helpers who keep their own spots.
    jev: { px: 30 * TILE + 42, py: 10 * TILE - 77 + 14 },
    whisper: { px: 16 * TILE + 8, py: 20 * TILE - 7 },
  },
  // Flat ground details baked into the ground layer: [sprite, px, py].
  decals: [
    ['flagstone', 29 * TILE + 6, 10 * TILE + 4], ['flagstone', 32 * TILE + 2, 10 * TILE + 6], ['flagstone', 29 * TILE + 13, 11 * TILE + 3],
    ['flagstone', 33 * TILE + 4, 9 * TILE + 11], ['flagstone', 28 * TILE + 9, 9 * TILE + 9],
    ['flagstone', 25 * TILE + 2, 27 * TILE + 6], ['flagstone', 26 * TILE + 1, 28 * TILE + 3], ['flagstone', 17 * TILE + 3, 27 * TILE + 5],
  ],
  miloHome: { x: 31, y: 22 },
  tentDoor: { x: 36, y: 16 },
};

export function terrainAt(x, y) {
  return terrainAtRaw(x, y);
}

export function isWalkable(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y)) return false;
  if (!WALKABLE_TERRAIN.has(cells[y][x])) return false;
  return !blocked.has(key(x, y));
}

export function placeAt(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y)) return null;
  return placeOfTile(x, y);
}

// ---------- A* ----------

function stepCost(x, y) {
  const t = cells[y][x];
  return t === TERRAIN.PATH || t === TERRAIN.DOCK ? 1 : 1.2;
}

class Heap {
  constructor() {
    this.items = [];
  }
  push(node, priority) {
    const items = this.items;
    items.push([priority, node]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l][0] < items[m][0]) m = l;
        if (r < items.length && items[r][0] < items[m][0]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() {
    return this.items.length;
  }
}

// Walkable stand-ins for an unwalkable target: the nearest ring of neighbours.
function goalsFor(to) {
  if (isWalkable(to.x, to.y)) return [to];
  for (let radius = 1; radius <= 3; radius += 1) {
    const ring = [];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (isWalkable(to.x + dx, to.y + dy)) ring.push({ x: to.x + dx, y: to.y + dy });
      }
    }
    if (ring.length > 0) {
      const manhattan = (p) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y);
      const best = Math.min(...ring.map(manhattan));
      return ring.filter((p) => manhattan(p) === best);
    }
  }
  return [];
}

export function findPath(from, to) {
  if (!from || !to) return [];
  const fx = Math.round(from.x);
  const fy = Math.round(from.y);
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  if (!inBounds(fx, fy) || !inBounds(tx, ty)) return [];
  const goals = goalsFor({ x: tx, y: ty });
  if (goals.length === 0) return [];
  if (goals.some((g) => g.x === fx && g.y === fy)) return [];
  const goalKeys = new Set(goals.map((g) => key(g.x, g.y)));
  const h = (x, y) => Math.min(...goals.map((g) => Math.abs(g.x - x) + Math.abs(g.y - y)));
  const size = W * H;
  const g = new Float64Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const start = key(fx, fy);
  g[start] = 0;
  const open = new Heap();
  open.push(start, h(fx, fy));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (goalKeys.has(current)) {
      const path = [];
      let node = current;
      while (node !== start) {
        path.push({ x: node % W, y: Math.floor(node / W) });
        node = came[node];
      }
      return path.reverse();
    }
    const cx = current % W;
    const cy = Math.floor(current / W);
    const prev = came[current];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny)) continue;
      const next = key(nx, ny);
      if (closed[next]) continue;
      // A tiny nudge against turning keeps walks in calm straight lines.
      let turn = 0;
      if (prev >= 0 && (cx - (prev % W) !== dx || cy - Math.floor(prev / W) !== dy)) turn = 0.001;
      const cost = g[current] + stepCost(nx, ny) + turn;
      if (cost < g[next]) {
        g[next] = cost;
        came[next] = current;
        open.push(next, cost + h(nx, ny));
      }
    }
  }
  return [];
}
