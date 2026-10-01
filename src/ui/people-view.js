// People (PLAN.md Phase 5.1; LORE.md §9.1): the `person:<id>` panel. A portrait, what they say, your
// ways of answering (each tagged with the approach it is), the quiet notes ("Wendell approves",
// "Wendell will remember that"), Come to camp once they are Fond, and the journal page of what you
// have learned of them. All the rules are in src/people.js.
import {
  personOf, personView, choose, meet, inviteToCamp, bedsFor, residentsOf, knownWords, allPeople,
} from '../people.js';
import { registerLook } from '../world/sprites-party.js';
import { portraitCanvas } from './dialogue.js';
import { esc } from './panels.js';

export const id = 'people';
export const PREFIX = 'person:';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const NPC_ID = /^[a-z][a-z0-9-]{1,39}$/;

export const COPY = Object.freeze({
  go: 'Go on',
  camp: 'Come to camp',
  askCamp: 'Ask about the camp',
  journal: 'What I know',
  memories: 'They remember',
  nothing: 'Nothing yet.',
});

const lookOf = (personId) => ({ kind: 'rig', rig: 'coat', who: personId, likeness: null });
const NOTE_ICON = Object.freeze({ approves: '+', frowns: '−', remembers: '·', shrugs: '·', levelled: '+' });

/** The journal page: what has been learned (likes, what puts them off, what slides off) and what they remember. */
export function journalHtml(view) {
  const words = knownWords(view);
  const rows = [];
  if (words.likes.length) rows.push(`<li data-known="likes"><strong>Warms to</strong> ${esc(words.likes.join(', '))}</li>`);
  if (words.dislikes.length) rows.push(`<li data-known="dislikes"><strong>Put off by</strong> ${esc(words.dislikes.join(', '))}</li>`);
  if (words.resists.length) rows.push(`<li data-known="resists"><strong>Unmoved by</strong> ${esc(words.resists.join(', '))}</li>`);
  let html = `<section class="group person-journal" data-group="journal"><h3>${esc(COPY.journal)}</h3>`;
  html += rows.length ? `<ul class="person-known">${rows.join('')}</ul>` : `<p class="quiet-note">${esc(COPY.nothing)}</p>`;
  if (view.memories.length) {
    html += `<h4 class="person-sub">${esc(COPY.memories)}</h4><ul class="person-memories">${view.memories.map((m) => `<li data-memory="${esc(m.id)}">${esc(m.text)}</li>`).join('')}</ul>`;
  }
  return `${html}</section>`;
}

const lines = (list, cls = 'person-line') => (Array.isArray(list) ? list : []).map((l) => `<p class="${cls}">${esc(l)}</p>`).join('');

