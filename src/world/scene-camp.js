// The camp (CONTRACT-PHASE4.md §11.3–§11.4; COMBAT.md §2.6, §14.4): the company's idle life round
// the vale's fire, as an engine layer, and the small moments the shell plays anywhere (a paper lantern
// rising for a level up, Toby's handcart for the wake-up, Breather tea, the Scribe's pen).
//
// setCamp(CampView | null), CampView = { night, members: [{ id, look, seat (MAP.slots.camp4 index),
// pose: 'sit' | 'sleep' | 'talk' | 'stand', bubble }], props: string[] (PROPS4 ids: handcart,
// breather-tea, paper-lantern) }. The camp isn't a scene: it's drawn in the vale, at the fire, only
// while Milo isn't in an Elsewhere. Crew already sat on the fire's five seats by setCrew keep them,
// and the camp skips anyone sat there (the Scribe as a companion is the crew member claude).
// Idle loops run on the engine's time and hold their still frame at t === null. Moments play on a
// clock the engine advances by dt (never absolute time), only with full motion; otherwise, and on
// dispose, they finish at once.
import { TILE } from './map.js';
import { clipFrames, CLIP_TIMING } from './sprites-party.js';
import { composeStray, restFeet } from './straygen.js';
import { PROPS4 } from './props4.js';

const FEET = 13;
export const POSE_CLIPS = Object.freeze({ sit: 'camp-sit', sleep: 'camp-sleep', talk: 'camp-talk', stand: 'ready' });
/** Where the camp's props stand (tiles), round the fire at (31, 20). */
export const CAMP_PROPS = Object.freeze({
  handcart: Object.freeze({ x: 26, y: 21 }),
  'breather-tea': Object.freeze({ x: 32, y: 21 }),
  'paper-lantern': Object.freeze({ x: 34, y: 18 }),
});
export const MOMENTS = Object.freeze({ 'lantern-rise': 1800, handcart: 1600, tea: 1600, pen: 1200 });

const feetOf = (tile) => ({ x: tile.x * TILE + 8, y: tile.y * TILE + FEET });
const hashId = (text) => {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 5000;
};

/** A frame of a clip at time t (null: its still frame). Pure. */
export function campFrame(clip, t, phase = 0) {
  const timing = CLIP_TIMING[clip] || CLIP_TIMING.ready;
  if (t === null) return timing.still === 'last' ? timing.frames - 1 : 0;
  const n = Math.floor(((t + phase) * timing.fps) / 1000);
  return timing.loop ? n % timing.frames : Math.min(timing.frames - 1, n);
}

/**
 * createCampLayer(env) → the camp as a layer (ground, collect, above, update, busy, settle, dispose)
 * with setCamp, moment(kind, tile) and view(). env: { painter, seats (MAP.slots.camp4), crewSeated(id),
 * hidden(id), inVale() (not inside an Elsewhere), anims(), drawSprite(target, name, frame, x, y),
 * motionOn(), wake() }.
 */
