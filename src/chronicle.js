// The Chronicle: a daily and weekly history where every Ember and every fight is written down
// (CONTRACT-PHASE4.md §7.6, §8.3; COMBAT.md §12, §13). Pure: the clock comes in as `now`.
//
// A day's totals live in `chronicle.days` (the newest 60 days); weeks are read from them, never
// stored. The Ember ledger itself stays in `embers.ledger`, and each day's view reads it from there.
import { isRecord, cleanCount, cleanMap, cleanDayKey, dayKeyStart, dayKey, dayStart, weekStart } from './clean.js';
import {
  STATE4_LIMITS, SKILL_IDS, emptyChronicle, emptyDay, cleanDay, topXp, newestDays, cleanFightSummary, cleanXpLine,
} from './state4.js';

const L = STATE4_LIMITS;
/** The counts a day keeps, in the order DayView lists them. */
export const DAY_COUNTS = Object.freeze(['embersIn', 'embersOut', 'focus', 'rests', 'crew', 'answered', 'stitched', 'fights']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const chronicleOf = (state) => (isRecord(state.chronicle) ? state.chronicle : emptyChronicle());
const daysOf = (chronicle) => (isRecord(chronicle.days) ? chronicle.days : {});
const listOf = (value) => (Array.isArray(value) ? value : []);
const dayOf = (days, key) => (Object.hasOwn(days, key) ? cleanDay(days[key]) : null) || emptyDay();

/**
 * Adds to the day `now` falls on: { embersIn, embersOut, focus, rests, crew, answered, stitched,
 * fights, xp: { [skill]: n } }, each a whole number to add. The same state when there's nothing to add.
 */
export function note(state, now, patch) {
  if (!isRecord(state) || !finite(now) || !isRecord(patch)) return state;
  const adds = {};
  for (const key of DAY_COUNTS) {
    const n = cleanCount(patch[key]);
    if (n) adds[key] = n;
  }
  const xp = cleanMap(patch.xp, (id) => SKILL_IDS.includes(id), (n) => cleanCount(n) || null);
  if (!Object.keys(adds).length && !Object.keys(xp).length) return state;
  const chronicle = chronicleOf(state);
  const days = daysOf(chronicle);
  const key = dayKey(now);
  const day = dayOf(days, key);
  for (const [name, n] of Object.entries(adds)) day[name] = cleanCount(day[name] + n);
  const merged = { ...day.xp };
  for (const [skill, n] of Object.entries(xp)) merged[skill] = cleanCount((merged[skill] || 0) + n, L.xp);
  day.xp = topXp(merged);
  return { ...state, chronicle: { ...chronicle, days: newestDays({ ...days, [key]: day }) } };
}

/**
 * Writes a fight's summary (FightSummary, §8.3) and counts the fight on its day. The same summary
 * twice (the same id at the same time) is written once. A session title in `where` or `summary`
 * is kept for SESSION_NAME_DAYS after the fight (clean.js), then the cleaner drops it.
 */
export function noteFight(state, now, summary) {
  if (!isRecord(state) || !finite(now) || !isRecord(summary)) return state;
  const clean = cleanFightSummary({ ...summary, at: summary.at ?? now }, now);
  if (!clean) return state;
  const chronicle = chronicleOf(state);
  const fights = listOf(chronicle.fights);
  if (fights.some((f) => isRecord(f) && f.id === clean.id && f.at === clean.at)) return state;
  const next = { ...state, chronicle: { ...chronicle, fights: [...fights, clean].slice(-L.fights) } };
  return note(next, clean.at, { fights: 1 });
}

/**
 * Writes one XP line ({ skill, n, source ≤ 20, text ≤ 60 }, at `now`) and adds it to the day's XP.
 * lifeskills.addXp calls it for every payer.
 */
export function noteXp(state, now, line) {
  if (!isRecord(state) || !finite(now) || !isRecord(line)) return state;
  const clean = cleanXpLine({ ...line, at: now }, now);
  if (!clean) return state;
  const chronicle = chronicleOf(state);
  const next = { ...state, chronicle: { ...chronicle, xpLines: [...listOf(chronicle.xpLines), clean].slice(-L.xpLines) } };
  return note(next, now, { xp: { [clean.skill]: clean.n } });
}

/** A day key from 'YYYY-MM-DD', a time, or nothing (the day `now` falls on); null when there's none. */
function keyOf(day, now) {
  if (typeof day === 'string') return cleanDayKey(day);
  if (finite(day)) return dayKey(day);
  return finite(now) ? dayKey(now) : null;
}

const byTimeDesc = (a, b) => b.at - a.at;
const xpList = (map) => Object.entries(map).map(([skill, n]) => ({ skill, n })).sort((a, b) => b.n - a.n || (a.skill < b.skill ? -1 : 1));

/**
 * One day: its totals, XP by skill (largest first), and its ledger entries, XP lines and fights,
 * newest first. `day` is 'YYYY-MM-DD' or a time; without one, it's the day `now` falls on.
 * → { day, totals, xp: [{ skill, n }], ledger, xpLines, fights }
 */
export function dayView(state, day, { now } = {}) {
  const key = keyOf(day, now) || '';
  const chronicle = isRecord(state) ? chronicleOf(state) : emptyChronicle();
  const found = key ? dayOf(daysOf(chronicle), key) : emptyDay();
  const totals = Object.fromEntries(DAY_COUNTS.map((name) => [name, found[name]]));
  const onDay = (entry) => isRecord(entry) && finite(entry.at) && dayKey(entry.at) === key;
  const embers = isRecord(state) && isRecord(state.embers) ? state.embers : {};
  return {
    day: key,
    totals,
    xp: xpList(found.xp),
    ledger: key ? listOf(embers.ledger).filter(onDay).map((entry) => ({ ...entry })).reverse().sort(byTimeDesc) : [],
    xpLines: key ? listOf(chronicle.xpLines).filter(onDay).map((line) => ({ ...line })).reverse().sort(byTimeDesc) : [],
    fights: key ? listOf(chronicle.fights).filter(onDay).map((fight) => ({ ...fight })).reverse().sort(byTimeDesc) : [],
  };
}

/**
 * The week (local Monday to Sunday) holding `anyDayOfWeek` ('YYYY-MM-DD' or a time; without one,
 * the week `now` falls in). → { start, days: [{ day, embersIn, embersOut, focus, fights }] (7), totals, xp }
 */
export function weekView(state, anyDayOfWeek, { now } = {}) {
  const key = keyOf(anyDayOfWeek, now);
  const chronicle = isRecord(state) ? chronicleOf(state) : emptyChronicle();
  const days = daysOf(chronicle);
  const monday = key ? weekStart(dayKeyStart(key)) : null;
  const totals = Object.fromEntries(DAY_COUNTS.map((name) => [name, 0]));
  const xp = {};
  const list = [];
  for (let i = 0; i < 7 && monday !== null; i += 1) {
    const dayKeyOf = dayKey(dayStart(monday + i));
    const found = dayOf(days, dayKeyOf);
    for (const name of DAY_COUNTS) totals[name] += found[name];
    for (const [skill, n] of Object.entries(found.xp)) xp[skill] = (xp[skill] || 0) + n;
    list.push({ day: dayKeyOf, embersIn: found.embersIn, embersOut: found.embersOut, focus: found.focus, fights: found.fights });
  }
  return { start: monday === null ? '' : dayKey(dayStart(monday)), days: list, totals, xp: xpList(xp) };
}
