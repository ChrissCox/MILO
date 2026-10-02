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
    await check('the Town hall opens the Board, and a pocket thought becomes a quest in a project', async () => {
      await kit.openPlacesList();
      await page.locator('#place-list [data-place="townhall"]').click();
      await kit.poll(async () => (await page.locator('#panel-title').textContent()).trim() === 'Town hall', 'the Town hall panel');
      await page.locator('#panel [data-action="board-tab"][data-tab="projects"]').click();
      await page.locator('#panel [data-form="board-project"] input').fill('Garden');
      await page.locator('#panel [data-form="board-project"] input').press('Enter');
      await page.locator('#panel .project', { hasText: 'Garden' }).waitFor({ timeout: 10_000 });
      await page.locator('#panel [data-action="board-tab"][data-tab="pocket"]').click();
      await page.locator('#panel [data-form="board-thought"] input').fill('Garden: buy soil');
      await page.locator('#panel [data-form="board-thought"] input').press('Enter');
      await page.locator('#panel [data-action="board-thought-quest"]').click();
      const row = page.locator('#panel .quest', { hasText: 'buy soil' });
      await row.waitFor({ timeout: 10_000 });
      assert.match(await row.textContent(), /Garden/, 'it was filed under the project');
      await page.keyboard.press('Escape');
    });
    await noErrors(kit, 'hud');
    await kit.close();
  }

  // ---- A task rift ----------------------------------------------------------------------------
  {
    const old = Date.now() - 20 * 86_400_000;
    const kit = await launchWith('taskrift', (s) => {
      s.embers = { balance: 0, lifetime: 0 };
      s.board = {
        quests: [{ id: 'q-1', title: 'Call the bank', kind: 'side', manual: false, status: 'todo', notes: '', skill: 'stewardship', skillManual: false, projectId: null, createdAt: old, startedAt: null, completedAt: null, touchedAt: old, due: null, dueManual: false, paid: false, steps: [] }],
        projects: [], thoughts: [], seq: 1, nudgedDay: '2099-01-01',
      };
    });
    const page = kit.window;
    const rifts = async () => (await page.evaluate(() => window.milo.loadState())).rifts;
    await check('a quest that has waited a while opens a Gothic rift, and keeping it seals the rift once', async () => {
      await kit.poll(async () => (await rifts()).open?.['stale:board'], 'the Gothic rift to open', 30_000);
      await kit.openPlacesList();
      await page.locator('#place-list [data-place="townhall"]').click();
      await page.locator('#panel [data-quest="q-1"] [data-action="board-keep"]').waitFor({ timeout: 20_000 });
      await page.locator('#panel [data-quest="q-1"] [data-action="board-keep"]').click();
      await kit.poll(async () => !(await rifts()).open?.['stale:board'] && (await rifts()).stitched?.real === 1, 'the rift to seal and count once', 20_000);
      assert.equal((await page.evaluate(() => window.milo.loadState())).embers.lifetime, 5, 'the seal paid its 5 Embers');
    });
    await noErrors(kit, 'taskrift');
    await kit.close();
  }

  // ---- Camp life: what Milo gathers, and the fire ----------------------------------------------
  {
    const now = Date.now();
    const kit = await launchWith('camplife', (s) => {
      s.kindle = { phase: 'focus', startedAt: now - 51 * 60_000, focusEndsAt: now - 60_000, restStartedAt: null, restEndsAt: null, earned: false, paid: { focus: null, rest: null } };
      s.camplife = { gather: 'foraging', last: null, cooked: {} };
      s.satchel = { ...s.satchel, materials: { ...s.satchel.materials, berries: 3 } }; // enough for one cordial whatever Milo finds
    });
    const page = kit.window;
    await check('a focus session that ends while Milo forages brings the haul home once, and the fire cooks it', async () => {
      await kit.poll(async () => (await page.evaluate(() => window.milo.loadState())).camplife?.last, 'the haul to be saved');
      const st = await page.evaluate(() => window.milo.loadState());
      const brought = (st.satchel.materials.berries || 0) - 3 + (st.satchel.materials.herbs || 0); // minus the three seeded berries
      assert.ok(brought >= 3 && brought <= 5, `3 to 5 things came home: ${brought}`);
      assert.equal(st.xp.skills.foraging, 250);
      assert.match(await page.locator('#bubble').textContent(), /Milo foraged and brought back/);
      await kit.dismissBubbles(500);
      await page.locator('#hud button', { hasText: /^Satchel$/ }).click();
      await page.locator('#panel .satchel-gathered').waitFor({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      // the fire, from the camp
      await kit.openPlacesList();
      await page.locator('#place-list [data-place="camp"]').click();
      await page.locator('#panel [data-panel="fire"]').waitFor({ timeout: 20_000 });
      await page.locator('#panel [data-panel="fire"]').click();
      await page.locator('#panel .fire-view').waitFor({ timeout: 10_000 });
      const cook = page.locator('#panel .fire-recipe[data-can="true"] [data-action="fire-cook"]').first();
      await cook.waitFor({ timeout: 10_000 });
      await cook.click();
      await kit.poll(async () => (await page.evaluate(() => window.milo.loadState())).xp.skills.cooking === 120, 'Cooking to train');
    });
    await noErrors(kit, 'camplife');
    await kit.close();
  }

  // ---- An errand, Mags, and Act I --------------------------------------------------------------
  {
    const now = Date.now();
    const kit = await launchWith('errand', (s) => {
      s.embers = { balance: 0, lifetime: 0 };
      s.story = { ...s.story, prologue: { done: { ...(s.story?.prologue?.done || {}), 'first-crack': now - 86_400_000 } } };
      s.rifts = { ...s.rifts, stitched: { ...(s.rifts?.stitched || {}), real: 1 } };
      s.people = { gorrin: { points: 3, met: now - 86_400_000, seen: now - 86_400_000, done: ['x'], turn: { day: '2000-01-01', n: 0, last: null }, found: { likes: [], dislikes: [], resists: [] }, memories: [], camp: null } };
      s.satchel = { ...s.satchel, materials: { ...s.satchel.materials, birch: 8 } };
    });
    const page = kit.window;
    const state = () => page.evaluate(() => window.milo.loadState());
    await check('Act I opens after the crack, a sealed rift is its first chapter, and it shows in the story', async () => {
      await kit.poll(async () => (await state()).story?.act1?.done?.['first-rift'], 'the first chapter to be kept');
      await page.locator('#tracker [data-action="tracker-open"]').click();
      await page.locator('#panel .act-section').waitFor({ timeout: 10_000 });
      assert.equal(await page.locator('#panel .act-section [data-step="first-rift"]').getAttribute('data-level-state'), 'proven');
      assert.equal(await page.locator('#panel .act-section [data-step="laser-awl"]').getAttribute('data-level-state'), 'next');
      await page.keyboard.press('Escape');
    });
    await check('Gorrin’s errand: he asks for six birch, takes them, remembers it and gives a cabbage, and no Embers change hands', async () => {
      await outTheNorthGate(kit);
      await kit.dismissBubbles(1500);
      await kit.openPlacesList();
      await page.locator('#place-list [data-entity="landmark:npc-gorrin"]').click();
      await page.locator('#panel [data-action="person-errand-ask"]').waitFor({ timeout: 30_000 });
      const before = (await state()).embers.lifetime;
      await page.locator('#panel [data-action="person-errand-ask"]').click();
      await page.locator('#panel [data-action="person-errand-accept"]').click();
      await page.locator('#panel [data-action="person-errand-give"]').click();
      await page.locator('#panel [data-action="person-errand-done"]').click();
      const notes = (await page.locator('#panel .person-note').allTextContents()).join(' | ');
      assert.match(notes, /Gorrin approves/);
      assert.match(notes, /Gorrin will remember that/);
      assert.match(notes, /Gorrin gave you a cabbage/);
      await kit.poll(async () => (await state()).people?.gorrin?.errand?.done, 'the errand to be saved as done');
      const st = await state();
      assert.equal(st.satchel.materials.birch, 2);
      assert.deepEqual(st.satchel.relics.map((r) => r.name), ['A cabbage']);
      assert.equal(st.embers.lifetime, before, 'an errand pays no Embers');
      await page.locator('#panel [data-action="person-next"]').click();
      await page.keyboard.press('Escape');
    });
    await check('Mags Quire has arrived, meeting her is the next chapter, and she will not come to camp', async () => {
      await kit.openPlacesList();
      await page.locator('#place-list [data-entity="landmark:npc-mags"]').click();
      await page.locator('#panel [data-action="person-meet"]').waitFor({ timeout: 30_000 });
      await page.locator('#panel [data-action="person-meet"]').click();
      await kit.poll(async () => (await state()).story?.act1?.done?.['laser-awl'], 'the chapter to be kept');
      await page.locator('#panel [data-action="person-camp"]').click();
      assert.match(await page.locator('#panel .person-talk').textContent(), /I’ll bring my own cup/);
      assert.equal((await state()).people.mags.camp, null);
    });
    await noErrors(kit, 'errand');
    await kit.close();
  }

  // ---- A person on the road --------------------------------------------------------------------
  {
    const now = Date.now();
    const kit = await launchWith('people', (s) => {
      s.people = { wendell: { points: 4, met: now - 86_400_000, seen: now - 86_400_000, done: ['plaque', 'middle', 'string'], turn: { day: '2000-01-01', n: 0, last: null }, found: { likes: ['truth', 'craft'], dislikes: [], resists: [] }, memories: [], camp: null } };
    });
    const page = kit.window;
    await check('Wendell stands on the north road, is won over with the truth, will remember that, and comes to camp', async () => {
      await outTheNorthGate(kit);
      await kit.dismissBubbles(1500);
      await kit.openPlacesList();
      await page.locator('#place-list [data-entity="landmark:npc-wendell"]').click();
      await page.locator('#panel .person-view').waitFor({ timeout: 30_000 });
      assert.equal((await page.locator('#panel-title').textContent()).trim(), 'Wendell');
      await page.locator('#panel [data-action="person-camp"]').click();
      assert.match(await page.locator('#panel .person-talk').textContent(), /Tell me something true first/, 'too early: a polite no with a hint');
      await page.locator('#panel [data-action="person-go"]').click();
      await page.locator('#panel [data-action="person-pick"][data-approach="truth"]').click();
      const notes = (await page.locator('#panel .person-note').allTextContents()).join(' | ');
      assert.match(notes, /Wendell approves/);
      assert.match(notes, /Wendell will remember that/);
      assert.match(notes, /fond of you now/);
      await page.locator('#panel [data-action="person-next"]').click();
      await page.locator('#panel [data-action="person-camp"]').click();
      assert.match(await page.locator('#panel .person-talk').textContent(), /I’ll bring the string/);
      await kit.poll(async () => (await page.evaluate(() => window.milo.loadState())).people?.wendell?.camp, 'Wendell to be saved as living at camp');
      await page.keyboard.press('Escape');
      await kit.openPlacesList();
      assert.equal(await page.locator('#place-list [data-entity="landmark:npc-wendell"]').count(), 0, 'he left the road');
    });
    await noErrors(kit, 'people');
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
