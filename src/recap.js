// "While you were away" recaps, Milo's greeting, and live alert wording.
// Pure ESM with no DOM and no fs. Works on AgentSession summaries from src/watch.

export const AWAY_THRESHOLD_MS = 10 * 60 * 1000;
export const MAX_LINE = 90;
const MAX_LINES = 4;
const ALERT_TITLE_MAX = 60;
const OPEN = '“'; // “
const CLOSE = '”'; // ”
const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };
const AGENT_ORDER = ['claude', 'codex'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timeOrNull = (value) => (finite(value) && value > 0 ? value : null);

/** Shortens to `max` UTF-16 units with an ellipsis, never splitting a surrogate pair (emoji). */
export function truncate(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(1, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function cleanTitle(value) {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return title || 'Untitled session';
}

/** 'claude' → 'Claude'. Unknown agents get a capitalised id; missing ones read as 'An agent'. */
export function agentName(agent) {
  const id = typeof agent === 'string' ? agent.trim() : '';
  if (!id) return 'An agent';
  const known = AGENT_NAMES[id.toLowerCase()];
  if (known) return known;
  const name = truncate(id.replace(/\s+/g, ' '), 20);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Wraps a title in curly quotes, shortened so the whole line stays within `budget` chars. */
function quoted(title, budget) {
  return `${OPEN}${truncate(cleanTitle(title), Math.max(8, budget - 2))}${CLOSE}`;
}

/** prefix + “title” + suffix, never longer than MAX_LINE. */
function lineWithTitle(prefix, title, suffix) {
  return `${prefix}${quoted(title, MAX_LINE - prefix.length - suffix.length)}${suffix}`;
}

function completionsOf(session) {
  return Array.isArray(session.completions) ? session.completions.filter(finite) : [];
}

function newestCompletion(session) {
  const list = completionsOf(session);
  return list.length ? Math.max(...list) : -Infinity;
}

/** Valid sessions only, first occurrence of each id wins. Accepts a Snapshot too. */
function sessionList(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.sessions) ? value.sessions : [];
  const seen = new Set();
  const out = [];
  for (const session of list) {
    if (!isRecord(session) || typeof session.id !== 'string' || !session.id || seen.has(session.id)) continue;
    seen.add(session.id);
    out.push(session);
  }
  return out;
}

function item(session, count) {
  return {
    id: session.id,
    agent: typeof session.agent === 'string' ? session.agent : '',
    title: cleanTitle(session.title),
    project: typeof session.project === 'string' ? session.project : '',
    count,
  };
}

const byKeyDesc = (a, b) => b.key - a.key;
const strip = (entries) => entries.sort(byKeyDesc).map((entry) => entry.item);

/**
 * What happened since Chris last looked. `lastSeenAt` null means a first visit:
 * nothing counts as finished or started, only the current state is reported.
 */
export function buildRecap(sessions, lastSeenAt, now = Date.now()) {
  const clock = finite(now) ? now : Date.now();
  const seen = timeOrNull(lastSeenAt);
  const finished = [];
  const started = [];
  const working = [];
  const needsYou = [];

  for (const session of sessionList(sessions)) {
    const since = seen === null ? [] : completionsOf(session).filter((t) => t > seen);
    const entry = (key) => ({ key: finite(key) ? key : 0, item: item(session, since.length) });
    if (since.length) finished.push(entry(Math.max(...since)));
    if (seen !== null && finite(session.startedAt) && session.startedAt > seen) started.push(entry(session.startedAt));
    if (session.archived === true) continue;
    if (session.status === 'working') working.push(entry(session.lastActivityAt));
    else if (session.status === 'needs-you') needsYou.push(entry(session.lastActivityAt));
  }

  const recap = {
    awayMs: seen === null ? 0 : Math.max(0, clock - seen),
    finished: strip(finished),
    started: strip(started),
    working: strip(working),
    needsYou: strip(needsYou),
    quiet: false,
    firstVisit: seen === null,
  };
  recap.quiet = !recap.finished.length && !recap.started.length && !recap.working.length && !recap.needsYou.length;
  return recap;
}

const itemsOf = (value) => (Array.isArray(value) ? value.filter((entry) => isRecord(entry)) : []);

/** Groups items by agent: Claude, then Codex, then anyone else in order of appearance. */
function byAgent(items) {
  const groups = new Map();
  for (const entry of items) {
    const key = typeof entry.agent === 'string' ? entry.agent.toLowerCase() : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const rank = (key) => {
    const i = AGENT_ORDER.indexOf(key);
    return i === -1 ? AGENT_ORDER.length : i;
  };
  return [...groups.entries()]
    .map(([key, list], index) => ({ key, list, index }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const countOf = (entry) => (finite(entry.count) && entry.count > 0 ? Math.floor(entry.count) : 1);

function finishedLine(who, list) {
  if (list.length === 1) {
    const n = countOf(list[0]);
    return n === 1
      ? lineWithTitle(`${who} finished `, list[0].title, '.')
      : lineWithTitle(`${who} finished ${n} tasks in `, list[0].title, '.');
  }
  const total = list.reduce((sum, entry) => sum + countOf(entry), 0);
  return `${who} finished ${plural(total, 'task', 'tasks')}.`;
}

function workingLine(who, list, startedIds, firstVisit) {
  if (list.length === 1) {
    const [only] = list;
    if (startedIds.has(only.id)) return lineWithTitle(`${who} started `, only.title, ' and is still on it.');
    return lineWithTitle(`${who} is ${firstVisit ? '' : 'still '}working on `, only.title, '.');
  }
  return `${who} is ${firstVisit ? '' : 'still '}working in ${list.length} sessions.`;
}

function needsYouLine(who, list) {
  if (list.length === 1) return lineWithTitle(`${who} is waiting on you in `, list[0].title, '.');
  return `${who} is waiting on you in ${list.length} sessions.`;
}

function startedLine(who, list) {
  if (list.length === 1) return lineWithTitle(`${who} started `, list[0].title, '.');
  return `${who} started ${list.length} sessions.`;
}

function greetingTitle(who, clock, firstToday, awayMs) {
  if (firstToday) {
    const hour = new Date(clock).getHours();
    if (hour >= 5 && hour <= 11) return `Good morning, ${who}`;
    if (hour >= 12 && hour <= 16) return `Good afternoon, ${who}`;
    if (hour >= 17 && hour <= 21) return `Good evening, ${who}`;
    return `Hi, ${who}`;
  }
  return awayMs >= AWAY_THRESHOLD_MS ? 'Welcome back' : 'Here with you';
}

/**
 * Milo's greeting for a recap. Lines read in the order finished, started, working, waiting;
 * when there are more than four, what needs Chris and what finished are kept first.
 */
export function greeting(recap, options = {}) {
  const opts = isRecord(options) ? options : {};
  const who = typeof opts.name === 'string' && opts.name.replace(/\s+/g, ' ').trim()
    ? truncate(opts.name.replace(/\s+/g, ' ').trim(), 30)
    : 'Chris';
  const clock = finite(opts.now) ? opts.now : Date.now();
  const data = isRecord(recap) ? recap : {};
  const awayMs = finite(data.awayMs) ? Math.max(0, data.awayMs) : 0;
  const firstVisit = data.firstVisit === true;

  const finished = itemsOf(data.finished);
  const started = itemsOf(data.started);
  const working = itemsOf(data.working);
  const needsYou = itemsOf(data.needsYou);
  const busyIds = new Set([...finished, ...working, ...needsYou].map((entry) => entry.id));
  const startedIds = new Set(started.map((entry) => entry.id));
  const startedOnly = started.filter((entry) => !busyIds.has(entry.id));

  // order = display position, priority = what survives when there are too many lines.
  const candidates = [];
  const add = (order, priority, items, make) => {
    for (const group of byAgent(items)) {
      candidates.push({ order, priority, text: make(agentName(group.key), group.list), seq: candidates.length });
    }
  };
  add(0, 1, finished, finishedLine);
  add(1, 3, startedOnly, startedLine);
  add(2, 2, working, (who2, list) => workingLine(who2, list, startedIds, firstVisit));
  add(3, 0, needsYou, needsYouLine);

  let lines;
  if (!candidates.length) {
    if (firstVisit) lines = ['I’m keeping watch over your crew.'];
    else if (awayMs >= AWAY_THRESHOLD_MS) lines = ['All quiet while you were away.'];
    else lines = ['Nothing new since you last looked.'];
  } else {
    let chosen = candidates;
    let more = false;
    if (candidates.length > MAX_LINES) {
      chosen = [...candidates].sort((a, b) => a.priority - b.priority || a.seq - b.seq).slice(0, MAX_LINES - 1);
      more = true;
    }
    lines = chosen.sort((a, b) => a.order - b.order || a.seq - b.seq).map((c) => c.text);
    if (more) lines.push('There’s more in the watchtower.');
  }

  return {
    title: greetingTitle(who, clock, opts.firstToday === true, awayMs),
    lines,
    hasNews: candidates.length > 0,
  };
}

/**
 * Live alert events between two scans. A missing previous list (first scan) yields no events,
 * so launching MILO never replays old news as alerts.
 *
 * One finished turn gives one 'finished' event even when its two signals land in different scans
 * (Claude's live registry flipping busy -> idle, and the end_turn record in the transcript):
 * - working -> done always reports the finish;
 * - a new completion while the session is still working waits for that working -> done;
 * - a new completion on a session that was not working reports only when it is newer than
 *   anything the previous scan knew about (otherwise it is the late record of a finish already
 *   reported).
 * Times later than `now` (clock skew) never move the horizon for brand-new sessions.
 */
export function diffSnapshots(prevSessions, nextSessions, now = Date.now()) {
  const prevList = Array.isArray(prevSessions) || Array.isArray(prevSessions?.sessions) ? sessionList(prevSessions) : null;
  if (!prevList) return [];
  const clock = finite(now) ? now : Date.now();
  const prev = new Map(prevList.map((session) => [session.id, session]));
  // Newest moment the previous scan knew about; a brand-new session that already finished
  // after this counts as finished, older ones that merely scrolled into view do not.
  let horizon = -Infinity;
  const toHorizon = (value) => {
    if (finite(value) && value <= clock) horizon = Math.max(horizon, value);
  };
  for (const session of prevList) {
    toHorizon(session.lastActivityAt);
    for (const completion of completionsOf(session)) toHorizon(completion);
  }

  const events = [];
  for (const session of sessionList(nextSessions)) {
    const before = prev.get(session.id);
    if (before) {
      const newest = newestCompletion(session);
      const gained = newest > newestCompletion(before);
      const wrappedUp = before.status === 'working' && session.status === 'done';
      const knownUntil = finite(before.lastActivityAt) ? before.lastActivityAt : -Infinity;
      const finished = wrappedUp
        || (gained && session.status !== 'working' && (before.status === 'working' || newest > knownUntil));
      if (finished) events.push({ type: 'finished', session });
      if (session.status === 'needs-you' && before.status !== 'needs-you') events.push({ type: 'needs-you', session });
    } else {
      if (prevList.length && newestCompletion(session) > horizon) events.push({ type: 'finished', session });
      if (session.status === 'needs-you') events.push({ type: 'needs-you', session });
      if (session.status === 'working') events.push({ type: 'started', session });
    }
  }
  return events;
}

/** Calm one-line notification text for a diffSnapshots event. */
export function alertText(event) {
  const session = isRecord(event) && isRecord(event.session) ? event.session : {};
  const who = agentName(session.agent);
  const title = `${OPEN}${truncate(cleanTitle(session.title), ALERT_TITLE_MAX)}${CLOSE}`;
  switch (isRecord(event) ? event.type : undefined) {
    case 'finished':
      return { title: `${who} finished a task`, body: `${title} is ready for you.` };
    case 'needs-you':
      return { title: `${who} is waiting on you`, body: `${title} needs you to keep going.` };
    case 'started':
      return { title: `${who} started a task`, body: `${title} is underway.` };
    default:
      return { title: 'Milo has an update', body: 'Take a look when you’re ready.' };
  }
}

// ---------------------------------------------------------------------------
// Buildings.

const DESIGNER_NAMES = { claude: 'Claude Code', codex: 'Codex' };
const BUILT_NAME_MAX = 28;

/** Who a designer id is, in words: 'Claude Code', 'Codex', or 'Milo' for his own kit. */
export function designerName(id) {
  return DESIGNER_NAMES[id] || 'Milo';
}

/** 'Clip studio' → 'The Clip studio'. Names that already carry their own article or owner keep them. */
function withArticle(name) {
  if (/^(the|a|an)\s/i.test(name) || /^\S+['’]s\s/.test(name)) return name.charAt(0).toUpperCase() + name.slice(1);
  return `The ${name}`;
}

const CREW = new Set(['claude', 'codex']);

/**
 * Why the crew didn't come through, from the architect's { by, code }: "Codex isn’t signed in",
 * "Codex’s answer was hard to read", "Codex didn’t answer". `asked` names who, when `by` doesn't.
 * `me`: Milo says it himself ("I couldn’t reach the crew").
 */
function reasonWords(fallback, asked, me) {
  const by = isRecord(fallback) && CREW.has(fallback.by) ? fallback.by : null;
  const who = designerName(by || asked);
  switch (isRecord(fallback) ? fallback.code : undefined) {
    case 'auth': return by ? `${who} isn’t signed in` : 'The crew isn’t signed in';
    case 'missing': return by ? `${who} isn’t on this PC` : `${me ? 'I' : 'Milo'} couldn’t reach the crew`;
    case 'agents': return 'Codex would also send the AGENTS.md in your .codex folder';
    case 'invalid': return `${who}’s answer was hard to read`;
    default: return `${who} didn’t answer`;
  }
}

/**
 * Milo's announcement when a design lands and the building goes up.
 * `plot` is a plot state (status, name, blueprint, designedBy). `asked` is who Milo asked to design
 * it ('claude' | 'codex' | 'kit'); when the crew didn't come through and Milo drew it with his own
 * kit, the words say why, kindly (`fallback`: the architect's { by, code }). `skipped`: crew members
 * Automatic mode moved past (not signed in). `placeName` is the plot's name ('Long meadow').
 * `redesign`: a new look for a building that was there; `levels` 'kept' | 'changed' says what
 * happened to its level tree.
 * Returns { title, body, says }: `body` for a desktop note (about Milo), `says` in Milo's own voice.
 */
export function builtText(plot, { asked = null, placeName = '', fallback = null, skipped = [], redesign = false, levels = null } = {}) {
  const data = isRecord(plot) ? plot : {};
  const blueprint = isRecord(data.blueprint) ? data.blueprint : {};
  const raw = [data.name, blueprint.name].find((value) => typeof value === 'string' && value.replace(/\s+/g, ' ').trim());
  const name = raw ? truncate(raw.replace(/\s+/g, ' ').trim(), BUILT_NAME_MAX) : '';
  const by = typeof data.designedBy === 'string' ? data.designedBy : 'kit';
  const where = typeof placeName === 'string' ? placeName.replace(/\s+/g, ' ').trim() : '';
  const title = redesign
    ? (name ? `${withArticle(name)} has its new look` : 'The new look is up')
    : (name ? `${withArticle(name)} is built` : 'A new building is up');
  const passedOver = (Array.isArray(skipped) ? skipped : []).find((id) => CREW.has(id) && id !== by);

  let body;
  let says;
  if (by === 'kit' && (CREW.has(asked) || (isRecord(fallback) && CREW.has(fallback.by)))) {
    body = `${reasonWords(fallback, asked, false)}, so Milo drew this one himself.`;
    says = `${reasonWords(fallback, asked, true)}, so I drew this one myself.`;
  } else if (by === 'claude' || by === 'codex') {
    const plans = redesign ? 'the new plans' : 'the plans';
    body = where && !redesign ? `${designerName(by)} drew up ${plans} for ${truncate(where, 30)}.` : `${designerName(by)} drew up ${plans}.`;
    if (passedOver) body = `${designerName(passedOver)} isn’t signed in, so ${body}`;
    says = body;
  } else {
    body = where && !redesign ? `Milo drew up the plans for ${truncate(where, 30)}.` : `Milo drew up ${redesign ? 'the new plans' : 'the plans'} himself.`;
    says = where && !redesign ? `I drew up the plans for ${truncate(where, 30)}.` : `I drew up ${redesign ? 'the new plans' : 'the plans'} myself.`;
  }
  if (redesign && levels === 'kept') {
    body = `${body} Its level tree stays as it was.`;
    says = `${says} Its level tree stays as it was.`;
  } else if (redesign && levels === 'changed') {
    body = `${body} Its level tree changed too.`;
    says = `${says} Its level tree changed too.`;
  }
  return { title, body, says };
}
