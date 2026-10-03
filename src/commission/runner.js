// Running a commission (PLAN.md Phase 6): one of the crew's CLIs, in the one folder Chris picked,
// under the ward he chose. Built on the architect's process runner (an argument array, never a
// shell; a hidden window; a time limit; a kill switch).
//
// What a ward allows is set by the CLI's own switches, not by asking nicely:
//   look, suggest   Claude: only its Read, Glob and Grep tools. Codex: its read-only sandbox.
//   change          Claude: those, plus Edit and Write, with edits accepted inside the folder.
//                   Codex: its workspace-write sandbox, which is the folder and nothing else.
// Neither is given a shell by MILO (Claude has no Bash tool here; Codex's commands stay inside its
// sandbox), and nothing here commits, pushes, installs or deletes.
//
// The folder is checked on the real disk before anything starts: it must exist, be a directory,
// and its real path (links followed) must still pass commissions.folderProblem.
// Node only. Main process only.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runProcess, findClaude, findCodex, childEnv, claudeEnv, extractJson, CLAUDE_MODEL, TEMP_PREFIX } from '../architect/crew.js';
import { folderProblem, briefFor, wardWrites, WARDS, CREW, LIMITS, CHECK_LIMIT_MS } from '../commissions.js';

/** How long a commission may be out. */
export const RUN_LIMIT_MS = 20 * 60 * 1000;
const FAKE_MS = 400; // the test crew's pace; MILO_COMMISSION_MS slows it so a queue can form
const WALK_LIMIT = 6000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'out', '.next', 'target']);

const READ_TOOLS = Object.freeze(['Read', 'Glob', 'Grep']);
const WRITE_TOOLS = Object.freeze([...READ_TOOLS, 'Edit', 'Write']);

/** Claude Code for a commission: print mode, a JSON envelope, and only the tools the ward allows. */
export function claudeRunArgs(ward) {
  const writes = wardWrites(ward);
  return [
    '-p', '--output-format', 'json',
    '--tools', (writes ? WRITE_TOOLS : READ_TOOLS).join(','),
    // Only the change ward accepts edits. The read wards have no tool that could make one.
    ...(writes ? ['--permission-mode', 'acceptEdits'] : []),
    '--no-session-persistence', '--setting-sources', 'project', '--model', CLAUDE_MODEL,
  ];
}

/** Codex for a commission: one ephemeral exec rooted at the folder, in the sandbox the ward allows. */
export function codexRunArgs(ward, folder, outFile) {
  return [
    'exec', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', wardWrites(ward) ? 'workspace-write' : 'read-only',
    '--ignore-user-config', '-c', 'web_search="disabled"',
    '-C', folder, '-o', outFile, '--color', 'never', '-',
  ];
}

/**
 * The folder as it really is on disk. → { ok: true, folder } (its real path) or { ok: false, why }.
 * `home` and `own` are Chris's home folder and MILO's own.
 */
export async function checkFolder(folder, { home = os.homedir(), own = '' } = {}) {
  const first = folderProblem(folder, { home, own });
  if (first) return { ok: false, why: first };
  let real;
  try {
    real = await fsp.realpath(folder.trim());
    const stat = await fsp.stat(real);
    if (!stat.isDirectory()) return { ok: false, why: 'That’s a file. Pick a folder.' };
  } catch {
    return { ok: false, why: 'That folder isn’t there.' };
  }
  const again = folderProblem(real, { home, own });
  if (again) return { ok: false, why: again };
  return { ok: true, folder: real };
}

/** A crew answer as { summary, files }: the closing lines that look like paths are the files. */
export function readAnswer(textValue) {
  const lines = String(textValue || '').replace(/\r\n?/g, '\n').trim().split('\n');
  const files = [];
  while (lines.length) {
    const line = lines[lines.length - 1].trim();
    const item = line.replace(/^[-*•]\s+/, '').replace(/^`|`$/g, '').trim();
    if (!line) { lines.pop(); continue; }
    if (item !== line && /[\\/.]/.test(item) && !/\s{2,}/.test(item) && item.length <= LIMITS.file && files.length < LIMITS.files) { files.unshift(item); lines.pop(); continue; }
    break;
  }
  return { summary: lines.join('\n').trim().slice(0, LIMITS.summary), files };
}

