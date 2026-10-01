// The Company's fight and camp frames (CONTRACT-PHASE4.md §7.8, COMBAT.md §14.2): four rigs (the
// coat, the robe, Jev and the Tollkeeper), each a set of hand-drawn key poses in palette keys plus
// clip recipes that derive the rest by pose operations. Kept out of sprites.js's SPRITES, so the
// atlas never paints them and Phase 3's milo.* pins never see them: the engine paints a frame
// lazily through painter.grid, and every frame's rows are built once and frozen, so their identity
// is the painter's cache key.
//
//   RIGS, CLIPS, CLIP_TIMING, SIGNATURE_CLIPS
//   clipFrames(look, clip, facing)   frozen Frame[]; 'left' is 'right' with mirror: true
//   exploreFrames(look, dir)         exploration-size frames (the Tollkeeper at the bridge, followers)
//   signatureClip(look, abilityId)   Milo's own clips for Scarf, Raise the lantern and the Wayward step
//   likenessTable(kind)              the Clay Likeness's and the Slate Double's recolour maps
//   poseOps(frame, op)               the rig pose operations on a Frame (rows, wear, held, anchors, neck together)
//   wearMask(rows, held, neck, clothes)   the dressing mask a Frame's `wear` is, from the body itself
//
// A Frame is §7.8's { rows, layers, wear, split, anchors, feet, w, h, mirror, family } plus `held`
// (rows of '1' on what the person holds and the light it throws, or null), `neck` (the row a breath
// bends at: breathe and squash sink everything above it by default; every rig frame has one, from
// the rows the rig's own clips breathe at) and `look` ({ kind: 'rig', rig, who, likeness }, the look
// it was built for, so poseOps can draw that rig's overlays in its colours). Milo's `split` is 0: his
// wear mask carries his head, so outfitGrid(family, rows, { split, wear }) dresses a raised sleeve too.
//
// Pure: imports only sprites.js and the per-rig data files, and runs in Node for the tests.
import { PALETTE, stamp, recolor, breathe, shiftRows, mirror as mirrorRows } from './sprites.js';
import { COAT } from './party/coat.js';
import { ROBE } from './party/robe.js';
import { JEV } from './party/jev.js';
import { TOLL } from './party/toll.js';

const freeze = Object.freeze;

/**
 * Body sizes and fight frames. A body keeps its exploration size inside a frame with room to swing;
 * `feet` is the frame pixel that stands on the tile, and a frame draws at (x − feet[0], y − feet[1]).
 * `origin` is where the body's standing top-left sits in the frame (the pad), and `split` the coat's
 * head-split row in a standing frame (Milo's 11, padded).
 */
export const RIGS = freeze({
  coat: freeze({ w: 16, h: 20, frame: freeze([32, 28]), feet: freeze([16, 26]), split: 18, origin: freeze([8, 7]) }),
  robe: freeze({ w: 16, h: 18, frame: freeze([32, 28]), feet: freeze([16, 26]), origin: freeze([8, 9]) }),
  jev: freeze({ w: 12, h: 10, frame: freeze([32, 28]), feet: freeze([16, 26]), origin: freeze([10, 18]) }),
  toll: freeze({ w: 20, h: 26, frame: freeze([36, 34]), feet: freeze([18, 32]), origin: freeze([8, 7]) }),
});

/** Every clip a hero plays (§7.8). anims.json's clipPoses maps each to the stray pose that plays it. */
export const CLIPS = freeze(['ready', 'walk', 'melee', 'ranged', 'cast', 'sustain', 'gesture', 'hit', 'dodge', 'brace', 'jump', 'tumble', 'stand',
  'offline', 'dozing', 'reboot', 'item', 'cheer', 'wave', 'think', 'laugh', 'shrug', 'sit', 'sleep', 'camp-sit', 'camp-talk', 'camp-sleep', 'camp-job']);

/**
 * Milo's own clips (COMBAT.md §14.2: *Scarf*, *Raise the lantern* and the Wayward step, two hand
 * frames each), keyed by the id of the ability whose action plays them (callings.json's features, the
 * `ability` of a `use` Action). Other looks play 'cast' for these abilities. 'wayward-path' is the
 * Wayward path's passive (+1 Speed), never an action, so it has no clip.
 */
export const SIGNATURE_CLIPS = freeze({ scarf: 'scarf', 'raise-lantern': 'raise-lantern', 'wayward-step': 'wayward-step' });
const EXTRA_CLIPS = freeze(['scarf', 'raise-lantern', 'wayward-step']);

