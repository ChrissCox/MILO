// The Hushlands beyond Hearthvale (WORLD.md): an endless, seeded world that keeps to the story.
// Hearthvale (src/world/map.js) sits untouched at the centre and is always sanctuary. The
// story's regions are anchored around it in the order of the Long Road, with roads between
// them; everything else (coasts, forests, rivers, ruins, caves, lanterns, far lands, wild
// rifts) comes from the seed, chunk by chunk, forever. Pure and deterministic; runs in Node.
import { MAP } from './map.js';
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
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const key = (x, y) => `${x},${y}`;

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

  function elevationAt(x, y) {
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

  function naturalTerrain(x, y) {
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
    // The story's regions.
    for (const a of anchors) {
      if (a.biome === null) continue;
      if (Math.hypot(x - a.x, y - a.y) >= a.radius * 1.7) continue;
      const d = regionDistance(a, x, y);
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
    // Rivers wind through the lowlands.
    if (LAND.has(terrain) && e < 0.72 && ridged(x / 150, y / 150, S + 41, { octaves: 3 }) > 0.986) terrain = T.RIVER;
    return terrain;
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
        cellCost[gy * GW + gx] = inHeart(tx, ty) ? Infinity : TERRAIN_INFO[naturalTerrain(tx, ty)].cost;
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
      const points = [a, ...cells.map((c) => ({ x: minX + c.gx * CELL + 2, y: minY + c.gy * CELL + 2 })), b];
      // Roads from the vale start right at its gate.
      if (GATES[from]) points.unshift(gatePoint(GATES[from], 1));
      paths.push({ from, to, points });
    }
    // Rasterise: connect consecutive points tile by tile, two tiles wide.
    const tiles = new Set();
    for (const p of paths) {
      for (let i = 1; i < p.points.length; i += 1) {
        line(p.points[i - 1], p.points[i], (x, y) => {
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) if (!inHeart(x + dx, y + dy)) tiles.add(key(x + dx, y + dy));
        });
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
    roadCache = { paths, tiles, westwatch, lanterns };
    return roadCache;
  }

  /** The final terrain at a tile, roads and all. Hearthvale's own tiles are always HEART. */
  function terrainAt(x, y) {
    if (inHeart(x, y)) return T.HEART;
    const natural = naturalTerrain(x, y);
    if (roads().tiles.has(key(x, y))) {
      // Rivers and the odd inlet get a bridge or a boardwalk; open sea and sky never do.
      if (natural === T.RIVER || natural === T.SEA) return T.BRIDGE;
      if (natural !== T.DEEP && natural !== T.SKY) return T.ROAD;
    }
    return natural;
  }
  const walkable = (x, y) => (inHeart(x, y) ? true : TERRAIN_INFO[terrainAt(x, y)].walk);
  const isWater = (x, y) => { const t = terrainAt(x, y); return t === T.SEA || t === T.DEEP; };

  // ---------- points of interest ----------

  let fixedCache = null;
  function fixedPois() {
    if (fixedCache) return fixedCache;
    const onLand = (x, y) => !inHeart(x, y) && walkable(x, y);
    const snap = (x, y, ok = onLand) => spiral(Math.round(x), Math.round(y), ok) || { x: Math.round(x), y: Math.round(y) };
    const list = roads().lanterns.map((l) => ({ ...l, ...snap(l.x, l.y) }));
    const ww = roads().westwatch;
    list.push({ type: 'landmark', ...snap(ww.x, ww.y), name: 'The Westwatch', note: 'On clear nights the Great Lighthouse can be seen turning, far across the sea.' });
    // Captain Sloe's quay is in Mistmere Harbor, on the water's edge (LORE.md).
    const mm = anchorById.mistmere;
    const shoreline = (x, y) => onLand(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWater(x + dx, y + dy));
    list.push({ type: 'quay', ...snap(mm.x, mm.y, shoreline), name: "Captain Sloe's ferry quay", region: 'mistmere' });
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
        else if (roll < 0.085) out.push({ type: 'chest', x, y, name: rng.chance(0.12) ? 'A suspiciously friendly chest' : 'An old chest', mimic: rng.chance(0.12), depth });
        else if (roll < 0.1 && onRoad) out.push({ type: 'note', x, y, name: 'A note from the Old Company', depth });
        else if (roll < 0.108 && (onRoad || terrain === T.GRASS)) out.push({ type: 'hamlet', x, y, name: `${rng.pick(regionWords.first)} Hamlet`, depth });
        else if (roll < 0.14) out.push({ type: rng.pick(['ore', 'herbs', 'fishing']), x, y, name: 'Resources', depth });
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
    roads, fixedPois, chunk, wildRiftSpawns, genreWeightsAt, standingBleeds, placeRealRift, regionAt,
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
