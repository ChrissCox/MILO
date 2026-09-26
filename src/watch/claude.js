// Claude Code watcher (read-only).
//
// Reads transcripts at <claudeHome>/projects/<project-slug>/<sessionId>.jsonl (top level of each
// project folder only), the desktop app's release markers next to them
// (<sessionId>.desktop-released.json), and the live registry at <claudeHome>/sessions/<pid>.json.
// Nothing here ever writes, moves or deletes under the Claude home. Full transcript text stays in
// this process; only short summaries (title <= 80 chars, last message <= 200 chars) leave it.
//
// This file also holds the small file and text helpers that codex.js shares, including the
// incremental JSONL reader: transcripts and rollouts are append-only, so after the first full read
// only the bytes added since the last scan are parsed.

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const TITLE_MAX = 80;
export const SNIPPET_MAX = 200;
export const MAX_COMPLETIONS = 50;
export const UNTITLED = 'Untitled session';
/** Newest activity may sit this far past "now" (writes landing mid-scan); anything later is clock skew. */
export const FUTURE_SLACK_MS = 60 * 1000;
const FIRST_READ_BYTES = 256 * 1024;
const READ_CHUNK_BYTES = 8 * 1024 * 1024;
const HEAD_KEY_BYTES = 512;
const PARSE_CONCURRENCY = 4;
const CLAUDE_WORKING_WINDOW_MS = 3 * 60 * 1000;
const SUBAGENT_WALK_DEPTH = 4;
// Process identity: a registry pid only counts when its creation time matches procStart.
const PROC_START_TOLERANCE_TICKS = 100000n; // 10 ms in FILETIME ticks (real values agree to < 1 µs)
const PROC_PROBE_TIMEOUT_MS = 8000;
const PROC_PROBE_RETRY_MS = 60 * 1000;
const FILETIME_EPOCH_OFFSET_MS = 11644473600000;

export const STATUS_DETAIL = Object.freeze({
  working: 'Working now',
  'needs-you': 'Waiting on you',
  done: 'Finished',
  stopped: 'Stopped partway',
});

// ---------------------------------------------------------------------------------------------
// Shared text helpers

