// Jev, the Judgebird (COMBAT.md §14.2, about 12 hand frames): 12 × 10 at rest, in a 32 × 28 fight
// frame with his feet at (16, 26). Jev never speaks, in a fight or at the fire: his lines are head
// tilts, hops and piles, and his thoughts are pictures (icons.js THOUGHT_ICONS). He draws plain.
//
// His perched sprite in sprites.js faces left; these face right, like every rig, and 'left' mirrors.
import { grid, mirror, CREW_ART } from '../sprites.js';

const f = Object.freeze;
const P = (rows, at, anchors) => f({ rows: f(rows), at: f(at), split: null, anchors: f(anchors) });

// perched, and with a wing flicked (his own two frames, turned to face right)
const PERCH = mirror(CREW_ART.jev.idle[0]);
const FLAP = mirror(CREW_ART.jev.idle[1]);

// peck: lunged forward, beak out
const PECK = grid(`
  ..............
  ......oooo....
  .....owwwwo...
  ....owwwwowo..
  ..ooWWwwwwwUUo
  .oWWWWwwccooo.
  oWWWWbccco....
  .oWBBccco.....
  ..oBBooo......
  ..oUo.oUo.....
`);

// wings up: a flutter (jump, dodge, flying over)
const FLY = grid(`
  ..oo..........
  .oWWo.........
  .oWWWo.oooo...
  ..oWWWowwwwo..
  ...oWWwwwwowo.
  ...owwwwwwwwUo
  ...oWwwwwwcco.
  ....oBbcccco..
  .....oBBcco...
  ......oooo....
`);

// the verdict: drawn up tall, a wing out toward the one it's about (gesture, cast, ranged)
const VERDICT = grid(`
  .....oooo.....
  ....owwwwo....
  ...owwwwowo...
  ..oWWwwwwwUo..
  .oWWWwwwcco...
  oWWWWbcccooo..
  oWWWBBccoWWWo.
  .ooBBBcco.ooo.
  ...oBBoo......
  ...oUo.oUo....
`);

// hit: feathers ruffled, eye squeezed shut, knocked back a step
const HIT = grid(`
  ...o.o.o....
  ...owwwwo...
  ..owwwwooo..
  .oWWwwwwwUo.
  oWWWWwwcco..
  oWWWWbccco..
  .oWWBBccco..
  ..ooBBooo...
  ...Uo.Uo....
  ............
`);

// tumbled: on his back, feet in the air
const TUMBLE = grid(`
  ...Uo.Uo....
  ..ooBBooo...
  .oWWBBccco..
  oWWWWbccco..
  oWWWWwwcco..
  .oWWwwwwwUo.
  ..owwwwowo..
  ...owwwwo...
  ....oooo....
`);

// dozing: fluffed into a ball, head tucked, eye shut
const DOZE = grid(`
  ............
  ....oooo....
  ..oowwwwoo..
  .oWWwwwwwwo.
  oWWWwwwoowo.
  oWWWWwwccco.
  oWWWbbcccco.
  .oooBBooooo.
  ...Uo..Uo...
  ............
`);

// cheer: both wings flung up, beak open
const CHEER = grid(`
  .oo........oo.
  oWWo......oWWo
  oWWWo.oooowWo.
  .oWWWowwwwowo.
  ..oWWwwwwwwUo.
  ...owwwwwcoUo.
  ...oWbccccco..
  ...oBBcccco...
  ....oBBooo....
  ....oUo.oUo...
`);

// the head tilt (thinking, listening, weighing a pile)
const TILT = grid(`
  ......oo....
  ....oowwo...
  ...owwwowo..
  ..oWwwwwwwUo
  .oWWWwwwco..
  oWWWWbccco..
  .oWWBBccco..
  ..ooBBooo...
  ...Uo.Uo....
  ............
`);

