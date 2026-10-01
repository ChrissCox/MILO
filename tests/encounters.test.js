// Encounters (module D, CONTRACT-PHASE4.md §7.3, §4.10, §4.13, §5.1, §5.3, §7.7): src/combat/encounters.js.
// Room levels, budgets and caps per stage and party size, the Tale-lead's room, fight ids and seeds,
// rewards, posts, caves with their Mimic and locked chest, field bosses, and the time it all takes.
//   node --test tests/encounters.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadD, sweepSpecs, prepareOptions, caveOf as kitCaveOf } from './encounters-kit.mjs';
import { createRng, hashInts } from '../src/world/rng.js';
import { assertCalm, assertName, assertCosy } from './calm.js';
import { readFileSync } from 'node:fs';
import { createGrid } from '../src/combat/grid.js';

const D = await loadD();
const { rules, riftgen, words, genres, leads, foes, hooks, encounters: E, bestiary, elsewhere, leadname } = D;
const {
  roomLevel, budgetFor, planEncounters, prepareElsewhere, prepareCave, fieldFight, rewardsFor, realLine, unitCost, leadCost,
  fightIdFor, TIER_LEVELS, BUDGETS, caveList,
} = E;
const SWEEP = sweepSpecs(riftgen, genres, { hashInts });
// Each Elsewhere prepared once (a real rift with its episode and cause) and shared below.
const CAUSE = 'The checks are still red.';
const PREPARED = SWEEP.map(({ spec, kind }) => {
  const opts = prepareOptions(D, kind, kind === 'wild' ? {} : { riftKey: spec.key, since: 1790000000000, cause: CAUSE });
  const out = prepareElsewhere(spec, opts);
  const scene = elsewhere.buildElsewhere(spec, out.layout, { genres, kind: kind === 'wild' ? null : kind, words, hooks, fight: { plan: out.plan, encounters: out.encounters } });
  return { spec, kind, ...out, scene };
});
const keyOf = (x, y) => `${x},${y}`;
const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const FIGHT_ID = /^fight:[a-z0-9:,.-]{1,90}$/;

function bfsCount(scene, block = null) {
  const seen = new Set([keyOf(scene.spawn.x, scene.spawn.y)]);
  const queue = [scene.spawn];
  const open = (x, y) => (block && block(x, y) === 'open') || (scene.walkable(x, y) && !(block && block(x, y) === 'closed'));
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = keyOf(x + dx, y + dy);
      if (seen.has(k) || !open(x + dx, y + dy)) continue;
      seen.add(k);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

// The party's walk inside a fight's arena, the way B's grid moves (eight ways, never across the
// corner between two blocked tiles), from the start tiles over '.' and '=' cells less `blocked`.
// Written here apart from encounters.js's arenaWalk, so the tests don't take its word for it.
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const EIGHT = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
// What a hero walks onto is B's grid's to say (§18.2 item 13): asked of createGrid itself, one
// object on one open tile, so neither this oracle nor encounters.js keeps a list of its own.
const onTile = new Map();
const walksOn = (kind) => onTile.get(kind) ?? onTile.set(kind, !createGrid({ arena: { rect: { x: 0, y: 0, w: 1, h: 1 }, cells: '.', height: '0', light: 'L' }, units: [], surfaces: [], lights: [], objects: [{ id: 'o0', kind, x: 0, y: 0, state: 'idle', flags: [], integrity: null }] }).blocksMove(0, 0)).get(kind);
const WALK_ON = { has: walksOn };
function partyWalk(arena, blocked = new Set()) {
  const { rect, cells } = arena;
  const open = (x, y) => inRect(rect, x, y) && ['.', '='].includes(cells[(y - rect.y) * rect.w + (x - rect.x)]) && !blocked.has(keyOf(x, y));
  const seen = new Set();
  const queue = [];
  for (const t of arena.entry) if (open(t.x, t.y) && !seen.has(keyOf(t.x, t.y))) { seen.add(keyOf(t.x, t.y)); queue.push(t); }
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head];
    for (const [dx, dy] of EIGHT) {
      const k = keyOf(x + dx, y + dy);
      if (seen.has(k) || !open(x + dx, y + dy)) continue;
      if (dx && dy && !open(x + dx, y) && !open(x, y + dy)) continue;
      seen.add(k);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}
const besideIn = (seen, x, y) => EIGHT.some(([dx, dy]) => seen.has(keyOf(x + dx, y + dy)));
const tilesOf = (u) => { const t = []; for (let dy = 0; dy < u.size; dy += 1) for (let dx = 0; dx < u.size; dx += 1) t.push({ x: u.post.x + dx, y: u.post.y + dy }); return t; };

/**
 * Inside a fight's arena nothing cuts the party off (the bush rule on their own walk): every tile
 * they reach with only the lead standing is still reached once the objects are in, but for the
 * objects' own tiles; the lead and every blocking object keep a side they reach; a walked-onto
 * object and every foe stand where they walk. → { objects, foes } counted
 */
function assertWayClear(f, footprint, where) {
  const foot = (footprint || []).map((t) => keyOf(t.x, t.y));
  const blocking = f.objects.filter((o) => !WALK_ON.has(o.kind));
  const before = partyWalk(f.arena, new Set(foot));
  const after = partyWalk(f.arena, new Set([...foot, ...blocking.map((o) => keyOf(o.x, o.y))]));
  const own = new Set(blocking.map((o) => keyOf(o.x, o.y)));
  for (const k of before) assert.ok(after.has(k) || own.has(k), `${where}: ${f.id}: an object cuts ${k} off`);
  // Props are the arena pass's (the scene's bush rule); a neighbour's in a lead's window may stand
  // where the party never goes, so only the lead's mechanic objects need a side.
  for (const o of f.objects.filter((x) => x.kind !== 'prop')) {
    if (WALK_ON.has(o.kind)) assert.ok(after.has(keyOf(o.x, o.y)), `${where}: ${f.id}: the ${o.kind} ${o.id} stands where the party walks`);
    else assert.ok(besideIn(after, o.x, o.y), `${where}: ${f.id}: the ${o.kind} ${o.id} at ${o.x},${o.y} keeps a side the party reaches`);
  }
  if (foot.length) assert.ok((footprint || []).some((t) => besideIn(after, t.x, t.y)), `${where}: ${f.id}: the lead keeps a side the party reaches`);
  for (const u of f.foes) for (const t of tilesOf(u)) assert.ok(after.has(keyOf(t.x, t.y)), `${where}: ${f.id}: ${u.id} at ${t.x},${t.y} stands where the party can walk to it`);
  return { objects: f.objects.filter((o) => o.kind !== 'prop').length, foes: f.foes.length };
}

const caveOf = (x, y, opts = {}) => kitCaveOf(x, y, { ...opts, hashInts });

const costOf = (unit, n) => unitCost(rules.budgets, n, { rank: unit.rank, level: unit.level });
const fighting = (units) => units.filter((u) => u.side === 'foe');

test(`encounters run against ${D.mode === 'real' ? 'B’s rules' : 'the kit’s transcription of §4'}`, (t) => {
  t.diagnostic(`mode: ${D.mode}${D.why ? ` (${D.why})` : ''}`);
  assert.deepEqual([...TIER_LEVELS], rules.tiers, 'the built-in tier row is rules.json’s');
  assert.deepEqual(JSON.parse(JSON.stringify(BUDGETS)), JSON.parse(JSON.stringify(rules.budgets)), 'the built-in budgets are rules.json’s');
});

test('room levels: a tier’s foe level, the Road level in real rifts, deep ranks past tier 8, and never 2+ above a level-1 or 2 party', () => {
  const at = (tier, depth, kind = 'wild', roadLevel = 5) => roomLevel({ tier, depth }, { kind, roadLevel, rules });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((tier) => at(tier, 1).n), [1, 2, 4, 5, 7, 9, 10, 11]);
  assert.deepEqual(at(8, 10), { n: 11, deepRank: 0 });
  assert.deepEqual(at(8, 11), { n: 11, deepRank: 1 });
  assert.deepEqual(at(8, 17), { n: 11, deepRank: 3 });
  assert.deepEqual(at(7, 17), { n: 10, deepRank: 0 }, 'deep ranks start at tier 8');
  assert.deepEqual(at(6, 1, 'real', 4), { n: 4, deepRank: 0 }, 'a real rift runs at the Road level');
  assert.deepEqual(at(1, 1, 'story', 3), { n: 3, deepRank: 0 });
  assert.deepEqual(at(5, 1, 'cave', 4), { n: 7, deepRank: 0 }, 'a cave runs at its mouth’s tier');
  assert.equal(at(5, 1, 'wild', 1).n, 3, 'at party level 1 nothing is more than 2 above');
  assert.equal(at(5, 1, 'wild', 2).n, 4);
  assert.equal(at(5, 1, 'wild', 3).n, 7, 'from level 3 the tier stands');
  assert.equal(roomLevel({ tier: 3, depth: 1 }, { kind: 'wild', roadLevel: 4 }).n, 4, 'without rules it uses §4.10’s row');
  // A capped room has no deep rank: a rank is worth more than the levels the cap took away.
  assert.deepEqual(at(8, 20, 'wild', 1), { n: 3, deepRank: 0 }, 'a deep rift for a level-1 party');
  assert.deepEqual(at(8, 20, 'wild', 2), { n: 4, deepRank: 0 });
  assert.deepEqual(at(8, 20, 'cave', 1), { n: 3, deepRank: 0 }, 'a deep cave too');
  assert.deepEqual(at(8, 20, 'wild', 3), { n: 11, deepRank: 4 }, 'from level 3 the deep rank stands');
  assert.deepEqual(at(3, 1, 'wild', 2), { n: 4, deepRank: 0 }, 'a cap that doesn’t bind changes nothing');
});

test('budgets: Trivial 40, Low 60, Moderate 80, Severe 120 for four, less per hero fewer, more per depth past 3', () => {
  const table = {
    low: [15, 30, 45, 60], moderate: [20, 40, 60, 80], severe: [30, 60, 90, 120], trivial: [10, 20, 30, 40],
  };
  for (const [role, row] of Object.entries(table)) {
    assert.deepEqual([1, 2, 3, 4].map((p) => budgetFor(role, p, 1, rules)), row, role);
    assert.deepEqual([1, 2, 3, 4].map((p) => budgetFor(role, p, 3)), row, `${role}, no depth bonus to 3`);
  }
  assert.equal(budgetFor('moderate', 4, 4, rules), 88, 'depth 4: 2 per hero');
  assert.equal(budgetFor('moderate', 2, 6, rules), 40 + 2 * 6);
  assert.equal(budgetFor('severe', 4, 30, rules), 120 + 4 * 10, 'up to 10 per hero');
  // What things cost.
  assert.equal(unitCost(rules.budgets, 5, { rank: 'stray', level: 5 }), 40);
  assert.equal(unitCost(rules.budgets, 5, { rank: 'stray', level: 4 }), 30);
  assert.equal(unitCost(rules.budgets, 5, { rank: 'elite', level: 4 }), 40, 'an elite costs as one level higher');
  assert.equal(unitCost(rules.budgets, 5, { rank: 'lackey', level: 3 }), 20, 'a lackey as two below');
  assert.equal(unitCost(rules.budgets, 9, { rank: 'stray', level: 3 }), 5, 'below n − 4 costs 5');
  assert.equal(leadCost(rules, 'hairline', 4, 1), 60);
  assert.equal(leadCost(rules, 'open', 4, 1), 90);
  assert.equal(leadCost(rules, 'gaping', 4, 1), 120);
  assert.equal(leadCost(rules, 'open', 2, 1), 45, 'with two heroes an open lead costs 3 × 30 × ½');
  assert.equal(leadCost(rules, 'gaping', 1, 9), 30, 'a lead fits even with one hero');
});

// A room's kinds, the cheering bright stray's own among them (§4.10: 3 kinds a room).
const kindsOf = (units) => new Set(units.map((u) => u.talkKind ?? `cheer:${u.genres.join('+')}:${u.name}`));

