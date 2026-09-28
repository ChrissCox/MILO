// Phase 3 art sheet (CONTRACT-PHASE3.md §9 D). Renders every new sprite and frame at 4x with its
// name and size, a strip of the new art beside the vale's own (tree, pine, cabin, lantern, fence,
// bush, rock), the same sprites in three genre tables, and a mock of the north gate at tier 1
// (the thicket) and tier 2 (the palisade and gatehouse) on the real vale ground from renderMap.
//
//   node scripts/capture-sprites.mjs
//
// The gate sheet also shows the west and east gates at tier 2 with Milo standing in the gateway,
// and the vale's north-west corner, where the east-west wall meets the north-south one.
//
// Writes test-results/sprites-phase3.png (everything), plus sprites-phase3-sheet.png,
// sprites-phase3-strip.png and sprites-phase3-gate.png for closer looks.
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });

// Every sprite Phase 3 adds, in the order the sheet shows them.
const PHASE3_SPRITES = [
  'tree.birch', 'pine.snow', 'crag', 'crag.snow', 'basalt.column', 'rock.basalt', 'dice.stone', 'landmark.stone',
  'lantern.post', 'ruin', 'cave', 'chest', 'chest.mimic', 'note', 'hamlet', 'statue', 'ore.node', 'herbs', 'fishing.spot',
  'thicket', 'palisade.post', 'palisade.n', 'palisade.s', 'palisade.e', 'palisade.w', 'palisade.jamb', 'gatehouse', 'gate.bell',
  'war.table', 'banner', 'bridge.h', 'exit.door', 'curio',
  'echo.moon', 'echo.knocker', 'echo.spark', 'echo.star', 'echo.crack',
  'milo.chop.down', 'milo.chop.up', 'milo.chop.left', 'milo.chop.right',
];

const genresJson = JSON.parse(await readFile(path.join(repo, 'content', 'genres.json'), 'utf8'));
const { buildGenrePalette } = await import('../src/world/genres.js');
const genreTables = ['nocturne', 'neon', 'gothic'].map((id) => {
  const genre = genresJson.genres.find((g) => g.id === id);
  return { id, name: genre.name, table: buildGenrePalette(genre) };
});

// The Stockade's pieces by the north gate where wilds.ringObjects really puts them (the Gate Bell
// on its post beside the road, the banners either side, the War Table), so the mock matches the game.
const riftWords = JSON.parse(await readFile(path.join(repo, 'content', 'riftgen.json'), 'utf8'));
const { createWorldgen } = await import('../src/world/worldgen.js');
const { createWilds } = await import('../src/world/wilds.js');
const STOCKADE_SHADOWS = { 'gate.bell': [14, 3, 0], 'war.table': [30, 4, 0], banner: [6, 2, 0] };
const stockade = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: riftWords.regionWords }), maxChunks: 16 })
  .ringObjects(2)
  .filter((o) => STOCKADE_SHADOWS[o.kind])
  .map((o) => ({ name: o.kind, frame: o.frame || 0, tx: o.x, ty: o.y, dx: (o.dx || 0) + ((o.w || 1) - 1) * 8, dy: o.dy || 0, shadowSize: STOCKADE_SHADOWS[o.kind] }));

