// Setting out (CONTRACT-PHASE4.md §12.4 K2, §7.5; COMBAT.md §2.1, §2.3, §2.5, §15): the muster
// panel, opened from the campfire, `::muster`, a lit lantern's panel or an Elsewhere's doorway.
// Each companion's portrait, calling, level, warmth, field skill, sync and mood; whether a
// Wayfarer comes in person or sends a likeness ("Claude is working on ‘MILO plan’. Her likeness
// will go."); Milo's suggestion; Same as last time (the default); formation, mode, ways to play and
// the calm settings (their own `data-calm` handler, never the generic data-setting toggle).
// Anywhere else it shows who's out, without swapping.
//
// Pure: `musterPanelView` shapes party.musterView for the panel and `buildMuster` draws it.
// `mount(shell)` registers the `muster` panel and does its buttons through party.js.
import { esc } from './panels.js';
import { portraitCanvas, lookOf } from './dialogue.js';
import { musterView, choose, setFormation, setMode, setPlay, setCalm, campfire, fightingLevel } from '../party.js';

export const id = 'muster';

export const MAX_CHOSEN = 3;
export const FORMATION_WORDS = Object.freeze({ line: 'Line', pairs: 'Pairs', loose: 'Loose', wedge: 'Wedge' });
export const MODE_WORDS = Object.freeze({ storybook: 'Storybook', 'long-road': 'Long Road', 'mauds-table': 'Maud’s Table' });
export const MODE_NOTES = Object.freeze({
  storybook: 'Gentle: foes a level down, cooler odds, no noise.',
  'long-road': 'As written. The default.',
  'mauds-table': 'Foes a level up, everyone warmer, every noise at once.',
});
export const PLAY_WORDS = Object.freeze({ guided: 'Guided', command: 'Command', choose: 'Let them choose', handle: 'Let them handle it' });
export const PLAY_NOTES = Object.freeze({
  guided: 'Everyone drafts. You review and Run.',
  command: 'Every slot starts empty. You write everything.',
  choose: 'The companions’ drafts lock in. You review Milo’s.',
  handle: 'Rounds run on their own. Space takes over.',
});
export const FIELD_WORDS = Object.freeze({
  light: 'Light', read: 'Read', pick: 'Pick', sort: 'Sort', riddle: 'Riddle', hear: 'Hear', heave: 'Heave', unfold: 'Unfold', track: 'Track',
  investigate: 'Investigate', 'jack-in': 'Jack in', nightsight: 'Nightsight', stonespeak: 'Stonespeak', tideread: 'Tideread', 'pass-through': 'Pass through',
});
export const STEP_WORDS = Object.freeze({ stranger: 'Stranger', acquaintance: 'Acquaintance', companion: 'Companion', friend: 'Friend', fireside: 'Fireside' });
export const CALM_SWITCHES = Object.freeze([
  Object.freeze({ key: 'noise', words: 'Genre noise', note: 'Each genre’s small surprises, named before Run.' }),
  Object.freeze({ key: 'adaptation', words: 'Stray adaptation', note: 'Strays plan around what you do in front of them.' }),
  Object.freeze({ key: 'fastFoes', words: 'Fast foe turns', note: 'Strays of one kind play as one quick beat.' }),
  Object.freeze({ key: 'ghosts', words: 'Ghosted suggestions in Command', note: 'Pale drafts in empty slots.' }),
]);

const WHERE_WORDS = Object.freeze({
  camp: 'Milo and up to three companions.',
  lantern: 'Swap here, by the lantern.',
  doorway: 'Swap here before you go in.',
  away: 'Swap at a lit lantern or a doorway.',
});

const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fkey = (...parts) => esc(parts.join('-'));

/** A regular's Look, from its record in state.party.regulars. */
export function regularLook(regular) {
  if (!regular || typeof regular !== 'object') return null;
  return {
    kind: 'stray', archetype: regular.archetype, bodyKey: regular.bodyKey || 'r', parts: Array.isArray(regular.parts) ? regular.parts : [],
    eyeKey: regular.eyeKey || null, genres: [regular.genre || null, regular.second || null], scale: 1,
  };
}