// Every room, checked against §4.10 at party sizes 1–4.
function checkRooms(spec, out, { partySize, kind }, tally) {
  const { n } = roomLevel(spec, { kind, roadLevel: 3, rules });
  const depth = Math.max(1, Math.floor(spec.depth) || 1);
  const mult = spec.affixes.reduce((m, a) => m * (rules.budgets.affixes[a.id] ?? 1), 1);
  const colossal = spec.affixes.some((a) => a.id === 'colossal');
  for (const room of out.encounters.rooms) {
    const f = room.fight;
    const units = fighting(f.foes);
    assert.ok(f.foes.length + (f.leadUnit ? 1 : 0) <= 8, `${f.id}: at most 8 foes`);
    assert.ok(kindsOf(f.foes).size <= 3, `${f.id}: at most 3 kinds, a cheering stray’s counted`);
    assert.ok(units.filter((u) => u.rank === 'elite').length <= (depth >= 7 ? 2 : 1) + (colossal ? 1 : 0), `${f.id}: one elite until depth 7`);
    const spent = units.reduce((s, u) => s + costOf(u, n), 0);
    if (f.kind === 'lead') {
      const role = spec.stage === 'hairline' ? 'moderate' : 'severe';
      const lead = leadCost(rules, spec.stage, partySize, depth);
      assert.equal(f.budget, Math.max(budgetFor(role, partySize, depth, rules) * mult, lead), `${f.id}: the lead room’s budget`);
      assert.ok(lead + spent <= f.budget + 1e-9, `${f.id}: the lead (${lead}) and helpers (${spent}) fit ${f.budget} for ${partySize}`);
      assert.equal(f.weight, rules.road.leadWeights[spec.stage]);
      // §4.10's table, at every depth and affix: with a lackey (hairline), with a stray a level
      // below (open; a lackey when a smaller party's share leaves too little), alone (gaping).
      const left = f.budget - lead;
      assert.ok(units.length <= (spec.stage === 'gaping' ? 0 : 1), `${f.id}: ${spec.stage} brings ${units.length} helpers`);
      if (spec.maelstrom) assert.equal(f.foes.length, 0, 'a Maelstrom’s lead comes alone');
      for (const u of units) {
        if (spec.stage === 'hairline') assert.equal(u.rank, 'lackey', `${f.id}: with a lackey`);
        else if (u.rank === 'stray') assert.ok(u.level === Math.max(0, n - 1) && left >= 30 - 1e-9, `${f.id}: a stray a level below`);
        else assert.ok(u.rank === 'lackey' && left < 30 && left >= 20 - 1e-9, `${f.id}: a lackey only where the stray doesn’t fit (${left} left)`);
      }
      tally.helpers[spec.stage] = (tally.helpers[spec.stage] || 0) + units.length;
      if (spec.stage === 'open' && !spec.maelstrom && units.length && left >= 30) tally.openStray += 1;
    } else {
      const role = spec.stage === 'hairline' ? 'low' : 'moderate';
      let want = budgetFor(role, partySize, depth, rules) * mult;
      if (colossal) want += unitCost(rules.budgets, n, { rank: 'elite', level: Math.max(0, n - 1) });
      // What found no post comes off the budget, so a room pays for what stands in it.
      assert.ok(f.budget <= want + 1e-9 && f.budget > 0, `${f.id}: a ${role} room for ${partySize} (${f.budget} of ${want})`);
      if (f.budget < want - 1e-9) tally.trimmed += 1;
      assert.equal(f.weight, f.budget / 20);
      assert.equal(f.rewards.weight, f.weight);
      if (spent > f.budget + 1e-9) {
        // The one exception, a room is never empty: one lackey where nothing fits.
        assert.equal(units.length, 1, `${f.id}: over budget only as a single foe`);
        assert.ok(spent <= 20, `${f.id}: the cheapest thing its kinds can be`);
        tally.floors += 1;
      }
    }
    tally.rooms += 1;
  }
}

test('budgets and caps hold per stage and party size 1–4, and a lead’s cost scales by the share so it always fits', () => {
  const tally = { rooms: 0, floors: 0, trimmed: 0, openStray: 0, helpers: {} };
  const stages = new Set();
  for (const partySize of [1, 2, 3, 4]) {
    for (const { spec, kind } of SWEEP.filter((_, i) => i % 3 === partySize % 3)) {
      const out = prepareElsewhere(spec, prepareOptions(D, kind, { partySize }));
      checkRooms(spec, out, { partySize, kind }, tally);
      stages.add(`${spec.stage}:${partySize}`);
    }
  }
  assert.equal(stages.size, 12, 'every stage at every party size');
  assert.ok(tally.rooms > 1000, `${tally.rooms} rooms`);
  assert.ok(tally.floors <= tally.rooms * 0.02, `only a party of one at n ≤ 2 ever meets the one-lackey floor (${tally.floors})`);
  assert.ok(tally.trimmed <= tally.rooms * 0.01, `a room is rarely too cramped for all it planned (${tally.trimmed})`);
  assert.equal(tally.helpers.gaping || 0, 0, 'a gaping lead always comes alone');
  assert.ok(tally.helpers.hairline > 20 && tally.openStray > 20, `hairline leads bring their lackey (${tally.helpers.hairline}), open ones their stray (${tally.openStray})`);
});

// The same fill with a budget big enough that every cap binds: Crowded made ×8.
test('with budget to spare every cap binds: 8 foes, 3 kinds, one elite until depth 7 and two from it', () => {
  const big = { ...rules, budgets: { ...rules.budgets, affixes: { ...rules.budgets.affixes, crowded: 8 } } };
  const most = { shallow: 0, deep: 0 };
  let full = 0;
  let rooms = 0;
  for (let i = 0; i < 160; i += 1) {
    const depth = i % 2 ? 2 + (i % 5) : 7 + (i % 5);
    let spec = riftgen.wildRift({ seed: hashInts(i, 'caps'), tier: 3 + (i % 5), depth });
    spec = { ...spec, affixes: [...spec.affixes.filter((a) => a.id !== 'lonely' && a.id !== 'colossal'), { id: 'crowded', name: 'Crowded' }] };
    const out = prepareElsewhere(spec, prepareOptions(D, 'wild', { rules: big }));
    for (const room of out.encounters.rooms.filter((r) => r.fight.kind === 'room')) {
      const units = fighting(room.fight.foes);
      rooms += 1;
      assert.ok(room.fight.foes.length <= 8, `${room.fightId}: ${room.fight.foes.length} foes`);
      assert.ok(kindsOf(room.fight.foes).size <= 3, `${room.fightId}: at most 3 kinds`);
      const elites = units.filter((u) => u.rank === 'elite').length;
      assert.ok(elites <= (depth >= 7 ? 2 : 1), `${room.fightId}: ${elites} elites at depth ${depth}`);
      most[depth >= 7 ? 'deep' : 'shallow'] = Math.max(most[depth >= 7 ? 'deep' : 'shallow'], elites);
      if (units.length === 8) full += 1;
    }
  }
  assert.ok(rooms > 150, `${rooms} rooms`);
  assert.ok(full > rooms * 0.8, `a room fills to the 8-foe cap (${full} of ${rooms})`);
  assert.deepEqual(most, { shallow: 1, deep: 2 }, 'the elite cap is reached on both sides of depth 7');
});

// What a foe counts as against the party (§4.10): its level, an elite one higher, a lackey its
// own (the room's n − 2), a lead its elite level.
const countsAs = (u) => (u.rank === 'elite' || u.rank === 'lead' ? u.level + 1 : u.level);

test('at party levels 1 and 2 nothing counts as more than 2 levels above the party, even where the budget reaches n + 1', () => {
  const big = { ...rules, budgets: { ...rules.budgets, affixes: { ...rules.budgets.affixes, crowded: 8 } } };
  const most = {};
  for (const roadLevel of [1, 2, 3]) {
    for (let i = 0; i < 70; i += 1) {
      let spec = riftgen.wildRift({ seed: hashInts(i, 'party-cap'), tier: 3 + (i % 6), depth: 1 + (i % 9) });
      spec = { ...spec, affixes: [...spec.affixes.filter((a) => a.id !== 'lonely'), { id: 'crowded', name: 'Crowded' }] };
      const { n } = roomLevel(spec, { kind: 'wild', roadLevel, rules });
      const out = prepareElsewhere(spec, prepareOptions(D, 'wild', { rules: big, roadLevel }));
      for (const room of out.encounters.rooms) {
        for (const u of [...fighting(room.fight.foes), ...(room.fight.leadUnit ? [room.fight.leadUnit] : [])]) {
          if (roadLevel <= 2) assert.ok(countsAs(u) <= roadLevel + 2, `${room.fightId}: a ${u.rank} at level ${u.level} for a level-${roadLevel} party`);
          most[roadLevel] = Math.max(most[roadLevel] ?? -1, countsAs(u) - n);
        }
      }
    }
  }
  // With budget to spare, a level-3 party meets strays a level above the room; levels 1 and 2 never do.
  assert.deepEqual(most, { 1: 0, 2: 0, 3: 1 }, 'the cap binds exactly where the party is level 1 or 2');
});

test('at party levels 1 and 2 a deep rift or cave has no deep rank: every foe is built as its capped level alone', () => {
  let units = 0;
  let caves = 0;
  const sameAs = (u, want, where) => assert.deepEqual(u, want, `${where}: ${u.id} is built with no deep rank`);
  for (const roadLevel of [1, 2]) {
    for (let i = 0; i < 24; i += 1) {
      const depth = 11 + (i % 10);
      const spec = riftgen.wildRift({ seed: hashInts(i, 'deep-cap'), tier: 8, depth });
      const partySize = 1 + (i % 4);
      assert.ok(roomLevel(spec, { kind: 'wild', roadLevel: 3, rules }).deepRank >= 1, 'deep enough to have a rank at level 3');
      const out = prepareElsewhere(spec, prepareOptions(D, 'wild', { roadLevel, partySize }));
      for (const room of out.encounters.rooms) {
        const f = room.fight;
        assert.deepEqual([f.level, f.deepRank, f.rewards.deepRank], [roadLevel + 2, 0, 0], `${f.id}: capped at ${roadLevel + 2}, no deep rank`);
        assert.equal(f.rewards.xp, f.weight * rules.road.perWeight[roadLevel + 1], `${f.id}: no +45 a weight`);
        for (const u of f.foes.filter((x) => x.side === 'foe')) {
          const kind = Number(u.talkKind.slice(1));
          sameAs(u, bestiary.strayUnit(spec, kind, f.level, { level: u.level, rank: u.rank, rules, foes, deepRank: 0, partySize, roadLevel, id: u.id, post: u.post }), f.id);
          assert.ok(countsAs(u) <= roadLevel + 2);
          units += 1;
        }
        if (f.leadUnit) {
          sameAs(f.leadUnit, bestiary.leadUnit(spec, { level: f.level, rules, leads, foes, words, partySize, deepRank: 0, roadLevel, hooks, post: f.leadUnit.post }), f.id);
          units += 1;
        }
      }
      const cave = caveOf(i * 13 - 50, i * 5 + 70, { region: Object.keys(foes.caves)[i % 8], tier: 8, depth });
      const c = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel, partySize, rules, foes, words, day: 4 });
      const mimic = c.encounters.chests.find((x) => x.mimic).mimic.fight;
      for (const f of [...c.encounters.rooms.map((r) => r.fight), mimic]) {
        assert.deepEqual([f.level, f.deepRank], [roadLevel + 2, 0], `${f.id}: capped, no deep rank`);
        for (const u of f.foes) {
          const foe = u.kind === 'mimic' ? foes.mimic : [...foes.canon, ...foes.creatures].find((x) => x.id === u.talkKind);
          sameAs(u, bestiary.foeUnit(foe, f.level, { level: u.level, rank: u.rank, rules, foes, partySize, roadLevel, id: u.id, post: u.post, deepRank: 0 }), f.id);
          units += 1;
        }
      }
      caves += 1;
    }
  }
  assert.ok(units > 300 && caves === 48, `${units} foes in deep places, ${caves} caves`);
});

test('Colossal adds an elite: every Colossal stray room holds one, first, on top of its budget', () => {
  let rooms = 0;
  let converted = 0;
  for (const partySize of [1, 2, 3, 4]) {
    for (let i = 0; i < 60; i += 1) {
      let spec = riftgen.wildRift({ seed: hashInts(i, partySize, 'colossal'), tier: 2 + (i % 7), depth: 1 + (i % 9) });
      if (!spec.strays.some((k) => rules.genres[k.genre]?.fights !== false)) continue;
      spec = { ...spec, affixes: [...spec.affixes.filter((a) => !['crowded', 'lonely', 'colossal'].includes(a.id)), { id: 'colossal', name: 'Colossal' }] };
      const { n } = roomLevel(spec, { kind: 'wild', roadLevel: 3, rules });
      const out = prepareElsewhere(spec, prepareOptions(D, 'wild', { partySize }));
      for (const room of out.encounters.rooms.filter((r) => r.fight.kind === 'room')) {
        const units = fighting(room.fight.foes);
        const elite = units.find((u) => u.rank === 'elite');
        // An elite with no free 2×2 comes as a stray a level higher (the same cost): at n, first.
        if (!elite) {
          assert.ok(units[0].rank === 'stray' && units[0].level === n, `${room.fightId}: the Colossal elite, or its one-tile stand-in, comes first`);
          converted += 1;
        } else assert.equal(units[0], elite, `${room.fightId}: the elite comes first`);
        const role = spec.stage === 'hairline' ? 'low' : 'moderate';
        assert.ok(room.fight.budget <= budgetFor(role, partySize, spec.depth, rules) + unitCost(rules.budgets, n, { rank: 'elite', level: Math.max(0, n - 1) }) + 1e-9);
        rooms += 1;
      }
    }
  }
  assert.ok(rooms > 150, `${rooms} Colossal rooms`);
  assert.ok(converted <= rooms * 0.05, `${converted} of ${rooms} had no 2×2 for their elite`);
});

