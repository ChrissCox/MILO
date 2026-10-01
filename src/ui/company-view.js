// The company sheet (CONTRACT-PHASE4.md §12.4 K2, §7.5; COMBAT.md §2.2, §2.7, §5, §15): the panel
// `company:<id>`, a companion's character sheet. Calling, level and title, path, boons, warmth,
// field skill, who writes their turns (Mine, Review, Let them choose), each reaction set to Ask,
// Always, Under half or Never (party.setReaction), and a link to their notebook page. At camp it
// also holds the camp's swaps: a path (party.swapPath), a boon (party.swapBoon) and the Scribe's
// Pages (party.preparePages).
//
// Pure: `companyView` reads state and content; `buildCompany` draws it. `mount(shell)` registers
// the `company:` panels and does their buttons through party.js.
import { esc } from './panels.js';
import { portraitCanvas, lookOf } from './dialogue.js';
import { regularLook, FIELD_WORDS, STEP_WORDS } from './muster.js';
import { SETTING_WORDS, REACTION_SETTINGS, CONTROL_WORDS } from './planner.js';
import {
  heroSpec, fightingLevel, warmthStep, pendingChoices, setControl, setReaction, swapPath, swapBoon, preparePages,
} from '../party.js';

export const id = 'company-view';

const STEPS = Object.freeze([['acquaintance', 10], ['companion', 30], ['friend', 60], ['fireside', 100]]);
const REACTION_NAMES = Object.freeze({ 'parting-swipe': 'Parting swipe', shoulder: 'Shoulder', ready: 'Ready' });
const ABILITY_WORDS = Object.freeze({ might: 'Might', grace: 'Grace', grit: 'Grit', wit: 'Wit', heed: 'Heed', charm: 'Charm' });
const CONTROLS = Object.freeze(['mine', 'review', 'choose']);

const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fkey = (...parts) => esc(parts.join('-'));
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Content's ability definitions by id (callings, spells, companions, regulars), cached per bundle. */
const DEFS = new WeakMap();
export function abilityDefs(content) {
  if (!isRecord(content)) return new Map();
  if (DEFS.has(content)) return DEFS.get(content);
  const map = new Map();
  const add = (list) => { for (const a of Array.isArray(list) ? list : []) if (isRecord(a) && typeof a.id === 'string' && !map.has(a.id)) map.set(a.id, a); };
  add(content.combat?.callings?.abilities);
  add(content.combat?.spells?.spells);
  for (const file of Object.values(content.party?.companions || {})) add(file?.abilityDefs);
  add(content.party?.regulars?.abilityDefs);
  DEFS.set(content, map);
  return map;
}

/** A boon's shown name: 'Ability up: Wit' for an ability-up, else its ability's name. */
export function boonName(boonId, defs) {
  const m = /^ability-up-(might|grace|grit|wit|heed|charm)$/.exec(String(boonId || ''));
  if (m) return `${defs.get('ability-up')?.name || 'Ability up'}: ${ABILITY_WORDS[m[1]]}`;
  return defs.get(boonId)?.name || upper(String(boonId || '').replace(/-/g, ' '));
}

function titleFor(file, level) {
  const list = Array.isArray(file?.titles) ? file.titles : [];
  let best = null;
  for (const t of list) if (Number.isFinite(t?.level) && t.level <= level && (!best || t.level >= best.level)) best = t;
  return best?.title || null;
}

/**
 * A companion's sheet view (§12.4). `atCamp`: whether the camp's swaps show (the shell knows; the
 * swaps themselves refuse mid-fight or inside an Elsewhere). `pages` is the Scribe's staged Pages
 * (the ids being picked before Prepare), else her prepared list.
 */
