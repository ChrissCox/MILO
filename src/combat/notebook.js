// The notebook (CONTRACT-PHASE4.md §5.10, §5.11, §7.2, §10.2, §17 items 6–7; COMBAT.md §3.3):
// "they learn from you". Situations and the 24-byte note, frames on disk, the relative choice
// catalogue, learning only from what Chris accepts and changes, the index that finds the 7 nearest
// notes by §7.2's pinned distance, drafting a turn in three layers (playbook rules, habits,
// personality) with a confidence and a why?, sync, habits for the notebook page, and lessons.
// Pure: no clock, no Math.random; the same notebook, battle and seed always give the same draft.
//   The note format is permanent (§17.7): byte meanings never change without a frame version bump.
import { hashString } from '../world/rng.js';
import { createGrid, unitDist, footprint } from './grid.js';
import { unitIn, standing, hasCond, condOf, effMode, roomLevel, casterKind, ability, BASIC_COST, speedOf } from './round.js';
import { specFor, talkTargets, abilityWhy } from './abilities.js';
import { canStrike } from './effects.js';
import { TEMPERAMENTS } from './bestiary.js';
import {
  act, shareOf, foesOf, alliesOf, nearestOf, weakestOf, threatOf, attackRange, attackOptions, optionTargets, bestAttack, patchOptions,
  bestPatch, abilityVariants, variantTargets, closeIn, strideTo, hurtsAt, personalitySlot, personalityWhy, reactionWhy, ticksLeft,
  tickLimit, roleOf, relations, minDist, coverAt, workable, besideWorkable, aimArea, gridFor, projectAt,
} from './ai.js';

export const NOTE_BYTES = 24;
export const SITUATION_BYTES = 16;
export const FRAME_MAGIC = 0x424e; // 'NB'
export const FRAME_VERSION = 1;
export const FRAME_HEADER = 13;

// ---------------------------------------------------------------------------
// The choice catalogue: relative phrases, never tiles (ids are stable forever once shipped)

const R = { none: 0, self: 1, ally: 2, foe: 3 };
const C = (id, key, phrase, relation) => Object.freeze({ id, key, phrase, relation });

/** [{ id, key, phrase, relation }]: relation 0 none, 1 self, 2 ally, 3 foe (§5.10 byte 17). */
export const CHOICES = Object.freeze([
  C(1, 'close-in', 'closed in on the strays', R.foe),
  C(2, 'guard-threatened', 'stepped in beside the ally a stray was about to bite', R.ally),
  C(3, 'to-lowest-ally', 'moved beside the most hurt ally', R.ally),
  C(4, 'to-cover', 'moved into cover', R.self),
  C(5, 'high-ground', 'climbed to higher ground', R.self),
  C(6, 'back-off', 'stepped back from the strays', R.self),
  C(7, 'reposition', 'moved to a new spot', R.self),
  C(8, 'to-object', 'moved to reach something in the room', R.none),
  C(10, 'hit-lead', 'went for the Tale-lead', R.foe),
  C(11, 'hit-weakest', 'struck the most hurt stray in reach', R.foe),
  C(12, 'hit-threat', 'struck the stray about to act', R.foe),
  C(13, 'hit-other', 'struck another stray', R.foe),
  C(14, 'hit-area', 'caught several strays at once', R.foe),
  C(15, 'hinder-lead', 'hindered the Tale-lead', R.foe),
  C(16, 'hinder-threat', 'hindered the stray about to act', R.foe),
  C(17, 'hinder-other', 'hindered a stray', R.foe),
  C(18, 'shove', 'shoved a stray away', R.foe),
  C(20, 'patch-lowest', 'patched the most hurt ally', R.ally),
  C(21, 'patch-self', 'patched up', R.self),
  C(22, 'patch-other', 'patched an ally', R.ally),
  C(23, 'patch-area', 'patched everyone nearby', R.self),
  C(24, 'reboot', 'rebooted an ally who’d gone offline', R.ally),
  C(25, 'help-threatened', 'helped the ally a stray was about to bite', R.ally),
  C(26, 'help-lowest', 'helped the most hurt ally', R.ally),
  C(27, 'help-self', 'shored up', R.self),
  C(28, 'help-other', 'helped an ally', R.ally),
  C(29, 'assist', 'set up an ally’s next blow', R.ally),
  C(30, 'brace', 'braced', R.self),
  C(31, 'cool-down', 'cooled down', R.self),
  C(32, 'hide', 'slipped out of sight', R.self),
  C(33, 'examine-new', 'examined a new stray', R.foe),
  C(34, 'examine', 'examined a stray again', R.foe),
  C(35, 'seek', 'sought out hidden strays', R.none),
  C(36, 'talk-down', 'talked a stray down', R.foe),
  C(37, 'work-object', 'worked something in the room', R.none),
  C(38, 'rouse-ally', 'roused a dozing ally', R.ally),
  C(39, 'shrug-off', 'shrugged off a hold', R.self),
  C(40, 'place-near-foes', 'set something down near the strays', R.none),
  C(41, 'place-near-allies', 'set something down near the party', R.none),
  C(42, 'wait', 'waited a tick', R.none),
  C(43, 'ready', 'readied a reaction', R.none),
  C(44, 'sustain', 'kept a spell going', R.none),
  C(45, 'dip', 'dipped a weapon in light', R.self),
  C(46, 'toss-cordial', 'tossed a cordial', R.ally),
  C(47, 'mechanic', 'used the Tale-lead’s trick against it', R.none),
  C(48, 'open', 'tried a stray’s bow', R.foe),
  C(49, 'self-use', 'used a special move', R.self),
]);
const BY_ID = new Map(CHOICES.map((c) => [c.id, c]));
const T = Object.fromEntries(CHOICES.map((c) => [c.key, c.id]));
const MOVE_TEMPLATES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const DIPS = new Set(['candlefire', 'burning-oil', 'burning-foliage', 'neon-puddle']);
const NEAR = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** The 16-bit ability hash in a note (0 for a basic action). */
export const abilityHash = (id) => (id ? hashString(String(id)) & 0xffff : 0);
/** A habit's key: '<template>:<ability>'. */
export const habitKey = (template, ability) => `${template}:${ability}`;

// ---------------------------------------------------------------------------
// crc32 (table-based, zlib's) and frames

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** zlib's crc32 of bytes. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** §10.2: one frame: [u16 0x424e][u8 1][u16 count][u32 crc32 of the notes][u32 key] + the notes. */
export function frame(notes, key) {
  const bytes = notes instanceof Uint8Array ? notes : new Uint8Array(notes || []);
  if (bytes.length % NOTE_BYTES) throw new Error('A frame holds whole notes');
  const count = bytes.length / NOTE_BYTES;
  if (count > 0xffff) throw new Error('A frame holds at most 65,535 notes');
  const out = new Uint8Array(FRAME_HEADER + bytes.length);
  const crc = crc32(bytes);
  const k = key >>> 0;
  out[0] = FRAME_MAGIC & 0xff; out[1] = FRAME_MAGIC >>> 8; out[2] = FRAME_VERSION;
  out[3] = count & 0xff; out[4] = count >>> 8;
  out[5] = crc & 0xff; out[6] = (crc >>> 8) & 0xff; out[7] = (crc >>> 16) & 0xff; out[8] = crc >>> 24;
  out[9] = k & 0xff; out[10] = (k >>> 8) & 0xff; out[11] = (k >>> 16) & 0xff; out[12] = k >>> 24;
  out.set(bytes, FRAME_HEADER);
  return out;
}

/**
 * A notebook file's notes: whole frames with a good CRC count; a whole frame with a bad CRC is
 * stepped over; the first thing that isn't a whole frame (a torn tail, junk) ends the walk.
 * → { notes, frames, torn (bytes past `good`), good (bytes through the last whole good frame), lastKey }
 */
export function unframe(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const kept = [];
  let offset = 0;
  let good = 0;
  let frames = 0;
  let total = 0;
  let lastKey = null;
  while (src.length - offset >= FRAME_HEADER) {
    if ((src[offset] | (src[offset + 1] << 8)) !== FRAME_MAGIC || src[offset + 2] !== FRAME_VERSION) break;
    const count = src[offset + 3] | (src[offset + 4] << 8);
    const end = offset + FRAME_HEADER + count * NOTE_BYTES;
    if (end > src.length) break;
    const body = src.subarray(offset + FRAME_HEADER, end);
    const stored = (src[offset + 5] | (src[offset + 6] << 8) | (src[offset + 7] << 16) | (src[offset + 8] << 24)) >>> 0;
    if (crc32(body) === stored) {
      frames += 1;
      good = end;
      lastKey = (src[offset + 9] | (src[offset + 10] << 8) | (src[offset + 11] << 16) | (src[offset + 12] << 24)) >>> 0;
      kept.push(body);
      total += body.length;
    }
    offset = end;
  }
  const notes = new Uint8Array(total);
  let at = 0;
  for (const k of kept) {
    notes.set(k, at);
    at += k.length;
  }
  return { notes, frames, torn: src.length - good, good, lastKey };
}

// ---------------------------------------------------------------------------
// The note (24 bytes, little-endian)

/** §5.10: a note from a situation and a choice. */
export function encodeNote({ situation, template, slot = 0, cost = 1, relation = 0, ability = 0, weight = 1, taught = false, order = 0 }) {
  const out = new Uint8Array(NOTE_BYTES);
  for (let i = 0; i < SITUATION_BYTES; i += 1) out[i] = situation?.[i] ?? 0;
  out[16] = template & 0xff;
  out[17] = (slot & 3) | ((Math.max(0, Math.min(3, cost)) & 3) << 2) | ((relation & 3) << 4);
  out[18] = ability & 0xff;
  out[19] = (ability >>> 8) & 0xff;
  out[20] = (Math.max(1, Math.min(2, weight)) & 3) | (taught ? 4 : 0);
  const o = Math.max(0, Math.min(0xffffff, Math.floor(order)));
  out[21] = o & 0xff;
  out[22] = (o >>> 8) & 0xff;
  out[23] = (o >>> 16) & 0xff;
  return out;
}

