// Shared fixtures for the minds' tests (module H, CONTRACT-PHASE4.md §13 wave 2): the real content
// through scripts/sim.mjs (untuned, so a tuning.json never moves these tests), the reference party,
// a ctx with the real minds, a round loop that learns like L1 does, random notes, and timing.
// Not a test file (no test() calls); combat-notebook, combat-ai, combat-strays and tuning-smoke import it.
import { hashInts, unit } from '../src/world/rng.js';
import { createBattle, apply } from '../src/combat/battle.js';
import { commit, step, answer } from '../src/combat/driver.js';
import { scriptedPlan } from '../src/combat/ai.js';
import { learn, encodeNote, situationOf, choicesOf, CHOICES } from '../src/combat/notebook.js';
import { loadWorld, ctxFor, partyAt, roomsFor, REFERENCE } from '../scripts/sim.mjs';

export const TERMINAL = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);
export const world = loadWorld({ tuning: null });
export { ctxFor, partyAt, roomsFor, REFERENCE };

/** A seeded number in [0, 1). */
export const rand = (...keys) => unit(hashInts(...keys));
export const randInt = (n, ...keys) => hashInts(...keys) % n;

/**
 * Plays a fight the way the shell does in Guided: each round the heroes draft, `planFor` (the
 * scripted player by default) writes the plans, the driver commits, and `onRecord` sees the record.
 * Returns { battle, rounds, events }.
 */
export function playGuided(battle, ctx, { planFor = (b, id) => scriptedPlan(b, id, ctx), onRecord = null, maxRounds = 20, heroes = null } = {}) {
  let b = battle;
  const events = [];
  let guard = 0;
  while (!TERMINAL.has(b.status) && guard < 3000 && b.round <= maxRounds) {
    guard += 1;
    if (b.status === 'planning') {
      const plans = {};
      for (const u of b.units) {
        if (u.side !== 'party' || u.rank !== 'hero' || u.offline || u.sorted) continue;
        if (heroes && !heroes.includes(u.id)) continue;
        const p = planFor(b, u.id);
        if (p) plans[u.id] = p;
      }
      const c = commit(b, plans, ctx);
      events.push(...c.events);
      if (onRecord && c.record) onRecord(c.record, b);
      if (c.battle === b) break;
      b = c.battle;
    } else if (b.status === 'asking') {
      const r = answer(b, true, ctx);
      events.push(...r.events);
      b = r.battle;
    } else {
      const s = step(b, ctx);
      events.push(...s.events);
      if (s.battle === b) break;
      b = s.battle;
    }
  }
  return { battle: b, rounds: b.round, events };
}

/** Learns a record into a map of notebooks (and the accepts strings), as L1 does at commit. */
export function learnInto(notebooks, accepts, record) {
  for (const [id, r] of Object.entries(record.units || {})) {
    if (!notebooks[id]) continue;
    notebooks[id] = learn(notebooks[id], record, id).notebook;
    if (!r.auto && r.draft && accepts) accepts[id] = `${accepts[id] || ''}${r.accepted.map((a) => (a ? '1' : '0')).join('')}`.slice(-50);
  }
}

/** Planning-time snapshots of real battles (the reference party at a level against moderate rooms), with the scripted player's choices. */
export function snapshots({ level = 3, count = 12, seed = 99, partySize = 4 } = {}) {
  const heroes = partyAt(world, level, partySize);
  const ctx = ctxFor(world, heroes);
  const out = [];
  const choices = [];
  for (const r of roomsFor(world, { level, room: 'moderate', partySize, seed, count })) {
    const b0 = createBattle(r.fights[0], heroes, { roadLevel: level }, ctx);
    playGuided(b0, ctx, {
      onRecord: (record, b) => {
        out.push(b);
        for (const [id, u] of Object.entries(record.units)) {
          u.choices.forEach((c, slot) => { if (c) choices.push({ id, situation: situationOf(b, id, ctx), choice: c, slot, cost: u.plan.slots[slot]?.cost ?? 1 }); });
        }
      },
    });
  }
  return { heroes, ctx, battles: out, choices };
}

/** A notebook's bytes of `n` notes jittered from real situations (spread over genres), newest last. */
export function jitteredNotes(base, n, { genres = [1, 2, 3, 4, 5, 6, 7, 8], seed = 5 } = {}) {
  const bytes = new Uint8Array(n * 24);
  for (let i = 0; i < n; i += 1) {
    const src = base[hashInts(seed, i, 'pick') % base.length];
    const s = src.situation.slice();
    const jitter = (k, amp) => { s[k] = Math.max(0, Math.min(255, s[k] + Math.round((rand(seed, i, k, 'j') - 0.5) * amp))); };
    jitter(0, 60); jitter(1, 60); jitter(9, 60); jitter(7, 20);
    s[5] = genres[hashInts(seed, i, 'g') % genres.length];
    bytes.set(encodeNote({
      situation: s, template: src.choice.template, slot: src.slot, cost: src.cost, relation: src.choice.relation, ability: src.choice.ability,
      weight: 1 + (hashInts(seed, i, 'w') % 2), order: i,
    }), i * 24);
  }
  return bytes;
}

/** Random notes: random situation bytes and catalogue choices (the index's property test). */
export function randomNotes(n, seed, { genres = 4 } = {}) {
  const bytes = new Uint8Array(n * 24);
  for (let i = 0; i < n; i += 1) {
    const s = new Uint8Array(16);
    for (let k = 0; k < 16; k += 1) s[k] = hashInts(seed, i, k) & 0xff;
    // A few genres and coarse values, so buckets repeat and ties happen.
    s[5] = hashInts(seed, i, 'genre') % (genres + 1);
    s[4] = hashInts(seed, i, 'threat') % 12;
    s[6] = hashInts(seed, i, 'foe') % 20;
    if (rand(seed, i, 'dup') < 0.1 && i > 0) s.set(bytes.subarray((i - 1) * 24, (i - 1) * 24 + 16));
    const c = CHOICES[hashInts(seed, i, 'c') % CHOICES.length];
    bytes.set(encodeNote({ situation: s, template: c.id, slot: hashInts(seed, i, 'slot') % 4, cost: 1 + (hashInts(seed, i, 'cost') % 2), relation: c.relation, ability: hashInts(seed, i, 'ab') % 3, weight: 1 + (hashInts(seed, i, 'w') % 2), order: i }), i * 24);
  }
  return bytes;
}

/** The median of timed runs after a warm-up. */
export function medianMs(fn, { warm = 20, runs = 200 } = {}) {
  for (let i = 0; i < warm; i += 1) fn(i);
  const t = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn(i);
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return t[t.length >> 1];
}

export { createBattle, apply, choicesOf };
