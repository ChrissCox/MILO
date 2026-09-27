// Asking Chris's crew (Claude Code, Codex) for plans by running their CLIs headlessly.
//
// Every call: an argument array (never a shell), a fresh empty temp directory as the working
// directory, the brief on stdin, a hidden window, a time limit, and a kill switch. Output is
// untrusted data: it is parsed as JSON and handed to the validators, nothing else.
// Node only. Main process only.

import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CREW_TIMEOUT_MS = 150 * 1000;
export const PROBE_TIMEOUT_MS = 10 * 1000;
export const KILL_GRACE_MS = 3000;
const TASKKILL_WAIT_MS = 1500;
const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 256 * 1024;

export const CLAUDE_MODEL = 'sonnet';
export const CLAUDE_AUTH_ARGS = Object.freeze(['auth', 'status', '--json']);
export const CODEX_LOGIN_ARGS = Object.freeze(['login', 'status']);

/** Claude Code: print mode, JSON result with structured output, no tools, no saved session, no user hooks. */
export function claudeArgs(schema) {
  const text = typeof schema === 'string' ? schema : JSON.stringify(schema);
  return [
    '-p', '--output-format', 'json', '--json-schema', text, '--tools', '', '--no-session-persistence',
    '--setting-sources', 'project', '--model', CLAUDE_MODEL,
  ];
}

/**
 * Codex settings that keep a design call to the brief. Left alone, `codex exec` adds its own
 * context to every request: a skills block (Chris's ~/.agents/skills names, full descriptions and
 * SKILL.md paths), environment and permission notes, and tools that can run commands and read
 * files. Checked against codex-cli 0.158 with a localhost capture of the request (2026-09-27):
 * with these, the skills block, the environment and permission notes, the shell, unified exec,
 * view_image, web search and the app and plugin tools are gone, and the code-mode `exec` tool
 * fails closed. They are all `-c` overrides on purpose: Codex ignores an unknown `-c` key (with a
 * warning) but exits on an unknown `--disable` feature, and it updates itself often.
 * What they can't remove: Codex's own base instructions, its sub-agent tools (a sub-agent gets
 * the same locked-down tools), and a ~/.codex/AGENTS.md if Chris ever writes one (codexAgentsFile).
 */
export const CODEX_LOCKDOWN = Object.freeze([
  'skills.include_instructions=false',
  'skills.bundled.enabled=false',
  'features.shell_tool=false',
  'features.unified_exec=false',
  'features.code_mode_host=false',
  'features.view_image=false',
  'features.apps=false',
  'features.plugins=false',
  'features.browser_use=false',
  'features.computer_use=false',
  'features.image_generation=false',
  'features.tool_suggest=false',
  'features.skill_search=false',
  'features.goals=false',
  'features.memories=false',
  'features.hooks=false',
  'features.multi_agent=false',
  'features.sleep_tool=false',
  'include_environment_context=false',
  'include_permissions_instructions=false',
  'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false',
  'tools.web_search=false',
  'tools.experimental_request_user_input.enabled=false',
  'web_search="disabled"',
]);

/** Codex: one ephemeral, read-only exec in `dir`, locked down, schema-checked answer written to out.json. */
export function codexArgs(dir) {
  return [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules',
    ...CODEX_LOCKDOWN.flatMap((setting) => ['-c', setting]),
    '-C', dir, '--output-schema', path.join(dir, 'schema.json'), '-o', path.join(dir, 'out.json'), '--color', 'never', '-',
  ];
}

/**
 * Codex always adds $CODEX_HOME/AGENTS.md (or AGENTS.override.md) to its requests, and no setting
 * turns that off. MILO only checks whether such a file is there (it never opens it), so Automatic
 * mode can leave Codex out and say why. Returns the file's name, or null.
 */
