// Field bosses (module E): src/world/fieldboss.js, a tier-5+ gaping wild rift's Tale-lead roaming
// its own bleed, and the arena Challenge opens (CONTRACT-PHASE4.md §3.1, §7.7; COMBAT.md §3.1, §4.1).
// Run: node --test tests/fieldboss.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { createWorldgen, HEART, TERRAIN as T, TERRAIN_INFO } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { createNav } from '../src/world/nav.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { hashInts } from '../src/world/rng.js';
import { makeWanderer, strayActors, bleedCover, behindTear, STRAY_COVER } from '../src/world/riftfx.js';
import { wildRiftsForChunk } from '../src/rifts.js';
import {
  isFieldBoss, leadFights, leadGenreFights, leadHome, leadRoam, fieldArena, sightRing, tearTiles,
  FIELD_ARENA, TREES_KEPT, SIGHT_RADIUS, CLEARING, FIELD_COVER, NO_FIGHT_MECHANICS, PUZZLE_GENRES,
} from '../src/world/fieldboss.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const maybe = (name) => (existsSync(new URL(`../content/${name}`, import.meta.url)) ? read(name) : null);
const words = read('riftgen.json');
const genres = read('genres.json');
const leads = maybe('combat/leads.json');
const rules = maybe('combat/rules.json');
const foes = maybe('combat/foes.json');
const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
const riftgen = createRiftgen({ words, genres });
const wilds = createWilds({ worldgen: world, maxChunks: 400 });
const nav = createNav({ worldgen: world, wildBlocked: wilds.blocked, extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
const FEET = 13;
const key = (x, y) => `${x},${y}`;
const tileOf = (p) => ({ x: Math.round((p.x - 8) / 16), y: Math.round((p.y - FEET) / 16) });

// Today's real field bosses out in the Greyreach, found the way the wilds find wild rifts, with
// where and when each was found (so its §8.3 source can be read back from worldgen's spawns).
const BOSSES = [];
const FOUND = new Map();
for (let day = 20000; day < 20012 && BOSSES.length < 5; day += 1) {
  for (let cy = -7; cy <= -2 && BOSSES.length < 5; cy += 1) {
    for (let cx = -8; cx <= -2 && BOSSES.length < 5; cx += 1) {
      for (const rift of wildRiftsForChunk({ worldgen: world, riftgen, cx, cy, day, isFree: nav.walkable })) {
        if (isFieldBoss(rift)) { BOSSES.push(rift); FOUND.set(rift.id, { day, cx, cy }); }
      }
    }
  }
}

/** A real wild rift by its id, on the day and in the chunk the wilds put it. */
function realRift(id, day, cx, cy) {
  const rift = wildRiftsForChunk({ worldgen: world, riftgen, cx, cy, day, isFree: nav.walkable }).find((r) => r.id === id);
  if (!rift) throw new Error(`${id} isn’t in chunk ${cx},${cy} on day ${day}`);
  FOUND.set(id, { day, cx, cy });
  return rift;
}
// Two real bosses on narrow shores in the south-west, where the tear's column cuts the lead's home
// off from the rest of the land: the home has one or two tiles, so the fight has to move to the
// land the party can stand on (before, neither had an arena, though both roam).
const SHORE_BOSSES = [realRift('rift:1f8ogdx', 20345, -8, 10), realRift('rift:13l21dl', 20102, -8, 9)];
// Three real bosses where the lead's post and its home are on different sides of the tear, so a
// party seated round the home started right beside the post.
const SPLIT_BOSSES = [realRift('rift:12vclvf', 20033, -7, -10), realRift('rift:1ewbkyt', 20150, -7, -10), realRift('rift:7rm4uo', 20186, -8, 9)];

/**
 * A wild rift built by hand: tier 5, gaping, with a Tale-lead that fights (a shadow genre's own
 * lead with a fighting mechanic), set down at (x, y).
 */
function bossAt(x, y, salt = 0) {
  for (let i = 0; i < 4000; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(salt, i, 'test-boss'), tier: 5, depth: 3, weights: { gothic: 3, noir: 3, void: 2 } });
    const rift = { id: spec.id, key: null, kind: 'wild', spec, x, y, stage: spec.stage, held: null };
    if (spec.stage === 'gaping' && spec.taleLead && !NO_FIGHT_MECHANICS.includes(spec.taleLead.mechanic) && !PUZZLE_GENRES.includes(spec.taleLead.genre)) return rift;
  }
  throw new Error('no gaping tier-5 rift found');
}

// A forest boss for the thinning, in the pines north-west of the vale (well away from the road).
function forestSpot() {
  for (let r = 0; r < 40; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (const dy of [-r, r]) {
        const x = -30 + dx;
        const y = -30 + dy;
        const t = world.terrainAt(x, y);
        if ((t === T.PINE || t === T.FOREST) && nav.walkable(x, y) && nav.walkable(x + 1, y) && nav.walkable(x - 1, y)) return { x, y };
      }
    }
  }
  throw new Error('no forest');
}
const FOREST = forestSpot();
const FOREST_BOSS = bossAt(FOREST.x, FOREST.y);
// Two groves in the far north's pines where trees stand right beside the tear and the lead, so the
// rule that none of those stays is really tested (a fifth kept by draw alone would keep one of them,
// beside the tear in both, and beside the lead but not the tear in the second).
const GROVE_BOSSES = [bossAt(18, -80), bossAt(2, -80)];
// Three tears under the northern crags, where the window centred on the tear is mostly mountain,
// so the nearest clearing is a step or two off it (and the farthest is further still). In the
// third, the tear's own tiles are what keep the centred window under the clearing line.
const CRAG_BOSSES = [bossAt(115, -80), bossAt(82, -77), bossAt(-76, -99)];
const ALL = () => [...BOSSES, FOREST_BOSS, ...GROVE_BOSSES, ...CRAG_BOSSES];
// Every boss with an arena to check: the twelve above, the shores and the split ones.
const ARENAS = () => [...ALL(), ...SHORE_BOSSES, ...SPLIT_BOSSES];
// A tear on the bank of a river north-west of the vale: its window takes in a run of river.
const RIVER_BOSS = bossAt(-9, -60);
const WATER = [T.RIVER, T.SEA, T.DEEP];

const inRing = (x, y) => x >= HEART.x - 1 && y >= HEART.y - 1 && x <= HEART.x + HEART.w && y <= HEART.y + HEART.h;
const cellIn = (arena) => (p) => {
  const { rect } = arena;
  if (p.x < rect.x || p.y < rect.y || p.x >= rect.x + rect.w || p.y >= rect.y + rect.h) return undefined;
  return arena.cells[(p.y - rect.y) * rect.w + (p.x - rect.x)];
};
const onTear = (rift) => { const tiles = new Set(tearTiles(rift).map((p) => key(p.x, p.y))); return (p) => tiles.has(key(p.x, p.y)); };
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const footOf = (post) => [post, { x: post.x + 1, y: post.y }, { x: post.x, y: post.y + 1 }, { x: post.x + 1, y: post.y + 1 }];
/** How far a tile is from the lead's 2×2 (tiles, the nearest of its four). */
const gapTo = (p, post) => Math.min(...footOf(post).map((t) => cheb(p, t)));

/**
 * The party's walk inside an arena from some tiles, as B's grid moves them: over '.' and '=' cells
 * inside the window, eight ways, never across the corner between two blocked tiles. → Set of 'x,y'
 */
