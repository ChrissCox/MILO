// The arena pass (CONTRACT-PHASE4.md §7.3, §5.3, §17 item 2; COMBAT.md §4.1). A seeded pass over a
// rift's (or a cave's) layout that readies its fight rooms: it picks them from riftgen's roomRects
// by what the built scene can really reach, widens them toward 7×6 where there's wall to spare,
// gives some a dais, stands 1–3 genre props in each, finds a hearth-nook, and cuts each fight
// room's Arena: the room plus 2 tiles into each corridor mouth, so one-tile corridors are
// chokepoints. The Tale-lead gets the fixed 12×9 window round B, clamped inside the scene, with
// its walls left as walls.
//
// Rules it keeps, each tested over 500 seeds:
//   - a wall turns to floor only where the new floor stays 2 tiles clear of every other room's
//     floor (so rooms never merge) and never where floor stands directly south of it (so every
//     wall keeps the 3/4 face the view draws); wet layouts (any water) aren't widened at all;
//   - nothing placed (a prop, the nook) cuts the way from the door to any tile, or leaves a
//     blocking object with no free side to walk up to (the bush rule);
//   - the width, height, origin and marks (E B S P L) never move.
//
// Its idea of open ground is the fight-ready scene's own: floor and growth (growth inside an arena
// is always reeds, and a bush elsewhere never cuts anything), and water only where elsewhere's
// fightFords lays stepping stones with the lead's footprint blocking. A fight room must also be
// reachable by the plain scene's walk (`walkable`), since riftgen.reachable counts water as open.
// So every open arena cell is ground the built scene walks on, and nothing else is.
//
// Pure: the seed is hashInts(spec.seed, 'arena'), apart from the layout's own stream.
import { createRng, hashInts } from './rng.js';
import { fightFords } from './elsewhere.js';

/** A fight arena's largest size (Arena.rect, §5.3). */
export const ARENA_MAX = Object.freeze({ w: 20, h: 16 });
/** The Tale-lead's window round B (§7.3, Decided). */
export const LEAD_WINDOW = Object.freeze({ w: 12, h: 9 });
/** Fight rooms widen toward this where there's wall to spare. */
export const ROOM_TARGET = Object.freeze({ w: 7, h: 6 });
/** Fight rooms by stage (COMBAT.md §9's table); a cave adds its far room (Decided). */
export const FIGHT_ROOMS = Object.freeze({ hairline: 1, open: 2, gaping: 3 });
/** The share of fight rooms that get a height-1 dais. */
export const DAIS_SHARE = 0.35;

/** Each genre's two PROPS4 ids (§7.8, Decided); every fight room may also have the crate. */
export const GENRE_PROPS = Object.freeze({
  neon: ['neon.server-rack', 'neon.vending'],
  nocturne: ['nocturne.streetlamp', 'nocturne.bench'],
  gothic: ['gothic.candelabra', 'gothic.pew'],
  iron: ['iron.oil-drum', 'iron.girder'],
  void: ['void.shard', 'void.orbit-stone'],
  noir: ['noir.filing-cabinet', 'noir.desk'],
  frontier: ['frontier.barrel', 'frontier.cart'],
  kaiju: ['kaiju.rubble', 'kaiju.car'],
});
/** Caves have no genre: rubble and crates. */
export const CAVE_PROPS = Object.freeze(['rubble']);

/** Each prop's flags (§7.8). */
export const PROP_FLAGS = Object.freeze({
  crate: ['cover-low', 'throwable'],
  'neon.server-rack': ['cover-high'],
  'neon.vending': ['cover-low'],
  'nocturne.streetlamp': ['cover-high', 'light'],
  'nocturne.bench': ['cover-low'],
  'gothic.candelabra': ['cover-low', 'light', 'throwable'],
  'gothic.pew': ['cover-low'],
  'iron.oil-drum': ['cover-low', 'hazard'],
  'iron.girder': ['cover-high'],
  'void.shard': ['cover-high'],
  'void.orbit-stone': ['cover-low'],
  'noir.filing-cabinet': ['cover-high'],
  'noir.desk': ['cover-low'],
  'frontier.barrel': ['cover-low', 'throwable'],
  'frontier.cart': ['cover-high'],
  'kaiju.rubble': ['cover-low'],
  'kaiju.car': ['cover-high'],
  rubble: ['cover-low'],
});