/**
 * Clip timing: frames per second on the engine's playback clock (8–12, COMBAT.md §14.1), how many
 * entries a clip's frame list has (every rig gives exactly this many, at every facing; slow loops
 * repeat a frame), whether it loops, and the still frame shown with motion off. Melee, cast and hit
 * last exactly rules.json's beats (600, 800 and 250 ms), and Milo's signature clips, which play in
 * place of cast, last the cast's 800 ms.
 */
export const CLIP_TIMING = freeze({
  ready: freeze({ fps: 8, frames: 8, still: 'first', loop: true }),
  walk: freeze({ fps: 10, frames: 4, still: 'first', loop: true }),
  melee: freeze({ fps: 10, frames: 6, still: 'last', loop: false }),
  ranged: freeze({ fps: 10, frames: 5, still: 'last', loop: false }),
  cast: freeze({ fps: 10, frames: 8, still: 'last', loop: false }),
  sustain: freeze({ fps: 8, frames: 8, still: 'first', loop: true }),
  gesture: freeze({ fps: 10, frames: 4, still: 'last', loop: false }),
  hit: freeze({ fps: 12, frames: 3, still: 'last', loop: false }),
  dodge: freeze({ fps: 12, frames: 4, still: 'last', loop: false }),
  brace: freeze({ fps: 10, frames: 2, still: 'last', loop: false }),
  jump: freeze({ fps: 10, frames: 4, still: 'last', loop: false }),
  tumble: freeze({ fps: 10, frames: 3, still: 'last', loop: false }),
  stand: freeze({ fps: 8, frames: 3, still: 'last', loop: false }),
  offline: freeze({ fps: 8, frames: 5, still: 'last', loop: false }),
  dozing: freeze({ fps: 8, frames: 16, still: 'first', loop: true }),
  reboot: freeze({ fps: 8, frames: 5, still: 'last', loop: false }),
  item: freeze({ fps: 8, frames: 5, still: 'last', loop: false }),
  cheer: freeze({ fps: 8, frames: 4, still: 'first', loop: true }),
  wave: freeze({ fps: 8, frames: 4, still: 'first', loop: true }),
  think: freeze({ fps: 8, frames: 8, still: 'first', loop: true }),
  laugh: freeze({ fps: 10, frames: 4, still: 'first', loop: true }),
  shrug: freeze({ fps: 8, frames: 4, still: 'last', loop: false }),
  sit: freeze({ fps: 8, frames: 12, still: 'first', loop: true }),
  sleep: freeze({ fps: 8, frames: 16, still: 'first', loop: true }),
  'camp-sit': freeze({ fps: 8, frames: 12, still: 'first', loop: true }),
  'camp-talk': freeze({ fps: 8, frames: 8, still: 'first', loop: true }),
  'camp-sleep': freeze({ fps: 8, frames: 16, still: 'first', loop: true }),
  'camp-job': freeze({ fps: 8, frames: 8, still: 'first', loop: true }),
  scarf: freeze({ fps: 10, frames: 8, still: 'last', loop: false }),
  'raise-lantern': freeze({ fps: 10, frames: 8, still: 'last', loop: false }),
  'wayward-step': freeze({ fps: 10, frames: 8, still: 'last', loop: false }),
});

const DATA = freeze({ coat: COAT, robe: ROBE, jev: JEV, toll: TOLL });
const FAMILY = freeze({ milo: 'milo', claude: 'claude', codex: 'codex' });

// ---------- likenesses ----------

/**
 * The Clay Likeness (the Scribe's, a thumbprint on one cheek) and the Slate Double (the Artificer's,
 * which clicks): every key to a step of one ramp, keeping ink as ink and light as light, so the shape
 * reads and the likeness is plainly not the person. Maps { key: key } for recolor().
 */