test('a room is never empty: where nothing fits a party of one’s budget, a single lackey waits', () => {
  let floors = 0;
  for (let i = 0; floors < 25 && i < 400; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'floor'), tier: 1 + (i % 2), depth: 1 + (i % 3) });
    if (spec.stage !== 'hairline' || spec.affixes.some((a) => ['crowded', 'colossal', 'lonely'].includes(a.id))) continue;
    if (!spec.strays.some((k) => rules.genres[k.genre]?.fights !== false)) continue;
    const out = prepareElsewhere(spec, prepareOptions(D, 'wild', { partySize: 1, roadLevel: 1 }));
    const planned = out.plan.rooms.filter((r) => r.fight && r.roomId !== 'lead');
    const { n } = roomLevel(spec, { kind: 'wild', roadLevel: 1, rules });
    assert.equal(budgetFor('low', 1, spec.depth, rules), 15);
    for (const room of planned) {
      const got = out.encounters.rooms.find((r) => r.roomId === room.roomId);
      assert.ok(got, `${spec.id}: ${room.roomId} still holds a fight`);
      const units = fighting(got.fight.foes);
      assert.equal(units.length, 1, `${got.fightId}: one foe`);
      assert.equal(costOf(units[0], n), 20, 'the cheapest thing its kinds can be');
      floors += 1;
    }
  }
  assert.ok(floors >= 25, `${floors} one-hero Low rooms`);
});

// Tiles unfit for a post: every object, its approach and footprint, the spawn, the door, the
// party's start tiles and the mouths (encounters.js's rule, written out here).
function postAvoid(scene, arena) {
  const avoid = new Set([keyOf(scene.spawn.x, scene.spawn.y), ...arena.entry.map((t) => keyOf(t.x, t.y)), ...arena.mouths.map((t) => keyOf(t.x, t.y))]);
  for (const o of scene.objects) {
    if (o.kind === 'foliage' && !o.blocks) continue;
    avoid.add(keyOf(o.x, o.y));
    if (!o.scenery && o.approach) avoid.add(keyOf(o.approach.x, o.approach.y));
    for (const t of o.footprint || []) avoid.add(keyOf(t.x, t.y));
  }
  return avoid;
}

test('a room too cramped for all it planned drops what finds no post, and its budget and pay drop with it', () => {
  let checked = 0;
  for (const { spec, kind, plan, encounters } of PREPARED) {
    if (checked >= 12) break;
    const room = encounters.rooms.find((r) => r.fight.kind === 'room' && fighting(r.fight.foes).filter((u) => u.size === 1).length >= 3);
    if (!room) continue;
    const { n } = roomLevel(spec, { kind, roadLevel: 3, rules });
    const full = room.fight;
    const scene = elsewhere.buildElsewhere(spec, plan.layout, { genres, kind: kind === 'wild' ? null : kind, words, hooks, fight: { plan, encounters: null } });
    // Leave the party's start tiles and two posts right beside them, and fill every other open
    // cell of the room with cover.
    const planRoom = plan.rooms.find((r) => r.roomId === room.roomId);
    const { rect, entry } = planRoom.arena;
    const avoid = postAvoid(scene, planRoom.arena);
    const starts = new Set(entry.map((t) => keyOf(t.x, t.y)));
    const beside = [];
    for (let y = planRoom.rect.y; y < planRoom.rect.y + planRoom.rect.h; y += 1) for (let x = planRoom.rect.x; x < planRoom.rect.x + planRoom.rect.w; x += 1) {
      const c = planRoom.arena.cells[(y - rect.y) * rect.w + (x - rect.x)];
      if ((c === '.' || c === '=') && scene.walkable(x, y) && !avoid.has(keyOf(x, y)) && DIRS4.some(([dx, dy]) => starts.has(keyOf(x + dx, y + dy)))) beside.push(keyOf(x, y));
    }
    if (beside.length < 2) continue;
    const keep = new Set([...starts, ...beside.slice(0, 2)]);
    const cells = [...planRoom.arena.cells].map((c, i) => {
      const x = rect.x + (i % rect.w);
      const y = rect.y + Math.floor(i / rect.w);
      return (c === '.' || c === '=') && inRect(planRoom.rect, x, y) && !keep.has(keyOf(x, y)) ? 'o' : c;
    }).join('');
    const cramped = { ...plan, rooms: plan.rooms.map((r) => (r === planRoom ? { ...r, arena: { ...r.arena, cells } } : r)) };
    const opts = kind === 'wild' ? {} : { riftKey: spec.key, since: 1790000000000, cause: CAUSE };
    const again = planEncounters(spec, cramped, scene, { kind, roadLevel: 3, partySize: 4, rules, leads, foes, words, hooks, ...opts });
    const f = again.rooms.find((r) => r.roomId === room.roomId).fight;
    const cost = (units) => fighting(units).reduce((s, u) => s + costOf(u, n), 0);
    assert.ok(fighting(f.foes).length >= 1 && fighting(f.foes).length <= 2, `${f.id}: only two posts left`);
    for (const u of fighting(f.foes)) assert.ok(beside.slice(0, 2).includes(keyOf(u.post.x, u.post.y)), `${f.id}: ${u.id} on one of them`);
    assert.equal(f.budget, full.budget - (cost(full.foes) - cost(f.foes)), `${f.id}: the budget drops by what was left out`);
    assert.equal(f.weight, f.budget / 20);
    assert.equal(f.rewards.weight, f.weight, 'and so does the pay');
    assert.ok(f.rewards.xp < full.rewards.xp);
    checked += 1;
  }
  assert.ok(checked >= 12, `${checked} cramped rooms`);
});

test('an elite with no free 2×2 comes as a stray a level higher, at the same cost, rather than not at all', () => {
  let checked = 0;
  for (const { spec, kind, plan, encounters } of PREPARED) {
    if (checked >= 10) break;
    const room = encounters.rooms.find((r) => r.fight.kind === 'room' && fighting(r.fight.foes).some((u) => u.rank === 'elite'));
    if (!room) continue;
    const { n } = roomLevel(spec, { kind, roadLevel: 3, rules });
    const full = room.fight;
    // A pillar of cover on every odd-odd tile of the room's floor (the start tiles left open): the
    // party still walks everywhere, with plenty of single tiles and not one free 2×2.
    const planRoom = plan.rooms.find((r) => r.roomId === room.roomId);
    const { rect } = planRoom.arena;
    const starts = new Set(planRoom.arena.entry.map((t) => keyOf(t.x, t.y)));
    const cells = [...planRoom.arena.cells].map((c, i) => {
      const x = rect.x + (i % rect.w);
      const y = rect.y + Math.floor(i / rect.w);
      return (c === '.' || c === '=') && inRect(planRoom.rect, x, y) && x % 2 === 1 && y % 2 === 1 && !starts.has(keyOf(x, y)) ? 'o' : c;
    }).join('');
    const singles = [...cells].filter((c, i) => (c === '.' || c === '=') && inRect(planRoom.rect, rect.x + (i % rect.w), rect.y + Math.floor(i / rect.w))).length;
    if (singles < 2 * full.foes.length + 6) continue;
    const cramped = { ...plan, rooms: plan.rooms.map((r) => (r === planRoom ? { ...r, arena: { ...r.arena, cells } } : r)) };
    const scene = elsewhere.buildElsewhere(spec, plan.layout, { genres, kind: kind === 'wild' ? null : kind, words, hooks, fight: { plan, encounters: null } });
    const opts = kind === 'wild' ? {} : { riftKey: spec.key, since: 1790000000000, cause: CAUSE };
    const f = planEncounters(spec, cramped, scene, { kind, roadLevel: 3, partySize: 4, rules, leads, foes, words, hooks, ...opts }).rooms.find((r) => r.roomId === room.roomId).fight;
    const units = fighting(f.foes);
    const cost = (list) => fighting(list).reduce((s, u) => s + costOf(u, n), 0);
    if (units.length !== fighting(full.foes).length) continue;
    assert.ok(!units.some((u) => u.rank === 'elite' || u.size !== 1), `${f.id}: no room for a Large foe`);
    for (const elite of fighting(full.foes).filter((u) => u.rank === 'elite')) {
      assert.ok(units.some((u) => u.rank === 'stray' && u.talkKind === elite.talkKind && u.level === elite.level + 1), `${f.id}: the ${elite.name} comes as a stray a level higher`);
    }
    assert.equal(cost(f.foes), cost(full.foes), 'at the same cost');
    assert.equal(f.budget, full.budget, 'so the budget stands');
    checked += 1;
  }
  assert.ok(checked >= 5, `${checked} rooms whose elite found no 2×2`);
});

const PUZZLE_GENRES = ['verdant', 'starlight', 'summit', 'backhalls'];

test('bright and Backhalls leads never fight, bright strays only cheer, and Backhalls strays never come', () => {
  let noFight = 0;
  let cheering = 0;
  const why = { mechanic: 0, genre: 0 };
  // A lead stays a puzzle when its mechanic is a no-fight one (§3.1) or it's bright or Backhalls
  // itself (COMBAT §8.1), which a fusion can pair either way round; every other lead fights.
  const extra = [];
  for (let i = 0; extra.length < 40 && i < 4000; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'puzzle-leads'), tier: 1 + (i % 8), depth: 1 });
    if (spec.genres.length > 1 && PUZZLE_GENRES.includes(spec.taleLead.genre) !== bestiary.mechanicOf(spec, leads, words).noFight) {
      extra.push({ spec, encounters: prepareElsewhere(spec, prepareOptions(D, 'wild')).encounters, plan: { lead: true } });
    }
  }
  for (const { spec, encounters, plan } of [...PREPARED, ...extra]) {
    const out = { encounters, plan };
    const mech = bestiary.mechanicOf(spec, leads, words);
    const brightLead = PUZZLE_GENRES.includes(spec.taleLead.genre);
    assert.equal(bestiary.isPuzzleLead(spec, { leads, words, rules }), mech.noFight || brightLead, spec.id);
    if (mech.noFight || brightLead) {
      noFight += 1;
      if (mech.noFight) why.mechanic += 1;
      if (brightLead && !mech.noFight) why.genre += 1;
      assert.equal(out.encounters.leadRoom, null, `${spec.id}: a ${spec.taleLead.genre} lead with ${mech.id} is a puzzle`);
      assert.ok(!out.encounters.rooms.some((r) => r.roomId === 'lead'));
    } else assert.equal(out.encounters.leadRoom, out.plan.lead ? 'lead' : null);
    for (const room of out.encounters.rooms.filter((r) => r.fight.leadUnit)) {
      assert.ok(!PUZZLE_GENRES.includes(room.fight.leadUnit.genres[0]), `${spec.id}: a fought lead is a shadow genre’s`);
    }
    for (const room of out.encounters.rooms) {
      for (const u of room.fight.foes) {
        const g = u.genres[0];
        assert.notEqual(g, 'backhalls', 'Backhalls strays never fight');
        if (['verdant', 'starlight', 'summit'].includes(g)) {
          assert.equal(u.side, 'neutral', 'a bright stray stands aside');
          cheering += 1;
        } else assert.equal(u.side, 'foe');
      }
      assert.ok(fighting(room.fight.foes).length + (room.fight.leadUnit ? 1 : 0) > 0, 'every fight has someone to face');
    }
  }
  assert.ok(noFight > 20 && cheering > 5, `${noFight} puzzle leads, ${cheering} cheering strays`);
  assert.ok(why.mechanic > 10 && why.genre > 10, `puzzles by their mechanic (${why.mechanic}) and bright or Backhalls leads with a shadow mechanic (${why.genre})`);
});

test('no fought lead wears a company name, unless leads.json tags it as a planned hook', () => {
  let swapped = 0;
  let plain = 0;
  for (let i = 0; i < 3000; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'lead-names'), tier: 3 + (i % 6), depth: 1 });
    const clash = leadname.companyNamesIn(spec.taleLead.name);
    if (!clash.length && (plain += 1) % 40) continue;
    const out = prepareElsewhere(spec, prepareOptions(D, 'wild'));
    const lead = out.encounters.rooms.find((r) => r.roomId === 'lead')?.fight.leadUnit;
    if (!lead) continue;
    assert.deepEqual(leadname.companyNamesIn(lead.name), [], lead.name);
    if (clash.length) {
      swapped += 1;
      const hooked = prepareElsewhere(spec, prepareOptions(D, 'wild', { hooks: clash }));
      const kept = hooked.encounters.rooms.find((r) => r.roomId === 'lead').fight.leadUnit;
      assert.ok(kept.name.includes(clash[0]), `${spec.taleLead.name}: a planned hook keeps its name`);
    }
  }
  assert.ok(swapped > 20, `${swapped} leads renamed`);
});

test('specs are mode-free: a FightSpec names no mode, and the same rift always prepares the same way', () => {
  for (const { spec, kind } of SWEEP.slice(0, 80)) {
    const a = prepareElsewhere(spec, prepareOptions(D, kind));
    const b = prepareElsewhere(spec, prepareOptions(D, kind));
    assert.deepEqual(a.encounters, b.encounters);
    assert.ok(!/storybook|mauds-table|long-road/.test(JSON.stringify(a.encounters)), 'no mode inside');
    assert.ok(Object.isFrozen(a.encounters));
    for (const room of a.encounters.rooms) assert.ok(Object.isFrozen(room.fight) && Object.isFrozen(room.fight.foes));
  }
});

