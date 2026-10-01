// Fight effects (CONTRACT-PHASE4.md §7.8, COMBAT.md §14.4): procedural primitives that return frozen
// rows of palette keys, the per-spell effects built from them (content/combat/anims.json), heat
// shimmer, the surfaces' tiles, projectiles and impacts. Pure and cached; the engine paints the rows
// through painter.grid, in the room's genre table for effects and in the world's own for the UI.
//
//   ring, sparks, beam, fillRows, swirl      primitives: (params, frame) → rows
//   effectFrame(effectId, frame, { anims })  a spell's, flourish's or impact's frame, or null
//   shimmerOutline(rows, warm)               a 1 px outline for heat shimmer (U warm, e cool)
//   SURFACE_IDS, surfaceTile(id, frame, { edges })   16 × 16 tiles, three frames, dithered edges
//   PROJECTILES, projectileFrame(id, frame, dir)     one hand frame each, the trail derived
//   impactFrame(kind, frame, { anims })      a damage kind's impact (anims.json 'impact.<kind>')
//   flourishFrame(genre, frame, { anims })   a genre flourish: its two hand frames, then its effect

const freeze = Object.freeze;
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function hash3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((c | 0) + 1, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const grid2 = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
const done = (cells) => freeze(cells.map((row) => row.join('')));
const key1 = (k, fallback) => (typeof k === 'string' && k.length === 1 ? k : fallback);

// Every primitive's output is cached by its parameters and frame, so the painter (keyed by the rows'
// identity) paints each frame once.
const PRIM_CACHE = new Map();
function cached(name, params, frame, build) {
  const k = `${name}|${JSON.stringify(params)}|${frame}`;
  let rows = PRIM_CACHE.get(k);
  if (!rows) {
    rows = build();
    PRIM_CACHE.set(k, rows);
    if (PRIM_CACHE.size > 4096) PRIM_CACHE.delete(PRIM_CACHE.keys().next().value);
  }
  return rows;
}

// ---------- primitives ----------

/** A ring of radius r (px from its middle to its inner edge), `width` px thick; dither drops every other pixel, turning with the frame. */
export function ring({ r = 4, key = 'c', width = 1, dither = false } = {}, frame = 0) {
  return cached('ring', { r, key, width, dither }, frame, () => {
    const R = Math.max(0, Math.round(r));
    const W = Math.max(1, Math.round(width));
    const S = 2 * (R + W) + 1;
    const c = S >> 1;
    const cells = grid2(S, S);
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const d = Math.hypot(x - c, y - c);
        if (d < R - 0.5 || d >= R + W - 0.5) continue;
        if (dither && ((x + y + frame) & 1)) continue;
        cells[y][x] = key1(key, 'c');
      }
    }
    return done(cells);
  });
}

/**
 * n little four-point sparks thrown out from the middle to `spread` px, each at its own seeded angle
 * and distance; a spark's middle is cream, its arms `key`, and far out it's a single pixel.
 */
export function sparks({ n = 5, key = 'u', spread = 4, seed = 1, zig = false } = {}, frame = 0) {
  return cached('sparks', { n, key, spread, seed, zig }, frame, () => {
    const R = Math.max(0, Math.round(spread));
    const S = 2 * (R + 2) + 1;
    const c = S >> 1;
    const cells = grid2(S, S);
    const put = (x, y, k) => { if (x >= 0 && y >= 0 && x < S && y < S) cells[y][x] = k; };
    for (let i = 0; i < n; i += 1) {
      const a = hash3(seed, i, 7) * Math.PI * 2;
      const d = R * (0.55 + 0.45 * hash3(seed, i, 11));
      let x = Math.round(c + Math.cos(a) * d);
      const y = Math.round(c + Math.sin(a) * d);
      if (zig && (frame + i) & 1) x += 1;
      if (R >= 5 && hash3(seed, i, 13) < 0.5) { put(x, y, key1(key, 'u')); continue; }
      put(x, y, 'c');
      put(x - 1, y, key1(key, 'u'));
      put(x + 1, y, key1(key, 'u'));
      put(x, y - 1, key1(key, 'u'));
      put(x, y + 1, key1(key, 'u'));
    }
    return done(cells);
  });
}

