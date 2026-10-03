// Kindle's bell in the main process (CONTRACT-PHASE4.md §10.3): electron/alarm.cjs. One slot, never
// a ring for a past time, powerMonitor's recheck, and the __miloAlarm test hooks, with a manual clock
// and manual timers. Then the bridge around it (§10.1, §10.4, §10.5): electron/preload.cjs loaded
// with a stand-in `electron` (window.milo's keys, the notebooks' not-loaded gate, what crosses IPC),
// and electron/main.cjs run under MILO_TEST in a child Node process with a stand-in `electron`, its
// own data folder and empty crew homes (__miloAlarm through milo:alarm-set, the ring, powerMonitor's
// resume, the Kindle switch, the notebook channels, a damaged save blocking writes, and before-quit's
// flush). Last, main's fallbackModel against src/model.js's createState.
//   node --test tests/alarm.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createAlarm, cleanAlarm, testHooks, LATE_MS, MAX_DELAY } = require('../electron/alarm.cjs');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const T = Date.parse('2026-09-29T09:00:00Z');
const MIN = 60_000;

// A clock and timers that move only when told to, and a record of every bell.
function rig({ throwing = false } = {}) {
  let clock = T;
  let nextId = 1;
  const timers = new Map();
  const notes = [];
  const sent = [];
  const hooks = { __miloAlarm: undefined, __miloAlarmRings: undefined };
  const alarm = createAlarm({
    now: () => clock,
    notify: (payload) => { if (throwing) throw new Error('no toast'); notes.push(payload); return true; },
    send: (channel, payload) => { if (throwing) throw new Error('no window'); sent.push([channel, payload]); },
    setTimer: (fn, wait) => { const id = nextId++; timers.set(id, { fn, due: clock + wait, wait }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    ...testHooks(hooks),
  });
  // Moves the clock to `to`, firing timers as they come due (as a live event loop would).
  function runTo(to) {
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.due <= to).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      clock = Math.max(clock, timer.due);
      timer.fn();
    }
    clock = to;
  }
  return {
    alarm, notes, sent, hooks, timers, runTo,
    get now() { return clock; },
    set now(value) { clock = value; }, // a jump with no timers firing: the PC asleep
  };
}

const focus = (at, extra = {}) => ({ id: `kindle:focus:${T}`, at, title: 'The focus session is done', body: 'Rest for fifteen minutes.', ...extra });

test('the bell rings once at its time: a kindle note and milo:alarm with the id', () => {
  const r = rig();
  assert.equal(r.alarm.set(focus(T + 50 * MIN)), true);
  assert.deepEqual(r.alarm.current(), { id: `kindle:focus:${T}`, at: T + 50 * MIN });
  assert.equal(r.timers.size, 1);
  r.runTo(T + 50 * MIN - 1);
  assert.equal(r.notes.length, 0, 'not a moment early');
  r.runTo(T + 50 * MIN);
  assert.deepEqual(r.notes, [{ title: 'The focus session is done', body: 'Rest for fifteen minutes.', kind: 'kindle' }]);
  assert.deepEqual(r.sent, [['milo:alarm', { id: `kindle:focus:${T}` }]]);
  assert.equal(r.alarm.current(), null, 'the slot is empty after it rings');
  r.runTo(T + 200 * MIN);
  assert.equal(r.notes.length, 1, 'once');
  assert.equal(r.timers.size, 0);
});

test('one slot: a new alarm replaces the old one, which never rings', () => {
  const r = rig();
  r.alarm.set(focus(T + 50 * MIN));
  assert.equal(r.alarm.set({ id: `kindle:rest:${T}`, at: T + 65 * MIN, title: 'The rest is over', body: '' }), true);
  assert.equal(r.timers.size, 1, 'one timer, never two');
  assert.deepEqual(r.alarm.current(), { id: `kindle:rest:${T}`, at: T + 65 * MIN });
  r.runTo(T + 70 * MIN);
  assert.deepEqual(r.sent, [['milo:alarm', { id: `kindle:rest:${T}` }]]);
  assert.equal(r.notes.length, 1);
  // Setting the same id again moves it rather than adding one.
  r.alarm.set(focus(T + 80 * MIN));
  r.alarm.set(focus(T + 90 * MIN));
  assert.equal(r.timers.size, 1);
  r.runTo(T + 85 * MIN);
  assert.equal(r.notes.length, 1);
  r.runTo(T + 90 * MIN);
  assert.equal(r.notes.length, 2);
});

test('an alarm for a past time, or right now, clears the slot without ringing', () => {
  const r = rig();
  r.alarm.set(focus(T + 50 * MIN));
  assert.equal(r.alarm.set(focus(T - 1)), true, 'cleared counts as done');
  assert.equal(r.alarm.current(), null);
  assert.equal(r.timers.size, 0, 'the old timer is gone too');
  assert.equal(r.alarm.set(focus(T)), true);
  assert.equal(r.alarm.current(), null);
  r.runTo(T + 100 * MIN);
  assert.deepEqual([r.notes, r.sent], [[], []]);
});

test('null clears the slot', () => {
  const r = rig();
  r.alarm.set(focus(T + 50 * MIN));
  assert.equal(r.alarm.set(null), true);
  assert.equal(r.alarm.current(), null);
  assert.equal(r.alarm.set(null), true, 'clearing an empty slot is fine');
  r.runTo(T + 60 * MIN);
  assert.equal(r.notes.length, 0);
});

