// Caves (CONTRACT-PHASE4.md §3.1, §7.7; COMBAT.md §8.5): a cave mouth in the wilds opens onto a
// scene of its own (`kind: 'cave'`): no rift, no stitch, no Tale-lead and no nook, and economy.json's
// `spend.cave` Embers to go in. Its layout is riftgen's carving on the cave's own seed tag, and its
// rooms fill from the
// nearest region's creatures and canon foes (encounters.prepareCave, D). Nothing in worldgen moves:
// a cave is read off a point of interest that was always there.
// Pure and deterministic: no clock, no randomness but seeded hashes, no DOM. Runs in Node.
import { hashInts } from './rng.js';

/**
 * Which creatures and canon foes live in each region's caves (COMBAT §8.5, the ids of
 * content/combat/foes.json's `caves`). `foes.caves` wins when it's given to caveSpec.
 */
export const CAVE_CREATURES = Object.freeze({
  cinderforge: Object.freeze(['cinder-beetles', 'cinder-golems']),
  'glass-fen': Object.freeze(['glass-eels', 'fen-herons']),
  'archive-peaks': Object.freeze(['inkwyrms', 'unwritten']),
  mistmere: Object.freeze(['kite-crabs', 'fog-seals']),
  whisperwood: Object.freeze(['murmurs', 'fetchfoxes']),
  'dicing-downs': Object.freeze(['dicing-frogs']),
  'skyward-isles': Object.freeze(['sky-rays']),
  greyreach: Object.freeze(['hush-hounds']),
});

/**
 * Regions with no creatures of their own borrow a listed region's (**Decided**, §9.8): the Painted
 * Hills Mistmere's and the Ivory College the Glass Fen's, until their own are written; Hearthvale
 * the nearest listed region's (Mistmere's) and the Far Shore Cinderforge's, as foes.json's `borrow`
 * has them. Any other region with no list uses the nearest listed region, anchor to anchor.
 */
export const CAVE_BORROW = Object.freeze({ hearthvale: 'mistmere', 'painted-hills': 'mistmere', 'ivory-college': 'glass-fen', 'far-shore': 'cinderforge' });

/** A cave's stage by its tier: hairline at tiers 1–3, open from 4 (**Decided**, §7.7). */
export const stageForTier = (tier) => (Number(tier) >= 4 ? 'open' : 'hairline');

// Short region names for a cave's label ('A cave mouth · Cinderforge side').
const SHORT = Object.freeze({
  whisperwood: 'Whisperwood', mistmere: 'Mistmere', 'painted-hills': 'Painted Hills', 'ivory-college': 'Ivory College',
  'dicing-downs': 'Dicing Downs', cinderforge: 'Cinderforge', 'glass-fen': 'Glass Fen', 'archive-peaks': 'Archive Peaks',
  greyreach: 'Greyreach', 'skyward-isles': 'Skyward Isles', 'far-shore': 'Far Shore', hearthvale: 'Hearthvale',
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};
/** 'The Whisperwood' → 'the Whisperwood', for the middle of a sentence. */
const inSentence = (name) => String(name).replace(/^The /, 'the ');

/**
 * The region a cave belongs to: the story region whose anchor is nearest by the wilds' own
 * regionDistance (the ragged, warped reach worldgen draws its regions with), wherever the cave
 * is, out in the unnamed wilds included. Regions with no reach (Hearthvale) never count.
 */
export function caveRegion(x, y, { worldgen, wilds }) {
  const anchors = (worldgen?.anchors || []).filter((a) => a.radius > 0);
  const distance = typeof wilds?.regionDistance === 'function'
    ? (a) => wilds.regionDistance(a, x, y)
    : (a) => Math.hypot(x - a.x, y - a.y) / a.radius;
  let best = null;
  for (const a of anchors) {
    const d = distance(a);
    if (!best || d < best.d || (d === best.d && a.id < best.id)) best = { id: a.id, d };
  }
  return best ? best.id : 'whisperwood';
}

/**
 * The creature and foe ids a region's caves draw from: its own list, else the borrowed one, else
 * the list of the nearest region that has one (anchor to anchor). `lists` and `borrow` are
 * foes.json's `caves` and `borrow`, or CAVE_CREATURES and CAVE_BORROW.
 */
export function creaturesFor(region, { worldgen = null, lists = CAVE_CREATURES, borrow = CAVE_BORROW } = {}) {
  const table = isRecord(lists) ? lists : CAVE_CREATURES;
  const listed = (id) => Array.isArray(table[id]) && table[id].length > 0;
  if (listed(region)) return [...table[region]];
  const borrowed = (isRecord(borrow) ? borrow : CAVE_BORROW)[region];
  if (borrowed && listed(borrowed)) return [...table[borrowed]];
  const anchors = worldgen?.anchors || [];
  const from = anchors.find((a) => a.id === region);
  if (from) {
    const nearest = anchors.filter((a) => a.id !== region && listed(a.id))
      .map((a) => ({ id: a.id, d: Math.hypot(a.x - from.x, a.y - from.y) }))
      .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))[0];
    if (nearest) return [...table[nearest.id]];
  }
  const first = Object.keys(table).find(listed);
  return first ? [...table[first]] : [];
}

