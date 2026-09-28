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

// ---------- the wilds (Phase 3) ----------
// Everything below keeps the vale's rules: soft ink outline, light from the top-left, the same
// palette. Sizes (w x h) are noted on each; frames of one sprite always share a size.

// Birch: a slim white trunk with dark marks rising into a crown of small, light leaf clumps, with
// drooping lobes either side of the fork. 22 x 32: the crown keeps its last column clear, so the
// sway (rows 0-17 one pixel right) never pushes its outline off the canvas.
const TREE_BIRCH = grid(`
  .........ooo..........
  .......oohhhoo........
  ......ohhhhqqqo.......
  .....ohhhhqqqqlo......
  .....ohhqqqqqlLo......
  ....ooLLqqqlLLhhoo....
  ..oohhhhLLlLhhhhqqo...
  .ohhhhqqqqLhhhqqqqqo..
  .ohhqqqqqLLLLqqqqlllo.
  ohhqqqqLLhhhqLqqlllLo.
  ohqqqqlhhhhqqqLllLLLo.
  .oqqLLlhhqqqqlLLLLLo..
  .oLLhhLLqqqllLhhhho...
  .ohhhqqqLqllLhhhqqqo..
  ohhhqqqqlllLhhhqqqqlo.
  ohqqqqlllLLLooqqqlllo.
  oqqqqllLLLooCooqlllLo.
  oqqlllLLLocCooqqllLLo.
  .olllLLLoocCo.olllLLo.
  ..ooLLLo.ocCo..oLLLo..
  ....ooo..ooCo...ooo...
  .........ocCo.........
  .........ocCo.........
  .........ocoo.........
  .........ocCo.........
  .........ooCo.........
  .........ocCo.........
  .........ocCo.........
  .........ocoo.........
  .........ocCo.........
  ........occCCo........
  ........oooooo........
`);

// Pine with snow on the tops of its tiers (lit side cream, shaded side foam). 18 x 25, like the pine.
const PINE_SNOW = stamp(PINE, grid(`
  ..................
  ........cf........
  ........cf........
  .......ccff.......
  .......cf.........
  ......c...........
  .....c............
  ..................
  ......ccf.........
  ....cccfff........
  ....cc............
  ...c..............
  ..................
  ....cccf..........
  ..cccccfff........
  ..ccc.............
  .cc...............
  .c................
`), 0, 0);

// Crag: a shoulder of mountain rock, two tiles wide, with moss on its tops. 32 x 27.
const CRAG = grid(`
  ...........ooooooooo............
  ..........occcchqqcco...........
  .........ocssssslqssco..........
  ........ossssssssssssco.........
  ........ossssssssssssszo........
  ........osSsssssssssszzo........
  ........osSSSSSSSSSSzzzo........
  ........osSSSSSSSSSSzzzooooo....
  ........osSSSSSSSSSSzooccqqco...
  ........osSSSSzSSSSSoccsslqsco..
  ....ooooooSSSSzSSSSosssssssssco.
  ...occqqccoSSzSSSSSosssssssssso.
  ..ocsslssscoSzSSSSSossssssssszzo
  .ocsssssssscozSSSSSosSSSSSSSzzzo
  ossssssssssszoSSSSSosSSSSSSSzzzo
  osssssssssszzozSSSSosSSSSSSSzzzo
  osSSSSSSSSzzzozSSSSosSSSzSSSzzzo
  osSSSSSSSSSzzoooooSosSSSzSSSzzzo
  osSSSSSSSSSzzochqcoosSSSzSSSzzzo
  osSSSzSSSSSzocsssscosSSSzSSSzzzo
  osSSSzSSSSSocsssssscoSSSSSSSzzzo
  osSSSSzSSSSossssssszzoSSSSSSzzzo
  osSSSSzSSSSosSSSSSzzzoSSSSSSzzzo
  osSSSSSSSSSosSSSSSSzzoSSSSSSzzzo
  ozzzzzzzzzzozzzzzzzzzozzzzzzzzzo
  ozzzzzzzzzzozzzzzzzzzozzzzzzzzzo
  .oooooooooooooooooooooooooooooo.
`);

// The same crag under snow: snowy tops that spill a little over the faces. 32 x 27.
const CRAG_SNOW = grid(`
  ...........ooooooooo............
  ..........occccccccco...........
  .........ocfffffffffco..........
  ........osfffffffffffco.........
  ........osffffffffffffzo........
  ........osffffffffffffzo........
  ........osffSfffSffffzzo........
  ........osSSSfSSSSSfzzzooooo....
  ........osSSSSSSSSSSzooccccco...
  ........osSSSSzSSSSSoccfffffco..
  ....ooooooSSSSzSSSSosffffffffco.
  ...occccccoSSzSSSSSosfffffffffo.
  ..ocffffffcoSzSSSSSosfffffffffzo
  .ocffffffffcozSSSSSosfSfffSSzzzo
  osffffffffffzoSSSSSosfSSSSSSzzzo
  osffffffffffzozSSSSosSSSSSSSzzzo
  osSfSfSfSSfzzozSSSSosSSSzSSSzzzo
  osSfSSSSSSSzzoooooSosSSSzSSSzzzo
  osSSSSSSSSSzzoccccoosSSSzSSSzzzo
  osSSSzSSSSSzocffffcosSSSzSSSzzzo
  osSSSzSSSSSocffffffcoSSSSSSSzzzo
  osSSSSzSSSSosfffffffzoSSSSSSzzzo
  osSSSSzSSSSosSSSffffzoSSSSSSzzzo
  osSSSSSSSSSosSSSSffzzoSSSSSSzzzo
  ozzzzzzzzzzozzzzzzzzzozzzzzzzzzo
  ozzzzzzzzzzozzzzzzzzzozzzzzzzzzo
  .oooooooooooooooooooooooooooooo.
`);

