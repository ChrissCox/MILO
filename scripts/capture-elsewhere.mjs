// A sheet of rift drawing and Elsewheres (CONTRACT-PHASE3.md §7.2 and §7.3):
//   1. the tear in three stages for six genres, shimmering, warded, sealing and let go;
//   2. rifts bleeding into real wild ground on the frontier, with strays, a Tale-lead, weather
//      and Milo wearing the genre he stands in;
//   3. six Elsewheres at 2x: several genres, a fusion, a Maelstrom, mirrored and labyrinthine,
//      recoloured, with their objects, strays and Tale-leads.
//
//   node scripts/capture-elsewhere.mjs
//
// Writes test-results/elsewhere-sheet.png, plus each section on its own for a closer look:
// elsewhere-tears.png, elsewhere-frontier.png and elsewhere-scene-1..6.png. All pixels are
// composed here from the pure modules; the Electron preview host (as scripts/rift-preview.mjs
// uses it) only lays out labels and encodes the PNGs.
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SPRITES } from '../src/world/sprites.js';
import { buildGenrePalette } from '../src/world/genres.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { createWorldgen, CHUNK, TERRAIN } from '../src/world/worldgen.js';
import { basePaletteByCode, paintRegion, colourise } from '../src/world/wildsart.js';
import { hashInts, unit } from '../src/world/rng.js';
import {
  tearArt, sealArt, letGoFrame, artPixels, spriteTable, strayPixels, outfitPixels, bleedsFor, tileDressAt, makeDresser, strayActors,
  weatherPixels, genreIndex, TEAR_FRAMES,
} from '../src/world/riftfx.js';
import { buildElsewhere } from '../src/world/elsewhere.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });
const read = async (file) => JSON.parse(await readFile(path.join(repo, 'content', file), 'utf8'));
const words = await read('riftgen.json');
const genres = await read('genres.json');
const riftgen = createRiftgen({ words, genres });
const index = genreIndex(genres);
const IDS = genres.genres.map((g) => g.id);
const BASE = basePaletteByCode();
const T = 16;
const started = performance.now();
const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
const wildsUrl = new URL('../src/world/wilds.js', import.meta.url);
const wilds = existsSync(wildsUrl) ? await import(wildsUrl) : null;
let W = null;
try { W = wilds?.createWilds ? wilds.createWilds({ worldgen: world }) : null; } catch { W = null; }

// ---------- pixels ----------

const image = (width, height, fill = null) => {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) for (let i = 0; i < width * height; i += 1) data.set([...fill, 255], i * 4);
  return { width, height, data };
};
function blit(dst, src, x0, y0, { scale = 1, alpha = 1 } = {}) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4;
      const a = (src.data[i + 3] / 255) * alpha;
      if (a <= 0) continue;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = x0 + x * scale + sx;
          const py = y0 + y * scale + sy;
          if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
          const j = (py * dst.width + px) * 4;
          for (let c = 0; c < 3; c += 1) dst.data[j + c] = Math.round(dst.data[j + c] * (1 - a) + src.data[i + c] * a);
          dst.data[j + 3] = 255;
        }
      }
    }
  }
}
const scaled = (src, scale) => { const out = image(src.width * scale, src.height * scale); blit(out, src, 0, 0, { scale }); return out; };
function rowsImage(rows, table) {
  const w = rows[0].length;
  const h = rows.length;
  const out = image(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const c = table[row[x]];
      if (c) out.data.set(c.length === 4 ? c : [...c, 255], (y * w + x) * 4);
    }
  });
  return out;
}
const put = (img, x, y, rgb) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set([...rgb, 255], (y * img.width + x) * 4);
};