function walkFrom(arena, starts) {
  const cell = cellIn(arena);
  const floor = (x, y) => ['.', '='].includes(cell({ x, y }));
  const seen = new Set();
  const queue = [];
  for (const p of starts) if (floor(p.x, p.y) && !seen.has(key(p.x, p.y))) { seen.add(key(p.x, p.y)); queue.push(p); }
  for (let i = 0; i < queue.length; i += 1) {
    const p = queue[i];
    for (const [dx, dy] of STEPS) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!floor(x, y) || seen.has(key(x, y))) continue;
      if (dx && dy && !floor(p.x + dx, p.y) && !floor(p.x, p.y + dy)) continue;
      seen.add(key(x, y));
      queue.push({ x, y });
    }
  }
  return seen;
}

/**
 * Every free 2×2 of floor in an arena ('.' or '=', less `off`), by its top-left tile, in row order,
 * with its centre's distance to the tear.
 */
function posts(arena, rift, off = new Set()) {
  const cell = cellIn(arena);
  const free = (x, y) => ['.', '='].includes(cell({ x, y })) && !off.has(key(x, y));
  const out = [];
  for (let y = arena.rect.y; y < arena.rect.y + arena.rect.h - 1; y += 1) {
    for (let x = arena.rect.x; x < arena.rect.x + arena.rect.w - 1; x += 1) {
      if (free(x, y) && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1)) out.push({ x, y, d: Math.hypot(x + 0.5 - rift.x, y + 0.5 - rift.y) });
    }
  }
  return out;
}

/**
 * The lead's post as encounters.fieldFight takes it (§7.3), recomputed from its rule: the free 2×2
 * off the start tiles nearest the tear, the first in row order on a tie, among those the party's
 * walk from its start tiles reaches (any other only when none is).
 */
function leadPostFor(arena, rift) {
  const reach = walkFrom(arena, arena.entry);
  let post = null;
  let best = Infinity;
  for (const p of posts(arena, rift, new Set(arena.entry.map((t) => key(t.x, t.y))))) {
    const d = p.d + (reach.has(key(p.x, p.y)) ? 0 : 1e6);
    if (d < best) { best = d; post = { x: p.x, y: p.y }; }
  }
  return post;
}

/** The middle of the window's edge facing the vale, where Milo's start is the nearest to. */
function valeSide(arena, rift) {
  const { rect } = arena;
  const vx = HEART.cx - rift.x;
  const vy = HEART.cy - rift.y;
  return Math.abs(vx) >= Math.abs(vy)
    ? { x: vx < 0 ? rect.x + 1 : rect.x + 14, y: rect.y + 6 }
    : { x: rect.x + 8, y: vy < 0 ? rect.y + 1 : rect.y + 10 };
}

/**
 * The seating rule, checked whole (§5.3, §7.7): the fights' own post rule, given the four starts,
 * puts the lead on the 2×2 nearest the tear in its walk; the party's walk reaches it; every start
 * is floor in that walk at least three tiles from every tile of the post (two only when no walk can
 * seat four at three); a nearer post is passed over only when its walk can't seat four; Milo's
 * start is the one nearest the vale-side edge's middle and the other three are the nearest his.
 * → { post, gap }
 */
function checkSeating(arena, rift) {
  const cell = cellIn(arena);
  const id = rift.id;
  assert.equal(arena.entry.length, 4, `${id}: four starts`);
  assert.equal(new Set(arena.entry.map((p) => key(p.x, p.y))).size, 4, `${id}: four different starts`);
  for (const p of arena.entry) assert.equal(cell(p), '.', `${id}: ${key(p.x, p.y)} is floor`);
  const post = leadPostFor(arena, rift);
  assert.ok(post, `${id}: the lead has somewhere to stand`);
  const walk = walkFrom(arena, [post]);
  assert.ok(walkFrom(arena, arena.entry).has(key(post.x, post.y)), `${id}: the party can walk to the lead`);
  for (const p of arena.entry) assert.ok(walk.has(key(p.x, p.y)), `${id}: ${key(p.x, p.y)} is on the lead’s side`);
  const gap = Math.min(...arena.entry.map((p) => gapTo(p, post)));
  assert.ok(gap >= 2, `${id}: nobody starts beside the lead (${gap} tiles)`);
  // Each walk's own post (the nearest the tear in it), and how many it could seat at a gap.
  const all = posts(arena, rift).sort((a, b) => a.d - b.d);
  const walks = [];
  for (const p of all) {
    if (walks.some((w) => w.tiles.has(key(p.x, p.y)))) continue;
    walks.push({ post: p, tiles: walkFrom(arena, [p]) });
  }
  const seats = (w, g) => [...w.tiles].map((k) => k.split(',').map(Number)).filter(([x, y]) => cell({ x, y }) === '.' && gapTo({ x, y }, w.post) >= g).length;
  const mine = walks.find((w) => w.tiles.has(key(post.x, post.y)));
  assert.deepEqual({ x: mine.post.x, y: mine.post.y }, post, `${id}: the fights pick the nearest post in the party’s walk`);
  const used = gap >= 3 ? 3 : 2;
  if (used < 3) for (const w of walks) assert.ok(seats(w, 3) < 4, `${id}: two tiles only because no walk seats four at three`);
  for (const w of walks) {
    if (w === mine || w.post.d > mine.post.d || (w.post.d === mine.post.d && (w.post.y > mine.post.y || (w.post.y === mine.post.y && w.post.x > mine.post.x)))) continue;
    assert.ok(seats(w, used) < 4, `${id}: the nearer post at ${key(w.post.x, w.post.y)} is passed over only because its walk can’t seat four`);
  }
  // Milo's start, then the three nearest his.
  const anchor = valeSide(arena, rift);
  const starts = [...walk].map((k) => k.split(',').map(Number)).map(([x, y]) => ({ x, y }))
    .filter((p) => cell(p) === '.' && gapTo(p, post) >= used);
  const d = (p) => Math.hypot(p.x - anchor.x, p.y - anchor.y);
  const [milo, ...rest] = starts.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
  const m = (p) => Math.hypot(p.x - milo.x, p.y - milo.y);
  rest.sort((a, b) => m(a) - m(b) || d(a) - d(b) || a.y - b.y || a.x - b.x);
  assert.deepEqual(arena.entry, [milo, ...rest.slice(0, 3)], `${id}: Milo nearest the vale’s side, and the party together round him`);
  return { post, gap };
}

/**
 * Every window the arena could take, recomputed here from the rule (§7.7, COMBAT §4.1): a 16×12
 * window centred on a tile the bleed dresses, holding the tear and the lead two tiles in from its
 * edges, with its share of open ground (walkable, or a tree on walkable ground, never the vale's
 * ring or the tear's own tiles).
 */
