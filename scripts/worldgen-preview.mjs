// Preview of the procedural world and rifts (WORLD.md, RIFTS.md §10).
//
//   node scripts/worldgen-preview.mjs [seed] [day]
//
// Writes, to test-results/:
//   world-atlas.png     the Hushlands around Hearthvale: regions, roads, lanterns, the
//                       Hearthward's tiers, one day's wild rifts and some real ones
//   world-frontier.png  Hearthvale and its frontier, close up, rifts bleeding into the wilds
//   rift-sampler.png    generated rifts, real and wild, down to the deep ladder
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { demoPlots } from './capture-kit.mjs';
import { buildGenrePalette, ROLES } from '../src/world/genres.js';
import { PALETTE } from '../src/world/sprites.js';
import { createWorldgen, CHUNK, GATES } from '../src/world/worldgen.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { basePaletteByCode, byCode, colourise, paintRegion } from '../src/world/wildsart.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });
const seed = process.argv[2] || 'hushlands';
const day = Number(process.argv[3] || 0);
const read = async (file) => JSON.parse(await readFile(path.join(repo, file), 'utf8'));
const words = await read('content/riftgen.json');
const genreContent = await read('content/genres.json');
const fortress = await read('content/fortress.json');
const world = createWorldgen({ seed, regionWords: words.regionWords });
const riftgen = createRiftgen({ words, genres: genreContent });
const started = performance.now();

// ---------- colours ----------

const base = basePaletteByCode();
const palettes = Object.fromEntries(genreContent.genres.map((g) => [g.id, buildGenrePalette(g)]));
const codes = Object.fromEntries(Object.entries(palettes).map(([id, p]) => [id, byCode(p)]));
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const palettesHex = Object.fromEntries(Object.entries(palettes).map(([id, p]) => [id, Object.fromEntries(Object.entries(p).map(([k, rgb]) => [k, hex(rgb)]))]));
const baseHex = Object.fromEntries(Object.entries(PALETTE).filter(([, v]) => v.hex.startsWith('#')).map(([k, v]) => [k, v.hex]));
const genreInfo = Object.fromEntries(genreContent.genres.map((g) => [g.id, {
  name: g.name, kind: g.kind,
  rim: palettesHex[g.id][ROLES[g.rift.rim][0]], inner: palettesHex[g.id][ROLES[g.rift.inner][0]], ink: palettesHex[g.id].o,
}]));

// ---------- rifts ----------

const ward = fortress.tiers.find((t) => t.id === 'stockade').wardRadius;
const REAL = [
  { key: 'repo:milo', subject: 'the MILO build', signals: ['check-failing'], urgency: 0.85, cause: '3 checks failing on main' },
  { key: 'repo:habitack', subject: 'Habitack', signals: ['check-failing', 'task-stale'], urgency: 0.5, cause: 'Failing checks on a branch untouched for 12 days' },
  { key: 'quest:exercise-sheet', subject: 'the exercise sheet', signals: ['deadline-near'], urgency: 0.7, cause: 'Due on Friday' },
  { key: 'quest:finals', subject: 'finals week', signals: ['big-deadline-approaching'], urgency: 0.25, cause: 'Three weeks out' },
  { key: 'night:2026-09-26', subject: 'last night', signals: ['session-after-midnight', 'working-past-bell'], urgency: 0.4, cause: 'A session ran to 2:40 a.m.' },
  { key: 'project:milo-plan', subject: 'the MILO plan', signals: ['scope-growing', 'task-too-vague', 'task-stale'], urgency: 0.6, cause: 'The plan grew, blurred and went quiet at once' },
].map((input) => {
  const spec = riftgen.realRift(input);
  return { spec, at: world.placeRealRift(spec, { urgency: input.urgency, wardRadius: ward }) };
});