test('a FightSpec has §5.3’s shape, its id and seed, and foes at posts the scene can walk to', () => {
  let checked = 0;
  for (const { spec, kind, scene, encounters } of PREPARED) {
    const out = { encounters };
    assert.equal(scene.encounters, out.encounters.rooms, 'the scene carries the rooms');
    const reach = bfsCount(scene);
    const avoid = new Set();
    for (const o of scene.objects) {
      if (o.kind === 'foliage' && !o.blocks) continue;
      avoid.add(keyOf(o.x, o.y));
      if (!o.scenery) avoid.add(keyOf(o.approach.x, o.approach.y));
    }
    avoid.add(keyOf(scene.spawn.x, scene.spawn.y));
    for (const room of out.encounters.rooms) {
      const f = room.fight;
      checked += 1;
      assert.deepEqual(Object.keys(f), ['id', 'room', 'kind', 'seed', 'level', 'deepRank', 'budget', 'weight', 'stage', 'genres', 'affixes', 'arena',
        'foes', 'leadUnit', 'objects', 'surfaces', 'lead', 'sight', 'surprised', 'real', 'rewards']);
      assert.match(f.id, FIGHT_ID);
      assert.equal(f.id, kind === 'wild' ? `fight:${spec.id}:w:${room.roomId}` : `fight:${spec.id}:${(1790000000000).toString(36)}:${room.roomId}`);
      assert.equal(f.seed, hashInts(spec.seed >>> 0, room.roomId, 'fight'), 'fightSeed');
      assert.equal(room.fightId, f.id);
      assert.equal(f.room, room.roomId);
      assert.equal(f.kind, room.roomId === 'lead' ? 'lead' : 'room');
      assert.equal(f.sight, f.arena.light[0] === 'L' ? 6 : 3);
      assert.equal(room.sight, f.sight);
      assert.equal(f.surprised, spec.affixes.some((a) => a.id === 'sleepy') ? 'foes' : null);
      assert.deepEqual(f.affixes, E.FIGHT_AFFIXES.filter((id) => spec.affixes.some((a) => a.id === id)));
      const known = new Set([...spec.genres, ...spec.strays.flatMap((k) => [k.genre, k.second])]);
      assert.ok(f.genres.length > 0 && f.genres.every((g) => known.has(g)), `${f.id}: its genres are the rift’s`);
      if (kind === 'wild') assert.equal(f.real, null);
      else assert.deepEqual(f.real, { key: spec.key, cause: CAUSE });
      f.foes.forEach((u, i) => assert.equal(u.id, `f${i}`));
      // A lead's name may start with a lowercase “the” (“the Uncounted”), as riftgen writes it; it reads
      // capitalised at the start of a line, as the shell's startName shows it.
      for (const u of [...f.foes, ...(f.leadUnit ? [f.leadUnit] : [])]) { assertName(u.name.charAt(0).toUpperCase() + u.name.slice(1), `${f.id}: ${u.id}’s name`); assertCosy(u.name, u.id); }
      const covered = new Set();
      for (const u of [...f.foes, ...(f.leadUnit ? [f.leadUnit] : [])]) {
        assert.ok(u.post, `${u.id} has a post`);
        for (let dy = 0; dy < u.size; dy += 1) for (let dx = 0; dx < u.size; dx += 1) {
          const k = keyOf(u.post.x + dx, u.post.y + dy);
          assert.ok(!covered.has(k), `${f.id}: two foes on ${k}`);
          covered.add(k);
          if (u.id === 'lead') continue;
          assert.ok(inRect(room.rect, u.post.x + dx, u.post.y + dy), `${f.id}: ${u.id} stands in its room`);
          assert.ok(reach.has(k), `${f.id}: ${u.id} on ground the party can reach`);
          assert.ok(!avoid.has(k), `${f.id}: ${u.id} off objects, their approaches and the spawn`);
          assert.ok(!f.arena.entry.some((t) => keyOf(t.x, t.y) === k), `${f.id}: ${u.id} off the party’s start tiles`);
        }
      }
      assert.deepEqual(room.posts.map((p) => p.unitId), [...f.foes.map((u) => u.id), ...(f.leadUnit ? ['lead'] : [])]);
      const ids = f.objects.map((o) => o.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(f.objects.length <= 24);
      for (const o of f.objects) {
        assert.ok(inRect(f.arena.rect, o.x, o.y));
        assert.ok(!covered.has(keyOf(o.x, o.y)), `${f.id}: ${o.id} under a foe`);
        assert.ok(!f.arena.entry.some((t) => t.x === o.x && t.y === o.y));
        assert.deepEqual(Object.keys(o), ['id', 'kind', 'x', 'y', 'state', 'flags', 'integrity']);
      }
      const tiles = new Set();
      for (const s of f.surfaces) {
        assert.ok(['water', 'foliage', 'ice', 'smog', 'candle-wax'].includes(s.id));
        assert.equal(s.rounds, null);
        assert.ok(!tiles.has(keyOf(s.x, s.y)), 'one surface a tile');
        tiles.add(keyOf(s.x, s.y));
      }
    }
  }
  assert.ok(checked > 1000, `${checked} fights`);
});

// Lead fights whose mechanic ships its objects: the sweep's, and more from their own seeds (each
// prepared once, when first asked for).
let mechanicLeads = null;
function MECHANIC_LEADS() {
  if (mechanicLeads) return mechanicLeads;
  mechanicLeads = PREPARED.filter(({ encounters }) => encounters.leadRoom);
  for (let i = 0; i < 2400; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'mech-probe'), tier: 1 + (i % 8), depth: 1 + (i % 9) });
    const mech = bestiary.leadMechanic(spec, { leads, words });
    if (mech.fallback || bestiary.isPuzzleLead(spec, { leads, words, rules })) continue;
    mechanicLeads.push({ spec, kind: 'wild', ...prepareElsewhere(spec, prepareOptions(D, 'wild')) });
  }
  return mechanicLeads;
}

test('the Tale-lead’s room: the lead on its footprint, its mechanic’s objects, and its bow', () => {
  const placed = {};
  let fights = 0;
  let short = 0;
  for (const { spec, layout, encounters } of MECHANIC_LEADS()) {
    const out = { layout, encounters };
    const room = out.encounters.rooms.find((r) => r.roomId === 'lead');
    if (!room) continue;
    const f = room.fight;
    const B = out.layout.boss;
    assert.deepEqual(f.leadUnit.post, { x: B.x - 1, y: B.y - 1 }, 'the footprint’s top-left');
    assert.equal(f.leadUnit.id, 'lead');
    assert.equal(f.stage, spec.stage);
    const mech = bestiary.leadMechanic(spec, { leads, words });
    assert.deepEqual(f.lead, { mechanic: mech.fights, phases: rules.lead.phases[spec.stage], bow: mech.bow, quote: spec.taleLead.line });
    assert.equal(f.leadUnit.lead.mechanic, mech.fights);
    const want = mech.fallback ? [] : mech.entry.objects;
    const props = f.objects.filter((o) => o.kind === 'prop');
    const mechanic = f.objects.filter((o) => o.kind !== 'prop');
    // The window's props come first (o0…), the mechanic's objects numbered after them.
    assert.deepEqual(f.objects.map((o) => o.id), f.objects.map((_, i) => `o${i}`));
    assert.deepEqual(f.objects.slice(0, props.length), props);
    // leads.json's count of each kind, numbered kind by kind in its order; a room too cramped to
    // stand them all without cutting the party's way leaves the last few out, never a whole kind.
    assert.deepEqual(mechanic.map((o) => o.kind), want.flatMap((w) => mechanic.filter((o) => o.kind === w.kind).map(() => w.kind)), 'kind by kind');
    let full = true;
    for (const w of want) {
      const got = mechanic.filter((o) => o.kind === w.kind);
      assert.ok(got.length >= 1 && got.length <= w.count, `${spec.id}: ${got.length} of ${w.count} ${w.kind}`);
      if (got.length < w.count) full = false;
      assert.ok(got.every((o) => o.state === E.OBJECT_START[w.kind] && o.integrity === null));
      placed[w.kind] = (placed[w.kind] || 0) + got.length;
    }
    if (!want.length) assert.deepEqual(mechanic, [], 'a fallback lead’s room has no mechanic objects');
    else fights += 1;
    if (!full) short += 1;
  }
  for (const kind of ['junction', 'lamp', 'candle', 'line', 'lever', 'alibi', 'clue', 'plan-tile']) assert.ok(placed[kind] > 0, `${kind}s are placed`);
  assert.ok(fights > 300, `${fights} lead fights with a mechanic’s objects`);
  // The lead's room stands 1–3 props of its own first (cover for the fight), which leaves the
  // smallest rooms a few tiles fewer: about 3% of fights, where it was about 2% without them.
  assert.ok(short <= fights * 0.05, `every object leads.json names stands in all but the most cramped rooms (${short} of ${fights} short)`);
});

test('every prop inside a fight’s arena is a FightObject with its flags, the lead’s 12×9 window included', () => {
  let props = 0;
  let neighbours = 0;
  for (const { plan, encounters } of PREPARED) {
    for (const room of encounters.rooms) {
      const f = room.fight;
      for (const p of plan.props.filter((q) => inRect(f.arena.rect, q.x, q.y))) {
        const o = f.objects.find((x) => x.kind === 'prop' && x.x === p.x && x.y === p.y);
        assert.ok(o, `${f.id}: the ${p.state} at ${p.x},${p.y} is an object`);
        assert.deepEqual([o.state, o.flags], [p.state, p.flags]);
        props += 1;
        if (f.kind === 'lead' && !inRect(room.rect, p.x, p.y)) neighbours += 1;
      }
    }
  }
  assert.ok(props > 1500 && neighbours > 0, `${props} props, ${neighbours} of them a neighbour’s in a lead’s window`);
});

test('a mechanic’s objects stand where leads.json says: by a wall, on the room’s edge, on its floor, or beside the lead', () => {
  const ok = {};
  const all = {};
  let outside = 0;
  for (const { spec, plan, encounters } of MECHANIC_LEADS()) {
    const room = encounters.rooms.find((r) => r.roomId === 'lead');
    if (!room) continue;
    const mech = bestiary.leadMechanic(spec, { leads, words });
    if (mech.fallback) continue;
    const f = room.fight;
    const r = room.rect;
    const cell = (x, y) => (inRect(f.arena.rect, x, y) ? f.arena.cells[(y - f.arena.rect.y) * f.arena.rect.w + (x - f.arena.rect.x)] : ' ');
    const where = {
      wall: (x, y) => inRect(r, x, y) && [[0, 1], [1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => ['#', ' ', 'O'].includes(cell(x + dx, y + dy))),
      edge: (x, y) => inRect(r, x, y) && (x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1),
      floor: (x, y) => inRect(r, x, y) && !(x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1),
      'lead-side': (x, y) => plan.lead.footprint.some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 2),
    };
    for (const o of f.objects.filter((x) => x.kind !== 'prop')) {
      const w = mech.entry.objects.find((x) => x.kind === o.kind).where;
      assert.ok(inRect(f.arena.rect, o.x, o.y), `${f.id}: ${o.kind} in the arena`);
      if (!inRect(r, o.x, o.y) && w !== 'lead-side') outside += 1;
      all[w] = (all[w] || 0) + 1;
      if (where[w](o.x, o.y)) ok[w] = (ok[w] || 0) + 1;
    }
  }
  // A cramped room's interior runs out before six candles do (its own props stand there first),
  // and the party's way always comes first; everything else finds its place, and only a room
  // with no tile left sends an object out into the rest of the lead's window.
  const total = Object.values(all).reduce((s, v) => s + v, 0);
  assert.deepEqual(Object.keys(all).sort(), ['edge', 'floor', 'wall']);
  for (const w of Object.keys(all)) assert.ok(ok[w] >= all[w] * 0.8, `${w}: ${ok[w]} of ${all[w]} where leads.json says`);
  assert.ok(ok.edge >= all.edge * 0.95, `edge: ${ok.edge} of ${all.edge}`);
  assert.ok(outside <= total * 0.02, `${outside} of ${total} objects outside the lead’s room`);
});

test('inside every arena the way stays clear: no object cuts the party off, the lead and every object keep a side they reach, and every foe stands where they walk', () => {
  const seen = { lead: 0, room: 0, cave: 0, mimic: 0, objects: 0, foes: 0, kinds: new Set() };
  const leadRooms = new Set();
  for (const { spec, plan, encounters } of [...PREPARED, ...MECHANIC_LEADS()]) {
    for (const room of encounters.rooms) {
      const f = room.fight;
      if (f.kind === 'lead' && leadRooms.has(f.id)) continue;
      if (f.kind === 'lead') leadRooms.add(f.id);
      const got = assertWayClear(f, f.kind === 'lead' ? plan.lead.footprint : [], spec.id);
      seen[f.kind] += 1;
      seen.objects += got.objects;
      seen.foes += got.foes;
      for (const o of f.objects) if (o.kind !== 'prop') seen.kinds.add(o.kind);
    }
  }
  const regions = [...Object.keys(foes.caves), 'painted-hills', 'ivory-college', 'hearthvale', 'far-shore'];
  for (let i = 0; i < 200; i += 1) {
    const cave = caveOf(i * 11 - 900, i * 5 - 700, { region: regions[i % regions.length], tier: 1 + (i % 8), depth: 1 + (i % 6) });
    const out = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel: 3, partySize: 1 + (i % 4), rules, foes, words, day: 1 });
    for (const room of out.encounters.rooms) { seen.foes += assertWayClear(room.fight, [], cave.id).foes; seen.cave += 1; }
    const mimic = out.encounters.chests.find((c) => c.mimic).mimic.fight;
    assertWayClear(mimic, [], cave.id);
    seen.mimic += 1;
  }
  assert.ok(seen.lead > 400 && seen.room > 1000 && seen.cave > 300 && seen.mimic === 200, JSON.stringify({ ...seen, kinds: [...seen.kinds] }));
  assert.ok(seen.objects > 1200 && seen.foes > 4000, `${seen.objects} mechanic objects, ${seen.foes} foes`);
  assert.deepEqual([...seen.kinds].sort(), ['alibi', 'candle', 'clue', 'junction', 'lamp', 'lever', 'line', 'plan-tile']);
});