// Basalt: dark six-sided columns of different heights, flat tops catching the light. 16 x 26.
function basaltColumn(h) {
  return [
    '.ooooo.',
    'osssSSo',
    'oSSSSzo',
    ...Array.from({ length: h - 4 }, (_, i) => (i % 6 === 4 ? 'ozSozzo' : 'ozSozzo'.replace('ozSo', 'ozSS'))),
    'ooooooo',
  ];
}
const BASALT_COLUMN = [[5, 0, 25], [9, 6, 19], [0, 9, 16], [5, 16, 9]].reduce(
  (rows, [x, y, h]) => stamp(rows, basaltColumn(h), x, y),
  Array.from({ length: 25 }, () => '.'.repeat(16)),
);
const ROCK_BASALT = stamp(recolor(ROCK, { c: 's', s: 'S', S: 'z' }), grid(`
  .....o..
  ....oz..
  ...o....
`), 2, 3);

// A standing stone on the Dicing Downs: a stone die sunk in the turf, its corners worn round, one
// pip on top and five on its face, moss at its foot. Straight on, like the vale's crate. 16 x 14.
const DICE_STONE = grid(`
  ...oooooooooo...
  ..occcccccccCo..
  .occcsscoosCCCo.
  .oCCCCCCCCCCCCo.
  .oooooooooooooo.
  .ossssssssssSSo.
  .osoossssssooSo.
  .ossssssssssSSo.
  .osssssoossssSo.
  .ossssssssssSSo.
  .osoossssssooSo.
  .oqlsssssssSSSo.
  GolqlSSSSSSSSzoG
  .GooooooooooooG.
`);

// A region's landmark: a tall standing stone with a lantern carved into it. 14 x 27.
const LANDMARK_STONE = grid(`
  ....oooooo....
  ...occcccco...
  ..ocssssssco..
  ..ocsssssszzo.
  ..osSSSSSzzzo.
  ..osSSSSSSzzo.
  ..osSSSSSSzzo.
  ..osSSzSSSzzo.
  ..osSzzzSSzzo.
  ..osSzuzSSzzo.
  ..osSzuzSSzzo.
  ..osSzzzSSzzo.
  ..osSSSSSSzzo.
  ..osSSSSSSzzo.
  .osSzSzSzSzzo.
  .osSSSSSSSzzo.
  .osSSSSSSSzzo.
  .osSSSSSqSzzo.
  .osSSSSSSSzzo.
  .osqSSSSSSzzo.
  .oslqSSSSSzzo.
  .osSSSSSSSzzo.
  .oqSSSSSSSzzo.
  .olqlSSSSSzzo.
  .oLlzzzzzzzzo.
  .ozzzzzzzzzzo.
  ..oooooooooo..
`);

// Maker ruins: a broken wall with an arched doorway, moss, and fallen blocks. 32 x 22.
const RUIN = grid(`
  ...ooo.o........................
  ..ocqqoqo.......................
  .ochlscsco......................
  ocqSssssscooo...................
  oqSSSSSSSsoqlo..................
  olssssSssscssco.................
  oLssssSsssssSsco.....o..........
  oSSSSSSSSSSSSSsco..ooqo.........
  olsSsssssSsszzsso.ocqsloo.......
  oLsSsssssSszoozSo.ossSscco......
  oSSSSSSSSSSo..oSo.oSSSSssco.....
  osssssSssszo..ozo.osssssSsco....
  osssssSssszo...ococsssssSsso....
  oSSSSSSSSSzo...osqsSSSSSSSSo....
  ossSsssssSzo...osssssSsssssqo...
  ossSsssssSzo...osssssSssssssco..
  ooooooSSSSzo...oSooqqooSSSSSsco.
  oocccoSssszo...osochccosSsssssco
  oossSozSSSzo...oSosssSoSzSSSSSzo
  ooSSzozzzzzo...ozoSSSzozzzzzzzzo
  .oooooooooooooooooooooooooooooo.
`);

// A cave in a grassy hillside. 32 x 19.
const CAVE = grid(`
  ............ooooooooo...........
  .........ooohhhhhhhhhoo.........
  .......oohhhqqqqqqqqqhhooo......
  ......ohhqqqqqqqqqqqqqqhhho.....
  .....ohqqqqqlqqqqqqqqqqqqqho....
  ....ohqqqqllqqqqqqqqqqlqqqqho...
  ...ohqqqqqqqqqqqqqqqqllqqqqqho..
  ..ohqqqqlqqqqqqqqqqqqqqqqqqqqo..
  ..osqqqqqqqqqqqqqqqqqqqqqqqqqho.
  .osSSqqqqqqqqqqqqqqqqqqqqqqqsSSo
  .osSSLlLSSSSzoooooozSSSSLlLSSSSo
  .osSSSLSSSSzoooooooozSSSSSSSSSSo
  osSSSSSSSSzoooooooooozSSSSSSSSSo
  osSSSzSSSzoooooooooooozSSSzSSSSo
  osSSSSzSSzoooooooooooozSSSSzSSSo
  osSSSSSSSzoooooooooooozSSSSSSSSo
  ozzzzzzzzzoooooooooooozzzzzzzzzo
  ozzzzzzzzzoooooooooooozzzzzzzzzo
  .oooooooooooooooooooooooooooooo.
`);

