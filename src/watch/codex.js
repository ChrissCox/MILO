// Codex watcher (read-only).
//
// Reads rollout files at <codexHome>/sessions/YYYY/MM/DD/rollout-*.jsonl and
// <codexHome>/archived_sessions/rollout-*.jsonl, titles from <codexHome>/session_index.jsonl, and
// imported threads from <codexHome>/external_agent_session_imports.json.
//
// How the real files relate (checked on Chris's PC, Sept 2026):
// - Line 1 of every rollout is a `session_meta` record. Its payload.id is the thread id.
// - A thread can span several files. Continuation files are named
//   rollout-<time>-<threadId>_<segmentId>.jsonl, keep payload.id = the thread id, and carry
//   payload.history_base = { thread_id, end_ordinal_exclusive, end_byte_offset }, where thread_id
//   points at the previous segment (or the thread itself for the first continuation). They hold only
//   new records, so all files with the same payload.id are merged into one thread. A continuation is
//   created when a thread is opened, so its session_meta says nothing about work being done.
// - Codex Desktop appends `event_msg` thread_settings_applied when a thread is opened or its
//   settings change, even if no work follows. Neither it nor session_meta counts as activity.
// - Subagent threads (thread_source 'subagent') and review threads (thread_source 'guardian_review')
//   have payload.source = { subagent: {...} }, a parent_thread_id, and session_id = the root thread
//   id (top-level threads have session_id === id). Forked subagent files also contain a copy of the
//   parent's session_meta as line 2, so only line 1 identifies a file.
// - session_index.jsonl lines { id, thread_name, updated_at } use top-level thread ids; a thread
//   can appear more than once after a rename, so the newest updated_at wins.
// - Threads imported from another agent (listed in external_agent_session_imports.json with their
//   source_path) replay that agent's turns as task_started/task_complete without a turn_context.
//   Every native Codex turn has a turn_context with the same turn_id, so only those turns count as
//   Codex's work. Most replayed records are stamped with the import time.
// - Rollouts are append-only and can pass 100 MB, so they are read incrementally (parseIncremental).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  MAX_COMPLETIONS,
  SNIPPET_MAX,
  STATUS_DETAIL,
  TITLE_MAX,
  UNTITLED,
  cachedParse,
  clip,
  snippet,
  collapse,
  firstLine,
  isRecent,
  listDir,
  mapLimit,
  parseIncremental,
  parseJson,
  projectName,
  pruneCache,
  statSafe,
  toMs,
} from './claude.js';

const CODEX_WORKING_WINDOW_MS = 10 * 60 * 1000;
const PARSE_CONCURRENCY = 4;
const HEAD_SCAN_BYTES = 512;
const ROLE_RE = /"role":"([a-z]+)"/;
const MAX_WALK_DEPTH = 5;
const LIFECYCLE = { task_started: 'started', task_complete: 'complete', turn_aborted: 'aborted' };
const SUBAGENT_THREAD_SOURCES = new Set(['subagent', 'guardian_review']);
// Every real rollout line starts like this, so most lines are classified without JSON.parse.
const LINE_HEAD_RE = /^\{"timestamp":"([^"]*)",(?:"ordinal":\d+,)?"type":"([a-z_]+)"(?:,"payload":\{"type":"([A-Za-z_]+)")?/;
const FILE_ID_RE = /rollout-[\dT:-]+?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const REQUEST_MARKER_RE = /^#{1,3}\s*My request(?: for Codex)?:[ \t]*$/m;

export function isSubagentMeta(meta) {
  if (!meta) return false;
  if (SUBAGENT_THREAD_SOURCES.has(meta.threadSource)) return true;
  if (meta.spawned) return true;
  if (meta.parentThreadId) return true;
  return Boolean(meta.sessionId && meta.id && meta.sessionId !== meta.id);
}

