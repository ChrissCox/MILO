// Seeded randomness and noise for world and rift generation (WORLD.md, RIFTS.md §10).
// Pure and deterministic: the same seed always makes the same world, the same rift,
// the same stray. Imports cleanly in Node and the browser.

/** A 32-bit hash of a string (cyrb-style mixing). */
export function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Mixes any number of integers (or strings) into one 32-bit hash. */
export function hashInts(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    const v = typeof value === 'string' ? hashString(value) : value | 0;
    h = Math.imul(h ^ v, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A hash as a number in [0, 1). */
export const unit = (hash) => (hash >>> 0) / 4294967296;

/** A small seeded random source (mulberry32) with the helpers generation needs. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  const chance = (p) => next() < p;
  const weighted = (entries) => {
    // entries: [[value, weight], ...]
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (total <= 0) return entries[0]?.[0];
    let roll = next() * total;
    for (const [value, weight] of entries) {
      roll -= Math.max(0, weight);
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  };
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const sample = (list, n) => shuffle(list).slice(0, Math.max(0, n));
  return { next, int, pick, chance, weighted, shuffle, sample };
}

// ---------- noise ----------

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const GRADS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

/** 2D gradient (Perlin) noise in [0, 1]. */
export function perlin(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const dot = (ix, iy, dx, dy) => {
    const g = GRADS[hashInts(ix, iy, seed) & 7];
    return g[0] * dx + g[1] * dy;
  };
  const u = smooth(fx);
  const v = smooth(fy);
  const a = dot(x0, y0, fx, fy);
  const b = dot(x0 + 1, y0, fx - 1, fy);
  const c = dot(x0, y0 + 1, fx, fy - 1);
  const d = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const value = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return Math.max(0, Math.min(1, value * 0.7071 + 0.5));
}

/** Fractal noise: several octaves of Perlin noise, in [0, 1]. */
export function fbm(x, y, seed = 0, { octaves = 4, lacunarity = 2, gain = 0.5 } = {}) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * perlin(x * frequency, y * frequency, seed + i * 1013);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise, peaking at 1 along thin winding lines (good for rivers and ravines). */
export function ridged(x, y, seed = 0, options) {
  return 1 - Math.abs(fbm(x, y, seed, options) * 2 - 1);
}

export const smoothstep = (edge0, edge1, x) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
