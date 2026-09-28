// The Hushlands beyond Hearthvale (WORLD.md): an endless, seeded world that keeps to the story.
// Hearthvale (src/world/map.js) sits untouched at the centre and is always sanctuary. The
// story's regions are anchored around it in the order of the Long Road, with roads between
// them; everything else (coasts, forests, rivers, ruins, caves, lanterns, far lands, wild
// rifts) comes from the seed, chunk by chunk, forever. Pure and deterministic; runs in Node.
import { MAP, coastAt, beachAt } from './map.js';
import { createRng, hashInts, hashString, fbm, ridged, smoothstep } from './rng.js';

export const CHUNK = 32;
export const HEART = Object.freeze({ x: 0, y: 0, w: MAP.width, h: MAP.height, cx: 31.5, cy: 22 });
export const SEA_LEVEL = 0.4;
export const TIER_SPAN = 55; // tiles of distance per difficulty tier

export const TERRAIN = Object.freeze({
  DEEP: 0, SEA: 1, SAND: 2, GRASS: 3, MEADOW: 4, FOREST: 5, PINE: 6, BIRCH: 7, MARSH: 8, PAINTED: 9,
  ROCK: 10, MOUNTAIN: 11, SNOW: 12, BASALT: 13, MOOR: 14, RIVER: 15, ROAD: 16, HEART: 17, SKY: 18, DOWNS: 19, BRIDGE: 20,
});
const T = TERRAIN;
export const TERRAIN_INFO = [
  { id: 'deep', name: 'Deep sea', walk: false, cost: Infinity },
  { id: 'sea', name: 'Sea', walk: false, cost: Infinity },
  { id: 'sand', name: 'Beach', walk: true, cost: 1.5 },
  { id: 'grass', name: 'Grassland', walk: true, cost: 1 },
  { id: 'meadow', name: 'Meadow', walk: true, cost: 1.2 },
  { id: 'forest', name: 'Forest', walk: true, cost: 2.5 },
  { id: 'pine', name: 'Pinewood', walk: true, cost: 2.5 },
  { id: 'birch', name: 'Birchwood', walk: true, cost: 2 },
  { id: 'marsh', name: 'Marsh', walk: true, cost: 4 },
  { id: 'painted', name: 'Painted hills', walk: true, cost: 1.3 },
  { id: 'rock', name: 'Rocky ground', walk: true, cost: 5 },
  { id: 'mountain', name: 'Mountains', walk: false, cost: 40 },
  { id: 'snow', name: 'Snowfield', walk: true, cost: 5 },
  { id: 'basalt', name: 'Basalt', walk: true, cost: 2 },
  { id: 'moor', name: 'Grey moor', walk: true, cost: 2 },
  { id: 'river', name: 'River', walk: false, cost: 12 },
  { id: 'road', name: 'Road', walk: true, cost: 0.6 },
  { id: 'heart', name: 'Hearthvale', walk: true, cost: 1 },
  { id: 'sky', name: 'Floating isles', walk: false, cost: Infinity },
  { id: 'downs', name: 'Downs', walk: true, cost: 1.2 },
  { id: 'bridge', name: 'Bridge', walk: true, cost: 0.6 },
];

// The story's regions (LORE.md §8), anchored in tiles relative to Hearthvale's top-left.
// `affinity` weights the genres of wild rifts nearby (RIFTS.md); the Far Shore has none.
export const ANCHORS = Object.freeze([
  { id: 'hearthvale', name: 'Hearthvale', x: 32, y: 22, radius: 0, biome: null, tier: 1, act: 'Prologue', affinity: {} },
  { id: 'whisperwood', name: 'The Whisperwood', x: 30, y: -60, radius: 46, biome: T.PINE, tier: 2, act: 'Act I', affinity: { nocturne: 3, gothic: 1.5 } },
  { id: 'mistmere', name: 'Mistmere Harbor', x: 104, y: 16, radius: 24, biome: T.GRASS, tier: 2, act: 'Act II', affinity: { frontier: 3, kaiju: 1.5, nocturne: 1 } },
  { id: 'painted-hills', name: 'The Painted Hills', x: 98, y: 112, radius: 44, biome: T.PAINTED, tier: 2, act: 'Act I', affinity: { starlight: 3, verdant: 2.5 } },
  { id: 'ivory-college', name: 'The Ivory College', x: 26, y: 124, radius: 30, biome: T.MEADOW, tier: 2, act: 'Act I', affinity: { summit: 3, backhalls: 2, noir: 1 } },
  { id: 'dicing-downs', name: 'The Dicing Downs', x: -56, y: 96, radius: 40, biome: T.DOWNS, tier: 1, act: 'Act I', affinity: { frontier: 2, noir: 1.5, starlight: 1 } },
  { id: 'cinderforge', name: 'Cinderforge', x: -118, y: 8, radius: 40, biome: T.BASALT, tier: 3, act: 'Act IV', affinity: { iron: 3.5, neon: 3 } },
  { id: 'glass-fen', name: 'The Glass Fen', x: -26, y: 190, radius: 48, biome: T.MARSH, tier: 3, act: 'Act II', affinity: { noir: 3, neon: 1.5, void: 1 } },
  { id: 'archive-peaks', name: 'The Archive Peaks', x: 112, y: -118, radius: 52, biome: T.SNOW, tier: 4, act: 'Act III', affinity: { void: 2.5, gothic: 1.5, summit: 1 } },
  { id: 'greyreach', name: 'The Greyreach', x: -150, y: -140, radius: 70, biome: T.MOOR, tier: 6, act: 'Act V', affinity: { gothic: 4, void: 3, iron: 1, nocturne: 1, neon: 1, frontier: 1 } },
  { id: 'skyward-isles', name: 'The Skyward Isles', x: 190, y: -24, radius: 34, biome: T.SKY, tier: 5, act: 'Act IV', affinity: { neon: 1.5, starlight: 1.5, kaiju: 1 } },
  { id: 'far-shore', name: 'The Far Shore', x: -332, y: 40, radius: 34, biome: T.GRASS, tier: 1, act: 'Act VI', affinity: null, island: true },
]);

// Real rifts open on the frontier facing the region their genre belongs to (RIFTS.md §10).
export const GENRE_DIRECTION = Object.freeze({
  neon: 'cinderforge', iron: 'cinderforge', gothic: 'greyreach', void: 'archive-peaks', noir: 'glass-fen',
  frontier: 'mistmere', kaiju: 'mistmere', nocturne: 'whisperwood', verdant: 'painted-hills', starlight: 'painted-hills',
  summit: 'ivory-college', backhalls: 'ivory-college',
});

// Hearthvale's gates: existing gaps in its tree line (edge is the free tile just inside, so the
// vale itself never changes). Roads start just outside each one, heading away from the vale.
export const GATES = Object.freeze({
  'gate:n': { edge: { x: 32, y: 0 }, dir: { x: 0, y: -1 } },
  'gate:w': { edge: { x: 0, y: 20 }, dir: { x: -1, y: 0 } },
  'gate:e': { edge: { x: 63, y: 14 }, dir: { x: 1, y: 0 } },
  'gate:sw': { edge: { x: 11, y: 43 }, dir: { x: 0, y: 1 } },
});
// The Long Road and its branches, in the order the story walks them.
const ROAD_EDGES = [
  ['gate:n', 'whisperwood'], ['gate:e', 'mistmere'], ['gate:w', 'cinderforge'], ['gate:sw', 'dicing-downs'], ['gate:sw', 'ivory-college'],
  ['mistmere', 'painted-hills'], ['mistmere', 'archive-peaks'], ['whisperwood', 'archive-peaks'], ['whisperwood', 'greyreach'],
  ['ivory-college', 'glass-fen'], ['dicing-downs', 'cinderforge'], ['painted-hills', 'ivory-college'], ['cinderforge', 'westwatch'],
];