export function codexAgentsFile({ env = process.env, home = os.homedir() } = {}) {
  const codexHome = envGet(env, 'CODEX_HOME') || path.join(home, '.codex');
  for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
    try {
      const stat = fs.statSync(path.join(codexHome, name));
      if (stat.isFile() && stat.size > 0) return name;
    } catch {
      // not there
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Finding the binaries

/** Case-insensitive environment lookup (Windows keeps 'Path', copies may say 'PATH'). */
export function envGet(env, name) {
  if (!env) return undefined;
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((item) => item.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Compares '2.1.281' style versions numerically; non-numeric parts compare as text. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/);
  const pb = String(b).split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] === undefined ? '' : pa[i];
    const y = pb[i] === undefined ? '' : pb[i];
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

const exeName = (name, platform) => (platform === 'win32' ? `${name}.exe` : name);

/**
 * Claude Code: MILO_CLAUDE_BIN > %USERPROFILE%\.local\bin\claude.exe > newest
 * %APPDATA%\Claude\claude-code\<version>\claude.exe. Returns the path or null.
 */
export function findClaude({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const override = envGet(env, 'MILO_CLAUDE_BIN');
  if (override) return isFile(override) ? override : null;
  const exe = exeName('claude', platform);
  const local = path.join(envGet(env, 'USERPROFILE') || home, '.local', 'bin', exe);
  if (isFile(local)) return local;
  const root = path.join(envGet(env, 'APPDATA') || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude-code');
  const found = subdirs(root)
    .map((version) => ({ version, file: path.join(root, version, exe) }))
    .filter((item) => isFile(item.file))
    .sort((a, b) => compareVersions(b.version, a.version) || mtime(b.file) - mtime(a.file));
  return found.length ? found[0].file : null;
}

/**
 * Codex: MILO_CODEX_BIN > newest %LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe > codex on PATH.
 * (An npm codex.cmd shim can't run without a shell, so only a real executable counts.)
 */
export function findCodex({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const override = envGet(env, 'MILO_CODEX_BIN');
  if (override) return isFile(override) ? override : null;
  const exe = exeName('codex', platform);
  const root = path.join(envGet(env, 'LOCALAPPDATA') || path.join(home, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  const found = subdirs(root)
    .map((dir) => path.join(root, dir, exe))
    .filter(isFile)
    .sort((a, b) => mtime(b) - mtime(a));
  if (found.length) return found[0];
  const searchPath = String(envGet(env, 'PATH') || '').split(path.delimiter).filter(Boolean);
  for (const dir of searchPath) {
    const file = path.join(dir, exe);
    if (isFile(file)) return file;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Environment and processes

const NESTED_MARKERS = /^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT)$/i;
const NESTED_VARS = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_BASE_URL)$/i;

/**
 * The environment a crew CLI runs with. When MILO itself was started from inside a Claude Code
 * session, that session's markers, tokens and proxy address are left out, so the crew call is a
 * plain run of Chris's own CLI (as when MILO starts from its shortcut).
 */
export function childEnv(env = process.env) {
  const nested = Object.keys(env).some((key) => NESTED_MARKERS.test(key));
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || /^ELECTRON_RUN_AS_NODE$/i.test(key)) continue;
    if (nested && NESTED_VARS.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Claude Code's environment for a crew call: the plain child environment, plus two switches that
 * keep Chris's memory out of it. Claude Code reads CLAUDE.md files from every folder above its
 * working directory (the temp folder is under C:\Users\chris, so that takes in ~/.claude/CLAUDE.md,
 * ~/.claude/rules and C:\Users\chris\CLAUDE.md, whatever --setting-sources says), and its auto
 * memory makes a ~/.claude/projects/<temp folder>/memory folder on every run. Both were checked
 * against claude 2.1.241 with a localhost capture (2026-09-27). Added after childEnv, which drops
 * CLAUDE_CODE_* variables when MILO runs inside a Claude Code session.
 */
export function claudeEnv(env = process.env) {
  return { ...env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
}

/**
 * Stops a crew process and everything it started. On Windows the tree goes first (taskkill /T
 * needs the root alive to find its children), and the root is ended only once taskkill is done,
 * or if taskkill can't run or hangs.
 */
function killTree(child, realProcess) {
  if (!child) return;
  let ended = false;
  const endRoot = () => {
    if (ended) return;
    ended = true;
    try {
      child.kill();
    } catch {
      // already gone
    }
  };
  if (realProcess && process.platform === 'win32' && child.pid && child.exitCode === null) {
    try {
      const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
      const killer = nodeSpawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', shell: false,
      });
      killer.on('exit', endRoot);
      killer.on('error', endRoot);
      const backstop = setTimeout(endRoot, TASKKILL_WAIT_MS);
      if (typeof backstop.unref === 'function') backstop.unref();
      return;
    } catch {
      // fall through to child.kill()
    }
  }
  endRoot();
}

/**
 * Runs one process. Resolves (never rejects) with
 * { code, signal, stdout, stderr, error: null | 'timeout' | 'cancelled' | 'spawn', ms }.
 * `kill(reason)` stops it early. A `.js`/`.mjs`/`.cjs` command runs under this Node (tests).
 */
export function runProcess({ command, args = [], input = '', cwd, env, timeoutMs = CREW_TIMEOUT_MS, spawnImpl } = {}) {
  let child = null;
  let settled = false;
  let stopped = null;
  let stop = () => {};
  const started = Date.now();
  const promise = new Promise((resolve) => {
    let timer = null;
    let grace = null;
    let stdout = '';
    let stderr = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (grace) clearTimeout(grace);
      resolve({ code: null, signal: null, stdout, stderr, error: stopped, ...result, ms: Date.now() - started });
    };
    let launchCommand = command;
    let launchArgs = [...args];
    const options = { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] };
    if (!spawnImpl && /\.(c|m)?js$/i.test(String(command))) {
      launchCommand = process.execPath;
      launchArgs = [command, ...args];
      if (process.versions.electron) options.env = { ...(env || process.env), ELECTRON_RUN_AS_NODE: '1' };
    }
    try {
      child = (spawnImpl || nodeSpawn)(launchCommand, launchArgs, options);
    } catch (error) {
      finish({ error: 'spawn', message: error && error.message });
      return;
    }
    if (!child) {
      finish({ error: 'spawn' });
      return;
    }
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { if (stdout.length < MAX_STDOUT) stdout += chunk; });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { if (stderr.length < MAX_STDERR) stderr += chunk; });
    }
    child.on('error', (error) => finish({ error: stopped || 'spawn', message: error && error.message, stdout, stderr }));
    child.on('close', (code, signal) => finish({ code, signal, stdout, stderr }));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    stop = (reason) => {
      if (settled || stopped) return;
      stopped = reason;
      killTree(child, !spawnImpl);
      grace = setTimeout(() => finish({ stdout, stderr }), KILL_GRACE_MS);
    };
    timer = setTimeout(() => stop('timeout'), timeoutMs);
  });
  return {
    promise,
    kill(reason = 'cancelled') {
      stop(reason);
    },
  };
}

export const TEMP_PREFIX = 'milo-crew-';

async function makeTempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
}

/**
 * Removes MILO's own crew folders (os.tmpdir()/milo-crew-*) left behind by a crash or a hard
 * stop, once they are older than `olderThanMs` (so a call still running in another MILO window
 * keeps its folder). Resolves to the number removed. Nothing else in the temp folder is touched.
 */
export async function sweepCrewTempDirs({ olderThanMs, now = Date.now(), tmp = os.tmpdir() } = {}) {
  let removed = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(tmp, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;
    const dir = path.join(tmp, entry.name);
    try {
      const stat = await fsp.stat(dir);
      if (now - stat.mtimeMs < olderThanMs) continue;
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      removed += 1;
    } catch {
      // in use or already gone
    }
  }
  return removed;
}

async function removeDir(dir) {
  if (!dir) return;
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------
// Reading answers

/** The first JSON object in a text (bare, fenced, or wrapped in prose), or null. */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const attempts = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) attempts.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // try the next shape
    }
  }
  return null;
}