// Sprites the art module may not have drawn yet get a stand-in, so the sheet still reads.
const STAND_INS = {
  chest: ['...oooooooo...', '..obbbbbbbbo..', '.obnnnnnnnnbo.', 'obBBBBBBBBBBBo', 'ooooooUUoooooo', 'obbbbbUUbbbbbo', 'obbbbbbbbbbbbo', 'oBBBBBBBBBBBBo', '.oooooooooooo.'],
  curio: ['....oo....', '...ovvo...', '..ovcvVo..', '..oVvvVo..', '...oVVo...', '....oo....', '...osso...', '..osSSso..', '.oooooooo.'],
  'exit.door': [
    '....oooooo....', '...ocuuuuco...', '..ocuUUUUuco..', '.ocuUccccUuco.', '.ocUcccccCUco.', '.ocUcccccCUco.',
    '.ocUccccCcUco.', '.ocUcccccCUco.', '.ocUcccccCUco.', '.ocUccccccUco.', '.ocUcccccCUco.', '.ocUcccccCUco.',
    '.ocUccccCcUco.', '.ocUcccccCUco.', '.ocUcccccCUco.', 'oooooooooooooo',
  ],
};
const ALIASES = { 'tree.birch': 'tree', 'pine.snow': 'pine', 'lantern.post': 'lantern', 'dice.stone': 'rock', 'rock.basalt': 'rock', 'crag': 'rock', 'crag.snow': 'rock', 'basalt.column': 'rock', 'herbs': 'bush.berry', 'ore.node': 'rock', 'stump': 'stump' };
const missing = new Set();
function spriteRows(name, frame = 0) {
  if (SPRITES[name]) return SPRITES[name][Math.min(frame, SPRITES[name].length - 1)];
  missing.add(name);
  if (STAND_INS[name]) return STAND_INS[name];
  if (ALIASES[name] && SPRITES[ALIASES[name]]) return SPRITES[ALIASES[name]][0];
  return null;
}
/** Draws for a y-sorted pass: { y (feet), draw(img) }. */
const byFeet = (a, b) => a.y - b.y || a.x - b.x;

// ---------- 1. the tears ----------

const TEAR_GENRES = ['neon', 'nocturne', 'gothic', 'iron', 'void', 'starlight'];
/** A patch of real wild grass (key codes) to stand the tears on: open grass, no objects, and the
 * fewest flowers and tufts, so the tears have the stage to themselves. */
function findGrass(w, h) {
  if (!W) return null;
  const plain = new Set([...'gjGh'].map((ch) => ch.charCodeAt(0)));
  let best = null;
  let bestBusy = Infinity;
  const tw = Math.ceil(w / T) + 1;
  const th = Math.ceil(h / T) + 1;
  const open = new Set([TERRAIN.GRASS, TERRAIN.MEADOW]);
  for (const [cx, cy] of [[0, -1], [1, -1], [-1, -1], [2, 0], [2, 1], [-1, 0], [0, 2], [-2, 0]]) {
    const chunk = W.chunk(cx, cy);
    W.ground(cx, cy);
    const taken = new Set(chunk.objects.map((o) => `${o.x - cx * CHUNK},${o.y - cy * CHUNK}`));
    for (let ty = 0; ty + th <= CHUNK; ty += 1) {
      for (let tx = 0; tx + tw <= CHUNK; tx += 1) {
        let ok = true;
        for (let j = -1; j <= th && ok; j += 1) for (let i = 0; i < tw && ok; i += 1) {
          const y = ty + j;
          if (y < 0 || y >= CHUNK) continue;
          if (!open.has(chunk.tiles[y * CHUNK + tx + i]) || taken.has(`${tx + i},${y}`)) ok = false;
        }
        if (!ok) continue;
        const keys = new Uint8Array(w * h);
        for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) keys[y * w + x] = chunk.ground[(ty * T + y) * CHUNK * T + tx * T + x];
        if (!keys.every((k) => k > 0)) continue;
        const busy = keys.reduce((n, k) => n + (plain.has(k) ? 0 : 1), 0);
        if (busy < bestBusy) { best = keys; bestBusy = busy; }
      }
    }
  }
  return best;
}
const GRASS = findGrass(46, 52);
function groundPatch(genre, w, h, seed) {
  const palette = buildGenrePalette(genre);
  if (GRASS) {
    // Real wild grass (flowers, tufts and all), in the genre's colours.
    const out = image(w, h);
    for (let i = 0; i < w * h; i += 1) {
      const key = String.fromCharCode(GRASS[i]);
      out.data.set([...(palette[key] || BASE[GRASS[i]] || palette.g), 255], i * 4);
    }
    return out;
  }
  // Without the wilds: the genre's grass with soft patches.
  const out = image(w, h, palette.g);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (unit(hashInts(x >> 2, y >> 2, seed)) > 0.8) put(out, x, y, palette.j);
    }
  }
  return out;
}
function tearsSection() {
  const CELL_W = 46;
  const CELL_H = 52;
  const S = 4;
  const columns = [
    { title: 'Hairline', make: (g) => tearArt('hairline', g, 0) },
    { title: 'Open', make: (g) => tearArt('open', g, 0) },
    { title: 'Gaping', make: (g) => tearArt('gaping', g, 0) },
    { title: 'Gaping, shimmering', make: (g) => tearArt('gaping', g, 2) },
    { title: 'Warded', make: (g) => tearArt('open', g, 1, { warded: true }) },
    { title: 'Sealing', make: (g) => sealArt('open', g, 0.72) },
    { title: 'Let go', make: (g) => letGoFrame('open', g, 0.5) },
  ];
  const labelW = 190;
  const headH = 40;
  const out = image(labelW + columns.length * CELL_W * S, headH + TEAR_GENRES.length * CELL_H * S, [35, 38, 45]);
  const labels = columns.map((c, n) => ({ text: c.title, x: labelW + n * CELL_W * S + 10, y: 26, small: true, light: true }));
  TEAR_GENRES.forEach((id, row) => {
    const genre = index.get(id);
    labels.push({ text: genre.name, sub: genre.genre.replace(/ \(.*\)/, ''), x: 12, y: headH + row * CELL_H * S + 34, light: true });
    columns.forEach((column, col) => {
      const cell = groundPatch(genre, CELL_W, CELL_H, hashInts(row, col));
      const art = column.make(genre);
      const feetX = CELL_W >> 1;
      const feetY = CELL_H - 10;
      blit(cell, artPixels(art), feetX - art.anchor.x + (art.dx ? Math.max(-18, Math.round(art.dx / 3)) : 0), feetY - art.anchor.y + (art.dy || 0) * 0.6, { alpha: art.alpha ?? 1 });
      blit(out, cell, labelW + col * CELL_W * S + 2, headH + row * CELL_H * S + 2, { scale: S });
    });
  });
  // Nudge the let-go and seal cells so their motion reads: a note under the header.
  return { img: out, labels, title: 'The tear', sub: `three stages, ${TEAR_FRAMES} shimmer frames, the Bindery's ward, the seal and the let-go moth`, file: 'elsewhere-tears.png' };
}

