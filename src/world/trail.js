// The first Riddle Note trail and the Last Bridge (CONTRACT-PHASE4.md §3.1, §7.7, §9.12, §17 items 9 and 21).
// Tamsin's Riddle Notes lead Chris through MILO features one step at a time, and the first trail
// ends at the Last Bridge over the Murmur, at the Whisperwood's southern edge, where the Tollkeeper
// waits with three riddles. The bridge is an overlay: worldgen's own output never changes, and the
// bridge is found in it by a fixed rule (lastBridge). Progress lives in state.story.trails.
// Pure and deterministic: no clock (`now` is passed in), no randomness, no DOM. Runs in Node.
import { GATES, HEART, DECK_CLEAR, TERRAIN as T, TERRAIN_INFO } from './worldgen.js';
import { PLACES } from './map.js';
import { hashInts } from './rng.js';

/** How a step is solved (trails.json `solve.kind`). */
export const STEP_KINDS = Object.freeze(['feature', 'visit', 'examine', 'read']);

/** MILO features a step can ask for (`solve.target` of a feature step; tally.features' ids). */
export const FEATURES = Object.freeze(['kindle', 'rest', 'chronicle', 'command', 'examine', 'muster', 'fight', 'talk-down', 'map',
  'skills', 'war-table', 'ward', 'stitch', 'step-through', 'lantern', 'notebook']);

/** What a `read` step can ask Milo to open. */
export const READ_TARGETS = Object.freeze(['note', 'tablet', 'letter', 'ruin', 'statue']);

export const LAST_BRIDGE_ID = 'landmark:last-bridge';
export const TOLLKEEPER_ID = 'landmark:tollkeeper';

/**
 * The Last Bridge's placement rule (§7.7). ROAD_WEIGHT is the "one number" of §17.21: raise it and
 * the bridge moves toward where the north road enters the wood.
 * - region: the wood whose southern edge it stands at; edge: how far from that edge (tiles).
 * - deck: a crossing's river tiles, at least and at most.
 * - valeClear: every tile of it at least this far from the vale (so it's out at the wood, not by the walls).
 * - roadClear: no road or bridge tile this near any of its tiles (it's never on the road, unless dry).
 * - poiClear: no point of interest this near (their props would stand on the Tollkeeper's tile).
 * - dryDeck: a dry footbridge's length on the north road.
 */
export const LAST_BRIDGE_RULE = Object.freeze({
  region: 'whisperwood', edge: 16, roadWeight: 0.25, deck: [1, 5], valeClear: 12, roadClear: 3, poiClear: 3, dryDeck: 3,
});
export const ROAD_WEIGHT = LAST_BRIDGE_RULE.roadWeight;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const WATER = new Set([T.RIVER, T.SEA, T.DEEP]);
const ROADISH = new Set([T.ROAD, T.BRIDGE]);
const key = (x, y) => `${x},${y}`;
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

// ---------------------------------------------------------------------------
// The Last Bridge.

/** Where the north road (gate:n to the Whisperwood) first crosses the wood's radius, or null. */
export function northRoadEntry(worldgen) {
  const anchor = worldgen?.anchorById?.[LAST_BRIDGE_RULE.region];
  const path = worldgen?.roads?.().paths.find((p) => p.from === 'gate:n' && p.to === LAST_BRIDGE_RULE.region);
  if (!anchor || !path || path.points.length < 2) return null;
  const r = anchor.radius;
  const dist = (p) => Math.hypot(p.x - anchor.x, p.y - anchor.y);
  for (let i = 1; i < path.points.length; i += 1) {
    const p = path.points[i - 1];
    const q = path.points[i];
    const dp = dist(p);
    const dq = dist(q);
    if (dp >= r && dq <= r) {
      const k = dp === dq ? 0 : (dp - r) / (dp - dq);
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    }
  }
  // The road never crosses the edge (it starts inside it): its point nearest the edge.
  let best = path.points[0];
  for (const p of path.points) if (Math.abs(dist(p) - r) < Math.abs(dist(best) - r)) best = p;
  return { x: best.x, y: best.y };
}

