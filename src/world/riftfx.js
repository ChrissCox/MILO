// Rift drawing (CONTRACT-PHASE3.md §7.2, RIFTS.md §2): the tear, the bleed, the strays that
// wander out of it, and the art for the seal and let-go animations. Pure and deterministic, so
// it runs in Node for the tests and in the renderer for the engine; canvases are the engine's.
//
//   tearArt(stage, genre, frame, { warded })   the tear in three sizes, shimmering over TEAR_FRAMES
//   spriteTable(genre)                          { key: [r, g, b, a] } for sprites.rowsToImageData
//   outfitGrid(name, rows), outfitPixels(...)   a person in a genre: only their clothes change
//   coatColours(genre), COAT_TONES              Milo's coat in a genre, never left honey (a honey glow gives way)
//   bleedLobes(rift), bleedReach(rift)          a fusion's bleed as one lobe per genre; how far it reaches
//   bleedsFor(rift, opts)                       bleed specs for wildsart.colourise / colouriseChunk
//   bleedAt(rifts, wx, wy, { genres })          which genre (if any) colours this world pixel (ground)
//   bleedStrengthAt, tileStrength               the undithered strength (at a pixel, over a tile)
//   tileDressAt, bleedDressAt, makeDresser      the genre a sprite wears, whole (walkers with hysteresis)
//   strayActors(rift, { walkable, seed, hooks }) strays (and a gaping rift's Tale-lead, by its shown name) with pure positionAt(t)
//   weatherPixels(rift, { genres, t, rifts })   the genre's weather inside the bleed (none with motion off)
//   sealArt / letGoFrame / mothArt              the seal (1.2 s) and let-go (2 s) animations, by progress
//   leadSprite, artPixels, strayPixels          the Tale-lead's look, and RGBA for panels and previews
//
// Genre arguments are content/genres.json entries (or their ids, with `genres` given).
import { PALETTE, MILO, CREW_ART } from './sprites.js';
import { buildGenrePalette, ROLES, hexToRgb, rgbToHsl, hslToRgb } from './genres.js';
import { createRng, fbm, hashInts, hashString, unit } from './rng.js';
import { composeStray } from './straygen.js';
import { HEART } from './worldgen.js';
import { leadDisplayName } from './leadname.js';

const TILE = 16;
const FEET = 13; // feet sit 13 px into a tile, as in the engine
export const RIFT_RADIUS = Object.freeze({ hairline: 3, open: 5, gaping: 7 });
export const INNER_RADIUS = 1.6; // tiles: inside it the bleed is whole
export const WOBBLE = 2.5; // tiles of noise on the bleed's edge
/**
 * How far strays roam from the tear, in tiles (tile centre to tile centre). The inner radius
 * (1.6) only holds the eight tiles round the tear, and the tear itself hides the one or two
 * behind it, which is too tight for five strays and a Tale-lead. So they roam the dense core of
 * the bleed instead, and only on tiles it mostly dresses (STRAY_COVER).
 */
export const STRAY_ROAM = Object.freeze({ hairline: 0, open: 2.6, gaping: 3.4 });
/** The least share of a tile the rift's own bleed must recolour for a stray to stand on it. */
export const STRAY_COVER = 0.75;
export const TEAR_FRAMES = 4;
export const TEAR_FRAME_MS = 280; // a slow shimmer: one frame every 280 ms
export const ANIMATION_MS = Object.freeze({ seal: 1200, letGo: 2000 });
const STAGES = ['hairline', 'open', 'gaping'];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const HEART_PX = Object.freeze({ x0: HEART.x * TILE, y0: HEART.y * TILE, x1: (HEART.x + HEART.w) * TILE, y1: (HEART.y + HEART.h) * TILE });

const mod = (n, m) => ((n % m) + m) % m;
const stageOf = (value) => (STAGES.includes(value) ? value : 'open');

// ---------- genres ----------

const INDEX = new WeakMap();
/** Map of genre id → genres.json entry, from the content object, its genres array, or a map. */
export function genreIndex(genres) {
  if (!genres) return new Map();
  if (genres instanceof Map) return genres;
  if (typeof genres === 'object' && INDEX.has(genres)) return INDEX.get(genres);
  const list = Array.isArray(genres) ? genres : Array.isArray(genres.genres) ? genres.genres : Object.values(genres);
  const map = new Map(list.filter((g) => g && typeof g.id === 'string').map((g) => [g.id, g]));
  if (typeof genres === 'object') INDEX.set(genres, map);
  return map;
}

const resolveGenre = (genre, genres) => (typeof genre === 'string' ? genreIndex(genres).get(genre) || null : genre || null);

const PALETTES = new WeakMap();
/** The genre's palette { key: [r, g, b] } (cached per genre entry); {} without one. */
export function genrePalette(genre) {
  if (!genre || typeof genre !== 'object') return {};
  let palette = PALETTES.get(genre);
  if (!palette) {
    palette = buildGenrePalette(genre);
    PALETTES.set(genre, palette);
  }
  return palette;
}

const BY_CODE = new WeakMap();
/** The genre palette by key code (for colourise), cached. */
export function paletteByCode(genre) {
  if (!genre || typeof genre !== 'object') return [];
  let out = BY_CODE.get(genre);
  if (!out) {
    out = [];
    for (const [key, rgb] of Object.entries(genrePalette(genre))) out[key.charCodeAt(0)] = rgb;
    BY_CODE.set(genre, out);
  }
  return out;
}

const BASE_RGBA = Object.fromEntries(Object.entries(PALETTE).map(([key, { hex }]) => {
  if (hex.startsWith('rgba')) {
    const [r, g, b, a] = hex.slice(5, -1).split(',').map((part) => Number(part.trim()));
    return [key, [r, g, b, Math.round(a * 255)]];
  }
  return [key, [...hexToRgb(hex), 255]];
}));
const BASE_RGB = Object.fromEntries(Object.entries(BASE_RGBA).map(([key, rgba]) => [key, rgba.slice(0, 3)]));

// ---------- the coat ----------

/**
 * Milo's raincoat is honey: the glow role's butter, honey and honey-deep (u, U, Y). In a dressed
 * grid (outfitGrid) the coat's pixels carry tone keys of their own, so a genre dresses the coat
 * apart from the glow it shares those keys with: lantern flames and lit windows keep the genre's
 * glow while the coat takes coatColours. Every sprite table carries the tones.
 */
export const COAT_TONES = Object.freeze({ u: '1', U: '2', Y: '3' });
const COAT_KEYS = Object.keys(COAT_TONES);
/**
 * A genre's coat clashes when it stays within this colour distance (CIE76 ΔE, averaged over the
 * coat's three tones) of Milo's own honey coat: its glow is honey too (Gothic's candlelight
 * #f5c35c, say), and he'd look undressed in it. See coatColours.
 */
export const COAT_CLASH = 30;
// Roles a coat never takes when it looks further than the rift's inner colour: the outline's
// ink, the cream highlights and skin would lose him against himself.
const COAT_NEVER = new Set(['ink', 'light', 'skin']);

