// Fight icons (CONTRACT-PHASE4.md §7.8, COMBAT.md §13 and §14.4): the intent icons a telegraph shows,
// condition icons, damage kinds, Jev's thought pictures, the board's markers and the outcome flashes.
// Every icon is 8 × 8 rows of palette keys with a closed ink outline (no colour pixel touches the
// clear), like the vale's echo icons, so it reads on any floor and in any genre: the engine paints
// them in the world's own colours (painter.grid(rows, null, 'base')). Sides are told by shape
// (circle, diamond, square), never by colour alone, and every condition has a pattern as well as a
// colour. Pure data.

const freeze = Object.freeze;
const g = (text) => freeze(text.split('\n').map((r) => r.trim()).filter(Boolean));

/** The 16 intents of §5.6 plus 'hidden' (a '?'). */
export const INTENT_ICONS = freeze({
  // a sword
  strike: g(`
    .....ooo
    ....occo
    ...occo.
    o.occo..
    oooco...
    .oBo....
    oBoo....
    oo......
  `),
  // jaws
  bite: g(`
    .oooooo.
    orrrrrro
    ocococoo
    oQQQQQQo
    oQQQQQQo
    oocococo
    orrrrrro
    .oooooo.
  `),
  // an arrow in flight
  shoot: g(`
    ....o...
    ....oo..
    oooooco.
    occcccco
    oooooco.
    ....oo..
    ....o...
    ........
  `),
  // a sparkle
  cast: g(`
    ...oo...
    ..ouuo..
    .oouuoo.
    ouuccuuo
    ouuccuuo
    .oouuoo.
    ..ouuo..
    ...oo...
  `),
  // a target of rings
  area: g(`
    ..oooo..
    .ouuuuo.
    ouooooUo
    ouoccoUo
    ouoccoUo
    ouooooUo
    .oUUUUo.
    ..oooo..
  `),
  // a boot
  move: g(`
    .ooo....
    .obo....
    .obo....
    .oboooo.
    onbbbbbo
    obbbbbBo
    oooooooo
    ........
  `),
  // a shield
  brace: g(`
    .oooooo.
    oeeeeeEo
    oeceeeEo
    oeeeeeEo
    oeeeeeEo
    .oeeeEo.
    ..oeEo..
    ...oo...
  `),
  // a green cross
  patch: g(`
    ..oooo..
    ..oqlo..
    oooqlooo
    oqqqlllo
    oLLllLLo
    oooLLooo
    ..oLLo..
    ..oooo..
  `),
  // a doorway of light: an arch on a flat sill
  summon: g(`
    ..oooo..
    .ovvvvo.
    ovvccvvo
    ovcuucvo
    ovcuucvo
    ovcuucvo
    ovcuucvo
    oooooooo
  `),
  // a puddle
  surface: g(`
    ........
    ........
    ..oooo..
    .owwwwo.
    owwfwwWo
    owwwwWWo
    .oWWWWo.
    ..oooo..
  `),
  // a push: a palm and an arrow
  shove: g(`
    ooo..o..
    occo.oo.
    occoooco
    occcccco
    occoooco
    occo.oo.
    ooo..o..
    ........
  `),
  // a speech bubble
  talk: g(`
    .oooooo.
    occcccco
    occcccco
    occcccco
    .oooccoo
    ...oco..
    ...oo...
    ........
  `),
  // a bush to hide in
  hide: g(`
    ..oooo..
    .olqllo.
    olllqllo
    olqllllo
    olllllLo
    .oLLLLo.
    ..oooo..
    ........
  `),
  // a magnifying glass
  examine: g(`
    .oooo...
    ocfcco..
    offcco..
    occcco..
    .oooooo.
    ....oBoo
    .....oBo
    ......oo
  `),
  // a lever: a knob on a stick, thrown over on its box
  mechanic: g(`
    .....oo.
    ....ouuo
    ....ouuo
    ...oSoo.
    ..oSo...
    .oooooo.
    oSSzzSSo
    oooooooo
  `),
  // an hourglass
  wait: g(`
    oooooooo
    .occcco.
    ..occo..
    ...oo...
    ...oo...
    ..ouuo..
    .ouuuuo.
    oooooooo
  `),
  // a question mark (a hidden intent)
  hidden: g(`
    ..oooo..
    .occcco.
    .ooooco.
    ...occo.
    ...oco..
    ...ooo..
    ...oco..
    ...ooo..
  `),
});