const DIRS = freeze({ right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1], downright: [1, 1], upright: [1, -1], downleft: [-1, 1], upleft: [-1, -1] });

/** A beam `length` px long toward `dir`: a cream core with `key` either side, its edge shimmering with the frame. */
export function beam({ length = 8, dir = 'right', key = 'u' } = {}, frame = 0) {
  return cached('beam', { length, dir, key }, frame, () => {
    const [dx, dy] = DIRS[dir] || DIRS.right;
    const L = Math.max(1, Math.round(length));
    const w = dx ? L : 3;
    const h = dy ? L : 3;
    const S = dx && dy ? L + 2 : 0;
    const cells = S ? grid2(S, S) : grid2(w + (dx ? 0 : 0), h);
    const put = (x, y, k) => { if (y >= 0 && y < cells.length && x >= 0 && x < cells[0].length && cells[y][x] === '.') cells[y][x] = k; };
    for (let i = 0; i < L; i += 1) {
      const edge = (i + frame) % 3 === 0 ? 'c' : key1(key, 'u');
      if (dx && dy) {
        const x = dx > 0 ? i + 1 : L - i;
        const y = dy > 0 ? i + 1 : L - i;
        put(x, y, 'c');
        put(x + 1, y, edge);
        put(x, y + 1, edge);
      } else if (dx) {
        const x = dx > 0 ? i : L - 1 - i;
        put(x, 1, 'c');
        if (i < L - 1) { put(x, 0, edge); put(x, 2, edge); }
      } else {
        const y = dy > 0 ? i : L - 1 - i;
        put(1, y, 'c');
        if (i < L - 1) { put(0, y, edge); put(2, y, edge); }
      }
    }
    return done(cells);
  });
}

/** A w × h fill of `key`; dither (0–16) drops pixels under the 4 × 4 Bayer level; round makes it an ellipse. */
export function fillRows({ w = 4, h = 4, key = 'c', dither = 0, round = false } = {}) {
  return cached('fill', { w, h, key, dither, round }, 0, () => {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    const level = Math.max(0, Math.min(16, Math.round(dither)));
    const cells = grid2(W, H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (BAYER[y & 3][x & 3] < level) continue;
        if (round && Math.hypot((x + 0.5 - W / 2) / (W / 2), (y + 0.5 - H / 2) / (H / 2)) > 1) continue;
        cells[y][x] = key1(key, 'c');
      }
    }
    return done(cells);
  });
}

/** n dots on a turning spiral out to r px (the "noticed you" swirl, a Warp impact). */
export function swirl({ n = 6, key = 'c', r = 5, seed = 1 } = {}, frame = 0) {
  return cached('swirl', { n, key, r, seed }, frame, () => {
    const R = Math.max(1, Math.round(r));
    const S = 2 * R + 3;
    const c = S >> 1;
    const cells = grid2(S, S);
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      const a = t * Math.PI * 3 + frame * 0.9 + hash3(seed, 0, 3) * 6;
      const d = R * (0.35 + 0.65 * t);
      const x = Math.round(c + Math.cos(a) * d);
      const y = Math.round(c + Math.sin(a) * d);
      if (x >= 0 && y >= 0 && x < S && y < S) cells[y][x] = i === n - 1 ? 'c' : key1(key, 'c');
    }
    return done(cells);
  });
}

const PRIMITIVES = freeze({ ring, sparks, beam, fill: (p) => fillRows({ ...p, round: p.round ?? true }), swirl });

// ---------- effects from anims.json ----------

const lerp = (v, t) => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? v[0] + (v[1] - v[0]) * t : v);
const EFFECT_CACHE = new WeakMap(); // anims.effects → Map(id|frame → rows)

