// Walking in one world: the vale's own rules inside Hearthvale, the wilds' terrain outside it,
// and the ring between them shut except at the four gates (CONTRACT-PHASE3.md §3 and §7.1).
// Pure and Node-importable. findPath is A* over a window round the two ends, with typed arrays,
// four directions and an admissible heuristic (Manhattan distance times the cheapest step).
import { isWalkable as mapIsWalkable, terrainAt as mapTerrainAt, TERRAIN as VT } from './map.js';
import { CHUNK, HEART, TERRAIN_INFO } from './worldgen.js';
import { ringKind, ringDetours } from './wilds.js';

const inHeart = (x, y) => x >= 0 && y >= 0 && x < HEART.w && y < HEART.h;
const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, n) => ((a % n) + n) % n;

/** The vale's step costs, as map.findPath has them: paths and the dock 1, anything else 1.2. */
export function valeStepCost(x, y) {
  const t = mapTerrainAt(x, y);
  return t === VT.PATH || t === VT.DOCK ? 1 : 1.2;
}

// The cheapest step anywhere (a wild road or bridge, 0.6), so the heuristic never overestimates.
const CHEAPEST = Math.min(1, ...TERRAIN_INFO.filter((t) => t.walk && Number.isFinite(t.cost)).map((t) => t.cost));

/**
 * createNav({ valeWalkable, valeCost, worldgen, wildBlocked, extraBlocked, minCost })
 * → { walkable(x, y), cost(x, y), findPath(from, to, { maxNodes, margin }), nearestWalkable(tile, radius) }
 * Vale tiles: valeWalkable and valeCost. Wild tiles: TERRAIN_INFO walk and cost of the wilds'
 * terrain (worldgen's, with the roads the wilds move off the ring), and no blocking object
 * (wildBlocked). Ring walls never; gates always. extraBlocked shuts any other tile (the war
 * table, something standing in the way). Without a worldgen only the vale is walkable.
 */
