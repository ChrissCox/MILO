// Helper tools on this PC: Jev (cloud, stats file only), Whisper and Ollama (local).
//
// MILO never calls Jev. It only reads the router's local stats file. The only network call is the
// Ollama probe to http://127.0.0.1:11434, which never leaves the machine.

import { execFile } from 'node:child_process';
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const JEV_NOTE = 'Cloud service. When the router is on, message text goes to TypeSafe.';
export const WHISPER_NOTE = 'Your audio never leaves this PC.';
export const OLLAMA_NOTE = 'Runs on your PC. Nothing leaves it.';

const WHISPER_CODE = "import importlib.util as u; print(bool(u.find_spec('whisper')))";
const WHISPER_TIMEOUT_MS = 8000;
const WHISPER_FIRST_WAIT_MS = 2000;
const OLLAMA_TIMEOUT_MS = 800;
const OLLAMA_MAX_BODY = 1024 * 1024;

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
  });
}

async function fileExists(target) {
  if (!target) return false;
  try {
    return (await fsp.stat(target)).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Default probes (replaceable in tests)

/** Runs the Whisper import check once. Resolves true/false, never rejects. */
export function checkWhisperInstalled({ command = 'python', timeoutMs = WHISPER_TIMEOUT_MS, onChild } = {}) {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        command,
        ['-c', WHISPER_CODE],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
        (error, stdout) => resolve(!error && /^\s*True\s*$/.test(String(stdout))),
      );
      if (onChild) onChild(child);
    } catch {
      resolve(false);
    }
  });
}

/** GET http://127.0.0.1:11434/api/tags. Resolves { models: string[] } or null within 800 ms. */
export function fetchOllamaTags({ timeoutMs = OLLAMA_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const request = http.get({ host: '127.0.0.1', port: 11434, path: '/api/tags', timeout: timeoutMs }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(null);
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > OLLAMA_MAX_BODY) request.destroy();
      });
      response.on('end', () => {
        let models = [];
        try {
          const data = JSON.parse(body);
          if (data && Array.isArray(data.models)) {
            models = data.models.map((model) => model && (model.name || model.model)).filter((name) => typeof name === 'string' && name);
          }
        } catch {
          models = [];
        }
        finish({ models });
      });
      response.on('error', () => finish(null));
    });
    timer = setTimeout(() => {
      request.destroy();
      finish(null);
    }, timeoutMs);
    request.on('timeout', () => request.destroy());
    request.on('error', () => finish(null));
  });
}

/**
 * Holds the per-launch Whisper result and the probe functions. One per watcher.
 * Tests can pass their own `checkWhisper` / `fetchTags`.
 */
export function createToolProbes({ checkWhisper, fetchTags = fetchOllamaTags } = {}) {
  let whisperState = null;
  let whisperChild = null;
  const runCheck = checkWhisper || (() => checkWhisperInstalled({ onChild: (child) => { whisperChild = child; } }));
  return {
    whisper() {
      if (!whisperState) {
        const state = { done: false, value: false, promise: null };
        state.promise = Promise.resolve()
          .then(runCheck)
          .then((value) => value === true, () => false)
          .then((value) => {
            state.done = true;
            state.value = value;
            whisperChild = null;
            return value;
          });
        whisperState = state;
      }
      return whisperState;
    },
    ollama() {
      return Promise.resolve().then(fetchTags).catch(() => null);
    },
    dispose() {
      if (whisperChild) {
        try {
          whisperChild.kill();
        } catch {
          // already gone
        }
        whisperChild = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tools

export function formatCost(value) {
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost <= 0) return '$0';
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost >= 0.0001) return `$${cost.toFixed(4)}`;
  return 'under $0.0001';
}

export async function readJevTool(claudeHome) {
  const tool = { id: 'jev', name: 'Jev', kind: 'cloud', installed: false, active: false, detail: 'Not set up on this PC', note: JEV_NOTE };
  if (!claudeHome) return tool;
  const file = path.join(claudeHome, 'jev-router', 'state.json');
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return tool;
  }
  tool.installed = true;
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    state = null;
  }
  if (!state || typeof state !== 'object') {
    tool.detail = "Couldn't read the router's stats";
    return tool;
  }
  tool.active = state.enabled === true;
  const sentTo = state.sent_to && typeof state.sent_to === 'object' ? state.sent_to : {};
  const sized = Object.values(sentTo).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);
  tool.detail = `Router ${tool.active ? 'on' : 'off'} · ${sized} ${sized === 1 ? 'message' : 'messages'} sized · ${formatCost(state.cost_usd)}`;
  return tool;
}

export async function readWhisperTool(probes) {
  const tool = { id: 'whisper', name: 'Whisper', kind: 'local', installed: false, active: false, detail: 'Not checked this time', note: WHISPER_NOTE };
  if (!probes) return tool;
  const state = probes.whisper();
  if (!state.done) await Promise.race([state.promise, delay(WHISPER_FIRST_WAIT_MS)]);
  if (!state.done) {
    tool.detail = "Checking whether it's installed";
    return tool;
  }
  tool.installed = state.value;
  tool.active = state.value;
  tool.detail = state.value ? 'Speech to text, runs on your PC' : 'Not installed. Speech to text would live here.';
  return tool;
}

export async function readOllamaTool({ localAppData, probes } = {}) {
  const tool = { id: 'ollama', name: 'Ollama', kind: 'local', installed: false, active: false, detail: '', note: OLLAMA_NOTE };
  const exe = localAppData ? path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe') : '';
  const [tags, exeFound] = await Promise.all([probes ? probes.ollama() : Promise.resolve(null), fileExists(exe)]);
  if (tags) {
    tool.installed = true;
    tool.active = true;
    const names = tags.models.slice(0, 3);
    tool.detail = names.length ? `Running · ${names.join(', ')}` : 'Running, no models yet';
    return tool;
  }
  tool.installed = exeFound;
  tool.detail = exeFound ? 'Installed, not running right now' : 'Not installed. Local models would live here.';
  return tool;
}

/**
 * Always returns [jev, whisper, ollama]. With `probes` null (probeTools off) nothing is spawned
 * and no port is touched.
 */
export async function detectTools({ claudeHome, localAppData, probes = null } = {}) {
  const [jev, whisper, ollama] = await Promise.all([
    readJevTool(claudeHome),
    readWhisperTool(probes),
    readOllamaTool({ localAppData, probes }),
  ]);
  return [jev, whisper, ollama];
}
