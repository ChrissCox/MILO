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
 */
export function composeStray({ archetype, bodyKey = 'r', parts = [], eyeKey = null }) {
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
