// Chris's 24 skills on the classic curve (CONTRACT-PHASE4.md §4.21, §7.6; LORE.md §12; PLAN.md §4).
// XP is stored, never recomputed from counts, so a rate change never lowers a level. Every payer
// uses addXp, which also writes the Chronicle's XP line. Pure: the clock comes in as `now`.
import { isRecord, cleanCount, clip, dayKey } from './clean.js';
import { SKILL_IDS, STATE4_LIMITS, emptyXp, signalCounts } from './state4.js';
import { noteXp } from './chronicle.js';

export { SKILL_IDS };

const MAX_LEVEL = 99;
const MAX_XP = STATE4_LIMITS.xp;
const FAMILIES = Object.freeze({
  life: SKILL_IDS.slice(0, 9), gathering: SKILL_IDS.slice(9, 14), making: SKILL_IDS.slice(14),
});

/** content/xp.json's sources, used when a caller passes none (a test pins them to the file). */
export const DEFAULT_RATES = Object.freeze([
  { id: 'focus-session', skill: 'focus', xp: 1000 },
  { id: 'rest-honoured', skill: 'hearthkeeping', xp: 400 },
  { id: 'crew-session', skill: 'command', xp: 100 },
  { id: 'answered-fast', skill: 'command', xp: 100 },
  { id: 'building-designed', skill: 'artifice', xp: 1000 },
  { id: 'spell-knack', skill: 'spellcraft', xp: 5 },
  { id: 'spell-circle', skill: 'spellcraft', xp: 40 },
  { id: 'chunk-charted', skill: 'cartography', xp: 40 },
  { id: 'lantern-lit', skill: 'wayfaring', xp: 150 },
  { id: 'lantern-travel', skill: 'wayfaring', xp: 25, perDay: 10 },
  { id: 'log-chopped', skill: 'woodcutting', xp: 25 },
  { id: 'wild-stitch', skill: 'seamcraft', xp: 300 },
  { id: 'wild-stitch-depth', skill: 'seamcraft', xp: 30 },
  { id: 'real-stitch', skill: 'seamcraft', xp: 500 },
  { id: 'quest-main', skill: 'stewardship', xp: 300 },
  { id: 'quest-side', skill: 'stewardship', xp: 150 },
  { id: 'commission', skill: 'command', xp: 100 },
  { id: 'commission-proved', skill: 'command', xp: 400 },
].map(Object.freeze));

// The curve: xpForLevel(L) = floor(¼ × Σ_{l=1}^{L−1} floor(l + 300 × 2^(l/7))); level 99 = 13,034,431.
const CURVE = (() => {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level < MAX_LEVEL; level += 1) {
    points += Math.floor(level + 300 * 2 ** (level / 7));
    table[level + 1] = Math.floor(points / 4);
  }
  return Object.freeze(table);
})();

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** XP needed to reach `level` (1–99): 0 at 1, 83 at 2, 13,034,431 at 99. */
export function xpForLevel(level) {
  if (!finite(level) || level <= 1) return 0;
  return CURVE[Math.min(MAX_LEVEL, Math.floor(level))];
}

/** The level `xp` has reached, 1–99. */
export function levelForXp(xp) {
  const n = cleanCount(xp, MAX_XP);
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (CURVE[mid] <= n) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A skill's name: its id with a capital ('seamcraft' → 'Seamcraft'), as LORE §21 has them. */
export const skillName = (id) => (typeof id === 'string' && id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
/** 1000 → '1,000' (the same in every locale). */
export const commas = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The source rates by id from content/xp.json (the file, its `sources`, or nothing for the defaults). */
export function ratesOf(rates) {
  const list = Array.isArray(rates) ? rates : (isRecord(rates) && Array.isArray(rates.sources) ? rates.sources : DEFAULT_RATES);
  const out = {};
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !SKILL_IDS.includes(entry.skill)) continue;
    out[entry.id] = { skill: entry.skill, xp: cleanCount(entry.xp, MAX_XP), perDay: cleanCount(entry.perDay) || null };
  }
  for (const entry of DEFAULT_RATES) if (!Object.hasOwn(out, entry.id)) out[entry.id] = { skill: entry.skill, xp: entry.xp, perDay: entry.perDay || null };
  return out;
}

const xpOf = (state) => (isRecord(state.xp) ? state.xp : emptyXp());

/** 'Focus 1,000: focus session 09:10–10:00' (a line that already names its skill and amount is kept). */
function lineText(skill, n, text) {
  const head = `${skillName(skill)} ${commas(n)}`;
  const detail = typeof text === 'string' ? text.trim() : '';
  if (!detail) return head;
  return clip(detail.startsWith(`${skillName(skill)} `) ? detail : `${head}: ${detail}`, STATE4_LIMITS.lineText);
}

const DEFAULT_TRAVELS = DEFAULT_RATES.find((entry) => entry.id === 'lantern-travel').perDay;

/**
 * Adds XP to one of the 24 skills (whole, capped at 200,000,000) and writes the Chronicle's XP
 * line. A lantern travel (`source: 'lantern-travel'`) pays at most its `perDay` a local day,
 * counted in `xp.day.travels`: the `perDay` option if given, else `rates` (content.xp, its
 * `sources`, or nothing) 'lantern-travel' row's, else 10. The line's text drops a session title (anything
 * in “…”) after SESSION_NAME_DAYS, so quote any other name in ‘…’. → { state, drop: null | { skill,
 * amount, level, levelled } }; the same state and no drop when nothing was added.
 */
