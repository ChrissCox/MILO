// Commissions (PLAN.md Phase 6): the `commissions` panel, opened from the HUD's Crew tab. Who of the
// crew is set up, who is out, what has come back to be read, the drafts, and what went before.
// Chris writes the brief, picks the folder and the ward, and presses Send himself, every time.
// The rules are in src/commissions.js; the crew is run by the main process (src/commission/runner.js).
import {
  view as commissionsView, draftForBuilding, draftFree, updateDraft, remove, send, comeBack, accept, again, running, setCheck, recordCheck,
  CREW, CREW_WORDS, WARDS, WARD_WORDS, WARD_HINTS, LIMITS, wardWrites,
} from '../commissions.js';
import { payForCommission, paidWords } from '../commission/pay.js';
import { manaView } from './hud.js';
import { esc } from './panels.js';

export const id = 'commissions';
export const PANEL = 'commissions';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const COMMISSION_ID = /^c\d{1,9}$/;
const PLOT_ID = /^plot-[a-z]{2,20}$/;

export const COPY = Object.freeze({
  title: 'The crew',
  placeholder: 'What do you want done?',
  add: 'Draft it',
  empty: 'Nobody is out, and nothing is drafted.',
  send: 'Send',
  sendSure: 'Send them',
  notYet: 'Not yet',
  callBack: 'Call back',
  folder: 'Choose folder',
  noFolder: 'No folder yet',
  remove: 'Remove',
  again: 'Again',
  done: 'Done',
  works: 'It works',
  notWorks: 'Not yet',
  worksHint: 'You’ve seen it do what the level asks. The building goes up a level.',
  notWorksHint: 'Keep what they did. The level stays unproven.',
  out: 'Out now',
  toRead: 'Back, to read',
  drafts: 'Drafts',
  earlier: 'Earlier',
  ready: 'ready',
  missing: 'not set up',
  shares: (who) => `Sends your brief, and what they read in this folder, to ${who}.`,
  changeSure: (folder) => `They may add and edit files in ${folder}. Nothing else.`,
  check: 'Check',
  checkPlaceholder: 'npm test',
  checkHint: 'A command that shows the building works, run in its folder as you would in a terminal. Only you can set it.',
  runCheck: 'Run the check',
  checking: 'Checking.',
  passed: 'The check passed.',
  failedCheck: 'The check failed.',
  putAway: 'Put away',
  needsCheck: 'Run the check first. It has to pass.',
  lowMana: 'Codex is nearly out of its allowance.',
});
/** Below this much of its allowance left, a Codex draft says so before it is sent. */
export const LOW_MANA = 10;