// ---------- 2. a bleed on the frontier ----------

async function frontierSection() {
  // West of the vale: birchwood and forest just outside the walls.
  const box = { x0: -40, y0: 3, w: 38, h: 25 };
  const walkable = (x, y) => !world.inHeart(x, y) && world.walkable(x, y) && !(W && W.blocked(x, y));
  const near = (x, y) => {
    for (let r = 0; r < 8; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(x + dx, y + dy) && walkable(x + dx + 1, y + dy) && walkable(x + dx - 1, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
    return { x, y };
  };
  const real = (key, subject, signals, urgency, stage) => ({ ...riftgen.realRift({ key, subject, signals, urgency }), stage });
  const mk = (spec, at, over = {}) => ({ id: spec.id, key: spec.key, kind: spec.kind, spec, ...at, stage: spec.stage, held: null, warded: null, ...over });
  const neon = mk(real('capacity:codex:1', 'Codex', ['crew-capacity-high'], 0.6, 'open'), near(-31, 10));
  const manor = mk(real('knock:claude:demo', 'Letters to answer', ['needs-you-unanswered', 'working-past-bell'], 0.9, 'gaping'), near(-15, 17));
  const frontier = mk(real('built:demo', 'the Clip studio', ['deadline-near'], 0.2, 'hairline'), near(-8, 7));
  const voidWarded = mk(real('scope:demo', 'the MILO plan', ['task-too-vague'], 0.5, 'open'), near(-34, 23), { warded: { until: 0, stage: 'open' } });
  const rifts = [neon, manor, frontier, voidWarded];
  const t = 9400;

  // Ground: the wilds' own chunk painter when it's there, else wildsart at 16 px a tile.
  const PW = box.w * T;
  const PH = box.h * T;
  const out = image(PW, PH, [91, 145, 105]);
  let groundFrom = 'wildsart.paintRegion at 16 px a tile';
  let objects = [];
  if (W && wilds.colouriseChunk) {
    groundFrom = 'wilds.js chunks and colouriseChunk';
    const hush = wilds.hushPalette ? wilds.hushPalette(BASE) : null;
    for (let cy = Math.floor(box.y0 / CHUNK); cy <= Math.floor((box.y0 + box.h - 1) / CHUNK); cy += 1) {
      for (let cx = Math.floor(box.x0 / CHUNK); cx <= Math.floor((box.x0 + box.w - 1) / CHUNK); cx += 1) {
        const chunk = W.chunk(cx, cy);
        W.ground(cx, cy);
        const originX = cx * CHUNK * T;
        const originY = cy * CHUNK * T;
        const bleeds = rifts.flatMap((r) => bleedsFor(r, { genres, originX, originY }));
        const rgba = wilds.colouriseChunk(chunk.ground, { base: BASE, hush, hushMask: chunk.hush, bleeds, originX, originY });
        blit(out, { width: CHUNK * T, height: CHUNK * T, data: rgba }, originX - box.x0 * T, originY - box.y0 * T);
        objects.push(...chunk.objects);
      }
    }
    objects = objects.filter((o) => o.x >= box.x0 - 1 && o.y >= box.y0 - 1 && o.x <= box.x0 + box.w && o.y <= box.y0 + box.h + 2);
  } else {
    const region = paintRegion(world, box.x0, box.y0, box.w, box.h, T);
    const bleeds = rifts.flatMap((r) => bleedsFor(r, { genres, originX: box.x0 * T, originY: box.y0 * T }));
    blit(out, { width: PW, height: PH, data: colourise(region.keys, PW, PH, BASE, bleeds) }, 0, 0);
  }

  const draws = [];
  const worldToLocal = (wx, wy) => ({ x: wx - box.x0 * T, y: wy - box.y0 * T });
  for (const o of objects) {
    const name = o.kind === 'lantern.post' && SPRITES['lantern.post'] ? 'lantern.post' : o.kind;
    const rows = spriteRows(name, o.frame || 0);
    if (!rows) continue;
    const baseX = (o.x + (o.w || 1) / 2) * T + (o.dx || 0);
    const baseY = (o.y + (o.h || 1)) * T + (o.dy || 0);
    // dressed whole by the tile it stands on (never by one dithered pixel of the fringe)
    const genre = tileDressAt(rifts, o.x, o.y, { genres });
    const img = rowsImage(rows, spriteTable(genre ? index.get(genre) : null));
    const at = worldToLocal(baseX - img.width / 2, baseY - img.height);
    draws.push({ y: baseY, x: baseX, draw: (dst) => blit(dst, img, at.x, at.y) });
  }
  for (const r of rifts) {
    const art = tearArt(r.stage, index.get(r.spec.genres[0]), 1, { warded: Boolean(r.warded) });
    const feet = { x: r.x * T + 8, y: r.y * T + 13 };
    const at = worldToLocal(feet.x - art.anchor.x, feet.y - art.anchor.y);
    draws.push({ y: feet.y, x: feet.x, draw: (dst) => blit(dst, artPixels(art), at.x, at.y) });
    for (const actor of strayActors(r, { walkable, seed: 'hushlands', words })) {
      const p = actor.positionAt(actor.lead ? null : t);
      const img = strayPixels(actor.sprite, actor.genre, actor.second, { genres });
      const flip = p.dir === 'left';
      const shown = flip ? mirror(img) : img;
      const pos = worldToLocal(p.x - (flip ? img.width - 1 - actor.feet.x : actor.feet.x), p.y - actor.feet.y + (actor.hover ? -2 : 0));
      draws.push({ y: p.y, x: p.x, draw: (dst) => blit(dst, shown, pos.x, pos.y) });
    }
  }
  // Milo, standing in the Neon bleed: his raincoat and scarf go the genre's way, and he keeps
  // his own face and hair (outfitPixels, as the engine dresses him).
  const milo = { x: (neon.x + 2) * T + 8, y: (neon.y + 2) * T + 13 };
  const miloGenre = makeDresser({ genres })(rifts, milo.x, milo.y - 1);
  const miloImg = outfitPixels('milo.down', spriteRows('milo.down'), miloGenre, { genres });
  const mAt = worldToLocal(milo.x - 8, milo.y - 19);
  draws.push({ y: milo.y, x: milo.x, draw: (dst) => blit(dst, miloImg, mAt.x, mAt.y) });
  draws.sort(byFeet);
  for (const d of draws) d.draw(out);
  // Weather, over everything, inside each bleed.
  for (const r of rifts) {
    for (const p of weatherPixels(r, { genres, t, rifts })) {
      const at = worldToLocal(p.x, p.y);
      put(out, at.x, at.y, p.rgb);
    }
  }
  const S = 2;
  const img = scaled(out, S);
  const labels = [
    { text: `${neon.spec.name}`, sub: 'Neon · open · strays wander out', x: (neon.x - box.x0 - 4) * T * S, y: (neon.y - box.y0 - 5) * T * S },
    { text: `${manor.spec.name}`, sub: 'a fusion · gaping · the Tale-lead stands by it', x: (manor.x - box.x0 - 7) * T * S, y: (manor.y - box.y0 + 8) * T * S },
    { text: 'A hairline', sub: 'Frontier · a hint, no strays', x: (frontier.x - box.x0 - 6) * T * S, y: (frontier.y - box.y0 - 3.4) * T * S },
    { text: 'Warded', sub: 'Void · a binding stitch holds it', x: (voidWarded.x - box.x0 + 3) * T * S, y: (voidWarded.y - box.y0 - 1.5) * T * S },
  ];
  return { img, labels, title: 'Bleeds on the frontier', sub: `real wild ground west of the vale (${groundFrom}), with weather, strays and Milo in Neon`, file: 'elsewhere-frontier.png' };
}

function mirror(img) {
  const out = image(img.width, img.height);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      out.data.set(img.data.subarray(i, i + 4), (y * img.width + (img.width - 1 - x)) * 4);
    }
  }
  return out;
}

