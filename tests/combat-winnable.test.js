// Winnable on auto (the minds with the shipped tuning; CONTRACT-PHASE4.md §4.10, §13 H's and H2's proofs):
// every generated stray room is won on auto (Long Road, a party of 4 at the room's n, within 3 Try agains,
// 200 seeds); caves the same; every shipped Tale-lead mechanic and the fallback the same (H2: I's lead
// cells with the real minds and the tuned xInt, 200 seeds each, in worker threads); the first Tale-lead
// ≥ 99% with three heroes at level 1; and a Wayfarer above the Road level wins at least as often, in no
// more rounds, on paired seeds.
//   node --test tests/combat-winnable.test.js
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { hashInts } from '../src/world/rng.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { caveSpec, caveLayout } from '../src/world/caves.js';
import { prepareElsewhere, prepareCave } from '../src/combat/encounters.js';
import { loadWorld, partyAt, ctxFor, playFight, simulate, median, roomsFor, proofRooms, winnableRooms, leadMechanics } from '../scripts/sim.mjs';

// In a worker thread (the lead proof's cells) this file registers no tests.
const test = isMainThread ? nodeTest : () => {};
const world = loadWorld({ tuning: 'file' });
const TRIES = 4; // the first go and 3 Try agains

function winsWithin(fight, heroes, ctx, level) {
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const r = playFight(fight, heroes, ctx, { level, play: 'handle', attempt });
    if (r.won) return { won: true, attempt, rounds: r.rounds };
  }
  return { won: false };
}

test('every generated stray room is won on auto: Long Road, a party of 4 at the room’s n, within 3 Try agains, 200 seeds', () => {
  const lost = [];
  let rooms = 0;
  const party = new Map();
  for (let seed = 0; rooms < 200 && seed < 2000; seed += 1) {
    const tier = 1 + (seed % 4);
    const spec = world.riftgen.wildRift({ seed: hashInts(seed, 'winnable'), tier, depth: 1 + (seed % 3) });
    const n = world.rules.tiers[tier - 1];
    const prep = prepareElsewhere(spec, {
      riftgen: world.riftgen, genres: world.content.genres, words: world.words, kind: 'wild', roadLevel: n, partySize: 4, rules: world.rules,
      leads: world.content.combat.leads, foes: world.content.combat.foes, tuning: world.tuning, hooks: world.hooks,
    });
    for (const room of prep.encounters.rooms) {
      if (room.roomId === 'lead' || !room.fight.foes.some((f) => f.side === 'foe')) continue;
      if (!party.has(n)) {
        const heroes = partyAt(world, n, 4);
        party.set(n, { heroes, ctx: ctxFor(world, heroes) });
      }
      const { heroes, ctx } = party.get(n);
      rooms += 1;
      const r = winsWithin(room.fight, heroes, ctx, n);
      if (!r.won) lost.push(room.fightId);
      if (rooms >= 200) break;
    }
  }
  assert.equal(rooms, 200);
  assert.deepEqual(lost, [], `${lost.length} rooms not won within 3 Try agains`);
});

test('caves are won on auto the same way: 200 of them, near enough the vale to run at Road levels 1–5', () => {
  const worldgen = createWorldgen({ seed: 'hushlands', regionWords: world.words.regionWords });
  const lost = [];
  let caves = 0;
  let fights = 0;
  const party = new Map();
  for (let i = 0; caves < 200 && i < 4000; i += 1) {
    const angle = (hashInts(i, 'a') % 3600) / 3600 * Math.PI * 2;
    const r = 40 + (hashInts(i, 'r') % 900);
    const x = Math.round(Math.cos(angle) * r);
    const y = Math.round(Math.sin(angle) * r);
    const tier = worldgen.tierAt(x, y);
    if (tier > 4) continue;
    const cave = caveSpec({ type: 'cave', x, y }, { worldgen, wilds: null, words: world.words, foes: world.content.combat.foes, day: 20000 });
    if (!cave) continue;
    const n = world.rules.tiers[tier - 1];
    const prep = prepareCave(cave, { layout: caveLayout(cave, world.riftgen), roadLevel: n, partySize: 4, rules: world.rules, foes: world.content.combat.foes, words: world.words, day: 20000 });
    caves += 1;
    if (!party.has(n)) {
      const heroes = partyAt(world, n, 4);
      party.set(n, { heroes, ctx: ctxFor(world, heroes) });
    }
    const { heroes, ctx } = party.get(n);
    const all = [...prep.encounters.rooms.map((room) => room.fight), ...prep.encounters.chests.filter((c) => c.mimic).map((c) => c.mimic.fight)];
    for (const fight of all) {
      fights += 1;
      if (!winsWithin(fight, heroes, ctx, n).won) lost.push(fight.id);
    }
  }
  assert.equal(caves, 200);
  assert.ok(fights >= 200);
  assert.deepEqual(lost, [], `${lost.length} of ${fights} cave fights not won within 3 Try agains`);
});