const DEFAULT_REGION_WORDS = {
  first: ['Saltglass', 'Moonfall', 'Amber', 'Thistle', 'Lantern', 'Quiet', 'Hollow', 'Cinder', 'Silver', 'Rainfell', 'Ember', 'Owlwing', 'Mistral', 'Heron', 'Lark', 'Bramble'],
  second: ['Reach', 'Isles', 'Wold', 'Fells', 'Marches', 'Deeps', 'Barrens', 'Vale', 'Downs', 'Shore', 'Hollows', 'Heights', 'Wilds', 'Sound'],
};

const LAND = new Set([T.GRASS, T.MEADOW, T.FOREST, T.PINE, T.BIRCH, T.DOWNS, T.PAINTED, T.MOOR]);
const WATERS = new Set([T.DEEP, T.SEA, T.RIVER]);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const key = (x, y) => `${x},${y}`;
// Lakes, ponds and stretches of river smaller than this many tiles are noise, not water: a blob of
// a pond one or two tiles across reads as a mistake, so they're land (see naturalTerrain).
export const MIN_WATER = 10;
// Rivers are the lines where ridged noise tops RIVER_RIDGE. The threshold rises toward 1, so a
// river narrows to a point and ends, over RIVER_TAPER: as the land's height climbs through climb
// (gone at 0.72, where rivers always stopped, but no longer cut off square there); as the distance
// from the vale's edge falls through vale, in tiles (narrowing from ten out, gone three out, so no
// river runs into the walls or leaves a stub by a gate); and within region tiles (warped) of the
// regions whose hard ground takes no river (Cinderforge's basalt, the Peaks' snow and rock). A
// river that reaches the Glass Fen runs on into its pools, as water should.
const RIVER_RIDGE = 0.986;
const RIVER_TAPER = Object.freeze({
  climb: [0.68, 0.72],
  vale: [3, 10],
  region: 6,
  regions: new Set(['cinderforge', 'archive-peaks']),
});
// A road's last tiles to a gate (from the ring tile out) are one lane wide, on the gate's own line.
export const GATE_LANE = 3;
// Fixed places (lanterns, landmarks, statues) keep this many tiles clear of any bridge's deck.
export const DECK_CLEAR = 2;
// A ring tile by the vale's bay is the bay's water when the vale's waterline lies within this much
// of its top (see rawTerrain's ring); otherwise it's the wall.
const RING_BAY_WET = 0.25;
/** Whether ring tile (x, y) is open water where the vale's own bay carries on through the ring. */
export const isBayRing = (x, y) => x >= 16 && y >= 28 && coastAt(x + 0.5) <= y + RING_BAY_WET;
// The vale's own coast (map.js coastAt, beachAt) carries on east of it for this many tiles before
// the wilds' own shore takes over, so the beach runs straight on out of the vale.
const COAST_RUN = 18;
// Every walkable tile within this many tiles of the vale can be walked to from its gates, and one
// shut in by the land's own shapes smaller than POCKET_FILL tiles is filled in (openFrontier).
const FRONTIER = 60;
const POCKET_FILL = 8;
// Tile keys as numbers for the terrain caches (exact for |x|, |y| < 2^21).
const TILE_KEY_LIMIT = 2 ** 21;
const tileKey = (x, y) => (x + TILE_KEY_LIMIT) * 2 ** 22 + (y + TILE_KEY_LIMIT);