export function collapse(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Collapse whitespace and cut to `max` chars, ending with an ellipsis when cut. */
export function clip(value, max) {
  const text = collapse(value);
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Plain-text preview of an assistant reply: light Markdown (bold, inline code,
 * headings, list markers, fences, links) is removed before clipping, so the
 * watchtower shows words rather than syntax. HTML-looking text is left as is;
 * the renderer always shows snippets as text.
 */
export function snippet(value, max = SNIPPET_MAX) {
  if (typeof value !== 'string' || !value) return '';
  const text = value
    .replace(/^\s*(```|~~~).*$/gm, ' ')
    .replace(/!?\[([^\]\n]*)\]\((?:<[^>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\)/g, '$1')
    .replace(/<((?:https?|file):[^>\s]+)>/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, ' ')
    .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/gm, '')
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1')
    .replace(/(^|[\s(])__(?=[^\s_])([^\n]*?[^\s_])__(?=$|[\s).,;:?])/gm, '$1$2')
    .replace(/(^|[\s(])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=$|[\s).,;:?])/gm, '$1$2')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
  return clip(text, max);
}

/** First non-empty line, whitespace collapsed. */
export function firstLine(value) {
  if (typeof value !== 'string') return '';
  for (const line of value.split(/\r?\n/)) {
    const text = collapse(line);
    if (text) return text;
  }
  return '';
}

/** Basename of a Windows or POSIX cwd: 'Z:\\Claude' -> 'Claude'. '' when unknown. */
export function projectName(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return '';
  const parts = cwd.trim().replace(/[\\/]+$/, '').split(/[\\/]/);
  const last = parts[parts.length - 1] || '';
  return /^[A-Za-z]:$/.test(last) ? '' : last;
}

/** ISO string, ms epoch or seconds epoch -> ms epoch. 0 when unusable. */
export function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parseJson(line) {
  if (typeof line !== 'string' || line.length < 2) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** True when `at` is recent enough to count as "now": within `windowMs`, and not from the future. */
export function isRecent(at, now, windowMs) {
  if (!at) return false;
  const age = now - at;
  return age <= windowMs && age >= -FUTURE_SLACK_MS;
}

// ---------------------------------------------------------------------------------------------
// Shared file helpers

export async function statSafe(target) {
  try {
    return await fsp.stat(target);
  } catch {
    return null;
  }
}

/** Directory entries, or null when the folder can't be read. */
export async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function readRange(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

/**
 * Incremental JSONL parsing for append-only logs.
 *
 * `parser` is { start(file) -> state, line(state, buffer, start, end), finish(state) -> value }.
 * `line` gets each complete line (end excludes the newline); setting `state.stop = true` skips the
 * rest of the file, now and on later appends. The cache entry keeps the byte offset reached, the
 * file's first bytes, and the parser state. When a file only grew (same first bytes, newer or equal
 * mtime) just the new bytes are read. A file that shrank, changed in place, or was replaced is read
 * again from the start. An unterminated last line is left for next time unless it is already a
 * whole JSON record, so a line caught mid-write is never lost or half-counted.
 *
 * Returns parser.finish(state); results (including failures, as null) are reused while
 * (mtimeMs, size) match.
 */
export async function parseIncremental(cache, file, stat, parser) {
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
  let entry = null;
  try {
    entry = await readIncremental(file, stat, parser, hit && hit.parser === parser && hit.state ? hit : null);
  } catch {
    entry = null;
  }
  if (!entry) {
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value: null });
    return null;
  }
  cache.set(file, entry);
  return entry.value;
}

async function readIncremental(file, stat, parser, previous) {
  const size = stat.size;
  const handle = await fsp.open(file, 'r');
  try {
    const head = await readRange(handle, 0, Math.min(size, HEAD_KEY_BYTES));
    const grew = previous
      && size > previous.size
      && stat.mtimeMs >= previous.mtimeMs
      && head.length >= previous.head.length
      && head.subarray(0, previous.head.length).equals(previous.head);
    const state = grew ? previous.state : parser.start(file);
    let offset = grew ? previous.offset : 0;
    if (state.stop) offset = size;

    let carry = null;
    let position = offset;
    while (position < size && !state.stop) {
      const want = Math.min(position === 0 ? FIRST_READ_BYTES : READ_CHUNK_BYTES, size - position);
      const chunk = await readRange(handle, position, want);
      if (!chunk.length) break;
      position += chunk.length;
      const buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const lastNewline = buffer.lastIndexOf(10);
      if (lastNewline < 0) {
        carry = buffer;
        continue;
      }
      let start = 0;
      while (start <= lastNewline && !state.stop) {
        const end = buffer.indexOf(10, start);
        if (end - start >= 2) parser.line(state, buffer, start, end);
        start = end + 1;
      }
      offset += start;
      carry = start < buffer.length && !state.stop ? buffer.subarray(start) : null;
    }
    // A last line without its newline counts only once it is a whole record.
    if (carry && carry.length && !state.stop && parseJson(carry.toString('utf8').trim())) {
      parser.line(state, carry, 0, carry.length);
      offset += carry.length;
    }
    if (state.stop) offset = size;
    return {
      mtimeMs: stat.mtimeMs,
      size,
      parser,
      state,
      offset,
      head,
      value: parser.finish(state),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Parse a small file with `parse(file, stat)`, reusing the previous result while (mtimeMs, size)
 * match. Failures are cached as null too, so a broken file is retried only after it changes.
 */
export async function cachedParse(cache, file, stat, parse) {
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
  let value = null;
  try {
    value = await parse(file, stat);
  } catch {
    value = null;
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

export function pruneCache(cache, seen) {
  for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

// ---------------------------------------------------------------------------------------------
// Process identity (Windows): is the process holding a registry pid the one that wrote the entry?

/** ms epoch -> Windows FILETIME ticks (100 ns since 1601), as a BigInt. */
export function msToFileTime(ms) {
  return BigInt(Math.round(ms + FILETIME_EPOCH_OFFSET_MS)) * 10000n;
}

/** A registry procStart (FILETIME ticks as a digit string or number) as a BigInt, or null. */
export function parseProcStart(value) {
  if (typeof value === 'string' && /^\d{6,20}$/.test(value.trim())) return BigInt(value.trim());
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return BigInt(Math.round(value));
  return null;
}

/**
 * Creation time (FILETIME ticks, BigInt) of each running pid, from one CIM query. Pids that are
 * not running are missing from the map; a pid whose creation time can't be read maps to null.
 * Rejects when the query can't run. Windows only; elsewhere resolves null (identity unknown).
 */
export function processStartTimes(pids) {
  const list = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (process.platform !== 'win32' || !list.length) return Promise.resolve(null);
  const filter = list.map((pid) => `ProcessId=${pid}`).join(' OR ');
  // A process without a readable creation date prints '?', which keeps the plain pid check for it.
  const command = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { if ($_.CreationDate) { '{0} {1}' -f $_.ProcessId, $_.CreationDate.ToFileTimeUtc() } else { '{0} ?' -f $_.ProcessId } }`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: PROC_PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const times = new Map();
        for (const line of String(stdout).split(/\r?\n/)) {
          const match = /^(\d+) (\d+|\?)$/.exec(line.trim());
          if (match) times.set(Number(match[1]), match[2] === '?' ? null : BigInt(match[2]));
        }
        resolve(times);
      },
    );
  });
}