const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function toLab([r, g, b]) {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const fy = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const fz = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** How far apart two [r, g, b] colours look (CIE76 ΔE: about 2 is just noticeable). */
export function colourDistance(a, b) {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const BASE_COAT = Object.freeze(COAT_KEYS.map((key) => Object.freeze([...BASE_RGB[key]])));
/** How far a coat's tones ([[r, g, b] × 3], light to deep) look from Milo's own, on average. */
export function coatDistance(coat) {
  return coat.reduce((sum, rgb, i) => sum + colourDistance(rgb, BASE_COAT[i]), 0) / coat.length;
}

// A role's colour as the coat: the honey tone U (most of the coat) takes the colour itself, and
// butter and honey-deep keep their own lightness steps from it, as buildGenrePalette shades a role.
const COAT_LIGHTNESS = COAT_KEYS.map((key) => rgbToHsl(BASE_RGB[key])[2]);
function coatOf(hex, contrast = 1) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const anchor = COAT_LIGHTNESS[COAT_KEYS.indexOf('U')];
  return COAT_LIGHTNESS.map((own) => Object.freeze(hslToRgb([h, s, Math.min(0.97, Math.max(0.03, l + (own - anchor) * contrast))])));
}

const COATS = new WeakMap();
/**
 * Milo's coat in a genre: its three tones [[r, g, b] light, honey, deep] (cached, frozen). The
 * genre's own glow, unless that clashes with his honey coat (COAT_CLASH), when it's the genre's
 * rift.inner role colour, the colour inside its tears, shaded in the same steps; should that clash
 * too (the Backhalls are all yellow), the genre's role that looks furthest from honey. No genre:
 * his own.
 */
export function coatColours(genre, { genres } = {}) {
  genre = resolveGenre(genre, genres);
  if (!genre || typeof genre !== 'object') return BASE_COAT;
  let coat = COATS.get(genre);
  if (coat) return coat;
  const palette = genrePalette(genre);
  coat = COAT_KEYS.map((key) => Object.freeze([...(palette[key] || BASE_RGB[key])]));
  if (coatDistance(coat) < COAT_CLASH) {
    const roles = genre.roles || {};
    const inner = genre.rift?.inner;
    const own = roles[inner] ? coatOf(roles[inner], genre.contrast ?? 1) : null;
    if (own && coatDistance(own) >= COAT_CLASH) coat = own;
    else {
      let far = coatDistance(coat);
      for (const role of Object.keys(ROLES)) {
        if (!roles[role] || COAT_NEVER.has(role)) continue;
        const other = coatOf(roles[role], genre.contrast ?? 1);
        const d = coatDistance(other);
        if (d > far) { far = d; coat = other; }
      }
    }
  }
  coat = Object.freeze(coat);
  COATS.set(genre, coat);
  return coat;
}

const TABLES = new WeakMap();
const BASE_TABLE = Object.freeze({
  ...BASE_RGBA,
  ...Object.fromEntries(COAT_KEYS.map((key) => [COAT_TONES[key], BASE_RGBA[key]])),
});
/**
 * An RGBA table for sprites.rowsToImageData(rows, makeImageData, table) and buildAtlas: every
 * PALETTE key in the genre's colours, and the coat's tones (COAT_TONES) in coatColours. The
 * translucent shadow 'x' keeps its alpha and takes the genre's ink, so a shadow still darkens a
 * dark genre's ground. A genre id works too, with { genres }; without a genre (or one it can't
 * find) it's the world's own colours.
 */
export function spriteTable(genre, { genres } = {}) {
  genre = resolveGenre(genre, genres);
  if (!genre || typeof genre !== 'object') return BASE_TABLE;
  let table = TABLES.get(genre);
  if (!table) {
    const palette = genrePalette(genre);
    table = {};
    for (const key of Object.keys(PALETTE)) {
      if (key === 'x') table.x = [...(palette.o || BASE_RGB.o), BASE_RGBA.x[3]];
      else table[key] = [...(palette[key] || BASE_RGB[key]), 255];
    }
    coatColours(genre).forEach((rgb, i) => { table[COAT_TONES[COAT_KEYS[i]]] = [...rgb, 255]; });
    Object.freeze(table);
    TABLES.set(genre, table);
  }
  return table;
}

// ---------- outfits ----------

/**
 * "Outfits for free" (§7.2): inside a genre a person is still themselves. Their skin, eyes, outline,
 * hair, blush and boots keep the Hushlands' own colours, and only their clothes take the genre's.
 * By sprite family (a sprite's name up to its first dot):
 *   keys   the clothes' palette keys
 *   from   the row the clothes start at: above it is the head, where the same keys stay as they are
 *   trim   keys that belong to the clothes only where they touch them (Milo's raincoat is edged in
 *          wood 'b', which is also the shine on his hair), each with the clothes key it wears instead
 *   coat   clothes keys drawn in the coat's own tones (COAT_TONES, coatColours), so the coat always
 *          visibly changes, even in a genre whose glow is as honey as it is
 * Families not listed (the helpers, Jev, Whisper) wear nothing to dress, and stay as they are.
 */
export const OUTFITS = Object.freeze({
  milo: Object.freeze({ keys: 'uUYrRQ', from: MILO.headSplit, trim: Object.freeze({ b: 'Y' }), coat: 'uUY' }), // raincoat and scarf
  claude: Object.freeze({ keys: 'rRQ', from: 0 }), // hood and robe; the face is cream
  codex: Object.freeze({ keys: 'eEN', from: 0 }), // hood and robe; the book stays wood
  ollama: Object.freeze({ keys: 'kKuUY', from: CREW_ART.ollama.split }), // the saddle blanket, not the ears or cheeks
});

const outfitOf = (name) => OUTFITS[String(name || '').split('.')[0]] || null;
const OUTFIT_GRIDS = new WeakMap(); // rows → { rows, layers } | null

/**
 * A person's sprite grid made ready to dress: { rows, layers }, layers '1' on the clothes (drawn
 * from the genre's table) and '0' on everything else (the world's own colours), with any trim
 * swapped to its clothes key in rows, and then any coat key to its tone. For the painter: grid(rows, null, key, { layers, table2 }).
 * Cached per grid, frozen. null when the sprite has nothing to dress: draw it as it is.
 *
 * A fight frame (CONTRACT-PHASE4.md §7.8) passes its own `split` (the head-split row, which a padded,
 * crouched or jumping frame moves) and `wear` (rows of '1' where clothes may be, '.' on what the
 * person holds, so a lantern's butter glass is never dressed as coat). With either, the result is
 * cached per grid, split and mask; the two-argument call is exactly Phase 3's.
 */
export function outfitGrid(name, rows, { split = null, wear = null } = {}) {
  const outfit = outfitOf(name);
  if (!outfit || !Array.isArray(rows) || !rows.length) return null;
  if (split == null && wear == null) {
    if (OUTFIT_GRIDS.has(rows)) return OUTFIT_GRIDS.get(rows);
    const out = dressRows(outfit, rows, outfit.from, null);
    OUTFIT_GRIDS.set(rows, out);
    return out;
  }
  const from = Number.isFinite(split) ? Math.max(0, Math.floor(split)) : outfit.from;
  const mask = Array.isArray(wear) && wear.length === rows.length ? wear : null;
  let entry = OUTFIT_POSED.get(rows);
  if (!entry) {
    entry = new Map();
    OUTFIT_POSED.set(rows, entry);
  }
  const key = `${String(name || '').split('.')[0]}|${from}|${mask ? maskId(mask) : '-'}`;
  if (entry.has(key)) return entry.get(key);
  const out = dressRows(outfit, rows, from, mask);
  entry.set(key, out);
  return out;
}

const OUTFIT_POSED = new WeakMap(); // rows → Map(family|split|mask → { rows, layers } | null)
const MASK_IDS = new WeakMap();
let maskCount = 0;
function maskId(mask) {
  let id = MASK_IDS.get(mask);
  if (!id) {
    maskCount += 1;
    id = maskCount;
    MASK_IDS.set(mask, id);
  }
  return id;
}

function dressRows(outfit, rows, from, wear) {
  const h = rows.length;
  const w = rows[0].length;
  const cells = rows.map((row) => [...row]);
  const worn = rows.map(() => new Array(w).fill('0'));
  const trim = outfit.trim || {};
  const wearable = (x, y) => !wear || (wear[y] && wear[y][x] === '1');
  const queue = [];
  for (let y = from; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!outfit.keys.includes(cells[y][x]) || !wearable(x, y)) continue;
      worn[y][x] = '1';
      queue.push([x, y]);
    }
  }
  // Trim joins the clothes where it touches them, and trim touching that trim (a hem, a seam).
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (ny < from || ny >= h || nx < 0 || nx >= w || worn[ny][nx] === '1' || !wearable(nx, ny)) continue;
      const to = trim[cells[ny][nx]];
      if (!to) continue;
      cells[ny][nx] = to;
      worn[ny][nx] = '1';
      queue.push([nx, ny]);
    }
  }
  // The coat wears its own tones (spriteTable carries them), not the glow it shares keys with.
  if (outfit.coat) for (const [x, y] of queue) if (outfit.coat.includes(cells[y][x])) cells[y][x] = COAT_TONES[cells[y][x]];
  return queue.length
    ? Object.freeze({ rows: Object.freeze(cells.map((row) => row.join(''))), layers: Object.freeze(worn.map((row) => row.join(''))) })
    : null;
}

/**
 * RGBA pixels for a person (sprite `name`, grid `rows`) wearing a genre: their clothes in its
 * colours and the rest of them as they are. No genre, or nothing to dress: the world's own colours.
 * Genres may be entries or ids (with `genres`).
 */
export function outfitPixels(name, rows, genre, { genres } = {}) {
  const g = resolveGenre(genre, genres);
  const outfit = g ? outfitGrid(name, rows) : null;
  const grid = outfit ? outfit.rows : rows;
  const dressed = spriteTable(g);
  const w = grid[0].length;
  const h = grid.length;
  const data = new Uint8ClampedArray(w * h * 4);
  grid.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const key = row[x];
      if (key === '.') continue;
      const rgba = (outfit && outfit.layers[y][x] === '1' ? dressed : BASE_TABLE)[key];
      if (!rgba) continue;
      const i = (y * w + x) * 4;
      data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    }
  });
  return { width: w, height: h, data };
}

// ---------- the tear ----------

