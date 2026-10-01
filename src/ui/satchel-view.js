// The satchel (CONTRACT-PHASE4.md §8.2, §12.4 K1; COMBAT.md §11): the `satchel` panel (the HUD's
// Satchel tab), read-only: Marks, the party's tonics, and Phase 3's materials, essences and relics
// (through panels.satchelSection, so they read as they do in the Hearth's panel).
import { esc, satchelSection } from './panels.js';

export const id = 'satchel';
export const PANEL = 'satchel';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
const commas = (n) => String(whole(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The tonics the satchel counts, by their counter key (satchel.tonics), with their items' names. */
export const TONICS = Object.freeze([
  Object.freeze({ id: 'cordial', item: 'cordial', name: 'Hearthberry cordial' }),
  Object.freeze({ id: 'brew', item: 'brew-of-clear-morning', name: 'Brew of clear morning' }),
]);

export const COPY = Object.freeze({
  noTonics: 'No tonics yet.',
});

/** An item's name and text from the bundle's callings.json (its `items`), when it's there. */
function itemOf(content, itemId) {
  const callings = isRecord(content) && isRecord(content.combat) ? content.combat.callings : null;
  const lists = isRecord(callings) ? [callings.items, callings.abilities] : [];
  for (const list of lists) {
    const found = Array.isArray(list) ? list.find((x) => isRecord(x) && x.id === itemId) : isRecord(list) ? list[itemId] : null;
    if (isRecord(found)) return found;
  }
  return null;
}

/**
 * The panel's view: { marks, tonics: [{ id, name, qty, text }], satchel: satchelSection's view
 * ({ materials, essences: [{ name, qty, genre }], relics: [{ name, text }] }) }.
 */
export function satchelView(state, content = null) {
  const satchel = isRecord(state) && isRecord(state.satchel) ? state.satchel : {};
  const tonics = isRecord(satchel.tonics) ? satchel.tonics : {};
  const essences = isRecord(satchel.essences) ? satchel.essences : {};
  const genres = isRecord(satchel.essenceGenres) ? satchel.essenceGenres : {};
  return {
    marks: whole(satchel.marks),
    tonics: TONICS.map((tonic) => {
      const item = itemOf(content, tonic.item);
      return { id: tonic.id, name: typeof item?.name === 'string' ? item.name : tonic.name, qty: whole(tonics[tonic.id]), text: typeof item?.text === 'string' ? item.text : '' };
    }),
    satchel: {
      materials: isRecord(satchel.materials) ? satchel.materials : {},
      essences: Object.entries(essences).filter(([, n]) => whole(n) > 0).map(([name, n]) => ({ name, qty: whole(n), genre: typeof genres[name] === 'string' ? genres[name] : null })),
      relics: Array.isArray(satchel.relics) ? satchel.relics.filter(isRecord).map((r) => ({ name: String(r.name || ''), text: String(r.text || '') })) : [],
    },
  };
}

/** The `satchel` panel. view: satchelView's. */
export function buildSatchel(view) {
  const v = isRecord(view) ? view : {};
  let html = '<div class="satchel-view">';
  html += `<section class="group satchel-marks" data-group="marks"><h3>Marks</h3><p class="satchel-big"><strong>${esc(commas(v.marks))}</strong> ${whole(v.marks) === 1 ? 'Mark' : 'Marks'}</p></section>`;
  const tonics = Array.isArray(v.tonics) ? v.tonics.filter(isRecord) : [];
  html += '<section class="group satchel-tonics" data-group="tonics"><h3>Tonics</h3>';
  if (tonics.some((t) => whole(t.qty) > 0)) {
    html += `<ul class="defence-list tonic-list">${tonics.map((t) => `<li data-tonic="${esc(t.id)}"><strong>${esc(t.name)}</strong> <span class="qty">× ${esc(whole(t.qty))}</span>${t.text ? ` <span class="tonic-text">${esc(t.text)}</span>` : ''}</li>`).join('')}</ul>`;
  } else {
    html += `<p class="quiet-note">${esc(COPY.noTonics)}</p>`;
  }
  html += '</section>';
  html += satchelSection(isRecord(v.satchel) ? v.satchel : {});
  return `${html}</div>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Registers the `satchel` panel; it follows the state while it's open. */
export function mount(shell) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const offs = [];
    const render = () => buildSatchel(satchelView(shell.state, shell.content?.()));
    const off = shell.registerPanel(PANEL, { title: () => 'Satchel', render: () => render(), exists: () => true, action: () => false });
    if (typeof off === 'function') offs.push(off);
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => { if (shell.state?.panel === PANEL) shell.refreshPanel({ passive: true }); }));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (shell.state?.panel === PANEL) shell.refreshPanel({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] satchel mount', err);
    return NOOP;
  }
}
