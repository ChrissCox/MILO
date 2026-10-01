// Encounters (CONTRACT-PHASE4.md §7.3, §4.10, §4.13, §5.1, §5.3; COMBAT.md §9 and §11): what waits
// in each fight room of an Elsewhere or a cave, as FightSpecs the combat kernel starts from.
//
//   prepareElsewhere  riftgen.layout → a plain buildElsewhere (for what's really walkable) →
//                     arenaPass → buildElsewhere with { plan, encounters: null } → planEncounters
//   prepareCave       the same for a cave's layout, with creatures and canon foes, a Mimic chest and
//                     a locked chest
//   fieldFight        a field boss's fight in the wilds, in the arena E's fieldArena cuts
//
// Budgets are §4.10's, counted at the room's foe level n, so a room is the same room whatever level
// the party brings: strays cost by their level (an elite as one level higher, a lackey as two
// below the room), a Tale-lead 30 or 40 a bar times the party's share, with the one helper §4.10's
// table names where it fits (STAGE_ROOMS). Caps: 8 foes and 3 kinds a room (a cheering stray's
// kind counted), one elite until depth 7. A room too cramped to seat all it picked leaves the rest
// out and takes their cost off its budget, so it pays for what stands in it. Bright and Backhalls
// leads, and every lead with a no-fight mechanic, never fight (isPuzzleLead); bright strays in a
// fusion stand aside and cheer (side 'neutral', costing nothing).
//
// Inside every arena the fight keeps its way clear: the lead's mechanic objects, and a canon foe's
// bow objects (a forge, a lectern, a bell, a riddle board: BOW_OBJECTS), are placed by the bush
// rule on the party's own walk (arenaWalk: from the start tiles, eight ways, as B's grid moves), so
// nothing cuts a tile off and the lead and every object keep a side the party can reach; every foe
// stands on ground that walk reaches, and never inside another fight's arena (the lead's 12×9
// window takes in its neighbours' floors; a Mimic fights in its chest room's arena).
//
// A cave's fight ids carry the day number (§5.1), so prepareCave refuses without one (caveDay).
// What a fetchfox really pinched comes back in its room's loot: the payer reads it from the
// fight's events (tonicsTaken) and passes it to rewardsFor as `taken`.
//
// Pure and seeded: hashInts(spec.seed, 'encounters') for the picks, fightSeed =
// hashInts(sceneSeed, roomId, 'fight') per room, and hashInts(fightSeed, 'loot') for the rewards.
// Specs are Long Road and mode-free.
import { createRng, hashInts } from '../world/rng.js';
import { arenaPass, bfs } from '../world/arena.js';
import { buildElsewhere } from '../world/elsewhere.js';
import { LEAD_ROLE, foeUnit, freezeDeep, isPuzzleLead, leadMechanic, leadShare, leadUnit, roomBudget, strayUnit } from './bestiary.js';
import { WALKABLE_OBJECTS } from './grid.js';

/** §4.10's foe level by tier (rules.json's `tiers`; used when no rules are passed). */
export const TIER_LEVELS = Object.freeze([1, 2, 4, 5, 7, 9, 10, 11]);
/** §4.10's budgets (rules.json's `budgets`; used when no rules are passed). */
export const BUDGETS = Object.freeze({
  cost: Object.freeze({ '-4': 10, '-3': 15, '-2': 20, '-1': 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 }), below: 5,
  for4: Object.freeze({ trivial: 40, low: 60, moderate: 80, severe: 120 }), fewer: Object.freeze({ trivial: 10, low: 15, moderate: 20, severe: 30 }),
  depth: Object.freeze({ from: 3, perHero: 2, max: 10 }), affixes: Object.freeze({ crowded: 1.25, lonely: 0.6 }),
  caps: Object.freeze({ foes: 8, kinds: 3, eliteDepth: 7 }), leadBar: Object.freeze({ 2: 30, 1: 40 }), surfaceShare: 0.15,
});
/**
 * Each stage's rooms (§4.10's table): the mix of its stray rooms, and the one helper its Tale-lead
 * may bring, the first of `helpers` that fits what the lead leaves of the room's budget: "with a
 * lackey" at hairline, "with a stray a level below" at open (a lackey when a smaller party's share
 * leaves too little for that stray), and "alone" at gaping. Never more than that one, whatever
 * depth or Crowded adds to the budget.
 */
export const STAGE_ROOMS = Object.freeze({
  hairline: Object.freeze({ mix: 'low', helpers: Object.freeze(['lackey']) }),
  open: Object.freeze({ mix: 'moderate', helpers: Object.freeze(['below', 'lackey']) }),
  gaping: Object.freeze({ mix: 'moderate', helpers: Object.freeze([]) }),
});
/** A cave's far room (its riftgen 'lead' room, with no lead in it): an ordinary room, Moderate. */
export const CAVE_FAR_ROOM = 'moderate';
/** The affixes a fight cares about (FightSpec.affixes). */
export const FIGHT_AFFIXES = Object.freeze(['crowded', 'lonely', 'colossal', 'sleepy', 'flooded', 'overgrown', 'snowbound', 'smoggy', 'candlelit']);
/** Affixes that lay a surface on 15% of a fight room's floor (§4.10, Decided). */
export const AFFIX_SURFACES = Object.freeze({ flooded: 'water', overgrown: 'foliage', snowbound: 'ice', smoggy: 'smog', candlelit: 'candle-wax' });
/** A mechanic object's first state (§5.3's closed list). */
export const OBJECT_START = Object.freeze({
  junction: 'off', lamp: 'lit', candle: 'lit', lever: 'up', line: 'running', console: 'idle', lectern: 'idle', alibi: 'standing',
  clue: 'hidden', 'plan-tile': 'clear', breaker: 'on', forge: 'cold', bell: 'still', 'riddle-board': 'idle', chest: 'shut',
});
/**
 * The objects a canon foe's bow works with (§9.8, §6.6 Bows.actions), by its foes.json bow kind:
 * the cinder golems' forge (an Interact, then a Light hit), the Unwritten's lectern (2 actions), the
 * drowned bell-ringers' bell rung at the lectern, and the Tollmen's riddle board. A room holding
 * such a foe stands one of each against a wall, by the bush rule on the party's walk, in its
 * OBJECT_START state; foes that share an object (a lectern) share the one.
 */
export const BOW_OBJECTS = Object.freeze({
  forge: Object.freeze(['forge']), read: Object.freeze(['lectern']), bell: Object.freeze(['bell', 'lectern']), riddle: Object.freeze(['riddle-board']),
});
/**
 * Abilities that pinch a tonic (a `take` effect, §6.3), and the tonic each takes. §9.8, Decided:
 * what one really pinched comes back in that room's loot. Each pinches at most once a fight.
 */
export const PINCHES = Object.freeze({ 'fetchfox-pinch': 'cordial' });
const BRIGHT = new Set(['verdant', 'starlight', 'summit']);
const DIRS4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
// B's grid walks eight ways; a diagonal step never cuts a corner between two blocked tiles.
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const keyOf = (x, y) => `${x},${y}`;

/**
 * Whether a hero walks onto an object of this kind (a clue, a plan tile) rather than being blocked
 * by it: B's grid.WALKABLE_OBJECTS, the rule's one owner (§18.2 item 13); every other object blocks.
 */
export const walksOnto = (kind) => WALKABLE_OBJECTS.has(kind);

// ---------- levels, budgets, rewards ----------

/**
 * The foe level n a place's rooms run at, and its deep rank (§4.10): a wild rift or ladder rung by
 * its tier, a cave by its mouth's tier, a real or story rift at the party's Road level. Past tier
 * 8, every 3 depths adds a deep rank. At party levels 1 and 2 nothing counts as more than 2 levels
 * above the party, so n is capped at roadLevel + 2 there, and a capped room has no deep rank (a
 * deep rank is worth more than the level the cap took away). Extra option: rules (for rules.tiers).
 */
