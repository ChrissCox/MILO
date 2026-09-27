// The building kit: every blueprint, however odd, becomes clean pixel art that fits its plot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHAPES, WALLS, ROOFS, DOORS, WINDOWS, COLOURS, YARDS, PROP_KINDS, PROP_SIDES, EMBLEM_KEYS, RAMPS, PROPS,
  drawBuilding, drawConstruction, drawEmptyPlot, drawRedesign, normalizeForKit, normalizeEmblem, resolveColours, makeSign, FOR_YOU_SIGN,
} from '../src/world/kit.js';
import { PALETTE } from '../src/world/sprites.js';
import { PLOT_IDS, buildableArea, plotGate } from '../src/world/map.js';

// The five real plots, plus a couple of odd sizes.
const PLOTS = [
  ...PLOT_IDS.map((id) => ({ id, ...buildableArea(id), gate: plotGate(id) })),
  { id: 'tiny', w: 4, h: 3 },
  { id: 'left-gate', w: 8, h: 5, gate: { side: 'left', at: 40 } },
];

const EMBLEM = [
  '............',
  '..oooooooo..',
  '.orrrrrrrro.',
  '.orrcrrrrro.',
  '.orrccrrrro.',
  '.orrcccrrro.',
  '.orrccccrro.',
  '.orrcccrrro.',
  '.orrccrrrro.',
  '.orrcrrrrro.',
  '.orrrrrrrro.',
  '..oooooooo..',
];

function blueprint(style, extra = {}) {
  return {
    version: 1, name: 'Test house', tagline: '', purpose: '',
    style: { shape: 'cottage', walls: 'plank', wallColor: 'cream', roof: 'gable', roofColor: 'clay', trim: 'woodDeep', door: 'plain', windows: 'square', chimney: false, flag: 'none', awning: 'none', ...style },
    emblem: EMBLEM, props: [], yard: 'grass', levels: [], ...extra,
  };
}

const at = (i, list) => list[i % list.length];

// A sampled matrix: every shape x roof x walls, with the other choices rotating through
// every value (doors, windows, colours, accents, chimneys, props, yards and plot sizes).
function* matrix() {
  let i = 0;
  for (const shape of SHAPES) {
    for (const roof of ROOFS) {
      for (const walls of WALLS) {
        i += 1;
        const props = Array.from({ length: i % 5 }, (_, k) => ({ kind: at(i * 3 + k * 7, PROP_KINDS), side: at(i + k, PROP_SIDES) }));
        yield {
          plot: at(i, PLOTS),
          bp: blueprint({
            shape, roof, walls,
            wallColor: at(i, COLOURS), roofColor: at(i * 5 + 3, COLOURS), trim: at(i * 7 + 1, COLOURS),
            door: at(i, DOORS), windows: at(i * 3, WINDOWS), chimney: i % 3 === 0,
            flag: i % 4 === 0 ? 'none' : at(i * 11, COLOURS), awning: i % 3 === 1 ? at(i * 13, COLOURS) : 'none',
          }, { props, yard: at(i * 7, YARDS) }),
        };
      }
    }
  }
}

const KEYS = new Set(Object.keys(PALETTE));

function checkGrid(rows, w, h, label, { opaque = false } = {}) {
  assert.equal(rows.length, h, `${label}: height`);
  for (const row of rows) {
    assert.equal(row.length, w, `${label}: width`);
    for (const ch of row) {
      if (ch === '.') assert.ok(!opaque, `${label}: the flat picture has no holes`);
      else assert.ok(KEYS.has(ch), `${label}: '${ch}' is a palette key`);
    }
  }
}

// Pixels with no opaque neighbour at all (8-way) would read as specks floating in the air.
function floatingPixels(rows) {
  const lonely = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '.' || row[x] === 'x') continue;
      let company = false;
      for (let dy = -1; dy <= 1 && !company; dy += 1) for (let dx = -1; dx <= 1 && !company; dx += 1) {
        if ((dx || dy) && rows[y + dy] && rows[y + dy][x + dx] && rows[y + dy][x + dx] !== '.' && rows[y + dy][x + dx] !== 'x') company = true;
      }
      if (!company) lonely.push([x, y]);
    }
  });
  return lonely;
}