// A roadside lantern on a post, sleeping (cold glass) and lit. 16 x 26.
const LANTERN_POST_BASE = grid(`
  .....oooo.......
  ....orrrRo......
  ...oRRRRRRo.....
  ....oooooo......
  .....onbo.......
  .....onbooooooo.
  .....onbnnnnnbo.
  .....onbooooooo.
  .....onbo...o...
  .....onbo..ooo..
  .....onbo.oBBBo.
  .....onbo.oXXXo.
  .....onbo.oXXXo.
  .....onbo.oXXXo.
  .....onbo.oBBBo.
  .....onbo..ooo..
  .....onbo.......
  .....orRo.......
  ....roRRo.......
  ....ronbo.......
  .....onbo.......
  .....onbo.......
  .....onbo.......
  ....oonboo......
  ...ossssSSo.....
  ...oooooooo.....
`);
const litGlass = (rows, panes) => rows.map((row, y) => (y >= 11 && y <= 13 ? row.replace('XXX', panes[y - 11]) : row));
const LANTERN_POST = [
  litGlass(LANTERN_POST_BASE, ['sSz', 'SSz', 'Szz']),
  litGlass(LANTERN_POST_BASE, ['ucU', 'uuU', 'uUU']),
];

// Chests: closed and open, in wood with honey bands. The mimic is the same chest with a tell. 16 x 14.
const CHEST_BODY = grid(`
  .ooooooUUoooooo.
  .onbUbbuUbbUbBo.
  .onbUbbYYbbUbBo.
  .onbUbbbbbbUbBo.
  .oBBYBBBBBBYBBo.
  .oooooooooooooo.
`);
const CHEST_CLOSED = [
  '................',
  '................',
  '................',
  '................',
  ...grid(`
    ..oooooooooooo..
    .onnUnnnnnnUnno.
    .onbUbbbbbbUbbo.
    .oBBYBBBBBBYBBo.
  `),
  ...CHEST_BODY,
];
const CHEST_OPEN = [
  ...grid(`
    ..oooooooooooo..
    .oBmmmmmmmmmmBo.
    .oBmmmmmmmmmmBo.
    .onnUnnnnnnUnno.
    .oooooooooooooo.
    .omuuUucuuUuumo.
    .omUuuUuuUuuUmo.
    .onnnnnnnnnnnbo.
  `),
  ...CHEST_BODY,
];
const MIMIC_CLOSED = stamp(CHEST_CLOSED, grid(`
  k
  K
`), 10, 8);
const MIMIC_AWAKE = [
  ...grid(`
    ..oooooooooooo..
    .onnUccnnccUnno.
    .onbUcobbcoUbbo.
    .oBBYBBBBBBYBBo.
    .ocQQQQQQQQQQco.
    .oQQQkkkkKQQQQo.
    .oQQkkkkkkKQQQo.
    .ocQQkkkkKQQQco.
    .oooooookKooooo.
    .onbUbbkKbbUbBo.
    .onbUbbYYbbUbBo.
    .onbUbbbbbbUbBo.
    .oBBYBBBBBBYBBo.
    .oooooooooooooo.
  `),
];

// A note from the Old Company, pinned to a stake by the road. 9 x 12.
const NOTE = grid(`
  ..ooooo..
  .occrccCo
  .ocSSScCo
  .occcccCo
  .ocSSccCo
  .occcccCo
  .ocSSSCCo
  .ooooooo.
  ...onbo..
  ...onbo..
  ...onbo..
  ...oooo..
`);

// A hamlet home: thatch, plaster and timber, a lit window either side of the door. 40 x 34.
const HAMLET = grid(`
  ...........................oooooo.......
  ...........................osssSo.......
  ..........ooooooooooooooooooSSSSo.......
  ........oYYYYYYYYYYYYYYYYYYosSsSo.......
  ......ouuYuuYuuYuuYuuYuuYuUosssSoo......
  ....ouYuuYuuYuuYuuYuuYuuYuUoSsSSoYYo....
  ...ouYuUYUuYuUYUuYuUYUUYUUYooooooYUYo...
  ..ouUYUuYuUYUuYuUYUuYUUYUUYUUYYUYYUYYo..
  .oYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYYUo.
  .oUUYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYo.
  .oUUYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYo.
  .oUUYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYo.
  .oUYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYYo.
  .oUYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYYo.
  .oUYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYYo.
  .oYUUYUUYUUYUUYUUYUUYUUYUUYUUYYUYYUYYUo.
  .YoYoYoYoYoYoYoYoYoYoYoYoYoYoYoYoYoYoYo.
  ..oBCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCBo..
  ..oBCccccccccBCcccccccccccBCccccccccBo..
  ..oBCcoooooooBCcccccccccccBCcoooooooBo..
  ..oBCconnnnnoBCcccccccccccBCconnnnnoBo..
  ..oBCconcunuoBCcooooooooccBCconuunuoBo..
  ..oBCconuunUoBCconnnnnnoccBCconuunUoBo..
  ..oBCconnnnnoBCconBbbBnoccBCconnnnnoBo..
  ..oBCcoooooooBCconBbbBnoccBCcoooooooBo..
  ..oBCcokLkkLoBCconBbbBnoccBCcokLkkLoBo..
  ..oBCcobbbbboBCconBbbBnoccBCcobbbbboBo..
  ..oBCcoooooooBCconBbbunoccBCcoooooooBo..
  ..oBCccccccccBCconBbbBnoccBCccccccccBo..
  ..oBCccccccccBCconBbbBnoccBCccccccccBo..
  ..oBCccccccccBCconBbbBnoccBCccccccccBo..
  ..ossssssSssssssnnnnnnnnssssssSsssssso..
  ..oSSSSSSSSSSSSSbbbbbbbbSSSSSSSSSSSSSo..
  ..oooooooooooooooooooooooooooooooooooo..
`);