const A = { x0: -384, y0: -256, w: 640, h: 512, size: 2 };
const wild = [];
const pois = [];
for (let cy = Math.floor(A.y0 / CHUNK); cy < Math.ceil((A.y0 + A.h) / CHUNK); cy += 1) {
  for (let cx = Math.floor(A.x0 / CHUNK); cx < Math.ceil((A.x0 + A.w) / CHUNK); cx += 1) {
    pois.push(...world.chunk(cx, cy).pois.filter((p) => !['ore', 'herbs', 'fishing'].includes(p.type) || Math.abs(p.x - 32) < 90 && Math.abs(p.y - 22) < 70));
    for (const spawn of world.wildRiftSpawns(cx, cy, day, { wardRadius: ward })) {
      wild.push({ spec: riftgen.wildRift(spawn), at: { x: spawn.x, y: spawn.y }, region: world.regionAt(spawn.x, spawn.y) });
    }
  }
}

const STAGE_RADIUS = { hairline: 3, open: 5, gaping: 7 };
const standing = world.standingBleeds();
const bleedsFor = (list, box) => [
  ...list.flatMap(({ spec, at }) => spec.genres.map((id) => ({
    x: (at.x - box.x0 + 0.5) * box.size, y: (at.y - box.y0 + 0.5) * box.size,
    inner: 1.6 * box.size, outer: STAGE_RADIUS[spec.stage] * box.size, wobble: 2.5 * box.size, seed: spec.seed % 997,
    palette: codes[id],
  }))),
  // The Greyreach's patchwork and Cinderforge's rivet quarter never close.
  ...standing.map((s, n) => ({
    x: (s.x - box.x0 + 0.5) * box.size, y: (s.y - box.y0 + 0.5) * box.size,
    inner: s.radius * 0.55 * box.size, outer: s.radius * box.size, wobble: 5 * box.size, seed: 31 + n,
    palette: codes[s.genre],
  })),
];
const brief = ({ spec, at, region }) => ({
  name: spec.name, genres: spec.genres, stage: spec.stage, kind: spec.kind, fusion: spec.fusion, maelstrom: spec.maelstrom,
  x: at.x, y: at.y, beyond: at.beyond ?? null, region: region || null, subject: spec.subject,
  stray: spec.strays[0] ? { rows: spec.strays[0].sprite.rows, layers: spec.strays[0].sprite.layers, genre: spec.strays[0].genre, second: spec.strays[0].second } : null,
});

// ---------- the atlas ----------

const atlas = paintRegion(world, A.x0, A.y0, A.w, A.h, A.size);
const atlasRgba = colourise(atlas.keys, atlas.width, atlas.height, base, bleedsFor([...wild, ...REAL], A));

// ---------- the frontier ----------

const F = { x0: -44, y0: -44, w: 152, h: 122, size: 8 };
const inF = ({ at }) => at.x >= F.x0 && at.y >= F.y0 && at.x < F.x0 + F.w && at.y < F.y0 + F.h;
const frontier = paintRegion(world, F.x0, F.y0, F.w, F.h, F.size);
const frontierRifts = [...REAL, ...wild.filter(inF)];
const frontierRgba = colourise(frontier.keys, frontier.width, frontier.height, base, bleedsFor(frontierRifts, F));

// ---------- the sampler ----------

const nearest = (anchorId) => {
  const a = world.anchorById[anchorId];
  return [...wild].sort((p, q) => Math.hypot(p.at.x - a.x, p.at.y - a.y) - Math.hypot(q.at.x - a.x, q.at.y - a.y))[0];
};
const picks = ['cinderforge', 'greyreach', 'painted-hills', 'glass-fen'].map(nearest).filter(Boolean);
// The far lands: keep walking east until a chunk has a rift in it.
let far = null;
for (let cx = 60; !far && cx < 400; cx += 1) {
  const spawn = world.wildRiftSpawns(cx, 25, day)[0];
  if (spawn) far = { spec: riftgen.wildRift(spawn), at: { x: spawn.x, y: spawn.y }, region: world.regionAt(spawn.x, spawn.y) };
}
if (far) picks.push(far);
// The ladder: stitch a rift and keep going down.
let rung = picks[0].spec;
for (let i = 0; i < 8; i += 1) rung = riftgen.deeper(rung);
picks.push({ spec: rung, at: picks[0].at, region: `Below ${picks[0].spec.name}` });