export function createWorldgen({ seed = 'hushlands', regionWords = DEFAULT_REGION_WORDS } = {}) {
  const S = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  const jitter = (id, axis) => Math.round((((hashInts(S, id, axis) >>> 8) % 17) - 8));
  const anchors = ANCHORS.map((a) => (a.id === 'hearthvale' ? { ...a } : { ...a, x: a.x + jitter(a.id, 'x'), y: a.y + jitter(a.id, 'y') }));
  const anchorById = Object.fromEntries(anchors.map((a) => [a.id, a]));

  // ---------- where things are ----------

  const inHeart = (x, y) => x >= 0 && y >= 0 && x < HEART.w && y < HEART.h;
  /** Distance in tiles from Hearthvale's edge (0 inside it). */
  function heartDistance(x, y) {
    const dx = Math.max(0, -x, x - (HEART.w - 1));
    const dy = Math.max(0, -y, y - (HEART.h - 1));
    return Math.hypot(dx, dy);
  }
  const centreDistance = (x, y) => Math.hypot(x - HEART.cx, y - HEART.cy);
  /** Difficulty grows with distance, without end (depth), and caps at tier 8. */
  const depthAt = (x, y) => 1 + Math.floor(centreDistance(x, y) / TIER_SPAN);
  function tierAt(x, y) {
    for (const a of anchors) {
      if (a.radius && regionDistance(a, x, y) < 1) return a.tier;
    }
    return Math.min(8, depthAt(x, y));
  }

  // ---------- terrain ----------

  // The land's height before the vale's coast is carried out into the wilds (elevationAt).
  function baseElevation(x, y) {
    const wx = x + (fbm(x / 110, y / 110, S + 11, { octaves: 3 }) - 0.5) * 90;
    const wy = y + (fbm(x / 110, y / 110, S + 12, { octaves: 3 }) - 0.5) * 90;
    const continent = Math.hypot((wx + 40) / 205, (wy - 25) / 250);
    const land = 1 - smoothstep(0.8, 1.06, continent);
    let e = 0.2 + land * 0.42 + (fbm(x / 64, y / 64, S, { octaves: 5 }) - 0.5) * 0.5;
    // Far lands: other shores and isles beyond the Hushlands, forever.
    e += (1 - land) * smoothstep(0.56, 0.7, fbm(x / 420, y / 420, S + 99, { octaves: 3 })) * 0.5;
    // The bay south-east of Hearthvale (its dock is in the vale), and the strait that joins it
    // to the eastern sea, which is how Titans come in.
    const bay = Math.hypot((x - 72) / 62, (y - 62) / 30);
    e -= (1 - smoothstep(0.75, 1.15, bay)) * 0.45;
    const strait = Math.hypot((x - 160) / 74, (y - 64 - (fbm(x / 40, 0, S + 13) - 0.5) * 16) / 7);
    e -= (1 - smoothstep(0.7, 1.15, strait)) * 0.4;
    // Hearthvale's surroundings stay solid land, except where it already meets the bay.
    const near = 1 - smoothstep(4, 22, heartDistance(x, y));
    if (near > 0 && bay > 1.1) e = Math.max(e, SEA_LEVEL + 0.1 * near);
    // Regions that shape the land.
    const peaks = anchorById['archive-peaks'];
    const dPeaks = Math.hypot(x - peaks.x, y - peaks.y) / peaks.radius;
    e += (1 - smoothstep(0.2, 1.1, dPeaks)) * 0.34;
    const shore = anchorById['far-shore'];
    const dShore = Math.hypot(x - shore.x, y - shore.y) / shore.radius;
    if (dShore < 1.3) e = Math.max(e, SEA_LEVEL + 0.2 * (1 - smoothstep(0.55, 1.05, dShore)) - 0.02);
    return e;
  }

  // Where the wilds' own shore meets the sea in a column just east of the vale (in tiles, like
  // map.js coastAt: a tile is sea once its feet are past it), found once per column.
  const wildCoast = new Map();
  function wildCoastAt(x) {
    let c = wildCoast.get(x);
    if (c === undefined) {
      c = 50;
      for (let y = 24; y < 50; y += 1) if (baseElevation(x, y) < SEA_LEVEL) { c = y + 13 / 16 - 0.5; break; }
      wildCoast.set(x, c);
    }
    return c;
  }

  /**
   * The land's height. East of the vale the bay's shore carries the vale's own coast and beach
   * straight on (map.js coastAt and beachAt, measured at a tile's feet as the vale measures its own
   * tiles) and bends over COAST_RUN tiles to where the wilds' own shore lies, the beach narrowing as
   * it goes, so the two coastlines meet with no step; the ground above that beach is dry land.
   */
  function elevationAt(x, y) {
    let e = baseElevation(x, y);
    if (x >= HEART.w - 1 && x < HEART.w + COAST_RUN && y > 20 && y < 54) {
      const s = smoothstep(HEART.w, HEART.w + COAST_RUN, x);
      const coast = coastAt(x + 0.5) * (1 - s) + wildCoastAt(x) * s;
      const d = coast - (y + 13 / 16);
      if (Math.abs(d) < 5) {
        const beach = beachAt(x + 0.5) * (1 - s);
        if (d < 0) e = Math.min(e, SEA_LEVEL - 0.02 + 0.03 * d);
        else if (d < beach) e = SEA_LEVEL + 0.01;
        // dry land by the vale; the wilds' own (marsh and all) further out
        else e = Math.max(e, SEA_LEVEL + 0.021 + 0.11 * (1 - s));
      }
    }
    return e;
  }

  // A region's reach, with ragged, domain-warped edges so no region is a circle.
  function regionDistance(a, x, y) {
    const raw = Math.hypot(x - a.x, y - a.y) / a.radius;
    if (raw >= 1.7) return raw;
    const k = hashString(a.id) % 997;
    const warp = a.radius * 1.5;
    const wx = x + (fbm(x / 28, y / 28, S + 300 + k, { octaves: 3 }) - 0.5) * warp;
    const wy = y + (fbm(x / 28, y / 28, S + 600 + k, { octaves: 3 }) - 0.5) * warp;
    return Math.hypot(wx - a.x, wy - a.y) / a.radius;
  }

  // The land and water before small water is filled in (see naturalTerrain). With route, rivers run
  // their whole courses, full width until the land climbs past them, as the roads are routed (see
  // roads()): a river's narrowing end only changes where its water stops.
  function rawTerrain(x, y, route = false) {
    const e = elevationAt(x, y);
    // Colder to the north (negative y), warmer to the south.
    const t = 0.55 + y / 700 + (fbm(x / 160, y / 160, S + 21, { octaves: 3 }) - 0.5) * 0.35;
    const m = fbm(x / 120, y / 120, S + 31, { octaves: 4 });
    let terrain;
    if (e < SEA_LEVEL - 0.09) terrain = T.DEEP;
    else if (e < SEA_LEVEL) terrain = T.SEA;
    else if (e < SEA_LEVEL + 0.02) terrain = T.SAND;
    else if (e > 0.83) terrain = t < 0.42 ? T.SNOW : T.MOUNTAIN;
    else if (e > 0.76) terrain = t < 0.34 ? T.SNOW : T.ROCK;
    else if (m > 0.64 && e < SEA_LEVEL + 0.1) terrain = T.MARSH;
    else if (t < 0.36) terrain = T.PINE;
    else if (m > 0.58) terrain = T.FOREST;
    else if (m > 0.52) terrain = T.BIRCH;
    else if (m < 0.36) terrain = T.MEADOW;
    else terrain = T.GRASS;
    // Hearthvale's forest ring carries on a little way past its edge.
    const hd = heartDistance(x, y);
    if (hd < 10 && (terrain === T.GRASS || terrain === T.MEADOW) && fbm(x / 9, y / 9, S + 51, { octaves: 2 }) > 0.35 + hd * 0.03) terrain = T.FOREST;
    // How far a river here has narrowed toward its end (0: full width, 1: gone), RIVER_TAPER: as the
    // land climbs toward the hills, as it nears the vale's walls, and as it nears a region whose
    // ground takes no river. So every river ends in a spring, never cut off square.
    let taper = route ? (e < RIVER_TAPER.climb[1] ? 0 : 1)
      : Math.max(smoothstep(RIVER_TAPER.climb[0], RIVER_TAPER.climb[1], e), 1 - smoothstep(RIVER_TAPER.vale[0], RIVER_TAPER.vale[1], hd));
    // The story's regions.
    for (const a of anchors) {
      if (a.biome === null) continue;
      if (Math.hypot(x - a.x, y - a.y) >= a.radius * 1.7) continue;
      const d = regionDistance(a, x, y);
      if (!route && RIVER_TAPER.regions.has(a.id)) taper = Math.max(taper, 1 - smoothstep(1, 1 + RIVER_TAPER.region / a.radius, d));
      if (d >= 1) continue;
      if (a.id === 'skyward-isles') {
        // Isles float above the eastern sea; the largest, at the centre, is the Isles' harbour.
        if ((terrain === T.SEA || terrain === T.DEEP) && (d < 0.22 || fbm(x / 11, y / 11, S + 61, { octaves: 2 }) > 0.53)) terrain = T.SKY;
        continue;
      }
      if ((terrain === T.SEA || terrain === T.DEEP) && !a.island) continue;
      if (a.id === 'far-shore') {
        // White cliffs to the west, a beach and the Quay of Departures to the east.
        if (terrain !== T.SEA && terrain !== T.DEEP) terrain = d > 0.86 ? (x < a.x ? T.ROCK : T.SAND) : T.MEADOW;
      } else if (a.id === 'archive-peaks') {
        // Ridges of mountains with snowfields between; the Stacks stand in a clearing at the centre.
        const ridge = ridged(x / 22, y / 22, S + 111, { octaves: 3 });
        terrain = d < 0.14 ? T.SNOW : ridge > 0.9 ? T.MOUNTAIN : ridge > 0.8 ? T.ROCK : T.SNOW;
      } else if (a.id === 'cinderforge') terrain = d > 0.3 && ridged(x / 20, y / 20, S + 71, { octaves: 2 }) > 0.93 ? T.MOUNTAIN : T.BASALT;
      else if (a.id === 'whisperwood') terrain = fbm(x / 14, y / 14, S + 81, { octaves: 2 }) > 0.66 ? T.GRASS : T.PINE;
      else if (a.id === 'glass-fen') terrain = fbm(x / 10, y / 10, S + 91, { octaves: 2 }) > 0.63 ? T.RIVER : T.MARSH;
      else terrain = a.biome;
    }
    // Rivers wind through the lowlands, narrowing to a point where they end.
    const dry = terrain;
    if (LAND.has(terrain) && taper < 1 && ridged(x / 150, y / 150, S + 41, { octaves: 3 }) > RIVER_RIDGE + (1 - RIVER_RIDGE) * taper) terrain = T.RIVER;
    // The ring round the vale (the tiles just outside it) is its wall: land all round, so the
    // thicket or palisade runs unbroken, except where the vale's own bay carries on out through it:
    // there a ring tile is water just when the vale's waterline (map.js coastAt) crosses its top
    // quarter (RING_BAY_WET: three quarters and more of it past the line), and wall on the beach
    // otherwise, so the wall runs on to where the bay is plainly open water (the wilds paint each
    // wall tile by the bay all dry or all water).
    if (x >= -1 && y >= -1 && x <= HEART.w && y <= HEART.h && !inHeart(x, y)) {
      const bay = isBayRing(x, y);
      if (bay && !WATERS.has(terrain)) terrain = T.SEA;
      else if (!bay && WATERS.has(terrain)) terrain = terrain === T.RIVER ? dry : T.SAND;
    }
    return terrain;
  }

  // Raw terrain by tile, and whether each water tile belongs to a body of at least MIN_WATER tiles
  // (or else the land it's filled with). Pure functions of the seed, so the caches only save time.
  const rawCache = new Map();
  const fillCache = new Map();
  const BIG_WATER = -1;
  function cachedRaw(x, y) {
    const k = tileKey(x, y);
    let t = rawCache.get(k);
    if (t === undefined) {
      if (rawCache.size > 400000) { rawCache.clear(); fillCache.clear(); }
      t = rawTerrain(x, y);
      rawCache.set(k, t);
    }
    return t;
  }
  /**
   * The land at a tile before roads: elevation, climate and the story's regions, with rivers. Water
   * that doesn't make a body of MIN_WATER tiles (outside the vale, four-way) is filled in with the
   * land most of its neighbours are, so there are no stray one-tile ponds or broken-off specks.
   */
  function naturalTerrain(x, y) {
    const far = Math.abs(x) >= TILE_KEY_LIMIT - 64 || Math.abs(y) >= TILE_KEY_LIMIT - 64;
    if (!Number.isInteger(x) || !Number.isInteger(y) || far) return rawTerrain(x, y);
    const t = cachedRaw(x, y);
    // Deep water is the open sea's (the land never falls from above sea level to deep water within
    // a tile), never a pond: no need to look round it.
    if (!WATERS.has(t) || t === T.DEEP) return t;
    const k = tileKey(x, y);
    let v = fillCache.get(k);
    if (v === undefined) {
      const body = [[x, y]];
      const seen = new Set([k]);
      for (let i = 0; i < body.length && body.length < MIN_WATER; i += 1) {
        const [bx, by] = body[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = bx + dx;
          const ny = by + dy;
          const nk = tileKey(nx, ny);
          if (seen.has(nk) || inHeart(nx, ny) || !WATERS.has(cachedRaw(nx, ny))) continue;
          seen.add(nk);
          body.push([nx, ny]);
        }
      }
      if (body.length >= MIN_WATER) {
        for (const [bx, by] of body) fillCache.set(tileKey(bx, by), BIG_WATER);
      } else {
        for (const [bx, by] of body) {
          const votes = new Map();
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const o = cachedRaw(bx + dx, by + dy);
              if (!WATERS.has(o) && o !== T.SKY) votes.set(o, (votes.get(o) || 0) + 1);
            }
          }
          let best = BIG_WATER; // among the sky isles' sea there's no land to fill it with: it stays sea
          let most = 0;
          for (const [o, n] of votes) if (n > most || (n === most && o < best)) { best = o; most = n; }
          fillCache.set(tileKey(bx, by), best);
        }
      }
      v = fillCache.get(k);
    }
    return v === BIG_WATER ? t : v;
  }

  // ---------- roads (computed once, lazily) ----------

  let roadCache = null;
  function roads() {
    if (roadCache) return roadCache;
    const CELL = 4;
    const xs = anchors.map((a) => a.x);
    const ys = anchors.map((a) => a.y);
    const minX = Math.min(...xs) - 60;
    const maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;
    const GW = Math.ceil((maxX - minX) / CELL);
    const GH = Math.ceil((maxY - minY) / CELL);
    const cellCost = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy += 1) {
      for (let gx = 0; gx < GW; gx += 1) {
        const tx = minX + gx * CELL + 2;
        const ty = minY + gy * CELL + 2;
        // A road through a cell runs on its centre and the tiles east and south of it, so a cell
        // whose road would touch the vale or its ring (the walls) is shut: roads keep clear of the
        // walls and never cut the vale's corners, and meet it only at the gates, whose own
        // stretches start from outside (the gates' first cells are where the search begins).
        // (The land before small ponds are filled is near enough for a route, and far cheaper.)
        // Routes take the rivers' whole courses, as if none had narrowed to its end, so no road
        // squeezes through between a river's spring and the vale's walls, and the network keeps
        // its lines; where a river has ended the road is just road.
        const hugs = tx >= -2 && tx <= HEART.w && ty >= -2 && ty <= HEART.h;
        cellCost[gy * GW + gx] = hugs ? Infinity : TERRAIN_INFO[rawTerrain(tx, ty, true)].cost;
      }
    }
    const used = new Uint8Array(GW * GH);
    const toCell = (p) => ({ gx: Math.max(0, Math.min(GW - 1, Math.floor((p.x - minX) / CELL))), gy: Math.max(0, Math.min(GH - 1, Math.floor((p.y - minY) / CELL))) });
    // The Westwatch: the continent's west shore, level with the Far Shore. On a clear night
    // the Great Lighthouse can be seen turning across the sea (the ferry leaves from Mistmere).
    const shore = anchorById['far-shore'];
    let westwatch = { x: shore.x + shore.radius, y: shore.y };
    for (let x = shore.x + shore.radius; x < 0; x += 1) {
      const t = naturalTerrain(x, shore.y);
      if (TERRAIN_INFO[t].walk && x - shore.x > shore.radius * 1.4) { westwatch = { x: x + 2, y: shore.y }; break; }
    }
    const gatePoint = (gate, out) => ({ x: gate.edge.x + gate.dir.x * out, y: gate.edge.y + gate.dir.y * out });
    const endpoint = (id) => (GATES[id] ? gatePoint(GATES[id], 5) : id === 'westwatch' ? westwatch : anchorById[id]);
    const paths = [];
    for (const [from, to] of ROAD_EDGES) {
      const a = endpoint(from);
      const b = endpoint(to);
      const cells = astar(toCell(a), toCell(b), GW, GH, cellCost, used);
      for (const c of cells) used[c.gy * GW + c.gx] = 1;
      const raw = [a, ...cells.map((c) => ({ x: minX + c.gx * CELL + 2, y: minY + c.gy * CELL + 2 })), b];
      // Roads from the vale start right at its gate.
      if (GATES[from]) raw.unshift(gatePoint(GATES[from], 1));
      // The search walks cell centres, so a road's ends can double back (from a gate's own straight
      // stretch to the first cell's centre, say, and back): drop any point the road would turn
      // back at, more sharply than a right angle. A gate's straight stretch stays.
      const keep = GATES[from] ? 2 : 1;
      const points = raw.slice(0, keep);
      for (let i = keep; i < raw.length - 1; i += 1) {
        const p = points[points.length - 1];
        const q = raw[i];
        const r = raw[i + 1];
        if ((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y) < 0) continue;
        points.push(q);
      }
      points.push(raw[raw.length - 1]);
      paths.push({ from, to, points });
    }
    // Rasterise: connect consecutive points tile by tile, two tiles wide, crossing water on
    // straight decks (layRoad). decks: tile key → 'ns' | 'ew', or 'x' where two decks meet.
    const tiles = new Set();
    const decks = new Map();
    const wet = (x, y) => { if (inHeart(x, y)) return false; const t = naturalTerrain(x, y); return t === T.RIVER || t === T.SEA; };
    const barred = (x, y, onLine) => { if (inHeart(x, y)) return onLine; const t = naturalTerrain(x, y); return t === T.DEEP || t === T.SKY; };
    for (const p of paths) {
      layRoad(p.points, { wet, barred }, (x, y, deck) => {
        if (inHeart(x, y)) return;
        const k = key(x, y);
        tiles.add(k);
        if (deck) decks.set(k, decks.has(k) && decks.get(k) !== deck ? 'x' : deck);
      });
    }
    // A gate is a gap one tile wide in the wall, so a road's last GATE_LANE tiles to it (the ring
    // tile and the next ones out, a bridge's deck included) are one lane, on the gate's own column
    // or row: its second lane would otherwise run on into the thicket or the gatehouse's post.
    for (const g of Object.values(GATES)) {
      const [sx, sy] = g.dir.x === 0 ? [1, 0] : [0, 1]; // the second lane beside a line along the gate's way
      for (let k = 1; k <= GATE_LANE; k += 1) {
        const lane = key(g.edge.x + g.dir.x * k + sx, g.edge.y + g.dir.y * k + sy);
        tiles.delete(lane);
        decks.delete(lane);
      }
    }
    // Lanterns (places of rest and fast travel) every ~40 tiles of road, and at each region.
    const lanterns = [];
    for (const p of paths) {
      let walked = 0;
      for (let i = 1; i < p.points.length; i += 1) {
        walked += Math.hypot(p.points[i].x - p.points[i - 1].x, p.points[i].y - p.points[i - 1].y);
        const pt = p.points[i];
        if (walked >= 40 && heartDistance(pt.x, pt.y) > 10 && !lanterns.some((l) => Math.hypot(l.x - pt.x, l.y - pt.y) < 24)) {
          lanterns.push({ type: 'lantern', x: pt.x + 2, y: pt.y, name: 'A sleeping lantern' });
          walked = 0;
        }
      }
    }
    // Road tiles by chunk, for the notes tucked beside them.
    const byChunk = new Map();
    for (const k of tiles) {
      const [x, y] = k.split(',').map(Number);
      const ck = key(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
      if (!byChunk.has(ck)) byChunk.set(ck, []);
      byChunk.get(ck).push({ x, y });
    }
    roadCache = { paths, tiles, decks, westwatch, lanterns, byChunk, fixes: new Map() };
    openFrontier(roadCache);
    return roadCache;
  }

  // The terrain at a tile with the roads laid on it (r: the roads).
  function withRoads(x, y, r) {
    const natural = naturalTerrain(x, y);
    const k = key(x, y);
    if (r.tiles.has(k)) {
      // Rivers and the odd inlet get a bridge or a boardwalk (its deck runs on to the bank, square);
      // open sea and sky never do.
      if (natural === T.DEEP || natural === T.SKY) return natural;
      if (natural === T.RIVER || natural === T.SEA || r.decks.has(k)) return T.BRIDGE;
      return T.ROAD;
    }
    return natural;
  }

  /**
   * The frontier within FRONTIER tiles of the vale can all be walked to from the gates. Where the
   * land's own shapes shut a patch of it in (a loop of river round it, an island, a strip of beach
   * between a river and the sea, the vale's own walls on one side), a patch smaller than
   * POCKET_FILL tiles is filled in with the water or rock round it, and a bigger one gets a little
   * footbridge (or a gap through the rock) by the shortest way across to the rest. Worked out once,
   * with the roads, into r.fixes (tile key → terrain) and, for the footbridges, r.decks.
   */
  function openFrontier(r) {
    const M = FRONTIER + 8; // looked at beyond the frontier itself, so a patch that runs on out is open
    const X0 = -M;
    const Y0 = -M;
    const BW = HEART.w + 2 * M;
    const BH = HEART.h + 2 * M;
    const N = BW * BH;
    const at = (x, y) => (y - Y0) * BW + (x - X0);
    const terrain = new Uint8Array(N);
    const walk = new Uint8Array(N);
    const gates = new Set(Object.values(GATES).map((g) => key(g.edge.x + g.dir.x, g.edge.y + g.dir.y)));
    const wall = (x, y) => x >= -1 && y >= -1 && x <= HEART.w && y <= HEART.h && !inHeart(x, y) && !gates.has(key(x, y));
    for (let y = Y0; y < Y0 + BH; y += 1) {
      for (let x = X0; x < X0 + BW; x += 1) {
        if (inHeart(x, y)) { terrain[at(x, y)] = T.HEART; continue; }
        const t = withRoads(x, y, r);
        terrain[at(x, y)] = t;
        walk[at(x, y)] = TERRAIN_INFO[t].walk && !wall(x, y) ? 1 : 0;
      }
    }
    // The four ways out of a tile, as indices (-1 past the edge of what's looked at).
    const around = (j) => {
      const x = j % BW;
      return [x > 0 ? j - 1 : -1, x < BW - 1 ? j + 1 : -1, j >= BW ? j - BW : -1, j + BW < N ? j + BW : -1];
    };
    // Which patch each walkable tile is in (0: none), and which are open: the gates' own, and any
    // that reaches the edge of what's looked at.
    const patch = new Int32Array(N);
    const open = [false];
    const members = [null];
    for (let i = 0; i < N; i += 1) {
      if (!walk[i] || patch[i]) continue;
      const id = members.length;
      const list = [i];
      patch[i] = id;
      let edge = false;
      for (let q = 0; q < list.length; q += 1) {
        const j = list[q];
        for (const n of around(j)) {
          if (n < 0) { edge = true; continue; }
          if (!walk[n] || patch[n]) continue;
          patch[n] = id;
          list.push(n);
        }
      }
      members.push(list);
      open.push(edge);
    }
    for (const k of gates) {
      const [x, y] = k.split(',').map(Number);
      if (patch[at(x, y)]) open[patch[at(x, y)]] = true;
    }
    // Patches merge as they're joined (a patch joined to an open one is open).
    const root = members.map((_, id) => id);
    const find = (id) => { while (root[id] !== id) id = root[id] = root[root[id]]; return id; };
    const within = (j) => heartDistance((j % BW) + X0, Math.floor(j / BW) + Y0) <= FRONTIER;
    const fix = (j, t, deck = null) => {
      const k = key((j % BW) + X0, Math.floor(j / BW) + Y0);
      terrain[j] = t;
      r.fixes.set(k, t);
      if (deck) r.decks.set(k, deck);
    };
    for (let id = 1; id < members.length; id += 1) {
      if (open[find(id)] || !members[id].some(within)) continue;
      const list = members[id];
      if (list.length < POCKET_FILL) {
        // too small to bother with: whatever most of the ground round it is
        for (const j of list) {
          const votes = new Map();
          const x = j % BW;
          for (const n of [j - 1, j + 1, j - BW, j + BW, j - BW - 1, j - BW + 1, j + BW - 1, j + BW + 1]) {
            if (n < 0 || n >= N || Math.abs((n % BW) - x) > 1 || walk[n]) continue;
            const t = terrain[n];
            if (t === T.HEART || t === T.BRIDGE) continue;
            votes.set(t, (votes.get(t) || 0) + 1);
          }
          let best = T.RIVER;
          let most = 0;
          for (const [t, n] of votes) if (n > most || (n === most && t < best)) { best = t; most = n; }
          fix(j, best);
          walk[j] = 0;
        }
        continue;
      }
      // the shortest way across to open ground: a breadth-first search over what can't be walked
      const from = new Int32Array(N).fill(-1);
      const queue = [];
      for (const j of list) { from[j] = j; queue.push(j); }
      let reached = -1;
      for (let q = 0; q < queue.length && reached < 0; q += 1) {
        const j = queue[q];
        for (const n of around(j)) {
          if (n < 0 || from[n] >= 0) continue;
          if (walk[n]) {
            if (patch[n] && open[find(patch[n])]) { from[n] = j; reached = n; break; }
            continue;
          }
          const t = terrain[n];
          const nx = (n % BW) + X0;
          const ny = Math.floor(n / BW) + Y0;
          if (t === T.HEART || wall(nx, ny) || t === T.DEEP || t === T.SKY) continue;
          from[n] = j;
          queue.push(n);
        }
      }
      if (reached < 0) continue;
      // lay it: water gets a footbridge (its deck the way it crosses), rock a way through
      const way = [];
      for (let j = from[reached]; from[j] !== j; j = from[j]) way.push(j);
      for (let k = 0; k < way.length; k += 1) {
        const j = way[k];
        const prev = k > 0 ? way[k - 1] : reached;
        const next = k + 1 < way.length ? way[k + 1] : from[j];
        const alongX = Math.abs(prev - j) === 1 || Math.abs(next - j) === 1;
        const alongY = Math.abs(prev - j) === BW || Math.abs(next - j) === BW;
        const t = terrain[j];
        if (t === T.RIVER || t === T.SEA) fix(j, T.BRIDGE, alongX && alongY ? 'x' : alongX ? 'ew' : 'ns');
        else fix(j, T.ROCK);
        walk[j] = 1;
      }
      root[find(id)] = find(patch[reached]);
    }
  }

  /** The final terrain at a tile, roads and all. Hearthvale's own tiles are always HEART. */
  function terrainAt(x, y) {
    if (inHeart(x, y)) return T.HEART;
    const r = roads();
    if (r.fixes.size && heartDistance(x, y) <= FRONTIER + 8) {
      const fixed = r.fixes.get(key(x, y));
      if (fixed !== undefined) return fixed;
    }
    return withRoads(x, y, r);
  }
  /** Which way a bridge's deck runs at a tile: 'ns', 'ew', 'x' (a landing where two meet) or null. */
  const deckAt = (x, y) => roads().decks.get(key(x, y)) || null;
  const walkable = (x, y) => (inHeart(x, y) ? true : TERRAIN_INFO[terrainAt(x, y)].walk);
  const isWater = (x, y) => { const t = terrainAt(x, y); return t === T.SEA || t === T.DEEP; };

  // ---------- points of interest ----------

  let fixedCache = null;
  function fixedPois() {
    if (fixedCache) return fixedCache;
    // A place stands on the land, clear of any bridge (none within DECK_CLEAR tiles), so it and the
    // prop beside it are on the bank, never out on a deck or at its corner.
    const clearOfDecks = (x, y) => {
      for (let dy = -DECK_CLEAR; dy <= DECK_CLEAR; dy += 1) {
        for (let dx = -DECK_CLEAR; dx <= DECK_CLEAR; dx += 1) if (!inHeart(x + dx, y + dy) && terrainAt(x + dx, y + dy) === T.BRIDGE) return false;
      }
      return true;
    };
    const onLand = (x, y) => !inHeart(x, y) && walkable(x, y) && clearOfDecks(x, y);
    const snap = (x, y, ok = onLand) => spiral(Math.round(x), Math.round(y), ok) || { x: Math.round(x), y: Math.round(y) };
    // A lantern along a road stands at the roadside (on the road or right beside it).
    const roadside = (x, y) => onLand(x, y) && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roads().tiles.has(key(x + dx, y + dy)));
    const list = roads().lanterns.map((l) => ({ ...l, ...(spiral(Math.round(l.x), Math.round(l.y), roadside, 12) || snap(l.x, l.y)) }));
    const ww = roads().westwatch;
    list.push({ type: 'landmark', ...snap(ww.x, ww.y), name: 'The Westwatch', note: 'On clear nights the Great Lighthouse can be seen turning, far across the sea.' });
    // Captain Sloe's quay is in Mistmere Harbor, on the water's edge (LORE.md).
    const mm = anchorById.mistmere;
    const shoreline = (x, y) => !inHeart(x, y) && walkable(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWater(x + dx, y + dy));
    list.push({ type: 'quay', ...snap(mm.x, mm.y, shoreline), name: 'Captain Sloe’s ferry quay', region: 'mistmere' });
    for (const a of anchors) {
      if (a.id === 'hearthvale') continue;
      // The Skyward Isles float: their landmark sits on an isle, reached from the Kiteworks.
      const ok = a.id === 'skyward-isles' ? (x, y) => terrainAt(x, y) === T.SKY : onLand;
      list.push({ type: 'landmark', ...snap(a.x, a.y, ok), name: a.name, region: a.id });
      list.push({ type: 'lantern', ...snap(a.x + 3, a.y + 3, ok), name: `The lantern of ${a.name.replace(/^The /, 'the ')}`, region: a.id });
      // One of Tamsin's unfinished statues in each region (Hearthvale keeps its own).
      list.push({ type: 'statue', ...snap(a.x - 4, a.y + 2, ok), name: 'An unfinished statue of Tamsin', region: a.id });
    }
    fixedCache = list;
    return list;
  }

  /** Water to fish in (sea, river or the marsh's pools) within r tiles of a tile. */
  function waterNear(x, y, r) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (inHeart(x + dx, y + dy)) continue;
        const t = terrainAt(x + dx, y + dy);
        if (t === T.SEA || t === T.DEEP || t === T.RIVER || t === T.MARSH) return true;
      }
    }
    return false;
  }

  function chunkPois(cx, cy) {
    const rng = createRng(hashInts(S, cx, cy, 'poi'));
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        const x = cx * CHUNK + i * 8 + rng.int(1, 6);
        const y = cy * CHUNK + j * 8 + rng.int(1, 6);
        const roll = rng.next();
        if (inHeart(x, y) || heartDistance(x, y) < 3) continue;
        const terrain = terrainAt(x, y);
        if (!TERRAIN_INFO[terrain].walk) continue;
        const onRoad = terrain === T.ROAD;
        const depth = depthAt(x, y);
        if (roll < 0.035) out.push({ type: 'ruin', x, y, name: 'Maker ruins', depth });
        else if (roll < 0.06 && (terrain === T.ROCK || terrain === T.FOREST || terrain === T.PINE || terrain === T.BASALT || terrain === T.SNOW)) out.push({ type: 'cave', x, y, name: 'A cave mouth', depth });
        else if (roll < 0.085) {
          // Two draws as before, so the rest of the chunk stays where it was; the name follows the mimic.
          rng.next();
          const mimic = rng.chance(0.12);
          out.push({ type: 'chest', x, y, name: mimic ? 'A suspiciously friendly chest' : 'An old chest', mimic, depth });
        }
        else if (roll < 0.1 && onRoad) out.push({ type: 'note', x, y, name: 'A note from the Old Company', depth });
        else if (roll < 0.108 && (onRoad || terrain === T.GRASS)) out.push({ type: 'hamlet', x, y, name: `${rng.pick(regionWords.first)} Hamlet`, depth });
        else if (roll < 0.14) {
          // A fishing spot needs water to fish in within two tiles; anywhere else the same pick is
          // herbs (one draw either way, so nothing else in the chunk moves).
          let type = rng.pick(['ore', 'herbs', 'fishing']);
          if (type === 'fishing' && !waterNear(x, y, 2)) type = 'herbs';
          out.push({ type, x, y, name: 'Resources', depth });
        }
      }
    }
    // Notes from the Old Company, tucked under a stone beside the road (their own draws, so
    // nothing else moves): about two chunks in five that a road crosses hold one.
    const beside = roads().byChunk.get(key(cx, cy));
    if (beside && beside.length) {
      const nrng = createRng(hashInts(S, cx, cy, 'note'));
      if (nrng.chance(0.4)) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const road = nrng.pick(beside);
          const [dx, dy] = nrng.pick([[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]);
          const x = road.x + dx;
          const y = road.y + dy;
          // a tile inside its chunk, like every other point of interest's, so the props of the chunk
          // beside it never stand right next to it
          if (Math.floor(x / CHUNK) !== cx || Math.floor(y / CHUNK) !== cy) continue;
          const lx = x - cx * CHUNK;
          const ly = y - cy * CHUNK;
          if (lx < 1 || ly < 1 || lx > CHUNK - 2 || ly > CHUNK - 2) continue;
          if (inHeart(x, y) || heartDistance(x, y) < 3 || roads().tiles.has(key(x, y))) continue;
          if (!TERRAIN_INFO[terrainAt(x, y)].walk || out.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 3)) continue;
          out.push({ type: 'note', x, y, name: 'A note from the Old Company', depth: depthAt(x, y) });
          break;
        }
      }
    }
    return out;
  }

  // ---------- wild rifts ----------

  function genreWeightsAt(x, y) {
    const weights = { neon: 1, nocturne: 1, gothic: 1, iron: 1, void: 1, noir: 1, frontier: 1, kaiju: 0.5, verdant: 0.6, starlight: 0.6, summit: 0.6, backhalls: 0.4 };
    let continent = false;
    for (const a of anchors) {
      const d = Math.hypot(x - a.x, y - a.y) / Math.max(1, a.radius);
      if (!a.radius || d > 1.6) continue;
      continent = true;
      if (!a.affinity) return null; // the Far Shore: no rift has ever opened there
      const close = 1 - d / 1.6;
      for (const [id, w] of Object.entries(a.affinity)) weights[id] = (weights[id] || 0) + w * close * 2;
    }
    if (!continent && depthAt(x, y) > 7) for (const id of Object.keys(weights)) weights[id] = 1.2; // the far lands mix everything
    return weights;
  }

  /**
   * Places where other stories have soaked in for good (LORE.md): the Greyreach's Maelstrom
   * patchwork, and Cinderforge's rivet quarter, where the Maker machines came through a
   * thousand years ago. [{ x, y, radius, genre, place }]; drawn like rifts that never close.
   */
  let standingCache = null;
  function standingBleeds() {
    if (standingCache) return standingCache;
    const rng = createRng(hashInts(S, 'standing'));
    const grey = anchorById.greyreach;
    // Every book on the shelf is here somewhere, the gloomier ones most of all.
    const patchwork = [['gothic', 3], ['void', 2.5], ['neon', 2], ['iron', 2], ['frontier', 2], ['nocturne', 2], ['noir', 1.5], ['starlight', 0.6], ['kaiju', 0.4]];
    const out = [];
    for (let attempt = 0; attempt < 200 && out.length < 20; attempt += 1) {
      const angle = rng.next() * Math.PI * 2;
      const dist = Math.sqrt(rng.next()) * grey.radius * 0.9;
      const x = Math.round(grey.x + Math.cos(angle) * dist);
      const y = Math.round(grey.y + Math.sin(angle) * dist);
      const t = naturalTerrain(x, y);
      if (t === T.SEA || t === T.DEEP || regionDistance(grey, x, y) > 0.9) continue;
      out.push({ x, y, radius: rng.int(7, 13), genre: rng.weighted(patchwork), place: 'greyreach' });
    }
    const forge = anchorById.cinderforge;
    out.push({ x: forge.x + 2, y: forge.y - 3, radius: 9, genre: 'iron', place: 'cinderforge' });
    standingCache = out;
    return out;
  }

  /** Spawn points for today's wild rifts in a chunk (build them with riftgen.wildRift). Never inside the Hearthward. */
  function wildRiftSpawns(cx, cy, day = 0, { wardRadius = 0 } = {}) {
    const rng = createRng(hashInts(S, cx, cy, day, 'wild'));
    const mx = cx * CHUNK + CHUNK / 2;
    const my = cy * CHUNK + CHUNK / 2;
    if (heartDistance(mx, my) < wardRadius - CHUNK) return [];
    const tier = tierAt(mx, my);
    const grey = Math.hypot(mx - anchorById.greyreach.x, my - anchorById.greyreach.y) < anchorById.greyreach.radius * 1.3 ? 0.2 : 0;
    if (!rng.chance(Math.min(0.5, 0.1 + tier * 0.035 + grey))) return [];
    const count = rng.chance(0.15 + tier * 0.02 + grey) ? 2 : 1;
    const out = [];
    for (let k = 0; k < count; k += 1) {
      for (let attempt = 0; attempt < 14; attempt += 1) {
        const x = cx * CHUNK + rng.int(0, CHUNK - 1);
        const y = cy * CHUNK + rng.int(0, CHUNK - 1);
        if (inHeart(x, y) || heartDistance(x, y) <= wardRadius + 2 || !walkable(x, y)) continue;
        const weights = genreWeightsAt(x, y);
        if (!weights) break;
        out.push({ seed: hashInts(S, cx, cy, day, k, 'rift'), x, y, tier: tierAt(x, y), depth: depthAt(x, y), weights });
        break;
      }
    }
    return out;
  }

  // ---------- real rifts on the frontier ----------

  /**
   * Where a real rift opens: on the frontier beyond the Hearthward, facing its genre's region.
   * The more urgent, the closer to the walls. Titans rise from the sea instead.
   */
  function placeRealRift(spec, { urgency = 0.5, wardRadius = 0 } = {}) {
    const rng = createRng(hashInts(spec.seed, 'place'));
    const towards = anchorById[GENRE_DIRECTION[spec.genres[0]]] || anchorById.whisperwood;
    const angle = Math.atan2(towards.y - HEART.cy, towards.x - HEART.cx) + (rng.next() - 0.5) * 0.7;
    const beyond = 3 + (1 - clamp01(urgency)) * 38 + rng.next() * 3;
    const atSea = spec.genres[0] === 'kaiju';
    let x = HEART.cx;
    let y = HEART.cy;
    for (let r = 0; r < 4000; r += 1) {
      x = HEART.cx + Math.cos(angle) * r;
      y = HEART.cy + Math.sin(angle) * r;
      if (heartDistance(x, y) > wardRadius + beyond) break;
    }
    const ok = atSea
      ? (tx, ty) => { const t = terrainAt(tx, ty); return t === T.SEA || t === T.DEEP; }
      : (tx, ty) => !inHeart(tx, ty) && walkable(tx, ty) && heartDistance(tx, ty) > wardRadius;
    const spot = spiral(Math.round(x), Math.round(y), ok) || { x: Math.round(x), y: Math.round(y) };
    return { ...spot, beyond: Math.round(heartDistance(spot.x, spot.y) - wardRadius), towards: towards.id };
  }

  // ---------- names ----------

  function regionAt(x, y) {
    if (inHeart(x, y)) return 'Hearthvale';
    let best = null;
    for (const a of anchors) {
      if (!a.radius || Math.hypot(x - a.x, y - a.y) >= a.radius * 1.7) continue;
      const d = regionDistance(a, x, y);
      if (d < 1.15 && (!best || d < best.d)) best = { d, name: a.name };
    }
    if (best) return best.name;
    // Everywhere else gets a stable name of its own, in cells of 96 tiles.
    const rx = Math.floor(x / 96);
    const ry = Math.floor(y / 96);
    const h = hashInts(S, rx, ry, 'region');
    const first = regionWords.first[h % regionWords.first.length];
    const second = regionWords.second[(h >>> 8) % regionWords.second.length];
    return `the ${first} ${second}`;
  }

  // ---------- chunks ----------

  const chunkCache = new Map();
  /** Terrain codes (row-major) and points of interest for one chunk. */
  function chunk(cx, cy) {
    const k = key(cx, cy);
    if (chunkCache.has(k)) return chunkCache.get(k);
    const tiles = new Uint8Array(CHUNK * CHUNK);
    for (let j = 0; j < CHUNK; j += 1) for (let i = 0; i < CHUNK; i += 1) tiles[j * CHUNK + i] = terrainAt(cx * CHUNK + i, cy * CHUNK + j);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const pois = [
      ...fixedPois().filter((p) => p.x >= x0 && p.y >= y0 && p.x < x0 + CHUNK && p.y < y0 + CHUNK),
      ...chunkPois(cx, cy),
    ];
    const result = { cx, cy, tiles, pois };
    if (chunkCache.size > 512) chunkCache.delete(chunkCache.keys().next().value);
    chunkCache.set(k, result);
    return result;
  }

  return {
    seed: S, anchors, anchorById,
    inHeart, heartDistance, depthAt, tierAt, elevationAt, naturalTerrain, terrainAt, walkable,
    roads, deckAt, fixedPois, chunk, wildRiftSpawns, genreWeightsAt, standingBleeds, placeRealRift, regionAt,
    inWard: (x, y, wardRadius) => heartDistance(x, y) <= wardRadius,
  };
}

