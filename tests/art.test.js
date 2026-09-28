// Phase 3 art (CONTRACT-PHASE3.md §9 D): every new sprite is registered with its frames, is a clean
// palette-only grid, and composes the way the engine and the wilds expect. Colour tables recolour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRITES, PALETTE, MILO, ECHO_ICONS, mirror, stamp, rgbaOf, rowsToImageData, buildAtlas, baseTable, spriteSize,
} from '../src/world/sprites.js';
import { GATES, HEART } from '../src/world/worldgen.js';

// name -> frames
const NEW_SPRITES = {
  'tree.birch': 2,
  'pine.snow': 2,
  crag: 1,
  'crag.snow': 1,
  'basalt.column': 1,
  'rock.basalt': 1,
  'dice.stone': 1,
  'lantern.post': 2, // sleeping, lit
  ruin: 1,
  cave: 1,
  chest: 2, // closed, open
  'chest.mimic': 2, // closed, awake
  note: 1,
  hamlet: 1,
  statue: 1,
  'landmark.stone': 1,
  'ore.node': 1,
  herbs: 1,
  'fishing.spot': 2,
  thicket: 2, // two variants
  'palisade.post': 1,
  'palisade.n': 1,
  'palisade.s': 1,
  'palisade.e': 1,
  'palisade.w': 1,
  'palisade.jamb': 1, // the low end of the wall just south of the w and e gates
  gatehouse: 2, // facing you, end-on
  'gate.bell': 1,
  'war.table': 1,
  banner: 2,
  'bridge.h': 1,
  'exit.door': 1,
  curio: 1,
  'echo.moon': 1,
  'echo.knocker': 1,
  'echo.spark': 1,
  'echo.star': 1,
  'echo.crack': 1,
  'milo.chop.down': 2,
  'milo.chop.up': 2,
  'milo.chop.left': 2,
  'milo.chop.right': 2,
};

// The palette as it stood before Phase 3: the art adds no colours.
const STEP2_KEYS = 'o c C g G h j q l L p P w W f b B n m s S r R k u U e E v V t x z K Y Q N M'.split(' ');

const hasPixels = (row) => /[^.]/.test(row);
const keysIn = (rows) => new Set(rows.join('').replace(/\./g, ''));
const blank = (w, h) => Array.from({ length: h }, () => '.'.repeat(w));
const countOf = (rows, key) => rows.join('').split(key).length - 1;
// Coloured pixels (not ink) that touch transparency or the canvas edge: gaps in the outline.
const openPixels = (rows) => rows.flatMap((row, y) => [...row].flatMap((ch, x) => {
  if (ch === '.' || ch === 'o') return [];
  const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const v = rows[y + dy]?.[x + dx];
    return v === undefined || v === '.';
  });
  return open ? [`${x},${y}`] : [];
}));

// Palisade cells compose like the fences (and like scripts/capture-sprites.mjs and the chunk
// capture): n, w, e, then the post, then s aligned to the cell's bottom row.
const piece = (k) => SPRITES[`palisade.${k}`][0];
function composePalisade(mask) {
  const { w, h } = spriteSize('palisade.post');
  let rows = blank(w, h);
  for (const k of ['n', 'w', 'e']) if (mask[k]) rows = stamp(rows, piece(k), 0, 0);
  rows = stamp(rows, piece('post'), 0, 0);
  if (mask.s) rows = stamp(rows, piece('s'), 0, h - piece('s').length);
  return rows;
}

test('every Phase 3 sprite is registered with its frames', () => {
  for (const [name, count] of Object.entries(NEW_SPRITES)) {
    assert.ok(SPRITES[name], `${name} is registered`);
    assert.equal(SPRITES[name].length, count, `${name} has ${count} frame(s)`);
    assert.equal(spriteSize(name).frames, count);
  }
});

