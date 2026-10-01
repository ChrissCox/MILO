// The rule tables (CONTRACT-PHASE4.md §4, §7.1, §9.2): loading rules.json, the lines, hero and
// stray Integrity, adaptation steps, conditions, surfaces and the damage order. Pure.

const LINE_NAMES = ['one', 'strike', 'two', 'three', 'area'];
const BUILDS = ['sturdy', 'middle', 'light'];
const STRAY_ROWS = ['integrity', 'strike', 'resist'];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumbers = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function need(ok, path, what) {
  if (!ok) throw new Error(`rules.json ${path}: ${what}`);
}

const REQUIRED = [
  'bands', 'edge', 'heat', 'actions', 'lights', 'lines', 'integrity', 'strays', 'archetypes', 'lackey', 'elite', 'lead', 'genres',
  'temperaments', 'gentle', 'conditions', 'surfaces', 'surfaceGrowth', 'hazard', 'budgets', 'tiers', 'deepRank', 'road', 'rewards',
  'work', 'adapt', 'modes', 'rests', 'cheers', 'warmth', 'warding', 'sight', 'weapons', 'armour', 'odds',
];

function validate(json) {
  need(isRecord(json), '', 'is an object');
  need(json.version === 1, 'version', 'is 1');
  for (const key of REQUIRED) need(json[key] !== undefined, key, 'is present');
  for (const band of ['cool', 'warm', 'hot']) {
    const b = json.bands[band];
    need(isRecord(b) && isNumbers(b.bars, 4), `bands.${band}.bars`, 'is four numbers');
    need(b.bars.reduce((s, x) => s + x, 0) === 100, `bands.${band}.bars`, 'sums to 100');
  }
  for (const name of LINE_NAMES) need(isNumbers(json.lines[name], 12), `lines.${name}`, 'has 12 levels');
  for (const build of BUILDS) need(isNumbers(json.integrity[build], 12), `integrity.${build}`, 'has 12 levels');
  for (const row of STRAY_ROWS) need(isNumbers(json.strays[row], 13), `strays.${row}`, 'has levels 0–12');
  for (const [id, a] of Object.entries(json.archetypes)) {
    need(isRecord(a) && typeof a.integrity === 'number' && typeof a.speed === 'number', `archetypes.${id}`, 'has integrity and speed');
    need(isRecord(a.resolve), `archetypes.${id}.resolve`, 'is present');
  }
  for (const [id, c] of Object.entries(json.conditions)) {
    need(isRecord(c) && typeof c.numbered === 'boolean', `conditions.${id}.numbered`, 'is a boolean');
    need(c.class === 'boon' || c.class === 'bane', `conditions.${id}.class`, 'is boon or bane');
    need(c.crit === 'double' || c.crit === 'as-hit', `conditions.${id}.crit`, 'is double or as-hit');
    need(c.graze === 'halve' || c.graze === 'none', `conditions.${id}.graze`, 'is halve or none');
    need(typeof c.ends === 'string', `conditions.${id}.ends`, 'is a string');
  }
  for (const [id, s] of Object.entries(json.surfaces)) {
    need(isRecord(s), `surfaces.${id}`, 'is an object');
    for (const flag of ['difficult', 'slippery', 'lit', 'hurts']) need(typeof s[flag] === 'boolean', `surfaces.${id}.${flag}`, 'is a boolean');
    need(s.meets === null || s.meets === 'body' || s.meets === 'mind', `surfaces.${id}.meets`, 'is null, body or mind');
    need(Array.isArray(s.on), `surfaces.${id}.on`, 'is a list');
    need(isRecord(s.reacts), `surfaces.${id}.reacts`, 'is an object');
  }
  need(isNumbers(json.tiers, 8), 'tiers', 'has 8 tiers');
  need(isNumbers(json.road.xp, 12), 'road.xp', 'has 12 levels');
  need(isNumbers(json.road.perWeight, 12), 'road.perWeight', 'has 12 levels');
  need(isNumbers(json.work, 12), 'work', 'has 12 levels');
  for (const mode of ['storybook', 'long-road', 'mauds-table']) need(isRecord(json.modes[mode]), `modes.${mode}`, 'is present');
}

