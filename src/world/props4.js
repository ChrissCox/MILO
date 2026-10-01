// Phase 4's props (CONTRACT-PHASE4.md §7.8, COMBAT.md §14.4): camp things, the Last Bridge, the genre
// props a fight room stands among, the mechanic objects (a frame per state, in §5.3's order), the
// six device frames and the Scribe's notebook with its pen. Every entry is
//   { frames: rows[][], w, h, feet: [x, y], cover: 'low' | 'high' | null, states?: string[], span?: [x, y, w, h] }
// with `feet` the pixel that stands on its tile (bottom middle, unless it floats), and `span` (the
// Last Bridge's, from lastBridgeRows) the part of the art over its deck's tiles. Kept out of
// sprites.js's SPRITES, so the atlas never paints them; the engine paints them lazily. Genre props
// are drawn in the world's own keys and take the room's genre table when drawn. Pure data.
import { SPRITES, stamp, recolor, mirror, shiftRows } from './sprites.js';

const freeze = Object.freeze;
const g = (text) => freeze(text.split('\n').map((r) => r.trim()).filter(Boolean));
const size = (rows) => [rows[0].length, rows.length];

function prop(frames, { cover = null, feet = null, states = null, span = null } = {}) {
  const list = frames.map((rows) => freeze(rows.slice()));
  const [w, h] = size(list[0]);
  return freeze({ frames: freeze(list), w, h, feet: freeze(feet || [w >> 1, h - 1]), cover, ...(states ? { states: freeze(states) } : {}), ...(span ? { span: freeze(span.slice()) } : {}) });
}

// ---------- camp ----------

// Toby Fennick's handcart: it wheels a dozing party home to the last lantern.
const HANDCART = g(`
  ..................oo
  .oooooooooooooooooo.
  obnnnnnnnnnnnnnnbo..
  obbbbbbbbbbbbbbbbo..
  oBbBBbBBbBBbBBbbBo..
  oooooooooooooooooo..
  .oBBo.......oBBo....
  oBnnBo.....oBnnBo...
  oBnmnBo...oBnmnBo...
  .oBBBo.....oBBBo....
  ..ooo.......ooo.....
`);

// Breather tea: a pot and a cup, the steam curling (three frames).
const TEA_BASE = g(`
  ............
  ............
  ............
  ............
  ....oooo....
  ...orrrro...
  .ooorRrrooo.
  orroRrrrrRo.
  orroRrrrrRo.
  .oooRRRRRo..
  ....ooooo...
  ..oooooooo..
`);
const STEAM = [
  g(`
    ......c.....
    .....c......
    ......c.....
    .....c......
  `),
  g(`
    .....c......
    ......c.....
    .....c......
    ......c.....
  `),
  g(`
    ......c.....
    ......c.....
    .....c......
    ............
  `),
];
const TEA = STEAM.map((s) => stamp(TEA_BASE, s, 0, 0));

// The paper lantern that rises at a level up (a flicker of two frames).
const PAPER_LANTERN = [
  g(`
    ...oo...
    ..oBBo..
    .orrrro.
    orucurRo
    oruuurRo
    orurrrRo
    .orrrRo.
    ..oBBo..
    ...oo...
    ....u...
  `),
  g(`
    ...oo...
    ..oBBo..
    .orrrro.
    orcuurRo
    oruuurRo
    orrurrRo
    .orrrRo.
    ..oBBo..
    ...oo...
    ...u....
  `),
];

// A bedroll by the fire, rolled out.
const BEDROLL = g(`
  ..oooooooooooooooooo..
  .ovvvvvvvvvvvvvvvvvvo.
  ovcvvvcvvvcvvvcvvvvVVo
  ovvvvvvvvvvvvvvvvvvVVo
  ovvvcvvvcvvvcvvvcvVVVo
  .oVVVVVVVVVVVVVVVVVVo.
  ..oooooooooooooooooo..
`);

// A hearth-nook: the lantern and stool an Elsewhere keeps for a rest.
const HEARTH_NOOK = g(`
  ....oooo........
  ...oBBBBo.......
  ...ouccuo.......
  ...ouuuUo.......
  ...oBBBBo.......
  ....oooo........
  .....ob.........
  .....ob.........
  ...ooooooooooo..
  ..onnnnnnnnnnbo.
  ..obbbbbbbbbbBo.
  ..oooooooooooo..
  ...oBo.....oBo..
  ...oBo.....oBo..
  ...ooo.....ooo..
`);

