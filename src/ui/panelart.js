// Small pixel scenes for the shell's panels: a rift's tear with its strays on bled ground, a
// lantern or a point of interest on the ground it stands on (grass, the Hush's sage, a bleed, or
// the water), the Hearth's look. Pure ESM: each scene is an RGBA buffer ({ width, height, data })
// built from the world's own sprites and palettes, so it runs in Node for tests and the shell only
// puts it on a canvas at a whole-pixel scale. Phase 4 (K2) adds the company's portraits.
import { SPRITES, baseTable } from '../world/sprites.js';
import { tearArt, spriteTable, strayPixels, leadSprite, genreIndex, tearFrameAt, tileDressAt, outfitGrid } from '../world/riftfx.js';
import { tableFromPalette } from '../world/scene-art.js';
import { hushPalette } from '../world/wilds.js';
import { hashInts } from '../world/rng.js';
import { clipFrames } from '../world/sprites-party.js';
import { composeStray } from '../world/straygen.js';
import { propFrame } from '../world/props4.js';

const BASE = baseTable();

export function makeImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function put(img, x, y, rgba) {
  if (!rgba || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const alpha = rgba.length > 3 ? rgba[3] : 255;
  if (alpha <= 0) return;
  const i = (y * img.width + x) * 4;
  if (alpha >= 255 || img.data[i + 3] === 0) {
    img.data[i] = rgba[0]; img.data[i + 1] = rgba[1]; img.data[i + 2] = rgba[2]; img.data[i + 3] = alpha >= 255 ? 255 : alpha;
    return;
  }
  const a = alpha / 255;
  img.data[i] = Math.round(rgba[0] * a + img.data[i] * (1 - a));
  img.data[i + 1] = Math.round(rgba[1] * a + img.data[i + 1] * (1 - a));
  img.data[i + 2] = Math.round(rgba[2] * a + img.data[i + 2] * (1 - a));
}

/**
 * Grass (or a genre's ground) with the world's soft speckle: mostly g, some j and h, a few G tufts,
 * over rows [top, bottom) (the whole picture by default).
 */
export function fillGround(img, table = BASE, seed = 7, top = 0, bottom = img.height) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const roll = hashInts(seed, x >> 1, y >> 1) % 100;
      const key = roll < 12 ? 'j' : roll < 16 ? 'h' : 'g';
      put(img, x, y, table[key] || BASE[key]);
    }
  }
  // A few tufts, like the vale's grass decals.
  const rows = bottom - top;
  for (let n = 0; rows > 0 && n < Math.floor((img.width * rows) / 380); n += 1) {
    const x = hashInts(seed, n, 1) % img.width;
    const y = top + (hashInts(seed, n, 2) % rows);
    const deep = table.G || BASE.G;
    put(img, x, y, deep);
    put(img, x + 2, y, deep);
    if (y - 1 >= top) put(img, x + 1, y - 1, deep);
  }
  return img;
}

/** Stamps palette-key rows at (x, y). `table` maps key → [r,g,b] or [r,g,b,a]; '.' is clear. */
export function stampRows(img, rows, x, y, table = BASE) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i += 1) {
      const key = row[i];
      if (key === '.') continue;
      put(img, x + i, y + j, table[key] || BASE[key]);
    }
  });
  return img;
}

/** Stamps an RGBA buffer at (x, y), optionally mirrored. */
export function stampPixels(img, pixels, x, y, { flip = false } = {}) {
  for (let j = 0; j < pixels.height; j += 1) {
    for (let i = 0; i < pixels.width; i += 1) {
      const k = (j * pixels.width + (flip ? pixels.width - 1 - i : i)) * 4;
      if (pixels.data[k + 3] === 0) continue;
      put(img, x + i, y + j, [pixels.data[k], pixels.data[k + 1], pixels.data[k + 2], pixels.data[k + 3]]);
    }
  }
  return img;
}

/** A soft shadow under something standing at (cx, cy). */
export function shadow(img, cx, cy, w, h = 3) {
  const colour = BASE.x || [61, 64, 56, 51];
  for (let j = 0; j < h; j += 1) {
    const half = Math.round((w / 2) * Math.sqrt(1 - ((j - (h - 1) / 2) / (h / 2)) ** 2));
    for (let i = -half; i < half; i += 1) put(img, cx + i, cy - Math.floor(h / 2) + j, colour);
  }
  return img;
}

