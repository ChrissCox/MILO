// Module A (Watch) tests. Run: node --test tests/watch.test.js
//
// Every test works on a temp copy of tests/fixtures/{claude,codex}-home, so fixtures are never
// changed and nothing touches the real ~/.claude or ~/.codex.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_SESSIONS, createWatcher } from '../src/watch/index.js';
import {
  clip, firstLine, isHumanPrompt, msToFileTime, parseIncremental, parseProcStart, processStartTimes, projectName, snippet, toMs,
} from '../src/watch/claude.js';
import { codexPromptText, isSubagentMeta, parseCodexRollout, threadIdFromFileName } from '../src/watch/codex.js';
import { createToolProbes, detectTools, formatCost, readJevTool } from '../src/watch/local.js';
import { CLAUDE_IDS, CODEX_IDS } from './fixtures/build-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');
const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const OLD = new Date(NOW - 24 * 60 * 60 * 1000);
const MIN = 60 * 1000;

const STATUS_DETAIL = { working: 'Working now', 'needs-you': 'Waiting on you', done: 'Finished', stopped: 'Stopped partway' };

// ---------------------------------------------------------------------------------------------
// Helpers

async function listFiles(dir) {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

async function makeHomes(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-watch-'));
  const homes = {
    root,
    claudeHome: path.join(root, 'claude-home'),
    codexHome: path.join(root, 'codex-home'),
    localAppData: path.join(root, 'localappdata'),
  };
  await fsp.cp(path.join(FIXTURES, 'claude-home'), homes.claudeHome, { recursive: true });
  await fsp.cp(path.join(FIXTURES, 'codex-home'), homes.codexHome, { recursive: true });
  await fsp.mkdir(homes.localAppData, { recursive: true });
  for (const file of await listFiles(root)) await fsp.utimes(file, OLD, OLD);
  if (t) t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return homes;
}

// Registry entries written by these tests carry this procStart, and the injected process probe
// reports it as the creation time of every pid asked about (the real probe is tested separately).
const PROC_START = '134000000000000123';
const sameProcess = async (pids) => new Map(pids.map((pid) => [pid, BigInt(PROC_START)]));

function watcherFor(homes, extra = {}) {
  return createWatcher({
    claudeHome: homes.claudeHome,
    codexHome: homes.codexHome,
    localAppData: homes.localAppData,
    now: () => NOW,
    probeTools: false,
    processStarts: sameProcess,
    ...extra,
  });
}

const claudeId = (key) => `claude:${CLAUDE_IDS[key]}`;
const codexId = (key) => `codex:${CODEX_IDS[key]}`;
const find = (snapshot, id) => snapshot.sessions.find((session) => session.id === id);

async function writeRegistry(claudeHome, { pid = process.pid, sessionId, status, name = '', cwd = 'Z:\\Demo', statusUpdatedAt = NOW - 30 * 1000, procStart = PROC_START, extra = {} }) {
  const file = path.join(claudeHome, 'sessions', `${pid}.json`);
  await fsp.writeFile(
    file,
    JSON.stringify({
      pid,
      sessionId,
      cwd,
      startedAt: NOW - 20 * MIN,
      ...(procStart === null ? {} : { procStart }),
      ...extra,
      version: '2.9.0',
      peerProtocol: 1,
      peerFeatures: [],
      kind: 'interactive',
      entrypoint: 'claude-desktop',
      hostSessionId: 'host-demo-0002',
      pidDomain: 'demo',
      messagingSocketPath: '\\\\.\\pipe\\demo-pipe-2',
      name,
      nameSince: NOW - 19 * MIN,
      updatedAt: NOW - 10 * 1000,
      status,
      statusUpdatedAt,
    }),
  );
  return file;
}

async function replaceSameSize(file, from, to) {
  assert.equal(from.length, to.length, 'replacement must keep the file size');
  const text = await fsp.readFile(file, 'utf8');
  assert.ok(text.includes(from));
  await fsp.writeFile(file, text.replace(from, to));
}

// ---------------------------------------------------------------------------------------------
// Claude

test('claude titles: custom > ai > agent name > registry name > last prompt > untitled', async (t) => {
  const homes = await makeHomes(t);
  const snap = await watcherFor(homes).scan();
  assert.equal(find(snap, claudeId('done')).title, 'Garden cleanup', 'newest custom-title wins');
  assert.equal(find(snap, claudeId('stopped')).title, 'Read the soil log', 'ai-title beats last-prompt');
  assert.equal(find(snap, claudeId('recent')).title, 'soil-scout', 'agent-name');
  assert.equal(find(snap, claudeId('garden')).title, 'Plan the spring beds', 'first line of last-prompt');
  assert.equal(find(snap, claudeId('untitled')).title, 'Untitled session');
  assert.equal(find(snap, claudeId('liveable')).title, 'Start the watering schedule');

  // Live registry name beats last-prompt, but not a custom title.
  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'idle', name: 'Watering run' });
  await writeRegistry(homes.claudeHome, { pid: process.ppid, sessionId: CLAUDE_IDS.done, status: 'idle', name: 'Registry name' });
  const live = await watcherFor(homes).scan();
  assert.equal(find(live, claudeId('liveable')).title, 'Watering run');
  assert.equal(find(live, claudeId('done')).title, 'Garden cleanup');
});

test('claude statuses from transcripts when no live process owns the session', async (t) => {
  const homes = await makeHomes(t);
  const snap = await watcherFor(homes).scan();
  const expect = { done: 'done', stopped: 'stopped', recent: 'working', garden: 'done', untitled: 'stopped', liveable: 'done' };
  for (const [key, status] of Object.entries(expect)) {
    const session = find(snap, claudeId(key));
    assert.equal(session.status, status, key);
    assert.equal(session.statusDetail, STATUS_DETAIL[status], key);
    assert.equal(session.live, false, `${key} is not live (stale registry pid ignored)`);
  }
  // 'working' only lasts three minutes past the last record.
  const later = await watcherFor(homes, { now: () => NOW + 5 * MIN }).scan();
  assert.equal(find(later, claudeId('recent')).status, 'stopped');
});

test('claude live registry: busy, idle, anything else, and registry-only sessions', async (t) => {
  const homes = await makeHomes(t);
  const watcher = watcherFor(homes);
  const file = await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'busy', name: 'Watering run' });

  let session = find(await watcher.scan(), claudeId('liveable'));
  assert.equal(session.status, 'working');
  assert.equal(session.statusDetail, 'Working now');
  assert.equal(session.live, true);
  assert.equal(session.lastActivityAt, NOW - 30 * 1000, 'status change counts as activity while live');

  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'idle', name: 'Watering run' });
  session = find(await watcher.scan(), claudeId('liveable'));
  assert.equal(session.status, 'done');
  assert.equal(session.live, true);

  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'waiting_for_permission', name: 'Watering run' });
  session = find(await watcher.scan(), claudeId('liveable'));
  assert.equal(session.status, 'needs-you');
  assert.equal(session.statusDetail, 'Waiting on you');

  // A registry entry with no transcript yet still shows up, titled from its name.
  const freshId = 'aaaabbbb-0000-4000-8000-000000000007';
  await writeRegistry(homes.claudeHome, { pid: process.ppid, sessionId: freshId, status: 'busy', name: 'Fresh session', cwd: 'C:\\Users\\demo\\Projects\\Pond' });
  const snap = await watcher.scan();
  const fresh = find(snap, `claude:${freshId}`);
  assert.ok(fresh, 'registry-only session is listed');
  assert.equal(fresh.title, 'Fresh session');
  assert.equal(fresh.project, 'Pond');
  assert.equal(fresh.status, 'working');
  assert.equal(fresh.live, true);
  assert.equal(fresh.turns, 0);
  assert.equal(fresh.source, 'claude-desktop');
  assert.equal(snap.sources.claude.count, 7);

  // Process gone: back to transcript rules.
  await fsp.rm(file);
  session = find(await watcher.scan(), claudeId('liveable'));
  assert.equal(session.live, false);
  assert.equal(session.status, 'done');
  assert.equal(session.title, 'Start the watering schedule');
});

