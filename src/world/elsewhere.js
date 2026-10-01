// The Elsewhere behind a rift (CONTRACT-PHASE3.md §7.3, RIFTS.md §3 and §10.2): a small pocket
// world built from riftgen.layout(spec). Stone rooms in 3/4 view floating in the space between
// the pages, floors in the genre's ground colours, water, growth, the way home, the seam to
// stitch, the Tale-lead, loot, a curio and wandering strays. Pure: the ground is palette key
// codes, recoloured by the genre (2x2-interleaved in a fusion or a Maelstrom) by the engine.
import { createRng, hashInts, unit } from './rng.js';
import { genreIndex, leadSprite, makeWanderer, paletteByCode } from './riftfx.js';
import { PALETTE } from './sprites.js';
import { leadDisplayName } from './leadname.js';

const TILE = 16;
const FEET = 13;
const VOID = 0;
const WALL = 1;
const FLOOR = 2;
const WATER = 3;
const FOLIAGE = 4;
const CELL_NAMES = ['void', 'wall', 'floor', 'water', 'foliage'];
const FACE_H = 9; // a wall's front face, in px, at the bottom of its tile
const MAX_STRAYS = 5; // as in the wilds (CONTRACT-PHASE3.md §7.2): up to 2 of a kind, 5 per rift
const K = Object.fromEntries([...'oscSzgGhjqlLMwWfuUYeEN'].map((ch) => [ch, ch.charCodeAt(0)]));
const mod = (n, m) => ((n % m) + m) % m;
const keyOf = (x, y) => `${x},${y}`;
const DIRS4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
// Reeds and bushes are scenery, not things to click: no label, and their own tile as approach so
// every object has the same shape.
const SCENERY = (x, y) => ({ scenery: true, label: null, approach: { x, y } });
const STEP_OUT = [[0, 1, 'down'], [1, 0, 'right'], [-1, 0, 'left'], [0, -1, 'up']];

function smoothNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = unit(hashInts(gx, gy, seed));
  const b = unit(hashInts(gx + 1, gy, seed));
  const c = unit(hashInts(gx, gy + 1, seed));
  const d = unit(hashInts(gx + 1, gy + 1, seed));
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---------- cells ----------

function readCells(layout) {
  const W = layout.w;
  const H = layout.h;
  const raw = layout.rows;
  const cells = new Uint8Array(W * H);
  const solid = (x, y) => x < 0 || y < 0 || x >= W || y >= H || raw[y][x] === '#';
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const ch = raw[y][x];
      if (ch === '#') {
        let open = false;
        for (let dy = -1; dy <= 1 && !open; dy += 1) for (let dx = -1; dx <= 1 && !open; dx += 1) if (!solid(x + dx, y + dy)) open = true;
        cells[y * W + x] = open ? WALL : VOID;
      } else cells[y * W + x] = ch === '~' ? WATER : ch === '"' ? FOLIAGE : FLOOR;
    }
  }
  return cells;
}

/**
 * Stepping stones: where water stands between the way in and something Milo needs to reach (the
 * seam, the Tale-lead, loot, the curio), the fewest water tiles that join them become a ford (a
 * 0-1 search: land costs 0, water 1, and the marked tiles themselves can't be walked through).
 * Each mark is joined at its best neighbour, where Milo will stand. Dry patches cut off by water
 * elsewhere stay cut off.
 */
function findFords(cells, W, H, from, marks) {
  const fords = new Uint8Array(W * H);
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const markSet = new Set(marks.map((m) => m.y * W + m.x));
  const start = from.y * W + from.x;
  const back = [start];
  const front = []; // cost-0 steps jump the queue
  let head = 0;
  dist[start] = 0;
  while (head < back.length || front.length) {
    const i = front.length ? front.pop() : back[head++];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const c = cells[j];
      if (c === WALL || c === VOID || markSet.has(j)) continue;
      const cost = c === WATER ? 1 : 0;
      const nd = dist[i] + cost;
      if (dist[j] >= 0 && dist[j] <= nd) continue;
      dist[j] = nd;
      prev[j] = i;
      if (cost === 0) front.push(j);
      else back.push(j);
    }
  }
  for (const mark of marks) {
    let best = -1;
    for (const [dx, dy] of DIRS4) {
      const nx = mark.x + dx;
      const ny = mark.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] >= 0 && (best < 0 || dist[j] < dist[best])) best = j;
    }
    for (let j = best; j >= 0 && dist[j] > 0; j = prev[j]) {
      if (cells[j] === WATER) {
        if (fords[j]) break;
        fords[j] = 1;
      }
    }
  }
  return fords;
}

function bfsFrom(W, H, open, from) {
  const dist = new Int32Array(W * H).fill(-1);
  if (!open(from.x, from.y)) return dist;
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
  return dist;
}

// ---------- the scene ----------

