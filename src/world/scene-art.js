// Art helpers for the world beyond the vale (CONTRACT-PHASE3.md §7.4 and §13): the Stockade's
// composed palisade cells, shadow sizes for the wilds' sprites, the Hush's dither on objects, a
// canvas painter that colours any grid in the Hush's or a genre's colours (cached per grid), and a
// tiny pixel font for the words that drift up from a felled tree.
//
// Pure parts (grids, tables, the font, the dither) run in Node for the tests; the painter needs a
// makeCanvas(w, h) and touches no DOM of its own.
import { SPRITES, PALETTE, stamp, rowsToImageData } from './sprites.js';

// ---------- the Stockade's palisade (a 16×36 cell, stamped n, w, e, post, s at (0, 0)) ----------

export const PALISADE_CELL = Object.freeze({ w: 16, h: 36 });

/** The composed palisade grid's name for an autotile mask ({ n, s, e, w }). */
export const palisadeName = (mask = {}) => `palisade:${mask.n ? 1 : 0}${mask.s ? 1 : 0}${mask.e ? 1 : 0}${mask.w ? 1 : 0}`;

export const PALISADE_GRIDS = (() => {
  const out = {};
  for (let bits = 0; bits < 16; bits += 1) {
    const mask = { n: !!(bits & 8), s: !!(bits & 4), e: !!(bits & 2), w: !!(bits & 1) };
    let rows = Array.from({ length: PALISADE_CELL.h }, () => '.'.repeat(PALISADE_CELL.w));
    if (mask.n) rows = stamp(rows, SPRITES['palisade.n'][0], 0, 0);
    if (mask.w) rows = stamp(rows, SPRITES['palisade.w'][0], 0, 0);
    if (mask.e) rows = stamp(rows, SPRITES['palisade.e'][0], 0, 0);
    rows = stamp(rows, SPRITES['palisade.post'][0], 0, 0);
    if (mask.s) rows = stamp(rows, SPRITES['palisade.s'][0], 0, 0);
    out[palisadeName(mask)] = Object.freeze(rows);
  }
  return Object.freeze(out);
})();

// ---------- shadows for the wilds' sprites ([w, h, dy], as engine.js SHADOWS) ----------

export const WILD_SHADOWS = Object.freeze({
  'tree.birch': [18, 5, -1], 'pine.snow': [14, 5, -1],
  crag: [30, 5, -1], 'crag.snow': [30, 5, -1], ruin: [30, 5, -1], cave: [30, 5, -1],
  'basalt.column': [14, 4, -1], 'rock.basalt': [14, 4, -1], 'dice.stone': [14, 4, -1],
  chest: [14, 4, -1], 'chest.mimic': [14, 4, -1], 'ore.node': [14, 4, -1], 'landmark.stone': [12, 4, -1],
  hamlet: [38, 6, -1], cottage: [28, 6, -1], 'cottage.slate': [28, 6, -1], 'cottage.clay': [28, 6, -1], 'cottage.new': [28, 6, -1], 'cottage.moss': [28, 6, -1],
  well: [14, 4, -1], stall: [28, 5, -1], statue: [18, 4, -1], 'lantern.post': [8, 3, -1], herbs: [10, 3, -1],
  thicket: [18, 5, 0], palisade: [16, 4, 0], 'palisade.jamb': [14, 3, -1], gatehouse: [30, 4, 0],
  'war.table': [30, 4, 0], 'gate.bell': [14, 3, 0], 'exit.door': [16, 3, -1], curio: [10, 3, -1],
  banner: [6, 2, 0],
});

// ---------- the Hush on objects ----------

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/**
 * Whether an object (o.hush 0..255 from the wilds, at its tile) is drawn in the Hush's colours: all
 * of it deep in a region, and by the same ordered dither over the tiles of the fade at its edge.
 */