/** A MILO day number (clean.js dayNumber), or null: a whole number 0…1e8, as D's caveDay and A's cleaner take it. */
const dayOf = (day) => (Number.isInteger(day) && day >= 0 && day <= 1e8 ? day : null);

/**
 * A cave's spec, from its point of interest (§7.7): { id: 'cave:<x>,<y>', seed: hashInts(S, x, y,
 * 'cave'), kind: 'cave', x, y, tier (worldgen.tierAt of its tile), depth, stage, region, name,
 * genres: [], affixes: [], strays: [], taleLead: null, loot: [], creatures, day }. `name` says where
 * it is ('A cave in the Whisperwood'); `creatures` are the ids its rooms draw from (foes.json's
 * `caves` and `borrow` when `foes` is given, else CAVE_CREATURES and CAVE_BORROW). Deeply frozen.
 * null for anything but a cave.
 * `day` (§18.2 item 3) is the MILO day number at entry (clean.js dayNumber(now)): L1 stores it in
 * the expedition's source at entry and passes it on every rebuild (caveSource, caveFromSource), and
 * encounters.prepareCave reads `cave.day` for its fight ids. null when it isn't a whole day number,
 * and prepareCave then refuses, as it should: a cave's rooms reset each real day.
 * `words` (riftgen.json) is accepted for the contract's signature; nothing here needs it yet.
 */
export function caveSpec(poi, { worldgen, wilds, words = null, foes = null, day = null } = {}) { // eslint-disable-line no-unused-vars
  if (!isRecord(poi) || poi.type !== 'cave' || !Number.isInteger(poi.x) || !Number.isInteger(poi.y)) return null;
  if (!worldgen || typeof worldgen.tierAt !== 'function') return null;
  const { x, y } = poi;
  const tier = worldgen.tierAt(x, y);
  const depth = Number.isInteger(poi.depth) && poi.depth > 0 ? poi.depth : worldgen.depthAt(x, y);
  const region = caveRegion(x, y, { worldgen, wilds });
  const place = typeof worldgen.regionAt === 'function' ? worldgen.regionAt(x, y) : null;
  return deepFreeze({
    id: `cave:${x},${y}`,
    seed: hashInts(worldgen.seed >>> 0, x, y, 'cave'),
    kind: 'cave',
    x,
    y,
    tier,
    depth,
    stage: stageForTier(tier),
    region,
    name: place ? `A cave in ${inSentence(place)}` : 'A cave mouth',
    genres: [],
    affixes: [],
    strays: [],
    taleLead: null,
    loot: [],
    creatures: creaturesFor(region, {
      worldgen,
      lists: isRecord(foes?.caves) ? foes.caves : CAVE_CREATURES,
      borrow: isRecord(foes?.borrow) ? foes.borrow : CAVE_BORROW,
    }),
    day: dayOf(day),
  });
}

/** The cave's layout: riftgen.layout on the cave's own seed, stage and depth, with no affixes. */
export function caveLayout(cave, riftgen) {
  if (!isRecord(cave) || !riftgen || typeof riftgen.layout !== 'function') return null;
  return riftgen.layout({ seed: cave.seed, stage: cave.stage, depth: cave.depth, affixes: [] });
}

/** The label a cave shows on hover and as its panel's title: 'A cave mouth · Cinderforge side'. */
export function caveLabel(cave) {
  const side = SHORT[cave?.region];
  return side ? `A cave mouth · ${side} side` : 'A cave mouth';
}

/**
 * The panel id of a cave (§12.3): 'cave:<x>,<y>', the same as its spec's id, and the id the
 * expedition keeps as `riftId` (§18.2 item 3).
 */
export const cavePanelId = (poi) => `cave:${poi.x},${poi.y}`;

/**
 * The wilds' own place id of a cave's point of interest, 'poi:cave:<x>,<y>' (wilds.js poiId), from
 * the point of interest or the cave's spec: what the expedition keeps as `source.poi` (§18.2 item 3).
 */
export const cavePoiId = (cave) => `poi:cave:${cave.x},${cave.y}`;

const CAVE_POI_ID = /^poi:cave:(-?\d{1,7}),(-?\d{1,7})$/;

/**
 * The expedition's `source` for a cave (§8.3 with §18.2 item 3), taken at entry:
 * { poi: 'poi:cave:<x>,<y>', day }. Everything else about the cave is rebuilt from these two.
 * null for anything but a cave spec with a day.
 */
export function caveSource(cave) {
  if (!isRecord(cave) || cave.kind !== 'cave' || !Number.isInteger(cave.x) || !Number.isInteger(cave.y) || dayOf(cave.day) === null) return null;
  return { poi: cavePoiId(cave), day: cave.day };
}

/**
 * A cave rebuilt from the expedition's `source` ({ poi, day }), for a resume or *Try again*: the
 * same CaveSpec caveSpec gave at entry, day and all, from nothing but the source and the world.
 * null when the source isn't a cave's.
 */
export function caveFromSource(source, { worldgen, wilds, words = null, foes = null } = {}) {
  const m = isRecord(source) && typeof source.poi === 'string' ? CAVE_POI_ID.exec(source.poi) : null;
  if (!m || dayOf(source.day) === null) return null;
  return caveSpec({ type: 'cave', x: Number(m[1]), y: Number(m[2]) }, { worldgen, wilds, words, foes, day: source.day });
}
