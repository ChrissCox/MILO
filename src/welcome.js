// A settlement's welcome (PLAN.md Phase 5b; LORE.md §9.0): how a hamlet takes to Chris. It follows
// what he does there. Fell one of its trees and its folk are cool about it for as long as the
// stump stands (the rest of that day): they frown, they say so, and the stall is shut. Come back on
// three different days and they know him. Nobody is ever hostile.
//
// Pure. The saved side is `state.camplife.places[poiId] = { days, last }`: how many different days
// Milo has been there, and the last one.
import { isRecord, dayKey, dayNumber, cleanCount } from './clean.js';
import { cleanCamplife } from './state5.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
// A hamlet of the world, or a camp beside a lantern (camps.js).
const HAMLET_ID = /^(?:poi:hamlet|camp:lantern):-?\d{1,7},-?\d{1,7}$/;

/** A felled tree this near a hamlet is one of its trees. */
export const NEAR_TREES = 10;
/** Days visited before a hamlet knows you. */
export const WARM_VISITS = 3;
/** Standing this near a hamlet's own tile counts as being there. */
export const VISIT_REACH = 5;

const placesOf = (state) => (isRecord(state?.camplife) && isRecord(state.camplife.places) ? state.camplife.places : {});

/** How many different days Milo has been to a place. */
export function visitsTo(state, id) {
  const entry = placesOf(state)[id];
  return isRecord(entry) ? cleanCount(entry.days) : 0;
}

/** Milo is at a hamlet: counted once a day. → the new state, or the same one. */
export function visitPlace(state, id, now) {
  if (!isRecord(state) || typeof id !== 'string' || !HAMLET_ID.test(id) || !finite(now)) return state;
  const today = dayKey(now);
  const entry = placesOf(state)[id];
  if (isRecord(entry) && entry.last === today) return state;
  const camplife = cleanCamplife(state.camplife);
  return { ...state, camplife: { ...camplife, places: { ...camplife.places, [id]: { days: (isRecord(entry) ? cleanCount(entry.days) : 0) + 1, last: today } } } };
}

/** Whether one of a hamlet's trees was felled today (its stump is still standing). */
export function felledNear(state, hamlet, now) {
  const felled = isRecord(state?.wilds) && isRecord(state.wilds.felled) ? state.wilds.felled : {};
  if (!isRecord(hamlet) || !Number.isInteger(hamlet.x) || !Number.isInteger(hamlet.y) || !finite(now)) return false;
  const day = dayNumber(now);
  for (const [id, when] of Object.entries(felled)) {
    if (when !== day) continue;
    const m = /^tree:(-?\d+),(-?\d+)$/.exec(id);
    if (m && Math.abs(Number(m[1]) - hamlet.x) <= NEAR_TREES && Math.abs(Number(m[2]) - hamlet.y) <= NEAR_TREES) return true;
  }
  return false;
}

/** 'cool' while a stump of theirs stands, 'warm' once they know him, else 'plain'. */
export function welcomeAt(state, hamlet, now) {
  if (felledNear(state, hamlet, now)) return 'cool';
  return visitsTo(state, hamlet?.id) >= WARM_VISITS ? 'warm' : 'plain';
}

const WORDS = Object.freeze({
  cool: 'The folk frown. A tree you felled here is still a stump. The stall is shut today.',
  warm: 'They know you here.',
  plain: '',
});
/** What the hamlet's panel says of its welcome. */
export const welcomeLine = (welcome) => WORDS[welcome] || '';
