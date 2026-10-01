// The Tollkeeper of the Last Bridge (COMBAT.md §14.2, about 15 hand frames): a very polite troll who
// wandered in from a fairy-tale book, a Warden in mail with a round shield, a bowler hat and a furled
// umbrella he fights with. 20 × 26 at rest: his exploration frames (at the bridge, and following) are
// that size, and his fight frame is 36 × 34 with his feet at (18, 32). He draws plain.
//
// Fight poses are his side body on a 28 × 32 canvas (the body at (4, 6), so there's room for a raised
// umbrella or hat) with his held things stamped where the pose puts his hands.
import { grid, stamp } from '../sprites.js';

const f = Object.freeze;
const blank = (w, h) => Array.from({ length: h }, () => '.'.repeat(w));
const compose = (parts, w = 28, h = 32) => parts.reduce((rows, [art, x, y]) => stamp(rows, art, x, y), blank(w, h));

// ---------- his body ----------

const FRONT = grid(`
  ......oooooooo......
  .....oNNNNNNNNo.....
  .....oNNNNNNNNo.....
  .....oEEEEEEEEo.....
  ...ooNNNNNNNNNNoo...
  ..oNNNNNNNNNNNNNNo..
  ...oqqqqqqqqqqqlo...
  ..oqqmmqqqqqqmmqlo..
  .oqqcocqqqqqqcocqlo.
  oqoqqqqqqllqqqqqqolo
  oqqqqqqqlLLlqqqqqqlo
  .oqqqqqqlLLlqqqqqlo.
  ..oqqcqqqllqqqcqlo..
  ...oqoooooooooooqo..
  ....oqqqqqqqqqqlo...
  ..ooorrrrrrrrrrooo..
  .oSSSSSSrRRrSSSSSzo.
  oSSsSSSSSrrSSSSSsSzo
  oSsSSsSSSSSSSSsSSszo
  oqoSSSSsSSSSsSSSSoqo
  oqoSsSSSSSSSSSSsSolo
  .ooSSSsSSSSSSsSSzoo.
  ..oBBBBBBuuBBBBBBo..
  ..oEEEEEoooEEEEEEo..
  .ommmmmo...ommmmmo..
  .ooooooo...ooooooo..
`);

const BACK = grid(`
  ......oooooooo......
  .....oNNNNNNNNo.....
  .....oNNNNNNNNo.....
  .....oEEEEEEEEo.....
  ...ooNNNNNNNNNNoo...
  ..oNNNNNNNNNNNNNNo..
  ...oqqqqqqqqqqqlo...
  ..oqqqqqqqqqqqqqlo..
  .oqqqqqqqqqqqqqqqlo.
  oqoqqqqqqqqqqqqqqolo
  oqqqqqqqqqqqqqqqqqlo
  .oqqqqqqqqqqqqqqqlo.
  ..oqqqqqqqqqqqqqlo..
  ...oqqqqqqqqqqqqqo..
  ....oqqqqqqqqqqlo...
  ..ooorrrrrrrrrrooo..
  .oSSSSSSSSSSSSSSSzo.
  oSSsSSSSSsSSSSSsSzo.
  oSsSSSSSSSSSSSsSSzo.
  oqoSSSSsSSSSsSSSSoqo
  oqoSsSSSSSSSSSSsSolo
  .ooSSSsSSSSSSsSSzoo.
  ..oBBBBBBBBBBBBBBo..
  ..oEEEEEoooEEEEEEo..
  .ommmmmo...ommmmmo..
  .ooooooo...ooooooo..
`).map((r) => r.padEnd(20, '.'));

