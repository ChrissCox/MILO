// Procedural strays (RIFTS.md §10): a body archetype plus genre parts, composed on a 20x20
// grid of palette keys. Genre palettes (src/world/genres.js) colour them, and in a fusion the
// parts can come from a second genre, so the mix shows in the creature itself. Pure data.

// Placeholders in archetype grids: O outline, B body, b body shade, H highlight, X eye.
export const ARCHETYPES = {
  floater: {
    grid: [
      '................', '................', '.....OOOOOO.....', '....OBBBBBBO....', '...OBHHBBBBBO...', '...OBHBBBBBBO...',
      '..OBBXBBBBXBBO..', '..OBBXBBBBXBBO..', '..OBBBBBBBBBBO..', '...OBBBbbBBBO...', '...ObBBBBBBbO...', '....ObbbbbbO....',
      '.....OOOOOO.....', '................', '......b..b......', '................',
    ],
    anchors: { headTop: [8, 2], face: [8, 6], body: [8, 9], tail: [8, 12], left: [2, 7], right: [13, 7] },
  },
  walker: {
    grid: [
      '................', '......OOOO......', '.....OBBBBO.....', '....OBHBBBBO....', '....OBXBBXBO....', '....OBBBBBBO....',
      '.....ObbbbO.....', '....OOBBBBOO....', '...OBBBBBBBBO...', '...OBHBBBBBBO...', '...OBBBBBBBbO...', '....OBBBBBbO....',
      '....OBbOObBO....', '.....OO..OO.....', '.....Ob..bO.....', '.....OO..OO.....',
    ],
    anchors: { headTop: [8, 1], face: [8, 4], body: [8, 9], tail: [8, 12], left: [3, 9], right: [12, 9] },
  },
  crawler: {
    grid: [
      '................', '................', '................', '................', '................', '......OOOOOOO...',
      '.....OBBBBBBBO..', '....OBHBBBBBXBO.', '...OBBBBBBBBBBBO', '...ObBBBBBBBBBbO', '....ObbbbbbbbbO.', '....OBO.OBO.OBO.',
      '....OO..OO..OO..', '................', '................', '................',
    ],
    anchors: { headTop: [12, 5], face: [12, 7], body: [9, 9], tail: [3, 8], left: [5, 6], right: [14, 9] },
  },
  flier: {
    grid: [
      '................', '................', 'O..............O', 'OO....OOOO....OO', 'OBO..OBBBBO..OBO', 'OBBO.OXBBXO.OBBO',
      'OBBBOOBBBBOOBBBO', '.OBBBBBBBBBBBBO.', '..OBBBObbOBBBO..', '...OO.OBBO.OO...', '......OBBO......', '.......OO.......',
      '................', '................', '................', '................',
    ],
    anchors: { headTop: [8, 3], face: [8, 5], body: [8, 8], tail: [8, 11], left: [1, 5], right: [14, 5] },
  },
  ghost: {
    grid: [
      '................', '.....OOOOOO.....', '....OHHBBBBO....', '...OHBBBBBBBO...', '...OBBBBBBBBO...', '...OBXXBBXXBO...',
      '...OBXXBBXXBO...', '...OBBBBBBBBO...', '...OBBBbbBBBO...', '...OBBBBBBBBO...', '...OBbBBbBBbO...', '...ObObbObbOO...',
      '...OO.OO.OO.....', '................', '................', '................',
    ],
    anchors: { headTop: [8, 1], face: [8, 5], body: [8, 8], tail: [8, 12], left: [3, 7], right: [12, 7] },
    eye: 'o',
  },
  construct: {
    grid: [
      '................', '....OOOOOOOO....', '....OBBBBBBO....', '....OBXBBXBO....', '....OBBBBBBO....', '....OOOOOOOO....',
      '...OBBBBBBBBO...', '..OBBHBBBBBBBO..', '..OBBBBBBBBBBO..', '..OBBBBBBBBbBO..', '..OOOOOOOOOOOO..', '....ObO..ObO....',
      '....OOO..OOO....', '................', '................', '................',
    ],
    anchors: { headTop: [8, 1], face: [8, 3], body: [8, 8], tail: [8, 10], left: [2, 8], right: [13, 8] },
  },
};

