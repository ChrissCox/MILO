'use strict';

// MILO main process. Owns the saved state, the companions' notebook files, the read-only watcher
// over ~/.claude and ~/.codex, Kindle's bell, and gentle desktop notifications. The renderer is
// sandboxed and only ever receives session summaries.

const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, session } = require('electron');
const os = require('node:os');
const fs = require('node:fs/promises');
const { mkdirSync, realpathSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const contentManifest = require('./content.cjs');
const { createNotebookStore } = require('./notebooks.cjs');
const alarmModule = require('./alarm.cjs');

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

// The test clock: in test mode only, MILO_NOW (an ISO time or ms) moves every clock MILO keeps
// (the watcher, the saved state and the renderer, through milo:clock) to that moment, and it
// keeps running from there. A real launch always uses the real time.
function clockOffset() {
  if (!IS_TEST || !process.env.MILO_NOW) return 0;
  const raw = String(process.env.MILO_NOW).trim();
  const at = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(at) && at > 0 ? at - Date.now() : 0;
}
const CLOCK_OFFSET = clockOffset();
const now = () => Date.now() + CLOCK_OFFSET;

app.setName('MILO');
if (process.platform === 'win32') app.setAppUserModelId('local.milo.companion');
const dataDirectory = process.env.MILO_DATA_DIR
  ? path.resolve(process.env.MILO_DATA_DIR)
  : path.join(app.getPath('appData'), 'milo');
mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
const stateFile = path.join(dataDirectory, 'state.json');
const backupFile = `${stateFile}.backup`;
// The companions' notebooks (CONTRACT-PHASE4.md §10.2): <data>/notebooks/<id>.notes, made on the
// first write. Main stores their bytes and never reads a note.
const notebookDirectory = path.join(dataDirectory, 'notebooks');

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
let content = null;
let contentReady = Promise.resolve(null);

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
  globalThis.__miloCommissionRuns = [];
}
// Kindle's bell (§10.3): one alarm slot, kept here so it rings on time while MILO is covered. Under
// MILO_TEST, globalThis.__miloAlarm is the slot ({ id, at } or null) and __miloAlarmRings each ring.
const alarm = alarmModule.createAlarm({
  now,
  notify: payload => notify(payload),
  send: (channel, payload) => {
    if (isLive(mainWindow) && !mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.send(channel, payload);
  },
  ...(IS_TEST ? alarmModule.testHooks(globalThis) : {}),
});

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

// A small stand-in so the window still opens if src/model.js is unavailable. It has the same
// shape as model.createState, Phase 3's and Phase 4's keys included (CONTRACT-PHASE4.md §8), so a
// save through it loses nothing.
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
// A companion's empty roster entry (§8.3's Member): Milo, the Scribe, the Artificer and Jev are always there.
const fallbackMember = () => ({
  joinedAt: 0, warmth: 0, warmthWeek: { week: null, outing: 0 }, habitDay: null, path: null, boons: [], pending: [],
  control: 'review', reactions: {}, prepared: [], gifts: { margin: 0, spare: 0, through: null },
  notebook: { count: 0, fights: 0, rules: [], struck: [], accepts: '', previous: null },
});
const fallbackModel = {
  createState(at = Date.now()) {
    void at;
    return {
      version: 1,
      user: { name: 'Chris' },
      milo: { name: 'Milo', tile: null },
      lastSeenAt: null,
      lastGreetedDay: null,
      settings: {
        motion: true, notifications: true, greeting: true, designer: 'auto', eveningBell: '22:00', gateBell: true, wardPost: null,
        hud: 'adventure', kindleBell: true,
      },
      skills: {},
      panel: null,
      plots: {},
      firstSeenAt: null,
      tally: {
        daysSeen: 0, lastDay: null, sessionsFinished: 0, finishedIds: [], buildingsDesigned: 0,
        byCrew: { claude: 0, codex: 0, jev: 0, whisper: 0 }, answered: 0, answeredFast: 0, waiting: {}, answeredWaits: {},
        focusSessions: 0, restsHonoured: 0, chunksCharted: 0, features: {},
      },
      hearth: { tier: 1, raisedAt: {} },
      satchel: { materials: { birch: 0, ash: 0, pine: 0 }, essences: {}, essenceGenres: {}, relics: [], marks: 0, tonics: { cordial: 0, brew: 0 } },
      wilds: { seed: 'hushlands', at: null, wake: null, explored: [], lanterns: {}, opened: {}, notes: {}, glimmers: {}, felled: {} },
      rifts: { open: {}, warded: {}, letGo: {}, belled: {}, closedWild: {}, visited: {}, stitched: { real: 0, wild: 0, story: 0 }, deepest: 0, history: [] },
      story: { prologue: { done: {} }, letterReadAt: null, trackerHidden: false, trails: {}, facts: {} },
      embers: { balance: 0, lifetime: 0, ledger: [], paid: {}, paidBefore: 0, through: null, day: { key: null, crew: 0, answered: 0 }, backlogAt: null },
      xp: { skills: {}, through: null, day: { key: null, travels: 0 } },
      kindle: { phase: 'idle', startedAt: null, focusEndsAt: null, restStartedAt: null, restEndsAt: null, earned: false, paid: { focus: null, rest: null } },
      chronicle: { days: {}, fights: [], xpLines: [] },
      road: { xp: 0, paidFights: {}, stitchedThrough: null, levelShown: 1, firstWin: false },
      party: {
        roster: { milo: fallbackMember(), claude: fallbackMember(), codex: fallbackMember(), jev: fallbackMember() },
        chosen: ['claude', 'codex', 'jev'], formation: 'line', cheers: 0, regulars: [],
        outing: { startedAt: null, breathers: 0, breatherFight: null, freeBreather: false, warmed: false, heroes: {} },
        rests: { lanternDay: null, nooks: {}, freeReentry: {} },
        mode: 'long-road', play: 'guided',
        calm: { noise: true, adaptation: true, odds: 'bars', fastFoes: true, playback: 1, ghosts: false },
        strayMemory: {}, firstLeadMet: false, teachDay: null, seenScenes: {},
      },
      expedition: null,
      board: { quests: [], projects: [], thoughts: [], seq: 0, nudgedDay: null },
      people: {},
      camplife: { gather: null, last: null, cooked: {}, places: {} },
      commissions: { list: [], seq: 0, folders: {}, levels: {}, checks: {}, checked: {} },
    };
  },
  normalizeState(input, at = Date.now()) {
    const base = fallbackModel.createState(at);
    const value = record(input);
    const merged = { ...base, ...value };
    for (const key of ['user', 'milo', 'settings', 'tally', 'hearth', 'satchel', 'wilds', 'rifts', 'story', 'embers', 'xp', 'kindle', 'chronicle', 'road', 'party']) {
      merged[key] = { ...base[key], ...record(value[key]) };
    }
    merged.skills = record(value.skills);
    merged.plots = record(value.plots);
    // An expedition is null or a record, copied as saved: a section merge would turn null into {}.
    merged.expedition = isPlainObject(value.expedition) ? value.expedition : null;
    merged.board = { ...base.board, ...record(value.board) };
    merged.people = record(value.people);
    merged.camplife = { ...base.camplife, ...record(value.camplife) };
    merged.commissions = { ...base.commissions, ...record(value.commissions) };
    return merged;
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
      const normalized = model.normalizeState(parsed, now());
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
  savedState = model.normalizeState(model.createState(now()), now());
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
    json = stateJSON(model.normalizeState(value, now()));
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

// The notebook files (§10.2), written through the same atomicWrite and refused while the saved
// state couldn't be read, so a damaged save's notebooks are left exactly as they were. The file is
// the source of truth; the roster's count in state.json is only a hint the renderer reconciles.
const notebooks = createNotebookStore({
  dir: notebookDirectory,
  atomicWrite,
  blocked: () => loadError !== null,
  report,
});

// ---------------------------------------------------------------------------
// Content: the game's words and tables (content/**), read once at startup through the manifest
// (electron/content.cjs) and served to the renderer over IPC, because the page's CSP blocks fetch.
// Each file is the parsed JSON (or a talk's text), or null when it can't be read (too big, missing
// or not a JSON object); the renderer copes with a null.

async function loadContent() {
  content = await contentManifest.loadContent({ report });
  return content;
}

// ---------------------------------------------------------------------------
// Watchkeeping: scan at launch, then every ten seconds, push on change.

function emptySnapshot(error) {
  const source = home => ({ ok: false, path: home, count: 0, live: false, error });
  return {
    scannedAt: now(),
    sessions: [],
    tools: [],
    sources: {
      claude: source(process.env.MILO_CLAUDE_HOME || ''),
      codex: source(process.env.MILO_CODEX_HOME || ''),
    },
    capacity: { codex: null },
  };
}

function snapshotKey(snapshot) {
  try {
    return JSON.stringify([snapshot.sessions, snapshot.tools, snapshot.sources, snapshot.capacity ?? null]);
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
    // The watcher runs on the same clock as everything else (the test clock under MILO_NOW).
    watcher = watch.createWatcher({ now });
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

// A desktop note, never while MILO is in front. The Gate Bell's note ('gate-bell') follows the
// Gate Bell switch alone, Kindle's bell ('kindle') the Kindle bell switch alone, and every other
// note follows the Alerts setting.
const NOTIFY_KINDS = new Set(['gate-bell', 'alert', 'kindle']);
const NOTIFY_SWITCH = { 'gate-bell': 'gateBell', kindle: 'kindleBell', alert: 'notifications' };
function notify(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const kind = NOTIFY_KINDS.has(payload.kind) ? payload.kind : 'alert';
  const settings = savedState?.settings;
  if (settings?.[NOTIFY_SWITCH[kind]] === false) return false;
  const title = cleanText(payload.title, 80);
  const body = cleanText(payload.body, 200);
  const focused = isLive(mainWindow) && mainWindow.isFocused();
  if (IS_TEST) globalThis.__miloNotifyDecisions.push({ title, kind, focused, at: Date.now() });
  if (!isLive(mainWindow) || focused) return false;
  if (!title) return false;
  if (IS_TEST) {
    globalThis.__miloNotifications.push({ title, body, kind, at: Date.now() });
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
// ---- Commissions (PLAN.md Phase 6): one of the crew, sent to work in one folder Chris picked ----
// The runner (src/commission/runner.js) checks the folder on the real disk and holds the ward to
// the CLI's own switches. Under MILO_TEST it never starts a CLI: it answers from the folder itself.
let commissionRunner = null;
let commissionLoad = null;
function loadCommissions() {
  if (!commissionLoad) {
    commissionLoad = import(pathToFileURL(path.join(ROOT, 'src', 'commission', 'runner.js')).href).then(mod => {
      commissionRunner = mod.createRunner({ home: os.homedir(), own: ROOT, mode: IS_TEST || process.env.MILO_COMMISSIONS === 'fake' ? 'fake' : 'auto' });
      return mod;
    }).catch(error => {
      report(`Commissions unavailable: ${error.message}`);
      commissionLoad = null;
      return null;
    });
  }
  return commissionLoad;
}
const commissionText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const NO_CREW = 'MILO can’t send the crew just now.';

async function commissionEnv() {
  await loadCommissions();
  return {
    home: os.homedir(), own: ROOT,
    crew: commissionRunner ? commissionRunner.crew() : { claude: false, codex: false },
    busy: Boolean(commissionRunner?.busy),
  };
}

// Chris picks the folder himself, in the system's own folder dialog. (Tests name one in MILO_PICK_FOLDER.)
async function commissionFolder() {
  const mod = await loadCommissions();
  if (!mod) return { ok: false, why: NO_CREW };
  let picked = null;
  if (IS_TEST) picked = process.env.MILO_PICK_FOLDER || null;
  else if (isLive(mainWindow)) {
    const answer = await dialog.showOpenDialog(mainWindow, { title: 'Pick the project’s folder', properties: ['openDirectory'] });
    picked = answer.canceled ? null : answer.filePaths[0] || null;
  }
  if (!picked) return { ok: false, why: '' };
  return mod.checkFolder(picked, { home: os.homedir(), own: ROOT });
}

// A building's check, run in its folder (only Chris sets one).
let checkKill = null;
async function commissionCheck(folder, command) {
  const mod = await loadCommissions();
  if (!mod) return { ok: false, tail: '', ms: 0, why: NO_CREW };
  if (checkKill) return { ok: false, tail: '', ms: 0, why: 'A check is already running.' };
  if (IS_TEST) globalThis.__miloCommissionRuns.push({ check: commissionText(command, 200), folder: commissionText(folder, 400), at: Date.now() });
  try {
    return await mod.runCheck(commissionText(folder, 400), commissionText(command, 200), {
      home: os.homedir(), own: ROOT, mode: IS_TEST || process.env.MILO_COMMISSIONS === 'fake' ? 'fake' : 'auto', onKill: kill => { checkKill = kill; },
    });
  } finally {
    checkKill = null;
  }
}

async function commissionRun(value) {
  await loadCommissions();
  if (!commissionRunner) return { ok: false, stopped: false, summary: '', files: [], ms: 0, why: NO_CREW };
  const v = value && typeof value === 'object' ? value : {};
  const commission = {
    title: commissionText(v.title, 120), brief: commissionText(v.brief, 2000), folder: commissionText(v.folder, 400),
    who: v.who === 'codex' ? 'codex' : 'claude', ward: ['look', 'suggest', 'change'].includes(v.ward) ? v.ward : 'look',
  };
  if (IS_TEST) globalThis.__miloCommissionRuns.push({ who: commission.who, ward: commission.ward, folder: commission.folder, title: commission.title, at: Date.now() });
  return commissionRunner.run(commission);
}

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
  // The content bundle (CONTRACT-PHASE4.md §9.1, from electron/content.cjs): { genres, riftgen,
  // fortress, wilds, story, …Phase 4's files and groups }, each parsed JSON or null.
  ipcMain.handle('milo:content', async event => {
    if (!trustedSender(event)) return null;
    return contentReady;
  });
  // The clock offset: MILO_NOW's, in test mode only; 0 otherwise.
  ipcMain.handle('milo:clock', event => {
    if (!trustedSender(event)) return { offset: 0 };
    return { offset: CLOCK_OFFSET };
  });
  ipcMain.handle('milo:scan', async event => {
    if (!trustedSender(event)) return null;
    return runScan();
  });
  ipcMain.handle('milo:notify', (event, payload) => {
    if (!trustedSender(event)) return false;
    return notify(payload);
  });
  // Kindle's bell (§10.3): { id, at, title, body } arms the one slot, null clears it; true when
  // armed or cleared. The ring comes back as milo:alarm { id }.
  ipcMain.handle('milo:alarm-set', (event, value) => {
    if (!trustedSender(event)) return false;
    try {
      return alarm.set(value);
    } catch (error) {
      report(error);
      return false;
    }
  });
  // The notebooks (§10.2). The store cleans every argument (ids by regex, bytes as whole frames,
  // `at` in bounds) and never throws; writes wait for the saved state's first read, so a damaged
  // save's loadError refuses them as 'blocked'.
  const notebookCall = (name, run) => ipcMain.handle(`milo:notebook-${name}`, async (event, ...values) => {
    if (!trustedSender(event)) return { ok: false, code: 'untrusted' };
    try {
      await initialLoad.catch(() => {});
      return await run(...values);
    } catch (error) {
      report(error);
      return { ok: false, code: 'failed' };
    }
  });
  notebookCall('read', id => notebooks.read(id));
  notebookCall('append', (id, bytes, at) => notebooks.append(id, bytes, at));
  notebookCall('replace', (id, bytes, options) => notebooks.replace(id, bytes, { keepPrevious: options?.keepPrevious === true }));
  notebookCall('restore', id => notebooks.restore(id));
  notebookCall('drop-previous', id => notebooks.dropPrevious(id));
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
  ipcMain.handle('milo:commission-env', event => (trustedSender(event) ? commissionEnv() : null));
  ipcMain.handle('milo:commission-folder', event => (trustedSender(event) ? commissionFolder() : { ok: false, why: '' }));
  ipcMain.handle('milo:commission-run', (event, value) => (trustedSender(event) ? commissionRun(value) : { ok: false, stopped: false, summary: '', files: [], ms: 0, why: NO_CREW }));
  ipcMain.handle('milo:commission-cancel', event => (trustedSender(event) && commissionRunner ? commissionRunner.cancel() : false));
  ipcMain.handle('milo:commission-check', (event, folder, command) => (trustedSender(event) ? commissionCheck(folder, command) : { ok: false, tail: '', ms: 0, why: NO_CREW }));
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
    // Nobody is left out working after MILO closes.
    try { commissionRunner?.cancel(); checkKill?.('cancelled'); } catch (error) { report(error); }
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    // The renderer marks the moment Chris last looked and flushes its saves and notebook appends,
    // then the main-process write queues (the state and the notebooks) drain. A stuck renderer
    // gets 3 s. A crew call still running is stopped and waited for (briefly), so its process tree
    // and temp folder are gone before MILO is.
    (async () => {
      try {
        await waitForRendererClose();
        await Promise.all([saveQueue, notebooks.flush()]);
      } catch (error) {
        report(error);
      } finally {
        stopScanning();
        alarm.dispose();
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
    contentReady = loadContent().catch(error => { report(error); return null; });
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
    // After a sleep, Kindle's bell re-arms from the wall clock (or rings, if it came due meanwhile).
    try {
      powerMonitor.on('resume', () => alarm.recheck());
    } catch (error) {
      report(error);
    }
    installIPC();
    Menu.setApplicationMenu(null);
    createMainWindow();
    startScanning();
  }).catch(error => {
    report(error);
    app.quit();
  });
}