test('new grids are rectangular, palette-only and the same size in every frame', () => {
  for (const name of Object.keys(NEW_SPRITES)) {
    const frames = SPRITES[name];
    const w = frames[0][0].length;
    const h = frames[0].length;
    assert.ok(w > 0 && h > 0, name);
    frames.forEach((rows, i) => {
      assert.equal(rows.length, h, `${name}#${i} height`);
      rows.forEach((row, y) => {
        assert.equal(typeof row, 'string', `${name}#${i} row ${y} is a string`);
        assert.equal(row.length, w, `${name}#${i} row ${y} width`);
        for (const ch of row) assert.ok(ch === '.' || PALETTE[ch], `${name}#${i} row ${y} has '${ch}'`);
      });
      assert.ok(rows.some(hasPixels), `${name}#${i} isn't empty`);
    });
  }
});

test('no new palette keys, and the palette stays soft', () => {
  assert.deepEqual(Object.keys(PALETTE).sort(), [...STEP2_KEYS].sort());
  assert.ok(Object.keys(PALETTE).length <= 40);
  for (const name of Object.keys(NEW_SPRITES)) {
    for (const rows of SPRITES[name]) for (const key of keysIn(rows)) assert.notEqual(PALETTE[key].hex, '#000000');
  }
});

test('objects stand on their tile: their bottom row is drawn', () => {
  // palisade.n is a piece lifted half a tile north; icons float; ripples lie on the water.
  const floating = new Set(['palisade.n', 'fishing.spot', 'echo.moon', 'echo.knocker', 'echo.spark', 'echo.star', 'echo.crack']);
  for (const name of Object.keys(NEW_SPRITES)) {
    if (floating.has(name)) continue;
    SPRITES[name].forEach((rows, i) => assert.ok(hasPixels(rows[rows.length - 1]), `${name}#${i} has no empty bottom row`));
  }
});

test('lantern.post sleeps cold and wakes warm', () => {
  const [sleeping, lit] = SPRITES['lantern.post'];
  const warm = (rows) => ['u', 'U'].some((key) => keysIn(rows).has(key));
  assert.ok(warm(lit), 'the lit frame glows (u or U)');
  assert.ok(!warm(sleeping), 'the sleeping frame has no glow keys');
  // only the glass changes
  const changed = sleeping.flatMap((row, y) => [...row].map((ch, x) => (ch === lit[y][x] ? null : [x, y]))).filter(Boolean);
  assert.ok(changed.length > 0 && changed.length <= 12, `${changed.length} pixels change`);
});

test('chests open, and the mimic gives itself away', () => {
  const [closed, open] = SPRITES.chest;
  const [mimicClosed, awake] = SPRITES['chest.mimic'];
  assert.notDeepEqual(closed, open);
  assert.ok(keysIn(open).has('u') && !keysIn(closed).has('c'), 'gold only shows when open');
  const diff = closed.flatMap((row, y) => [...row].filter((ch, x) => ch !== mimicClosed[y][x]));
  assert.ok(diff.length > 0 && diff.length <= 3, 'the closed mimic is a chest with a small tell');
  assert.ok(keysIn(awake).has('k'), 'the awake mimic shows its tongue');
});

