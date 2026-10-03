// MILO state model. Pure ESM with no DOM and no fs, so the renderer and the
// Electron main process share one definition of what a saved state looks like.
// Phase 4: the primitives live in clean.js, and the seven new sections' cleaners in state4.js.
import {
  isRecord, UNSAFE_KEYS, safeCopy, toTime, clip, cleanCount, cleanInt, cleanMap, keepNewest, cleanMapNewest, cleanRecentList,
  cleanDayKey, dayKeyStart, dayKey, dayNumber, SESSION_NAME_DAYS, withoutTitle,
} from './clean.js';
import {
  STATE4_KEYS, emptyState4, normalize4, emptyTally4, cleanTally4, emptySatchel4, cleanSatchel4, emptyStory4, cleanStory4,
  CREW_AGENTS,
} from './state4.js';
import { emptyBoard, cleanBoard, emptyPeople, cleanPeople, emptyCamplife, cleanCamplife } from './state5.js';
import { emptyCommissions, cleanCommissions } from './commissions.js';

export { toTime, clip, dayKey, dayNumber, dayStart, SESSION_NAME_DAYS, withoutTitle } from './clean.js';
export { markFact, markFeature, tallyAnswered } from './state4.js';

export const STATE_VERSION = 1;
export const DESIGNERS = Object.freeze(['auto', 'claude', 'codex', 'kit']);
// Phase 3: the ward-post holds one kind of signal back before it opens a rift (src/rifts.js).
export const WARD_POSTS = Object.freeze(['nights-off', 'patient-knock', 'capacity-95']);
// Phase 4: the HUD's two modes (Adventure is the default) and the Kindle bell.
export const HUD_MODES = Object.freeze(['adventure', 'quiet']);
export const DEFAULT_SETTINGS = Object.freeze({
  motion: true, notifications: true, greeting: true, designer: 'auto',
  eveningBell: '22:00', gateBell: true, wardPost: null, hud: 'adventure', kindleBell: true,
});

// Step 2: every place except Milo's camp, the watchtower and the fogged harbor is a plot.
export const PLOT_IDS = Object.freeze(['plot-meadow', 'plot-rise', 'plot-birch', 'plot-pond', 'plot-orchard']);
// Step 1 place ids, as they may still sit in a saved state (for example `panel: 'workshop'`).
export const LEGACY_PLACE_IDS = Object.freeze({
  workshop: 'plot-meadow',
  'clip-studio': 'plot-rise',
  library: 'plot-birch',
  'game-table': 'plot-pond',
  'building-site': 'plot-orchard',
});
export const PLOT_STATUSES = Object.freeze(['empty', 'designing', 'built']);
export const SUGGESTION_SOURCES = Object.freeze(['local', 'claude', 'codex']);
export const DESIGNED_BY = Object.freeze(['claude', 'codex', 'kit']);
export const LIMITS = Object.freeze({ title: 28, pitch: 110, why: 110, asked: 110, plotName: 28, suggestions: 3 });

// Phase 3: the Hearth, the satchel, the wilds, rifts and the story (CONTRACT-PHASE3 §4.6).
export const MATERIAL_IDS = Object.freeze(['birch', 'ash', 'pine']);
export const HEARTH_TIER_MAX = 8;
export const RIFT_STAGES = Object.freeze(['hairline', 'open', 'gaping']);
// 'closed': a rift that went quietly because a setting took its cause away (the evening bell
// switched off or moved past a Nocturne). Nothing was mended, so it pays no loot and counts nothing.
export const RIFT_HOWS = Object.freeze(['sealed', 'stitched', 'let-go', 'closed']);
/** How much of each list the state keeps, so the saved file stays well under its 2 MiB cap. */
export const STATE_LIMITS = Object.freeze({
  finishedIds: 400, relics: 200, essences: 300, explored: 20000, lanterns: 2000, opened: 5000, notes: 2000,
  glimmers: 500, felled: 2000, open: 60, warded: 200, letGo: 200, belled: 200, closedWild: 2000, visited: 300, history: 100,
});
const MAX_COUNT = 1e9;
const DAY_MS = 24 * 60 * 60 * 1000;
const EVENING_BELL = /^(\d{1,2}):(\d{2})$/;
const CHUNK_KEY = /^-?\d{1,6},-?\d{1,6}$/;
const LANTERN_ID = /^lantern:-?\d{1,7},-?\d{1,7}$/;
const POI_ID = /^poi:[a-z]{2,16}:-?\d{1,7},-?\d{1,7}$/;
const TREE_ID = /^tree:-?\d{1,7},-?\d{1,7}$/;
const RIFT_ID = /^rift:[0-9a-z]{1,13}$/;
const RIFT_KEY = /^(night|knock|capacity|built|story|stale|crowded|vague|due|check|failed|loop):\S{1,150}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const GENRE_ID = /^[a-z][a-z-]{1,23}$/;
const SIGNAL_ID = /^[a-z][a-z0-9-]{1,39}$/;
const AGENT_ID = /^[a-z][a-z0-9-]{0,19}$/;
const SIGNAL_KINDS = ['nocturne', 'knocking', 'capacity', 'built', 'story', 'stale', 'crowded', 'vague', 'due', 'check', 'failed', 'loop'];
const KIND_BY_PREFIX = { night: 'nocturne', knock: 'knocking', capacity: 'capacity', built: 'built', story: 'story', stale: 'stale', crowded: 'crowded', vague: 'vague', due: 'due', check: 'check', failed: 'failed', loop: 'loop' };
const ECHO_ICONS = ['moon', 'knocker', 'spark', 'star', 'crack'];

// Phase 4's sections come after `story` (CONTRACT-PHASE4 §8.1); a key missing here would be
// overwritten by its raw copy in `extras`.
const KNOWN_KEYS = ['version', 'user', 'milo', 'lastSeenAt', 'lastGreetedDay', 'settings', 'skills', 'panel', 'plots',
  'firstSeenAt', 'tally', 'hearth', 'satchel', 'wilds', 'rifts', 'story', ...STATE4_KEYS, 'board', 'people', 'camplife', 'commissions'];