const LIKENESS = freeze({
  clay: freeze({ c: 'r', C: 'r', t: 'r', n: 'r', p: 'r', h: 'r', j: 'r', w: 'r', f: 'r', s: 'r', u: 'r', k: 'R', K: 'Q', r: 'R', U: 'R', b: 'R', q: 'R', l: 'R', g: 'R', W: 'R', S: 'R', v: 'R', e: 'R', E: 'Q', R: 'Q', Q: 'Q', Y: 'Q', B: 'Q', m: 'Q', L: 'Q', M: 'Q', G: 'Q', P: 'R', z: 'Q', N: 'Q', V: 'Q', x: 'x', o: 'o' }),
  slate: freeze({ c: 'e', C: 'e', t: 'e', n: 'e', p: 'e', h: 'e', j: 'e', w: 'e', f: 'e', s: 'e', u: 'e', k: 'E', K: 'N', e: 'E', r: 'E', U: 'E', b: 'E', q: 'E', l: 'E', g: 'E', W: 'E', S: 'E', v: 'E', R: 'N', E: 'N', Q: 'N', Y: 'N', B: 'N', m: 'N', L: 'N', M: 'N', G: 'N', P: 'E', z: 'N', N: 'N', V: 'N', x: 'x', o: 'o' }),
});
export function likenessTable(kind) {
  return LIKENESS[kind] || null;
}

