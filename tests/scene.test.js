// The engine's helper modules for the world beyond the vale (CONTRACT-PHASE3.md §7.4, §13):
// scene-art.js, scene-rifts.js, scene-wilds.js and scene-elsewhere.js, in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPRITES, PALETTE, stamp } from '../src/world/sprites.js';
import { HEART, createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { RIFT_RADIUS, WOBBLE, bleedAt, bleedLobes as fxLobes, LOBE_OFFSET as FX_LOBE_OFFSET } from '../src/world/riftfx.js';
import {
  PALISADE_GRIDS, PALISADE_CELL, WILD_SHADOWS, palisadeName, isHushed, textRows, FONT_GLYPHS, tableFromPalette,
  BASE_RGBA, lampPoint, createPainter,
} from '../src/world/scene-art.js';
import { createRiftLayer, drawableRift, bleedReach, glideMs, GLIDE_MAX_MS, bleedLobes, LOBE_OFFSET, bleedOrder } from '../src/world/scene-rifts.js';
import { chunksInRect, allHeart, bleedTouches, bleedSignature, MAX_CANVASES } from '../src/world/scene-wilds.js';
import { scenePath, walkGoals } from '../src/world/scene-elsewhere.js';

const content = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const genres = content('genres');
const words = content('riftgen');
const riftgen = createRiftgen({ words, genres });

// A canvas stand-in: records its size and the pixels put into it.
function fakeCanvas(w, h) {
  const canvas = { width: w, height: h, pixels: null };
  canvas.getContext = () => ({
    createImageData: (iw, ih) => ({ width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) }),
    putImageData: (image) => { canvas.pixels = image.data; },
  });
  return canvas;
}

function wildSpec(genreIds, stage, salt = 0) {
  const weights = Object.fromEntries(genres.genres.map((g) => [g.id, genreIds.includes(g.id) ? 400 : 0.0001]));
  for (let seed = 1 + salt * 7919; seed < 20000 + salt * 7919; seed += 1) {
    const spec = riftgen.wildRift({ seed, tier: 2, depth: 1, weights });
    if (spec.stage === stage && spec.genres.length === genreIds.length && genreIds.every((g) => spec.genres.includes(g))) return spec;
  }
  throw new Error(`no ${genreIds} ${stage} spec`);
}
const riftOf = (spec, x, y, extra = {}) => ({ id: spec.id, key: `test:${spec.id}`, kind: 'real', spec, x, y, stage: spec.stage, warded: null, held: null, ...extra });

// ---------- scene-art ----------

test('palisade cells compose n, w, e, post, s at (0, 0) in a 16×36 cell', () => {
  assert.equal(Object.keys(PALISADE_GRIDS).length, 16);
  for (let bits = 0; bits < 16; bits += 1) {
    const mask = { n: !!(bits & 8), s: !!(bits & 4), e: !!(bits & 2), w: !!(bits & 1) };
    const rows = PALISADE_GRIDS[palisadeName(mask)];
    assert.equal(rows.length, PALISADE_CELL.h);
    for (const row of rows) assert.equal(row.length, PALISADE_CELL.w);
    let expected = Array.from({ length: 36 }, () => '.'.repeat(16));
    for (const side of ['n', 'w', 'e']) if (mask[side]) expected = stamp(expected, SPRITES[`palisade.${side}`][0], 0, 0);
    expected = stamp(expected, SPRITES['palisade.post'][0], 0, 0);
    if (mask.s) expected = stamp(expected, SPRITES['palisade.s'][0], 0, 0);
    assert.deepEqual([...rows], expected, palisadeName(mask));
    for (const row of rows) for (const ch of row) assert.ok(ch === '.' || PALETTE[ch], `palette key ${ch}`);
  }
  assert.equal(palisadeName({}), 'palisade:0000');
  assert.equal(palisadeName({ n: true, w: true }), 'palisade:1001');
});

test('every wilds shadow is a sane ellipse for a real sprite', () => {
  for (const [kind, [w, h, dy]] of Object.entries(WILD_SHADOWS)) {
    assert.ok(SPRITES[kind] || kind === 'palisade', `${kind} is a sprite`);
    assert.ok(w >= 6 && w <= 40 && h >= 2 && h <= 6 && Math.abs(dy) <= 2, kind);
  }
});

