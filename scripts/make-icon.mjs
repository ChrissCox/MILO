// Draws MILO's app icon from the world's own palette and Milo sprite, then packs
// assets/milo.ico (plus assets/milo-256.png and a preview sheet in test-results/).
//
//   node scripts/make-icon.mjs
//
// Small sizes (16, 32, 48) use a 16 x 16 portrait of Milo. Large sizes (64 and up)
// use a 32 x 32 scene: Milo beside his lantern at dusk. Every size is a whole-pixel
// multiple of its grid, so the pixel art stays crisp.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE, MILO, grid } from '../src/world/sprites.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- colours ----------

function rgba(key) {
  if (key === '.') return [0, 0, 0, 0];
  const hex = PALETTE[key]?.hex;
  if (!hex) throw new Error(`Unknown palette key '${key}'`);
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(hex);
  if (m) return [+m[1], +m[2], +m[3], Math.round(+m[4] * 255)];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// ---------- a tiny key canvas ----------

function canvas(w, h, fill = '.') {
  return Array.from({ length: h }, () => Array(w).fill(fill));
}

function stamp(target, rows, x0, y0) {
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    const tx = x0 + x;
    const ty = y0 + y;
    if (key !== '.' && ty >= 0 && ty < target.length && tx >= 0 && tx < target[0].length) target[ty][tx] = key;
  }));
}

// Pixel-rounded rectangle mask with radius r.
function roundedMask(w, h, r) {
  const inside = (x, y) => {
    const cx = x < r ? r - 0.5 : x > w - 1 - r ? w - 1 - r + 0.5 : x;
    const cy = y < r ? r - 0.5 : y > h - 1 - r ? h - 1 - r + 0.5 : y;
    return (x + 0.5 - (cx + 0.5)) ** 2 + (y + 0.5 - (cy + 0.5)) ** 2 <= r * r + 0.25;
  };
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => inside(x, y)));
}

function edgeOf(mask, x, y) {
  const h = mask.length;
  const w = mask[0].length;
  if (!mask[y][x]) return false;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny][nx];
  });
}

// ---------- the small portrait (16 x 16) ----------

function portrait() {
  const size = 16;
  const mask = roundedMask(size, size, 3);
  const c = canvas(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!mask[y][x]) continue;
      c[y][x] = edgeOf(mask, x, y) ? 'L' : y < 6 ? 'h' : y < 11 ? 'g' : 'G';
    }
  }
  // Milo from the top of his hair to his coat buttons, one row down for headroom.
  stamp(c, MILO.down[0].slice(0, 15), 0, 1);
  return c;
}

// ---------- the large scene (32 x 32) ----------

const LANTERN = grid(`
  ..ooo..
  .oUUUo.
  ouuuuuo
  oUucuUo
  oUucuUo
  oUuuuUo
  .oUUUo.
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  ..omo..
  .ommmo.
  ooooooo
`);

const TREELINE = [
  '..LL......LLL.......LL.....LLL..',
  '.LLLL...LLlLLL....LLLLL...LLlLL.',
  'LLlLLL.LLLLLLLL..LLLlLLL.LLLLLLL',
  'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL',
];

function scene() {
  const size = 32;
  const mask = roundedMask(size, size, 5);
  const c = canvas(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!mask[y][x]) continue;
      // Dusk sky, a warm band at the horizon, then the meadow.
      c[y][x] = y < 7 ? 'V' : y < 12 ? 'v' : y < 15 ? 'k' : y < 22 ? 'g' : y < 27 ? 'G' : 'L';
    }
  }
  // A few early stars and a small full moon.
  for (const [x, y] of [[5, 4], [11, 2], [17, 5], [9, 8], [27, 9]]) if (mask[y][x]) c[y][x] = 'c';
  stamp(c, grid(`
    .uu.
    ucuu
    uuuU
    .uU.
  `), 22, 2);
  // Far trees along the horizon.
  stamp(c, TREELINE, 0, 12);
  // A sand path wandering in from the bottom edge.
  for (const [x, y, w] of [[13, 31, 7], [13, 30, 6], [14, 29, 5], [15, 28, 4], [16, 27, 3]]) {
    for (let i = 0; i < w; i += 1) if (mask[y][x + i]) c[y][x + i] = i === 0 || i === w - 1 ? 'P' : 'p';
  }
  // Grass tufts and two flowers.
  for (const [x, y] of [[3, 23], [4, 22], [26, 25], [27, 24], [8, 28]]) c[y][x] = 'h';
  c[24][4] = 'k';
  c[27][25] = 'u';
  // Soft shadows, then the lantern post and Milo.
  stamp(c, grid(`
    ..xxxxxxxxxx..
    .xxxxxxxxxxxx.
  `), 4, 28);
  stamp(c, grid(`
    .xxxxx.
  `), 22, 29);
  stamp(c, LANTERN, 22, 11);
  // A little glow around the lantern glass.
  for (const [x, y] of [[21, 13], [21, 14], [21, 15], [29, 13], [29, 14], [29, 15], [24, 10], [25, 10], [26, 10]]) {
    if (mask[y][x] && c[y][x] !== 'o') c[y][x] = 'u';
  }
  stamp(c, MILO.down[0], 5, 10);
  // Ink outline around the whole tile.
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (edgeOf(mask, x, y)) c[y][x] = 'o';
  return c;
}

// ---------- rasterise ----------

