// Settlements (PLAN.md Phase 5b; LORE.md §9.0): a hamlet is a few homes and a well, laid out by
// rule from a kit of parts. An old place has thatch and slate, a lamp post and a well worn smooth;
// a new one has fresh shingle, a tent and a pile of timber. Pure: the wilds say where a part fits
// (`place(part, x, y)` → true once it stands there), and the same hamlet lays out the same way
// every time.

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

const isHamlet = (hamlet) => isRecord(hamlet) && Number.isInteger(hamlet.x) && Number.isInteger(hamlet.y);
const keyOf = (hamlet) => `${hamlet.x}_${hamlet.y}`;

/** A hamlet is old (there before the road) or new (went up after the lantern woke), for good. */
export function hamletAge(hamlet) {
  if (!isHamlet(hamlet)) return 'old';
  return hash('age', keyOf(hamlet)) % 5 < 2 ? 'new' : 'old';
}

const part = (it) => Object.freeze(it);
/**
 * The kit, in the order the parts go up. `part` is what it is to the people who live there, `kind`
 * its sprite, `gap` how far from the hamlet's own tile it may stand (1 is beside it), and `odds`
 * (out of 5) whether this hamlet has one at all.
 */
export const KIT = Object.freeze({
  old: Object.freeze([
    part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 3] }),
    part({ part: 'home', kind: 'cottage', w: 2, h: 2, gap: [2, 5] }),
    part({ part: 'stall', kind: 'stall', w: 2, h: 1, gap: [2, 4], odds: 3 }),
    part({ part: 'home', kind: 'cottage.slate', w: 2, h: 2, gap: [3, 6], odds: 3 }),
    part({ part: 'lamp', kind: 'lamp.post', w: 1, h: 1, gap: [1, 3] }),
  ]),
  new: Object.freeze([
    part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 3] }),
    part({ part: 'home', kind: 'cottage.new', w: 2, h: 2, gap: [2, 5] }),
    part({ part: 'tent', kind: 'tent', w: 2, h: 1, gap: [2, 5] }),
    part({ part: 'stall', kind: 'stall', w: 2, h: 1, gap: [2, 4], odds: 2 }),
    part({ part: 'home', kind: 'cottage.clay', w: 2, h: 2, gap: [3, 6], odds: 2 }),
    part({ part: 'timber', kind: 'woodpile', w: 2, h: 1, gap: [1, 4] }),
    part({ part: 'lamp', kind: 'lamp.post', w: 1, h: 1, gap: [1, 3] }),
  ]),
});

/**
 * Each region builds its own way. The Whisperwood's are wood-villages: mossy shingle and a pile of
 * timber by every door. Mistmere's are harbor villages: slate roofs, a stall that is always open,
 * and barrels and crates off the boats. Anywhere else builds as the home country does (KIT).
 */
export const REGION_KITS = Object.freeze({
  whisperwood: Object.freeze({
    old: Object.freeze([
      part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 3] }),
      part({ part: 'home', kind: 'cottage.moss', w: 2, h: 2, gap: [2, 5] }),
      part({ part: 'timber', kind: 'woodpile', w: 2, h: 1, gap: [1, 4] }),
      part({ part: 'home', kind: 'cottage.moss', w: 2, h: 2, gap: [3, 6], odds: 3 }),
      part({ part: 'stall', kind: 'stall', w: 2, h: 1, gap: [2, 4], odds: 2 }),
      part({ part: 'lamp', kind: 'lamp.post', w: 1, h: 1, gap: [1, 3] }),
    ]),
    new: Object.freeze([
      part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 3] }),
      part({ part: 'home', kind: 'cottage.new', w: 2, h: 2, gap: [2, 5] }),
      part({ part: 'tent', kind: 'tent', w: 2, h: 1, gap: [2, 5] }),
      part({ part: 'timber', kind: 'woodpile', w: 2, h: 1, gap: [1, 4] }),
      part({ part: 'timber', kind: 'woodpile', w: 2, h: 1, gap: [2, 5], odds: 3 }),
      part({ part: 'stall', kind: 'stall', w: 2, h: 1, gap: [2, 4], odds: 2 }),
      part({ part: 'lamp', kind: 'lamp.post', w: 1, h: 1, gap: [1, 3] }),
    ]),
  }),
  mistmere: Object.freeze({
    old: Object.freeze([
      part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 3] }),
      part({ part: 'home', kind: 'cottage.slate', w: 2, h: 2, gap: [2, 5] }),
      part({ part: 'stall', kind: 'stall', w: 2, h: 1, gap: [2, 4] }),
      part({ part: 'stores', kind: 'barrel', w: 1, h: 1, gap: [1, 4] }),
      part({ part: 'stores', kind: 'crate', w: 1, h: 1, gap: [1, 4] }),
      part({ part: 'home', kind: 'cottage.slate', w: 2, h: 2, gap: [3, 6], odds: 3 }),
      part({ part: 'lamp', kind: 'lamp.post', w: 1, h: 1, gap: [1, 3] }),
    ]),
    new: Object.freeze([
      part({ part: 'well', kind: 'well', w: 1, h: 1, gap: [2, 3] }),
      part({ part: 'home', kind: 'cottage.clay', w: 2, h: 2, gap: [2, 5] }),
      part({ part: 'tent', kind: 'tent', w: 2, h: 1, gap: [2, 5] }),
      part({ part: 'stall', kind: 'stall', w: 2, h: 1, gap: [2, 4] }),
      part({ part: 'stores', kind: 'barrel', w: 1, h: 1, gap: [1, 4] }),
      part({ part: 'stores', kind: 'crate', w: 1, h: 1, gap: [1, 4] }),
      part({ part: 'lamp', kind: 'lamp.post', w: 1, h: 1, gap: [1, 3] }),
    ]),
  }),
});

