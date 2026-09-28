'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const WINDOW_ACTIONS = ['minimize', 'maximize', 'close'];

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback function is required.');
  const listener = (_event, ...values) => callback(...values);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const text = value => (typeof value === 'string' ? value : '');

// Only the fields a Suggestion has, as plain strings, cross over to the main process.
function ideaOf(value) {
  if (typeof value === 'string') return { title: value, pitch: value, why: '', source: 'local', id: '' };
  if (!value || typeof value !== 'object') return null;
  return { id: text(value.id), title: text(value.title), pitch: text(value.pitch), why: text(value.why), source: text(value.source) };
}

const CREW = ['claude', 'codex'];

const architect = Object.freeze({
  // { refresh: true } asks the crew's sign-in checks again (the camp panel does, when it opens).
  status: options => ipcRenderer.invoke('milo:architect-status', { refresh: Boolean(options && options.refresh) }),
  localSuggestions: plotId => ipcRenderer.invoke('milo:architect-local', text(plotId)),
  suggest: (plotId, question) => ipcRenderer.invoke('milo:architect-suggest', text(plotId), text(question)),
  design: (plotId, idea, tweak) => ipcRenderer.invoke('milo:architect-design', text(plotId), ideaOf(idea), text(tweak)),
  cancel: () => ipcRenderer.invoke('milo:architect-cancel'),
  // Who has the brief right now ('claude' or 'codex'), each time the architect asks a crew member.
  onAsking: callback => subscribe('milo:architect-asking', id => { if (CREW.includes(id)) callback(id); }),
});

// A page saves only after it has read the saved state: before that it holds nothing of Chris's,
// and a save would put a default over state.json (and, on the next save, over its backup too).
let stateRead = false;

contextBridge.exposeInMainWorld('milo', Object.freeze({
  loadState: () => ipcRenderer.invoke('milo:load-state').then(value => {
    stateRead = true;
    return value;
  }),
  saveState: state => (stateRead
    ? ipcRenderer.invoke('milo:save-state', state)
    : Promise.resolve({ ok: false, error: 'MILO hasn’t read its saved state yet.' })),
  scan: () => ipcRenderer.invoke('milo:scan'),
  // The game's content bundle { genres, riftgen, fortress, wilds, story } (each parsed JSON or null).
  content: () => ipcRenderer.invoke('milo:content'),
  // { offset }: the test clock's offset in ms (MILO_NOW, tests only), else 0.
  clock: () => ipcRenderer.invoke('milo:clock'),
  onSnapshot: callback => subscribe('milo:snapshot', callback),
  notify: payload => {
    if (!payload || typeof payload !== 'object') return Promise.resolve(false);
    const title = typeof payload.title === 'string' ? payload.title : '';
    const body = typeof payload.body === 'string' ? payload.body : '';
    // The Gate Bell's note follows its own switch; every other note follows Alerts.
    const kind = payload.kind === 'gate-bell' ? 'gate-bell' : 'alert';
    return ipcRenderer.invoke('milo:notify', { title, body, kind });
  },
  windowAction: action => {
    if (WINDOW_ACTIONS.includes(action)) ipcRenderer.send('milo:window-action', action);
  },
  onBeforeClose: callback => subscribe('milo:before-close', callback),
  finishClose: () => ipcRenderer.send('milo:finish-close'),
  architect,
}));