/**
 * The Last Bridge, found in worldgen's own world (§7.7): the short river crossing (1–5 river tiles
 * in a straight line, walkable land at both ends) whose midpoint scores lowest on
 * |distance to the Whisperwood's anchor − its radius| + ROAD_WEIGHT × distance to where the north
 * road crosses that radius, among crossings south of the anchor within 16 tiles of the edge; ties
 * by hashInts(S, x, y, 'last-bridge') on the middle deck tile. A crossing only counts when:
 * - its far end is in the wood (worldgen.regionAt names the Whisperwood) and its near end, the one
 *   nearer the vale, is `stand`, where the Tollkeeper waits;
 * - `stand` has water beside it to the west, east or south, so the wilds never grow a tree, bush
 *   or rock on it (wilds.js keeps every blocking prop off such tiles), and it has dry land to step
 *   onto besides the deck;
 * - every tile is VALE_CLEAR from the vale, ROAD_CLEAR from any road or bridge (it's never on the
 *   road) and POI_CLEAR from any point of interest, fixed or not (so no prop stands on it, and no
 *   fixed place stands within DECK_CLEAR of its deck).
 * With none, it's a dry footbridge on the north road nearest that crossing point (`dry: true`),
 * its deck and `stand` on road tiles. A river deck is drawn, not walked, in Phase 4 (it's river
 * underneath, never walkable, and its Examine says it waits for the wood to wake). A dry one stays
 * road, walked like the rest of the north road so the road stays open, with Examine lines of its own
 * (bridgeExamineVariant); nothing may block its deck or its stand.
 * → { id: 'landmark:last-bridge', x, y (the middle deck tile), deck: [{ x, y }] (west to east or
 *     north to south), stand: { x, y }, dir: 'h' | 'v' (the way the deck runs), dry }. Frozen.
 */