export function roomLevel(spec, { kind = 'wild', roadLevel = 1, rules = null } = {}) {
  const tiers = rules?.tiers || TIER_LEVELS;
  const road = Math.max(1, Math.floor(roadLevel) || 1);
  const tier = Math.max(1, Math.min(tiers.length, Math.floor(spec?.tier) || 1));
  const n = kind === 'real' || kind === 'story' ? road : tiers[tier - 1];
  const every = rules?.deepRank?.every ?? 3;
  const deepRank = kind !== 'real' && kind !== 'story' && tier >= tiers.length ? Math.max(0, Math.floor(((Math.floor(spec?.depth) || 1) - 8) / every)) : 0;
  if (road <= 2 && n > road + 2) return { n: road + 2, deepRank: 0 };
  return { n, deepRank };
}

/** A room's budget (§4.10). Extra argument: rules (for rules.budgets). */
export function budgetFor(role, partySize, depth, rules = null) {
  return roomBudget(rules?.budgets || BUDGETS, role, partySize, depth);
}

/** What a stray of level L costs a room at level n (an elite as one higher, a lackey as two below the room). */
export function unitCost(budgets, n, { rank, level }) {
  const rel = rank === 'lackey' ? -2 : (rank === 'elite' ? level + 1 : level) - n;
  if (rel < -4) return budgets.below;
  if (rel > 4) return Infinity;
  return budgets.cost[String(rel)];
}

/** A Tale-lead's cost: 30 a bar from 2 below, 40 from 1 below, times the party's share (§4.10). */
export function leadCost(rules, stage, partySize, depth) {
  const below = rules.lead.below[stage];
  return rules.lead.phases[stage] * rules.budgets.leadBar[String(below)] * leadShare(rules.budgets, LEAD_ROLE[stage], partySize, depth);
}

/** The words a real rift's lead yields with: 'Settle me all you like. <cause>'. */
export function realLine(cause) {
  const text = String(cause ?? '').trim();
  return text ? `Settle me all you like. ${text}` : 'Settle me all you like.';
}

const perWeight = (rules, n) => {
  const table = rules.road.perWeight;
  if (n <= 0) return 0;
  if (n <= table.length) return table[n - 1];
  return table[table.length - 1] + rules.road.past12 * (n - table.length);
};

function kaijuName(bank, rng) {
  return rng.pick(bank.namePrefixes || ['Gor']) + rng.pick(bank.nameSuffixes || ['gon']);
}

/**
 * A fight's Rewards (§4.13): Road XP = weight × the table at n, +45 per weight per deep rank; Marks
 * = 4 × weight × n (both unrounded: the payer floors once, after a bow's ×1.25); essences 30% per
 * stray room (one of the room's genre) and 2–4 from a Tale-lead; a relic 20% of the time, named
 * the way riftgen names relics; tonics 25% per room, a cordial 70% of the time. A real rift's
 * Elsewhere pays no essences or relics, and a cave has no genre to give them. Deep ranks add 10%
 * to each chance. Seeded from hashInts(fight.seed, 'loot').
 *
 * Extra option `taken` ({ cordial, brew }): what the room's foes really pinched from the party's
 * carry, from the fight's events (tonicsTaken). It comes back in the loot (§9.8, Decided), never
 * more than the room's pinchers could take (one each a fight). FightSpec.rewards is built before
 * the fight, so it holds none; whoever pays a won room passes `taken` to get the room's Rewards
 * with its pinched tonics back. The seeded loot is the same either way.
 */
export function rewardsFor(fight, { rules, words, taken = null }) {
  const rng = createRng(hashInts(fight.seed >>> 0, 'loot'));
  const weight = fight.weight;
  const n = fight.level;
  const deepRank = fight.deepRank || 0;
  const r = rules.rewards;
  const boost = 1 + (rules.deepRank?.loot ?? 0.1) * deepRank;
  const xp = weight * perWeight(rules, n) + (rules.road.deep ?? 45) * weight * deepRank;
  const marks = r.marks * weight * n;
  const genre = fight.lead ? (fight.leadUnit?.genres?.[0] || fight.genres[0]) : fight.genres[0];
  const bank = genre ? words?.genres?.[genre] : null;
  const essences = [];
  let relic = null;
  // Every draw happens in the same order whatever pays, so the loot never shifts.
  const essenceRoll = rng.next();
  const essenceCount = rng.int(r.leadEssences[0], r.leadEssences[1]);
  const essencePick = rng.next();
  const relicRoll = rng.next();
  const relicWords = [rng.next(), rng.next(), rng.next()];
  const tonicRoll = rng.next();
  const cordialRoll = rng.next();
  const pays = Boolean(bank) && !fight.real;
  if (pays && bank.essences?.length) {
    const name = bank.essences[Math.floor(essencePick * bank.essences.length)];
    if (fight.lead) essences.push({ name, genre, qty: essenceCount });
    else if (essenceRoll < Math.min(1, r.essence * boost)) essences.push({ name, genre, qty: 1 });
  }
  if (pays && relicRoll < Math.min(1, r.relic * boost) && bank.relics?.length && bank.adjectives?.length) {
    const pick = (list, u) => list[Math.floor(u * list.length)];
    const owner = bank.names?.length ? pick(bank.names, relicWords[2]) : kaijuName(bank, createRng(hashInts(fight.seed >>> 0, 'relic-owner')));
    relic = { name: `${pick(bank.adjectives, relicWords[0])} ${pick(bank.relics, relicWords[1])} of ${owner}`, genre };
  }
  const tonics = { cordial: 0, brew: 0 };
  if (tonicRoll < Math.min(1, r.tonic * boost)) tonics[cordialRoll < r.cordial ? 'cordial' : 'brew'] = 1;
  const back = pinchedBack(fight, taken);
  tonics.cordial += back.cordial;
  tonics.brew += back.brew;
  return freezeDeep({ weight, n, deepRank, xp, marks, essences, relic, tonics });
}

// What comes back of `taken`: whole counts, capped at what the room's pinchers could take.
function pinchedBack(fight, taken) {
  const out = { cordial: 0, brew: 0 };
  if (!taken || typeof taken !== 'object') return out;
  const can = { cordial: 0, brew: 0 };
  for (const u of fight.foes || []) {
    const items = new Set((u.abilityIds || []).map((id) => PINCHES[id]).filter(Boolean));
    for (const item of items) can[item] += 1;
  }
  for (const item of ['cordial', 'brew']) {
    const n = Math.floor(Number(taken[item]) || 0);
    out[item] = Math.max(0, Math.min(can[item], n));
  }
  return out;
}

/**
 * What a fight's foes really pinched from the party's carry, counted from B's structured `take`
 * events (§18.2 item 4: `{ t: 'take', unit, from, item }`, the type under `t` as every event's is,
 * or under `kind` as §18.2 writes it), one per item taken; never from the Log's text. A pinch at
 * an empty bag takes nothing and emits no `take`, so it gives nothing back. Pass every event of the
 * fight, in order (a resumed fight's too: keep the count beside the save). With `fight`, only its
 * own foes' takes count. → { cordial, brew }
 */
export function tonicsTaken(events, fight = null) {
  const out = { cordial: 0, brew: 0 };
  const foes = fight ? new Set((fight.foes || []).map((u) => u.id)) : null;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object' || (e.t !== 'take' && e.kind !== 'take')) continue;
    if (!Object.hasOwn(out, e.item)) continue;
    if (foes && !foes.has(e.unit)) continue;
    out[e.item] += 1;
  }
  return out;
}

// ---------- ids and seeds ----------

/** A cave's day number (§5.1: its rooms reset each real day), or a refusal: without one every day would share one id. */
export function caveDay(day) {
  if (Number.isInteger(day) && day >= 0) return day;
  throw new TypeError('A cave’s fights need `day`, the day number its rooms reset on (clean.js dayNumber(now)).');
}

/** A fight's id (§5.1). A cave's needs its day number; without one it refuses (caveDay). */
export function fightIdFor(spec, kind, roomId, { since = null, day = null } = {}) {
  if (kind === 'cave') return `fight:${spec.id}:${caveDay(day)}:${roomId}`;
  if (kind === 'real' || kind === 'story') return `fight:${spec.id}:${Math.max(0, Math.floor(Number(since) || 0)).toString(36)}:${roomId}`;
  return `fight:${spec.id}:w:${roomId}`;
}