/** The face's own keys (cream, its shade and the cheek's blush), where a thumbprint may go. */
const FACE = 'cCk';
const NEAREST = [[0, 0], [0, 1], [0, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [-1, -1], [1, -1]];
function thumbPoint(rows, at) {
  if (!at) return null;
  for (const [dx, dy] of NEAREST) {
    const x = at[0] + dx;
    const y = at[1] + dy;
    if (FACE.includes(rows[y]?.[x] ?? '.')) return [x, y];
  }
  return null;
}

// ---------- the frame pipeline ----------

const blankRows = (w, h) => Array.from({ length: h }, () => '.'.repeat(w));
const maskOf = (w, h, ch) => Array.from({ length: h }, () => ch.repeat(w));

/** Anchors a Frame always carries, and their order. */
const ANCHORS = freeze(['head', 'handL', 'handR', 'back']);

/** A rig's pose for a person: their own variant ('codex:ready') where the rig draws one, else the shared one. */
function poseFor(data, who, poseId) {
  return data.poses[`${who}:${poseId}`] || data.poses[poseId] || null;
}

function place(rigId, data, poseId, who) {
  const rig = RIGS[rigId];
  const pose = poseFor(data, who, poseId);
  if (!pose) throw new Error(`No ${rigId} pose ${poseId}`);
  const [fw, fh] = rig.frame;
  const [ox, oy] = rig.origin;
  const [ax, ay] = pose.at || [0, 0];
  const x0 = ox + ax;
  const y0 = oy + ay;
  // Placeholder keys (a rig's own, such as the robe's body tones or a held prop's glass) are held
  // until the look is known; everything else is a palette key already. A rig's `propKeys` mark what
  // the person holds, which the wear mask keeps undressed, and so do a pose's held `items` (the
  // Scribe's quill, the Artificer's wrench), stamped over the body at a grid point.
  let rows = stamp(blankRows(fw, fh), pose.rows, x0, y0);
  let prop = maskOf(fw, fh, '.');
  const propKeys = data.propKeys || '';
  if (propKeys) prop = stamp(prop, pose.rows.map((row) => [...row].map((ch) => (propKeys.includes(ch) ? '1' : '.')).join('')), x0, y0);
  for (const item of pose.items || []) {
    const art = data.items?.[who]?.[item.id];
    if (!art) continue;
    const [ix, iy] = item.at;
    rows = stamp(rows, art, x0 + ix, y0 + iy);
    prop = stamp(prop, art.map((row) => row.replace(/[^.]/g, '1')), x0 + ix, y0 + iy);
  }
  const anchors = {};
  for (const name of ANCHORS) {
    const at = pose.anchors?.[name] || pose.anchors?.handR || [rig.w >> 1, 0];
    anchors[name] = [at[0] + x0, at[1] + y0];
  }
  // The Clay Likeness's thumbprint point rides with the anchors, so a lift or a lean carries it.
  if (pose.thumb) anchors.thumb = [pose.thumb[0] + x0, pose.thumb[1] + y0];
  const split = Number.isFinite(pose.split) ? pose.split + y0 : (rig.split ?? null);
  // The breath row: a pose's own (in its grid's rows, like `split`), else the coat's head split, else
  // the rig's standing one (in frame rows).
  const neck = Number.isFinite(pose.neck) ? pose.neck + y0 : split ?? (Number.isFinite(data.neck) ? data.neck : null);
  return { rows, prop, anchors, split, neck };
}

/**
 * The rig pose operations, each on rows, the prop mask, the anchors, the split and the neck together:
 *   { op: 'breathe', row }        rows above `row` (the neck by default) sink 1, as sprites.breathe
 *   { op: 'shift', dx, top, bottom }   a band slides sideways (a lean)
 *   { op: 'lift', dy }            the whole frame moves up (−) or down
 *   { op: 'nudge', dx }           the whole frame slides sideways (a knockback)
 *   { op: 'squash', row, n }      rows above `row` (the neck by default) sink n, 2 by default (a crouch before a jump)
 *   { op: 'overlay', id, at }     stamp a rig overlay (a spark of light, a 'z') at a frame point, behind the body
 * `tone` recolours an overlay's art first (poseOps, on a frame already in its look's colours).
 */
function applyOp(state, op, data, fw, fh, tone = null) {
  let { rows, prop, anchors, split, neck } = state;
  const move = (test, dx, dy) => {
    const out = {};
    for (const [k, [x, y]] of Object.entries(anchors)) out[k] = test(x, y) ? [x + dx, y + dy] : [x, y];
    return out;
  };
  switch (op.op) {
    case 'breathe':
    case 'squash': {
      const row = Number.isFinite(op.row) ? op.row : Number.isFinite(neck) ? neck : Number.isFinite(split) ? split : Math.floor(fh / 2);
      const times = op.op === 'squash' ? (op.n || 2) : 1;
      for (let i = 0; i < times; i += 1) { rows = breathe(rows, row); prop = breathe(prop, row); }
      anchors = move((x, y) => y < row, 0, times);
      break;
    }
    case 'shift': {
      const top = op.top ?? 0;
      const bottom = op.bottom ?? fh;
      rows = shiftRows(rows, op.dx, top, bottom);
      prop = shiftRows(prop, op.dx, top, bottom);
      anchors = move((x, y) => y >= top && y < bottom, op.dx, 0);
      break;
    }
    case 'nudge': {
      rows = shiftRows(rows, op.dx);
      prop = shiftRows(prop, op.dx);
      anchors = move(() => true, op.dx, 0);
      break;
    }
    case 'lift': {
      const dy = op.dy || 0;
      const vshift = (list, fill) => list.map((_, y) => list[y - dy] ?? fill.repeat(fw));
      rows = vshift(rows, '.');
      prop = vshift(prop, '.');
      anchors = move(() => true, 0, dy);
      if (split != null) split += dy;
      if (neck != null) neck += dy;
      break;
    }
    case 'overlay': {
      const raw = data?.overlays?.[op.id];
      if (!raw) break;
      const art = tone ? tone(raw) : raw;
      const [x, y] = op.at || [0, 0];
      // Behind: only onto clear pixels, so it never covers the body.
      const under = rows.map((row, ry) => [...row].map((ch, rx) => {
        const py = ry - y;
        const px = rx - x;
        const k = art[py]?.[px];
        return ch === '.' && k && k !== '.' ? k : ch;
      }).join(''));
      prop = prop.map((row, ry) => [...row].map((ch, rx) => (rows[ry][rx] === '.' && under[ry][rx] !== '.' ? '1' : ch)).join(''));
      rows = under;
      break;
    }
    default:
      break;
  }
  return { rows, prop, anchors, split, neck };
}

/** A rig's placeholders to palette keys for this person, then a likeness recolour (none for null). */
function toneRows(rows, rigId, who, likeness) {
  const data = DATA[rigId];
  let out = rows;
  const keys = data.looks?.[who] || data.looks?.[data.defaultWho] || null;
  if (keys) out = recolor(out, keys);
  if (data.placeholders) out = recolor(out, data.placeholders);
  const table = likeness ? LIKENESS[likeness] : null;
  return table ? recolor(out, table) : out;
}

const LOOK_CACHE = new Map();
/** The frozen look a Frame carries: one object per rig, person and likeness. */
function lookOf(rigId, who, likeness) {
  const key = `${rigId}|${who}|${likeness || ''}`;
  let look = LOOK_CACHE.get(key);
  if (!look) {
    look = freeze({ kind: 'rig', rig: rigId, who, likeness: likeness || null });
    LOOK_CACHE.set(key, look);
  }
  return look;
}

/**
 * A dressed frame's wear mask: '1' where clothes may be, '.' where they never are. Built from the
 * figure itself, after every op, so it follows any pose:
 *   - what the person holds ('1' in `prop`: Milo's lantern, the Scribe's quill, a doze's 'z') is '.';
 *   - so is anything apart from the body (the largest 8-connected group of the drawn pixels that
 *     aren't held);
 *   - so is a loose speck in the clothes' own keys (`clothes`): a patch of at most SPECK pixels that
 *     touches nothing but ink, air and what's held, as a speck of lantern light in the coat's butter
 *     does beside the lantern's outline. A raised sleeve, a flung scarf or a lap beside the lantern
 *     touches the hand, the face or the boots, so it's worn;
 *   - and above the neck (a rig whose poses have one: the coat's), everything that isn't a clothes
 *     key is '.': a raised sleeve is dressed, and his hair's wood shine is never taken for the coat's
 *     wood trim.
 * Clear pixels are '1' (nothing to dress there). null when nothing is kept undressed: outfitGrid's
 * plain call does the same. `prop` is rows of '1' on what's held (a Frame's `held`), `neck` the head's
 * lowest row or null, `clothes` the clothes' keys ('' for none). Exported for the tests, and for
 * anim.js should it build a frame of its own.
 */
const SPECK = 4; // the most pixels a loose speck of light has
export function wearMask(rows, prop, neck = null, clothes = '') {
  prop = prop || [];
  clothes = clothes || '';
  const h = rows.length;
  const w = rows[0].length;
  const held = (x, y) => prop[y]?.[x] === '1';
  const drawn = (x, y) => rows[y]?.[x] !== undefined && rows[y][x] !== '.' && !held(x, y);
  const inBody = largestGroup(w, h, drawn);
  const cloth = (x, y) => drawn(x, y) && clothes.includes(rows[y][x]);
  const loose = new Set();
  const seen = new Set();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (seen.has(y * w + x) || !cloth(x, y)) continue;
      const patch = [];
      const stack = [[x, y]];
      seen.add(y * w + x);
      let touches = false;
      while (stack.length) {
        const [px, py] = stack.pop();
        patch.push(py * w + px);
        for (const [nx, ny] of around(px, py)) {
          if (cloth(nx, ny)) {
            if (!seen.has(ny * w + nx)) { seen.add(ny * w + nx); stack.push([nx, ny]); }
          } else if (drawn(nx, ny) && rows[ny][nx] !== 'o') touches = true;
        }
      }
      if (!touches && patch.length <= SPECK) for (const i of patch) loose.add(i);
    }
  }
  let open = true;
  const mask = rows.map((row, y) => [...row].map((ch, x) => {
    if (ch === '.') return '1';
    // (What's held is never part of the body, so !inBody covers it too.)
    const off = !inBody(x, y) || loose.has(y * w + x) || (clothes && Number.isFinite(neck) && y < neck && !clothes.includes(ch));
    if (off) open = false;
    return off ? '.' : '1';
  }).join(''));
  return open ? null : freeze(mask);
}