export function lastBridge(worldgen) {
  if (!worldgen || typeof worldgen.terrainAt !== 'function') return null;
  const rule = LAST_BRIDGE_RULE;
  const anchor = worldgen.anchorById?.[rule.region];
  if (!anchor) return null;
  const S = worldgen.seed >>> 0;
  const entry = northRoadEntry(worldgen) || { x: anchor.x, y: anchor.y + anchor.radius };
  const r = anchor.radius;
  const terrain = (x, y) => (worldgen.inHeart(x, y) ? T.HEART : worldgen.terrainAt(x, y));
  const land = (x, y) => { const t = terrain(x, y); return t !== T.HEART && !ROADISH.has(t) && TERRAIN_INFO[t].walk; };
  const river = (x, y) => terrain(x, y) === T.RIVER;
  const wet = (x, y) => WATER.has(terrain(x, y));
  const valeDist = (p) => Math.hypot(p.x - HEART.cx, p.y - HEART.cy);

  const candidates = [];
  const x0 = Math.floor(anchor.x - r - rule.edge - 1);
  const x1 = Math.ceil(anchor.x + r + rule.edge + 1);
  const y0 = Math.floor(anchor.y);
  const y1 = Math.ceil(anchor.y + r + rule.edge + 1);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!land(x, y)) continue;
      for (const [dx, dy, dir] of [[1, 0, 'h'], [0, 1, 'v']]) {
        let n = 0;
        while (n <= rule.deck[1] && river(x + dx * (n + 1), y + dy * (n + 1))) n += 1;
        if (n < rule.deck[0] || n > rule.deck[1]) continue;
        const end = { x: x + dx * (n + 1), y: y + dy * (n + 1) };
        if (!land(end.x, end.y)) continue;
        const mid = { x: x + (dx * (n + 1)) / 2, y: y + (dy * (n + 1)) / 2 };
        if (mid.y <= anchor.y) continue;
        const off = Math.abs(Math.hypot(mid.x - anchor.x, mid.y - anchor.y) - r);
        if (off > rule.edge) continue;
        const deck = Array.from({ length: n }, (_, k) => ({ x: x + dx * (k + 1), y: y + dy * (k + 1) }));
        const ends = [{ x, y }, end];
        if ([...ends, ...deck].some((p) => worldgen.heartDistance(p.x, p.y) < rule.valeClear)) continue;
        const first = valeDist(ends[0]);
        const second = valeDist(ends[1]);
        const nearFirst = first < second || (first === second && (ends[0].y > ends[1].y || (ends[0].y === ends[1].y && ends[0].x > ends[1].x)));
        const [near, far] = nearFirst ? ends : [ends[1], ends[0]];
        if (!(wet(near.x - 1, near.y) || wet(near.x + 1, near.y) || wet(near.x, near.y + 1))) continue;
        if (worldgen.regionAt(far.x, far.y) !== anchor.name) continue;
        const middle = deck[Math.floor(deck.length / 2)];
        const score = off + rule.roadWeight * Math.hypot(mid.x - entry.x, mid.y - entry.y);
        candidates.push({ score, tie: hashInts(S, middle.x, middle.y, 'last-bridge'), deck, near, far, middle, dir });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.tie - b.tie);

  const fixed = typeof worldgen.fixedPois === 'function' ? worldgen.fixedPois() : [];
  const chunkPois = new Map();
  const poisNear = (tiles, clear) => {
    const xs = tiles.map((p) => p.x);
    const ys = tiles.map((p) => p.y);
    const bx0 = Math.min(...xs) - clear;
    const bx1 = Math.max(...xs) + clear;
    const by0 = Math.min(...ys) - clear;
    const by1 = Math.max(...ys) + clear;
    const near = (p) => tiles.some((t) => Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= clear);
    if (fixed.some(near)) return true;
    if (typeof worldgen.chunk !== 'function') return false;
    const size = 32;
    for (let cy = Math.floor(by0 / size); cy <= Math.floor(by1 / size); cy += 1) {
      for (let cx = Math.floor(bx0 / size); cx <= Math.floor(bx1 / size); cx += 1) {
        const k = key(cx, cy);
        if (!chunkPois.has(k)) chunkPois.set(k, worldgen.chunk(cx, cy).pois);
        if (chunkPois.get(k).some(near)) return true;
      }
    }
    return false;
  };
  const roadNear = (tiles, clear) => tiles.some((p) => {
    for (let dy = -clear; dy <= clear; dy += 1) {
      for (let dx = -clear; dx <= clear; dx += 1) if (ROADISH.has(terrain(p.x + dx, p.y + dy))) return true;
    }
    return false;
  });
  const deckSet = (deck) => new Set(deck.map((p) => key(p.x, p.y)));
  const hasFooting = (stand, deck) => {
    const onDeck = deckSet(deck);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !onDeck.has(key(stand.x + dx, stand.y + dy)) && land(stand.x + dx, stand.y + dy));
  };

  for (const c of candidates) {
    const tiles = [c.near, ...c.deck, c.far];
    if (!hasFooting(c.near, c.deck)) continue;
    if (roadNear(tiles, rule.roadClear)) continue;
    if (poisNear(tiles, rule.poiClear)) continue;
    return deepFreeze({ id: LAST_BRIDGE_ID, x: c.middle.x, y: c.middle.y, deck: c.deck.map((p) => ({ ...p })), stand: { ...c.near }, dir: c.dir, dry: false });
  }
  return dryBridge(worldgen, entry, { terrain, poisNear, S });
}