// Tamsin Wick, waving, on a plinth. Her left hand was never carved (she insisted), and the carver's
// chisel still lies on the plinth. 20 x 32.
const STATUE = grid(`
  .........oooo.......
  ........ocsSSo......
  .o.o...oooooooo.....
  ocsSo.ocsSSSSSSo....
  osSSoocsSSSSSSSSo...
  .oSo.osSSsssSSSSo...
  .osSooSscssssSSSo...
  .osSooSszsssszSSo...
  .osSooSszsssszsSo...
  .osSo.osssssssSo....
  ..osSo.oooooooo.....
  ...osSooSSSSSSo.....
  ....osoczzzzzzSoo...
  ......osssssSzSSoo..
  ......ocssssSzSSSzo.
  ......osssssSSSSSzo.
  ......oSSSSSSSzSSzo.
  ......osssssSSzoooo.
  .....ocsssssSSSzo...
  .....osssssSSSSzo...
  .....osSssSsSSSzo...
  .....ozzzzzzzzzzo...
  ......oooooooooo....
  .......oSSo.oSzo....
  .......oooo.oooo....
  oooooooooooooooooooo
  occcccccccccccooncSo
  osssssssssssssssSSzo
  oSSSSSSSSSSSSSSSSSzo
  oSSSzzzzzzzzzzSSSSzo
  ozzzzzzzzzzzzzzzzzzo
  oooooooooooooooooooo
`);

// Gathering spots: an ore seam (14 x 8), a herb patch (12 x 8) and a fishing ripple on open water
// (16 x 6, two frames of the ring spreading, with a fish shadow in it).
const ORE_NODE = stamp(ROCK, grid(`
  ..............
  ..............
  ....Uc........
  ...YU....uc...
  .........YU...
  ......Uc......
  .....YY.......
`), 0, 0);
const HERBS = grid(`
  ...v....v...
  ..vVv..vVv..
  ...V.qq.V...
  .qq.lqqL.qq.
  oqlqlLlqlLqo
  olLlLlLLlLlo
  .oLLMLLMLLo.
  ..oooooooo..
`);
const FISHING_SPOT = [
  grid(`
    ................
    .....ffffff.....
    ...ff..WW..ff...
    ...ff...W..ff...
    .....ffffff.....
    ................
  `),
  grid(`
    ....ffffffff....
    ..ff........ff..
    .f.....WW.....f.
    .f......W.....f.
    ..ff........ff..
    ....ffffffff....
  `),
];

// Thicket: bramble and bush, dense and as tall as Milo, two variants (frames) to mix along a line.
// 20 x 20, so neighbours on a 16 px ring overlap and the line reads as one hedge.
const THICKET = [
  grid(`
    .o.......ooooo......
    oBo.ooo.oqqqqqo...o.
    omooqqqoqqqqlllo.oBo
    .oqqqqlqqllllMMMoomo
    .oqqlllqllllMqqqqqo.
    oqllllllllllqqqqlllo
    oqlllllllllLqlllllLo
    ollMMMMqllMLlllllLLo
    .oMqqqqMMMqMMMMMMMMo
    .oqqqqlMqqqqMVqqqqMo
    oqqlllMqqqllqqqqllo.
    oqllllVqllllqllllllo
    olllllqlllllllllllLo
    ollllllllllllllllLLo
    olllllllllllllllLLLo
    ollllLlllllLlllLLLMo
    olllLLllllLclllLLMMo
    .olLLLqllLLLqlLLLMo.
    ..ooLMMqLLLLMMLLMo..
    ....ooooooooooooo...
  `),
  grid(`
    .....oooooo.......o.
    ...ooqqqqqqo.....oBo
    ..oBqqqqqllloooooomo
    .omoqllllllMqqqqqmo.
    .omMMMlllllqqqqlllo.
    ..oqqqMllLLqlllllLo.
    .oqqqlllLLLlllllLLo.
    oqqllllMLLMlllMMMMo.
    oqlllMMMMVMMlMqqqqo.
    ollMMqqqqqqlMqqqlllo
    olMqqqqqqllMMMMMllLo
    .oqqqlllllMqqqqqMlLo
    .oqllclllMqqqqqllMLo
    oqlllllllqqlllVllLMo
    oqlllllllqllllllLLMo
    .ollllllLllllllLLLo.
    .olllllLLlllllLLLMo.
    ..ollLLLLqlllLLLMMo.
    ...oLLLLMMqlLLLMMo..
    ....ooooooooooooo...
  `),
];

// ---------- the Stockade (tier 2) ----------

