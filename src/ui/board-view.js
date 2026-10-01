// The Board (PLAN.md Phase 5): the `board` panel, the HUD's Quests tab. One line to add a quest,
// then Doing, To do and Done. Copy stays short; the detail is in the hover text. Quest titles are
// Chris's own words, shown here and nowhere else.
import { boardView, boardOf, addQuest, updateQuest, setStatus, finishQuest, deleteQuest, addStep, toggleStep, removeStep } from '../quests.js';
import { QUEST_SKILLS, BOARD_LIMITS } from '../state5.js';
import { trailView } from '../world/trail.js';
import { esc } from './panels.js';

export const id = 'board';
export const PANEL = 'board';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const QUEST_ID = /^q-[0-9a-z]{1,12}$/;
const STEP_ID = /^s-[0-9a-z]{1,12}$/;
const cap = (text) => (typeof text === 'string' && text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

export const COPY = Object.freeze({
  placeholder: 'Add a quest',
  add: 'Add',
  empty: 'Nothing on the board.',
  kind: Object.freeze({ main: 'Main', side: 'Side' }),
  kindHint: Object.freeze({ main: 'A main quest. Tap to make it a side quest.', side: 'A side quest. Tap to make it a main quest.' }),
});

/** { text } → '+3 Embers · Cooking +300' (what finishing a quest paid), or ''. */
export function paidLine(paid) {
  if (!isRecord(paid)) return '';
  const parts = [];
  if (paid.embers > 0) parts.push(`+${paid.embers} ${paid.embers === 1 ? 'Ember' : 'Embers'}`);
  if (paid.xp > 0) parts.push(`${cap(paid.skill)} +${paid.xp}`);
  return parts.join(' · ');
}

function detailsHtml(q) {
  const steps = q.steps.map((s) => `<li data-step="${esc(s.id)}"><label><input type="checkbox" data-action="board-step" data-quest="${esc(q.id)}" data-step="${esc(s.id)}"${s.done ? ' checked' : ''}> <span${s.done ? ' class="done-text"' : ''}>${esc(s.title)}</span></label>`
    + ` <button type="button" class="link-btn" data-action="board-step-remove" data-quest="${esc(q.id)}" data-step="${esc(s.id)}" aria-label="Remove this step">Remove</button></li>`).join('');
  return `<div class="quest-details" data-quest-details="${esc(q.id)}">`
    + (steps ? `<ul class="quest-steps">${steps}</ul>` : '')
    + `<form class="quest-step-form" data-form="board-step" data-quest="${esc(q.id)}"><input type="text" name="step" maxlength="${BOARD_LIMITS.stepTitle}" placeholder="Add a step" autocomplete="off" aria-label="Add a step" data-focus-key="board-step-${esc(q.id)}"> <button type="submit" class="px-btn small">Add</button></form>`
    + `<label class="quest-field">Notes <textarea rows="3" maxlength="${BOARD_LIMITS.notes}" data-field="board-notes" data-quest="${esc(q.id)}" data-focus-key="board-notes-${esc(q.id)}">${esc(q.notes)}</textarea></label>`
    + `<label class="quest-field">Trains <select data-action="board-skill" data-quest="${esc(q.id)}" data-focus-key="board-skill-${esc(q.id)}">${QUEST_SKILLS.map((s) => `<option value="${s}"${s === q.skill ? ' selected' : ''}>${cap(s)}</option>`).join('')}</select></label>`
    + `<div class="ask-actions"><button type="button" class="link-btn" data-action="board-delete" data-quest="${esc(q.id)}" data-focus-key="board-delete-${esc(q.id)}">Delete</button></div>`
    + '</div>';
}

function questRow(q, { open = false, confirming = false } = {}) {
  const buttons = q.status === 'done'
    ? [['board-reopen', 'Reopen']]
    : q.status === 'doing' ? [['board-done', 'Done', true], ['board-back', 'Back']] : [['board-start', 'Start'], ['board-done', 'Done', true]];
  const steps = q.steps.length ? ` <span class="quest-count" title="Steps done">${q.stepsDone}/${q.steps.length}</span>` : '';
  const project = q.projectTitle ? ` <span class="quest-project" title="Project">${esc(q.projectTitle)}</span>` : '';
  return `<li class="quest" data-quest="${esc(q.id)}" data-kind="${esc(q.kind)}" data-status="${esc(q.status)}">`
    + `<button type="button" class="quest-kind" data-action="board-kind" data-quest="${esc(q.id)}" title="${esc(COPY.kindHint[q.kind])}" data-focus-key="board-kind-${esc(q.id)}">${esc(COPY.kind[q.kind])}</button>`
    + `<button type="button" class="quest-title" data-action="board-open" data-quest="${esc(q.id)}" aria-expanded="${open ? 'true' : 'false'}" title="Details" data-focus-key="board-open-${esc(q.id)}">${esc(q.title)}</button>${steps}${project}`
    + `<span class="quest-actions">${buttons.map(([action, label, primary]) => `<button type="button" class="px-btn small${primary ? ' primary' : ''}" data-action="${action}" data-quest="${esc(q.id)}" data-focus-key="${action}-${esc(q.id)}">${esc(label)}</button>`).join('')}</span>`
    + (open ? detailsHtml(q) : '')
    + (open && confirming ? `<p class="plot-note" data-note="delete">Delete this quest? <button type="button" class="px-btn small" data-action="board-delete-yes" data-quest="${esc(q.id)}" data-focus-key="board-delete-yes">Delete</button> <button type="button" class="link-btn" data-action="board-delete-no" data-quest="${esc(q.id)}" data-focus-key="board-delete-no">Keep</button></p>` : '')
    + '</li>';
}

/** The `board` panel. view: boardView's; ui: { open, confirming, draft, says }. */
export function buildBoard(view, ui = {}) {
  const v = isRecord(view) ? view : { doing: [], todo: [], done: [], doneCount: 0 };
  let html = '<div class="board-view">';
  html += `<form class="board-add" data-form="board-add"><input type="text" name="quest" value="${esc(ui.draft || '')}" maxlength="${BOARD_LIMITS.title}" placeholder="${esc(COPY.placeholder)}" autocomplete="off" aria-label="${esc(COPY.placeholder)}" data-focus-key="board-input"> `
    + `<button type="submit" class="px-btn primary" data-focus-key="board-add">${esc(COPY.add)}</button></form>`;
  if (ui.says) html += `<p class="plot-note board-says" data-note="paid" tabindex="-1">${esc(ui.says)}</p>`;
  const section = (name, label, list, extra = '') => {
    if (!list.length) return '';
    return `<section class="group board-${name}" data-group="${name}"><h3>${esc(label)} <span class="count">${esc(extra || list.length)}</span></h3><ul class="quest-list">`
      + list.map((q) => questRow(q, { open: ui.open === q.id, confirming: ui.confirming === q.id })).join('') + '</ul></section>';
  };
  const body = section('doing', 'Doing', v.doing) + section('todo', 'To do', v.todo) + section('done', 'Done', v.done, v.doneCount > v.done.length ? `${v.done.length} of ${v.doneCount}` : '');
  html += body || `<p class="quiet-note">${esc(COPY.empty)}</p>`;
  if (ui.trail) html += '<p class="board-foot"><button type="button" class="link-btn" data-action="board-trail" data-focus-key="board-trail">Riddle Notes</button></p>';
  return `${html}</div>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Registers the `board` panel. It follows the board while it's open, and never refreshes under a typing hand. */
export function mount(shell) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const doc = globalThis.document;
    const offs = [];
    const ui = { open: null, confirming: null, draft: '', says: '' };
    const economy = () => shell.content?.()?.economy ?? null;
    const rates = () => shell.content?.()?.xp ?? null;
    const render = () => buildBoard(boardView(shell.state), { ...ui, trail: Boolean(trailView(shell.state, shell.content?.()?.trails ?? null, shell.now()).trail) });
    const refresh = (opts = {}) => { if (shell.state?.panel === PANEL || doc?.getElementById?.('panel')?.dataset?.place === PANEL) shell.refreshPanel(opts); };
    const commit = (next, focus) => { if (next !== shell.state) shell.set(next, { save: 300 }); refresh({ focus }); };
    const questId = (el) => { const value = el?.getAttribute?.('data-quest') || ''; return QUEST_ID.test(value) ? value : ''; };

    const finish = (qid) => {
      const r = finishQuest(shell.state, qid, shell.now(), { economy: economy(), rates: rates() });
      ui.says = paidLine(r.paid);
      if (ui.says) shell.log?.({ tab: 'milo', text: `Quest done · ${ui.says}`, at: shell.now(), detail: null, action: null });
      commit(r.state, null);
    };

    const action = (button) => {
      const name = button?.getAttribute?.('data-action') || '';
      if (!name.startsWith('board-')) return false;
      if (name === 'board-trail') { shell.openPanel?.('trail'); return true; }
      const qid = questId(button);
      const quest = qid ? boardOf(shell.state).quests.find((q) => q.id === qid) : null;
      if (name === 'board-step') {
        const sid = button.getAttribute('data-step') || '';
        if (quest && STEP_ID.test(sid)) commit(toggleStep(shell.state, qid, sid), `board-open-${qid}`);
        return true;
      }
      if (!quest) return true;
      ui.says = '';
      switch (name) {
        case 'board-start': commit(setStatus(shell.state, qid, 'doing', shell.now()), `board-done-${qid}`); break;
        case 'board-back': commit(setStatus(shell.state, qid, 'todo', shell.now()), `board-start-${qid}`); break;
        case 'board-reopen': commit(setStatus(shell.state, qid, 'todo', shell.now()), `board-open-${qid}`); break;
        case 'board-done': finish(qid); break;
        case 'board-kind': commit(updateQuest(shell.state, qid, { kind: quest.kind === 'main' ? 'side' : 'main' }), `board-kind-${qid}`); break;
        case 'board-open': ui.open = ui.open === qid ? null : qid; ui.confirming = null; refresh({ focus: `board-open-${qid}` }); break;
        case 'board-delete': ui.confirming = qid; refresh({ focus: 'board-delete-no' }); break;
        case 'board-delete-no': ui.confirming = null; refresh({ focus: `board-delete-${qid}` }); break;
        case 'board-delete-yes': ui.confirming = null; ui.open = null; commit(deleteQuest(shell.state, qid), 'board-input'); break;
        case 'board-step-remove': {
          const sid = button.getAttribute('data-step') || '';
          if (STEP_ID.test(sid)) commit(removeStep(shell.state, qid, sid), `board-step-${qid}`);
          break;
        }
        default: return false;
      }
      return true;
    };

    // The pieces the panel registry doesn't see: typing, forms and the notes box.
    const panelEl = doc?.getElementById?.('panel');
    const onInput = (event) => {
      if (panelEl?.dataset?.place !== PANEL) return;
      if (event.target?.name === 'quest') ui.draft = event.target.value;
    };
    const onSubmit = (event) => {
      if (panelEl?.dataset?.place !== PANEL) return;
      const form = event.target?.closest?.('[data-form^="board-"]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      const kind = form.getAttribute('data-form');
      if (kind === 'board-add') {
        const r = addQuest(shell.state, form.elements.quest?.value ?? ui.draft, shell.now());
        ui.draft = '';
        ui.says = '';
        commit(r.state, 'board-input');
      } else if (kind === 'board-step') {
        const qid = questId(form);
        const input = form.elements.step;
        if (qid && input) commit(addStep(shell.state, qid, input.value), `board-step-${qid}`);
      }
    };
    const onChange = (event) => {
      if (panelEl?.dataset?.place !== PANEL) return;
      const el = event.target;
      const qid = questId(el);
      if (!qid) return;
      if (el.getAttribute('data-field') === 'board-notes') {
        const next = updateQuest(shell.state, qid, { notes: el.value });
        if (next !== shell.state) shell.set(next, { save: 600 });
      } else if (el.getAttribute('data-action') === 'board-skill') {
        commit(updateQuest(shell.state, qid, { skill: el.value }), `board-skill-${qid}`);
      }
    };
    panelEl?.addEventListener('input', onInput);
    panelEl?.addEventListener('submit', onSubmit, true);
    panelEl?.addEventListener('change', onChange);

    const off = shell.registerPanel(PANEL, { title: () => 'The Board', render: () => render(), exists: () => true, action: (button) => action(button) });
    if (typeof off === 'function') offs.push(off);
    // Only a change to the board redraws the panel, so a crew snapshot never takes the cursor from the box.
    let lastBoard = shell.state?.board;
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        const board = shell.state?.board;
        if (board === lastBoard) return;
        lastBoard = board;
        if (panelEl?.dataset?.place === PANEL) shell.refreshPanel({ passive: true });
      }));
    }
    return {
      dispose() {
        for (const fn of offs) if (typeof fn === 'function') fn();
        panelEl?.removeEventListener('input', onInput);
        panelEl?.removeEventListener('submit', onSubmit, true);
        panelEl?.removeEventListener('change', onChange);
      },
      refresh() { if (panelEl?.dataset?.place === PANEL) shell.refreshPanel({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] board mount', err);
    return NOOP;
  }
}