test('anything that isn’t an alarm is refused and leaves the slot as it was', () => {
  const r = rig();
  r.alarm.set(focus(T + 50 * MIN));
  const refused = [
    undefined, 'kindle', 42, [], [focus(T + 60 * MIN)], {},
    focus(NaN), focus(Infinity), focus(-5), focus(0), focus('1759140000000'), focus(T + MIN, { id: '' }),
    focus(T + MIN, { id: '../x' }), focus(T + MIN, { id: 'has space' }), focus(T + MIN, { id: 'x'.repeat(81) }), focus(T + MIN, { id: 7 }),
  ];
  for (const value of refused) assert.equal(r.alarm.set(value), false, JSON.stringify(value));
  assert.deepEqual(r.alarm.current(), { id: `kindle:focus:${T}`, at: T + 50 * MIN });
  assert.equal(cleanAlarm(null), null);
  assert.equal(cleanAlarm({ id: 'x' }), undefined);
});

test('titles and bodies are cleaned like any note: one line, 80 and 200 characters', () => {
  const r = rig();
  r.alarm.set(focus(T + MIN, { title: `  The focus\nsession   is done ${'x'.repeat(100)}`, body: 42 }));
  r.runTo(T + MIN);
  assert.equal(r.notes[0].title.length, 80);
  assert.ok(r.notes[0].title.startsWith('The focus session is done x'));
  assert.equal(r.notes[0].body, '42');
  assert.equal(cleanAlarm(focus(T, { body: 'y'.repeat(300) })).body.length, 200);
  assert.equal(cleanAlarm(focus(T, { title: undefined })).title, '');
});

test('a long wait goes in steps, and a timer that fires early waits the rest', () => {
  const r = rig();
  const far = T + 40 * 24 * 60 * MIN; // past setTimeout's 24.8-day limit
  r.alarm.set(focus(far));
  assert.equal([...r.timers.values()][0].wait, MAX_DELAY);
  r.runTo(T + MAX_DELAY);
  assert.equal(r.notes.length, 0);
  assert.equal(r.timers.size, 1, 'armed again for the rest');
  r.runTo(far);
  assert.equal(r.notes.length, 1);
  // A timer that fires before the clock reaches the time (a clock set back) doesn't ring early.
  const early = rig();
  early.alarm.set(focus(T + 10 * MIN));
  const [[id, timer]] = [...early.timers.entries()];
  early.timers.delete(id);
  early.now = T + 9 * MIN;
  timer.fn();
  assert.equal(early.notes.length, 0);
  assert.equal([...early.timers.values()][0].wait, MIN);
  early.runTo(T + 10 * MIN);
  assert.equal(early.notes.length, 1);
});

test('after a sleep, recheck rings a bell that came due, and one long past rings without its desktop note', () => {
  const r = rig();
  r.alarm.set(focus(T + 50 * MIN));
  r.now = T + 53 * MIN; // asleep across the bell: no timer ran
  r.alarm.recheck();
  assert.equal(r.notes.length, 1, 'three minutes late still rings');
  assert.equal(r.alarm.current(), null);
  assert.equal(r.timers.size, 0);
  r.alarm.recheck();
  assert.equal(r.notes.length, 1, 'recheck with an empty slot does nothing');

  const slept = rig();
  slept.alarm.set(focus(T + 50 * MIN));
  slept.now = T + 50 * MIN + LATE_MS + 1; // a night asleep
  slept.alarm.recheck();
  assert.deepEqual(slept.notes, [], 'no desktop note for last night’s bell');
  assert.deepEqual(slept.sent, [['milo:alarm', { id: `kindle:focus:${T}` }]], 'the renderer still hears it rang');
  assert.equal(slept.alarm.current(), null);
  assert.equal(slept.hooks.__miloAlarm, null);
  assert.deepEqual(slept.hooks.__miloAlarmRings, [{ id: `kindle:focus:${T}`, at: T + 50 * MIN, rang: T + 50 * MIN + LATE_MS + 1 }]);
  assert.equal(slept.timers.size, 0);

  const edge = rig();
  edge.alarm.set(focus(T + 50 * MIN));
  edge.now = T + 50 * MIN + LATE_MS; // exactly LATE_MS late: still in time for its note
  edge.alarm.recheck();
  assert.equal(edge.notes.length, 1);
  assert.equal(edge.sent.length, 1);

  const woke = rig();
  woke.alarm.set(focus(T + 50 * MIN));
  woke.now = T + 20 * MIN; // a short sleep before the bell
  woke.alarm.recheck();
  assert.equal(woke.timers.size, 1);
  assert.equal([...woke.timers.values()][0].wait, 30 * MIN, 're-armed from the wall clock');
  woke.runTo(T + 50 * MIN);
  assert.equal(woke.notes.length, 1);
});

test('under MILO_TEST, __miloAlarm follows the slot and __miloAlarmRings records each bell', () => {
  const r = rig();
  assert.equal(r.hooks.__miloAlarm, null, 'set up empty');
  assert.deepEqual(r.hooks.__miloAlarmRings, []);
  r.alarm.set(focus(T + 50 * MIN));
  assert.deepEqual(r.hooks.__miloAlarm, { id: `kindle:focus:${T}`, at: T + 50 * MIN });
  r.alarm.set(focus(T + 66 * MIN, { id: `kindle:rest:${T}` }));
  assert.deepEqual(r.hooks.__miloAlarm, { id: `kindle:rest:${T}`, at: T + 66 * MIN });
  r.runTo(T + 66 * MIN);
  assert.equal(r.hooks.__miloAlarm, null);
  assert.deepEqual(r.hooks.__miloAlarmRings, [{ id: `kindle:rest:${T}`, at: T + 66 * MIN, rang: T + 66 * MIN }]);
  r.alarm.set(focus(T + 70 * MIN));
  r.alarm.set(null);
  assert.equal(r.hooks.__miloAlarm, null);
  r.alarm.set(focus(T + 80 * MIN));
  r.alarm.set(focus(T + 1));
  assert.equal(r.hooks.__miloAlarm, null, 'a past time clears it');
  assert.equal(r.hooks.__miloAlarmRings.length, 1);
  const target = {};
  testHooks(target);
  assert.deepEqual(target, { __miloAlarm: null, __miloAlarmRings: [] });
});