/** The files under `folder` changed at or after `since` (ms), as paths from the folder. Stops at a few thousand entries. */
export async function changedSince(folder, since) {
  const out = [];
  let seen = 0;
  async function walk(dir, rel) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (seen >= WALK_LIMIT || out.length >= LIMITS.files) return;
      seen += 1;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), next);
      } else if (entry.isFile()) {
        try { if ((await fsp.stat(path.join(dir, entry.name))).mtimeMs >= since) out.push(next); } catch { /* gone */ }
      }
    }
  }
  await walk(folder, '');
  return out.sort();
}

const WHY = Object.freeze({
  missing: 'They aren’t set up on this PC.',
  auth: 'They need signing in again.',
  timeout: 'It took too long, so MILO called them back.',
  spawn: 'MILO couldn’t start them.',
  failed: 'They came back without an answer.',
});
const AUTH = /not logged in|please (log|sign) ?in|failed to authenticate|authentication (failed|required|error)|401 unauthorized|token (has )?expired|invalid api key/i;

/**
 * A runner. `mode` 'fake' never starts a CLI: it answers from the folder's own top-level names
 * (and, under the change ward, writes one small file there), for the tests.
 * run(commission) → Promise<{ ok, stopped, summary, files, ms, why }>; cancel() stops the one that's out.
 */
export function createRunner({ env = process.env, home = os.homedir(), own = '', mode = 'auto', spawnImpl = null, limitMs = RUN_LIMIT_MS, now = () => Date.now() } = {}) {
  let kill = null;
  let busy = false;
  let stopped = false;

  async function fake(c, folder) {
    const pace = Number(env.MILO_COMMISSION_MS) > 0 ? Math.min(Number(env.MILO_COMMISSION_MS), 30_000) : FAKE_MS;
    await new Promise((resolve) => { const t = setTimeout(resolve, pace); kill = () => { clearTimeout(t); resolve(); }; });
    if (stopped) return { ok: false, stopped: true };
    const names = (await fsp.readdir(folder, { withFileTypes: true })).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().slice(0, 8);
    if (wardWrites(c.ward)) await fsp.writeFile(path.join(folder, 'COMMISSION.txt'), `${c.title}\n`);
    return { ok: true, text: `${c.who === 'codex' ? 'Codex' : 'Claude'} read ${names.length} ${names.length === 1 ? 'thing' : 'things'} in the folder.\n${names.map((n) => `- ${n}`).join('\n')}` };
  }

  async function real(c, folder) {
    const prompt = briefFor(c);
    const base = childEnv(env);
    if (c.who === 'codex') {
      const bin = findCodex({ env });
      if (!bin) return { ok: false, code: 'missing' };
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
      const outFile = path.join(tmp, 'answer.txt');
      try {
        const proc = runProcess({ command: bin, args: codexRunArgs(c.ward, folder, outFile), input: prompt, cwd: folder, env: base, timeoutMs: limitMs, spawnImpl });
        kill = proc.kill;
        const run = await proc.promise;
        if (run.error) return { ok: false, code: run.error };
        let answer = '';
        try { answer = await fsp.readFile(outFile, 'utf8'); } catch { answer = ''; }
        if (answer.trim()) return { ok: true, text: answer };
        return { ok: false, code: AUTH.test(String(run.stderr).slice(-3000)) ? 'auth' : 'failed' };
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    }
    const bin = findClaude({ env });
    if (!bin) return { ok: false, code: 'missing' };
    const proc = runProcess({ command: bin, args: claudeRunArgs(c.ward), input: prompt, cwd: folder, env: claudeEnv(base), timeoutMs: limitMs, spawnImpl });
    kill = proc.kill;
    const run = await proc.promise;
    if (run.error) return { ok: false, code: run.error };
    const envelope = extractJson(run.stdout);
    const answer = envelope && typeof envelope.result === 'string' ? envelope.result : '';
    if (answer.trim() && !envelope.is_error) return { ok: true, text: answer };
    return { ok: false, code: AUTH.test(`${answer}\n${String(run.stderr).slice(-3000)}`) ? 'auth' : 'failed' };
  }

  async function run(commission) {
    const c = commission && typeof commission === 'object' ? commission : {};
    const started = now();
    const done = (rest) => ({ ok: false, stopped: false, summary: '', files: [], why: '', ...rest, ms: Math.max(0, now() - started) });
    if (busy) return done({ why: 'One at a time. Another commission is still out.' });
    if (!CREW.includes(c.who) || !WARDS.includes(c.ward) || typeof c.brief !== 'string' || !c.brief.trim()) return done({ why: 'That commission isn’t complete.' });
    const checked = await checkFolder(c.folder, { home, own });
    if (!checked.ok) return done({ why: checked.why });
    busy = true;
    stopped = false;
    try {
      const r = mode === 'fake' ? await fake(c, checked.folder) : await real(c, checked.folder);
      if (stopped || r.code === 'cancelled' || r.stopped) return done({ stopped: true, why: 'You called them back.' });
      if (!r.ok) return done({ why: WHY[r.code] || WHY.failed });
      const answer = readAnswer(r.text);
      // Under the change ward, the files that really changed are read off the disk, not taken on trust.
      const files = wardWrites(c.ward) ? await changedSince(checked.folder, started - 2000) : answer.files;
      return done({ ok: true, summary: answer.summary, files });
    } catch (error) {
      return done({ why: WHY.failed, error: String(error && error.message) });
    } finally {
      busy = false;
      kill = null;
    }
  }

  function cancel() {
    if (!busy) return false;
    stopped = true;
    try { if (typeof kill === 'function') kill(); } catch { /* already gone */ }
    return true;
  }

  /** Which of the crew are set up here (their CLI was found). */
  const crew = () => (mode === 'fake' ? { claude: true, codex: true } : { claude: Boolean(findClaude({ env })), codex: Boolean(findCodex({ env })) });

  return { run, cancel, crew, get busy() { return busy; }, mode };
}

/** A check command as the words it is made of: spaces split it, quotes keep a path together. */
export function commandWords(command) {
  const words = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(command || ''))) !== null) words.push(m[1] !== undefined ? m[1] : m[2]);
  return words;
}