const STATUS_WORDS = Object.freeze({ failed: 'Didn’t finish', stopped: 'Called back', done: 'Read' });
const minutes = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'under a minute' : m === 1 ? '1 minute' : `${m} minutes`; };
const options = (list, words, chosen) => list.map((v) => `<option value="${v}"${v === chosen ? ' selected' : ''}>${esc(words[v])}</option>`).join('');
const paragraphs = (text) => String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p class="commission-text">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const filesHtml = (files) => (Array.isArray(files) && files.length ? `<ul class="commission-files">${files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '');
const meta = (c) => `<span class="commission-meta">${esc(c.whoWord)} · ${esc(c.wardWord)}</span>`;

function draftHtml(c, ui) {
  const open = ui.open === c.id;
  let html = `<li class="commission" data-commission="${esc(c.id)}" data-status="draft"><button type="button" class="commission-head" data-action="commission-open" data-commission="${esc(c.id)}" data-focus-key="commission-open-${esc(c.id)}" aria-expanded="${open}">${esc(c.title)} ${meta(c)}</button>`;
  if (!open) return `${html}</li>`;
  html += '<div class="commission-body">'
    + `<label class="quest-field">Brief <textarea rows="5" maxlength="${LIMITS.brief}" data-field="commission-brief" data-commission="${esc(c.id)}" data-focus-key="commission-brief-${esc(c.id)}">${esc(c.brief)}</textarea></label>`
    + `<label class="quest-field">Who <select data-field="commission-who" data-commission="${esc(c.id)}" data-focus-key="commission-who-${esc(c.id)}">${options(CREW, CREW_WORDS, c.who)}</select></label>`
    + `<label class="quest-field" title="${esc(WARD_HINTS[c.ward])}">Ward <select data-field="commission-ward" data-commission="${esc(c.id)}" data-focus-key="commission-ward-${esc(c.id)}">${options(WARDS, WARD_WORDS, c.ward)}</select></label>`
    + `<p class="commission-ward-hint">${esc(WARD_HINTS[c.ward])}</p>`
    + (c.source.kind === 'building' ? `<label class="quest-field" title="${esc(COPY.checkHint)}">${esc(COPY.check)} <input type="text" maxlength="${LIMITS.check}" value="${esc(c.checkCmd || '')}" placeholder="${esc(COPY.checkPlaceholder)}" autocomplete="off" data-field="commission-check" data-commission="${esc(c.id)}" data-focus-key="commission-check-${esc(c.id)}"></label>` : '')
    + `<p class="commission-folder" data-folder="${c.folder ? 'set' : 'none'}"><span class="commission-path">${esc(c.folder || COPY.noFolder)}</span> <button type="button" class="link-btn" data-action="commission-folder" data-commission="${esc(c.id)}" data-focus-key="commission-folder-${esc(c.id)}">${esc(COPY.folder)}</button></p>`;
  if (ui.note && ui.noteFor === c.id) html += `<p class="plot-note" data-note="commission">${esc(ui.note)}</p>`;
  if (ui.confirming === c.id) {
    html += `<div class="confirm"><p class="confirm-body">${esc(COPY.changeSure(c.folder))}</p><p class="shares-note">${esc(COPY.shares(c.whoWord))}</p>`
      + `<div class="ask-actions"><button type="button" class="px-btn primary" data-action="commission-send-yes" data-commission="${esc(c.id)}" data-focus-key="commission-send-yes">${esc(COPY.sendSure)}</button>`
      + `<button type="button" class="px-btn" data-action="commission-send-no" data-commission="${esc(c.id)}" data-focus-key="commission-send-no">${esc(COPY.notYet)}</button></div></div>`;
  } else {
    if (c.canSend && c.who === 'codex' && ui.lowMana) html += `<p class="plot-note" data-note="mana">${esc(COPY.lowMana)}</p>`;
    if (c.canSend) html += `<p class="shares-note">${esc(COPY.shares(c.whoWord))}</p>`;
    html += `<div class="ask-actions"><button type="button" class="px-btn primary" data-action="commission-send" data-commission="${esc(c.id)}" data-focus-key="commission-send-${esc(c.id)}"${c.canSend ? '' : ` disabled title="${esc(c.problem)}"`}>${esc(COPY.send)}</button>`
      + `<button type="button" class="link-btn" data-action="commission-remove" data-commission="${esc(c.id)}" data-focus-key="commission-remove-${esc(c.id)}">${esc(COPY.remove)}</button></div>`;
    if (!c.canSend && c.problem) html += `<p class="quiet-note commission-problem">${esc(c.problem)}</p>`;
  }
  return `${html}</div></li>`;
}

function checkHtml(c, ui) {
  if (!c.levelAtStake || !c.checkCmd) return '';
  const last = c.check ? (c.check.ok ? COPY.passed : COPY.failedCheck) : '';
  const tail = c.check && c.lastCheck?.tail ? `<details class="commission-tail"><summary>What it printed</summary><pre>${esc(c.lastCheck.tail)}</pre></details>` : '';
  return `<div class="commission-check" data-check="${c.check ? (c.check.ok ? 'passed' : 'failed') : 'none'}"><p class="commission-meta">${esc(COPY.check)}: <code>${esc(c.checkCmd)}</code>${last ? ` · ${esc(last)}` : ''}</p>${tail}`
    + `<button type="button" class="px-btn small" data-action="commission-run-check" data-commission="${esc(c.id)}" data-focus-key="commission-run-check-${esc(c.id)}"${ui.checking ? ' disabled' : ''}>${esc(ui.checking === c.id ? COPY.checking : COPY.runCheck)}</button></div>`;
}

function reviewHtml(c, ui = {}) {
  let html = `<li class="commission" data-commission="${esc(c.id)}" data-status="review"><p class="commission-title"><strong>${esc(c.title)}</strong> ${meta(c)}</p>`
    + `<div class="commission-result">${paragraphs(c.result?.summary) || '<p class="quiet-note">They said nothing.</p>'}${filesHtml(c.result?.files)}</div>${checkHtml(c, ui)}<div class="ask-actions">`;
  if (c.levelAtStake) {
    html += `<button type="button" class="px-btn primary" data-action="commission-proved" data-commission="${esc(c.id)}" data-focus-key="commission-proved-${esc(c.id)}" title="${esc(c.canProve ? COPY.worksHint : COPY.needsCheck)}"${c.canProve ? '' : ' disabled'}>${esc(COPY.works)}</button>`
      + `<button type="button" class="px-btn" data-action="commission-accept" data-commission="${esc(c.id)}" data-focus-key="commission-accept-${esc(c.id)}" title="${esc(COPY.notWorksHint)}">${esc(COPY.notWorks)}</button>`;
  } else {
    html += `<button type="button" class="px-btn primary" data-action="commission-accept" data-commission="${esc(c.id)}" data-focus-key="commission-accept-${esc(c.id)}">${esc(COPY.done)}</button>`;
  }
  return `${html}<button type="button" class="link-btn" data-action="commission-again" data-commission="${esc(c.id)}" data-focus-key="commission-again-${esc(c.id)}">${esc(COPY.again)}</button></div></li>`;
}

function earlierHtml(c) {
  const said = c.status === 'done' ? (c.result?.summary || '').split('\n')[0] : c.result?.why || '';
  return `<li class="commission" data-commission="${esc(c.id)}" data-status="${esc(c.status)}"><p class="commission-title">${esc(c.title)} <span class="commission-meta">${esc(STATUS_WORDS[c.status] || '')}${c.proved ? ' · proven' : ''}</span></p>`
    + (said ? `<p class="quiet-note commission-said">${esc(said.slice(0, 200))}</p>` : '')
    + `<div class="ask-actions">${c.status === 'failed' || c.status === 'stopped' ? `<button type="button" class="link-btn" data-action="commission-accept" data-commission="${esc(c.id)}" data-focus-key="commission-accept-${esc(c.id)}">${esc(COPY.putAway)}</button>` : ''}<button type="button" class="link-btn" data-action="commission-again" data-commission="${esc(c.id)}" data-focus-key="commission-again-${esc(c.id)}">${esc(COPY.again)}</button>`
    + `<button type="button" class="link-btn" data-action="commission-remove" data-commission="${esc(c.id)}" data-focus-key="commission-remove-${esc(c.id)}">${esc(COPY.remove)}</button></div></li>`;
}

/**
 * The `commissions` panel. v: commissions.view's; ui: { open, confirming, note, noteFor, draft };
 * env: { crew: { claude, codex } }; now: ms.
 */
export function buildCommissions(v, ui = {}, env = {}, now = 0) {
  const rows = Array.isArray(v?.rows) ? v.rows : [];
  const crew = isRecord(env.crew) ? env.crew : {};
  // Mana is Codex's real allowance (the HUD's orb reads the same).
  const mana = isRecord(env.mana) && Number.isFinite(env.mana.pct) ? env.mana : null;
  let html = '<div class="commissions-view">';
  html += `<p class="commission-crew">${CREW.map((who) => `<span class="commission-who" data-who="${who}" data-ready="${crew[who] ? 'true' : 'false'}"${who === 'codex' && mana ? ` title="${esc(mana.line)}"` : ''}>${esc(CREW_WORDS[who])} <span class="commission-meta">${crew[who] ? COPY.ready : COPY.missing}${who === 'codex' && mana ? ` · ${esc(mana.text)} left` : ''}</span></span>`).join('')}</p>`;
  ui = { ...ui, lowMana: Boolean(mana && mana.pct < LOW_MANA) };
  const out = rows.find((c) => c.status === 'running');
  if (out) {
    html += `<section class="group" data-group="out"><h3>${esc(COPY.out)}</h3><div class="commission" data-commission="${esc(out.id)}" data-status="running"><p class="commission-title"><strong>${esc(out.title)}</strong> ${meta(out)}</p>`
      + `<p class="quiet-note" data-note="elapsed">Out for ${esc(minutes(now - (out.sentAt || now)))}.</p>`
      + `<div class="ask-actions"><button type="button" class="px-btn" data-action="commission-cancel" data-commission="${esc(out.id)}" data-focus-key="commission-cancel">${esc(COPY.callBack)}</button></div></div></section>`;
  }
  const group = (key, title, list, each) => (list.length ? `<section class="group" data-group="${key}"><h3>${esc(title)}</h3><ul class="commission-list">${list.map(each).join('')}</ul></section>` : '');
  html += group('review', COPY.toRead, rows.filter((c) => c.status === 'review'), (c) => reviewHtml(c, ui));
  html += `<form class="board-add" data-form="commission-add"><input type="text" name="commission" value="${esc(ui.draft || '')}" maxlength="${LIMITS.title}" placeholder="${esc(COPY.placeholder)}" autocomplete="off" aria-label="${esc(COPY.placeholder)}" data-focus-key="commission-add-input"><button type="submit" class="px-btn" data-focus-key="commission-add">${esc(COPY.add)}</button></form>`;
  const buildable = Array.isArray(v?.buildable) ? v.buildable : [];
  if (buildable.length) {
    html += `<p class="commission-buildable">${buildable.map((b) => `<button type="button" class="link-btn" data-action="commission-building" data-plot="${esc(b.plotId)}" data-focus-key="commission-building-${esc(b.plotId)}">${esc(b.name)}, level ${esc(b.level)}</button>`).join(' ')}</p>`;
  }
  html += group('drafts', COPY.drafts, rows.filter((c) => c.status === 'draft' || c.status === 'waiting'), (c) => draftHtml(c, ui));
  html += group('earlier', COPY.earlier, rows.filter((c) => ['done', 'failed', 'stopped'].includes(c.status)), earlierHtml);
  if (!rows.length) html += `<p class="quiet-note">${esc(COPY.empty)}</p>`;
  return `${html}</div>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {}, draftFor() {} });