function pickMeta(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') return null;
  const source = payload.source;
  return {
    id: payload.id,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : '',
    cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
    originator: typeof payload.originator === 'string' ? payload.originator : '',
    threadSource: typeof payload.thread_source === 'string' ? payload.thread_source : '',
    startedAt: toMs(payload.timestamp),
    spawned: Boolean(source && typeof source === 'object' && 'subagent' in source),
    parentThreadId: typeof payload.parent_thread_id === 'string' ? payload.parent_thread_id : '',
    historyBaseThreadId:
      payload.history_base && typeof payload.history_base.thread_id === 'string' ? payload.history_base.thread_id : '',
  };
}

export function threadIdFromFileName(file) {
  const match = FILE_ID_RE.exec(path.basename(file));
  return match ? match[1].toLowerCase() : '';
}

/**
 * The human prompt inside a Codex user message, first line only, or '' for wrapper messages
 * (<environment_context>, <recommended_plugins>, AGENTS.md instructions, file lists, ...).
 */
export function codexPromptText(text) {
  if (typeof text !== 'string') return '';
  let body = text.trim();
  if (!body) return '';
  const marker = REQUEST_MARKER_RE.exec(body);
  if (marker) body = body.slice(marker.index + marker[0].length).trim();
  else if (body.startsWith('<') || body.startsWith('#')) return '';
  return firstLine(body);
}

function outputText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ');
}

/** Records that are bookkeeping rather than work: they never move a thread's activity time. */
function isActivity(type, payloadType) {
  if (type === 'session_meta') return false;
  return !(type === 'event_msg' && payloadType === 'thread_settings_applied');
}

/**
 * Incremental parser for one rollout file. Line 1 decides what the file is; a file whose first
 * line isn't complete yet (just created, still being written) summarizes to null so it is left out
 * until it grows. Subagent files stop after line 1.
 */