/**
 * The panel's view from party.musterView (`mv`) and a little more: `where` ('camp' | 'lantern' |
 * 'doorway' | 'away'), `callings` (callings.json's list, for names), `regulars` (state.party.regulars),
 * `wedge` (whether Warding has opened Wedge), `opened` (the ids chosen when the panel opened, for
 * "Same as last time"), `note` (a refusal to show).
 */
export function musterPanelView(mv, { where = 'camp', callings = [], regulars = [], wedge = false, opened = null, note = null, miloLevel = null } = {}) {
  const callingName = (cid) => (Array.isArray(callings) ? callings.find((c) => c?.id === cid)?.name : null) || upper(String(cid || '').replace(/-/g, ' '));
  const chosen = (mv?.members || []).filter((m) => m.chosen).map((m) => m.id);
  const canSwap = !!mv?.canSwap && where !== 'away';
  const members = (mv?.members || []).map((m) => {
    const regular = (regulars || []).find((r) => r?.id === m.id) || null;
    return {
      id: m.id,
      name: m.name,
      calling: callingName(m.calling),
      level: m.level,
      warmth: m.warmth,
      warmthStep: STEP_WORDS[m.warmthStep] || upper(m.warmthStep || ''),
      fieldSkill: m.fieldSkill ? FIELD_WORDS[m.fieldSkill] || upper(m.fieldSkill) : null,
      sync: Number.isFinite(m.sync) ? m.sync : null,
      mood: m.mood || null,
      likeness: m.likeness || null,
      chosen: !!m.chosen,
      regular: !!regular,
      look: regular ? regularLook(regular) : lookOf(m.id),
      full: !m.chosen && chosen.length >= MAX_CHOSEN,
    };
  });
  const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  const suggestion = mv?.suggestion ? {
    ids: mv.suggestion.ids || [],
    words: mv.suggestion.words || '',
    taken: sameIds(mv.suggestion.ids || [], chosen),
  } : null;
  return {
    where,
    canSwap,
    whereWords: WHERE_WORDS[canSwap ? where : 'away'] || WHERE_WORDS.away,
    room: mv?.room || { used: 0, max: 0 },
    milo: { name: 'Milo', level: miloLevel, look: lookOf('milo') },
    members,
    chosen,
    same: !opened || sameIds(opened, chosen),
    suggestion,
    formation: mv?.formation || 'line',
    formations: Object.keys(FORMATION_WORDS).map((f) => ({ id: f, words: FORMATION_WORDS[f], locked: f === 'wedge' && !wedge, why: f === 'wedge' && !wedge ? 'Opens at Warding 5' : null })),
    mode: mv?.mode || 'long-road',
    play: mv?.play || 'guided',
    calm: { noise: true, adaptation: true, odds: 'bars', fastFoes: true, playback: 1, ghosts: false, ...(mv?.calm || {}) },
    note,
  };
}

function segmented(action, label, list, current, { disabled = false } = {}) {
  return `<div class="segmented" role="group" aria-label="${esc(label)}">${list.map((o) => `<button type="button" class="px-btn small" data-action="${esc(action)}"`
    + ` data-value="${esc(o.id)}" data-focus-key="${fkey(action, o.id)}" aria-pressed="${o.id === current ? 'true' : 'false'}"${disabled || o.locked ? ' disabled' : ''}`
    + `${o.why ? ` title="${esc(o.why)}"` : ''}>${esc(o.words)}</button>`).join('')}</div>`;
}

function memberHtml(m, view) {
  let html = `<li class="muster-member" data-member="${esc(m.id)}"${m.chosen ? ' data-chosen="true"' : ''}${m.regular ? ' data-regular="true"' : ''}>`;
  html += portraitCanvas(m.look, { label: m.name, size: 40 });
  html += '<div class="muster-facts">';
  html += `<p class="muster-name">${esc(m.name)}</p>`;
  html += `<p class="muster-line">${esc([`${m.calling}, level ${m.level}`, m.fieldSkill || null].filter(Boolean).join(' · '))}</p>`;
  const bits = [`Warmth ${m.warmth}`];
  if (m.sync !== null) bits.push(`Sync ${m.sync}%`);
  if (m.mood && m.mood !== 'Rested') bits.push(m.mood);
  html += `<p class="muster-line">${esc(bits.join(' · '))}</p>`;
  if (m.likeness) html += `<p class="muster-likeness">${esc(m.likeness)}</p>`;
  html += '</div>';
  if (view.canSwap) {
    const label = m.chosen ? 'Leave at camp' : 'Take along';
    html += `<button type="button" class="px-btn small" data-action="muster-toggle" data-member="${esc(m.id)}" data-focus-key="${fkey('muster-toggle', m.id)}"`
      + ` aria-pressed="${m.chosen ? 'true' : 'false'}"${m.full ? ` disabled title="Three are going already."` : ''}>${label}</button>`;
  } else if (m.chosen) {
    html += '<span class="muster-out">Out with Milo</span>';
  }
  return `${html}</li>`;
}

