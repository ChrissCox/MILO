// MILO world engine: a calm top-down pixel world on a 2D canvas.
// Browser ESM with no dependencies. Importing this module touches no DOM;
// everything that needs a document happens inside createWorld().
//
// createWorld(canvas, options) follows CONTRACT.md. Two small extras:
//   options.scale   fixes the CSS pixels per art pixel (2-4) instead of picking one
//   world.renderMap(scale, { time }) returns a canvas of the whole map (previews)
//   world.scale     the CSS pixels per art pixel in use
// Size the canvas with CSS; the engine sets its backing store to CSS size x DPR.
// Motion is on only when options.motion() is not false and the system does not
// ask for reduced motion; otherwise nothing animates and frames draw on change.

import { TILE, MAP, PLACES, TERRAIN, isWalkable, findPath, placeAt, placeById, hash2, naturalAt } from './map.js';
import { SPRITES, PALETTE, HELPER_TINTS, rgbaOf, buildAtlas, stamp as stampGrid } from './sprites.js';

const MAP_W = MAP.width * TILE;
const MAP_H = MAP.height * TILE;
const FEET = 13; // feet sit 13 px into a tile
const MILO_SPEED = 80; // px per second
const CREW_SPEED = 46;
const FRAME_MS = 1000 / 30;
const CAMERA_LOOK_UP = 36; // world px above Milo's feet that the camera centres on
const ROOMY_VIEW = { w: 26, h: 16 }; // tiles the view keeps before it zooms to 4x

const CREW_ORDER = ['claude', 'codex', 'ollama'];
const CREW_ART = { claude: 'claude', codex: 'codex', ollama: 'ollama' };
const PERCHED = new Set(['jev', 'whisper']);

// ---------- ground painting (pure; works on any ImageData-like buffer) ----------

const T_GRASS = 0;
const T_PATH = 1;
const T_WATER = 2;
const T_SAND = 3;
const T_SOIL = 4;
const TERRAIN_CODE = { '.': T_GRASS, '=': T_PATH, '~': T_WATER, ',': T_SAND, ':': T_SOIL, '#': T_WATER };
const CORNER_RADIUS = [6, 6, 6, 6, 3];

function tileCode(tx, ty) {
  const x = Math.max(0, Math.min(MAP.width - 1, tx));
  const y = Math.max(0, Math.min(MAP.height - 1, ty));
  return TERRAIN_CODE[MAP.tiles[y][x]];
}

function smoothNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Terrain per pixel, with rounded corners so paths and shores read as soft shapes.
export function terrainPixels() {
  const types = new Uint8Array(MAP_W * MAP_H);
  for (let ty = 0; ty < MAP.height; ty += 1) {
    for (let tx = 0; tx < MAP.width; tx += 1) {
      const t = tileCode(tx, ty);
      const ch = MAP.tiles[ty][tx];
      if (ch === TERRAIN.GRASS || ch === TERRAIN.SAND || ch === TERRAIN.WATER) {
        // Natural ground follows the smooth analytic shores, pixel by pixel.
        for (let ly = 0; ly < TILE; ly += 1) {
          for (let lx = 0; lx < TILE; lx += 1) {
            const nat = naturalAt((tx * TILE + lx + 0.5) / TILE, (ty * TILE + ly + 0.5) / TILE);
            types[(ty * TILE + ly) * MAP_W + tx * TILE + lx] = nat === TERRAIN.WATER ? T_WATER : nat === TERRAIN.SAND ? T_SAND : T_GRASS;
          }
        }
        continue;
      }
      const r = CORNER_RADIUS[t];
      for (let ly = 0; ly < TILE; ly += 1) {
        for (let lx = 0; lx < TILE; lx += 1) {
          let v = t;
          const sx = lx < 8 ? -1 : 1;
          const sy = ly < 8 ? -1 : 1;
          const a = tileCode(tx + sx, ty);
          const b = tileCode(tx, ty + sy);
          if (a !== t && b !== t) {
            const dx = lx < 8 ? lx : 15 - lx;
            const dy = ly < 8 ? ly : 15 - ly;
            if (dx < r && dy < r) {
              const ex = r - dx - 0.5;
              const ey = r - dy - 0.5;
              if (ex * ex + ey * ey > r * r) {
                const c = tileCode(tx + sx, ty + sy);
                v = c === a || c === b ? c : a;
              }
            }
          }
          types[(ty * TILE + ly) * MAP_W + tx * TILE + lx] = v;
        }
      }
    }
  }
  return types;
}

function waterDistance(types) {
  const dist = new Uint8Array(MAP_W * MAP_H).fill(255);
  const queue = new Int32Array(MAP_W * MAP_H);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] !== T_WATER) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= 40) continue;
    const x = i % MAP_W;
    const neighbours = [x > 0 ? i - 1 : -1, x < MAP_W - 1 ? i + 1 : -1, i - MAP_W, i + MAP_W];
    for (const n of neighbours) {
      if (n < 0 || n >= types.length || dist[n] !== 255) continue;
      dist[n] = d + 1;
      queue[tail++] = n;
    }
  }
  return dist;
}

const RGB = Object.fromEntries(Object.keys(PALETTE).map((k) => [k, rgbaOf(k)]));

function putPixel(data, x, y, keyOrRgba) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  const c = typeof keyOrRgba === 'string' ? RGB[keyOrRgba] : keyOrRgba;
  if (!c) return;
  const i = (y * MAP_W + x) * 4;
  const a = c[3] / 255;
  data[i] = Math.round(data[i] * (1 - a) + c[0] * a);
  data[i + 1] = Math.round(data[i + 1] * (1 - a) + c[1] * a);
  data[i + 2] = Math.round(data[i + 2] * (1 - a) + c[2] * a);
  data[i + 3] = 255;
}

function stampSprite(data, rows, x, y) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx += 1) {
      const ch = row[dx];
      if (ch !== '.') putPixel(data, x + dx, y + dy, ch);
    }
  });
}

function regionIs(types, x, y, w, h, wanted) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) return false;
      if (types[yy * MAP_W + xx] !== wanted) return false;
    }
  }
  return true;
}

const FLOWER_ZONES = [
  [31.5, 20, 8], [21, 25.5, 5], [44, 26, 4], [11, 13.5, 3], [52, 13.5, 3.5], [27, 34, 4.5], [38, 28, 3], [5, 27, 3],
  [13, 6, 4], [49, 6, 3.5], [11, 19, 3.5], [13, 30, 3], [31, 7, 4.5], [37, 13, 2.5],
];
const FLOWERS = ['flower.pink', 'flower.butter', 'flower.lavender', 'flower.cream'];