export const codexRolloutParser = {
  start(file) {
    return {
      file,
      lines: 0,
      meta: null,
      threadId: '',
      subagent: false,
      lifecycle: [],
      contextTurns: new Set(),
      firstUser: '',
      lastMessage: '',
      lastMessageAt: 0,
      model: '',
      modelAt: 0,
      firstTs: 0,
      lastTs: 0,
      stop: false,
    };
  },
  line(state, buffer, start, end) {
    if (state.lines === 0) {
      const head = parseJson(buffer.toString('utf8', start, end));
      state.meta = head && head.type === 'session_meta' ? pickMeta(head.payload) : null;
      state.threadId = (state.meta && state.meta.id) || threadIdFromFileName(state.file);
      state.subagent = isSubagentMeta(state.meta);
      if (state.subagent) {
        state.lines = 1;
        state.stop = true;
        return;
      }
    }
    state.lines += 1;

    // Only the first bytes of a line are decoded to classify it; the rest is decoded on demand.
    const lineText = () => buffer.toString('utf8', start, end);
    const lineHead = buffer.toString('latin1', start, Math.min(end, start + HEAD_SCAN_BYTES));
    let record = null;
    let ts;
    let type;
    let payloadType;
    const headMatch = LINE_HEAD_RE.exec(lineHead);
    if (headMatch) {
      ts = toMs(headMatch[1]);
      type = headMatch[2];
      payloadType = headMatch[3];
    } else {
      record = parseJson(lineText());
      if (!record) return;
      ts = toMs(record.timestamp);
      type = record.type;
      payloadType = record.payload && record.payload.type;
    }
    if (ts) {
      if (type === 'session_meta' || isActivity(type, payloadType)) {
        if (!state.firstTs || ts < state.firstTs) state.firstTs = ts;
      }
      if (isActivity(type, payloadType) && ts > state.lastTs) state.lastTs = ts;
    }

    if (type === 'event_msg' && LIFECYCLE[payloadType]) {
      record = record || parseJson(lineText());
      const payload = record && record.payload;
      if (!payload) return;
      const kind = LIFECYCLE[payload.type];
      if (!kind) return;
      state.lifecycle.push({
        kind,
        ts,
        turnId: typeof payload.turn_id === 'string' ? payload.turn_id : '',
        at: kind === 'complete' ? toMs(payload.completed_at) || ts : ts,
      });
      if (kind === 'complete') {
        const text = snippet(payload.last_agent_message, SNIPPET_MAX);
        if (text && ts >= state.lastMessageAt) {
          state.lastMessage = text;
          state.lastMessageAt = ts;
        }
      }
    } else if (type === 'turn_context') {
      record = record || parseJson(lineText());
      const payload = record && record.payload;
      if (payload && typeof payload.turn_id === 'string' && payload.turn_id) state.contextTurns.add(payload.turn_id);
      const model = payload && payload.model;
      if (typeof model === 'string' && model && ts >= state.modelAt) {
        state.model = model;
        state.modelAt = ts;
      }
    } else if (type === 'response_item' && payloadType === 'message') {
      if (!record) {
        // Skip developer messages, and user messages once a title prompt is known, without parsing.
        const role = ROLE_RE.exec(lineHead);
        if (role && (role[1] === 'developer' || (role[1] === 'user' && state.firstUser))) return;
        record = parseJson(lineText());
      }
      const payload = record && record.payload;
      if (!payload) return;
      if (payload.role === 'assistant') {
        const text = snippet(outputText(payload.content), SNIPPET_MAX);
        if (text && ts >= state.lastMessageAt) {
          state.lastMessage = text;
          state.lastMessageAt = ts;
        }
      } else if (payload.role === 'user' && !state.firstUser && Array.isArray(payload.content)) {
        for (const part of payload.content) {
          if (!part || part.type !== 'input_text') continue;
          const prompt = clip(codexPromptText(part.text), TITLE_MAX);
          if (prompt) {
            state.firstUser = prompt;
            break;
          }
        }
      }
    }
  },
  finish(state) {
    if (state.lines === 0) return null; // nothing whole to read yet
    return {
      meta: state.meta,
      threadId: state.threadId,
      subagent: state.subagent,
      lifecycle: state.lifecycle.slice(),
      contextTurns: [...state.contextTurns],
      firstUser: state.firstUser,
      lastMessage: state.lastMessage,
      lastMessageAt: state.lastMessageAt,
      model: state.model,
      modelAt: state.modelAt,
      firstTs: state.firstTs,
      lastTs: state.lastTs,
    };
  },
};

/** Summarize one rollout file from scratch (no cache). Null while its first line is incomplete. */
export async function parseCodexRollout(file, stat) {
  return parseIncremental(new Map(), file, stat || (await fsp.stat(file)), codexRolloutParser);
}

// ---------------------------------------------------------------------------------------------
// Index and imports

/** Map of thread id -> newest thread_name from session_index.jsonl. */
export async function parseSessionIndex(file) {
  const text = await fsp.readFile(file, 'utf8');
  const best = new Map();
  for (const line of text.split('\n')) {
    const entry = parseJson(line);
    if (!entry || typeof entry.id !== 'string' || !collapse(entry.thread_name)) continue;
    const updatedAt = toMs(entry.updated_at);
    const prev = best.get(entry.id);
    if (!prev || updatedAt >= prev.updatedAt) best.set(entry.id, { name: entry.thread_name, updatedAt });
  }
  return new Map([...best].map(([id, value]) => [id, value.name]));
}

/**
 * Map of imported thread id -> { title, sourceSessionId, importedAt } from
 * external_agent_session_imports.json. sourceSessionId is the source transcript's file name
 * without .jsonl (a Claude session id when the thread came from Claude Code).
 */
