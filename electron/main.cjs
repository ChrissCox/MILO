'use strict';

// MILO main process. Owns the saved state, the read-only watcher over
// ~/.claude and ~/.codex, and gentle desktop notifications. The renderer is
// sandboxed and only ever receives session summaries.

const { app, BrowserWindow, ipcMain, Menu, Notification, session } = require('electron');
const fs = require('node:fs/promises');
const { mkdirSync, realpathSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

// The on-disk spelling of the page. MILO can be started through a path with a lowercase drive
// letter (a shell whose cwd is c:\...), while Chromium reports frame URLs with an uppercase one;
// realpath.native gives the canonical spelling so the trusted-sender check still matches.
function canonicalPath(target) {
  try {
    return realpathSync.native(target);
  } catch {
    return target;
  }
}

const MAIN_FILE = canonicalPath(path.join(ROOT, 'index.html'));
const MAIN_URL = pathToFileURL(MAIN_FILE).href;

// Windows file URLs are case-insensitive; compare them that way there.
function sameFileURL(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
const isMainURL = url => sameFileURL(url, MAIN_URL);
const PRELOAD = path.join(__dirname, 'preload.cjs');
const ICON = path.join(ROOT, 'assets', 'milo.ico');
const IS_TEST = process.env.MILO_TEST === '1';
// In tests the world must keep moving even when other windows cover MILO's, so the checks
// don't depend on what else is on screen. Real launches still pause when covered or minimized.
if (IS_TEST) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const SCAN_INTERVAL_MS = 10_000;
const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'close']);

app.setName('MILO');
if (process.platform === 'win32') app.setAppUserModelId('local.milo.companion');
const dataDirectory = process.env.MILO_DATA_DIR
  ? path.resolve(process.env.MILO_DATA_DIR)
  : path.join(app.getPath('appData'), 'milo');
mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
const stateFile = path.join(dataDirectory, 'state.json');
const backupFile = `${stateFile}.backup`;

let mainWindow = null;
let savedState = null;
let lastGoodJSON = null;
let loadError = null;
let model = null;
let saveQueue = Promise.resolve();
let quitting = false;
let allowQuit = false;
let finishCloseRequest = null;
let initialLoad = Promise.resolve(null);

let watcher = null;
let watcherError = null;
let watcherReady = Promise.resolve();
let scanTimer = null;
let scanInFlight = null;
let lastSnapshot = null;
let lastSnapshotKey = '';
const liveNotifications = new Set();

// The architect (src/architect) asks Chris's crew to design buildings. It runs only here, in the
// main process; the renderer never touches the network or spawns anything.
let architectModule = null;
let architectError = null;
let architectReady = Promise.resolve();
let mapModule = null;
let architect = null;
let flight = null;
const DESIGNER_MODES = new Set(['auto', 'claude', 'codex', 'kit']);
const FLIGHT_LIMIT_MS = 330_000;
// How long a cancel waits for the crew process to let go: a little longer than crew.js gives a
// stopped process tree (3 s), so its temp folder is gone before Chris can ask again or MILO quits.
const CANCEL_WAIT_MS = 4500;
const CREW_IDS = new Set(['claude', 'codex']);
const FALLBACK_CODES = new Set(['missing', 'auth', 'agents', 'invalid', 'failed', 'timeout', 'spawn']);
const PLOTS = {
  'plot-meadow': { name: 'Long meadow', legacy: 'workshop' },
  'plot-rise': { name: 'Sunny rise', legacy: 'clip-studio' },
  'plot-birch': { name: 'Birch hollow', legacy: 'library' },
  'plot-pond': { name: 'Pondside plot', legacy: 'game-table' },
  'plot-orchard': { name: 'Old orchard', legacy: 'building-site' },
};
// Milo's own buildings, which no idea should copy.
const MILO_BUILDINGS = ["Milo's camp", 'Watchtower'];
const MESSAGES = {
  busy: 'Milo is already asking the crew.',
  unavailable: "Milo's drafting kit isn't unpacked yet.",
  failed: "Milo couldn't hear back from the crew just now.",
  cancelled: 'Milo stopped asking.',
  plot: "Milo can't find that plot.",
  idea: 'Milo needs an idea to design from.',
};

