// Kindle and Banked Coals in the shell (CONTRACT-PHASE4.md §4.23, §7.6, §12.4 K1; PLAN.md §4): the
// `kindle` panel, the title-bar orb (#kindle-orb) with its countdown, the title-bar status line,
// html[data-focus], the bubbles at a phase's end and Kindle's bell in main (shell.bridge.alarm).
// The timer itself is src/kindle.js; everything here reads it or calls it.
//
// The panel shows end times, never a countdown, so its HTML only changes when the phase does
// (passive refreshes compare strings); the per-second countdown lives in the orb, outside #panel,
// and is updated in place.
import { kindleStart, bankedCoals, kindleStop, kindleTick, kindleView, nextAlarm, clockWords } from '../kindle.js';
import { dayView } from '../chronicle.js';
import { walletView, economyOf } from '../embers.js';
import { ratesOf, commas } from '../lifeskills.js';
import { esc } from './panels.js';

export const id = 'kindle';
export const PANEL = 'kindle';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The countdown as the orb shows it: '42:10', '0:05'. */
export function clockText(ms) {
  const total = Math.max(0, Math.ceil((finite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const minutesWords = (ms) => {
  if (!finite(ms) || ms < 60000) return 'under a minute left';
  const m = Math.ceil(ms / 60000);
  return `${m} ${m === 1 ? 'minute' : 'minutes'} left`;
};

const kindleOf = (state) => (isRecord(state) && isRecord(state.kindle) ? state.kindle : {});

/** Whether the rest now running follows a finished focus session (so it pays when it runs its course). */
function restEarned(state, view) {
  const k = kindleOf(state);
  if (view.phase !== 'rest') return false;
  return k.earned === true || k.phase === 'focus';
}

/** Which phase is running, as one key: 'idle', or 'focus@<ends>' / 'rest@<ends>'. A confirm is for one key only. */
function phaseKey(state, now) {
  const view = kindleView(state, now);
  return view.phase === 'idle' ? 'idle' : `${view.phase}@${view.endsAt}`;
}

/** What a step lost, from the phase before it: 'focus' (a session stopped early), 'rest' (an honoured rest cut short) or null. */
function lostBy(state, events, now) {
  const stopped = events.find((e) => isRecord(e) && e.t === 'stopped');
  if (stopped && /^focus:/.test(String(stopped.id))) return 'focus';
  const brokeRest = Boolean(stopped) || events.some((e) => isRecord(e) && e.t === 'rest-broken');
  return brokeRest && restEarned(state, kindleView(state, now)) ? 'rest' : null;
}

/** What a session and an honoured rest pay, from the bundle's economy.json and xp.json. */
export function kindlePay(content = null) {
  const pays = economyOf(content?.economy ?? null).earn;
  const rates = ratesOf(content?.xp ?? null);
  return { focus: pays.focus?.n ?? 0, rest: pays.rest?.n ?? 0, focusXp: rates['focus-session']?.xp ?? 0, restXp: rates['rest-honoured']?.xp ?? 0 };
}

/**
 * The panel's view: { phase, endsText ('10:00' or ''), earned, today: { focus, rests }, bell,
 * confirming: null | 'stop' | 'start', words, pay: kindlePay's }.
 */
export function kindlePanelView(state, now, { confirming = null, bell = true, content = null } = {}) {
  const view = kindleView(state, now);
  const today = finite(now) ? dayView(state, null, { now }).totals : { focus: 0, rests: 0 };
  return {
    phase: view.phase,
    endsText: finite(view.endsAt) ? clockWords(view.endsAt) : '',
    earned: restEarned(state, view),
    today: { focus: today.focus || 0, rests: today.rests || 0 },
    bell: bell !== false,
    confirming: confirming === 'stop' || confirming === 'start' ? confirming : null,
    words: view.words,
    pay: kindlePay(content),
  };
}

/** 'Focus pays 10 Embers. A full rest pays 5.' from what they pay. */
export function payNote(pay) {
  const p = isRecord(pay) ? pay : kindlePay();
  const whole = (n) => Math.max(0, Math.floor(Number(n) || 0));
  return `Focus pays ${plural(whole(p.focus), 'Ember', 'Embers')}. A full rest pays ${whole(p.rest)}.`;
}

/** The panel's words, all calm (a test reads every one). */
export const COPY = Object.freeze({
  idle: 'Fifty minutes of focus, then a fifteen-minute rest.',
  honoured: 'Honoured if you rest the full fifteen.',
  stopTitle: 'Put the lantern out?',
  stopBody: 'Stopping now ends the session, and it won’t pay.',
  stopRestBody: 'Stopping now ends the rest, and it won’t be honoured.',
  lostFocus: 'The focus session stopped early, so it won’t pay.',
  lostRest: 'The rest was cut short, so it won’t be honoured.',
  startTitle: 'Kindle the lantern now?',
  startBody: 'The rest ends early, and it won’t be honoured.',
  bellName: 'Kindle’s bell',
  bellHint: 'A quiet note when a session or rest ends.',
});

const button = (action, label, key, { primary = false, small = false } = {}) => `<button type="button" class="px-btn${primary ? ' primary' : ''}${small ? ' small' : ''}" data-action="${action}" data-focus-key="${key}">${esc(label)}</button>`;

function confirmBox(kind, phase) {
  const [title, body, go, goLabel, keep, keepLabel] = kind === 'stop'
    ? [COPY.stopTitle, phase === 'rest' ? COPY.stopRestBody : COPY.stopBody, 'kindle-stop-confirm', 'Put it out', 'kindle-keep', phase === 'rest' ? 'Keep resting' : 'Keep going']
    : [COPY.startTitle, COPY.startBody, 'kindle-start-confirm', 'Start now', 'kindle-keep', 'Keep resting'];
  return `<div class="confirm" role="alertdialog" aria-labelledby="kindle-confirm-title" aria-describedby="kindle-confirm-body">`
    + `<p class="confirm-title" id="kindle-confirm-title">${esc(title)}</p><p class="confirm-body" id="kindle-confirm-body">${esc(body)}</p>`
    + `<div class="ask-actions">${button(go, goLabel, go)}${button(keep, keepLabel, keep, { primary: true })}</div></div>`;
}

/** The `kindle` panel. view: kindlePanelView's. */
export function buildKindle(view) {
  const v = isRecord(view) ? view : {};
  const phase = ['focus', 'rest'].includes(v.phase) ? v.phase : 'idle';
  let html = `<div class="kindle-view" data-phase="${phase}">`;
  html += `<figure class="kindle-art" aria-hidden="true"><span class="kindle-flame" data-phase="${phase}"></span></figure>`;
  if (phase === 'focus') html += `<p class="panel-lede">Focusing until ${esc(v.endsText)}. Milo’s keeping the lantern lit.</p>`;
  else if (phase === 'rest') html += `<p class="panel-lede">Resting until ${esc(v.endsText)}.</p>${v.earned ? `<p class="setting-hint">${esc(COPY.honoured)}</p>` : ''}`;
  else html += `<p class="panel-lede">${esc(COPY.idle)}</p>`;
  html += '<section class="building-actions kindle-actions" data-group="actions">';
  // A confirm shows only in a phase it can belong to (stopping focus or a rest, starting over a rest).
  if (v.confirming && phase !== 'idle' && (v.confirming === 'stop' || phase === 'rest')) html += confirmBox(v.confirming, phase);
  else if (phase === 'focus') html += `<div class="ask-actions">${button('kindle-stop', 'Put the lantern out', 'kindle-stop')}</div>`;
  else if (phase === 'rest') html += `<div class="ask-actions">${button('kindle-start', 'Kindle the lantern', 'kindle-start', { primary: true })}${button('kindle-stop', 'Put the lantern out', 'kindle-stop')}</div>`;
  else html += `<div class="ask-actions">${button('kindle-start', 'Kindle the lantern', 'kindle-start', { primary: true })}${button('kindle-rest', 'Bank the coals', 'kindle-rest')}</div>`;
  html += '</section>';
  if (phase === 'idle') html += `<p class="setting-hint kindle-note">${esc(payNote(v.pay))}</p>`;
  const today = isRecord(v.today) ? v.today : {};
  const focus = Math.max(0, Math.floor(Number(today.focus) || 0));
  const rests = Math.max(0, Math.floor(Number(today.rests) || 0));
  html += '<section class="group kindle-today" data-group="today"><h3>Today</h3>';
  html += focus || rests
    ? `<p class="kindle-count">${esc(plural(focus, 'focus session', 'focus sessions'))} finished, ${esc(plural(rests, 'rest', 'rests'))} honoured.</p>`
    : '<p class="quiet-note">None yet today.</p>';
  html += '</section>';
  html += '<section class="settings kindle-settings" data-group="kindle-bell">'
    + `<div class="setting"><div><p class="setting-name" id="kindle-bell-name">${esc(COPY.bellName)}</p><p class="setting-hint">${esc(COPY.bellHint)}</p></div>`
    + `<button type="button" class="switch" role="switch" aria-checked="${v.bell === false ? 'false' : 'true'}" aria-labelledby="kindle-bell-name" data-action="kindle-bell" data-focus-key="kindle-bell">`
    + `<span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${v.bell === false ? 'Off' : 'On'}</span></button></div></section>`;
  return `${html}</div>`;
}

/** The orb's view: { phase, text ('42:10', or 'Kindle' when idle), label (its accessible name), left }. */
export function orbView(state, now) {
  const view = kindleView(state, now);
  if (view.phase === 'idle') return { phase: 'idle', text: 'Kindle', label: 'Kindle: the lantern’s ready. Open Kindle.', left: 0 };
  const what = view.phase === 'focus' ? 'focusing' : 'resting';
  return { phase: view.phase, text: clockText(view.left), label: `Kindle: ${what}, ${minutesWords(view.left)}. Open Kindle.`, left: view.left };
}

const FLAME = '<svg class="orb-glyph" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 0h1v1h1v2h1v3H5v1H2V6H1V3h1V1h1z"/></svg>';

/** The orb's contents (#kindle-orb, a title-bar button). */
export function buildKindleOrb(view) {
  const v = isRecord(view) ? view : { phase: 'idle', text: 'Kindle' };
  const phase = ['focus', 'rest'].includes(v.phase) ? v.phase : 'idle';
  return `${FLAME}<span class="orb-time" data-phase="${phase}">${esc(v.text || 'Kindle')}</span>`;
}

/** The title bar's status line for Kindle (first in Quiet mode), or null when the lantern's idle. */
export function statusLine(state, now) {
  const view = kindleView(state, now);
  if (view.phase === 'focus') return `Focusing · ${minutesWords(view.left)}`;
  if (view.phase === 'rest') return `Resting · ${minutesWords(view.left)}`;
  return null;
}

const embersWords = (n) => (n > 0 ? ` ${plural(n, 'Ember', 'Embers')} for that.` : '');

/**
 * The bubbles a Kindle step brings: a phase's end (and what it paid), and a start or a rest begun
 * from a button or the command bar. `lost` ('focus' | 'rest' | null, kindleStep's) puts what the
 * step gave up first: a session stopped early, or an honoured rest cut short.
 * → [{ kind: 'bell' | 'note', title, lines, duration }]
 */
export function phaseBubbles(events, { paid = 0, verb = 'tick', lost = null } = {}) {
  const list = Array.isArray(events) ? events : [];
  const has = (t) => list.some((e) => isRecord(e) && e.t === t);
  const out = [];
  const n = Math.max(0, Math.floor(Number(paid) || 0));
  if (has('focus-done') && has('rest-done')) {
    out.push({ kind: 'bell', title: 'The focus session and the rest are done', lines: [`Both finished while you were away.${embersWords(n)}`], duration: 9000 });
  } else if (has('focus-done')) {
    out.push({ kind: 'bell', title: 'The focus session is done', lines: [`Rest for fifteen minutes. The coals are banked.${embersWords(n)}`], duration: 9000 });
  } else if (has('rest-done')) {
    out.push({ kind: 'bell', title: 'The rest is over', lines: [`Kindle the lantern again when you’re ready.${embersWords(n)}`], duration: 9000 });
  }
  // Real causes first: what the step cost comes before the new phase's line.
  const cost = lost === 'focus' ? [COPY.lostFocus] : lost === 'rest' ? [COPY.lostRest] : [];
  const long = cost.length ? 8000 : 5000;
  if (verb === 'start' && has('focus-started')) out.push({ kind: 'note', title: 'The lantern’s lit', lines: [...cost, 'Fifty minutes of focus. I’ll keep watch.'], duration: long });
  if (verb === 'rest' && has('rest-started')) out.push({ kind: 'note', title: 'The coals are banked', lines: [...cost, 'Fifteen minutes of rest. Nothing needs you.'], duration: long });
  if (verb === 'stop' && has('stopped')) out.push({ kind: 'note', title: 'The lantern’s out', lines: [...cost, 'Kindle it again whenever you like.'], duration: long });
  return out;
}

/** The features a Kindle step uses for the first time (tally.features; trail steps wait on them). */
export function stepFeatures(events) {
  const list = Array.isArray(events) ? events : [];
  const out = [];
  if (list.some((e) => isRecord(e) && e.t === 'focus-started')) out.push('kindle');
  if (list.some((e) => isRecord(e) && e.t === 'rest-started')) out.push('rest');
  return out;
}

const lifetimeOf = (state) => walletView(state, 0).lifetime;

/**
 * One Kindle step, pure: verb 'start' | 'rest' | 'stop' | 'tick' at `now`, with the bundle's
 * economy and xp. → { state, events, bubbles, features, paid (Embers earned by it), lost ('focus'
 * when a running session stopped unpaid, 'rest' when an honoured rest was cut short, else null),
 * words (what the command bar says when nothing changed, else '') }.
 */
export function kindleStep(state, verb, now, content = null) {
  const options = { economy: content?.economy ?? null, xp: content?.xp ?? null };
  const step = verb === 'start' ? kindleStart : verb === 'rest' ? bankedCoals : verb === 'stop' ? kindleStop : kindleTick;
  const { state: next, events } = step(state, now, options);
  const paid = next === state ? 0 : Math.max(0, lifetimeOf(next) - lifetimeOf(state));
  const lost = verb === 'tick' ? null : lostBy(state, events, now);
  let words = '';
  if (verb !== 'tick' && !events.some((e) => ['focus-started', 'rest-started', 'stopped'].includes(e.t))) {
    const view = kindleView(next, now);
    words = view.phase === 'idle' ? 'The lantern isn’t lit.' : `The lantern’s already ${view.phase === 'focus' ? 'lit' : 'banked'}. ${view.words}`;
  }
  return { state: next, events, bubbles: phaseBubbles(events, { paid, verb, lost }), features: stepFeatures(events), paid, lost, words };
}

// The mounted module, for runKindle (the command bar calls the same function the buttons do).
let mounted = null;

/**
 * Runs a Kindle verb through the shell, exactly as the panel's buttons do: the step, its bubbles,
 * its features, the bell in main and the orb. → { changed, words, events }.
 */
export function runKindle(shell, verb) {
  if (mounted && mounted.shell === shell) return mounted.run(verb);
  return applyStep(shell, verb, null);
}

function applyStep(shell, verb, after) {
  try {
    if (!shell) return { changed: false, words: '', events: [] };
    const now = shell.now();
    const content = typeof shell.content === 'function' ? shell.content() : null;
    const before = shell.state;
    const step = kindleStep(before, verb, now, content);
    if (step.state !== before) shell.set(step.state, { save: 150 });
    for (const bubble of step.bubbles) shell.bubble(bubble);
    for (const feature of step.features) shell.feature(feature);
    if (step.events.length && typeof shell.emit === 'function') shell.emit('kindle', { verb, events: step.events });
    if (typeof after === 'function') after(step, step.state !== before);
    return { changed: step.state !== before, words: step.words, events: step.events };
  } catch (err) {
    console.error('[MILO] kindle', err);
    return { changed: false, words: '', events: [] };
  }
}

const NOOP = Object.freeze({ dispose() {}, refresh() {}, tick() {} });

/**
 * Mounts the orb (#kindle-orb) and registers the `kindle` panel. Ticks the timer at mount, every
 * second while visible ('second') and when main's bell rings, so a finished session pays however
 * MILO was covered or closed; arms the bell in main after every change; keeps the title-bar status
 * line and html[data-focus]. → { dispose(), refresh(reason), tick() }.
 */
export function mount(shell) {
  try {
    if (!shell) return NOOP;
    const doc = globalThis.document;
    const root = doc?.getElementById?.('kindle-orb') || null;
    const offs = [];
    // The confirm open in the panel, and the phase it was asked in ({ kind: 'stop' | 'start', key }):
    // a confirm never outlives its phase, so a stale "Put it out" can't break the rest that followed.
    let confirming = null;
    let armed = null;
    let status;
    let lastOrb = '';
    let lastLabel = '';

    const bell = () => {
      const value = shell.settings && typeof shell.settings.get === 'function' ? shell.settings.get('kindleBell') : shell.state?.settings?.kindleBell;
      return value !== false;
    };
    const arm = () => {
      const alarm = nextAlarm(shell.state);
      const key = alarm ? `${alarm.id}@${alarm.at}` : 'none';
      if (key === armed) return;
      armed = key;
      const set = shell.bridge?.alarm?.set;
      if (typeof set === 'function') Promise.resolve(set(alarm)).catch((err) => console.error('[MILO] kindle bell', err));
    };
    const paint = () => {
      const now = shell.now();
      const view = orbView(shell.state, now);
      if (root) {
        const time = root.querySelector?.('.orb-time');
        if (!time) root.innerHTML = buildKindleOrb(view);
        else if (time.textContent !== view.text) time.textContent = view.text;
        if (time && time.getAttribute('data-phase') !== view.phase) time.setAttribute('data-phase', view.phase);
        if (view.text !== lastOrb || view.label !== lastLabel) {
          root.setAttribute('aria-label', view.label);
          root.setAttribute('data-phase', view.phase);
          lastOrb = view.text;
          lastLabel = view.label;
        }
      }
      const line = statusLine(shell.state, now);
      if (line !== status) {
        status = line;
        if (typeof shell.status === 'function') shell.status('kindle', line);
      }
      const html = doc?.documentElement;
      if (html?.dataset) {
        if (view.phase === 'focus') html.dataset.focus = 'true';
        else delete html.dataset.focus;
      }
    };
    const keyNow = () => phaseKey(shell.state, shell.now());
    /** The confirm to show: only one asked in the phase that's running now. */
    const openConfirm = () => (confirming && confirming.key === keyNow() ? confirming.kind : null);
    const afterStep = (step, changed) => {
      if (confirming && confirming.key !== keyNow()) confirming = null;
      arm();
      paint();
      if (changed && shell.state?.panel === PANEL) shell.refreshPanel({ passive: true });
    };
    const run = (verb) => {
      confirming = null;
      return applyStep(shell, verb, afterStep);
    };
    const tick = () => applyStep(shell, 'tick', afterStep);

    const render = () => buildKindle(kindlePanelView(shell.state, shell.now(), { confirming: openConfirm(), bell: bell(), content: shell.content?.() }));
    const ask = (kind) => { confirming = { kind, key: keyNow() }; shell.refreshPanel({ focus: 'kindle-keep' }); return true; };
    const action = (btn) => {
      const act = btn?.getAttribute?.('data-action') || btn?.dataset?.action || '';
      const now = shell.now();
      const phase = kindleView(shell.state, now).phase;
      const earned = restEarned(shell.state, { phase });
      switch (act) {
        case 'kindle-start':
        case 'kindle-start-confirm':
          // Over an honoured rest, starting asks first; a confirm from another phase asks again.
          if (phase === 'rest' && earned && !(act === 'kindle-start-confirm' && openConfirm() === 'start')) return ask('start');
          run('start');
          shell.refreshPanel({ focus: 'kindle-stop' });
          return true;
        case 'kindle-rest':
          // Only offered while the lantern's out; an older panel's button changes nothing.
          if (phase !== 'idle') { confirming = null; shell.refreshPanel({ focus: phase === 'focus' ? 'kindle-stop' : 'kindle-start' }); return true; }
          run('rest');
          shell.refreshPanel({ focus: 'kindle-start' });
          return true;
        case 'kindle-stop':
        case 'kindle-stop-confirm':
          // Stopping a focus session or an honoured rest asks first; so does a confirm left over from another phase.
          if ((phase === 'focus' || earned) && !(act === 'kindle-stop-confirm' && openConfirm() === 'stop')) return ask('stop');
          run('stop');
          shell.refreshPanel({ focus: 'kindle-start' });
          return true;
        case 'kindle-keep': confirming = null; shell.refreshPanel({ focus: phase === 'focus' ? 'kindle-stop' : 'kindle-start' }); return true;
        case 'kindle-bell':
          if (shell.settings && typeof shell.settings.set === 'function') shell.settings.set('kindleBell', !bell());
          shell.refreshPanel({ focus: 'kindle-bell' });
          return true;
        default: return false;
      }
    };
    const registered = typeof shell.registerPanel === 'function'
      ? shell.registerPanel(PANEL, { title: () => 'Kindle', render: () => render(), exists: () => true, action: (btn) => action(btn) })
      : null;
    if (typeof registered === 'function') offs.push(registered);

    const onClick = () => shell.openPanel(PANEL);
    if (root) {
      root.hidden = false;
      root.addEventListener('click', onClick);
    }
    if (typeof shell.on === 'function') {
      offs.push(shell.on('second', () => tick()));
      offs.push(shell.on('state', () => { arm(); paint(); }));
    }
    const ring = shell.bridge?.alarm?.onRing;
    if (typeof ring === 'function') {
      try { offs.push(ring(() => tick())); } catch (err) { console.error('[MILO] kindle bell', err); }
    }
    mounted = { shell, run };
    tick();
    arm();
    paint();
    return {
      dispose() {
        for (const off of offs) if (typeof off === 'function') off();
        if (root) root.removeEventListener('click', onClick);
        if (mounted?.shell === shell) mounted = null;
        const html = doc?.documentElement;
        if (html?.dataset) delete html.dataset.focus;
      },
      refresh() { arm(); paint(); },
      tick,
    };
  } catch (err) {
    console.error('[MILO] kindle mount', err);
    return NOOP;
  }
}