// ---------- the Last Bridge (a Cinderfolk bridge over the Murmur, at the Whisperwood's edge) ----------

// The bridge's stonework is laid out in code so its courses line up; the lanterns are drawn by hand.
const BRIDGE_LANTERN = g(`
  .oooo.
  oBBBBo
  oucuuo
  ouuuUo
  oBBBBo
  .oooo.
  ..os..
`);
const speck = (x, y) => ((x * 7 + y * 13) % 11 === 0 ? 'P' : 'p');
const stones = (x, y) => ((x * 5 + y * 3) % 9 === 0 ? 's' : 'S');

// The Last Bridge's deck is 1 to 5 river tiles long (trail.js's lastBridge; a dry footbridge is 3),
// so its art is built for the deck it spans: lastBridgeRows(tiles, dir) gives a PROPS4-shaped entry
// with `span` [x, y, w, h], the rectangle of the art that lies over the deck's tiles (16 px each),
// and `feet` the bottom middle of that rectangle. Draw it at (the deck's middle x − feet[0], the deck's
// last pixel row − feet[1]); equivalently, put span's top-left on the first deck tile's top-left.
// The stonework reaches 4 px onto each bank, and the lanterns stand up past the north edge.
const TILE = 16;
const BANK = 4;
const BRIDGE_CACHE = new Map();

/** The Last Bridge over a deck of `tiles` tiles (1–8), running 'h' (east–west) or 'v' (north–south). */
export function lastBridgeRows(tiles = 3, dir = 'h') {
  const n = Math.max(1, Math.min(8, Math.round(Number(tiles)) || 1));
  const d = dir === 'v' ? 'v' : 'h';
  const key = `${d}${n}`;
  if (!BRIDGE_CACHE.has(key)) BRIDGE_CACHE.set(key, d === 'h' ? bridgeAcross(n) : bridgeAlong(n));
  return BRIDGE_CACHE.get(key);
}

// Running east–west, seen from the side: two parapets, the deck between, the arches and the water
// under them (a pier in the river for every three tiles past the first arch), and a lantern at each end.
function bridgeAcross(n) {
  const W = n * TILE + 2 * BANK;
  const arches = Math.ceil(n / 3);
  const piers = Array.from({ length: arches - 1 }, (_, k) => Math.round(((k + 1) * W) / arches));
  const inPier = (x) => piers.some((c) => x >= c - 2 && x <= c + 1);
  const pierEdge = (x) => piers.some((c) => x === c - 3 || x === c + 2);
  const rows = [];
  const line = (fn) => rows.push(Array.from({ length: W }, (_, x) => fn(x, rows.length)).join(''));
  for (let y = 0; y < 7; y += 1) line(() => '.');
  line(() => 'o');
  line((x) => (x === 0 || x === W - 1 ? 'o' : x === W - 2 ? 'z' : 's'));
  line((x, y) => (x === 0 || x === W - 1 ? 'o' : x === W - 2 ? 'z' : stones(x, y)));
  line(() => 'o');
  for (let i = 0; i < 4; i += 1) line((x, y) => (x === 0 || x === W - 1 ? 'o' : speck(x, y)));
  line(() => 'o');
  line((x) => (x === 0 || x === W - 1 ? 'o' : x === W - 2 ? 'z' : 's'));
  line((x, y) => (x === 0 || x === W - 1 ? 'o' : x >= W - 3 ? 'z' : stones(x, y)));
  // the arches: stone piers on each bank (and in the river), the Murmur running under them
  for (let i = 0; i < 5; i += 1) line((x, y) => {
    if (x === 0 || x === W - 1) return 'o';
    if (x <= BANK || x >= W - 1 - BANK) return x === 1 || x === W - 2 ? 'z' : stones(x, y);
    if (inPier(x)) return x === piers.find((c) => x >= c - 2 && x <= c + 1) + 1 ? 'z' : stones(x, y);
    if (x === BANK + 1 || x === W - 2 - BANK || pierEdge(x)) return 'o';
    if (i === 0) return 'o';
    const nearPier = pierEdge(x - 1) || pierEdge(x + 1) || pierEdge(x - 2) || pierEdge(x + 2);
    return i >= 3 || (i === 2 && (x < BANK + 4 || x > W - 5 - BANK || nearPier)) ? 'W' : (x + i) % 9 === 0 ? 'f' : 'w';
  });
  line(() => 'o');
  let out = stamp(rows, BRIDGE_LANTERN, 3, 1);
  out = stamp(out, BRIDGE_LANTERN, W - 9, 1);
  const span = [BANK, 8, n * TILE, TILE];
  return prop([out], { feet: [span[0] + span[2] / 2, span[1] + span[3] - 1], span });
}