const SIDE = grid(`
  .......oooooooo.....
  ......oNNNNNNNNo....
  ......oNNNNNNNNo....
  ......oEEEEEEEEo....
  ....ooNNNNNNNNNNNoo.
  .....oqqqqqqqqqqqo..
  ....oqqqqqqqqqmmqo..
  ...oqqqqqqqqqqcocqo.
  ..oqoqqqqqqqqqqqqlLo
  ..oqqqqqqqqqqqqqlLLo
  ...oqqqqqqqqqqqqqlLo
  ...oqqqqqqqqqqqcqqo.
  ....oqqqqqqqqooooo..
  .....oqqqqqqqqqlo...
  ....ooorrrrrrrrooo..
  ...oSSSSSSSSSrRRSo..
  ..oSsSSSSSSSSSSrRSo.
  ..oSSSSsSSSSSSSSSzo.
  ..oSsSSSSSsSSSSsSzo.
  ..oSSSSSSSSSSSSSqqo.
  ..oSSSsSSSSSSsSSqqo.
  ...oSSSSSSSSSSSSzo..
  ...oBBBBBBBBBBuBo...
  ....oEEEEEoEEEEEo...
  ....ommmmmo.ommmmmo.
  ....ooooooo.ooooooo.
`);

// Striding (side): his legs apart, then passing.
const LEGS_SIDE_A = grid(`
  ...oEEEEEo.oEEEEEo..
  ..ommmmmo...ommmmmo.
  ..oooooo....ooooooo.
`);
const LEGS_SIDE_B = grid(`
  ....oEEEEEEEEEEo....
  ....ommmmmmmmmmo....
  ....oooooooooooo....
`);
const LEGS_FRONT_A = grid(`
  ..oEEEEEoooEEEEEEo..
  .ommmmmo...oooooo...
  .ooooooo............
`);
const LEGS_FRONT_B = grid(`
  ..oEEEEEoooEEEEEEo..
  ...oooooo..ommmmmo..
  ...........ooooooo..
`);
const legs = (rows, patch) => stamp(rows.slice(0, 23).concat(['.'.repeat(20), '.'.repeat(20), '.'.repeat(20)]), patch, 0, 23);

// The body variants the poses use.
const SIDE_NOHAT = stamp(SIDE, grid(`
  ....................
  ....................
  ....................
  .......oooooooo.....
  .....ooqqqqqqqqoo...
`), 0, 0).map((r, y) => (y < 3 ? '.'.repeat(20) : r));
const SIDE_SHUT = stamp(SIDE, ['qqqq', 'oooq'], 13, 7);
const SIDE_HIT = stamp(SIDE_SHUT, grid(`
  ....oo.oo.o.
`), 5, 5);
// sat down (legs out in front), hat tipped over his eyes
const SIDE_SIT = grid(`
  ....................
  ....................
  ....................
  .......oooooooo.....
  ......oNNNNNNNNo....
  ......oNNNNNNNNo....
  ......oEEEEEEEEo....
  ....ooNNNNNNNNNNNoo.
  .....oNNNNNNNNNNNo..
  ....oqqqqqqqqqqqqqo.
  ...oqqqqqqqqqqqqqqlLo
  ..oqoqqqqqqqqqqqqlLLo
  ...oqqqqqqqqqqqqqqlLo
  ...oqqqqqqqqqqqcqqo.
  ....oqqqqqqqqooooo..
  ....ooorrrrrrrrooo..
  ...oSSSSSSSSSrRRSo..
  ..oSsSSSSSSSSSSrRSo.
  ..oSSSSsSSSSSSSSSzo.
  ..oSsSSSSSsSSSSqqzo.
  ..oSSSSSSSSSSSSqqzo.
  ...oBBBBBBBBBBuBoooooo
  ...oEEEEEEEEEEEEEEmmmo
  ...ooooooooooooooommmo
  .................ooooo
`).map((r) => r.padEnd(22, '.'));

// ---------- what he holds ----------

