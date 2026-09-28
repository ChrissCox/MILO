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
// - Codex's allowance readings ride on `event_msg` token_count records as payload.rate_limits:
//   { limit_id, limit_name, primary, secondary, credits, plan_type, ... } or null. primary and
//   secondary are null or { used_percent (0..100), window_minutes, resets_at (seconds) }. The
//   account's own bucket has limit_id 'codex'; model-specific buckets (other ids, usually at 0%) are
//   written too and must not replace it. Since Sept 2026 the 'codex' bucket is a weekly primary with
//   secondary null; before that it was a 5-hour primary plus a weekly secondary. "rate_limits"
//   starts about 450-510 bytes into the line (the reading runs on well past the 512-byte head), so
//   each token_count line gets a bounded byte check and only a line holding a reading is parsed.
// - Codex appends records in the order it writes them, and within a file the timestamps have always
//   followed that order (1,639 readings checked). A clock that jumps can break it, so a file's
//   reading is the last one appended, not the one with the latest stamp.

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
// The account-wide allowance bucket. Readings from any other bucket are ignored.
export const CAPACITY_LIMIT_ID = 'codex';
// Only token_count lines holding this (a non-null reading) are ever parsed. A Buffer, so the
// bounded per-line check never re-encodes the key.
const RATE_LIMITS_KEY = Buffer.from('"rate_limits":{');
// How far past the scan time a reading's stamp may be and still be placed in time: enough for the
// few seconds a sync nudges the clock, or a record written while the scan runs. A stamp further
// ahead was made by a clock that was wrong then or is wrong now, so its order is unknown.
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
// Readings of one window give refill times up to 14 s apart (checked on the real files); the next
// window refills hours or days later.
const SAME_WINDOW_MS = 10 * 60 * 1000;

/** One rate-limit window as { usedPercent, windowMinutes, resetsAt (ms) }, or null when unusable. */
function readWindow(window, at) {
  if (!window || typeof window !== 'object') return null;
  const used = window.used_percent;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  const minutes = window.window_minutes;
  let resetsAt = toMs(window.resets_at);
  // Older Codex builds wrote how long until the refill instead of when.
  const inSeconds = window.resets_in_seconds;
  if (!resetsAt && typeof inSeconds === 'number' && Number.isFinite(inSeconds) && inSeconds >= 0 && at) {
    resetsAt = at + Math.round(inSeconds * 1000);
  }
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    windowMinutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
    resetsAt,
  };
}

/**
 * The capacity reading in one token_count payload.rate_limits, taken at `at` (ms):
 * { usedPercent, resetsAt (ms), windowMinutes, at }, or null when it is missing, from another
 * bucket, or has no usable window. Of primary and secondary, the fuller window wins (on a tie, the
 * one that refills later, since that is when there is room again).
 */
export function pickRateLimits(rateLimits, at) {
  if (!rateLimits || typeof rateLimits !== 'object' || Array.isArray(rateLimits)) return null;
  const id = rateLimits.limit_id;
  if (id !== undefined && id !== null && id !== '' && id !== CAPACITY_LIMIT_ID) return null;
  let best = null;
  for (const window of [readWindow(rateLimits.primary, at), readWindow(rateLimits.secondary, at)]) {
    if (!window) continue;
    if (!best || window.usedPercent > best.usedPercent
      || (window.usedPercent === best.usedPercent && window.resetsAt > best.resetsAt)) best = window;
  }
  if (!best) return null;
  return { usedPercent: best.usedPercent, resetsAt: best.resetsAt, windowMinutes: best.windowMinutes, at };
}

/** The newer of two readings (by `at`; on a tie, the fuller one). Either may be null. */
export function newerReading(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if (b.at !== a.at) return b.at > a.at ? b : a;
  return b.usedPercent > a.usedPercent ? b : a;
}

/**
 * Which of two readings came later, judged by the allowance rather than by stamps: `placed` has a
 * stamp that can be trusted, `ahead` one that can't. Refill times come from Codex's servers, not
 * this PC's clock. A later window is newer. Inside one window usage only climbs (real readings dip
 * by 3 points at most), so the fuller reading is newer. On a tie the one that can be placed stands,
 * as it does when the windows are of different lengths or a refill time isn't known.
 */
