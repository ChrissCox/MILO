// Captures of the wilds at the vale's own scale (CONTRACT-PHASE3.md §7.1, §9 E): chunk ground from
// src/world/wilds.js coloured by colouriseChunk (the Hush included), objects drawn from the sprite
// atlas (a labelled placeholder box for any sprite not drawn yet), and, at the gates, the vale
// itself from engine.renderMap(1) at its real position, so the seam can be judged.
//
//   node scripts/capture-chunks.mjs [seed] [area]
//
// Writes, to test-results/, for each area below:
//   chunks-<area>.png         a 3x3-chunk area, 96 x 96 tiles at 16 px
//   chunks-<area>-zoom.png    the focal point at 2x
//   chunks-<area>-clear.png   (regions) the same focal point without the Hush, to judge the ground
//   chunks-<area>-tier2.png   (gates) the focal point with the Stockade instead of the thicket
//   chunks-<area>-cropN.png   (some areas) a second look at a crossing or a corner, at 2x
//   chunks-<area>-seamN.png   (gates) where the wilds meet the vale, ground only, at 3x: the vale's
//                             own ground from engine.paintGround (no objects, and none of the
//                             harbour fog, which renderMap cuts off at the vale's edge)
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorldgen, CHUNK, GATES } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });
const seed = process.argv[2] || 'hushlands';
const only = process.argv[3] || null;
const words = JSON.parse(await readFile(path.join(repo, 'content', 'riftgen.json'), 'utf8'));
const world = createWorldgen({ seed, regionWords: words.regionWords });
const wilds = createWilds({ worldgen: world, maxChunks: 400 });

// ---------- the areas ----------

const gate = (id) => ({ x: GATES[id].edge.x + GATES[id].dir.x, y: GATES[id].edge.y + GATES[id].dir.y });
const anchor = (id) => world.anchorById[id];
const SIZE = 3 * CHUNK; // tiles a side

// A stretch of road with a sleeping lantern and a ruin close by.
function roadLanternRuin() {
  let best = null;
  for (const lantern of wilds.fixedPois().filter((p) => p.type === 'lantern' && !p.region)) {
    const cx = Math.floor(lantern.x / CHUNK);
    const cy = Math.floor(lantern.y / CHUNK);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const p of wilds.chunk(cx + dx, cy + dy).pois) {
          if (p.type !== 'ruin') continue;
          const d = Math.hypot(p.x - lantern.x, p.y - lantern.y);
          if (d < 28 && (!best || d < best.d)) best = { d, lantern, ruin: p };
        }
      }
    }
  }
  if (!best) return { x: 12, y: -18, note: 'no ruin near a road lantern' };
  return { x: Math.round((best.lantern.x + best.ruin.x) / 2), y: Math.round((best.lantern.y + best.ruin.y) / 2), note: `${best.lantern.id} and ${best.ruin.id}` };
}