/**
 * Centre `art` in a size × size square. Anything past the square would be cut off, so anims.json
 * sizes every effect to fit its widest frame with a clear 1 px rim (tests/art4.test.js checks every
 * frame of every effect and flourish).
 */
function centred(art, size) {
  const cells = grid2(size, size);
  const ox = Math.floor((size - art[0].length) / 2);
  const oy = Math.floor((size - art.length) / 2);
  art.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) {
    const tx = x + ox;
    const ty = y + oy;
    if (row[x] !== '.' && tx >= 0 && ty >= 0 && tx < size && ty < size) cells[ty][tx] = row[x];
  } });
  return done(cells);
}

/**
 * Frame `frame` of an effect from anims.json (`effects[effectId]`: a primitive, its parameters and
 * its frames, drawn in a size × size square), or null for an effect it doesn't have. Numeric
 * parameters given as [from, to] run across the frames. Cached per anims object, effect and frame.
 */
export function effectFrame(effectId, frame, { anims } = {}) {
  const effects = anims && anims.effects;
  const spec = effects && effects[effectId];
  if (!spec || !PRIMITIVES[spec.primitive]) return null;
  let byId = EFFECT_CACHE.get(effects);
  if (!byId) {
    byId = new Map();
    EFFECT_CACHE.set(effects, byId);
  }
  const frames = Math.max(1, Number(spec.frames) || 1);
  const f = Math.max(0, Math.min(frames - 1, Math.floor(Number(frame) || 0)));
  const k = `${effectId}|${f}`;
  const known = byId.get(k);
  if (known) return known;
  const t = frames > 1 ? f / (frames - 1) : 0;
  const params = {};
  for (const [name, v] of Object.entries(spec.params || {})) params[name] = lerp(v, t);
  const art = PRIMITIVES[spec.primitive](params, f);
  const rows = centred(art, Math.max(4, Number(spec.size) || 16));
  byId.set(k, rows);
  return rows;
}

/** The spell's effect id (anims.spells), or the id itself when anims.effects has it. */
export function spellEffect(spellId, { anims } = {}) {
  const id = anims?.spells?.[spellId] || spellId;
  return anims?.effects?.[id] ? id : null;
}

/** A damage kind's impact frame (anims.json 'impact.<kind>'; COMBAT.md §14.4). */
export function impactFrame(kind, frame, { anims } = {}) {
  return effectFrame(`impact.${kind}`, frame, { anims });
}

/**
 * A genre flourish (COMBAT.md §14.3): its two hand frames from anims.json, then its effect's frames.
 * null past the end or for a genre without one.
 */
export function flourishFrame(genre, frame, { anims } = {}) {
  const fl = anims?.flourishes?.[genre];
  if (!fl) return null;
  const hand = Array.isArray(fl.frames) ? fl.frames : [];
  const f = Math.max(0, Math.floor(Number(frame) || 0));
  if (f < hand.length) return hand[f];
  return effectFrame(fl.effect, f - hand.length, { anims });
}

/** How many frames a flourish has in all. */
export function flourishLength(genre, { anims } = {}) {
  const fl = anims?.flourishes?.[genre];
  if (!fl) return 0;
  return (fl.frames?.length || 0) + (anims?.effects?.[fl.effect]?.frames || 0);
}

// ---------- heat shimmer ----------

const SHIMMER = new WeakMap(); // rows → { warm, cool }
/**
 * Heat shimmer (COMBAT.md §14.4): a 1 px outline round a sprite's drawn pixels, honey (U) when warm
 * and slate (e) when cool, for the engine to draw under the sprite at low alpha. Same size as `rows`;
 * cached per rows identity. Off with motion off (the caller's rule).
 */
