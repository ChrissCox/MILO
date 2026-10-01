// Phase 4's saved state: the empty values and cleaners of the seven new sections, the Phase 4
// fields of Phase 3's tally, satchel and story, and the small steps other modules share
// (CONTRACT-PHASE4.md §7.6, §8). Imports only clean.js, so every pure Phase 4 module can use it
// without reaching model.js.
//
// Every cleaner follows Phase 3's rules: unknown sub-keys of a record survive, the result is
// idempotent (also through JSON), prototype-safe at every level and bounded, counters never go
// down, and nothing is paid, awarded or advanced here. Each section is cleaned inside its own
// try/catch, so one bad section never costs the rest of a save.
import {
  isRecord, UNSAFE_KEYS, safeCopy, toTime, clip, cleanCount, cleanInt, cleanMap, keepNewest, cleanMapNewest, cleanDayKey,
  stripUnsafe, withoutTitle, titleExpired,
} from './clean.js';

export const STATE4_KEYS = Object.freeze(['embers', 'xp', 'kindle', 'chronicle', 'road', 'party', 'expedition']);

/** Every cap §8 names, and the few it leaves to this module (marked "A"). */
export const STATE4_LIMITS = Object.freeze({
  // embers
  cap: 100, ledger: 300, paid: 200, ledgerText: 60, ledgerSource: 20, ledgerMin: -100, ledgerMax: 1_000_000, dayPaid: 1000,
  // xp
  xp: 200_000_000, travels: 1000,
  // chronicle
  days: 60, dayXp: 6, fights: 50, xpLines: 120, where: 60, summary: 200, lineSource: 20, lineText: 60,
  // road
  paidFights: 500, level: 40,
  // party
  // roster: the four founders, the one named companion Phase 4 can recruit (the Tollkeeper, §3.1; the
  // data-only ten never join, §3.2) and the 12 regulars
  roster: 17, others: 1 /* A */, chosen: 3, regulars: 12, cheers: 4, warmth: 1000,
  weekOuting: 6, boons: 3, pending: 4 /* A */, reactions: 8 /* A */, prepared: 20, struck: 40, accepts: 50, rules: 6,
  gifts: 3, notebookFights: 1_000_000, nooks: 50, freeReentry: 50, strayMemory: 12, seenScenes: 100,
  outingHeroes: 4 /* A: Milo and three */, uses: 12 /* A */, breathers: 9 /* A */, parts: 4 /* A */,
  // expedition
  rooms: 32 /* A */, chests: 32 /* A */, entry: 4 /* A: Milo and three */, battleBytes: 49_152, weights: 40 /* A */,
  // Phase 4's fields in Phase 3's sections
  waiting: 60, answeredWaits: 60 /* A */, features: 32 /* A */, trails: 20, trailSteps: 12 /* A */, facts: 200,
  marks: 1e9, tonics: 20,
});
const L = STATE4_LIMITS;

// Chris's 24 skills, in LORE §12's order (lifeskills.js re-exports this list).
export const SKILL_IDS = Object.freeze([
  'artifice', 'scribing', 'illumination', 'scholarship', 'stewardship', 'command', 'focus', 'hearthkeeping', 'tidereading',
  'woodcutting', 'fishing', 'foraging', 'mining', 'gardening',
  'cooking', 'smithing', 'crafting', 'alchemy', 'construction', 'cartography', 'wayfaring', 'warding', 'seamcraft', 'spellcraft',
]);
// The features the trail and the Tollkeeper count (src/world/trail.js FEATURES, §7.7).
export const FEATURE_IDS = Object.freeze(['kindle', 'rest', 'chronicle', 'command', 'examine', 'muster', 'fight', 'talk-down',
  'map', 'skills', 'war-table', 'ward', 'stitch', 'step-through', 'lantern', 'notebook']);
/** The crew whose finished sessions `tally.byCrew` counts, in the order a spare count is budgeted. */
export const CREW_AGENTS = Object.freeze(['claude', 'codex', 'jev', 'whisper']);
/** Always on the roster (added by the cleaner). */
export const FOUNDERS = Object.freeze(['milo', 'claude', 'codex', 'jev']);
/** The named companions Phase 4 can recruit (§3.1): the roster keeps them before any other name. */
export const JOINERS = Object.freeze(['tollkeeper']);
/** Who goes out with Milo until Chris chooses: the three companions who are always his. */
export const DEFAULT_CHOSEN = Object.freeze(['claude', 'codex', 'jev']);

export const KINDLE_PHASES = Object.freeze(['idle', 'focus', 'rest']);
export const FORMATIONS = Object.freeze(['line', 'pairs', 'loose', 'wedge']);
export const MODES = Object.freeze(['storybook', 'long-road', 'mauds-table']);
export const PLAYS = Object.freeze(['guided', 'command', 'choose', 'handle']);
export const CONTROLS = Object.freeze(['mine', 'review', 'choose']);
export const REACTION_SETTINGS = Object.freeze(['ask', 'always', 'under-half', 'never']);
export const ARCHETYPES = Object.freeze(['walker', 'crawler', 'floater', 'flier', 'ghost', 'construct']);
export const TEMPERAMENTS = Object.freeze(['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud']);
export const EXPEDITION_KINDS = Object.freeze(['wild', 'rung', 'real', 'story', 'cave', 'field']);
export const ROOM_OUTCOMES = Object.freeze(['won', 'talked', 'bowed', 'yielded', 'last-page']);
export const CARDS = Object.freeze(['offline', 'victory', 'bow', 'yielded']);
export const FIGHT_OUTCOMES = Object.freeze(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);