const PLOT_KEYS = ['status', 'suggestions', 'asked', 'idea', 'blueprint', 'designedBy', 'builtAt', 'firstBuiltAt', 'name'];
const MAX_NAME = 40;
const MAX_ID = 64;
const MAX_TILE = 4096;
const MAX_LEVEL = 99;

// Stored blueprints are checked with the architect's validator (module E). If that module can't
// load, blueprints are kept exactly as saved rather than dropped, so a missing file never costs
// Chris a building on the next save.
let blueprintValidator = null;
let blueprintIdea = null;
try {
  const blueprintModule = await import('./architect/blueprint.js');
  if (typeof blueprintModule?.validateBlueprint === 'function') blueprintValidator = blueprintModule.validateBlueprint;
  if (typeof blueprintModule?.ideaFromText === 'function') blueprintIdea = blueprintModule.ideaFromText;
} catch {
  blueprintValidator = null;
}

function jsonCopy(value) {
  try {
    const copy = JSON.parse(JSON.stringify(value));
    return isRecord(copy) ? copy : null;
  } catch {
    return null;
  }
}

/**
 * A stored or freshly designed blueprint, repaired, or null when it can't be drawn.
 * Uses validateBlueprint from src/architect/blueprint.js when it is available.
 */
export function checkBlueprint(value) {
  if (!isRecord(value)) return null;
  if (blueprintValidator) {
    try {
      const result = blueprintValidator(value);
      return result && result.ok === true && isRecord(result.blueprint) ? result.blueprint : null;
    } catch {
      return null;
    }
  }
  const copy = jsonCopy(value);
  return copy && typeof copy.name === 'string' && Array.isArray(copy.levels) ? copy : null;
}

/** 'workshop' → 'plot-meadow'; every other id comes back unchanged. */
export function canonicalPlaceId(id) {
  if (typeof id !== 'string') return id;
  return Object.hasOwn(LEGACY_PLACE_IDS, id) ? LEGACY_PLACE_IDS[id] : id;
}

export const isPlotId = (id) => typeof id === 'string' && /^plot-[a-z0-9-]{1,40}$/.test(id);

function cleanName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return name || fallback;
}

function cleanId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= MAX_ID ? id : null;
}

function cleanTile(value) {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx > MAX_TILE || ty > MAX_TILE) return null;
  return { x: tx, y: ty };
}

/**
 * The evening bell as 'HH:MM' (24-hour, zero-padded), null when Chris turned it off, or
 * `fallback` for anything else. '7:30' reads as '07:30'.
 */
export function cleanEveningBell(value, fallback = DEFAULT_SETTINGS.eveningBell) {
  if (value === null) return null;
  if (typeof value !== 'string') return fallback;
  const match = EVENING_BELL.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function cleanSettings(value) {
  const out = safeCopy(value);
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof fallback !== 'boolean') continue;
    out[key] = typeof out[key] === 'boolean' ? out[key] : fallback;
  }
  out.designer = DESIGNERS.includes(out.designer) ? out.designer : DEFAULT_SETTINGS.designer;
  // A missing bell rings at the default hour; an explicit null means Chris turned it off.
  out.eveningBell = Object.hasOwn(out, 'eveningBell') ? cleanEveningBell(out.eveningBell) : DEFAULT_SETTINGS.eveningBell;
  out.wardPost = WARD_POSTS.includes(out.wardPost) ? out.wardPost : null;
  out.hud = HUD_MODES.includes(out.hud) ? out.hud : DEFAULT_SETTINGS.hud;
  return out;
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'idea';

/** A Suggestion with the contract's shape and limits, or null when it has no title. */
export function cleanSuggestion(value) {
  if (!isRecord(value)) return null;
  const title = clip(value.title, LIMITS.title);
  if (!title) return null;
  const id = cleanId(value.id);
  return {
    id: id && !UNSAFE_KEYS.has(id) ? id : `idea:${slug(title)}`,
    title,
    pitch: clip(value.pitch, LIMITS.pitch),
    why: clip(value.why, LIMITS.why),
    source: SUGGESTION_SOURCES.includes(value.source) ? value.source : 'local',
  };
}

/** Up to three clean suggestions, first of each id or title kept. */
export function cleanSuggestions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const suggestion = cleanSuggestion(entry);
    if (!suggestion) continue;
    const titleKey = `title:${suggestion.title.toLowerCase()}`;
    if (seen.has(suggestion.id) || seen.has(titleKey)) continue;
    seen.add(suggestion.id);
    seen.add(titleKey);
    out.push(suggestion);
    if (out.length === LIMITS.suggestions) break;
  }
  return out;
}

/**
 * Turns what Chris typed into a Suggestion the architect can design from. Uses the architect's
 * reading of it when available ('Clip studio: turns my streams into clips' → title 'Clip studio').
 */
export function ideaFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (blueprintIdea) {
    try {
      const idea = cleanSuggestion(blueprintIdea(text));
      if (idea) return idea;
    } catch {
      // fall through to the plain reading below
    }
  }
  const pitch = clip(text, LIMITS.pitch);
  if (!pitch) return null;
  let title = pitch.replace(/[.…]+$/, '');
  if (title.length > LIMITS.title) {
    const words = title.slice(0, LIMITS.title + 1).split(' ');
    title = words.length > 1 ? words.slice(0, -1).join(' ') : title.slice(0, LIMITS.title);
    const small = /^(a|an|the|my|of|for|to|and|that|with|in|on|so|i|me|which|who)$/i;
    const kept = title.split(' ');
    while (kept.length > 1 && small.test(kept[kept.length - 1])) kept.pop();
    title = kept.join(' ');
  }
  title = title.replace(/[\s,;:–—-]+$/, '');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return cleanSuggestion({ id: `yours:${slug(title)}`, title, pitch, why: 'Your own idea', source: 'local' });
}

/**
 * `builtAt` is when the building's current design landed (a redesign moves it). `firstBuiltAt` is
 * when a building first stood on the plot, kept across redesigns: the bright rift a new building
 * opens (src/rifts.js) is keyed on it, so a new look never opens a second one.
 */
export function emptyPlot() {
  return { status: 'empty', suggestions: [], asked: null, idea: null, blueprint: null, designedBy: null, builtAt: null, firstBuiltAt: null, name: null };
}