/** The eight neighbours of a pixel. */
function around(x, y) {
  return [[x - 1, y - 1], [x, y - 1], [x + 1, y - 1], [x - 1, y], [x + 1, y], [x - 1, y + 1], [x, y + 1], [x + 1, y + 1]];
}

/** The largest 8-connected group of the pixels `open` accepts, as (x, y) → boolean. */
function largestGroup(w, h, open) {
  const group = Array.from({ length: h }, () => new Int32Array(w));
  let best = -1;
  let most = 0;
  let id = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (group[y][x] || !open(x, y)) continue;
      id += 1;
      let size = 0;
      const stack = [[x, y]];
      group[y][x] = id;
      while (stack.length) {
        const [px, py] = stack.pop();
        size += 1;
        for (const [nx, ny] of around(px, py)) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || group[ny][nx] || !open(nx, ny)) continue;
          group[ny][nx] = id;
          stack.push([nx, ny]);
        }
      }
      if (size > most) { most = size; best = id; }
    }
  }
  return (x, y) => group[y]?.[x] === best;
}

// A frame recipe: 'poseId' or [poseId, ...ops].
function recipeOf(entry) {
  return Array.isArray(entry) ? { pose: entry[0], ops: entry.slice(1) } : { pose: entry, ops: [] };
}

const BUILT = new Map(); // rig|who|likeness|pose|ops → frozen right-facing Frame
const MIRRORED = new WeakMap(); // Frame → its left-facing twin

