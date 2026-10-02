// New places follow your light (PLAN.md Phase 5b; LORE.md §9.0). A lit lantern wakes its stretch
// of road. Two real days later somebody has pitched a camp beside it: a fire and a tent. Come by on
// three different days and the camp has become a hamlet of its own, with a home and a well. So the
// map fills in where the lantern-bearer has walked, and the new places are, in a small way, his.
//
// Pure. A camp is not part of the generated world: it is laid out beside its lantern by the same
// rule as a hamlet (settlement.js), from what is true now (when the lantern was lit, how often Milo
// has been), and the scene draws it over the land.
import { layoutKit } from './settlement.js';

const DAY = 24 * 60 * 60 * 1000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const part = (it) => Object.freeze(it);

/** How long after a lantern is lit before someone camps beside it. */
export const CAMP_AFTER_MS = 2 * DAY;
/** Different days Milo comes by before a camp becomes a hamlet. */
export const GROW_VISITS = 3;

/** What goes up, in order. A hamlet keeps its camp's fire and tent where they were. */
const CAMP = Object.freeze([
  part({ part: 'fire', kind: 'campfire', w: 1, h: 1, gap: [1, 2] }),
  part({ part: 'tent', kind: 'tent', w: 2, h: 1, gap: [2, 3] }),
]);
export const CAMP_KITS = Object.freeze({
  camp: CAMP,
  hamlet: Object.freeze([
    ...CAMP,
    part({ part: 'home', kind: 'cottage.new', w: 2, h: 2, gap: [2, 5] }),
    part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 4] }),
    part({ part: 'timber', kind: 'woodpile', w: 2, h: 1, gap: [2, 5] }),
  ]),
});

/** A lantern's id as its camp's: 'lantern:28,-14' → 'camp:lantern:28,-14'. */
export const campId = (lanternId) => `camp:${lanternId}`;

/**
 * Where a lantern's camp has got to: 'none' (not lit, or lit less than two days ago), 'camp', or
 * 'hamlet' (once Milo has come by on three different days).
 */
export function campStage(litAt, visits, now) {
  if (!finite(litAt) || !finite(now) || now - litAt < CAMP_AFTER_MS) return 'none';
  return (Number.isInteger(visits) ? visits : 0) >= GROW_VISITS ? 'hamlet' : 'camp';
}

/**
 * A lantern's camp as it stands: null when there is none, else
 * { id, lanternId, x, y, stage, parts: [{ id, part, kind, x, y, w, h }] }.
 * `free(x, y)` → whether a tile is open ground (walkable, off the road, nothing on it). Every part
 * keeps a tile between itself and the next, and a part with nowhere to go is left out.
 */
export function campFor(lantern, { litAt = null, visits = 0, now = 0, free = () => false } = {}) {
  if (!isRecord(lantern) || typeof lantern.id !== 'string' || !Number.isInteger(lantern.x) || !Number.isInteger(lantern.y)) return null;
  const stage = campStage(litAt, visits, now);
  if (stage === 'none') return null;
  const stand = [];
  const place = (p, fx, fy) => {
    for (let y = fy; y < fy + p.h; y += 1) for (let x = fx; x < fx + p.w; x += 1) {
      let ok = false;
      try { ok = free(x, y) === true; } catch { ok = false; }
      if (!ok) return false;
    }
    for (const s of stand) if (fx <= s.x + s.w && fx + p.w >= s.x && fy <= s.y + s.h && fy + p.h >= s.y) return false;
    stand.push({ x: fx, y: fy, w: p.w, h: p.h });
    return true;
  };
  const parts = layoutKit({ x: lantern.x, y: lantern.y }, CAMP_KITS[stage], place);
  if (!parts.length) return null;
  return { id: campId(lantern.id), lanternId: lantern.id, x: lantern.x, y: lantern.y, stage, parts };
}

/** What a camp is called, and what its bubble says. */
export function campWords(camp) {
  if (!isRecord(camp)) return { title: '', lines: [] };
  if (camp.stage === 'hamlet') return { title: 'A new hamlet', lines: ['It was a camp. You kept coming by, and it stayed.'] };
  return { title: 'A camp', lines: ['Somebody pitched it after you lit the lantern.'] };
}
