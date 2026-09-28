// Real rifts from real signals (CONTRACT-PHASE3 §5, RIFTS.md §2), wild rifts per chunk, and what
// Chris does with them: ward, let go, stitch, and the loot that follows. Pure ESM with no DOM
// and no fs: riftgen and worldgen instances are passed in, and every time comes from the
// injected `now`, read in local wall-clock hours.
//
// The loop the shell runs:  deriveSignals → buildRealRifts → reconcileRifts.
import { dayKey, dayNumber, dayStart, toTime, clip, cleanLoot, cleanEveningBell, buildingName, emptyRifts, emptySatchel, STATE_LIMITS } from './model.js';
import { prologueStatus, markStory, STORY_RIFT_KEY } from './story.js';

export { dayNumber };

export const RIFT_RULES = Object.freeze({
  nightEndsHour: 6, nightRecentMin: 20, nightQuietMin: 45,
  knockHours: 24, patientKnockHours: 48,
  capacityPercent: 85, capacityHighPercent: 95,
  brightHours: 72, wardDays: 3, wallsUrgency: 0.9,
});

export const WARD_POST_RULES = Object.freeze([
  Object.freeze({ id: 'nights-off', name: 'Weekend nights off', text: 'Working late on a Friday or Saturday night doesn’t open a rift.' }),
  Object.freeze({ id: 'patient-knock', name: 'A patient knock', text: 'A session waiting on you opens a rift after 48 hours instead of 24.' }),
  Object.freeze({ id: 'capacity-95', name: 'Room to run', text: 'Codex opens a capacity rift at 95% of its allowance instead of 85%.' }),
]);
const WARD_POST_IDS = WARD_POST_RULES.map((rule) => rule.id);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STAGES = ['hairline', 'open', 'gaping'];
// riftgen picks the stage from urgency; a warded rift is rebuilt at its frozen stage with these.
const STAGE_URGENCY = Object.freeze({ hairline: 0.2, open: 0.5, gaping: 0.8 });
const SNAPSHOT_KINDS = new Set(['nocturne', 'knocking', 'capacity']);
const NIGHT_END_MIN = RIFT_RULES.nightEndsHour * 60;
// A rift is nudged to the nearest free tile within 6. When nothing that near is free (a thick wood,
// a crowded engine), the search widens in steps, out to 30 tiles, before it settles for a safe spot.
const SEARCH_STEPS = Object.freeze([6, 12, 18, 24, 30]);
const SEARCH_RADIUS = SEARCH_STEPS[SEARCH_STEPS.length - 1];
// The north gate tile, just outside the vale (worldgen GATES['gate:n'].edge + dir).
const NORTH_GATE = Object.freeze({ x: 32, y: -1 });
const STORY_BEYOND = 4;
const STORY_SEARCH = 60;
const PRUNE_AFTER = 30 * DAY;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OPEN_QUOTE = '“';
const CLOSE_QUOTE = '”';
const MAELSTROM_GLASS = 'Maelstrom glass';
const MATERIALS = new Set(['birch', 'ash', 'pine']);
const CAPACITY_PREFIX = 'capacity:codex:';
// Two refill times this close are the same allowance window: older Codex builds give the refill
// as seconds from each reading, so it wobbles a little (the watcher uses the same span).
const SAME_WINDOW_MS = 10 * MIN;
// The watcher always reads these two; anything else in snapshot.sources is read as it's named.
const SOURCE_AGENTS = ['claude', 'codex'];
const AGENT_ID = /^[a-z][a-z0-9-]{0,19}$/;
// History entries that end an episode for good (a let-go episode stays let go instead). A Nocturne
// closed quietly by moving the evening bell is over too: late work past the new bell is a new one.
const ENDED_HOWS = ['sealed', 'stitched', 'closed'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clockOf = (now) => (finite(now) ? now : Date.now());
const round3 = (value) => Math.round(value * 1000) / 1000;
const pad2 = (n) => String(n).padStart(2, '0');
const capFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------------------
// Words. Every cause and stitch is plain: the real thing first, in sentence case.

/** Local wall-clock time as 'HH:MM'. */
export function clockText(ms) {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** '1 hour', '26 hours'. */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A future moment in words: 'today at 14:20', 'tomorrow at 09:00', 'on Thursday at 14:20'. */
export function whenText(ms, now) {
  const ahead = dayNumber(ms) - dayNumber(now);
  const date = new Date(ms);
  const time = clockText(ms);
  if (ahead <= 0) return `today at ${time}`;
  if (ahead === 1) return `tomorrow at ${time}`;
  if (ahead < 7) return `on ${WEEKDAYS[date.getDay()]} at ${time}`;
  return `on ${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} at ${time}`;
}

/** A past day in words: 'today', 'yesterday', 'on Friday', 'on 12 September'. */
export function dayText(ms, now) {
  const ago = dayNumber(now) - dayNumber(ms);
  const date = new Date(ms);
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 7) return `on ${WEEKDAYS[date.getDay()]}`;
  return `on ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** A span in words: '26 hours' up to three days, then '4 days'. */
export function spanText(ms) {
  const hours = Math.max(0, Math.floor(ms / HOUR));
  return hours < 72 ? plural(hours, 'hour') : plural(Math.floor(hours / 24), 'day');
}

/**
 * A session title as a rift subject: in curly quotes, at most `max` characters in all,
 * never splitting a surrogate pair. Straight quotes inside become single ones.
 */
export function quoteTitle(title, max = 40) {
  const text = typeof title === 'string' ? title.replace(/["“”]/g, '’').replace(/\s+/g, ' ').trim() : '';
  return `${OPEN_QUOTE}${clip(text || 'Untitled session', max - 2)}${CLOSE_QUOTE}`;
}

function agentWord(agent) {
  if (agent === 'claude') return 'Claude';
  if (agent === 'codex') return 'Codex';
  if (typeof agent === 'string' && /^[a-z][a-z0-9 -]{0,19}$/i.test(agent.trim())) return capFirst(agent.trim());
  return 'the crew';
}

function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** 'Clip studio' → 'the Clip studio'; names with their own article or owner keep them. */
function buildingSubject(name) {
  if (/^(the|a|an)\s/i.test(name)) return name.charAt(0).toLowerCase() + name.slice(1);
  if (/^\S+['’]s\s/.test(name)) return name;
  return `the ${name}`;
}

function allowanceWords(windowMinutes) {
  const minutes = finite(windowMinutes) ? windowMinutes : 0;
  if (minutes >= 6.5 * 24 * 60) return 'weekly allowance';
  if (minutes >= 23 * 60 && minutes <= 25 * 60) return 'daily allowance';
  if (minutes >= 60 && minutes < 23 * 60) return `${Math.round(minutes / 60)}-hour allowance`;
  return 'allowance';
}

// ---------------------------------------------------------------------------
// The night window. It runs from the evening bell to 06:00 and crosses midnight; it belongs to
// the evening it started on. A bell after midnight (00:30) belongs to the evening before.

function bellOf(settings) {
  const value = isRecord(settings) && Object.hasOwn(settings, 'eveningBell') ? settings.eveningBell : undefined;
  const bell = cleanEveningBell(value);
  if (bell === null) return null;
  const [h, m] = bell.split(':').map(Number);
  return { text: bell, minutes: h * 60 + m };
}

/** The evening bell the state rings now, as 'HH:MM', or null when Chris turned it off. */
function currentBell(state) {
  return bellOf(isRecord(state) && isRecord(state.settings) ? state.settings : {})?.text ?? null;
}

/**
 * Whether an open Nocturne no longer stands because the evening bell was switched off or moved,
 * rather than because the crew went quiet: the bell is off now, or it isn't the bell the
 * Nocturne last stood under. (A Nocturne saved without its bell can only tell the first.)
 */
function bellMovedOff(entry, bell) {
  return bell === null || (typeof entry.bell === 'string' && entry.bell !== bell);
}

/** The night containing `now`, or null: { evening (dayNumber), start, end, bellWall }. */
export function nightWindow(now, eveningBell = '22:00') {
  const bell = bellOf({ eveningBell });
  if (!bell) return null;
  const today = dayNumber(now);
  const afterMidnight = bell.minutes < NIGHT_END_MIN;
  for (const evening of [today, today - 1]) {
    const start = dayStart(evening + (afterMidnight ? 1 : 0), bell.minutes);
    const end = dayStart(evening + 1, NIGHT_END_MIN);
    if (now >= start && now < end) return { evening, start, end, bell: bell.text, bellWall: bell.minutes + (afterMidnight ? 1440 : 0) };
  }
  return null;
}

/** Wall-clock minutes since the evening's midnight (past 1440 after midnight), DST-agnostic. */
function wallMinutes(ms, evening) {
  const date = new Date(ms);
  return (dayNumber(ms) - evening) * 1440 + date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function nightKey(evening) {
  return `night:${dayKey(dayStart(evening, 12 * 60))}`;
}

/** When a key's episode is over for good, from the key alone (night passed, refill passed, bright rift faded). */
function keyEnded(key, now) {
  const [prefix, ...rest] = key.split(':');
  if (prefix === 'night') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rest.join(':'));
    if (!match) return true;
    const evening = dayNumber(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12).getTime());
    return now >= dayStart(evening + 1, NIGHT_END_MIN);
  }
  if (prefix === 'capacity') {
    const resetsAt = Number(rest[rest.length - 1]);
    return !finite(resetsAt) || now >= resetsAt;
  }
  if (prefix === 'built') {
    const builtAt = Number(rest[rest.length - 1]);
    return !finite(builtAt) || now >= builtAt + RIFT_RULES.brightHours * HOUR;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Signals.

function riftsOf(state) {
  return isRecord(state) && isRecord(state.rifts) ? state.rifts : {};
}
const mapOf = (rifts, name) => (isRecord(rifts[name]) ? rifts[name] : {});

/**
 * The since this key's episode already has in the state, or null: the open rift's, else a ward,
 * let-go or bell mark's, unless that episode has since sealed (its history entry closed at or
 * after it began). So after a seal, new activity is a new episode, bell or no bell.
 */
function knownSince(state, key) {
  const rifts = riftsOf(state);
  const open = mapOf(rifts, 'open')[key];
  const openSince = isRecord(open) ? toTime(open.since) : null;
  if (openSince) return openSince;
  const ended = lastClosed(state, key, ENDED_HOWS);
  for (const name of ['warded', 'letGo', 'belled']) {
    const entry = mapOf(rifts, name)[key];
    const since = isRecord(entry) ? toTime(entry.since) : null;
    if (since && since > ended) return since;
  }
  return null;
}

/** When this key last closed (optionally only in these ways), or 0. */
function lastClosed(state, key, hows = null) {
  const history = Array.isArray(riftsOf(state).history) ? riftsOf(state).history : [];
  let latest = 0;
  for (const entry of history) {
    if (!isRecord(entry) || entry.key !== key || !finite(entry.closedAt)) continue;
    if (hows && !hows.includes(entry.how)) continue;
    latest = Math.max(latest, entry.closedAt);
  }
  return latest;
}

function snapshotUsable(snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.sources)) return false;
  return Object.values(snapshot.sources).some((source) => isRecord(source) && source.ok === true);
}

/** The agents whose sessions the watcher couldn't read this time (Claude and Codex always have a source). */
function downAgents(snapshot) {
  const sources = snapshot.sources;
  const names = new Set([...SOURCE_AGENTS, ...Object.keys(sources).filter((name) => AGENT_ID.test(name))]);
  return new Set([...names].filter((name) => !(isRecord(sources[name]) && sources[name].ok === true)));
}

/** Which agent a session belongs to: its `agent`, else its id's prefix ('codex:…'), else null. */
function agentOf(session) {
  if (typeof session.agent === 'string' && AGENT_ID.test(session.agent)) return session.agent;
  const prefix = typeof session.id === 'string' ? session.id.split(':')[0] : '';
  return AGENT_ID.test(prefix) && prefix !== session.id ? prefix : null;
}

function sessionsOf(snapshot) {
  return Array.isArray(snapshot?.sessions) ? snapshot.sessions.filter((s) => isRecord(s) && typeof s.id === 'string' && s.id) : [];
}

function tierOf(state) {
  const tier = isRecord(state) && isRecord(state.hearth) && finite(state.hearth.tier) ? Math.floor(state.hearth.tier) : 1;
  return Math.min(8, Math.max(1, tier));
}

function signal(fields) {
  return {
    key: fields.key,
    kind: fields.kind,
    signals: fields.signals,
    subject: clip(fields.subject, 40),
    urgency: round3(Math.min(1, Math.max(0, fields.urgency))),
    cause: clip(fields.cause, 160),
    stitch: clip(fields.stitch, 140),
    since: fields.since,
    echo: fields.echo,
    bright: fields.bright === true,
    held: fields.held ?? null,
    ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
    ...(Array.isArray(fields.agents) && fields.agents.length ? { agents: [...fields.agents] } : {}),
    ...(typeof fields.bell === 'string' ? { bell: fields.bell } : {}),
  };
}

function nocturneSignal(state, sessions, now, post) {
  const night = nightWindow(now, currentBell(state));
  if (!night) return null;
  const key = nightKey(night.evening);
  const late = [];
  for (const session of sessions) {
    if (session.archived === true) continue;
    const working = session.status === 'working';
    const last = finite(session.lastActivityAt) ? Math.min(session.lastActivityAt, now) : 0;
    const at = working ? now : last;
    if (at >= night.start) late.push({ session, at, working });
  }
  if (!late.length) return null;
  const latest = Math.max(...late.map((entry) => entry.at));
  const quiet = now - latest;
  const openEntryNow = mapOf(riftsOf(state), 'open')[key];
  const wasOpen = isRecord(openEntryNow);
  const on = late.some((entry) => entry.working)
    || quiet <= RIFT_RULES.nightRecentMin * MIN
    || (wasOpen && quiet < RIFT_RULES.nightQuietMin * MIN);
  if (!on) return null;

  // Since: the episode's own start when the state knows it, else the first late activity seen.
  let since = knownSince(state, key);
  if (!since) {
    const floor = Math.max(night.start, lastClosed(state, key) + 1);
    const times = [];
    for (const { session, working } of late) {
      if (finite(session.startedAt) && session.startedAt >= floor) times.push(session.startedAt);
      else if (working) times.push(floor);
      for (const t of Array.isArray(session.completions) ? session.completions : []) if (finite(t) && t >= floor && t <= now) times.push(t);
      if (finite(session.lastActivityAt) && session.lastActivityAt >= floor) times.push(Math.min(session.lastActivityAt, now));
    }
    since = times.length ? Math.min(...times) : latest;
  }
  const wall = wallMinutes(latest, night.evening);
  const hoursPast = Math.max(0, (wall - night.bellWall) / 60);
  const afterMidnight = wall >= 1440;
  const urgency = Math.min(0.95, 0.3 + 0.15 * hoursPast + (afterMidnight ? 0.15 : 0));
  // The genre signal follows when the episode began, so the rift doesn't change at midnight.
  const signals = wallMinutes(since, night.evening) >= 1440 ? ['session-after-midnight'] : ['working-past-bell'];
  const recent = late.filter((entry) => entry.at >= latest - 5 * MIN);
  const names = [...new Set(recent.map((entry) => agentWord(entry.session.agent)))];
  const eveningDay = new Date(dayStart(night.evening, 12 * 60)).getDay();
  const held = post === 'nights-off' && (eveningDay === 5 || eveningDay === 6) ? 'nights-off' : null;
  // Everyone who has worked late in this episode, so a hiccup in any of their sources carries it.
  const before = wasOpen && Array.isArray(openEntryNow.agents) ? openEntryNow.agents : [];
  const agents = [...new Set([...before.filter((a) => typeof a === 'string' && AGENT_ID.test(a)), ...late.map((entry) => agentOf(entry.session)).filter(Boolean)])].sort().slice(0, 4);
  return signal({
    key,
    kind: 'nocturne',
    signals,
    subject: `${WEEKDAYS[eveningDay]} night`,
    urgency,
    cause: `${capFirst(listWords(names))} ${names.length > 1 ? 'were' : 'was'} still working at ${clockText(latest)}, past your evening bell (${night.bell}).`,
    stitch: 'Go to bed. The rift closes once the crew has been quiet for 45 minutes, or at dawn.',
    since,
    echo: { place: 'camp', icon: 'moon' },
    held,
    agents,
    bell: night.bell,
  });
}

function knockSignals(state, sessions, now, post) {
  const out = [];
  for (const session of sessions) {
    if (session.status !== 'needs-you' || session.archived === true) continue;
    const since = toTime(session.waitingSince) ?? toTime(session.lastActivityAt);
    if (!since || since > now) continue;
    const hours = (now - since) / HOUR;
    if (hours < RIFT_RULES.knockHours) continue;
    const held = post === 'patient-knock' && hours < RIFT_RULES.patientKnockHours ? 'patient-knock' : null;
    const subject = quoteTitle(session.title);
    out.push(signal({
      key: `knock:${session.id}`,
      kind: 'knocking',
      signals: ['needs-you-unanswered'],
      subject,
      urgency: Math.min(0.95, 0.35 + ((hours - RIFT_RULES.knockHours) / 48) * 0.55),
      cause: `${subject} has waited on you for ${spanText(now - since)}.`,
      stitch: `Answer ${agentWord(session.agent)} in that session.`,
      since,
      echo: { place: 'watchtower', icon: 'knocker' },
      held,
      sessionId: session.id,
    }));
  }
  return out;
}

const capacityRefill = (key) => Number(key.slice(CAPACITY_PREFIX.length));

/**
 * The key for a capacity reading over the line. It's `capacity:codex:<resetsAt>`, unless an
 * episode the state already knows stands for the same thing:
 * - an open capacity rift whose window hasn't refilled yet: usage only climbs inside a window,
 *   so Codex is still over the line on it, even when the reading has moved to its other, fuller
 *   window;
 * - any capacity window the state knows (open, warded, let go, belled, or closed in the history)
 *   whose refill is within ten minutes of this one: the same window, read again. That holds after
 *   its refill too, since a reading's refill time can land a few seconds past the one the key
 *   was taken from.
 * So a wobbling refill time never seals one episode and opens another.
 */
function capacityKey(state, resetsAt, now) {
  const exact = `${CAPACITY_PREFIX}${resetsAt}`;
  const rifts = riftsOf(state);
  let open = null;
  let near = null;
  const weigh = (key, isOpen) => {
    const refill = capacityRefill(key);
    if (!Number.isInteger(refill)) return;
    const gap = Math.abs(refill - resetsAt);
    if (isOpen && refill > now) {
      if (!open || gap < open.gap) open = { key, gap };
    } else if (gap <= SAME_WINDOW_MS && (!near || gap < near.gap)) {
      near = { key, gap };
    }
  };
  for (const name of ['open', 'warded', 'letGo', 'belled']) {
    for (const [key, entry] of Object.entries(mapOf(rifts, name))) {
      if (!key.startsWith(CAPACITY_PREFIX) || !isRecord(entry)) continue;
      if (key === exact) return exact;
      weigh(key, name === 'open');
    }
  }
  for (const entry of Array.isArray(rifts.history) ? rifts.history : []) {
    if (isRecord(entry) && typeof entry.key === 'string' && entry.key.startsWith(CAPACITY_PREFIX)) weigh(entry.key, false);
  }
  return (open ?? near)?.key ?? exact;
}

function capacitySignal(state, snapshot, now, post) {
  const reading = isRecord(snapshot.capacity) ? snapshot.capacity.codex : null;
  if (!isRecord(reading) || !finite(reading.usedPercent)) return null;
  const used = Math.min(100, reading.usedPercent);
  const resetsAt = toTime(reading.resetsAt);
  if (used < RIFT_RULES.capacityPercent || !resetsAt || resetsAt <= now) return null;
  const key = capacityKey(state, resetsAt, now);
  // The reading is of a window that has already refilled (its refill time came a few seconds
  // later than the one its episode was keyed on): that episode is over, and nothing new opens.
  if (capacityRefill(key) <= now) return null;
  const since = knownSince(state, key) ?? Math.max(Math.min(toTime(reading.at) ?? now, now), lastClosed(state, key, ENDED_HOWS) + 1);
  const held = post === 'capacity-95' && used < RIFT_RULES.capacityHighPercent ? 'capacity-95' : null;
  return signal({
    key,
    kind: 'capacity',
    signals: ['crew-capacity-high'],
    subject: 'Codex',
    urgency: Math.min(0.95, 0.4 + ((used - RIFT_RULES.capacityPercent) / 15) * 0.55),
    cause: `Codex has used ${Math.floor(used)}% of its ${allowanceWords(reading.windowMinutes)}. It refills ${whenText(resetsAt, now)}.`,
    stitch: 'Give Codex a rest, or wait for the refill.',
    since,
    echo: { place: 'workbench', icon: 'spark' },
    held,
  });
}

/**
 * When a building first stood on the plot: `firstBuiltAt`, which a redesign keeps, or `builtAt`
 * for a plot that doesn't have one yet (the earlier of the two when both are there).
 */
function firstBuilt(plot) {
  const first = toTime(plot.firstBuiltAt);
  const built = toTime(plot.builtAt);
  return first && built ? Math.min(first, built) : (first ?? built);
}

/**
 * A new building shines as a bright rift for 72 hours from the day it first stood. A redesign is a
 * new look for the same building, so it never opens another; and while one is being drawn up the
 * building still stands behind its scaffold ('designing' with the old blueprint), so the rift stays.
 */
function builtSignals(state, now) {
  const plots = isRecord(state.plots) ? state.plots : {};
  const out = [];
  for (const [plotId, plot] of Object.entries(plots)) {
    if (!isRecord(plot)) continue;
    const standing = plot.status === 'built' || (plot.status === 'designing' && isRecord(plot.blueprint));
    if (!standing) continue;
    const builtAt = firstBuilt(plot);
    if (!builtAt) continue;
    const age = now - builtAt;
    if (age < -5 * MIN || age >= RIFT_RULES.brightHours * HOUR) continue;
    const name = buildingName({ ...plot, status: 'built' }) || 'new building';
    const subject = buildingSubject(name);
    out.push(signal({
      key: `built:${plotId}:${builtAt}`,
      kind: 'built',
      signals: ['milestone-reached'],
      subject,
      urgency: 0.3,
      cause: `${capFirst(subject)} was built ${dayText(builtAt, now)}.`,
      stitch: 'Nothing to mend. Visit before it fades.',
      since: builtAt,
      echo: { place: plotId, icon: 'star' },
      bright: true,
    }));
  }
  return out;
}

function storySignal(state, story, now, hasSessions) {
  const status = prologueStatus(state, story, { hasSessions });
  if (status.current !== 'first-crack') return null;
  const done = isRecord(state.story?.prologue?.done) ? state.story.prologue.done : {};
  const since = knownSince(state, STORY_RIFT_KEY) ?? toTime(done.letter) ?? toTime(state.story?.letterReadAt) ?? toTime(state.firstSeenAt) ?? now;
  return signal({
    key: STORY_RIFT_KEY,
    kind: 'story',
    signals: ['sync-error'],
    subject: 'the north gate',
    urgency: 0.2,
    cause: 'Something from another story is pressing on the page, just past the north gate.',
    stitch: 'Step through and mend it.',
    since,
    echo: { place: 'camp', icon: 'crack' },
  });
}

/**
 * Whether an open rift rests on a source the watcher couldn't read this time: a capacity rift on
 * Codex, a Knocking on its session's agent, a Nocturne on any agent that worked late in it.
 */
function restsOn(key, entry, down) {
  if (entry.realKind === 'capacity') return down.has('codex');
  if (entry.realKind === 'knocking') {
    const id = typeof entry.sessionId === 'string' ? entry.sessionId : key.slice(key.indexOf(':') + 1);
    const agent = agentOf({ id });
    return agent !== null && down.has(agent);
  }
  if (entry.realKind === 'nocturne') return Array.isArray(entry.agents) && entry.agents.some((agent) => down.has(agent));
  return false;
}

/**
 * Rifts open from snapshot signals, kept standing while the watcher can't see them: all of them
 * when no source could be read, or those that `keep(key, entry)` picks. Their time-based ends
 * (dawn, the refill) still apply.
 */
function carriedSignals(state, now, keep = () => true) {
  const out = [];
  for (const [key, entry] of Object.entries(mapOf(riftsOf(state), 'open'))) {
    if (!isRecord(entry) || entry.kind === 'story' || !SNAPSHOT_KINDS.has(entry.realKind)) continue;
    if (keyEnded(key, now) || !toTime(entry.since) || !Array.isArray(entry.signals) || !entry.signals.length) continue;
    if (!keep(key, entry)) continue;
    out.push({
      ...signal({
        key,
        kind: entry.realKind,
        signals: [...entry.signals],
        subject: typeof entry.subject === 'string' ? entry.subject : '',
        urgency: finite(entry.urgency) ? entry.urgency : 0.5,
        cause: typeof entry.cause === 'string' ? entry.cause : '',
        stitch: typeof entry.stitch === 'string' ? entry.stitch : '',
        since: toTime(entry.since),
        echo: isRecord(entry.echo) ? { ...entry.echo } : null,
        bright: false,
        sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
        agents: Array.isArray(entry.agents) ? entry.agents.filter((a) => typeof a === 'string' && AGENT_ID.test(a)) : undefined,
        bell: typeof entry.bell === 'string' ? entry.bell : undefined,
      }),
      carried: true,
    });
  }
  return out;
}

const bySignalOrder = (a, b) => b.urgency - a.urgency || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The real signals behind rifts right now → Signal[] (held ones included, marked with `held`).
 * Signals from the watcher are only derived when the snapshot is present and a source is ok;
 * otherwise the rifts already open stay as they are (a hiccup never seals everything). The same
 * holds source by source: while one source can't be read, the open rifts that rest on it stay
 * as they are, and Codex's capacity is read only from a Codex source that's ok.
 * `story` is content/story.json (or null).
 */
export function deriveSignals({ snapshot = null, state = null, now = Date.now(), story = null } = {}) {
  const clock = clockOf(now);
  const s = isRecord(state) ? state : {};
  const settings = isRecord(s.settings) ? s.settings : {};
  const post = tierOf(s) >= 2 && WARD_POST_IDS.includes(settings.wardPost) ? settings.wardPost : null;
  const out = [];
  const usable = snapshotUsable(snapshot);
  // Without a usable snapshot MILO can't tell whether the crew is there; a story rift already
  // open was opened because it was, so it stays.
  const storyOpen = isRecord(mapOf(riftsOf(s), 'open')[STORY_RIFT_KEY]);
  let hasSessions = storyOpen;
  if (usable) {
    const down = downAgents(snapshot);
    const sessions = sessionsOf(snapshot);
    hasSessions = sessions.length > 0 || (down.size > 0 && storyOpen);
    const night = nocturneSignal(s, sessions, clock, post);
    if (night) out.push(night);
    out.push(...knockSignals(s, sessions, clock, post));
    const capacity = down.has('codex') ? null : capacitySignal(s, snapshot, clock, post);
    if (capacity) out.push(capacity);
    if (down.size) {
      const seen = new Set(out.map((sig) => sig.key));
      out.push(...carriedSignals(s, clock, (key, entry) => !seen.has(key) && restsOn(key, entry, down)));
    }
  } else {
    out.push(...carriedSignals(s, clock));
  }
  out.push(...builtSignals(s, clock));
  const crack = storySignal(s, story, clock, hasSessions);
  if (crack) out.push(crack);
  return out.sort(bySignalOrder);
}

// ---------------------------------------------------------------------------
// Placement.

// Every offset within the widest search, nearest first (ties by row, then column, so it's stable).
const OFFSETS = (() => {
  const out = [];
  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy += 1) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += 1) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= SEARCH_RADIUS * SEARCH_RADIUS) out.push({ dx, dy, d2 });
    }
  }
  return out.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
})();
// Where each search step ends in OFFSETS: the offsets before STEP_ENDS[k] lie within SEARCH_STEPS[k] tiles.
const STEP_ENDS = SEARCH_STEPS.map((radius) => {
  const end = OFFSETS.findIndex((o) => o.d2 > radius * radius);
  return end < 0 ? OFFSETS.length : end;
});

function freeTest(isFree) {
  if (typeof isFree !== 'function') return () => true;
  return (x, y) => {
    try {
      return isFree(x, y) === true;
    } catch {
      return false;
    }
  };
}

// Each gate tile and the three beyond it (worldgen GATES: edge + dir × 1..4) stay clear, so a
// rift never stands in a gateway; nor on the ring of thicket or palisade round the vale.
const GATE_WAYS = new Set([
  [32, 0, 0, -1], [0, 20, -1, 0], [63, 14, 1, 0], [11, 43, 0, 1],
].flatMap(([x, y, dx, dy]) => [1, 2, 3, 4].map((k) => `${x + dx * k},${y + dy * k}`)));
const clearOfGates = (worldgen) => (x, y) => worldgen.heartDistance(x, y) > 1.5 && !GATE_WAYS.has(`${x},${y}`);

/** Outside the Hearthward and the vale, off the ring and the gateways, on ground the world and the engine both call free. */
function spotTest(worldgen, ward, free, extra = () => true) {
  const clear = clearOfGates(worldgen);
  return (x, y) => !worldgen.inHeart(x, y) && worldgen.heartDistance(x, y) > ward && clear(x, y) && worldgen.walkable(x, y) && extra(x, y) && free(x, y);
}

const nearTaken = (taken) => (x, y) => !taken.some((t) => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1);
const offTaken = (taken) => (x, y) => !taken.some((t) => t.x === x && t.y === y);

/**
 * The nearest tile to (x, y) that `ok` accepts, searched in widening steps (within 6 tiles, then
 * 12, 18, 24 and 30). Within a step, a tile clear of the rifts already placed (not even touching
 * one) wins; failing that, one that at least isn't on another rift's own tile. null when nothing
 * within 30 tiles will do. Each tile is asked about once.
 */
function findSpot(x, y, ok, taken = []) {
  const clear = nearTaken(taken);
  const own = offTaken(taken);
  let start = 0;
  for (const end of STEP_ENDS) {
    let touching = null;
    for (let i = start; i < end; i += 1) {
      const tx = x + OFFSETS[i].dx;
      const ty = y + OFFSETS[i].dy;
      if (!ok(tx, ty)) continue;
      if (clear(tx, ty)) return { x: tx, y: ty };
      if (!touching && own(tx, ty)) touching = { x: tx, y: ty };
    }
    if (touching) return touching;
    start = end;
  }
  return null;
}

/** Last resort: walk out from the vale along the same bearing until outside the ward (and clear of the gateways). */
function outsideWard(worldgen, ward, x, y, clear = () => true) {
  let ux = x - 31.5;
  let uy = y - 22;
  const length = Math.hypot(ux, uy) || 1;
  ux /= length;
  uy /= length;
  if (!finite(ux) || !finite(uy) || (ux === 0 && uy === 0)) uy = -1;
  for (let k = 0; k < 20000; k += 1) {
    const tx = Math.round(x + ux * k);
    const ty = Math.round(y + uy * k);
    if (!worldgen.inHeart(tx, ty) && worldgen.heartDistance(tx, ty) > ward && clear(tx, ty)) return { x: tx, y: ty };
  }
  return { x: NORTH_GATE.x + 2, y: NORTH_GATE.y - Math.ceil(ward) - 5 };
}

/**
 * The spot a rift keeps when no free tile is near: `spot` itself when it's outside the ward and
 * the vale, off the ring and the gateways and not on another rift's tile, else the first such tile
 * walking straight out from the vale. Never inside the ward or the heart, whatever the engine says.
 */
function safeSpot(worldgen, ward, spot, taken = []) {
  const gates = clearOfGates(worldgen);
  const own = offTaken(taken);
  const clear = (x, y) => gates(x, y) && own(x, y);
  if (spot && finite(spot.x) && finite(spot.y) && !worldgen.inHeart(spot.x, spot.y) && worldgen.heartDistance(spot.x, spot.y) > ward && clear(spot.x, spot.y)) return { x: spot.x, y: spot.y };
  return outsideWard(worldgen, Math.max(ward, 1.5), finite(spot?.x) ? spot.x : NORTH_GATE.x, finite(spot?.y) ? spot.y : NORTH_GATE.y, clear);
}

function placeStory(worldgen, ward, free, taken) {
  const ok = spotTest(worldgen, ward, free);
  const clear = nearTaken(taken);
  const startY = NORTH_GATE.y - Math.ceil(ward) - STORY_BEYOND;
  let spot = null;
  for (let k = 0; k <= STORY_SEARCH && !spot; k += 1) if (clear(NORTH_GATE.x, startY - k) && ok(NORTH_GATE.x, startY - k)) spot = { x: NORTH_GATE.x, y: startY - k };
  spot = spot || findSpot(NORTH_GATE.x, startY, ok, taken) || safeSpot(worldgen, ward, { x: NORTH_GATE.x, y: startY }, taken);
  return { ...spot, beyond: Math.round(worldgen.heartDistance(spot.x, spot.y) - ward), towards: 'whisperwood' };
}

function placeReal(worldgen, spec, sig, ward, free, taken) {
  const base = worldgen.placeRealRift(spec, { urgency: sig.bright ? 0.3 : sig.urgency, wardRadius: ward });
  const spot = spec.genres[0] === 'kaiju'
    ? safeSpot(worldgen, ward, base, taken) // a Titan stays at sea
    : findSpot(base.x, base.y, spotTest(worldgen, ward, free), taken) || safeSpot(worldgen, ward, base, taken);
  return { ...spot, beyond: Math.round(worldgen.heartDistance(spot.x, spot.y) - ward), towards: base.towards ?? null };
}

function wardInfo(state, sig, now) {
  if (sig.kind === 'story' || sig.bright) return null;
  const entry = mapOf(riftsOf(state), 'warded')[sig.key];
  if (!isRecord(entry) || toTime(entry.since) !== sig.since || !finite(entry.until) || entry.until <= now || !STAGES.includes(entry.stage)) return null;
  return { until: entry.until, stage: entry.stage };
}

function isLetGo(state, sig) {
  if (sig.kind === 'story') return false;
  const entry = mapOf(riftsOf(state), 'letGo')[sig.key];
  return isRecord(entry) && toTime(entry.since) === sig.since;
}

const incomplete = (list) => {
  Object.defineProperty(list, 'incomplete', { value: true });
  return list;
};

function validSignal(sig) {
  return isRecord(sig) && typeof sig.key === 'string' && sig.key && Array.isArray(sig.signals) && sig.signals.length
    && finite(sig.urgency) && finite(sig.since) && ['nocturne', 'knocking', 'capacity', 'built', 'story'].includes(sig.kind);
}

/**
 * Rifts for the signals → Rift[] (urgent first; let-go ones left out; held ones listed with
 * x/y null). Each is placed with worldgen.placeRealRift and nudged to the nearest tile that
 * `isFree(x, y)` accepts: within 6 when it can, else searching wider in steps out to 30 tiles, and
 * past that it keeps a safe spot outside the ward. None is ever inside the Hearthward or the vale.
 * The story rift stands on the first free tile north of the north gate, `wardRadius + 4` out. A
 * Nocturne also carries `agents`, everyone who worked late in it, and the evening `bell` it stood
 * under (both kept with the open rift in the state).
 */
export function buildRealRifts({ signals, state = null, now = Date.now(), riftgen, worldgen, wardRadius = 0, isFree = null } = {}) {
  if (!riftgen || typeof riftgen.realRift !== 'function') return incomplete([]);
  const clock = clockOf(now);
  const s = isRecord(state) ? state : {};
  const ward = finite(wardRadius) && wardRadius > 0 ? wardRadius : 0;
  const free = freeTest(isFree);
  const canPlace = Boolean(worldgen) && ['placeRealRift', 'heartDistance', 'inHeart', 'walkable'].every((name) => typeof worldgen[name] === 'function');
  const taken = [];
  const out = [];
  // The story's crack has its own spot past the north gate, so it's placed first; the rest go
  // most urgent first, each keeping clear of the tiles already taken.
  const ordered = (Array.isArray(signals) ? signals : []).filter(validSignal)
    .sort((a, b) => (a.kind === 'story' ? 0 : 1) - (b.kind === 'story' ? 0 : 1) || bySignalOrder(a, b));
  for (const sig of ordered) {
    if (isLetGo(s, sig)) continue;
    const warded = wardInfo(s, sig, clock);
    let spec;
    try {
      spec = riftgen.realRift({ key: sig.key, subject: sig.subject, signals: sig.signals, urgency: warded ? STAGE_URGENCY[warded.stage] : sig.urgency, tier: 1, cause: sig.cause });
    } catch {
      continue;
    }
    if (!isRecord(spec) || typeof spec.id !== 'string') continue;
    const held = sig.held ?? null;
    let spot = { x: null, y: null, beyond: null, towards: null };
    if (!held && canPlace) {
      try {
        spot = sig.kind === 'story' ? placeStory(worldgen, ward, free, taken) : placeReal(worldgen, spec, sig, ward, free, taken);
        taken.push(spot);
      } catch {
        spot = { x: null, y: null, beyond: null, towards: null };
      }
    }
    const kind = sig.kind === 'story' ? 'story' : 'real';
    const rift = {
      id: spec.id,
      key: sig.key,
      kind,
      ...(kind === 'real' ? { realKind: sig.kind } : {}),
      spec,
      x: spot.x,
      y: spot.y,
      beyond: spot.beyond,
      towards: spot.towards,
      stage: spec.stage,
      urgency: sig.urgency,
      bright: sig.bright === true,
      warded,
      held,
      atWalls: !held && !warded && !sig.bright && kind !== 'story' && sig.urgency >= RIFT_RULES.wallsUrgency,
      cause: sig.cause,
      stitch: sig.stitch,
      since: sig.since,
      echo: sig.echo,
      subject: sig.subject,
      signals: [...sig.signals],
    };
    if (sig.sessionId) rift.sessionId = sig.sessionId;
    if (Array.isArray(sig.agents) && sig.agents.length) rift.agents = [...sig.agents];
    if (sig.kind === 'nocturne' && typeof sig.bell === 'string') rift.bell = sig.bell;
    out.push(rift);
  }
  return out.sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || bySignalOrder(a, b));
}

// ---------------------------------------------------------------------------
// Wild rifts.

function closedTest(closed, day) {
  if (closed instanceof Set) return (id) => closed.has(id);
  if (Array.isArray(closed)) return (id) => closed.includes(id);
  if (isRecord(closed)) {
    return (id) => {
      if (!Object.hasOwn(closed, id)) return false;
      const value = closed[id];
      return finite(value) ? value === day : Boolean(value);
    };
  }
  return () => false;
}

export const WILD_CAUSE = 'A wild rift, with nothing real behind it. It’s here for the adventure.';
export const WILD_STITCH = 'Step through and mend it if you like. It closes with the day either way.';

/**
 * Today's wild rifts in one chunk → Rift[] (kind 'wild'). `closed` holds the rift ids stitched or
 * let go today: a Set, an array, or state.rifts.closedWild itself (ids mapped to their day).
 * Each is nudged within its chunk to the nearest tile `isFree` accepts (searching wider in steps
 * when nothing near is free); none is ever inside the Hearthward.
 */
export function wildRiftsForChunk({ worldgen, riftgen, cx, cy, day, wardRadius = 0, closed = null, isFree = null } = {}) {
  if (!worldgen || !['wildRiftSpawns', 'heartDistance', 'inHeart', 'walkable'].every((name) => typeof worldgen[name] === 'function')) return [];
  if (!riftgen || typeof riftgen.wildRift !== 'function') return [];
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !finite(day)) return [];
  const ward = finite(wardRadius) && wardRadius > 0 ? wardRadius : 0;
  const size = 32;
  const inChunk = (x, y) => x >= cx * size && y >= cy * size && x < cx * size + size && y < cy * size + size;
  const isClosed = closedTest(closed, day);
  const free = freeTest(isFree);
  const since = dayStart(day);
  const taken = [];
  const out = [];
  let spawns = [];
  try {
    spawns = worldgen.wildRiftSpawns(cx, cy, day, { wardRadius: ward });
  } catch {
    return [];
  }
  for (const spawn of spawns) {
    let spec;
    try {
      spec = riftgen.wildRift({ seed: spawn.seed, tier: spawn.tier, depth: spawn.depth, weights: spawn.weights });
    } catch {
      continue;
    }
    if (!isRecord(spec) || isClosed(spec.id)) continue;
    // Worldgen spawns on walkable ground outside the ward, so the fallback is the spawn itself,
    // which keeps the rift in its own chunk.
    const spot = findSpot(spawn.x, spawn.y, spotTest(worldgen, ward, free, inChunk), taken)
      || safeSpot(worldgen, ward, spawn);
    taken.push(spot);
    out.push({
      id: spec.id,
      key: null,
      kind: 'wild',
      spec,
      x: spot.x,
      y: spot.y,
      beyond: Math.round(worldgen.heartDistance(spot.x, spot.y) - ward),
      towards: null,
      stage: spec.stage,
      urgency: 0,
      bright: false,
      warded: null,
      held: null,
      atWalls: false,
      cause: WILD_CAUSE,
      stitch: WILD_STITCH,
      since,
      echo: null,
      subject: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// State changes. Each returns a new state and leaves the one it was given alone.

function riftsCopy(state) {
  const base = isRecord(state) && isRecord(state.rifts) ? state.rifts : emptyRifts();
  const empty = emptyRifts();
  const copy = { ...base };
  for (const name of ['open', 'warded', 'letGo', 'belled', 'closedWild', 'visited']) copy[name] = { ...(isRecord(base[name]) ? base[name] : empty[name]) };
  copy.stitched = { ...empty.stitched, ...(isRecord(base.stitched) ? base.stitched : {}) };
  copy.history = Array.isArray(base.history) ? [...base.history] : [];
  copy.deepest = finite(base.deepest) ? base.deepest : 0;
  return copy;
}

function withRifts(state, rifts, satchel = null) {
  const base = isRecord(state) ? state : {};
  return satchel ? { ...base, rifts, satchel } : { ...base, rifts };
}

function historyEntry(rift, how, now, extra = {}) {
  const spec = isRecord(rift.spec) ? rift.spec : {};
  const entry = {
    key: rift.kind === 'wild' ? null : (rift.key ?? null),
    id: rift.id ?? spec.id,
    name: typeof rift.name === 'string' ? rift.name : (spec.name ?? ''),
    genres: Array.isArray(rift.genres) ? [...rift.genres] : (Array.isArray(spec.genres) ? [...spec.genres] : []),
    kind: rift.kind === 'story' || rift.kind === 'wild' ? rift.kind : 'real',
    openedAt: extra.openedAt ?? null,
    closedAt: now,
    how,
  };
  if (rift.kind !== 'wild' && finite(rift.since)) entry.since = rift.since;
  return entry;
}

function pushHistory(rifts, entry) {
  rifts.history = [entry, ...rifts.history].slice(0, STATE_LIMITS.history);
}

/**
 * Whether this very episode (its key and since) already sealed, was stitched or closed. A
 * Knocking keeps the session's own waitingSince, so if the session goes missing from one look and
 * comes back still waiting, it's the episode that sealed, not a new one.
 */
function episodeEnded(history, key, since) {
  return history.some((h) => isRecord(h) && h.key === key && h.since === since && ENDED_HOWS.includes(h.how));
}

function bump(rifts, kind) {
  const name = kind === 'story' ? 'story' : kind === 'wild' ? 'wild' : 'real';
  rifts.stitched = { ...rifts.stitched, [name]: (finite(rifts.stitched[name]) ? rifts.stitched[name] : 0) + 1 };
}

/**
 * Adds a rift's loot to the satchel: essences by name (with the genre each came from), relics
 * with their story, logs as materials.
 */
function addLoot(satchelIn, loot, at, materials = null) {
  const satchel = isRecord(satchelIn) ? satchelIn : emptySatchel();
  const out = {
    ...satchel,
    materials: { ...emptySatchel().materials, ...(isRecord(satchel.materials) ? satchel.materials : {}) },
    essences: { ...(isRecord(satchel.essences) ? satchel.essences : {}) },
    essenceGenres: { ...(isRecord(satchel.essenceGenres) ? satchel.essenceGenres : {}) },
    relics: Array.isArray(satchel.relics) ? [...satchel.relics] : [],
  };
  for (const item of cleanLoot(loot)) {
    if (item.relic) {
      out.relics.push({ name: clip(item.item, 80), text: item.text ?? '', genre: item.genre, at });
      continue;
    }
    const material = item.item.toLowerCase();
    if (MATERIALS.has(material)) {
      out.materials[material] = (finite(out.materials[material]) ? out.materials[material] : 0) + item.qty;
      continue;
    }
    out.essences[item.item] = (finite(out.essences[item.item]) ? out.essences[item.item] : 0) + item.qty;
    if (item.genre) out.essenceGenres[item.item] = item.genre;
  }
  if (isRecord(materials)) {
    for (const [id, amount] of Object.entries(materials)) {
      if (!MATERIALS.has(id) || !finite(amount) || amount <= 0) continue;
      out.materials[id] = (finite(out.materials[id]) ? out.materials[id] : 0) + Math.floor(amount);
    }
  }
  out.relics = out.relics.slice(-STATE_LIMITS.relics);
  return out;
}

function openEntry(rift, now, previous = null) {
  const spec = isRecord(rift.spec) ? rift.spec : {};
  const entry = {
    id: rift.id,
    since: rift.since,
    openedAt: previous?.openedAt ?? now,
    kind: rift.kind === 'story' ? 'story' : 'real',
    realKind: rift.kind === 'story' ? 'story' : rift.realKind,
    name: typeof spec.name === 'string' ? spec.name : '',
    genres: Array.isArray(spec.genres) ? [...spec.genres] : [],
    loot: cleanLoot(spec.loot),
    signals: Array.isArray(rift.signals) ? [...rift.signals] : (Array.isArray(previous?.signals) ? [...previous.signals] : []),
    subject: rift.subject ?? '',
    urgency: rift.urgency,
    cause: rift.cause,
    stitch: rift.stitch,
    echo: isRecord(rift.echo) ? { ...rift.echo } : null,
    bright: rift.bright === true,
  };
  if (rift.sessionId) entry.sessionId = rift.sessionId;
  if (Array.isArray(rift.agents) && rift.agents.length) entry.agents = [...rift.agents];
  const bell = typeof rift.bell === 'string' ? rift.bell : previous?.bell;
  if (rift.realKind === 'nocturne' && typeof bell === 'string') entry.bell = bell;
  return entry;
}

const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Brings the state in line with the rifts standing now.
 * → { state, opened: Rift[], sealed: [{ key, id, name, genres, kind, loot, bright, realKind, subject }],
 *     closed: [{ key, id, name, genres, kind, realKind, subject }], bell: Rift[], notify }
 * - A key open in the state whose signal has gone (and which wasn't let go) has sealed: it goes to
 *   history as 'sealed', counts as mended and its loot goes to the satchel. A bright rift fading
 *   goes to history too, with no loot. Seals found at boot come back together, for one summary.
 * - A Nocturne that has gone because the evening bell was switched off or moved (not because the
 *   crew went quiet, and not at dawn) closes quietly: history 'closed', no loot, nothing counted.
 *   It's in `closed`, never in `sealed`.
 * - A held rift is never counted as open.
 * - A rift that reaches the walls with a `since` not yet belled rings once (`bell`), and is
 *   marked belled. `notify` says whether the Gate Bell may send a desktop note (tier ≥ 2, on).
 * Returns the same state object when nothing changed.
 */
export function reconcileRifts(state, rifts, now = Date.now(), { tier } = {}) {
  const base = isRecord(state) ? state : {};
  const clock = clockOf(now);
  const complete = Array.isArray(rifts) && rifts.incomplete !== true;
  const list = (Array.isArray(rifts) ? rifts : []).filter((r) => isRecord(r) && typeof r.key === 'string' && r.key && (r.kind === 'real' || r.kind === 'story') && finite(r.since) && typeof r.id === 'string');
  const live = new Map();
  const heldKeys = new Set();
  for (const rift of list) {
    if (rift.held) heldKeys.add(rift.key);
    else if (!live.has(rift.key)) live.set(rift.key, rift);
  }
  const R = riftsCopy(base);
  let satchel = null;
  let changed = false;
  const opened = [];
  const sealed = [];
  const closed = [];
  const bell = [];
  const bellNow = currentBell(base);

  // Seals: open keys whose signal has gone, or whose episode was replaced by a new one.
  for (const [key, entry] of Object.entries(R.open)) {
    if (!isRecord(entry)) {
      delete R.open[key];
      changed = true;
      continue;
    }
    const current = live.get(key);
    if (current && current.since === entry.since) continue;
    if (heldKeys.has(key)) {
      delete R.open[key]; // held by the ward-post now: not open, and not sealed either
      changed = true;
      continue;
    }
    if (!current && !complete) continue;
    const letGo = R.letGo[key];
    delete R.open[key];
    changed = true;
    if (isRecord(letGo) && letGo.since === entry.since) continue;
    if (entry.kind === 'story' && !storyStepDone(base)) continue; // only mending closes the story's crack
    const bright = entry.bright === true;
    const about = { key, id: entry.id, name: entry.name ?? '', genres: Array.isArray(entry.genres) ? [...entry.genres] : [], kind: entry.kind === 'story' ? 'story' : 'real' };
    // An episode that stood again after it sealed has had its seal, its count and its loot: it
    // closes quietly now, and its history entry is the one it already has.
    if (entry.resumed === true) {
      closed.push({ ...about, realKind: entry.realKind ?? null, subject: entry.subject ?? '' });
      continue;
    }
    const record = (how) => pushHistory(R, { ...about, genres: [...about.genres], openedAt: entry.openedAt ?? null, closedAt: clock, how, ...(finite(entry.since) ? { since: entry.since } : {}) });
    // A Nocturne the evening bell no longer covers (switched off, or moved past it) wasn't mended:
    // Chris changed a setting. It closes quietly, with no loot and nothing counted. Dawn still seals.
    if (!current && entry.realKind === 'nocturne' && !keyEnded(key, clock) && bellMovedOff(entry, bellNow)) {
      record('closed');
      closed.push({ ...about, realKind: 'nocturne', subject: entry.subject ?? '' });
      continue;
    }
    record('sealed');
    const loot = bright ? [] : cleanLoot(entry.loot);
    if (!bright) {
      bump(R, entry.kind);
      if (loot.length) satchel = addLoot(satchel ?? base.satchel, loot, clock);
    }
    sealed.push({ ...about, loot, bright, realKind: entry.realKind ?? null, subject: entry.subject ?? '' });
  }

  // Opened, and the words of those still open kept current (so a hiccup can carry them).
  for (const rift of live.values()) {
    const previous = R.open[rift.key];
    const entry = openEntry(rift, clock, isRecord(previous) ? previous : null);
    if (!isRecord(previous)) {
      // The same episode back after it sealed (a waiting session missing from one look, say):
      // it stands again, with no news, and it won't seal or pay out a second time.
      if (episodeEnded(R.history, rift.key, rift.since)) entry.resumed = true;
      else opened.push(rift);
      R.open[rift.key] = entry;
      changed = true;
    } else if (!sameEntry(previous, { ...previous, ...entry })) {
      R.open[rift.key] = { ...previous, ...entry };
      changed = true;
    }
  }

  // The Gate Bell: once per episode, when a rift reaches the walls.
  for (const rift of live.values()) {
    if (!rift.atWalls) continue;
    const rung = R.belled[rift.key];
    if (isRecord(rung) && rung.since === rift.since) continue;
    R.belled[rift.key] = { since: rift.since, at: clock };
    bell.push(rift);
    changed = true;
  }

  // Tidy up: wards that lapsed or whose episode moved on, let-go and bell marks for episodes that are over.
  const moved = (key, entry) => {
    const current = live.get(key);
    return Boolean(current) && isRecord(entry) && entry.since !== current.since;
  };
  for (const [key, entry] of Object.entries(R.warded)) {
    if (!isRecord(entry) || !finite(entry.until) || entry.until <= clock || moved(key, entry) || keyEnded(key, clock)) {
      delete R.warded[key];
      changed = true;
    }
  }
  for (const name of ['letGo', 'belled']) {
    for (const [key, entry] of Object.entries(R[name])) {
      // A let-go rift is hidden, so it never shows as live: it stays let go until its episode
      // moves on or its key ends (the normaliser caps how many are kept). A bell mark for a rift
      // that's gone quiet for a month is dropped.
      const stale = !isRecord(entry) || keyEnded(key, clock)
        || (name === 'belled' && !live.has(key) && finite(entry.at) && clock - entry.at > PRUNE_AFTER);
      if (stale || (name === 'letGo' && moved(key, entry))) {
        delete R[name][key];
        changed = true;
      }
    }
  }
  const today = dayNumber(clock);
  for (const [id, day] of Object.entries(R.closedWild)) {
    if (!finite(day) || day < today) {
      delete R.closedWild[id];
      changed = true;
    }
  }

  const tierNow = finite(tier) ? tier : tierOf(base);
  const settings = isRecord(base.settings) ? base.settings : {};
  return {
    state: changed ? withRifts(base, R, satchel) : base,
    opened,
    sealed,
    closed,
    bell,
    notify: tierNow >= 2 && settings.gateBell !== false,
  };
}

function storyStepDone(state) {
  const done = state.story?.prologue?.done;
  return isRecord(done) && toTime(done['first-crack']) !== null;
}

/** Wards a real rift for three days: its stage holds where it is, and it never counts as at the walls. */
export function wardRift(state, rift, now = Date.now()) {
  if (!isRecord(rift) || rift.kind !== 'real' || rift.bright || rift.held || typeof rift.key !== 'string' || !finite(rift.since)) return state;
  const clock = clockOf(now);
  const R = riftsCopy(state);
  const frozen = isRecord(rift.warded) && STAGES.includes(rift.warded.stage) ? rift.warded.stage : (STAGES.includes(rift.stage) ? rift.stage : 'hairline');
  R.warded[rift.key] = { since: rift.since, until: clock + RIFT_RULES.wardDays * DAY, stage: frozen };
  return withRifts(state, R);
}

/** Takes a ward down. */
export function unwardRift(state, key) {
  const rift = isRecord(key) ? key.key : key;
  if (typeof rift !== 'string' || !Object.hasOwn(riftsOf(state).warded ?? {}, rift)) return state;
  const R = riftsCopy(state);
  delete R.warded[rift];
  return withRifts(state, R);
}

/**
 * Lets a real rift go: it disappears until its `since` changes (a new episode). The story rift
 * can't be let go. A bright rift can't either: this lets it be instead (see letItBe).
 */
export function letGoRift(state, rift, now = Date.now()) {
  if (!isRecord(rift) || typeof rift.key !== 'string' || !finite(rift.since) || rift.kind === 'story' || rift.kind === 'wild') return state;
  if (rift.bright) return letItBe(state, rift, now);
  const clock = clockOf(now);
  const R = riftsCopy(state);
  const openedAt = isRecord(R.open[rift.key]) ? R.open[rift.key].openedAt : null;
  R.letGo[rift.key] = { since: rift.since, at: clock };
  delete R.open[rift.key];
  delete R.warded[rift.key];
  pushHistory(R, historyEntry(rift, 'let-go', clock, { openedAt }));
  return withRifts(state, R);
}

/** "Let it be" for a bright rift: it's hidden, and goes to history as having faded. */
export function letItBe(state, rift, now = Date.now()) {
  if (!isRecord(rift) || !rift.bright || typeof rift.key !== 'string' || !finite(rift.since)) return state;
  const clock = clockOf(now);
  const R = riftsCopy(state);
  const openedAt = isRecord(R.open[rift.key]) ? R.open[rift.key].openedAt : null;
  R.letGo[rift.key] = { since: rift.since, at: clock };
  delete R.open[rift.key];
  pushHistory(R, historyEntry(rift, 'sealed', clock, { openedAt }));
  return withRifts(state, R);
}

/**
 * Claims a rift's loot into the satchel, once per rift id (a bright rift's visit, or the chests
 * of an Elsewhere): essences, relics, and any `materials` found there ({ birch: 6 }).
 */
export function claimLoot(state, spec, now = Date.now(), { riftId = null, materials = null } = {}) {
  const id = riftId ?? (isRecord(spec) ? spec.id : null);
  if (typeof id !== 'string' || !/^rift:[0-9a-z]{1,13}$/.test(id)) return state;
  const R = riftsCopy(state);
  if (R.visited[id]) return state;
  const clock = clockOf(now);
  R.visited[id] = clock;
  const keys = Object.keys(R.visited);
  if (keys.length > STATE_LIMITS.visited) {
    for (const key of keys.sort((a, b) => R.visited[a] - R.visited[b]).slice(0, keys.length - STATE_LIMITS.visited)) delete R.visited[key];
  }
  const satchel = addLoot(isRecord(state) ? state.satchel : null, isRecord(spec) ? spec.loot : [], clock, materials);
  return withRifts(state, R, satchel);
}

function specOf(rift) {
  if (!isRecord(rift)) return null;
  if (isRecord(rift.spec)) return rift.spec;
  return typeof rift.id === 'string' && Array.isArray(rift.genres) ? rift : null;
}

/** The story's crack, as a Rift or as its bare spec (riftgen makes it with kind 'real' and the story key). */
function isStoryRift(rift, spec = specOf(rift)) {
  return isRecord(rift) && (rift.kind === 'story' || rift.key === STORY_RIFT_KEY || spec?.key === STORY_RIFT_KEY);
}

/** A rift with a real cause behind it, as a Rift or as its bare spec: its seam won't take the thread. */
function isRealRift(rift, spec = specOf(rift)) {
  return isRecord(rift) && (rift.kind === 'real' || spec?.kind === 'real' || (typeof rift.key === 'string' && rift.key !== STORY_RIFT_KEY));
}

/**
 * Mends the story's crack from its Elsewhere: the Prologue's `first-crack` step is done, the rift
 * goes to history as stitched, and its loot goes to the satchel. Once only. `rift` is the story
 * Rift or its spec (or null, to use the open one); a wild or real rift changes nothing.
 */
export function stitchStory(state, rift, now = Date.now()) {
  if (!isRecord(state)) return state;
  if (isRecord(rift) && !isStoryRift(rift) && (isRealRift(rift) || rift.kind === 'wild' || specOf(rift)?.kind === 'wild')) return state;
  const clock = clockOf(now);
  const spec = specOf(rift) ?? {};
  const already = storyStepDone(state) && (riftsOf(state).history ?? []).some((h) => isRecord(h) && h.key === STORY_RIFT_KEY);
  if (already) return state;
  let next = markStory(state, 'first-crack', clock);
  const R = riftsCopy(next);
  const openEntryNow = R.open[STORY_RIFT_KEY];
  const id = typeof rift?.id === 'string' ? rift.id : (isRecord(openEntryNow) ? openEntryNow.id : spec.id);
  if (typeof id !== 'string') return next;
  delete R.open[STORY_RIFT_KEY];
  pushHistory(R, historyEntry({ kind: 'story', key: STORY_RIFT_KEY, id, spec, name: spec.name ?? openEntryNow?.name, genres: spec.genres ?? openEntryNow?.genres, since: isRecord(openEntryNow) ? openEntryNow.since : rift?.since }, 'stitched', clock, { openedAt: isRecord(openEntryNow) ? openEntryNow.openedAt : null }));
  bump(R, 'story');
  next = withRifts(next, R);
  return claimLoot(next, { id, loot: spec.loot ?? openEntryNow?.loot ?? [] }, clock, { riftId: id });
}

/**
 * Stitches a wild rift (or a rung of its ladder) in its Elsewhere: closed for today, counted,
 * the deepest rung remembered, and its loot claimed. The story rift, as a Rift or its bare spec,
 * is passed on to stitchStory. A real rift changes nothing: only mending the real thing seals it.
 */
export function stitchWild(state, rift, now = Date.now()) {
  const spec = specOf(rift);
  if (isStoryRift(rift, spec)) return stitchStory(state, rift, now);
  if (isRealRift(rift, spec)) return state;
  const id = typeof rift?.id === 'string' ? rift.id : spec?.id;
  if (!spec || typeof id !== 'string' || !/^rift:[0-9a-z]{1,13}$/.test(id)) return state;
  const clock = clockOf(now);
  const today = dayNumber(clock);
  const R = riftsCopy(state);
  if (R.closedWild[id] === today) return state;
  R.closedWild[id] = today;
  bump(R, 'wild');
  R.deepest = Math.max(R.deepest, finite(spec.depth) ? Math.floor(spec.depth) : 1);
  pushHistory(R, historyEntry({ ...rift, kind: 'wild', id, spec }, 'stitched', clock));
  return claimLoot(withRifts(state, R), spec, clock, { riftId: id });
}

/** Leaves a wild rift be: it closes for today, with no loot. */
export function letGoWild(state, rift, now = Date.now()) {
  const spec = specOf(rift);
  const id = typeof rift?.id === 'string' ? rift.id : spec?.id;
  if (!spec || typeof id !== 'string' || !/^rift:[0-9a-z]{1,13}$/.test(id) || isStoryRift(rift, spec) || isRealRift(rift, spec)) return state;
  const clock = clockOf(now);
  const today = dayNumber(clock);
  const R = riftsCopy(state);
  if (R.closedWild[id] === today) return state;
  R.closedWild[id] = today;
  pushHistory(R, historyEntry({ ...rift, kind: 'wild', id, spec }, 'let-go', clock));
  return withRifts(state, R);
}

// ---------------------------------------------------------------------------
// Words for the shell's bubbles and notes.

/** The Gate Bell's note: { title, body }, the real cause first. */
export function bellText(rift) {
  const cause = isRecord(rift) && typeof rift.cause === 'string' && rift.cause ? rift.cause : 'A rift has come right up to the walls.';
  return { title: 'A rift is at the walls', body: cause };
}

/**
 * One quiet line for rifts that sealed while MILO was closed (bright ones left out), or null.
 * 'While you were away, the rift over “Letters to answer” sealed itself.' / '…, 3 rifts sealed themselves.'
 */
export function sealedSummary(sealed) {
  const list = (Array.isArray(sealed) ? sealed : []).filter((s) => isRecord(s) && !s.bright);
  if (!list.length) return null;
  if (list.length > 1) return `While you were away, ${list.length} rifts sealed themselves.`;
  const [only] = list;
  const subject = typeof only.subject === 'string' ? only.subject : '';
  let which = 'a rift';
  if (only.realKind === 'knocking' && subject) which = `the rift over ${subject}`;
  else if (only.realKind === 'nocturne' && subject) which = `the rift from ${subject}`;
  else if (only.realKind === 'capacity') which = 'the Codex capacity rift';
  else if (only.kind === 'story') which = 'the crack past the north gate';
  return `While you were away, ${which} sealed itself.`;
}
