// MILO world art. Every sprite is a readable string grid; each character is a
// palette key and '.' is transparent. Pure data plus tiny string transforms, so
// this module imports cleanly in Node. Canvas work happens only in buildAtlas().

export const PALETTE = {
  o: { name: 'ink', hex: '#3d4038' },
  c: { name: 'cream', hex: '#fff6e2' },
  C: { name: 'creamShade', hex: '#ecdabb' },
  g: { name: 'grass', hex: '#aad48f' },
  G: { name: 'grassDeep', hex: '#94c27c' },
  h: { name: 'grassLight', hex: '#c1e1a3' },
  j: { name: 'grassSoft', hex: '#b3da98' },
  q: { name: 'leafLight', hex: '#9ccc88' },
  l: { name: 'leaf', hex: '#78af76' },
  L: { name: 'leafDeep', hex: '#5b9169' },
  p: { name: 'sand', hex: '#efdfb7' },
  P: { name: 'sandShade', hex: '#dac698' },
  w: { name: 'water', hex: '#9fd4e6' },
  W: { name: 'waterDeep', hex: '#86c1db' },
  f: { name: 'foam', hex: '#e9f7fb' },
  b: { name: 'wood', hex: '#cfa57d' },
  B: { name: 'woodDeep', hex: '#a57e60' },
  n: { name: 'woodLight', hex: '#e7caa3' },
  m: { name: 'bark', hex: '#86654f' },
  s: { name: 'stone', hex: '#d4d0c5' },
  S: { name: 'stoneDeep', hex: '#aca89c' },
  r: { name: 'clay', hex: '#e7a28a' },
  R: { name: 'clayDeep', hex: '#c98470' },
  k: { name: 'blossom', hex: '#f5bacb' },
  u: { name: 'butter', hex: '#f8de90' },
  U: { name: 'honey', hex: '#efbc6d' },
  e: { name: 'slate', hex: '#95aad2' },
  E: { name: 'slateDeep', hex: '#738ab7' },
  v: { name: 'lavender', hex: '#cabbe8' },
  V: { name: 'lavenderDeep', hex: '#a898cf' },
  t: { name: 'skin', hex: '#fde3cc' },
  x: { name: 'shadow', hex: 'rgba(61, 64, 56, 0.2)' },
  // Deeper steps so every building colour in the kit has a full light-to-shade ramp.
  z: { name: 'stoneDark', hex: '#928e84' },
  K: { name: 'blossomDeep', hex: '#e39cb2' },
  Y: { name: 'honeyDeep', hex: '#d8a060' },
  Q: { name: 'clayDark', hex: '#b27262' },
  N: { name: 'slateDark', hex: '#5f75a0' },
  M: { name: 'leafDark', hex: '#4a7c5c' },
};

export const COLORS = Object.fromEntries(Object.values(PALETTE).map(({ name, hex }) => [name, hex]));

// ---------- pure grid helpers ----------

export function grid(text) {
  return text.split('\n').map((row) => row.trim()).filter((row) => row.length > 0);
}

export function mirror(rows) {
  return rows.map((row) => [...row].reverse().join(''));
}

// Build a symmetric sprite from its left half (the half includes the centre-left column).
export function sym(half) {
  return half.map((row) => row + [...row].reverse().join(''));
}

// Overlay `patch` onto `rows` at (x, y). '.' in the patch keeps the base pixel.
export function stamp(rows, patch, x, y) {
  const out = rows.map((row) => [...row]);
  patch.forEach((line, dy) => {
    [...line].forEach((ch, dx) => {
      const ty = y + dy;
      const tx = x + dx;
      if (ch === '.' || ty < 0 || ty >= out.length || tx < 0 || tx >= out[ty].length) return;
      out[ty][tx] = ch;
    });
  });
  return out.map((row) => row.join(''));
}

// Replace characters in a row range: { from: 'to' }.
export function recolor(rows, map, { top = 0, bottom = rows.length, left = 0, right = Infinity } = {}) {
  return rows.map((row, y) => {
    if (y < top || y >= bottom) return row;
    return [...row].map((ch, x) => (x >= left && x < right && map[ch] ? map[ch] : ch)).join('');
  });
}

// Shift a band of rows sideways by dx (used for tree sway and flag waves).
export function shiftRows(rows, dx, top = 0, bottom = rows.length) {
  return rows.map((row, y) => {
    if (y < top || y >= bottom || dx === 0) return row;
    const width = row.length;
    const cells = [...row];
    const out = new Array(width).fill('.');
    cells.forEach((ch, x) => {
      const nx = x + dx;
      if (nx >= 0 && nx < width) out[nx] = ch;
    });
    return out.join('');
  });
}

// Idle breathing: everything above `split` sinks by one pixel into the body.
export function breathe(rows, split) {
  const width = rows[0].length;
  const out = rows.slice();
  for (let y = split; y > 0; y -= 1) out[y] = rows[y - 1];
  out[0] = '.'.repeat(width);
  return out;
}

