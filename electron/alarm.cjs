'use strict';

// Kindle's bell (CONTRACT-PHASE4.md §10.3): one alarm slot kept in the main process, so the bell
// rings on time even while MILO is covered or minimised and the renderer's timers are throttled.
// The alarm is only a bell: the renderer pays and ends Kindle's phases itself, from absolute times,
// and re-arms the slot at boot and after every Kindle change from kindle.nextAlarm(state).
//
//   const alarm = createAlarm({ now, notify, send });
//   alarm.set({ id: 'kindle:focus:…', at, title: 'The focus session is done', body: 'Rest for fifteen minutes.' });
//   // at `at`: notify({ title, body, kind: 'kindle' }) and send('milo:alarm', { id })
//
// - set(alarm) arms the one slot, replacing whatever was there; an `at` at or before now() clears
//   it without ringing; null clears it. → true when armed or cleared, false for anything else.
// - recheck() (powerMonitor's resume) re-arms from the wall clock, and rings an alarm that came due
//   while the PC slept. A bell more than LATE_MS past its time still sends milo:alarm (and shows in
//   __miloAlarmRings), but without the desktop note: waking the PC in the morning doesn't pop up
//   "The focus session is done" for last night's session.
// - The slot rings once, then it's empty. dispose() clears it for good.
// Pure apart from the timer calls it's given; `now` is the MILO clock (the test clock under MILO_NOW).

// setTimeout's longest wait; a later alarm waits in steps.
const MAX_DELAY = 2 ** 31 - 1;
// How late a bell may still show its desktop note (a sleep across its time, a busy moment). A later
// one rings without it.
const LATE_MS = 10 * 60 * 1000;
const ALARM_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/;

const cleanText = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

/**
 * The alarm IPC hands in, cleaned: null (clear it), { id, at, title, body }, or undefined when it
 * isn't an alarm (a bad id or time, or not an object).
 */
function cleanAlarm(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { id, at } = value;
  if (typeof id !== 'string' || !ALARM_ID.test(id)) return undefined;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return undefined;
  return { id, at, title: cleanText(value.title, 80), body: cleanText(value.body, 200) };
}

/**
 * createAlarm({ now, notify, send, setTimer, clearTimer, onChange, onRing })
 *   → { set(alarm | null) → boolean, recheck() → void, dispose() → void, current() → { id, at } | null }
 * onChange(slot) hears every change to the slot ({ id, at } or null); onRing({ id, at, rang }) each
 * bell that rings. Main passes testHooks(globalThis) for them under MILO_TEST.
 */
function createAlarm({ now, notify, send, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {}, onRing = () => {} } = {}) {
  if (typeof now !== 'function') throw new TypeError('The alarm needs a clock.');
  let slot = null;
  let timer = null;
  let disposed = false;

  const view = () => (slot ? { id: slot.id, at: slot.at } : null);
  const quietly = work => {
    try { work(); } catch { /* a bell never throws into main */ }
  };

  function stop() {
    if (timer === null) return;
    const handle = timer;
    timer = null;
    quietly(() => clearTimer(handle));
  }

  function arm() {
    stop();
    if (!slot || disposed) return;
    const wait = Math.max(0, Math.min(slot.at - now(), MAX_DELAY));
    timer = setTimer(due, wait);
    quietly(() => { if (timer && typeof timer.unref === 'function') timer.unref(); });
  }

  function ring() {
    const rung = slot;
    stop();
    slot = null;
    quietly(() => onChange(null));
    const rang = now();
    if (rang - rung.at <= LATE_MS) quietly(() => notify({ title: rung.title, body: rung.body, kind: 'kindle' }));
    quietly(() => send('milo:alarm', { id: rung.id }));
    quietly(() => onRing({ id: rung.id, at: rung.at, rang }));
  }

  // The timer fired: ring if the time has come, else wait the rest (a long alarm waits in steps).
  function due() {
    timer = null;
    if (!slot || disposed) return;
    if (now() < slot.at) arm();
    else ring();
  }

  return {
    set(value) {
      if (disposed) return false;
      const alarm = cleanAlarm(value);
      if (alarm === undefined) return false;
      if (alarm === null || alarm.at <= now()) {
        const had = slot !== null;
        stop();
        slot = null;
        if (had) quietly(() => onChange(null));
        return true;
      }
      slot = alarm;
      arm();
      quietly(() => onChange(view()));
      return true;
    },
    recheck() {
      if (disposed || !slot) return;
      if (now() >= slot.at) ring();
      else arm();
    },
    dispose() {
      disposed = true;
      stop();
      slot = null;
    },
    current: view,
  };
}

/**
 * The test hooks main keeps under MILO_TEST: target.__miloAlarm is the slot ({ id, at } or null),
 * and target.__miloAlarmRings gets { id, at, rang } for each bell. → { onChange, onRing } for createAlarm.
 */
function testHooks(target = globalThis) {
  target.__miloAlarm = null;
  target.__miloAlarmRings = [];
  return {
    onChange: slot => { target.__miloAlarm = slot; },
    onRing: rung => { target.__miloAlarmRings.push(rung); },
  };
}

module.exports = { createAlarm, cleanAlarm, testHooks, LATE_MS, MAX_DELAY };