/**
 * For each alive registry entry with a procStart, decide whether its pid still belongs to the
 * process that registered it. Verdicts are cached per (pid, procStart); a failed or unavailable
 * probe keeps the plain pid check and is retried a minute later.
 */
async function confirmIdentities(entries, procCache, probe, now) {
  const pending = [];
  for (const entry of entries) {
    if (!entry.alive || entry.procStart === null) continue;
    const cached = procCache.get(entry.identityKey);
    if (cached && (cached.verdict !== 'unknown' || now - cached.at < PROC_PROBE_RETRY_MS)) continue;
    pending.push(entry);
  }
  if (pending.length) {
    let times = null;
    try {
      times = await probe(pending.map((entry) => entry.pid));
    } catch {
      times = null;
    }
    for (const entry of pending) {
      let verdict = 'unknown';
      if (times instanceof Map) {
        const created = times.get(entry.pid);
        if (created === undefined) verdict = 'different'; // not running any more
        else if (created === null) verdict = 'unknown';
        else {
          const diff = created > entry.procStart ? created - entry.procStart : entry.procStart - created;
          verdict = diff <= PROC_START_TOLERANCE_TICKS ? 'same' : 'different';
        }
      }
      procCache.set(entry.identityKey, { verdict, at: now });
    }
  }
  for (const entry of entries) {
    if (!entry.alive || entry.procStart === null) continue;
    const cached = procCache.get(entry.identityKey);
    if (cached && cached.verdict === 'different') entry.alive = false;
  }
  // Forget verdicts for registry files that are gone.
  const keys = new Set(entries.map((entry) => entry.identityKey));
  for (const key of procCache.keys()) if (!keys.has(key)) procCache.delete(key);
}

// ---------------------------------------------------------------------------------------------
// Claude transcripts

function assistantText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ');
}

// User records that are not a person asking for something: slash-command echoes, shell
// passthrough, background task notices, system reminders, and the interrupt marker.
const NOT_A_PROMPT_RE = /^(?:<command-(?:name|message|args)>|<local-command-|<bash-(?:input|stdout|stderr)>|<task-notification>|<system-reminder>|\[Request interrupted)/;

/** A main-chain user record that asks Claude for something new (so a reply is owed). */
export function isHumanPrompt(record) {
  if (!record || record.type !== 'user' || record.isMeta === true || record.isCompactSummary === true) return false;
  if (record.origin && typeof record.origin === 'object') return record.origin.kind === 'human';
  const content = record.message && record.message.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((block) => block && block.type === 'tool_result')) return false;
    text = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ');
  }
  text = text.trimStart();
  return Boolean(text) && !NOT_A_PROMPT_RE.test(text);
}

