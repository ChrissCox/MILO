// Fight playback (CONTRACT-PHASE4.md §11.4, §13 wave 2 J; COMBAT.md §14.1): a round's events turned
// into a timeline the combat layer (scene-combat.js) draws from, and the pose helpers it uses.
//
//   timeline(events, { units, abilities, anims, motion, speed, fastFoes, rules, opening, from }) → Timeline
//   beatKey(events, units)                    the beat a step's events share with its neighbours, or null
//   poseFrame(frame, op | op[]) → Frame      the pose operations on rows, masks and anchors together
//   withLegs(rows, legs, at)                  rows with their leg rows swapped in from row `at`
//   clipInfo(look, clip, anims)               a clip's { fps, frames, loop, still } for a hero or a stray
//   clipFrame(info, elapsed, still)           which of a clip's frames shows `elapsed` ms in
//
// Pure: no clock, no randomness, no DOM. Times are ms on the playback clock the engine advances by
// each tick's dt, never absolute time, so a hidden or paused window simply holds the playback.
//
// How a round plays: every `act` event opens a segment (the actor's clip, then what it caused: a
// walk, an outcome, damage, a patch, a condition…); segments play one after another in the events'
// order. Within a tick, consecutive segments by foes of one talkKind start together as one beat
// (strays of a kind move as one), and a foe's segment lasts at most rules.timing.strayBeat, halved
// by fastFoes; `speed` (1, 2 or 4) shortens everything. A Critical adds rules.timing.hitStop of
// held frame (the clock runs; the picture holds), a three-frame ink flash and a small shake.
// Motion: true plays everything; 'reduced' slides units between tiles and shows numbers, with each
// outcome as a still badge, but plays no clips, flash animation, shake, effects or hit-stop (§18.2
// item 16, COMBAT §15); false (MILO's Motion off) lasts 0 ms and at(anything) is the final frame.
// Numbers (COMBAT §14.4): damage and patches in the 6×9 font, a Graze in the smaller 4×6, a
// Critical butter with a star, and a Miss a grey "miss".
import { CLIP_TIMING, poseOps, signatureClip } from './sprites-party.js';

export const DEFAULT_TIMING = Object.freeze({ tile: 140, melee: 600, cast: 800, effect: Object.freeze([400, 700]), hit: 250, flash: 150, strayBeat: 1500, hitStop: 80, fps: Object.freeze([8, 12]) });
const NUMBER_MS = 900; // a damage number rises and fades over this long
const SWIRL_MS = 600; // the "noticed you" swirl at a fight's start
const GRID_MS = 400; // then the grid fades in
const RELEASE = 300; // a ranged clip lets go this far in; the projectile flies from there
const FLIGHT_PER_TILE = 45;
const EMPTY = Object.freeze([]);

// ---------- rows and frames ----------

/** Rows with `legs` put in from row `at` (by default the last rows): withLegs(rows, legs, 18) is Milo's stride. */
export function withLegs(rows, legs, at = rows.length - legs.length) {
  const from = Math.max(0, Math.min(rows.length, Math.round(at)));
  return [...rows.slice(0, from), ...legs.slice(0, rows.length - from), ...rows.slice(from + legs.length)];
}

const PLAIN_POSED = new WeakMap();
const shiftRow = (row, dx) => (dx > 0 ? '.'.repeat(dx) + row.slice(0, row.length - dx) : dx < 0 ? row.slice(-dx) + '.'.repeat(-dx) : row);

/**
 * A pose operation on a frame, moving its rows, masks and anchors together. A rig Frame
 * (sprites-party.clipFrames, carrying `look`) goes through the rig's own poseOps (breathe, squash,
 * shift, nudge, lift, overlay). Any other frame ({ rows, layers?, wear?, anchors?, feet? }, such as a
 * stray's) takes nudge { dx }, lift { dy } and shift { dx, top, bottom } here. A list of ops runs in
 * order. Memoised per frame and op, so the same call gives the same frozen object (the painter's
 * cache keeps hitting).
 */
export function poseFrame(frame, op) {
  if (!frame || !op) return frame;
  if (Array.isArray(op)) return op.reduce((f, o) => poseFrame(f, o), frame);
  if (frame.look && frame.anchors) return poseOps(frame, op);
  const key = JSON.stringify(op);
  let memo = PLAIN_POSED.get(frame);
  if (memo?.has(key)) return memo.get(key);
  if (!memo) {
    memo = new Map();
    PLAIN_POSED.set(frame, memo);
  }
  const h = frame.rows.length;
  const dx = Math.round(op.dx || 0);
  const dy = op.op === 'lift' ? Math.round(op.dy || 0) : 0;
  const top = op.op === 'shift' ? Math.max(0, op.top ?? 0) : 0;
  const bottom = op.op === 'shift' ? Math.min(h, op.bottom ?? h) : h;
  const move = (rows) => {
    if (!rows) return rows;
    const blank = '.'.repeat(rows[0].length);
    let out = rows.map((row, y) => (y >= top && y < bottom ? shiftRow(row, dx) : row));
    if (dy) out = out.map((_, y) => out[y + dy] ?? blank);
    return Object.freeze(out);
  };
  const anchors = frame.anchors ? Object.freeze(Object.fromEntries(Object.entries(frame.anchors).map(([k, [x, y]]) => [k, Object.freeze([y >= top && y < bottom ? x + dx : x, y - dy])]))) : frame.anchors;
  const out = Object.freeze({ ...frame, rows: move(frame.rows), layers: move(frame.layers), wear: move(frame.wear), anchors });
  if (memo.size >= 64) memo.delete(memo.keys().next().value);
  memo.set(key, out);
  return out;
}

