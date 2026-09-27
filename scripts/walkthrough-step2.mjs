// A screenshot walkthrough of step 2 in real Electron: open an empty plot, ask for ideas, build
// one, watch the building site and the reveal, open the built panel, rename, redesign, clear.
// Runs against synthetic homes, synthetic skills and projects, and the architect's canned crew
// (MILO_ARCHITECT=fake), in a temporary data folder that is removed afterwards.
//
//   node scripts/walkthrough-step2.mjs      -> test-results/step2-*.png

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import electronPath from 'electron';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'test-results');
const fixtures = path.join(repo, 'tests', 'fixtures');
const root = await mkdtemp(path.join(tmpdir(), 'milo-walk-'));
const dataDirectory = path.join(root, 'data');
const claudeHome = path.join(root, 'claude-home');
const codexHome = path.join(root, 'codex-home');
const projectsDir = path.join(root, 'projects');
await mkdir(out, { recursive: true });
await mkdir(dataDirectory, { recursive: true });
for (const [name, target] of [['claude-home', claudeHome], ['codex-home', codexHome]]) {
  const source = path.join(fixtures, name);
  if (existsSync(source)) await cp(source, target, { recursive: true });
  else await mkdir(target, { recursive: true });
}
// Made-up skills and projects for Milo's own ideas.
const SKILLS = {
  'video-expert': 'Become an expert in a field from videos and research, then write an expertise pack.',
  'expert-pf2e-encounter-design': 'Pathfinder 2e encounter design and difficulty tuning for game nights.',
  jev: 'Sort, triage, label or rank any pile of text with a quick decision model.',
};
for (const [name, description] of Object.entries(SKILLS)) {
  await mkdir(path.join(claudeHome, 'skills', name), { recursive: true });
  await writeFile(path.join(claudeHome, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`, 'utf8');
}
for (const name of ['Habitack', 'MILO', 'Sketchbook']) await mkdir(path.join(projectsDir, name), { recursive: true });

const env = {
  ...process.env,
  MILO_TEST: '1',
  MILO_DATA_DIR: dataDirectory,
  MILO_CLAUDE_HOME: claudeHome,
  MILO_CODEX_HOME: codexHome,
  MILO_PROJECTS_DIR: projectsDir,
  MILO_ARCHITECT: 'fake',
  // Long enough to watch the building site go up through its stages at the crew's pace
  // (about 11 s a stage, like a real Claude Code or Codex design).
  MILO_FAKE_DELAY_MS: process.env.WALK_DELAY_MS || '36000',
};
delete env.ELECTRON_RUN_AS_NODE;

const errors = [];
const requests = [];
let application;
let page;
let shot = 0;

async function snap(name, note) {
  shot += 1;
  const where = PLOT === 'plot-rise' ? '' : `${PLOT.replace('plot-', '')}-`;
  const file = path.join(out, `step2-${where}${String(shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${path.basename(file)}${note ? `  ${note}` : ''}`);
}

async function poll(check, what, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

async function dismissBubbles(timeout = 6000) {
  const deadline = Date.now() + timeout;
  let quietSince = null;
  while (Date.now() < deadline) {
    if (await page.locator('#bubble').isVisible()) {
      quietSince = null;
      const buttons = page.locator('#bubble [data-bubble-action]');
      const count = await buttons.count();
      if (count) await buttons.nth(count - 1).click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(150);
    } else {
      quietSince ??= Date.now();
      if (Date.now() - quietSince > 900) return;
      await page.waitForTimeout(100);
    }
  }
}

const panelBody = () => page.locator('#panel-body');
const plotView = (id, status) => page.locator(`#panel .plot-view[data-plot="${id}"]${status ? `[data-plot-status="${status}"]` : ''}`);
const PLOT = process.env.WALK_PLOT || 'plot-rise';

try {
  application = await _electron.launch({ executablePath: electronPath, args: [repo], cwd: repo, env, timeout: 30_000 });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    if (message.type() === 'warning' && message.text().startsWith('[MILO]')) errors.push(`warning: ${message.text()}`);
  });
  page.on('request', request => requests.push(request.url()));
  page.setDefaultTimeout(15_000);
  await page.locator('body[data-ready="true"]').waitFor({ timeout: 40_000 });
  await page.waitForTimeout(1500);
  await snap('launch', 'the world on launch, Milo greets');
  await dismissBubbles();

  // 1. Open an empty plot from the place list (Milo walks there).
  await page.locator('#places-toggle').click();
  await page.locator(`#place-list [data-place="${PLOT}"]`).click();
  await plotView(PLOT, 'empty').waitFor();
  await poll(async () => (await page.locator('#panel .idea').count()) === 3, 'three ideas');
  await page.waitForTimeout(4500); // Milo's walk
  await snap('empty-plot', 'an empty plot with three ideas');
  const firstIdeas = await page.locator('#panel .idea-title').allTextContents();
  console.log('  ideas:', firstIdeas.join(' | '));
  await panelBody().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  await snap('empty-plot-ask', 'the ask box and what Milo shares');

  // 2. Ask for ideas.
  await page.locator('#panel input[data-field="ask"]').fill('something for my drawing streams');
  await page.locator('#panel input[data-field="ask"]').press('Enter');
  await page.locator('#panel .progress').waitFor();
  await page.waitForTimeout(150);
  await snap('asking', 'asking the crew');
  await poll(async () => (await page.locator('#panel .progress').count()) === 0, 'the ideas to come back');
  await page.waitForTimeout(300);
  await panelBody().evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(150);
  const newIdeas = await page.locator('#panel .idea-title').allTextContents();
  console.log('  new ideas:', newIdeas.join(' | '));
  assert.equal(newIdeas.length, 3);
  assert.ok(newIdeas.every(title => !firstIdeas.includes(title)), 'asking brings fresh ideas');
  await snap('new-ideas', 'three fresh ideas');

  // 3. Build one and watch the building site.
  const chosen = newIdeas[0];
  await page.locator('#panel [data-action="build"]').first().click();
  await plotView(PLOT, 'designing').waitFor();
  await page.waitForTimeout(400);
  await snap('site-start', 'the building site goes up');
  await page.waitForTimeout(11_000);
  await snap('site-frame', 'the frame');
  await page.waitForTimeout(11_000);
  await snap('site-scaffold', 'the scaffold, crew at work');
  await page.evaluate(() => document.querySelector('#panel [data-action="close-panel"]')?.click());
  await page.waitForTimeout(900);
  await snap('site-world', 'the building site in the world, panel closed');

  // 4. The reveal.
  await poll(async () => (await page.locator('#bubble[data-kind="built"]').count()) > 0, 'the built announcement', 45_000);
  await page.waitForTimeout(350);
  await snap('reveal', 'the scaffold dissolves');
  await page.waitForTimeout(900);
  await snap('reveal-late', 'leaves drift, Milo announces it');
  await page.waitForTimeout(2000);
  const saidTitle = await page.locator('#bubble .bubble-title, #bubble h3, #bubble strong').first().textContent().catch(() => '');
  console.log('  announced:', saidTitle);
  await snap('built-world', 'the new building in the world');

  // 5. Open the built panel (Show me in the bubble).
  const show = page.locator('#bubble [data-bubble-action="show"]');
  if (await show.count()) await show.click();
  else {
    await page.locator('#places-toggle').click();
    await page.locator(`#place-list [data-place="${PLOT}"]`).click();
  }
  await plotView(PLOT, 'built').waitFor();
  await page.waitForTimeout(700);
  const builtName = (await page.locator('#panel-title').textContent()).trim();
  console.log('  built:', builtName, '(idea was', chosen + ')');
  await snap('built-panel', 'the building panel');
  await page.locator('#panel .level-tree').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await snap('built-levels', 'five planned levels with proofs');
  assert.equal(await page.locator('#panel .plan-level[data-level-state="planned"]').count(), 5);
  await dismissBubbles(3000);

  // 6. Rename.
  await panelBody().evaluate(el => { el.scrollTop = 0; });
  await page.locator('#panel [data-action="rename"]').click();
  await page.locator('#panel input[data-field="rename"]').waitFor();
  await page.locator('#panel input[data-field="rename"]').fill('Stream corner');
  await snap('rename-form', 'renaming');
  await page.locator('#panel input[data-field="rename"]').press('Enter');
  await poll(async () => (await page.locator('#panel-title').textContent()).trim() === 'Stream corner', 'the new name');
  await page.waitForTimeout(300);
  await snap('renamed', 'renamed');

  // 7. Redesign with a tweak.
  await page.locator('#panel [data-action="redesign"]').scrollIntoViewIfNeeded();
  await page.locator('#panel [data-action="redesign"]').click();
  await page.locator('#panel input[data-field="tweak"]').waitFor();
  await page.locator('#panel input[data-field="tweak"]').fill('make it cozier, with a blue roof');
  await page.locator('#panel input[data-field="tweak"]').scrollIntoViewIfNeeded();
  await snap('redesign-form', 'asking for a redesign');
  await page.locator('#panel input[data-field="tweak"]').press('Enter');
  await plotView(PLOT, 'designing').waitFor();
  await page.waitForTimeout(3000);
  await snap('redesigning', 'the building stays up, with a scaffold round it');
  await page.evaluate(() => document.querySelector('#panel [data-action="close-panel"]')?.click());
  await page.waitForTimeout(1500);
  await snap('redesigning-world', 'the building behind its scaffold in the world');
  await page.locator('#places-toggle').click();
  await page.locator(`#place-list [data-place="${PLOT}"]`).click();
  await plotView(PLOT, 'built').waitFor({ timeout: 45_000 });
  await page.waitForTimeout(2600);
  await dismissBubbles(3000);
  await panelBody().evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  const redesignedName = (await page.locator('#panel-title').textContent()).trim();
  console.log('  after redesign:', redesignedName);
  await snap('redesigned', 'the redesigned building keeps its name');

  // 8. Clear the plot.
  await page.locator('#panel [data-action="clear"]').scrollIntoViewIfNeeded();
  await page.locator('#panel [data-action="clear"]').click();
  await page.locator('#panel .confirm').waitFor();
  await page.locator('#panel .confirm').scrollIntoViewIfNeeded();
  await snap('clear-confirm', 'confirm before clearing');
  await page.locator('#panel [data-action="clear-confirm"]').click();
  await plotView(PLOT, 'empty').waitFor();
  await poll(async () => (await page.locator('#panel .idea').count()) === 3, 'ideas again');
  await page.waitForTimeout(600);
  await snap('cleared', 'the plot is empty again');
  await page.evaluate(() => document.querySelector('#panel [data-action="close-panel"]')?.click());
  await page.waitForTimeout(900);
  await snap('cleared-world', 'the empty plot in the world');

  const leaving = requests.filter(url => !/^(file|data|blob|devtools|chrome-extension):/i.test(url));
  console.log(`\n${shot} screenshots. Renderer errors: ${errors.length}. Requests off the PC: ${leaving.length}.`);
  for (const line of errors) console.log('  ', line);
  for (const url of leaving) console.log('   request:', url);
  if (errors.length || leaving.length) process.exitCode = 1;
} catch (error) {
  console.error('Walkthrough failed:', error.message);
  for (const line of errors) console.log('  ', line);
  if (page) await page.screenshot({ path: path.join(out, 'step2-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