const SHIELD = grid(`
  ..ooooo..
  .oSSSSSo.
  oSbnnbbSo
  oSnbbbbSo
  oSbbubbBo
  oSbbbbbBo
  oSbbbbBBo
  .oSSSSSo.
  ..ooooo..
`);
// an arm raised high (a cheer with his hat in hand)
const ARM_UP = grid(`
  .oqqo
  .oqqo
  .oqo.
  .oqo.
  oqqo.
  oqqo.
  oqo..
  oqo..
  oqo..
`);
// the furled umbrella: upright (crook up), level (pointing forward), and over the shoulder
const UMB_UP = grid(`
  .oo..
  o..o.
  ...n.
  ..ono
  ..oNo
  .oNNo
  .oNNo
  .oENo
  .oNNo
  ..oNo
  ..oNo
  ..oNo
  ...o.
  ...S.
`);
const UMB_LEVEL = grid(`
  .oo..........
  o..nooooo....
  o.onNNNNNooo.
  ...ooNNENNooS
  .....ooooo...
`);
const UMB_BACK = grid(`
  S.........
  .oo.......
  .oNoo.....
  ..oNNoo...
  ...oNNNo..
  ....ooNNo.
  ......onoo
  .......n.o
  .......oo.
`);
const BOWLER = grid(`
  ..oooooooo..
  .oNNNNNNNNo.
  .oNNNNNNNNo.
  .oEEEEEEEEo.
  ooNNNNNNNNoo
  .oooooooooo.
`);
const HAND = grid(`
  oo.
  qqo
  qqo
  oo.
`);
const FINGER = grid(`
  .o.
  oqo
  oqo
  oqqo
  oqqo
  .oo.
`);
const CHIN = grid(`
  .oo.
  oqqo
  oqqo
  .oSo
  .oSo
`);

// ---------- poses (side, facing right, on the 28 × 32 canvas; the body at (4, 6)) ----------

const at = (x, y) => [x + 4, y + 6]; // body grid point → canvas
const POSE_ART = {
  ready: compose([[UMB_UP, ...at(-1, 7)], [SIDE, 4, 6], [SHIELD, ...at(14, 14)]]),
  'walk.a': compose([[UMB_UP, ...at(-1, 7)], [legs(SIDE, LEGS_SIDE_A), 4, 6], [SHIELD, ...at(14, 14)]]),
  'walk.b': compose([[UMB_UP, ...at(-1, 7)], [legs(SIDE, LEGS_SIDE_B), 4, 6], [SHIELD, ...at(14, 14)]]),
  // the umbrella over his shoulder, then brought round and down
  'melee.a': compose([[UMB_BACK, ...at(-4, 5)], [SIDE, 4, 6], [SHIELD, ...at(14, 14)]]),
  'melee.b': compose([[SIDE, 4, 6], [SHIELD, ...at(12, 15)], [UMB_LEVEL, ...at(13, 12)]]),
  // the shield up in front of him, braced
  brace: compose([[UMB_UP, ...at(-1, 8)], [SIDE_SHUT, 4, 7], [SHIELD, ...at(15, 9)], [HAND, ...at(16, 13)]]),
  // "Riddle me this": one finger up by his spectacles
  riddle: compose([[UMB_UP, ...at(-1, 7)], [SIDE, 4, 6], [FINGER, ...at(19, 2)], [SHIELD, ...at(13, 15)]]),
  hit: compose([[UMB_UP, ...at(-2, 7)], [SIDE_HIT, 3, 6], [SHIELD, ...at(13, 14)]]),
  doze: compose([[SIDE_SIT, 4, 7], [SHIELD, ...at(-3, 16)]]),
  // his hat raised high in a cheer, and tipped politely
  cheer: compose([[UMB_UP, ...at(-1, 7)], [SIDE_NOHAT, 4, 6], [BOWLER, ...at(12, -6)], [ARM_UP, ...at(15, 0)], [SHIELD, ...at(13, 15)]]),
  wave: compose([[UMB_UP, ...at(-1, 7)], [SIDE_NOHAT, 4, 6], [BOWLER, ...at(13, 0)], [SHIELD, ...at(13, 15)]]),
  think: compose([[UMB_UP, ...at(-1, 7)], [SIDE_SHUT, 4, 6], [CHIN, ...at(16, 12)], [SHIELD, ...at(12, 15)]]),
  // sat at the fire: the doze, with his eyes open under the brim
  'camp-sit': compose([[stamp(SIDE_SIT, ['oqcoc'], 13, 9), 4, 7]]),
};

