// Phase 5's saved sections (PLAN.md Phase 5). Today: `board`, the quests, projects and pocket
// thoughts that Habitack's notice board becomes. Cleaners here are total (never throw on any input)
// and keep to the limits below, like state4.js; model.js runs them on their own so a throw costs
// only this section.
import { isRecord, safeCopy, clip, cleanCount, toTime, cleanDayKey } from './clean.js';

export const BOARD_LIMITS = Object.freeze({
  quests: 200, projects: 30, thoughts: 50, steps: 30, title: 200, notes: 2000, projectTitle: 120, thoughtText: 1000, stepTitle: 200,
});
export const QUEST_KINDS = Object.freeze(['main', 'side']);
export const QUEST_STATUSES = Object.freeze(['todo', 'doing', 'done', 'let-go']);
/** The life skills a quest can be tagged with (a subset of state4.SKILL_IDS). */
export const QUEST_SKILLS = Object.freeze(['stewardship', 'scholarship', 'scribing', 'illumination', 'artifice', 'cooking', 'gardening', 'construction']);

const ID = /^[a-z]{1,3}-[0-9a-z]{1,12}$/;

export function emptyBoard() {
  return { quests: [], projects: [], thoughts: [], seq: 0, nudgedDay: null };
}

const text = (value, max) => (typeof value === 'string' ? clip(value.replace(/\s+/g, ' ').trim(), max) : '');
const notesOf = (value) => (typeof value === 'string' ? value.slice(0, BOARD_LIMITS.notes) : '');

function uniqueIds(list, prefix, seen) {
  // A missing, malformed or repeated id gets the next free number of its kind.
  let n = 0;
  return list.map((entry) => {
    let id = entry.id;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) {
      do { n += 1; id = `${prefix}-${n.toString(36)}`; } while (seen.has(id));
    }
    seen.add(id);
    return { ...entry, id };
  });
}

function cleanStep(value) {
  if (!isRecord(value)) return null;
  const title = text(value.title, BOARD_LIMITS.stepTitle);
  return title ? { id: typeof value.id === 'string' && ID.test(value.id) ? value.id : '', title, done: value.done === true } : null;
}

function cleanQuest(value, now) {
  if (!isRecord(value)) return null;
  const title = text(value.title, BOARD_LIMITS.title);
  if (!title) return null;
  const status = QUEST_STATUSES.includes(value.status) ? value.status : 'todo';
  const createdAt = toTime(value.createdAt) ?? Math.round(now);
  const steps = (Array.isArray(value.steps) ? value.steps : []).map(cleanStep).filter(Boolean).slice(0, BOARD_LIMITS.steps);
  return {
    ...safeCopy(value),
    id: typeof value.id === 'string' ? value.id : '',
    title,
    kind: QUEST_KINDS.includes(value.kind) ? value.kind : 'side',
    manual: value.manual === true,
    status,
    notes: notesOf(value.notes),
    skill: QUEST_SKILLS.includes(value.skill) ? value.skill : 'stewardship',
    skillManual: value.skillManual === true,
    projectId: typeof value.projectId === 'string' && ID.test(value.projectId) ? value.projectId : null,
    createdAt,
    startedAt: status === 'todo' ? null : toTime(value.startedAt),
    completedAt: status === 'done' ? (toTime(value.completedAt) ?? Math.round(now)) : null,
    touchedAt: toTime(value.touchedAt) ?? createdAt,
    due: toTime(value.due),
    dueManual: value.dueManual === true,
    paid: value.paid === true,
    steps: uniqueIds(steps, 's', new Set()),
  };
}

function cleanProject(value, now) {
  if (!isRecord(value)) return null;
  const title = text(value.title, BOARD_LIMITS.projectTitle);
  if (!title) return null;
  const complete = value.status === 'complete';
  return {
    ...safeCopy(value),
    id: typeof value.id === 'string' ? value.id : '',
    title,
    notes: notesOf(value.notes),
    status: complete ? 'complete' : 'active',
    createdAt: toTime(value.createdAt) ?? Math.round(now),
    completedAt: complete ? (toTime(value.completedAt) ?? Math.round(now)) : null,
  };
}

