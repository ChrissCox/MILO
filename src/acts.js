// Act I: Hearthvale Rekindled (LORE.md §14; PLAN.md Phase 5.5). The story after the Prologue, told in
// chapters that complete on real things MILO can see. Unlike the Prologue's steps, chapters complete
// in any order; the one shown as "now" is the first not yet done. Pure: `now` comes in, and a
// chapter once marked stays done whatever changes later. The words are content/story.json's `act1`.
import { isRecord, toTime, clip } from './clean.js';

export const ACT1_CHAPTER_IDS = Object.freeze(['first-rift', 'laser-awl', 'invitation', 'nans-seeds', 'tollkeeper']);
/** Quests finished for the Blossomfield chapter. */
export const SEEDS_QUESTS = 5;

const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

const CONDITIONS = Object.freeze({
  // A real rift sealed because the real thing behind it was mended.
  'first-rift': (s) => count(s.rifts?.stitched?.real) >= 1,
  // Mags Quire has been met.
  'laser-awl': (s) => toTime(s.people?.mags?.met) !== null,
  // Somebody lives at the camp: a person who came, or a stray who stayed.
  invitation: (s) => Object.values(isRecord(s.people) ? s.people : {}).some((p) => isRecord(p) && toTime(p.camp) !== null)
    || (Array.isArray(s.party?.regulars) && s.party.regulars.length > 0),
  // Five flowers in the Blossomfield.
  'nans-seeds': (s) => (Array.isArray(s.board?.quests) ? s.board.quests : []).filter((q) => isRecord(q) && q.status === 'done').length >= SEEDS_QUESTS,
  // The Tollkeeper walks with the Company.
  tollkeeper: (s) => isRecord(s.party?.roster) && Object.hasOwn(s.party.roster, 'tollkeeper'),
});

const FALLBACK = Object.freeze({
  title: 'Act I: Hearthvale Rekindled',
  chapters: Object.freeze({
    'first-rift': { title: 'The First Rift', text: '', hint: '' },
    'laser-awl': { title: 'A Laser-Awl by Paper Bird', text: '', hint: '' },
    invitation: { title: 'An Invitation to Stay', text: '', hint: '' },
    'nans-seeds': { title: 'Nan’s Seeds', text: '', hint: '' },
    tollkeeper: { title: 'The Tollkeeper’s Riddles', text: '', hint: '' },
  }),
});

const doneOf = (state) => (isRecord(state?.story?.act1?.done) ? state.story.act1.done : {});

/** Act I opens once the Prologue's crack past the gate is mended. */
export function actOpen(state) {
  return toTime(state?.story?.prologue?.done?.['first-crack']) !== null;
}

/** Whether a chapter is recorded as done (people.js asks, for who has arrived). */
export const chapterDone = (state, id) => toTime(doneOf(state)[id]) !== null;

/**
 * Where Act I stands. → { id: 'act1', title, open, chapters: [{ id, title, text, hint, done, current, at }],
 * current: chapterId | null, complete }. `at` is when a chapter was marked, or null when it's done on
 * sight and not saved yet. Never throws.
 */
export function actStatus(state, story = null) {
  const s = isRecord(state) ? state : {};
  const act = isRecord(story) && isRecord(story.act1) ? story.act1 : {};
  const byId = new Map((Array.isArray(act.chapters) ? act.chapters : []).filter(isRecord).map((c) => [c.id, c]));
  const done = doneOf(s);
  const open = actOpen(s);
  let current = null;
  const chapters = ACT1_CHAPTER_IDS.map((id) => {
    const at = toTime(done[id]);
    let met = at !== null;
    if (!met && open) {
      try { met = CONDITIONS[id](s) === true; } catch { met = false; }
    }
    const words = byId.get(id) || {};
    const fall = FALLBACK.chapters[id];
    const chapter = { id, title: clip(words.title, 60) || fall.title, text: clip(words.text, 300) || fall.text, hint: clip(words.hint, 160) || fall.hint, done: met, current: false, at: met ? at : null };
    if (!met && current === null) { current = id; chapter.current = true; }
    return chapter;
  });
  return { id: 'act1', title: clip(act.title, 60) || FALLBACK.title, open, chapters, current: open ? current : null, complete: current === null };
}

/** Saves every chapter that completed on sight. → { state, completed: chapterId[] } (the same state when there are none). */
export function settleAct(state, story = null, now = Date.now()) {
  if (!isRecord(state) || !actOpen(state)) return { state, completed: [] };
  const at = toTime(now);
  if (at === null) return { state, completed: [] };
  const fresh = actStatus(state, story).chapters.filter((c) => c.done && c.at === null).map((c) => c.id);
  if (!fresh.length) return { state, completed: [] };
  const storyOf = isRecord(state.story) ? state.story : {};
  const act1 = isRecord(storyOf.act1) ? storyOf.act1 : {};
  const done = { ...doneOf(state) };
  for (const id of fresh) done[id] = at;
  return { state: { ...state, story: { ...storyOf, act1: { ...act1, done } } }, completed: fresh };
}