// Running north–south, seen from above: the deck along its length between two parapets, and the
// lanterns at its north end.
function bridgeAlong(n) {
  const W = 26;
  const top = 11;
  const H = top + n * TILE + BANK;
  const rows = [];
  for (let y = 0; y < H; y += 1) {
    rows.push(Array.from({ length: W }, (_, x) => {
      if (y < 7) return '.';
      if (y === 7 || y === H - 1) return (x <= 7 || x >= W - 8) ? 'o' : y === H - 1 ? 'o' : '.';
      if (x === 0 || x === 7 || x === W - 8 || x === W - 1) return 'o';
      if (x < 7 || x > W - 8) return y >= H - BANK ? 'z' : y === 8 ? 's' : stones(x, y);
      if (y === top - 1) return 'o';
      return y < top - 1 ? '.' : speck(x, y);
    }).join(''));
  }
  let out = stamp(rows, BRIDGE_LANTERN, 1, 1);
  out = stamp(out, BRIDGE_LANTERN, W - 7, 1);
  const span = [(W - TILE) >> 1, top, TILE, n * TILE];
  return prop([out], { feet: [span[0] + span[2] / 2, span[1] + span[3] - 1], span });
}

// ---------- genre props (a `prop` object's state; flags as §7.8 lists) ----------

const SERVER_RACK = g(`
  .oooooooooooo.
  oNNNNNNNNNNNNo
  oNooooooooooNo
  oNoEEEEEEuEoNo
  oNooooooooooNo
  oNoEkEEEEEEoNo
  oNooooooooooNo
  oNoEEEuEEEEoNo
  oNooooooooooNo
  oNoEEEEEEkEoNo
  oNooooooooooNo
  oNoEuEEEEEEoNo
  oNooooooooooNo
  oNoEEEEkEEEoNo
  oNooooooooooNo
  oNoEEEEEEEuoNo
  oNooooooooooNo
  oNNNNNNNNNNNNo
  oNNNNNNNNNNNNo
  oooooooooooooo
  .oo........oo.
`);

const VENDING = g(`
  .oooooooooooo.
  oeeeeeeeeeeeEo
  oeooooooooooEo
  oeoccccccccoEo
  oeocuckcuccoEo
  oeoccccccccoEo
  oeockcuckccoEo
  oeoccccccccoEo
  oeooooooooooEo
  oeeeeeeeooeeEo
  oeeeeeeeooeeEo
  oeoooooeeeeeEo
  oeoooooeeeeeEo
  oEEEEEEEEEEEEo
  oooooooooooooo
`);

const STREETLAMP = g(`
  ..oooooo..
  .oNNNNNNo.
  ooooooooo.
  .oucuuuo..
  .ouuuuUo..
  ..oooooo..
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ....oNo...
  ...ooNoo..
  ..oNNNNNo.
  ..ooooooo.
`);

const PARK_BENCH = g(`
  .oooooooooooooo.
  obbbbbbbbbbbbbbo
  oooooooooooooooo
  obbbbbbbbbbbbbbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
  .oNo........oNo.
  .oNo........oNo.
  .ooo........ooo.
`);

const CANDELABRA = g(`
  ..u...u...u.
  .uUu.uUu.uUu
  ..c...c...c.
  ..c...c...c.
  .oco.oco.oco
  .oSoooSoooSo
  ..oSSSSSSSo.
  ......So....
  ......So....
  ......So....
  .....oSSo...
  ....oSSSSo..
  ....oooooo..
`).map((r) => r.padEnd(12, '.'));

