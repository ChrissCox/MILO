// The combatant list (CONTRACT-PHASE4.md §12.4 K2, §12.1; COMBAT.md §15): in a fight the place
// list (#place-list, the accessible mirror of the canvas) lists every combatant first, `cb:<id>`,
// each labelled with describe.combatantLabel ("Glitch drone, 6 of 16 Integrity, Spooked 1,
// telegraphing Bite Milo, Hit or better 85%"). Activating one selects it as the target; it never
// walks. The shell (L2's renderPlaces) puts the landmarks and Leave after them.
//
// Pure: `combatantsView` reads a Battle, `buildCombatants` returns the list's <li> items in the
// same markup as panels.entityList, so the shell's click and focus handling is unchanged.
import { esc } from './panels.js';
import { combatantLabel, nameOf } from '../combat/describe.js';
import { oddsByTarget } from '../combat/abilities.js';

export const id = 'combatants';

/** The most combatants the list shows (§12.4: 16 plus landmarks in a fight). */
export const COMBATANTS_MAX = 16;

const unitIn = (battle, unitId) => (battle?.units || []).find((u) => u.id === unitId) || null;
const unseen = (u) => u.side !== 'party' && (u.conditions || []).some((c) => c.id === 'unseen');

/**
 * describe.combatantLabel's `oddsOf`: a telegraph's odds of landing a Hit or better, from its
 * unit's committed plan (the odds the foe's action will use). null when it has none to show.
 */
export function telegraphOdds(battle, ctx) {
  return (tele) => {
    const plan = battle?.plans?.[tele.unitId];
    const planned = plan?.slots?.[tele.slot];
    if (!planned || !ctx?.rules) return null;
    // A Void stray's false target (§7.2): the words name it, so the odds are the ones it would have
    // against it, never the real target's (which would give the real one away).
    const fake = tele.falseTarget || null;
    if (fake && !planned.target?.unit) return null;
    const action = fake ? { ...planned, target: { ...planned.target, unit: fake } } : planned;
    const want = fake ? [fake] : tele.targets || [];
    try {
      const rows = oddsByTarget(battle, tele.unitId, action, ctx, { slot: tele.slot, plan });
      const row = rows.find((r) => !want.length || want.includes(r.targetId)) || (fake ? null : rows[0]);
      return row ? row.odds : null;
    } catch {
      return null;
    }
  };
}

/**
 * The list's entries: every combatant still in the fight (sorted ones have gone home), in the
 * ribbon's order, the party first. An Unseen foe is only "Something unseen". → [{ id: 'cb:<id>',
 * unitId, side, label, selected }]
 */
export function combatantsView(battle, ctx = null, { selected = null } = {}) {
  if (!battle) return [];
  const oddsOf = ctx ? telegraphOdds(battle, ctx) : null;
  const order = Array.isArray(battle.order) && battle.order.length ? battle.order : (battle.units || []).map((u) => u.id);
  const units = order.map((uid) => unitIn(battle, uid)).filter((u) => u && !u.sorted);
  const party = units.filter((u) => u.side === 'party');
  const rest = units.filter((u) => u.side !== 'party');
  return [...party, ...rest].slice(0, COMBATANTS_MAX).map((u) => ({
    id: `cb:${u.id}`,
    unitId: u.id,
    side: u.side,
    label: unseen(u) ? 'Something unseen' : combatantLabel(battle, u.id, oddsOf ? { ...ctx, oddsOf } : null) || nameOf(battle, u.id),
    selected: selected === u.id,
  }));
}

/**
 * The combatant list's <li> items (§12.4): `data-entity="cb:<id>"` and `data-kind="combatant"`,
 * then any `landmarks` ({ id, kind, label, note }) as panels.entityList draws them. view: the
 * entries from combatantsView, or { combatants, landmarks }.
 */
export function buildCombatants(view) {
  const combatants = Array.isArray(view) ? view : Array.isArray(view?.combatants) ? view.combatants : [];
  const landmarks = Array.isArray(view?.landmarks) ? view.landmarks : [];
  const items = combatants.slice(0, COMBATANTS_MAX).map((c) => `<li><button type="button" data-entity="${esc(c.id)}" data-kind="combatant" data-side="${esc(c.side)}"`
    + `${c.selected ? ' aria-pressed="true"' : ''}>${esc(c.label)}</button></li>`);
  for (const e of landmarks) {
    items.push(`<li><button type="button" data-entity="${esc(e.id)}" data-kind="${esc(e.kind)}">${esc(e.label)}${e.note ? ` <span class="place-note">${esc(e.note)}</span>` : ''}</button></li>`);
  }
  if (!items.length) return '<li><p class="quiet-note">Nobody here.</p></li>';
  return items.join('');
}

/** The unit a combatant entity id names ('cb:f0' → 'f0'), or null. */
export const combatantId = (entityId) => (typeof entityId === 'string' && entityId.startsWith('cb:') ? entityId.slice(3) || null : null);

/** Nothing to mount: the shell's place list calls buildCombatants (L2). */
export function mount() {
  return { dispose() {} };
}
