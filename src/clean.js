// The state's primitives: small cleaners and the local calendar (CONTRACT-PHASE4.md §7.6).
// A leaf module with no imports, so model.js, state4.js and every pure Phase 4 module can share
// one definition without an import cycle. model.js re-exports the ones it exported before.

const MAX_COUNT = 1e9;
const MAX_COORD = 1e6;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A plain object, not an array (and not null). */
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Keys that could reach an object's prototype if copied blindly from parsed JSON. */
export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Own enumerable fields of a record, minus prototype-reaching keys. Shallow. */
export function safeCopy(value) {
  const out = {};
  if (!isRecord(value)) return out;
  for (const key of Object.keys(value)) {
    if (!UNSAFE_KEYS.has(key)) out[key] = value[key];
  }
  return out;
}

/** A positive ms epoch, or null. Accepts numbers, numeric strings, ISO strings and Dates. */
export function toTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  let ms = value;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'string') {
    const text = value.trim();
    ms = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Date.parse(text);
  }
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms);
}

// Whitespace clip would change: a run of two, any but a plain space, or at either end.
const LOOSE_SPACE = /\s\s|[^\S ]|^\s|\s$/;

/** Collapses whitespace and shortens to `max` with an ellipsis, never splitting a surrogate pair. */
export function clip(value, max) {
  if (typeof value !== 'string') return '';
  const text = LOOSE_SPACE.test(value) ? value.replace(/\s+/g, ' ').trim() : value;
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(1, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** A non-negative whole count, or 0. */
export function cleanCount(value, max = MAX_COUNT) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(max, Math.floor(value));
}

/** A signed whole number within ±`bound`, or null. */
export function cleanInt(value, bound = MAX_COORD) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return Math.abs(n) <= bound ? n : null;
}

/** Own keys of a record that pass `keyOk`, each value run through `clean`; null results are dropped. */
export function cleanMap(value, keyOk, clean) {
  const out = {};
  if (!isRecord(value)) return out;
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key) || !keyOk(key)) continue;
    const entry = clean(value[key], key);
    if (entry !== null && entry !== undefined) out[key] = entry;
  }
  return out;
}

/** Keeps the `max` entries with the largest `score`, in their original order. */
export function keepNewest(map, max, score) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const kept = new Set(keys.map((key, i) => ({ key, i, s: score(map[key], key) }))
    .sort((a, b) => b.s - a.s || b.i - a.i).slice(0, max).map((entry) => entry.key));
  const out = {};
  for (const key of keys) if (kept.has(key)) out[key] = map[key];
  return out;
}

/**
 * keepNewest(cleanMap(value, keyOk, clean), max, score), counting as it cleans: a map at or under
 * its cap (every saved map, almost always) is walked once, not twice. At every cap that second
 * walk was an eighth of normalizeState's time.
 */
export function cleanMapNewest(value, keyOk, clean, max, score) {
  const out = {};
  if (!isRecord(value)) return out;
  let size = 0;
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key) || !keyOk(key)) continue;
    const entry = clean(value[key], key);
    if (entry !== null && entry !== undefined) {
      out[key] = entry;
      size += 1;
    }
  }
  return size <= max ? out : keepNewest(out, max, score);
}