const PEW = g(`
  oooooooooooooooo
  oBbbbbbbbbbbbbBo
  oBbbbbbbbbbbbbBo
  oBooooooooooooBo
  oBnnnnnnnnnnnnBo
  oooooooooooooooo
  oBbbbbbbbbbbbbBo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
  .oBo........oBo.
  .oBo........oBo.
  .ooo........ooo.
`);

const OIL_DRUM = g(`
  .oooooooo.
  oRRRRRRRRo
  oQRRRRRRQo
  oooooooooo
  oQuouououo
  oQououououo
  oooooooooo
  oQRRRRRRQo
  oQRRRRRRQo
  oooooooooo
  oQRRRRRRQo
  .oQQQQQQo.
  ..oooooo..
`).map((r) => r.slice(0, 10));

const GIRDER = g(`
  oooooooooooo
  oSSSSSSSSSSo
  ozzzzzzzzzzo
  oooooSSooooo
  ....oSzo....
  ....oSzo....
  ....ozSo....
  ....oSzo....
  ....oSzo....
  ....oSzo....
  ....ozSo....
  ....oSzo....
  ....oSzo....
  ....oSzo....
  ....ozSo....
  ....oSzo....
  ....oSzo....
  oooooSSooooo
  oSSSSSSSSSSo
  ozzzzzzzzzzo
  oooooooooooo
`);

const SHARD = g(`
  .....oo.....
  ....ocvo....
  ....ocvo....
  ...ocvvVo...
  ...ocvvVo...
  ...ocvvVo...
  ..ocvvvVVo..
  ..ocvvvVVo..
  ..ocvvvVVo..
  ..ovvvvVVo..
  .ocvvvvVVVo.
  .ocvvvvVVVo.
  .ovvvvvVVVo.
  .ovvvvVVVVo.
  ovvvvvVVVVVo
  ovvvvvVVVVVo
  oooooooooooo
`);

const ORBIT_STONE = [
  g(`
    ..........c.
    ...oooo.....
    ..osssSo....
    .osssSSSo...
    .ossSSSSo...
    .oSSSSSzo...
    ..oSSzzo....
    ...oooo.....
    ............
    ..xxxxxx....
  `),
];

const FILING_CABINET = g(`
  oooooooooooo
  oSSSSSSSSSSo
  oSooooooooSo
  oSoSSSSSSoSo
  oSoSSooSSoSo
  oSoSSSSSSoSo
  oSooooooooSo
  oSoSSSSSSoSo
  oSoSSooSSoSo
  oSoSSSSSSoSo
  oSooooooooSo
  oSoSSSSSSoSo
  oSoSSooSSoSo
  oSoSSSSSSoSo
  oSooooooooSo
  ozzzzzzzzzzo
  oooooooooooo
`);

const DESK = g(`
  ...........oo...
  ..........ouuo..
  ...........oo...
  ..oooo.....oo...
  .occcco...oBBo..
  oooooooooooooooo
  obbbbbbbbbbbbbbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
  .oBo.oBBBBo..oBo
  .oBo.oBooBo..oBo
  .oBo.oBBBBo..oBo
  .ooo.oooooo..ooo
`);

const WAGON = g(`
  ...oooooooooo...
  ..occcccccccco..
  .occccccccccCCo.
  occcccccccccCCCo
  oooooooooooooooo
  obbbbbbbbbbbbbbo
  obnnbbbbbbbnnbbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
  .oBo........oBo.
  oBnBo......oBnBo
  onmnBo....onmnBo
  oBnBo......oBnBo
  .ooo........ooo.
`);

const TITAN_RUBBLE = g(`
  ......oooo......
  .ooo.ossSSo.....
  osSSooSSSSzooo..
  oSSzosSSzzzosSo.
  oSzzoSSzzzzoSSzo
  oooooooooooooooo
`);

const TITAN_CAR = g(`
  ....oooooooo....
  ...oeeeoeeeeo...
  ..oeeeeoeeeeeo..
  .oooooooooooooo.
  orrrrrrrrrrrrrro
  orcrrrrrrrrrrcro
  oRRRRRRRRRRRRRRo
  oooooooooooooooo
  .ozzo......ozzo.
  .oooo......oooo.
`);

const RUBBLE = g(`
  ....oooo......
  ..oossSSo.oo..
  .osSSSzzoosSo.
  oSSzzSzzosSzzo
  oooooooooooooo
`);