function windowsFor(rift) {
  const home = leadHome(rift, { walkable: nav.walkable });
  const tear = onTear(rift);
  const trees = new Set();
  for (const o of wilds.objectsIn(rift.x - 40, rift.y - 40, rift.x + 40, rift.y + 40)) if (o.wood) trees.add(key(o.x, o.y));
  const open = (x, y) => !inRing(x, y) && !tear({ x, y }) && (trees.has(key(x, y)) ? TERRAIN_INFO[world.terrainAt(x, y)].walk : nav.walkable(x, y));
  const out = [];
  for (let cy = rift.y - 24; cy <= rift.y + 24; cy += 1) {
    for (let cx = rift.x - 24; cx <= rift.x + 24; cx += 1) {
      if (bleedCover(rift, cx, cy, { genres }) < STRAY_COVER) continue;
      const rect = { x: cx - 8, y: cy - 6 };
      const inside = (p) => p.x >= rect.x + 2 && p.x <= rect.x + 13 && p.y >= rect.y + 2 && p.y <= rect.y + 9;
      if (!inside(rift) || !inside(home)) continue;
      let n = 0;
      for (let y = rect.y; y < rect.y + 12; y += 1) for (let x = rect.x; x < rect.x + 16; x += 1) if (open(x, y)) n += 1;
      out.push({ x: rect.x, y: rect.y, share: n / (16 * 12), d: Math.hypot(cx - rift.x, cy - rift.y) });
    }
  }
  return out;
}

test('there are real field bosses to test, far out in the Greyreach', () => {
  assert.ok(BOSSES.length >= 3, `${BOSSES.length} field bosses`);
  for (const rift of BOSSES) {
    assert.equal(rift.kind, 'wild');
    assert.equal(rift.stage, 'gaping');
    assert.ok(rift.spec.tier >= 5);
  }
});

test('a field boss is a wild, gaping, tier-5-or-more rift’s Tale-lead that fights', () => {
  const rift = bossAt(40, -40);
  assert.equal(isFieldBoss(rift), true);
  assert.equal(isFieldBoss({ ...rift, spec: { ...rift.spec, tier: 4 } }), false, 'tier 4 is too near home');
  assert.equal(isFieldBoss({ ...rift, stage: 'open', spec: { ...rift.spec, stage: 'open' } }), false, 'only gaping rifts let the lead out');
  assert.equal(isFieldBoss({ ...rift, kind: 'real', spec: { ...rift.spec, kind: 'real' } }), false, 'never a real rift');
  assert.equal(isFieldBoss({ ...rift, spec: { ...rift.spec, taleLead: null } }), false);
  assert.equal(isFieldBoss({ ...rift, spec: { ...rift.spec, taleLead: { ...rift.spec.taleLead, mechanic: 'no fight: plant three seeds and the rift blooms shut' } } }), false, 'bright leads never fight');
  assert.equal(isFieldBoss({ ...rift, held: { by: 'crew' } }), false);
  assert.equal(isFieldBoss({ ...rift, x: undefined }), false);
  assert.equal(isFieldBoss(null), false);
});

test('the seven bright and Backhalls mechanics never make a field boss, whatever their first words', () => {
  // They're exactly the bright genres' mechanics and the Backhalls', word for word from riftgen.json.
  const quiet = Object.values(genres.genres).filter((g) => g.kind === 'bright').map((g) => g.id);
  assert.deepEqual([...quiet].sort(), ['starlight', 'summit', 'verdant']);
  const texts = [...quiet, 'backhalls'].flatMap((g) => words.genres[g].mechanics);
  assert.equal(NO_FIGHT_MECHANICS.length, 7);
  assert.deepEqual([...NO_FIGHT_MECHANICS].sort(), [...texts].sort());
  assert.ok(NO_FIGHT_MECHANICS.filter((t) => !/^no fight/.test(t)).length === 3, 'three of them don’t start “no fight”');
  // And exactly the rows leads.json marks noFight, as the fights read them.
  if (leads) assert.deepEqual([...NO_FIGHT_MECHANICS].sort(), leads.mechanics.filter((m) => m.noFight).map((m) => m.text).sort());
  const rift = bossAt(40, -40);
  for (const mechanic of NO_FIGHT_MECHANICS) {
    const quietOne = { ...rift, spec: { ...rift.spec, taleLead: { ...rift.spec.taleLead, mechanic } } };
    assert.equal(isFieldBoss(quietOne), false, `“${mechanic}” never fights`);
    assert.equal(isFieldBoss(quietOne, { leads }), false);
    assert.equal(leadFights(mechanic), false);
    assert.equal(leadRoam(quietOne, { walkable: nav.walkable, genres }), null, 'so it never roams');
    assert.equal(fieldArena(quietOne, { worldgen: world, wilds, walkable: nav.walkable, genres }), null, 'and has no arena');
  }
  // Every other mechanic fights, so the list keeps out only the seven.
  const fighting = Object.values(words.genres).flatMap((g) => g.mechanics).filter((m) => !NO_FIGHT_MECHANICS.includes(m));
  assert.equal(fighting.length, 32);
  for (const mechanic of fighting) {
    assert.equal(isFieldBoss({ ...rift, spec: { ...rift.spec, taleLead: { ...rift.spec.taleLead, mechanic } } }), true, `“${mechanic}” fights`);
  }
  // A leads table that marks another mechanic noFight is honoured too.
  const marked = { mechanics: [{ text: rift.spec.taleLead.mechanic, noFight: true }] };
  assert.equal(isFieldBoss(rift, { leads: marked }), false);
  assert.equal(leadRoam(rift, { walkable: nav.walkable, genres, leads: marked }), null);
});

test('real gaping tier-5 rifts out in the wilds with a quiet lead aren’t field bosses', () => {
  // Found the way the wilds find them: a starlight lead south-west (day 20000, chunk −4, 10) and two
  // summit leads further out (day 20011, chunk −6, 6), one of each kind that doesn't start "no fight".
  const seen = [];
  for (const [day, cx, cy] of [[20000, -4, 10], [20011, -6, 6]]) {
    for (const rift of wildRiftsForChunk({ worldgen: world, riftgen, cx, cy, day, isFree: nav.walkable })) {
      if (rift.kind !== 'wild' || rift.stage !== 'gaping' || !(rift.spec.tier >= 5) || !rift.spec.taleLead) continue;
      if (!NO_FIGHT_MECHANICS.includes(rift.spec.taleLead.mechanic)) continue;
      seen.push(rift.spec.taleLead.mechanic);
      assert.equal(isFieldBoss(rift), false, `${rift.id} (${rift.spec.taleLead.mechanic}) doesn’t roam`);
    }
  }
  assert.ok(seen.includes('asks you to name three small wins'), 'the starlight lead is there');
  assert.ok(seen.includes('a trial of stillness: don’t click for a minute'), 'and the summit one');
  for (const rift of BOSSES) assert.ok(!NO_FIGHT_MECHANICS.includes(rift.spec.taleLead.mechanic), `${rift.id} fights`);
});

