// The notebook page (CONTRACT-PHASE4.md §12.4 K2, §7.2, §10.2; COMBAT.md §3.3): the panel
// `notebook:<id>`. "Trained on N of your fights · sync N%", the playbook rules as if/then selects,
// then each habit in plain words, strongest first, with its count, and Strike out (a struck habit
// is crossed out and can be put back), Teach (once a night, at the fire) and Reset (it asks first:
// "Start Rivet’s notebook fresh? He’ll play on instinct until he learns you again.").
//
// Pure: `notebookPageView` and `buildNotebookPage`. `mount(shell)` registers the panels, reads the
// notebook file through the bridge and H's notebook.js (loaded when first needed), and does the
// buttons through party.js; a lesson appends its frame exactly as §10.2 says (never rewriting).
import { esc } from './panels.js';
import { strikeOut, unstrike, resetNotebook, restoreNotebook, setRules, maxRules, noteGrowth } from '../party.js';
import { canTeach, markTaught } from '../camp.js';
import { dayNumber } from '../clean.js';
import { hashString } from '../world/rng.js';

export const id = 'notebook-view';

const PRONOUNS = Object.freeze({
  she: { subject: 'She', verb: 'learns' }, he: { subject: 'He', verb: 'learns' }, it: { subject: 'It', verb: 'learns' }, they: { subject: 'They', verb: 'learn' },
});
const fkey = (...parts) => esc(parts.join('-'));
const midName = (name) => String(name || '').replace(/^The /, 'the ');
const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const possessive = (name) => (/s$/.test(name) ? `${name}’` : `${name}’s`);

/** 'She plays on instinct until she learns you.' in a companion's own pronoun. */
export function instinct(pronoun = 'they') {
  const p = PRONOUNS[pronoun] || PRONOUNS.they;
  return `${p.subject} ${p.verb === 'learn' ? 'play' : 'plays'} on instinct until ${p.subject.toLowerCase()} ${p.verb} you.`;
}

/** The reset question, in the companion's own pronoun (COMBAT §3.3's line for Rivet). */
export function resetQuestion(name, pronoun = 'they') {
  const p = PRONOUNS[pronoun] || PRONOUNS.they;
  const who = String(name || 'Their');
  const clause = `${p.subject}’ll play on instinct until ${p.subject.toLowerCase()} ${p.verb} you again.`;
  return { title: `Start ${midName(possessive(who))} notebook fresh?`, body: clause };
}

/**
 * The page's view. `habits` are notebook.habits(notebook): [{ key, phrase, count, of, strength,
 * struck }], or null while the file loads. `vocab` is notebook.js's { ifs: RULE_IFS, thens:
 * RULE_THENS, text: ruleText }. `others` are who could learn a habit ([{ id, name }]).
 */
export function notebookPageView(state, memberId, { content = {}, habits = null, vocab = null, confirming = null, teaching = null, others = [], now = 0, note = null, atCamp = true } = {}) {
  const roster = state?.party?.roster || {};
  if (!Object.hasOwn(roster, memberId)) return null;
  const member = roster[memberId] || {};
  const nb = member.notebook || {};
  const file = content.party?.companions?.[memberId] || null;
  const regular = (state?.party?.regulars || []).find((r) => r?.id === memberId) || null;
  const name = file?.name || regular?.name || (memberId === 'milo' ? 'Milo' : memberId);
  const accepts = typeof nb.accepts === 'string' ? nb.accepts.slice(-50) : '';
  const struck = new Set(Array.isArray(nb.struck) ? nb.struck : []);
  const rules = (Array.isArray(nb.rules) ? nb.rules : []).map((r, i) => ({
    index: i, if: r.if, then: r.then, text: typeof vocab?.text === 'function' ? safeText(vocab.text, r) : null,
  }));
  const taught = !canTeach(state, now);
  const live = !!state?.expedition?.battle;
  return {
    id: memberId,
    name,
    pronoun: file?.pronoun || (memberId === 'milo' ? 'he' : regular ? 'they' : 'they'),
    fights: Number.isFinite(nb.fights) ? nb.fights : 0,
    count: Number.isFinite(nb.count) ? nb.count : 0,
    sync: accepts.length ? Math.round((100 * [...accepts].filter((c) => c === '1').length) / accepts.length) : null,
    rules,
    maxRules: maxRules(state),
    ifs: (vocab?.ifs || []).map((x) => ({ id: String(x.id), words: String(x.words) })),
    thens: (vocab?.thens || []).map((x) => ({ id: String(x.id), words: String(x.words) })),
    habits: Array.isArray(habits) ? habits.map((h) => ({
      key: String(h.key), phrase: upperFirst(String(h.phrase || h.key)), count: Number.isFinite(h.count) ? h.count : 0,
      of: Number.isFinite(h.of) ? h.of : null, struck: h.struck === true || struck.has(String(h.key)),
    })) : null,
    struckCount: struck.size,
    previous: !!nb.previous && typeof nb.previous === 'object',
    confirming: confirming === 'reset' ? 'reset' : null,
    teaching: teaching && typeof teaching === 'string' ? teaching : null,
    teach: { open: !taught && !!atCamp && !live, taught, atCamp: !!atCamp, others: (others || []).filter((o) => o.id !== memberId) },
    live,
    note,
  };
}