test('every sprite of the ring round the vale casts a shadow, the Stockade’s banners too', () => {
  const wilds = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: words.regionWords }) });
  const kinds = new Set();
  for (const level of [1, 2]) for (const o of wilds.ringObjects(level)) kinds.add(o.kind);
  assert.ok(kinds.has('banner') && kinds.has('thicket') && kinds.has('palisade'), [...kinds].join(', '));
  for (const kind of kinds) assert.ok(WILD_SHADOWS[kind], `${kind} has a shadow`);
  assert.deepEqual(WILD_SHADOWS.banner, [6, 2, 0], 'a narrow one at the foot of the pole');
});

test('the Hush on objects: none outside, all deep inside, a steady dither between', () => {
  assert.equal(isHushed({ x: 3, y: 4, hush: 0 }), false);
  assert.equal(isHushed({ x: 3, y: 4 }), false);
  assert.equal(isHushed({ x: 3, y: 4, hush: 255 }), true);
  let on = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) if (isHushed({ x, y, hush: 128 })) on += 1;
  assert.ok(on > 24 && on < 40, `about half the tiles at half hush (${on} of 64)`);
  assert.equal(isHushed({ x: -5, y: -7, hush: 100 }), isHushed({ x: -5, y: -7, hush: 100 }), 'deterministic, negative tiles too');
});

test('the pixel font writes every glyph, outlined, and never breaks on odd text', () => {
  for (const ch of FONT_GLYPHS) {
    const rows = textRows(ch === ' ' ? 'a a' : ch);
    assert.equal(rows.length, 7);
    assert.ok(rows.join('').includes('c'), `glyph ${ch} has pixels`);
  }
  const rows = textRows('+5 birch');
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.length === rows[0].length));
  // Every lit pixel has ink round it where it meets the clear.
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== 'c') return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(rows[y + dy]?.[x + dx] ?? '.', '.', `pixel ${x},${y} is outlined`);
  }));
  assert.equal(textRows('+5 BIRCH').join(), rows.join(), 'capitals and small letters read the same');
  assert.ok(textRows('日本 ☃').length === 7, 'unknown characters become spaces');
  assert.equal(textRows('+5 birch'), rows, 'cached');
});

test('colour tables keep the shadow translucent, and lamps are found', () => {
  const table = tableFromPalette({ g: [1, 2, 3], x: [9, 9, 9] });
  assert.deepEqual(table.g, [1, 2, 3, 255]);
  assert.deepEqual(table.x, BASE_RGBA.x, 'the shadow key keeps its own alpha');
  assert.deepEqual(table.o, BASE_RGBA.o, 'keys the palette leaves out keep their base colour');
  const lit = lampPoint(SPRITES['lantern.post'][1]);
  assert.ok(lit && lit.y > 8 && lit.y < 16 && lit.x > 9, 'the lit lantern burns in its hanging lamp');
  assert.equal(lampPoint(SPRITES['lantern.post'][0]), null, 'a sleeping lantern has no flame');
  assert.ok(lampPoint(SPRITES.gatehouse[0]), 'the gatehouse has a lantern');
});

test('the painter caches a grid per colour table, and mirrors and layers', () => {
  let made = 0;
  const painter = createPainter((w, h) => { made += 1; return fakeCanvas(w, h); });
  const rows = ['o.', 'gc'];
  const a = painter.grid(rows);
  assert.equal(painter.grid(rows), a, 'cached');
  assert.deepEqual([...a.pixels.slice(0, 4)], BASE_RGBA.o.map(Number));
  assert.equal(a.pixels[7], 0, 'clear stays clear');
  const green = tableFromPalette({ g: [0, 200, 0] });
  const b = painter.grid(rows, green, 'green');
  assert.notEqual(b, a);
  assert.deepEqual([...b.pixels.slice(8, 11)], [0, 200, 0]);
  const m = painter.grid(rows, null, 'base', { mirror: true });
  assert.deepEqual([...m.pixels.slice(4, 8)], BASE_RGBA.o.map(Number), 'mirrored: ink on the right');
  const layered = painter.grid(rows, null, 'two', { layers: ['00', '10'], table2: green });
  assert.deepEqual([...layered.pixels.slice(8, 11)], [0, 200, 0], 'layer 1 takes the second table');
  const d0 = painter.dissolve(['oooo', 'oooo'], 0, 8);
  const d8 = painter.dissolve(['oooo', 'oooo'], 8, 8);
  const count = (c) => { let n = 0; for (let i = 3; i < c.pixels.length; i += 4) if (c.pixels[i]) n += 1; return n; };
  assert.equal(count(d0), 8, 'step 0 keeps everything');
  assert.equal(count(d8), 0, 'the last step keeps nothing');
  assert.equal(count(painter.dissolve(['oooo', 'oooo'], 8, 8, { invert: true })), 8, 'an inverted dissolve gathers them all');
  const art = { rows: ['ab'], colours: { a: [1, 1, 1] } };
  const c = painter.art(art);
  assert.equal(painter.art(art), c);
  assert.equal(c.pixels[7], 0, 'keys without a colour stay clear');
  assert.equal(painter.made, made);
});