// ---------- mechanic objects (a frame per state, §5.3's order) ----------

const JUNCTION = g(`
  .oooooooooo.
  oSSSSSSSSSSo
  oSooooooooSo
  oSoEEEEEEoSo
  oSoEooooEoSo
  oSoEEEEEEoSo
  oSooooooooSo
  oSSSSSSSSSSo
  oooooooooooo
  ...oo..oo...
  ...oo..oo...
`);
const JUNCTION_ON = stamp(JUNCTION, g(`
  ..uuuuuu..
  ..ucccu...
`).map((r) => r.padEnd(10, '.')), 1, 4);

const LAMP_LIT = SPRITES['lamp.post'][0];
const LAMP_DARK = recolor(LAMP_LIT, { u: 'S', c: 's', U: 'z' }, { top: 3, bottom: 5 });

const CANDLE_LIT = g(`
  ...u..
  ..uUu.
  ..ucu.
  ...o..
  ..occo
  ..occo
  ..oCco
  ..oCco
  .oooooo
  .oSSSSo
  .oooooo
`).map((r) => r.padEnd(7, '.'));
const CANDLE_DARK = stamp(CANDLE_LIT, g(`
  ...C..
  ..C...
  ...C..
`), 0, 0).map((r, y) => (y < 3 ? r.replace(/[uUc]/g, '.') : r));

const LEVER_UP = g(`
  ........oo
  .......oco
  ......oco.
  .....oco..
  ....oco...
  ...oco....
  .oooooooo.
  oSSSSSSSSo
  oSzzzzzzSo
  oooooooooo
`);
const LEVER_DOWN = mirror(LEVER_UP);

const LINE_RUNNING = g(`
  ..........oooo..
  ..oooo...obbbbo.
  .obbbbo..obnnbo.
  .obnnbo..obbbbo.
  .obbbbo...oooo..
  oooooooooooooooo
  oSzSzSzSzSzSzSzo
  oooooooooooooooo
  oSo..........oSo
  ooo..........ooo
`);
const LINE_SHUT = stamp(LINE_RUNNING.map((r, y) => (y < 5 ? '.'.repeat(16) : r)), ['oSSSSSSSSSSSSSSo'], 0, 6);

const CONSOLE = g(`
  .oooooooooo.
  oSSSSSSSSSSo
  oSooooooooSo
  oSoNNNNNNoSo
  oSoNNNNNNoSo
  oSooooooooSo
  oooooooooooo
  oSSSSSSSSSSo
  oSkoSuoSeoSo
  oSSSSSSSSSSo
  oooooooooooo
  .oSo....oSo.
  .ooo....ooo.
`);
const CONSOLE_USED = stamp(CONSOLE, g(`
  eecceu
  euecce
`), 3, 3);

const LECTERN = g(`
  .oooooooooo.
  oBBBBBBBBBBo
  oooooooooooo
  ....oBBo....
  ....oBbo....
  ....oBbo....
  ....oBbo....
  ...oBBBBo...
  ..oooooooo..
`);
const LECTERN_BOOK = stamp(LECTERN, g(`
  .oooooooooo.
  ocrrrrrrrrco
`), 0, -1).slice(0);
const LECTERN_READ = stamp(LECTERN, g(`
  oooooooooooo
  occcccocccco
`), 0, 0);

const ALIBI = g(`
  ...oooo...
  ..onnnno..
  ..onoono..
  ..onnnno..
  ...onno...
  .oonnnnoo.
  onnnnnnnno
  onnnnnnnno
  .onnnnnno.
  ..onnnno..
  ..onoono..
  ..onoono..
  ..ooooooo.
  ...oBBo...
  ..oBBBBo..
  ..oooooo..
`);
const ALIBI_BROKEN = stamp(shiftRows(ALIBI, 2, 0, 8), g(`
  ..........
  ..........
  ..........
  ..........
  ..........
  ..........
  .....o....
  ....oo....
  ...o.o....
`), 0, 0);

const CLUE_HIDDEN = g(`
  ........
  ........
  ........
  ....c...
  ........
  ..xxxx..
`);
const CLUE_FOUND = g(`
  ...c....
  ..cuc...
  .oooooo.
  occcccco
  ocSSScco
  oooooooo
`);