/** The `person:<id>` panel. ui: { reply: { lines, notes } | null, camp: { lines } | null }. */
export function buildPerson(view, ui = {}) {
  if (!view) return '<p class="quiet-note">There’s nobody here.</p>';
  let html = `<div class="person-view" data-person="${esc(view.id)}" data-level="${esc(view.level)}">`;
  html += `<header class="person-head">${portraitCanvas(lookOf(view.id), { label: view.name, size: 56 })}`
    + `<div class="person-who"><p class="person-title">${esc(view.title)}</p><span class="person-level" title="How they feel about you." data-level="${esc(view.level)}">${esc(view.levelWord)}</span></div></header>`;
  html += '<section class="group person-talk" data-group="talk">';
  if (ui.camp) {
    html += lines(ui.camp.lines);
    html += `<p class="person-actions"><button type="button" class="px-btn" data-action="person-go" data-person="${esc(view.id)}" data-focus-key="person-go">${esc(COPY.go)}</button></p>`;
  } else if (ui.reply) {
    html += lines(ui.reply.lines);
    html += (ui.reply.notes || []).map((n) => `<p class="person-note" data-note="${esc(n.kind)}"><span class="person-note-mark" aria-hidden="true">${esc(NOTE_ICON[n.kind] || '·')}</span> ${esc(n.text)}</p>`).join('');
    html += `<p class="person-actions"><button type="button" class="px-btn primary" data-action="person-next" data-person="${esc(view.id)}" data-focus-key="person-next">${esc(COPY.go)}</button></p>`;
  } else if (!view.met) {
    html += lines(view.greeting);
    html += `<p class="person-actions"><button type="button" class="px-btn primary" data-action="person-meet" data-person="${esc(view.id)}" data-focus-key="person-meet">${esc(COPY.go)}</button></p>`;
  } else if (view.topic) {
    html += lines(view.greeting.slice(0, 1), 'person-line person-hello');
    html += lines(view.topic.say);
    html += `<ul class="person-options" aria-label="Your answer">${view.topic.options.map((o) => `<li><button type="button" class="person-option" data-action="person-pick" data-person="${esc(view.id)}" data-topic="${esc(view.topic.id)}" data-index="${o.index}" data-approach="${esc(o.approach)}" data-focus-key="person-pick-${o.index}">`
      + `${esc(o.text)}</button></li>`).join('')}</ul>`;
  } else {
    html += lines(view.greeting.slice(0, 1), 'person-line person-hello');
    html += lines(view.tired || view.finished);
  }
  html += '</section>';
  if (view.met && !ui.reply && !ui.camp) {
    if (view.camp.state === 'in') html += '<p class="plot-note person-camp" data-note="camp">They live at your camp.</p>';
    else if (view.camp.state === 'ask' || view.camp.state === 'full') html += `<p class="person-actions person-camp"><button type="button" class="px-btn primary" data-action="person-camp" data-person="${esc(view.id)}" data-focus-key="person-camp">${esc(COPY.camp)}</button></p>`;
    else html += `<p class="person-actions person-camp"><button type="button" class="link-btn" data-action="person-camp" data-person="${esc(view.id)}" data-focus-key="person-camp">${esc(COPY.askCamp)}</button></p>`;
  }
  if (view.met) html += journalHtml(view);
  return `${html}</div>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Registers `person:<id>`; teaches the coat rig everyone's colours; follows the people while it's open. */
export function mount(shell) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const offs = [];
    const content = () => shell.content?.() ?? null;
    for (const p of allPeople(content())) if (isRecord(p.dye)) registerLook('coat', p.id, p.dye);
    const ui = new Map(); // personId → { reply, camp }
    const idOf = (panelId) => (typeof panelId === 'string' && panelId.startsWith(PREFIX) && NPC_ID.test(panelId.slice(PREFIX.length)) ? panelId.slice(PREFIX.length) : null);
    const person = (pid) => (pid ? personOf(content(), pid) : null);
    const beds = () => bedsFor(shell.state?.hearth?.tier);
    const view = (pid) => { const p = person(pid); return p ? personView(shell.state, p, shell.now(), { beds: beds() }) : null; };
    const refresh = (focus) => shell.refreshPanel?.({ focus });
    const say = (text) => shell.log?.({ tab: 'world', text, at: shell.now(), detail: null, action: null });

    const spec = {
      title: (panelId) => person(idOf(panelId))?.name || 'Someone',
      exists: (panelId) => Boolean(person(idOf(panelId))),
      render: (panelId) => {
        try { return buildPerson(view(idOf(panelId)), ui.get(idOf(panelId)) || {}); } catch (err) { console.error(err); return '<p class="quiet-note">They’re not here just now.</p>'; }
      },
      action: (button, panelId) => {
        const pid = idOf(panelId);
        const p = person(pid);
        const act = button?.dataset?.action || '';
        if (!p || !act.startsWith('person-')) return false;
        const now = shell.now();
        const mine = ui.get(pid) || {};
        switch (act) {
          case 'person-meet': shell.set(meet(shell.state, p, now), { save: 300 }); refresh(null); break;
          case 'person-pick': {
            const r = choose(shell.state, p, button.dataset.topic, Number(button.dataset.index), now);
            if (!r.ok) { refresh(null); break; }
            const notes = [...r.notes];
            if (r.levelled) notes.push({ kind: 'levelled', text: r.level === 'warm' ? `${p.name.split(' ')[0]} warms to you.` : `${p.name.split(' ')[0]} is fond of you now.` });
            ui.set(pid, { reply: { lines: r.reply, notes } });
            for (const n of notes) say(n.text);
            shell.set(r.state, { save: 300 });
            refresh('person-next');
            break;
          }
          case 'person-next': ui.set(pid, {}); refresh(null); break;
          case 'person-go': ui.set(pid, {}); refresh(null); break;
          case 'person-camp': {
            const v = view(pid);
            const asking = v?.camp.state === 'ask' || v?.camp.state === 'full';
            const r = inviteToCamp(shell.state, p, now, { beds: beds() });
            const hint = [];
            if (!asking && !mine.camp) {
              const known = knownWords(v);
              if (known.likes.length) hint.push(`${p.name.split(' ')[0]} seems to warm to ${known.likes.join(' and ')}.`);
            }
            const spoken = r.ok ? [...(p.camp?.ask || []), ...r.lines] : r.why === 'early' ? [...r.lines, ...hint] : [...(p.camp?.ask || []), ...r.lines];
            ui.set(pid, { camp: { lines: spoken } });
            if (r.ok) { shell.set(r.state, { save: 300 }); say(`${p.name.split(' ')[0]} came to camp.`); }
            refresh('person-go');
            break;
          }
          default: return false;
        }
        return true;
      },
    };
    const off = shell.registerPanel(PREFIX, spec);
    if (typeof off === 'function') offs.push(off);
    let last = shell.state?.people;
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        if (shell.state?.people === last) return;
        last = shell.state?.people;
        if (String(shell.state?.panel || '').startsWith(PREFIX)) shell.refreshPanel?.({ passive: true });
      }));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (String(shell.state?.panel || '').startsWith(PREFIX)) shell.refreshPanel?.({ passive: true }); },
      residents: () => residentsOf(shell.state),
    };
  } catch (err) {
    console.error('[MILO] people mount', err);
    return NOOP;
  }
}
