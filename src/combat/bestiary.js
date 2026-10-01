// The bestiary (CONTRACT-PHASE4.md §7.3, §4.9, §5.2; COMBAT.md §8): stat blocks for every foe a
// fight can hold, built from a rift's stray kinds, its Tale-lead, or foes.json's canon foes and
// cave creatures. Every number comes from the rules (rules.json, through B's rules.js) by §4.9's
// pipelines exactly:
//   a stray   Math.round((Math.round(line(level) × multiplier) + elite) × (1 + 0.1 × deepRank) × integrityFactor(level, partySize))
//   a lackey  level max(0, n − 2); Integrity Math.round(line(n) × multiplier × 0.5), Strike floor(0.75 × strike(n)), from the room's n
//   an elite  Large, +10 / +15 / +20 Integrity by level, +1 edge on its attacks and +2 damage
//   a lead    an on-theme stray below the room made elite, with a ranged option and one mechanic;
//             each bar Math.round((Math.round(line(level) × multiplier) + elite) × (1 + 0.1 × deepRank) × share / xInt)
// Specs are Long Road and mode-free: B applies Storybook and Maud's Table from battle.mode (§4.15).
// Pure; every spec is frozen.
import { hashInts } from '../world/rng.js';
import { leadSprite } from '../world/riftfx.js';
import { clipName, leadDisplayName } from '../world/leadname.js';
import { adaptStep, integrityFactor, strayRow } from './rules.js';

/** riftgen's temperaments, in its order (§4.6). */
export const TEMPERAMENTS = Object.freeze(['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud']);
/** The stage's Tale-lead room budget (§4.10's table). */
export const LEAD_ROLE = Object.freeze({ hairline: 'moderate', open: 'severe', gaping: 'severe' });

const LONG_ROAD = { mode: 'long-road', adaptation: true };

/** Deep-freezes plain data (a UnitSpec, a FightSpec). */
export function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freezeDeep(v);
  }
  return value;
}

/** An elite's Integrity bonus at its level (rules.elite.integrity: [[upToLevel, bonus], …]). */
export function eliteBonus(rules, level) {
  const table = rules.elite.integrity;
  for (const [upTo, bonus] of table) if (level <= upTo) return bonus;
  return table[table.length - 1][1];
}

/**
 * A room's budget (§4.10): for four heroes Trivial 40, Low 60, Moderate 80, Severe 120; each hero
 * fewer takes 10, 15, 20 or 30 off; depth adds 2 per hero per depth past 3, up to 10 per hero.
 */
export function roomBudget(budgets, role, partySize, depth = 1) {
  const p = Math.max(1, Math.min(4, Math.floor(partySize) || 1));
  const d = budgets.depth;
  const perHero = Math.min(d.max, d.perHero * Math.max(0, Math.floor(depth || 1) - d.from));
  return budgets.for4[role] - budgets.fewer[role] * (4 - p) + perHero * p;
}

/** A Tale-lead's share: the room's budget ÷ the same role's budget for four heroes (1, ¾, ½, ¼). */
export function leadShare(budgets, role, partySize, depth = 1) {
  return roomBudget(budgets, role, partySize, depth) / roomBudget(budgets, role, 4, depth);
}

const kindsIn = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value) : []);
// Names are clipped to 40 at a word (leadname.js's clipName), the same way leadDisplayName clips a
// lead's, so a lead reads the same on the map and in the fight.
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * A unit's resistances and weaknesses (§4.9, §18.2 item 2), at the stray line's row for `level`:
 * each genre's own kind resisted (both of a fusion's), only the first genre's weakness, and the
 * archetype's own resistances and weaknesses. A kind counts once: one named in both lists is
 * removed from both, neither resisted nor weak (the net of applying both), so Examine shows
 * neither. Strays, leads and canon foes use it, and so do C's regulars, so a stray and the regular
 * made from it always match.
 *   genres     [genre, second?] (falsy entries are skipped)
 *   archetype  an archetype id in rules.archetypes
 *   level      the unit's level
 *   rules      B's loaded rules (or { rules }); options.resist / options.weak add kinds of the
 *              unit's own (a foes.json entry's), under the same rule
 * → { resist: { kind: amount }, weak: { kind: amount } }
 */