export function isHushed(o) {
  const s = (Number(o && o.hush) || 0) / 255;
  if (s <= 0) return false;
  if (s >= 0.999) return true;
  return (BAYER[o.y & 3][o.x & 3] + 0.5) / 16 < s;
}

// ---------- colour tables ----------

const hexRgba = (hex) => (hex.startsWith('rgba')
  ? hex.slice(5, -1).split(',').map((v, i) => (i === 3 ? Math.round(Number(v) * 255) : Number(v)))
  : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255));
export const BASE_RGBA = Object.freeze(Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, Object.freeze(hexRgba(v.hex))])));

/** An RGBA sprite table from a { key: [r, g, b] } palette (the translucent shadow keeps its alpha). */
export function tableFromPalette(palette) {
  const out = {};
  for (const [key, rgba] of Object.entries(BASE_RGBA)) {
    const rgb = palette && palette[key];
    out[key] = rgb && key !== 'x' ? [rgb[0], rgb[1], rgb[2], 255] : rgba;
  }
  return Object.freeze(out);
}

/** Where a sprite's lamp burns (the middle of its butter and honey pixels), or null. */
export function lampPoint(rows) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === 'u' || row[x] === 'U') { sx += x; sy += y; n += 1; }
    }
  });
  return n ? { x: sx / n, y: sy / n } : null;
}

// ---------- the painter ----------

/**
 * createPainter(makeCanvas) → canvases for grids of palette keys in any colour table, cached per
 * grid (so a sprite's frames, a composed palisade cell or a stray's body is painted once per
 * table), plus art ({ rows, colours }) canvases and dissolve steps.
 *   grid(rows, table?, key?, { mirror, layers, table2 })  table null = the world's own colours;
 *        layers ('0'/'1' per pixel) colour layer 1 from table2 (a stray's second genre)
 *   art(art, key?)       tearArt / sealArt / letGoFrame results ({ rows, colours })
 *   dissolve(rows, step, steps, { invert, table, key })  a hashed share of the pixels (a calm reveal)
 *   glow(rgb, rx, ry, alpha)  a soft stepped pool of light (echo halos, the Tale-lead's own light)
 */
