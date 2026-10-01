// A Tale-lead's shown name (CONTRACT-PHASE4.md §7.3, COMBAT.md §8.3 "Names"). riftgen's name banks
// share a few names with the company (Juno, Lumi, Vesperine…), and a generated lead must never
// wear one: a companion or resident isn't something you settle. When a lead's name holds a company
// name as a whole word, the shown name swaps that word for the next name from the same genre's
// bank, picked from the rift's own seed, so the rift stays the same rift and riftgen.json stays
// untouched. A pairing tagged in leads.json as a planned hook keeps its name.
//
// Pure. Every place that shows a lead's name calls this with the same hooks
// (content.combat.leads.hooks.map((h) => h.name)), so the map, the panels and the fight agree,
// down to the clipping: a shown name is at most NAME_MAX characters (§5.2), cut at a word with "…".
import { hashInts } from './rng.js';

/** A shown name's longest length (UnitSpec.name, §5.2). */
export const NAME_MAX = 40;

/** A name clipped to NAME_MAX at a word, ending "…" when it was cut. */
export function clipName(text, max = NAME_MAX) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : cut).replace(/[\s,]+$/, '')}…`;
}

/** The company and residents' names a generated lead may not share (LORE.md §21). */
export const COMPANY_NAMES = Object.freeze([
  'Juno', 'Lumi', 'Vesperine', 'Ashcombe', 'Maddox', 'Holloway', 'Dusty', 'Calloway', 'Rivet', 'Pip', 'Mae', 'Tova',
  'Nell', 'Whisper', 'Jev', 'Milo', 'Tamsin',
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words, case as written: "Dusty" the name or the adjective, never "Riveta" or "Pippa".
const WORD = new Map(COMPANY_NAMES.map((name) => [name, new RegExp(`(?<![\\p{L}\\p{N}’'-])${escape(name)}(?![\\p{L}\\p{N}’'-])`, 'u')]));

/** The company names in a text, as whole words, in COMPANY_NAMES order. */
export function companyNamesIn(text) {
  const s = String(text ?? '');
  return COMPANY_NAMES.filter((name) => WORD.get(name).test(s));
}

// The list a word came from, so a swap reads like the original: the genre's names, or, when the
// word is an adjective right after "The" ("The Dusty Sheriff"), its adjectives; a place ("Lady of
// Ashcombe") swaps for another place. Patterns ({adj} Hall) are never offered.
function bankFor(bank, word, before) {
  if (!bank) return [];
  const names = bank.names || kaijuNames(bank);
  const has = (list) => Array.isArray(list) && list.includes(word);
  if (has(bank.adjectives) && /(?:^|\s)[Tt]he $/.test(before)) return bank.adjectives;
  if (has(names)) return names;
  for (const key of ['adjectives', 'places', 'titles', 'nouns']) if (has(bank[key])) return bank[key];
  return names;
}

function kaijuNames(bank) {
  const prefixes = bank.namePrefixes || [];
  const suffixes = bank.nameSuffixes || [];
  return prefixes.flatMap((p) => suffixes.map((s) => p + s));
}

/**
 * The name to show for a rift's Tale-lead: its own, unless that holds a company name as a whole
 * word that isn't a planned hook. Each such word becomes the next entry of its genre bank, starting
 * at hashInts(spec.seed, 'lead-name') % length and stepping until the whole name is clear.
 * hooks: names (a company name, or a lead's whole name) that keep their own.
 * Every shown name is clipped to NAME_MAX (clipName), hooked or not.
 */
export function leadDisplayName(spec, words, { hooks = [] } = {}) {
  const lead = spec?.taleLead;
  const name = typeof lead?.name === 'string' ? lead.name : '';
  if (!name) return name;
  const kept = new Set((Array.isArray(hooks) ? hooks : []).filter((h) => typeof h === 'string'));
  if (kept.has(name)) return clipName(name);
  const clashes = companyNamesIn(name).filter((word) => !kept.has(word));
  if (!clashes.length) return clipName(name);
  const genre = lead.genre || spec.genres?.[0];
  const bank = words?.genres?.[genre];
  let out = name;
  const start = hashInts(spec.seed >>> 0, 'lead-name');
  for (const word of clashes) {
    // Every place the word stands (a name can say it twice), each swapped the same way.
    for (let guard = 0; guard < 4; guard += 1) {
      const at = out.search(WORD.get(word));
      if (at < 0) break;
      const list = bankFor(bank, word, out.slice(0, at)).filter((entry) => typeof entry === 'string' && !entry.includes('{'));
      let swapped = null;
      for (let step = 0; step < list.length && swapped === null; step += 1) {
        const candidate = list[(start + step) % list.length];
        if (candidate !== word && companyNamesIn(candidate).length === 0) swapped = out.slice(0, at) + candidate + out.slice(at + word.length);
      }
      // A bank with nothing clear in it (none today) drops the word instead.
      out = swapped ?? (out.slice(0, at) + out.slice(at + word.length)).replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
    }
  }
  return clipName(out || 'The Tale-lead');
}