test('palisade pieces compose by mask like the fences', () => {
  const names = ['n', 'w', 'e', 'post', 's'].map((k) => `palisade.${k}`);
  const { w, h } = spriteSize('palisade.post');
  assert.equal(w, 16);
  for (const name of names) assert.deepEqual([spriteSize(name).w, spriteSize(name).h], [w, h], `${name} is a full cell`);
  const colsUsed = (rows) => new Set(rows.flatMap((row) => [...row].map((ch, x) => (ch === '.' ? -1 : x)).filter((x) => x >= 0)));
  const within = (rows, from, to) => [...colsUsed(rows)].every((x) => x >= from && x <= to);
  assert.ok(within(piece('post'), 4, 12), 'the post stands on the tile centre');
  assert.ok(within(piece('w'), 0, 3), 'w is the west half-log');
  assert.ok(within(piece('e'), 12, 15), 'e is the east half-log');
  assert.ok(piece('n').slice(-8).every((row) => !hasPixels(row)), 'n sits half a tile north');
  // e and the post share their outline column, so stamping order can't leave a seam
  for (let y = 0; y < h; y += 1) {
    const e = piece('e')[y][12];
    if (e !== '.') assert.equal(e, piece('post')[y][12], `row ${y} col 12`);
  }
  // compose like FENCE_GRIDS: a run west-to-east closes the east half-log with the next tile's west half
  const run = [composePalisade({ e: 1 }), composePalisade({ e: 1, w: 1 }), composePalisade({ w: 1 })].reduce((rows, cell, i) => stamp(rows, cell, i * 16, 0), blank(48, h));
  const base = run[h - 1];
  assert.match(base.slice(4, 45), /^o+$/, 'the foot of the run is one unbroken line');
  for (let x = 4; x <= 44; x += 1) {
    const column = run.map((row) => row[x]).join('');
    assert.match(column, /^\.*[^.]+$/, `column ${x} is solid from its point to the ground`);
  }
});

test('a north-south palisade run is one solid double row, not a single column of tips', () => {
  const { h } = spriteSize('palisade.post');
  // five tiles from north to south, drawn in the engine's order (north first), 16 px apart
  const masks = [{ s: 1 }, { n: 1, s: 1 }, { n: 1, s: 1 }, { n: 1, s: 1 }, { n: 1 }];
  const run = masks.reduce((rows, mask, i) => stamp(rows, composePalisade(mask), 0, i * 16), blank(16, h + 16 * (masks.length - 1)));
  const top = run.findIndex(hasPixels);
  for (let y = top; y < run.length; y += 1) assert.ok(hasPixels(run[y]), `row ${y} of the run has wood in it`);
  assert.match(run[run.length - 1], /^\.*o+\.*$/, 'the run ends on the ground in one ink line');
  // Where the n logs stand the wall is a double row, nearly a tile wide, so a west or east wall
  // has the same weight as the north and south walls.
  const width = (row) => row.replace(/^\.+|\.+$/g, '').length;
  const middle = run.slice(top + 16, run.length - 16);
  const wideRows = middle.filter((row) => width(row) >= 14).length;
  assert.ok(wideRows / middle.length > 0.7, `${wideRows} of ${middle.length} rows in the middle of the run are 14+ px wide`);
  assert.ok(middle.every((row) => width(row) >= 9), 'never thinner than one log');
  // the n logs stand behind the post: both halves show in the lit and shaded woods
  assert.ok(keysIn(piece('n')).has('n') && keysIn(piece('n')).has('m'), 'a lit log and a shaded one');
  // and the top two rows of every piece but the post stay clear (see the side gates below)
  for (const k of ['n', 'w', 'e', 's']) assert.ok(piece(k).slice(0, 2).every((row) => !hasPixels(row)), `palisade.${k} keeps its top rows clear`);
});

test('the gatehouse leaves its gate tile open to walk through', () => {
  const [front, side] = SPRITES.gatehouse;
  assert.deepEqual([front[0].length, front.length], [32, 48]);
  assert.deepEqual([side[0].length, side.length], [32, 48]);
  // the gate tile is cols 8-23 of the cell; Milo (20 px tall) walks through cols 10-21
  for (let y = 48 - 24; y < 48; y += 1) {
    assert.match(front[y].slice(10, 22), /^\.+$/, `row ${y} of the passage is clear`);
  }
  // posts stand either side, on the ground
  assert.ok(hasPixels(front[47].slice(0, 10)) && hasPixels(front[47].slice(22)), 'two posts');
  // the end-on frame: one post on the ground, a roof, and the lantern hanging over the gateway
  assert.ok(hasPixels(side[47]) && keysIn(side).has('u') && keysIn(side).has('r'), 'a post, a roof and a lantern');
  // Drawn at dy -15 its bottom row is the gate tile's top edge, so Milo's head (20 px above his
  // feet, 13 px into the tile) reaches row 41. Above that the lantern and the roof hang clear.
  const headRow = 47 - (19 - 13); // Milo is drawn from 19 px above his feet: row 41
  const lantern = side.findLastIndex((row) => /[uU]/.test(row));
  assert.ok(lantern < headRow, `the lantern (row ${lantern}) hangs above Milo's head (row ${headRow})`);
  for (const row of side.slice(headRow)) assert.match(row, /^\.{11,}[^.]+\.{11,}$/, 'below that, only the post and its footing');
});