export async function parseImports(file) {
  const data = JSON.parse(await fsp.readFile(file, 'utf8'));
  const imports = new Map();
  const records = data && Array.isArray(data.records) ? data.records : [];
  for (const record of records) {
    if (!record || typeof record.imported_thread_id !== 'string' || !record.imported_thread_id) continue;
    const base = typeof record.source_path === 'string' ? record.source_path.split(/[\\/]/).pop() : '';
    imports.set(record.imported_thread_id, {
      title: collapse(record.title) ? record.title : '',
      sourceSessionId: /\.jsonl$/i.test(base) ? base.slice(0, -'.jsonl'.length) : '',
      importedAt: toMs(record.imported_at),
    });
  }
  return imports;
}

async function readSmallCached(cache, file, parse) {
  const stat = await statSafe(file);
  if (!stat || !stat.isFile()) return new Map();
  return (await cachedParse(cache, file, stat, parse)) || new Map();
}

// ---------------------------------------------------------------------------------------------
// Scan

async function walkRollouts(dir, depth = 0, out = []) {
  const entries = await listDir(dir);
  if (!entries) return depth === 0 ? null : out;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_WALK_DEPTH) await walkRollouts(full, depth + 1, out);
    } else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * One thread from its files. For an imported thread only native Codex turns (those with a
 * turn_context) count; `nativeEvents` on the result tells how many lifecycle events that left.
 */
export function buildCodexThread(threadId, parts, { now, names = new Map(), imports = new Map() }) {
  const ordered = [...parts].sort(
    (a, b) =>
      ((a.summary.meta && a.summary.meta.startedAt) || a.summary.firstTs) -
      ((b.summary.meta && b.summary.meta.startedAt) || b.summary.firstTs),
  );
  const imported = imports.get(threadId) || null;
  const nativeTurns = new Set(ordered.flatMap((part) => part.summary.contextTurns || []));
  const events = ordered
    .flatMap((part) => part.summary.lifecycle)
    .filter((event) => !imported || (event.turnId && nativeTurns.has(event.turnId)))
    .sort((a, b) => a.ts - b.ts);

  const finished = new Map();
  for (const event of events) {
    if (event.kind !== 'complete') continue;
    const key = event.turnId || `at:${event.at}`;
    finished.set(key, Math.max(finished.get(key) || 0, event.at));
  }
  const completions = [...finished.values()].filter((at) => at > 0).sort((a, b) => a - b);

  const mtimeMs = Math.max(...ordered.map((part) => part.mtimeMs || 0));
  let lastMessage = '';
  let lastMessageAt = -1;
  let model = '';
  let modelAt = -1;
  let startedAt = 0;
  let lastActivityAt = 0;
  let firstUser = '';
  let cwd = '';
  let originator = '';
  for (const { summary } of ordered) {
    if (summary.lastMessage && summary.lastMessageAt >= lastMessageAt) {
      lastMessage = summary.lastMessage;
      lastMessageAt = summary.lastMessageAt;
    }
    if (summary.model && summary.modelAt >= modelAt) {
      model = summary.model;
      modelAt = summary.modelAt;
    }
    const began = (summary.meta && summary.meta.startedAt) || summary.firstTs;
    if (began && (!startedAt || began < startedAt)) startedAt = began;
    if (summary.lastTs > lastActivityAt) lastActivityAt = summary.lastTs;
    if (!firstUser && summary.firstUser) firstUser = summary.firstUser;
    if (summary.meta && summary.meta.cwd) cwd = summary.meta.cwd;
    if (summary.meta && summary.meta.originator) originator = summary.meta.originator;
  }
  if (!lastActivityAt) lastActivityAt = mtimeMs;

  // Working means a turn is open and the thread wrote real work in the last 10 minutes.
  const last = events[events.length - 1];
  let status = 'done';
  let live = false;
  if (last && last.kind === 'started') {
    live = isRecent(lastActivityAt, now, CODEX_WORKING_WINDOW_MS);
    status = live ? 'working' : 'stopped';
  } else if (last && last.kind === 'aborted') {
    status = 'stopped';
  }
  // Times past "now" (clock skew) read as now, so they can't outrank or outlast real activity.
  if (now && lastActivityAt > now) lastActivityAt = now;
  if (!startedAt || startedAt > lastActivityAt) startedAt = lastActivityAt;

  const title =
    clip(names.get(threadId), TITLE_MAX) || clip(imported && imported.title, TITLE_MAX) || firstUser || UNTITLED;

  const session = {
    id: `codex:${threadId}`,
    agent: 'codex',
    sessionId: threadId,
    title,
    project: projectName(cwd),
    cwd,
    startedAt,
    lastActivityAt,
    status,
    statusDetail: STATUS_DETAIL[status],
    live,
    lastMessage,
    completions: completions.slice(-MAX_COMPLETIONS),
    turns: finished.size,
    model,
    source: originator,
    archived: ordered.every((part) => part.archived),
  };
  return {
    session,
    imported: imported ? { sourceSessionId: imported.sourceSessionId, nativeEvents: events.length } : null,
  };
}