/** The earlier of two times, either of which may be null. */
function earliest(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * One plot, repaired. A leftover 'designing' (MILO closed mid-design) goes back to 'empty' with
 * its idea kept, so the panel can offer to try again; a redesign that was interrupted goes back to
 * the building it already had. A 'built' plot without a drawable blueprint is empty again.
 */
function cleanPlot(value) {
  const source = isRecord(value) ? value : {};
  const extras = safeCopy(source);
  for (const key of PLOT_KEYS) delete extras[key];

  let status = PLOT_STATUSES.includes(source.status) ? source.status : 'empty';
  let blueprint = source.blueprint == null ? null : checkBlueprint(source.blueprint);
  if (status === 'designing') status = blueprint ? 'built' : 'empty';
  if (status === 'built' && !blueprint) status = 'empty';
  const built = status === 'built';
  if (!built) blueprint = null;
  const asked = clip(source.asked, LIMITS.asked);
  const name = clip(source.name, LIMITS.plotName);
  const builtAt = built ? toTime(source.builtAt) : null;

  return {
    ...extras,
    status,
    suggestions: cleanSuggestions(source.suggestions),
    asked: asked || null,
    idea: cleanSuggestion(source.idea),
    blueprint,
    designedBy: built && DESIGNED_BY.includes(source.designedBy) ? source.designedBy : null,
    builtAt,
    // A building saved before firstBuiltAt existed has only builtAt, the best evidence there is.
    // It's never after the current design.
    firstBuiltAt: built ? earliest(toTime(source.firstBuiltAt), builtAt) : null,
    name: built && name ? name : null,
  };
}

/** Every known plot, plus any other valid plot id already saved. Old step 1 ids are carried over. */
function cleanPlots(value) {
  const input = isRecord(value) ? value : {};
  const out = {};
  for (const id of PLOT_IDS) out[id] = null;
  for (const key of Object.keys(input)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const id = canonicalPlaceId(key);
    if (!isPlotId(id)) continue;
    // A plot saved under its new id wins over the same plot under its old one.
    if (out[id] && key !== id) continue;
    out[id] = cleanPlot(input[key]);
  }
  for (const id of Object.keys(out)) if (!out[id]) out[id] = emptyPlot();
  return out;
}

function cleanLevel(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor(value)));
}

function cleanSkills(value) {
  const out = {};
  if (!isRecord(value)) return out;
  for (const key of Object.keys(value)) {
    const id = cleanId(key);
    if (!id || UNSAFE_KEYS.has(id)) continue;
    const entry = value[key];
    if (isRecord(entry)) {
      out[id] = { ...safeCopy(entry), level: cleanLevel(entry.level), provenAt: toTime(entry.provenAt) };
    } else if (typeof entry === 'number') {
      out[id] = { level: cleanLevel(entry), provenAt: null };
    }
  }
  return out;
}

const clockOf = (now) => (typeof now === 'number' && Number.isFinite(now) ? now : Date.now());

// ---------------------------------------------------------------------------
// Phase 3 cleaners. Each takes whatever was saved and returns a well-formed value, keeping
// unknown sub-keys where a record allows them, so a newer MILO's fields survive an older one.
// The primitives (cleanCount, cleanInt, cleanMap, keepNewest, cleanRecentList…) are clean.js's.

/** { x, y } with signed whole coordinates (the wilds reach negative tiles), or null. */
function cleanWorldTile(value) {
  if (!isRecord(value)) return null;
  const x = cleanInt(value.x);
  const y = cleanInt(value.y);
  return x === null || y === null ? null : { x, y };
}

const isSessionId = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID && !/\s/.test(id);

/** The times MILO has evidence Chris had it open: skills proven, buildings built, last seen, last greeted. */
function evidenceTimes({ skills, plots, lastSeenAt, lastGreetedDay }) {
  const times = [];
  for (const skill of Object.values(skills)) if (skill.provenAt) times.push(skill.provenAt);
  for (const plot of Object.values(plots)) {
    if (plot.status !== 'built') continue;
    if (plot.builtAt) times.push(plot.builtAt);
    if (plot.firstBuiltAt && plot.firstBuiltAt !== plot.builtAt) times.push(plot.firstBuiltAt);
  }
  if (lastSeenAt) times.push(lastSeenAt);
  const greeted = dayKeyStart(lastGreetedDay);
  if (greeted) times.push(greeted);
  return times;
}

function cleanFirstSeenAt(value, evidence, lastSeenAt, now) {
  let first = toTime(value);
  if (first === null && evidence.length) first = Math.min(...evidence);
  if (first === null) return null;
  if (lastSeenAt !== null && first > lastSeenAt) first = lastSeenAt;
  return Math.min(first, Math.round(now));
}

/** The least number of designs the plots and skills prove: a standing building, or Tinkering level 1. */
function designsProven(plots, skills) {
  const standing = Object.values(plots).filter((plot) => plot.status === 'built').length;
  return Math.max(standing, (skills.tinkering?.level ?? 0) >= 1 ? 1 : 0);
}

/** Phase 3's counts, then Phase 4's (byCrew, answered, answeredFast, waiting, … features: state4.js). */
export function emptyTally() {
  return { daysSeen: 0, lastDay: null, sessionsFinished: 0, finishedIds: [], buildingsDesigned: 0, ...emptyTally4() };
}

/** Runs a Phase 4 cleaner of an old section's fields on its own, so a throw there costs only those fields. */
function phase4Part(clean, empty) {
  try {
    return clean();
  } catch {
    return empty();
  }
}

/**
 * The last day counted, unless a clock that ran ahead left it more than a day past today: then
 * it's today, so days count again from tomorrow instead of stalling until the real date catches
 * up. A day ahead is allowed for, so a clock put right around midnight, or a move to a time zone
 * further west, never counts the same day twice.
 */
function sensibleLastDay(lastDay, now) {
  if (lastDay === null) return null;
  const today = dayKey(now);
  const ahead = dayNumber(dayKeyStart(lastDay)) - dayNumber(now);
  return ahead > 1 ? today : lastDay;
}

