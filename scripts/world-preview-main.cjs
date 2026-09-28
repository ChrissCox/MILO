// Minimal Electron main that shows scripts/world-preview.html on its own.
// Used by scripts/capture-world.mjs, capture-wilds.mjs and friends; not part of the MILO app.
//
// With MILO_PREVIEW_CONTENT=1 the preview gets the content bundle (content/*.json, as the app's
// main serves it) as window.__content, so the wilds come on without a capture script. This same
// file is then the page's preload: it asks main for the bundle once and hands it to the page.
// (Capture scripts can instead set window.__content with an init script, as capture-wilds.mjs does.)
const electron = require('electron');

if (electron.ipcRenderer && !electron.app) {
  // ---------- preload (sandboxed renderer) ----------
  const content = electron.ipcRenderer.sendSync('milo-preview:content');
  if (content) electron.contextBridge.exposeInMainWorld('__content', content);
} else {
  // ---------- main ----------
  const { app, BrowserWindow, session, ipcMain } = electron;
  const path = require('node:path');
  const fs = require('node:fs');

  const PREVIEW = path.join(__dirname, 'world-preview.html');
  const withContent = process.env.MILO_PREVIEW_CONTENT === '1';

  if (process.env.MILO_PREVIEW_USER_DATA) app.setPath('userData', process.env.MILO_PREVIEW_USER_DATA);

  function readContent() {
    const read = (name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', `${name}.json`), 'utf8'));
      } catch {
        return null;
      }
    };
    return { genres: read('genres'), riftgen: read('riftgen'), fortress: read('fortress'), wilds: read('wilds'), story: read('story') };
  }

  app.whenReady().then(() => {
    // Local files only: block every request that isn't file://.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://') });
    });
    const content = withContent ? readContent() : null;
    ipcMain.on('milo-preview:content', (event) => {
      event.returnValue = content;
    });
    const [width, height] = (process.env.MILO_PREVIEW_SIZE || '1000x700').split('x').map(Number);
    const window = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      show: false,
      backgroundColor: '#5b9169',
      webPreferences: {
        contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
        ...(withContent ? { preload: __filename } : {}),
      },
    });
    // Hidden windows get no animation frames, so show it without taking focus.
    window.once('ready-to-show', () => window.showInactive());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
    window.loadFile(PREVIEW, { search: process.env.MILO_PREVIEW_QUERY || '' });
  });

  app.on('window-all-closed', () => app.quit());
}