test('what a hero walks onto is B’s grid’s rule (§18.2 item 13): D reads grid.WALKABLE_OBJECTS and keeps no list of its own', async () => {
  const grid = await import('../src/combat/grid.js');
  // Every kind D places (props, leads.json's objects, the bow objects, a chest) and B's closed list.
  const kinds = new Set(['prop', 'snare', 'patch-kit', ...Object.keys(E.OBJECT_START), ...Object.values(E.BOW_OBJECTS).flat(),
    ...leads.mechanics.flatMap((m) => (m.objects || []).map((o) => o.kind))]);
  if (D.mode === 'real') for (const kind of (await import('../src/combat/effects.js')).OBJECT_KINDS) kinds.add(kind);
  // B's grid moves (createGrid, one object on one open tile), B's exported list and D agree.
  assert.ok(grid.WALKABLE_OBJECTS?.has, 'B’s grid.js exports WALKABLE_OBJECTS');
  for (const kind of kinds) {
    assert.equal(E.walksOnto(kind), walksOn(kind), `${kind}: D and B’s grid agree`);
    assert.equal(E.walksOnto(kind), grid.WALKABLE_OBJECTS.has(kind), `${kind}: as grid.WALKABLE_OBJECTS says`);
  }
  assert.deepEqual(['clue', 'plan-tile', 'forge', 'lectern', 'bell', 'riddle-board', 'candle', 'prop'].map((k) => E.walksOnto(k)), [true, true, false, false, false, false, false, false]);
  // One owner: encounters.js imports B's list and spells out none of its own.
  const source = readFileSync(new URL('../src/combat/encounters.js', import.meta.url), 'utf8');
  assert.match(source, /^import \{ WALKABLE_OBJECTS \} from '\.\/grid\.js';$/m);
  assert.doesNotMatch(source, /\[\s*'clue'\s*,\s*'plan-tile'/);
  assert.doesNotMatch(source, /'plan-tile'\s*,\s*'snare'/);
});

test('no room’s foes stand inside another fight’s arena: a neighbour’s room, the lead’s 12×9 window, or a Mimic’s', () => {
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  let windows = 0;
  let foesChecked = 0;
  const apart = (fights, where) => {
    for (const a of fights) for (const b of fights) {
      if (a === b) continue;
      for (const u of b.foes) for (const t of tilesOf(u)) {
        assert.ok(!inRect(a.arena.rect, t.x, t.y), `${where}: ${b.room}’s ${u.id} at ${t.x},${t.y} stands inside ${a.room}’s arena`);
        foesChecked += 1;
      }
    }
  };
  for (const { spec, plan, encounters } of PREPARED) {
    apart(encounters.rooms.map((r) => r.fight), spec.id);
    // The lead's window takes in a neighbouring fight room's floor.
    if (encounters.leadRoom && plan.rooms.some((r) => r.fight && r.roomId !== 'lead' && overlap(plan.lead.arena.rect, r.rect))) windows += 1;
  }
  let caves = 0;
  let shared = 0;
  const regions = [...Object.keys(foes.caves), 'far-shore'];
  for (let i = 0; i < 200; i += 1) {
    const cave = caveOf(i * 7 - 300, 20 - i * 3, { region: regions[i % regions.length], tier: 1 + (i % 8), depth: 1 + (i % 12) });
    const out = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel: 3, partySize: 1 + (i % 4), rules, foes, words, day: 5 });
    const fights = out.encounters.rooms.map((r) => r.fight);
    apart(fights, cave.id);
    // A Mimic fights in its chest room's arena, so its chest is one whose arena no room's foes
    // stand in, wherever the cave has one.
    const mimic = out.encounters.chests.find((c) => c.mimic).mimic.fight;
    if (fights.some((f) => f.foes.some((u) => tilesOf(u).some((t) => inRect(mimic.arena.rect, t.x, t.y))))) shared += 1;
    caves += 1;
  }
  assert.ok(windows >= 5 && foesChecked > 10000, `${windows} lead windows take in a neighbouring fight room; ${foesChecked} foe tiles checked`);
  assert.ok(shared <= caves * 0.02, `${shared} of ${caves} Mimics share their arena with a room’s foes (only where every chest’s room is a fight room)`);
});

test('the party starts on the side it came from, and foes wait on the far side', () => {
  let arenas = 0;
  let rooms = 0;
  let far = 0;
  let spread = 0;
  for (const { plan, scene, encounters } of PREPARED) {
    // The fight-ready walk from the door (a bush outside the arenas never cuts anything off).
    const bushes = new Set(scene.objects.filter((o) => o.kind === 'foliage' && o.blocks).map((o) => keyOf(o.x, o.y)));
    const door = plan.layout.entrance;
    const dist = new Map([[keyOf(door.x, door.y), 0]]);
    const queue = [door];
    for (let head = 0; head < queue.length; head += 1) {
      const { x, y } = queue[head];
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const k = keyOf(x + dx, y + dy);
        if (dist.has(k) || !(scene.walkable(x + dx, y + dy) || bushes.has(k))) continue;
        dist.set(k, dist.get(keyOf(x, y)) + 1);
        queue.push({ x: x + dx, y: y + dy });
      }
    }
    for (const room of plan.rooms.filter((r) => r.fight && r.arena?.mouths.length)) {
      const { entry, mouths } = room.arena;
      const nearest = Math.min(...mouths.map((m) => dist.get(keyOf(m.x, m.y)) ?? Infinity));
      const first = dist.get(keyOf(entry[0].x, entry[0].y));
      assert.ok(first !== undefined && first <= nearest + 1, `${room.roomId}: Milo starts at the mouth nearest the door (${first} steps, the mouth ${nearest})`);
      arenas += 1;
    }
    for (const room of encounters.rooms.filter((r) => r.fight.kind === 'room')) {
      const f = room.fight;
      const units = fighting(f.foes);
      if (!units.length) continue;
      const ex = f.arena.entry.reduce((s, t) => s + t.x, 0) / 4;
      const ey = f.arena.entry.reduce((s, t) => s + t.y, 0) / 4;
      const tiles = [];
      for (let y = room.rect.y; y < room.rect.y + room.rect.h; y += 1) for (let x = room.rect.x; x < room.rect.x + room.rect.w; x += 1) if (scene.walkable(x, y)) tiles.push(Math.hypot(x - ex, y - ey));
      const mean = tiles.reduce((s, d) => s + d, 0) / tiles.length;
      const posts = units.reduce((s, u) => s + Math.hypot(u.post.x - ex, u.post.y - ey), 0) / units.length;
      rooms += 1;
      if (posts >= mean) far += 1;
      spread += posts - mean;
    }
  }
  assert.ok(arenas > 1500, `${arenas} arenas`);
  assert.ok(far >= rooms * 0.95 && spread / rooms > 1, `foes stand further from the party than the room’s average tile (${far} of ${rooms}, by ${(spread / rooms).toFixed(2)} tiles)`);
});

test('surface affixes lay their surface on 15% of a fight room’s free floor', () => {
  assert.equal(rules.budgets.surfaceShare, 0.15);
  let rooms = 0;
  for (const { spec, plan, scene, encounters } of PREPARED) {
    const affixes = E.FIGHT_AFFIXES.filter((id) => E.AFFIX_SURFACES[id] && spec.affixes.some((a) => a.id === id));
    if (!affixes.length) continue;
    for (const room of encounters.rooms) {
      const f = room.fight;
      const { rect } = f.arena;
      const natural = (x, y) => ['water', 'foliage'].includes(scene.cellAt(x, y));
      const busy = new Set([
        ...[...f.foes, ...(f.leadUnit ? [f.leadUnit] : [])].flatMap((u) => { const t = []; for (let dy = 0; dy < u.size; dy += 1) for (let dx = 0; dx < u.size; dx += 1) t.push(keyOf(u.post.x + dx, u.post.y + dy)); return t; }),
        ...f.objects.map((o) => keyOf(o.x, o.y)),
        ...(f.kind === 'lead' ? plan.lead.footprint.map((t) => keyOf(t.x, t.y)) : []),
      ]);
      const laidBefore = new Set();
      for (const affix of affixes) {
        const id = E.AFFIX_SURFACES[affix];
        const free = [];
        for (let y = room.rect.y; y < room.rect.y + room.rect.h; y += 1) for (let x = room.rect.x; x < room.rect.x + room.rect.w; x += 1) {
          const c = f.arena.cells[(y - rect.y) * rect.w + (x - rect.x)];
          if (c === '.' && !natural(x, y) && !busy.has(keyOf(x, y)) && !laidBefore.has(keyOf(x, y))) free.push(keyOf(x, y));
        }
        const laid = f.surfaces.filter((s) => s.id === id && inRect(room.rect, s.x, s.y) && !natural(s.x, s.y)).map((s) => keyOf(s.x, s.y));
        assert.equal(laid.length, Math.round(free.length * 0.15), `${f.id}: ${affix} lays ${id} on 15% of ${free.length} tiles`);
        for (const k of laid) { assert.ok(free.includes(k)); laidBefore.add(k); }
        rooms += 1;
      }
    }
  }
  assert.ok(rooms > 100, `${rooms} rooms with a surface affix`);
});

test('rewards follow §4.13: weight × the XP table, 4 × weight × n in Marks, essences, relics and tonics from the loot seed', () => {
  let essences = 0;
  let relics = 0;
  let tonics = 0;
  let rooms = 0;
  for (const { encounters } of PREPARED) {
    for (const room of encounters.rooms) {
      const f = room.fight;
      const r = f.rewards;
      rooms += 1;
      const table = rules.road.perWeight;
      const perWeight = f.level <= 12 ? table[f.level - 1] : table[11] + 60 * (f.level - 12);
      assert.equal(r.weight, f.weight);
      assert.equal(r.n, f.level);
      assert.equal(r.xp, f.weight * perWeight + 45 * f.weight * f.deepRank, 'Road XP, unrounded');
      assert.equal(r.marks, 4 * f.weight * f.level, 'Marks, unrounded');
      assert.deepEqual(r, rewardsFor({ ...f, rewards: undefined }, { rules, words }), 'seeded');
      if (f.real) assert.ok(!r.essences.length && !r.relic, 'a real rift pays its essences only from its stitch');
      if (f.kind === 'lead' && !f.real) {
        assert.equal(r.essences.length, 1);
        assert.ok(r.essences[0].qty >= 2 && r.essences[0].qty <= 4, '2–4 from a Tale-lead');
      }
      for (const e of r.essences) assert.ok(words.genres[e.genre].essences.includes(e.name));
      if (r.relic) {
        relics += 1;
        const bank = words.genres[r.relic.genre];
        assert.ok(bank.relics.some((x) => r.relic.name.includes(` ${x} of `)), r.relic.name);
      }
      if (f.kind === 'room') essences += r.essences.length;
      tonics += r.tonics.cordial + r.tonics.brew;
    }
  }
  const strayRooms = rooms - SWEEP.length * 0.8;
  assert.ok(essences > strayRooms * 0.15 && essences < rooms * 0.45, `about 30% of stray rooms give an essence (${essences})`);
  assert.ok(relics > rooms * 0.1 && relics < rooms * 0.35, `a relic about 20% of the time (${relics} of ${rooms})`);
  assert.ok(tonics > rooms * 0.15 && tonics < rooms * 0.35, `a tonic about 25% of the time (${tonics} of ${rooms})`);
  assert.equal(realLine('The Habitack checks are still red.'), 'Settle me all you like. The Habitack checks are still red.');
  assertCalm(realLine('The Habitack checks are still red.'), 'realLine', { proper: ['Habitack'] });
  assert.equal(realLine(''), 'Settle me all you like.');
});

test('each deep rank adds 10% to every loot chance: essences 30%, relics 20% and tonics 25% at rank 0, half as much again at rank 5', () => {
  const rate = (deepRank, pick) => {
    let hits = 0;
    const N = 6000;
    for (let i = 0; i < N; i += 1) {
      const fight = { seed: hashInts(i, deepRank, 'deep-loot'), weight: 4, level: 11, deepRank, lead: null, leadUnit: null, genres: ['neon'], real: null };
      hits += pick(rewardsFor(fight, { rules, words }));
    }
    return hits / N;
  };
  const near = (got, want, what) => assert.ok(Math.abs(got - want) < 0.025, `${what}: ${got.toFixed(3)}, want ${want}`);
  for (const [deepRank, boost] of [[0, 1], [5, 1.5]]) {
    near(rate(deepRank, (r) => r.essences.length), 0.3 * boost, `essences at deep rank ${deepRank}`);
    near(rate(deepRank, (r) => (r.relic ? 1 : 0)), 0.2 * boost, `relics at deep rank ${deepRank}`);
    near(rate(deepRank, (r) => r.tonics.cordial + r.tonics.brew), 0.25 * boost, `tonics at deep rank ${deepRank}`);
  }
  // At rank 30 a tonic (25% × 4) and an essence (30% × 4) are certain, and stop there.
  assert.equal(rate(30, (r) => r.tonics.cordial + r.tonics.brew), 1);
  assert.equal(rate(30, (r) => r.essences.length), 1);
});