// Test hooks, readable through Playwright's application.evaluate().
if (IS_TEST) {
  globalThis.__miloNotifications = [];
  // Every notify request with the window's focus at that moment, so tests don't race focus changes.
  globalThis.__miloNotifyDecisions = [];
  globalThis.__miloBlockedRequests = [];
  globalThis.__miloArchitectCalls = [];
}

function report(error) {
  console.error('[MILO]', error instanceof Error ? error.message : error);
}

function isLive(window) {
  return Boolean(window && !window.isDestroyed());
}

function trustedSender(event) {
  return isLive(mainWindow)
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && isMainURL(event.senderFrame.url);
}

// A small stand-in so the window still opens if src/model.js is unavailable.
const fallbackModel = {
  createState(now = Date.now()) {
    void now;
    return {
      version: 1,
      user: { name: 'Chris' },
      milo: { name: 'Milo', tile: null },
      lastSeenAt: null,
      lastGreetedDay: null,
      settings: { motion: true, notifications: true, greeting: true, designer: 'auto' },
      skills: {},
      panel: null,
      plots: {},
    };
  },
  normalizeState(input) {
    const base = fallbackModel.createState();
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return {
      ...base,
      ...value,
      user: { ...base.user, ...(value.user || {}) },
      milo: { ...base.milo, ...(value.milo || {}) },
      settings: { ...base.settings, ...(value.settings || {}) },
      skills: value.skills && typeof value.skills === 'object' ? value.skills : {},
    };
  },
};

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Same rule as src/model.js looksLikeSavedState, kept here too for when the model can't load.
function looksLikeSavedState(value) {
  if (typeof model?.looksLikeSavedState === 'function') return model.looksLikeSavedState(value);
  return isPlainObject(value) && isPlainObject(value.settings) && isPlainObject(value.milo) && isPlainObject(value.user);
}

function stateJSON(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !value.settings || typeof value.settings !== 'object'
    || !value.milo || typeof value.milo !== 'object'
    || !value.user || typeof value.user !== 'object') {
    throw new Error('The saved state has an invalid format.');
  }
  const json = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) {
    throw new Error('The saved state is too large to save.');
  }
  return json;
}

async function loadFromDisk() {
  let hadReadError = false;
  for (const filename of [stateFile, backupFile]) {
    try {
      const stat = await fs.stat(filename);
      if (stat.size > MAX_STATE_BYTES) throw new Error('Saved state exceeds the size limit.');
      const parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
      // Valid JSON that isn't a saved state (null, [], 42, {}) is damage, not a fresh start:
      // try the backup instead of normalizing to defaults and then overwriting the backup.
      if (!looksLikeSavedState(parsed)) throw new Error('The saved state has an invalid format.');
      const normalized = model.normalizeState(parsed);
      lastGoodJSON = stateJSON(normalized);
      savedState = normalized;
      loadError = null;
      if (filename === backupFile) report('Recovered MILO state from its previous good backup.');
      return savedState;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        hadReadError = true;
        report(`Could not read ${path.basename(filename)}: ${error.message}`);
      }
    }
  }
  if (hadReadError) {
    loadError = new Error('MILO could not open its saved state, and no valid backup was available. The existing files were left unchanged.');
    return null;
  }
  // First launch: start fresh in memory. Nothing is written until the renderer saves.
  savedState = model.normalizeState(model.createState(Date.now()));
  return savedState;
}