const CLAUDE_AUTH = /failed to authenticate|not logged in|please run \/login|invalid api key|authentication_error|authentication (failed|required)|oauth token (has )?expired|login required|\b401\b/i;
const CODEX_AUTH = /not logged in|please (log|sign) ?in|codex login|401 unauthorized|\bunauthorized\b|refresh token|token (has )?expired|invalid api key|authentication (failed|required|error)/i;

function parseEnvelope(stdout) {
  const whole = extractJson(stdout);
  if (whole && ('result' in whole || 'structured_output' in whole || 'is_error' in whole)) return whole;
  const lines = String(stdout || '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const value = extractJson(line);
    if (value && (value.type === 'result' || 'structured_output' in value)) return value;
  }
  return whole;
}

/** Turns a finished Claude run into { ok, data } or { ok: false, code: 'auth'|'timeout'|'cancelled'|'spawn'|'failed'|'invalid' }. */
export function interpretClaude(run) {
  const base = { ms: run.ms };
  if (run.error === 'cancelled' || run.error === 'timeout' || run.error === 'spawn') return { ...base, ok: false, code: run.error };
  const envelope = parseEnvelope(run.stdout);
  const structured = envelope && envelope.structured_output && typeof envelope.structured_output === 'object' ? envelope.structured_output : null;
  if (structured && !envelope.is_error) return { ...base, ok: true, data: structured, loose: false };
  const resultText = envelope && typeof envelope.result === 'string' ? envelope.result : '';
  const failed = !envelope || envelope.is_error || run.code !== 0;
  if (failed && CLAUDE_AUTH.test(`${resultText}\n${String(run.stderr).slice(-4000)}\n${envelope ? '' : String(run.stdout).slice(-4000)}`)) {
    return { ...base, ok: false, code: 'auth' };
  }
  if (!failed || resultText) {
    const loose = extractJson(resultText);
    if (loose && !envelope.is_error) return { ...base, ok: true, data: loose, loose: true };
  }
  return { ...base, ok: false, code: failed ? 'failed' : 'invalid' };
}

