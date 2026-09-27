// Prototype of rift genre bleed (RIFTS.md, PLAN.md §9). Recolours the real Hearthvale map
// with the genre palettes in content/genres.json, dithers the edge where a rift's bleed
// fades, interleaves two genres where bleeds overlap (a fusion), and draws the rift tear,
// a little weather, and one stray per shadow genre.
//
//   node scripts/rift-preview.mjs
//
// Writes test-results/rift-genre-sampler.png (Milo's camp in every genre) and
// test-results/rift-bleed-map.png (rifts bleeding into the map, with close-ups).
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { demoPlots } from './capture-kit.mjs';
import { basePalette, buildGenrePalette, ROLES } from '../src/world/genres.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });

// ---------- art: the tear and a stray for each shadow genre (palette keys, drawn in genre colours) ----------

const TEAR = [
  '....a....', '....a....', '...ada...', '...ada...', '..adbda..', '..adbda..', '.adbbbda.',
  '..adbda..', '.adbbbda.', 'adbbbbbda', '.adbbbda.', 'adbbbbbda', '.adbbbda.', '..adbda..',
  '.adbbbda.', '..adbda..', '..adbda..', '...ada...', '...ada...', '....a....', '....a....',
];

const STRAYS = {
  // A glitch drone: violet rotors, hot-pink shell, one cyan eye.
  neon: [
    '.oo.......oo.', 'oeeo.....oeeo', '.oo.......oo.', '..o.ooooo.o..', '...orrrrro...', '..orruuurro..',
    '..oruucuuro..', '..orruuurro..', '...orrrrro...', '....o.o.o....', '...u..u..u...',
  ],
  // A nightwing: a soft bat-moth with streetlight eyes.
  nocturne: [
    'o.............o', 'oko.........oko', 'okko.......okko', 'okkko.ooo.okkko', '.okkkouuuokkko.',
    '..okkkouokkko..', '...ooko.okoo...', '......o.o......', '.....o...o.....',
  ],
  // A candle wraith.
  gothic: [
    '......u....', '.....uUu...', '......o....', '...ooooo...', '..occcccoo.', '.occcccccco', '.occoccocco',
    '.occcccccco', '.occcooccco', '.occcccccco', '..occcccco.', '..occ.occo.', '...oc..oc..', '....o...o..',
  ],
  // A tin clerk with a rubber stamp.
  iron: [
    '...ooooooo..', '..osssssssO.', '..osuSssuso.', '..osssssssO.', '...ooooooo..', '..obbbbbbbo.',
    '.obbSbbbSbbo', 'ooobbbbbbbo.', 'oRobbbbbbbo.', 'ooobbbbbbbo.', '..ooooooooo.', '...oS..oS...', '...oo..oo...',
  ].map((row) => row.replace(/O/g, 'o')),
  // A watcher from the wrong stars.
  void: [
    '....oooo....', '..oovvvvoo..', '.ovvcccccvo.', 'ovcccoocccvo', 'ovccoUUoccvo', 'ovcccoocccvo',
    '.ovvcccccvo.', '..oovvvvoo..', '...o.o..o.o.', '..o..o.o..o.', '..o.o...o...',
  ],
  // A wanted poster on a post.
  frontier: [
    '.ccccccccc.', '.cooCCCooc.', '.cCCCCCCCc.', '.cCCooCCCc.', '.cCoRRoCCc.', '.cCCooCCCc.', '.cCCCCCCCc.',
    '.cooCCCooc.', '.ccccccccc.', '.....m.....', '.....m.....', '.....m.....', '....mmm....',
  ],
  // A trench-coated shade with one red scarf.
  noir: [
    '...oooo....', '..oooooo...', '.oooooooo..', '...oSSo....', '...oSSo....', '..oRRRRo...', '.ooooooooo.',
    '.ooooooooo.', '.oooooooo..', '..oooooo...', '..oo..oo...', '..oo..oo...',
  ],
};

// ---------- data ----------

const content = JSON.parse(await readFile(path.join(repo, 'content', 'genres.json'), 'utf8'));
const genres = content.genres.map((genre) => {
  const palette = buildGenrePalette(genre);
  const anchor = (role) => palette[ROLES[role][0]];
  return {
    id: genre.id, name: genre.name, genre: genre.genre, kind: genre.kind, palette,
    ink: palette.o, rim: anchor(genre.rift.rim), inner: anchor(genre.rift.inner),
    particles: { ...genre.particles, color: palette[genre.particles.key] || palette.c },
    stray: STRAYS[genre.id] || null,
  };
});

