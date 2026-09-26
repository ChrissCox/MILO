// End-to-end check of the MILO shell in real Electron, against isolated,
// synthetic ~/.claude and ~/.codex homes. Nothing here touches Chris's data.
//
//   node tests/ui.mjs

import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import { processStartTimes } from '../src/watch/claude.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(repo, 'test-results');
const fixtures = path.join(repo, 'tests', 'fixtures');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const EARLIER_SHOWN = 15;

const root = await mkdtemp(path.join(tmpdir(), 'milo-ui-'));
const dataDirectory = path.join(root, 'data');
const claudeHome = path.join(root, 'claude-home');
const codexHome = path.join(root, 'codex-home');
await mkdir(artifacts, { recursive: true });
await mkdir(dataDirectory, { recursive: true });

// Start from the watch module's synthetic homes when they exist, then add the
// sessions this test drives. All text is made up.
for (const [name, target] of [['claude-home', claudeHome], ['codex-home', codexHome]]) {
  const source = path.join(fixtures, name);
  if (existsSync(source)) await cp(source, target, { recursive: true });
  else await mkdir(target, { recursive: true });
}

const LIVE_ID = '5f0c2a8e-7d41-4b6a-9c3e-1a2b3c4d5e01';
const LIVE_CWD = 'C:\\Projects\\Lantern';
const LIVE_TITLE = 'Lantern garden build';
const XSS_ID = '5f0c2a8e-7d41-4b6a-9c3e-1a2b3c4d5e02';
const XSS_TITLE = 'Tidy notes <img src=x onerror="window.__injected=1">';
const WAIT_TITLE = 'Portfolio copy review';
// A registry file left behind by a crashed session whose pid now belongs to another process
// (pid 4, Windows' System process): it must not read as live.
const STALE_ID = '5f0c2a8e-7d41-4b6a-9c3e-1a2b3c4d5e04';
const WINDOWS = process.platform === 'win32';
const liveTranscript = path.join(claudeHome, 'projects', 'C--Projects-Lantern', `${LIVE_ID}.jsonl`);
const liveRegistry = path.join(claudeHome, 'sessions', `${process.pid}.json`);
const waitingRegistry = path.join(claudeHome, 'sessions', `${process.ppid}.json`);
// The live entry carries this process's real creation time, as Claude Code writes it, so the
// app's process-identity check runs for real.
const liveProcStart = WINDOWS ? (await processStartTimes([process.pid]).catch(() => null))?.get(process.pid)?.toString() : undefined;

const iso = ms => new Date(ms).toISOString();
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
let uuid = 0;

function record(type, sessionId, cwd, at, extra) {
  uuid += 1;
  return {
    parentUuid: uuid > 1 ? `ui-${uuid - 1}` : null, isSidechain: false, type, uuid: `ui-${uuid}`,
    timestamp: iso(at), userType: 'external', entrypoint: 'cli', cwd, sessionId, version: '2.1.0', gitBranch: 'main', ...extra,
  };
}

const userTurn = (sessionId, cwd, at, text) => record('user', sessionId, cwd, at, { message: { role: 'user', content: text } });
const assistantTurn = (sessionId, cwd, at, text, stopReason) => record('assistant', sessionId, cwd, at, {
  message: {
    id: `msg_ui_${uuid + 1}`, type: 'message', role: 'assistant', model: 'claude-opus-4-5',
    content: [{ type: 'text', text }], stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  },
});

async function writeRegistry(file, pid, sessionId, cwd, name, status, extra = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const now = Date.now();
  await writeFile(file, JSON.stringify({
    pid, sessionId, cwd, startedAt: now - 5 * 60_000, kind: 'interactive', entrypoint: 'cli',
    name, status, updatedAt: now, statusUpdatedAt: now, ...extra,
  }), 'utf8');
}

const liveExtra = () => (liveProcStart ? { procStart: liveProcStart } : {});

