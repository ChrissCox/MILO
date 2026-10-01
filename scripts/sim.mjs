// Headless fights (CONTRACT-PHASE4.md §4.10, §7.2, §15; COMBAT.md §9, §16.4): the reference party
// against generated rooms at a Road level, in a mode, played Guided (drafts from notebooks trained
// against the scripted player), in Command (the scripted player) or on Let them handle it. Imports
// with no side effects; it runs only when it's the main module:
//   node scripts/sim.mjs --level 3 --mode long-road --room moderate --party 4 --fights 200
// Rooms run at n = the Road level (a wild rift's spec prepared as a real rift, which runs at the
// party's level), so every level 1–5 has on-level rooms. Kinds: low (hairline rifts' rooms), moderate
// (open and gaping), severe (open and gaping at depth 8, whose depth budget makes Severe), crowded
// (moderate with Crowded), chained (two moderate rooms back to back, no Breather between) and lead.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashInts } from '../src/world/rng.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { loadRules } from '../src/combat/rules.js';
import { buildAbilityIndex } from '../src/combat/abilities.js';
import { createBattle } from '../src/combat/battle.js';
import { commit, step, answer, runToEnd } from '../src/combat/driver.js';
import { prepareElsewhere } from '../src/combat/encounters.js';
import { heroSpec, payFight } from '../src/party.js';
import { makeMinds, scriptedPlan } from '../src/combat/ai.js';
import { createNotebook, learn } from '../src/combat/notebook.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TERMINAL = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);
export const PAYING = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page']);
export const ROOM_KINDS = Object.freeze(['low', 'moderate', 'severe', 'chained', 'crowded', 'lead']);
export const MODES = Object.freeze(['storybook', 'long-road', 'mauds-table']);
/** §4.10's pinned reference party, cut from the end for smaller parties. */
export const REFERENCE = Object.freeze(['milo', 'tollkeeper', 'jev', 'claude']);
const PATHS = Object.freeze({ milo: 'wick', tollkeeper: 'bridge', jev: 'gavel', claude: 'three-pens' });

// I's leads (the eight mechanics and the fallback), when they're there.
let MECHANICS = {};
let BOWS = null;
try {
  if (existsSync(path.join(REPO, 'src/combat/leads.js'))) {
    const mod = await import(pathToFileURL(path.join(REPO, 'src/combat/leads.js')).href);
    MECHANICS = mod.MECHANICS || {};
    BOWS = mod.FOE_BOWS || null;
  }
} catch {
  MECHANICS = {};
  BOWS = null;
}
export const leadsLoaded = () => Object.keys(MECHANICS).length > 0;

// ---------------------------------------------------------------------------
// The world: content read the way electron/content.cjs bundles it, rules, abilities and riftgen

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const worlds = new Map();

/**
 * The content, rules and generators, cached per tuning. tuning: 'file' (content/combat/tuning.json
 * when it's there), null (none: every factor 1), or a tuning object.
 */
export function loadWorld({ root = REPO, tuning = 'file' } = {}) {
  const key = `${root}|${typeof tuning === 'object' && tuning ? JSON.stringify(tuning) : String(tuning)}`;
  if (worlds.has(key)) return worlds.get(key);
  const c = (p) => path.join(root, 'content', p);
  const companions = {};
  for (const f of readdirSync(c('party/companions')).sort()) if (f.endsWith('.json')) companions[f.slice(0, -5)] = readJson(c(`party/companions/${f}`));
  const tuned = tuning === 'file' ? (existsSync(c('combat/tuning.json')) ? readJson(c('combat/tuning.json')) : null) : tuning;
  const content = {
    genres: readJson(c('genres.json')),
    riftgen: readJson(c('riftgen.json')),
    combat: {
      rules: readJson(c('combat/rules.json')), callings: readJson(c('combat/callings.json')), spells: readJson(c('combat/spells.json')),
      leads: readJson(c('combat/leads.json')), foes: readJson(c('combat/foes.json')), tuning: tuned,
    },
    party: { companions, regulars: readJson(c('party/regulars.json')) },
  };
  const rules = loadRules(content.combat.rules, tuned);
  const abilities = buildAbilityIndex({
    callings: content.combat.callings, spells: content.combat.spells, companions, regulars: content.party.regulars, foes: content.combat.foes, leads: content.combat.leads,
  });
  const world = {
    root, content, rules, abilities, tuning: tuned,
    words: content.riftgen,
    riftgen: createRiftgen({ words: content.riftgen, genres: content.genres }),
    genreIds: content.genres.genres.map((g) => g.id),
    hooks: (content.combat.leads.hooks || []).map((h) => h.name),
    mechanics: MECHANICS,
    bows: BOWS,
  };
  worlds.set(key, world);
  return world;
}