// Genre parts. Grids use palette keys directly; [ox, oy] offsets the grid's top-left from its
// anchor. `behind` parts are drawn before the body; `pair` parts are mirrored on left and right.
export const PARTS = {
  // Neon
  visor: { anchor: 'face', at: [-3, 0], grid: ['euuuue'] },
  antenna: { anchor: 'headTop', at: [-1, -3], grid: ['.u.', '.o.', '.o.'] },
  cableTail: { anchor: 'tail', at: [0, 0], grid: ['e..', '.e.', '..eu'] },
  neonTrim: { anchor: 'body', at: [-3, 0], grid: ['uuuuuu'] },
  // Nocturne
  batEars: { anchor: 'headTop', at: [-4, -1], grid: ['o......o', 'oV....Vo'] },
  batWings: { anchor: 'left', at: [-3, -1], grid: ['k..', 'kk.', 'kkk', '.kk'], pair: true, behind: true },
  sleepyEyes: { anchor: 'face', at: [-3, 0], grid: ['oo..oo'] },
  moonCharm: { anchor: 'body', at: [0, -1], grid: ['.u', 'u.', '.u'] },
  // Gothic
  candle: { anchor: 'headTop', at: [-1, -4], grid: ['.u.', 'uUu', '.c.', '.c.'] },
  hollowEyes: { anchor: 'face', at: [-3, 0], grid: ['oo..oo', 'oo..oo'] },
  ribbonCollar: { anchor: 'body', at: [-2, -1], grid: ['rr.rr', '.rRr.', 'rr.rr'] },
  ravenFeather: { anchor: 'right', at: [0, -1], grid: ['o.', 'oo', '.o'] },
  // Iron
  rivets: { anchor: 'body', at: [-2, 0], grid: ['S.S.S'] },
  smokestack: { anchor: 'headTop', at: [-1, -4], grid: ['.CC', 'C..', 'SS.', 'SS.'] },
  gear: { anchor: 'left', at: [-2, -1], grid: ['.S.', 'SzS', '.S.'] },
  goggles: { anchor: 'face', at: [-3, 0], grid: ['UU..UU', 'UU..UU'] },
  // Void
  extraEyes: { anchor: 'body', at: [-1, -1], grid: ['U.U', '...', '.U.'] },
  tentacles: { anchor: 'tail', at: [-2, 0], grid: ['v.v.v', 'v.v.v', '.v.v.'] },
  starHalo: { anchor: 'headTop', at: [-2, -3], grid: ['k.k.k', '.k.k.'] },
  thirdEye: { anchor: 'face', at: [0, -2], grid: ['U'] },
  // Noir
  fedora: { anchor: 'headTop', at: [-3, -2], grid: ['.oooo.', 'oooooo'] },
  redScarf: { anchor: 'body', at: [-2, -2], grid: ['rrrrr', '...r.'] },
  magnifier: { anchor: 'right', at: [0, -2], grid: ['SS.', 'S.S', 'SS.', '..o'] },
  notepad: { anchor: 'left', at: [-1, 0], grid: ['cc', 'cc'] },
  // Frontier
  cowboyHat: { anchor: 'headTop', at: [-3, -3], grid: ['..bb..', '.bbbb.', 'bbbbbb'] },
  bandana: { anchor: 'face', at: [-3, 1], grid: ['RRRRRR', '.RRRR.'] },
  starBadge: { anchor: 'body', at: [-1, -1], grid: ['.u.', 'uuu', '.u.'] },
  lasso: { anchor: 'right', at: [0, -1], grid: ['.nn', 'n.n', '.nn', 'n..'] },
  // Titan
  hazardStripes: { anchor: 'body', at: [-2, 0], grid: ['uouou'] },
  horn: { anchor: 'headTop', at: [-2, -2], grid: ['S..S', 'S..S'] },
  jetFlame: { anchor: 'tail', at: [0, 1], grid: ['u', 'U', 'u'] },
  armorPlate: { anchor: 'body', at: [-1, -1], grid: ['SSS', 'SzS'] },
  // Verdant
  leafCrown: { anchor: 'headTop', at: [-2, -2], grid: ['l.l.l', 'lllll'] },
  flower: { anchor: 'right', at: [0, -2], grid: ['.k.', 'kuk', '.k.', '.l.'] },
  solarPanel: { anchor: 'left', at: [-2, -1], grid: ['eE', 'Ee', 'eE'] },
  vineTail: { anchor: 'tail', at: [0, 0], grid: ['l.', '.l', 'l.'] },
  // Starlight
  bow: { anchor: 'headTop', at: [-2, -2], grid: ['kk.kk', '.kKk.'] },
  starWand: { anchor: 'right', at: [0, -3], grid: ['.u.', 'uuu', '.u.', '..n', '..n'] },
  sparkleEyes: { anchor: 'face', at: [-3, 0], grid: ['c....c'] },
  ribbonTail: { anchor: 'tail', at: [0, 0], grid: ['k..', '.k.', '..k'] },
  // Summit
  topknot: { anchor: 'headTop', at: [-1, -2], grid: ['.m.', 'mmm'] },
  jadePendant: { anchor: 'body', at: [0, -1], grid: ['o', 'l'] },
  cloudSash: { anchor: 'body', at: [-3, 1], grid: ['cccccc'] },
  fan: { anchor: 'right', at: [0, -1], grid: ['rrr', '.r.', '.b.'] },
  // Backhalls
  badge: { anchor: 'body', at: [-1, -1], grid: ['cc', 'oo'] },
  mop: { anchor: 'right', at: [0, -2], grid: ['b.', 'b.', 'b.', 'ccc'] },
  fluorescentHalo: { anchor: 'headTop', at: [-2, -2], grid: ['cccc'] },
  keyring: { anchor: 'left', at: [-1, 0], grid: ['uu', 'u.u'] },
};

