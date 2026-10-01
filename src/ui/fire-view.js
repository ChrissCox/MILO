// The fire (PLAN.md Phase 5.4): the `fire` panel, opened from the camp. What Milo has gathered becomes
// the tonics and Cheers that fights already use. Short words: the detail is in the satchel. The rules
// are in src/camplife.js.
import { cookView, cook, RECIPES } from '../camplife.js';
import { esc } from './panels.js';

export const id = 'fire';
export const PANEL = 'fire';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const RECIPE_ID = /^[a-z][a-z-]{0,39}$/;

export const COPY = Object.freeze({
  empty: 'Nothing to cook with yet.',
  cook: 'Cook',
});

const needsWords = (needs) => needs.map((n) => `${n.n} ${n.name} (${n.have})`).join(', ');

/** The `fire` panel. view: camplife.cookView's; says: the last thing made. */
export function buildFire(view, says = '') {
  const list = Array.isArray(view) ? view.filter(isRecord) : [];
  let html = '<div class="fire-view">';
  if (says) html += `<p class="plot-note fire-says" data-note="made" tabindex="-1">${esc(says)}</p>`;
  const any = list.some((r) => r.needs.some((n) => n.have > 0));
  if (!any && !says) html += `<p class="quiet-note">${esc(COPY.empty)}</p>`;
  html += '<ul class="fire-list">';
  for (const r of list) {
    html += `<li class="fire-recipe" data-recipe="${esc(r.id)}" data-can="${r.can ? 'true' : 'false'}"><div class="fire-what"><strong>${esc(r.name)}</strong> <span class="fire-makes">${esc(r.makes)}</span>`
      + `<span class="fire-needs">${esc(needsWords(r.needs))}</span></div>`
      + (r.can
        ? `<button type="button" class="px-btn small primary" data-action="fire-cook" data-recipe="${esc(r.id)}" data-focus-key="fire-cook-${esc(r.id)}">${esc(COPY.cook)}</button>`
        : `<span class="fire-why">${esc(r.why || '')}</span>`)
      + '</li>';
  }
  return `${html}</ul></div>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Registers the `fire` panel. It follows the satchel while it's open. */
export function mount(shell) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const offs = [];
    let says = '';
    const render = () => buildFire(cookView(shell.state), says);
    const action = (button) => {
      if (button?.dataset?.action !== 'fire-cook') return false;
      const rid = button.dataset.recipe || '';
      if (!RECIPE_ID.test(rid)) return false;
      const r = cook(shell.state, rid, shell.now());
      const recipe = RECIPES.find((x) => x.id === rid);
      if (r.ok) {
        says = `Made ${recipe.name.toLowerCase()}.${r.xp ? ` Cooking +${r.xp}.` : ''}`;
        shell.set(r.state, { save: 300 });
        shell.log?.({ tab: 'milo', text: says, at: shell.now(), detail: null, action: null });
      } else says = r.why || '';
      shell.refreshPanel?.({ focus: `fire-cook-${rid}` });
      return true;
    };
    const off = shell.registerPanel(PANEL, { title: () => 'The fire', render: () => render(), exists: () => true, action: (b) => action(b) });
    if (typeof off === 'function') offs.push(off);
    let last = shell.state?.satchel;
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        if (shell.state?.satchel === last) return;
        last = shell.state?.satchel;
        if (shell.state?.panel === PANEL) shell.refreshPanel?.({ passive: true });
      }));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (shell.state?.panel === PANEL) shell.refreshPanel?.({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] fire mount', err);
    return NOOP;
  }
}
