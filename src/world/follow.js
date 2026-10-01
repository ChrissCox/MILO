// Following (CONTRACT-PHASE4.md §11.3–§11.4; COMBAT.md §2.5): the company walking behind Milo, as
// an engine layer. Each follower walks to the tile Milo stood on a few steps ago (its formation's
// steps: Line is 2, 4 and 6), at Milo's own speed (halved while sneaking), four ways, tile by tile.
// Followers are kept out of the engine's crew map: no making way, no seats, no waiting for Milo.
// An unchained follower stays where it was left until it's moved (selected, a floor click or walkTo
// walks it) or chained back; every scene change, trip and entrance chains everyone and stands them
// round Milo. Their ids everywhere in the engine are 'party:<memberId>', so the Scribe as a follower
// never collides with the crew member 'claude' or Jev's perch 'jev'.
//
// The pure helpers (FORMATIONS, formationSteps, standAround, stepToward) run in Node; the layer
// takes what it needs from the engine through `env` and draws through the engine's painter.
import { TILE } from './map.js';
import { exploreFrames } from './sprites-party.js';
import { composeStray } from './straygen.js';
import { outfitGrid } from './riftfx.js';

const FEET = 13;
const TRAIL_MAX = 16;

/** How many steps behind Milo each follower walks, by formation (the first is Line's 2, 4 and 6). */
export const FORMATIONS = Object.freeze({
  line: Object.freeze([2, 4, 6]),
  pairs: Object.freeze([1, 3, 4]),
  loose: Object.freeze([3, 6, 9]),
  wedge: Object.freeze([2, 3, 5]),
});

/** The steps back for each of `n` followers in a formation (an unknown one walks as Line; a fourth follows on). */
export function formationSteps(formation, n = 3) {
  const steps = FORMATIONS[formation] || FORMATIONS.line;
  return Array.from({ length: n }, (_, i) => steps[i] ?? steps[steps.length - 1] + 2 * (i - steps.length + 1));
}

/**
 * Up to `n` tiles round `tile` to stand on (never the tile itself or one in `taken`), nearest first,
 * behind him first (the way he came, `dir` being the way he faces), found by a small breadth-first
 * walk over `walkable`. Fewer when there's no room; a follower with none stands on `tile`.
 */
export function standAround(tile, n, walkable, { dir = 'down', taken = [] } = {}) {
  const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[dir] || [0, -1];
  const order = [back, [back[1], back[0]], [-back[1], -back[0]], [-back[0], -back[1]]];
  const key = (p) => `${p.x},${p.y}`;
  const seen = new Set([key(tile), ...taken.map(key)]);
  const out = [];
  let frontier = [tile];
  for (let ring = 0; ring < 6 && out.length < n && frontier.length; ring += 1) {
    const next = [];
    for (const at of frontier) {
      for (const [dx, dy] of order) {
        const p = { x: at.x + dx, y: at.y + dy };
        if (seen.has(key(p))) continue;
        seen.add(key(p));
        let ok = false;
        try { ok = !!walkable(p.x, p.y); } catch { ok = false; }
        if (!ok) continue;
        next.push(p);
        if (out.length < n) out.push(p);
      }
    }
    frontier = next;
  }
  return out;
}

/** One step's worth of walking along a path of feet points: → { x, y, reached (a tile arrived at), dir }. */
export function stepToward(pos, goal, budget) {
  const dx = goal.x - pos.x;
  const dy = goal.y - pos.y;
  const dir = dx !== 0 ? (dx > 0 ? 'right' : 'left') : dy !== 0 ? (dy > 0 ? 'down' : 'up') : null;
  // One axis at a time, as Milo walks, so a follower turns corners on the grid.
  if (dx !== 0) {
    const s = Math.min(budget, Math.abs(dx));
    return { x: pos.x + Math.sign(dx) * s, y: pos.y, used: s, reached: s === Math.abs(dx) && dy === 0, dir };
  }
  const s = Math.min(budget, Math.abs(dy));
  return { x: pos.x, y: pos.y + Math.sign(dy) * s, used: s, reached: s === Math.abs(dy), dir };
}