/** The Setting out panel's HTML (§12.4). Deterministic. */
export function buildMuster(view) {
  const v = view;
  let html = `<section class="muster" data-where="${esc(v.where)}" data-can-swap="${v.canSwap ? 'true' : 'false'}">`;
  html += `<p class="panel-lede">${esc(v.whereWords)}</p>`;
  if (v.note) html += `<p class="plot-note" role="status">${esc(v.note)}</p>`;
  html += `<div class="muster-milo">${portraitCanvas(v.milo.look, { label: 'Milo', size: 40 })}<p class="muster-name">Milo</p>`
    + `${Number.isFinite(v.milo.level) ? `<p class="muster-line">${esc(`Lanternkeeper, level ${v.milo.level}`)}</p>` : ''}</div>`;
  html += `<ol class="muster-members" aria-label="Who goes with Milo">${v.members.map((m) => memberHtml(m, v)).join('')}</ol>`;
  if (v.room.max > 0) html += `<p class="muster-room">${esc(`Regulars: ${v.room.used} of ${v.room.max}`)}</p>`;
  if (v.suggestion?.words) {
    html += `<div class="milo-says"><p>${esc(v.suggestion.words)}</p></div>`;
    if (v.canSwap && !v.suggestion.taken && v.suggestion.ids.length) {
      html += '<button type="button" class="px-btn small" data-action="muster-suggest" data-focus-key="muster-suggest">Take Milo’s pick</button>';
    }
  }
  if (v.canSwap) {
    html += '<section class="settings muster-settings"><h3>On the road</h3>';
    html += `<p class="setting-label">Formation</p>${segmented('muster-formation', 'Formation', v.formations, v.formation)}`;
    html += `<p class="setting-label">Mode</p>${segmented('muster-mode', 'Mode', Object.keys(MODE_WORDS).map((m) => ({ id: m, words: MODE_WORDS[m], why: MODE_NOTES[m] })), v.mode)}`;
    html += `<p class="setting-label">Ways to play</p>${segmented('muster-play', 'Ways to play', Object.keys(PLAY_WORDS).map((p) => ({ id: p, words: PLAY_WORDS[p], why: PLAY_NOTES[p] })), v.play)}`;
    html += '<div class="calm-switches">';
    const row = (key, words, note, on) => `<div class="setting"><div><p class="setting-name" id="${fkey('muster-calm-name', key)}" title="${esc(note)}">${esc(words)}</p></div>`
      + `<button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-labelledby="${fkey('muster-calm-name', key)}" data-action="muster-calm" data-calm="${esc(key)}"`
      + ` data-focus-key="${fkey('muster-calm', key)}"><span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${on ? 'On' : 'Off'}</span></button></div>`;
    for (const s of CALM_SWITCHES) html += row(s.key, s.words, s.note, v.calm[s.key] !== false);
    html += row('odds', 'Odds as words', 'Likely, about even or a long shot, instead of four bars.', v.calm.odds === 'words');
    html += '</div></section>';
    if (v.where === 'camp') {
      html += `<button type="button" class="px-btn primary" data-action="muster-set-out" data-focus-key="muster-set-out">${v.same ? 'Same as last time' : 'Set out with these'}</button>`;
    }
  }
  return `${html}</section>`;
}

// ---------------------------------------------------------------------------
// mount(shell)

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/**
 * Why party.choose kept the party as it was, in the order it checks: a fight on (or a place you
 * can't swap in), someone not in the company, or three going already (taking one along). null when
 * nothing needed saying.
 */