function buildFrame(rigId, who, likeness, entry) {
  const { pose, ops } = recipeOf(entry);
  const key = `${rigId}|${who}|${likeness || ''}|${pose}|${JSON.stringify(ops)}`;
  const known = BUILT.get(key);
  if (known) return known;
  const rig = RIGS[rigId];
  const data = DATA[rigId];
  const [fw, fh] = rig.frame;
  let state = place(rigId, data, pose, who);
  for (const op of ops) state = applyOp(state, op, data, fw, fh);
  // The look: a rig's placeholders to palette keys for this person, then a likeness recolour.
  let rows = toneRows(state.rows, rigId, who, null);
  const table = likeness ? LIKENESS[likeness] : null;
  if (table) {
    // The Clay Likeness's thumbprint: one deep clay pixel on the cheek (a pose's `thumb` grid point,
    // carried through the clip's ops like an anchor), and only ever on the face, never in the air or
    // on ink: where a breathe has sunk the eye row onto its point, it takes the nearest face pixel.
    const thumb = likeness === 'clay' ? thumbPoint(rows, state.anchors.thumb) : null;
    rows = recolor(rows, table);
    if (thumb) rows = stamp(rows, ['Q'], thumb[0], thumb[1]);
  }
  const family = table ? null : (data.family === 'who' ? FAMILY[who] || null : data.family || null);
  const clothes = (family && data.clothes?.[family]) || '';
  // The head the wear mask keeps (the coat's, below its split row); the robe's hood is robe.
  const head = clothes && Number.isFinite(state.split) ? state.split : null;
  const wear = family ? wearMask(rows, state.prop, head, clothes) : null;
  const frame = freeze({
    rows: freeze(rows.slice()),
    layers: null,
    wear,
    held: state.prop.some((row) => row.includes('1')) ? freeze(state.prop.slice()) : null,
    // A frame whose mask keeps the head (the coat's) lets the clothes start at the top row: a raised
    // sleeve is dressed, and the mask keeps the head his own.
    split: head !== null ? 0 : null,
    neck: Number.isFinite(state.neck) ? state.neck : null,
    anchors: freeze(Object.fromEntries(ANCHORS.map((name) => [name, freeze(state.anchors[name].slice())]))),
    feet: rig.feet,
    w: fw,
    h: fh,
    mirror: false,
    family,
    look: lookOf(rigId, who, likeness),
  });
  BUILT.set(key, frame);
  return frame;
}

/**
 * The same frame facing left: the same rows, mirrored at paint time, with its anchors mirrored
 * (x → w − 1 − x). Its feet stay the rig's: every body sits centred in its frame, so a mirrored frame
 * drawn at (x − feet[0], y − feet[1]) keeps the body on the same columns.
 */
function mirrored(frame) {
  let twin = MIRRORED.get(frame);
  if (!twin) {
    twin = freeze({ ...frame, anchors: flipAnchors(frame.anchors, frame.w), mirror: true });
    MIRRORED.set(frame, twin);
    UNMIRRORED.set(twin, frame);
  }
  return twin;
}
const UNMIRRORED = new WeakMap(); // a left-facing twin → the Frame it mirrors

/** Anchors across the frame's middle column (x → w − 1 − x), frozen. */
function flipAnchors(anchors, w) {
  return freeze(Object.fromEntries(Object.entries(anchors).map(([k, [x, y]]) => [k, freeze([w - 1 - x, y])])));
}

function rigOf(look) {
  if (!look || look.kind !== 'rig' || !DATA[look.rig]) return null;
  return look.rig;
}

function whoOf(rigId, look) {
  const data = DATA[rigId];
  return data.looks && data.looks[look.who] ? look.who : data.defaultWho;
}

const CLIP_CACHE = new Map();

/**
 * A look's frames for a clip, facing 'right', 'left' (the right frames with mirror: true) or 'down'
 * (a front view where the rig has one, else the right frames). Frozen and memoised: the same call
 * always returns the same array of the same Frame objects. An unknown clip or a look that isn't a
 * rig gives an empty array (strays play anims.json poses through composeStray instead).
 */
export function clipFrames(look, clip, facing = 'right') {
  const rigId = rigOf(look);
  if (!rigId || !CLIP_TIMING[clip]) return EMPTY;
  const data = DATA[rigId];
  const who = whoOf(rigId, look);
  const likeness = look.likeness && LIKENESS[look.likeness] ? look.likeness : null;
  const face = facing === 'left' || facing === 'down' ? facing : 'right';
  const key = `${rigId}|${who}|${likeness || ''}|${clip}|${face}`;
  const known = CLIP_CACHE.get(key);
  if (known) return known;
  const recipes = data.clips[clip];
  if (!recipes) {
    CLIP_CACHE.set(key, EMPTY);
    return EMPTY;
  }
  const list = (face === 'down' ? recipes.front || recipes.side : recipes.side || recipes.front) || [];
  let frames = list.map((entry) => buildFrame(rigId, who, likeness, entry));
  if (face === 'left') frames = frames.map(mirrored);
  const out = freeze(frames);
  CLIP_CACHE.set(key, out);
  return out;
}
const EMPTY = freeze([]);