/** fightSeed (§5.1): hashInts(sceneSeed, roomId, 'fight'). */
export const fightSeedFor = (sceneSeed, roomId) => hashInts(sceneSeed >>> 0, roomId, 'fight');

// ---------- filling a room ----------

// Seeded fill: pick what fits the budget left, weighted toward on-level strays, until nothing fits
// or the room holds 8. A room is never empty: if nothing fits (a party of one at n ≤ 2 in a Low
// room), it holds the cheapest thing, one lackey. At Road levels 1 and 2 nothing counts as more
// than 2 levels above the party (an elite counts as a level higher, as it costs).
// ranksFor(kind): the ranks a kind may take (Murmurs come only as lackeys), or null for any.
function fillRoom({ budget, n, rng, rules, roadLevel, depth, kinds, colossal = false, count = 0, ranksFor = () => null }) {
  const budgets = rules.budgets;
  const maxLevel = roadLevel <= 2 ? roadLevel + 2 : Infinity;
  const maxElites = Math.floor(depth) >= budgets.caps.eliteDepth ? 2 : 1;
  const options = [
    { rank: 'stray', level: n, w: 4 },
    { rank: 'stray', level: n - 1, w: 3 },
    { rank: 'lackey', level: Math.max(0, n - 2), w: 2 },
    { rank: 'stray', level: n - 2, w: 1 },
    { rank: 'stray', level: n - 3, w: 0.5 },
    { rank: 'elite', level: n - 1, w: 1 },
    { rank: 'stray', level: n + 1, w: 0.5 },
  ].filter((o) => o.level >= 0 && (o.rank === 'elite' ? o.level + 1 : o.level) <= maxLevel).map((o) => ({ ...o, cost: unitCost(budgets, n, o) }));
  const allows = (kind, o) => { const ranks = ranksFor(kind); return !ranks || ranks.includes(o.rank); };
  const out = [];
  let spent = 0;
  let elites = 0;
  const cap = budgets.caps.foes - count;
  // A kind first (seeded), then what fits it; the other kinds in turn when nothing does.
  const kindOrder = () => {
    const first = Math.floor(rng.next() * kinds.length);
    return [kinds[first], ...kinds.filter((_, i) => i !== first)];
  };
  if (colossal) {
    const kind = kindOrder().find((k) => options.some((o) => o.rank === 'elite' && allows(k, o)));
    const elite = options.find((o) => o.rank === 'elite');
    if (elite && kind !== undefined) { out.push({ ...elite, kind }); spent += elite.cost; elites += 1; }
  }
  for (let guard = 0; guard < 40 && out.length < cap; guard += 1) {
    const left = budget - spent;
    let pick = null;
    for (const kind of kindOrder()) {
      const fits = options.filter((o) => o.cost <= left && allows(kind, o) && (o.rank !== 'elite' || elites < maxElites) && (o.rank !== 'stray' || o.level <= n || left >= 100));
      if (fits.length) { pick = { ...rng.weighted(fits.map((o) => [o, o.w])), kind }; break; }
    }
    if (!pick) break;
    out.push(pick);
    spent += pick.cost;
    if (pick.rank === 'elite') elites += 1;
  }
  if (!out.length && cap > 0) {
    // A room is never empty: the cheapest thing any of its kinds can be.
    const cheapest = kinds.flatMap((kind) => options.filter((o) => allows(kind, o)).map((o) => ({ ...o, kind })))
      .sort((a, b) => a.cost - b.cost || (a.rank === 'lackey' ? -1 : 1))[0];
    if (cheapest) { out.push(cheapest); spent += cheapest.cost; }
  }
  return { units: out, spent };
}

// ---------- posts, objects, surfaces ----------

function sceneReach(scene) {
  return bfs(scene.w, scene.h, (x, y) => scene.walkable(x, y), scene.spawn);
}

function avoidSet(scene, arena) {
  const avoid = new Set();
  for (const o of scene.objects) {
    if (o.kind === 'foliage' && !o.blocks) continue;
    avoid.add(keyOf(o.x, o.y));
    if (!o.scenery && o.approach) avoid.add(keyOf(o.approach.x, o.approach.y));
    for (const t of o.footprint || []) avoid.add(keyOf(t.x, t.y));
  }
  avoid.add(keyOf(scene.spawn.x, scene.spawn.y));
  const door = scene.objects.find((o) => o.kind === 'exit');
  if (door) avoid.add(keyOf(door.x, door.y));
  for (const t of arena?.entry || []) avoid.add(keyOf(t.x, t.y));
  for (const t of arena?.mouths || []) avoid.add(keyOf(t.x, t.y));
  return avoid;
}

function cellOf(arena, x, y) {
  const { rect } = arena;
  if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) return ' ';
  return arena.cells[(y - rect.y) * rect.w + (x - rect.x)];
}
const standable = (arena, x, y) => { const c = cellOf(arena, x, y); return c === '.' || c === '='; };

/**
 * The party's walk inside a fight's arena, the way B's grid moves them: from the start tiles
 * (arena.entry) over '.' and '=' cells less `blocked` (keys "x,y"), eight ways, never across the
 * corner between two blocked tiles. Tiles the arena only reaches through ground outside its rect
 * aren't reached. → { count, has(x, y) }
 */
export function arenaWalk(arena, blocked = new Set()) {
  const { rect, cells } = arena;
  const W = rect.w;
  const H = rect.h;
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const c = cells[i];
    if ((c === '.' || c === '=') && !blocked.has(keyOf(rect.x + (i % W), rect.y + Math.floor(i / W)))) open[i] = 1;
  }
  const at = (lx, ly) => lx >= 0 && ly >= 0 && lx < W && ly < H && open[ly * W + lx] === 1;
  const seen = new Uint8Array(W * H);
  const queue = [];
  const push = (lx, ly) => { const i = ly * W + lx; if (at(lx, ly) && !seen[i]) { seen[i] = 1; queue.push(i); } };
  for (const t of arena.entry || []) push(t.x - rect.x, t.y - rect.y);
  if (!queue.length) { const first = open.indexOf(1); if (first >= 0) push(first % W, Math.floor(first / W)); }
  for (let head = 0; head < queue.length; head += 1) {
    const lx = queue[head] % W;
    const ly = Math.floor(queue[head] / W);
    for (const [dx, dy] of STEPS) {
      if (!at(lx + dx, ly + dy)) continue;
      if (dx && dy && !at(lx + dx, ly) && !at(lx, ly + dy)) continue;
      push(lx + dx, ly + dy);
    }
  }
  const has = (x, y) => { const lx = x - rect.x; const ly = y - rect.y; return lx >= 0 && ly >= 0 && lx < W && ly < H && seen[ly * W + lx] === 1; };
  return { count: queue.length, has };
}

/** Whether a tile has a neighbour (the eight around: B's reach 1) the walk reaches. */
const besideWalk = (walk, x, y) => STEPS.some(([dx, dy]) => walk.has(x + dx, y + dy));

/**
 * The bush rule inside an arena: the party's walk with `blocked` in place, and a way to add one
 * more blocking thing only where that cuts off nothing but its own tile and every blocking thing
 * so far (the groups: the lead's footprint, each object) keeps a side the walk reaches.
 */
function bushRule(arena, blocked, groups = []) {
  let walk = arenaWalk(arena, blocked);
  const kept = groups.filter((g) => g.some((t) => besideWalk(walk, t.x, t.y)));
  const sided = (w) => kept.every((g) => g.some((t) => besideWalk(w, t.x, t.y)));
  return {
    get walk() { return walk; },
    /** Blocks (x, y) if the rule allows it; a walked-onto object only needs to be reached. */
    add(x, y, { blocks = true } = {}) {
      if (!walk.has(x, y)) return false;
      if (!blocks) return true;
      const k = keyOf(x, y);
      blocked.add(k);
      const next = arenaWalk(arena, blocked);
      if (next.count === walk.count - 1 && sided(next) && besideWalk(next, x, y)) { walk = next; kept.push([{ x, y }]); return true; }
      blocked.delete(k);
      return false;
    },
  };
}