function raster(keys, scale) {
  const h = keys.length * scale;
  const w = keys[0].length * scale;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = rgba(keys[Math.floor(y / scale)][Math.floor(x / scale)]);
      const i = (y * w + x) * 4;
      // 'x' (the shadow) is a translucent ink: blend it over what's beneath at bake time.
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return { w, h, px };
}

// The shadow key is translucent; flatten it onto the grass it sits on so every
// pixel in the icon is fully opaque or fully clear.
function flattenShadows(keys) {
  const under = { x: 'G' };
  return keys.map((row, y) => row.map((key, x) => {
    if (key !== 'x') return key;
    return `x:${keys[y][x - 1] === 'x' ? under.x : under.x}`;
  }));
}

function rasterFlat(keys, scale) {
  const flat = flattenShadows(keys);
  const h = flat.length * scale;
  const w = flat[0].length * scale;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const key = flat[Math.floor(y / scale)][Math.floor(x / scale)];
      let colour;
      if (key.startsWith('x:')) {
        const base = rgba(key.slice(2));
        const [sr, sg, sb, sa] = rgba('x');
        const t = sa / 255;
        colour = [0, 1, 2].map((i) => Math.round(base[i] * (1 - t) + [sr, sg, sb][i] * t)).concat(255);
      } else colour = rgba(key);
      const i = (y * w + x) * 4;
      px.set(colour, i);
    }
  }
  return { w, h, px };
}

// ---------- PNG ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png({ w, h, px }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO (BMP entries up to 64 px for the widest compatibility, PNG above) ----------

function bmpEntry({ w, h, px }) {
  const maskRow = Math.ceil(w / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(w * h * 4 + maskRow * h, 20);
  const pixels = Buffer.alloc(w * h * 4);
  const mask = Buffer.alloc(maskRow * h);
  for (let y = 0; y < h; y += 1) {
    const src = h - 1 - y; // bottom-up
    for (let x = 0; x < w; x += 1) {
      const i = (src * w + x) * 4;
      const o = (y * w + x) * 4;
      pixels[o] = px[i + 2];
      pixels[o + 1] = px[i + 1];
      pixels[o + 2] = px[i];
      pixels[o + 3] = px[i + 3];
      if (px[i + 3] === 0) mask[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * images.length;
  for (const image of images) {
    const blob = image.w <= 64 ? bmpEntry(image) : png(image);
    const entry = Buffer.alloc(16);
    entry[0] = image.w >= 256 ? 0 : image.w;
    entry[1] = image.h >= 256 ? 0 : image.h;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(blob.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += blob.length;
    entries.push(entry);
    blobs.push(blob);
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

// ---------- build ----------

const small = portrait();
const large = scene();
const sizes = [
  { size: 16, keys: small, scale: 1 },
  { size: 24, keys: small, scale: 1, pad: 4 },
  { size: 32, keys: small, scale: 2 },
  { size: 48, keys: small, scale: 3 },
  { size: 64, keys: large, scale: 2 },
  { size: 96, keys: large, scale: 3 },
  { size: 128, keys: large, scale: 4 },
  { size: 256, keys: large, scale: 8 },
];

function padded(image, pad) {
  if (!pad) return image;
  const w = image.w + pad * 2;
  const h = image.h + pad * 2;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < image.h; y += 1) {
    px.set(image.px.subarray(y * image.w * 4, (y + 1) * image.w * 4), ((y + pad) * w + pad) * 4);
  }
  return { w, h, px };
}

const images = sizes.map(({ keys, scale, pad }) => padded(rasterFlat(keys, scale), pad));
mkdirSync(path.join(root, 'assets'), { recursive: true });
writeFileSync(path.join(root, 'assets', 'milo.ico'), ico(images));
writeFileSync(path.join(root, 'assets', 'milo-256.png'), png(images.at(-1)));

// Preview sheet: every size at 1x on cream and on dark, then the small grid at 8x.
const sheet = (() => {
  const gap = 12;
  const rowH = 256 + gap * 2;
  const width = images.reduce((sum, im) => sum + im.w + gap, gap) + 16 * 8 + gap;
  const height = rowH * 2;
  const px = new Uint8Array(width * height * 4);
  const fill = (y0, y1, [r, g, b]) => { for (let y = y0; y < y1; y += 1) for (let x = 0; x < width; x += 1) px.set([r, g, b, 255], (y * width + x) * 4); };
  fill(0, rowH, [251, 247, 233]);
  fill(rowH, height, [40, 44, 52]);
  const blit = (im, x0, y0) => {
    for (let y = 0; y < im.h; y += 1) for (let x = 0; x < im.w; x += 1) {
      const i = (y * im.w + x) * 4;
      const a = im.px[i + 3] / 255;
      if (!a) continue;
      const o = ((y0 + y) * width + x0 + x) * 4;
      for (let k = 0; k < 3; k += 1) px[o + k] = Math.round(im.px[i + k] * a + px[o + k] * (1 - a));
    }
  };
  for (const y0 of [gap, rowH + gap]) {
    let x = gap;
    for (const im of images) { blit(im, x, y0 + (256 - im.h)); x += im.w + gap; }
    blit(rasterFlat(small, 8), x, y0 + (256 - 128));
  }
  return { w: width, h: height, px };
})();
mkdirSync(path.join(root, 'test-results'), { recursive: true });
writeFileSync(path.join(root, 'test-results', 'icon-preview.png'), png(sheet));
console.log(`Wrote assets/milo.ico (${sizes.map((s) => s.size).join(', ')} px), assets/milo-256.png, test-results/icon-preview.png`);