const cards = [...REAL.map((r) => ({ ...r, region: null })), ...picks].map(({ spec, at, region }) => ({
  name: spec.name, kind: spec.kind, genres: spec.genres, fusion: spec.fusion, maelstrom: spec.maelstrom,
  stage: spec.stage, tier: spec.tier, depth: spec.depth, subject: spec.subject, cause: spec.cause || null,
  affixes: spec.affixes, taleLead: spec.taleLead, loot: spec.loot, mood: spec.mood,
  strays: spec.strays.map((s) => ({ name: s.name, count: s.count, genre: s.genre, second: s.second, archetype: s.archetype, temperament: s.temperament, rows: s.sprite.rows, layers: s.sprite.layers })),
  layout: riftgen.layout(spec).rows,
  where: spec.kind === 'real' ? `${at.beyond} tiles beyond the ward, toward ${world.anchorById[at.towards].name}` : `${region} · ${Math.round(Math.hypot(at.x - 32, at.y - 22))} tiles from Hearthvale`,
}));

const b64 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const config = {
  seed, day, ward,
  plots: demoPlots(),
  genreInfo, palettesHex, baseHex,
  A: { ...A, rgba: b64(atlasRgba), width: atlas.width, height: atlas.height },
  F: { ...F, rgba: b64(frontierRgba), width: frontier.width, height: frontier.height },
  tiers: fortress.tiers.filter((t) => t.wardRadius > 0).map((t) => ({ name: t.name, ward: t.wardRadius })),
  anchors: world.anchors.filter((a) => a.id !== 'hearthvale').map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y, act: a.act, tier: a.tier })),
  pois: pois.map(({ type, x, y, name }) => ({ type, x, y, name })),
  gates: Object.entries(GATES).map(([id, g]) => ({ id, x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y })),
  wild: wild.map(brief),
  real: REAL.map(brief),
  cards,
  tear: [
    '....a....', '....a....', '...ada...', '...ada...', '..adbda..', '..adbda..', '.adbbbda.',
    '..adbda..', '.adbbbda.', 'adbbbbbda', '.adbbbda.', 'adbbbbbda', '.adbbbda.', '..adbda..',
    '.adbbbda.', '..adbda..', '..adbda..', '...ada...', '...ada...', '....a....', '....a....',
  ],
};
const generated = Math.round(performance.now() - started);

// ---------- draw in Electron ----------

