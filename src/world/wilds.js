// The wilds beyond Hearthvale's walls, at the vale's own scale (CONTRACT-PHASE3.md §3 and §7.1).
//
// createWilds({ worldgen }) turns worldgen's terrain into chunks Milo can walk through:
//   - ground painted pixel by pixel in palette key codes by a port of the vale's own painter
//     (engine.js paintGround: the same grass noise, lips, path and sand edges, water by distance
//     to shore and the same decals), so the seam at the vale's edge disappears, plus ground for
//     the regions (snow, basalt, rock, marsh, moor, the painted hills, downs, bridges, sky isles);
//   - objects placed by the vale's rules (map.js: canopies off roads, no two trees within a tile,
//     dx ±4 and dy ±2 of jitter), and points of interest with ids and their props;
//   - bridges as straight decks, square to their tiles, planked across the way over and railed;
//   - the Hush over the story's regions, with a narrow dithered edge, and the ring of thicket or
//     palisade round the vale, unbroken on land (worldgen keeps the ring land but for the bay);
//   - roads kept off that ring (worldgen keeps them clear; ringDetours guards it), which nav walks
//     too.
// Pure and deterministic from the seed; runs in Node and the renderer. Canvas work is the
// engine's. Heart pixels stay 0 (the vale draws itself) and the vale is never read for colour.
import { TILE, MAP, TERRAIN as VT, hash2, naturalAt, coastAt, beachAt, isWalkable as valeWalkable } from './map.js';
import { SPRITES, PALETTE } from './sprites.js';
import { PALISADE_CELL } from './scene-art.js';
import { CHUNK, HEART, GATES, TERRAIN as T, TERRAIN_INFO, layRoad } from './worldgen.js';
import { hashString, fbm } from './rng.js';

export const CHUNK_PX = CHUNK * TILE; // 512 art pixels a side
export const SLICE_ROWS = 64; // ground rows per idle slice
const CP = CHUNK_PX;
const MARGIN = 6; // tiles of terrain kept round a chunk (object rules look this far)
const WIN = CHUNK + 2 * MARGIN;

const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, n) => ((a % n) + n) % n;
const inHeart = (x, y) => x >= 0 && y >= 0 && x < HEART.w && y < HEART.h;

