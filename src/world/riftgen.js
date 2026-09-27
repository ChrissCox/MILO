// Procedural rifts (RIFTS.md §10). A rift is built entirely from a seed:
//   real rifts   seed = hash of the real cause (signals + subject), so the same problem is
//                always the same rift, deepening as it waits;
//   wild rifts   seed = hash of the world seed, chunk and day, so the wilds always hold new ones;
//   the ladder   every stitched wild rift reveals a deeper one, forever.
// Pure and deterministic. Content (content/riftgen.json, content/genres.json) is passed in.
import { createRng, hashInts, hashString } from './rng.js';
import { ARCHETYPES, composeStray } from './straygen.js';

const STAGES = ['hairline', 'open', 'gaping'];
const TEMPERAMENTS = ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud'];
export const pairKey = (ids) => [...ids].sort().join('+');

export function createRiftgen({ words, genres }) {
  const meta = Object.fromEntries(genres.genres.map((g) => [g.id, g]));
  const ids = genres.genres.map((g) => g.id);
  const signalToGenre = new Map();
  for (const g of genres.genres) for (const s of g.signals) signalToGenre.set(s, g.id);
  const fusions = new Map(genres.fusions.map((f) => [pairKey(f.ids), f]));
  const bank = (id) => words.genres[id];

  // ---------- words ----------

  function kaijuName(rng, id) {
    const g = bank(id);
    return rng.pick(g.namePrefixes) + rng.pick(g.nameSuffixes);
  }

  function fill(pattern, id, rng, extra = {}) {
    const g = bank(id);
    return pattern.replace(/\{(\w+)\}/g, (_, token) => {
      switch (token) {
        case 'adj': return rng.pick(g.adjectives);
        case 'noun': return rng.pick(g.nouns);
        case 'place': return fill(rng.pick(g.places), id, rng, extra);
        case 'name': return g.names ? rng.pick(g.names) : kaijuName(rng, id);
        case 'title': return rng.pick(g.titles);
        case 'num': return String(extra.num ?? rng.int(2, 99));
        case 'time': return `${rng.int(1, 4)}:${String(rng.int(0, 59)).padStart(2, '0')}`;
        case 'subject': return extra.subject ?? rng.pick(g.nouns);
        default: return token;
      }
    }).replace(/\s+/g, ' ').trim();
  }

  function riftName(rng, gs, { subject, affixes, kind }) {
    const [a, b, c] = gs;
    let name;
    if (gs.length >= 3) {
      name = subject
        ? `The Maelstrom of ${subject}`
        : `The ${rng.pick(bank(a).adjectives)}, ${rng.pick(bank(b).adjectives)} and ${rng.pick(bank(c).adjectives)} ${rng.pick(bank(a).nouns)}`;
    } else if (gs.length === 2) {
      const fusion = fusions.get(pairKey(gs));
      name = subject && fusion
        ? `${fusion.name}: ${subject}`
        : `The ${rng.pick(bank(a).adjectives)} ${rng.pick(bank(b).nouns)}`;
    } else {
      const g = bank(a);
      name = fill(rng.pick(subject ? g.patternsReal : g.patterns), a, rng, { subject });
    }
    // Wild rifts wear their first affix in the name: "The Flooded Neon Uplink".
    if (kind === 'wild' && affixes.length && /^The /.test(name) && !name.includes(affixes[0].name)) {
      name = `The ${affixes[0].name} ${name.slice(4)}`;
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  // ---------- parts of a rift ----------

  function rollAffixes(rng, count) {
    const pool = words.affixes.filter((affix) => !affix.rare || rng.chance(0.08));
    return rng.sample(pool, count);
  }

  function makeStrays(rng, gs, affixes, stage) {
    const extra = affixes.map((affix) => affix.extraGenre).filter((id) => id && bank(id));
    const kinds = gs.length >= 2 ? 4 : 3;
    const multiplier = affixes.reduce((m, affix) => m * (affix.strays ?? 1), 1);
    const perKind = { hairline: [1, 2], open: [2, 4], gaping: [3, 6] }[stage];
    const out = [];
    const names = new Set();
    const want = Math.min(kinds + extra.length, kinds + 1);
    // Slots are filled in order; a name that's already taken just rolls that slot again.
    for (let attempt = 0; attempt < want * 8 && out.length < want; attempt += 1) {
      const i = out.length;
      const base = i < kinds ? gs[i % gs.length] : extra[i - kinds];
      const others = [...gs, ...extra].filter((id) => id !== base);
      const cross = others.length > 0 && rng.chance(gs.length >= 2 ? 0.6 : 0.3);
      const second = cross ? rng.pick(others) : null;
      const g = bank(base);
      const kindsHere = Object.keys(g.archetypes).filter((k) => ARCHETYPES[k]);
      const archetype = rng.chance(0.75) ? rng.pick(g.preferred) : rng.pick(kindsHere);
      const noun = rng.pick(g.archetypes[archetype]);
      const adjective = rng.pick(bank(second || base).adjectives);
      const name = cross || rng.chance(0.5) ? `${adjective} ${noun}` : noun;
      if (names.has(name)) continue;
      names.add(name);
      const parts = rng.sample(g.parts, rng.int(1, 2)).map((id) => ({ id, layer: 0 }));
      if (second) parts.push({ id: rng.pick(bank(second).parts), layer: 1 });
      const bodyKey = rng.pick(g.bodyKeys);
      const count = Math.max(1, Math.round(rng.int(perKind[0], perKind[1]) * multiplier));
      out.push({
        name, genre: base, second, archetype, bodyKey, parts, count,
        temperament: rng.pick(TEMPERAMENTS),
        sprite: composeStray({ archetype, bodyKey, parts }),
      });
    }
    return out;
  }

  function makeLead(rng, gs, subject) {
    const primary = gs[0];
    const g = bank(primary);
    const mechanicFrom = gs.length >= 2 && rng.chance(0.5) ? gs[1] : primary;
    const lead = {
      genre: primary,
      name: fill(rng.pick(g.bossPatterns), primary, rng, { subject }),
      mechanic: rng.pick(bank(mechanicFrom).mechanics),
      line: fill(rng.pick(g.quotes), primary, rng, { subject }),
    };
    if (subject) lead.of = subject;
    if (gs.length >= 3) lead.council = gs.slice(1).map((id) => fill(rng.pick(bank(id).bossPatterns), id, rng, { subject }));
    return lead;
  }

  function makeLoot(rng, gs, affixes, tier, stage) {
    const lootBoost = affixes.reduce((m, affix) => m * (affix.loot ?? 1), 1);
    const loot = gs.map((id) => ({ item: rng.pick(bank(id).essences), qty: Math.max(1, Math.round((1 + STAGES.indexOf(stage) + rng.int(0, tier)) * lootBoost)), genre: id }));
    if (gs.length >= 3) loot.push({ item: 'Maelstrom glass', qty: 1, genre: null });
    if (rng.chance(Math.min(0.9, (0.06 + tier * 0.05) * lootBoost))) {
      const id = rng.pick(gs);
      const g = bank(id);
      const owner = g.names ? rng.pick(g.names) : kaijuName(rng, id);
      loot.push({
        item: `${rng.pick(g.adjectives)} ${rng.pick(g.relics)} of ${owner}`,
        qty: 1, genre: id, relic: true,
        text: `Once belonged to ${owner}, who ${rng.pick(words.deeds)}.`,
      });
    }
    return loot;
  }

  function build({ seed, kind, gs, subject = null, stage, tier, depth, key = null, cause = null }) {
    const rng = createRng(seed);
    const affixCount = kind === 'real' ? (rng.chance(0.35) ? 1 : 0) : Math.min(3, 1 + Math.floor(rng.next() * (1 + tier / 3)));
    const affixes = rollAffixes(rng, affixCount).map(({ id, name, text, extraGenre }) => ({ id, name, text, ...(extraGenre ? { extraGenre } : {}) }));
    const full = affixes.map((a) => words.affixes.find((x) => x.id === a.id));
    const fusion = gs.length === 2 ? fusions.get(pairKey(gs)) || null : null;
    const spec = {
      id: `rift:${seed.toString(36)}`,
      seed, kind, key, subject,
      genres: [...gs],
      fusion: fusion ? fusion.name : null,
      maelstrom: gs.length >= 3,
      stage, tier, depth,
      name: riftName(rng, gs, { subject, affixes, kind }),
      affixes,
      strays: makeStrays(rng, gs, full, stage),
      taleLead: makeLead(rng, gs, subject),
      loot: makeLoot(rng, gs, full, tier, stage),
      mood: meta[gs[0]].mood,
    };
    if (cause) spec.cause = cause;
    return spec;
  }

  // ---------- public ----------

  /** A rift from real signals. key identifies the real thing (a repo, a quest id); urgency 0..1. */
  function realRift({ key, subject, signals, urgency = 0.5, tier = 1, cause = null }) {
    const gs = [];
    for (const signal of signals) {
      const id = signalToGenre.get(signal);
      if (id && !gs.includes(id)) gs.push(id);
    }
    if (!gs.length) throw new Error(`No genre for signals: ${signals.join(', ')}`);
    const seed = hashString(`${key}|${[...signals].sort().join(',')}`);
    const stage = urgency >= 0.67 ? 'gaping' : urgency >= 0.34 ? 'open' : 'hairline';
    return build({ seed, kind: 'real', gs: gs.slice(0, 4), subject, stage, tier, depth: 1, key, cause });
  }

  /** A wild rift from a spawn point: { seed, tier, depth, weights: { genreId: weight } }. */
  function wildRift({ seed, tier = 1, depth = 1, weights = {} }) {
    const rng = createRng(hashInts(seed, 'genres'));
    const entries = ids.map((id) => [id, weights[id] ?? 0.5]).filter(([, w]) => w > 0);
    const gs = [rng.weighted(entries)];
    if (rng.chance(Math.min(0.5, 0.16 + tier * 0.025))) {
      gs.push(rng.weighted(entries.filter(([id]) => !gs.includes(id))));
      if (rng.chance(Math.min(0.3, 0.04 + tier * 0.012))) gs.push(rng.weighted(entries.filter(([id]) => !gs.includes(id))));
    }
    const stage = rng.weighted([['hairline', Math.max(1, 5 - tier)], ['open', 3], ['gaping', 1 + tier * 0.6]]);
    return build({ seed, kind: 'wild', gs, stage, tier, depth });
  }

  /** The next rung of the ladder: deeper, stranger, a little harder, with better loot. */
  function deeper(spec) {
    const depth = (spec.depth || 1) + 1;
    const weights = Object.fromEntries(spec.genres.map((id, i) => [id, 3 - i * 0.5]));
    for (const id of ids) weights[id] = weights[id] ?? 0.4;
    return wildRift({ seed: hashInts(spec.seed, depth, 'deeper'), tier: Math.min(8, (spec.tier || 1) + (depth % 3 === 0 ? 1 : 0)), depth, weights });
  }

  /** The rift's Elsewhere: a connected set of rooms with an entrance, loot, a puzzle, the Tale-lead and the stitch point. */
  function layout(spec) {
    const rng = createRng(hashInts(spec.seed, 'layout'));
    const tweaks = { water: 0, foliage: 0, size: 1, rooms: 1, maze: 0, mirrored: false };
    for (const affix of spec.affixes) {
      const l = words.affixes.find((a) => a.id === affix.id)?.layout || {};
      tweaks.water = Math.max(tweaks.water, l.water || 0);
      tweaks.foliage = Math.max(tweaks.foliage, l.foliage || 0);
      tweaks.size *= l.size || 1;
      tweaks.rooms *= l.rooms || 1;
      tweaks.maze = Math.max(tweaks.maze, l.maze || 0);
      tweaks.mirrored = tweaks.mirrored || Boolean(l.mirrored);
    }
    const base = { hairline: [40, 26], open: [52, 34], gaping: [64, 42] }[spec.stage];
    const grow = 1 + Math.min(0.6, (spec.depth - 1) * 0.04);
    const W = Math.max(28, Math.round(base[0] * tweaks.size * grow));
    const H = Math.max(20, Math.round(base[1] * tweaks.size * grow));
    return carve(rng, W, H, tweaks, Math.round((5 + STAGES.indexOf(spec.stage) * 3 + Math.min(8, spec.depth / 2)) * tweaks.rooms));
  }

  return { realRift, wildRift, deeper, layout, genreForSignal: (signal) => signalToGenre.get(signal) || null };
}

// ---------- layout carving ----------

function carve(rng, W, H, tweaks, target) {
  const grid = Array.from({ length: H }, () => Array(W).fill('#'));
  const half = tweaks.mirrored ? Math.floor(W / 2) : W;
  const rooms = [];
  for (let attempt = 0; attempt < 400 && rooms.length < Math.max(4, target); attempt += 1) {
    const w = rng.int(5, 10);
    const h = rng.int(4, 7);
    const x = rng.int(1, Math.max(1, half - w - 1));
    const y = rng.int(1, Math.max(1, H - h - 1));
    if (x + w >= half || y + h >= H - 1) continue;
    if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
  }
  // Very small or crowded layouts still get two rooms to walk between.
  if (rooms.length < 2) {
    rooms.length = 0;
    const w = Math.min(6, Math.floor(half / 3));
    rooms.push({ x: 1, y: 1, w, h: 4, cx: 1 + Math.floor(w / 2), cy: 3 });
    rooms.push({ x: half - w - 2, y: H - 6, w, h: 4, cx: half - w - 2 + Math.floor(w / 2), cy: H - 4 });
  }
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) grid[y][x] = '.';
  // Connect every room: a minimum spanning tree over room centres, plus a few loops.
  const dig = (a, b) => {
    let { cx: x, cy: y } = a;
    const horizontalFirst = rng.chance(0.5);
    const stepX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); grid[y][x] = '.'; } };
    const stepY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); grid[y][x] = '.'; } };
    if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  };
  const inTree = new Set([0]);
  const edges = [];
  while (inTree.size < rooms.length) {
    let best = null;
    for (const i of inTree) {
      for (let j = 0; j < rooms.length; j += 1) {
        if (inTree.has(j)) continue;
        const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    inTree.add(best.j);
    edges.push([best.i, best.j]);
    dig(rooms[best.i], rooms[best.j]);
  }
  for (let k = 0; k < Math.ceil(rooms.length * 0.2); k += 1) {
    const i = rng.int(0, rooms.length - 1);
    const j = rng.int(0, rooms.length - 1);
    if (i !== j) { dig(rooms[i], rooms[j]); edges.push([i, j]); }
  }
  // Labyrinthine: extra winding corridors off the rooms.
  for (let k = 0; k < Math.round(tweaks.maze * 40); k += 1) {
    let x = rng.int(1, half - 2);
    let y = rng.int(1, H - 2);
    if (grid[y][x] !== '.') continue;
    for (let step = 0; step < rng.int(6, 18); step += 1) {
      const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= half - 1 || ny >= H - 1) break;
      x = nx; y = ny;
      grid[y][x] = '.';
    }
  }
  // Mirrored: reflect the left half onto the right, and join them down the middle.
  if (tweaks.mirrored) {
    for (let y = 0; y < H; y += 1) for (let x = 0; x < half; x += 1) grid[y][W - 1 - x] = grid[y][x];
    const mid = rooms[0];
    for (let x = mid.cx; x <= W - 1 - mid.cx; x += 1) grid[mid.cy][x] = '.';
    for (const r of [...rooms]) rooms.push({ x: W - r.x - r.w, y: r.y, w: r.w, h: r.h, cx: W - 1 - r.cx, cy: r.cy, mirror: true });
  }
  // Special rooms: the entrance at the far left, the Tale-lead farthest from it, loot in dead ends.
  const dist = bfs(grid, rooms.reduce((a, r) => (r.cx < a.cx ? r : a), rooms[0]));
  const entrance = rooms.reduce((a, r) => (r.cx < a.cx ? r : a), rooms[0]);
  const byDistance = [...rooms].filter((r) => dist[r.cy][r.cx] >= 0).sort((a, b) => dist[a.cy][a.cx] - dist[b.cy][b.cx]);
  const boss = byDistance[byDistance.length - 1];
  const degree = new Map(rooms.map((_, i) => [i, 0]));
  for (const [i, j] of edges) { degree.set(i, degree.get(i) + 1); degree.set(j, degree.get(j) + 1); }
  const loot = rooms.filter((r, i) => r !== entrance && r !== boss && (degree.get(i) === 1 || r.mirror)).slice(0, 4);
  const middle = byDistance.filter((r) => r !== entrance && r !== boss && !loot.includes(r));
  const puzzle = middle[Math.floor(middle.length / 2)] || null;
  // Water and growth, never on the marked spots.
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      if (grid[y][x] !== '.') continue;
      const roll = rng.next();
      if (roll < tweaks.water) grid[y][x] = '~';
      else if (roll < tweaks.water + tweaks.foliage) grid[y][x] = '"';
    }
  }
  const mark = (room, ch, dx = 0) => { grid[room.cy][room.cx + dx] = ch; return { x: room.cx + dx, y: room.cy }; };
  const spots = {
    entrance: mark(entrance, 'E'),
    boss: mark(boss, 'B'),
    stitch: mark(boss, 'S', boss.w > 2 ? 1 : 0),
    puzzle: puzzle ? mark(puzzle, 'P') : null,
    loot: loot.map((room) => mark(room, 'L')),
  };
  return { w: W, h: H, rows: grid.map((row) => row.join('')), rooms: rooms.length, ...spots };
}

function bfs(grid, from) {
  const H = grid.length;
  const W = grid[0].length;
  const dist = Array.from({ length: H }, () => Array(W).fill(-1));
  const queue = [[from.cx, from.cy]];
  dist[from.cy][from.cx] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || dist[ny][nx] >= 0 || grid[ny][nx] === '#') continue;
      dist[ny][nx] = dist[y][x] + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

/** Walkable tiles reachable from the entrance (for tests and the engine). */
export function reachable(layout) {
  const grid = layout.rows.map((row) => [...row]);
  const dist = bfs(grid, { cx: layout.entrance.x, cy: layout.entrance.y });
  return (spot) => Boolean(spot) && dist[spot.y][spot.x] >= 0;
}