/**
 * Validates and freezes rules.json; throws with the path of the first problem. rules.json's own
 * `tuning` (§9.2's pass criteria) stays as it is; tuning.json (or null) sits beside it as `tuned`.
 */
export function loadRules(json, tuning = null) {
  validate(json);
  if (tuning !== null && tuning !== undefined) need(isRecord(tuning), 'tuning.json', 'is an object or null');
  const copy = JSON.parse(JSON.stringify(json));
  copy.tuned = tuning ? JSON.parse(JSON.stringify(tuning)) : null;
  return deepFreeze(copy);
}

/** A 12-step table read at a level; past 12 by its last step. */
function lineTable(table, level) {
  const L = Math.max(1, Math.trunc(Number(level) || 1));
  if (L <= 12) return table[L - 1];
  const step = table[11] - table[10];
  return table[11] + step * (L - 12);
}

/** §4.8's lines ('one', 'strike', 'two', 'three', 'area') at a level; past 12 by the last step. */
export function line(rules, name, level) {
  const table = rules.lines[name];
  if (!table) throw new Error(`No line called ${name}`);
  return lineTable(table, level);
}

/** §4.7: a hero's max Integrity for a build at a level, with Grit above or below +1. */
export function heroIntegrity(rules, build, level, grit) {
  const table = rules.integrity[build];
  if (!table) throw new Error(`No build called ${build}`);
  const L = Math.max(1, Math.trunc(Number(level) || 1));
  const base = lineTable(table, L);
  const g = Math.trunc(Number(grit) || 0) - (rules.integrity.gritBase ?? 1);
  return Math.max(1, base + g * (L - 1));
}

/** §4.9's stray rows ('integrity', 'strike', 'resist') at level 0 and up. */
export function strayRow(rules, row, level) {
  const table = rules.strays[row];
  if (!table) throw new Error(`No stray row called ${row}`);
  const n = Math.max(0, Math.trunc(Number(level) || 0));
  if (n <= 12) return table[n];
  if (row === 'integrity') return table[12] + (rules.strays.past12?.integrity ?? 17) * (n - 12);
  if (row === 'strike') return 23 + Math.floor((rules.strays.past12?.strike ?? 1.5) * (n - 12));
  return 3 + Math.floor((3 * (n - 1)) / 4);
}

/** tuning.json's Integrity factor for strays at a level and party size (1 when absent). */
export function integrityFactor(rules, level, partySize) {
  const f = rules.tuned?.integrityFactor?.[String(level)]?.[String(partySize)];
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : 1;
}

/**
 * §4.15's adaptation step. Start by rank (lackey 0, stray 1, elite 2, lead 3); one down when the
 * foe is 2+ below the Road level, one up when 2+ above (leads and lackeys compare the room's n);
 * Storybook and the adaptation switch give 0; Maud's Table adds 1; clamped 0–4.
 */
export function adaptStep({ rank, level, roomLevel, roadLevel }, { mode = 'long-road', adaptation = true, rules } = {}) {
  if (!adaptation || mode === 'storybook') return 0;
  const start = rules?.adapt?.[rank];
  if (typeof start !== 'number') return 0;
  const compare = (rank === 'lead' || rank === 'lackey') && Number.isFinite(roomLevel) ? roomLevel : level;
  const diff = (Number(compare) || 0) - (Number(roadLevel) || 1);
  let step = start + (diff >= 2 ? 1 : diff <= -2 ? -1 : 0);
  if (mode === 'mauds-table') step += rules?.modes?.['mauds-table']?.adaptPlus ?? 1;
  return Math.max(0, Math.min(4, step));
}

/** A condition's rule entry: { id, numbered, class, ends, crit, graze } (plus its text and `also`). */
export function condition(rules, id) {
  const c = rules.conditions[id];
  if (!c) return null;
  return { id, ...c };
}

/** A surface's rule entry: { id, meets, difficult, slippery, lit, hurts, on, reacts } (plus the rest of its data). */
export function surface(rules, id) {
  const s = rules.surfaces[id];
  if (!s) return null;
  return { id, ...s };
}