// Codex's own error and warning lines: 'ERROR: unexpected status 401 Unauthorized: ...' or a
// timestamped '2026-09-27T01:24:29Z ERROR codex_api: ...'. `codex exec` also echoes the whole brief
// to stderr under a 'user' line, and the brief carries Chris's words (building names, skill
// descriptions), so only these lines are read for sign-in trouble. Every value Chris supplies
// sits mid-line after a fixed label in the brief, so none of them can start one of these lines.
const CODEX_OWN_LINE = /^(?:\d{4}-\d\d-\d\dT\S+\s+)?(?:ERROR|Error|error|WARN|WARNING|Warning|warning)\b/;

/** The lines of a Codex output that are Codex's own errors and warnings, with any echo of the brief left out. */
export function codexOwnLines(text, prompt = '') {
  let body = String(text || '').replace(/\r\n?/g, '\n');
  const echo = String(prompt || '').replace(/\r\n?/g, '\n').trim();
  if (echo) body = body.split(echo).join('\n');
  return body.split('\n').filter((line) => CODEX_OWN_LINE.test(line.trim())).join('\n');
}

/** Turns a finished Codex run (plus its out.json text) into the same shape as interpretClaude. */
export function interpretCodex(run, outText, prompt = '') {
  const base = { ms: run.ms };
  if (run.error === 'cancelled' || run.error === 'timeout' || run.error === 'spawn') return { ...base, ok: false, code: run.error };
  const data = extractJson(outText) || (run.code === 0 ? extractJson(run.stdout) : null);
  if (data) return { ...base, ok: true, data, loose: !extractJson(outText) };
  if (run.code !== 0 && CODEX_AUTH.test(`${codexOwnLines(run.stderr, prompt).slice(-2000)}\n${codexOwnLines(run.stdout, prompt).slice(-2000)}`)) {
    return { ...base, ok: false, code: 'auth' };
  }
  return { ...base, ok: false, code: run.code === 0 ? 'invalid' : 'failed' };
}

/**
 * Asks Claude Code once. `onKill` receives the kill function while the run is alive.
 * Resolves { ok, data?, code?, ms }.
 */
export async function askClaude({ bin, prompt, schema, env, timeoutMs = CREW_TIMEOUT_MS, spawnImpl, onKill = () => {} } = {}) {
  const dir = await makeTempDir();
  try {
    const run = runProcess({ command: bin, args: claudeArgs(schema), input: prompt, cwd: dir, env: claudeEnv(env || process.env), timeoutMs, spawnImpl });
    onKill(run.kill);
    return interpretClaude(await run.promise);
  } finally {
    await removeDir(dir);
  }
}

/** Asks Codex once, with the schema and answer files in the call's own temp directory. */
export async function askCodex({ bin, prompt, schema, env, timeoutMs = CREW_TIMEOUT_MS, spawnImpl, onKill = () => {} } = {}) {
  const dir = await makeTempDir();
  try {
    await fsp.writeFile(path.join(dir, 'schema.json'), typeof schema === 'string' ? schema : JSON.stringify(schema));
    const run = runProcess({ command: bin, args: codexArgs(dir), input: prompt, cwd: dir, env, timeoutMs, spawnImpl });
    onKill(run.kill);
    const result = await run.promise;
    let outText = null;
    try {
      outText = await fsp.readFile(path.join(dir, 'out.json'), 'utf8');
    } catch {
      outText = null;
    }
    return interpretCodex(result, outText, prompt);
  } finally {
    await removeDir(dir);
  }
}

// ---------------------------------------------------------------------------------------------
// Sign-in probes (local only: they read each CLI's own login state and send nothing)

/** true / false when Claude Code says whether it's signed in, null when it can't tell. */
export async function probeClaudeAuth({ bin, env, spawnImpl, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!bin) return null;
  const dir = await makeTempDir();
  try {
    const run = await runProcess({ command: bin, args: [...CLAUDE_AUTH_ARGS], cwd: dir, env: claudeEnv(env || process.env), timeoutMs, spawnImpl }).promise;
    if (run.error) return null;
    const data = extractJson(run.stdout);
    return data && typeof data.loggedIn === 'boolean' ? data.loggedIn : null;
  } finally {
    await removeDir(dir);
  }
}

/** true when `codex login status` succeeds, false when it says it isn't, null when it can't tell. */
export async function probeCodexLogin({ bin, env, spawnImpl, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!bin) return null;
  const dir = await makeTempDir();
  try {
    const run = await runProcess({ command: bin, args: [...CODEX_LOGIN_ARGS], cwd: dir, env, timeoutMs, spawnImpl }).promise;
    if (run.error) return null;
    if (run.code === 0) return true;
    return /not logged in|logged out|no credentials|please (log|sign) ?in/i.test(`${run.stdout}\n${run.stderr}`) ? false : null;
  } finally {
    await removeDir(dir);
  }
}