// Palisade pieces compose by mask exactly like the fences: every piece is 16 x 36 and is stamped at
// (0, 0) into a blank 16 x 36 cell, in the order n, w, e, post, s. The cell's bottom row is the
// tile's bottom edge, so the logs stand about a tile and a half above their tile.
//   post: the log on the tile's centre (cols 4-12)
//   w, e: the halves of the log that stands on the tile's west or east edge; the w half's outline
//         is the post's, and the e half is closed by the neighbour's w half
//   n:    two logs side by side half a tile north (the east one in shade), behind the post, so a
//         north-south run is a staggered double row as heavy as the east-west wall. They stand
//         23 and 25 px tall, so the cell's top two rows stay clear: the tile south of a side
//         gate's jamb never reaches Milo standing in the gateway.
//   s:    a short stake at the foot of the post, where a north-south run carries on south (the
//         next tile's n logs cover it, so a run shows no seam)
// palisade.jamb is not a piece: it's drawn as it is on the wall tile just south of the west and
// east gates, in place of the palisade there. See PALISADE_JAMB.
const LOG_TIP = grid(`
  ....o....
  ...ono...
  ..onnbo..
  .onnbbBo.
`);
const LOG_BARK = ['onbbbbBBo', 'onbbbbBBo', 'onbmbbBBo', 'onbbbbBBo', 'onbbbbBmo', 'onbbbbBBo', 'onbbbbBBo'];
// A sharpened log h px tall, bound with a rope `rope` px above its foot.
function palisadeLog(h, seed = 0, rope = 9) {
  const body = Array.from({ length: h - LOG_TIP.length - 1 }, (_, i) => LOG_BARK[(i + seed) % LOG_BARK.length]);
  body[body.length - rope] = 'ommmmmmmo';
  body[body.length - rope + 1] = 'onBBBBBBo';
  return [...LOG_TIP, ...body, 'ooooooooo'];
}
// Stamp a log into rows with its foot on row `foot`.
const logAt = (rows, x, foot, h, seed, rope) => stamp(rows, palisadeLog(h, seed, rope), x, foot - h + 1);
const inShade = (rows) => recolor(rows, { n: 'b', b: 'B', B: 'm' });
const blankRows = (w, h) => Array.from({ length: h }, () => '.'.repeat(w));
const PALISADE_LOGS = [[0, 11, 25, 3], [8, 8, 28, 0], [16, 11, 25, 3]].reduce(
  (rows, [x, y, h, seed]) => stamp(rows, palisadeLog(h, seed), x, y),
  Array.from({ length: 36 }, () => '.'.repeat(24)),
); // cols 0-23 here are cols -4..19 of the tile
const logCols = (from, to, skip = () => false) => PALISADE_LOGS.map((row, y) => [...'.'.repeat(16)]
  .map((_, x) => (x + 4 >= from && x + 4 <= to && !skip(x, y) ? row[x + 4] : '.')).join(''));
const PALISADE_POST = logCols(8, 16);
const PALISADE_W = logCols(4, 7);
const PALISADE_E = logCols(16, 19);
const PALISADE_N = logAt(inShade(logAt(blankRows(16, 36), 7, 27, 25, 5)), 0, 27, 23, 2);
// The jamb: the wall cut down where it meets a west or east gate, three short logs lashed
// together, so the wall ends cleanly and Milo stays in view in the gateway. It stands on its
// tile's bottom edge and rises no more than 2 px above the tile, clear of Milo's feet on the
// gate tile north of it. 16 x 18.
const PALISADE_JAMB = logAt(logAt(inShade(logAt(blankRows(16, 18), 7, 15, 14, 5, 6)), 0, 15, 12, 2, 6), 4, 17, 18, 0, 7);
const PALISADE_S = [
  ...Array.from({ length: 30 }, () => '.'.repeat(16)),
  ...grid(`
    ......oo........
    .....onbo.......
    .....onBo.......
    .....omBo.......
    .....onBo.......
    ....oooooo......
  `),
];