function checkBuilding(result, plot, label) {
  const W = plot.w * 16;
  const H = plot.h * 16;
  checkGrid(result.rows, W, H, `${label} rows`, { opaque: true });
  checkGrid(result.ground, W, H, `${label} ground`);
  checkGrid(result.sprite, W, H, `${label} sprite`);
  assert.ok(result.frames.length === 1 || result.frames.length === 2, `${label}: one or two frames`);
  assert.equal(result.frames[0], result.sprite);
  for (const frame of result.frames) checkGrid(frame, W, H, `${label} frame`);
  assert.deepEqual(result.size, { w: W, h: H });
  // The door sits on the building's bottom edge, facing the viewer (and so the plot's gate).
  const { door, anchor } = result;
  assert.equal(door.y, anchor.y, `${label}: the door is on the footprint's bottom edge`);
  assert.ok(door.x > 0 && door.x < W - 1 && door.y > 8 && door.y < H - 4, `${label}: the door is inside the plot`);
  const sprite = result.sprite;
  assert.equal(sprite[door.y][door.x], 'o', `${label}: the footprint's outline runs under the door`);
  for (const dy of [2, 4, 6]) assert.notEqual(sprite[door.y - dy][door.x], '.', `${label}: the door is solid ${dy} px up`);
  for (let y = door.y + 1; y < H; y += 1) assert.equal(sprite[y][door.x], '.', `${label}: nothing stands between the door and the gate`);
  assert.deepEqual(floatingPixels(sprite), [], `${label}: no floating pixels`);
  assert.ok(result.box && result.box.w > 20 && result.box.h > 20, `${label}: a building of some size`);
}

test('the kit speaks the blueprint vocabulary of the architect', async () => {
  let bp;
  try {
    bp = await import('../src/architect/blueprint.js');
  } catch {
    return; // the architect module is optional for the kit
  }
  assert.deepEqual([...bp.SHAPES], SHAPES);
  assert.deepEqual([...bp.WALLS], WALLS);
  assert.deepEqual([...bp.ROOFS], ROOFS);
  assert.deepEqual([...bp.DOORS], DOORS);
  assert.deepEqual([...bp.WINDOWS], WINDOWS);
  assert.deepEqual([...bp.COLOURS], COLOURS);
  assert.deepEqual([...bp.YARDS], YARDS);
  assert.deepEqual([...bp.PROP_KINDS], PROP_KINDS);
  assert.deepEqual([...bp.PROP_SIDES], PROP_SIDES);
  assert.deepEqual(Object.keys(bp.EMBLEM_KEYS).sort(), [...EMBLEM_KEYS].sort());
});

test('every colour has a full ramp of palette keys', () => {
  for (const colour of COLOURS) {
    const ramp = RAMPS[colour];
    assert.ok(ramp, colour);
    for (const step of ['hi', 'base', 'lo', 'deep']) assert.ok(KEYS.has(ramp[step]) && ramp[step] !== 'x', `${colour}.${step}`);
  }
  for (const key of EMBLEM_KEYS) assert.ok(KEYS.has(key), `emblem key ${key}`);
});

test('every prop is a clean rectangular sprite that fits beside a building', () => {
  assert.deepEqual(Object.keys(PROPS).sort(), [...PROP_KINDS].sort());
  for (const [kind, rows] of Object.entries(PROPS)) {
    const w = rows[0].length;
    assert.ok(w <= 16 && rows.length <= 18, `${kind} is small`);
    checkGrid(rows, w, rows.length, kind);
    assert.deepEqual(floatingPixels(rows), [], `${kind} has no floating pixels`);
    assert.ok(rows[rows.length - 1].includes('o'), `${kind} stands on the ground`);
  }
});