export function pad(rows, { top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  const width = rows[0].length + left + right;
  const blank = '.'.repeat(width);
  return [
    ...Array.from({ length: top }, () => blank),
    ...rows.map((row) => '.'.repeat(left) + row + '.'.repeat(right)),
    ...Array.from({ length: bottom }, () => blank),
  ];
}

// ---------- Milo (16 x 20, big head, honey raincoat, clay scarf) ----------

const MILO_DOWN = grid(`
  .....oooooo.....
  ...oommmmmmoo...
  ..ommmmmmmmmmo..
  .ommmbbmmmmmmmo.
  .ommbbmmmmmmmmo.
  .omttttmmttttmo.
  .omttttttttttmo.
  .omttottttottmo.
  .omttottttottmo.
  .omtkttttttktmo.
  ..otttttttttto..
  ...orrrrrrrro...
  ..ouUUUrrUUUbo..
  .ouuUUUrRUUUUbo.
  .ouUUUUUUUUUUbo.
  .otUUUUUUUUUUto.
  ..ouUUUUUUUUbo..
  ..oooooooooooo..
  ....oBBooBBo....
  ....oooooooo....
`);

const MILO_UP = grid(`
  .....oooooo.....
  ...oommmmmmoo...
  ..ommmmmmmmmmo..
  .ommmbbmmmmmmmo.
  .ommbbmmmmmmmmo.
  .ommmmmmmmmmmmo.
  .ommmmmmmmmmmmo.
  .ommmmmmmmmmmmo.
  .ommmmmmmmmmmmo.
  .otmmmmmmmmmmto.
  ..ommmmmmmmmmo..
  ...orrrrrrrro...
  ..ouUbbbbbbUbo..
  .ouuUbUUUUbUUbo.
  .ouUUUbbbbUUUbo.
  .otUUUUUUUUUUto.
  ..ouUUUUUUUUbo..
  ..oooooooooooo..
  ....oBBooBBo....
  ....oooooooo....
`);

const MILO_RIGHT = grid(`
  .....oooooo.....
  ...oommmmmmoo...
  ..ommmmmmmmmmo..
  .ommmbbmmmmmmmo.
  .ommbbmmmmmmmmo.
  .ommmmmmmttttmo.
  .ommmmmmtttttto.
  .ommmmmmttttoto.
  .ommmmmmttttoto.
  .ommmmmtttttkto.
  ..ommmmtttttto..
  ...orrrrrrrro...
  ..orRUUUUUUbo...
  ...ouUUUUUUbo...
  ...ouUUtUUUbo...
  ...ouUUUUUUbo...
  ...ouUUUUUUbo...
  ...oooooooooo...
  .....oBBBo......
  .....ooooo......
`);

const LEGS_DOWN_A = grid(`
  ....oBBooooo....
  ....oooo........
`);
const LEGS_DOWN_B = grid(`
  ....oooooBBo....
  ........oooo....
`);
const LEGS_SIDE_A = grid(`
  ...omBo..oBBo...
  ...oooo..oooo...
`);
const LEGS_SIDE_B = grid(`
  ...oBBo..omBo...
  ...oooo..oooo...
`);
function withLegs(rows, legs) {
  return [...rows.slice(0, 18), ...legs];
}

const MILO_RIGHT_A = stamp(withLegs(MILO_RIGHT, LEGS_SIDE_A), grid(`
  ...ouUUUtUUbo...
`), 0, 14);
const MILO_RIGHT_B = stamp(withLegs(MILO_RIGHT, LEGS_SIDE_B), grid(`
  ...ouUtUUUUbo...
`), 0, 14);

export const MILO = {
  w: 16,
  h: 20,
  headSplit: 11,
  down: [MILO_DOWN, withLegs(MILO_DOWN, LEGS_DOWN_A), withLegs(MILO_DOWN, LEGS_DOWN_B)],
  up: [MILO_UP, withLegs(MILO_UP, LEGS_DOWN_B), withLegs(MILO_UP, LEGS_DOWN_A)],
  right: [MILO_RIGHT, MILO_RIGHT_A, MILO_RIGHT_B],
};
MILO.left = MILO.right.map(mirror);

// ---------- crew (16 x 18 robed folk, plus a bird and an owl) ----------

const CLAUDE = grid(`
  ......oooo......
  ....oorrrroo....
  ...orkkrrrrro...
  ..orkrrrrrrrRo..
  ..orrccccccrRo..
  ..orccccccccRo..
  ..orccoccoccRo..
  ..orccoccoccRo..
  ..orckcccckcRo..
  ..orrccccccrRo..
  .orrrrrrrrrrrRo.
  .orrrrrrrrcrrRo.
  .orrrrrrrcccrRo.
  .ocrrrrrrrcrrco.
  .orrrrrrrrrrrRo.
  ..orrrrrrrrrRo..
  ..oRRRRRRRRRRo..
  ...oooooooooo...
`);

const CODEX = grid(`
  .........oo.....
  .......ooeEo....
  .....ooeeeEo....
  ...ooeeeeeeEo...
  ..oeeeeeeeeeEo..
  ..oettttttttEo..
  ..oettottottEo..
  ..oettottottEo..
  ..oetkttttktEo..
  ..oeettttttEEo..
  .oeeeeeeeeeeeEo.
  .oeccceeeeeeeEo.
  .oeeeccceeeeeEo.
  .oteeeeecceeeto.
  .oeeeeeeeecbbEo.
  ..oeeeeeeeebbo..
  ..oEEEEEEEEEEo..
  ...oooooooooo...
`);

const HELPER = grid(`
  ................
  ................
  ......oo.oo.....
  .....oqqoqqo....
  .....olLolLo....
  ......oolo......
  ....oooolooo....
  ...occcccccco...
  ..occcccccccCo..
  ..occoccccocCo..
  ..occoccccocCo..
  ..ockcccccckCo..
  ..occcccccccCo..
  ...occccccCCo...
  ....oooooooo....
  ....oCo..oCo....
  ....ooo..ooo....
  ................
`);

const LLAMA = grid(`
  ....oo....oo....
  ....oko..oko....
  ....ocooooco....
  ...occcccccco...
  ...occoccocco...
  ...occoccocco...
  ...okcCooCcko...
  ....occCCcco....
  .....occcco.....
  .....occcco.....
  ...ooccccccoo...
  ..occkkkkkkcco..
  ..ockuukkuukco..
  ..occkkkkkkcCo..
  ..oCcccccccCCo..
  ...oBo.oo.oBo...
  ...ooo....ooo...
  ................
`);

// Hands move over the desk for the working loop.
function workFrames(base, body, hand) {
  const clearSides = recolor(base, { [hand]: body }, { top: 13, bottom: 14 });
  const a = stamp(stamp(clearSides, [hand], 4, 11), [hand], 11, 12);
  const b = stamp(stamp(clearSides, [hand], 4, 12), [hand], 11, 11);
  return [a, b];
}

const JEV = grid(`
  ....oooo....
  ...owwwwo...
  ..owowwwwo..
  .oUwwwwwWWo.
  ..occwwWWWWo
  ..occcbWWWWo
  ..occcBBWWo.
  ...oooBBoo..
  ....oU.oU...
  ............
`);
const JEV_FLAP = grid(`
  ....oooo....
  ...owwwwo.o.
  ..owowwwwoWo
  .oUwwwwwWWWo
  ..occwwwWWo.
  ..occcbwwwo.
  ..occcBBWo..
  ...oooBBo...
  ....oU.oU...
  ............
`);

const WHISPER = grid(`
  ..o......o..
  ..oVooooVo..
  .ovvvvvvvvo.
  .occcvvccco.
  .ocuoVVouco.
  .occcUUccco.
  .ovvccccvvo.
  .oVvcVVcvVo.
  .oVvccccvVo.
  .oVvcVVcvVo.
  ..oVvccvVo..
  ...oooooo...
  ...oU..Uo...
  ............
`);
const WHISPER_BLINK = stamp(WHISPER, grid(`
  .occcvvccco.
  .ocooVVooco.
`), 0, 3);

// Unknown helpers share the sprout shape but get their own soft tint.
export const HELPER_TINTS = [
  null,
  { c: 'v', C: 'V' },
  { c: 'u', C: 'U' },
  { c: 'w', C: 'W' },
];
const tinted = (rows, tint) => (tint ? recolor(rows, tint) : rows);

export const CREW_ART = {
  claude: { stand: CLAUDE, work: workFrames(CLAUDE, 'r', 'c'), split: 10 },
  codex: { stand: CODEX, work: workFrames(CODEX, 'e', 't'), split: 10 },
  helper: { stand: HELPER, work: [HELPER, breathe(HELPER, 13)], split: 13 },
  ollama: { stand: LLAMA, work: [LLAMA, breathe(LLAMA, 10)], split: 10 },
  jev: { idle: [JEV, JEV_FLAP] },
  whisper: { idle: [WHISPER, WHISPER_BLINK] },
};

const BUBBLE = grid(`
  .oooooooooo.
  occccccccccc
  occccccccccc
  occccccccccc
  occccccccCCo
  .oooccoooooo
  ...oco......
  ...oo.......
`).map((row) => row.replace(/c$/, 'o'));

// ---------- nature ----------

const TREE = grid(`
  ..........oooooo................
  ........oohhhhqqoo.oooo.........
  .......ohhhqqqqqqLohhhhoo.......
  .......ohqqqqqqqLhhhqqqqqo......
  ......oqqqqqqqllhhqqqqqqllo.....
  ......oqqqqllllLqqqqqqllllo.....
  ......oLLLLllLLLLLLqllLLLllo....
  .....ohhhhqLLhhhhqqLLLhhhLLo....
  ....ohhhqqqhhhqqqqqLhhhhqqqo....
  ...ohqqqqqLhqqqqqqLhhqqqqqqqo...
  ..oqqqqqqlqqqqqqqlhqqqqqqllllo..
  ..oqqqqlllqqqqlllLLLLLLllllllo..
  ..oqqlllLLLLLLllLhhhhhqLllllllo.
  ..ollllLhhhqqqLLhhhqqqqqLlllllo.
  ..olllLhhqqqqqLhhqqqqqqqlLllLLo.
  ..ollLhqqqqqqlhqqqqqqqllllLLLo..
  ...olqqqqqqlllqqqqqlllllllLLLo..
  ....oqqqlllllLqqqlllllllllLLo...
  ....oqlllllllqqllllllllllllo....
  ....ollllllllllllllllllllLo.....
  ....ollllllllLlllllllllLLLo.....
  .....olllllLLLllllllLLLLLLo.....
  ......ollLLLLoonBoLLLLLLLo......
  .......oLLLLoonbbBooLLLLo.......
  ........oooo.onbbBo.oooo........
  .............onbbBo.............
  .............onbbBo.............
  ............oonbbBoo............
  ...........obnbbbBBBo...........
  ...........oooooooooo...........
`);

const TREE_BLOSSOM = stamp(TREE, grid(`
  ..........c.............
  ....................k...
  ..k.......k.............
  ..........ck.......c....
  ................k.......
  .....c..................
  ...............k........
  ........k...........k...
  ..c.....................
  ...........k......c.....
`), 4, 3);

const PINE = grid(`
  ........oo........
  .......oqlo.......
  .......oqlo.......
  ......oqqllo......
  ......ohqllo......
  .....ohqqllLo.....
  ....oqqqlllLLo....
  ....oLLqLLlLLo....
  ....ooqqlllLoo....
  ...ohqqqllllLLo...
  ...oqqqqlllllLo...
  ..ohqqqlllllLLLo..
  ..oLLqqLLllLLLLo..
  ..ooqqqlllllLLoo..
  .ohqqqqllllllLLLo.
  .oqqqqlllllllLLLo.
  ohqqqqllllllllLLLo
  oqqqlllllllllLLLLo
  oLLLlllllllLLLLLLo
  .oLLLLLLLLLLLLLLo.
  ..oooooobBoooooo..
  .......obBo.......
  .......obBo.......
  ......oobBoo......
  ......oooooo......
`);

const BUSH = grid(`
  ....oooo.ooo....
  ...ohhqqoqhqo...
  ..ohqqqqlqqqlo..
  .ohqqqllLlqlllo.
  .oqqlllLhqqllLo.
  ohqqllLhqqqlllLo
  oqqllLqqqlllllLo
  oqlllLqqllllLLLo
  olllLLlllllLLLLo
  oLllllllllLLLLLo
  .oLLLLLLLLLLLLo.
  ..oooooooooooo..
`);
const BUSH_BERRY = stamp(BUSH, grid(`
  ..k......
  ......k..
  .k.......
  ....k..k.
`), 3, 2);

const ROCK = grid(`
  ....oooooo....
  ..oossssSSoo..
  .osccsssssSSo.
  .oscsssssSSSo.
  ossssssSSSSSSo
  oSsssSSSSSSSSo
  .oSSSSSSSSSSo.
  ..oooooooooo..
`);

const STUMP = grid(`
  ...oooooooo...
  ..onnnnnnnno..
  .onnbbbbbbnno.
  .onbnnnnnnbno.
  .onnbbbbbbnno.
  .oonnnnnnnnoo.
  .obBBbbbbBBbo.
  .obBbbBbbBbbo.
  oobBbbBbbBbboo
  oooooooooooooo
`);

const MUSHROOMS = grid(`
  .oo....
  orco...
  oRro.oo
  .no.oro
  .no..n.
`);

const FLOWER_PINK = grid(`
  .k.....
  kuk.k..
  .k.kuk.
  .L..k..
  .L..L..
`);
const FLOWER_BUTTER = grid(`
  ....u..
  .u.uUu.
  uUu.u..
  .u..L..
  .L.....
`);
const FLOWER_LAVENDER = grid(`
  .v...v.
  vVv.vVv
  .v...v.
  .L.v.L.
  ..vVv..
  ...v...
`);
const FLOWER_CREAM = grid(`
  ..c....
  .cuc.c.
  ..c.cuc
  ..L..c.
  ..L..L.
`);
const TUFT = grid(`
  .G..G.
  G.GG.G
  .G.GG.
`);
const TUFT_LIGHT = grid(`
  h...h
  .h.h.
  ..h..
`);
const PEBBLES = grid(`
  .ss....
  sSS..s.
  ....sS.
`);
const CLOVER = grid(`
  .h.h.
  hGhGh
  .hGh.
  ..G..
`);

const LILY = grid(`
  .qqlq..
  qqllllq
  qlllllL
  .LlLLL.
`);
const LILY_FLOWER = stamp(LILY, grid(`
  ..k..
  .kck.
  ..k..
`), 1, 0);
const REEDS = grid(`
  .m...m.
  .m..mB.
  .B..B..
  .L.lL..
  lL.lL.l
  lL.LlLl
  LlLLlL.
  .LLLL..
`);

// ---------- camp ----------

const TENT_HALF = grid(`
  ..............oo
  ..............ob
  ..............ob
  .............ocb
  ............occb
  ............occb
  ...........occcb
  ..........occccb
  ..........occccm
  .........occcccm
  ........occcccCm
  ........occcccCm
  .......occcccCmm
  ......occccccCmm
  .....ocUcccccCmm
  .....occccccCmmm
  ....occcccccCmmm
  ...orrrrrrrrCmmm
  ..oRRRRRRRRRCmmm
  ..occcccccccCmmm
  .occcccccccCmmmm
  .oCCCCCCCCCCmmmm
  oooooooooooooooo
`);
const TENT = recolor(sym(TENT_HALF), { c: 'C', r: 'R' }, { left: 17 });

const CABIN_HALF = grid(`
  ........................
  ........................
  ........................
  ........................
  ........................
  ........................
  ......oooooooooooooooooo
  .....oRRRRRRRRRRRRRRRRRR
  ....orrrrrrrrrrrrrrrrrrr
  ....orrrrrrrrrrrrrrrrrrr
  ...oRrRrRrRrRrRrRrRrRrRr
  ...orrrrrrrrrrrrrrrrrrrr
  ...orrrrrrrrrrrrrrrrrrrr
  ..orRrRrRrRrRrRrRrRrRrRr
  ..orrrrrrrrrrrrrrrrrrrrr
  ..orrrrrrrrrrrrrrrrrrrrr
  .orRrRrRrRrRrRrRrRrRrRrR
  .orrrrrrrrrrrrrrrrrrrrrr
  .orrrrrrrrrrrrrrrrrrrrrr
  oRRRRRRRRRRRRRRRRRRRRRRR
  oooooooooooooooooooooooo
  ..oBBBBBBBBBBBBBBBBBBBBB
  .onnonnnnnnnnnnnnnnnnnnn
  .onnobbbbbbbbbbbbbbbbbbb
  ..ooBBBBBBBBBBBBBBBBBBBB
  .onnonnnnnnnnnnnnnnnnnnn
  .onnobbbbbbbbbbbbbbbbbbb
  ..ooBBBBBBBBBBBBBBBBBBBB
  .onnonnnnnnnnnnnnnnnnnnn
  .onnobbbbbbbbbbbbbbbbbbb
  ..ooBBBBBBBBBBBBBBBBBBBB
  .onnonnnnnnnnnnnnnnnnnnn
  .onnobbbbbbbbbbbbbbbbbbb
  ..ooBBBBBBBBBBBBBBBBBBBB
  .onnonnnnnnnnnnnnnnnnnnn
  .onnobbbbbbbbbbbbbbbbbbb
  ..ooBBBBBBBBBBBBBBBBBBBB
  .onnonnnnnnnnnnnnnnnnnnn
  .onnobbbbbbbbbbbbbbbbbbb
  ..ooBBBBBBBBBBBBBBBBBBBB
  ..ossssSssssSssssSssssSs
  ..oSSSSSSSSSSSSSSSSSSSSS
  ..oooooooooooooooooooooo
`);
const CHIMNEY = grid(`
  oooooo
  osssSo
  oSSSSo
  osSsso
  osssSo
  oSsSSo
  osssSo
  osSsso
  osssSo
  oSsSSo
`);
const DOOR = grid(`
  oooooooooo
  onnnnnnnno
  onBBBBBBno
  onBbBBbBno
  onBbBBbBno
  onBbBBbBno
  onBbBBbBno
  onBbBBbuno
  onBbBBbBno
  onBbBBbBno
  onBbBBbBno
  onBbBBbBno
  onBBBBBBno
  onnnnnnnno
`);
const WINDOW = grid(`
  oooooooooooo
  onnnnnnnnnno
  onccuunuuuno
  oncuuunuuuno
  onuuuunuuuno
  onnnnnnnnnno
  onuuuunuuUno
  onuuuunuUUno
  onnnnnnnnnno
  oooooooooooo
  .kLk.kk.Lkk.
  oooooooooooo
  obbbbbbbbbbo
  oooooooooooo
`);
const CABIN = stamp(stamp(stamp(sym(CABIN_HALF), CHIMNEY, 34, 1), DOOR, 8, 27), WINDOW, 28, 24);

const CAMPFIRE_BASE = grid(`
  ................
  ................
  ................
  ................
  ................
  ................
  ................
  ................
  ................
  ................
  ..ooo......ooo..
  .osso.oooo.osSo.
  .oSSoonBBnooSSo.
  ..oooBBnnBBooo..
  ...ooooooooooo..
  ................
`);
const FLAME_A = grid(`
  .......r........
  ......rU....r...
  ......rUr..rU...
  .....rUuUr.rU...
  ....rUuuuUrrU...
  ....rUucuuUUr...
  ...rUuucccuUr...
  ...rUuccccuUr...
  ....rUuccuUr....
  .....rUUUUr.....
`);
const FLAME_B = grid(`
  ........r.......
  ...r...rU.......
  ...Ur..rUr......
  ...Ur.rUuUr.....
  ...rUrUuuuUr....
  ...rUUuucuUr....
  ...rUuucccuUr...
  ...rUuccccuUr...
  ....rUuccuUr....
  .....rUUUUr.....
`);
const FLAME_C = grid(`
  ................
  .......r...r....
  ......rUr..U....
  .....rUuUr.r....
  ....rUuuuUr.....
  ....rUucuuUr....
  ...rUuucccuUr...
  ...rUuccccuUr...
  ....rUuccuUr....
  .....rUUUUr.....
`);
const CAMPFIRE = [FLAME_A, FLAME_B, FLAME_C].map((flame) => stamp(CAMPFIRE_BASE, flame, 0, 3));

const LOG_BENCH = grid(`
  ..oooooooooooooooooooooooooooooooooooo..
  .onnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnbo
  .onnbbbbbbnnnnnnnnnbbbbbbnnnnnnnnnnbbbbo
  oobbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo
  onnooBBbbbbBBbbbbbbBBbbbbbbbBBbbbbbBBbbo
  onbnoBbbBBbbbbBBbbbbbbBBbbbbbbbBBbbbbBBo
  onnnoBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBo
  .ooo.oooooooooooooooooooooooooooooooooo.
`);

const LOG_END = grid(`
  .oooo.
  onnnbo
  onbnbo
  onnnbo
  .oooo.
`);
const WOODPILE = [[5, 0], [10, 0], [2, 4], [7, 4], [12, 4], [0, 8], [5, 8], [10, 8], [15, 8]]
  .reduce((rows, [x, y]) => stamp(rows, LOG_END, x, y), Array.from({ length: 13 }, () => '.'.repeat(21)));

const SPROUT = grid(`
  q.q
  .l.
`);
const PUMPKIN = grid(`
  ..l..
  .UuU.
  UuUUU
  .UUU.
`);
const GARDEN = [[4, 4], [10, 4], [16, 4], [22, 4], [4, 9], [10, 9], [22, 9]].reduce(
  (rows, [x, y]) => stamp(rows, SPROUT, x, y),
  stamp(grid(`
    oooooooooooooooooooooooooooooo
    obbbbbbbbbbbbbbbbbbbbbbbbbbbbo
    obmmmmmmmmmmmmmmmmmmmmmmmmmmbo
    obmBmmmmmmBmmmmmmmmmmBmmmmmmbo
    obmmmmmmmmmmmmmmBmmmmmmmmmmmbo
    obmmmmmmmmmmmmmmmmmmmmmmmmmmbo
    obmmmmmBmmmmmmmmmmmmmmmmBmmmbo
    obmmmmmmmmmmmmmmmmmmmmmmmmmmbo
    obmmmBmmmmmmmmmBmmmmmmmmmmmmbo
    obmmmmmmmmmmmmmmmmmmmmmmmmmmbo
    obmmmmmmmmmmmmmmmmmmmmBmmmmmbo
    obbbbbbbbbbbbbbbbbbbbbbbbbbbbo
    oooooooooooooooooooooooooooooo
  `), PUMPKIN, 15, 7),
);

const FLAGSTONE = grid(`
  ..ssss...
  .sscsssS.
  sssssssSS
  .SSsssSS.
  ...SSSS..
`);

const FLAG_POLE = grid(`
  .oo.........
  ouUo........
  .oo.........
  onbooooooo..
  onbouuuuuuoo
  onbouUuuuUo.
  onbouuUuUoo.
  onbouuuUo...
  onbouuoo....
  onbooo......
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  onbo........
  oooo........
`);
const FLAG_WAVE = stamp(FLAG_POLE, grid(`
  onboooooooo.
  onbouuuuuuuo
  onbouUuuuUoo
  onbouuUuUo..
  onbouuuUoo..
  onbouuoo....
  onbooo......
`), 0, 3);

const LANTERN = grid(`
  ..oooo..
  .oBBBBo.
  .oucuuo.
  .ouuuUo.
  .ouuuUo.
  .oBBBBo.
  ..oooo..
  ...obo..
  ...obo..
  ...obo..
  ...obo..
  ...obo..
  ...obo..
  ..ooooo.
`);

// ---------- watchtower (48 x 77, symmetric) ----------

const TOWER_HALF = grid(`
  .......................o
  ......................ou
  ......................ou
  .......................o
  ....................ooor
  ..................oorrrr
  ................oorrrrrr
  ..............oorrrRrrrr
  ............oorrrrrrrrrr
  ..........oorrRrrrrRrrrr
  ........oorrrrrrrrrrrrrr
  ......oorrrRrrrrRrrrrRrr
  ....oorrrrrrrrrrrrrrrrrr
  ..oorrRrrrrRrrrrRrrrrRrr
  .oRRRRRRRRRRRRRRRRRRRRRR
  .ooooooooooooooooooooooo
  ....obbbbbbbbbbbbbbbbbbb
  ....obBBBBBBBBBBBBBBBBBB
  ....obommmmmmmmmmmmmmmmm
  ....obommmmmmmmmmmmmmmmo
  ....obommmmmmmmmmmmmmmoo
  ....obommmmmmmmmmmmmmmou
  ....obommmmmmmmmmmmmmmou
  ....obommmmmmmmmmmmmmmoo
  ....oooooooooooooooooooo
  ....onnnnnnnnnnnnnnnnnnn
  ....obbbbbbbbbbbbbbbbbbb
  ....oooooooooooooooooooo
  ....obBobBobBobBobBobBob
  ....obBobBobBobBobBobBob
  ....oooooooooooooooooooo
  ...obbbbbbbbbbbbbbbbbbbb
  ...oBBBBBBBBBBBBBBBBBBBB
  ...ooooooooooooooooooooo
  .....onbo.........obo...
  .....onbo.........obo...
  .....onboB.......Bobonnn
  .....onbo.B.....B.obooo.
  .....onbo..B...B..obo...
  .....onbo...B.B...obo...
  .....onbo....B....obonnn
  .....onbo...B.B...obooo.
  .....onbo..B...B..obo...
  .....onbo.B.....B.obo...
  .....onboB.......Bobonnn
  .....onbo.........obooo.
  .....onbo.........obo...
  .....onbo.........obo...
  .....onbooooooooooobonnn
  .....onbonnnnnnnnnnbooo.
  .....onboBBBBBBBBBBbo...
  .....onbooooooooooobo...
  .....onbo.........obonnn
  .....onbo.........obooo.
  .....onboB.......Bobo...
  .....onbo.B.....B.obo...
  .....onbo..B...B..obonnn
  .....onbo...B.B...obooo.
  .....onbo....B....obo...
  .....onbo...B.B...obo...
  .....onbo..B...B..obonnn
  .....onbo.B.....B.obooo.
  .....onboB.......Bobo...
  .....onbo.........obo...
  .....onbo.........obonnn
  .....onbo.........obooo.
  .....onbo.........obo...
  .....onbo.........obo...
  .....onbo.........obonnn
  .....onbo.........obooo.
  .....onbo.........obo...
  .....onbo.........obo...
  ....oooooo.......ooooooo
  ....osssSo.......ossssss
  ....osssSo.......osssSSS
  ....oSSSSo.......oSSSSSS
  ....oooooo.......ooooooo
`);
const TOWER = recolor(sym(TOWER_HALF), { r: 'R', R: 'B' }, { top: 4, bottom: 14, left: 24 });

// ---------- plots, signs, fences ----------

const SIGN_BOARD = grid(`
  .oooooooooooooo.
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  onnnnnnnnnnnnnbo
  obbbbbbbbbbbbbBo
  .oooooooooooooo.
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  .....oooooo.....
`);

export const ICONS = {
  harbor: grid(`
    ...mm...
    ..m..m..
    .mmmmmm.
    ...mm...
    m..mm..m
    .mmmmmm.
  `),
};

const signFor = (icon) => stamp(SIGN_BOARD, icon, 4, 2);

const FENCE_POST = grid(`
  ................
  ................
  ................
  ......oooo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......onbo......
  ......oooo......
  ................
  ................
`);
const FENCE_RAIL_E = grid(`
  ................
  ................
  ................
  ................
  ................
  ..........oooooo
  ..........nnnnnn
  ..........oooooo
  ................
  ..........oooooo
  ..........bbbbbb
  ..........oooooo
  ................
  ................
  ................
  ................
`);
const FENCE_RAIL_W = mirror(FENCE_RAIL_E);
const FENCE_RAIL_N = grid(`
  ......n..b......
  ......n..b......
  ......n..b......
  ......n..b......
  ......n..b......
`);
const FENCE_RAIL_S = grid(`
  ......n..b......
  ......n..b......
`);

const STAKE = grid(`
  oo
  nb
  nb
  nb
  oo
`);

// ---------- building materials and small props ----------

const PLANKS = grid(`
  .oooooooooooooo.
  onnnnnnnnnnnnnbo
  oooooooooooooooo
  onnnnnnnnnnnnnbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
`);

const CRATE = grid(`
  oooooooooooooo
  onnnnnnnnnnnno
  onbbbbbbbbbbno
  onnnnnnnnnnnno
  oooooooooooooo
  onbbbbbbbbbbno
  onBBBBBBBBBBno
  onbbbbbbbbbbno
  onBBBBBBBBBBno
  onbbbbbbbbbbno
  oooooooooooooo
`);

const BARREL = grid(`
  ..oooooooo..
  .obnnnnnnbo.
  .onbbbbbbno.
  .oobbbbbboo.
  .oSSSSSSSSo.
  .obbbbbbbbo.
  .obBbbbbBbo.
  .oSSSSSSSSo.
  .obbbbbbbbo.
  ..oooooooo..
`);

const EASEL = grid(`
  ......oo......
  ..oooooooooo..
  ..owwwwwwwuo..
  ..owwwwwwuuo..
  ..owwwwwwwwo..
  ..ohhwwwwhho..
  ..oqqhhhhqqo..
  ..olqqqqqqlo..
  ..oooooooooo..
  ..oo..bo..oo..
  ..ob..bo..bo..
  ..onoooooonb..
  .ob..obo...bo.
  .ob..obo...bo.
  ob...obo....bo
  oo...ooo....oo
`);

// The crew's long workbench beside the camp: four places, each with its own bit of work.
const CREW_BENCH = (() => {
  const w = 64;
  const line = (edge, fill, right = fill) => edge + fill.repeat(w - 3) + right + edge;
  const legs = (ch) => {
    const row = [...'.'.repeat(w)];
    for (const x of [1, 30, 60]) { row[x] = 'o'; row[x + 1] = ch; row[x + 2] = 'o'; }
    return row.join('');
  };
  let rows = [
    ...Array.from({ length: 5 }, () => '.'.repeat(w)),
    `.${'o'.repeat(w - 2)}.`,
    line('o', 'n', 'b'),
    line('o', 'n', 'b'),
    'o'.repeat(w),
    line('o', 'b', 'B'),
    line('o', 'B'),
    'o'.repeat(w),
    legs('B'),
    legs('B'),
    legs('o'),
  ];
  const SCREEN = grid(`
    oooooo
    oSSSSo
    oSeeSo
    oSSSSo
    oooooo
    ..oo..
  `);
  const VICE = grid(`
    .oooo.
    .oSSo.
    ooSsoo
    oSSSSo
    oooooo
  `);
  const PAPERS = grid(`
    ooooooo.
    occcCCoo
    occcCoro
    ooooooo.
  `);
  const MUG = grid(`
    ooo.
    oroo
    oRoo
    ooo.
  `);
  rows = stamp(rows, SCREEN, 5, 0);
  rows = stamp(rows, VICE, 21, 1);
  rows = stamp(rows, PAPERS, 36, 2);
  rows = stamp(rows, MUG, 46, 2);
  rows = stamp(rows, SCREEN, 53, 0);
  return rows;
})();

// ---------- harbor ----------

const DOCK = grid(`
  obnnnnnnnnnnnnbo
  obbbbbbbbbbbbbbo
  oBBBBBBBBBBBBBBo
  ooooooooooooooo.
  obnnnnnnnnnnnnbo
  obbbbbbbbbbbbbbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
  obnnnnnnnnnnnnbo
  obbbbbbbbbbbbbbo
  oBBBBBBBBBBBBBBo
  .ooooooooooooooo
  obnnnnnnnnnnnnbo
  obbbbbbbbbbbbbbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
`);

const DOCK_POST = grid(`
  oooo
  onbo
  onbo
  obBo
  oBBo
  wffw
`);

const BOAT = grid(`
  ......oooooooooooooooooooo......
  ....oonnnnnnnnnnnnnnnnnnnnoo....
  ..oonnbbbbbbbbbbbbbbbbbbbbnnoo..
  .onnbbbboooooooooooooooobbbbnno.
  onbbbbooBBBBBBBBBBBBBBBBoobbbbno
  onbbbboBBBBBBonnnnoBBBBBBobbbbno
  onbbbboBBBBBBonnnnoBBBBBBobbbbno
  .onbbbooBBBBBBBBBBBBBBBBoobbbno.
  ..oonnbboooooooooooooooobbnnoo..
  ....ooeeeeeeeeeeeeeeeeeeeeoo....
  ......oooooooooooooooooooo......
`);

const LAMP_POST = grid(`
  ...oooo...
  ..oBBBBo..
  .ooooooo..
  .oucuuUo..
  .ouuuuUo..
  .oBBBBBo..
  ..oooooo..
  ....obo...
  ....obo...
  ....obo...
  ....obo...
  ....obo...
  ....obo...
  ....obo...
  ....obo...
  ....obo...
  ...ooooo..
`);

const FOG_PUFF = grid(`
  ............cccccc......................
  .........cccccccccccc.......cccc........
  ......ccccccccccccccccc..cccccccccc.....
  ....cccccccccccccccccccccccccccccccccc..
  ..cccccccccccccccccccccccccccccccccccccc
  .ccccccccccccccccccccccccccccccccccccccc
  cccccccccccccccccccccccccccccccccccccccc
  cccccccccccccccccccccccccccccccccccccccc
  .CCcccccccccccccccccccccccccccccccccccC.
  ...CCCCccccccccccccccccccccccccCCCCCC...
  ........CCCCCCCCCCCCCCCCCCCCCCCC........
`);

const SMOKE = grid(`
  .ss.
  sssS
  sSSS
  .SS.
`);

// ---------- registry ----------

export const SPRITES = {
  'milo.down': MILO.down,
  'milo.up': MILO.up,
  'milo.left': MILO.left,
  'milo.right': MILO.right,
  'milo.breath.down': [breathe(MILO.down[0], MILO.headSplit)],
  'milo.breath.up': [breathe(MILO.up[0], MILO.headSplit)],
  'milo.breath.left': [breathe(MILO.left[0], MILO.headSplit)],
  'milo.breath.right': [breathe(MILO.right[0], MILO.headSplit)],
  'claude.stand': [CLAUDE, breathe(CLAUDE, 10)],
  'claude.work': CREW_ART.claude.work,
  'codex.stand': [CODEX, breathe(CODEX, 10)],
  'codex.work': CREW_ART.codex.work,
  ...Object.fromEntries(HELPER_TINTS.flatMap((tint, i) => {
    const name = i === 0 ? 'helper' : `helper${i}`;
    return [
      [`${name}.stand`, [HELPER, breathe(HELPER, 13)].map((rows) => tinted(rows, tint))],
      [`${name}.work`, CREW_ART.helper.work.map((rows) => tinted(rows, tint))],
    ];
  })),
  'ollama.stand': [LLAMA, breathe(LLAMA, 10)],
  'ollama.work': CREW_ART.ollama.work,
  'jev.idle': CREW_ART.jev.idle,
  'whisper.idle': CREW_ART.whisper.idle,
  bubble: [BUBBLE],
  tree: [TREE, shiftRows(TREE, 1, 0, 20)],
  'tree.blossom': [TREE_BLOSSOM, shiftRows(TREE_BLOSSOM, 1, 0, 20)],
  pine: [PINE, shiftRows(PINE, 1, 0, 16)],
  bush: [BUSH],
  'bush.berry': [BUSH_BERRY],
  rock: [ROCK],
  stump: [STUMP],
  mushrooms: [MUSHROOMS],
  'flower.pink': [FLOWER_PINK],
  'flower.butter': [FLOWER_BUTTER],
  'flower.lavender': [FLOWER_LAVENDER],
  'flower.cream': [FLOWER_CREAM],
  tuft: [TUFT],
  'tuft.light': [TUFT_LIGHT],
  clover: [CLOVER],
  pebbles: [PEBBLES],
  lily: [LILY],
  'lily.flower': [LILY_FLOWER],
  reeds: [REEDS, shiftRows(REEDS, 1, 0, 3)],
  tent: [TENT],
  cabin: [CABIN],
  campfire: CAMPFIRE,
  'log.bench': [LOG_BENCH],
  woodpile: [WOODPILE],
  garden: [GARDEN],
  flagstone: [FLAGSTONE],
  flag: [FLAG_POLE, FLAG_WAVE],
  lantern: [LANTERN],
  tower: [TOWER],
  'sign.harbor': [signFor(ICONS.harbor)],
  'fence.post': [FENCE_POST],
  'fence.e': [FENCE_RAIL_E],
  'fence.w': [FENCE_RAIL_W],
  'fence.n': [FENCE_RAIL_N],
  'fence.s': [FENCE_RAIL_S],
  stake: [STAKE],
  planks: [PLANKS],
  crate: [CRATE],
  barrel: [BARREL],
  'crew.bench': [CREW_BENCH],
  easel: [EASEL],
  dock: [DOCK],
  'dock.post': [DOCK_POST],
  boat: [BOAT],
  'lamp.post': [LAMP_POST],
  fog: [FOG_PUFF],
  smoke: [SMOKE],
};

export function spriteSize(name) {
  const frames = SPRITES[name];
  if (!frames) throw new Error(`Unknown sprite ${name}`);
  return { w: frames[0][0].length, h: frames[0].length, frames: frames.length };
}

// ---------- browser: turn grids into canvases ----------

function hexToRgba(hex) {
  if (hex.startsWith('rgba')) {
    const [r, g, b, a] = hex.slice(5, -1).split(',').map((part) => Number(part.trim()));
    return [r, g, b, Math.round(a * 255)];
  }
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);
}

const RGBA = Object.fromEntries(Object.entries(PALETTE).map(([key, { hex }]) => [key, hexToRgba(hex)]));

export function rowsToImageData(rows, makeImageData) {
  const w = rows[0].length;
  const h = rows.length;
  const image = makeImageData(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const rgba = RGBA[row[x]];
      if (!rgba) continue;
      const i = (y * w + x) * 4;
      image.data[i] = rgba[0];
      image.data[i + 1] = rgba[1];
      image.data[i + 2] = rgba[2];
      image.data[i + 3] = rgba[3];
    }
  });
  return image;
}

export function rgbaOf(key) {
  return RGBA[key];
}

// Builds canvases for every sprite frame. `createCanvas(w, h)` must return a canvas.
export function buildAtlas(createCanvas) {
  const atlas = {};
  for (const [name, frames] of Object.entries(SPRITES)) {
    atlas[name] = frames.map((rows) => {
      const canvas = createCanvas(rows[0].length, rows.length);
      const ctx = canvas.getContext('2d');
      ctx.putImageData(rowsToImageData(rows, (w, h) => ctx.createImageData(w, h)), 0, 0);
      return canvas;
    });
  }
  return atlas;
}