/**
 * The Hearth's real counts. A state from before Phase 3 has no tally, so it is seeded honestly
 * from what the state proves: the distinct days in its evidence, and the designs its plots or
 * Tinkering skill show. A saved tally is kept as it is, with its counts made whole.
 */
function cleanTally(value, { evidence, plots, skills, now }) {
  const designs = designsProven(plots, skills);
  if (!isRecord(value)) {
    // Evidence already holds the greeted day (at its local midnight), so each day counts once.
    const sorted = [...new Set(evidence.map((ms) => dayKey(ms)))].sort();
    return { ...emptyTally(), daysSeen: sorted.length, lastDay: sorted.length ? sorted[sorted.length - 1] : null, buildingsDesigned: designs };
  }
  const finishedIds = cleanRecentList(value.finishedIds, isSessionId, STATE_LIMITS.finishedIds);
  const sessionsFinished = Math.max(cleanCount(value.sessionsFinished), finishedIds.length);
  return {
    ...safeCopy(value),
    daysSeen: cleanCount(value.daysSeen),
    lastDay: sensibleLastDay(cleanDayKey(value.lastDay), now),
    sessionsFinished,
    finishedIds,
    buildingsDesigned: Math.max(cleanCount(value.buildingsDesigned), designs),
    ...phase4Part(() => cleanTally4(value, { finishedIds, sessionsFinished }), emptyTally4),
  };
}

function cleanHearth(value) {
  const source = isRecord(value) ? value : {};
  const tier = typeof source.tier === 'number' && Number.isFinite(source.tier) ? Math.floor(source.tier) : 1;
  return {
    ...safeCopy(source),
    tier: Math.min(HEARTH_TIER_MAX, Math.max(1, tier)),
    raisedAt: cleanMap(source.raisedAt, (key) => SLUG.test(key), toTime),
  };
}

/**
 * `essenceGenres` names the genre each essence came from ({ 'Neon shard': 'neon' }), as its loot
 * said, so the Hearth can count essences of different genres rather than different names.
 */
export function emptySatchel() {
  return { materials: { birch: 0, ash: 0, pine: 0 }, essences: {}, essenceGenres: {}, relics: [], ...emptySatchel4() };
}

/** A relic from a rift's loot: { name, text, genre, at }, or null without a name. */
function cleanRelic(value) {
  if (!isRecord(value)) return null;
  const name = clip(value.name, 80);
  if (!name) return null;
  const genre = typeof value.genre === 'string' && GENRE_ID.test(value.genre) ? value.genre : null;
  return { name, text: clip(value.text, 220), genre, at: toTime(value.at) };
}

/**
 * Essence names as content/riftgen.json writes them now, with curly apostrophes: one saved as
 * "Sheriff's star" is the "Sheriff’s star" rifts leave today, so the two make one pile.
 */
function curlyNames(value, merge) {
  if (!isRecord(value)) return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const name = key.replace(/'/g, '’');
    out[name] = Object.hasOwn(out, name) ? merge(out[name], value[key]) : value[key];
  }
  return out;
}
const addCounts = (a, b) => cleanCount(a) + cleanCount(b);
const firstGenre = (a, b) => (typeof a === 'string' && GENRE_ID.test(a) ? a : b);

function cleanSatchel(value) {
  const source = isRecord(value) ? value : {};
  const materials = cleanMap(source.materials, (key) => SLUG.test(key), (n) => cleanCount(n));
  for (const id of MATERIAL_IDS) materials[id] = materials[id] ?? 0;
  const essences = keepNewest(
    cleanMap(curlyNames(source.essences, addCounts), (key) => key.length > 0 && key.length <= 60 && key === key.trim(), (n) => cleanCount(n) || null),
    STATE_LIMITS.essences,
    (n) => n,
  );
  // A genre is kept only for an essence the satchel holds.
  const essenceGenres = cleanMap(curlyNames(source.essenceGenres, firstGenre), (key) => Object.hasOwn(essences, key), (genre) => (typeof genre === 'string' && GENRE_ID.test(genre) ? genre : null));
  const relics = Array.isArray(source.relics) ? source.relics.map(cleanRelic).filter(Boolean).slice(-STATE_LIMITS.relics) : [];
  return { ...safeCopy(source), materials, essences, essenceGenres, relics, ...phase4Part(() => cleanSatchel4(source), emptySatchel4) };
}

export const DEFAULT_WORLD_SEED = 'hushlands';

export function emptyWilds() {
  return { seed: DEFAULT_WORLD_SEED, at: null, wake: null, explored: [], lanterns: {}, opened: {}, notes: {}, glimmers: {}, felled: {} };
}

function cleanSeed(value) {
  return typeof value === 'string' && value.length <= 64 && value.trim() ? value : DEFAULT_WORLD_SEED;
}

const byTime = (limit, keyOk) => (value) => cleanMapNewest(value, keyOk, toTime, limit, (t) => t);

function cleanWilds(value, now) {
  const source = isRecord(value) ? value : {};
  const today = dayNumber(now);
  const felled = cleanMapNewest(source.felled, (key) => TREE_ID.test(key), (day) => {
    const n = cleanInt(day, 1e8);
    return n !== null && n >= today ? n : null; // a stump from an earlier day has grown back
  }, STATE_LIMITS.felled, (day) => day);
  return {
    ...safeCopy(source),
    seed: cleanSeed(source.seed),
    at: cleanWorldTile(source.at),
    wake: typeof source.wake === 'string' && LANTERN_ID.test(source.wake) ? source.wake : null,
    explored: cleanRecentList(source.explored, (key) => CHUNK_KEY.test(key), STATE_LIMITS.explored),
    lanterns: byTime(STATE_LIMITS.lanterns, (key) => LANTERN_ID.test(key))(source.lanterns),
    opened: byTime(STATE_LIMITS.opened, (key) => POI_ID.test(key))(source.opened),
    notes: byTime(STATE_LIMITS.notes, (key) => POI_ID.test(key))(source.notes),
    glimmers: byTime(STATE_LIMITS.glimmers, (key) => POI_ID.test(key))(source.glimmers),
    felled,
  };
}