async function atomicWrite(filename, contents) {
  const temporary = `${filename}.tmp`;
  let file;
  try {
    file = await fs.open(temporary, 'w', 0o600);
    await file.writeFile(contents, 'utf8');
    await file.sync();
    await file.close();
    file = null;
    try {
      await fs.rename(temporary, filename);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      // Some redirected Windows profile folders reject even a sibling rename.
      await fs.copyFile(temporary, filename);
      file = await fs.open(filename, 'r+');
      await file.sync();
      await file.close();
      file = null;
      await fs.unlink(temporary);
    }
  } catch (error) {
    if (file) await file.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

// Writes are serialized so a slower write can never replace a newer state.
// The backup always holds the previous successfully saved contents.
function persistState(value) {
  if (loadError) return Promise.resolve({ ok: false, error: loadError.message });
  let json;
  try {
    json = stateJSON(model.normalizeState(value));
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message });
  }
  const pending = saveQueue.then(async () => {
    try {
      if (json === lastGoodJSON) return { ok: true };
      await fs.mkdir(dataDirectory, { recursive: true });
      if (lastGoodJSON !== null) await atomicWrite(backupFile, lastGoodJSON);
      await atomicWrite(stateFile, json);
      lastGoodJSON = json;
      savedState = JSON.parse(json);
      return { ok: true };
    } catch (error) {
      report(error);
      return { ok: false, error: "MILO couldn't save. Check that its data folder is writable." };
    }
  });
  saveQueue = pending.then(() => undefined, report);
  return pending;
}

// ---------------------------------------------------------------------------
// Watchkeeping: scan at launch, then every ten seconds, push on change.

function emptySnapshot(error) {
  const source = home => ({ ok: false, path: home, count: 0, live: false, error });
  return {
    scannedAt: Date.now(),
    sessions: [],
    tools: [],
    sources: {
      claude: source(process.env.MILO_CLAUDE_HOME || ''),
      codex: source(process.env.MILO_CODEX_HOME || ''),
    },
  };
}

function snapshotKey(snapshot) {
  try {
    return JSON.stringify([snapshot.sessions, snapshot.tools, snapshot.sources]);
  } catch {
    return String(Date.now());
  }
}

function pushSnapshot(snapshot) {
  if (isLive(mainWindow) && !mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.send('milo:snapshot', snapshot);
  }
}

async function loadWatcher() {
  try {
    const watch = await import(pathToFileURL(path.join(ROOT, 'src', 'watch', 'index.js')).href);
    watcher = watch.createWatcher();
    watcherError = null;
  } catch (error) {
    watcher = null;
    watcherError = "Watchkeeping isn't ready yet.";
    report(`Watcher unavailable: ${error.message}`);
  }
}

function runScan() {
  if (scanInFlight) return scanInFlight;
  scanInFlight = (async () => {
    let snapshot;
    try {
      await watcherReady;
      snapshot = watcher ? await watcher.scan() : emptySnapshot(watcherError || "Watchkeeping isn't ready yet.");
    } catch (error) {
      report(`Scan failed: ${error.message}`);
      snapshot = lastSnapshot || emptySnapshot('Milo lost track for a moment. Trying again shortly.');
    }
    const key = snapshotKey(snapshot);
    lastSnapshot = snapshot;
    if (key !== lastSnapshotKey) {
      lastSnapshotKey = key;
      pushSnapshot(snapshot);
    }
    return snapshot;
  })().finally(() => { scanInFlight = null; });
  return scanInFlight;
}

function startScanning() {
  runScan().catch(report);
  scanTimer = setInterval(() => { if (!quitting) runScan().catch(report); }, SCAN_INTERVAL_MS);
}

function stopScanning() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  try { watcher?.dispose?.(); } catch (error) { report(error); }
}

// ---------------------------------------------------------------------------
// Notifications: only when MILO is not focused and alerts are on.