const MAX_TIME = 8.64e15;
const MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE;
const WAIT_DAYS = 7;
const FAST_MS = 15 * MINUTE;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
// A stray part's id: a slug, or camelCase as straygen names them (jetFlame, batWings).
const PART_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,39}$/;
const GENRE_ID = /^[a-z][a-z-]{1,23}$/;
const SIGNAL_ID = /^[a-z][a-z0-9-]{1,39}$/;
const AGENT_ID = /^[a-z][a-z0-9-]{0,19}$/;
const RIFT_ID = /^rift:[0-9a-z]{1,13}$/;
const PLACE_ID = /^(?:rift:[0-9a-z]{1,13}|cave:-?\d{1,7},-?\d{1,7})$/;
const RIFT_KEY = /^(night|knock|capacity|built|story):\S{1,150}$/;
// A cave's source.poi is the wilds' own place id (§18.2 item 3); its riftId is 'cave:<x>,<y>' (PLACE_ID).
const CAVE_POI_ID = /^poi:cave:-?\d{1,7},-?\d{1,7}$/;
const FIGHT_ID = /^fight:[a-z0-9:,.-]{1,90}$/;
// road.paidFights holds fight ids and the stitch keys C's payStitch uses; any id-safe key as long as
// the longest fight id (§5.1: 96) passes.
const PAY_KEY = /^[A-Za-z0-9][A-Za-z0-9:,._@-]{0,95}$/;
// An event key that pays once: '<source>:<ms>' ('focus:<ms>', 'rest:<ms>'). It always ends in its
// time, so a key pruned from `paid` is still covered by paidBefore and can never pay again.
const EVENT_KEY = /^[a-z][a-z0-9-]{0,11}:[1-9]\d{0,15}$/;
/** True for a pay-once event key, '<source>:<ms>'. */
export const isEventKey = (key) => typeof key === 'string' && EVENT_KEY.test(key);
const REGULAR_ID = /^reg-[a-z0-9-]{1,36}$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)$/;
const HABIT_KEY = /^\d{1,3}:\d{1,5}$/;
const PALETTE_KEY = /^[A-Za-z0-9]$/;
const ID_KEY = /^[a-z][a-z0-9:,._-]{0,63}$/;
// A fact id ≤ 64: the longest form written is 'glimmer:poi:<kind ≤ 16>:<x>,<y>' (46).
const FACT_ID = /^[a-z][a-z0-9:,._-]{0,63}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9:,._-]{0,79}$/;
const SESSION_ID = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64 && !/\s/.test(id) && !UNSAFE_KEYS.has(id);

const isSlug = (key) => typeof key === 'string' && SLUG.test(key) && !UNSAFE_KEYS.has(key);
const isMemberId = (id) => isSlug(id) && !WINDOWS_DEVICE.test(id) && (!id.startsWith('reg-') || REGULAR_ID.test(id));
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
// A whole number in [lo, hi], or `fallback`; never -0.
function whole(value, lo, hi, fallback) {
  if (!finite(value)) return fallback;
  const n = Math.round(value);
  return n < lo || n > hi ? fallback : (n || 0);
}
const clampWhole = (value, lo, hi, fallback) => (finite(value) ? Math.min(hi, Math.max(lo, Math.floor(value))) || 0 : fallback);
const time0 = (value) => cleanCount(value, MAX_TIME);
const dayOrNull = (value) => whole(value, 0, 1e8, null);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const oneOf = (list, value, fallback) => (list.includes(value) ? value : fallback);
const slugOrNull = (value) => (isSlug(value) ? value : null);
/** The first `max` entries of a record, in order. */
function firstN(map, max) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  return Object.fromEntries(keys.slice(0, max).map((key) => [key, map[key]]));
}
const newestTimes = (value, keyOk, max) => cleanMapNewest(value, keyOk, toTime, max, (t) => t);
function uniqueSlugs(value, max) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (isSlug(item) && !out.includes(item)) out.push(item);
    if (out.length === max) break;
  }
  return out;
}