/** A note decoded: { situation, template, slot, cost, relation, ability, weight, taught, order, habit }. */
export function decodeNote(bytes, offset = 0) {
  const b = bytes;
  const o = offset;
  const template = b[o + 16];
  const ability = b[o + 18] | (b[o + 19] << 8);
  return {
    situation: b.slice(o, o + SITUATION_BYTES),
    template,
    slot: b[o + 17] & 3,
    cost: (b[o + 17] >> 2) & 3,
    relation: (b[o + 17] >> 4) & 3,
    ability,
    weight: b[o + 20] & 3,
    taught: !!(b[o + 20] & 4),
    order: b[o + 21] | (b[o + 22] << 8) | (b[o + 23] << 16),
    habit: habitKey(template, ability),
  };
}

// ---------------------------------------------------------------------------
// The situation (16 bytes, §5.10), from the unit's point of view at planning time

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
const RANKS = { lackey: 0, stray: 1, elite: 2, lead: 3 };
const PHASES = { opening: 1, twist: 2, 'last-page': 3 };
const ROOM_KINDS = { room: 0, lead: 1, field: 2, cave: 3 };
const MODES = { storybook: 0, 'long-road': 1, 'mauds-table': 2 };
const UNDONE = { lamp: 'dark', candle: 'dark', junction: 'off' };

const rankCode = (v) => (!v || v.rank === 'lackey' ? 0 : v.rank === 'lead' ? 3 : v.rank === 'elite' ? 2 : v.kind && v.kind !== 'stray' ? 4 : 1);

/** What the next foe to act aims at, from `u`'s side: { target 0–5, kind 0–4, ticks 0–3 }. */
function threatCode(b, u, lowAlly) {
  const t = threatOf(b);
  if (!t) return { target: 0, kind: 0, ticks: 0 };
  const ticks = Math.max(0, Math.min(3, (t.tick || 1) - 1 - (b.status === 'planning' ? 0 : b.tick)));
  if (t.hidden) return { target: 0, kind: 3, ticks };
  const kind = t.icon === 'strike' || t.icon === 'bite' || t.icon === 'shoot' ? 0 : t.icon === 'shove' ? 2 : 1;
  if (t.icon === 'area' || t.icon === 'surface') {
    const mine = footprint(u).some((p) => (t.tiles || []).some((q) => q.x === p.x && q.y === p.y));
    return { target: mine ? 4 : 5, kind, ticks };
  }
  let target = 0;
  if (t.targets.includes(u.id)) target = 1;
  else if (lowAlly && t.targets.includes(lowAlly.id)) target = 2;
  else if (t.targets.some((id) => unitIn(b, id)?.side === u.side)) target = 3;
  return { target, kind, ticks };
}

/** §5.10: the 16 situation bytes for `unitId`, computed at planning time before any change. */
export function situationOf(battle, unitId, ctx) {
  const out = new Uint8Array(SITUATION_BYTES);
  const u = unitIn(battle, unitId);
  if (!u) return out;
  const rules = ctx?.rules || null;
  const g = gridFor(battle, rules);
  const allies = alliesOf(battle, u);
  const party = battle.units.filter((v) => v.side === u.side && v.rank === 'hero');
  const foes = foesOf(battle, u);
  const near = nearestOf(battle, foes, u);
  const lowAlly = weakestOf(battle, allies, u);
  out[0] = clampByte(255 * shareOf(u));
  out[1] = lowAlly ? clampByte(255 * shareOf(lowAlly)) : 255;
  const below = Math.min(3, allies.filter((v) => shareOf(v) < 0.5).length);
  const offline = Math.min(3, party.filter((v) => v.id !== u.id && v.offline && !v.sorted).length);
  const lit = footprint(u).some((t) => g.light(t.x, t.y) === 'L') ? 1 : 0;
  let cover = 0;
  let higher = 0;
  if (near) {
    const c = g.cover(near.id, u.id);
    cover = c === null ? 2 : Math.min(2, c);
    const hu = Math.max(...footprint(u).map((t) => g.height(t.x, t.y)));
    const hn = Math.max(...footprint(near).map((t) => g.height(t.x, t.y)));
    higher = hu > hn ? 1 : 0;
  }
  out[2] = below | (offline << 2) | (lit << 4) | (cover << 5) | (higher << 7);
  out[3] = Math.min(31, near ? unitDist(u, near) : 31) | (Math.min(7, foes.length) << 5);
  const th = threatCode(battle, u, lowAlly);
  out[4] = th.target | (th.kind << 3) | (th.ticks << 6);
  const g0 = battle.genres?.[0];
  const gi = g0 ? (ctx?.genres || []).indexOf(g0) : -1;
  out[5] = gi >= 0 ? gi + 1 : 0;
  const temper = near && near.rank !== 'lead' ? TEMPERAMENTS.indexOf(near.temperament) + 1 : 0;
  out[6] = (Math.max(0, temper) & 15) | (rankCode(near) << 4);
  out[7] = clampByte(u.heat || 0);
  const lead = battle.lead ? unitIn(battle, battle.lead.unitId || 'lead') : null;
  const up = party.filter((v) => standing(v)); // the party Unseen: every standing hero (one hiding hero isn't the party)
  const unseen = (up.length > 0 && up.every((v) => hasCond(v, 'unseen'))) || battle.units.some((v) => v.side !== u.side && (v.mods || []).some((m) => m.stat === 'surprised'));
  out[8] = Math.min(15, battle.round || 1) | ((battle.lead ? PHASES[battle.lead.phase] || 0 : 0) << 4) | ((unseen ? 1 : 0) << 6) | ((lead && standing(lead) ? 1 : 0) << 7);
  out[9] = foes.length ? clampByte(255 * Math.min(...foes.map(shareOf))) : 0;
  const limited = Object.entries(u.uses || {}).some(([k, v]) => !k.startsWith('#') && v > 0);
  out[10] = Math.min(15, u.charges?.left || 0) | ((u.reactionUsed ? 0 : 1) << 4) | ((battle.cheers > 0 ? 1 : 0) << 5) | ((u.buffer > 0 ? 1 : 0) << 6) | ((limited ? 1 : 0) << 7);
  const kind = casterKind(u, rules);
  const weakBits = near && near.examined ? ((near.weak?.[kind] || 0) > 0 ? 2 : 1) : 0;
  const offlineNear = party.some((v) => v.id !== u.id && v.offline && !v.sorted && unitDist(u, v) <= 2);
  const hurt = footprint(u).some((t) => hurtsAt(g, rules, u, t.x, t.y));
  const calm = Object.values(battle.talk || {}).some((t) => t.calm > 0 && !t.done);
  const unlit = (battle.objects || []).some((o) => UNDONE[o.kind] === o.state);
  out[11] = weakBits | ((near?.examined ? 1 : 0) << 2) | ((offlineNear ? 1 : 0) << 3) | ((hurt ? 1 : 0) << 4)
    | ((hasCond(u, 'unseen') ? 1 : 0) << 5) | ((calm ? 1 : 0) << 6) | ((unlit ? 1 : 0) << 7);
  const range = attackRange(battle, u, ctx);
  let inReach = 0;
  let within6 = 0;
  let foeHeld = false;
  for (const v of foes) {
    const d = unitDist(u, v);
    if (d <= 6) within6 += 1;
    if (d <= range && g.sees(u, v)) {
      inReach += 1;
      if (hasCond(v, 'drowsy') || hasCond(v, 'tangled')) foeHeld = true;
    }
  }
  const allyAsleep = allies.some((v) => unitDist(u, v) <= 6 && (hasCond(v, 'drowsy') || hasCond(v, 'beguiled')));
  const allyQuarter = allies.some((v) => shareOf(v) < 0.25);
  out[12] = (hasCond(u, 'tumbled') ? 1 : 0) | ((hasCond(u, 'tangled') ? 1 : 0) << 1) | ((hasCond(u, 'spooked') ? 1 : 0) << 2)
    | ((hasCond(u, 'rattled') || u.rattled ? 1 : 0) << 3) | ((allyAsleep ? 1 : 0) << 4) | ((foeHeld ? 1 : 0) << 5) | ((allyQuarter ? 1 : 0) << 6)
    | ((hasCond(u, 'singled-out') ? 1 : 0) << 7);
  out[13] = Math.min(15, inReach) | (Math.min(15, within6) << 4);
  const near2 = allies.filter((v) => unitDist(u, v) <= 2).length;
  out[14] = Math.min(15, lowAlly ? unitDist(u, lowAlly) : 0) | (Math.min(3, near2) << 4) | (Math.min(3, Math.max(0, party.length - 1)) << 6);
  const partyLevel = Number.isFinite(battle.roadLevel) ? battle.roadLevel : (u.level || 1); // the Road level, never a Wayfarer's own
  const diff = Math.max(-8, Math.min(7, partyLevel - roomLevel(battle, rules))) + 8;
  out[15] = (MODES[effMode(battle)] ?? 1) | ((ROOM_KINDS[battle.kind] ?? 0) << 2) | (diff << 4);
  return out;
}

// ---------------------------------------------------------------------------
// Choices: an Action as a relative phrase, and back

/** The projected battle and unit for a plan slot (B's `project`). */
function at(battle, unitId, plan, slot, ctx) {
  const b = plan && slot > 0 ? projectAt(battle, unitId, plan, slot, ctx) : battle;
  return { b, u: unitIn(b, unitId) };
}

/** The movement template for a destination (priority: closing in, guarding, the lowest ally, cover, height, backing off, objects). */
function moveTemplate(b, g, u, rel, dest) {
  const probe = { x: dest.x, y: dest.y, size: u.size || 1 };
  if (rel.foes.length) {
    const before = minDist(u, rel.foes);
    const after = minDist(probe, rel.foes);
    if (after < before) return T['close-in'];
    if (rel.threatened && unitDist(probe, rel.threatened) <= 1 && unitDist(u, rel.threatened) > 1) return T['guard-threatened'];
    if (rel.lowAlly && shareOf(rel.lowAlly) < 1 && unitDist(probe, rel.lowAlly) <= 1 && unitDist(u, rel.lowAlly) > 1) return T['to-lowest-ally'];
    const foe = nearestOf(b, rel.foes, u);
    if (coverAt(g, dest, foe) > coverAt(g, u, foe)) return T['to-cover'];
    if (g.height(dest.x, dest.y) > g.height(u.x, u.y)) return T['high-ground'];
    if (after > before) return T['back-off'];
  }
  if (besideWorkable(b, dest) && !besideWorkable(b, u)) return T['to-object'];
  return T.reposition;
}