// Each body colour's darker shade, following the world palette's own pairs.
const SHADE = { r: 'R', R: 'Q', e: 'E', E: 'N', v: 'V', V: 'E', k: 'K', K: 'R', s: 'S', S: 'z', c: 'C', C: 'P', b: 'B', B: 'm', n: 'b', u: 'U', U: 'Y', l: 'L', L: 'M', g: 'G', G: 'L', w: 'W', t: 'C' };

export const SIZE = 20;
const MARGIN_X = 2;
const MARGIN_Y = 4;

/**
 * Compose a stray. parts: [{ id, layer }] where layer 0 is the base genre and 1 the second genre
 * of a fusion. Returns { rows, layers } of SIZE strings each: palette keys ('.' clear) and, per
 * pixel, which genre's palette colours it ('0' or '1').
 *
 * Fight frames (CONTRACT-PHASE4.md §7.8, COMBAT.md §14.3): `size` 28 gives a lunge or a raised part
 * room (margins 6 and 8, so pad(composeStray(x), 4) is the size-28 rest pose), and `pose` is a pose
 * object from content/combat/anims.json (its key in `poseName`, `frame` the frame index, which wraps
 * round the pose's length, so a running counter is fine). With no
 * pose at size 20 the output is exactly Phase 3's, built fresh each call; anything else is built once
 * per stray, pose, frame and size (an LRU of 2,048) and comes back frozen.
 */