test('fight ids name the episode: wild rifts by id, real rifts by their episode, caves by the day', () => {
  const spec = SWEEP[0].spec;
  assert.equal(fightIdFor(spec, 'wild', 'r3'), `fight:${spec.id}:w:r3`);
  assert.equal(fightIdFor(spec, 'real', 'lead', { since: 36 * 36 }), `fight:${spec.id}:100:lead`);
  assert.equal(fightIdFor(spec, 'story', 'r0', { since: null }), `fight:${spec.id}:0:r0`);
  assert.equal(fightIdFor(caveOf(-12, 40), 'cave', 'r2', { day: 20480 }), 'fight:cave:-12,40:20480:r2');
  for (const id of [fightIdFor(spec, 'wild', 'lead'), fightIdFor(caveOf(-120, -300), 'cave', 'mimic', { day: 20480 })]) assert.match(id, FIGHT_ID);
});

test('a cave’s fights need the day: called as §7.7 writes it, with no day, prepareCave refuses rather than pay once ever', () => {
  const cave = caveOf(10, -4, { region: 'cinderforge', tier: 2, depth: 2 });
  const layout = riftgen.layout(cave);
  const contract = { layout, roadLevel: 2, partySize: 4, rules, foes, words };
  for (const day of [undefined, null, -1, 1.5, '20480', Number.NaN]) {
    assert.throws(() => prepareCave(cave, { ...contract, day }), /day number/, `day ${String(day)} is refused`);
    assert.throws(() => fightIdFor(cave, 'cave', 'r2', { day }), /day number/);
  }
  assert.throws(() => prepareCave(cave, contract), /day number/, 'no day at all');
  const scene = elsewhere.buildElsewhere(cave, layout, { kind: 'cave', words });
  assert.throws(() => planEncounters(cave, { rooms: [], props: [], layout, nook: null, lead: null, chests: [] }, scene, { kind: 'cave', rules, foes, words }), /day number/);
  // Each real day is its own episode, so a cave pays once a day; the day may ride on the cave.
  const ids = (out) => [...out.encounters.rooms.map((r) => r.fightId), out.encounters.chests.find((c) => c.mimic).mimic.fight.id];
  const monday = ids(prepareCave(cave, { ...contract, day: 20480 }));
  const tuesday = ids(prepareCave(cave, { ...contract, day: 20481 }));
  assert.ok(monday.length >= 2 && monday.every((id) => id.includes(':20480:')) && tuesday.every((id) => id.includes(':20481:')));
  assert.ok(!monday.some((id) => tuesday.includes(id)), 'no fight id repeats from one day to the next');
  assert.deepEqual(ids(prepareCave({ ...cave, day: 20480 }, contract)), monday, '`cave.day` serves when the option is left out');
});

test('caves: deterministic, filled from the region’s list, with exactly one Mimic chest and one locked chest', () => {
  const regions = Object.keys(foes.caves);
  let mimics = 0;
  for (let i = 0; i < 120; i += 1) {
    const region = [...regions, 'painted-hills', 'ivory-college', 'hearthvale', 'far-shore'][i % 12];
    const tier = 1 + (i % 8);
    const cave = caveOf(i * 7 - 300, i * 13 - 500, { region, tier, depth: 1 + (i % 10) });
    const layout = riftgen.layout(cave);
    const opts = { layout, roadLevel: 4, partySize: 1 + (i % 4), rules, foes, words, day: 20480 };
    const a = prepareCave(cave, opts);
    const b = prepareCave(cave, opts);
    assert.deepEqual(a.encounters, b.encounters, 'deterministic');
    const { chests, rooms } = a.encounters;
    assert.equal(chests.filter((c) => c.mimic).length, 1, `${cave.id}: one Mimic`);
    assert.equal(chests.filter((c) => c.locked).length, 1, `${cave.id}: one locked chest`);
    assert.ok(!chests.some((c) => c.locked && c.mimic), 'two different chests');
    // The chests the cave adds are the arena pass's plan.chests, numbered after the layout's own.
    assert.deepEqual(chests.slice(layout.loot.length).map((c) => [c.id, c.x, c.y]), a.plan.chests.map((t, k) => [`loot:${layout.loot.length + k}`, t.x, t.y]));
    // Every chest is cover in every arena it's in, never a start tile, never a post.
    for (const c of chests) {
      for (const room of a.plan.rooms.filter((r) => r.arena && inRect(r.arena.rect, c.x, c.y))) {
        const { rect } = room.arena;
        assert.equal(room.arena.cells[(c.y - rect.y) * rect.w + (c.x - rect.x)], 'o', `${cave.id}: ${c.id} is cover in ${room.roomId}’s arena`);
        assert.ok(!room.arena.entry.some((t) => t.x === c.x && t.y === c.y), `${cave.id}: ${c.id} isn’t a start tile`);
      }
      for (const room of rooms) assert.ok(!room.fight.foes.some((u) => u.post.x === c.x && u.post.y === c.y), `${cave.id}: nobody stands on ${c.id}`);
    }
    const list = new Set(caveList(region, foes).map((f) => f.id));
    assert.ok(list.size > 0);
    const want = { hairline: 2, open: 3 }[cave.stage];
    assert.ok(rooms.length <= want && rooms.length >= want - 1, `${cave.id}: ${rooms.length} fight rooms`);
    for (const room of rooms) {
      const f = room.fight;
      assert.equal(f.kind, 'cave');
      assert.deepEqual(f.genres, []);
      assert.equal(f.stage, null);
      assert.equal(f.id, `fight:${cave.id}:20480:${room.roomId}`);
      assert.equal(f.seed, hashInts(cave.seed >>> 0, room.roomId, 'fight'));
      for (const u of f.foes) assert.ok(list.has(u.talkKind), `${u.talkKind} is from ${region}’s list`);
      assert.deepEqual(f.rewards.essences, [], 'a cave has no genre to give');
    }
    checkCaveBudgets(cave, a, opts.partySize);
    const chest = chests.find((c) => c.mimic);
    const mf = chest.mimic.fight;
    mimics += 1;
    assert.equal(mf.id, `fight:${cave.id}:20480:mimic`);
    const at = roomLevel(cave, { kind: 'cave', roadLevel: 4, rules });
    assert.deepEqual([mf.level, mf.deepRank], [at.n, at.deepRank], 'the Mimic fights at the cave’s level and deep rank');
    for (const room of rooms) assert.deepEqual([room.fight.level, room.fight.deepRank], [at.n, at.deepRank]);
    assert.equal(mf.foes.length, 1);
    assert.equal(mf.foes[0].kind, 'mimic');
    assert.deepEqual(mf.foes[0].post, { x: chest.x, y: chest.y }, 'the Mimic is the chest');
    assert.equal(mf.arena.entry.length, 4);
    for (const t of mf.arena.entry) assert.ok(Math.max(Math.abs(t.x - chest.x), Math.abs(t.y - chest.y)) <= 3, 'the party is beside it');
    // The final scene carries the chests' flags.
    const scene = elsewhere.buildElsewhere(cave, a.layout, { kind: 'cave', words, fight: { plan: a.plan, encounters: a.encounters } });
    for (const c of chests) {
      const o = scene.objects.find((x) => x.id === c.id);
      assert.ok(o && o.kind === 'loot', `${c.id} is in the scene`);
      assert.deepEqual([o.x, o.y, o.locked, Boolean(o.mimic)], [c.x, c.y, c.locked, Boolean(c.mimic)]);
    }
    assert.ok(!scene.objects.some((o) => o.kind === 'stitch' || o.kind === 'tale-lead' || o.kind === 'nook'), 'no seam, no lead, no nook');
    for (const o of scene.objects.filter((x) => x.label)) assertCalm(o.label, `${cave.id}: ${o.id}’s label`);
    assert.equal(scene.objects.find((o) => o.locked).label, 'A locked chest');
  }
  assert.equal(mimics, 120);
});

// A cave's rooms are ordinary rooms, Low to Moderate (COMBAT §9): its far room has no lead, so it
// runs Moderate at every stage, and the rest at the stage's mix.
function checkCaveBudgets(cave, out, partySize) {
  const { n } = roomLevel(cave, { kind: 'cave', roadLevel: 4, rules });
  for (const room of out.encounters.rooms) {
    const f = room.fight;
    const far = out.plan.rooms.find((r) => r.roomId === room.roomId).role === 'lead';
    const role = far ? 'moderate' : (cave.stage === 'hairline' ? 'low' : 'moderate');
    assert.equal(E.CAVE_FAR_ROOM, 'moderate');
    assert.ok(f.budget <= budgetFor('moderate', partySize, cave.depth, rules), `${f.id}: never past Moderate`);
    assert.equal(f.budget, budgetFor(role, partySize, cave.depth, rules), `${f.id}: ${role}`);
    const spent = f.foes.reduce((s, u) => s + costOf(u, n), 0);
    assert.ok(spent <= f.budget || (f.foes.length === 1 && f.foes[0].rank === 'lackey'), `${f.id}: ${spent} of ${f.budget}`);
    assert.ok(f.foes.length <= 8 && new Set(f.foes.map((u) => u.talkKind)).size <= 3);
  }
}

test('a deep cave’s rooms and its Mimic fight at the cave’s deep rank: more Integrity, a harder hit, more loot', () => {
  const { strayRow, integrityFactor } = D.rulesApi;
  const seenRanks = new Set();
  for (let i = 0; i < 24; i += 1) {
    const depth = 8 + 3 * (1 + (i % 4)) + (i % 3);
    const cave = caveOf(i * 17 - 400, i * 3 + 90, { region: Object.keys(foes.caves)[i % 8], tier: 8, depth });
    const partySize = 1 + (i % 4);
    const out = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel: 4, partySize, rules, foes, words, day: 3 });
    const { n, deepRank } = roomLevel(cave, { kind: 'cave', roadLevel: 4, rules });
    assert.equal(deepRank, Math.floor((depth - 8) / 3));
    seenRanks.add(deepRank);
    const mf = out.encounters.chests.find((c) => c.mimic).mimic.fight;
    assert.equal(mf.deepRank, deepRank, `${cave.id}: the Mimic at deep rank ${deepRank}`);
    const mimic = mf.foes[0];
    const want = Math.round(Math.round(strayRow(rules, 'integrity', n) * rules.archetypes.construct.integrity) * (1 + 0.1 * deepRank) * integrityFactor(rules, n, partySize));
    assert.equal(mimic.maxIntegrity, want, `${cave.id}: the Mimic’s Integrity with its deep rank`);
    assert.equal(mimic.strike.amount + mimic.flat, 1, 'its bite still tickles');
    assert.equal(mf.rewards.deepRank, deepRank);
    assert.equal(mf.rewards.xp, mf.weight * rules.road.perWeight[n - 1] + 45 * mf.weight * deepRank);
    for (const room of out.encounters.rooms) {
      assert.equal(room.fight.deepRank, deepRank);
      for (const u of room.fight.foes) {
        const bite = Number.isFinite(foes.creatures.find((c) => c.id === u.talkKind)?.bite);
        if (!bite) assert.equal(u.flat, (u.rank === 'elite' ? 2 : 0) + deepRank, `${room.fightId}: ${u.id} hits +1 a deep rank`);
      }
    }
  }
  assert.deepEqual([...seenRanks].sort(), [1, 2, 3, 4]);
});