const road = roadLanternRuin();
// Crops (tiles) must lie inside their area: 96 tiles a side round the focus.
const AREAS = [
  {
    name: 'north-gate', title: 'The north gate', focus: gate('gate:n'), vale: true,
    extra: [
      { x: 24, y: -14, w: 24, h: 14 }, // the gate's bridge over the river, and the Hush's edge
      { x: 48, y: -16, w: 30, h: 20 }, // the north-east corner, the river along the wall and its footbridge
    ],
    seams: [{ x: 54, y: -8, w: 20, h: 22 }], // that corner, and the river along the vale's east edge
  },
  {
    name: 'west-gate', title: 'The west gate', focus: gate('gate:w'), vale: true,
    extra: [
      { x: -26, y: -4, w: 30, h: 18 }, // the lake by the vale's west wall, and a footbridge over the river
    ],
    seams: [{ x: -12, y: -3, w: 20, h: 16 }],
  },
  {
    name: 'southwest-gate', title: 'The south-west gate and the bay', focus: gate('gate:sw'), vale: true,
    extra: [
      { x: 18, y: 36, w: 30, h: 16 }, // where the wall meets the bay
      { x: 0, y: 44, w: 20, h: 20 }, // the island in the river, and its footbridge
    ],
    seams: [{ x: 28, y: 38, w: 28, h: 12 }], // the bay's south edge
  },
  {
    name: 'east-gate', title: 'The east gate', focus: gate('gate:e'), vale: true,
    extra: [
      { x: 56, y: 24, w: 32, h: 16 }, // the vale's beach running on out along the bay
      { x: 70, y: 26, w: 30, h: 16 },
    ],
    seams: [{ x: 52, y: 36, w: 24, h: 14 }], // the bay's south-east corner
  },
  { name: 'whisperwood', title: 'The Whisperwood, waiting in the Hush', focus: anchor('whisperwood') },
  { name: 'cinderforge', title: 'Cinderforge', focus: anchor('cinderforge') },
  { name: 'archive-peaks', title: 'The Archive Peaks', focus: anchor('archive-peaks') },
  { name: 'glass-fen', title: 'The Glass Fen', focus: anchor('glass-fen') },
  { name: 'painted-hills', title: 'The Painted Hills', focus: anchor('painted-hills') },
  { name: 'dicing-downs', title: 'The Dicing Downs', focus: anchor('dicing-downs') },
  { name: 'road-lantern-ruin', title: `A road with a lantern and a ruin (${road.note})`, focus: { x: road.x, y: road.y } },
].filter((a) => !only || a.name === only).map((a) => ({
  ...a,
  x0: Math.round(a.focus.x - SIZE / 2),
  y0: Math.round(a.focus.y - SIZE / 2),
  w: SIZE,
  h: SIZE,
  zoom: { x: Math.round(a.focus.x - 15), y: Math.round(a.focus.y - 10), w: 30, h: 20, scale: 2 },
  extra: (a.extra || []).map((z) => ({ ...z, scale: 2 })),
  seams: (a.seams || []).map((z) => ({ ...z, scale: 3 })),
}));
for (const a of AREAS) {
  for (const z of [...a.extra, ...a.seams]) {
    if (z.x < a.x0 || z.y < a.y0 || z.x + z.w > a.x0 + a.w || z.y + z.h > a.y0 + a.h) throw new Error(`${a.name}: crop ${JSON.stringify(z)} runs past the area`);
  }
}

// ---------- render in the world preview (Electron) ----------

