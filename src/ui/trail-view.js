// The Riddle Note trail (CONTRACT-PHASE4.md §3.1, §9.12, §12.4 K1; LORE.md §16): the `trail`
// panel (the HUD's Quests tab), with the note Chris is on in Tamsin's hand, its sign, the hint once
// asked for, and the steps done; and the tracker card for #tracker once the Prologue is done, in
// the shape of Phase 3's panels.trackerCard (same classes and actions), since trackerCard itself
// only speaks for the Prologue. It reads world/trail.js's trailView; a hint asked for is kept as
// the fact 'hint:<stepId>' (state4.markFact), so it stays asked for.
import { trailView } from '../world/trail.js';
import { markFact, STATE4_LIMITS } from '../state4.js';
import { esc, CHECK, DOT } from './panels.js';

export const id = 'trail';
export const PANEL = 'trail';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
/** The fact that says a step's hint was asked for. */
export const hintFact = (stepId) => `hint:${stepId}`;

export const COPY = Object.freeze({
  none: 'No Riddle Notes yet.',
  bridge: 'Every note is solved. The Tollkeeper is waiting at the Last Bridge.',
  done: 'Every riddle answered. The Tollkeeper walks with the Company now.',
  ask: 'Ask for a hint',
});

/** trail.trailView plus the hints asked for: { ...trailView, hinted: stepId[] }. */
export function trailPanelView(state, trails, now) {
  const view = trailView(state, trails, now);
  const facts = isRecord(state) && isRecord(state.story) && isRecord(state.story.facts) ? state.story.facts : {};
  const ids = [...(view.step ? [view.step.id] : []), ...view.steps.map((s) => s.id)];
  return { ...view, hinted: [...new Set(ids.filter((stepId) => Object.hasOwn(facts, hintFact(stepId))))] };
}

/**
 * Keeps the hint for the note Chris is on asked for. story.facts keeps only its newest
 * STATE4_LIMITS.facts (200), so once three quarters of them are newer than that step's `hint:`
 * fact, the fact is written again at `now` (markFact, after taking the old one out). A solved
 * step needs nothing: the panel shows a solved note's hint anyway. → the same state when nothing
 * needs doing, else the new one.
 */
export function keepHint(state, trails, now) {
  if (!isRecord(state) || !isRecord(state.story) || !isRecord(state.story.facts) || typeof now !== 'number' || !Number.isFinite(now)) return state;
  const facts = state.story.facts;
  const limit = Math.floor((STATE4_LIMITS.facts || 200) * 0.75);
  if (Object.keys(facts).length <= limit) return state;
  const step = trailView(state, trails, now).step;
  const key = isRecord(step) && typeof step.id === 'string' ? hintFact(step.id) : '';
  if (!key || !Object.hasOwn(facts, key)) return state;
  const at = facts[key];
  if (typeof at !== 'number' || at >= now) return state;
  let newer = 0;
  for (const value of Object.values(facts)) if (typeof value === 'number' && value > at) newer += 1;
  if (newer < limit) return state;
  const rest = { ...facts };
  delete rest[key];
  return markFact({ ...state, story: { ...state.story, facts: rest } }, key, now);
}

/** A Riddle Note: its lines in Tamsin's hand, and her sign at the foot. */
export function noteBlock(step) {
  const lines = Array.isArray(step?.riddle) ? step.riddle.filter((line) => typeof line === 'string') : [];
  const sign = typeof step?.sign === 'string' ? step.sign : '';
  return `<blockquote class="letter note-text riddle-note">${lines.map((line) => `<p>${esc(line)}</p>`).join('')}${sign ? `<footer>${esc(sign)}</footer>` : ''}</blockquote>`;
}

