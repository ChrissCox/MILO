// Captures screenshots of the MILO world preview into test-results/world-*.png.
// Run: node scripts/capture-world.mjs [sceneName ...]
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
const previewUrl = pathToFileURL(path.join(repo, 'scripts', 'world-preview.html')).href;
await mkdir(results, { recursive: true });

const SCENES = [
  { name: 'camp', query: 'at=camp' },
  { name: 'greeting', query: 'entrance=1&bubble=1', waitEntrance: true },
  { name: 'watchtower', query: 'at=watchtower' },
  { name: 'workshop', query: 'at=workshop&crew=busy' },
  { name: 'library', query: 'at=library' },
  { name: 'game-table', query: 'at=game-table' },
  { name: 'building-site', query: 'at=building-site' },
  { name: 'clip-studio', query: 'at=clip-studio' },
  { name: 'harbor', query: 'at=harbor' },
  { name: 'rest', query: 'at=camp&crew=rest' },
  { name: 'still', query: 'at=camp&motion=0' },
  { name: 'small', query: 'at=camp', size: [800, 600] },
  { name: 'overview', query: 'view=overview&ovscale=1', overview: true },
];

const only = process.argv.slice(2);
const scenes = only.length ? SCENES.filter((s) => only.includes(s.name)) : SCENES;
const userData = await mkdtemp(path.join(tmpdir(), 'milo-world-preview-'));
const env = { ...process.env, MILO_PREVIEW_USER_DATA: userData, MILO_PREVIEW_SIZE: '1000x700' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await _electron.launch({
  executablePath: electronPath,
  args: [path.join(repo, 'scripts', 'world-preview-main.cjs'), `--user-data-dir=${userData}`],
  cwd: repo,
  env,
  timeout: 30000,
});
const report = { errors: [], shots: [], checks: [] };
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  const external = [];
  page.on('request', (request) => { if (!request.url().startsWith('file://')) external.push(request.url()); });

  for (const scene of scenes) {
    const [w, h] = scene.size || [1000, 700];
    await app.evaluate(({ BrowserWindow }, [width, height]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(width, height);
    }, [w, h]);
    await page.goto(`${previewUrl}?${scene.query}`);
    try {
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
    } catch (error) {
      console.error(`Scene ${scene.name} did not load.`, report.errors);
      throw error;
    }
    if (scene.waitEntrance) await page.waitForFunction(() => window.__entered === true, null, { timeout: 15000 });
    await page.waitForTimeout(scene.overview ? 200 : 900);
    const file = path.join(results, `world-${scene.name}.png`);
    if (scene.overview) {
      const dataUrl = await page.evaluate(() => window.__overview);
      await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    } else {
      await page.screenshot({ path: file });
    }
    report.shots.push(path.relative(repo, file));
  }

  if (!only.length || only.includes('interact')) {
    // Behaviour checks: click the watchtower, walk with keys, entrance with motion off.
    // Arrow keys: one step south from the camp door.
    await page.goto(`${previewUrl}?at=camp`);
    await page.waitForFunction(() => window.__ready === true);
    const before = await page.evaluate(() => window.__world.miloTile());
    await page.locator('#world').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.__world.miloTile());
    report.checks.push({ name: 'arrow key steps one tile', ok: after.y === before.y + 1 && after.x === before.x, detail: { before, after } });
    // Start on the upper road just south of the tower, then click the tower itself.
    await page.goto(`${previewUrl}?at=watchtower`);
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => window.__world.walkTo({ x: 31, y: 12 }));
    await page.waitForTimeout(600);
    const box = await page.locator('#world').boundingBox();
    const towerPoint = await page.evaluate(() => {
      const s = window.__world.scale;
      const pos = window.__world.miloScreenPos();
      // Milo's head is at the foot of the road; the tower's lookout is about 60 px above it.
      return { x: pos.x, y: pos.y - 60 * s };
    });
    await page.mouse.click(box.x + towerPoint.x, box.y + towerPoint.y);
    await page.waitForFunction(() => window.__log.some((e) => e[0] === 'place'), null, { timeout: 15000 }).catch(() => {});
    const placeEvents = await page.evaluate(() => window.__log.filter((e) => e[0] === 'place'));
    report.checks.push({ name: 'click tower opens watchtower', ok: placeEvents.some((e) => e[1] === 'watchtower'), detail: placeEvents });
    await page.goto(`${previewUrl}?motion=0&entrance=1`);
    await page.waitForFunction(() => window.__entered === true, null, { timeout: 5000 }).catch(() => {});
    const still = await page.evaluate(() => ({ entered: window.__entered === true, tile: window.__world.miloTile() }));
    report.checks.push({ name: 'entrance resolves at once with motion off', ok: still.entered && still.tile.x === 31 && still.tile.y === 22, detail: still });
    report.checks.push({ name: 'no requests leave the PC', ok: external.length === 0, detail: external.slice(0, 5) });
    const pageErrors = await page.evaluate(() => window.__errors);
    report.errors.push(...pageErrors);
  }
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(report, null, 2));
if (report.errors.length || report.checks.some((c) => !c.ok)) process.exitCode = 1;