export function companyView(state, memberId, { content = {}, rules = null, now = 0, atCamp = true, pages = null } = {}) {
  const roster = state?.party?.roster || {};
  if (!Object.hasOwn(roster, memberId)) return null;
  const member = roster[memberId] || {};
  const defs = abilityDefs(content);
  const file = content.party?.companions?.[memberId] || null;
  const regular = (state?.party?.regulars || []).find((r) => r?.id === memberId) || null;
  let spec = null;
  try {
    spec = heroSpec(state, memberId, { content, rules, now });
  } catch {
    spec = null;
  }
  const callingId = spec?.calling || regular?.calling || file?.calling || null;
  const calling = (content.combat?.callings?.callings || []).find((c) => c?.id === callingId) || null;
  const level = rules ? fightingLevel(state, memberId, rules) : spec?.level ?? 1;
  const paths = (content.combat?.callings?.paths || []).filter((p) => p?.companion === memberId && !p.from);
  const path = paths.find((p) => p.id === member.path) || null;
  const warmth = Number.isFinite(member.warmth) ? member.warmth : 0;
  const next = STEPS.find(([, at]) => warmth < at) || null;
  const reactions = Object.entries(spec?.reactions || {}).map(([rid, setting]) => ({
    id: rid, name: REACTION_NAMES[rid] || defs.get(rid)?.name || upper(rid.replace(/-/g, ' ')), setting,
  }));
  let pending = [];
  try {
    pending = pendingChoices(state, memberId, { content, rules });
  } catch {
    pending = [];
  }
  const boons = (Array.isArray(member.boons) ? member.boons : []).map((b) => ({ id: b, name: boonName(b, defs) }));
  const held = new Set(boons.map((b) => b.id));
  const swapsFor = (from) => {
    const base = /^ability-up-/.test(from) ? 'ability-up' : from;
    const out = [];
    for (const bid of content.combat?.callings?.boons || []) {
      if (bid === 'ability-up') {
        for (const key of Object.keys(ABILITY_WORDS)) {
          const to = `ability-up-${key}`;
          if (to !== from) out.push({ id: to, name: boonName(to, defs) });
        }
      } else if (bid !== base && !held.has(bid)) out.push({ id: bid, name: boonName(bid, defs) });
    }
    return out;
  };
  let pagesView = null;
  if (callingId === 'scrivener' && spec) {
    const max = (spec.abilities?.wit ?? 0) + (spec.level ?? level);
    const chosen = Array.isArray(pages) ? pages : Array.isArray(member.prepared) ? member.prepared : [];
    const spells = (calling?.spells || []).map((sid) => defs.get(sid)).filter((a) => a && !a.stub && a.circle >= 1 && a.circle <= (spec.charges?.circle ?? 0))
      .map((a) => ({ id: a.id, name: a.name, circle: a.circle, text: a.text || '', picked: chosen.includes(a.id) }));
    pagesView = { max, count: chosen.length, spells, staged: Array.isArray(pages), full: chosen.length >= max };
  }
  const notebook = member.notebook || {};
  const accepts = typeof notebook.accepts === 'string' ? notebook.accepts.slice(-50) : '';
  return {
    id: memberId,
    name: file?.name || regular?.name || (memberId === 'milo' ? 'Milo' : memberId),
    title: titleFor(file, level),
    look: regular ? regularLook(regular) : lookOf(memberId),
    calling: { id: callingId, name: calling?.name || upper(String(callingId || '').replace(/-/g, ' ')), role: calling?.role || null },
    level,
    path: path ? { id: path.id, name: path.name, text: path.text || '' } : null,
    paths: paths.map((p) => ({ id: p.id, name: p.name, text: p.text || '', current: p.id === member.path })),
    canSwapPath: atCamp && memberId === 'milo' && !!member.path && paths.length > 1,
    boons: boons.map((b) => ({ ...b, swaps: atCamp ? swapsFor(b.id) : [] })),
    warmth: memberId === 'milo' ? null : { n: warmth, step: STEP_WORDS[warmthStep(warmth)], next: next ? { name: STEP_WORDS[next[0]], at: next[1] } : null },
    fieldSkill: file?.fieldSkill ? FIELD_WORDS[file.fieldSkill] || upper(file.fieldSkill) : null,
    control: CONTROLS.includes(member.control) ? member.control : 'review',
    reactions,
    pending: pending.length > 0,
    pages: atCamp ? pagesView : pagesView ? { ...pagesView, locked: true } : null,
    notebook: { count: Number.isFinite(notebook.count) ? notebook.count : 0, fights: Number.isFinite(notebook.fights) ? notebook.fights : 0, sync: accepts.length ? Math.round((100 * [...accepts].filter((c) => c === '1').length) / accepts.length) : null },
    service: file?.service || null,
    atCamp,
  };
}

