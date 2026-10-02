// Folk (PLAN.md Phase 5b; LORE.md §9.0): the people of the hamlets, the world's set pieces. Each
// hamlet gets three or four, made from a name, a job and the hamlet's age, the same every time for
// the same hamlet. They can't be befriended or recruited: they stand where they live and say one
// thing at a time. Pure: the words are content/people/folk.json, and `free(x, y)` says where a
// person can stand.
import { hamletAge } from './settlement.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Coat colours for folk (the coat rig's keys → palette keys), registered as 'folk-0' … 'folk-7'. */
export const FOLK_DYES = Object.freeze([
  { m: 'B', b: 'b', u: 'r', U: 'R', Y: 'Q', r: 'c', R: 'C', Q: 'C' },
  { m: 'S', b: 's', u: 'l', U: 'L', Y: 'M', r: 'u', R: 'U', Q: 'Y' },
  { m: 'u', b: 'p', u: 'e', U: 'E', Y: 'N', r: 'k', R: 'K', Q: 'K' },
  { m: 'm', b: 'B', u: 'v', U: 'V', Y: 'V', r: 'c', R: 'C', Q: 'C' },
  { m: 'N', b: 'e', u: 'p', U: 'P', Y: 'P', r: 'l', R: 'L', Q: 'M' },
  { m: 'R', b: 'r', u: 's', U: 'S', Y: 'z', r: 'e', R: 'E', Q: 'N' },
  { m: 'z', b: 'S', u: 'k', U: 'K', Y: 'K', r: 'q', R: 'l', Q: 'L' },
  { m: 'Y', b: 'U', u: 'q', U: 'l', Y: 'L', r: 'r', R: 'R', Q: 'Q' },
].map(Object.freeze));
export const folkLook = (n) => ({ kind: 'rig', rig: 'coat', who: `folk-${((n % FOLK_DYES.length) + FOLK_DYES.length) % FOLK_DYES.length}`, likeness: null });

function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

const keyOf = (hamlet) => `${hamlet.x}_${hamlet.y}`;

export { hamletAge };

/** What the hamlet's own panel says about its age. */
export function ageLine(hamlet, folk) {
  const ages = isRecord(folk) && isRecord(folk.ages) ? folk.ages : {};
  return typeof ages[hamletAge(hamlet)] === 'string' ? ages[hamletAge(hamlet)] : '';
}

/**
 * The folk of a hamlet: three or four, each { id, name, role, title, age, x, y, look, lines, cool, warm }.
 * Every hamlet has a seller and a keeper of something (LORE.md §9.0), and one or two others.
 * `free(x, y)` → whether someone can stand on a tile (walkable and nothing on it). `parts` are
 * the hamlet's buildings (settlement.js): someone whose job has a `post` (the well, the stall, a
 * home) stands beside it. `lines` has the role's lines for any hamlet, then this hamlet's age.
 *
 * They keep a day (`part`: 'morning' | 'afternoon' | 'evening' | 'night', and `rain`). At night
 * only those whose job is the night are out (the lamplighter, whoever watches the road). In the
 * rain the seller stays under the awning and the rest go in. Of an evening they gather at the well.
 * Whoever is indoors isn't in the list, and everyone keeps their name, job and id whatever the hour.
 */