const T = 16;
const config = {
  plots: demoPlots(),
  baseKeys: basePalette(),
  genres,
  tear: TEAR,
  sampler: { crop: { x: 23 * T, y: 12 * T, w: 16 * T, h: 12 * T }, scale: 2, columns: 3, tear: { x: 33.4 * T, y: 13.4 * T } },
  map: {
    rifts: [
      { genre: 'neon', x: 50.5 * T, y: 17 * T },
      { genre: 'nocturne', x: 43 * T, y: 27 * T },
      { genre: 'gothic', x: 11 * T, y: 18 * T },
      { genre: 'iron', x: 14 * T, y: 7 * T },
      { genre: 'void', x: 52 * T, y: 36 * T },
      { genre: 'verdant', x: 18 * T, y: 31 * T },
    ],
    rin: 34, rout: 118, wobble: 44,
    closeups: [
      { title: 'Neon × Nocturne: a build failing at 3 a.m.', x: 748, y: 352 },
      { title: 'Gothic: tasks left alone for weeks', x: 184, y: 290 },
      { title: 'Iron: too much in progress at once', x: 230, y: 120 },
      { title: 'Void: a task too big to see whole', x: 820, y: 560 },
    ],
  },
};

// ---------- render in the world preview ----------

const userData = await mkdtemp(path.join(tmpdir(), 'milo-rift-preview-'));
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
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });

  const images = await page.evaluate((cfg) => {
    const world = window.__world;
    world.setPlots(cfg.plots);
    const map = world.renderMap(1, { time: 1200 });
    const W = map.width;
    const H = map.height;
    const src = map.getContext('2d').getImageData(0, 0, W, H).data;
    const genreById = Object.fromEntries(cfg.genres.map((g) => [g.id, g]));
    const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    const hash = (x, y, s) => {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1, 982451653);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const vnoise = (x, y, s) => {
      const xi = Math.floor(x); const yi = Math.floor(y);
      const xf = x - xi; const yf = y - yi;
      const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi, s); const b = hash(xi + 1, yi, s); const c = hash(xi, yi + 1, s); const d = hash(xi + 1, yi + 1, s);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const nearest = new Map();
    const keyOf = (r, g, b) => {
      const id = (r << 16) | (g << 8) | b;
      let key = nearest.get(id);
      if (key === undefined) {
        let best = Infinity;
        for (const entry of cfg.baseKeys) {
          const d = (entry.rgb[0] - r) ** 2 + (entry.rgb[1] - g) ** 2 + (entry.rgb[2] - b) ** 2;
          if (d < best) { best = d; key = entry.key; }
        }
        nearest.set(id, key);
      }
      return key;
    };

    // Recolour everything inside each rift's bleed; dither the fade; interleave overlaps.
    function bleed(rifts, { rin, rout, wobble }) {
      const out = new Uint8ClampedArray(src);
      const pick = new Int16Array(W * H).fill(-1);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          if (!out[i + 3]) continue;
          const active = [];
          for (let r = 0; r < rifts.length; r += 1) {
            const d = Math.hypot(x - rifts[r].x, y - rifts[r].y) + (vnoise(x / 13, y / 13, r + 7) - 0.5) * wobble;
            const s = d <= rin ? 1 : d >= rout ? 0 : (rout - d) / (rout - rin);
            // Dither in 2x2 art-pixel blocks: a chunkier, more deliberate pixel-art fade.
            if (s >= 1 || (s > 0 && (BAYER[(y >> 1) & 3][(x >> 1) & 3] + 0.5) / 16 < s)) active.push(r);
          }
          if (!active.length) continue;
          const r = active.length === 1 ? active[0] : active[((x >> 1) + (y >> 1)) % active.length];
          const colour = genreById[rifts[r].genre].palette[keyOf(out[i], out[i + 1], out[i + 2])];
          if (!colour) continue;
          out[i] = colour[0]; out[i + 1] = colour[1]; out[i + 2] = colour[2];
          pick[y * W + x] = r;
        }
      }
      const put = (x, y, c, r) => {
        if (x < 0 || y < 0 || x >= W || y >= H || pick[y * W + x] !== r) return;
        const i = (y * W + x) * 4;
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
      };
      // Weather inside each genre's bleed.
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const r = pick[y * W + x];
          if (r < 0) continue;
          const p = genreById[rifts[r].genre].particles;
          if (!p.density || hash(x, y, 91 + r) >= p.density) continue;
          const c = p.color;
          if (p.type === 'rain') { put(x, y, c, r); put(x, y + 1, c, r); put(x, y + 2, c, r); }
          else if (p.type === 'sparkles') { put(x, y, c, r); put(x - 1, y, c, r); put(x + 1, y, c, r); put(x, y - 1, c, r); put(x, y + 1, c, r); }
          else if (p.type === 'mist') { put(x, y, c, r); put(x + 1, y, c, r); put(x + 2, y, c, r); }
          else put(x, y, c, r);
        }
      }
      return { out, pick, put };
    }

    function drawGrid(target, rows, x0, y0, colourOf) {
      rows.forEach((row, y) => [...row].forEach((key, x) => {
        if (key === '.') return;
        const c = colourOf(key);
        if (!c) return;
        const px = Math.round(x0 + x); const py = Math.round(y0 + y);
        if (px < 0 || py < 0 || px >= W || py >= H) return;
        const i = (py * W + px) * 4;
        target[i] = c[0]; target[i + 1] = c[1]; target[i + 2] = c[2]; target[i + 3] = 255;
      }));
    }

    function drawTear(target, g, x, y) {
      // A soft dithered glow, then the tear itself, with glimpses of the other world inside.
      for (let dy = -16; dy <= 16; dy += 1) {
        for (let dx = -9; dx <= 9; dx += 1) {
          const d = Math.hypot(dx * 1.7, dy);
          if (d < 9 || d > 17) continue;
          if ((BAYER[(y + dy) & 3][(x + dx) & 3] + 0.5) / 16 > (17 - d) / 14) continue;
          const px = x + dx; const py = y + dy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const i = (py * W + px) * 4;
          target[i] = g.rim[0]; target[i + 1] = g.rim[1]; target[i + 2] = g.rim[2];
        }
      }
      drawGrid(target, cfg.tear, x - 4, y - 10, (key) => key === 'a' ? g.rim : key === 'd' ? g.ink : (hash(x, y, 5) > 0.5 ? g.inner : g.rim));
    }

    function drawStray(target, g, x, y) {
      if (!g.stray) return;
      drawGrid(target, g.stray, x, y, (key) => g.palette[key] || g.ink);
    }

    function toCanvas(data) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
      return c;
    }

    function label(ctx, text, sub, x, y, w) {
      ctx.fillStyle = '#fff6e2';
      ctx.fillRect(x, y, w, 34);
      ctx.fillStyle = '#3d4038';
      ctx.font = '600 17px "Segoe UI", sans-serif';
      ctx.fillText(text, x + 10, y + 23);
      if (sub) {
        const tw = ctx.measureText(text).width;
        ctx.font = '400 14px "Segoe UI", sans-serif';
        ctx.fillStyle = '#6b6f63';
        ctx.fillText(sub, x + 22 + tw, y + 23);
      }
    }

    // ---------- 1. the camp in every genre ----------
    const s = cfg.sampler;
    const cw = s.crop.w * s.scale; const ch = s.crop.h * s.scale;
    const gap = 14;
    const rows = Math.ceil(cfg.genres.length / s.columns);
    const sheet = document.createElement('canvas');
    sheet.width = s.columns * cw + (s.columns + 1) * gap;
    sheet.height = rows * (ch + 34) + (rows + 1) * gap;
    const sctx = sheet.getContext('2d');
    sctx.fillStyle = '#23262d';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    sctx.imageSmoothingEnabled = false;
    cfg.genres.forEach((g, n) => {
      const cx = s.crop.x + s.crop.w / 2; const cy = s.crop.y + s.crop.h / 2;
      const { out } = bleed([{ genre: g.id, x: cx, y: cy }], { rin: 400, rout: 420, wobble: 0 });
      if (g.kind === 'shadow') {
        drawTear(out, g, s.tear.x, s.tear.y);
        drawStray(out, g, s.tear.x - 22, s.tear.y + 6);
      }
      const col = n % s.columns; const row = Math.floor(n / s.columns);
      const x = gap + col * (cw + gap); const y = gap + row * (ch + 34 + gap);
      label(sctx, g.name, `${g.genre.replace(/ \(.*\)/, '')} · ${g.kind}`, x, y, cw);
      sctx.drawImage(toCanvas(out), s.crop.x, s.crop.y, s.crop.w, s.crop.h, x, y + 34, cw, ch);
    });

    // ---------- 2. rifts bleeding into the map ----------
    const m = cfg.map;
    const { out } = bleed(m.rifts, m);
    for (const r of m.rifts) {
      const g = genreById[r.genre];
      if (g.kind !== 'shadow') continue;
      drawTear(out, g, Math.round(r.x), Math.round(r.y));
      drawStray(out, g, Math.round(r.x) + 12, Math.round(r.y) + 2);
    }
    const bled = toCanvas(out);
    const zoom = 2; const zw = 256; const zh = 176;
    const board = document.createElement('canvas');
    board.width = W;
    board.height = H + 2 * (zh * zoom + 34 + gap) + gap;
    const bctx = board.getContext('2d');
    bctx.fillStyle = '#23262d';
    bctx.fillRect(0, 0, board.width, board.height);
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(bled, 0, 0);
    m.closeups.forEach((z, n) => {
      const col = n % 2; const row = Math.floor(n / 2);
      const x = col * (zw * zoom); const y = H + gap + row * (zh * zoom + 34 + gap);
      label(bctx, z.title, '', x, y, zw * zoom - (col === 0 ? 4 : 0));
      bctx.drawImage(bled, z.x - zw / 2, z.y - zh / 2, zw, zh, x, y + 34, zw * zoom - (col === 0 ? 4 : 0), zh * zoom);
    });

    return { sampler: sheet.toDataURL('image/png'), map: board.toDataURL('image/png') };
  }, config);

  await writeFile(path.join(results, 'rift-genre-sampler.png'), Buffer.from(images.sampler.split(',')[1], 'base64'));
  await writeFile(path.join(results, 'rift-bleed-map.png'), Buffer.from(images.map.split(',')[1], 'base64'));
  console.log(JSON.stringify({ errors, wrote: ['test-results/rift-genre-sampler.png', 'test-results/rift-bleed-map.png'] }));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