test('a sampled matrix of every shape, roof and wall renders cleanly on every plot', () => {
  let count = 0;
  for (const { plot, bp } of matrix()) {
    const result = drawBuilding(bp, plot);
    const s = bp.style;
    checkBuilding(result, plot, `${s.shape}/${s.roof}/${s.walls}/${s.door}/${s.windows} on ${plot.id}`);
    count += 1;
  }
  assert.equal(count, SHAPES.length * ROOFS.length * WALLS.length);
});

test('every wall colour with every roof colour stays clear of clashes', () => {
  for (const wallColor of COLOURS) {
    for (const roofColor of COLOURS) {
      const style = normalizeForKit(blueprint({ wallColor, roofColor, trim: roofColor })).style;
      const C = resolveColours(style);
      assert.notEqual(C.roof, C.wall, `${wallColor} walls never get a ${roofColor} roof of the same colour`);
      const luma = (key) => {
        const hex = PALETTE[key].hex;
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      assert.ok(Math.abs(luma(RAMPS[C.trim].base) - luma(RAMPS[C.wall].base)) >= 28, `${wallColor}: the trim stands out`);
    }
  }
  // A pair that already works is left alone.
  assert.deepEqual(resolveColours(normalizeForKit(blueprint({ wallColor: 'cream', roofColor: 'clay', trim: 'woodDeep' })).style).roof, 'clay');
});

test('every door, window, prop and yard shows up where it should', () => {
  for (const door of DOORS) checkBuilding(drawBuilding(blueprint({ door }), PLOTS[1]), PLOTS[1], `door ${door}`);
  for (const windows of WINDOWS) checkBuilding(drawBuilding(blueprint({ windows, shape: 'hall' }), PLOTS[0]), PLOTS[0], `windows ${windows}`);
  for (const yard of YARDS) checkBuilding(drawBuilding(blueprint({}, { yard }), PLOTS[3]), PLOTS[3], `yard ${yard}`);
  // Props: on the long meadow there is room for each of them, on any side.
  const meadow = PLOTS.find((p) => p.id === 'plot-meadow');
  for (let i = 0; i < PROP_KINDS.length; i += 4) {
    const kinds = PROP_KINDS.slice(i, i + 4);
    const result = drawBuilding(blueprint({}, { props: kinds.map((kind, k) => ({ kind, side: PROP_SIDES[k % 3] })) }), meadow);
    assert.deepEqual(result.props.map((p) => p.kind).sort(), [...kinds].sort(), `${kinds.join(', ')} all find a spot`);
    for (const prop of result.props) {
      assert.ok(prop.x >= 0 && prop.y >= 0 && prop.x + prop.w <= meadow.w * 16 && prop.y + prop.h <= meadow.h * 16, `${prop.kind} stays on the plot`);
    }
    checkBuilding(result, meadow, kinds.join('+'));
  }
});

test('props never cover the door or each other', () => {
  const plot = PLOTS[1];
  const result = drawBuilding(blueprint({ shape: 'shop' }, { props: [{ kind: 'well', side: 'front' }, { kind: 'bench', side: 'front' }, { kind: 'crates', side: 'left' }, { kind: 'barrels', side: 'left' }] }), plot);
  const boxes = result.props;
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    assert.ok(result.door.x < a.x - 1 || result.door.x > a.x + a.w, `${a.kind} keeps clear of the door`);
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.kind} and ${b.kind} don't overlap`);
    }
  }
});

test('a flag waves between two frames; a still building has one', () => {
  const flagged = drawBuilding(blueprint({ flag: 'blossom' }), PLOTS[1]);
  assert.equal(flagged.frames.length, 2);
  assert.notDeepEqual(flagged.frames[0], flagged.frames[1]);
  flagged.frames[0].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== flagged.frames[1][y][x]) assert.ok(y < flagged.anchor.y - 20, `only the flag moves (${x},${y})`);
  }));
  const plain = drawBuilding(blueprint({ flag: 'none' }), PLOTS[1]);
  assert.equal(plain.frames.length, 1);
  const smoky = drawBuilding(blueprint({ chimney: true }), PLOTS[1]);
  assert.ok(smoky.smoke && smoky.smoke.y >= 0 && smoky.smoke.y < smoky.anchor.y, 'a chimney says where its smoke rises');
  assert.equal(plain.smoke, null);
});

