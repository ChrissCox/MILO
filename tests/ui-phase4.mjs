// End-to-end checks of Phase 4's wiring in real Electron, against synthetic data only:
// the HUD and panels, the Riddle Note trail to the Tollkeeper, a cave, and a follower.
//
//   node tests/ui-phase4.mjs

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUiKit, makeRoot } from './ui-helpers.mjs';
import { createWorldgen } from '../src/world/worldgen.js';
import { lastBridge } from '../src/world/trail.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(repo, 'test-results');
await mkdir(artifacts, { recursive: true });

const bridge = lastBridge(createWorldgen({ seed: 'hushlands' }));
assert.ok(bridge, 'the Last Bridge has a place in the default world');
const CAVE = { id: 'poi:cave:82,13', x: 82, y: 13 }; // the nearest cave to the north gate in the default world

let completed = 0;
const kits = [];

// One app on its own synthetic data, with `edit(state)` applied to the first save before launch.
async function launchWith(name, edit = () => {}, extraEnv = {}) {
  const { environment, data } = await makeRoot(`milo-ui4-${name}-`);
  const kit = createUiKit({ repo, environment });
  kits.push(kit);
  await kit.launch();
  await kit.window.waitForTimeout(1500);
  await kit.close();
  const file = path.join(data, 'state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.embers = { balance: 100, lifetime: 100 };
  saved.tally = { ...saved.tally, sessionsFinished: 5, daysSeen: 3 };
  saved.settings = { ...saved.settings, greeting: false, motion: false };
  edit(saved);
  await writeFile(file, JSON.stringify(saved, null, 2));
  await kit.launch(repo, extraEnv);
  await kit.dismissBubbles();
  return kit;
}

// The keys that walk Milo from `from` to beside `target`, from the wilds' own modules.
const stepsTo = (page, from, target, nearby) => page.evaluate(async ({ from, target, nearby }) => {
  const content = await window.milo.content();
  const state = await window.milo.loadState();
  const { createWorldgen } = await import('./src/world/worldgen.js');
  const { createWilds } = await import('./src/world/wilds.js');
  const { createNav } = await import('./src/world/nav.js');
  const worldgen = createWorldgen({ seed: state.wilds.seed, regionWords: content.riftgen.regionWords });
  const wilds = createWilds({ worldgen, maxChunks: 96 });
  const nav = createNav({ worldgen, wildBlocked: (x, y) => wilds.blocked(x, y), extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
  for (const [dx, dy] of nearby) {
    const path = nav.findPath(from, { x: target.x + dx, y: target.y + dy });
    if (path.length) return path;
  }
  return [];
}, { from, target, nearby });

async function outTheNorthGate(kit) {
  await kit.openPlacesList();
  await kit.window.locator('#place-list [data-entity="gate:n"]').click();
  return kit.standingAt();
}

async function walk(kit, from, steps) {
  await kit.dismissBubbles(1500);
  await kit.window.locator('canvas#world').focus();
  const end = await kit.stepKeys(from, steps);
  await kit.window.waitForTimeout(1200);
  return end;
}

const bubbleText = async (page) => ((await page.locator('#bubble').isVisible()) ? (await page.locator('#bubble').textContent()).replace(/\s+/g, ' ') : '');
const savedTrail = async (page) => (await page.evaluate(() => window.milo.loadState())).story?.trails?.['first-trail'] || null;

async function check(name, run) {
  await run();
  completed += 1;
  console.log(`PASS ${name}`);
}

async function noErrors(kit, label) {
  assert.deepEqual(kit.pageErrors, [], `${label}: renderer errors`);
  assert.deepEqual(kit.consoleErrors, [], `${label}: console errors`);
  assert.deepEqual(kit.miloWarnings, [], `${label}: shell fallbacks were used`);
}

try {
  // ---- The HUD and panels -------------------------------------------------------------------
  {
    const kit = await launchWith('hud');
    const page = kit.window;
    await check('the wallet, the Kindle orb, the HUD and the Log are there', async () => {
      assert.match((await page.locator('#wallet').textContent()).trim(), /100/);
      assert.equal(await page.locator('#kindle-orb').isVisible(), true);
      assert.equal(await page.locator('#hud').isVisible(), true);
      assert.equal(await page.locator('#log').isVisible(), true);
    });
    await check('Chronicle, Skills, Satchel, Company and Quests open from the HUD', async () => {
      for (const label of ['Chronicle', 'Skills', 'Satchel', 'Company', 'Quests']) {
        await page.locator('#hud button', { hasText: new RegExp(`^${label}$`) }).click();
        await kit.poll(async () => (await page.locator('#panel').isVisible()) && (await page.locator('#panel-title').textContent()).trim().length > 0, `the ${label} panel`);
        await page.keyboard.press('Escape');
        await kit.poll(async () => !(await page.locator('#panel').isVisible()), `the ${label} panel to close`);
      }
    });
    await check('the Board takes a quest, sorts it, and finishing it pays 3 Embers once', async () => {
      await page.locator('#hud button', { hasText: /^Quests$/ }).click();
      const input = page.locator('#panel .board-add input');
      await input.waitFor({ timeout: 10_000 });
      await input.fill('Order groceries');
      await input.press('Enter');
      const row = page.locator('#panel .quest', { hasText: 'Order groceries' });
      await row.waitFor({ timeout: 10_000 });
      assert.equal(await row.getAttribute('data-kind'), 'main');
      await row.locator('[data-action="board-done"]').click();
      const lifetime = async () => (await page.evaluate(() => window.milo.loadState())).embers?.lifetime;
      await kit.poll(async () => (await lifetime()) === 103, 'the lifetime count to read 103');
      assert.match(await page.locator('#panel .board-says').textContent(), /\+3 Embers/);
      await row.locator('[data-action="board-reopen"]').click();
      await row.locator('[data-action="board-done"]').click();
      await page.waitForTimeout(400);
      assert.equal(await lifetime(), 103, 'finishing it again pays nothing');
      await kit.poll(async () => (await page.evaluate(() => window.milo.loadState())).board?.quests?.[0]?.paid === true, 'the quest to be saved as paid');
      await page.keyboard.press('Escape');
    });
    await noErrors(kit, 'hud');
    await kit.close();
  }

  // ---- The trail: a note from a chest ---------------------------------------------------------
  {
    const kit = await launchWith('chest', (s) => {
      s.story = { ...(s.story || {}), prologue: { ...(s.story?.prologue || {}), done: { ...(s.story?.prologue?.done || {}), 'first-crack': Date.now() - 600_000 } } };
    });
    const page = kit.window;
    const at = await outTheNorthGate(kit);
    const steps = await stepsTo(page, at, bridge.stand, [[0, 2], [1, 2], [-1, 2], [0, 1]]);
    assert.ok(steps.length > 10, 'a walk to the Last Bridge');
    await walk(kit, at, steps);
    await check('the first wild chest after the crack holds Tamsin’s first Riddle Note', async () => {
      await kit.dismissBubbles(1500);
      await kit.openPlacesList();
      await page.locator('#place-list [data-entity="poi:chest:1,-26"]').click();
      await page.locator('#panel [data-action="poi-open"]').waitFor({ timeout: 20_000 });
      await page.locator('#panel [data-action="poi-open"]').click();
      await kit.poll(async () => /A Riddle Note/.test(await bubbleText(page)), 'the Riddle Note bubble');
      await kit.poll(async () => (await savedTrail(page))?.found?.['first-trail-1'], 'the note to be saved as found');
    });
    await noErrors(kit, 'chest');
    await kit.close();
  }

  // ---- The trail: the gate, the bridge and the Tollkeeper --------------------------------------
  {
    const kit = await launchWith('visit', (s) => {
      const t0 = Date.now() - 600_000;
      const ids = ['first-trail-1', 'first-trail-2', 'first-trail-3', 'first-trail-4'];
      s.story = { ...(s.story || {}), prologue: { ...(s.story?.prologue || {}), done: { 'first-crack': t0 } }, trails: { 'first-trail': { found: Object.fromEntries(ids.map((id) => [id, t0])), done: Object.fromEntries(ids.slice(0, 3).map((id) => [id, t0])), joinedAt: null } } };
    });
    const page = kit.window;
    let at;
    await check('walking out of the north gate solves the gate riddle and hands over the bridge note', async () => {
      at = await outTheNorthGate(kit);
      await kit.poll(async () => (await savedTrail(page))?.done?.['first-trail-4'], 'the gate step to be done');
      await kit.poll(async () => (await savedTrail(page))?.found?.['first-trail-5'], 'the bridge note to be found');
    });
    await check('reaching the Last Bridge finishes the trail, and the Tollkeeper asks his riddles', async () => {
      const steps = await stepsTo(page, at, bridge.stand, [[0, 2], [1, 2], [-1, 2], [0, 1]]);
      await walk(kit, at, steps);
      // A few key presses can be dropped on a long walk, so the Places list finishes the approach.
      await kit.dismissBubbles(1500);
      await kit.openPlacesList();
      await page.locator('#place-list [data-entity="landmark:tollkeeper"]').click();
      await kit.poll(async () => (await savedTrail(page))?.done?.['first-trail-5'], 'the bridge step to be done');
      await kit.dismissBubbles(2500);
      await kit.openPlacesList();
      await page.locator('#place-list [data-entity="landmark:tollkeeper"]').click();
      await kit.poll(async () => /Talking with the Tollkeeper/.test(await page.locator('#panel').textContent()), 'the Tollkeeper’s riddles');
    });
    await noErrors(kit, 'visit');
    await kit.close();
  }

  // ---- A cave ---------------------------------------------------------------------------------------
  {
    const kit = await launchWith('cave');
    const page = kit.window;
    const at = await outTheNorthGate(kit);
    const steps = await stepsTo(page, at, CAVE, [[0, 1], [-1, 0], [1, 0], [0, -1]]);
    assert.ok(steps.length > 10, 'a walk to the cave');
    await walk(kit, at, steps.slice(0, -1));
    await check('a cave’s mouth offers Go in for 3 Embers, and going in spends them', async () => {
      await kit.openPlacesList();
      await page.locator(`#place-list [data-entity="${CAVE.id}"]`).click();
      const button = page.locator('#panel [data-action="poi-enter-cave"]');
      await button.waitFor({ timeout: 20_000 });
      assert.match((await button.textContent()).trim(), /Go in · 3 Embers/);
      await button.click();
      await kit.poll(async () => (await kit.area()) === 'elsewhere', 'Milo to be inside the cave', 30_000);
      await kit.poll(async () => /97/.test(await page.locator('#wallet').textContent()), 'the wallet to read 97');
      await kit.poll(async () => {
        const expedition = (await page.evaluate(() => window.milo.loadState())).expedition;
        return expedition?.kind === 'cave' && expedition?.inside === true;
      }, 'the cave to be saved as where Milo is');
    });
    await noErrors(kit, 'cave');
    await kit.close();
  }

  // ---- A follower --------------------------------------------------------------------------------------
  {
    const kit = await launchWith('follower', (s) => {
      s.party = { ...(s.party || {}), roster: { ...(s.party?.roster || {}), tollkeeper: { ...(s.party?.roster?.tollkeeper || {}), level: 2 } }, chosen: ['tollkeeper'] };
    });
    const page = kit.window;
    await check('the chosen companion follows Milo out of the vale', async () => {
      const at = await outTheNorthGate(kit);
      await walk(kit, at, [1, 2, 3, 4].map((i) => ({ x: at.x, y: at.y - i })));
      await page.screenshot({ path: path.join(artifacts, 'phase4-follower.png') });
      // The walk is saved only for Milo; followers' steps reach the shell as scene steps with their own id.
      assert.equal(await kit.area(), 'wilds');
    });
    await noErrors(kit, 'follower');
    await kit.close();
  }

  console.log(`\n${completed} Phase 4 checks passed. No renderer errors.`);
} catch (error) {
  console.error(`\nFAILED after ${completed} checks: ${error.stack || error}`);
  process.exitCode = 1;
} finally {
  for (const kit of kits) await kit.close().catch(() => {});
}