export function createPainter(makeCanvas) {
  const byRows = new WeakMap();
  const artCache = new WeakMap();
  let made = 0;

  function paint(w, h, pick, tag) {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const data = image.data;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const rgba = pick(x, y);
        if (!rgba) continue;
        const i = (y * w + x) * 4;
        data[i] = rgba[0];
        data[i + 1] = rgba[1];
        data[i + 2] = rgba[2];
        data[i + 3] = rgba.length > 3 ? rgba[3] : 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    if (tag) canvas._milo = tag;
    made += 1;
    return canvas;
  }

  function grid(rows, table = null, key = 'base', { mirror = false, layers = null, table2 = null, tag = null } = {}) {
    let entry = byRows.get(rows);
    if (!entry) {
      entry = new Map();
      byRows.set(rows, entry);
    }
    const k = `${key}${mirror ? ':m' : ''}`;
    let canvas = entry.get(k);
    if (canvas) return canvas;
    const w = rows[0].length;
    const h = rows.length;
    if (!mirror && !layers) {
      // A plain grid in one table: sprites.js's own painter (as buildAtlas uses it).
      canvas = makeCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.putImageData(rowsToImageData(rows, (iw, ih) => ctx.createImageData(iw, ih), table || undefined), 0, 0);
      if (tag) canvas._milo = tag;
      made += 1;
      entry.set(k, canvas);
      return canvas;
    }
    const colourOf = (t, ch) => (t && t[ch]) || BASE_RGBA[ch] || null;
    canvas = paint(w, h, (x, y) => {
      const sx = mirror ? w - 1 - x : x;
      const ch = rows[y][sx];
      if (ch === '.' || ch === undefined) return null;
      const t = layers && table2 && layers[y] && layers[y][sx] === '1' ? table2 : table;
      return colourOf(t, ch);
    }, tag);
    entry.set(k, canvas);
    return canvas;
  }

  /** A canvas for { rows, colours } art (keys not in colours stay clear). Cached per art object. */
  function art(value, tag = null) {
    if (!value) return null;
    let canvas = artCache.get(value);
    if (canvas) return canvas;
    const { rows, colours } = value;
    canvas = paint(rows[0].length, rows.length, (x, y) => colours[rows[y][x]] || null, tag);
    artCache.set(value, canvas);
    return canvas;
  }

  /**
   * Step `step` of `steps` of a dissolve: pixels a hash keeps (fewer as the step grows; invert grows
   * them). With `layers` and `table2`, layer-1 pixels take the second table, as grid() does, so a
   * fusion stray settles in both its genres.
   */
  function dissolve(rows, step, steps, { invert = false, table = null, key = 'base', tag = null, layers = null, table2 = null } = {}) {
    let entry = byRows.get(rows);
    if (!entry) {
      entry = new Map();
      byRows.set(rows, entry);
    }
    const k = `dissolve:${key}:${step}/${steps}:${invert ? 1 : 0}`;
    let canvas = entry.get(k);
    if (canvas) return canvas;
    const cut = step / steps;
    canvas = paint(rows[0].length, rows.length, (x, y) => {
      const ch = rows[y][x];
      if (ch === '.') return null;
      const h = dissolveHash(x, y);
      const keep = invert ? h < cut : h >= cut;
      if (!keep) return null;
      const t = layers && table2 && layers[y] && layers[y][x] === '1' ? table2 : table;
      return (t && t[ch]) || BASE_RGBA[ch] || null;
    }, tag);
    entry.set(k, canvas);
    return canvas;
  }

  /**
   * A soft pool of light: a stepped ellipse (rx × ry px from its middle) in one colour, brightest in
   * the middle, `alpha` at most. Cached per colour and shape.
   */
  const glows = new Map();
  function glow(rgb, rx, ry = rx, alpha = 0.5) {
    const k = `${rgb[0]},${rgb[1]},${rgb[2]}|${rx}|${ry}|${alpha}`;
    let canvas = glows.get(k);
    if (canvas) return canvas;
    canvas = paint(rx * 2, ry * 2, (x, y) => {
      const d = Math.hypot((x + 0.5 - rx) / rx, (y + 0.5 - ry) / ry);
      if (d > 1) return null;
      const step = d < 0.5 ? 1 : d < 0.78 ? 0.62 : 0.3;
      return [rgb[0], rgb[1], rgb[2], Math.round(255 * alpha * step)];
    }, 'glow');
    glows.set(k, canvas);
    if (glows.size > 64) glows.delete(glows.keys().next().value);
    return canvas;
  }

  return { grid, art, dissolve, glow, get made() { return made; } };
}

