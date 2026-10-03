// Outposts (PLAN.md Phase 6; WORLD.md §6; the Hold, Hearth tier 3): claim a lit lantern in explored
// land and it becomes yours, a small camp with a little ward of its own. No rift opens within six
// tiles of an outpost, the way none opens inside the vale. It costs birch and stone from the wilds
// and Mining, and the Hearth's tier says how many there may be (two at the Hold, two more with each
// tier after). Pure: the lantern's id is where it stands.
//
// The saved side is `state.camplife.outposts = { [lanternId]: claimedAt }`.
import { isRecord, cleanCount, toTime } from './clean.js';
import { cleanCamplife } from './state5.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The Hearth tier that opens outposts. */
export const OUTPOSTS_FROM_TIER = 3;
/** The little ward round an outpost, in tiles. */
export const OUTPOST_RADIUS = 6;
/** What claiming one costs, from the satchel. */
export const OUTPOST_COST = Object.freeze({ birch: 20, stone: 10 });
const LANTERN_ID = /^lantern:(-?\d{1,7}),(-?\d{1,7})$/;

const tierOf = (state) => (finite(state?.hearth?.tier) ? Math.floor(state.hearth.tier) : 1);
const outpostsOf = (state) => (isRecord(state?.camplife) && isRecord(state.camplife.outposts) ? state.camplife.outposts : {});

/** How many outposts the Hearth allows: none before the Hold, two at the Hold, two more with each tier. */
export const outpostLimit = (state) => (tierOf(state) >= OUTPOSTS_FROM_TIER ? (tierOf(state) - OUTPOSTS_FROM_TIER + 1) * 2 : 0);

/** The lantern's tile from its id, or null. */
export function lanternTile(id) {
  const m = LANTERN_ID.exec(typeof id === 'string' ? id : '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** The outposts standing: [{ id, x, y, at }], oldest first. */
export function outposts(state) {
  return Object.entries(outpostsOf(state))
    .map(([id, at]) => ({ id, at: toTime(at), tile: lanternTile(id) }))
    .filter((o) => o.tile && o.at)
    .sort((a, b) => a.at - b.at)
    .map((o) => ({ id: o.id, x: o.tile.x, y: o.tile.y, at: o.at }));
}

/** Whether a tile is inside an outpost's ward. */
export function nearOutpost(state, x, y) {
  for (const o of outposts(state)) if (Math.hypot(o.x - x, o.y - y) <= OUTPOST_RADIUS) return true;
  return false;
}

const have = (state, id) => cleanCount(isRecord(state?.satchel?.materials) ? state.satchel.materials[id] : 0);

/**
 * What a lantern's panel offers: { state: 'none' | 'open' | 'claimed', can, problem, cost: [{ id, need, have }] }.
 * 'none' before the Hold or for a lantern that isn't lit; 'open' when it could be claimed.
 */
export function outpostView(state, lanternId) {
  const tile = lanternTile(lanternId);
  const cost = Object.entries(OUTPOST_COST).map(([id, need]) => ({ id, need, have: have(state, id) }));
  if (!tile || tierOf(state) < OUTPOSTS_FROM_TIER) return { state: 'none', can: false, problem: '', cost };
  if (Object.hasOwn(outpostsOf(state), lanternId)) return { state: 'claimed', can: false, problem: '', cost };
  if (!toTime(state?.wilds?.lanterns?.[lanternId])) return { state: 'none', can: false, problem: '', cost };
  let problem = '';
  if (outposts(state).length >= outpostLimit(state)) problem = 'Every outpost the Hold allows is taken.';
  else if (cost.some((c) => c.have < c.need)) problem = `Needs ${cost.map((c) => `${c.need} ${c.id}`).join(' and ')}.`;
  return { state: 'open', can: !problem, problem, cost };
}

/** Claims a lit lantern as an outpost, spending the cost. → { state, ok, why } */
export function claimOutpost(state, lanternId, now) {
  const view = outpostView(state, lanternId);
  if (!finite(now) || view.state !== 'open') return { state, ok: false, why: view.state === 'claimed' ? 'It is already an outpost.' : 'Not here.' };
  if (!view.can) return { state, ok: false, why: view.problem };
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const materials = { ...(isRecord(satchel.materials) ? satchel.materials : {}) };
  for (const c of view.cost) materials[c.id] = c.have - c.need;
  const camplife = cleanCamplife(state.camplife);
  return {
    state: { ...state, satchel: { ...satchel, materials }, camplife: { ...camplife, outposts: { ...camplife.outposts, [lanternId]: Math.round(now) } } },
    ok: true, why: '',
  };
}