export function emptyRifts() {
  return {
    open: {}, warded: {}, letGo: {}, belled: {}, closedWild: {}, visited: {},
    stitched: { real: 0, wild: 0, story: 0 }, deepest: 0, history: [],
  };
}

function cleanGenres(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && GENRE_ID.test(id)))].slice(0, 4);
}

/** A rift's loot, as riftgen makes it: [{ item, qty, genre, relic?, text? }]. */
export function cleanLoot(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const item = clip(entry.item, 120);
    const qty = cleanCount(entry.qty, 9999);
    if (!item || !qty) continue;
    const clean = { item, qty, genre: typeof entry.genre === 'string' && GENRE_ID.test(entry.genre) ? entry.genre : null };
    if (entry.relic === true) {
      clean.relic = true;
      clean.text = clip(entry.text, 220);
    }
    out.push(clean);
    if (out.length === 12) break;
  }
  return out;
}

function cleanEcho(value) {
  if (!isRecord(value)) return null;
  const place = cleanId(value.place);
  if (!place || UNSAFE_KEYS.has(place) || !ECHO_ICONS.includes(value.icon)) return null;
  return { place, icon: value.icon };
}

const cleanUrgency = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 1000) / 1000)) : 0);

/**
 * A rift open now. Beyond the contract's { id, since, openedAt, kind } it keeps what a seal
 * needs once the signal has gone (name, genres, loot) and what keeps the rift standing while
 * the watcher can't see (the signal's own words), so a hiccup never seals everything.
 */
function cleanOpenRift(value, key) {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && RIFT_ID.test(value.id) ? value.id : null;
  const since = toTime(value.since);
  if (!id || !since) return null;
  const prefix = key.slice(0, key.indexOf(':'));
  const signals = Array.isArray(value.signals) ? [...new Set(value.signals.filter((s) => typeof s === 'string' && SIGNAL_ID.test(s)))].slice(0, 6) : [];
  const out = {
    ...safeCopy(value),
    id,
    since,
    openedAt: toTime(value.openedAt) ?? since,
    kind: prefix === 'story' ? 'story' : 'real',
    realKind: SIGNAL_KINDS.includes(value.realKind) ? value.realKind : KIND_BY_PREFIX[prefix],
    name: clip(value.name, 120),
    genres: cleanGenres(value.genres),
    loot: cleanLoot(value.loot),
    signals,
    subject: clip(value.subject, 40),
    urgency: cleanUrgency(value.urgency),
    cause: clip(value.cause, 160),
    stitch: clip(value.stitch, 140),
    echo: cleanEcho(value.echo),
    bright: value.bright === true,
  };
  if (isSessionId(value.sessionId)) out.sessionId = value.sessionId;
  else delete out.sessionId;
  // The agents whose sessions are behind a Nocturne, so a hiccup in one of their sources carries it.
  const agents = Array.isArray(value.agents) ? [...new Set(value.agents.filter((a) => typeof a === 'string' && AGENT_ID.test(a)))].slice(0, 4) : [];
  if (agents.length) out.agents = agents;
  else delete out.agents;
  // The evening bell a Nocturne stood under, so moving the bell later closes it quietly rather than sealing it.
  const bell = out.realKind === 'nocturne' && typeof value.bell === 'string' ? cleanEveningBell(value.bell, null) : null;
  if (bell) out.bell = bell;
  else delete out.bell;
  // An episode standing again after it sealed: it closes quietly, and never pays out twice.
  if (value.resumed === true) out.resumed = true;
  else delete out.resumed;
  return out;
}

function cleanSinceAt(value) {
  if (!isRecord(value)) return null;
  const since = toTime(value.since);
  const at = toTime(value.at);
  return since && at ? { ...safeCopy(value), since, at } : null;
}

function cleanWard(value, now) {
  if (!isRecord(value)) return null;
  const since = toTime(value.since);
  const until = toTime(value.until);
  if (!since || !until || until <= now || !RIFT_STAGES.includes(value.stage)) return null; // an expired ward is gone
  return { ...safeCopy(value), since, until, stage: value.stage };
}

// The War Table lists closed rifts for SESSION_NAME_DAYS (clean.js); after that, a Knocking's name
// in the history no longer carries the title of the session it stood for (clean.js withoutTitle).
function cleanHistoryEntry(value, now) {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && RIFT_ID.test(value.id) ? value.id : null;
  const closedAt = toTime(value.closedAt);
  if (!id || !closedAt || !RIFT_HOWS.includes(value.how)) return null;
  const kind = ['real', 'story', 'wild'].includes(value.kind) ? value.kind : 'real';
  const key = typeof value.key === 'string' && RIFT_KEY.test(value.key) ? value.key : null;
  let name = clip(value.name, 120);
  if (key !== null && key.startsWith('knock:') && closedAt < now - SESSION_NAME_DAYS * DAY_MS) name = withoutTitle(name);
  const out = {
    ...safeCopy(value),
    key: kind === 'wild' ? null : key,
    id,
    name,
    genres: cleanGenres(value.genres),
    kind,
    openedAt: toTime(value.openedAt),
    closedAt,
    how: value.how,
  };
  // The episode's own since, so the same episode seen again is known for one that already closed.
  const since = kind === 'wild' ? null : toTime(value.since);
  if (since) out.since = since;
  else delete out.since;
  return out;
}

function cleanRifts(value, now) {
  const source = isRecord(value) ? value : {};
  const today = dayNumber(now);
  const isKey = (key) => RIFT_KEY.test(key);
  const isRift = (key) => RIFT_ID.test(key);
  const stitched = isRecord(source.stitched) ? source.stitched : {};
  return {
    ...safeCopy(source),
    open: cleanMapNewest(source.open, isKey, cleanOpenRift, STATE_LIMITS.open, (entry) => entry.openedAt),
    warded: cleanMapNewest(source.warded, isKey, (entry) => cleanWard(entry, now), STATE_LIMITS.warded, (entry) => entry.until),
    letGo: cleanMapNewest(source.letGo, isKey, cleanSinceAt, STATE_LIMITS.letGo, (entry) => entry.at),
    belled: cleanMapNewest(source.belled, isKey, cleanSinceAt, STATE_LIMITS.belled, (entry) => entry.at),
    closedWild: cleanMapNewest(source.closedWild, isRift, (day) => {
      const n = cleanInt(day, 1e8);
      return n !== null && n >= today ? n : null; // wild rifts close with the day
    }, STATE_LIMITS.closedWild, (day) => day),
    visited: cleanMapNewest(source.visited, isRift, toTime, STATE_LIMITS.visited, (t) => t),
    stitched: { ...safeCopy(stitched), real: cleanCount(stitched.real), wild: cleanCount(stitched.wild), story: cleanCount(stitched.story) },
    deepest: cleanCount(source.deepest),
    history: Array.isArray(source.history) ? source.history.map((entry) => cleanHistoryEntry(entry, now)).filter(Boolean).slice(0, STATE_LIMITS.history) : [],
  };
}