/**
 * Build the Elsewhere for a rift spec from its layout (riftgen.layout(spec)).
 * options: { genres (genres.json content), kind ('real' | 'story' | 'wild', else from the spec;
 * a key starting 'story:' is the story rift), words (riftgen.json, for the Tale-lead's look) }.
 * → { riftId, name, depth, kind, w, h, width, height (px), tileSize, cellAt(x, y), walkable(x, y),
 *     isFord(x, y), ground (lazy Uint8Array of key codes, width × height), palettes: [genreId...],
 *     genreAt(px, py) → genreId, genreIndexAt(px, py) → index into palettes, rgba(base) → the
 *     ground in colour, objects, strays, spawn: { x, y, dir } }
 * Milo arrives at spawn, a step out of the doorway at E (south of it when that's open, facing
 * away from the door), so the way home stands behind him; the exit object is at E itself.
 * A fusion or Maelstrom is a patchwork: each genre holds patches of the scene, and their palettes
 * interleave in 2x2 blocks along the seams (genreIndexAt, the ground's); genreAt says which genre
 * dresses a sprite standing at a pixel: its tile's owner, the genre most of that tile's ground is
 * in, so a sprite on a seam is dressed whole and agrees with the ground round its feet.
 * Objects: { id, kind: 'exit' | 'stitch' | 'tale-lead' | 'loot' | 'curio' | 'foliage', x, y,
 *   w: 1, h: 1, dx, dy, blocks, sprite, label, approach: { x, y }, ... }; the exit is drawn in the
 *   Hushlands' own colours (native: true); the stitch carries refused (true for a real rift: its
 *   seam won't take the thread) and the Tale-lead its sprite, drawn at scale 2.
 *   Every object has an approach tile (a free neighbour Milo can walk to, or its own tile when
 *   it's walked into, like the exit). Foliage (reeds, and bushes that block) is scenery:
 *   scenery: true, label: null and approach its own tile; it isn't an entity to click or hover.
 *   The others (exit, stitch, tale-lead, loot, curio) always have a calm label.
 * Strays are riftfx stray actors in scene coordinates, up to 2 of a kind and 5 in all; a
 *   Maelstrom's council (lead: true, council: true) stands still beside its Tale-lead.
 *
 * Phase 4 (CONTRACT-PHASE4.md §7.3), all opt-in, so with no options the scene is Phase 3's:
 *   hooks  the lead names leads.json tags as planned hooks; the tale-lead object's name and label
 *          are leadDisplayName's, clear of the company's names (the only change without `fight`).
 *   kind   'cave' places no stitch and no Tale-lead.
 *   fight  { plan: ArenaPlan (arena.js), encounters: Encounters | null } builds on the arena pass's
 *          widened layout: it paints the dais heights, stands the genre props as blocking scenery
 *          (kind 'prop'), adds the hearth-nook (kind 'nook', clickable) and a cave's added chests
 *          (plan.chests, as `loot:<n>` after the layout's own), makes the Tale-lead block
 *          its 2×2 footprint with its approach beside it, and keeps foliage inside every fight
 *          arena as reeds, never bushes, so the ground the fight uses is the ground drawn. With
 *          encounters it also sets scene.encounters (the rooms) and gives encounters.chests'
 *          loot objects `locked` and `mimic`. scene.strays is never touched.
 */