export function addXp(state, skill, amount, now, { source = '', text = '', perDay = null, rates = null } = {}) {
  const none = { state, drop: null };
  const n = cleanCount(amount, MAX_XP);
  if (!isRecord(state) || !SKILL_IDS.includes(skill) || !finite(now) || !n) return none;
  const xp = xpOf(state);
  const skills = isRecord(xp.skills) ? xp.skills : {};
  let day = null;
  if (source === 'lantern-travel') {
    const cap = cleanCount(perDay) || ratesOf(rates)['lantern-travel'].perDay || DEFAULT_TRAVELS;
    const today = dayKey(now);
    const current = isRecord(xp.day) && xp.day.key === today ? cleanCount(xp.day.travels) : 0;
    if (current >= cap) return none;
    day = { ...(isRecord(xp.day) ? xp.day : {}), key: today, travels: current + 1 };
  }
  const before = cleanCount(Object.hasOwn(skills, skill) ? skills[skill] : 0, MAX_XP);
  const after = Math.min(MAX_XP, before + n);
  if (after === before) return none;
  const gained = after - before;
  const level = levelForXp(after);
  let next = { ...state, xp: { ...xp, skills: { ...skills, [skill]: after }, ...(day ? { day } : {}) } };
  next = noteXp(next, now, { skill, n: gained, source: clip(source, STATE4_LIMITS.lineSource), text: lineText(skill, gained, text) });
  return { state: next, drop: { skill, amount: gained, level, levelled: level > levelForXp(before) } };
}

const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

/**
 * Command and Artifice from the counters' high-water marks on `xp.through` (crew sessions
 * finished, needs-you answered within 15 minutes, first designs). The first run after the Kit
 * lands pays the backlog once, uncapped, as one line per skill. → { state, drops }
 */
export function payLifeFromSignals(state, now, rates) {
  if (!isRecord(state) || !finite(now)) return { state, drops: [] };
  const table = ratesOf(rates);
  const counts = signalCounts(state);
  const xp = xpOf(state);
  const through = isRecord(xp.through) ? xp.through : null;
  const marks = { sessionsFinished: counts.sessionsFinished, answeredFast: counts.answeredFast, buildingsDesigned: counts.buildingsDesigned };
  const grants = [];
  if (!through) {
    const command = counts.sessionsFinished * table['crew-session'].xp + counts.answeredFast * table['answered-fast'].xp;
    const artifice = counts.buildingsDesigned * table['building-designed'].xp;
    if (command) grants.push([table['crew-session'].skill, command, 'backlog', 'from before the Kit']);
    if (artifice) grants.push([table['building-designed'].skill, artifice, 'backlog', 'from before the Kit']);
  } else {
    const delta = (name) => Math.max(0, marks[name] - cleanCount(through[name]));
    const sessions = delta('sessionsFinished');
    const fast = delta('answeredFast');
    const designs = delta('buildingsDesigned');
    if (sessions) grants.push([table['crew-session'].skill, sessions * table['crew-session'].xp, 'crew-session', `${plural(sessions, 'a crew session', 'crew sessions')} finished`]);
    if (fast) grants.push([table['answered-fast'].skill, fast * table['answered-fast'].xp, 'answered-fast', `${plural(fast, 'a needs-you', 'needs-you')} answered in time`]);
    if (designs) grants.push([table['building-designed'].skill, designs * table['building-designed'].xp, 'building-designed', `${plural(designs, 'a first design', 'first designs')}`]);
    // A mark only follows its counter; a counter that went down (a damaged tally) lowers it, so only new work pays.
    const same = ['sessionsFinished', 'answeredFast', 'buildingsDesigned'].every((name) => cleanCount(through[name]) === marks[name]);
    if (same && !grants.length) return { state, drops: [] };
  }
  let next = { ...state, xp: { ...xp, through: { ...(through || {}), ...marks } } };
  const drops = [];
  for (const [skill, amount, source, text] of grants) {
    const paid = addXp(next, skill, amount, now, { source, text });
    next = paid.state;
    if (paid.drop) drops.push(paid.drop);
  }
  return { state: next, drops };
}

/**
 * The 24 skills for the Skills tab: [{ id, name, family, level, xp, next, guide, source }], where
 * `next` is the XP the next level needs (null at 99), `guide` the unlocks and `source` the line on
 * where XP comes from today. `content` is the bundle (or content/skills.json itself).
 */
export function skillsView(state, content) {
  const file = isRecord(content) && isRecord(content.skills) ? content.skills : content;
  const list = isRecord(file) && Array.isArray(file.skills) ? file.skills : [];
  const skills = isRecord(state) && isRecord(xpOf(state).skills) ? xpOf(state).skills : {};
  return SKILL_IDS.map((id) => {
    const entry = list.find((item) => isRecord(item) && item.id === id) || {};
    const xp = cleanCount(Object.hasOwn(skills, id) ? skills[id] : 0, MAX_XP);
    const level = levelForXp(xp);
    return {
      id,
      name: typeof entry.name === 'string' ? entry.name : skillName(id),
      family: Object.keys(FAMILIES).find((family) => FAMILIES[family].includes(id)),
      level,
      xp,
      next: level >= MAX_LEVEL ? null : xpForLevel(level + 1),
      guide: Array.isArray(entry.unlocks) ? entry.unlocks.filter(isRecord).map((u) => ({ ...u })) : [],
      source: typeof entry.phase4 === 'string' ? entry.phase4 : '',
    };
  });
}