// The fallback: a footbridge on the north road, as near where it enters the wood as the road
// allows, clear of real bridges and of the lanterns by the road.
function dryBridge(worldgen, entry, { terrain, poisNear, S }) {
  const rule = LAST_BRIDGE_RULE;
  const path = worldgen.roads().paths.find((p) => p.from === 'gate:n' && p.to === rule.region);
  const line = [];
  const seen = new Set();
  const points = path ? path.points : [];
  for (let i = 1; i < points.length; i += 1) {
    const a = { x: Math.round(points[i - 1].x), y: Math.round(points[i - 1].y) };
    const b = { x: Math.round(points[i].x), y: Math.round(points[i].y) };
    const dir = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) ? 'v' : 'h';
    bresenham(a, b, (x, y) => {
      if (seen.has(key(x, y))) return;
      seen.add(key(x, y));
      line.push({ x, y, dir });
    });
  }
  const valeDist = (p) => Math.hypot(p.x - HEART.cx, p.y - HEART.cy);
  const order = line
    .map((p) => ({ ...p, d: Math.hypot(p.x - entry.x, p.y - entry.y), tie: hashInts(S, p.x, p.y, 'last-bridge') }))
    .sort((a, b) => a.d - b.d || a.tie - b.tie);
  const shape = (p) => {
    const [dx, dy] = p.dir === 'v' ? [0, 1] : [1, 0];
    const half = Math.floor(rule.dryDeck / 2);
    const deck = Array.from({ length: rule.dryDeck }, (_, k) => ({ x: p.x + dx * (k - half), y: p.y + dy * (k - half) }));
    const ends = [{ x: deck[0].x - dx, y: deck[0].y - dy }, { x: deck[deck.length - 1].x + dx, y: deck[deck.length - 1].y + dy }];
    const stand = valeDist(ends[1]) <= valeDist(ends[0]) ? ends[1] : ends[0];
    return { deck, stand, middle: deck[half], dir: p.dir };
  };
  const onRoad = (q) => !worldgen.inHeart(q.x, q.y) && terrain(q.x, q.y) === T.ROAD;
  const bridgeNear = (tiles, clear) => tiles.some((q) => {
    for (let dy = -clear; dy <= clear; dy += 1) for (let dx = -clear; dx <= clear; dx += 1) if (terrain(q.x + dx, q.y + dy) === T.BRIDGE) return true;
    return false;
  });
  const build = (b) => deepFreeze({ id: LAST_BRIDGE_ID, x: b.middle.x, y: b.middle.y, deck: b.deck, stand: b.stand, dir: b.dir, dry: true });
  // Strictest first: on the road, away from the vale, clear of bridges and of every place.
  for (const p of order) {
    const b = shape(p);
    const tiles = [...b.deck, b.stand];
    if (!tiles.every(onRoad) || tiles.some((q) => worldgen.heartDistance(q.x, q.y) < rule.valeClear)) continue;
    if (bridgeNear(tiles, DECK_CLEAR) || poisNear(b.deck, DECK_CLEAR)) continue;
    return build(b);
  }
  for (const p of order) {
    const b = shape(p);
    if ([...b.deck, b.stand].every(onRoad)) return build(b);
  }
  const p = order[0] || { x: GATES['gate:n'].edge.x, y: GATES['gate:n'].edge.y - 6, dir: 'v' };
  return build(shape(p));
}

function bresenham(a, b, visit) {
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = -Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 === b.x && y0 === b.y) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * The landmarks for world.setLandmarks (§11.3): the Last Bridge and the Tollkeeper at its stand.
 * `joined`: the Tollkeeper has joined the Company, so the bridge stands alone (he comes by lantern
 * at dusk instead, COMBAT §2.2). Each also carries `dry` (added to §11.3's shape): a dry
 * footbridge's deck and stand are road tiles, so the engine keeps both walkable (the north road
 * stays open), and its Examine uses things.last-bridge's `opened` lines (bridgeExamineVariant).
 */
export function bridgeLandmarks(bridge, { joined = false } = {}) {
  if (!bridge) return [];
  const dry = bridge.dry === true;
  const out = [{ id: LAST_BRIDGE_ID, kind: 'last-bridge', x: bridge.x, y: bridge.y, deck: bridge.deck, dir: bridge.dir, label: 'The Last Bridge', dry }];
  if (!joined) out.push({ id: TOLLKEEPER_ID, kind: 'tollkeeper', x: bridge.stand.x, y: bridge.stand.y, deck: null, dir: bridge.dir, label: 'The Tollkeeper', dry });
  return out;
}