/**
 * §4.8's damage order, from the base amount (step 1) onward:
 *   2. Storybook's ×0.75 (scale), rounded down;
 *   3. the degree: ×2, or ×½ rounded down, a Miss nothing;
 *   4. weakness adds, or resistance subtracts, once, not below 0;
 *   5. a lead's damageTaken (`taken`: a number, or a function of the amount, also given
 *      `{ before, resisted }`: the amount before resistance, and what resistance took off);
 *   6. Tuck and roll halves (`halve`), rounded down;
 *   7. Stand in my light takes `less` off, not below 0;
 *   8. Buffer soaks; the rest comes off Integrity.
 * What damageTaken gives back of the resistance no longer counts as resisted.
 */
export function damageSteps({ amount, degree, weak = 0, resist = 0, scale = 1, taken = null, halve = false, less = 0, buffer = 0 }) {
  let a = Math.max(0, Math.floor(Number(amount) || 0));
  if (scale !== 1) a = Math.floor(a * scale);
  if (degree === 'miss') return { dealt: 0, buffered: 0, bufferLeft: Math.max(0, buffer), weakAdded: 0, resisted: 0, amount: 0 };
  if (degree === 'crit') a *= 2;
  else if (degree === 'graze') a = Math.floor(a / 2);
  const w = Math.max(0, Math.floor(Number(weak) || 0));
  const r = Math.max(0, Math.floor(Number(resist) || 0));
  const beforeResist = a + w;
  const after = Math.max(0, beforeResist - r);
  let resisted = beforeResist - after;
  a = after;
  if (typeof taken === 'function') a = Math.max(0, Math.floor(Number(taken(a, { before: beforeResist, resisted })) || 0));
  else if (taken !== null && taken !== undefined) a = Math.max(0, Math.floor(Number(taken) || 0));
  if (a > after) resisted = Math.max(0, resisted - (a - after));
  if (halve) a = Math.floor(a / 2);
  if (less) a = Math.max(0, a - Math.floor(less));
  const pool = Math.max(0, Math.floor(Number(buffer) || 0));
  const buffered = Math.min(pool, a);
  return { dealt: a - buffered, buffered, bufferLeft: pool - buffered, weakAdded: w, resisted, amount: a };
}

/** The room level after a mode: Storybook max(1, n − 1), Maud's Table n + 1. */
export function modeRoomLevel(rules, n, mode) {
  const shift = rules.modes?.[mode]?.foeLevel ?? 0;
  if (shift < 0) return Math.max(1, n + shift);
  return n + shift;
}

/** A surface's number at a room level: level 1's, +1 for every 3 levels past the first. */
export function surfaceGrowth(rules, level) {
  const every = rules.surfaceGrowth?.every ?? 3;
  const from = rules.surfaceGrowth?.from ?? 1;
  return Math.max(0, Math.floor((Math.max(from, Number(level) || from) - from) / every));
}

// ---------- standoffs (§18.2) ----------

/** Whole rounds with nothing happening before a standoff ends the fight calmly (§18.2). */
export const STANDOFF_ROUNDS = 3;

/**
 * Whether an event is something happening, for §18.2's standoff: an Integrity change (damage past
 * Buffer, a patch, going offline, a reboot, a sort, a lead's next bar), a condition landing or calm
 * added. **Decided:** a lead's bow moving on counts too. A unit moving closer to a foe is found where
 * units move (grid.cameCloser in `moveAlong`, a swap, a hook), since a `move` event doesn't say where it started.
 */
export function stirs(e) {
  switch (e?.t) {
    case 'damage': return (e.amount || 0) - (e.buffered || 0) > 0;
    case 'patch': return (e.amount || 0) > 0;
    case 'offline': case 'reboot': case 'sorted': case 'bar': return true;
    case 'condition': return e.on === true && !e.down; // a count-down (§18.3's `down`) isn't a landing
    case 'calm': return (e.calm || 0) > 0;
    case 'bow': return (e.progress || 0) > 0;
    default: return false;
  }
}