/** A fast integer hash of a tile (and a salt) as a number in [0, 1). */
function tileHash(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The vale's value noise (engine.js smoothNoise), unchanged, so its grass carries on outside.
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

// smoothNoise(x, Y, cell, seed) * weight for x = X0 .. X0 + n - 1 along one row, into out (added to
// what's there when add is set). Bit for bit the same values, but each cell's corners are hashed
// once rather than for every pixel.
function noiseRow(out, X0, n, Y, cell, seed, weight, add) {
  const gy = Math.floor(Y / cell);
  const fy = Y / cell - gy;
  const sy = fy * fy * (3 - 2 * fy);
  let gx = Math.floor(X0 / cell);
  let a = hash2(gx, gy, seed);
  let b = hash2(gx + 1, gy, seed);
  let c = hash2(gx, gy + 1, seed);
  let d = hash2(gx + 1, gy + 1, seed);
  for (let i = 0; i < n; i += 1) {
    const x = X0 + i;
    const g = Math.floor(x / cell);
    if (g !== gx) {
      gx = g;
      a = b;
      c = d;
      b = hash2(gx + 1, gy, seed);
      d = hash2(gx + 1, gy + 1, seed);
    }
    const fx = x / cell - g;
    const sx = fx * fx * (3 - 2 * fx);
    const v = (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * weight;
    out[i] = add ? out[i] + v : v;
  }
}

// ---------- the ring and the gates (§3) ----------

const GATE_LIST = Object.entries(GATES).map(([id, g]) => ({
  id, short: id.slice(5), x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y, dir: g.dir,
  side: g.dir.y < 0 ? 'n' : g.dir.y > 0 ? 's' : g.dir.x < 0 ? 'w' : 'e',
}));
const GATE_NAMES = { n: 'North gate', w: 'West gate', e: 'East gate', sw: 'South-west gate' };
// The three tiles beyond each gate tile stay clear, so every gate opens onto its road.
const BEYOND = new Set(GATE_LIST.flatMap((g) => [1, 2, 3].map((k) => `${g.x + g.dir.x * k},${g.y + g.dir.y * k}`)));
// How far along the wall from the north gate each Stockade banner may stand, in order of choice
// (three tiles leaves the gatehouse room), on the row just outside the wall or else the next one out.
const BANNER_OFF = [3, 4, 2, 5];
// Where the Gate Bell may stand, in order of choice: (along, out) from the north gate tile, a tile
// either side of the road and three rows out, where its 24 px post clears the palisade's 36 px stakes
// and the gatehouse's roof, or else a little further (bellSpot).
const BELL_SPOTS = [[-1, -3], [1, -3], [-2, -3], [2, -3], [-1, -4], [1, -4], [-2, -4], [2, -4], [-3, -3], [3, -3]];
const isGateTile = (x, y) => GATE_LIST.some((g) => g.x === x && g.y === y);

/**
 * A ring or wild object's sprite box in world px, as the engine places it (placeObject): the sprite
 * centred on its tiles' middle plus dx, its feet on their bottom edge plus dy. The palisade is its
 * composed 16×36 cell. { x0, y0, x1, y1 }, ends exclusive.
 */
export function spriteBox(kind, x, y, { w = 1, h = 1, dx = 0, dy = 0, frame = 0 } = {}) {
  const rows = kind === 'palisade' ? null : (SPRITES[kind] || [])[frame % Math.max(1, (SPRITES[kind] || []).length)];
  const sw = rows ? rows[0].length : PALISADE_CELL.w;
  const sh = rows ? rows.length : PALISADE_CELL.h;
  const sx = Math.round((x + w / 2) * TILE + dx - sw / 2);
  const baseY = (y + h) * TILE + dy;
  return { x0: sx, y0: baseY - sh, x1: sx + sw, y1: baseY };
}
/** Whether two sprite boxes ({ x0, y0, x1, y1 }, ends exclusive) share a pixel. */
export const boxesOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** 'gate' for the four gate tiles, 'wall' for every other tile of the ring round the vale, else null. */
export function ringKind(x, y) {
  if (x < -1 || y < -1 || x > HEART.w || y > HEART.h) return null;
  if (inHeart(x, y)) return null;
  return isGateTile(x, y) ? 'gate' : 'wall';
}
const isRing = (x, y) => x >= -1 && y >= -1 && x <= HEART.w && y <= HEART.h && !inHeart(x, y);
const besideGate = (x, y) => GATE_LIST.some((g) => Math.abs(g.x - x) + Math.abs(g.y - y) === 1);

// ---------- roads kept off the ring ----------

// Worldgen lays roads between points on a 4-tile grid, two tiles wide, and drops any tile inside
// the vale. It keeps them clear of the vale's walls and corners (a road only meets the vale at a
// gate), but should one ever run along the vale's edge, on the ring itself, where the wall would cut
// it, or cut a corner of the vale and lose the tiles in between, this guard moves it:
//   - a stretch of road that cuts a corner goes round it instead, by the tile two out from the
//     corner;
//   - every road or bridge on a wall tile goes back to the ground beneath it, and the road runs on
//     through the two tiles beyond (all round the corner at a corner).
// New road over water is a straight deck (worldgen.layRoad); none is laid over deep sea or sky. A
// road on a wall tile right beside a gate keeps its look (walls all the same), though worldgen lays
// a gate's own last tiles one lane wide (GATE_LANE), so its road never runs there. A pure function
// of worldgen, so the wilds and nav agree; worldgen.terrainAt itself doesn't know (paint maps from
// wilds' tiles).
const NEAR = { x0: -8, y0: -8, x1: HEART.w + 7, y1: HEART.h + 7 };
const NEAR_W = NEAR.x1 - NEAR.x0 + 1;
const LANES = [[0, 0], [1, 0], [0, 1]]; // how worldgen widens a road's line
const CORNERS = [[-2, -2], [HEART.w + 1, -2], [-2, HEART.h + 1], [HEART.w + 1, HEART.h + 1]];
const detourCache = new WeakMap();

// worldgen's own line (Bresenham between rounded points), so a bypass is laid as roads are.
function roadLine(a, b, visit) {
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    for (const [lx, ly] of LANES) visit(x0 + lx, y0 + ly);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * ringDetours(worldgen) → { at(x, y) → terrain | undefined, tiles: [{ x, y, terrain }] }: where the
 * wilds' terrain differs from worldgen's, so that no road runs on the ring's walls or through the
 * vale.
 */
export function ringDetours(worldgen) {
  const known = detourCache.get(worldgen);
  if (known) return known;
  const map = new Map();
  const decks = new Map(); // which way the moved road's decks run
  const near = (x, y) => x >= NEAR.x0 && y >= NEAR.y0 && x <= NEAR.x1 && y <= NEAR.y1;
  const wet = (x, y) => { if (inHeart(x, y)) return false; const t = worldgen.naturalTerrain(x, y); return t === T.RIVER || t === T.SEA; };
  const barred = (x, y, onLine) => { if (inHeart(x, y)) return onLine; const t = worldgen.naturalTerrain(x, y); return t === T.DEEP || t === T.SKY; };
  const keyOf = (x, y) => (y - NEAR.y0) * NEAR_W + (x - NEAR.x0);
  const roadish = (t) => t === T.ROAD || t === T.BRIDGE;
  const laid = []; // tiles the road should run on
  const walls = new Map(); // wall tiles a road runs on
  const onWall = (x, y) => { if (isRing(x, y) && !isGateTile(x, y)) walls.set(keyOf(x, y), [x, y]); };
  for (let x = -1; x <= HEART.w; x += 1) for (const y of [-1, HEART.h]) if (roadish(worldgen.terrainAt(x, y))) onWall(x, y);
  for (let y = 0; y < HEART.h; y += 1) for (const x of [-1, HEART.w]) if (roadish(worldgen.terrainAt(x, y))) onWall(x, y);
  // Stretches that cut a corner of the vale go round it (a gate's own first stretch starts on the
  // ring and is left alone).
  for (const p of worldgen.roads().paths) {
    for (let i = 1; i < p.points.length; i += 1) {
      if (i === 1 && GATES[p.from]) continue;
      const a = p.points[i - 1];
      const b = p.points[i];
      let cuts = false;
      roadLine(a, b, (x, y) => { if (inHeart(x, y)) cuts = true; });
      if (!cuts) continue;
      let best = null;
      for (const [x, y] of CORNERS) {
        const d = Math.hypot(x - a.x, y - a.y) + Math.hypot(b.x - x, b.y - y);
        if (!best || d < best.d) best = { x, y, d };
      }
      if (best.d > Math.hypot(b.x - a.x, b.y - a.y) * 2.5 + 4) continue; // not a corner: leave it
      // laid as worldgen lays its roads, crossing water on straight decks
      layRoad([a, best, b], { wet, barred }, (x, y, deck) => {
        if (inHeart(x, y) || !near(x, y)) return;
        if (isRing(x, y)) onWall(x, y);
        else laid.push([x, y, deck, true]);
      });
    }
  }
  // Roads on the wall: back to the ground there, and on through the two tiles beyond (a deck over
  // water there runs along the wall).
  for (const [x, y] of walls.values()) {
    if (!besideGate(x, y)) map.set(keyOf(x, y), worldgen.naturalTerrain(x, y));
    const ox = x < 0 ? -1 : x >= HEART.w ? 1 : 0;
    const oy = y < 0 ? -1 : y >= HEART.h ? 1 : 0;
    if (ox && oy) {
      for (let a = 0; a <= 2; a += 1) for (let b = 0; b <= 2; b += 1) if (a || b) laid.push([x + a * ox, y + b * oy, 'x', false]);
    } else {
      for (let k = 1; k <= 2; k += 1) laid.push([x + k * ox, y + k * oy, oy ? 'ew' : 'ns', false]);
    }
  }
  for (const [x, y, deck, squared] of laid) {
    const k = keyOf(x, y);
    if (!near(x, y) || map.has(k)) continue;
    const t = worldgen.terrainAt(x, y);
    if (roadish(t) || t === T.DEEP || t === T.SKY) continue;
    // over water it's a deck; a deck squared off onto the bank is deck there too
    const bridge = t === T.RIVER || t === T.SEA || (squared && deck);
    map.set(k, bridge ? T.BRIDGE : T.ROAD);
    if (bridge && deck) decks.set(k, deck);
  }
  const tiles = [...map].map(([k, terrain]) => ({ x: (k % NEAR_W) + NEAR.x0, y: Math.floor(k / NEAR_W) + NEAR.y0, terrain }))
    .sort((p, q) => p.y - q.y || p.x - q.x);
  const out = {
    tiles,
    at(x, y) {
      if (x < NEAR.x0 || y < NEAR.y0 || x > NEAR.x1 || y > NEAR.y1 || !map.size) return undefined;
      return map.get((y - NEAR.y0) * NEAR_W + (x - NEAR.x0));
    },
    /** Which way a moved road's deck runs at a tile ('ns', 'ew', or 'x' where it turns), or undefined. */
    deckAt(x, y) {
      if (x < NEAR.x0 || y < NEAR.y0 || x > NEAR.x1 || y > NEAR.y1) return undefined;
      return decks.get((y - NEAR.y0) * NEAR_W + (x - NEAR.x0));
    },
  };
  detourCache.set(worldgen, out);
  return out;
}

// ---------- the Hush ----------

const GREY_PULL = 0.55;
const LIFT = 0.06;
function hushColour([r, g, b]) {
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r, g, b].map((c) => {
    const pulled = c + (grey - c) * GREY_PULL;
    return Math.max(0, Math.min(255, Math.round(pulled + (255 - pulled) * LIFT)));
  });
}
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * The hush palette: every base colour pulled 55% toward its own grey and lifted 6%. `base` may
 * be a by-code array (wildsart.basePaletteByCode()), a { key: [r, g, b] } object, or omitted for
 * the world palette; the result has the same shape (an object keyed by palette key by default).
 */
export function hushPalette(base) {
  if (Array.isArray(base)) return base.map((rgb) => (rgb ? hushColour(rgb) : rgb));
  const src = base || paletteRgb();
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    const rgb = Array.isArray(value) ? value : value && typeof value.hex === 'string' && value.hex.startsWith('#') ? hexRgb(value.hex) : null;
    if (rgb) out[key] = hushColour(rgb);
  }
  return out;
}
let paletteByKey = null;
function paletteRgb() {
  if (paletteByKey) return paletteByKey;
  paletteByKey = {};
  for (const [key, entry] of Object.entries(PALETTE)) if (entry.hex.startsWith('#')) paletteByKey[key] = hexRgb(entry.hex);
  return paletteByKey;
}

// ---------- colouring a chunk (§7.1) ----------

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const codeCache = new WeakMap();
function byCode(palette) {
  if (!palette) return null;
  if (Array.isArray(palette)) return palette;
  if (codeCache.has(palette)) return codeCache.get(palette);
  const out = [];
  for (const [key, value] of Object.entries(palette)) {
    const rgb = Array.isArray(value) ? value : value && typeof value.hex === 'string' && value.hex.startsWith('#') ? hexRgb(value.hex) : null;
    if (rgb) out[key.charCodeAt(0)] = rgb;
  }
  codeCache.set(palette, out);
  return out;
}

/**
 * Key codes to RGBA. Hushed tiles (hushMask, 0..255 per tile, faded bilinearly between tile
 * centres) take the hush palette and rift bleeds override both: bleeds are wildsart.colourise
 * bleeds ({ x, y in chunk-local px, inner, outer, palette by code, wobble?, seed? }). Every fade
 * is dithered in 2x2 blocks indexed by world pixels (originX + x), so nothing swims as the view
 * moves and chunks meet without a seam. Heart pixels (0) stay transparent.
 * Options from/to (rows) and out allow slicing; width defaults to a chunk's 512. tileSize (16)
 * says how many pixels a tile of the hush mask spans, so map art at 4 px a tile colours the same.
 */
export function colouriseChunk(keys, { base, hush = null, hushMask = null, bleeds = [], originX = 0, originY = 0, width = CP, tileSize = TILE, from = 0, to = null, out = null } = {}) {
  const height = Math.floor(keys.length / width);
  const end = Math.min(height, to == null ? height : to);
  const rgba = out || new Uint8ClampedArray(width * height * 4);
  const B = byCode(base) || byCode(paletteRgb());
  const H = hush ? byCode(hush) : null;
  const tilesW = Math.ceil(width / tileSize);
  const tilesH = Math.ceil(height / tileSize);
  const wide = hushMask && hushMask.wide && hushMask.wide.length === (tilesW + 2) * (tilesH + 2) ? hushMask.wide : null;
  const maskAt = (tx, ty) => {
    if (wide) {
      const i = Math.max(-1, Math.min(tilesW, tx)) + 1;
      const j = Math.max(-1, Math.min(tilesH, ty)) + 1;
      return wide[j * (tilesW + 2) + i];
    }
    return hushMask[Math.max(0, Math.min(tilesH - 1, ty)) * tilesW + Math.max(0, Math.min(tilesW - 1, tx))];
  };
  // A chunk clear of the Hush itself still fades in from a hushed neighbour (its wide border).
  const hushed = H && hushMask && (wide || hushMask).some((v) => v > 0);
  const specs = (bleeds || []).filter(Boolean).map((b) => {
    const wobble = b.wobble || 0;
    const reach = b.outer + wobble / 2;
    return { ...b, wobble, reach, palette: byCode(b.palette), x0: b.x - reach, x1: b.x + reach, y0: b.y - reach, y1: b.y + reach };
  });
  const active = [];
  for (let by = from - mod(from, 2); by < end; by += 2) {
    const wy = originY + by;
    const bayerRow = BAYER[(wy >> 1) & 3];
    for (let bx = 0; bx < width; bx += 2) {
      const wx = originX + bx;
      let palette = B;
      if (hushed) {
        // bilinear between tile centres, in the tile grid of this chunk
        const u = (bx + 1) / tileSize - 0.5;
        const v = (by + 1) / tileSize - 0.5;
        const i = Math.floor(u);
        const j = Math.floor(v);
        const fu = u - i;
        const fv = v - j;
        const a = maskAt(i, j);
        const b = maskAt(i + 1, j);
        const c = maskAt(i, j + 1);
        const d = maskAt(i + 1, j + 1);
        const s = (a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv) / 255;
        if (s >= 0.999 || (s > 0 && (bayerRow[(wx >> 1) & 3] + 0.5) / 16 < s)) palette = H;
      }
      if (specs.length) {
        active.length = 0;
        const px = bx + 1;
        const py = by + 1;
        for (const spec of specs) {
          if (px < spec.x0 || px > spec.x1 || py < spec.y0 || py > spec.y1) continue;
          const raw = Math.hypot(px - spec.x, py - spec.y);
          if (raw > spec.reach) continue;
          const d = spec.wobble ? raw + (fbm((wx + 1) / 13, (wy + 1) / 13, spec.seed || 0, { octaves: 2 }) - 0.5) * spec.wobble : raw;
          const s = d <= spec.inner ? 1 : d >= spec.outer ? 0 : (spec.outer - d) / (spec.outer - spec.inner);
          if (s >= 1 || (s > 0 && (bayerRow[(wx >> 1) & 3] + 0.5) / 16 < s)) active.push(spec);
        }
        if (active.length) palette = active.length === 1 ? active[0].palette : active[mod((wx >> 1) + (wy >> 1), active.length)].palette;
      }
      for (let dy = 0; dy < 2; dy += 1) {
        const y = by + dy;
        if (y < from || y >= end) continue;
        for (let dx = 0; dx < 2; dx += 1) {
          const x = bx + dx;
          if (x >= width) continue;
          const p = y * width + x;
          const code = keys[p];
          if (!code) continue;
          const rgb = palette[code] || B[code];
          if (!rgb) continue;
          const o = p * 4;
          rgba[o] = rgb[0];
          rgba[o + 1] = rgb[1];
          rgba[o + 2] = rgb[2];
          rgba[o + 3] = 255;
        }
      }
    }
  }
  return rgba;
}

// ---------- ground classes ----------

// Pixel classes. The first five match engine.js (T_GRASS..T_SOIL) so the vale's rules port as is.
const G_GRASS = 0;
const G_PATH = 1;
const G_WATER = 2;
const G_SAND = 3;
const G_SOIL = 4;
const G_SNOW = 5;
const G_BASALT = 6;
const G_ROCK = 7;
const G_MOOR = 8;
const G_PAINTED = 9;
const G_BRIDGE = 10;
const G_MARSH = 11;
const G_DOWNS = 12;
const G_SKY = 13;
const G_UNDER = 14; // the rock underside of a sky isle, hanging over the sea
const G_VALE = 255;

const GROUND_OF = new Uint8Array(32).fill(G_GRASS);
GROUND_OF[T.DEEP] = G_WATER;
GROUND_OF[T.SEA] = G_WATER;
GROUND_OF[T.RIVER] = G_WATER;
GROUND_OF[T.SAND] = G_SAND;
GROUND_OF[T.MARSH] = G_MARSH;
GROUND_OF[T.PAINTED] = G_PAINTED;
GROUND_OF[T.ROCK] = G_ROCK;
GROUND_OF[T.MOUNTAIN] = G_ROCK;
GROUND_OF[T.SNOW] = G_SNOW;
GROUND_OF[T.BASALT] = G_BASALT;
GROUND_OF[T.MOOR] = G_MOOR;
GROUND_OF[T.ROAD] = G_PATH;
GROUND_OF[T.BRIDGE] = G_BRIDGE;
GROUND_OF[T.SKY] = G_SKY;
GROUND_OF[T.DOWNS] = G_DOWNS;
GROUND_OF[T.HEART] = G_VALE;

// Classes that never make a path's edge (the vale: only grass and soil do; here any land does).
const FLAT = new Uint8Array(16);
for (const g of [G_PATH, G_SAND, G_WATER, G_BRIDGE, G_UNDER]) FLAT[g] = 1;
// Classes under which the grass above gets its darker lip (the vale: path, soil, sand).
const LIPPED = new Uint8Array(16);
for (const g of [G_PATH, G_SOIL, G_SAND, G_BRIDGE]) LIPPED[g] = 1;
const WATERY = new Uint8Array(16);
for (const g of [G_WATER, G_BRIDGE, G_UNDER]) WATERY[g] = 1;

const WATER_T = new Set([T.DEEP, T.SEA, T.RIVER]);
const ROADISH = (t) => t === T.ROAD || t === T.BRIDGE;

// ---------- the vale's own pixels, for the seam (a port of engine.js terrainPixels) ----------

const VALE_CODE = { '.': G_GRASS, '=': G_PATH, '~': G_WATER, ',': G_SAND, ':': G_SOIL, '#': G_WATER };
const CORNER_RADIUS = [6, 6, 6, 6, 3];
function valeTileCode(tx, ty) {
  const x = Math.max(0, Math.min(MAP.width - 1, tx));
  const y = Math.max(0, Math.min(MAP.height - 1, ty));
  return VALE_CODE[MAP.tiles[y][x]];
}
const valeTiles = new Map();
/** The vale's pixel classes for one of its tiles (256, row-major), exactly as the engine paints them. */
function valeTilePixels(tx, ty) {
  const k = ty * MAP.width + tx;
  let px = valeTiles.get(k);
  if (px) return px;
  px = new Uint8Array(TILE * TILE);
  const t = valeTileCode(tx, ty);
  const ch = MAP.tiles[ty][tx];
  if (ch === VT.GRASS || ch === VT.SAND || ch === VT.WATER) {
    for (let ly = 0; ly < TILE; ly += 1) {
      for (let lx = 0; lx < TILE; lx += 1) {
        const nat = naturalAt((tx * TILE + lx + 0.5) / TILE, (ty * TILE + ly + 0.5) / TILE);
        px[ly * TILE + lx] = nat === VT.WATER ? G_WATER : nat === VT.SAND ? G_SAND : G_GRASS;
      }
    }
  } else {
    const r = CORNER_RADIUS[t];
    for (let ly = 0; ly < TILE; ly += 1) {
      for (let lx = 0; lx < TILE; lx += 1) {
        let v = t;
        const sx = lx < 8 ? -1 : 1;
        const sy = ly < 8 ? -1 : 1;
        const a = valeTileCode(tx + sx, ty);
        const b = valeTileCode(tx, ty + sy);
        if (a !== t && b !== t) {
          const dx = lx < 8 ? lx : 15 - lx;
          const dy = ly < 8 ? ly : 15 - ly;
          if (dx < r && dy < r) {
            const ex = r - dx - 0.5;
            const ey = r - dy - 0.5;
            if (ex * ex + ey * ey > r * r) {
              const c = valeTileCode(tx + sx, ty + sy);
              v = c === a || c === b ? c : a;
            }
          }
        }
        px[ly * TILE + lx] = v;
      }
    }
  }
  valeTiles.set(k, px);
  return px;
}
// Basalt column centres (one jittered point per cell) over a pixel rectangle.
const BASALT_CELL = 13;
function basaltCells(px, py, w, h) {
  const C = BASALT_CELL;
  const gx0 = floorDiv(px, C) - 1;
  const gy0 = floorDiv(py, C) - 1;
  const gw = floorDiv(px + w, C) - gx0 + 2;
  const gh = floorDiv(py + h, C) - gy0 + 2;
  const fx = new Float32Array(gw * gh);
  const fy = new Float32Array(gw * gh);
  const hs = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j += 1) {
    for (let i = 0; i < gw; i += 1) {
      const cx = gx0 + i;
      const cy = gy0 + j;
      const hx = hash2(cx, cy, 201);
      fx[j * gw + i] = (cx + 0.15 + hx * 0.7) * C;
      fy[j * gw + i] = (cy + 0.15 + hash2(cx, cy, 203) * 0.7) * C;
      hs[j * gw + i] = hx;
    }
  }
  return { gx0, gy0, gw, fx, fy, h: hs };
}
// How dry the marsh's clearings leave each pixel of a window (world px from PX0, PY0; W x H), 0..1,
// into buf (cleared first), or null when none reaches it. rects: [x0, y0, x1, y1, inner, reach] in
// world px; dry within inner px of the rect, fading to nothing by reach.
function dryField(rects, PX0, PY0, W, H, buf) {
  let out = null;
  for (const [x0, y0, x1, y1, inner, reach] of rects) {
    const bx0 = Math.max(0, Math.floor(x0 - reach) - PX0);
    const bx1 = Math.min(W, Math.ceil(x1 + reach) - PX0);
    const by0 = Math.max(0, Math.floor(y0 - reach) - PY0);
    const by1 = Math.min(H, Math.ceil(y1 + reach) - PY0);
    if (bx0 >= bx1 || by0 >= by1) continue;
    if (!out) {
      out = buf;
      out.fill(0, 0, W * H);
    }
    for (let py = by0; py < by1; py += 1) {
      const Y = PY0 + py + 0.5;
      const dy = Y < y0 ? y0 - Y : Y > y1 ? Y - y1 : 0;
      for (let px = bx0; px < bx1; px += 1) {
        const X = PX0 + px + 0.5;
        const dx = X < x0 ? x0 - X : X > x1 ? X - x1 : 0;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= reach) continue;
        const v = d <= inner ? 1 : 1 - (d - inner) / (reach - inner);
        const i = py * W + px;
        if (v > out[i]) out[i] = v;
      }
    }
  }
  return out;
}
// A vale grass tile with only grass round it is grass to the last pixel (shores never reach it).
function plainValeGrass(tx, ty) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) continue;
      if (MAP.tiles[y][x] !== VT.GRASS) return false;
    }
  }
  return true;
}
// Where the vale meets the bay (its south and east edges), the vale's own coast is analytic
// (map.js coastAt, beachAt). The ring round it is painted as the vale's own ground (its beach, and
// water or land as worldgen says, so a wall tile's thicket stands dry and a bay tile is all water);
// just outside the ring the wild shore fields lean toward that same coast and let go of it over
// BAY_BLEND px, so the two coastlines join with no seam.
const BAY_BLEND = 40;
// West of x 23 the vale's coast (map.js coastAt) has left the vale for good, a step down past its
// south edge; the shore the ring and the wilds lean to carries on from it down to the south-west
// instead, VALE_COAST_SLOPE tiles lower for every tile west, as the wild shore runs there.
const VALE_COAST_WEST = 23;
const VALE_COAST_SLOPE = 1;
function valeCoast(x) {
  return x >= VALE_COAST_WEST ? coastAt(x) : coastAt(VALE_COAST_WEST) + (VALE_COAST_WEST - x) * VALE_COAST_SLOPE;
}
// (A lake or river never runs along the vale's land edge: worldgen keeps the ring a bank there, so
// the wall stands on land all round and only the bay's water carries on through it.)
// Bridge decks: which edges of a deck tile are railed (deckShut in paintRows).
const DECK_N = 1;
const DECK_S = 2;
const DECK_W = 4;
const DECK_E = 8;
// Marsh pools: wherever the pool field (poolNoise) is over POOL is water. They keep out of
// clearings round points of interest and their props (dry 1 inside, fading to 0), so nothing
// stands in a pool:
//   - fixed points of interest (lanterns, landmarks, statues): the 3x3 tiles round the tile, plus
//     DRY_FIXED, which covers wherever the prop stands;
//   - a chunk's own points of interest and their props' footprints: the tiles plus DRY_LOCAL.
// A prop's footprint is firm ground besides (FIRM): the soft shore of a lake or river beside it
// keeps back by as much, so a statue on a spit of land stands on it, plinth and all. Painting reads
// the clearings of any neighbouring chunk whose own could reach its window, so chunks agree.
// Each pool is a blob round a centre (poolAt, in createWilds): one to a cell of POOL_CELL px in
// POOL_CHANCE of the cells, jittered, and only where the marsh runs at least two tiles all round
// it. Blobs add up where they meet, so neighbours merge into one pool, and a little noise ruffles
// the shore. So a pool is whole and a good two tiles across or not there at all: never a stray
// speck, never cut straight by the marsh's edge. Near that edge they round off (MARSH_EDGE).
const POOL = 0.5;
const POOL_CELL = 28;
const POOL_CHANCE = 0.24;
const POOL_R = [24, 38]; // a blob's reach, px (its pool is about half as wide)
const MARSH_EDGE = 0.5; // how much more a pool needs at the marsh's very edge
const POOL_OPEN = 5; // px: the narrowest a pool may be anywhere
const DRY_FIXED = [4, 14]; // [fully dry within, gone by] px
const DRY_LOCAL = [4, 12];
const FIRM = [6, 12];