function focusMain() {
  if (!isLive(mainWindow) || quitting) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function cleanText(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function notify(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (savedState?.settings?.notifications === false) return false;
  const title = cleanText(payload.title, 80);
  const body = cleanText(payload.body, 200);
  const focused = isLive(mainWindow) && mainWindow.isFocused();
  if (IS_TEST) globalThis.__miloNotifyDecisions.push({ title, focused, at: Date.now() });
  if (!isLive(mainWindow) || focused) return false;
  if (!title) return false;
  if (IS_TEST) {
    globalThis.__miloNotifications.push({ title, body, at: Date.now() });
    return true;
  }
  if (!Notification.isSupported()) return false;
  const toast = new Notification({ title, body, icon: ICON, silent: true });
  liveNotifications.add(toast);
  const release = () => liveNotifications.delete(toast);
  toast.on('click', () => { release(); focusMain(); });
  toast.on('close', release);
  toast.on('failed', release);
  toast.show();
  return true;
}

// ---------------------------------------------------------------------------
// The architect: ideas and designs for Chris's plots.
//
// Only what the step 2 privacy rule allows ever reaches it from here: the question or idea Chris
// typed or picked, the plot's name and size, and the names of the buildings (and ideas) on the
// plots. The architect adds his project folder names and skill names itself. No session data,
// transcript, snippet or anything from ~/.codex goes in.

async function loadArchitect() {
  try {
    mapModule = await import(pathToFileURL(path.join(ROOT, 'src', 'world', 'map.js')).href);
  } catch (error) {
    mapModule = null;
    report(`Map unavailable to the architect, using plot defaults: ${error.message}`);
  }
  try {
    architectModule = await import(pathToFileURL(path.join(ROOT, 'src', 'architect', 'index.js')).href);
    if (typeof architectModule.createArchitect !== 'function') throw new Error('createArchitect is missing.');
    // The architect reads MILO_ARCHITECT (auto, claude, codex, kit, or fake for tests),
    // MILO_CLAUDE_HOME and MILO_PROJECTS_DIR itself.
    architect = architectModule.createArchitect();
    architectError = null;
  } catch (error) {
    architectModule = null;
    architect = null;
    architectError = MESSAGES.unavailable;
    report(`Architect unavailable: ${error.message}`);
  }
  // A crash or a hard stop can leave a crew call's temp folder behind; tidy MILO's own old ones.
  try {
    const crew = await import(pathToFileURL(path.join(ROOT, 'src', 'architect', 'crew.js')).href);
    crew.sweepCrewTempDirs?.({ olderThanMs: FLIGHT_LIMIT_MS }).catch(report);
  } catch (error) {
    report(`Temp folder sweep skipped: ${error.message}`);
  }
}

// The Designer setting at camp, passed with every call. (MILO_ARCHITECT=kit still wins: nothing is sent.)
function designerSetting() {
  const designer = savedState?.settings?.designer;
  return DESIGNER_MODES.has(designer) ? designer : 'auto';
}

const isPlotId = id => typeof id === 'string' && Object.hasOwn(PLOTS, id);

function areaOf(value) {
  if (!value || typeof value !== 'object') return null;
  const w = Math.floor(Number(value.w));
  const h = Math.floor(Number(value.h));
  return w > 0 && h > 0 && w <= 64 && h <= 64 ? { w, h } : null;
}

// { id, name, w, h }: the plot's buildable size in tiles, from the map when it knows it.
function plotInfo(plotId) {
  const known = PLOTS[plotId];
  let place = null;
  let size = null;
  try {
    place = mapModule?.placeById?.(plotId) || mapModule?.placeById?.(known.legacy) || null;
  } catch { place = null; }
  try {
    size = areaOf(mapModule?.buildableArea?.(plotId));
  } catch { size = null; }
  if (!size && place?.area) {
    const area = areaOf(place.area);
    if (area) size = { w: Math.max(3, area.w - 2), h: Math.max(3, area.h - 2) };
  }
  const name = place && place.id === plotId && typeof place.name === 'string' && place.name ? place.name : known.name;
  return { id: plotId, name, ...(size || { w: 7, h: 5 }) };
}

const savedPlot = plotId => {
  const plot = savedState?.plots?.[plotId];
  return plot && typeof plot === 'object' ? plot : null;
};

function buildingNameOf(plot) {
  if (typeof model?.buildingName === 'function') return model.buildingName(plot);
  if (!plot || plot.status !== 'built') return '';
  return cleanText(plot.name || plot.blueprint?.name, 28);
}

// Names of the buildings already standing: Milo's own, then Chris's (minus the plot being redesigned).
function builtNames(exceptPlotId = null) {
  const plots = savedState?.plots && typeof savedState.plots === 'object' ? savedState.plots : {};
  const names = Object.entries(plots)
    .filter(([id]) => id !== exceptPlotId)
    .map(([, plot]) => buildingNameOf(plot))
    .filter(Boolean);
  return [...MILO_BUILDINGS, ...names];
}

function cleanSuggestionList(value) {
  if (typeof model?.cleanSuggestions === 'function') return model.cleanSuggestions(value);
  return Array.isArray(value) ? value.slice(0, 3) : [];
}

function cleanIdea(value) {
  if (typeof model?.cleanSuggestion === 'function') return model.cleanSuggestion(value);
  return value && typeof value === 'object' && typeof value.title === 'string' && value.title.trim() ? value : null;
}

const cleanBy = value => (['claude', 'codex', 'kit'].includes(value) ? value : 'kit');
// Why Milo drew it himself, as the architect's enums only (the renderer words it).
function cleanFallback(value) {
  if (!value || typeof value !== 'object' || !FALLBACK_CODES.has(value.code)) return null;
  return { by: CREW_IDS.has(value.by) ? value.by : null, code: value.code };
}
const cleanSkipped = value => (Array.isArray(value) ? [...new Set(value.filter(id => CREW_IDS.has(id)))] : []);

// Tells the renderer who has the brief right now, each time the architect asks a crew member.
function tellAsking(id) {
  if (!CREW_IDS.has(id) || !isLive(mainWindow) || mainWindow.webContents.isLoadingMainFrame()) return;
  mainWindow.webContents.send('milo:architect-asking', id);
}
const cleanSuggestBy = value => (['claude', 'codex', 'local', 'kit'].includes(value) ? value : 'local');
const failure = (code, error) => ({ ok: false, code, error: error || MESSAGES[code] || MESSAGES.failed });

function recordCall(entry) {
  if (IS_TEST) globalThis.__miloArchitectCalls.push(JSON.parse(JSON.stringify({ ...entry, at: Date.now() })));
}

// One request to the crew at a time, across ideas and designs.
async function runFlight(kind, plotId, work) {
  await architectReady;
  if (flight) return failure('busy');
  if (!architect) return failure('unavailable', architectError);
  let settle;
  const current = { kind, plotId, cancelled: false, done: new Promise(resolve => { settle = resolve; }) };
  flight = current;
  let watchdog = null;
  try {
    const limit = new Promise((_, reject) => {
      watchdog = setTimeout(() => {
        try { architect.cancel(); } catch (error) { report(error); }
        reject(new Error('The crew took too long.'));
      }, FLIGHT_LIMIT_MS);
    });
    const result = await Promise.race([Promise.resolve().then(() => work(architect)), limit]);
    if (current.cancelled) return failure('cancelled');
    return result;
  } catch (error) {
    if (current.cancelled || error?.code === 'cancelled') return failure('cancelled');
    if (error?.code === 'busy') return failure('busy');
    // A redesign the crew couldn't finish: the building stays, and the reason goes to Chris.
    if (error?.code === 'crew-failed') {
      return { ...failure('crew', cleanText(error.message, 160) || MESSAGES.failed), fallback: cleanFallback(error.fallback) };
    }
    report(`Architect ${kind} failed: ${error?.message || error}`);
    return failure('failed');
  } finally {
    clearTimeout(watchdog);
    if (flight === current) flight = null;
    settle();
  }
}

async function architectStatus({ refresh = false } = {}) {
  await architectReady;
  const setting = designerSetting();
  const base = { available: false, setting, mode: architect?.mode || null, busy: flight ? { kind: flight.kind, plotId: flight.plotId } : null };
  if (!architect) return { ...base, designer: 'kit', crew: [], error: architectError || MESSAGES.unavailable };
  try {
    const status = await architect.status({ designer: setting, refresh: refresh === true });
    const crew = Array.isArray(status?.crew) ? status.crew.filter(member => member && typeof member === 'object').map(member => ({
      id: member.id === 'codex' ? 'codex' : 'claude',
      found: member.found === true,
      ready: member.ready === true,
      detail: cleanText(member.detail, 160),
    })) : [];
    return { ...base, available: true, designer: cleanBy(status?.designer), fallsBack: status?.fallsBack === true, crew };
  } catch (error) {
    report(`Architect status failed: ${error.message}`);
    return { ...base, available: true, designer: 'kit', crew: [], error: MESSAGES.failed };
  }
}

async function architectLocal(plotId) {
  await architectReady;
  if (!isPlotId(plotId)) return failure('plot');
  if (!architect) return failure('unavailable', architectError);
  try {
    const suggestions = cleanSuggestionList(await architect.localSuggestions(plotInfo(plotId), builtNames()));
    return { ok: true, suggestions, by: 'local' };
  } catch (error) {
    report(`Local ideas failed: ${error.message}`);
    return failure('failed', "Milo's notebook of ideas is stuck shut.");
  }
}

function architectSuggest(plotId, question) {
  if (!isPlotId(plotId)) return Promise.resolve(failure('plot'));
  const asked = cleanText(question, 110);
  return runFlight('suggest', plotId, async crew => {
    // The ideas on the plot now, so the fresh three are different ones.
    const exclude = (savedPlot(plotId)?.suggestions || []).map(idea => cleanText(idea?.title, 28)).filter(Boolean);
    const request = { plot: plotInfo(plotId), question: asked, built: builtNames(), exclude, designer: designerSetting() };
    recordCall({ kind: 'suggest', mode: crew.mode || null, ...request });
    const result = await crew.suggest({ ...request, onAsk: tellAsking });
    const suggestions = cleanSuggestionList(result?.suggestions);
    if (!suggestions.length) return failure('failed');
    return {
      ok: true, suggestions, by: cleanSuggestBy(result?.by), note: cleanText(result?.note, 160),
      fallback: cleanFallback(result?.fallback), skipped: cleanSkipped(result?.skipped),
    };
  });
}

function architectDesign(plotId, idea, tweak) {
  if (!isPlotId(plotId)) return Promise.resolve(failure('plot'));
  const clean = cleanIdea(idea);
  if (!clean) return Promise.resolve(failure('idea'));
  const change = cleanText(tweak, 110);
  return runFlight('design', plotId, async crew => {
    const request = { plot: plotInfo(plotId), idea: clean, tweak: change, built: builtNames(plotId), designer: designerSetting() };
    // A redesign starts from the plans already standing there (the crew's own earlier answer).
    const standing = savedPlot(plotId);
    if (standing?.status === 'built' && standing.blueprint) request.previous = standing.blueprint;
    recordCall({ kind: 'design', mode: crew.mode || null, ...request });
    const result = await crew.design({ ...request, onAsk: tellAsking });
    const blueprint = typeof model?.checkBlueprint === 'function' ? model.checkBlueprint(result?.blueprint) : result?.blueprint;
    if (!blueprint) return failure('failed');
    return {
      ok: true, blueprint, by: cleanBy(result?.by), note: cleanText(result?.note, 160),
      fallback: cleanFallback(result?.fallback), skipped: cleanSkipped(result?.skipped),
    };
  });
}

// Stops the crew call and waits (briefly) until the request has let go, so Chris can ask again at once.
async function architectCancel() {
  const current = flight;
  if (!current) return { ok: true, cancelled: false };
  current.cancelled = true;
  try { architect?.cancel(); } catch (error) { report(error); }
  await Promise.race([current.done, new Promise(resolve => setTimeout(resolve, CANCEL_WAIT_MS))]);
  return { ok: true, cancelled: true };
}

// ---------------------------------------------------------------------------

function installIPC() {
  ipcMain.handle('milo:load-state', async event => {
    if (!trustedSender(event)) return null;
    await initialLoad;
    await saveQueue;
    if (loadError) throw loadError;
    return savedState;
  });
  ipcMain.handle('milo:save-state', (event, value) => {
    if (!trustedSender(event)) return { ok: false, error: "This window can't save MILO's state." };
    return persistState(value);
  });
  ipcMain.handle('milo:scan', async event => {
    if (!trustedSender(event)) return null;
    return runScan();
  });
  ipcMain.handle('milo:notify', (event, payload) => {
    if (!trustedSender(event)) return false;
    return notify(payload);
  });
  ipcMain.handle('milo:architect-status', async (event, options) => {
    if (!trustedSender(event)) return null;
    return architectStatus({ refresh: options?.refresh === true });
  });
  ipcMain.handle('milo:architect-local', (event, plotId) => {
    if (!trustedSender(event)) return failure('unavailable', "This window can't ask the crew.");
    return architectLocal(plotId);
  });
  ipcMain.handle('milo:architect-suggest', (event, plotId, question) => {
    if (!trustedSender(event)) return failure('unavailable', "This window can't ask the crew.");
    return architectSuggest(plotId, question);
  });
  ipcMain.handle('milo:architect-design', (event, plotId, idea, tweak) => {
    if (!trustedSender(event)) return failure('unavailable', "This window can't ask the crew.");
    return architectDesign(plotId, idea, tweak);
  });
  ipcMain.handle('milo:architect-cancel', event => {
    if (!trustedSender(event)) return { ok: false, cancelled: false };
    return architectCancel();
  });
  ipcMain.on('milo:window-action', (event, action) => {
    if (!trustedSender(event) || !isLive(mainWindow) || !WINDOW_ACTIONS.has(action)) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
    if (action === 'close') app.quit();
  });
  ipcMain.on('milo:finish-close', event => {
    if (quitting && trustedSender(event)) finishCloseRequest?.();
  });
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#dfe8c8',
    title: 'MILO',
    icon: ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: !IS_TEST,
    },
  });
  mainWindow = window;
  secureWindow(window);
  window.once('ready-to-show', () => {
    if (isLive(window) && !quitting) window.show();
  });
  window.on('close', event => {
    if (!allowQuit) {
      event.preventDefault();
      app.quit();
    }
  });
  window.on('closed', () => { mainWindow = null; });
  window.webContents.on('did-finish-load', () => {
    if (lastSnapshot) pushSnapshot(lastSnapshot);
  });
  window.loadFile(MAIN_FILE).catch(report);
}