/**
 * The examine.json variant of `things.last-bridge` for a bridge (§9.12's "the thing's state"):
 * 'sleeping' over its river (the deck waits for the wood to wake, §17.9), 'opened' for the dry
 * footbridge, whose deck is the north road and is walked like the rest of it.
 */
export function bridgeExamineVariant(bridge) {
  return bridge?.dry === true ? 'opened' : 'sleeping';
}

// ---------------------------------------------------------------------------
// Places a trail step can name.

const VALE_PLACE_IDS = Object.freeze(PLACES.map((p) => p.id));
const GATE_IDS = Object.freeze(Object.keys(GATES));

/**
 * Whether `target` is a place a visit step can name: only what placeAt can return (a vale place,
 * a gate, the Last Bridge), so every visit step can be walked to and done.
 */
export function isVisitPlace(target) {
  return typeof target === 'string' && (VALE_PLACE_IDS.includes(target) || GATE_IDS.includes(target) || target === LAST_BRIDGE_ID);
}

/**
 * Whether `target` is a real thing an examine step can name: any visit place, and also the War
 * Table and the Tollkeeper, which are examined but never stood on (placeAt never returns them).
 */
export function isPlace(target) {
  return isVisitPlace(target) || target === 'war-table' || target === TOLLKEEPER_ID;
}

/** Whether a step's solve ({ kind, target }) names something that exists and can be done. */
export function solveKnown(solve) {
  if (!isRecord(solve) || typeof solve.target !== 'string') return false;
  switch (solve.kind) {
    case 'feature': return FEATURES.includes(solve.target);
    case 'visit': return isVisitPlace(solve.target);
    case 'examine': return isPlace(solve.target);
    case 'read': return READ_TARGETS.includes(solve.target);
    default: return false;
  }
}

/**
 * The place a world tile counts as a visit to, for `onSceneStep` (§11.2) → a place id or null:
 * the Last Bridge within 2 tiles of its stand or 1 of its deck (the Tollkeeper stands on the stand
 * itself), a gate on its tile or the tile just inside it, a vale place inside its area.
 */
