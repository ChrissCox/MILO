// The Board (PLAN.md Phase 5): Habitack's quest model brought home. One-prompt capture sorts a task
// into a main or a side quest by plain rules (Chris can correct it), tags the life skill it
// trains, and finishing it pays Embers and XP once. Every function is pure: it takes a state and
// returns a new one, and never throws on a bad input. Quest titles are Chris's own words and stay
// in `state.board`; the Chronicle and the ledger only ever get generic lines.
import { isRecord, clip, cleanCount, dayKey } from './clean.js';
import { payQuest, QUEST_FULL_PER_DAY } from './embers.js';
import { addXp, ratesOf } from './lifeskills.js';
import { BOARD_LIMITS, QUEST_KINDS, QUEST_SKILLS, QUEST_STATUSES, cleanBoard, emptyBoard } from './state5.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const squash = (value, max) => (typeof value === 'string' ? clip(value.replace(/\s+/g, ' ').trim(), max) : '');

/** Embers a quest pays, and the number a day pays in full before the rest pay a quarter. */
export const QUEST_PAY = Object.freeze({ main: 3, side: 2, fullPerDay: QUEST_FULL_PER_DAY });
/** XP a quest pays when content/xp.json has no `quest-main` / `quest-side` row. */
export const QUEST_XP = Object.freeze({ main: 300, side: 150 });

export const boardOf = (state) => (isRecord(state) && isRecord(state.board) ? state.board : emptyBoard());
const withBoard = (state, board) => ({ ...state, board });
const questOf = (state, id) => boardOf(state).quests.find((q) => q.id === id) || null;
const nextId = (board, prefix) => {
  const seq = cleanCount(board.seq) + 1;
  return { id: `${prefix}-${seq.toString(36)}`, seq };
};

// ---------------------------------------------------------------------------
// Sorting a task: the rules are Habitack's, so the board agrees with the one Chris already used.

/** { kind: 'main' | 'side', reason } from the words alone. */
export function classifyQuest(text) {
  const title = squash(text, 400).toLowerCase().replace(/[’‘]/g, "'");
  const priorityText = title.replace(/\b(?:no\s+(?:rush|hurry|deadline)|not\s+(?:urgent|important)|low\s+priority)\b/g, '');
  if (/\b(?:today|tonight|tomorrow|urgent|urgently|asap|deadline|due|important|high\s+priority|time[- ]sensitive)\b|\bby\s+(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekend|month|morning|noon|evening|\d)/.test(priorityText)) {
    return { kind: 'main', reason: 'Time-sensitive' };
  }
  const familyGift = /\b(?:birthday|anniversary|wedding|christmas|holiday|mother's\s+day|father's\s+day)\b.{0,45}\b(?:gifts?|presents?)\b|\b(?:gifts?|presents?)\b.{0,45}\b(?:mom|mum|mother|dad|father|parents?|sister|brother|wife|husband|partner|grandma|grandpa|family|birthday|anniversary|wedding)\b/.test(title);
  if (familyGift) return { kind: 'main', reason: 'Someone you care about' };
  // A creative subject such as a painting of a doctor is not itself an obligation.
  const creative = /^(?:finish|start|continue|work\s+on|practice|make)\b.*\b(?:drawing|painting|sketch|sculpture|story|novel|song|craft|decorations?)\b|^(?:draw|paint|sketch|sculpt|decorate)\b/.test(title);
  const essential = /\b(?:groceries|grocery\s+(?:shopping|order|run)|rent|bills?|utilities|taxes|tax\s+return|medication|medicines?|prescriptions?|doctor|dentist|appointments?)\b|\b(?:buy|order|get|prepare|cook|make|pick\s+up)\b.{0,25}\b(?:food|breakfast|lunch|dinner|meals?)\b|\bmeal\s+prep\b/.test(title);
  if (essential && !creative) return { kind: 'main', reason: 'An everyday essential' };
  return { kind: 'side', reason: 'Optional' };
}

