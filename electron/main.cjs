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

// Test hooks, readable through Playwright's application.evaluate().
if (IS_TEST) {
  globalThis.__miloNotifications = [];
  globalThis.__miloBlockedRequests = [];
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
      settings: { motion: true, notifications: true, greeting: true },
      skills: {},
      panel: null,
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
  if (!isLive(mainWindow) || mainWindow.isFocused()) return false;
  const title = cleanText(payload.title, 80);
  const body = cleanText(payload.body, 200);
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
    (async () => {
      try {
        await waitForRendererClose();
        await saveQueue;
      } catch (error) {
        report(error);
      } finally {
        stopScanning();
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
    installIPC();
    Menu.setApplicationMenu(null);
    createMainWindow();
    startScanning();
  }).catch(error => {
    report(error);
    app.quit();
  });
}
