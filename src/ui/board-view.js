// The Board (PLAN.md Phase 5): the `board` panel (the HUD's Quests tab) and the Town hall's, which is
// the same board. Three tabs: Quests, Projects and Pocket (thoughts not yet quests). Copy stays
// short; the detail is in the hover text. Quest titles are Chris's own words, shown here and
// nowhere else.
import {
  boardView, boardOf, addQuest, updateQuest, setStatus, finishQuest, deleteQuest, addStep, toggleStep, removeStep,
  letGo, bringBack, keepQuest, nudgeView, addProject, completeProject, deleteProject, addThought, removeThought, thoughtToQuest, dueWords,
} from '../quests.js';
import { QUEST_SKILLS, BOARD_LIMITS } from '../state5.js';
import { trailView } from '../world/trail.js';
import { errandList } from '../errands.js';
import { esc } from './panels.js';

export const id = 'board';
export const PANEL = 'board';
/** The Town hall opens the same panel from the vale. */
export const HALL = 'townhall';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const QUEST_ID = /^q-[0-9a-z]{1,12}$/;
const STEP_ID = /^s-[0-9a-z]{1,12}$/;
const PROJECT_ID = /^p-[0-9a-z]{1,12}$/;
const THOUGHT_ID = /^t-[0-9a-z]{1,12}$/;
const TABS = Object.freeze(['quests', 'projects', 'pocket']);
/** Errands for people show as a fourth tab once there is one. */
const ALL_TABS = Object.freeze([...TABS, 'errands']);
const cap = (text) => (typeof text === 'string' && text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

export const COPY = Object.freeze({
  placeholder: 'Add a quest',
  projectPlaceholder: 'New project',
  thoughtPlaceholder: 'Jot a thought',
  add: 'Add',
  empty: 'Nothing on the board.',
  noProjects: 'No projects.',
  noThoughts: 'Nothing in the pocket.',
  crowded: 'A lot is in progress.',
  kind: Object.freeze({ main: 'Main', side: 'Side' }),
  kindHint: Object.freeze({ main: 'A main quest. Tap to make it a side quest.', side: 'A side quest. Tap to make it a main quest.' }),
});

/** { embers, xp, skill } → '+3 Embers · Cooking +300' (what finishing a quest paid), or ''. */
export function paidLine(paid) {
  if (!isRecord(paid)) return '';
  const parts = [];
  if (paid.embers > 0) parts.push(`+${paid.embers} ${paid.embers === 1 ? 'Ember' : 'Embers'}`);
  if (paid.xp > 0) parts.push(`${cap(paid.skill)} +${paid.xp}`);
  return parts.join(' · ');
}

const pad2 = (n) => String(n).padStart(2, '0');
/** A due time → the 'YYYY-MM-DD' a date field wants, in local time, or ''. */
export const dateValue = (due) => {
  if (typeof due !== 'number' || !Number.isFinite(due)) return '';
  const d = new Date(due);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
/** 'YYYY-MM-DD' → the end of that local day, or null. */
export function dueFromDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d.getTime();
}

function detailsHtml(q, projects) {
  const steps = q.steps.map((s) => `<li data-step="${esc(s.id)}"><label><input type="checkbox" data-action="board-step" data-quest="${esc(q.id)}" data-step="${esc(s.id)}"${s.done ? ' checked' : ''}> <span${s.done ? ' class="done-text"' : ''}>${esc(s.title)}</span></label>`
    + ` <button type="button" class="link-btn" data-action="board-step-remove" data-quest="${esc(q.id)}" data-step="${esc(s.id)}" aria-label="Remove this step">Remove</button></li>`).join('');
  const projectPick = projects.length
    ? `<label class="quest-field">Project <select data-action="board-project-pick" data-quest="${esc(q.id)}" data-focus-key="board-project-${esc(q.id)}"><option value="">None</option>${projects.map((p) => `<option value="${esc(p.id)}"${p.id === q.projectId ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>`
    : '';
  return `<div class="quest-details" data-quest-details="${esc(q.id)}">`
    + (steps ? `<ul class="quest-steps">${steps}</ul>` : '')
    + `<form class="quest-step-form" data-form="board-step" data-quest="${esc(q.id)}"><input type="text" name="step" maxlength="${BOARD_LIMITS.stepTitle}" placeholder="Add a step" autocomplete="off" aria-label="Add a step" data-focus-key="board-step-${esc(q.id)}"> <button type="submit" class="px-btn small">Add</button></form>`
    + `<label class="quest-field">Notes <textarea rows="3" maxlength="${BOARD_LIMITS.notes}" data-field="board-notes" data-quest="${esc(q.id)}" data-focus-key="board-notes-${esc(q.id)}">${esc(q.notes)}</textarea></label>`
    + `<label class="quest-field">Trains <select data-action="board-skill" data-quest="${esc(q.id)}" data-focus-key="board-skill-${esc(q.id)}">${QUEST_SKILLS.map((s) => `<option value="${s}"${s === q.skill ? ' selected' : ''}>${cap(s)}</option>`).join('')}</select></label>`
    + `<label class="quest-field">Due <input type="date" value="${esc(dateValue(q.due))}" data-field="board-due" data-quest="${esc(q.id)}" data-focus-key="board-due-${esc(q.id)}"></label>`
    + projectPick
    + `<div class="ask-actions">${q.status === 'let-go' ? '' : `<button type="button" class="link-btn" data-action="board-letgo" data-quest="${esc(q.id)}" title="It leaves the board with no mark, and can come back." data-focus-key="board-letgo-${esc(q.id)}">Let go</button> `}`
    + `<button type="button" class="link-btn" data-action="board-delete" data-quest="${esc(q.id)}" data-focus-key="board-delete-${esc(q.id)}">Delete</button></div>`
    + '</div>';
}

function questRow(q, { open = false, confirming = false, projects = [], waiting = false, now = null } = {}) {
  let buttons;
  if (q.status === 'done') buttons = [['board-reopen', 'Reopen']];
  else if (q.status === 'let-go') buttons = [['board-bringback', 'Bring back']];
  else if (q.status === 'doing') buttons = [['board-done', 'Done', true], ['board-back', 'Back']];
  else buttons = [['board-start', 'Start'], ['board-done', 'Done', true]];
  if (waiting) buttons = [['board-start', 'Start', true], ['board-keep', 'Keep'], ['board-letgo', 'Let go']];
  const steps = q.steps.length ? ` <span class="quest-count" title="Steps done">${q.stepsDone}/${q.steps.length}</span>` : '';
  const dueText = q.status === 'done' || q.status === 'let-go' ? '' : dueWords(q.due, now);
  const dueChip = dueText ? ` <span class="quest-due" data-overdue="${dueText === 'Overdue' ? 'true' : 'false'}" title="Due date">${esc(dueText)}</span>` : '';
  const project = q.projectTitle ? ` <span class="quest-project" title="Project">${esc(q.projectTitle)}</span>` : '';
  return `<li class="quest" data-quest="${esc(q.id)}" data-kind="${esc(q.kind)}" data-status="${esc(q.status)}">`
    + `<button type="button" class="quest-kind" data-action="board-kind" data-quest="${esc(q.id)}" title="${esc(COPY.kindHint[q.kind])}" data-focus-key="board-kind-${esc(q.id)}">${esc(COPY.kind[q.kind])}</button>`
    + `<button type="button" class="quest-title" data-action="board-open" data-quest="${esc(q.id)}" aria-expanded="${open ? 'true' : 'false'}" title="Details" data-focus-key="board-open-${esc(q.id)}">${esc(q.title)}</button>${dueChip}${steps}${project}`
    + `<span class="quest-actions">${buttons.map(([action, label, primary]) => `<button type="button" class="px-btn small${primary ? ' primary' : ''}" data-action="${action}" data-quest="${esc(q.id)}" data-focus-key="${action}-${esc(q.id)}">${esc(label)}</button>`).join('')}</span>`
    + (open ? detailsHtml(q, projects) : '')
    + (open && confirming ? `<p class="plot-note" data-note="delete">Delete this quest? <button type="button" class="px-btn small" data-action="board-delete-yes" data-quest="${esc(q.id)}" data-focus-key="board-delete-yes">Delete</button> <button type="button" class="link-btn" data-action="board-delete-no" data-quest="${esc(q.id)}" data-focus-key="board-delete-no">Keep</button></p>` : '')
    + '</li>';
}

const addForm = (name, form, placeholder, value) => `<form class="board-add" data-form="${form}"><input type="text" name="${name}" value="${esc(value || '')}" maxlength="${BOARD_LIMITS.title}" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}" data-focus-key="${form}-input"> `
  + `<button type="submit" class="px-btn primary" data-focus-key="${form}-add">${esc(COPY.add)}</button></form>`;

function tabsHtml(view, ui) {
  const errands = Array.isArray(ui.errands) ? ui.errands : [];
  const counts = { quests: view.counts.open, projects: view.projects.filter((p) => p.status === 'active').length, pocket: view.thoughts.length, errands: errands.filter((e) => e.state !== 'done').length };
  return '<div class="board-tabs" role="group" aria-label="Board">'
    + (errands.length ? ALL_TABS : TABS).map((tab) => `<button type="button" class="board-tab" data-action="board-tab" data-tab="${tab}" aria-pressed="${ui.tab === tab ? 'true' : 'false'}" data-focus-key="board-tab-${tab}">${cap(tab)}${counts[tab] ? ` <span class="count">${counts[tab]}</span>` : ''}</button>`).join('')
    + '</div>';
}

function questsTab(view, ui, nudge) {
  const staleIds = new Set(nudge.stale);
  const projects = view.projects.filter((p) => p.status === 'active');
  const row = (q, extra = {}) => questRow(q, { open: ui.open === q.id, confirming: ui.confirming === q.id, projects, now: ui.now, ...extra });
  const section = (name, label, list, extra = '', rowExtra = {}) => (list.length
    ? `<section class="group board-${name}" data-group="${name}"><h3>${esc(label)} <span class="count">${esc(extra || list.length)}</span></h3><ul class="quest-list">${list.map((q) => row(q, rowExtra)).join('')}</ul></section>` : '');
  const all = [...view.doing, ...view.todo];
  const waiting = all.filter((q) => staleIds.has(q.id));
  let html = addForm('quest', 'board-add', COPY.placeholder, ui.draft);
  if (ui.says) html += `<p class="plot-note board-says" data-note="paid" tabindex="-1">${esc(ui.says)}</p>`;
  if (nudge.crowded) html += `<p class="plot-note board-crowded" data-note="crowded">${esc(COPY.crowded)}</p>`;
  html += section('waiting', 'Waiting a while', waiting, '', { waiting: true });
  html += section('doing', 'Doing', view.doing.filter((q) => !staleIds.has(q.id)));
  html += section('todo', 'To do', view.todo.filter((q) => !staleIds.has(q.id)));
  html += section('done', 'Done', view.done, view.doneCount > view.done.length ? `${view.done.length} of ${view.doneCount}` : '');
  if (view.letGoCount) {
    html += `<p class="board-foot"><button type="button" class="link-btn" data-action="board-showletgo" aria-expanded="${ui.showLetGo ? 'true' : 'false'}" data-focus-key="board-showletgo">Let go (${view.letGoCount})</button></p>`;
    if (ui.showLetGo) html += section('letgo', 'Let go', view.letGo);
  }
  if (!all.length && !view.done.length && !view.letGoCount) html += `<p class="quiet-note">${esc(COPY.empty)}</p>`;
  return html;
}

function projectsTab(view, ui) {
  let html = addForm('project', 'board-project', COPY.projectPlaceholder, ui.projectDraft);
  if (!view.projects.length) return `${html}<p class="quiet-note">${esc(COPY.noProjects)}</p>`;
  html += '<ul class="quest-list">';
  for (const p of view.projects) {
    const confirm = ui.confirming === p.id;
    html += `<li class="quest project" data-project="${esc(p.id)}" data-status="${esc(p.status)}"><span class="quest-title project-title">${esc(p.title)}</span>`
      + `<span class="quest-count" title="Quests done">${p.done}/${p.total}</span>`
      + `<span class="quest-actions">${p.status === 'complete' ? '<span class="quest-project">Finished</span>'
        : `${p.ready ? `<button type="button" class="px-btn small primary" data-action="board-project-finish" data-project="${esc(p.id)}" data-focus-key="board-project-finish-${esc(p.id)}">Finish</button>` : ''}`}`
      + `<button type="button" class="link-btn" data-action="board-project-delete" data-project="${esc(p.id)}" title="Its quests stay on the board." data-focus-key="board-project-delete-${esc(p.id)}">Remove</button></span>`
      + (confirm ? `<p class="plot-note" data-note="delete">Remove this project? Its quests stay. <button type="button" class="px-btn small" data-action="board-project-delete-yes" data-project="${esc(p.id)}" data-focus-key="board-project-delete-yes">Remove</button> <button type="button" class="link-btn" data-action="board-project-delete-no" data-project="${esc(p.id)}" data-focus-key="board-project-delete-no">Keep</button></p>` : '')
      + '</li>';
  }
  return `${html}</ul>`;
}

function pocketTab(view, ui) {
  let html = addForm('thought', 'board-thought', COPY.thoughtPlaceholder, ui.thoughtDraft);
  if (!view.thoughts.length) return `${html}<p class="quiet-note">${esc(COPY.noThoughts)}</p>`;
  html += '<ul class="quest-list">';
  for (const t of view.thoughts) {
    html += `<li class="quest thought" data-thought="${esc(t.id)}"><span class="quest-title thought-text">${esc(t.text)}</span>`
      + `<span class="quest-actions"><button type="button" class="px-btn small primary" data-action="board-thought-quest" data-thought="${esc(t.id)}" data-focus-key="board-thought-quest-${esc(t.id)}">Make a quest</button>`
      + `<button type="button" class="link-btn" data-action="board-thought-remove" data-thought="${esc(t.id)}" data-focus-key="board-thought-remove-${esc(t.id)}">Remove</button></span></li>`;
  }
  return `${html}</ul>`;
}

function errandsTab(ui) {
  const errands = Array.isArray(ui.errands) ? ui.errands : [];
  if (!errands.length) return '<p class="quiet-note">None.</p>';
  return `<ul class="quest-list">${errands.map((e) => `<li class="quest errand" data-errand-person="${esc(e.personId)}" data-status="${e.state === 'done' ? 'done' : 'doing'}">`
    + `<span class="quest-title project-title">${esc(e.title)}</span><span class="quest-project">${esc(e.name)}</span>`
    + (e.state === 'done' ? '' : `<ul class="quest-steps errand-steps">${e.steps.map((s) => `<li${s.done ? ' class="done-text"' : ''}>${esc(s.text)}</li>`).join('')}</ul>`)
    + (e.state === 'ready' ? `<span class="quest-count">Go and tell ${esc(e.name.split(' ')[0])}.</span>` : '')
    + '</li>').join('')}</ul>`;
}

/** The `board` panel. view: boardView's; ui: { tab, open, confirming, draft, projectDraft, thoughtDraft, says, showLetGo, trail }; nudge: nudgeView's. */
export function buildBoard(view, ui = {}, nudge = { stale: [], crowded: false }) {
  const v = isRecord(view) ? view : boardView({});
  const tab = TABS.includes(ui.tab) || (ui.tab === 'errands' && Array.isArray(ui.errands) && ui.errands.length) ? ui.tab : 'quests';
  let html = `<div class="board-view" data-tab="${tab}">${tabsHtml(v, { ...ui, tab })}`;
  html += tab === 'projects' ? projectsTab(v, ui) : tab === 'pocket' ? pocketTab(v, ui) : tab === 'errands' ? errandsTab(ui) : questsTab(v, ui, nudge);
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
    const ui = { tab: 'quests', open: null, confirming: null, draft: '', projectDraft: '', thoughtDraft: '', says: '', showLetGo: false };
    const economy = () => shell.content?.()?.economy ?? null;
    const rates = () => shell.content?.()?.xp ?? null;
    const panelEl = doc?.getElementById?.('panel');
    const open = () => [PANEL, HALL].includes(panelEl?.dataset?.place);
    const render = () => buildBoard(boardView(shell.state), { ...ui, now: shell.now(), errands: errandList(shell.state, shell.content?.() ?? null, shell.now()), trail: Boolean(trailView(shell.state, shell.content?.()?.trails ?? null, shell.now()).trail) }, nudgeView(shell.state, shell.now()));
    const refresh = (opts = {}) => { if (open()) shell.refreshPanel(opts); };
    const commit = (next, focus) => { if (next !== shell.state) shell.set(next, { save: 300 }); refresh({ focus }); };
    const idOf = (el, attr, rule) => { const value = el?.getAttribute?.(attr) || ''; return rule.test(value) ? value : ''; };
    const questId = (el) => idOf(el, 'data-quest', QUEST_ID);

    const finish = (qid) => {
      const r = finishQuest(shell.state, qid, shell.now(), { economy: economy(), rates: rates() });
      ui.says = paidLine(r.paid);
      if (ui.says) shell.log?.({ tab: 'milo', text: `Quest done · ${ui.says}`, at: shell.now(), detail: null, action: null });
      commit(r.state, null);
    };

    const action = (button) => {
      const name = button?.getAttribute?.('data-action') || '';
      if (!name.startsWith('board-')) return false;
      const now = shell.now();
      if (name === 'board-trail') { shell.openPanel?.('trail'); return true; }
      if (name === 'board-tab') {
        const tab = button.getAttribute('data-tab');
        if (ALL_TABS.includes(tab)) { ui.tab = tab; ui.open = null; ui.confirming = null; refresh({ focus: `board-tab-${tab}` }); }
        return true;
      }
      if (name === 'board-showletgo') { ui.showLetGo = !ui.showLetGo; refresh({ focus: 'board-showletgo' }); return true; }
      // Projects and thoughts
      const pid = idOf(button, 'data-project', PROJECT_ID);
      if (name.startsWith('board-project-') && pid) {
        if (name === 'board-project-finish') commit(completeProject(shell.state, pid, now), 'board-tab-projects');
        else if (name === 'board-project-delete') { ui.confirming = pid; refresh({ focus: 'board-project-delete-no' }); }
        else if (name === 'board-project-delete-no') { ui.confirming = null; refresh({ focus: `board-project-delete-${pid}` }); }
        else if (name === 'board-project-delete-yes') { ui.confirming = null; commit(deleteProject(shell.state, pid), 'board-project-input'); }
        else return false;
        return true;
      }
      const tid = idOf(button, 'data-thought', THOUGHT_ID);
      if (name.startsWith('board-thought-') && tid) {
        if (name === 'board-thought-quest') {
          const r = thoughtToQuest(shell.state, tid, now);
          ui.tab = 'quests';
          commit(r.state, 'board-add-input');
        } else if (name === 'board-thought-remove') commit(removeThought(shell.state, tid), 'board-thought-input');
        else return false;
        return true;
      }
      // Quests
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
        case 'board-start': commit(setStatus(shell.state, qid, 'doing', now), `board-done-${qid}`); break;
        case 'board-back': commit(setStatus(shell.state, qid, 'todo', now), `board-start-${qid}`); break;
        case 'board-reopen': commit(setStatus(shell.state, qid, 'todo', now), `board-open-${qid}`); break;
        case 'board-keep': commit(keepQuest(shell.state, qid, now), 'board-add-input'); break;
        case 'board-letgo': ui.open = null; commit(letGo(shell.state, qid, now), 'board-add-input'); break;
        case 'board-bringback': commit(bringBack(shell.state, qid, now), `board-open-${qid}`); break;
        case 'board-done': finish(qid); break;
        case 'board-kind': commit(updateQuest(shell.state, qid, { kind: quest.kind === 'main' ? 'side' : 'main' }), `board-kind-${qid}`); break;
        case 'board-open': ui.open = ui.open === qid ? null : qid; ui.confirming = null; refresh({ focus: `board-open-${qid}` }); break;
        case 'board-delete': ui.confirming = qid; refresh({ focus: 'board-delete-no' }); break;
        case 'board-delete-no': ui.confirming = null; refresh({ focus: `board-delete-${qid}` }); break;
        case 'board-delete-yes': ui.confirming = null; ui.open = null; commit(deleteQuest(shell.state, qid), 'board-add-input'); break;
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
    const draftKey = { quest: 'draft', project: 'projectDraft', thought: 'thoughtDraft' };
    const onInput = (event) => {
      if (!open()) return;
      const key = draftKey[event.target?.name];
      if (key) ui[key] = event.target.value;
    };
    const onSubmit = (event) => {
      if (!open()) return;
      const form = event.target?.closest?.('[data-form^="board-"]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      const kind = form.getAttribute('data-form');
      const now = shell.now();
      if (kind === 'board-add') {
        const r = addQuest(shell.state, form.elements.quest?.value ?? ui.draft, now);
        ui.draft = ''; ui.says = '';
        commit(r.state, 'board-add-input');
      } else if (kind === 'board-project') {
        const next = addProject(shell.state, form.elements.project?.value ?? ui.projectDraft, now);
        ui.projectDraft = '';
        commit(next, 'board-project-input');
      } else if (kind === 'board-thought') {
        const next = addThought(shell.state, form.elements.thought?.value ?? ui.thoughtDraft, now);
        ui.thoughtDraft = '';
        commit(next, 'board-thought-input');
      } else if (kind === 'board-step') {
        const qid = questId(form);
        const input = form.elements.step;
        if (qid && input) commit(addStep(shell.state, qid, input.value), `board-step-${qid}`);
      }
    };
    const onChange = (event) => {
      if (!open()) return;
      const el = event.target;
      const qid = questId(el);
      if (!qid) return;
      if (el.getAttribute('data-field') === 'board-notes') {
        const next = updateQuest(shell.state, qid, { notes: el.value });
        if (next !== shell.state) shell.set(next, { save: 600 });
      } else if (el.getAttribute('data-field') === 'board-due') {
        commit(updateQuest(shell.state, qid, { due: dueFromDate(el.value) }), `board-due-${qid}`);
      } else if (el.getAttribute('data-action') === 'board-skill') {
        commit(updateQuest(shell.state, qid, { skill: el.value }), `board-skill-${qid}`);
      } else if (el.getAttribute('data-action') === 'board-project-pick') {
        commit(updateQuest(shell.state, qid, { projectId: el.value || null }), `board-project-${qid}`);
      }
    };
    panelEl?.addEventListener('input', onInput);
    panelEl?.addEventListener('submit', onSubmit, true);
    panelEl?.addEventListener('change', onChange);

    const spec = (title) => ({ title: () => title, render: () => render(), exists: () => true, action: (button) => action(button) });
    for (const [panelId, title] of [[PANEL, 'The Board'], [HALL, 'Town hall']]) {
      const off = shell.registerPanel(panelId, spec(title));
      if (typeof off === 'function') offs.push(off);
    }
    // Only a change to the board redraws the panel, so a crew snapshot never takes the cursor from the box.
    let lastBoard = shell.state?.board;
    let lastPeople = shell.state?.people;
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        const board = shell.state?.board;
        if (board === lastBoard && shell.state?.people === lastPeople) return;
        lastBoard = board;
        lastPeople = shell.state?.people;
        if (open()) shell.refreshPanel({ passive: true });
      }));
    }
    return {
      dispose() {
        for (const fn of offs) if (typeof fn === 'function') fn();
        panelEl?.removeEventListener('input', onInput);
        panelEl?.removeEventListener('submit', onSubmit, true);
        panelEl?.removeEventListener('change', onChange);
      },
      refresh() { if (open()) shell.refreshPanel({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] board mount', err);
    return NOOP;
  }
}