/**
 * A room's own light (Arena.light), by the genre that holds it (Decided: COMBAT names Lit, Dim and
 * Dark but not who has which). Nocturne rooms are dark, so the Hooklight and the streetlights
 * matter; Gothic, Void and Noir are dim; caves are dim.
 */
export const ROOM_LIGHT = Object.freeze({
  neon: 'L', nocturne: 'D', gothic: 'd', iron: 'L', void: 'd', noir: 'd', frontier: 'L', kaiju: 'L',
  verdant: 'L', starlight: 'L', summit: 'L', backhalls: 'L', cave: 'd',
});

const DIRS4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const keyOf = (x, y) => `${x},${y}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * The arena pass. walkable: the plain scene's (buildElsewhere of this same layout, no fight).
 * Extra option: chests, the tiles of chests a cave adds beyond layout.loot (encounters.js picks
 * them from the plain scene first); they block like loot marks, so every arena cell, start tile,
 * prop and post already knows about them, and buildElsewhere places them from plan.chests.
 * → ArenaPlan { layout, rooms: [{ roomId, role, rect, fight, arena, dais }], props: [{ x, y, state, flags }],
 *               heights (w*h '0'–'2'), nook: { x, y } | null, lead: null | { footprint, arena }, chests: [{ x, y }] }
 */
export function arenaPass(spec, layout, { genres = null, rules = null, walkable, chests = [] } = {}) {
  void genres; void rules; // the pass needs neither today; they stay in the signature for the data it may read later
  const W = layout.w;
  const H = layout.h;
  const grid = layout.rows.map((row) => [...row]);
  const rng = createRng(hashInts(spec.seed >>> 0, 'arena'));
  const cave = spec.kind === 'cave';
  const stage = FIGHT_ROOMS[spec.stage] ? spec.stage : 'hairline';
  const rects = (layout.roomRects || []).map((r) => ({ ...r }));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const idx = (x, y) => y * W + x;
  const door = { x: layout.entrance.x, y: layout.entrance.y };
  const leadFight = Boolean(spec.taleLead) && !cave;
  const B = layout.boss;
  const footprint = leadFight ? [{ x: B.x - 1, y: B.y - 1 }, { x: B.x, y: B.y - 1 }, { x: B.x - 1, y: B.y }, { x: B.x, y: B.y }] : [];
  const footKeys = new Set(footprint.map((t) => keyOf(t.x, t.y)));
  const plainOpen = (x, y) => inside(x, y) && Boolean(walkable?.(x, y));
  // Open ground as the fight-ready scene will have it: floor and growth (inside an arena growth is
  // reeds, and a bush anywhere else never cuts anything off), and water only where the scene lays
  // stepping stones once the lead's footprint blocks (elsewhere.fightFords), less what blocks.
  const fords = fightFords(layout, footprint.filter((t) => !(t.x === B.x && t.y === B.y)));
  // A cave's added chests stand on plain floor (never water), so they change no ford.
  const extraChests = (Array.isArray(chests) ? chests : []).filter((t) => t && inside(t.x, t.y)).map((t) => ({ x: t.x, y: t.y }));
  const markObjects = [...(cave ? [] : [B, layout.stitch]), layout.puzzle, ...(layout.loot || []), ...extraChests].filter(Boolean);
  const blocked = new Set([...footKeys, ...markObjects.map((m) => keyOf(m.x, m.y))]);
  const ground = (x, y) => {
    if (!inside(x, y)) return false;
    const ch = grid[y][x];
    if (ch === '#') return false;
    return ch === '~' ? fords[idx(x, y)] === 1 : true;
  };
  const open = (x, y) => ground(x, y) && !blocked.has(keyOf(x, y));

  // ---------- which rooms fight ----------
  const owner = new Int16Array(W * H).fill(-1);
  rects.forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) if (inside(x, y)) owner[idx(x, y)] = i; });
  // A room fights only if the plain scene's own walk and the fight-ready scene's both reach it.
  const plain = bfs(W, H, plainOpen, door);
  const ready = bfs(W, H, open, door);
  const reachedIn = (r) => {
    let n = 0;
    let near = Infinity;
    for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) {
      const d = inside(x, y) ? plain.dist[idx(x, y)] : -1;
      if (d >= 0 && ready.dist[idx(x, y)] >= 0) { n += 1; near = Math.min(near, d); }
    }
    return { n, near };
  };
  const leadIndex = rects.findIndex((r) => r.role === 'lead');
  const groupOf = (r) => (cave && r.role === 'lead' ? 0 : r.role === 'room' ? 1 : r.role === 'loot' || r.role === 'puzzle' ? 2 : 3);
  const order = rng.shuffle(rects.map((_, i) => i));
  const candidates = order
    .filter((i) => rects[i].role !== 'entrance' && !(leadFight && i === leadIndex))
    .map((i) => ({ i, ...reachedIn(rects[i]) }))
    .filter((c) => c.n >= 6 && c.n * 2 >= rects[c.i].w * rects[c.i].h);
  // Plain rooms first, then loot and puzzle rooms; within each, rooms whose sight can't reach the
  // doorway first (so no fight starts the moment Milo steps in), in the seeded order.
  candidates.sort((a, b) => groupOf(rects[a.i]) - groupOf(rects[b.i]) || (a.near < 9) - (b.near < 9));
  const wanted = FIGHT_ROOMS[stage] + (cave ? 1 : 0);
  const fightSet = new Set(candidates.slice(0, wanted).map((c) => c.i));
  const fightOrder = candidates.slice(0, wanted).map((c) => c.i);

  // ---------- widening ----------
  const dry = !layout.rows.some((row) => row.includes('~'));
  if (dry) {
    const clearOfOthers = (x, y, self) => {
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        const o = owner[idx(nx, ny)];
        if (o >= 0 && o !== self) return false;
      }
      return true;
    };
    // A room's rect never reaches within 2 tiles of another room, even over a corridor it takes in.
    const convertible = (x, y, self) => x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2 && clearOfOthers(x, y, self)
      && (grid[y][x] !== '#' || grid[y + 1][x] === '#');
    for (const i of fightOrder) {
      const r = rects[i];
      const sides = rng.chance(0.5) ? ['west', 'east'] : ['east', 'west'];
      let guard = 0;
      while (r.w < ROOM_TARGET.w && guard < 8) {
        guard += 1;
        let grew = false;
        for (const side of sides) {
          const cx = side === 'west' ? r.x - 1 : r.x + r.w;
          const column = [];
          for (let y = r.y; y < r.y + r.h; y += 1) column.push({ x: cx, y });
          if (!column.every((t) => convertible(t.x, t.y, i))) continue;
          for (const t of column) {
            if (grid[t.y][t.x] === '#') grid[t.y][t.x] = '.';
            owner[idx(t.x, t.y)] = i;
          }
          if (side === 'west') r.x -= 1;
          r.w += 1;
          grew = true;
          break;
        }
        if (!grew) break;
      }
      guard = 0;
      while (r.h < ROOM_TARGET.h && guard < 8) {
        guard += 1;
        const cy = r.y + r.h;
        const row = [];
        for (let x = r.x; x < r.x + r.w; x += 1) row.push({ x, y: cy });
        if (!row.every((t) => convertible(t.x, t.y, i))) break;
        for (const t of row) {
          if (grid[t.y][t.x] === '#') grid[t.y][t.x] = '.';
          owner[idx(t.x, t.y)] = i;
        }
        r.h += 1;
      }
    }
  }

  // ---------- what blocks, and the bush rule ----------
  const marks = [layout.stitch, layout.puzzle, ...(layout.loot || []), ...extraChests].filter(Boolean);
  // Objects that block and must keep a free side: each mark's object, the lead's footprint, the nook.
  const groups = [];
  if (leadFight) groups.push(footprint);
  else if (!cave) groups.push([B]);
  for (const m of marks) if (!(cave && m === layout.stitch)) groups.push([m]);
  const approachable = (reach) => groups.every((group) => {
    const own = new Set(group.map((t) => keyOf(t.x, t.y)));
    return group.some((t) => DIRS4.some(([dx, dy]) => {
      const nx = t.x + dx;
      const ny = t.y + dy;
      return !own.has(keyOf(nx, ny)) && inside(nx, ny) && reach.dist[idx(nx, ny)] >= 0;
    }));
  });
  let base = bfs(W, H, open, door);
  const tryBlock = (x, y) => {
    const k = keyOf(x, y);
    if (!open(x, y) || base.dist[idx(x, y)] < 0) return false;
    blocked.add(k);
    const next = bfs(W, H, open, door);
    if (next.count === base.count - 1 && approachable(next)) { base = next; return true; }
    blocked.delete(k);
    return false;
  };
  const nearMark = (x, y) => [door, B, ...marks].some((m) => m && Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) <= 1)
    || footprint.some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 1);
  // On, or straight in front of (4-beside), the door, a mark or the footprint.
  const nearMark4 = (x, y) => [door, B, ...marks].some((m) => m && Math.abs(m.x - x) + Math.abs(m.y - y) <= 1)
    || footprint.some((t) => Math.abs(t.x - x) + Math.abs(t.y - y) <= 1);

  // Mouths: open ground just outside a room's rect, 4-beside it, that leads away.
  const mouthsOf = (r) => {
    const out = [];
    const ring = [];
    for (let x = r.x; x < r.x + r.w; x += 1) ring.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
    for (let y = r.y; y < r.y + r.h; y += 1) ring.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
    for (const t of ring) if (inside(t.x, t.y) && grid[t.y][t.x] !== '#') out.push(t);
    return out;
  };
  const insideRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  // Tiles just inside a mouth stay clear, so no corridor is plugged from within.
  const mouthInner = (r) => {
    const set = new Set();
    for (const m of mouthsOf(r)) for (const [dx, dy] of DIRS4) if (insideRect(r, m.x + dx, m.y + dy)) set.add(keyOf(m.x + dx, m.y + dy));
    return set;
  };

  // The Tale-lead's room is a fight room too: it gets its dais roll and its props after the others,
  // on its own stream (hashInts(seed, 'arena', 'lead')), so no other room's rolls move.
  const leadRng = createRng(hashInts(spec.seed >>> 0, 'arena', 'lead'));
  const leadRooms = leadFight && leadIndex >= 0 ? [leadIndex] : [];
  const rngFor = (i) => (i === leadIndex && leadFight ? leadRng : rng);

  // ---------- dais ----------
  const heights = new Uint8Array(W * H);
  const stairs = new Set();
  const dais = new Set();
  for (const i of [...fightOrder, ...leadRooms]) {
    const rng = rngFor(i);
    if (!rng.chance(DAIS_SHARE)) continue;
    const r = rects[i];
    const first = rng.chance(0.5) ? [3, 2] : [2, 2];
    const inner = mouthInner(r);
    // The size it rolled, else a smaller one, so a cramped room still gets its step up; clear of
    // the room's walls where it can be, never in a mouth's way or beside a mark.
    for (const [dw, dh] of [first, [2, 2], [2, 1]]) {
      const spots = [];
      for (let y = r.y; y + dh <= r.y + r.h; y += 1) for (let x = r.x; x + dw <= r.x + r.w; x += 1) {
        const edge = x === r.x || y === r.y || x + dw === r.x + r.w || y + dh === r.y + r.h;
        spots.push({ x, y, edge });
      }
      const ordered = rng.shuffle(spots).sort((p, q) => p.edge - q.edge);
      let placed = false;
      for (const s of ordered) {
        const tiles = [];
        for (let y = s.y; y < s.y + dh; y += 1) for (let x = s.x; x < s.x + dw; x += 1) tiles.push({ x, y });
        if (!tiles.every((t) => grid[t.y][t.x] === '.' && open(t.x, t.y) && !nearMark(t.x, t.y) && !inner.has(keyOf(t.x, t.y)))) continue;
        for (const t of tiles) heights[idx(t.x, t.y)] = 1;
        const stair = { x: s.x + Math.floor(dw / 2), y: s.y + dh - 1 };
        stairs.add(keyOf(stair.x, stair.y));
        dais.add(i);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }

  // ---------- props ----------
  const props = [];
  const propAt = new Map();
  const roomGenre = new Map();
  for (const i of [...fightOrder, ...leadRooms]) {
    const rng = rngFor(i);
    const own = i === leadIndex && leadFight && GENRE_PROPS[spec.taleLead?.genre] ? spec.taleLead.genre : null;
    const genre = cave ? 'cave' : own || (spec.genres?.length ? spec.genres[rng.int(0, spec.genres.length - 1)] : 'cave');
    roomGenre.set(i, genre);
    const r = rects[i];
    const ids = [...(cave ? CAVE_PROPS : GENRE_PROPS[genre] || []), 'crate'];
    const inner = mouthInner(r);
    const tiles = [];
    for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) {
      if (grid[y][x] !== '.' || heights[idx(x, y)] || nearMark(x, y) || inner.has(keyOf(x, y))) continue;
      tiles.push({ x, y });
    }
    const want = rng.int(1, 3);
    let placed = 0;
    // Props stand apart, a tile clear of each other.
    const apart = (t, gap) => ![...propAt.keys()].some((k) => { const [px, py] = k.split(',').map(Number); return Math.max(Math.abs(px - t.x), Math.abs(py - t.y)) <= gap; });
    const stand = (t, state) => {
      const prop = { x: t.x, y: t.y, state, flags: [...(PROP_FLAGS[state] || ['cover-low'])] };
      props.push(prop);
      propAt.set(keyOf(t.x, t.y), prop);
      placed += 1;
    };
    for (const t of rng.shuffle(tiles)) {
      if (placed >= want) break;
      if (!apart(t, 1) || !tryBlock(t.x, t.y)) continue;
      stand(t, ids[rng.int(0, ids.length - 1)]);
    }
    // Every fight room gets its cover. A room too cramped for the usual spots (a small wet room,
    // or a lead's with its footprint in the middle) takes one where the rule is looser, step by
    // step: beside a mark or the footprint but never straight in front of one; then anywhere but
    // the doorway's ring; then up on its dais (never the stair); then just inside a mouth (never
    // the mouth itself). Floor or growth (a prop's tile grows nothing). The bush rule still keeps
    // every tile reached and every object a free side, so every approach stays open. No draws.
    if (!placed) {
      const doorRing = (x, y) => Math.max(Math.abs(x - door.x), Math.abs(y - door.y)) <= 1;
      const looser = [
        { tooNear: nearMark4, gap: 1, raised: false, mouth: false },
        { tooNear: doorRing, gap: 0, raised: false, mouth: false },
        { tooNear: doorRing, gap: 0, raised: true, mouth: false },
        { tooNear: doorRing, gap: 0, raised: true, mouth: true },
      ];
      for (const step of looser) {
        const more = [];
        for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) {
          const k = keyOf(x, y);
          if (grid[y][x] !== '.' && grid[y][x] !== '"') continue;
          if ((heights[idx(x, y)] && !step.raised) || stairs.has(k) || (inner.has(k) && !step.mouth) || step.tooNear(x, y)) continue;
          more.push({ x, y, h: hashInts(spec.seed >>> 0, x, y, 'prop') });
        }
        more.sort((a, b) => a.h - b.h);
        const t = more.find((c) => apart(c, step.gap) && tryBlock(c.x, c.y));
        if (t) { stand(t, ids[t.h % ids.length]); break; }
      }
    }
  }

  // ---------- the hearth-nook (open and gaping rifts) ----------
  let nook = null;
  if (!cave && stage !== 'hairline') {
    const rooms = rects.map((r, i) => ({ i, ...reachedIn(r) }))
      .filter((c) => !fightSet.has(c.i) && c.i !== leadIndex && rects[c.i].role !== 'entrance' && c.n > 0)
      .sort((a, b) => a.near - b.near || a.i - b.i);
    const entranceIndex = rects.findIndex((r) => r.role === 'entrance');
    const pickOrder = rooms.length ? [rooms[Math.floor(rooms.length / 2)], ...rooms.filter((_, k) => k !== Math.floor(rooms.length / 2))] : [];
    if (entranceIndex >= 0) pickOrder.push({ i: entranceIndex });
    for (const { i } of pickOrder) {
      const r = rects[i];
      const inner = mouthInner(r);
      const cx = r.x + (r.w >> 1);
      const cy = r.y + (r.h >> 1);
      const tiles = [];
      for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) {
        if (grid[y][x] !== '.' || nearMark(x, y) || inner.has(keyOf(x, y))) continue;
        tiles.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy), h: hashInts(spec.seed >>> 0, x, y, 'nook') });
      }
      tiles.sort((a, b) => a.d - b.d || a.h - b.h);
      const spot = tiles.find((t) => tryBlock(t.x, t.y));
      if (spot) {
        nook = { x: spot.x, y: spot.y };
        groups.push([nook]);
        break;
      }
    }
  }

  // ---------- arenas ----------
  const heightAt = (x, y) => (inside(x, y) ? heights[idx(x, y)] : 0);
  const solidAround = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (inside(nx, ny) && grid[ny][nx] !== '#') return false;
    }
    return true;
  };
  const blockers = new Set([...marks.filter((m) => !(cave && m === layout.stitch)).map((m) => keyOf(m.x, m.y))]);
  if (nook) blockers.add(keyOf(nook.x, nook.y));
  const cellAt = (x, y) => {
    if (!inside(x, y)) return ' ';
    const k = keyOf(x, y);
    if (footKeys.has(k)) return '.';
    const prop = propAt.get(k);
    if (prop) return prop.flags.includes('cover-high') ? 'O' : 'o';
    if (blockers.has(k)) return 'o';
    const ch = grid[y][x];
    if (ch === '#') return solidAround(x, y) ? ' ' : '#';
    if (ch === '~') return fords[idx(x, y)] === 1 ? '.' : '~';
    if (stairs.has(k)) return '=';
    return '.';
  };
  const walkCell = (x, y) => { const c = cellAt(x, y); return c === '.' || c === '='; };

  const cut = (rect, room, roomId, genre, isLead) => {
    const mouths = mouthsOf(room).filter((m) => insideRect(rect, m.x, m.y));
    const seed = hashInts(spec.seed >>> 0, roomId, 'arena');
    const light = ROOM_LIGHT[genre] || 'L';
    let cells = '';
    let height = '';
    for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      cells += cellAt(x, y);
      height += String(heightAt(x, y));
    }
    const entry = entryTiles(room, rect, mouths, { walkCell, plain: base, idx, inside, footKeys, isLead });
    return Object.freeze({
      rect: Object.freeze({ ...rect }),
      cells,
      height,
      light: light.repeat(rect.w * rect.h),
      mouths: Object.freeze(mouths.map((m) => Object.freeze({ x: m.x, y: m.y }))),
      entry: Object.freeze(entry.map((t) => Object.freeze({ x: t.x, y: t.y }))),
      seed,
    });
  };

  const roomRect = (r) => {
    // The room plus 2 tiles into each mouth: the tiles 1 and 2 steps out through open ground.
    let x0 = r.x;
    let y0 = r.y;
    let x1 = r.x + r.w - 1;
    let y1 = r.y + r.h - 1;
    const seen = new Set();
    let front = mouthsOf(r);
    for (let step = 1; step <= 2 && front.length; step += 1) {
      const next = [];
      for (const t of front) {
        const k = keyOf(t.x, t.y);
        if (seen.has(k)) continue;
        seen.add(k);
        x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y);
        if (step === 2) continue;
        for (const [dx, dy] of DIRS4) {
          const nx = t.x + dx;
          const ny = t.y + dy;
          if (!inside(nx, ny) || insideRect(r, nx, ny) || grid[ny][nx] === '#' || seen.has(keyOf(nx, ny))) continue;
          next.push({ x: nx, y: ny });
        }
      }
      front = next;
    }
    return clipRect({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, r, W, H);
  };

  const rooms = rects.map((r, i) => {
    const isLead = leadFight && i === leadIndex;
    const roomId = isLead ? 'lead' : `r${i}`;
    const fight = fightSet.has(i) || isLead;
    let arena = null;
    if (isLead) {
      const w = Math.min(LEAD_WINDOW.w, W);
      const h = Math.min(LEAD_WINDOW.h, H);
      const rect = { x: clamp(B.x - (LEAD_WINDOW.w >> 1), 0, W - w), y: clamp(B.y - (LEAD_WINDOW.h >> 1), 0, H - h), w, h };
      arena = cut(rect, r, roomId, spec.taleLead?.genre || spec.genres?.[0], true);
    } else if (fight || cave) {
      // A cave cuts every room's arena: a Mimic can wait in any chest.
      arena = cut(roomRect(r), r, roomId, roomGenre.get(i) || (cave ? 'cave' : spec.genres?.[0] || 'cave'), false);
    }
    return Object.freeze({
      roomId, role: r.role, rect: Object.freeze({ x: r.x, y: r.y, w: r.w, h: r.h }), fight, arena, dais: dais.has(i),
    });
  });
  const leadRoom = rooms.find((room) => room.roomId === 'lead') || null;

  const out = {
    ...layout,
    rows: grid.map((row) => row.join('')),
    roomRects: (layout.roomRects || []).map((r, i) => Object.freeze({ ...r, x: rects[i].x, y: rects[i].y, w: rects[i].w, h: rects[i].h })),
  };
  let heightText = '';
  for (let i = 0; i < W * H; i += 1) heightText += String(heights[i]);
  return Object.freeze({
    layout: out,
    rooms: Object.freeze(rooms),
    props: Object.freeze(props.map((p) => Object.freeze({ ...p, flags: Object.freeze(p.flags) }))),
    heights: heightText,
    nook: nook ? Object.freeze(nook) : null,
    lead: leadRoom ? Object.freeze({ footprint: Object.freeze(footprint.map((t) => Object.freeze(t))), arena: leadRoom.arena }) : null,
    chests: Object.freeze(extraChests.map((t) => Object.freeze(t))),
  });
}

/** Clip a rect to at most ARENA_MAX, keeping the room inside it, and to the scene. */
function clipRect(rect, room, W, H) {
  let { x, y, w, h } = rect;
  if (w > ARENA_MAX.w) {
    const spare = ARENA_MAX.w - room.w;
    x = Math.max(x, room.x - Math.floor(spare / 2));
    w = ARENA_MAX.w;
  }
  if (h > ARENA_MAX.h) {
    const spare = ARENA_MAX.h - room.h;
    y = Math.max(y, room.y - Math.floor(spare / 2));
    h = ARENA_MAX.h;
  }
  x = clamp(x, 0, Math.max(0, W - w));
  y = clamp(y, 0, Math.max(0, H - h));
  return { x, y, w: Math.min(w, W), h: Math.min(h, H) };
}

/**
 * The party's four start tiles, in formation order (Milo first): just inside the mouth nearest the
 * way in (by the plain scene's walk from the door), spreading back through the room; then the
 * mouth itself and the corridor if the room is too cramped.
 */
function entryTiles(room, rect, mouths, { walkCell, plain, idx, inside, footKeys, isLead }) {
  const inRoom = (x, y) => x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h;
  const inRect = (x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
  const ok = (x, y) => inside(x, y) && walkCell(x, y) && !(isLead && footKeys.has(keyOf(x, y)));
  const dist = (t) => (inside(t.x, t.y) ? plain.dist[idx(t.x, t.y)] : -1);
  const ranked = [...mouths].sort((a, b) => {
    const da = dist(a) < 0 ? Infinity : dist(a);
    const db = dist(b) < 0 ? Infinity : dist(b);
    return da - db || a.y - b.y || a.x - b.x;
  });
  const out = [];
  const seen = new Set();
  const take = (t) => { if (out.length < 4 && ok(t.x, t.y) && !seen.has(keyOf(t.x, t.y))) { seen.add(keyOf(t.x, t.y)); out.push(t); } };
  const mouth = ranked[0] || null;
  // Breadth-first from the mouth into the room, then anywhere in the rect.
  const walk = (starts, allowed) => {
    const queue = [...starts];
    const visited = new Set(starts.map((t) => keyOf(t.x, t.y)));
    for (let head = 0; head < queue.length && out.length < 4; head += 1) {
      const t = queue[head];
      if (allowed(t.x, t.y)) take(t);
      for (const [dx, dy] of DIRS4) {
        const nx = t.x + dx;
        const ny = t.y + dy;
        const k = keyOf(nx, ny);
        if (visited.has(k) || !inRect(nx, ny) || !ok(nx, ny)) continue;
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  };
  if (mouth) {
    const starts = DIRS4.map(([dx, dy]) => ({ x: mouth.x + dx, y: mouth.y + dy })).filter((t) => inRoom(t.x, t.y) && ok(t.x, t.y));
    walk(starts, inRoom);
    if (out.length < 4) walk([mouth], () => true);
  }
  if (out.length < 4) {
    const all = [];
    for (let y = room.y; y < room.y + room.h; y += 1) for (let x = room.x; x < room.x + room.w; x += 1) if (ok(x, y)) all.push({ x, y });
    walk(all.slice(0, 1), () => true);
    for (const t of all) take(t);
  }
  return out;
}

/** Breadth-first steps from `from` over open tiles: { dist: Int32Array (-1 unreached), count }. */
export function bfs(W, H, open, from) {
  const dist = new Int32Array(W * H).fill(-1);
  if (!open(from.x, from.y)) return { dist, count: 0 };
  const queue = [from.y * W + from.x];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] >= 0 || !open(nx, ny)) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return { dist, count: queue.length };
}

/** An arena tile's words (§5.1): the column letter from rect.x and the row number from rect.y. */
export function tileWords(arena, x, y) {
  const col = x - arena.rect.x;
  const row = y - arena.rect.y;
  if (col < 0 || row < 0 || col >= arena.rect.w || row >= arena.rect.h) return null;
  return `${String.fromCharCode(97 + col)}${row + 1}`;
}
