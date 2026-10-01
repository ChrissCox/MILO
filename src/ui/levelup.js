// Level up (CONTRACT-PHASE4.md §12.4 K2, §7.5; COMBAT.md §5.3): the `levelup:<id>` panel and the
// `levelup` bubble. Path, boon and Pages choices from party.pendingChoices, taken with
// party.levelUp, never during a fight.
//
// Pure: `levelUpView` and `buildLevelUp`, and `levelUpBubble` for the shell's bubble queue.
// `mount(shell)` registers the panels.
import { esc } from './panels.js';
import { portraitCanvas, lookOf } from './dialogue.js';
import { regularLook } from './muster.js';
import { pendingChoices, levelUp, fightingLevel, heroSpec } from '../party.js';

export const id = 'levelup';

const KIND_WORDS = Object.freeze({ path: 'Choose a path', boon: 'Choose a boon', spells: 'Write new Pages' });
const KIND_NOTES = Object.freeze({
  path: 'Swap paths at camp.',
  boon: 'Swap a boon at the campfire.',
  spells: 'Only written Pages can be cast.',
});
const fkey = (...parts) => esc(parts.join('-'));

/** The level up bubble for the shell's queue: { kind: 'levelup', title, lines, place, actions }. */
export function levelUpBubble(name, level, memberId) {
  const who = String(name || 'Someone');
  return {
    kind: 'levelup',
    title: `${who}, level ${Math.max(1, Math.round(Number(level) || 1))}`,
    lines: [`${who} is level ${Math.max(1, Math.round(Number(level) || 1))}. There’s a choice waiting.`],
    place: `levelup:${memberId}`,
    actions: [{ id: 'show', label: 'Choose now' }],
  };
}

/**
 * The Scribe's room for Pages (party.preparePages' rule: Wit + level in all): { max, prepared,
 * picked, left }, where `left` is what the staged picks leave.
 */
export function pagesRoom(state, memberId, picked = [], { content = {}, rules = null } = {}) {
  let spec = null;
  try { spec = heroSpec(state, memberId, { content, rules }); } catch { spec = null; }
  const max = spec ? Math.max(0, (spec.abilities?.wit ?? 0) + (spec.level ?? 0)) : 0;
  const prepared = (state?.party?.roster?.[memberId]?.prepared || []).length;
  const n = Array.isArray(picked) ? picked.length : 0;
  return { max, prepared, picked: n, left: Math.max(0, max - prepared - n) };
}

/** Why a Level up choice didn't take, in plain words (the first cause party.levelUp meets). */
export function levelUpRefusal(state, choice, room = null) {
  if (state?.expedition?.battle != null) return 'Level ups wait until the fight is over.';
  if (choice?.kind === 'spells') {
    if (state?.expedition?.inside === true) return 'Pages are written at camp or by a lantern, not inside.';
    if (!choice.ids?.length) return 'Pick the Pages to write first.';
    if (room && room.picked > room.max - room.prepared) return `Those don’t fit: there’s room for ${Math.max(0, room.max - room.prepared)} more.`;
  }
  return 'That choice isn’t open just now.';
}

/**
 * The panel's view: { id, name, level, look, live (a fight is on), note, choices: [{ kind, title,
 * note, options: [{ id, name, text, picked, disabled }], room }] }. `picked` is the staged spell ids
 * for Pages; `room` (Pages only) is pagesRoom's, and the spare buttons are disabled once it's full.
 */
export function levelUpView(state, memberId, { content = {}, rules = null, picked = [], note = null } = {}) {
  const roster = state?.party?.roster || {};
  if (!Object.hasOwn(roster, memberId)) return null;
  const file = content.party?.companions?.[memberId] || null;
  const regular = (state?.party?.regulars || []).find((r) => r?.id === memberId) || null;
  let pending = [];
  try {
    pending = pendingChoices(state, memberId, { content, rules });
  } catch {
    pending = [];
  }
  const live = !!state?.expedition?.battle;
  return {
    id: memberId,
    name: file?.name || regular?.name || (memberId === 'milo' ? 'Milo' : memberId),
    level: rules ? fightingLevel(state, memberId, rules) : null,
    look: regular ? regularLook(regular) : lookOf(memberId),
    live,
    note: note ? String(note) : null,
    choices: pending.map((p) => {
      const room = p.kind === 'spells' ? pagesRoom(state, memberId, picked, { content, rules }) : null;
      return {
        kind: p.kind,
        title: KIND_WORDS[p.kind] || 'Choose',
        note: KIND_NOTES[p.kind] || null,
        room,
        options: (p.options || []).map((o) => {
          const on = p.kind === 'spells' && picked.includes(o.id);
          return { id: o.id, name: o.name, text: o.text || '', picked: on, disabled: !!room && !on && room.left <= 0 };
        }),
      };
    }),
  };
}

