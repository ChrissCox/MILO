// Every door of the fight in the shell (CONTRACT-PHASE4.md §12.4 "L", §4.18, §4.20, §8.3, §18.2
// items 3 and 9): stepping into a wild rift, a ladder rung, a real rift or the story's crack, going
// into a cave and Challenging a field boss, each with its Ember spend after the still-standing
// check and before entering; the free way back in after everyone went offline; the expedition's
// life in `state.expedition` (made on stepping in, kept through Head home, Go home and relaunches,
// cleared when its place closes or another place is entered); boot's resume, rebuilt from
// `expedition.source` and never from the live signal; and the field skills (Light, Read, Pick,
// Sort, Riddle). Pure functions first (Node tests call them), then `createExpedition(shell, …)`,
// the thin part that drives the world through `shell`.
//   node --test tests/expedition.test.js
import { isRecord, clip, cleanCount, dayNumber, dayStart } from '../clean.js';
import { entryCost, spend } from '../embers.js';
import { roadLevel, fightingLevel, partySpecs, payFight, payStitch } from '../party.js';
import { loadRules } from '../combat/rules.js';
import { buildAbilityIndex } from '../combat/abilities.js';
import { prepareElsewhere, prepareCave, fieldFight, roomLevel, rewardsFor } from '../combat/encounters.js';
import { caveSpec, caveLayout, caveSource, caveFromSource } from '../world/caves.js';
import { isFieldBoss, fieldArena } from '../world/fieldboss.js';
import { CHUNK } from '../world/worldgen.js';
import { pickLine, openChest as wildChest, materialsText } from './wildtext.js';

export const id = 'expedition';

export const KINDS = Object.freeze(['wild', 'rung', 'real', 'story', 'cave', 'field']);
const ROOM_OUTCOMES = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page']);
const LANTERN_ID = /^lantern:-?\d{1,7},-?\d{1,7}$/;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const valueOf = (v) => (typeof v === 'function' ? v() : v);
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);
const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// The content a door needs, loaded once per bundle.

const combatCache = new WeakMap();

/**
 * The loaded combat rules, the ability index, riftgen's words and the lead name hooks for a content
 * bundle (§7.1's ctx pieces that never change between fights), made once per bundle. null when the
 * combat content can't be loaded.
 */
export function combatOf(content) {
  if (!isRecord(content) || !isRecord(content.combat)) return null;
  if (combatCache.has(content)) return combatCache.get(content);
  let out = null;
  try {
    const combat = content.combat;
    out = {
      rules: loadRules(combat.rules, combat.tuning || null),
      abilities: buildAbilityIndex({
        callings: combat.callings, spells: combat.spells, companions: content.party?.companions,
        regulars: content.party?.regulars, foes: combat.foes, leads: combat.leads,
      }),
      words: content.riftgen,
      hooks: (Array.isArray(combat.leads?.hooks) ? combat.leads.hooks : []).map((h) => h?.name).filter((h) => typeof h === 'string'),
    };
  } catch (error) {
    console.error('[MILO] combat content', error);
    out = null;
  }
  combatCache.set(content, out);
  return out;
}

// ---------------------------------------------------------------------------
// Places and their sources (§8.3, §18.2 items 3 and 9)

/** What kind of place a rift record is: 'wild', 'rung' (a ladder rung, made by going deeper), 'real' or 'story'. */
export function placeKind(rift) {
  if (!isRecord(rift)) return null;
  if (rift.kind === 'cave' || rift.spec?.kind === 'cave') return 'cave';
  if (rift.kind === 'story' || /^story:/.test(String(rift.key || rift.spec?.key || ''))) return 'story';
  if (rift.kind === 'real') return 'real';
  if (rift.kind === 'wild' || rift.kind === 'ladder') return typeof rift.parent === 'string' && rift.parent ? 'rung' : 'wild';
  return null;
}

/**
 * The inputs a wild rift was made from (§18.2 item 9): `worldgen.wildRiftSpawns(cx, cy, day)`'s
 * spawn whose seed is the rift's, weights included, since the rift record carries no weights and
 * rifts.js is frozen. The spawn is looked for in the rift's chunk and its neighbours, under the ward
 * the rift was placed with and then none; a candidate counts only when it rebuilds the very spec.
 * → { seed, tier, depth, weights } or null.
 */