/** One per condition id of §5.1 (21 plus 'lingering'). Each is a shape and a pattern as well as a colour. */
export const CONDITION_ICONS = freeze({
  // knocked down: an arrow curling to the ground
  tumbled: g(`
    .oooo...
    occcco..
    oooooco.
    ....oco.
    ..ooocoo
    ..occcco
    ...occo.
    ....oo..
  `),
  // looped vines
  tangled: g(`
    .oo..oo.
    olLooqlo
    oloLlolo
    .olqloo.
    .oolLlo.
    olooloLo
    olLooqlo
    .oo..oo.
  `),
  // a sleepy z
  drowsy: g(`
    oooooo..
    ovvvvo..
    oooovo..
    ..ovoo..
    .ovooooo
    ovvvvvvo
    oooooooo
    ........
  `),
  // glints swimming in the eyes
  dazzled: g(`
    ..o.....
    .ouo..o.
    oucuoouo
    .ouo..o.
    ..o.....
    .....o..
    ....ouo.
    .....o..
  `),
  // a little ghost
  spooked: g(`
    ..oooo..
    .occcco.
    occcccco
    ocooocco
    occcccco
    occcccco
    ococooco
    oo.oo.oo
  `),
  // a heart
  beguiled: g(`
    .oo..oo.
    okkookko
    okckkkKo
    okkkkkKo
    .okkkKo.
    ..okKo..
    ...oo...
    ........
  `),
  // a green wobble
  queasy: g(`
    .oooooo.
    oqqqqqqo
    oqoqqoqo
    oqqqqqqo
    oqoqoqqo
    oqqoqoqo
    oqqqqqqo
    .oooooo.
  `),
  // shaken lines
  rattled: g(`
    oooooooo
    oSoSoSoo
    oSSSSSSo
    oooooooo
    oooooooo
    ooSoSoSo
    oSSSSSSo
    oooooooo
  `),
  // stars round a head
  dazed: g(`
    ooo..ooo
    ouo..ouo
    ooooooo.
    .ocuuco.
    occccuco
    occcccco
    .occcco.
    ..oooo..
  `),
  // a snail's shell (downward chevrons)
  slowed: g(`
    oo....oo
    oeo..oeo
    .oeooeo.
    ..oeeo..
    oo.oo.oo
    oeo..oeo
    .oeooeo.
    ..oooo..
  `),
  // upward chevrons
  quickened: g(`
    ..oooo..
    .ouooUo.
    ouo..oUo
    oo.oo.oo
    ..ouUo..
    .ouooUo.
    ouo..oUo
    oo....oo
  `),
  // wind lines
  brisk: g(`
    oooooo..
    oeeeeeoo
    oooooooo
    ..oooooo
    .oeeeeeo
    .ooooooo
    oeeeeeo.
    ooooooo.
  `),
  // a puff of breath
  winded: g(`
    ..oooo..
    .oCCCCo.
    oCCccCCo
    oCccccCo
    .oCCCCo.
    ..oooo..
    .oo.....
    oo......
  `),
  // a lightning bolt
  sparked: g(`
    ...oooo.
    ..ouuo..
    .ouuo...
    ouuuuoo.
    oooouuo.
    ..ouuo..
    .ouoo...
    .oo.....
  `),
  // a flame
  singed: g(`
    ...oo...
    ..oro...
    .orUro..
    orUuUro.
    orUucUro
    orUccUro
    .orUUro.
    ..oooo..
  `),
  // a water drop
  soaked: g(`
    ...oo...
    ..owwo..
    .owwwwo.
    owfwwwWo
    owfwwwWo
    owwwwWWo
    .oWWWWo.
    ..oooo..
  `),
  // a mouth stitched shut
  hushed: g(`
    .oooooo.
    occcccco
    occcccco
    orrrrrro
    occcccco
    .oooccoo
    ...oco..
    ...oo...
  `),
  // a closed eye (out of sight)
  unseen: g(`
    ........
    ........
    oo....oo
    ovoooovo
    .ovvvvo.
    o.oooo.o
    ..o..o..
    ........
  `),
  // an open eye
  exposed: g(`
    ..oooo..
    .occcco.
    occoocco
    ocoNNoco
    ocoNNoco
    occoocco
    .occcco.
    ..oooo..
  `),
  // a crosshair
  'singled-out': g(`
    ...oo...
    ..oroo..
    .orrrro.
    orroorro
    orroorro
    .orrrro.
    ..oroo..
    ...oo...
  `),
  // a crescent moon (dozing)
  offline: g(`
    ..oooo..
    .ouuuo..
    ouuoo...
    ouuo....
    ouuo....
    ouuoo...
    .ouuuo..
    ..oooo..
  `),
  // a trail of drops (lingering damage)
  lingering: g(`
    ...oo...
    ..oRo...
    .oRrRo..
    .oRRRo..
    ..ooo...
    oo....oo
    oRo..oRo
    oo....oo
  `),
});