const SKILL_RULES = Object.freeze([
  ['cooking', /\b(?:cook|bake|meal\s+prep|recipe|dinner|lunch|breakfast|groceries)\b/],
  ['gardening', /\b(?:garden|plant|weed|water\s+the|mow|lawn|compost|seeds?)\b/],
  ['illumination', /\b(?:draw|paint|sketch|doodle|illustrat\w*|colou?r|canvas|drawing|painting|craft|sew|knit|decorations?)\b/],
  ['scribing', /\b(?:write|draft|essay|journal|letter|blog|email|report|notes?)\b/],
  ['scholarship', /\b(?:study|learn|read|homework|exam|class|course|research|lecture|assignment|quiz)\b/],
  ['artifice', /\b(?:code|build|design|app|program|debug|deploy|prototype|website)\b/],
  ['construction', /\b(?:fix|repair|assemble|install|move\s+furniture|renovate|paint\s+the\s+(?:wall|room|fence))\b/],
]);

/** The life skill a task trains, by its words; Stewardship (running a life) when none fit. */
export function skillFor(text) {
  const title = squash(text, 400).toLowerCase().replace(/[’‘]/g, "'");
  for (const [skill, rule] of SKILL_RULES) if (rule.test(title)) return skill;
  return 'stewardship';
}

// ---------------------------------------------------------------------------
// Due dates: read from the words ("by Friday", "tomorrow", "10/12", "Oct 12"), and Chris can set them.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The end of the local day a task's words give, or null. A weekday only counts after by, on, before, until, this, next or due. */
export function dueFrom(text, now) {
  if (!finite(now)) return null;
  const title = squash(text, 400).toLowerCase().replace(/[’‘]/g, "'");
  if (/\b(?:no\s+(?:rush|hurry|deadline)|not\s+urgent)\b/.test(title)) return null;
  const today = new Date(now);
  const plus = (days) => endOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  if (/\b(?:today|tonight)\b/.test(title)) return plus(0);
  if (/\btomorrow\b/.test(title)) return plus(1);
  const weekday = /\b(by|on|before|until|this|next|due)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(title);
  if (weekday) {
    const ahead = (WEEKDAYS.indexOf(weekday[2]) - today.getDay() + 7) % 7;
    return plus(ahead + (weekday[1] === 'next' && ahead < 7 ? 7 : 0));
  }
  const when = (month, day) => {
    if (!(month >= 0 && month <= 11 && day >= 1 && day <= 31)) return null;
    let d = new Date(today.getFullYear(), month, day);
    if (d.getMonth() !== month) return null;
    if (endOfDay(d) < now - 30 * DAY) d = new Date(today.getFullYear() + 1, month, day);
    return endOfDay(d);
  };
  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(title);
  if (slash) return when(Number(slash[1]) - 1, Number(slash[2]));
  const named = new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(title);
  if (named) return when(MONTHS.indexOf(named[1]), Number(named[2]));
  return null;
}