export function composeStray({ archetype, bodyKey = 'r', parts = [], eyeKey = null, pose = null, poseName = null, frame = 0, size = SIZE }) {
  if (!pose && size === SIZE) return composeRest({ archetype, bodyKey, parts, eyeKey });
  // The frame index wraps round the pose's frames before it keys the memo, so a loop driven by a
  // running counter (frame 8 of an 8-frame idle is frame 0) finds the same frozen object.
  const frames = pose && Array.isArray(pose.frames) ? pose.frames : [];
  const index = frames.length ? ((Math.floor(Number(frame) || 0) % frames.length) + frames.length) % frames.length : 0;
  const key = memoKey({ archetype, bodyKey, parts, eyeKey, pose, poseName, frame: index, size });
  const known = MEMO.get(key);
  if (known) {
    MEMO.delete(key);
    MEMO.set(key, known);
    return known;
  }
  const spec = frames.length ? frames[index] : null;
  const made = composePosed({ archetype, bodyKey, parts, eyeKey, spec, size: validSize(size) });
  MEMO.set(key, made);
  if (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
  return made;
}

// Phase 3's composer, kept byte for byte: riftgen stores its output in every rift spec.
function composeRest({ archetype, bodyKey = 'r', parts = [], eyeKey = null }) {
  const arch = ARCHETYPES[archetype] || ARCHETYPES.floater;
  const keys = Array.from({ length: SIZE }, () => Array(SIZE).fill('.'));
  const layers = Array.from({ length: SIZE }, () => Array(SIZE).fill('0'));
  const shade = SHADE[bodyKey] || bodyKey;
  const eye = eyeKey || arch.eye || 'u';
  const put = (x, y, key, layer) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || key === '.') return;
    keys[y][x] = key;
    layers[y][x] = String(layer);
  };
  const stampPart = ({ id, layer = 0 }, mirrored = false) => {
    const part = PARTS[id];
    if (!part) return;
    const [ax, ay] = arch.anchors[mirrored ? 'right' : part.anchor] || arch.anchors.body;
    part.grid.forEach((row, gy) => [...row].forEach((key, gx) => {
      // A mirrored pair part reflects its offset across the right-hand anchor.
      const x = mirrored ? ax + MARGIN_X - (part.at[0] + gx) : ax + MARGIN_X + part.at[0] + gx;
      put(x, ay + MARGIN_Y + part.at[1] + gy, key, layer);
    }));
  };
  const behind = parts.filter((p) => PARTS[p.id]?.behind);
  const front = parts.filter((p) => !PARTS[p.id]?.behind);
  for (const part of behind) {
    stampPart(part);
    if (PARTS[part.id].pair) stampPart(part, true);
  }
  arch.grid.forEach((row, y) => [...row].forEach((ch, x) => {
    const key = ch === 'O' ? 'o' : ch === 'B' ? bodyKey : ch === 'b' ? shade : ch === 'H' ? 'c' : ch === 'X' ? eye : '.';
    put(x + MARGIN_X, y + MARGIN_Y, key, 0);
  }));
  for (const part of front) {
    stampPart(part);
    if (PARTS[part.id].pair) stampPart(part, true);
  }
  return { rows: keys.map((row) => row.join('')), layers: layers.map((row) => row.join('')) };
}

// ---------- posed and fight-sized strays (Phase 4) ----------

const MEMO = new Map();
const MEMO_MAX = 2048;
const POSE_IDS = new WeakMap();
let poseCount = 0;
function poseId(pose) {
  let id = POSE_IDS.get(pose);
  if (!id) {
    poseCount += 1;
    id = `#${poseCount}`;
    POSE_IDS.set(pose, id);
  }
  return id;
}
function memoKey({ archetype, bodyKey, parts, eyeKey, pose, poseName, frame, size }) {
  const partKey = (Array.isArray(parts) ? parts : []).map((p) => `${p.id}:${p.layer || 0}`).join(',');
  const name = pose ? (poseName || poseId(pose)) : 'rest';
  return `${archetype}|${bodyKey}|${eyeKey || ''}|${partKey}|${name}|${pose ? frame : 0}|${validSize(size)}`;
}
function validSize(size) {
  const n = Math.round(Number(size) || SIZE);
  return Math.max(SIZE, n - (n % 2));
}

/** Margins at a size: Phase 3's (2, 4) at 20, and half the extra on each side above it (6, 8 at 28). */
export function marginsAt(size = SIZE) {
  const s = validSize(size);
  return [MARGIN_X + (s - SIZE) / 2, MARGIN_Y + (s - SIZE) / 2];
}

// Ordered dither for fades (the same 4×4 matrix scene-art uses for the Hush).
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/** The closed set of pose operations anims.json may use (CONTRACT-PHASE4.md §9.9). */
export const POSE_OPS = Object.freeze(['swapLegs', 'squash', 'stretch', 'shift', 'lift', 'flash', 'dither']);