function unitPick(b, rel, target, reachList, kinds) {
  if (rel.lead && target.id === rel.lead.id) return kinds[0];
  if (reachList.length && shareOf(target) <= Math.min(...reachList.map(shareOf)) + 1e-9) return kinds[1];
  if (rel.threatFoe && target.id === rel.threatFoe.id) return kinds[2];
  return kinds[3];
}

const ATTACK_KINDS = [T['hit-lead'], T['hit-weakest'], T['hit-threat'], T['hit-other']];
const HINDER_KINDS = [T['hinder-lead'], T['hinder-other'], T['hinder-threat'], T['hinder-other']];

function helpTemplate(rel, u, target, patch) {
  if (patch) {
    if (rel.lowParty && shareOf(target) <= shareOf(rel.lowParty) + 1e-9) return T['patch-lowest'];
    return target.id === u.id ? T['patch-self'] : T['patch-other'];
  }
  if (target.id === u.id) return T['help-self'];
  if (rel.threatened && target.id === rel.threatened.id) return T['help-threatened'];
  if (rel.lowAlly && target.id === rel.lowAlly.id) return T['help-lowest'];
  return T['help-other'];
}

/**
 * §7.2: a slot's choice as { template, ability, relation } (null for no choice: Head home, an
 * empty slot). With `plan`, the unit is projected through the plan's earlier slots first.
 */
export function choiceOf(battle, unitId, action, slot, ctx, { plan = null } = {}) {
  if (!action || !action.id || action.id === 'head-home' || action.id === 'aside') return null;
  const { b, u } = at(battle, unitId, plan, slot, ctx);
  if (!u) return null;
  const rules = ctx?.rules || null;
  const template = templateOf(b, u, action, ctx, rules);
  if (!template) return null;
  const abilityId = action.id === 'use' ? action.ability : action.id === 'throw' && action.ability === 'cordial' ? 'cordial' : null;
  return { template, ability: abilityHash(abilityId), relation: BY_ID.get(template).relation };
}

function templateOf(b, u, action, ctx, rules) {
  const tgt = action.target || {};
  const unitT = tgt.unit ? unitIn(b, tgt.unit) : null;
  switch (action.id) {
    case 'stride': case 'step': case 'jump': {
      const dest = tgt.path?.length ? tgt.path[tgt.path.length - 1] : tgt.tile;
      if (!dest) return T.reposition;
      return moveTemplate(b, gridFor(b, rules), u, relations(b, u), dest);
    }
    case 'strike': case 'throw': {
      if (action.id === 'throw' && action.ability === 'cordial') return T['toss-cordial'];
      if (!unitT) return T['hit-other'];
      const rel = relations(b, u);
      const g = gridFor(b, rules);
      const reach = action.id === 'strike' ? rel.foes.filter((v) => canStrike(g, u, v)) : rel.foes;
      return unitPick(b, rel, unitT, reach, ATTACK_KINDS);
    }
    case 'shove': return T.shove;
    case 'brace': return T.brace;
    case 'cool-down': return T['cool-down'];
    case 'hide': return T.hide;
    case 'seek': return T.seek;
    case 'delay': return T.wait;
    case 'ready': return T.ready;
    case 'sustain': return T.sustain;
    case 'dip': return T.dip;
    case 'examine': return unitT && unitT.side !== u.side && !unitT.examined ? T['examine-new'] : T.examine;
    case 'talk-down': return T['talk-down'];
    case 'assist': return T.assist;
    case 'reboot': return T.reboot;
    case 'interact': {
      if (tgt.object) return T['work-object'];
      if (unitT && unitT.id === u.id) return T['shrug-off'];
      if (unitT && unitT.side === u.side) return T['rouse-ally'];
      return T.open;
    }
    case 'use': {
      if (String(action.ability || '').startsWith('mech:')) return T.mechanic;
      const a = ability(ctx, action.ability);
      if (!a) return T['self-use'];
      const spec = specFor(a, { cost: action.cost, choice: action.choice });
      const v = { a, spec, role: roleOf(a, spec) };
      const rel = relations(b, u);
      switch (v.role) {
        case 'reboot': return T.reboot;
        case 'patch-area': return T['patch-area'];
        case 'patch': return helpTemplate(rel, u, unitT || u, true);
        case 'help': return helpTemplate(rel, u, unitT || u, false);
        case 'area-attack': return T['hit-area'];
        case 'area-hinder': return T['hinder-other'];
        case 'attack': {
          if (!unitT) return T['hit-other'];
          const g = gridFor(b, rules);
          const ids = new Set(variantTargets(b, g, u, { a, spec, cost: action.cost }));
          return unitPick(b, rel, unitT, rel.foes.filter((f) => ids.has(f.id)), ATTACK_KINDS);
        }
        case 'hinder': {
          if (!unitT) return T['hinder-other'];
          const g = gridFor(b, rules);
          const ids = new Set(variantTargets(b, g, u, { a, spec, cost: action.cost }));
          return unitPick(b, rel, unitT, rel.foes.filter((f) => ids.has(f.id)), HINDER_KINDS);
        }
        case 'move': {
          const dest = tgt.tile || tgt.path?.[tgt.path.length - 1];
          return dest ? moveTemplate(b, gridFor(b, rules), u, rel, dest) : T.reposition;
        }
        case 'place': {
          const tile = tgt.tile;
          if (tile && rel.foes.some((f) => unitDist(tile, f) <= 2)) return T['place-near-foes'];
          return T['place-near-allies'];
        }
        case 'object': return T['work-object'];
        case 'self': return a.helpful ? T['help-self'] : T['self-use'];
        default: return T['self-use'];
      }
    }
    default: return null;
  }
}

/** The actions a slot occupies (0 for a Delay or Head home). */
const slotCost = (a) => (!a ? 0 : a.id === 'delay' || a.id === 'head-home' ? 0 : a.id === 'reboot' ? (Number(a.cost) === 1 ? 1 : 2) : BASIC_COST[a.id] ?? Math.max(0, Math.min(3, Math.trunc(Number(a.cost) || 1))));