function cleanThought(value, now) {
  if (!isRecord(value)) return null;
  const body = typeof value.text === 'string' ? value.text.trim().slice(0, BOARD_LIMITS.thoughtText) : '';
  if (!body) return null;
  return { ...safeCopy(value), id: typeof value.id === 'string' ? value.id : '', text: body, createdAt: toTime(value.createdAt) ?? Math.round(now) };
}

// ---------------------------------------------------------------------------
// People (PLAN.md Phase 5.1): how every named person in the Hushlands feels about Chris. One entry
// per person, keyed by their id in content/people/npcs. `points` are approval (never below -2);
// `found` is what Chris has learned of them by trying; `memories` are the moments they keep.

export const PEOPLE_LIMITS = Object.freeze({ people: 200, done: 60, memories: 12, found: 8, points: 400 });
/** What Chris can lead a conversation with. */
export const APPROACHES = Object.freeze(['kind', 'joke', 'favour', 'truth', 'craft']);
const NPC_ID = /^[a-z][a-z0-9-]{1,39}$/;
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;

export function emptyPeople() {
  return {};
}

const slugs = (list, max) => [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && SLUG.test(id)))].slice(-max);
const approaches = (list) => [...new Set((Array.isArray(list) ? list : []).filter((a) => APPROACHES.includes(a)))].slice(0, PEOPLE_LIMITS.found);

function cleanErrand(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !SLUG.test(value.id)) return null;
  const at = toTime(value.at);
  if (!at) return null;
  return { id: value.id, at, steps: (Array.isArray(value.steps) ? value.steps : []).slice(0, 8).map((t) => toTime(t)), done: toTime(value.done) };
}

function cleanPerson(value, now) {
  if (!isRecord(value)) return null;
  const turn = isRecord(value.turn) ? value.turn : {};
  const found = isRecord(value.found) ? value.found : {};
  const memories = [];
  for (const m of Array.isArray(value.memories) ? value.memories : []) {
    if (isRecord(m) && typeof m.id === 'string' && SLUG.test(m.id) && !memories.some((x) => x.id === m.id)) memories.push({ id: m.id, at: toTime(m.at) ?? Math.round(now) });
  }
  const points = Number.isFinite(value.points) ? Math.max(-2, Math.min(PEOPLE_LIMITS.points, Math.round(value.points))) : 0;
  return {
    ...safeCopy(value),
    points,
    met: toTime(value.met),
    seen: toTime(value.seen),
    done: slugs(value.done, PEOPLE_LIMITS.done),
    turn: { day: cleanDayKey(turn.day), n: cleanCount(turn.n, 20), last: APPROACHES.includes(turn.last) ? turn.last : null },
    found: { likes: approaches(found.likes), dislikes: approaches(found.dislikes), resists: approaches(found.resists), gifts: slugs(found.gifts, 16) },
    gift: cleanDayKey(value.gift),
    memories: memories.slice(-PEOPLE_LIMITS.memories),
    camp: toTime(value.camp),
    errand: cleanErrand(value.errand),
  };
}

/** Any input → a valid people map (ids that aren't a person's id are dropped; newest-seen win past the limit). */
export function cleanPeople(value, { now = Date.now() } = {}) {
  const out = {};
  const entries = [];
  if (isRecord(value)) {
    for (const [id, entry] of Object.entries(value)) {
      if (!NPC_ID.test(id)) continue;
      const clean = cleanPerson(entry, now);
      if (clean) entries.push([id, clean]);
    }
  }
  entries.sort((a, b) => (b[1].seen ?? 0) - (a[1].seen ?? 0));
  for (const [id, entry] of entries.slice(0, PEOPLE_LIMITS.people)) out[id] = entry;
  return out;
}

// ---------------------------------------------------------------------------
// Camp life (PLAN.md Phase 5.4): what Milo gathers while you focus, and what has been cooked.