/** The `trail` panel. view: trailPanelView's. */
export function buildTrail(view) {
  const v = isRecord(view) ? view : {};
  const hinted = Array.isArray(v.hinted) ? v.hinted : [];
  if (!isRecord(v.trail)) {
    return `<div class="trail-view" data-trail=""><p class="panel-lede">${esc(COPY.none)}</p></div>`;
  }
  const t = v.trail;
  let html = `<div class="trail-view" data-trail="${esc(t.id)}"${t.tier ? ` data-tier="${esc(t.tier)}"` : ''}>`;
  html += `<p class="trail-kicker">${esc([t.tierName, t.title].filter(Boolean).join(' · '))}</p>`;
  if (isRecord(v.step)) {
    const step = v.step;
    html += `<section class="group trail-note" data-group="note" data-step="${esc(step.id)}"><h3>The note you’re on</h3>${noteBlock(step)}`;
    if (hinted.includes(step.id) && step.hint) html += `<p class="plot-note" data-note="hint" tabindex="-1" data-focus-key="trail-hint">${esc(step.hint)}</p>`;
    else if (step.hint) html += `<div class="ask-actions"><button type="button" class="link-btn" data-action="trail-hint" data-step="${esc(step.id)}" data-focus-key="trail-hint">${esc(COPY.ask)}</button></div>`;
    html += '</section>';
  } else if (v.atBridge) {
    html += `<p class="plot-note" data-note="bridge">${esc(COPY.bridge)}</p>`;
  } else if (v.done) {
    html += `<p class="plot-note" data-note="done">${esc(COPY.done)}</p>`;
  }
  const steps = Array.isArray(v.steps) ? v.steps.filter(isRecord) : [];
  if (steps.length) {
    html += `<section class="group trail-steps" data-group="steps"><h3>Notes found <span class="count">${esc(steps.length)}</span></h3><ol class="levels trail-list">`;
    for (const step of steps) {
      const current = isRecord(v.step) && v.step.id === step.id;
      const words = step.done ? step.hint : current ? 'The note you’re on.' : '';
      html += `<li data-step="${esc(step.id)}" data-level-state="${step.done ? 'proven' : 'next'}">${step.done ? CHECK : DOT}`
        + `<span class="level-name">${esc(words || 'A note in Tamsin’s hand.')}</span><span class="level-tag">${step.done ? 'Solved' : 'Now'}</span></li>`;
    }
    html += '</ol></section>';
  }
  return `${html}</div>`;
}

/**
 * The tracker card for #tracker while a trail is on, in trackerCard's shape (its classes, and its
 * `tracker-show` / `tracker-hide` actions): { hidden } folds it to a pill. → '' with no trail on.
 */
export function trailCard(view, { hidden = false } = {}) {
  const v = isRecord(view) ? view : {};
  if (!isRecord(v.trail) || (!v.step && !v.atBridge)) return '';
  const steps = Array.isArray(v.steps) ? v.steps : [];
  const solved = steps.filter((s) => isRecord(s) && s.done).length;
  const kicker = `Riddle Notes · ${solved} solved`;
  if (hidden) {
    return `<button type="button" class="tracker-pill" data-action="tracker-show" data-focus-key="tracker-show" aria-label="${esc(`Show the Riddle Note. ${kicker}`)}">${esc(kicker)}</button>`;
  }
  const hinted = Array.isArray(v.hinted) ? v.hinted : [];
  const title = v.step ? (Array.isArray(v.step.riddle) && v.step.riddle.length ? v.step.riddle[0] : 'A note in Tamsin’s hand.') : 'The Last Bridge';
  const hint = v.step ? (hinted.includes(v.step.id) && v.step.hint ? v.step.hint : 'A note in Tamsin’s hand.') : COPY.bridge;
  return `<p class="tracker-kicker">${esc(kicker)}</p><p class="tracker-title">${esc(title)}</p><p class="tracker-hint">${esc(hint)}</p>`
    + '<div class="tracker-actions"><button type="button" class="link-btn" data-action="trail-open" data-focus-key="trail-open">The note</button>'
    + '<button type="button" class="tracker-hide" data-action="tracker-hide" data-focus-key="tracker-hide" aria-label="Tuck the note away"><svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 3h7v1H0z"/></svg></button>'
    + '</div>';
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Registers the `trail` panel. A hint, once asked for, stays (a story fact). */
export function mount(shell) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const offs = [];
    const trails = () => shell.content?.()?.trails ?? null;
    const render = () => buildTrail(trailPanelView(shell.state, trails(), shell.now()));
    const action = (button) => {
      if (button?.getAttribute?.('data-action') !== 'trail-hint') return false;
      const stepId = button.getAttribute('data-step');
      if (!STEP_ID.test(stepId || '')) return false;
      const next = markFact(shell.state, hintFact(stepId), shell.now());
      if (next !== shell.state) shell.set(next);
      shell.refreshPanel({ focus: 'trail-hint' });
      return true;
    };
    const off = shell.registerPanel(PANEL, { title: () => 'Riddle Notes', render: () => render(), exists: () => true, action: (button) => action(button) });
    if (typeof off === 'function') offs.push(off);
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        // The asked-for hint stays among the facts kept (keepHint changes nothing until it must).
        try {
          const kept = keepHint(shell.state, trails(), shell.now());
          if (kept !== shell.state && typeof shell.set === 'function') shell.set(kept);
        } catch (err) {
          console.error('[MILO] trail hint', err);
        }
        if (shell.state?.panel === PANEL) shell.refreshPanel({ passive: true });
      }));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (shell.state?.panel === PANEL) shell.refreshPanel({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] trail mount', err);
    return NOOP;
  }
}
