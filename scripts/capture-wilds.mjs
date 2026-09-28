// Captures the world beyond the vale (CONTRACT-PHASE3.md §9 G) into test-results/wilds-*.png:
// the north gate at tier 1 and 2 (and the other gates, the shores and the corners, for the seams
// at the vale's edge), deep in the Whisperwood, Cinderforge, an open Neon rift with its strays, a
// gaping fusion rift with its Tale-lead (and a gaping one of one genre), a warded rift, an echo in
// the vale, three Elsewheres (one a fusion), Milo standing in three bleeds (his coat takes the
// genre, his face stays his; every Elsewhere and bleed scene has a close crop, *-milo.png), Milo
// chopping from either side, the Stockade rising, a seal, a let-go and a lit lantern. Then it times frames in the
// wilds at 1280×820 with three rifts in view (§10: at most 12 ms) and writes wilds-perf.json.
// Every rift is synthetic (the rift generator's own), and nothing real is ever shown.
//
//   node scripts/capture-wilds.mjs [sceneName ...]
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
const previewUrl = pathToFileURL(path.join(repo, 'scripts', 'world-preview.html')).href;
await mkdir(results, { recursive: true });

const read = async (name) => {
  try {
    return JSON.parse(await readFile(path.join(repo, 'content', `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
};
const content = { genres: await read('genres'), riftgen: await read('riftgen'), fortress: await read('fortress'), wilds: await read('wilds'), story: await read('story') };

// Each scene: a query for the preview, then in the page travel, rifts, a walk or a chop, a wait,
// maybe an action caught part way (raise, seal, let-go), and crops to look at closely.
const SCENES = [
  { name: 'north-gate-t1', query: 'x=32&y=2&tier=1&crew=rest&motion=0', crops: [{ name: 'zoom', x: 330, y: 150, w: 340, h: 220 }] },
  { name: 'north-gate-t2', query: 'x=32&y=2&tier=2&crew=rest&motion=0', crops: [{ name: 'zoom', x: 330, y: 110, w: 340, h: 260 }] },
  { name: 'west-gate-t1', query: 'x=1&y=19&tier=1&crew=rest&motion=0' },
  { name: 'west-gate-t2', query: 'x=1&y=19&tier=2&crew=rest&motion=0' },
  { name: 'east-gate-t1', query: 'x=62&y=13&tier=1&crew=rest&motion=0' },
  { name: 'east-gate-t2', query: 'x=62&y=13&tier=2&crew=rest&motion=0' },
  { name: 'southwest-gate-t1', query: 'x=11&y=40&tier=1&crew=rest&motion=0' },
  { name: 'southwest-gate-t2', query: 'x=11&y=40&tier=2&crew=rest&motion=0' },
  { name: 'outside-north', query: 'x=32&y=-6&tier=2&crew=rest&motion=0' },
  // The vale's edge where no gate is: the south shore, the harbour's sea, the east and the corners.
  { name: 'edge-south', query: 'x=26&y=42&tier=1&crew=rest&motion=0' },
  { name: 'edge-harbor', query: 'x=50&y=39&tier=2&crew=rest&motion=0' },
  { name: 'edge-east', query: 'x=62&y=33&tier=1&crew=rest&motion=0' },
  { name: 'edge-east-t2', query: 'x=62&y=33&tier=2&crew=rest&motion=1', wait: 900 },
  { name: 'corner-nw', query: 'x=2&y=4&tier=2&crew=rest&motion=0' },
  { name: 'corner-ne', query: 'x=62&y=4&tier=1&crew=rest&motion=0' },
  { name: 'corner-sw', query: 'x=3&y=42&tier=2&crew=rest&motion=0' },
  { name: 'whisperwood', query: 'x=32&y=2&crew=rest&motion=0', travel: { anchor: 'whisperwood', dx: 0, dy: 6 } },
  { name: 'cinderforge', query: 'x=32&y=2&crew=rest&motion=1', travel: { standing: 'cinderforge', dx: -2, dy: 3 }, wait: 900 },
  { name: 'rift-neon', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [30, -12] }, rifts: [['neon', 'open', 5, -2]], wait: 1400, crops: [{ name: 'zoom', x: 600, y: 230, w: 300, h: 240 }] },
  { name: 'rift-fusion', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [-18, 22] }, rifts: [['iron+neon', 'gaping', 5, -1]], wait: 1400, crops: [{ name: 'zoom', x: 590, y: 220, w: 320, h: 260 }] },
  { name: 'rift-gaping', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [44, -40] }, rifts: [['nocturne', 'gaping', 5, -1]], wait: 1400, crops: [{ name: 'zoom', x: 590, y: 220, w: 320, h: 260 }] },
  { name: 'rift-warded', query: 'x=32&y=2&crew=rest&motion=0', travel: { tile: [74, 16] }, rifts: [['gothic', 'open', 4, -2, 'warded'], ['frontier', 'hairline', -5, -3]] },
  { name: 'echo', query: 'at=camp&crew=rest&motion=1&echo=camp:spark:neon', wait: 700, crops: [{ name: 'zoom', x: 640, y: 20, w: 220, h: 180 }] },
  { name: 'echo-watchtower', query: 'at=watchtower&crew=rest&motion=0&echo=watchtower:knocker:gothic' },
  { name: 'elsewhere-neon', query: 'x=32&y=2&crew=rest&motion=1&elsewhere=neon:open', wait: 1200, miloCrop: true },
  { name: 'elsewhere-neon-seam', query: 'x=32&y=2&crew=rest&motion=0&elsewhere=neon:open', toward: 'stitch', motionAfter: true, wait: 900, miloCrop: true },
  { name: 'elsewhere-gothic', query: 'x=32&y=2&crew=rest&motion=0&elsewhere=gothic:gaping:3', toward: 'tale-lead', motionAfter: true, wait: 900, miloCrop: true },
  { name: 'elsewhere-fusion', query: 'x=32&y=2&crew=rest&motion=1&elsewhere=noir%2Bvoid:open:2', wait: 1200, miloCrop: true },
  { name: 'elsewhere-fusion-curio', query: 'x=32&y=2&crew=rest&motion=0&elsewhere=frontier%2Bnocturne:gaping:2', toward: 'curio', motionAfter: true, wait: 900, miloCrop: true },
  // Milo standing in a bleed out in the wilds: his coat and scarf take the genre, his face stays his.
  { name: 'bleed-neon-milo', query: 'x=32&y=2&crew=rest&motion=0', travel: { tile: [30, -12] }, rifts: [['neon', 'open', 1, -1]], wait: 500, miloCrop: true },
  { name: 'bleed-fusion-milo', query: 'x=32&y=2&crew=rest&motion=0', travel: { tile: [-18, 22] }, rifts: [['iron+neon', 'gaping', 1, -1]], wait: 500, miloCrop: true },
  { name: 'bleed-gothic-milo', query: 'x=32&y=2&crew=rest&motion=0', travel: { tile: [44, -40] }, rifts: [['gothic', 'open', -1, -1]], wait: 500, miloCrop: true },
  { name: 'chop', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [26, -6] }, chop: true, crops: [{ name: 'zoom', x: 380, y: 320, w: 240, h: 170 }] },
  // The same from the other side: Milo west of a pine, swinging right.
  { name: 'chop-right', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [26, -7] }, chop: 'tree:27,-7', crops: [{ name: 'zoom', x: 380, y: 320, w: 240, h: 170 }] },
  { name: 'raise', query: 'x=32&y=2&tier=1&crew=rest&motion=1', action: 'raise', after: 850 },
  { name: 'seal', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [30, -12] }, rifts: [['neon', 'open', 5, -2]], wait: 600, action: 'seal', after: 780, crops: [{ name: 'zoom', x: 600, y: 230, w: 300, h: 240 }] },
  { name: 'letgo', query: 'x=32&y=2&crew=rest&motion=1', travel: { tile: [30, -12] }, rifts: [['gothic', 'open', 5, -2]], wait: 600, action: 'let-go', after: 1250 },
  { name: 'lantern-lit', query: 'x=32&y=2&crew=rest&motion=1', travel: { lantern: 0, lit: true }, wait: 600 },
];

const only = process.argv.slice(2);
const scenes = only.length ? SCENES.filter((s) => only.includes(s.name)) : SCENES;
const doPerf = !only.length || only.includes('perf');
const userData = await mkdtemp(path.join(tmpdir(), 'milo-wilds-preview-'));
const env = { ...process.env, MILO_PREVIEW_USER_DATA: userData, MILO_PREVIEW_SIZE: '1000x700' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await _electron.launch({
  executablePath: electronPath,
  args: [path.join(repo, 'scripts', 'world-preview-main.cjs'), `--user-data-dir=${userData}`],
  cwd: repo,
  env,
  timeout: 30000,
});
const report = { errors: [], shots: [], notes: [] };
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  const external = [];
  page.on('request', (request) => { if (!request.url().startsWith('file://')) external.push(request.url()); });
  await page.addInitScript((c) => { window.__content = c; }, content);

  const resize = (w, h) => app.evaluate(({ BrowserWindow }, [width, height]) => {
    BrowserWindow.getAllWindows()[0].setContentSize(width, height);
  }, [w, h]);

  for (const scene of scenes) {
    const [w, h] = scene.size || [1000, 700];
    await resize(w, h);
    await page.goto(`${previewUrl}?${scene.query}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
    await page.evaluate(() => window.__world.resize());
    if (/elsewhere=/.test(scene.query)) await page.waitForFunction(() => window.__inside, null, { timeout: 20000 }).then(() => page.evaluate(() => window.__inside));
    const note = await page.evaluate(async (s) => {
      const world = window.__world;
      const demo = window.__demo;
      const out = {};
      if (s.travel) {
        const { travel } = s;
        let tile = null;
        if (travel.tile) tile = { x: travel.tile[0], y: travel.tile[1] };
        const W = world;
        if (travel.anchor || travel.standing || travel.lantern !== undefined) {
          const { createWorldgen } = await import('../src/world/worldgen.js');
          const gen = createWorldgen({ seed: 'hushlands', regionWords: window.__content.riftgen.regionWords });
          if (travel.anchor) {
            const a = gen.anchors.find((it) => it.id === travel.anchor);
            tile = { x: a.x + (travel.dx || 0), y: a.y + (travel.dy || 0) };
          }
          if (travel.standing) {
            const b = gen.standingBleeds().find((it) => it.place === travel.standing);
            tile = { x: b.x + (travel.dx || 0), y: b.y + (travel.dy || 0) };
          }
          if (travel.lantern !== undefined) {
            const { createWilds } = await import('../src/world/wilds.js');
            const lanterns = createWilds({ worldgen: gen }).fixedPois().filter((p) => p.type === 'lantern');
            const lantern = lanterns[travel.lantern];
            out.lantern = lantern.id;
            if (travel.lit) W.setWildState({ lit: [lantern.id] });
            tile = { x: lantern.x, y: lantern.y + 1 };
          }
        }
        out.travelled = await W.travelTo(tile);
      }
      const at = world.miloTile();
      out.at = at;
      if (s.rifts) {
        const list = s.rifts.map(([g, stage, dx, dy, flag], i) => demo.demoRift(`${g}:${stage}:${at.x + dx},${at.y + dy}${flag ? `:${flag}` : ''}`, i)).filter(Boolean);
        world.setRifts(list);
        window.__lastRifts = list;
        out.rifts = list.map((r) => `${r.spec.name} (${r.spec.genres.join('+')}, ${r.spec.stage}) at ${r.x},${r.y}`);
      }
      out.settled = world.settle();
      if (s.toward) {
        // Anything in the scene by kind (not just what's in view): Elsewhere ids are the kinds.
        const id = s.toward === 'loot' ? 'loot:0' : s.toward;
        out.toward = await world.walkToEntity(id);
        if (s.motionAfter) window.__setMotion(true);
      }
      if (s.chop) {
        const tree = world.nearbyEntities().find((e) => e.kind === 'tree' && (typeof s.chop !== 'string' || e.id === s.chop));
        out.tree = tree && tree.id;
        if (tree) {
          window.__chop = world.chop(tree.id);
        }
      }
      out.area = world.area();
      out.stats = world.stats();
      return out;
    }, scene);
    if (scene.chop) {
      // Wait for the walk, then for a blow landing (the strike frame of a swing).
      await page.waitForFunction(() => {
        const age = window.__world.stats().chopAge;
        return age !== null && age > 700 && age % 625 > 450 && age % 625 < 520;
      }, null, { timeout: 15000, polling: 5 });
    } else {
      await page.waitForTimeout(scene.wait || 350);
    }
    if (scene.action) {
      // Something that plays out: take the picture part way through.
      await page.evaluate((action) => {
        const world = window.__world;
        const rift = (window.__lastRifts || [])[0];
        if (action === 'raise') {
          world.setWildState({ tier: 2, wardRadius: 12 });
          world.raiseReveal(2);
        } else if (rift) world.closeRift(rift.id, action === 'seal' ? 'sealed' : 'let-go');
      }, scene.action);
      await page.waitForTimeout(scene.after || 500);
    }
    const file = path.join(results, `wilds-${scene.name}.png`);
    await page.screenshot({ path: file });
    report.shots.push(file);
    const crops = [...(scene.crops || [])];
    if (scene.miloCrop) {
      // A close look at Milo himself: his head's screen position, and a box round his sprite.
      const head = await page.evaluate(() => window.__world.miloScreenPos());
      const [vw, vh] = scene.size || [1000, 700];
      const w = 140;
      const h = 130;
      crops.push({ name: 'milo', x: Math.max(0, Math.min(vw - w, Math.round(head.x - w / 2))), y: Math.max(0, Math.min(vh - h, Math.round(head.y - 45))), w, h });
    }
    for (const crop of crops) {
      const cropFile = path.join(results, `wilds-${scene.name}-${crop.name}.png`);
      await page.screenshot({ path: cropFile, clip: { x: crop.x, y: crop.y, width: crop.w, height: crop.h } });
      report.shots.push(cropFile);
    }
    report.notes.push({ scene: scene.name, ...note });
    console.log(scene.name, JSON.stringify(note));
  }

  if (doPerf) {
    // §10: a frame in the wilds at 1280 × 820 with three rifts in view, drawn in 12 ms or less.
    await resize(1280, 820);
    await page.goto(`${previewUrl}?x=32&y=2&crew=rest&motion=1`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
    await page.evaluate(() => window.__world.resize());
    const perf = await page.evaluate(async () => {
      const world = window.__world;
      await world.travelTo({ x: 34, y: -22 });
      const at = world.miloTile();
      const list = [['neon', 'open', -6, -3], ['iron+neon', 'gaping', 5, 1], ['nocturne', 'open', -3, 4]]
        .map(([g, s, dx, dy], i) => window.__demo.demoRift(`${g}:${s}:${at.x + dx},${at.y + dy}`, i)).filter(Boolean);
      world.setRifts(list);
      world.settle();
      await new Promise((r) => setTimeout(r, 400));
      world.benchmark(30); // warm
      const plain = world.benchmark(180);
      const flushed = world.benchmark(60, { flush: true });
      // And the real loop: frame-to-frame times while it runs by itself.
      const gaps = [];
      let last = performance.now();
      await new Promise((resolve) => {
        let n = 0;
        const step = () => {
          const t = performance.now();
          gaps.push(t - last);
          last = t;
          n += 1;
          if (n < 90) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      return { at, rifts: list.map((r) => `${r.spec.genres.join('+')} ${r.spec.stage} at ${r.x},${r.y}`), plain, flushed, stats: world.stats(), rafGapMedian: gaps.sort((a, b) => a - b)[45] };
    });
    await page.screenshot({ path: path.join(results, 'wilds-perf.png') });
    console.log('perf', JSON.stringify(perf));
    await writeFile(path.join(results, 'wilds-perf.json'), JSON.stringify(perf, null, 2));
    report.perf = perf;
  }
  report.external = external;
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
if (report.errors.length) console.error('Errors:', report.errors);
if (report.external && report.external.length) console.error('Requests left the PC:', report.external);
console.log(`Saved ${report.shots.length} shots to ${results}`);