test('the sign shows the 12 x 12 emblem, and bad emblems are repaired', () => {
  const C = resolveColours(normalizeForKit(blueprint({})).style);
  const sign = makeSign(EMBLEM, C);
  checkGrid(sign, 16, 16, 'sign');
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) if (EMBLEM[y][x] !== '.') assert.equal(sign[y + 2][x + 2], EMBLEM[y][x]);
  assert.deepEqual(normalizeEmblem(['oo', null, 'ZZZZoooooooooooooooo']), [
    'oo..........', '............', '....oooooooo', ...Array.from({ length: 9 }, () => '............'),
  ]);
  assert.equal(normalizeEmblem('nope').length, 12);
  // Mostly-cream emblems go on a wooden board so they still read.
  const pale = Array.from({ length: 12 }, () => 'cccccccccccc');
  assert.equal(makeSign(pale, C)[5][1] !== undefined, true);
  assert.equal(makeSign(pale, C)[2][2], 'c');
  assert.equal(makeSign(['............', ...Array.from({ length: 11 }, () => '.cccccccccc.')], C)[2][2], 'b');
});

test('odd and hostile input still draws a tidy building', () => {
  const odd = [
    null, undefined, 42, 'house', [], {},
    { style: { shape: 'castle', walls: 'cheese', roof: '<script>', wallColor: 'red', door: 7, windows: null, chimney: 'yes', flag: 'rainbow', awning: {} } },
    { style: blueprint({}).style, emblem: 'not rows', props: [{ kind: 'dragon', side: 'up' }, null, { kind: 'lantern', side: 'sky' }], yard: 'lava' },
    { style: blueprint({}).style, props: Array.from({ length: 12 }, () => ({ kind: 'well', side: 'front' })) },
  ];
  for (const input of odd) {
    for (const plot of [PLOTS[0], PLOTS[3], PLOTS[5]]) checkBuilding(drawBuilding(input, plot), plot, `odd input ${JSON.stringify(input)?.slice(0, 40)}`);
  }
  const clean = normalizeForKit(odd[7]);
  assert.deepEqual(clean.props, [{ kind: 'lantern', side: 'front' }]);
  assert.equal(clean.yard, 'grass');
  assert.equal(normalizeForKit(odd[8]).props.length, 4, 'at most four props');
  // Plot sizes are clamped, never trusted.
  const huge = drawBuilding(blueprint({}), { w: 999, h: -3 });
  assert.equal(huge.rows[0].length, 24 * 16);
  assert.equal(huge.rows.length, 3 * 16);
});

test('the same blueprint always draws the same building', () => {
  const bp = blueprint({ shape: 'barn', walls: 'stone', roof: 'thatch', flag: 'leaf', chimney: true }, { props: [{ kind: 'beehive', side: 'left' }], yard: 'garden' });
  assert.deepEqual(drawBuilding(bp, PLOTS[0]), drawBuilding(structuredClone(bp), PLOTS[0]));
});

test('empty plots and building sites fit every plot', () => {
  for (const plot of PLOTS) {
    const W = plot.w * 16;
    const H = plot.h * 16;
    const empty = drawEmptyPlot(plot);
    checkGrid(empty.rows, W, H, `${plot.id} empty`, { opaque: true });
    checkGrid(empty.sprite, W, H, `${plot.id} empty sprite`);
    assert.deepEqual(floatingPixels(empty.sprite), [], `${plot.id}: the empty plot's stakes and sign stand on the ground`);
    const stages = [0, 1, 2, 3].map((stage) => drawConstruction(plot, stage));
    stages.forEach((site, stage) => {
      checkGrid(site.rows, W, H, `${plot.id} stage ${stage}`, { opaque: true });
      checkGrid(site.ground, W, H, `${plot.id} stage ${stage} ground`);
      checkGrid(site.sprite, W, H, `${plot.id} stage ${stage} sprite`);
      assert.deepEqual(floatingPixels(site.sprite), [], `${plot.id} stage ${stage}: no floating pixels`);
      assert.ok(site.anchor.y > 0 && site.anchor.y < H);
    });
    for (let i = 1; i < 4; i += 1) assert.notDeepEqual(stages[i].sprite, stages[i - 1].sprite, `${plot.id}: stage ${i} moves the build along`);
  }
  assert.deepEqual(drawConstruction(PLOTS[0], 99).sprite, drawConstruction(PLOTS[0], 3).sprite, 'stages are clamped');
  assert.deepEqual(drawConstruction(PLOTS[0], 'x').sprite, drawConstruction(PLOTS[0], 0).sprite);
  assert.ok(FOR_YOU_SIGN.join('').includes('c'), 'the "For you" sign has a cream board');
});