/**
 * Posts for a room's units: tiles inside the room the scene can walk to and the party's own walk
 * inside the arena reaches (`walk`, arenaWalk with the lead and every object standing), clear of
 * objects, their approach tiles, the spawn, the door, the party's entry and the mouths, and
 * outside every other fight's arena (`elsewhere(x, y)`: a foe there would stand on ground that
 * fight counts as free), far side first; a Large unit takes a free 2×2. Units that find no post
 * are left out.
 */
function placePosts(units, { scene, reach, arena, room, taken, seed, walk, elsewhere = null }) {
  const avoid = avoidSet(scene, arena);
  for (const k of taken) avoid.add(k);
  const W = scene.w;
  const free = (x, y) => x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h
    && scene.walkable(x, y) && reach.dist[y * W + x] >= 0 && standable(arena, x, y) && walk.has(x, y) && !avoid.has(keyOf(x, y))
    && !(elsewhere && elsewhere(x, y));
  const entry = arena.entry.length ? arena.entry : [{ x: room.x, y: room.y }];
  const ex = entry.reduce((s, t) => s + t.x, 0) / entry.length;
  const ey = entry.reduce((s, t) => s + t.y, 0) / entry.length;
  const tiles = [];
  for (let y = room.y; y < room.y + room.h; y += 1) for (let x = room.x; x < room.x + room.w; x += 1) {
    if (free(x, y)) tiles.push({ x, y, d: Math.hypot(x - ex, y - ey), h: hashInts(seed, x, y, 'post') });
  }
  tiles.sort((a, b) => b.d - a.d || a.h - b.h);
  const used = new Set();
  const placed = [];
  const clearOf = (x, y, gap) => placed.every((p) => {
    const px1 = p.x + p.size - 1;
    const py1 = p.y + p.size - 1;
    const dx = Math.max(p.x - x, 0, x - px1);
    const dy = Math.max(p.y - y, 0, y - py1);
    return Math.max(dx, dy) > gap;
  });
  // Large units first, then the rest; each keeps a tile's gap where the room allows.
  const order = units.map((u, i) => ({ u, i })).sort((a, b) => (b.u.size || 1) - (a.u.size || 1) || a.i - b.i);
  const posts = new Array(units.length).fill(null);
  for (const { u, i } of order) {
    const size = u.size || 1;
    let spot = null;
    for (const gap of [1, 0]) {
      for (const t of tiles) {
        const cover = [];
        for (let dy = 0; dy < size; dy += 1) for (let dx = 0; dx < size; dx += 1) cover.push({ x: t.x + dx, y: t.y + dy });
        if (!cover.every((c) => free(c.x, c.y) && !used.has(keyOf(c.x, c.y)))) continue;
        if (!cover.every((c) => clearOf(c.x, c.y, gap))) continue;
        spot = { x: t.x, y: t.y, cover };
        break;
      }
      if (spot) break;
    }
    if (!spot) continue;
    for (const c of spot.cover) used.add(keyOf(c.x, c.y));
    placed.push({ x: spot.x, y: spot.y, size });
    posts[i] = { x: spot.x, y: spot.y };
  }
  return posts;
}

/**
 * Seats a room's picks at posts. An elite that finds no free 2×2 comes as a stray one level higher
 * instead (the same cost, on one tile), where its kind can be a stray. Anything still without a
 * post is left out, and `dropped` is what it would have cost, so the room can be priced (and pay)
 * for what stands in it.
 * → { kept: [{ p, post }], dropped }
 */
function seatUnits(picks, { n, rules, allows, place }) {
  let units = picks.map((p) => ({ ...p, size: p.rank === 'elite' ? 2 : 1 }));
  let posts = place(units);
  if (units.some((u, i) => !posts[i] && u.rank === 'elite' && allows(u.kind, 'stray'))) {
    units = units.map((u, i) => (posts[i] || u.rank !== 'elite' || !allows(u.kind, 'stray') ? u : { ...u, rank: 'stray', level: u.level + 1, size: 1 }));
    posts = place(units);
  }
  const kept = [];
  let dropped = 0;
  units.forEach((u, i) => {
    if (posts[i]) kept.push({ p: u, post: posts[i] });
    else dropped += unitCost(rules.budgets, n, u);
  });
  return { kept, dropped };
}

// Mechanic objects (leads.json's objects for a shipped mechanic), placed in the lead's room (or a
// field boss's arena) by the bush rule inside the arena: with the lead standing, a blocking object
// takes a tile only where that cuts the party's walk from its start tiles off nothing but the tile
// itself, and the lead and every object keep a side the party can reach; one walked onto (a clue, a
// plan tile) stands where the walk reaches. → { objects, walk } (walk: with them all in place)
function placeMechanicObjects(entry, { arena, room, footprint, scene, reach, seed, taken, startIndex = 0 }) {
  const specs = entry?.ships ? entry.objects || [] : [];
  const foot = new Set((footprint || []).map((t) => keyOf(t.x, t.y)));
  const rule = bushRule(arena, new Set(foot), footprint?.length ? [footprint] : []);
  if (!specs.length) return { objects: [], walk: rule.walk };
  const W = scene?.w ?? 0;
  const avoid = scene ? avoidSet(scene, arena) : new Set([...arena.entry, ...arena.mouths].map((t) => keyOf(t.x, t.y)));
  for (const k of taken) avoid.add(k);
  const ok = (x, y) => standable(arena, x, y) && !foot.has(keyOf(x, y)) && !avoid.has(keyOf(x, y))
    && (!scene || (scene.walkable(x, y) && reach.dist[y * W + x] >= 0));
  const inRoom = (x, y) => x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h;
  const wallBeside = (x, y) => DIRS4.some(([dx, dy]) => { const c = cellOf(arena, x + dx, y + dy); return c === '#' || c === ' ' || c === 'O'; });
  const edge = (x, y) => x === room.x || y === room.y || x === room.x + room.w - 1 || y === room.y + room.h - 1;
  const nearLead = (x, y) => [...foot].some((k) => { const [fx, fy] = k.split(',').map(Number); return Math.max(Math.abs(fx - x), Math.abs(fy - y)) <= 2; });
  const where = {
    wall: (x, y) => inRoom(x, y) && wallBeside(x, y),
    edge: (x, y) => inRoom(x, y) && edge(x, y),
    floor: (x, y) => inRoom(x, y) && !edge(x, y),
    'lead-side': (x, y) => nearLead(x, y),
  };
  const out = [];
  const used = new Set();
  const placed = specs.map(() => 0);
  // One of each kind first, then the rest, so a room too cramped for them all still holds every
  // kind its mechanic works with.
  for (const quota of [(want) => Math.min(1, want.count), (want) => want.count]) {
    specs.forEach((want, k) => {
      const count = quota(want);
      if (placed[k] >= count) return;
      const test = where[want.where] || where.floor;
      const tiles = [];
      for (let y = arena.rect.y; y < arena.rect.y + arena.rect.h; y += 1) for (let x = arena.rect.x; x < arena.rect.x + arena.rect.w; x += 1) {
        if (ok(x, y) && !used.has(keyOf(x, y))) tiles.push({ x, y, h: hashInts(seed, x, y, want.kind) });
      }
      const primary = tiles.filter((t) => test(t.x, t.y)).sort((a, b) => a.h - b.h);
      const rest = tiles.filter((t) => !test(t.x, t.y) && inRoom(t.x, t.y)).sort((a, b) => a.h - b.h);
      const beyond = tiles.filter((t) => !test(t.x, t.y) && !inRoom(t.x, t.y)).sort((a, b) => a.h - b.h);
      // Where leads.json says first, spread apart where it can be, closer where it can't; only
      // when every such tile is gone does an object stand elsewhere in the room, and only when the
      // room has no tile left that keeps the way clear, elsewhere in the arena. What finds no tile
      // at all is left out: a room never loses its way for one more candle.
      for (const pool of [primary, rest, beyond]) {
        for (const gap of [2, 1, 0]) {
          for (const t of pool) {
            if (placed[k] >= count) break;
            if (used.has(keyOf(t.x, t.y))) continue;
            if (out.some((o) => Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) < gap)) continue;
            if (!rule.add(t.x, t.y, { blocks: !walksOnto(want.kind) })) continue;
            used.add(keyOf(t.x, t.y));
            out.push({ k, kind: want.kind, x: t.x, y: t.y });
            placed[k] += 1;
          }
          if (placed[k] >= count) break;
        }
        if (placed[k] >= count) break;
      }
    });
  }
  // Numbered in leads.json's order, kind by kind.
  const objects = out.map((o, i) => ({ ...o, i })).sort((a, b) => a.k - b.k || a.i - b.i)
    .map((o, i) => ({ id: `o${startIndex + i}`, kind: o.kind, x: o.x, y: o.y, state: OBJECT_START[o.kind] || 'idle', flags: [], integrity: null }));
  return { objects, walk: rule.walk };
}

