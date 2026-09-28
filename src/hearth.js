// The Hearth: Milo's camp as a fortress that grows into a kingdom (WORLD.md §2,
// CONTRACT-PHASE3 §6). The tiers are content (content/fortress.json); what MILO can count for
// them is real and lives here. Requirements MILO can't count yet say what brings them, materials
// the wilds don't give yet say so, and Construction is shown but not asked for until the skills
// engine arrives. Pure ESM.
import { toTime } from './model.js';

/** Ward radius per tier (tiles beyond the vale's edge), used when content/fortress.json can't be read. */
export const WARD_RADII = Object.freeze([0, 12, 28, 48, 72, 100, 140, 200]);
export const TIER_MAX = 8;

// Requirement kinds MILO counts from real state in Phase 3.
const COUNTED = Object.freeze({
  'crew-sessions-finished': (state) => whole(state.tally?.sessionsFinished),
  'buildings-designed': (state) => whole(state.tally?.buildingsDesigned),
  'days-with-milo': (state) => whole(state.tally?.daysSeen),
});

// Everything else arrives with a later part of MILO (PLAN.md §13).
const FUTURE_NOTES = Object.freeze({
  'focus-sessions': 'Arrives with the Notice Board and its focus timer',
  'quests-finished': 'Arrives with the Notice Board',
  'delve-finished': 'Arrives with the Notice Board',
  residents: 'Arrives with the Notice Board',
  'building-level': 'Arrives with Commissions',
  'buildings-at-level': 'Arrives with Commissions',
  'calendar-connected': 'Arrives with Mistmere and the Tide',
  'skill-level': 'Arrives with the Adventurer’s Kit',
  'story-act': 'Arrives with the later acts of the story',
});
const LATER = 'Arrives later';

