// End-to-end check of the MILO shell in real Electron, against isolated,
// synthetic ~/.claude and ~/.codex homes, synthetic skills and projects, and the
// architect's canned crew (MILO_ARCHITECT=fake). Nothing here touches Chris's data.
//
//   node tests/ui.mjs

import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processStartTimes } from '../src/watch/claude.js';
import { createUiKit, makeRoot } from './ui-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(repo, 'test-results');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const EARLIER_SHOWN = 15;

// A temp root with data/, the synthetic claude-home/ and codex-home/ (from the watch module's
// fixtures), projects/, and the test-mode environment that points MILO at them.
const { root, data: dataDirectory, claudeHome, codexHome, projects: projectsDir, environment } = await makeRoot('milo-ui-');
await mkdir(artifacts, { recursive: true });

// What the architect may share: skill names and descriptions (from the synthetic ~/.claude/skills),
// and project folder names. Made up here.
const SKILLS = {
  'video-expert': 'Become an expert in a field from videos and research, then write an expertise pack.',
  'expert-pf2e-encounter-design': 'Pathfinder 2e encounter design and difficulty tuning for game nights.',
  'expert-fantasy-football-drafting': 'Fantasy football player analysis and draft strategy.',
  jev: 'Sort, triage, label or rank any pile of text with a quick decision model.',
};
async function seedSignals() {
  for (const [name, description] of Object.entries(SKILLS)) {
    await mkdir(path.join(claudeHome, 'skills', name), { recursive: true });
    await writeFile(path.join(claudeHome, 'skills', name, 'SKILL.md'), ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, ''].join('\n'), 'utf8');
  }
  for (const name of ['Habitack', 'MILO', 'Sketchbook']) await mkdir(path.join(projectsDir, name), { recursive: true });
}
const PLOTS = ['plot-meadow', 'plot-rise', 'plot-birch', 'plot-pond', 'plot-orchard'];

// The sessions this test drives, added to the synthetic homes. All text is made up.
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

// ---------------------------------------------------------------------------
// Phase 3 fixtures: real signals behind real rifts, all made up.

