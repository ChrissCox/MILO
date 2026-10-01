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

// The companions' notebook files (CONTRACT-PHASE4.md §10.2), under the same rule as saveState:
// every call resolves { ok: false, code: 'not-loaded' } until loadState() has resolved. Types are
// cleaned here (bytes must be a Uint8Array, `at` a whole number, else main refuses them); main
// checks ids, frames and bounds.
const notLoaded = () => Promise.resolve({ ok: false, code: 'not-loaded' });
const bytesOf = value => (Object.prototype.toString.call(value) === '[object Uint8Array]' ? value : null);
const wholeOf = value => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1);
const notebookCall = (channel, ...values) => (stateRead ? ipcRenderer.invoke(channel, ...values) : notLoaded());
const notebooks = Object.freeze({
  // → { ok: true, bytes: Uint8Array, size } (a missing notebook is empty bytes) or { ok: false, code }
  read: id => notebookCall('milo:notebook-read', text(id)),
  // Whole frames at `at` (unframe's good plus what's been appended since) → { ok, size } or { ok: false, code, size? }
  append: (id, bytes, at) => notebookCall('milo:notebook-append', text(id), bytesOf(bytes), wholeOf(at)),
  // A reset's whole file; { keepPrevious: true } keeps the old one until dropPrevious.
  replace: (id, bytes, options) => notebookCall('milo:notebook-replace', text(id), bytesOf(bytes), { keepPrevious: Boolean(options && options.keepPrevious === true) }),
  // The previous file becomes current → { ok, size } or { ok: false, code: 'none' }
  restore: id => notebookCall('milo:notebook-restore', text(id)),
  dropPrevious: id => notebookCall('milo:notebook-drop-previous', text(id)),
});

// Kindle's bell, kept in main so it rings on time while MILO is covered (§10.3). set(null) clears it.
const alarmOf = value => {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return 'not an alarm';
  return { id: text(value.id), at: typeof value.at === 'number' ? value.at : NaN, title: text(value.title), body: text(value.body) };
};
const alarm = Object.freeze({
  // → true when armed or cleared (an `at` already past clears it without ringing), else false
  set: value => ipcRenderer.invoke('milo:alarm-set', alarmOf(value)),
  // cb({ id }) when the alarm rings → unsubscribe. A callback that isn't a function is refused here,
  // as onSnapshot's is, rather than failing later inside the IPC listener.
  onRing: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback function is required.');
    return subscribe('milo:alarm', payload => {
      if (payload && typeof payload.id === 'string') callback({ id: payload.id });
    });
  },
});

const NOTIFY_KINDS = ['gate-bell', 'alert', 'kindle'];

contextBridge.exposeInMainWorld('milo', Object.freeze({
  loadState: () => ipcRenderer.invoke('milo:load-state').then(value => {
    stateRead = true;
    return value;
  }),
  saveState: state => (stateRead
    ? ipcRenderer.invoke('milo:save-state', state)
    : Promise.resolve({ ok: false, error: 'MILO hasn’t read its saved state yet.' })),
  scan: () => ipcRenderer.invoke('milo:scan'),
  // The game's content bundle (CONTRACT-PHASE4.md §9.1): { genres, riftgen, fortress, wilds, story,
  // skills, xp, economy, spells, examine, trails, sky, combat, party, camp }, each parsed JSON or null.
  content: () => ipcRenderer.invoke('milo:content'),
  // { offset }: the test clock's offset in ms (MILO_NOW, tests only), else 0.
  clock: () => ipcRenderer.invoke('milo:clock'),
  onSnapshot: callback => subscribe('milo:snapshot', callback),
  notify: payload => {
    if (!payload || typeof payload !== 'object') return Promise.resolve(false);
    const title = typeof payload.title === 'string' ? payload.title : '';
    const body = typeof payload.body === 'string' ? payload.body : '';
    // The Gate Bell's note and Kindle's bell follow their own switches; every other note follows Alerts.
    const kind = NOTIFY_KINDS.includes(payload.kind) ? payload.kind : 'alert';
    return ipcRenderer.invoke('milo:notify', { title, body, kind });
  },
  windowAction: action => {
    if (WINDOW_ACTIONS.includes(action)) ipcRenderer.send('milo:window-action', action);
  },
  onBeforeClose: callback => subscribe('milo:before-close', callback),
  finishClose: () => ipcRenderer.send('milo:finish-close'),
  architect,
  notebooks,
  alarm,
}));