function segmented(action, label, options, current, data, { disabled = false } = {}) {
  const extra = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<div class="segmented" role="group" aria-label="${esc(label)}">${options.map((o) => `<button type="button" class="px-btn small" data-action="${esc(action)}"${extra}`
    + ` data-value="${esc(o.id)}" data-focus-key="${fkey(action, ...Object.values(data), o.id)}" aria-pressed="${o.id === current ? 'true' : 'false'}"${disabled ? ' disabled' : ''}>${esc(o.words)}</button>`).join('')}</div>`;
}

/** The company sheet's HTML (§12.4). Deterministic. */
export function buildCompany(view) {
  if (!view) return '<p class="quiet-note">Nobody by that name is in the company.</p>';
  const v = view;
  let html = `<section class="company-sheet" data-member="${esc(v.id)}">`;
  html += `<div class="sheet-head">${portraitCanvas(v.look, { label: v.name, size: 56 })}<div>`;
  html += `<p class="sheet-name">${esc(v.name)}${v.title ? ` <span class="sheet-title">${esc(v.title)}</span>` : ''}</p>`;
  html += `<p class="sheet-line">${esc(`${v.calling.name}, level ${v.level}`)}${v.calling.role ? ` · ${esc(v.calling.role)}` : ''}</p>`;
  if (v.fieldSkill) html += `<p class="sheet-line">${esc(`Field skill: ${v.fieldSkill}`)}</p>`;
  if (v.warmth) {
    html += `<p class="sheet-line">${esc(`Warmth ${v.warmth.n} · ${v.warmth.step}`)}${v.warmth.next ? ` <span class="sheet-note">${esc(`${v.warmth.next.name} at ${v.warmth.next.at}`)}</span>` : ''}</p>`;
  }
  html += '</div></div>';
  if (v.service) html += `<p class="panel-lede">${esc(v.service)}</p>`;
  if (v.pending) {
    html += `<p class="sheet-pending">A level up is waiting. <button type="button" class="link-btn" data-action="company-levelup" data-member="${esc(v.id)}" data-focus-key="${fkey('company-levelup', v.id)}">Choose now</button></p>`;
  }
  // Path
  html += '<section class="group sheet-path"><h3>Path</h3>';
  if (v.path) html += `<p class="sheet-line"><strong>${esc(v.path.name)}</strong> ${esc(v.path.text)}</p>`;
  else html += `<p class="quiet-note">${v.level >= 3 ? 'No path chosen yet.' : 'Opens at level 3.'}</p>`;
  if (v.canSwapPath) {
    html += segmented('company-path', 'Swap path', v.paths.map((p) => ({ id: p.id, words: p.name })), v.path?.id || null, { member: v.id });
  }
  html += '</section>';
  // Boons
  html += `<section class="group sheet-boons"><h3>Boons <span class="count">${v.boons.length}</span></h3>`;
  if (!v.boons.length) html += `<p class="quiet-note">${v.level >= 4 ? 'No boon taken yet.' : 'Opens at level 4.'}</p>`;
  html += '<ul class="boon-list">';
  for (const b of v.boons) {
    html += `<li class="boon" data-boon="${esc(b.id)}"><span>${esc(b.name)}</span>`;
    if (b.swaps.length) {
      html += `<details class="boon-swap"><summary>Swap</summary><div class="segmented" role="group" aria-label="${esc(`Swap ${b.name} for`)}">`
        + b.swaps.map((s) => `<button type="button" class="px-btn small" data-action="company-boon" data-member="${esc(v.id)}" data-from="${esc(b.id)}" data-to="${esc(s.id)}"`
          + ` data-focus-key="${fkey('company-boon', v.id, b.id, s.id)}">${esc(s.name)}</button>`).join('') + '</div></details>';
    }
    html += '</li>';
  }
  html += '</ul></section>';
  // Pages
  if (v.pages) {
    html += `<section class="group sheet-pages"><h3>Pages <span class="count">${v.pages.count} of ${v.pages.max}</span></h3>`;
    html += '<p class="group-note">The spells she has written out, Wit plus level of them.</p><ul class="pages-list">';
    for (const s of v.pages.spells) {
      html += `<li><button type="button" class="px-btn small" data-action="company-page" data-member="${esc(v.id)}" data-spell="${esc(s.id)}"`
        + ` data-focus-key="${fkey('company-page', v.id, s.id)}" aria-pressed="${s.picked ? 'true' : 'false'}"${v.pages.locked || (!s.picked && v.pages.full) ? ' disabled' : ''}>`
        + `${esc(s.name)} <span class="sheet-note">${esc(`Circle ${s.circle}`)}</span></button></li>`;
    }
    html += '</ul>';
    if (v.pages.locked) html += '<p class="quiet-note">Pages are written at camp or a lantern.</p>';
    else if (v.pages.staged) html += `<button type="button" class="px-btn primary" data-action="company-pages" data-member="${esc(v.id)}" data-focus-key="${fkey('company-pages', v.id)}">Write these Pages</button>`;
    html += '</section>';
  }
  // Who writes their turns, and reactions
  html += '<section class="group sheet-control"><h3>In a fight</h3>';
  html += `<p class="setting-label">Who writes ${esc(v.id === 'milo' ? 'his' : 'their')} turns</p>`;
  html += segmented('company-control', 'Who writes their turns', CONTROLS.map((c) => ({ id: c, words: CONTROL_WORDS[c] })), v.control, { member: v.id });
  if (v.reactions.length) {
    html += '<ul class="sheet-reactions">';
    for (const r of v.reactions) {
      html += `<li><p class="setting-label">${esc(r.name)}</p>${segmented('company-reaction', r.name, REACTION_SETTINGS.map((s) => ({ id: s, words: SETTING_WORDS[s] })), r.setting, { member: v.id, reaction: r.id })}</li>`;
    }
    html += '</ul>';
  }
  html += '</section>';
  // The notebook
  const nb = v.notebook;
  html += '<section class="group sheet-notebook"><h3>Notebook</h3>';
  html += `<p class="sheet-line">${esc(`Trained on ${nb.fights} of your fights${nb.sync === null ? '' : ` · sync ${nb.sync}%`}.`)}</p>`;
  html += `<button type="button" class="px-btn small" data-action="company-notebook" data-member="${esc(v.id)}" data-focus-key="${fkey('company-notebook', v.id)}">Open the notebook page</button>`;
  html += '</section>';
  return `${html}</section>`;
}

// ---------------------------------------------------------------------------
// mount(shell)

const NOOP = Object.freeze({ dispose() {}, refresh() {} });
const PREFIX = 'company:';

/**
 * Registers the `company:<id>` panels (§12.3). `options.atCamp()` says whether Milo is at camp
 * (the swaps show only there; the default reads state: no fight, not inside an Elsewhere).
 */
export function mount(shell, { atCamp = null } = {}) {
  try {
    if (!shell?.registerPanel) return NOOP;
    const staged = new Map(); // memberId → spell ids picked, before "Write these Pages"
    const content = () => shell.content?.() || {};
    const rules = () => content().combat?.rules || null;
    const here = () => (typeof atCamp === 'function' ? !!atCamp() : !shell.state?.expedition?.battle && shell.state?.expedition?.inside !== true);
    const memberOf = (panelId) => (typeof panelId === 'string' && panelId.startsWith(PREFIX) ? panelId.slice(PREFIX.length) : null);
    const view = (mid) => companyView(shell.state, mid, { content: content(), rules: rules(), now: shell.now?.() ?? 0, atCamp: here(), pages: staged.get(mid) || null });
    const apply = (next, focus) => {
      if (next !== shell.state) shell.set(next);
      shell.refreshPanel?.({ focus });
      return true;
    };
    const handle = shell.registerPanel(PREFIX, {
      title: (panelId) => view(memberOf(panelId))?.name || 'The company',
      exists: (panelId) => Object.hasOwn(shell.state?.party?.roster || {}, memberOf(panelId) || ''),
      render: (panelId) => {
        try { return buildCompany(view(memberOf(panelId))); } catch (err) { console.error(err); return '<p class="quiet-note">The sheet isn’t ready.</p>'; }
      },
      action: (button, panelId) => {
        const mid = memberOf(panelId);
        const act = button?.dataset?.action || '';
        if (!mid || !act.startsWith('company-')) return false;
        const state = shell.state;
        const now = shell.now?.() ?? 0;
        const focus = button.dataset.focusKey || null;
        const opts = { content: content(), rules: rules() };
        switch (act) {
          case 'company-control': return apply(setControl(state, mid, button.dataset.value, now), focus);
          case 'company-reaction': return apply(setReaction(state, mid, button.dataset.reaction, button.dataset.value, now), focus);
          case 'company-path': return apply(swapPath(state, mid, button.dataset.value, now, opts), focus);
          case 'company-boon': return apply(swapBoon(state, mid, button.dataset.from, button.dataset.to, now, opts), focus);
          case 'company-page': {
            const current = staged.get(mid) || [...(state?.party?.roster?.[mid]?.prepared || [])];
            const sid = button.dataset.spell;
            staged.set(mid, current.includes(sid) ? current.filter((s) => s !== sid) : [...current, sid]);
            shell.refreshPanel?.({ focus });
            return true;
          }
          case 'company-pages': {
            const ids = staged.get(mid) || [];
            const next = preparePages(state, mid, ids, now, { ...opts, where: 'camp' });
            staged.delete(mid);
            return apply(next, focus);
          }
          case 'company-notebook': shell.openPanel?.(`notebook:${mid}`); return true;
          case 'company-levelup': shell.openPanel?.(`levelup:${mid}`); return true;
          default: return false;
        }
      },
    });
    return {
      dispose() { if (typeof handle === 'function') handle(); },
      refresh() { staged.clear(); },
    };
  } catch (err) {
    console.error(err);
    return NOOP;
  }
}