const userData = await mkdtemp(path.join(tmpdir(), 'milo-worldgen-preview-'));
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
    const heart = world.renderMap(1, { time: 1200 });
    const FONT = '"Segoe UI", sans-serif';
    const INK = '#3d4038';
    const CREAM = '#fff6e2';

    const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const imageOf = (b64, w, h) => {
      const bin = atob(b64);
      const bytes = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const c = canvasOf(w, h);
      c.getContext('2d').putImageData(new ImageData(bytes, w, h), 0, 0);
      return c;
    };
    // A label on a cream plate. With `placed`, it steps down (then up) out of the way of labels
    // already drawn, and it always stays inside the canvas.
    const plate = (ctx, text, x, y, { size = 13, weight = 600, bg = CREAM, fg = INK, align = 'left', sub = null, placed = null } = {}) => {
      ctx.font = `${weight} ${size}px ${FONT}`;
      const tw = ctx.measureText(text).width;
      let sw = 0;
      if (sub) { ctx.font = `400 ${size - 2}px ${FONT}`; sw = ctx.measureText(sub).width + 8; }
      const w = tw + sw + 12;
      const h = size + 9;
      let left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      left = Math.max(4, Math.min(ctx.canvas.width - w - 4, left));
      y = Math.max(48, Math.min(ctx.canvas.height - h - 4, y));
      if (placed) {
        const hits = (top) => placed.some((r) => left < r.left + r.w + 4 && left + w + 4 > r.left && top < r.y + r.h + 4 && top + h + 4 > r.y);
        const start = y;
        for (let step = 1; hits(y) && step < 12; step += 1) y = start + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (h + 6);
        placed.push({ left, y, w, h });
      }
      ctx.fillStyle = INK;
      ctx.fillRect(left - 1, y - 1, w + 2, h + 3);
      ctx.fillStyle = bg;
      ctx.fillRect(left, y, w, h);
      ctx.fillStyle = fg;
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillText(text, left + 6, y + size + 2);
      if (sub) {
        ctx.font = `400 ${size - 2}px ${FONT}`;
        ctx.fillStyle = '#6b6f63';
        ctx.fillText(sub, left + 6 + tw + 8, y + size + 2);
      }
      return { left, w, h };
    };
    const pixels = (ctx, rows, x0, y0, colourOf, px = 1) => {
      rows.forEach((row, y) => [...row].forEach((key, x) => {
        if (key === '.') return;
        const c = colourOf(key, x, y);
        if (!c) return;
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(x0 + x * px), Math.round(y0 + y * px), px, px);
      }));
    };
    const tear = (ctx, g, x, y, px = 1) => pixels(ctx, cfg.tear, x - 4 * px, y - 10 * px, (k) => (k === 'a' ? g.rim : k === 'd' ? g.ink : g.inner), px);
    const stray = (ctx, s, x, y, px = 1) => pixels(ctx, s.rows, x, y, (key, i, j) => {
      const id = s.layers[j][i] === '1' && s.second ? s.second : s.genre;
      return cfg.palettesHex[id][key] || cfg.baseHex[key];
    }, px);
    const header = (ctx, w, title, sub) => {
      ctx.fillStyle = '#23262d';
      ctx.fillRect(0, 0, w, 44);
      ctx.fillStyle = CREAM;
      ctx.font = `600 19px ${FONT}`;
      ctx.fillText(title, 14, 28);
      const tw = ctx.measureText(title).width;
      ctx.fillStyle = '#b9bcb0';
      ctx.font = `400 14px ${FONT}`;
      ctx.fillText(sub, 28 + tw, 28);
    };
    const ring = (ctx, box, r, top, colour, dash) => {
      const s = box.size;
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.roundRect((0 - r - box.x0) * s, top + (0 - r - box.y0) * s, (64 + 2 * r) * s, (44 + 2 * r) * s, r * s);
      ctx.stroke();
      ctx.restore();
    };

    // ---------- 1. the atlas ----------
    const A = cfg.A;
    const TOP = 44;
    const atlas = canvasOf(A.width, A.height + TOP);
    const actx = atlas.getContext('2d');
    header(actx, atlas.width, 'The Hushlands', `seed "${cfg.seed}" · day ${cfg.day} · every tile generated except Hearthvale · 2 px per tile`);
    actx.drawImage(imageOf(A.rgba, A.width, A.height), 0, TOP);
    actx.imageSmoothingEnabled = true;
    actx.imageSmoothingQuality = 'high';
    actx.drawImage(heart, (0 - A.x0) * A.size, TOP + (0 - A.y0) * A.size, 64 * A.size, 44 * A.size);
    actx.imageSmoothingEnabled = false;
    cfg.tiers.forEach((t, n) => {
      ring(actx, A, t.ward, TOP, n === 0 ? 'rgba(255,246,226,0.95)' : 'rgba(255,246,226,0.55)', n === 0 ? [] : [5, 4]);
    });
    const mark = (p, colour, size = 3) => {
      const x = (p.x - A.x0) * A.size;
      const y = TOP + (p.y - A.y0) * A.size;
      actx.fillStyle = INK;
      actx.fillRect(x - size, y - size, size * 2 + 1, size * 2 + 1);
      actx.fillStyle = colour;
      actx.fillRect(x - size + 1, y - size + 1, size * 2 - 1, size * 2 - 1);
    };
    const POI_COLOUR = { lantern: '#efbc6d', statue: '#d4d0c5', ruin: '#928e84', cave: '#3d4038', chest: '#cfa57d', note: '#fff6e2', hamlet: '#e7a28a', quay: '#a57e60', landmark: null };
    for (const p of cfg.pois) {
      const colour = POI_COLOUR[p.type];
      if (colour) mark(p, colour, p.type === 'lantern' || p.type === 'hamlet' ? 3 : 2);
    }
    for (const r of cfg.wild) tear(actx, cfg.genreInfo[r.genres[0]], (r.x - A.x0) * A.size, TOP + (r.y - A.y0) * A.size, r.stage === 'gaping' ? 1 : 1);
    for (const r of cfg.real) tear(actx, cfg.genreInfo[r.genres[0]], (r.x - A.x0) * A.size, TOP + (r.y - A.y0) * A.size, 2);
    const atlasLabels = [];
    plate(actx, 'Hearthvale', (32 - A.x0) * A.size, TOP + (46 - A.y0) * A.size, { size: 13, align: 'center', sub: 'sanctuary', placed: atlasLabels });
    for (const a of cfg.anchors) {
      plate(actx, a.name, (a.x - A.x0) * A.size, TOP + (a.y - A.y0) * A.size - 34, { size: 13, align: 'center', sub: `${a.act} · tier ${a.tier}`, placed: atlasLabels });
    }
    const ww = cfg.pois.find((p) => p.name === 'The Westwatch');
    if (ww) plate(actx, 'The Westwatch', (ww.x - A.x0) * A.size, TOP + (ww.y - A.y0) * A.size + 8, { size: 12, align: 'center', weight: 400, placed: atlasLabels });
    // Tier labels where each ring crosses the diagonal out of the vale's south-east corner.
    for (const t of cfg.tiers) {
      const x = (64 + t.ward * Math.SQRT1_2 - A.x0) * A.size + 3;
      const y = TOP + (44 + t.ward * Math.SQRT1_2 - A.y0) * A.size - 6;
      plate(actx, t.name, x, y, { size: 11, bg: '#23262d', fg: CREAM, sub: `${t.ward}`, placed: atlasLabels });
    }
    // Legend.
    const L = { x: 12, y: atlas.height - 196, w: 300, h: 184 };
    actx.fillStyle = 'rgba(255,246,226,0.94)';
    actx.fillRect(L.x, L.y, L.w, L.h);
    actx.strokeStyle = INK;
    actx.lineWidth = 2;
    actx.strokeRect(L.x, L.y, L.w, L.h);
    const legend = [
      ['lantern', 'Lantern (rest, fast travel)'], ['statue', "Tamsin's unfinished statue"], ['hamlet', 'Hamlet'],
      ['ruin', 'Maker ruins'], ['cave', 'Cave'], ['chest', 'Chest'], ['note', 'Note from the Old Company'],
    ];
    actx.font = `400 12px ${FONT}`;
    legend.forEach(([type, text], n) => {
      const x = L.x + 16;
      const y = L.y + 18 + n * 19;
      actx.fillStyle = INK; actx.fillRect(x - 4, y - 4, 9, 9);
      actx.fillStyle = POI_COLOUR[type]; actx.fillRect(x - 3, y - 3, 7, 7);
      actx.fillStyle = INK; actx.fillText(text, x + 12, y + 4);
    });
    tear(actx, cfg.genreInfo.neon, L.x + 16, L.y + 152, 1);
    actx.fillStyle = INK; actx.fillText('Wild rift (colour = genre)', L.x + 28, L.y + 156);
    actx.strokeStyle = INK; actx.setLineDash([5, 4]); actx.beginPath(); actx.moveTo(L.x + 160, L.y + 20); actx.lineTo(L.x + 190, L.y + 20); actx.stroke(); actx.setLineDash([]);
    actx.fillText('Hearthward', L.x + 196, L.y + 24);
    actx.fillText('tiers', L.x + 196, L.y + 40);
    tear(actx, cfg.genreInfo.frontier, L.x + 170, L.y + 164, 1);
    actx.fillStyle = INK;
    actx.fillText('Real rift', L.x + 180, L.y + 168);

    // ---------- 2. the frontier ----------
    const F = cfg.F;
    const frontier = canvasOf(F.width, F.height + TOP);
    const fctx = frontier.getContext('2d');
    header(fctx, frontier.width, 'Hearthvale and its frontier', `real rifts open ${cfg.ward}+ tiles out (the Stockade's ward): the more urgent, the closer to the walls · 8 px per tile`);
    fctx.drawImage(imageOf(F.rgba, F.width, F.height), 0, TOP);
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(heart, (0 - F.x0) * F.size, TOP + (0 - F.y0) * F.size, 64 * F.size, 44 * F.size);
    fctx.imageSmoothingEnabled = false;
    ring(fctx, F, cfg.tiers[0].ward, TOP, 'rgba(255,246,226,0.95)', [8, 6]);
    ring(fctx, F, cfg.tiers[1].ward, TOP, 'rgba(255,246,226,0.6)', [4, 6]);
    const frontierLabels = [];
    // Ward labels sit on the rings' top-left corners, clear of the north road.
    plate(fctx, `The Stockade's ward · ${cfg.tiers[0].ward} tiles`, (0 - cfg.tiers[0].ward * Math.SQRT1_2 - F.x0) * F.size, TOP + (0 - cfg.tiers[0].ward * Math.SQRT1_2 - F.y0) * F.size - 11, { size: 12, align: 'center', placed: frontierLabels });
    plate(fctx, `The Hold's ward · ${cfg.tiers[1].ward} tiles`, (0 - cfg.tiers[1].ward * Math.SQRT1_2 - F.x0) * F.size, TOP + (0 - cfg.tiers[1].ward * Math.SQRT1_2 - F.y0) * F.size - 11, { size: 12, align: 'center', weight: 400, placed: frontierLabels });
    const fx = (x) => (x - F.x0) * F.size;
    const fy = (y) => TOP + (y - F.y0) * F.size;
    const FPOI = {
      lantern: (x, y) => { pixels(fctx, ['.o.', 'oUo', 'ouo', 'ooo'], x - 3, y - 6, (k) => cfg.baseHex[k], 2); },
      ruin: (x, y) => { pixels(fctx, ['s.s', 'szs', 'zzz'], x - 3, y - 3, (k) => cfg.baseHex[k], 2); },
      cave: (x, y) => { pixels(fctx, ['.SSS.', 'SoooS', 'So.oS'], x - 5, y - 3, (k) => (k === '.' ? null : cfg.baseHex[k]), 2); },
      chest: (x, y) => { pixels(fctx, ['ooooo', 'obUbo', 'obbbo', 'ooooo'], x - 5, y - 4, (k) => cfg.baseHex[k], 2); },
      note: (x, y) => { pixels(fctx, ['ccc', 'cCc', 'ccc'], x - 3, y - 3, (k) => cfg.baseHex[k], 2); },
      hamlet: (x, y) => { pixels(fctx, ['..r..', '.rrr.', 'rRRRr', '.bob.', '.bbb.'], x - 5, y - 5, (k) => cfg.baseHex[k], 2); },
      ore: (x, y) => { pixels(fctx, ['.S.', 'SeS'], x - 3, y - 2, (k) => cfg.baseHex[k], 2); },
      herbs: (x, y) => { pixels(fctx, ['k.k', '.l.'], x - 3, y - 2, (k) => cfg.baseHex[k], 2); },
      fishing: (x, y) => { pixels(fctx, ['f.f', '.f.'], x - 3, y - 2, (k) => cfg.baseHex[k], 2); },
      statue: (x, y) => { pixels(fctx, ['.s.', 'sss', '.s.', 'SSS'], x - 3, y - 6, (k) => cfg.baseHex[k], 2); },
    };
    for (const p of cfg.pois) {
      if (p.x < F.x0 || p.y < F.y0 || p.x >= F.x0 + F.w || p.y >= F.y0 + F.h) continue;
      FPOI[p.type]?.(fx(p.x + 0.5), fy(p.y + 0.5));
    }
    for (const g of cfg.gates) {
      const names = { 'gate:n': 'North gate', 'gate:w': 'West gate', 'gate:e': 'East gate', 'gate:sw': 'South-west gate' };
      const dx = g.id === 'gate:w' ? -70 : g.id === 'gate:e' ? 70 : 0;
      const dy = g.id === 'gate:n' ? -28 : g.id === 'gate:sw' ? 12 : -10;
      plate(fctx, names[g.id], fx(g.x + 0.5) + dx, fy(g.y + 0.5) + dy, { size: 11, align: 'center', weight: 400, placed: frontierLabels });
    }
    for (const r of cfg.real) {
      const g = cfg.genreInfo[r.genres[0]];
      const x = fx(r.x + 0.5);
      const y = fy(r.y + 0.5);
      tear(fctx, g, x, y, 2);
      if (r.stray) stray(fctx, r.stray, x + 12, y - 10, 2);
      const text = r.name.length > 50 ? `${r.name.slice(0, 48)}…` : r.name;
      plate(fctx, text, x, y + 26, { size: 12, align: 'center', sub: `${r.beyond} out`, placed: frontierLabels });
    }
    for (const r of cfg.wild) {
      if (r.x < F.x0 || r.y < F.y0 || r.x >= F.x0 + F.w || r.y >= F.y0 + F.h) continue;
      const g = cfg.genreInfo[r.genres[0]];
      tear(fctx, g, fx(r.x + 0.5), fy(r.y + 0.5), 1);
      if (r.stray) stray(fctx, r.stray, fx(r.x + 0.5) + 8, fy(r.y + 0.5) - 8, 1);
      plate(fctx, r.name, fx(r.x + 0.5), fy(r.y + 0.5) + 14, { size: 11, align: 'center', weight: 400, sub: 'wild', placed: frontierLabels });
    }

    // ---------- 3. the sampler ----------
    const CW = 640;
    const CH = 420;
    const GAP = 14;
    const COLS = 3;
    const rows = Math.ceil(cfg.cards.length / COLS);
    const sheet = canvasOf(COLS * CW + (COLS + 1) * GAP, rows * CH + (rows + 1) * GAP + TOP);
    const sctx = sheet.getContext('2d');
    sctx.fillStyle = '#23262d';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    header(sctx, sheet.width, 'Rifts, generated', 'real ones from real causes (same cause, same rift) · wild ones from the world seed, chunk and day · the ladder goes down forever');
    const wrap = (ctx, text, maxWidth) => {
      const out = [];
      let line = '';
      for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; } else line = next;
      }
      if (line) out.push(line);
      return out;
    };
    cfg.cards.forEach((card, n) => {
      const col = n % COLS;
      const row = Math.floor(n / COLS);
      const x0 = GAP + col * (CW + GAP);
      const y0 = TOP + GAP + row * (CH + GAP);
      const g0 = cfg.genreInfo[card.genres[0]];
      sctx.fillStyle = CREAM;
      sctx.fillRect(x0, y0, CW, CH);
      sctx.fillStyle = g0.rim;
      sctx.fillRect(x0, y0, 6, CH);
      // Title.
      sctx.fillStyle = INK;
      sctx.font = `600 18px ${FONT}`;
      let y = y0 + 26;
      for (const line of wrap(sctx, card.name, CW - 30).slice(0, 2)) { sctx.fillText(line, x0 + 18, y); y += 22; }
      // Kind, genres, stage.
      sctx.font = `400 12px ${FONT}`;
      sctx.fillStyle = '#6b6f63';
      const kind = card.kind === 'real' ? 'Real rift' : `Wild rift · depth ${card.depth} · tier ${card.tier}`;
      sctx.fillText(`${kind} · ${card.stage}${card.fusion ? ` · ${card.fusion}` : ''}${card.maelstrom ? ' · Maelstrom' : ''}`, x0 + 18, y);
      y += 8;
      let cx = x0 + 18;
      for (const id of card.genres) {
        const gi = cfg.genreInfo[id];
        sctx.font = `600 11px ${FONT}`;
        const w = sctx.measureText(gi.name).width + 22;
        sctx.fillStyle = INK; sctx.fillRect(cx, y, w, 18);
        sctx.fillStyle = gi.rim; sctx.fillRect(cx + 3, y + 3, 12, 12);
        sctx.fillStyle = gi.inner; sctx.fillRect(cx + 6, y + 6, 6, 6);
        sctx.fillStyle = CREAM; sctx.fillText(gi.name, cx + 18, y + 13);
        cx += w + 6;
      }
      y += 34;
      // Text lines on the left; the Elsewhere's layout on the right.
      const TW = 350;
      const line = (label, text, { italic = false, colour = INK } = {}) => {
        sctx.font = `600 12px ${FONT}`;
        const lw = label ? sctx.measureText(label).width + 6 : 0;
        if (label) { sctx.fillStyle = INK; sctx.fillText(label, x0 + 18, y); }
        sctx.font = `${italic ? 'italic ' : ''}400 12px ${FONT}`;
        sctx.fillStyle = colour;
        const lines = wrap(sctx, text, TW - lw);
        lines.slice(0, 3).forEach((l, i) => sctx.fillText(l, x0 + 18 + (i === 0 ? lw : 0), y + i * 16));
        y += Math.min(3, lines.length) * 16 + 4;
      };
      line('Where', card.where);
      if (card.cause) line('Why', card.cause);
      for (const affix of card.affixes) line(affix.name, affix.text);
      line('Tale-lead', `${card.taleLead.name}. ${card.taleLead.mechanic[0].toUpperCase()}${card.taleLead.mechanic.slice(1)}.`);
      line('', `“${card.taleLead.line}”`, { italic: true, colour: '#6b6f63' });
      if (card.taleLead.council) line('Council', card.taleLead.council.join('; '));
      line('Loot', card.loot.map((l) => (l.relic ? `${l.item} (${l.text})` : `${l.qty} ${l.item}`)).join(' · '));
      // Layout.
      const lay = card.layout;
      const LW = 240;
      const LH = 170;
      const px = Math.max(1, Math.floor(Math.min(LW / lay[0].length, LH / lay.length)));
      const lx = x0 + CW - 18 - lay[0].length * px;
      const ly = y0 + 78;
      sctx.fillStyle = '#23262d';
      sctx.fillRect(lx - 4, ly - 4, lay[0].length * px + 8, lay.length * px + 8);
      const pal = (i, j) => cfg.palettesHex[card.genres[((i >> 1) + (j >> 1)) % card.genres.length]];
      lay.forEach((rowText, j) => [...rowText].forEach((ch, i) => {
        const p = pal(i, j);
        let c = null;
        if (ch === '#') {
          const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => (lay[j + dy]?.[i + dx] ?? '#') !== '#');
          c = near ? (lay[j + 1]?.[i] && lay[j + 1][i] !== '#' ? p.s : p.o) : null;
        } else if (ch === '.') c = (i + j) % 2 ? p.g : p.G;
        else if (ch === '~') c = p.w;
        else if (ch === '"') c = p.L;
        else if (ch === 'E') c = p.c;
        else if (ch === 'B') c = g0.rim;
        else if (ch === 'S') c = g0.inner;
        else if (ch === 'P') c = p.e;
        else if (ch === 'L') c = p.U;
        if (!c) return;
        sctx.fillStyle = c;
        sctx.fillRect(lx + i * px, ly + j * px, px, px);
      }));
      sctx.font = `400 11px ${FONT}`;
      sctx.fillStyle = '#6b6f63';
      sctx.fillText(`The Elsewhere: ${lay[0].length}×${lay.length}`, lx, ly + lay.length * px + 18);
      // Strays.
      const sy = y0 + CH - 104;
      card.strays.slice(0, 4).forEach((s, k) => {
        const sx = x0 + 18 + k * 150;
        sctx.fillStyle = '#efe3c8';
        sctx.fillRect(sx, sy, 64, 64);
        stray(sctx, s, sx + 2, sy + 2, 3);
        sctx.fillStyle = INK;
        sctx.font = `600 11px ${FONT}`;
        const nameLines = wrap(sctx, `${s.name} ×${s.count}`, 78).slice(0, 3);
        nameLines.forEach((l, i) => sctx.fillText(l, sx + 68, sy + 12 + i * 13));
        sctx.font = `400 11px ${FONT}`;
        sctx.fillStyle = '#6b6f63';
        sctx.fillText(s.temperament, sx + 68, sy + 18 + nameLines.length * 13);
        const gname = (id) => cfg.genreInfo[id].name;
        sctx.fillText(s.second ? `${gname(s.genre)} × ${gname(s.second)}` : gname(s.genre), sx + 68, sy + 32 + nameLines.length * 13);
      });
    });

    return { atlas: atlas.toDataURL('image/png'), frontier: frontier.toDataURL('image/png'), sampler: sheet.toDataURL('image/png') };
  }, config);

  for (const [name, file] of [['atlas', 'world-atlas.png'], ['frontier', 'world-frontier.png'], ['sampler', 'rift-sampler.png']]) {
    await writeFile(path.join(results, file), Buffer.from(images[name].split(',')[1], 'base64'));
  }
  console.log(JSON.stringify({
    errors, generatedMs: generated,
    wild: wild.length, real: REAL.map((r) => ({ name: r.spec.name, beyond: r.at.beyond })),
    pois: pois.length, wrote: ['test-results/world-atlas.png', 'test-results/world-frontier.png', 'test-results/rift-sampler.png'],
  }, null, 1));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