test('a grass yard has a sand path from the door to the gate', () => {
  const sand = (ch) => ch === 'p' || ch === 'P';
  for (const plot of PLOTS.filter((p) => p.gate)) {
    const W = plot.w * 16;
    const H = plot.h * 16;
    const art = drawBuilding(blueprint({ shape: 'barn' }, { yard: 'grass' }), plot);
    const g = art.ground;
    const at = Math.min(Math.max(Math.round(plot.gate.at), 6), (plot.gate.side === 'bottom' ? W : H) - 7);
    const edge = [];
    for (let d = -3; d <= 3; d += 1) {
      if (plot.gate.side === 'bottom') edge.push(g[H - 1][at + d]);
      else edge.push(g[at + d][plot.gate.side === 'right' ? W - 1 : 0]);
    }
    assert.ok(edge.some(sand), `${plot.id}: the path reaches the gate`);
    const below = [0, 1, 2, 3].map((dy) => (g[art.door.y + dy] || '')[art.door.x]);
    assert.ok(below.some(sand), `${plot.id}: the path starts at the door`);
  }
});

test('side props gather by the walls on a long plot', () => {
  const meadow = PLOTS.find((p) => p.id === 'plot-meadow');
  const props = [{ kind: 'lantern', side: 'right' }, { kind: 'signboard', side: 'right' }, { kind: 'bench', side: 'left' }];
  const art = drawBuilding(blueprint({ shape: 'hall', walls: 'stone', roof: 'hip' }, { props }), meadow);
  const [lantern, signboard] = ['lantern', 'signboard'].map((kind) => art.props.find((p) => p.kind === kind));
  assert.ok(lantern && signboard, 'both right-hand props find a spot');
  // The second one tucks in further back by the same wall (when the eaves leave room) instead of
  // trailing off along the meadow.
  assert.ok(signboard.x < lantern.x + lantern.w && lantern.x < signboard.x + signboard.w, 'they share the strip beside the wall');
  assert.ok(art.box.w <= 164, `the building and its props stay compact (${art.box.w} px), so the panel can draw them at 2x`);
});

test('a building being redesigned stays itself, with a clean scaffold round it', () => {
  let count = 0;
  for (const { plot, bp } of matrix()) {
    if (count++ % 7) continue; // a sample across every shape, roof and wall
    const label = `${bp.style.shape}/${bp.style.roof} on ${plot.id}`;
    const built = drawBuilding(bp, plot);
    const redo = drawRedesign(bp, plot);
    checkBuilding(redo, plot, `${label} redesign`);
    assert.deepEqual(redo.ground, built.ground, `${label}: the same yard`);
    assert.equal(redo.frames.length, built.frames.length, `${label}: the flag still waves`);
    assert.notDeepEqual(redo.sprite, built.sprite, `${label}: the scaffold shows`);
    // Most of the building still shows through.
    let kept = 0;
    let solid = 0;
    built.sprite.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) if (row[x] !== '.') { solid += 1; if (redo.sprite[y][x] === row[x]) kept += 1; } });
    assert.ok(kept / solid > 0.7, `${label}: ${Math.round((100 * kept) / solid)}% of the building still shows`);
  }
});