/** §6.6's Minds.choices: each slot's { slot, template, ability, relation, cost } (or null), projecting through the earlier slots. */
export function choicesOf(battle, unitId, plan, ctx) {
  return (plan?.slots || []).map((a, slot) => {
    try {
      const c = choiceOf(battle, unitId, a, slot, ctx, { plan });
      return c ? { slot, ...c, cost: slotCost(a) } : null;
    } catch {
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// Back from a choice to an Action

/** The unit's ability with a given 16-bit hash (null for none). */
function abilityByHash(u, hash) {
  if (!hash) return null;
  for (const id of u.abilityIds || []) if (abilityHash(id) === hash) return id;
  if (hash === abilityHash('cordial')) return 'cordial';
  return null;
}

const move = (path) => act('stride', { target: { path, tile: { ...path[path.length - 1] } } });

/** A clean Stride (or a teleport within `range`) to the best tile a movement template names. */
function moveFor(b, g, u, ctx, rel, template, variant) {
  const rules = ctx.rules;
  const foe = nearestOf(b, rel.foes, u);
  const before = rel.foes.length ? minDist(u, rel.foes) : 0;
  const scoreOf = (x, y) => {
    const p = { x, y, size: u.size || 1 };
    switch (template) {
      case T['close-in']: {
        const d = minDist(p, rel.foes);
        return d < before ? d : null;
      }
      case T['guard-threatened']: return rel.threatened && unitDist(p, rel.threatened) <= 1 ? minDist(p, rel.foes) >= before ? 1 : 0 : null;
      case T['to-lowest-ally']: return rel.lowAlly && unitDist(p, rel.lowAlly) <= 1 ? 0 : null;
      case T['to-cover']: {
        const c = coverAt(g, p, foe);
        return c > coverAt(g, u, foe) ? 2 - c : null;
      }
      case T['high-ground']: {
        const h = g.height(x, y);
        return h > g.height(u.x, u.y) ? 2 - h : null;
      }
      case T['back-off']: {
        const d = minDist(p, rel.foes);
        return d > before ? 20 - d : null;
      }
      case T['to-object']: return besideWorkable(b, p) ? 0 : null;
      default: return null;
    }
  };
  if (variant) {
    // A teleport or leap: the best free tile within its range and in sight.
    const range = variant.spec.target?.range ?? 1;
    let best = null;
    for (let y = u.y - range; y <= u.y + range; y += 1) {
      for (let x = u.x - range; x <= u.x + range; x += 1) {
        if (!g.inside(x, y) || unitDist(u, { x, y }) > range || g.blocksMove(x, y, u) || !g.sees(u, { x, y })) continue;
        if (hurtsAt(g, rules, u, x, y)) continue;
        const s = scoreOf(x, y);
        if (s === null) continue;
        if (!best || s < best.s || (s === best.s && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, s };
      }
    }
    return best ? act('use', { ability: variant.a.id, cost: variant.cost, choice: variant.choice, target: { tile: { x: best.x, y: best.y } } }) : null;
  }
  if (hasCond(u, 'tangled')) return null;
  const speed = speedOf(b, u, ctx, { stride: true });
  if (speed <= 0) return null;
  if (template === T['close-in']) {
    const path = closeIn(b, g, rules, u, ctx, rel.foes);
    return path && path.length ? move(path) : null;
  }
  const path = strideTo(g, rules, u, speed, scoreOf);
  return path && path.length ? move(path) : null;
}

function pickBy(b, u, rel, list, kind) {
  if (!list.length) return null;
  switch (kind) {
    case 0: return rel.lead && list.find((v) => v.id === rel.lead.id) || null;
    case 1: return weakestOf(b, list, u);
    case 2: return rel.threatFoe && list.find((v) => v.id === rel.threatFoe.id) || null;
    default: {
      const low = weakestOf(b, list, u);
      const rest = list.filter((v) => v.id !== low?.id && v.id !== rel.threatFoe?.id && v.id !== rel.lead?.id);
      return nearestOf(b, rest, u);
    }
  }
}

function variantsFor(u, ctx, hash, cost, roles) {
  const id = abilityByHash(u, hash);
  if (!id) return [];
  return abilityVariants(ctx, id).filter((v) => roles.includes(v.role) && (!cost || v.cost === cost));
}

/**
 * §7.2: a choice back into an Action for this battle, or null when it can't be done now (a habit it
 * can't resolve falls to the next). choice: { template, ability, relation, cost?, any? } (any: the
 * best ability for the template, as a playbook rule asks). Guard rails: never a sorted or offline
 * target, never a path onto a surface that hurts right now.
 */
export function resolveChoice(battle, unitId, choice, slot, ctx, { plan = null, left = null } = {}) {
  if (!choice || !BY_ID.has(choice.template)) return null;
  const { b, u } = at(battle, unitId, plan, slot, ctx);
  if (!u || !standing(u)) return null;
  const rules = ctx.rules;
  const g = gridFor(b, rules);
  const rel = relations(b, u);
  const t = choice.template;
  const hash = choice.ability || 0;
  const cost = choice.cost || 0;
  const room = left ?? (plan ? ticksLeft(plan, unitIn(battle, unitId)) : 3);
  const fits = (a) => a && (a.cost ?? 1) <= room;
  const withCost = (list) => list.filter((v) => v.cost <= room && !abilityWhyCached(b, u, v, ctx));
  if (MOVE_TEMPLATES.has(t)) {
    const variant = hash ? withCost(variantsFor(u, ctx, hash, cost, ['move']))[0] : null;
    if (hash && !variant) return null;
    const a = moveFor(b, g, u, ctx, rel, t, variant);
    return fits(a) ? a : null;
  }
  switch (t) {
    case T['hit-lead']: case T['hit-weakest']: case T['hit-threat']: case T['hit-other']: {
      const kind = ATTACK_KINDS.indexOf(t);
      let options;
      if (choice.any) options = attackOptions(b, u, ctx, { left: room });
      else if (!hash) options = u.strike ? [{ action: act('strike'), variant: null, amount: 1, cost: 1 }] : [];
      else options = withCost(variantsFor(u, ctx, hash, cost, ['attack'])).map((v) => ({ action: act('use', { ability: v.a.id, cost: v.cost, choice: v.choice }), variant: v, amount: 1, cost: v.cost }));
      if (!options.length) return null;
      const hit = bestAttack(b, g, u, ctx, rel.foes, (list) => pickBy(b, u, rel, list, kind), { left: room, options });
      return hit && fits(hit.action) ? hit.action : null;
    }
    case T['hit-area']: {
      const vs = withCost(variantsFor(u, ctx, hash, cost, ['area-attack']));
      return vs.length ? aimArea(b, g, u, vs[0], rel) : null;
    }
    case T['hinder-lead']: case T['hinder-threat']: case T['hinder-other']: {
      const vs = withCost(variantsFor(u, ctx, hash, cost, ['hinder', 'area-hinder']));
      if (!vs.length) return null;
      const v = vs[0];
      if (v.role === 'area-hinder') return aimArea(b, g, u, v, rel);
      const ids = new Set(variantTargets(b, g, u, v));
      const list = rel.foes.filter((f) => ids.has(f.id));
      const kind = t === T['hinder-lead'] ? 0 : t === T['hinder-threat'] ? 2 : 1;
      const target = pickBy(b, u, rel, list, kind);
      return target ? act('use', { ability: v.a.id, cost: v.cost, choice: v.choice, target: { unit: target.id } }) : null;
    }
    case T.shove: {
      const list = rel.foes.filter((f) => unitDist(u, f) <= 1 && g.sees(u, f));
      const target = weakestOf(b, list, u);
      return target ? act('shove', { target: { unit: target.id } }) : null;
    }
    case T['patch-lowest']: case T['patch-self']: case T['patch-other']: case T['patch-area']: {
      let who = null;
      if (t === T['patch-lowest']) who = rel.lowParty;
      else if (t === T['patch-self']) who = u;
      else if (t === T['patch-other']) who = weakestOf(b, rel.allies.filter((v) => v.id !== rel.lowParty?.id), u);
      else who = rel.lowParty;
      if (!who || shareOf(who) >= 0.9) return null;
      const options = patchOptions(b, g, u, ctx, { left: room }).filter((o) => choice.any || abilityHash(o.action.ability) === hash && (!cost || o.cost === cost));
      if (t === T['patch-area']) {
        const o = options.find((x) => x.area);
        return o ? { ...o.action, target: null } : null;
      }
      const p = bestPatch(b, g, u, ctx, who, { left: room, options: options.filter((o) => !o.area) });
      return p ? p.action : null;
    }
    case T.reboot: {
      if (!hash) {
        const v = b.units.find((w) => w.side === u.side && w.offline && !w.sorted && (w.drops || 0) < 2 && w.rank === 'hero' && unitDist(u, w) <= 1);
        return v && room >= 2 ? act('reboot', { target: { unit: v.id } }) : null;
      }
      const vs = withCost(variantsFor(u, ctx, hash, cost, ['reboot']));
      if (!vs.length) return null;
      const ids = variantTargets(b, g, u, vs[0]);
      return ids.length ? act('use', { ability: vs[0].a.id, cost: vs[0].cost, choice: vs[0].choice, target: { unit: ids[0] } }) : null;
    }
    case T['help-threatened']: case T['help-lowest']: case T['help-self']: case T['help-other']: {
      const vs = withCost(variantsFor(u, ctx, hash, cost, ['help', 'self']));
      if (!vs.length) return null;
      const v = vs[0];
      const tw = v.spec.target?.who;
      if (t === T['help-self'] || tw === 'self' || tw === 'none') return t === T['help-self'] ? act('use', { ability: v.a.id, cost: v.cost, choice: v.choice }) : null;
      const ids = new Set(variantTargets(b, g, u, v));
      const pool = rel.party.filter((w) => ids.has(w.id));
      const who = t === T['help-threatened'] ? rel.threatened : t === T['help-lowest'] ? rel.lowAlly : weakestOf(b, pool.filter((w) => w.id !== u.id), u);
      return who && ids.has(who.id) ? act('use', { ability: v.a.id, cost: v.cost, choice: v.choice, target: { unit: who.id } }) : null;
    }
    case T.assist: {
      const foe = weakestOf(b, rel.foes.filter((f) => g.sees(u, f)), u);
      const ally = foe ? nearestOf(b, rel.allies, foe) : null;
      return foe && ally ? act('assist', { target: { units: [ally.id, foe.id] } }) : null;
    }
    case T.brace: return act('brace');
    case T['cool-down']: return u.heat > 0 ? act('cool-down') : null;
    case T.hide: {
      const dim = footprint(u).some((p) => g.light(p.x, p.y, { skip: u.side === 'party' ? 'hooklight' : null }) !== 'L' || g.hides(p.x, p.y));
      return dim ? act('hide') : null;
    }
    case T['examine-new']: case T.examine: {
      const list = rel.foes.filter((f) => g.sees(u, f) && (t === T.examine || !f.examined));
      const f = t === T['examine-new'] ? (rel.lead && list.includes(rel.lead) ? rel.lead : nearestOf(b, list, u)) : nearestOf(b, list, u);
      return f ? act('examine', { target: { unit: f.id } }) : null;
    }
    case T.seek: return act('seek');
    case T['talk-down']: {
      const ids = talkTargets(b, g, u);
      if (!ids.length) return null;
      const list = ids.map((id) => unitIn(b, id));
      const best = list.reduce((m, v) => ((b.talk?.[v.talkKind]?.calm || 0) > (b.talk?.[m.talkKind]?.calm || 0) ? v : m), list[0]);
      return act('talk-down', { target: { unit: best.id } });
    }
    case T['work-object']: {
      if (hash) {
        const vs = withCost(variantsFor(u, ctx, hash, cost, ['object']));
        const o = vs.length ? (b.objects || []).find((x) => unitDist(u, x) <= (vs[0].spec.target?.range ?? 1)) : null;
        return o ? act('use', { ability: vs[0].a.id, cost: vs[0].cost, choice: vs[0].choice, target: { object: o.id } }) : null;
      }
      const o = (b.objects || []).find((x) => workable(x) && unitDist(u, x) <= 1);
      if (o) return act('interact', { target: { object: o.id } });
      // A playbook rule ("see to the room first") walks to the nearest thing to work when none is beside.
      const things = (b.objects || []).filter(workable);
      if (!choice.any || !things.length) return null;
      let walk = moveFor(b, g, u, ctx, rel, T['to-object'], null);
      const speed = walk || hasCond(u, 'tangled') ? 0 : speedOf(b, u, ctx, { stride: true });
      if (speed > 0) { // Too far for one Stride: as near as it can get.
        const near = (p) => Math.min(...things.map((o) => unitDist(p, o)));
        const d0 = near(u);
        const path = strideTo(g, rules, u, speed, (x, y) => (near({ x, y, size: u.size || 1 }) < d0 ? near({ x, y, size: u.size || 1 }) : null));
        walk = path && path.length ? move(path) : null;
      }
      return fits(walk) ? walk : null;
    }
    case T['rouse-ally']: {
      const v = rel.allies.find((w) => hasCond(w, 'drowsy') && unitDist(u, w) <= 1);
      return v ? act('interact', { target: { unit: v.id } }) : null;
    }
    case T['shrug-off']: return (u.conditions || []).some((c) => ['lingering', 'singed', 'tangled'].includes(c.id)) ? act('interact', { target: { unit: u.id } }) : null;
    case T['place-near-foes']: case T['place-near-allies']: {
      const vs = withCost(variantsFor(u, ctx, hash, cost, ['place']));
      if (!vs.length) return null;
      const v = vs[0];
      const range = v.spec.target?.range ?? 1;
      const anchor = t === T['place-near-foes'] ? nearestOf(b, rel.foes, u) : u;
      if (!anchor) return null;
      let best = null;
      for (let y = u.y - range; y <= u.y + range; y += 1) {
        for (let x = u.x - range; x <= u.x + range; x += 1) {
          if (!g.inside(x, y) || unitDist(u, { x, y }) > range || g.blocksMove(x, y, null) || g.occupant(x, y) || g.objectAt(x, y) || !g.sees(u, { x, y })) continue;
          const d = unitDist({ x, y }, anchor);
          if (!best || d < best.d || (d === best.d && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, d };
        }
      }
      return best ? act('use', { ability: v.a.id, cost: v.cost, choice: v.choice, target: { tile: { x: best.x, y: best.y } } }) : null;
    }
    case T.wait: return room > 1 ? act('delay', { cost: 0 }) : null;
    case T.ready: {
      // Ready (2 actions, from Warding 10): the next slot fires as a reaction, on a trigger that fits the
      // moment: a stray coming into reach, a strike at a threatened ally, else a stray moving in sight.
      if (room < 2 || (b.warding || 0) < (rules.warding?.ready ?? 10)) return null;
      const inReach = rel.foes.some((f) => unitDist(u, f) <= Math.max(1, attackRange(b, u, ctx)) && g.sees(u, f));
      const trigger = !inReach ? 'foe-enters-reach' : rel.threatened ? 'strike-at-ally' : 'foe-moves-in-sight';
      return act('ready', { cost: 2, trigger });
    }
    case T.sustain: {
      const s = (b.sustained || []).find((x) => x.unitId === u.id);
      return s ? act('sustain', { ability: s.abilityId }) : null;
    }
    case T.dip: // Only beside something to dip into (burning surfaces, a Neon puddle, a lit candle), as B's Dip reads it.
      return footprint(u).some((p) => NEAR.some(([dx, dy]) => DIPS.has(g.surfaceAt(p.x + dx, p.y + dy))
        || (g.objectAt(p.x + dx, p.y + dy)?.kind === 'candle' && g.objectAt(p.x + dx, p.y + dy).state === 'lit'))) ? act('dip') : null;
    case T['toss-cordial']: {
      const carried = b.units.some((v) => v.side === u.side && (v.carry?.cordial || 0) > 0);
      const range = Math.max(1, (rules.actions?.throwBase ?? 3) + (rules.actions?.throwMight ?? 2) * (u.abilities?.might ?? 0));
      const who = rel.lowAlly && shareOf(rel.lowAlly) < 0.5 && unitDist(u, rel.lowAlly) <= range && g.sees(u, rel.lowAlly) ? rel.lowAlly : null;
      return carried && who ? act('throw', { ability: 'cordial', target: { unit: who.id } }) : null;
    }
    case T.mechanic: {
      const mech = (ctx.mechanics || {})[b.lead?.mechanic] || (ctx.mechanics || {}).fallback;
      if (!b.lead || !mech?.actions) return null;
      for (const o of mech.actions(b, unitId, ctx) || []) {
        if (o.why || abilityHash(o.action?.ability) !== hash || (o.cost ?? 1) > room) continue;
        const target = Array.isArray(o.targets) ? o.targets[0] || null : null;
        if (Array.isArray(o.targets) && !target) continue;
        return { ...o.action, target };
      }
      return null;
    }
    case T.open: {
      const f = rel.foes.find((v) => unitDist(u, v) <= 1);
      return f ? act('interact', { target: { unit: f.id } }) : null;
    }
    case T['self-use']: {
      const vs = withCost(variantsFor(u, ctx, hash, cost, ['self', 'area-hinder', 'area-attack']));
      if (!vs.length) return null;
      const v = vs[0];
      if (v.role !== 'self') return aimArea(b, g, u, v, rel);
      return act('use', { ability: v.a.id, cost: v.cost, choice: v.choice });
    }
    default: return null;
  }
}

const abilityWhyCached = (b, u, v, ctx) => abilityWhy(b, u, v.a, v.cost, ctx);

// ---------------------------------------------------------------------------
// Distance (§7.2's pinned table, in whole 160ths so the index and brute force agree exactly)

/** Weights in 160ths: Δ/32 → 5, Δ×2 → 320, min(Δ,8) → 160, min(Δ,8)/2 → 80, Δ×1.5 → 240, Δ → 160, Δ/2 → 80, Δ/10 → 16. */
export const DISTANCE_SCALE = 160;
const FIELDS = 27;
// Field indices.
const F = {
  self: 0, lowAlly: 1, foeShare: 2, below: 3, offline: 4, cover: 5, reach: 6, within6: 7, near2: 8, foeDist: 9, allyDist: 10, standing: 11,
  tTarget: 12, tKind: 13, ticks: 14, round: 15, genre: 16, temper: 17, rank: 18, phase: 19, room: 20, heat: 21, charges: 22, weak: 23, diff: 24,
  party: 25, level: 26,
};

/**
 * The situation's fields (27 small integers), read from `s` at `so` into `out` at `o` (the index
 * decodes every note straight into its table this way, with no copies). Indices are F's.
 */
function decodeAt(s, so, out, o) {
  const b2 = s[so + 2];
  const b4 = s[so + 4];
  const b6 = s[so + 6];
  const b8 = s[so + 8];
  const b13 = s[so + 13];
  const b14 = s[so + 14];
  const b15 = s[so + 15];
  out[o] = s[so];
  out[o + 1] = s[so + 1];
  out[o + 2] = s[so + 9];
  out[o + 3] = b2 & 3;
  out[o + 4] = (b2 >> 2) & 3;
  out[o + 5] = (b2 >> 5) & 3;
  out[o + 6] = (b13 & 15) > 4 ? 4 : b13 & 15;
  out[o + 7] = (b13 >> 4) > 4 ? 4 : b13 >> 4;
  out[o + 8] = (b14 >> 4) & 3;
  out[o + 9] = s[so + 3] & 31;
  out[o + 10] = b14 & 15;
  out[o + 11] = s[so + 3] >> 5;
  out[o + 12] = b4 & 7;
  out[o + 13] = (b4 >> 3) & 7;
  out[o + 14] = (b4 >> 6) & 3;
  out[o + 15] = b8 & 15;
  out[o + 16] = s[so + 5];
  out[o + 17] = b6 & 15;
  out[o + 18] = (b6 >> 4) & 7;
  out[o + 19] = (b8 >> 4) & 3;
  out[o + 20] = (b15 >> 2) & 3;
  out[o + 21] = s[so + 7];
  out[o + 22] = s[so + 10] & 15;
  out[o + 23] = s[so + 11] & 3;
  out[o + 24] = b15 & 3;
  out[o + 25] = (b14 >> 6) & 3;
  out[o + 26] = b15 >> 4;
}

/** The situation's fields (27 small integers; F names them). */
export function decodeSituation(s, out = new Int16Array(FIELDS)) {
  decodeAt(s, 0, out, 0);
  return out;
}

/** The 22 single-bit flags at an offset. */
function flagsAt(s, so) {
  return (((s[so + 2] >> 4) & 1) | (((s[so + 2] >> 7) & 1) << 1) | (((s[so + 8] >> 6) & 3) << 2) | (((s[so + 10] >> 4) & 15) << 4)
    | (((s[so + 11] >> 2) & 63) << 8) | (s[so + 12] << 14)) >>> 0;
}

/** The 22 single-bit flags: byte 2 bits 4 and 7, byte 8 bits 6 and 7, byte 10 bits 4–7, byte 11 bits 2–7, byte 12. */
export function flagsOf(s) {
  return (((s[2] >> 4) & 1) | (((s[2] >> 7) & 1) << 1) | (((s[8] >> 6) & 3) << 2) | (((s[10] >> 4) & 15) << 4) | (((s[11] >> 2) & 63) << 8) | (s[12] << 14)) >>> 0;
}

const popcount = (x) => {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const abs = (x) => (x < 0 ? -x : x);

/** The coarse (mismatch) part of the distance, in 160ths: genre 33, rank 4, threat target 4, threat kind 3, temperament 3, phase 3, room 3, and weakness, difficulty, party size 2. */
function coarse(q, f, o) {
  return (q[F.genre] !== f[o + F.genre] ? 5280 : 0) + (q[F.rank] !== f[o + F.rank] ? 640 : 0) + (q[F.tTarget] !== f[o + F.tTarget] ? 640 : 0)
    + (q[F.tKind] !== f[o + F.tKind] ? 480 : 0) + (q[F.temper] !== f[o + F.temper] ? 480 : 0) + (q[F.phase] !== f[o + F.phase] ? 480 : 0)
    + (q[F.room] !== f[o + F.room] ? 480 : 0) + (q[F.weak] !== f[o + F.weak] ? 320 : 0) + (q[F.diff] !== f[o + F.diff] ? 320 : 0)
    + (q[F.party] !== f[o + F.party] ? 320 : 0);
}

/** The continuous part of the distance, in 160ths. */
function fine(q, qf, f, o, flags) {
  const m8 = (d) => (d > 8 ? 8 : d);
  const r4 = (d) => (d > 4 ? 4 : d);
  return 5 * (abs(q[F.self] - f[o + F.self]) + abs(q[F.lowAlly] - f[o + F.lowAlly]) + abs(q[F.foeShare] - f[o + F.foeShare]))
    + 320 * (abs(q[F.below] - f[o + F.below]) + abs(q[F.offline] - f[o + F.offline]) + abs(q[F.cover] - f[o + F.cover]) + abs(q[F.reach] - f[o + F.reach])
      + abs(q[F.within6] - f[o + F.within6]) + abs(q[F.near2] - f[o + F.near2]))
    + 160 * m8(abs(q[F.foeDist] - f[o + F.foeDist])) + 80 * m8(abs(q[F.allyDist] - f[o + F.allyDist]))
    + 240 * abs(q[F.standing] - f[o + F.standing])
    + 160 * abs(q[F.ticks] - f[o + F.ticks]) + 80 * r4(abs(q[F.round] - f[o + F.round]))
    + 16 * abs(q[F.heat] - f[o + F.heat]) + 80 * m8(abs(q[F.charges] - f[o + F.charges]))
    + 80 * abs(q[F.level] - f[o + F.level])
    + 160 * popcount((qf ^ flags) >>> 0);
}

/** §7.2's distance between two situations (in situation units: 33 is one genre mismatch). */
export function situationDistance(a, b) {
  const qa = decodeSituation(a);
  const qb = decodeSituation(b);
  return (coarse(qa, qb, 0) + fine(qa, flagsOf(a), qb, 0, flagsOf(b))) / DISTANCE_SCALE;
}

// ---------------------------------------------------------------------------
// The notebook and its index

const coarseCode = (f, o) => (f[o + F.rank] | (f[o + F.tTarget] << 3) | (f[o + F.tKind] << 6) | (f[o + F.temper] << 9) | (f[o + F.phase] << 13)
  | (f[o + F.room] << 15) | (f[o + F.weak] << 17) | (f[o + F.diff] << 19) | (f[o + F.party] << 21)) >>> 0;

function newStore(capacity) {
  const cap = Math.max(16, capacity);
  return {
    cap, n: 0,
    bytes: new Uint8Array(cap * NOTE_BYTES),
    fields: new Int16Array(cap * FIELDS),
    flags: new Uint32Array(cap),
    slot: new Uint8Array(cap),
    cost: new Uint8Array(cap),
    habit: new Int32Array(cap),
    weight: new Uint8Array(cap),
    order: new Uint32Array(cap),
    // Which round each note came from (a why counts rounds, never notes; §18.3): a round's notes
    // share one situation, run in consecutive orders and climb in slot.
    round: new Uint32Array(cap),
    // Buckets: by genre, then by the rest of the coarse key; and by the rest alone, across genres.
    genre: new Map(), // genre → Map<code, number[]>
    rest: new Map(), // code → number[]
    habits: new Map(), // habit → Int32Array(4): notes per slot
    slotCount: new Int32Array(4),
  };
}

function growStore(s, need) {
  if (need <= s.cap) return s;
  let cap = s.cap;
  while (cap < need) cap *= 2;
  const grow = (arr, per = 1) => {
    const out = new arr.constructor(cap * per);
    out.set(arr.subarray(0, s.n * per));
    return out;
  };
  s.bytes = grow(s.bytes, NOTE_BYTES);
  s.fields = grow(s.fields, FIELDS);
  s.flags = grow(s.flags);
  s.slot = grow(s.slot);
  s.cost = grow(s.cost);
  s.habit = grow(s.habit);
  s.weight = grow(s.weight);
  s.order = grow(s.order);
  s.round = grow(s.round);
  s.cap = cap;
  return s;
}

/** Whether note `j` was written in the same round as note `i` just before it (learn writes a round's notes together: one situation, consecutive orders, slots climbing, taught alike). */
function sameRound(s, i, j) {
  if (s.order[j] !== s.order[i] + 1 || s.slot[j] <= s.slot[i]) return false;
  const a = i * NOTE_BYTES;
  const b = j * NOTE_BYTES;
  if ((s.bytes[a + 20] & 4) !== (s.bytes[b + 20] & 4)) return false;
  for (let k = 0; k < SITUATION_BYTES; k += 1) if (s.bytes[a + k] !== s.bytes[b + k]) return false;
  return true;
}

function addToStore(s, bytes, offset) {
  const i = s.n;
  s.bytes.set(bytes.subarray(offset, offset + NOTE_BYTES), i * NOTE_BYTES);
  decodeAt(bytes, offset, s.fields, i * FIELDS);
  s.flags[i] = flagsAt(bytes, offset);
  const slot = bytes[offset + 17] & 3;
  s.slot[i] = slot;
  s.cost[i] = (bytes[offset + 17] >> 2) & 3;
  const template = bytes[offset + 16];
  const ability = bytes[offset + 18] | (bytes[offset + 19] << 8);
  const h = (template << 16) | ability;
  s.habit[i] = h;
  const taught = bytes[offset + 20] & 4;
  s.weight[i] = taught ? 1 : Math.max(1, bytes[offset + 20] & 3);
  s.order[i] = bytes[offset + 21] | (bytes[offset + 22] << 8) | (bytes[offset + 23] << 16);
  s.round[i] = i === 0 ? 0 : sameRound(s, i - 1, i) ? s.round[i - 1] : s.round[i - 1] + 1;
  const genre = s.fields[i * FIELDS + F.genre];
  const code = coarseCode(s.fields, i * FIELDS);
  let gm = s.genre.get(genre);
  if (!gm) {
    gm = new Map();
    s.genre.set(genre, gm);
  }
  let list = gm.get(code);
  if (!list) gm.set(code, (list = []));
  list.push(i);
  let rl = s.rest.get(code);
  if (!rl) s.rest.set(code, (rl = []));
  rl.push(i);
  let hc = s.habits.get(h);
  if (!hc) s.habits.set(h, (hc = new Int32Array(4)));
  hc[slot] += 1;
  s.slotCount[slot] += 1;
  s.n = i + 1;
}

const HABIT_KEY = /^(\d{1,3}):(\d{1,5})$/;
const habitNumber = (key) => {
  const m = HABIT_KEY.exec(String(key));
  return m ? ((Number(m[1]) << 16) | Number(m[2])) : null;
};

function makeNotebook(id, store, count, struck, rules) {
  const notes = store.bytes.subarray(0, count * NOTE_BYTES);
  const nb = { id, count, notes, struck: [...struck], rules: rules.map((r) => ({ if: r.if, then: r.then })) };
  Object.defineProperty(nb, 'index', { value: { store, count, struck: new Set(struck.map(habitNumber).filter((h) => h !== null)) }, enumerable: false });
  return Object.freeze(nb);
}

/** §7.2: a notebook over its notes' bytes (a multiple of 24; a partial tail is ignored), with its strike-outs and playbook rules. */
export function createNotebook(id, notes = new Uint8Array(0), { struck = [], rules = [] } = {}) {
  const bytes = notes instanceof Uint8Array ? notes : new Uint8Array(notes || []);
  const count = Math.floor(bytes.length / NOTE_BYTES);
  const store = newStore(Math.max(64, count + 64));
  for (let i = 0; i < count; i += 1) addToStore(store, bytes, i * NOTE_BYTES);
  const cleanStruck = (Array.isArray(struck) ? struck : []).filter((k) => typeof k === 'string' && HABIT_KEY.test(k));
  const cleanRules = (Array.isArray(rules) ? rules : []).filter((r) => r && RULE_IF.has(r.if) && RULE_THEN.has(r.then));
  return makeNotebook(String(id || ''), store, count, cleanStruck, cleanRules);
}

/** The same notebook with new strike-outs or playbook rules (the notes and index are shared). */
export function withNotebookMeta(notebook, { struck = notebook.struck, rules = notebook.rules } = {}) {
  const idx = notebook.index;
  const cleanStruck = (struck || []).filter((k) => typeof k === 'string' && HABIT_KEY.test(k));
  const cleanRules = (rules || []).filter((r) => r && RULE_IF.has(r.if) && RULE_THEN.has(r.then));
  return makeNotebook(notebook.id, idx.store, idx.count, cleanStruck, cleanRules);
}

/** Appends notes (a learn or a lesson): shares the store when this notebook is its newest version. */
function appendNotes(notebook, added) {
  const idx = notebook.index;
  let store = idx.store;
  const n = added.length / NOTE_BYTES;
  if (store.n !== idx.count) {
    // An older version grew elsewhere: copy what this version holds.
    const fresh = newStore(idx.count + n + 64);
    for (let i = 0; i < idx.count; i += 1) addToStore(fresh, store.bytes, i * NOTE_BYTES);
    store = fresh;
  }
  growStore(store, idx.count + n);
  for (let i = 0; i < n; i += 1) addToStore(store, added, i * NOTE_BYTES);
  return makeNotebook(notebook.id, store, idx.count + n, notebook.struck, notebook.rules);
}

/** The next order number in a notebook (strictly increasing from 0). */
export function nextOrder(notebook) {
  const idx = notebook?.index;
  if (!idx || !idx.count) return 0;
  return idx.store.order[idx.count - 1] + 1;
}

// A bounded max-heap of the k nearest: worst first (larger distance, or equal distance and older).
function makeHeap(k) {
  return { k, d: [], i: [], o: [] };
}
const worse = (h, a, b) => h.d[a] > h.d[b] || (h.d[a] === h.d[b] && h.o[a] < h.o[b]);
function heapPush(h, dist, idx, order) {
  if (h.d.length < h.k) {
    h.d.push(dist); h.i.push(idx); h.o.push(order);
    let c = h.d.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!worse(h, c, p)) break;
      swap(h, c, p);
      c = p;
    }
    return;
  }
  if (dist > h.d[0] || (dist === h.d[0] && order < h.o[0])) return;
  h.d[0] = dist; h.i[0] = idx; h.o[0] = order;
  let c = 0;
  for (;;) {
    const l = 2 * c + 1;
    const r = l + 1;
    let m = c;
    if (l < h.d.length && worse(h, l, m)) m = l;
    if (r < h.d.length && worse(h, r, m)) m = r;
    if (m === c) break;
    swap(h, c, m);
    c = m;
  }
}
function swap(h, a, b) {
  [h.d[a], h.d[b]] = [h.d[b], h.d[a]];
  [h.i[a], h.i[b]] = [h.i[b], h.i[a]];
  [h.o[a], h.o[b]] = [h.o[b], h.o[a]];
}
const heapLimit = (h) => (h.d.length < h.k ? Infinity : h.d[0]);
const heapSorted = (h) => h.d.map((d, j) => ({ d, i: h.i[j], o: h.o[j] })).sort((a, b) => a.d - b.d || b.o - a.o);

/**
 * The pools a draft reads (§18.3, over §7.2's fallback at fewer than 7): for each slot, the notes made
 * in that slot whenever it has any (after strike-outs), so one correction teaches one slot; a slot
 * with none of its own borrows every slot's.
 */
function poolsFor(nb, slots) {
  const { store, count, struck } = nb.index;
  const live = [0, 0, 0, 0];
  let all = 0;
  if (store.n === count) {
    for (let s = 0; s < 4; s += 1) live[s] = store.slotCount[s];
  } else {
    for (let i = 0; i < count; i += 1) live[store.slot[i]] += 1;
  }
  for (const h of struck) {
    const hc = store.habits.get(h);
    if (!hc) continue;
    if (store.n === count) for (let s = 0; s < 4; s += 1) live[s] -= hc[s];
  }
  if (store.n !== count && struck.size) {
    live.fill(0);
    for (let i = 0; i < count; i += 1) if (!struck.has(store.habit[i])) live[store.slot[i]] += 1;
  }
  for (let s = 0; s < 4; s += 1) all += live[s];
  return slots.map((s) => (live[s & 3] >= 1 ? s & 3 : 'any')).map((p) => ({ pool: p, size: p === 'any' ? all : live[p] }));
}

/**
 * The 7 nearest notes per pool (a slot number, or 'any'), exactly as brute force finds them:
 * sorted by distance, then newer first. → Map<pool, [{ d (160ths), i (store index), o (order) }]>
 */
export function nearestNotes(notebook, situation, pools, k = 7) {
  const { store, count, struck } = notebook.index;
  const q = decodeSituation(situation);
  const qf = flagsOf(situation);
  const heaps = new Map();
  for (const p of pools) if (!heaps.has(p)) heaps.set(p, makeHeap(k));
  const anyHeap = heaps.get('any') || null;
  const slotHeaps = [0, 1, 2, 3].map((s) => heaps.get(s) || null);
  const limit = () => {
    let m = -1;
    for (const h of heaps.values()) {
      const l = heapLimit(h);
      if (l > m) m = l;
    }
    return m;
  };
  const f = store.fields;
  const scan = (list, lb, skipGenre) => {
    for (let j = 0; j < list.length; j += 1) {
      const i = list[j];
      if (i >= count) break;
      if (skipGenre !== null && f[i * FIELDS + F.genre] === skipGenre) continue;
      if (struck.size && struck.has(store.habit[i])) continue;
      const sh = slotHeaps[store.slot[i]];
      if (!sh && !anyHeap) continue;
      const cut = Math.max(sh ? heapLimit(sh) : -1, anyHeap ? heapLimit(anyHeap) : -1);
      const d = lb + fine(q, qf, f, i * FIELDS, store.flags[i]);
      if (d > cut) continue;
      const o = store.order[i];
      if (sh) heapPush(sh, d, i, o);
      if (anyHeap) heapPush(anyHeap, d, i, o);
    }
  };
  // 1. The query's own genre, bucket by bucket from the smallest lower bound.
  const own = store.genre.get(q[F.genre]);
  if (own) {
    const order = [];
    for (const [code, list] of own) {
      if (list[0] >= count) continue;
      order.push({ lb: coarseRest(q, code), list });
    }
    order.sort((a, b) => a.lb - b.lb);
    for (const { lb, list } of order) {
      if (lb > limit()) break;
      scan(list, lb, null);
    }
  }
  // 2. Every other genre (each 33 further), only while that could still get in.
  if (limit() >= 5280) {
    const order = [];
    for (const [code, list] of store.rest) {
      if (list[0] >= count) continue;
      order.push({ lb: 5280 + coarseRest(q, code), list });
    }
    order.sort((a, b) => a.lb - b.lb);
    for (const { lb, list } of order) {
      if (lb > limit()) break;
      scan(list, lb, q[F.genre]);
    }
  }
  const out = new Map();
  for (const [p, h] of heaps) out.set(p, heapSorted(h));
  return out;
}

function coarseRest(q, code) {
  const rank = code & 7;
  const tt = (code >>> 3) & 7;
  const tk = (code >>> 6) & 7;
  const temp = (code >>> 9) & 15;
  const phase = (code >>> 13) & 3;
  const room = (code >>> 15) & 3;
  const weak = (code >>> 17) & 3;
  const diff = (code >>> 19) & 3;
  const party = (code >>> 21) & 3;
  return (q[F.rank] !== rank ? 640 : 0) + (q[F.tTarget] !== tt ? 640 : 0) + (q[F.tKind] !== tk ? 480 : 0) + (q[F.temper] !== temp ? 480 : 0)
    + (q[F.phase] !== phase ? 480 : 0) + (q[F.room] !== room ? 480 : 0) + (q[F.weak] !== weak ? 320 : 0) + (q[F.diff] !== diff ? 320 : 0)
    + (q[F.party] !== party ? 320 : 0);
}

/** The 7 nearest by brute force (the index's reference: tests compare the two). */
export function bruteNearest(notebook, situation, pool, k = 7) {
  const { store, count, struck } = notebook.index;
  const q = decodeSituation(situation);
  const qf = flagsOf(situation);
  const all = [];
  for (let i = 0; i < count; i += 1) {
    if (struck.has(store.habit[i])) continue;
    if (pool !== 'any' && store.slot[i] !== pool) continue;
    const o = i * FIELDS;
    all.push({ d: coarse(q, store.fields, o) + fine(q, qf, store.fields, o, store.flags[i]), i, o: store.order[i] });
  }
  all.sort((a, b) => a.d - b.d || b.o - a.o);
  return all.slice(0, k);
}

// ---------------------------------------------------------------------------
// Playbook rules (built from the notebook's own phrases: if one situation, then one choice)

/** [{ id, words }]: 'If {words}, …'. */
export const RULE_IFS = Object.freeze([
  Object.freeze({ id: 'anyone-below-half', words: 'anyone’s below half' }),
  Object.freeze({ id: 'someone-offline', words: 'someone’s gone offline' }),
  Object.freeze({ id: 'below-half', words: 'they’re below half' }),
  Object.freeze({ id: 'ally-threatened', words: 'a stray’s about to bite an ally' }),
  Object.freeze({ id: 'self-threatened', words: 'a stray’s about to bite them' }),
  Object.freeze({ id: 'foe-in-reach', words: 'a stray’s in reach' }),
  Object.freeze({ id: 'nothing-in-reach', words: 'nothing’s in reach' }),
  Object.freeze({ id: 'lead-here', words: 'a Tale-lead is here' }),
  Object.freeze({ id: 'running-hot', words: 'they’re running hot' }),
  Object.freeze({ id: 'first-round', words: 'it’s the first round' }),
  Object.freeze({ id: 'new-stray', words: 'a stray hasn’t been examined' }),
  Object.freeze({ id: 'lights-out', words: 'a lamp or candle is out' }),
  Object.freeze({ id: 'always', words: 'always' }),
]);

/** [{ id, words, template }]: '…, {words}.' */
export const RULE_THENS = Object.freeze([
  Object.freeze({ id: 'patch-lowest', words: 'patch the most hurt ally first', template: T['patch-lowest'] }),
  Object.freeze({ id: 'reboot', words: 'reboot them first', template: T.reboot }),
  Object.freeze({ id: 'guard', words: 'step in beside them', template: T['guard-threatened'] }),
  Object.freeze({ id: 'hit-weakest', words: 'strike the most hurt stray in reach', template: T['hit-weakest'] }),
  Object.freeze({ id: 'hit-threat', words: 'strike the stray about to act', template: T['hit-threat'] }),
  Object.freeze({ id: 'hit-lead', words: 'go for the Tale-lead', template: T['hit-lead'] }),
  Object.freeze({ id: 'close-in', words: 'close in', template: T['close-in'] }),
  Object.freeze({ id: 'back-off', words: 'step back', template: T['back-off'] }),
  Object.freeze({ id: 'take-cover', words: 'get into cover', template: T['to-cover'] }),
  Object.freeze({ id: 'brace', words: 'brace', template: T.brace }),
  Object.freeze({ id: 'cool-down', words: 'cool down', template: T['cool-down'] }),
  Object.freeze({ id: 'examine', words: 'examine it first', template: T['examine-new'] }),
  Object.freeze({ id: 'talk-down', words: 'talk them down', template: T['talk-down'] }),
  Object.freeze({ id: 'light-it', words: 'see to the room first', template: T['work-object'] }),
]);
const RULE_IF = new Map(RULE_IFS.map((r) => [r.id, r]));
const RULE_THEN = new Map(RULE_THENS.map((r) => [r.id, r]));

/** 'If anyone’s below half, patch the most hurt ally first.' */
export function ruleText(rule) {
  const i = RULE_IF.get(rule?.if);
  const t = RULE_THEN.get(rule?.then);
  if (!i || !t) return '';
  if (i.id === 'always') return `Always ${t.words}.`;
  return `If ${i.words}, ${t.words}.`;
}

/** Whether a rule's `if` holds in a situation (the 16 bytes). */
export function ruleHolds(ifId, s) {
  switch (ifId) {
    case 'anyone-below-half': return (s[2] & 3) > 0 || s[0] < 128;
    case 'someone-offline': return ((s[2] >> 2) & 3) > 0;
    case 'below-half': return s[0] < 128;
    case 'ally-threatened': { const t = s[4] & 7; return t === 2 || t === 3; }
    case 'self-threatened': { const t = s[4] & 7; return t === 1 || t === 4; }
    case 'foe-in-reach': return (s[13] & 15) > 0;
    case 'nothing-in-reach': return (s[13] & 15) === 0 && (s[3] >> 5) > 0;
    case 'lead-here': return !!(s[8] & 128);
    case 'running-hot': return s[7] >= 61;
    case 'first-round': return (s[8] & 15) === 1;
    case 'new-stray': return !(s[11] & 4) && (s[3] >> 5) > 0;
    case 'lights-out': return !!(s[11] & 128);
    case 'always': return true;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Drafting (§7.2): rules, then the 7 nearest notes per slot, then personality

const HALF_LIFE = 2000;
/** A personality slot's confidence; a habit wins over personality only at this or more (§18.3). */
export const PERSONALITY_CONFIDENCE = 35;
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** A count in words from one to nine, and in figures from 10 (§18.3). */
export const countWord = (n) => NUMBER_WORDS[n] || String(n);

/**
 * A habit's why, counting rounds (never notes): 'You braced in two of three rounds like this.',
 * 'You braced in both rounds like this.', 'You braced in the one round like this.'
 */
export function habitWhy(phrase, count, of) {
  const where = of <= 1 ? 'the one round' : count >= of ? (of === 2 ? 'both rounds' : `all ${countWord(of)} rounds`) : `${countWord(count)} of ${countWord(of)} rounds`;
  return `You ${phrase} in ${where} like this.`;
}

/**
 * §7.2: a hero's Draft from their notebook: per slot, playbook rules first (they always win), then
 * the best-scoring habit among the 7 nearest notes made in that slot (a slot with none borrows every
 * slot's) whose cost fits the ticks left, when its confidence is at least personality's 35 (§18.3),
 * then personality.
 */
export function draftFor(notebook, battle, unitId, ctx) {
  const u0 = unitIn(battle, unitId);
  const plan = { unitId, slots: [], reactions: { ...(u0?.reactions || {}) }, by: 'draft', changed: [] };
  if (!u0 || !standing(u0)) return { unitId, plan, confidence: 35, source: 'personality', why: [], choices: [] };
  const situation = situationOf(battle, unitId, ctx);
  const limit = tickLimit(u0);
  const slotsWanted = [0, 1, 2, 3].slice(0, Math.max(0, Math.min(4, limit)));
  const idx = notebook?.index;
  const pools = idx && idx.count ? poolsFor(notebook, slotsWanted) : [];
  const near = pools.length ? nearestNotes(notebook, situation, [...new Set(pools.map((p) => p.pool))]) : new Map();
  const newest = idx && idx.count ? idx.store.order[idx.count - 1] : 0;
  const why = [];
  const layers = [];
  const confs = [];
  const usedRules = new Set();
  const choices = [];
  for (let slot = 0; slot < 4; slot += 1) {
    const left = ticksLeft(plan, u0);
    if (left <= 0) break;
    let chosen = null;
    // 1. Playbook rules.
    for (const [ri, rule] of (notebook?.rules || []).entries()) {
      if (usedRules.has(ri) || !ruleHolds(rule.if, situation)) continue;
      const then = RULE_THEN.get(rule.then);
      const a = then ? resolveChoice(battle, unitId, { template: then.template, ability: 0, any: true }, slot, ctx, { plan, left }) : null;
      if (!a || (a.cost ?? 1) > left) continue;
      usedRules.add(ri);
      // The choice is what the action reads as (a rule may walk to its object first, or its best attack may be on the lead).
      const c = choiceOf(battle, unitId, a, slot, ctx, { plan });
      const choice = c ? { template: c.template, ability: c.ability } : { template: then.template, ability: a.id === 'use' ? abilityHash(a.ability) : 0 };
      chosen = { action: a, layer: 'rule', conf: 100, choice, why: { slot, layer: 'rule', text: `Your rule: ${lowerFirst(ruleText(rule))}`, count: null, of: null } };
      break;
    }
    // 2. Habits: the 7 nearest notes for this slot's pool.
    if (!chosen && pools.length) {
      const pool = pools[Math.min(slot, pools.length - 1)]?.pool ?? 'any';
      const seven = near.get(pool) || [];
      if (seven.length) chosen = fromHabits(notebook, battle, unitId, ctx, plan, slot, left, seven, newest);
    }
    // 3. Personality.
    if (!chosen) {
      const b = slot === 0 ? battle : projectAt(battle, unitId, plan, slot, ctx);
      const a = personalitySlot(b, unitId, ctx, { slot, left, plan });
      if (!a) break;
      const c = choiceOf(battle, unitId, a, slot, ctx, { plan });
      chosen = { action: a, layer: 'personality', conf: 35, choice: c ? { template: c.template, ability: c.ability } : null, why: personalityWhy(battle, unitId, ctx, slot) };
    }
    plan.slots.push(chosen.action);
    plan.changed.push(false);
    why.push(chosen.why);
    layers.push(chosen.layer);
    confs.push(chosen.conf);
    if (chosen.choice) choices.push({ slot, ...chosen.choice });
  }
  const r = reactionWhy(u0);
  if (r) why.push(r);
  const kinds = new Set(layers);
  const source = !layers.length ? 'personality' : kinds.size === 1 ? layers[0] : 'mixed';
  const confidence = confs.length ? Math.min(...confs) : 35;
  return { unitId, plan, confidence, source, why, choices };
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function fromHabits(notebook, battle, unitId, ctx, plan, slot, left, seven, newest) {
  const { store } = notebook.index;
  const by = new Map();
  const rounds = new Set();
  let total = 0;
  let sumD = 0;
  for (const n of seven) {
    const i = n.i;
    const score = store.weight[i] * 0.5 ** ((newest - store.order[i]) / HALF_LIFE) / (1 + n.d / DISTANCE_SCALE);
    total += score;
    sumD += n.d / DISTANCE_SCALE;
    const h = store.habit[i];
    let e = by.get(h);
    if (!e) by.set(h, (e = { h, score: 0, rounds: new Set(), newest: -1, costs: new Map() }));
    e.score += score;
    e.rounds.add(store.round[i]);
    rounds.add(store.round[i]);
    if (store.order[i] > e.newest) e.newest = store.order[i];
    const c = store.cost[i];
    const ce = e.costs.get(c) || { score: 0, newest: -1 };
    ce.score += score;
    if (store.order[i] > ce.newest) ce.newest = store.order[i];
    e.costs.set(c, ce);
  }
  const closeness = 1 / (1 + sumD / seven.length / 32);
  const ranked = [...by.values()].sort((a, b) => b.score - a.score || b.newest - a.newest);
  for (const e of ranked) {
    // Ranked by score, so agreement only falls from here: under personality's 35, personality wins.
    const conf = Math.round(100 * (total > 0 ? e.score / total : 0) * closeness);
    if (conf < PERSONALITY_CONFIDENCE) return null;
    const costs = [...e.costs.entries()].filter(([c]) => Math.max(1, c) <= left || (c === 0 && left >= 1))
      .sort((a, b) => b[1].score - a[1].score || b[1].newest - a[1].newest);
    if (!costs.length) continue;
    const template = e.h >>> 16;
    const ability = e.h & 0xffff;
    for (const [cost] of costs) {
      const a = resolveChoice(battle, unitId, { template, ability, relation: BY_ID.get(template)?.relation ?? 0, cost }, slot, ctx, { plan, left });
      if (!a || (a.cost ?? 1) > left) continue;
      const phrase = BY_ID.get(template)?.phrase || 'did this';
      const count = e.rounds.size;
      return {
        action: a,
        layer: 'habit',
        choice: { template, ability },
        conf,
        why: { slot, layer: 'habit', text: habitWhy(phrase, count, rounds.size), count, of: rounds.size },
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Learning (§7.2): only accepts and changes; never improvisations or auto play

function fromBase64(text) {
  if (typeof text !== 'string') return new Uint8Array(SITUATION_BYTES);
  let bin;
  try {
    bin = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
  } catch {
    return new Uint8Array(SITUATION_BYTES);
  }
  const out = new Uint8Array(SITUATION_BYTES);
  for (let i = 0; i < Math.min(SITUATION_BYTES, bin.length); i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/**
 * §7.2: one note per committed slot with a choice, from a RoundRecord: accepted unchanged at
 * weight 1, changed at weight 2 (Command-written, or a hero with no draft, at weight 1). Nothing
 * for an auto record. → { notebook, added } (the same notebook and no bytes when nothing's learned).
 */
export function learn(notebook, record, unitId, { command = false } = {}) {
  const r = record?.units?.[unitId];
  const none = { notebook, added: new Uint8Array(0) };
  if (!r || r.auto) return none;
  const choices = Array.isArray(r.choices) ? r.choices : [];
  const slots = r.plan?.slots || [];
  const situation = fromBase64(r.situation);
  const drafted = !!r.draft && !command;
  const accepted = Array.isArray(r.accepted) ? r.accepted : [];
  const notes = [];
  let order = nextOrder(notebook);
  for (let slot = 0; slot < Math.min(4, choices.length); slot += 1) {
    const c = choices[slot];
    if (!c || !BY_ID.has(c.template)) continue;
    const cost = Number.isInteger(c.cost) ? Math.max(0, Math.min(3, c.cost)) : slotCost(slots[slot]) || 1;
    const weight = drafted && accepted[slot] !== true ? 2 : 1;
    notes.push(encodeNote({ situation, template: c.template, slot, cost, relation: c.relation ?? BY_ID.get(c.template).relation, ability: c.ability || 0, weight, taught: false, order }));
    order += 1;
  }
  if (!notes.length) return none;
  const added = new Uint8Array(notes.length * NOTE_BYTES);
  notes.forEach((n, i) => added.set(n, i * NOTE_BYTES));
  return { notebook: appendNotes(notebook, added), added };
}

/**
 * A lesson at the campfire (COMBAT §3.3): the habit's notes, taught bit set (they count once),
 * renumbered from `toOrderStart`. Struck habits can't be taught.
 */
export function teachNotes(from, key, toOrderStart) {
  const h = habitNumber(key);
  if (h === null || !from?.index || from.index.struck.has(h)) return new Uint8Array(0);
  const { store, count } = from.index;
  const picked = [];
  for (let i = 0; i < count; i += 1) if (store.habit[i] === h) picked.push(i);
  const out = new Uint8Array(picked.length * NOTE_BYTES);
  let order = Math.max(0, Math.floor(toOrderStart) || 0);
  picked.forEach((i, j) => {
    const o = j * NOTE_BYTES;
    out.set(store.bytes.subarray(i * NOTE_BYTES, i * NOTE_BYTES + NOTE_BYTES), o);
    out[o + 20] = 1 | 4;
    out[o + 21] = order & 0xff;
    out[o + 22] = (order >>> 8) & 0xff;
    out[o + 23] = (order >>> 16) & 0xff;
    order += 1;
  });
  return out;
}

/** Appends a lesson's notes (or any framed-in notes) to a notebook. */
export function addNotes(notebook, bytes) {
  if (!bytes || !bytes.length) return notebook;
  return appendNotes(notebook, bytes.subarray(0, Math.floor(bytes.length / NOTE_BYTES) * NOTE_BYTES));
}

/** §7.2: the share of '1's among the last 50 drafted, non-auto slots (0–100). */
export function sync(accepts) {
  const s = typeof accepts === 'string' ? accepts.replace(/[^01]/g, '').slice(-50) : '';
  if (!s.length) return 0;
  let ones = 0;
  for (const ch of s) if (ch === '1') ones += 1;
  return Math.round((100 * ones) / s.length);
}

/**
 * The notebook page's habits, strongest first: { key, phrase, count (its notes), of (the notes taken
 * in the same genres and slots), strength (weighted, newer counting more), struck }. With `abilities`
 * (an AbilityIndex), an ability's name follows the phrase.
 */
export function habits(notebook, { abilities = null } = {}) {
  const idx = notebook?.index;
  if (!idx || !idx.count) return [];
  const { store, count, struck } = idx;
  const newest = store.order[count - 1];
  const per = new Map();
  const cell = new Map();
  for (let i = 0; i < count; i += 1) {
    const h = store.habit[i];
    const g = store.fields[i * FIELDS + F.genre];
    const k = g * 4 + store.slot[i];
    cell.set(k, (cell.get(k) || 0) + 1);
    let e = per.get(h);
    if (!e) per.set(h, (e = { h, count: 0, strength: 0, cells: new Set() }));
    e.count += 1;
    e.strength += store.weight[i] * 0.5 ** ((newest - store.order[i]) / HALF_LIFE);
    e.cells.add(k);
  }
  const names = new Map();
  if (abilities?.values) for (const a of abilities.values()) names.set(abilityHash(a.id), a.name);
  const out = [];
  for (const e of per.values()) {
    const template = e.h >>> 16;
    const ability = e.h & 0xffff;
    let of = 0;
    for (const k of e.cells) of += cell.get(k) || 0;
    const base = BY_ID.get(template)?.phrase || 'did something';
    const name = ability ? names.get(ability) : null;
    out.push({ key: habitKey(template, ability), phrase: name ? `${base} (${name})` : base, count: e.count, of, strength: Math.round(e.strength * 1000) / 1000, struck: struck.has(e.h) });
  }
  out.sort((a, b) => b.strength - a.strength || b.count - a.count || (a.key < b.key ? -1 : 1));
  return out;
}

/** The catalogue entry for a template id (or null). */
export const choiceInfo = (template) => BY_ID.get(template) || null;

export { T as TEMPLATE_IDS, FIELDS as FIELD_COUNT };
