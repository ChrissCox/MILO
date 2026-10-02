// People (PLAN.md Phase 5.1; LORE.md §9.1): the `person:<id>` panel. A portrait, what they say, your
// ways of answering (each tagged with the approach it is), the quiet notes ("Wendell approves",
// "Wendell will remember that"), Come to camp once they are Fond, and the journal page of what you
// have learned of them. All the rules are in src/people.js.
import {
  personOf, personView, choose, meet, inviteToCamp, bedsFor, residentsOf, knownWords, allPeople,
} from '../people.js';
import { errandOf, errandView, startErrand, giveStep, finishErrand } from '../errands.js';
import { opening, wantNow, giftView, give, giftsKnown, aboutView, about, GIFT_ITEMS } from '../sheets.js';
import { skyAt } from '../sky.js';
import { LEVELS } from '../people.js';
import { registerLook } from '../world/sprites-party.js';
import { FOLK_DYES } from '../world/folk.js';
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
  give: 'Give something',
  giveHint: 'Hand over something Milo gathered. A thing they like counts once a day.',
  nothingToGive: 'Nothing to give.',
  never: 'Never mind.',
  memories: 'They remember',
  nothing: 'Nothing yet.',
});

const lookOf = (personId) => ({ kind: 'rig', rig: 'coat', who: personId, likeness: null });
const NOTE_ICON = Object.freeze({ approves: '+', frowns: '−', remembers: '·', shrugs: '·', levelled: '+', gift: '+' });

/** The journal page: what has been learned (likes, what puts them off, what slides off) and what they remember. */
export function journalHtml(view) {
  const words = knownWords(view);
  const rows = [];
  if (words.likes.length) rows.push(`<li data-known="likes"><strong>Warms to</strong> ${esc(words.likes.join(', '))}</li>`);
  if (words.dislikes.length) rows.push(`<li data-known="dislikes"><strong>Put off by</strong> ${esc(words.dislikes.join(', '))}</li>`);
  if (words.resists.length) rows.push(`<li data-known="resists"><strong>Unmoved by</strong> ${esc(words.resists.join(', '))}</li>`);
  if (view.wants) rows.push(`<li data-known="wants"><strong>Wants</strong> ${esc(view.wants)}</li>`);
  if (view.tastes?.loves.length) rows.push(`<li data-known="loves"><strong>Loves</strong> ${esc(view.tastes.loves.join(', '))}</li>`);
  if (view.tastes?.likes.length) rows.push(`<li data-known="gift-likes"><strong>Likes</strong> ${esc(view.tastes.likes.join(', '))}</li>`);
  let html = `<section class="group person-journal" data-group="journal"><h3>${esc(COPY.journal)}</h3>`;
  html += rows.length ? `<ul class="person-known">${rows.join('')}</ul>` : `<p class="quiet-note">${esc(COPY.nothing)}</p>`;
  if (view.memories.length) {
    html += `<h4 class="person-sub">${esc(COPY.memories)}</h4><ul class="person-memories">${view.memories.map((m) => `<li data-memory="${esc(m.id)}">${esc(m.text)}</li>`).join('')}</ul>`;
  }
  return `${html}</section>`;
}

const lines = (list, cls = 'person-line') => (Array.isArray(list) ? list : []).map((l) => `<p class="${cls}">${esc(l)}</p>`).join('');

/** A running errand in the person's panel: its steps, anything to hand over, and the words that finish it. */
function errandHtml(view, errand) {
  const steps = errand.steps.map((s) => `<li data-step="${s.index}" data-done="${s.done ? 'true' : 'false'}"><span${s.done ? ' class="done-text"' : ''}>${esc(s.text)}</span>`
    + (s.kind === 'give' && !s.done ? ` <button type="button" class="px-btn small${s.have >= s.n ? ' primary' : ''}" data-action="person-errand-give" data-person="${esc(view.id)}" data-index="${s.index}" data-focus-key="person-errand-give-${s.index}"${s.have >= s.n ? '' : ' disabled'}>Give ${esc(s.n)} ${esc(s.item)} (${esc(s.have)})</button>` : '')
    + '</li>').join('');
  return `<section class="group person-errand" data-group="errand" data-errand="${esc(errand.id)}" data-state="${esc(errand.state)}"><h3>${esc(errand.title)}</h3>`
    // "Not yet" is only said when there's nothing in hand to give.
    + (errand.state === 'doing' && !errand.steps.some((s) => s.kind === 'give' && !s.done && s.have >= s.n) ? lines(errand.waiting) : '')
    + `<ul class="person-steps">${steps}</ul>`
    + (errand.state === 'ready' ? `<p class="person-actions"><button type="button" class="px-btn primary" data-action="person-errand-done" data-person="${esc(view.id)}" data-focus-key="person-errand-done">${esc(errand.report)}</button></p>` : '')
    + '</section>';
}

