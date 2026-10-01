// Shared helpers for MILO's Electron checks (CONTRACT-PHASE4.md §13 wave 0), moved here unchanged
// from tests/ui.mjs so tests/ui.mjs (Phases 1–3) and tests/ui-phase4.mjs drive the app the same
// way. Not a check script itself.
//
//   import { createUiKit, makeRoot } from './ui-helpers.mjs';
//   const { root, data, environment } = await makeRoot('milo-ui4-');
//   const kit = createUiKit({ repo, environment });
//   await kit.launch();
//   await kit.check('the window opens', async () => { … kit.window.locator(…) … });
//
// Everything here runs against isolated, synthetic homes and data folders (makeRoot); nothing
// touches Chris's own ~/.claude, ~/.codex or MILO data.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import electronPath from 'electron';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * A fresh temporary root for one run: data/, claude-home/ and codex-home/ (copied from the
 * synthetic fixture homes when they exist), projects/, and the environment that points MILO at
 * them in test mode with the architect's canned crew. The root is kept after the run, so a failure
 * can be looked at; its path is printed by the scripts.
 * → { root, data, claudeHome, codexHome, projects, environment }
 */
export async function makeRoot(prefix = 'milo-ui-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const data = path.join(root, 'data');
  const claudeHome = path.join(root, 'claude-home');
  const codexHome = path.join(root, 'codex-home');
  const projects = path.join(root, 'projects');
  await mkdir(data, { recursive: true });
  // Start from the watch module's synthetic homes when they exist.
  for (const [name, target] of [['claude-home', claudeHome], ['codex-home', codexHome]]) {
    const source = path.join(FIXTURES, name);
    if (existsSync(source)) await cp(source, target, { recursive: true });
    else await mkdir(target, { recursive: true });
  }
  const environment = {
    ...process.env,
    MILO_TEST: '1',
    MILO_DATA_DIR: data,
    MILO_CLAUDE_HOME: claudeHome,
    MILO_CODEX_HOME: codexHome,
    MILO_ARCHITECT: 'fake',
    MILO_FAKE_DELAY_MS: '1500',
    MILO_PROJECTS_DIR: projects,
  };
  delete environment.ELECTRON_RUN_AS_NODE; // must stay: agent shells may set it
  return { root, data, claudeHome, codexHome, projects, environment };
}

/**
 * The helpers every Electron check uses, bound to one app launch at a time. `window` is the page
 * of the current launch (Playwright's Page), `application` the ElectronApplication, and
 * `completed` the number of checks passed. pageErrors, consoleErrors, miloWarnings (the shell's
 * `[MILO]` fallbacks), diagnostics (main's stderr), requests and blockedRequests collect over
 * every launch, for the run's closing assertions.
 */
