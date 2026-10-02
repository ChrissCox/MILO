// Folk (PLAN.md Phase 5b; LORE.md §9.0): the people of the hamlets, the world's set pieces. Each
// hamlet gets two or three, made from a name, a job and the hamlet's age, the same every time for
// the same hamlet. They can't be befriended or recruited: they stand where they live and say one
// thing at a time. Pure: the words are content/people/folk.json, and `free(x, y)` says where a
// person can stand.

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

/** A hamlet is old (there before the road) or new (went up after the lantern woke), for good. */
export function hamletAge(hamlet) {
  if (!isRecord(hamlet) || !Number.isInteger(hamlet.x) || !Number.isInteger(hamlet.y)) return 'old';
  return hash('age', keyOf(hamlet)) % 5 < 2 ? 'new' : 'old';
}

/** What the hamlet's own panel says about its age. */
export function ageLine(hamlet, folk) {
  const ages = isRecord(folk) && isRecord(folk.ages) ? folk.ages : {};
  return typeof ages[hamletAge(hamlet)] === 'string' ? ages[hamletAge(hamlet)] : '';
}

/**
 * The folk of a hamlet: two or three, each { id, name, role, title, age, x, y, look, lines }.
 * `free(x, y)` → whether someone can stand on a tile (walkable and nothing on it). Someone who
 * can't be given a tile near the hamlet is left out. `lines` has the role's lines for any hamlet
 * first, then the ones for this hamlet's age.
 */
export function folkFor(hamlet, folk, { free = () => true } = {}) {
  if (!isRecord(hamlet) || !Number.isInteger(hamlet.x) || !Number.isInteger(hamlet.y) || !isRecord(folk)) return [];
  const names = Array.isArray(folk.names) ? folk.names.filter((n) => typeof n === 'string' && n) : [];
  const roles = Array.isArray(folk.roles) ? folk.roles.filter((r) => isRecord(r) && typeof r.id === 'string' && typeof r.title === 'string') : [];
  if (!names.length || !roles.length) return [];
  const key = keyOf(hamlet);
  const age = hamletAge(hamlet);
  const count = 2 + (hash('count', key) % 2);
  // Tiles round the hamlet, nearest first, in an order that is the hamlet's own.
  const tiles = [];
  for (let dy = -3; dy <= 4; dy += 1) {
    for (let dx = -3; dx <= 5; dx += 1) {
      const x = hamlet.x + dx;
      const y = hamlet.y + dy;
      if (dx >= -1 && dx <= 3 && dy >= -1 && dy <= 2) continue; // the houses themselves, and their doorsteps
      let ok = false;
      try { ok = free(x, y) === true; } catch { ok = false; }
      if (ok) tiles.push({ x, y, order: hash('tile', key, x, y) });
    }
  }
  tiles.sort((a, b) => a.order - b.order);
  const out = [];
  const usedNames = new Set();
  const usedRoles = new Set();
  for (let i = 0; i < count; i += 1) {
    const spot = tiles.find((t) => !out.some((p) => Math.abs(p.x - t.x) <= 1 && Math.abs(p.y - t.y) <= 1));
    if (!spot) break;
    let n = hash('name', key, i) % names.length;
    while (usedNames.has(n)) n = (n + 1) % names.length;
    usedNames.add(n);
    let r = hash('role', key, i) % roles.length;
    while (usedRoles.has(r)) r = (r + 1) % roles.length;
    usedRoles.add(r);
    const role = roles[r];
    const list = (v) => (Array.isArray(v) ? v.filter((l) => typeof l === 'string' && l) : []);
    out.push({
      id: `folk-${key}-${i}`, name: names[n], role: role.id, title: role.title, age, x: spot.x, y: spot.y,
      look: folkLook(hash('look', key, i)), lines: [...list(role.any), ...list(role[age])],
    });
  }
  return out;
}

/** What one of the folk says today: a different line each day, the same all day. */
export function folkLine(person, day = 0) {
  const lines = Array.isArray(person?.lines) ? person.lines : [];
  if (!lines.length) return '';
  return lines[(hash('line', person.id) + Math.max(0, Math.floor(Number(day) || 0))) % lines.length];
}