// ---------- scene-rifts ----------

test('a rift is drawn only placed, unheld, and never in the vale or on its ring', () => {
  const spec = wildSpec(['neon'], 'open');
  assert.equal(drawableRift(riftOf(spec, 40, -10)), true);
  assert.equal(drawableRift(riftOf(spec, 10, 10)), false, 'in the heart');
  assert.equal(drawableRift(riftOf(spec, 20, -1)), false, 'on the ring');
  assert.equal(drawableRift(riftOf(spec, HEART.w, 5)), false, 'on the east ring');
  assert.equal(drawableRift(riftOf(spec, 40, -10, { held: 'nights-off' })), false, 'held');
  assert.equal(drawableRift(riftOf(spec, null, null)), false, 'unplaced');
  assert.equal(drawableRift(null), false);
  assert.equal(bleedReach(riftOf(spec, 0, 0, { stage: 'gaping' })), (RIFT_RADIUS.gaping + WOBBLE / 2) * 16);
  assert.equal(bleedReach({ x: 0, y: 0, radius: 9, genre: 'iron' }), (9 + 2.5) * 16);
  assert.ok(glideMs(1) >= 300 && glideMs(100) === GLIDE_MAX_MS && GLIDE_MAX_MS <= 2000);
});

test('the rift layer glides a moved rift, keeps one bleed order, and closes with a seal', () => {
  const painter = createPainter(fakeCanvas);
  const layer = createRiftLayer({ genres, words, painter, walkable: () => true });
  const a = riftOf(wildSpec(['neon'], 'open'), 40, -12);
  const b = riftOf(wildSpec(['gothic'], 'open', 1), -20, 10);
  layer.setReal([b, a], 1000, true);
  const order = layer.bleeding().map((r) => r.id);
  assert.deepEqual(order.filter((id) => id.startsWith('rift:')), [a.id, b.id].sort(), 'sorted by id, whatever order they came in');
  assert.deepEqual([...layer.tiles()].sort(), ['-20,10', '40,-12']);
  // The urgency moved it: the tear glides, the bleed waits where it was until it arrives.
  layer.setReal([b, { ...a, x: 44, y: -12 }], 2000, true);
  const mid = layer.active(2200).find((it) => it.rift.id === a.id);
  assert.ok(mid.gliding && mid.x > 40 * 16 + 8 && mid.x < 44 * 16 + 8, 'part way there');
  assert.equal(layer.bleeding().find((r) => r.id === a.id).x, 40, 'the bleed stays until the rift arrives');
  const v = layer.version;
  assert.equal(layer.update(2000 + GLIDE_MAX_MS + 1), true, 'the glide ends within two seconds');
  assert.ok(layer.version > v);
  assert.equal(layer.bleeding().find((r) => r.id === a.id).x, 44);
  // With motion off a move is instant.
  layer.setReal([b, { ...a, x: 46, y: -12 }], null, false);
  assert.equal(layer.active(null).find((it) => it.rift.id === a.id).x, 46 * 16 + 8);
  // Closing: gone from the drawn set at once, the seal playing where it stood.
  assert.equal(layer.close(a.id, 'sealed', 5000, true), true);
  assert.equal(layer.active(5000).some((it) => it.rift.id === a.id), false);
  assert.equal(layer.closingCount(), 1);
  layer.update(5000 + 1300);
  assert.equal(layer.closingCount(), 0, 'the seal is over in about 1.2 s');
  assert.equal(layer.isClosed(a.id), true);
  // A rift that just leaves the list is removed quietly, and a later closeRift still plays for it.
  layer.setReal([], 6000, true);
  assert.equal(layer.close(b.id, 'let-go', 6100, true), true);
  assert.equal(layer.closingCount(), 1);
  // Leaving with { how } plays it too.
  const c = riftOf(wildSpec(['iron'], 'gaping'), 30, -20);
  layer.setReal([c], 7000, true);
  layer.setReal([{ ...c, how: 'stitched' }], 7100, true);
  assert.equal(layer.active(7100).length, 0);
  assert.equal(layer.closingCount(), 2);
});

