// The Prologue, "The Lantern Wakes" (CONTRACT-PHASE3 §6). Its words live in content/story.json;
// when each step is done lives here, keyed by step id, and reads only real state. Steps complete
// in order, and a step whose condition is already true completes on sight, so Chris is never
// asked to redo what he has done. Pure ESM with no DOM and no fs.
import { toTime, clip } from './model.js';

export const PROLOGUE_STEP_IDS = Object.freeze(['light', 'crew', 'ground', 'letter', 'first-crack', 'lantern', 'stockade']);
export const STORY_RIFT_KEY = 'story:first-crack';

// Used only when content/story.json can't be read, so the tracker still says something true.
const FALLBACK = Object.freeze({
  title: 'The Lantern Wakes',
  steps: Object.freeze({
    light: { title: 'A Light on the Hook', text: 'Milo lit the lantern on its hook, and the vale woke up around it.', hint: 'Open MILO and let Milo say hello.' },
    crew: { title: 'Three Stumps and a Bench', text: 'Three stumps and a bench round the fire, kept for the crew.', hint: 'Start a session with Claude or Codex, and Milo will see it.' },
    ground: { title: 'Ground That’s Waiting', text: 'The plots by the path are waiting for something of yours.', hint: 'Open a plot and build one of the ideas, or your own.' },
    letter: { title: 'A Letter by Paper Bird', text: 'A paper bird came down by the fire with a letter from Oriel.', hint: 'Read Oriel’s letter.' },
    'first-crack': { title: 'A Crack Past the Gate', text: 'Something from another story is pressing on the page, just past the north gate.', hint: 'Walk out of the north gate, step through the crack and mend it.' },
    lantern: { title: 'A Light in the Wilds', text: 'Old lanterns sleep along the roads, waiting for someone to wake them.', hint: 'Find a sleeping lantern in the wilds and light it.' },
    stockade: { title: 'Walls of Birch and Ash', text: 'A palisade of birch and ash would keep the vale’s edge.', hint: 'Gather birch and ash, then raise the Stockade at the Hearth.' },
  }),
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** True once the story rift past the north gate has been mended (or it closed after its step was done). */
export function storyRiftClosed(state) {
  const s = isRecord(state) ? state : {};
  const history = Array.isArray(s.rifts?.history) ? s.rifts.history : [];
  return history.some((entry) => isRecord(entry) && entry.key === STORY_RIFT_KEY && (entry.how === 'stitched' || entry.how === 'sealed'));
}

// When each step is done, from real state only. Never from content.
const CONDITIONS = Object.freeze({
  light: (s) => toTime(s.lastSeenAt) !== null,
  crew: (s, { hasSessions }) => hasSessions === true
    || count(s.tally?.sessionsFinished) > 0
    || (Array.isArray(s.tally?.finishedIds) && s.tally.finishedIds.length > 0),
  ground: (s) => count(s.tally?.buildingsDesigned) >= 1,
  letter: (s) => toTime(s.story?.letterReadAt) !== null,
  'first-crack': (s) => storyRiftClosed(s),
  lantern: (s) => isRecord(s.wilds?.lanterns) && Object.values(s.wilds.lanterns).some((at) => toTime(at) !== null),
  stockade: (s) => count(s.hearth?.tier) >= 2,
});

function contentSteps(story) {
  const steps = isRecord(story) && isRecord(story.prologue) && Array.isArray(story.prologue.steps) ? story.prologue.steps : [];
  const byId = new Map();
  for (const step of steps) if (isRecord(step) && typeof step.id === 'string' && !byId.has(step.id)) byId.set(step.id, step);
  return byId;
}

function words(step, fallback) {
  const title = clip(step?.title, 60) || fallback.title;
  const text = clip(step?.text, 400) || fallback.text;
  const hint = clip(step?.hint, 90) || fallback.hint;
  return { title, text, hint };
}

function recordedDone(state) {
  const done = state.story?.prologue?.done;
  return isRecord(done) ? done : {};
}

/**
 * Where the Prologue stands.
 * → { id: 'prologue', title, steps: [{ id, title, text, hint, done, current, at }], current: stepId | null, complete }
 * A step is done when every step before it is done and it was marked done or its condition holds.
 * `at` is when it was marked done, or null when it completed on sight and isn't saved yet.
 * `hasSessions`: the watcher sees at least one crew session. Never throws.
 */
export function prologueStatus(state, story = null, { hasSessions = false } = {}) {
  const s = isRecord(state) ? state : {};
  const byId = contentSteps(story);
  const done = recordedDone(s);
  let current = null;
  const steps = PROLOGUE_STEP_IDS.map((id) => {
    const at = toTime(done[id]);
    let met = false;
    if (current === null) {
      try {
        met = at !== null || CONDITIONS[id](s, { hasSessions }) === true;
      } catch {
        met = at !== null;
      }
    }
    const step = { id, ...words(byId.get(id), FALLBACK.steps[id]), done: met, current: false, at: met ? at : null };
    if (!met && current === null) {
      current = id;
      step.current = true;
    }
    return step;
  });
  const title = clip(isRecord(story) && isRecord(story.prologue) ? story.prologue.title : '', 60) || FALLBACK.title;
  return { id: 'prologue', title, steps, current, complete: current === null };
}

/**
 * Marks a Prologue step done at `now` (the first time only) and returns a new state. Marking
 * `letter` also records that Oriel's letter was read. Unknown step ids change nothing.
 */
export function markStory(state, stepId, now = Date.now()) {
  if (!isRecord(state) || !PROLOGUE_STEP_IDS.includes(stepId)) return state;
  const at = toTime(now) ?? Date.now();
  const story = isRecord(state.story) ? state.story : {};
  const prologue = isRecord(story.prologue) ? story.prologue : {};
  const done = isRecord(prologue.done) ? prologue.done : {};
  const readLetterNow = stepId === 'letter' && toTime(story.letterReadAt) === null;
  if (toTime(done[stepId]) !== null && !readLetterNow) return state;
  return {
    ...state,
    story: {
      ...story,
      prologue: { ...prologue, done: toTime(done[stepId]) !== null ? done : { ...done, [stepId]: at } },
      letterReadAt: readLetterNow ? at : (story.letterReadAt ?? null),
    },
  };
}

/** Chris read Oriel's letter. */
export function readLetter(state, now = Date.now()) {
  return markStory(state, 'letter', now);
}

/**
 * Saves every step that completed on sight, so it stays done even if what proved it changes
 * (the watcher briefly seeing no sessions, say). → { state, completed: stepId[] } in order;
 * `completed` names the steps newly saved, for the shell's quiet story bubble.
 */
export function settleStory(state, story = null, { hasSessions = false } = {}, now = Date.now()) {
  if (!isRecord(state)) return { state, completed: [] };
  const status = prologueStatus(state, story, { hasSessions });
  let next = state;
  const completed = [];
  for (const step of status.steps) {
    if (!step.done || step.at !== null) continue;
    next = markStory(next, step.id, now);
    completed.push(step.id);
  }
  return { state: next, completed };
}

/** Hides or shows the story tracker card. */
export function setTrackerHidden(state, hidden) {
  if (!isRecord(state)) return state;
  const story = isRecord(state.story) ? state.story : {};
  if ((story.trackerHidden === true) === Boolean(hidden)) return state;
  return { ...state, story: { ...story, trackerHidden: Boolean(hidden) } };
}