/** The kit a hamlet is built from: its region's, or the home country's. */
export const kitFor = (region, age) => (Object.hasOwn(REGION_KITS, region) ? REGION_KITS[region] : KIT)[age === 'new' ? 'new' : 'old'];

// How far a footprint stands from a tile: 0 on it, 1 beside it, 2 with a tile between.
const gapTo = (fx, fy, w, h, x, y) => Math.max(
  x < fx ? fx - x : x > fx + w - 1 ? x - (fx + w - 1) : 0,
  y < fy ? fy - y : y > fy + h - 1 ? y - (fy + h - 1) : 0,
);

/**
 * Lay a hamlet's other parts out round its tile. `place(part, x, y)` is asked, nearest ring first
 * and in the hamlet's own order within a ring, until it says yes; a part with nowhere to go is
 * left out. `region` is the named region the hamlet stands in (its id), if any. → the parts that
 * stand, each { id, part, kind, x, y, w, h }.
 */
export function layoutSettlement(hamlet, place, { region = null } = {}) {
  if (!isHamlet(hamlet)) return [];
  return layoutKit(hamlet, kitFor(region, hamletAge(hamlet)), place);
}

/** The same rule for any kit of parts (a camp's, in camps.js): each part round the tile, in order. */
export function layoutKit(hamlet, kit, place) {
  if (!isHamlet(hamlet) || !Array.isArray(kit) || typeof place !== 'function') return [];
  const key = keyOf(hamlet);
  const out = [];
  kit.forEach((part, n) => {
    if (part.odds && hash('has', key, n) % 5 >= part.odds) return;
    const [near, far] = part.gap;
    const spots = [];
    for (let fy = hamlet.y - far - part.h + 1; fy <= hamlet.y + far; fy += 1) {
      for (let fx = hamlet.x - far - part.w + 1; fx <= hamlet.x + far; fx += 1) {
        const gap = gapTo(fx, fy, part.w, part.h, hamlet.x, hamlet.y);
        if (gap >= near && gap <= far) spots.push({ fx, fy, gap, order: hash('spot', key, n, fx, fy) });
      }
    }
    spots.sort((a, b) => a.gap - b.gap || a.order - b.order);
    const id = `${part.part}${out.filter((p) => p.part === part.part).length + 1}`;
    for (const s of spots) {
      let ok = false;
      try { ok = place({ ...part, id }, s.fx, s.fy) === true; } catch { ok = false; }
      if (!ok) continue;
      out.push({ id, part: part.part, kind: part.kind, x: s.fx, y: s.fy, w: part.w, h: part.h });
      break;
    }
  });
  return out;
}

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const some = (n, one, many) => (n === 1 ? `a ${one}` : `${COUNT[n] || n} ${many}`);

/**
 * What stands in a hamlet, in a line: "Three homes, a tent, a well and a stall." `parts` are the
 * hamlet's laid-out parts (anything with a `part`); its own first home is counted in.
 */
export function partsLine(parts) {
  const list = Array.isArray(parts) ? parts.filter((p) => isRecord(p) && typeof p.part === 'string') : [];
  const n = (part) => list.filter((p) => p.part === part).length;
  const said = [some(1 + n('home'), 'home', 'homes')];
  if (n('tent')) said.push(some(n('tent'), 'tent', 'tents'));
  if (n('well')) said.push(some(n('well'), 'well', 'wells'));
  if (n('stall')) said.push(some(n('stall'), 'stall', 'stalls'));
  const line = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}` : said[0];
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}