// ---------- clips ----------

const clipPoseOf = (anims, clip) => anims?.clipPoses?.[clip] || (clip === 'sorted' ? 'settle' : clip === 'ready' ? 'idle' : null);

/** A clip's timing for a look: a hero's from CLIP_TIMING, a stray's from its anims.json pose. */
export function clipInfo(look, clip, anims = null) {
  if (look?.kind === 'rig') return CLIP_TIMING[clip] || CLIP_TIMING.ready;
  if (look?.kind === 'stray') {
    const poseName = clipPoseOf(anims, clip);
    const pose = anims?.poses?.[look.archetype]?.[poseName];
    if (pose && Array.isArray(pose.frames) && pose.frames.length) return { fps: pose.fps || 8, frames: pose.frames.length, loop: !!pose.loop, still: pose.still === 'last' ? 'last' : 'first', pose, poseName };
  }
  return { fps: 8, frames: 1, loop: true, still: 'first' };
}

/** How long a one-shot clip plays (ms). */
export const clipMs = (info) => Math.round((info.frames * 1000) / Math.max(1, info.fps));

/** The frame of a clip `elapsed` ms in (null: a still frame, as with motion off). */
export function clipFrame(info, elapsed, still = false) {
  const last = Math.max(0, info.frames - 1);
  if (still || elapsed === null || !Number.isFinite(elapsed)) return info.still === 'last' ? last : 0;
  const n = Math.floor((Math.max(0, elapsed) * info.fps) / 1000);
  return info.loop ? n % info.frames : Math.min(last, n);
}

const ITEM_KINDS = new Set(['item']);
const SPELL_KINDS = new Set(['knack', 'spell']);

/** The clip an action plays, and its spell effect (anims.spells) if any. */
export function actionClip(action, actor, { abilities = null, anims = null, target = null } = {}) {
  const id = action?.id;
  const look = actor?.look;
  const far = target && actor ? Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) > (actor.size || 1) : false;
  switch (id) {
    case 'strike': return { clip: far ? 'ranged' : 'melee', effect: null };
    case 'throw': return { clip: 'ranged', effect: null };
    case 'shove': return { clip: 'melee', effect: null };
    case 'jump': return { clip: 'jump', effect: null };
    case 'brace': case 'ready': return { clip: 'brace', effect: null };
    case 'hide': return { clip: 'dodge', effect: null };
    case 'head-home': return { clip: 'wave', effect: null };
    case 'sustain': return { clip: 'sustain', effect: null };
    case 'stride': case 'step': case 'delay': return { clip: null, effect: null };
    case 'use': {
      const ability = action.ability || '';
      const def = abilities && typeof abilities.get === 'function' ? abilities.get(ability) : null;
      const effect = anims?.spells?.[ability] || null;
      const own = signatureClip(look, ability);
      if (own) return { clip: own, effect };
      if (ITEM_KINDS.has(def?.kind)) return { clip: 'item', effect };
      if (effect || SPELL_KINDS.has(def?.kind)) return { clip: 'cast', effect };
      if (ability.startsWith('mech:')) return { clip: 'gesture', effect: null };
      return { clip: actor?.side === 'party' ? 'gesture' : far ? 'ranged' : 'melee', effect: null };
    }
    default: return { clip: 'gesture', effect: null };
  }
}

// ---------- the timeline ----------

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** How much quicker a playback runs at `speed` (1, 2 or 4; anything else within reason). */
export const paceOf = (speed) => ([1, 2, 4].includes(speed) ? speed : Math.max(0.25, Number(speed) || 1));
const lerp = (a, b, k) => a + (b - a) * k;
const tileOf = (u) => ({ x: u.x, y: u.y });
const facingTo = (from, to, was) => (to.x > from.x ? 'right' : to.x < from.x ? 'left' : was);

function timingOf(rules) {
  const t = rules?.timing || {};
  const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
  const effect = Array.isArray(t.effect) && t.effect.length === 2 ? t.effect.map((v, i) => num(v, DEFAULT_TIMING.effect[i])) : DEFAULT_TIMING.effect;
  return {
    tile: num(t.tile, DEFAULT_TIMING.tile), melee: num(t.melee, DEFAULT_TIMING.melee), cast: num(t.cast, DEFAULT_TIMING.cast), effect,
    hit: num(t.hit, DEFAULT_TIMING.hit), flash: num(t.flash, DEFAULT_TIMING.flash), strayBeat: num(t.strayBeat, DEFAULT_TIMING.strayBeat), hitStop: num(t.hitStop, DEFAULT_TIMING.hitStop),
  };
}