function safeText(fn, rule) {
  try {
    return String(fn(rule) || '');
  } catch {
    return null;
  }
}

function rulesHtml(v) {
  let html = `<section class="group notebook-rules"><h3>Playbook <span class="count">${v.rules.length} of ${v.maxRules}</span></h3>`;
  html += '<p class="group-note">Standing rules always win over habits.</p>';
  if (!v.ifs.length || !v.thens.length) {
    for (const r of v.rules) html += `<p class="rule-line">${esc(r.text || `If ${r.if}, then ${r.then}.`)}</p>`;
    return `${html}<p class="quiet-note">The rules open once the notebook is ready.</p></section>`;
  }
  html += '<ol class="playbook-rules">';
  for (const r of v.rules) {
    const sel = (part, list, value) => `<select class="px-select" data-action="notebook-rule" data-member="${esc(v.id)}" data-index="${r.index}" data-part="${part}"`
      + ` data-focus-key="${fkey('notebook-rule', v.id, r.index, part)}" aria-label="${esc(`Rule ${r.index + 1}: ${part}`)}">`
      + list.map((o) => `<option value="${esc(o.id)}"${o.id === value ? ' selected' : ''}>${esc(o.words)}</option>`).join('') + '</select>';
    html += `<li class="playbook-rule"><span>If</span>${sel('if', v.ifs, r.if)}<span>then</span>${sel('then', v.thens, r.then)}`
      + `<button type="button" class="link-btn" data-action="notebook-rule-remove" data-member="${esc(v.id)}" data-index="${r.index}" data-focus-key="${fkey('notebook-rule-remove', v.id, r.index)}">Remove</button>`
      + `${r.text ? `<p class="rule-line">${esc(r.text)}</p>` : ''}</li>`;
  }
  html += '</ol>';
  if (v.rules.length < v.maxRules) {
    html += `<button type="button" class="px-btn small" data-action="notebook-rule-add" data-member="${esc(v.id)}" data-focus-key="${fkey('notebook-rule-add', v.id)}">Add a rule</button>`;
  } else {
    html += '<p class="quiet-note">Rules are full.</p>';
  }
  return `${html}</section>`;
}