export function defencesFor(genres, archetype, level, rules, options = {}) {
  const opts = rules?.archetypes ? { ...options, rules } : { ...rules, ...options };
  const r = opts.rules;
  if (!r?.archetypes) throw new TypeError('defencesFor needs the rules (rules.json through B’s loadRules).');
  const list = (Array.isArray(genres) ? genres : [genres]).filter(Boolean);
  const arch = r.archetypes[archetype] || {};
  const resisted = [];
  const weakTo = [];
  for (const g of list) {
    const kind = r.genres?.[g]?.kind;
    if (kind) resisted.push(kind);
  }
  const own = r.genres?.[list[0]]?.weak;
  if (own) weakTo.push(own);
  resisted.push(...kindsIn(arch.resist), ...kindsIn(opts.resist));
  weakTo.push(...kindsIn(arch.weak), ...kindsIn(opts.weak));
  const both = new Set(resisted.filter((kind) => weakTo.includes(kind)));
  const amount = strayRow(r, 'resist', level);
  const resist = {};
  const weak = {};
  for (const kind of resisted) if (!both.has(kind)) resist[kind] = amount;
  for (const kind of weakTo) if (!both.has(kind)) weak[kind] = amount;
  return { resist, weak };
}

function defences(rules, { genres, archetype, level, extraResist = [], extraWeak = [] }) {
  return defencesFor(genres, archetype, level, rules, { resist: extraResist, weak: extraWeak });
}

function unitLevel(rank, n, level, rules) {
  if (rank === 'lackey') return Math.max(0, Math.floor(n) + (rules.lackey?.levels ?? -2));
  return Math.max(0, Math.floor(level ?? n));
}

function integrityOf(rules, { rank, n, level, multiplier, deepRank, partySize }) {
  const deep = 1 + (rules.deepRank?.integrity ?? 0.1) * deepRank;
  if (rank === 'lackey') {
    const base = Math.round(strayRow(rules, 'integrity', n) * multiplier * (rules.lackey?.integrity ?? 0.5));
    return Math.max(1, Math.round(base * deep * integrityFactor(rules, n, partySize)));
  }
  const elite = rank === 'elite' ? eliteBonus(rules, level) : 0;
  return Math.max(1, Math.round((Math.round(strayRow(rules, 'integrity', level) * multiplier) + elite) * deep * integrityFactor(rules, level, partySize)));
}

function strikeOf(rules, { rank, n, level }) {
  if (rank === 'lackey') return Math.floor((rules.lackey?.strike ?? 0.75) * strayRow(rules, 'strike', n));
  return strayRow(rules, 'strike', level);
}

function carry() {
  return { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] };
}

// The common shape (§5.2's field order).
function unitSpec(f) {
  return freezeDeep({
    id: f.id,
    side: f.side,
    name: clipName(f.name),
    kind: f.kind,
    talkKind: f.talkKind,
    rank: f.rank,
    level: f.level,
    size: f.size,
    small: false,
    archetype: f.archetype,
    genres: f.genres,
    temperament: f.temperament,
    calling: null,
    path: null,
    abilities: { might: 0, grace: f.arch.grace ?? 0, grit: 0, wit: 0, heed: 0, charm: 0 },
    maxIntegrity: f.maxIntegrity,
    integrity: f.maxIntegrity,
    guard: f.arch.guard ?? 0,
    resolve: { body: f.arch.resolve?.body ?? 0, mind: f.arch.resolve?.mind ?? 0 },
    speed: f.arch.speed ?? 5,
    moves: { flies: Boolean(f.arch.flies), hovers: Boolean(f.arch.hovers), throughWalls: Boolean(f.arch.throughWalls), darksight: f.archetype === 'ghost' },
    strike: { amount: f.strike, kind: f.strikeKind, reach: 1, range: f.arch.range ?? 0, weapon: 'natural' },
    ranged: f.ranged,
    keyAdjust: 0,
    flat: f.flat,
    attackEdge: f.attackEdge,
    resist: f.resist,
    weak: f.weak,
    ignores: [...(f.arch.ignores || [])],
    idleHeat: f.idleHeat,
    shield: false,
    charges: { pool: null, max: 0, left: 0, circle: 0 },
    abilityIds: [...new Set(f.abilityIds)],
    uses: {},
    reactions: { 'parting-swipe': 'always' },
    control: 'auto',
    adapt: f.adapt,
    rattled: false,
    lead: f.lead,
    post: f.post ? { x: f.post.x, y: f.post.y } : null,
    look: f.look,
    carry: carry(),
  });
}