test('the jamb ends the wall low beside the west and east gates', () => {
  const rows = SPRITES['palisade.jamb'][0];
  const { w, h } = spriteSize('palisade.jamb');
  assert.equal(w, 16, 'as wide as a palisade cell');
  // It stands on its tile's bottom edge and rises at most 2 px into the gate tile, which ends
  // 3 px below Milo's feet there.
  assert.ok(h <= 16 + 2, `${h} px tall`);
  assert.ok(hasPixels(rows[h - 1]) && hasPixels(rows[0]), 'it uses its full height, feet on the ground');
  assert.ok(keysIn(rows).has('n') && keysIn(rows).has('m'), 'the same logs as the wall');
});

// ---------- the ring's gates, composed the way the engine draws them ----------
// engine.js: an object sorts at (y + h) * 16 + dy and is drawn centred on its tile with its bottom
// row there; Milo sorts half a pixel below his feet (13 px into his tile) and is drawn from 19 px
// above them (a pixel higher mid-stride). Whatever is drawn after Milo covers him.
const TILE = 16;
const FEET = 13;
const GATE_LIST = Object.entries(GATES).map(([id, g]) => ({ id, x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y, sideOn: g.dir.x !== 0 }));
const inHeart = (x, y) => x >= 0 && x < HEART.w && y >= 0 && y < HEART.h;
const isRing = (x, y) => x >= -1 && x <= HEART.w && y >= -1 && y <= HEART.h && !inHeart(x, y);
const gateAt = (x, y) => GATE_LIST.find((g) => g.x === x && g.y === y);
const jambTile = (x, y) => !!gateAt(x, y - 1)?.sideOn;

// The ring around one gate as wilds.ringObjects lays it out (CONTRACT-PHASE3.md §3), with every
// wall tile on land, the most that can stand there. Masks join walls and gates. From tier 2 each
// gate has its gatehouse (facing, dy 0, in the north and south walls; end-on, dy -15, in the west
// and east walls), and the wall tile just south of a west or east gate holds the jamb.
function ringNear(gate, tier, { thicket = 0, jamb = true, jambJoins = true } = {}) {
  const joins = (x, y) => isRing(x, y) && (jambJoins || !jambTile(x, y));
  const out = [];
  for (let y = gate.y - 4; y <= gate.y + 4; y += 1) {
    for (let x = gate.x - 4; x <= gate.x + 4; x += 1) {
      if (!isRing(x, y)) continue;
      const g = gateAt(x, y);
      if (g) {
        if (tier >= 2) out.push({ x, y, dy: g.sideOn ? -15 : 0, rows: SPRITES.gatehouse[g.sideOn ? 1 : 0] });
      } else if (tier < 2) {
        out.push({ x, y, dy: 0, rows: SPRITES.thicket[thicket] });
      } else if (jamb && jambTile(x, y)) {
        out.push({ x, y, dy: 0, rows: SPRITES['palisade.jamb'][0] });
      } else {
        out.push({ x, y, dy: 0, rows: composePalisade({ n: joins(x, y - 1), s: joins(x, y + 1), e: joins(x + 1, y), w: joins(x - 1, y) }) });
      }
    }
  }
  return out;
}

