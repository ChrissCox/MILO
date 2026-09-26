'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const WINDOW_ACTIONS = ['minimize', 'maximize', 'close'];

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback function is required.');
  const listener = (_event, ...values) => callback(...values);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('milo', Object.freeze({
  loadState: () => ipcRenderer.invoke('milo:load-state'),
  saveState: state => ipcRenderer.invoke('milo:save-state', state),
  scan: () => ipcRenderer.invoke('milo:scan'),
  onSnapshot: callback => subscribe('milo:snapshot', callback),
  notify: payload => {
    if (!payload || typeof payload !== 'object') return Promise.resolve(false);
    const title = typeof payload.title === 'string' ? payload.title : '';
    const body = typeof payload.body === 'string' ? payload.body : '';
    return ipcRenderer.invoke('milo:notify', { title, body });
  },
  windowAction: action => {
    if (WINDOW_ACTIONS.includes(action)) ipcRenderer.send('milo:window-action', action);
  },
  onBeforeClose: callback => subscribe('milo:before-close', callback),
  finishClose: () => ipcRenderer.send('milo:finish-close'),
}));