/** Incremental parser for one transcript. Sidechain records are skipped entirely. */
export const claudeTranscriptParser = {
  start(file) {
    return {
      sessionId: path.basename(file, '.jsonl'),
      records: 0,
      cwd: '',
      entrypoint: '',
      version: '',
      customTitle: '',
      aiTitle: '',
      agentName: '',
      lastPrompt: '',
      startedAt: 0,
      lastActivityAt: 0,
      lastAssistantStop: null,
      lastMessage: '',
      model: '',
      finished: new Map(), // message id -> newest end_turn timestamp
    };
  },
  line(state, buffer, start, end) {
    const record = parseJson(buffer.toString('utf8', start, end));
    if (!record || record.isSidechain === true) return;
    state.records += 1;

    switch (record.type) {
      case 'custom-title':
        if (collapse(record.customTitle)) state.customTitle = record.customTitle;
        return;
      case 'ai-title':
        if (collapse(record.aiTitle)) state.aiTitle = record.aiTitle;
        return;
      case 'agent-name':
        if (collapse(record.agentName)) state.agentName = record.agentName;
        return;
      case 'last-prompt':
        if (firstLine(record.lastPrompt)) state.lastPrompt = record.lastPrompt;
        return;
      default:
        break;
    }

    if (typeof record.cwd === 'string' && record.cwd) state.cwd = record.cwd;
    if (typeof record.entrypoint === 'string' && record.entrypoint) state.entrypoint = record.entrypoint;
    if (typeof record.version === 'string' && record.version) state.version = record.version;

    const ts = toMs(record.timestamp);
    if (ts) {
      if (!state.startedAt || ts < state.startedAt) state.startedAt = ts;
      if (ts > state.lastActivityAt) state.lastActivityAt = ts;
    }

    // A new request after the last reply (in file order; timestamps can be out of order) means
    // the previous "finished" no longer describes the session.
    if (isHumanPrompt(record)) {
      state.lastAssistantStop = null;
      return;
    }

    if (record.type !== 'assistant' || !record.message || typeof record.message !== 'object') return;
    const message = record.message;
    state.lastAssistantStop = message.stop_reason ?? null;
    if (typeof message.model === 'string' && message.model && message.model !== '<synthetic>') {
      state.model = message.model;
    }
    const text = snippet(assistantText(message.content), SNIPPET_MAX);
    if (text) state.lastMessage = text;
    if (message.stop_reason === 'end_turn') {
      const key = message.id || record.requestId || record.uuid || `ts:${ts}`;
      state.finished.set(key, Math.max(state.finished.get(key) || 0, ts));
    }
  },
  finish(state) {
    const { finished, stop, ...summary } = state;
    void stop;
    return {
      ...summary,
      turns: finished.size,
      completions: [...finished.values()].filter((ts) => ts > 0).sort((a, b) => a - b),
    };
  },
};

/** Summarize one transcript from scratch (no cache). */
export async function parseClaudeTranscript(file, stat) {
  return parseIncremental(new Map(), file, stat || (await fsp.stat(file)), claudeTranscriptParser);
}

const RELEASE_SUFFIX = '.desktop-released.json';

/** Transcript files and desktop release markers (by session id) of every project folder. */
export async function listClaudeTranscripts(projectsDir) {
  const projects = await listDir(projectsDir);
  if (!projects) return null;
  const files = [];
  const markers = new Map();
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = path.join(projectsDir, project.name);
    for (const entry of (await listDir(dir)) || []) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.jsonl')) files.push(path.join(dir, entry.name));
      else if (entry.name.endsWith(RELEASE_SUFFIX)) {
        markers.set(entry.name.slice(0, -RELEASE_SUFFIX.length), path.join(dir, entry.name));
      }
    }
  }
  return { files, markers };
}

/** { reason, releasedAt } from a Claude desktop release marker. */
export async function parseReleaseMarker(file) {
  const data = JSON.parse(await fsp.readFile(file, 'utf8'));
  if (!data || typeof data !== 'object' || typeof data.reason !== 'string') return null;
  return { reason: data.reason, releasedAt: toMs(data.releasedAt) };
}