test('claude: sidechains, subagent folders, duplicate end_turn blocks and malformed lines', async (t) => {
  const homes = await makeHomes(t);
  const snap = await watcherFor(homes).scan();
  const a = find(snap, claudeId('done'));
  assert.equal(a.turns, 2, 'thinking + text blocks of one message count once; sidechain turns ignored');
  assert.deepEqual(a.completions, [Date.parse('2026-09-24T09:00:13Z'), Date.parse('2026-09-24T09:12:00Z')]);
  assert.equal(a.lastActivityAt, Date.parse('2026-09-24T09:12:01Z'), 'later sidechain records do not count');
  assert.equal(a.startedAt, Date.parse('2026-09-24T09:00:00Z'));
  assert.equal(a.model, 'claude-demo-5');
  assert.equal(a.lastMessage, 'Labels are on the shelves.');
  assert.equal(a.cwd, 'Z:\\Demo');
  assert.equal(a.project, 'Demo');
  assert.equal(a.source, 'claude-desktop');
  assert.equal(a.archived, false);
  assert.equal(snap.sources.claude.count, 6, 'subagents/ transcripts are not sessions');
  assert.ok(!snap.sessions.some((s) => /a0b1c2d3/.test(s.id)));
  assert.equal(snap.sources.claude.live, true, 'registry folder exists');
});

test('snippets and titles are whitespace-collapsed and trimmed', async (t) => {
  const homes = await makeHomes(t);
  const snap = await watcherFor(homes).scan();
  const d = find(snap, claudeId('garden'));
  assert.ok(d.lastMessage.length <= 200, `snippet is ${d.lastMessage.length} chars`);
  assert.ok(d.lastMessage.endsWith('…'));
  assert.ok(!/\s{2,}|\n/.test(d.lastMessage));
  assert.ok(d.lastMessage.startsWith('Here is the plan for the spring beds. Bed one: peas, radishes and early lettuce. Bed two'));
  assert.equal(d.project, 'Garden');

  assert.equal(clip('a  b\n\t c', 80), 'a b c');
  const long = clip('word '.repeat(40), 80);
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
  assert.equal(clip('😀'.repeat(60), 81).length <= 81, true);
  assert.equal(firstLine('\n\n  Plan  the beds \nsecond'), 'Plan the beds');
  assert.equal(projectName('Z:\\Claude'), 'Claude');
  assert.equal(projectName('C:\\Users\\chris\\Projects\\MILO\\'), 'MILO');
  assert.equal(projectName('/home/demo/garden'), 'garden');
  assert.equal(projectName(''), '');
  assert.equal(projectName('Z:\\'), '');
  assert.equal(toMs('2026-09-06T17:37:48.6681169Z'), 1788716268668);
  assert.equal(toMs(1787319056), 1787319056000, 'seconds become ms');
  assert.equal(toMs(1790445045010), 1790445045010);
  assert.equal(toMs('nope'), 0);
});