// How many of Milo's pixels the ring draws over, with his feet at world px (px, py).
function hiddenPixels(objects, { px, py, rows, bob = 0 }) {
  const covered = new Set();
  for (const o of objects) {
    const baseY = (o.y + 1) * TILE + o.dy;
    if (baseY < py + 0.5) continue; // drawn before Milo
    const sx = Math.round((o.x + 0.5) * TILE - o.rows[0].length / 2);
    const sy = baseY - o.rows.length;
    o.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') covered.add(`${sx + x},${sy + y}`); }));
  }
  const mx = Math.round(px - 8);
  const my = Math.round(py - 19 + bob);
  let hidden = 0;
  let total = 0;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    total += 1;
    if (covered.has(`${mx + x},${my + y}`)) hidden += 1;
  }));
  return { hidden, total };
}

// Every pose Milo can stand or walk in, facing each way.
const MILO_POSES = ['down', 'up', 'left', 'right'].flatMap((dir) => [
  ...SPRITES[`milo.${dir}`].flatMap((rows, frame) => [{ dir, rows, bob: 0 }, ...(frame ? [{ dir, rows, bob: -1 }] : [])]),
  { dir, rows: SPRITES[`milo.breath.${dir}`][0], bob: 0 },
]);
// Milo's feet as he stands on a gate tile and walks through it, a tile either side.
const stepsThrough = (gate) => Array.from({ length: 17 }, (_, i) => (i - 8) * 2).map((d) => (gate.sideOn
  ? { px: gate.x * TILE + 8 + d, py: gate.y * TILE + FEET }
  : { px: gate.x * TILE + 8, py: gate.y * TILE + FEET + d }));

test('at tier 2 Milo walks through every gate in full view', () => {
  assert.equal(GATE_LIST.length, 4);
  for (const gate of GATE_LIST) {
    const ring = ringNear(gate, 2);
    // standing on the gate tile, nothing at all is drawn over him
    const onGate = { px: gate.x * TILE + 8, py: gate.y * TILE + FEET };
    for (const pose of MILO_POSES) {
      const { hidden } = hiddenPixels(ring, { ...onGate, ...pose });
      assert.equal(hidden, 0, `${gate.id}: Milo facing ${pose.dir} on the gate tile is covered by ${hidden} px`);
    }
    // Walking through, a tile either side, no wall or jamb ever covers him. (Beyond the north
    // gate's arch its lintel and lantern pass in front of him, as they should: he's behind it.)
    const walls = ring.filter((o) => !gateAt(o.x, o.y));
    for (const at of stepsThrough(gate)) {
      for (const pose of MILO_POSES) {
        const { hidden } = hiddenPixels(walls, { ...at, ...pose });
        assert.equal(hidden, 0, `${gate.id}: Milo facing ${pose.dir} at (${at.px}, ${at.py}) is covered by ${hidden} px`);
      }
    }
  }
});

test('the side gates stay open whether or not the jamb joins the wall south of it', () => {
  for (const gate of GATE_LIST.filter((g) => g.sideOn)) {
    const onGate = { px: gate.x * TILE + 8, py: gate.y * TILE + FEET };
    for (const pose of MILO_POSES) {
      assert.equal(hiddenPixels(ringNear(gate, 2, { jambJoins: false }), { ...onGate, ...pose }).hidden, 0, `${gate.id} facing ${pose.dir}`);
    }
    // Without the jamb, the full-height wall south of the gate would swallow him: that's why it's there.
    const { hidden, total } = hiddenPixels(ringNear(gate, 2, { jamb: false }), { ...onGate, rows: MILO.left[0] });
    assert.ok(hidden / total > 0.25, `${gate.id}: a palisade there hides ${Math.round((hidden / total) * 100)}%`);
  }
});