export function spawnInputs(rift, { worldgen, riftgen = null, wardRadius = 0, day = null } = {}) {
  const spec = rift?.spec;
  if (!isRecord(spec) || !Number.isInteger(spec.seed) || !worldgen || typeof worldgen.wildRiftSpawns !== 'function') return null;
  const d = Number.isInteger(day) ? day : finite(rift.since) ? dayNumber(rift.since) : null;
  if (d === null || !finite(rift.x) || !finite(rift.y)) return null;
  const cx = Math.floor(rift.x / CHUNK);
  const cy = Math.floor(rift.y / CHUNK);
  const chunks = [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
  const wards = [...new Set([finite(wardRadius) && wardRadius > 0 ? wardRadius : 0, 0])];
  for (const ward of wards) {
    for (const [x, y] of chunks) {
      let spawns = [];
      try { spawns = worldgen.wildRiftSpawns(x, y, d, { wardRadius: ward }); } catch { spawns = []; }
      for (const s of spawns) {
        if (s?.seed !== spec.seed) continue;
        const inputs = { seed: s.seed, tier: s.tier, depth: s.depth, weights: { ...(s.weights || {}) } };
        if (!riftgen || jsonEqual(riftgen.wildRift(inputs), spec)) return inputs;
      }
    }
  }
  return null;
}

// The urgency a real rift's spec was built at: the rift's own, unless a ward held it at its stage
// (rifts.js builds a warded rift at the stage's urgency), so the one that rebuilds the spec wins.
function realUrgency(rift, riftgen) {
  const tries = [rift.urgency, 0.2, 0.5, 0.9].filter(finite);
  for (const urgency of tries) {
    try {
      const spec = riftgen.realRift(realInputs(rift, urgency));
      if (jsonEqual(spec, rift.spec)) return urgency;
    } catch { /* the next */ }
  }
  return finite(rift.urgency) ? rift.urgency : 0.5;
}

function realInputs(rift, urgency) {
  const spec = rift.spec || {};
  const signals = Array.isArray(rift.signals) ? rift.signals : Array.isArray(spec.signals) ? spec.signals : [];
  return { key: rift.key ?? spec.key, subject: spec.subject ?? rift.subject ?? null, signals: [...signals], urgency, tier: spec.tier ?? 1, cause: spec.cause ?? rift.cause ?? '' };
}

/**
 * The expedition's `source` for a place (§8.3), taken at entry:
 * - wild: the spawn's inputs `{ seed, tier, depth, weights, rungs: 0, x, y }`;
 * - rung: the base wild rift's inputs with `rungs` (how many times `riftgen.deeper` ran);
 * - field: the spawn's inputs with the rift's `x, y`;
 * - real and story: `riftgen.realRift`'s inputs as they are now `{ key, subject, signals, urgency, tier, cause, since, x, y }`;
 * - cave: `{ poi, day }` (caves.caveSource).
 * `base` is the parent's source when going deeper. null when it can't be taken.
 */
export function sourceFor(kind, place, { worldgen = null, riftgen = null, wardRadius = 0, base = null } = {}) {
  if (kind === 'cave') return caveSource(place);
  if (!isRecord(place) || !isRecord(place.spec)) return null;
  const at = { x: finite(place.x) ? place.x : null, y: finite(place.y) ? place.y : null };
  if (kind === 'rung') {
    if (!isRecord(base) || !Number.isInteger(base.seed)) return null;
    return { seed: base.seed, tier: base.tier, depth: base.depth, weights: { ...(base.weights || {}) }, rungs: cleanCount(base.rungs) + 1, x: base.x ?? at.x, y: base.y ?? at.y };
  }
  if (kind === 'wild' || kind === 'field') {
    const inputs = spawnInputs(place, { worldgen, riftgen, wardRadius });
    if (!inputs) return null;
    return kind === 'wild' ? { ...inputs, rungs: 0, ...at } : { ...inputs, x: place.x, y: place.y };
  }
  if (kind === 'real' || kind === 'story') {
    if (!riftgen || typeof place.key !== 'string') return null;
    const inputs = realInputs(place, realUrgency(place, riftgen));
    return { ...inputs, subject: inputs.subject, cause: clip(inputs.cause, 160), since: finite(place.since) ? place.since : null, ...at };
  }
  return null;
}

/**
 * The place an expedition stands for, rebuilt from its `source` alone (never the live signal):
 * a rift record `{ id, key, kind, spec, x, y, since, … }` for a rift or field boss, or `{ cave }`.
 * → { rift, cave } or null when the source no longer makes the place its riftId names.
 */
export function rebuildPlace(expedition, { riftgen = null, worldgen = null, wilds = null, content = null } = {}) {
  if (!isRecord(expedition) || !isRecord(expedition.source)) return null;
  const s = expedition.source;
  try {
    if (expedition.kind === 'cave') {
      const cave = caveFromSource(s, { worldgen, wilds, words: content?.riftgen ?? null, foes: content?.combat?.foes ?? null });
      return cave && cave.id === expedition.riftId ? { rift: null, cave } : null;
    }
    if (!riftgen) return null;
    let spec;
    let kind = expedition.kind;
    if (kind === 'wild' || kind === 'rung' || kind === 'field') {
      spec = riftgen.wildRift({ seed: s.seed, tier: s.tier, depth: s.depth, weights: s.weights || {} });
      const rungs = kind === 'rung' ? cleanCount(s.rungs) : 0;
      for (let i = 0; i < rungs; i += 1) spec = riftgen.deeper(spec);
      kind = 'wild';
    } else {
      spec = riftgen.realRift({ key: s.key, subject: s.subject, signals: s.signals, urgency: s.urgency, tier: s.tier, cause: s.cause });
    }
    if (!isRecord(spec) || spec.id !== expedition.riftId) return null;
    const rift = {
      id: spec.id, key: expedition.kind === 'real' || expedition.kind === 'story' ? s.key : null, kind: expedition.kind === 'story' ? 'story' : kind,
      spec, x: finite(s.x) ? s.x : null, y: finite(s.y) ? s.y : null, stage: spec.stage, since: expedition.since ?? null,
      cause: s.cause ?? null, subject: s.subject ?? null, signals: Array.isArray(s.signals) ? [...s.signals] : undefined,
    };
    return { rift, cave: null };
  } catch (error) {
    console.error('[MILO] rebuilding the place', error);
    return null;
  }
}

/** Whether two expeditions (or an expedition and a door's entry) are the same place, the same episode. */
export function samePlace(a, b) {
  if (!isRecord(a) || !isRecord(b) || a.kind !== b.kind || a.riftId !== b.riftId) return false;
  if (a.kind === 'real' || a.kind === 'story') return a.key === b.key && (a.since ?? null) === (b.since ?? null);
  if (a.kind === 'cave') return a.source?.day === b.source?.day;
  if (a.kind === 'rung') return a.source?.seed === b.source?.seed && cleanCount(a.source?.rungs) === cleanCount(b.source?.rungs);
  return true;
}

const placeDay = (expedition) => (finite(expedition.since) ? dayNumber(expedition.since) : finite(expedition.enteredAt) ? dayNumber(expedition.enteredAt) : null);

/**
 * Whether an expedition's place has closed (§4.18): a cave when the day rolls (its rooms reset each
 * real day); a wild rift, rung or field boss when its id rolls over with the day, or once it's
 * stitched or let go today and the party is out of it; a real or story rift when its episode ends
 * (no rift standing now has its key and `since`; only judged when `rifts` is a real look).
 */
export function placeClosed(expedition, { now, rifts = null, closedWild = null } = {}) {
  if (!isRecord(expedition) || !finite(now)) return false;
  const today = dayNumber(now);
  if (expedition.kind === 'cave') return expedition.source?.day !== today;
  if (expedition.kind === 'wild' || expedition.kind === 'rung' || expedition.kind === 'field') {
    const day = placeDay(expedition);
    if (day !== null && day !== today) return true;
    return !expedition.inside && isRecord(closedWild) && own(closedWild, expedition.riftId) === today;
  }
  if (!Array.isArray(rifts)) return false;
  return !rifts.some((r) => isRecord(r) && r.key === expedition.key
    && (!finite(expedition.since) || !finite(r.since) || r.since === expedition.since));
}

/**
 * The frontier's pass (§4.18; normalisers never do this): an expedition whose place closed is
 * cleared, unless a fight is saved in it. That one is marked `closing` instead, and the fight ends
 * (a real or story rift's with the `end` command, "The seam closed while you were away.") before
 * the expedition goes. `rifts` is the loop's look at the standing rifts, or null when there was no
 * real look (then a real rift is never judged closed). → state (the same object when unchanged)
 */
export function clearClosed(state, { now, rifts = null } = {}) {
  const expedition = state?.expedition;
  if (!isRecord(expedition)) return state;
  if (!placeClosed(expedition, { now, rifts, closedWild: state?.rifts?.closedWild })) return state;
  if (expedition.battle != null) return expedition.closing === true ? state : { ...state, expedition: { ...expedition, closing: true } };
  // Inside a place that closed around the party (a seal while they're in, a midnight): it goes once they're out.
  if (expedition.inside) return state;
  return { ...state, expedition: null };
}

// ---------------------------------------------------------------------------
// The expedition's life

const runIdOf = (kind, now) => `${kind}:${Math.max(0, Math.round(now)).toString(36)}`;

/**
 * Steps in (§4.18): the same place keeps its settled rooms, opened chests and the levels it was
 * built at, and is inside again; any other place replaces it. `entry` is a door's
 * { kind, riftId, key, since, source, depth, tier, roadLevel, partySize }. → state
 */
export function beginExpedition(state, entry, now, { cost = 0 } = {}) {
  const old = state.expedition;
  const same = samePlace(old, entry);
  const base = same ? old : {
    runId: runIdOf(entry.kind, now), kind: entry.kind, riftId: entry.riftId ?? null, key: entry.key ?? null, since: entry.since ?? null,
    source: entry.source, depth: entry.depth ?? 1, tier: entry.tier ?? 1, enteredAt: now, embersPaid: 0, inside: true,
    rooms: {}, chests: {}, nookUsed: false, entry: {}, battle: null, card: null,
    roadLevel: entry.roadLevel ?? 1, partySize: entry.partySize ?? 4,
  };
  return {
    ...state,
    expedition: { ...base, enteredAt: Math.round(now), embersPaid: cleanCount(base.embersPaid) + cleanCount(cost), inside: true, battle: null, card: null, closing: false },
  };
}

/**
 * A door (§12.4, §4.20): what stepping in costs (a story rift 0; nothing once after everyone went
 * offline, which uses the grant up), the spend, then the expedition. Call it after the
 * still-standing check and before entering. `entry`: { kind, riftId, key, since, source, depth,
 * tier, text, roadLevel, partySize }. → { ok, state, words, cost, free }; a short wallet refuses
 * calmly ("That needs 5 Embers. You have 3.") and changes nothing.
 */
export function door(state, entry, now, { economy = null } = {}) {
  if (!isRecord(state) || !isRecord(entry) || !KINDS.includes(entry.kind) || !finite(now)) {
    return { ok: false, state, words: 'The way in isn’t open just now.', cost: 0, free: false };
  }
  const rests = isRecord(state.party?.rests) ? state.party.rests : {};
  const grants = isRecord(rests.freeReentry) ? rests.freeReentry : {};
  const grant = [entry.riftId, entry.key].find((k) => typeof k === 'string' && Object.hasOwn(grants, k)) || null;
  const price = entryCost(entry.kind === 'rung' ? 'wild' : entry.kind, { depth: entry.depth, economy });
  const cost = grant ? 0 : price;
  const paid = spend(state, { n: cost, what: entry.kind, text: entry.text || null }, now, economy);
  if (!paid.ok) return { ok: false, state, words: paid.reason, cost, free: false };
  let next = paid.state;
  if (grant) {
    const rest = { ...grants };
    delete rest[grant];
    next = { ...next, party: { ...next.party, rests: { ...rests, freeReentry: rest } } };
  }
  return { ok: true, state: beginExpedition(next, entry, now, { cost }), words: null, cost, free: Boolean(grant) };
}

/** Out of the place (Head home, Go home, the way home, everyone offline): `inside` false; the rest is kept. */
export function leaveExpedition(state) {
  const e = state?.expedition;
  if (!isRecord(e) || (!e.inside && e.battle == null && e.card == null)) return state;
  return { ...state, expedition: { ...e, inside: false, battle: null, card: null } };
}

/** A room settled ('won', 'talked', 'bowed', 'yielded' or 'last-page'): it stays settled until the place closes. */
export function settleRoom(state, roomId, outcome) {
  const e = state?.expedition;
  if (!isRecord(e) || typeof roomId !== 'string' || !ROOM_OUTCOMES.has(outcome) || own(e.rooms, roomId) === outcome) return state;
  return { ...state, expedition: { ...e, rooms: { ...(isRecord(e.rooms) ? e.rooms : {}), [roomId]: outcome } } };
}

/** A chest opened in the place, remembered until it closes. */
export function markChest(state, lootId, now) {
  const e = state?.expedition;
  if (!isRecord(e) || typeof lootId !== 'string' || own(e.chests, lootId) != null) return state;
  return { ...state, expedition: { ...e, chests: { ...(isRecord(e.chests) ? e.chests : {}), [lootId]: Math.round(now) } } };
}

/**
 * The world ids hidden while in the expedition's place (J's hideActors): settled rooms' posts
 * (`enc:<roomId>`), the Tale-lead once its room is settled, a Mimic's chest once its fight began,
 * and a settled field boss's roaming lead.
 */
export function hiddenFor(expedition, { mimics = [] } = {}) {
  if (!isRecord(expedition)) return [];
  const rooms = isRecord(expedition.rooms) ? Object.keys(expedition.rooms) : [];
  if (expedition.kind === 'field') return rooms.includes('field') ? [`stray:${expedition.riftId}:lead`] : [];
  const out = rooms.filter((r) => r !== 'mimic').map((r) => `enc:${r}`);
  if (rooms.includes('lead')) out.push('tale-lead');
  const chests = isRecord(expedition.chests) ? expedition.chests : {};
  for (const chest of mimics) if (Object.hasOwn(chests, chest.id) || rooms.includes('mimic')) out.push(chest.id);
  return out;
}

// ---------------------------------------------------------------------------
// Making a place ready for its fights

/**
 * A place made fight-ready (§7.3, §7.7): a rift's Elsewhere through `encounters.prepareElsewhere`,
 * a cave through `prepareCave` on its own layout, a field boss through `fieldArena` and
 * `fieldFight`. `level` and `size` are the Road level and party size the expedition was built at.
 * → { kind, riftId, rift, cave, layout, plan, encounters, field } or null.
 */
export function preparePlace(kind, { rift = null, cave = null }, { content, riftgen, worldgen = null, wilds = null, walkable = null, level = 1, size = 4 } = {}) {
  const combat = combatOf(content);
  if (!combat) return null;
  const { rules, words, hooks } = combat;
  const base = { roadLevel: level, partySize: size, rules, leads: content.combat.leads, foes: content.combat.foes, tuning: content.combat.tuning || null, words, hooks };
  try {
    if (kind === 'cave') {
      const layout = caveLayout(cave, riftgen);
      const ready = prepareCave(cave, { layout, roadLevel: level, partySize: size, rules, foes: content.combat.foes, words, day: cave.day, genres: content.genres });
      return { kind, riftId: cave.id, rift: null, cave, ...ready, field: null };
    }
    if (kind === 'field') {
      const fa = fieldArena(rift, { worldgen, wilds, walkable, genres: content.genres, leads: content.combat.leads, rules: content.combat.rules });
      const fight = fa ? fieldFight(rift, fa.arena, base) : null;
      return fight ? { kind, riftId: rift.id, rift, cave: null, layout: null, plan: null, encounters: null, field: { fight, hiddenTrees: [...fa.hiddenTrees] } } : null;
    }
    const real = kind === 'real' || kind === 'story';
    const ready = prepareElsewhere(rift.spec, {
      riftgen, genres: content.genres, kind: real ? kind : 'wild', ...base,
      riftKey: real ? rift.key : null, since: real ? rift.since : null, cause: real ? rift.cause || rift.spec.cause || '' : null,
    });
    return { kind, riftId: rift.id, rift, cave: null, ...ready, field: null };
  } catch (error) {
    console.error('[MILO] preparing the place', error);
    return null;
  }
}

/** A room's FightSpec in a prepared place: a room id, 'lead', 'field', or 'mimic' (the cave's Mimic chest). */
export function fightFor(prepared, roomId) {
  if (!isRecord(prepared)) return null;
  if (roomId === 'field') return prepared.field?.fight ?? null;
  if (roomId === 'mimic') return (prepared.encounters?.chests || []).find((c) => c?.mimic?.fight)?.mimic.fight ?? null;
  return (prepared.encounters?.rooms || []).find((r) => r.roomId === roomId)?.fight ?? null;
}

/** The Mimic chests of a prepared cave: [{ id, x, y }]. */
export const mimicsOf = (prepared) => (prepared?.encounters?.chests || []).filter((c) => c?.mimic).map((c) => ({ id: c.id, x: c.x, y: c.y }));

/**
 * A wild stitch's pay (§4.13, §4.21; L2's stitchInside calls it): Road XP, Warding and Seamcraft
 * through party.payStitch at the rift's room level and depth, keyed `stitch:<riftId>` so it pays
 * once, across a relaunch too (a wild rift's id is the day's). → { state, paid, xp }
 */
export function payWildStitch(state, rift, now, { content } = {}) {
  const combat = combatOf(content);
  const spec = rift?.spec;
  if (!combat || !isRecord(spec) || typeof rift.id !== 'string') return { state, paid: false, xp: 0 };
  const { n } = roomLevel(spec, { kind: 'wild', roadLevel: roadLevel(state, combat.rules).level, rules: combat.rules });
  return payStitch(state, { kind: 'wild', level: n, depth: spec.depth || 1, key: `stitch:${rift.id}` }, now, { rules: combat.rules, xp: content?.xp ?? null });
}

// ---------------------------------------------------------------------------
// Suggested levels (§3.1 Modes, §12.4: the rift panel and the War Table)

const theName = (name) => String(name || '').replace(/^The /, 'the ');
const listWords = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * What a rift runs at against the company (§3.1): { room, road, average, above: names[], words }:
 * "Runs at level 5. Your company is level 3 (4 on average, with the Scribe)." `above` names the
 * Wayfarers fighting over the Road level. null without the combat content or a spec.
 */
export function suggestedLevel(rift, state, { content } = {}) {
  const combat = combatOf(content);
  const spec = rift?.spec;
  if (!combat || !isRecord(spec)) return null;
  const { rules } = combat;
  const road = roadLevel(state, rules).level;
  const kind = placeKind(rift);
  const { n } = roomLevel(spec, { kind: kind === 'real' || kind === 'story' ? kind : 'wild', roadLevel: road, rules });
  const ids = ['milo', ...(Array.isArray(state?.party?.chosen) ? state.party.chosen : [])];
  const levels = ids.map((id) => ({ id, level: fightingLevel(state, id, rules) }));
  const average = Math.round(levels.reduce((s, l) => s + l.level, 0) / Math.max(1, levels.length));
  const companions = content.party?.companions || {};
  const regulars = Array.isArray(state?.party?.regulars) ? state.party.regulars : [];
  const nameOf = (who) => theName(companions[who]?.name || regulars.find((r) => r?.id === who)?.name || who);
  const above = levels.filter((l) => l.level > road).map((l) => nameOf(l.id));
  const words = average !== road && above.length
    ? `Runs at level ${n}. Your company is level ${road} (${average} on average, with ${listWords(above)}).`
    : `Runs at level ${n}. Your company is level ${road}.`;
  return { room: n, road, average, above, words };
}

// ---------------------------------------------------------------------------
// Field skills (§3.1, §12.4) and the cave's chests

export const FIELD_SKILLS = Object.freeze({ light: 'milo', read: 'claude', pick: 'codex', sort: 'jev', riddle: 'tollkeeper' });
const SKILL_FOES = Object.freeze({ read: 'unwritten', riddle: 'tollmen' });

function inParty(state, who) {
  return who === 'milo' || (Array.isArray(state?.party?.chosen) && state.party.chosen.includes(who));
}

function needWords(state, who, content) {
  const name = theName(content?.party?.companions?.[who]?.name || who);
  if (!isRecord(state?.party?.roster) || !Object.hasOwn(state.party.roster, who)) return `That needs ${name}, who hasn’t joined the Company yet.`;
  return `That needs ${name}, who’s at camp just now.`;
}

function addMaterials(state, materials) {
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const current = isRecord(satchel.materials) ? satchel.materials : {};
  const next = { ...current };
  let changed = false;
  for (const [mid, n] of Object.entries(materials || {})) {
    const amount = cleanCount(n);
    if (!amount) continue;
    next[mid] = cleanCount(cleanCount(current[mid]) + amount);
    changed = true;
  }
  return changed ? { ...state, satchel: { ...satchel, materials: next } } : state;
}

const lootIdOf = (target) => (typeof target?.id === 'string' ? target.id : '');
const isChest = (target) => isRecord(target) && (target.kind === 'loot' || target.kind === 'chest' || /^loot:\d+$/.test(String(target.id || '')));
const chestOpen = (state, target) => target.opened === true || own(state?.expedition?.chests, lootIdOf(target)) != null;

/** The words for opening a cave chest: what was inside, from wilds.json's chest ranges, seeded by the cave and chest. */
function openCaveChest(state, target, now, content) {
  const lootId = lootIdOf(target);
  const riftId = state?.expedition?.riftId || 'cave';
  const found = wildChest({ id: `${riftId}:${lootId}` }, content?.wilds);
  const words = materialsText(found.materials);
  const next = markChest(addMaterials(state, found.materials), lootId, now);
  return { state: next, words: words ? `Inside: ${words}.` : 'It was empty, but it’s a nice chest.', materials: found.materials };
}

/**
 * Opens a chest inside a cave (§9.8): a Mimic's (its `mimic` from encounters.chests) wakes and its
 * fight starts at once where the party stands (after Jev's *Sort*, the chest has said so first); a
 * locked one waits for the Artificer's *Pick*; any other gives its loot once.
 * → { state, words, fight: FightSpec | null }
 */
export function openChest(state, target, now, { content = null } = {}) {
  if (!isChest(target)) return { state, words: 'There’s no chest there.', fight: null };
  if (chestOpen(state, target)) return { state, words: 'It’s open already, and empty.', fight: null };
  if (target.mimic?.fight) {
    const sorted = own(state?.expedition?.sorted, lootIdOf(target)) === 'mimic';
    return { state, words: sorted ? 'It’s the Mimic Jev warned you about. It wakes up.' : 'The chest yawns and wakes up. It’s a Mimic.', fight: target.mimic.fight };
  }
  if (target.locked === true) return { state, words: 'It’s locked. The Artificer could pick it.', fight: null };
  const opened = openCaveChest(state, target, now, content);
  return { state: opened.state, words: opened.words, fight: null };
}

// A room's foes (from its FightSpec) are all of one canon kind: then a field skill settles the room.
function roomOfTarget(target, scene) {
  const roomId = typeof target?.room === 'string' ? target.room : (/^enc:([^:]+):/.exec(String(target?.id || '')) || [])[1] || null;
  const room = roomId ? (scene?.encounters?.rooms || []).find((r) => r.roomId === roomId) : null;
  return room || null;
}

function settleByWords(state, room, foe, now, { content, words }) {
  const fight = room.fight;
  const foes = Array.isArray(fight?.foes) ? fight.foes.filter((u) => u.side === 'foe') : [];
  if (!foes.length || !foes.every((u) => u.kind === foe) || fight.leadUnit) {
    return { state, words: foe === 'tollmen' ? 'The Tollman listens, but the others here won’t wait for a riddle.' : 'The Unwritten would listen, but the others here won’t.', fight: null };
  }
  if (own(state?.expedition?.rooms, room.roomId)) return { state, words: 'They’ve settled already.', fight: null };
  const combat = combatOf(content);
  let next = settleRoom(state, room.roomId, 'talked');
  if (combat) {
    const paid = payFight(next, fight.id, rewardsFor(fight, { rules: combat.rules, words: combat.words }), { outcome: 'talked', bow: false }, now, { rules: combat.rules });
    next = paid.state;
  }
  return { state: next, words, fight: null };
}

/**
 * A field skill (§3.1, §12.4): Light lights a lantern (Milo); Read gives a ruin's or statue's
 * `read` line, and the Unwritten settle to listen (the Scribe); Pick opens a cave's locked chest (the
 * Artificer); Sort says whether a chest is a Mimic (Jev); Riddle settles a room of Tollmen, from a
 * Tollman or the riddle board (the Tollkeeper). Each needs that companion in the party, or it says
 * so calmly. `scene` is the prepared place (for a room's foes). → { state, words, fight }
 */
export function fieldSkill(state, skill, target, now, { content = null, scene = null } = {}) {
  const who = FIELD_SKILLS[skill];
  if (!who || !isRecord(state) || !isRecord(target)) return { state, words: 'Nobody here can do that.', fight: null };
  if (!inParty(state, who)) return { state, words: needWords(state, who, content), fight: null };
  switch (skill) {
    case 'light': {
      const lid = String(target.id || '');
      if (!LANTERN_ID.test(lid)) return { state, words: 'There’s no lantern there to light.', fight: null };
      const wilds = isRecord(state.wilds) ? state.wilds : {};
      const lanterns = isRecord(wilds.lanterns) ? wilds.lanterns : {};
      if (finite(lanterns[lid]) && lanterns[lid] > 0) return { state, words: 'It’s lit already.', fight: null };
      return { state: { ...state, wilds: { ...wilds, lanterns: { ...lanterns, [lid]: Math.round(now) } } }, words: 'The wick catches, and the old glass warms.', fight: null };
    }
    case 'read': {
      const type = String(target.poiType || target.type || (/^poi:([a-z]+):/.exec(String(target.id || '')) || [])[1] || '');
      if (type === 'ruin' || type === 'statue') {
        const entry = content?.examine?.groups?.things?.[type];
        const line = pickLine(isRecord(entry) ? entry.read : entry, String(target.id || type), 'read');
        return { state, words: line || 'The Scribe reads it quietly to herself.', fight: null };
      }
      const room = roomOfTarget(target, scene);
      if (room) return settleByWords(state, room, SKILL_FOES.read, now, { content, words: 'The Scribe reads to them, and the Unwritten settle down to listen.' });
      return { state, words: 'There’s nothing here to read.', fight: null };
    }
    case 'pick': {
      if (!isChest(target)) return { state, words: 'There’s no lock there to pick.', fight: null };
      if (chestOpen(state, target)) return { state, words: 'It’s open already, and empty.', fight: null };
      if (target.mimic?.fight) return { state, words: 'That wasn’t a lock. The Mimic wakes up.', fight: target.mimic.fight };
      if (target.locked !== true) return { state, words: 'It isn’t locked. It just opens.', fight: null };
      const opened = openCaveChest(state, target, now, content);
      return { state: opened.state, words: `The Artificer works the lock open. ${opened.words}`, fight: null };
    }
    case 'sort': {
      if (!isChest(target) && !/^poi:chest:/.test(String(target.id || ''))) return { state, words: 'There’s no chest there to check.', fight: null };
      const mimic = Boolean(target.mimic?.fight) || target.mimic === true;
      let next = state;
      const e = state.expedition;
      if (isChest(target) && isRecord(e)) {
        const lootId = lootIdOf(target);
        if (own(e.sorted, lootId) !== (mimic ? 'mimic' : 'chest')) next = { ...state, expedition: { ...e, sorted: { ...(isRecord(e.sorted) ? e.sorted : {}), [lootId]: mimic ? 'mimic' : 'chest' } } };
      }
      return { state: next, words: mimic ? 'Jev hops back from it, feathers up. It’s a Mimic.' : 'Jev gives the chest a nod. It’s just a chest.', fight: null };
    }
    case 'riddle': {
      const room = roomOfTarget(target, scene);
      if (!room) return { state, words: 'There’s nobody here to trade riddles with.', fight: null };
      return settleByWords(state, room, SKILL_FOES.riddle, now, { content, words: 'The Tollkeeper trades riddles until the Tollmen laugh and wave you through.' });
    }
    default:
      return { state, words: 'Nobody here can do that.', fight: null };
  }
}

// ---------------------------------------------------------------------------
// The doors, driven through the shell

const NOT_OPEN = 'The tear wouldn’t open for Milo just now.';

/**
 * The thin part (§12.3): `createExpedition(shell, { fight, riftgen, worldgen, wilds, wardRadius,
 * walkable, sneaking, rifts })`, each of the last six a value or a getter (L2 sets them once the
 * world stands). → { stepThrough(rift, { standing }), goDeeper(rift), enterCave(poi), challenge(rift),
 * resume(), onStep(step), engage(roomId, { talk }), fieldSkill(skill, target), openChest(target),
 * scene(), refreshHidden(), dispose() }. Each door spends its Embers after the still-standing check
 * (`standing`, a predicate) and before entering, and gives the Embers back when the world refuses.
 */
export function createExpedition(shell, options = {}) {
  const { fight = null } = options;
  let prepared = null;
  const tiles = new Map();
  const crept = new Set();
  let busy = false;
  let armed = false;
  const offs = [];
  const get = (name) => { try { return valueOf(options[name]) ?? null; } catch { return null; } };
  const contentNow = () => (typeof shell?.content === 'function' ? shell.content() : null);
  const tell = (words, title = 'Not just now') => {
    if (!words) return;
    try { shell.bubble?.({ kind: 'note', title, lines: [words], duration: 6000, actions: [{ id: 'later', label: 'Okay' }] }); } catch (error) { console.error(error); }
  };
  const log = (text, tab = 'world') => { try { shell.log?.({ tab, text, at: shell.now(), detail: null, action: null }); } catch (error) { console.error(error); } };

  function levelsFor(state, content) {
    const combat = combatOf(content);
    if (!combat) return { level: 1, size: 4 };
    return { level: roadLevel(state, combat.rules).level, size: Math.max(1, partySpecs(state, { content, rules: combat.rules, abilities: combat.abilities }).length) };
  }

  function hide() {
    const state = shell.state;
    const ids = prepared && state?.expedition?.riftId === prepared.riftId ? hiddenFor(state.expedition, { mimics: mimicsOf(prepared) }) : [];
    shell.world?.('hideActors', ids);
  }

  // One door: the place, its source, the spend, then the world. `target` is the rift (or cave) to enter.
  async function enter(kind, place, { standing = null, base = null } = {}) {
    if (busy) return { ok: false, words: null };
    busy = true;
    try {
      const content = contentNow();
      const state = shell.state;
      const now = shell.now();
      const riftgen = get('riftgen');
      const worldgen = get('worldgen');
      const wilds = get('wilds');
      const source = sourceFor(kind, place, { worldgen, riftgen, wardRadius: get('wardRadius') || 0, base });
      if (!source) return fail(NOT_OPEN);
      const riftId = place.id;
      const since = kind === 'cave' ? dayStart(place.day) : finite(place.since) ? place.since : null;
      const entry = {
        kind, riftId, key: kind === 'real' || kind === 'story' ? place.key : null, since, source,
        depth: place.spec?.depth ?? place.depth ?? 1, tier: place.spec?.tier ?? place.tier ?? 1,
        text: kind === 'cave' ? 'Went into a cave' : kind === 'field' ? 'Challenged a field boss' : `Stepped into ${clip(place.spec?.name || 'a rift', 40)}`,
      };
      const old = samePlace(state.expedition, entry) ? state.expedition : null;
      const sized = old ? { level: old.roadLevel ?? 1, size: old.partySize ?? 4 } : levelsFor(state, content);
      // The place as the source makes it, so stepping in and a later resume build the very same one.
      const rebuilt = rebuildPlace({ ...entry, source }, { riftgen, worldgen, wilds, content });
      if (!rebuilt) return fail(NOT_OPEN);
      const ready = preparePlace(kind, { rift: rebuilt.rift ? { ...place, ...rebuilt.rift, x: place.x, y: place.y } : null, cave: rebuilt.cave },
        { content, riftgen, worldgen, wilds, walkable: get('walkable'), level: sized.level, size: sized.size });
      if (!ready) return fail(kind === 'field' ? 'There’s no clear ground here for that.' : NOT_OPEN);
      if (typeof standing === 'function' && !standing()) return { ok: false, words: null };
      const paid = door(state, { ...entry, roadLevel: sized.level, partySize: sized.size }, now, { economy: content?.economy ?? null });
      if (!paid.ok) { tell(paid.words, 'Not enough Embers'); log(paid.words); return { ok: false, words: paid.words }; }
      shell.set(paid.state, { save: 150 });
      if (kind !== 'field') {
        const target = kind === 'cave' ? ready.cave : ready.rift;
        const entered = await Promise.resolve(shell.world?.(kind === 'cave' ? 'enterCave' : 'enterElsewhere', target, { layout: ready.layout, fight: { plan: ready.plan, encounters: ready.encounters } }));
        if (entered === false) {
          if (shell.state === paid.state) shell.set(state, { save: 150 });
          return fail(NOT_OPEN);
        }
      }
      prepared = ready;
      armed = true;
      tiles.clear();
      crept.clear();
      hide();
      if (kind !== 'field' && kind !== 'cave') shell.feature?.('step-through');
      if (paid.cost) log(`${paid.cost} ${paid.cost === 1 ? 'Ember' : 'Embers'} to go in.`);
      else if (paid.free) log('Going back in is free this once.');
      return { ok: true, words: null, cost: paid.cost, free: paid.free, prepared: ready };
    } catch (error) {
      console.error('[MILO] a door', error);
      return fail(NOT_OPEN);
    } finally {
      busy = false;
    }
  }
  function fail(words) {
    tell(words);
    return { ok: false, words };
  }

  async function startRoom(roomId, extra = {}) {
    const fightSpec = fightFor(prepared, roomId);
    if (!fight || !fightSpec) return { started: false };
    return fight.start({ fight: fightSpec, roomId, ...extra });
  }

  const api = {
    /** Step through a wild rift, a real rift or the story's crack (after the walk there). */
    stepThrough(rift, { standing = null } = {}) {
      const kind = placeKind(rift);
      if (!kind || kind === 'cave') return Promise.resolve(fail(NOT_OPEN));
      return enter(kind, rift, { standing });
    },
    /** Go a rung deeper from inside a stitched wild rift: the base rift's inputs and one more rung. */
    goDeeper(rift) {
      const riftgen = get('riftgen');
      const exp = shell.state?.expedition;
      if (!riftgen || !isRecord(rift?.spec)) return Promise.resolve(fail(NOT_OPEN));
      const spec = riftgen.deeper(rift.spec);
      const deeper = { id: spec.id, key: null, kind: 'wild', spec, x: rift.x, y: rift.y, stage: spec.stage, since: rift.since, parent: rift.id };
      const base = isRecord(exp) && exp.riftId === rift.id && (exp.kind === 'wild' || exp.kind === 'rung') ? exp.source
        : placeKind(rift) === 'wild' ? sourceFor('wild', rift, { worldgen: get('worldgen'), riftgen, wardRadius: get('wardRadius') || 0 }) : null;
      return enter('rung', deeper, { base }).then((r) => ({ ...r, rift: deeper }));
    },
    /** Into a cave from its point of interest (3 Embers): the day it was entered is kept (§18.2 item 3). */
    enterCave(poi) {
      const content = contentNow();
      const cave = caveSpec(poi, { worldgen: get('worldgen'), wilds: get('wilds'), words: content?.riftgen ?? null, foes: content?.combat?.foes ?? null, day: dayNumber(shell.now()) });
      if (!cave) return Promise.resolve(fail('There’s no way into that cave just now.'));
      return enter('cave', cave);
    },
    /** Challenge a field boss (5 Embers): the only way its fight starts; sight never does. */
    async challenge(rift) {
      const content = contentNow();
      if (!isFieldBoss(rift, { leads: content?.combat?.leads, rules: content?.combat?.rules })) return fail('Only a field boss takes a Challenge.');
      if (fight?.live?.()) return { ok: false, words: null };
      const r = await enter('field', rift);
      if (!r.ok) return r;
      return { ...r, ...(await startRoom('field')) };
    },
    /**
     * Boot's resume (§12.4): the place rebuilt from `expedition.source` (never the live signal),
     * entered again, and a saved fight restored on its tick. A place that closed meanwhile with no
     * fight in it is cleared instead.
     */
    async resume() {
      const content = contentNow();
      const state = shell.state;
      const exp = state?.expedition;
      armed = true;
      if (!isRecord(exp) || !exp.inside) return { resumed: false };
      const now = shell.now();
      if (exp.battle == null && placeClosed(exp, { now, closedWild: state?.rifts?.closedWild })) {
        shell.set({ ...state, expedition: null }, { save: 150 });
        return { resumed: false, cleared: true };
      }
      const riftgen = get('riftgen');
      const worldgen = get('worldgen');
      const wilds = get('wilds');
      const rebuilt = rebuildPlace(exp, { riftgen, worldgen, wilds, content });
      const ready = rebuilt && preparePlace(exp.kind, rebuilt, { content, riftgen, worldgen, wilds, walkable: get('walkable'), level: exp.roadLevel ?? 1, size: exp.partySize ?? 4 });
      if (!ready) {
        shell.set(leaveExpedition(state), { save: 150 });
        return { resumed: false };
      }
      if (exp.kind !== 'field') {
        const target = exp.kind === 'cave' ? ready.cave : ready.rift;
        const entered = await Promise.resolve(shell.world?.(exp.kind === 'cave' ? 'enterCave' : 'enterElsewhere', target, { layout: ready.layout, fight: { plan: ready.plan, encounters: ready.encounters } }));
        if (entered === false) {
          shell.set(leaveExpedition(shell.state), { save: 150 });
          return { resumed: false };
        }
      }
      prepared = ready;
      tiles.clear();
      hide();
      if (exp.battle != null && fight) return { resumed: true, ...(await fight.resume(shell.state.expedition)) };
      if (exp.kind === 'field') shell.set(leaveExpedition(shell.state), { save: 150 });
      return { resumed: true };
    },
    /**
     * Each step of Milo or a follower (the engine's onSceneStep): inside a fight-ready place, the
     * sight check (§4.17), with Sneak's one outcome per room and creeping past sleepy or lost strays.
     * Never in the wilds: sight never starts a fight there.
     */
    onStep(step) {
      try {
        if (!prepared || prepared.kind === 'field' || !step || step.scene === 'world' || fight?.live?.()) return null;
        tiles.set(step.who || 'milo', { x: step.x, y: step.y });
        const state = shell.state;
        const settled = isRecord(state?.expedition?.rooms) ? state.expedition.rooms : {};
        const content = contentNow();
        const decide = fight?.sightDecision || null;
        if (!decide) return null;
        const decision = decide(prepared, [...tiles.values()], { settled, crept, sneaking: Boolean(get('sneaking')), rules: combatOf(content)?.rules });
        if (!decision) return null;
        if (decision.creep) { crept.add(decision.roomId); log('The party creeps past. Nobody stirs.', 'combat'); return decision; }
        startRoom(decision.roomId, { sneak: decision.unseen ? 'unseen' : null });
        return decision;
      } catch (error) {
        console.error('[MILO] the sight check', error);
        return null;
      }
    },
    /** Start a room's fight on purpose: an attack, or a doorway Talk down (`talk`: { [talkKind]: n }). */
    engage(roomId, { talk = {}, sneak = null } = {}) {
      if (!prepared || own(shell.state?.expedition?.rooms, roomId)) return Promise.resolve({ started: false });
      return startRoom(roomId, { talk, sneak });
    },
    /** A field skill, from the right-click menu (K1's `field-*` options). */
    fieldSkill(skill, target) {
      const r = fieldSkill(shell.state, skill, target, shell.now(), { content: contentNow(), scene: prepared });
      if (r.state !== shell.state) shell.set(r.state, { save: 150 });
      if (r.words) tell(r.words, 'Field work');
      hide();
      if (r.fight) return startMimic(target, r.fight).then((s) => ({ ...r, ...s }));
      return Promise.resolve(r);
    },
    /** Opening a cave's chest where Milo stands: its loot, or a Mimic's fight at once. */
    openChest(target) {
      const r = openChest(shell.state, target, shell.now(), { content: contentNow() });
      if (r.state !== shell.state) shell.set(r.state, { save: 150 });
      if (r.words) tell(r.words, r.fight ? 'A Mimic' : 'The chest');
      if (r.fight) return startMimic(target, r.fight).then((s) => ({ ...r, ...s }));
      return Promise.resolve(r);
    },
    scene: () => prepared,
    refreshHidden: () => hide(),
    dispose() { for (const off of offs) if (typeof off === 'function') off(); },
  };

  function startMimic(target, fightSpec) {
    if (!fight) return Promise.resolve({ started: false });
    shell.set(markChest(shell.state, lootIdOf(target), shell.now()), { save: 150 });
    return fight.start({ fight: fightSpec, roomId: 'mimic', hidden: [lootIdOf(target)] });
  }

  // Out of the place (the way home, a travel): the expedition is kept with `inside` false. Only once
  // a door or boot's resume has run, so the vale a launch starts in never empties a saved place.
  try {
    offs.push(shell.on?.('area', (info) => {
      try {
        if (!armed) return;
        const area = info?.area;
        const exp = shell.state?.expedition;
        const here = area === 'elsewhere' && (info?.rift?.id === exp?.riftId || info?.caveId === exp?.riftId);
        if (!here && prepared && prepared.kind !== 'field') { prepared = null; tiles.clear(); crept.clear(); }
        if (!here && isRecord(exp) && exp.inside && exp.kind !== 'field' && exp.battle == null && !fight?.live?.()) shell.set(leaveExpedition(shell.state), { save: 150 });
        if (!here && !fight?.live?.()) hide();
      } catch (error) { console.error(error); }
    }));
  } catch (error) { console.error(error); }
  if (fight && typeof fight.use === 'function') {
    fight.use({
      fightFor: (roomId) => fightFor(prepared, roomId),
      hidden: () => (prepared && shell.state?.expedition?.riftId === prepared.riftId ? hiddenFor(shell.state.expedition, { mimics: mimicsOf(prepared) }) : []),
      cover: (roomId) => (roomId === 'field' && prepared?.field ? [...(prepared.field.hiddenTrees || []), `stray:${prepared.riftId}:lead`] : []),
      rift: () => prepared?.rift ?? null,
      where: () => prepared?.rift?.spec?.name || prepared?.cave?.name || '',
    });
  }
  return api;
}