// Tear body masks by stage: '.' clear, 'a' rim, 'd' ink, 'b' the other world inside. A torn slit
// that leans a little, with serrated edges, grown from scripts/rift-preview.mjs's proven tear.
const TEAR_MASKS = {
  hairline: [
    '...a.', '...a.', '..da.', '..ada', '.ada.', '.ad..', 'adbda', '.ada.', '.da..', 'ada..', '.a...', '.a...', '.a...',
  ],
  open: [
    '.....a...', '.....a...', '....ada..', '....ada..', '...adbda.', '...adbda.', '..adbbda.',
    '..adbbbda', '.adbbbbda', '.adbbbda.', 'adbbbbbda', '.adbbbbda', '.adbbbda.', 'adbbbbda.',
    '.adbbbda.', '.adbbda..', '..adbda..', '..adbda..', '..ada....', '...a.....', '...a.....',
  ],
  gaping: [
    '........a....', '........a....', '.......ada...', '.......ada...', '......adbda..', '......adbda..',
    '.....adbbda..', '.....adbbbda.', '....adbbbbda.', '....adbbbda..', '...adbbbbbda.', '...adbbbbbbda',
    '..adbbbbbbda.', '..adbbbbbbbda', '.adbbbbbbbda.', '.adbbbbbbbbda', 'adbbbbbbbbda.', '.adbbbbbbbda.',
    'adbbbbbbbbda.', '.adbbbbbbbda.', '.adbbbbbbda..', '..adbbbbbda..', '..adbbbbda...', '..adbbbda....',
    '...adbbda....', '...adbda.....', '...ada.......', '....a........', '....a........',
  ],
};
// Halo margin round the body (px) and how far below the body's bottom tip the feet point is.
const HALO = { hairline: 2, open: 3, gaping: 4 };
const HALO_DENSITY = { hairline: 0.34, open: 0.42, gaping: 0.46 };
const LIFT = { hairline: 3, open: 3, gaping: 3 };
// The Bindery's thread for a ward: cream thread and a honey shade, in the Hushlands' own colours
// (the binding is ours, not the other story's).
const THREAD = Object.freeze({ t: Object.freeze([...BASE_RGB.c]), T: Object.freeze([...BASE_RGB.U]) });

function darkestKey(palette, role) {
  const keys = ROLES[role] || [];
  let best = null;
  let bestL = Infinity;
  for (const key of keys) {
    const rgb = palette[key];
    if (!rgb) continue;
    const l = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    if (l < bestL) { bestL = l; best = key; }
  }
  return best;
}

const TEAR_COLOURS = new WeakMap();
let PLAIN_COLOURS = null;
/** The tear's colours for a genre (cached, frozen; copies, so the genre's palette stays its own). */
function tearColours(genre) {
  const cached = genre && typeof genre === 'object' ? TEAR_COLOURS.get(genre) : PLAIN_COLOURS;
  if (cached) return cached;
  const palette = genrePalette(genre);
  const rimRole = genre?.rift?.rim && ROLES[genre.rift.rim] ? genre.rift.rim : 'glow';
  const innerRole = genre?.rift?.inner && ROLES[genre.rift.inner] ? genre.rift.inner : 'roof';
  const pick = (key, fallback) => Object.freeze([...(palette[key] || BASE_RGB[key] || fallback)]);
  const rim = pick(ROLES[rimRole][0]);
  const inner = pick(ROLES[innerRole][0]);
  const colours = Object.freeze({
    d: pick('o'), // ink edge
    a: rim, // rim
    A: pick('c'), // rim catching the light
    h: pick(ROLES[rimRole][1] || ROLES[rimRole][0]), // the halo, a step down from the rim
    b: inner, // the other world
    B: pick(darkestKey(palette, innerRole) || ROLES[innerRole][0]), // its depths
    i: rim, // glints of the other world's light
  });
  if (genre && typeof genre === 'object') TEAR_COLOURS.set(genre, colours);
  else PLAIN_COLOURS = colours;
  return colours;
}

function bodyFrame(stage, frame) {
  const mask = TEAR_MASKS[stage];
  const H = mask.length;
  const f = mod(frame | 0, TEAR_FRAMES);
  return mask.map((row, y) => [...row].map((ch, x) => {
    // A band of light travels up the rim, two rows a frame.
    if (ch === 'a') return mod(y + f * 2, 8) < 2 && y > 1 && y < H - 2 ? 'A' : 'a';
    if (ch !== 'b') return ch;
    // Inner pixels beside the ink edge are the depths; glints drift down through the rest.
    const edge = row[x - 1] === 'd' || row[x + 1] === 'd';
    if (edge && stage !== 'hairline') return 'B';
    const lane = hashInts(x, 7) % 8;
    return mod(y - f * 2 - lane, 8) === 0 && y > 1 && y < H - 2 ? 'i' : 'b';
  }));
}

// Each stage's halo distance field, worked out once: for every clear pixel round the body, its
// distance to the nearest body pixel (squashed a little vertically). Every shimmer frame shares
// the body's outline, so one field serves them all.
const HALO_FIELDS = {};
function haloField(stage) {
  if (HALO_FIELDS[stage]) return HALO_FIELDS[stage];
  const mask = TEAR_MASKS[stage];
  const m = HALO[stage];
  const W = mask[0].length + m * 2;
  const H = mask.length + m * 2;
  const body = [];
  mask.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') body.push([x + m, y + m]); }));
  const dist = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let d = Infinity;
      for (const [bx, by] of body) d = Math.min(d, Math.hypot(x - bx, (y - by) * 0.8));
      dist[y * W + x] = d;
    }
  }
  HALO_FIELDS[stage] = { W, H, dist };
  return HALO_FIELDS[stage];
}

function haloAround(grid, stage, frame) {
  const m = HALO[stage];
  const h = grid.length;
  const w = grid[0].length;
  const { W, H: Ht, dist } = haloField(stage);
  const out = Array.from({ length: Ht }, () => Array(W).fill('.'));
  grid.forEach((row, y) => row.forEach((ch, x) => {
    if (ch !== '.') out[y + m][x + m] = ch;
  }));
  const f = mod(frame | 0, TEAR_FRAMES);
  const density = HALO_DENSITY[stage] * (f === 2 ? 0.86 : 1); // a slow breath
  for (let y = 0; y < Ht; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (out[y][x] !== '.') continue;
      const d = dist[y * W + x];
      if (d > m + 0.5) continue;
      // A sparse single-pixel dither that hugs the tear and thins out.
      const s = density * (1 - (d - 1) / (m + 0.5));
      if ((BAYER[y & 3][x & 3] + 0.5) / 16 < s) out[y][x] = 'h';
    }
  }
  return { rows: out, body: { x: m, y: m, w, h } };
}

function stitchOver(grid, body, stage) {
  // Sutures across the opening, each a little slanted, as the Bindery ties a warded seam.
  const count = { hairline: 2, open: 3, gaping: 4 }[stage];
  for (let n = 0; n < count; n += 1) {
    const cy = Math.round(body.y + ((n + 1) * body.h) / (count + 1));
    const row = grid[cy];
    let left = -1;
    let right = -1;
    for (let x = body.x; x < body.x + body.w; x += 1) {
      if (row[x] === 'd' || row[x] === 'b' || row[x] === 'B' || row[x] === 'i') {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left < 0) continue;
    const x0 = left - 1;
    const x1 = right + 1;
    const mid = (x0 + x1) / 2;
    for (let x = x0; x <= x1; x += 1) {
      const y = cy + Math.round((mid - x) * 0.34);
      if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) continue;
      grid[y][x] = x === x0 || x === x1 ? 'T' : 't';
    }
  }
}

/**
 * The tear for a stage ('hairline' ~5×13, 'open' ~9×21, 'gaping' ~13×29 in its body), with a
 * dithered halo round it. frame (0..TEAR_FRAMES-1, wraps) shimmers the rim and drifts glints
 * through the opening. { warded: true } adds the Bindery's binding stitch across it (the same
 * function; there is no separate warded one).
 * → { rows, colours: { key: [r, g, b] }, w, h, anchor: { x, y }, body: { x, y, w, h } }
 * anchor is the pixel that sits on the rift tile's feet point (tile*16 + 8, tile*16 + 13).
 * Cached per genre, stage, frame and ward (there are only 24 of each genre's), so the engine can
 * call it every frame: the art comes back frozen, the same object each time. Don't change it.
 */
export function tearArt(stage, genre, frame = 0, { warded = false, genres } = {}) {
  genre = resolveGenre(genre, genres);
  const s = stageOf(stage);
  const f = mod(frame | 0, TEAR_FRAMES);
  const cache = tearCache(genre);
  const key = `${s}:${f}:${warded ? 1 : 0}`;
  let art = cache.get(key);
  if (!art) {
    art = drawTear(s, genre, f, Boolean(warded));
    cache.set(key, art);
  }
  return art;
}

const TEAR_CACHE = new WeakMap();
const PLAIN_TEARS = new Map();
function tearCache(genre) {
  if (!genre || typeof genre !== 'object') return PLAIN_TEARS;
  let cache = TEAR_CACHE.get(genre);
  if (!cache) {
    cache = new Map();
    TEAR_CACHE.set(genre, cache);
  }
  return cache;
}