function habitHtml(v, h) {
  let html = `<li class="habit" data-habit="${esc(h.key)}"${h.struck ? ' data-struck="true"' : ''}>`;
  html += `<span class="habit-phrase">${h.struck ? `<s>${esc(h.phrase)}</s>` : esc(h.phrase)}</span>`;
  html += `<span class="habit-count">${esc(h.of ? `${h.count} of ${h.of} fights like this` : `${h.count} times`)}</span>`;
  html += '<span class="habit-actions">';
  if (h.struck) {
    html += `<button type="button" class="link-btn" data-action="notebook-unstrike" data-member="${esc(v.id)}" data-habit="${esc(h.key)}" data-focus-key="${fkey('notebook-unstrike', v.id, h.key)}">Put it back</button>`;
  } else {
    html += `<button type="button" class="link-btn" data-action="notebook-strike" data-member="${esc(v.id)}" data-habit="${esc(h.key)}" data-focus-key="${fkey('notebook-strike', v.id, h.key)}"`
      + `${v.struckCount >= 40 ? ' disabled title="Forty are struck out already."' : ''}>Strike out</button>`;
    if (v.teach.open && v.teach.others.length) {
      html += `<button type="button" class="link-btn" data-action="notebook-teach" data-member="${esc(v.id)}" data-habit="${esc(h.key)}" data-focus-key="${fkey('notebook-teach', v.id, h.key)}"`
        + ` aria-expanded="${v.teaching === h.key ? 'true' : 'false'}">Teach</button>`;
    }
  }
  html += '</span>';
  if (v.teaching === h.key && v.teach.open) {
    html += `<div class="teach-to" role="group" aria-label="${esc(`Who learns it from ${midName(v.name)}`)}">`;
    for (const o of v.teach.others) {
      html += `<button type="button" class="px-btn small" data-action="notebook-teach-to" data-member="${esc(v.id)}" data-habit="${esc(h.key)}" data-to="${esc(o.id)}"`
        + ` data-focus-key="${fkey('notebook-teach-to', v.id, h.key, o.id)}">${esc(`Show ${midName(o.name)}`)}</button>`;
    }
    html += '</div>';
  }
  return `${html}</li>`;
}

/** The notebook page's HTML (§12.4). Deterministic. */
export function buildNotebookPage(view) {
  if (!view) return '<p class="quiet-note">Nobody by that name keeps a notebook here.</p>';
  const v = view;
  let html = `<section class="notebook-page" data-member="${esc(v.id)}">`;
  html += `<p class="notebook-head"><span class="notebook-name">${esc(v.name)}</span> <span class="notebook-trained">${esc(`Trained on ${v.fights} of your fights${v.sync === null ? '' : ` · sync ${v.sync}%`}`)}</span></p>`;
  if (v.note) html += `<p class="plot-note" role="status">${esc(v.note)}</p>`;
  html += rulesHtml(v);
  html += `<section class="group notebook-habits"><h3>Habits${v.habits ? ` <span class="count">${v.habits.length}</span>` : ''}</h3>`;
  if (v.habits === null) html += '<p class="quiet-note">Opening the notebook.</p>';
  else if (!v.habits.length) html += '<p class="quiet-note">Nothing written yet.</p>';
  else html += `<ol class="habit-list">${v.habits.map((h) => habitHtml(v, h)).join('')}</ol>`;
  if (v.teach.taught) html += '<p class="quiet-note">Taught tonight.</p>';
  else if (!v.teach.open) html += '<p class="quiet-note">Lessons are taught at the fire.</p>';
  html += '</section>';
  if (v.live) {
    html += '<p class="quiet-note">Not during a fight.</p>';
  } else if (v.confirming === 'reset') {
    const q = resetQuestion(v.name, v.pronoun);
    html += `<div class="confirm" role="alertdialog" aria-labelledby="notebook-reset-${esc(v.id)}" aria-describedby="notebook-reset-body-${esc(v.id)}">`
      + `<p class="confirm-title" id="notebook-reset-${esc(v.id)}">${esc(q.title)}</p><p class="confirm-body" id="notebook-reset-body-${esc(v.id)}">${esc(q.body)} The old notebook is kept until the next Campfire.</p>`
      + `<div class="ask-actions"><button type="button" class="px-btn primary" data-action="notebook-reset-cancel" data-member="${esc(v.id)}" data-focus-key="${fkey('notebook-reset-cancel', v.id)}">Keep it</button>`
      + `<button type="button" class="px-btn" data-action="notebook-reset-confirm" data-member="${esc(v.id)}" data-focus-key="${fkey('notebook-reset-confirm', v.id)}">Start fresh</button></div></div>`;
  } else {
    html += '<div class="notebook-actions">';
    html += `<button type="button" class="px-btn small" data-action="notebook-reset" data-member="${esc(v.id)}" data-focus-key="${fkey('notebook-reset', v.id)}">Reset</button>`;
    if (v.previous) html += `<button type="button" class="px-btn small" data-action="notebook-restore" data-member="${esc(v.id)}" data-focus-key="${fkey('notebook-restore', v.id)}">Bring the old notebook back</button>`;
    html += '</div>';
  }
  return `${html}</section>`;
}