export function buildElsewhere(spec, layout, { genres, kind = null, words, hooks = [], fight = null } = {}) {
  const W = layout.w;
  const H = layout.h;
  const index = genreIndex(genres);
  const palettes = (spec.genres || []).filter((id) => index.has(id));
  const seed = hashInts(spec.seed >>> 0, 'elsewhere');
  const rng = createRng(seed);
  const cells = readCells(layout);
  const door = { x: layout.entrance.x, y: layout.entrance.y }; // E, where the way home stands
  // The layout's blocking marks: the seam, the Tale-lead, loot and the curio.
  const marks = [layout.stitch, layout.boss, layout.puzzle, ...(layout.loot || [])].filter(Boolean);
  // A fight-ready scene's Tale-lead blocks its whole footprint, so no stepping stone runs under it.
  const plannedLead = kind !== 'cave' && spec.taleLead && fight?.plan?.lead ? fight.plan.lead.footprint : [];
  const fords = findFords(cells, W, H, door, [...marks, ...plannedLead.filter((t) => !(t.x === layout.boss.x && t.y === layout.boss.y))]);
  const cell = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? VOID : cells[y * W + x]);
  const isFord = (x, y) => x >= 0 && y >= 0 && x < W && y < H && fords[y * W + x] === 1;
  const ground = (x, y) => {
    const c = cell(x, y);
    return c === FLOOR || c === FOLIAGE || (c === WATER && isFord(x, y));
  };
  const blocked = new Set();
  const open = (x, y) => ground(x, y) && !blocked.has(keyOf(x, y));
  const riftKind = kind || (String(spec.key || '').startsWith('story:') ? 'story' : spec.kind || 'wild');
  const refused = riftKind === 'real';
  const cave = riftKind === 'cave';
  const plan = fight?.plan || null;
  const encounters = fight?.encounters || null;

  // ---------- objects at the layout's marks ----------
  const objects = [];
  const place = (object) => {
    const out = { w: 1, h: 1, dx: 0, dy: 0, blocks: false, ...object };
    objects.push(out);
    if (out.blocks) blocked.add(keyOf(out.x, out.y));
    return out;
  };
  // The way home stands in the entrance, a step behind where Milo arrives.
  place({ id: 'exit', kind: 'exit', x: door.x, y: door.y, dy: -5, sprite: 'exit.door', native: true, label: 'The way home' });
  const lead = cave ? null : spec.taleLead || null;
  const shown = lead ? leadDisplayName(spec, words, { hooks }) : null;
  // In a fight-ready Elsewhere the Tale-lead stands on its 2×2 footprint (B.x−1..B.x, B.y−1..B.y).
  const footprint = lead && plan?.lead ? plan.lead.footprint : null;
  if (lead) {
    const { sprite, archetype } = leadSprite(spec, { words });
    const object = place({
      // Drawn at 2x, it stands a little back from the seam beside it (dx).
      id: 'tale-lead', kind: 'tale-lead', x: layout.boss.x, y: layout.boss.y, dx: -6, blocks: true,
      name: shown, line: lead.line, mechanic: lead.mechanic, genre: lead.genre, council: lead.council || null,
      archetype, sprite, scale: 2, feet: { x: 10, y: lowestRow(sprite.rows) }, label: shown,
    });
    if (footprint) {
      object.footprint = footprint.map((t) => ({ x: t.x, y: t.y }));
      for (const t of footprint) blocked.add(keyOf(t.x, t.y));
    }
  }
  if (!cave) {
    place({
      id: 'stitch', kind: 'stitch', x: layout.stitch.x, y: layout.stitch.y, blocks: true, sprite: 'tear',
      stage: spec.stage, genre: spec.genres?.[0] || null, refused,
      label: refused ? 'The seam, holding for now' : 'The seam · stitch it',
    });
  }
  (layout.loot || []).forEach((spot, n) => {
    place({ id: `loot:${n}`, kind: 'loot', x: spot.x, y: spot.y, blocks: true, sprite: 'chest', label: 'A chest' });
  });
  if (layout.puzzle) place({ id: 'curio', kind: 'curio', x: layout.puzzle.x, y: layout.puzzle.y, blocks: true, sprite: 'curio', label: 'A curio' });
  if (plan) {
    // A cave's added chests (the arena pass's plan.chests), numbered after the layout's own loot.
    (plan.chests || []).forEach((spot, i) => {
      place({ id: `loot:${(layout.loot || []).length + i}`, kind: 'loot', x: spot.x, y: spot.y, blocks: true, sprite: 'chest', label: 'A chest' });
    });
    if (plan.nook) place({ id: 'nook', kind: 'nook', x: plan.nook.x, y: plan.nook.y, blocks: true, sprite: 'hearth-nook', label: 'Hearth-nook · rest here' });
    for (const prop of plan.props || []) {
      place({ id: `prop:${prop.x},${prop.y}`, kind: 'prop', x: prop.x, y: prop.y, blocks: true, sprite: prop.state, state: prop.state, flags: [...prop.flags], ...SCENERY(prop.x, prop.y) });
    }
  }
  if (encounters) {
    for (const chest of encounters.chests || []) {
      const known = objects.find((o) => o.id === chest.id);
      const flags = { locked: Boolean(chest.locked), mimic: chest.mimic || null };
      if (known) Object.assign(known, flags, chest.locked ? { label: 'A locked chest' } : {});
      else place({ id: chest.id, kind: 'loot', x: chest.x, y: chest.y, blocks: true, sprite: 'chest', label: chest.locked ? 'A locked chest' : 'A chest', ...flags });
    }
  }

  // Each object is reached from a free neighbour (south first, so Milo faces up at it); the
  // Tale-lead on its footprint from a free tile beside the footprint.
  let reach = bfsFrom(W, H, open, door);
  for (const object of objects) {
    if (object.scenery) continue;
    if (!object.blocks) { object.approach = { x: object.x, y: object.y }; continue; }
    const around = object.footprint ? besideFootprint(object.footprint) : DIRS4.map(([dx, dy]) => ({ x: object.x + dx, y: object.y + dy }));
    const options = around.filter((t) => open(t.x, t.y));
    const reached = options.filter((t) => reach[t.y * W + t.x] >= 0);
    let approach = reached[0] || null;
    if (!approach) {
      // Boxed in: it stops blocking rather than become unreachable.
      object.blocks = false;
      blocked.delete(keyOf(object.x, object.y));
      for (const t of object.footprint || []) blocked.delete(keyOf(t.x, t.y));
      reach = bfsFrom(W, H, open, door);
      approach = { x: object.x, y: object.y };
    }
    object.approach = approach;
  }

  // Milo arrives a step out of the doorway, so the door stands behind him: south first (he's
  // walked out toward us), then the sides, and in the doorway itself only when it's boxed in.
  const out = STEP_OUT.find(([dx, dy]) => open(door.x + dx, door.y + dy) && reach[(door.y + dy) * W + door.x + dx] >= 0);
  const spawn = out ? { x: door.x + out[0], y: door.y + out[1], dir: out[2] } : { x: door.x, y: door.y, dir: 'down' };

  // ---------- growth: reeds everywhere, bushes where they don't cut anything off ----------
  const keep = new Set(objects.flatMap((o) => [keyOf(o.x, o.y), keyOf(o.approach.x, o.approach.y)]));
  for (const at of [door, spawn]) for (let y = at.y - 1; y <= at.y + 1; y += 1) for (let x = at.x - 1; x <= at.x + 1; x += 1) keep.add(keyOf(x, y));
  for (const t of footprint || []) keep.add(keyOf(t.x, t.y));
  // Inside a fight arena, growth is reeds (a foliage surface in the fight), never a bush.
  const arenaRects = plan ? plan.rooms.filter((room) => room.arena).map((room) => room.arena.rect) : [];
  const inArena = (x, y) => arenaRects.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  let reachable = countTrue(reach);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (cells[y * W + x] !== FOLIAGE || keep.has(keyOf(x, y))) continue;
      const roll = unit(hashInts(seed, x, y, 'growth'));
      const jitter = { dx: Math.round((unit(hashInts(seed, x, y, 'jx')) - 0.5) * 6), dy: Math.round((unit(hashInts(seed, x, y, 'jy')) - 0.5) * 3) };
      if (roll < 0.34 && !(plan && inArena(x, y))) {
        blocked.add(keyOf(x, y));
        const next = bfsFrom(W, H, open, door);
        if (countTrue(next) === reachable - 1) {
          reach = next;
          reachable -= 1;
          place({ id: `foliage:${x},${y}`, kind: 'foliage', x, y, ...jitter, blocks: true, sprite: 'bush', ...SCENERY(x, y) });
          blocked.add(keyOf(x, y));
          continue;
        }
        blocked.delete(keyOf(x, y));
      }
      place({ id: `foliage:${x},${y}`, kind: 'foliage', x, y, ...jitter, blocks: false, sprite: 'reeds', ...SCENERY(x, y) });
    }
  }

  // ---------- strays ----------
  const occupied = new Set(objects.filter((o) => o.kind !== 'foliage' || o.blocks).map((o) => keyOf(o.x, o.y)));
  occupied.add(keyOf(door.x, door.y));
  occupied.add(keyOf(spawn.x, spawn.y));
  const roamable = (x, y) => open(x, y) && !occupied.has(keyOf(x, y));
  const candidates = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = reach[y * W + x];
      if (d >= 5 && roamable(x, y) && cells[y * W + x] !== WATER) candidates.push({ x, y });
    }
  }
  const wanted = [];
  for (const kindOf of spec.strays || []) for (let n = 0; n < Math.min(2, Math.max(0, kindOf.count | 0)); n += 1) wanted.push(kindOf);
  const chosen = wanted.slice(0, MAX_STRAYS);
  const homes = [];
  const order = rng.shuffle(candidates);
  for (const gap of [5, 3, 1]) {
    for (const tile of order) {
      if (homes.length >= chosen.length) break;
      if (homes.every((h) => Math.abs(h.x - tile.x) + Math.abs(h.y - tile.y) >= gap)) homes.push(tile);
    }
  }
  const strays = chosen.slice(0, homes.length).map((stray, n) => {
    const home = homes[n];
    const allowed = new Set();
    for (let y = home.y - 3; y <= home.y + 3; y += 1) {
      for (let x = home.x - 3; x <= home.x + 3; x += 1) {
        if (Math.hypot(x - home.x, y - home.y) <= 3.2 && roamable(x, y)) allowed.add(keyOf(x, y));
      }
    }
    const wander = makeWanderer({ home, allowed, seed: hashInts(seed, n, 'stray') });
    return {
      id: `stray:${spec.id}:${n}`,
      name: stray.name,
      temperament: stray.temperament,
      genre: stray.genre,
      second: stray.second || null,
      archetype: stray.archetype,
      sprite: stray.sprite,
      feet: { x: 10, y: lowestRow(stray.sprite.rows) },
      hover: ['floater', 'flier', 'ghost'].includes(stray.archetype),
      home,
      speed: wander.speed,
      scale: 1,
      positionAt: wander.positionAt,
    };
  });

  // ---------- a Maelstrom's council, standing by its Tale-lead ----------
  if (lead?.council?.length) {
    const taken = new Set([...occupied, ...objects.filter((o) => o.blocks && o.approach).map((o) => keyOf(o.approach.x, o.approach.y)), ...strays.map((s) => keyOf(s.home.x, s.home.y))]);
    const bx = layout.boss.x;
    const by = layout.boss.y;
    // Clear of the Tale-lead's 2x sprite (about a tile and a quarter each side) and of the seam.
    const around = [[-2, 0], [2, 1], [-2, 1], [3, 0], [-1, 1], [3, 1], [-2, -1], [3, -1], [-3, 0], [1, 1], [0, 1]];
    const spots = around.map(([dx, dy]) => ({ x: bx + dx, y: by + dy })).filter((t) => roamable(t.x, t.y) && !taken.has(keyOf(t.x, t.y)) && reach[t.y * W + t.x] >= 0);
    lead.council.forEach((name, k) => {
      const genre = spec.genres[k + 1];
      const spot = spots[k];
      if (!genre || !spot) return;
      const look = leadSprite({ ...spec, genres: [genre], taleLead: { ...lead, genre } }, { words });
      const feet = { x: spot.x * TILE + 8, y: spot.y * TILE + FEET };
      const facing = spot.x < bx ? 'right' : spot.x > bx + 1 ? 'left' : 'down';
      strays.push({
        id: `stray:${spec.id}:${strays.length}`,
        name, temperament: 'proud', genre, second: null, archetype: look.archetype, sprite: look.sprite,
        feet: { x: 10, y: lowestRow(look.sprite.rows) }, hover: ['floater', 'flier', 'ghost'].includes(look.archetype),
        home: spot, speed: 0, scale: 1, lead: true, council: true,
        positionAt: () => ({ x: feet.x, y: feet.y, dir: facing, moving: false }),
      });
    });
  }

  // ---------- colour ----------
  const width = W * TILE;
  const height = H * TILE;
  const codes = palettes.map((id) => paletteByCode(index.get(id)));
  let mapCache = null;
  const genreMap = () => {
    if (!mapCache) mapCache = patchwork(W, H, palettes.length, seed);
    return mapCache;
  };
  const BW = W * (TILE >> 1);
  /** Index into palettes of the genre colouring scene pixel (px, py); -1 with no genre. */
  const genreIndexAt = (px, py) => {
    if (!palettes.length) return -1;
    if (palettes.length === 1) return 0;
    const bx = Math.min(BW - 1, Math.max(0, Math.floor(px) >> 1));
    const by = Math.min(H * (TILE >> 1) - 1, Math.max(0, Math.floor(py) >> 1));
    return genreMap()[by * BW + bx];
  };
  // Which genre owns each tile: the one most of its 2x2 blocks are in (ties go to the block at the
  // tile's centre, then the first genre). A sprite is dressed by its foot tile's owner, whole, so
  // one standing or walking on a seam never takes its colours from a single dithered block.
  let owners = null;
  const TB = TILE >> 1; // blocks a tile side
  const ownerIndexAt = (px, py) => {
    if (!palettes.length) return -1;
    if (palettes.length === 1) return 0;
    const tx = Math.min(W - 1, Math.max(0, Math.floor(Math.floor(px) / TILE)));
    const ty = Math.min(H - 1, Math.max(0, Math.floor(Math.floor(py) / TILE)));
    if (!owners) owners = new Int8Array(W * H).fill(-1);
    let g = owners[ty * W + tx];
    if (g < 0) {
      const map = genreMap();
      const counts = new Array(palettes.length).fill(0);
      for (let by = ty * TB; by < ty * TB + TB; by += 1) for (let bx = tx * TB; bx < tx * TB + TB; bx += 1) counts[map[by * BW + bx]] += 1;
      const middle = map[(ty * TB + TB / 2) * BW + tx * TB + TB / 2];
      g = middle;
      for (let i = 0; i < counts.length; i += 1) if (counts[i] > counts[g]) g = i;
      owners[ty * W + tx] = g;
    }
    return g;
  };

  let groundCache = null;
  const scene = {
    riftId: spec.id,
    name: spec.name,
    depth: spec.depth || 1,
    kind: riftKind,
    w: W,
    h: H,
    width,
    height,
    tileSize: TILE,
    cellAt: (x, y) => CELL_NAMES[cell(x, y)],
    walkable: (x, y) => Number.isInteger(x) && Number.isInteger(y) && open(x, y),
    isFord,
    get ground() {
      if (!groundCache) groundCache = paintGround({ cells, fords, W, H, seed, ...(plan ? raised(plan, W, H) : {}) });
      return groundCache;
    },
    palettes,
    /**
     * The genre id to dress a sprite whose feet are at scene pixel (px, py) in: the genre that owns
     * that tile (most of its ground), so a sprite on a seam wears one genre whole, and its colours
     * change only as it steps from tile to tile. The ground's own pixels are genreIndexAt's.
     */
    genreAt: (px, py) => palettes[ownerIndexAt(px, py)] ?? null,
    /** Index into palettes of the genre colouring the ground at scene pixel (px, py) (2x2 blocks, interleaved along the seams); -1 with no genre. */
    genreIndexAt,
    /**
     * The ground in colour: every key in its genre's palette (base colours where a genre has no
     * such key), as RGBA width × height. base: key code → [r, g, b] (wildsart.basePaletteByCode()).
     */
    rgba(base = BASE_CODES) {
      const keys = scene.ground;
      const out = new Uint8ClampedArray(width * height * 4);
      for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
          const p = py * width + px;
          const code = keys[p];
          if (!code) continue;
          const g = genreIndexAt(px, py);
          const rgb = (g >= 0 && codes[g][code]) || base[code];
          if (!rgb) continue;
          out[p * 4] = rgb[0];
          out[p * 4 + 1] = rgb[1];
          out[p * 4 + 2] = rgb[2];
          out[p * 4 + 3] = 255;
        }
      }
      return out;
    },
    objects,
    strays,
    spawn,
  };
  if (encounters) scene.encounters = encounters.rooms;
  return scene;
}

