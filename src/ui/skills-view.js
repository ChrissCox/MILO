// Chris's 24 skills (CONTRACT-PHASE4.md §4.21, §7.6, §12.4 K1; PLAN.md §2, §4; LORE.md §12): the
// `skills` panel, with every skill's level, XP and guide (what its levels unlock, and where its XP
// comes from today); XP drops floating up over Milo (world.floatText, at most one a second); and a
// level-up bubble ("Cartography is level 5."). The camp panel's own "Skills" are Milo's Arts, a
// different thing: nothing here uses `.skill` or `data-skill`, which Phase 3 pins for those.
import { skillsView, xpForLevel, levelForXp, commas, skillName, SKILL_IDS } from '../lifeskills.js';
import { esc, CHECK, LOCK } from './panels.js';

export const id = 'skills';
export const PANEL = 'skills';
export const FAMILY_WORDS = Object.freeze({ life: 'Life skills', gathering: 'Gathering', making: 'Making and roaming' });
const FAMILIES = Object.freeze(['life', 'gathering', 'making']);
const MAX_LEVEL = 99;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const whole = (value) => (finite(value) ? Math.max(0, Math.floor(value)) : 0);

/** How far through its level a skill is, 0–100 (100 at 99). */
export function levelProgress(xp, level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, whole(level) || 1));
  if (lv >= MAX_LEVEL) return 100;
  const from = xpForLevel(lv);
  const to = xpForLevel(lv + 1);
  return to > from ? Math.max(0, Math.min(100, Math.floor(((whole(xp) - from) / (to - from)) * 100))) : 0;
}

/**
 * The panel's view: { skills: skillsView's rows grouped by family, open: the skill whose guide
 * shows, or null, total: the total level }.
 */
export function skillsPanelView(state, content, { open = null } = {}) {
  const rows = skillsView(state, content);
  return {
    families: FAMILIES.map((family) => ({ id: family, name: FAMILY_WORDS[family], skills: rows.filter((row) => row.family === family) })),
    open: SKILL_IDS.includes(open) ? open : null,
    total: rows.reduce((sum, row) => sum + row.level, 0),
  };
}

/** One skill's row, and its guide when it's open. */
export function skillRow(row, { open = false } = {}) {
  const r = isRecord(row) ? row : {};
  const skill = String(r.id || '');
  const level = whole(r.level) || 1;
  const progress = levelProgress(r.xp, level);
  const next = finite(r.next) ? `${commas(whole(r.xp))} of ${commas(r.next)} XP` : `${commas(whole(r.xp))} XP. As high as it goes.`;
  let html = `<li class="life-skill" data-life-skill="${esc(skill)}" data-level="${esc(level)}">`;
  // aria-controls only while the guide it names is in the page (it's built only when open).
  html += `<button type="button" class="life-skill-head" data-action="skills-guide" data-skill-id="${esc(skill)}" aria-expanded="${open ? 'true' : 'false'}"`
    + `${open ? ` aria-controls="guide-${esc(skill)}"` : ''} data-focus-key="skills-guide-${esc(skill)}">`
    + `<span class="life-skill-name">${esc(r.name || skillName(skill))}</span><span class="life-skill-level">Level ${esc(level)}</span></button>`;
  html += `<div class="xp-bar" role="img" aria-label="${esc(`${progress}% of the way to level ${Math.min(MAX_LEVEL, level + 1)}`)}"><i style="width:${progress}%"></i></div>`;
  html += `<p class="life-skill-xp">${esc(next)}</p>`;
  if (open) {
    html += `<div class="life-skill-guide" id="guide-${esc(skill)}">`;
    if (r.source) html += `<p class="setting-hint">${esc(r.source)}</p>`;
    const guide = Array.isArray(r.guide) ? r.guide.filter(isRecord) : [];
    if (guide.length) {
      html += '<ol class="levels guide-list">'
        + guide.map((u) => {
          const reached = whole(u.level) <= level;
          return `<li data-level-state="${reached ? 'proven' : 'locked'}">${reached ? CHECK : LOCK}<span class="level-name">Level ${esc(whole(u.level))}: ${esc(u.text || '')}</span>`
            + `${u.from ? `<span class="level-tag">${esc(u.from)}</span>` : ''}</li>`;
        }).join('') + '</ol>';
    }
    html += '</div>';
  }
  return `${html}</li>`;
}