/**
 * Where a condition's number goes beside its icon: a 4 × 6 small number (scene-art numberRows) at
 * (x, y) from the icon's top-left, so a badge is 12 × 8.
 */
export const NUMBER_SLOT = freeze({ x: 8, y: 2, w: 4, h: 6 });

/** The 12 damage kinds of §5.1. */
export const KIND_ICONS = freeze({
  // a zigzag
  static: g(`
    ...oooo.
    ..ouuo..
    .ouuoo..
    ouuuuuo.
    .oouuo..
    ..ouuo..
    .ouoo...
    .oo.....
  `),
  // a snowflake
  chill: g(`
    oo.oo.oo
    ofoffofo
    .offffo.
    offccffo
    offccffo
    .offffo.
    ofoffofo
    oo.oo.oo
  `),
  // a heavy cloud
  dread: g(`
    ..ooo...
    .oVVVoo.
    oVVVVVVo
    oVVNVVVo
    oVNNNVVo
    .oooooo.
    .o.o.o..
    ........
  `),
  // a gear
  grind: g(`
    .o.oo.o.
    oooSSooo
    .oSSSSo.
    oSSzzSSo
    oSSzzSSo
    .oSSSSo.
    oooSSooo
    .o.oo.o.
  `),
  // a spiral
  warp: g(`
    .oooooo.
    ovvvvvvo
    ovoooovo
    ovovvovo
    ovovooVo
    ovooVVVo
    ovVVVVVo
    .oooooo.
  `),
  // a curl of smoke turning back on itself, a question with no answer (Noir's)
  doubt: g(`
    .oooo...
    oNNNNo..
    oNooNo..
    ooo.oNo.
    ...oNo..
    ..oNo...
    ..oNNo..
    ...ooo..
  `),
  // a puff of dust
  dust: g(`
    ........
    ..oooo..
    .oPPPPo.
    oPPppPPo
    oPPPPPPo
    .oPoPPo.
    ..o.oo..
    ........
  `),
  // cracked ground
  quake: g(`
    ........
    ........
    oooooooo
    ozSozzSo
    oSzoSzzo
    ozzoSozo
    oooooooo
    ........
  `),
  // a sun
  light: g(`
    o..oo..o
    .oouuoo.
    .oucuuo.
    ouccuuUo
    ouuuuUUo
    .ouuUUo.
    .ooUUoo.
    o..oo..o
  `),
  // a drop of ink
  ink: g(`
    ...oo...
    ..oNo...
    .oNNNo..
    oNcNNNo.
    oNNNNNo.
    .oNNNo..
    ..ooo...
    ........
  `),
  // a spark
  spark: g(`
    ...oo...
    ...oeo..
    ooooeooo
    oeeeceeo
    oooeoooo
    ..oeo...
    ...oo...
    ........
  `),
  // a plain round
  plain: g(`
    ..oooo..
    .occcco.
    occcccCo
    occcccCo
    occccCCo
    occcCCCo
    .oCCCCo.
    ..oooo..
  `),
});

