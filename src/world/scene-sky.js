// The sky over the world (CONTRACT-PHASE4.md §11.4, §15; COMBAT.md §17 slice 4.4): day and night as
// a tint over the whole view, the lights that shine through it at night (the campfire, lit lanterns,
// the vale's lamps, bleeds' glow, the Hooklight), and the day's weather as particles on top. The
// numbers come from src/sky.js (skyAt: { daypart, light, night, season, tint: [r, g, b, a],
// weather: { kind, density, key }, key }), which the shell hands in with setSky.
//
// Nothing here repaints a chunk or any cached canvas of the world: the tint is one fill over the
// view, the lights are the engine's own glow canvases drawn again, and the weather is a small
// pre-made tile of particles, shifted by the time and drawn a few times across the view. The vale's
// own picture (renderMap) is never tinted: the engine draws layers only in the live view. Weather is
// decoration, so it holds still (isn't drawn) at t === null; the tint and lights are drawn still.
// Pure apart from the canvases it's given (env.makeCanvas); the particle layout is seeded.
import { PALETTE } from './sprites.js';
import { hashInts, unit } from './rng.js';

export const WEATHER_TILE = 128; // px: one tile of particles, repeated across the view
const DRIFT = Object.freeze({
  // px per second the pattern moves (x, y), and how each particle is drawn (w × h)
  rain: { vx: 18, vy: 120, w: 1, h: 3 },
  snow: { vx: 6, vy: 16, w: 1, h: 1 },
  mist: { vx: 5, vy: 0, w: 4, h: 1 },
  wind: { vx: 150, vy: 6, w: 3, h: 1 },
  leaves: { vx: 40, vy: 22, w: 2, h: 1 },
});
const MAX_DENSITY = 0.01;
const WARM = Object.freeze([255, 214, 150]);

const rgbOf = (key) => {
  const hex = PALETTE[key]?.hex || PALETTE.c.hex;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Where a weather kind's particles lie in one WEATHER_TILE square: [{ x, y }], seeded by the kind so
 * every frame and every run has the same pattern. Pure.
 */
export function weatherSpots(kind, density) {
  const d = Math.max(0, Math.min(MAX_DENSITY, Number(density) || 0));
  const n = Math.round(WEATHER_TILE * WEATHER_TILE * d);
  const seed = hashInts(kind.length, kind.charCodeAt(0), 'weather-spots');
  return Array.from({ length: n }, (_, i) => ({
    x: Math.floor(unit(hashInts(seed, i, 1)) * WEATHER_TILE),
    y: Math.floor(unit(hashInts(seed, i, 2)) * WEATHER_TILE),
  }));
}

/** How far a weather pattern has moved at time t (ms), wrapped to the tile. Pure. */
export function weatherOffset(kind, t) {
  const drift = DRIFT[kind] || DRIFT.snow;
  const s = (Number(t) || 0) / 1000;
  const wrap = (v) => ((Math.round(v) % WEATHER_TILE) + WEATHER_TILE) % WEATHER_TILE;
  return { x: wrap(drift.vx * s), y: wrap(drift.vy * s) };
}

/**
 * createSkyLayer(env) → the sky as a layer: setSky(sky | null), sky(), tint(target, view, t) (the
 * tint and, at night, the lights over it) and above(target, visible, t, view) (the weather).
 * env: { makeCanvas(w, h), lights(visible) → [{ x, y, r, alpha }] (world px), glow(r, alpha) → canvas }.
 */
export function createSkyLayer(env) {
  let sky = null;
  const tiles = new Map(); // weather kind|density → canvas
  let fill = null;

  function setSky(next) {
    if (!next || typeof next !== 'object' || !Array.isArray(next.tint) || next.tint.length !== 4) {
      sky = null;
      return;
    }
    const [r, g, b, a] = next.tint.map(Number);
    const alpha = Math.max(0, Math.min(0.8, Number.isFinite(a) ? a : 0));
    const light = Math.max(0, Math.min(1, Number.isFinite(next.light) ? next.light : 1));
    const weather = next.weather && typeof next.weather === 'object' && DRIFT[next.weather.kind] ? { kind: next.weather.kind, density: Number(next.weather.density) || 0, key: PALETTE[next.weather.key] ? next.weather.key : 'c' } : null;
    sky = { tint: [r | 0, g | 0, b | 0], alpha, light, night: !!next.night, weather, key: typeof next.key === 'string' ? next.key : '' };
    fill = `rgb(${sky.tint[0]},${sky.tint[1]},${sky.tint[2]})`;
  }

  function weatherTile(w) {
    const key = `${w.kind}|${w.density}|${w.key}`;
    let canvas = tiles.get(key);
    if (canvas) return canvas;
    const drift = DRIFT[w.kind];
    canvas = env.makeCanvas(WEATHER_TILE, WEATHER_TILE);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(WEATHER_TILE, WEATHER_TILE);
    const [r, g, b] = rgbOf(w.key);
    const alpha = w.kind === 'mist' ? 90 : 200;
    for (const spot of weatherSpots(w.kind, w.density)) {
      for (let dy = 0; dy < drift.h; dy += 1) {
        for (let dx = 0; dx < drift.w; dx += 1) {
          const x = (spot.x + dx) % WEATHER_TILE;
          const y = (spot.y + dy) % WEATHER_TILE;
          image.data.set([r, g, b, alpha], (y * WEATHER_TILE + x) * 4);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
    canvas._milo = 'sky';
    while (tiles.size >= 8) tiles.delete(tiles.keys().next().value);
    tiles.set(key, canvas);
    return canvas;
  }

  /** The tint over the view, then (as the light goes) the lights drawn back over it. */
  function tint(target, view, t, visible = () => true) {
    if (!sky || sky.alpha <= 0) return;
    target.globalAlpha = sky.alpha;
    target.fillStyle = fill;
    target.fillRect(view.x, view.y, view.w + 1, view.h + 1);
    target.globalAlpha = 1;
    const dark = 1 - sky.light;
    if (dark <= 0.05) return;
    for (const l of env.lights(visible)) {
      const r = Math.max(4, Math.round(l.r));
      target.globalAlpha = Math.min(1, dark * (l.alpha ?? 1));
      target.drawImage(env.glow(r, 0.5), Math.round(l.x - r), Math.round(l.y - r));
    }
    target.globalAlpha = 1;
  }

  /** The weather, over everything in view (with motion only). */
  function above(target, visible, t, view) {
    if (!sky || !sky.weather || t === null || !view || sky.weather.density <= 0) return;
    const canvas = weatherTile(sky.weather);
    const off = weatherOffset(sky.weather.kind, t);
    const x0 = Math.floor(view.x / WEATHER_TILE) * WEATHER_TILE + off.x - WEATHER_TILE;
    const y0 = Math.floor(view.y / WEATHER_TILE) * WEATHER_TILE + off.y - WEATHER_TILE;
    for (let y = y0; y < view.y + view.h + 1; y += WEATHER_TILE) {
      if (y + WEATHER_TILE < view.y) continue;
      for (let x = x0; x < view.x + view.w + 1; x += WEATHER_TILE) {
        if (x + WEATHER_TILE < view.x) continue;
        target.drawImage(canvas, x, y);
      }
    }
  }

  return {
    setSky,
    sky: () => (sky ? { ...sky, tint: [...sky.tint] } : null),
    tint,
    above,
    warm: WARM,
  };
}