function drawTear(s, genre, frame, warded) {
  const grid = bodyFrame(s, frame);
  const { rows, body } = haloAround(grid, s, frame);
  if (warded) stitchOver(rows, body, s);
  const colours = { ...tearColours(genre) };
  if (warded) Object.assign(colours, THREAD);
  const used = new Set(rows.flat());
  for (const key of Object.keys(colours)) if (!used.has(key)) delete colours[key];
  const out = rows.map((row) => row.join(''));
  return Object.freeze({
    rows: Object.freeze(out),
    colours: Object.freeze(colours),
    w: out[0].length,
    h: out.length,
    anchor: Object.freeze({ x: body.x + (body.w >> 1), y: body.y + body.h - 1 + LIFT[s] }),
    body: Object.freeze(body),
  });
}

// Each body row's left and right edge and its middle (in tear-art px), so the seal's thread
// follows the tear's lean. Worked out once per stage.
const SPANS = {};
function tearSpans(stage) {
  if (!SPANS[stage]) {
    const m = HALO[stage];
    SPANS[stage] = TEAR_MASKS[stage].map((row) => {
      const l = row.search(/[^.]/);
      const r = row.length - 1 - [...row].reverse().join('').search(/[^.]/);
      return Object.freeze({ l: l + m, r: r + m, c: Math.round((l + r) / 2) + m });
    });
  }
  return SPANS[stage];
}

/** Which shimmer frame to draw at time t (ms); 0 with motion off (t null). */
export const tearFrameAt = (t, phase = 0) => (t == null || !Number.isFinite(t) ? 0 : mod(Math.floor((t + phase) / TEAR_FRAME_MS), TEAR_FRAMES));

/**
 * The seal (ANIMATION_MS.seal): the Bindery's thread runs down the tear, the tear draws shut and
 * a few sparks fly. progress 0..1; the same frame size and anchor as tearArt, so the engine draws
 * it in place. At 1 nothing is left. Cheap enough to call every frame: it starts from the cached
 * tear, and its own work is a few hundred pixels.
 */
export function sealArt(stage, genre, progress) {
  const s = stageOf(stage);
  const base = tearArt(s, genre, 0);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const { body } = base;
  const colours = { ...tearColours(genre), t: THREAD.t, T: THREAD.T };
  if (p >= 1) return { ...base, rows: base.rows.map((row) => '.'.repeat(row.length)), colours: {} };
  const rows = base.rows.map((row) => [...row]);
  const mask = TEAR_MASKS[s];
  const spans = tearSpans(s);
  const close = p <= 0.5 ? 0 : Math.min(1, (p - 0.5) / 0.38);
  for (let j = 0; j < body.h; j += 1) {
    const y = body.y + j;
    const { l, r, c } = spans[j];
    if (close > 0) {
      // The opening draws shut toward the thread: rim, ink and a sliver of the other world.
      const half = ((r - l) / 2) * (1 - close);
      for (let x = l; x <= r; x += 1) {
        const d = Math.abs(x - c);
        rows[y][x] = d > half + 0.01 ? '.' : d > half - 1 ? 'a' : d > half - 2 ? 'd' : mask[j][x - body.x] === '.' ? '.' : rows[y][x];
      }
    }
    // The thread runs down the spine over the first half, and stays.
    if (j < Math.round(Math.min(1, p / 0.5) * body.h)) rows[y][c] = j % 3 === 2 ? 'T' : 't';
  }
  // The halo thins as it closes.
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] === 'h' && (BAYER[y & 3][x & 3] + 0.5) / 16 < close * 1.1) rows[y][x] = '.';
    }
  }
  // A few sparks fly out and up as it shuts.
  if (p > 0.55) {
    const sparks = { hairline: 4, open: 6, gaping: 8 }[s];
    const t = (p - 0.55) / 0.45;
    const midY = body.y + body.h / 2;
    const midX = spans[body.h >> 1].c;
    for (let n = 0; n < sparks; n += 1) {
      const angle = (n / sparks) * Math.PI * 2 + 0.4;
      const reach = 3 + t * (body.w * 0.6 + 3);
      const x = Math.round(midX + Math.cos(angle) * reach);
      const y = Math.round(midY + Math.sin(angle) * reach * 1.4 - t * 3);
      if (t < 0.9 && y >= 0 && y < rows.length && x >= 0 && x < rows[0].length) rows[y][x] = n % 2 ? 'A' : 'a';
    }
  }
  const used = new Set(rows.flat());
  for (const key of Object.keys(colours)) if (!used.has(key)) delete colours[key];
  return { ...base, rows: rows.map((row) => row.join('')), colours };
}

// A pale moth: two wing frames, in the Hushlands' cream with soft ink, 11×7.
const MOTH = [
  ['....o.o....', '.ooo.o.ooo.', 'occcoCoccco', 'ocCccoccCco', '.occcoccco.', '..oCoooCo..', '...o.o.o...'],
  ['....o.o....', '...o.o.o...', '..occocco..', '..oCcocCo..', '..occocco..', '...oCoCo...', '....o.o....'],
];
const MOTH_COLOURS = { o: BASE_RGB.o, c: BASE_RGB.c, C: BASE_RGB.C };

/** The let-go moth's art (frame 0 wings up, 1 wings down). */
export function mothArt(frame = 0) {
  return { rows: MOTH[mod(frame | 0, 2)], colours: { ...MOTH_COLOURS }, anchor: { x: 5, y: 5 } };
}

/**
 * The let-go (ANIMATION_MS.letGo): the tear folds into a pale moth, which flies west and fades.
 * → { rows, colours, anchor, dx, dy, alpha }: draw rows with anchor at the rift's feet point plus
 * (dx, dy) world px, at alpha.
 */
export function letGoFrame(stage, genre, progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const s = stageOf(stage);
  if (p < 0.3) {
    // The tear folds: its body squashes toward its middle, and the halo goes.
    const base = tearArt(s, genre, 0);
    const k = 1 - p / 0.3;
    const { body } = base;
    const mid = body.y + body.h / 2;
    const rows = base.rows.map((row, y) => [...row].map((ch) => {
      if (ch === 'h') return p > 0.1 ? '.' : ch;
      return Math.abs(y + 0.5 - mid) <= (body.h / 2) * k + 1 ? ch : '.';
    }).join(''));
    return { rows, colours: base.colours, anchor: base.anchor, dx: 0, dy: 0, alpha: 1 };
  }
  const q = (p - 0.3) / 0.7;
  const moth = mothArt(Math.floor(q * 14) % 2);
  const lift = { hairline: 7, open: 11, gaping: 15 }[s];
  return {
    ...moth,
    dx: -Math.round(q * 96),
    dy: -Math.round(lift + q * 22 + Math.sin(q * Math.PI * 3) * 4),
    alpha: q > 0.55 ? Math.max(0, Math.round((1 - (q - 0.55) / 0.45) * 1000) / 1000) : 1,
  };
}

// ---------- the bleed ----------

function riftGenres(rift) {
  if (!rift) return [];
  if (Array.isArray(rift.spec?.genres)) return rift.spec.genres;
  if (Array.isArray(rift.genres)) return rift.genres;
  if (typeof rift.genre === 'string') return [rift.genre];
  return [];
}

const isStanding = (rift) => typeof rift.radius === 'number' && !rift.spec && !rift.stage;

/** The bleed's shape in tiles for a rift (stage radius) or a standing bleed ({ radius, genre }). */
function bleedShape(rift) {
  if (isStanding(rift)) {
    return { inner: rift.radius * 0.55, outer: rift.radius, wobble: 5, seed: mod(hashInts(rift.x, rift.y, 'standing'), 997) };
  }
  const stage = stageOf(rift.stage || rift.spec?.stage);
  const seed = Number.isFinite(rift.spec?.seed) ? rift.spec.seed : hashString(String(rift.id || `${rift.x},${rift.y}`));
  return { inner: INNER_RADIUS, outer: RIFT_RADIUS[stage], wobble: WOBBLE, seed: mod(seed, 997) };
}

const placed = (rift) => rift && Number.isFinite(rift.x) && Number.isFinite(rift.y) && !rift.held;

// FNV-1a of a rift id, folded to 0..8999: which way a fusion's lobes turn.
const turnOf = (text) => {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 9000;
};

/** How far each lobe of a fusion's bleed sits off its tear, in tiles, by stage. */
export const LOBE_OFFSET = Object.freeze({ hairline: 1, open: 1.5, gaping: 2 });