/**
 * timeline(events, opts) → Timeline for these events played from the units' starting views.
 * opts: units (UnitView[] at the start), abilities (B's AbilityIndex, a Map), anims
 * (content.combat.anims), motion (true | 'reduced' | false), speed (1 | 2 | 4), fastFoes (default
 * true), rules (content.combat.rules, for timing), opening (unit ids that noticed the party: the
 * fight's start, with the "noticed you" swirl over them and then the grid fading in), from
 * ({ index, at }, or a list of them, one for every addition to the playback: the events from `index`
 * on were added to a playback already `at` ms in, as timeAt gives it at this speed; their segments
 * start no earlier, and a kind's strays still join the beat in hand).
 * Timeline = { duration, events: [{ at, ev }] (every event, at the ms it lands, for the board),
 *   final: { [id]: { x, y, facing, base, gone } }, at(ms) → Frame, timeAt(ms) → the playback's own ms,
 *   wallAt(own) → the wall ms that own time falls at, pace (the speed as played) }
 * Frame = { units: { [id]: { x, y (tiles), clip, frame, facing, flash: null | { kind, frame }, alpha } },
 *   numbers: [{ text, x, y, dy (px, rising), fill, size, star, alpha }], effects: [{ effect | projectile,
 *   frame, x, y, dir? }], marks: [{ kind: 'feint' | 'thought', unit, picture }], shake: { dx, dy },
 *   flash (the screen's ink, 0–1), grid (0–1), done }
 */