const feetOf = (tile) => ({ x: tile.x * TILE + 8, y: tile.y * TILE + FEET });
const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/**
 * createFollowLayer(env) → the followers as a layer (update, settle, collect, hit, hidden), plus the
 * party calls the engine hands on. env: { painter, walkable(x, y), path(from, to), atGoal(dest, tile)
 * (optional: a walk to dest counts as there from tile, as Milo's does), speed() (px/s), walksOn(),
 * hidden(id), dressOf(follower) → genre id | null, tableFor(genre), onStep(id, tile), miloTile(),
 * miloDir(), wake() }.
 */
export function createFollowLayer(env) {
  let members = []; // followers in formation order
  let formation = 'line';
  let trail = []; // Milo's tiles, newest first; trail[0] is where he stands
  let selected = null;

  const byId = (id) => members.find((m) => m.id === id) || null;
  const stepsFor = () => formationSteps(formation, members.length);

  function placeAll(tile = env.miloTile(), dir = env.miloDir()) {
    trail = [{ x: tile.x, y: tile.y }];
    const spots = standAround(tile, members.length, env.walkable, { dir });
    members.forEach((m, i) => {
      const at = spots[i] || tile;
      m.tile = { x: at.x, y: at.y };
      ({ x: m.x, y: m.y } = feetOf(at));
      m.path = [];
      m.chained = true;
      if (m.walk) finishWalk(m, false); // a walk cut short by the trip (or the fight's end) says so
      m.dir = dir;
    });
    selected = null;
  }

  function setParty(list) {
    // Anyone left out stops, and a walk they were on ends unfinished.
    for (const m of members) if (m.walk && !(Array.isArray(list) && list.some((item) => item && item.id === m.id))) finishWalk(m, false);
    const next = [];
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.id !== 'string' || !item.id || item.id === 'milo' || next.some((m) => m.id === item.id)) continue;
      const known = byId(item.id);
      next.push(known ? { ...known, look: item.look || known.look, name: typeof item.name === 'string' ? item.name : known.name, sprite: null }
        : { id: item.id, key: `party:${item.id}`, look: item.look || null, name: typeof item.name === 'string' ? item.name : item.id, tile: null, x: 0, y: 0, path: [], chained: true, dir: 'down', stride: 0, walk: null, sprite: null });
    }
    const fresh = next.filter((m) => !m.tile);
    members = next;
    if (fresh.length) {
      const taken = members.filter((m) => m.tile).map((m) => m.tile);
      const spots = standAround(env.miloTile(), fresh.length, env.walkable, { dir: env.miloDir(), taken });
      fresh.forEach((m, i) => {
        const at = spots[i] || env.miloTile();
        m.tile = { x: at.x, y: at.y };
        ({ x: m.x, y: m.y } = feetOf(at));
      });
    }
    if (selected && !byId(selected)) selected = null;
  }

  // Walk a follower to a tile: onto its path, by the scene's own paths when it isn't next door.
  function queue(m, tile) {
    const last = m.path.length ? m.path[m.path.length - 1] : m.tile;
    if (same(last, tile)) return;
    if (adjacent(last, tile)) m.path.push({ x: tile.x, y: tile.y });
    else m.path.push(...env.path(last, tile).map((p) => ({ x: p.x, y: p.y })));
    if (!env.walksOn()) snap(m);
  }

  function snap(m) {
    const end = m.path[m.path.length - 1];
    if (end) {
      m.tile = { x: end.x, y: end.y };
      ({ x: m.x, y: m.y } = feetOf(end));
      env.onStep(m.id, m.tile);
    }
    m.path = [];
    if (m.walk) finishWalk(m, true);
  }

  function finishWalk(m, ok) {
    const walk = m.walk;
    m.walk = null;
    if (walk) walk.resolve(!!ok && walk.arrives && same(m.tile, walk.to));
  }

  /** Milo stood on a new tile: the trail moves on, and each chained follower takes its next tile. */
  function step(tile) {
    if (!members.length) return;
    if (trail.length && same(trail[0], tile)) return;
    trail.unshift({ x: tile.x, y: tile.y });
    if (trail.length > TRAIL_MAX) trail.length = TRAIL_MAX;
    const steps = stepsFor();
    members.forEach((m, i) => {
      if (!m.chained) return;
      const target = trail[steps[i]];
      // Never onto Milo's own tile (he turned back): wait for the trail to move on.
      if (target && !same(target, tile)) queue(m, target);
    });
    env.wake();
  }

  function chain(id, on) {
    const m = byId(id);
    if (!m) return false;
    if (!on) {
      m.chained = false;
      m.path = m.path.slice(0, 1); // finish the step it's in, then stand
      return true;
    }
    m.chained = true;
    if (selected === id) selected = null;
    if (m.walk) finishWalk(m, false); // chained back mid-walk: it rejoins instead
    const i = members.indexOf(m);
    const target = trail[stepsFor()[i]] || standAround(env.miloTile(), 1, env.walkable, { dir: env.miloDir(), taken: members.filter((o) => o !== m).map((o) => o.tile) })[0];
    if (target) queue(m, target);
    env.wake();
    return true;
  }

  function select(id) {
    selected = typeof id === 'string' && byId(id) ? id : null;
  }

  /** The follower a floor click or walkTo moves instead of Milo: the selected one, while it's unchained. */
  function walker() {
    const m = selected ? byId(selected) : null;
    return m && !m.chained ? m : null;
  }

  /**
   * Walk the selected unchained follower to a tile. → Promise<boolean>: whether it got there, as
   * Milo's walks say (a way found and walked; false with no way, and false when a trip, a fight,
   * chaining back or leaving the party cuts it short).
   */
  function walkMember(dest) {
    const m = walker();
    if (!m) return Promise.resolve(false);
    if (m.walk) finishWalk(m, false);
    m.path = m.path.slice(0, 1);
    const from = m.path.length ? m.path[0] : m.tile;
    const route = same(from, dest) ? [] : env.path(from, dest);
    const to = route.length ? route[route.length - 1] : from;
    // No way there: it only finishes the step it's in, and the walk says it didn't get there.
    const arrives = route.length > 0 || same(from, dest) || !!(env.atGoal && env.atGoal(dest, from));
    m.path.push(...route.map((p) => ({ x: p.x, y: p.y })));
    return new Promise((resolve) => {
      m.walk = { to, resolve, arrives };
      if (!m.path.length) finishWalk(m, true);
      else if (!env.walksOn()) snap(m);
      else env.wake();
    });
  }

  function update(dt) {
    let moving = false;
    const speed = env.speed();
    for (const m of members) {
      let budget = (speed * dt) / 1000;
      while (budget > 0 && m.path.length) {
        const next = m.path[0];
        const goal = feetOf(next);
        const r = stepToward(m, goal, budget);
        if (r.dir) m.dir = r.dir;
        m.x = r.x;
        m.y = r.y;
        m.stride += r.used;
        budget -= r.used;
        if (m.x === goal.x && m.y === goal.y) {
          m.path.shift();
          m.tile = { x: next.x, y: next.y };
          env.onStep(m.id, m.tile);
          if (!m.path.length && m.walk) finishWalk(m, true);
        }
        if (r.used === 0) break;
      }
      if (m.path.length) moving = true;
    }
    return moving;
  }

  function settle() {
    for (const m of members) if (m.path.length || m.walk) snap(m);
  }

  // ---------- drawing ----------

  function frameOf(m) {
    const look = m.look || {};
    if (look.kind === 'stray') {
      if (!m.sprite) {
        const sprite = composeStray({ archetype: look.archetype, bodyKey: look.bodyKey || 'r', parts: look.parts || [], eyeKey: look.eyeKey ?? null });
        let bottom = sprite.rows.length - 1;
        while (bottom > 0 && !/[^.]/.test(sprite.rows[bottom])) bottom -= 1;
        m.sprite = { rows: Object.freeze(sprite.rows), layers: Object.freeze(sprite.layers), feet: [sprite.rows[0].length >> 1, bottom], stray: true };
      }
      return m.sprite;
    }
    const frames = exploreFrames(look.kind === 'rig' ? look : { kind: 'rig', rig: 'robe', who: m.id }, m.dir);
    const walking = m.path.length > 0;
    const i = walking ? [1, 0, 2, 0][Math.floor(m.stride / 5) % 4] : 0;
    return frames[i] || frames[0] || null;
  }

  function canvasOf(m, frame) {
    if (frame.stray) {
      const [g0, g1] = m.look.genres || [];
      const t0 = env.tableFor(g0 || null);
      return env.painter.grid(frame.rows, t0, `${g0 || 'base'}|${g1 || g0 || 'base'}`, { mirror: m.dir === 'left', layers: frame.layers, table2: env.tableFor(g1 || g0 || null), tag: m.key });
    }
    const dress = frame.family ? env.dressOf(m) : null;
    const outfit = dress ? outfitGrid(frame.family, frame.rows) : null;
    if (outfit) return env.painter.grid(outfit.rows, null, `outfit:${dress}`, { layers: outfit.layers, table2: env.tableFor(dress), tag: m.key });
    return env.painter.grid(frame.rows, null, 'base', { tag: m.key });
  }

  function poseOf(m) {
    const frame = frameOf(m);
    if (!frame) return null;
    const w = frame.rows[0].length;
    const h = frame.rows.length;
    const fx = frame.stray && m.dir === 'left' ? w - 1 - frame.feet[0] : frame.feet[0];
    return { frame, w, h, sx: Math.round(m.x - fx), sy: Math.round(m.y - frame.feet[1]) };
  }

  function collect(drawables, target, visible, t, shadow) {
    for (const m of members) {
      if (env.hidden(m.key)) continue;
      const pose = poseOf(m);
      if (!pose || !visible(pose.sx, pose.sy, pose.w, pose.h)) continue;
      shadow(m.x, m.y, 10, 3, 0);
      const canvas = canvasOf(m, pose.frame);
      drawables.push({ y: m.y + 0.25, x: m.x, draw: () => target.drawImage(canvas, pose.sx, pose.sy) });
    }
  }

  function entity(m) {
    return { kind: 'party', id: m.key, x: m.tile.x, y: m.tile.y, label: m.name, member: m.id, approach: { x: m.tile.x, y: m.tile.y } };
  }

  function hit(ax, ay, t, opaque) {
    const hits = [];
    for (const m of members) {
      if (env.hidden(m.key)) continue;
      const pose = poseOf(m);
      if (!pose || ax < pose.sx - 1 || ay < pose.sy - 1 || ax >= pose.sx + pose.w + 1 || ay >= pose.sy + pose.h + 1) continue;
      const px = Math.floor(ax - pose.sx);
      const lx = pose.frame.stray && m.dir === 'left' ? pose.w - 1 - px : px;
      if (opaque(pose.frame.rows, lx, Math.floor(ay - pose.sy))) hits.push({ y: m.y, m });
    }
    hits.sort((a, b) => b.y - a.y);
    return hits.length ? entity(hits[0].m) : null;
  }

  /** keepClear rects (world px) for every follower drawn. */
  function rects() {
    const out = [];
    for (const m of members) {
      if (env.hidden(m.key)) continue;
      const pose = poseOf(m);
      if (pose) out.push({ kind: 'party', id: m.key, x: pose.sx, y: pose.sy, w: pose.w, h: pose.h });
    }
    return out;
  }

  return {
    // the party calls
    setParty,
    setFormation(value) {
      if (FORMATIONS[value]) formation = value;
    },
    formation: () => formation,
    tiles: () => members.map((m) => ({ id: m.key, x: m.tile.x, y: m.tile.y })),
    chain,
    select,
    walker,
    walkMember,
    reset: placeAll,
    /** Stand the followers where a fight left them (tiles by member id), chained, the trail fresh. */
    placeAt(tiles = {}) {
      placeAll();
      for (const m of members) {
        const at = tiles[m.id];
        if (at && Number.isInteger(at.x) && Number.isInteger(at.y)) {
          m.tile = { x: at.x, y: at.y };
          ({ x: m.x, y: m.y } = feetOf(at));
        }
      }
    },
    step,
    /** A fight began: everyone stops on the tile they last stood on, and a walk in hand ends unfinished. */
    halt() {
      for (const m of members) {
        if (m.path.length) ({ x: m.x, y: m.y } = feetOf(m.tile));
        m.path = [];
        if (m.walk) finishWalk(m, false);
      }
    },
    moving: () => members.some((m) => m.path.length > 0),
    busy: () => members.some((m) => m.path.length > 0),
    count: () => members.length,
    rects,
    // the layer
    update,
    settle,
    collect,
    hit,
    dispose() {
      for (const m of members) if (m.walk) finishWalk(m, false);
    },
  };
}