test('a bright or Backhalls Tale-lead stays a puzzle, even carrying a shadow genre’s mechanic', () => {
  // COMBAT §8.1: "Bright and Backhalls Tale-leads stay puzzles". A fusion's lead can carry its
  // partner's mechanic: a real one is the starlight Wish-keeper south-west of the vale (day 20111,
  // chunk −4, 8), who hides behind noir's alibis.
  assert.deepEqual([...PUZZLE_GENRES].sort(), ['backhalls', 'starlight', 'summit', 'verdant']);
  if (rules) {
    const quiet = Object.entries(rules.genres).filter(([, g]) => g.fights === false).map(([id]) => id).sort();
    assert.deepEqual(quiet, [...PUZZLE_GENRES].sort(), 'exactly the genres rules.json says never fight');
  }
  const keeper = realRift('rift:4tanxx', 20111, -4, 8);
  assert.equal(keeper.stage, 'gaping');
  assert.ok(keeper.spec.tier >= 5);
  assert.equal(keeper.spec.taleLead.genre, 'starlight');
  assert.equal(leadFights(keeper.spec.taleLead.mechanic), true, 'its mechanic is a fighting one');
  assert.equal(isFieldBoss(keeper), false, 'but it never roams as a field boss');
  assert.equal(isFieldBoss(keeper, { leads, rules }), false);
  assert.equal(leadRoam(keeper, { walkable: nav.walkable, genres }), null);
  assert.equal(fieldArena(keeper, { worldgen: world, wilds, walkable: nav.walkable, genres }), null);
  const rift = bossAt(40, -40);
  for (const genre of PUZZLE_GENRES) {
    const quiet = { ...rift, spec: { ...rift.spec, taleLead: { ...rift.spec.taleLead, genre } } };
    assert.equal(leadGenreFights(quiet.spec), false, genre);
    assert.equal(isFieldBoss(quiet), false, `a ${genre} lead is a puzzle`);
  }
  // A lead with no genre of its own goes by the rift's first.
  const bare = { ...rift.spec.taleLead, genre: undefined };
  assert.equal(isFieldBoss({ ...rift, spec: { ...rift.spec, genres: ['verdant', 'noir'], taleLead: bare } }), false);
  assert.equal(isFieldBoss({ ...rift, spec: { ...rift.spec, genres: ['noir', 'verdant'], taleLead: bare } }), true);
  // rules.json, when it's given, has the last word.
  assert.equal(isFieldBoss(rift, { rules: { genres: { [rift.spec.taleLead.genre]: { fights: false } } } }), false);
});

test('a field boss is exactly a lead the fights will fight, over 3,000 wild rifts', { skip: !existsSync(new URL('../src/combat/bestiary.js', import.meta.url)) && 'bestiary.js isn’t written yet' }, async () => {
  // encounters.fieldFight refuses a lead bestiary.isPuzzleLead calls a puzzle; nothing else may roam
  // as a field boss, or Challenge would open no fight.
  const { isPuzzleLead } = await import('../src/combat/bestiary.js');
  const WEIGHTS = [{}, { starlight: 3, noir: 3 }, { verdant: 3, gothic: 3 }, { backhalls: 3, void: 3 }, { summit: 2, kaiju: 2, iron: 2 }];
  let bosses = 0;
  let puzzles = 0;
  for (let i = 0; i < 3000; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'agree'), tier: 5 + (i % 4), depth: 1 + (i % 9), weights: WEIGHTS[i % WEIGHTS.length] });
    if (spec.stage !== 'gaping' || !spec.taleLead) continue;
    const rift = { id: spec.id, kind: 'wild', spec, x: 40, y: -40, stage: spec.stage, held: null };
    const puzzle = isPuzzleLead(spec, { leads, words, rules });
    const what = `${spec.id}: a ${spec.taleLead.genre} lead that “${spec.taleLead.mechanic}”`;
    assert.equal(isFieldBoss(rift, { leads, rules }), !puzzle, what);
    assert.equal(isFieldBoss(rift), !puzzle, `${what}, by the built-in lists`);
    if (puzzle) puzzles += 1;
    else bosses += 1;
  }
  assert.ok(bosses >= 100 && puzzles >= 100, `${bosses} bosses and ${puzzles} puzzles`);
});

test('its home is where Phase 3 stood the lead: strayActors’ lead tile, beside the tear', () => {
  for (const rift of ALL()) {
    const lead = strayActors(rift, { walkable: nav.walkable, seed: 0, words }).find((a) => a.lead);
    assert.ok(lead, `${rift.id} has its lead`);
    assert.deepEqual(leadHome(rift, { walkable: nav.walkable }), lead.home);
    assert.deepEqual(leadRoam(rift, { walkable: nav.walkable, genres }).home, lead.home);
    assert.ok(Math.max(Math.abs(lead.home.x - rift.x), Math.abs(lead.home.y - rift.y)) === 1, 'beside the tear');
  }
});

test('a field boss roams only inside its bleed, off the tear and never behind it, and stands still at null', () => {
  for (const rift of ALL()) {
    const roam = leadRoam(rift, { walkable: nav.walkable, genres });
    const allowed = new Set(roam.allowed);
    assert.ok(allowed.size >= 5, `${rift.id} has room to roam (${allowed.size})`);
    for (const k of allowed) {
      const [x, y] = k.split(',').map(Number);
      assert.ok(bleedCover(rift, x, y, { genres }) >= STRAY_COVER, `${rift.id}: ${k} is inside the bleed`);
      assert.ok(!(x === rift.x && y === rift.y), 'never on the tear');
      assert.ok(!behindTear(rift.stage, rift.x, rift.y, x, y), 'never hidden behind it');
      assert.ok(nav.walkable(x, y), `${k} is walkable`);
    }
    const still = roam.positionAt(null);
    assert.deepEqual(still, { x: roam.home.x * 16 + 8, y: roam.home.y * 16 + FEET, dir: still.dir, moving: false });
    const visited = new Set();
    let moving = 0;
    for (let t = 0; t < roam.period * 1.5; t += 97) {
      const p = roam.positionAt(t);
      const tile = tileOf(p);
      assert.ok(allowed.has(key(tile.x, tile.y)), `${rift.id} at ${t} ms stands on ${tile.x},${tile.y}, inside its bleed`);
      assert.ok(!(tile.x === rift.x && tile.y === rift.y), 'off the tear');
      visited.add(key(tile.x, tile.y));
      if (p.moving) moving += 1;
    }
    assert.ok(visited.size >= 2 && moving > 0, `${rift.id} really roams (${visited.size} tiles)`);
  }
});

test('the roam is seeded on its own tag, hashInts(spec.seed, salt, ‘lead-roam’), and is the same every time', () => {
  const rift = BOSSES[0];
  const roam = leadRoam(rift, { walkable: nav.walkable, genres });
  const again = leadRoam(rift, { walkable: nav.walkable, genres });
  const expected = makeWanderer({ home: roam.home, allowed: new Set(roam.allowed), seed: hashInts(rift.spec.seed >>> 0, 0, 'lead-roam') });
  const salted = leadRoam(rift, { walkable: nav.walkable, genres, seed: 7 });
  let differs = false;
  for (let t = 0; t < 120000; t += 331) {
    assert.deepEqual(again.positionAt(t), roam.positionAt(t));
    assert.deepEqual(expected.positionAt(t), roam.positionAt(t));
    if (JSON.stringify(salted.positionAt(t)) !== JSON.stringify(roam.positionAt(t))) differs = true;
  }
  assert.equal(roam.period, expected.period);
  assert.ok(differs, 'another salt, another wander');
  assert.equal(leadRoam({ ...rift, spec: { ...rift.spec, tier: 3 } }, { walkable: nav.walkable }), null, 'not a field boss: no roam');
});

test('the sight ring is soft and small: three tiles round the rift', () => {
  const rift = BOSSES[0];
  assert.deepEqual(sightRing(rift), { x: rift.x, y: rift.y, radius: 3 });
  assert.equal(SIGHT_RADIUS, 3);
});