// The gatehouse: two stout dark-timber posts, a lintel under a little shingle roof, and a lantern
// hanging in the opening, so Milo walks under it. 32 x 48, anchored on the gate tile.
//   frame 0: facing you, for the gates in the north and south walls (n, sw). The posts stand on
//            the edges of the gate tile and the whole tile between them is open.
//   frame 1: end-on, for the gates in the west and east walls (w, e): the north post carrying a
//            little shingle roof seen from its gable end, with the lantern hanging under it over
//            the gateway. Draw it with dy = -15 so it stands on the gate's north edge and sorts
//            behind Milo; everything stays above his head (rows 0-40), and palisade.jamb closes
//            the south side low enough that he stays in view.
const GATE_ROOF = recolor(sym(grid(`
  ...........ooooo
  .........oorrrrr
  .......oorrRrrrr
  .....oorrrrrrrRr
  ...oorrRrrrrrrrr
  .oorrrrrrrRrrrrr
  oRRRRRRRRRRRRRRR
  oooooooooooooooo
`)), { r: 'R', R: 'Q' }, { top: 1, bottom: 6, left: 16 });
const GATE_POST_ROW = 'obBBmo';
const GATE_FRONT = (() => {
  const w = 32;
  const blank = '.'.repeat(w);
  let rows = Array.from({ length: 48 }, () => blank);
  const postsAt = (y, row) => { rows[y] = `...${row}..............${row}...`; };
  for (let y = 12; y <= 44; y += 1) postsAt(y, y % 11 === 6 ? 'omBBmo' : GATE_POST_ROW);
  rows[45] = '..oobBBmoo............oobBBmoo..';
  rows[46] = '..ossssSSo............ossssSSo..';
  rows[47] = '..oooooooo............oooooooo..';
  rows = stamp(rows, GATE_ROOF, 0, 2);
  rows = stamp(rows, [
    `.o${'o'.repeat(28)}o.`,
    `.on${'n'.repeat(26)}bo.`,
    `.ob${'b'.repeat(26)}Bo.`,
    `.o${'o'.repeat(28)}o.`,
  ], 0, 9);
  // braces from each post up to the lintel, and the lantern on its hook
  rows = stamp(rows, grid(`
    .........BBo...oo...oBB.........
    .........Bo..oBBBBo..oB.........
    .........o...oucuUo...o.........
    .............ouuuUo.............
    .............oBBBBo.............
    ..............oooo..............
  `), 0, 13);
  return rows;
})();
const GATE_SIDE = (() => {
  let rows = Array.from({ length: 48 }, () => '.'.repeat(32));
  for (let y = 14; y <= 44; y += 1) rows[y] = `.............${y % 11 === 6 ? 'omBBmo' : GATE_POST_ROW}.............`;
  rows[45] = '...........ooobBBmooo...........';
  rows[46] = '...........osssssSSSo...........';
  rows[47] = '...........ooooooooo............';
  // the back gable's peak, both slopes running toward you (courses lit on the west, shaded on
  // the east), the planked front gable, and the lantern on its hook
  return stamp(rows, grid(`
    .........oooo.........
    .......oorrRRoo.......
    .....oorrrrRRRRoo.....
    ...oorrRrrrRRQRRRoo...
    .oorrrrRrrrRRQRRRRRoo.
    orrrRrrRrrrRRQRRRQRRRo
    orrrRrrRrrrRRQRRRQRRRo
    orrrRrrRrrrRRQRRRQRRRo
    orrrRrrRrrrRRQRRRQRRRo
    orrrRrrRrrrRRQRRRQRRRo
    orrrRrrRroooRQRRRQRRRo
    orrrRrrooBnnoooRRQRRRo
    orrrRoonnnnnbbBooQRRRo
    orroonnnnnnnbbbBBooRRo
    ooonnnnnnnnnbbbBBBBooo
    oRRRRRRRRRRRQQQQQQQQQo
    oooooooooooooooooooooo
    .........oBBo.........
    ........oucuUo........
    ........ouuuUo........
    ........oBBBBo........
    .........oooo.........
  `), 5, 14);
})();
const GATEHOUSE = [GATE_FRONT, GATE_SIDE];

// The Gate Bell: a brass bell under a little roof, in a timber frame, with a pull rope. 16 x 24.
const GATE_BELL = grid(`
  ....oooooooo....
  ..oorrrrrrrroo..
  .orrRrrrRrrrRro.
  oRRRRRRRRRRRRRRo
  oooooooooooooooo
  onnnnnnnnnnnnnbo
  oBBBBBBBBBBBBBBo
  oooooooooooooooo
  onbo...oo...onbo
  onbo..ouUo..onbo
  onbo.oucuUo.onbo
  onbo.ouuuUo.onbo
  onbo.ouuUUo.onbo
  onbooUUUUYYoonbo
  onbo.oooooo.onbo
  onbo....n...onbo
  onbo....n...onbo
  onbo....n...onbo
  onbo....r...onbo
  onbo....R...onbo
  onbo........onbo
  onbo........onbo
  osSo........osSo
  oooo........oooo
`);

// The War Table: a sturdy table with the frontier map pinned out on it. 32 x 18.
const WAR_TABLE = grid(`
  ....oooooooooooooooooooooooo....
  ...occcccccccccccccccccccccCo...
  ..occwwwccclllccccCccccwwwwCCo..
  ..ocwwwccclLllccccccrccccwwwCo..
  .occwwcccclllLlcccccccccccwwCCo.
  .occcccccccllllccceccccccccccCo.
  .occccrcccccccccccccccclllcccCo.
  .occccccccccccccccccccllLlcccCo.
  ooooooooooooooooooooooooooooooo.
  onnnnnnnnnnnnnnnnnnnnnnnnnnnnbo.
  oBBBBBBBBBBBBBBBBBBBBBBBBBBBBBo.
  ooooooooooooooooooooooooooooooo.
  .onbo..onbo..........onbo..onbo.
  .onbo..onbo..........onbo..onbo.
  .onbo..onbo..........onbo..onbo.
  .onbo..onbo..........onbo..onbo.
  .omBo..omBo..........omBo..omBo.
  .oooo..oooo..........oooo..oooo.
`);

// A Hearth banner on a pole: clay cloth with a honey lantern, two frames of a slow sway. 12 x 30.
const BANNER_CLOTH = grid(`
  ..orrrrrRo..
  ..orrrrrRo..
  ..orrouoRo..
  ..orroucoo..
  ..orouuUoo..
  ..orouUUoo..
  ..orrooooo..
  ..orrrrrRo..
  ..orrrrrRo..
  ..orrrrrRo..
  ..orro.orRo.
  ..oro...oRo.
  ..oo.....oo.
`);
const BANNER_POLE = grid(`
  .....oo.....
  ....ouUo....
  .....oo.....
  .ooooooooooo
  .onnnnnnnnbo
  .ooooooooooo
`);
const BANNER = [0, 1].map((sway) => {
  let rows = Array.from({ length: 30 }, (_, y) => (y >= 6 ? '....onbo....' : '.'.repeat(12)));
  rows = stamp(rows, BANNER_POLE, 0, 0);
  rows = stamp(rows, shiftRows(BANNER_CLOTH, sway, 7, 13), 0, 6);
  rows[28] = '...oonboo...';
  rows[29] = '...oooooo...';
  return rows;
});

