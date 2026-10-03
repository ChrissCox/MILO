// The Company: the roster, levels, heroes' fight specs, warmth, Cheers, rests, rewards and the
// notebooks' state (CONTRACT-PHASE4.md §4.7, §4.11–§4.14, §4.18–§4.19, §5.2, §7.5, §9.3–§9.6).
// Pure: every step takes `now` and returns a new state, or the same object when nothing changed.
// Never imports model.js, hearth.js or rifts.js (§2); what it needs lives in clean.js and state4.js.
import { isRecord, clip, dayNumber, weekStart } from './clean.js';
import { emptyMember, emptyOuting, hearthTierOf, STATE4_LIMITS } from './state4.js';
import { addXp, levelForXp } from './lifeskills.js';
import { hashInts } from './world/rng.js';
import { clipName, leadDisplayName } from './world/leadname.js';
import { markJoined } from './world/trail.js';
import { line, heroIntegrity } from './combat/rules.js';
import { defencesFor, TEMPERAMENTS } from './combat/bestiary.js';
import { PARTS } from './world/straygen.js';
import { FIGHTING_PHASE, movesReady } from './company.js';

export const PHASE4_COMPANIONS = Object.freeze(['milo', 'claude', 'codex', 'jev', 'tollkeeper']);

// The Scribe and the Artificer fight at their real work level (§4.14); everyone else at the Road level.
const WAYFARERS = Object.freeze({ claude: 'claude', codex: 'codex' });
const FOUNDERS = Object.freeze(['milo', 'claude', 'codex', 'jev']);
const FORMATIONS = Object.freeze(['line', 'pairs', 'loose', 'wedge']);
const MODES = Object.freeze(['storybook', 'long-road', 'mauds-table']);
const PLAYS = Object.freeze(['guided', 'command', 'choose', 'handle']);
const CONTROLS = Object.freeze(['mine', 'review', 'choose']);
const SETTINGS = Object.freeze(['ask', 'always', 'under-half', 'never']);
const PAYING = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page']);
const BASE_REACTIONS = Object.freeze(['parting-swipe', 'shoulder', 'ready']);
// §4.6's gentlest-first order; ties go to the lower stray index.
const GENTLE = Object.freeze(['shy', 'polite', 'sleepy', 'lost', 'curious', 'nosy', 'proud', 'grumpy', 'dramatic']);
// Bright and Backhalls strays never fight (§4.9).
const NO_FIGHT = Object.freeze(['verdant', 'starlight', 'summit', 'backhalls']);
// §4.19's thresholds, highest first.
const WARMTH_STEPS = Object.freeze([['fireside', 100], ['friend', 60], ['companion', 30], ['acquaintance', 10], ['stranger', 0]]);
const MAX_WARMTH = 1000;
const MAX_CHOSEN = 3;
const MAX_REGULARS = 12;
const MAX_GIFTS = 3;
const MAX_STRUCK = 40;
const MAX_ACCEPTS = 50;
const MAX_BOONS = 3;
const MAX_TONICS = 20;
const MAX_MARKS = 1e9;
const ABILITY_KEYS = Object.freeze(['might', 'grace', 'grit', 'wit', 'heed', 'charm']);
// §4.21: Warding's options (it unlocks options, never power).
const WARDING_WEDGE = 5;
const WARDING_RULES = Object.freeze([[50, 6], [15, 3], [0, 1]]);
// §4.21's Seamcraft rates, when content/xp.json isn't passed.
const SEAMCRAFT = Object.freeze({ 'wild-stitch': 300, 'wild-stitch-depth': 30, 'real-stitch': 500 });
// COMBAT §3.4 and §5.1: a Strike is Plain for weapons. Light, Ink and Spark are Milo's, the
// Scribe's and the Artificer's own kinds for their spells and knacks (B's `caster`), never their
// Strikes'. Residents and regulars strike in their genre's kind (Pip's Strikes deal Warp, §3.7).
const PARTY_KINDS = Object.freeze(['light', 'ink', 'spark']);
// A Weaver's once-a-Campfire burn (§6.5 `burn-essence`).
const BURN = 'burn-an-essence';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const whole = (v, lo = 0, hi = 1e9) => (finite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
const stamp = (now) => (finite(now) && now > 0 ? Math.round(now) : 0);
// A missing `now` never falls through to the wall clock (clean.js's dayNumber and weekStart would
// read it instead): it counts as the epoch, so every step stays pure and repeatable.
const clock = (now) => (finite(now) ? now : 0);
const dayOf = (now) => dayNumber(clock(now));
const weekOf = (now) => weekStart(clock(now));
const isSlug = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Content lookups (cached per content bundle)

const catalogs = new WeakMap();

/** The parts of the content bundle party.js reads, indexed once per bundle. */
function catalog(content) {
  if (!isRecord(content)) return emptyCatalog();
  if (catalogs.has(content)) return catalogs.get(content);
  const callingsFile = isRecord(content.combat?.callings) ? content.combat.callings : {};
  const spellsFile = isRecord(content.combat?.spells) ? content.combat.spells : {};
  const companions = isRecord(content.party?.companions) ? content.party.companions : {};
  const regulars = isRecord(content.party?.regulars) ? content.party.regulars : {};
  const abilities = new Map();
  const add = (list) => { for (const a of Array.isArray(list) ? list : []) if (isRecord(a) && typeof a.id === 'string') abilities.set(a.id, a); };
  add(callingsFile.abilities);
  add(spellsFile.spells);
  for (const file of Object.values(companions)) add(file?.abilityDefs);
  add(regulars.abilityDefs);
  const cat = {
    file: callingsFile,
    callings: new Map((callingsFile.callings || []).map((c) => [c.id, c])),
    paths: new Map((callingsFile.paths || []).map((p) => [p.id, p])),
    abilities,
    companions,
    regulars,
    genres: Array.isArray(content.genres?.genres) ? content.genres.genres : [],
    leads: isRecord(content.combat?.leads) ? content.combat.leads : null,
    words: isRecord(content.riftgen) ? content.riftgen : null,
  };
  catalogs.set(content, cat);
  return cat;
}

function emptyCatalog() {
  return { file: {}, callings: new Map(), paths: new Map(), abilities: new Map(), companions: {}, regulars: {}, genres: [], leads: null, words: null };
}

/** An ability by id: the AbilityIndex first (B's buildAbilityIndex, a Map), then the content. */
function abilityLookup(abilities, cat) {
  return (id) => {
    if (abilities instanceof Map && abilities.has(id)) return abilities.get(id);
    if (isRecord(abilities) && typeof abilities.get === 'function') {
      const a = abilities.get(id);
      if (a) return a;
    }
    return cat.abilities.get(id) || null;
  };
}

/** §6.1's Num: a number, `{ byLevel }` (the value at the highest key ≤ level), or 'wit' / 'charm' (at least 1). */
export function resolveNum(n, level, abilities = {}) {
  if (finite(n)) return n;
  if (n === 'wit' || n === 'charm') return Math.max(1, whole(abilities[n], -1, 5));
  if (isRecord(n) && isRecord(n.byLevel)) {
    let best = null;
    let value = 0;
    for (const [key, v] of Object.entries(n.byLevel)) {
      const at = Number(key);
      if (at <= level && (best === null || at > best)) { best = at; value = v; }
    }
    return value;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// State access

function partyOf(state) {
  return isRecord(state) && isRecord(state.party) ? state.party : {};
}
function rosterOf(state) {
  const roster = partyOf(state).roster;
  return isRecord(roster) ? roster : {};
}
/** Every id on the roster, Milo and the three who are always his first. */
function rosterIds(state) {
  const ids = [...FOUNDERS];
  for (const id of Object.keys(rosterOf(state))) if (!ids.includes(id)) ids.push(id);
  return ids;
}
const inRoster = (state, id) => FOUNDERS.includes(id) || Object.hasOwn(rosterOf(state), id);

/** A roster member as saved, or an empty one (the cleaner adds the founders; a raw state may not have them yet). */
function memberOf(state, id) {
  const saved = own(rosterOf(state), id);
  const base = emptyMember(0);
  if (!isRecord(saved)) return base;
  return {
    ...base,
    ...saved,
    warmthWeek: { ...base.warmthWeek, ...(isRecord(saved.warmthWeek) ? saved.warmthWeek : {}) },
    gifts: { ...base.gifts, ...(isRecord(saved.gifts) ? saved.gifts : {}) },
    notebook: { ...base.notebook, ...(isRecord(saved.notebook) ? saved.notebook : {}) },
    reactions: isRecord(saved.reactions) ? saved.reactions : {},
    boons: Array.isArray(saved.boons) ? saved.boons : [],
    prepared: Array.isArray(saved.prepared) ? saved.prepared : [],
  };
}

function outingOf(state) {
  const outing = partyOf(state).outing;
  const base = emptyOuting();
  return isRecord(outing) ? { ...base, ...outing, heroes: isRecord(outing.heroes) ? outing.heroes : {} } : base;
}

function withParty(state, patch) {
  const party = partyOf(state);
  return { ...state, party: { ...party, ...patch } };
}

function withMember(state, id, make) {
  const before = memberOf(state, id);
  const after = make(before);
  if (after === before) return state;
  return withParty(state, { roster: { ...rosterOf(state), [id]: after } });
}

const battleLive = (state) => isRecord(state?.expedition) && state.expedition.battle != null;
const insideElsewhere = (state) => isRecord(state?.expedition) && state.expedition.inside === true;
const regularsOf = (state) => (Array.isArray(partyOf(state).regulars) ? partyOf(state).regulars : []);
const regularOf = (state, id) => regularsOf(state).find((r) => isRecord(r) && r.id === id) || null;
const wardingLevel = (state) => levelForXp(whole(state?.xp?.skills?.warding));

// ---------------------------------------------------------------------------
// Levels

/** The Hearth tier's fortress id (1 camp … 8 bright-kingdom), in rules.json's own order. */
function tierId(state, rules) {
  const ids = Object.keys(rules.road.cap);
  return ids[Math.min(ids.length, hearthTierOf(state)) - 1];
}

/** §4.13: the Road level from road.xp, capped by the Hearth's tier; XP past the cap counts when it rises. */
export function roadLevel(state, rules) {
  const xp = whole(state?.road?.xp);
  const table = rules.road.xp;
  let raw = 1;
  for (let i = 1; i < table.length; i += 1) if (xp >= table[i]) raw = i + 1;
  const cap = rules.road.cap[tierId(state, rules)] ?? table.length;
  const shown = whole(state?.road?.levelShown, 1, table.length);
  // Levels never drop: a level already shown stays, as long as the XP still reaches it.
  const level = Math.max(1, Math.min(raw, cap), Math.min(raw, shown));
  return { level, cap, xp, next: level < table.length ? table[level] : null, capped: raw > level };
}

/** §4.14: a Wayfarer's work level from finished pieces; past 12, every `workPast12` more is a level. */
export function workLevel(pieces, rules) {
  const n = whole(pieces);
  const table = rules.work;
  let level = 1;
  for (let i = 1; i < table.length; i += 1) if (n >= table[i]) level = i + 1;
  if (level === table.length) level += Math.floor((n - table[table.length - 1]) / (rules.workPast12 || 140));
  return level;
}

/** §4.14: the Scribe and the Artificer at max(work, road − 1) with no ceiling; everyone else at the Road level. */
export function fightingLevel(state, id, rules) {
  const road = roadLevel(state, rules).level;
  const agent = WAYFARERS[id];
  if (!agent) return road;
  return Math.max(workLevel(state?.tally?.byCrew?.[agent], rules), road - 1);
}

/** Records that the Level up moment for `level` has been shown (road.levelShown only rises). */
export function showLevel(state, level, now) {
  const shown = whole(state?.road?.levelShown, 1, 40);
  if (!finite(level) || level <= shown || !isRecord(state)) return state;
  return { ...state, road: { ...(isRecord(state.road) ? state.road : {}), levelShown: Math.min(40, Math.floor(level)) } };
}

// ---------------------------------------------------------------------------
// The crew's real state

/** 'working' sends a likeness; needs-you is idle (Decided); no snapshot, or a source that's down, is unknown. */
export function crewStateOf(snapshot, agent) {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.sessions)) return 'unknown';
  const source = snapshot.sources?.[agent];
  if (!isRecord(source) || source.ok === false) return 'unknown';
  const busy = snapshot.sessions.some((s) => isRecord(s) && s.agent === agent && s.archived !== true && s.status === 'working');
  return busy ? 'working' : 'idle';
}

function busyTitle(snapshot, agent) {
  const session = (snapshot?.sessions || []).find((s) => isRecord(s) && s.agent === agent && s.archived !== true && s.status === 'working');
  return session && typeof session.title === 'string' ? clip(session.title.replace(/[‘’']/g, ''), 40) : '';
}

const LIKENESS = Object.freeze({ claude: 'clay', codex: 'slate' });
const likenessOf = (id, snapshot) => (LIKENESS[id] && crewStateOf(snapshot, id) === 'working' ? LIKENESS[id] : null);

// ---------------------------------------------------------------------------
// Heroes' fight specs

/**
 * The spells a hero knows: knacks at will; every spell up to their highest circle; for a Scrivener
 * only the Pages she's prepared, or, until she first prepares them, the first Wit + level in her list.
 */
function spellsKnown(cat, calling, member, level, circleMax, lookup, wit) {
  const out = [];
  let pages = calling.id === 'scrivener' && !member.prepared.length ? Math.max(0, wit + level) : 0;
  for (const id of calling.spells || []) {
    const a = lookup(id);
    if (!a || a.stub) continue;
    if (!a.circle) out.push(id); // knacks are at will
    else if (a.circle > circleMax) continue;
    else if (calling.id !== 'scrivener' || member.prepared.includes(id)) out.push(id);
    else if (pages > 0) { out.push(id); pages -= 1; }
  }
  return out;
}

function circleAt(circles, level) {
  let circle = 0;
  for (const [at, c] of Object.entries(circles || {})) if (Number(at) <= level && c > circle) circle = c;
  return circle;
}

function chargesMax(cat, pool, level) {
  const table = pool ? cat.file.charges?.[pool] : null;
  return Array.isArray(table) && table.length ? table[Math.min(table.length, Math.max(1, level)) - 1] : 0;
}

function abilitySpread(base, boons) {
  const out = {};
  for (const key of ABILITY_KEYS) out[key] = whole(base?.[key], -1, 5);
  for (const boon of boons) {
    const m = /^ability-up-(might|grace|grit|wit|heed|charm)$/.exec(boon);
    if (m) out[m[1]] = Math.min(5, out[m[1]] + 1);
  }
  return out;
}

const boonAbility = (boon) => (boon.startsWith('ability-up-') ? 'ability-up' : boon);

/** The ids a hero may use at a level: calling features, path features, boons, spells, moves, the kit's art, items and gifts. */
function abilityIdsFor({ cat, calling, comp, regular, member, level, circleMax, lookup, wit }) {
  const ids = [];
  const push = (id) => { if (typeof id === 'string' && !ids.includes(id)) ids.push(id); };
  for (let lv = 1; lv <= Math.min(level, 12); lv += 1) {
    for (const id of calling.levels?.[String(lv)] || []) if (id !== 'path' && id !== 'boon') push(id);
  }
  const path = !regular && member.path ? cat.paths.get(member.path) : null;
  if (path && path.calling === calling.id) {
    for (const [lv, list] of Object.entries(path.levels || {})) if (Number(lv) <= level) for (const id of list) push(id);
  }
  for (const boon of member.boons) push(boonAbility(boon));
  for (const id of spellsKnown(cat, calling, member, level, circleMax, lookup, wit)) push(id);
  for (const id of comp?.moves || []) push(id);
  const weapon = comp?.weapon || calling.weapon;
  push(cat.file.weaponArts?.[weapon]);
  for (const id of cat.file.items || []) push(id);
  if (comp?.id === 'claude') push(cat.file.gifts?.margin);
  if (comp?.id === 'codex') push(cat.file.gifts?.spare);
  if (regular) {
    push(cat.regulars.signatures?.[regular.genre]);
    if (regular.lead) push(cat.regulars.tricks?.[regular.genre]);
  }
  return ids.filter((id) => { const a = lookup(id); return a && !a.stub; });
}

function genreKind(rules, genre) {
  return rules.genres?.[genre]?.kind || 'plain';
}

/** The weaver's carried essences and the genres they come from (for Borrow a rule). */
function essencesOf(state) {
  const satchel = isRecord(state?.satchel) ? state.satchel : {};
  const counts = isRecord(satchel.essences) ? satchel.essences : {};
  const genres = isRecord(satchel.essenceGenres) ? satchel.essenceGenres : {};
  let total = 0;
  const stitched = [];
  for (const [name, n] of Object.entries(counts)) {
    const qty = whole(n);
    if (!qty) continue;
    total += qty;
    const g = genres[name];
    if (typeof g === 'string' && !stitched.includes(g)) stitched.push(g);
  }
  return { total: Math.min(total, 999), stitched: stitched.sort() };
}

/**
 * The essences one Weaver carries into a fight: the satchel's total, less one for each Weaver ahead
 * of it in the party (Milo, then party.chosen) who can still burn one this Campfire. Each burns at
 * most one a Campfire, so between them they never burn more than the satchel holds.
 */
function weaverEssences(state, id, cat, lookup) {
  const held = essencesOf(state);
  const burnMax = Math.max(0, Math.floor(resolveNum(lookup(BURN)?.uses?.n ?? 1, 1)));
  let ahead = 0;
  for (const other of outHeroes(state)) {
    if (other === id) break;
    if (callingOf(state, other, cat).calling?.id !== 'weaver') continue;
    const saved = own(outingOf(state).heroes, other)?.uses?.[BURN];
    ahead += Math.min(burnMax, finite(saved) ? whole(saved) : burnMax);
  }
  return { total: Math.max(0, held.total - ahead), stitched: held.stitched };
}

/**
 * A hero's UnitSpec (§5.2), mode-free (§4.15). `level` pins a BattleSave's level; otherwise it's
 * the hero's fighting level. Integrity, charges, uses and Rattled come from the outing. Null for
 * an id that isn't a companion or a regular on the roster.
 */
export function heroSpec(state, id, { content, rules, abilities = null, snapshot = null, now = 0, level = null } = {}) {
  const cat = catalog(content);
  const lookup = abilityLookup(abilities, cat);
  const regular = typeof id === 'string' && id.startsWith('reg-') ? regularOf(state, id) : null;
  const comp = regular ? null : own(cat.companions, id);
  if (!regular && (!isRecord(comp) || !inRoster(state, id))) return null;
  const calling = cat.callings.get(regular ? regular.calling : comp.calling);
  if (!calling) return null;
  const member = memberOf(state, id);
  const lvl = finite(level) && level >= 1 ? Math.floor(level) : fightingLevel(state, id, rules);
  const abilitiesOut = abilitySpread(regular ? cat.regulars.spreads?.[calling.id] : comp.abilities, member.boons);
  const archetype = regular ? regular.archetype : null;
  const arch = archetype ? rules.archetypes?.[archetype] || {} : {};

  // Defences (§4.5): armour, then Grace, Grit and Heed at 3 or more; never above 2. A Warden's plate
  // comes with the level the hero fights at (Wardens fight at the Road level, §17.12), so a level a
  // BattleSave pins keeps the Guard the fight began with (§5.4: a level that rises mid-pause waits).
  const armour = calling.plateFrom && lvl >= calling.plateFrom ? 'plate' : calling.armour;
  const lightArmour = armour === 'none' || armour === 'light';
  const guard = Math.min(2, (rules.armour?.[armour] ?? 0) + (abilitiesOut.grace >= 3 && lightArmour ? 1 : 0));
  const resolve = {
    body: Math.min(2, (calling.resolve?.body ?? 0) + (abilitiesOut.grit >= 3 ? 1 : 0)),
    mind: Math.min(2, (calling.resolve?.mind ?? 0) + (abilitiesOut.heed >= 3 ? 1 : 0)),
  };
  const flies = Boolean(comp?.flies) || arch.flies === true;
  const small = Boolean(comp?.small);
  // §4.4: +1 Speed at Grace 3. A regular's base is its archetype's Speed (§4.9) less the +1 that
  // table already gives for the archetype's own Grace 3, so it moves as that stray does (crawler and
  // flier 6, walker and ghost 5, construct and floater 4) and an Ability up to Grace 3 still counts.
  const graceAt = rules.actions.grace ?? 3;
  let speed = regular ? (arch.speed ?? rules.actions.speed) - ((arch.grace ?? 0) >= graceAt ? 1 : 0)
    : (flies ? rules.actions.flies : small ? rules.actions.small : rules.actions.speed);
  if (abilitiesOut.grace >= graceAt) speed += 1;

  const weapon = comp?.weapon || calling.weapon;
  const ownKind = regular ? null : comp.damageKind || 'plain';
  const kind = regular ? genreKind(rules, regular.genre) : PARTY_KINDS.includes(ownKind) ? 'plain' : ownKind;
  const strike = {
    amount: line(rules, 'strike', lvl) + (rules.weapons?.[weapon] ?? 0),
    kind,
    reach: 1,
    range: weapon === 'ranged' ? rules.weapons?.rangedRange ?? rules.actions.bowRange ?? 12 : 0,
    weapon,
  };

  // Resistances and weaknesses: a regular's are its stray's, from D's one helper (§18.2 item 2: a
  // kind named in both lists counts in neither), at the stray row for its level; the named heroes have none.
  const { resist, weak } = regular ? defencesFor([regular.genre, regular.second], archetype, lvl, rules) : { resist: {}, weak: {} };

  const path = !regular && member.path ? cat.paths.get(member.path) : null;
  const heatShift = path && lvl >= 3 ? Math.max(-10, Math.min(10, whole(path.heat, -10, 10))) : 0;
  const idle = regular ? (rules.temperaments?.[regular.temperament]?.heat ?? rules.heat?.temperaments?.[regular.temperament] ?? 25)
    : (rules.heat?.companions?.[id] ?? 20);

  const pool = calling.charges || null;
  const circleMax = pool ? circleAt(cat.file.circles?.[pool], lvl) : 0;
  const maxCharges = chargesMax(cat, pool, lvl);
  const outing = own(outingOf(state).heroes, id);
  const hero = isRecord(outing) ? outing : {};
  const maxIntegrity = heroIntegrity(rules, calling.build, lvl, abilitiesOut.grit);
  const integrity = finite(hero.integrity) && hero.integrity > 0 ? Math.min(maxIntegrity, Math.floor(hero.integrity)) : maxIntegrity;

  const abilityIds = abilityIdsFor({ cat, calling, comp, regular, member, level: lvl, circleMax, lookup, wit: abilitiesOut.wit });
  const uses = {};
  const savedUses = isRecord(hero.uses) ? hero.uses : {};
  for (const aid of abilityIds) {
    const a = lookup(aid);
    const per = a?.uses?.per;
    if (per !== 'breather' && per !== 'campfire' && per !== 'fight') continue;
    const max = Math.max(0, Math.floor(resolveNum(a.uses.n, lvl, abilitiesOut)));
    // Once-a-fight uses come back at the fight's end (§6.3), so every fight starts with them all.
    uses[aid] = per !== 'fight' && finite(savedUses[aid]) ? Math.min(max, whole(savedUses[aid])) : max;
  }

  const reactions = {};
  const defaults = isRecord(rules.reactions) ? rules.reactions : {};
  for (const rid of [...BASE_REACTIONS, ...abilityIds.filter((aid) => lookup(aid)?.reaction)]) {
    const setting = [member.reactions[rid], comp?.reactions?.[rid], defaults[rid], defaults.default].find((s) => SETTINGS.includes(s));
    reactions[rid] = setting || 'always';
  }
  const play = partyOf(state).play;
  let control = CONTROLS.includes(member.control) ? member.control : 'review';
  if (play === 'command') control = 'mine';
  else if (play === 'choose' && id !== 'milo') control = 'choose';

  const satchel = isRecord(state?.satchel) ? state.satchel : {};
  const tonics = isRecord(satchel.tonics) ? satchel.tonics : {};
  const essences = calling.id === 'weaver' ? weaverEssences(state, id, cat, lookup) : { total: 0, stitched: [] };
  const carry = {
    cordial: id === 'milo' ? whole(tonics.cordial, 0, MAX_TONICS) : 0,
    brew: id === 'milo' ? whole(tonics.brew, 0, MAX_TONICS) : 0,
    margin: id === 'claude' ? whole(member.gifts.margin, 0, MAX_GIFTS) : 0,
    spare: id === 'codex' ? whole(member.gifts.spare, 0, MAX_GIFTS) : 0,
    essences: essences.total,
    stitched: essences.stitched,
  };

  const look = regular
    ? { kind: 'stray', archetype, bodyKey: regular.bodyKey || 'r', parts: (regular.parts || []).map((p) => ({ id: p.id, layer: p.layer === 1 ? 1 : 0 })),
      eyeKey: regular.eyeKey ?? null, genres: [regular.genre, regular.second ?? null], scale: 1 }
    : { kind: 'rig', rig: comp.rig || 'robe', who: id, likeness: likenessOf(id, snapshot) };

  return deepFreeze({
    id,
    side: 'party',
    name: regular ? clip(regular.name, 40) : comp.name,
    kind: regular ? 'regular' : id === 'milo' ? 'milo' : id,
    talkKind: null,
    rank: 'hero',
    level: Math.min(40, lvl),
    size: 1,
    small,
    archetype,
    genres: regular ? [regular.genre, ...(regular.second ? [regular.second] : [])] : [],
    temperament: regular ? regular.temperament : null,
    calling: calling.id,
    path: regular ? null : member.path || null,
    abilities: abilitiesOut,
    maxIntegrity,
    integrity,
    guard,
    resolve,
    speed: Math.max(1, Math.min(12, speed)),
    moves: { flies, hovers: arch.hovers === true, throughWalls: arch.throughWalls === true, darksight: Boolean(comp?.darksight) || arch.darksight === true },
    strike,
    ranged: null,
    keyAdjust: abilitiesOut[calling.key] - 3,
    flat: 0,
    attackEdge: 0,
    resist,
    weak,
    ignores: regular ? [...(arch.ignores || [])] : [],
    idleHeat: Math.max(0, Math.min(100, idle + heatShift)),
    shield: calling.shield === true,
    // A hero with no outing entry is fresh (full). An entry always carries its charges (§18.2 item 8),
    // and one that somehow lacks them reads as A's cleaner keeps it (0), so a save never changes a spec.
    charges: { pool, max: maxCharges, left: isRecord(outing) ? Math.min(maxCharges, whole(hero.charges)) : maxCharges, circle: circleMax },
    abilityIds,
    uses,
    reactions,
    control,
    adapt: 0,
    rattled: hero.rattled === true,
    lead: null,
    post: null,
    look,
    carry,
  });
}

/** Milo first, then party.chosen, each at its fighting level (or a BattleSave's pinned `levels`). */
export function partySpecs(state, { content, rules, abilities = null, snapshot = null, now = 0, levels = null } = {}) {
  const ids = ['milo', ...(Array.isArray(partyOf(state).chosen) ? partyOf(state).chosen : [])];
  return ids.map((id) => heroSpec(state, id, { content, rules, abilities, snapshot, now, level: levels?.[id] ?? null })).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The muster

const PRONOUN = Object.freeze({ she: 'Her', he: 'His', they: 'Their', it: 'Its' });
const CREW_NAME = Object.freeze({ claude: 'Claude', codex: 'Codex' });

function displayName(cat, state, id) {
  const comp = own(cat.companions, id);
  if (isRecord(comp)) return comp.name;
  return regularOf(state, id)?.name || id;
}

/** §4.19: stranger, acquaintance, companion, friend or fireside. */
export function warmthStep(n) {
  const w = finite(n) ? n : 0;
  return WARMTH_STEPS.find(([, at]) => w >= at)[0];
}

/** The share of '1's among the last 50 drafted, non-auto slots, 0–100 (as notebook.sync reads it). */
function syncOf(accepts) {
  const text = typeof accepts === 'string' ? accepts.slice(-MAX_ACCEPTS) : '';
  if (!text.length) return 0;
  return Math.round((100 * [...text].filter((c) => c === '1').length) / text.length);
}

/** Rattled first; Tired only while below full Integrity (as heroSpec reads it from the outing); else Rested. */
function moodOf(state, id, { content, rules }) {
  const hero = own(outingOf(state).heroes, id);
  if (isRecord(hero) && hero.rattled === true) return 'A little rattled';
  const spec = isRecord(hero) && finite(hero.integrity) ? heroSpec(state, id, { content, rules }) : null;
  if (spec && spec.integrity < spec.maxIntegrity) return 'Tired';
  return 'Rested';
}

/**
 * The Setting out panel (§7.5): who can go, how warm they are, whether a Wayfarer comes in person
 * or sends a likeness (a session title only, never a message), the regulars' room and the settings.
 */
export function musterView(state, { content, rules, snapshot = null, now = 0, destination = null } = {}) {
  const cat = catalog(content);
  const party = partyOf(state);
  const chosen = Array.isArray(party.chosen) ? party.chosen : [];
  const members = [];
  for (const id of rosterIds(state)) {
    if (id === 'milo') continue;
    const comp = own(cat.companions, id);
    const regular = id.startsWith('reg-') ? regularOf(state, id) : null;
    if (!isRecord(comp) && !regular) continue;
    const member = memberOf(state, id);
    let likeness = null;
    if (likenessOf(id, snapshot)) {
      const title = busyTitle(snapshot, id);
      const what = title ? ` on ‘${title}’` : '';
      likeness = `${CREW_NAME[id]} is working${what}. ${PRONOUN[comp.pronoun] || 'Their'} likeness will go.`;
    }
    members.push({
      id,
      name: displayName(cat, state, id),
      calling: regular ? regular.calling : comp.calling,
      level: fightingLevel(state, id, rules),
      warmth: whole(member.warmth, 0, MAX_WARMTH),
      warmthStep: warmthStep(member.warmth),
      fieldSkill: comp?.fieldSkill ?? null,
      sync: syncOf(member.notebook.accepts),
      mood: moodOf(state, id, { content, rules }),
      likeness,
      chosen: chosen.includes(id),
    });
  }
  return {
    canSwap: !battleLive(state) && !insideElsewhere(state),
    room: { used: regularsOf(state).length, max: rules.road.regulars?.[tierId(state, rules)] ?? 0 },
    members,
    suggestion: suggestParty(state, destination, { content }),
    formation: FORMATIONS.includes(party.formation) ? party.formation : 'line',
    mode: MODES.includes(party.mode) ? party.mode : 'long-road',
    play: PLAYS.includes(party.play) ? party.play : 'guided',
    calm: isRecord(party.calm) ? { ...party.calm } : { noise: true, adaptation: true, odds: 'bars', fastFoes: true, playback: 1, ghosts: false },
  };
}

function genreName(cat, genre) {
  const entry = cat.genres.find((g) => g.id === genre);
  if (entry?.name) return entry.name;
  if (genre === 'kaiju') return 'Titan';
  return typeof genre === 'string' && genre ? genre[0].toUpperCase() + genre.slice(1) : '';
}

const sentence = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * Milo's local suggestion for a destination ({ kind, genres: string[], mechanic: leads.json id | null }):
 * whoever wants the rift's mechanic, then its genre, then whoever went last time, then the warmest.
 * 'Noir rift with herrings to sort. Jev will want this one.'
 */
export function suggestParty(state, destination, { content } = {}) {
  const cat = catalog(content);
  const party = partyOf(state);
  const chosen = Array.isArray(party.chosen) ? party.chosen : [];
  const genres = Array.isArray(destination?.genres) ? destination.genres : [];
  const mechanic = typeof destination?.mechanic === 'string' ? destination.mechanic : null;
  const candidates = rosterIds(state).filter((id) => id !== 'milo' && (isRecord(own(cat.companions, id)) || regularOf(state, id)));
  const scored = candidates.map((id, order) => {
    const wants = own(cat.companions, id)?.wants;
    const byMechanic = Boolean(mechanic && wants?.mechanic === mechanic);
    const byGenre = genres.some((g) => wants?.genres?.includes(g) || regularOf(state, id)?.genre === g);
    const score = (byMechanic ? 4 : 0) + (byGenre ? 2 : 0) + (chosen.includes(id) ? 1 : 0) + whole(memberOf(state, id).warmth, 0, MAX_WARMTH) / 2000;
    return { id, order, score, byMechanic, byGenre, wants };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const ids = scored.slice(0, MAX_CHOSEN).map((s) => s.id);
  const top = scored[0];
  const where = genres.length ? `${genreName(cat, genres[0])} rift` : destination?.kind === 'cave' ? 'a cave' : '';
  let words;
  if (top && top.byMechanic && where) words = `${where} with ${top.wants.phrase}. ${sentence(displayName(cat, state, top.id))} will want this one.`;
  else if (top && top.byGenre && where) words = `${where}. ${sentence(displayName(cat, state, top.id))} will want this one.`;
  else if (chosen.length && chosen.every((id) => ids.includes(id))) words = 'Same as last time.';
  else words = 'A steady party for the road.';
  return { ids, words: sentence(words) };
}

/** Picks who goes out with Milo (up to three, from the roster, never Milo). The same state while a fight is live. */
export function choose(state, ids, now) {
  if (!isRecord(state) || battleLive(state) || !Array.isArray(ids)) return state;
  const next = [];
  for (const id of ids) {
    if (typeof id === 'string' && id !== 'milo' && inRoster(state, id) && !next.includes(id)) next.push(id);
    if (next.length === MAX_CHOSEN) break;
  }
  const current = Array.isArray(partyOf(state).chosen) ? partyOf(state).chosen : [];
  if (next.length === current.length && next.every((id, i) => current[i] === id)) return state;
  const picked = withParty(state, { chosen: next });
  // Whoever's benched rests in the lantern-light: their outing entry goes, so it can't crowd out the newest.
  const { heroes } = outingOf(state);
  const kept = outOnly(picked, heroes);
  return Object.keys(kept).length === Object.keys(heroes).length ? picked : withParty(picked, { outing: { ...outingOf(state), heroes: kept } });
}

/**
 * A companion joins the roster: the founders always, the Tollkeeper by his trail, and from Phase 6 anyone at camp whose moves are written (company.js).
 * Joining records the trail through E's `trail.markJoined`, its one writer (§18.2 item 13), from `content.trails` or E's own table.
 */
export function recruit(state, id, now, { content = null } = {}) {
  if (!isRecord(state) || typeof id !== 'string' || inRoster(state, id)) return state;
  const comp = content ? own(catalog(content).companions, id) : null;
  if (content ? !(isRecord(comp) && comp.joins?.phase <= FIGHTING_PHASE && movesReady(comp)) : !PHASE4_COMPANIONS.includes(id)) return state;
  const next = withParty(state, { roster: { ...rosterOf(state), [id]: emptyMember(stamp(now)) } });
  return markJoined(next, isRecord(content) ? content : null, id, now);
}

// ---------------------------------------------------------------------------
// Regulars

const fightsIn = (genre, cat) => {
  const entry = cat?.genres?.find?.((g) => g.id === genre);
  if (entry && typeof entry.kind === 'string') return entry.kind === 'shadow';
  return typeof genre === 'string' && !NO_FIGHT.includes(genre);
};

/** The stray index §4.6's order picks (shy, polite, sleepy, … dramatic; ties to the lower index), or null. */
export function gentlestStray(spec, { genres = null } = {}) {
  const cat = genres ? { genres: Array.isArray(genres.genres) ? genres.genres : genres } : null;
  let best = null;
  let rank = Infinity;
  (Array.isArray(spec?.strays) ? spec.strays : []).forEach((stray, i) => {
    if (!isRecord(stray) || !fightsIn(stray.genre, cat)) return;
    const r = GENTLE.indexOf(stray.temperament);
    if (r >= 0 && r < rank) { rank = r; best = i; }
  });
  return best;
}

const regularId = (seed, index) => `reg-${hashInts(whole(seed, 0, 0xffffffff), index, 'regular').toString(36)}`;
const mechanicId = (cat, text) => (Array.isArray(cat.leads?.mechanics) ? cat.leads.mechanics : []).find((m) => m.text === text)?.id ?? null;

// inviteRegular's words when nobody asks: no stray here fights (or none was named), or that one's already home.
const NOBODY = 'Nobody here is asking to stay.';
const ALREADY = 'They’re already by the fire.';

/**
 * The rift's gentlest stray, or a Tale-lead who bowed, asks to sit by the fire (§2.4). Nothing to
 * remember: every stitch and bow asks again, unless that stray already joined (same riftSeed and
 * index) or there's no room, which says "Another time, then." `rift` is the rift record or its
 * riftgen spec (§18.2 item 7: `rift.spec ?? rift`). → { state, ok, words, regular }
 */
export function inviteRegular(state, { rift: given, stray = null, lead = false } = {}, now, { content, rules } = {}) {
  const cat = catalog(content);
  const file = cat.regulars;
  const no = (words) => ({ state, ok: false, words, regular: null });
  const rift = isRecord(given) && isRecord(given.spec) ? given.spec : given;
  if (!isRecord(state) || !isRecord(rift)) return no(NOBODY);
  const strays = Array.isArray(rift.strays) ? rift.strays : [];
  let source;
  let index;
  if (lead) {
    const tale = rift.taleLead;
    if (!isRecord(tale) || !fightsIn(tale.genre, cat)) return no(NOBODY);
    index = 'lead';
    const kin = strays.find((s) => isRecord(s) && s.genre === tale.genre) || strays[0] || {};
    // The name the fight showed (COMBAT §8.3 Names, §5.2): clear of the company's names unless hooked.
    // Its temperament is the one D's leadUnit fought with (riftgen's taleLead has none), so it idles as it did.
    const hooks = (Array.isArray(cat.leads?.hooks) ? cat.leads.hooks : []).map((h) => h?.name).filter((h) => typeof h === 'string');
    source = { name: leadDisplayName(rift, cat.words, { hooks }), genre: tale.genre, second: null, archetype: kin.archetype || 'walker', bodyKey: kin.bodyKey, parts: kin.parts,
      eyeKey: kin.eyeKey, temperament: TEMPERAMENTS[hashInts(rift.seed >>> 0, 'lead') % TEMPERAMENTS.length] };
  } else {
    index = finite(stray) ? Math.floor(stray) : gentlestStray(rift, { genres: cat.genres });
    source = strays[index];
    if (!isRecord(source) || !fightsIn(source.genre, cat)) return no(NOBODY);
  }
  const id = regularId(rift.seed, index);
  if (regularsOf(state).some((r) => r?.id === id)) return no(ALREADY);
  const room = rules.road.regulars?.[tierId(state, rules)] ?? 0;
  if (regularsOf(state).length >= Math.min(room, MAX_REGULARS)) return no((file.noRoom || ['Another time, then.'])[0]);
  const archetype = file.callingByArchetype?.[source.archetype] ? source.archetype : 'walker';
  const regular = {
    id,
    riftId: [given.id, rift.id].find((v) => typeof v === 'string') ?? null,
    riftSeed: whole(rift.seed, 0, 0xffffffff),
    name: typeof source.name === 'string' && source.name.trim() ? clipName(source.name) : 'A stray',
    genre: source.genre,
    second: typeof source.second === 'string' ? source.second : null,
    archetype,
    bodyKey: typeof source.bodyKey === 'string' ? source.bodyKey : 'r',
    // Any part straygen draws (its ids are camelCase: batWings, jetFlame), at most A's cap (§18.2 item 7).
    parts: (Array.isArray(source.parts) ? source.parts : []).filter((p) => typeof p?.id === 'string' && Object.hasOwn(PARTS, p.id)).slice(0, STATE4_LIMITS.parts).map((p) => ({ id: p.id, layer: p.layer === 1 ? 1 : 0 })),
    eyeKey: typeof source.eyeKey === 'string' ? source.eyeKey : null,
    temperament: GENTLE.includes(source.temperament) ? source.temperament : 'shy',
    calling: file.callingByArchetype?.[archetype] || 'chorister',
    lead: Boolean(lead),
    mechanic: lead ? mechanicId(cat, rift.taleLead?.mechanic) : null,
    joinedAt: stamp(now),
  };
  const next = withParty(state, {
    regulars: [...regularsOf(state), regular],
    roster: { ...rosterOf(state), [id]: emptyMember(stamp(now)) },
  });
  return { state: next, ok: true, words: (file.ask || ['Can I sit by the fire a while?'])[0], regular };
}

// ---------------------------------------------------------------------------
// Rewards

const perWeight = (rules, n) => {
  const table = rules.road.perWeight;
  const level = Math.max(1, Math.floor(n || 1));
  return level <= table.length ? table[level - 1] : table[table.length - 1] + (rules.road.past12 ?? 60) * (level - table.length);
};

function levelsOf(state, rules) {
  const out = {};
  for (const id of rosterIds(state)) out[id] = fightingLevel(state, id, rules);
  return out;
}

function levelUpsBetween(before, after) {
  return Object.keys(after).filter((id) => after[id] > (before[id] ?? after[id]));
}

function withRoad(state, patch) {
  return { ...state, road: { ...(isRecord(state.road) ? state.road : {}), ...patch } };
}

function paidKeys(state) {
  return isRecord(state?.road?.paidFights) ? state.road.paidFights : {};
}

/**
 * Road XP (and Warding, the same amount) for everyone on the roster, out or not. `addXp` pays
 * nothing for a missing `now`, so it gets `clock(now)`: the key is marked paid either way, and a
 * missing `now` counts as the epoch here as everywhere else, never as a reason to lose the XP.
 */
function payRoad(state, xp, now, { source, text }) {
  if (!xp) return state;
  let next = withRoad(state, { xp: whole(state?.road?.xp) + xp });
  next = addXp(next, 'warding', xp, clock(now), { source, text }).state;
  return next;
}

/**
 * Pays a fight room once per fight id (§4.13): Road XP = weight × the table at n (+45 a weight per
 * deep rank), Marks = 4 × weight × n, both ×1.25 for a bow and floored once (a lead's room
 * weighs 8, 10 or 12, as its Rewards say);
 * then the room's essences, relic and tonics. `offline` and `home` pay nothing; auto modes pay in full.
 */
export function payFight(state, fightId, rewards, result, now, { rules } = {}) {
  const none = { state, paid: false, xp: 0, marks: 0, loot: null, levelUps: [] };
  if (!isRecord(state) || typeof fightId !== 'string' || !fightId || !isRecord(rewards) || !isRecord(result)) return none;
  if (!PAYING.has(result.outcome) || Object.hasOwn(paidKeys(state), fightId)) return none;
  const weight = finite(rewards.weight) && rewards.weight > 0 ? rewards.weight : 0;
  const n = Math.max(1, Math.floor(rewards.n || 1));
  const deep = whole(rewards.deepRank, 0, 99);
  const bow = result.bow === true || result.outcome === 'bowed' ? rules.lead?.bow ?? 1.25 : 1;
  const xp = Math.floor(weight * (perWeight(rules, n) + (rules.road.deep ?? 45) * deep) * bow);
  const marks = Math.floor((rules.rewards?.marks ?? 4) * weight * n * bow);
  const before = levelsOf(state, rules);
  let next = withRoad(state, { paidFights: { ...paidKeys(state), [fightId]: stamp(now) } });
  next = payRoad(next, xp, now, { source: 'fight', text: 'a room settled' });
  const loot = { essences: [], relic: null, tonics: { cordial: 0, brew: 0 } };
  const satchel = isRecord(next.satchel) ? next.satchel : {};
  const essences = { ...(isRecord(satchel.essences) ? satchel.essences : {}) };
  const essenceGenres = { ...(isRecord(satchel.essenceGenres) ? satchel.essenceGenres : {}) };
  for (const e of Array.isArray(rewards.essences) ? rewards.essences : []) {
    if (!isRecord(e) || typeof e.name !== 'string' || !e.name || !whole(e.qty)) continue;
    essences[e.name] = whole(essences[e.name]) + whole(e.qty);
    if (typeof e.genre === 'string') essenceGenres[e.name] = e.genre;
    loot.essences.push({ name: e.name, genre: e.genre ?? null, qty: whole(e.qty) });
  }
  const relics = Array.isArray(satchel.relics) ? [...satchel.relics] : [];
  if (isRecord(rewards.relic) && typeof rewards.relic.name === 'string' && rewards.relic.name) {
    loot.relic = { name: rewards.relic.name, genre: rewards.relic.genre ?? null };
    relics.push({ name: clip(rewards.relic.name, 80), text: 'Brought home from a fight in an Elsewhere.', genre: rewards.relic.genre ?? null, at: stamp(now) });
  }
  const tonics = isRecord(satchel.tonics) ? satchel.tonics : {};
  const add = isRecord(rewards.tonics) ? rewards.tonics : {};
  loot.tonics = { cordial: whole(add.cordial), brew: whole(add.brew) };
  next = {
    ...next,
    satchel: {
      ...satchel,
      essences,
      essenceGenres,
      relics,
      marks: Math.min(MAX_MARKS, whole(satchel.marks) + marks),
      tonics: { ...tonics, cordial: Math.min(MAX_TONICS, whole(tonics.cordial) + loot.tonics.cordial), brew: Math.min(MAX_TONICS, whole(tonics.brew) + loot.tonics.brew) },
    },
  };
  return { state: next, paid: true, xp, marks, loot, levelUps: levelUpsBetween(before, levelsOf(next, rules)) };
}

function seamRates(xp) {
  const out = { ...SEAMCRAFT };
  for (const entry of Array.isArray(xp?.sources) ? xp.sources : Array.isArray(xp) ? xp : []) {
    if (isRecord(entry) && Object.hasOwn(out, entry.id) && finite(entry.xp)) out[entry.id] = entry.xp;
  }
  return out;
}

/** A wild stitch (§4.13): 4 weights at the rift's n in Road XP and Warding, and Seamcraft 300 + 30 × depth; its key pays once. */
export function payStitch(state, { kind = 'wild', level = 1, depth = 1, key } = {}, now, { rules, xp: rates = null } = {}) {
  if (!isRecord(state) || kind !== 'wild' || typeof key !== 'string' || !key || Object.hasOwn(paidKeys(state), key)) {
    return { state, paid: false, xp: 0 };
  }
  const xp = Math.floor((rules.road.wildStitch ?? 4) * perWeight(rules, level));
  const seam = seamRates(rates);
  let next = withRoad(state, { paidFights: { ...paidKeys(state), [key]: stamp(now) } });
  next = payRoad(next, xp, now, { source: 'stitch', text: 'a wild rift stitched' });
  next = addXp(next, 'seamcraft', seam['wild-stitch'] + seam['wild-stitch-depth'] * whole(depth, 1), clock(now), { source: 'wild-stitch', text: 'a wild rift stitched' }).state;
  return { state: next, paid: true, xp };
}

/**
 * Real rifts stitched (§4.13): 8 weights at the Road level each, with Warding and Seamcraft 500,
 * from the `road.stitchedThrough` high-water mark on rifts.stitched.real. The first look seeds the
 * mark and pays nothing. → { state, paid: number }
 */
export function payRealStitches(state, now, { rules, xp: rates = null } = {}) {
  if (!isRecord(state)) return { state, paid: 0 };
  const count = whole(state?.rifts?.stitched?.real);
  const through = state?.road?.stitchedThrough;
  if (!finite(through)) return { state: withRoad(state, { stitchedThrough: count }), paid: 0 };
  if (count <= through) return { state, paid: 0 };
  const paid = count - through;
  const road = roadLevel(state, rules).level;
  const xp = Math.floor(paid * (rules.road.realStitch ?? 8) * perWeight(rules, road));
  const seam = seamRates(rates);
  let next = withRoad(state, { stitchedThrough: count });
  next = payRoad(next, xp, now, { source: 'real-stitch', text: paid === 1 ? 'a real rift stitched' : `${paid} real rifts stitched` });
  next = addXp(next, 'seamcraft', seam['real-stitch'] * paid, clock(now), { source: 'real-stitch', text: 'a real rift stitched' }).state;
  return { state: next, paid };
}

// ---------------------------------------------------------------------------
// Rests

/**
 * An outing hero exactly as §8.3 keeps it: `{ integrity, charges, uses, rattled }`, and never
 * without `charges` (§18.2 item 8: A's cleaner reads a missing count as 0, not full). Every write
 * of `outing.heroes[id]` goes through here. `uses` holds only what's been spent (a missing use is full).
 */
function outingHero({ integrity, charges, uses, rattled }) {
  const kept = {};
  for (const [aid, n] of Object.entries(isRecord(uses) ? uses : {})) if (finite(n)) kept[aid] = whole(n, 0, 99);
  return { integrity: whole(integrity, 0, 1e4), charges: whole(charges, 0, 100), uses: kept, rattled: rattled === true };
}

/**
 * A Breather for one hero (from its spec, which reads the outing): half of max back (rounded down,
 * at least 1), per-Breather uses and pact charges back, Rattled gone.
 */
function breatheHero(hero, spec, lookup) {
  const max = spec.maxIntegrity;
  const uses = { ...(isRecord(hero.uses) ? hero.uses : {}) };
  for (const aid of Object.keys(uses)) if (lookup(aid)?.uses?.per === 'breather') delete uses[aid];
  return outingHero({
    integrity: Math.min(max, spec.integrity + Math.max(1, Math.floor(max * 0.5))),
    charges: spec.charges.pool === 'pact' ? spec.charges.max : spec.charges.left,
    uses,
    rattled: false,
  });
}

/** Turn back a page: once a Campfire (twice from 7), a Breather also brings back half the level in charges. */
function turnBackAPage(hero, spec) {
  if (!spec.abilityIds.includes('turn-back-a-page')) return hero;
  const left = spec.uses['turn-back-a-page'] ?? 0;
  if (left <= 0 || hero.charges >= spec.charges.max) return hero;
  return outingHero({
    ...hero,
    charges: Math.min(spec.charges.max, hero.charges + Math.floor(spec.level / 2)),
    uses: { ...hero.uses, 'turn-back-a-page': left - 1 },
  });
}

function outHeroes(state) {
  return ['milo', ...(Array.isArray(partyOf(state).chosen) ? partyOf(state).chosen : [])];
}

/** Only who's out keeps an entry, Milo then party.chosen: A keeps four, so a swap never loses the newest. */
function outOnly(state, heroes) {
  const kept = {};
  for (const id of outHeroes(state)) if (isRecord(own(heroes, id))) kept[id] = heroes[id];
  return kept;
}

function breatheAll(state, { content, rules }) {
  const outing = outingOf(state);
  const heroes = { ...outing.heroes };
  const cat = catalog(content);
  const lookup = abilityLookup(null, cat);
  for (const id of outHeroes(state)) {
    // Someone who can't take the field (no spec) has nothing to rest, and their entry is left alone.
    const spec = heroSpec(state, id, { content, rules });
    if (!spec) continue;
    heroes[id] = turnBackAPage(breatheHero(isRecord(heroes[id]) ? heroes[id] : {}, spec, lookup), spec);
  }
  return outOnly(state, heroes);
}

/**
 * A rest needs the content and the rules: without them nobody's per-Breather uses, pact charges or
 * Turn back a page could come back, so a missing one is a caller's mistake, and says so loudly.
 */
function needsContent(step, content, rules) {
  if (!isRecord(content) || !isRecord(content.combat?.callings) || !isRecord(rules) || !isRecord(rules.road)) {
    throw new TypeError(`party.${step} needs { content, rules }: the content bundle and the loaded combat rules`);
  }
}

const WAITS = 'They’ll sit down for a bit once this fight ends.';

/**
 * A Breather (§4.18): at most one per fight, up to 3 / 2 / 1 per Campfire by mode, a lantern rest
 * counting toward that limit. A free one (a focus session finished while out) never counts, and
 * waits for `afterFight` while a fight is live. `content` is required as well as `rules` (it throws
 * without them). → { state, ok, reason }
 */
export function breather(state, now, { rules, content, free = false, fightId = null, where = 'victory' } = {}) {
  needsContent('breather', content, rules);
  if (!isRecord(state)) return { state, ok: false, reason: 'Nothing to rest yet.' };
  const outing = outingOf(state);
  if (battleLive(state)) {
    if (!free) return { state, ok: false, reason: 'Not while a fight is on.' };
    if (outing.freeBreather) return { state, ok: true, reason: WAITS };
    return { state: withParty(state, { outing: { ...outing, freeBreather: true } }), ok: true, reason: WAITS };
  }
  const party = partyOf(state);
  if (!free) {
    if (where === 'victory' && fightId && outing.breatherFight === fightId) return { state, ok: false, reason: 'You’ve had a Breather after this fight.' };
    const limit = rules.modes?.[MODES.includes(party.mode) ? party.mode : 'long-road']?.breathers ?? 2;
    if (whole(outing.breathers) >= limit) return { state, ok: false, reason: 'No Breathers left until the next Campfire.' };
  }
  const heroes = breatheAll(state, { content, rules });
  const nextOuting = {
    ...outing,
    heroes,
    breathers: free ? whole(outing.breathers) : whole(outing.breathers) + 1,
    breatherFight: !free && where === 'victory' && fightId ? fightId : outing.breatherFight,
  };
  return { state: withParty(state, { outing: nextOuting }), ok: true, reason: null };
}

/**
 * A Campfire (§4.18): everything returns and a new outing starts. Free at the muster and at home;
 * at a lit lantern outside any Elsewhere once a real day; at an Elsewhere's hearth-nook once each.
 */
export function campfire(state, now, { where = 'muster', lanternId = null, riftId = null } = {}) {
  if (!isRecord(state)) return { state, ok: false, reason: 'Nothing to rest yet.' };
  if (battleLive(state)) return { state, ok: false, reason: 'Not while a fight is on.' };
  const party = partyOf(state);
  const rests = isRecord(party.rests) ? party.rests : { lanternDay: null, nooks: {}, freeReentry: {} };
  let nextRests = rests;
  let expedition = state.expedition;
  if (where === 'lantern') {
    if (insideElsewhere(state)) return { state, ok: false, reason: 'A lantern Campfire waits until you’re back outside.' };
    if (rests.lanternDay === dayOf(now)) return { state, ok: false, reason: 'You’ve had a lantern Campfire today. Home’s fire is always free.' };
    nextRests = { ...rests, lanternDay: dayOf(now) };
  } else if (where === 'nook') {
    if (typeof riftId !== 'string' || !riftId) return { state, ok: false, reason: 'There’s no nook here.' };
    const nooks = isRecord(rests.nooks) ? rests.nooks : {};
    if (Object.hasOwn(nooks, riftId)) return { state, ok: false, reason: 'This Elsewhere’s nook has had its Campfire.' };
    nextRests = { ...rests, nooks: { ...nooks, [riftId]: stamp(now) } };
    if (isRecord(expedition) && expedition.riftId === riftId) expedition = { ...expedition, nookUsed: true };
  } else if (where !== 'muster' && where !== 'home') {
    return { state, ok: false, reason: 'A Campfire needs a fire.' };
  }
  const roster = {};
  for (const [id, m] of Object.entries(rosterOf(state))) {
    const kept = isRecord(m) && isRecord(m.notebook) && (m.notebook.previous != null || m.notebook.previousMeta != null);
    roster[id] = kept ? { ...m, notebook: { ...m.notebook, previous: null, previousMeta: null } } : m;
  }
  const next = { ...withParty(state, { roster, rests: nextRests, outing: { ...emptyOuting(), startedAt: stamp(now) } }), ...(expedition !== state.expedition ? { expedition } : {}) };
  return { state: next, ok: true, reason: null };
}

const unitsOf = (battle) => (Array.isArray(battle?.units) ? battle.units : []);
const heroUnits = (battle) => unitsOf(battle).filter((u) => isRecord(u) && u.side === 'party' && u.rank === 'hero');

/**
 * After every fight (§4.18): heroes top up to half (rounded up; Offline ones come back at half),
 * a waiting free Breather is applied, what's carried goes back to the satchel and gifts, Cheers
 * follow the fight's, the outing's warmth is paid once (the weekly cap) and the first win gives a
 * Cheer. Once-a-fight uses are dropped: they come back at the fight's end (§6.3).
 *
 * Order: call it with the state the fight began from, before payFight adds the room's loot to the
 * satchel. It writes back what Milo still carries as the satchel's tonics, and it counts a Weaver's
 * burnt essences against what that Weaver carried in, so loot already in the satchel would be lost
 * or miscounted. `content` and `rules` are required (it throws without them): a waiting free
 * Breather brings back per-Breather uses, pact charges and Turn back a page.
 */
export function afterFight(state, battle, result, now, { content, rules } = {}) {
  needsContent('afterFight', content, rules);
  if (!isRecord(state) || !isRecord(battle)) return state;
  const lookup = abilityLookup(null, catalog(content));
  const outing = outingOf(state);
  const heroes = { ...outing.heroes };
  let next = state;
  for (const unit of heroUnits(battle)) {
    const max = Math.max(1, whole(unit.maxIntegrity, 1, 1e4));
    const half = Math.ceil(max / 2);
    const uses = {};
    for (const [aid, n] of Object.entries(isRecord(unit.uses) ? unit.uses : {})) {
      if (finite(n) && lookup(aid)?.uses?.per !== 'fight') uses[aid] = whole(n, 0, 99);
    }
    heroes[unit.id] = outingHero({
      integrity: unit.offline ? half : Math.min(max, Math.max(half, whole(unit.integrity))),
      charges: unit.charges?.left ?? unit.chargesLeft,
      uses,
      rattled: unit.rattled === true,
    });
  }
  let nextOuting = { ...outing, heroes: outOnly(state, heroes) };
  next = withParty(next, { outing: nextOuting });
  if (nextOuting.freeBreather) {
    nextOuting = { ...nextOuting, freeBreather: false };
    next = withParty(next, { outing: nextOuting });
    nextOuting = { ...nextOuting, heroes: breatheAll(next, { content, rules }) };
    next = withParty(next, { outing: nextOuting });
  }

  // What was carried goes back: the party's tonics (Milo), Margin Notes (the Scribe), Spare Parts
  // (the Artificer), and any essences a Weaver burnt come off the satchel.
  const satchel = isRecord(next.satchel) ? next.satchel : {};
  const milo = heroUnits(battle).find((u) => u.id === 'milo');
  let nextSatchel = satchel;
  if (isRecord(milo?.carry)) {
    const tonics = isRecord(satchel.tonics) ? satchel.tonics : {};
    nextSatchel = { ...nextSatchel, tonics: { ...tonics, cordial: whole(milo.carry.cordial, 0, MAX_TONICS), brew: whole(milo.carry.brew, 0, MAX_TONICS) } };
  }
  // Each Weaver carried in its share of the satchel (weaverEssences); what it no longer carries was burnt.
  const weavers = heroUnits(battle).filter((u) => u.calling === 'weaver' && isRecord(u.carry));
  const burnt = weavers.reduce((sum, u) => {
    const carried = heroSpec(state, u.id, { content, rules })?.carry.essences ?? 0;
    return sum + Math.max(0, carried - whole(u.carry.essences));
  }, 0);
  if (burnt > 0) {
    const essences = { ...(isRecord(satchel.essences) ? satchel.essences : {}) };
    let left = burnt;
    for (const name of Object.keys(essences).sort()) {
      if (!left) break;
      const take = Math.min(left, whole(essences[name]));
      essences[name] = whole(essences[name]) - take;
      left -= take;
      if (!essences[name]) delete essences[name];
    }
    nextSatchel = { ...nextSatchel, essences };
  }
  if (nextSatchel !== satchel) next = { ...next, satchel: nextSatchel };
  for (const unit of heroUnits(battle)) {
    if (unit.id === 'claude' && finite(unit.carry?.margin)) next = withMember(next, 'claude', (m) => ({ ...m, gifts: { ...m.gifts, margin: whole(unit.carry.margin, 0, MAX_GIFTS) } }));
    if (unit.id === 'codex' && finite(unit.carry?.spare)) next = withMember(next, 'codex', (m) => ({ ...m, gifts: { ...m.gifts, spare: whole(unit.carry.spare, 0, MAX_GIFTS) } }));
  }

  if (finite(battle.cheers)) next = withParty(next, { cheers: whole(battle.cheers, 0, 4) });
  if (battle.kind === 'lead' || battle.kind === 'field' || battle.lead) next = withParty(next, { firstLeadMet: true });
  if (!outingOf(next).warmed) {
    for (const id of partyOf(next).chosen || []) if (id !== 'milo') next = addWarmth(next, id, 2, 'outing', now);
    next = withParty(next, { outing: { ...outingOf(next), warmed: true } });
  }
  if (PAYING.has(result?.outcome) && next.road?.firstWin !== true) {
    next = addCheer(withRoad(next, { firstWin: true }), 1, now);
  }
  return next;
}

/**
 * Everyone offline (§4.18): full Integrity at wilds.wake with everything found, and going back in
 * is free once. Charges, uses and Rattled stay (nothing is spent or lost), in §8.3's four keys.
 * With `{ content, rules }` an entry records the hero's max Integrity; without them 0, which
 * heroSpec reads as full (as A's cleaner keeps a missing count), so the wake reads the same.
 */
export function wake(state, now, { content = null, rules = null } = {}) {
  if (!isRecord(state)) return state;
  const outing = outingOf(state);
  // The place to go back into: the rift, or (a cave's, with no rift) the expedition's own key.
  const place = [state.expedition?.riftId, state.expedition?.key].find((k) => typeof k === 'string' && k);
  const rests = isRecord(partyOf(state).rests) ? partyOf(state).rests : {};
  const free = isRecord(rests.freeReentry) ? rests.freeReentry : {};
  const heroes = {};
  const out = outOnly(state, outing.heroes);
  let dozing = Object.keys(out).length !== Object.keys(outing.heroes).length;
  for (const [id, hero] of Object.entries(out)) {
    const full = isRecord(content) && isRecord(rules) ? heroSpec(state, id, { content, rules })?.maxIntegrity ?? 0 : 0;
    const woke = outingHero({ ...hero, integrity: full });
    heroes[id] = JSON.stringify(hero) === JSON.stringify(woke) ? hero : woke;
    if (heroes[id] !== hero) dozing = true;
  }
  // Already awake with the way back in granted: the same state (§2), and a grant keeps its first time.
  let next = dozing ? withParty(state, { outing: { ...outing, heroes } }) : state;
  if (place && !Object.hasOwn(free, place)) next = withParty(next, { rests: { ...rests, freeReentry: { ...free, [place]: stamp(now) } } });
  return next;
}

// ---------------------------------------------------------------------------
// Cheers and warmth

/** Adds Cheers, up to 4 held. */
export function addCheer(state, n, now) {
  if (!isRecord(state) || !finite(n) || n <= 0) return state;
  const cheers = whole(partyOf(state).cheers, 0, 4);
  const next = Math.min(4, cheers + Math.floor(n));
  return next === cheers ? state : withParty(state, { cheers: next });
}

/**
 * Warmth only rises, and never notifies (§4.19): an outing pays +2 at most +6 a local-Monday week;
 * a habit pays +1 on a local day it happens. Callers: afterFight and topUpCrewGifts only.
 */
export function addWarmth(state, id, n, source, now) {
  if (!isRecord(state) || id === 'milo' || !inRoster(state, id) || !finite(n) || n <= 0) return state;
  return withMember(state, id, (m) => {
    const warmth = whole(m.warmth, 0, MAX_WARMTH);
    if (source === 'outing') {
      const week = weekOf(now);
      const used = m.warmthWeek.week === week ? whole(m.warmthWeek.outing, 0, 6) : 0;
      const gain = Math.min(Math.floor(n), 6 - used, MAX_WARMTH - warmth);
      if (gain <= 0) return m;
      return { ...m, warmth: warmth + gain, warmthWeek: { ...m.warmthWeek, week, outing: used + gain } };
    }
    if (source === 'habit') {
      const day = dayOf(now);
      if (m.habitDay === day) return m;
      const gain = Math.min(1, MAX_WARMTH - warmth);
      return gain > 0 ? { ...m, warmth: warmth + gain, habitDay: day } : m;
    }
    return m;
  });
}

/**
 * Margin Notes (the Scribe) and Spare Parts (the Artificer), one per session watched to the end,
 * up to 3 held, from a high-water mark on tally.byCrew (the first look only seeds it); and each
 * companion's habit warmth: the Scribe when byCrew.claude rose, the Artificer for codex, the
 * Tollkeeper when a feature was first tried today.
 */
export function topUpCrewGifts(state, now) {
  if (!isRecord(state)) return state;
  let next = state;
  for (const [id, kind] of [['claude', 'margin'], ['codex', 'spare']]) {
    const pieces = whole(state?.tally?.byCrew?.[id]);
    const member = memberOf(next, id);
    const through = member.gifts.through;
    if (!finite(through)) {
      next = withMember(next, id, (m) => ({ ...m, gifts: { ...m.gifts, through: pieces } }));
      continue;
    }
    if (pieces <= through) continue;
    next = withMember(next, id, (m) => ({ ...m, gifts: { ...m.gifts, [kind]: Math.min(MAX_GIFTS, whole(m.gifts[kind]) + pieces - through), through: pieces } }));
    next = addWarmth(next, id, 1, 'habit', now);
  }
  if (inRoster(next, 'tollkeeper')) {
    const features = isRecord(state?.tally?.features) ? state.tally.features : {};
    const today = dayOf(now);
    if (Object.values(features).some((at) => finite(at) && dayNumber(at) === today)) next = addWarmth(next, 'tollkeeper', 1, 'habit', now);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Settings

export function setControl(state, id, control, now) {
  if (!isRecord(state) || !inRoster(state, id) || !CONTROLS.includes(control)) return state;
  return withMember(state, id, (m) => (m.control === control ? m : { ...m, control }));
}

export function setReaction(state, id, reactionId, setting, now) {
  if (!isRecord(state) || !inRoster(state, id) || !isSlug(reactionId) || !SETTINGS.includes(setting)) return state;
  return withMember(state, id, (m) => (m.reactions[reactionId] === setting ? m : { ...m, reactions: { ...m.reactions, [reactionId]: setting } }));
}

/** 'line' | 'pairs' | 'loose' | 'wedge' (Wedge from Warding 5). */
export function setFormation(state, formation, now) {
  if (!isRecord(state) || !FORMATIONS.includes(formation) || partyOf(state).formation === formation) return state;
  if (formation === 'wedge' && wardingLevel(state) < WARDING_WEDGE) return state;
  return withParty(state, { formation });
}

export function setMode(state, mode, now) {
  if (!isRecord(state) || !MODES.includes(mode) || partyOf(state).mode === mode) return state;
  return withParty(state, { mode });
}

export function setPlay(state, play, now) {
  if (!isRecord(state) || !PLAYS.includes(play) || partyOf(state).play === play) return state;
  return withParty(state, { play });
}

const CALM_KEYS = Object.freeze({ noise: 'bool', adaptation: 'bool', odds: ['bars', 'words'], fastFoes: 'bool', playback: [1, 2, 4], ghosts: 'bool' });

export function setCalm(state, patch, now) {
  if (!isRecord(state) || !isRecord(patch)) return state;
  const calm = isRecord(partyOf(state).calm) ? partyOf(state).calm : {};
  const next = { ...calm };
  let changed = false;
  for (const [key, kind] of Object.entries(CALM_KEYS)) {
    if (!Object.hasOwn(patch, key)) continue;
    const v = patch[key];
    if (kind === 'bool' ? typeof v !== 'boolean' : !kind.includes(v)) continue;
    if (next[key] !== v) { next[key] = v; changed = true; }
  }
  return changed ? withParty(state, { calm: next }) : state;
}

/** Playbook rules per companion: 1, 3 from Warding 15, 6 from Warding 50 (§4.21). */
export function maxRules(state) {
  const level = wardingLevel(state);
  return WARDING_RULES.find(([at]) => level >= at)[1];
}

/** Sets a companion's playbook rules; refuses past maxRules (the same state). Allowed between rounds. */
export function setRules(state, id, rules, now) {
  if (!isRecord(state) || !inRoster(state, id) || !Array.isArray(rules) || rules.length > maxRules(state)) return state;
  const clean = [];
  for (const rule of rules) {
    if (!isRecord(rule) || !isSlug(rule.if) || !isSlug(rule.then)) return state;
    clean.push({ if: rule.if, then: rule.then });
  }
  return withMember(state, id, (m) => {
    const current = Array.isArray(m.notebook.rules) ? m.notebook.rules : [];
    if (current.length === clean.length && current.every((r, i) => r.if === clean[i].if && r.then === clean[i].then)) return m;
    return { ...m, notebook: { ...m.notebook, rules: clean } };
  });
}

// ---------------------------------------------------------------------------
// Levelling up, paths, boons and Pages

function callingOf(state, id, cat) {
  const regular = id.startsWith('reg-') ? regularOf(state, id) : null;
  const comp = regular ? null : own(cat.companions, id);
  return { regular, comp, calling: cat.callings.get(regular ? regular.calling : comp?.calling) || null };
}

function boonLevels(calling, level) {
  let n = 0;
  for (let lv = 1; lv <= Math.min(level, 12); lv += 1) if ((calling.levels?.[String(lv)] || []).includes('boon')) n += 1;
  return n;
}

function pagesMax(state, id, { content, rules }) {
  const spec = heroSpec(state, id, { content, rules });
  return spec ? Math.max(0, spec.abilities.wit + spec.level) : 0;
}

/** Choices waiting at Level up: a path at 3 (never for regulars), a boon at 4, 8 and 12, and the Scribe's Pages. */
export function pendingChoices(state, id, { content, rules } = {}) {
  const cat = catalog(content);
  if (!isRecord(state) || typeof id !== 'string' || !inRoster(state, id)) return [];
  const { regular, comp, calling } = callingOf(state, id, cat);
  if (!calling) return [];
  const level = fightingLevel(state, id, rules);
  const member = memberOf(state, id);
  const out = [];
  if (!regular && level >= 3 && !member.path) {
    const ids = id === 'milo' ? comp.paths : (comp.paths || []).slice(0, 2);
    const options = ids.map((pid) => cat.paths.get(pid)).filter((p) => p && !p.from).map((p) => ({ id: p.id, name: p.name, text: p.text }));
    if (options.length) out.push({ kind: 'path', options });
  }
  if (member.boons.length < Math.min(MAX_BOONS, boonLevels(calling, level))) {
    const held = new Set(member.boons.map(boonAbility));
    const options = [];
    for (const bid of cat.file.boons || []) {
      const a = cat.abilities.get(bid);
      if (!a) continue;
      if (bid === 'ability-up') {
        for (const key of ABILITY_KEYS) options.push({ id: `ability-up-${key}`, name: `${a.name}: ${sentence(key)}`, text: `+1 ${sentence(key)}, never above 5.` });
      } else if (!held.has(bid)) options.push({ id: bid, name: a.name, text: a.text });
    }
    out.push({ kind: 'boon', options });
  }
  // Until the Scribe first prepares her Pages she has the first Wit + level in her list; once she
  // has, room that a level up adds waits here.
  if (calling.id === 'scrivener' && member.prepared.length) {
    const max = pagesMax(state, id, { content, rules });
    if (member.prepared.length < max) {
      const spec = heroSpec(state, id, { content, rules });
      const options = (calling.spells || []).map((sid) => cat.abilities.get(sid))
        .filter((a) => a && !a.stub && a.circle >= 1 && a.circle <= spec.charges.circle && !member.prepared.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name, text: a.text }));
      if (options.length) out.push({ kind: 'spells', options });
    }
  }
  return out;
}

/**
 * Takes a Level up choice: { kind: 'path', id } | { kind: 'boon', id } (an ability-up names its
 * ability: 'ability-up-wit') | { kind: 'spells', ids }. Never while a fight is live.
 */
export function levelUp(state, id, choice, now, { content, rules } = {}) {
  if (!isRecord(state) || battleLive(state) || !isRecord(choice)) return state;
  const pending = pendingChoices(state, id, { content, rules });
  const offer = pending.find((p) => p.kind === choice.kind);
  if (!offer) return state;
  if (choice.kind === 'path' || choice.kind === 'boon') {
    if (!offer.options.some((o) => o.id === choice.id)) return state;
    return withMember(state, id, (m) => (choice.kind === 'path' ? { ...m, path: choice.id } : { ...m, boons: [...m.boons, choice.id].slice(0, MAX_BOONS) }));
  }
  const ids = Array.isArray(choice.ids) ? choice.ids : [];
  return preparePages(state, id, [...memberOf(state, id).prepared, ...ids], now, { content, rules, where: 'camp' });
}

const atCamp = (state) => !battleLive(state) && !insideElsewhere(state);

/** Swaps a path at camp: Milo among his three; a companion among their unlocked paths (one in Phase 4). */
export function swapPath(state, id, pathId, now, { content } = {}) {
  if (!isRecord(state) || !atCamp(state)) return state;
  const cat = catalog(content);
  const member = memberOf(state, id);
  if (!member.path || member.path === pathId) return state;
  const comp = own(cat.companions, id);
  const path = cat.paths.get(pathId);
  if (!isRecord(comp) || !path || path.from || path.companion !== id) return state;
  // Phase 4: only Milo swaps freely; a companion's second path opens at Friend warmth, from Phase 5.
  if (id !== 'milo') return state;
  return withMember(state, id, (m) => ({ ...m, path: pathId }));
}

/** Swaps one boon for another at the campfire, for free. */
export function swapBoon(state, id, from, to, now, { content } = {}) {
  if (!isRecord(state) || !atCamp(state) || from === to) return state;
  const cat = catalog(content);
  const member = memberOf(state, id);
  const at = member.boons.indexOf(from);
  if (at < 0 || typeof to !== 'string') return state;
  const base = boonAbility(to);
  if (!(cat.file.boons || []).includes(base)) return state;
  if (base === 'ability-up' ? !/^ability-up-(might|grace|grit|wit|heed|charm)$/.test(to) : member.boons.some((b, i) => i !== at && boonAbility(b) === base)) return state;
  const boons = [...member.boons];
  boons[at] = to;
  return withMember(state, id, (m) => ({ ...m, boons }));
}

/** The Scribe's Pages (§9.4): Wit + level spells, prepared at camp or a lantern, never mid-dungeon. */
export function preparePages(state, id, spellIds, now, { content, rules, where = 'camp' } = {}) {
  if (!isRecord(state) || !atCamp(state) || (where !== 'camp' && where !== 'lantern') || !Array.isArray(spellIds)) return state;
  const cat = catalog(content);
  const { calling } = callingOf(state, id, cat);
  if (!calling || calling.id !== 'scrivener') return state;
  const spec = heroSpec(state, id, { content, rules });
  if (!spec) return state;
  const ids = [...new Set(spellIds)];
  if (ids.length > spec.abilities.wit + spec.level) return state;
  for (const sid of ids) {
    const a = cat.abilities.get(sid);
    if (!a || a.stub || !a.circle || a.circle > spec.charges.circle || !(calling.spells || []).includes(sid)) return state;
  }
  const current = memberOf(state, id).prepared;
  if (current.length === ids.length && current.every((s, i) => s === ids[i])) return state;
  return withMember(state, id, (m) => ({ ...m, prepared: ids }));
}

// ---------------------------------------------------------------------------
// Notebooks (the notes themselves live in their own files; §10.2)

/** Appends a round's accepted ('1') and changed ('0') drafted slots, keeping the last 50. */
export function noteAccepts(state, id, accepted, now) {
  if (!isRecord(state) || !inRoster(state, id) || !Array.isArray(accepted) || !accepted.length) return state;
  const add = accepted.map((a) => (a ? '1' : '0')).join('');
  return withMember(state, id, (m) => ({ ...m, notebook: { ...m.notebook, accepts: `${m.notebook.accepts || ''}${add}`.slice(-MAX_ACCEPTS) } }));
}

/** Counts notes appended to a notebook file, and a fight that taught at least one. */
export function noteGrowth(state, id, added, now, { fight = false } = {}) {
  if (!isRecord(state) || !inRoster(state, id) || !finite(added) || added <= 0) return state;
  return withMember(state, id, (m) => ({
    ...m, notebook: { ...m.notebook, count: whole(m.notebook.count) + Math.floor(added), fights: whole(m.notebook.fights) + (fight ? 1 : 0) },
  }));
}

const HABIT = /^\d{1,3}:\d{1,5}$/;

/** Strikes a habit out (its notes stop counting); refused calmly (the same state) once 40 are struck. */
export function strikeOut(state, id, habitKey, now) {
  if (!isRecord(state) || !inRoster(state, id) || typeof habitKey !== 'string' || !HABIT.test(habitKey)) return state;
  const struck = memberOf(state, id).notebook.struck || [];
  if (struck.includes(habitKey) || struck.length >= MAX_STRUCK) return state;
  return withMember(state, id, (m) => ({ ...m, notebook: { ...m.notebook, struck: [...struck, habitKey] } }));
}

/** Takes a strike back, only when Chris asks. */
export function unstrike(state, id, habitKey, now) {
  if (!isRecord(state) || !inRoster(state, id)) return state;
  const struck = memberOf(state, id).notebook.struck || [];
  if (!struck.includes(habitKey)) return state;
  return withMember(state, id, (m) => ({ ...m, notebook: { ...m.notebook, struck: struck.filter((k) => k !== habitKey) } }));
}

const cleanAccepts = (text) => (typeof text === 'string' ? text.replace(/[^01]/g, '').slice(-MAX_ACCEPTS) : '');

/**
 * Starts a notebook fresh until the next Campfire. `previous` is §8.3's { count, at }; the old fight
 * count and accepts wait beside it in `previousMeta` (A's cleaner keeps a notebook's own extra keys,
 * but rebuilds `previous` as { count, at }), so a restore after a relaunch brings them back too.
 */
export function resetNotebook(state, id, now) {
  if (!isRecord(state) || !inRoster(state, id)) return state;
  const nb = memberOf(state, id).notebook;
  if (!whole(nb.count) && !nb.accepts) return state;
  return withMember(state, id, (m) => ({
    ...m,
    notebook: {
      ...m.notebook, count: 0, fights: 0, accepts: '',
      previous: { count: whole(nb.count), at: stamp(now) },
      previousMeta: { fights: whole(nb.fights, 0, 1e6), accepts: cleanAccepts(nb.accepts) },
    },
  }));
}

/** Brings a reset notebook back, while `previous` is still kept. */
export function restoreNotebook(state, id, now) {
  if (!isRecord(state) || !inRoster(state, id)) return state;
  const nb = memberOf(state, id).notebook;
  if (!isRecord(nb.previous)) return state;
  const prev = nb.previous;
  const meta = isRecord(nb.previousMeta) ? nb.previousMeta : {};
  return withMember(state, id, (m) => ({
    ...m,
    notebook: {
      ...m.notebook, count: whole(prev.count), fights: whole(meta.fights, 0, 1e6), accepts: cleanAccepts(meta.accepts),
      previous: null, previousMeta: null,
    },
  }));
}