/** The clip a look plays for an ability of its own (Milo's Scarf and so on), or null to play 'cast'. */
export function signatureClip(look, abilityId) {
  const clip = SIGNATURE_CLIPS[abilityId];
  const rigId = rigOf(look);
  if (!clip || !rigId || !DATA[rigId].clips[clip]) return null;
  return clip;
}

/** Every clip a look has frames for: CLIPS, then its signature clips. */
export function clipsOf(look) {
  const rigId = rigOf(look);
  if (!rigId) return EMPTY;
  return freeze([...CLIPS, ...EXTRA_CLIPS.filter((c) => DATA[rigId].clips[c])]);
}

// ---------- exploration frames ----------

const EXPLORE_CACHE = new Map();

/**
 * Frames at exploration size for walking the world ('down', 'up', 'left', 'right'): [stand, stride,
 * stride] like SPRITES' milo.<dir>. The Tollkeeper has his own 20 × 26 frames (at the bridge and as a
 * follower); the robed Wayfarers walk on the robe rig's exploration frames; anyone else (and a look
 * the rigs don't know) falls back to the crew's standing frames. Each Frame's feet are its middle
 * column on the stand frame's lowest drawn row: the bottom middle, as the engine draws the crew
 * (x − w/2, y − h + 1), for everyone but Jev, whose feet are one row above his sprite's clear last row.
 */
export function exploreFrames(look, dir = 'down') {
  const rigId = rigOf(look) || 'robe';
  const data = DATA[rigId];
  const who = whoOf(rigId, look || {});
  const d = ['down', 'up', 'left', 'right'].includes(dir) ? dir : 'down';
  const likeness = look?.likeness && LIKENESS[look.likeness] ? look.likeness : null;
  const key = `${rigId}|${who}|${likeness || ''}|${d}`;
  const known = EXPLORE_CACHE.get(key);
  if (known) return known;
  const explore = data.explore?.[who] || (data.explore?.down ? data.explore : null);
  let out = EMPTY;
  if (explore) {
    const side = d === 'left' ? 'right' : d;
    const list = explore[side] || explore.down;
    const keys = data.looks?.[who] || null;
    const table = likeness ? LIKENESS[likeness] : null;
    const family = table ? null : (data.family === 'who' ? FAMILY[who] || null : data.family || null);
    // The feet row is the stand frame's lowest drawn row: the bottom row for everyone but Jev, whose
    // perched sprite keeps a clear row under his feet (Phase 3 perches him on it).
    let ground = list[0].length - 1;
    while (ground > 0 && !/[^.]/.test(list[0][ground])) ground -= 1;
    out = freeze(list.map((rows0) => {
      let rows = keys ? recolor(rows0, keys) : rows0;
      if (data.placeholders) rows = recolor(rows, data.placeholders);
      if (table) rows = recolor(rows, table);
      if (d === 'left') rows = mirrorRows(rows);
      const w = rows[0].length;
      const h = rows.length;
      const frame = freeze({
        rows: freeze(rows.slice()), layers: null, wear: null, held: null, split: null, neck: null,
        anchors: freeze({ head: freeze([w >> 1, 1]), handL: freeze([1, h >> 1]), handR: freeze([w - 2, h >> 1]), back: freeze([w >> 1, h >> 1]) }),
        feet: freeze([w >> 1, ground]), w, h, mirror: false, family, look: lookOf(rigId, who, likeness),
      });
      return frame;
    }));
  }
  EXPLORE_CACHE.set(key, out);
  return out;
}

// ---------- checks the tests share ----------

/** Every palette key in a frame's rows is a real PALETTE key (or '.'). */
export function paletteOnly(rows) {
  return rows.every((row) => [...row].every((ch) => ch === '.' || PALETTE[ch]));
}

/** Each rig's hand-drawn key poses, by rig: { coat: n, robe: n, … } (the capture sheet and the report count them). */
export function handPoseCounts() {
  return freeze(Object.fromEntries(Object.entries(DATA).map(([id, data]) => [id, Object.keys(data.poses).length + Object.keys(data.overlays || {}).length])));
}

/** For tests and the capture script: the raw rig data. */
export const RIG_DATA = DATA;