function surfacesFor({ arena, room, scene, affixes, rng, occupied, share }) {
  const out = [];
  const seen = new Set();
  const { rect } = arena;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
    if (!standable(arena, x, y)) continue;
    const c = scene?.cellAt?.(x, y);
    const id = c === 'foliage' ? 'foliage' : c === 'water' ? 'water' : null;
    if (!id) continue;
    out.push({ x, y, id, rounds: null });
    seen.add(keyOf(x, y));
  }
  for (const affix of affixes) {
    const id = AFFIX_SURFACES[affix];
    if (!id) continue;
    const floor = [];
    for (let y = room.y; y < room.y + room.h; y += 1) for (let x = room.x; x < room.x + room.w; x += 1) {
      if (cellOf(arena, x, y) === '.' && !seen.has(keyOf(x, y)) && !occupied.has(keyOf(x, y))) floor.push({ x, y });
    }
    const want = Math.round(floor.length * share);
    for (const t of rng.shuffle(floor).slice(0, want)) {
      out.push({ x: t.x, y: t.y, id, rounds: null });
      seen.add(keyOf(t.x, t.y));
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

const sightOf = (rules, arena) => (arena.light[0] === 'L' ? rules.sight?.lit ?? 6 : rules.sight?.dim ?? 3);

// ---------- planning ----------

/**
 * What waits in each fight room: the room's units at their posts, its FightSpec and its rewards.
 * scene: the buildElsewhere of plan.layout with { plan, encounters: null }. kind: 'wild' | 'real' |
 * 'story' | 'cave'. Extra option: day (a cave's day number, for its fight ids; a cave refuses
 * without one, caveDay).
 * → Encounters { rooms: [{ roomId, role, fightId, rect, sight, posts, fight }], nook, leadRoom, chests }
 */
export function planEncounters(spec, plan, scene, {
  kind = 'wild', roadLevel = 1, partySize = 4, rules, leads = null, foes = null, tuning = null, words, hooks = [],
  riftKey = null, since = null, cause = null, day = null,
} = {}) {
  const cave = kind === 'cave';
  if (cave) caveDay(day);
  const { n, deepRank } = roomLevel(spec, { kind, roadLevel, rules });
  const depth = Math.max(1, Math.floor(spec.depth) || 1);
  const party = Math.max(1, Math.min(4, Math.floor(partySize) || 4));
  const stage = STAGE_ROOMS[spec.stage] ? spec.stage : 'hairline';
  const base = hashInts(spec.seed >>> 0, 'encounters');
  const affixIds = (spec.affixes || []).map((a) => a.id);
  const affixes = FIGHT_AFFIXES.filter((id) => affixIds.includes(id));
  const multiplier = affixIds.reduce((m, id) => m * (rules.budgets.affixes?.[id] ?? 1), 1);
  const reach = sceneReach(scene);
  const real = kind === 'real' || kind === 'story'
    ? { key: String(riftKey ?? spec.key ?? spec.id), cause: String(cause ?? (typeof spec.cause === 'string' ? spec.cause : '')) }
    : null;
  const rooms = [];

  // The kinds a room may draw from: a rift's fighting stray kinds, or a cave region's foes.
  const fighting = cave ? [] : (spec.strays || []).map((k, i) => ({ k, i })).filter(({ k }) => rules.genres?.[k.genre]?.fights !== false);
  const cheering = cave ? [] : (spec.strays || []).map((k, i) => ({ k, i })).filter(({ k }) => BRIGHT.has(k.genre));
  const caveFoes = cave ? caveList(spec.region, foes) : [];

  const unitFor = (pick, i, post) => {
    const id = `f${i}`;
    if (cave) return foeUnit(pick.kind, n, { level: pick.level, rank: pick.rank, rules, foes, partySize: party, roadLevel, id, post, deepRank });
    return strayUnit(spec, pick.kind, n, { level: pick.level, rank: pick.rank, rules, foes, deepRank, partySize: party, roadLevel, id, post });
  };

  const finish = (fight) => freezeDeep({ ...fight, rewards: rewardsFor(fight, { rules, words }) });

  // Every other fight's arena, so no room's foes stand inside it: the lead's 12×9 window takes in
  // its neighbours' floors, and a foe standing there would be on ground the lead's fight counts
  // as free. The lead's window counts only when the lead fights; in a cave every room's arena
  // counts, since a Mimic may wait in any chest.
  const leadPlan = plan.rooms.find((room) => room.roomId === 'lead');
  const leadFights = !cave && Boolean(spec.taleLead) && Boolean(leadPlan?.arena) && Boolean(plan.lead) && !isPuzzleLead(spec, { leads, words, rules });
  const arenas = plan.rooms.filter((r) => r.arena && (r.roomId === 'lead' ? leadFights : r.fight || cave)).map((r) => ({ roomId: r.roomId, rect: r.arena.rect }));
  const elsewhereFor = (roomId) => {
    const others = arenas.filter((a) => a.roomId !== roomId).map((a) => a.rect);
    return others.length ? (x, y) => others.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) : null;
  };

  // ---------- stray rooms ----------
  for (const room of plan.rooms) {
    if (!room.fight || room.roomId === 'lead' || !room.arena) continue;
    if (!cave && !fighting.length) continue;
    const rng = createRng(hashInts(base, room.roomId));
    // A cave's far room has no lead, so it's an ordinary room at the top of COMBAT §9's
    // "Low to Moderate": Moderate at every stage (CAVE_FAR_ROOM).
    const farRoom = cave && room.role === 'lead';
    const role = farRoom ? CAVE_FAR_ROOM : STAGE_ROOMS[stage].mix;
    const colossal = affixIds.includes('colossal');
    let budget = budgetFor(role, party, depth, rules) * multiplier;
    if (colossal) budget += unitCost(rules.budgets, n, { rank: 'elite', level: Math.max(0, n - 1) });
    // Up to 3 kinds a room.
    const pool = cave ? caveFoes.map((foe) => ({ foe })) : fighting;
    const kindCount = Math.max(1, Math.min(rules.budgets.caps.kinds, pool.length, rng.int(1, 3)));
    const chosen = rng.shuffle(pool).slice(0, kindCount).map((p) => (cave ? p.foe : p.i));
    if (!chosen.length) continue;
    // Murmurs and other swarms come only as lackeys.
    const ranksFor = (k) => (cave && k.rank ? [k.rank] : null);
    const allows = (k, rank) => { const ranks = ranksFor(k); return !ranks || ranks.includes(rank); };
    const { units: picks } = fillRoom({ budget, n, rng, rules, roadLevel, depth, kinds: chosen, colossal, ranksFor });
    const fightSeed = fightSeedFor(spec.seed, room.roomId);
    const props = propObjects(plan, room.arena);
    // A canon foe's bow objects stand first (a forge, a lectern…), by the bush rule on the party's
    // walk; foes then stand where that walk, with the objects in place, reaches them.
    const bow = placeMechanicObjects(bowEntry(picks.map((p) => p.kind)), {
      arena: room.arena, room: room.rect, footprint: [], scene, reach, seed: hashInts(fightSeed, 'bow'), taken: new Set(), startIndex: props.length,
    });
    const walk = bow.walk;
    const bowTiles = new Set(bow.objects.map((o) => keyOf(o.x, o.y)));
    const elsewhere = elsewhereFor(room.roomId);
    const place = (units) => placePosts(units, { scene, reach, arena: room.arena, room: room.rect, taken: bowTiles, seed: fightSeed, walk, elsewhere });
    const { kept, dropped } = seatUnits(picks, { n, rules, allows, place });
    if (!kept.length) continue;
    // What found no post comes off the budget (and so the weight and the pay).
    budget -= dropped;
    const foesOut = kept.map(({ p, post }, i) => unitFor(p, i, post));
    // A bright stray in a fusion stands aside and cheers: one a room, at no cost, and only where
    // it's no fourth kind (§4.10's 3 kinds a room count it).
    const kindsHere = new Set(foesOut.map((u) => u.talkKind));
    if (cheering.length && foesOut.length < rules.budgets.caps.foes && kindsHere.size < rules.budgets.caps.kinds) {
      const kindIndex = cheering[Math.floor(rng.next() * cheering.length)].i;
      const taken = new Set([...bowTiles, ...foesOut.flatMap((u) => cover(u))]);
      const [post] = placePosts([{ size: 1 }], { scene, reach, arena: room.arena, room: room.rect, taken, seed: hashInts(fightSeed, 'cheer'), walk, elsewhere });
      if (post) foesOut.push(strayUnit(spec, kindIndex, n, { level: n, rank: 'stray', rules, foes, deepRank, partySize: party, roadLevel, id: `f${foesOut.length}`, post }));
    }
    // Only the objects a foe still standing here needs (one that found no post takes its forge
    // with it), numbered on from the props.
    const needed = new Set(bowEntry(kept.map(({ p }) => p.kind)).objects.map((o) => o.kind));
    const bowObjects = bow.objects.filter((o) => needed.has(o.kind)).map((o, i) => ({ ...o, id: `o${props.length + i}` }));
    const objects = [...props, ...bowObjects];
    const occupied = new Set([...foesOut.flatMap((u) => cover(u)), ...bowObjects.map((o) => keyOf(o.x, o.y))]);
    const fight = {
      id: fightIdFor(spec, kind, room.roomId, { since, day }),
      room: room.roomId,
      kind: cave ? 'cave' : 'room',
      seed: fightSeed,
      level: n,
      deepRank,
      budget,
      weight: budget / 20,
      stage: cave ? null : spec.stage,
      genres: cave ? [] : genresOf(spec, foesOut),
      affixes: cave ? [] : affixes,
      arena: room.arena,
      foes: foesOut,
      leadUnit: null,
      objects,
      surfaces: surfacesFor({ arena: room.arena, room: room.rect, scene, affixes, rng, occupied, share: rules.budgets.surfaceShare }),
      lead: null,
      sight: sightOf(rules, room.arena),
      surprised: affixIds.includes('sleepy') ? 'foes' : null,
      real,
    };
    const done = finish(fight);
    rooms.push({ roomId: room.roomId, role: room.role, fightId: done.id, rect: room.rect, sight: done.sight, posts: postsOf(done), fight: done });
  }

  // ---------- the Tale-lead's room ----------
  let leadRoom = null;
  if (leadFights) {
    const rng = createRng(hashInts(base, 'lead'));
    const role = LEAD_ROLE[stage];
    const footprint = plan.lead.footprint;
    const topLeft = { x: Math.min(...footprint.map((t) => t.x)), y: Math.min(...footprint.map((t) => t.y)) };
    const lead = leadUnit(spec, { level: n, rules, leads, foes, tuning, words, partySize: party, deepRank, roadLevel, hooks, post: topLeft });
    const mechanic = leadMechanic(spec, { leads, words, tuning });
    const spent = leadCost(rules, stage, party, depth);
    // The lead always comes: a Lonely room's budget never drops below the lead's own cost.
    const budget = Math.max(budgetFor(role, party, depth, rules) * multiplier, spent);
    const fightSeed = fightSeedFor(spec.seed, 'lead');
    // The one helper §4.10's table names, on theme where the rift has the kind, if it fits what
    // the lead leaves: a lackey at hairline, a stray a level below at open (else a lackey), and
    // nobody at gaping. A Maelstrom's lead comes alone.
    const helpers = [];
    if (!spec.maelstrom && fighting.length) {
      const own = fighting.filter(({ k }) => k.genre === spec.taleLead.genre);
      const kinds = (own.length ? own : fighting).map(({ i }) => i);
      const left = budget - spent;
      for (const want of STAGE_ROOMS[stage].helpers) {
        const option = want === 'lackey' ? { rank: 'lackey', level: Math.max(0, n - 2) } : { rank: 'stray', level: Math.max(0, n - 1) };
        if (unitCost(rules.budgets, n, option) > left + 1e-9) continue;
        helpers.push({ ...option, size: 1, kind: kinds[Math.floor(rng.next() * kinds.length)] });
        break;
      }
    }
    const foot = new Set(footprint.map((t) => keyOf(t.x, t.y)));
    // The props the 12×9 window takes in (its own room's or a neighbour's) are FightObjects too,
    // so a hazard, light or throwable keeps its flags; the mechanic's objects are numbered after.
    const props = propObjects(plan, leadPlan.arena);
    const { objects: mechObjects, walk } = placeMechanicObjects(mechanic.fallback ? null : mechanic.entry, {
      arena: leadPlan.arena, room: leadPlan.rect, footprint, scene, reach, seed: fightSeed, taken: foot, startIndex: props.length,
    });
    const objects = [...props, ...mechObjects];
    const taken = new Set([...foot, ...objects.map((o) => keyOf(o.x, o.y))]);
    // A helper stands where the party can walk to it with the lead and every object in place.
    const posts = placePosts(helpers, { scene, reach, arena: leadPlan.arena, room: leadPlan.rect, taken, seed: fightSeed, walk, elsewhere: elsewhereFor('lead') });
    const foesOut = helpers.map((p, i) => ({ p, post: posts[i] })).filter((x) => x.post).map(({ p, post }, i) => unitFor(p, i, post));
    const occupied = new Set([...foot, ...foesOut.flatMap((u) => cover(u)), ...objects.map((o) => keyOf(o.x, o.y))]);
    const fight = {
      id: fightIdFor(spec, kind, 'lead', { since, day }),
      room: 'lead',
      kind: 'lead',
      seed: fightSeed,
      level: n,
      deepRank,
      budget,
      weight: rules.road.leadWeights[stage],
      stage: spec.stage,
      genres: genresOf(spec, [...foesOut, lead]),
      affixes,
      arena: leadPlan.arena,
      foes: foesOut,
      leadUnit: lead,
      objects,
      surfaces: surfacesFor({ arena: leadPlan.arena, room: leadPlan.rect, scene, affixes, rng, occupied, share: rules.budgets.surfaceShare }),
      lead: { mechanic: lead.lead.mechanic, phases: lead.lead.phases, bow: mechanic.bow, quote: lead.lead.quote },
      sight: sightOf(rules, leadPlan.arena),
      surprised: affixIds.includes('sleepy') ? 'foes' : null,
      real,
    };
    const done = finish(fight);
    rooms.push({ roomId: 'lead', role: 'lead', fightId: done.id, rect: leadPlan.rect, sight: done.sight, posts: postsOf(done), fight: done });
    leadRoom = 'lead';
  }

  const chests = cave ? caveChests(spec, plan, scene, { n, deepRank, rules, foes, partySize: party, roadLevel, words, day, reach, rooms }) : [];
  return freezeDeep({ rooms, nook: plan.nook ? { ...plan.nook } : null, leadRoom, chests });
}

function cover(unit) {
  const out = [];
  if (!unit.post) return out;
  for (let dy = 0; dy < unit.size; dy += 1) for (let dx = 0; dx < unit.size; dx += 1) out.push(keyOf(unit.post.x + dx, unit.post.y + dy));
  return out;
}

function postsOf(fight) {
  const list = fight.foes.map((u) => ({ unitId: u.id, x: u.post.x, y: u.post.y }));
  if (fight.leadUnit?.post) list.push({ unitId: 'lead', x: fight.leadUnit.post.x, y: fight.leadUnit.post.y });
  return list;
}

function genresOf(spec, units) {
  const present = new Set(units.filter((u) => u.side === 'foe').flatMap((u) => u.genres));
  const ordered = (spec.genres || []).filter((g) => present.has(g));
  return ordered.length ? ordered : [...present];
}

const BOW_ORDER = ['forge', 'bell', 'lectern', 'riddle-board'];
// The bow objects a room's kinds need (BOW_OBJECTS), as a placeMechanicObjects entry; a stray kind
// (a rift's, by index) or a creature needs none.
function bowEntry(kinds) {
  const need = new Set();
  for (const k of kinds) for (const kind of BOW_OBJECTS[k?.bow?.kind] || []) need.add(kind);
  const list = BOW_ORDER.filter((kind) => need.has(kind));
  return { ships: list.length > 0, objects: list.map((kind) => ({ kind, count: 1, where: 'wall' })) };
}

function propObjects(plan, arena) {
  const { rect } = arena;
  return plan.props
    .filter((p) => p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.w && p.y < rect.y + rect.h)
    .map((p, i) => ({ id: `o${i}`, kind: 'prop', x: p.x, y: p.y, state: p.state, flags: [...p.flags], integrity: null }));
}

/** A cave region's list (foes.caves), borrowing the nearest listed region's where it has none. */
export function caveList(region, foes) {
  const caves = foes?.caves || {};
  const listed = Object.keys(caves);
  const id = caves[region] ? region : caves[foes?.borrow?.[region]] ? foes.borrow[region] : listed[0];
  const byId = new Map([...(foes?.canon || []), ...(foes?.creatures || [])].map((f) => [f.id, f]));
  return (caves[id] || []).map((fid) => byId.get(fid)).filter(Boolean);
}

// ---------- caves ----------

// Would opening a chest that blocks (x, y) open more than its own tile? Then it guards the way to
// something, and it can't be the Mimic or the locked one.
function chestGuards(scene, reach, spot) {
  const lifted = bfs(scene.w, scene.h, (x, y) => (x === spot.x && y === spot.y) || scene.walkable(x, y), scene.spawn);
  return lifted.count > reach.count + 1;
}

/**
 * The chests a cave adds (§7.7): it needs two it can safely use, one Mimic and one locked, so when
 * the layout's own loot gives fewer, a chest goes on the far room's B spot, then on other rooms'
 * centres, then anywhere in a room. Picked from the plain scene, before the arena pass, which
 * then blocks them like loot marks (arenaPass's `chests`), so every arena cell, start tile, prop
 * and post knows they're there. A spot is plain dry floor the scene reaches, off every mark,
 * approach tile, the door and the spawn, and blocking it (with the others) cuts nothing else off.
 * → [{ x, y }]
 */
export function caveChestSpots(cave, layout, scene) {
  void cave;
  const W = scene.w;
  const reach = sceneReach(scene);
  const loot = (layout.loot || []).filter(Boolean);
  let usable = loot.filter((t) => !chestGuards(scene, reach, t)).length;
  if (usable >= 2) return [];
  const avoid = new Set([keyOf(scene.spawn.x, scene.spawn.y), keyOf(layout.entrance.x, layout.entrance.y)]);
  for (const o of scene.objects) {
    if (o.scenery) continue;
    avoid.add(keyOf(o.x, o.y));
    if (o.approach) avoid.add(keyOf(o.approach.x, o.approach.y));
  }
  for (const m of [layout.boss, layout.stitch, layout.puzzle, ...loot]) if (m) avoid.add(keyOf(m.x, m.y));
  const rooms = (layout.roomRects || []).filter((r) => r.role !== 'entrance');
  const candidates = [
    layout.boss,
    ...rooms.map((r) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) })),
    ...rooms.flatMap((r) => {
      const cx = r.x + (r.w >> 1);
      const cy = r.y + (r.h >> 1);
      const tiles = [];
      for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) tiles.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
      return tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    }),
  ].filter(Boolean);
  const chosen = [];
  const blocked = new Set();
  let base = reach;
  for (const t of candidates) {
    if (usable >= 2) break;
    const k = keyOf(t.x, t.y);
    if (avoid.has(k) || blocked.has(k)) continue;
    if (scene.cellAt(t.x, t.y) !== 'floor' || !scene.walkable(t.x, t.y) || base.dist[t.y * W + t.x] < 0) continue;
    blocked.add(k);
    const next = bfs(W, scene.h, (x, y) => !blocked.has(keyOf(x, y)) && scene.walkable(x, y), scene.spawn);
    if (next.count !== base.count - 1) { blocked.delete(k); continue; }
    base = next;
    chosen.push({ x: t.x, y: t.y });
    usable += 1;
  }
  return chosen;
}

