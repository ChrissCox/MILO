// The Blossomfield (PLAN.md Phase 5.4; LORE.md §9): a patch of the vale south of the camp where one
// flower blooms for every quest Chris has finished. Pure and deterministic: the same count always
// shows the same flowers, and a new one only ever adds to the field.
import { isWalkable, terrainAt, TERRAIN, placeAt } from './map.js';

/** The band of meadow it grows in (tiles). */
export const BLOSSOM_AREA = Object.freeze({ x: 20, y: 30, w: 22, h: 5 });
export const FLOWER_KINDS = Object.freeze(['flower.pink', 'flower.butter', 'flower.lavender', 'flower.cream']);

function hash(x, y, salt) {
  let h = 2166136261 ^ salt;
  for (const n of [x, y]) { h ^= n + 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

let cached = null;

/** Every tile a flower may grow on, in the order they bloom (scattered, not row by row). */
export function blossomTiles() {
  if (cached) return cached;
  const list = [];
  for (let y = BLOSSOM_AREA.y; y < BLOSSOM_AREA.y + BLOSSOM_AREA.h; y += 1) {
    for (let x = BLOSSOM_AREA.x; x < BLOSSOM_AREA.x + BLOSSOM_AREA.w; x += 1) {
      if (isWalkable(x, y) && terrainAt(x, y) === TERRAIN.GRASS && !placeAt(x, y)) list.push({ x, y, order: hash(x, y, 1) });
    }
  }
  cached = Object.freeze(list.sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x).map(({ x, y }) => Object.freeze({ x, y })));
  return cached;
}

/** The first `count` flowers: [{ x, y, kind, jx, jy }] with a small offset inside the tile. */
export function blossomsFor(count) {
  const n = Math.max(0, Math.min(Math.floor(Number(count) || 0), blossomTiles().length));
  return blossomTiles().slice(0, n).map(({ x, y }) => ({ x, y, kind: FLOWER_KINDS[hash(x, y, 2) % FLOWER_KINDS.length], jx: hash(x, y, 3) % 8, jy: hash(x, y, 4) % 8 }));
}