test('its arena is a 16×12 window inside the bleed, holding the tear and the lead, with the party on the vale’s side', () => {
  for (const rift of ARENAS()) {
    const result = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    assert.ok(result, `${rift.id} has an arena`);
    const { arena } = result;
    assert.deepEqual([arena.rect.w, arena.rect.h], [FIELD_ARENA.w, FIELD_ARENA.h]);
    assert.deepEqual([FIELD_ARENA.w, FIELD_ARENA.h], [16, 12]);
    for (const layer of ['cells', 'height', 'light']) assert.equal(arena[layer].length, 16 * 12, layer);
    assert.match(arena.cells, /^[#.~ oO=]+$/);
    assert.match(arena.height, /^[012]+$/);
    assert.match(arena.light, /^[LdD]+$/);
    assert.deepEqual(arena.mouths, []);
    assert.equal(arena.seed, hashInts(rift.spec.seed >>> 0, 'field', 'arena'));
    const centre = { x: arena.rect.x + 8, y: arena.rect.y + 6 };
    assert.ok(bleedCover(rift, centre.x, centre.y, { genres }) >= STRAY_COVER, 'the window is centred inside the bleed');
    const home = leadHome(rift, { walkable: nav.walkable });
    const holds = (p) => p.x >= arena.rect.x + 2 && p.x <= arena.rect.x + 13 && p.y >= arena.rect.y + 2 && p.y <= arena.rect.y + 9;
    assert.ok(holds({ x: rift.x, y: rift.y }) && holds(home), 'the tear and the lead are well inside');
    const cell = cellIn(arena);
    assert.equal(cell(home), '.', 'the lead’s home is open ground');
    const { post } = checkSeating(arena, rift);
    // The vale is east and south of the Greyreach: Milo starts on the side facing home. (On the
    // shores the only land three tiles from the lead can lie the other way; checkSeating has Milo on
    // the nearest of it to the vale's side.)
    const towardHome = (p) => Math.hypot(p.x - 31.5, p.y - 22);
    const mean = arena.entry.reduce((s, p) => s + towardHome(p), 0) / 4;
    if (!SHORE_BOSSES.includes(rift)) assert.ok(mean < towardHome({ x: post.x + 0.5, y: post.y + 0.5 }), `${rift.id}: the party is between the lead and the way home`);
    assert.deepEqual(fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres }), result, 'the same arena every time');
    assert.ok(Object.isFrozen(result) && Object.isFrozen(arena.entry) && Object.isFrozen(arena.rect));
  }
});

test('the window is the nearest clearing to the tear inside the bleed, not simply the one centred on it', () => {
  let offCentre = 0;
  for (const rift of ARENAS()) {
    const { arena } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const windows = windowsFor(rift);
    const chosen = windows.find((w) => w.x === arena.rect.x && w.y === arena.rect.y);
    assert.ok(chosen, `${rift.id}: the window is one the rule allows`);
    const clearings = windows.filter((w) => w.share >= CLEARING);
    if (clearings.length) {
      assert.ok(chosen.share >= CLEARING, `${rift.id}: at least ${CLEARING * 100}% open (${chosen.share.toFixed(2)})`);
      const nearest = Math.min(...clearings.map((w) => w.d));
      assert.ok(Math.abs(chosen.d - nearest) < 1e-9, `${rift.id}: the nearest clearing (${chosen.d.toFixed(2)} tiles off, nearest ${nearest.toFixed(2)})`);
    } else {
      assert.equal(chosen.share, Math.max(...windows.map((w) => w.share)), `${rift.id}: no clearing, so the most open window`);
    }
    if (chosen.d > 0) offCentre += 1;
  }
  // Under the crags the window centred on the tear is mostly mountain, and the clearings run further
  // out than the nearest one: so centring on the tear, or taking any clearing, would both show here.
  for (const rift of CRAG_BOSSES) {
    const windows = windowsFor(rift);
    const centred = windows.find((w) => w.d === 0);
    assert.ok(centred && centred.share < CLEARING, `${rift.id}: the window on the tear isn’t a clearing (${centred?.share.toFixed(2)})`);
    const clearings = windows.filter((w) => w.share >= CLEARING).map((w) => w.d);
    assert.ok(clearings.length >= 2 && Math.max(...clearings) > Math.min(...clearings), `${rift.id}: clearings near and further off`);
  }
  assert.ok(offCentre >= CRAG_BOSSES.length, `${offCentre} windows moved off the tear`);
});

test('nobody stands on the tear or behind it in a fight: those tiles are high cover, and the lead’s post is beside them', () => {
  for (const rift of ARENAS()) {
    const { arena } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const cell = cellIn(arena);
    const tear = onTear(rift);
    const tiles = tearTiles(rift);
    assert.deepEqual(tiles.map((p) => [p.x - rift.x, p.y - rift.y]), [[0, 0], [0, -1], [0, -2]], 'the tear and the two tiles behind it');
    for (const p of tiles) {
      assert.ok(behindTear('gaping', rift.x, rift.y, p.x, p.y) || (p.x === rift.x && p.y === rift.y));
      assert.ok(['O', '#', '~', ' '].includes(cell(p)), `${rift.id}: ${key(p.x, p.y)} is where the tear stands (${cell(p)})`);
    }
    assert.equal(cell(rift), 'O', 'the tear itself is high cover');
    for (const p of arena.entry) assert.ok(!tear(p), 'no hero starts on the tear');
    // The lead's post as §7.3's encounters take it. It never covers the tear or the tiles behind it,
    // and it's right beside them, except on the shores, where the land beside the tear is too small
    // to seat the party.
    const post = leadPostFor(arena, rift);
    assert.ok(!footOf(post).some(tear), `${rift.id}: the lead’s footprint is off the tear and what’s behind it`);
    const d = Math.hypot(post.x + 0.5 - rift.x, post.y + 0.5 - rift.y);
    if (!SHORE_BOSSES.includes(rift)) assert.ok(d <= 2.5, `${rift.id}: and right beside it (${d.toFixed(2)})`);
  }
});

test('the party starts at least three tiles from the lead’s post, and the fights post the lead exactly there', () => {
  // The post is encounters.fieldFight's (the free 2×2 nearest the tear the party can walk to), so the
  // starts are seated round it rather than round the lead's roaming home; checkSeating recomputes it.
  let wide = 0;
  for (const rift of ARENAS()) {
    const { arena } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const { gap } = checkSeating(arena, rift);
    assert.ok(gap >= 3, `${rift.id}: three tiles or more (${gap})`);
    if (gap > 3) wide += 1;
  }
  assert.ok(wide >= 1, 'some start further off, where the land lies that way');
  // Where the post and the home are on either side of the tear, a party seated by the home started
  // right beside the post; now it's three tiles off.
  for (const rift of SPLIT_BOSSES) {
    const { arena } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const post = leadPostFor(arena, rift);
    const home = leadHome(rift, { walkable: nav.walkable });
    assert.ok(Math.sign(post.x + 0.5 - rift.x) === -Math.sign(home.x - rift.x), `${rift.id}: the post and the home are across the tear`);
    assert.ok(Math.min(...arena.entry.map((p) => gapTo(p, post))) >= 3, `${rift.id}: the party starts clear of the post`);
  }
});