// A cave's chests: every loot chest and the ones the arena pass stood for it (plan.chests), then
// one Mimic and one locked chest among those whose opening changes nothing else (and a Mimic
// fight at its chest).
function caveChests(cave, plan, scene, { n, deepRank, rules, foes, partySize, roadLevel, words, day, reach, rooms = [] }) {
  const rng = createRng(hashInts(cave.seed >>> 0, 'encounters', 'chests'));
  const layout = plan.layout;
  const loot = layout.loot || [];
  const spots = [
    ...loot.map((t, i) => ({ id: `loot:${i}`, x: t.x, y: t.y })),
    ...(plan.chests || []).map((t, i) => ({ id: `loot:${loot.length + i}`, x: t.x, y: t.y })),
  ];
  const usable = spots.filter((s) => !chestGuards(scene, reach, s));
  // The Mimic's arena is its chest room's; a chest whose arena holds no room's foes comes first,
  // so no foe stands on ground the Mimic's fight counts as free (only when every usable chest's
  // does, the first of them).
  const standing = rooms.flatMap((r) => r.fight.foes.filter((u) => u.post).map((u) => u.post));
  const clear = (s) => { const { rect } = mimicArenaOf(plan, s); return !standing.some((t) => t.x >= rect.x && t.y >= rect.y && t.x < rect.x + rect.w && t.y < rect.y + rect.h); };
  const order = rng.shuffle(usable);
  const mimicSpot = order.find(clear) || order[0];
  const lockedSpot = order.find((s) => s !== mimicSpot);
  const mimic = mimicSpot ? mimicFight(cave, plan, scene, mimicSpot, { n, deepRank, rules, foes, partySize, roadLevel, words, day }) : null;
  return spots.map((s) => ({ id: s.id, x: s.x, y: s.y, locked: s === lockedSpot, mimic: s === mimicSpot ? { fight: mimic } : null }));
}