async function seedHomes() {
  const now = Date.now();
  // A live Claude session that is busy right now.
  await mkdir(path.dirname(liveTranscript), { recursive: true });
  await writeFile(liveTranscript, jsonl([
    userTurn(LIVE_ID, LIVE_CWD, now - 4 * 60_000, 'Plant a small lantern garden by the pond.'),
    assistantTurn(LIVE_ID, LIVE_CWD, now - 60_000, 'Laying out the first row of lanterns.', 'tool_use'),
  ]), 'utf8');
  await writeRegistry(liveRegistry, process.pid, LIVE_ID, LIVE_CWD, LIVE_TITLE, 'busy', liveExtra());
  // A live session waiting on Chris (the parent shell is alive for the whole run).
  await writeRegistry(waitingRegistry, process.ppid, '5f0c2a8e-7d41-4b6a-9c3e-1a2b3c4d5e03', 'C:\\Projects\\Portfolio', WAIT_TITLE, 'waiting');
  if (WINDOWS) {
    const staleCwd = 'C:\\Projects\\Stale';
    const stale = path.join(claudeHome, 'projects', 'C--Projects-Stale', `${STALE_ID}.jsonl`);
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, jsonl([
      userTurn(STALE_ID, staleCwd, now - DAY, 'Rake the old leaves.'),
      assistantTurn(STALE_ID, staleCwd, now - DAY + 30_000, 'Raking the first pile.', 'tool_use'),
    ]), 'utf8');
    await writeRegistry(path.join(claudeHome, 'sessions', '4.json'), 4, STALE_ID, staleCwd, 'Leaf raking', 'busy', { procStart: '133000000000000000' });
  }
  // A finished session whose title and last message contain markup that must stay text.
  const notesCwd = 'C:\\Projects\\Notes';
  const notes = path.join(claudeHome, 'projects', 'C--Projects-Notes', `${XSS_ID}.jsonl`);
  await mkdir(path.dirname(notes), { recursive: true });
  await writeFile(notes, jsonl([
    userTurn(XSS_ID, notesCwd, now - 3 * HOUR, 'Sort the loose notes into folders.'),
    assistantTurn(XSS_ID, notesCwd, now - 3 * HOUR + 60_000, 'Sorted them into <b>three</b> folders <script>window.__injected=2</script>.', 'end_turn'),
    { type: 'custom-title', customTitle: XSS_TITLE, sessionId: XSS_ID },
  ]), 'utf8');
}

async function finishLiveTurn(text) {
  await appendFile(liveTranscript, jsonl([assistantTurn(LIVE_ID, LIVE_CWD, Date.now(), text, 'end_turn')]), 'utf8');
  await writeRegistry(liveRegistry, process.pid, LIVE_ID, LIVE_CWD, LIVE_TITLE, 'idle', liveExtra());
}

await seedHomes();

const environment = {
  ...process.env,
  MILO_TEST: '1',
  MILO_DATA_DIR: dataDirectory,
  MILO_CLAUDE_HOME: claudeHome,
  MILO_CODEX_HOME: codexHome,
};
delete environment.ELECTRON_RUN_AS_NODE;

const pageErrors = [];
const consoleErrors = [];
const miloWarnings = [];
const diagnostics = [];
const requests = [];
const blockedRequests = [];
const watchedPages = new WeakSet();
let application;
let page;
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

