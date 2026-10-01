// Camp life (PLAN.md Phase 5.4): what Milo does while you focus, and what the fire makes. While a
// Kindle session runs Milo gathers (chops, fishes, forages or mines, as Chris chose), and when the
// session pays, so does the haul, once. At the fire the haul becomes the tonics and Cheers that
// fights already use. Pure: every step takes `now` and returns a new state (or the same one).
import { isRecord, cleanCount } from './clean.js';
import { GATHER_IDS, ITEM_IDS, RECIPE_IDS, emptyCamplife, cleanCamplife } from './state5.js';
import { addXp, levelForXp } from './lifeskills.js';
import { addCheer } from './party.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The four things Milo can do while you focus, with the skill each trains and what it brings. */
export const ACTIVITIES = Object.freeze({
  woodcutting: Object.freeze({ id: 'woodcutting', label: 'Chop wood', done: 'chopped', skill: 'woodcutting', items: ['birch', 'ash', 'pine'] }),
  fishing: Object.freeze({ id: 'fishing', label: 'Fish', done: 'fished', skill: 'fishing', items: ['minnow', 'trout'] }),
  foraging: Object.freeze({ id: 'foraging', label: 'Forage', done: 'foraged', skill: 'foraging', items: ['berries', 'herbs'] }),
  mining: Object.freeze({ id: 'mining', label: 'Mine', done: 'mined', skill: 'mining', items: ['stone', 'copper'] }),
});
export const ACTIVITY_IDS = GATHER_IDS;
/** The skills the hauls train (so skills.json can say where they rise from). */
export const GATHER_SKILLS = Object.freeze(['woodcutting', 'fishing', 'foraging', 'mining']);

/** How the satchel names what Milo brings back. */
export const ITEM_NAMES = Object.freeze({
  birch: 'birch', ash: 'ash', pine: 'pine', minnow: 'minnow', trout: 'trout', berries: 'berries', herbs: 'herbs', stone: 'stone', copper: 'copper',
});
/** The gathered things beyond the three logs, in the order the satchel lists them. */
export const GATHERED = Object.freeze(['minnow', 'trout', 'berries', 'herbs', 'stone', 'copper']);

export const GATHER_XP = 250;
export const MAX_TONICS = 20;
export const MAX_CHEERS = 4;
/** A better catch from this level on (trout, copper). */
export const RARE_FROM = 5;

const camplifeOf = (state) => (isRecord(state?.camplife) ? cleanCamplife(state.camplife) : emptyCamplife());
const withCamplife = (state, camplife) => ({ ...state, camplife });
const materialsOf = (state) => (isRecord(state?.satchel) && isRecord(state.satchel.materials) ? state.satchel.materials : {});
const have = (state, id) => cleanCount(materialsOf(state)[id]);
const levelOf = (state, skill) => {
  const skills = isRecord(state?.xp) && isRecord(state.xp.skills) ? state.xp.skills : {};
  return levelForXp(cleanCount(skills[skill], 2e8));
};

/** Chooses what Milo does while you focus (null: nothing). */
export function chooseGather(state, activity) {
  if (!isRecord(state)) return state;
  const gather = ACTIVITY_IDS.includes(activity) ? activity : null;
  const cl = camplifeOf(state);
  return cl.gather === gather ? state : withCamplife(state, { ...cl, gather });
}

// A small integer hash, so a haul is the same every time for the same session.
function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

/**
 * What a completed focus session brings back: { items: { id: n }, count }. Three to five things, one
 * more for every ten levels in the skill; a better kind (trout, copper) turns up from level 5.
 */
export function haulFor(state, activity, session) {
  const act = ACTIVITIES[activity];
  if (!act || !finite(session)) return { items: {}, count: 0 };
  const level = levelOf(state, act.skill);
  const count = 3 + (hash(activity, session, 'n') % 3) + Math.floor(level / 10);
  const items = {};
  for (let i = 0; i < count; i += 1) {
    const r = hash(activity, session, i);
    let id;
    if (activity === 'woodcutting') id = act.items[r % 3];
    else if (activity === 'foraging') id = act.items[r % 2];
    else id = level >= RARE_FROM && r % 3 === 0 ? act.items[1] : act.items[0];
    items[id] = (items[id] || 0) + 1;
  }
  return { items, count };
}

/**
 * Pays the haul for the focus session that began at `session` and ended at `at`: the things into the
 * satchel and XP in the skill. Once a session, however often it is asked. → { state, haul | null }
 */
export function payHaul(state, session, at) {
  if (!isRecord(state) || !finite(session) || !finite(at)) return { state, haul: null };
  const cl = camplifeOf(state);
  if (!cl.gather || cl.last?.session === Math.round(session)) return { state, haul: null };
  const act = ACTIVITIES[cl.gather];
  const { items } = haulFor(state, cl.gather, Math.round(session));
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const materials = { ...materialsOf(state) };
  for (const [id, n] of Object.entries(items)) materials[id] = Math.min(1e9, cleanCount(materials[id]) + n);
  let next = { ...state, satchel: { ...satchel, materials } };
  const gained = addXp(next, act.skill, GATHER_XP, at, { source: 'haul', text: 'Milo gathered while you focused' });
  next = withCamplife(gained.state, { ...cl, last: { session: Math.round(session), at: Math.round(at), activity: cl.gather, items } });
  return { state: next, haul: { activity: cl.gather, items, xp: gained.drop ? gained.drop.amount : 0 } };
}