const LOBES = new WeakMap(); // rift → { sig, index, lobes }
/**
 * How a rift bleeds into the world: one bleed, or for a fusion (or a Maelstrom) one lobe per genre,
 * each set a little off the tear in its own direction (fixed by the rift's id). Where the lobes
 * overlap, round the tear, their colours interleave; out on each side one story holds the ground.
 * (Two bleeds on one centre would weave the whole disc into a checker.) A lobe is the rift with one
 * genre: { ...rift, id: '<rift id>~<n>', lobeOf, x, y (quarter tiles), stage, spec }. A rift of one
 * genre, and a standing bleed, is its own single lobe. With `genres`, genres it can't look up don't
 * count. bleedsFor, bleedAt, bleedCover, weatherPixels and strayActors all bleed through this, so
 * the ground, the sprites, the weather and every map agree. Cached per rift object.
 */
export function bleedLobes(rift, { genres } = {}) {
  if (!rift || !rift.spec || isStanding(rift)) return [rift];
  const all = genres ? genreIndex(genres) : null;
  const index = all && all.size ? all : null; // with no genres to look them up in, every genre counts
  const stage = stageOf(rift.stage || rift.spec.stage);
  const sig = `${rift.id}|${rift.x},${rift.y}|${stage}`;
  const known = LOBES.get(rift);
  if (known && known.sig === sig && known.index === index && known.genres === rift.spec.genres) return known.lobes;
  let ids = riftGenres(rift);
  if (index) ids = ids.filter((id) => index.has(id));
  let lobes = [rift];
  if (ids.length >= 2) {
    const d = LOBE_OFFSET[stage];
    const turn = (turnOf(rift.id) / 9000) * Math.PI * 2;
    lobes = ids.map((genre, i) => {
      const a = turn + (i * Math.PI * 2) / ids.length;
      return Object.freeze({
        ...rift,
        id: `${rift.id}~${i}`,
        lobeOf: rift.id,
        x: rift.x + Math.round(Math.cos(a) * d * 4) / 4,
        y: rift.y + Math.round(Math.sin(a) * d * 4) / 4,
        stage,
        spec: { ...rift.spec, genres: [genre] },
      });
    });
  }
  lobes = Object.freeze(lobes);
  LOBES.set(rift, { sig, index, genres: rift.spec.genres, lobes });
  return lobes;
}

/**
 * How far a rift's bleed can reach from its tear, in px at tileSize: the outer radius, half the
 * wobble, and a fusion's lobe offset. For culling (which chunks and views a bleed touches).
 */
export function bleedReach(rift, tileSize = TILE) {
  if (isStanding(rift)) return (rift.radius + 2.5) * tileSize;
  const stage = stageOf(rift.stage || rift.spec?.stage);
  const lobe = riftGenres(rift).length >= 2 ? LOBE_OFFSET[stage] : 0;
  return (RIFT_RADIUS[stage] + WOBBLE / 2 + lobe) * tileSize;
}

/**
 * Bleed specs for one rift, for wildsart.colourise(keys, w, h, base, bleeds) and the wilds'
 * colouriseChunk: one per lobe (bleedLobes: a fusion's genres each hold a side and interleave
 * where they overlap), each { x, y, inner, outer, wobble, seed, palette (by key code), genre,
 * riftId, lobe, heart }, with x, y the lobe's centre in px relative to (originX, originY). The
 * heart's pixels are never part of a bleed: chunk ground leaves them 0, and `heart` is their local
 * rect for any painter that fills them. A held rift has no bleed. Also takes a standing bleed
 * { x, y, radius, genre }.
 */
export function bleedsFor(rift, { tileSize = TILE, originX = 0, originY = 0, genres } = {}) {
  if (!placed(rift)) return [];
  const index = genreIndex(genres);
  const scale = tileSize / TILE;
  const heart = { x0: HEART_PX.x0 * scale - originX, y0: HEART_PX.y0 * scale - originY, x1: HEART_PX.x1 * scale - originX, y1: HEART_PX.y1 * scale - originY };
  const out = [];
  bleedLobes(rift, { genres: index }).forEach((lobe, n) => {
    const shape = bleedShape(lobe);
    const x = (lobe.x + 0.5) * tileSize - originX;
    const y = (lobe.y + 0.5) * tileSize - originY;
    for (const id of riftGenres(lobe)) {
      const genre = index.get(id);
      if (!genre) continue;
      out.push({
        x, y,
        inner: shape.inner * tileSize, outer: shape.outer * tileSize, wobble: shape.wobble * tileSize, seed: shape.seed,
        palette: paletteByCode(genre), genre: id, riftId: rift.id ?? null, lobe: n, heart,
      });
    }
  });
  return out;
}

/**
 * The genre that colours world pixel (wx, wy) under these rifts, or null. The same test the wilds'
 * colouriseChunk makes: each 2x2 block of art pixels is decided at its centre pixel (world px)
 * by wobbled distance, a 2x2 ordered dither in the fringe and a 2x2 interleave where bleeds
 * overlap (in the order of `rifts`, then each rift's lobes, as bleedsFor lists them). Always null
 * inside the heart. For ground (and weather, strays' cover): sprites are dressed whole by the
 * undithered strength instead (bleedDressAt, nextDress), never by one dithered pixel.
 */
export function bleedAt(rifts, worldPxX, worldPxY, { genres, tileSize = TILE } = {}) {
  const x = (Math.floor(worldPxX) & ~1) + 1;
  const y = (Math.floor(worldPxY) & ~1) + 1;
  const scale = tileSize / TILE;
  if (x >= HEART_PX.x0 * scale && y >= HEART_PX.y0 * scale && x < HEART_PX.x1 * scale && y < HEART_PX.y1 * scale) return null;
  if (!Array.isArray(rifts) || !rifts.length) return null;
  const index = genreIndex(genres);
  const threshold = (BAYER[(y >> 1) & 3][(x >> 1) & 3] + 0.5) / 16;
  const active = [];
  for (const rift of rifts) {
    if (!placed(rift)) continue;
    // A quick miss before any lobe is looked at.
    if (Math.hypot(x - (rift.x + 0.5) * tileSize, y - (rift.y + 0.5) * tileSize) > bleedReach(rift, tileSize)) continue;
    for (const lobe of bleedLobes(rift, { genres: index })) {
      const ids = riftGenres(lobe).filter((id) => index.size === 0 || index.has(id));
      if (!ids.length) continue;
      const shape = bleedShape(lobe);
      const inner = shape.inner * tileSize;
      const outer = shape.outer * tileSize;
      const wobble = shape.wobble * tileSize;
      const raw = Math.hypot(x - (lobe.x + 0.5) * tileSize, y - (lobe.y + 0.5) * tileSize);
      if (raw > outer + wobble / 2) continue;
      const d = raw + (fbm(x / 13, y / 13, shape.seed, { octaves: 2 }) - 0.5) * wobble;
      const s = d <= inner ? 1 : d >= outer ? 0 : (outer - d) / (outer - inner);
      if (s >= 1 || (s > 0 && threshold < s)) active.push(...ids);
    }
  }
  if (!active.length) return null;
  return active[mod((x >> 1) + (y >> 1), active.length)];
}

// ---------- dressing sprites ----------

/**
 * When a sprite takes a bleed's genre, by the bleed's undithered strength s (bleedStrengthAt), never
 * by one dithered pixel of the ground: a sprite that stands (a tree, a point of interest, the chop
 * table) is dressed when the mean strength over its foot tile is at least at (tileDressAt), and
 * anything standing at a pixel by the mean over spread px round it (bleedDressAt). One that walks
 * (Milo, the crew) puts a genre on at on, keeps it until it falls to off, and changes to another
 * genre only when that one is stronger by swap (nextDress, makeDresser), so a coat changes once per
 * crossing: the bleed's wobbled edge folds back on itself within a few px, which the spread and the
 * hysteresis ride out.
 */
export const DRESS = Object.freeze({ at: 0.5, on: 0.55, off: 0.45, swap: 0.1, spread: 8 });

const inHeartPx = (x, y, tileSize) => {
  const scale = tileSize / TILE;
  return x >= HEART_PX.x0 * scale && y >= HEART_PX.y0 * scale && x < HEART_PX.x1 * scale && y < HEART_PX.y1 * scale;
};

// The strongest of summed strengths ({ id: sum } over n points), as { genre, s, strengths }.
function meanHit(sum, n, prefer) {
  let best = null;
  const strengths = {};
  for (const id of Object.keys(sum)) {
    const s = sum[id] / n;
    strengths[id] = s;
    if (!best || s > best.s || (s === best.s && id === prefer)) best = { genre: id, s };
  }
  return best ? { genre: best.genre, s: best.s, strengths } : null;
}

/**
 * How strongly the bleeds hold world pixel (wx, wy), undithered: { genre, s, strengths }, where s
 * (0..1) is the strength bleedAt dithers against, from the same wobbled distance at the same 2x2
 * block, genre is the strongest genre there and strengths holds every genre that reaches the
 * pixel ({ id: s }). A fusion's lobes each count for their own genre (where two are equally strong
 * the nearer lobe wins, not a checker). null where no bleed reaches, and always in the heart.
 * With spread (px), each strength is the mean over points every 4 px within spread of (wx, wy)
 * (the heart's own points count as 0); still null at a heart pixel.
 */