/**
 * The `person:<id>` panel. ui: { reply: { lines, notes } | null, camp: { lines } | null, offer: { lines } | null };
 * errand: errandView's, with the person's own words for it (ask, accept, report, waiting), or null.
 */
export function buildPerson(view, ui = {}, errand = null) {
  if (!view) return '<p class="quiet-note">There’s nobody here.</p>';
  let html = `<div class="person-view" data-person="${esc(view.id)}" data-level="${esc(view.level)}">`;
  html += `<header class="person-head">${portraitCanvas(lookOf(view.id), { label: view.name, size: 56 })}`
    + `<div class="person-who"><p class="person-title">${esc(view.title)}</p><span class="person-level" title="How they feel about you." data-level="${esc(view.level)}">${esc(view.levelWord)}</span></div></header>`;
  html += '<section class="group person-talk" data-group="talk">';
  if (ui.gifts) {
    html += ui.gifts.items.length
      ? `<ul class="person-options person-gifts" aria-label="Give">${ui.gifts.items.map((g) => `<li><button type="button" class="person-option" data-action="person-give" data-person="${esc(view.id)}" data-item="${esc(g.item)}" data-focus-key="person-give-${esc(g.item)}">${esc(g.name[0].toUpperCase() + g.name.slice(1))} <span class="qty">× ${esc(g.have)}</span></button></li>`).join('')}</ul>`
      : `<p class="quiet-note">${esc(COPY.nothingToGive)}</p>`;
    html += `<p class="person-actions"><button type="button" class="link-btn" data-action="person-go" data-person="${esc(view.id)}" data-focus-key="person-go">${esc(COPY.never)}</button></p>`;
  } else if (ui.offer && errand) {
    html += lines(ui.offer.lines);
    html += `<p class="person-actions"><button type="button" class="px-btn primary" data-action="person-errand-accept" data-person="${esc(view.id)}" data-focus-key="person-errand-accept">${esc(errand.accept)}</button> `
      + `<button type="button" class="link-btn" data-action="person-errand-no" data-person="${esc(view.id)}" data-focus-key="person-errand-no">Not now.</button></p>`;
  } else if (ui.camp) {
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
    html += lines([view.opening || view.greeting[0]].filter(Boolean), 'person-line person-hello');
    html += lines(view.topic.say);
    html += `<ul class="person-options" aria-label="Your answer">${view.topic.options.map((o) => `<li><button type="button" class="person-option" data-action="person-pick" data-person="${esc(view.id)}" data-topic="${esc(view.topic.id)}" data-index="${o.index}" data-approach="${esc(o.approach)}" data-focus-key="person-pick-${o.index}">`
      + `${esc(o.text)}</button></li>`).join('')}</ul>`;
  } else {
    html += lines([view.opening || view.greeting[0]].filter(Boolean), 'person-line person-hello');
    html += lines(view.tired || view.finished);
  }
  html += '</section>';
  const quiet = view.met && !ui.reply && !ui.camp && !ui.offer && !ui.gifts;
  if (quiet && errand?.state === 'offer') html += `<p class="person-actions"><button type="button" class="person-option" data-action="person-errand-ask" data-person="${esc(view.id)}" data-focus-key="person-errand-ask">${esc(errand.ask)}</button></p>`;
  if (quiet && (errand?.state === 'doing' || errand?.state === 'ready')) html += errandHtml(view, errand);
  if (quiet) {
    html += `<p class="person-actions person-more"><button type="button" class="link-btn" data-action="person-gifts" data-person="${esc(view.id)}" data-focus-key="person-gifts" title="${esc(COPY.giveHint)}">${esc(COPY.give)}</button>`
      + (view.about || []).map((a) => ` <button type="button" class="link-btn" data-action="person-about" data-person="${esc(view.id)}" data-who="${esc(a.id)}" data-focus-key="person-about-${esc(a.id)}">About ${esc(a.name)}</button>`).join('')
      + '</p>';
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
    FOLK_DYES.forEach((dye, i) => registerLook('coat', `folk-${i}`, dye));
    const ui = new Map(); // personId → { reply, camp, offer }
    const idOf = (panelId) => (typeof panelId === 'string' && panelId.startsWith(PREFIX) && NPC_ID.test(panelId.slice(PREFIX.length)) ? panelId.slice(PREFIX.length) : null);
    const person = (pid) => (pid ? personOf(content(), pid) : null);
    const beds = () => bedsFor(shell.state?.hearth?.tier);
    const weather = () => { try { return skyAt(shell.now(), { seed: shell.state?.wilds?.seed || 'hushlands', sky: content()?.sky ?? null })?.weather?.kind ?? null; } catch { return null; } };
    const view = (pid) => {
      const p = person(pid);
      if (!p) return null;
      const v = personView(shell.state, p, shell.now(), { beds: beds() });
      // The sheet's side (sheets.js): what they say first today, what they want (once they've warmed), their tastes, their neighbours.
      const warm = LEVELS.indexOf(v.level) >= LEVELS.indexOf('warm');
      return {
        ...v,
        opening: v.met ? opening(p, shell.state, shell.now(), { hello: v.greeting[0] || '', weather: weather() }) : '',
        wants: warm ? wantNow(shell.state, p) : '',
        tastes: giftsKnown(shell.state, p),
        about: warm ? aboutView(shell.state, content(), p) : [],
      };
    };
    const refresh = (focus) => shell.refreshPanel?.({ focus });
    const say = (text) => shell.log?.({ tab: 'world', text, at: shell.now(), detail: null, action: null });
    // The errand as the panel shows it: where it stands, with the person's own words for asking and finishing.
    const errandInfo = (pid) => {
      const p = person(pid);
      const errand = p ? errandOf(p) : null;
      const v = errand ? errandView(shell.state, p, shell.now()) : null;
      return v ? { ...v, ask: String(errand.ask || ''), accept: String(errand.accept || ''), report: String(errand.report || ''), waiting: Array.isArray(errand.waiting) ? errand.waiting : [] } : null;
    };
    const first = (p) => p.name.split(' ')[0];

    const spec = {
      title: (panelId) => person(idOf(panelId))?.name || 'Someone',
      exists: (panelId) => Boolean(person(idOf(panelId))),
      render: (panelId) => {
        try { return buildPerson(view(idOf(panelId)), ui.get(idOf(panelId)) || {}, errandInfo(idOf(panelId))); } catch (err) { console.error(err); return '<p class="quiet-note">They’re not here just now.</p>'; }
      },
      action: (button, panelId) => {
        const pid = idOf(panelId);
        const p = person(pid);
        const act = button?.dataset?.action || '';
        if (!p || !act.startsWith('person-')) return false;
        const now = shell.now();
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
          case 'person-gifts': ui.set(pid, { gifts: { items: giftView(shell.state, p) } }); refresh(null); break;
          case 'person-give': {
            const item = button.dataset.item;
            const r = GIFT_ITEMS.includes(item) ? give(shell.state, p, item, now) : { ok: false };
            if (!r.ok) { ui.set(pid, {}); refresh(null); break; }
            const notes = [...r.notes];
            if (r.levelled) notes.push({ kind: 'levelled', text: r.level === 'warm' ? `${first(p)} warms to you.` : `${first(p)} is fond of you now.` });
            ui.set(pid, { reply: { lines: r.lines, notes } });
            for (const n of notes) say(n.text);
            shell.set(r.state, { save: 300 });
            refresh('person-next');
            break;
          }
          case 'person-about': {
            const said = about(p, String(button.dataset.who || ''));
            if (said.length) ui.set(pid, { camp: { lines: said } });
            refresh('person-go');
            break;
          }
          case 'person-go': ui.set(pid, {}); refresh(null); break;
          case 'person-camp': {
            const r = inviteToCamp(shell.state, p, now, { beds: beds() });
            // Only their own words: the ask and the answer, or the polite no.
            const spoken = r.ok || r.why === 'full' ? [...(p.camp?.ask || []), ...r.lines] : r.lines;
            ui.set(pid, { camp: { lines: spoken } });
            if (r.ok) { shell.set(r.state, { save: 300 }); say(`${p.name.split(' ')[0]} came to camp.`); }
            refresh('person-go');
            break;
          }
          case 'person-errand-ask': {
            const errand = errandOf(p);
            if (errand && errandView(shell.state, p, now)?.state === 'offer') ui.set(pid, { offer: { lines: Array.isArray(errand.offer) ? errand.offer : [] } });
            refresh('person-errand-accept');
            break;
          }
          case 'person-errand-no': ui.set(pid, {}); refresh('person-errand-ask'); break;
          case 'person-errand-accept': {
            const next = startErrand(shell.state, p, now);
            ui.set(pid, {});
            if (next !== shell.state) { shell.set(next, { save: 300 }); say(`Errand for ${first(p)}: ${errandOf(p).title}.`); }
            refresh(null);
            break;
          }
          case 'person-errand-give': {
            const r = giveStep(shell.state, p, Number(button.dataset.index), now);
            if (r.ok) shell.set(r.state, { save: 300 });
            refresh('person-errand-done');
            break;
          }
          case 'person-errand-done': {
            const r = finishErrand(shell.state, p, now);
            if (!r.ok) { refresh(null); break; }
            const notes = [...r.notes];
            if (r.levelled) notes.push({ kind: 'levelled', text: r.level === 'warm' ? `${first(p)} warms to you.` : `${first(p)} is fond of you now.` });
            ui.set(pid, { reply: { lines: r.lines, notes } });
            for (const n of notes) say(n.text);
            shell.set(r.state, { save: 300 });
            refresh('person-next');
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
    let lastSatchel = shell.state?.satchel;
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        if (shell.state?.people === last && shell.state?.satchel === lastSatchel) return;
        last = shell.state?.people;
        lastSatchel = shell.state?.satchel;
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