test('a note or window that fails never throws out of the bell', () => {
  const r = rig({ throwing: true });
  r.alarm.set(focus(T + MIN));
  assert.doesNotThrow(() => r.runTo(T + MIN));
  assert.equal(r.alarm.current(), null);
  assert.equal(r.hooks.__miloAlarmRings.length, 1);
});

test('dispose clears the slot and its timer for good', () => {
  const r = rig();
  r.alarm.set(focus(T + MIN));
  r.alarm.dispose();
  assert.equal(r.timers.size, 0);
  assert.equal(r.alarm.current(), null);
  assert.equal(r.alarm.set(focus(T + 2 * MIN)), false, 'nothing arms after dispose');
  r.alarm.recheck();
  r.runTo(T + 10 * MIN);
  assert.equal(r.notes.length, 0);
  assert.throws(() => createAlarm({}), TypeError, 'a clock is required');
});

test('the default timers work: a real alarm rings on the event loop', async () => {
  const notes = [];
  const alarm = createAlarm({ now: Date.now, notify: (payload) => notes.push(payload), send: () => {} });
  alarm.set({ id: 'kindle:test', at: Date.now() + 20, title: 'The focus session is done', body: '' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(notes.length, 1);
  alarm.dispose();
});

// ---------------------------------------------------------------------------
// The bridge: preload (§10.4)

// electron/preload.cjs, loaded fresh with a stand-in `electron`: → { milo, invoked, emit, answer }.
// `invoked` records every ipcRenderer.invoke and send; `answer(fn)` changes what invoke resolves.
function loadPreload() {
  const Module = require('node:module');
  const preload = require.resolve('../electron/preload.cjs');
  const electronId = require.resolve('electron', { paths: [path.dirname(preload)] });
  const invoked = [];
  const listeners = new Map();
  const exposed = {};
  let reply = (channel) => (channel === 'milo:load-state' ? {} : true);
  const fake = {
    contextBridge: { exposeInMainWorld: (key, api) => { exposed[key] = api; } },
    ipcRenderer: {
      invoke: (channel, ...values) => {
        invoked.push([channel, ...values]);
        try {
          return Promise.resolve(reply(channel, ...values));
        } catch (error) {
          return Promise.reject(error);
        }
      },
      send: (channel, ...values) => { invoked.push([`send ${channel}`, ...values]); },
      on: (channel, listener) => { listeners.set(channel, [...(listeners.get(channel) || []), listener]); },
      removeListener: (channel, listener) => { listeners.set(channel, (listeners.get(channel) || []).filter((l) => l !== listener)); },
    },
  };
  const previous = require.cache[electronId];
  const stub = new Module(electronId);
  stub.filename = electronId;
  stub.loaded = true;
  stub.exports = fake;
  require.cache[electronId] = stub;
  delete require.cache[preload];
  try {
    require(preload);
  } finally {
    if (previous) require.cache[electronId] = previous;
    else delete require.cache[electronId];
    delete require.cache[preload];
  }
  return {
    milo: exposed.milo,
    invoked,
    emit: (channel, ...values) => { for (const listener of listeners.get(channel) || []) listener({}, ...values); },
    answer: (fn) => { reply = fn; },
  };
}

test('preload: window.milo has §10.4’s keys, and the notebooks say not-loaded until loadState has resolved', async () => {
  const { milo, invoked, answer } = loadPreload();
  assert.deepEqual(Object.keys(milo).sort(), [
    'alarm', 'architect', 'clock', 'commissions', 'content', 'finishClose', 'loadState', 'notebooks', 'notify', 'onBeforeClose', 'onSnapshot', 'saveState', 'scan', 'windowAction',
  ]);
  assert.deepEqual(Object.keys(milo.commissions).sort(), ['cancel', 'check', 'env', 'pickFolder', 'run']);
  assert.ok(Object.isFrozen(milo.commissions));
  assert.deepEqual(Object.keys(milo.notebooks).sort(), ['append', 'dropPrevious', 'read', 'replace', 'restore']);
  assert.deepEqual(Object.keys(milo.alarm).sort(), ['onRing', 'set']);
  for (const part of [milo, milo.notebooks, milo.alarm]) assert.ok(Object.isFrozen(part));
  const bytes = new Uint8Array([0x4e, 0x42, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
  const everyCall = () => [
    milo.notebooks.read('claude'),
    milo.notebooks.append('claude', bytes, 0),
    milo.notebooks.replace('claude', bytes, { keepPrevious: true }),
    milo.notebooks.restore('claude'),
    milo.notebooks.dropPrevious('claude'),
  ];
  const NOT_LOADED = { ok: false, code: 'not-loaded' };
  for (const result of await Promise.all(everyCall())) assert.deepEqual(result, NOT_LOADED);
  assert.deepEqual(invoked, [], 'nothing reached main');
  // A loadState that fails (main's loadError) opens nothing.
  answer((channel) => { if (channel === 'milo:load-state') throw new Error('MILO could not open its saved state'); return true; });
  await assert.rejects(milo.loadState());
  for (const result of await Promise.all(everyCall())) assert.deepEqual(result, NOT_LOADED);
  // Nor does one still on its way.
  answer((channel) => (channel === 'milo:load-state' ? {} : { ok: true, size: 0 }));
  const loading = milo.loadState();
  for (const result of await Promise.all(everyCall())) assert.deepEqual(result, NOT_LOADED, 'still waiting for loadState');
  await loading;
  invoked.length = 0;
  for (const result of await Promise.all(everyCall())) assert.deepEqual(result, { ok: true, size: 0 }, 'through to main once it has');
  assert.deepEqual(invoked.map(([channel]) => channel), [
    'milo:notebook-read', 'milo:notebook-append', 'milo:notebook-replace', 'milo:notebook-restore', 'milo:notebook-drop-previous',
  ]);
});

test('preload: notebook arguments are cleaned to their types before they cross', async () => {
  const { milo, invoked } = loadPreload();
  await milo.loadState();
  invoked.length = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  await milo.notebooks.read('claude');
  await milo.notebooks.read(42);
  await milo.notebooks.append('claude', bytes, 37);
  await milo.notebooks.append('jev', [1, 2, 3], 1.5);
  await milo.notebooks.append('jev', bytes.buffer, '3');
  await milo.notebooks.append('jev', new Uint16Array(2), -1);
  await milo.notebooks.append('jev', bytes, Number.MAX_SAFE_INTEGER + 1);
  await milo.notebooks.replace('claude', bytes, { keepPrevious: 'yes' });
  await milo.notebooks.replace('claude', bytes, { keepPrevious: true });
  await milo.notebooks.replace('claude', 'notes');
  await milo.notebooks.restore({ id: 'claude' });
  await milo.notebooks.dropPrevious('claude');
  assert.deepEqual(invoked, [
    ['milo:notebook-read', 'claude'],
    ['milo:notebook-read', ''],
    ['milo:notebook-append', 'claude', bytes, 37],
    ['milo:notebook-append', 'jev', null, -1],
    ['milo:notebook-append', 'jev', null, -1],
    ['milo:notebook-append', 'jev', null, -1],
    ['milo:notebook-append', 'jev', bytes, -1],
    ['milo:notebook-replace', 'claude', bytes, { keepPrevious: false }],
    ['milo:notebook-replace', 'claude', bytes, { keepPrevious: true }],
    ['milo:notebook-replace', 'claude', null, { keepPrevious: false }],
    ['milo:notebook-restore', ''],
    ['milo:notebook-drop-previous', 'claude'],
  ]);
});

test('preload: the alarm needs no loadState, cleans what it sends, and onRing passes only an { id }', async () => {
  const { milo, invoked, emit } = loadPreload();
  assert.equal(await milo.alarm.set(null), true);
  await milo.alarm.set({ id: 'kindle:focus:1', at: 5, title: 'The focus session is done', body: 'Rest.', extra: 1 });
  await milo.alarm.set({ id: 7, at: '5', title: null });
  await milo.alarm.set('soon');
  await milo.alarm.set(undefined);
  assert.deepEqual(invoked, [
    ['milo:alarm-set', null],
    ['milo:alarm-set', { id: 'kindle:focus:1', at: 5, title: 'The focus session is done', body: 'Rest.' }],
    ['milo:alarm-set', { id: '', at: NaN, title: '', body: '' }],
    ['milo:alarm-set', 'not an alarm'],
    ['milo:alarm-set', 'not an alarm'],
  ]);
  const heard = [];
  const stop = milo.alarm.onRing((payload) => heard.push(payload));
  emit('milo:alarm', { id: 'kindle:focus:1', extra: 'x' });
  emit('milo:alarm', { id: 5 });
  emit('milo:alarm', null);
  stop();
  emit('milo:alarm', { id: 'kindle:rest:1' });
  assert.deepEqual(heard, [{ id: 'kindle:focus:1' }], 'only a string id, and nothing after unsubscribing');
  assert.throws(() => milo.alarm.onRing('not a function'), TypeError);
  invoked.length = 0;
  await milo.notify({ title: 'The focus session is done', body: 'Rest.', kind: 'kindle' });
  await milo.notify({ title: 'Gate', kind: 'gate-bell' });
  await milo.notify({ title: 'Other', body: 4, kind: 'toast' });
  assert.equal(await milo.notify(null), false);
  assert.deepEqual(invoked, [
    ['milo:notify', { title: 'The focus session is done', body: 'Rest.', kind: 'kindle' }],
    ['milo:notify', { title: 'Gate', body: '', kind: 'gate-bell' }],
    ['milo:notify', { title: 'Other', body: '', kind: 'alert' }],
  ]);
});

// ---------------------------------------------------------------------------
// The bridge: main under MILO_TEST (§10.1, §10.3, §10.5)

// Runs in a child Node process (its source is written to a .cjs file there): loads main.cjs with a
// stand-in `electron`, drives its IPC handlers as the trusted page and as a stranger, and prints
// what it saw as one line of JSON. Nothing here runs in the test process itself.
function mainHarness(repo, scenario) {
  const Module = require('node:module');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const { realpathSync, existsSync } = require('node:fs');
  const { pathToFileURL } = require('node:url');
  const mainFile = path.join(repo, 'electron', 'main.cjs');
  const handlers = new Map();
  const listeners = new Map();
  const appEvents = new Map();
  const power = new Map();
  const windows = [];
  const sent = [];
  const order = [];
  const noop = () => {};
  let ready;
  const whenReady = new Promise((resolve) => { ready = resolve; });
  const pageURL = pathToFileURL(realpathSync.native(path.join(repo, 'index.html'))).href;
  class WebContents {
    constructor() { this.mainFrame = { url: pageURL }; }
    send(channel, payload) { sent.push({ channel, payload }); }
    isLoadingMainFrame() { return false; }
    isDestroyed() { return false; }
    isCrashed() { return false; }
    setWindowOpenHandler() {}
    on() {}
    once() {}
  }
  class BrowserWindow {
    constructor(options) { this.options = options; this.webContents = new WebContents(); windows.push(this); }
    isDestroyed() { return false; }
    isFocused() { return false; }
    isMinimized() { return false; }
    isMaximized() { return false; }
    on() {}
    once() {}
    show() {}
    focus() {}
    restore() {}
    minimize() {}
    maximize() {}
    unmaximize() {}
    loadFile() { return Promise.resolve(); }
  }
  const electron = {
    app: {
      commandLine: { appendSwitch: noop },
      setName: noop,
      setAppUserModelId: noop,
      setPath: noop,
      getPath: () => process.env.MILO_DATA_DIR,
      requestSingleInstanceLock: () => true,
      whenReady: () => whenReady,
      on: (name, fn) => { appEvents.set(name, fn); },
      quit: () => { order.push('quit'); },
    },
    BrowserWindow,
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); }, on: (channel, fn) => { listeners.set(channel, fn); } },
    Menu: { setApplicationMenu: noop },
    Notification: class { static isSupported() { return false; } },
    powerMonitor: { on: (name, fn) => { power.set(name, fn); } },
    session: { defaultSession: { setPermissionRequestHandler: noop, setPermissionCheckHandler: noop, webRequest: { onBeforeRequest: noop } } },
  };
  const electronId = require.resolve('electron', { paths: [path.dirname(mainFile)] });
  const stub = new Module(electronId);
  stub.filename = electronId;
  stub.loaded = true;
  stub.exports = electron;
  require.cache[electronId] = stub;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (check, what) => {
    for (let i = 0; i < 3000; i += 1) {
      if (check()) return;
      await wait(5);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const frame = (count, key) => {
    const body = Buffer.alloc(count * 24, key);
    const out = Buffer.alloc(13 + body.length);
    out.writeUInt16LE(0x424e, 0);
    out[2] = 1;
    out.writeUInt16LE(count, 3);
    out.writeUInt32LE(zlib.crc32(body) >>> 0, 5);
    out.writeUInt32LE(key, 9);
    body.copy(out, 13);
    return new Uint8Array(out);
  };
  const plain = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v instanceof Uint8Array ? { bytes: Array.from(v) } : v)));
  const out = { scenario };
  const finish = () => process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(0));

  (async () => {
    require(mainFile);
    out.atLoad = { alarm: globalThis.__miloAlarm, rings: Array.isArray(globalThis.__miloAlarmRings) ? [...globalThis.__miloAlarmRings] : globalThis.__miloAlarmRings };
    ready();
    await until(() => handlers.has('milo:notebook-drop-previous') && windows.length === 1, 'main to be ready');
    const win = windows[0];
    const trusted = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    const stranger = { sender: {}, senderFrame: { url: 'https://example.com/' } };
    const call = (channel, event, ...values) => handlers.get(channel)(event, ...values);
    const channels = ['read', 'append', 'replace', 'restore', 'drop-previous'];
    out.untrusted = {
      alarm: await call('milo:alarm-set', stranger, { id: 'kindle:focus:0', at: Date.now() + 60_000, title: 'x', body: '' }),
      slot: globalThis.__miloAlarm,
      notebooks: await Promise.all(channels.map((name) => call(`milo:notebook-${name}`, stranger, 'claude', frame(1, 1), 0))),
    };

    if (scenario === 'damaged') {
      const bytes = frame(1, 1);
      out.writes = [
        await call('milo:notebook-append', trusted, 'claude', bytes, 0),
        await call('milo:notebook-replace', trusted, 'claude', bytes, { keepPrevious: true }),
        await call('milo:notebook-restore', trusted, 'claude'),
        await call('milo:notebook-drop-previous', trusted, 'claude'),
      ];
      out.read = plain(await call('milo:notebook-read', trusted, 'claude'));
      out.folder = existsSync(path.join(process.env.MILO_DATA_DIR, 'notebooks'));
      finish();
      return;
    }

    // Kindle's bell through milo:alarm-set, as ui-phase4's check 2 reads it.
    const far = Date.now() + 60_000;
    out.far = far;
    out.armed = await call('milo:alarm-set', trusted, { id: 'kindle:focus:1', at: far, title: 'The focus session is done', body: 'Rest for fifteen minutes.' });
    out.slot = globalThis.__miloAlarm;
    out.cleared = await call('milo:alarm-set', trusted, null);
    out.slotAfterClear = globalThis.__miloAlarm;
    const soon = Date.now() + 150;
    out.soon = soon;
    out.armedSoon = await call('milo:alarm-set', trusted, { id: 'kindle:rest:1', at: soon, title: 'The focus session is done', body: 'Rest for fifteen minutes.' });
    out.slotSoon = globalThis.__miloAlarm;
    await until(() => globalThis.__miloAlarmRings.length === 1, 'the bell');
    out.rings = plain(globalThis.__miloAlarmRings);
    out.slotAfterRing = globalThis.__miloAlarm;
    out.sentAlarm = sent.filter((m) => m.channel === 'milo:alarm');
    out.kindleNotes = globalThis.__miloNotifications.filter((n) => n.kind === 'kindle').map(({ title, body, kind }) => ({ title, body, kind }));
    out.past = await call('milo:alarm-set', trusted, { id: 'kindle:rest:2', at: Date.now() - 1000, title: '', body: '' });
    out.junk = await call('milo:alarm-set', trusted, 'soon');
    out.ringsAfterPast = globalThis.__miloAlarmRings.length;

    // Notify kinds, and the Kindle bell's own switch once its save lands.
    let seen = globalThis.__miloNotifications.length;
    out.notify = [
      await call('milo:notify', trusted, { title: 'Kindle', body: '', kind: 'kindle' }),
      await call('milo:notify', trusted, { title: 'Other', body: '', kind: 'toast' }),
      await call('milo:notify', stranger, { title: 'Stranger', body: '', kind: 'alert' }),
    ];
    out.notifyKinds = globalThis.__miloNotifications.slice(seen).map((n) => n.kind);
    const state = await call('milo:load-state', trusted);
    state.settings.kindleBell = false;
    out.saved = await call('milo:save-state', trusted, state);
    seen = globalThis.__miloNotifications.length;
    out.quietNotify = [
      await call('milo:notify', trusted, { title: 'Kindle', body: '', kind: 'kindle' }),
      await call('milo:notify', trusted, { title: 'Alert', body: '', kind: 'alert' }),
    ];
    await call('milo:alarm-set', trusted, { id: 'kindle:focus:2', at: Date.now() + 100, title: 'The focus session is done', body: '' });
    await until(() => globalThis.__miloAlarmRings.length === 2, 'the quiet bell');
    out.quietKinds = globalThis.__miloNotifications.slice(seen).map((n) => n.kind);
    out.quietSent = sent.filter((m) => m.channel === 'milo:alarm').map((m) => m.payload.id);

    // powerMonitor's resume. A bell that isn't due yet stays armed. One whose time passed while
    // nothing could run (the PC asleep; here, a busy-wait that no timer can interrupt) rings from
    // the resume handler itself, in the same synchronous turn, before its own timer gets a chance.
    const resume = power.get('resume');
    out.resumeHandler = typeof resume;
    await call('milo:alarm-set', trusted, { id: 'kindle:focus:later', at: Date.now() + 60_000, title: 'The focus session is done', body: '' });
    let rings = globalThis.__miloAlarmRings.length;
    resume();
    out.resumeEarly = { rang: globalThis.__miloAlarmRings.length - rings, slot: globalThis.__miloAlarm };
    const asleep = Date.now() + 100;
    out.asleep = asleep;
    await call('milo:alarm-set', trusted, { id: 'kindle:rest:asleep', at: asleep, title: 'The rest is over', body: '' });
    rings = globalThis.__miloAlarmRings.length;
    const sentBefore = sent.length;
    while (Date.now() < asleep + 20) { /* asleep: no timer can fire during a synchronous wait */ }
    out.ringsWhileAsleep = globalThis.__miloAlarmRings.length - rings;
    resume();
    out.ringsOnResume = globalThis.__miloAlarmRings.slice(rings).map(({ id, at }) => ({ id, at }));
    out.sentOnResume = sent.slice(sentBefore).filter((m) => m.channel === 'milo:alarm').map((m) => m.payload.id);
    out.slotAfterResume = globalThis.__miloAlarm;
    await wait(250);
    out.ringsAfterTimers = globalThis.__miloAlarmRings.length - rings;

    // The notebook channels, through to the files in MILO_DATA_DIR/notebooks.
    const one = frame(2, 1);
    out.one = Array.from(one);
    out.nb = {
      append: await call('milo:notebook-append', trusted, 'claude', one, 0),
      read: plain(await call('milo:notebook-read', trusted, 'claude')),
      moved: await call('milo:notebook-append', trusted, 'claude', one, 0),
      badId: await call('milo:notebook-read', trusted, '../claude'),
      notTrue: await call('milo:notebook-replace', trusted, 'claude', new Uint8Array(0), { keepPrevious: 'yes' }),
      noPrevious: await call('milo:notebook-restore', trusted, 'claude'),
      again: await call('milo:notebook-append', trusted, 'claude', one, 0),
      reset: await call('milo:notebook-replace', trusted, 'claude', new Uint8Array(0), { keepPrevious: true }),
      restore: await call('milo:notebook-restore', trusted, 'claude'),
      restored: plain(await call('milo:notebook-read', trusted, 'claude')),
      restoreAgain: await call('milo:notebook-restore', trusted, 'claude'),
      stillRestored: plain(await call('milo:notebook-read', trusted, 'claude')),
      drop: await call('milo:notebook-drop-previous', trusted, 'claude'),
      file: existsSync(path.join(process.env.MILO_DATA_DIR, 'notebooks', 'claude.notes')),
    };

    // before-quit: the renderer's close, then the state and notebook queues drain, then quit. The
    // append comes in the middle of the handshake, as L2's onBeforeClose sends it (§10.2): after
    // milo:before-close has gone out, before milo:finish-close. The awaits between are microtasks
    // only (the handler reaches the store's queue; no file work can finish), so finish-close
    // arrives while the append is still on its way to the disk, and main must wait for it.
    appEvents.get('before-quit')({ preventDefault: noop });
    out.askedToClose = sent.some((m) => m.channel === 'milo:before-close');
    const last = frame(1, 7);
    const pending = call('milo:notebook-append', trusted, 'jev', last, 0);
    pending.then(() => { order.push('append'); });
    for (let i = 0; i < 20; i += 1) await null;
    out.orderAtFinish = order.slice();
    listeners.get('milo:finish-close')(trusted);
    await until(() => order.includes('quit'), 'quit');
    out.order = order.slice();
    out.jev = await pending;
    out.afterQuit = await call('milo:alarm-set', trusted, { id: 'kindle:focus:3', at: Date.now() + 60_000, title: '', body: '' });
    finish();
  })().catch((error) => {
    out.error = String((error && error.stack) || error);
    finish();
  });
}