/** The last `max` distinct strings that pass `ok`, oldest first (a repeat keeps its newest place). */
export function cleanRecentList(value, ok, max) {
  if (!Array.isArray(value)) return [];
  if (value.length <= max && keptWhole(value, ok)) return value.slice();
  const seen = new Set();
  const out = [];
  for (let i = value.length - 1; i >= 0 && out.length < max; i -= 1) {
    const item = value[i];
    if (typeof item !== 'string' || !ok(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out.reverse();
}

/** True when every item is a distinct string that passes `ok`: cleanRecentList then keeps the list as it is. */
function keptWhole(value, ok) {
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== 'string' || !ok(item)) return false;
  }
  return new Set(value).size === value.length;
}

/** A 'YYYY-MM-DD' day key that names a real date, or null (2026-02-31 is no day). */
export function cleanDayKey(value) {
  if (typeof value !== 'string') return null;
  const match = DAY_KEY.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return value.trim();
}

/** Local midnight of a 'YYYY-MM-DD' day key, or null. */
export function dayKeyStart(key) {
  const clean = cleanDayKey(key);
  if (!clean) return null;
  const [y, m, d] = clean.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// Phase 3's calendar helpers (dayKey, dayNumber) fall back to today on input that isn't a time, as
// they always have and core.test.js pins. Phase 4's pure modules always pass their own `now`, so
// they never reach the fallback, and weekStart (new in Phase 4) has none.
const instant = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? ms : (toTime(ms) ?? Date.now()));

/** Local calendar day as 'YYYY-MM-DD'. Invalid input falls back to today. */
export function dayKey(ms = Date.now()) {
  const date = new Date(instant(ms));
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The local calendar day as a whole number (days since 1970-01-01 on the local calendar).
 * DST-safe: it counts calendar days, not 24-hour spans, so a 23- or 25-hour day is still one.
 * Wild rifts and felled trees use it. Invalid input falls back to today.
 */
export function dayNumber(ms = Date.now()) {
  const date = new Date(instant(ms));
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** Local midnight at the start of a dayNumber day, plus `minutes` of wall-clock time (may run past midnight). */
export function dayStart(day, minutes = 0) {
  const utc = new Date(Math.round(day) * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 0, minutes).getTime();
}

/**
 * The dayNumber of the local Monday that starts `ms`'s week (a week starts on the local Monday),
 * or null when `ms` isn't a time. New in Phase 4, so it never falls back to the wall clock.
 * Day 0 (1970-01-01) was a Thursday, so a day's weekday from Monday is (day + 3) mod 7.
 */
export function weekStart(ms) {
  const t = typeof ms === 'number' ? (Number.isFinite(ms) ? ms : null) : toTime(ms);
  if (t === null) return null;
  const day = dayNumber(t);
  return day - ((((day + 3) % 7) + 7) % 7);
}

// The War Table lists closed rifts for three days (src/ui/frontier.js CLOSED_DAYS). After that, no
// stored text carries the title of the session a Knocking stood for (CONTRACT-PHASE4.md §2).
export const SESSION_NAME_DAYS = 3;
const QUOTED_TITLE = /“[^”]*(?:”|$)/g;

/**
 * A text with any session title taken out. A title is always in curly quotes (rifts.js
 * quoteTitle), even when the text was clipped: 'The Portrait of “Letters”' → 'The Portrait of a
 * waiting session'. Anything but a string gives ''.
 */
export function withoutTitle(name) {
  if (typeof name !== 'string' || !name.includes('“')) return typeof name === 'string' ? name : '';
  const out = name.replace(QUOTED_TITLE, 'a waiting session').replace(/\s+/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** True when a text written at `at` is past SESSION_NAME_DAYS by `now`, so its title must go. */
export function titleExpired(at, now) {
  return typeof at === 'number' && typeof now === 'number' && Number.isFinite(now) && at < now - SESSION_NAME_DAYS * DAY_MS;
}

/**
 * A JSON-safe copy of `value` with every `__proto__`, `constructor` and `prototype` key dropped at
 * every level. Strings, booleans, null and finite numbers pass; anything else (functions, symbols,
 * undefined, NaN) is dropped from records and becomes null in lists, as JSON would have it. Past
 * `depth` levels of nesting a value becomes null, which also ends any cycle.
 */
export function stripUnsafe(value, depth = 12) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;
  if (depth <= 0) return null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const clean = stripUnsafe(item, depth - 1);
      return clean === undefined ? null : clean;
    });
  }
  if (!isRecord(value)) return null;
  const out = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const clean = stripUnsafe(value[key], depth - 1);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}