function dissolveHash(x, y) {
  let h = Math.imul(x + 11, 374761393) ^ Math.imul(y + 7, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- a tiny pixel font (5 px tall capitals, for '+5 birch' and the like) ----------

const GLYPHS = {
  a: ['.#.', '#.#', '###', '#.#', '#.#'], b: ['##.', '#.#', '##.', '#.#', '##.'], c: ['.##', '#..', '#..', '#..', '.##'],
  d: ['##.', '#.#', '#.#', '#.#', '##.'], e: ['###', '#..', '##.', '#..', '###'], f: ['###', '#..', '##.', '#..', '#..'],
  g: ['.##', '#..', '#.#', '#.#', '.##'], h: ['#.#', '#.#', '###', '#.#', '#.#'], i: ['###', '.#.', '.#.', '.#.', '###'],
  j: ['..#', '..#', '..#', '#.#', '.#.'], k: ['#.#', '#.#', '##.', '#.#', '#.#'], l: ['#..', '#..', '#..', '#..', '###'],
  m: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], n: ['#..#', '##.#', '#.##', '#..#', '#..#'], o: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  p: ['##.', '#.#', '##.', '#..', '#..'], q: ['.##.', '#..#', '#..#', '#.#.', '.#.#'], r: ['##.', '#.#', '##.', '#.#', '#.#'],
  s: ['.##', '#..', '.#.', '..#', '##.'], t: ['###', '.#.', '.#.', '.#.', '.#.'], u: ['#.#', '#.#', '#.#', '#.#', '###'],
  v: ['#.#', '#.#', '#.#', '#.#', '.#.'], w: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], x: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  y: ['#.#', '#.#', '.#.', '.#.', '.#.'], z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#', '##', '.#', '.#', '.#'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '##.', '#.#', '.#.'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['.#.', '#.#', '.#.', '#.#', '.#.'],
  9: ['.#.', '#.#', '.##', '..#', '##.'],
  '+': ['...', '.#.', '###', '.#.', '...'], '-': ['...', '...', '###', '...', '...'], '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '#', '#'], "'": ['#', '#', '.', '.', '.'], '’': ['#', '#', '.', '.', '.'], '·': ['.', '.', '#', '.', '.'],
  ':': ['.', '#', '.', '#', '.'], '/': ['..#', '..#', '.#.', '#..', '#..'], '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'], '?': ['##.', '..#', '.#.', '...', '.#.'], '×': ['...', '#.#', '.#.', '#.#', '...'],
  ' ': ['..', '..', '..', '..', '..'],
};
export const FONT_GLYPHS = Object.freeze(Object.keys(GLYPHS));

const TEXT_CACHE = new Map();
/**
 * A word in the pixel font: capitals 5 px tall with a 1 px gap, filled with `fill` (a palette key)
 * and outlined in ink, as rows of palette keys ('.' clear). Unknown characters become spaces.
 */
export function textRows(text, { fill = 'c', outline = 'o' } = {}) {
  const key = `${fill}${outline}|${text}`;
  const known = TEXT_CACHE.get(key);
  if (known) return known;
  const glyphs = [...String(text || '').toLowerCase()].map((ch) => GLYPHS[ch] || GLYPHS[' ']);
  const inner = glyphs.reduce((w, g, i) => w + g[0].length + (i ? 1 : 0), 0);
  const W = Math.max(1, inner) + 2;
  const H = 7;
  const cells = Array.from({ length: H }, () => Array(W).fill('.'));
  let x0 = 1;
  glyphs.forEach((g) => {
    g.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) if (row[x] === '#') cells[y + 1][x0 + x] = fill;
    });
    x0 += g[0].length + 1;
  });
  // Ink round every lit pixel (8 ways), so the words read on grass, snow and water alike.
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (cells[y][x] !== '.') continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy += 1) for (let dx = -1; dx <= 1 && !near; dx += 1) if (cells[y + dy]?.[x + dx] === fill) near = true;
      if (near) cells[y][x] = outline;
    }
  }
  const rows = Object.freeze(cells.map((r) => r.join('')));
  if (TEXT_CACHE.size > 200) TEXT_CACHE.delete(TEXT_CACHE.keys().next().value);
  TEXT_CACHE.set(key, rows);
  return rows;
}

// ---------- fight numbers (CONTRACT-PHASE4.md §7.8, COMBAT.md §14.4) ----------

