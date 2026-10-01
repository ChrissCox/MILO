// Phase 5's saved sections (PLAN.md Phase 5). Today: `board`, the quests, projects and pocket
// thoughts that Habitack's notice board becomes. Cleaners here are total (never throw on any input)
// and keep to the limits below, like state4.js; model.js runs them on their own so a throw costs
// only this section.
import { isRecord, safeCopy, clip, cleanCount, toTime } from './clean.js';

export const BOARD_LIMITS = Object.freeze({
  quests: 200, projects: 30, thoughts: 50, steps: 30, title: 200, notes: 2000, projectTitle: 120, thoughtText: 1000, stepTitle: 200,
});
export const QUEST_KINDS = Object.freeze(['main', 'side']);
export const QUEST_STATUSES = Object.freeze(['todo', 'doing', 'done']);
/** The life skills a quest can be tagged with (a subset of state4.SKILL_IDS). */
export const QUEST_SKILLS = Object.freeze(['stewardship', 'scholarship', 'scribing', 'illumination', 'artifice', 'cooking', 'gardening', 'construction']);

const ID = /^[a-z]{1,3}-[0-9a-z]{1,12}$/;

export function emptyBoard() {
  return { quests: [], projects: [], thoughts: [], seq: 0 };
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
  return { ...safeCopy(source), quests, projects, thoughts, seq: Math.max(cleanCount(source.seq), highest) };
}