/**
 * The pose operations (anims.json, COMBAT.md §14.3). The body ops run on the placeholder body
 * already placed in the frame, so a lunge never clips at the archetype's own 16 columns, and each
 * moves the anchors with the pixels so the parts follow the body. Rows and columns are the
 * archetype grid's own (0–15):
 *   swapLegs { lift: 'left' | 'right', from }   that half's rows from `from` down step up 1 (a stride)
 *   squash { row, left, right }                 rows above `row` sink 1, as breathe does, in columns [left, right)
 *   stretch { row, left, right }                rows up to `row` rise 1, in columns [left, right)
 *   shift { top, bottom, dx }                   a band of rows slides sideways (a lean, a lunge)
 *   lift { dy }                                 the whole stray and its parts, up (−) or down
 *   flash { key }                               every key but ink turns `key` (cream by default)
 *   dither { level }                            pixels under the 4×4 Bayer level (0–16) go clear (fades)
 * Anchor offsets ({ name: [dx, dy] }) apply before stamping, and `eyes` swaps the eye placeholder.
 */
function composePosed({ archetype, bodyKey, parts, eyeKey, spec, size }) {
  const arch = ARCHETYPES[archetype] || ARCHETYPES.floater;
  const [mx, my] = marginsAt(size);
  const shade = SHADE[bodyKey] || bodyKey;
  let eye = (spec && typeof spec.eyes === 'string' && spec.eyes) || eyeKey || arch.eye || 'u';
  // An eye swapped to the body's own colour would vanish: it goes to ink instead.
  if (spec && spec.eyes && (spec.eyes === bodyKey || spec.eyes === shade)) eye = 'o';
  const ops = spec && Array.isArray(spec.ops) ? spec.ops : [];
  let dy = 0;
  for (const op of ops) if (op && op.op === 'lift') dy += Math.round(Number(op.dy) || 0);
  let body = Array.from({ length: size }, () => Array(size).fill('.'));
  arch.grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (x + mx < size && y + my < size) body[y + my][x + mx] = ch;
  }));
  const anchors = {};
  for (const [name, [ax, ay]] of Object.entries(arch.anchors)) {
    const off = spec && spec.anchors && Array.isArray(spec.anchors[name]) ? spec.anchors[name] : [0, 0];
    anchors[name] = [ax + mx + (Number(off[0]) || 0), ay + my + (Number(off[1]) || 0)];
  }
  const moveAnchors = (test, dx, ddy) => {
    for (const a of Object.values(anchors)) if (test(a[0], a[1])) { a[0] += dx; a[1] += ddy; }
  };
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const left = Number.isFinite(op.left) ? op.left + mx : 0;
    const right = Number.isFinite(op.right) ? op.right + mx : size;
    if (op.op === 'shift') {
      const top = (Number.isFinite(op.top) ? op.top : 0) + my;
      const bottom = (Number.isFinite(op.bottom) ? op.bottom : 16) + my;
      const dx = Math.round(Number(op.dx) || 0);
      if (!dx) continue;
      body = body.map((row, y) => {
        if (y < top || y >= bottom) return row;
        const out = Array(size).fill('.');
        row.forEach((ch, x) => { if (x + dx >= 0 && x + dx < size) out[x + dx] = ch; });
        return out;
      });
      moveAnchors((ax, ay) => ay >= top && ay < bottom, dx, 0);
    } else if (op.op === 'squash') {
      const split = (Number.isFinite(op.row) ? op.row : 8) + my;
      const next = body.map((row) => row.slice());
      for (let y = split; y >= 0; y -= 1) for (let x = left; x < right; x += 1) next[y][x] = y > 0 ? body[y - 1][x] : '.';
      body = next;
      moveAnchors((ax, ay) => ay < split && ax >= left && ax < right, 0, 1);
    } else if (op.op === 'stretch') {
      const split = (Number.isFinite(op.row) ? op.row : 8) + my;
      const next = body.map((row) => row.slice());
      for (let y = 0; y < split; y += 1) for (let x = left; x < right; x += 1) next[y][x] = body[y + 1][x];
      body = next;
      moveAnchors((ax, ay) => ay < split && ax >= left && ax < right, 0, -1);
    } else if (op.op === 'swapLegs') {
      const from = (Number.isFinite(op.from) ? op.from : 12) + my;
      const mid = Math.floor(size / 2);
      const [x0, x1] = op.lift === 'right' ? [mid, size] : [0, mid];
      const next = body.map((row) => row.slice());
      for (let y = from; y < size; y += 1) for (let x = x0; x < x1; x += 1) next[y - 1][x] = body[y][x];
      for (let x = x0; x < x1; x += 1) next[size - 1][x] = '.';
      // The row the lifted leg rises into keeps its body where the leg left a gap.
      for (let x = x0; x < x1; x += 1) if (next[from - 1][x] === '.') next[from - 1][x] = body[from - 1][x];
      body = next;
    }
  }
  const keys = Array.from({ length: size }, () => Array(size).fill('.'));
  const layers = Array.from({ length: size }, () => Array(size).fill('0'));
  const put = (x, y, key, layer) => {
    const ty = y + dy;
    if (x < 0 || ty < 0 || x >= size || ty >= size || key === '.') return;
    keys[ty][x] = key;
    layers[ty][x] = String(layer);
  };
  const stampPart = ({ id, layer = 0 }, mirrored = false) => {
    const part = PARTS[id];
    if (!part) return;
    const [ax, ay] = anchors[mirrored ? 'right' : part.anchor] || anchors.body;
    part.grid.forEach((row, gy) => [...row].forEach((key, gx) => {
      // A mirrored pair part reflects its offset across the right-hand anchor, as at rest.
      const x = mirrored ? ax - (part.at[0] + gx) : ax + part.at[0] + gx;
      put(x, ay + part.at[1] + gy, key, layer);
    }));
  };
  const list = Array.isArray(parts) ? parts : [];
  const behind = list.filter((p) => PARTS[p.id]?.behind);
  const front = list.filter((p) => !PARTS[p.id]?.behind);
  for (const part of behind) {
    stampPart(part);
    if (PARTS[part.id].pair) stampPart(part, true);
  }
  body.forEach((row, y) => row.forEach((ch, x) => {
    const key = ch === 'O' ? 'o' : ch === 'B' ? bodyKey : ch === 'b' ? shade : ch === 'H' ? 'c' : ch === 'X' ? eye : '.';
    put(x, y, key, 0);
  }));
  for (const part of front) {
    stampPart(part);
    if (PARTS[part.id].pair) stampPart(part, true);
  }
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'flash') {
      const to = typeof op.key === 'string' && op.key.length === 1 ? op.key : 'c';
      for (const row of keys) for (let x = 0; x < size; x += 1) if (row[x] !== '.' && row[x] !== 'o') row[x] = to;
    } else if (op.op === 'dither') {
      const level = Math.max(0, Math.min(16, Number(op.level) || 0));
      keys.forEach((row, y) => { for (let x = 0; x < size; x += 1) if (BAYER[y & 3][x & 3] < level) row[x] = '.'; });
    }
  }
  return Object.freeze({
    rows: Object.freeze(keys.map((row) => row.join(''))),
    layers: Object.freeze(layers.map((row, y) => row.map((l, x) => (keys[y][x] === '.' ? '0' : l)).join(''))),
  });
}

/**
 * Where a stray's feet are, from its rest frame at `size`: [x, y], x the frame's middle and y its
 * lowest drawn row. Taken once, so a jumping or lifted frame leaves the ground instead of following it.
 */
export function restFeet({ archetype, bodyKey = 'r', parts = [], size = SIZE }) {
  const s = validSize(size);
  const rest = composeStray({ archetype, bodyKey, parts, size: s });
  let bottom = rest.rows.length - 1;
  while (bottom > 0 && !/[^.]/.test(rest.rows[bottom])) bottom -= 1;
  return Object.freeze([s >> 1, bottom]);
}