// ---------------------------------------------------------------------------
// The file side (the bridge and H's notebook.js), for the page and a lesson at the fire

let nbModule = null;
/** H's notebook.js, loaded once when first needed (null when it isn't there). */
export async function notebookModule() {
  if (nbModule) return nbModule;
  try {
    nbModule = await import('../combat/notebook.js');
  } catch {
    nbModule = null;
  }
  return nbModule;
}

async function readBook(bridge, memberId) {
  const r = await bridge.read(memberId);
  if (!r || !r.ok) return null;
  return r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes || []);
}

/** A companion's habits from their file: notebook.habits over the notes, struck ones marked. → habits | null */
export async function loadHabits(shell, memberId, nb = null) {
  const lib = nb || await notebookModule();
  const bridge = shell?.bridge?.notebooks;
  if (!lib || !bridge) return null;
  const bytes = await readBook(bridge, memberId);
  if (!bytes) return null;
  const member = shell.state?.party?.roster?.[memberId]?.notebook || {};
  const { notes } = lib.unframe(bytes);
  const book = lib.createNotebook(memberId, notes, { struck: member.struck || [], rules: member.rules || [] });
  return lib.habits(book);
}

/**
 * A lesson at the fire (§7.5, §10.2): `from` shows `to` one habit. Reads both files, turns the
 * habit's notes into `to`'s (notebook.teachNotes), frames them under the lesson's key and appends
 * at `to`'s good end, skipping a frame already there (a relaunch) and re-reading once on `moved`.
 * Then records the lesson in state (camp.markTaught) and the notes' count (party.noteGrowth).
 * → { ok, words, state }
 */
export async function teachLesson(shell, from, to, habitKey, { nb = null } = {}) {
  const lib = nb || await notebookModule();
  const bridge = shell?.bridge?.notebooks;
  const now = shell?.now?.() ?? 0;
  if (!lib || !bridge) return { ok: false, words: 'The notebooks aren’t open yet.', state: shell?.state };
  if (!canTeach(shell.state, now)) return { ok: false, words: 'Tonight’s lesson has been taught.', state: shell.state };
  const fromBytes = await readBook(bridge, from);
  if (!fromBytes) return { ok: false, words: 'That notebook won’t open just now.', state: shell.state };
  const fromMeta = shell.state?.party?.roster?.[from]?.notebook || {};
  const book = lib.createNotebook(from, lib.unframe(fromBytes).notes, { struck: fromMeta.struck || [], rules: fromMeta.rules || [] });
  const key = hashString(`lesson:${from}:${habitKey}:${dayNumber(now - 6 * 60 * 60 * 1000)}`) >>> 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const toBytes = await readBook(bridge, to);
    if (!toBytes) return { ok: false, words: 'That notebook won’t open just now.', state: shell.state };
    const target = lib.unframe(toBytes);
    let added = 0;
    if (target.lastKey !== key) {
      // The lesson's notes carry on `to`'s own order (notebook.nextOrder), strictly increasing.
      const start = typeof lib.nextOrder === 'function' ? lib.nextOrder(lib.createNotebook(to, target.notes)) : Math.floor(target.notes.length / 24);
      const notes = lib.teachNotes(book, habitKey, start);
      if (!notes || !notes.length) return { ok: false, words: 'There’s nothing written for that habit yet.', state: shell.state };
      const r = await bridge.append(to, lib.frame(notes, key), target.good);
      if (!r?.ok) {
        if (r?.code === 'moved' && attempt === 0) continue;
        return { ok: false, words: 'The lesson will have to wait. The notebook is busy.', state: shell.state };
      }
      added = Math.floor(notes.length / 24);
    }
    let next = markTaught(shell.state, from, to, habitKey, now);
    if (added) next = noteGrowth(next, to, added, now);
    if (next !== shell.state) shell.set(next);
    return { ok: true, words: null, state: next };
  }
  return { ok: false, words: 'The lesson will have to wait. The notebook is busy.', state: shell.state };
}