export const GATHER_IDS = Object.freeze(['woodcutting', 'fishing', 'foraging', 'mining']);
export const ITEM_IDS = Object.freeze(['birch', 'ash', 'pine', 'minnow', 'trout', 'berries', 'herbs', 'stone', 'copper']);
export const RECIPE_IDS = Object.freeze(['cordial', 'brew', 'minnow-supper', 'trout-stew']);

export function emptyCamplife() {
  return { gather: null, last: null, cooked: {}, places: {}, outposts: {} };
}

const PLACE_ID = /^(?:poi:hamlet|camp:lantern):-?\d{1,7},-?\d{1,7}$/;
const OUTPOST_ID = /^lantern:-?\d{1,7},-?\d{1,7}$/;
const MAX_OUTPOSTS = 16;
const MAX_PLACES = 200;

/** Any input → a valid camplife section: { gather, last: { session, at, activity, items } | null, cooked, places: { [hamlet id]: { days, last } } }. */
export function cleanCamplife(value) {
  const src = isRecord(value) ? value : {};
  const lastSrc = isRecord(src.last) && GATHER_IDS.includes(src.last.activity) ? src.last : null;
  const items = {};
  if (lastSrc && isRecord(lastSrc.items)) for (const id of ITEM_IDS) { const n = cleanCount(lastSrc.items[id], 99); if (n) items[id] = n; }
  const session = lastSrc ? toTime(lastSrc.session) : null;
  const at = lastSrc ? toTime(lastSrc.at) : null;
  const cooked = {};
  if (isRecord(src.cooked)) for (const id of RECIPE_IDS) { const n = cleanCount(src.cooked[id], 1e6); if (n) cooked[id] = n; }
  // The hamlets Milo has been to (welcome.js): how many different days, and the last one.
  const places = {};
  if (isRecord(src.places)) {
    for (const [id, entry] of Object.entries(src.places).slice(-MAX_PLACES)) {
      const last = isRecord(entry) ? cleanDayKey(entry.last) : null;
      if (PLACE_ID.test(id) && last) places[id] = { days: Math.max(1, cleanCount(entry.days, 99999)), last };
    }
  }
  // The lanterns Chris has claimed as outposts (outposts.js): when.
  const outposts = {};
  if (isRecord(src.outposts)) {
    for (const [id, when] of Object.entries(src.outposts).slice(-MAX_OUTPOSTS)) if (OUTPOST_ID.test(id) && toTime(when)) outposts[id] = toTime(when);
  }
  return { gather: GATHER_IDS.includes(src.gather) ? src.gather : null, last: session && at ? { session, at, activity: lastSrc.activity, items } : null, cooked, places, outposts };
}

/** Any input → a valid board. Newest entries win when a list is over its limit. */
export function cleanBoard(value, { now = Date.now() } = {}) {
  const source = isRecord(value) ? value : {};
  const seen = { q: new Set(), p: new Set(), t: new Set() };
  const keep = (list, clean, max) => (Array.isArray(list) ? list : []).map((entry) => clean(entry, now)).filter(Boolean).slice(-max);
  const projects = uniqueIds(keep(source.projects, cleanProject, BOARD_LIMITS.projects), 'p', seen.p);
  const projectIds = new Set(projects.map((p) => p.id));
  const quests = uniqueIds(keep(source.quests, cleanQuest, BOARD_LIMITS.quests), 'q', seen.q)
    .map((q) => (q.projectId && !projectIds.has(q.projectId) ? { ...q, projectId: null } : q));
  const thoughts = uniqueIds(keep(source.thoughts, cleanThought, BOARD_LIMITS.thoughts), 't', seen.t);
  // `seq` only ever grows, so an id is never reused after its quest is deleted.
  const highest = [...quests, ...projects, ...thoughts].reduce((m, e) => Math.max(m, parseInt(e.id.slice(e.id.indexOf('-') + 1), 36) || 0), 0);
  return { ...safeCopy(source), quests, projects, thoughts, seq: Math.max(cleanCount(source.seq), highest), nudgedDay: cleanDayKey(source.nudgedDay) };
}