test('on a narrow shore, where the tear cuts the lead’s home off, the fight moves to the land the party can stand on', () => {
  for (const rift of SHORE_BOSSES) {
    const home = leadHome(rift, { walkable: nav.walkable });
    const roam = leadRoam(rift, { walkable: nav.walkable, genres });
    assert.ok(roam && roam.allowed.length <= 5, `${rift.id} roams a tiny spit (${roam?.allowed.length} tiles)`);
    assert.ok(leadRoam(rift, { walkable: nav.walkable, genres, worldgen: world, wilds }), `${rift.id} still roams when its arena is checked`);
    const result = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    assert.ok(result, `${rift.id} can be challenged`);
    const { arena } = result;
    const cell = cellIn(arena);
    // The home's own walk in the arena is too small to seat four at three tiles from any post in it.
    const homeWalk = walkFrom(arena, [home]);
    const seatable = posts(arena, rift).filter((p) => homeWalk.has(key(p.x, p.y))).some((p) => [...homeWalk]
      .map((k) => k.split(',').map(Number)).filter(([x, y]) => cell({ x, y }) === '.' && gapTo({ x, y }, p) >= 3).length >= 4);
    assert.equal(seatable, false, `${rift.id}: nobody could be seated round the home`);
    const post = leadPostFor(arena, rift);
    assert.ok(!homeWalk.has(key(post.x, post.y)), `${rift.id}: so the lead is posted on the land beyond`);
    checkSeating(arena, rift);
  }
  // The first shore's nearest post is in a pocket beside the tear too small for four at three tiles:
  // the next nearest walk is taken.
  const [spit] = SHORE_BOSSES;
  const { arena } = fieldArena(spit, { worldgen: world, wilds, walkable: nav.walkable, genres });
  const nearest = posts(arena, spit).sort((a, b) => a.d - b.d)[0];
  const post = leadPostFor(arena, spit);
  assert.ok(!walkFrom(arena, [post]).has(key(nearest.x, nearest.y)), 'the nearest post’s pocket is passed over');
});

test('in the arena, rocks and bushes are low cover, kept trees high cover, and crags stay blocking with the mountains', () => {
  // COMBAT §4.1: trees are high cover, rocks and bushes low cover, and crags stay blocking high cover.
  const LOW = ['rock', 'rock.basalt', 'bush', 'bush.berry'];
  for (const kind of LOW) assert.equal(FIELD_COVER[kind], 'o', `${kind} is low cover`);
  for (const kind of ['tree', 'tree.birch', 'tree.blossom', 'pine', 'pine.snow', 'crag', 'crag.snow']) assert.equal(FIELD_COVER[kind], 'O', `${kind} is high cover`);
  const counted = { rock: 0, bush: 0, tree: 0, crag: 0 };
  for (const rift of ALL()) {
    const { arena, hiddenTrees } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const cell = cellIn(arena);
    const tear = onTear(rift);
    const hidden = new Set(hiddenTrees);
    for (const o of wilds.objectsIn(arena.rect.x, arena.rect.y, arena.rect.x + 15, arena.rect.y + 11)) {
      if (tear(o) || o.x < arena.rect.x || o.x >= arena.rect.x + 16 || o.y < arena.rect.y || o.y >= arena.rect.y + 12) continue;
      const stem = o.kind.split('.')[0];
      if (LOW.includes(o.kind) && o.blocks !== false) {
        assert.equal(cell(o), 'o', `${rift.id}: the ${o.kind} at ${key(o.x, o.y)} is low cover`);
        counted[stem] += 1;
      } else if (o.wood) {
        assert.equal(cell(o), hidden.has(o.place || o.id) ? '.' : 'O', `${rift.id}: the ${o.kind} at ${key(o.x, o.y)}`);
        if (!hidden.has(o.place || o.id)) counted.tree += 1;
      } else if (stem === 'crag') {
        // Crags only stand on mountains: wall, which blocks movement and sight and is high cover just as 'O' is.
        assert.equal(world.terrainAt(o.x, o.y), T.MOUNTAIN);
        assert.equal(cell(o), '#', `${rift.id}: the crag at ${key(o.x, o.y)} blocks`);
        counted.crag += 1;
      }
    }
  }
  assert.ok(counted.rock >= 5 && counted.bush >= 5 && counted.tree >= 5 && counted.crag >= 5, `checked ${JSON.stringify(counted)}`);
});

test('trees in the arena thin to a fifth for the fight only: their place ids are hidden, and the wilds are never written', () => {
  for (const rift of [FOREST_BOSS, ...GROVE_BOSSES]) thinning(rift);
  // The groves really have trees beside the tear and the lead, so keeping none of them is a real rule.
  for (const rift of GROVE_BOSSES) {
    const home = leadHome(rift, { walkable: nav.walkable });
    const tear = onTear(rift);
    const beside = wilds.objectsIn(rift.x - 3, rift.y - 3, rift.x + 3, rift.y + 3)
      .filter((o) => o.wood && !tear(o) && (cheb(o, rift) <= 1 || cheb(o, home) <= 1));
    assert.ok(beside.length >= 2, `${beside.length} trees stand beside the grove’s tear and lead`);
    const { hiddenTrees } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    for (const o of beside) assert.ok(hiddenTrees.includes(o.place || o.id), `the ${o.kind} at ${key(o.x, o.y)} is hidden`);
  }
});

function thinning(rift) {
  const before = JSON.stringify(wilds.objectsIn(rift.x - 30, rift.y - 30, rift.x + 30, rift.y + 30));
  const result = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
  const after = JSON.stringify(wilds.objectsIn(rift.x - 30, rift.y - 30, rift.x + 30, rift.y + 30));
  assert.equal(after, before, 'not one wild object changed');
  assert.ok(!JSON.stringify(result).includes('felled'), 'nothing about felling in the arena');
  const { arena, hiddenTrees } = result;
  const trees = wilds.objectsIn(arena.rect.x, arena.rect.y, arena.rect.x + 15, arena.rect.y + 11).filter((o) => o.wood);
  assert.ok(trees.length >= 15, `a proper forest (${trees.length} trees)`);
  const hidden = new Set(hiddenTrees);
  assert.equal(hidden.size, hiddenTrees.length, 'each hidden once');
  assert.deepEqual([...hiddenTrees], [...hiddenTrees].sort());
  for (const id of hiddenTrees) assert.ok(trees.some((o) => (o.place || o.id) === id), `${id} is a tree in the arena`);
  const kept = trees.filter((o) => !hidden.has(o.place || o.id));
  // §7.7's number as a literal, so a change to the module's constant can't move what's expected.
  assert.equal(TREES_KEPT, 0.2, 'trees thin to 20%');
  assert.equal(kept.length, Math.round(0.2 * trees.length), `a fifth kept (${kept.length} of ${trees.length})`);
  assert.equal(kept.length + hidden.size, trees.length);
  const cell = cellIn(arena);
  const tear = onTear(rift);
  for (const o of kept) assert.equal(cell(o), 'O', 'a kept tree is high cover');
  for (const o of trees.filter((t) => hidden.has(t.place || t.id))) {
    assert.equal(cell(o), tear(o) ? 'O' : '.', tear(o) ? 'a hidden tree behind the tear leaves the tear standing' : 'a hidden tree leaves open ground');
  }
  const home = leadHome(rift, { walkable: nav.walkable });
  for (const o of kept) {
    assert.ok(cheb(o, rift) > 1, 'no tree kept beside the tear');
    assert.ok(cheb(o, home) > 1, 'none beside the lead');
  }
}