const heatOf = (rules, temperament) => rules.temperaments?.[temperament]?.heat ?? 30;
const fightsIn = (rules, genre) => rules.genres?.[genre]?.fights !== false;
const bigMoves = (rules, genre) => (fightsIn(rules, genre) ? rules.genres?.[genre]?.abilities || [] : []);

/**
 * A stray of the rift's kind `kindIndex` (spec.strays), for a room at foe level n.
 * level: its own level (default n; a lackey's is always max(0, n − 2)). rank: 'lackey' | 'stray' | 'elite'.
 * A bright kind (verdant, starlight, summit) comes out side 'neutral': it stands aside and cheers.
 * Extra options: id (default 'f0', the encounter sets f<i>) and post (its start tile).
 */
export function strayUnit(spec, kindIndex, n, { level = null, rank = 'stray', rules, foes = null, deepRank = 0, partySize = 4, roadLevel = 1, id = 'f0', post = null } = {}) {
  void foes;
  const kindOf = spec?.strays?.[kindIndex];
  if (!kindOf) throw new Error(`No stray kind ${kindIndex} in ${spec?.id}`);
  const L = unitLevel(rank, n, level, rules);
  const archetype = kindOf.archetype;
  const arch = rules.archetypes[archetype];
  if (!arch) throw new Error(`No archetype ${archetype}`);
  const genres = [kindOf.genre, kindOf.second].filter(Boolean);
  const side = fightsIn(rules, kindOf.genre) ? 'foe' : 'neutral';
  const elite = rank === 'elite';
  return unitSpec({
    id,
    side,
    name: kindOf.name,
    kind: 'stray',
    talkKind: side === 'foe' ? `k${kindIndex}` : null,
    rank,
    level: L,
    size: elite ? 2 : 1,
    archetype,
    genres,
    temperament: kindOf.temperament,
    arch,
    maxIntegrity: integrityOf(rules, { rank, n, level: L, multiplier: arch.integrity, deepRank, partySize }),
    strike: strikeOf(rules, { rank, n, level: L }),
    strikeKind: rules.genres?.[kindOf.genre]?.kind || 'plain',
    ranged: null,
    flat: (elite ? rules.elite.damage : 0) + deepRank * (rules.deepRank?.damage ?? 1),
    attackEdge: elite ? rules.elite.edge : 0,
    ...defences(rules, { genres, archetype, level: L }),
    idleHeat: heatOf(rules, kindOf.temperament),
    abilityIds: [...(arch.abilities || []), ...bigMoves(rules, kindOf.genre)],
    adapt: side === 'foe' ? adaptStep({ rank, level: L, roomLevel: n, roadLevel }, { ...LONG_ROAD, rules }) : 0,
    lead: null,
    post,
    look: {
      kind: 'stray', archetype, bodyKey: kindOf.bodyKey, parts: (kindOf.parts || []).map((p) => ({ id: p.id, layer: p.layer ?? 0 })),
      eyeKey: null, genres: [kindOf.genre, kindOf.second || null], scale: elite ? 2 : 1,
    },
  });
}

/**
 * Which leads.json mechanic a rift's Tale-lead has: found by its mechanic text across every
 * genre (a fusion's lead can carry its second genre's mechanic).
 * → { id, genre, index, entry (the leads.json row, or null), noFight }
 */
