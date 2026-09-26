// MILO state model. Pure ESM with no DOM and no fs, so the renderer and the
// Electron main process share one definition of what a saved state looks like.

export const STATE_VERSION = 1;
export const DEFAULT_SETTINGS = Object.freeze({ motion: true, notifications: true, greeting: true });

const KNOWN_KEYS = ['version', 'user', 'milo', 'lastSeenAt', 'lastGreetedDay', 'settings', 'skills', 'panel'];
// Keys that could reach an object's prototype if copied blindly from parsed JSON.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_NAME = 40;
const MAX_ID = 64;
const MAX_TILE = 4096;
const MAX_LEVEL = 99;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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
    out[key] = typeof out[key] === 'boolean' ? out[key] : fallback;
  }
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
    panel: cleanId(source.panel),
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