/** The painted bounds of palette-key rows (for trimming sprites with empty margins). */
function inkBounds(rows) {
  let top = rows.length; let bottom = -1; let left = rows[0].length; let right = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '.') continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
    }
  });
  return bottom < 0 ? { x: 0, y: 0, w: rows[0].length, h: rows.length } : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function pixelBounds(pixels) {
  let top = pixels.height; let bottom = -1; let left = pixels.width; let right = -1;
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] === 0) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
    }
  }
  return bottom < 0 ? { x: 0, y: 0, w: pixels.width, h: pixels.height } : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

// ---------------------------------------------------------------------------
// Scenes.

export const RIFT_SCENE = Object.freeze({ w: 108, h: 50 });

/**
 * A rift at rest: its tear in the middle of bled ground (in its first genre's colours), up to two
 * strays either side, and the Tale-lead beside a gaping one. `frame` shimmers the tear; a warded
 * rift wears the Bindery's stitch.
 */
export function riftScene(rift, { genres = null, words = null, frame = 0 } = {}) {
  const spec = rift?.spec || {};
  const index = genreIndex(genres);
  const genreId = Array.isArray(spec.genres) ? spec.genres[0] : null;
  const genre = index.get(genreId) || null;
  const table = spriteTable(genre);
  const { w, h } = RIFT_SCENE;
  const img = fillGround(makeImage(w, h), table, spec.seed || 3);
  const feetY = h - 7;
  // A little of the bled land behind: a bush and a rock in the genre's colours.
  const backdrop = (name, cx, baseY) => {
    const rows = SPRITES[name]?.[0];
    if (!rows) return;
    const box = inkBounds(rows);
    stampRows(img, rows, cx - box.x - Math.floor(box.w / 2), baseY - (box.y + box.h) + 1, table);
  };
  const flip = (spec.seed || 0) & 1;
  backdrop('bush', flip ? w - 12 : 12, 20);
  backdrop('rock', flip ? 14 : w - 14, 17);
  const stage = rift?.warded?.stage || rift?.stage || spec.stage || 'open';
  const strays = [];
  if (stage !== 'hairline') {
    const seen = new Set();
    for (const kind of Array.isArray(spec.strays) ? spec.strays : []) {
      if (!kind?.sprite?.rows || seen.has(kind.name)) continue;
      seen.add(kind.name);
      strays.push(kind);
      if (strays.length === 2) break;
    }
  }
  const standAt = (pixels, cx, flip) => {
    const box = pixelBounds(pixels);
    shadow(img, cx, feetY, Math.max(8, Math.min(16, box.w)), 3);
    stampPixels(img, pixels, cx - Math.floor(pixels.width / 2), feetY - (box.y + box.h) + 1, { flip });
  };
  strays.forEach((kind, n) => {
    const pixels = strayPixels(kind.sprite, genre || kind.genre, kind.second || null, { genres });
    standAt(pixels, Math.round(w / 2) + (n === 0 ? -34 : 34), n === 1);
  });
  if (stage === 'gaping' && spec.taleLead) {
    const lead = leadSprite(spec, { words });
    if (lead?.sprite?.rows) standAt(strayPixels(lead.sprite, index.get(spec.taleLead.genre) || genre, null, { genres }), Math.round(w / 2) + 17, true);
  }
  const art = tearArt(stage, genre, frame, { warded: Boolean(rift?.warded), genres });
  stampRows(img, art.rows, Math.round(w / 2) - art.anchor.x, feetY - art.anchor.y, art.colours);
  return img;
}

/** The shimmer frame for a panel's tear at time t (0 with motion off). */
export const riftFrame = (t, rift) => tearFrameAt(t, (rift?.spec?.seed || 0) % 997);

/** Open water over rows [top, bottom): the world's water, deeper patches and a few foam glints. */
export function fillWater(img, table = BASE, seed = 7, top = 0, bottom = img.height) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const roll = hashInts(seed, x >> 2, y >> 1) % 100;
      put(img, x, y, table[roll < 14 ? 'W' : 'w'] || BASE.w);
    }
  }
  const foam = table.f || BASE.f;
  for (let n = 0; n < Math.floor((img.width * (bottom - top)) / 260); n += 1) {
    const x = hashInts(seed, n, 3) % Math.max(1, img.width - 2);
    const y = top + 1 + (hashInts(seed, n, 4) % Math.max(1, bottom - top - 2));
    put(img, x, y, foam);
    put(img, x + 1, y, foam);
  }
  return img;
}