// ---------- helpers ----------

function spiral(x0, y0, ok, limit = 60) {
  if (ok(x0, y0)) return { x: x0, y: y0 };
  for (let r = 1; r <= limit; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (const dy of [-r, r]) if (ok(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
    }
    for (let dy = -r + 1; dy <= r - 1; dy += 1) {
      for (const dx of [-r, r]) if (ok(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
    }
  }
  return null;
}

// A road is two tiles wide: its line's own tiles and the ones east and south of each.
const ROAD_LANES = [[0, 0], [1, 0], [0, 1]];

/**
 * layRoad(points, { wet, barred }, visit): a road along points as worldgen lays them (a line
 * between each pair, two tiles wide), except that it only ever crosses water on straight decks.
 * Each stretch of the line with water under any lane is laid instead as one straight deck, or two
 * meeting at a corner (a landing), from the dry ground before it to the dry ground after, by
 * whichever way crosses the least water; and each deck is squared off from bank to bank, so it
 * reads as a clean deck, never a staircase of planks. visit(x, y, deck) gets every tile: deck is
 * 'ns' or 'ew' for a deck (the way it runs, so its planks lie across it), 'x' on the landing where
 * two decks meet, and null for road.
 * wet(x, y) is water a deck may cross; barred(x, y, onLine) is ground no road may take (deep sea,
 * the sky, and the vale where the road's own line would run into it: its second lane may brush
 * the vale's edge, as worldgen's own roads do, and loses those tiles). A stretch that can't keep
 * off it keeps its own line.
 */
export function layRoad(points, { wet, barred = () => false }, visit) {
  const centre = [];
  const push = (x, y) => {
    const last = centre[centre.length - 1];
    if (!last || last[0] !== x || last[1] !== y) centre.push([x, y]);
  };
  if (points.length === 1) push(Math.round(points[0].x), Math.round(points[0].y));
  for (let i = 1; i < points.length; i += 1) line(points[i - 1], points[i], push);
  const laneWet = ([x, y]) => ROAD_LANES.some(([dx, dy]) => wet(x + dx, y + dy));
  const lanes = ([x, y]) => { for (const [dx, dy] of ROAD_LANES) visit(x + dx, y + dy, null); };
  for (let i = 0; i < centre.length;) {
    if (!laneWet(centre[i])) {
      lanes(centre[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < centre.length && laneWet(centre[j + 1])) j += 1;
    if (!centre.slice(i, j + 1).some(([x, y]) => wet(x, y))) {
      // Only the road's edge brushes the water (it runs along a bank): it narrows there rather
      // than stick a plank out over the water.
      for (let k = i; k <= j; k += 1) for (const [dx, dy] of ROAD_LANES) if (!wet(centre[k][0] + dx, centre[k][1] + dy)) visit(centre[k][0] + dx, centre[k][1] + dy, null);
      // and a diagonal step keeps a dry corner to walk round, the lanes' own or the other one
      for (let k = Math.max(0, i - 1); k <= j && k + 1 < centre.length; k += 1) {
        const [ax, ay] = centre[k];
        const [bx, by] = centre[k + 1];
        if (ax === bx || ay === by) continue;
        const corners = [[bx, ay], [ax, by]];
        const dry = corners.filter(([x, y]) => !wet(x, y));
        for (const [x, y] of dry.length ? dry : corners.slice(0, 1)) visit(x, y, null);
      }
      i = j + 1;
      continue;
    }
    const from = centre[i > 0 ? i - 1 : i];
    const to = centre[j + 1 < centre.length ? j + 1 : j];
    if (!layCrossing(from, to, wet, barred, visit)) for (let k = i; k <= j; k += 1) lanes(centre[k]);
    i = j + 1;
  }
}

// One straight leg of a crossing, two tiles wide, from a to b (a row or a column): its tiles in
// order along it, with the stretch from the first to the last one over water marked as deck.
function deckLeg([ax, ay], [bx, by], wet) {
  const across = ay === by; // runs east-west
  const lo = across ? Math.min(ax, bx) : Math.min(ay, by);
  const hi = (across ? Math.max(ax, bx) : Math.max(ay, by)) + 1;
  const steps = [];
  for (let s = lo; s <= hi; s += 1) steps.push(across ? [[s, ay], [s, ay + 1]] : [[ax, s], [ax + 1, s]]);
  const wetAt = steps.map((pair) => pair.some(([x, y]) => wet(x, y)));
  const first = wetAt.indexOf(true);
  const last = wetAt.lastIndexOf(true);
  const dir = across ? 'ew' : 'ns';
  const tiles = [];
  steps.forEach((pair, s) => {
    const deck = first >= 0 && s >= first && s <= last ? dir : null;
    pair.forEach(([x, y], lane) => tiles.push([x, y, deck, lane === 0 && s < steps.length - 1]));
  });
  return { tiles, deck: first >= 0 ? (last - first + 1) * 2 : 0 };
}

function layCrossing([ax, ay], [bx, by], wet, barred, visit) {
  let routes;
  if (ax === bx || ay === by) routes = [[[ax, ay], [bx, by]]];
  else {
    const xFirst = [[ax, ay], [bx, ay], [bx, by]];
    const yFirst = [[ax, ay], [ax, by], [bx, by]];
    routes = Math.abs(bx - ax) >= Math.abs(by - ay) ? [xFirst, yFirst] : [yFirst, xFirst];
  }
  let best = null;
  for (const route of routes) {
    const legs = [];
    for (let k = 1; k < route.length; k += 1) legs.push(deckLeg(route[k - 1], route[k], wet));
    if (legs.some((leg) => leg.tiles.some(([x, y, , onLine]) => barred(x, y, onLine)))) continue;
    let water = legs.reduce((n, leg) => n + leg.deck, 0);
    // two decks meeting on a landing out in the water: a little worse than a corner on the bank
    if (legs.length === 2 && legs[0].deck && legs[1].deck) water += 3;
    if (!best || water < best.water) best = { legs, water, route };
  }
  if (!best) return false;
  // Where both decks come to the corner, its square is the landing they meet on.
  let landing = null;
  if (best.legs.length === 2) {
    const [cx, cy] = best.route[1];
    const inSquare = (x, y) => x >= cx && x <= cx + 1 && y >= cy && y <= cy + 1;
    const reaches = (leg) => leg.tiles.some(([x, y, deck]) => deck && inSquare(x, y));
    if (reaches(best.legs[0]) && reaches(best.legs[1])) landing = inSquare;
  }
  for (const leg of best.legs) for (const [x, y, deck] of leg.tiles) visit(x, y, landing && landing(x, y) ? 'x' : deck);
  return true;
}

function line(a, b, visit) {
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
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// A* over the coarse road grid. Existing road cells are cheaper, so roads merge into a network.
function astar(start, goal, GW, GH, cost, used) {
  const idx = (c) => c.gy * GW + c.gx;
  const open = new MinHeap();
  const g = new Float32Array(GW * GH).fill(Infinity);
  const came = new Int32Array(GW * GH).fill(-1);
  g[idx(start)] = 0;
  open.push(idx(start), 0);
  const goalIdx = idx(goal);
  const h = (i) => Math.hypot((i % GW) - goal.gx, Math.floor(i / GW) - goal.gy) * 0.55;
  while (open.size) {
    const current = open.pop();
    if (current === goalIdx) break;
    const cx = current % GW;
    const cy = Math.floor(current / GW);
    for (const [dx, dy, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      const stepCost = n === goalIdx ? 1 : (used[n] ? 0.55 : cost[n]);
      if (!Number.isFinite(stepCost)) continue;
      const next = g[current] + stepCost * len;
      if (next < g[n]) {
        g[n] = next;
        came[n] = current;
        open.push(n, next + h(n));
      }
    }
  }
  const path = [];
  for (let i = goalIdx; i !== -1; i = came[i]) {
    path.push({ gx: i % GW, gy: Math.floor(i / GW) });
    if (i === idx(start)) break;
  }
  return path.reverse();
}

class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, priority) {
    const items = this.items;
    const prio = this.prio;
    items.push(item);
    prio.push(priority);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= prio[i]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      [prio[parent], prio[i]] = [prio[i], prio[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const prio = this.prio;
    const top = items[0];
    const lastItem = items.pop();
    const lastPrio = prio.pop();
    if (items.length) {
      items[0] = lastItem;
      prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && prio[l] < prio[m]) m = l;
        if (r < items.length && prio[r] < prio[m]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        [prio[m], prio[i]] = [prio[i], prio[m]];
        i = m;
      }
    }
    return top;
  }
}