/** A CombatCtx for a party (party voices from the companion files), with the real minds. */
export function ctxFor(world, heroes, { notebooks = {}, scripted = false } = {}) {
  const party = {};
  for (const h of heroes) {
    const file = world.content.party.companions[h.id];
    party[h.id] = { personality: file?.personality ?? 'careful', barks: file?.barks || [], voice: file?.voice || (h.id === 'jev' ? 'pictures' : 'words') };
  }
  const ctx = { rules: world.rules, abilities: world.abilities, minds: null, mechanics: world.mechanics, bows: world.bows, genres: world.genreIds, party };
  ctx.minds = makeMinds(ctx, { notebooks, scripted });
  return Object.freeze(ctx);
}

/** A minimal state for heroSpec: the reference party on the roster, each on its path. */
export function referenceState(ids = REFERENCE, { paths = PATHS } = {}) {
  const roster = {};
  for (const id of ids) roster[id] = { path: paths[id] || null };
  return { party: { roster, chosen: ids.filter((id) => id !== 'milo'), play: 'guided' }, road: { xp: 0 }, satchel: { tonics: { cordial: 0, brew: 0 } } };
}

/** UnitSpecs for heroes at a level (the reference party by default, cut to `size`). */
export function partyAt(world, level, size = 4, { ids = REFERENCE, levels = {} } = {}) {
  const pick = ids.slice(0, Math.max(1, Math.min(4, size)));
  const state = referenceState(pick);
  return pick.map((id) => heroSpec(state, id, { content: world.content, rules: world.rules, abilities: world.abilities, level: levels[id] ?? level })).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Rooms

const BUDGET_AFFIXES = new Set(['crowded', 'lonely', 'colossal']);
const tierFor = (level, rules) => {
  const tiers = rules.tiers || [1, 2, 4, 5, 7, 9, 10, 11];
  let t = 1;
  tiers.forEach((n, i) => { if (n <= level) t = i + 1; });
  return t;
};

function specFor(world, level, kind, seed) {
  const depth = kind === 'severe' ? 8 : 1 + (hashInts(seed, 'depth') % 3);
  const spec = world.riftgen.wildRift({ seed, tier: tierFor(level, world.rules), depth });
  const wantStage = kind === 'low' ? ['hairline'] : kind === 'lead' ? ['hairline', 'open', 'gaping'] : ['open', 'gaping'];
  if (!wantStage.includes(spec.stage)) return null;
  const ids = (spec.affixes || []).map((a) => a.id);
  if (kind === 'crowded') {
    const crowded = (world.words.affixes || []).find((a) => a.id === 'crowded');
    return { ...spec, affixes: [...(spec.affixes || []).filter((a) => !BUDGET_AFFIXES.has(a.id)), crowded] };
  }
  if (kind !== 'lead' && ids.some((id) => BUDGET_AFFIXES.has(id))) return null;
  return spec;
}

function prepare(world, spec, level, partySize) {
  return prepareElsewhere(spec, {
    riftgen: world.riftgen, genres: world.content.genres, words: world.words, kind: 'real', roadLevel: level, partySize, rules: world.rules,
    leads: world.content.combat.leads, foes: world.content.combat.foes, tuning: world.tuning, hooks: world.hooks, riftKey: `sim:${spec.seed}`, since: 0, cause: '',
  });
}

/** The shadow genres, whose Tale-leads fight (§3.1): the fallback's rooms come from these. */
export const SHADOW = Object.freeze(['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju']);

/** The mechanics a lead can fight with once I's leads.js is loaded: the eight shipped and the fallback. */
export const leadMechanics = () => Object.keys(MECHANICS);

/**
 * A lead-room spec with its mechanic forced (H2's per-mechanic cells, CONTRACT §13): a generated rift
 * whose Tale-lead is of that mechanic's genre, carrying that mechanic's riftgen text; for the fallback,
 * a shadow genre's lead with one of that genre's unshipped fighting mechanics (seeded). Null when the
 * rift doesn't fit (no lead, a Maelstrom, another genre).
 */
function forceMechanic(world, spec, mechanic) {
  if (!spec?.taleLead || spec.maelstrom) return null;
  const leads = world.content.combat.leads;
  const genre = spec.taleLead.genre;
  if (mechanic === 'fallback') {
    if (!SHADOW.includes(genre)) return null;
    const pool = (leads.mechanics || []).filter((m) => m.genre === genre && !m.ships && !m.noFight);
    if (!pool.length) return null;
    return { ...spec, taleLead: { ...spec.taleLead, mechanic: pool[hashInts(spec.seed >>> 0, 'fallback') % pool.length].text } };
  }
  const m = (leads.mechanics || []).find((x) => x.id === mechanic);
  if (!m || m.genre !== genre) return null;
  return { ...spec, taleLead: { ...spec.taleLead, mechanic: m.text } };
}

/**
 * `count` rooms of a kind at a level for a party size, deterministic from `seed` (`every`: all of a rift's stray rooms, not one;
 * `mechanic`: lead rooms whose lead fights with that mechanic, or 'fallback'): [{ fights: [FightSpec] (two for chained), spec }].
 */
export function roomsFor(world, { level, room, partySize = 4, seed = 1, count = 200, every = false, mechanic = null }) {
  const key = `${level}|${room}|${partySize}|${seed}|${count}|${every}|${mechanic}`;
  if (!world.rooms) Object.defineProperty(world, 'rooms', { value: new Map(), enumerable: false });
  if (world.rooms.has(key)) return world.rooms.get(key);
  const out = [];
  const forced = room === 'lead' && mechanic;
  for (let i = 0; out.length < count && i < count * (forced ? 400 : 60); i += 1) {
    const s = hashInts(seed, level, i, forced ? `sim-lead:${mechanic}` : 'sim-rift');
    let spec = specFor(world, level, room, s);
    if (spec && forced) spec = forceMechanic(world, spec, mechanic);
    if (!spec) continue;
    const prep = prepare(world, spec, level, partySize);
    const rooms = prep.encounters.rooms;
    if (room === 'lead') {
      const lead = rooms.find((r) => r.role === 'lead' && r.fight?.leadUnit);
      if (lead && (!forced || lead.fight.lead?.mechanic === mechanic)) out.push({ fights: [lead.fight], spec });
      continue;
    }
    const strays = rooms.filter((r) => r.roomId !== 'lead' && r.fight?.foes?.some((f) => f.side === 'foe'));
    if (room === 'chained') {
      if (strays.length >= 2) out.push({ fights: [strays[0].fight, strays[1].fight], spec });
      continue;
    }
    // One room a rift (seeded), or with `every`, each of its stray rooms (fewer Elsewheres to prepare).
    if (every) for (const r of strays) { if (out.length < count) out.push({ fights: [r.fight], spec }); }
    else if (strays.length) out.push({ fights: [strays[hashInts(s, 'pick') % strays.length].fight], spec });
  }
  if (world.rooms.size > 400) world.rooms.clear();
  world.rooms.set(key, out);
  return out;
}

/**
 * Rooms with their strays' Integrity scaled by an Integrity factor (the lead untouched, as §4.9 has
 * it): the tuner's calibration, which prepares rooms once at factor 1 and tries factors on copies.
 */
export function scaleRooms(rooms, factor) {
  if (factor === 1) return rooms;
  const scale = (u) => (u.side === 'foe' ? { ...u, maxIntegrity: Math.max(1, Math.round(u.maxIntegrity * factor)), integrity: Math.max(1, Math.round(u.integrity * factor)) } : u);
  return rooms.map((r) => ({ ...r, fights: r.fights.map((f) => ({ ...f, foes: f.foes.map(scale) })) }));
}

/**
 * Lead rooms with the lead's bars as another xInt would make them: prepared at xInt `from` (1 by
 * default) and divided by `xInt`, each bar rounded (§4.9 rounds the bar once, so a bar can differ by 1
 * from a room prepared at `xInt`): the tuner's lead calibration, which tries candidates on copies.
 */
export function scaleLeads(rooms, xInt, from = 1) {
  if (xInt === from) return rooms;
  const bar = (v) => Math.max(1, Math.round((v * from) / xInt));
  const lead = (u) => ({ ...u, maxIntegrity: bar(u.maxIntegrity), integrity: bar(u.integrity), lead: { ...u.lead, bars: u.lead.bars.map(bar) } });
  return rooms.map((r) => ({ ...r, fights: r.fights.map((f) => (f.leadUnit?.lead ? { ...f, leadUnit: lead(f.leadUnit) } : f)) }));
}

// ---------------------------------------------------------------------------
// Playing

/** Heroes after a fight, for the next one without a Breather: topped up to half, charges and uses as left (§4.18). */
export function afterFightHeroes(battle, heroes) {
  return heroes.map((h) => {
    const u = battle.units.find((v) => v.id === h.id);
    if (!u) return h;
    const half = Math.ceil(h.maxIntegrity / 2);
    const integrity = Math.max(u.offline ? 0 : u.integrity, half);
    const uses = Object.fromEntries(Object.entries(u.uses || {}).filter(([k]) => !k.startsWith('#')));
    return { ...h, integrity, charges: { ...h.charges, left: u.charges?.left ?? h.charges.left }, uses: { ...h.uses, ...uses }, rattled: !!u.rattled };
  });
}

// Played to its end, an Ask counts as Always (§7.1's runToEnd). Heroes go in with Always already set:
// the same rule, and it steps round B's answer-then-ask-again loop (reported in H's wave-2 report).
const alwaysForAsk = (h) => (Object.values(h.reactions || {}).includes('ask')
  ? { ...h, reactions: Object.fromEntries(Object.entries(h.reactions).map(([k, v]) => [k, v === 'ask' ? 'always' : v])) } : h);

/** Plays one fight to its end: Command (the scripted player), or from drafts (Guided, Let them handle it). */
export function playFight(fight, heroes, ctx, { mode = 'long-road', noise = true, attempt = 0, level = 1, play = 'guided', firstLead = false } = {}) {
  const battle = createBattle(fight, heroes.map(alwaysForAsk), { attempt, mode, calm: { noise, adaptation: true }, roadLevel: level, firstLead }, ctx);
  const r = runToEnd(battle, ctx, { policy: play === 'command' ? 'scripted' : 'drafts', maxRounds: 30 });
  const outcome = r.result?.outcome || r.battle.status;
  return { battle: r.battle, outcome, won: PAYING.has(outcome), rounds: r.battle.round, records: r.records };
}

// ---------------------------------------------------------------------------
// The lead winnability proof (§13 H2): I's cells (I's combat-leads.test.js) with the real minds and tuning

/** The proof's Road levels cycle 1–5; the rift tier each plays at (the tier whose n is the Road level, or just below). */
export const PROOF_TIERS = Object.freeze([1, 2, 2, 3, 4]);

/**
 * The proof's lead rooms for a mechanic (a shipped id or 'fallback'), as I's proof builds them: wild rifts
 * `hashInts(i, 'lead-proof')` (tier 1, depth 1, no Maelstroms) whose Tale-lead is of the mechanic's genre
 * (the fallback's cycle the shadow genres, each with its genre's first unshipped fighting mechanic), the
 * i-th played at Road level 1 + (i mod 5), its tier from PROOF_TIERS, for a party of 4.
 * → [{ i, road, stage, fight }] (a seed whose lead doesn't fight as the mechanic has `fight: null`)
 */
export function proofRooms(world, mechanic, { seeds = 200 } = {}) {
  const key = `${mechanic}|${seeds}`;
  if (!world.proofs) Object.defineProperty(world, 'proofs', { value: new Map(), enumerable: false });
  if (world.proofs.has(key)) return world.proofs.get(key);
  const leads = world.content.combat.leads;
  const m = (leads.mechanics || []).find((x) => x.id === mechanic) || null;
  const genres = m ? [m.genre] : SHADOW;
  const pool = new Map(genres.map((g) => [g, []]));
  for (let i = 0; [...pool.values()].some((l) => l.length < seeds) && i < 30000; i += 1) {
    const s = world.riftgen.wildRift({ seed: hashInts(i, 'lead-proof'), tier: 1, depth: 1 });
    const g = s.taleLead?.genre;
    if (pool.has(g) && pool.get(g).length < seeds && !s.maelstrom) pool.get(g).push(s);
  }
  const out = [];
  for (let i = 0; i < seeds; i += 1) {
    const road = 1 + (i % 5);
    const genre = m ? m.genre : SHADOW[i % SHADOW.length];
    const base = pool.get(genre)[i];
    const text = m ? m.text : (leads.mechanics || []).find((x) => x.genre === genre && !x.ships && !x.noFight)?.text;
    if (!base || !text) { out.push({ i, road, stage: null, fight: null }); continue; }
    const spec = { ...base, tier: PROOF_TIERS[road - 1], taleLead: { ...base.taleLead, mechanic: text } };
    const prep = prepareElsewhere(spec, {
      riftgen: world.riftgen, genres: world.content.genres, words: world.words, kind: 'wild', roadLevel: road, partySize: 4, rules: world.rules,
      leads, foes: world.content.combat.foes, tuning: world.tuning, hooks: world.hooks,
    });
    const fight = prep.encounters.rooms.find((r) => r.fight?.leadUnit)?.fight || null;
    out.push({ i, road, stage: spec.stage, fight: fight && fight.lead?.mechanic === mechanic ? fight : null });
  }
  world.proofs.set(key, out);
  return out;
}

/**
 * Plays proof rooms on auto (Let them handle it: the reference party of 4 at the room's Road level,
 * empty notebooks, so each hero plays by personality), Long Road, each until won or `tries` goes
 * (the first and 3 Try agains). With `stopAtLoss`, the lowest Road levels go first and the first room
 * lost ends it (the tuner only asks whether the proof holds). → { wins, rooms, fights, lost: [[i, road, stage]] }
 */
export function winnableRooms(world, rooms, { tries = 4, play = 'handle', stopAtLoss = false } = {}) {
  const party = new Map();
  const out = { wins: 0, rooms: rooms.length, fights: 0, lost: [] };
  const order = stopAtLoss ? [...rooms].sort((a, b) => a.road - b.road || a.i - b.i) : rooms;
  for (const r of order) {
    if (stopAtLoss && out.lost.length) break;
    if (!r.fight) { out.lost.push([r.i, r.road, 'no lead room']); continue; }
    if (!party.has(r.road)) {
      const heroes = partyAt(world, r.road, 4);
      party.set(r.road, { heroes, ctx: ctxFor(world, heroes) });
    }
    const { heroes, ctx } = party.get(r.road);
    let won = false;
    for (let attempt = 0; attempt < tries && !won; attempt += 1) {
      out.fights += 1;
      won = playFight(r.fight, heroes, ctx, { level: r.road, play, attempt, mode: 'long-road' }).won;
    }
    if (won) out.wins += 1;
    else out.lost.push([r.i, r.road, r.stage]);
  }
  return out;
}

const notebookCache = new Map();

/**
 * Lead rooms a notebook trains on (one per shipped mechanic in turn), and how much longer their bars are
 * made (H2). None by default: the reference party's notebooks are H's, trained on stray rooms, so a stray
 * room plays exactly as the calibrated table expects (24 lead rooms measured no better in lead fights).
 */
export const LEAD_TRAINING = 0;
export const TRAIN_LEAD_BARS = 2.5;

/**
 * Notebooks trained against the scripted player (§4.10): `fights` rooms at the level, where each
 * round the heroes draft from their growing notebooks and the scripted player writes the plans, as
 * Chris would in Guided; every commit is learned. First come `leadFights` lead rooms, one per shipped
 * mechanic in turn (with I's leads loaded), their bars made TRAIN_LEAD_BARS times longer so the fights
 * run about as long as tuned ones, so the notebooks see the player work each room; the stray rooms
 * follow, so their habits stay the newest.
 */
export function trainNotebooks(worldIn, { level = 1, partySize = 4, fights = 24, seed = 0x7ea, ids = REFERENCE, levels = {}, leadFights = LEAD_TRAINING } = {}) {
  const ships = leadsLoaded() ? leadMechanics().filter((m) => m !== 'fallback') : [];
  const leadCount = ships.length ? leadFights : 0;
  const key = `${level}:${partySize}:${fights}:${seed}:${ids.join(',')}:${JSON.stringify(levels)}:${leadCount}`;
  if (notebookCache.has(key)) return notebookCache.get(key);
  // The notebooks learn the scripted player's choices, which tuning doesn't touch: train once on the untuned rooms.
  const world = loadWorld({ root: worldIn?.root || REPO, tuning: null });
  const heroes = partyAt(world, level, partySize, { ids, levels });
  const notebooks = {};
  for (const h of heroes) notebooks[h.id] = createNotebook(h.id);
  const ctx = ctxFor(world, heroes, { notebooks });
  const kinds = ['moderate', 'low', 'moderate', 'crowded'];
  const rooms = [];
  for (let i = 0; i < leadCount; i += 1) {
    const lead = roomsFor(world, { level, room: 'lead', partySize, seed: hashInts(seed, i, 'lead'), count: 1, mechanic: ships[i % ships.length] });
    rooms.push(...scaleLeads(lead, 1 / TRAIN_LEAD_BARS));
  }
  const strays = [];
  for (const [i, room] of kinds.entries()) strays.push(...roomsFor(world, { level, room, partySize, seed: hashInts(seed, i), count: Math.ceil(fights / kinds.length) }));
  rooms.push(...strays.slice(0, fights));
  for (const r of rooms) {
    let b = createBattle(r.fights[0], heroes, { roadLevel: level }, ctx);
    let guard = 0;
    while (!TERMINAL.has(b.status) && guard < 2000 && b.round <= 20) {
      guard += 1;
      if (b.status === 'planning') {
        const plans = {};
        for (const h of heroes) {
          const u = b.units.find((v) => v.id === h.id);
          if (u && !u.offline) plans[h.id] = scriptedPlan(b, h.id, ctx);
        }
        const c = commit(b, plans, ctx);
        for (const id of Object.keys(c.record?.units || {})) {
          if (notebooks[id]) notebooks[id] = learn(notebooks[id], c.record, id).notebook;
        }
        if (c.battle === b) break;
        b = c.battle;
      } else if (b.status === 'asking') b = answer(b, true, ctx).battle;
      else {
        const s = step(b, ctx);
        if (s.battle === b) break;
        b = s.battle;
      }
    }
  }
  notebookCache.set(key, notebooks);
  return notebooks;
}

/** The minutes model (§4.10): Command 75 s a round, Guided 40 s; the walk and loot 90 s an Elsewhere. */
export function minutesFor(rounds, play, rules) {
  const m = rules?.tuning?.minutes || { round: { command: 75, guided: 40 }, walk: 90 };
  const perRound = play === 'command' ? m.round.command : m.round.guided;
  return (rounds * perRound) / 60;
}

/**
 * §7.2: `fights` seeded fights in one cell. party: 'reference' (cut to partySize) or UnitSpec[].
 * → { wins, rounds, minutes, pay: { xp, marks, checked, differs }, pairedNoise: { flippedToLoss, flippedToWin }, outcomes, fights, won }
 * (`won`: whether each room was won, in order).
 * `pay.checked` counts the won fights whose pay was checked both ways (C's payFight on the same room,
 * Rewards and result, marked auto and not: §4.10's "auto modes pay the same as Command"), and
 * `pay.differs` those that paid differently.
 */
export function simulate({
  level = 1, mode = 'long-road', room = 'moderate', partySize = 4, party = 'reference', play = 'guided', fights = 200, seed = 1, noise = true,
  paired = noise, world = null, tuning = 'file', firstLead = false, notebooks = null, attempts = 1, rooms: given = null,
} = {}) {
  const w = world || loadWorld({ tuning });
  const heroes0 = party === 'reference' ? partyAt(w, level, partySize) : party;
  const nbs = play === 'command' ? {} : notebooks || trainNotebooks(w, { level, partySize: heroes0.length, ids: heroes0.map((h) => h.id), levels: Object.fromEntries(heroes0.map((h) => [h.id, h.level])) });
  const ctx = ctxFor(w, heroes0, { notebooks: nbs });
  const rooms = given || roomsFor(w, { level, room, partySize: heroes0.length, seed, count: fights });
  const out = { wins: 0, rounds: [], minutes: [], pay: { xp: 0, marks: 0, checked: 0, differs: 0 }, pairedNoise: { flippedToLoss: 0, flippedToWin: 0 }, outcomes: {}, fights: rooms.length, won: [] };
  const opts = { mode, level, play, firstLead };
  const run = (r, withNoise) => {
    let heroes = heroes0;
    let won = true;
    const rounds = [];
    for (const f of r.fights) {
      let result = null;
      for (let a = 0; a < attempts && !(result && result.won); a += 1) result = playFight(f, heroes, ctx, { ...opts, noise: withNoise, attempt: a });
      rounds.push(result.rounds);
      out.outcomes[result.outcome] = (out.outcomes[result.outcome] || 0) + (withNoise === noise ? 1 : 0);
      if (withNoise === noise && result.won) payBothWays(f, result.battle.result, w.rules, out.pay);
      if (!result.won) { won = false; break; }
      heroes = afterFightHeroes(result.battle, heroes);
    }
    return { won, rounds };
  };
  // Where no noise can play (Storybook, the first lead, a room whose genres make none), noise off plays the same fight.
  const noisy = (r) => mode !== 'storybook' && !firstLead && r.fights.some((f) => {
    const gs = mode === 'mauds-table' ? f.genres || [] : (f.genres || []).slice(0, 1);
    return [...gs, ...((f.genres || []).includes('starlight') ? ['starlight'] : [])].some((g) => w.rules.genres?.[g]?.noise);
  });
  for (const r of rooms) {
    const main = run(r, noise);
    out.won.push(main.won);
    if (main.won) {
      out.wins += 1;
      for (const f of r.fights) {
        out.pay.xp += f.rewards?.xp || 0;
        out.pay.marks += f.rewards?.marks || 0;
      }
    }
    for (const n of main.rounds) {
      out.rounds.push(n);
      out.minutes.push(minutesFor(n, play, w.rules));
    }
    if (paired && noisy(r)) {
      const other = run(r, !noise);
      const onWon = noise ? main.won : other.won;
      const offWon = noise ? other.won : main.won;
      if (offWon && !onWon) out.pairedNoise.flippedToLoss += 1;
      if (onWon && !offWon) out.pairedNoise.flippedToWin += 1;
    }
  }
  return out;
}

const PAY_STATE = Object.freeze({ road: { xp: 0, paidFights: {} }, satchel: {}, party: { roster: {} } });

/** C's payFight on one won fight, with its result marked auto and not: the same room and Rewards must pay the same. */
export function payBothWays(fight, result, rules, tally = { checked: 0, differs: 0 }) {
  if (!result) return tally;
  const auto = payFight(PAY_STATE, fight.id, fight.rewards, { ...result, auto: true }, 1, { rules });
  const command = payFight(PAY_STATE, fight.id, fight.rewards, { ...result, auto: false }, 1, { rules });
  tally.checked += 1;
  if (auto.paid !== command.paid || auto.xp !== command.xp || auto.marks !== command.marks || JSON.stringify(auto.loot) !== JSON.stringify(command.loot)) tally.differs += 1;
  return tally;
}

// ---------------------------------------------------------------------------
// Numbers

export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function percentile(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
/** The 95% Wilson score interval of k wins in n. */
export function wilson(k, n, z = 1.959963984540054) {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// ---------------------------------------------------------------------------
// The command line

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m) continue;
    const v = argv[i + 1];
    out[m[1]] = v === undefined || v.startsWith('--') ? true : v;
    if (v !== undefined && !v.startsWith('--')) i += 1;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const r = simulate({
    level: Number(a.level || 1), mode: a.mode || 'long-road', room: a.room || 'moderate', partySize: Number(a.party || 4), play: a.play || 'guided',
    fights: Number(a.fights || 200), seed: Number(a.seed || 1), noise: a.noise !== 'off', paired: a.paired !== 'off',
  });
  const [lo, hi] = wilson(r.wins, r.fights);
  console.log(JSON.stringify({
    fights: r.fights, wins: r.wins, winRate: r.fights ? r.wins / r.fights : 0, wilson: [lo, hi], medianRounds: median(r.rounds), p95Rounds: percentile(r.rounds, 95),
    maxRounds: r.rounds.length ? Math.max(...r.rounds) : null, medianMinutes: median(r.minutes), pay: r.pay, pairedNoise: r.pairedNoise, outcomes: r.outcomes,
    leads: leadsLoaded() ? 'I’s mechanics' : 'B’s bare lead', ms: Math.round(performance.now() - t0),
  }, null, 2));
}