// The shore under a place on the water, over rows [top, bottom): a fishing spot's grassy bank
// (lapping foam, a line of sand, then grass), or a quay's dock of planks with its mooring posts.
function shoreStrip(img, kind, table, seed, top, bottom) {
  const key = (k) => table[k] || BASE[k];
  if (kind === 'dock') {
    for (let x = 0; x < img.width; x += 1) put(img, x, top, key('o'));
    for (let y = top + 1; y < bottom; y += 1) {
      const board = (y - top - 1) % 3 === 2;
      const shift = Math.floor((y - top - 1) / 3) % 2 ? 7 : 0;
      for (let x = 0; x < img.width; x += 1) {
        const end = (x + shift) % 14 === 0;
        put(img, x, y, key(board || end ? 'B' : (hashInts(seed, x, y) % 9 === 0 ? 'n' : 'b')));
      }
    }
    for (const px of [8, img.width - 10]) {
      for (let y = top - 3; y < top + 2; y += 1) { put(img, px, y, key('o')); put(img, px + 1, y, key('m')); put(img, px + 2, y, key('o')); }
      put(img, px + 1, top - 4, key('o'));
    }
    return img;
  }
  for (let x = 0; x < img.width; x += 1) {
    put(img, x, top, key(hashInts(seed, x >> 1, 9) % 3 ? 'f' : 'w'));
    put(img, x, top + 1, key(hashInts(seed, x, 10) % 5 ? 'p' : 'P'));
    put(img, x, top + 2, key(hashInts(seed, x, 11) % 4 ? 'p' : 'P'));
  }
  fillGround(img, table, seed, top + 3, bottom);
  return img;
}

/**
 * One sprite in the middle of a small scene. On land (`water` null) it stands on `ground`'s grass
 * with its shadow; on the water (`water`: 'bank' or 'dock') it floats mid-water above that shore.
 * `table` colours the sprite, `ground` the land and water (a genre's in a bleed, sage in the Hush).
 * `name` is a SPRITES name; `frame` picks the frame (lantern.post: 0 sleeping, 1 lit).
 */
export function spriteScene(name, { frame = 0, w = 56, h = 34, seed = 11, table = BASE, ground = table, water = null } = {}) {
  const frames = SPRITES[name];
  if (!frames) return null;
  const rows = frames[Math.min(frames.length - 1, Math.max(0, frame))];
  const box = inkBounds(rows);
  const width = Math.max(w, box.w + 28);
  const x = Math.round(width / 2) - box.x - Math.floor(box.w / 2);
  if (water) {
    const shore = water === 'dock' ? 9 : 8;
    const height = Math.max(h, box.h + shore + 14);
    const img = fillWater(makeImage(width, height), ground, seed, 0, height - shore);
    shoreStrip(img, water, ground, seed, height - shore, height);
    const middle = Math.round((height - shore) / 2);
    stampRows(img, rows, x, middle - box.y - Math.floor(box.h / 2), table);
    return img;
  }
  const height = Math.max(h, box.h + 12);
  const img = fillGround(makeImage(width, height), ground, seed);
  const feetY = height - 5;
  shadow(img, Math.round(width / 2), feetY, Math.min(box.w, 30), 3);
  stampRows(img, rows, x, feetY - (box.y + box.h) + 1, table);
  return img;
}

/** Which sprite shows a point of interest in its panel. */
export const POI_SPRITES = Object.freeze({
  lantern: 'lantern.post', ruin: 'ruin', cave: 'cave', chest: 'chest', note: 'note', hamlet: 'hamlet',
  statue: 'statue', landmark: 'landmark.stone', ore: 'ore.node', herbs: 'herbs', fishing: 'fishing.spot', quay: 'boat',
});

// The places that sit on the water, and the shore drawn under them.
const ON_WATER = Object.freeze({ fishing: 'bank', quay: 'dock' });

// The Hush's colours (the world's own, faded to sage), made once when first asked for.
let hushColours = null;
export const hushTable = () => (hushColours ||= tableFromPalette(hushPalette()));