/** UTF-8 bytes of JSON.stringify(value): the one size measure everywhere (B's battleBytes, §5.4). */
export function battleBytes(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') return 0;
  if (!/[^\x20-\x7e]/.test(text)) return text.length; // printable ASCII (all JSON.stringify writes for plain text): one byte a character
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Empty values

export function emptyEmbers() {
  return { balance: 0, lifetime: 0, ledger: [], paid: {}, paidBefore: 0, through: null, day: { key: null, crew: 0, answered: 0 }, backlogAt: null };
}
export function emptyXp() {
  return { skills: {}, through: null, day: { key: null, travels: 0 } };
}
export function emptyKindle() {
  return { phase: 'idle', startedAt: null, focusEndsAt: null, restStartedAt: null, restEndsAt: null, earned: false, paid: { focus: null, rest: null } };
}
export function emptyChronicle() {
  return { days: {}, fights: [], xpLines: [] };
}
export function emptyDay() {
  return { embersIn: 0, embersOut: 0, focus: 0, rests: 0, crew: 0, answered: 0, stitched: 0, fights: 0, xp: {} };
}
export function emptyRoad() {
  return { xp: 0, paidFights: {}, stitchedThrough: null, levelShown: 1, firstWin: false };
}
/** A roster member. `joinedAt` 0 means "from the start" (Milo and the three who are always his). */
export function emptyMember(joinedAt = 0) {
  return {
    joinedAt: time0(joinedAt),
    warmth: 0, warmthWeek: { week: null, outing: 0 }, habitDay: null,
    path: null, boons: [], pending: [],
    control: 'review',
    reactions: {},
    prepared: [],
    gifts: { margin: 0, spare: 0, through: null },
    notebook: { count: 0, fights: 0, rules: [], struck: [], accepts: '', previous: null },
  };
}
export function emptyOuting() {
  return { startedAt: null, breathers: 0, breatherFight: null, freeBreather: false, warmed: false, heroes: {} };
}
export function emptyCalm() {
  return { noise: true, adaptation: true, odds: 'bars', fastFoes: true, playback: 1, ghosts: false };
}
export function emptyParty() {
  return {
    roster: Object.fromEntries(FOUNDERS.map((id) => [id, emptyMember(0)])),
    chosen: [...DEFAULT_CHOSEN],
    formation: 'line',
    cheers: 0,
    regulars: [],
    outing: emptyOuting(),
    rests: { lanternDay: null, nooks: {}, freeReentry: {} },
    mode: 'long-road',
    play: 'guided',
    calm: emptyCalm(),
    strayMemory: {},
    firstLeadMet: false,
    teachDay: null,
    seenScenes: {},
  };
}

/** The seven new sections, empty. `expedition` is null until the party steps in somewhere. */
export function emptyState4() {
  return { embers: emptyEmbers(), xp: emptyXp(), kindle: emptyKindle(), chronicle: emptyChronicle(), road: emptyRoad(), party: emptyParty(), expedition: null };
}

/** Phase 4's fields in Phase 3's tally, satchel and story (model.js adds them after Phase 3's own). */
export function emptyTally4() {
  return {
    byCrew: Object.fromEntries(CREW_AGENTS.map((id) => [id, 0])), answered: 0, answeredFast: 0, waiting: {}, answeredWaits: {},
    focusSessions: 0, restsHonoured: 0, chunksCharted: 0, features: {},
  };
}
export function emptySatchel4() {
  return { marks: 0, tonics: { cordial: 0, brew: 0 } };
}
export function emptyStory4() {
  return { trails: {}, facts: {} };
}

// ---------------------------------------------------------------------------
// The counts the high-water marks follow

/** { sessionsFinished, answered, answeredFast, buildingsDesigned, stitchedReal } from a state (or a raw save). */
export function signalCounts(state) {
  const tally = isRecord(own(state, 'tally')) ? state.tally : {};
  const rifts = isRecord(own(state, 'rifts')) ? state.rifts : {};
  const stitched = isRecord(own(rifts, 'stitched')) ? rifts.stitched : {};
  return {
    sessionsFinished: cleanCount(own(tally, 'sessionsFinished')),
    answered: cleanCount(own(tally, 'answered')),
    answeredFast: cleanCount(own(tally, 'answeredFast')),
    buildingsDesigned: cleanCount(own(tally, 'buildingsDesigned')),
    stitchedReal: cleanCount(own(stitched, 'real')),
  };
}
const embersThrough = (counts) => ({ sessionsFinished: counts.sessionsFinished, answered: counts.answered, stitchedReal: counts.stitchedReal, buildingsDesigned: counts.buildingsDesigned });
const xpThrough = (counts) => ({ sessionsFinished: counts.sessionsFinished, answeredFast: counts.answeredFast, buildingsDesigned: counts.buildingsDesigned });

// ---------------------------------------------------------------------------
// Embers

/** The time a pay-once event key names ('focus:1759000000000' → 1759000000000), or null. */
export function eventTime(key) {
  if (typeof key !== 'string') return null;
  const tail = key.slice(key.lastIndexOf(':') + 1);
  return /^\d{1,16}$/.test(tail) ? toTime(Number(tail)) : null;
}

/**
 * A ledger text: ≤ 60, and a session title is never stored (§8.3, §2), so a quoted one goes at once.
 * A title is whatever sits in “…” (as Phase 3 quotes one), so a writer quotes anything else in ‘…’.
 */
export const ledgerText = (text) => clip(withoutTitle(text), L.ledgerText);

/** A LedgerEntry { at, n, banked, source ≤ 20, text ≤ 60, no title }, or null. */
export function cleanLedgerEntry(value) {
  if (!isRecord(value)) return null;
  const at = toTime(value.at);
  const n = whole(value.n, L.ledgerMin, L.ledgerMax, 0);
  const source = clip(value.source, L.ledgerSource);
  if (!at || !n || !source) return null;
  const banked = n > 0 ? Math.min(n, clampWhole(value.banked, 0, L.cap, 0)) : 0;
  return { at, n, banked, source, text: ledgerText(value.text) };
}

/** Pay-once keys, the newest `L.paid` kept; what's pruned raises paidBefore, so it can never pay again. */
export function prunePaid(paid, paidBefore) {
  const keys = Object.keys(paid);
  if (keys.length <= L.paid) return { paid, paidBefore };
  const score = (at, key) => eventTime(key) ?? at;
  const kept = keepNewest(paid, L.paid, score);
  let before = paidBefore;
  for (const key of keys) if (!Object.hasOwn(kept, key)) before = Math.max(before, score(paid[key], key));
  return { paid: kept, paidBefore: before };
}

/**
 * High-water marks: each field a whole count, or, when it's missing or damaged (not a number ≥ 0),
 * seeded from today's count. A seeded mark pays nothing for what came before it, so damage can
 * forfeit a little but never pay a counter's history twice.
 */
function cleanMarks(value, counts, fields) {
  const out = { ...safeCopy(value) };
  for (const field of fields) {
    const mark = own(value, field);
    out[field] = finite(mark) && mark >= 0 ? cleanCount(mark) : counts[field];
  }
  return out;
}
const EMBER_MARKS = Object.freeze(['sessionsFinished', 'answered', 'stitchedReal', 'buildingsDesigned']);
const XP_MARKS = Object.freeze(['sessionsFinished', 'answeredFast', 'buildingsDesigned']);

function cleanEmbersThrough(value, counts) {
  if (value === null) return null; // the backlog is still to pay (§4.20)
  if (!isRecord(value)) return embersThrough(counts); // seeded, never paid: a damaged mark can't pay twice
  return cleanMarks(value, counts, EMBER_MARKS);
}

// A present `embers` or `xp` that isn't a record is damage, not a save from before the Kit: it falls
// back with its marks seeded (and, for Embers, every event key before `now` counted as paid).
const damagedEmbers = (counts, clock) => ({ ...emptyEmbers(), through: embersThrough(counts), paidBefore: clock });
const damagedXp = (counts) => ({ ...emptyXp(), through: xpThrough(counts) });

function cleanEmbers(value, { counts }) {
  const ledger = (Array.isArray(value.ledger) ? value.ledger : []).map(cleanLedgerEntry).filter(Boolean).slice(-L.ledger);
  const bankedIn = ledger.reduce((sum, entry) => sum + (entry.n > 0 ? entry.banked : 0), 0);
  const pruned = prunePaid(cleanMap(value.paid, (key) => EVENT_KEY.test(key), toTime), time0(value.paidBefore));
  const day = isRecord(value.day) ? value.day : {};
  return {
    ...safeCopy(value),
    balance: clampWhole(value.balance, 0, L.cap, 0),
    lifetime: Math.max(cleanCount(value.lifetime), bankedIn),
    ledger,
    paid: pruned.paid,
    paidBefore: pruned.paidBefore,
    through: cleanEmbersThrough(value.through, counts),
    day: { ...safeCopy(day), key: cleanDayKey(day.key), crew: cleanCount(day.crew, L.dayPaid), answered: cleanCount(day.answered, L.dayPaid) },
    backlogAt: toTime(value.backlogAt),
  };
}

// ---------------------------------------------------------------------------
// XP

function cleanXp(value, { counts }) {
  const day = isRecord(value.day) ? value.day : {};
  let through = null; // null: the life-XP backlog is still to pay
  if (isRecord(value.through)) through = cleanMarks(value.through, counts, XP_MARKS);
  else if (value.through !== null) through = xpThrough(counts);
  return {
    ...safeCopy(value),
    skills: cleanMap(value.skills, (id) => SKILL_IDS.includes(id), (n) => cleanCount(n, L.xp) || null),
    through,
    day: { ...safeCopy(day), key: cleanDayKey(day.key), travels: cleanCount(day.travels, L.travels) },
  };
}

// ---------------------------------------------------------------------------
// Kindle

function cleanKindle(value) {
  if (!isRecord(value)) return emptyKindle();
  const startedAt = toTime(value.startedAt);
  const focusEndsAt = toTime(value.focusEndsAt);
  const restStartedAt = toTime(value.restStartedAt);
  const restEndsAt = toTime(value.restEndsAt);
  let phase = oneOf(KINDLE_PHASES, value.phase, 'idle');
  // A phase whose times are missing or out of order is idle; the clock never moves a phase here.
  if (phase === 'focus' && !(startedAt && focusEndsAt && startedAt < focusEndsAt)) phase = 'idle';
  if (phase === 'rest' && !(restStartedAt && restEndsAt && restStartedAt < restEndsAt)) phase = 'idle';
  const paid = isRecord(value.paid) ? value.paid : {};
  return {
    ...safeCopy(value),
    phase, startedAt, focusEndsAt, restStartedAt, restEndsAt,
    earned: value.earned === true,
    paid: { ...safeCopy(paid), focus: toTime(paid.focus), rest: toTime(paid.rest) },
  };
}

// ---------------------------------------------------------------------------
// The Chronicle

const DAY_COUNTS = ['embersIn', 'embersOut', 'focus', 'rests', 'crew', 'answered', 'stitched', 'fights'];

/** A day's xp: non-zero skills only, the `L.dayXp` largest kept. */
export function topXp(map) {
  return cleanMapNewest(map, (id) => SKILL_IDS.includes(id), (n) => cleanCount(n, L.xp) || null, L.dayXp, (n) => n);
}

export function cleanDay(value) {
  if (!isRecord(value)) return null;
  const out = {};
  for (const key of DAY_COUNTS) out[key] = cleanCount(value[key]);
  out.xp = topXp(value.xp);
  return out;
}

/** Keeps the newest `L.days` day keys ('YYYY-MM-DD' sorts as a date). */
export function newestDays(days) {
  const keys = Object.keys(days);
  if (keys.length <= L.days) return days;
  const kept = new Set([...keys].sort().slice(-L.days));
  return Object.fromEntries(keys.filter((key) => kept.has(key)).map((key) => [key, days[key]]));
}

/** A text written at `at`, clipped to `max`; once SESSION_NAME_DAYS have passed by `now`, without its title (§2). */
const agedText = (text, max, at, now) => clip(titleExpired(at, now) ? withoutTitle(text) : text, max);

/**
 * A FightSummary { id, at, where ≤ 60, outcome, rounds, xp, marks, summary ≤ 200 }, or null. A
 * session title in `where` or `summary` is kept for SESSION_NAME_DAYS after `at`, then dropped.
 * A title is whatever sits in “…”, so quote a lead's name or a bark in ‘…’ instead.
 */
export function cleanFightSummary(value, now = null) {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && FIGHT_ID.test(value.id) ? value.id : null;
  const at = toTime(value.at);
  if (!id || !at || !FIGHT_OUTCOMES.includes(value.outcome)) return null;
  return {
    id, at, where: agedText(value.where, L.where, at, now), outcome: value.outcome,
    rounds: cleanCount(value.rounds, 999), xp: cleanCount(value.xp), marks: cleanCount(value.marks), summary: agedText(value.summary, L.summary, at, now),
  };
}

/** An XP line { at, skill, n, source ≤ 20, text ≤ 60 }, or null; a title (“…”) in its text goes after SESSION_NAME_DAYS. */
export function cleanXpLine(value, now = null) {
  if (!isRecord(value)) return null;
  const at = toTime(value.at);
  const n = cleanCount(value.n, L.xp);
  if (!at || !n || !SKILL_IDS.includes(value.skill)) return null;
  return { at, skill: value.skill, n, source: clip(value.source, L.lineSource), text: agedText(value.text, L.lineText, at, now) };
}

function cleanChronicle(value, { now }) {
  if (!isRecord(value)) return emptyChronicle();
  return {
    ...safeCopy(value),
    days: newestDays(cleanMap(value.days, (key) => cleanDayKey(key) === key, cleanDay)),
    fights: (Array.isArray(value.fights) ? value.fights : []).map((f) => cleanFightSummary(f, now)).filter(Boolean).slice(-L.fights),
    xpLines: (Array.isArray(value.xpLines) ? value.xpLines : []).map((line) => cleanXpLine(line, now)).filter(Boolean).slice(-L.xpLines),
  };
}

// ---------------------------------------------------------------------------
// The Road

function cleanRoad(value) {
  if (!isRecord(value)) return emptyRoad();
  return {
    ...safeCopy(value),
    xp: cleanCount(value.xp),
    paidFights: newestTimes(value.paidFights, (key) => PAY_KEY.test(key), L.paidFights),
    stitchedThrough: finite(value.stitchedThrough) ? cleanCount(value.stitchedThrough) : null,
    // A high-water mark: past its bound it reads as the bound, never back at 1 (that would show
    // every Level up moment again).
    levelShown: clampWhole(value.levelShown, 1, L.level, 1),
    firstWin: value.firstWin === true,
  };
}

// ---------------------------------------------------------------------------
// The party

function cleanRule(value) {
  if (!isRecord(value) || !isSlug(value.if) || !isSlug(value.then)) return null;
  return { if: value.if, then: value.then };
}

function cleanNotebookMeta(value) {
  const src = isRecord(value) ? value : {};
  const struck = [];
  for (const key of Array.isArray(src.struck) ? src.struck : []) {
    if (typeof key === 'string' && HABIT_KEY.test(key) && !struck.includes(key)) struck.push(key);
    if (struck.length === L.struck) break; // never pruned in play: strikeOut refuses a 41st
  }
  const previous = isRecord(src.previous) && toTime(src.previous.at)
    ? { count: cleanCount(src.previous.count), at: toTime(src.previous.at) } : null;
  return {
    ...safeCopy(src),
    count: cleanCount(src.count),
    fights: cleanCount(src.fights, L.notebookFights),
    rules: (Array.isArray(src.rules) ? src.rules : []).map(cleanRule).filter(Boolean).slice(0, L.rules),
    struck,
    accepts: typeof src.accepts === 'string' ? src.accepts.replace(/[^01]/g, '').slice(-L.accepts) : '',
    previous,
  };
}

export function cleanMember(value, joinedAt = 0) {
  const src = isRecord(value) ? value : {};
  const week = isRecord(src.warmthWeek) ? src.warmthWeek : {};
  const gifts = isRecord(src.gifts) ? src.gifts : {};
  return {
    ...safeCopy(src),
    joinedAt: Object.hasOwn(src, 'joinedAt') ? time0(src.joinedAt) : time0(joinedAt),
    warmth: cleanCount(src.warmth, L.warmth),
    warmthWeek: { ...safeCopy(week), week: dayOrNull(week.week), outing: cleanCount(week.outing, L.weekOuting) },
    habitDay: dayOrNull(src.habitDay),
    path: slugOrNull(src.path),
    boons: uniqueSlugs(src.boons, L.boons),
    pending: (Array.isArray(src.pending) ? src.pending : []).filter((p) => p === 'path' || p === 'boon').slice(0, L.pending),
    control: oneOf(CONTROLS, src.control, 'review'),
    reactions: firstN(cleanMap(src.reactions, isSlug, (v) => (REACTION_SETTINGS.includes(v) ? v : null)), L.reactions),
    prepared: uniqueSlugs(src.prepared, L.prepared),
    gifts: {
      ...safeCopy(gifts),
      margin: cleanCount(gifts.margin, L.gifts), spare: cleanCount(gifts.spare, L.gifts),
      through: finite(gifts.through) ? cleanCount(gifts.through) : null,
    },
    notebook: cleanNotebookMeta(src.notebook),
  };
}

export function cleanRegular(value) {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && REGULAR_ID.test(value.id) && isMemberId(value.id) ? value.id : null;
  const name = clip(value.name, 40);
  const genre = typeof value.genre === 'string' && GENRE_ID.test(value.genre) ? value.genre : null;
  if (!id || !name || !genre || !ARCHETYPES.includes(value.archetype) || !isSlug(value.calling)) return null;
  const parts = [];
  for (const part of Array.isArray(value.parts) ? value.parts : []) {
    if (isRecord(part) && typeof part.id === 'string' && PART_ID.test(part.id)) parts.push({ id: part.id, layer: part.layer === 1 ? 1 : 0 });
    if (parts.length === L.parts) break;
  }
  return {
    ...safeCopy(value),
    id,
    riftId: typeof value.riftId === 'string' && RIFT_ID.test(value.riftId) ? value.riftId : null,
    riftSeed: whole(value.riftSeed, 0, 0xffffffff, 0),
    name,
    genre,
    second: typeof value.second === 'string' && GENRE_ID.test(value.second) ? value.second : null,
    archetype: value.archetype,
    bodyKey: typeof value.bodyKey === 'string' && PALETTE_KEY.test(value.bodyKey) ? value.bodyKey : 'r',
    parts,
    eyeKey: typeof value.eyeKey === 'string' && PALETTE_KEY.test(value.eyeKey) ? value.eyeKey : null,
    temperament: oneOf(TEMPERAMENTS, value.temperament, 'shy'),
    calling: value.calling,
    lead: value.lead === true,
    mechanic: slugOrNull(value.mechanic),
    joinedAt: time0(value.joinedAt),
  };
}

function cleanOutingHero(value) {
  if (!isRecord(value)) return null;
  return {
    ...safeCopy(value),
    integrity: cleanCount(value.integrity, 1e4),
    charges: cleanCount(value.charges, 100),
    uses: firstN(cleanMap(value.uses, isSlug, (n) => (finite(n) ? cleanCount(n, 99) : null)), L.uses),
    rattled: value.rattled === true,
  };
}

function cleanOuting(value) {
  if (!isRecord(value)) return emptyOuting();
  return {
    ...safeCopy(value),
    startedAt: toTime(value.startedAt),
    breathers: cleanCount(value.breathers, L.breathers),
    breatherFight: typeof value.breatherFight === 'string' && PAY_KEY.test(value.breatherFight) ? value.breatherFight : null,
    freeBreather: value.freeBreather === true,
    warmed: value.warmed === true,
    heroes: firstN(cleanMap(value.heroes, isMemberId, cleanOutingHero), L.outingHeroes),
  };
}

function cleanCalm(value) {
  const src = isRecord(value) ? value : {};
  return {
    ...safeCopy(src),
    noise: bool(src.noise, true),
    adaptation: bool(src.adaptation, true),
    odds: oneOf(['bars', 'words'], src.odds, 'bars'),
    fastFoes: bool(src.fastFoes, true),
    playback: oneOf([1, 2, 4], src.playback, 1),
    ghosts: bool(src.ghosts, false),
  };
}

function cleanParty(value) {
  if (!isRecord(value)) return emptyParty();
  const regulars = [];
  const regularIds = new Set();
  for (const entry of Array.isArray(value.regulars) ? value.regulars : []) {
    const regular = cleanRegular(entry);
    if (!regular || regularIds.has(regular.id)) continue;
    regulars.push(regular);
    regularIds.add(regular.id);
    if (regulars.length === L.regulars) break;
  }
  // Milo and the three who are always his come first, then the named companions who joined, then
  // the regulars; a regular's member without its Regular record can't take the field, so it goes.
  const raw = isRecord(value.roster) ? value.roster : {};
  const roster = {};
  for (const id of FOUNDERS) roster[id] = cleanMember(own(raw, id), 0);
  // At most L.others named companions beyond the founders, the ones Phase 4 recruits first.
  const named = Object.keys(raw).filter((id) => !Object.hasOwn(roster, id) && isMemberId(id) && !id.startsWith('reg-'));
  const joinable = (id) => (JOINERS.includes(id) ? 0 : 1);
  for (const id of named.sort((a, b) => joinable(a) - joinable(b)).slice(0, L.others)) roster[id] = cleanMember(raw[id]);
  for (const regular of regulars) roster[regular.id] = cleanMember(own(raw, regular.id), regular.joinedAt);
  const chosen = [];
  if (Array.isArray(value.chosen)) {
    for (const id of value.chosen) {
      if (typeof id === 'string' && id !== 'milo' && Object.hasOwn(roster, id) && !chosen.includes(id)) chosen.push(id);
      if (chosen.length === L.chosen) break;
    }
  } else {
    chosen.push(...DEFAULT_CHOSEN);
  }
  const rests = isRecord(value.rests) ? value.rests : {};
  return {
    ...safeCopy(value),
    roster,
    chosen,
    formation: oneOf(FORMATIONS, value.formation, 'line'),
    cheers: clampWhole(value.cheers, 0, L.cheers, 0),
    regulars,
    outing: cleanOuting(value.outing),
    rests: {
      ...safeCopy(rests),
      lanternDay: dayOrNull(rests.lanternDay),
      nooks: newestTimes(rests.nooks, (key) => PLACE_ID.test(key), L.nooks),
      freeReentry: newestTimes(rests.freeReentry, (key) => PLACE_ID.test(key), L.freeReentry),
    },
    mode: oneOf(MODES, value.mode, 'long-road'),
    play: oneOf(PLAYS, value.play, 'guided'),
    calm: cleanCalm(value.calm),
    strayMemory: keepNewest(cleanMap(value.strayMemory, (key) => GENRE_ID.test(key), (entry) => (
      isRecord(entry) && typeof entry.habit === 'string' && HABIT_KEY.test(entry.habit)
        ? { habit: entry.habit, count: cleanCount(entry.count, 1e6) } : null
    )), L.strayMemory, (entry) => entry.count),
    firstLeadMet: value.firstLeadMet === true,
    teachDay: dayOrNull(value.teachDay),
    seenScenes: newestTimes(value.seenScenes, (key) => ID_KEY.test(key), L.seenScenes),
  };
}

// ---------------------------------------------------------------------------
// The expedition

function cleanWeights(value) {
  return firstN(cleanMap(value, (key) => GENRE_ID.test(key), (w) => (finite(w) && w >= 0 && w <= 100 ? w : null)), L.weights);
}

function cleanWildSource(value) {
  const seed = whole(value.seed, 0, 0xffffffff, null);
  if (seed === null) return null;
  return {
    ...safeCopy(value),
    seed, tier: whole(value.tier, 1, 99, 1), depth: whole(value.depth, 1, 9999, 1), weights: cleanWeights(value.weights),
  };
}

function cleanSource(kind, value) {
  if (!isRecord(value)) return null;
  if (kind === 'wild' || kind === 'rung') {
    const wild = cleanWildSource(value);
    return wild && { ...wild, rungs: cleanCount(value.rungs, 9999) };
  }
  if (kind === 'field') {
    const wild = cleanWildSource(value);
    const x = cleanInt(value.x);
    const y = cleanInt(value.y);
    return wild && x !== null && y !== null ? { ...wild, x: x || 0, y: y || 0 } : null;
  }
  if (kind === 'cave') {
    // §18.2 item 3: the wilds' place id and the MILO day it was entered, which every rebuild needs.
    const day = dayOrNull(value.day);
    const ok = typeof value.poi === 'string' && CAVE_POI_ID.test(value.poi) && day !== null && day === value.day;
    return ok ? { ...safeCopy(value), poi: value.poi, day } : null;
  }
  // real and story: riftgen.realRift's inputs as they were at entry, kept exactly (a resume rebuilds from them).
  if (typeof value.key !== 'string' || !RIFT_KEY.test(value.key)) return null;
  return {
    ...safeCopy(value),
    key: value.key,
    subject: clip(value.subject, 40),
    signals: Array.isArray(value.signals) ? [...new Set(value.signals.filter((s) => typeof s === 'string' && SIGNAL_ID.test(s)))].slice(0, 6) : [],
    urgency: finite(value.urgency) ? Math.min(1, Math.max(0, value.urgency)) : 0,
    tier: whole(value.tier, 1, 99, 1),
    cause: clip(value.cause, 160),
    since: toTime(value.since),
  };
}

/** A BattleSave kept as saved (deep checks are restoreBattle's), or null: v 2, a string id, ≤ 49,152 bytes. */
export function cleanBattleSave(value) {
  if (!isRecord(value)) return null;
  const save = stripUnsafe(value);
  if (!isRecord(save) || save.v !== 2 || typeof save.id !== 'string' || !save.id) return null;
  return battleBytes(save) <= L.battleBytes ? save : null;
}

function cleanExpedition(value) {
  if (!isRecord(value)) return null;
  const kind = oneOf(EXPEDITION_KINDS, value.kind, null);
  const runId = typeof value.runId === 'string' && RUN_ID.test(value.runId) ? value.runId : null;
  const source = kind && runId ? cleanSource(kind, value.source) : null;
  if (!source) return null;
  return {
    ...safeCopy(value),
    runId,
    kind,
    riftId: typeof value.riftId === 'string' && PLACE_ID.test(value.riftId) ? value.riftId : null,
    key: typeof value.key === 'string' && RIFT_KEY.test(value.key) ? value.key : null,
    since: toTime(value.since),
    source,
    depth: whole(value.depth, 1, 9999, 1),
    tier: whole(value.tier, 1, 99, 1),
    enteredAt: time0(value.enteredAt),
    embersPaid: cleanCount(value.embersPaid, 1000),
    inside: value.inside === true,
    rooms: firstN(cleanMap(value.rooms, (key) => ID_KEY.test(key), (v) => (ROOM_OUTCOMES.includes(v) ? v : null)), L.rooms),
    chests: newestTimes(value.chests, (key) => ID_KEY.test(key), L.chests),
    nookUsed: value.nookUsed === true,
    entry: firstN(cleanMap(value.entry, isMemberId, (n) => (finite(n) ? cleanCount(n, 1e4) : null)), L.entry),
    battle: cleanBattleSave(value.battle),
    card: oneOf(CARDS, value.card, null),
  };
}

// ---------------------------------------------------------------------------
// The sections together

function section(clean, fallback) {
  try {
    return clean();
  } catch {
    return fallback();
  }
}

/**
 * The seven Phase 4 sections of a saved state, cleaned. `tally` is the cleaned tally (its counts
 * seed a high-water mark that's damaged, so it can never pay twice). Each section is cleaned on
 * its own: one that throws falls back to its empty value, except for `embers` and `xp`.
 * - Only a save with no `embers` (or `xp`) key at all is from before the Kit: `through` is null,
 *   and its backlog pays once (§4.20).
 * - A present `embers` or `xp` that isn't a record, or that throws, falls back with its marks
 *   seeded to today's counts (and `paidBefore` at `now`), never to null, so it can't pay again.
 */
export function normalize4(source, { now, tally } = {}) {
  const src = isRecord(source) ? source : {};
  const counts = section(() => signalCounts({ tally, rifts: own(src, 'rifts') }), () => signalCounts({}));
  const clock = finite(now) ? Math.max(0, Math.round(now)) : 0;
  const cleanOrDamaged = (key, clean, empty, damaged) => () => {
    if (!Object.hasOwn(src, key)) return empty();
    return isRecord(src[key]) ? clean(src[key]) : damaged();
  };
  return {
    embers: section(cleanOrDamaged('embers', (v) => cleanEmbers(v, { counts }), emptyEmbers, () => damagedEmbers(counts, clock)), () => damagedEmbers(counts, clock)),
    xp: section(cleanOrDamaged('xp', (v) => cleanXp(v, { counts }), emptyXp, () => damagedXp(counts)), () => damagedXp(counts)),
    kindle: section(() => cleanKindle(own(src, 'kindle')), emptyKindle),
    chronicle: section(() => cleanChronicle(own(src, 'chronicle'), { now: finite(now) ? now : null }), emptyChronicle),
    road: section(() => cleanRoad(own(src, 'road')), emptyRoad),
    party: section(() => cleanParty(own(src, 'party')), emptyParty),
    expedition: section(() => cleanExpedition(own(src, 'expedition')), () => null),
  };
}

// ---------------------------------------------------------------------------
// Phase 4's fields in Phase 3's sections

const agentOfId = (id) => {
  const prefix = typeof id === 'string' ? id.split(':')[0] : '';
  return AGENT_ID.test(prefix) && prefix !== id ? prefix : null;
};

/**
 * Phase 4's tally fields: { byCrew, answered, answeredFast, waiting, answeredWaits, focusSessions,
 * restsHonoured, chunksCharted, features }. `byCrew` is at least what `finishedIds` shows for each
 * agent, and never more than `sessionsFinished` all together.
 */
export function cleanTally4(tally, { finishedIds, sessionsFinished } = {}) {
  const src = isRecord(tally) ? tally : {};
  const ids = Array.isArray(finishedIds) ? finishedIds : (Array.isArray(src.finishedIds) ? src.finishedIds : []);
  const total = finite(sessionsFinished) ? cleanCount(sessionsFinished) : Math.max(cleanCount(src.sessionsFinished), ids.length);
  const seen = {};
  for (const id of ids) {
    const agent = agentOfId(id);
    if (agent && CREW_AGENTS.includes(agent)) seen[agent] = (seen[agent] || 0) + 1;
  }
  const saved = isRecord(src.byCrew) ? src.byCrew : {};
  const byCrew = {};
  let budget = total;
  for (const agent of CREW_AGENTS) {
    const n = Math.min(budget, Math.max(cleanCount(own(saved, agent)), seen[agent] || 0));
    byCrew[agent] = n;
    budget -= n;
  }
  const answered = cleanCount(src.answered);
  return {
    byCrew,
    answered,
    answeredFast: Math.min(answered, cleanCount(src.answeredFast)),
    waiting: newestTimes(src.waiting, SESSION_ID, L.waiting),
    answeredWaits: newestTimes(src.answeredWaits, SESSION_ID, L.answeredWaits),
    focusSessions: cleanCount(src.focusSessions),
    restsHonoured: cleanCount(src.restsHonoured),
    chunksCharted: cleanCount(src.chunksCharted),
    features: newestTimes(src.features, isSlug, L.features),
  };
}

/** Phase 4's satchel fields: Marks and the party's tonics. */
export function cleanSatchel4(satchel) {
  const src = isRecord(satchel) ? satchel : {};
  const tonics = isRecord(src.tonics) ? src.tonics : {};
  return {
    marks: cleanCount(src.marks, L.marks),
    tonics: { ...safeCopy(tonics), cordial: cleanCount(tonics.cordial, L.tonics), brew: cleanCount(tonics.brew, L.tonics) },
  };
}

function cleanTrail(value) {
  if (!isRecord(value)) return null;
  const steps = (map) => newestTimes(map, isSlug, L.trailSteps);
  return { ...safeCopy(value), found: steps(value.found), done: steps(value.done), joinedAt: toTime(value.joinedAt) };
}
const latest = (trail) => Math.max(0, trail.joinedAt || 0, ...Object.values(trail.found), ...Object.values(trail.done));

/** Phase 4's story fields: the Riddle Note trails and the facts talks and trails ask about. */
export function cleanStory4(story) {
  const src = isRecord(story) ? story : {};
  return {
    trails: keepNewest(cleanMap(src.trails, isSlug, cleanTrail), L.trails, latest),
    facts: newestTimes(src.facts, (key) => FACT_ID.test(key), L.facts),
  };
}

// ---------------------------------------------------------------------------
// Small shared steps. Each returns a new state, or the same state when nothing changed.

const stamp = (now) => (finite(now) && now > 0 ? Math.round(now) : null);

/** Records a fact ('note:…', 'examined:<genre>:<archetype>', 'glimmer:<poiId>', 'riddle:<id>') once, in story.facts. */
export function markFact(state, factId, now) {
  const at = stamp(now);
  if (!isRecord(state) || typeof factId !== 'string' || !FACT_ID.test(factId) || at === null) return state;
  const story = isRecord(state.story) ? state.story : {};
  const facts = isRecord(story.facts) ? story.facts : {};
  if (Object.hasOwn(facts, factId)) return state;
  return { ...state, story: { ...story, facts: keepNewest({ ...facts, [factId]: at }, L.facts, (t) => t) } };
}

/** Records the first use of a feature (trail.FEATURES) in tally.features. */
export function markFeature(state, featureId, now) {
  const at = stamp(now);
  if (!isRecord(state) || !FEATURE_IDS.includes(featureId) || at === null) return state;
  const tally = isRecord(state.tally) ? state.tally : {};
  const features = isRecord(tally.features) ? tally.features : {};
  if (Object.hasOwn(features, featureId)) return state;
  return { ...state, tally: { ...tally, features: { ...features, [featureId]: at } } };
}

/** The Hearth's tier, 1–8, for the Road level's cap. */
export function hearthTierOf(state) {
  const tier = isRecord(state) && isRecord(state.hearth) ? state.hearth.tier : null;
  return finite(tier) ? Math.min(8, Math.max(1, Math.floor(tier))) : 1;
}

function agentOfSession(session) {
  if (typeof session.agent === 'string' && AGENT_ID.test(session.agent)) return session.agent;
  return agentOfId(session.id);
}

/**
 * Counts needs-you answered (§8.2). A live Claude session that is `needs-you` with a
 * `waitingSince` is remembered in `tally.waiting`; it's answered when a later snapshot shows it
 * still live with status `working` or `done`, or with a completion after the wait began. Each
 * `id@waitingSince` counts once (`tally.answeredWaits` remembers the last answered wait, so a stale
 * look at the same wait never counts again), and it's fast when `min(now, lastActivityAt) −
 * waitingSince ≤ 15 minutes`. A session that disappears, stops being live, is archived or whose
 * source is down is never an answer: its wait is kept for up to 7 days in case it comes back.
 */
export function tallyAnswered(state, snapshot, now) {
  if (!isRecord(state) || !finite(now)) return state;
  const sessions = isRecord(snapshot) && Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const sources = isRecord(snapshot) && isRecord(snapshot.sources) ? snapshot.sources : {};
  const up = (agent) => isRecord(own(sources, agent)) && sources[agent].ok === true;
  const tally = isRecord(state.tally) ? state.tally : {};
  const waiting = { ...(isRecord(tally.waiting) ? tally.waiting : {}) };
  const done = { ...(isRecord(tally.answeredWaits) ? tally.answeredWaits : {}) };
  let changed = false;
  let answered = 0;
  let fast = 0;
  for (const session of sessions) {
    if (!isRecord(session) || !SESSION_ID(session.id) || agentOfSession(session) !== 'claude') continue;
    const id = session.id;
    const looking = session.live === true && session.archived !== true && up('claude');
    const since = finite(own(waiting, id)) ? waiting[id] : null;
    if (since !== null && looking) {
      const completions = Array.isArray(session.completions) ? session.completions : [];
      const finished = completions.some((t) => finite(t) && t > since && t <= now);
      if (session.status === 'working' || session.status === 'done' || finished) {
        answered += 1;
        const last = toTime(session.lastActivityAt) ?? now;
        if (Math.min(now, last) - since <= FAST_MS) fast += 1;
        delete waiting[id];
        done[id] = since;
        changed = true;
      }
    }
    const wait = toTime(session.waitingSince);
    if (looking && session.status === 'needs-you' && wait && wait <= now && wait > (finite(own(done, id)) ? done[id] : 0)) {
      if (!finite(own(waiting, id)) || wait > waiting[id]) {
        waiting[id] = wait;
        changed = true;
      }
    }
  }
  for (const id of Object.keys(waiting)) {
    if (!finite(waiting[id]) || waiting[id] < now - WAIT_DAYS * DAY_MS) {
      delete waiting[id];
      changed = true;
    }
  }
  if (!changed) return state;
  return {
    ...state,
    tally: {
      ...tally,
      answered: cleanCount(tally.answered) + answered,
      answeredFast: cleanCount(tally.answeredFast) + fast,
      waiting: keepNewest(waiting, L.waiting, (t) => t),
      answeredWaits: keepNewest(done, L.answeredWaits, (t) => t),
    },
  };
}