export function bleedStrengthAt(rifts, worldPxX, worldPxY, { genres, tileSize = TILE, spread = 0 } = {}) {
  const x = (Math.floor(worldPxX) & ~1) + 1;
  const y = (Math.floor(worldPxY) & ~1) + 1;
  if (inHeartPx(x, y, tileSize)) return null;
  if (!Array.isArray(rifts) || !rifts.length) return null;
  const index = genreIndex(genres);
  if (spread > 0) {
    const centre = bleedStrengthAt(rifts, worldPxX, worldPxY, { genres: index, tileSize });
    const sum = {};
    let n = 0;
    const r = Math.floor(spread / 4) * 4;
    for (let dy = -r; dy <= r; dy += 4) {
      for (let dx = -r; dx <= r; dx += 4) {
        n += 1;
        const hit = dx || dy ? bleedStrengthAt(rifts, worldPxX + dx, worldPxY + dy, { genres: index, tileSize }) : centre;
        if (hit) for (const id of Object.keys(hit.strengths)) sum[id] = (sum[id] || 0) + hit.strengths[id];
      }
    }
    return meanHit(sum, n, centre?.genre);
  }
  const strengths = {};
  let best = null;
  for (const rift of rifts) {
    if (!placed(rift)) continue;
    if (Math.hypot(x - (rift.x + 0.5) * tileSize, y - (rift.y + 0.5) * tileSize) > bleedReach(rift, tileSize)) continue;
    for (const lobe of bleedLobes(rift, { genres: index })) {
      const ids = riftGenres(lobe).filter((id) => index.size === 0 || index.has(id));
      if (!ids.length) continue;
      const shape = bleedShape(lobe);
      const inner = shape.inner * tileSize;
      const outer = shape.outer * tileSize;
      const wobble = shape.wobble * tileSize;
      const raw = Math.hypot(x - (lobe.x + 0.5) * tileSize, y - (lobe.y + 0.5) * tileSize);
      if (raw > outer + wobble / 2) continue;
      const d = raw + (fbm(x / 13, y / 13, shape.seed, { octaves: 2 }) - 0.5) * wobble;
      const s = d <= inner ? 1 : d >= outer ? 0 : (outer - d) / (outer - inner);
      if (s <= 0) continue;
      for (const id of ids) {
        if (!(strengths[id] >= s)) strengths[id] = s;
        if (!best || s > best.s || (s === best.s && raw < best.raw)) best = { genre: id, s, raw };
      }
    }
  }
  return best ? { genre: best.genre, s: best.s, strengths } : null;
}

/**
 * The bleeds' strength over wild tile (tx, ty): the mean of bleedStrengthAt over its 4x4 grid of
 * points (the same ground bleedCover counts, undithered), as { genre, s, strengths }, or null.
 * Always null for a tile of the heart.
 */
export function tileStrength(rifts, tx, ty, { genres } = {}) {
  if (tx >= HEART.x && ty >= HEART.y && tx < HEART.x + HEART.w && ty < HEART.y + HEART.h) return null;
  if (!Array.isArray(rifts) || !rifts.length) return null;
  const index = genreIndex(genres);
  const sum = {};
  let n = 0;
  let prefer = null;
  for (let py = 2; py < TILE; py += 4) {
    for (let px = 2; px < TILE; px += 4) {
      n += 1;
      const hit = bleedStrengthAt(rifts, tx * TILE + px, ty * TILE + py, { genres: index });
      if (!hit) continue;
      if (px === 10 && py === 10) prefer = hit.genre;
      for (const id of Object.keys(hit.strengths)) sum[id] = (sum[id] || 0) + hit.strengths[id];
    }
  }
  return meanHit(sum, n, prefer);
}

/**
 * The genre to dress a sprite standing on wild tile (tx, ty) in (a tree, a point of interest, the
 * chop table: whatever stands on a tile), or null: the strongest bleed once it holds the tile's
 * ground at least DRESS.at on the whole (tileStrength). A tile the bleed mostly recolours
 * (bleedCover ≥ 0.75) always dresses what stands on it; one it barely touches (≤ 0.25) never does.
 */
export function tileDressAt(rifts, tx, ty, options = {}) {
  const hit = tileStrength(rifts, tx, ty, options);
  return hit && hit.s >= DRESS.at ? hit.genre : null;
}

/**
 * The genre to dress a sprite whose feet are at world pixel (wx, wy) in, or null: the strongest
 * bleed once its strength over DRESS.spread px round the feet is at least DRESS.at. For a sprite
 * that stands at a pixel rather than on a tile; one that walks wants a dresser (makeDresser).
 * Always null in the heart.
 */
export function bleedDressAt(rifts, worldPxX, worldPxY, { genres, tileSize = TILE, spread = DRESS.spread } = {}) {
  const hit = bleedStrengthAt(rifts, worldPxX, worldPxY, { genres, tileSize, spread });
  return hit && hit.s >= DRESS.at ? hit.genre : null;
}

/**
 * The dress a walking sprite wears next, with hysteresis: prev (a genre id or null) and hit
 * (bleedStrengthAt where it now stands). A genre goes on at s ≥ DRESS.on and stays on until its own
 * s falls to DRESS.off; another genre takes over only when it's stronger by DRESS.swap.
 */
export function nextDress(prev, hit) {
  if (prev) {
    const mine = hit?.strengths?.[prev] || 0;
    if (mine > DRESS.off) return hit.genre !== prev && hit.s >= DRESS.on && hit.s >= mine + DRESS.swap ? hit.genre : prev;
  }
  return hit && hit.s >= DRESS.on ? hit.genre : null;
}

/**
 * A dresser for one walking sprite (Milo, a crew member): dress(rifts, wx, wy, opts) → the genre it
 * wears with its feet at world pixel (wx, wy), remembering what it wore last (nextDress over the
 * strength spread DRESS.spread px round the feet). dress.reset() forgets it (after a jump, or on
 * leaving an Elsewhere); dress.current is the last answer.
 */
export function makeDresser({ genres } = {}) {
  let last = null;
  const dress = (rifts, worldPxX, worldPxY, options = {}) => {
    last = nextDress(last, bleedStrengthAt(rifts, worldPxX, worldPxY, { genres, spread: DRESS.spread, ...options }));
    return last;
  };
  dress.reset = () => { last = null; };
  Object.defineProperty(dress, 'current', { get: () => last });
  return dress;
}

/**
 * How much of wild tile (x, y) the rift's own bleed recolours, 0..1: the share of the tile's 64
 * 2x2 blocks that bleedAt([rift]) dresses. 0 in the heart and for a held rift.
 */
export function bleedCover(rift, x, y, { genres } = {}) {
  let hit = 0;
  for (let py = 1; py < TILE; py += 2) {
    for (let px = 1; px < TILE; px += 2) if (bleedAt([rift], x * TILE + px, y * TILE + py, { genres }) !== null) hit += 1;
  }
  return hit / ((TILE / 2) * (TILE / 2));
}

// ---------- weather ----------

/**
 * The genre's weather inside a rift's bleed at time t (ms), as single pixels in world px:
 * [{ x, y, rgb }]. Empty with motion off (t null), for a held rift, and inside the heart. Only
 * pixels on ground this rift colours are kept: pass all the `rifts` in view, and where another
 * rift's bleed wins a block, this one's weather stays out of it.
 */
export function weatherPixels(rift, { genres, t, rifts = null } = {}) {
  if (t == null || !Number.isFinite(t) || !placed(rift)) return [];
  const index = genreIndex(genres);
  // Each genre's weather falls over its own lobe of the bleed (a fusion: each story on its side).
  const parts = [];
  for (const lobe of bleedLobes(rift, { genres: index })) {
    for (const id of riftGenres(lobe)) if (index.has(id)) parts.push({ id, lobe });
  }
  if (!parts.length) return [];
  const out = [];
  parts.forEach(({ id, lobe }, g) => {
    const shape = bleedShape(lobe);
    const outer = shape.outer * TILE;
    const cx = (lobe.x + 0.5) * TILE;
    const cy = (lobe.y + 0.5) * TILE;
    const area = Math.PI * outer * outer;
    const inside = (x, y) => {
      if (x >= HEART_PX.x0 && y >= HEART_PX.y0 && x < HEART_PX.x1 && y < HEART_PX.y1) return false;
      if (bleedAt([lobe], x, y, { genres: index }) === null) return false;
      return (rifts ? bleedAt(rifts, x, y, { genres: index }) : bleedAt([rift], x, y, { genres: index })) === id;
    };
    const genre = index.get(id);
    const particles = genre.particles || {};
    if (!particles.density || particles.type === 'none') return;
    const rgb = genrePalette(genre)[particles.key] || genrePalette(genre).c || BASE_RGB.c;
    const count = Math.min(160, Math.round((area * particles.density) / parts.length));
    const seed = hashInts(shape.seed, g, 'weather');
    for (let n = 0; n < count; n += 1) {
      const h = hashInts(seed, n);
      const u = unit(h);
      const v = unit(hashInts(h, 1));
      const phase = unit(hashInts(h, 2));
      const bx = cx - outer + u * outer * 2;
      const by = cy - outer + v * outer * 2;
      const pts = particlePixels(particles.type, bx, by, t, phase, outer * 2);
      for (const [px, py] of pts) {
        const x = Math.round(px);
        const y = Math.round(py);
        if (inside(x, y)) out.push({ x, y, rgb });
      }
    }
  });
  return out;
}