/**
 * A point of interest's picture: its sprite (a mimic's chest when it is one; open once opened) on
 * the ground it stands on, as the world draws it there. `genre`: the genre of a rift's bleed over
 * the spot (an id, looked up in `genres`, the content's genres), which colours ground and sprite
 * alike. `hush`: the world's Hush at the spot (0 to 255); from half on it's sage ground and a sage
 * sprite, except a lit lantern, which keeps its warm colours as it does in the world. A fishing
 * spot and the quay sit on water, with a bank or a dock below. `w`: the scene's width in pixels
 * (at least 56), so the shell can fill its frame with the same ground.
 */
export function poiScene(poi, { opened = false, lit = false, hush = 0, genre = null, genres = null, w = 56 } = {}) {
  const type = poi?.type;
  let name = POI_SPRITES[type];
  if (!name) return null;
  let frame = 0;
  if (type === 'chest') {
    if (poi.mimic && opened) name = 'chest.mimic';
    frame = opened ? 1 : 0;
  }
  if (type === 'lantern') frame = lit ? 1 : 0;
  const bled = genre ? genreIndex(genres).get(genre) || null : null;
  const hushed = !bled && Number(hush) >= 128;
  const ground = bled ? spriteTable(bled) : hushed ? hushTable() : BASE;
  const table = bled || (hushed && !(type === 'lantern' && lit)) ? ground : BASE;
  return spriteScene(name, { frame, w: Math.max(56, Math.min(400, Math.round(Number(w) || 56))), seed: (poi.x * 31 + poi.y * 17) >>> 0, table, ground, water: ON_WATER[type] || null });
}

/**
 * The genre of the rift bleed over a tile, as the world colours what stands there, or null.
 * `rifts`: the rifts standing near it (real ones first, then the wild ones, as the world lists them).
 */
export function bleedGenreAt(rifts, x, y, { genres = null } = {}) {
  if (!Array.isArray(rifts) || !rifts.length || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  // As the world dresses something standing on a tile: by the bleed's strength over the whole tile.
  const genre = tileDressAt(rifts, x, y, { genres });
  if (!genre) return null;
  return typeof genre === 'string' ? genre : genre.id || null;
}

/**
 * The Hearth's look: the camp's lantern, fire and tent at tier 1; from tier 2 a stretch of the
 * Stockade's palisade with its gatehouse, gate bell and a banner.
 */
export function hearthScene(tier = 1) {
  const w = 156;
  const h = tier >= 2 ? 88 : 70;
  const img = fillGround(makeImage(w, h), BASE, 5 + tier);
  // Stands a sprite with its feet (the bottom of its ink) at (cx, feetY).
  const place = (name, cx, feetY, frame = 0, shade = 0) => {
    const frames = SPRITES[name];
    if (!frames) return;
    const rows = frames[Math.min(frames.length - 1, frame)];
    const box = inkBounds(rows);
    if (shade) shadow(img, cx, feetY, shade, 3);
    stampRows(img, rows, cx - box.x - Math.floor(box.w / 2), feetY - (box.y + box.h) + 1);
  };
  // The camp stands at every tier: the Hearth grows round it.
  const camp = (dy) => {
    place('cabin', 34, 44 + dy, 0, 40);
    place('tent', 124, 40 + dy, 0, 28);
    place('flag', 147, 38 + dy, 0);
    place('log.bench', 80, 52 + dy);
    place('stump', 62, 62 + dy);
    place('stump', 98, 62 + dy);
    place('campfire', 80, 63 + dy, 1);
    place('lantern', 110, 50 + dy);
    place('woodpile', 8, 58 + dy);
  };
  if (tier >= 2) {
    // A stretch of the Stockade across the back, its gatehouse and bell, and the camp inside.
    const cell = paliCell();
    const wallFeet = 47;
    for (let x = -6; x < w; x += 16) {
      if (Math.abs(x + 8 - w / 2) < 22) continue;
      stampRows(img, cell, x, wallFeet - cell.length + 1);
    }
    place('gatehouse', Math.round(w / 2), wallFeet + 2, 0, 28);
    place('gate.bell', Math.round(w / 2) + 30, wallFeet + 6);
    place('banner', 16, wallFeet + 6, 0);
    place('banner', w - 16, wallFeet + 6, 1);
    place('tent', 124, 80, 0, 26);
    place('log.bench', 56, 72);
    place('stump', 38, 82);
    place('stump', 74, 82);
    place('campfire', 56, 84, 1);
    place('lantern', 96, 76);
  } else {
    camp(0);
  }
  return img;
}

// A straight run of palisade: the post with both side halves, as the engine composes it.
let PALI = null;
function paliCell() {
  if (PALI) return PALI;
  const blank = Array.from({ length: 36 }, () => '.'.repeat(16));
  const layers = ['palisade.w', 'palisade.e', 'palisade.post'].map((name) => SPRITES[name]?.[0]).filter(Boolean);
  PALI = blank.map((row, y) => {
    const out = [...row];
    for (const rows of layers) {
      const line = rows[y];
      if (!line) continue;
      for (let x = 0; x < 16; x += 1) if (line[x] && line[x] !== '.') out[x] = line[x];
    }
    return out.join('');
  });
  return PALI;
}

// ---------------------------------------------------------------------------
// The War Table's frontier map: rings and rift marks over the land.

const hex = (value, fallback) => {
  const text = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)).concat(255);
};
const INK = hex('#3d4038');
const CREAM = hex('#fff6e2');
const TEAR_MARK = ['...o...', '..oao..', '.oabao.', '.oabao.', 'oabbbao', '.oabao.', '.oabao.', '..oao..', '...o...'];
const STAR_MARK = ['...o...', '..oao..', 'oaaaaao', '.oaaao.', '.oa.ao.', 'oo...oo'];

