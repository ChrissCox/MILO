// The map view (CONTRACT-PHASE3.md §8, §9 I): the wilds Milo has seen, drawn small in their base
// colours (with the Hush), Hearthvale in the middle, and fog of war over everything else.
//
//   createMapView(root, { paintChunk, valeImage, explored, markers, onTravel, onClose, now })
//     → { open({ center, zoom, focus }), close(), isOpen(), refresh({ repaint, vale }), dispose() }
//
// The top half of this file is pure (viewport maths, visible chunks, the fog field and its dithered
// edge, marker art and hit testing, the travel list) and imports cleanly in Node for the tests. The
// DOM half builds its own contents inside `root` with createElement and textContent only.
//
// How it draws:
// - A chunk (32×32 tiles) is painted lazily, when it first shows, by paintChunk(cx, cy, 8) and
//   reduced to the zoom by each block's most common colour (as the vale is), then cached per zoom.
//   Only chunks with known ground are painted; the rest is parchment.
// - Fog is worked out per tile. Known tiles are those in an explored chunk, in the vale, or within
//   a few tiles of the vale (seen over its walls). Every unknown tile is fog. Known tiles fade from
//   clear to fog as they near the unknown, pushed further in by smooth noise, so the edge wanders
//   like a hand-drawn coast rather than following the chunk grid. The fade is dithered in 2×2-pixel
//   blocks with a Bayer matrix indexed by world blocks (nothing swims as the map pans): first a hush
//   veil over the ground, then parchment, with a darker wash where parchment meets the land.
// - The vale is valeImage() (16 px a tile) reduced into its rectangle, picking each block's most
//   common colour so it stays in the world's palette. Where Hearthvale's sea runs out past its
//   edge, the foam the wilds art draws against it is painted out, and the harbor's mist (which the
//   vale's picture cuts off at its own box and edge) is laid on over the sea as the world view
//   lays it, so the lake has no seam.
// - Region names are kept inside the frame (and clear of the compass), fading as they leave.
// - Markers are small pixel icons at about 2 CSS px a pixel (whole device pixels) on top.
import { PALETTE, rgbaOf } from '../world/sprites.js';
import { fbm, hashInts, unit } from '../world/rng.js';
import { terrainAt as valeTerrainAt, TERRAIN as VALE_TERRAIN, TILE as WORLD_PX_PER_TILE, hash2, placeById } from '../world/map.js';

// ---------- constants ----------

export const ZOOMS = Object.freeze([2, 4, 8]); // art pixels a tile
export const DEFAULT_ZOOM = 4;
export const ZOOM_NAMES = Object.freeze({ 2: 'Far', 4: 'Middle', 8: 'Near' });
export const CHUNK_TILES = 32;
export const VALE = Object.freeze({ x: 0, y: 0, w: 64, h: 44 });
export const VALE_PX_PER_TILE = 16;
/**
 * The fog. A known tile's depth into the known area (tiles from its centre to the unknown) less a
 * push of noise (0..push tiles) is `e`: the fog is whole below `from` and clears over `ramp`
 * tiles. The push only ever reaches inward, so the last known tile before the unknown is always
 * fogged and a chunk's straight edge never shows; where the push is strong the fog wanders further
 * in. `glimpse` is how far past the vale's edge counts as seen (over its walls). `veil` splits
 * the fade between the hush veil and parchment.
 */
export const FOG = Object.freeze({ from: 0.7, ramp: 4, push: 5, reach: 11, glimpse: 6, veil: 0.55, seed: 4099, scale: 8 });
export const ICON_SCALE = 2; // CSS pixels an icon pixel, like the chrome's 2 px grid (whole device pixels)
export const PAN_PAD = 12; // tiles the centre may stray past everything known
export const KEY_PAN_CSS = 64; // CSS px an arrow key pans (three times that with Shift)
export const PAINT_BUDGET_MS = 10;
export const RETRY_MS = 2000; // before asking again for a chunk whose paint came back empty
export const OPEN_BUDGET_MS = 48;

export const BAYER = Object.freeze([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((row) => Object.freeze(row)));

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export const chunkKey = (cx, cy) => `${cx},${cy}`;
export const chunkOf = (tile) => Math.floor(tile / CHUNK_TILES);
export const inVale = (x, y) => x >= VALE.x && y >= VALE.y && x < VALE.x + VALE.w && y < VALE.y + VALE.h;
/** Is the whole chunk inside the vale (so the vale's picture covers it). */
export const chunkInVale = (cx, cy) => inVale(cx * CHUNK_TILES, cy * CHUNK_TILES) && inVale(cx * CHUNK_TILES + CHUNK_TILES - 1, cy * CHUNK_TILES + CHUNK_TILES - 1);

/** Distance in tiles from a tile's centre to the vale's rectangle (0 inside). */
export function valeDistance(x, y) {
  const dx = Math.max(0, VALE.x - (x + 0.5), x + 0.5 - (VALE.x + VALE.w));
  const dy = Math.max(0, VALE.y - (y + 0.5), y + 0.5 - (VALE.y + VALE.h));
  return Math.hypot(dx, dy);
}

/** A Set of 'cx,cy' keys from a Set, an array or any iterable (anything else is empty). */
export function toExploredSet(value) {
  if (value instanceof Set) return value;
  const out = new Set();
  if (value == null || typeof value === 'string' || typeof value[Symbol.iterator] !== 'function') return out;
  for (const key of value) if (typeof key === 'string' && /^-?\d+,-?\d+$/.test(key)) out.add(key);
  return out;
}

// ---------- zoom and the viewport ----------

export function normalizeZoom(zoom) {
  const n = Number(zoom);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM;
  return ZOOMS.reduce((best, z) => (Math.abs(z - n) < Math.abs(best - n) ? z : best), ZOOMS[0]);
}

/** The next zoom in or out (dir > 0 is closer), held at the ends. */
export function zoomStep(zoom, dir) {
  const i = ZOOMS.indexOf(normalizeZoom(zoom));
  return ZOOMS[clamp(i + Math.sign(dir || 0), 0, ZOOMS.length - 1)];
}

/** Device pixels an icon pixel at a device pixel ratio: about ICON_SCALE CSS pixels, never blurred. */
export const iconScaleFor = (dpr = 1) => Math.max(ICON_SCALE, Math.round(ICON_SCALE * (Number(dpr) || 1)));

/**
 * A view: its centre (cx, cy) in tiles, its zoom (art pixels a tile), `pixel` (device pixels an art
 * pixel, a whole number so the art stays crisp), `icon` (device pixels a marker icon pixel) and its
 * size in device pixels.
 */
export function makeView({ cx = VALE.x + VALE.w / 2, cy = VALE.y + VALE.h / 2, zoom = DEFAULT_ZOOM, pixel = 1, icon = null, width = 0, height = 0 } = {}) {
  const px = Math.max(1, Math.round(finite(Number(pixel), 1)));
  return {
    cx: finite(Number(cx), VALE.x + VALE.w / 2),
    cy: finite(Number(cy), VALE.y + VALE.h / 2),
    zoom: normalizeZoom(zoom),
    pixel: px,
    icon: icon == null || !(Number(icon) >= 1) ? ICON_SCALE * px : Math.round(Number(icon)),
    width: Math.max(0, Math.round(finite(Number(width), 0))),
    height: Math.max(0, Math.round(finite(Number(height), 0))),
  };
}

export const tilePx = (view) => view.zoom * view.pixel;

/** Device pixel of world tile (0, 0): whole pixels, so chunks meet without a seam. */
export function viewOrigin(view) {
  const t = tilePx(view);
  return { x: Math.round(view.width / 2 - view.cx * t), y: Math.round(view.height / 2 - view.cy * t) };
}

export function tileToScreen(view, x, y) {
  const o = viewOrigin(view);
  const t = tilePx(view);
  return { x: o.x + x * t, y: o.y + y * t };
}

export function screenToTile(view, sx, sy) {
  const o = viewOrigin(view);
  const t = tilePx(view);
  return { x: (sx - o.x) / t, y: (sy - o.y) / t };
}

/** The tiles the view shows (floats, x1/y1 exclusive). */
export function viewRect(view) {
  const a = screenToTile(view, 0, 0);
  const b = screenToTile(view, view.width, view.height);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/** Chunks the view touches (plus `margin` chunks round it), nearest the centre first. */
export function visibleChunks(view, margin = 0) {
  const r = viewRect(view);
  const cx0 = chunkOf(Math.floor(r.x0)) - margin;
  const cy0 = chunkOf(Math.floor(r.y0)) - margin;
  const cx1 = chunkOf(Math.ceil(r.x1) - 1) + margin;
  const cy1 = chunkOf(Math.ceil(r.y1) - 1) + margin;
  const mx = view.cx / CHUNK_TILES - 0.5;
  const my = view.cy / CHUNK_TILES - 0.5;
  const out = [];
  for (let cy = cy0; cy <= cy1; cy += 1) {
    for (let cx = cx0; cx <= cx1; cx += 1) out.push({ cx, cy, key: chunkKey(cx, cy), d: (cx - mx) ** 2 + (cy - my) ** 2 });
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Drag by (dx, dy) device pixels: the ground follows the pointer. */
export function panView(view, dx, dy) {
  const t = tilePx(view);
  return { ...view, cx: view.cx - dx / t, cy: view.cy - dy / t };
}

/** A new zoom that keeps the tile under (sx, sy) where it is on screen. */
export function zoomView(view, zoom, sx = view.width / 2, sy = view.height / 2) {
  const next = { ...view, zoom: normalizeZoom(zoom) };
  const at = screenToTile(view, sx, sy);
  const t = tilePx(next);
  next.cx = at.x - (sx - view.width / 2) / t;
  next.cy = at.y - (sy - view.height / 2) / t;
  return next;
}

/** Everything known, in tiles: the vale, every explored chunk and every marker. */
export function knownBounds(explored, markers = []) {
  let x0 = VALE.x;
  let y0 = VALE.y;
  let x1 = VALE.x + VALE.w;
  let y1 = VALE.y + VALE.h;
  for (const key of toExploredSet(explored)) {
    const [cx, cy] = key.split(',').map(Number);
    x0 = Math.min(x0, cx * CHUNK_TILES);
    y0 = Math.min(y0, cy * CHUNK_TILES);
    x1 = Math.max(x1, (cx + 1) * CHUNK_TILES);
    y1 = Math.max(y1, (cy + 1) * CHUNK_TILES);
  }
  for (const m of markers || []) {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    x0 = Math.min(x0, m.x);
    y0 = Math.min(y0, m.y);
    x1 = Math.max(x1, m.x + 1);
    y1 = Math.max(y1, m.y + 1);
  }
  return { x0, y0, x1, y1 };
}

/** Keeps the centre over the known world (plus `pad` tiles), so the map can't get lost in fog. */
export function clampCenter(view, bounds, pad = PAN_PAD) {
  return { ...view, cx: clamp(view.cx, bounds.x0 - pad, bounds.x1 + pad), cy: clamp(view.cy, bounds.y0 - pad, bounds.y1 + pad) };
}

// ---------- fog of war ----------

const OFFSETS = (() => {
  const list = [];
  const R = FOG.reach;
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > 0 && d <= R) list.push([dx, dy, d]);
    }
  }
  return list.sort((a, b) => a[2] - b[2]);
})();

/** Is this tile known: in the vale, near it, or in an explored chunk. */
export function knownAt(explored, x, y) {
  return inVale(x, y) || valeDistance(x, y) <= FOG.glimpse || toExploredSet(explored).has(chunkKey(chunkOf(x), chunkOf(y)));
}

/** 2 when every tile of the chunk is known, 1 when some are, 0 when none are. */
export function chunkStatus(explored, cx, cy) {
  if (toExploredSet(explored).has(chunkKey(cx, cy))) return 2;
  return valeStatus(cx, cy);
}

// How much of a chunk the vale (and the glimpse round it) covers: fixed, so worked out once.
const valeStatusMemo = new Map();
function valeStatus(cx, cy) {
  const g = FOG.glimpse;
  const x0 = cx * CHUNK_TILES;
  const y0 = cy * CHUNK_TILES;
  const x1 = x0 + CHUNK_TILES;
  const y1 = y0 + CHUNK_TILES;
  // Clear of the vale grown by the glimpse: nothing known. Near it, count tile by tile, once.
  if (x1 <= VALE.x - g - 1 || y1 <= VALE.y - g - 1 || x0 >= VALE.x + VALE.w + g + 1 || y0 >= VALE.y + VALE.h + g + 1) return 0;
  const key = chunkKey(cx, cy);
  const memo = valeStatusMemo.get(key);
  if (memo !== undefined) return memo;
  let known = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (inVale(x, y) || valeDistance(x, y) <= g) known += 1;
  const status = known === 0 ? 0 : known === CHUNK_TILES * CHUNK_TILES ? 2 : 1;
  valeStatusMemo.set(key, status);
  return status;
}

/**
 * The chunk and its eight neighbours: `sig` (their statuses, for caches) and `kind`: 'fog' when
 * the chunk holds no known tile, 'clear' when it and all its neighbours are wholly known, and
 * 'edge' otherwise. The fog reaches under ten tiles, so the neighbours decide everything.
 */
export function neighbourhood(explored, cx, cy) {
  const set = toExploredSet(explored);
  let sig = '';
  let all = true;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const s = chunkStatus(set, cx + dx, cy + dy);
      sig += s;
      if (s !== 2) all = false;
    }
  }
  const self = Number(sig[4]);
  return { sig, self, kind: self === 0 ? 'fog' : all ? 'clear' : 'edge' };
}

