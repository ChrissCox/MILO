// Field bosses (CONTRACT-PHASE4.md §3.1, §7.7; COMBAT.md §3.1, §4.1): a tier-5-or-higher wild rift at
// its gaping stage lets its Tale-lead out to roam inside its own bleed. Sight never starts anything
// in the wilds: the fight begins only when Chris chooses *Challenge*, on a 16×12 window at the
// nearest clearing inside the bleed, with the trees there thinned for the fight alone (their place
// ids are hidden; the wilds' `felled` is never touched, and nothing here sees it).
// Pure and deterministic: no clock, no randomness but seeded hashes, no DOM. Runs in Node.
import { TILE } from './map.js';
import { HEART, TERRAIN as T, TERRAIN_INFO } from './worldgen.js';
import { hashInts, hashString, unit } from './rng.js';
import { makeWanderer, bleedCover, bleedReach, behindTear, STRAY_COVER } from './riftfx.js';

/** A field-boss arena's size in tiles (COMBAT §4.1). */
export const FIELD_ARENA = Object.freeze({ w: 16, h: 12 });
/** The share of trees kept standing in a field-boss arena. */
export const TREES_KEPT = 0.2;
/** A window is a clearing when at least this share of it is open ground (trees aside, since they thin). */
export const CLEARING = 0.6;
/** The sight ring's radius, in tiles. */
export const SIGHT_RADIUS = 3;

/**
 * How a wild object stands in a fight (the cover table of CONTRACT-PHASE4.md §9.2, with the points
 * of interest's props added): 'O' high cover, 'o' low cover, '.' nothing in the way.
 */
export const FIELD_COVER = Object.freeze({
  tree: 'O', 'tree.blossom': 'O', 'tree.birch': 'O', pine: 'O', 'pine.snow': 'O', 'basalt.column': 'O', crag: 'O', 'crag.snow': 'O',
  'lantern.post': 'O', 'landmark.stone': 'O', statue: 'O', hamlet: 'O', cave: 'O',
  rock: 'o', 'rock.basalt': 'o', bush: 'o', 'bush.berry': 'o', 'dice.stone': 'o', ruin: 'o', chest: 'o', 'chest.mimic': 'o', 'ore.node': 'o',
  reeds: '.', note: '.', herbs: '.', 'fishing.spot': '.', boat: '.',
});

/**
 * The seven Tale-lead mechanics that never fight (§3.1): every mechanic of the bright genres
 * (verdant, starlight, summit) and of the Backhalls, in riftgen.json's exact text, which is what a
 * spec's `taleLead.mechanic` carries and what leads.json's `noFight` rows hold as `text`. Four of
 * them start "no fight"; three don't, so the whole text is the test, never its first words.
 */
export const NO_FIGHT_MECHANICS = Object.freeze([
  'no fight: plant three seeds and the rift blooms shut',
  'asks for a tour of your week’s good things',
  'no fight: a transformation sequence and a party',
  'asks you to name three small wins',
  'no fight: sit still for one full focus session and break through',
  'a trial of stillness: don’t click for a minute',
  'no fight: find the one door that’s different',
]);
const NO_FIGHT = new Set(NO_FIGHT_MECHANICS);

/**
 * The genres whose Tale-leads stay puzzles whatever mechanic they carry (COMBAT §8.1: "Bright and
 * Backhalls Tale-leads stay puzzles"): the bright genres and the Backhalls, the ones rules.json
 * marks `fights: false`. A fusion's lead can carry its shadow partner's mechanic and still never fights.
 */
