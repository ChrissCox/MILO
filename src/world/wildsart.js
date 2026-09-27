// Map art for the wilds beyond Hearthvale (WORLD.md §8): the atlas, the minimap and the War
// Table. Tiles are painted in world palette keys, never raw colours, so a genre palette
// (src/world/genres.js) recolours the wilds around a rift exactly as it recolours the vale.
// Pure: paints into plain arrays, so the engine (Phase 3) and the previews share it.
import { PALETTE } from './sprites.js';
import { hashInts, fbm, unit } from './rng.js';
import { TERRAIN as T } from './worldgen.js';

// Two keys per terrain for small sizes (the atlas): the ground and its texture.
export const TERRAIN_KEYS = Object.freeze({
  [T.DEEP]: ['W', 'W'], [T.SEA]: ['w', 'w'], [T.SAND]: ['p', 'P'], [T.GRASS]: ['g', 'G'], [T.MEADOW]: ['h', 'j'],
  [T.FOREST]: ['l', 'L'], [T.PINE]: ['L', 'M'], [T.BIRCH]: ['q', 'l'], [T.MARSH]: ['j', 'W'], [T.PAINTED]: ['h', 'k'],
  [T.ROCK]: ['S', 's'], [T.MOUNTAIN]: ['z', 'S'], [T.SNOW]: ['c', 'f'], [T.BASALT]: ['z', 'o'], [T.MOOR]: ['S', 'G'],
  [T.RIVER]: ['w', 'f'], [T.ROAD]: ['p', 'P'], [T.HEART]: ['g', 'G'], [T.SKY]: ['h', 'W'], [T.DOWNS]: ['j', 'g'], [T.BRIDGE]: ['b', 'B'],
});

const WATERY = new Set([T.DEEP, T.SEA, T.RIVER]);
const PAINTED_KEYS = ['k', 'e', 'u', 'v'];

/**
 * Paint one tile. put(i, j, key) sets an art pixel (0..7 at size 8, or 0..size-1 below 8);
 * at(dx, dy) gives a neighbour's terrain; x, y are the tile's world coordinates.
 */