test('snippets read as plain words: light Markdown is removed, markup-looking text stays text', () => {
  assert.equal(snippet('Here is **the plan**, see the [bed map](https://example.test/map(1)) and `beds.md`.'),
    'Here is the plan, see the bed map and beds.md.');
  assert.equal(snippet('[Open the sheet](<C:/Users/demo/Beds - v2.docx>) when ready.'), 'Open the sheet when ready.');
  assert.equal(snippet('## Summary\n- Watered *all* beds\n1. Peas\n\n```js\nconst rows = 2 * 3 * 4;\n```\n---\n> Done'),
    'Summary Watered all beds Peas const rows = 2 * 3 * 4; Done');
  assert.equal(snippet('Kept <b>three</b> rows.'), 'Kept <b>three</b> rows.');
  assert.equal(snippet('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(snippet('x'.repeat(300)).length, 200);
  assert.equal(snippet(null), '');
});

// ---------------------------------------------------------------------------------------------
// Codex

test('codex: continuation files merge into one thread; subagent and review threads are left out', async (t) => {
  const homes = await makeHomes(t);
  const snap = await watcherFor(homes).scan();
  const codexIds = snap.sessions.filter((s) => s.agent === 'codex').map((s) => s.id).sort();
  assert.deepEqual(codexIds, ['garden', 'working', 'aborted', 'imported', 'archived', 'voice'].map(codexId).sort());
  assert.equal(snap.sources.codex.count, 6);
  assert.equal(snap.sources.codex.live, true);

  const t1 = find(snap, codexId('garden'));
  assert.equal(t1.turns, 2);
  assert.deepEqual(t1.completions, [Date.parse('2026-09-24T14:05:00Z'), Date.parse('2026-09-25T09:03:00Z')]);
  assert.equal(t1.status, 'done', "the subagent's later task_started does not leak into the parent");
  assert.equal(t1.live, false);
  assert.equal(t1.model, 'gpt-demo-codex-2', 'newest turn_context across files');
  assert.equal(t1.lastMessage, 'The bench sits by the pond now.');
  assert.equal(t1.startedAt, Date.parse('2026-09-24T14:00:00Z'));
  assert.equal(t1.lastActivityAt, Date.parse('2026-09-25T09:03:00Z'));
  assert.equal(t1.project, 'Garden');
  assert.equal(t1.source, 'Codex Desktop');
  assert.equal(t1.sessionId, CODEX_IDS.garden);

  assert.equal(isSubagentMeta({ id: 'x', sessionId: 'x', threadSource: 'user' }), false);
  assert.equal(isSubagentMeta({ id: 'x', sessionId: 'y', threadSource: 'subagent' }), true);
  assert.equal(isSubagentMeta({ id: 'x', sessionId: 'y' }), true, 'session_id pointing elsewhere means spawned');
  assert.equal(isSubagentMeta({ id: 'x', sessionId: 'x', spawned: true }), true);
  assert.equal(
    threadIdFromFileName(`rollout-2026-09-25T05-00-00-${CODEX_IDS.garden}_${CODEX_IDS.gardenSegment}.jsonl`),
    CODEX_IDS.garden,
  );
});

test('codex titles: newest index name, then import title, then first real prompt', async (t) => {
  const homes = await makeHomes(t);
  let snap = await watcherFor(homes).scan();
  assert.equal(find(snap, codexId('garden')).title, 'Garden layout plan', 'newest updated_at, not last line');
  assert.equal(find(snap, codexId('voice')).title, 'Voice notes');
  assert.equal(find(snap, codexId('working')).title, 'Tomato watering');
  assert.equal(find(snap, codexId('imported')).title, 'Imported seed sorting');
  assert.equal(find(snap, codexId('aborted')).title, 'Check the soil sensor readings', 'skips wrapper messages');

  await fsp.rm(path.join(homes.codexHome, 'session_index.jsonl'));
  await fsp.rm(path.join(homes.codexHome, 'external_agent_session_imports.json'));
  snap = await watcherFor(homes).scan();
  assert.equal(find(snap, codexId('garden')).title, 'Sketch the garden layout', 'text after "## My request:"');
  assert.equal(find(snap, codexId('imported')).title, 'Sort the seed tins by colour', 'skips <command-message>');
  assert.equal(find(snap, codexId('working')).title, 'Water the tomatoes on a timer');
  assert.equal(find(snap, codexId('voice')).title, 'Untitled session');

  assert.equal(codexPromptText('<environment_context>\n<cwd>Z:\\x</cwd>\n</environment_context>'), '');
  assert.equal(codexPromptText('# AGENTS.md instructions for Z:\\x\n\nstuff'), '');
  assert.equal(codexPromptText('# Files mentioned by the user:\n\n## a.md: Z:\\a.md\n'), '');
  assert.equal(codexPromptText('# Context from my IDE setup:\n\n## My request for Codex:\nDo the thing\nmore'), 'Do the thing');
  assert.equal(codexPromptText('  Plain   ask\nsecond line'), 'Plain ask');
});

test('codex statuses: working while real work is fresh, stopped, done, archived, imported turns', async (t) => {
  const homes = await makeHomes(t);
  // T2's newest work record is 11:41:02; an open turn counts as working for 10 minutes after it.
  const soon = Date.parse('2026-09-25T11:45:00Z');
  let snap = await watcherFor(homes, { now: () => soon }).scan();
  let t2 = find(snap, codexId('working'));
  assert.equal(t2.status, 'working');
  assert.equal(t2.statusDetail, 'Working now');
  assert.equal(t2.live, true);
  assert.equal(t2.turns, 0);
  assert.equal(t2.lastMessage, 'Setting up the timer now.');

  snap = await watcherFor(homes).scan();
  t2 = find(snap, codexId('working'));
  assert.equal(t2.status, 'stopped', 'quiet for 19 minutes');
  assert.equal(t2.live, false);

  const t3 = find(snap, codexId('aborted'));
  assert.equal(t3.status, 'stopped', 'turn_aborted');
  assert.equal(t3.statusDetail, 'Stopped partway');
  assert.equal(t3.turns, 1, 'a cut-off task_complete line is skipped');

  const t5 = find(snap, codexId('archived'));
  assert.equal(t5.archived, true);
  assert.equal(t5.status, 'done');
  assert.equal(find(snap, codexId('garden')).archived, false);

  // An imported thread replays another agent's turns (no turn_context): they are not Codex's work.
  const t4 = find(snap, codexId('imported'));
  assert.equal(t4.status, 'done');
  assert.deepEqual(t4.completions, [], 'replayed turns are not counted as Codex finishing tasks');
  assert.equal(t4.turns, 0);
  assert.equal(t4.title, 'Imported seed sorting');

  assert.equal(find(snap, codexId('voice')).status, 'done', 'no lifecycle events');
});

// ---------------------------------------------------------------------------------------------
// Robustness, caching, big files

test('malformed and junk files never break a scan', async (t) => {
  const homes = await makeHomes(t);
  const aFile = path.join(homes.claudeHome, 'projects', 'Z--Demo', `${CLAUDE_IDS.done}.jsonl`);
  await fsp.appendFile(aFile, '\u0000\u0001 binary junk {"type":\n{"half":');
  await fsp.writeFile(path.join(homes.claudeHome, 'projects', 'Z--Demo', 'abababab-0000-4000-8000-00000000abab.jsonl'), 'garbage\n{{{{\n');
  await fsp.writeFile(path.join(homes.claudeHome, 'sessions', '12.json'), '{"pid": 12, "sessionId": ');
  const junkId = '01a0e0ff-0000-7000-8000-0000000000ff';
  await fsp.writeFile(path.join(homes.codexHome, 'sessions', '2026', '09', '25', `rollout-2026-09-25T00-00-00-${junkId}.jsonl`), Buffer.from([0xff, 0xfe, 0x00, 0x0a, 0x7b]));
  await fsp.writeFile(path.join(homes.codexHome, 'archived_sessions', 'rollout-empty.jsonl'), '');
  await fsp.writeFile(path.join(homes.codexHome, 'session_index.jsonl'), '\u0000not json\n');

  const snap = await watcherFor(homes).scan();
  assert.equal(snap.sources.claude.ok, true);
  assert.equal(snap.sources.codex.ok, true);
  assert.equal(snap.sources.claude.count, 6);
  assert.equal(snap.sources.codex.count, 6);
  assert.equal(find(snap, claudeId('done')).turns, 2);
  assert.ok(!find(snap, `codex:${junkId}`));
  assert.equal(find(snap, codexId('garden')).title, 'Sketch the garden layout', 'unreadable index falls back');
});

test('caching: unchanged files are reused, changed files are re-read', async (t) => {
  const homes = await makeHomes(t);
  const watcher = watcherFor(homes);
  const aFile = path.join(homes.claudeHome, 'projects', 'Z--Demo', `${CLAUDE_IDS.done}.jsonl`);
  const t3File = path.join(homes.codexHome, 'sessions', '2026', '09', '23', `rollout-2026-09-23T12-00-00-${CODEX_IDS.aborted}.jsonl`);

  const first = await watcher.scan();
  assert.equal(find(first, claudeId('done')).title, 'Garden cleanup');
  assert.equal(find(first, codexId('aborted')).lastMessage, 'Readings look steady.');

  // Same size, same mtime: the cached summaries are served.
  await replaceSameSize(aFile, '"customTitle":"Garden cleanup"', '"customTitle":"Garden cleanUP"');
  await replaceSameSize(t3File, '"last_agent_message":"Readings look steady."', '"last_agent_message":"Readings look STEADY."');
  await fsp.utimes(aFile, OLD, OLD);
  await fsp.utimes(t3File, OLD, OLD);
  const cached = await watcher.scan();
  assert.equal(find(cached, claudeId('done')).title, 'Garden cleanup');
  assert.equal(find(cached, codexId('aborted')).lastMessage, 'Readings look steady.');

  // A new mtime invalidates.
  const bumped = new Date(OLD.getTime() + 1000);
  await fsp.utimes(aFile, bumped, bumped);
  await fsp.utimes(t3File, bumped, bumped);
  const fresh = await watcher.scan();
  assert.equal(find(fresh, claudeId('done')).title, 'Garden cleanUP');
  assert.equal(find(fresh, codexId('aborted')).lastMessage, 'Readings look STEADY.');

  // Concurrent scans share one pass.
  const [x, y] = await Promise.all([watcher.scan(), watcher.scan()]);
  assert.equal(x, y);

  // dispose() drops the caches; a later scan re-reads.
  watcher.dispose();
  await replaceSameSize(aFile, '"customTitle":"Garden cleanUP"', '"customTitle":"Garden CLEANUP"');
  await fsp.utimes(aFile, bumped, bumped);
  assert.equal(find(await watcher.scan(), claudeId('done')).title, 'Garden CLEANUP');
});

test('big files: every turn counts, and a grown file is read from where the last scan stopped', async (t) => {
  const homes = await makeHomes(t);
  const id = '01a0e0bb-0000-7000-8000-0000000000bb';
  const file = path.join(homes.codexHome, 'sessions', '2026', '09', '25', `rollout-2026-09-25T06-00-00-${id}.jsonl`);
  let ordinal = 0;
  const at = (ms) => new Date(ms).toISOString();
  const rec = (ms, type, payload) => JSON.stringify({ timestamp: at(ms), ordinal: ordinal++, type, payload });
  const start = NOW - 60 * MIN;
  const lines = [
    rec(start, 'session_meta', { session_id: id, id, timestamp: at(start), cwd: 'Z:\\Big', originator: 'Codex Desktop', source: 'vscode', thread_source: 'user' }),
    rec(start + 1000, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Big file prompt' }] }),
    rec(start + 2000, 'event_msg', { type: 'task_started', turn_id: 'head-1', started_at: (start + 2000) / 1000 }),
    rec(start + 3000, 'event_msg', { type: 'task_complete', turn_id: 'head-1', last_agent_message: 'Head reply.', started_at: (start + 2000) / 1000, completed_at: (start + 3000) / 1000 }),
  ];
  const pad = 'x'.repeat(1000);
  for (let i = 0; i < 11000; i += 1) lines.push(rec(start + 10000 + i, 'event_msg', { type: 'token_count', info: null, pad }));
  lines.push(rec(start + 30 * MIN, 'event_msg', { type: 'task_complete', turn_id: 'middle-1', last_agent_message: 'Middle reply.', completed_at: (start + 30 * MIN) / 1000 }));
  for (let i = 0; i < 11000; i += 1) lines.push(rec(start + 31 * MIN + i, 'event_msg', { type: 'token_count', info: null, pad }));
  const end = NOW - 10 * MIN;
  lines.push(rec(end, 'event_msg', { type: 'task_started', turn_id: 'tail-1', started_at: end / 1000 }));
  lines.push(rec(end + 1000, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tail reply.' }] }));
  lines.push(rec(end + 2000, 'event_msg', { type: 'task_complete', turn_id: 'tail-1', last_agent_message: null, started_at: end / 1000 }));
  await fsp.writeFile(file, `${lines.join('\n')}\n`);
  const { size } = await fsp.stat(file);
  assert.ok(size > 20 * 1024 * 1024, `test file is ${size} bytes`);

  const watcher = watcherFor(homes);
  const started = performance.now();
  const snap = await watcher.scan();
  const elapsed = performance.now() - started;
  const big = find(snap, `codex:${id}`);
  assert.ok(big, 'big thread is listed');
  assert.equal(big.title, 'Big file prompt');
  assert.equal(big.turns, 3, 'the turn in the middle of a big file counts too');
  assert.deepEqual(big.completions, [start + 3000, start + 30 * MIN, end + 2000]);
  assert.equal(big.status, 'done');
  assert.equal(big.lastMessage, 'Tail reply.');
  assert.equal(big.project, 'Big');
  assert.ok(elapsed < 5000, `scan took ${Math.round(elapsed)} ms`);

  // Another turn is appended: the next scan picks it up without re-reading the whole file.
  await fsp.appendFile(file, `${[
    rec(end + 60000, 'event_msg', { type: 'task_started', turn_id: 'tail-2', started_at: (end + 60000) / 1000 }),
    rec(end + 61000, 'event_msg', { type: 'task_complete', turn_id: 'tail-2', last_agent_message: 'Second tail reply.', completed_at: (end + 61000) / 1000 }),
  ].join('\n')}\n`);
  const again = performance.now();
  const grown = find(await watcher.scan(), `codex:${id}`);
  const appendElapsed = performance.now() - again;
  assert.equal(grown.turns, 4);
  assert.equal(grown.lastMessage, 'Second tail reply.');
  assert.ok(appendElapsed < elapsed, `append scan ${Math.round(appendElapsed)} ms vs first scan ${Math.round(elapsed)} ms`);
});

test('parseIncremental reads only appended bytes, waits for whole lines, and restarts on rewrites', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-incremental-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'log.jsonl');
  const counter = {
    start: () => ({ seen: [], starts: (counter.starts = (counter.starts || 0) + 1) }),
    line: (state, buffer, start, end) => state.seen.push(JSON.parse(buffer.toString('utf8', start, end)).n),
    finish: (state) => ({ seen: state.seen.slice() }),
  };
  const cache = new Map();
  const parse = async () => parseIncremental(cache, file, await fsp.stat(file), counter);
  const bump = async (seconds) => fsp.utimes(file, new Date(NOW + seconds * 1000), new Date(NOW + seconds * 1000));

  await fsp.writeFile(file, '{"n":1}\n{"n":2}\n{"n":');
  await bump(1);
  assert.deepEqual((await parse()).seen, [1, 2], 'a half-written last line waits');
  await fsp.appendFile(file, '3}\n{"n":4}');
  await bump(2);
  assert.deepEqual((await parse()).seen, [1, 2, 3, 4], 'the finished line and a whole unterminated record count once');
  assert.equal(counter.starts, 1, 'no restart for an append');
  await fsp.appendFile(file, '\n{"n":5}\n');
  await bump(3);
  assert.deepEqual((await parse()).seen, [1, 2, 3, 4, 5], 'record 4 is not counted twice');
  assert.equal(counter.starts, 1);

  // Same size and mtime: served from the cache.
  assert.deepEqual((await parse()).seen, [1, 2, 3, 4, 5]);

  // Rewritten with different first bytes, or shrunk: read again from the start.
  await fsp.writeFile(file, '{"n":9}\n{"n":8}\n{"n":7}\n{"n":6}\n{"n":5}\n{"n":4}\n');
  await bump(4);
  assert.deepEqual((await parse()).seen, [9, 8, 7, 6, 5, 4]);
  assert.equal(counter.starts, 2);
  await fsp.writeFile(file, '{"n":9}\n');
  await bump(5);
  assert.deepEqual((await parse()).seen, [9]);
  assert.equal(counter.starts, 3);
});

test('missing or empty homes give ok:false with a calm error', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-watch-empty-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const missing = createWatcher({
    claudeHome: path.join(root, 'no-claude'),
    codexHome: path.join(root, 'no-codex'),
    localAppData: path.join(root, 'no-appdata'),
    now: () => NOW,
    probeTools: false,
  });
  const snap = await missing.scan();
  assert.deepEqual(snap.sessions, []);
  assert.equal(snap.scannedAt, NOW);
  for (const key of ['claude', 'codex']) {
    const source = snap.sources[key];
    assert.equal(source.ok, false);
    assert.equal(source.live, false);
    assert.equal(source.count, 0);
    assert.equal(typeof source.error, 'string');
    assert.ok(source.error.length > 0 && !source.error.includes('!'));
  }
  assert.deepEqual(snap.tools.map((tool) => tool.id), ['jev', 'whisper', 'ollama']);
  assert.equal(snap.tools[0].installed, false);

  await fsp.mkdir(path.join(root, 'empty-claude'));
  await fsp.mkdir(path.join(root, 'empty-codex'));
  const empty = await createWatcher({ claudeHome: path.join(root, 'empty-claude'), codexHome: path.join(root, 'empty-codex'), now: () => NOW, probeTools: false }).scan();
  assert.equal(empty.sources.claude.ok, false);
  assert.match(empty.sources.claude.error, /hasn't saved any sessions/);
  assert.equal(empty.sources.codex.ok, false);

  // Projects but no registry folder: readable, but live status isn't.
  await fsp.mkdir(path.join(root, 'empty-claude', 'projects'));
  const noRegistry = await createWatcher({ claudeHome: path.join(root, 'empty-claude'), codexHome: path.join(root, 'empty-codex'), now: () => NOW, probeTools: false }).scan();
  assert.equal(noRegistry.sources.claude.ok, true);
  assert.equal(noRegistry.sources.claude.live, false);
});

test('homes come from MILO_CLAUDE_HOME / MILO_CODEX_HOME when not passed', async (t) => {
  const homes = await makeHomes(t);
  const saved = { claude: process.env.MILO_CLAUDE_HOME, codex: process.env.MILO_CODEX_HOME };
  process.env.MILO_CLAUDE_HOME = homes.claudeHome;
  process.env.MILO_CODEX_HOME = homes.codexHome;
  t.after(() => {
    if (saved.claude === undefined) delete process.env.MILO_CLAUDE_HOME;
    else process.env.MILO_CLAUDE_HOME = saved.claude;
    if (saved.codex === undefined) delete process.env.MILO_CODEX_HOME;
    else process.env.MILO_CODEX_HOME = saved.codex;
  });
  const snap = await createWatcher({ now: () => NOW, probeTools: false, localAppData: homes.localAppData }).scan();
  assert.equal(snap.sources.claude.path, homes.claudeHome);
  assert.equal(snap.sources.codex.path, homes.codexHome);
  assert.equal(snap.sources.claude.count, 6);
});

test('sessions are sorted newest first and capped at 200; completions keep the last 50', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-watch-many-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'claude', 'projects', 'Z--Many');
  await fsp.mkdir(project, { recursive: true });
  const record = (sessionId, ms, extra) => JSON.stringify({ isSidechain: false, cwd: 'Z:\\Many', sessionId, timestamp: new Date(ms).toISOString(), entrypoint: 'cli', ...extra });
  for (let i = 0; i < 205; i += 1) {
    const sessionId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const ms = NOW - (i + 1) * MIN;
    await fsp.writeFile(
      path.join(project, `${sessionId}.jsonl`),
      `${[
        record(sessionId, ms - 1000, { type: 'user', message: { role: 'user', content: 'Made-up ask.' } }),
        record(sessionId, ms, { type: 'assistant', message: { id: `msg_${i}`, model: 'claude-demo-5', role: 'assistant', content: [{ type: 'text', text: 'Made-up answer.' }], stop_reason: 'end_turn' } }),
      ].join('\n')}\n`,
    );
  }
  const busyId = '11111111-0000-4000-8000-000000000060';
  const turns = [];
  for (let i = 0; i < 60; i += 1) {
    const ms = NOW - (60 - i) * 1000;
    turns.push(record(busyId, ms - 500, { type: 'user', message: { role: 'user', content: `Ask ${i}` } }));
    turns.push(record(busyId, ms, { type: 'assistant', message: { id: `msg_busy_${i}`, role: 'assistant', content: [{ type: 'text', text: `Answer ${i}` }], stop_reason: 'end_turn' } }));
  }
  await fsp.writeFile(path.join(project, `${busyId}.jsonl`), `${turns.join('\n')}\n`);

  const snap = await createWatcher({ claudeHome: path.join(root, 'claude'), codexHome: path.join(root, 'no-codex'), now: () => NOW, probeTools: false }).scan();
  assert.equal(snap.sources.claude.count, 206);
  assert.equal(snap.sessions.length, MAX_SESSIONS);
  for (let i = 1; i < snap.sessions.length; i += 1) {
    assert.ok(snap.sessions[i - 1].lastActivityAt >= snap.sessions[i].lastActivityAt, 'sorted by lastActivityAt desc');
  }
  const busy = snap.sessions[0];
  assert.equal(busy.sessionId, busyId);
  assert.equal(busy.turns, 60);
  assert.equal(busy.completions.length, 50);
  assert.equal(busy.completions[49], NOW - 1000);
  assert.equal(busy.completions[0], NOW - 50 * 1000);
  assert.equal(busy.source, 'cli');
});

// ---------------------------------------------------------------------------------------------
// Accuracy fixes found on real data

const rolloutLine = (ms, type, payload) => JSON.stringify({ timestamp: new Date(ms).toISOString(), type, payload });
const codexDay = (homes, day) => path.join(homes.codexHome, 'sessions', '2026', '09', day);

test('codex: thread_settings_applied and continuation files opened without work are not activity', async (t) => {
  const homes = await makeHomes(t);
  const segment = path.join(codexDay(homes, '25'), `rollout-2026-09-25T05-00-00-${CODEX_IDS.garden}_${CODEX_IDS.gardenSegment}.jsonl`);
  const opened = NOW - 5 * MIN;
  await fsp.appendFile(segment, `${[
    rolloutLine(opened, 'event_msg', { type: 'thread_settings_applied', thread_id: CODEX_IDS.garden }),
    rolloutLine(opened + 1000, 'event_msg', { type: 'thread_settings_applied', thread_id: CODEX_IDS.garden }),
  ].join('\n')}\n`);
  // Opening the thread again starts another continuation file with only bookkeeping in it.
  const reopenedId = '01a0e0a2-0000-7000-8000-0000000000a2';
  const reopened = path.join(codexDay(homes, '25'), `rollout-2026-09-25T07-58-00-${CODEX_IDS.garden}_${reopenedId}.jsonl`);
  await fsp.writeFile(reopened, `${[
    rolloutLine(NOW - 2 * MIN, 'session_meta', { id: CODEX_IDS.garden, session_id: CODEX_IDS.garden, timestamp: new Date(NOW - 2 * MIN).toISOString(), cwd: 'C:\\Users\\demo\\Projects\\Garden', originator: 'Codex Desktop', thread_source: 'user', history_base: { thread_id: CODEX_IDS.gardenSegment } }),
    rolloutLine(NOW - 2 * MIN, 'event_msg', { type: 'thread_settings_applied', thread_id: CODEX_IDS.garden }),
  ].join('\n')}\n`);
  // A thread with an open turn that is only opened again must not flip to working.
  const t2File = path.join(codexDay(homes, '25'), `rollout-2026-09-25T07-40-00-${CODEX_IDS.working}.jsonl`);
  await fsp.appendFile(t2File, `${rolloutLine(NOW - MIN, 'event_msg', { type: 'thread_settings_applied', thread_id: CODEX_IDS.working })}\n`);
  await fsp.utimes(t2File, new Date(NOW - MIN), new Date(NOW - MIN));

  const snap = await watcherFor(homes).scan();
  const garden = find(snap, codexId('garden'));
  assert.equal(garden.lastActivityAt, Date.parse('2026-09-25T09:03:00Z'), 'still the last real work');
  assert.equal(garden.status, 'done');
  assert.equal(garden.turns, 2);
  const t2 = find(snap, codexId('working'));
  assert.equal(t2.status, 'stopped');
  assert.equal(t2.live, false);
  assert.equal(t2.lastActivityAt, Date.parse('2026-09-25T11:41:02Z'));
});

test('codex: a rollout whose first line is still being written is left out until it is whole', async (t) => {
  const homes = await makeHomes(t);
  const watcher = watcherFor(homes);
  const reviewId = '01a0e0c1-0000-7000-8000-0000000000c1';
  const threadId = '01a0e0c2-0000-7000-8000-0000000000c2';
  const reviewFile = path.join(codexDay(homes, '25'), `rollout-2026-09-25T07-50-00-${reviewId}.jsonl`);
  const threadFile = path.join(codexDay(homes, '25'), `rollout-2026-09-25T07-51-00-${threadId}.jsonl`);
  const reviewMeta = rolloutLine(NOW - MIN, 'session_meta', {
    id: reviewId, session_id: CODEX_IDS.garden, timestamp: new Date(NOW - MIN).toISOString(), cwd: 'Z:\\Demo', originator: 'Codex Desktop',
    thread_source: 'guardian_review', source: { subagent: { other: 'guardian' } }, parent_thread_id: CODEX_IDS.garden, padding: 'x'.repeat(40000),
  });
  const threadMeta = rolloutLine(NOW - MIN, 'session_meta', {
    id: threadId, session_id: threadId, timestamp: new Date(NOW - MIN).toISOString(), cwd: 'Z:\\Demo', originator: 'Codex Desktop', thread_source: 'user', padding: 'x'.repeat(40000),
  });
  const base = (await watcher.scan()).sessions.length;

  await fsp.writeFile(reviewFile, '');
  await fsp.writeFile(threadFile, '');
  assert.equal((await watcher.scan()).sessions.length, base, 'empty new files are not threads yet');

  await fsp.writeFile(reviewFile, reviewMeta.slice(0, 8192));
  await fsp.writeFile(threadFile, threadMeta.slice(0, 8192));
  let snap = await watcher.scan();
  assert.equal(snap.sessions.length, base, 'no "Untitled session" from a half-written first line');
  assert.ok(!find(snap, `codex:${reviewId}`) && !find(snap, `codex:${threadId}`));

  await fsp.appendFile(reviewFile, `${reviewMeta.slice(8192)}\n`);
  await fsp.appendFile(threadFile, `${threadMeta.slice(8192)}\n${rolloutLine(NOW - MIN + 500, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Label the seed drawers' }] })}\n`);
  snap = await watcher.scan();
  assert.ok(!find(snap, `codex:${reviewId}`), 'the finished line says it is a review thread');
  const thread = find(snap, `codex:${threadId}`);
  assert.ok(thread, 'a top-level thread appears once its first line is whole');
  assert.equal(thread.title, 'Label the seed drawers');
  assert.equal(snap.sessions.length, base + 1);
  assert.equal((await parseCodexRollout(reviewFile)).subagent, true);
});

test('codex: imported copies of listed Claude sessions are left out; native turns after an import still count', async (t) => {
  const homes = await makeHomes(t);
  const importedAt = NOW - 3 * 60 * MIN;
  const copyId = '01a0e0d1-0000-7000-8000-0000000000d1';
  const continuedId = '01a0e0d2-0000-7000-8000-0000000000d2';
  const replay = (threadId, turnId) => [
    rolloutLine(importedAt + 10, 'event_msg', { type: 'task_started', turn_id: turnId, started_at: (importedAt - 24 * 60 * MIN) / 1000 }),
    rolloutLine(importedAt + 20, 'event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: 'Replayed reply.' }),
  ];
  const meta = (threadId) => rolloutLine(importedAt, 'session_meta', { id: threadId, session_id: threadId, timestamp: new Date(importedAt).toISOString(), cwd: 'Z:\\Demo', originator: 'Codex Desktop' });
  await fsp.writeFile(path.join(codexDay(homes, '25'), `rollout-2026-09-25T05-00-00-${copyId}.jsonl`), `${[meta(copyId), ...replay(copyId, 'imp-1')].join('\n')}\n`);
  const nativeAt = NOW - 30 * MIN;
  await fsp.writeFile(path.join(codexDay(homes, '25'), `rollout-2026-09-25T05-00-01-${continuedId}.jsonl`), `${[
    meta(continuedId), ...replay(continuedId, 'imp-2'),
    rolloutLine(nativeAt, 'turn_context', { turn_id: 'native-1', model: 'gpt-demo-codex', cwd: 'Z:\\Demo' }),
    rolloutLine(nativeAt + 100, 'event_msg', { type: 'task_started', turn_id: 'native-1', started_at: nativeAt / 1000 }),
    rolloutLine(nativeAt + 60000, 'event_msg', { type: 'task_complete', turn_id: 'native-1', last_agent_message: 'Codex added the drip line.', completed_at: (nativeAt + 60000) / 1000 }),
  ].join('\n')}\n`);
  const importsFile = path.join(homes.codexHome, 'external_agent_session_imports.json');
  const imports = JSON.parse(await fsp.readFile(importsFile, 'utf8'));
  const record = (threadId, sessionId) => ({
    source_path: `C:\\Users\\demo\\.claude\\projects\\Z--Demo\\${sessionId}.jsonl`, content_sha256: '0'.repeat(64),
    imported_thread_id: threadId, imported_at: Math.floor(importedAt / 1000), source_modified_at: 0, connector_names: [], title: 'Imported copy',
  });
  imports.records.push(record(copyId, CLAUDE_IDS.garden), record(continuedId, CLAUDE_IDS.done));
  await fsp.writeFile(importsFile, JSON.stringify(imports));

  const snap = await watcherFor(homes).scan();
  assert.ok(find(snap, claudeId('garden')), 'the Claude original stays');
  assert.ok(!find(snap, `codex:${copyId}`), 'the Codex copy of the same work is left out');
  assert.equal(snap.sources.codex.count, 7, 'six fixture threads plus the continued import');
  const continued = find(snap, `codex:${continuedId}`);
  assert.ok(continued, 'an import Codex kept working in stays listed');
  assert.equal(continued.turns, 1, 'only the native turn is Codex work');
  assert.deepEqual(continued.completions, [nativeAt + 60000]);
  assert.equal(continued.model, 'gpt-demo-codex');

  // Without the Claude original listed, the copy stays (it's the only record), with no turns credited.
  await fsp.rm(path.join(homes.claudeHome, 'projects', 'C--Users-demo-Projects-Garden', `${CLAUDE_IDS.garden}.jsonl`));
  const alone = find(await watcherFor(homes).scan(), `codex:${copyId}`);
  assert.ok(alone);
  assert.equal(alone.turns, 0);
});

test('claude: sessions deleted in the desktop app are dropped; archived ones are marked', async (t) => {
  const homes = await makeHomes(t);
  const demoDir = path.join(homes.claudeHome, 'projects', 'Z--Demo');
  const marker = (id, reason) => fsp.writeFile(path.join(demoDir, `${id}.desktop-released.json`), JSON.stringify({ v: 1, releasedAt: new Date(NOW - 60 * MIN).toISOString(), reason }));
  await marker(CLAUDE_IDS.stopped, 'delete');
  await marker(CLAUDE_IDS.untitled, 'archive');
  await fsp.writeFile(path.join(demoDir, `${CLAUDE_IDS.recent}.desktop-released.json`), '{"reason":');

  const watcher = watcherFor(homes);
  let snap = await watcher.scan();
  assert.ok(!find(snap, claudeId('stopped')), 'deleted in Claude: gone here too');
  assert.equal(find(snap, claudeId('untitled')).archived, true);
  assert.equal(find(snap, claudeId('recent')).archived, false, 'a broken marker is ignored');
  assert.equal(snap.sources.claude.count, 5);

  // A process running the deleted session right now keeps it visible.
  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.stopped, status: 'busy', name: 'Soil run' });
  await writeRegistry(homes.claudeHome, { pid: process.ppid, sessionId: CLAUDE_IDS.untitled, status: 'idle' });
  snap = await watcher.scan();
  assert.equal(find(snap, claudeId('stopped')).status, 'working');
  assert.equal(find(snap, claudeId('untitled')).archived, false, 'live sessions are never archived');
});