function laterByAllowance(placed, ahead) {
  if (placed.windowMinutes !== ahead.windowMinutes || !placed.resetsAt || !ahead.resetsAt) return placed;
  const drift = ahead.resetsAt - placed.resetsAt;
  if (drift > SAME_WINDOW_MS) return ahead;
  if (drift < -SAME_WINDOW_MS) return placed;
  return ahead.usedPercent > placed.usedPercent ? ahead : placed;
}

/**
 * The newest of a list of readings (nulls skipped), or null. Readings are ordered by `at` (see
 * newerReading), except those stamped more than CLOCK_SKEW_MS past `now`: a clock that was wrong
 * then, or is wrong now, made them, so time can't place them against the rest. The newest of those
 * is weighed against the newest of the rest by the allowance itself (laterByAllowance). That way a
 * reading from a clock that ran hours ahead neither hides the real ones written after the clock
 * was put right nor gets passed over for older ones. The result doesn't depend on the order.
 */
export function latestReading(readings, now) {
  const judged = typeof now === 'number' && Number.isFinite(now);
  let placed = null;
  let ahead = null;
  for (const reading of readings) {
    if (!reading) continue;
    if (judged && reading.at > now + CLOCK_SKEW_MS) ahead = newerReading(ahead, reading);
    else placed = newerReading(placed, reading);
  }
  if (!ahead || !placed) return ahead || placed;
  return laterByAllowance(placed, ahead);
}

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
      // The last usable allowance reading appended to this file. Replaced, never changed in place,
      // so the cached state and earlier finish() values can share it.
      rateLimits: null,
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
    } else if (type === 'event_msg' && payloadType === 'token_count') {
      // The last reading appended wins, whatever its stamp says (see the notes at the top). Lines
      // with rate_limits null or missing fail the bounded byte check and are never parsed.
      if (!ts) return;
      if (!record && !buffer.subarray(start, end).includes(RATE_LIMITS_KEY)) return;
      record = record || parseJson(lineText());
      const reading = record && record.payload ? pickRateLimits(record.payload.rate_limits, ts) : null;
      if (reading) state.rateLimits = reading;
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
      rateLimits: state.rateLimits,
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
    // Codex never waits on Chris mid-turn (its rollouts hold no approval events), so there's
    // nothing to time.
    waitingSince: null,
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
 * Scan a Codex home. Returns { source, sessions, imports, capacity } where source matches
 * Snapshot.sources.codex, imports maps each listed imported thread id to
 * { sourceSessionId, nativeEvents }, and capacity is the newest allowance reading found in any
 * rollout, archived ones included ({ usedPercent, resetsAt, windowMinutes, at }, see
 * pickRateLimits and latestReading), or null. Its `at` is as written, so it can be past `now`.
 * Subagent and review threads are left out of the list; their files are never read past line 1,
 * so their readings wait for the parent thread's next one.
 */
export async function scanCodex({ home, now = Date.now(), cache = new Map() } = {}) {
  const source = { ok: false, path: home || '', count: 0, live: false };
  const imported = new Map();
  const homeStat = home ? await statSafe(home) : null;
  if (!homeStat || !homeStat.isDirectory()) {
    source.error = "Couldn't find Codex's folder on this PC.";
    return { source, sessions: [], imports: imported, capacity: null };
  }

  const [active, archived] = await Promise.all([
    walkRollouts(path.join(home, 'sessions')),
    walkRollouts(path.join(home, 'archived_sessions')),
  ]);
  if (!active && !archived) {
    source.error = "Codex hasn't saved any sessions here yet.";
    return { source, sessions: [], imports: imported, capacity: null };
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

  // The allowance is the account's, not a thread's: every file's reading counts, whatever the
  // file turns out to be, and the newest record wins (not the newest file).
  const capacity = latestReading(parsed.map((part) => part && part.summary.rateLimits), now);

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
  return { source, sessions, imports: imported, capacity };
}