export function paintTile(put, terrain, x, y, at, size = 8) {
  const [base, alt] = TERRAIN_KEYS[terrain] || ['g', 'G'];
  const h = hashInts(x, y, 7);
  const r = unit(h);
  if (size < 8) {
    for (let j = 0; j < size; j += 1) for (let i = 0; i < size; i += 1) put(i, j, base);
    if (terrain === T.PAINTED) {
      // The hills' colour bands, on a checkerboard so they read as pastel at a distance.
      const band = PAINTED_KEYS[Math.floor(fbm(x / 7, y / 7, 5) * 7) % PAINTED_KEYS.length];
      for (let j = 0; j < size; j += 1) for (let i = 0; i < size; i += 1) if ((i + j + x + y) % 2 === 0) put(i, j, band);
    } else if (terrain === T.MOOR || terrain === T.BASALT || terrain === T.PINE || terrain === T.FOREST) put(size - 1, size - 1, alt);
    else if (r < 0.35) put((h >>> 8) % size, (h >>> 12) % size, alt);
    return;
  }
  const fill = (key) => { for (let j = 0; j < 8; j += 1) for (let i = 0; i < 8; i += 1) put(i, j, key); };
  const a = (h >>> 4) % 6;
  const b = (h >>> 9) % 6 + 1;
  const jx = ((h >>> 14) % 3) - 1; // a pixel of jitter so trees don't sit on a grid
  switch (terrain) {
    case T.GRASS:
      fill('g');
      if (r < 0.35) { put(a, b, 'G'); put(a + 2, b, 'G'); put(a + 1, b + 1, 'G'); } else if (r < 0.45) { put(a, b, 'h'); put(a + 1, b, 'h'); }
      break;
    case T.MEADOW:
      fill('h');
      if (r < 0.35) { put(a, b, 'k'); put(a, b + 1, 'G'); } else if (r < 0.55) { put(a, b, 'u'); put(a, b + 1, 'G'); } else if (r < 0.7) put(a + 1, b, 'j');
      break;
    case T.FOREST:
      fill('G');
      for (let j = 0; j < 7; j += 1) {
        for (let i = 0; i < 8; i += 1) {
          const d = (i - 3.5 - jx) ** 2 + (j - 3) ** 2;
          if (d > 11) continue;
          put(i, j, d > 6 && (i > 3 + jx || j > 3) ? 'L' : i + j < 5 + jx ? 'q' : 'l');
        }
      }
      put(3 + jx, 7, 'm'); put(4 + jx, 7, 'm');
      break;
    case T.PINE:
      fill('G');
      [0, 1, 1, 2, 2, 3, 3].forEach((w, j) => {
        for (let i = 4 - w - 1; i <= 3 + w; i += 1) {
          const ii = i + jx;
          if (ii < 0 || ii > 7) continue;
          put(ii, j, i === 4 - w - 1 ? 'l' : i === 3 + w ? 'M' : 'L');
        }
      });
      put(3 + jx, 7, 'm'); put(4 + jx, 7, 'm');
      break;
    case T.BIRCH:
      fill('j');
      for (let j = 0; j < 6; j += 1) {
        for (let i = 0; i < 8; i += 1) {
          const d = (i - 3.5 - jx) ** 2 + (j - 2.6) ** 2;
          if (d > 7.5) continue;
          put(i, j, d > 4 && (i > 3 + jx || j > 2) ? 'l' : 'q');
        }
      }
      put(3 + jx, 5, 'c'); put(3 + jx, 6, 'o'); put(3 + jx, 7, 'c');
      break;
    case T.MARSH:
      fill('j');
      for (let i = 0; i < 4; i += 1) { put(a + i, b, 'w'); if (i > 0 && i < 3) put(a + i, b + 1, 'W'); }
      put((a + 5) % 8, 2, 'L'); put((a + 5) % 8, 3, 'm'); put((a + 6) % 8, 3, 'L'); put((a + 6) % 8, 4, 'm');
      break;
    case T.PAINTED: {
      // Madder, woad, weld and heather grow in bands across the hills (LORE.md, the Painted Hills).
      const band = PAINTED_KEYS[Math.floor(fbm(x / 7, y / 7, 5) * 7) % PAINTED_KEYS.length];
      fill('h');
      for (let j = 0; j < 8; j += 1) for (let i = 0; i < 8; i += 1) if ((i + j * 3 + x * 8) % 4 === 0 || (i + j) % 7 === 0) put(i, j, band);
      if (r < 0.3) put(a, b, 'G');
      break;
    }
    case T.ROCK:
      fill('S');
      put(a, b, 's'); put(a + 1, b, 's'); put(a + 2, b, 's'); put(a + 1, b - 1, 's'); put(a, b + 1, 'z'); put(a + 1, b + 1, 'z'); put(a + 2, b + 1, 'z');
      if (r < 0.5) put((a + 4) % 8, (b + 3) % 8, 'z');
      break;
    case T.MOUNTAIN: {
      fill('z');
      const snowy = y < -60 || at(0, -1) === T.SNOW;
      for (let j = 1; j < 8; j += 1) {
        const w = Math.floor((j + 1) / 2);
        for (let i = 4 - w; i < 4 + w; i += 1) put(i, j, j < 3 && snowy ? 'c' : i < 4 ? 's' : 'S');
      }
      break;
    }
    case T.SNOW:
      fill('c');
      if (r < 0.4) { put(a, b, 'f'); put(a + 1, b, 'f'); } else if (r < 0.6) { put(a, b, 'C'); put(a + 1, b + 1, 'C'); }
      if (r > 0.94) { put(3, 3, 'L'); put(2, 4, 'L'); put(3, 4, 'L'); put(4, 4, 'M'); put(3, 5, 'm'); }
      break;
    case T.BASALT:
      fill('z');
      for (let j = 0; j < 8; j += 1) { if ((j + (x & 1)) % 2 === 0) { put(1, j, 'o'); put(5, j, 'o'); } put(3, j, 'S'); }
      if (r < 0.07) { put(a, b, 'U'); put(a, b - 1, 'u'); }
      break;
    case T.MOOR:
      fill('S');
      for (let j = 0; j < 8; j += 1) for (let i = 0; i < 8; i += 1) if (unit(hashInts(x * 8 + i, y * 8 + j, 3)) < 0.35) put(i, j, 'G');
      if (r < 0.35) { put(a, b, 'V'); put(a + 1, b, 'V'); } else if (r < 0.42) { put(a, b, 's'); put(a, b + 1, 'z'); }
      break;
    case T.RIVER:
    case T.SEA:
    case T.DEEP: {
      fill(terrain === T.DEEP ? 'W' : 'w');
      if (r < 0.3) { put(a, b, terrain === T.DEEP ? 'w' : 'f'); put(a + 1, b, terrain === T.DEEP ? 'w' : 'f'); }
      // Foam where water meets land.
      const land = (dx, dy) => { const t = at(dx, dy); return !WATERY.has(t) && t !== T.BRIDGE && t !== T.SKY; };
      if (land(0, -1)) for (let i = 0; i < 8; i += 1) if (i % 3 !== 2) put(i, 0, 'f');
      if (land(0, 1)) for (let i = 0; i < 8; i += 1) if (i % 3 !== 1) put(i, 7, 'f');
      if (land(-1, 0)) for (let j = 0; j < 8; j += 1) if (j % 3 !== 2) put(0, j, 'f');
      if (land(1, 0)) for (let j = 0; j < 8; j += 1) if (j % 3 !== 1) put(7, j, 'f');
      break;
    }
    case T.SAND:
      fill('p');
      if (r < 0.5) { put(a, b, 'P'); put((a + 3) % 8, (b + 2) % 8, 'P'); }
      break;
    case T.ROAD: {
      fill('p');
      const edge = (dx, dy) => { const t = at(dx, dy); return t !== T.ROAD && t !== T.BRIDGE && t !== T.HEART; };
      if (edge(0, -1)) for (let i = 0; i < 8; i += 1) if ((i + x) % 2 === 0) put(i, 0, 'P');
      if (edge(0, 1)) for (let i = 0; i < 8; i += 1) if ((i + x) % 2 === 1) put(i, 7, 'P');
      if (edge(-1, 0)) for (let j = 0; j < 8; j += 1) if ((j + y) % 2 === 0) put(0, j, 'P');
      if (edge(1, 0)) for (let j = 0; j < 8; j += 1) if ((j + y) % 2 === 1) put(7, j, 'P');
      if (r < 0.3) put(a + 1, b, 'P');
      break;
    }
    case T.BRIDGE:
      fill('b');
      for (let i = 0; i < 8; i += 1) { put(i, 2, 'B'); put(i, 5, 'B'); put(i, 0, 'n'); }
      break;
    case T.SKY: {
      // An isle floating over the eastern sea: grass on top, rock beneath, a cloud at the rim.
      fill('h');
      for (let i = 0; i < 8; i += 1) if ((i + y) % 3 === 0) put(i, 1, 'g');
      if (at(0, 1) !== T.SKY) for (let i = 0; i < 8; i += 1) { put(i, 5, 'g'); put(i, 6, i % 2 ? 'S' : 's'); put(i, 7, i > 1 && i < 6 ? 'z' : 'W'); }
      if (at(0, -1) !== T.SKY) for (let i = 0; i < 8; i += 1) put(i, 0, i % 2 ? 'f' : 'c');
      break;
    }
    case T.DOWNS:
      fill('j');
      if (r < 0.06) { for (let j = 2; j < 6; j += 1) { put(3, j, 's'); put(4, j, j === 5 ? 'S' : 's'); } put(3, 3, 'o'); put(4, 4, 'o'); } else if (r < 0.4) { put(a, b, 'g'); put(a + 1, b, 'g'); }
      break;
    default:
      fill(base);
  }
}

