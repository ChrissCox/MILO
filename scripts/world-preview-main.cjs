// Minimal Electron main that shows scripts/world-preview.html on its own.
// Used by scripts/capture-world.mjs; not part of the MILO app.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const PREVIEW = path.join(__dirname, 'world-preview.html');

if (process.env.MILO_PREVIEW_USER_DATA) app.setPath('userData', process.env.MILO_PREVIEW_USER_DATA);

app.whenReady().then(() => {
  // Local files only: block every request that isn't file://.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://') });
  });
  const [width, height] = (process.env.MILO_PREVIEW_SIZE || '1000x700').split('x').map(Number);
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    backgroundColor: '#5b9169',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
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