test('at tier 1 the thicket leaves the gateways open, brushing his sleeves and boots at most', () => {
  // The hedge is 2 px wider than its tile on each side so neighbours meet; in a gateway that edge
  // of leaves brushes Milo's outline, and nothing more.
  for (const gate of GATE_LIST) {
    for (const thicket of [0, 1]) {
      const ring = ringNear(gate, 1, { thicket });
      for (const at of stepsThrough(gate)) {
        for (const pose of MILO_POSES) {
          const { hidden, total } = hiddenPixels(ring, { ...at, ...pose });
          assert.ok(hidden / total <= 0.07, `${gate.id}: ${hidden} of ${total} px hidden facing ${pose.dir}`);
        }
      }
    }
  }
});

test('sway frames keep their outline: nothing is pushed off the canvas', () => {
  for (const name of ['tree.birch', 'pine.snow', 'banner']) {
    const frames = SPRITES[name];
    assert.equal(frames.length, 2, name);
    frames.forEach((rows, i) => {
      assert.equal(countOf(rows, 'o'), countOf(frames[0], 'o'), `${name}#${i} keeps all its ink`);
      rows.forEach((row, y) => {
        for (const ch of [row[0], row.at(-1)]) assert.ok(ch === '.' || ch === 'o', `${name}#${i} row ${y}: only ink meets the canvas edge`);
      });
    });
  }
  // the birch is closed in ink all round in both frames, like the vale's tree
  for (const name of ['tree', 'tree.birch']) {
    SPRITES[name].forEach((rows, i) => assert.deepEqual(openPixels(rows), [], `${name}#${i} has no gaps in its outline`));
  }
  // the snowy pine sways exactly like the vale's pine it's painted on
  SPRITES['pine.snow'].forEach((rows, i) => assert.equal(openPixels(rows).length, openPixels(SPRITES.pine[i]).length, `pine.snow#${i}`));
});

test('the thicket is two variants of one hedge tile', () => {
  const [a, b] = SPRITES.thicket;
  assert.notDeepEqual(a, b);
  for (const rows of [a, b]) {
    assert.ok(rows[0].length >= 16 && rows[0].length <= 24, 'about a tile wide, a little over so neighbours meet');
    assert.ok(rows.length >= 16, 'at least a tile tall');
    const leaves = [...rows.join('')].filter((ch) => 'qlLM'.includes(ch)).length;
    assert.ok(leaves / rows.join('').replace(/\./g, '').length > 0.6, 'mostly leaf');
  }
});

test('echo icons are small, ink-outlined and made of role keys', () => {
  assert.deepEqual(Object.keys(ECHO_ICONS).sort(), ['crack', 'knocker', 'moon', 'spark', 'star']);
  for (const [id, rows] of Object.entries(ECHO_ICONS)) {
    assert.ok(rows.length <= 10 && rows[0].length <= 10, `${id} fits 10 x 10`);
    assert.ok(keysIn(rows).has('o'), `${id} has an ink outline`);
    assert.deepEqual(SPRITES[`echo.${id}`][0], rows);
  }
});

test('Milo chops in four directions, two frames each, at his own size', () => {
  for (const dir of ['down', 'up', 'left', 'right']) {
    const frames = SPRITES[`milo.chop.${dir}`];
    for (const rows of frames) {
      assert.equal(rows.length, MILO.h);
      assert.equal(rows[0].length, MILO.w);
      assert.notDeepEqual(rows, MILO[dir][0], `${dir} holds an axe`);
      assert.ok(keysIn(rows).has('S'), `${dir}: the axe head is steel`);
    }
    assert.notDeepEqual(frames[0], frames[1], `${dir}: the axe moves`);
    // it's still Milo, standing where he stood: the axe covers only a little of him
    const stand = MILO[dir][0];
    for (const rows of frames) {
      let same = 0;
      let drawn = 0;
      stand.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === '.') return;
        drawn += 1;
        if (rows[y][x] === ch) same += 1;
      }));
      assert.ok(same / drawn > 0.85, `${dir}: ${Math.round((same / drawn) * 100)}% of Milo unchanged`);
    }
  }
  assert.deepEqual(SPRITES['milo.chop.left'], SPRITES['milo.chop.right'].map(mirror));
  assert.equal(MILO.headSplit, 11);
});