/** The `skills` panel. view: skillsPanelView's. */
export function buildSkills(view) {
  const v = isRecord(view) ? view : { families: [], total: 0 };
  let html = `<div class="skills-view"><p class="panel-lede">Total level ${esc(whole(v.total))}.</p>`;
  for (const family of Array.isArray(v.families) ? v.families : []) {
    const skills = Array.isArray(family.skills) ? family.skills : [];
    html += `<section class="group life-skills" data-group="${esc(family.id)}"><h3>${esc(family.name)} <span class="count">${esc(skills.length)}</span></h3><ul class="life-skill-list">`;
    html += skills.map((row) => skillRow(row, { open: row.id === v.open })).join('');
    html += '</ul></section>';
  }
  return `${html}</div>`;
}

// ---------------------------------------------------------------------------
// XP drops and level-ups.

const skillsOf = (state) => (isRecord(state) && isRecord(state.xp) && isRecord(state.xp.skills) ? state.xp.skills : {});

/** What rose between two states: [{ skill, amount, level, levelled }], in SKILL_IDS order. */
export function xpDrops(before, after) {
  const a = skillsOf(before);
  const b = skillsOf(after);
  if (a === b) return [];
  const out = [];
  for (const skill of SKILL_IDS) {
    const from = whole(a[skill]);
    const to = whole(b[skill]);
    if (to <= from) continue;
    const level = levelForXp(to);
    out.push({ skill, amount: to - from, level, levelled: level > levelForXp(from) });
  }
  return out;
}

/** The pixel font's float: '+40 cartography xp' (lower case: the font has no capitals). */
export const dropText = (drop) => `+${commas(whole(drop?.amount))} ${String(drop?.skill || '').toLowerCase()} xp`.slice(0, 40);

/** The level-up bubble's line: 'Cartography is level 5.' */
export const levelLine = (drop, name = null) => `${name || skillName(drop?.skill)} is level ${whole(drop?.level)}.`;

/** Folds a drop into a queue: one entry a skill, its amounts added and its newest level kept. */
export function queueDrop(queue, drop) {
  const list = Array.isArray(queue) ? queue : [];
  if (!isRecord(drop) || !whole(drop.amount)) return list;
  const i = list.findIndex((d) => d.skill === drop.skill);
  if (i < 0) return [...list, { ...drop }];
  const merged = { ...list[i], amount: list[i].amount + drop.amount, level: drop.level, levelled: list[i].levelled || drop.levelled };
  return [...list.slice(0, i), merged, ...list.slice(i + 1)];
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/**
 * Registers the `skills` panel, and watches the state's XP: each rise floats up over Milo, at most
 * one a second (on 'second', so never while hidden), and a new level rings a bubble.
 */
export function mount(shell) {
  try {
    if (!shell) return NOOP;
    const offs = [];
    let open = null;
    let seen = shell.state;
    let queue = [];
    let wasOpen = false;
    const names = () => {
      const list = shell.content?.()?.skills?.skills;
      return Array.isArray(list) ? Object.fromEntries(list.filter(isRecord).map((s) => [s.id, s.name])) : {};
    };
    const render = () => {
      if (!shell.state?.tally?.features?.skills) Promise.resolve().then(() => shell.feature?.('skills'));
      return buildSkills(skillsPanelView(shell.state, shell.content?.(), { open }));
    };
    const action = (button) => {
      if (button?.getAttribute?.('data-action') !== 'skills-guide') return false;
      const skill = button.getAttribute('data-skill-id');
      if (!SKILL_IDS.includes(skill)) return false;
      open = open === skill ? null : skill;
      shell.refreshPanel({ focus: `skills-guide-${skill}` });
      return true;
    };
    if (typeof shell.registerPanel === 'function') {
      const off = shell.registerPanel(PANEL, { title: () => 'Skills', render: () => render(), exists: () => true, action: (button) => action(button) });
      if (typeof off === 'function') offs.push(off);
    }
    const flush = () => {
      if (!queue.length) return;
      const [drop, ...rest] = queue;
      queue = rest;
      const tile = shell.world('miloTile');
      if (tile) shell.world('floatText', dropText(drop), tile);
      if (drop.levelled) {
        const line = levelLine(drop, names()[drop.skill]);
        shell.bubble({ kind: 'skill', title: 'A new level', lines: [line], duration: 6000 });
      }
    };
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        const now = shell.state;
        if (now !== seen) {
          for (const drop of xpDrops(seen, now)) queue = queueDrop(queue, drop);
          seen = now;
        }
        const isOpen = now?.panel === PANEL;
        if (isOpen && !wasOpen) open = null;
        wasOpen = isOpen;
        if (isOpen) shell.refreshPanel({ passive: true });
      }));
      offs.push(shell.on('second', flush));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (shell.state?.panel === PANEL) shell.refreshPanel({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] skills mount', err);
    return NOOP;
  }
}