const execFileAsync = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, options, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
});

// Runs mainHarness in its own Node process with its own data folder and empty crew homes.
async function runMain(t, scenario) {
  const root = await mkdtemp(path.join(tmpdir(), 'milo-main-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(['data', 'claude-home', 'codex-home', 'projects', 'local'].map((name) => [name, path.join(root, name)]));
  for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
  if (scenario === 'damaged') {
    await writeFile(path.join(dirs.data, 'state.json'), '{ not json');
    await writeFile(path.join(dirs.data, 'state.json.backup'), '[]');
  }
  const script = path.join(root, 'main-harness.cjs');
  await writeFile(script, `'use strict';\n(${mainHarness.toString()})(process.argv[2], process.argv[3]);\n`);
  const env = {
    ...process.env,
    MILO_TEST: '1',
    MILO_DATA_DIR: dirs.data,
    MILO_CLAUDE_HOME: dirs['claude-home'],
    MILO_CODEX_HOME: dirs['codex-home'],
    MILO_PROJECTS_DIR: dirs.projects,
    MILO_ARCHITECT: 'fake',
    LOCALAPPDATA: dirs.local,
  };
  delete env.MILO_NOW;
  delete env.ELECTRON_RUN_AS_NODE;
  let run;
  try {
    run = await execFileAsync(process.execPath, [script, REPO, scenario], { env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    assert.fail(`main's harness failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
  }
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(out.error, undefined, `${out.error}\n${run.stderr}`);
  return { out, stderr: run.stderr, data: dirs.data };
}

test('main under MILO_TEST: __miloAlarm follows milo:alarm-set, the bell rings into __miloAlarmRings, and the notebooks go through', async (t) => {
  const { out, data } = await runMain(t, 'fresh');
  // The hooks are there from the moment main loads (testHooks under IS_TEST).
  assert.deepEqual(out.atLoad, { alarm: null, rings: [] });
  // A stranger is refused everything, and changes nothing.
  assert.equal(out.untrusted.alarm, false);
  assert.equal(out.untrusted.slot, null);
  for (const result of out.untrusted.notebooks) assert.deepEqual(result, { ok: false, code: 'untrusted' });
  // The slot, as ui-phase4's check 2 reads it.
  assert.equal(out.armed, true);
  assert.deepEqual(out.slot, { id: 'kindle:focus:1', at: out.far });
  assert.equal(out.cleared, true);
  assert.equal(out.slotAfterClear, null);
  assert.equal(out.armedSoon, true);
  assert.deepEqual(out.slotSoon, { id: 'kindle:rest:1', at: out.soon });
  // The ring: one entry, the slot emptied, milo:alarm to the page, and a kindle note.
  assert.equal(out.rings.length, 1);
  assert.equal(out.rings[0].id, 'kindle:rest:1');
  assert.equal(out.rings[0].at, out.soon);
  assert.ok(out.rings[0].rang >= out.soon, 'never early');
  assert.equal(out.slotAfterRing, null);
  assert.deepEqual(out.sentAlarm, [{ channel: 'milo:alarm', payload: { id: 'kindle:rest:1' } }]);
  assert.deepEqual(out.kindleNotes, [{ title: 'The focus session is done', body: 'Rest for fifteen minutes.', kind: 'kindle' }]);
  assert.equal(out.past, true, 'a past time clears the slot');
  assert.equal(out.junk, false);
  assert.equal(out.ringsAfterPast, 1, 'and never rings');
  // Notify kinds: kindle stays kindle, anything else is an alert, a stranger gets nothing.
  assert.deepEqual(out.notify, [true, true, false]);
  assert.deepEqual(out.notifyKinds, ['kindle', 'alert']);
  // settings.kindleBell off: no kindle note (the bell still reaches the page), alerts unchanged.
  assert.deepEqual(out.saved, { ok: true });
  assert.deepEqual(out.quietNotify, [false, true]);
  assert.deepEqual(out.quietKinds, ['alert']);
  assert.deepEqual(out.quietSent, ['kindle:rest:1', 'kindle:focus:2']);
  // powerMonitor's resume rechecks the alarm: a bell not yet due stays armed; one that came due
  // while nothing could run rings from the resume handler at once, once, before its timer.
  assert.equal(out.resumeHandler, 'function');
  assert.equal(out.resumeEarly.rang, 0, 'nothing rings early on resume');
  assert.equal(out.resumeEarly.slot.id, 'kindle:focus:later');
  assert.equal(out.ringsWhileAsleep, 0, 'no timer fired while asleep');
  assert.deepEqual(out.ringsOnResume, [{ id: 'kindle:rest:asleep', at: out.asleep }], 'the resume handler rang it in the same turn');
  assert.deepEqual(out.sentOnResume, ['kindle:rest:asleep'], 'and told the page');
  assert.equal(out.slotAfterResume, null);
  assert.equal(out.ringsAfterTimers, 1, 'its timer never rings it again');
  // The notebook channels reach the store in MILO_DATA_DIR/notebooks.
  const size = out.one.length;
  assert.deepEqual(out.nb.append, { ok: true, size });
  assert.deepEqual(out.nb.read, { ok: true, bytes: { bytes: out.one }, size });
  assert.deepEqual(out.nb.moved, { ok: false, code: 'moved', size });
  assert.deepEqual(out.nb.badId, { ok: false, code: 'bad-id' });
  assert.deepEqual(out.nb.notTrue, { ok: true, size: 0 });
  assert.deepEqual(out.nb.noPrevious, { ok: false, code: 'none' }, 'only keepPrevious: true keeps one');
  assert.deepEqual(out.nb.again, { ok: true, size });
  assert.deepEqual(out.nb.reset, { ok: true, size: 0 });
  assert.deepEqual(out.nb.restore, { ok: true, size });
  assert.deepEqual(out.nb.restored, { ok: true, bytes: { bytes: out.one }, size });
  assert.deepEqual(out.nb.restoreAgain, { ok: false, code: 'none' }, 'a repeated restore never brings the reset’s page back');
  assert.deepEqual(out.nb.stillRestored, out.nb.restored);
  assert.deepEqual(out.nb.drop, { ok: true });
  assert.equal(out.nb.file, true);
  // before-quit waits for the notebook append the renderer sends during the close handshake, then
  // quits and puts the bell away.
  assert.equal(out.askedToClose, true, 'milo:before-close went out before the append was sent');
  assert.deepEqual(out.orderAtFinish, [], 'the append was still on its way when finish-close came');
  assert.deepEqual(out.order, ['append', 'quit'], 'the append was done before MILO quit');
  assert.deepEqual(out.jev, { ok: true, size: 37 });
  assert.equal(out.afterQuit, false, 'the alarm is disposed');
  assert.equal((await readFile(path.join(data, 'notebooks', 'jev.notes'))).length, 37);
});

test('main with a damaged save: every notebook write is blocked, reads still work, and nothing is made', async (t) => {
  const { out, stderr, data } = await runMain(t, 'damaged');
  assert.deepEqual(out.atLoad, { alarm: null, rings: [] });
  for (const result of out.untrusted.notebooks) assert.deepEqual(result, { ok: false, code: 'untrusted' });
  for (const result of out.writes) assert.deepEqual(result, { ok: false, code: 'blocked' });
  assert.deepEqual(out.read, { ok: true, bytes: { bytes: [] }, size: 0 });
  assert.equal(out.folder, false, 'no notebooks folder');
  assert.match(stderr, /Could not read state\.json/);
  assert.equal(await readFile(path.join(data, 'state.json'), 'utf8'), '{ not json', 'the damaged save is left as it was');
});

// ---------------------------------------------------------------------------
// main's fallbackModel (§10.5): the stand-in that lets the window open when src/model.js can't
// load. Main can't be imported outside Electron, so its fallbackModel block is evaluated from
// main.cjs's own source, as it stands.

function loadFallbackModel() {
  const source = readFileSync(path.join(REPO, 'electron', 'main.cjs'), 'utf8');
  const start = source.indexOf('const record = value =>');
  const end = source.indexOf('// Same rule as src/model.js looksLikeSavedState');
  assert.ok(start > 0 && end > start, 'main.cjs still has its fallbackModel block between these two lines');
  return new Function(`${source.slice(start, end)}\nreturn fallbackModel;`)();
}

// The sections normalizeState merges over their empty values, in createState's order (§8.1):
// Phase 3's, then Phase 4's up to `party`. `expedition` is left out on purpose.
const MERGED = ['user', 'milo', 'settings', 'tally', 'hearth', 'satchel', 'wilds', 'rifts', 'story', 'embers', 'xp', 'kindle', 'chronicle', 'road', 'party'];

test('main’s fallback model has model.createState’s shape, with Phase 4’s sections and the Kindle bell on', async () => {
  const fallback = loadFallbackModel();
  const model = await import('../src/model.js');
  const at = T;
  const ours = fallback.createState(at);
  const theirs = model.createState(at);
  assert.deepEqual(Object.keys(ours), Object.keys(theirs), 'the same sections in the same order');
  for (const key of ['embers', 'xp', 'kindle', 'chronicle', 'road', 'party', 'expedition']) assert.ok(Object.hasOwn(ours, key), key);
  // Plots are the one difference, as before Phase 4: the stand-in doesn't know the plot ids.
  const { plots: _ours, ...shape } = structuredClone(ours);
  const { plots: _theirs, ...expected } = structuredClone(theirs);
  assert.deepEqual(shape, expected, 'deep-equal to model.createState apart from plots');
  assert.equal(ours.settings.kindleBell, true, 'the Kindle bell is on by default');
  assert.equal(ours.settings.hud, 'adventure');
  assert.equal(ours.expedition, null);
  // A save made through the stand-in loses nothing the model wrote.
  assert.deepEqual(fallback.normalizeState(structuredClone(theirs), at), theirs);
});

test('main’s fallback normalizeState merges every section but the expedition, which stays null or a record', () => {
  const fallback = loadFallbackModel();
  const base = fallback.createState(T);
  for (const key of MERGED) {
    const merged = fallback.normalizeState({ [key]: { extra: 1 } }, T);
    assert.deepEqual(merged[key], { ...base[key], extra: 1 }, `${key} is merged over its empty value`);
    assert.deepEqual(fallback.normalizeState({ [key]: null }, T)[key], base[key], `${key}: null gives its empty value`);
    assert.deepEqual(fallback.normalizeState({ [key]: ['junk'] }, T)[key], base[key], `${key}: an array gives its empty value`);
  }
  const state = fallback.createState(T);
  assert.equal(fallback.normalizeState({ ...state, expedition: null }, T).expedition, null, 'a null expedition stays null, never {}');
  assert.equal(fallback.normalizeState({ ...state, expedition: undefined }, T).expedition, null);
  assert.equal(fallback.normalizeState({ ...state, expedition: ['junk'] }, T).expedition, null);
  assert.equal(fallback.normalizeState({ ...state, expedition: 'junk' }, T).expedition, null);
  const expedition = { runId: 'r1', battle: null };
  assert.deepEqual(fallback.normalizeState({ ...state, expedition }, T).expedition, expedition, 'a record is copied as saved');
  assert.deepEqual(fallback.normalizeState({ ...state, expedition: {} }, T).expedition, {}, 'with nothing added to it');
  assert.equal(fallback.normalizeState(null, T).expedition, null);
});