// A bridge tile for the wilds, planks running north-south between two rails; it tiles east-west. 16 x 16.
const BRIDGE_H = grid(`
  oooooooooooooooo
  nnnnnnnnnnnnnnnn
  bbbbbbbbbbbbbbbb
  oooooooooooooooo
  onbbonbbonbbonbb
  onbbonbBonbbonbb
  onbbonbbonbbonbB
  onbBonbbonbbonbb
  onbbonbbonBbonbb
  onbbonbbonbbonbb
  onbbonbBonbbonbb
  oooooooooooooooo
  nnnnnnnnnnnnnnnn
  bbbbbbbbbbbbbbbb
  BBBBBBBBBBBBBBBB
  oooooooooooooooo
`);

// ---------- Elsewhere ----------

// The way home: a doorway torn in the page, cream and honey light spilling onto the floor. 18 x 26.
const EXIT_DOOR = grid(`
  ......oooooo......
  .....occCCCco.....
  ....oCccccccCo....
  ...oCuccccccuCo...
  ...oCuccccccuCo...
  ..oCuuccccccuuco..
  ..oCCuccccccuuco..
  ..ocuuccccccuuco..
  .oCUuuccccccuuUCo.
  ..ocuuccccccuCCo..
  ..oCuuccccccuuco..
  .oCUuuccccccuuUco.
  ..oCuuccccccuuCo..
  ..oCuuccccccuuCo..
  ..oCuuccccccuuco..
  ..oCuuccccccuuco..
  .ocUuuccccccuuUCo.
  ..ooCccccccccCCo..
  .occuccccccccucco.
  .ocUuccccccccuUCo.
  .oCCCCCCCCCCCCCCo.
  ...ucuucucuucuc...
  ..u.ucuucuucuu.u..
  ....u.ucu.ucu.u...
  ..u...u.u.u.u...u.
  ......u.....u.....
`);

// A curio on a stone pedestal: a softly glowing orb with a spark or two. 12 x 18.
const CURIO = grid(`
  ......c.....
  ..c...c.....
  ....ooooc...
  ...ocvvVo...
  ..ocvvvvVo..
  ..ovvvvVVo..
  ..ovvvVVVo..
  ...oVVVVo...
  ....oooo....
  ..oooooooo..
  ..occccccSo.
  ..oSSSSSSzo.
  ...osssSo...
  ...ossSSo...
  ...ossSSo...
  ..ooooooooo.
  ..osssssSSo.
  ..oooooooo..
`);

// ---------- echoes: small calm signs that float over a place in the vale (10 x 10) ----------

export const ECHO_ICONS = {
  // Nocturne: a moon
  moon: grid(`
    ...oooo...
    ..ouuUUo..
    .ouuooo...
    .ouo......
    ouuo......
    ouUo......
    ouUUo.....
    .oUUUoooo.
    ..ooUUUUo.
    ....oooo..
  `),
  // Gothic: a door knocker
  knocker: grid(`
    ...oooo...
    ..osssSo..
    ..oSzzSo..
    ...oSSo...
    ..oosSoo..
    .osSooSSo.
    .oSo..oSo.
    .oSo..oSo.
    ..oSSSSo..
    ...oooo...
  `),
  // Neon: a spark
  spark: grid(`
    ....o.....
    ...oeo....
    ...oeo....
    .ooecEoo..
    oeecccEEo.
    .ooEcEoo..
    ...oEo....
    ...oEo....
    ....o.....
    ..........
  `),
  // Starlight: a star
  star: grid(`
    ....oo....
    ...ouUo...
    ...ouUo...
    oooouUoooo
    ouuucUUUUo
    .ouuuUUUo.
    ..ouuUUo..
    .ouUooUUo.
    .oUo..oUo.
    .oo....oo.
  `),
  // The story rift: a crack with light inside
  crack: grid(`
    .....o....
    ....ovo...
    ....ocvo..
    ...ovco...
    ..ovcvo...
    ...ovcvo..
    ....ovco..
    ...ovco...
    ...ovo....
    ....o.....
  `),
};

// ---------- Milo chops (16 x 20, headSplit 11): axe up, then down into the wood ----------