/**
 * The stepping stones buildElsewhere lays for this layout (1 where water is a ford), with extra
 * marks that no ford may run under and that must be reachable beside: a fight-ready scene passes
 * the Tale-lead's footprint. The arena pass reads this so its idea of open ground is the scene's.
 */
export function fightFords(layout, extraMarks = []) {
  const cells = readCells(layout);
  const marks = [layout.stitch, layout.boss, layout.puzzle, ...(layout.loot || []), ...extraMarks].filter(Boolean);
  return findFords(cells, layout.w, layout.h, { x: layout.entrance.x, y: layout.entrance.y }, marks);
}

// The free tiles beside a 2×2 footprint, the way in first: south of B, then round.
function besideFootprint(footprint) {
  const xs = footprint.map((t) => t.x);
  const ys = footprint.map((t) => t.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return [
    { x: x1, y: y1 + 1 }, { x: x0, y: y1 + 1 },
    { x: x0 - 1, y: y1 }, { x: x0 - 1, y: y0 },
    { x: x0, y: y0 - 1 }, { x: x1, y: y0 - 1 },
    { x: x1 + 1, y: y0 }, { x: x1 + 1, y: y1 },
  ];
}

// The arena pass's heights and stairs, for the ground painter.
function raised(plan, W, H) {
  const heights = typeof plan.heights === 'string' && plan.heights.length === W * H ? plan.heights : null;
  const stairs = new Set();
  for (const room of plan.rooms || []) {
    const arena = room.arena;
    if (!arena) continue;
    for (let i = 0; i < arena.cells.length; i += 1) {
      if (arena.cells[i] !== '=') continue;
      stairs.add(keyOf(arena.rect.x + (i % arena.rect.w), arena.rect.y + Math.floor(i / arena.rect.w)));
    }
  }
  return { heights, stairs };
}

const BASE_CODES = (() => {
  const out = [];
  for (const [key, { hex }] of Object.entries(PALETTE)) {
    if (hex.startsWith('#')) out[key.charCodeAt(0)] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
})();

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const PATCH = 7 * TILE; // a patch of one story is about seven tiles across
const SEAM = 20; // px either side of a seam where the stories interleave

/**
 * A fusion's or Maelstrom's patchwork: each genre holds patches of the scene (a warped Voronoi of
 * seeds about PATCH apart, every genre given at least one), and where two patches meet their
 * palettes interleave in 2x2 blocks, densest at the seam. One genre index per 2x2 block.
 */
function patchwork(W, H, count, seed) {
  const BW = W * (TILE >> 1);
  const BH = H * (TILE >> 1);
  const map = new Uint8Array(BW * BH);
  if (count <= 1) return map;
  const width = W * TILE;
  const height = H * TILE;
  const GX = Math.ceil(width / PATCH) + 1;
  const GY = Math.ceil(height / PATCH) + 1;
  const points = [];
  for (let gy = 0; gy < GY; gy += 1) {
    for (let gx = 0; gx < GX; gx += 1) {
      const h = hashInts(seed, gx, gy, 'patch');
      points.push({ x: (gx + 0.15 + unit(h) * 0.7) * PATCH, y: (gy + 0.15 + unit(hashInts(h, 1)) * 0.7) * PATCH, g: 0 });
    }
  }
  // Every genre gets patches: deal them out in a seeded order, round and round.
  const order = createRng(hashInts(seed, 'deal')).shuffle(points.map((_, i) => i));
  order.forEach((i, k) => { points[i].g = k % count; });
  for (let by = 0; by < BH; by += 1) {
    for (let bx = 0; bx < BW; bx += 1) {
      const px = bx * 2 + 1;
      const py = by * 2 + 1;
      // Warp the lookup so seams wander instead of running straight.
      const wx = px + (smoothNoise(px, py, 48, seed + 21) - 0.5) * 56;
      const wy = py + (smoothNoise(px, py, 48, seed + 22) - 0.5) * 56;
      const cx = Math.floor(wx / PATCH);
      const cy = Math.floor(wy / PATCH);
      let d1 = Infinity;
      let d2 = Infinity;
      let g1 = 0;
      let g2 = 0;
      for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
        if (gy < 0 || gy >= GY) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
          if (gx < 0 || gx >= GX) continue;
          const p = points[gy * GX + gx];
          const d = Math.hypot(wx - p.x, wy - p.y);
          if (d < d1) { d2 = d1; g2 = g1; d1 = d; g1 = p.g; } else if (d < d2 && p.g !== g1) { d2 = d; g2 = p.g; }
        }
      }
      let g = g1;
      if (g2 !== g1 && Number.isFinite(d2)) {
        // Across the seam: half and half at the line, thinning to none SEAM px away.
        const t = Math.min(1, (d2 - d1) / (2 * SEAM));
        if ((BAYER[by & 3][bx & 3] + 0.5) / 16 > 0.5 + t / 2) g = g2;
      }
      map[by * BW + bx] = g;
    }
  }
  return map;
}