test('the rift layer ignores wild and held rifts from the shell and keeps wild ones per chunk', () => {
  const layer = createRiftLayer({ genres, words, painter: createPainter(fakeCanvas) });
  const wild = { ...riftOf(wildSpec(['void'], 'open'), 50, -30), kind: 'wild', key: null };
  layer.setReal([wild, { ...riftOf(wildSpec(['noir'], 'open'), 60, -30), held: 'patient-knock' }], 0, false);
  assert.equal(layer.active(null).length, 0);
  layer.setWild('1,-1', [wild]);
  assert.equal(layer.active(null).length, 1);
  assert.equal(layer.entityById(wild.id, null).label.endsWith('· wild rift'), true);
  layer.close(wild.id, 'stitched', null, false);
  assert.equal(layer.active(null).length, 0);
  layer.setWild('1,-1', [wild]);
  assert.equal(layer.active(null).length, 0, 'a rift closed today stays closed when its chunk is rebuilt');
  layer.forgetClosed();
  layer.setWild('1,-1', [wild]);
  assert.equal(layer.active(null).length, 1, 'a new day forgets');
});

test('bleeds are listed real rifts first, then story, then wild, then standing bleeds, by id within each', () => {
  const standing = [{ x: 90, y: -40, radius: 6, genre: 'iron' }, { x: -60, y: 20, radius: 5, genre: 'gothic' }];
  const layer = createRiftLayer({ genres, words, painter: createPainter(fakeCanvas), standing });
  // Ids chosen so an order by id alone would interleave the kinds.
  const real = [riftOf(wildSpec(['neon'], 'open'), 40, -12, { id: 'rift:z' }), riftOf(wildSpec(['noir'], 'open'), 50, -12, { id: 'rift:m' })];
  const story = riftOf(wildSpec(['frontier'], 'hairline'), 32, -5, { id: 'rift:a', kind: 'story' });
  const wild = [
    { ...riftOf(wildSpec(['void'], 'open'), 60, -30, { id: 'rift:y' }), kind: 'wild', key: null },
    { ...riftOf(wildSpec(['gothic'], 'open'), 70, -30, { id: 'rift:b' }), kind: 'wild', key: null },
  ];
  layer.setReal([real[0], story, real[1]], 1000, true);
  layer.setWild('1,-1', wild);
  const want = ['rift:m', 'rift:z', 'rift:a', 'rift:b', 'rift:y', 'standing:-60,20', 'standing:90,-40'];
  assert.deepEqual(layer.bleeding().map((r) => r.id), want);
  // The same comparator for anyone else who asks riftfx about the same ground (the shell's pictures).
  assert.deepEqual([...layer.bleeding()].reverse().sort(bleedOrder).map((r) => r.id), want);
  assert.deepEqual([wild[0], story, real[0], wild[1], real[1]].sort(bleedOrder).map((r) => r.id), ['rift:m', 'rift:z', 'rift:a', 'rift:b', 'rift:y']);
  // A real rift sealing keeps its bleed, and its place among the real ones, until the seal is done.
  layer.close('rift:z', 'sealed', 2000, true);
  assert.deepEqual(layer.bleeding().map((r) => r.id), want);
  layer.update(2000 + 1300);
  assert.deepEqual(layer.bleeding().map((r) => r.id), want.filter((id) => id !== 'rift:z'));
});