export function shimmerOutline(rows, warm = true) {
  if (!Array.isArray(rows) || !rows.length) return freeze([]);
  let entry = SHIMMER.get(rows);
  if (!entry) {
    entry = {};
    SHIMMER.set(rows, entry);
  }
  const k = warm ? 'warm' : 'cool';
  if (entry[k]) return entry[k];
  const key = warm ? 'U' : 'e';
  const h = rows.length;
  const w = rows[0].length;
  const cells = grid2(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (rows[y][x] !== '.') continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const ch = rows[y + dy]?.[x + dx]; return ch && ch !== '.'; })) cells[y][x] = key;
    }
  }
  entry[k] = done(cells);
  return entry[k];
}

// ---------- surfaces (16 × 16 tiles, three frames each) ----------

/** The surface ids (CONTRACT-PHASE4.md §5.1), in order. */
export const SURFACE_IDS = freeze(['neon-puddle', 'candle-wax', 'candlefire', 'oil-slick', 'burning-oil', 'smog', 'gravity-well', 'dust-cloud',
  'streetlight-pool', 'moonbrew-spill', 'steam', 'water', 'foliage', 'burning-foliage', 'ice', 'rough-ground']);

// How each surface looks: a base key laid at a coverage, specks of other keys, a pattern, and whether
// it moves. Patterns: 'pool' (a solid pool), 'cloud' (dithered, drifting), 'ripple', 'blobs',
// 'leaves', 'cracks', 'spiral', 'light'. `flames` adds tongues of fire that flicker.
const SURFACE_LOOK = freeze({
  'neon-puddle': { pattern: 'pool', base: 'W', edge: 'N', specks: [['e', 0.1], ['k', 0.04], ['f', 0.03]], moves: true },
  'candle-wax': { pattern: 'blobs', base: 'C', edge: 'P', specks: [['c', 0.12]], moves: false },
  candlefire: { pattern: 'blobs', base: 'C', edge: 'P', specks: [['c', 0.08]], flames: true, moves: true },
  'oil-slick': { pattern: 'pool', base: 'N', edge: 'o', specks: [['v', 0.08], ['e', 0.06], ['V', 0.05]], moves: true },
  'burning-oil': { pattern: 'pool', base: 'N', edge: 'o', specks: [['V', 0.05]], flames: true, moves: true },
  smog: { pattern: 'cloud', base: 'S', edge: 'z', specks: [['s', 0.1]], density: 10, moves: true },
  'gravity-well': { pattern: 'spiral', base: 'V', edge: 'N', specks: [['v', 0.1], ['c', 0.02]], moves: true },
  'dust-cloud': { pattern: 'cloud', base: 'P', edge: 'B', specks: [['p', 0.12]], density: 8, moves: true },
  'streetlight-pool': { pattern: 'light', base: 'u', edge: 'U', specks: [['c', 0.06]], moves: false },
  'moonbrew-spill': { pattern: 'pool', base: 'v', edge: 'V', specks: [['c', 0.05], ['k', 0.03]], moves: true },
  steam: { pattern: 'cloud', base: 'c', edge: 'C', specks: [['f', 0.1]], density: 7, moves: true },
  water: { pattern: 'ripple', base: 'w', edge: 'W', specks: [['f', 0.08]], moves: true },
  foliage: { pattern: 'leaves', base: 'l', edge: 'L', specks: [['q', 0.14], ['M', 0.08]], moves: false },
  'burning-foliage': { pattern: 'leaves', base: 'L', edge: 'M', specks: [['B', 0.08]], flames: true, moves: true },
  ice: { pattern: 'cracks', base: 'f', edge: 'w', specks: [['c', 0.1]], moves: false },
  'rough-ground': { pattern: 'cracks', base: 'P', edge: 'B', specks: [['z', 0.06], ['p', 0.08]], moves: false },
});