// ---------------------------------------------------------------------------
// mount(shell)

const NOOP = Object.freeze({ dispose() {}, refresh() {} });
const PREFIX = 'notebook:';

/**
 * Registers the `notebook:<id>` panels (§12.3). Options: `habitsOf(id)` → habits (or a Promise),
 * `teach(from, to, habitKey)` → Promise<{ ok, words }>; both default to this file's own
 * (loadHabits and teachLesson, through shell.bridge.notebooks and notebook.js). `atCamp()` says
 * whether a lesson can happen here (by default: no fight, not inside an Elsewhere).
 */
export function mount(shell, { habitsOf = null, teach = null, atCamp = null } = {}) {
  try {
    if (!shell?.registerPanel) return NOOP;
    const loaded = new Map(); // id → habits
    const loading = new Set();
    let vocab = null;
    let confirming = null;
    let teaching = null;
    let note = null;
    const content = () => shell.content?.() || {};
    const here = () => (typeof atCamp === 'function' ? !!atCamp() : !shell.state?.expedition?.battle && shell.state?.expedition?.inside !== true);
    const memberOf = (panelId) => (typeof panelId === 'string' && panelId.startsWith(PREFIX) ? panelId.slice(PREFIX.length) : null);
    const load = (mid) => {
      if (loaded.has(mid) || loading.has(mid)) return;
      loading.add(mid);
      Promise.resolve(habitsOf ? habitsOf(mid) : loadHabits(shell, mid)).then((h) => {
        loaded.set(mid, Array.isArray(h) ? h : []);
      }).catch(() => loaded.set(mid, [])).finally(() => {
        loading.delete(mid);
        shell.refreshPanel?.({ passive: true });
      });
      if (!vocab) {
        vocab = { ifs: [], thens: [], text: null };
        notebookModule().then((lib) => {
          if (lib) vocab = { ifs: lib.RULE_IFS || [], thens: lib.RULE_THENS || [], text: typeof lib.ruleText === 'function' ? lib.ruleText : null };
          shell.refreshPanel?.({ passive: true });
        });
      }
    };
    const others = (mid) => {
      const roster = shell.state?.party?.roster || {};
      const comps = content().party?.companions || {};
      return Object.keys(roster).filter((x) => x !== mid).map((x) => ({ id: x, name: comps[x]?.name || (shell.state?.party?.regulars || []).find((r) => r.id === x)?.name || (x === 'milo' ? 'Milo' : x) }));
    };
    const view = (mid) => notebookPageView(shell.state, mid, {
      content: content(), habits: loaded.has(mid) ? loaded.get(mid) : null, vocab, confirming: confirming === mid ? 'reset' : null,
      teaching: teaching?.id === mid ? teaching.habit : null, others: others(mid), now: shell.now?.() ?? 0, note, atCamp: here(),
    });
    const apply = (next, focus) => {
      if (next !== shell.state) shell.set(next);
      shell.refreshPanel?.({ focus });
      return true;
    };
    // A write to the notebook file, then the state change once it has landed ({ ok: true }); anything
    // else (blocked, not-loaded, a missing bridge) leaves state as it is and says so calmly.
    const fileThen = (write, mid, change, focus, words = {}) => {
      let pending;
      try { pending = write(); } catch (err) { pending = Promise.reject(err); }
      return Promise.resolve(pending).then((r) => {
        if (!r?.ok) {
          note = words[r?.code] || 'The notebook is busy just now. Try again in a moment.';
          shell.refreshPanel?.({ focus });
          return false;
        }
        loaded.delete(mid);
        apply(change(), focus);
        return true;
      }).catch((err) => {
        console.error(err);
        note = 'The notebook is busy just now. Try again in a moment.';
        shell.refreshPanel?.({ focus });
        return false;
      });
    };
    const handle = shell.registerPanel(PREFIX, {
      title: (panelId) => `${possessive(view(memberOf(panelId))?.name || 'The company')} notebook`,
      exists: (panelId) => Object.hasOwn(shell.state?.party?.roster || {}, memberOf(panelId) || ''),
      render: (panelId) => {
        const mid = memberOf(panelId);
        try {
          load(mid);
          return buildNotebookPage(view(mid));
        } catch (err) {
          console.error(err);
          return '<p class="quiet-note">The notebook won’t open just now.</p>';
        }
      },
      action: (el, panelId) => {
        const mid = memberOf(panelId);
        const act = el?.dataset?.action || '';
        if (!mid || !act.startsWith('notebook-')) return false;
        const state = shell.state;
        const now = shell.now?.() ?? 0;
        const focus = el.dataset.focusKey || null;
        const rules = state?.party?.roster?.[mid]?.notebook?.rules || [];
        note = null;
        switch (act) {
          case 'notebook-strike': return apply(strikeOut(state, mid, el.dataset.habit, now), focus);
          case 'notebook-unstrike': return apply(unstrike(state, mid, el.dataset.habit, now), focus);
          case 'notebook-reset': confirming = mid; shell.refreshPanel?.({ focus: `notebook-reset-cancel-${mid}` }); return true;
          case 'notebook-reset-cancel': confirming = null; shell.refreshPanel?.({ focus: `notebook-reset-${mid}` }); return true;
          // The file is the source of truth (§10.2): state follows a reset or a restore only once main
          // says the write landed, and the habits are read again after it.
          case 'notebook-reset-confirm': {
            confirming = null;
            shell.refreshPanel?.({ focus: `notebook-reset-${mid}` });
            fileThen(() => shell.bridge?.notebooks?.replace?.(mid, new Uint8Array(0), { keepPrevious: true }), mid,
              () => resetNotebook(shell.state, mid, shell.now?.() ?? now), `notebook-reset-${mid}`);
            return true;
          }
          case 'notebook-restore': {
            fileThen(() => shell.bridge?.notebooks?.restore?.(mid), mid, () => restoreNotebook(shell.state, mid, shell.now?.() ?? now), focus,
              { none: 'The old notebook has already gone.' });
            return true;
          }
          case 'notebook-rule': {
            const index = Number(el.dataset.index);
            const next = rules.map((r, i) => (i === index ? { ...r, [el.dataset.part === 'then' ? 'then' : 'if']: el.value } : r));
            return apply(setRules(state, mid, next, now), focus);
          }
          case 'notebook-rule-add': {
            const first = { if: vocab?.ifs?.[0]?.id, then: vocab?.thens?.[0]?.id };
            if (!first.if || !first.then) return true;
            return apply(setRules(state, mid, [...rules, first], now), focus);
          }
          case 'notebook-rule-remove': return apply(setRules(state, mid, rules.filter((_, i) => i !== Number(el.dataset.index)), now), focus);
          case 'notebook-teach':
            teaching = teaching?.id === mid && teaching.habit === el.dataset.habit ? null : { id: mid, habit: el.dataset.habit };
            shell.refreshPanel?.({ focus });
            return true;
          case 'notebook-teach-to': {
            const to = el.dataset.to;
            const habit = el.dataset.habit;
            teaching = null;
            Promise.resolve(teach ? teach(mid, to, habit) : teachLesson(shell, mid, to, habit)).then((r) => {
              note = r?.ok ? `${others(mid).find((o) => o.id === to)?.name || 'They'} learned it.` : r?.words || null;
              loaded.delete(to);
              shell.refreshPanel?.({ focus: `notebook-teach-${mid}-${habit}` });
            }).catch((err) => console.error(err));
            return true;
          }
          default: return false;
        }
      },
    });
    return {
      dispose() { if (typeof handle === 'function') handle(); },
      refresh() { loaded.clear(); },
    };
  } catch (err) {
    console.error(err);
    return NOOP;
  }
}