test('a fusion bleeds as one lobe per genre: each story holds a side, interleaving round the tear', () => {
  const single = riftOf(wildSpec(['neon'], 'gaping'), 40, -20);
  assert.deepEqual(bleedLobes(single), [single], 'one genre, one bleed');
  const fusion = riftOf(wildSpec(['iron', 'neon'], 'gaping'), 40, -20);
  const lobes = bleedLobes(fusion);
  assert.equal(lobes.length, 2);
  assert.deepEqual(lobes.map((l) => l.spec.genres[0]).sort(), [...fusion.spec.genres].sort());
  assert.deepEqual(bleedLobes(fusion), lobes, 'the same every time');
  for (const lobe of lobes) {
    assert.equal(lobe.lobeOf, fusion.id);
    assert.ok(lobe.id.startsWith(`${fusion.id}~`));
    const d = Math.hypot(lobe.x - fusion.x, lobe.y - fusion.y);
    assert.ok(Math.abs(d - LOBE_OFFSET.gaping) < 0.3, `set off the tear by about ${LOBE_OFFSET.gaping} (${d})`);
  }
  // Out on each lobe's side its own genre holds the ground; round the tear both interleave.
  const genreAt = (x, y) => bleedAt(lobes, x, y, { genres });
  for (const lobe of lobes) {
    const dx = lobe.x - fusion.x;
    const dy = lobe.y - fusion.y;
    const seen = new Map();
    for (let i = 0; i < 64; i += 1) {
      const px = (fusion.x + 0.5 + dx * 1.6) * 16 + (i % 8) * 2 - 8;
      const py = (fusion.y + 0.5 + dy * 1.6) * 16 + Math.floor(i / 8) * 2 - 8;
      const g = genreAt(px, py);
      seen.set(g, (seen.get(g) || 0) + 1);
    }
    assert.ok((seen.get(lobe.spec.genres[0]) || 0) > 44, `${lobe.spec.genres[0]} holds its side (${[...seen]})`);
  }
  const middle = new Set();
  for (let i = 0; i < 64; i += 1) middle.add(genreAt((fusion.x + 0.5) * 16 + (i % 8) * 2 - 8, (fusion.y + 0.5) * 16 + Math.floor(i / 8) * 2 - 8));
  assert.ok(middle.has('iron') && middle.has('neon'), 'and they meet at the tear');
  // The lobes live in riftfx (scene-rifts only passes them on), so every consumer bleeds alike.
  assert.equal(bleedLobes, fxLobes);
  assert.equal(LOBE_OFFSET, FX_LOBE_OFFSET);
  // The layer hands out whole rifts in one order for ground and sprites; riftfx lobes the fusion,
  // so the fused rift reads exactly as its lobes and reaches as far as they do.
  const layer = createRiftLayer({ genres, words, painter: createPainter(fakeCanvas) });
  layer.setReal([fusion, single], 0, false);
  const bleeding = layer.bleeding();
  const ids = bleeding.map((r) => r.id).filter((id) => id.startsWith('rift:'));
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(ids.sort(), [fusion.id, single.id].sort(), 'the fusion comes whole');
  const asLobes = bleeding.flatMap((r) => (r.id === fusion.id ? lobes : [r]));
  for (let i = 0; i < 400; i += 1) {
    const px = (fusion.x - 8) * 16 + (i % 20) * 13;
    const py = (fusion.y - 8) * 16 + Math.floor(i / 20) * 13;
    assert.equal(bleedAt(bleeding, px, py, { genres }), bleedAt(asLobes, px, py, { genres }), `${px},${py}`);
  }
  assert.equal(bleedReach(fusion), (RIFT_RADIUS.gaping + WOBBLE / 2 + LOBE_OFFSET.gaping) * 16, 'a fusion reaches past its lobes');
  const lobe = lobes.reduce((a, b) => (a.x > b.x ? a : b));
  const edge = (lobe.x + 0.5) * 16 + (RIFT_RADIUS.gaping + WOBBLE / 2) * 16 - 4;
  assert.equal(bleedTouches(fusion, edge, (lobe.y + 0.5) * 16, 2, 2), true, 'a chunk its farthest lobe reaches is touched');
});

test('strays are built once per rift and stage, and stand still with motion off', () => {
  const layer = createRiftLayer({ genres, words, painter: createPainter(fakeCanvas), walkable: () => true });
  const rift = riftOf(wildSpec(['neon'], 'gaping'), 70, -40);
  layer.setReal([rift], 0, false);
  const actors = layer.actorsFor(rift);
  assert.ok(actors.length >= 1);
  assert.equal(layer.actorsFor(rift), actors, 'cached');
  assert.ok(actors.some((a) => a.lead), 'a gaping rift brings its Tale-lead');
  const rect = { x0: 60, y0: -50, x1: 80, y1: -30 };
  const first = layer.entities(rect, null).map((e) => `${e.id}@${e.x},${e.y}`);
  assert.deepEqual(layer.entities(rect, null).map((e) => `${e.id}@${e.x},${e.y}`), first, 'still frames are steady');
  assert.ok(first.some((s) => s.startsWith(`${rift.id}@`)));
  assert.ok(first.some((s) => s.startsWith('stray:')));
});