/** The AgentSession for one thread (see buildCodexThread). */
export function buildCodexSession(threadId, parts, options) {
  return buildCodexThread(threadId, parts, options).session;
}

/**
 * Scan a Codex home. Returns { source, sessions, imports } where source matches
 * Snapshot.sources.codex and imports maps each listed imported thread id to
 * { sourceSessionId, nativeEvents }. Subagent and review threads are left out of the list.
 */
export async function scanCodex({ home, now = Date.now(), cache = new Map() } = {}) {
  const source = { ok: false, path: home || '', count: 0, live: false };
  const imported = new Map();
  const homeStat = home ? await statSafe(home) : null;
  if (!homeStat || !homeStat.isDirectory()) {
    source.error = "Couldn't find Codex's folder on this PC.";
    return { source, sessions: [], imports: imported };
  }

  const [active, archived] = await Promise.all([
    walkRollouts(path.join(home, 'sessions')),
    walkRollouts(path.join(home, 'archived_sessions')),
  ]);
  if (!active && !archived) {
    source.error = "Codex hasn't saved any sessions here yet.";
    return { source, sessions: [], imports: imported };
  }
  source.ok = true;

  const files = [
    ...(active || []).map((file) => ({ file, archived: false })),
    ...(archived || []).map((file) => ({ file, archived: true })),
  ];
  const seen = new Set();
  const parsed = await mapLimit(files, PARSE_CONCURRENCY, async ({ file, archived: isArchived }) => {
    const stat = await statSafe(file);
    if (!stat || !stat.isFile()) return null;
    seen.add(file);
    const summary = await parseIncremental(cache, file, stat, codexRolloutParser);
    return summary ? { file, summary, mtimeMs: stat.mtimeMs, archived: isArchived } : null;
  });

  const indexFile = path.join(home, 'session_index.jsonl');
  const importsFile = path.join(home, 'external_agent_session_imports.json');
  seen.add(indexFile);
  seen.add(importsFile);
  const [names, imports] = await Promise.all([
    readSmallCached(cache, indexFile, parseSessionIndex),
    readSmallCached(cache, importsFile, parseImports),
  ]);
  pruneCache(cache, seen);

  const threads = new Map();
  for (const part of parsed) {
    if (!part || part.summary.subagent || !part.summary.threadId) continue;
    // No session_meta on line 1 and nothing readable after it: not a thread we can describe.
    if (!part.summary.meta && !part.summary.firstTs) continue;
    if (part.summary.lifecycle.length) source.live = true;
    const list = threads.get(part.summary.threadId) || [];
    list.push(part);
    threads.set(part.summary.threadId, list);
  }

  const sessions = [];
  for (const [threadId, parts] of threads) {
    const thread = buildCodexThread(threadId, parts, { now, names, imports });
    sessions.push(thread.session);
    if (thread.imported) imported.set(threadId, thread.imported);
  }
  source.count = sessions.length;
  return { source, sessions, imports: imported };
}