// Paints the static ground layer into `data` (RGBA, MAP_W x MAP_H).
export function paintGround(data) {
  const types = terrainPixels();
  const dist = waterDistance(types);
  const blockedTiles = new Set(MAP.objects.filter((o) => o.blocks).flatMap((o) => {
    const tiles = [];
    for (let y = o.y; y < o.y + o.h; y += 1) for (let x = o.x; x < o.x + o.w; x += 1) tiles.push(`${x},${y}`);
    return tiles;
  }));
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? -1 : types[y * MAP_W + x]);
  const dock = SPRITES.dock[0];

  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const i = y * MAP_W + x;
      const t = types[i];
      let key = 'g';
      if (t === T_GRASS) {
        const n = smoothNoise(x, y, 40, 3) * 0.8 + smoothNoise(x, y, 11, 5) * 0.2;
        key = n > 0.74 ? 'j' : 'g';
        // Soft darker lip where grass meets a path or soil below it.
        const below = at(x, y + 1);
        if (below === T_PATH || below === T_SOIL || below === T_SAND) key = 'G';
      } else if (t === T_PATH || t === T_SAND) {
        key = 'p';
        const edge = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n === T_GRASS || n === T_SOIL);
        if (edge) key = 'P';
        else if (t === T_SAND && dist[i] === 0) {
          // wet sand near water
          let wet = false;
          for (let d = 1; d <= 2 && !wet; d += 1) wet = [at(x - d, y), at(x + d, y), at(x, y - d), at(x, y + d)].includes(T_WATER);
          if (wet) key = 'P';
        } else if (hash2(x, y, 17) < 0.006) key = 'P';
      } else if (t === T_SOIL) {
        key = 'n';
        const edge = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== T_SOIL);
        if (edge) key = 'b';
        else if (hash2(x, y, 19) < 0.008) key = 'b';
      } else if (t === T_WATER) {
        const d = dist[i];
        const deep = d + smoothNoise(x, y, 30, 9) * 4 > 22;
        key = deep ? 'W' : 'w';
        let bank = false;
        for (let k = 1; k <= 3; k += 1) if (at(x, y - k) !== T_WATER && at(x, y - k) !== -1) bank = true;
        if (bank && d > 1) key = 'W';
        if (d === 1) key = 'f';
      }
      putPixel(data, x, y, key);
    }
  }

  // Dock planks over the water.
  for (let ty = 0; ty < MAP.height; ty += 1) {
    for (let tx = 0; tx < MAP.width; tx += 1) {
      if (MAP.tiles[ty][tx] !== TERRAIN.DOCK) continue;
      const leftDock = MAP.tiles[ty][tx - 1] === TERRAIN.DOCK;
      const rightDock = MAP.tiles[ty][tx + 1] === TERRAIN.DOCK;
      for (let ly = 0; ly < TILE; ly += 1) {
        for (let lx = 0; lx < TILE; lx += 1) {
          let col = lx;
          if (lx === 0 && leftDock) col = 2;
          if (lx === 15 && rightDock) col = 13;
          if (lx === 1 && leftDock) col = 2;
          if (lx === 14 && rightDock) col = 13;
          putPixel(data, tx * TILE + lx, ty * TILE + ly, dock[ly][col]);
        }
      }
      // shadow on the water under the dock's end
      if (MAP.tiles[ty + 1]?.[tx] === TERRAIN.WATER) {
        for (let lx = 0; lx < TILE; lx += 1) for (let ly = 0; ly < 3; ly += 1) putPixel(data, tx * TILE + lx, (ty + 1) * TILE + ly, 'W');
      }
    }
  }

  // Plot markings: corner stakes and a dashed string line.
  for (const plot of Object.values(MAP.plots)) {
    const x0 = plot.x0 * TILE + 3;
    const y0 = plot.y0 * TILE + 3;
    const x1 = (plot.x1 + 1) * TILE - 4;
    const y1 = (plot.y1 + 1) * TILE - 4;
    for (let x = x0; x <= x1; x += 1) {
      if ((x - x0) % 4 < 2) {
        putPixel(data, x, y0, 'c');
        putPixel(data, x, y1, 'c');
      }
    }
    for (let y = y0; y <= y1; y += 1) {
      if ((y - y0) % 4 < 2) {
        putPixel(data, x0, y, 'c');
        putPixel(data, x1, y, 'c');
      }
    }
    const stake = SPRITES.stake[0];
    for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) stampSprite(data, stake, sx - 1, sy - 4);
  }

  for (const [name, px, py] of MAP.decals || []) stampSprite(data, SPRITES[name][0], px, py);

  // Lily pads on the pond, pebbles and flowers on the grass.
  stampSprite(data, SPRITES.lily[0], 19 * TILE + 2, 25 * TILE + 4);
  stampSprite(data, SPRITES['lily.flower'][0], 21 * TILE + 8, 26 * TILE + 3);
  stampSprite(data, SPRITES.lily[0], 22 * TILE + 6, 24 * TILE + 10);

  for (let ty = 0; ty < MAP.height; ty += 1) {
    for (let tx = 0; tx < MAP.width; tx += 1) {
      if (MAP.tiles[ty][tx] !== TERRAIN.GRASS || blockedTiles.has(`${tx},${ty}`)) continue;
      const inZone = FLOWER_ZONES.some(([cx, cy, r]) => Math.hypot(tx - cx, ty - cy) <= r);
      const roll = hash2(tx, ty, 31);
      const ox = tx * TILE + Math.floor(hash2(tx, ty, 37) * 9);
      const oy = ty * TILE + Math.floor(hash2(tx, ty, 41) * 10);
      if (roll < (inZone ? 0.34 : 0.03)) {
        const name = FLOWERS[Math.floor(hash2(tx, ty, 43) * FLOWERS.length)];
        const rows = SPRITES[name][0];
        if (regionIs(types, ox, oy, rows[0].length, rows.length, T_GRASS)) stampSprite(data, rows, ox, oy);
        continue;
      }
      if (roll < (inZone ? 0.5 : 0.24)) {
        const pick = hash2(tx, ty, 47);
        const name = pick < 0.62 ? 'tuft' : pick < 0.86 ? 'tuft.light' : 'clover';
        const rows = SPRITES[name][0];
        if (regionIs(types, ox, oy, rows[0].length, rows.length, T_GRASS)) stampSprite(data, rows, ox, oy);
      } else if (roll > 0.985) {
        const rows = SPRITES.pebbles[0];
        if (regionIs(types, ox, oy, rows[0].length, rows.length, T_GRASS)) stampSprite(data, rows, ox, oy);
      }
    }
  }
  // Mushrooms tucked beside some trees.
  for (const o of MAP.objects) {
    if (o.kind !== 'tree' && o.kind !== 'pine') continue;
    if (hash2(o.x, o.y, 53) > 0.16) continue;
    const rows = SPRITES.mushrooms[0];
    const mx = o.x * TILE + 12;
    const my = o.y * TILE + 9;
    if (regionIs(types, mx, my, rows[0].length, rows.length, T_GRASS)) stampSprite(data, rows, mx, my);
  }
  return types;
}