/**
 * Runs a building's check in its folder, as Chris would in a terminal there (through cmd.exe on
 * Windows, so `npm test` works), with a time limit and the same kill switch. Only Chris sets a
 * check; the crew can't. → { ok (it exited 0), tail (the last of what it printed), ms, why }
 * In 'fake' mode nothing runs: a check that says "fail" fails and anything else passes.
 */
export async function runCheck(folder, command, { home = os.homedir(), own = '', env = process.env, mode = 'auto', spawnImpl = null, limitMs = CHECK_LIMIT_MS, now = () => Date.now(), onKill = () => {} } = {}) {
  const started = now();
  const done = (rest) => ({ ok: false, tail: '', why: '', ...rest, ms: Math.max(0, now() - started) });
  const words = commandWords(command);
  if (!words.length || String(command).length > LIMITS.check) return done({ why: 'Set a check first.' });
  const checked = await checkFolder(folder, { home, own });
  if (!checked.ok) return done({ why: checked.why });
  if (mode === 'fake') {
    const fails = /\bfail/i.test(command);
    return done({ ok: !fails, tail: fails ? '1 failing' : 'all passing' });
  }
  const shell = process.platform === 'win32' ? (env.ComSpec || env.COMSPEC || 'cmd.exe') : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/c', ...words] : ['-c', String(command)];
  const proc = runProcess({ command: shell, args, cwd: checked.folder, env: childEnv(env), timeoutMs: limitMs, spawnImpl });
  onKill(proc.kill);
  const run = await proc.promise;
  const tail = `${run.stdout || ''}${run.stderr ? `\n${run.stderr}` : ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-LIMITS.tail);
  if (run.error === 'timeout') return done({ tail, why: 'The check took too long, so MILO stopped it.' });
  if (run.error) return done({ tail, why: 'MILO couldn’t run the check.' });
  return done({ ok: run.code === 0, tail });
}

/** Whether a path is a folder that exists (for the folder picker's answer). */
export const isFolder = (folder) => { try { return fs.statSync(folder).isDirectory(); } catch { return false; } };