// A binary mask opened by a size x size square (erode, then dilate): every pixel of it that some
// whole square fits round. In place of buf.core; buf.sum is the running sum it needs.
function open(mask, W, H, size, buf) {
  const S = buf.sum;
  const SW = W + 1;
  const integrate = (m) => {
    S.fill(0, 0, SW);
    for (let y = 0; y < H; y += 1) {
      let run = 0;
      S[(y + 1) * SW] = 0;
      for (let x = 0; x < W; x += 1) {
        run += m[y * W + x];
        S[(y + 1) * SW + x + 1] = S[y * SW + x + 1] + run;
      }
    }
  };
  const box = (x0, y0) => S[(y0 + size) * SW + x0 + size] - S[y0 * SW + x0 + size] - S[(y0 + size) * SW + x0] + S[y0 * SW + x0];
  // squares that fit wholly in the mask, by their top-left corner
  integrate(mask);
  const fits = buf.core.fill(0, 0, W * H);
  const full = size * size;
  for (let y = 0; y + size <= H; y += 1) for (let x = 0; x + size <= W; x += 1) if (box(x, y) === full) fits[y * W + x] = 1;
  // and every pixel one of them covers
  integrate(fits);
  const out = mask; // reuse: a pixel is kept only if it was in the mask anyway
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = y * W + x;
      if (!out[p]) continue;
      const x0 = Math.max(0, x - size + 1);
      const y0 = Math.max(0, y - size + 1);
      const x1 = Math.min(W - 1, x);
      const y1 = Math.min(H - 1, y);
      const n = S[(y1 + 1) * SW + x1 + 1] - S[y0 * SW + x1 + 1] - S[(y1 + 1) * SW + x0] + S[y0 * SW + x0];
      if (!n) out[p] = 0;
    }
  }
  return out;
}

// The Hush's edge: HUSH_BAND tiles wide in all, measured by each tile's distance to the region's
// edge, looked for as far as HUSH_REACH tiles (HUSH_RING: the offsets, nearest first).
const HUSH_BAND = 3;
const HUSH_REACH = 3;
// A pocket of this many tiles or fewer shut in by the other side of a region's edge goes with what's
// round it (inHush): about four by four.
const HUSH_POCKET = 16;
const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const HUSH_RING = [];
for (let dy = -HUSH_REACH; dy <= HUSH_REACH; dy += 1) for (let dx = -HUSH_REACH; dx <= HUSH_REACH; dx += 1) if (dx || dy) HUSH_RING.push([dx, dy, Math.hypot(dx, dy)]);
HUSH_RING.sort((a, b) => a[2] - b[2]);

const inBayZone = (tx, ty) => ty >= 28 && tx >= 16 && tx <= MAP.width + 3 && ty <= MAP.height + 3;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function valeShore(X, Y) {
  // how far outside the ring this pixel is (0 on the ring itself: it's the vale's own ground), and
  // the vale's coast fields there
  const dx = X < -TILE ? -TILE - X : X >= (MAP.width + 1) * TILE ? X - (MAP.width + 1) * TILE + 1 : 0;
  const dy = Y < -TILE ? -TILE - Y : Y >= (MAP.height + 1) * TILE ? Y - (MAP.height + 1) * TILE + 1 : 0;
  const d = Math.hypot(dx, dy);
  if (d >= BAY_BLEND) return null;
  const t = d / BAY_BLEND;
  const lam = 1 - t * t * (3 - 2 * t);
  const xt = (X + 0.5) / TILE;
  const yt = (Y + 0.5) / TILE;
  const coast = valeCoast(xt);
  return { lam, wet: clamp01(0.5 + (yt - coast) * 3), sand: clamp01(0.5 + (yt - (coast - beachAt(xt))) * 3) };
}
// Only the vale's outer two tiles can touch a wild pixel's neighbourhood; deeper in, it's grass.
const nearValeEdge = (tx, ty) => tx < 2 || ty < 2 || tx >= MAP.width - 2 || ty >= MAP.height - 2;

// ---------- objects (§7.1) ----------