// ---------- 3. Elsewheres ----------

function genreSpec(genre, seed, extra = {}) {
  const weights = Object.fromEntries(IDS.map((id) => [id, id === genre ? 100 : 1e-6]));
  for (let n = seed; ; n += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(n, 'capture'), tier: 3, depth: 2, weights });
    if (spec.genres.length === 1) return { ...spec, ...extra };
  }
}
function withAffix(spec, id) {
  const affix = words.affixes.find((a) => a.id === id);
  return { ...spec, affixes: [{ id, name: affix.name, text: affix.text }, ...spec.affixes.filter((a) => a.id !== id)] };
}

function drawElsewhere(spec, t = 7300) {
  const layout = riftgen.layout(spec);
  const scene = buildElsewhere(spec, layout, { genres, words });
  const out = { width: scene.width, height: scene.height, data: scene.rgba(BASE) };
  const draws = [];
  const dress = (px, py) => { const id = scene.genreAt(px, py); return spriteTable(id ? index.get(id) : null); };
  for (const o of scene.objects) {
    const feetX = o.x * T + 8 + (o.dx || 0);
    const feetY = o.y * T + 13 + (o.dy || 0);
    if (o.kind === 'stitch') {
      const art = tearArt(spec.stage, index.get(o.genre), 1);
      draws.push({ y: feetY, x: feetX, draw: (dst) => blit(dst, artPixels(art), o.x * T + 8 - art.anchor.x, o.y * T + 13 - art.anchor.y) });
    } else if (o.kind === 'tale-lead') {
      const img = scaled(strayPixels(o.sprite, o.genre, null, { genres }), 2);
      draws.push({ y: feetY, x: feetX, draw: (dst) => blit(dst, img, feetX - o.feet.x * 2, feetY - o.feet.y * 2) });
    } else {
      const rows = spriteRows(o.sprite, 0);
      if (!rows) continue;
      const img = rowsImage(rows, o.native ? spriteTable(null) : dress(feetX, feetY));
      const baseY = (o.y + 1) * T + (o.dy || 0);
      draws.push({ y: baseY, x: feetX, draw: (dst) => blit(dst, img, feetX - Math.floor(img.width / 2), baseY - img.height) });
    }
  }
  for (const s of scene.strays) {
    const p = s.positionAt(t);
    const img = strayPixels(s.sprite, s.genre, s.second, { genres });
    const flip = p.dir === 'left';
    const shown = flip ? mirror(img) : img;
    draws.push({ y: p.y, x: p.x, draw: (dst) => blit(dst, shown, p.x - (flip ? img.width - 1 - s.feet.x : s.feet.x), p.y - s.feet.y + (s.hover ? -2 : 0)) });
  }
  // Milo, a step out of the door, his coat and scarf dressed in the story he's stepped into.
  const mx = scene.spawn.x * T + 8;
  const my = scene.spawn.y * T + 13;
  const miloName = SPRITES[`milo.${scene.spawn.dir}`] ? `milo.${scene.spawn.dir}` : 'milo.down';
  const miloImg = outfitPixels(miloName, spriteRows(miloName), scene.genreAt(mx, my - 1), { genres });
  draws.push({ y: my, x: mx, draw: (dst) => blit(dst, miloImg, mx - 8, my - 19) });
  draws.sort(byFeet);
  for (const d of draws) d.draw(out);
  return { img: out, scene, layout };
}