export function mechanicOf(spec, leads, words) {
  const text = spec?.taleLead?.mechanic;
  const banks = words?.genres || {};
  const first = [spec?.taleLead?.genre, ...(spec?.genres || [])].filter((g) => g && banks[g]);
  const order = [...new Set([...first, ...Object.keys(banks)])];
  for (const genre of order) {
    const index = (banks[genre].mechanics || []).indexOf(text);
    if (index < 0) continue;
    const entry = (leads?.mechanics || []).find((m) => m.genre === genre && m.index === index) || null;
    return { id: entry?.id || `${genre}-${index}`, genre, index, entry, noFight: Boolean(entry?.noFight) };
  }
  return { id: 'fallback', genre: null, index: -1, entry: null, noFight: false };
}

/**
 * Whether a rift's Tale-lead stays a puzzle and never fights: its mechanic is one of the seven
 * bright and Backhalls no-fight puzzles (leads.json `noFight`, CONTRACT §3.1), or the lead is
 * itself bright or Backhalls (COMBAT §8.1: "Bright and Backhalls Tale-leads stay puzzles"; its
 * genre doesn't fight in rules.json). A fusion can pair either with the other genre, so both count.
 */
export function isPuzzleLead(spec, { leads, words, rules = null } = {}) {
  if (!spec?.taleLead) return true;
  if (mechanicOf(spec, leads, words).noFight) return true;
  const genre = spec.taleLead.genre || spec.genres?.[0];
  const fights = rules?.genres?.[genre]?.fights;
  return typeof fights === 'boolean' ? !fights : ['verdant', 'starlight', 'summit', 'backhalls'].includes(genre);
}

/**
 * The mechanic a lead fights with: its own when leads.json ships it, else the plain fallback; a
 * Maelstrom's lead always fights as the fallback (§3.2). xInt: tuning's, else leads.json's.
 */
export function leadMechanic(spec, { leads, words, tuning = null }) {
  const mech = mechanicOf(spec, leads, words);
  const fallback = spec?.maelstrom || !mech.entry?.ships;
  const id = fallback ? 'fallback' : mech.id;
  const own = fallback ? leads?.fallback?.xInt : mech.entry?.xInt;
  const xInt = Number(tuning?.xInt?.[id]) > 0 ? Number(tuning.xInt[id]) : Number(own) > 0 ? Number(own) : 1;
  const bow = fallback ? leads?.fallback?.bow || '' : mech.entry?.bow || '';
  return { ...mech, fights: id, fallback, xInt, bow };
}

/**
 * The rift's Tale-lead for a room at foe level `level` (the room's n): an on-theme stray two levels
 * below (one below at gaping, never below 0), made elite and Large, with a ranged option (range 8,
 * its Strike line), a bar per phase and its mechanic. Its name is leadDisplayName's.
 * Extra option: post (its footprint's top-left tile).
 */
export function leadUnit(spec, { level, rules, leads, foes = null, tuning = null, words, partySize = 4, deepRank = 0, roadLevel = 1, hooks = [], post = null } = {}) {
  void foes;
  const lead = spec?.taleLead;
  if (!lead) throw new Error(`${spec?.id} has no Tale-lead`);
  const n = Math.max(0, Math.floor(level));
  const stage = rules.lead.below[spec.stage] != null ? spec.stage : 'hairline';
  const L = Math.max(0, n - rules.lead.below[stage]);
  const look = leadSprite(spec, { words });
  const archetype = look.archetype;
  const arch = rules.archetypes[archetype];
  const genre = lead.genre || spec.genres?.[0];
  const parts = look.parts || (words?.genres?.[genre]?.parts || []).map((id) => ({ id, layer: 0 }));
  const mechanic = leadMechanic(spec, { leads, words, tuning });
  const phases = rules.lead.phases[stage];
  const share = leadShare(rules.budgets, LEAD_ROLE[stage], partySize, spec.depth);
  const deep = 1 + (rules.deepRank?.integrity ?? 0.1) * deepRank;
  const bar = Math.max(1, Math.round((Math.round(strayRow(rules, 'integrity', L) * arch.integrity) + eliteBonus(rules, L)) * deep * share / mechanic.xInt));
  const strike = strayRow(rules, 'strike', L);
  const temperament = TEMPERAMENTS[hashInts(spec.seed >>> 0, 'lead') % TEMPERAMENTS.length];
  return unitSpec({
    id: 'lead',
    side: 'foe',
    name: leadDisplayName(spec, words, { hooks }),
    kind: 'lead',
    talkKind: null,
    rank: 'lead',
    level: L,
    size: 2,
    archetype,
    genres: [genre],
    temperament,
    arch,
    maxIntegrity: bar,
    strike,
    strikeKind: rules.genres?.[genre]?.kind || 'plain',
    ranged: { range: rules.lead.range, amount: strike },
    flat: rules.elite.damage + deepRank * (rules.deepRank?.damage ?? 1),
    attackEdge: rules.elite.edge,
    ...defences(rules, { genres: [genre], archetype, level: L }),
    idleHeat: heatOf(rules, temperament),
    abilityIds: [...(arch.abilities || []), ...bigMoves(rules, genre)],
    adapt: adaptStep({ rank: 'lead', level: L, roomLevel: n, roadLevel }, { ...LONG_ROAD, rules }),
    lead: { mechanic: mechanic.fights, phases, bars: Array.from({ length: phases }, () => bar), quote: lead.line || '' },
    post,
    look: { kind: 'stray', archetype, bodyKey: look.bodyKey, parts: parts.map((p) => ({ id: p.id, layer: p.layer ?? 0 })), eyeKey: null, genres: [genre, null], scale: 2 },
  });
}

