// The fight grid (CONTRACT-PHASE4.md §4.4, §4.17, §7.1; COMBAT.md §4): 1-2-1 distance,
// movement with occupancy and costs, sight, cover, height, light, areas and threat. Pure;
// a Grid is built fresh from a Battle wherever it's needed.

/** 1-2-1 distance: max(dx, dy) + floor(min(dx, dy) / 2). */
export function dist(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
}

/** The tiles a unit stands on: one, or four for a Large unit (x..x+1, y..y+1). */
export function footprint(unit) {
  if (!unit) return [];
  if ((unit.size || 1) === 2) {
    return [{ x: unit.x, y: unit.y }, { x: unit.x + 1, y: unit.y }, { x: unit.x, y: unit.y + 1 }, { x: unit.x + 1, y: unit.y + 1 }];
  }
  return [{ x: unit.x, y: unit.y }];
}

/** The shortest 1-2-1 distance between two units' footprints (or a unit and a tile). */
export function unitDist(a, b) {
  const fa = a.size ? footprint(a) : [a];
  const fb = b.size ? footprint(b) : [b];
  let best = Infinity;
  for (const p of fa) for (const q of fb) best = Math.min(best, dist(p, q));
  return best;
}

// A standing unit and a standing foe of it (neither neutral): §18.2's standoff reads who comes closer to whom.
const opposed = (u, v) => u.side !== v.side && u.side !== 'neutral' && v.side !== 'neutral' && !u.sorted && !u.offline && !v.sorted && !v.offline;

/** How far a unit stands from each standing foe: Map<id, distance> (empty for a neutral, sorted or Offline unit). */
export function foeDistances(battle, u) {
  const out = new Map();
  if (!u) return out;
  for (const v of battle.units) if (opposed(u, v)) out.set(v.id, unitDist(u, v));
  return out;
}

/** True when a unit now stands closer to any foe than `before` (from foeDistances) says. */
export function cameCloser(battle, u, before) {
  if (!u || !before?.size) return false;
  for (const [id, d] of before) {
    const v = battle.units.find((x) => x.id === id);
    if (v && opposed(u, v) && unitDist(u, v) < d) return true;
  }
  return false;
}

/** Chebyshev adjacency (the eight tiles around), used for "next to" and reach 1. */
const beside = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

/**
 * The one rule for who can make a Parting swipe (§4.4: a reaction that's one melee Strike), shared by
 * the grid's swipe lists and the round's reactions: a standing unit that isn't a device or a neutral,
 * with a melee Strike (a ranged-only Strike never swipes), awake, not Sparked or surprised, and with
 * its reaction left. Its setting (Ask, Always, Under half, Never) is the round's to read.
 */
export function canSwipe(u) {
  if (!u || u.sorted || u.offline || u.rank === 'device' || u.side === 'neutral') return false;
  if (u.strike && u.strike.range > 0) return false;
  if ((u.conditions || []).some((c) => c.id === 'drowsy' || c.id === 'sparked')) return false;
  if ((u.mods || []).some((m) => m.stat === 'surprised')) return false;
  return !u.reactionUsed;
}

/**
 * Surface flags the grid needs when no rules are passed (they equal rules.json's surfaces;
 * combat-content.test.js checks every cell).
 */