export function createNav({
  valeWalkable = mapIsWalkable,
  valeCost = valeStepCost,
  worldgen = null,
  wildBlocked = () => false,
  extraBlocked = () => false,
  minCost = CHEAPEST,
} = {}) {
  // Terrain by chunk, remembering the last few chunks so long searches stay quick, with the roads
  // the wilds keep off the ring (ringDetours) so walking and drawing agree.
  const tileCache = new Map();
  let lastKey = null;
  let lastTiles = null;
  let detours = null;
  function terrain(x, y) {
    if (!detours) detours = ringDetours(worldgen);
    const d = detours.at(x, y);
    if (d !== undefined) return d;
    const cx = floorDiv(x, CHUNK);
    const cy = floorDiv(y, CHUNK);
    const key = cx * 131072 + cy;
    if (key !== lastKey) {
      let tiles = tileCache.get(key);
      if (!tiles) {
        tiles = worldgen.chunk(cx, cy).tiles;
        tileCache.set(key, tiles);
        if (tileCache.size > 96) tileCache.delete(tileCache.keys().next().value);
      }
      lastKey = key;
      lastTiles = tiles;
    }
    return lastTiles[mod(y, CHUNK) * CHUNK + mod(x, CHUNK)];
  }

  function walkable(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (inHeart(x, y)) return !!valeWalkable(x, y) && !extraBlocked(x, y);
    if (!worldgen) return false;
    const ring = ringKind(x, y);
    if (ring === 'wall') return false;
    if (ring === 'gate') return true;
    if (!TERRAIN_INFO[terrain(x, y)].walk) return false;
    return !wildBlocked(x, y) && !extraBlocked(x, y);
  }

  /** The cost of stepping onto a tile (Infinity where Milo can't stand). */
  function cost(x, y) {
    if (!walkable(x, y)) return Infinity;
    if (inHeart(x, y)) return valeCost(x, y);
    const c = TERRAIN_INFO[terrain(x, y)].cost;
    return Number.isFinite(c) ? c : 1; // a gate over water is still a gate
  }

  /** The nearest walkable tile within radius (itself first), or null. */
  function nearestWalkable(tile, radius = 3) {
    if (!tile) return null;
    const x0 = Math.round(tile.x);
    const y0 = Math.round(tile.y);
    if (walkable(x0, y0)) return { x: x0, y: y0 };
    for (let r = 1; r <= radius; r += 1) {
      let best = null;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!walkable(x0 + dx, y0 + dy)) continue;
          const d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { x: x0 + dx, y: y0 + dy, d };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    return null;
  }

  // Walkable stand-ins for an unwalkable target, as map.findPath picks them: the nearest ring
  // (within 3) of walkable neighbours, closest by Manhattan distance.
  function goalsFor(tx, ty) {
    if (walkable(tx, ty)) return [{ x: tx, y: ty }];
    for (let radius = 1; radius <= 3; radius += 1) {
      const ring = [];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          if (walkable(tx + dx, ty + dy)) ring.push({ x: tx + dx, y: ty + dy });
        }
      }
      if (ring.length) {
        const manhattan = (p) => Math.abs(p.x - tx) + Math.abs(p.y - ty);
        const best = Math.min(...ring.map(manhattan));
        return ring.filter((p) => manhattan(p) === best);
      }
    }
    return [];
  }

  /**
   * A* from `from` to `to` over a window round both (plus `margin` tiles), four directions.
   * Returns the tiles after `from`, ending at `to` or, when `to` can't be stood on, at the
   * nearest walkable tile within 3. [] when there is no way within the window or the node
   * budget, or when Milo is already there.
   */
  function findPath(from, to, { maxNodes = 40000, margin = 40 } = {}) {
    if (!from || !to) return [];
    const fx = Math.round(from.x);
    const fy = Math.round(from.y);
    const tx = Math.round(to.x);
    const ty = Math.round(to.y);
    if (![fx, fy, tx, ty].every(Number.isFinite)) return [];
    const goals = goalsFor(tx, ty);
    if (!goals.length) return [];
    if (goals.some((g) => g.x === fx && g.y === fy)) return [];
    const x0 = Math.min(fx, tx) - margin - 3;
    const y0 = Math.min(fy, ty) - margin - 3;
    const W = Math.max(fx, tx) - x0 + margin + 4;
    const H = Math.max(fy, ty) - y0 + margin + 4;
    const size = W * H;
    if (size > 4_000_000) return [];
    const g = new Float64Array(size).fill(Infinity);
    const came = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const stepCost = new Float32Array(size).fill(-1); // -1 = not looked at yet
    const goalIdx = new Set(goals.map((p) => (p.y - y0) * W + (p.x - x0)));
    const h = (x, y) => {
      let best = Infinity;
      for (const p of goals) {
        const d = Math.abs(p.x - x) + Math.abs(p.y - y);
        if (d < best) best = d;
      }
      return best * minCost;
    };
    const costAt = (i, x, y) => {
      let c = stepCost[i];
      if (c < 0) {
        c = cost(x, y);
        stepCost[i] = Number.isFinite(c) ? c : Infinity;
      }
      return c;
    };
    const heap = new Heap();
    const start = (fy - y0) * W + (fx - x0);
    g[start] = 0;
    heap.push(start, h(fx, fy));
    let expanded = 0;
    while (heap.size) {
      const current = heap.pop();
      if (closed[current]) continue;
      closed[current] = 1;
      if (goalIdx.has(current)) {
        const path = [];
        for (let node = current; node !== start; node = came[node]) path.push({ x: (node % W) + x0, y: Math.floor(node / W) + y0 });
        return path.reverse();
      }
      expanded += 1;
      if (expanded > maxNodes) return [];
      const cx = current % W;
      const cy = Math.floor(current / W);
      const prev = came[current];
      for (let k = 0; k < 4; k += 1) {
        const dx = k === 0 ? 1 : k === 1 ? -1 : 0;
        const dy = k === 2 ? 1 : k === 3 ? -1 : 0;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const next = ny * W + nx;
        if (closed[next]) continue;
        const c = costAt(next, nx + x0, ny + y0);
        if (!Number.isFinite(c)) continue;
        // A tiny nudge against turning keeps walks in calm straight lines, as in the vale.
        let turn = 0;
        if (prev >= 0 && (cx - (prev % W) !== dx || cy - Math.floor(prev / W) !== dy)) turn = 0.001;
        const cand = g[current] + c + turn;
        if (cand < g[next]) {
          g[next] = cand;
          came[next] = current;
          heap.push(next, cand + h(nx + x0, ny + y0));
        }
      }
    }
    return [];
  }

  return { walkable, cost, findPath, nearestWalkable, minCost };
}

// A binary heap of node indices by priority, in parallel arrays.
class Heap {
  constructor() {
    this.nodes = [];
    this.prio = [];
  }
  get size() {
    return this.nodes.length;
  }
  push(node, priority) {
    const { nodes, prio } = this;
    nodes.push(node);
    prio.push(priority);
    let i = nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= prio[i]) break;
      [nodes[parent], nodes[i]] = [nodes[i], nodes[parent]];
      [prio[parent], prio[i]] = [prio[i], prio[parent]];
      i = parent;
    }
  }
  pop() {
    const { nodes, prio } = this;
    const top = nodes[0];
    const lastNode = nodes.pop();
    const lastPrio = prio.pop();
    if (nodes.length) {
      nodes[0] = lastNode;
      prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < nodes.length && prio[l] < prio[m]) m = l;
        if (r < nodes.length && prio[r] < prio[m]) m = r;
        if (m === i) break;
        [nodes[m], nodes[i]] = [nodes[i], nodes[m]];
        [prio[m], prio[i]] = [prio[i], prio[m]];
        i = m;
      }
    }
    return top;
  }
}