export const PUZZLE_GENRES = Object.freeze(['verdant', 'starlight', 'summit', 'backhalls']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = (x, y) => `${x},${y}`;
const WATER = new Set([T.RIVER, T.SEA, T.DEEP]);
const inHeartOrRing = (x, y) => x >= HEART.x - 1 && y >= HEART.y - 1 && x <= HEART.x + HEART.w && y <= HEART.y + HEART.h;
const stageOf = (rift) => rift?.stage || rift?.spec?.stage || null;
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

/**
 * Whether a lead's mechanic fights: it isn't one of NO_FIGHT_MECHANICS, nor (when `leads`,
 * content's combat/leads.json, is given) any row that marks `noFight`. Matched on the whole text,
 * as bestiary.mechanicOf matches it.
 */
export function leadFights(mechanic, { leads = null } = {}) {
  const text = String(mechanic ?? '');
  if (NO_FIGHT.has(text)) return false;
  const rows = Array.isArray(leads?.mechanics) ? leads.mechanics : [];
  return !rows.some((m) => isRecord(m) && m.noFight && m.text === text);
}

/**
 * Whether a Tale-lead's own genre fights (its `genre`, else the rift's first): not a bright genre
 * or the Backhalls (PUZZLE_GENRES), or, when `rules` (content's combat/rules.json) is given, not a
 * genre it marks `fights: false`, as bestiary.isPuzzleLead reads it.
 */
export function leadGenreFights(spec, { rules = null } = {}) {
  const genre = spec?.taleLead?.genre || spec?.genres?.[0];
  const fights = rules?.genres?.[genre]?.fights;
  return typeof fights === 'boolean' ? fights : !PUZZLE_GENRES.includes(genre);
}

/**
 * Whether a rift's Tale-lead is a field boss: a wild rift, gaping, tier 5 or more, placed and not
 * held, with a lead that fights: neither one of the seven bright and Backhalls mechanics
 * (leadFights) nor a bright or Backhalls lead carrying another genre's (leadGenreFights), which are
 * exactly the leads encounters.fieldFight refuses. The contract's one-argument call uses the
 * built-in lists; `leads` and `rules` may be passed as well.
 */
export function isFieldBoss(rift, { leads = null, rules = null } = {}) {
  const spec = rift?.spec;
  if (!isRecord(spec) || !isRecord(spec.taleLead)) return false;
  if ((rift.kind ?? spec.kind) !== 'wild' || spec.kind !== 'wild') return false;
  if (stageOf(rift) !== 'gaping' || !(Number(spec.tier) >= 5)) return false;
  if (!Number.isFinite(rift.x) || !Number.isFinite(rift.y) || rift.held) return false;
  return leadFights(spec.taleLead.mechanic, { leads }) && leadGenreFights(spec, { rules });
}

/**
 * The tiles a gaping tear stands on in the wilds: its own tile, then the two behind it
 * (riftfx.behindTear), where its art stands. Nobody stands on them, roaming or in a fight.
 */
export function tearTiles(rift) {
  if (!Number.isFinite(rift?.x) || !Number.isFinite(rift?.y)) return [];
  const tiles = [{ x: rift.x, y: rift.y }];
  for (let dy = 1; dy <= 2; dy += 1) if (behindTear('gaping', rift.x, rift.y, rift.x, rift.y - dy)) tiles.push({ x: rift.x, y: rift.y - dy });
  return tiles;
}

/**
 * The tile the rift's Tale-lead stands on beside the tear: exactly riftfx.strayActors' lead tile
 * (the first walkable one of seven beside it, from the seed's side), so a roaming boss's home is
 * where Phase 3 stood it. null when none is walkable, or the rift has no gaping lead.
 */
export function leadHome(rift, { walkable = () => true } = {}) {
  const spec = rift?.spec;
  if (!isRecord(spec) || !spec.taleLead || stageOf(rift) !== 'gaping' || !Number.isFinite(rift.x) || !Number.isFinite(rift.y)) return null;
  const ok = okFor(walkable);
  const side = spec.seed & 1 ? 1 : -1;
  const beside = [[side, 0], [-side, 0], [side, 1], [-side, 1], [0, 1], [side, -1], [-side, -1]];
  for (const [dx, dy] of beside) if (ok(rift.x + dx, rift.y + dy)) return { x: rift.x + dx, y: rift.y + dy };
  return null;
}

function okFor(walkable) {
  return (x, y) => {
    if (inHeartOrRing(x, y)) return false;
    try { return Boolean(walkable(x, y)); } catch { return false; }
  };
}

/** Tiles within the bleed's reach of the tear that its own bleed dresses at least STRAY_COVER of. */
function bleedTiles(rift, genres) {
  const reach = Math.ceil(bleedReach(rift) / TILE) + 1;
  const out = [];
  for (let y = rift.y - reach; y <= rift.y + reach; y += 1) {
    for (let x = rift.x - reach; x <= rift.x + reach; x += 1) {
      if (bleedCover(rift, x, y, { genres }) >= STRAY_COVER) out.push({ x, y });
    }
  }
  return out;
}

/**
 * The field boss's wander (§7.7): riftfx's makeWanderer over the tiles inside its bleed (bleedCover
 * at least STRAY_COVER), walkable, off the tear and not behind it, seeded
 * hashInts(spec.seed, salt, 'lead-roam') with salt as strayActors takes it (`seed`, 0 by default,
 * as scene-rifts passes). positionAt(null) stands at home. null unless isFieldBoss (`leads` and
 * `rules` are passed on to it). With `worldgen` and `wilds` as well, it's also null when
 * fieldArena can't seat the fight (no arena), so a lead that roams can always be challenged.
 * → { home: { x, y }, allowed: string[] ('x,y' tiles it can reach from home), positionAt(t) → { x, y, dir, moving }, period, speed }
 */
export function leadRoam(rift, { walkable = () => true, genres, seed = 0, leads = null, rules = null, worldgen = null, wilds = null } = {}) {
  if (!isFieldBoss(rift, { leads, rules })) return null;
  const home = leadHome(rift, { walkable });
  if (!home) return null;
  if (worldgen && wilds && !fieldArena(rift, { worldgen, wilds, walkable, genres, leads, rules })) return null;
  const ok = okFor(walkable);
  const stage = stageOf(rift);
  const allowed = new Set([key(home.x, home.y)]);
  for (const { x, y } of bleedTiles(rift, genres)) {
    if ((x === rift.x && y === rift.y) || behindTear(stage, rift.x, rift.y, x, y) || !ok(x, y)) continue;
    allowed.add(key(x, y));
  }
  const salt = typeof seed === 'number' ? seed : hashString(String(seed));
  const wander = makeWanderer({ home, allowed, seed: hashInts(rift.spec.seed >>> 0, salt, 'lead-roam') });
  return {
    home,
    allowed: Object.freeze(wander.tiles.map((t) => key(t.x, t.y))),
    positionAt: wander.positionAt,
    period: wander.period,
    speed: wander.speed,
  };
}

/** The soft ring drawn round a field boss's rift (sight never starts a fight; it only shows where one could). */
export function sightRing(rift) {
  return { x: rift?.x ?? 0, y: rift?.y ?? 0, radius: SIGHT_RADIUS };
}

/**
 * The field boss's arena (§7.7, §5.3), built only when Chris chooses Challenge. It's the 16×12
 * window centred on the nearest clearing to the rift inside its bleed: among window centres the
 * bleed dresses (bleedCover ≥ STRAY_COVER) whose window holds the tear and the lead's home at least
 * two tiles from its edges, the nearest to the tear with at least CLEARING of its ground open
 * (walkable, with nothing but trees on it, and not the tear's own tiles), else the most open;
 * equally near ones by hashInts(seed, x, y) on the centre. A window the fight can't be seated in
 * (below) passes to the next: the next nearest clearing, then the rest, most open first. Its trees
 * are thinned to TREES_KEPT: round(a fifth of them) stay, by the lowest seeded draws, and never one
 * within a tile of the tear or the lead's home, so the lead has room. `hiddenTrees` are the other
 * trees' place ids, hidden for the fight only.
 * Nothing is written anywhere: the wilds' objects are read, never changed.
 * - cells: '#' wall (the vale's ring, mountains, anything else unwalkable), '.' floor, '~' water,
 *   ' ' void (sky), 'O' high cover (trees, crags, posts), 'o' low cover (rocks, bushes, ruins);
 *   the tear and the two tiles behind it (tearTiles), where its art stands, are 'O' too, so no
 *   one, lead or hero, is ever posted on or behind it (unless that ground is water or rock);
 * - height all '0' and light all 'L' (the sky dims the wilds; lights add to it, §4.17);
 * - mouths [] (the wilds have no corridors); entry: four floor tiles (§5.3) for the party, seated
 *   round the lead's post as encounters.fieldFight takes it (the free 2×2 of floor nearest the
 *   tear; postsByWalk): on floor the party walks to that post from (eight ways, never across the
 *   corner between two blocked tiles, as B's grid moves), at least three tiles from every tile of
 *   it (two when no walk has room at three). Milo's is the one nearest the middle of the window's
 *   edge facing the vale, and the other three the nearest his, so the party starts together.
 *   Seated so, fieldFight's own rule puts the lead on that same post. When the nearest post's walk
 *   can't hold the party, the next nearest post in another walk is tried. The entry depends on
 *   nothing but the rift and the wilds, so a fight rebuilt from `expedition.source` after a
 *   relaunch starts exactly where it did;
 * - seed hashInts(spec.seed, 'field', 'arena') (§5.1's room id `field`).
 * `walkable` is the wilds' own (nav.walkable, trees and all); without it, worldgen's terrain with
 * wilds.blocked. `leads` and `rules` are passed on to isFieldBoss.
 * → null | { arena: Arena, hiddenTrees: string[] } (frozen). null when it isn't a field boss, there
 * are no wilds to read, or no window seats the fight.
 */
export function fieldArena(rift, { worldgen, wilds, walkable = null, genres, leads = null, rules = null } = {}) {
  if (!isFieldBoss(rift, { leads, rules }) || !worldgen || !wilds || typeof wilds.objectsIn !== 'function') return null;
  const walk = typeof walkable === 'function' ? walkable
    : (x, y) => worldgen.walkable(x, y) && !(typeof wilds.blocked === 'function' && wilds.blocked(x, y));
  const home = leadHome(rift, { walkable: walk });
  if (!home) return null;
  const { w: W, h: H } = FIELD_ARENA;
  const seed = hashInts(rift.spec.seed >>> 0, 'field', 'arena');
  const tear = { x: rift.x, y: rift.y };
  const tearAt = new Set(tearTiles(rift).map((p) => key(p.x, p.y)));

  // Every object that could fall in any window, by the tiles it covers (the wilds' chunks first,
  // since objectsIn only reads cached ones).
  const span = Math.ceil(bleedReach(rift) / TILE) + Math.max(W, H) + 2;
  const box = { x0: rift.x - span, y0: rift.y - span, x1: rift.x + span, y1: rift.y + span };
  if (typeof wilds.chunk === 'function') {
    for (let cy = Math.floor(box.y0 / 32); cy <= Math.floor(box.y1 / 32); cy += 1) {
      for (let cx = Math.floor(box.x0 / 32); cx <= Math.floor(box.x1 / 32); cx += 1) wilds.chunk(cx, cy);
    }
  }
  const objectAt = new Map();
  for (const o of wilds.objectsIn(box.x0, box.y0, box.x1, box.y1)) {
    for (let dx = 0; dx < (o.w || 1); dx += 1) if (!objectAt.has(key(o.x + dx, o.y))) objectAt.set(key(o.x + dx, o.y), o);
  }
  const terrain = (x, y) => (worldgen.inHeart(x, y) ? T.HEART : worldgen.terrainAt(x, y));
  const isTree = (o) => Boolean(o && o.wood);
  const open = (x, y) => {
    if (inHeartOrRing(x, y) || tearAt.has(key(x, y))) return false;
    const o = objectAt.get(key(x, y));
    if (isTree(o)) return TERRAIN_INFO[terrain(x, y)].walk;
    return walk(x, y);
  };

  // The window: the nearest clearing inside the bleed that seats the fight.
  const holds = (rx, ry, p) => p.x >= rx + 2 && p.x <= rx + W - 3 && p.y >= ry + 2 && p.y <= ry + H - 3;
  const scored = [];
  for (const c of bleedTiles(rift, genres)) {
    const rx = c.x - W / 2;
    const ry = c.y - H / 2;
    if (!holds(rx, ry, tear) || !holds(rx, ry, home)) continue;
    let count = 0;
    for (let y = ry; y < ry + H; y += 1) for (let x = rx; x < rx + W; x += 1) if (open(x, y)) count += 1;
    scored.push({ c, rx, ry, share: count / (W * H), d: Math.hypot(c.x - tear.x, c.y - tear.y), tie: hashInts(seed, c.x, c.y) });
  }
  const order = [
    ...scored.filter((s) => s.share >= CLEARING).sort((a, b) => a.d - b.d || a.tie - b.tie),
    ...scored.filter((s) => s.share < CLEARING).sort((a, b) => b.share - a.share || a.d - b.d || a.tie - b.tie),
  ];
  const near = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1;
  const draw = (o) => unit(hashInts(seed, o.x, o.y, 'thin'));

  for (const pick of order) {
    const rect = { x: pick.rx, y: pick.ry, w: W, h: H };

    // Thin the trees: exactly round(TREES_KEPT × trees) stay, those with the lowest seeded draws
    // among the trees not beside the tear or the lead; the rest are hidden.
    const trees = [];
    const seenTrees = new Set();
    for (let y = rect.y; y < rect.y + H; y += 1) {
      for (let x = rect.x; x < rect.x + W; x += 1) {
        const o = objectAt.get(key(x, y));
        if (!isTree(o) || seenTrees.has(o.id)) continue;
        seenTrees.add(o.id);
        trees.push(o);
      }
    }
    const kept = new Set(trees
      .filter((o) => !near(o.x, o.y, tear) && !near(o.x, o.y, home))
      .sort((a, b) => draw(a) - draw(b) || (a.id < b.id ? -1 : 1))
      .slice(0, Math.round(TREES_KEPT * trees.length))
      .map((o) => o.id));

    // The cells.
    const cellAt = (x, y) => {
      if (inHeartOrRing(x, y)) return '#';
      const t = terrain(x, y);
      if (!TERRAIN_INFO[t].walk) return WATER.has(t) ? '~' : t === T.SKY ? ' ' : '#';
      if (tearAt.has(key(x, y))) return 'O';
      const o = objectAt.get(key(x, y));
      if (isTree(o)) return kept.has(o.id) ? 'O' : '.';
      if (o && o.blocks !== false) return FIELD_COVER[o.kind] ?? '#';
      return walk(x, y) ? '.' : '#';
    };
    let cells = '';
    for (let y = rect.y; y < rect.y + H; y += 1) for (let x = rect.x; x < rect.x + W; x += 1) cells += cellAt(x, y);

    // Where the party starts: seated round the lead's post, on the side facing the vale.
    const vx = HEART.cx - tear.x;
    const vy = HEART.cy - tear.y;
    const anchor = Math.abs(vx) >= Math.abs(vy)
      ? { x: vx < 0 ? rect.x + 1 : rect.x + W - 2, y: rect.y + H / 2 }
      : { x: rect.x + W / 2, y: vy < 0 ? rect.y + 1 : rect.y + H - 2 };
    const entry = seatParty(rect, cells, tear, anchor);
    if (!entry) continue;

    const hidden = trees.filter((o) => !kept.has(o.id)).map((o) => o.place || o.id);
    const arena = {
      rect,
      cells,
      height: '0'.repeat(W * H),
      light: 'L'.repeat(W * H),
      mouths: [],
      entry,
      seed,
    };
    return deepFreeze({ arena, hiddenTrees: hidden.sort() });
  }
  return null;
}

/** The eight steps, as B's grid and encounters.arenaWalk take them. */
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** How far the party starts from the lead's post (tiles, Chebyshev), the nearer only when the farther won't fit. */
const START_GAPS = [3, 2];

/**
 * The lead's post in each walk of an arena, by encounters.fieldFight's rule (§7.3): a free 2×2 of
 * floor ('.' or '='), the nearest the tear by its centre, the first in row order on a tie. The walks
 * are the arena's floor joined eight ways, never across the corner between two blocked tiles (as
 * encounters.arenaWalk and B's grid move). fieldFight takes the nearest post the party's walk from
 * its start tiles reaches, so with the start tiles in one walk it takes that walk's post here.
 * → { walkOf: Int32Array (the walk of each cell, −1 for none), posts: [{ x, y, d, walk }] nearest first }
 */
function postsByWalk(rect, cells, tear) {
  const { w: W, h: H } = rect;
  const floor = (lx, ly) => lx >= 0 && ly >= 0 && lx < W && ly < H && (cells[ly * W + lx] === '.' || cells[ly * W + lx] === '=');
  const walkOf = new Int32Array(W * H).fill(-1);
  let walks = 0;
  for (let i = 0; i < W * H; i += 1) {
    if (walkOf[i] >= 0 || !floor(i % W, Math.floor(i / W))) continue;
    walkOf[i] = walks;
    const queue = [i];
    for (let head = 0; head < queue.length; head += 1) {
      const lx = queue[head] % W;
      const ly = Math.floor(queue[head] / W);
      for (const [dx, dy] of STEPS) {
        if (!floor(lx + dx, ly + dy)) continue;
        if (dx && dy && !floor(lx + dx, ly) && !floor(lx, ly + dy)) continue;
        const j = (ly + dy) * W + lx + dx;
        if (walkOf[j] < 0) { walkOf[j] = walks; queue.push(j); }
      }
    }
    walks += 1;
  }
  const best = new Map();
  for (let ly = 0; ly < H - 1; ly += 1) {
    for (let lx = 0; lx < W - 1; lx += 1) {
      if (!(floor(lx, ly) && floor(lx + 1, ly) && floor(lx, ly + 1) && floor(lx + 1, ly + 1))) continue;
      const x = rect.x + lx;
      const y = rect.y + ly;
      const d = Math.hypot(x + 0.5 - tear.x, y + 0.5 - tear.y);
      const walk = walkOf[ly * W + lx];
      const was = best.get(walk);
      if (!was || d < was.d) best.set(walk, { x, y, d, walk, at: ly * W + lx });
    }
  }
  const posts = [...best.values()].sort((a, b) => a.d - b.d || a.at - b.at).map(({ x, y, d, walk }) => ({ x, y, d, walk }));
  return { walkOf, posts };
}

/**
 * The party's four start tiles round the lead's post (fieldArena's entry): floor in the post's own
 * walk, at least START_GAPS tiles from every tile of its 2×2. Milo's is the one nearest `anchor`
 * (then by row and column), and the other three are the nearest his, so the party starts together.
 * Tries each walk's post, nearest the tear first, at three tiles, then all again at two.
 * null when none fits.
 */
function seatParty(rect, cells, tear, anchor) {
  const { w: W } = rect;
  const { walkOf, posts } = postsByWalk(rect, cells, tear);
  for (const gap of START_GAPS) {
    for (const post of posts) {
      const clear = (x, y) => x < post.x - gap + 1 || x > post.x + gap || y < post.y - gap + 1 || y > post.y + gap;
      const starts = [];
      for (let i = 0; i < walkOf.length; i += 1) {
        const x = rect.x + (i % W);
        const y = rect.y + Math.floor(i / W);
        if (walkOf[i] === post.walk && cells[i] === '.' && clear(x, y)) starts.push({ x, y });
      }
      if (starts.length < 4) continue;
      const d = (p) => Math.hypot(p.x - anchor.x, p.y - anchor.y);
      const [milo, ...rest] = starts.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
      const m = (p) => Math.hypot(p.x - milo.x, p.y - milo.y);
      return [milo, ...rest.sort((a, b) => m(a) - m(b) || d(a) - d(b) || a.y - b.y || a.x - b.x).slice(0, 3)];
    }
  }
  return null;
}