export function createCampLayer(env) {
  let view = null;
  const moments = [];
  const strays = new Map(); // member id → { sig, feet }

  function setCamp(next) {
    if (!next || typeof next !== 'object') {
      view = null;
      return;
    }
    const seats = env.seats || [];
    const members = [];
    for (const m of Array.isArray(next.members) ? next.members : []) {
      if (!m || typeof m.id !== 'string' || !seats[m.seat] || members.some((o) => o.id === m.id || o.seat === m.seat)) continue;
      members.push({ id: m.id, look: m.look || null, seat: m.seat, pose: POSE_CLIPS[m.pose] ? m.pose : 'sit', bubble: !!m.bubble });
    }
    const props = (Array.isArray(next.props) ? next.props : []).filter((id) => CAMP_PROPS[id] && PROPS4[id]);
    view = { night: !!next.night, members, props };
  }

  const shown = () => (view && env.inVale() ? view.members.filter((m) => !env.crewSeated(m.id) && !env.hidden(`camp:${m.id}`)) : []);

  function strayFeet(m) {
    const look = m.look;
    const sig = `${look.archetype}|${look.bodyKey}|${(look.parts || []).map((p) => p.id).join(',')}`;
    let known = strays.get(m.id);
    if (!known || known.sig !== sig) {
      known = { sig, feet: restFeet({ archetype: look.archetype, bodyKey: look.bodyKey || 'r', parts: look.parts || [], size: 28 }) };
      strays.set(m.id, known);
    }
    return known.feet;
  }

  /** What to draw for a member now: { canvas, sx, sy, w, h, x, y } (feet at the seat). */
  function poseOf(m, t) {
    const seat = env.seats[m.seat];
    const at = feetOf(seat);
    const look = m.look || { kind: 'rig', rig: 'robe', who: m.id };
    if (look.kind === 'stray') {
      const anims = env.anims();
      const poseName = m.pose === 'sleep' ? 'sleep' : m.pose === 'talk' ? 'listen' : 'idle';
      const pose = anims?.poses?.[look.archetype]?.[poseName] || null;
      const frames = pose?.frames?.length || 1;
      const frame = t === null || !pose ? 0 : Math.floor(((t + hashId(m.id)) * (pose.fps || 8)) / 1000) % frames;
      const sprite = composeStray({ archetype: look.archetype, bodyKey: look.bodyKey || 'r', parts: look.parts || [], eyeKey: look.eyeKey ?? null, pose, poseName: pose ? poseName : null, frame, size: 28 });
      const feet = strayFeet(m);
      const [g0, g1] = look.genres || [];
      const canvas = env.painter.grid(sprite.rows, env.tableFor(g0 || null), `${g0 || 'base'}|${g1 || g0 || 'base'}`, { mirror: seat.face === 'left', layers: sprite.layers, table2: env.tableFor(g1 || g0 || null), tag: `camp:${m.id}` });
      const w = sprite.rows[0].length;
      const fx = seat.face === 'left' ? w - 1 - feet[0] : feet[0];
      return { canvas, sx: Math.round(at.x - fx), sy: Math.round(at.y - feet[1]), w, h: sprite.rows.length, ...at };
    }
    const clip = POSE_CLIPS[m.pose];
    const facing = seat.face === 'left' ? 'left' : seat.face === 'right' ? 'right' : 'down';
    let frames = clipFrames(look, clip, facing);
    if (!frames.length) frames = clipFrames(look, 'ready', facing);
    if (!frames.length) return null;
    const frame = frames[campFrame(clip, t, hashId(m.id)) % frames.length];
    const canvas = env.painter.grid(frame.rows, null, 'base', { mirror: frame.mirror, tag: `camp:${m.id}` });
    return { canvas, sx: Math.round(at.x - frame.feet[0]), sy: Math.round(at.y - frame.feet[1]), w: frame.w, h: frame.h, ...at };
  }

  function propCanvas(id, frame = 0) {
    const p = PROPS4[id];
    const rows = p.frames[frame % p.frames.length];
    return { p, canvas: env.painter.grid(rows, null, 'base', { tag: `camp:${id}` }) };
  }

  function ground(target, visible) {
    if (!view || !env.inVale()) return;
    // Bedrolls lie flat under whoever sits or sleeps on them.
    for (const m of shown()) {
      if (m.pose === 'stand') continue;
      const at = feetOf(env.seats[m.seat]);
      const { p, canvas } = propCanvas('bedroll');
      const sx = Math.round(at.x - p.feet[0]);
      const sy = Math.round(at.y + 2 - p.feet[1]);
      if (visible(sx, sy, p.w, p.h)) target.drawImage(canvas, sx, sy);
    }
  }

  function collect(drawables, target, visible, t, shadow) {
    if (!view || !env.inVale()) return;
    for (const m of shown()) {
      const pose = poseOf(m, t);
      if (!pose || !visible(pose.sx, pose.sy, pose.w, pose.h)) continue;
      drawables.push({ y: pose.y + 0.3, x: pose.x, draw: () => target.drawImage(pose.canvas, pose.sx, pose.sy) });
    }
    for (const id of view.props) {
      const at = feetOf(CAMP_PROPS[id]);
      const frame = t === null ? 0 : Math.floor(t / 420);
      const { p, canvas } = propCanvas(id, frame);
      const sx = Math.round(at.x - p.feet[0]);
      const sy = Math.round(at.y - p.feet[1]);
      if (!visible(sx, sy, p.w, p.h)) continue;
      shadow(at.x, at.y, Math.min(20, p.w), 3, 0);
      drawables.push({ y: at.y, x: at.x, draw: () => target.drawImage(canvas, sx, sy) });
    }
  }

  function above(target, visible, t) {
    if (view && env.inVale()) {
      // A quest beat ready shows a small "…" bubble, never a marker (COMBAT §2.6).
      for (const m of shown()) {
        if (!m.bubble) continue;
        const at = feetOf(env.seats[m.seat]);
        const bx = Math.round(at.x - 4);
        const by = Math.round(at.y - 34);
        if (!visible(bx, by, 10, 8)) continue;
        env.drawSprite(target, 'bubble', 0, bx, by);
        const dots = t === null ? 3 : 1 + (Math.floor((t + hashId(m.id)) / 600) % 3);
        target.fillStyle = env.ink;
        for (let i = 0; i < dots; i += 1) target.fillRect(bx + 2 + i * 3, by + 2, 2, 2);
      }
    }
    for (const mo of moments) drawMoment(target, visible, mo);
  }

  // ---------- moments ----------

  function drawMoment(target, visible, mo) {
    const k = Math.min(1, mo.clock / mo.dur);
    const at = feetOf(mo.at);
    let id = 'paper-lantern';
    let frame = 0;
    let dx = 0;
    let dy = 0;
    let alpha = 1;
    if (mo.kind === 'lantern-rise') {
      frame = Math.floor(mo.clock / 250);
      dy = -Math.round(44 * k);
      alpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
    } else if (mo.kind === 'handcart') {
      id = 'handcart';
      dx = -Math.round(48 * (1 - Math.min(1, k * 1.3)));
    } else if (mo.kind === 'tea') {
      id = 'breather-tea';
      frame = Math.floor(mo.clock / 260);
    } else {
      id = 'notebook';
      frame = Math.floor(mo.clock / 300);
      dy = -18;
    }
    const { p, canvas } = propCanvas(id, frame);
    const sx = Math.round(at.x - p.feet[0] + dx);
    const sy = Math.round(at.y - p.feet[1] + dy);
    if (!visible(sx, sy, p.w, p.h)) return;
    target.globalAlpha = alpha;
    target.drawImage(canvas, sx, sy);
    target.globalAlpha = 1;
  }

  function moment(kind, at) {
    if (!MOMENTS[kind] || !at || !Number.isInteger(at.x) || !Number.isInteger(at.y)) return Promise.resolve();
    if (!env.motionOn()) return Promise.resolve();
    return new Promise((resolve) => {
      moments.push({ kind, at: { x: at.x, y: at.y }, dur: MOMENTS[kind], clock: 0, resolve });
      env.wake();
    });
  }

  function finish(mo) {
    const i = moments.indexOf(mo);
    if (i >= 0) moments.splice(i, 1);
    mo.resolve();
  }

  return {
    setCamp,
    view: () => (view ? { night: view.night, members: view.members.map((m) => ({ ...m })), props: [...view.props] } : null),
    moment,
    ground,
    collect,
    above,
    update(dt) {
      for (const mo of [...moments]) {
        mo.clock += dt;
        if (mo.clock >= mo.dur) finish(mo);
      }
      return moments.length > 0;
    },
    busy: () => moments.length > 0,
    settle() {
      for (const mo of [...moments]) finish(mo);
    },
    dispose() {
      for (const mo of [...moments]) finish(mo);
      view = null;
    },
  };
}