function scenesSection() {
  const fusion = { ...riftgen.realRift({ key: 'knock:claude:demo', subject: 'Letters to answer', signals: ['needs-you-unanswered', 'working-past-bell'], urgency: 0.5 }) };
  const maelstrom = riftgen.realRift({ key: 'project:milo-plan', subject: 'the MILO plan', signals: ['check-failing', 'task-stale', 'deadline-near'], urgency: 0.5 });
  const picks = [
    { spec: withAffix(genreSpec('neon', 3, { stage: 'open' }), 'flooded'), note: 'flooded, with stepping stones where they’re needed' },
    { spec: withAffix(genreSpec('gothic', 11, { stage: 'hairline' }), 'overgrown'), note: 'overgrown with reeds and bushes' },
    { spec: fusion, note: 'a fusion, and a real rift: its seam won’t take the thread' },
    { spec: maelstrom, note: 'a Maelstrom: three stories in one patchwork, the Tale-lead with its council' },
    { spec: withAffix(genreSpec('frontier', 5, { stage: 'open' }), 'mirrored'), note: 'mirrored' },
    { spec: withAffix(genreSpec('void', 8, { stage: 'hairline' }), 'labyrinthine'), note: 'labyrinthine' },
  ];
  const S = 2;
  return picks.map(({ spec, note }, n) => {
    const { img, scene } = drawElsewhere(spec);
    const genresText = spec.genres.map((id) => index.get(id).name).join(' + ');
    const affixes = spec.affixes.map((a) => a.name.toLowerCase()).join(', ');
    return {
      img: scaled(img, S),
      labels: [],
      title: spec.name,
      sub: `${genresText} · ${note} · ${spec.stage} · ${affixes || 'no affixes'} · ${scene.w}×${scene.h} tiles, ${scene.strays.length} strays`,
      file: `elsewhere-scene-${n + 1}.png`,
    };
  });
}

