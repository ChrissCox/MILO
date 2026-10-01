// Kindle and Banked Coals: the 50/15 focus timer (CONTRACT-PHASE4.md §4.23, §7.6; LORE.md §11).
// Pure: every time is absolute and comes in as `now`, so a relaunch lands in the right phase and
// kindleTick pays each finished session and honoured rest once, however often it runs.
//
// A focus session's end starts the rest at once. A rest that runs its full 15 minutes without a
// new focus starting is honoured. Banked Coals on its own rests but pays nothing, and stopping a
// focus early pays nothing and ends the cycle.
import { isRecord, cleanCount } from './clean.js';
import { emptyKindle } from './state4.js';
import { earn, economyOf } from './embers.js';
import { addXp, ratesOf } from './lifeskills.js';
import { note } from './chronicle.js';

export const FOCUS_MS = 50 * 60 * 1000;
export const REST_MS = 15 * 60 * 1000;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const kindleOf = (state) => {
  const k = isRecord(state.kindle) ? state.kindle : emptyKindle();
  return { ...k, paid: isRecord(k.paid) ? k.paid : { focus: null, rest: null } };
};
const pad = (n) => String(n).padStart(2, '0');
/** '09:10' on the local clock. */
export const clockWords = (ms) => {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const span = (from, to) => `${clockWords(from)}–${clockWords(to)}`;
const focusing = (k) => k.phase === 'focus' && finite(k.startedAt) && finite(k.focusEndsAt);
const resting = (k) => k.phase === 'rest' && finite(k.restStartedAt) && finite(k.restEndsAt);
const bump = (state, name) => {
  const tally = isRecord(state.tally) ? state.tally : {};
  return { ...state, tally: { ...tally, [name]: cleanCount(tally[name]) + 1 } };
};

/**
 * Moves the timer on to `now` and pays what finished: a focus session 10 Embers and 1,000 Focus
 * (key `focus:<startedAt>`), an honoured rest 5 Embers and 400 Hearthkeeping (key
 * `rest:<restStartedAt>`), each once, from the times they ended. Safe to call any number of times.
 * → { state, events: KindleEvent[] } (the same state and no events when nothing moved)
 */
export function kindleTick(state, now, { economy = null, xp = null } = {}) {
  if (!isRecord(state) || !finite(now)) return { state, events: [] };
  let k = kindleOf(state);
  let next = state;
  const events = [];
  const earnRates = economyOf(economy).earn;
  const xpRates = ratesOf(xp);
  if (focusing(k) && now >= k.focusEndsAt) {
    const id = `focus:${k.startedAt}`;
    const at = k.focusEndsAt;
    events.push({ t: 'focus-done', id, at });
    if (k.paid.focus !== k.startedAt) {
      const paid = earn(next, { source: 'focus', key: id, n: earnRates.focus?.n || 0, text: `Focus session ${span(k.startedAt, at)}` }, at, economy);
      next = paid.state;
      if (paid.entry) {
        const rate = xpRates['focus-session'];
        next = addXp(next, rate.skill, rate.xp, at, { source: 'focus-session', text: `focus session ${span(k.startedAt, at)}` }).state;
        next = note(bump(next, 'focusSessions'), at, { focus: 1 });
      }
    }
    k = { ...k, phase: 'rest', restStartedAt: at, restEndsAt: at + REST_MS, earned: true, paid: { ...k.paid, focus: k.startedAt } };
    events.push({ t: 'rest-started', id: `rest:${at}`, at });
  }
  if (resting(k) && now >= k.restEndsAt) {
    const id = `rest:${k.restStartedAt}`;
    const at = k.restEndsAt;
    events.push({ t: 'rest-done', id, at });
    if (k.earned && k.paid.rest !== k.restStartedAt) {
      const paid = earn(next, { source: 'rest', key: id, n: earnRates.rest?.n || 0, text: `Rest honoured ${span(k.restStartedAt, at)}` }, at, economy);
      next = paid.state;
      if (paid.entry) {
        const rate = xpRates['rest-honoured'];
        next = addXp(next, rate.skill, rate.xp, at, { source: 'rest-honoured', text: `honoured rest ${span(k.restStartedAt, at)}` }).state;
        next = note(bump(next, 'restsHonoured'), at, { rests: 1 });
      }
      k = { ...k, paid: { ...k.paid, rest: k.restStartedAt } };
    }
    k = { ...k, phase: 'idle', earned: false };
  }
  if (!events.length) return { state, events };
  return { state: { ...next, kindle: k }, events };
}

/**
 * Kindles the lantern: a 50-minute focus session from `now`. Starting during a rest breaks it (a
 * broken rest pays nothing); while a session is already running, nothing changes. Whatever had
 * already finished is paid first (kindleTick). → { state, events }
 */
export function kindleStart(state, now, options = {}) {
  if (!isRecord(state) || !finite(now)) return { state, events: [] };
  const ticked = kindleTick(state, now, options);
  const events = [...ticked.events];
  const k = kindleOf(ticked.state);
  if (focusing(k)) return { state: ticked.state, events };
  const at = Math.round(now);
  if (resting(k)) events.push({ t: 'rest-broken', id: `rest:${k.restStartedAt}`, at });
  events.push({ t: 'focus-started', id: `focus:${at}`, at });
  const kindle = { ...k, phase: 'focus', startedAt: at, focusEndsAt: at + FOCUS_MS, restStartedAt: null, restEndsAt: null, earned: false };
  return { state: { ...ticked.state, kindle }, events };
}

/**
 * Banked Coals: a 15-minute rest from `now` that pays nothing (only the rest after a finished
 * focus session is honoured). A focus session running now stops first, unpaid. While a rest is
 * already on, nothing changes. → { state, events }
 */
export function bankedCoals(state, now, options = {}) {
  if (!isRecord(state) || !finite(now)) return { state, events: [] };
  const ticked = kindleTick(state, now, options);
  const events = [...ticked.events];
  const k = kindleOf(ticked.state);
  if (resting(k)) return { state: ticked.state, events };
  const at = Math.round(now);
  if (focusing(k)) events.push({ t: 'stopped', id: `focus:${k.startedAt}`, at });
  events.push({ t: 'rest-started', id: `rest:${at}`, at });
  const kindle = { ...k, phase: 'rest', restStartedAt: at, restEndsAt: at + REST_MS, earned: false };
  return { state: { ...ticked.state, kindle }, events };
}

/** Puts the lantern out: a focus session or rest ends now, unpaid (what had finished is paid first). */
export function kindleStop(state, now, options = {}) {
  if (!isRecord(state) || !finite(now)) return { state, events: [] };
  const ticked = kindleTick(state, now, options);
  const events = [...ticked.events];
  const k = kindleOf(ticked.state);
  if (!focusing(k) && !resting(k)) return { state: ticked.state, events };
  events.push({ t: 'stopped', id: focusing(k) ? `focus:${k.startedAt}` : `rest:${k.restStartedAt}`, at: Math.round(now) });
  return { state: { ...ticked.state, kindle: { ...k, phase: 'idle', earned: false } }, events };
}

/** The phase the clock says, without paying anything: { phase, endsAt }. */
function phaseAt(k, now) {
  if (focusing(k)) {
    if (now < k.focusEndsAt) return { phase: 'focus', endsAt: k.focusEndsAt };
    if (now < k.focusEndsAt + REST_MS) return { phase: 'rest', endsAt: k.focusEndsAt + REST_MS };
    return { phase: 'idle', endsAt: null };
  }
  if (resting(k) && now < k.restEndsAt) return { phase: 'rest', endsAt: k.restEndsAt };
  return { phase: 'idle', endsAt: null };
}

const minutesLeft = (ms) => {
  const minutes = Math.ceil(ms / 60000);
  if (ms < 60000) return 'under a minute left';
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
};

/** The timer for the orb and the title bar: { phase, endsAt, left (ms), words }. */
export function kindleView(state, now) {
  const k = isRecord(state) ? kindleOf(state) : emptyKindle();
  const t = finite(now) ? now : 0;
  const { phase, endsAt } = phaseAt(k, t);
  const left = endsAt === null ? 0 : Math.max(0, endsAt - t);
  const words = phase === 'focus' ? `Focus: ${minutesLeft(left)}.`
    : phase === 'rest' ? `Resting: ${minutesLeft(left)}.`
      : 'The lantern’s ready when you are.';
  return { phase, endsAt, left, words };
}

/**
 * The bell main should ring next (one slot, §10.3): the focus session's end, or the rest's.
 * → null | { id, at, title, body }
 */
export function nextAlarm(state) {
  const k = isRecord(state) ? kindleOf(state) : emptyKindle();
  if (focusing(k)) return { id: `focus:${k.startedAt}`, at: k.focusEndsAt, title: 'The focus session is done', body: 'Rest for fifteen minutes.' };
  if (resting(k)) return { id: `rest:${k.restStartedAt}`, at: k.restEndsAt, title: 'The rest is over', body: 'Kindle the lantern again when you’re ready.' };
  return null;
}
