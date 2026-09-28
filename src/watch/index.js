// Watchkeeping: read-only monitoring of Claude Code and Codex sessions plus helper tools.
//
//   const watcher = createWatcher();
//   const snapshot = await watcher.scan();   // Snapshot, see CONTRACT.md
//   watcher.dispose();
//
// Phase 3 (CONTRACT-PHASE3.md §4.2) adds snapshot.capacity = { codex: reading | null }, where a
// reading is { usedPercent, resetsAt (ms), windowMinutes, at (ms) }, and AgentSession.waitingSince.
//
// Node only. Never writes under ~/.claude or ~/.codex. The snapshot holds summaries only
// (titles <= 80 chars, last-message snippets <= 200 chars); transcripts stay in this process.

import os from 'node:os';
import path from 'node:path';
import { processStartTimes, scanClaude } from './claude.js';
import { scanCodex } from './codex.js';
import { JEV_NOTE, OLLAMA_NOTE, WHISPER_NOTE, createToolProbes, detectTools } from './local.js';

export const MAX_SESSIONS = 200;

function failedSource(home, message) {
  return { source: { ok: false, path: home, count: 0, live: false, error: message }, sessions: [] };
}

function fallbackTools() {
  return [
    { id: 'jev', name: 'Jev', kind: 'cloud', installed: false, active: false, detail: 'Not checked this time', note: JEV_NOTE },
    { id: 'whisper', name: 'Whisper', kind: 'local', installed: false, active: false, detail: 'Not checked this time', note: WHISPER_NOTE },
    { id: 'ollama', name: 'Ollama', kind: 'local', installed: false, active: false, detail: 'Not checked this time', note: OLLAMA_NOTE },
  ];
}

/**
 * Snapshot.capacity.codex from scanCodex's newest reading: a fresh object with exactly the
 * contract's fields, its `at` clamped to the scan time (clock skew), or null. A failed or missing
 * source has no reading. `resetsAt` can already be past: the last reading stays in the rollouts
 * until Codex runs again, so consumers treat `resetsAt <= now` as refilled.
 */
export function capacityReading(reading, scannedAt) {
  if (!reading || typeof reading !== 'object') return null;
  const { usedPercent, resetsAt, windowMinutes, at } = reading;
  if (![usedPercent, resetsAt, windowMinutes, at].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  return { usedPercent, resetsAt, windowMinutes, at: scannedAt ? Math.min(at, scannedAt) : at };
}

const sameReading = (a, b) =>
  a.usedPercent === b.usedPercent && a.resetsAt === b.resetsAt && a.windowMinutes === b.windowMinutes && a.at === b.at;

/**
 * capacityReading for a run of scans. A reading stamped past the scan time (clock skew) reads as
 * the scan that first saw it, and keeps that time for as long as it stays the reading, so it isn't
 * a new reading on every scan. Scans run one at a time, so one held reading is enough.
 */
export function createCapacityClock() {
  let early = null; // { reading, seenAt }
  return {
    read(reading, scannedAt) {
      const snapshot = capacityReading(reading, scannedAt);
      if (!snapshot || !scannedAt || !(reading.at > scannedAt)) {
        early = null;
        return snapshot;
      }
      if (!early || !sameReading(early.reading, reading)) early = { reading: { ...reading }, seenAt: scannedAt };
      snapshot.at = Math.min(early.seenAt, scannedAt);
      return snapshot;
    },
    reset() {
      early = null;
    },
  };
}

/**
 * Codex threads imported from a Claude Code session that is listed too are the same work twice.
 * They are left out unless Codex has done turns of its own in them since the import.
 */
export function withoutImportedCopies(codexSessions, imports, claudeSessions) {
  if (!imports || !imports.size) return codexSessions;
  const claudeIds = new Set(claudeSessions.map((session) => session.sessionId));
  return codexSessions.filter((session) => {
    const info = imports.get(session.sessionId);
    return !(info && info.nativeEvents === 0 && info.sourceSessionId && claudeIds.has(info.sourceSessionId));
  });
}

export function createWatcher({
  claudeHome,
  codexHome,
  localAppData,
  now = () => Date.now(),
  probeTools = true,
  processStarts = processStartTimes,
} = {}) {
  const homes = {
    claude: claudeHome || process.env.MILO_CLAUDE_HOME || path.join(os.homedir(), '.claude'),
    codex: codexHome || process.env.MILO_CODEX_HOME || path.join(os.homedir(), '.codex'),
    localAppData: localAppData || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  };
  const caches = { claude: new Map(), codex: new Map(), procs: new Map() };
  const probes = probeTools ? createToolProbes() : null;
  const capacityClock = createCapacityClock();
  let pending = null;

  async function runScan() {
    const scannedAt = now();
    const [claude, codex, tools] = await Promise.all([
      scanClaude({ home: homes.claude, now: scannedAt, cache: caches.claude, procCache: caches.procs, processStarts }).catch(() =>
        failedSource(homes.claude, "Couldn't read Claude Code's sessions this time."),
      ),
      scanCodex({ home: homes.codex, now: scannedAt, cache: caches.codex }).catch(() =>
        failedSource(homes.codex, "Couldn't read Codex's sessions this time."),
      ),
      detectTools({ claudeHome: homes.claude, localAppData: homes.localAppData, probes }).catch(fallbackTools),
    ]);
    const codexSessions = withoutImportedCopies(codex.sessions, codex.imports, claude.sessions);
    if (codex.source.ok) codex.source.count = codexSessions.length;
    const sessions = [...claude.sessions, ...codexSessions]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, MAX_SESSIONS);
    return {
      scannedAt,
      sessions,
      tools,
      sources: { claude: claude.source, codex: codex.source },
      capacity: { codex: capacityClock.read(codex.source.ok ? codex.capacity : null, scannedAt) },
    };
  }

  return {
    /** Concurrent calls share one scan. */
    scan() {
      if (!pending) pending = runScan().finally(() => { pending = null; });
      return pending;
    },
    /** Drops caches and stops a running Whisper check. scan() still works afterwards, uncached at first. */
    dispose() {
      caches.claude.clear();
      caches.codex.clear();
      caches.procs.clear();
      capacityClock.reset();
      if (probes) probes.dispose();
    },
  };
}