async function launch(appPath = repo) {
  application = await _electron.launch({ executablePath: electronPath, args: [appPath], cwd: appPath, env: environment, timeout: 30_000 });
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
const dayKey = ms => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function expectedGroup(session, now) {
  if (!session.archived && session.status === 'needs-you') return 'needs-you';
  if (!session.archived && session.status === 'working') return 'working';
  if (!session.archived && session.status === 'done' && now - session.lastActivityAt < DAY) return 'recent';
  return 'earlier';
}

async function openPlace(id) {
  const toggle = page.locator('#places-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.locator(`#place-list [data-place="${id}"]`).click();
  await panel(id).waitFor();
}

async function waitForScanWhere(test, description) {
  return poll(async () => {
    const snapshot = await scan();
    return test(snapshot) ? snapshot : null;
  }, description, 30_000);
}

try {
  await launch();

  await check('the window opens world-first with an isolated, sandboxed renderer', async () => {
    assert.equal(await page.title(), 'MILO');
    await page.locator('canvas#world').waitFor();
    assert.match(await page.locator('canvas#world').getAttribute('aria-label'), /Milo's world/);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.equal(await page.evaluate(() => typeof require), 'undefined', 'No Node in the renderer');
    assert.deepEqual(await page.evaluate(() => Object.keys(window.milo).sort()),
      ['finishClose', 'loadState', 'notify', 'onBeforeClose', 'onSnapshot', 'saveState', 'scan', 'windowAction']);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.equal(await page.locator('.titlebar [data-window="close"]').count(), 1);
    assert.deepEqual(pageErrors, [], `Renderer errors: ${pageErrors.join('\n')}`);
  });

  await check('Milo greets with a recap, and Show me opens the watchtower', async () => {
    const snapshot = await scan();
    const live = snapshot.sessions.find(session => session.id === `claude:${LIVE_ID}`);
    assert.ok(live, 'The live registry session is in the snapshot');
    assert.equal(live.status, 'working');
    assert.equal(live.title, LIVE_TITLE);
    assert.equal(live.live, true, 'the live pid is confirmed as the process that registered it');
    if (WINDOWS) {
      const stale = snapshot.sessions.find(session => session.id === `claude:${STALE_ID}`);
      assert.ok(stale, 'the stale session is still listed from its transcript');
      assert.equal(stale.live, false, 'a registry pid now held by another process is not live');
      assert.equal(stale.status, 'stopped');
    }
    const greeting = bubble('greeting');
    await greeting.waitFor({ timeout: 20_000 });
    const title = (await greeting.locator('.bubble-title').textContent()).trim();
    assert.match(title, /^(Good (morning|afternoon|evening), Chris|Hi, Chris)$/, 'A first launch greets by time of day');
    const lines = await greeting.locator('.bubble-line').allTextContents();
    assert.ok(lines.length >= 1 && lines.length <= 4, `One to four recap lines: ${lines.length}`);
    assert.ok(lines.some(line => /working|waiting/i.test(line)), 'The recap mentions what the crew is doing now');
    assert.doesNotMatch(await greeting.textContent(), /!/, 'Calm copy, no exclamation marks');
    // Keyboard users reach the greeting's buttons right after the map, well before it fades.
    const tabStop = await page.evaluate(() => {
      const focusable = [...document.querySelectorAll('button, [tabindex="0"]')]
        .filter(node => !node.closest('[hidden]') && node.getAttribute('tabindex') !== '-1');
      return focusable.findIndex(node => node.textContent.trim() === 'Show me') + 1;
    });
    assert.ok(tabStop > 0 && tabStop <= 5, `'Show me' is tab stop ${tabStop}`);
    await settle();
    // The bubble sits clear of the campfire circle, the crew and Milo.
    await poll(async () => (await greeting.getAttribute('data-clear')) === 'true', 'the greeting to find a clear spot', 5000);
    await page.screenshot({ path: path.join(artifacts, 'greeting.png') });
    await greeting.getByRole('button', { name: 'Show me', exact: true }).click();
    await panel('watchtower').waitFor();
    assert.equal((await page.locator('#panel-title').textContent()).trim(), 'Watchtower');
    assert.equal(await page.locator('#hover-tip').isVisible(), false, 'No stale map tip over an open panel');
    await bubble('greeting').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
      assert.equal(await page.locator('#bubble').isVisible(), false);
    });
    const state = await savedState(value => Number.isFinite(value?.lastSeenAt) && value.lastGreetedDay);
    assert.ok(Date.now() - state.lastSeenAt < 5 * 60_000, 'lastSeenAt is set at launch');
    assert.equal(state.lastGreetedDay, dayKey(Date.now()));
  });

  await check('the watchtower groups sessions by status and keeps markup as text', async () => {
    const snapshot = await scan();
    const now = Date.now();
    await page.locator(`[data-group="working"] [data-session-id="claude:${LIVE_ID}"]`).waitFor();
    const byGroup = {};
    for (const session of snapshot.sessions) (byGroup[expectedGroup(session, now)] ||= []).push(session);
    for (const [group, sessions] of Object.entries(byGroup)) {
      const shown = group === 'earlier' ? sessions.slice(0, EARLIER_SHOWN) : sessions;
      for (const session of shown) {
        assert.equal(await page.locator(`[data-group="${group}"] [data-session-id="${session.id}"]`).count(), 1,
          `${session.id} (${session.status}) is listed under ${group}`);
      }
      assert.match(await page.locator(`[data-group="${group}"] h3 .count`).textContent(), new RegExp(`^${sessions.length}$`));
    }
    const liveRow = page.locator(`[data-session-id="claude:${LIVE_ID}"]`);
    assert.equal((await liveRow.locator('.session-title').textContent()).trim(), LIVE_TITLE);
    const liveMeta = await liveRow.locator('.session-meta').textContent();
    assert.match(liveMeta, /Lantern/);
    // The project reads as a folder, and a working row says when it last wrote something.
    assert.equal(await liveRow.locator('.session-meta .session-project .folder').count(), 1);
    assert.match(await liveRow.locator('.session-project').textContent(), /^Folder Lantern$/);
    assert.match(liveMeta, /Updated just now|Last update/);
    assert.doesNotMatch(liveMeta, /Working now/, 'the group heading already says it');
    // Pixel glyphs: faces at 2x (16px for an 8x8 grid), ticks at 2x, main crew faces symmetric.
    const glyphs = await page.evaluate(() => {
      const size = selector => [...document.querySelectorAll(selector)].map(node => `${node.getBoundingClientRect().width}x${node.getBoundingClientRect().height}`);
      const symmetric = id => {
        const svg = document.querySelector(`#crew [data-crew="${id}"] .face`);
        const cells = new Set([...svg.querySelectorAll('rect')].map(rect => `${rect.getAttribute('x')},${rect.getAttribute('y')},${rect.getAttribute('fill')}`));
        return [...cells].every(cell => {
          const [x, y, fill] = cell.split(',');
          return cells.has(`${7 - Number(x)},${y},${fill}`);
        });
      };
      return { badges: [...new Set(size('.agent-badge .face'))], tools: [...new Set(size('.tool .face'))], claude: symmetric('claude'), codex: symmetric('codex') };
    });
    assert.deepEqual(glyphs.badges, ['16x16']);
    assert.deepEqual(glyphs.tools, ['16x16']);
    assert.equal(glyphs.claude, true, "Claude's face is symmetric");
    assert.equal(glyphs.codex, true, "Codex's face is symmetric");
    const waiting = snapshot.sessions.find(session => session.title === WAIT_TITLE);
    if (waiting?.status === 'needs-you') {
      assert.equal(await page.locator('[data-group="needs-you"] .session-title', { hasText: WAIT_TITLE }).count(), 1);
    }
    const xss = snapshot.sessions.find(session => session.id === `claude:${XSS_ID}`);
    assert.ok(xss, 'The finished notes session is in the snapshot');
    const xssRow = page.locator(`[data-session-id="claude:${XSS_ID}"]`);
    assert.equal((await xssRow.locator('.session-title').textContent()).trim(), xss.title);
    assert.equal(await page.locator('#panel img, #panel script, #panel b').count(), 0, 'Transcript markup is never rendered');
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    for (const tool of snapshot.tools) {
      const row = page.locator(`.helpers .tool[data-tool="${tool.id}"]`);
      assert.equal(await row.count(), 1, `${tool.id} is listed under Helpers`);
      if (tool.note) assert.match(await row.textContent(), new RegExp(tool.note.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(await page.locator('#panel').textContent(), /sends nothing anywhere/);
    const chips = await page.locator('#crew .crew-chip').evaluateAll(nodes => nodes.map(node => [node.dataset.crew, node.dataset.state]));
    assert.deepEqual(chips.slice(0, 2), [['claude', 'working'], ['codex', chips[1][1]]], 'Claude reads as working in the crew strip');
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'watchtower.png') });
  });

  await check('a finished task brings a calm alert from Milo', async () => {
    await finishLiveTurn('The lantern garden is planted and glowing softly.');
    await waitForScanWhere(snapshot => snapshot.sessions.find(session => session.id === `claude:${LIVE_ID}`)?.status === 'done',
      'the live session to finish');
    const alert = bubble('alert');
    await alert.waitFor({ timeout: 15_000 });
    const text = await alert.textContent();
    assert.match(text, /Claude finished a task/);
    assert.match(text, new RegExp(LIVE_TITLE));
    assert.doesNotMatch(text, /!/);
    await page.locator(`[data-group="recent"] [data-session-id="claude:${LIVE_ID}"]`).waitFor();
    const focused = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused());
    const toasts = await application.evaluate(() => globalThis.__miloNotifications);
    if (focused) assert.equal(toasts.length, 0, 'No desktop note while MILO has focus');
    else assert.ok(toasts.some(toast => toast.title === 'Claude finished a task'), 'A desktop note goes out while MILO is in the background');
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'finished-alert.png') });
    await alert.getByRole('button', { name: 'Got it', exact: true }).click();
    await poll(async () => !(await page.locator('#bubble').isVisible()), 'the alert to fade');
  });

  await check('an alert that arrives in the pause after a dismissal stays until it is dismissed', async () => {
    const base = await scan();
    const at = Date.now();
    const made = (n, title, done = at) => ({
      id: `codex:race-${n}`, agent: 'codex', sessionId: `race-${n}`, title, project: 'Race', cwd: 'C:\\Projects\\Race',
      startedAt: done - 60_000, lastActivityAt: done, status: 'done', statusDetail: 'Finished', live: false, lastMessage: '',
      completions: [done], turns: 1, model: '', source: 'test', archived: false,
    });
    const push = sessions => application.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', next),
      { ...base, scannedAt: Date.now(), sessions });
    const shown = async () => (await page.locator('#bubble:not([hidden]) .bubble-line').first().textContent({ timeout: 500 }).catch(() => '')) || '';
    const first = [...base.sessions, made(1, 'Race one'), made(2, 'Race two')];
    await push(first);
    await poll(async () => /Race one/.test(await shown()), 'the first alert');
    await page.locator('#bubble').getByRole('button', { name: 'Got it', exact: true }).click();
    // The first alert has faded (420 ms); the next one is due 500 ms later. A new alert lands now.
    await page.waitForTimeout(620);
    await push([...first, made(3, 'Race three', Date.now())]);
    await poll(async () => /Race two/.test(await shown()), 'the queued alert', 3000);
    await page.waitForTimeout(900);
    assert.match(await shown(), /Race two/, 'the queued alert is not swapped out before it is dismissed');
    for (const title of ['Race two', 'Race three']) {
      await poll(async () => new RegExp(title).test(await shown()), title, 3000);
      await page.locator('#bubble').getByRole('button', { name: 'Got it', exact: true }).click();
    }
    await poll(async () => !(await page.locator('#bubble').isVisible()), 'the alerts to clear');
    await push((await scan()).sessions);
  });

  await check('camp shows proven skills and settings save', async () => {
    await openPlace('camp');
    const watch = page.locator('.skill[data-skill="watchkeeping"]');
    assert.ok(Number(await watch.getAttribute('data-level')) >= 1, 'Watchkeeping is proven from real sources');
    assert.ok(await watch.locator('[data-level-state="proven"]').count() >= 1);
    for (const id of ['dispatch', 'timekeeping', 'lore', 'voice', 'tinkering']) {
      assert.equal(await page.locator(`.skill[data-skill="${id}"]`).getAttribute('data-level'), '0', `${id} is still locked`);
    }
    const state = await savedState(value => value.skills?.watchkeeping?.level >= 1);
    assert.ok(Number.isFinite(state.skills.watchkeeping.provenAt));
    const motion = page.locator('[data-setting="motion"]');
    assert.equal(await motion.getAttribute('aria-checked'), 'true');
    await motion.click();
    await savedState(value => value.settings.motion === false);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('still')), true);
    await page.locator('[data-setting="motion"]').click();
    await savedState(value => value.settings.motion === true);
    await page.locator('[data-setting="notifications"]').click();
    await savedState(value => value.settings.notifications === false);
    await page.locator('[data-setting="notifications"]').click();
    await savedState(value => value.settings.notifications === true);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'camp.png') });
  });

  await check('unbuilt places describe what they will become, and the harbor sits in fog', async () => {
    await openPlace('workshop');
    assert.match(await page.locator('#panel').textContent(), /Coming in a later step/);
    assert.ok(await page.locator('#panel .skill[data-skill="dispatch"] .levels li').count() >= 4);
    await openPlace('harbor');
    assert.match(await page.locator('#panel').textContent(), /Connect a calendar to clear the fog\./);
    await page.keyboard.press('Escape');
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
    await savedState(value => value.panel === null);
  });

  await check('the place list stays tucked away after a panel opened from it closes', async () => {
    const listWidth = () => page.evaluate(() => document.querySelector('#place-list').getBoundingClientRect().width);
    await page.evaluate(() => document.activeElement?.blur());
    await openPlace('library');
    await page.locator('#panel .panel-close').click();
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#places-toggle').getAttribute('aria-expanded'), 'false');
    assert.ok(await listWidth() <= 1, `the list stays closed (${await listWidth()} px wide)`);
    // The toggle closes the list again with a second click.
    await page.locator('#places-toggle').click();
    assert.ok(await listWidth() > 100, 'the toggle opens the list');
    await page.locator('#places-toggle').click();
    assert.ok(await listWidth() <= 1, 'and closes it');
  });

  await check('map tips never cover the crew strip or the Places button', async () => {
    // From the game table, the library's plot sits just under the crew strip.
    await openPlace('game-table');
    await page.locator('#panel .panel-close').click();
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
    await page.waitForTimeout(5000);
    const boxes = await page.evaluate(() => {
      const box = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      };
      return { crew: box('#crew'), places: box('#places'), world: box('#world') };
    });
    const points = [];
    for (let x = 12; x < boxes.world.right; x += 40) for (let dy = 2; dy <= 72; dy += 10) points.push([x, boxes.crew.bottom + dy]);
    for (let x = 4; x < 280; x += 20) for (let y = boxes.places.top - 60; y < boxes.world.bottom - 2; y += 12) points.push([x, y]);
    for (let x = 20; x < boxes.world.right; x += 60) for (let y = boxes.world.top + 10; y < boxes.world.bottom; y += 60) points.push([x, y]);
    let shown = 0;
    let underStrip = 0;
    for (const [x, y] of points) {
      await page.mouse.move(x, y);
      const tip = await page.evaluate(() => {
        const node = document.querySelector('#hover-tip');
        if (node.hidden) return null;
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      if (!tip) continue;
      shown += 1;
      if (y - boxes.crew.bottom < 40 && x < boxes.crew.right) underStrip += 1;
      for (const [name, box] of [['crew strip', boxes.crew], ['Places button', boxes.places]]) {
        const overlap = tip.left < box.right && tip.right > box.left && tip.top < box.bottom && tip.bottom > box.top;
        assert.ok(!overlap, `the tip for the pointer at ${x},${y} covers the ${name}`);
      }
    }
    assert.ok(shown >= 5, `tips showed at ${shown} of ${points.length} sampled points`);
    assert.ok(underStrip >= 1, `some tips were for spots right under the crew strip (${underStrip})`);
    await page.mouse.move(640, 8);
  });

  await check('1000×700 keeps the world, crew, bubble, and panel inside the window', async () => {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
    await openPlace('watchtower');
    const liveOf = snapshot => snapshot.sessions.find(session => session.id === `claude:${LIVE_ID}`);
    const turnsBefore = liveOf(await scan())?.turns ?? 0;
    await finishLiveTurn('Added a second row of lanterns along the path.');
    await waitForScanWhere(snapshot => (liveOf(snapshot)?.turns ?? 0) > turnsBefore, 'a second finished turn');
    await bubble('alert').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await poll(async () => (await page.locator('#bubble').getAttribute('data-clear')) === 'true', 'the alert to find a clear spot', 5000);
    const report = await page.evaluate(() => {
      const box = selector => [...document.querySelectorAll(selector)].map(node => {
        const rect = node.getBoundingClientRect();
        return { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      return {
        width: innerWidth, height: innerHeight,
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, document.body.scrollWidth, document.body.scrollHeight],
        stageOverflow: document.querySelector('#stage').scrollWidth > document.querySelector('#stage').clientWidth,
        panelOverflow: document.querySelector('#panel-body').scrollWidth > document.querySelector('#panel-body').clientWidth + 1,
        boxes: [...box('#crew .crew-chip'), ...box('#panel'), ...box('#bubble'), ...box('#places-toggle'), ...box('.window-actions button'), ...box('canvas#world')],
      };
    });
    assert.ok(report.scroll[0] <= 1000 && report.scroll[2] <= 1000, `No horizontal overflow: ${JSON.stringify(report.scroll)}`);
    assert.ok(report.scroll[1] <= 700 && report.scroll[3] <= 700, `No vertical overflow: ${JSON.stringify(report.scroll)}`);
    assert.equal(report.stageOverflow, false);
    assert.equal(report.panelOverflow, false, 'Panel rows wrap instead of scrolling sideways');
    for (const item of report.boxes) {
      assert.ok(item.width > 0 && item.height > 0, `${item.selector} is visible`);
      assert.ok(item.left >= -1 && item.top >= -1 && item.right <= 1001 && item.bottom <= 701, `${item.selector} stays inside: ${JSON.stringify(item)}`);
    }
    const panelBox = report.boxes.find(item => item.selector === '#panel');
    const bubbleBox = report.boxes.find(item => item.selector === '#bubble');
    assert.ok(bubbleBox.right <= panelBox.left + 1, 'The bubble never sits under the panel');
    for (const chip of report.boxes.filter(item => item.selector === '#crew .crew-chip')) {
      assert.ok(chip.right <= panelBox.left, 'Crew chips stay clear of the panel');
    }
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700.png') });
    await bubble('alert').getByRole('button', { name: 'Got it', exact: true }).click();
  });

  let setLastSeen;
  await check('closing saves lastSeenAt, and the next launch welcomes Chris back', async () => {
    const closedAt = Date.now();
    await close();
    const onDisk = JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8'));
    assert.ok(onDisk.lastSeenAt >= closedAt - 1000, 'Closing records the moment Chris last looked');
    assert.equal(onDisk.lastGreetedDay, dayKey(Date.now()));
    assert.ok((await stat(path.join(dataDirectory, 'state.json.backup'))).size > 0, 'A backup of the previous save exists');
    // Pretend Chris stepped away for two hours while the lantern turn finished.
    setLastSeen = Date.now() - 2 * HOUR;
    await writeFile(path.join(dataDirectory, 'state.json'), JSON.stringify({ ...onDisk, lastSeenAt: setLastSeen }, null, 2), 'utf8');
    await launch();
    const greeting = bubble('greeting');
    await greeting.waitFor({ timeout: 20_000 });
    assert.equal((await greeting.locator('.bubble-title').textContent()).trim(), 'Welcome back');
    const lines = await greeting.locator('.bubble-line').allTextContents();
    assert.ok(lines.some(line => /finished/.test(line)), `The recap says what finished while away: ${lines.join(' | ')}`);
    const state = await savedState(value => value.lastSeenAt > setLastSeen + HOUR);
    assert.ok(Date.now() - state.lastSeenAt < 5 * 60_000);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'welcome-back.png') });
  });

  await check('nothing leaves localhost', async () => {
    blockedRequests.push(...(await application.evaluate(() => globalThis.__miloBlockedRequests || [])));
    const outside = requests.filter(url => !/^(file|data|blob|devtools):/i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(url));
    assert.deepEqual(outside, [], `Renderer requests outside this PC: ${outside.join(', ')}`);
    assert.deepEqual(blockedRequests, [], `Blocked web requests: ${blockedRequests.join(', ')}`);
  });

  await check('a lowercase drive letter in the launch path still saves, and a damaged state.json falls back to its backup', async () => {
    await close();
    const stateFile = path.join(dataDirectory, 'state.json');
    const backupFile = `${stateFile}.backup`;
    const good = JSON.parse(await readFile(stateFile, 'utf8'));
    await writeFile(backupFile, JSON.stringify({ ...good, settings: { ...good.settings, motion: false, notifications: false } }, null, 2), 'utf8');
    await writeFile(stateFile, 'null', 'utf8'); // valid JSON, but not a saved state
    const lower = /^[A-Z]:/.test(repo) ? `${repo[0].toLowerCase()}${repo.slice(1)}` : repo;
    await launch(lower);
    const loaded = await page.evaluate(() => window.milo.loadState());
    assert.ok(loaded && typeof loaded === 'object', 'the window launched through a lowercase path can read its state');
    assert.equal(loaded.settings.motion, false, 'settings came back from the backup');
    assert.equal(loaded.settings.notifications, false);
    assert.deepEqual(await page.evaluate(state => window.milo.saveState(state), loaded), { ok: true });
    assert.ok(await scan(), 'the scan answers too');
    assert.doesNotMatch(await page.locator('#titlebar-status').textContent(), /Couldn't save/);
    const onDisk = JSON.parse(await readFile(stateFile, 'utf8'));
    const backup = JSON.parse(await readFile(backupFile, 'utf8'));
    assert.equal(onDisk.settings.motion, false, 'state.json holds the recovered settings');
    assert.equal(backup.settings.motion, false, 'the good backup was not replaced with defaults');
  });

  assert.deepEqual(pageErrors, [], `Renderer errors: ${pageErrors.join('\n')}`);
  // Until every module exists, the shell's defensive imports log a file-not-found
  // for each missing one. Once they all exist, any console error fails the run.
  const missing = ['src/world/engine.js', 'src/world/map.js', 'src/model.js', 'src/recap.js', 'src/skills.js']
    .filter(file => !existsSync(path.join(repo, file)));
  const unexpected = missing.length ? consoleErrors.filter(text => !/ERR_FILE_NOT_FOUND/.test(text)) : consoleErrors;
  if (missing.length) console.log(`Note: not written yet, so the shell ran without them: ${missing.join(', ')}`);
  assert.deepEqual(unexpected, [], `Console errors: ${unexpected.join('\n')}`);
  if (!missing.length) assert.deepEqual(miloWarnings, [], `Shell fallbacks were used: ${miloWarnings.join('\n')}`);
  console.log(`\n${completedChecks} MILO shell checks passed. No renderer errors.`);
  console.log(`Isolated data: ${root}`);
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error(`\nFAILED after ${completedChecks} checks: ${error.stack || error}`);
  console.error(`Isolated data preserved: ${root}`);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'ui-failure.png') }).catch(() => {});
  if (pageErrors.length) console.error(`Renderer errors:\n${pageErrors.join('\n')}`);
  if (consoleErrors.length) console.error(`Console errors:\n${consoleErrors.join('\n')}`);
  if (diagnostics.length) console.error(`Diagnostics:\n${diagnostics.join('')}`);
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
}