export function placeAt(tile, { bridge = null } = {}) {
  if (!isRecord(tile) || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) return null;
  const { x, y } = tile;
  if (bridge) {
    const cheb = (p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    if (cheb(bridge.stand) <= 2 || bridge.deck.some((p) => cheb(p) <= 1)) return LAST_BRIDGE_ID;
  }
  for (const [id, g] of Object.entries(GATES)) {
    if ((x === g.edge.x && y === g.edge.y) || (x === g.edge.x + g.dir.x && y === g.edge.y + g.dir.y)) return id;
  }
  for (const place of PLACES) {
    const a = place.area;
    if (x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h) return place.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Progress (state.story.trails, §8.2).

const trailList = (trails) => (isRecord(trails) && Array.isArray(trails.trails) ? trails.trails.filter((t) => isRecord(t) && typeof t.id === 'string' && Array.isArray(t.steps)) : []);
const savedTrails = (state) => (isRecord(state?.story?.trails) ? state.story.trails : {});
const timeOf = (value) => (finite(value) ? value : null);

function progressOf(state, trailId) {
  const saved = savedTrails(state)[trailId];
  const map = (value) => (isRecord(value) ? value : {});
  return { found: map(saved?.found), done: map(saved?.done), joinedAt: timeOf(saved?.joinedAt) };
}

/**
 * The state with a trail's progress written. Only markJoined passes `joinedAt` (§18.2 item 13: it
 * is the one writer of a join); every other write keeps the saved one as it is, and a new entry
 * starts with `joinedAt: null`, the shape A's cleaner keeps.
 */
function withProgress(state, trailId, progress) {
  const story = isRecord(state.story) ? state.story : {};
  const saved = isRecord(story.trails) ? story.trails : {};
  const before = isRecord(saved[trailId]) ? saved[trailId] : {};
  const joinedAt = Object.hasOwn(progress, 'joinedAt') ? progress.joinedAt : Object.hasOwn(before, 'joinedAt') ? before.joinedAt : null;
  return { ...state, story: { ...story, trails: { ...saved, [trailId]: { ...before, ...progress, joinedAt } } } };
}

const joinedOf = (state, trail, progress) => progress.joinedAt !== null
  || (typeof trail.end?.joins === 'string' && isRecord(state?.party?.roster) && Object.hasOwn(state.party.roster, trail.end.joins));

/** The step a trail is on: the first one found and not yet done, or null. */
function currentStep(trail, progress) {
  for (const step of trail.steps) {
    if (!isRecord(step)) return null;
    if (timeOf(progress.done[step.id]) !== null) continue;
    return timeOf(progress.found[step.id]) !== null ? step : null;
  }
  return null;
}

/** Whether the Prologue's crack past the gate is mended (first Riddle Notes wait for it, §7.7). */
export function trailsOpen(state) {
  return timeOf(state?.story?.prologue?.done?.['first-crack']) !== null;
}

/**
 * A note turns up (§7.7): the first trail whose next note is `found: where` (its first, or one
 * after a solved step) gets it, at `now`; one note a find. Only once the Prologue's `first-crack`
 * step is done, so a chest opened before then keeps its note for the next chest after it.
 * → { state, trailId: string | null, stepId: string | null } (the same state when nothing's found).
 */
export function handOut(state, trails, where, now) {
  const none = { state, trailId: null, stepId: null };
  if (!isRecord(state) || !finite(now) || typeof where !== 'string' || !trailsOpen(state)) return none;
  for (const trail of trailList(trails)) {
    const progress = progressOf(state, trail.id);
    const index = trail.steps.findIndex((s) => !isRecord(s) || timeOf(progress.found[s.id]) === null);
    const step = trail.steps[index];
    if (index < 0 || !isRecord(step) || step.found !== where) continue;
    if (index > 0 && timeOf(progress.done[trail.steps[index - 1].id]) === null) continue;
    const next = withProgress(state, trail.id, { found: { ...progress.found, [step.id]: now }, done: progress.done });
    return { state: next, trailId: trail.id, stepId: step.id };
  }
  return none;
}

/**
 * Something happened that a step may be waiting for: { kind: 'feature' | 'visit' | 'examine' |
 * 'read', target }. Every started trail whose current step it solves marks that step done at
 * `now` and hands over the next note (a `found: 'given'` step). A step already done, a note not
 * yet found, or anything else changes nothing and returns the same state.
 */
export function stepDone(state, trails, event, now) {
  if (!isRecord(state) || !isRecord(event) || !STEP_KINDS.includes(event.kind) || typeof event.target !== 'string' || !finite(now)) return state;
  let next = state;
  for (const trail of trailList(trails)) {
    const progress = progressOf(next, trail.id);
    const step = currentStep(trail, progress);
    if (!step || step.solve?.kind !== event.kind || step.solve?.target !== event.target) continue;
    const index = trail.steps.indexOf(step);
    const after = trail.steps[index + 1];
    const found = isRecord(after) && after.found === 'given' && timeOf(progress.found[after.id]) === null
      ? { ...progress.found, [after.id]: now } : progress.found;
    next = withProgress(next, trail.id, { found, done: { ...progress.done, [step.id]: now } });
  }
  return next;
}

/**
 * Which trail each companion joins at the end of (trails.json's `end.joins`, turned round), for a
 * caller with no trails content to hand: party.recruit without `content`. A test pins it to
 * trails.json, so it can't drift from the file.
 */
export const TRAIL_JOINS = Object.freeze({ tollkeeper: 'first-trail' });

/**
 * A companion a trail ends with has joined (party.recruit calls this as it adds them to the
 * roster): each trail whose `end.joins` is `companionId` records `joinedAt` once, at `now` rounded
 * to the millisecond, as A's cleaner keeps it. §18.2 item 13: this is the only writer of
 * `story.trails[…].joinedAt`; handOut and stepDone never touch it.
 * `trails` is trails.json, or the content bundle holding it (`content.trails`), or null, when
 * TRAIL_JOINS says which trail. A trail with no progress yet gets `{ found: {}, done: {}, joinedAt }`.
 * The same state back when nothing changes: already joined, no such companion, or junk in.
 */
export function markJoined(state, trails, companionId, now) {
  if (!isRecord(state) || typeof companionId !== 'string' || !finite(now) || now <= 0) return state;
  const list = trailList(isRecord(trails?.trails) ? trails.trails : trails);
  const ids = list.length
    ? list.filter((t) => t.end?.joins === companionId).map((t) => t.id)
    : Object.hasOwn(TRAIL_JOINS, companionId) ? [TRAIL_JOINS[companionId]] : [];
  let next = state;
  for (const id of ids) {
    const progress = progressOf(next, id);
    if (progress.joinedAt !== null) continue;
    next = withProgress(next, id, { found: progress.found, done: progress.done, joinedAt: Math.round(now) });
  }
  return next;
}

const riddleOf = (step) => (Array.isArray(step.riddle) ? step.riddle.filter((l) => typeof l === 'string') : []);

/**
 * The trail panel's view (K1's trail-view.js): the trail Chris is on (the first started one not
 * yet finished, where finished means every step solved and its companion, if it has one, joined;
 * else the last one started), its current note, and every note found so far, in order. Notes not
 * yet found stay hidden.
 * → { trail: null | { id, title, tier, tierName, from }, step: null | { id, riddle, sign, hint, kind, target, foundAt },
 *     steps: [{ id, riddle, sign, hint, done }], done: boolean (every step done),
 *     atBridge: boolean (every step done and the companion not yet joined: the Tollkeeper waits) }
 */
export function trailView(state, trails, now) { // eslint-disable-line no-unused-vars
  const empty = { trail: null, step: null, steps: [], done: false, atBridge: false };
  const list = trailList(trails);
  const started = list.filter((t) => Object.keys(progressOf(state, t.id).found).length);
  if (!started.length) return empty;
  const finished = (t) => {
    const p = progressOf(state, t.id);
    return t.steps.every((s) => timeOf(p.done[s.id]) !== null) && (typeof t.end?.joins !== 'string' || joinedOf(state, t, p));
  };
  const trail = started.find((t) => !finished(t)) || started[started.length - 1];
  const progress = progressOf(state, trail.id);
  const tiers = isRecord(trails.tiers) ? trails.tiers : {};
  const steps = trail.steps
    .filter((s) => timeOf(progress.found[s.id]) !== null)
    .map((s) => ({ id: s.id, riddle: riddleOf(s), sign: typeof s.sign === 'string' ? s.sign : '', hint: typeof s.hint === 'string' ? s.hint : '', done: timeOf(progress.done[s.id]) !== null }));
  const current = currentStep(trail, progress);
  const done = trail.steps.every((s) => timeOf(progress.done[s.id]) !== null);
  return {
    trail: { id: trail.id, title: typeof trail.title === 'string' ? trail.title : '', tier: trail.tier || null, tierName: tiers[trail.tier]?.name || '', from: trail.from || 'Tamsin' },
    step: current ? {
      id: current.id, riddle: riddleOf(current), sign: typeof current.sign === 'string' ? current.sign : '', hint: typeof current.hint === 'string' ? current.hint : '',
      kind: current.solve?.kind || null, target: current.solve?.target || null, foundAt: timeOf(progress.found[current.id]),
    } : null,
    steps,
    done,
    atBridge: done && trail.end?.landmark === LAST_BRIDGE_ID && !joinedOf(state, trail, progress),
  };
}