// the pile: head down, sorting something at his feet (his camp job, and a laugh of a kind)
const PILE = grid(`
  ............
  ............
  ..oooo......
  .oWWWWoooo..
  oWWWWwwwwwo.
  oWWWbwwwwowo
  .oWBBccwwwUo
  ..ooBBcooo..
  ...Uo.Uo.uo.
  .........oo.
`);

// sat: settled down on his belly, feet hidden (sitting at the fire)
const SIT = grid(`
  ............
  ............
  ....oooo....
  ...owwwwo...
  ..owwwwowo..
  .oWWwwwwwUo.
  oWWWWwwcco..
  oWWWWbccco..
  .oooBBoooo..
  ............
`);

export const JEV = f({
  rig: 'jev',
  family: null,
  defaultWho: 'jev',
  looks: f({ jev: f({}) }),
  // The frame row a breath bends at, where his clips breathe (poseOps' default for breathe and squash).
  neck: 23,
  poses: f({
    perch: P(PERCH, [0, 0], { head: [7, 0], handL: [2, 5], handR: [9, 3], back: [3, 5] }),
    flap: P(FLAP, [0, 0], { head: [7, 0], handL: [2, 5], handR: [9, 3], back: [3, 5] }),
    peck: P(PECK, [0, -1], { head: [8, 1], handL: [2, 6], handR: [12, 4], back: [3, 6] }),
    fly: P(FLY, [-1, -1], { head: [8, 2], handL: [2, 1], handR: [12, 5], back: [4, 6] }),
    verdict: P(VERDICT, [-1, -1], { head: [7, 0], handL: [2, 6], handR: [12, 6], back: [3, 6] }),
    hit: P(HIT, [-1, 0], { head: [6, 0], handL: [2, 5], handR: [9, 3], back: [3, 5] }),
    tumble: P(TUMBLE, [0, 0], { head: [6, 7], handL: [2, 4], handR: [9, 5], back: [3, 4] }),
    doze: P(DOZE, [0, 0], { head: [7, 1], handL: [2, 5], handR: [9, 5], back: [3, 5] }),
    cheer: P(CHEER, [-1, -1], { head: [8, 2], handL: [1, 1], handR: [12, 1], back: [4, 6] }),
    tilt: P(TILT, [0, 0], { head: [7, 0], handL: [2, 5], handR: [10, 3], back: [3, 5] }),
    pile: P(PILE, [0, -1], { head: [8, 3], handL: [2, 5], handR: [10, 8], back: [3, 5] }),
    sit: P(SIT, [0, 0], { head: [7, 2], handL: [2, 6], handR: [9, 5], back: [3, 6] }),
  }),
  // Following Milo: his own perched frames (hopping in place), turned to face his way.
  explore: f({
    down: f([CREW_ART.jev.idle[0], CREW_ART.jev.idle[1], CREW_ART.jev.idle[0]]),
    up: f([CREW_ART.jev.idle[0], CREW_ART.jev.idle[1], CREW_ART.jev.idle[0]]),
    right: f([PERCH, FLAP, PERCH]),
  }),
  overlays: f({
    z: f(['oooooo', 'occcco', 'oooco.', '.ocooo', 'occcco', 'oooooo']),
    blink: f(['..c.....c..', '...........', 'u.........u', '...........', 'c.........c', '...........', '..u.....u..']),
  }),
  clips: f({
    ready: f({ side: ['perch', 'perch', 'perch', 'perch', 'perch', 'flap', 'perch', 'perch'] }),
    walk: f({ side: ['perch', ['perch', { op: 'lift', dy: -2 }], ['flap', { op: 'lift', dy: -1 }], 'perch'] }),
    melee: f({ side: [['perch', { op: 'shift', dx: -1, top: 17, bottom: 22 }], ['perch', { op: 'shift', dx: -1, top: 17, bottom: 22 }], 'peck', 'peck', ['peck', { op: 'nudge', dx: -1 }], 'perch'] }),
    ranged: f({ side: ['perch', 'verdict', ['verdict', { op: 'lift', dy: -1 }], 'verdict', 'perch'] }),
    cast: f({ side: ['tilt', 'tilt', 'tilt', 'verdict', 'verdict', ['verdict', { op: 'lift', dy: -1 }], 'verdict', 'perch'] }),
    sustain: f({ side: ['verdict', 'verdict', 'verdict', ['verdict', { op: 'lift', dy: -1 }], 'verdict', 'verdict', 'flap', 'verdict'] }),
    gesture: f({ side: ['perch', 'verdict', 'verdict', 'perch'] }),
    hit: f({ side: ['hit', ['hit', { op: 'nudge', dx: -1 }], 'perch'] }),
    dodge: f({ side: ['fly', ['fly', { op: 'lift', dy: -2 }], ['fly', { op: 'nudge', dx: -1 }], 'perch'] }),
    brace: f({ side: [['doze', { op: 'lift', dy: -1 }], 'sit'] }),
    jump: f({ side: [['perch', { op: 'squash', row: 26, n: 1 }], ['fly', { op: 'lift', dy: -4 }], ['fly', { op: 'lift', dy: -2 }], 'perch'] }),
    tumble: f({ side: ['hit', ['tumble', { op: 'lift', dy: -2 }], 'tumble'] }),
    stand: f({ side: ['tumble', 'fly', 'perch'] }),
    offline: f({ side: ['hit', ['hit', { op: 'shift', dx: 1, top: 0, bottom: 24 }], ['doze', { op: 'lift', dy: -1 }], 'doze', 'doze'] }),
    dozing: f({ side: [...Array(8).fill('doze'), ...Array(8).fill(['doze', { op: 'breathe', row: 23 }, { op: 'overlay', id: 'z', at: [21, 12] }])] }),
    reboot: f({ side: [['doze', { op: 'overlay', id: 'blink', at: [10, 16] }], ['doze', { op: 'overlay', id: 'blink', at: [10, 14] }], ['fly', { op: 'overlay', id: 'blink', at: [10, 13] }], 'flap', 'perch'] }),
    item: f({ side: ['perch', 'pile', ['pile', { op: 'breathe', row: 23 }], 'pile', 'perch'] }),
    cheer: f({ side: ['cheer', ['cheer', { op: 'lift', dy: -2 }], 'cheer', 'flap'] }),
    wave: f({ side: ['flap', 'perch', 'flap', 'perch'] }),
    think: f({ side: ['tilt', 'tilt', 'tilt', 'tilt', 'tilt', 'perch', 'tilt', 'tilt'] }),
    laugh: f({ side: ['flap', ['perch', { op: 'lift', dy: -1 }], 'flap', ['perch', { op: 'lift', dy: -1 }]] }),
    shrug: f({ side: ['perch', 'fly', 'flap', 'perch'] }),
    sit: f({ side: [...Array(8).fill('sit'), ...Array(4).fill(['sit', { op: 'breathe', row: 23 }])] }),
    sleep: f({ side: [...Array(8).fill('doze'), ...Array(8).fill(['doze', { op: 'breathe', row: 23 }, { op: 'overlay', id: 'z', at: [21, 12] }])] }),
    'camp-sit': f({ side: [...Array(8).fill('sit'), ...Array(4).fill(['sit', { op: 'breathe', row: 23 }])] }),
    'camp-talk': f({ side: ['tilt', 'tilt', 'perch', 'perch', 'flap', 'perch', 'tilt', 'tilt'] }),
    'camp-sleep': f({ side: [...Array(8).fill('doze'), ...Array(8).fill(['doze', { op: 'breathe', row: 23 }, { op: 'overlay', id: 'z', at: [21, 12] }])] }),
    'camp-job': f({ side: ['pile', 'pile', ['pile', { op: 'shift', dx: 1, top: 19, bottom: 24 }], 'pile', 'pile', ['pile', { op: 'shift', dx: 1, top: 19, bottom: 24 }], 'tilt', 'pile'] }),
  }),
});