const CHOP_PATCHES = {
  // right: wound up behind the head, then swung level into the trunk low in front: both hands on a
  // wooden handle, and a flared steel head (outlined in ink) whose bright edge bites at his reach
  right: [
    grid(`
      .oooo...........
      osSSno..........
      ocSSno..........
      osSSno..........
      .ooono..........
      ....n...........
      ....n...........
      ....n...........
      ....n...........
      ....n...........
      ....n...........
      ...otto.........
      ...otto.........
    `),
    grid(`
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
      ................
      ................
      ................
      ..............oo
      .......U.....oSc
      ........ttBBBzSc
      .............zSc
      .............oSc
      ..............oo
    `),
  ],
  down: [
    grid(`
      .oooo...........
      osSSno..........
      ocSSno..........
      osSSno..........
      .ooono..........
      ....n...........
      ....n...........
      ....n...........
      ....n...........
      ....n...........
      ....n...........
      ...otto.........
      ...otto.........
    `),
    // struck down by his right side, where the tree in front of him leaves the axe in sight
    grid(`
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
      ................
      ................
      ................
      ................
      ..........tt....
      ..U.......ttBo..
      ............oBo.
      ...........ozSSo
      ...........ozSSo
      ...........occco
    `),
  ],
  // up: raised over the shoulder, then the blade bites the wood above his head
  up: [
    grid(`
      ...........oooo.
      ..........onSSso
      ..........onSSco
      ..........onSSso
      ..........onooo.
      ...........n....
      ...........n....
      ...........n....
      ...........n....
      ...........n....
      ...........n....
      .........otto...
      .........otto...
    `),
    // the handle up the back of his head, the head over it, its edge in the trunk behind him
    grid(`
      ....occccco.....
      ....ozSSSzo.....
      .....oonoo......
      .......n........
      .......n........
      .......n........
      .......n........
      ................
      ................
      ................
      ................
      ..oorrrrrrrroo..
      .otoUbbbbbbUoto.
    `),
  ],
};
// A small burst of wood chips flies from where the blade bites (strike frames only), each chip a
// pixel on its own, clear of the axe. They go behind Milo: a chip only lands on a transparent pixel,
// so it never covers him, and none touches his head, so none reads as a speck on his hair.
const CHOP_CHIPS = {
  right: grid(`
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
    ................
    ...............c
    ................
    ................
    ................
    ................
    ................
    ................
    ................
    ...........b.n..
  `),
  down: grid(`
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
    ................
    ...............b
    ................
    ................
    ................
    ................
    n...............
    ................
    .c..............
  `),
  up: grid(`
    .n............b.
    c..............c
  `),
};
const underlay = (rows, patch) => rows.map((row, y) => [...row].map((ch, x) => (ch === '.' && patch[y] && patch[y][x] && patch[y][x] !== '.' ? patch[y][x] : ch)).join(''));
const MILO_CHOP = Object.fromEntries(['right', 'down', 'up'].map((dir) => [dir, CHOP_PATCHES[dir].map((patch, i) => {
  const rows = stamp(MILO[dir][0], patch, 0, 0);
  return i === 1 ? underlay(rows, CHOP_CHIPS[dir]) : rows;
})]));
MILO_CHOP.left = MILO_CHOP.right.map(mirror);

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
  // the wilds
  'tree.birch': [TREE_BIRCH, shiftRows(TREE_BIRCH, 1, 0, 18)],
  'pine.snow': [PINE_SNOW, shiftRows(PINE_SNOW, 1, 0, 16)],
  crag: [CRAG],
  'crag.snow': [CRAG_SNOW],
  'basalt.column': [BASALT_COLUMN],
  'rock.basalt': [ROCK_BASALT],
  'dice.stone': [DICE_STONE],
  'lantern.post': LANTERN_POST, // [sleeping, lit]
  ruin: [RUIN],
  cave: [CAVE],
  chest: [CHEST_CLOSED, CHEST_OPEN],
  'chest.mimic': [MIMIC_CLOSED, MIMIC_AWAKE],
  note: [NOTE],
  hamlet: [HAMLET],
  statue: [STATUE],
  'landmark.stone': [LANDMARK_STONE],
  'ore.node': [ORE_NODE],
  herbs: [HERBS],
  'fishing.spot': FISHING_SPOT,
  thicket: THICKET, // two variants: pick one per tile
  // the Stockade
  'palisade.post': [PALISADE_POST],
  'palisade.n': [PALISADE_N],
  'palisade.s': [PALISADE_S],
  'palisade.e': [PALISADE_E],
  'palisade.w': [PALISADE_W],
  'palisade.jamb': [PALISADE_JAMB], // drawn as it is, on the wall tile just south of the w and e gates
  gatehouse: GATEHOUSE, // [facing you (n, sw gates), end-on (w, e gates, drawn at dy -15)]
  'gate.bell': [GATE_BELL],
  'war.table': [WAR_TABLE],
  banner: BANNER,
  'bridge.h': [BRIDGE_H],
  // Elsewhere
  'exit.door': [EXIT_DOOR],
  curio: [CURIO],
  // echoes
  ...Object.fromEntries(Object.entries(ECHO_ICONS).map(([id, rows]) => [`echo.${id}`, [rows]])),
  // Milo chopping
  'milo.chop.down': MILO_CHOP.down,
  'milo.chop.up': MILO_CHOP.up,
  'milo.chop.left': MILO_CHOP.left,
  'milo.chop.right': MILO_CHOP.right,
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

// A colour table maps palette keys to [r, g, b, a] (alpha 0..255; three numbers mean opaque).
// Keys a table leaves out keep their base colour, so a genre table only needs the keys it changes.
function colourOf(table, key) {
  const rgba = (table && table[key]) || RGBA[key];
  if (!rgba) return null;
  return rgba.length > 3 ? rgba : [rgba[0], rgba[1], rgba[2], 255];
}

export function rowsToImageData(rows, makeImageData, table = RGBA) {
  const w = rows[0].length;
  const h = rows.length;
  const image = makeImageData(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const rgba = colourOf(table, row[x]);
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

// A copy of the base colour table, for building genre tables from.
export function baseTable() {
  return Object.fromEntries(Object.entries(RGBA).map(([key, rgba]) => [key, rgba.slice()]));
}

// Builds canvases for every sprite frame. `createCanvas(w, h)` must return a canvas.
// `table` recolours the whole atlas (a genre's palette); `names` limits it to those sprites.
export function buildAtlas(createCanvas, { table = RGBA, names = null } = {}) {
  const atlas = {};
  const wanted = names ? new Set(names) : null;
  for (const [name, frames] of Object.entries(SPRITES)) {
    if (wanted && !wanted.has(name)) continue;
    atlas[name] = frames.map((rows) => {
      const canvas = createCanvas(rows[0].length, rows.length);
      const ctx = canvas.getContext('2d');
      ctx.putImageData(rowsToImageData(rows, (w, h) => ctx.createImageData(w, h), table), 0, 0);
      return canvas;
    });
  }
  return atlas;
}