export function createUiKit({ repo, environment }) {
  const pageErrors = [];
  const consoleErrors = [];
  const miloWarnings = [];
  const diagnostics = [];
  const requests = [];
  const blockedRequests = [];
  const watchedPages = new WeakSet();
  let application = null;
  let page = null;
  let completedChecks = 0;

  function watchPage(window) {
    if (watchedPages.has(window)) return;
    watchedPages.add(window);
    window.on('pageerror', error => pageErrors.push(error.message));
    window.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
      // The shell loads modules defensively and logs a [MILO] warning when one fails.
      if (message.type() === 'warning' && message.text().startsWith('[MILO]')) miloWarnings.push(message.text());
    });
    window.on('request', request => requests.push(request.url()));
    window.setDefaultTimeout(10_000);
  }

  async function launch(appPath = repo, extraEnv = {}) {
    application = await _electron.launch({ executablePath: electronPath, args: [appPath], cwd: appPath, env: { ...environment, ...extraEnv }, timeout: 30_000 });
    application.process().stderr?.on('data', chunk => diagnostics.push(String(chunk)));
    application.on('window', watchPage);
    page = await application.firstWindow();
    watchPage(page);
    await page.locator('body[data-ready="true"]').waitFor({ timeout: 40_000 });
  }

  async function close() {
    if (!application) return;
    const current = application;
    application = null;
    try {
      blockedRequests.push(...(await current.evaluate(() => globalThis.__miloBlockedRequests || [])));
    } catch { /* already gone */ }
    await current.close();
  }

  async function poll(check, description, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    let lastError;
    do {
      try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
  }

  async function check(name, run) {
    await run();
    completedChecks += 1;
    console.log(`PASS ${name}`);
  }

  const scan = () => page.evaluate(() => window.milo.scan());
  const savedState = (test = () => true) => poll(async () => {
    const state = await page.evaluate(() => window.milo.loadState());
    return test(state) ? state : null;
  }, 'the expected state to be saved');
  const bubble = kind => page.locator(`#bubble[data-kind="${kind}"]`);
  // Let fades and the panel slide settle so screenshots show the resting layout.
  const settle = async () => {
    await page.locator('#bubble.shown, #bubble[hidden]').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(450);
  };
  const panel = place => page.locator(`#panel[data-place="${place}"]`);

  async function openPlace(id) {
    const toggle = page.locator('#places-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.locator(`#place-list [data-place="${id}"]`).click();
    await panel(id).waitFor();
  }

  // Clicks through whatever Milo is saying (the last button is always the quiet one) until he's done.
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

  async function waitForScanWhere(test, description) {
    return poll(async () => {
      const snapshot = await scan();
      return test(snapshot) ? snapshot : null;
    }, description, 30_000);
  }

  // ---------------------------------------------------------------------------
  // Phase 3: the Hearth and the Wilds (CONTRACT-PHASE3 §9 H). Motion is off for these, so every
  // arrow key is one step and walks land at once.

  const area = () => page.locator('#stage').getAttribute('data-area');
  const closePanelNow = async () => {
    if (await page.locator('#panel').isHidden()) return;
    await page.locator('#panel .panel-close').click();
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
  };
  const stepKeys = async (from, steps) => {
    let at = from;
    for (const step of steps) {
      const key = step.x > at.x ? 'ArrowRight' : step.x < at.x ? 'ArrowLeft' : step.y > at.y ? 'ArrowDown' : 'ArrowUp';
      await page.keyboard.press(key);
      at = step;
    }
    return at;
  };
  const openPlacesList = async () => {
    const toggle = page.locator('#places-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  // An entry the world may still be filling in (today's wild rifts come in idle time): the list
  // is opened afresh until it's there.
  const listEntry = async (id, timeout = 20_000) => {
    const entry = page.locator(`#place-list [data-entity="${id}"]`);
    await poll(async () => {
      await openPlacesList();
      if (await entry.count()) return true;
      await page.locator('#places-toggle').click();
      await page.waitForTimeout(300);
      return false;
    }, `${id} in the place list`, timeout);
    return entry;
  };
  const activeName = () => page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}${el.id ? `#${el.id}` : ''}` : 'none';
  });
  // Keyboard focus never falls to the page's body after a move takes away what had it.
  const assertFocusKept = async label => {
    await page.waitForTimeout(250);
    const name = await activeName();
    assert.notEqual(name, 'BODY', `${label}: focus rests somewhere, not on the page's body`);
    return name;
  };
  // Home from the place list, from the keyboard (as a screen-reader user would).
  const travelHome = async () => {
    if ((await area()) === 'vale') return;
    await openPlacesList();
    await page.locator('#place-list [data-entity="home"]').focus();
    await page.keyboard.press('Enter');
    await poll(async () => (await area()) === 'vale', 'Milo to travel home', 20_000);
    await assertFocusKept('Travel home from the place list');
  };
  // 1000×700: nothing scrolls the window or a panel sideways, and the box stays inside.
  async function fitsAt1000(selector, label) {
    const report = await page.evaluate(sel => {
      const node = document.querySelector(sel);
      const box = node.getBoundingClientRect();
      const body = node.querySelector('#panel-body') || node;
      const wide = [...node.querySelectorAll('*')].filter(child => child.getBoundingClientRect().right > box.right + 1 && child.getClientRects().length)
        .map(child => child.className || child.tagName).slice(0, 6);
      return {
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        overflow: body.scrollWidth > body.clientWidth + 1,
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        wide,
      };
    }, selector);
    assert.ok(report.scroll[0] <= 1000 && report.scroll[1] <= 700, `No window overflow with ${label}: ${JSON.stringify(report.scroll)}`);
    assert.equal(report.overflow, false, `${label} doesn't scroll sideways: ${report.wide.join(', ')}`);
    assert.ok(report.box.left >= -1 && report.box.top >= -1 && report.box.right <= 1001 && report.box.bottom <= 701, `${label} stays inside: ${JSON.stringify(report.box)}`);
  }

  // From the keyboard, Tab reaches every control in `selector` in turn, and each shows a focus
  // ring: an outline (a radio's ring may be drawn round its whole option) that no scrolling box
  // cuts off at the sides. → the names of the controls reached, in order.
  async function assertFocusRings(selector, label, { least = 1 } = {}) {
    await page.evaluate(sel => {
      const probe = document.createElement('span');
      probe.tabIndex = -1;
      probe.dataset.focusProbe = 'true';
      document.querySelector(sel).prepend(probe);
      probe.focus();
    }, selector);
    const reached = [];
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(sel => {
        const root = document.querySelector(sel);
        const el = document.activeElement;
        if (!el || !root.contains(el) || el.dataset.focusProbe) return null;
        const ringOf = node => {
          const style = getComputedStyle(node);
          const width = parseFloat(style.outlineWidth) || 0;
          return style.outlineStyle !== 'none' && width >= 1 ? { node, reach: width + (parseFloat(style.outlineOffset) || 0) } : null;
        };
        const ring = ringOf(el) || (el.matches('input') && el.closest('label') ? ringOf(el.closest('label')) : null);
        let clipped = null;
        if (ring) {
          const box = ring.node.getBoundingClientRect();
          for (let up = ring.node.parentElement; up && up !== document.body; up = up.parentElement) {
            if (!/hidden|auto|scroll|clip/.test(getComputedStyle(up).overflowX)) continue;
            const outer = up.getBoundingClientRect();
            const left = outer.left + up.clientLeft;
            if (box.left - ring.reach < left - 0.5 || box.right + ring.reach > left + up.clientWidth + 0.5) { clipped = up.id || up.className || up.tagName; break; }
          }
        }
        const name = el.dataset.focusKey || el.dataset.action || el.dataset.marker || el.id || el.getAttribute('aria-label') || el.textContent || el.tagName;
        return { name: String(name).trim().replace(/\s+/g, ' ').slice(0, 48), keyboard: el.matches(':focus-visible'), ring: Boolean(ring), clipped };
      }, selector);
      if (!info) {
        // Past the last one: step back, so focus rests where a keyboard user would leave it.
        if (reached.length) await page.keyboard.press('Shift+Tab');
        break;
      }
      if (reached.includes(info.name) && reached.at(-1) !== info.name) break;
      reached.push(info.name);
      assert.equal(info.keyboard, true, `${label}: ${info.name} takes keyboard focus`);
      assert.equal(info.ring, true, `${label}: ${info.name} shows a focus ring`);
      assert.equal(info.clipped, null, `${label}: ${info.name}'s ring isn't cut off by ${info.clipped}`);
    }
    await page.evaluate(() => document.querySelectorAll('[data-focus-probe]').forEach(probe => probe.remove()));
    assert.ok(reached.length >= least, `${label}: Tab reached ${reached.length} controls (${reached.join(', ')})`);
    return reached;
  }

  // Where Milo stands in the wilds, once the saved tile has stopped changing (steps are saved on a
  // short debounce).
  const standingAt = () => poll(async () => {
    const first = (await page.evaluate(() => window.milo.loadState())).wilds?.at;
    await page.waitForTimeout(1800);
    const second = (await page.evaluate(() => window.milo.loadState())).wilds?.at;
    return first && second && first.x === second.x && first.y === second.y ? second : null;
  }, 'Milo to stand still', 20_000);

  // The land round Milo, from the wilds' own modules, as the engine sees it at this tier.
  const wildsPlan = (task, extra = {}) => page.evaluate(async ({ task, extra }) => {
    const content = await window.milo.content();
    const saved = await window.milo.loadState();
    const { offset } = await window.milo.clock();
    const { createWorldgen } = await import('./src/world/worldgen.js');
    const { createWilds } = await import('./src/world/wilds.js');
    const { createNav } = await import('./src/world/nav.js');
    const { createRiftgen } = await import('./src/world/riftgen.js');
    const { wildRiftsForChunk, dayNumber } = await import('./src/rifts.js');
    const { hearthTier, wardRadius } = await import('./src/hearth.js');
    const tier = hearthTier(saved);
    const worldgen = createWorldgen({ seed: saved.wilds.seed, regionWords: content.riftgen.regionWords });
    const wilds = createWilds({ worldgen, maxChunks: 96 });
    const nav = createNav({ worldgen, wildBlocked: (x, y) => wilds.blocked(x, y), extraBlocked: (x, y) => wilds.ringBlocked(x, y, tier) });
    const from = extra.from;
    const day = dayNumber(Date.now() + offset);
    const near = (list) => list.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    const walk = (target, limit) => {
      for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
        const steps = nav.findPath(from, { x: target.x + dx, y: target.y + dy });
        if (steps.length && steps.length <= limit) return steps;
      }
      return null;
    };
    if (task === 'poi') {
      const box = { x: from.x - 40, y: from.y - 40, w: 80, h: 80 };
      // entitiesIn reads cached chunks only.
      for (let cy = Math.floor(box.y / 32); cy <= Math.floor((box.y + box.h) / 32); cy += 1) {
        for (let cx = Math.floor(box.x / 32); cx <= Math.floor((box.x + box.w) / 32); cx += 1) wilds.chunk(cx, cy);
      }
      const state = { tier, lit: Object.keys(saved.wilds.lanterns || {}), opened: Object.keys(saved.wilds.opened || {}), notes: Object.keys(saved.wilds.notes || {}), glimmers: Object.keys(saved.wilds.glimmers || {}), felled: [], day };
      const pois = near(wilds.entitiesIn(box, state).filter(e => e.kind === 'poi' && extra.types.includes(e.poiType ?? e.type)));
      for (const poi of pois.slice(0, 8)) {
        const steps = walk(poi, 60);
        if (steps) return { poi: { id: poi.id, type: poi.poiType ?? poi.type, x: poi.x, y: poi.y }, steps };
      }
      return null;
    }
    const riftgen = createRiftgen({ words: content.riftgen, genres: content.genres });
    const ward = wardRadius(saved, content.fortress);
    const cx0 = Math.floor(from.x / 32);
    const cy0 = Math.floor(from.y / 32);
    const found = [];
    for (let cy = cy0 - 3; cy <= cy0 + 3; cy += 1) {
      for (let cx = cx0 - 3; cx <= cx0 + 3; cx += 1) {
        found.push(...wildRiftsForChunk({ worldgen, riftgen, cx, cy, day, wardRadius: ward, closed: saved.rifts?.closedWild || {}, isFree: nav.walkable }));
      }
    }
    for (const rift of near(found).slice(0, 10)) {
      const steps = walk(rift, 140);
      // Stop short of its strays (they roam a few tiles round the tear and could stand in the way
      // of a planned step); the place list walks the rest.
      if (steps) return { rift: { id: rift.id, x: rift.x, y: rift.y, stage: rift.stage }, steps: steps.slice(0, Math.max(0, steps.length - 6)) };
    }
    return null;
  }, { task, extra });

  return {
    launch, close, poll, check, scan, savedState, bubble, panel, settle, openPlace, dismissBubbles, waitForScanWhere,
    area, closePanelNow, openPlacesList, activeName, stepKeys, listEntry, assertFocusKept, travelHome, fitsAt1000,
    assertFocusRings, standingAt, wildsPlan,
    pageErrors, consoleErrors, miloWarnings, diagnostics, requests, blockedRequests,
    get application() { return application; },
    get window() { return page; },
    get completed() { return completedChecks; },
  };
}