/**
 * A canon foe, cave creature or the Mimic (a foes.json entry) for a room at foe level n. Its rank
 * is the entry's own when it has one (Murmurs are lackeys), else `rank`. No genre: it strikes in
 * Plain unless the entry says otherwise, and resists only what its archetype does.
 * Extra options: id, post, deepRank.
 */
export function foeUnit(foe, n, { level = null, rank = 'stray', rules, foes = null, partySize = 4, roadLevel = 1, id = 'f0', post = null, deepRank = 0 } = {}) {
  if (!foe?.id) throw new Error('No foe');
  const r = foe.rank || rank;
  const L = unitLevel(r, n, level, rules);
  const archetype = foe.archetype;
  const arch = rules.archetypes[archetype];
  if (!arch) throw new Error(`No archetype ${archetype}`);
  const canon = foe.id === 'mimic' || Boolean(foes?.canon?.some((c) => c.id === foe.id));
  const elite = r === 'elite';
  const temperament = foe.temperament || 'curious';
  const look = foe.look?.sprite
    ? { kind: 'sprite', name: foe.look.sprite }
    : {
      kind: 'stray', archetype, bodyKey: foe.look?.bodyKey || 'r',
      parts: (foe.look?.parts || []).map((p) => (typeof p === 'string' ? { id: p, layer: 0 } : { id: p.id, layer: p.layer ?? 0 })),
      eyeKey: foe.look?.eyeKey ?? null, genres: [null, null], scale: elite ? 2 : 1,
    };
  return unitSpec({
    id,
    side: 'foe',
    name: capital(foe.one || foe.name),
    kind: canon ? foe.id : 'creature',
    talkKind: foe.id,
    rank: r,
    level: L,
    size: elite ? 2 : 1,
    archetype,
    genres: [],
    temperament,
    arch,
    maxIntegrity: integrityOf(rules, { rank: r, n, level: L, multiplier: arch.integrity, deepRank, partySize }),
    strike: Number.isFinite(foe.bite) ? foe.bite : strikeOf(rules, { rank: r, n, level: L }),
    strikeKind: foe.strikeKind || 'plain',
    ranged: null,
    flat: Number.isFinite(foe.bite) ? 0 : (elite ? rules.elite.damage : 0) + deepRank * (rules.deepRank?.damage ?? 1),
    attackEdge: elite ? rules.elite.edge : 0,
    ...defences(rules, { genres: [], archetype, level: L, extraResist: foe.resist || [], extraWeak: foe.weak || [] }),
    idleHeat: heatOf(rules, temperament),
    abilityIds: [...(arch.abilities || []), ...(foe.abilities || [])],
    adapt: adaptStep({ rank: r, level: L, roomLevel: n, roadLevel }, { ...LONG_ROAD, rules }),
    lead: null,
    post,
    look,
  });
}