test('claude: a registry pid only counts while it belongs to the process that registered it', async (t) => {
  const homes = await makeHomes(t);
  let calls = 0;
  const probeWith = (answer) => async (pids) => {
    calls += 1;
    return answer(pids);
  };
  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'busy', name: 'Watering run' });

  // The pid is alive, but it now belongs to a process started at another time (pid reuse).
  const reused = watcherFor(homes, { processStarts: probeWith((pids) => new Map(pids.map((pid) => [pid, BigInt(PROC_START) + 10n ** 9n]))) });
  let session = find(await reused.scan(), claudeId('liveable'));
  assert.equal(session.live, false);
  assert.equal(session.status, 'done', 'transcript rules apply again');
  assert.equal(session.title, 'Start the watering schedule');
  assert.equal(calls, 1);
  await reused.scan();
  assert.equal(calls, 1, 'the verdict is cached per pid and procStart');

  // The process is gone by the time it is checked.
  session = find(await watcherFor(homes, { processStarts: probeWith(() => new Map()) }).scan(), claudeId('liveable'));
  assert.equal(session.live, false);

  // Matching creation time (within rounding), or a probe that can't answer: the pid check stands.
  session = find(await watcherFor(homes, { processStarts: probeWith(() => new Map([[process.pid, BigInt(PROC_START) - 7n]])) }).scan(), claudeId('liveable'));
  assert.equal(session.live, true);
  assert.equal(session.status, 'working');
  session = find(await watcherFor(homes, { processStarts: probeWith(() => { throw new Error('no CIM'); }) }).scan(), claudeId('liveable'));
  assert.equal(session.live, true);
  session = find(await watcherFor(homes, { processStarts: probeWith((pids) => new Map(pids.map((pid) => [pid, null]))) }).scan(), claudeId('liveable'));
  assert.equal(session.live, true, 'an unreadable creation time keeps the pid check');

  // No procStart in the entry: nothing to compare, so no probe runs.
  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'busy', procStart: null });
  calls = 0;
  session = find(await watcherFor(homes, { processStarts: probeWith(() => new Map()) }).scan(), claudeId('liveable'));
  assert.equal(session.live, true);
  assert.equal(calls, 0);

  // Pre-spawned spares and parked jobs are not sessions, as in Claude Code itself.
  const spareId = 'aaaabbbb-0000-4000-8000-000000000008';
  await writeRegistry(homes.claudeHome, { pid: process.ppid, sessionId: spareId, status: '', extra: { kind: 'bg', spare: true } });
  let snap = await watcherFor(homes).scan();
  assert.ok(!find(snap, `claude:${spareId}`));
  await writeRegistry(homes.claudeHome, { pid: process.ppid, sessionId: spareId, status: 'busy', extra: { parkedJobId: 'job-demo-1' } });
  snap = await watcherFor(homes).scan();
  assert.ok(!find(snap, `claude:${spareId}`));

  assert.equal(parseProcStart('134349184975353249'), 134349184975353249n);
  assert.equal(parseProcStart(' 42 '), null);
  assert.equal(parseProcStart('abc'), null);
  assert.equal(msToFileTime(0), 116444736000000000n);
});