// Precomputed shimmer spots on open water.
function shimmerSpots(types) {
  const dist = waterDistance(types);
  const spots = [];
  for (let ty = 0; ty < MAP.height; ty += 1) {
    for (let tx = 0; tx < MAP.width; tx += 1) {
      if (MAP.tiles[ty][tx] !== TERRAIN.WATER) continue;
      if (hash2(tx, ty, 61) > 0.55) continue;
      const x = tx * TILE + 2 + Math.floor(hash2(tx, ty, 67) * 10);
      const y = ty * TILE + 2 + Math.floor(hash2(tx, ty, 71) * 12);
      if (dist[y * MAP_W + x] < 5 || dist[y * MAP_W + x + 3] < 5) continue;
      spots.push({ x, y, len: 2 + Math.floor(hash2(tx, ty, 73) * 3), phase: hash2(tx, ty, 79) * 4000, period: 3200 + hash2(tx, ty, 83) * 2400 });
    }
  }
  return spots;
}

// ---------- sprite placement ----------

function spriteFor(object) {
  if (object.kind === 'fence') {
    const m = object.mask;
    return `fence:${m.n ? 1 : 0}${m.s ? 1 : 0}${m.e ? 1 : 0}${m.w ? 1 : 0}`;
  }
  return object.kind;
}

function gridFor(name, frame = 0) {
  if (name.startsWith('fence:')) return FENCE_GRIDS[name];
  const frames = SPRITES[name];
  return frames[frame % frames.length];
}

const FENCE_GRIDS = {};
for (let bits = 0; bits < 16; bits += 1) {
  const n = bits & 8;
  const s = bits & 4;
  const e = bits & 2;
  const w = bits & 1;
  let rows = Array.from({ length: 16 }, () => '.'.repeat(16));
  if (n) rows = stampGrid(rows, SPRITES['fence.n'][0], 0, 0);
  if (w) rows = stampGrid(rows, SPRITES['fence.w'][0], 0, 0);
  if (e) rows = stampGrid(rows, SPRITES['fence.e'][0], 0, 0);
  rows = stampGrid(rows, SPRITES['fence.post'][0], 0, 0);
  if (s) rows = stampGrid(rows, SPRITES['fence.s'][0], 0, 14);
  FENCE_GRIDS[`fence:${n ? 1 : 0}${s ? 1 : 0}${e ? 1 : 0}${w ? 1 : 0}`] = rows;
}

const SHADOWS = {
  tree: [22, 6, -2], 'tree.blossom': [22, 6, -2], pine: [14, 5, -1], bush: [14, 4, -1], 'bush.berry': [14, 4, -1],
  rock: [14, 4, -1], stump: [14, 4, -1], cabin: [46, 6, -1], tent: [30, 5, -1], tower: [44, 7, -2], crate: [14, 4, -1],
  barrel: [12, 4, -1], scaffold: [30, 5, -1], desk: [18, 4, -1], workbench: [18, 4, -1], easel: [14, 4, -1],
  'stump.table': [20, 4, -1], woodpile: [22, 4, -1], garden: [30, 3, 0], lantern: [8, 3, -1], 'lamp.post': [8, 3, -1], 'log.bench': [38, 4, -1], campfire: [16, 4, -3],
  planks: [16, 3, -1], boat: [30, 4, 1], flag: [6, 2, -1],
};