export function timeline(events, { units = [], abilities = null, anims = null, motion = true, speed = 1, fastFoes = true, rules = null, opening = null, from = null } = {}) {
  const T = timingOf(rules);
  const full = motion === true;
  const moving = motion === true || motion === 'reduced';
  const pace = paceOf(speed);
  const list = Array.isArray(events) ? events.filter((e) => e && typeof e.t === 'string') : [];
  const start = new Map(units.filter((u) => u && typeof u.id === 'string').map((u) => [u.id, u]));
  // What each unit is doing as the events are read, and what it's to be seen doing.
  const now = new Map();
  for (const u of start.values()) {
    now.set(u.id, { x: u.x, y: u.y, facing: u.facing === 'left' ? 'left' : 'right', base: u.offline ? 'dozing' : 'ready', gone: !!u.sorted, look: u.look, side: u.side, size: u.size || 1 });
  }
  const tracks = new Map(); // id → { moves: [], clips: [], bases: [], flashes: [], shows: [] }
  const trackOf = (id) => {
    let t = tracks.get(id);
    if (!t) {
      t = { moves: [], clips: [], bases: [], flashes: [], shows: [] };
      tracks.set(id, t);
    }
    return t;
  };
  const numbers = [];
  const effects = [];
  const marks = [];
  const flashes = [];
  const shakes = [];
  const stops = [];
  const board = [];

  let cursor = 0;
  let gridAt = 0;
  if (Array.isArray(opening)) {
    const seen = opening.filter((id) => start.has(id));
    // The swirl and the fade are decoration: only with full motion (reduced motion shows the grid at once).
    if (full) {
      for (const id of seen) effects.push({ start: 0, end: SWIRL_MS, effect: 'noticed', frames: anims?.effects?.noticed?.frames || 6, unit: id, tile: tileOf(start.get(id)) });
      gridAt = seen.length ? SWIRL_MS : 0;
      cursor = gridAt + GRID_MS;
    }
  }

  // Segments: an act and everything it caused, in relative ms; each is placed and scaled after.
  const segments = [];
  let seg = null;
  let tick = null;
  let index = 0; // the event being read (a segment remembers the one that opened it, for `from`)
  const open = (ev, actor) => {
    // An act names its own round and tick; a step's events played on their own may carry no tick event.
    const own = ev && ev.tick !== undefined && ev.tick !== null ? `${ev.round ?? ''}:${ev.tick}` : tick;
    seg = { actor, side: actor ? now.get(actor)?.side : null, talkKind: actor ? start.get(actor)?.talkKind ?? null : null, tick: own, from: index, items: [], lc: 0, impact: 0, end: 0 };
    segments.push(seg);
    return seg;
  };
  const ensure = () => seg || open(null, null);
  const put = (item) => ensure().items.push(item);
  // Every addition's hold ({ index, floor }: raw ms, before the pace), kept for as long as the playback runs.
  const holds = (Array.isArray(from) ? from : from ? [from] : [])
    .filter((h) => h && Number.isInteger(h.index) && h.index >= 0 && Number.isFinite(h.at))
    .map((h) => ({ index: h.index, floor: Math.max(0, h.at) * pace }));
  const bounds = new Set(holds.map((h) => h.index));
  // Before the next act, tick or round: the look-ahead that gives a thought and a light their place.
  // It never reaches past an addition: what was read before the addition keeps its place.
  const ahead = (i, fn) => {
    for (let j = i + 1; j < list.length && !bounds.has(j); j += 1) {
      const e = list[j];
      if (e.t === 'act' || e.t === 'tick' || e.t === 'round') return fn(e) ? j : -1;
      if (fn(e)) return j;
    }
    return -1;
  };
  const thoughts = new Map(); // act index → the thought events it carries
  const lightsAt = new Map(); // move index → [{ ev, tile }]: the Hooklight's changes as Milo walks

  for (const [i, ev] of list.entries()) {
    index = i;
    // Events added to a running playback never join (or lengthen) a segment already playing.
    if (seg && bounds.has(i)) seg = null;
    if (ev.t === 'thought' || (ev.t === 'feint' && ev.spotted)) {
      // A drafted hero's thought comes just before its own act, and shows in that act's segment. A
      // spotted feint (or a thought with no act of its own after it) is a mark in the unit's own
      // segment, which takes no time: it never shows over, or stretches, whoever acted before.
      const act = ev.t === 'thought' ? ahead(i, (e) => e.t === 'act' && e.unit === ev.unit) : -1;
      if (act >= 0) {
        thoughts.set(act, [...(thoughts.get(act) || []), ev]);
        continue;
      }
      const s = open(ev, typeof ev.unit === 'string' ? ev.unit : null);
      if (ev.picture || ev.t === 'feint') s.items.push({ kind: 'mark', at: 0, end: ev.t === 'feint' ? 700 : 900, mark: ev.t, unit: ev.unit, picture: ev.picture || null });
      s.items.push({ kind: 'board', at: 0, ev });
      seg = null;
      continue;
    }
    if (ev.t === 'light') {
      // The Hooklight follows Milo. B sends its change after the `move` that carried him, so it lands
      // as he arrives; one sent ahead of his walk (on a tile he hasn't reached yet) waits for that
      // walk and lands as he reaches its tile, so the light never jumps ahead of him.
      const hook = (Array.isArray(ev.lights) ? ev.lights : []).find((l) => l && l.id === 'hooklight');
      const carrier = hook && (now.get(hook.source) || now.get('milo'));
      const on = (e) => e.t === 'move' && Array.isArray(e.path) && e.path.some((p) => p && p.x === hook.x && p.y === hook.y);
      const move = carrier && (carrier.x !== hook.x || carrier.y !== hook.y) ? ahead(i, on) : -1;
      if (move >= 0) {
        lightsAt.set(move, [...(lightsAt.get(move) || []), { ev, tile: { x: hook.x, y: hook.y } }]);
        continue;
      }
    }
    if (ev.t === 'tick' || ev.t === 'round') {
      tick = `${ev.round ?? ''}:${ev.tick ?? ''}`;
      seg = null;
      put({ kind: 'board', at: 0, ev });
      continue;
    }
    if (ev.t === 'act') {
      const actor = typeof ev.unit === 'string' ? ev.unit : null;
      const s = open(ev, actor);
      const who = now.get(actor);
      const targetId = ev.action?.target?.unit || (ev.action?.target?.units || [])[0] || null;
      const target = targetId && now.get(targetId) ? now.get(targetId) : ev.action?.target?.tile || null;
      const { clip, effect } = actionClip(ev.action, who ? { ...who, look: who.look } : null, { abilities, anims, target });
      const info = clip && who ? clipInfo(who.look, clip, anims) : null;
      const dur = info ? clipMs(info) : 0;
      s.clipDur = dur;
      // The actor turns to its target for the clip only: after it, it faces the way B says (the last
      // step it took), so a resume's syncCombat never flips anyone.
      if (clip && who) s.items.push({ kind: 'clip', at: 0, unit: actor, clip, dur, facing: target && target.x !== who.x ? (target.x > who.x ? 'right' : 'left') : who.facing });
      for (const th of thoughts.get(i) || EMPTY) {
        if (th.picture) s.items.push({ kind: 'mark', at: 0, end: 900, mark: 'thought', unit: th.unit, picture: th.picture });
        s.items.push({ kind: 'board', at: 0, ev: th });
      }
      if (clip === 'melee') s.impact = Math.round(dur * 0.5);
      else if (clip === 'ranged') {
        const d = target && who ? Math.max(Math.abs(target.x - who.x), Math.abs(target.y - who.y)) : 1;
        const flight = Math.max(120, d * FLIGHT_PER_TILE);
        s.impact = Math.min(dur, RELEASE) + flight;
        if (target && who) s.items.push({ kind: 'projectile', at: Math.min(dur, RELEASE), end: s.impact, from: tileOf(who), to: tileOf(target), id: ev.action?.ability || ev.action?.id || 'strike' });
      } else if (effect) {
        const frames = anims?.effects?.[effect]?.frames || 6;
        const eff = clampNum(frames * 90, T.effect[0], T.effect[1]);
        s.impact = dur + Math.round(eff / 2);
        s.items.push({ kind: 'effect', at: dur, end: dur + eff, effect, frames, tile: target ? tileOf(target) : who ? tileOf(who) : null });
      } else s.impact = dur;
      s.lc = 0;
      s.end = dur;
      s.items.push({ kind: 'board', at: 0, ev });
      continue;
    }
    const s = ensure();
    // When a thing this segment caused lands: the actor's own walk right away, the rest at impact.
    const at = (unitMoves = false) => (unitMoves ? s.lc : Math.max(s.lc, s.impact));
    switch (ev.t) {
      case 'move': {
        const who = now.get(ev.unit);
        const path = (Array.isArray(ev.path) ? ev.path : []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
        const lit = lightsAt.get(i) || EMPTY;
        if (!who || !path.length) {
          for (const l of [...lit.map((it) => it.ev), ev]) s.items.push({ kind: 'board', at: at(), ev: l });
          break;
        }
        const own = ev.unit === s.actor && !ev.by;
        const t0 = ev.how === 'swap' && s.swapAt !== undefined ? s.swapAt : at(own);
        if (ev.how === 'swap') s.swapAt = t0;
        const steps = [{ x: who.x, y: who.y }, ...path];
        const per = ev.how === 'teleport' ? 0 : ev.how === 'push' || ev.how === 'pull' || ev.how === 'fall' ? Math.round(T.tile * 0.7) : T.tile;
        const len = per * (steps.length - 1);
        const last = steps[steps.length - 1];
        // B's facing: each step turns the mover the way that step goes across (a step straight up or
        // down keeps it), so the walk faces step by step and ends as the last sideways step left it.
        const faces = [];
        for (let k = 1; k < steps.length; k += 1) faces.push(facingTo(steps[k - 1], steps[k], faces.length ? faces[faces.length - 1] : who.facing));
        const facing = faces.length ? faces[faces.length - 1] : who.facing;
        s.items.push({ kind: 'move', at: t0, end: t0 + len, unit: ev.unit, steps, faces, how: ev.how, facing });
        // The Hooklight's changes land as the walker reaches each one's tile.
        let from = 0; // eslint-disable-line no-shadow
        for (const l of lit) {
          const k = path.findIndex((p, n) => n >= from && p.x === l.tile.x && p.y === l.tile.y);
          from = Math.max(from, k);
          s.items.push({ kind: 'board', at: t0 + per * (k + 1), ev: l.ev });
        }
        who.facing = facing;
        who.x = last.x;
        who.y = last.y;
        // A swap is two linked moves: the second starts with the first (swapAt).
        s.lc = Math.max(s.lc, t0 + len);
        if (ev.how === 'push' || ev.how === 'pull' || ev.how === 'fall') s.items.push({ kind: 'clip', at: t0, unit: ev.unit, clip: 'hit', dur: T.hit, facing: who.facing });
        s.items.push({ kind: 'board', at: t0 + len, ev });
        s.end = Math.max(s.end, s.lc);
        break;
      }
      case 'outcome': {
        const t0 = at();
        if (ev.degree === 'crit' || ev.degree === 'graze' || ev.degree === 'miss') {
          s.items.push({ kind: 'flash', at: t0, unit: ev.target || ev.unit, degree: ev.degree });
          if (ev.degree === 'crit') s.items.push({ kind: 'crit', at: t0 });
        }
        // A Miss has no damage to show: its number is a grey "miss" (COMBAT §14.4).
        if (ev.degree === 'miss' && now.get(ev.target || ev.unit)) s.items.push({ kind: 'number', at: t0, unit: ev.target || ev.unit, text: 'miss', fill: 'S', size: 'small', star: false });
        s.items.push({ kind: 'board', at: t0, ev });
        s.lc = Math.max(s.lc, t0);
        s.end = Math.max(s.end, t0 + T.flash);
        break;
      }
      case 'damage': case 'patch': {
        const t0 = at();
        const target = now.get(ev.target);
        if (target && Number.isFinite(ev.amount)) {
          const crit = ev.degree === 'crit';
          const text = ev.t === 'patch' ? `+${Math.round(ev.amount)}` : String(Math.round(ev.amount));
          // COMBAT §14.4: the 6×9 font for damage and patches (butter with a star for a Critical), the smaller 4×6 for a Graze.
          const size = ev.t === 'damage' && ev.degree === 'graze' ? 'small' : 'big';
          s.items.push({ kind: 'number', at: t0, unit: ev.target, text, fill: ev.t === 'patch' ? 'l' : crit ? 'u' : 'c', size, star: crit && ev.t === 'damage' });
          if (ev.t === 'damage' && !target.gone && target.base !== 'dozing') s.items.push({ kind: 'clip', at: t0, unit: ev.target, clip: 'hit', dur: T.hit, facing: target.facing });
          if (ev.t === 'damage' && ev.kind && anims?.effects?.[`impact.${ev.kind}`]) s.items.push({ kind: 'effect', at: t0, end: t0 + T.hit, effect: `impact.${ev.kind}`, frames: anims.effects[`impact.${ev.kind}`].frames || 4, tile: tileOf(target), unit: ev.target });
        }
        s.items.push({ kind: 'board', at: t0, ev });
        s.lc = Math.max(s.lc, t0);
        s.end = Math.max(s.end, t0 + T.hit);
        break;
      }
      case 'offline': {
        const t0 = at();
        const who = now.get(ev.unit);
        if (who) {
          const dur = clipMs(clipInfo(who.look, 'offline', anims));
          s.items.push({ kind: 'clip', at: t0 + T.hit, unit: ev.unit, clip: 'offline', dur, facing: who.facing });
          s.items.push({ kind: 'base', at: t0 + T.hit + dur, unit: ev.unit, base: 'dozing' });
          who.base = 'dozing';
          s.end = Math.max(s.end, t0 + T.hit + dur);
        }
        s.items.push({ kind: 'board', at: t0, ev });
        break;
      }
      case 'reboot': {
        const t0 = at();
        const who = now.get(ev.unit);
        if (who) {
          const dur = clipMs(clipInfo(who.look, 'reboot', anims));
          s.items.push({ kind: 'clip', at: t0, unit: ev.unit, clip: 'reboot', dur, facing: who.facing });
          s.items.push({ kind: 'base', at: t0 + dur, unit: ev.unit, base: 'ready' });
          if (anims?.effects?.reboot) s.items.push({ kind: 'effect', at: t0, end: t0 + dur, effect: 'reboot', frames: anims.effects.reboot.frames || 5, tile: tileOf(who), unit: ev.unit });
          who.base = 'ready';
          s.end = Math.max(s.end, t0 + dur);
        }
        s.items.push({ kind: 'board', at: t0, ev });
        break;
      }
      case 'sorted': case 'gone': {
        const t0 = at();
        const who = now.get(ev.unit);
        if (who && !who.gone) {
          const clip = ev.t === 'sorted' ? (ev.how === 'settled' ? 'sorted' : 'wave') : null;
          const dur = clip ? clipMs(clipInfo(who.look, clip, anims)) : T.hit;
          if (clip) s.items.push({ kind: 'clip', at: t0 + T.hit, unit: ev.unit, clip, dur, facing: who.facing });
          s.items.push({ kind: 'show', at: t0 + T.hit + dur, unit: ev.unit, shown: false });
          who.gone = true;
          s.end = Math.max(s.end, t0 + T.hit + dur);
        }
        s.items.push({ kind: 'board', at: t0, ev });
        break;
      }
      case 'spawn': {
        const t0 = at();
        const view = ev.unit && typeof ev.unit === 'object' ? ev.unit : null;
        if (view && typeof view.id === 'string') {
          start.set(view.id, view);
          now.set(view.id, { x: view.x, y: view.y, facing: view.facing === 'left' ? 'left' : 'right', base: 'ready', gone: false, look: view.look, side: view.side, size: view.size || 1 });
          s.items.push({ kind: 'show', at: t0, unit: view.id, shown: true, from: true });
          if (anims?.effects?.noticed) s.items.push({ kind: 'effect', at: t0, end: t0 + SWIRL_MS, effect: 'noticed', frames: anims.effects.noticed.frames || 6, tile: tileOf(view), unit: view.id });
          s.end = Math.max(s.end, t0 + SWIRL_MS);
        }
        s.items.push({ kind: 'board', at: t0, ev });
        break;
      }
      case 'phase': {
        const t0 = at();
        const who = now.get(ev.unit);
        if (who) s.items.push({ kind: 'clip', at: t0, unit: ev.unit, clip: 'cheer', dur: 600, facing: who.facing });
        s.items.push({ kind: 'board', at: t0, ev });
        s.end = Math.max(s.end, t0 + 600);
        break;
      }
      default:
        s.items.push({ kind: 'board', at: at(), ev });
    }
  }

  // Place the segments: one after another, a kind's strays in a tick together, foes quicker.
  // Every addition's hold starts the segments of its events (from its `index` on) no earlier than the
  // moment it was added, so nothing added jumps part way, then or at any later addition or speed.
  const floorOf = (s) => {
    let f = 0;
    for (const h of holds) if (s.from >= h.index && h.floor > f) f = h.floor;
    return f;
  };
  let groupStart = cursor;
  let groupEnd = cursor;
  let prev = null;
  for (const s of segments) {
    // Marks (a thought, a spotted feint) show over what follows: they never lengthen a segment.
    const raw = Math.max(s.end, s.lc, ...s.items.map((it) => (it.kind === 'mark' ? 0 : it.end || it.at || 0)));
    let k = 1;
    if (s.side === 'foe' && raw > 0) k = Math.min(raw, T.strayBeat) / raw * (fastFoes ? 0.5 : 1);
    if (!moving) k = 0;
    // A segment of board events alone (a tick's start, an `improvise` ahead of a stray's act) takes no
    // time and breaks no beat: the stray after it still moves with its kind.
    const idle = !s.actor && raw === 0;
    const joins = !idle && isBeat(s) && isBeat(prev) && prev.talkKind === s.talkKind && prev.tick === s.tick;
    let begin = joins ? groupStart : groupEnd;
    begin = Math.max(begin, floorOf(s));
    s.start = begin;
    s.k = k;
    if (idle) continue;
    if (!joins) groupStart = begin;
    const len = raw * k;
    groupEnd = Math.max(joins ? groupEnd : begin, begin + len);
    prev = s;
  }
  let duration = segments.length ? groupEnd : cursor;

  // Items onto the one clock (ms from the timeline's start, before the hit-stops).
  const when = (s, t) => (s.start + t * s.k) / pace;
  for (const s of segments) {
    for (const it of s.items) {
      const at = when(s, it.at || 0); // eslint-disable-line no-shadow
      const end = it.end !== undefined ? when(s, it.end) : undefined;
      switch (it.kind) {
        case 'clip': if (full) trackOf(it.unit).clips.push({ start: at, end: at + (it.dur * s.k) / pace, clip: it.clip, facing: it.facing }); break;
        case 'move': trackOf(it.unit).moves.push({ start: at, end, steps: it.steps, faces: it.faces, facing: it.facing }); break;
        case 'base': trackOf(it.unit).bases.push({ at, base: it.base }); break;
        case 'show': trackOf(it.unit).shows.push({ at, shown: it.shown }); break;
        case 'flash':
          // Reduced motion shows the outcome as a still badge (COMBAT §15), as long as a number reads.
          if (full) trackOf(it.unit).flashes.push({ start: at, end: at + T.flash / pace, kind: it.degree });
          else trackOf(it.unit).flashes.push({ start: at, end: at + NUMBER_MS / pace, kind: it.degree, still: true });
          break;
        case 'crit':
          if (full) {
            stops.push({ at, len: T.hitStop });
            flashes.push({ start: at, end: at + T.flash });
            shakes.push({ start: at, end: at + 200 });
          }
          break;
        case 'number': numbers.push({ start: at, end: at + NUMBER_MS / pace, unit: it.unit, text: it.text, fill: it.fill, size: it.size, star: it.star }); break;
        case 'effect': if (full && it.tile) effects.push({ start: at, end, effect: it.effect, frames: it.frames, tile: it.tile }); break;
        case 'projectile': if (full) effects.push({ start: at, end, projectile: it.id, from: it.from, to: it.to }); break;
        case 'mark': marks.push({ start: at, end, kind: it.mark, unit: it.unit, picture: it.picture || null }); break;
        default: board.push({ at, ev: it.ev });
      }
    }
  }
  duration = moving ? duration / pace : 0;
  // Numbers keep reading a moment past the last action; a thought or a feint's mark shows in full.
  if (moving) for (const n of numbers) duration = Math.max(duration, Math.min(n.end, n.start + 450 / pace));
  if (moving) for (const m of marks) duration = Math.max(duration, m.end);
  stops.sort((a, b) => a.at - b.at);
  // Wall time: the hit-stops hold the picture while the clock runs, so they lengthen the timeline.
  let held = 0;
  for (const stop of stops) {
    stop.wall = stop.at + held;
    held += stop.len;
  }
  const wallOf = (t) => {
    let add = 0;
    for (const stop of stops) if (stop.at <= t) add += stop.len;
    return t + add;
  };
  const total = moving ? duration + held : 0;
  // Board events land in B's order, never earlier than one before them (strays sharing a beat overlap,
  // but a later event's Integrity or conditions must never be overwritten by an earlier one's).
  const order = new Map(list.map((e, i) => [e, i]));
  let prior = 0;
  const landed = board.map((b) => ({ at: moving ? Math.min(total, wallOf(b.at)) : 0, ev: b.ev, i: order.get(b.ev) ?? 0 }))
    .sort((a, b) => a.i - b.i)
    .map((b) => ({ at: (prior = Math.max(prior, b.at)), ev: b.ev }));
  const effTime = (ms) => {
    let t = ms;
    for (const stop of stops) t -= clampNum(ms - stop.wall, 0, stop.len);
    return t;
  };

  const final = {};
  for (const [id, u] of now) final[id] = { x: u.x, y: u.y, facing: u.facing, base: u.base, gone: u.gone };

  function unitAt(id, t) {
    const u0 = start.get(id);
    const tr = tracks.get(id);
    if (!tr || !moving || t >= duration) {
      // Nothing happens to it (it idles), or the timeline is over: where it ends, in its base clip.
      const f = final[id];
      const info = clipInfo(u0.look, f.base, anims);
      const idle = full && Number.isFinite(t) ? t : null;
      return { x: f.x, y: f.y, clip: f.base, frame: clipFrame(info, idle, idle === null), facing: f.facing, flash: null, alpha: f.gone ? 0 : 1 };
    }
    let x = u0.x;
    let y = u0.y;
    let facing = u0.facing === 'left' ? 'left' : 'right';
    let base = u0.offline ? 'dozing' : 'ready';
    let shown = !u0.sorted;
    for (const b of tr.bases) if (b.at <= t) base = b.base;
    for (const sh of tr.shows) if (sh.at <= t) shown = sh.shown;
    if (tr.shows.some((sh) => sh.shown && sh.at > t)) shown = false; // spawned later
    let walking = null;
    for (const m of tr.moves) {
      if (m.start > t) break;
      const n = m.steps.length - 1;
      if (t >= m.end || m.end <= m.start) {
        x = m.steps[n].x;
        y = m.steps[n].y;
        facing = m.facing;
      } else {
        const k = ((t - m.start) / (m.end - m.start)) * n;
        const i = Math.min(n - 1, Math.floor(k));
        x = lerp(m.steps[i].x, m.steps[i + 1].x, k - i);
        y = lerp(m.steps[i].y, m.steps[i + 1].y, k - i);
        walking = m;
        facing = m.faces ? m.faces[i] : m.facing;
      }
    }
    let clip = base;
    let since = t;
    for (const c of tr.clips) if (c.start <= t && t < c.end) { clip = c.clip; since = t - c.start; facing = c.facing || facing; }
    if (walking && clip === base) { clip = 'walk'; since = t - walking.start; }
    const info = clipInfo(u0.look, clip, anims);
    let flash = null;
    for (const f of tr.flashes) if (f.start <= t && t < f.end) flash = { kind: f.kind, frame: f.still ? 1 : Math.min(2, Math.floor(((t - f.start) / (f.end - f.start)) * 3)) };
    return { x, y, clip, frame: clipFrame(info, full ? since : null, !full), facing, flash, alpha: shown ? 1 : 0 };
  }

  function at(ms) {
    const wall = Math.max(0, Number(ms) || 0);
    const t = moving ? Math.min(duration, effTime(wall)) : duration;
    const done = wall >= total;
    const units = {};
    for (const id of now.keys()) units[id] = unitAt(id, done ? Infinity : t);
    const nums = [];
    if (!done) {
      for (const n of numbers) {
        if (t < n.start || t >= n.end) continue;
        const u = units[n.unit];
        const k = (t - n.start) / (n.end - n.start);
        nums.push({ text: n.text, x: u ? u.x : 0, y: u ? u.y : 0, dy: full ? Math.round(12 * (1 - (1 - k) * (1 - k))) : 0, fill: n.fill, size: n.size, star: n.star, alpha: full && k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1, unit: n.unit });
      }
    }
    const fx = [];
    if (!done && full) {
      for (const e of effects) {
        if (t < e.start || t >= e.end) continue;
        const k = (t - e.start) / Math.max(1, e.end - e.start);
        if (e.projectile) fx.push({ projectile: e.projectile, frame: Math.floor(t / 90) % 2, x: lerp(e.from.x, e.to.x, k), y: lerp(e.from.y, e.to.y, k), dir: Math.abs(e.to.x - e.from.x) >= Math.abs(e.to.y - e.from.y) ? (e.to.x >= e.from.x ? 'right' : 'left') : (e.to.y > e.from.y ? 'down' : 'up') });
        else {
          const tile = e.unit && units[e.unit] ? units[e.unit] : e.tile;
          fx.push({ effect: e.effect, frame: Math.min(e.frames - 1, Math.floor(k * e.frames)), x: tile.x, y: tile.y });
        }
      }
    }
    const ms2 = [];
    if (!done) for (const m of marks) if (t >= m.start && t < m.end) ms2.push({ kind: m.kind, unit: m.unit, picture: m.picture });
    let shake = { dx: 0, dy: 0 };
    let flash = 0;
    if (!done && full) {
      for (const s of shakes) if (t >= s.start && t < s.end) shake = { dx: Math.floor(t / 33) % 2 ? 1 : -1, dy: 0 };
      for (const f of flashes) if (t >= f.start && t < f.end) flash = 0.35 * (1 - (t - f.start) / (f.end - f.start));
    }
    const grid = !Array.isArray(opening) || !full ? 1 : clampNum((t - gridAt) / GRID_MS, 0, 1);
    return { units, numbers: nums, effects: fx, marks: ms2, shake, flash, grid, done };
  }

  /** The playback's own time (hit-stops taken out) `ms` of wall time in: what `from.at` takes. */
  const timeAt = (ms) => (moving ? Math.min(duration, effTime(Math.max(0, Number(ms) || 0))) : duration);
  /** The wall time (hit-stops in) at which the playback's own time reaches `own`: timeAt's inverse. */
  const wallAt = (own) => (moving ? Math.min(total, wallOf(Math.max(0, Number(own) || 0))) : 0);

  return { duration: total, events: landed, final, at, timeAt, wallAt, pace };
}

/** Whether a segment is a stray's that can share a beat: a foe's, with a talkKind. */
function isBeat(s) {
  return !!s && !!s.actor && s.side === 'foe' && s.talkKind !== null && s.talkKind !== undefined;
}

/**
 * The beat a step's events belong to: '<round>:<tick>|<talkKind>' when its action is a stray's with a
 * talkKind (units: the UnitViews), else null. Consecutive steps with the same key play as one beat
 * when they go to one playEvents call, or when each is added while the last still plays.
 */
export function beatKey(events, units) {
  const act = (Array.isArray(events) ? events : []).find((e) => e && e.t === 'act' && typeof e.unit === 'string');
  const u = act && (Array.isArray(units) ? units : []).find((v) => v && v.id === act.unit);
  if (!u || u.side !== 'foe' || u.talkKind === null || u.talkKind === undefined) return null;
  return `${act.round ?? ''}:${act.tick ?? ''}|${u.talkKind}`;
}

export { EMPTY as NO_EVENTS };