// `neck`, when a pose has one, is its own breath row in the grid (sat or dozing, his head is lower).
const P = (rows, anchors, neck = null) => f({ rows: f(rows), at: f([-4, -6]), split: null, neck, anchors: f(anchors) });
const A = (hx, hy, rx, ry) => ({ head: [14, 6], handL: [hx, hy], handR: [rx, ry], back: [8, 24] });

export const TOLL = f({
  rig: 'toll',
  family: null,
  defaultWho: 'tollkeeper',
  looks: f({ tollkeeper: f({}) }),
  // The frame row a standing breath bends at, where his clips breathe (poseOps' default).
  neck: 21,
  poses: f({
    ready: P(POSE_ART.ready, A(4, 21, 22, 24)),
    'walk.a': P(POSE_ART['walk.a'], A(4, 21, 22, 24)),
    'walk.b': P(POSE_ART['walk.b'], A(4, 21, 22, 24)),
    'melee.a': P(POSE_ART['melee.a'], A(1, 12, 22, 24)),
    'melee.b': P(POSE_ART['melee.b'], A(4, 21, 28, 21)),
    brace: P(POSE_ART.brace, A(4, 22, 24, 20)),
    riddle: P(POSE_ART.riddle, A(4, 21, 24, 8)),
    hit: P(POSE_ART.hit, A(3, 21, 21, 24)),
    doze: P(POSE_ART.doze, A(4, 27, 22, 27), 25),
    cheer: P(POSE_ART.cheer, A(4, 21, 21, 6)),
    wave: P(POSE_ART.wave, A(4, 21, 22, 8)),
    think: P(POSE_ART.think, A(4, 21, 22, 18)),
    'camp-sit': P(POSE_ART['camp-sit'], A(4, 27, 22, 27), 25),
  }),
  overlays: f({
    z: f(['oooooo', 'occcco', 'oooco.', '.ocooo', 'occcco', 'oooooo']),
    blink: f(['...c.......c...', '...............', 'u.............u', '...............', '...............', 'c.............c', '...............', '...............', '.u...........u.', '...............', '...c.......c...']),
  }),
  // At the Last Bridge and following Milo: 20 × 26, [stand, stride, stride] per direction.
  explore: f({
    down: f([FRONT, legs(FRONT, LEGS_FRONT_A), legs(FRONT, LEGS_FRONT_B)].map(f)),
    up: f([BACK, legs(BACK, LEGS_FRONT_B), legs(BACK, LEGS_FRONT_A)].map(f)),
    right: f([SIDE, legs(SIDE, LEGS_SIDE_A), legs(SIDE, LEGS_SIDE_B)].map(f)),
  }),
  clips: f({
    ready: f({ side: ['ready', 'ready', 'ready', 'ready', ['ready', { op: 'breathe', row: 21 }], ['ready', { op: 'breathe', row: 21 }], ['ready', { op: 'breathe', row: 21 }], 'ready'] }),
    walk: f({ side: ['walk.a', 'ready', 'walk.b', 'ready'] }),
    melee: f({ side: ['ready', 'melee.a', 'melee.b', 'melee.b', ['melee.b', { op: 'nudge', dx: -1 }], 'ready'] }),
    ranged: f({ side: ['ready', 'melee.a', 'melee.b', ['melee.b', { op: 'nudge', dx: -1 }], 'ready'] }),
    cast: f({ side: ['ready', 'riddle', 'riddle', ['riddle', { op: 'breathe', row: 21 }], ['riddle', { op: 'breathe', row: 21 }], 'riddle', 'riddle', 'ready'] }),
    sustain: f({ side: ['riddle', 'riddle', ['riddle', { op: 'breathe', row: 21 }], ['riddle', { op: 'breathe', row: 21 }], 'riddle', 'riddle', 'ready', 'ready'] }),
    gesture: f({ side: ['ready', 'riddle', ['riddle', { op: 'breathe', row: 21 }], 'riddle'] }),
    hit: f({ side: ['hit', ['hit', { op: 'nudge', dx: -1 }], 'ready'] }),
    dodge: f({ side: [['brace', { op: 'nudge', dx: -1 }], 'brace', ['brace', { op: 'nudge', dx: 1 }], 'ready'] }),
    brace: f({ side: [['brace', { op: 'lift', dy: -1 }], 'brace'] }),
    jump: f({ side: [['ready', { op: 'squash', row: 30, n: 1 }], ['ready', { op: 'lift', dy: -2 }], ['ready', { op: 'lift', dy: -1 }], 'ready'] }),
    tumble: f({ side: ['hit', ['doze', { op: 'lift', dy: -1 }], 'doze'] }),
    stand: f({ side: ['doze', ['ready', { op: 'squash', row: 30, n: 2 }], 'ready'] }),
    offline: f({ side: ['hit', ['hit', { op: 'shift', dx: 1, top: 0, bottom: 28 }], ['doze', { op: 'lift', dy: -1 }], 'doze', 'doze'] }),
    dozing: f({ side: [...Array(8).fill('doze'), ...Array(8).fill(['doze', { op: 'breathe', row: 26 }, { op: 'overlay', id: 'z', at: [27, 8] }])] }),
    reboot: f({ side: [['doze', { op: 'overlay', id: 'blink', at: [10, 12] }], ['doze', { op: 'lift', dy: -1 }, { op: 'overlay', id: 'blink', at: [10, 10] }], ['hit', { op: 'overlay', id: 'blink', at: [10, 8] }], 'hit', 'ready'] }),
    item: f({ side: ['ready', 'think', ['think', { op: 'breathe', row: 21 }], 'think', 'ready'] }),
    cheer: f({ side: ['wave', 'cheer', ['cheer', { op: 'breathe', row: 21 }], 'cheer'] }),
    wave: f({ side: ['ready', 'wave', 'wave', ['wave', { op: 'breathe', row: 21 }]] }),
    think: f({ side: ['think', 'think', 'think', 'think', ['think', { op: 'breathe', row: 21 }], ['think', { op: 'breathe', row: 21 }], ['think', { op: 'breathe', row: 21 }], 'think'] }),
    laugh: f({ side: ['ready', ['ready', { op: 'lift', dy: -1 }], 'ready', ['ready', { op: 'lift', dy: -1 }]] }),
    shrug: f({ side: ['ready', 'riddle', 'wave', 'ready'] }),
    sit: f({ side: [...Array(8).fill('camp-sit'), ...Array(4).fill(['camp-sit', { op: 'breathe', row: 26 }])] }),
    sleep: f({ side: [...Array(8).fill('doze'), ...Array(8).fill(['doze', { op: 'breathe', row: 26 }, { op: 'overlay', id: 'z', at: [27, 8] }])] }),
    'camp-sit': f({ side: [...Array(8).fill('camp-sit'), ...Array(4).fill(['camp-sit', { op: 'breathe', row: 26 }])] }),
    'camp-talk': f({ side: ['camp-sit', 'camp-sit', 'riddle', 'riddle', 'riddle', 'camp-sit', 'camp-sit', 'camp-sit'] }),
    'camp-sleep': f({ side: [...Array(8).fill('doze'), ...Array(8).fill(['doze', { op: 'overlay', id: 'z', at: [27, 8] }])] }),
    'camp-job': f({ side: ['think', 'think', 'riddle', 'riddle', 'think', 'think', 'wave', 'think'] }),
  }),
});