/**
 * Draws the Hearthward's ring (dotted cream), the next tier's ring (faint) and every placed rift
 * (a small tear in its genre's colours; a star for a bright one; a cream stitch across a warded one)
 * onto a frontier map painted at `s` px per tile from tile (x0, y0). Held rifts are never drawn.
 * `genres` is frontier.genreTable(); `heartDistance(x, y)` is worldgen's.
 */
export function frontierOverlay(img, { x0, y0, s, ward = 0, nextWard = null, rifts = [], genres = new Map(), heartDistance }) {
  const tilesW = Math.floor(img.width / s);
  const tilesH = Math.floor(img.height / s);
  if (typeof heartDistance === 'function') {
    for (let j = 0; j < tilesH; j += 1) {
      for (let i = 0; i < tilesW; i += 1) {
        const tx = x0 + i;
        const ty = y0 + j;
        const d = heartDistance(tx, ty);
        const cx = i * s + Math.floor(s / 2);
        const cy = j * s + Math.floor(s / 2);
        if (ward > 0 && Math.abs(d - ward) < 0.5 && (tx + ty) % 2 === 0) {
          put(img, cx, cy, CREAM);
          if (s >= 3) put(img, cx + 1, cy, CREAM);
        } else if (nextWard && Math.abs(d - nextWard) < 0.5 && (tx + ty) % 4 === 0) {
          put(img, cx, cy, [255, 246, 226, 150]);
        }
      }
    }
  }
  for (const rift of rifts) {
    if (!rift || rift.held || !Number.isFinite(rift.x) || !Number.isFinite(rift.y)) continue;
    const genre = genres.get(rift.spec?.genres?.[0]) || {};
    const colours = { o: INK, a: hex(genre.rim, '#9cbfdc'), b: hex(genre.inner, '#3d4038') };
    const mark = rift.bright ? STAR_MARK : TEAR_MARK;
    const cx = (rift.x - x0) * s + Math.floor(s / 2);
    const cy = (rift.y - y0) * s + Math.floor(s / 2);
    const left = cx - Math.floor(mark[0].length / 2);
    const top = cy - mark.length + 2;
    stampRows(img, mark, left, top, colours);
    if (rift.warded) for (let i = 1; i < 6; i += 1) put(img, left + i, top + 4, CREAM);
  }
  return img;
}

/** An RGBA buffer at a whole scale that fits `room` (CSS px × dpr), at least 1 and at most `most`. */
export function fitScale(img, room, most = 4) {
  if (!img) return 1;
  return Math.max(1, Math.min(most, Math.floor(Math.min(room.w / img.width, room.h / img.height))));
}

// ---------------------------------------------------------------------------
// Portraits (CONTRACT-PHASE4.md §12.4, K2): the company's faces for the combat HUD, the muster,
// the character sheet and the dialogue box, from the same frames the fight draws.

const SCALE_MOST = 8;

/**
 * Palette-key rows as an RGBA picture at a whole `scale` (1 to 8). `layers` rows mark with '1' the
 * pixels drawn from `table2` (a person's clothes in a genre, a fusion stray's second genre); the
 * rest use `table`. `mirror` flips it left to right. '.' is clear.
 */