function lowestRow(rows) {
  let y = rows.length - 1;
  while (y > 0 && !/[^.]/.test(rows[y])) y -= 1;
  return y;
}

function countTrue(dist) {
  let n = 0;
  for (let i = 0; i < dist.length; i += 1) if (dist[i] >= 0) n += 1;
  return n;
}

// ---------- the ground painter ----------

/**
 * Paint the scene in palette key codes, one per art pixel (W*16 × H*16):
 *   walls   3/4-view stone blocks: a lighter top face (s), a brick front face (S, z mortar) where
 *           the tile below is open, ink outlines (o), and the genre's lamps (u, U) on some faces;
 *   floors  the genre's ground keys (g, j) in smooth patches, laid as flagstones in a running bond
 *           with worn G grout, a light edge (h) here and there, pebbles and a shadow under walls;
 *   water   w, deepening to W, with f foam at the banks, rounded where it meets the floor, and
 *           stepping stones on a ford;
 *   growth  moss (l, q, L) under the reeds and bushes;
 *   void    the space between pages: ink with the odd faint star.
 * A fight-ready Elsewhere also passes the arena pass's heights (w*h '0'–'2') and stairs (a Set of
 * 'x,y'): a raised tile gets a lit lip where it rises and a short brick face where it drops, and a
 * stair tile its treads. Without them the ground is exactly Phase 3's.
 */