/** How far (0..1 of FOG.push) the fog reaches in past its edge at a tile: smooth, wandering noise. */
export function fogPush(x, y, seed = FOG.seed) {
  const broad = clamp01((fbm(x / FOG.scale, y / FOG.scale, seed, { octaves: 3 }) - 0.36) / 0.34);
  // A floor with a fine wobble of its own, so even where the broad push rests the edge never runs
  // dead straight along a chunk's side.
  const fine = fbm(x / 2.6, y / 2.6, seed + 17, { octaves: 2 });
  return clamp01(0.08 + 0.92 * broad + (fine - 0.5) * 0.24);
}

/**
 * Fog per tile for a chunk and a one-tile border: Float32Array(34 × 34), 0 clear to 1 whole fog,
 * index (j + 1) * 34 + (i + 1) for tile (cx·32 + i, cy·32 + j). Vale tiles are always clear.
 */
export function fogField(explored, cx, cy, { seed = FOG.seed } = {}) {
  const set = toExploredSet(explored);
  const R = FOG.reach;
  const M = R + 1;
  const W = CHUNK_TILES + 2 * M;
  const X0 = cx * CHUNK_TILES - M;
  const Y0 = cy * CHUNK_TILES - M;
  const grid = new Uint8Array(W * W);
  const memo = new Map();
  for (let j = 0; j < W; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const x = X0 + i;
      const y = Y0 + j;
      let known = inVale(x, y) || valeDistance(x, y) <= FOG.glimpse;
      if (!known) {
        const key = chunkKey(chunkOf(x), chunkOf(y));
        let v = memo.get(key);
        if (v === undefined) { v = set.has(key); memo.set(key, v); }
        known = v;
      }
      grid[j * W + i] = known ? 1 : 0;
    }
  }
  const S = CHUNK_TILES + 2;
  const out = new Float32Array(S * S);
  for (let j = -1; j <= CHUNK_TILES; j += 1) {
    for (let i = -1; i <= CHUNK_TILES; i += 1) {
      const x = cx * CHUNK_TILES + i;
      const y = cy * CHUNK_TILES + j;
      const o = (j + 1) * S + (i + 1);
      if (inVale(x, y)) { out[o] = 0; continue; }
      const gi = (j + M) * W + (i + M);
      if (!grid[gi]) { out[o] = 1; continue; }
      let dist = R + 0.5;
      for (let k = 0; k < OFFSETS.length; k += 1) {
        const [dx, dy, d] = OFFSETS[k];
        if (!grid[gi + dy * W + dx]) { dist = d; break; }
      }
      const e = dist - 0.5 - fogPush(x, y, seed) * FOG.push;
      out[o] = clamp01((FOG.from + FOG.ramp - e) / FOG.ramp);
    }
  }
  return out;
}

/**
 * The fog's dithered edge for a chunk at a zoom: one level per 2×2-pixel block (0 clear, 1 hush
 * veil, 2 parchment), with a one-block border. Blocks are indexed by world block, so the pattern
 * is fixed to the ground. → { per (blocks a tile side), n (blocks a chunk side), N (n + 2), levels }
 */
export function fogLevels(field, cx, cy, zoom) {
  const per = Math.max(1, Math.round(normalizeZoom(zoom) / 2));
  const n = CHUNK_TILES * per;
  const N = n + 2;
  const S = CHUNK_TILES + 2;
  const levels = new Uint8Array(N * N);
  const bx0 = cx * n;
  const by0 = cy * n;
  for (let bj = -1; bj <= n; bj += 1) {
    const v = (bj + 0.5) / per - 0.5;
    const j0 = Math.floor(v);
    const fv = v - j0;
    const r0 = clamp(j0 + 1, 0, S - 1) * S;
    const r1 = clamp(j0 + 2, 0, S - 1) * S;
    const bayer = BAYER[(by0 + bj) & 3];
    for (let bi = -1; bi <= n; bi += 1) {
      const u = (bi + 0.5) / per - 0.5;
      const i0 = Math.floor(u);
      const fu = u - i0;
      const c0 = clamp(i0 + 1, 0, S - 1);
      const c1 = clamp(i0 + 2, 0, S - 1);
      const a = field[r0 + c0];
      const b = field[r0 + c1];
      const c = field[r1 + c0];
      const d = field[r1 + c1];
      const f = a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
      const t = (bayer[(bx0 + bi) & 3] + 0.5) / 16;
      let level = 0;
      if (f >= 0.999 || t < clamp01((f - FOG.veil) / (1 - FOG.veil))) level = 2;
      else if (t < clamp01(f / FOG.veil)) level = 1;
      levels[(bj + 1) * N + (bi + 1)] = level;
    }
  }
  return { per, n, N, levels };
}

// ---------- parchment ----------

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const PARCHMENT = Object.freeze({
  base: Object.freeze(hexRgb('#e9e3d1')),
  light: Object.freeze(hexRgb('#f1ecdf')),
  shade: Object.freeze(hexRgb('#e0d9c4')),
  speck: Object.freeze(hexRgb('#d2cab3')),
  edge: Object.freeze(hexRgb('#cfc4a8')),
});
export const PARCHMENT_CSS = '#e9e3d1';

/** Parchment for one world block: a soft mottle of two tones and a few specks. */
export function parchmentAt(wbx, wby) {
  if (unit(hashInts(wbx, wby, 7919)) < 0.012) return PARCHMENT.speck;
  const n = fbm(wbx / 26, wby / 26, 311, { octaves: 2 });
  const t = (BAYER[wby & 3][wbx & 3] + 0.5) / 16;
  if (t < clamp01((n - 0.53) / 0.14) * 0.8) return PARCHMENT.light;
  if (t < clamp01((0.47 - n) / 0.14) * 0.6) return PARCHMENT.shade;
  return PARCHMENT.base;
}

/** The hush veil over a ground colour: pulled toward its grey, lifted, and a little parchment. */
export function veilColour(r, g, b) {
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const P = PARCHMENT.base;
  return [r, g, b].map((c, i) => {
    const pulled = c + (grey - c) * 0.55;
    const lifted = pulled + (255 - pulled) * 0.06;
    return Math.round(lifted + (P[i] - lifted) * 0.34);
  });
}

/**
 * One chunk's pixels at a zoom (32·zoom a side): the art where it's clear, the veil and parchment
 * where the fog lies. `art` is RGBA (or null for a chunk of fog), `fog` is fogLevels() output (or
 * null for fog everywhere). Parchment that meets a clearer block takes the edge wash.
 */
export function composeChunk(art, fog, cx, cy, zoom) {
  const z = normalizeZoom(zoom);
  const S = CHUNK_TILES * z;
  const out = new Uint8ClampedArray(S * S * 4);
  const n = S >> 1;
  const N = n + 2;
  const levels = fog ? fog.levels : null;
  const levelAt = (bi, bj) => (levels ? levels[(bj + 1) * N + (bi + 1)] : 2);
  const bx0 = cx * n;
  const by0 = cy * n;
  const veils = new Map();
  for (let bj = 0; bj < n; bj += 1) {
    for (let bi = 0; bi < n; bi += 1) {
      const level = levelAt(bi, bj);
      let rgb = null;
      if (level === 2) {
        const edge = levels && (levelAt(bi - 1, bj) < 2 || levelAt(bi + 1, bj) < 2 || levelAt(bi, bj - 1) < 2 || levelAt(bi, bj + 1) < 2);
        rgb = edge ? PARCHMENT.edge : parchmentAt(bx0 + bi, by0 + bj);
      }
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const p = ((bj * 2 + dy) * S + bi * 2 + dx) * 4;
          if (rgb) {
            out[p] = rgb[0]; out[p + 1] = rgb[1]; out[p + 2] = rgb[2]; out[p + 3] = 255;
            continue;
          }
          if (!art || art[p + 3] === 0) continue; // the vale's own pixels stay clear for its picture
          if (level === 0) {
            out[p] = art[p]; out[p + 1] = art[p + 1]; out[p + 2] = art[p + 2]; out[p + 3] = 255;
            continue;
          }
          const packed = (art[p] << 16) | (art[p + 1] << 8) | art[p + 2];
          let v = veils.get(packed);
          if (!v) { v = veilColour(art[p], art[p + 1], art[p + 2]); veils.set(packed, v); }
          out[p] = v[0]; out[p + 1] = v[1]; out[p + 2] = v[2]; out[p + 3] = 255;
        }
      }
    }
  }
  return out;
}

// ---------- where the wilds meet the vale ----------

/** Is this tile open water on Hearthvale's own map (outside the vale, never). */
export const valeWaterAt = (x, y) => inVale(x, y) && valeTerrainAt(x, y) === VALE_TERRAIN.WATER;

/** Does the chunk hold any tile of the ring round the vale, where the two maps meet. */
export function chunkTouchesValeEdge(cx, cy) {
  const x0 = cx * CHUNK_TILES;
  const y0 = cy * CHUNK_TILES;
  return !chunkInVale(cx, cy)
    && x0 + CHUNK_TILES > VALE.x - 1 && x0 <= VALE.x + VALE.w
    && y0 + CHUNK_TILES > VALE.y - 1 && y0 <= VALE.y + VALE.h;
}

/**
 * The wilds' map art takes Hearthvale for land, so where the lake runs out of the vale it draws a
 * dashed line of foam along the vale's edge. This paints that line over with the water just beyond
 * it wherever the vale's own edge tile is water, and the lake runs on without a seam (foam stays
 * where wild water meets the vale's land). `rgba` is a chunk's pixels at `ppt` px a tile, changed in
 * place; foam is one art pixel wide (ppt / 8 px from 16 up). → how many tile edges were mended.
 */