// ---------- compose ----------

const sections = [tearsSection(), await frontierSection(), ...scenesSection()];
const b64 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const payload = sections.map((s) => ({ ...s, img: { width: s.img.width, height: s.img.height, data: b64(s.img.data) } }));
const composedMs = Math.round(performance.now() - started);

const userData = await mkdtemp(path.join(tmpdir(), 'milo-elsewhere-'));
const env = { ...process.env, MILO_PREVIEW_USER_DATA: userData, MILO_PREVIEW_SIZE: '900x600' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electronPath,
  args: [path.join(repo, 'scripts', 'world-preview-main.cjs'), `--user-data-dir=${userData}`],
  cwd: repo, env, timeout: 30000,
});

try {
  const page = await app.firstWindow();
  // The preview page is only a canvas host here; its own world isn't used.
  await page.goto(`${pathToFileURL(path.join(repo, 'scripts', 'world-preview.html')).href}?motion=0`);
  await page.waitForLoadState('domcontentloaded');
  const images = await page.evaluate((list) => {
    const HEAD = 46;
    const GAP = 18;
    const decode = ({ width, height, data }) => {
      const bytes = Uint8ClampedArray.from(atob(data), (ch) => ch.charCodeAt(0));
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      c.getContext('2d').putImageData(new ImageData(bytes, width, height), 0, 0);
      return c;
    };
    const header = (ctx, s, x, y, w) => {
      ctx.fillStyle = '#fff6e2';
      ctx.fillRect(x, y, w, HEAD - 6);
      ctx.fillStyle = '#3d4038';
      ctx.font = '600 19px "Segoe UI", sans-serif';
      ctx.fillText(s.title, x + 12, y + 26);
      const tw = ctx.measureText(s.title).width;
      ctx.font = '400 14px "Segoe UI", sans-serif';
      ctx.fillStyle = '#6b6f63';
      ctx.fillText(s.sub, x + 26 + tw, y + 26);
    };
    const labels = (ctx, s, x, y) => {
      for (const l of s.labels) {
        ctx.font = `${l.small ? '600 14px' : '600 16px'} "Segoe UI", sans-serif`;
        const tw = ctx.measureText(l.text).width;
        ctx.font = '400 13px "Segoe UI", sans-serif';
        const sw = l.sub ? ctx.measureText(l.sub).width : 0;
        if (!l.light) {
          ctx.fillStyle = 'rgba(255, 246, 226, 0.92)';
          ctx.fillRect(x + l.x - 6, y + l.y - 18, Math.max(tw, sw) + 12, l.sub ? 40 : 24);
        }
        ctx.fillStyle = l.light ? '#fff6e2' : '#3d4038';
        ctx.font = `${l.small ? '600 14px' : '600 16px'} "Segoe UI", sans-serif`;
        ctx.fillText(l.text, x + l.x, y + l.y);
        if (l.sub) {
          ctx.font = '400 13px "Segoe UI", sans-serif';
          ctx.fillStyle = l.light ? '#c9c3b4' : '#6b6f63';
          ctx.fillText(l.sub, x + l.x, y + l.y + 17);
        }
      }
    };
    const canvases = list.map((s) => decode(s.img));
    const single = list.map((s, n) => {
      const c = document.createElement('canvas');
      c.width = s.img.width;
      c.height = s.img.height + HEAD;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#23262d';
      ctx.fillRect(0, 0, c.width, c.height);
      header(ctx, s, 0, 0, c.width);
      ctx.drawImage(canvases[n], 0, HEAD);
      labels(ctx, s, 0, HEAD);
      return c.toDataURL('image/png');
    });
    // The sheet: tears and frontier side by side, then the Elsewheres two to a row.
    const [tears, frontier, ...scenes] = list.map((s, n) => ({ s, c: canvases[n] }));
    const topW = tears.c.width + GAP + frontier.c.width;
    const rows = [];
    for (let i = 0; i < scenes.length; i += 2) rows.push(scenes.slice(i, i + 2));
    const rowW = Math.max(...rows.map((r) => r.reduce((w, e) => w + e.c.width, 0) + GAP * (r.length - 1)));
    const width = GAP * 2 + Math.max(topW, rowW);
    const topH = HEAD + Math.max(tears.c.height, frontier.c.height);
    const rowHs = rows.map((r) => HEAD + Math.max(...r.map((e) => e.c.height)));
    const height = GAP + topH + rowHs.reduce((a, h) => a + GAP + h, 0) + GAP;
    const sheet = document.createElement('canvas');
    sheet.width = width;
    sheet.height = height;
    const ctx = sheet.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#23262d';
    ctx.fillRect(0, 0, width, height);
    const place = (e, x, y) => { header(ctx, e.s, x, y, e.c.width); ctx.drawImage(e.c, x, y + HEAD); labels(ctx, e.s, x, y + HEAD); };
    place(tears, GAP, GAP);
    place(frontier, GAP + tears.c.width + GAP, GAP);
    let y = GAP + topH + GAP;
    rows.forEach((r, i) => {
      let x = GAP;
      for (const e of r) { place(e, x, y); x += e.c.width + GAP; }
      y += rowHs[i] + GAP;
    });
    return { sheet: sheet.toDataURL('image/png'), single };
  }, payload);
  const wrote = ['test-results/elsewhere-sheet.png'];
  await writeFile(path.join(results, 'elsewhere-sheet.png'), Buffer.from(images.sheet.split(',')[1], 'base64'));
  for (let n = 0; n < sections.length; n += 1) {
    await writeFile(path.join(results, sections[n].file), Buffer.from(images.single[n].split(',')[1], 'base64'));
    wrote.push(`test-results/${sections[n].file}`);
  }
  console.log(JSON.stringify({ composedMs, standIns: [...missing].sort(), wrote }, null, 1));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