export function emptyStory() {
  return { prologue: { done: {} }, letterReadAt: null, trackerHidden: false, ...emptyStory4() };
}

function cleanStory(value) {
  const source = isRecord(value) ? value : {};
  const prologue = isRecord(source.prologue) ? source.prologue : {};
  return {
    ...safeCopy(source),
    prologue: { ...safeCopy(prologue), done: cleanMap(prologue.done, (key) => SLUG.test(key), toTime) },
    letterReadAt: toTime(source.letterReadAt),
    trackerHidden: source.trackerHidden === true,
    // Act I's chapters (src/acts.js), present once one is done.
    ...(isRecord(source.act1) ? { act1: { ...safeCopy(source.act1), done: cleanMap(source.act1.done, (key) => SLUG.test(key), toTime) } } : {}),
    ...phase4Part(() => cleanStory4(source), emptyStory4),
  };
}

/**
 * A fresh state. `lastSeenAt` starts null so the first launch reads as a first visit.
 * `now` is accepted for symmetry with normalizeState; a new state holds no timestamps yet.
 * Phase 4's seven sections follow `story` (state4.js).
 */
// eslint-disable-next-line no-unused-vars
export function createState(now = Date.now()) {
  return {
    version: STATE_VERSION,
    user: { name: 'Chris' },
    milo: { name: 'Milo', tile: null },
    lastSeenAt: null,
    lastGreetedDay: null,
    settings: { ...DEFAULT_SETTINGS },
    skills: {},
    panel: null,
    plots: Object.fromEntries(PLOT_IDS.map((id) => [id, emptyPlot()])),
    firstSeenAt: null,
    tally: emptyTally(),
    hearth: { tier: 1, raisedAt: {} },
    satchel: emptySatchel(),
    wilds: emptyWilds(),
    rifts: emptyRifts(),
    story: emptyStory(),
    ...emptyState4(),
    board: emptyBoard(),
    people: emptyPeople(),
    camplife: emptyCamplife(),
    commissions: emptyCommissions(),
  };
}

function normalize(input, now) {
  let source = input;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  if (!isRecord(source)) return createState(now);

  const extras = safeCopy(source);
  for (const key of KNOWN_KEYS) delete extras[key];

  const user = safeCopy(source.user);
  user.name = cleanName(source.user?.name, 'Chris');

  const milo = safeCopy(source.milo);
  milo.name = cleanName(source.milo?.name, 'Milo');
  milo.tile = cleanTile(source.milo?.tile);

  let lastSeenAt = toTime(source.lastSeenAt);
  // A clock that jumped backwards should not leave Milo thinking Chris looks in from the future.
  if (lastSeenAt !== null && lastSeenAt > now) lastSeenAt = Math.round(now);
  const lastGreetedDay = cleanDayKey(source.lastGreetedDay);
  const skills = cleanSkills(source.skills);
  const plots = cleanPlots(source.plots);
  const evidence = evidenceTimes({ skills, plots, lastSeenAt, lastGreetedDay }).filter((ms) => ms <= now);
  const tally = cleanTally(source.tally, { evidence, plots, skills, now });

  return {
    version: STATE_VERSION,
    user,
    milo,
    lastSeenAt,
    lastGreetedDay,
    settings: cleanSettings(source.settings),
    skills,
    panel: canonicalPlaceId(cleanId(source.panel)),
    plots,
    firstSeenAt: cleanFirstSeenAt(source.firstSeenAt, evidence, lastSeenAt, now),
    tally,
    hearth: cleanHearth(source.hearth),
    satchel: cleanSatchel(source.satchel),
    wilds: cleanWilds(source.wilds, now),
    rifts: cleanRifts(source.rifts, now),
    story: cleanStory(source.story),
    // Phase 4: each of the seven sections is cleaned on its own (a throw costs only that section).
    ...normalize4(source, { now, tally }),
    // Phase 5: the board of quests, cleaned on its own.
    board: phase4Part(() => cleanBoard(source.board, { now }), emptyBoard),
    people: phase4Part(() => cleanPeople(source.people, { now }), emptyPeople),
    camplife: phase4Part(() => cleanCamplife(source.camplife), emptyCamplife),
    commissions: phase4Part(() => cleanCommissions(source.commissions, { now }), emptyCommissions),
    ...extras,
  };
}

/** Repairs anything loaded from disk into a valid state. Never throws; keeps unknown fields. */
export function normalizeState(input, now = Date.now()) {
  const clock = clockOf(now);
  try {
    return normalize(input, clock);
  } catch {
    return createState(clock);
  }
}

/**
 * True when a parsed state file has the shape MILO saves: a plain object with `settings`,
 * `milo` and `user` objects. MILO never writes anything else, so any other value (null, [],
 * a number, {}) is a damaged file, and the loader should fall back to the backup rather than
 * start fresh and overwrite that backup.
 */
export function looksLikeSavedState(value) {
  return isRecord(value) && isRecord(value.settings) && isRecord(value.milo) && isRecord(value.user);
}

/**
 * Records that Chris is looking at MILO right now. Sets `lastSeenAt` on the given state
 * object and returns it, so both `markSeen(state, t)` and `state = markSeen(state, t)` work.
 * Phase 3: the first look sets `firstSeenAt`, and each new local day counts once towards
 * `tally.daysSeen` (a fresh tally object is assigned; the old one is never changed in place).
 */