function surfaceSeed(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const SURFACE_CACHE = new Map();

/**
 * A surface's 16 × 16 tile at frame 0–2. `edges` says which neighbours carry the same surface (bits:
 * 1 north, 2 east, 4 south, 8 west; 15 = all): toward a side without one, the surface thins out in
 * the bleeds' ordered dither, so a puddle's rim is soft. Frozen and cached; null for an unknown id.
 */
export function surfaceTile(id, frame = 0, { edges = 15 } = {}) {
  const look = SURFACE_LOOK[id];
  if (!look) return null;
  const f = ((Math.floor(Number(frame) || 0) % 3) + 3) % 3;
  const k = `${id}|${look.moves ? f : 0}|${edges & 15}`;
  const known = SURFACE_CACHE.get(k);
  if (known) return known;
  const seed = surfaceSeed(id);
  const T = 16;
  const cells = grid2(T, T);
  const t = look.moves ? f : 0;
  for (let y = 0; y < T; y += 1) {
    for (let x = 0; x < T; x += 1) {
      // Distance in from each open side, for the soft edge.
      let edgeIn = 99;
      if (!(edges & 1)) edgeIn = Math.min(edgeIn, y);
      if (!(edges & 2)) edgeIn = Math.min(edgeIn, T - 1 - x);
      if (!(edges & 4)) edgeIn = Math.min(edgeIn, T - 1 - y);
      if (!(edges & 8)) edgeIn = Math.min(edgeIn, x);
      const thin = edgeIn < 4 ? (4 - edgeIn) * 4 : 0; // 16, 12, 8, 4 at 0–3 px in
      if (BAYER[y & 3][x & 3] < thin) continue;
      let ch = look.base;
      const n = hash3(seed, x + y * 17, 3);
      switch (look.pattern) {
        case 'cloud': {
          const wave = Math.sin((x + t * 2) * 0.7) + Math.cos((y - t) * 0.6);
          if (BAYER[(y + t) & 3][(x + t * 2) & 3] < (look.density || 8) - wave * 2) ch = null;
          break;
        }
        case 'ripple':
          if ((y + Math.round(Math.sin((x + t * 3) * 0.6))) % 5 === 0) ch = 'f';
          break;
        case 'blobs':
          if (n < 0.08) ch = look.edge;
          break;
        case 'leaves':
          if (((x * 3 + y * 5) % 7) === 0) ch = 'q';
          else if (n < 0.1) ch = 'M';
          break;
        case 'cracks':
          if ((x + 2 * y) % 11 === 0 || (3 * x - y + 40) % 13 === 0) ch = look.edge;
          break;
        case 'spiral': {
          const a = Math.atan2(y - 7.5, x - 7.5);
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (Math.floor((a / (Math.PI * 2)) * 8 + d * 0.6 - t) % 2 === 0) ch = 'v';
          break;
        }
        case 'light': {
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (BAYER[y & 3][x & 3] < d * 1.6) ch = null;
          break;
        }
        default:
          break;
      }
      if (!ch) continue;
      if (edgeIn === 0 || (edgeIn < 2 && n < 0.5)) ch = look.edge;
      for (const [sk, p] of look.specks) if (hash3(seed, x + y * 17, 11 + t) < p) { ch = sk; break; }
      cells[y][x] = ch;
    }
  }
  if (look.flames) {
    for (let i = 0; i < 4; i += 1) {
      const fx = 2 + Math.floor(hash3(seed, i, 5) * 11);
      const fy = 5 + Math.floor(hash3(seed, i, 9) * 8);
      const tall = 2 + ((i + f) % 3);
      for (let j = 0; j <= tall; j += 1) {
        const y = fy - j;
        if (y < 0) break;
        cells[y][fx] = j === 0 ? 'U' : j === tall ? 'r' : 'u';
        if (j === 0 && fx + 1 < T) cells[y][fx + 1] = 'U';
      }
    }
  }
  const rows = done(cells);
  SURFACE_CACHE.set(k, rows);
  return rows;
}

// ---------- projectiles (one hand frame each, facing right; the trail derived) ----------

const g = (text) => freeze(text.split('\n').map((r) => r.trim()).filter(Boolean));
export const PROJECTILES = freeze({
  // Milo's mote of light
  mote: g(`
    ..c..
    .cuc.
    cuUuc
    .cuc.
    ..c..
  `),
  // the Scribe's quill, thrown nib first
  quill: g(`
    cc.....
    cCCnnoo
    cc.....
  `),
  // a bolt of static (a Longshot's shot, a Neon zap)
  bolt: g(`
    ...u.
    ..uc.
    .ucu.
    .cu..
    .u...
  `),
  // one of Jev's feathers
  feather: g(`
    ....ww.
    .wwWWWw
    nnnnnnw
    .wwWWw.
  `),
  // a frontier cork
  cork: g(`
    .ooo.
    onnbo
    onnbo
    .ooo.
  `),
  // the Artificer's rivet
  rivet: g(`
    .oo..
    oSso.
    oSzzo
    oSso.
    .oo..
  `),
  // a star (Void, Starlight)
  star: g(`
    ..k..
    ..k..
    kkckk
    ..k..
    ..k..
  `),
  // a Neon glitch packet
  glitch: g(`
    ee.k
    euuk
    kuue
    k.ee
  `),
  // a flame (a candle's, an Iron spark)
  flame: g(`
    ..r..
    .rUr.
    rUuUr
    rUcUr
    .rUr.
  `),
  // a Nocturne nightwing
  nightwing: g(`
    o.....o
    VoVVVoV
    .VVVVV.
    ..oVo..
  `),
});

const PROJECTILE_CACHE = new Map();
/**
 * A projectile's frame: 0 is its hand frame; 1 adds a dithered trail behind it. `dir` 'right' (as
 * drawn), 'left' (mirrored), 'up' or 'down' (turned). Frozen and cached; null for an unknown id.
 */
export function projectileFrame(id, frame = 0, dir = 'right') {
  const art = PROJECTILES[id];
  if (!art) return null;
  const f = Math.floor(Number(frame) || 0) % 2;
  const d = ['right', 'left', 'up', 'down'].includes(dir) ? dir : 'right';
  const k = `${id}|${f}|${d}`;
  const known = PROJECTILE_CACHE.get(k);
  if (known) return known;
  // Both frames are two pixels wider than the art, so they line up: frame 0 is the art at the front;
  // frame 1 leaves every other pixel of it behind, two pixels back.
  const w = art[0].length;
  const h = art.length;
  let rows = art.map((row, y) => {
    const out = Array(w + 2).fill('.');
    if (f === 1) for (let x = 0; x < w; x += 1) if (row[x] !== '.' && ((x + y) & 1) === 0) out[x] = row[x];
    for (let x = 0; x < w; x += 1) if (row[x] !== '.') out[x + 2] = row[x];
    return out.join('');
  });
  const W = w + 2;
  if (d === 'left') rows = rows.map((r) => [...r].reverse().join(''));
  if (d === 'up' || d === 'down') {
    const turned = Array.from({ length: W }, () => Array(h).fill('.'));
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (d === 'up') turned[W - 1 - x][y] = ch; // a quarter turn anticlockwise: its nose points up
      else turned[x][h - 1 - y] = ch; // clockwise: its nose points down
    }));
    rows = turned.map((r) => r.join(''));
  }
  const out = freeze(rows);
  PROJECTILE_CACHE.set(k, out);
  return out;
}

/** The projectile a spell or strike throws, by ability or kind: a hint table for anim.js. */
export const PROJECTILE_FOR = freeze({
  mote: 'mote', flare: 'mote', 'little-light': 'mote', inkdarts: 'quill', 'ink-blot': 'quill', 'full-stop': 'quill',
  'loose-thread': 'star', 'hum-off-key': 'star', verdict: 'feather', 'bench-drone': 'bolt', 'spare-part': 'rivet',
  static: 'bolt', spark: 'bolt', warp: 'star', dread: 'nightwing', light: 'flame', dust: 'cork', grind: 'rivet', ink: 'quill',
  neon: 'glitch', nocturne: 'nightwing', gothic: 'flame', iron: 'rivet', void: 'star', noir: 'quill', frontier: 'cork', kaiju: 'rivet',
});