// The big set: 5 × 8 glyphs with two-pixel strokes. The small set is the font's own 3 × 5.
const BIG_GLYPHS = {
  0: ['.###.', '##.##', '##.##', '##.##', '##.##', '##.##', '##.##', '.###.'],
  1: ['..##.', '.###.', '..##.', '..##.', '..##.', '..##.', '..##.', '.####'],
  2: ['.###.', '##.##', '...##', '..##.', '.##..', '##...', '##...', '#####'],
  3: ['####.', '...##', '...##', '.###.', '...##', '...##', '...##', '####.'],
  4: ['##.##', '##.##', '##.##', '#####', '...##', '...##', '...##', '...##'],
  5: ['#####', '##...', '##...', '####.', '...##', '...##', '...##', '####.'],
  6: ['.###.', '##...', '##...', '####.', '##.##', '##.##', '##.##', '.###.'],
  7: ['#####', '...##', '...##', '..##.', '..##.', '.##..', '.##..', '.##..'],
  8: ['.###.', '##.##', '##.##', '.###.', '##.##', '##.##', '##.##', '.###.'],
  9: ['.###.', '##.##', '##.##', '##.##', '.####', '...##', '...##', '.###.'],
  '+': ['.....', '.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '?': ['.###.', '##.##', '...##', '..##.', '.##..', '.##..', '.....', '.##..'],
  m: ['.....', '.....', '####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  i: ['##', '..', '##', '##', '##', '##', '##', '##'],
  s: ['....', '....', '.###', '##..', '.##.', '..##', '..##', '###.'],
  ' ': ['..', '..', '..', '..', '..', '..', '..', '..'],
};
const STARS = {
  small: ['.#.', '###', '.#.', '...', '...'],
  big: ['..#..', '..#..', '##.##', '..#..', '..#..', '.....', '.....', '.....'],
};
export const NUMBER_SIZES = Object.freeze({ small: Object.freeze({ w: 4, h: 6 }), big: Object.freeze({ w: 6, h: 9 }) });

const NUMBER_CACHE = new Map(); // an LRU: key → frozen rows
const NUMBER_MAX = 200;
/**
 * A fight number as frozen rows of palette keys: '17', '+5', '14?' or 'miss', in the small set (3 × 5
 * glyphs, 4 × 6 with the gap and shadow) or the big one (5 × 8, 6 × 9). A hard ink shadow falls one
 * pixel right and down, so it reads on any floor. Fill `c` for damage, `l` for a patch, `u` with
 * `star` for a Critical (a cream sparkle after it) and `S` for "miss" (COMBAT.md §14.4). Cached.
 */
export function numberRows(text, { size = 'small', fill = 'c', star = false } = {}) {
  const big = size === 'big';
  const key = `${big ? 'b' : 's'}${fill}${star ? '*' : ''}|${text}`;
  const known = NUMBER_CACHE.get(key);
  if (known) {
    // Least recently used goes first: a hit moves the number to the back of the queue.
    NUMBER_CACHE.delete(key);
    NUMBER_CACHE.set(key, known);
    return known;
  }
  const set = big ? BIG_GLYPHS : GLYPHS;
  const H = big ? 8 : 5;
  const glyphs = [...String(text ?? '').toLowerCase()].map((ch) => ({ rows: set[ch] || set[' '], key: fill }));
  if (star) glyphs.push({ rows: STARS[big ? 'big' : 'small'], key: 'c' });
  if (!glyphs.length) glyphs.push({ rows: set[' '], key: fill });
  const inner = glyphs.reduce((w, g, i) => w + g.rows[0].length + (i ? 1 : 0), 0);
  const W = inner + 1;
  const cells = Array.from({ length: H + 1 }, () => Array(W).fill('.'));
  let x0 = 0;
  for (const g of glyphs) {
    g.rows.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) if (row[x] === '#') cells[y][x0 + x] = g.key; });
    x0 += g.rows[0].length + 1;
  }
  for (let y = H; y >= 0; y -= 1) {
    for (let x = W - 1; x >= 0; x -= 1) {
      if (cells[y][x] !== '.') continue;
      const lit = (dx, dy) => { const ch = cells[y - dy]?.[x - dx]; return ch !== undefined && ch !== '.' && ch !== 'o'; };
      if (lit(1, 0) || lit(0, 1) || lit(1, 1)) cells[y][x] = 'o';
    }
  }
  const rows = Object.freeze(cells.map((r) => r.join('')));
  if (NUMBER_CACHE.size >= NUMBER_MAX) NUMBER_CACHE.delete(NUMBER_CACHE.keys().next().value);
  NUMBER_CACHE.set(key, rows);
  return rows;
}