const PLAN_TILE = g(`
  oooooooooooooooo
  oppppppppppppppo
  opPPPPPPPPPPPPpo
  opPppppppppppPpo
  opPppppppppppPpo
  opPppppppppppPpo
  opPppppppppppPpo
  opPPPPPPPPPPPPpo
  oppppppppppppppo
  oooooooooooooooo
`);
const PLAN_TILE_MARKED = stamp(PLAN_TILE, g(`
  RR....RR
  .RR..RR.
  ..RRRR..
  ..RRRR..
  .RR..RR.
  RR....RR
`), 4, 2);

const BREAKER_ON = g(`
  oooooooooo
  oSSSSSSSSo
  oSooooooSo
  oSoluuloSo
  oSoouuooSo
  oSoSSSSoSo
  oSooooooSo
  oSSSSSSSSo
  oooooooooo
  ...oSo....
  ...ooo....
`);
const BREAKER_OFF = stamp(BREAKER_ON, g(`
  oSSSSo
  oouuoo
  oruuro
`), 2, 3);

const FORGE_COLD = g(`
  ....oooooo....
  ...oSSSSSSo...
  ..oSSooooSSo..
  .oSSoCCCCoSSo.
  .oSSoCzCCoSSo.
  .oSSooooooSSo.
  oSSSSSSSSSSSSo
  ozzzzzzzzzzzzo
  oooooooooooooo
`);
const FORGE_STOKED = stamp(FORGE_COLD, g(`
  .u.u
  UuUu
  uUcU
`), 5, 2);

const BELL_STILL = g(`
  ooooooooooooo
  oBBBBBBBBBBBo
  ooooooooooooo
  .oBo..o..oBo.
  .oBo.ouo.oBo.
  .oBoouuuooBo.
  .oBouuuuuoBo.
  .oBouuuuUoBo.
  .oBoouUUooBo.
  .oBo..o..oBo.
  .oBo.....oBo.
  .ooo.....ooo.
`);
const BELL_RUNG = stamp(BELL_STILL, g(`
  ..........
  .....o....
  ....ouo...
  ...ouuuoo.
  ...ouuuuuo
  ...ouuuUUo
  ....oUUoo.
  ......o...
`).map((r) => r.padEnd(10, '.')), 1, 3).map((r, y) => (y === 5 ? r.replace(/^\.oBo/, '.oBo') : r));

const RIDDLE_BOARD = g(`
  oooooooooooooo
  obbbbbbbbbbbbo
  obooooooooooBo
  oboccccccccoBo
  obocccoocccoBo
  oboccccocccoBo
  obocccocccccBo
  obocccccccco.o
  obocccocccco.o
  obooooooooooBo
  oBBBBBBBBBBBBo
  oooooooooooooo
  ..oBo....oBo..
  ..oBo....oBo..
  ..ooo....ooo..
`).map((r) => r.replace(/o\.o$/, 'oBo').replace(/ocBo$/, 'coBo').slice(0, 14));
const RIDDLE_SOLVED = stamp(RIDDLE_BOARD, g(`
  cccccccl
  ccccccll
  lccccllc
  llcclllc
  cllllccc
  ccllcccc
`), 3, 3);

// ---------- devices (the Artificer's; units draw 'device.<template>', objects by their kind) ----------