export const SURFACE_FLAGS = Object.freeze({
  'neon-puddle': { difficult: false, blocksSight: false, lit: false, hide: false, leaving: 1 },
  'candle-wax': { difficult: true, blocksSight: false, lit: false, hide: false, leaving: 1 },
  candlefire: { difficult: true, blocksSight: false, lit: true, hide: false, leaving: 1 },
  'oil-slick': { difficult: false, blocksSight: false, lit: false, hide: false, leaving: 1 },
  'burning-oil': { difficult: false, blocksSight: false, lit: true, hide: false, leaving: 1 },
  smog: { difficult: false, blocksSight: true, lit: false, hide: false, leaving: 1 },
  'gravity-well': { difficult: false, blocksSight: false, lit: false, hide: false, leaving: 2 },
  'dust-cloud': { difficult: false, blocksSight: false, lit: false, hide: true, leaving: 1 },
  'streetlight-pool': { difficult: false, blocksSight: false, lit: true, hide: false, leaving: 1 },
  'moonbrew-spill': { difficult: false, blocksSight: false, lit: false, hide: false, leaving: 1 },
  steam: { difficult: false, blocksSight: true, lit: false, hide: false, leaving: 1 },
  water: { difficult: true, blocksSight: false, lit: false, hide: false, leaving: 1 },
  foliage: { difficult: true, blocksSight: false, lit: false, hide: true, leaving: 1 },
  'burning-foliage': { difficult: true, blocksSight: false, lit: true, hide: false, leaving: 1 },
  ice: { difficult: false, blocksSight: false, lit: false, hide: false, leaving: 1 },
  'rough-ground': { difficult: true, blocksSight: false, lit: false, hide: false, leaving: 1 },
});

/** Surfaces that count as natural difficult terrain (Read the ground ignores them). */
export const NATURAL_DIFFICULT = Object.freeze(['water', 'foliage', 'rough-ground']);

/** A Set nothing can change (add, delete and clear throw). */
function readOnlySet(list) {
  const set = new Set(list);
  const refuse = () => {
    throw new Error('This list is fixed');
  };
  for (const k of ['add', 'delete', 'clear']) Object.defineProperty(set, k, { value: refuse });
  return Object.freeze(set);
}

/**
 * Object kinds you can walk onto (floor marks and small devices); every other object blocks.
 * §18.2: grid.js owns this rule, and D's encounters import it.
 */
export const WALKABLE_OBJECTS = readOnlySet(['clue', 'plan-tile', 'snare', 'patch-kit']);

function surfaceFlags(rules) {
  if (!rules?.surfaces) return SURFACE_FLAGS;
  const out = {};
  for (const [id, s] of Object.entries(rules.surfaces)) {
    out[id] = { difficult: !!s.difficult, blocksSight: !!s.blocksSight, lit: !!s.lit, hide: !!s.hide, leaving: s.leaving || 1 };
  }
  return out;
}

const LIGHT_RANK = { D: 0, d: 1, L: 2 };
const TERRAIN_BLOCKS = new Set(['#', 'O', ' ', 'o', '~']);
const SIGHT_BLOCKS = new Set(['#', 'O', ' ']);

// Segment vs axis-aligned box (Liang–Barsky); true when the closed segment meets the box.
function segmentHits(x0, y0, x1, y1, minX, minY, maxX, maxY) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dy, y0 - minY) && clip(dy, maxY - y0) && t0 <= t1;
}

const EDGE = 0.05; // a line within this of a tile's corner only clips it

// A tiny binary heap of [key, value] pairs, lowest key first.
function createHeap() {
  const keys = [];
  const vals = [];
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [vals[p], vals[i]] = [vals[i], vals[p]];
      i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < keys.length && keys[l] < keys[m]) m = l;
      if (r < keys.length && keys[r] < keys[m]) m = r;
      if (m === i) break;
      [keys[m], keys[i]] = [keys[i], keys[m]];
      [vals[m], vals[i]] = [vals[i], vals[m]];
      i = m;
    }
  };
  return {
    get size() { return keys.length; },
    push(key, value) { keys.push(key); vals.push(value); up(keys.length - 1); },
    pop() {
      const value = vals[0];
      const lastK = keys.pop();
      const lastV = vals.pop();
      if (keys.length) { keys[0] = lastK; vals[0] = lastV; down(0); }
      return value;
    },
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * A Grid over a Battle's arena, units, objects, surfaces and lights. `rules` (or a ctx with
 * `.rules`) is optional: without it, surface flags come from SURFACE_FLAGS.
 */