test('a fetchfox’s pinch comes back in its room’s loot only when it took one: what `take` really removed, read from the fight’s events', () => {
  const PINCH = 'fetchfox-pinch';
  let rooms = 0;
  let foxRooms = 0;
  let foxes = 0;
  let tonics = 0;
  let sample = null;
  for (let i = 0; i < 40; i += 1) {
    const cave = caveOf(i * 9 - 200, i * 7 - 100, { region: 'whisperwood', tier: 1 + (i % 8), depth: 1 + (i % 5) });
    const out = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel: 4, partySize: 1 + (i % 4), rules, foes, words, day: 5 });
    for (const room of out.encounters.rooms) {
      const f = room.fight;
      const n = f.foes.filter((u) => u.abilityIds.includes(PINCH)).length;
      const bare = { ...f, rewards: undefined };
      // Built before the fight, a room's Rewards hold no pinched tonic: a fox mints nothing.
      assert.deepEqual(f.rewards, rewardsFor({ ...bare, foes: f.foes.filter((u) => !u.abilityIds.includes(PINCH)) }, { rules, words }), `${f.id}: its ${n} foxes add nothing`);
      // What the payer says was taken comes back: whole ones, never more than one a fox, and never
      // a brew no fox could take. The rest of the loot doesn't move.
      for (const taken of [null, {}, { cordial: 1 }, { cordial: 2, brew: 1 }, { cordial: n + 5 }, { cordial: -3 }, { cordial: 'lots' }, { cordial: 1.7 }]) {
        const r = rewardsFor(bare, { rules, words, taken });
        const back = Math.max(0, Math.min(n, Math.floor(Number(taken?.cordial) || 0)));
        assert.deepEqual(r.tonics, { cordial: f.rewards.tonics.cordial + back, brew: f.rewards.tonics.brew }, `${f.id}: ${JSON.stringify(taken)} with ${n} foxes`);
        assert.deepEqual({ ...r, tonics: null }, { ...f.rewards, tonics: null }, 'the rest of the loot is the room’s own');
      }
      rooms += 1;
      tonics += f.rewards.tonics.cordial + f.rewards.tonics.brew;
      if (n) { foxRooms += 1; foxes += n; sample = sample || f.foes.find((u) => u.abilityIds.includes(PINCH)); }
    }
  }
  assert.ok(foxRooms > 20 && foxes > foxRooms, `${foxes} foxes in ${foxRooms} rooms`);
  assert.ok(tonics < rooms * 0.4, `a tonic about 25% of the time, foxes or not (${tonics} in ${rooms} rooms)`);

  // B's structured take events (§18.2 item 4): one per tonic that left the bag. A pinch at an
  // empty bag emits none. The Log's words never count, whatever they say.
  const act = (unit, ability) => ({ t: 'act', round: 1, tick: 1, unit, action: { id: ability ? 'use' : 'strike', ability, cost: 1, target: { unit: 'milo' } }, words: '' });
  const take = (unit, item = 'cordial') => ({ t: 'take', round: 1, tick: 1, unit, from: 'milo', item });
  const line = { t: 'line', round: 1, tick: 1, text: 'Fetchfox pinches a tonic.' };
  assert.deepEqual(E.tonicsTaken([act('f0', PINCH), take('f0'), act('f1', PINCH), act('milo', null)]), { cordial: 1, brew: 0 }, 'the second fox found the bag empty: no take');
  assert.deepEqual(E.tonicsTaken([act('f0', PINCH), line, act('f1', PINCH), line]), { cordial: 0, brew: 0 }, 'the Log’s words never count');
  assert.deepEqual(E.tonicsTaken([take('f0'), take('f1'), take('f2', 'brew')]), { cordial: 2, brew: 1 }, 'one for each take');
  assert.deepEqual(E.tonicsTaken([{ kind: 'take', unit: 'f0', from: 'milo', item: 'cordial' }]), { cordial: 1, brew: 0 }, '§18.2’s spelling of the event');
  assert.deepEqual(E.tonicsTaken([take('f0', 'essence'), take('f0', 'margin'), { t: 'damage', kind: 'plain', item: 'cordial' }]), { cordial: 0, brew: 0 }, 'only tonics, only takes');
  assert.deepEqual(E.tonicsTaken([take('f0'), take('x9')], { foes: [{ id: 'f0' }] }), { cordial: 1, brew: 0 }, 'given the fight, only its own foes’ takes');
  assert.deepEqual(E.tonicsTaken(null), { cordial: 0, brew: 0 });
  // Every ability that takes is in PINCHES with its item, pinches once a fight, and settles the
  // fox as it takes (settle: true, §18.2 item 4).
  const takers = foes.abilities.filter((a) => a.effects.some((e) => e.do === 'take'));
  assert.deepEqual(Object.keys(E.PINCHES), takers.map((a) => a.id));
  for (const a of takers) {
    assert.equal(E.PINCHES[a.id], a.effects.find((e) => e.do === 'take').item);
    assert.equal(a.effects.find((e) => e.do === 'take').settle, true, `${a.id} settles the taker`);
    assert.deepEqual(a.uses, { per: 'fight', n: 1 });
  }
});

test('through B’s kernel a fetchfox’s pinch is a take event, the fox settles, and only what left the bag comes back', async (t) => {
  if (D.mode !== 'real') { t.diagnostic('stub mode: B’s kernel isn’t loaded, so the live pinch is left to the real run'); return; }
  const PINCH = 'fetchfox-pinch';
  const [{ createBattle }, { runToEnd, stubMinds }, { buildAbilityIndex }] = await Promise.all([
    import('../src/combat/battle.js'), import('../src/combat/driver.js'), import('../src/combat/abilities.js'),
  ]);
  const sample = bestiary.foeUnit(foes.creatures.find((f) => f.id === 'fetchfoxes'), 3, { rules, foes, roadLevel: 3 });
  const W = 7;
  const arena = { rect: { x: 0, y: 0, w: W, h: W }, cells: '.'.repeat(W * W), height: '0'.repeat(W * W), light: 'L'.repeat(W * W), mouths: [], entry: [{ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 4 }], seed: 1 };
  const fight = { id: 'fight:cave:1,1:5:r1', room: 'r1', kind: 'cave', seed: 7, level: sample.level, deepRank: 0, budget: 40, weight: 2, stage: null, genres: [], affixes: [], arena,
    foes: [{ ...sample, id: 'f0', post: { x: 3, y: 3 } }, { ...sample, id: 'f1', post: { x: 1, y: 3 } }], leadUnit: null, objects: [], surfaces: [], lead: null, sight: 6, surprised: null, real: null };
  const base = rewardsFor(fight, { rules, words });
  // Stand-in heroes that only Brace, so each fox always gets its turn.
  const hero = (id, carry) => ({ ...JSON.parse(JSON.stringify(sample)), id, side: 'party', kind: 'milo', talkKind: null, rank: 'hero', size: 1, control: 'auto', post: null, lead: null, adapt: 0, maxIntegrity: 60, integrity: 60, abilityIds: [], carry, look: { kind: 'rig', rig: 'coat', who: id, likeness: null } });
  const brace = { id: 'brace', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null };
  // A bag of 2 feeds both foxes; a bag of 1 only the first; an empty bag neither.
  for (const [cordials, want] of [[2, 2], [1, 1], [0, 0]]) {
    const ctx = { rules, abilities: buildAbilityIndex({ foes }), mechanics: {}, bows: null, genres: genres.genres.map((g) => g.id), party: {} };
    ctx.minds = stubMinds(ctx, {
      foePlan: (b, unitId) => ((b.units.find((v) => v.id === unitId).uses?.[PINCH] ?? 1) > 0
        ? { unitId, slots: [{ ...brace, id: 'use', ability: PINCH, target: { unit: 'milo' } }], reactions: {}, by: 'foe', changed: [] } : null),
      draft: (b, unitId) => ({ unitId, plan: { unitId, slots: [brace], reactions: {}, by: 'draft', changed: [false] }, confidence: 35, source: 'personality', why: [], choices: [] }),
    });
    const battle = createBattle(fight, [hero('milo', { cordial: cordials }), hero('claude', {}), hero('codex', {})], { roadLevel: 3 }, ctx);
    const r = runToEnd(battle, ctx, { maxRounds: 3 });
    const takes = r.events.filter((e) => e.t === 'take' || e.kind === 'take');
    assert.equal(takes.length, want, `a bag of ${cordials}: B emits one take event per tonic taken (§18.2 item 4)`);
    for (const e of takes) assert.deepEqual([e.from, e.item, ['f0', 'f1'].includes(e.unit)], ['milo', 'cordial', true], JSON.stringify(e));
    const taken = E.tonicsTaken(r.events, fight);
    assert.deepEqual(taken, { cordial: want, brew: 0 }, `a bag of ${cordials}`);
    assert.equal(r.battle.units.find((u) => u.id === 'milo').carry.cordial, cordials - want, 'what comes back is what left the bag');
    assert.equal(rewardsFor(fight, { rules, words, taken }).tonics.cordial, base.tonics.cordial + want);
    // A fox that pinched runs home: sorted the moment it takes (settle: true).
    for (const e of takes) {
      assert.ok(r.battle.units.find((u) => u.id === e.unit).sorted, `${e.unit} settles once it has pinched`);
      assert.ok(r.events.some((s) => s.t === 'sorted' && s.unit === e.unit), `${e.unit}: a sorted event`);
    }
    // When both foxes ran home, the room is done and pays (§5.9), their cordials back in its loot.
    if (want === fight.foes.length) assert.equal(r.events.find((e) => e.t === 'end')?.result?.outcome, 'won');
  }
});

test('a cave room holding a canon foe stands what its bow works with, where the party can reach it: a forge, a lectern, a bell, a riddle board', () => {
  // §9.8's bows: every foes.json canon foe whose bow needs an object has it in BOW_OBJECTS.
  const needs = { forge: ['forge'], read: ['lectern'], bell: ['bell', 'lectern'], riddle: ['riddle-board'], 'talk-down': [], walk: [] };
  for (const c of foes.canon) assert.deepEqual([...(E.BOW_OBJECTS[c.bow.kind] || [])], needs[c.bow.kind], `${c.id}’s ${c.bow.kind} bow`);
  // foes.json's own lists (the cinder golems at Cinderforge and the Far Shore, the Unwritten in
  // the Archive Peaks), and lists that bring the Tollmen and the drowned bell-ringers in too.
  const more = { ...foes, caves: { ...foes.caves, greyreach: ['tollmen', 'drowned-bell-ringers', 'hush-hounds'], 'dicing-downs': ['cinder-golems', 'unwritten', 'drowned-bell-ringers'] } };
  const seen = {};
  let rooms = 0;
  let plain = 0;
  for (const [set, regions] of [[foes, ['cinderforge', 'far-shore', 'archive-peaks']], [more, ['greyreach', 'dicing-downs']]]) {
    for (let i = 0; i < 60; i += 1) {
      const cave = caveOf(i * 23 - 700, i * 11 - 90, { region: regions[i % regions.length], tier: 1 + (i % 8), depth: 1 + (i % 9) });
      const out = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel: 3, partySize: 1 + (i % 4), rules, foes: set, words, day: 9 });
      for (const room of out.encounters.rooms) {
        const f = room.fight;
        const want = new Set(f.foes.flatMap((u) => E.BOW_OBJECTS[set.canon.find((c) => c.id === u.talkKind)?.bow?.kind] || []));
        const props = f.objects.filter((o) => o.kind === 'prop');
        const bow = f.objects.filter((o) => o.kind !== 'prop');
        assert.deepEqual(bow.map((o) => o.kind).sort(), [...want].sort(), `${f.id}: one of each object its foes’ bows work with, and nothing else`);
        assert.deepEqual(f.objects.map((o) => o.id), f.objects.map((_, k) => `o${k}`), 'props first, then the bow’s objects');
        assert.deepEqual(f.objects.slice(0, props.length), props);
        for (const o of bow) {
          assert.deepEqual([o.state, o.flags, o.integrity], [E.OBJECT_START[o.kind], [], null], `${f.id}: the ${o.kind} starts ${E.OBJECT_START[o.kind]}`);
          assert.ok(inRect(f.arena.rect, o.x, o.y));
          assert.ok(!f.foes.some((u) => tilesOf(u).some((t) => t.x === o.x && t.y === o.y)), 'nobody stands on it');
          assert.ok(!f.arena.entry.some((t) => t.x === o.x && t.y === o.y), 'never on a start tile');
          seen[o.kind] = (seen[o.kind] || 0) + 1;
        }
        // Nothing cut off, and the forge, lectern, bell or board keeps a side the party walks to.
        assertWayClear(f, [], cave.id);
        if (want.size) rooms += 1;
        else plain += 1;
      }
    }
  }
  assert.ok(rooms > 80 && plain > 40, `${rooms} rooms with a canon foe’s objects, ${plain} without`);
  assert.deepEqual(Object.keys(seen).sort(), ['bell', 'forge', 'lectern', 'riddle-board']);
});

test('a canon foe that finds no post takes its bow’s object with it: no forge stands without a golem', () => {
  // Cinder golems that come only as Large elites, in rooms cramped to single tiles (a pillar of
  // cover on every odd-odd tile, the start tiles left open): the golem finds no 2×2 and is left
  // out, so its forge goes too, while the beetles stay.
  const golems = { ...foes, canon: foes.canon.map((c) => (c.id === 'cinder-golems' ? { ...c, rank: 'elite' } : c)) };
  let checked = 0;
  for (let i = 0; i < 80 && checked < 8; i += 1) {
    const cave = caveOf(i * 19 - 500, i * 7 + 40, { region: 'cinderforge', tier: 2 + (i % 6), depth: 1 + (i % 5) });
    const opts = { roadLevel: 3, partySize: 4, rules, foes: golems, words, day: 7 };
    const out = prepareCave(cave, { layout: riftgen.layout(cave), ...opts });
    const room = out.encounters.rooms.find((r) => r.fight.foes.some((u) => u.talkKind === 'cinder-golems') && r.fight.foes.some((u) => u.talkKind !== 'cinder-golems'));
    if (!room) continue;
    assert.ok(room.fight.objects.some((o) => o.kind === 'forge'), `${room.fightId}: a golem brings its forge`);
    const planRoom = out.plan.rooms.find((r) => r.roomId === room.roomId);
    const { rect } = planRoom.arena;
    const starts = new Set(planRoom.arena.entry.map((t) => keyOf(t.x, t.y)));
    const cells = [...planRoom.arena.cells].map((c, k) => {
      const x = rect.x + (k % rect.w);
      const y = rect.y + Math.floor(k / rect.w);
      return (c === '.' || c === '=') && inRect(planRoom.rect, x, y) && x % 2 === 1 && y % 2 === 1 && !starts.has(keyOf(x, y)) ? 'o' : c;
    }).join('');
    const cramped = { ...out.plan, rooms: out.plan.rooms.map((r) => (r === planRoom ? { ...r, arena: { ...r.arena, cells } } : r)) };
    const scene = elsewhere.buildElsewhere(cave, out.layout, { kind: 'cave', words, fight: { plan: out.plan, encounters: null } });
    const again = planEncounters(cave, cramped, scene, { kind: 'cave', ...opts }).rooms.find((r) => r.roomId === room.roomId);
    if (!again) continue;
    assert.ok(!again.fight.foes.some((u) => u.talkKind === 'cinder-golems'), `${room.fightId}: no room for a Large golem`);
    assert.ok(again.fight.foes.length >= 1, 'the beetles stay');
    assert.deepEqual(again.fight.objects.filter((o) => o.kind !== 'prop'), [], `${room.fightId}: its forge went with it`);
    assert.deepEqual(again.fight.objects.map((o) => o.id), again.fight.objects.map((_, k) => `o${k}`));
    checked += 1;
  }
  assert.ok(checked >= 4, `${checked} rooms whose golem found no post`);
});