export function markSeen(state, now = Date.now()) {
  const at = toTime(now) ?? Date.now();
  const day = dayKey(at);
  if (!isRecord(state)) {
    return { ...createState(at), lastSeenAt: at, firstSeenAt: at, tally: { ...emptyTally(), daysSeen: 1, lastDay: day } };
  }
  const tally = isRecord(state.tally) ? state.tally : emptyTally();
  const saved = cleanDayKey(tally.lastDay);
  const lastDay = sensibleLastDay(saved, at);
  // Day keys sort as dates, so a clock that jumps back never counts a day twice. A last day far
  // ahead (a clock that ran ahead) is brought back to today without counting it.
  let nextTally = null;
  if (lastDay === null || day > lastDay) nextTally = { ...tally, daysSeen: cleanCount(tally.daysSeen) + 1, lastDay: day };
  else if (lastDay !== saved) nextTally = { ...tally, lastDay };
  const firstSeenAt = toTime(state.firstSeenAt) ?? at;
  try {
    state.lastSeenAt = at;
    if (state.firstSeenAt !== firstSeenAt) state.firstSeenAt = firstSeenAt;
    if (nextTally) state.tally = nextTally;
    return state;
  } catch {
    // frozen or read-only input
    return { ...state, lastSeenAt: at, firstSeenAt, ...(nextTally ? { tally: nextTally } : {}) };
  }
}

// dayKey, dayNumber and dayStart (the local calendar) are clean.js's, re-exported above.

// ---------------------------------------------------------------------------
// Plots. Small pure steps the renderer uses, so the rules live in one tested place.
// Each returns a new state and leaves the one it was given alone.

function withPlot(state, plotId, make) {
  const base = isRecord(state) ? state : createState();
  const plots = isRecord(base.plots) ? base.plots : {};
  const current = isRecord(plots[plotId]) ? plots[plotId] : emptyPlot();
  return { ...base, plots: { ...plots, [plotId]: make(current) } };
}

/** The plot's state, or a fresh empty plot. */
export function plotOf(state, plotId) {
  const plot = isRecord(state) && isRecord(state.plots) ? state.plots[plotId] : null;
  return isRecord(plot) ? plot : emptyPlot();
}

/** What the building on a plot is called: Chris's rename, else the blueprint's name. */
export function buildingName(plot) {
  if (!isRecord(plot) || plot.status !== 'built') return '';
  return clip(plot.name, LIMITS.plotName) || clip(plot.blueprint?.name, LIMITS.plotName);
}

/** Names of the buildings on built plots, in plot order. */
export function builtNames(state) {
  const plots = isRecord(state) && isRecord(state.plots) ? state.plots : {};
  return Object.values(plots).map(buildingName).filter(Boolean);
}

/** The 3 suggestions shown on an empty plot (and what was asked, when they came from a question). */
export function setSuggestions(state, plotId, suggestions, asked = null) {
  return withPlot(state, plotId, (plot) => ({
    ...plot,
    suggestions: cleanSuggestions(suggestions),
    asked: clip(asked, LIMITS.asked) || null,
  }));
}

/** The crew starts designing: the plot becomes a building site. A built plot keeps its building until the new one lands. */
export function startDesign(state, plotId, idea) {
  const clean = cleanSuggestion(idea);
  return withPlot(state, plotId, (plot) => ({ ...plot, status: 'designing', idea: clean || plot.idea || null }));
}

/**
 * The design landed. Returns the new state; the plot is 'built' only when the blueprint can be
 * drawn, otherwise it goes back to what it was before the design started.
 * `keepPlan`: a redesign that only changes the look. The building keeps its name, tagline, purpose
 * and level tree (the plan Dispatch builds from) and takes the new look: style, emblem, props, yard.
 */
export function finishDesign(state, plotId, { blueprint, by } = {}, now = Date.now(), { keepPlan = false } = {}) {
  const checked = checkBlueprint(blueprint);
  if (!checked) return stopDesign(state, plotId);
  const before = plotOf(state, plotId);
  // A first design (the plot had no building) counts towards the Stockade; a redesign doesn't.
  const firstDesign = !(before.blueprint && checkBlueprint(before.blueprint));
  const at = toTime(now) ?? Date.now();
  // A redesign is a new look for the same building: it keeps the day the building first stood.
  const firstBuiltAt = firstDesign ? at : Math.min(at, earliest(toTime(before.firstBuiltAt), toTime(before.builtAt)) ?? at);
  const next = withPlot(state, plotId, (plot) => ({
    ...plot,
    status: 'built',
    blueprint: keepPlan ? keptPlan(plot.blueprint, checked) : checked,
    designedBy: DESIGNED_BY.includes(by) ? by : 'kit',
    builtAt: at,
    firstBuiltAt,
    // A redesign keeps Chris's own name for the place; a first design starts from the blueprint's.
    name: plot.blueprint && plot.name ? plot.name : null,
  }));
  if (!firstDesign) return next;
  const tally = isRecord(next.tally) ? next.tally : emptyTally();
  return { ...next, tally: { ...tally, buildingsDesigned: cleanCount(tally.buildingsDesigned) + 1 } };
}

/** The old building's plan with the new design's look, or the new design when there was no plan to keep. */
function keptPlan(previous, next) {
  const old = previous ? checkBlueprint(previous) : null;
  if (!old) return next;
  return checkBlueprint({ ...next, name: old.name, tagline: old.tagline, purpose: old.purpose, levels: old.levels }) || next;
}

/** Cancelled or failed: back to the building that was there, or to an empty plot that remembers the idea. */
export function stopDesign(state, plotId, { keepIdea = true } = {}) {
  return withPlot(state, plotId, (plot) => {
    const blueprint = plot.blueprint ? checkBlueprint(plot.blueprint) : null;
    if (blueprint) return { ...plot, status: 'built', blueprint };
    return { ...plot, status: 'empty', blueprint: null, designedBy: null, builtAt: null, firstBuiltAt: null, name: null, idea: keepIdea ? plot.idea ?? null : null };
  });
}

/** Chris's own name for a building. An empty name goes back to the blueprint's. */
export function renamePlot(state, plotId, name) {
  return withPlot(state, plotId, (plot) => {
    if (plot.status !== 'built') return plot;
    const clean = clip(name, LIMITS.plotName);
    return { ...plot, name: clean && clean !== clip(plot.blueprint?.name, LIMITS.plotName) ? clean : null };
  });
}