/**
 * Paint a rectangle of the world at `size` pixels per tile. Hearthvale's own tiles are left
 * clear (0), because the vale is drawn from its own map. Returns palette key codes per pixel.
 */
export function paintRegion(world, x0, y0, w, h, size = 8) {
  const W = w * size;
  const H = h * size;
  const keys = new Uint8Array(W * H);
  const terrain = new Uint8Array((w + 2) * (h + 2));
  for (let j = -1; j <= h; j += 1) for (let i = -1; i <= w; i += 1) terrain[(j + 1) * (w + 2) + (i + 1)] = world.terrainAt(x0 + i, y0 + j);
  const scale = size >= 8 ? size / 8 : 1;
  const art = size >= 8 ? 8 : size;
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const t = terrain[(j + 1) * (w + 2) + (i + 1)];
      if (t === T.HEART) continue;
      const at = (dx, dy) => terrain[(j + 1 + dy) * (w + 2) + (i + 1 + dx)];
      paintTile((pi, pj, key) => {
        if (pi < 0 || pj < 0 || pi >= art || pj >= art) return;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) keys[(j * size + pj * scale + sy) * W + i * size + pi * scale + sx] = key.charCodeAt(0);
        }
      }, t, x0 + i, y0 + j, at, art);
    }
  }
  return { keys, width: W, height: H };
}

/** The world's own colours by key code, for colourise(). */
export function basePaletteByCode() {
  const out = [];
  for (const [key, { hex }] of Object.entries(PALETTE)) {
    if (!hex.startsWith('#')) continue;
    out[key.charCodeAt(0)] = [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
  }
  return out;
}

/** A genre palette ({ key: [r, g, b] }) by key code. */
export const byCode = (palette) => {
  const out = [];
  for (const [key, rgb] of Object.entries(palette)) out[key.charCodeAt(0)] = rgb;
  return out;
};

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/**
 * Turn key codes into RGBA. `bleeds` recolour around rifts: [{ x, y (pixels), inner, outer,
 * palette (by code) }]. The fade is dithered in 2x2 blocks, and where bleeds overlap the
 * genres interleave (a fusion).
 */
export function colourise(keys, width, height, base, bleeds = []) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const code = keys[p];
      if (!code) continue;
      let palette = base;
      if (bleeds.length) {
        const active = [];
        for (const bleed of bleeds) {
          const raw = Math.hypot(x - bleed.x, y - bleed.y);
          if (raw > bleed.outer + bleed.wobble / 2) continue;
          const d = raw + (fbm(x / 13, y / 13, bleed.seed || 0, { octaves: 2 }) - 0.5) * bleed.wobble;
          const s = d <= bleed.inner ? 1 : d >= bleed.outer ? 0 : (bleed.outer - d) / (bleed.outer - bleed.inner);
          if (s >= 1 || (s > 0 && (BAYER[(y >> 1) & 3][(x >> 1) & 3] + 0.5) / 16 < s)) active.push(bleed);
        }
        if (active.length) palette = active[((x >> 1) + (y >> 1)) % active.length].palette;
      }
      const rgb = palette[code] || base[code];
      if (!rgb) continue;
      out[p * 4] = rgb[0];
      out[p * 4 + 1] = rgb[1];
      out[p * 4 + 2] = rgb[2];
      out[p * 4 + 3] = 255;
    }
  }
  return out;
}