// The axe in a chop frame: its steel head and every changed pixel joined to it (4-way, through
// pixels that differ from his standing frame), and the chips: single pixels on his standing frame's
// clear ground, touching nothing (four-way).
function axeAndChips(rows, stand) {
  const changed = (x, y) => rows[y][x] !== stand[y][x];
  const axe = new Set();
  const queue = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if ((ch === 'S' || ch === 'z') && changed(x, y)) { axe.add(`${x},${y}`); queue.push([x, y]); }
  }));
  for (let i = 0; i < queue.length; i += 1) {
    const [x, y] = queue[i];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (ny < 0 || ny >= rows.length || nx < 0 || nx >= rows[0].length || axe.has(`${nx},${ny}`) || !changed(nx, ny) || rows[ny][nx] === '.') continue;
      axe.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  const clear = (x, y) => y < 0 || x < 0 || y >= rows.length || x >= rows[0].length || rows[y][x] === '.';
  const chips = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || stand[y][x] !== '.' || axe.has(`${x},${y}`)) return;
    if ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].every(([nx, ny]) => clear(nx, ny))) chips.push([x, y, ch]);
  }));
  return { axe, chips };
}

test('Milo’s strike shows a whole axe biting the wood, a small burst of chips, and nothing stray on his head', () => {
  for (const dir of ['down', 'up', 'left', 'right']) {
    const [wind, strike] = SPRITES[`milo.chop.${dir}`];
    const stand = MILO[dir][0];
    const { axe, chips } = axeAndChips(strike, stand);
    const at = (key) => [...axe].filter((k) => { const [x, y] = k.split(',').map(Number); return strike[y][x] === key; });
    const steel = [...at('S'), ...at('z')];
    // A head you can see at 1×: at least five steel pixels, each boxed in by ink, wood or its edge
    // (never touching the ground behind it), with a bright edge of three or more.
    assert.ok(steel.length >= 5, `${dir}: a real axe head (${steel.length} steel pixels)`);
    for (const k of steel) {
      const [x, y] = k.split(',').map(Number);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        assert.ok(ny < 0 || nx < 0 || nx > 15 || ny > 19 || strike[ny][nx] !== '.', `${dir}: steel at ${x},${y} is outlined`);
      }
    }
    assert.ok(at('c').length >= 3, `${dir}: the blade's bright edge (${at('c').length})`);
    assert.ok(at('B').length + at('n').length >= 1, `${dir}: a wooden handle joins the head`);
    if (dir !== 'up') assert.ok(at('t').length >= 2, `${dir}: both hands on the handle`);
    // From the side, level into the trunk: the edge reaches his front edge in the lower body.
    if (dir === 'left' || dir === 'right') {
      const front = dir === 'right' ? 15 : 0;
      const edge = at('c').map((k) => k.split(',').map(Number)).filter(([x, y]) => x === front && y >= MILO.headSplit);
      assert.ok(edge.length >= 3, `${dir}: the blade bites at his reach (${edge.length} px on column ${front})`);
    }
    // The burst: three or more single chips of wood, none of them beside his head (not even
    // corner to corner), where at 1× a chip reads as a speck in his hair.
    const head = (x, y) => y >= 0 && y < MILO.headSplit && x >= 0 && x < 16 && stand[y][x] !== '.';
    assert.ok(chips.length >= 3, `${dir}: a burst of chips (${chips.length})`);
    for (const [x, y, ch] of chips) {
      assert.ok('nbc'.includes(ch), `${dir}: chip '${ch}' at ${x},${y} is wood`);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) assert.ok(!head(x + dx, y + dy), `${dir}: chip at ${x},${y} is clear of his head`);
    }
    // Nothing on or beside his head but the axe itself and those chips: no stray speck.
    for (let y = 0; y < MILO.headSplit; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if (strike[y][x] === stand[y][x] || axe.has(`${x},${y}`)) continue;
        assert.ok(chips.some(([cx, cy]) => cx === x && cy === y), `${dir}: '${strike[y][x]}' at ${x},${y} by his head is part of the axe`);
      }
    }
    // Chips only fly on the strike.
    assert.equal(axeAndChips(wind, stand).chips.length, 0, `${dir}: no chips on the wind-up`);
  }
});