// The Mimic fights at the cave's n and deep rank, like every room of the same cave.
// The arena a Mimic at this chest fights in: the arena of the room it stands in (or whose arena takes it in).
function mimicArenaOf(plan, chest) {
  const room = plan.rooms.find((r) => chest.x >= r.rect.x && chest.y >= r.rect.y && chest.x < r.rect.x + r.rect.w && chest.y < r.rect.y + r.rect.h)
    || plan.rooms.find((r) => r.arena && chest.x >= r.arena.rect.x && chest.y >= r.arena.rect.y && chest.x < r.arena.rect.x + r.arena.rect.w && chest.y < r.arena.rect.y + r.arena.rect.h);
  return room?.arena || plan.rooms.find((r) => r.arena)?.arena;
}

function mimicFight(cave, plan, scene, chest, { n, deepRank = 0, rules, foes, partySize, roadLevel, words, day }) {
  const base = mimicArenaOf(plan, chest);
  // The Mimic stands where the chest was; the party is beside it.
  const { rect } = base;
  const cells = [...base.cells];
  const at = (chest.y - rect.y) * rect.w + (chest.x - rect.x);
  if (at >= 0 && at < cells.length) cells[at] = '.';
  const arenaCells = cells.join('');
  const inRect = (x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
  const walk = (x, y) => inRect(x, y) && ['.', '='].includes(arenaCells[(y - rect.y) * rect.w + (x - rect.x)]) && !(x === chest.x && y === chest.y) && scene.walkable(x, y);
  const entry = [];
  const seen = new Set([keyOf(chest.x, chest.y)]);
  const queue = [{ x: chest.x, y: chest.y }];
  for (let head = 0; head < queue.length && entry.length < 4; head += 1) {
    const t = queue[head];
    for (const [dx, dy] of DIRS4) {
      const nx = t.x + dx;
      const ny = t.y + dy;
      if (seen.has(keyOf(nx, ny)) || !inRect(nx, ny)) continue;
      seen.add(keyOf(nx, ny));
      if (!walk(nx, ny)) continue;
      if (entry.length < 4) entry.push({ x: nx, y: ny });
      queue.push({ x: nx, y: ny });
    }
  }
  const arena = { ...base, cells: arenaCells, entry, seed: hashInts(cave.seed >>> 0, 'mimic', 'arena') };
  const seed = fightSeedFor(cave.seed, 'mimic');
  const unit = foeUnit(foes.mimic, n, { level: n, rank: 'stray', rules, foes, partySize, roadLevel, id: 'f0', post: { x: chest.x, y: chest.y }, deepRank });
  const budget = unitCost(rules.budgets, n, { rank: 'stray', level: n });
  const fight = {
    id: fightIdFor(cave, 'cave', 'mimic', { day }),
    room: 'mimic',
    kind: 'cave',
    seed,
    level: n,
    deepRank,
    budget,
    weight: budget / 20,
    stage: null,
    genres: [],
    affixes: [],
    arena,
    foes: [unit],
    leadUnit: null,
    objects: [],
    surfaces: [],
    lead: null,
    sight: sightOf(rules, arena),
    surprised: null,
    real: null,
  };
  return freezeDeep({ ...fight, rewards: rewardsFor(fight, { rules, words }) });
}

// ---------- the whole pass ----------

/**
 * An Elsewhere made ready for fights (§7.3): riftgen.layout → a plain buildElsewhere for walkable →
 * arenaPass → buildElsewhere with { plan, encounters: null } → planEncounters. Returns
 * layout === plan.layout; the shell passes { layout, fight: { plan, encounters } } on to
 * world.enterElsewhere and elsewhereLandmarks.
 */
export function prepareElsewhere(spec, {
  riftgen, genres, words, kind = 'wild', roadLevel = 1, partySize = 4, rules, leads, foes, tuning = null, hooks = [],
  riftKey = null, since = null, cause = null,
} = {}) {
  const layout0 = riftgen.layout(spec);
  const sceneKind = kind === 'wild' ? null : kind;
  const plain = buildElsewhere(spec, layout0, { genres, kind: sceneKind, words, hooks });
  const plan = arenaPass(spec, layout0, { genres, rules, walkable: plain.walkable });
  const scene = buildElsewhere(spec, plan.layout, { genres, kind: sceneKind, words, hooks, fight: { plan, encounters: null } });
  const encounters = planEncounters(spec, plan, scene, { kind, roadLevel, partySize, rules, leads, foes, tuning, words, hooks, riftKey, since, cause });
  return { layout: plan.layout, plan, encounters };
}

/**
 * A cave made ready (§7.7): its rooms filled from foes.caves[cave.region] (or the nearest listed
 * region's) at the cave's tier, with one Mimic chest and one locked chest. The chests it adds
 * (caveChestSpots, from the plain scene) go to the arena pass first, so they come back as
 * plan.chests and every arena, start tile and post already treats them as cover. Extra options:
 * day (required: the day number in its fight ids, clean.js dayNumber(now), since its rooms reset
 * each real day; `cave.day` serves when the option is left out, and with neither it refuses) and
 * genres (genres.json, for the scene; a cave has none of its own).
 */
export function prepareCave(cave, { layout, roadLevel = 1, partySize = 4, rules, foes, words, day = cave?.day, genres = null } = {}) {
  caveDay(day);
  const plain = buildElsewhere(cave, layout, { genres, kind: 'cave', words });
  const chests = caveChestSpots(cave, layout, plain);
  const plan = arenaPass(cave, layout, { genres, rules, walkable: plain.walkable, chests });
  const scene = buildElsewhere(cave, plan.layout, { genres, kind: 'cave', words, fight: { plan, encounters: null } });
  const encounters = planEncounters(cave, plan, scene, { kind: 'cave', roadLevel, partySize, rules, foes, words, day });
  return { layout: plan.layout, plan, encounters };
}

/**
 * A field boss's fight (§7.7): the gaping wild rift's Tale-lead, alone, in the arena E's
 * fieldArena cut (world tiles), standing on the free 2×2 nearest the tear. Its mechanic's objects
 * stand in the arena. Returns null when the lead never fights (a bright or Backhalls mechanic).
 */
export function fieldFight(rift, arena, { roadLevel = 1, partySize = 4, rules, leads, foes = null, tuning = null, words, hooks = [] } = {}) {
  const spec = rift.spec || rift;
  if (!spec?.taleLead || isPuzzleLead(spec, { leads, words, rules })) return null;
  const { n, deepRank } = roomLevel(spec, { kind: 'wild', roadLevel, rules });
  const party = Math.max(1, Math.min(4, Math.floor(partySize) || 4));
  const stage = 'gaping';
  const depth = Math.max(1, Math.floor(spec.depth) || 1);
  const { rect } = arena;
  const entry = new Set((arena.entry || []).map((t) => keyOf(t.x, t.y)));
  const free = (x, y) => standable(arena, x, y) && !entry.has(keyOf(x, y));
  const tx = Number.isFinite(rift.x) ? rift.x : rect.x + (rect.w >> 1);
  const ty = Number.isFinite(rift.y) ? rift.y : rect.y + (rect.h >> 1);
  // The free 2×2 nearest the tear, on ground the party's walk from its start tiles reaches (any
  // free 2×2 when none is).
  const open = arenaWalk(arena);
  let post = null;
  let best = Infinity;
  for (let y = rect.y; y < rect.y + rect.h - 1; y += 1) for (let x = rect.x; x < rect.x + rect.w - 1; x += 1) {
    if (!(free(x, y) && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1))) continue;
    const d = Math.hypot(x + 0.5 - tx, y + 0.5 - ty) + (open.has(x, y) ? 0 : 1e6);
    if (d < best) { best = d; post = { x, y }; }
  }
  const lead = leadUnit({ ...spec, stage }, { level: n, rules, leads, foes, tuning, words, partySize: party, deepRank, roadLevel, hooks, post });
  const mechanic = leadMechanic(spec, { leads, words, tuning });
  const seed = fightSeedFor(spec.seed, 'field');
  const footprint = post ? [post, { x: post.x + 1, y: post.y }, { x: post.x, y: post.y + 1 }, { x: post.x + 1, y: post.y + 1 }] : [];
  const { objects } = placeMechanicObjects(mechanic.fallback ? null : mechanic.entry, {
    arena, room: rect, footprint, scene: null, reach: null, seed, taken: new Set(footprint.map((t) => keyOf(t.x, t.y))),
  });
  const budget = budgetFor(LEAD_ROLE[stage], party, depth, rules);
  const fight = {
    id: `fight:${spec.id || rift.id}:w:field`,
    room: 'field',
    kind: 'field',
    seed,
    level: n,
    deepRank,
    budget,
    weight: rules.road.leadWeights[stage],
    stage,
    genres: [lead.genres[0]].filter(Boolean),
    affixes: FIGHT_AFFIXES.filter((id) => (spec.affixes || []).some((a) => a.id === id) && !AFFIX_SURFACES[id]),
    arena,
    foes: [],
    leadUnit: lead,
    objects,
    surfaces: [],
    lead: { mechanic: lead.lead.mechanic, phases: lead.lead.phases, bow: mechanic.bow, quote: lead.lead.quote },
    sight: sightOf(rules, arena),
    surprised: null,
    real: null,
  };
  return freezeDeep({ ...fight, rewards: rewardsFor(fight, { rules, words }) });
}