test('processStartTimes reads real process creation times on Windows', { skip: process.platform !== 'win32' }, async () => {
  const times = await processStartTimes([process.pid, 4194303]);
  assert.ok(times instanceof Map);
  assert.ok(!times.has(4194303), 'a pid that is not running is missing');
  const created = times.get(process.pid);
  assert.equal(typeof created, 'bigint');
  const estimate = msToFileTime(Date.now() - process.uptime() * 1000);
  const diffMs = Number(created > estimate ? created - estimate : estimate - created) / 10000;
  assert.ok(diffMs < 5000, `creation time is within ${Math.round(diffMs)} ms of this process's start`);
});

test('claude: a new prompt after the last reply means the session is not "finished"', async (t) => {
  const homes = await makeHomes(t);
  const fFile = path.join(homes.claudeHome, 'projects', 'Z--Demo', `${CLAUDE_IDS.liveable}.jsonl`);
  const original = await fsp.readFile(fFile, 'utf8');
  const userRecord = (ms, content, extra = {}) => JSON.stringify({
    parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content }, uuid: `u-${ms}`,
    timestamp: new Date(ms).toISOString(), userType: 'external', entrypoint: 'claude-desktop', cwd: 'Z:\\Demo', sessionId: CLAUDE_IDS.liveable, ...extra,
  });

  // Chris asked again a minute ago and no reply has been written yet.
  await fsp.writeFile(fFile, `${original}${userRecord(NOW - MIN, 'Also water the herbs.', { origin: { kind: 'human' } })}\n`);
  let session = find(await watcherFor(homes).scan(), claudeId('liveable'));
  assert.equal(session.status, 'working');
  session = find(await watcherFor(homes, { now: () => NOW + 10 * MIN }).scan(), claudeId('liveable'));
  assert.equal(session.status, 'stopped', 'cancelled or cut off before any reply');
  assert.equal(session.statusDetail, 'Stopped partway');

  // File order decides, even when the prompt carries an older timestamp than records around it.
  await fsp.writeFile(fFile, `${original}${userRecord(Date.parse('2026-09-25T11:00:05Z'), 'One more thing.')}\n`);
  assert.equal(find(await watcherFor(homes, { now: () => NOW + 10 * MIN }).scan(), claudeId('liveable')).status, 'stopped');

  // Background notices, meta records and command echoes are not requests.
  await fsp.writeFile(fFile, `${original}${[
    userRecord(NOW - MIN, '<task-notification>made-up notice</task-notification>', { origin: { kind: 'task-notification' } }),
    userRecord(NOW - MIN, [{ type: 'text', text: 'Made-up reminder.' }], { isMeta: true }),
    userRecord(NOW - MIN, '<command-name>/tidy</command-name>'),
  ].join('\n')}\n`);
  assert.equal(find(await watcherFor(homes).scan(), claudeId('liveable')).status, 'done');

  assert.equal(isHumanPrompt({ type: 'user', message: { content: 'Plant the peas.' } }), true);
  assert.equal(isHumanPrompt({ type: 'user', origin: { kind: 'human' }, message: { content: [{ type: 'image' }] } }), true);
  assert.equal(isHumanPrompt({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), false);
  assert.equal(isHumanPrompt({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }), false);
  assert.equal(isHumanPrompt({ type: 'user', isCompactSummary: true, message: { content: 'Summary.' } }), false);
  assert.equal(isHumanPrompt({ type: 'assistant', message: { content: 'Hi.' } }), false);
});