/** Jev's thought pictures (he never speaks): a pile being sorted, and the scales tilting. */
export const THOUGHT_ICONS = freeze({
  pile: g(`
    ........
    ...oo...
    ..ouuo..
    .oooooo.
    .oeeeeo.
    oooooooo
    okkookko
    oooooooo
  `),
  tilt: g(`
    ...ooo..
    ..owwwo.
    .owwowwo
    owwwwwwo
    owwwwwUo
    .owwwUUo
    ..oooooo
    ........
  `),
});

/** The board's markers (COMBAT.md §13): rings under units, side shapes, the path, cover, height and more. */
export const MARKERS = freeze({
  // under the active unit: a cream ring, and the target's red ring with gaps
  active: g(`
    ....oooooooooo....
    ..oocccccccccccoo.
    .occo.........occo
    ..oocccccccccccoo.
    ....oooooooooo....
  `).map((r) => r.padEnd(18, '.')),
  target: g(`
    ....oooo..oooo....
    ..oorrro..orrroo..
    .orro..........oro
    ..oorrro..orrroo..
    ....oooo..oooo....
  `).map((r) => r.padEnd(18, '.')),
  // sides by shape: an ally's circle, a foe's diamond, a bystander's square
  ally: g(`
    .ooo.
    olllo
    olclo
    olllo
    .ooo.
  `),
  foe: g(`
    ..o..
    .oro.
    orcro
    .oro.
    ..o..
  `),
  neutral: g(`
    ooooo
    ouuuo
    oucuo
    ouuuo
    ooooo
  `),
  pathDot: g(`
    .o.
    oco
    .o.
  `),
  // cover: a low wall and a high one
  coverLow: g(`
    .......
    .......
    .......
    ooooooo
    osSsSso
    oSsSsSo
    ooooooo
  `),
  coverHeavy: g(`
    ooooooo
    osSsSso
    oSsSsSo
    osSsSso
    oSsSsSo
    osSsSso
    ooooooo
  `),
  heightUp: g(`
    ..o..
    .oco.
    ococo
    oo.oo
  `),
  heightDown: g(`
    oo.oo
    ococo
    .oco.
    ..o..
  `),
  // a reach bracket (how far a melee reaches)
  reach: g(`
    ooo.ooo
    oco.oco
    oo...oo
    .......
    oo...oo
    oco.oco
    ooo.ooo
  `),
  // an eye (a foe's adapting, a Seek)
  eye: g(`
    ..oooo..
    .occcco.
    occoocco
    .occcco.
    ..oooo..
  `),
  // a spotted feint: '!' (reserved otherwise for needs-you)
  feint: g(`
    ooo
    oco
    oco
    oco
    ooo
    oco
    ooo
  `),
  // a Cheer: a four-point sparkle
  cheer: g(`
    ...o...
    ..ouo..
    .oouoo.
    ouucuuo
    .oouoo.
    ..ouo..
    ...o...
  `),
});

/** Outcome flashes, three frames each (150 ms over the hit reaction): a Critical's star-sparkle, a Graze's scuff and a Miss's whiff. */
export const FLASHES = freeze({
  crit: freeze([
    g(`
      .........
      .........
      ....c....
      ...cuc...
      ....c....
      .........
      .........
    `),
    g(`
      ....c....
      ....u....
      ..u.c.u..
      .cucccuc.
      ..u.c.u..
      ....u....
      ....c....
    `),
    g(`
      c...u...c
      .u..c..u.
      ....u....
      uc.u.u.cu
      ....u....
      .u..c..u.
      c...u...c
    `),
  ]),
  graze: freeze([
    g(`
      .......
      ....C..
      ...C...
      .......
      .......
    `),
    g(`
      .....C.
      ...CC..
      ..CC.C.
      .C.C...
      .......
    `),
    g(`
      .......
      .....C.
      ..C....
      .C...C.
      ...C...
    `),
  ]),
  miss: freeze([
    g(`
      .........
      .......c.
      ......c..
      .........
      .........
    `),
    g(`
      .........
      ....ccc..
      ..cc...c.
      .c.......
      .........
    `),
    g(`
      .........
      .....c.c.
      ..c......
      .c.......
      .........
    `),
  ]),
});

/** Every 8 × 8 icon set, for the tests and the capture sheet. */
export const ICON_SETS = freeze({ intent: INTENT_ICONS, condition: CONDITION_ICONS, kind: KIND_ICONS, thought: THOUGHT_ICONS });