export function mendValeSeam(rgba, cx, cy, ppt, valeWater = valeWaterAt) {
  const p = Math.round(Number(ppt));
  const S = CHUNK_TILES * p;
  const band = Math.max(1, Math.floor(p / 8));
  if (!(p >= 2) || !rgba || rgba.length < S * S * 4 || !chunkTouchesValeEdge(cx, cy)) return 0;
  const X0 = cx * CHUNK_TILES;
  const Y0 = cy * CHUNK_TILES;
  let mended = 0;
  // Copies pixel (sx, sy) over (dx, dy), both local to the tile at (i, j) in the chunk.
  const copy = (i, j, dx, dy, sx, sy) => {
    const d = ((j * p + dy) * S + i * p + dx) * 4;
    const s = ((j * p + sy) * S + i * p + sx) * 4;
    rgba[d] = rgba[s]; rgba[d + 1] = rgba[s + 1]; rgba[d + 2] = rgba[s + 2]; rgba[d + 3] = rgba[s + 3];
  };
  const mend = (x, y, side) => {
    const i = x - X0;
    const j = y - Y0;
    if (i < 0 || j < 0 || i >= CHUNK_TILES || j >= CHUNK_TILES) return;
    for (let k = 0; k < band; k += 1) {
      for (let t = 0; t < p; t += 1) {
        if (side === 'west') copy(i, j, k, t, k + band, t); // the vale lies west of this tile
        else if (side === 'east') copy(i, j, p - 1 - k, t, p - 1 - k - band, t);
        else if (side === 'north') copy(i, j, t, k, t, k + band);
        else copy(i, j, t, p - 1 - k, t, p - 1 - k - band);
      }
    }
    mended += 1;
  };
  for (let y = Math.max(VALE.y, Y0); y < Math.min(VALE.y + VALE.h, Y0 + CHUNK_TILES); y += 1) {
    if (valeWater(VALE.x + VALE.w - 1, y)) mend(VALE.x + VALE.w, y, 'west');
    if (valeWater(VALE.x, y)) mend(VALE.x - 1, y, 'east');
  }
  for (let x = Math.max(VALE.x, X0); x < Math.min(VALE.x + VALE.w, X0 + CHUNK_TILES); x += 1) {
    if (valeWater(x, VALE.y + VALE.h - 1)) mend(x, VALE.y + VALE.h, 'north');
    if (valeWater(x, VALE.y)) mend(x, VALE.y - 1, 'south');
  }
  return mended;
}

// ---------- the harbor's mist ----------

const HARBOR_AREA = placeById('harbor')?.area || { x: 44, y: 31, w: 16, h: 13 };
const MIST_BOX = Object.freeze({ x: HARBOR_AREA.x - 3, y: HARBOR_AREA.y - 3, w: HARBOR_AREA.w + 6, h: HARBOR_AREA.h + 6 });
/**
 * The fog bank over Hearthvale's harbor, as the engine bakes it (src/world/engine.js, bakeFog and
 * FOG_CIRCLES): circles [x, y, r] in tiles (y squashed by 1.15), a little smooth noise, and three
 * steps of cream. The vale's picture (renderMap) holds the mist to `box` and stops at the vale's
 * edge; the world view lets the bank run on to `outer`, where it has faded to nothing. The map lays
 * on what the picture leaves out, so the mist fades over the sea instead of ending in a straight
 * line. tests/mapview.test.js checks these numbers against the engine's source.
 */
export const HARBOR_MIST = Object.freeze({
  circles: Object.freeze([[50.5, 37, 7.5], [46, 35.5, 5], [55.5, 35, 5.5], [53, 41, 6.5], [46.5, 41, 5], [59, 39, 5.5], [50, 33.5, 4]].map((c) => Object.freeze(c))),
  squash: 1.15,
  noise: Object.freeze({ cell: 22, seed: 101, amount: 0.18 }),
  box: MIST_BOX,
  outer: Object.freeze({ x: MIST_BOX.x, y: MIST_BOX.y, w: MIST_BOX.w + 3, h: MIST_BOX.h + 2 }),
  tint: Object.freeze((rgbaOf('c') || [255, 246, 226]).slice(0, 3)),
});

// The engine's smooth value noise (src/world/engine.js), on map.js's hash.
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

const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** How thick the harbor's mist is at a world pixel (16 a tile): 0, or its alpha, 0.24, 0.42 or 0.58. */
export function harborMistAt(px, py) {
  const { circles, squash, noise, outer } = HARBOR_MIST;
  const wx = px / WORLD_PX_PER_TILE;
  const wy = py / WORLD_PX_PER_TILE;
  if (!inRect(outer, wx, wy)) return 0;
  let density = 0;
  for (const [cx, cy, r] of circles) {
    const d = Math.hypot(wx - cx, (wy - cy) * squash) / r;
    if (d < 1) density = Math.max(density, 1 - d);
  }
  if (density <= 0) return 0;
  density += (smoothNoise(px, py, noise.cell, noise.seed) - 0.5) * noise.amount * Math.min(1, density * 4);
  if (density <= 0.05) return 0;
  return density > 0.42 ? 0.58 : density > 0.2 ? 0.42 : 0.24;
}

/** Does the chunk hold wild ground under the harbor's mist. */
export function chunkTouchesMist(cx, cy) {
  const { outer } = HARBOR_MIST;
  const x0 = cx * CHUNK_TILES;
  const y0 = cy * CHUNK_TILES;
  return !chunkInVale(cx, cy) && x0 < outer.x + outer.w && x0 + CHUNK_TILES > outer.x && y0 < outer.y + outer.h && y0 + CHUNK_TILES > outer.y;
}

/**
 * Lays the harbor's mist over RGBA pixels, in place, blending its cream as a canvas would. `rgba` is
 * `width`×`height` at `ppt` px a tile with its top-left at tile (tx, ty). `part` says which mist is
 * missing there: 'wilds' (a chunk's own pixels, outside the vale; clear pixels stay clear) or 'vale'
 * (the vale's picture, where it lies outside the box renderMap draws). → how many pixels changed.
 */
export function layHarborMist(rgba, tx, ty, width, height, ppt, part = 'wilds') {
  const p = Number(ppt);
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!rgba || !(p > 0) || !(w > 0) || !(h > 0) || rgba.length < w * h * 4 || !Number.isFinite(tx) || !Number.isFinite(ty)) return 0;
  const { outer, box, tint } = HARBOR_MIST;
  const f = WORLD_PX_PER_TILE / p; // world px an art pixel
  const i0 = clamp(Math.floor((outer.x - tx) * p), 0, w);
  const i1 = clamp(Math.ceil((outer.x + outer.w - tx) * p), 0, w);
  const j0 = clamp(Math.floor((outer.y - ty) * p), 0, h);
  const j1 = clamp(Math.ceil((outer.y + outer.h - ty) * p), 0, h);
  const wantVale = part === 'vale';
  let changed = 0;
  for (let j = j0; j < j1; j += 1) {
    const y = ty + Math.floor(j / p);
    const py = (ty * p + j + 0.5) * f - 0.5;
    for (let i = i0; i < i1; i += 1) {
      const x = tx + Math.floor(i / p);
      if (wantVale ? !inVale(x, y) || inRect(box, x, y) : inVale(x, y)) continue;
      const o = (j * w + i) * 4;
      if (!wantVale && rgba[o + 3] === 0) continue;
      const a = harborMistAt((tx * p + i + 0.5) * f - 0.5, py);
      if (!a) continue;
      const A = Math.round(255 * a) / 255;
      rgba[o] = Math.round(tint[0] * A + rgba[o] * (1 - A));
      rgba[o + 1] = Math.round(tint[1] * A + rgba[o + 1] * (1 - A));
      rgba[o + 2] = Math.round(tint[2] * A + rgba[o + 2] * (1 - A));
      changed += 1;
    }
  }
  return changed;
}

/**
 * Where a region's name goes: over its anchor, nudged to sit wholly inside the map (with `margin`),
 * so a name is never cut by the frame. While the anchor is on screen the name is whole; as the
 * anchor leaves, the name stays at the edge and fades out over `fade` px, so panning never pops it.
 * It also steps round `avoid` rects ({ x, y, w, h }, like the compass chip): up or to the side,
 * whichever is the shorter move that stays inside. All in device px; x is the text's centre and y
 * its baseline. → { x, y, alpha }
 */
export function placeLabel(anchor, size, box, margin = 6, fade = 48, avoid = []) {
  const minX = size.w / 2 + margin;
  const maxX = Math.max(minX, box.w - size.w / 2 - margin);
  const minY = size.h + margin;
  const maxY = Math.max(minY, box.h - margin);
  let x = clamp(anchor.x, minX, maxX);
  let y = clamp(anchor.y, minY, maxY);
  for (const r of avoid || []) {
    if (!r || !(r.w > 0) || !(r.h > 0)) continue;
    const hits = x + size.w / 2 > r.x - margin && x - size.w / 2 < r.x + r.w + margin && y > r.y - margin && y - size.h < r.y + r.h + margin;
    if (!hits) continue;
    const moves = [
      { x, y: r.y - margin }, // above it
      { x, y: r.y + r.h + margin + size.h }, // below it
      { x: r.x + r.w + margin + size.w / 2, y }, // to its right
      { x: r.x - margin - size.w / 2, y }, // to its left
    ].filter((m) => m.x >= minX && m.x <= maxX && m.y >= minY && m.y <= maxY);
    if (!moves.length) continue;
    moves.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    ({ x, y } = moves[0]);
  }
  const outX = Math.max(0, -anchor.x, anchor.x - box.w);
  const outY = Math.max(0, -anchor.y, anchor.y - (box.h + size.h));
  const alpha = clamp01(1 - Math.hypot(outX, outY) / Math.max(1, fade));
  return { x: Math.round(x), y: Math.round(y), alpha: Math.round(alpha * 100) / 100 };
}

// ---------- the vale, made small ----------

// The art's outline ink. Outlines are one pixel wide at full size, so a block that is mostly
// outline is really the thin edge of something (a fence's rails, a roof's rim): ink counts half,
// and wins a block only when little else is there. Shrunk fences read as fences, not ink bars.
const OUTLINE_INK = (() => {
  const [r, g, b] = hexRgb(PALETTE.o?.hex || '#3d4038');
  return (r << 16) | (g << 8) | b;
})();

/**
 * Shrinks RGBA pixel art by a whole factor, keeping each block's most common opaque colour (ties go
 * to the first seen; the outline ink counts half), so the result stays in the art's own palette
 * instead of blurring.
 */