export function musterRefusal(state, memberId, chosen = []) {
  if (state?.expedition?.battle != null) return 'Swaps wait until the fight is over.';
  if (memberId && !Object.hasOwn(state?.party?.roster || {}, memberId)) return 'They aren’t in the company yet.';
  if (memberId && !chosen.includes(memberId) && chosen.length >= MAX_CHOSEN) return 'Three are going already.';
  return memberId ? null : 'That’s who’s going already.';
}
const refusal = musterRefusal;

/**
 * Registers the `muster` panel (§12.3). `options.where()` says where Milo stands ('camp' |
 * 'lantern' | 'doorway' | 'away'; the shell knows: the campfire, a lit lantern's panel, an
 * Elsewhere's doorway), and `options.destination()` gives suggestParty's destination.
 */
export function mount(shell, { where = () => 'camp', destination = () => null } = {}) {
  try {
    if (!shell?.registerPanel) return NOOP;
    let opened = null;
    let note = null;
    const content = () => shell.content?.() || {};
    const rules = () => content().combat?.rules || null;
    const view = () => {
      const state = shell.state;
      const now = shell.now?.() ?? 0;
      const mv = musterView(state, { content: content(), rules: rules(), snapshot: shell.snapshot?.() || null, now, destination: destination() });
      if (!opened) opened = mv.members.filter((m) => m.chosen).map((m) => m.id);
      const wedge = state?.party?.formation === 'wedge' || setFormation(state, 'wedge', now) !== state;
      return musterPanelView(mv, { where: where() || 'camp', callings: content().combat?.callings?.callings || [], regulars: state?.party?.regulars || [], wedge, opened, note, miloLevel: rules() ? fightingLevel(state, 'milo', rules()) : null });
    };
    const apply = (next, focus) => {
      if (next !== shell.state) shell.set(next);
      shell.refreshPanel?.({ focus });
      return true;
    };
    const handle = shell.registerPanel('muster', {
      title: () => 'Setting out',
      exists: (panelId) => panelId === 'muster',
      render: () => {
        try { return buildMuster(view()); } catch (err) { console.error(err); return '<p class="quiet-note">The muster isn’t ready.</p>'; }
      },
      action: (button, panelId) => {
        if (panelId !== 'muster') return false;
        const act = button?.dataset?.action || '';
        if (!act.startsWith('muster-')) return false;
        const state = shell.state;
        const now = shell.now?.() ?? 0;
        const focus = button.dataset.focusKey || null;
        note = null;
        const chosen = Array.isArray(state?.party?.chosen) ? state.party.chosen : [];
        switch (act) {
          case 'muster-toggle': {
            const mid = button.dataset.member;
            const ids = chosen.includes(mid) ? chosen.filter((x) => x !== mid) : [...chosen, mid];
            const next = choose(state, ids, now);
            if (next === state) note = refusal(state, mid, chosen);
            return apply(next, focus);
          }
          case 'muster-suggest': {
            const ids = musterView(state, { content: content(), rules: rules(), snapshot: shell.snapshot?.() || null, now, destination: destination() }).suggestion.ids;
            const next = choose(state, ids, now);
            if (next === state && !(ids.length === chosen.length && ids.every((x, i) => chosen[i] === x))) note = refusal(state, null, chosen);
            return apply(next, focus);
          }
          case 'muster-formation': return apply(setFormation(state, button.dataset.value, now), focus);
          case 'muster-mode': return apply(setMode(state, button.dataset.value, now), focus);
          case 'muster-play': return apply(setPlay(state, button.dataset.value, now), focus);
          case 'muster-calm': {
            const key = button.dataset.calm;
            const calm = state?.party?.calm || {};
            if (key === 'odds') return apply(setCalm(state, { odds: calm.odds === 'words' ? 'bars' : 'words' }, now), focus);
            const on = { noise: true, adaptation: true, fastFoes: true, ghosts: false, ...calm }[key] !== false;
            return apply(setCalm(state, { [key]: !on }, now), focus);
          }
          case 'muster-set-out': {
            const r = campfire(state, now, { where: 'muster' });
            opened = null;
            if (r.state !== state) shell.set(r.state);
            shell.feature?.('muster');
            shell.closePanel?.();
            return true;
          }
          default: return false;
        }
      },
    });
    return {
      dispose() { if (typeof handle === 'function') handle(); },
      refresh() { opened = null; },
    };
  } catch (err) {
    console.error(err);
    return NOOP;
  }
}
