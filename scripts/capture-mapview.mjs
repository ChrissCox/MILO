// Captures of the map view (CONTRACT-PHASE3.md §8, §9 I) in Electron, in MILO's own chrome at
// 1000×700: a real paintChunk from wilds.js and wildsart.js (what the engine's paintMapChunk does),
// the vale from the engine's renderMap(1), a made-up explored set round the vale and up the north
// road to the Whisperwood, and a few markers. It also drives the view: hover, travel, keys, drag,
// closing, and the 1000×700 fit, and prints what it found.
//
//   node scripts/capture-mapview.mjs [scale]      (scale: the device pixel ratio to force, default 1)
//
// Writes, to test-results/:
//   mapview-far.png, mapview-middle.png, mapview-near.png   each zoom, centred on Milo
//   mapview-hover.png      a lantern's hover label
//   mapview-travel.png     "Travel to …?" beside a lit lantern
//   mapview-list.png       the same asked from the travel list (keyboard)
//   mapview-showme.png     open({ focus }) on a real rift, as a rift panel's "Show me" would
//   mapview-fog-zoom.png   the fog's edge at 3× (from the map's own canvas)
//   mapview-vale-zoom.png  Hearthvale and the north gate at 3×
//   mapview-wider.png      weeks later: the west road to Cinderforge and the south-west road walked too (far)
//   mapview-wider-middle.png  the same, at the middle zoom on the road west
//   mapview-lake.png       the lake at the vale's south-east corner (near), the harbor's mist running on
//   mapview-lake-zoom.png  the same at 3× (from the map's own canvas)
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldgen, CHUNK, GATES } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { createNav } from '../src/world/nav.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });
const scale = Number(process.argv[2]) || 1;
const seed = 'hushlands';
const words = JSON.parse(await readFile(path.join(repo, 'content', 'riftgen.json'), 'utf8'));

// ---------- the data: explored chunks and markers (synthetic, from the real world) ----------