test('water in the arena is water: it blocks the way but not the view, unlike the mountains’ wall', () => {
  let wet = 0;
  let wall = 0;
  for (const rift of [RIVER_BOSS, ...ALL()]) {
    const { arena } = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const cell = cellIn(arena);
    for (let y = arena.rect.y; y < arena.rect.y + 12; y += 1) {
      for (let x = arena.rect.x; x < arena.rect.x + 16; x += 1) {
        const t = inRing(x, y) ? null : world.terrainAt(x, y);
        if (t !== null && WATER.includes(t)) {
          assert.equal(cell({ x, y }), '~', `${rift.id}: the water at ${key(x, y)}`);
          if (rift === RIVER_BOSS) wet += 1;
        } else {
          assert.notEqual(cell({ x, y }), '~', `${rift.id}: ${key(x, y)} is dry land`);
          if (t === T.MOUNTAIN) { assert.equal(cell({ x, y }), '#'); wall += 1; }
        }
      }
    }
  }
  assert.ok(wet >= 10, `the river boss’s window holds a run of river (${wet} tiles)`);
  assert.ok(wall >= 10, `and the crags’ windows mountain wall (${wall} tiles)`);
});

test('the arena depends only on the rift and the wilds, so a fight rebuilt from expedition.source after a relaunch starts where it did', () => {
  // §8.3 saves a field boss's source as { seed, tier, depth, weights, x, y }, and §12.4 rebuilds the
  // FightSpec from it on resume. In a fresh world, from that source alone, the arena is the same,
  // start tiles and all. Where Milo stood, or anything else passed, changes nothing.
  const fresh = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const freshWilds = createWilds({ worldgen: fresh, maxChunks: 400 });
  const freshNav = createNav({ worldgen: fresh, wildBlocked: freshWilds.blocked, extraBlocked: (x, y) => freshWilds.ringBlocked(x, y, 1) });
  const freshRiftgen = createRiftgen({ words, genres });
  for (const rift of [...BOSSES, ...SHORE_BOSSES, ...SPLIT_BOSSES]) {
    const { day, cx, cy } = FOUND.get(rift.id);
    const spawn = world.wildRiftSpawns(cx, cy, day, { wardRadius: 0 })
      .find((s) => riftgen.wildRift({ seed: s.seed, tier: s.tier, depth: s.depth, weights: s.weights }).id === rift.id);
    assert.ok(spawn, `${rift.id}: its spawn`);
    const source = JSON.parse(JSON.stringify({ seed: spawn.seed, tier: spawn.tier, depth: spawn.depth, weights: spawn.weights, x: rift.x, y: rift.y }));
    const spec = freshRiftgen.wildRift({ seed: source.seed, tier: source.tier, depth: source.depth, weights: source.weights });
    const rebuilt = { id: spec.id, key: null, kind: 'wild', spec, x: source.x, y: source.y, stage: spec.stage, held: null };
    const before = fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres });
    const after = fieldArena(rebuilt, { worldgen: fresh, wilds: freshWilds, walkable: freshNav.walkable, genres });
    assert.deepEqual(after, before, `${rift.id}: rebuilt from its source, the same arena and the same starts`);
    const home = leadHome(rift, { walkable: nav.walkable });
    for (const from of [home, { x: rift.x + 9, y: rift.y - 7 }, { x: before.arena.rect.x, y: before.arena.rect.y }]) {
      const options = { worldgen: world, wilds, walkable: nav.walkable, genres, from };
      assert.deepEqual(fieldArena(rift, options), before, `${rift.id}: where Milo stood doesn’t move the start`);
    }
  }
});

/** A made-up world for shapes the real ones rarely show: grass where `land` says, mountain elsewhere, no wild objects. */
function madeUp(land) {
  const walkable = (x, y) => Boolean(land(x, y));
  return {
    worldgen: { inHeart: () => false, terrainAt: (x, y) => (land(x, y) ? T.GRASS : T.MOUNTAIN), walkable },
    wilds: { objectsIn: () => [], blocked: () => false },
    walkable,
  };
}
const mod = (n, m) => ((n % m) + m) % m;
const comb = (x, y) => !(mod(x, 2) === 0 && mod(y, 2) === 0);
// Round the tear every tile with both coordinates even is rock: three tiles in four are open, so the
// windows there are clearings, but none holds a free 2×2 for the lead. Nine tiles east, the ground opens.
const COMB_BOSS = bossAt(401, -401);
const COMB = madeUp((x, y) => x >= COMB_BOSS.x + 9 || comb(x, y));
// The same rock, with two whole columns of it (four tiles either side of the tear) and a single 2×2
// at the east edge, eight and nine tiles out. The windows that reach it are just under the clearing
// line (113 of 192 open) and the rest just over it (117), so no clearing can seat the fight.
const THIN = madeUp((x, y) => {
  const dx = x - COMB_BOSS.x;
  if (dx === 9) return y === COMB_BOSS.y || y === COMB_BOSS.y + 1;
  return dx >= -10 && dx <= 8 && dx !== -4 && dx !== 4 && comb(x, y);
});
// A scrap of land five tiles by three round the tear: the lead's 2×2 fits, but three tiles from it
// there's room for only three.
const SCRAP_BOSS = bossAt(401, -401, 1);
const SCRAP = madeUp((x, y) => Math.abs(x - SCRAP_BOSS.x) <= 2 && Math.abs(y - SCRAP_BOSS.y) <= 1);
// Three by three: no free 2×2 beside the tear at all.
const SPECK_BOSS = bossAt(401, -401, 2);
const SPECK = madeUp((x, y) => Math.abs(x - SPECK_BOSS.x) <= 1 && Math.abs(y - SPECK_BOSS.y) <= 1);
// A 2×2 just east of the tear, touching a patch of five by four only across a corner whose two
// sides are rock: nobody walks that corner, so the 2×2 is a pocket of its own.
const CORNER_BOSS = bossAt(401, -401, 3);
const CORNER = madeUp((x, y) => {
  const dx = x - CORNER_BOSS.x;
  const dy = y - CORNER_BOSS.y;
  return (dx >= 1 && dx <= 2 && dy >= 0 && dy <= 1) || (dx >= 3 && dx <= 7 && dy >= 2 && dy <= 5);
});
const madeUpArena = (rift, made) => fieldArena(rift, { worldgen: made.worldgen, wilds: made.wilds, walkable: made.walkable, genres });

/** Every window the rule allows on made-up ground, recomputed: its share of open ground and whether it has a free 2×2. */
function madeUpWindows(rift, made) {
  const home = leadHome(rift, { walkable: made.walkable });
  const tear = onTear(rift);
  const open = (x, y) => made.walkable(x, y) && !tear({ x, y });
  const windows = [];
  for (let cy = rift.y - 24; cy <= rift.y + 24; cy += 1) {
    for (let cx = rift.x - 24; cx <= rift.x + 24; cx += 1) {
      if (bleedCover(rift, cx, cy, { genres }) < STRAY_COVER) continue;
      const rect = { x: cx - 8, y: cy - 6 };
      const inside = (p) => p.x >= rect.x + 2 && p.x <= rect.x + 13 && p.y >= rect.y + 2 && p.y <= rect.y + 9;
      if (!inside(rift) || !inside(home)) continue;
      let n = 0;
      let seat = false;
      for (let y = rect.y; y < rect.y + 12; y += 1) {
        for (let x = rect.x; x < rect.x + 16; x += 1) {
          if (open(x, y)) n += 1;
          if (x < rect.x + 15 && y < rect.y + 11 && open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1)) seat = true;
        }
      }
      windows.push({ ...rect, share: n / 192, d: Math.hypot(cx - rift.x, cy - rift.y), seat });
    }
  }
  return windows;
}