export function createGrid(battle, rulesOrCtx = null) {
  const rules = rulesOrCtx?.rules || rulesOrCtx || null;
  const flags = surfaceFlags(rules);
  const arena = battle.arena;
  const { x: rx, y: ry, w, h } = arena.rect;
  const idx = (x, y) => (y - ry) * w + (x - rx);
  const inside = (x, y) => x >= rx && y >= ry && x < rx + w && y < ry + h;
  const cell = (x, y) => (inside(x, y) ? arena.cells[idx(x, y)] : ' ');
  const height = (x, y) => (inside(x, y) ? Number(arena.height[idx(x, y)]) || 0 : 0);

  const surfaces = new Map();
  for (const s of battle.surfaces || []) surfaces.set(`${s.x},${s.y}`, s);
  const objects = new Map();
  for (const o of battle.objects || []) objects.set(`${o.x},${o.y}`, o);
  const occupants = new Map();
  const units = new Map();
  for (const u of battle.units || []) {
    units.set(u.id, u);
    if (u.sorted) continue;
    for (const t of footprint(u)) occupants.set(`${t.x},${t.y}`, u.id);
  }
  const surfaceAt = (x, y) => surfaces.get(`${x},${y}`)?.id || null;
  const surfaceFlag = (x, y, flag) => {
    const id = surfaceAt(x, y);
    return id ? !!flags[id]?.[flag] : false;
  };
  const objectBlocks = (o) => {
    if (!o) return false;
    if (WALKABLE_OBJECTS.has(o.kind)) return false;
    if (o.kind === 'pop-up-cover' && o.state === 'broken') return false;
    return true;
  };
  const objectSight = (o) => !!o && (o.flags || []).includes('cover-high') && o.state !== 'rubble';
  const objectLow = (o) => !!o && ((o.flags || []).includes('cover-low') || o.state === 'rubble' || (o.kind === 'pop-up-cover' && o.state === 'up'));

  /** 'L', 'd' or 'D': the brightest of the arena's own light, lights in reach and lit surfaces (skip: a light id to leave out). */
  const light = (x, y, { skip = null } = {}) => {
    let best = inside(x, y) ? arena.light[idx(x, y)] : 'D';
    if (!(best in LIGHT_RANK)) best = 'D';
    if (best === 'L') return 'L';
    if (surfaceFlag(x, y, 'lit')) return 'L';
    for (const l of battle.lights || []) {
      if (l.id === skip) continue;
      if (l.radius > 0 && dist(l, { x, y }) <= l.radius) return 'L';
    }
    return best;
  };

  const blocksSight = (x, y) => {
    if (SIGHT_BLOCKS.has(cell(x, y))) return true;
    if (objectSight(objects.get(`${x},${y}`))) return true;
    return surfaceFlag(x, y, 'blocksSight');
  };
  const highCover = (x, y) => cell(x, y) === 'O' || cell(x, y) === '#' || objectSight(objects.get(`${x},${y}`));
  const lowCover = (x, y) => cell(x, y) === 'o' || objectLow(objects.get(`${x},${y}`));
  const difficult = (x, y) => surfaceFlag(x, y, 'difficult');

  const terrainBlocks = (x, y, mover) => {
    const c = cell(x, y);
    if (!inside(x, y) || c === ' ') return true;
    if (c === '~') return !(mover?.moves?.flies || mover?.moves?.hovers);
    if (c === '#' || c === 'O' || c === 'o') return true;
    return false;
  };
  const passThrough = (x, y, mover) => {
    const c = cell(x, y);
    if (!inside(x, y) || c === ' ') return false;
    if (mover?.moves?.throughWalls && (c === '#' || c === 'O' || c === 'o')) return true;
    if (terrainBlocks(x, y, mover)) return false;
    if (objectBlocks(objects.get(`${x},${y}`)) && !mover?.moves?.throughWalls) return false;
    return true;
  };

  /** True when a unit can't stand on (x, y): terrain, a blocking object or another unit. */
  const blocksMove = (x, y, unit = null) => {
    if (terrainBlocks(x, y, unit)) return true;
    if (objectBlocks(objects.get(`${x},${y}`))) return true;
    const who = occupants.get(`${x},${y}`);
    return !!who && who !== unit?.id;
  };

  const occupant = (x, y) => occupants.get(`${x},${y}`) || null;

  // ---------- sight ----------

  const sightTrace = (from, to) => {
    const x0 = from.x + 0.5;
    const y0 = from.y + 0.5;
    const x1 = to.x + 0.5;
    const y1 = to.y + 0.5;
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    const crossed = [];
    const clipped = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if ((x === from.x && y === from.y) || (x === to.x && y === to.y)) continue;
        if (!segmentHits(x0, y0, x1, y1, x, y, x + 1, y + 1)) continue;
        if (segmentHits(x0, y0, x1, y1, x + EDGE, y + EDGE, x + 1 - EDGE, y + 1 - EDGE)) crossed.push({ x, y });
        else clipped.push({ x, y });
      }
    }
    return { crossed, clipped };
  };

  // A line between tile centres that crosses no blocking tile and doesn't squeeze between two blocking corners.
  const lineClear = (from, to, blocks, trace = null) => {
    if (from.x === to.x && from.y === to.y) return true;
    const { crossed, clipped } = trace || sightTrace(from, to);
    for (const t of crossed) if (blocks(t.x, t.y)) return false;
    const blockClips = clipped.filter((t) => blocks(t.x, t.y));
    for (let i = 0; i < blockClips.length; i += 1) {
      for (let j = i + 1; j < blockClips.length; j += 1) {
        const a = blockClips[i];
        const b = blockClips[j];
        if (Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1) return false;
      }
    }
    return true;
  };
  const seesTiles = (from, to, trace = null) => lineClear(from, to, blocksSight, trace);

  /** Line of sight between two tiles, or two units (any tile of each). */
  const sees = (from, to) => {
    const fa = from.size ? footprint(from) : [from];
    const fb = to.size ? footprint(to) : [to];
    for (const a of fa) for (const b of fb) if (seesTiles(a, b)) return true;
    return false;
  };

  const coverTiles = (a, b, attackerHeight, skip) => {
    const trace = sightTrace(a, b);
    if (!seesTiles(a, b, trace)) return null;
    let level = 0;
    for (const t of trace.clipped) {
      if (highCover(t.x, t.y) && beside(t, b)) level = 2;
    }
    if (level < 2) {
      for (const t of trace.crossed) {
        if (!beside(t, b) || beside(t, a)) continue;
        const who = occupants.get(`${t.x},${t.y}`);
        const creature = who && !skip.has(who);
        if (!lowCover(t.x, t.y) && !creature) continue;
        if (attackerHeight > height(t.x, t.y)) continue;
        level = Math.max(level, 1);
      }
    }
    return level;
  };

  /** Cover between two units: 0 none, 1 low, 2 heavy, null when high cover blocks sight. */
  const cover = (fromUnitId, toUnitId) => {
    const a = units.get(fromUnitId);
    const b = units.get(toUnitId);
    if (!a || !b) return null;
    const skip = new Set([a.id, b.id]);
    let best = null;
    for (const p of footprint(a)) {
      for (const q of footprint(b)) {
        const c = coverTiles(p, q, height(p.x, p.y), skip);
        if (c !== null && (best === null || c < best)) best = c;
      }
    }
    return best;
  };

  // ---------- movement ----------

  const canStand = (x, y, mover) => {
    for (const t of footprint({ x, y, size: mover.size || 1 })) {
      if (!passThrough(t.x, t.y, mover) || terrainBlocks(t.x, t.y, mover) || objectBlocks(objects.get(`${t.x},${t.y}`))) return false;
      const who = occupants.get(`${t.x},${t.y}`);
      if (who && who !== mover.id) return false;
    }
    return true;
  };
  const canPass = (x, y, mover) => {
    if ((mover.size || 1) === 1) {
      if (!passThrough(x, y, mover)) return false;
      const who = occupants.get(`${x},${y}`);
      if (who && who !== mover.id) {
        const other = units.get(who);
        if (!other || other.side !== mover.side) return false;
      }
      return true;
    }
    for (const t of footprint({ x, y, size: mover.size || 1 })) {
      if (!passThrough(t.x, t.y, mover)) return false;
      const who = occupants.get(`${t.x},${t.y}`);
      if (who && who !== mover.id) {
        const other = units.get(who);
        if (!other || other.side !== mover.side) return false;
      }
    }
    return true;
  };
  const tileHeight = (x, y, mover) => {
    if ((mover.size || 1) === 1) return height(x, y);
    let top = 0;
    for (const t of footprint({ x, y, size: mover.size || 1 })) top = Math.max(top, height(t.x, t.y));
    return top;
  };
  const anyTile = (x, y, mover, test) => ((mover.size || 1) === 1 ? test(x, y) : footprint({ x, y, size: mover.size }).some((t) => test(t.x, t.y)));

  // Who could swipe a mover standing at (x, y): canSwipe's units on the other side, beside it and seeing it.
  const swipersAt = (x, y, mover) => {
    const out = [];
    const probe = { x, y, size: mover.size || 1 };
    for (const u of battle.units) {
      if (u.side === mover.side || !canSwipe(u)) continue;
      if (unitDist(probe, u) <= 1 && sees(u, probe)) out.push(u.id);
    }
    return out;
  };
  // A diagonal step from (x, y) by (dx, dy) that squeezes between two blocking corners.
  const betweenCorners = (x, y, dx, dy, mover) => {
    if (dx === 0 || dy === 0 || mover?.moves?.throughWalls) return false;
    const m = mover || { size: 1 };
    const blocks = (px, py) => anyTile(px, py, m, (qx, qy) => terrainBlocks(qx, qy, m));
    return blocks(x + dx, y) && blocks(x, y + dy);
  };

  const search = (mover, { budget, noSwipes = false, ignoreDifficult = false, target = null, goal = null }) => {
    const floats = !!(mover.moves?.flies || mover.moves?.hovers);
    const draws = !(noSwipes || mover.moves?.flies);
    const limit = Number.isFinite(budget) ? budget : 4 * w * h;
    const best = new Map(); // state key → { cost, swipes, prev }
    const heap = createHeap();
    // Per-search memos: whether each tile can be passed, its height, how hard it is, and who could swipe from it.
    const memo = (fn) => {
      const m = new Map();
      return (x, y) => {
        const k = x * 4096 + y;
        let v = m.get(k);
        if (v === undefined) {
          v = fn(x, y);
          m.set(k, v);
        }
        return v;
      };
    };
    const pass = memo((x, y) => canPass(x, y, mover));
    const heightAt = memo((x, y) => tileHeight(x, y, mover));
    const hardAt = memo((x, y) => anyTile(x, y, mover, (px, py) => difficult(px, py) && !(ignoreDifficult && NATURAL_DIFFICULT.includes(surfaceAt(px, py)))));
    const blocksAt = memo((x, y) => anyTile(x, y, mover, (px, py) => terrainBlocks(px, py, mover)));
    const leavingAt = memo((x, y) => (!floats && anyTile(x, y, mover, (px, py) => (flags[surfaceAt(px, py)]?.leaving || 1) > 1) ? 2 : 1));
    const swipers = draws ? battle.units.filter((u) => u.side !== mover.side && canSwipe(u)) : [];
    const swipesAt = memo((x, y) => {
      if (!swipers.length) return [];
      const probe = { x, y, size: mover.size || 1 };
      return swipers.filter((u) => unitDist(probe, u) <= 1 && sees(u, probe)).map((u) => u.id);
    });
    const startKey = `${mover.x},${mover.y},0`;
    best.set(startKey, { cost: 0, swipes: [], prev: null, x: mover.x, y: mover.y, parity: 0 });
    heap.push(0, startKey);
    let seq = 0;
    while (heap.size) {
      const key = heap.pop();
      const s = best.get(key);
      if (s.done) continue;
      s.done = true;
      if (target && s.x === target.x && s.y === target.y) break;
      if (goal && s.prev !== null && goal(s.x, s.y) && canStand(s.x, s.y, mover)) {
        best.goalKey = key;
        break;
      }
      const hereHeight = heightAt(s.x, s.y);
      const leaving = leavingAt(s.x, s.y);
      const leftFrom = draws ? swipesAt(s.x, s.y) : [];
      for (const [dx, dy] of DIRS) {
        const nx = s.x + dx;
        const ny = s.y + dy;
        const diagonal = dx !== 0 && dy !== 0;
        if (!pass(nx, ny)) continue;
        if (diagonal && !mover.moves?.throughWalls && blocksAt(s.x + dx, s.y) && blocksAt(s.x, s.y + dy)) continue;
        let step = diagonal ? (s.parity ? 2 : 1) : 1;
        const parity = diagonal ? 1 - s.parity : s.parity;
        if (!floats) {
          if (hardAt(nx, ny)) step *= 2;
          step *= leaving;
        }
        if (!mover.moves?.flies) {
          const nextHeight = heightAt(nx, ny);
          const stairs = cell(nx, ny) === '=' || cell(s.x, s.y) === '=';
          if (nextHeight - hereHeight > 1 && !stairs) continue;
          if (nextHeight > hereHeight && !stairs) step += 1;
        }
        const cost = s.cost + step;
        if (cost > limit) continue;
        let swipes = s.swipes;
        if (leftFrom.length) {
          const stays = swipesAt(nx, ny);
          const left = leftFrom.filter((id) => !stays.includes(id) && !swipes.includes(id));
          if (left.length) swipes = [...swipes, ...left];
        }
        const nkey = `${nx},${ny},${parity}`;
        const old = best.get(nkey);
        if (old && (old.done || old.cost < cost || (old.cost === cost && old.swipes.length <= swipes.length))) continue;
        best.set(nkey, { cost, swipes, prev: key, x: nx, y: ny, parity });
        seq += 1;
        heap.push(cost * 64 + swipes.length + seq / 1e7, nkey);
      }
    }
    return best;
  };

  /** Tiles a unit can end a move on within `budget`: Map<'x,y', { cost, from, swipes }>. */
  const reachable = (unitId, { budget, noSwipes = false, ignoreDifficult = false } = {}) => {
    const mover = units.get(unitId);
    const out = new Map();
    if (!mover || mover.sorted) return out;
    const states = search(mover, { budget: budget ?? mover.speed, noSwipes, ignoreDifficult });
    for (const s of states.values()) {
      if (s.prev === null) continue;
      if (!canStand(s.x, s.y, mover)) continue;
      const tile = `${s.x},${s.y}`;
      const old = out.get(tile);
      if (old && (old.cost < s.cost || (old.cost === s.cost && old.swipes.length <= s.swipes.length))) continue;
      const prev = states.get(s.prev);
      out.set(tile, { cost: s.cost, from: prev ? `${prev.x},${prev.y}` : null, swipes: s.swipes });
    }
    return out;
  };

  const pathFrom = (states, endKey) => {
    const tiles = [];
    let k = endKey;
    while (k) {
      const s = states.get(k);
      if (!s || s.prev === null) break;
      tiles.push({ x: s.x, y: s.y });
      k = s.prev;
    }
    return tiles.reverse();
  };

  /** The cheapest path to a tile (excluding the start), or null. */
  const path = (unitId, to, { noSwipes = false, ignoreDifficult = false, budget = Infinity } = {}) => {
    const mover = units.get(unitId);
    if (!mover || !to) return null;
    if (mover.x === to.x && mover.y === to.y) return [];
    if (!canStand(to.x, to.y, mover)) return null;
    const states = search(mover, { budget, noSwipes, ignoreDifficult, target: to });
    let bestKey = null;
    let bestCost = Infinity;
    let bestSwipes = Infinity;
    for (const parity of [0, 1]) {
      const s = states.get(`${to.x},${to.y},${parity}`);
      if (!s) continue;
      if (s.cost < bestCost || (s.cost === bestCost && s.swipes.length < bestSwipes)) {
        bestKey = `${to.x},${to.y},${parity}`;
        bestCost = s.cost;
        bestSwipes = s.swipes.length;
      }
    }
    return bestKey ? pathFrom(states, bestKey) : null;
  };

  /** The cheapest path to any standable tile beside a unit that sees it (reach 1, a Strike's line), or null; one search. */
  const approach = (unitId, targetId, { noSwipes = false, ignoreDifficult = false, budget = Infinity } = {}) => {
    const mover = units.get(unitId);
    const target = units.get(targetId);
    if (!mover || !target) return null;
    if (unitDist(mover, target) <= 1 && sees(mover, target)) return [];
    const goal = (x, y) => {
      const probe = { x, y, size: mover.size || 1 };
      return unitDist(probe, target) <= 1 && sees(probe, target);
    };
    const states = search(mover, { budget, noSwipes, ignoreDifficult, goal });
    return states.goalKey ? pathFrom(states, states.goalKey) : null;
  };

  /** The cost and swipes of walking a given path (each tile a king's step from the last), or null. */
  const walk = (unitId, tiles, { noSwipes = false, ignoreDifficult = false } = {}) => {
    const mover = units.get(unitId);
    if (!mover || !Array.isArray(tiles)) return null;
    const floats = !!(mover.moves?.flies || mover.moves?.hovers);
    const draws = !(noSwipes || mover.moves?.flies);
    let cx = mover.x;
    let cy = mover.y;
    let parity = 0;
    let cost = 0;
    const swipes = [];
    for (const t of tiles) {
      const dx = t.x - cx;
      const dy = t.y - cy;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return null;
      if (!canPass(t.x, t.y, mover)) return null;
      const diagonal = dx !== 0 && dy !== 0;
      if (betweenCorners(cx, cy, dx, dy, mover)) return null;
      let step = diagonal ? (parity ? 2 : 1) : 1;
      if (diagonal) parity = 1 - parity;
      if (!floats) {
        if (anyTile(t.x, t.y, mover, (x, y) => difficult(x, y) && !(ignoreDifficult && NATURAL_DIFFICULT.includes(surfaceAt(x, y))))) step *= 2;
        if (anyTile(cx, cy, mover, (x, y) => (flags[surfaceAt(x, y)]?.leaving || 1) > 1)) step *= 2;
      }
      if (!mover.moves?.flies) {
        const a = tileHeight(cx, cy, mover);
        const b = tileHeight(t.x, t.y, mover);
        const stairs = cell(t.x, t.y) === '=' || cell(cx, cy) === '=';
        if (b - a > 1 && !stairs) return null;
        if (b > a && !stairs) step += 1;
      }
      if (draws) {
        const stays = new Set(swipersAt(t.x, t.y, mover));
        for (const id of swipersAt(cx, cy, mover)) if (!stays.has(id) && !swipes.includes(id)) swipes.push(id);
      }
      cost += step;
      cx = t.x;
      cy = t.y;
    }
    if (tiles.length && !canStand(cx, cy, mover)) return null;
    return { cost, swipes };
  };

  // What a leap can't clear: walls, high-cover props and objects, and void (§5.3). Deep water is a gap it can.
  const tall = (x, y) => SIGHT_BLOCKS.has(cell(x, y)) || objectSight(objects.get(`${x},${y}`));

  /**
   * §4.4's Jump: up to `range` tiles over gaps, surfaces and creatures, on a line that crosses nothing
   * tall and doesn't squeeze between two tall corners, to a free tile at most one height step above
   * the take-off (nothing crossed rises more than that either; fliers go any height).
   */
  const canJump = (unitId, to, range) => {
    const u = units.get(unitId);
    if (!u || !to || !inside(to.x, to.y) || (to.x === u.x && to.y === u.y)) return false;
    if (dist(u, to) > range || !canStand(to.x, to.y, u)) return false;
    const from = footprint(u);
    const land = footprint({ x: to.x, y: to.y, size: u.size || 1 });
    for (let i = 0; i < from.length; i += 1) if (!lineClear(from[i], land[i], tall)) return false;
    if (!u.moves?.flies) {
      const h0 = tileHeight(u.x, u.y, u);
      if (tileHeight(to.x, to.y, u) - h0 > 1) return false;
      for (let i = 0; i < from.length; i += 1) {
        for (const t of sightTrace(from[i], land[i]).crossed) if (height(t.x, t.y) - h0 > 1) return false;
      }
    }
    return true;
  };

  // ---------- areas ----------

  const open = (x, y) => inside(x, y) && !SIGHT_BLOCKS.has(cell(x, y));

  /** An area's tiles: a burst of radius `size`, a `size`-wide square, or a line of `size` tiles. */
  const area = (shape, size, at, from = null) => {
    const out = [];
    const n = Math.max(0, Math.trunc(Number(size) || 0));
    if (!at) return out;
    if (shape === 'burst') {
      for (let y = at.y - n; y <= at.y + n; y += 1) {
        for (let x = at.x - n; x <= at.x + n; x += 1) {
          if (open(x, y) && dist(at, { x, y }) <= n) out.push({ x, y });
        }
      }
    } else if (shape === 'square') {
      const side = Math.max(1, n);
      const off = Math.floor((side - 1) / 2);
      for (let y = at.y - off; y < at.y - off + side; y += 1) {
        for (let x = at.x - off; x < at.x - off + side; x += 1) if (open(x, y)) out.push({ x, y });
      }
    } else if (shape === 'line') {
      const origin = from || at;
      const dx = at.x - origin.x;
      const dy = at.y - origin.y;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      if (steps === 0) return out;
      for (let i = 1; i <= n; i += 1) {
        const x = origin.x + Math.round((dx * i) / steps);
        const y = origin.y + Math.round((dy * i) / steps);
        if (!open(x, y)) break;
        out.push({ x, y });
      }
    }
    return out;
  };

  /** Unit ids an area would catch, allies included (sorted units aren't there any more). */
  const caught = (tiles) => {
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const out = [];
    for (const u of battle.units) {
      if (u.sorted) continue;
      if (footprint(u).some((t) => set.has(`${t.x},${t.y}`))) out.push(u.id);
    }
    return out;
  };

  /** Tiles the other side (not `side`, not neutrals) could reach and strike this round. */
  const threatened = (side) => {
    const out = new Set();
    for (const u of battle.units) {
      if (u.sorted || u.offline || u.side === side || u.side === 'neutral' || u.rank === 'device') continue;
      const range = Math.max(1, u.strike?.range || 0, u.ranged?.range || 0);
      const spots = [{ x: u.x, y: u.y }];
      for (const key of reachable(u.id, { budget: (u.speed || 0) * 2, noSwipes: true }).keys()) {
        const [x, y] = key.split(',').map(Number);
        spots.push({ x, y });
      }
      for (const s of spots) {
        for (let y = s.y - range; y <= s.y + range; y += 1) {
          for (let x = s.x - range; x <= s.x + range; x += 1) {
            if (inside(x, y) && dist(s, { x, y }) <= range) out.add(`${x},${y}`);
          }
        }
      }
    }
    return out;
  };

  return {
    inside, cell, height, light, difficult, blocksMove, blocksSight, occupant,
    reachable, path, approach, walk, canJump, sees, cover, surfaceAt, area, caught, threatened,
    objectAt: (x, y) => objects.get(`${x},${y}`) || null,
    canStand: (x, y, unitId) => {
      const u = units.get(unitId);
      return !!u && canStand(x, y, u);
    },
    /** Unit ids that could Parting-swipe the unit if it stood at (x, y) (canSwipe, beside it, seeing it). */
    swipersAt: (x, y, unitId) => {
      const u = units.get(unitId);
      return u ? swipersAt(x, y, u) : [];
    },
    betweenCorners: (x, y, dx, dy, unitId) => betweenCorners(x, y, dx, dy, units.get(unitId) || null),
    lowCover, highCover,
    hides: (x, y) => surfaceFlag(x, y, 'hide'),
    surfaceFlag,
  };
}
