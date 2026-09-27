// Genre palettes for rifts (see RIFTS.md and content/genres.json). A genre gives one
// colour per role; every palette key in that role takes the role's hue and saturation
// and keeps its own lightness offset from the role's anchor, so the world's shading
// (grass noise, roof shadows, highlights) survives the recolour. Pure; imports in Node.
import { PALETTE } from './sprites.js';

// The first key in each role is its anchor.
export const ROLES = Object.freeze({
  ink: ['o'],
  light: ['c', 'C'],
  ground: ['g', 'G', 'h', 'j'],
  foliage: ['l', 'q', 'L', 'M'],
  path: ['p', 'P'],
  water: ['w', 'W', 'f'],
  wood: ['b', 'B', 'n', 'm'],
  stone: ['s', 'S', 'z'],
  roof: ['r', 'R', 'Q'],
  flower: ['k', 'K'],
  glow: ['u', 'U', 'Y'],
  cool: ['e', 'E', 'N'],
  soft: ['v', 'V'],
  skin: ['t'],
});

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Every palette key (except the translucent shadow) → [r, g, b] in this genre. */
export function buildGenrePalette(genre) {
  const out = {};
  for (const [role, keys] of Object.entries(ROLES)) {
    const colour = genre.roles?.[role];
    if (!colour) continue;
    const [h, s, l] = rgbToHsl(hexToRgb(colour));
    const anchorL = rgbToHsl(hexToRgb(PALETTE[keys[0]].hex))[2];
    for (const key of keys) {
      const offset = rgbToHsl(hexToRgb(PALETTE[key].hex))[2] - anchorL;
      out[key] = hslToRgb([h, s, clamp(l + offset * (genre.contrast ?? 1), 0.03, 0.97)]);
    }
  }
  for (const [key, hex] of Object.entries(genre.overrides || {})) out[key] = hexToRgb(hex);
  return out;
}

/** The world's own palette as [{ key, rgb }], for matching rendered pixels back to keys. */
export function basePalette() {
  return Object.entries(PALETTE)
    .filter(([, { hex }]) => hex.startsWith('#'))
    .map(([key, { hex }]) => ({ key, rgb: hexToRgb(hex) }));
}