export function paintGround({ cells, fords, W, H, seed, heights = null, stairs = null }) {
  const PW = W * TILE;
  const PH = H * TILE;
  const out = new Uint8Array(PW * PH);
  const cell = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? VOID : cells[y * W + x]);
  const isWall = (x, y) => cell(x, y) === WALL;
  const solid = (x, y) => { const c = cell(x, y); return c === WALL || c === VOID; };
  const openCell = (x, y) => { const c = cell(x, y); return c === FLOOR || c === WATER || c === FOLIAGE; };
  const wet = (x, y) => { const c = cell(x, y); return c === WATER || c === WALL || c === VOID; };
  const put = (px, py, code) => { out[py * PW + px] = code; };

  function floorKey(px, py, tx, ty, lx, ly) {
    const n = smoothNoise(px, py, 36, seed + 1) * 0.8 + smoothNoise(px, py, 9, seed + 2) * 0.2;
    let key = n > 0.64 ? K.j : K.g;
    // Flagstones in a running bond: rows of 16 px stones, every other row shifted by half.
    const shift = ty & 1 ? 8 : 0;
    const sx = mod(px + shift, TILE);
    const stone = hashInts(Math.floor((px + shift) / TILE), ty, seed, 'stone');
    const grout = ly === 0 || sx === 0;
    if (grout) {
      if (unit(hashInts(px, py, seed, 'worn')) > 0.2) key = K.G;
    } else if (ly === 1 && sx >= 2 && sx <= 5 && unit(stone) < 0.35) key = K.h;
    else if (unit(stone) < 0.12) {
      // A hairline crack across an odd stone.
      const cx = 4 + (stone >>> 8) % 8;
      if (sx === cx + Math.floor((ly - 4) / 3) && ly >= 4 && ly <= 12) key = K.G;
    }
    // Pebbles, now and then.
    const pebble = hashInts(tx, ty, seed, 'pebble');
    if (unit(pebble) < 0.05) {
      const ex = 3 + (pebble >>> 6) % 9;
      const ey = 4 + (pebble >>> 10) % 8;
      if (ly === ey && (lx === ex || lx === ex + 1)) key = K.S;
      else if (ly === ey - 1 && lx === ex) key = K.s;
    }
    // A soft shadow cast by a wall standing to the north (and a hint of one to the west).
    if (isWall(tx, ty - 1)) {
      if (ly < 2 || (ly === 2 && (px + py) % 2 === 0)) key = K.G;
    }
    if (lx === 0 && isWall(tx - 1, ty) && (py & 1) === 0) key = K.G;
    return key;
  }

  function mossKey(px, py, tx, ty, lx, ly, base) {
    // Growth fades toward any side whose neighbour isn't growth, so patches have soft edges.
    let weight = 1;
    const sides = [[0, -1, ly], [0, 1, 15 - ly], [-1, 0, lx], [1, 0, 15 - lx]];
    for (const [dx, dy, d] of sides) if (cell(tx + dx, ty + dy) !== FOLIAGE) weight = Math.min(weight, (d + 1) / 7);
    const n = smoothNoise(px, py, 6, seed + 7);
    const m = n * (0.55 + weight * 0.6);
    if (m > 0.78) return K.q;
    if (m > 0.6) return K.l;
    if (m > 0.55 && (px + py) % 2 === 0) return K.L;
    return base;
  }

  function waterKey(px, py, tx, ty, lx, ly) {
    // Rounded where two open sides meet at a corner, so puddles and pools read as soft shapes.
    const sx = lx < 8 ? -1 : 1;
    const sy = ly < 8 ? -1 : 1;
    if (!wet(tx + sx, ty) && !wet(tx, ty + sy)) {
      const dx = lx < 8 ? lx : 15 - lx;
      const dy = ly < 8 ? ly : 15 - ly;
      const r = 5;
      if (dx < r && dy < r && (r - dx - 0.5) ** 2 + (r - dy - 0.5) ** 2 > r * r) return null; // floor shows through
    }
    const bank = (x, y) => { const c = cell(x, y); return c === FLOOR || c === FOLIAGE; };
    // Water sits below the floor: along a pool's north edge the bank's lip shows in 3/4 view (a
    // row of worn ground over a row of its dark edge) and casts a soft shadow onto the water.
    const north = bank(tx, ty - 1);
    if (north) {
      if (ly === 0) return K.G;
      if (ly === 1) return K.o;
      if (ly === 2 || (ly === 3 && (px & 1) === 0)) return K.W;
    }
    // Distance to the nearest other bank (an open, dry neighbour), within the tile.
    let d = 99;
    if (bank(tx, ty + 1)) d = Math.min(d, 15 - ly);
    if (bank(tx - 1, ty)) d = Math.min(d, lx);
    if (bank(tx + 1, ty)) d = Math.min(d, 15 - lx);
    const deep = Math.min(d, north ? ly - 3 : 99);
    // Foam laps at the other shores in broken runs, not a stitched line.
    const lap = smoothNoise(px, py, 5, seed + 11);
    let key = K.w;
    if (d === 0 && lap > 0.52) key = K.f;
    else if (d === 1 && lap > 0.84) key = K.f;
    else if (deep > 4 + smoothNoise(px, py, 14, seed + 9) * 5) key = K.W;
    if (isWall(tx, ty - 1) && ly < 3) key = K.W; // the wall's shadow on the water
    // Ripples: short level glints, a pixel or two of foam over a lighter run.
    if (key !== K.f && deep >= 3) {
      const ripple = hashInts(Math.floor(px / 6), py >> 1, seed, 'ripple');
      if ((py & 1) === 0 && unit(ripple) < 0.05) {
        const at = mod(px, 6);
        if (at >= 1 && at <= 3) key = at === 2 ? K.f : K.w;
      }
    }
    return key;
  }

  // A dais: 8 px a step (COMBAT.md §4.2), drawn as a lit lip on its top edge, a brick face with an
  // ink foot where it drops to lower ground, and treads on a stair tile.
  const heightOf = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Number(heights[y * W + x]) || 0);
  function raisedKey(tx, ty, lx, ly, base) {
    const h = heightOf(tx, ty);
    if (!h) return base;
    if (stairs?.has(`${tx},${ty}`)) return ly === 5 || ly === 10 || ly === 15 ? K.o : ly === 6 || ly === 11 ? K.h : base;
    const drop = heightOf(tx, ty + 1) < h;
    if (drop && ly >= 13) return ly === 15 ? K.o : lx % 4 === 0 ? K.z : K.S;
    if (ly === 0 && heightOf(tx, ty - 1) < h) return K.h;
    if ((lx === 0 && heightOf(tx - 1, ty) < h) || (lx === 15 && heightOf(tx + 1, ty) < h)) return K.G;
    return base;
  }

  function fordKey(lx, ly, base) {
    // Two stepping stones across the tile.
    for (const [cx, cy] of [[5, 5], [11, 11]]) {
      const dx = (lx - cx) / 3;
      const dy = (ly - cy) / 2.4;
      const d = dx * dx + dy * dy;
      if (d <= 1) return ly >= cy + 1 ? K.S : ly <= cy - 2 ? K.c : K.s;
      if (d <= 1.7 && ly > cy) return K.f;
    }
    return base;
  }

  // A wall's stone reaches RIM px from the open ground (and the faces) beside it; past that is the
  // void, so rooms are ringed by slim rounded rims rather than thick slabs.
  const RIM = 7;
  function wallRects(tx, ty) {
    const rects = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (openCell(nx, ny)) rects.push([dx * TILE, dy * TILE, dx * TILE + TILE, dy * TILE + TILE]);
        else if (isWall(nx, ny) && openCell(nx, ny + 1)) rects.push([dx * TILE, dy * TILE + TILE - FACE_H, dx * TILE + TILE, dy * TILE + TILE]);
      }
    }
    return rects;
  }

  function wallKey(px, py, tx, ty, lx, ly, rects) {
    const face = openCell(tx, ty + 1);
    const top = face ? TILE - FACE_H : TILE;
    if (lx === 0 && !solid(tx - 1, ty)) return K.o;
    if (lx === 15 && !solid(tx + 1, ty)) return K.o;
    if (ly < top) {
      // The top face: ink where it meets open ground, a rim's width of stone, then the void.
      if (ly === 0 && !solid(tx, ty - 1)) return K.o;
      if (ly === 0 && lx === 0 && !solid(tx - 1, ty - 1)) return K.o;
      if (ly === 0 && lx === 15 && !solid(tx + 1, ty - 1)) return K.o;
      if (ly === 15 && lx === 0 && !solid(tx - 1, ty + 1)) return K.o;
      if (ly === 15 && lx === 15 && !solid(tx + 1, ty + 1)) return K.o;
      let d = Infinity;
      for (const [x0, y0, x1, y1] of rects) {
        const ex = Math.max(x0 - (lx + 0.5), 0, lx + 0.5 - x1);
        const ey = Math.max(y0 - (ly + 0.5), 0, ly + 0.5 - y1);
        d = Math.min(d, Math.hypot(ex, ey));
      }
      if (d > RIM) return null; // the void
      if (d > RIM - 1) return K.o;
      if (ly === top - 1 && face) return K.c; // the lit lip above the face
      return unit(hashInts(px, py, seed, 'grit')) < 0.012 ? K.S : K.s;
    }
    // The front face: courses of bricks with z mortar, and an ink foot.
    const fy = ly - top;
    if (ly === 15) return K.o;
    if (fy === 3 || fy === 7) return K.z;
    const course = fy < 3 ? 0 : 1;
    if (mod(lx + course * 4 + tx * 16, 8) === 0) return K.z;
    return fy === 0 ? K.s : K.S;
  }

  function lampKey(tx, ty, lx, ly) {
    // Some faces carry one of the genre's lamps: a candle, a neon tube, a lantern.
    if (!isWall(tx, ty) || !openCell(tx, ty + 1)) return 0;
    const h = hashInts(tx, ty, seed, 'lamp');
    if (unit(h) > 0.16 || isWall(tx - 1, ty) === false && isWall(tx + 1, ty) === false) return 0;
    const top = TILE - FACE_H;
    const shape = ['..u..', '.uUu.', '.oUo.', '..o..'];
    const x0 = 6;
    const y0 = top + 1;
    const row = shape[ly - y0];
    if (!row) return 0;
    const ch = row[lx - x0];
    return ch && ch !== '.' ? K[ch] : 0;
  }

  for (let ty = 0; ty < H; ty += 1) {
    for (let tx = 0; tx < W; tx += 1) {
      const c = cells[ty * W + tx];
      const ford = fords[ty * W + tx] === 1;
      const rects = c === WALL ? wallRects(tx, ty) : null;
      for (let ly = 0; ly < TILE; ly += 1) {
        for (let lx = 0; lx < TILE; lx += 1) {
          const px = tx * TILE + lx;
          const py = ty * TILE + ly;
          let key = null;
          if (c === WALL) key = lampKey(tx, ty, lx, ly) || wallKey(px, py, tx, ty, lx, ly, rects);
          if (c === VOID || (c === WALL && key === null)) {
            // The space between pages: ink, with the odd faint star.
            const h = unit(hashInts(px, py, seed, 'void'));
            key = h < 0.0009 ? K.c : h < 0.004 ? K.N : K.o;
          } else if (c === WATER) {
            key = waterKey(px, py, tx, ty, lx, ly);
            if (key === null) key = floorKey(px, py, tx, ty, lx, ly);
            else if (ford) key = fordKey(lx, ly, key);
          } else if (c !== WALL) {
            key = floorKey(px, py, tx, ty, lx, ly);
            if (c === FOLIAGE) key = mossKey(px, py, tx, ty, lx, ly, key);
            if (heights) key = raisedKey(tx, ty, lx, ly, key);
          }
          put(px, py, key);
        }
      }
    }
  }
  return out;
}