const DRONE = [
  g(`
    .cccc..cccc.
    ....o..o....
    ..oooooooo..
    .oSSSSSSSSo.
    .oSoeeeeoSo.
    .oSSSSSSSSo.
    ..oooooooo..
    ....o..o....
  `),
  g(`
    ..cccccccc..
    ....o..o....
    ..oooooooo..
    .oSSSSSSSSo.
    .oSoeueeoSo.
    .oSSSSSSSSo.
    ..oooooooo..
    ....o..o....
  `),
];
const TURRET = g(`
  ....oooo....
  ...oSSSSoooo
  ..oSeeSSSSSo
  ..oSSSSooooo
  ...oSSSo....
  ....oSo.....
  ...oSSSo....
  ..oS.S.So...
  .oSo.S.oSo..
  .oo..o..oo..
`);
// a decoy: a cardboard cut-out to draw the eye
const DECOY = g(`
  ...oooo...
  ..onnnno..
  ..onoono..
  ..onnnno..
  ...onno...
  .oonnnnoo.
  onnnnnnnno
  onnnnnnnno
  .onnnnnno.
  ..onnnno..
  ..onnnno..
  ..onoono..
  ...oBBo...
  ..oBBBBo..
  ..oooooo..
`);
const SNARE_SET = g(`
  ..oooooooo..
  .obb....bbo.
  ob........bo
  .obb....bbo.
  ..oooooooo..
`);
const SNARE_SPRUNG = g(`
  ....oooo....
  ...obbbbo...
  ....oooo....
  ..........o.
  .........ob.
`);
const PATCH_KIT = g(`
  .oooooooo.
  occccccCco
  occcllcCco
  ocllllllco
  occcllcCco
  oCCCCCCCCo
  oooooooooo
`);
const PATCH_KIT_USED = recolor(PATCH_KIT, { l: 'C' });
const POP_UP_COVER = g(`
  oooooooooooooooo
  oeeeeeeeeeeeeeEo
  oeSeeeeSeeeeSeEo
  oeeeeeeeeeeeeeEo
  oEEEEEEEEEEEEEEo
  oooooooooooooooo
  .oSo..oSSo..oSo.
  .ooo..oooo..ooo.
`);
const POP_UP_BROKEN = g(`
  ................
  ................
  ................
  ...oooo....ooo..
  .ooeeeoo.ooeeo..
  oeeSeeEoooeeeEo.
  oEEEEoo.oEEEEEo.
  .ooooo...ooooo..
`);

// ---------- the Scribe's notebook: her pen writing a line (two hand frames) ----------

const NOTE_PAGES = g(`
  ..............
  ..............
  ..............
  .oooooooooooo.
  occcccooccccco
  oSSSScooccccco
  occcccooccccco
  oSSSccooccccco
  oCCCCCooCCCCCo
  oooooooooooooo
`);
const PEN = g(`
  ...c
  ..c.
  .n..
  o...
`);
const NOTEBOOK = [stamp(NOTE_PAGES, PEN, 8, 2), stamp(stamp(NOTE_PAGES, ['SSS'], 8, 5), PEN, 10, 2)];

// ---------- the table ----------

export const PROPS4 = freeze({
  // camp
  handcart: prop([HANDCART]),
  'breather-tea': prop(TEA),
  'paper-lantern': prop(PAPER_LANTERN, { feet: [4, 9] }),
  bedroll: prop([BEDROLL]),
  'hearth-nook': prop([HEARTH_NOOK]),
  notebook: prop(NOTEBOOK),
  // the Last Bridge (a landmark overlay; its deck isn't walkable until the wood wakes)
  // A dry footbridge's 3-tile deck; lastBridgeRows(n, dir) for any other.
  'last-bridge.h': lastBridgeRows(3, 'h'),
  'last-bridge.v': lastBridgeRows(3, 'v'),
  // genre props
  crate: prop([SPRITES.crate[0]], { cover: 'low' }),
  'neon.server-rack': prop([SERVER_RACK], { cover: 'high' }),
  'neon.vending': prop([VENDING], { cover: 'low' }),
  'nocturne.streetlamp': prop([STREETLAMP], { cover: 'high' }),
  'nocturne.bench': prop([PARK_BENCH], { cover: 'low' }),
  'gothic.candelabra': prop([CANDELABRA], { cover: 'low' }),
  'gothic.pew': prop([PEW], { cover: 'low' }),
  'iron.oil-drum': prop([OIL_DRUM], { cover: 'low' }),
  'iron.girder': prop([GIRDER], { cover: 'high' }),
  'void.shard': prop([SHARD], { cover: 'high' }),
  'void.orbit-stone': prop(ORBIT_STONE, { cover: 'low' }),
  'noir.filing-cabinet': prop([FILING_CABINET], { cover: 'high' }),
  'noir.desk': prop([DESK], { cover: 'low' }),
  'frontier.barrel': prop([SPRITES.barrel[0]], { cover: 'low' }),
  'frontier.cart': prop([WAGON], { cover: 'high' }),
  'kaiju.rubble': prop([TITAN_RUBBLE], { cover: 'low' }),
  'kaiju.car': prop([TITAN_CAR], { cover: 'high' }),
  rubble: prop([RUBBLE], { cover: 'low' }),
  // mechanic objects, a frame per state
  junction: prop([JUNCTION, JUNCTION_ON], { states: ['off', 'on'] }),
  lamp: prop([LAMP_LIT, LAMP_DARK], { states: ['lit', 'dark'] }),
  candle: prop([CANDLE_LIT, CANDLE_DARK], { states: ['lit', 'dark'] }),
  lever: prop([LEVER_UP, LEVER_DOWN], { states: ['up', 'down'] }),
  line: prop([LINE_RUNNING, LINE_SHUT], { states: ['running', 'shut'] }),
  console: prop([CONSOLE, CONSOLE_USED], { states: ['idle', 'used'] }),
  lectern: prop([LECTERN_BOOK, LECTERN_READ], { states: ['idle', 'read'] }),
  alibi: prop([ALIBI, ALIBI_BROKEN], { states: ['standing', 'broken'] }),
  clue: prop([CLUE_HIDDEN, CLUE_FOUND], { states: ['hidden', 'found'] }),
  'plan-tile': prop([PLAN_TILE, PLAN_TILE_MARKED], { states: ['clear', 'marked'], feet: [8, 9] }),
  breaker: prop([BREAKER_ON, BREAKER_OFF], { states: ['on', 'off'] }),
  forge: prop([FORGE_COLD, FORGE_STOKED], { states: ['cold', 'stoked'] }),
  bell: prop([BELL_STILL, BELL_RUNG], { states: ['still', 'rung'] }),
  'riddle-board': prop([RIDDLE_BOARD, RIDDLE_SOLVED], { states: ['idle', 'solved'] }),
  // devices
  'device.drone': prop(DRONE, { feet: [6, 7] }),
  'device.turret': prop([TURRET]),
  'device.decoy': prop([DECOY]),
  'device.snare': prop([SNARE_SET, SNARE_SPRUNG], { states: ['set', 'sprung'] }),
  'device.patch-kit': prop([PATCH_KIT, PATCH_KIT_USED], { states: ['full', 'used'] }),
  'device.pop-up-cover': prop([POP_UP_COVER, POP_UP_BROKEN], { cover: 'low', states: ['up', 'broken'] }),
});