/** The Level up panel's HTML (§12.4). Deterministic. */
export function buildLevelUp(view) {
  if (!view) return '<p class="quiet-note">Nobody by that name is in the company.</p>';
  let html = `<section class="levelup" data-member="${esc(view.id)}">`;
  html += `<div class="sheet-head">${portraitCanvas(view.look, { label: view.name, size: 48 })}`
    + `<p class="sheet-name">${esc(Number.isFinite(view.level) ? `${view.name}, level ${view.level}` : view.name)}</p></div>`;
  if (view.live) return `${html}<p class="quiet-note">Level ups wait until the fight is over.</p></section>`;
  if (view.note) html += `<p class="plot-note" role="status">${esc(view.note)}</p>`;
  if (!view.choices.length) return `${html}<p class="quiet-note">Nothing to choose right now.</p></section>`;
  for (const c of view.choices) {
    html += `<section class="group levelup-choice" data-kind="${esc(c.kind)}"><h3>${esc(c.title)}</h3>`;
    if (c.note) html += `<p class="group-note">${esc(c.note)}</p>`;
    if (c.room) {
      const n = c.room.left;
      html += `<p class="group-note levelup-room">${esc(`Room for ${n} more of ${c.room.max} Pages, from Wit and level.`)}</p>`;
    }
    html += '<ul class="levelup-options">';
    for (const o of c.options) {
      if (c.kind === 'spells') {
        html += `<li><button type="button" class="px-btn small" data-action="levelup-page" data-member="${esc(view.id)}" data-choice="${esc(o.id)}"`
          + ` data-focus-key="${fkey('levelup-page', view.id, o.id)}" aria-pressed="${o.picked ? 'true' : 'false'}"${o.disabled ? ' disabled title="No room for more Pages."' : ''}>${esc(o.name)}</button>`
          + `${o.text ? `<span class="option-text">${esc(o.text)}</span>` : ''}</li>`;
      } else {
        html += `<li><button type="button" class="px-btn" data-action="levelup-choose" data-member="${esc(view.id)}" data-kind="${esc(c.kind)}" data-choice="${esc(o.id)}"`
          + ` data-focus-key="${fkey('levelup-choose', view.id, c.kind, o.id)}">${esc(o.name)}</button>${o.text ? `<span class="option-text">${esc(o.text)}</span>` : ''}</li>`;
      }
    }
    html += '</ul>';
    if (c.kind === 'spells') {
      const none = !c.options.some((o) => o.picked);
      html += `<button type="button" class="px-btn primary" data-action="levelup-spells" data-member="${esc(view.id)}" data-focus-key="${fkey('levelup-spells', view.id)}"`
        + `${none ? ' disabled title="Pick the Pages to write first."' : ''}>Write these Pages</button>`;
    }
    html += '</section>';
  }
  return `${html}</section>`;
}

// ---------------------------------------------------------------------------
// mount(shell)

const NOOP = Object.freeze({ dispose() {}, refresh() {} });
const PREFIX = 'levelup:';

/** Registers the `levelup:<id>` panels (§12.3). */
export function mount(shell) {
  try {
    if (!shell?.registerPanel) return NOOP;
    const staged = new Map();
    const notes = new Map();
    const content = () => shell.content?.() || {};
    const rules = () => content().combat?.rules || null;
    const memberOf = (panelId) => (typeof panelId === 'string' && panelId.startsWith(PREFIX) ? panelId.slice(PREFIX.length) : null);
    const view = (mid) => levelUpView(shell.state, mid, { content: content(), rules: rules(), picked: staged.get(mid) || [], note: notes.get(mid) || null });
    const handle = shell.registerPanel(PREFIX, {
      title: (panelId) => `Level up: ${view(memberOf(panelId))?.name || 'the company'}`,
      exists: (panelId) => Object.hasOwn(shell.state?.party?.roster || {}, memberOf(panelId) || ''),
      render: (panelId) => {
        try { return buildLevelUp(view(memberOf(panelId))); } catch (err) { console.error(err); return '<p class="quiet-note">Level up isn’t ready.</p>'; }
      },
      action: (button, panelId) => {
        const mid = memberOf(panelId);
        const act = button?.dataset?.action || '';
        if (!mid || !act.startsWith('levelup-')) return false;
        const state = shell.state;
        const now = shell.now?.() ?? 0;
        const opts = { content: content(), rules: rules() };
        const focus = button.dataset.focusKey || null;
        notes.delete(mid);
        if (act === 'levelup-page') {
          const list = staged.get(mid) || [];
          const sid = button.dataset.choice;
          // Past the room (Wit + level), a pick is refused and says why, as preparePages would.
          if (!list.includes(sid) && pagesRoom(state, mid, list, opts).left <= 0) notes.set(mid, 'No room for more Pages. Take one off first.');
          else staged.set(mid, list.includes(sid) ? list.filter((s) => s !== sid) : [...list, sid]);
          shell.refreshPanel?.({ focus });
          return true;
        }
        const choice = act === 'levelup-spells' ? { kind: 'spells', ids: staged.get(mid) || [] } : { kind: button.dataset.kind, id: button.dataset.choice };
        const next = levelUp(state, mid, choice, now, opts);
        if (next === state) {
          // Nothing taken: the picks stay staged, and the panel says why.
          notes.set(mid, levelUpRefusal(state, choice, choice.kind === 'spells' ? pagesRoom(state, mid, choice.ids, opts) : null));
          shell.refreshPanel?.({ focus });
          return true;
        }
        staged.delete(mid);
        shell.set(next);
        shell.refreshPanel?.({ focus: null });
        return true;
      },
    });
    return { dispose() { if (typeof handle === 'function') handle(); }, refresh() { staged.clear(); notes.clear(); } };
  } catch (err) {
    console.error(err);
    return NOOP;
  }
}