/** 'Due today' / 'Due tomorrow' / 'Due Friday' / 'Due Oct 12' / 'Overdue', or ''. */
export function dueWords(due, now) {
  if (!finite(due) || !finite(now)) return '';
  const n = new Date(now);
  const startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const dueDay = new Date(due);
  const days = Math.round((new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate()).getTime() - startToday) / DAY);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  const d = new Date(due);
  if (days < 7) return `Due ${cap(WEEKDAYS[d.getDay()])}`;
  return `Due ${cap(MONTHS[d.getMonth()])} ${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Quests

/** "Garden: buy soil" files "buy soil" under an active project called Garden. → { title, projectId } or null. */
export function routeToProject(state, text) {
  const match = /^([^:\n]{1,120}):\s*(\S[\s\S]*)$/.exec(squash(text, BOARD_LIMITS.title + 130));
  if (!match) return null;
  const name = match[1].trim().toLowerCase();
  const project = boardOf(state).projects.find((p) => p.status === 'active' && p.title.toLowerCase() === name);
  return project ? { title: match[2].trim(), projectId: project.id } : null;
}

/** One-prompt capture. → { state, quest } (the same state and no quest when the words are empty or the board is full). */
export function addQuest(state, input, now) {
  const none = { state, quest: null };
  if (!isRecord(state) || !finite(now)) return none;
  const board = boardOf(state);
  if (board.quests.length >= BOARD_LIMITS.quests) return none;
  let title = squash(isRecord(input) ? input.title : input, BOARD_LIMITS.title);
  if (!title) return none;
  let projectId = isRecord(input) && board.projects.some((p) => p.id === input.projectId && p.status === 'active') ? input.projectId : null;
  if (!projectId) ({ title, projectId } = routeToProject(state, title) || { title, projectId: null });
  const { kind } = classifyQuest(title);
  const { id, seq } = nextId(board, 'q');
  const quest = {
    id, title, kind, manual: false, status: 'todo', notes: '', skill: skillFor(title), skillManual: false, projectId,
    createdAt: Math.round(now), startedAt: null, completedAt: null, touchedAt: Math.round(now), due: dueFrom(title, now), dueManual: false, paid: false, steps: [],
  };
  return { state: withBoard(state, { ...board, quests: [...board.quests, quest], seq }), quest };
}

const replace = (state, quest) => withBoard(state, { ...boardOf(state), quests: boardOf(state).quests.map((q) => (q.id === quest.id ? quest : q)) });

/**
 * Edits a quest. `title` re-sorts it unless Chris chose its priority himself; `kind` and `skill`
 * are Chris's corrections and stick. → the new state, or the same one when nothing changed.
 */
export function updateQuest(state, id, patch, now = null) {
  const quest = questOf(state, id);
  if (!quest || !isRecord(patch)) return state;
  let q = quest;
  const title = squash(patch.title, BOARD_LIMITS.title);
  if (title && title !== q.title) {
    q = { ...q, title, ...(q.manual ? {} : { kind: classifyQuest(title).kind }), ...(q.skillManual ? {} : { skill: skillFor(title) }), ...(q.dueManual || !finite(now) ? {} : { due: dueFrom(title, now) }) };
  }
  if (QUEST_KINDS.includes(patch.kind) && (patch.kind !== q.kind || !q.manual)) q = { ...q, kind: patch.kind, manual: true };
  if (QUEST_SKILLS.includes(patch.skill) && (patch.skill !== q.skill || !q.skillManual)) q = { ...q, skill: patch.skill, skillManual: true };
  if ('due' in patch && (patch.due === null || finite(patch.due))) {
    const due = patch.due === null ? null : Math.round(patch.due);
    if (due !== q.due || !q.dueManual) q = { ...q, due, dueManual: true };
  }
  if (typeof patch.notes === 'string' && patch.notes !== q.notes) q = { ...q, notes: patch.notes.slice(0, BOARD_LIMITS.notes) };
  if ('projectId' in patch) {
    const wanted = patch.projectId && boardOf(state).projects.some((p) => p.id === patch.projectId && p.status === 'active') ? patch.projectId : null;
    if (wanted !== q.projectId && (wanted || !patch.projectId)) q = { ...q, projectId: wanted };
  }
  return q === quest ? state : replace(state, q);
}

/** Moves a quest between To do, Doing and Done. Done never pays here (see finishQuest). */
export function setStatus(state, id, status, now) {
  const quest = questOf(state, id);
  if (!quest || !QUEST_STATUSES.includes(status) || quest.status === status || !finite(now)) return state;
  const t = Math.round(now);
  return replace(state, {
    ...quest, status,
    startedAt: status === 'todo' || status === 'let-go' ? null : quest.startedAt ?? t,
    completedAt: status === 'done' ? t : null,
    touchedAt: t,
  });
}

/** Letting a quest go is gentle: it leaves the board without a mark, and can come back. */
export const letGo = (state, id, now) => setStatus(state, id, 'let-go', now);
export const bringBack = (state, id, now) => setStatus(state, id, 'todo', now);

/** "Keep it": a quest that has waited a while is wanted after all, so its clock starts again. */
export function keepQuest(state, id, now) {
  const quest = questOf(state, id);
  if (!quest || !finite(now) || quest.status === 'done' || quest.status === 'let-go') return state;
  return replace(state, { ...quest, touchedAt: Math.round(now) });
}

// ---------------------------------------------------------------------------
// Gentle nudges: what has waited a while, and when too much is in progress at once

export const NUDGE = Object.freeze({ todoDays: 14, doingDays: 7, crowded: 5 });
const DAY = 24 * 60 * 60 * 1000;

/** Open quests nobody has touched for a while: To do after 14 days, Doing after 7. Oldest first. */
export function staleQuests(state, now) {
  if (!finite(now)) return [];
  return boardOf(state).quests
    .filter((q) => (q.status === 'todo' && now - Math.max(q.touchedAt, q.createdAt) >= NUDGE.todoDays * DAY)
      || (q.status === 'doing' && now - Math.max(q.touchedAt, q.startedAt ?? 0) >= NUDGE.doingDays * DAY))
    .sort((a, b) => a.touchedAt - b.touchedAt);
}

/** { stale: ids, crowded: boolean (more than 5 in progress) }. */
export function nudgeView(state, now) {
  const board = boardOf(state);
  return { stale: staleQuests(state, now).map((q) => q.id), crowded: board.quests.filter((q) => q.status === 'doing').length > NUDGE.crowded };
}

// ---------------------------------------------------------------------------
// What the task rifts rest on (src/rifts.js taskSignals): four plain facts about the board.

const VAGUE_RULE = /\b(?:stuff|things|everything|somehow|whatever|sort\s+(?:it|this|that|things|stuff|out|myself)|figure\s+(?:it|this|that|things|stuff)\s+out|deal\s+with\s+(?:it|this|that|things|stuff)|get\s+(?:my\s+life\s+)?(?:organi[sz]ed|sorted)|fix\s+(?:my\s+)?life|work\s+on\s+(?:it|this|stuff|things|myself))\b/;
/** A quest too vague to start: nothing broken down, nothing noted, and words like "sort stuff out". */
export function isVague(q) {
  if (!isRecord(q) || q.status !== 'todo' || q.steps.length || (typeof q.notes === 'string' && q.notes.trim())) return false;
  const title = squash(q.title, BOARD_LIMITS.title).toLowerCase();
  return VAGUE_RULE.test(title) || /^(?:life|stuff|things|everything|admin|errands)$/.test(title);
}

export const TASK_RIFTS = Object.freeze({ crowdedHours: 24, vagueDays: 3, dueDays: 2, settleHours: 24 });

/**
 * { stale: quests waiting a while, crowded: quests that have been in progress for a day, when more
 * than five have, vague: quests three days old and too vague to start, due: quests due within two
 * days or overdue that have been on the board for a day }. Oldest first.
 */
export function taskFacts(state, now) {
  const none = { stale: [], crowded: [], vague: [], due: [] };
  if (!finite(now)) return none;
  const quests = boardOf(state).quests;
  const longDoing = quests.filter((q) => q.status === 'doing' && now - (q.startedAt ?? q.touchedAt) >= TASK_RIFTS.crowdedHours * 3600000);
  return {
    stale: staleQuests(state, now),
    crowded: longDoing.length > NUDGE.crowded ? longDoing.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)) : [],
    vague: quests.filter((q) => isVague(q) && now - q.createdAt >= TASK_RIFTS.vagueDays * DAY).sort((a, b) => a.createdAt - b.createdAt),
    due: quests
      .filter((q) => (q.status === 'todo' || q.status === 'doing') && finite(q.due) && q.due - now <= TASK_RIFTS.dueDays * DAY && now - q.createdAt >= TASK_RIFTS.settleHours * 3600000)
      .sort((a, b) => a.due - b.due),
  };
}

/** Whether Milo should say something today: something is stale, and he hasn't said so today. */
export function shouldNudge(state, now) {
  return finite(now) && boardOf(state).nudgedDay !== dayKey(now) && staleQuests(state, now).length > 0;
}

export function markNudged(state, now) {
  if (!finite(now)) return state;
  const board = boardOf(state);
  return board.nudgedDay === dayKey(now) ? state : withBoard(state, { ...board, nudgedDay: dayKey(now) });
}

export function deleteQuest(state, id) {
  const board = boardOf(state);
  if (!board.quests.some((q) => q.id === id)) return state;
  return withBoard(state, { ...board, quests: board.quests.filter((q) => q.id !== id) });
}

/**
 * Finishes a quest and pays it once: Embers (3 for a main, 2 for a side; past 12 a day, a quarter
 * of that), and XP in the life skill it trains. Reopening a finished quest and finishing it again
 * pays nothing more. → { state, paid: null | { embers, xp, skill } }
 */
export function finishQuest(state, id, now, { economy = null, rates = null } = {}) {
  const quest = questOf(state, id);
  if (!quest || !finite(now)) return { state, paid: null };
  let next = quest.status === 'done' ? state : setStatus(state, id, 'done', now);
  if (quest.paid) return { state: next, paid: null };
  const q = questOf(next, id);
  let embers = 0;
  const got = payQuest(next, { kind: q.kind, key: `quest:${Math.round(now)}` }, now, economy);
  if (got.entry) { next = got.state; embers = got.entry.n; }
  const rate = ratesOf(rates)[`quest-${q.kind}`];
  const xp = rate ? rate.xp : QUEST_XP[q.kind];
  const gained = addXp(next, q.skill, xp, now, { source: 'quest', text: q.kind === 'main' ? 'A main quest finished' : 'A side quest finished' });
  next = gained.state;
  next = replace(next, { ...questOf(next, id), paid: true });
  return { state: next, paid: { embers, xp: gained.drop ? gained.drop.amount : 0, skill: q.skill } };
}

// ---------------------------------------------------------------------------
// Steps, projects and pocket thoughts

const stepChange = (state, id, change) => {
  const quest = questOf(state, id);
  if (!quest) return state;
  const steps = change(quest.steps);
  return steps ? replace(state, { ...quest, steps }) : state;
};

export function addStep(state, id, title) {
  const t = squash(title, BOARD_LIMITS.stepTitle);
  if (!t) return state;
  const quest = questOf(state, id);
  if (!quest || quest.steps.length >= BOARD_LIMITS.steps) return state;
  const used = quest.steps.reduce((m, s) => Math.max(m, parseInt(s.id.slice(2), 36) || 0), 0);
  return stepChange(state, id, (steps) => [...steps, { id: `s-${(used + 1).toString(36)}`, title: t, done: false }]);
}

/** A checklist only: ticking a step never changes the quest's status or pays anything. */
export function toggleStep(state, id, stepId) {
  return stepChange(state, id, (steps) => (steps.some((s) => s.id === stepId) ? steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) : null));
}

export function removeStep(state, id, stepId) {
  return stepChange(state, id, (steps) => (steps.some((s) => s.id === stepId) ? steps.filter((s) => s.id !== stepId) : null));
}

export function addProject(state, title, now) {
  const t = squash(title, BOARD_LIMITS.projectTitle);
  const board = boardOf(state);
  if (!t || !finite(now) || board.projects.length >= BOARD_LIMITS.projects) return state;
  const { id, seq } = nextId(board, 'p');
  const project = { id, title: t, notes: '', status: 'active', createdAt: Math.round(now), completedAt: null };
  return withBoard(state, { ...board, projects: [...board.projects, project], seq });
}

export function projectProgress(state, projectId) {
  const quests = boardOf(state).quests.filter((q) => q.projectId === projectId);
  const done = quests.filter((q) => q.status === 'done').length;
  return { total: quests.length, done, ready: quests.length > 0 && done === quests.length };
}

/** Only an active project whose quests are all done can be finished. */
export function completeProject(state, projectId, now) {
  const board = boardOf(state);
  const project = board.projects.find((p) => p.id === projectId);
  if (!project || project.status !== 'active' || !projectProgress(state, projectId).ready || !finite(now)) return state;
  return withBoard(state, { ...board, projects: board.projects.map((p) => (p.id === projectId ? { ...p, status: 'complete', completedAt: Math.round(now) } : p)) });
}

/** Removing a project keeps its quests on the board. */
export function deleteProject(state, projectId) {
  const board = boardOf(state);
  if (!board.projects.some((p) => p.id === projectId)) return state;
  return withBoard(state, {
    ...board, projects: board.projects.filter((p) => p.id !== projectId),
    quests: board.quests.map((q) => (q.projectId === projectId ? { ...q, projectId: null } : q)),
  });
}

export function addThought(state, text, now) {
  const body = typeof text === 'string' ? text.trim().slice(0, BOARD_LIMITS.thoughtText) : '';
  const board = boardOf(state);
  if (!body || !finite(now) || board.thoughts.length >= BOARD_LIMITS.thoughts) return state;
  const { id, seq } = nextId(board, 't');
  return withBoard(state, { ...board, thoughts: [...board.thoughts, { id, text: body, createdAt: Math.round(now) }], seq });
}

export function removeThought(state, id) {
  const board = boardOf(state);
  if (!board.thoughts.some((t) => t.id === id)) return state;
  return withBoard(state, { ...board, thoughts: board.thoughts.filter((t) => t.id !== id) });
}

/** A thought's first line becomes a quest, with the whole thought as its notes. */
export function thoughtToQuest(state, id, now) {
  const thought = boardOf(state).thoughts.find((t) => t.id === id);
  if (!thought) return { state, quest: null };
  const first = thought.text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const added = addQuest(state, first, now);
  if (!added.quest) return { state, quest: null };
  const withNotes = updateQuest(added.state, added.quest.id, { notes: thought.text });
  return { state: removeThought(withNotes, id), quest: questOf(withNotes, added.quest.id) };
}

// ---------------------------------------------------------------------------
// The board as the panel reads it

const byOrder = (a, b) => (a.kind === b.kind ? a.createdAt - b.createdAt : a.kind === 'main' ? -1 : 1);

/**
 * { doing, todo, done (the newest ten), doneCount, projects: [{ id, title, status, done, total, ready }],
 *   thoughts, counts: { open } }. Quests carry `projectTitle` and `stepsDone`.
 */
export function boardView(state) {
  const board = boardOf(state);
  const titleOf = new Map(board.projects.map((p) => [p.id, p.title]));
  const view = (q) => ({ ...q, projectTitle: q.projectId ? titleOf.get(q.projectId) || '' : '', stepsDone: q.steps.filter((s) => s.done).length });
  const of = (status) => board.quests.filter((q) => q.status === status);
  const done = of('done').sort((a, b) => b.completedAt - a.completedAt);
  const gone = of('let-go').sort((a, b) => b.touchedAt - a.touchedAt);
  return {
    letGo: gone.slice(0, 10).map(view),
    letGoCount: gone.length,
    doing: of('doing').sort(byOrder).map(view),
    todo: of('todo').sort(byOrder).map(view),
    done: done.slice(0, 10).map(view),
    doneCount: done.length,
    projects: board.projects.map((p) => ({ ...p, ...projectProgress(state, p.id) })),
    thoughts: board.thoughts,
    counts: { open: board.quests.length - done.length - gone.length },
  };
}

export { cleanBoard, emptyBoard };
export { QUEST_SKILLS } from './state5.js';