// A Codex thread whose token_count carries a real-shaped rate_limits reading, stamped after the
// fixture's own 2026-09-24 reading so it's the newest. Later readings are appended to the same file.
const TIDE_ID = '01a0e0ff-0000-7000-8000-0000000000f1';
let tideRollout = null;
const codexReading = (usedPercent, at) => ({
  timestamp: iso(at), type: 'event_msg',
  payload: {
    type: 'token_count', info: null,
    rate_limits: { limit_id: 'codex', limit_name: null, primary: { used_percent: usedPercent, window_minutes: 10080, resets_at: Math.floor((Date.now() + 3 * DAY) / 1000) }, secondary: null, credits: null, individual_limit: null, spend_control_reached: null, plan_type: 'plus', rate_limit_reached_type: null },
  },
});
async function writeCodexReading(usedPercent) {
  const now = Date.now();
  if (!tideRollout) {
    const day = new Date(now - 5 * 60_000);
    const folder = path.join(codexHome, 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    await mkdir(folder, { recursive: true });
    tideRollout = path.join(folder, `rollout-${iso(now - 5 * 60_000).slice(0, 19).replace(/:/g, '-')}-${TIDE_ID}.jsonl`);
    const cwd = 'C:\\Users\\demo\\Projects\\Tide';
    await writeFile(tideRollout, jsonl([
      { timestamp: iso(now - 5 * 60_000), type: 'session_meta', payload: { session_id: TIDE_ID, id: TIDE_ID, timestamp: iso(now - 5 * 60_000), cwd, originator: 'Codex Desktop', cli_version: '0.140.0-demo', source: 'vscode', thread_source: 'user' } },
      { timestamp: iso(now - 4 * 60_000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Chart the tide tables for the harbour.' }] } },
      { timestamp: iso(now - 4 * 60_000 + 500), type: 'event_msg', payload: { type: 'task_started', turn_id: 'tide-1' } },
      codexReading(usedPercent, now - 3 * 60_000),
      { timestamp: iso(now - 2 * 60_000), type: 'event_msg', payload: { type: 'task_complete', turn_id: 'tide-1' } },
    ]), 'utf8');
    return;
  }
  await appendFile(tideRollout, jsonl([codexReading(usedPercent, now)]), 'utf8');
}

// A session that has waited on Chris for 25 hours: needs-you only while a live process owns it,
// so its registry names a sleeper child process (killed once the rift should seal, and in finally).
const KNOCK_ID = '5f0c2a8e-7d41-4b6a-9c3e-1a2b3c4d5e09';
const KNOCK_TITLE = 'Letters to answer';
const KNOCK_CWD = 'C:\\Projects\\Post';
const sleepers = [];
function spawnSleeper() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 36e5)'], { stdio: 'ignore', windowsHide: true });
  sleepers.push(child);
  return child;
}
async function seedKnock(pid) {
  const now = Date.now();
  const transcript = path.join(claudeHome, 'projects', 'C--Projects-Post', `${KNOCK_ID}.jsonl`);
  await mkdir(path.dirname(transcript), { recursive: true });
  await writeFile(transcript, jsonl([
    userTurn(KNOCK_ID, KNOCK_CWD, now - 26 * HOUR, 'Draft replies to the letters on my desk.'),
    assistantTurn(KNOCK_ID, KNOCK_CWD, now - 26 * HOUR + 60_000, 'Which letter should I start with?', 'end_turn'),
  ]), 'utf8');
  await writeRegistry(path.join(claudeHome, 'sessions', `${pid}.json`), pid, KNOCK_ID, KNOCK_CWD, KNOCK_TITLE, 'waiting', {
    startedAt: now - 27 * HOUR, updatedAt: now - 25 * HOUR, statusUpdatedAt: now - 25 * HOUR,
  });
}

await seedHomes();
await seedSignals();

const kit = createUiKit({ repo, environment });
const {
  poll, check, scan, savedState, bubble, panel, settle, openPlace, dismissBubbles, waitForScanWhere,
  area, closePanelNow, openPlacesList, activeName, stepKeys, listEntry, assertFocusKept, travelHome, fitsAt1000,
  assertFocusRings, standingAt, wildsPlan,
  pageErrors, consoleErrors, miloWarnings, diagnostics, requests, blockedRequests,
} = kit;
// The current launch's app and window, kept in step with the kit's for the checks below.
let application;
let page;

async function launch(...args) {
  await kit.launch(...args);
  application = kit.application;
  page = kit.window;
}

// Phase 4: a walk to a seam can start a fight, which holds the world still. Play it out the way
// Chris would, with “Let them handle it”, then carry on. → whether a fight was settled.
async function settleFights(wait = 2500) {
  const inFight = () => page.locator('#stage[data-mode="combat"]').count();
  const until = Date.now() + wait;
  while (Date.now() < until && !(await inFight())) await page.waitForTimeout(150);
  if (!(await inFight())) return false;
  const hud = page.locator('#combat-hud');
  for (let step = 0; step < 90 && (await inFight()); step += 1) {
    const ask = hud.locator('[data-action="combat-hud-answer"]');
    if (await ask.count()) { await ask.last().click({ timeout: 3000 }).catch(() => {}); continue; }
    const cards = hud.locator('[data-action="combat-hud-card"]');
    if (await cards.count()) {
      let clicked = false;
      for (const label of ['Carry on', 'Try again', 'Go home']) {
        const choice = cards.filter({ hasText: label });
        if (await choice.count()) { await choice.first().click({ timeout: 3000 }).catch(() => {}); clicked = true; break; }
      }
      if (!clicked) await cards.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    const hand = hud.locator('[data-action="planner-hand-over"]');
    const run = hud.locator('[data-action="planner-run"]');
    if (await hand.count()) await hand.first().click({ timeout: 3000 }).catch(() => {});
    else if (await run.count()) await run.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  return true;
}

async function close() {
  try {
    await kit.close();
  } finally {
    application = kit.application;
  }
}

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

const plotView = (id, status) => page.locator(`#panel .plot-view[data-plot="${id}"]${status ? `[data-plot-status="${status}"]` : ''}`);
const architectCalls = () => application.evaluate(() => globalThis.__miloArchitectCalls || []);
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

try {
  await launch();

  await check('the window opens world-first with an isolated, sandboxed renderer', async () => {
    assert.equal(await page.title(), 'MILO');
    await page.locator('canvas#world').waitFor();
    assert.match(await page.locator('canvas#world').getAttribute('aria-label'), /Milo's world/);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.equal(await page.evaluate(() => typeof require), 'undefined', 'No Node in the renderer');
    assert.deepEqual(await page.evaluate(() => Object.keys(window.milo).sort()),
      ['alarm', 'architect', 'clock', 'content', 'finishClose', 'loadState', 'notebooks', 'notify', 'onBeforeClose', 'onSnapshot', 'saveState', 'scan', 'windowAction']);
    assert.deepEqual(await page.evaluate(() => Object.keys(window.milo.architect).sort()),
      ['cancel', 'design', 'localSuggestions', 'onAsking', 'status', 'suggest']);
    assert.deepEqual(await page.evaluate(() => Object.keys(window.milo.notebooks).sort()),
      ['append', 'dropPrevious', 'read', 'replace', 'restore']);
    assert.deepEqual(await page.evaluate(() => Object.keys(window.milo.alarm).sort()), ['onRing', 'set']);
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
    // Phase 3: run late at night, the busy session opens a Nocturne rift, which can ring its bell
    // after the greeting. That's real behaviour; clear it so the alert checks start quiet.
    await dismissBubbles(3000);
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
    // Judge against the focus main saw when the alert arrived; the OS can move focus afterwards.
    const decision = await poll(() => application.evaluate(() => globalThis.__miloNotifyDecisions.find(entry => entry.title === 'Claude finished a task')), 'the alert to reach main');
    const toasts = await application.evaluate(() => globalThis.__miloNotifications.filter(toast => toast.title === 'Claude finished a task'));
    if (decision.focused) assert.equal(toasts.length, 0, 'No desktop note while MILO has focus');
    else assert.equal(toasts.length, 1, 'A desktop note goes out while MILO is in the background');
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

  await check('the harbor sits in fog until a calendar is connected', async () => {
    await openPlace('harbor');
    assert.match(await page.locator('#panel').textContent(), /Connect a calendar to clear the fog\./);
    assert.match(await page.locator('#panel').textContent(), /Coming in a later step/);
    assert.ok(await page.locator('#panel .skill[data-skill="timekeeping"] .levels li').count() >= 4);
    await page.keyboard.press('Escape');
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
    await savedState(value => value.panel === null);
  });

  await check('the place list stays tucked away after a panel opened from it closes', async () => {
    const listWidth = () => page.evaluate(() => document.querySelector('#place-list').getBoundingClientRect().width);
    await page.evaluate(() => document.activeElement?.blur());
    await openPlace('plot-birch');
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

  await check('a crew chip keeps keyboard focus through snapshots, and when its words change', async () => {
    await dismissBubbles();
    const send = next => application.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', value), next);
    const focusedChip = () => page.evaluate(() => document.activeElement?.dataset?.crew || document.activeElement?.tagName);
    const base = await scan();
    await page.locator('#crew .crew-chip[data-crew="codex"]').focus();
    // The same crew again (as every push, and the minute's tick, bring): the strip stays as it is.
    const chip = await page.locator('#crew .crew-chip[data-crew="codex"]').elementHandle();
    await send({ ...base, scannedAt: base.scannedAt + 1000 });
    await page.waitForTimeout(400);
    assert.equal(await focusedChip(), 'codex', 'focus stays on the Codex chip through a snapshot');
    assert.equal(await chip.evaluate(node => node.isConnected), true, 'the chip under the pointer is the same one');
    // Codex's words change (its sessions gone and its folder unread): the strip is redrawn, and
    // focus follows the Codex chip rather than dropping to the page.
    const before = await page.locator('#crew .crew-chip[data-crew="codex"]').getAttribute('aria-label');
    await send({ ...base, scannedAt: base.scannedAt + 2000, sessions: base.sessions.filter(s => s.agent !== 'codex'), sources: { ...base.sources, codex: { ...base.sources.codex, ok: false } } });
    await poll(async () => (await page.locator('#crew .crew-chip[data-crew="codex"]').getAttribute('aria-label')) !== before, 'the Codex chip to change its words');
    assert.equal(await chip.evaluate(node => node.isConnected), false, 'the strip was redrawn');
    assert.equal(await focusedChip(), 'codex', 'focus follows the Codex chip');
    // Tab moves on from Codex, not back to the first chip.
    await page.keyboard.press('Tab');
    assert.notEqual(await focusedChip(), 'claude', 'the next Tab carries on from Codex');
    await send({ ...(await scan()), scannedAt: base.scannedAt + 3000 });
    await poll(async () => (await page.locator('#crew .crew-chip[data-crew="codex"]').getAttribute('aria-label')) === before, 'the Codex chip to read as before');
    await page.evaluate(() => document.activeElement?.blur());
  });

  await check('map tips never cover the crew strip or the Places button', async () => {
    // From the pondside plot, Birch hollow sits just under the crew strip. Motion is off while
    // Milo gets there, so the camera lands at once however fast a background window gets frames.
    await openPlace('camp');
    await page.locator('[data-setting="motion"]').click();
    await savedState(value => value.settings.motion === false);
    await openPlace('plot-pond');
    await page.locator('#panel .panel-close').click();
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
    await page.waitForTimeout(600);
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
    await openPlace('camp');
    await page.locator('[data-setting="motion"]').click();
    await savedState(value => value.settings.motion === true);
    await page.locator('#panel .panel-close').click();
    await poll(async () => await page.locator('#panel').isHidden(), 'the panel to close');
  });

  await check('every plot starts empty with three ideas from Milo', async () => {
    const listed = await page.locator('#place-list [data-place]').evaluateAll(nodes => nodes.map(node => [node.dataset.place, node.dataset.kind]));
    assert.deepEqual(listed.filter(([, kind]) => kind === 'plot').map(([id]) => id), PLOTS);
    // Phase 3 adds the Hearth to the vale's places (and the War Table once the Stockade stands).
    assert.deepEqual(listed.filter(([, kind]) => kind !== 'plot').map(([id]) => id).sort(), ['camp', 'harbor', 'hearth', 'townhall', 'watchtower']);
    for (const id of PLOTS) {
      await openPlace(id);
      await plotView(id, 'empty').waitFor();
      await poll(async () => (await page.locator('#panel .idea').count()) === 3, `three ideas at ${id}`);
      for (const card of await page.locator('#panel .idea').all()) {
        assert.ok((await card.locator('.idea-title').textContent()).trim(), 'each idea has a name');
        assert.ok((await card.locator('.idea-pitch').textContent()).trim(), 'and says what it would do');
        assert.equal(await card.getByRole('button', { name: /^Build this/ }).count(), 1);
      }
      assert.match(await page.locator('#panel .milo-says').first().textContent(), /three ideas/);
      assert.match(await page.locator('#panel .ask-label').textContent(), /^Ask Milo what should go here, or describe your own idea$/);
      assert.equal(await page.locator('#panel').getByRole('button', { name: 'Ask for ideas', exact: true }).count(), 1);
      assert.equal(await page.locator('#panel').getByRole('button', { name: 'Build my idea', exact: true }).count(), 1);
      const shares = await page.locator('#panel [data-shares]').textContent();
      assert.match(shares, /^Milo (asks|draws)/);
      // Everything a brief carries is named, skill descriptions included.
      if (/^Milo asks/.test(shares)) assert.match(shares, /this plot’s name and size, the names of your buildings and projects, and your skills’ names with the start of each description. Never your sessions/);
      assert.equal((await page.locator(`#place-list [data-place="${id}"] .place-note`).textContent()).trim(), 'Empty plot');
    }
    const state = await savedState(value => PLOTS.every(id => value.plots?.[id]?.suggestions?.length === 3));
    for (const id of PLOTS) assert.equal(state.plots[id].status, 'empty');
    const picks = PLOTS.map(id => state.plots[id].suggestions.map(idea => idea.title).join(' | '));
    assert.ok(new Set(picks).size > 1, `different plots get different picks: ${picks.join(' / ')}`);
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'plot-empty.png') });
  });

  await check('asking Milo brings three new ideas, sharing only what the privacy rule allows', async () => {
    await openPlace('plot-rise');
    const before = await page.locator('#panel .idea-title').allTextContents();
    const question = 'something for my drawing streams';
    const input = page.locator('#panel [data-field="ask"]');
    await input.fill(question);
    await input.press('Enter');
    const state = await savedState(value => value.plots?.['plot-rise']?.asked === question && value.plots['plot-rise'].suggestions.length === 3);
    await poll(async () => /^You asked/.test(await page.locator('#panel .milo-says').first().textContent()), 'Milo to answer the question');
    const after = await page.locator('#panel .idea-title').allTextContents();
    assert.deepEqual(after, state.plots['plot-rise'].suggestions.map(idea => idea.title));
    assert.notDeepEqual(after, before, 'fresh ideas replace the first three');
    assert.equal(await page.locator('#panel [data-field="ask"]').inputValue(), '', 'the box is ready for the next question');
    const calls = await architectCalls();
    const asked = calls.filter(call => call.kind === 'suggest').at(-1);
    assert.equal(asked.question, question);
    assert.equal(asked.mode, 'fake');
    assert.equal(asked.designer, 'auto');
    assert.deepEqual(Object.keys(asked).sort(), ['at', 'built', 'designer', 'exclude', 'kind', 'mode', 'plot', 'question']);
    assert.deepEqual(asked.exclude, before, 'the ideas already shown are asked to be left out');
    assert.deepEqual(Object.keys(asked.plot).sort(), ['h', 'id', 'name', 'w']);
    assert.equal(asked.plot.id, 'plot-rise');
    assert.equal(asked.plot.name, 'Sunny rise');
    assert.ok(asked.plot.w > 0 && asked.plot.h > 0);
    assert.ok(asked.built.includes('Watchtower'));
    // Nothing from the watched sessions ever goes to the crew.
    const shared = JSON.stringify(calls).toLowerCase();
    for (const secret of [LIVE_TITLE, WAIT_TITLE, 'Tidy notes', 'lantern', 'Plant a small', 'Sorted them']) {
      assert.ok(!shared.includes(secret.toLowerCase()), `${secret} never reaches the crew`);
    }
    await dismissBubbles();
  });

  let firstBuilding = '';
  await check('building an idea puts up a building site, then the building with its level tree', async () => {
    await openPlace('plot-rise');
    const card = page.locator('#panel .idea').first();
    const ideaTitle = (await card.locator('.idea-title').textContent()).trim();
    await card.getByRole('button', { name: /^Build this/ }).click();
    let sawSite = false;
    await poll(async () => {
      const status = await page.locator('#panel .plot-view').getAttribute('data-plot-status');
      if (status === 'designing' && !sawSite) {
        sawSite = true;
        assert.equal((await page.locator('#place-list [data-place="plot-rise"] .place-note').textContent()).trim(), 'Being designed');
        assert.match(await page.locator('#panel .progress-text').textContent(), /is drawing up plans…$/);
        assert.equal(await page.locator('#panel').getByRole('button', { name: 'Cancel', exact: true }).count(), 1);
        assert.match(await page.locator('#titlebar-status').textContent(), /drawing up plans/);
        await page.screenshot({ path: path.join(artifacts, 'plot-designing.png') });
      }
      return status === 'built';
    }, 'the building to go up', 40_000);
    if (!sawSite) console.log('Note: the fake crew answered before the building site could be seen.');
    const state = await savedState(value => value.plots?.['plot-rise']?.status === 'built');
    const plot = state.plots['plot-rise'];
    firstBuilding = plot.blueprint.name;
    assert.equal(plot.idea.title, ideaTitle);
    assert.ok(['claude', 'codex', 'kit'].includes(plot.designedBy), plot.designedBy);
    assert.ok(Date.now() - plot.builtAt < 5 * 60_000);
    assert.equal(plot.blueprint.levels.length, 5);
    assert.equal((await page.locator('#panel-title').textContent()).trim(), firstBuilding);
    assert.match(await page.locator('#panel .building-meta').textContent(), /^Designed by (Claude Code|Codex|Milo) · \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) · Sunny rise$/);
    assert.equal(await page.locator('#panel .building-tagline').count(), 1, 'the tagline says what it is for');
    // Five planned levels, each with a proof check.
    const levels = page.locator('#panel .plan-level');
    assert.equal(await levels.count(), 5);
    assert.equal(await page.locator('#panel .plan-level[data-level-state="planned"]').count(), 5);
    for (let i = 0; i < 5; i += 1) {
      const level = levels.nth(i);
      assert.equal(await level.getAttribute('data-level'), String(i + 1));
      assert.equal((await level.locator('.level-tag').textContent()).trim(), 'Planned');
      assert.ok((await level.locator('.plan-proof').textContent()).replace('Proof check:', '').trim().length > 0, `level ${i + 1} has a proof check`);
    }
    assert.match(await page.locator('#panel .tree-note').textContent(), /Dispatch builds these in a later step/);
    // The building, drawn large with whole pixels.
    const art = await page.evaluate(() => {
      const canvas = document.querySelector('#panel canvas[data-art="building"]');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
      return { width: canvas.width, height: canvas.height, cssWidth: rect.width, pixel: Number(canvas.dataset.pixel), dpr: devicePixelRatio, painted, label: canvas.getAttribute('aria-label') };
    });
    assert.ok(art, 'the building is drawn in its panel');
    assert.ok(Number.isInteger(art.pixel) && art.pixel >= 2, `drawn large at a whole-pixel scale: ${JSON.stringify(art)}`);
    assert.ok(Math.abs(art.cssWidth * art.dpr - art.width) < 1, `one canvas pixel per screen pixel: ${JSON.stringify(art)}`);
    assert.ok(art.painted > art.width * art.height * 0.1, 'the canvas holds a building, not a blank');
    assert.match(art.label, new RegExp(escapeRegExp(firstBuilding)));
    // Milo says so, and the place list knows it.
    const said = bubble('built');
    await said.waitFor({ timeout: 10_000 });
    assert.match((await said.locator('.bubble-title').textContent()).trim(), / is built$/);
    assert.doesNotMatch(await said.textContent(), /!/);
    const entry = page.locator('#place-list [data-place="plot-rise"]');
    assert.match(await entry.textContent(), new RegExp(escapeRegExp(firstBuilding)));
    assert.equal((await entry.locator('.place-note').textContent()).trim(), 'Sunny rise');
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'building.png') });
    await dismissBubbles();
    // A design from an idea proves Tinkering; one the crew drew proves Dispatch too.
    const learned = await savedState(value => value.skills?.tinkering?.level >= 1);
    if (plot.designedBy !== 'kit') assert.ok(learned.skills?.dispatch?.level >= 1, 'a crew design proves Dispatch level 1');
  });

  await check('a building can be renamed, redesigned and cleared', async () => {
    await page.locator('#panel [data-action="rename"]').click();
    const nameInput = page.locator('#panel [data-field="rename"]');
    assert.equal(await nameInput.inputValue(), firstBuilding);
    await nameInput.press('Escape');
    assert.equal(await page.locator('#panel [data-field="rename"]').count(), 0, 'Escape steps out of renaming');
    assert.equal(await page.locator('#panel').isVisible(), true, 'and leaves the panel open');
    await page.locator('#panel [data-action="rename"]').click();
    await page.locator('#panel [data-field="rename"]').fill('Stream cave');
    await page.locator('#panel [data-field="rename"]').press('Enter');
    await poll(async () => (await page.locator('#panel-title').textContent()).trim() === 'Stream cave', 'the new name');
    const renamed = (await savedState(value => value.plots?.['plot-rise']?.name === 'Stream cave')).plots['plot-rise'];
    assert.match(await page.locator('#place-list [data-place="plot-rise"]').textContent(), /Stream cave/);

    await page.locator('#panel [data-action="redesign"]').click();
    assert.equal(await page.locator('#panel [data-field="rethink"]').isChecked(), false, 'a redesign keeps the level tree unless asked');
    await page.locator('#panel [data-field="tweak"]').fill('make it cozier');
    await page.locator('#panel [data-field="tweak"]').press('Enter');
    // While the crew redesigns it, the building stays standing with a scaffold round it.
    await poll(async () => (await page.locator('#panel canvas[data-art="redesign"]').count()) === 1
      || (await page.locator('#panel .plot-view').getAttribute('data-plot-status')) === 'built', 'the building behind its scaffold');
    const redone = (await savedState(value => value.plots?.['plot-rise']?.status === 'built' && value.plots['plot-rise'].builtAt > renamed.builtAt)).plots['plot-rise'];
    assert.equal(redone.name, 'Stream cave', 'a redesign keeps your name for it');
    assert.deepEqual(redone.blueprint.levels, renamed.blueprint.levels, 'a new look keeps the level tree');
    assert.equal(redone.blueprint.purpose, renamed.blueprint.purpose);
    assert.equal(redone.blueprint.style.chimney, true, 'and the look did change');
    await plotView('plot-rise', 'built').waitFor();
    const newLook = bubble('built');
    await newLook.waitFor({ timeout: 10_000 });
    assert.equal((await newLook.locator('.bubble-title').textContent()).trim(), 'The Stream cave has its new look');
    assert.match(await newLook.textContent(), /Its level tree stays as it was./);
    assert.equal((await page.locator('#panel-title').textContent()).trim(), 'Stream cave');
    const redesign = (await architectCalls()).filter(call => call.kind === 'design').at(-1);
    assert.equal(redesign.tweak, 'make it cozier');
    assert.equal(redesign.plot.id, 'plot-rise');
    assert.equal(redesign.previous?.name, renamed.blueprint.name, 'a redesign starts from the plans already there');
    assert.ok(!redesign.built.includes('Stream cave') && !redesign.built.includes(firstBuilding), 'the building being redesigned is not listed as standing');
    await dismissBubbles();

    // A redesign the crew can't finish leaves the building exactly as it was.
    const standing = (await savedState()).plots['plot-rise'];
    await page.locator('#panel [data-action="redesign"]').click();
    await page.locator('#panel [data-field="tweak"]').fill('this one will fail');
    await page.locator('#panel [data-field="tweak"]').press('Enter');
    await poll(async () => /the building stays as it was/.test(await page.locator('#panel').textContent()), 'Milo to say the building stays');
    assert.match(await page.locator('#panel [data-note="error"]').textContent(), /^Codex didn’t answer, so the building stays as it was. Try again when you like.$/);
    await plotView('plot-rise', 'built').waitFor();
    const kept = (await savedState(value => value.plots?.['plot-rise']?.status === 'built')).plots['plot-rise'];
    assert.deepEqual(kept.blueprint, standing.blueprint, 'the same building');
    assert.equal(kept.designedBy, standing.designedBy);
    await dismissBubbles();

    await page.locator('#panel [data-action="clear"]').click();
    const dialog = page.locator('#panel .confirm[role="alertdialog"]');
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /Clear Sunny rise\?/);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'clear-cancel', 'Keep it is the safe default');
    await dialog.getByRole('button', { name: 'Keep it', exact: true }).click();
    assert.equal(await page.locator('#panel .plot-view').getAttribute('data-plot-status'), 'built');
    await page.locator('#panel [data-action="clear"]').click();
    await page.locator('#panel [data-action="clear-confirm"]').click();
    await plotView('plot-rise', 'empty').waitFor();
    await poll(async () => (await page.locator('#panel .idea').count()) === 3, 'fresh ideas on the cleared plot');
    const cleared = (await savedState(value => value.plots?.['plot-rise']?.status === 'empty' && value.plots['plot-rise'].suggestions.length === 3)).plots['plot-rise'];
    assert.equal(cleared.blueprint, null);
    assert.equal(cleared.name, null);
    assert.equal((await page.locator('#panel-title').textContent()).trim(), 'Sunny rise');
    assert.equal((await page.locator('#place-list [data-place="plot-rise"] .place-note').textContent()).trim(), 'Empty plot');
    assert.match(await page.locator('#panel .milo-says').first().textContent(), /is down/);
  });

  let pondBuilding = '';
  await check('your own idea gets designed and built too', async () => {
    await openPlace('plot-pond');
    await page.locator('#panel').getByRole('button', { name: 'Build my idea', exact: true }).click();
    assert.match(await page.locator('#panel [data-hint]').textContent(), /Describe your idea first/);
    await page.locator('#panel [data-field="ask"]').fill('Bakery: keeps track of my sourdough starters');
    await page.locator('#panel').getByRole('button', { name: 'Build my idea', exact: true }).click();
    const plot = (await savedState(value => value.plots?.['plot-pond']?.status === 'built')).plots['plot-pond'];
    pondBuilding = plot.blueprint.name;
    assert.equal(plot.idea.title, 'Bakery');
    assert.equal(plot.idea.why, 'Your own idea');
    const design = (await architectCalls()).filter(call => call.kind === 'design').at(-1);
    assert.deepEqual(Object.keys(design).sort(), ['at', 'built', 'designer', 'idea', 'kind', 'mode', 'plot', 'tweak'], 'a first design has no earlier plans');
    assert.equal(design.idea.title, 'Bakery');
    assert.match(design.idea.pitch, /sourdough/);
    await plotView('plot-pond', 'built').waitFor();
    assert.equal(await page.locator('#panel .plan-level').count(), 5);
    await dismissBubbles();
  });

  await check('when the crew can’t finish a design, Milo draws it himself and says so kindly', async () => {
    await openPlace('plot-birch');
    // The fake crew stumbles on anything that mentions failing: first when asked for ideas...
    await page.locator('#panel [data-field="ask"]').fill('ideas that never fail');
    await page.locator('#panel [data-field="ask"]').press('Enter');
    await poll(async () => /^You asked “ideas that never fail”\. Codex didn’t answer, so these are my own ideas\.$/.test((await page.locator('#panel .milo-says').first().textContent()).trim()),
      'Milo to say these ideas are his own');
    assert.equal(await page.locator('#panel .idea').count(), 3);
    assert.ok((await page.locator('#panel .idea').evaluateAll(nodes => nodes.map(node => node.dataset.source))).every(source => source === 'local'));
    // ...then when asked to design.
    await page.locator('#panel [data-field="ask"]').fill('Rain barn: fails over to a dry corner in storms');
    await page.locator('#panel').getByRole('button', { name: 'Build my idea', exact: true }).click();
    const plot = (await savedState(value => value.plots?.['plot-birch']?.status === 'built')).plots['plot-birch'];
    assert.equal(plot.designedBy, 'kit');
    assert.equal(plot.blueprint.levels.length, 5, 'Milo’s own design still has its level tree');
    const said = bubble('built');
    await said.waitFor({ timeout: 10_000 });
    assert.match(await said.textContent(), /Codex didn’t answer, so I drew this one myself\./);
    await plotView('plot-birch', 'built').waitFor();
    assert.match(await page.locator('#panel .milo-says').first().textContent(), /Codex didn’t answer, so I drew this one myself\./);
    assert.match(await page.locator('#panel .building-meta').textContent(), /^Designed by Milo/);
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    await dismissBubbles();
  });

  await check('Cancel stops a design and leaves the plot as it was', async () => {
    await openPlace('plot-orchard');
    const before = await page.locator('#panel .idea-title').allTextContents();
    await page.locator('#panel .idea').first().getByRole('button', { name: /^Build this/ }).focus();
    await page.keyboard.press('Enter');
    const cancel = page.locator('#panel').getByRole('button', { name: 'Cancel', exact: true });
    await cancel.waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), 'progress', 'keyboard focus moves to the progress line, not Cancel');
    // A second Enter (a double press, or a held key) doesn't cancel what was just asked.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.match(await page.locator('#panel .progress-text').textContent(), /is drawing up plans…$/, 'still designing after a second Enter');
    assert.equal(await cancel.isEnabled(), true);
    await cancel.click();
    await plotView('plot-orchard', 'empty').waitFor({ timeout: 10_000 });
    assert.deepEqual(await page.locator('#panel .idea-title').allTextContents(), before, 'the same three ideas are still there');
    assert.equal(await page.locator('#panel [data-note="retry"]').count(), 0, 'a deliberate cancel doesn’t nag to try again');
    await bubble('note').waitFor({ timeout: 5000 });
    assert.match(await bubble('note').textContent(), /Okay, I stopped the plans/);
    // Nothing lands afterwards.
    await page.waitForTimeout(2500);
    // (While designing, the file already says 'empty' with the idea kept, in case MILO closes; a cancel drops the idea.)
    const state = await savedState(value => value.plots?.['plot-orchard']?.status === 'empty' && value.plots['plot-orchard'].idea === null);
    assert.equal(state.plots['plot-orchard'].blueprint, null);
    assert.equal(await page.locator('#panel .plot-view').getAttribute('data-plot-status'), 'empty');
    assert.equal((await page.locator('#place-list [data-place="plot-orchard"] .place-note').textContent()).trim(), 'Empty plot');
    await dismissBubbles();
  });

  await check('one request to the crew at a time', async () => {
    const replies = await page.evaluate(async () => {
      const idea = { id: 'local:tea-house', title: 'Tea house', pitch: 'A quiet spot for a daily plan.', why: '', source: 'local' };
      const first = window.milo.architect.design('plot-meadow', idea, '');
      await new Promise(resolve => setTimeout(resolve, 150));
      const second = await window.milo.architect.suggest('plot-meadow', 'anything else?');
      const third = await window.milo.architect.design('plot-meadow', idea, '');
      await window.milo.architect.cancel();
      return { first: await first, second, third, bad: await window.milo.architect.design('not-a-plot', idea, '') };
    });
    assert.deepEqual(replies.second, { ok: false, code: 'busy', error: 'Milo is already asking the crew.' });
    assert.deepEqual(replies.third, replies.second);
    assert.equal(replies.first.ok, false);
    assert.equal(replies.first.code, 'cancelled');
    assert.equal(replies.bad.ok, false, 'only real plots can be designed');
    const state = await savedState();
    assert.equal(state.plots['plot-meadow'].status, 'empty', 'a request the window never applied changes nothing');
  });

  await check('camp holds the Designer setting and each crew member’s readiness', async () => {
    await openPlace('camp');
    assert.equal(await page.locator('.skill[data-skill="tinkering"]').getAttribute('data-level'), '1', 'Tinkering level 1 is proven by the bakery');
    const options = page.locator('#panel .designer input[type="radio"]');
    assert.deepEqual(await options.evaluateAll(nodes => nodes.map(node => [node.value, node.checked])),
      [['auto', true], ['claude', false], ['codex', false], ['kit', false]]);
    assert.match(await page.locator('#panel .designer').textContent(), /Automatic.*Claude Code.*Codex.*Milo’s kit/s);
    await page.locator('#panel label[for="designer-codex"]').click();
    await savedState(value => value.settings?.designer === 'codex');
    assert.equal(await page.locator('#designer-codex').isChecked(), true);
    await page.locator('#panel label[for="designer-auto"]').click();
    await savedState(value => value.settings?.designer === 'auto');
    const status = await page.evaluate(() => window.milo.architect.status());
    assert.ok(status && typeof status.designer === 'string', 'the architect answers with who designs');
    if (status.crew?.length) {
      await poll(async () => (await page.locator('#panel .crew-ready li').count()) === status.crew.length, 'readiness for each crew member');
    }
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'camp-designer.png') });
  });

  await check('a new building is saved at once, even while Milo is still walking', async () => {
    // Milo's kit designs at once, so the building lands while Milo is on a long walk.
    // (Milo only walks while the window is on screen: a covered window pauses the world.)
    await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.moveTop(); win.focus(); });
    await openPlace('camp');
    await page.locator('#panel label[for="designer-kit"]').click();
    await savedState(value => value.settings?.designer === 'kit');
    await dismissBubbles();
    const doorOf = id => page.evaluate(async place => (await import('./src/world/map.js')).placeById(place).door, id);
    const meadow = await doorOf('plot-meadow');
    // Put Milo far from the orchard in one step: with motion off he walks there at once, so this
    // setup doesn't depend on how fast a background test window gets frames.
    await page.locator('[data-setting="motion"]').click();
    await savedState(value => value.settings.motion === false);
    await openPlace('plot-meadow');
    await savedState(value => value.milo?.tile?.x === meadow.x && value.milo.tile.y === meadow.y);
    await openPlace('camp');
    await page.locator('[data-setting="motion"]').click();
    await savedState(value => value.settings.motion === true);
    await openPlace('plot-orchard');   // 30 tiles from camp, about 6 s of walking
    await plotView('plot-orchard', 'empty').waitFor();
    await page.locator('#panel .idea').first().getByRole('button', { name: /^Build this/ }).click();
    await plotView('plot-orchard', 'built').waitFor({ timeout: 10_000 });
    const builtAt = Date.now();
    const onDisk = await savedState(value => value.plots?.['plot-orchard']?.status === 'built');
    const savedIn = Date.now() - builtAt;
    const orchard = await doorOf('plot-orchard');
    const walking = !(onDisk.milo?.tile?.x === orchard.x && onDisk.milo.tile.y === orchard.y);
    assert.ok(walking, 'Milo was still on his way when the building was saved');
    assert.ok(savedIn < 1200, `saved ${savedIn} ms after it went up`);
    await dismissBubbles();
    await openPlace('camp');
    await page.locator('#panel label[for="designer-auto"]').click();
    await savedState(value => value.settings?.designer === 'auto');
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

  await check('at 1000×700 the plot and building panels fit without sideways scrolling', async () => {
    await dismissBubbles();
    for (const [id, status] of [['plot-pond', 'built'], ['plot-meadow', 'empty']]) {
      await openPlace(id);
      await plotView(id, status).waitFor();
      await page.waitForTimeout(350);
      const report = await page.evaluate(() => {
        const rect = node => { const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }; };
        const body = document.querySelector('#panel-body');
        return {
          scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          panelOverflow: body.scrollWidth > body.clientWidth + 1,
          panel: rect(document.querySelector('#panel')),
          wide: [...body.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > body.getBoundingClientRect().right + 1).map(node => node.className || node.tagName),
        };
      });
      assert.ok(report.scroll[0] <= 1000 && report.scroll[1] <= 700, `No window overflow at ${id}: ${JSON.stringify(report.scroll)}`);
      assert.equal(report.panelOverflow, false, `The ${id} panel doesn't scroll sideways: ${report.wide.join(', ')}`);
      assert.ok(report.panel.right <= 1001 && report.panel.bottom <= 701, `The panel stays inside: ${JSON.stringify(report.panel)}`);
      await page.screenshot({ path: path.join(artifacts, `layout-1000x700-${status}.png`) });
    }
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

  await check('buildings stay standing after a restart', async () => {
    const state = await savedState(value => value.plots?.['plot-pond']?.status === 'built');
    assert.equal(state.plots['plot-pond'].blueprint.name, pondBuilding);
    assert.equal(state.plots['plot-rise'].status, 'empty', 'the cleared plot stays clear');
    const entry = page.locator('#place-list [data-place="plot-pond"]');
    assert.match(await entry.textContent(), new RegExp(escapeRegExp(pondBuilding)));
    assert.equal((await entry.locator('.place-note').textContent()).trim(), 'Pondside plot');
    await dismissBubbles();
    await openPlace('plot-pond');
    await plotView('plot-pond', 'built').waitFor();
    assert.equal((await page.locator('#panel-title').textContent()).trim(), pondBuilding);
    assert.equal(await page.locator('#panel .plan-level[data-level-state="planned"]').count(), 5);
    assert.equal(await page.locator('#panel canvas[data-art="building"]').count(), 1);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'building-after-restart.png') });
  });

  // ---------------------------------------------------------------------------
  // Phase 3: the Hearth and the Wilds (CONTRACT-PHASE3 §9 H). Motion is off for these, so every
  // arrow key is one step and walks land at once.

  let litLantern = null;
  await check('Milo walks out of the north gate into the wilds, and back in', async () => {
    await dismissBubbles();
    await openPlace('camp');
    const motion = page.locator('[data-setting="motion"]');
    if (await motion.getAttribute('aria-checked') === 'true') await motion.click();
    await savedState(value => value.settings.motion === false);
    // Every control at camp, in the crew strip and in the place list shows its ring from the keyboard.
    await assertFocusRings('#panel', 'the camp panel', { least: 6 });
    await assertFocusRings('#crew', 'the crew strip', { least: 2 });
    await assertFocusRings('#places', 'the place list', { least: 1 });
    const home = await page.evaluate(async () => (await import('./src/world/map.js')).placeById('camp').door);
    await savedState(value => value.milo?.tile?.x === home.x && value.milo.tile.y === home.y);
    await closePanelNow();
    const route = await page.evaluate(async from => (await import('./src/world/map.js')).findPath(from, { x: 32, y: 0 }), home);
    assert.ok(route.length > 0, 'a way to the north gate');
    await page.locator('canvas#world').focus();
    let at = await stepKeys(home, route);
    assert.equal((await area()) || 'vale', 'vale', 'still inside at the gap in the trees');
    at = await stepKeys(at, [{ x: 32, y: -1 }, { x: 32, y: -2 }, { x: 32, y: -3 }]);
    await poll(async () => (await area()) === 'wilds', 'Milo to be out in the wilds');
    // The shell looks places up in the engine's own world: one worldgen, its roads laid out once.
    assert.equal(await page.evaluate(() => document.documentElement.dataset.wilds), 'shared', 'the shell shares the engine’s worldgen');
    const out = await savedState(value => value.wilds?.at?.x === 32 && value.wilds.at.y === -3);
    assert.ok(out.milo.tile.y >= 0 && out.milo.tile.x >= 0, 'milo.tile stays a vale tile; the wilds go in wilds.at');
    assert.match(await page.locator('canvas#world').getAttribute('aria-label'), /^Milo's world, out in /);
    assert.doesNotMatch(await page.locator('#titlebar-status').textContent(), /^Keeping watch/);
    await openPlacesList();
    assert.match(await page.locator('#place-list').textContent(), /Travel home/, 'out here the list is what’s near, and the way home');
    await page.locator('#places-toggle').click();
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'wilds-north-gate.png') });
    await page.locator('canvas#world').focus();
    at = await stepKeys(at, [{ x: 32, y: -2 }, { x: 32, y: -1 }, { x: 32, y: 0 }, { x: 32, y: 1 }]);
    await poll(async () => (await area()) === 'vale', 'Milo to be home in the vale');
    await savedState(value => value.milo?.tile?.x === 32 && value.milo.tile.y === 1);
    assert.match(await page.locator('canvas#world').getAttribute('aria-label'), /^Milo's world\. A pixel map with Milo's camp/);
    // Without seeing the map: the vale says where its gates are, and its place list walks Milo
    // out through one (no lantern lit and no rift open yet).
    assert.match(await page.locator('canvas#world').getAttribute('aria-label'), /gates in the tree line, north, west, east and south-west, lead out to the wilds/);
    await openPlacesList();
    const gates = page.locator('#place-list [data-kind="gate"]');
    assert.deepEqual(await gates.evaluateAll(buttons => buttons.map(button => button.dataset.entity)), ['gate:n', 'gate:w', 'gate:e', 'gate:sw']);
    assert.match((await page.locator('#place-list [data-entity="gate:n"]').textContent()).replace(/\s+/g, ' '), /^North gate To the Whisperwood$/);
    await page.locator('#place-list [data-entity="gate:n"]').focus();
    await page.keyboard.press('Enter');
    await poll(async () => (await area()) === 'wilds', 'Milo to walk out of the north gate from the place list');
    await savedState(value => value.wilds?.at?.x === 32 && value.wilds.at.y === -3);
    assert.equal(await assertFocusKept('the north gate from the place list'), 'CANVAS#world', 'the arrow keys walk Milo on from there');
    at = await stepKeys({ x: 32, y: -3 }, [{ x: 32, y: -2 }, { x: 32, y: -1 }, { x: 32, y: 0 }, { x: 32, y: 1 }]);
    await poll(async () => (await area()) === 'vale', 'Milo to be home in the vale again');
    await savedState(value => value.milo?.tile?.x === 32 && value.milo.tile.y === 1);
  });

  await check('a sleeping lantern out in the wilds can be lit, rested at, and travelled home from', async () => {
    await page.locator('canvas#world').focus();
    let at = await stepKeys({ x: 32, y: 1 }, [{ x: 32, y: 0 }, { x: 32, y: -1 }]);
    await poll(async () => (await area()) === 'wilds', 'Milo to be out of the gate');
    // The nearest lantern on the old roads, and a way there, from the wilds' own modules.
    const plan = await page.evaluate(async from => {
      const content = await window.milo.content();
      const { createWorldgen } = await import('./src/world/worldgen.js');
      const { createWilds } = await import('./src/world/wilds.js');
      const { createNav } = await import('./src/world/nav.js');
      const worldgen = createWorldgen({ seed: 'hushlands', regionWords: content.riftgen.regionWords });
      const wilds = createWilds({ worldgen, maxChunks: 32 });
      const nav = createNav({ worldgen, wildBlocked: (x, y) => wilds.blocked(x, y), extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
      const lanterns = wilds.fixedPois().filter(p => p.type === 'lantern' && !p.region)
        .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
      for (const lantern of lanterns.slice(0, 4)) {
        const steps = nav.findPath(from, { x: lantern.x, y: lantern.y });
        if (steps.length && steps.length < 100) return { lantern: { id: lantern.id, x: lantern.x, y: lantern.y }, steps };
      }
      return null;
    }, at);
    assert.ok(plan, 'a lantern within walking distance of the north gate');
    at = await stepKeys(at, plan.steps);
    await savedState(value => Math.abs(value.wilds?.at?.x - plan.lantern.x) <= 6 && Math.abs(value.wilds.at.y - plan.lantern.y) <= 6);
    await dismissBubbles(1500);
    // It's in the place list now it's near; choosing it walks the last steps and opens it.
    await openPlacesList();
    const entry = page.locator(`#place-list [data-entity="${plan.lantern.id}"]`);
    await entry.waitFor({ timeout: 10_000 });
    await entry.click();
    await panel(plan.lantern.id).waitFor({ timeout: 15_000 });
    assert.match(await page.locator('#panel-title').textContent(), /lantern/i);
    assert.ok((await page.locator('#panel .wild-line').first().textContent()).trim().length > 10, 'it has something to say');
    await page.locator('#panel [data-action="light"]').click();
    await savedState(value => Number.isFinite(value.wilds?.lanterns?.[plan.lantern.id]));
    // As it catches, Milo's words and the lantern's description are two different lines.
    await page.locator('#panel .milo-says').waitFor();
    const lighting = (await page.locator('#panel .milo-says').textContent()).trim();
    const described = (await page.locator('#panel .wild-line').allTextContents()).map(text => text.trim());
    assert.ok(lighting.length > 10 && described.length >= 1, 'Milo speaks, and the lantern is described');
    assert.ok(!described.includes(lighting), `the panel never says the same thing twice (${lighting})`);
    await page.locator('#panel [data-action="rest"]').click();
    await savedState(value => value.wilds?.wake === plan.lantern.id);
    assert.equal(await page.locator('#panel [data-action="rest"]').isDisabled(), true, 'Milo is resting here now');
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    assert.doesNotMatch(await page.locator('#panel .milo-says, #panel .setting-hint').allTextContents().then(t => t.join(' ')), /wake/i, 'resting promises nothing the game doesn’t do');
    // Home always leads the travel list, so the lantern he rests at comes right after it.
    assert.match(await page.locator('#panel [data-group="actions"] .setting-hint').textContent(), /right after home on his travel lists/);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'lantern-lit.png') });
    await assertFocusRings('#panel', 'the lantern panel', { least: 2 });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
    await page.waitForTimeout(400);
    await fitsAt1000('#panel', 'a lantern panel');
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700-lantern.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280);
    litLantern = plan.lantern;
    // A tree nearby: choosing it walks Milo over, he chops it, and the logs go in the satchel.
    const logs = materials => (materials?.birch || 0) + (materials?.ash || 0) + (materials?.pine || 0);
    const before = await savedState();
    await openPlacesList();
    const tree = page.locator('#place-list [data-entity^="tree:"]').first();
    await tree.waitFor({ timeout: 10_000 });
    const treeId = await tree.getAttribute('data-entity');
    await tree.click();
    const chopped = await savedState(value => Number.isFinite(value.wilds?.felled?.[treeId]));
    const gained = logs(chopped.satchel.materials) - logs(before.satchel.materials);
    assert.ok(gained >= 2 && gained <= 7, `a tree gives 2 to 7 logs (${gained})`);
    await dismissBubbles(1500);
    // Its panel opened from the place list, by the keyboard, then Travel home from it: the list
    // entry it came from goes with the wilds, and focus lands on the world, never the page's body.
    await closePanelNow();
    await openPlacesList();
    const again = page.locator(`#place-list [data-entity="${plan.lantern.id}"]`);
    await again.waitFor({ timeout: 10_000 });
    await again.focus();
    await page.keyboard.press('Enter');
    await panel(plan.lantern.id).waitFor({ timeout: 15_000 });
    await page.locator('#panel [data-action="travel"][data-target="home"]').focus();
    await page.keyboard.press('Enter');
    await poll(async () => (await area()) === 'vale', 'Milo to travel home', 20_000);
    await assertFocusKept('Travel home from a lantern’s panel');
  });

  const capacityRow = () => page.locator('#panel [data-group="rifts"] .rift-row[data-real-kind="capacity"]');
  const knockRow = () => page.locator('#panel [data-group="rifts"] .rift-row[data-real-kind="knocking"]');

  await check('real rifts open on the frontier from their real signals, each naming its cause, never in the ward or the vale', async () => {
    await dismissBubbles();
    const sleeper = spawnSleeper();
    await seedKnock(sleeper.pid);
    await writeCodexReading(91);
    const snapshot = await waitForScanWhere(value => value.capacity?.codex?.usedPercent === 91
      && value.sessions.some(session => session.id === `claude:${KNOCK_ID}` && session.status === 'needs-you'), 'the Codex reading and the waiting session');
    assert.ok(snapshot.sessions.find(session => session.id === `claude:${KNOCK_ID}`).waitingSince <= Date.now() - 24 * HOUR);
    await openPlace('watchtower');
    await capacityRow().waitFor({ timeout: 15_000 });
    await knockRow().waitFor({ timeout: 15_000 });
    assert.match(await capacityRow().locator('.rift-cause').textContent(), /^Codex has used 91% of its weekly allowance\. It refills (today|tomorrow|on \w+) at \d\d:\d\d\.$/);
    assert.equal((await knockRow().locator('.rift-cause').textContent()).trim(), `“${KNOCK_TITLE}” has waited on you for 25 hours.`);
    assert.match(await capacityRow().locator('.rift-meta').textContent(), /^\d+ tiles out, toward Cinderforge$/);
    // Where each one stands: out past the Hearthward, never in the vale.
    const spots = await page.locator('#panel [data-group="rifts"] .rift-row[data-x]').evaluateAll(rows => rows.map(row => ({ id: row.dataset.riftId, x: Number(row.dataset.x), y: Number(row.dataset.y) })));
    assert.ok(spots.length >= 2, `rift rows carry their tiles: ${JSON.stringify(spots)}`);
    const checked = await page.evaluate(async list => {
      const content = await window.milo.content();
      const saved = await window.milo.loadState();
      const { createWorldgen } = await import('./src/world/worldgen.js');
      const { wardRadius } = await import('./src/hearth.js');
      const worldgen = createWorldgen({ seed: saved.wilds.seed, regionWords: content.riftgen.regionWords });
      const ward = wardRadius(saved, content.fortress);
      return list.map(spot => ({ ...spot, inHeart: worldgen.inHeart(spot.x, spot.y), beyond: worldgen.heartDistance(spot.x, spot.y) - ward }));
    }, spots);
    for (const spot of checked) {
      assert.equal(spot.inHeart, false, `${spot.id} is not in the vale`);
      assert.ok(spot.beyond > 0, `${spot.id} is outside the ward (${spot.beyond})`);
    }
    await savedState(value => Object.keys(value.rifts?.open || {}).some(key => key.startsWith('capacity:codex:')) && value.rifts.open[`knock:claude:${KNOCK_ID}`]);
    // A rift names the real cause, and never a word from a transcript.
    const rows = await page.locator('#panel [data-group="rifts"]').textContent();
    for (const secret of ['Draft replies', 'Which letter', 'Chart the tide']) assert.ok(!rows.includes(secret), `${secret} stays in its transcript`);
    assert.doesNotMatch(rows, /!/);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'watchtower-rifts.png') });
    await assertFocusRings('#panel', 'the watchtower with its rifts', { least: 5 });
    await dismissBubbles();
  });

  await check('a row’s Let go asks first, and Escape or Keep it hands focus back to that row', async () => {
    const riftId = await capacityRow().getAttribute('data-rift-id');
    for (const how of ['Escape', 'Keep it']) {
      await capacityRow().locator('[data-action="rift-let-go"]').click();
      await capacityRow().locator('.confirm[role="alertdialog"]').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'rift-let-go-cancel', 'Keep it is the safe default');
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await capacityRow().locator('[data-action="rift-let-go-cancel"]').click();
      await poll(async () => (await page.locator('#panel .confirm').count()) === 0, `${how} to step back out of letting go`);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), `let-go-${riftId}`, `after ${how}, focus is back on the row’s Let go`);
      assert.equal(await page.locator('#panel').isVisible(), true, 'the watchtower stays open');
    }
    assert.equal(await capacityRow().count(), 1, 'nothing was let go');
  });

  await check('warding a rift holds it for three days, and the ward is saved', async () => {
    await capacityRow().locator('[data-action="rift-ward"]').click();
    const saved = await savedState(value => Object.keys(value.rifts?.warded || {}).some(key => key.startsWith('capacity:codex:')));
    const [, ward] = Object.entries(saved.rifts.warded).find(([key]) => key.startsWith('capacity:'));
    const days = (ward.until - Date.now()) / DAY;
    assert.ok(days > 2.9 && days <= 3.01, `three days (${days.toFixed(2)})`);
    await poll(async () => (await capacityRow().getAttribute('data-warded')) === 'true', 'the row to show its ward');
    assert.equal(await capacityRow().locator('[data-action="rift-unward"]').count(), 1);
    // The ward holds it at the stage it had: that stage, then the ward, in plain words.
    assert.match(await capacityRow().locator('.stage-tag').textContent(), /^(Hairline|Open|Gaping) · warded$/);
  });

  await check('a rift’s panel says why and how to mend it, and Milo can step through into its Elsewhere and come home', async () => {
    const riftId = await capacityRow().getAttribute('data-rift-id');
    await capacityRow().locator('[data-action="rift-open"]').click();
    await panel(riftId).waitFor();
    assert.match(await page.locator('#panel [data-section="why"]').textContent(), /Codex has used 91%/);
    assert.match(await page.locator('#panel [data-section="mend"]').textContent(), /Give Codex a rest, or wait for the refill\./);
    assert.ok(await page.locator('#panel .rift-tags .genre-chip').count() >= 1);
    // Its tags: the stage the ward holds, and what real thing it stands for.
    assert.match(await page.locator('#panel .rift-tags .stage-tag').textContent(), /^(Hairline|Open|Gaping) · warded$/);
    assert.equal((await page.locator('#panel .rift-tags .kind-tag').textContent()).trim(), 'Crew capacity');
    assert.equal(await page.locator('#panel [data-action="rift-unward"]').count(), 1);
    assert.equal(await page.locator('#panel [data-action="rift-let-go"]').count(), 1);
    // Every rift panel names its Tale-lead and says where it is (it steps out once the rift gapes).
    const lead = page.locator('#panel [data-section="lead"]');
    assert.equal(await lead.count(), 1, 'the Tale-lead is named');
    assert.match(await lead.getAttribute('data-lead'), /^(waiting|out)$/);
    assert.ok((await lead.locator('strong').textContent()).trim().length > 2, 'by name');
    const art = await page.evaluate(() => {
      const canvas = document.querySelector('#panel canvas[data-scene="rift"]');
      return canvas ? { width: canvas.width, pixel: Number(canvas.dataset.pixel), label: canvas.getAttribute('aria-label') } : null;
    });
    assert.ok(art && art.width >= 100 && art.pixel >= 1, `the tear is drawn: ${JSON.stringify(art)}`);
    // Let go asks first, and Keep it is the safe default.
    await page.locator('#panel [data-action="rift-let-go"]').click();
    await page.locator('#panel .confirm[role="alertdialog"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'rift-let-go-cancel');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#panel .confirm').count(), 0, 'Escape steps back out of letting go');
    assert.equal(await page.locator('#panel').isVisible(), true);
    const reached = await assertFocusRings('#panel', 'a rift panel', { least: 4 });
    assert.deepEqual(reached.slice(-3), ['panel-step', 'panel-unward', 'panel-let-go'], 'Tab reaches each of its actions');
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'rift-panel.png') });
    await page.locator('#panel [data-action="rift-step"]').click();
    await poll(async () => (await area()) === 'elsewhere', 'Milo to step through into the Elsewhere', 30_000);
    const banner = page.locator('#elsewhere-banner');
    await banner.waitFor();
    assert.match(await banner.textContent(), /Inside/);
    assert.match(await page.locator('#titlebar-status').textContent(), /^Inside /);
    assert.doesNotMatch(await page.locator('#titlebar-status').textContent(), /^Inside The /, 'a name mid-sentence reads “the …”');
    assert.match(await page.locator('canvas#world').getAttribute('aria-label'), /inside/i);
    assert.doesNotMatch(await page.locator('canvas#world').getAttribute('aria-label'), /inside The /);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'elsewhere.png') });
    // Another rift's panel, reached from inside (a crew chip, then the watchtower): no way there
    // from a pocket world, so it offers Leave first, and after leaving it offers Step through.
    await page.locator('#crew .crew-chip[data-crew="claude"]').click();
    await panel('watchtower').waitFor();
    const knockId = await knockRow().getAttribute('data-rift-id');
    await knockRow().locator('[data-action="rift-open"]').click();
    await panel(knockId).waitFor();
    assert.equal(await page.locator('#panel [data-action="rift-step"]').count(), 0, 'no Step through from inside another rift');
    assert.equal(await page.locator('#panel [data-action="rift-leave"]').count(), 1, 'Leave comes first');
    assert.match(await page.locator('#panel .milo-says').textContent(), /Leave it first/);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'rift-panel-from-elsewhere.png') });
    await page.locator('#panel [data-action="rift-leave"]').click();
    await poll(async () => (await area()) === 'wilds', 'Milo to come back out of the rift', 20_000);
    assert.equal(await banner.isVisible(), false);
    await page.locator(`#panel[data-place="${knockId}"] [data-action="rift-step"]`).waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('#panel [data-action="rift-leave"]').count(), 0);
    await closePanelNow();
    await travelHome();
  });

  await check('Oriel’s letter opens a crack past the north gate; stitching it in its Elsewhere moves the Prologue on', async () => {
    await dismissBubbles();
    const tracker = page.locator('#tracker');
    await assertFocusRings('#tracker', 'the story card', { least: 3 });
    assert.equal((await tracker.locator('.tracker-title').textContent()).trim(), 'A Letter by Paper Bird');
    await tracker.locator('[data-action="letter-read"]').click();
    await panel('story').waitFor();
    await page.locator('#panel .letter-section blockquote').waitFor();
    await savedState(value => Number.isFinite(value.story?.letterReadAt));
    await dismissBubbles();
    await openPlace('watchtower');
    const crack = page.locator('#panel [data-group="rifts"] .rift-row[data-rift-kind="story"]');
    await crack.waitFor({ timeout: 15_000 });
    assert.match(await crack.locator('.rift-meta').textContent(), /past the north gate$/);
    assert.equal(await crack.locator('[data-action="rift-let-go"]').count(), 0, 'the story’s crack can’t be let go');
    await crack.locator('[data-action="rift-open"]').click();
    await page.locator('#panel [data-action="rift-step"]').click();
    await poll(async () => (await area()) === 'elsewhere', 'Milo to step into the crack', 30_000);
    // Inside, the seam is listed wherever it is, and walking to it opens the rift with Stitch.
    await openPlacesList();
    await page.locator('#place-list [data-entity="stitch"]').click();
    await settleFights();
    const stitch = page.locator('#panel [data-action="rift-stitch"]');
    await stitch.waitFor({ timeout: 15_000 });
    // In here, Milo has already stepped through: what's left is the seam.
    assert.equal((await page.locator('#panel [data-section="mend"] .rift-text').textContent()).trim(), 'Stitch the seam from in here.');
    // At 1000×700, the banner and the rift's panel both fit, and the panel never covers Leave.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
    await page.waitForTimeout(400);
    await fitsAt1000('#panel', 'a rift panel inside its Elsewhere');
    await fitsAt1000('#elsewhere-banner', 'the Elsewhere banner');
    const leaveFree = await page.evaluate(() => {
      const leave = document.querySelector('#elsewhere-banner [data-action="leave-elsewhere"]');
      const box = leave.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (hit && leave.contains(hit) && box.width > 0) return true;
      return `covered by ${hit ? `${hit.tagName}#${hit.id}.${hit.className}` : 'nothing'} at ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}×${Math.round(box.height)}`;
    });
    assert.ok(leaveFree === true, `Leave stays in the open with a panel beside it (${leaveFree})`);
    await assertFocusRings('#elsewhere-banner', 'the Elsewhere banner');
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700-elsewhere.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280);
    await stitch.click();
    const mended = await savedState(value => Number.isFinite(value.story?.prologue?.done?.['first-crack']));
    assert.equal(mended.rifts.stitched.story, 1);
    // Mended: nothing is left to mend, so the panel no longer asks for it.
    await poll(async () => /^Mended\./.test((await page.locator('#panel .milo-says').textContent()).trim()), 'the panel to say it’s mended');
    assert.equal(await page.locator('#panel [data-section="mend"]').count(), 0, 'no “To mend it” once it’s mended');
    // The lantern lit earlier counts at once, so the story moves on to the Stockade.
    await poll(async () => (await tracker.locator('.tracker-title').textContent()).trim() === 'Walls of Birch and Ash', 'the story card to move on');
    assert.ok(Number.isFinite((await savedState(value => Number.isFinite(value.story?.prologue?.done?.lantern))).story.prologue.done.lantern));
    // Out by the place list's Leave, from the keyboard: that entry goes with the Elsewhere, and
    // focus lands on the world rather than the page's body.
    await dismissBubbles();
    await openPlacesList();
    await page.locator('#place-list [data-entity="leave"]').focus();
    await page.keyboard.press('Enter');
    await poll(async () => (await area()) === 'wilds', 'Milo to come back out of the crack', 20_000);
    assert.equal(await assertFocusKept('Leave from the place list'), 'CANVAS#world');
    await dismissBubbles();
    await travelHome();
  });

  await check('the Hearth panel shows real counts', async () => {
    await dismissBubbles();
    await openPlace('hearth');
    const saved = await savedState();
    for (const [kind, have] of [['crew-sessions-finished', saved.tally.sessionsFinished], ['buildings-designed', saved.tally.buildingsDesigned], ['days-with-milo', saved.tally.daysSeen]]) {
      assert.equal(await page.locator(`#panel [data-req="${kind}"]`).getAttribute('data-have'), String(have), `${kind} reads the real count`);
    }
    assert.ok(saved.tally.buildingsDesigned >= 3, `every first design was counted (${saved.tally.buildingsDesigned})`);
    assert.ok(saved.tally.sessionsFinished >= 1, 'sessions MILO watched finish were counted');
    // A met requirement reads Done with its check, never '4 of 1'; no row counts past its need.
    const designed = page.locator('#panel [data-req="buildings-designed"]');
    assert.equal(await designed.getAttribute('data-level-state'), 'proven');
    assert.equal((await designed.locator('.level-tag').textContent()).trim(), 'Done');
    assert.equal(await designed.locator('.tick-check').count(), 1);
    for (const tag of await page.locator('#panel .levels .level-tag').allTextContents()) {
      const count = /^(\d+) of (\d+)$/.exec(tag.trim());
      if (count) assert.ok(Number(count[1]) <= Number(count[2]), `no row counts past its need: ${tag.trim()}`);
    }
    assert.doesNotMatch(await page.locator('#panel').textContent(), /Phase \d/, 'no build phases in the game’s words');
    assert.equal(await page.locator('#panel .mats [data-material="birch"]').getAttribute('data-need'), '80');
    assert.equal(await page.locator('#panel .mats [data-material="ash"]').getAttribute('data-need'), '30');
    assert.equal(await page.locator('#panel [data-action="raise"]').count(), 0, 'the Stockade isn’t ready yet');
    assert.match(await page.locator('#panel [data-note="not-ready"]').textContent(), /^Not yet\. Still to do: /);
    assert.equal(await page.locator('#panel canvas[data-scene="hearth"]').count(), 1);
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'hearth.png') });
    await assertFocusRings('#panel', 'the Hearth panel', { least: 2 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(artifacts, 'hearth-end.png') });
    await page.locator('#panel-body').evaluate(body => { body.scrollTop = 0; });
  });

  await check('at 1000×700 the Hearth, the rift list and panel, the Prologue and the map fit without sideways scrolling', async () => {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
    await page.waitForTimeout(400);
    await fitsAt1000('#panel', 'the Hearth panel');
    await openPlace('watchtower');
    await knockRow().waitFor();
    await page.waitForTimeout(300);
    await fitsAt1000('#panel', 'the watchtower with its rifts');
    const knockId = await knockRow().getAttribute('data-rift-id');
    await knockRow().locator('[data-action="rift-open"]').click();
    await panel(knockId).waitFor();
    await page.waitForTimeout(350);
    await fitsAt1000('#panel', 'a rift panel');
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700-rift.png') });
    await page.locator('#tracker [data-action="tracker-open"]').click();
    await panel('story').waitFor();
    await page.waitForTimeout(350);
    await fitsAt1000('#panel', 'the Prologue');
    await fitsAt1000('#tracker', 'the story card');
    await closePanelNow();
    await page.locator('canvas#world').focus();
    await page.keyboard.press('m');
    await page.locator('#map-view').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await fitsAt1000('#map-view', 'the map');
    await assertFocusRings('#map-view', 'the map', { least: 5 });
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700-map.png') });
    await page.keyboard.press('Escape');
    await page.locator('#map-view').waitFor({ state: 'hidden' });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280);
  });

  await check('a rift seals itself once its real signal clears', async () => {
    await writeCodexReading(20);
    for (const child of sleepers) { try { child.kill(); } catch { /* gone */ } }
    await waitForScanWhere(value => value.capacity?.codex?.usedPercent === 20
      && !value.sessions.some(session => session.id === `claude:${KNOCK_ID}` && session.status === 'needs-you'), 'the reading to fall and the waiting session to end');
    const saved = await savedState(value => (value.rifts?.history || []).some(entry => entry.key?.startsWith('capacity:codex:') && entry.how === 'sealed')
      && value.rifts.history.some(entry => entry.key === `knock:claude:${KNOCK_ID}` && entry.how === 'sealed'));
    assert.ok(saved.rifts.stitched.real >= 2, 'both count as mended');
    assert.equal(Object.keys(saved.rifts.open).filter(key => key.startsWith('capacity:') || key.startsWith('knock:')).length, 0);
    // The ward's mark may stay until it lapses, but it belonged to the episode that just sealed.
    for (const [key, ward] of Object.entries(saved.rifts.warded).filter(([key]) => key.startsWith('capacity:'))) {
      const closed = saved.rifts.history.find(entry => entry.key === key && entry.how === 'sealed');
      assert.ok(closed && closed.closedAt >= ward.since, 'a leftover ward belongs to the sealed episode');
    }
    await openPlace('watchtower');
    await poll(async () => (await capacityRow().count()) === 0 && (await knockRow().count()) === 0, 'the rows to go');
    const sealed = bubble('sealed');
    await sealed.waitFor({ timeout: 10_000 });
    assert.match(await sealed.textContent(), /sealed/);
    assert.doesNotMatch(await sealed.textContent(), /!/);
    await dismissBubbles();
  });

  // MILO's clock reads 03:00 for these relaunches: five hours past the evening bell.
  const night = new Date();
  night.setHours(3, 0, 0, 0);
  if (night.getTime() <= Date.now() + HOUR) night.setDate(night.getDate() + 1);
  const rung = () => application.evaluate(() => globalThis.__miloNotifyDecisions.filter(entry => entry.title === 'A rift is at the walls'));

  await check('past the evening bell a Nocturne opens, and at the Camp it rings as Milo’s bubble alone', async () => {
    await close();
    const stateFile = path.join(dataDirectory, 'state.json');
    const onDisk = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(onDisk.hearth?.tier ?? 1, 1, 'still the Camp');
    await writeFile(stateFile, JSON.stringify({
      ...onDisk, settings: { ...onDisk.settings, eveningBell: '22:00', gateBell: true, wardPost: null, notifications: true },
    }, null, 2), 'utf8');
    // The live session is busy again.
    await appendFile(liveTranscript, jsonl([userTurn(LIVE_ID, LIVE_CWD, Date.now(), 'One more row of lanterns by the gate.')]), 'utf8');
    await writeRegistry(liveRegistry, process.pid, LIVE_ID, LIVE_CWD, LIVE_TITLE, 'busy', liveExtra());
    await launch(repo, { MILO_NOW: night.toISOString() });
    // Through the greeting to the bell: a bubble, and no desktop note at tier 1.
    const bell = bubble('bell');
    await poll(async () => {
      if (await bell.isVisible()) return true;
      if (await page.locator('#bubble').isVisible()) {
        const buttons = page.locator('#bubble [data-bubble-action]');
        const count = await buttons.count();
        if (count) await buttons.nth(count - 1).click({ timeout: 1000 }).catch(() => {});
      }
      return false;
    }, 'the tier-1 bell’s bubble', 30_000);
    assert.equal((await bell.locator('.bubble-title').textContent()).trim(), 'A rift is at the walls');
    assert.match(await bell.textContent(), /evening bell/);
    assert.doesNotMatch(await bell.textContent(), /!/);
    const saved = await savedState(value => Object.keys(value.rifts?.belled || {}).some(key => key.startsWith('night:')));
    assert.ok(Object.keys(saved.rifts.open).some(key => key.startsWith('night:')), 'the Nocturne is open');
    assert.deepEqual(await rung(), [], 'no Gate Bell note is even asked for before the Stockade');
    assert.equal((await application.evaluate(() => globalThis.__miloNotifications.filter(toast => toast.title === 'A rift is at the walls'))).length, 0);
    await dismissBubbles();
  });

  await check('with the Stockade up the Gate Bell rings once, its own switch deciding the note even with Alerts off', async () => {
    await close();
    const stateFile = path.join(dataDirectory, 'state.json');
    const onDisk = JSON.parse(await readFile(stateFile, 'utf8'));
    // The Stockade is up, Alerts are off, and tonight's bell is forgotten, so it rings again.
    const belled = Object.fromEntries(Object.entries(onDisk.rifts?.belled || {}).filter(([key]) => !key.startsWith('night:')));
    await writeFile(stateFile, JSON.stringify({
      ...onDisk, hearth: { ...onDisk.hearth, tier: 2 }, rifts: { ...onDisk.rifts, belled },
      settings: { ...onDisk.settings, eveningBell: '22:00', gateBell: true, wardPost: null, notifications: false },
    }, null, 2), 'utf8');
    await launch(repo, { MILO_NOW: night.toISOString() });
    await poll(async () => (await rung()).length >= 1, 'the Gate Bell to ring', 30_000);
    assert.equal((await rung())[0].kind, 'gate-bell');
    // More passes of the rift loop (every snapshot runs one) don't ring it again.
    const base = await scan();
    for (let i = 1; i <= 2; i += 1) {
      await application.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', next), { ...base, scannedAt: base.scannedAt + i * 1000 });
      await page.waitForTimeout(500);
    }
    assert.equal((await rung()).length, 1, 'the Gate Bell rings once');
    const [decision] = await rung();
    const toasts = await application.evaluate(() => globalThis.__miloNotifications.filter(toast => toast.title === 'A rift is at the walls'));
    if (decision.focused) assert.equal(toasts.length, 0, 'no desktop note while MILO has focus');
    else assert.equal(toasts.length, 1, 'one desktop note while MILO is in the background');
    const saved = await savedState(value => Object.keys(value.rifts?.belled || {}).some(key => key.startsWith('night:')));
    assert.ok(Object.keys(saved.rifts.open).some(key => key.startsWith('night:')), 'the Nocturne is open');
    await dismissBubbles();
  });

  await check('the War Table lists every rift with its real cause, and holds the defences', async () => {
    await openPlacesList();
    assert.equal(await page.locator('#place-list [data-place="war-table"]').count(), 1, 'the War Table stands with the Stockade');
    await openPlace('war-table');
    const walls = page.locator('#panel [data-group="walls"] .rift-row[data-real-kind="nocturne"]');
    await walls.waitFor({ timeout: 15_000 });
    assert.match(await walls.locator('.rift-cause').textContent(), /^Claude was still working at 0[2-4]:\d\d, past your evening bell \(22:00\)\.$/);
    assert.ok(await page.locator('#panel [data-group="bright"] .rift-row').count() >= 1, 'new buildings shine as bright rifts');
    assert.ok(await page.locator('#panel [data-group="closed"] .rift-row').count() >= 2, 'the sealed rifts are recently closed');
    assert.equal(await page.locator('#panel canvas[data-scene="war-map"]').count(), 1);
    await page.locator('#panel label[for="ward-post-patient-knock"]').click();
    await savedState(value => value.settings.wardPost === 'patient-knock');
    await page.locator('#panel #evening-bell').selectOption('23:00');
    await savedState(value => value.settings.eveningBell === '23:00');
    await page.locator('#panel #evening-bell').selectOption('');
    // With the bell off, tonight's Nocturne closes quietly: never a seal, and Milo says why.
    const nightOff = await savedState(value => value.settings.eveningBell === null && !Object.keys(value.rifts?.open || {}).some(key => key.startsWith('night:')));
    assert.equal(nightOff.rifts.history.find(entry => entry.key?.startsWith('night:'))?.how, 'closed', 'closed, not sealed');
    await poll(async () => {
      if (!(await page.locator('#bubble').isVisible())) return false;
      if (/With the bell off, tonight’s Nocturne closes quietly\./.test(await page.locator('#bubble').textContent())) return true;
      const buttons = page.locator('#bubble [data-bubble-action]');
      const count = await buttons.count();
      if (count) await buttons.nth(count - 1).click({ timeout: 1000 }).catch(() => {});
      return false;
    }, 'Milo to say the Nocturne closed quietly', 15_000);
    assert.equal(await bubble('rift').isVisible(), true);
    assert.equal(await page.locator('#panel [data-group="walls"] .rift-row[data-real-kind="nocturne"]').count(), 0);
    await page.locator('#panel #evening-bell').selectOption('22:00');
    await savedState(value => value.settings.eveningBell === '22:00' && Object.keys(value.rifts?.open || {}).some(key => key.startsWith('night:')));
    await dismissBubbles();
    await page.locator('#panel label[for="ward-post-none"]').click();
    await savedState(value => value.settings.wardPost === null);
    // A background refresh (a snapshot, the rift loop) with nothing new to show leaves the panel's
    // dropdown in place, so a list Chris has open never closes under him.
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__bellSelect = document.querySelector('#panel #evening-bell'); window.__bellSelect.focus(); });
    const latest = await scan();
    for (let i = 1; i <= 2; i += 1) {
      await application.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', next), { ...latest, scannedAt: latest.scannedAt + 60_000 + i * 1000 });
      await page.waitForTimeout(400);
    }
    assert.equal(await page.evaluate(() => window.__bellSelect.isConnected && document.activeElement === window.__bellSelect), true, 'the evening bell’s dropdown stays put through snapshots');
    // News that does change the table (a capacity rift opening) waits while the dropdown is in
    // hand, and shows as soon as Chris is done with it.
    const resetsAt = latest.scannedAt + 2 * DAY;
    const pressing = { ...latest, scannedAt: latest.scannedAt + 90_000, capacity: { codex: { usedPercent: 92, resetsAt, windowMinutes: 10080, at: latest.scannedAt } } };
    await application.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', next), pressing);
    await savedState(value => Boolean(value.rifts?.open?.[`capacity:codex:${resetsAt}`]));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__bellSelect.isConnected && document.activeElement === window.__bellSelect), true, 'the dropdown stays in hand while news waits');
    assert.equal(await page.locator('#panel .rift-row[data-real-kind="capacity"]').count(), 0, 'the new row waits too');
    await page.locator('#panel-title').focus();
    await page.locator('#panel .rift-row[data-real-kind="capacity"]').waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__bellSelect.isConnected), false, 'then the table catches up');
    // The reading falls back, and the rift seals.
    await application.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', next), { ...latest, scannedAt: latest.scannedAt + 120_000 });
    await savedState(value => !value.rifts?.open?.[`capacity:codex:${resetsAt}`]);
    await dismissBubbles();
    const gateBell = page.locator('#panel [data-setting="gateBell"]');
    assert.equal(await gateBell.getAttribute('aria-checked'), 'true');
    await gateBell.click();
    await savedState(value => value.settings.gateBell === false);
    await page.locator('#panel [data-setting="gateBell"]').click();
    await savedState(value => value.settings.gateBell === true);
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(artifacts, 'war-table.png') });
    await assertFocusRings('#panel', 'the War Table', { least: 8 });
    await page.locator('#panel-body').evaluate(body => { body.scrollTop = 0; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(artifacts, 'war-table-top.png') });
    // The frontier map fills its frame edge to edge with land and water (no flat bars either
    // side), at a whole number of pixels a tile.
    const mapFill = async () => {
      await poll(() => page.evaluate(() => Boolean(document.querySelector('#panel canvas[data-scene="war-map"]')?.dataset.pixel)), 'the frontier map to be painted');
      const fill = await page.evaluate(() => {
        const canvas = document.querySelector('#panel canvas[data-scene="war-map"]');
        const frame = canvas.parentElement.getBoundingClientRect();
        const box = canvas.getBoundingClientRect();
        return { frame: frame.width, left: box.left - frame.left, right: frame.right - box.right, pixel: Number(canvas.dataset.pixel) };
      });
      assert.ok(fill.left <= 0.5 && fill.right <= 0.5, `the map fills its frame: ${JSON.stringify(fill)}`);
      assert.ok(Number.isInteger(fill.pixel) && fill.pixel >= 1, `whole pixels: ${fill.pixel}`);
    };
    await mapFill();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
    await page.waitForTimeout(500);
    await fitsAt1000('#panel', 'the War Table');
    await mapFill();
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700-war-table.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280);
  });

  await check('a bright rift is visited, not let go, and leaves its gifts once', async () => {
    // A building finished this week shines out on the frontier. Visit walks Milo out to it.
    const brightRow = page.locator('#panel [data-group="bright"] .rift-row').first();
    const brightId = await brightRow.getAttribute('data-rift-id');
    await brightRow.locator('[data-action="rift-open"]').click();
    await panel(brightId).waitFor();
    assert.equal(await page.locator('#panel [data-action="rift-let-go"]').count(), 0, 'a bright rift can’t be let go');
    assert.equal(await page.locator('#panel [data-action="rift-let-be"]').count(), 1, 'only let be');
    assert.equal(await page.locator('#panel [data-section="lead"]').count(), 1, 'its Tale-lead is named');
    await page.locator('#panel [data-action="rift-visit"]').click();
    await savedState(value => Number.isFinite(value.rifts?.visited?.[brightId]));
    const says = page.locator('#panel .milo-says');
    await poll(async () => /in your satchel|brighter for the visit/.test(await says.textContent()), 'Milo to say what the visit left', 20_000);
    assert.equal(await area(), 'wilds', 'Milo walked out to it');
    // A second visit is welcome, and gives nothing more.
    await page.locator('#panel [data-action="rift-visit"]').click();
    await poll(async () => /visited already/.test(await says.textContent()), 'Milo to say he has been already');
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    // What it leaves is in the satchel now, and the panel says so.
    if (await page.locator('#panel [data-section="loot"]').count()) {
      assert.equal(await page.locator('#panel [data-section="loot"]').getAttribute('data-taken'), 'true');
    }
    await closePanelNow();
    await dismissBubbles();
    await travelHome();
  });

  await check('a rift that seals while Milo walks out to it is never stepped into, and its panel says it closed', async () => {
    await dismissBubbles();
    // Motion on for this one, so the walk out takes a while.
    await openPlace('camp');
    const motion = page.locator('[data-setting="motion"]');
    if (await motion.getAttribute('aria-checked') !== 'true') await motion.click();
    await savedState(value => value.settings.motion === true);
    await closePanelNow();
    const send = next => application.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('milo:snapshot', value), next);
    const latest = await scan();
    // A window of its own, days from any other the state knows (a refill within minutes of one
    // it knows would be read as that same window).
    const resetsAt = latest.scannedAt + 5 * DAY + 11 * HOUR;
    const key = `capacity:codex:${resetsAt}`;
    await send({ ...latest, scannedAt: latest.scannedAt + 60_000, capacity: { codex: { usedPercent: 93, resetsAt, windowMinutes: 10080, at: latest.scannedAt } } });
    await savedState(value => Boolean(value.rifts?.open?.[key]));
    await dismissBubbles();
    await openPlace('war-table');
    const row = page.locator('#panel .rift-row[data-real-kind="capacity"]');
    await row.waitFor({ timeout: 10_000 });
    const riftId = await row.getAttribute('data-rift-id');
    await row.locator('[data-action="rift-open"]').click();
    await panel(riftId).waitFor();
    await page.locator('#panel [data-action="rift-step"]').click();
    await poll(async () => /sets off/.test(await page.locator('#panel .milo-says').textContent().catch(() => '')), 'Milo to set off');
    // On the way, the real thing clears: the rift seals.
    await send({ ...latest, scannedAt: latest.scannedAt + 120_000 });
    await savedState(value => !value.rifts?.open?.[key]);
    await poll(async () => /This rift has closed/.test(await page.locator(`#panel[data-place="${riftId}"] .milo-says`).textContent().catch(() => '')), 'the panel to say the rift closed, not that he sets off', 10_000);
    assert.equal(await page.locator('#panel [data-action="rift-step"]').count(), 0, 'nothing to step into');
    // He walks on to where it stood, stops, and steps into nothing.
    await poll(async () => (await area()) !== 'vale', 'Milo to be out past the walls', 30_000);
    await poll(async () => {
      const first = (await page.evaluate(() => window.milo.loadState())).wilds?.at;
      await page.waitForTimeout(1800);
      const second = (await page.evaluate(() => window.milo.loadState())).wilds?.at;
      return first && second && first.x === second.x && first.y === second.y;
    }, 'Milo to stop where the rift stood', 40_000);
    await page.waitForTimeout(2500);
    assert.notEqual(await area(), 'elsewhere', 'no Elsewhere behind a sealed rift');
    assert.equal(await page.locator('#elsewhere-banner').isVisible(), false);
    if (await page.locator(`#panel[data-place="${riftId}"]`).count()) {
      assert.match(await page.locator('#panel .milo-says').textContent(), /This rift has closed/);
    }
    await closePanelNow();
    await dismissBubbles();
    await travelHome();
    await openPlace('camp');
    await page.locator('[data-setting="motion"]').click();
    await savedState(value => value.settings.motion === false);
    await closePanelNow();
    await dismissBubbles();
  });

  await check('a lit lantern is still lit after a restart, and the map travels Milo to it', async () => {
    assert.ok(litLantern, 'a lantern was lit earlier');
    const saved = await savedState(value => Number.isFinite(value.wilds?.lanterns?.[litLantern.id]));
    assert.equal(saved.wilds.wake, litLantern.id);
    await page.locator('canvas#world').focus();
    await page.keyboard.press('m');
    await page.locator('#map-view').waitFor({ state: 'visible' });
    await page.locator(`#map-view [data-marker="${litLantern.id}"]`).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(artifacts, 'map.png') });
    // Its button in the travel list asks first, then takes Milo there with a calm fade.
    await page.locator(`#map-view .map-travel [data-marker="${litLantern.id}"]`).click();
    await page.locator('#map-view .map-ask-go').click();
    await page.locator('#map-view').waitFor({ state: 'hidden' });
    await poll(async () => (await area()) === 'wilds', 'Milo to arrive at the lantern', 20_000);
    await savedState(value => Math.abs(value.wilds?.at?.x - litLantern.x) <= 2 && Math.abs(value.wilds.at.y - litLantern.y) <= 2);
  });

  await check('a place in the wilds opens with its one action, and fits 1000×700', async () => {
    const from = await standingAt();
    const plan = await wildsPlan('poi', { from, types: ['chest', 'ruin', 'note', 'statue'] });
    assert.ok(plan, 'a chest, ruin, note or statue within walking distance of the lantern');
    await page.locator('canvas#world').focus();
    await stepKeys(from, plan.steps);
    await savedState(value => Math.abs(value.wilds?.at?.x - plan.poi.x) <= 2 && Math.abs(value.wilds.at.y - plan.poi.y) <= 2);
    await dismissBubbles(1500);
    await openPlacesList();
    const entry = page.locator(`#place-list [data-entity="${plan.poi.id}"]`);
    await entry.waitFor({ timeout: 10_000 });
    await entry.click();
    await panel(plan.poi.id).waitFor({ timeout: 15_000 });
    const action = page.locator('#panel [data-action^="poi-"]');
    assert.equal(await action.count(), 1, `the ${plan.poi.type} has its one action`);
    assert.equal(await page.locator('#panel canvas[data-scene="poi"]').count(), 1, 'and its picture');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
    await page.waitForTimeout(400);
    await fitsAt1000('#panel', `a ${plan.poi.type} panel`);
    await page.screenshot({ path: path.join(artifacts, 'layout-1000x700-place.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280);
    await action.click();
    const kept = { chest: 'opened', ruin: 'opened', note: 'notes', statue: 'glimmers' }[plan.poi.type];
    await savedState(value => Number.isFinite(value.wilds?.[kept]?.[plan.poi.id]));
    await poll(async () => (await page.locator('#panel [data-action^="poi-"]:not([disabled])').count()) === 0, 'the action to be done');
    assert.doesNotMatch(await page.locator('#panel').textContent(), /!/);
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'place-done.png') });
    await assertFocusRings('#panel', 'a place panel');
    await closePanelNow();
    await dismissBubbles();
  });

  await check('a wild rift can be stepped into, stitched, and gone deeper into', async () => {
    const from = await standingAt();
    const plan = await wildsPlan('rift', { from });
    assert.ok(plan, 'a wild rift within walking distance today');
    await page.locator('canvas#world').focus();
    await stepKeys(from, plan.steps);
    await dismissBubbles(1500);
    const entry = await listEntry(plan.rift.id);
    await entry.click();
    await panel(plan.rift.id).waitFor({ timeout: 15_000 });
    assert.equal(await page.locator('#panel [data-section="lead"]').count(), 1, 'its Tale-lead is named');
    await page.locator('#panel [data-action="rift-step"]').click();
    await poll(async () => (await area()) === 'elsewhere', 'Milo to step into the wild rift', 30_000);
    await openPlacesList();
    await page.locator('#place-list [data-entity="stitch"]').click();
    await settleFights();
    await page.locator('#panel [data-action="rift-stitch"]').click({ timeout: 15_000 });
    await savedState(value => Number.isFinite(value.rifts?.closedWild?.[plan.rift.id]));
    const deeper = page.locator('#panel [data-action="rift-deeper"]');
    await deeper.waitFor({ timeout: 10_000 });
    // Stitched: nothing left to mend, and what it leaves is in the satchel already.
    assert.equal(await page.locator('#panel [data-section="mend"]').count(), 0, 'no “To mend it” once it’s mended');
    const loot = page.locator('#panel [data-section="loot"]');
    if (await loot.count()) {
      assert.equal(await loot.getAttribute('data-taken'), 'true');
      assert.equal((await loot.locator('h3').textContent()).trim(), 'What it left');
    }
    const bannerText = () => page.locator('#elsewhere-banner').textContent();
    const depthOf = async () => Number(/Depth (\d+)/.exec(await bannerText())?.[1] ?? NaN);
    const before = await bannerText();
    const depth = await depthOf();
    await dismissBubbles(1500);
    await deeper.click();
    // A new rift beneath the first: another name on the banner, and a greater depth.
    await poll(async () => (await bannerText()) !== before && (Number.isNaN(depth) || (await depthOf()) > depth), `the banner to show the rift beneath (${before})`, 30_000);
    assert.equal(await area(), 'elsewhere');
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'elsewhere-deeper.png') });
    // The banner's Leave, from the keyboard: the banner goes, and focus lands on the world.
    await page.locator('#elsewhere-banner [data-action="leave-elsewhere"]').focus();
    await page.keyboard.press('Enter');
    await poll(async () => (await area()) === 'wilds', 'Milo to come back out', 20_000);
    assert.equal(await assertFocusKept('the banner’s Leave'), 'CANVAS#world');
    await dismissBubbles();
    await travelHome();
  });

  await check('with every count met, Raise the Stockade spends the logs and puts up the War Table', async () => {
    await close();
    const stateFile = path.join(dataDirectory, 'state.json');
    const onDisk = JSON.parse(await readFile(stateFile, 'utf8'));
    // Back to the Camp, with a week of days, twenty finished sessions and the logs gathered.
    await writeFile(stateFile, JSON.stringify({
      ...onDisk,
      hearth: { tier: 1, raisedAt: {} },
      tally: { ...onDisk.tally, sessionsFinished: Math.max(20, onDisk.tally.sessionsFinished), daysSeen: Math.max(7, onDisk.tally.daysSeen) },
      satchel: { ...onDisk.satchel, materials: { birch: 85, ash: 30, pine: 2 } },
      settings: { ...onDisk.settings, eveningBell: null },
    }, null, 2), 'utf8');
    await launch();
    await dismissBubbles();
    await openPlacesList();
    assert.equal(await page.locator('#place-list [data-place="war-table"]').count(), 0, 'no War Table at the Camp');
    await openPlace('hearth');
    for (const kind of ['crew-sessions-finished', 'buildings-designed', 'days-with-milo']) {
      assert.equal(await page.locator(`#panel [data-req="${kind}"]`).getAttribute('data-level-state'), 'proven', `${kind} is met`);
    }
    const raise = page.locator('#panel [data-action="raise"]');
    assert.equal((await raise.textContent()).trim(), 'Raise the Stockade');
    await raise.click();
    const saved = await savedState(value => value.hearth?.tier === 2);
    assert.ok(Number.isFinite(saved.hearth.raisedAt.stockade ?? Object.values(saved.hearth.raisedAt)[0]), 'when it was raised');
    assert.deepEqual(saved.satchel.materials, { birch: 5, ash: 0, pine: 2 }, 'the Stockade took 80 birch and 30 ash');
    const raised = bubble('hearth');
    await raised.waitFor({ timeout: 10_000 });
    assert.match(await raised.locator('.bubble-title').textContent(), /^The Stockade is raised$/);
    assert.doesNotMatch(await raised.textContent(), /!/);
    // It says what the wilds raise: the bell and banners by the north gate, never on the watchtower.
    assert.match(await raised.textContent(), /Gate Bell and the banners stand by the north gate/);
    assert.doesNotMatch(await raised.textContent(), /watchtower|in its gatehouse/);
    await poll(async () => /Tier 2/.test(await page.locator('#panel .hearth-tier').textContent()), 'the Hearth panel to show the Stockade');
    // With the Stockade up the Prologue is done, and the story card moves on to Act I.
    await poll(async () => /^Act I · /.test((await page.locator('#tracker').textContent()).trim()), 'the story card to show Act I');
    assert.doesNotMatch(await page.locator('#tracker').textContent(), /The Prologue/);
    await openPlacesList();
    assert.equal(await page.locator('#place-list [data-place="war-table"]').count(), 1, 'the War Table stands now');
    await page.locator('#places-toggle').click();
    await settle();
    await page.screenshot({ path: path.join(artifacts, 'stockade-raised.png') });
    await dismissBubbles();
    // What the Hold needs: a row MILO can count shows its real count (Kindle's focus sessions, from
    // Phase 4), and every row it can't count yet says Later.
    const hold = page.locator('#panel [data-group="next"]');
    await hold.scrollIntoViewIfNeeded();
    const tags = (await hold.locator('.reqs .level-tag').allTextContents()).map((tag) => tag.trim());
    for (const tag of tags) assert.match(tag, /^(Later|\d+ of \d+)$/);
    assert.ok(tags.some((tag) => /^\d+ of 30$/.test(tag)), `the focus-sessions row counts: ${tags.join(', ')}`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(artifacts, 'hearth-next-tier.png') });
  });

  await check('inside a wild rift’s Elsewhere as midnight passes, its chest and its seam still answer', async () => {
    await close();
    // A fresh save of its own, on a clock that starts 90 s before the next midnight (launching
    // and walking out to a wild rift take most of that).
    const nightDir = path.join(root, 'midnight');
    await mkdir(nightDir, { recursive: true });
    const turn = new Date();
    turn.setDate(turn.getDate() + 1);
    turn.setHours(0, 0, 0, 0);
    const midnight = turn.getTime();
    const start = midnight - 90_000;
    await writeFile(path.join(nightDir, 'state.json'), JSON.stringify({
      version: 1, user: { name: 'Chris' }, milo: { name: 'Milo', tile: { x: 32, y: 1 } }, lastSeenAt: start - 60_000, lastGreetedDay: null,
      settings: { motion: false, notifications: false, greeting: false, designer: 'kit', eveningBell: null, gateBell: true, wardPost: null },
      skills: {}, panel: null, plots: {},
      // Stepping into a wild rift costs Embers now (Phase 4): this bare state brings a full wallet.
      embers: { balance: 100, lifetime: 100 },
    }), 'utf8');
    await launch(repo, { MILO_DATA_DIR: nightDir, MILO_NOW: new Date(start).toISOString() });
    const clock = () => page.evaluate(async () => Date.now() + (await window.milo.clock()).offset);
    await dismissBubbles(1500);
    await page.locator('canvas#world').focus();
    const at = await stepKeys({ x: 32, y: 1 }, [{ x: 32, y: 0 }, { x: 32, y: -1 }, { x: 32, y: -2 }, { x: 32, y: -3 }]);
    await poll(async () => (await area()) === 'wilds', 'Milo to be out of the north gate');
    await savedState(value => value.wilds?.at?.x === 32 && value.wilds.at.y === -3);
    const plan = await wildsPlan('rift', { from: at });
    assert.ok(plan, 'a wild rift within walking distance today');
    await page.locator('canvas#world').focus();
    await stepKeys(at, plan.steps);
    await dismissBubbles(1000);
    await (await listEntry(plan.rift.id)).click();
    await panel(plan.rift.id).waitFor({ timeout: 15_000 });
    await page.locator('#panel [data-action="rift-step"]').click();
    await poll(async () => (await area()) === 'elsewhere', 'Milo to step into the wild rift', 30_000);
    assert.ok((await clock()) < midnight, 'Milo stepped in before midnight');
    // Past midnight, and past a tick of the rift loop after it: a new day's wilds have opened.
    await poll(async () => (await clock()) > midnight + 31_000, 'midnight and a tick to pass', 180_000);
    assert.equal(await area(), 'elsewhere', 'still inside');
    await dismissBubbles(1000);
    await openPlacesList();
    const chest = page.locator('#place-list [data-entity^="loot:"]').first();
    if (await chest.count()) {
      await chest.click();
      const found = bubble('loot');
      await found.waitFor({ timeout: 10_000 });
      assert.equal((await found.locator('.bubble-title').textContent()).trim(), 'A chest in the Elsewhere', 'the chest still opens');
      await dismissBubbles();
      await openPlacesList();
    }
    await page.locator('#place-list [data-entity="stitch"]').click();
    await settleFights();
    await page.locator(`#panel[data-place="${plan.rift.id}"] [data-action="rift-stitch"]`).click({ timeout: 10_000 });
    const today = await page.evaluate(async () => (await import('./src/model.js')).dayNumber(Date.now() + (await window.milo.clock()).offset));
    await savedState(value => value.rifts?.closedWild?.[plan.rift.id] === today);
    await page.locator('#panel [data-action="rift-deeper"]').waitFor({ timeout: 10_000 });
    await dismissBubbles();
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

  await check('a close asked for before the saved state is back never writes defaults over it', async () => {
    const stateFile = path.join(dataDirectory, 'state.json');
    const backupFile = `${stateFile}.backup`;
    await page.waitForTimeout(1500);
    const good = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.ok(good.tally.buildingsDesigned >= 3 && good.tally.daysSeen >= 1, 'a save with progress in it');
    // The close arrives while the page's first load of its state is still on its way (the order
    // a close in that moment gives): main's own handler, wrapped, asks first.
    await application.evaluate(({ ipcMain }) => {
      const handlers = ipcMain._invokeHandlers;
      const original = handlers.get('milo:load-state');
      handlers.set('milo:load-state', async (event, ...args) => {
        event.sender.send('milo:before-close');
        await new Promise(resolve => setTimeout(resolve, 800));
        handlers.set('milo:load-state', original);
        return original(event, ...args);
      });
    });
    await page.evaluate(() => { window.__beforeReload = true; });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
    await page.waitForFunction(() => !window.__beforeReload && document.body?.dataset.ready === 'true', null, { timeout: 40_000 });
    await page.waitForTimeout(2500);
    const onDisk = JSON.parse(await readFile(stateFile, 'utf8'));
    const backup = JSON.parse(await readFile(backupFile, 'utf8'));
    assert.equal(onDisk.tally.buildingsDesigned, good.tally.buildingsDesigned, 'state.json keeps its progress');
    assert.equal(onDisk.tally.daysSeen, good.tally.daysSeen);
    assert.deepEqual(Object.keys(onDisk.plots || {}).sort(), Object.keys(good.plots || {}).sort());
    assert.equal(backup.tally.buildingsDesigned, good.tally.buildingsDesigned, 'and so does its backup');
    assert.doesNotMatch(await page.locator('#titlebar-status').textContent(), /Couldn't save/);
  });

  assert.deepEqual(pageErrors, [], `Renderer errors: ${pageErrors.join('\n')}`);
  // Until every module exists, the shell's defensive imports log a file-not-found
  // for each missing one. Once they all exist, any console error fails the run.
  const missing = ['src/world/engine.js', 'src/world/map.js', 'src/world/kit.js', 'src/model.js', 'src/recap.js', 'src/skills.js', 'src/architect/blueprint.js', 'src/ui/mapview.js', 'src/ui/mapview.css']
    .filter(file => !existsSync(path.join(repo, file)));
  const unexpected = missing.length ? consoleErrors.filter(text => !/ERR_FILE_NOT_FOUND/.test(text)) : consoleErrors;
  if (missing.length) console.log(`Note: not written yet, so the shell ran without them: ${missing.join(', ')}`);
  assert.deepEqual(unexpected, [], `Console errors: ${unexpected.join('\n')}`);
  if (!missing.length) assert.deepEqual(miloWarnings, [], `Shell fallbacks were used: ${miloWarnings.join('\n')}`);
  console.log(`\n${kit.completed} MILO shell checks passed. No renderer errors.`);
  console.log(`Isolated data: ${root}`);
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error(`\nFAILED after ${kit.completed} checks: ${error.stack || error}`);
  console.error(`Isolated data preserved: ${root}`);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'ui-failure.png') }).catch(() => {});
  if (pageErrors.length) console.error(`Renderer errors:\n${pageErrors.join('\n')}`);
  if (consoleErrors.length) console.error(`Console errors:\n${consoleErrors.join('\n')}`);
  if (diagnostics.length) console.error(`Diagnostics:\n${diagnostics.join('')}`);
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
  for (const child of sleepers) { try { child.kill(); } catch { /* already gone */ } }
}