export function downscaleMode(src, width, height, factor) {
  const f = Math.max(1, Math.round(factor));
  const w = Math.floor(width / f);
  const h = Math.floor(height / f);
  const out = new Uint8ClampedArray(w * h * 4);
  const colours = new Int32Array(f * f);
  const counts = new Int32Array(f * f);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let used = 0;
      for (let j = 0; j < f; j += 1) {
        let p = ((y * f + j) * width + x * f) * 4;
        for (let i = 0; i < f; i += 1, p += 4) {
          if (src[p + 3] < 128) continue;
          const c = (src[p] << 16) | (src[p + 1] << 8) | src[p + 2];
          let k = 0;
          while (k < used && colours[k] !== c) k += 1;
          if (k === used) { colours[used] = c; counts[used] = 0; used += 1; }
          counts[k] += c === OUTLINE_INK ? 1 : 2;
        }
      }
      if (!used) continue;
      let best = 0;
      for (let k = 1; k < used; k += 1) if (counts[k] > counts[best]) best = k;
      const c = colours[best];
      const o = (y * w + x) * 4;
      out[o] = (c >> 16) & 255; out[o + 1] = (c >> 8) & 255; out[o + 2] = c & 255; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// ---------- markers ----------

export const MARKER_KINDS = Object.freeze(['milo', 'lantern', 'rift', 'poi', 'region', 'home']);

// Genre colours for a rift's tear when a marker brings none: rim, inner and ink from content/genres.json.
export const GENRE_TINTS = Object.freeze({
  neon: { rim: [54, 241, 255], inner: [255, 46, 136], ink: [10, 7, 20] },
  nocturne: { rim: [255, 200, 94], inner: [255, 143, 189], ink: [11, 14, 34] },
  gothic: { rim: [245, 195, 92], inner: [168, 50, 75], ink: [23, 18, 26] },
  iron: { rim: [246, 182, 74], inner: [162, 69, 42], ink: [34, 26, 20] },
  void: { rim: [125, 255, 181], inner: [164, 92, 255], ink: [5, 3, 12] },
  noir: { rim: [242, 238, 224], inner: [179, 32, 42], ink: [15, 15, 16] },
  frontier: { rim: [255, 197, 97], inner: [184, 83, 47], ink: [42, 26, 16] },
  kaiju: { rim: [255, 243, 92], inner: [209, 74, 58], ink: [16, 19, 28] },
  verdant: { rim: [255, 242, 122], inner: [69, 184, 97], ink: [34, 51, 31] },
  starlight: { rim: [255, 243, 163], inner: [255, 121, 184], ink: [58, 35, 80] },
  summit: { rim: [255, 227, 138], inner: [63, 138, 120], ink: [29, 42, 42] },
  backhalls: { rim: [255, 248, 200], inner: [216, 201, 122], ink: [58, 53, 34] },
});
const DEFAULT_TINT = { rim: [255, 222, 150], inner: [168, 152, 207], ink: [61, 64, 56] };

// Icons: palette keys, '.' clear; digits are per-marker colours. Every icon is centred on its tile.
const ICON = {
  milo: [
    '..oooo..',
    '.ommmmo.',
    'ommbmmmo',
    'omttttmo',
    'otottoto',
    'otkttkto',
    '.otttto.',
    'ouUrrUuo',
    '.oooooo.',
  ],
  lantern: [
    '...o...',
    '..oRo..',
    '.oRRRo.',
    '.ooooo.',
    '.oucUo.',
    '.ouuUo.',
    '.oUUUo.',
    '.ooooo.',
    '..obo..',
    '.ooooo.',
  ],
  home: [
    '.....o.....',
    '....oro....',
    '...orrRo...',
    '..orrrrRo..',
    '.orrrrrrRo.',
    'ooooooooooo',
    '.occcooCCo.',
    '.ocucobCCo.',
    '.occcobCCo.',
    '.ooooooooo.',
  ],
  // 3 ink, 1 rim, 2 inner, 4 the second genre's inner (a fusion), 5 a light core
  hairline: [
    '.3.',
    '313',
    '323',
    '313',
    '343',
    '313',
    '.3.',
  ],
  open: [
    '..3..',
    '.313.',
    '.323.',
    '31243',
    '32413',
    '31253',
    '32413',
    '.343.',
    '.313.',
    '..3..',
  ],
  gaping: [
    '...3...',
    '..313..',
    '..323..',
    '.31243.',
    '.32413.',
    '3124513',
    '3215423',
    '3124513',
    '.32413.',
    '.31243.',
    '..323..',
    '..313..',
    '...3...',
  ],
  poi: [
    '..o..',
    '.o6o.',
    'o676o',
    '.o7o.',
    '..o..',
  ],
};
const SLEEPING = { R: 'S', u: 's', c: 's', U: 'z', b: 'S' };

// Point-of-interest colours by type: [light, shade] palette keys.
const POI_TONES = {
  ruin: ['s', 'S'], cave: ['S', 'z'], chest: ['U', 'Y'], note: ['c', 'C'], hamlet: ['r', 'R'], statue: ['s', 'z'],
  landmark: ['e', 'E'], quay: ['b', 'B'], ore: ['S', 'z'], herbs: ['q', 'l'], fishing: ['w', 'W'], gate: ['b', 'B'],
};

const BASE_RGB = Object.fromEntries(Object.entries(PALETTE).filter(([, v]) => v.hex.startsWith('#')).map(([k, v]) => [k, hexRgb(v.hex)]));

/** A colour from '#rrggbb', [r, g, b] or nothing. */
export function toRgb(value) {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)) return value.slice(0, 3).map((v) => clamp(Math.round(v), 0, 255));
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return hexRgb(value);
  return null;
}

/** A rift marker's tear colours: from its `colour` ({ rim, inner, ink }, one colour, or none), then its genre. */
export function riftTint(marker = {}) {
  const genres = Array.isArray(marker.genres) ? marker.genres : [marker.genre];
  const known = GENRE_TINTS[genres[0]] || DEFAULT_TINT;
  const colour = marker.colour ?? marker.color;
  let tint = { ...known };
  if (colour && typeof colour === 'object' && !Array.isArray(colour)) {
    tint = { rim: toRgb(colour.rim) || known.rim, inner: toRgb(colour.inner) || known.inner, ink: toRgb(colour.ink) || known.ink };
  } else if (toRgb(colour)) tint = { ...known, inner: toRgb(colour) };
  const second = genres[1] && GENRE_TINTS[genres[1]] ? GENRE_TINTS[genres[1]].inner : tint.inner;
  const core = tint.inner.map((c, i) => Math.round(c + (tint.rim[i] - c) * 0.6));
  return { ...tint, second, core };
}

/**
 * A marker's icon: { rows, colours (key → [r, g, b]), w, h, anchor } where the anchor is the icon
 * pixel that sits on the marker's tile centre. Region markers have no icon (they're a label).
 */
export function markerArt(marker) {
  const kind = marker?.kind;
  if (kind === 'region' || !MARKER_KINDS.includes(kind)) return null;
  let rows;
  const colours = { ...BASE_RGB };
  if (kind === 'milo') rows = ICON.milo;
  else if (kind === 'home') rows = ICON.home;
  else if (kind === 'lantern') rows = marker.lit ? ICON.lantern : ICON.lantern.map((row) => [...row].map((ch) => SLEEPING[ch] || ch).join(''));
  else if (kind === 'rift') {
    rows = ICON[marker.stage === 'hairline' || marker.stage === 'gaping' ? marker.stage : 'open'];
    const tint = riftTint(marker);
    Object.assign(colours, { 1: tint.rim, 2: tint.inner, 3: tint.ink, 4: tint.second, 5: tint.core });
  } else {
    rows = ICON.poi;
    const [light, shade] = POI_TONES[marker.type || marker.poiType] || ['c', 'C'];
    Object.assign(colours, { 6: BASE_RGB[light], 7: BASE_RGB[shade] });
  }
  const w = rows[0].length;
  const h = rows.length;
  return { rows, colours, w, h, anchor: { x: Math.floor(w / 2), y: Math.floor(h / 2) } };
}

/** Draw order, back to front. Lit lanterns sit over sleeping ones; Milo is always on top. */
export function markerLayer(marker) {
  const kind = marker?.kind;
  if (kind === 'region') return 0;
  if (kind === 'poi') return 1;
  if (kind === 'lantern') return marker.lit ? 3 : 2;
  if (kind === 'home') return 4;
  if (kind === 'rift') return 5;
  if (kind === 'milo') return 6;
  return 1;
}

const validMarker = (m) => m && typeof m === 'object' && MARKER_KINDS.includes(m.kind) && Number.isFinite(m.x) && Number.isFinite(m.y);

/** Cleans a markers list: known kinds with whole-number tiles, a label and an id, drawn back to front. */
export function normalizeMarkers(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((m, i) => {
    if (!validMarker(m)) return;
    let id = typeof m.id === 'string' && m.id ? m.id : `${m.kind}:${Math.round(m.x)},${Math.round(m.y)}`;
    if (seen.has(id)) id = `${id}#${i}`;
    seen.add(id);
    const label = typeof m.label === 'string' && m.label.trim() ? m.label.trim().slice(0, 80) : DEFAULT_LABELS[m.kind];
    out.push({ ...m, id, label, x: Math.round(m.x), y: Math.round(m.y), travel: m.travel === true });
  });
  return out.sort((a, b) => markerLayer(a) - markerLayer(b));
}
const DEFAULT_LABELS = { milo: 'Milo', lantern: 'A lantern', rift: 'A rift', poi: 'Something to see', region: 'A region', home: 'Home' };

/** Where a marker's icon sits on screen: its centre and a radius for pointing at it (device px). */
export function markerHotspot(marker, view) {
  const art = markerArt(marker);
  if (!art) return null;
  const s = view.icon || ICON_SCALE * view.pixel;
  const at = tileToScreen(view, marker.x + 0.5, marker.y + 0.5);
  const left = Math.round(at.x) - art.anchor.x * s;
  const top = Math.round(at.y) - art.anchor.y * s;
  return { x: left + (art.w * s) / 2, y: top + (art.h * s) / 2, r: (Math.max(art.w, art.h) * s) / 2, left, top, w: art.w * s, h: art.h * s };
}

/**
 * The marker under a point (device px): the nearest within its icon or `slop` device pixels of its
 * centre; on a tie, the one drawn on top. Region labels aren't targets.
 */
export function hitTestMarkers(markers, view, sx, sy, { slop = 10 } = {}) {
  let best = null;
  let bestD = Infinity;
  for (const m of markers || []) {
    if (!validMarker(m) || m.kind === 'region') continue;
    const spot = markerHotspot(m, view);
    if (!spot) continue;
    const d = Math.hypot(sx - spot.x, sy - spot.y);
    if (d > Math.max(spot.r, slop)) continue;
    if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && markerLayer(m) >= markerLayer(best))) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

const DIRECTIONS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];