// ---------- colour tables ----------

const fakeImage = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
const pixel = (image, x, y) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('rowsToImageData draws in base colours by default', () => {
  const image = rowsToImageData(['o.', 'cx'], fakeImage);
  assert.deepEqual(pixel(image, 0, 0), rgbaOf('o'));
  assert.deepEqual(pixel(image, 1, 0), [0, 0, 0, 0], 'transparent stays clear');
  assert.deepEqual(pixel(image, 0, 1), rgbaOf('c'));
  assert.deepEqual(pixel(image, 1, 1), rgbaOf('x'), 'the translucent shadow keeps its alpha');
});

test('a colour table recolours, falls back for keys it leaves out, and treats [r,g,b] as opaque', () => {
  const table = { o: [10, 20, 30, 255], c: [200, 100, 50] };
  const image = rowsToImageData(['oc', 'u.'], fakeImage, table);
  assert.deepEqual(pixel(image, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(pixel(image, 1, 0), [200, 100, 50, 255]);
  assert.deepEqual(pixel(image, 0, 1), rgbaOf('u'), 'u is not in the table, so it keeps its base colour');
  // the same rows, different tables, different pixels
  const base = rowsToImageData(SPRITES['lantern.post'][1], fakeImage);
  const night = rowsToImageData(SPRITES['lantern.post'][1], fakeImage, { u: [60, 70, 160], U: [40, 50, 120], o: [20, 20, 40] });
  assert.notDeepEqual([...base.data], [...night.data]);
  assert.deepEqual(night.data.filter((_, i) => i % 4 === 3), base.data.filter((_, i) => i % 4 === 3), 'the shape is unchanged');
});

test('baseTable is a copy of the base colours', () => {
  const table = baseTable();
  assert.deepEqual(Object.keys(table).sort(), Object.keys(PALETTE).sort());
  table.o[0] = 0;
  assert.notEqual(rgbaOf('o')[0], 0, 'changing the copy leaves the palette alone');
});

test('buildAtlas takes a table (and optional names) for genre atlases', () => {
  const made = [];
  const createCanvas = (w, h) => {
    const canvas = {
      width: w,
      height: h,
      image: null,
      getContext: () => ({ createImageData: fakeImage, putImageData: (image) => { canvas.image = image; } }),
    };
    made.push(canvas);
    return canvas;
  };
  const whole = buildAtlas(createCanvas);
  assert.equal(Object.keys(whole).length, Object.keys(SPRITES).length, 'no options: every sprite, as before');
  const names = ['thicket', 'lantern.post'];
  const plain = buildAtlas(createCanvas, { names });
  const tinted = buildAtlas(createCanvas, { names, table: { l: [1, 2, 3], L: [4, 5, 6], u: [7, 8, 9] } });
  assert.deepEqual(Object.keys(tinted).sort(), [...names].sort());
  assert.equal(tinted.thicket.length, 2);
  assert.equal(tinted['lantern.post'].length, 2);
  assert.notDeepEqual([...plain.thicket[0].image.data], [...tinted.thicket[0].image.data]);
  assert.notDeepEqual([...plain['lantern.post'][1].image.data], [...tinted['lantern.post'][1].image.data]);
  assert.deepEqual([...plain['lantern.post'][0].image.data], [...tinted['lantern.post'][0].image.data], 'a sleeping lantern has none of those keys');
});