const userData = await mkdtemp(path.join(tmpdir(), 'milo-chunks-'));
const env = { ...process.env, MILO_PREVIEW_USER_DATA: userData, MILO_PREVIEW_SIZE: '800x600' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electronPath,
  args: [path.join(repo, 'scripts', 'world-preview-main.cjs'), `--user-data-dir=${userData}`],
  cwd: repo, env, timeout: 30000,
});

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${pathToFileURL(path.join(repo, 'scripts', 'world-preview.html')).href}?motion=0&crew=rest`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

  const started = Date.now();
  const shots = await page.evaluate(async ({ areas, seed, regionWords }) => {
    const url = (p) => new URL(p, location.href).href;
    const { createWorldgen } = await import(url('../src/world/worldgen.js'));
    const { createWilds, colouriseChunk, hushPalette, CHUNK_PX } = await import(url('../src/world/wilds.js'));
    const { SPRITES, PALETTE } = await import(url('../src/world/sprites.js'));
    const { MAP } = await import(url('../src/world/map.js'));
    const { basePaletteByCode } = await import(url('../src/world/wildsart.js'));
    const T = 16;
    const worldgen = createWorldgen({ seed, regionWords });
    const wilds = createWilds({ worldgen, maxChunks: 400 });
    const base = basePaletteByCode();
    const hush = hushPalette(base);
    const vale = window.__world.renderMap(1);
    // The vale's ground alone, for the seams (engine.js is another module's and may be mid-change).
    let valeGround = vale;
    try {
      const { paintGround } = await import(url('../src/world/engine.js'));
      const data = new Uint8ClampedArray(MAP.width * T * MAP.height * T * 4);
      paintGround(data);
      valeGround = document.createElement('canvas');
      valeGround.width = MAP.width * T;
      valeGround.height = MAP.height * T;
      valeGround.getContext('2d').putImageData(new ImageData(data, MAP.width * T, MAP.height * T), 0, 0);
    } catch (error) {
      console.warn('paintGround unavailable, seams use renderMap', error);
    }

    // Sprite canvases in a palette (base or hush), from the grids themselves.
    const hexRgba = (hex) => (hex.startsWith('rgba')
      ? hex.slice(5, -1).split(',').map((v, i) => (i === 3 ? Math.round(Number(v) * 255) : Number(v)))
      : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255));
    const tables = {
      base: Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hexRgba(v.hex)])),
    };
    const hushKeyed = hushPalette();
    tables.hush = Object.fromEntries(Object.entries(tables.base).map(([k, rgba]) => [k, hushKeyed[k] ? [...hushKeyed[k], rgba[3]] : rgba]));
    const canvasOf = (rows, table) => {
      const c = document.createElement('canvas');
      c.width = rows[0].length;
      c.height = rows.length;
      const ctx = c.getContext('2d');
      const image = ctx.createImageData(c.width, c.height);
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const rgba = table[ch];
        if (!rgba || ch === '.') return;
        image.data.set(rgba, (y * c.width + x) * 4);
      }));
      ctx.putImageData(image, 0, 0);
      return c;
    };
    const stampRows = (under, over, x, y) => under.map((row, yy) => [...row].map((ch, xx) => {
      const o = over[yy - y]?.[xx - x];
      return o && o !== '.' ? o : ch;
    }).join(''));
    const composed = {};
    const autotile = (prefix, mask) => {
      const name = `${prefix}:${mask.n ? 1 : 0}${mask.s ? 1 : 0}${mask.e ? 1 : 0}${mask.w ? 1 : 0}`;
      if (composed[name] !== undefined) return composed[name];
      const post = SPRITES[`${prefix}.post`]?.[0];
      if (!post) return (composed[name] = null);
      const w = post[0].length;
      const h = post.length;
      let rows = Array.from({ length: h }, () => '.'.repeat(w));
      for (const side of ['n', 'w', 'e']) if (mask[side] && SPRITES[`${prefix}.${side}`]) rows = stampRows(rows, SPRITES[`${prefix}.${side}`][0], 0, 0);
      rows = stampRows(rows, post, 0, 0);
      if (mask.s && SPRITES[`${prefix}.s`]) { const s = SPRITES[`${prefix}.s`][0]; rows = stampRows(rows, s, 0, h - s.length); }
      return (composed[name] = rows);
    };
    const atlas = new Map();
    const spriteRows = (o) => {
      if (o.kind === 'palisade' || o.kind === 'fence') return autotile(o.kind, o.mask || {});
      const frames = SPRITES[o.kind];
      return frames ? frames[(o.frame || 0) % frames.length] : null;
    };
    const drawn = (rows, hushed) => {
      const key = rows;
      let entry = atlas.get(key);
      if (!entry) { entry = {}; atlas.set(key, entry); }
      const which = hushed ? 'hush' : 'base';
      if (!entry[which]) entry[which] = canvasOf(rows, tables[which]);
      return entry[which];
    };
    // Sizes for sprites still being drawn (CONTRACT-PHASE3.md §9 D), for placeholder boxes.
    const FALLBACK = {
      'tree.birch': [32, 30], 'pine.snow': [18, 25], crag: [32, 28], 'crag.snow': [32, 28], 'basalt.column': [14, 26], 'rock.basalt': [14, 8],
      'dice.stone': [12, 12], 'lantern.post': [10, 22], ruin: [32, 22], cave: [32, 20], chest: [14, 11], 'chest.mimic': [14, 11], note: [8, 12],
      hamlet: [40, 36], statue: [14, 26], 'landmark.stone': [14, 22], 'ore.node': [14, 10], herbs: [12, 9], 'fishing.spot': [14, 8],
      thicket: [16, 18], palisade: [16, 24], gatehouse: [48, 40], 'gate.bell': [12, 22], 'war.table': [30, 18], banner: [8, 20],
    };
    const SHADOWS = {
      tree: [22, 6, -2], 'tree.blossom': [22, 6, -2], 'tree.birch': [20, 6, -2], pine: [14, 5, -1], 'pine.snow': [14, 5, -1], bush: [14, 4, -1], 'bush.berry': [14, 4, -1],
      rock: [14, 4, -1], 'rock.basalt': [14, 4, -1], 'basalt.column': [14, 4, -1], 'dice.stone': [12, 4, -1], stump: [14, 4, -1], crag: [30, 6, -2], 'crag.snow': [30, 6, -2],
      'lantern.post': [8, 3, -1], ruin: [30, 5, -1], cave: [30, 5, -1], chest: [14, 4, -1], 'chest.mimic': [14, 4, -1], hamlet: [42, 6, -1], statue: [14, 4, -1],
      'landmark.stone': [14, 4, -1], 'ore.node': [14, 4, -1], lantern: [8, 3, -1], 'lamp.post': [8, 3, -1], boat: [30, 4, 1], 'war.table': [28, 4, -1], thicket: [16, 4, -1], palisade: [14, 3, -1], 'palisade.jamb': [14, 3, -1],
      cabin: [46, 6, -1], tent: [30, 5, -1], tower: [44, 7, -2], crate: [14, 4, -1], barrel: [12, 4, -1], woodpile: [22, 4, -1], garden: [30, 3, 0], 'log.bench': [38, 4, -1], campfire: [16, 4, -3],
      flag: [6, 2, -1], 'crew.bench': [62, 4, -1], banner: [6, 2, 0], 'gate.bell': [14, 3, 0], gatehouse: [30, 4, 0],
    };
    const shadowCache = new Map();
    const shadowOf = (w, h) => {
      const k = `${w}x${h}`;
      if (shadowCache.has(k)) return shadowCache.get(k);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const image = ctx.createImageData(w, h);
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const nx = (x + 0.5 - w / 2) / (w / 2);
        const ny = (y + 0.5 - h / 2) / (h / 2);
        if (nx * nx + ny * ny <= 1) image.data.set(tables.base.x, (y * w + x) * 4);
      }
      ctx.putImageData(image, 0, 0);
      shadowCache.set(k, c);
      return c;
    };
    const place = (o) => {
      const rows = spriteRows(o);
      const size = rows ? [rows[0].length, rows.length] : FALLBACK[o.kind] || [14, 14];
      const baseX = (o.x + o.w / 2) * T + (o.dx || 0);
      const baseY = (o.y + o.h) * T + (o.dy || 0);
      return { o, rows, sw: size[0], sh: size[1], baseX, baseY, sx: Math.round(baseX - size[0] / 2), sy: Math.round(baseY - size[1]) };
    };
    const missing = new Set();
    const drawObject = (ctx, p, ox, oy, hushed) => {
      if (p.rows) { ctx.drawImage(drawn(p.rows, hushed), p.sx - ox, p.sy - oy); return; }
      missing.add(p.o.kind);
      ctx.fillStyle = hushed ? 'rgba(170,170,170,0.55)' : 'rgba(239,188,109,0.55)';
      ctx.fillRect(p.sx - ox, p.sy - oy, p.sw, p.sh);
      ctx.strokeStyle = '#3d4038';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.sx - ox + 0.5, p.sy - oy + 0.5, p.sw - 1, p.sh - 1);
      ctx.fillStyle = '#3d4038';
      ctx.font = '7px sans-serif';
      ctx.fillText(p.o.kind.slice(0, 7), p.sx - ox + 1, p.sy - oy + 8);
    };

    const out = [];
    for (const area of areas) {
      const W = area.w * T;
      const H = area.h * T;
      const ox = area.x0 * T;
      const oy = area.y0 * T;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#5b9169';
      ctx.fillRect(0, 0, W, H);
      const cx0 = Math.floor(area.x0 / 32);
      const cy0 = Math.floor(area.y0 / 32);
      const cx1 = Math.floor((area.x0 + area.w - 1) / 32);
      const cy1 = Math.floor((area.y0 + area.h - 1) / 32);
      const timings = { chunk: [], ground: [], colour: [] };
      const chunks = [];
      // ground only, for the seams at the vale's edge
      const bare = area.vale ? document.createElement('canvas') : null;
      if (bare) {
        bare.width = W;
        bare.height = H;
      }
      const bareCtx = bare ? bare.getContext('2d') : null;
      for (let cy = cy0; cy <= cy1; cy += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          let t0 = performance.now();
          const c = wilds.chunk(cx, cy);
          timings.chunk.push(performance.now() - t0);
          t0 = performance.now();
          for (let r = 0; r < CHUNK_PX; r += 64) wilds.ground(cx, cy, { from: r, to: r + 64 });
          timings.ground.push(performance.now() - t0);
          t0 = performance.now();
          const rgba = colouriseChunk(c.ground, { base, hush, hushMask: c.hush, originX: cx * CHUNK_PX, originY: cy * CHUNK_PX });
          timings.colour.push(performance.now() - t0);
          const tile = document.createElement('canvas');
          tile.width = CHUNK_PX; tile.height = CHUNK_PX;
          tile.getContext('2d').putImageData(new ImageData(rgba, CHUNK_PX, CHUNK_PX), 0, 0);
          ctx.drawImage(tile, cx * CHUNK_PX - ox, cy * CHUNK_PX - oy);
          if (bareCtx) bareCtx.drawImage(tile, cx * CHUNK_PX - ox, cy * CHUNK_PX - oy);
          chunks.push(c);
        }
      }
      if (area.vale) {
        ctx.drawImage(vale, -ox, -oy);
        bareCtx.drawImage(valeGround, -ox, -oy);
      }

      // Objects, y-sorted like the engine: wild props, the ring, and the vale's own props where
      // their sprites reach past its edge (the renderMap image stops at the vale's edge).
      const hushAtTile = (o) => (o.hush || 0) / 255;
      const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
      const items = [];
      for (const o of wilds.objectsIn(area.x0 - 3, area.y0 - 3, area.x0 + area.w + 3, area.y0 + area.h + 3)) {
        const s = hushAtTile(o);
        const hushed = s >= 0.999 || (s > 0 && (BAYER[o.y & 3][o.x & 3] + 0.5) / 16 < s);
        items.push({ p: place(o), hushed });
      }
      if (area.vale) {
        for (const o of wilds.ringObjects(area.tier || 1)) items.push({ p: place(o), hushed: false });
        for (const o of MAP.objects) {
          const p = place(o);
          if (p.sx >= 0 && p.sy >= 0 && p.sx + p.sw <= MAP.width * T && p.sy + p.sh <= MAP.height * T) continue;
          items.push({ p, hushed: false, vale: true });
        }
      }
      items.sort((a, b) => a.p.baseY - b.p.baseY || a.p.baseX - b.p.baseX);
      for (const { p } of items) {
        const sh = SHADOWS[p.o.kind];
        if (!sh || p.o.kind === 'boat') continue;
        ctx.drawImage(shadowOf(sh[0], sh[1]), Math.round(p.baseX - sh[0] / 2) - ox, Math.round(p.baseY - sh[1] / 2 + sh[2]) - oy);
      }
      for (const { p, hushed } of items) drawObject(ctx, p, ox, oy, hushed);

      // Tier 2 at the gates too: the same area with the Stockade.
      let tier2 = null;
      if (area.vale) {
        const c2 = document.createElement('canvas');
        c2.width = W; c2.height = H;
        const x2 = c2.getContext('2d');
        x2.imageSmoothingEnabled = false;
        x2.fillStyle = '#5b9169';
        x2.fillRect(0, 0, W, H);
        for (const c of chunks) {
          const rgba = colouriseChunk(c.ground, { base, hush, hushMask: c.hush, originX: c.cx * CHUNK_PX, originY: c.cy * CHUNK_PX });
          const tile = document.createElement('canvas');
          tile.width = CHUNK_PX; tile.height = CHUNK_PX;
          tile.getContext('2d').putImageData(new ImageData(rgba, CHUNK_PX, CHUNK_PX), 0, 0);
          x2.drawImage(tile, c.cx * CHUNK_PX - ox, c.cy * CHUNK_PX - oy);
        }
        x2.drawImage(vale, -ox, -oy);
        const items2 = items.filter((it) => !String(it.p.o.id).startsWith('thicket:'));
        for (const o of wilds.ringObjects(2)) items2.push({ p: place(o), hushed: false });
        items2.sort((a, b) => a.p.baseY - b.p.baseY || a.p.baseX - b.p.baseX);
        for (const { p } of items2) {
          const sh = SHADOWS[p.o.kind];
          if (!sh || p.o.kind === 'boat') continue;
          x2.drawImage(shadowOf(sh[0], sh[1]), Math.round(p.baseX - sh[0] / 2) - ox, Math.round(p.baseY - sh[1] / 2 + sh[2]) - oy);
        }
        for (const { p, hushed } of items2) drawObject(x2, p, ox, oy, hushed);
        tier2 = c2;
      }

      // The same focal point without the Hush, to judge the ground beneath it.
      let clear = null;
      if (!area.vale) {
        const z = area.zoom;
        const cc = document.createElement('canvas');
        cc.width = z.w * T;
        cc.height = z.h * T;
        const cx2 = cc.getContext('2d');
        cx2.imageSmoothingEnabled = false;
        for (const c of chunks) {
          const rgba = colouriseChunk(c.ground, { base, originX: c.cx * CHUNK_PX, originY: c.cy * CHUNK_PX });
          const tile = document.createElement('canvas');
          tile.width = CHUNK_PX; tile.height = CHUNK_PX;
          tile.getContext('2d').putImageData(new ImageData(rgba, CHUNK_PX, CHUNK_PX), 0, 0);
          cx2.drawImage(tile, c.cx * CHUNK_PX - z.x * T, c.cy * CHUNK_PX - z.y * T);
        }
        const zx0 = z.x * T;
        const zy0 = z.y * T;
        for (const { p } of items) {
          const sh = SHADOWS[p.o.kind];
          if (!sh || p.o.kind === 'boat') continue;
          cx2.drawImage(shadowOf(sh[0], sh[1]), Math.round(p.baseX - sh[0] / 2) - zx0, Math.round(p.baseY - sh[1] / 2 + sh[2]) - zy0);
        }
        for (const { p } of items) drawObject(cx2, p, zx0, zy0, false);
        clear = document.createElement('canvas');
        clear.width = cc.width * z.scale;
        clear.height = cc.height * z.scale;
        const cl = clear.getContext('2d');
        cl.imageSmoothingEnabled = false;
        cl.drawImage(cc, 0, 0, clear.width, clear.height);
      }
      const zoomOf = (src, z = area.zoom) => {
        const zc = document.createElement('canvas');
        zc.width = z.w * T * z.scale;
        zc.height = z.h * T * z.scale;
        const zx = zc.getContext('2d');
        zx.imageSmoothingEnabled = false;
        zx.drawImage(src, (z.x - area.x0) * T, (z.y - area.y0) * T, z.w * T, z.h * T, 0, 0, zc.width, zc.height);
        return zc.toDataURL('image/png');
      };
      const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
      out.push({
        name: area.name,
        full: canvas.toDataURL('image/png'),
        zoom: zoomOf(canvas),
        tier2: tier2 ? zoomOf(tier2) : null,
        extra: area.extra.map((z) => zoomOf(canvas, z)),
        seams: bare ? area.seams.map((z) => zoomOf(bare, z)) : [],
        clear: clear ? clear.toDataURL('image/png') : null,
        timings: { chunk: +avg(timings.chunk).toFixed(2), ground: +avg(timings.ground).toFixed(2), colour: +avg(timings.colour).toFixed(2) },
        objects: items.length,
      });
    }
    return { out, missing: [...missing].sort() };
  }, { areas: AREAS, seed, regionWords: words.regionWords });

  const written = [];
  for (const shot of shots.out) {
    const file = (suffix) => path.join(results, `chunks-${shot.name}${suffix}.png`);
    await writeFile(file(''), Buffer.from(shot.full.split(',')[1], 'base64'));
    await writeFile(file('-zoom'), Buffer.from(shot.zoom.split(',')[1], 'base64'));
    written.push(`test-results/chunks-${shot.name}.png`, `test-results/chunks-${shot.name}-zoom.png`);
    for (const [i, data] of shot.extra.entries()) {
      await writeFile(file(`-crop${i + 1}`), Buffer.from(data.split(',')[1], 'base64'));
      written.push(`test-results/chunks-${shot.name}-crop${i + 1}.png`);
    }
    for (const [i, data] of shot.seams.entries()) {
      await writeFile(file(`-seam${i + 1}`), Buffer.from(data.split(',')[1], 'base64'));
      written.push(`test-results/chunks-${shot.name}-seam${i + 1}.png`);
    }
    if (shot.clear) {
      await writeFile(file('-clear'), Buffer.from(shot.clear.split(',')[1], 'base64'));
      written.push(`test-results/chunks-${shot.name}-clear.png`);
    }
    if (shot.tier2) {
      await writeFile(file('-tier2'), Buffer.from(shot.tier2.split(',')[1], 'base64'));
      written.push(`test-results/chunks-${shot.name}-tier2.png`);
    }
  }
  console.log(JSON.stringify({
    errors,
    seconds: (Date.now() - started) / 1000,
    placeholders: shots.missing,
    timings: Object.fromEntries(shots.out.map((s) => [s.name, s.timings])),
    wrote: written,
  }, null, 1));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