// ---------- scene-wilds (pure parts) ----------

test('chunks in a view come nearest first, and the vale’s own chunks are known', () => {
  const list = chunksInRect(-100, -100, 300, 200);
  assert.equal(list[0].key, '0,-1', 'the chunk under the middle of the view first');
  assert.deepEqual(new Set(list.map((c) => c.key)), new Set(['-1,-1', '0,-1', '-1,0', '0,0']));
  assert.equal(chunksInRect(0, 0, 10, 10, 1).length, 9, 'one chunk of padding round it');
  assert.equal(allHeart(0, 0), true);
  assert.equal(allHeart(1, 0), true);
  assert.equal(allHeart(0, 1), false, 'the vale is 44 tiles tall');
  assert.equal(allHeart(-1, 0), false);
  assert.ok(MAX_CANVASES <= 25);
});

test('bleeds touch the chunks they reach, and signatures follow them', () => {
  const r = { id: 'rift:a', x: 40, y: -10, stage: 'open', spec: { stage: 'open' } };
  const reach = bleedReach(r);
  const cx = 40.5 * 16;
  const cy = -9.5 * 16;
  assert.equal(bleedTouches(r, cx - 1, cy - 1, 2, 2), true);
  assert.equal(bleedTouches(r, cx + reach + 2, cy, 10, 10), false);
  assert.equal(bleedTouches(r, cx + reach - 2, cy, 10, 10), true);
  assert.equal(bleedSignature([]), '');
  assert.notEqual(bleedSignature([r]), bleedSignature([{ ...r, x: 41 }]));
  assert.notEqual(bleedSignature([r]), bleedSignature([{ ...r, stage: 'gaping' }]));
});

// ---------- scene-elsewhere ----------

test('an Elsewhere path finds its way round walls, or stops near an unreachable goal', () => {
  const grid = [
    '..........',
    '.########.',
    '.#......#.',
    '.#.####.#.',
    '...#..#...',
    '####..####',
  ];
  const walkable = (x, y) => y >= 0 && y < grid.length && x >= 0 && x < grid[0].length && grid[y][x] === '.';
  const path = scenePath(walkable, 10, 6, { x: 0, y: 0 }, { x: 9, y: 4 });
  assert.ok(path.length > 0);
  let prev = { x: 0, y: 0 };
  for (const step of path) {
    assert.equal(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), 1);
    assert.ok(walkable(step.x, step.y));
    prev = step;
  }
  assert.deepEqual(path.at(-1), { x: 9, y: 4 });
  assert.equal(path.length, 13, 'the shortest way');
  assert.deepEqual(scenePath(walkable, 10, 6, { x: 0, y: 0 }, { x: 0, y: 0 }), [], 'already there');
  assert.deepEqual(scenePath(walkable, 10, 6, { x: 0, y: 0 }, { x: 5, y: 4 }), [], 'shut in: no way');
  const near = scenePath(walkable, 10, 6, { x: 0, y: 0 }, { x: 4, y: 1 });
  assert.ok(near.length > 0 && Math.abs(near.at(-1).x - 4) + Math.abs(near.at(-1).y - 1) === 1, 'a wall tile: the nearest open tile beside it');
  assert.deepEqual(scenePath(walkable, 10, 6, null, { x: 1, y: 1 }), []);
  // Where a walk ends (the engine judges 'got there' by it): the tile, or the nearest open ring.
  assert.deepEqual(walkGoals(walkable, 2, 2), [{ x: 2, y: 2 }]);
  assert.deepEqual(walkGoals(walkable, 4, 1).map((g) => `${g.x},${g.y}`).sort(), ['4,0', '4,2']);
  assert.deepEqual(walkGoals(walkable, 3, 5), [{ x: 4, y: 5 }]);
  assert.deepEqual(walkGoals(() => false, 4, 1), [], 'nowhere at all');
  for (const [x, y] of [[4, 1], [0, 0], [3, 5]]) {
    for (const goal of walkGoals(walkable, x, y)) {
      assert.deepEqual(scenePath(walkable, 10, 6, goal, { x, y }), [], `from ${goal.x},${goal.y} a walk to ${x},${y} is already there`);
    }
  }
});
