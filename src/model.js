// MILO state model. Pure ESM with no DOM and no fs, so the renderer and the
// Electron main process share one definition of what a saved state looks like.

export const STATE_VERSION = 1;
export const DESIGNERS = Object.freeze(['auto', 'claude', 'codex', 'kit']);
export const DEFAULT_SETTINGS = Object.freeze({ motion: true, notifications: true, greeting: true, designer: 'auto' });

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

const KNOWN_KEYS = ['version', 'user', 'milo', 'lastSeenAt', 'lastGreetedDay', 'settings', 'skills', 'panel', 'plots'];
const PLOT_KEYS = ['status', 'suggestions', 'asked', 'idea', 'blueprint', 'designedBy', 'builtAt', 'name'];
// Keys that could reach an object's prototype if copied blindly from parsed JSON.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_NAME = 40;
const MAX_ID = 64;
const MAX_TILE = 4096;
const MAX_LEVEL = 99;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

/** Own enumerable fields of a record, minus prototype-reaching keys. Shallow. */
function safeCopy(value) {
  const out = {};
  if (!isRecord(value)) return out;
  for (const key of Object.keys(value)) {
    if (!UNSAFE_KEYS.has(key)) out[key] = value[key];
  }
  return out;
}

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

/** A positive ms epoch, or null. Accepts numbers, numeric strings, ISO strings and Dates. */
export function toTime(value) {
  let ms = value;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'string') {
    const text = value.trim();
    ms = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Date.parse(text);
  }
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms);
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

function cleanDayKey(value) {
  if (typeof value !== 'string') return null;
  const match = DAY_KEY.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects impossible dates such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return value.trim();
}

function cleanSettings(value) {
  const out = safeCopy(value);
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (key === 'designer') continue;
    out[key] = typeof out[key] === 'boolean' ? out[key] : fallback;
  }
  out.designer = DESIGNERS.includes(out.designer) ? out.designer : DEFAULT_SETTINGS.designer;
  return out;
}

/** Collapses whitespace and shortens to `max` with an ellipsis, never splitting a surrogate pair. */
export function clip(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(1, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
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

export function emptyPlot() {
  return { status: 'empty', suggestions: [], asked: null, idea: null, blueprint: null, designedBy: null, builtAt: null, name: null };
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

  return {
    ...extras,
    status,
    suggestions: cleanSuggestions(source.suggestions),
    asked: asked || null,
    idea: cleanSuggestion(source.idea),
    blueprint,
    designedBy: built && DESIGNED_BY.includes(source.designedBy) ? source.designedBy : null,
    builtAt: built ? toTime(source.builtAt) : null,
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

/**
 * A fresh state. `lastSeenAt` starts null so the first launch reads as a first visit.
 * `now` is accepted for symmetry with normalizeState; a new state holds no timestamps yet.
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

  return {
    version: STATE_VERSION,
    user,
    milo,
    lastSeenAt,
    lastGreetedDay: cleanDayKey(source.lastGreetedDay),
    settings: cleanSettings(source.settings),
    skills: cleanSkills(source.skills),
    panel: canonicalPlaceId(cleanId(source.panel)),
    plots: cleanPlots(source.plots),
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
 */
export function markSeen(state, now = Date.now()) {
  const at = toTime(now) ?? Date.now();
  if (!isRecord(state)) return { ...createState(at), lastSeenAt: at };
  try {
    state.lastSeenAt = at;
    return state;
  } catch {
    return { ...state, lastSeenAt: at }; // frozen or read-only input
  }
}

/** Local calendar day as 'YYYY-MM-DD'. Invalid input falls back to today. */
export function dayKey(ms = Date.now()) {
  const at = typeof ms === 'number' && Number.isFinite(ms) ? ms : (toTime(ms) ?? Date.now());
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  return withPlot(state, plotId, (plot) => ({
    ...plot,
    status: 'built',
    blueprint: keepPlan ? keptPlan(plot.blueprint, checked) : checked,
    designedBy: DESIGNED_BY.includes(by) ? by : 'kit',
    builtAt: toTime(now) ?? Date.now(),
    // A redesign keeps Chris's own name for the place; a first design starts from the blueprint's.
    name: plot.blueprint && plot.name ? plot.name : null,
  }));
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
    return { ...plot, status: 'empty', blueprint: null, designedBy: null, builtAt: null, name: null, idea: keepIdea ? plot.idea ?? null : null };
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