/** Newest mtime of any file under a live session's subagents folder (stat only, nothing read). */
async function newestSubagentWrite(dir, depth = 0) {
  const entries = await listDir(dir);
  if (!entries) return 0;
  let newest = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < SUBAGENT_WALK_DEPTH) newest = Math.max(newest, await newestSubagentWrite(full, depth + 1));
    } else if (entry.isFile()) {
      const stat = await statSafe(full);
      if (stat) newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------------------------
// Live registry

/**
 * Registry entries from <claudeHome>/sessions/<pid>.json, each tagged with `alive`. Pre-spawned
 * spare processes and parked jobs are skipped, as Claude Code itself does.
 */
export async function readClaudeRegistry(sessionsDir) {
  const entries = await listDir(sessionsDir);
  if (!entries) return { exists: false, entries: [] };
  const found = [];
  for (const entry of entries) {
    const match = /^(\d+)\.json$/.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    try {
      const data = JSON.parse(await fsp.readFile(path.join(sessionsDir, entry.name), 'utf8'));
      if (!data || typeof data !== 'object' || typeof data.sessionId !== 'string' || !data.sessionId) continue;
      if (data.spare === true || data.parkedJobId !== undefined) continue;
      const pid = Number.isInteger(data.pid) ? data.pid : Number(match[1]);
      const procStart = parseProcStart(data.procStart);
      found.push({
        pid,
        sessionId: data.sessionId,
        cwd: typeof data.cwd === 'string' ? data.cwd : '',
        name: typeof data.name === 'string' ? data.name : '',
        status: typeof data.status === 'string' ? data.status : '',
        entrypoint: typeof data.entrypoint === 'string' ? data.entrypoint : '',
        startedAt: toMs(data.startedAt),
        updatedAt: toMs(data.updatedAt),
        statusUpdatedAt: toMs(data.statusUpdatedAt),
        procStart,
        identityKey: `${pid}:${procStart === null ? '' : procStart}`,
        alive: isPidAlive(pid),
      });
    } catch {
      // A half-written or unreadable registry file is skipped this round.
    }
  }
  return { exists: true, entries: found };
}

export function claudeStatus({ live, registryStatus, lastAssistantStop, lastActivityAt, now }) {
  if (live && registryStatus) {
    if (registryStatus === 'busy') return 'working';
    if (registryStatus === 'idle') return 'done';
    return 'needs-you';
  }
  if (lastAssistantStop === 'end_turn') return 'done';
  if (isRecent(lastActivityAt, now, CLAUDE_WORKING_WINDOW_MS)) return 'working';
  return 'stopped';
}

function pickTitle(summary, registryName) {
  const candidates = [
    summary && summary.customTitle,
    summary && summary.aiTitle,
    summary && summary.agentName,
    registryName,
    summary && firstLine(summary.lastPrompt),
  ];
  for (const candidate of candidates) {
    const title = clip(candidate, TITLE_MAX);
    if (title) return title;
  }
  return UNTITLED;
}

export function buildClaudeSession(sessionId, summary, registry, now, mtimeMs = 0, { archived = false, subagentActivity = 0 } = {}) {
  const live = Boolean(registry && registry.alive);
  const cwd = (summary && summary.cwd) || (registry && registry.cwd) || '';
  let lastActivityAt = (summary && summary.lastActivityAt) || 0;
  if (live) lastActivityAt = Math.max(lastActivityAt, registry.statusUpdatedAt || 0, subagentActivity || 0);
  if (!lastActivityAt) {
    lastActivityAt = (registry && (registry.statusUpdatedAt || registry.updatedAt || registry.startedAt)) || mtimeMs || 0;
  }
  const status = claudeStatus({
    live,
    registryStatus: live ? registry.status : '',
    lastAssistantStop: summary ? summary.lastAssistantStop : null,
    lastActivityAt,
    now,
  });
  // Times past "now" (clock skew) read as now, so they can't outrank or outlast real activity.
  if (now && lastActivityAt > now) lastActivityAt = now;
  let startedAt = (summary && summary.startedAt) || (registry && registry.startedAt) || lastActivityAt;
  if (startedAt > lastActivityAt) startedAt = lastActivityAt;
  const completions = summary ? summary.completions.slice(-MAX_COMPLETIONS) : [];
  return {
    id: `claude:${sessionId}`,
    agent: 'claude',
    sessionId,
    title: pickTitle(summary, live ? registry.name : ''),
    project: projectName(cwd),
    cwd,
    startedAt,
    lastActivityAt,
    status,
    statusDetail: STATUS_DETAIL[status],
    live,
    lastMessage: (summary && summary.lastMessage) || '',
    completions,
    turns: summary ? summary.turns : 0,
    model: (summary && summary.model) || '',
    source: (summary && summary.entrypoint) || (registry && registry.entrypoint) || '',
    archived: Boolean(archived) && !live,
  };
}

// ---------------------------------------------------------------------------------------------
// Scan

/**
 * Scan a Claude home. Returns { source, sessions } where source matches Snapshot.sources.claude.
 * `cache` is a Map reused across scans (see parseIncremental), `procCache` a Map of process
 * identity verdicts, and `processStarts` the creation-time probe (processStartTimes by default).
 */
export async function scanClaude({
  home,
  now = Date.now(),
  cache = new Map(),
  procCache = new Map(),
  processStarts = processStartTimes,
} = {}) {
  const source = { ok: false, path: home || '', count: 0, live: false };
  const homeStat = home ? await statSafe(home) : null;
  if (!homeStat || !homeStat.isDirectory()) {
    source.error = "Couldn't find Claude Code's folder on this PC.";
    return { source, sessions: [] };
  }

  const [listing, registry] = await Promise.all([
    listClaudeTranscripts(path.join(home, 'projects')),
    readClaudeRegistry(path.join(home, 'sessions')),
  ]);
  source.live = registry.exists;
  if (!listing && !registry.exists) {
    source.error = "Claude Code hasn't saved any sessions here yet.";
    return { source, sessions: [] };
  }
  source.ok = true;
  await confirmIdentities(registry.entries, procCache, processStarts, now);

  const seen = new Set();
  const parsed = await mapLimit((listing && listing.files) || [], PARSE_CONCURRENCY, async (file) => {
    const stat = await statSafe(file);
    if (!stat || !stat.isFile()) return null;
    seen.add(file);
    const summary = await parseIncremental(cache, file, stat, claudeTranscriptParser);
    return summary ? { file, summary, mtimeMs: stat.mtimeMs } : null;
  });

  const released = new Map();
  for (const [sessionId, file] of listing ? listing.markers : []) {
    const stat = await statSafe(file);
    if (!stat || !stat.isFile()) continue;
    seen.add(file);
    const marker = await cachedParse(cache, file, stat, parseReleaseMarker);
    if (marker) released.set(sessionId, marker);
  }
  pruneCache(cache, seen);

  // One transcript per session id; if a session shows up twice, keep the most recently active copy.
  const transcripts = new Map();
  for (const item of parsed) {
    if (!item || !item.summary.records) continue;
    const prev = transcripts.get(item.summary.sessionId);
    if (!prev || item.summary.lastActivityAt > prev.summary.lastActivityAt) {
      transcripts.set(item.summary.sessionId, item);
    }
  }

  // Live registry entries by session id (alive pids only; newest update wins).
  const liveBySession = new Map();
  for (const entry of registry.entries) {
    if (!entry.alive) continue;
    const prev = liveBySession.get(entry.sessionId);
    if (!prev || entry.updatedAt > prev.updatedAt) liveBySession.set(entry.sessionId, entry);
  }

  const sessions = [];
  for (const [sessionId, item] of transcripts) {
    const live = liveBySession.get(sessionId);
    const marker = released.get(sessionId);
    // Deleted in the Claude desktop app: gone for Chris too, unless a process is running it now.
    if (marker && marker.reason === 'delete' && !live) continue;
    const subagentActivity = live
      ? Math.min(now, await newestSubagentWrite(path.join(path.dirname(item.file), sessionId, 'subagents')))
      : 0;
    sessions.push(buildClaudeSession(sessionId, item.summary, live, now, item.mtimeMs, {
      archived: Boolean(marker && marker.reason === 'archive'),
      subagentActivity,
    }));
  }
  for (const [sessionId, entry] of liveBySession) {
    if (!transcripts.has(sessionId)) sessions.push(buildClaudeSession(sessionId, null, entry, now));
  }
  source.count = sessions.length;
  return { source, sessions };
}