test('claude: a live session busy with subagents takes its activity time from their writes', async (t) => {
  const homes = await makeHomes(t);
  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'busy', statusUpdatedAt: NOW - 40 * MIN });
  const agentFile = path.join(homes.claudeHome, 'projects', 'Z--Demo', CLAUDE_IDS.liveable, 'subagents', 'workflows', 'wf_demo', 'agent-demo.jsonl');
  await fsp.mkdir(path.dirname(agentFile), { recursive: true });
  await fsp.writeFile(agentFile, '{"isSidechain":true}\n');
  await fsp.utimes(agentFile, new Date(NOW - 20 * 1000), new Date(NOW - 20 * 1000));

  let snap = await watcherFor(homes).scan();
  let session = find(snap, claudeId('liveable'));
  assert.equal(session.status, 'working');
  assert.equal(session.lastActivityAt, NOW - 20 * 1000, 'the newest subagent write, not 40 minutes ago');
  assert.equal(snap.sessions[0].id, claudeId('liveable'), 'sorted with what is happening now');
  assert.equal(snap.sources.claude.count, 6, 'subagent files are still not sessions');

  // Not live: subagent files don't count.
  await fsp.rm(path.join(homes.claudeHome, 'sessions', `${process.pid}.json`));
  session = find(await watcherFor(homes).scan(), claudeId('liveable'));
  assert.equal(session.lastActivityAt, Date.parse('2026-09-25T11:00:10Z'));
});