export function folkFor(hamlet, folk, { free = () => true, parts = [], part = 'day', rain = false, age: given = null, limit = null } = {}) {
  if (!isRecord(hamlet) || !Number.isInteger(hamlet.x) || !Number.isInteger(hamlet.y) || !isRecord(folk)) return [];
  const names = Array.isArray(folk.names) ? folk.names.filter((n) => typeof n === 'string' && n) : [];
  const roles = Array.isArray(folk.roles) ? folk.roles.filter((r) => isRecord(r) && typeof r.id === 'string' && typeof r.title === 'string') : [];
  if (!names.length || !roles.length) return [];
  const key = keyOf(hamlet);
  // A camp beside a lantern (camps.js) is new by definition, and has room for fewer.
  const age = given === 'new' || given === 'old' ? given : hamletAge(hamlet);
  const built = (Array.isArray(parts) ? parts : []).filter((p) => isRecord(p) && typeof p.part === 'string' && [p.x, p.y, p.w, p.h].every(Number.isInteger));
  const can = (x, y) => { try { return free(x, y) === true; } catch { return false; } };
  const list = (v) => (Array.isArray(v) ? v.filter((l) => typeof l === 'string' && l) : []);

  // Who lives here: the seller, a keeper, and one or two more. The same people whatever the hour.
  const seller = roles.findIndex((r) => r.post === 'stall');
  const keepers = roles.map((r, i) => (r.keeper === true ? i : -1)).filter((i) => i >= 0);
  const keeper = keepers.length ? keepers[hash('keeper', key) % keepers.length] : -1;
  const count = Math.min(roles.length, names.length, Number.isInteger(limit) && limit > 0 ? limit : Infinity, 3 + (hash('count', key) % 2));
  const usedNames = new Set();
  const usedRoles = new Set();
  const roster = [];
  for (let i = 0; i < count; i += 1) {
    let r = i === 0 && seller >= 0 ? seller : i === 1 && keeper >= 0 ? keeper : hash('role', key, i) % roles.length;
    while (usedRoles.has(r)) r = (r + 1) % roles.length;
    usedRoles.add(r);
    let n = hash('name', key, i) % names.length;
    while (usedNames.has(n)) n = (n + 1) % names.length;
    usedNames.add(n);
    roster.push({ i, role: roles[r], name: names[n] });
  }

  // Tiles round the hamlet, in an order that is the hamlet's own.
  const tiles = [];
  for (let dy = -3; dy <= 4; dy += 1) {
    for (let dx = -3; dx <= 5; dx += 1) {
      const x = hamlet.x + dx;
      const y = hamlet.y + dy;
      if (dx >= -1 && dx <= 3 && dy >= -1 && dy <= 2) continue; // the first home itself, and its doorstep
      if (can(x, y)) tiles.push({ x, y, order: hash('tile', key, x, y) });
    }
  }
  tiles.sort((a, b) => a.order - b.order);
  const out = [];
  const usedPosts = new Set();
  const apart = (t) => !out.some((p) => Math.abs(p.x - t.x) <= 1 && Math.abs(p.y - t.y) <= 1);
  // Beside what they keep, if the hamlet has one: in front of it first, then at either end.
  const postFor = (role) => {
    for (const p of built) {
      if (p.part !== role.post || usedPosts.has(p)) continue;
      const front = [];
      for (let x = p.x; x < p.x + p.w; x += 1) front.push({ x, y: p.y + p.h });
      const spot = [...front, { x: p.x - 1, y: p.y + p.h - 1 }, { x: p.x + p.w, y: p.y + p.h - 1 }].find((t) => can(t.x, t.y) && apart(t));
      if (spot) { usedPosts.add(p); return spot; }
    }
    return null;
  };
  // Of an evening, round the well.
  const well = built.find((p) => p.part === 'well');
  const byWell = () => {
    if (!well) return null;
    const ring = [];
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const t = { x: well.x + dx, y: well.y + dy };
      if ((dx || dy) && can(t.x, t.y)) ring.push({ ...t, order: hash('well', key, t.x, t.y) });
    }
    return ring.sort((a, b) => a.order - b.order).find(apart) || null;
  };
  const isOut = (role) => {
    if (part === 'night') return role.night === true;
    if (rain) return role.night === true || role.post === 'stall';
    return true;
  };
  for (const { i, role, name } of roster) {
    if (!isOut(role)) continue;
    const gathering = part === 'evening' && !rain && role.night !== true && role.post !== 'stall';
    const spot = (gathering && byWell()) || (typeof role.post === 'string' && postFor(role)) || tiles.find(apart);
    if (!spot) continue;
    out.push({
      id: `folk-${key}-${i}`, name, role: role.id, title: role.title, age, x: spot.x, y: spot.y,
      look: folkLook(hash('look', key, i)), lines: [...list(role.any), ...list(role[age])],
      cool: typeof role.cool === 'string' ? role.cool : '', warm: typeof role.warm === 'string' ? role.warm : '',
    });
  }
  return out;
}

/**
 * What one of the folk says today: a different line each day, the same all day. `welcome` is how
 * the hamlet takes to Chris (welcome.js): while it's cool they say so, and nothing else; once it's
 * warm, every third day they say something only a regular hears.
 */
export function folkLine(person, day = 0, welcome = 'plain') {
  const lines = Array.isArray(person?.lines) ? person.lines : [];
  const turn = hash('line', person?.id) + Math.max(0, Math.floor(Number(day) || 0));
  if (welcome === 'cool' && person?.cool) return person.cool;
  if (welcome === 'warm' && person?.warm && turn % 3 === 0) return person.warm;
  if (!lines.length) return '';
  return lines[turn % lines.length];
}