/** '3 trout and 1 minnow', '4 berries', or ''. */
export function itemsWords(items) {
  const parts = Object.entries(isRecord(items) ? items : {}).filter(([, n]) => n > 0).map(([id, n]) => `${n} ${ITEM_NAMES[id] || id}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What the last haul says: 'Milo fished and brought back 4 minnow.', or '' (none yet). */
export function haulWords(state) {
  const last = camplifeOf(state).last;
  if (!last) return '';
  const act = ACTIVITIES[last.activity];
  const what = itemsWords(last.items);
  return what ? `Milo ${act.done} and brought back ${what}.` : '';
}

// ---------------------------------------------------------------------------
// The fire

/** Four things worth cooking. The first two are the tonics fights already carry; the others lift the party's Cheers. */
export const RECIPES = Object.freeze([
  Object.freeze({ id: 'cordial', name: 'Hearthberry cordial', needs: Object.freeze({ berries: 3 }), level: 1, tonic: 'cordial', cheers: 0, xp: 120 }),
  Object.freeze({ id: 'brew', name: 'Brew of clear morning', needs: Object.freeze({ herbs: 3 }), level: 1, tonic: 'brew', cheers: 0, xp: 120 }),
  Object.freeze({ id: 'minnow-supper', name: 'Minnow supper', needs: Object.freeze({ minnow: 4 }), level: 1, tonic: null, cheers: 1, xp: 100 }),
  Object.freeze({ id: 'trout-stew', name: 'Trout stew', needs: Object.freeze({ trout: 2, herbs: 1 }), level: 3, tonic: null, cheers: 2, xp: 240 }),
]);

const tonicsOf = (state) => (isRecord(state?.satchel) && isRecord(state.satchel.tonics) ? state.satchel.tonics : {});
const cheersOf = (state) => cleanCount(state?.party?.cheers, MAX_CHEERS);

/** Each recipe with what's in the satchel: [{ id, name, needs: [{ id, name, n, have }], level, makes, can, why }]. */
export function cookView(state) {
  const cooking = levelOf(state, 'cooking');
  return RECIPES.map((r) => {
    const needs = Object.entries(r.needs).map(([id, n]) => ({ id, name: ITEM_NAMES[id], n, have: have(state, id) }));
    let why = null;
    if (cooking < r.level) why = `Cooking level ${r.level}`;
    else if (needs.some((x) => x.have < x.n)) why = 'Not enough yet';
    else if (r.tonic && cleanCount(tonicsOf(state)[r.tonic]) >= MAX_TONICS) why = 'Full';
    else if (r.cheers && cheersOf(state) >= MAX_CHEERS) why = 'Everyone is cheered';
    const makes = r.tonic ? `1 ${r.name.toLowerCase()}` : `${r.cheers} ${r.cheers === 1 ? 'Cheer' : 'Cheers'}`;
    return { id: r.id, name: r.name, needs, level: r.level, makes, can: why === null, why, cooked: camplifeOf(state).cooked[r.id] || 0 };
  });
}

/** Cooks one: uses the things, makes the tonic or the Cheers, trains Cooking. → { state, ok, why, xp } */
export function cook(state, recipeId, now) {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r || !isRecord(state) || !finite(now)) return { state, ok: false, why: 'Nothing to cook.', xp: 0 };
  const view = cookView(state).find((x) => x.id === r.id);
  if (!view.can) return { state, ok: false, why: view.why, xp: 0 };
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const materials = { ...materialsOf(state) };
  for (const [id, n] of Object.entries(r.needs)) materials[id] = cleanCount(materials[id]) - n;
  let next = { ...state, satchel: { ...satchel, materials } };
  if (r.tonic) next = { ...next, satchel: { ...next.satchel, tonics: { ...tonicsOf(next), [r.tonic]: Math.min(MAX_TONICS, cleanCount(tonicsOf(next)[r.tonic]) + 1) } } };
  if (r.cheers) next = addCheer(next, r.cheers, now);
  const gained = addXp(next, 'cooking', r.xp, now, { source: 'cooked', text: 'Cooked at the fire' });
  const cl = camplifeOf(gained.state);
  next = withCamplife(gained.state, { ...cl, cooked: { ...cl.cooked, [r.id]: (cl.cooked[r.id] || 0) + 1 } });
  return { state: next, ok: true, why: null, xp: gained.drop ? gained.drop.amount : 0 };
}

/** The word for a gather choice in a select: 'Nothing', 'Chop wood'… */
export const gatherLabel = (id) => ACTIVITIES[id]?.label || 'Nothing';

export { ITEM_IDS, RECIPE_IDS, emptyCamplife, cleanCamplife };