export function rowsScene(rows, { layers = null, table = BASE, table2 = null, scale = 1, mirror = false } = {}) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'string' || !rows[0].length) return null;
  const s = Math.max(1, Math.min(SCALE_MOST, Math.floor(Number(scale) || 1)));
  const w = rows[0].length;
  const h = rows.length;
  const img = makeImage(w * s, h * s);
  for (let y = 0; y < h; y += 1) {
    const row = rows[y];
    for (let x = 0; x < w; x += 1) {
      const key = row[x];
      if (!key || key === '.') continue;
      const second = table2 && layers?.[y]?.[x] === '1';
      const rgba = (second ? table2[key] : null) || table[key] || BASE[key];
      if (!rgba) continue;
      const px = mirror ? w - 1 - x : x;
      for (let j = 0; j < s; j += 1) for (let i = 0; i < s; i += 1) put(img, px * s + i, y * s + j, rgba);
    }
  }
  return img;
}

// Trims clear margins from rows (and their layers alike), leaving `pad` clear pixels round the ink.
function trimmed(rows, layers, pad = 1) {
  const box = inkBounds(rows);
  const cut = (list) => {
    if (!list) return null;
    const blank = '.'.repeat(box.w + 2 * pad);
    const inner = list.slice(box.y, box.y + box.h).map((row) => `${'.'.repeat(pad)}${row.slice(box.x, box.x + box.w)}${'.'.repeat(pad)}`);
    return [...Array(pad).fill(blank), ...inner, ...Array(pad).fill(blank)];
  };
  return { rows: cut(rows), layers: layers ? cut(layers).map((row) => row.replace(/[^1]/g, '0')) : null };
}

/**
 * A combatant's or companion's portrait: the figure a Look draws, standing, trimmed to its ink with
 * a clear pixel round it, at 1× (the shell scales it with fitScale). A rig ('coat', 'robe', 'jev',
 * 'toll') stands in its front 'ready' frame, dressed in `genre`'s colours when one is given (Milo,
 * the Scribe and the Artificer; a likeness is already its own clay or slate); a stray is its rest
 * pose in its genres' colours; a device its PROPS4 frame; a sprite look its SPRITES frame. `genre`
 * and the stray's genres are ids looked up in `genres` (the content's genres), or entries. null for
 * a look it can't draw.
 */
export function portraitScene(look, { genre = null, genres = null } = {}) {
  if (!look || typeof look !== 'object') return null;
  if (look.kind === 'rig') {
    const frame = clipFrames(look, 'ready', 'down')[0];
    if (!frame?.rows?.length) return null;
    const g = genre ? genreIndex(genres).get(genre) || (typeof genre === 'object' ? genre : null) : null;
    const dressed = g && frame.family ? outfitGrid(frame.family, frame.rows, { split: frame.split, wear: frame.wear }) : null;
    const cut = trimmed(dressed ? dressed.rows : frame.rows, dressed ? dressed.layers : null);
    return rowsScene(cut.rows, { layers: cut.layers, table2: dressed ? spriteTable(g) : null, mirror: frame.mirror === true });
  }
  if (look.kind === 'stray') {
    if (typeof look.archetype !== 'string') return null;
    let sprite;
    try {
      sprite = composeStray({ archetype: look.archetype, bodyKey: look.bodyKey || 'r', parts: Array.isArray(look.parts) ? look.parts : [], eyeKey: look.eyeKey || null });
    } catch {
      return null;
    }
    if (!sprite?.rows?.length) return null;
    const [first, second] = Array.isArray(look.genres) ? look.genres : [];
    const cut = trimmed(sprite.rows, sprite.layers);
    const pixels = strayPixels({ rows: cut.rows, layers: cut.layers }, first || genre, second || null, { genres });
    return { width: pixels.width, height: pixels.height, data: new Uint8ClampedArray(pixels.data) };
  }
  if (look.kind === 'device') {
    const rows = typeof look.template === 'string' ? propFrame(`device.${look.template}`) : null;
    return rows?.length ? rowsScene(trimmed(rows, null).rows) : null;
  }
  if (look.kind === 'sprite') {
    const rows = typeof look.name === 'string' && Object.hasOwn(SPRITES, look.name) ? SPRITES[look.name]?.[0] : null;
    return rows?.length ? rowsScene(trimmed(rows, null).rows) : null;
  }
  return null;
}