test('named case: the first Tale-lead Chris meets is won ≥ 99% of the time by three heroes at level 1', () => {
  const r = simulate({ world, level: 1, room: 'lead', partySize: 3, mode: 'long-road', play: 'handle', fights: 200, seed: 0xf1257, paired: false, firstLead: true });
  assert.equal(r.fights, 200);
  assert.ok(r.wins / r.fights >= 0.99, `${r.wins} of ${r.fights} (${JSON.stringify(r.outcomes)})`);
});

test('named case: a Wayfarer above the Road level only makes fights easier (paired seeds: no fewer wins, no more rounds)', () => {
  const level = 1;
  const rooms = roomsFor(world, { level, room: 'moderate', partySize: 4, seed: 0x3a7, count: 200 });
  const reference = partyAt(world, level, 4);
  const withWayfarer = partyAt(world, level, 4, { levels: { claude: 4 } });
  assert.equal(withWayfarer.find((h) => h.id === 'claude').level, 4);
  const a = simulate({ world, level, room: 'moderate', partySize: 4, party: reference, play: 'handle', fights: 200, rooms, paired: false, notebooks: {} });
  const b = simulate({ world, level, room: 'moderate', partySize: 4, party: withWayfarer, play: 'handle', fights: 200, rooms, paired: false, notebooks: {} });
  assert.ok(b.wins - a.wins >= 0, `reference ${a.wins}, with the Wayfarer ${b.wins}`);
  assert.ok(median(b.rounds) <= median(a.rounds), `median rounds ${median(a.rounds)} → ${median(b.rounds)}`);
});

// ---------------------------------------------------------------------------
// H2: every shipped mechanic and the fallback, won on auto within 3 Try agains on 100% of 200 seeds. The rooms
// are I's proof cells (sim.mjs proofRooms: 200 wild rifts per mechanic at Road levels 1–5), played by the real
// minds (Let them handle it: the reference party of 4, by personality) with the shipped tuning.json.

const SEEDS = 200;
/** Mechanics whose proof is known to fall short, with why (H2's report has the numbers); their cells report as todo. */
const SHORT = {};

function leadCell(mechanic) {
  const r = winnableRooms(world, proofRooms(world, mechanic, { seeds: SEEDS }), { tries: TRIES });
  return { mechanic, wins: r.wins, rooms: r.rooms, fights: r.fights, lost: r.lost };
}

const inWorker = (mechanic) => new Promise((resolve, reject) => {
  const w = new Worker(new URL(import.meta.url), { workerData: { leadProof: mechanic } });
  w.once('message', (r) => (r?.error ? reject(new Error(r.error)) : resolve(r)));
  w.once('error', reject);
  w.once('exit', (code) => (code === 0 ? null : reject(new Error(`the ${mechanic} worker stopped (${code})`))));
});

/** Every cell, three workers at a time (the other suites' timing budgets share the machine). */
async function leadCells(list, width = 3) {
  const out = new Map();
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) {
      const m = queue.shift();
      out.set(m, await inWorker(m));
    }
  }));
  return list.map((m) => out.get(m));
}

test('every shipped Tale-lead mechanic and the fallback is won on auto: Long Road, a party of 4, within 3 Try agains, on 100% of 200 seeds', async (t) => {
  const mechanics = leadMechanics();
  assert.equal(mechanics.length, 9, 'I’s eight mechanics and the fallback');
  assert.ok(Object.keys(world.tuning?.xInt || {}).length >= 9, 'tuning.json carries an xInt for each');
  const results = await leadCells(mechanics);
  t.diagnostic(results.map((r) => `${r.mechanic} (xInt ${world.tuning.xInt[r.mechanic]}): ${r.wins}/${r.rooms} in ${r.fights} fights${r.lost.length ? `, lost ${JSON.stringify(r.lost)}` : ''}`).join('; '));
  for (const r of results) {
    await t.test(`${r.mechanic}: ${r.wins} of ${r.rooms}`, SHORT[r.mechanic] ? { todo: SHORT[r.mechanic] } : {}, () => {
      assert.equal(r.rooms, SEEDS);
      assert.equal(r.wins, SEEDS, `${r.mechanic}: lost ${JSON.stringify(r.lost)} (seed, Road level, stage)`);
    });
  }
});

if (!isMainThread && workerData?.leadProof) {
  try {
    parentPort.postMessage(leadCell(workerData.leadProof));
  } catch (e) {
    parentPort.postMessage({ error: String(e?.stack || e) });
  }
}