const CHEST_STATES = freeze(['shut', 'open']);

/**
 * The frame for a PROPS4 id in a state (its index in `states`), or its first frame; null for an id
 * it doesn't know. It also takes a FightObject's own `kind` and `state` (§5.3), so
 * propFrame(object.kind, object.state) draws every object: a `prop` object's state is its PROPS4 id
 * (`'rubble'` once burst), a device object's kind (`snare`, `patch-kit`, `pop-up-cover`) is drawn
 * by `device.<kind>`, and a `chest` is the world's own chest sprite, shut or open.
 */
export function propFrame(id, state = null) {
  if (id === 'prop') return PROPS4[state]?.frames[0] || null;
  if (id === 'chest') return SPRITES.chest[Math.max(0, CHEST_STATES.indexOf(state))];
  const p = PROPS4[id] || PROPS4[`device.${id}`];
  if (!p) return null;
  const i = state && p.states ? p.states.indexOf(state) : -1;
  return p.frames[i >= 0 ? i : 0];
}

/** Genre props by the flags §7.8 gives them (cover, light, hazard, throwable). */
export const PROP_FLAGS = freeze({
  crate: freeze(['cover-low', 'throwable']),
  'neon.server-rack': freeze(['cover-high']),
  'neon.vending': freeze(['cover-low']),
  'nocturne.streetlamp': freeze(['cover-high', 'light']),
  'nocturne.bench': freeze(['cover-low']),
  'gothic.candelabra': freeze(['cover-low', 'light', 'throwable']),
  'gothic.pew': freeze(['cover-low']),
  'iron.oil-drum': freeze(['cover-low', 'hazard']),
  'iron.girder': freeze(['cover-high']),
  'void.shard': freeze(['cover-high']),
  'void.orbit-stone': freeze(['cover-low']),
  'noir.filing-cabinet': freeze(['cover-high']),
  'noir.desk': freeze(['cover-low']),
  'frontier.barrel': freeze(['cover-low', 'throwable']),
  'frontier.cart': freeze(['cover-high']),
  'kaiju.rubble': freeze(['cover-low']),
  'kaiju.car': freeze(['cover-high']),
  rubble: freeze(['cover-low']),
});
