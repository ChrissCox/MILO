// What a commission pays once Chris has read it (PLAN.md Phase 6): Embers (economy.json's
// `commission` row, once each, up to its daily cap) and Command XP (xp.json's `commission` row, or
// `commission-proved` when it proved a building's level). Kept apart from src/commissions.js, which
// the save itself loads, so the rules never pull in the economy. Pure.
import { payCommission } from '../embers.js';
import { addXp } from '../lifeskills.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Materials from real outputs (LORE.md §12): they can't be gathered, only earned by real work. */
export const SPOILS = Object.freeze({ 'forged-part': 'Forged Part', 'captains-seal': 'Captain’s Seal' });

/**
 * What a commission's spoils chest holds: a Forged Part when it really changed files, and a
 * Captain's Seal when its building's check passed or it proved a level. → { [id]: n }
 */
export function spoilsFor(commission, { proved = false } = {}) {
  const c = isRecord(commission) ? commission : {};
  const out = {};
  if (c.ward === 'change' && Array.isArray(c.result?.files) && c.result.files.length) out['forged-part'] = 1;
  if (proved || c.check?.ok === true) out['captains-seal'] = 1;
  return out;
}
const XP = Object.freeze({ commission: 100, 'commission-proved': 400 });

const rowOf = (rates, id) => {
  const list = Array.isArray(rates?.sources) ? rates.sources : [];
  const row = list.find((r) => isRecord(r) && r.id === id);
  return row && Number.isFinite(row.xp) ? row : null;
};

/**
 * Pays for a commission that came back and was read. Nothing for one that didn't finish.
 * → { state, paid: { embers, xp, skill } | null }
 */
export function payForCommission(state, commission, now, { economy = null, rates = null, proved = false } = {}) {
  const c = isRecord(commission) ? commission : null;
  if (!isRecord(state) || !c || !c.result || c.status === 'failed' || c.status === 'stopped' || !Number.isFinite(c.sentAt)) return { state, paid: null };
  let next = state;
  let embers = 0;
  const got = payCommission(next, { sentAt: c.sentAt, proved }, now, economy);
  if (got.entry) { next = got.state; embers = got.entry.n; }
  const id = proved ? 'commission-proved' : 'commission';
  const row = rowOf(rates, id);
  const gained = addXp(next, row?.skill || 'command', row ? row.xp : XP[id], now, { source: 'commission', text: row?.text || (proved ? 'A commission that proved a building’s level' : 'A commission came back and was read') });
  next = gained.state;
  const spoils = spoilsFor(c, { proved });
  if (Object.keys(spoils).length) {
    const satchel = isRecord(next.satchel) ? next.satchel : {};
    const materials = { ...(isRecord(satchel.materials) ? satchel.materials : {}) };
    for (const [id, n] of Object.entries(spoils)) materials[id] = (Number.isFinite(materials[id]) ? materials[id] : 0) + n;
    next = { ...next, satchel: { ...satchel, materials } };
  }
  return { state: next, paid: { embers, xp: gained.drop ? gained.drop.amount : 0, skill: row?.skill || 'command', spoils } };
}

/** '+5 Embers · Command +100 · a Forged Part', or ''. */
export function paidWords(paid) {
  if (!isRecord(paid)) return '';
  const parts = [];
  const spoils = isRecord(paid.spoils) ? Object.keys(paid.spoils).filter((id) => SPOILS[id]).map((id) => `a ${SPOILS[id]}`) : [];
  if (paid.embers > 0) parts.push(`+${paid.embers} ${paid.embers === 1 ? 'Ember' : 'Embers'}`);
  if (paid.xp > 0) parts.push(`${paid.skill.charAt(0).toUpperCase()}${paid.skill.slice(1)} +${paid.xp}`);
  parts.push(...spoils);
  return parts.join(' · ');
}