test('a window the fight can’t be seated in passes to the next nearest clearing', () => {
  const rift = COMB_BOSS;
  const result = madeUpArena(rift, COMB);
  assert.ok(result, 'it has an arena');
  const { arena } = result;
  checkSeating(arena, rift);
  const windows = madeUpWindows(rift, COMB);
  const chosen = windows.find((w) => w.x === arena.rect.x && w.y === arena.rect.y);
  assert.ok(chosen && chosen.share >= CLEARING && chosen.seat, 'a clearing the lead can stand in');
  const centred = windows.find((w) => w.d === 0);
  assert.ok(centred.share >= CLEARING && !centred.seat, 'the window on the tear is a clearing with nowhere for the lead');
  const nearer = windows.filter((w) => w.share >= CLEARING && w.d < chosen.d);
  assert.ok(nearer.length >= 1 && nearer.every((w) => !w.seat), `the ${nearer.length} nearer clearings are passed over, and only because they can’t seat it`);
  assert.ok(windows.filter((w) => w.share >= CLEARING && w.seat).every((w) => w.d >= chosen.d), 'and none that could is nearer');
});

test('when no clearing can seat the fight, the most open window that can is taken', () => {
  const rift = COMB_BOSS;
  const result = madeUpArena(rift, THIN);
  assert.ok(result, 'it has an arena');
  const { arena } = result;
  checkSeating(arena, rift);
  const windows = madeUpWindows(rift, THIN);
  const clearings = windows.filter((w) => w.share >= CLEARING);
  assert.ok(clearings.length >= 1 && clearings.every((w) => !w.seat), `${clearings.length} clearings, none with room for the lead`);
  const chosen = windows.find((w) => w.x === arena.rect.x && w.y === arena.rect.y);
  assert.ok(chosen && chosen.share < CLEARING && chosen.seat, `a window under the line (${chosen?.share.toFixed(3)}) the lead can stand in`);
  assert.equal(chosen.share, Math.max(...windows.filter((w) => w.seat).map((w) => w.share)), 'the most open of those');
});

test('two patches that touch only across a corner with rock on both sides are two walks', () => {
  // The pocket beside the tear holds the nearest 2×2 but no room for the party, and nobody can step
  // across that corner to it, so the lead is posted in the patch beyond, where the party starts.
  const rift = CORNER_BOSS;
  const { arena } = madeUpArena(rift, CORNER);
  const { post } = checkSeating(arena, rift);
  assert.deepEqual(post, { x: rift.x + 3, y: rift.y + 2 }, 'the patch’s nearest 2×2');
  assert.ok(!walkFrom(arena, [post]).has(key(rift.x + 1, rift.y)), 'the pocket isn’t in its walk');
});

test('on a scrap of land with no room at three tiles, the party starts two from the lead, never beside it', () => {
  const { arena } = madeUpArena(SCRAP_BOSS, SCRAP);
  const { gap } = checkSeating(arena, SCRAP_BOSS);
  assert.equal(gap, 2);
});

test('with nowhere to seat the fight there’s no arena, and a lead checked against its arena doesn’t roam', () => {
  const rift = SPECK_BOSS;
  assert.equal(madeUpArena(rift, SPECK), null);
  assert.ok(leadRoam(rift, { walkable: SPECK.walkable, genres }), 'on its own it would roam its speck of land');
  assert.equal(leadRoam(rift, { walkable: SPECK.walkable, genres, worldgen: SPECK.worldgen, wilds: SPECK.wilds }), null,
    'but not once its arena is checked: a lead that roams can always be challenged');
  // The real ones: of 21,799 field bosses scanned over three worlds, two have no arena, both on the
  // same two-tile islet in hushlands' south-western sea (the tear's tile and the lead's), where
  // there's no ground at all for the party. Neither roams once its arena is checked.
  const islet = realRift('rift:hc38ga', 20177, -9, 9);
  assert.ok(isFieldBoss(islet), 'it is a field boss by the rift alone');
  assert.equal(fieldArena(islet, { worldgen: world, wilds, walkable: nav.walkable, genres }), null);
  assert.equal(leadRoam(islet, { walkable: nav.walkable, genres }).allowed.length, 1, 'it stands on its one tile');
  assert.equal(leadRoam(islet, { walkable: nav.walkable, genres, worldgen: world, wilds }), null);
  let land = 0;
  for (let y = islet.y - 8; y <= islet.y + 8; y += 1) for (let x = islet.x - 8; x <= islet.x + 8; x += 1) if (nav.walkable(x, y)) land += 1;
  assert.equal(land, 2, 'the islet is the tear’s tile and the lead’s, and nothing else for eight tiles round');
  // A real boss roams the same with the check or without.
  for (const boss of [BOSSES[0], ...SHORE_BOSSES]) {
    const plain = leadRoam(boss, { walkable: nav.walkable, genres });
    const checked = leadRoam(boss, { walkable: nav.walkable, genres, worldgen: world, wilds });
    assert.deepEqual({ ...checked, positionAt: null }, { ...plain, positionAt: null }, boss.id);
    for (let t = 0; t < 60000; t += 997) assert.deepEqual(checked.positionAt(t), plain.positionAt(t));
  }
});

const D_FILES = ['../src/combat/encounters.js', '../content/combat/rules.json', '../content/combat/leads.json', '../content/combat/foes.json'];
test('the fights’ own post rule puts the lead where the party was seated round it', { skip: !D_FILES.every((f) => existsSync(new URL(f, import.meta.url))) && 'the fights aren’t written yet' }, async () => {
  const { fieldFight } = await import('../src/combat/encounters.js');
  const cases = [...ARENAS().map((rift) => [rift, fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres })]),
    [COMB_BOSS, madeUpArena(COMB_BOSS, COMB)], [COMB_BOSS, madeUpArena(COMB_BOSS, THIN)], [SCRAP_BOSS, madeUpArena(SCRAP_BOSS, SCRAP)],
    [CORNER_BOSS, madeUpArena(CORNER_BOSS, CORNER)]];
  for (const [rift, { arena }] of cases) {
    const fight = fieldFight(rift, arena, { roadLevel: 5, partySize: 4, rules, leads, foes, words });
    assert.ok(fight, `${rift.id}: a field boss always has a fight`);
    const { post } = fight.leadUnit;
    assert.deepEqual(post, leadPostFor(arena, rift), `${rift.id}: the post checkSeating found`);
    const gap = Math.min(...arena.entry.map((p) => gapTo(p, post)));
    assert.ok(gap >= (rift === SCRAP_BOSS ? 2 : 3), `${rift.id}: the party starts ${gap} tiles from the lead`);
  }
});

test('no arena for a rift that isn’t a field boss, or with no wilds to read', () => {
  const rift = BOSSES[0];
  assert.equal(fieldArena({ ...rift, spec: { ...rift.spec, tier: 2 } }, { worldgen: world, wilds, walkable: nav.walkable }), null);
  assert.equal(fieldArena(rift, { worldgen: world }), null);
  assert.equal(fieldArena(rift, {}), null);
});