function unionRect(rects) {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where each map object's sprite sits, in world px: { id, kind, place, x, y, sprite, sx, sy, sw, sh, baseY }. */
export function objectBoxes() {
  return MAP.objects.map((object) => {
    const { id, kind, place, x, y, sprite, sx, sy, sw, sh, baseY } = placeObject(object);
    return { id, kind, place, x, y, sprite, sx, sy, sw, sh, baseY };
  });
}

function placeObject(object) {
  const name = spriteFor(object);
  const rows = gridFor(name);
  const w = rows[0].length;
  const h = rows.length;
  const baseX = (object.x + object.w / 2) * TILE + object.dx;
  const baseY = (object.y + object.h) * TILE + object.dy;
  return {
    ...object,
    sprite: name,
    sx: Math.round(baseX - w / 2),
    sy: Math.round(baseY - h),
    sw: w,
    sh: h,
    baseX,
    baseY,
    phase: hash2(object.x, object.y, 97) * 9000,
    shadow: SHADOWS[object.kind] || null,
  };
}

// ---------- the world ----------

export function createWorld(canvas, {
  onPlaceClick = () => {},
  onCrewClick = () => {},
  onHover = () => {},
  onMiloMove = () => {},
  motion = () => true,
  startTile = null,
  scale: fixedScale = null,
} = {}) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const ctx = canvas.getContext('2d');
  const makeCanvas = (w, h) => {
    const c = doc.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const now = () => (win.performance ? win.performance.now() : Date.now());
  // The app's motion setting, and the system's reduced-motion preference as well.
  const reduced = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const motionOn = () => {
    if (reduced && reduced.matches) return false;
    try {
      return motion() !== false;
    } catch {
      return true;
    }
  };

  // Atlas: palette sprites plus composed fences.
  const atlas = buildAtlas(makeCanvas);
  for (const [name, rows] of Object.entries(FENCE_GRIDS)) {
    const c = makeCanvas(16, 16);
    const cctx = c.getContext('2d');
    const image = cctx.createImageData(16, 16);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const rgba = rgbaOf(ch);
      if (!rgba) return;
      image.data.set(rgba, (y * 16 + x) * 4);
    }));
    cctx.putImageData(image, 0, 0);
    atlas[name] = [c];
  }

  // Ground layer, baked once.
  const ground = makeCanvas(MAP_W, MAP_H);
  const gctx = ground.getContext('2d');
  const groundImage = gctx.createImageData(MAP_W, MAP_H);
  const types = paintGround(groundImage.data);
  gctx.putImageData(groundImage, 0, 0);
  const shimmer = shimmerSpots(types);

  // Shadow ellipses, cached by size.
  const shadowCache = new Map();
  function shadowCanvas(w, h) {
    const k = `${w}x${h}`;
    if (shadowCache.has(k)) return shadowCache.get(k);
    const c = makeCanvas(w, h);
    const cctx = c.getContext('2d');
    const image = cctx.createImageData(w, h);
    const rgba = rgbaOf('x');
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const nx = (x + 0.5 - w / 2) / (w / 2);
        const ny = (y + 0.5 - h / 2) / (h / 2);
        if (nx * nx + ny * ny <= 1) image.data.set(rgba, (y * w + x) * 4);
      }
    }
    cctx.putImageData(image, 0, 0);
    shadowCache.set(k, c);
    return c;
  }

  // Warm glow discs (stepped, pixel-art style).
  function glowCanvas(radius, alpha) {
    const k = `glow${radius}:${alpha}`;
    if (shadowCache.has(k)) return shadowCache.get(k);
    const size = radius * 2;
    const c = makeCanvas(size, size);
    const cctx = c.getContext('2d');
    const image = cctx.createImageData(size, size);
    const warm = rgbaOf('u');
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const d = Math.hypot(x + 0.5 - radius, (y + 0.5 - radius) * 1.6) / radius;
        if (d > 1) continue;
        const step = d < 0.45 ? 1 : d < 0.75 ? 0.62 : 0.32;
        image.data.set([warm[0], warm[1], warm[2], Math.round(255 * alpha * step)], (y * size + x) * 4);
      }
    }
    cctx.putImageData(image, 0, 0);
    shadowCache.set(k, c);
    return c;
  }

  // Fog bank over the harbor.
  const harbor = placeById('harbor');
  const FOG_CIRCLES = [
    [50.5, 37, 7.5], [46, 35.5, 5], [55.5, 35, 5.5], [53, 41, 6.5], [46.5, 41, 5], [59, 39, 5.5], [50, 33.5, 4],
  ];
  const fogBox = { x: (harbor.area.x - 3) * TILE, y: (harbor.area.y - 3) * TILE, w: (harbor.area.w + 6) * TILE, h: (harbor.area.h + 6) * TILE };
  const fogLayer = makeCanvas(fogBox.w, fogBox.h);
  {
    const fctx = fogLayer.getContext('2d');
    const image = fctx.createImageData(fogBox.w, fogBox.h);
    const tint = rgbaOf('c');
    for (let y = 0; y < fogBox.h; y += 1) {
      for (let x = 0; x < fogBox.w; x += 1) {
        const wx = (fogBox.x + x) / TILE;
        const wy = (fogBox.y + y) / TILE;
        let density = 0;
        for (const [cx, cy, r] of FOG_CIRCLES) {
          const d = Math.hypot(wx - cx, (wy - cy) * 1.15) / r;
          if (d < 1) density = Math.max(density, 1 - d);
        }
        if (density <= 0) continue;
        density += (smoothNoise(fogBox.x + x, fogBox.y + y, 22, 101) - 0.5) * 0.18 * Math.min(1, density * 4);
        if (density <= 0.05) continue;
        const a = density > 0.42 ? 0.58 : density > 0.2 ? 0.42 : 0.24;
        image.data.set([tint[0], tint[1], tint[2], Math.round(255 * a)], (y * fogBox.w + x) * 4);
      }
    }
    fctx.putImageData(image, 0, 0);
  }
  const fogPuffs = [
    { x: 0, y: 33.2, speed: 2.2 }, { x: 0.45, y: 36.5, speed: 1.6 }, { x: 0.2, y: 39.4, speed: 1.9 }, { x: 0.7, y: 41.8, speed: 1.4 }, { x: 0.85, y: 35, speed: 1.2 },
  ];

  // Props.
  const props = MAP.objects.map(placeObject);
  const perchStump = props.find((o) => o.kind === 'stump' && o.place === 'library');
  const tower = props.find((o) => o.kind === 'tower');
  const campfire = props.find((o) => o.kind === 'campfire');
  const cabin = props.find((o) => o.kind === 'cabin');
  const glowing = props.filter((o) => o.kind === 'lantern' || o.kind === 'lamp.post');
  // The fire, its log bench and the two stumps: where resting crew sit.
  const fireCircle = unionRect(props
    .filter((o) => o.place === 'camp' && ['campfire', 'log.bench', 'stump'].includes(o.kind))
    .map((o) => ({ x: o.sx, y: o.sy, w: o.sw, h: o.sh })));

  // ---------- state ----------

  const home = MAP.miloHome;
  const startAt = startTile && isWalkable(startTile.x, startTile.y) ? { x: startTile.x, y: startTile.y } : { ...home };
  const milo = {
    x: startAt.x * TILE + 8,
    y: startAt.y * TILE + FEET,
    tile: { ...startAt },
    dir: 'down',
    walk: null,
    stride: 0,
    queuedDir: null,
  };
  const held = new Set();
  const crew = new Map();
  let perched = { jev: null, whisper: null };
  let hoverTarget = null;
  let marker = null;
  let paused = false;
  let disposed = false;
  let wasMotion = motionOn();
  let lastTime = now();
  let frozenTime = lastTime;

  // canvas geometry
  let dpr = 1;
  let scale = 3;
  let viewW = 320;
  let viewH = 200;
  const buffer = makeCanvas(1, 1);
  const bctx = buffer.getContext('2d');
  const cam = { x: 0, y: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width || canvas.clientWidth || canvas.width);
    const cssH = Math.max(1, rect.height || canvas.clientHeight || canvas.height);
    dpr = win.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    let base = fixedScale || Math.max(2, Math.min(4, Math.floor(Math.min(cssW / (20 * TILE), cssH / (13 * TILE)))));
    // 4x only once the view still holds about 26 x 16 tiles, so a bigger window never shows less
    // of the world than the default one does at 3x.
    if (!fixedScale && base === 4 && (cssW < ROOMY_VIEW.w * TILE * 4 || cssH < ROOMY_VIEW.h * TILE * 4)) base = 3;
    scale = Math.max(1, Math.round(base * dpr));
    viewW = Math.ceil(canvas.width / scale);
    viewH = Math.ceil(canvas.height / scale);
    buffer.width = viewW + 1;
    buffer.height = viewH + 1;
    updateCamera(0, true);
    requestDraw();
  }

  // Screen edges covered by the shell's overlays (crew strip, open panel), in CSS px. The camera
  // centres on Milo inside what is left, so the overlays never sit on top of him or his camp.
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  function setInsets(next = {}) {
    let changed = false;
    for (const side of Object.keys(insets)) {
      const value = Number(next[side]);
      const clean = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
      if (clean !== insets[side]) {
        insets[side] = clean;
        changed = true;
      }
    }
    if (!changed) return;
    if (!shouldRun()) updateCamera(0, true);
    requestDraw();
  }

  function cameraTarget() {
    const unit = dpr / scale; // CSS px -> world px
    const top = insets.top * unit;
    const left = insets.left * unit;
    const freeW = Math.max(viewW / 3, viewW - left - insets.right * unit);
    const freeH = Math.max(viewH / 3, viewH - top - insets.bottom * unit);
    let x = milo.x - left - freeW / 2;
    // Tall things stand north of their feet (3/4 view), so look a little above Milo.
    let y = milo.y - CAMERA_LOOK_UP - top - freeH / 2;
    x = viewW >= MAP_W ? (MAP_W - viewW) / 2 : Math.max(0, Math.min(MAP_W - viewW, x));
    y = viewH >= MAP_H ? (MAP_H - viewH) / 2 : Math.max(0, Math.min(MAP_H - viewH, y));
    return { x, y };
  }

  function updateCamera(dt, snap = false) {
    const target = cameraTarget();
    if (snap || !motionOn()) {
      cam.x = target.x;
      cam.y = target.y;
      return;
    }
    const k = 1 - Math.pow(0.86, dt / FRAME_MS);
    cam.x += (target.x - cam.x) * k;
    cam.y += (target.y - cam.y) * k;
    if (Math.abs(target.x - cam.x) < 0.3) cam.x = target.x;
    if (Math.abs(target.y - cam.y) < 0.3) cam.y = target.y;
  }

  // ---------- crew ----------

  function artFor(id) {
    if (CREW_ART[id]) return CREW_ART[id];
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const i = h % HELPER_TINTS.length;
    return i === 0 ? 'helper' : `helper${i}`;
  }

  function slotPosition(kind, slot) {
    if (kind === 'work') return { x: slot.x * TILE + 8, y: (slot.y + 2) * TILE - 9 };
    if (kind === 'campfire') {
      if (slot.seat === 'bench') return { x: slot.x * TILE + 8 + (slot.dx || 0), y: (slot.y + 1) * TILE - 3 };
      return { x: slot.x * TILE + 8, y: (slot.y + 1) * TILE - 7 };
    }
    return { x: slot.x * TILE + 8, y: slot.y * TILE + FEET };
  }

  function setCrew(list) {
    const items = Array.isArray(list) ? list.filter((item) => item && typeof item.id === 'string') : [];
    perched = { jev: null, whisper: null };
    const people = [];
    for (const item of items) {
      if (PERCHED.has(item.id)) {
        perched[item.id] = item.state === 'offline' ? null : { ...item };
        continue;
      }
      people.push(item);
    }
    people.sort((a, b) => {
      const ia = CREW_ORDER.indexOf(a.id);
      const ib = CREW_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
    });
    const counters = { work: 0, waiting: 0, campfire: 0 };
    const seen = new Set();
    for (const item of people) {
      const kind = item.state === 'working' ? 'work' : item.state === 'needs-you' ? 'waiting' : item.state === 'done' || item.state === 'idle' ? 'campfire' : null;
      const slots = kind ? MAP.slots[kind] : null;
      const slot = slots ? slots[counters[kind]] : null;
      if (kind) counters[kind] += 1;
      if (!slot) continue;
      seen.add(item.id);
      const target = slotPosition(kind, slot);
      const existing = crew.get(item.id);
      if (!existing) {
        crew.set(item.id, {
          id: item.id, art: artFor(item.id), state: item.state, label: item.label || item.id, count: item.count || 0,
          kind, slot, x: target.x, y: target.y, target, path: [], phase: hash2(item.id.length, item.id.charCodeAt(0), 5) * 3000,
        });
        continue;
      }
      existing.state = item.state;
      existing.label = item.label || item.id;
      existing.count = item.count || 0;
      if (existing.kind !== kind || existing.slot !== slot) {
        existing.kind = kind;
        existing.slot = slot;
        existing.target = target;
        if (motionOn() && !paused) {
          const from = { x: Math.floor(existing.x / TILE), y: Math.floor(existing.y / TILE) };
          existing.path = findPath(from, { x: slot.x, y: slot.y }).map((p) => ({ x: p.x * TILE + 8, y: p.y * TILE + FEET }));
          existing.path.push(target);
        } else {
          existing.x = target.x;
          existing.y = target.y;
          existing.path = [];
        }
      }
    }
    for (const id of [...crew.keys()]) if (!seen.has(id)) crew.delete(id);
    requestDraw();
  }

  function updateCrew(dt) {
    for (const member of crew.values()) {
      if (member.path.length === 0) continue;
      let budget = (CREW_SPEED * dt) / 1000;
      while (budget > 0 && member.path.length > 0) {
        const next = member.path[0];
        const dx = next.x - member.x;
        const dy = next.y - member.y;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d <= budget) {
          member.x = next.x;
          member.y = next.y;
          member.path.shift();
          budget -= d;
        } else {
          // move along the larger axis first so walks stay grid-like
          if (Math.abs(dx) > 0) member.x += Math.sign(dx) * Math.min(budget, Math.abs(dx));
          else member.y += Math.sign(dy) * Math.min(budget, Math.abs(dy));
          budget = 0;
        }
      }
    }
  }

  // ---------- Milo movement ----------

  function finishWalk(arrived) {
    const walk = milo.walk;
    milo.walk = null;
    if (!walk) return;
    if (arrived && walk.face) milo.dir = walk.face;
    walk.resolve();
    if (arrived && walk.placeId) {
      try {
        onPlaceClick(walk.placeId);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function setTile(tile) {
    if (tile.x === milo.tile.x && tile.y === milo.tile.y) return;
    milo.tile = { x: tile.x, y: tile.y };
    try {
      onMiloMove({ x: tile.x, y: tile.y });
    } catch (error) {
      console.error(error);
    }
  }

  function faceToward(place) {
    const cx = place.area.x + place.area.w / 2;
    const cy = place.area.y + place.area.h / 2;
    const dx = cx - (place.door.x + 0.5);
    const dy = cy - (place.door.y + 0.5);
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  function snapWalk() {
    const walk = milo.walk;
    if (!walk) return;
    const last = walk.path[walk.path.length - 1];
    if (last) {
      milo.x = last.x * TILE + 8;
      milo.y = last.y * TILE + FEET;
      setTile(last);
    }
    walk.path = [];
    updateCamera(0, true);
    finishWalk(true);
  }

  function startWalk(dest, { placeId = null, face = null } = {}) {
    if (milo.walk) finishWalk(false);
    marker = null;
    return new Promise((resolve) => {
      const path = findPath(milo.tile, dest);
      milo.walk = { path, resolve, placeId, face };
      if (path.length === 0) {
        finishWalk(true);
        requestDraw();
        return;
      }
      if (!motionOn()) {
        snapWalk();
        requestDraw();
        return;
      }
      if (placeId === null && !face) marker = { x: path[path.length - 1].x, y: path[path.length - 1].y, at: now() };
      ensureLoop();
    });
  }

  function walkTo(target) {
    if (disposed) return Promise.resolve();
    if (typeof target === 'string') {
      const place = placeById(target);
      if (!place) return Promise.resolve();
      return startWalk(place.door, { face: faceToward(place) });
    }
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return Promise.resolve();
    return startWalk({ x: Math.round(target.x), y: Math.round(target.y) });
  }

  // Milo steps out of his tent and walks to where he was last (startTile), or home.
  function entrance() {
    if (disposed) return Promise.resolve();
    if (milo.walk) finishWalk(false);
    const door = MAP.tentDoor;
    const dest = startAt;
    if (!motionOn()) {
      milo.x = dest.x * TILE + 8;
      milo.y = dest.y * TILE + FEET;
      setTile(dest);
      milo.dir = 'down';
      updateCamera(0, true);
      requestDraw();
      return Promise.resolve();
    }
    milo.x = door.x * TILE + 8;
    milo.y = door.y * TILE + FEET;
    milo.tile = { ...door };
    milo.dir = 'down';
    updateCamera(0, true);
    return startWalk(dest, { face: 'down' });
  }

  function updateMilo(dt) {
    const walk = milo.walk;
    if (!walk) return;
    let budget = (MILO_SPEED * dt) / 1000;
    while (budget > 0 && walk.path.length > 0) {
      const next = walk.path[0];
      const tx = next.x * TILE + 8;
      const ty = next.y * TILE + FEET;
      const dx = tx - milo.x;
      const dy = ty - milo.y;
      if (dx !== 0) milo.dir = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) milo.dir = dy > 0 ? 'down' : 'up';
      const d = Math.abs(dx) + Math.abs(dy);
      if (d <= budget) {
        milo.x = tx;
        milo.y = ty;
        milo.stride += d;
        budget -= d;
        walk.path.shift();
        setTile(next);
        if (walk.path.length === 0 && walk.keyboard) {
          const dir = milo.queuedDir || [...held].pop();
          milo.queuedDir = null;
          if (dir) {
            const step = neighbour(dir);
            milo.dir = dir;
            if (isWalkable(step.x, step.y)) walk.path.push(step);
          }
        }
      } else {
        if (dx !== 0) milo.x += Math.sign(dx) * budget;
        else milo.y += Math.sign(dy) * budget;
        milo.stride += budget;
        budget = 0;
      }
    }
    if (walk.path.length === 0) finishWalk(true);
  }

  function neighbour(dir) {
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    return { x: milo.tile.x + d[0], y: milo.tile.y + d[1] };
  }

  function keyStep(dir) {
    if (milo.walk && milo.walk.keyboard) {
      milo.queuedDir = dir;
      return;
    }
    if (milo.walk) {
      // finish the current step, then follow the keys
      milo.walk.path = milo.walk.path.slice(0, 1);
      milo.walk.keyboard = true;
      milo.walk.placeId = null;
      milo.queuedDir = dir;
      return;
    }
    const step = neighbour(dir);
    milo.dir = dir;
    marker = null;
    if (!isWalkable(step.x, step.y)) {
      requestDraw();
      return;
    }
    if (!motionOn()) {
      milo.x = step.x * TILE + 8;
      milo.y = step.y * TILE + FEET;
      setTile(step);
      updateCamera(0, true);
      requestDraw();
      return;
    }
    milo.walk = { path: [step], resolve: () => {}, placeId: null, face: null, keyboard: true };
    ensureLoop();
  }

  // ---------- hit testing ----------

  // Buildings count as solid shapes; smaller props need a pixel within reach.
  const SOLID_HITS = new Set(['tower', 'cabin', 'tent', 'scaffold', 'boat']);
  function opaqueAt(name, frame, px, py, reach = 2) {
    if (SOLID_HITS.has(name)) return true;
    const rows = gridFor(name, frame);
    for (let dy = -reach; dy <= reach; dy += 1) {
      const row = rows[py + dy];
      if (!row) continue;
      for (let dx = -reach; dx <= reach; dx += 1) {
        const ch = row[px + dx];
        if (ch !== undefined && ch !== '.' && ch !== 'x') return true;
      }
    }
    return false;
  }

  function crewRect(member) {
    const rows = gridFor(`${member.art}.stand`);
    const w = rows[0].length;
    const h = rows.length;
    return { x: Math.round(member.x - w / 2), y: Math.round(member.y - h + 1), w, h };
  }

  function perchRect(id) {
    const pos = perchPosition(id);
    if (!pos) return null;
    const rows = gridFor(`${id}.idle`);
    return { x: pos.x, y: pos.y, w: rows[0].length, h: rows.length };
  }

  function perchPosition(id) {
    if (!perched[id]) return null;
    if (id === 'jev') return { x: MAP.slots.jev.px - 6, y: MAP.slots.jev.py - 9 };
    return { x: MAP.slots.whisper.px - 6, y: MAP.slots.whisper.py - 12 };
  }

  function hitTest(ax, ay) {
    const inRect = (r) => r && ax >= r.x - 1 && ay >= r.y - 1 && ax < r.x + r.w + 1 && ay < r.y + r.h + 1;
    const people = [...crew.values()].sort((a, b) => b.y - a.y);
    for (const member of people) if (inRect(crewRect(member))) return { kind: 'crew', id: member.id };
    for (const id of ['jev', 'whisper']) if (inRect(perchRect(id))) return { kind: 'crew', id };
    const front = props.filter((o) => o.place && ax >= o.sx && ay >= o.sy && ax < o.sx + o.sw && ay < o.sy + o.sh).sort((a, b) => b.baseY - a.baseY);
    for (const o of front) if (opaqueAt(o.sprite, 0, Math.floor(ax - o.sx), Math.floor(ay - o.sy))) return { kind: 'place', id: o.place };
    const tx = Math.floor(ax / TILE);
    const ty = Math.floor(ay / TILE);
    const place = placeAt(tx, ty);
    if (place) {
      const terrain = MAP.tiles[ty]?.[tx];
      if (terrain === TERRAIN.SOIL || place === 'harbor') return { kind: 'place', id: place };
    }
    return null;
  }

  function toArt(event) {
    const rect = canvas.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    return { cssX, cssY, ax: (cssX * dpr) / scale + Math.round(cam.x), ay: (cssY * dpr) / scale + Math.round(cam.y) };
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const { ax, ay } = toArt(event);
    const hit = hitTest(ax, ay);
    if (hit && hit.kind === 'crew') {
      try {
        onCrewClick(hit.id);
      } catch (error) {
        console.error(error);
      }
      return;
    }
    if (hit && hit.kind === 'place') {
      const place = placeById(hit.id);
      startWalk(place.door, { placeId: place.id, face: faceToward(place) });
      return;
    }
    const tx = Math.floor(ax / TILE);
    const ty = Math.floor(ay / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) return;
    startWalk({ x: tx, y: ty });
  }

  function onPointerMove(event) {
    const { ax, ay, cssX, cssY } = toArt(event);
    const hit = hitTest(ax, ay);
    canvas.style.cursor = hit ? 'pointer' : '';
    const changed = (hit?.kind || null) !== (hoverTarget?.kind || null) || (hit?.id || null) !== (hoverTarget?.id || null);
    hoverTarget = hit;
    if (hit) {
      try {
        onHover({ kind: hit.kind, id: hit.id, x: cssX, y: cssY });
      } catch (error) {
        console.error(error);
      }
    } else if (changed) {
      try {
        onHover(null);
      } catch (error) {
        console.error(error);
      }
    }
    if (changed) requestDraw();
  }

  function onPointerLeave() {
    if (hoverTarget) {
      hoverTarget = null;
      canvas.style.cursor = '';
      try {
        onHover(null);
      } catch (error) {
        console.error(error);
      }
      requestDraw();
    }
  }

  const KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const dir = KEY_DIRS[event.key];
    if (dir) {
      event.preventDefault();
      held.delete(dir);
      held.add(dir);
      if (!event.repeat || !milo.walk) keyStep(dir);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const place = PLACES.find((p) => p.door.x === milo.tile.x && p.door.y === milo.tile.y);
      if (place) {
        event.preventDefault();
        try {
          onPlaceClick(place.id);
        } catch (error) {
          console.error(error);
        }
      }
    }
  }

  function onKeyUp(event) {
    const dir = KEY_DIRS[event.key];
    if (dir) held.delete(dir);
  }

  function onBlur() {
    held.clear();
  }

  // ---------- drawing ----------

  function drawSprite(target, name, frame, x, y, alpha = 1) {
    const frames = atlas[name];
    if (!frames) return;
    const image = frames[frame % frames.length];
    if (alpha !== 1) {
      target.globalAlpha = alpha;
      target.drawImage(image, Math.round(x), Math.round(y));
      target.globalAlpha = 1;
    } else {
      target.drawImage(image, Math.round(x), Math.round(y));
    }
  }

  function objectFrame(o, t) {
    if (t === null) return 0;
    switch (o.kind) {
      case 'campfire': {
        const seq = [0, 1, 2, 1, 0, 2, 1, 2];
        return seq[Math.floor((t + o.phase) / 190) % seq.length];
      }
      case 'flag':
        return Math.floor((t + o.phase) / 900) % 2;
      case 'tree':
      case 'tree.blossom':
      case 'pine':
        return (t + o.phase) % 8200 < 420 ? 1 : 0;
      case 'reeds':
        return (t + o.phase) % 5200 < 600 ? 1 : 0;
      default:
        return 0;
    }
  }

  function crewDrawInfo(member, t) {
    const walking = member.path.length > 0;
    let name = `${member.art}.stand`;
    let frame = 0;
    let bob = 0;
    if (walking) {
      bob = t !== null && Math.floor(t / 150) % 2 === 0 ? -1 : 0;
    } else if (member.kind === 'work') {
      name = `${member.art}.work`;
      frame = t === null ? 0 : Math.floor((t + member.phase) / 320) % 2;
    } else if (t !== null) {
      frame = (t + member.phase) % 2600 < 900 ? 1 : 0;
    }
    const rows = gridFor(name);
    return { name, frame, x: member.x - rows[0].length / 2, y: member.y - rows.length + 1 + bob, w: rows[0].length, h: rows.length };
  }

  function miloDrawInfo(t) {
    const walking = !!milo.walk && milo.walk.path.length > 0;
    let name = `milo.${milo.dir}`;
    let frame = 0;
    let bob = 0;
    if (walking) {
      const seq = [1, 0, 2, 0];
      frame = seq[Math.floor(milo.stride / 5) % 4];
      bob = frame === 0 ? 0 : -1;
    } else if (t !== null && (t % 2400) > 1500) {
      name = `milo.breath.${milo.dir}`;
    }
    return { name, frame, x: Math.round(milo.x - 8), y: Math.round(milo.y - 19 + bob) };
  }

  function drawScene(target, cx, cy, vw, vh, t) {
    target.imageSmoothingEnabled = false;
    target.fillStyle = PALETTE.L.hex;
    target.fillRect(0, 0, vw + 1, vh + 1);
    target.save();
    target.translate(-cx, -cy);
    const sx = Math.max(0, cx);
    const sy = Math.max(0, cy);
    const sw = Math.min(MAP_W, cx + vw + 1) - sx;
    const sh = Math.min(MAP_H, cy + vh + 1) - sy;
    if (sw > 0 && sh > 0) target.drawImage(ground, sx, sy, sw, sh, sx, sy, sw, sh);
    const visible = (x, y, w, h) => x + w >= cx - 2 && y + h >= cy - 2 && x <= cx + vw + 2 && y <= cy + vh + 2;

    // water shimmer
    if (t !== null) {
      target.fillStyle = PALETTE.f.hex;
      for (const s of shimmer) {
        if (!visible(s.x, s.y, s.len, 1)) continue;
        const phase = (t + s.phase) % s.period;
        if (phase < s.period * 0.3) target.fillRect(s.x + (phase < s.period * 0.15 ? 0 : 1), s.y, s.len, 1);
      }
    }

    // shadows
    for (const o of props) {
      if (!o.shadow || !visible(o.sx, o.sy, o.sw, o.sh + 8)) continue;
      const [w, h, dy] = o.shadow;
      target.drawImage(shadowCanvas(w, h), Math.round(o.baseX - w / 2), Math.round(o.baseY - h / 2 + dy));
    }
    for (const member of crew.values()) target.drawImage(shadowCanvas(10, 3), Math.round(member.x - 5), Math.round(member.y - 1));
    target.drawImage(shadowCanvas(10, 3), Math.round(milo.x - 5), Math.round(milo.y - 1));

    // warm light from the fire and lanterns
    if (campfire && visible(campfire.baseX - 40, campfire.baseY - 40, 80, 80)) {
      const flicker = t === null ? 0 : Math.floor((t / 260) % 2);
      const r = 30 + flicker;
      target.drawImage(glowCanvas(r, 0.22), Math.round(campfire.baseX - r), Math.round(campfire.baseY - 6 - r));
    }
    for (const o of glowing) {
      if (!visible(o.sx - 12, o.sy - 12, o.sw + 24, o.sh + 24)) continue;
      target.drawImage(glowCanvas(12, 0.18), Math.round(o.baseX - 12), Math.round(o.sy + 4 - 12));
    }

    // hover ring on a place's door
    if (hoverTarget && hoverTarget.kind === 'place') {
      const place = placeById(hoverTarget.id);
      if (place) drawRing(target, place.door.x * TILE + 8, place.door.y * TILE + FEET, 'c');
    }
    if (marker && t !== null) {
      const age = t - marker.at;
      if (age < 900) drawRing(target, marker.x * TILE + 8, marker.y * TILE + FEET, 'c', 1 - age / 900);
      else marker = null;
    }

    // y-sorted sprites
    const drawables = [];
    for (const o of props) {
      if (!visible(o.sx, o.sy, o.sw, o.sh)) continue;
      drawables.push({ y: o.baseY, x: o.baseX, draw: () => drawSprite(target, o.sprite, objectFrame(o, t), o.sx, o.sy) });
    }
    for (const member of crew.values()) {
      const info = crewDrawInfo(member, t);
      if (!visible(info.x, info.y, info.w, info.h)) continue;
      drawables.push({ y: member.y, x: member.x, draw: () => drawSprite(target, info.name, info.frame, info.x, info.y) });
    }
    if (perched.jev && tower) {
      const pos = perchPosition('jev');
      const active = perched.jev.state === 'working';
      const period = active ? 2600 : 9000;
      const frame = t !== null && (t % period) < 320 ? 1 : 0;
      drawables.push({ y: tower.baseY + 1, x: pos.x, draw: () => drawSprite(target, 'jev.idle', frame, pos.x, pos.y - (frame ? 1 : 0)) });
    }
    if (perched.whisper && perchStump) {
      const pos = perchPosition('whisper');
      const frame = t !== null && ((t + 700) % 5200) < 200 ? 1 : 0;
      drawables.push({ y: perchStump.baseY + 1, x: pos.x, draw: () => drawSprite(target, 'whisper.idle', frame, pos.x, pos.y) });
    }
    const mi = miloDrawInfo(t);
    drawables.push({ y: milo.y + 0.5, x: milo.x, draw: () => drawSprite(target, mi.name, mi.frame, mi.x, mi.y) });
    drawables.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const d of drawables) d.draw();

    // a slow curl of smoke from the cabin chimney
    if (t !== null) {
      if (cabin) drawSmoke(target, cabin.sx + 36, cabin.sy - 2, t, 1300);
    }

    // needs-you bubbles
    for (const member of crew.values()) {
      if (member.kind !== 'waiting' || member.path.length > 0) continue;
      const info = crewDrawInfo(member, t);
      const bx = Math.round(member.x - 4);
      const by = Math.round(info.y - 9);
      drawSprite(target, 'bubble', 0, bx, by);
      const dots = t === null ? 3 : 1 + (Math.floor((t + member.phase) / 600) % 3);
      target.fillStyle = PALETTE.o.hex;
      for (let i = 0; i < dots; i += 1) target.fillRect(bx + 2 + i * 3, by + 2, 2, 2);
    }

    // harbor fog
    if (visible(fogBox.x, fogBox.y, fogBox.w, fogBox.h)) {
      target.drawImage(fogLayer, fogBox.x, fogBox.y);
      const span = fogBox.w + 40;
      for (const puff of fogPuffs) {
        const drift = t === null ? 0 : (t / 1000) * puff.speed;
        const x = fogBox.x - 40 + ((puff.x * span + drift) % span);
        drawSprite(target, 'fog', 0, x, puff.y * TILE - 6, 0.5);
      }
    }
    // Milo stays crisp when he walks into the fog.
    if (milo.x > fogBox.x && milo.x < fogBox.x + fogBox.w && milo.y > fogBox.y && milo.y < fogBox.y + fogBox.h) {
      drawSprite(target, mi.name, mi.frame, mi.x, mi.y);
    }
    target.restore();
  }

  function drawRing(target, x, y, key, alpha = 1) {
    target.globalAlpha = 0.85 * alpha;
    target.fillStyle = PALETTE[key].hex;
    const pts = [[-4, -1], [-3, -2], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [3, -1], [-4, 0], [3, 0], [-3, 1], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1]];
    for (const [dx, dy] of pts) target.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 1);
    target.globalAlpha = 1;
  }

  function drawSmoke(target, x, y, t, offset) {
    for (let i = 0; i < 3; i += 1) {
      const life = 3600;
      const age = (t + offset + i * (life / 3)) % life;
      const k = age / life;
      const px = x + Math.sin(k * 3.1 + i) * 2 + k * 5;
      const py = y - k * 22;
      drawSprite(target, 'smoke', 0, px, py, 0.5 * (1 - k));
    }
  }

  function draw(t) {
    if (disposed) return;
    const cx = Math.round(cam.x);
    const cy = Math.round(cam.y);
    drawScene(bctx, cx, cy, viewW, viewH, t);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, 0, 0, buffer.width, buffer.height, 0, 0, buffer.width * scale, buffer.height * scale);
  }

  // ---------- loop ----------

  let raf = 0;
  let staticPending = false;
  let lastFrame = 0;

  function shouldRun() {
    return !disposed && !paused && !doc.hidden && motionOn();
  }

  function tick(time) {
    raf = 0;
    if (!shouldRun()) {
      requestDraw();
      return;
    }
    raf = win.requestAnimationFrame(tick);
    if (time - lastFrame < FRAME_MS - 2) return;
    const dt = Math.min(100, time - lastFrame);
    lastFrame = time;
    lastTime = time;
    updateMilo(dt);
    updateCrew(dt);
    updateCamera(dt);
    draw(time);
  }

  function ensureLoop() {
    if (shouldRun()) {
      if (!raf) {
        lastFrame = now() - FRAME_MS;
        raf = win.requestAnimationFrame(tick);
      }
    } else {
      requestDraw();
    }
  }

  function requestDraw() {
    if (disposed) return;
    if (raf) return; // the running loop draws every frame
    if (shouldRun()) {
      ensureLoop();
      return;
    }
    if (staticPending) return;
    staticPending = true;
    const paint = () => {
      staticPending = false;
      draw(motionOn() ? frozenTime : null);
    };
    if (doc.hidden) {
      staticPending = false;
      return;
    }
    win.requestAnimationFrame(paint);
  }

  function settleForStillness() {
    if (milo.walk) snapWalk();
    for (const member of crew.values()) {
      if (member.path.length) {
        member.x = member.target.x;
        member.y = member.target.y;
        member.path = [];
      }
    }
    marker = null;
    updateCamera(0, true);
  }

  const watchdog = win.setInterval(() => {
    const on = motionOn();
    if (on === wasMotion) return;
    wasMotion = on;
    if (!on) settleForStillness();
    if (on) ensureLoop();
    else requestDraw();
  }, 400);

  function onVisibility() {
    if (doc.hidden) return;
    ensureLoop();
    requestDraw();
  }

  function setPaused(value) {
    paused = !!value;
    if (paused) {
      frozenTime = lastTime;
      if (raf) {
        win.cancelAnimationFrame(raf);
        raf = 0;
      }
      requestDraw();
    } else {
      ensureLoop();
    }
  }

  function dispose() {
    if (disposed) return;
    if (milo.walk) finishWalk(false);
    disposed = true;
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    win.clearInterval(watchdog);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('blur', onBlur);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('resize', resize);
  }

  function miloScreenPos() {
    const cx = Math.round(cam.x);
    const cy = Math.round(cam.y);
    return {
      x: ((milo.x - cx) * scale) / dpr,
      y: ((Math.round(milo.y) - 19 - cy) * scale) / dpr,
    };
  }

  // What a speech bubble should never cover, as CSS px rects within the canvas: Milo, every crew
  // member drawn in the world, and the campfire circle where resting crew sit.
  function keepClear() {
    const cx = Math.round(cam.x);
    const cy = Math.round(cam.y);
    const k = scale / dpr;
    const toScreen = (r, kind, id = null) => ({ kind, id, x: (r.x - cx) * k, y: (r.y - cy) * k, w: r.w * k, h: r.h * k });
    const rects = [toScreen({ x: Math.round(milo.x - 8), y: Math.round(milo.y) - 19, w: 16, h: 20 }, 'milo')];
    if (fireCircle) rects.push(toScreen(fireCircle, 'campfire'));
    for (const member of crew.values()) rects.push(toScreen(crewRect(member), 'crew', member.id));
    for (const id of ['jev', 'whisper']) {
      const rect = perchRect(id);
      if (rect) rects.push(toScreen(rect, 'crew', id));
    }
    return rects;
  }

  // Full-map render for previews and overviews.
  function renderMap(mapScale = 1, { time = null } = {}) {
    const full = makeCanvas(MAP_W, MAP_H);
    const fctx = full.getContext('2d');
    drawScene(fctx, 0, 0, MAP_W, MAP_H, time);
    if (mapScale === 1) return full;
    const out = makeCanvas(MAP_W * mapScale, MAP_H * mapScale);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(full, 0, 0, MAP_W * mapScale, MAP_H * mapScale);
    return out;
  }

  // ---------- wire up ----------

  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('resize', resize);
  resize();
  ensureLoop();

  return {
    setCrew,
    walkTo,
    entrance,
    miloScreenPos,
    keepClear,
    setInsets,
    setPaused,
    resize,
    dispose,
    miloTile: () => ({ x: milo.tile.x, y: milo.tile.y }),
    renderMap,
    get scale() {
      return scale / dpr;
    },
  };
}