const POSED = new WeakMap(); // Frame → Map(op → Frame)
const POSED_MAX = 64; // derived frames kept per Frame (the oldest goes first)
/** '1' ↔ '.': a wear mask ('1' may be dressed) as a prop mask ('1' kept undressed), and back. */
const invertMask = (row) => row.replace(/1/g, 'W').replace(/\./g, '1').replace(/W/g, '.');

/**
 * Run one rig pose operation (applyOp's list: breathe, squash, shift, nudge, lift, overlay) on a
 * built Frame, for anim.js's derived frames: a frozen Frame, memoised per frame and op, so the same
 * call gives the same object and the painter's cache hits.
 *   - The rows, the wear mask, what's held and the anchors move together, and the neck moves with a
 *     lift. `split` stays as it is (Milo's is 0: his mask carries the head and moves with the pixels).
 *   - breathe and squash bend at the frame's `neck` when the op names no row.
 *   - An op works in the figure's own facing, as the clips' recipes do: dx > 0 is forward, toward
 *     where it faces, and `at` and `top`/`bottom` are points of the frame's rows (a 'left' frame's
 *     are the right-facing rows it mirrors). So on a 'left' frame (mirror: true) the op runs on the
 *     right-facing frame it mirrors and the result is mirrored back: the drawn pixels and the anchors
 *     move the same way on screen, and a knockback is a negative dx whichever way the figure faces.
 *     A frame drawn unmirrored ('right', 'down', and exploreFrames, whose 'left' rows are already
 *     flipped) takes dx in screen columns.
 *   - overlay { id, at } draws the frame's rig's overlay ('z', 'blink') behind the body, in the
 *     frame's colours (its `look`); it's held, so never dressed. An unknown id changes nothing. On a
 *     'left' frame it's mirrored with the rest, as a clip's own overlays are (left = right with
 *     mirror: true), so a 'z' reads backwards there.
 */
export function poseOps(frame, op) {
  if (!frame || !op) return frame;
  const key = JSON.stringify(op);
  let memo = POSED.get(frame);
  const known = memo?.get(key);
  if (known) return known;
  const out = frame.mirror ? mirrored(poseOps(unmirrored(frame), op)) : poseRight(frame, op);
  if (!memo) {
    memo = new Map();
    POSED.set(frame, memo);
  }
  if (memo.size >= POSED_MAX) memo.delete(memo.keys().next().value);
  memo.set(key, out);
  return out;
}

/** The right-facing Frame a left-facing one mirrors (its rows are the same; its anchors flip back). */
function unmirrored(frame) {
  let right = UNMIRRORED.get(frame);
  if (!right) {
    right = freeze({ ...frame, anchors: flipAnchors(frame.anchors, frame.w), mirror: false });
    UNMIRRORED.set(frame, right);
    MIRRORED.set(right, frame);
  }
  return right;
}

function poseRight(frame, op) {
  const { w, h } = frame;
  const blank = maskOf(w, h, '.');
  const look = frame.look && DATA[frame.look.rig] ? frame.look : null;
  const data = look ? DATA[look.rig] : null;
  const tone = look ? (rows) => toneRows(rows, look.rig, look.who, look.likeness) : null;
  const neck = Number.isFinite(frame.neck) ? frame.neck : null;
  const state = { rows: frame.rows, prop: frame.wear ? frame.wear.map(invertMask) : blank, anchors: { ...frame.anchors }, split: null, neck };
  const next = applyOp(state, op, data, w, h, tone);
  let held;
  if (op.op === 'overlay') {
    // What an overlay draws is held, as in a clip's own overlaid frames.
    const was = frame.held || blank;
    held = next.rows.map((row, y) => [...row].map((ch, x) => (was[y][x] === '1' || ch !== frame.rows[y][x] ? '1' : '.')).join(''));
  } else {
    held = frame.held ? applyOp({ rows: frame.held, prop: blank, anchors: {}, split: null, neck }, op, null, w, h).rows : null;
  }
  const wear = frame.family ? next.prop.map(invertMask) : null;
  return freeze({
    ...frame,
    rows: freeze(next.rows.slice()),
    wear: wear && wear.some((row) => row.includes('.')) ? freeze(wear) : null,
    held: held && held.some((row) => row.includes('1')) ? freeze(held.slice()) : null,
    anchors: freeze(Object.fromEntries(Object.entries(next.anchors).map(([k, v]) => [k, freeze(v.slice())]))),
    neck: next.neck,
    mirror: false,
  });
}