test('future-dated activity (clock skew) never reads as working and never outranks now', async (t) => {
  const homes = await makeHomes(t);
  const ahead = NOW + 2 * 60 * MIN;
  const skewId = 'abababab-0000-4000-8000-0000000000ab';
  const claudeRecord = (ms, type, message) => JSON.stringify({
    parentUuid: null, isSidechain: false, type, message, uuid: `s-${ms}`, timestamp: new Date(ms).toISOString(), cwd: 'Z:\\Demo', sessionId: skewId, entrypoint: 'cli',
  });
  await fsp.writeFile(path.join(homes.claudeHome, 'projects', 'Z--Demo', `${skewId}.jsonl`), `${[
    claudeRecord(ahead, 'user', { role: 'user', content: 'Made-up ask.' }),
    claudeRecord(ahead + 1000, 'assistant', { id: 'msg_skew', role: 'assistant', content: [{ type: 'text', text: 'Made-up progress.' }], stop_reason: 'tool_use' }),
  ].join('\n')}\n`);
  const skewThread = '01a0e0e1-0000-7000-8000-0000000000e1';
  const skewFile = path.join(codexDay(homes, '25'), `rollout-2026-09-25T07-59-00-${skewThread}.jsonl`);
  await fsp.writeFile(skewFile, `${[
    rolloutLine(ahead, 'session_meta', { id: skewThread, session_id: skewThread, timestamp: new Date(ahead).toISOString(), cwd: 'Z:\\Demo', originator: 'Codex Desktop', thread_source: 'user' }),
    rolloutLine(ahead + 100, 'turn_context', { turn_id: 'skew-1', model: 'gpt-demo-codex' }),
    rolloutLine(ahead + 200, 'event_msg', { type: 'task_started', turn_id: 'skew-1' }),
  ].join('\n')}\n`);
  await fsp.utimes(skewFile, new Date(ahead), new Date(ahead));

  const snap = await watcherFor(homes).scan();
  const claude = find(snap, `claude:${skewId}`);
  assert.equal(claude.status, 'stopped');
  assert.ok(claude.lastActivityAt <= NOW && claude.startedAt <= claude.lastActivityAt);
  const codex = find(snap, `codex:${skewThread}`);
  assert.equal(codex.status, 'stopped');
  assert.equal(codex.live, false);
  assert.ok(codex.lastActivityAt <= NOW);
  for (const session of snap.sessions) assert.ok(session.lastActivityAt <= NOW, `${session.id} is not in the future`);
});