function particlePixels(type, x, y, t, phase, span) {
  const cycle = (period) => mod(t / period + phase, 1);
  switch (type) {
    case 'rain': { // falls fast in short streaks
      const fy = y - span / 2 + cycle(1400) * span;
      return [[x, fy], [x, fy + 1], [x, fy + 2]];
    }
    case 'stars': case 'specks': { // hold still and twinkle
      return cycle(3200) < 0.62 ? [[x + (type === 'specks' ? Math.sin(t / 2600 + phase * 6) * 2 : 0), y]] : [];
    }
    case 'sparkles': { // a small plus that blinks
      const c = cycle(2400);
      if (c > 0.4) return [];
      return c < 0.12 || c > 0.28 ? [[x, y]] : [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    }
    case 'fog': case 'mist': { // drifts sideways in soft strands
      const fx = x - span / 2 + cycle(type === 'fog' ? 16000 : 12000) * span;
      const len = type === 'fog' ? 5 : 3;
      return Array.from({ length: len }, (_, i) => [fx + i, y]);
    }
    case 'smog': { // specks rising slowly
      return [[x + Math.sin(t / 1800 + phase * 6), y + span / 2 - cycle(9000) * span]];
    }
    case 'dust': { // drifting along on the wind
      return [[x - span / 2 + cycle(7000) * span, y + Math.sin(t / 900 + phase * 6) * 1.5]];
    }
    case 'petals': { // falling slowly on a slant
      const c = cycle(8000);
      const px = x - span / 4 + c * span / 2 + Math.sin(t / 700 + phase * 6) * 2;
      const py = y - span / 2 + c * span;
      return [[px, py], [px + 1, py]];
    }
    default:
      return [];
  }
}

// ---------- strays ----------

// Every genre's four stray parts, and its Tale-lead's body (mirrors content/riftgen.json: the
// contract passes only genres.json to riftfx, so the lead's look is kept here). Content wins
// when a riftgen `words` bank is passed.
const LEAD_LOOK = Object.freeze({
  neon: { parts: ['visor', 'antenna', 'cableTail', 'neonTrim'], archetype: 'floater', bodyKey: 'r' },
  nocturne: { parts: ['batEars', 'batWings', 'sleepyEyes', 'moonCharm'], archetype: 'flier', bodyKey: 'V' },
  gothic: { parts: ['candle', 'hollowEyes', 'ribbonCollar', 'ravenFeather'], archetype: 'ghost', bodyKey: 'c' },
  iron: { parts: ['rivets', 'smokestack', 'gear', 'goggles'], archetype: 'construct', bodyKey: 's' },
  void: { parts: ['extraEyes', 'tentacles', 'starHalo', 'thirdEye'], archetype: 'floater', bodyKey: 'v' },
  noir: { parts: ['fedora', 'redScarf', 'magnifier', 'notepad'], archetype: 'walker', bodyKey: 's' },
  frontier: { parts: ['cowboyHat', 'bandana', 'starBadge', 'lasso'], archetype: 'walker', bodyKey: 'b' },
  kaiju: { parts: ['hazardStripes', 'horn', 'jetFlame', 'armorPlate'], archetype: 'walker', bodyKey: 'b' },
  verdant: { parts: ['leafCrown', 'flower', 'solarPanel', 'vineTail'], archetype: 'flier', bodyKey: 'l' },
  starlight: { parts: ['bow', 'starWand', 'sparkleEyes', 'ribbonTail'], archetype: 'floater', bodyKey: 'k' },
  summit: { parts: ['topknot', 'jadePendant', 'cloudSash', 'fan'], archetype: 'walker', bodyKey: 'l' },
  backhalls: { parts: ['badge', 'mop', 'fluorescentHalo', 'keyring'], archetype: 'construct', bodyKey: 'c' },
});
const TEMPERAMENTS = ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud'];
const HOVERING = new Set(['floater', 'flier', 'ghost']);

/**
 * The Tale-lead's sprite: its genre's body with every one of the genre's parts. Its archetype and
 * body colour follow the rift's own strays of that genre when there are any.
 */
export function leadSprite(spec, { words } = {}) {
  const lead = spec?.taleLead || {};
  const genre = lead.genre || spec?.genres?.[0];
  const look = LEAD_LOOK[genre] || LEAD_LOOK.neon;
  const bank = words?.genres?.[genre];
  const kin = (spec?.strays || []).find((s) => s.genre === genre);
  const archetype = kin?.archetype || bank?.preferred?.[0] || look.archetype;
  const bodyKey = kin?.bodyKey || bank?.bodyKeys?.[0] || look.bodyKey;
  const parts = (bank?.parts || look.parts).map((id) => ({ id, layer: 0 }));
  // `parts` too (Phase 4), so a fight can recompose the lead posed and at 28 × 28.
  return { archetype, bodyKey, parts, sprite: composeStray({ archetype, bodyKey, parts }) };
}

function spriteFeet(rows) {
  let bottom = rows.length - 1;
  while (bottom > 0 && !/[^.]/.test(rows[bottom])) bottom -= 1;
  return { x: rows[0].length >> 1, y: bottom };
}

const keyOf = (x, y) => `${x},${y}`;
const feetOf = (tile) => ({ x: tile.x * TILE + 8, y: tile.y * TILE + FEET });
const inHeartOrRing = (x, y) => x >= HEART.x - 1 && y >= HEART.y - 1 && x <= HEART.x + HEART.w && y <= HEART.y + HEART.h;

function neighbours(x, y) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
}

/** Tiles of `allowed` (a Set of 'x,y') reachable from `from` by 4-way steps, with BFS distance. */
function component(allowed, from) {
  const dist = new Map([[keyOf(from.x, from.y), 0]]);
  const list = [{ x: from.x, y: from.y }];
  for (let head = 0; head < list.length; head += 1) {
    const { x, y } = list[head];
    const d = dist.get(keyOf(x, y));
    for (const [nx, ny] of neighbours(x, y)) {
      const k = keyOf(nx, ny);
      if (!allowed.has(k) || dist.has(k)) continue;
      dist.set(k, d + 1);
      list.push({ x: nx, y: ny });
    }
  }
  return { list, dist };
}