/** Takes the building down. Suggestions start fresh, since what's built nearby has changed. */
export function clearPlot(state, plotId) {
  return withPlot(state, plotId, (plot) => {
    const extras = safeCopy(plot);
    for (const key of PLOT_KEYS) delete extras[key];
    return { ...extras, ...emptyPlot() };
  });
}

// ---------------------------------------------------------------------------
// Phase 3 counts and the wilds. Each returns a new state (or the same one when nothing changed).

/**
 * Counts crew sessions MILO watched finish, for the Stockade. A session counts once, the first
 * time it has a finished turn after `firstSeenAt` (and not after `now`). With no `firstSeenAt`
 * yet, nothing earlier than `now` counts. `sessions` is an AgentSession[] or a snapshot.
 * Phase 4: each session counted also counts for its agent in `tally.byCrew` (the agent from
 * `session.agent`, else the id's prefix), so `byCrew` never exceeds `sessionsFinished`.
 */
export function tallyFinished(state, sessions, now = Date.now()) {
  if (!isRecord(state)) return state;
  const list = Array.isArray(sessions) ? sessions : (isRecord(sessions) && Array.isArray(sessions.sessions) ? sessions.sessions : []);
  const clock = clockOf(now);
  const from = toTime(state.firstSeenAt) ?? clock;
  const tally = isRecord(state.tally) ? state.tally : emptyTally();
  const known = new Set(Array.isArray(tally.finishedIds) ? tally.finishedIds : []);
  const added = [];
  const byCrew = { ...(isRecord(tally.byCrew) ? tally.byCrew : {}) };
  for (const session of list) {
    if (!isRecord(session) || !isSessionId(session.id) || known.has(session.id)) continue;
    const completions = Array.isArray(session.completions) ? session.completions : [];
    if (!completions.some((t) => typeof t === 'number' && t > from && t <= clock)) continue;
    known.add(session.id);
    added.push(session.id);
    const agent = typeof session.agent === 'string' && session.agent ? session.agent : session.id.split(':')[0];
    if (CREW_AGENTS.includes(agent)) byCrew[agent] = cleanCount(byCrew[agent]) + 1;
  }
  if (!added.length) return state;
  const finishedIds = [...(Array.isArray(tally.finishedIds) ? tally.finishedIds : []), ...added].slice(-STATE_LIMITS.finishedIds);
  for (const agent of CREW_AGENTS) byCrew[agent] = cleanCount(byCrew[agent]);
  return { ...state, tally: { ...tally, sessionsFinished: cleanCount(tally.sessionsFinished) + added.length, finishedIds, byCrew } };
}

function withSection(state, key, empty, make) {
  const base = isRecord(state) ? state : createState();
  const current = isRecord(base[key]) ? base[key] : empty();
  const next = make(current);
  return next === current ? base : { ...base, [key]: next };
}

/** Adds logs (or any material) to the satchel: addMaterials(state, { birch: 5 }). Whole, non-negative amounts only. */
export function addMaterials(state, materials) {
  return withSection(state, 'satchel', emptySatchel, (satchel) => {
    const current = isRecord(satchel.materials) ? satchel.materials : {};
    const next = { ...current };
    let changed = false;
    for (const [id, amount] of Object.entries(isRecord(materials) ? materials : {})) {
      const n = cleanCount(amount);
      if (!n || !SLUG.test(id)) continue;
      next[id] = Math.min(MAX_COUNT, cleanCount(current[id]) + n);
      changed = true;
    }
    return changed ? { ...satchel, materials: next } : satchel;
  });
}

/** Marks a tree felled on `day` (a dayNumber): it stands as a stump until the day has passed. */
export function markFelled(state, treeId, day) {
  const n = cleanInt(day, 1e8);
  if (typeof treeId !== 'string' || !TREE_ID.test(treeId) || n === null) return isRecord(state) ? state : createState();
  return withSection(state, 'wilds', emptyWilds, (wilds) => {
    const felled = isRecord(wilds.felled) ? wilds.felled : {};
    return felled[treeId] === n ? wilds : { ...wilds, felled: { ...felled, [treeId]: n } };
  });
}

/** Lights a lantern (once; the first lighting time is kept). */
export function lightLantern(state, lanternId, now = Date.now()) {
  if (typeof lanternId !== 'string' || !LANTERN_ID.test(lanternId)) return isRecord(state) ? state : createState();
  return withSection(state, 'wilds', emptyWilds, (wilds) => {
    const lanterns = isRecord(wilds.lanterns) ? wilds.lanterns : {};
    return toTime(lanterns[lanternId]) ? wilds : { ...wilds, lanterns: { ...lanterns, [lanternId]: toTime(now) ?? Date.now() } };
  });
}

/** Records a point of interest as opened ('opened'), read ('notes') or heard ('glimmers'), once. */
export function markPoi(state, list, poiId, now = Date.now()) {
  if (!['opened', 'notes', 'glimmers'].includes(list) || typeof poiId !== 'string' || !POI_ID.test(poiId)) return isRecord(state) ? state : createState();
  return withSection(state, 'wilds', emptyWilds, (wilds) => {
    const map = isRecord(wilds[list]) ? wilds[list] : {};
    return toTime(map[poiId]) ? wilds : { ...wilds, [list]: { ...map, [poiId]: toTime(now) ?? Date.now() } };
  });
}

/** Adds newly seen chunk keys ('cx,cy') to the fog-of-war list, oldest dropped past the cap. */
export function markExplored(state, keys) {
  const fresh = (Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && CHUNK_KEY.test(key));
  if (!fresh.length) return isRecord(state) ? state : createState();
  return withSection(state, 'wilds', emptyWilds, (wilds) => {
    const explored = Array.isArray(wilds.explored) ? wilds.explored : [];
    const seen = new Set(explored);
    const added = [...new Set(fresh)].filter((key) => !seen.has(key));
    return added.length ? { ...wilds, explored: [...explored, ...added].slice(-STATE_LIMITS.explored) } : wilds;
  });
}