// ---------------------------------------------------------------------------------------------
// Tools

test('jev: installed from the router stats file, detail from sent_to and cost', async (t) => {
  const homes = await makeHomes(t);
  let jev = await readJevTool(homes.claudeHome);
  assert.deepEqual(jev, {
    id: 'jev',
    name: 'Jev',
    kind: 'cloud',
    installed: true,
    active: true,
    detail: 'Router on · 14 messages sized · $0.0004',
    note: 'Cloud service. When the router is on, message text goes to TypeSafe.',
  });

  const stateFile = path.join(homes.claudeHome, 'jev-router', 'state.json');
  await fsp.writeFile(stateFile, JSON.stringify({ enabled: false, sent_to: { tiny: 0, everyday: 0, large: 1, hardest: 0 }, cost_usd: 0.000021966 }));
  jev = await readJevTool(homes.claudeHome);
  assert.equal(jev.active, false);
  assert.equal(jev.detail, 'Router off · 1 message sized · under $0.0001');

  await fsp.writeFile(stateFile, '{ not json');
  jev = await readJevTool(homes.claudeHome);
  assert.equal(jev.installed, true);
  assert.equal(jev.active, false);

  await fsp.rm(stateFile);
  jev = await readJevTool(homes.claudeHome);
  assert.equal(jev.installed, false);
  assert.equal(jev.active, false);

  assert.equal(formatCost(0), '$0');
  assert.equal(formatCost(0.0004), '$0.0004');
  assert.equal(formatCost(1.234), '$1.23');
});

test('whisper and ollama: probed once per launch, injected in tests, skipped when probeTools is off', async (t) => {
  const homes = await makeHomes(t);
  let whisperCalls = 0;
  let ollamaCalls = 0;
  const probes = createToolProbes({
    checkWhisper: async () => {
      whisperCalls += 1;
      return true;
    },
    fetchTags: async () => {
      ollamaCalls += 1;
      return { models: ['llama-demo', 'qwen-demo', 'phi-demo', 'extra-demo'] };
    },
  });
  let tools = await detectTools({ claudeHome: homes.claudeHome, localAppData: homes.localAppData, probes });
  await detectTools({ claudeHome: homes.claudeHome, localAppData: homes.localAppData, probes });
  assert.deepEqual(tools.map((tool) => tool.id), ['jev', 'whisper', 'ollama']);
  assert.equal(whisperCalls, 1, 'whisper check runs once and is cached');
  assert.equal(ollamaCalls, 2, 'ollama is probed each scan');
  assert.deepEqual(
    { installed: tools[1].installed, active: tools[1].active, detail: tools[1].detail, kind: tools[1].kind },
    { installed: true, active: true, detail: 'Speech to text, runs on your PC', kind: 'local' },
  );
  assert.deepEqual(
    { installed: tools[2].installed, active: tools[2].active, detail: tools[2].detail },
    { installed: true, active: true, detail: 'Running · llama-demo, qwen-demo, phi-demo' },
  );

  // Ollama not answering: installed only if its exe is where the installer puts it.
  const down = createToolProbes({ checkWhisper: async () => false, fetchTags: async () => null });
  tools = await detectTools({ claudeHome: homes.claudeHome, localAppData: homes.localAppData, probes: down });
  assert.equal(tools[1].installed, false);
  assert.equal(tools[1].active, false);
  assert.deepEqual(
    { installed: tools[2].installed, active: tools[2].active, detail: tools[2].detail },
    { installed: false, active: false, detail: 'Not installed. Local models would live here.' },
  );
  const exe = path.join(homes.localAppData, 'Programs', 'Ollama', 'ollama.exe');
  await fsp.mkdir(path.dirname(exe), { recursive: true });
  await fsp.writeFile(exe, '');
  tools = await detectTools({ claudeHome: homes.claudeHome, localAppData: homes.localAppData, probes: down });
  assert.equal(tools[2].installed, true);
  assert.equal(tools[2].active, false);

  // probeTools off: no spawn, no port.
  const snap = await watcherFor(homes).scan();
  assert.equal(snap.tools[1].installed, false);
  assert.equal(snap.tools[2].installed, true, 'exe check still works without probing');
  assert.equal(snap.tools[2].active, false);
});

// ---------------------------------------------------------------------------------------------
// Contract shape and privacy

test('snapshot matches the contract shape and survives JSON (IPC) round trips', async (t) => {
  const homes = await makeHomes(t);
  await writeRegistry(homes.claudeHome, { sessionId: CLAUDE_IDS.liveable, status: 'busy', name: 'Watering run' });
  const snap = await watcherFor(homes).scan();
  assert.equal(snap.scannedAt, NOW);
  assert.deepEqual(Object.keys(snap).sort(), ['scannedAt', 'sessions', 'sources', 'tools']);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);

  const keys = ['agent', 'archived', 'completions', 'cwd', 'id', 'lastActivityAt', 'lastMessage', 'live', 'model', 'project', 'sessionId', 'source', 'startedAt', 'status', 'statusDetail', 'title', 'turns'];
  const ids = new Set();
  for (const s of snap.sessions) {
    assert.deepEqual(Object.keys(s).sort(), keys, s.id);
    assert.ok(!ids.has(s.id));
    ids.add(s.id);
    assert.equal(s.id, `${s.agent}:${s.sessionId}`);
    assert.ok(['claude', 'codex'].includes(s.agent));
    assert.ok(typeof s.title === 'string' && s.title.length > 0 && s.title.length <= 80);
    assert.ok(typeof s.lastMessage === 'string' && s.lastMessage.length <= 200);
    assert.equal(s.statusDetail, STATUS_DETAIL[s.status]);
    assert.ok(Number.isFinite(s.startedAt) && Number.isFinite(s.lastActivityAt));
    assert.ok(Array.isArray(s.completions) && s.completions.length <= 50);
    assert.deepEqual([...s.completions].sort((a, b) => a - b), s.completions);
    assert.ok(Number.isInteger(s.turns) && s.turns >= s.completions.length);
    for (const field of ['project', 'cwd', 'model', 'source']) assert.equal(typeof s[field], 'string');
    for (const field of ['live', 'archived']) assert.equal(typeof s[field], 'boolean');
  }
  const statuses = new Set(snap.sessions.map((s) => s.status));
  assert.deepEqual([...statuses].sort(), ['done', 'stopped', 'working']);

  for (const tool of snap.tools) {
    assert.deepEqual(Object.keys(tool).sort(), ['active', 'detail', 'id', 'installed', 'kind', 'name', 'note']);
  }
  assert.deepEqual(snap.tools.map((tool) => [tool.id, tool.kind]), [['jev', 'cloud'], ['whisper', 'local'], ['ollama', 'local']]);
  for (const key of ['claude', 'codex']) {
    const source = snap.sources[key];
    assert.equal(source.ok, true);
    assert.equal(typeof source.path, 'string');
    assert.equal(typeof source.count, 'number');
    assert.equal(typeof source.live, 'boolean');
  }
});

test('scanning never writes to the watched homes', async (t) => {
  const homes = await makeHomes(t);
  const fingerprint = async () => {
    const files = [...(await listFiles(homes.claudeHome)), ...(await listFiles(homes.codexHome))].sort();
    return Promise.all(files.map(async (file) => {
      const stat = await fsp.stat(file);
      return [path.relative(homes.root, file), stat.size, stat.mtimeMs];
    }));
  };
  const before = await fingerprint();
  const watcher = watcherFor(homes);
  await watcher.scan();
  await watcher.scan();
  watcher.dispose();
  assert.deepEqual(await fingerprint(), before);
});