function waitForRendererClose() {
  if (!isLive(mainWindow) || mainWindow.webContents.isDestroyed()
    || mainWindow.webContents.isCrashed()
    || mainWindow.webContents.isLoadingMainFrame()
    || !isMainURL(mainWindow.webContents.mainFrame.url)) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      finishCloseRequest = null;
      resolve();
    };
    const timeout = setTimeout(finish, 3000);
    finishCloseRequest = finish;
    try {
      mainWindow.webContents.send('milo:before-close');
    } catch (error) {
      report(error);
      finish();
    }
  });
}

const ownsInstance = IS_TEST || app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.quit();
} else {
  app.on('second-instance', focusMain);
  app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    // The renderer marks the moment Chris last looked and flushes its saves,
    // then the main-process write queue drains. A stuck renderer gets 3 s.
    // A crew call still running is stopped and waited for (briefly), so its process tree and
    // temp folder are gone before MILO is.
    (async () => {
      try {
        await waitForRendererClose();
        await saveQueue;
      } catch (error) {
        report(error);
      } finally {
        stopScanning();
        try { await architectCancel(); } catch (error) { report(error); }
        allowQuit = true;
        app.quit();
      }
    })();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    try {
      model = await import(pathToFileURL(path.join(ROOT, 'src', 'model.js')).href);
    } catch (error) {
      report(`Model unavailable, using defaults: ${error.message}`);
      model = fallbackModel;
    }
    initialLoad = loadFromDisk();
    await initialLoad;
    // The renderer never needs the network. Transcript text stays on this PC.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        if (IS_TEST) globalThis.__miloBlockedRequests.push(details.url);
        callback({ cancel: true });
      },
    );
    watcherReady = loadWatcher();
    architectReady = loadArchitect();
    installIPC();
    Menu.setApplicationMenu(null);
    createMainWindow();
    startScanning();
  }).catch(error => {
    report(error);
    app.quit();
  });
}