function pathBetween(allowed, from, to) {
  if (from.x === to.x && from.y === to.y) return [];
  const prev = new Map([[keyOf(from.x, from.y), null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur.x === to.x && cur.y === to.y) break;
    for (const [nx, ny] of neighbours(cur.x, cur.y)) {
      const k = keyOf(nx, ny);
      if (!allowed.has(k) || prev.has(k)) continue;
      prev.set(k, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  if (!prev.has(keyOf(to.x, to.y))) return [];
  const path = [];
  for (let cur = to; cur && !(cur.x === from.x && cur.y === from.y); cur = prev.get(keyOf(cur.x, cur.y))) path.push(cur);
  return path.reverse();
}

const DIRS = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };

/**
 * A slow, seeded wander between the tiles of `allowed` reachable from `home`: pause, amble one to
 * three tiles, pause again, and come home at the end of each loop. positionAt(t) is pure: it only
 * reads the precomputed loop. t null (motion off) → standing at home.
 */
export function makeWanderer({ home, allowed, seed, speed = null, pauseMs = [1400, 4600], legs = 10 }) {
  const rng = createRng(seed >>> 0);
  const pxPerSec = speed ?? 12 + rng.next() * 8;
  const stepMs = (TILE / pxPerSec) * 1000;
  const { list } = component(allowed, home);
  const moves = []; // { t0, t1, from, to, dir, moving }
  let t = 0;
  let dir = rng.pick(['down', 'left', 'right', 'down']);
  let at = { x: home.x, y: home.y };
  const pause = (ms) => {
    moves.push({ t0: t, t1: t + ms, from: at, to: at, dir, moving: false });
    t += ms;
  };
  const walk = (path) => {
    for (const next of path) {
      dir = DIRS[`${next.x - at.x},${next.y - at.y}`] || dir;
      moves.push({ t0: t, t1: t + stepMs, from: at, to: next, dir, moving: true });
      t += stepMs;
      at = next;
    }
  };
  pause(rng.int(pauseMs[0], pauseMs[1]));
  if (list.length > 1) {
    for (let leg = 0; leg < legs; leg += 1) {
      // Somewhere one to three steps away by foot (not as the crow flies, so a hop never turns
      // into a trek round a thicket).
      const { list: around, dist } = component(allowed, at);
      const near = around.filter((tile) => {
        const d = dist.get(keyOf(tile.x, tile.y));
        return d >= 1 && d <= 3;
      });
      if (near.length) walk(pathBetween(allowed, at, rng.pick(near)));
      // Sometimes just turn and look about.
      if (rng.chance(0.3)) dir = rng.pick(['left', 'right', 'down']);
      pause(rng.int(pauseMs[0], pauseMs[1]));
    }
    // Home again, in the same short hops.
    let back = pathBetween(allowed, at, home);
    while (back.length > 3) {
      walk(back.slice(0, 3));
      back = back.slice(3);
      pause(rng.int(pauseMs[0], pauseMs[1]));
    }
    walk(back);
    pause(rng.int(pauseMs[0], pauseMs[1]));
  }
  const period = t;
  const offset = rng.next() * period;
  const homeFeet = feetOf(home);
  const homeDir = moves[0].dir;
  function positionAt(tMs) {
    if (tMs == null || !Number.isFinite(tMs)) return { x: homeFeet.x, y: homeFeet.y, dir: homeDir, moving: false };
    const local = mod(tMs + offset, period);
    let lo = 0;
    let hi = moves.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (moves[mid].t0 <= local) lo = mid;
      else hi = mid - 1;
    }
    const m = moves[lo];
    const k = m.moving ? Math.min(1, (local - m.t0) / (m.t1 - m.t0)) : 0;
    const a = feetOf(m.from);
    const b = feetOf(m.to);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: m.dir, moving: m.moving };
  }
  return { positionAt, period, speed: pxPerSec, tiles: list };
}

/**
 * The tiles the tear stands in front of (its art rises about 1.6 tiles above its feet when open,
 * 2.2 when gaping): a stray there would be hidden behind it.
 */
export function behindTear(stage, rx, ry, x, y) {
  return x === rx && y < ry && y >= ry - (stageOf(stage) === 'gaping' ? 2 : 1);
}

function spreadHomes(candidates, count, rng, avoid = []) {
  const order = rng.shuffle(candidates);
  const homes = [];
  for (const gap of [2, 1, 0]) {
    for (const tile of order) {
      if (homes.length >= count) break;
      if (homes.includes(tile)) continue;
      const clear = [...homes, ...avoid].every((h) => Math.max(Math.abs(h.x - tile.x), Math.abs(h.y - tile.y)) >= gap);
      if (clear) homes.push(tile);
    }
  }
  return homes;
}

/**
 * The strays that have wandered out of a rift: up to 2 of each stray kind, 5 in all, from 'open';
 * a hairline has none, and a held rift none. A gaping rift adds its Tale-lead, standing still
 * beside the tear (lead: true, drawn at 1x here). They amble at 12–20 px/s between walkable tiles
 * within STRAY_ROAM of the tear that its bleed dresses at least STRAY_COVER of: never on the
 * tear's own tile or the ones it hides behind it, and never in the vale or its ring.
 * It does some work (a wander loop per stray): call it once per rift and stage, and keep it.
 * → [{ id, name, temperament, genre, second, sprite: { rows, layers }, feet: { x, y }, hover,
 *      home: { x, y } (tile), speed, lead?, line?, mechanic?, scale,
 *      positionAt(tMs) → { x, y (feet, world px), dir, moving } }]
 */
export function strayActors(rift, { walkable = () => true, seed = 0, words, hooks = [] } = {}) {
  if (!placed(rift) || !rift.spec) return [];
  const stage = stageOf(rift.stage || rift.spec.stage);
  if (stage === 'hairline') return [];
  const spec = rift.spec;
  const salt = typeof seed === 'number' ? seed : hashString(String(seed));
  const rng = createRng(hashInts(spec.seed >>> 0, salt, 'strays'));
  const rx = rift.x;
  const ry = rift.y;
  const radius = STRAY_ROAM[stage];
  const ok = (x, y) => {
    if (inHeartOrRing(x, y)) return false;
    try { return Boolean(walkable(x, y)); } catch { return false; }
  };
  const out = [];
  let leadTile = null;
  if (stage === 'gaping' && spec.taleLead) {
    const side = spec.seed & 1 ? 1 : -1;
    const beside = [[side, 0], [-side, 0], [side, 1], [-side, 1], [0, 1], [side, -1], [-side, -1]];
    for (const [dx, dy] of beside) {
      if (ok(rx + dx, ry + dy)) { leadTile = { x: rx + dx, y: ry + dy }; break; }
    }
  }
  const allowed = new Set();
  const cells = [];
  const r = Math.ceil(radius);
  for (let y = ry - r; y <= ry + r; y += 1) {
    for (let x = rx - r; x <= rx + r; x += 1) {
      if (Math.hypot(x - rx, y - ry) > radius || (x === rx && y === ry)) continue;
      if (behindTear(stage, rx, ry, x, y)) continue;
      if (leadTile && x === leadTile.x && y === leadTile.y) continue;
      if (!ok(x, y)) continue;
      if (bleedCover(rift, x, y) < STRAY_COVER) continue;
      allowed.add(keyOf(x, y));
      cells.push({ x, y });
    }
  }
  const wanted = [];
  for (const kind of spec.strays || []) {
    for (let n = 0; n < Math.min(2, Math.max(0, kind.count | 0)); n += 1) wanted.push(kind);
  }
  const chosen = wanted.slice(0, 5);
  const homes = spreadHomes(cells, chosen.length, rng, leadTile ? [leadTile, { x: rx, y: ry }] : [{ x: rx, y: ry }]);
  chosen.slice(0, homes.length).forEach((kind, n) => {
    const home = homes[n];
    const wander = makeWanderer({ home, allowed, seed: hashInts(spec.seed >>> 0, salt, n, 'wander') });
    out.push({
      id: `stray:${rift.id}:${n}`,
      name: kind.name,
      temperament: kind.temperament,
      genre: kind.genre,
      second: kind.second || null,
      archetype: kind.archetype,
      sprite: kind.sprite,
      feet: spriteFeet(kind.sprite.rows),
      hover: HOVERING.has(kind.archetype),
      home,
      speed: wander.speed,
      scale: 1,
      positionAt: wander.positionAt,
    });
  });
  if (leadTile) {
    const lead = spec.taleLead;
    const { sprite, archetype } = leadSprite(spec, { words });
    const feet = feetOf(leadTile);
    const facing = leadTile.x > rx ? 'left' : leadTile.x < rx ? 'right' : 'up';
    out.push({
      id: `stray:${rift.id}:lead`,
      // The name it shows (Phase 4, leadname.js): never a company name, as in its Elsewhere and fight.
      name: leadDisplayName(spec, words, { hooks }),
      temperament: TEMPERAMENTS[hashInts(spec.seed >>> 0, 'lead') % TEMPERAMENTS.length],
      genre: lead.genre,
      second: null,
      archetype,
      sprite,
      feet: spriteFeet(sprite.rows),
      hover: HOVERING.has(archetype),
      home: leadTile,
      speed: 0,
      scale: 1,
      lead: true,
      line: lead.line,
      mechanic: lead.mechanic,
      positionAt: () => ({ x: feet.x, y: feet.y, dir: facing, moving: false }),
    });
  }
  return out;
}

// ---------- pixels (for panels, previews and tests) ----------

/** RGBA pixels for { rows, colours } art (tearArt, sealArt, mothArt). */
export function artPixels({ rows, colours }) {
  const w = rows[0]?.length || 0;
  const h = rows.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const rgb = colours[row[x]];
      if (!rgb) continue;
      const i = (y * w + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  });
  return { width: w, height: h, data };
}

/**
 * RGBA pixels for a stray sprite ({ rows, layers }): layer 0 in its genre's colours, layer 1 in
 * the second genre's. Genres may be entries or ids (with `genres`).
 */
export function strayPixels(sprite, genre, second = null, { genres } = {}) {
  const g0 = resolveGenre(genre, genres);
  const g1 = resolveGenre(second, genres) || g0;
  const t0 = spriteTable(g0);
  const t1 = spriteTable(g1);
  const w = sprite.rows[0].length;
  const h = sprite.rows.length;
  const data = new Uint8ClampedArray(w * h * 4);
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const key = row[x];
      if (key === '.') continue;
      const rgba = (sprite.layers?.[y]?.[x] === '1' ? t1 : t0)[key];
      if (!rgba) continue;
      const i = (y * w + x) * 4;
      data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    }
  });
  return { width: w, height: h, data };
}