const userData = await mkdtemp(path.join(tmpdir(), 'milo-sprites-'));
const env = { ...process.env, MILO_PREVIEW_USER_DATA: userData, MILO_PREVIEW_SIZE: '1000x700' };
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
  // The preview is someone else's file and may be mid-change; without it the gate mock falls back
  // to painted grass and says so on the sheet.
  const ready = await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 }).then(() => true, () => false);
  if (!ready) console.warn('world preview did not start; the gate mock uses plain grass', errors);

  const images = await page.evaluate(async ({ names, genreTables, ready, stockade }) => {
    const S = await import('../src/world/sprites.js');
    const { MAP } = await import('../src/world/map.js');
    let objectBoxes = null;
    try { ({ objectBoxes } = await import('../src/world/engine.js')); } catch { objectBoxes = null; }
    const T = 16;
    const INK = '#3d4038';
    const CREAM = '#fff6e2';
    const hash = (x, y, s) => {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1, 982451653);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const spriteCanvas = (rows, table) => {
      const c = canvasOf(rows[0].length, rows.length);
      const ctx = c.getContext('2d');
      ctx.putImageData(S.rowsToImageData(rows, (w, h) => ctx.createImageData(w, h), table), 0, 0);
      return c;
    };
    const hex = (key) => { const [r, g, b] = S.rgbaOf(key); return `rgb(${r},${g},${b})`; };
    const font = (size, weight = 400) => `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;

    // Palisade and fence pieces compose by mask: stamp n, w, e, post, s into a blank cell.
    const compose = (prefix, mask) => {
      const h = S.SPRITES[`${prefix}.post`][0].length;
      let rows = Array.from({ length: h }, () => '.'.repeat(16));
      const put = (name, y = 0) => { rows = S.stamp(rows, S.SPRITES[name][0], 0, y); };
      if (mask.n) put(`${prefix}.n`);
      if (mask.w) put(`${prefix}.w`);
      if (mask.e) put(`${prefix}.e`);
      put(`${prefix}.post`);
      if (mask.s) put(`${prefix}.s`, prefix === 'fence' ? 14 : 0);
      return rows;
    };

    // Grass like the vale's, for ground outside the heart (the wilds painter is module E's).
    const vnoise = (x, y, s) => {
      const xi = Math.floor(x); const yi = Math.floor(y);
      const xf = x - xi; const yf = y - yi;
      const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi, s); const b = hash(xi + 1, yi, s); const c = hash(xi, yi + 1, s); const d = hash(xi + 1, yi + 1, s);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const DECALS = ['tuft', 'tuft.light', 'clover', 'flower.pink', 'flower.butter', 'flower.cream', 'flower.lavender', 'tuft'];
    function paintGrass(ctx, x0, y0, w, h, { road = null } = {}) {
      const image = ctx.createImageData(w, h);
      const g = S.rgbaOf('g'); const j = S.rgbaOf('j'); const G = S.rgbaOf('G'); const p = S.rgbaOf('p'); const P = S.rgbaOf('P');
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const wx = x0 + x; const wy = y0 + y;
        let c = vnoise(wx / 22, wy / 22, 7) > 0.58 ? j : g;
        if (road) {
          // P edges and a G lip along the road's long sides
          const across = road.x1 - road.x0 > road.y1 - road.y0 ? [wy, road.y0, road.y1, wx, road.x0, road.x1] : [wx, road.x0, road.x1, wy, road.y0, road.y1];
          const [a, a0, a1, b, b0, b1] = across;
          const inRoad = a >= a0 && a < a1 && b >= b0 && b < b1;
          const edge = inRoad && (a === a0 || a === a1 - 1);
          const lip = !inRoad && b >= b0 && b < b1 && (a === a0 - 1 || a === a1);
          if (inRoad) c = edge || hash(wx, wy, 3) > 0.93 ? P : p;
          else if (lip) c = G;
        }
        image.data.set(c, (y * w + x) * 4);
      }
      // putImageData ignores the context's transform, so go through a canvas and drawImage
      const layer = canvasOf(w, h);
      layer.getContext('2d').putImageData(image, 0, 0);
      ctx.drawImage(layer, x0, y0);
      for (let ty = Math.floor(y0 / T); ty < (y0 + h) / T; ty += 1) for (let tx = Math.floor(x0 / T); tx < (x0 + w) / T; tx += 1) {
        if (hash(tx, ty, 11) > 0.55) continue;
        const px = tx * T + Math.floor(hash(tx, ty, 13) * 10);
        const py = ty * T + Math.floor(hash(tx, ty, 17) * 11);
        if (road && px + 8 > road.x0 - 2 && px < road.x1 + 2) continue;
        const name = DECALS[Math.floor(hash(tx, ty, 19) * DECALS.length)];
        ctx.drawImage(spriteCanvas(S.SPRITES[name][0]), px, py);
      }
    }
    const shadow = (ctx, cx, cy, w, h) => {
      const [r, g, b, a] = S.rgbaOf('x');
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const nx = (x + 0.5 - w / 2) / (w / 2); const ny = (y + 0.5 - h / 2) / (h / 2);
        if (nx * nx + ny * ny <= 1) ctx.fillRect(Math.round(cx - w / 2) + x, Math.round(cy - h / 2) + y, 1, 1);
      }
    };

    // ---------- A: the labelled sheet ----------
    const WATERY = new Set(['fishing.spot', 'bridge.h']);
    function sheet() {
      const scale = 4;
      const cells = [];
      for (const name of names) {
        const frames = S.SPRITES[name];
        frames.forEach((rows, i) => cells.push({ name, i, n: frames.length, rows }));
      }
      const W = 1760;
      const gap = 14;
      const label = 34;
      let x = gap; let y = 58; let rowH = 0;
      const placed = [];
      for (const c of cells) {
        const w = Math.max(c.rows[0].length * scale + 4 + c.rows[0].length + 8, 120);
        const h = c.rows.length * scale + label;
        if (x + w > W - gap) { x = gap; y += rowH + gap; rowH = 0; }
        placed.push({ ...c, x, y, w, h });
        x += w + gap; rowH = Math.max(rowH, h);
      }
      const H = y + rowH + gap;
      const out = canvasOf(W, H);
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = CREAM; ctx.font = font(22, 600);
      ctx.fillText('Phase 3 sprites at 4x, with each at 1x beside it', gap, 34);
      for (const c of placed) {
        const sw = c.rows[0].length * scale; const sh = c.rows.length * scale;
        // grass tile behind, so outlines and soft colours read as they will in the world
        ctx.fillStyle = hex(WATERY.has(c.name) ? 'w' : 'g'); ctx.fillRect(c.x - 4, c.y - 4, c.w, sh + 8);
        ctx.drawImage(spriteCanvas(c.rows), c.x, c.y, sw, sh);
        ctx.drawImage(spriteCanvas(c.rows), c.x + sw + 6, c.y + sh - c.rows.length);
        ctx.fillStyle = CREAM; ctx.font = font(13, 600);
        ctx.fillText(c.n > 1 ? `${c.name} #${c.i}` : c.name, c.x - 2, c.y + sh + 18);
        ctx.fillStyle = hex('h'); ctx.font = font(11);
        ctx.fillText(`${c.rows[0].length} x ${c.rows.length}`, c.x - 2, c.y + sh + 31);
      }
      return out;
    }

    // ---------- B: new beside old, on one ground line, and in genre tables ----------
    function strip() {
      const scale = 4;
      const fence = compose('fence', { n: 0, s: 0, e: 1, w: 1 });
      const fenceRun = S.stamp(S.stamp(Array.from({ length: 16 }, () => '.'.repeat(48)), fence, 16, 0), compose('fence', { e: 1 }), 0, 0);
      const fenceRow = S.stamp(fenceRun, compose('fence', { w: 1 }), 32, 0);
      const pal = (mask) => compose('palisade', mask);
      let palRun = Array.from({ length: pal({}).length }, () => '.'.repeat(48));
      palRun = S.stamp(palRun, pal({ e: 1 }), 0, 0);
      palRun = S.stamp(palRun, pal({ e: 1, w: 1 }), 16, 0);
      palRun = S.stamp(palRun, pal({ w: 1 }), 32, 0);
      const thicketRun = S.stamp(S.stamp(Array.from({ length: 20 }, () => '.'.repeat(52)), S.SPRITES.thicket[0], 0, 0), S.SPRITES.thicket[1], 16, 0);
      const thicketRow = S.stamp(thicketRun, S.SPRITES.thicket[0], 32, 0);
      const groups = [
        { title: 'The vale today', items: [['tree', 0], ['pine', 0], ['bush', 0], ['rock', 0], ['cabin', 0], ['lantern', 0], [fenceRow, 'fence x3']] },
        { title: 'Phase 3', items: [['tree.birch', 0], ['pine.snow', 0], [thicketRow, 'thicket x3'], ['rock.basalt', 0], ['hamlet', 0], ['lantern.post', 1], [palRun, 'palisade x3'], ['crag', 0], ['statue', 0], ['milo.chop.right', 1]] },
      ];
      const gap = 18;
      const rowH = 48 * scale + 50;
      const W = 1760;
      const H = 60 + groups.length * rowH + 60 + 3 * (36 * 3 + 40);
      const out = canvasOf(W, H);
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = CREAM; ctx.font = font(22, 600);
      ctx.fillText('New art beside the vale (4x, feet on one line)', gap, 34);
      groups.forEach((group, gi) => {
        const top = 52 + gi * rowH;
        const ground = top + 44 * scale;
        ctx.fillStyle = hex('g'); ctx.fillRect(gap, top, W - 2 * gap, rowH - 26);
        ctx.fillStyle = hex('j'); ctx.fillRect(gap, ground, W - 2 * gap, rowH - 26 - (ground - top));
        let x = gap + 12;
        for (const [item, arg] of group.items) {
          const rows = typeof item === 'string' ? S.SPRITES[item][arg] : item;
          const c = spriteCanvas(rows);
          ctx.drawImage(c, x, ground - rows.length * scale, rows[0].length * scale, rows.length * scale);
          ctx.fillStyle = INK; ctx.font = font(12, 600);
          ctx.fillText(typeof item === 'string' ? item : arg, x, ground + 20);
          x += rows[0].length * scale + 22;
        }
        ctx.fillStyle = CREAM; ctx.font = font(14, 600);
        ctx.fillText(group.title, gap, top + rowH - 8);
      });
      // genre tables: the same frames, recoloured through rowsToImageData's table
      const gTop = 52 + groups.length * rowH + 20;
      ctx.fillStyle = CREAM; ctx.font = font(18, 600);
      ctx.fillText('The same sprites through genre colour tables (3x)', gap, gTop + 10);
      const demo = [['lantern.post', 1], ['thicket', 0], ['chest.mimic', 1], ['tree.birch', 0], ['gatehouse', 0], ['statue', 0], ['exit.door', 0], ['curio', 0], ['echo.moon', 0], ['echo.spark', 0], ['milo.chop.down', 0]];
      genreTables.forEach((genre, gi) => {
        const top = gTop + 24 + gi * (36 * 3 + 40);
        let x = gap + 150;
        const [gr, gg, gb] = genre.table.g || S.rgbaOf('g');
        ctx.fillStyle = `rgb(${gr},${gg},${gb})`; ctx.fillRect(gap + 136, top - 6, W - gap * 2 - 136, 36 * 3 + 14);
        ctx.fillStyle = CREAM; ctx.font = font(14, 600);
        ctx.fillText(genre.name, gap, top + 60);
        for (const [name, f] of demo) {
          const rows = S.SPRITES[name][f];
          const s = rows.length > 36 ? 2 : 3;
          ctx.drawImage(spriteCanvas(rows, genre.table), x, top + 36 * 3 - rows.length * s, rows[0].length * s, rows.length * s);
          x += rows[0].length * s + 18;
        }
      });
      return out;
    }

    // ---------- C: the gates, tier 1 and tier 2 ----------
    // One mock scene: vale ground (renderMap) inside the heart, painted grass outside, ring objects on
    // the ring, and the vale's own objects drawn again in y order so they sort over the ring.
    function scene({ view, road, ring, extras = [], milo = null }, valeMap) {
      const out = canvasOf(view.w, view.h);
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.translate(-view.x, -view.y);
      paintGrass(ctx, view.x, view.y, view.w, view.h, { road });
      const vale = { x: Math.max(view.x, 0), y: Math.max(view.y, 0) };
      vale.w = Math.min(view.x + view.w, MAP.width * T) - vale.x;
      vale.h = Math.min(view.y + view.h, MAP.height * T) - vale.y;
      if (valeMap && vale.w > 0 && vale.h > 0) ctx.drawImage(valeMap, vale.x, vale.y, vale.w, vale.h, vale.x, vale.y, vale.w, vale.h);
      const drawables = [];
      const add = ({ name, frame = 0, tx, ty, dx = 0, dy = 0, rows = null, shadowSize = null }) => {
        const grid = rows || S.SPRITES[name][frame];
        const baseX = (tx + 0.5) * T + dx; const baseY = (ty + 1) * T + dy;
        const sx = Math.round(baseX - grid[0].length / 2); const sy = Math.round(baseY - grid.length);
        drawables.push({ baseY, x: baseX, draw: () => ctx.drawImage(spriteCanvas(grid), sx, sy) });
        if (shadowSize) shadow(ctx, baseX, baseY - 1 + (shadowSize[2] || 0), shadowSize[0], shadowSize[1]);
      };
      for (const item of [...ring, ...extras]) add(item);
      if (milo) {
        const x = milo.tx * T + 8; const y = milo.ty * T + 13;
        shadow(ctx, x, y + 0.5, 10, 3);
        drawables.push({ baseY: y + 0.5, x, draw: () => ctx.drawImage(spriteCanvas(S.SPRITES[milo.name][milo.frame]), x - 8, y - 19) });
      }
      if (objectBoxes && valeMap) {
        for (const box of objectBoxes()) {
          if (!S.SPRITES[box.sprite]) continue;
          if (box.sx + box.sw < view.x || box.sx > view.x + view.w || box.sy + box.sh < view.y || box.sy > view.y + view.h) continue;
          drawables.push({ baseY: box.baseY, x: box.sx, draw: () => ctx.drawImage(spriteCanvas(S.SPRITES[box.sprite][0]), box.sx, box.sy) });
        }
      }
      drawables.sort((p, q) => p.baseY - q.baseY || p.x - q.x).forEach((d) => d.draw());
      ctx.restore();
      return out;
    }
    // The ring as wilds.ringObjects lays it out (CONTRACT-PHASE3.md §3): every tile one step outside
    // the vale is a wall but the four gates; masks join walls and gates. From tier 2 a gatehouse
    // stands on each gate (facing you in the north and south walls; end-on, at dy -15, in the west
    // and east ones) and the jamb takes the wall tile just south of a west or east gate.
    const HW = MAP.width;
    const HH = MAP.height;
    const isRing = (x, y) => x >= -1 && x <= HW && y >= -1 && y <= HH && !(x >= 0 && x < HW && y >= 0 && y < HH);
    const GATE_TILES = { '32,-1': 'n', '-1,20': 'w', '64,14': 'e', '11,44': 's' };
    const gateSide = (x, y) => GATE_TILES[`${x},${y}`] || null;
    const sideOn = (x, y) => gateSide(x, y) === 'w' || gateSide(x, y) === 'e';
    function ringIn(tier, x0, y0, x1, y1) {
      const out = [];
      for (let ty = y0; ty <= y1; ty += 1) {
        for (let tx = x0; tx <= x1; tx += 1) {
          if (!isRing(tx, ty)) continue;
          if (gateSide(tx, ty)) {
            if (tier < 2) continue;
            out.push(sideOn(tx, ty)
              ? { name: 'gatehouse', frame: 1, tx, ty, dy: -15, shadowSize: [12, 3, 0] }
              : { name: 'gatehouse', frame: 0, tx, ty, shadowSize: [30, 4, 0] });
          } else if (tier < 2) {
            out.push({ name: 'thicket', frame: hash(tx, ty, 5) < 0.5 ? 0 : 1, tx, ty, shadowSize: [18, 5, 0] });
          } else if (sideOn(tx, ty - 1)) {
            out.push({ name: 'palisade.jamb', tx, ty, shadowSize: [14, 3, 0] });
          } else {
            const mask = { n: isRing(tx, ty - 1), s: isRing(tx, ty + 1), e: isRing(tx + 1, ty), w: isRing(tx - 1, ty) };
            out.push({ name: 'palisade', tx, ty, rows: compose('palisade', mask), shadowSize: [16, 4, 0] });
          }
        }
      }
      return out;
    }
    function northGate(tier, valeMap) {
      const ring = ringIn(tier, 22, -1, 42, -1);
      if (tier >= 2) ring.push(...stockade);
      const extras = [
        { name: 'lantern.post', frame: tier >= 2 ? 1 : 0, tx: 37, ty: -6, shadowSize: [8, 3, 0] },
        { name: 'tree.birch', frame: 0, tx: 25, ty: -4, dx: 2, shadowSize: [18, 5, -1] },
        { name: 'tree.birch', frame: 1, tx: 28, ty: -6, dx: -3, shadowSize: [18, 5, -1] },
        { name: 'pine', tx: 39, ty: -4, dx: 3, shadowSize: [14, 5, -1] },
        { name: 'note', tx: 31, ty: -6, dx: 4, shadowSize: [8, 2, 0] },
        { name: 'herbs', tx: 38, ty: -4 },
        { name: 'rock', tx: 40, ty: -6, shadowSize: [14, 4, -1] },
      ];
      return scene({
        view: { x: 22 * T, y: -7 * T, w: 21 * T, h: 16 * T },
        road: { x0: 32 * T + 2, x1: 34 * T - 2, y0: -7 * T, y1: 0 },
        ring,
        extras,
        milo: tier >= 2 ? { name: 'milo.up', frame: 1, tx: 32, ty: -1 } : { name: 'milo.chop.left', frame: 1, tx: 26, ty: -4 },
      }, valeMap);
    }
    // The west and east gates at tier 2: north-south walls, so the gatehouse stands end-on behind
    // Milo, and the jamb ends the wall south of him low enough that he's in full view.
    function sideGate(side, valeMap) {
      const west = side === 'w';
      const gx = west ? -1 : 64;
      const gy = west ? 20 : 14;
      const out = west ? -1 : 1; // toward the wilds
      const ring = ringIn(2, gx, gy - 9, gx, gy + 9);
      const x0 = west ? gx - 7 : gx - 8; // view: 16 tiles, the wilds on the outer side
      const road = west
        ? { x0: (gx - 7) * T, x1: gx * T, y0: gy * T + 2, y1: (gy + 2) * T - 2 }
        : { x0: (gx + 1) * T, x1: (gx + 9) * T, y0: gy * T + 2, y1: (gy + 2) * T - 2 };
      return scene({
        view: { x: x0 * T, y: (gy - 9) * T, w: 16 * T, h: 16 * T },
        road,
        ring,
        extras: [
          { name: 'lantern.post', frame: 1, tx: gx + out * 4, ty: gy - 1, shadowSize: [8, 3, 0] },
          { name: 'tree.birch', frame: 1, tx: gx + out * 5, ty: gy - 4, shadowSize: [18, 5, -1] },
          { name: 'thicket', frame: 1, tx: gx + out * 4, ty: gy + 4, shadowSize: [18, 5, 0] },
        ],
        milo: { name: west ? 'milo.left' : 'milo.right', frame: 1, tx: gx, ty: gy },
      }, valeMap);
    }
    // The vale's north-west corner at tier 2, where the east-west wall turns south.
    function corner(valeMap) {
      return scene({
        view: { x: -5 * T, y: -6 * T, w: 13 * T, h: 14 * T },
        ring: ringIn(2, -1, -1, 8, 9),
        extras: [
          { name: 'tree.birch', frame: 0, tx: -3, ty: -3, shadowSize: [18, 5, -1] },
          { name: 'pine.snow', frame: 0, tx: 3, ty: -4, shadowSize: [14, 5, -1] },
        ],
        milo: { name: 'milo.up', frame: 0, tx: 3, ty: 3 },
      }, valeMap);
    }

    let valeMap = null;
    if (ready && window.__world && typeof window.__world.renderMap === 'function') {
      try { valeMap = window.__world.renderMap(1, { time: null }); } catch { valeMap = null; }
    }
    const tiers = [1, 2].map((tier) => northGate(tier, valeMap));
    const sides = ['w', 'e'].map((side) => sideGate(side, valeMap));
    const nw = corner(valeMap);
    const gScale = 3;
    const gW = tiers[0].width * gScale;
    const gH = tiers[0].height * gScale;
    // close-ups at 6x: the north gate at both tiers; the west and east gates; the corner at 3x
    const crop = { x: 6 * T, y: 2 * T, w: 9 * T, h: 7 * T };
    const cScale = 6;
    const closeW = crop.w * cScale;
    const closeH = crop.h * cScale;
    const sideCrop = (side) => ({ x: (side === 'w' ? 3 : 5) * T, y: 5 * T, w: 7 * T, h: 8 * T });
    const sideW = 7 * T * cScale;
    const sideH = 8 * T * cScale;
    const nwScale = 3;
    const gateSheet = canvasOf(Math.max(gW * 2 + 3 * 18, closeW * 2 + 3 * 18, sideW * 2 + nw.width * nwScale + 4 * 18), 52 + gH + 70 + 36 + closeH + 40 + 10 + Math.max(sideH, nw.height * nwScale) + 50);
    {
      const ctx = gateSheet.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = INK; ctx.fillRect(0, 0, gateSheet.width, gateSheet.height);
      ctx.fillStyle = CREAM; ctx.font = font(22, 600);
      ctx.fillText('The north gate (mock, 3x): tier 1 thicket, tier 2 palisade and gatehouse', 18, 34);
      tiers.forEach((c, i) => {
        ctx.drawImage(c, 18 + i * (gW + 18), 52, gW, gH);
        ctx.fillStyle = CREAM; ctx.font = font(15, 600);
        ctx.fillText(i === 0 ? 'Tier 1: the Camp. Thicket on the ring, Milo chopping a birch outside.' : 'Tier 2: the Stockade. Palisade, gatehouse, Gate Bell, War Table, banners.', 18 + i * (gW + 18), 52 + gH + 26);
      });
      ctx.fillStyle = hex('h'); ctx.font = font(12);
      ctx.fillText(valeMap ? 'Vale ground from engine.renderMap; ground outside the edge is painted grass standing in for the wilds.' : 'The world preview did not start, so the vale here is painted grass too.', 18, 52 + gH + 48);
      let y = 52 + gH + 70;
      ctx.fillStyle = CREAM; ctx.font = font(18, 600);
      ctx.fillText('Close up (6x)', 18, y + 20);
      y += 36;
      tiers.forEach((c, i) => ctx.drawImage(c, crop.x, crop.y, crop.w, crop.h, 18 + i * (closeW + 18), y, closeW, closeH));
      y += closeH + 30;
      ctx.fillStyle = CREAM; ctx.font = font(15, 600);
      ctx.fillText('The west and east gates at tier 2 (6x): the end-on gatehouse behind Milo, the jamb low in front. The north-west corner (3x).', 18, y);
      sides.forEach((c, i) => {
        const r = sideCrop(i === 0 ? 'w' : 'e');
        ctx.drawImage(c, r.x, r.y, r.w, r.h, 18 + i * (sideW + 18), y + 10, sideW, sideH);
      });
      ctx.drawImage(nw, 18 + 2 * (sideW + 18), y + 10, nw.width * nwScale, nw.height * nwScale);
    }

    const parts = [sheet(), strip(), gateSheet];
    const W = Math.max(...parts.map((c) => c.width));
    const all = canvasOf(W, parts.reduce((sum, c) => sum + c.height, 0));
    const actx = all.getContext('2d');
    actx.fillStyle = INK; actx.fillRect(0, 0, all.width, all.height);
    let y = 0;
    for (const c of parts) { actx.drawImage(c, 0, y); y += c.height; }
    return { all: all.toDataURL('image/png'), sheet: parts[0].toDataURL('image/png'), strip: parts[1].toDataURL('image/png'), gate: parts[2].toDataURL('image/png') };
  }, { names: PHASE3_SPRITES, genreTables, ready, stockade });

  const save = (file, url) => writeFile(path.join(results, file), Buffer.from(url.split(',')[1], 'base64'));
  await save('sprites-phase3.png', images.all);
  await save('sprites-phase3-sheet.png', images.sheet);
  await save('sprites-phase3-strip.png', images.strip);
  await save('sprites-phase3-gate.png', images.gate);
  if (errors.length) console.warn('page errors:', errors);
  console.log('wrote test-results/sprites-phase3.png (and -sheet, -strip, -gate)');
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