test('every region’s caves resolve to a list, borrowing the nearest listed region’s where it has none', () => {
  for (const region of ['hearthvale', 'whisperwood', 'mistmere', 'painted-hills', 'ivory-college', 'dicing-downs', 'cinderforge', 'glass-fen', 'archive-peaks', 'greyreach', 'skyward-isles', 'far-shore']) {
    const list = caveList(region, foes);
    assert.ok(list.length > 0, region);
    assert.ok(list.every((f) => f.archetype && f.id), region);
  }
  assert.deepEqual(caveList('painted-hills', foes).map((f) => f.id), foes.caves.mistmere);
  assert.deepEqual(caveList('ivory-college', foes).map((f) => f.id), foes.caves['glass-fen']);
});

test('no field-skill object, prop, nook or footprint stands on the only path to the stitch, the nook or any room (500 seeds, rifts and caves)', () => {
  let checked = 0;
  const check = (scene, blockers, where) => {
    const all = bfsCount(scene);
    for (const t of blockers) {
      const lifted = bfsCount(scene, (x, y) => (x === t.x && y === t.y ? 'open' : null));
      assert.ok(lifted.size <= all.size + 1, `${where}: ${t.what} at ${t.x},${t.y} cuts something off (${lifted.size - all.size - 1} tiles)`);
      checked += 1;
    }
  };
  for (const { spec, plan, scene } of PREPARED) {
    const blockers = [
      ...plan.props.map((p) => ({ ...p, what: 'a prop' })),
      ...(plan.nook ? [{ ...plan.nook, what: 'the nook' }] : []),
    ];
    check(scene, blockers, spec.id);
    // The Tale-lead's footprint is fixed (B.x−1..B.x, B.y−1..B.y): with it standing, the seam, the
    // lead itself and every fight room can still be reached.
    const reach = bfsCount(scene);
    const stitch = scene.objects.find((o) => o.kind === 'stitch');
    assert.ok(reach.has(keyOf(stitch.approach.x, stitch.approach.y)), `${spec.id}: the seam`);
    const lead = scene.objects.find((o) => o.kind === 'tale-lead');
    assert.ok(lead.blocks && reach.has(keyOf(lead.approach.x, lead.approach.y)), `${spec.id}: the lead`);
    for (const room of plan.rooms.filter((r) => r.fight)) {
      let any = false;
      for (let y = room.rect.y; y < room.rect.y + room.rect.h && !any; y += 1) for (let x = room.rect.x; x < room.rect.x + room.rect.w && !any; x += 1) any = reach.has(keyOf(x, y));
      assert.ok(any, `${spec.id}: ${room.roomId} can be reached`);
    }
  }
  const regions = [...Object.keys(foes.caves), 'painted-hills', 'ivory-college', 'hearthvale', 'far-shore'];
  for (let i = 0; i < 500; i += 1) {
    const cave = caveOf(i * 11 - 900, i * 5 - 700, { region: regions[i % regions.length], tier: 1 + (i % 8), depth: 1 + (i % 6) });
    const out = prepareCave(cave, { layout: riftgen.layout(cave), roadLevel: 3, partySize: 4, rules, foes, words, day: 1 });
    const scene = elsewhere.buildElsewhere(cave, out.layout, { kind: 'cave', words, fight: { plan: out.plan, encounters: out.encounters } });
    const special = out.encounters.chests.filter((c) => c.locked || c.mimic).map((c) => ({ ...c, what: c.locked ? 'the locked chest' : 'the Mimic' }));
    assert.equal(special.length, 2);
    check(scene, [...special, ...out.plan.props.map((p) => ({ ...p, what: 'a prop' }))], cave.id);
    const reach = bfsCount(scene);
    for (const c of special) {
      const o = scene.objects.find((x) => x.id === c.id);
      assert.ok(o.blocks && reach.has(keyOf(o.approach.x, o.approach.y)), `${cave.id}: ${c.id} can be walked up to`);
    }
    for (const room of out.plan.rooms) {
      let any = false;
      for (let y = room.rect.y; y < room.rect.y + room.rect.h && !any; y += 1) for (let x = room.rect.x; x < room.rect.x + room.rect.w && !any; x += 1) any = reach.has(keyOf(x, y));
      assert.ok(any, `${cave.id}: ${room.roomId} can be reached`);
    }
  }
  assert.ok(checked > 3000, `${checked} placements checked`);
});

test('a field boss fights alone on the free 2×2 nearest its tear, in the arena it’s given', () => {
  let fought = 0;
  for (let i = 0; i < 400 && fought < 30; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'field'), tier: 5 + (i % 4), depth: 5 });
    if (spec.stage !== 'gaping') continue;
    const rift = { id: spec.id, spec, x: 108, y: -40, stage: 'gaping' };
    const w = 16;
    const h = 12;
    const rect = { x: 100, y: -46, w, h };
    const cells = Array.from({ length: w * h }, (_, k) => ((k % w === 4 && Math.floor(k / w) === 3) ? 'O' : '.')).join('');
    const arena = { rect, cells, height: '0'.repeat(w * h), light: 'L'.repeat(w * h), mouths: [], entry: [{ x: 101, y: -45 }, { x: 102, y: -45 }, { x: 101, y: -44 }, { x: 102, y: -44 }], seed: 1 };
    const f = fieldFight(rift, arena, { roadLevel: 5, partySize: 4, rules, leads, foes, words, hooks });
    if (bestiary.isPuzzleLead(spec, { leads, words, rules })) { assert.equal(f, null, 'a puzzle lead is never challenged to a fight'); continue; }
    fought += 1;
    assert.equal(f.id, `fight:${spec.id}:w:field`);
    assert.equal(f.kind, 'field');
    assert.equal(f.room, 'field');
    assert.equal(f.seed, hashInts(spec.seed >>> 0, 'field', 'fight'));
    assert.equal(f.foes.length, 0, 'alone');
    assert.equal(f.weight, 12);
    assert.equal(f.leadUnit.lead.phases, 3);
    assert.equal(f.arena, arena);
    const p = f.leadUnit.post;
    assert.ok(Math.hypot(p.x + 0.5 - 108, p.y + 0.5 + 40) <= 1.5, 'beside the tear');
    assert.ok(!(p.x <= 104 && 104 <= p.x + 1 && p.y <= -43 && -43 <= p.y + 1), 'never on a tree');
    const nearTree = fieldFight({ ...rift, x: 104, y: -43 }, arena, { roadLevel: 5, partySize: 4, rules, leads, foes, words, hooks }).leadUnit.post;
    assert.ok(!(nearTree.x <= 104 && 104 <= nearTree.x + 1 && nearTree.y <= -43 && -43 <= nearTree.y + 1), 'it steps off a tree at the tear');
    for (const o of f.objects) assert.ok(!(o.x >= p.x && o.x <= p.x + 1 && o.y >= p.y && o.y <= p.y + 1));
  }
  assert.ok(fought >= 10, `${fought} field bosses`);
});

// A field boss's lead fights on its 2×2; its footprint, for the checks.
const leadFoot = (f) => tilesOf(f.leadUnit);

test('a field boss’s mechanic objects keep the way clear, in cluttered arenas and in E’s fieldArena', async (t) => {
  // Cluttered 16×12 arenas: trees, a pond, a wall or two, the party coming in from the west.
  let fought = 0;
  let objects = 0;
  for (let i = 0; i < 3000 && fought < 150; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'field-clutter'), tier: 5 + (i % 4), depth: 5 });
    if (spec.stage !== 'gaping' || bestiary.leadMechanic(spec, { leads, words }).fallback) continue;
    const rng = createRng(hashInts(i, 'clutter'));
    const w = 16;
    const h = 12;
    const rect = { x: 200, y: 30, w, h };
    const entry = [{ x: 201, y: 35 }, { x: 201, y: 36 }, { x: 202, y: 35 }, { x: 202, y: 36 }];
    const starts = new Set(entry.map((e) => keyOf(e.x, e.y)));
    const wallAt = rng.int(5, 11);
    const cells = Array.from({ length: w * h }, (_, k) => {
      const x = rect.x + (k % w);
      const y = rect.y + Math.floor(k / w);
      if (starts.has(keyOf(x, y))) return '.';
      if (x === rect.x + wallAt && (y - rect.y) % 5 !== 2) return rng.chance(0.8) ? '#' : '.';
      const u = rng.next();
      return u < 0.22 ? 'O' : u < 0.28 ? '~' : '.';
    }).join('');
    const arena = { rect, cells, height: '0'.repeat(w * h), light: 'L'.repeat(w * h), mouths: [], entry, seed: i };
    if (partyWalk(arena).size < 40) continue;
    const rift = { id: spec.id, spec, x: 212, y: 36, stage: 'gaping' };
    const f = fieldFight(rift, arena, { roadLevel: 5, partySize: 4, rules, leads, foes, words, hooks });
    if (!f) continue;
    fought += 1;
    objects += assertWayClear(f, leadFoot(f), 'clutter').objects;
    assert.ok(tilesOf(f.leadUnit).every((c) => partyWalk(arena).has(keyOf(c.x, c.y))), `${f.id}: the lead stands where the party can walk`);
  }
  assert.ok(fought >= 100 && objects > 250, `${fought} field bosses, ${objects} objects`);

  // E's own arenas, where E's fieldboss.js is there.
  let E5;
  try {
    E5 = await import('../src/world/fieldboss.js');
  } catch {
    E5 = null;
  }
  if (!E5?.fieldArena) { t.diagnostic('E’s fieldboss.js is not there; only the cluttered arenas ran'); return; }
  const { createWorldgen } = await import('../src/world/worldgen.js');
  const { createWilds } = await import('../src/world/wilds.js');
  const { createNav } = await import('../src/world/nav.js');
  const { wildRiftsForChunk } = await import('../src/rifts.js');
  const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const wilds = createWilds({ worldgen: world, maxChunks: 600 });
  const nav = createNav({ worldgen: world, wildBlocked: wilds.blocked, extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
  const bosses = [];
  for (let day = 20000; day < 20060 && bosses.length < 60; day += 1) {
    for (let cy = -9; cy <= 9 && bosses.length < 60; cy += 1) for (let cx = -9; cx <= 9 && bosses.length < 60; cx += 1) {
      if (Math.abs(cx) < 2 && Math.abs(cy) < 2) continue;
      for (const rift of wildRiftsForChunk({ worldgen: world, riftgen, cx, cy, day, isFree: nav.walkable })) if (E5.isFieldBoss(rift, { leads })) bosses.push(rift);
    }
  }
  let real = 0;
  let realObjects = 0;
  for (const rift of bosses) {
    const got = E5.fieldArena(rift, { worldgen: world, wilds, walkable: nav.walkable, genres, leads });
    if (!got) continue;
    const f = fieldFight(rift, got.arena, { roadLevel: 5, partySize: 4, rules, leads, foes, words, hooks });
    if (!f) continue;
    real += 1;
    realObjects += assertWayClear(f, leadFoot(f), 'fieldArena').objects;
  }
  t.diagnostic(`${real} of E’s field bosses, ${realObjects} mechanic objects`);
  assert.ok(real >= 30, `${real} of E’s field bosses fought`);
});

test('prepareElsewhere takes at most 8 ms by the median and 20 ms at p90', () => {
  const cases = SWEEP.filter((_, i) => i % 2 === 0).slice(0, 220);
  for (const { spec, kind } of cases.slice(0, 20)) prepareElsewhere(spec, prepareOptions(D, kind));
  const times = [];
  for (const { spec, kind } of cases) {
    const t0 = performance.now();
    prepareElsewhere(spec, prepareOptions(D, kind));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1];
  const p90 = times[Math.floor(times.length * 0.9)];
  assert.ok(median <= 8, `median ${median.toFixed(2)} ms`);
  assert.ok(p90 <= 20, `p90 ${p90.toFixed(2)} ms`);
});

test('planEncounters reads only the scene it’s given: the plan’s scene with no encounters yet', () => {
  const { spec, kind } = SWEEP.find((c) => c.spec.stage === 'gaping');
  const out = prepareElsewhere(spec, prepareOptions(D, kind));
  const scene = elsewhere.buildElsewhere(spec, out.layout, { genres, words, hooks, fight: { plan: out.plan, encounters: null } });
  assert.equal(scene.encounters, undefined);
  const again = planEncounters(spec, out.plan, scene, { kind, roadLevel: 3, partySize: 4, rules, leads, foes, words, hooks });
  assert.deepEqual(again, out.encounters);
});