// One candidate kind per tile. Tall kinds keep their canopies off roads.
const K_NONE = 0;
const KINDS = ['', 'tree', 'tree.blossom', 'tree.birch', 'pine', 'pine.snow', 'bush', 'bush.berry', 'rock', 'rock.basalt', 'basalt.column', 'dice.stone', 'reeds'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const TALL = new Uint8Array(KINDS.length);
for (const k of ['tree', 'tree.blossom', 'tree.birch', 'pine', 'pine.snow', 'basalt.column']) TALL[K[k]] = 1;
const NON_BLOCKING = new Uint8Array(KINDS.length);
NON_BLOCKING[K.reeds] = 1;
const WOOD = { tree: 'ash', 'tree.blossom': 'ash', 'tree.birch': 'birch', pine: 'pine', 'pine.snow': 'pine' };
const TREE_LABEL = { tree: 'Ash tree · chop', 'tree.blossom': 'Blossom tree · chop', 'tree.birch': 'Birch tree · chop', pine: 'Pine · chop', 'pine.snow': 'Snowy pine · chop' };

// Roll thresholds by terrain: [kind, cumulative chance], checked in order.
const DENSITY = {
  [T.FOREST]: [['tree', 0.8], ['bush', 0.84]],
  [T.BIRCH]: [['tree.birch', 0.78], ['bush', 0.81]],
  [T.PINE]: [['pine', 0.92], ['rock', 0.935]],
  [T.GRASS]: [['bush', 0.022], ['bush.berry', 0.03], ['rock', 0.042]],
  [T.MEADOW]: [['bush', 0.016], ['rock', 0.024]],
  [T.DOWNS]: [['dice.stone', 0.03], ['bush', 0.045]],
  [T.ROCK]: [['rock', 0.14]],
  [T.SNOW]: [['pine.snow', 0.08]],
  [T.BASALT]: [['basalt.column', 0.1], ['rock.basalt', 0.17]],
  [T.MARSH]: [['reeds', 0.2], ['bush', 0.22]],
  [T.MOOR]: [['rock', 0.035], ['bush', 0.055]],
  [T.PAINTED]: [['bush', 0.018]],
};

// How each point of interest stands: its sprite, footprint (tiles) and where the footprint may
// sit relative to the POI's own tile, which is where Milo stands and never blocks.
const ADJ = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const WIDE2 = [[-1, -1], [0, -1], [-2, 0], [1, 0], [-1, 1], [0, 1], [-2, -1], [1, -1], [-2, 1], [1, 1]];
const HOUSE = [[-1, -2], [-2, -2], [0, -2], [-3, -1], [1, -1], [-1, 1], [-2, 1], [0, 1]];
const POI_ART = {
  lantern: { kind: 'lantern.post', w: 1, h: 1, blocks: true, spots: ADJ },
  landmark: { kind: 'landmark.stone', w: 1, h: 1, blocks: true, spots: ADJ },
  statue: { kind: 'statue', w: 1, h: 1, blocks: true, spots: ADJ },
  ruin: { kind: 'ruin', w: 2, h: 1, blocks: true, spots: WIDE2 },
  cave: { kind: 'cave', w: 2, h: 1, blocks: true, spots: WIDE2 },
  chest: { kind: 'chest', w: 1, h: 1, blocks: true, spots: ADJ },
  note: { kind: 'note', w: 1, h: 1, blocks: false, spots: ADJ },
  hamlet: { kind: 'hamlet', w: 3, h: 2, blocks: true, spots: HOUSE },
  ore: { kind: 'ore.node', w: 1, h: 1, blocks: true, spots: ADJ },
  herbs: { kind: 'herbs', w: 1, h: 1, blocks: false, spots: ADJ },
  fishing: { kind: 'fishing.spot', w: 1, h: 1, blocks: false, spots: ADJ, water: true },
};
const FLOWERS = ['flower.pink', 'flower.butter', 'flower.lavender', 'flower.cream'];
const RESOURCE_NAMES = { ore: 'An ore seam', herbs: 'Wild herbs', fishing: 'A fishing spot' };

const poiId = (p) => (p.type === 'lantern' ? `lantern:${p.x},${p.y}` : `poi:${p.type}:${p.x},${p.y}`);

// ---------- the world ----------

/**
 * createWilds({ worldgen, maxChunks }) → the streamed wilds (§7.1). Chunks are cached (LRU);
 * ground is painted on demand in row slices so the engine can spread it over idle time.
 */
export function createWilds({ worldgen, maxChunks = 64 } = {}) {
  if (!worldgen) throw new Error('createWilds needs a worldgen');
  const S = worldgen.seed >>> 0;
  const regions = worldgen.anchors.filter((a) => a.radius > 0);
  const regionSalt = new Map(regions.map((a) => [a.id, hashString(a.id) % 997]));
  const cache = new Map();

  // Worldgen doesn't export regionDistance, so this reproduces it exactly (same seed, anchors,
  // warp and fbm), and the tests check it against worldgen's own region terrain.
  function regionDistance(a, x, y) {
    const raw = Math.hypot(x - a.x, y - a.y) / a.radius;
    if (raw >= 1.7) return raw;
    const k = regionSalt.get(a.id);
    const warp = a.radius * 1.5;
    const wx = x + (fbm(x / 28, y / 28, S + 300 + k, { octaves: 3 }) - 0.5) * warp;
    const wy = y + (fbm(x / 28, y / 28, S + 600 + k, { octaves: 3 }) - 0.5) * warp;
    return Math.hypot(wx - a.x, wy - a.y) / a.radius;
  }
  /** Whether a tile lies in one of the story's regions (regionDistance < 1, as worldgen's tiers). */
  function inRegion(x, y) {
    if (inHeart(x, y)) return false;
    for (const a of regions) {
      if (Math.abs(x - a.x) >= a.radius * 1.7 || Math.abs(y - a.y) >= a.radius * 1.7) continue;
      if (regionDistance(a, x, y) < 1) return true;
    }
    return false;
  }
  /**
   * Hush over a tile, 0..255: full in a region, none outside, and a narrow edge between them: by a
   * tile's distance to the region's edge (HUSH_BAND tiles in all, half either side), so the dither
   * is a soft, even band two or three tiles wide however the region's own edge is shaped, and
   * the same from whichever chunk it's seen. inside(x, y) says which tiles are in a region.
   */
  function hushFrom(inside, x, y) {
    if (inHeart(x, y)) return 0;
    const me = inside(x, y);
    let d = HUSH_REACH + 1;
    for (const [dx, dy, h] of HUSH_RING) {
      if (h >= d) break;
      if (inside(x + dx, y + dy) !== me) d = h;
    }
    const s = me ? d - 0.5 : 0.5 - d;
    return Math.round(clamp01(0.5 + s / HUSH_BAND) * 255);
  }
  // Which tiles the Hush lies over: the regions' own tiles, except that a pocket of HUSH_POCKET
  // tiles or fewer (four-way) shut in by the other kind goes with what's round it: a small hole in
  // a region is in the Hush, and a speck of region out in the open isn't, so neither shows as a
  // dithered blotch. A pure function of the tile (worked out by the pocket, and kept), so every
  // chunk that sees a pocket agrees about it.
  const rawRegion = new Map();
  const hushSide = new Map();
  const tileNum = (x, y) => (x + 1048576) * 2097152 + (y + 1048576);
  function regionRaw(x, y) {
    const k = tileNum(x, y);
    let v = rawRegion.get(k);
    if (v === undefined) {
      if (rawRegion.size > 400000) { rawRegion.clear(); hushSide.clear(); }
      v = inRegion(x, y);
      rawRegion.set(k, v);
    }
    return v;
  }
  function inHush(x, y) {
    const k = tileNum(x, y);
    const known = hushSide.get(k);
    if (known !== undefined) return known;
    const me = regionRaw(x, y);
    const pocket = [[x, y]];
    const seen = new Set([k]);
    let open = false;
    for (let i = 0; i < pocket.length && !open; i += 1) {
      const [px, py] = pocket[i];
      for (const [dx, dy] of FOUR) {
        const nx = px + dx;
        const ny = py + dy;
        const nk = tileNum(nx, ny);
        if (seen.has(nk) || regionRaw(nx, ny) !== me) continue;
        // a like tile already settled that isn't in this pocket's list: it was part of a big one
        if (hushSide.has(nk) || pocket.length >= HUSH_POCKET) { open = true; break; }
        seen.add(nk);
        pocket.push([nx, ny]);
      }
    }
    const side = open ? me : !me;
    for (const [px, py] of pocket) hushSide.set(tileNum(px, py), side);
    return side;
  }
  function hushAt(x, y) {
    const c = cache.get(`${floorDiv(x, CHUNK)},${floorDiv(y, CHUNK)}`);
    if (c) return c.hush[mod(y, CHUNK) * CHUNK + mod(x, CHUNK)];
    return hushFrom(inHush, x, y);
  }
  // worldgen's temperature (naturalTerrain): snow instead of mountain below 0.42.
  const coldAt = (x, y) => 0.55 + y / 700 + (fbm(x / 160, y / 160, S + 21, { octaves: 3 }) - 0.5) * 0.35 < 0.42;
  // Marsh pools (POOL): the pool centred in cell (gx, gy), [x, y, reach] in world px, or null. Kept
  // per cell (a pure function of the seed and the land).
  const poolCells = new Map();
  function poolAt(gx, gy) {
    const k = (gx + 1048576) * 2097152 + (gy + 1048576);
    let p = poolCells.get(k);
    if (p === undefined) {
      p = null;
      if (hash2(gx, gy, 151) < POOL_CHANCE) {
        const x = (gx + 0.2 + 0.6 * hash2(gx, gy, 152)) * POOL_CELL;
        const y = (gy + 0.2 + 0.6 * hash2(gx, gy, 153)) * POOL_CELL;
        const tx = floorDiv(x, TILE);
        const ty = floorDiv(y, TILE);
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy += 1) for (let dx = -2; dx <= 2 && ok; dx += 1) if (terrainAt(tx + dx, ty + dy) !== T.MARSH) ok = false;
        if (ok) p = [x, y, POOL_R[0] + (POOL_R[1] - POOL_R[0]) * hash2(gx, gy, 154)];
      }
      if (poolCells.size > 200000) poolCells.clear();
      poolCells.set(k, p);
    }
    return p;
  }
  const POOL_REACH = Math.ceil(POOL_R[1] / POOL_CELL); // cells either way a blob can reach
  const blob = (d2, r) => { const t = 1 - d2 / (r * r); return t > 0 ? t * t : 0; };
  /** How much pool there is at a pixel before the clearings and the marsh's edge: over POOL is water. */
  function poolNoise(X, Y) {
    const gx = floorDiv(X, POOL_CELL);
    const gy = floorDiv(Y, POOL_CELL);
    let v = (smoothNoise(X, Y, 9, 153) - 0.5) * 0.3;
    for (let dy = -POOL_REACH; dy <= POOL_REACH; dy += 1) {
      for (let dx = -POOL_REACH; dx <= POOL_REACH; dx += 1) {
        const p = poolAt(gx + dx, gy + dy);
        if (p) v += blob((X + 0.5 - p[0]) ** 2 + (Y + 0.5 - p[1]) ** 2, p[2]);
      }
    }
    return v;
  }

  /**
   * The region a tile's hush belongs to ({ d, id, name }), or null where there's no Hush (inHush):
   * the one it lies deepest in, or for a small hole in a region, the region round it.
   */
  function hushRegion(x, y) {
    if (inHeart(x, y) || !inHush(x, y)) return null;
    let best = null;
    for (const a of regions) {
      if (Math.abs(x - a.x) >= a.radius * 1.7 || Math.abs(y - a.y) >= a.radius * 1.7) continue;
      const d = regionDistance(a, x, y);
      if (!best || d < best.d) best = { d, id: a.id, name: a.name };
    }
    return best;
  }

  // ---------- terrain ----------

  let detours = null; // made on first use: it needs worldgen's roads
  const detour = () => detours || (detours = ringDetours(worldgen));
  /** Worldgen's terrain with the roads kept off the ring (ringDetours). */
  function worldTerrain(x, y) {
    if (x >= NEAR.x0 && y >= NEAR.y0 && x <= NEAR.x1 && y <= NEAR.y1) {
      const d = detour().at(x, y);
      if (d !== undefined) return d;
    }
    return worldgen.terrainAt(x, y);
  }
  function terrainAt(x, y) {
    if (inHeart(x, y)) return T.HEART;
    const c = cache.get(`${floorDiv(x, CHUNK)},${floorDiv(y, CHUNK)}`);
    if (c) return c.tiles[mod(y, CHUNK) * CHUNK + mod(x, CHUNK)];
    return worldTerrain(x, y);
  }
  /** Walkable before any wild object: the vale's own rules inside, walls shut, gates open. */
  function baseWalk(x, y, t) {
    if (inHeart(x, y)) return valeWalkable(x, y);
    if (isRing(x, y)) return isGateTile(x, y);
    return TERRAIN_INFO[t].walk;
  }

  // ---------- fixed points of interest, with ids ----------

  let fixedCache = null;
  function fixedPois() {
    if (fixedCache) return fixedCache;
    const seen = new Set();
    fixedCache = [];
    for (const p of worldgen.fixedPois()) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k) || inHeart(p.x, p.y)) continue;
      seen.add(k);
      fixedCache.push({ ...p, id: poiId(p), depth: worldgen.depthAt(p.x, p.y) });
    }
    return fixedCache;
  }
  let fixedByChunk = null;
  function fixedNear(cx, cy) {
    if (!fixedByChunk) {
      fixedByChunk = new Map();
      for (const p of fixedPois()) {
        const k = `${floorDiv(p.x, CHUNK)},${floorDiv(p.y, CHUNK)}`;
        if (!fixedByChunk.has(k)) fixedByChunk.set(k, []);
        fixedByChunk.get(k).push(p);
      }
    }
    const out = [];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) out.push(...(fixedByChunk.get(`${cx + dx},${cy + dy}`) || []));
    return out;
  }

  // ---------- the Stockade's banners, either side of the north gatehouse ----------

  // Two banners stand just outside the wall, one each side of the north gate (BANNER_OFF tiles along
  // the wall, the first of those on open land, off the road), leaning in toward it. Their tiles are kept
  // clear at every tier, so the chunks' own objects never depend on the Hearth's tier; the banners
  // themselves stand from tier 2 (ringObjects).
  let bannerCache;
  function bannerSpots() {
    if (bannerCache !== undefined) return bannerCache;
    const gate = GATE_LIST.find((g) => g.short === 'n');
    const fixed = fixedPois();
    const open = (x, y) => {
      const t = terrainAt(x, y);
      return !inHeart(x, y) && !isRing(x, y) && !BEYOND.has(`${x},${y}`) && TERRAIN_INFO[t].walk && !ROADISH(t) && !WATER_T.has(t)
        && !fixed.some((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1);
    };
    bannerCache = [];
    for (const [side, short] of [[-1, 'w'], [1, 'e']]) {
      const at = [1, 2].flatMap((row) => BANNER_OFF.map((k) => ({ x: gate.x + side * k, y: gate.y - row }))).find((p) => open(p.x, p.y));
      if (at) bannerCache.push({ ...at, side: short, dx: -side * 4 });
    }
    return bannerCache;
  }
  const nearBanner = (x, y, margin = 0) => bannerSpots().some((b) => Math.abs(b.x - x) <= margin && Math.abs(b.y - y) <= margin);

  // ---------- the Gate Bell's spot, beside the north road ----------

  // The Gate Bell is a bell post of its own on open ground just outside the wall, beside the road out
  // of the north gate: the first of BELL_SPOTS on open land off the road, next to a road tile, with no
  // fixed place or point of interest within two tiles, whose sprite stands clear of the palisade's
  // stakes, the gatehouse and the banners. (Any nearer and the stakes and the gatehouse's post cut
  // across it, and the vale's trees inside the wall hide its foot.) Its tile and the eight round it
  // are kept clear of the wilds' own objects at every tier, and the war table keeps off them, so no
  // tree or table stands over it; the bell itself stands from tier 2 (ringObjects).
  let bellCache;
  function bellSpot() {
    if (bellCache !== undefined) return bellCache;
    const gate = GATE_LIST.find((g) => g.short === 'n');
    const fixed = fixedPois();
    const near = [];
    for (let cy = floorDiv(gate.y - 8, CHUNK); cy <= floorDiv(gate.y, CHUNK); cy += 1) {
      for (let cx = floorDiv(gate.x - 8, CHUNK); cx <= floorDiv(gate.x + 8, CHUNK); cx += 1) near.push(...worldgen.chunk(cx, cy).pois);
    }
    const places = [...fixed, ...near];
    const roadAt = (x, y) => ROADISH(terrainAt(x, y));
    const open = (x, y) => {
      const t = terrainAt(x, y);
      return !inHeart(x, y) && !isRing(x, y) && !BEYOND.has(`${x},${y}`) && TERRAIN_INFO[t].walk && !ROADISH(t) && !WATER_T.has(t) && t !== T.SKY
        && !places.some((p) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2) && !nearBanner(x, y, 1);
    };
    // What already stands by the gate from tier 2: the stakes of the wall, the gatehouse, the banners.
    const standing = [];
    for (let x = gate.x - 4; x <= gate.x + 4; x += 1) {
      if (x === gate.x) standing.push(spriteBox('gatehouse', x, gate.y));
      else if (isRing(x, gate.y)) standing.push(spriteBox('palisade', x, gate.y));
    }
    for (const b of bannerSpots()) standing.push(spriteBox('banner', b.x, b.y, { dx: b.dx }));
    const clear = (x, y) => !standing.some((box) => boxesOverlap(box, spriteBox('gate.bell', x, y)));
    const spots = BELL_SPOTS.map(([ox, oy]) => ({ x: gate.x + ox, y: gate.y + oy }));
    const byRoad = ({ x, y }) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roadAt(x + dx, y + dy));
    bellCache = spots.find((p) => open(p.x, p.y) && clear(p.x, p.y) && byRoad(p))
      || spots.find((p) => open(p.x, p.y) && clear(p.x, p.y))
      || null;
    return bellCache;
  }
  const nearBell = (x, y, margin = 0) => {
    const b = bellSpot();
    return !!b && Math.abs(b.x - x) <= margin && Math.abs(b.y - y) <= margin;
  };

  // ---------- the war table's spot, by the north gatehouse ----------

  let warSpot;
  function warTable() {
    if (warSpot !== undefined) return warSpot;
    const gate = GATE_LIST.find((g) => g.short === 'n');
    const fixed = fixedPois();
    const bad = (x, y) => {
      const t = terrainAt(x, y);
      return inHeart(x, y) || isRing(x, y) || BEYOND.has(`${x},${y}`) || !TERRAIN_INFO[t].walk || ROADISH(t) || t === T.SAND
        || fixed.some((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1) || nearBanner(x, y, 1) || nearBell(x, y, 1);
    };
    // Reachable from the gate in a few steps, so the table stands by it and not across a river.
    const reach = new Map([[`${gate.x},${gate.y}`, 0]]);
    const queue = [[gate.x, gate.y]];
    while (queue.length) {
      const [x, y] = queue.shift();
      const d = reach.get(`${x},${y}`);
      if (d >= 14) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const k = `${nx},${ny}`;
        if (reach.has(k) || inHeart(nx, ny) || !baseWalk(nx, ny, terrainAt(nx, ny))) continue;
        reach.set(k, d + 1);
        queue.push([nx, ny]);
      }
    }
    const options = [];
    for (let y = gate.y - 7; y <= gate.y - 1; y += 1) {
      for (let x = gate.x - 7; x <= gate.x + 7; x += 1) {
        if (bad(x, y) || bad(x + 1, y)) continue;
        const approach = [[x, y + 1], [x + 1, y + 1], [x, y - 1], [x + 1, y - 1], [x - 1, y], [x + 2, y]].filter(([ax, ay]) => reach.has(`${ax},${ay}`));
        if (!approach.length || !ringOk(x, y, 2, 1, (ax, ay) => baseWalk(ax, ay, terrainAt(ax, ay)))) continue;
        options.push({ x, y, d: Math.hypot(x + 1 - (gate.x + 2.5), y - (gate.y - 1.5)) });
      }
    }
    options.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    warSpot = options.length ? { x: options[0].x, y: options[0].y, w: 2, h: 1 } : null;
    return warSpot;
  }

  // ---------- chunks ----------

  function touch(key, chunk) {
    cache.delete(key);
    cache.set(key, chunk);
    while (cache.size > maxChunks) cache.delete(cache.keys().next().value);
  }

  function chunk(cx, cy) {
    const key = `${cx},${cy}`;
    const hit = cache.get(key);
    if (hit) {
      touch(key, hit);
      return hit;
    }
    const made = makeChunk(cx, cy, key);
    touch(key, made);
    return made;
  }

  // A chunk's points of interest and their props: the first half of placing its objects, and all a
  // neighbour needs to know of it when painting ground (its clearings), so kept apart from the
  // chunks and cheaper to make.
  const layers = new Map();
  function poiLayer(cx, cy) {
    const key = `${cx},${cy}`;
    let layer = layers.get(key);
    if (layer) layers.delete(key);
    else layer = makeLayer(cx, cy);
    layers.set(key, layer);
    while (layers.size > maxChunks * 2) layers.delete(layers.keys().next().value);
    return layer;
  }

  function makeLayer(cx, cy) {
    const base = worldgen.chunk(cx, cy);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // worldgen's tiles, with the roads kept off the ring (a copy: worldgen's own are shared)
    let tiles = base.tiles;
    if (x0 + CHUNK > NEAR.x0 && y0 + CHUNK > NEAR.y0 && x0 <= NEAR.x1 && y0 <= NEAR.y1) {
      for (const d of detour().tiles) {
        if (d.x < x0 || d.y < y0 || d.x >= x0 + CHUNK || d.y >= y0 + CHUNK) continue;
        if (tiles === base.tiles) tiles = new Uint8Array(base.tiles);
        tiles[(d.y - y0) * CHUNK + (d.x - x0)] = d.terrain;
      }
    }
    // Points of interest with ids (fixed ones first; one per tile).
    const pois = [];
    const poiTiles = new Set();
    for (const p of base.pois) {
      const k = `${p.x},${p.y}`;
      if (poiTiles.has(k) || inHeart(p.x, p.y) || isRing(p.x, p.y)) continue;
      poiTiles.add(k);
      const poi = { ...p, id: poiId(p), name: RESOURCE_NAMES[p.type] || p.name, depth: p.depth ?? worldgen.depthAt(p.x, p.y) };
      pois.push(poi);
    }
    const layer = {
      tiles, pois, objects: [], docks: [], dry: [], firm: [],
      taken: new Set(), poiTile: new Set(), clear: new Uint8Array(CHUNK * CHUNK), blocked: new Uint8Array(CHUNK * CHUNK),
    };
    if (!(x0 >= 0 && y0 >= 0 && x0 + CHUNK <= HEART.w && y0 + CHUNK <= HEART.h)) placePois(cx, cy, layer);
    return layer;
  }

  function makeChunk(cx, cy, key) {
    const layer = poiLayer(cx, cy);
    const { tiles, pois } = layer;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const allHeart = x0 >= 0 && y0 >= 0 && x0 + CHUNK <= HEART.w && y0 + CHUNK <= HEART.h;

    // Terrain with a margin, so rules that look past the chunk's edge agree with its neighbours.
    const win = new Uint8Array(WIN * WIN);
    for (let j = 0; j < WIN; j += 1) {
      for (let i = 0; i < WIN; i += 1) {
        const x = x0 - MARGIN + i;
        const y = y0 - MARGIN + j;
        const li = i - MARGIN;
        const lj = j - MARGIN;
        win[j * WIN + i] = li >= 0 && lj >= 0 && li < CHUNK && lj < CHUNK ? tiles[lj * CHUNK + li] : terrainAt(x, y);
      }
    }

    // The Hush, per tile, with a one-tile border for seamless fades between chunks (which tiles
    // are in a region worked out once, far enough round for every tile's edge distance).
    const wide = new Uint8Array((CHUNK + 2) * (CHUNK + 2));
    if (!allHeart) {
      const R = HUSH_REACH + 1;
      const RW = CHUNK + 2 * R;
      const regionTiles = new Uint8Array(RW * RW);
      let any = false;
      for (let j = 0; j < RW; j += 1) for (let i = 0; i < RW; i += 1) if (inHush(x0 - R + i, y0 - R + j)) { regionTiles[j * RW + i] = 1; any = true; }
      const inside = (x, y) => regionTiles[(y - y0 + R) * RW + (x - x0 + R)] === 1;
      if (any) for (let j = -1; j <= CHUNK; j += 1) for (let i = -1; i <= CHUNK; i += 1) wide[(j + 1) * (CHUNK + 2) + i + 1] = hushFrom(inside, x0 + i, y0 + j);
    }
    const hush = new Uint8Array(CHUNK * CHUNK);
    for (let j = 0; j < CHUNK; j += 1) for (let i = 0; i < CHUNK; i += 1) hush[j * CHUNK + i] = wide[(j + 1) * (CHUNK + 2) + i + 1];
    hush.wide = wide;

    // The layer's own lists are shared; what the props below change is this chunk's copy.
    const internals = { win, docks: layer.docks, dry: layer.dry, firm: layer.firm, clear: layer.clear.slice(), blocked: layer.blocked.slice(), rowsDone: null, poiIndex: new Map() };
    const objects = layer.objects.map((o) => ({ ...o }));
    if (!allHeart) placeProps(cx, cy, win, layer, internals, objects);
    for (const o of objects) o.hush = hush[(o.y - y0) * CHUNK + (o.x - x0)] || 0;
    objects.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
    for (const p of pois) internals.poiIndex.set(`${p.x},${p.y}`, p);
    const data = { cx, cy, key, tiles, objects, pois, hush, ground: null, groundRows: allHeart ? CP : 0 };
    Object.defineProperty(data, '_', { value: internals, enumerable: false });
    if (allHeart) {
      data.ground = new Uint8Array(CP * CP);
      internals.rowsDone = new Uint8Array(CP).fill(1);
    }
    return data;
  }

  // Is the ring of tiles round a footprint still one piece where it touches the footprint? If
  // so, blocking the footprint can't cut any walk in two.
  function ringOk(fx, fy, w, h, walk) {
    const ring = [];
    for (let x = fx - 1; x <= fx + w; x += 1) ring.push([x, fy - 1]);
    for (let y = fy; y <= fy + h - 1; y += 1) ring.push([fx + w, y]);
    for (let x = fx + w; x >= fx - 1; x -= 1) ring.push([x, fy + h]);
    for (let y = fy + h - 1; y >= fy; y -= 1) ring.push([fx - 1, y]);
    const open = ring.map(([x, y]) => walk(x, y));
    const touches = ring.map(([x, y]) => (x >= fx && x < fx + w) || (y >= fy && y < fy + h));
    const n = ring.length;
    let start = open.findIndex((o) => !o);
    if (start < 0) return true; // all open round it
    let runs = 0;
    let inRun = false;
    let runTouches = false;
    for (let s = 1; s <= n; s += 1) {
      const i = (start + s) % n;
      if (open[i]) {
        if (!inRun) { inRun = true; runTouches = false; }
        if (touches[i]) runTouches = true;
      } else if (inRun) {
        inRun = false;
        if (runTouches) runs += 1;
      }
    }
    return runs <= 1;
  }

  // Points of interest first: each gets its prop beside the tile Milo stands on. Fills the layer's
  // objects, the tiles taken round them, the clearings and the dock. Looks only at the chunk's own
  // tiles (props keep a tile inside it).
  function placePois(cx, cy, layer) {
    const { tiles, pois, objects, taken, poiTile, clear, blocked } = layer;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const local = (x, y) => x >= x0 && y >= y0 && x < x0 + CHUNK && y < y0 + CHUNK;
    const ter = (x, y) => (local(x, y) ? tiles[(y - y0) * CHUNK + (x - x0)] : terrainAt(x, y));
    const walk = (x, y) => baseWalk(x, y, ter(x, y));
    const internals = layer;
    const fixed = fixedNear(cx, cy);
    const war = warTable();

    for (const p of pois) poiTile.add(`${p.x},${p.y}`);
    const fixedTile = new Set(fixed.map((p) => `${p.x},${p.y}`));
    for (const k of fixedTile) poiTile.add(k);
    const nearPoi = (x, y, own) => {
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const k = `${x + dx},${y + dy}`;
        if (k !== own && poiTile.has(k)) return true;
      }
      return false;
    };
    const spotOk = (x, y, own, { water = false, sky = false, strict = true } = {}) => {
      if (!local(x, y) || x - x0 < 1 || y - y0 < 1 || x - x0 > CHUNK - 2 || y - y0 > CHUNK - 2) return false;
      if (inHeart(x, y) || isRing(x, y) || BEYOND.has(`${x},${y}`) || poiTile.has(`${x},${y}`) || taken.has(`${x},${y}`)) return false;
      if (war && y === war.y && x >= war.x - 1 && x <= war.x + war.w) return false;
      if (nearBanner(x, y) || nearBell(x, y, 1)) return false;
      const t = ter(x, y);
      if (water ? !WATER_T.has(t) : sky ? t !== T.SKY : (!TERRAIN_INFO[t].walk || ROADISH(t))) return false;
      return !strict || !nearPoi(x, y, own);
    };
    for (const p of pois) {
      const own = `${p.x},${p.y}`;
      clear[(p.y - y0) * CHUNK + (p.x - x0)] = 1;
      if (p.type === 'quay') {
        placeQuay(p, own);
        continue;
      }
      const art = POI_ART[p.type];
      if (!art) continue;
      let placed = null;
      // Beside the tile, first well clear of other points of interest, then allowed beside one
      // (never on one); isles in the sky keep their props on the isle.
      const sky = ter(p.x, p.y) === T.SKY;
      const tries = [];
      for (const strict of [true, false]) {
        if (art.water) for (const [ox, oy] of art.spots) tries.push([ox, oy, true, strict]);
        for (const [ox, oy] of art.spots) tries.push([ox, oy, false, strict]);
      }
      for (const [ox, oy, water, strict] of tries) {
        const fx = p.x + ox;
        const fy = p.y + oy;
        let ok = true;
        for (let y = fy; y < fy + art.h && ok; y += 1) for (let x = fx; x < fx + art.w && ok; x += 1) ok = spotOk(x, y, own, { water, sky, strict });
        if (!ok) continue;
        if (art.blocks && !sky && !ringOk(fx, fy, art.w, art.h, walk)) continue;
        placed = { x: fx, y: fy };
        break;
      }
      const kind = p.type === 'chest' && p.mimic ? 'chest.mimic' : art.kind;
      let object;
      if (placed) {
        object = { id: p.id, kind, x: placed.x, y: placed.y, w: art.w, h: art.h, blocks: art.blocks, dx: 0, dy: 0, place: p.id, frame: 0 };
        for (let y = placed.y - 1; y <= placed.y + art.h; y += 1) for (let x = placed.x - 1; x <= placed.x + art.w; x += 1) taken.add(`${x},${y}`);
        for (let y = placed.y; y < placed.y + art.h; y += 1) {
          for (let x = placed.x; x < placed.x + art.w; x += 1) {
            clear[(y - y0) * CHUNK + (x - x0)] = 1;
            if (art.blocks) blocked[(y - y0) * CHUNK + (x - x0)] = 1;
          }
        }
      } else {
        // Nowhere beside it (a lantern on a bridge, say): the prop stands on the tile itself, to
        // one side and at its back, and never blocks.
        object = { id: p.id, kind, x: p.x, y: p.y, w: 1, h: 1, blocks: false, dx: 5, dy: -4, place: p.id, frame: 0 };
      }
      objects.push(object);
      // Clearings in the marsh (world px rects): where Milo stands and the prop's whole footprint.
      // A fixed point of interest's clearing, which covers its prop too, is added below.
      const footprint = [object.x * TILE, object.y * TILE, (object.x + object.w) * TILE, (object.y + object.h) * TILE, ...DRY_LOCAL];
      if (!fixedTile.has(own)) {
        internals.dry.push([p.x * TILE, p.y * TILE, (p.x + 1) * TILE, (p.y + 1) * TILE, ...DRY_LOCAL]);
        if (placed) internals.dry.push(footprint);
      }
      // and firm ground under a prop on land, whatever water is beside it (not one set on the
      // water, or on a bridge or a sky isle)
      if (!WATER_T.has(ter(object.x, object.y)) && !ROADISH(ter(object.x, object.y)) && ter(object.x, object.y) !== T.SKY) {
        internals.firm.push([...footprint.slice(0, 4), ...FIRM]);
      }
    }

    // Every fixed point of interest near this chunk, whichever chunk it's in, so all agree.
    for (const p of fixed) internals.dry.push([(p.x - 1) * TILE, (p.y - 1) * TILE, (p.x + 2) * TILE, (p.y + 2) * TILE, ...DRY_FIXED]);

    function placeQuay(p, own) {
      // Captain Sloe's quay: dock planks out over the water (painted in the ground) and his boat.
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const d1 = { x: p.x + dx, y: p.y + dy };
        const d2 = { x: p.x + dx * 2, y: p.y + dy * 2 };
        if (!spotOk(d1.x, d1.y, own, { water: true }) || !spotOk(d2.x, d2.y, own, { water: true })) continue;
        const dir = dy ? 'ns' : 'ew';
        internals.docks.push({ ...d1, dir, end: false }, { ...d2, dir, end: true });
        for (const d of [d1, d2]) for (let y = d.y - 1; y <= d.y + 1; y += 1) for (let x = d.x - 1; x <= d.x + 1; x += 1) taken.add(`${x},${y}`);
        // The boat moors alongside the dock's end.
        const sides = dy ? [[d2.x + 1, d2.y], [d2.x - 2, d2.y]] : [[d2.x - 1, d2.y + 1], [d2.x - 1, d2.y - 1]];
        for (const [bx, by] of sides) {
          if (!local(bx, by) || !local(bx + 1, by) || !WATER_T.has(ter(bx, by)) || !WATER_T.has(ter(bx + 1, by))) continue;
          objects.push({ id: `${p.id}#boat`, kind: 'boat', x: bx, y: by, w: 2, h: 1, blocks: false, dx: 0, dy: -2, place: p.id, frame: 0 });
          break;
        }
        return;
      }
    }
  }

  // Then everything else, by the land: fills objects and marks what they block and keep clear.
  function placeProps(cx, cy, win, layer, internals, objects) {
    const { taken, poiTile } = layer;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const wx0 = x0 - MARGIN;
    const wy0 = y0 - MARGIN;
    const ter = (x, y) => {
      const i = x - wx0;
      const j = y - wy0;
      return i >= 0 && j >= 0 && i < WIN && j < WIN ? win[j * WIN + i] : terrainAt(x, y);
    };
    const walk = (x, y) => baseWalk(x, y, ter(x, y));
    const { blocked, clear } = internals; // clear: tiles kept free of decals and props
    const war = warTable();

    // ---- generic props: candidates by terrain, spaced by priority (three local rounds) ----
    // map.js's jitter: dx ±4, dy ±2
    const jitterX = (x, y) => Math.round((tileHash(x, y, S ^ 0x1d) - 0.5) * 8);
    const jitterY = (x, y) => Math.round((tileHash(x, y, S ^ 0x2d) - 0.5) * 4);
    const cand = new Uint8Array(WIN * WIN);
    const pri = new Float64Array(WIN * WIN);
    const R = MARGIN;
    const water = (x, y) => WATER_T.has(ter(x, y));
    const candidate = (x, y) => {
      const t = ter(x, y);
      if (t === T.HEART || ROADISH(t) || t === T.MOUNTAIN || isRing(x, y) || BEYOND.has(`${x},${y}`)) return K_NONE;
      const table = DENSITY[t];
      if (!table) return K_NONE;
      const r = tileHash(x, y, S ^ 0x51ed27);
      let kind = K_NONE;
      for (const [name, chance] of table) if (r < chance) { kind = K[name]; break; }
      if (!kind) return K_NONE;
      if (kind === K.tree && tileHash(x, y, S ^ 0x7b1) < 0.07) kind = K['tree.blossom'];
      if (TALL[kind]) {
        // Keep canopies (which rise about two tiles) off roads and out of the vale.
        for (let d = -1; d <= 1; d += 1) {
          for (let k = 1; k <= 2; k += 1) { const u = ter(x + d, y - k); if (ROADISH(u) || u === T.HEART) return K_NONE; }
          if (ROADISH(ter(x + d, y)) || ROADISH(ter(x + d, y + 1))) return K_NONE;
        }
        if (water(x, y + 1) || water(x - 1, y) || water(x + 1, y)) return K_NONE;
      } else if (kind !== K.reeds && (water(x, y + 1) || water(x - 1, y) || water(x + 1, y) || water(x - 1, y + 1) || water(x + 1, y + 1))) {
        return K_NONE; // bushes and rocks sit back from the water, their jitter and all
      }
      if (!TERRAIN_INFO[t].walk) return K_NONE;
      // Only reeds stand in the marsh's pools: anything else keeps to ground no pool can reach,
      // under its sprite's whole base (a pure function of the ground, so chunks agree).
      if (t === T.MARSH && kind !== K.reeds) {
        const half = SPRITES[KINDS[kind]][0][0].length / 2 + 3;
        const cx = (x + 0.5) * TILE + jitterX(x, y);
        const bottom = (y + 1) * TILE + jitterY(x, y);
        for (let Y = bottom - 8; Y < bottom + 4; Y += 1) for (let X = Math.floor(cx - half); X < Math.ceil(cx + half); X += 1) if (poolNoise(X, Y) > POOL) return K_NONE;
      }
      if (!NON_BLOCKING[kind] && !ringOk(x, y, 1, 1, walk)) return K_NONE;
      return kind;
    };
    for (let j = 1; j < WIN - 1; j += 1) {
      for (let i = 1; i < WIN - 1; i += 1) {
        const x = wx0 + i;
        const y = wy0 + j;
        const k = candidate(x, y);
        cand[j * WIN + i] = k;
        pri[j * WIN + i] = k ? tileHash(x, y, S ^ 0x2c9a) : -1;
      }
    }
    // Three local rounds of 'keep the highest priority among your neighbours': each round only
    // fills gaps the last one left, so forests come out dense and even, no two trees ever stand
    // within a tile, and a chunk agrees with its neighbours without knowing them. Round r is
    // exact on [2 + 2r, WIN - 2 - 2r), which after three rounds is the chunk itself.
    const beats = (a, b) => pri[a] > pri[b] || (pri[a] === pri[b] && a > b);
    const kept = new Uint8Array(WIN * WIN);
    const elig = new Uint8Array(WIN * WIN);
    for (let round = 0; round < 3; round += 1) {
      const lo = 1 + 2 * round;
      const hi = WIN - 1 - 2 * round;
      elig.fill(0);
      for (let j = lo; j < hi; j += 1) {
        for (let i = lo; i < hi; i += 1) {
          const n = j * WIN + i;
          if (!cand[n] || kept[n]) continue;
          let free = true;
          if (round) for (let dy = -1; dy <= 1 && free; dy += 1) for (let dx = -1; dx <= 1 && free; dx += 1) if (kept[n + dy * WIN + dx]) free = false;
          elig[n] = free ? 1 : 0;
        }
      }
      for (let j = lo + 1; j < hi - 1; j += 1) {
        for (let i = lo + 1; i < hi - 1; i += 1) {
          const n = j * WIN + i;
          if (!elig[n]) continue;
          let best = true;
          for (let dy = -1; dy <= 1 && best; dy += 1) for (let dx = -1; dx <= 1 && best; dx += 1) {
            const m = n + dy * WIN + dx;
            if (m !== n && elig[m] && beats(m, n)) best = false;
          }
          if (best) kept[n] = 1;
        }
      }
    }
    const chosen = [];
    for (let j = R; j < R + CHUNK; j += 1) for (let i = R; i < R + CHUNK; i += 1) if (kept[j * WIN + i]) chosen.push([wx0 + i, wy0 + j, cand[j * WIN + i]]);

    // Crags stand shoulder to shoulder over the mountains (unwalkable anyway), staggered.
    for (let y = y0; y < y0 + CHUNK; y += 1) {
      for (let x = x0; x < x0 + CHUNK; x += 1) {
        if (ter(x, y) !== T.MOUNTAIN || mod(x + (y & 1), 2) !== 0) continue;
        if ([-1, 0, 1, 2].some((d) => ROADISH(ter(x + d, y - 1)) || ter(x + d, y - 1) === T.HEART)) continue;
        const w = x + 1 < x0 + CHUNK && ter(x + 1, y) === T.MOUNTAIN ? 2 : 1;
        // Snow-capped where worldgen's own climate is cold enough for snow, or snow lies beside.
        let snowy = coldAt(x, y);
        for (let dy = -1; dy <= 1 && !snowy; dy += 1) for (let dx = -1; dx <= w && !snowy; dx += 1) if (ter(x + dx, y + dy) === T.SNOW) snowy = true;
        chosen.push([x, y, snowy ? 'crag.snow' : 'crag', w]);
      }
    }

    // Nothing on or right next to a point of interest, its prop, the war table, a banner or the Gate
    // Bell (a tree a tile off would stand over its post).
    const reserved = (x, y) => {
      if (taken.has(`${x},${y}`)) return true;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (poiTile.has(`${x + dx},${y + dy}`)) return true;
      if (war && y >= war.y - 1 && y <= war.y + war.h && x >= war.x - 1 && x <= war.x + war.w) return true;
      if (nearBanner(x, y, 1) || nearBell(x, y, 1)) return true;
      return false;
    };
    for (const [x, y, k, cw] of chosen) {
      const kind = typeof k === 'string' ? k : KINDS[k];
      const w = cw || 1;
      if (reserved(x, y) || (w === 2 && reserved(x + 1, y))) continue;
      const blocks = !(typeof k === 'number' && NON_BLOCKING[k]);
      const crag = kind.startsWith('crag');
      const dx = crag ? Math.round((tileHash(x, y, S ^ 0x1d) - 0.5) * 4) : jitterX(x, y);
      const dy = crag ? 0 : jitterY(x, y);
      const tree = WOOD[kind];
      const id = tree ? `tree:${x},${y}` : `${kind}:${x},${y}`;
      const object = { id, kind, x, y, w, h: 1, blocks, dx, dy, frame: 0, hush: 0 }; // hush: set by the chunk
      if (tree) {
        object.place = id;
        object.wood = tree;
      }
      objects.push(object);
      for (let xx = x; xx < x + w; xx += 1) {
        clear[(y - y0) * CHUNK + (xx - x0)] = 1;
        if (blocks) blocked[(y - y0) * CHUNK + (xx - x0)] = 1;
      }
    }
  }

  // ---------- ground ----------

  // Which way a bridge's deck runs at a tile, as the road that laid it says (worldgen.layRoad, and
  // ringDetours for roads moved off the ring): 1 = north-south (planks lie east-west), 2 =
  // east-west. A landing where two decks meet lies north-south; the odd tile no deck claims takes
  // the way the road meets it (more road north and south of it than east and west: north-south).
  function deckDirAt(x, y) {
    const d = detour().deckAt(x, y) || (worldgen.deckAt ? worldgen.deckAt(x, y) : null);
    if (d === 'ns' || d === 'x') return 1;
    if (d === 'ew') return 2;
    const run = (dx, dy) => {
      let n = 0;
      for (let k = 1; k <= 3 && ROADISH(terrainAt(x + dx * k, y + dy * k)); k += 1) n += 1;
      return n;
    };
    return run(-1, 0) + run(1, 0) > run(0, -1) + run(0, 1) ? 2 : 1;
  }

  /**
   * Paint key rows [from, to) of a chunk's ground (512 x 512 key codes, 0 = clear). Returns true
   * once every row is painted. Rows already painted are skipped, so calls can come in any order.
   */
  function ground(cx, cy, { from = 0, to = CP } = {}) {
    const c = chunk(cx, cy);
    const I = c._;
    if (!c.ground) c.ground = new Uint8Array(CP * CP);
    if (!I.rowsDone) I.rowsDone = new Uint8Array(CP);
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(CP, Math.ceil(to));
    let start = a;
    while (start < b) {
      while (start < b && I.rowsDone[start]) start += 1;
      if (start >= b) break;
      let end = start;
      while (end < b && !I.rowsDone[end] && end - start < SLICE_ROWS * 2) end += 1;
      paintRows(c, start, end);
      I.rowsDone.fill(1, start, end);
      start = end;
    }
    let rows = 0;
    while (rows < CP && I.rowsDone[rows]) rows += 1;
    c.groundRows = rows;
    return rows === CP;
  }

  const code = (ch) => ch.charCodeAt(0);
  const KC = Object.fromEntries(Object.keys(PALETTE).map((ch) => [ch, code(ch)]));
  const PAINTED_BANDS = [code('k'), code('e'), code('u'), code('v')];
  const DOCK_ROWS = SPRITES.dock[0];
  const DOCK_COLS = DOCK_ROWS[0].split('').map((_, x) => DOCK_ROWS.map((row) => row[x]).join('')); // turned for docks running east-west
  // A deck's rail, from its outer edge in (ink, the beam's shade, its lit top, an ink line on the
  // planks), and the post at the start of each tile's stretch of it (rows along the rail).
  const RAIL = [KC.o, KC.B, KC.n, KC.o];
  const POST = [[KC.o, KC.o, KC.o, KC.o], [KC.o, KC.n, KC.b, KC.o], [KC.o, KC.b, KC.B, KC.o], [KC.o, KC.o, KC.o, KC.o]];

  let buffers = null;
  function scratch(n) {
    if (!buffers || buffers.n < n) {
      buffers = {
        n, cls: new Uint8Array(n), under: new Uint8Array(n), dist: new Uint8Array(n), queue: new Int32Array(n), dry: new Float32Array(n), firm: new Float32Array(n),
        pool: new Uint8Array(n), core: new Uint8Array(n), sum: new Int32Array(n + 2048),
      };
    }
    return buffers;
  }

  function paintRows(c, from, to) {
    const I = c._;
    const keys = c.ground;
    const X0 = c.cx * CP;
    const Y0 = c.cy * CP;
    const tyA = floorDiv(Y0 + from, TILE);
    const tyB = floorDiv(Y0 + to - 1, TILE);
    // Nothing wild in these rows: they stay clear.
    let wild = false;
    for (let ty = tyA; ty <= tyB && !wild; ty += 1) for (let tx = c.cx * CHUNK; tx < c.cx * CHUNK + CHUNK && !wild; tx += 1) if (!inHeart(tx, ty)) wild = true;
    if (!wild) return;

    const M = 32;
    const PX0 = X0 - M;
    const PY0 = Y0 + from - M;
    const W = CP + 2 * M;
    const H = to - from + 2 * M;
    // Tiles under the window, with one more all round for the soft shore fields.
    const TX0 = floorDiv(PX0, TILE) - 1;
    const TY0 = floorDiv(PY0, TILE) - 1;
    const TW = floorDiv(PX0 + W - 1, TILE) - TX0 + 2;
    const TH = floorDiv(PY0 + H - 1, TILE) - TY0 + 2;
    const terr = new Uint8Array(TW * TH);
    const gcls = new Uint8Array(TW * TH);
    const wet = new Float32Array(TW * TH);
    const pathy = new Float32Array(TW * TH);
    const sandy = new Float32Array(TW * TH);
    const land = new Uint8Array(TW * TH);
    const decked = new Uint8Array(TW * TH); // bridge tiles, painted tile for tile
    const wx0 = c.cx * CHUNK - MARGIN;
    const wy0 = c.cy * CHUNK - MARGIN;
    for (let j = 0; j < TH; j += 1) {
      for (let i = 0; i < TW; i += 1) {
        const tx = TX0 + i;
        const ty = TY0 + j;
        const wi = tx - wx0;
        const wj = ty - wy0;
        const t = wi >= 0 && wj >= 0 && wi < WIN && wj < WIN ? I.win[wj * WIN + wi] : terrainAt(tx, ty);
        const n = j * TW + i;
        terr[n] = t;
        if (t === T.HEART) {
          const ch = MAP.tiles[ty][tx];
          gcls[n] = G_VALE;
          wet[n] = ch === VT.WATER || ch === VT.DOCK ? 1 : 0;
          pathy[n] = ch === VT.PATH ? 1 : 0;
          sandy[n] = ch === VT.SAND ? 1 : ch === VT.WATER ? 0.5 : 0;
          land[n] = G_GRASS;
          continue;
        }
        const g = GROUND_OF[t];
        gcls[n] = g;
        // a deck's water is whatever it crosses (its ends run square onto the banks)
        wet[n] = WATER_T.has(t) || (t === T.BRIDGE && WATER_T.has(worldgen.naturalTerrain(tx, ty))) ? 1 : 0;
        pathy[n] = ROADISH(t) ? 1 : 0;
        decked[n] = t === T.BRIDGE ? 1 : 0;
        sandy[n] = t === T.SAND ? 1 : WATER_T.has(t) ? 0.5 : 0;
        land[n] = g;
      }
    }
    // Under water, roads and sand the land beneath is whatever most of the neighbours are.
    const votes = new Uint8Array(16);
    for (let j = 0; j < TH; j += 1) {
      for (let i = 0; i < TW; i += 1) {
        const n = j * TW + i;
        const g = gcls[n];
        if (g !== G_WATER && g !== G_PATH && g !== G_SAND && g !== G_BRIDGE) continue;
        votes.fill(0);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const ii = i + dx;
          const jj = j + dy;
          if (ii < 0 || jj < 0 || ii >= TW || jj >= TH) continue;
          const o = gcls[jj * TW + ii];
          if (o === G_WATER || o === G_PATH || o === G_SAND || o === G_BRIDGE) continue;
          votes[o === G_VALE ? G_GRASS : o] += 1;
        }
        let best = G_GRASS;
        for (let v = 0; v < 16; v += 1) if (votes[v] > votes[best]) best = v;
        land[n] = best;
      }
    }
    // Decks run the way their road does (deckDirAt), and are railed (DECK_N, DECK_S, DECK_W and
    // DECK_E bits in deckShut) as below.
    const deckDir = new Uint8Array(TW * TH);
    const deckShut = new Uint8Array(TW * TH);
    // A deck's sides are railed wherever the deck stops; its ends only where they meet water (a
    // deck's end on the bank, road or not, is open to step off).
    const side = (t) => t !== T.BRIDGE && t !== T.ROAD && t !== T.HEART;
    const end = (t) => t !== T.BRIDGE && t !== T.HEART && !TERRAIN_INFO[t].walk;
    for (let j = 1; j < TH - 1; j += 1) {
      for (let i = 1; i < TW - 1; i += 1) {
        const n = j * TW + i;
        if (!decked[n]) continue;
        const dir = deckDirAt(TX0 + i, TY0 + j);
        const ns = dir === 1 ? end : side;
        const ew = dir === 1 ? side : end;
        deckDir[n] = dir;
        deckShut[n] = (ns(terr[n - TW]) ? DECK_N : 0) | (ns(terr[n + TW]) ? DECK_S : 0) | (ew(terr[n - 1]) ? DECK_W : 0) | (ew(terr[n + 1]) ? DECK_E : 0);
      }
    }

    // ---- classify every pixel of the window, a tile at a time ----
    const buf = scratch(W * H); // buffers kept from slice to slice, so painting makes little garbage
    const cls = buf.cls;
    const tileAt = (X, Y) => (floorDiv(Y, TILE) - TY0) * TW + (floorDiv(X, TILE) - TX0);
    // Clearings: this chunk's, and any a neighbour has near enough to change the pixels of this
    // window that lie in it (they shape the water this chunk shades by distance to the shore). A
    // neighbour is only made for them where there's water or marsh for a clearing to hold back,
    // so every chunk sees the same ground wherever windows overlap, and seams stay exact.
    const dryRects = I.dry.slice();
    const firmRects = I.firm.slice();
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx0 = (c.cx + dx) * CP;
        const ny0 = (c.cy + dy) * CP;
        const ix0 = Math.max(PX0, nx0);
        const iy0 = Math.max(PY0, ny0);
        const ix1 = Math.min(PX0 + W, nx0 + CP);
        const iy1 = Math.min(PY0 + H, ny0 + CP);
        if (ix0 >= ix1 || iy0 >= iy1) continue;
        let wetThere = false;
        for (let ty = floorDiv(iy0, TILE) - 1; ty <= floorDiv(iy1 - 1, TILE) + 1 && !wetThere; ty += 1) {
          for (let tx = floorDiv(ix0, TILE) - 1; tx <= floorDiv(ix1 - 1, TILE) + 1 && !wetThere; tx += 1) {
            const t = terr[(ty - TY0) * TW + (tx - TX0)];
            if (WATER_T.has(t) || t === T.MARSH) wetThere = true;
          }
        }
        if (!wetThere) continue;
        const beside = poiLayer(c.cx + dx, c.cy + dy);
        dryRects.push(...beside.dry);
        firmRects.push(...beside.firm);
      }
    }
    const firm = firmRects.length ? dryField(firmRects, PX0, PY0, W, H, buf.firm) : null; // props' ground holds back shores
    // A tile whose whole neighbourhood agrees is one class throughout: no fields, no wobble.
    const settled = (n) => {
      const g = land[n];
      const w0 = wet[n];
      const p0 = pathy[n];
      const s0 = sandy[n];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const m = n + dy * TW + dx;
          if (land[m] !== g || wet[m] !== w0 || pathy[m] !== p0 || sandy[m] !== s0 || decked[m] !== decked[n] || gcls[m] === G_VALE) return false;
        }
      }
      return true;
    };
    for (let tj = 1; tj < TH - 1; tj += 1) {
      const ty = TY0 + tj;
      const py0 = Math.max(0, ty * TILE - PY0);
      const py1 = Math.min(H, ty * TILE + TILE - PY0);
      if (py0 >= py1) continue;
      for (let ti = 1; ti < TW - 1; ti += 1) {
        const tx = TX0 + ti;
        const px0 = Math.max(0, tx * TILE - PX0);
        const px1 = Math.min(W, tx * TILE + TILE - PX0);
        if (px0 >= px1) continue;
        const n = tj * TW + ti;
        const g = gcls[n];
        if (g === G_VALE) {
          const vp = nearValeEdge(tx, ty) && !plainValeGrass(tx, ty) ? valeTilePixels(tx, ty) : null;
          for (let py = py0; py < py1; py += 1) {
            const row = py * W;
            const vrow = mod(PY0 + py, TILE) * TILE;
            for (let px = px0; px < px1; px += 1) cls[row + px] = vp ? vp[vrow + mod(PX0 + px, TILE)] : G_GRASS;
          }
          continue;
        }
        // A deck is its whole tile, square: straight edges, however the water runs beside it.
        if (decked[n]) {
          for (let py = py0; py < py1; py += 1) cls.fill(G_BRIDGE, py * W + px0, py * W + px1);
          continue;
        }
        const bay = inBayZone(tx, ty);
        // a wall tile by the bay is all its own: dry under its thicket, or all the bay's water
        const ringOwn = bay && isRing(tx, ty);
        if (!bay && settled(n)) {
          const fillWith = wet[n] > 0.5 ? G_WATER : pathy[n] > 0.5 ? G_PATH : sandy[n] > 0.5 ? G_SAND : land[n];
          for (let py = py0; py < py1; py += 1) cls.fill(fillWith, py * W + px0, py * W + px1);
          continue;
        }
        for (let py = py0; py < py1; py += 1) {
          const Y = PY0 + py;
          const v = (Y + 0.5) / TILE - 0.5;
          const fj = Math.floor(v);
          const fv = v - fj;
          const j0 = fj - TY0;
          for (let px = px0; px < px1; px += 1) {
            const X = PX0 + px;
            const p = py * W + px;
            // Soft shores, roads and beaches: bilinear between tile centres, thresholded.
            const u = (X + 0.5) / TILE - 0.5;
            const fi = Math.floor(u);
            const fu = u - fi;
            const a = j0 * TW + (fi - TX0);
            const b = a + 1;
            const c2 = a + TW;
            const d = c2 + 1;
            const k1 = (1 - fu) * (1 - fv);
            const k2 = fu * (1 - fv);
            const k3 = (1 - fu) * fv;
            const k4 = fu * fv;
            // (a deck carries no water onto the ground round it: its water is its own tile's, so the
            // bank at each end of a bridge meets the planks dry)
            const own = wet[n];
            const wa = decked[a] ? own : wet[a];
            const wb = decked[b] ? own : wet[b];
            const wc = decked[c2] ? own : wet[c2];
            const wd = decked[d] ? own : wet[d];
            let wv = wa;
            if (wa !== wb || wa !== wc || wa !== wd) wv = wa * k1 + wb * k2 + wc * k3 + wd * k4 + (smoothNoise(X, Y, 9, 131) - 0.5) * 0.32;
            const shore = bay ? valeShore(X, Y) : null;
            if (ringOwn) wv = own;
            else if (shore) wv = shore.lam * shore.wet + (1 - shore.lam) * wv;
            if (wv > 0.5 + (firm ? firm[p] * 0.7 : 0)) { cls[p] = G_WATER; continue; }
            const reclaimed = wv > 0.5; // held back from the water by a prop: the tile's own ground, never flecks of sand
            const pa = pathy[a];
            let pv = pa;
            if (pa !== pathy[b] || pa !== pathy[c2] || pa !== pathy[d]) pv = pa * k1 + pathy[b] * k2 + pathy[c2] * k3 + pathy[d] * k4 + (smoothNoise(X, Y, 7, 137) - 0.5) * 0.08;
            if (pv > 0.5) { cls[p] = G_PATH; continue; }
            const sa = sandy[a];
            let sv = sa;
            if (sa !== sandy[b] || sa !== sandy[c2] || sa !== sandy[d]) sv = sa * k1 + sandy[b] * k2 + sandy[c2] * k3 + sandy[d] * k4 + (smoothNoise(X, Y, 8, 139) - 0.5) * 0.24;
            if (shore) sv = shore.lam * shore.sand + (1 - shore.lam) * sv;
            if (sv > 0.5 && (!reclaimed || sandy[n] === 1)) { cls[p] = G_SAND; continue; }
            // Land: the tile's own ground, with a wobbly edge where two kinds of ground meet.
            let lc = land[n];
            if (lc !== land[n - 1] || lc !== land[n + 1] || lc !== land[n - TW] || lc !== land[n + TW]
              || lc !== land[n - TW - 1] || lc !== land[n - TW + 1] || lc !== land[n + TW - 1] || lc !== land[n + TW + 1]) {
              const sx = X + Math.round((smoothNoise(X, Y, 10, 141) - 0.5) * 9);
              const sy = Y + Math.round((smoothNoise(X, Y, 10, 143) - 0.5) * 9);
              const m = tileAt(sx, sy);
              if (m >= 0 && m < land.length) lc = land[m];
            }
            cls[p] = lc;
          }
        }
      }
    }
    // Marsh pools: noise over POOL is water, pushed back by the clearings (I.dry). Noise is taken a
    // row at a time over each row's run of marsh.
    let marsh = false;
    for (let n = 0; n < land.length && !marsh; n += 1) if (land[n] === G_MARSH) marsh = true;
    if (marsh) {
      const marshy = new Uint8Array(TW * TH);
      for (let n = 0; n < marshy.length; n += 1) marshy[n] = terr[n] === T.MARSH ? 1 : 0;
      const dry = dryField(dryRects.concat(firmRects), PX0, PY0, W, H, buf.dry);
      const pool = new Float64Array(W);
      const blobs = [];
      for (let gy = floorDiv(PY0, POOL_CELL) - POOL_REACH; gy <= floorDiv(PY0 + H, POOL_CELL) + POOL_REACH; gy += 1) {
        for (let gx = floorDiv(PX0, POOL_CELL) - POOL_REACH; gx <= floorDiv(PX0 + W, POOL_CELL) + POOL_REACH; gx += 1) {
          const p = poolAt(gx, gy);
          if (p) blobs.push(p);
        }
      }
      const wetMask = buf.pool.fill(0, 0, W * H);
      for (let py = 0; py < H; py += 1) {
        const row = py * W;
        let lo = -1;
        let hi = -1;
        for (let px = 0; px < W; px += 1) if (cls[row + px] === G_MARSH) { if (lo < 0) lo = px; hi = px; }
        if (lo < 0) continue;
        const Y = PY0 + py;
        // the ruffle, then each blob across the row
        noiseRow(pool, PX0 + lo, hi - lo + 1, Y, 9, 153, 0.3, false);
        for (let px = lo; px <= hi; px += 1) pool[px - lo] -= 0.15;
        for (const [bx, by, r] of blobs) {
          const dy = Y + 0.5 - by;
          if (dy * dy >= r * r) continue;
          const half = Math.sqrt(r * r - dy * dy);
          const a = Math.max(lo, Math.ceil(bx - half - 0.5 - PX0));
          const b = Math.min(hi, Math.floor(bx + half - 0.5 - PX0));
          for (let px = a; px <= b; px += 1) pool[px - lo] += blob((PX0 + px + 0.5 - bx) ** 2 + dy * dy, r);
        }
        // how much of the marsh is round each pixel: 1 in its heart, a half at its edge
        const v = (Y + 0.5) / TILE - 0.5;
        const fj = Math.floor(v);
        const fv = v - fj;
        const j0 = fj - TY0;
        for (let px = lo; px <= hi; px += 1) {
          if (cls[row + px] !== G_MARSH) continue;
          const X = PX0 + px;
          const u = (X + 0.5) / TILE - 0.5;
          const fi = Math.floor(u);
          const fu = u - fi;
          const a = j0 * TW + (fi - TX0);
          const mf = marshy[a] * (1 - fu) * (1 - fv) + marshy[a + 1] * fu * (1 - fv) + marshy[a + TW] * (1 - fu) * fv + marshy[a + TW + 1] * fu * fv;
          const edge = mf >= 0.95 ? 0 : mf <= 0.5 ? 1 : 1 - (mf - 0.5) / 0.45;
          if (pool[px - lo] > POOL + (dry ? dry[row + px] * 0.6 : 0) + edge * MARSH_EDGE) wetMask[row + px] = 1;
        }
      }
      // Whatever a clearing or the marsh's edge leaves of a pool too thin to hold a square of
      // POOL_OPEN px either way (a sliver, a speck) is marsh again: the pools, opened.
      const core = open(wetMask, W, H, POOL_OPEN, buf);
      for (let p = 0; p < W * H; p += 1) if (core[p]) cls[p] = G_WATER;
    }
    // Sky isles hang over the sea: a jagged rock underside below each one.
    const under = buf.under; // set wherever a pixel becomes the underside, read only there
    for (let px = 0; px < W; px += 1) {
      const X = PX0 + px;
      const depth = 4 + Math.floor(smoothNoise(X, 0, 7, 161) * 6 + smoothNoise(X, 0, 3, 163) * 3);
      for (let py = 1; py < H; py += 1) {
        const p = py * W + px;
        if (cls[p - W] !== G_SKY || cls[p] === G_SKY) continue;
        for (let k = 0; k < depth && py + k < H; k += 1) {
          const q = (py + k) * W + px;
          if (cls[q] !== G_WATER) break;
          cls[q] = G_UNDER;
          under[q] = k + 1;
        }
      }
    }

    // ---- water: distance to shore, as the vale measures it ----
    const dist = buf.dist.fill(255, 0, W * H);
    const queue = buf.queue;
    let head = 0;
    let tail = 0;
    for (let p = 0; p < W * H; p += 1) {
      if (!WATERY[cls[p]]) { dist[p] = 0; queue[tail++] = p; }
    }
    while (head < tail) {
      const p = queue[head++];
      const d = dist[p];
      if (d >= 40) continue;
      const x = p % W;
      if (x > 0 && dist[p - 1] === 255) { dist[p - 1] = d + 1; queue[tail++] = p - 1; }
      if (x < W - 1 && dist[p + 1] === 255) { dist[p + 1] = d + 1; queue[tail++] = p + 1; }
      if (p >= W && dist[p - W] === 255) { dist[p - W] = d + 1; queue[tail++] = p - W; }
      if (p + W < W * H && dist[p + W] === 255) { dist[p + W] = d + 1; queue[tail++] = p + W; }
    }

    // ---- paint ----
    let cells = null; // basalt column centres, made on first use
    const at = (p) => cls[p];
    const marshNoise = marsh ? new Float64Array(CP) : null; // the row's marsh shading, on first use
    for (let ly = from; ly < to; ly += 1) {
      const Y = Y0 + ly;
      const py = ly - from + M;
      const ty = floorDiv(Y, TILE);
      const rowHeart = ty >= 0 && ty < HEART.h;
      let marshRow = false;
      for (let lx = 0; lx < CP; lx += 1) {
        const X = X0 + lx;
        const out = ly * CP + lx;
        if (rowHeart && X >= 0 && X < HEART.w * TILE) { keys[out] = 0; continue; }
        const p = py * W + lx + M;
        const k = cls[p];
        let key;
        switch (k) {
          case G_GRASS: {
            const n = smoothNoise(X, Y, 40, 3) * 0.8 + smoothNoise(X, Y, 11, 5) * 0.2;
            key = n > 0.74 ? KC.j : KC.g;
            if (LIPPED[at(p + W)]) key = KC.G;
            break;
          }
          case G_MARSH: {
            if (!marshRow) {
              noiseRow(marshNoise, X0, CP, Y, 26, 61, 0.7, false);
              noiseRow(marshNoise, X0, CP, Y, 7, 62, 0.3, true);
              marshRow = true;
            }
            key = marshNoise[lx] > 0.6 ? KC.q : KC.j;
            if (LIPPED[at(p + W)] || at(p + W) === G_WATER) key = KC.G;
            break;
          }
          case G_DOWNS: {
            const n = smoothNoise(X, Y, 56, 71) * 0.8 + smoothNoise(X, Y, 14, 72) * 0.2;
            key = n > 0.47 ? KC.j : KC.g;
            if (n > 0.78) key = KC.h;
            if (LIPPED[at(p + W)]) key = KC.G;
            break;
          }
          case G_SKY: {
            const n = smoothNoise(X, Y, 24, 81) * 0.8 + smoothNoise(X, Y, 7, 82) * 0.2;
            key = n > 0.62 ? KC.g : KC.h;
            if (at(p + W) !== G_SKY || at(p + 2 * W) !== G_SKY) key = KC.G;
            else if (at(p - W) !== G_SKY) key = KC.j;
            break;
          }
          case G_UNDER: {
            const d = under[p];
            const edge = at(p - 1) !== G_UNDER && at(p - 1) !== G_SKY || at(p + 1) !== G_UNDER && at(p + 1) !== G_SKY;
            key = d <= 1 ? KC.S : edge ? KC.z : (d <= 3 && hash2(X, Y, 167) < 0.4) ? KC.s : KC.z;
            if (at(p + W) !== G_UNDER) key = KC.o;
            break;
          }
          case G_SNOW: {
            const n = smoothNoise(X, Y, 36, 21) * 0.75 + smoothNoise(X, Y, 9, 22) * 0.25;
            key = n > 0.68 ? KC.f : KC.c;
            // wind-drift shadows: short dashes
            if (hash2(floorDiv(X + mod(Y * 3, 7), 6), Y, 23) < 0.035) key = KC.C;
            const l = cls[p - 1];
            const r = cls[p + 1];
            const u = cls[p - W];
            const dn = cls[p + W];
            if ((l !== G_SNOW && !FLAT[l]) || (r !== G_SNOW && !FLAT[r]) || (u !== G_SNOW && !FLAT[u]) || (dn !== G_SNOW && !FLAT[dn])) key = KC.C;
            if (LIPPED[at(p + W)]) key = KC.C;
            break;
          }
          case G_ROCK: {
            const n = smoothNoise(X, Y, 18, 31) * 0.7 + smoothNoise(X, Y, 6, 32) * 0.3;
            key = n > 0.6 ? KC.s : KC.S;
            if (hash2(X, Y, 33) < 0.03) key = KC.z;
            if (LIPPED[at(p + W)]) key = KC.z;
            break;
          }
          case G_BASALT: {
            // Tops of basalt columns: irregular cells with dark joints and a pale bevel up and to
            // the left, most of them dark, a few pale; now and then an ember glows in a joint.
            if (!cells) cells = basaltCells(X0 - 20, Y0 + from - 20, CP + 40, to - from + 40);
            const gx = floorDiv(X, BASALT_CELL) - cells.gx0;
            const gy = floorDiv(Y, BASALT_CELL) - cells.gy0;
            let d1 = Infinity;
            let d2 = Infinity;
            let f1x = 0;
            let f1y = 0;
            let h1 = 0;
            for (let j = -1; j <= 1; j += 1) {
              for (let i = -1; i <= 1; i += 1) {
                const q = (gy + j) * cells.gw + gx + i;
                const fx = cells.fx[q];
                const fy = cells.fy[q];
                const d = (X + 0.5 - fx) * (X + 0.5 - fx) + (Y + 0.5 - fy) * (Y + 0.5 - fy);
                if (d < d1) { d2 = d1; d1 = d; f1x = fx; f1y = fy; h1 = cells.h[q]; } else if (d < d2) d2 = d;
              }
            }
            const joint = Math.sqrt(d2) - Math.sqrt(d1);
            const upLeft = X + 0.5 - f1x + (Y + 0.5 - f1y) < 0;
            if (joint < 1.1) key = upLeft ? KC.z : hash2(X, Y, 37) < 0.012 ? KC.U : KC.o;
            else if (joint < 2.3) key = upLeft ? KC.S : KC.z;
            else key = h1 < 0.14 ? KC.S : hash2(X, Y, 38) < 0.025 ? KC.S : KC.z;
            if (LIPPED[at(p + W)]) key = KC.o;
            break;
          }
          case G_MOOR: {
            const n = smoothNoise(X, Y, 16, 41) * 0.7 + smoothNoise(X, Y, 5, 42) * 0.3;
            key = n > 0.5 ? KC.G : KC.S;
            const heather = smoothNoise(X, Y, 12, 43) * 0.8 + smoothNoise(X, Y, 3, 44) * 0.2;
            if (heather > 0.66) key = hash2(X, Y, 45) < 0.22 ? KC.v : KC.V;
            if (LIPPED[at(p + W)]) key = KC.S;
            break;
          }
          case G_PAINTED: {
            // Soft hills with fields of madder, woad, weld and heather planted in rows.
            const hill = smoothNoise(X, Y, 48, 51) * 0.8 + smoothNoise(X, Y, 12, 52) * 0.2;
            key = hill > 0.64 ? KC.j : KC.h;
            const field = smoothNoise(X, Y, 38, 55) * 0.78 + smoothNoise(X, Y, 10, 56) * 0.22;
            if (field > 0.54) {
              const band = PAINTED_BANDS[Math.floor(smoothNoise(X, Y, 140, 57) * 12) % 4];
              const s = Y + Math.round((smoothNoise(X, Y, 90, 53) - 0.5) * 18);
              const r = mod(s, 6);
              const row = floorDiv(s, 6);
              if (r < 2) key = hash2(floorDiv(X + row * 3, 3), row, 58) < 0.84 ? band : KC.q;
              else if (r === 2) key = KC.G;
            } else if (field > 0.515) key = KC.G;
            if (LIPPED[at(p + W)]) key = KC.G;
            break;
          }
          case G_PATH:
          case G_SAND: {
            key = KC.p;
            if (!FLAT[cls[p - 1]] || !FLAT[cls[p + 1]] || !FLAT[cls[p - W]] || !FLAT[cls[p + W]]) key = KC.P;
            else if (k === G_SAND && dist[p] === 0) {
              // wet sand near water
              if (cls[p - 1] === G_WATER || cls[p + 1] === G_WATER || cls[p - W] === G_WATER || cls[p + W] === G_WATER
                || cls[p - 2] === G_WATER || cls[p + 2] === G_WATER || cls[p - 2 * W] === G_WATER || cls[p + 2 * W] === G_WATER) key = KC.P;
            } else if (hash2(X, Y, 17) < 0.006) key = KC.P;
            break;
          }
          case G_SOIL:
            key = cls[p - 1] !== G_SOIL || cls[p + 1] !== G_SOIL || cls[p - W] !== G_SOIL || cls[p + W] !== G_SOIL || hash2(X, Y, 19) < 0.008 ? KC.b : KC.n;
            break;
          case G_WATER: {
            const d = dist[p];
            key = d + smoothNoise(X, Y, 30, 9) * 4 > 22 ? KC.W : KC.w;
            let bank = false;
            for (let q = 1; q <= 3; q += 1) if (at(p - q * W) !== G_WATER) bank = true;
            if (bank && d > 1) key = KC.W;
            if (d === 1) key = KC.f;
            break;
          }
          case G_BRIDGE: {
            // A deck, square to its tile: planks like the vale's dock (light, mid, deep and an ink
            // gap, four pixels to a plank) laid across the way it runs, and a rail along each railed
            // edge (deckShut), with a post where each tile's stretch of it begins and where it ends.
            const n = tileAt(X, Y);
            const along = deckDir[n] === 2 ? mod(X, 4) : mod(Y, 4);
            key = along === 0 ? KC.n : along === 1 ? KC.b : along === 2 ? KC.B : KC.o;
            const shut = deckShut[n];
            if (shut) {
              const lx = mod(X, TILE);
              const ly = mod(Y, TILE);
              let r = TILE;
              let at = 0; // how far along the rail this pixel is
              let rail = 0; // which rail
              let next = 0; // the tile the rail runs on into
              if (shut & DECK_N && ly < r) { r = ly; at = lx; rail = DECK_N; next = n + 1; }
              if (shut & DECK_S && TILE - 1 - ly < r) { r = TILE - 1 - ly; at = lx; rail = DECK_S; next = n + 1; }
              if (shut & DECK_W && lx < r) { r = lx; at = ly; rail = DECK_W; next = n + TW; }
              if (shut & DECK_E && TILE - 1 - lx < r) { r = TILE - 1 - lx; at = ly; rail = DECK_E; next = n + TW; }
              if (r < RAIL.length) {
                const last = TILE - 1 - at;
                if (at < POST.length) key = POST[at][r];
                else if (last < POST.length && !(deckShut[next] & rail)) key = POST[last][r];
                else key = RAIL[r];
              }
            }
            break;
          }
          default:
            key = KC.g;
        }
        keys[out] = key;
      }
    }

    // ---- decals: the vale's flowers, tufts, clover and pebbles, and a few of the wilds' own ----
    const stamp = (rows, sx, sy, want) => {
      // all-or-nothing, like the vale: the whole stamp must sit on the wanted ground
      for (let y = 0; y < rows.length; y += 1) {
        for (let x = 0; x < rows[0].length; x += 1) {
          const X = sx + x;
          const Y = sy + y;
          const px = X - PX0;
          const py = Y - PY0;
          if (px < 0 || py < 0 || px >= W || py >= H) return;
          if (!want(cls[py * W + px])) return;
        }
      }
      rows.forEach((row, y) => {
        const ly = sy + y - Y0;
        if (ly < from || ly >= to) return;
        for (let x = 0; x < row.length; x += 1) {
          const ch = row[x];
          const lx = sx + x - X0;
          if (ch === '.' || lx < 0 || lx >= CP) continue;
          keys[ly * CP + lx] = code(ch);
        }
      });
    };
    const isGrass = (g) => g === G_GRASS;
    const cx0 = c.cx * CHUNK;
    const cy0 = c.cy * CHUNK;
    for (let ty = Math.max(tyA, cy0); ty <= Math.min(tyB, cy0 + CHUNK - 1); ty += 1) {
      for (let tx = cx0; tx < cx0 + CHUNK; tx += 1) {
        if (inHeart(tx, ty) || I.clear[(ty - cy0) * CHUNK + (tx - cx0)]) continue;
        const t = I.win[(ty - wy0) * WIN + (tx - wx0)];
        const roll = hash2(tx, ty, 31);
        const ox = tx * TILE + Math.floor(hash2(tx, ty, 37) * 9);
        const oy = ty * TILE + Math.floor(hash2(tx, ty, 41) * 10);
        if (t === T.GRASS || t === T.MEADOW || t === T.FOREST || t === T.PINE || t === T.BIRCH || t === T.DOWNS) {
          const zone = t === T.MEADOW;
          const flowers = zone ? 0.34 : t === T.GRASS || t === T.DOWNS ? 0.03 : 0.015;
          if (roll < flowers) {
            const name = FLOWERS[Math.floor(hash2(tx, ty, 43) * FLOWERS.length)];
            stamp(SPRITES[name][0], ox, oy, t === T.DOWNS ? (g) => g === G_DOWNS : isGrass);
            continue;
          }
          if (roll < (zone ? 0.5 : 0.24)) {
            const pick = hash2(tx, ty, 47);
            const name = pick < 0.62 ? 'tuft' : pick < 0.86 ? 'tuft.light' : 'clover';
            stamp(SPRITES[name][0], ox, oy, t === T.DOWNS ? (g) => g === G_DOWNS : isGrass);
          } else if (roll > 0.985) stamp(SPRITES.pebbles[0], ox, oy, isGrass);
        } else if (t === T.ROCK || t === T.MOOR) {
          if (roll > 0.9) stamp(SPRITES.pebbles[0], ox, oy, (g) => g === G_ROCK || g === G_MOOR);
        } else if (t === T.MARSH) {
          if (roll < 0.1) stamp(SPRITES[roll < 0.03 ? 'lily.flower' : 'lily'][0], ox, oy, (g) => g === G_WATER);
          else if (roll < 0.3) stamp(SPRITES[roll < 0.22 ? 'tuft' : 'clover'][0], ox, oy, (g) => g === G_MARSH);
        } else if (t === T.SAND) {
          if (roll > 0.97) stamp(SPRITES.pebbles[0], ox, oy, (g) => g === G_SAND);
        }
      }
    }
    // Mushrooms tucked beside some trees, as in the vale.
    for (const o of c.objects) {
      if (o.kind !== 'tree' && o.kind !== 'pine' && o.kind !== 'tree.birch') continue;
      if (hash2(o.x, o.y, 53) > 0.16) continue;
      const mx = o.x * TILE + 12;
      const my = o.y * TILE + 9;
      if (mx + 7 > X0 + CP) continue;
      stamp(SPRITES.mushrooms[0], mx, my, isGrass);
    }
    // Captain Sloe's dock, planked like the vale's own.
    for (const d of I.docks) {
      const rows = d.dir === 'ns' ? DOCK_ROWS : DOCK_COLS;
      for (let y = 0; y < TILE; y += 1) {
        const ly = d.y * TILE + y - Y0;
        if (ly < from || ly >= to) continue;
        for (let x = 0; x < TILE; x += 1) {
          const lx = d.x * TILE + x - X0;
          if (lx < 0 || lx >= CP) continue;
          keys[ly * CP + lx] = code(rows[y][x]);
        }
      }
    }
  }

  // ---------- queries ----------

  const forEachChunkIn = (x0, y0, x1, y1, visit) => {
    for (let cy = floorDiv(y0, CHUNK); cy <= floorDiv(y1, CHUNK); cy += 1) {
      for (let cx = floorDiv(x0, CHUNK); cx <= floorDiv(x1, CHUNK); cx += 1) {
        const c = cache.get(`${cx},${cy}`);
        if (c) visit(c);
      }
    }
  };
  const has = (collection, id) => {
    if (!collection) return false;
    if (collection instanceof Set || collection instanceof Map) return collection.has(id);
    if (Array.isArray(collection)) return collection.includes(id);
    return Object.prototype.hasOwnProperty.call(collection, id) && collection[id] != null && collection[id] !== false;
  };
  const isFelled = (felled, id, day) => {
    if (!felled) return false;
    if (!(felled instanceof Set) && !Array.isArray(felled) && typeof felled === 'object' && day != null && typeof felled[id] === 'number') return felled[id] === day;
    return has(felled, id);
  };

  /**
   * Objects whose tile lies in x0..x1, y0..y1 (inclusive), from cached chunks only. With state
   * ({ felled, lit, opened, day }) felled trees come back as stumps (still blocking), lit
   * lanterns at frame 1 and opened chests at frame 1.
   */
  function objectsIn(x0, y0, x1, y1, state = null) {
    const out = [];
    forEachChunkIn(x0, y0, x1, y1, (c) => {
      for (const o of c.objects) {
        if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
        if (!state) { out.push(o); continue; }
        if (o.wood && isFelled(state.felled, o.id, state.day)) out.push({ ...o, kind: 'stump', frame: 0, felled: true });
        else if (o.kind === 'lantern.post' && has(state.lit, o.id)) out.push({ ...o, frame: 1 });
        else if ((o.kind === 'chest' || o.kind === 'chest.mimic') && has(state.opened, o.id)) out.push({ ...o, frame: 1 });
        else out.push(o);
      }
    });
    return out;
  }

  // nav asks this for every tile it looks at, so the last chunk asked about is kept at hand
  let lastBlocked = null;
  function blocked(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || inHeart(x, y)) return false;
    if (isRing(x, y)) return !isGateTile(x, y);
    const cx = floorDiv(x, CHUNK);
    const cy = floorDiv(y, CHUNK);
    let c = lastBlocked;
    if (!c || c.cx !== cx || c.cy !== cy || cache.get(c.key) !== c) c = lastBlocked = chunk(cx, cy);
    return c._.blocked[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] === 1;
  }

  /** Ring walls (always) and the war table's tiles (tier ≥ 2): an extraBlocked for nav. */
  function ringBlocked(x, y, tier = 1) {
    if (isRing(x, y)) return !isGateTile(x, y);
    const war = tier >= 2 ? warTable() : null;
    return !!war && y === war.y && x >= war.x && x < war.x + war.w;
  }

  function poiAt(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || inHeart(x, y)) return null;
    const c = chunk(floorDiv(x, CHUNK), floorDiv(y, CHUNK));
    return c._.poiIndex.get(`${x},${y}`) || null;
  }

  const ringCache = new Map();
  /**
   * The ring round the vale: a thicket (tier 1) or the Stockade palisade (tier ≥ 2) on every land
   * wall tile, with n/s/e/w autotile masks that join wall to wall and never into a gate (a gate is
   * the opening); at tier ≥ 2 the wall tile just south of the west and east gates holds the
   * palisade.jamb instead, which ends the wall low so the side-on gateway stays open, and there's a
   * gatehouse on each gate, the Gate Bell on its post beside the north road (bellSpot), a banner
   * either side of the gate just outside the wall (bannerSpots) and the war table outside it.
   */
  function ringObjects(tier = 1) {
    const level = tier >= 2 ? 2 : 1;
    if (ringCache.has(level)) return ringCache.get(level);
    const landWall = (x, y) => {
      if (ringKind(x, y) !== 'wall') return false;
      const t = terrainAt(x, y);
      return !WATER_T.has(t) && t !== T.BRIDGE && t !== T.SKY;
    };
    const jamb = (x, y) => GATE_LIST.some((g) => (g.side === 'w' || g.side === 'e') && g.x === x && g.y === y - 1);
    const out = [];
    const tiles = [];
    for (let x = -1; x <= HEART.w; x += 1) tiles.push([x, -1], [x, HEART.h]);
    for (let y = 0; y < HEART.h; y += 1) tiles.push([-1, y], [HEART.w, y]);
    for (const [x, y] of tiles) {
      if (!landWall(x, y)) continue;
      const mask = { n: landWall(x, y - 1), s: landWall(x, y + 1), e: landWall(x + 1, y), w: landWall(x - 1, y) };
      if (level >= 2) out.push({ id: `palisade:${x},${y}`, kind: jamb(x, y) ? 'palisade.jamb' : 'palisade', x, y, w: 1, h: 1, blocks: true, dx: 0, dy: 0, mask, frame: 0 });
      else out.push({ id: `thicket:${x},${y}`, kind: 'thicket', x, y, w: 1, h: 1, blocks: true, dx: 0, dy: 0, mask, frame: tileHash(x, y, S ^ 0x7c) < 0.5 ? 0 : 1 });
    }
    if (level >= 2) {
      // The gatehouse faces you in the north and south walls (frame 0); in the west and east walls
      // it stands side-on on the gate's north edge (frame 1, dy -15), so Milo walks in front of it.
      for (const g of GATE_LIST) {
        const sideOn = g.side === 'w' || g.side === 'e';
        out.push({ id: `gatehouse:${g.short}`, kind: 'gatehouse', x: g.x, y: g.y, w: 1, h: 1, blocks: false, dx: 0, dy: sideOn ? -15 : 0, gate: g.id, side: g.side, place: g.id, frame: sideOn ? 1 : 0 });
      }
      const north = GATE_LIST.find((g) => g.short === 'n');
      // The Gate Bell on its own post beside the road, clear of the wall (bellSpot).
      const bell = bellSpot();
      if (bell) out.push({ id: 'gate-bell', kind: 'gate.bell', x: bell.x, y: bell.y, w: 1, h: 1, blocks: false, dx: 0, dy: 0, place: north.id, frame: 0 });
      // The Stockade's banners, either side of the gate outside the wall, swaying out of step.
      for (const b of bannerSpots()) {
        out.push({ id: `banner:${b.side}`, kind: 'banner', x: b.x, y: b.y, w: 1, h: 1, blocks: false, dx: b.dx, dy: 0, place: north.id, frame: b.side === 'w' ? 0 : 1, phase: b.side === 'w' ? 0 : 450 });
      }
      const war = warTable();
      if (war) out.push({ id: 'war-table', kind: 'war.table', x: war.x, y: war.y, w: war.w, h: war.h, blocks: true, dx: 0, dy: 0, place: 'war-table', frame: 0 });
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    ringCache.set(level, out);
    return out;
  }

  const normRect = (rect) => {
    if (!rect) return null;
    if (rect.x0 != null) return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
    return { x0: rect.x, y0: rect.y, x1: rect.x + (rect.w ?? 1) - 1, y1: rect.y + (rect.h ?? 1) - 1 };
  };

  /**
   * Entities (CONTRACT-PHASE3.md §4.5) in a rect ({ x0, y0, x1, y1 } inclusive, or { x, y, w, h }),
   * from cached chunks: lanterns, points of interest, wild trees, the gates and (tier ≥ 2) the
   * war table. state ({ tier, lit, opened, notes, glimmers, felled, day }) shapes the labels.
   */
  function entitiesIn(rect, state = {}) {
    const r = normRect(rect);
    if (!r) return [];
    const out = [];
    const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    forEachChunkIn(r.x0, r.y0, r.x1, r.y1, (c) => {
      for (const p of c.pois) {
        if (!inside(p.x, p.y)) continue;
        out.push(poiEntity(p, state));
      }
      for (const o of c.objects) {
        if (!o.wood || !inside(o.x, o.y)) continue;
        const felled = isFelled(state.felled, o.id, state.day);
        out.push({ kind: 'tree', id: o.id, x: o.x, y: o.y, label: felled ? 'Stump' : TREE_LABEL[o.kind], wood: o.wood, felled });
      }
    });
    for (const g of GATE_LIST) if (inside(g.x, g.y)) out.push({ kind: 'gate', id: g.id, x: g.x, y: g.y, label: GATE_NAMES[g.short], gate: g.short });
    const war = (state.tier || 1) >= 2 ? warTable() : null;
    if (war && (inside(war.x, war.y) || inside(war.x + 1, war.y))) out.push({ kind: 'war-table', id: 'war-table', x: war.x, y: war.y, label: 'War Table', place: 'war-table' });
    return out;
  }

  function poiEntity(p, state = {}) {
    if (p.type === 'lantern') {
      const lit = has(state.lit, p.id);
      const label = p.region ? `${p.name} · ${lit ? 'lit' : 'sleeping'}` : lit ? 'Lit lantern' : 'Sleeping lantern';
      return { kind: 'lantern', id: p.id, x: p.x, y: p.y, label, lit, poiType: 'lantern', region: p.region || null };
    }
    let label = p.name;
    if (p.type === 'ruin' && has(state.opened, p.id)) label = 'Maker ruins · searched';
    if (p.type === 'chest' && has(state.opened, p.id)) label = 'An open chest';
    if (p.type === 'note' && has(state.notes, p.id)) label = 'A note from the Old Company · read';
    if (p.type === 'statue' && has(state.glimmers, p.id)) label = 'An unfinished statue of Tamsin · heard';
    const entity = { kind: 'poi', id: p.id, x: p.x, y: p.y, label, poiType: p.type };
    if (p.region) entity.region = p.region;
    if (p.type === 'chest') entity.mimic = !!p.mimic;
    return entity;
  }

  function drop(cx, cy) {
    return cache.delete(`${cx},${cy}`);
  }

  /** Chunk keys within radiusChunks of a tile's chunk, nearest first. */
  function keysAround(tile, radiusChunks = 1) {
    const cx = floorDiv(Math.floor(tile.x), CHUNK);
    const cy = floorDiv(Math.floor(tile.y), CHUNK);
    const list = [];
    for (let dy = -radiusChunks; dy <= radiusChunks; dy += 1) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx += 1) {
        const mx = (cx + dx) * CHUNK + CHUNK / 2;
        const my = (cy + dy) * CHUNK + CHUNK / 2;
        list.push({ key: `${cx + dx},${cy + dy}`, d: Math.hypot(mx - tile.x, my - tile.y) });
      }
    }
    list.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1));
    return list.map((e) => e.key);
  }

  return {
    chunk, ground, objectsIn, blocked, ringObjects, poiAt, entitiesIn, drop, keysAround,
    // additions for the engine, the map view and the tests
    fixedPois, warTable, bannerSpots, bellSpot, ringBlocked, hushAt, hushRegion, regionDistance, terrainAt, poiEntity,
    cached: () => [...cache.keys()],
    get seed() { return S; },
  };
}