const worldgen = createWorldgen({ seed, regionWords: words.regionWords });
const wilds = createWilds({ worldgen, maxChunks: 400 });
const nav = createNav({ worldgen, wildBlocked: wilds.blocked, extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
const whisper = worldgen.anchorById.whisperwood;
const gateN = { x: GATES['gate:n'].edge.x, y: GATES['gate:n'].edge.y - 1 };
const road = nav.findPath(gateN, { x: whisper.x, y: whisper.y + 4 }, { maxNodes: 80000, margin: 60 });
if (!road.length) throw new Error('no path up the north road');

const explored = new Set();
const seeTile = (x, y, hw = 20, hh = 13) => {
  for (let cy = Math.floor((y - hh) / CHUNK); cy <= Math.floor((y + hh) / CHUNK); cy += 1) {
    for (let cx = Math.floor((x - hw) / CHUNK); cx <= Math.floor((x + hw) / CHUNK); cx += 1) explored.add(`${cx},${cy}`);
  }
};
// Round the vale: Milo walked its edges and out of the west and east gates a little.
for (const [x, y] of [[32, 4], [8, 20], [56, 14], [32, 40], [-10, 20], [74, 14], [11, 50]]) seeTile(x, y);
// Up the north road, most of the way to the Whisperwood.
const walked = road.slice(0, Math.round(road.length * 0.92));
for (const t of walked) seeTile(t.x, t.y);

const inExplored = (x, y) => explored.has(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
const milo = walked[Math.round(walked.length * 0.55)];
const markers = [
  { kind: 'home', id: 'home', x: 31, y: 22, label: 'Hearthvale', travel: true },
  { kind: 'milo', id: 'milo', x: milo.x, y: milo.y, label: 'Milo' },
  { kind: 'region', id: 'region:whisperwood', x: whisper.x, y: whisper.y - 3, label: whisper.name, hush: true },
];
const lanterns = wilds.fixedPois().filter((p) => p.type === 'lantern' && inExplored(p.x, p.y));
const litIds = new Set();
for (const p of lanterns) {
  const lit = p.y < -20 || (p.x < 0 && p.y < 0); // the north road's and one west of the vale
  if (lit) litIds.add(p.id);
  markers.push({ kind: 'lantern', id: p.id, x: p.x, y: p.y, label: lit ? `A lantern ${p.y < -20 ? 'on the north road' : 'by the west track'}` : 'A sleeping lantern', lit, travel: lit });
}
// Points of interest in explored chunks.
const pois = [];
for (const key of explored) {
  const [cx, cy] = key.split(',').map(Number);
  for (const p of wilds.chunk(cx, cy).pois) if (!['lantern'].includes(p.type)) pois.push(p);
}
for (const p of pois.slice(0, 14)) markers.push({ kind: 'poi', id: p.id, x: p.x, y: p.y, type: p.type, label: p.name || p.type });
// Rifts: a real one by the north gate, a wild one out west and a gaping fusion to the east.
const free = (x, y, r = 4) => {
  for (let d = 0; d <= r; d += 1) for (let dy = -d; dy <= d; dy += 1) for (let dx = -d; dx <= d; dx += 1) if (nav.walkable(x + dx, y + dy) && !(x + dx >= 0 && y + dy >= 0 && x + dx < 64 && y + dy < 44)) return { x: x + dx, y: y + dy };
  return { x, y };
};
const r1 = free(40, -12);
const r2 = free(-22, 6);
const r3 = free(78, 4);
markers.push(
  { kind: 'rift', id: 'rift:real1', x: r1.x, y: r1.y, label: 'The Lantern-Lit Hush (nocturne), past your evening bell', genre: 'nocturne', stage: 'open' },
  { kind: 'rift', id: 'rift:wild1', x: r2.x, y: r2.y, label: 'A neon hairline', genre: 'neon', stage: 'hairline' },
  { kind: 'rift', id: 'rift:wild2', x: r3.x, y: r3.y, label: 'The Gaping Choir (void and gothic)', genres: ['void', 'gothic'], stage: 'gaping' },
);

// Weeks later: the west road most of the way to Cinderforge and the south-west road to the Dicing Downs.
const wider = new Set(explored);
const widerMarkers = markers.map((m) => ({ ...m }));
const cinder = worldgen.anchorById.cinderforge;
const downs = worldgen.anchorById['dicing-downs'];
const westGate = { x: GATES['gate:w'].edge.x - 2, y: GATES['gate:w'].edge.y };
const swGate = { x: GATES['gate:sw'].edge.x, y: GATES['gate:sw'].edge.y + 2 };
const westRoad = nav.findPath(westGate, { x: cinder.x + 6, y: cinder.y }, { maxNodes: 200000, margin: 60 });
const swRoad = nav.findPath(swGate, { x: downs.x, y: downs.y - 4 }, { maxNodes: 200000, margin: 60 });
const mist = worldgen.anchorById.mistmere;
const eastRoad = nav.findPath({ x: GATES['gate:e'].edge.x + 2, y: GATES['gate:e'].edge.y }, { x: mist.x - 4, y: mist.y }, { maxNodes: 200000, margin: 60 });
const beforeWider = new Set(wider);
for (const t of westRoad.slice(0, Math.round(westRoad.length * 0.85))) {
  for (let cy = Math.floor((t.y - 13) / CHUNK); cy <= Math.floor((t.y + 13) / CHUNK); cy += 1) for (let cx = Math.floor((t.x - 20) / CHUNK); cx <= Math.floor((t.x + 20) / CHUNK); cx += 1) wider.add(`${cx},${cy}`);
}
for (const t of [...swRoad.slice(0, Math.round(swRoad.length * 0.7)), ...eastRoad.slice(0, Math.round(eastRoad.length * 0.6)), ...road]) {
  for (let cy = Math.floor((t.y - 13) / CHUNK); cy <= Math.floor((t.y + 13) / CHUNK); cy += 1) for (let cx = Math.floor((t.x - 20) / CHUNK); cx <= Math.floor((t.x + 20) / CHUNK); cx += 1) wider.add(`${cx},${cy}`);
}
const widerIn = (x, y) => wider.has(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
for (const p of wilds.fixedPois().filter((q) => q.type === 'lantern' && widerIn(q.x, q.y) && !inExplored(q.x, q.y))) {
  const lit = p.x < -60;
  widerMarkers.push({ kind: 'lantern', id: p.id, x: p.x, y: p.y, label: lit ? 'A lantern on the west road' : 'A sleeping lantern', lit, travel: lit });
}
if (widerIn(cinder.x, cinder.y - 3)) widerMarkers.push({ kind: 'region', id: 'region:cinderforge', x: cinder.x, y: cinder.y - 3, label: cinder.name, hush: true });
const r4 = free(-70, 18);
widerMarkers.push({ kind: 'rift', id: 'rift:wild3', x: r4.x, y: r4.y, label: 'An iron rift', genre: 'iron', stage: 'open' });
const widerMilo = westRoad[Math.round(westRoad.length * 0.6)];
widerMarkers.find((m) => m.kind === 'milo').x = widerMilo.x;
widerMarkers.find((m) => m.kind === 'milo').y = widerMilo.y;

// ---------- Electron ----------

const userData = await mkdtemp(path.join(tmpdir(), 'milo-mapview-'));
const main = path.join(userData, 'main.cjs');
await writeFile(main, `
const { app, BrowserWindow, session } = require('electron');
app.setPath('userData', ${JSON.stringify(userData)});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('file://') && !d.url.startsWith('devtools://') }));
  const win = new BrowserWindow({ width: 1000, height: 700, useContentSize: true, show: false, backgroundColor: '#cfe2b3',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.loadFile(${JSON.stringify(path.join(repo, 'scripts', 'mapview-preview.html'))});
});
app.on('window-all-closed', () => app.quit());
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electronPath,
  args: [main, `--user-data-dir=${userData}`, `--force-device-scale-factor=${scale}`],
  cwd: repo, env, timeout: 30000,
});

const report = { scale, explored: explored.size, markers: markers.length, lanterns: lanterns.length, lit: litIds.size, checks: {}, errors: [] };
const check = (name, ok, detail) => {
  report.checks[name] = ok ? 'ok' : `FAILED${detail ? `: ${detail}` : ''}`;
};

try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') report.errors.push(`${msg.type()}: ${msg.text()}`); });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await page.evaluate((cfg) => window.__boot(cfg), { seed, regionWords: words.regionWords, explored: [...explored], markers, now: 1_790_000_000_000, motion: process.env.MAP_MOTION === '1', ...(process.env.MAP_PAINT_AT ? { paintAt: process.env.MAP_PAINT_AT === 'zoom' ? null : Number(process.env.MAP_PAINT_AT) } : {}) });

  const settle = async () => {
    await page.waitForFunction(() => !window.__map.debug().pending, null, { timeout: 20000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  const shot = async (name, clip) => {
    await page.screenshot({ path: path.join(results, `mapview-${name}${process.env.MAP_SUFFIX || ''}.png`), ...(clip ? { clip } : {}) });
  };

  // Open at the middle zoom, centred on Milo.
  let t0 = Date.now();
  await page.evaluate(() => window.__map.open());
  await settle();
  report.openMs = Date.now() - t0;
  check('opens', await page.evaluate(() => window.__map.isOpen() && !document.getElementById('map').hidden));
  check('focus lands on the title', await page.evaluate(() => document.activeElement?.classList.contains('map-title')));
  await shot('middle');

  // Fit at 1000×700: nothing scrolls, the view sits inside the stage.
  const fit = await page.evaluate(() => {
    const root = document.getElementById('map').getBoundingClientRect();
    const stage = document.getElementById('stage').getBoundingClientRect();
    const se = document.scrollingElement;
    const over = [...document.querySelectorAll('#map *')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width && (r.right > root.right + 1 || r.bottom > root.bottom + 1 || r.left < root.left - 1 || r.top < root.top - 1) && !n.closest('[hidden]');
    }).map((n) => n.className);
    return { w: innerWidth, h: innerHeight, root: [root.left, root.top, root.right, root.bottom], stage: [stage.left, stage.top, stage.right, stage.bottom], scroll: [se.scrollWidth, se.scrollHeight], over };
  });
  report.fit = fit;
  check('fits 1000×700', fit.root[0] >= fit.stage[0] && fit.root[1] >= fit.stage[1] && fit.root[2] <= fit.stage[2] && fit.root[3] <= fit.stage[3] && fit.scroll[0] <= fit.w && fit.scroll[1] <= fit.h && fit.over.length === 0, JSON.stringify(fit));

  // Zooms, by their buttons.
  for (const [name, label] of [['far', 'Far'], ['near', 'Near'], ['middle', 'Middle']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await settle();
    const z = await page.evaluate(() => window.__map.debug().view.zoom);
    check(`zoom ${label}`, z === { far: 2, middle: 4, near: 8 }[name], `zoom ${z}`);
    if (name !== 'middle') await shot(name);
  }
  // Draw time at each zoom with everything cached.
  report.drawMs = {};
  for (const label of ['Far', 'Middle', 'Near']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await settle();
    report.drawMs[label] = await page.evaluate(async () => {
      const times = [];
      for (let i = 0; i < 12; i += 1) {
        window.__map.refresh();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        times.push(window.__map.debug().lastDrawMs);
      }
      times.sort((a, b) => a - b);
      return +times[Math.floor(times.length / 2)].toFixed(2);
    });
  }
  await page.getByRole('button', { name: 'Middle', exact: true }).click();
  await settle();
  report.paints = await page.evaluate(() => {
    const ms = window.__paints.map((p) => p.ms).sort((a, b) => a - b);
    return { count: ms.length, median: +ms[Math.floor(ms.length / 2)].toFixed(2), max: +ms[ms.length - 1].toFixed(2) };
  });

  // Where a marker is on screen (CSS px, page coordinates).
  const screenOf = (id) => page.evaluate((markerId) => {
    const d = window.__map.debug();
    const m = window.__markersById[markerId];
    const canvas = document.querySelector('.map-canvas').getBoundingClientRect();
    const t = d.view.zoom * d.view.pixel;
    const ox = Math.round(d.view.width / 2 - d.view.cx * t);
    const oy = Math.round(d.view.height / 2 - d.view.cy * t);
    return { x: canvas.left + (ox + (m.x + 0.5) * t) / d.dpr, y: canvas.top + (oy + (m.y + 0.5) * t) / d.dpr };
  }, id);
  await page.evaluate((list) => { window.__markersById = Object.fromEntries(list.map((m) => [m.id, m])); }, markers);

  // Hover a lit lantern on the north road, then click it.
  const lanternId = [...litIds].map((id) => markers.find((m) => m.id === id)).sort((a, b) => Math.hypot(a.x - milo.x, a.y - milo.y) - Math.hypot(b.x - milo.x, b.y - milo.y))[0]?.id;
  if (lanternId) {
    const at = await screenOf(lanternId);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(80);
    const tip = await page.evaluate(() => { const t = document.querySelector('.map-tip'); return t.hidden ? null : t.textContent; });
    check('hover shows the label', Boolean(tip && /lantern/i.test(tip)), String(tip));
    await shot('hover');
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(80);
    const ask = await page.evaluate(() => ({ shown: !document.querySelector('.map-ask').hidden, q: document.querySelector('.map-ask-q').textContent, focus: document.activeElement?.textContent }));
    check('click asks to travel', ask.shown && ask.q === 'Travel to a lantern on the north road?' && ask.focus === 'Travel', JSON.stringify(ask));
    await shot('travel');
    // Esc backs out of the question, not the map.
    await page.keyboard.press('Escape');
    check('Esc cancels the question first', await page.evaluate(() => window.__map.isOpen() && document.querySelector('.map-ask').hidden));
    // Ask again and travel.
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
    const log = await page.evaluate(() => window.__log.slice());
    check('travel calls onClose then onTravel', JSON.stringify(log.slice(-2)) === JSON.stringify([['close', 'travel'], ['travel', lanternId, 'lantern']]) && !(await page.evaluate(() => window.__map.isOpen())), JSON.stringify(log));
  } else check('a lit lantern to try', false, 'none explored');

  // The travel list, by keyboard.
  await page.evaluate(() => window.__map.open());
  await settle();
  const listInfo = await page.evaluate(() => [...document.querySelectorAll('.map-dest')].map((b) => b.textContent));
  report.travelList = listInfo;
  check('travel list: home first, then lit lanterns', listInfo.length === 1 + litIds.size && listInfo[0].startsWith('Hearthvale'), JSON.stringify(listInfo));
  await page.locator('.map-dest').nth(1).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  await settle();
  check('the list asks too', await page.evaluate(() => !document.querySelector('.map-ask').hidden && document.activeElement?.textContent === 'Travel'));
  await shot('list');
  // The shell refreshes the map while the question is open (a building finishes): the list is
  // built again under it, and Esc still finds its way back to the same place in the new list.
  const asked = await page.evaluate(() => document.querySelectorAll('.map-dest')[1].dataset.marker);
  await page.evaluate(() => window.__setData({}));
  await page.keyboard.press('Escape');
  check('Esc returns to the list, even after a refresh', await page.evaluate((id) => document.activeElement?.classList.contains('map-dest') && document.activeElement.dataset.marker === id && document.activeElement.isConnected, asked));
  const z0 = await page.evaluate(() => window.__map.debug().view.zoom);
  await page.keyboard.press('+');
  check('the map’s keys work from there', (await page.evaluate(() => window.__map.debug().view.zoom)) !== z0 || z0 === 8);
  await page.keyboard.press('-');

  // "Show me" from a rift panel: open at the rift, pointed out.
  await page.evaluate(() => { window.__map.close(); window.__map.open({ focus: 'rift:real1' }); });
  await settle();
  const shown = await page.evaluate(() => window.__map.debug().view);
  check('open({ focus }) centres on the marker', Math.abs(shown.cx - (r1.x + 0.5)) < 1e-6 && Math.abs(shown.cy - (r1.y + 0.5)) < 1e-6, JSON.stringify(shown));
  await shot('showme');

  // Keys: arrows pan, plus and minus zoom, C centres, M closes.
  await page.locator('.map-viewport').focus();
  const before = await page.evaluate(() => window.__map.debug().view);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => window.__map.debug().view);
  check('arrow keys pan', after.cx > before.cx && after.cy > before.cy, JSON.stringify([before.cx, before.cy, after.cx, after.cy]));
  await page.keyboard.press('+');
  check('plus zooms in', (await page.evaluate(() => window.__map.debug().view.zoom)) === 8);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  check('minus zooms out', (await page.evaluate(() => window.__map.debug().view.zoom)) === 2);
  await page.keyboard.press('+');
  await page.keyboard.press('c');
  await page.waitForTimeout(450); // an eased pan when motion is on
  const centred = await page.evaluate(() => window.__map.debug().view);
  check('C centres on Milo', Math.abs(centred.cx - (milo.x + 0.5)) < 0.01 && Math.abs(centred.cy - (milo.y + 0.5)) < 0.01, JSON.stringify(centred));

  // Drag pans.
  const box = await page.locator('.map-viewport').boundingBox();
  const v0 = await page.evaluate(() => window.__map.debug().view);
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 6 });
  await page.mouse.up();
  const v1 = await page.evaluate(() => window.__map.debug().view);
  check('drag pans', v1.cx < v0.cx && v1.cy < v0.cy, JSON.stringify([v0.cx, v0.cy, v1.cx, v1.cy]));
  check('a drag is not a click', await page.evaluate(() => document.querySelector('.map-ask').hidden));

  // Crops from the map's own canvas at 3×: the fog's edge and the vale with the north gate.
  await page.getByRole('button', { name: 'Centre on Milo' }).click();
  await settle();
  const crops = await page.evaluate(async () => {
    const src = document.querySelector('.map-canvas');
    const d = window.__map.debug();
    const t = d.view.zoom * d.view.pixel;
    const ox = Math.round(d.view.width / 2 - d.view.cx * t);
    const oy = Math.round(d.view.height / 2 - d.view.cy * t);
    const crop = (x, y, w, h, k) => {
      const c = document.createElement('canvas');
      c.width = w * k; c.height = h * k;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, x, y, w, h, 0, 0, w * k, h * k);
      return c.toDataURL('image/png');
    };
    const fog = crop(Math.max(0, d.view.width / 2 - 260), Math.max(0, d.view.height / 2 - 150), 260, 170, 3);
    window.__map.open({ center: { x: 32, y: 6 }, zoom: 4 });
    await new Promise((r) => setTimeout(r, 400));
    const d2 = window.__map.debug();
    const t2 = d2.view.zoom * d2.view.pixel;
    const ox2 = Math.round(d2.view.width / 2 - d2.view.cx * t2);
    const oy2 = Math.round(d2.view.height / 2 - d2.view.cy * t2);
    const vale = crop(Math.max(0, ox2 + 8 * t2), Math.max(0, oy2 - 16 * t2), 48 * t2, 34 * t2, 3);
    return { fog, vale, ox, oy };
  });
  const suffix = process.env.MAP_SUFFIX || '';
  await writeFile(path.join(results, `mapview-fog-zoom${suffix}.png`), Buffer.from(crops.fog.split(',')[1], 'base64'));
  await writeFile(path.join(results, `mapview-vale-zoom${suffix}.png`), Buffer.from(crops.vale.split(',')[1], 'base64'));

  // Closing: Esc, M, and the close button each call onClose once.
  const closes = [];
  for (const how of ['Escape', 'm', 'button']) {
    await page.evaluate(() => window.__map.open());
    await settle();
    if (how === 'button') await page.getByRole('button', { name: 'Close map' }).click();
    else await page.keyboard.press(how);
    closes.push(await page.evaluate(() => [window.__map.isOpen(), window.__log[window.__log.length - 1]]));
  }
  check('Esc, M and the button close it', closes.every(([open, last]) => !open && last[0] === 'close'), JSON.stringify(closes));

  // Refresh with more explored ground while open: the fog lifts where Milo went.
  await page.evaluate(() => window.__map.open({ zoom: 2 }));
  await settle();
  const before2 = await page.evaluate(() => window.__map.debug().known);
  await page.evaluate((next) => window.__setData(next), { explored: [...wider], markers: widerMarkers });
  const after2 = await page.evaluate(() => window.__map.debug().known);
  check('refresh reads explored again', after2 === wider.size && after2 > before2, `${before2} → ${after2}`);
  report.wider = { explored: wider.size, added: wider.size - beforeWider.size, markers: widerMarkers.length };
  await page.getByRole('button', { name: 'Centre on Milo' }).click();
  await settle();
  const t1 = Date.now();
  await settle();
  report.widerSettleMs = Date.now() - t1;
  await page.evaluate(() => window.__map.open({ zoom: 2, center: { x: -30, y: 10 } }));
  await settle();
  await shot('wider');
  await page.evaluate((c) => window.__map.open({ zoom: 4, center: c }), { x: widerMilo.x, y: widerMilo.y });
  await settle();
  await shot('wider-middle');

  // The lake at the vale's south-east corner, walked round: the harbor's mist runs on over the sea
  // (no pale rectangle where the vale's picture ends) and the water has no seam.
  await page.evaluate((next) => window.__setData(next), { explored: [...wider, '0,1', '1,1', '2,1', '2,0', '0,2', '1,2', '2,2'] });
  await page.evaluate(() => window.__map.open({ zoom: 8, center: { x: 56, y: 42 } }));
  await settle();
  await shot('lake');
  const lake = await page.evaluate(() => {
    const src = document.querySelector('.map-canvas');
    const d = window.__map.debug();
    const t = d.view.zoom * d.view.pixel;
    const ox = Math.round(d.view.width / 2 - d.view.cx * t);
    const oy = Math.round(d.view.height / 2 - d.view.cy * t);
    const data = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    const at = (x, y) => (Math.round(y) * src.width + Math.round(x)) * 4;
    // Mean difference a channel between pixel pairs either side of a line.
    const across = (pairs) => {
      let sum = 0;
      for (const [[ax, ay], [bx, by]] of pairs) {
        const p = at(ax, ay);
        const q = at(bx, by);
        sum += Math.abs(data[p] - data[q]) + Math.abs(data[p + 1] - data[q + 1]) + Math.abs(data[p + 2] - data[q + 2]);
      }
      return +(sum / (pairs.length * 3)).toFixed(2);
    };
    const edge = (x0, x1, y) => { const out = []; for (let x = ox + x0 * t; x < ox + x1 * t; x += 1) out.push([[x, oy + y * t - 1], [x, oy + y * t]]); return out; };
    const column = (x, y0, y1) => { const out = []; for (let y = oy + y0 * t; y < oy + y1 * t; y += 1) out.push([[ox + x * t - 1, y], [ox + x * t, y]]); return out; };
    // Under the mist: the vale's south edge beneath the harbor, and the two lines on its east where
    // the vale's picture stops its mist (the bank's box, a tile in) and where the vale ends. For a
    // measure of the water's own sparkle, a row in the vale's sea clear of any edge.
    const result = {
      south: across(edge(44, 62, 44)),
      eastBox: across(column(63, 34, 44)),
      eastVale: across(column(64, 34, 44)),
      openWater: across(edge(44, 62, 40)),
    };
    const k = 3;
    const w = 36 * t;
    const h = 22 * t;
    const c = document.createElement('canvas');
    c.width = w * k;
    c.height = h * k;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, ox + 36 * t, oy + 30 * t, w, h, 0, 0, w * k, h * k);
    result.crop = c.toDataURL('image/png');
    return result;
  });
  await writeFile(path.join(results, `mapview-lake-zoom${suffix}.png`), Buffer.from(lake.crop.split(',')[1], 'base64'));
  delete lake.crop;
  report.lake = lake;
  const calm = Math.max(4, lake.openWater * 2);
  check('the harbor’s mist runs on past the vale', lake.south <= calm && lake.eastBox <= calm && lake.eastVale <= calm, JSON.stringify(lake));

  report.errors.push(...(await page.evaluate(() => window.__errors)));
  check('no page errors', report.errors.length === 0, report.errors.join(' | '));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(report, null, 2));
if (Object.values(report.checks).some((v) => v !== 'ok')) process.exitCode = 1;