/** Registers the `commissions` panel and runs what Chris sends through the main process. */
export function mount(shell, { doc = globalThis.document } = {}) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const offs = [];
    const api = shell.bridge?.commissions ?? null;
    const ui = { open: null, confirming: null, note: '', noteFor: null, draft: '', checking: null };
    const economy = () => shell.content?.()?.economy ?? null;
    const rates = () => shell.content?.()?.xp ?? null;
    let env = { home: '', own: '', crew: { claude: false, codex: false } };
    const panelEl = doc?.getElementById?.('panel');
    const open = () => panelEl?.dataset?.place === PANEL;
    const refresh = (opts = {}) => { if (open()) shell.refreshPanel(opts); };
    const commit = (next, focus) => { if (next !== shell.state) shell.set(next, { save: 300 }); refresh({ focus }); };
    const mana = () => { try { return manaView(shell.snapshot?.() ?? null, shell.now()); } catch { return null; } };
    const render = () => buildCommissions(commissionsView(shell.state, env), ui, { ...env, mana: mana() }, shell.now());
    const idOf = (el) => { const value = el?.getAttribute?.('data-commission') || ''; return COMMISSION_ID.test(value) ? value : ''; };
    const find = (cid) => (shell.state?.commissions?.list || []).find((c) => c.id === cid) || null;
    const note = (cid, text) => { ui.note = text; ui.noteFor = cid; };
    const log = (text) => shell.log?.({ tab: 'crew', text, at: shell.now(), detail: null, action: null });
    const loadEnv = () => { if (api?.env) Promise.resolve(api.env()).then((e) => { if (isRecord(e)) { env = { ...env, ...e }; refresh({ passive: true }); } }).catch(() => {}); };
    loadEnv();

    async function go(cid) {
      const r = send(shell.state, cid, shell.now(), env);
      if (!r.ok) { note(cid, r.why); refresh({}); return; }
      const c = r.state.commissions.list.find((x) => x.id === cid);
      ui.confirming = null; ui.open = null; note(null, '');
      shell.set(r.state, { save: 150 });
      log(`${CREW_WORDS[c.who]} set out: ${c.title}.`);
      refresh({ focus: 'commission-cancel' });
      let outcome;
      try {
        outcome = api?.run ? await api.run({ title: c.title, brief: c.brief, folder: c.folder, who: c.who, ward: c.ward }) : { ok: false, why: 'MILO can’t send the crew just now.' };
      } catch (error) {
        console.error('[MILO] a commission', error);
        outcome = { ok: false, why: 'MILO lost track of them.' };
      }
      shell.set(comeBack(shell.state, cid, outcome, shell.now()), { save: 150 });
      const back = find(cid);
      if (back?.status === 'review') {
        shell.bubble?.({ kind: 'note', title: `${CREW_WORDS[c.who]} is back`, lines: [c.title], duration: 9000, actions: [{ id: 'later', label: 'Okay' }] });
      } else if (back) log(`${CREW_WORDS[c.who]} came back early: ${back.result?.why || c.title}`);
      refresh({ focus: back?.status === 'review' ? `commission-accept-${cid}` : 'commission-add-input' });
    }

    const action = (button) => {
      const name = button?.getAttribute?.('data-action') || '';
      if (!name.startsWith('commission-')) return false;
      const now = shell.now();
      if (name === 'commission-building') {
        const plotId = button.getAttribute('data-plot') || '';
        if (PLOT_ID.test(plotId)) { const r = draftForBuilding(shell.state, plotId, now); if (r.id) { ui.open = r.id; commit(r.state, `commission-brief-${r.id}`); } }
        return true;
      }
      const cid = idOf(button);
      const c = cid ? find(cid) : null;
      if (!c) return true;
      switch (name) {
        case 'commission-open': ui.open = ui.open === cid ? null : cid; ui.confirming = null; note(null, ''); refresh({ focus: `commission-open-${cid}` }); break;
        case 'commission-remove': if (ui.open === cid) ui.open = null; commit(remove(shell.state, cid), 'commission-add-input'); break;
        case 'commission-folder': {
          if (!api?.pickFolder) { note(cid, 'MILO can’t open the folder picker here.'); refresh({}); break; }
          Promise.resolve(api.pickFolder()).then((r) => {
            if (r?.ok && typeof r.folder === 'string') { note(null, ''); commit(updateDraft(shell.state, cid, { folder: r.folder }), `commission-send-${cid}`); }
            else if (r?.why) { note(cid, r.why); refresh({}); }
          }).catch(() => {});
          break;
        }
        case 'commission-send':
          // A commission that may change files asks once more, with the folder named.
          if (wardWrites(c.ward)) { ui.confirming = cid; refresh({ focus: 'commission-send-no' }); } else go(cid);
          break;
        case 'commission-send-yes': go(cid); break;
        case 'commission-send-no': ui.confirming = null; refresh({ focus: `commission-send-${cid}` }); break;
        case 'commission-cancel': if (api?.cancel) Promise.resolve(api.cancel()).catch(() => {}); break;
        case 'commission-accept':
        case 'commission-proved': {
          const r = accept(shell.state, cid, now, { proved: name === 'commission-proved' });
          if (!r.ok) { refresh({}); break; }
          // A commission that came back and was read pays once; one that didn't finish pays nothing.
          const paid = c.status === 'review' ? payForCommission(r.state, { ...c, status: 'done' }, now, { economy: economy(), rates: rates(), proved: Boolean(r.levelled) }) : { state: r.state, paid: null };
          const words = paidWords(paid.paid);
          if (r.levelled) log(`A building reached level ${r.levelled.level}.${words ? ` ${words}` : ''}`);
          else if (words) log(`Commission read · ${words}`);
          commit(paid.state, 'commission-add-input');
          break;
        }
        case 'commission-run-check': {
          if (c.source?.kind !== 'building' || ui.checking || !api?.check) break;
          const command = shell.state?.commissions?.checks?.[c.source.plotId] || '';
          ui.checking = cid;
          refresh({ focus: `commission-run-check-${cid}` });
          Promise.resolve(api.check(c.folder, command)).then((r) => {
            ui.checking = null;
            if (r && typeof r.ok === 'boolean' && !r.why) {
              shell.set(recordCheck(shell.state, c.source.plotId, r, shell.now(), cid), { save: 300 });
              log(r.ok ? `The check for ${c.title} passed.` : `The check for ${c.title} failed.`);
            } else { note(cid, r?.why || 'MILO couldn’t run the check.'); }
            refresh({ focus: `commission-run-check-${cid}` });
          }).catch(() => { ui.checking = null; refresh({}); });
          break;
        }
        case 'commission-again': { const r = again(shell.state, cid, now); if (r.id) { ui.open = r.id; commit(r.state, `commission-send-${r.id}`); } break; }
        default: return false;
      }
      return true;
    };

    const onSubmit = (event) => {
      if (!open()) return;
      const form = event.target?.closest?.('[data-form="commission-add"]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      const r = draftFree(shell.state, form.elements.commission?.value ?? ui.draft, shell.now());
      ui.draft = '';
      if (r.id) { ui.open = r.id; commit(r.state, `commission-brief-${r.id}`); }
    };
    const onInput = (event) => {
      if (!open()) return;
      const el = event.target;
      if (el?.name === 'commission') { ui.draft = el.value; return; }
      const cid = idOf(el);
      if (cid && el.getAttribute('data-field') === 'commission-check') {
        const c = find(cid);
        if (c?.source?.kind === 'building') { const next = setCheck(shell.state, c.source.plotId, el.value); if (next !== shell.state) shell.set(next, { save: 600 }); }
        return;
      }
      if (cid && el.getAttribute('data-field') === 'commission-brief') {
        const next = updateDraft(shell.state, cid, { brief: el.value });
        if (next !== shell.state) shell.set(next, { save: 600 });
      }
    };
    const onChange = (event) => {
      if (!open()) return;
      const el = event.target;
      const cid = idOf(el);
      const field = el?.getAttribute?.('data-field') || '';
      if (!cid) return;
      if (field === 'commission-who') commit(updateDraft(shell.state, cid, { who: el.value }), `commission-who-${cid}`);
      else if (field === 'commission-ward') { ui.confirming = null; commit(updateDraft(shell.state, cid, { ward: el.value }), `commission-ward-${cid}`); }
    };
    panelEl?.addEventListener('submit', onSubmit, true);
    panelEl?.addEventListener('input', onInput);
    panelEl?.addEventListener('change', onChange);
    offs.push(() => { panelEl?.removeEventListener('submit', onSubmit, true); panelEl?.removeEventListener('input', onInput); panelEl?.removeEventListener('change', onChange); });

    const off = shell.registerPanel(PANEL, { title: () => COPY.title, render: () => render(), exists: () => true, action: (b) => action(b) });
    if (typeof off === 'function') offs.push(off);
    let last = shell.state?.commissions;
    let lastMinute = -1;
    if (typeof shell.on === 'function') {
      // The panel follows the list, never the keystrokes in a brief (those don't change what's shown).
      offs.push(shell.on('state', () => {
        const now = shell.state?.commissions;
        if (now === last) return;
        const moved = !last || now?.list?.length !== last?.list?.length || now?.checked !== last?.checked || (now?.list || []).some((c, i) => c.status !== last.list[i]?.status || c.folder !== last.list[i]?.folder || c.who !== last.list[i]?.who || c.ward !== last.list[i]?.ward || c.check !== last.list[i]?.check);
        last = now;
        if (moved && open()) shell.refreshPanel({ passive: true });
      }));
      // While someone is out, the time they've been gone moves on by the minute.
      offs.push(shell.on('second', () => {
        const out = running(shell.state);
        if (!out || !open()) return;
        const minute = Math.floor((shell.now() - (out.sentAt || 0)) / 60000);
        if (minute !== lastMinute) { lastMinute = minute; shell.refreshPanel({ passive: true }); }
      }));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (open()) shell.refreshPanel({ passive: true }); },
      /** Opens the panel on a draft for a building's next level (from the building's own panel). */
      draftFor(plotId) {
        if (!PLOT_ID.test(String(plotId))) return false;
        const r = draftForBuilding(shell.state, plotId, shell.now());
        if (!r.id) return false;
        ui.open = r.id;
        shell.set(r.state, { save: 300 });
        shell.openPanel?.(PANEL, { focus: `commission-brief-${r.id}` });
        return true;
      },
    };
  } catch (err) {
    console.error('[MILO] commissions mount', err);
    return NOOP;
  }
}