// Materials MILO can gather now: logs from the wilds, and what rifts leave behind.
const MATERIAL_NAMES = Object.freeze({
  birch: 'birch', ash: 'ash', pine: 'pine', stone: 'stone', copperstone: 'copperstone', ironroot: 'ironroot',
  'diesel-cog': 'diesel cogs', silverstone: 'silverstone', tidesteel: 'tidesteel', starsilver: 'starsilver',
  'maelstrom-glass': 'Maelstrom glass', emberheart: 'emberheart', 'essences-of-genres': 'essences of different genres',
});
const SINGULAR_NAMES = Object.freeze({ 'diesel-cog': 'diesel cog' });
const GATHERED_NOW = new Set(['birch', 'ash', 'pine', 'diesel-cog', 'maelstrom-glass', 'essences-of-genres']);
// Where the rest will come from, where PLAN.md says (Mining in the vale comes with the Notice Board).
const MATERIAL_NOTES = Object.freeze({ stone: 'Mined in the vale once the Notice Board arrives' });
const NOT_FOUND_YET = 'Not found in the wilds yet';
const MAELSTROM_GLASS = 'Maelstrom glass';
// Materials that are a rift's essences (RIFTS.md §6): Iron rifts drop Diesel cogs, a Maelstrom its glass.
const ESSENCE_MATERIALS = Object.freeze({ 'diesel-cog': 'Diesel cog', 'maelstrom-glass': MAELSTROM_GLASS });

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function whole(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function tiersOf(fortress) {
  const tiers = isRecord(fortress) && Array.isArray(fortress.tiers) ? fortress.tiers : [];
  return tiers.filter((tier) => isRecord(tier) && Number.isInteger(tier.tier));
}

/** The Hearth's tier in the state, 1..8. */
export function hearthTier(state) {
  const tier = whole(isRecord(state) ? state.hearth?.tier : 0);
  return Math.min(TIER_MAX, Math.max(1, tier || 1));
}

/** The Hearthward's radius at the current tier, in tiles beyond the vale's edge. */
export function wardRadius(state, fortress) {
  const tier = hearthTier(state);
  const def = tiersOf(fortress).find((entry) => entry.tier === tier);
  const radius = def?.wardRadius;
  return typeof radius === 'number' && Number.isFinite(radius) && radius >= 0 ? radius : WARD_RADII[tier - 1];
}

/**
 * The essences in the satchel grouped by the genre each came from → Map(genre → [names], most
 * held first, then by name). Maelstrom glass belongs to no one genre, so it isn't in any.
 */
function essencesByGenre(satchel) {
  const essences = isRecord(satchel.essences) ? satchel.essences : {};
  const genres = isRecord(satchel.essenceGenres) ? satchel.essenceGenres : {};
  const out = new Map();
  for (const name of Object.keys(essences)) {
    const genre = Object.hasOwn(genres, name) && typeof genres[name] === 'string' ? genres[name] : null;
    if (!genre || name === MAELSTROM_GLASS || !whole(essences[name])) continue;
    if (!out.has(genre)) out.set(genre, []);
    out.get(genre).push(name);
  }
  for (const names of out.values()) names.sort((a, b) => whole(essences[b]) - whole(essences[a]) || (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

/** How much of a material the satchel holds. Essences stand in for the rift-borne materials. */
function materialHave(state, id) {
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const materials = isRecord(satchel.materials) ? satchel.materials : {};
  const essences = isRecord(satchel.essences) ? satchel.essences : {};
  if (Object.hasOwn(ESSENCE_MATERIALS, id)) {
    const name = ESSENCE_MATERIALS[id];
    return whole(Object.hasOwn(essences, name) ? essences[name] : 0);
  }
  if (id === 'essences-of-genres') return essencesByGenre(satchel).size;
  return whole(Object.hasOwn(materials, id) ? materials[id] : 0);
}

function requirementOf(state, requirement) {
  const kind = typeof requirement.kind === 'string' ? requirement.kind : 'unknown';
  const need = whole(requirement.count) || 1;
  const text = typeof requirement.text === 'string' ? requirement.text : kind;
  const counter = Object.hasOwn(COUNTED, kind) ? COUNTED[kind] : null;
  const out = { kind, count: need, have: 0, met: false, text, future: !counter };
  if (typeof requirement.level === 'number') out.level = requirement.level;
  if (counter) {
    out.have = counter(state);
    out.met = out.have >= need;
  } else {
    out.note = Object.hasOwn(FUTURE_NOTES, kind) ? FUTURE_NOTES[kind] : LATER;
  }
  return out;
}

function materialsOf(state, materials) {
  if (!isRecord(materials)) return [];
  return Object.entries(materials).map(([id, amount]) => {
    const need = whole(amount);
    const have = materialHave(state, id);
    const out = { id, name: Object.hasOwn(MATERIAL_NAMES, id) ? MATERIAL_NAMES[id] : id.replace(/-/g, ' '), need, have, met: have >= need };
    if (!GATHERED_NOW.has(id)) {
      out.future = true;
      out.note = Object.hasOwn(MATERIAL_NOTES, id) ? MATERIAL_NOTES[id] : NOT_FOUND_YET;
    }
    return out;
  });
}

/** Every defence standing at this tier: the lower tiers' first, then its own. */
function standingDefences(tiers, tier) {
  return tiers.filter((entry) => entry.tier <= tier).sort((a, b) => a.tier - b.tier)
    .flatMap((entry) => (Array.isArray(entry.defences) ? entry.defences.filter(isRecord) : []));
}

/**
 * Where the Hearth stands and what the next tier needs, all from real counts. `def` is the tier
 * as fortress.json has it, except that its `defences` are all that stand now: the Camp's Lantern
 * Hook and Watchtower still stand once the Stockade is raised.
 * → { tier, def, wardRadius, next: null | { id, tier, name, look, requirements: [{ kind, count, have, met, text, future, note? }],
 *     materials: [{ id, name, need, have, met, future?, note? }], construction, constructionFrom, ready, defences, unlocks } }
 * `ready`: every requirement and material is met (Construction isn't asked for before Phase 4). Never throws.
 */
export function hearthStatus(state, fortress) {
  const s = isRecord(state) ? state : {};
  const tier = hearthTier(s);
  const tiers = tiersOf(fortress);
  const found = tiers.find((entry) => entry.tier === tier) || null;
  const def = found ? { ...found, defences: standingDefences(tiers, tier) } : null;
  const nextDef = tiers.find((entry) => entry.tier === tier + 1) || null;
  let next = null;
  if (nextDef) {
    const requirements = (Array.isArray(nextDef.requirements) ? nextDef.requirements : []).filter(isRecord).map((r) => requirementOf(s, r));
    const materials = materialsOf(s, nextDef.materials);
    next = {
      id: typeof nextDef.id === 'string' ? nextDef.id : `tier-${nextDef.tier}`,
      tier: nextDef.tier,
      name: typeof nextDef.name === 'string' ? nextDef.name : '',
      look: typeof nextDef.look === 'string' ? nextDef.look : '',
      requirements,
      materials,
      construction: typeof nextDef.construction === 'number' ? nextDef.construction : null,
      constructionFrom: typeof nextDef.constructionFrom === 'string' ? nextDef.constructionFrom
        : (isRecord(fortress) && typeof fortress.constructionFrom === 'string' ? fortress.constructionFrom : 'Phase 4'),
      ready: requirements.every((r) => r.met) && materials.every((m) => m.met),
      defences: (Array.isArray(nextDef.defences) ? nextDef.defences : []).filter(isRecord).map((d) => ({ name: String(d.name ?? ''), real: String(d.real ?? '') })),
      unlocks: (Array.isArray(nextDef.unlocks) ? nextDef.unlocks : []).filter((u) => typeof u === 'string'),
    };
  }
  return { tier, def, wardRadius: wardRadius(s, fortress), next };
}

// 'Spend a week' → 'spend a week', 'A year with MILO' → 'a year with MILO'; 'MILO' and 'I' stay.
const lowerFirst = (text) => (/^(?:[A-Z][a-z]|A\s)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** '30 more birch', '1 more diesel cog', 'essences of 2 more genres'. */
function moreOf(material) {
  const n = material.need - material.have;
  if (material.id === 'essences-of-genres') return `essences of ${n} more ${n === 1 ? 'genre' : 'genres'}`;
  const name = n === 1 && Object.hasOwn(SINGULAR_NAMES, material.id) ? SINGULAR_NAMES[material.id] : material.name;
  return `${n} more ${name}`;
}

/**
 * Why the next tier can't go up yet, in plain words. Materials the wilds don't give yet aren't
 * asked for: they're named once, as coming later.
 */
function notReadyReason(next) {
  // 'connect a calendar (Mistmere’s fog lifts; arrives with …)': one aside, never two in a row.
  const aside = (text, words) => (text.endsWith(')') ? `${text.slice(0, -1)}; ${words})` : `${text} (${words})`);
  const items = [
    ...next.requirements.filter((r) => !r.met).map((r) => aside(lowerFirst(r.text), r.future ? lowerFirst(r.note) : `${r.have} of ${r.count}`)),
    ...next.materials.filter((m) => !m.met && !m.future).map(moreOf),
  ];
  const later = next.materials.filter((m) => !m.met && m.future).map((m) => m.name);
  const parts = ['Not yet.'];
  if (items.length) parts.push(`Still to do: ${listWords(items)}.`);
  if (later.length) {
    const names = listWords(later);
    parts.push(`${names.charAt(0).toUpperCase()}${names.slice(1)} ${later.length === 1 ? 'comes' : 'come'} later.`);
  }
  return parts.join(' ');
}

/** Takes what a tier costs out of the satchel. */
function spend(satchel, materials) {
  const out = {
    ...satchel,
    materials: { ...(isRecord(satchel.materials) ? satchel.materials : {}) },
    essences: { ...(isRecord(satchel.essences) ? satchel.essences : {}) },
    essenceGenres: { ...(isRecord(satchel.essenceGenres) ? satchel.essenceGenres : {}) },
  };
  const take = (name, n) => {
    out.essences[name] = whole(out.essences[name]) - n;
    if (out.essences[name] <= 0) {
      delete out.essences[name];
      delete out.essenceGenres[name];
    }
  };
  for (const { id, need } of materials) {
    if (!need) continue;
    if (Object.hasOwn(ESSENCE_MATERIALS, id)) {
      take(ESSENCE_MATERIALS[id], need);
    } else if (id === 'essences-of-genres') {
      // One essence from each of `need` different genres (genres in id order), the most held of each.
      const genres = [...essencesByGenre(out).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, need);
      for (const [, names] of genres) take(names[0], 1);
    } else {
      out.materials[id] = Math.max(0, whole(out.materials[id]) - need);
    }
  }
  return out;
}

/**
 * Raises the Hearth by one tier when the next one is ready: spends its materials, sets
 * `hearth.tier` and records `hearth.raisedAt[tierId]`. → { ok, state, reason } (a new state when ok,
 * the same one otherwise; `reason` is a calm sentence either way).
 */
export function raiseHearth(state, fortress, now = Date.now()) {
  if (!isRecord(state)) return { ok: false, state, reason: 'There’s nothing to raise yet.' };
  const status = hearthStatus(state, fortress);
  if (!tiersOf(fortress).length) return { ok: false, state, reason: 'The Hearth’s plans aren’t loaded, so nothing can be raised right now.' };
  if (!status.next) return { ok: false, state, reason: 'The Hearth is as high as it goes.' };
  if (!status.next.ready) return { ok: false, state, reason: notReadyReason(status.next) };
  const at = toTime(now) ?? Date.now();
  const hearth = isRecord(state.hearth) ? state.hearth : {};
  const raisedAt = isRecord(hearth.raisedAt) ? hearth.raisedAt : {};
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  return {
    ok: true,
    state: {
      ...state,
      hearth: { ...hearth, tier: status.next.tier, raisedAt: { ...raisedAt, [status.next.id]: at } },
      satchel: spend(satchel, status.next.materials),
    },
    reason: `${status.next.name || 'The next tier'} is raised.`,
  };
}