/** '12 tiles north-west' from one tile to another; 'Right here' within a tile or so. */
export function describeOffset(from, to) {
  if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(to.x)) return '';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.round(Math.hypot(dx, dy));
  if (d < 2) return 'Right here';
  const sector = ((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return `${d} tiles ${DIRECTIONS[sector]}`;
}

/**
 * A name as it reads mid-sentence: a leading article goes lower case ('A lantern by the road' →
 * 'a lantern by the road', 'The Whisperwood' → 'the Whisperwood'); anything else is left alone.
 */
export const inSentence = (label) => String(label ?? '').replace(/^(A|An|The)(?=\s)/, (word) => word.toLowerCase());

/** The travel question for a marker: 'Travel to a lantern by the road?' ('Travel home?' for plain home). */
export function travelQuestion(marker) {
  const label = typeof marker?.label === 'string' && marker.label.trim() ? marker.label.trim() : DEFAULT_LABELS[marker?.kind] || '';
  if (!label) return 'Travel there?';
  if (/^home$/i.test(label)) return 'Travel home?';
  return `Travel to ${inSentence(label)}?`;
}

/**
 * The places Milo can travel to: home first, then the lantern he rests at (`rest: true`), then the
 * rest nearest first (then by name).
 * → [{ marker, id, label, note }] where note says how far and which way from `from`.
 */
export function travelDestinations(markers, from = null) {
  const list = (markers || []).filter((m) => validMarker(m) && m.travel === true && m.kind !== 'milo' && m.kind !== 'region');
  const dist = (m) => (from ? Math.hypot(m.x - from.x, m.y - from.y) : 0);
  const rank = (m) => (m.kind === 'home' ? 0 : m.rest === true ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || dist(a) - dist(b) || String(a.label).localeCompare(String(b.label)));
  return list.map((m) => ({ marker: m, id: m.id, label: m.label || DEFAULT_LABELS[m.kind], note: describeOffset(from, m) }));
}

/** The small line under a travel destination: 'Home · 12 tiles south', 'Where Milo rests · 30 tiles west'. */
export function destinationNote(d) {
  if (d.marker.kind === 'home') return d.note === 'Right here' ? 'Home · right here' : `Home · ${d.note || 'Hearthvale'}`;
  if (d.marker.rest === true) return d.note ? `Where Milo rests · ${d.note === 'Right here' ? 'right here' : d.note}` : 'Where Milo rests';
  return d.note || 'A lit lantern';
}

/**
 * Where a small card goes beside an anchor point inside a box (all CSS px): above it if it fits,
 * else below, and always inside the box by `margin`. → { left, top, side }
 */
export function placePopover(anchor, size, box, { gap = 14, margin = 8 } = {}) {
  let side = 'above';
  let top = anchor.y - gap - size.h;
  if (top < margin) {
    side = 'below';
    top = anchor.y + gap;
  }
  top = clamp(top, margin, Math.max(margin, box.h - size.h - margin));
  const left = clamp(anchor.x - size.w / 2, margin, Math.max(margin, box.w - size.w - margin));
  return { left: Math.round(left), top: Math.round(top), side };
}

// ---------- the view (DOM and canvas) ----------

const CLOSE_GLYPH = 'M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM7 1h2v2H7zM5 3h2v2H5zM3 5h2v2H3zM1 7h2v2H1z';
const COMPASS = [
  '...o...',
  '..oUo..',
  '..oUo..',
  '.oUUYo.',
  '.oUUYo.',
  'oUUoYYo',
  '.occCo.',
  '.occCo.',
  '..oco..',
  '..oco..',
  '...o...',
];
const LETTER_N = ['o..o', 'oo.o', 'o.oo', 'o..o', 'o..o'];

let instances = 0;

/**
 * A least-recently-used cache, bounded by entries and by a cost (pixels, for canvases), so a long
 * look round at the near zoom never piles up more than a few tens of megabytes.
 */
export class Lru {
  constructor(limit, maxCost = Infinity) { this.limit = limit; this.maxCost = maxCost; this.cost = 0; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const entry = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  has(key) { return this.map.has(key); }
  set(key, value, cost = 0) {
    this.delete(key);
    this.map.set(key, { value, cost });
    this.cost += cost;
    while (this.map.size > 1 && (this.map.size > this.limit || this.cost > this.maxCost)) this.delete(this.map.keys().next().value);
  }
  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return;
    this.cost -= entry.cost;
    this.map.delete(key);
  }
  clear() { this.map.clear(); this.cost = 0; }
  get size() { return this.map.size; }
}
const pixelCost = (canvas) => (canvas ? canvas.width * canvas.height : 0);

/**
 * The map view. `root` is an empty element (the shell's `section#map.map-view.px[hidden]`); the view
 * builds everything inside it. Options:
 * - paintChunk(cx, cy, pxPerTile) → canvas | null: a chunk's ground at that zoom (the engine's paintMapChunk).
 * - valeImage() → canvas: the vale at 16 px a tile (renderMap(1)); read on open and on refresh({ vale: true }).
 * - explored() → Set | array of 'cx,cy'. markers() → [{ kind, x, y, label, id, lit?, genre?, genres?, colour?, stage?, bright?, type?, hush?, travel? }]
 *   (colour: '#rrggbb' for the tear's inner colour, or { rim, inner, ink }; genres: a fusion's genres, first two used).
 * - onTravel(id, marker): after "Travel" is confirmed (the map has already closed).
 * - onClose({ reason }): after the map closes itself ('key', 'button', 'travel'). close() alone doesn't call it.
 * - now() → ms for the gentle glow; motion() → boolean (defaults to the page's own setting).
 */
export function createMapView(root, options = {}) {
  const {
    paintChunk = () => null,
    paintAt = 8,
    valeImage = () => null,
    explored = () => [],
    markers = () => [],
    onTravel = () => {},
    onClose = () => {},
    now = () => Date.now(),
    motion = null,
  } = options;
  if (!root || !root.ownerDocument) throw new Error('createMapView needs a root element');
  const doc = root.ownerDocument;
  const win = doc.defaultView || globalThis;
  const uid = `map-${(instances += 1)}`;
  const perf = win.performance || globalThis.performance || { now: () => Date.now() };
  root.hidden = true; // shut until open()

  let built = false;
  let isOpenNow = false;
  let disposed = false;
  let els = null;
  let view = makeView({});
  let dpr = 1;
  let known = new Set();
  let list = [];
  let bounds = knownBounds(known, list);
  let lastZoom = DEFAULT_ZOOM;
  let frameId = 0;
  let ambientId = 0;
  let pan = null; // an eased pan in progress
  let ask = null; // { marker, from }
  let hovered = null;
  let focusId = null;
  let drag = null;
  let returnFocus = null;
  let resizeObserver = null;
  let lastTip = '';
  let lastDrawMs = 0;
  let chromeRatio = 0; // the device pixel ratio the legend and compass were drawn at
  let compassRect = null; // the compass chip over the map, in device px

  const artCache = new Lru(800, 6e6); // 'cx,cy@zoom' → canvas | null, up to ~24 MB
  const tileCache = new Lru(800, 6e6); // composed chunk canvases (and chunks of fog)
  const fogCache = new Lru(600); // chunk fog fields by neighbourhood
  const iconCache = new Map();
  const glowCache = new Map();
  let valeSource = null;
  const valeByZoom = new Map();
  const failed = new Map(); // chunks whose paint came back empty: 'cx,cy@zoom' → time

  const safe = (fn, fallback = null) => {
    try { return fn(); } catch (error) { if (win.console) win.console.warn('[mapview]', error); return fallback; }
  };
  const motionOn = () => {
    if (typeof motion === 'function') return safe(() => Boolean(motion()), false);
    if (doc.documentElement?.classList?.contains('still')) return false;
    const mq = win.matchMedia ? safe(() => win.matchMedia('(prefers-reduced-motion: reduce)'), null) : null;
    return !(mq && mq.matches);
  };
  const time = () => safe(() => Number(now()) || 0, 0);

  // ----- building the DOM (createElement and textContent only) -----

  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const attrs = (node, values) => {
    for (const [k, v] of Object.entries(values)) node.setAttribute(k, String(v));
    return node;
  };
  const button = (cls, text, extra = {}) => attrs(el('button', cls, text), { type: 'button', ...extra });
  const glyph = (d, size = 10) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    attrs(svg, { viewBox: '0 0 10 10', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  };

  function build() {
    if (built) return;
    built = true;
    root.replaceChildren();
    root.classList.add('map-view', 'px');
    attrs(root, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${uid}-title`, 'aria-describedby': `${uid}-hint` });

    const head = el('header', 'map-head');
    const titles = el('div', 'map-titles');
    const title = attrs(el('h2', 'map-title', 'Map'), { id: `${uid}-title`, tabindex: '-1' });
    const hint = attrs(el('p', 'map-hint', 'Drag or use the arrow keys to look around, and plus or minus to zoom.'), { id: `${uid}-hint` });
    titles.append(title, hint);
    const zoom = attrs(el('div', 'map-zoom'), { role: 'group', 'aria-label': 'Zoom' });
    const zoomButtons = ZOOMS.map((z) => {
      const b = button('map-zoom-btn', ZOOM_NAMES[z], { 'data-zoom': z, 'aria-pressed': 'false' });
      zoom.append(b);
      return b;
    });
    const centre = button('px-btn map-centre', 'Centre on Milo');
    const close = button('map-close', null, { 'aria-label': 'Close map' });
    close.append(glyph(CLOSE_GLYPH));
    head.append(titles, zoom, centre, close);

    const body = el('div', 'map-body');
    const viewport = attrs(el('div', 'map-viewport'), {
      tabindex: '0', role: 'application', 'aria-roledescription': 'map', 'aria-label': 'Map of the Hushlands', 'aria-describedby': `${uid}-hint`,
    });
    const canvas = attrs(el('canvas', 'map-canvas'), { 'aria-hidden': 'true' });
    const compass = attrs(el('div', 'map-compass'), { 'aria-hidden': 'true' });
    const compassCanvas = el('canvas', 'map-compass-art');
    compass.append(compassCanvas);
    const tip = attrs(el('div', 'map-tip'), { 'aria-hidden': 'true' });
    tip.hidden = true;
    const askBox = attrs(el('div', 'map-ask px'), { role: 'group', 'aria-labelledby': `${uid}-ask` });
    askBox.hidden = true;
    const askQ = attrs(el('p', 'map-ask-q'), { id: `${uid}-ask` });
    const askNote = el('p', 'map-ask-note');
    const askActions = el('div', 'map-ask-actions');
    const travelBtn = button('px-btn primary map-ask-go', 'Travel');
    const cancelBtn = button('px-btn map-ask-cancel', 'Cancel');
    askActions.append(travelBtn, cancelBtn);
    askBox.append(askQ, askNote, askActions);
    viewport.append(canvas, compass, tip, askBox);

    const side = attrs(el('aside', 'map-side'), { 'aria-label': 'Travel and key' });
    const travel = el('section', 'map-travel');
    const travelHead = el('h3', null, 'Travel');
    const travelCount = el('span', 'count', '0');
    travelHead.append(' ', travelCount);
    const dests = el('ul', 'map-dests');
    const empty = el('p', 'map-empty', 'Light a lantern in the wilds, and you can travel back to it from here.');
    travel.append(travelHead, dests, empty);
    const legend = el('section', 'map-key');
    const legendHead = el('h3', null, 'Key');
    const legendList = el('ul', 'map-legend');
    legend.append(legendHead, legendList);
    side.append(travel, legend);
    body.append(viewport, side);

    const live = attrs(el('p', 'sr-only map-live'), { 'aria-live': 'polite' });
    root.append(head, body, live);

    els = { head, title, hint, zoomButtons, centre, close, body, viewport, canvas, compass, compassCanvas, tip, askBox, askQ, askNote, travelBtn, cancelBtn, side, dests, travelCount, empty, legendList, live };

    root.addEventListener('keydown', onKeyDown);
    zoom.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zoom]');
      if (b) setZoom(Number(b.dataset.zoom), { announce: true });
    });
    centre.addEventListener('click', () => centreOnMilo({ announce: true }));
    close.addEventListener('click', () => userClose('button'));
    travelBtn.addEventListener('click', confirmTravel);
    cancelBtn.addEventListener('click', () => closeAsk({ restore: true }));
    dests.addEventListener('click', (e) => {
      const b = e.target.closest('[data-marker]');
      if (!b) return;
      const m = list.find((x) => x.id === b.dataset.marker);
      if (m) chooseDestination(m, b);
    });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerCancel);
    viewport.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    if (typeof win.ResizeObserver === 'function') {
      resizeObserver = new win.ResizeObserver(() => { if (isOpenNow) { measure(); requestDraw(); } });
      resizeObserver.observe(viewport);
    } else if (win.addEventListener) {
      win.addEventListener('resize', onWindowResize);
    }
    doc.addEventListener?.('visibilitychange', onVisibility);
  }

  function onWindowResize() { if (isOpenNow) { measure(); requestDraw(); } }
  function onVisibility() {
    if (!isOpenNow) return;
    if (doc.hidden) stopAmbient();
    else { requestDraw(); startAmbient(); }
  }

  // ----- small canvases: icons, glows, legend, compass -----

  function makeCanvas(w, h) {
    const c = doc.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  function rowsCanvas(rows, colours, scale) {
    const w = rows[0].length;
    const h = rows.length;
    const c = makeCanvas(w * scale, h * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return c;
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x += 1) {
        const rgb = colours[row[x]];
        if (!rgb || row[x] === '.') continue;
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    });
    return c;
  }

  function iconFor(marker, scale) {
    const art = markerArt(marker);
    if (!art) return null;
    const tint = marker.kind === 'rift' ? JSON.stringify([art.colours[1], art.colours[2], art.colours[3], art.colours[4]]) : '';
    const key = `${marker.kind}|${marker.lit ? 1 : 0}|${marker.stage || ''}|${marker.type || marker.poiType || ''}|${tint}|${scale}`;
    let c = iconCache.get(key);
    if (!c) {
      c = { canvas: rowsCanvas(art.rows, art.colours, scale), art };
      iconCache.set(key, c);
    }
    return c;
  }

  // A soft glow: a disc dithered in 2×2 blocks, whole in the middle and thinning to its edge.
  function glowFor(rgb, radius, block, alpha) {
    const key = `${rgb.join(',')}|${radius}|${block}|${alpha}`;
    let c = glowCache.get(key);
    if (c) return c;
    const size = radius * 2;
    c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
      for (let y = 0; y < size; y += block) {
        for (let x = 0; x < size; x += block) {
          const d = Math.hypot(x + block / 2 - radius, y + block / 2 - radius) / radius;
          if (d > 1) continue;
          const s = clamp01((1 - d) / 0.55);
          const t = (BAYER[(y / block) & 3][(x / block) & 3] + 0.5) / 16;
          if (t < s) ctx.fillRect(x, y, block, block);
        }
      }
    }
    glowCache.set(key, c);
    return c;
  }

  // A ring of blocks round Milo: where he is, at a glance.
  function ringFor(radius, block) {
    const key = `ring|${radius}|${block}`;
    let c = glowCache.get(key);
    if (c) return c;
    const size = (radius + block * 2) * 2;
    c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    if (ctx) {
      const mid = size / 2;
      for (let y = 0; y < size; y += block) {
        for (let x = 0; x < size; x += block) {
          const d = Math.hypot(x + block / 2 - mid, y + block / 2 - mid);
          if (Math.abs(d - radius) <= block * 0.75) {
            ctx.fillStyle = '#fff6e2';
            ctx.fillRect(x, y, block, block);
          } else if (Math.abs(d - radius - block * 1.2) <= block * 0.5 || Math.abs(d - radius + block * 1.2) <= block * 0.5) {
            ctx.fillStyle = 'rgba(61,64,56,0.55)';
            ctx.fillRect(x, y, block, block);
          }
        }
      }
    }
    glowCache.set(key, c);
    return c;
  }

  function fillLegend() {
    const items = [
      [{ kind: 'milo' }, 'Milo'],
      [{ kind: 'home' }, 'Home'],
      [{ kind: 'lantern', lit: true }, 'Lit lantern'],
      [{ kind: 'lantern', lit: false }, 'Sleeping lantern'],
      [{ kind: 'rift', genre: 'nocturne', stage: 'open' }, 'Rift, in its genre’s colours'],
      [null, 'Fog: not explored yet'],
    ];
    const lis = items.map(([marker, text]) => {
      const li = el('li');
      const swatch = el('span', 'map-legend-art');
      if (marker) {
        const icon = uiIcon(marker);
        if (icon) swatch.append(icon);
      } else {
        swatch.classList.add('map-legend-fog');
      }
      li.append(swatch, el('span', null, text));
      return li;
    });
    els.legendList.replaceChildren(...lis);
  }

  // A marker's icon for the side column: its own canvas, whole device pixels, 2 CSS px an icon pixel.
  function uiIcon(marker) {
    const art = markerArt(marker);
    if (!art) return null;
    const k = iconScaleFor(win.devicePixelRatio || 1);
    const c = rowsCanvas(art.rows, art.colours, k);
    c.style.width = `${(art.w * k) / (win.devicePixelRatio || 1)}px`;
    c.style.height = `${(art.h * k) / (win.devicePixelRatio || 1)}px`;
    return c;
  }

  function paintCompass() {
    const ratio = win.devicePixelRatio || 1;
    const s = iconScaleFor(ratio);
    const w = 7;
    const c = els.compassCanvas;
    c.width = w * s;
    c.height = (LETTER_N.length + 1 + COMPASS.length) * s;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const put = (rows, x0, y0) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const rgb = BASE_RGB[ch];
      if (!rgb || ch === '.') return;
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect((x0 + x) * s, (y0 + y) * s, s, s);
    }));
    put(LETTER_N, 2, 0);
    put(COMPASS, 0, LETTER_N.length + 1);
    c.style.width = `${c.width / ratio}px`;
    c.style.height = `${c.height / ratio}px`;
  }

  // ----- reading the shell's data -----

  function readData() {
    known = toExploredSet(safe(() => explored(), []));
    list = normalizeMarkers(safe(() => markers(), []));
    bounds = knownBounds(known, list);
  }

  // The vale's picture: reduced again only when it's a new canvas, or when asked (it was redrawn).
  function readVale({ force = false } = {}) {
    const src = safe(() => valeImage(), null);
    if (!force && src && src === valeSource) return;
    valeSource = src;
    valeByZoom.clear();
  }

  const milo = () => list.find((m) => m.kind === 'milo') || null;
  const miloCentre = () => {
    const m = milo();
    return m ? { x: m.x + 0.5, y: m.y + 0.5 } : null;
  };

  // ----- sizing -----

  function measure() {
    if (!els) return;
    dpr = win.devicePixelRatio || 1;
    const rect = els.viewport.getBoundingClientRect ? els.viewport.getBoundingClientRect() : { width: els.viewport.clientWidth, height: els.viewport.clientHeight };
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (els.canvas.width !== w) els.canvas.width = w;
    if (els.canvas.height !== h) els.canvas.height = h;
    const pixel = Math.max(1, Math.round(dpr));
    const icon = iconScaleFor(dpr);
    if (pixel !== view.pixel || icon !== view.icon) { tileCache.clear(); iconCache.clear(); glowCache.clear(); }
    if (dpr !== chromeRatio) { chromeRatio = dpr; fillLegend(); paintCompass(); }
    // Where the compass chip sits over the map (device px), so region names step round it.
    const c = els.compass;
    const left = Number(c.offsetLeft);
    const top = Number(c.offsetTop);
    compassRect = Number.isFinite(left) && Number.isFinite(top) && c.offsetWidth > 0
      ? { x: left * dpr, y: top * dpr, w: c.offsetWidth * dpr, h: c.offsetHeight * dpr }
      : null;
    view = clampCenter(makeView({ ...view, width: w, height: h, pixel, icon }), bounds);
  }

  // ----- chunk pictures -----

  const artKey = (cx, cy, zoom) => `${cx},${cy}@${zoom}`;

  // The chunk's ground at this zoom: a canvas, null (none to be had), or undefined (not painted yet).
  // Art is asked for at `paintAt` px a tile (the richest, 8) and reduced by each block's most
  // common colour for the wider zooms, the way the vale is: forests keep their trees, and the wilds
  // and the vale read as one map at every zoom. A chunk already painted closer is reused.
  function artFor(cx, cy, zoom, canPaint) {
    const key = artKey(cx, cy, zoom);
    const cached = artCache.get(key);
    // A chunk that came back empty is asked again now and then (the engine may not have had it yet).
    if (cached === null && canPaint && perf.now() - (failed.get(key) ?? 0) > RETRY_MS) artCache.delete(key);
    else if (cached !== undefined) return cached;
    if (!canPaint) return undefined;
    const size = CHUNK_TILES * zoom;
    const at = paintAt && paintAt > zoom ? paintAt : zoom;
    let painted = at !== zoom ? artCache.get(artKey(cx, cy, at)) : undefined;
    if (!painted) {
      painted = safe(() => paintChunk(cx, cy, at), null);
      if (painted && (chunkTouchesValeEdge(cx, cy) || chunkTouchesMist(cx, cy))) painted = safe(() => finishEdges(painted, cx, cy), painted);
    }
    let out = painted && painted.width > 0 && painted.height > 0 ? painted : null;
    if (out && out.width !== size) out = safe(() => reduceArt(out, size), null);
    if (out) failed.delete(key);
    else failed.set(key, perf.now());
    artCache.set(key, out, pixelCost(out));
    return out;
  }

  // The chunk's art with the foam along the vale's lake painted out and the harbor's mist laid on
  // over the sea, where the vale's picture leaves off (a new canvas when anything changed).
  function finishEdges(canvas, cx, cy) {
    const w = canvas.width;
    if (!(w > 0) || canvas.height !== w || w % CHUNK_TILES) return canvas;
    const data = pixelsOf(canvas, w, w);
    if (!data) return canvas;
    const ppt = w / CHUNK_TILES;
    const mended = mendValeSeam(data, cx, cy, ppt);
    const misted = chunkTouchesMist(cx, cy) ? layHarborMist(data, cx * CHUNK_TILES, cy * CHUNK_TILES, w, w, ppt, 'wilds') : 0;
    return mended || misted ? imageCanvas(data, w) : canvas;
  }

  function reduceArt(canvas, size) {
    const factor = canvas.width / size;
    if (!Number.isInteger(factor) || factor < 2 || canvas.height !== canvas.width) {
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, size, size);
      return c;
    }
    const data = pixelsOf(canvas, canvas.width, canvas.height);
    return data ? imageCanvas(downscaleMode(data, canvas.width, canvas.height, factor).data, size) : null;
  }

  // Pixels of any canvas, read through one scratch canvas kept for reading (so the browser keeps it
  // in memory rather than on the GPU, and reading back stays cheap).
  let scratch = null;
  function pixelsOf(canvas, w, h = w) {
    if (!scratch || scratch.canvas.width < w || scratch.canvas.height < h) {
      const c = makeCanvas(Math.max(w, scratch?.canvas.width || 0), Math.max(h, scratch?.canvas.height || 0));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      scratch = { canvas: c, ctx };
    }
    const { ctx } = scratch;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  function imageCanvas(rgba, size) {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    if (ctx) {
      const image = ctx.createImageData(size, size);
      image.data.set(rgba);
      ctx.putImageData(image, 0, 0);
    }
    return c;
  }

  function fogOnly(cx, cy, zoom, canPaint) {
    const key = `${cx},${cy}@${zoom}|fog`;
    const cached = tileCache.get(key);
    if (cached) return cached;
    if (!canPaint) return undefined;
    const size = CHUNK_TILES * zoom;
    const c = imageCanvas(composeChunk(null, null, cx, cy, zoom), size);
    tileCache.set(key, c, pixelCost(c));
    return c;
  }

  // → { canvas | null, pending }
  function chunkPicture(cx, cy, zoom, budgetEnds) {
    if (chunkInVale(cx, cy)) return { canvas: null, pending: false }; // the vale's own picture covers it
    const canPaint = () => perf.now() < budgetEnds;
    const nb = neighbourhood(known, cx, cy);
    if (nb.kind === 'fog') {
      const fog = fogOnly(cx, cy, zoom, canPaint());
      return { canvas: fog || null, pending: !fog };
    }
    const art = artFor(cx, cy, zoom, canPaint());
    if (art === undefined) return { canvas: tileCache.get(`${cx},${cy}@${zoom}|fog`) || null, pending: true };
    if (art === null) {
      const fog = fogOnly(cx, cy, zoom, canPaint());
      return { canvas: fog || null, pending: !fog };
    }
    if (nb.kind === 'clear') return { canvas: art, pending: false };
    const key = `${cx},${cy}@${zoom}|${nb.sig}`;
    const cached = tileCache.get(key);
    if (cached) return { canvas: cached, pending: false };
    if (!canPaint()) return { canvas: tileCache.get(`${cx},${cy}@${zoom}|fog`) || null, pending: true };
    const field = fieldFor(cx, cy, nb);
    const size = CHUNK_TILES * zoom;
    const pixels = safe(() => pixelsOf(art, size), null);
    const c = imageCanvas(composeChunk(pixels, fogLevels(field, cx, cy, zoom), cx, cy, zoom), size);
    tileCache.set(key, c, pixelCost(c));
    return { canvas: c, pending: false };
  }

  function fieldFor(cx, cy, nb) {
    const key = `${cx},${cy}|${nb.sig}`;
    let field = fogCache.get(key);
    if (!field) { field = fogField(known, cx, cy); fogCache.set(key, field); }
    return field;
  }

  // How fogged a tile is (0..1), for fading what lies under the fog.
  function fogAtTile(x, y) {
    if (inVale(x, y)) return 0;
    const cx = chunkOf(x);
    const cy = chunkOf(y);
    const nb = neighbourhood(known, cx, cy);
    if (nb.kind !== 'edge') return nb.kind === 'fog' ? 1 : 0;
    const S = CHUNK_TILES + 2;
    return fieldFor(cx, cy, nb)[(y - cy * CHUNK_TILES + 1) * S + (x - cx * CHUNK_TILES + 1)];
  }

  function valeFor(zoom) {
    if (valeByZoom.has(zoom)) return valeByZoom.get(zoom);
    let out = null;
    const src = valeSource;
    if (src && src.width > 0 && src.height > 0) {
      out = safe(() => {
        const W = VALE.w * VALE_PX_PER_TILE;
        const H = VALE.h * VALE_PX_PER_TILE;
        const full = pixelsOf(src, W, H);
        // The harbor's mist past the box the picture holds it to, as the world view draws it.
        layHarborMist(full, VALE.x, VALE.y, W, H, VALE_PX_PER_TILE, 'vale');
        const small = downscaleMode(full, W, H, VALE_PX_PER_TILE / zoom);
        const c = makeCanvas(small.width, small.height);
        const ctx = c.getContext('2d');
        const image = ctx.createImageData(small.width, small.height);
        image.data.set(small.data);
        ctx.putImageData(image, 0, 0);
        return c;
      }, null);
    }
    valeByZoom.set(zoom, out);
    return out;
  }

  // ----- drawing -----

  function requestDraw() {
    if (!isOpenNow || frameId) return;
    const raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (fn) => win.setTimeout(() => fn(perf.now()), 16);
    frameId = raf(() => {
      frameId = 0;
      draw(PAINT_BUDGET_MS);
    });
  }

  function draw(budget = PAINT_BUDGET_MS) {
    if (!isOpenNow || !els) return;
    const drawStart = perf.now();
    stepPan();
    const canvas = els.canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = PARCHMENT_CSS;
    ctx.fillRect(0, 0, W, H);
    const zoom = view.zoom;
    const t = tilePx(view);
    const o = viewOrigin(view);
    const span = CHUNK_TILES * t;
    const budgetEnds = perf.now() + budget;
    let pending = false;
    for (const { cx, cy } of visibleChunks(view)) {
      const pic = chunkPicture(cx, cy, zoom, budgetEnds);
      if (pic.pending) pending = true;
      if (pic.canvas) ctx.drawImage(pic.canvas, o.x + cx * span, o.y + cy * span, span, span);
    }
    const vale = valeFor(zoom);
    if (vale) ctx.drawImage(vale, o.x + VALE.x * t, o.y + VALE.y * t, VALE.w * t, VALE.h * t);
    drawMarkers(ctx);
    placeOverlays();
    lastDrawMs = perf.now() - drawStart;
    if (pending || pan) requestDraw();
  }

  function drawMarkers(ctx) {
    const px = view.pixel;
    const s = view.icon;
    const moving = motionOn();
    const ms = time();
    const t = tilePx(view);
    // Rift bleeds and lantern light first, under everything.
    for (const m of list) {
      const at = tileToScreen(view, m.x + 0.5, m.y + 0.5);
      if (m.kind === 'rift') {
        const tint = riftTint(m);
        const reach = { hairline: 3, open: 5, gaping: 7 }[m.stage] || 5;
        const radius = Math.max(6 * px, Math.round(reach * t));
        // A bright rift (a milestone) glows in its golden rim; the rest in their genre's own colour.
        const glow = glowFor(m.bright ? tint.rim : tint.inner, radius, 2 * px, m.bright ? 0.42 : 0.34);
        ctx.drawImage(glow, Math.round(at.x - radius), Math.round(at.y - radius));
      } else if (m.kind === 'lantern' && m.lit) {
        const radius = 9 * s;
        const breathe = moving ? 0.8 + 0.2 * Math.sin(ms / 900 + (m.x * 7 + m.y * 13)) : 1;
        ctx.globalAlpha = breathe;
        ctx.drawImage(glowFor([248, 222, 144], radius, px * 2, 0.55), Math.round(at.x - radius), Math.round(at.y - radius));
        ctx.globalAlpha = 1;
      }
    }
    // The icons back to front, then region names over them (cartographer style), then Milo on top.
    const drawIcon = (m) => {
      const icon = iconFor(m, s);
      if (!icon) return;
      const at = tileToScreen(view, m.x + 0.5, m.y + 0.5);
      const left = Math.round(at.x) - icon.art.anchor.x * s;
      const top = Math.round(at.y) - icon.art.anchor.y * s;
      // Places remembered but under the fog now are drawn faint; rifts, lit lanterns, home and Milo never are.
      const faint = (m.kind === 'poi' || (m.kind === 'lantern' && !m.lit)) && fogAtTile(m.x, m.y) > 0.9;
      ctx.globalAlpha = faint ? 0.5 : 1;
      ctx.drawImage(icon.canvas, left, top);
      ctx.globalAlpha = 1;
    };
    for (const m of list) if (m.kind !== 'region' && m.kind !== 'milo') drawIcon(m);
    for (const m of list) {
      if (m.kind !== 'region') continue;
      const at = tileToScreen(view, m.x + 0.5, m.y + 0.5);
      drawLabel(ctx, m.label, at.x, at.y - 10 * px, m.hush === true);
    }
    const me = milo();
    if (me) {
      const at = tileToScreen(view, me.x + 0.5, me.y + 0.5);
      const base = 9 * s;
      const r = moving ? Math.round(base + Math.sin(ms / 700) * s) : base;
      const ring = ringFor(r, px * 2);
      ctx.drawImage(ring, Math.round(at.x - ring.width / 2), Math.round(at.y - ring.height / 2));
      drawIcon(me);
    }
    // A marker being pointed out (open({ focus }), or chosen in the list).
    const focus = (focusId && list.find((m) => m.id === focusId)) || (ask && ask.marker);
    if (focus) {
      const spot = markerHotspot(focus, view);
      if (spot) {
        const r = Math.round(spot.r + (moving ? 5 + 2 * Math.sin(ms / 500) : 6) * px);
        ctx.drawImage(focusRing(r, px * 2), Math.round(spot.x - r - px * 2), Math.round(spot.y - r - px * 2));
      }
    }
  }

  function focusRing(radius, block) {
    const key = `focus|${radius}|${block}`;
    let c = glowCache.get(key);
    if (c) return c;
    const size = (radius + block) * 2;
    c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    if (ctx) {
      const mid = size / 2;
      for (let y = 0; y < size; y += block) {
        for (let x = 0; x < size; x += block) {
          const d = Math.hypot(x + block / 2 - mid, y + block / 2 - mid);
          if (Math.abs(d - radius) > block * 0.7) continue;
          // dashes: the ring reads as a pointer, not a wall
          const a = Math.atan2(y - mid, x - mid);
          if (Math.floor((a + Math.PI) / (Math.PI / 8)) % 2) continue;
          ctx.fillStyle = '#efbc6d';
          ctx.fillRect(x, y, block, block);
        }
      }
    }
    glowCache.set(key, c);
    return c;
  }

  function drawLabel(ctx, text, x, y, hushed) {
    const size = Math.round(11 * dpr);
    ctx.save();
    ctx.font = `700 ${size}px 'Segoe UI', system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(1.5 * dpr)}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const label = String(text || '').toUpperCase();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, Math.round(4 * dpr));
    // Kept wholly inside the map while its place is on screen (a name cut at the edge reads badly).
    const width = typeof ctx.measureText === 'function' ? ctx.measureText(label).width : label.length * size * 0.75;
    const at = placeLabel({ x, y }, { w: width + ctx.lineWidth, h: size + ctx.lineWidth }, { w: ctx.canvas?.width || 0, h: ctx.canvas?.height || 0 }, Math.round(6 * dpr), Math.round(48 * dpr), compassRect ? [compassRect] : []);
    if (at.alpha <= 0) { ctx.restore(); return; }
    ctx.globalAlpha = at.alpha;
    ctx.strokeStyle = 'rgba(251,247,233,0.92)';
    ctx.strokeText(label, at.x, at.y);
    ctx.fillStyle = hushed ? '#6b6878' : '#4f5448';
    ctx.fillText(label, at.x, at.y);
    ctx.restore();
  }

  // ----- overlays: the hover tip and the travel question -----

  function placeOverlays() {
    if (!els) return;
    const box = { w: els.canvas.width / dpr, h: els.canvas.height / dpr };
    if (ask) {
      const spot = markerHotspot(ask.marker, view);
      if (spot) {
        const size = { w: els.askBox.offsetWidth || 220, h: els.askBox.offsetHeight || 90 };
        const pos = placePopover({ x: spot.x / dpr, y: spot.y / dpr }, size, box, { gap: Math.round(spot.h / 2 / dpr) + 12 });
        els.askBox.style.left = `${pos.left}px`;
        els.askBox.style.top = `${pos.top}px`;
        els.askBox.dataset.side = pos.side;
        // The tail points at the lantern, on the 2 px grid.
        const tail = clamp(Math.round((spot.x / dpr - pos.left) / 2) * 2, 12, Math.max(12, size.w - 14));
        els.askBox.style.setProperty('--tail-x', `${tail}px`);
      }
    }
    if (hovered && !els.tip.hidden) {
      const spot = markerHotspot(hovered, view);
      if (spot) {
        const size = { w: els.tip.offsetWidth || 80, h: els.tip.offsetHeight || 22 };
        const pos = placePopover({ x: spot.x / dpr, y: (spot.y - spot.h / 2) / dpr }, size, box, { gap: 6, margin: 4 });
        els.tip.style.left = `${pos.left}px`;
        els.tip.style.top = `${pos.top}px`;
      }
    }
  }

  function tipText(marker) {
    if (!marker) return '';
    if (marker.kind === 'lantern' && marker.travel) return `${marker.label} · travel here`;
    if (marker.kind === 'home' && marker.travel) return `${marker.label} · travel home`;
    return marker.label;
  }

  function setHover(marker) {
    hovered = marker;
    if (!els) return;
    if (!marker || ask) {
      els.tip.hidden = true;
      lastTip = '';
      els.viewport.style.cursor = '';
      return;
    }
    const text = tipText(marker);
    if (text !== lastTip) { els.tip.textContent = text; lastTip = text; }
    els.tip.hidden = false;
    els.viewport.style.cursor = marker.travel ? 'pointer' : 'default';
    placeOverlays();
  }

  function askTravel(marker, from = null) {
    if (!els || !marker) return;
    setHover(null);
    const me = milo();
    const source = from || els.viewport;
    // A button in the travel list is remembered by its marker too: a refresh rebuilds the list.
    ask = { marker, from: source, listId: els.dests.contains(source) ? source.closest('[data-marker]')?.dataset.marker ?? null : null };
    els.askQ.textContent = travelQuestion(marker);
    const note = me ? describeOffset(me, marker) : '';
    els.askNote.textContent = note;
    els.askNote.hidden = !note;
    els.askBox.hidden = false;
    placeOverlays();
    requestDraw();
    els.travelBtn.focus({ preventScroll: true });
  }

  function closeAsk({ restore = false } = {}) {
    if (!ask || !els) return;
    const { from, listId } = ask;
    const hadFocus = els.askBox.contains(doc.activeElement);
    ask = null;
    els.askBox.hidden = true;
    requestDraw();
    if (restore) restoreFocus(from, listId);
    // Put away by the map itself (the wheel, a drag): focus mustn't vanish with the question.
    else if (hadFocus) els.viewport.focus?.({ preventScroll: true });
  }

  const listButton = (id) => (id == null ? null : [...els.dests.querySelectorAll('[data-marker]')].find((b) => b.dataset.marker === id) || null);

  // Focus goes back where the question came from. A list button that a refresh has since replaced
  // is found again by its marker; if it's gone, the map itself takes focus, so its keys still work.
  function restoreFocus(from, listId) {
    const there = from && from.isConnected !== false && root.contains(from) && !from.closest?.('[hidden]') ? from : null;
    const target = there || listButton(listId) || els.viewport;
    target.focus?.({ preventScroll: true });
  }

  function confirmTravel() {
    if (!ask) return;
    const { marker } = ask;
    closeAsk();
    userClose('travel');
    safe(() => onTravel(marker.id, marker));
  }

  function chooseDestination(marker, from) {
    focusId = marker.id;
    panTo(marker.x + 0.5, marker.y + 0.5);
    askTravel(marker, from);
  }

  // ----- moving the view -----

  function setView(next) {
    view = clampCenter(next, bounds);
    requestDraw();
  }

  function panTo(x, y, { instant = false } = {}) {
    const target = clampCenter({ ...view, cx: x, cy: y }, bounds);
    if (instant || !motionOn() || !isOpenNow) {
      pan = null;
      setView(target);
      return;
    }
    pan = { fromX: view.cx, fromY: view.cy, toX: target.cx, toY: target.cy, start: perf.now(), ms: 380 };
    requestDraw();
  }

  function stepPan() {
    if (!pan) return;
    const k = clamp01((perf.now() - pan.start) / pan.ms);
    const e = 1 - (1 - k) ** 3;
    view = { ...view, cx: pan.fromX + (pan.toX - pan.fromX) * e, cy: pan.fromY + (pan.toY - pan.fromY) * e };
    if (k >= 1) pan = null;
  }

  function setZoom(zoom, { at = null, announce = false } = {}) {
    const z = normalizeZoom(zoom);
    pan = null;
    if (z !== view.zoom) {
      const sx = at ? at.x : view.width / 2;
      const sy = at ? at.y : view.height / 2;
      view = zoomView(view, z, sx, sy);
      lastZoom = z;
      setView(view);
    }
    syncZoomButtons();
    if (announce) say(`${ZOOM_NAMES[z]} zoom.`);
  }

  function syncZoomButtons() {
    if (!els) return;
    for (const b of els.zoomButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.zoom) === view.zoom));
  }

  function centreOnMilo({ announce = false } = {}) {
    const c = miloCentre() || { x: VALE.x + VALE.w / 2, y: VALE.y + VALE.h / 2 };
    focusId = null;
    panTo(c.x, c.y);
    if (announce) say(milo() ? 'Centred on Milo.' : 'Centred on Hearthvale.');
  }

  function say(text) {
    if (!els) return;
    els.live.textContent = '';
    els.live.textContent = text;
  }

  // ----- the travel list -----

  function renderList() {
    if (!els) return;
    const me = milo();
    const dests = travelDestinations(list, me);
    const active = doc.activeElement && els.dests.contains(doc.activeElement) ? doc.activeElement.closest('[data-marker]') : null;
    const focused = active ? active.dataset.marker : null;
    const focusedAt = active ? [...els.dests.querySelectorAll('[data-marker]')].indexOf(active) : -1;
    const items = dests.map((d) => {
      const li = el('li');
      const b = button('map-dest', null, { 'data-marker': d.id });
      const art = el('span', 'map-dest-art');
      const icon = uiIcon(d.marker);
      if (icon) art.append(icon);
      const words = el('span', 'map-dest-words');
      words.append(el('span', 'map-dest-name', d.label));
      words.append(el('span', 'map-dest-note', destinationNote(d)));
      b.append(art, words);
      li.append(b);
      return li;
    });
    els.dests.replaceChildren(...items);
    els.travelCount.textContent = String(dests.length);
    els.empty.hidden = dests.some((d) => d.marker.kind !== 'home');
    els.centre.disabled = !me;
    if (focused != null) {
      // The same place again; if it's no longer a destination, its neighbour in the list, or the map.
      const buttons = [...els.dests.querySelectorAll('[data-marker]')];
      const again = buttons.find((b) => b.dataset.marker === focused) || buttons[Math.min(Math.max(focusedAt, 0), buttons.length - 1)] || els.viewport;
      again.focus({ preventScroll: true });
    }
  }

  // ----- input -----

  const inText = (node) => node && (node.isContentEditable || /^(input|textarea|select)$/i.test(node.tagName || ''));

  function onKeyDown(event) {
    if (!isOpenNow) return;
    const target = event.target;
    const key = event.key;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (key === 'Tab') { trapTab(event); return; }
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (ask) closeAsk({ restore: true });
      else userClose('key');
      return;
    }
    if (inText(target) || !plain) return;
    if (key === 'm' || key === 'M') {
      event.preventDefault();
      event.stopPropagation();
      userClose('key');
      return;
    }
    if (els.askBox.contains(target)) return;
    const inList = els.dests.contains(target);
    if (inList && (key === 'ArrowDown' || key === 'ArrowUp')) {
      const buttons = [...els.dests.querySelectorAll('[data-marker]')];
      const i = buttons.indexOf(target.closest('[data-marker]'));
      const next = buttons[clamp(i + (key === 'ArrowDown' ? 1 : -1), 0, buttons.length - 1)];
      next?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const arrows = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (arrows[key] && !inList) {
      const step = KEY_PAN_CSS * dpr * (event.shiftKey ? 3 : 1);
      pan = null;
      focusId = null;
      setView(panView(view, arrows[key][0] * step, arrows[key][1] * step));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (key === '+' || key === '=') { setZoom(zoomStep(view.zoom, 1), { announce: true }); event.preventDefault(); event.stopPropagation(); return; }
    if (key === '-' || key === '_') { setZoom(zoomStep(view.zoom, -1), { announce: true }); event.preventDefault(); event.stopPropagation(); return; }
    if ((key === 'c' || key === 'C' || key === 'Home') && !inList) { centreOnMilo({ announce: true }); event.preventDefault(); event.stopPropagation(); }
  }

  function focusables() {
    const nodes = [...root.querySelectorAll('button, [tabindex="0"]')];
    return nodes.filter((n) => !n.disabled && !n.closest('[hidden]') && n.getAttribute('tabindex') !== '-1');
  }

  function trapTab(event) {
    const nodes = focusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = doc.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function localPoint(event) {
    const rect = els.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * dpr, y: (event.clientY - rect.top) * dpr };
  }

  function onPointerDown(event) {
    if (!isOpenNow || event.button !== 0 || els.askBox.contains(event.target)) return;
    const p = localPoint(event);
    drag = { id: event.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: false };
    safe(() => els.viewport.setPointerCapture(event.pointerId));
    if (doc.activeElement !== els.viewport) els.viewport.focus({ preventScroll: true });
  }

  function onPointerMove(event) {
    if (!isOpenNow) return;
    if (els.askBox.contains(event.target) && !drag) return;
    const p = localPoint(event);
    if (drag && drag.id === event.pointerId) {
      if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4 * dpr) {
        drag.moved = true;
        pan = null;
        focusId = null;
        closeAsk();
        setHover(null);
        els.viewport.classList.add('dragging');
      }
      if (drag.moved) {
        setView(panView(view, p.x - drag.x, p.y - drag.y));
        drag.x = p.x;
        drag.y = p.y;
      }
      return;
    }
    const hit = hitTestMarkers(list, view, p.x, p.y, { slop: 8 * dpr });
    if (hit !== hovered) setHover(hit);
  }

  function onPointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const wasDrag = drag.moved;
    const p = localPoint(event);
    drag = null;
    els.viewport.classList.remove('dragging');
    safe(() => els.viewport.releasePointerCapture(event.pointerId));
    if (wasDrag) return;
    const hit = hitTestMarkers(list, view, p.x, p.y, { slop: 8 * dpr });
    if (hit && hit.travel) {
      focusId = null;
      askTravel(hit, els.viewport);
    } else if (hit) {
      closeAsk();
      setHover(hit);
    } else {
      closeAsk();
      focusId = null;
      requestDraw();
    }
  }

  function onPointerCancel() {
    drag = null;
    els?.viewport.classList.remove('dragging');
  }

  let wheelAt = 0;
  function onWheel(event) {
    if (!isOpenNow) return;
    event.preventDefault();
    const nowMs = perf.now();
    if (nowMs - wheelAt < 160 || !event.deltaY) return;
    wheelAt = nowMs;
    closeAsk();
    setZoom(zoomStep(view.zoom, event.deltaY < 0 ? 1 : -1), { at: localPoint(event) });
  }

  // ----- the gentle glow -----

  function startAmbient() {
    stopAmbient();
    if (!isOpenNow || !motionOn() || doc.hidden) return;
    ambientId = win.setTimeout(() => {
      ambientId = 0;
      if (!isOpenNow) return;
      requestDraw();
      startAmbient();
    }, 180);
  }

  function stopAmbient() {
    if (ambientId) win.clearTimeout(ambientId);
    ambientId = 0;
  }

  // ----- open and close -----

  function open({ center = null, zoom = null, focus = null } = {}) {
    if (disposed) return;
    build();
    readData();
    readVale();
    const wasOpen = isOpenNow;
    if (!wasOpen) {
      const active = doc.activeElement;
      returnFocus = active && active !== doc.body && !root.contains(active) ? active : null;
    }
    isOpenNow = true;
    root.hidden = false;
    focusId = typeof focus === 'string' && list.some((m) => m.id === focus) ? focus : null;
    closeAsk();
    setHover(null);
    const z = normalizeZoom(zoom ?? lastZoom);
    lastZoom = z;
    const focusMarker = focusId ? list.find((m) => m.id === focusId) : null;
    const c = (center && Number.isFinite(center.x) && Number.isFinite(center.y) ? { x: center.x + 0.5, y: center.y + 0.5 } : null)
      || (focusMarker ? { x: focusMarker.x + 0.5, y: focusMarker.y + 0.5 } : null)
      || miloCentre()
      || { x: VALE.x + VALE.w / 2, y: VALE.y + VALE.h / 2 };
    pan = null;
    view = { ...view, zoom: z, cx: c.x, cy: c.y };
    measure();
    syncZoomButtons();
    renderList();
    if (frameId && win.cancelAnimationFrame) win.cancelAnimationFrame(frameId);
    frameId = 0;
    draw(OPEN_BUDGET_MS);
    startAmbient();
    if (!wasOpen) els.title.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpenNow) return;
    isOpenNow = false;
    stopAmbient();
    if (frameId && win.cancelAnimationFrame) win.cancelAnimationFrame(frameId);
    frameId = 0;
    pan = null;
    drag = null;
    ask = null;
    hovered = null;
    if (els) {
      els.askBox.hidden = true;
      els.tip.hidden = true;
      els.viewport.classList.remove('dragging');
    }
    const hadFocus = root.contains(doc.activeElement);
    root.hidden = true;
    if (hadFocus && returnFocus && returnFocus.isConnected !== false) returnFocus.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function userClose(reason) {
    if (!isOpenNow) return;
    close();
    safe(() => onClose({ reason }));
  }

  function refresh({ repaint = false, vale = false } = {}) {
    if (disposed) return;
    readData();
    if (repaint) { artCache.clear(); tileCache.clear(); failed.clear(); }
    else {
      // Chunks that came back empty get another try.
      for (const key of failed.keys()) artCache.delete(key);
      failed.clear();
    }
    if (vale || repaint) readVale({ force: true });
    if (!isOpenNow) return;
    if (hovered) hovered = list.find((m) => m.id === hovered.id) || null;
    if (!hovered && els) els.tip.hidden = true;
    view = clampCenter(view, bounds);
    renderList();
    // The list is new now: a question whose place is no longer a destination is put away (focus
    // goes back to its place in the new list, or to the map); one still open keeps its marker fresh.
    if (ask && !list.some((m) => m.id === ask.marker.id && m.travel)) closeAsk({ restore: true });
    else if (ask) {
      ask.marker = list.find((m) => m.id === ask.marker.id);
      const q = travelQuestion(ask.marker);
      if (els.askQ.textContent !== q) els.askQ.textContent = q;
    }
    requestDraw();
  }

  function dispose() {
    close();
    disposed = true;
    resizeObserver?.disconnect();
    win.removeEventListener?.('resize', onWindowResize);
    doc.removeEventListener?.('visibilitychange', onVisibility);
    root.removeEventListener('keydown', onKeyDown);
    artCache.clear(); tileCache.clear(); fogCache.clear(); iconCache.clear(); glowCache.clear(); valeByZoom.clear();
    root.replaceChildren();
    built = false;
    els = null;
  }

  return {
    open,
    close,
    isOpen: () => isOpenNow,
    refresh,
    dispose,
    // For previews and checks: where things are now.
    debug: () => ({ view: { ...view }, dpr, pending: Boolean(frameId), lastDrawMs, known: known.size, markers: list.length, ask: ask ? ask.marker.id : null, cached: { art: artCache.size, tiles: tileCache.size, fog: fogCache.size } }),
  };
}
