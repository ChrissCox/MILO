// The map view (CONTRACT-PHASE3.md §8, §9 I): src/ui/mapview.js. The pure half (viewport maths,
// visible chunks, the fog and its dithered edge, marker art and hit testing, the travel list) is
// tested directly; the DOM half runs against a small fake document that refuses innerHTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTE } from '../src/world/sprites.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { paintRegion, basePaletteByCode } from '../src/world/wildsart.js';
import {
  ZOOMS, DEFAULT_ZOOM, ZOOM_NAMES, CHUNK_TILES, VALE, FOG, BAYER, PARCHMENT, GENRE_TINTS, MARKER_KINDS,
  chunkKey, chunkOf, inVale, chunkInVale, valeDistance, toExploredSet, normalizeZoom, zoomStep, makeView, tilePx, viewOrigin,
  tileToScreen, screenToTile, viewRect, visibleChunks, panView, zoomView, knownBounds, clampCenter, knownAt,
  chunkStatus, neighbourhood, fogPush, fogField, fogLevels, parchmentAt, veilColour, composeChunk, downscaleMode,
  toRgb, riftTint, markerArt, iconScaleFor, Lru, markerLayer, normalizeMarkers, markerHotspot, hitTestMarkers, describeOffset,
  travelDestinations, placePopover, createMapView, valeWaterAt, chunkTouchesValeEdge, mendValeSeam, placeLabel,
  HARBOR_MIST, harborMistAt, chunkTouchesMist, layHarborMist, inSentence, travelQuestion, destinationNote,
} from '../src/ui/mapview.js';
import { placeById, TILE } from '../src/world/map.js';
import { rgbaOf } from '../src/world/sprites.js';

const S = CHUNK_TILES + 2;
const fieldAt = (field, cx, cy, x, y) => field[(y - cy * CHUNK_TILES + 1) * S + (x - cx * CHUNK_TILES + 1)];

// Calm copy (CONTRACT-PHASE3.md §2), as tests/core.test.js checks it.
function assertCalm(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.ok(!text.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji: ${text}`);
  assert.ok(!text.includes('"'), `${where} uses curly quotes only: ${text}`);
  // Sentence case: a sentence that opens with a word opens with a capital ('12 tiles north' opens with a number).
  const first = text.trim().match(/^\p{L}/u);
  if (first) assert.equal(first[0], first[0].toUpperCase(), `${where} starts with a capital: ${text}`);
}

// ---------- zoom and the viewport ----------

test('zooms: 2, 4 and 8 px a tile, stepping and held at the ends', () => {
  assert.deepEqual([...ZOOMS], [2, 4, 8]);
  assert.equal(DEFAULT_ZOOM, 4);
  for (const z of ZOOMS) assertCalm(ZOOM_NAMES[z], `zoom name ${z}`);
  assert.equal(normalizeZoom(4), 4);
  assert.equal(normalizeZoom(7), 8);
  assert.equal(normalizeZoom(1), 2);
  assert.equal(normalizeZoom('8'), 8);
  assert.equal(normalizeZoom(NaN), DEFAULT_ZOOM);
  assert.equal(normalizeZoom(undefined), DEFAULT_ZOOM);
  assert.equal(zoomStep(2, 1), 4);
  assert.equal(zoomStep(4, 1), 8);
  assert.equal(zoomStep(8, 1), 8);
  assert.equal(zoomStep(8, -1), 4);
  assert.equal(zoomStep(2, -1), 2);
  assert.equal(zoomStep(4, 0), 4);
});

test('views are sanitised and screen maths round-trips on whole pixels', () => {
  const bad = makeView({ cx: NaN, cy: Infinity, zoom: 5, pixel: 0, width: -3, height: 'x' });
  assert.deepEqual(bad, { cx: 32, cy: 22, zoom: 4, pixel: 1, icon: 2, width: 0, height: 0 });
  assert.equal(makeView({ pixel: 2 }).icon, 4, 'icons follow the art pixel by default');
  assert.equal(makeView({ pixel: 2, icon: 3 }).icon, 3);
  // Icons stay about 2 CSS px a pixel on whole device pixels at any ratio.
  assert.deepEqual([1, 1.25, 1.5, 2, 3].map(iconScaleFor), [2, 3, 3, 4, 6]);
  for (const [cx, cy, zoom, pixel] of [[31.5, 22.5, 4, 1], [-1234.37, 987.61, 2, 1], [0.13, -0.77, 8, 2], [99999.5, -99999.25, 8, 3]]) {
    const v = makeView({ cx, cy, zoom, pixel, width: 741, height: 533 });
    const o = viewOrigin(v);
    assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y), 'origin on whole pixels');
    const t = tilePx(v);
    assert.equal(t, zoom * pixel);
    // Chunk corners land on whole pixels, so chunks meet without a seam.
    for (const k of [-3, 0, 7]) assert.ok(Number.isInteger(tileToScreen(v, k * CHUNK_TILES, k * CHUNK_TILES).x));
    // The centre is within half a pixel of the middle.
    const mid = tileToScreen(v, v.cx, v.cy);
    assert.ok(Math.abs(mid.x - v.width / 2) <= 0.5 && Math.abs(mid.y - v.height / 2) <= 0.5);
    for (const [sx, sy] of [[0, 0], [370, 266], [740, 532], [13.5, 400.25]]) {
      const at = screenToTile(v, sx, sy);
      const back = tileToScreen(v, at.x, at.y);
      assert.ok(Math.abs(back.x - sx) < 1e-6 && Math.abs(back.y - sy) < 1e-6);
    }
    const r = viewRect(v);
    assert.ok(Math.abs((r.x1 - r.x0) * t - v.width) < 1e-6 && Math.abs((r.y1 - r.y0) * t - v.height) < 1e-6);
  }
});

test('visible chunks: every tile on screen is covered, nothing extra, nearest the centre first', () => {
  const sizes = [[740, 540], [1, 1], [1920, 1080]];
  let checked = 0;
  for (const zoom of ZOOMS) {
    for (const [w, h] of sizes) {
      for (const [cx, cy] of [[32, 22], [-517.3, 211.8], [16.01, -15.99], [0, 0]]) {
        const v = makeView({ cx, cy, zoom, width: w, height: h });
        const list = visibleChunks(v);
        const keys = new Set(list.map((c) => c.key));
        assert.equal(keys.size, list.length, 'no chunk twice');
        // Every screen pixel's tile is in a listed chunk (sampled on a grid plus the corners).
        const xs = [0, w - 1, ...Array.from({ length: 9 }, (_, i) => Math.floor((i * w) / 9))];
        const ys = [0, h - 1, ...Array.from({ length: 9 }, (_, i) => Math.floor((i * h) / 9))];
        for (const sx of xs) {
          for (const sy of ys) {
            const at = screenToTile(v, sx + 0.5, sy + 0.5);
            assert.ok(keys.has(chunkKey(chunkOf(Math.floor(at.x)), chunkOf(Math.floor(at.y)))), `pixel ${sx},${sy} at zoom ${zoom}`);
            checked += 1;
          }
        }
        // And every listed chunk shows at least a pixel.
        for (const c of list) {
          const a = tileToScreen(v, c.cx * CHUNK_TILES, c.cy * CHUNK_TILES);
          const span = CHUNK_TILES * tilePx(v);
          assert.ok(a.x < w && a.y < h && a.x + span > 0 && a.y + span > 0, `chunk ${c.key} is on screen`);
        }
        for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].d <= list[i].d, 'sorted nearest first');
        // A margin adds a ring.
        const wider = visibleChunks(v, 1);
        const xs2 = list.map((c) => c.cx);
        const ys2 = list.map((c) => c.cy);
        assert.equal(wider.length, (Math.max(...xs2) - Math.min(...xs2) + 3) * (Math.max(...ys2) - Math.min(...ys2) + 3));
      }
    }
  }
  assert.ok(checked > 1000);
  // The counts per zoom at the map's size: far shows many chunks, near only a few.
  const counts = ZOOMS.map((zoom) => visibleChunks(makeView({ cx: 32, cy: -20, zoom, width: 716, height: 540 })).length);
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2], JSON.stringify(counts));
  assert.ok(counts[2] <= 12 && counts[0] <= 130, JSON.stringify(counts));
});

test('panning follows the pointer and zooming keeps the tile under it', () => {
  const v = makeView({ cx: 10, cy: 10, zoom: 4, pixel: 2, width: 800, height: 600 });
  const moved = panView(v, 80, -40);
  assert.equal(moved.cx, 10 - 80 / 8);
  assert.equal(moved.cy, 10 + 40 / 8);
  for (const [z, sx, sy] of [[8, 100, 50], [2, 700, 590], [4, 400, 300], [8, 0, 0]]) {
    const before = screenToTile(v, sx, sy);
    const next = zoomView(v, z, sx, sy);
    assert.equal(next.zoom, z);
    const after = screenToTile(next, sx, sy);
    const t = tilePx(next);
    assert.ok(Math.abs(after.x - before.x) * t <= 1 && Math.abs(after.y - before.y) * t <= 1, `zoom ${z} at ${sx},${sy}`);
  }
});

test('the centre stays over the known world', () => {
  const explored = new Set(['0,-2', '0,-1', '-3,0']);
  const markers = [{ kind: 'rift', x: 200, y: 300 }, { kind: 'lantern', x: NaN, y: 3 }];
  const b = knownBounds(explored, markers);
  assert.deepEqual(b, { x0: -96, y0: -64, x1: 201, y1: 301 });
  assert.deepEqual(knownBounds([], []), { x0: 0, y0: 0, x1: 64, y1: 44 });
  const v = makeView({ cx: 5000, cy: -5000, width: 100, height: 100 });
  const c = clampCenter(v, b, 12);
  assert.equal(c.cx, 213);
  assert.equal(c.cy, -76);
  const inside = clampCenter(makeView({ cx: 10, cy: 10 }), b);
  assert.equal(inside.cx, 10);
  assert.equal(inside.cy, 10);
});

test('explored sets come from sets, arrays or iterables, and nothing else', () => {
  const set = new Set(['1,2']);
  assert.equal(toExploredSet(set), set);
  assert.deepEqual([...toExploredSet(['1,2', '-3,-4', 'x', 5, '1,2', '1.5,2'])], ['1,2', '-3,-4']);
  assert.deepEqual([...toExploredSet(new Map([['a', 1]]).keys())], []);
  for (const junk of [null, undefined, 'a,b', 42, {}]) assert.equal(toExploredSet(junk).size, 0);
});

// ---------- fog of war ----------

test('what is known: the vale, a glimpse past its walls, and explored chunks', () => {
  const explored = new Set(['5,5']);
  assert.ok(inVale(0, 0) && inVale(63, 43) && !inVale(64, 0) && !inVale(-1, 5));
  assert.ok(chunkInVale(0, 0) && chunkInVale(1, 0) && !chunkInVale(0, 1) && !chunkInVale(2, 0) && !chunkInVale(-1, 0));
  assert.equal(valeDistance(10, 10), 0);
  assert.equal(valeDistance(-1, 10), 0.5);
  assert.ok(knownAt(explored, 32, 22));
  assert.ok(knownAt(explored, 32, -FOG.glimpse));
  assert.ok(!knownAt(explored, 32, -FOG.glimpse - 2));
  assert.ok(knownAt(explored, 5 * 32 + 3, 5 * 32 + 31));
  assert.ok(!knownAt(explored, 6 * 32, 5 * 32));
  assert.equal(chunkStatus(explored, 5, 5), 2);
  assert.equal(chunkStatus(explored, 0, 0), 2, 'wholly in the vale');
  assert.equal(chunkStatus(explored, 1, 1), 1, 'partly the vale, partly the glimpse and beyond');
  assert.equal(chunkStatus(explored, 0, -1), 1, 'the glimpse north of the vale');
  assert.equal(chunkStatus(explored, 9, 9), 0);
  assert.equal(chunkStatus(explored, -1, -1), 1, 'the glimpse reaches the corner chunk');
  assert.equal(chunkStatus(explored, -2, 0), 0);
  assert.equal(neighbourhood(explored, 9, 9).kind, 'fog');
  assert.equal(neighbourhood(explored, 5, 5).kind, 'edge');
  const block = new Set();
  for (let y = 3; y <= 7; y += 1) for (let x = 3; x <= 7; x += 1) block.add(chunkKey(x, y));
  assert.equal(neighbourhood(block, 5, 5).kind, 'clear');
  assert.equal(neighbourhood(block, 5, 5).sig, '222222222');
  assert.equal(neighbourhood(block, 7, 5).kind, 'edge');
  assert.equal(neighbourhood(block, 8, 5).kind, 'fog', 'an unexplored neighbour stays fog');
});

test('fog field: the unknown is whole fog, the vale is clear, the edge never shows a chunk line', () => {
  const explored = new Set(['2,-3', '2,-2', '3,-2', '-5,4']);
  const known = (x, y) => knownAt(explored, x, y);
  const R = FOG.from + FOG.ramp + FOG.push + 0.5;
  let edges = 0;
  let deep = 0;
  for (const [cx, cy] of [[2, -3], [2, -2], [3, -2], [-5, 4], [1, 0], [0, 1], [-1, -1], [4, -2], [2, -4]]) {
    const field = fogField(explored, cx, cy);
    assert.equal(field.length, S * S);
    for (let j = -1; j <= CHUNK_TILES; j += 1) {
      for (let i = -1; i <= CHUNK_TILES; i += 1) {
        const x = cx * CHUNK_TILES + i;
        const y = cy * CHUNK_TILES + j;
        const f = fieldAt(field, cx, cy, x, y);
        assert.ok(f >= 0 && f <= 1);
        if (inVale(x, y)) { assert.equal(f, 0, `vale ${x},${y}`); continue; }
        if (!known(x, y)) { assert.equal(f, 1, `unknown ${x},${y}`); continue; }
        // A known tile touching the unknown is always whole fog: no straight chunk edge shows.
        if (!known(x + 1, y) || !known(x - 1, y) || !known(x, y + 1) || !known(x, y - 1)) {
          assert.equal(f, 1, `edge ${x},${y}`);
          edges += 1;
        }
        // Far enough in, it's always clear.
        let far = true;
        for (let dy = -Math.ceil(R); dy <= Math.ceil(R) && far; dy += 1) {
          for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx += 1) {
            if (Math.hypot(dx, dy) <= R + 0.5 && !known(x + dx, y + dy)) { far = false; break; }
          }
        }
        if (far) { assert.equal(f, 0, `deep ${x},${y}`); deep += 1; }
      }
    }
  }
  assert.ok(edges > 200 && deep > 200, `${edges} edge tiles, ${deep} deep ones`);
  // Deterministic.
  assert.deepEqual(fogField(explored, 2, -2), fogField(explored, 2, -2));
  // The push is smooth noise in 0..1 that really wanders.
  const pushes = Array.from({ length: 400 }, (_, i) => fogPush(i * 3.7 - 500, i * -2.3 + 90));
  assert.ok(pushes.every((p) => p >= 0 && p <= 1));
  assert.ok(Math.max(...pushes) - Math.min(...pushes) > 0.7);
  assert.ok(Math.abs(fogPush(10, 10) - fogPush(10.2, 10)) < 0.1, 'smooth');
});

test('the fog edge wanders like a coast, not along the chunk grid', () => {
  // A tall strip of explored chunks: its east side is one straight chunk edge, 96 tiles long.
  const explored = new Set(['10,10', '10,11', '10,12']);
  const depths = [];
  for (const cy of [10, 11, 12]) {
    const field = fogField(explored, 10, cy);
    for (let y = cy * 32; y < cy * 32 + 32; y += 1) {
      // Clear depth: how far in from the east edge (x = 351) the first clear tile is.
      let depth = null;
      for (let x = 351; x >= 330; x -= 1) if (fieldAt(field, 10, cy, x, y) === 0) { depth = 351 - x; break; }
      depths.push(depth);
    }
  }
  const middle = depths.slice(12, -12);
  assert.ok(middle.every((d) => d !== null && d >= 1), 'there is a fringe of fog inside the edge');
  const distinct = new Set(middle);
  assert.ok(distinct.size >= 4, `edge depths ${[...distinct].sort((a, b) => a - b)}`);
  assert.ok(Math.max(...middle) - Math.min(...middle) >= 4, 'it bulges by several tiles');
  // Row to row it changes gently (a coast, not noise).
  let jumps = 0;
  for (let i = 1; i < middle.length; i += 1) if (Math.abs(middle[i] - middle[i - 1]) > 2) jumps += 1;
  assert.ok(jumps <= middle.length / 8, `${jumps} jumps`);
});

test('fog levels are dithered, anchored to the world and agree across chunk seams', () => {
  const explored = new Set(['0,-2', '0,-3', '1,-2', '-1,-2']);
  for (const zoom of ZOOMS) {
    const a = fogLevels(fogField(explored, 0, -2), 0, -2, zoom);
    const b = fogLevels(fogField(explored, 1, -2), 1, -2, zoom);
    assert.equal(a.per, Math.max(1, zoom / 2));
    assert.equal(a.n, CHUNK_TILES * a.per);
    assert.equal(a.levels.length, a.N * a.N);
    const seen = new Set(a.levels);
    for (const l of seen) assert.ok(l === 0 || l === 1 || l === 2);
    // The border of chunk (0,-2) on its east is chunk (1,-2)'s first column, block for block.
    for (let bj = 0; bj < a.n; bj += 1) {
      assert.equal(a.levels[(bj + 1) * a.N + (a.n + 1)], b.levels[(bj + 1) * b.N + 1], `zoom ${zoom} row ${bj}`);
      assert.equal(b.levels[(bj + 1) * b.N], a.levels[(bj + 1) * a.N + a.n], `zoom ${zoom} row ${bj} (back)`);
    }
  }
  // An edge chunk holds all three: clear ground, the hush veil and parchment.
  const edge = fogLevels(fogField(explored, 1, -2), 1, -2, 4);
  const counts = [0, 0, 0];
  for (const l of edge.levels) counts[l] += 1;
  assert.ok(counts.every((c) => c > 50), JSON.stringify(counts));
  // A chunk of fog is parchment in every block.
  const fog = fogLevels(new Float32Array(S * S).fill(1), 9, 9, 4);
  assert.ok(fog.levels.every((l) => l === 2));
  const clear = fogLevels(new Float32Array(S * S), 9, 9, 4);
  assert.ok(clear.levels.every((l) => l === 0));
  // A half fog uses the Bayer matrix: about half the blocks.
  const half = fogLevels(new Float32Array(S * S).fill(FOG.veil + (1 - FOG.veil) / 2), 3, 3, 8);
  const share = half.levels.filter((l) => l === 2).length / half.levels.length;
  assert.ok(share > 0.4 && share < 0.6, String(share));
  assert.equal(BAYER.length, 4);
});

test('composing a chunk: art where clear, veil and parchment in the fog, an edge wash between', () => {
  const zoom = 4;
  const size = CHUNK_TILES * zoom;
  const art = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p += 1) art.set([120, 175, 118, 255], p * 4);
  // The vale's own pixels (transparent in the chunk art) in the top-left corner.
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) art[(y * size + x) * 4 + 3] = 0;
  const explored = new Set(['4,4']);
  const fog = fogLevels(fogField(explored, 4, 4), 4, 4, zoom);
  const out = composeChunk(art, fog, 4, 4, zoom);
  assert.equal(out.length, size * size * 4);
  const parchment = new Set(Object.values(PARCHMENT).map((c) => c.join(',')));
  const veil = veilColour(120, 175, 118).join(',');
  let clear = 0; let veiled = 0; let paper = 0; let edge = 0;
  for (let p = 0; p < size * size; p += 1) {
    const rgb = [...out.slice(p * 4, p * 4 + 3)].join(',');
    if (out[p * 4 + 3] === 0) continue;
    if (rgb === '120,175,118') clear += 1;
    else if (rgb === veil) veiled += 1;
    else if (parchment.has(rgb)) { paper += 1; if (rgb === PARCHMENT.edge.join(',')) edge += 1; } else assert.fail(`unexpected colour ${rgb}`);
  }
  assert.ok(clear > 1000 && veiled > 100 && paper > 1000 && edge > 50, JSON.stringify({ clear, veiled, paper, edge }));
  // Every edge-wash block touches a clearer block.
  const n = size / 2;
  for (let bj = 0; bj < n; bj += 1) {
    for (let bi = 0; bi < n; bi += 1) {
      const p = (bj * 2 * size + bi * 2) * 4;
      if ([...out.slice(p, p + 3)].join(',') !== PARCHMENT.edge.join(',')) continue;
      const l = (i, j) => fog.levels[(j + 1) * fog.N + (i + 1)];
      assert.ok(l(bi - 1, bj) < 2 || l(bi + 1, bj) < 2 || l(bi, bj - 1) < 2 || l(bi, bj + 1) < 2);
    }
  }
  // Fog alone: parchment everywhere, the same every time.
  const alone = composeChunk(null, null, -7, 3, 2);
  assert.equal(alone.length, 64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p += 1) {
    assert.equal(alone[p * 4 + 3], 255);
    assert.ok(parchment.has([...alone.slice(p * 4, p * 4 + 3)].join(',')));
  }
  assert.deepEqual(alone, composeChunk(null, null, -7, 3, 2));
  // A clear transparent pixel (the vale) stays transparent for the vale's own picture.
  const clearFog = { levels: new Uint8Array((n + 2) * (n + 2)), N: n + 2 };
  const kept = composeChunk(art, clearFog, 4, 4, zoom);
  assert.equal(kept[3], 0);
  assert.equal(kept[(10 * size + 10) * 4 + 3], 255);
});

test('parchment and the hush veil', () => {
  const tones = new Set(Object.values(PARCHMENT).map((c) => c.join(',')));
  const seen = new Map();
  for (let y = -40; y < 40; y += 1) {
    for (let x = -40; x < 40; x += 1) {
      const c = parchmentAt(x, y).join(',');
      assert.ok(tones.has(c));
      seen.set(c, (seen.get(c) || 0) + 1);
      assert.equal(parchmentAt(x, y), parchmentAt(x, y));
    }
  }
  assert.ok(seen.get(PARCHMENT.base.join(',')) > 0.4 * 6400, 'mostly the base tone');
  assert.ok(seen.size >= 3, 'a mottle of tones and specks');
  // The veil is greyer and lighter than the ground under it.
  for (const hex of ['#78af76', '#9fd4e6', '#e7a28a', '#5b9169']) {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const v = veilColour(...rgb);
    const spread = (c) => Math.max(...c) - Math.min(...c);
    assert.ok(spread(v) < spread(rgb), `${hex} greyer`);
    assert.ok(v.reduce((a, b) => a + b) >= rgb.reduce((a, b) => a + b) - 2, `${hex} no darker`);
  }
});

test('the vale made small keeps its own palette', () => {
  const w = 8;
  const h = 4;
  const src = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, rgba) => src.set(rgba, (y * w + x) * 4);
  const green = [170, 212, 143, 255];
  const ink = [61, 64, 56, 255];
  const sand = [239, 223, 183, 255];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) put(x, y, green);
  put(0, 0, ink); put(1, 0, ink); put(0, 1, ink); // 3 ink of 16 in block 0: green wins
  for (let y = 0; y < 4; y += 1) for (let x = 4; x < 8; x += 1) put(x, y, (x + y) % 2 ? sand : ink); // a tie: the first seen wins
  put(4, 0, [0, 0, 0, 0]); // transparent pixels don't count
  const out = downscaleMode(src, w, h, 4);
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
  assert.deepEqual([...out.data.slice(0, 4)], green);
  // Block 1: 7 ink, 8 sand and one transparent pixel: sand.
  assert.deepEqual([...out.data.slice(4, 8)], sand);
  // A true tie goes to the colour seen first.
  const tie = new Uint8ClampedArray(4 * 4);
  tie.set(green, 0); tie.set(sand, 4); tie.set(sand, 8); tie.set(green, 12);
  assert.deepEqual([...downscaleMode(tie, 2, 2, 2).data], green);
  // The outline ink counts half: a fence's rails (ink above and below the wood) shrink to wood,
  // not to a bar of ink; a block that is nearly all ink stays ink.
  const wood = [165, 126, 96, 255];
  const rails = new Uint8ClampedArray(16 * 4);
  [ink, wood, wood, ink, ink, wood, wood, ink, ink, wood, green, ink, ink, green, wood, ink].forEach((c, i) => rails.set(c, i * 4));
  assert.deepEqual([...downscaleMode(rails, 4, 4, 4).data], wood, '8 ink, 6 wood and 2 grass: wood');
  const edge = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i += 1) edge.set(i < 13 ? ink : green, i * 4);
  assert.deepEqual([...downscaleMode(edge, 4, 4, 4).data], ink, '13 ink and 3 grass: ink');
  // All transparent stays transparent; factor 1 is a copy.
  const empty = downscaleMode(new Uint8ClampedArray(16 * 4), 4, 4, 2);
  assert.ok(empty.data.every((v) => v === 0));
  assert.deepEqual([...downscaleMode(src, w, h, 1).data], [...src]);
  // A real-sized block reduction is fast enough to do on open.
  const big = new Uint8ClampedArray(1024 * 704 * 4);
  for (let i = 0; i < big.length; i += 4) big.set((i >> 6) % 3 ? green : sand, i);
  const t0 = performance.now();
  for (const f of [2, 4, 8]) downscaleMode(big, 1024, 704, f);
  assert.ok(performance.now() - t0 < 400, 'three reductions of the vale');
});

// ---------- where the wilds meet the vale ----------

test('the vale’s own water, and the chunks that meet its edge', () => {
  // Hearthvale's sea fills its south-east corner; its fields don't.
  assert.equal(valeWaterAt(63, 43), true);
  assert.equal(valeWaterAt(50, 43), true);
  assert.equal(valeWaterAt(31, 22), false, 'Milo’s camp');
  assert.equal(valeWaterAt(64, 43), false, 'outside the vale is never the vale’s water');
  assert.equal(valeWaterAt(-1, 0), false);
  const touching = [];
  for (let cy = -3; cy <= 3; cy += 1) for (let cx = -3; cx <= 4; cx += 1) if (chunkTouchesValeEdge(cx, cy)) touching.push(`${cx},${cy}`);
  // The ring is x in [-1, 64], y in [-1, 44]: chunks -1..2 across and -1..1 down, less the two wholly inside.
  assert.deepEqual(touching.sort(), ['-1,-1', '-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,1', '2,-1', '2,0', '2,1'].sort());
  assert.ok(chunkInVale(0, 0) && chunkInVale(1, 0));
});

test('the foam the wilds draw along the vale’s lake is painted out, and nowhere else', () => {
  const W = [60, 120, 200, 255];
  const F = [240, 250, 255, 255];
  const G = [170, 212, 143, 255];
  for (const ppt of [8, 16, 4, 2]) {
    const S = 32 * ppt;
    const band = Math.max(1, Math.floor(ppt / 8));
    // Chunk (2, 1): tiles x 64..95, y 32..63. All water, with foam down the west edge of column x = 64.
    const rgba = new Uint8ClampedArray(S * S * 4);
    for (let i = 0; i < S * S; i += 1) rgba.set(W, i * 4);
    const px = (x, y) => [...rgba.slice(((y - 32 * ppt) * S + (x - 64 * ppt)) * 4, ((y - 32 * ppt) * S + (x - 64 * ppt)) * 4 + 4)];
    for (let y = 32 * ppt; y < 64 * ppt; y += 1) for (let k = 0; k < band; k += 1) rgba.set(F, ((y - 32 * ppt) * S + k) * 4);
    // A made-up vale edge: water beside tiles y 36..43, land above.
    const water = (x, y) => x === 63 && y >= 36 && y < 44;
    const n = mendValeSeam(rgba, 2, 1, ppt, water);
    assert.equal(n, 8, `${ppt} px: one mend per tile beside the vale’s water`);
    for (let y = 36 * ppt; y < 44 * ppt; y += 1) for (let k = 0; k < band; k += 1) assert.deepEqual(px(64 * ppt + k, y), W, `${ppt} px: foam gone at ${k},${y}`);
    for (let y = 32 * ppt; y < 36 * ppt; y += 1) assert.deepEqual(px(64 * ppt, y), F, `${ppt} px: foam kept where the vale is land`);
    // Nothing past the band changes.
    assert.deepEqual(px(64 * ppt + band, 40 * ppt), W);
  }
  // The south edge (tiles y = 44 under the vale's sea) and the vale's corner.
  const ppt = 8;
  const S = 32 * ppt;
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i += 1) rgba.set(G, i * 4);
  const tileTop = (x) => ((44 - 32) * ppt * S + (x - 32) * ppt) * 4;
  for (let x = 32; x < 64; x += 1) for (let i = 0; i < ppt; i += 1) rgba.set(F, tileTop(x) + i * 4);
  const n = mendValeSeam(rgba, 1, 1, ppt);
  const wet = [];
  for (let x = 32; x < 64; x += 1) if (valeWaterAt(x, 43)) wet.push(x);
  assert.ok(wet.length >= 10, 'the real vale’s sea meets its south edge');
  assert.equal(n, wet.length);
  for (let x = 32; x < 64; x += 1) {
    const first = [...rgba.slice(tileTop(x), tileTop(x) + 4)];
    assert.deepEqual(first, wet.includes(x) ? G : F, `tile ${x},44`);
  }
  // Chunks away from the vale, bad input and tiny zooms are left alone.
  const far = new Uint8ClampedArray(S * S * 4).fill(7);
  assert.equal(mendValeSeam(far, 5, 5, 8), 0);
  assert.ok(far.every((v) => v === 7));
  assert.equal(mendValeSeam(new Uint8ClampedArray(16), 2, 1, 8), 0, 'too short');
  assert.equal(mendValeSeam(null, 2, 1, 8), 0);
  assert.equal(mendValeSeam(new Uint8ClampedArray(32 * 32 * 4), 2, 1, 1), 0, 'no room at 1 px a tile');
});

test('the real wilds art along the vale’s sea loses its seam', () => {
  const words = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
  const worldgen = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const wilds = createWilds({ worldgen, maxChunks: 16 });
  const base = basePaletteByCode();
  const foam = base['f'.charCodeAt(0)];
  for (const [cx, cy] of [[1, 1], [2, 1]]) {
    const ppt = 8;
    const { keys, width } = paintRegion(wilds, cx * 32, cy * 32, 32, 32, ppt);
    const rgba = new Uint8ClampedArray(keys.length * 4);
    keys.forEach((k, i) => { if (k) rgba.set([...base[k], 255], i * 4); });
    const edge = (x, y, side) => {
      // The art pixels of a ring tile's vale-facing edge.
      const out = [];
      for (let t = 0; t < ppt; t += 1) {
        const lx = (x - cx * 32) * ppt + (side === 'west' ? 0 : t);
        const ly = (y - cy * 32) * ppt + (side === 'west' ? t : 0);
        out.push(rgba.slice((ly * width + lx) * 4, (ly * width + lx) * 4 + 3).join(','));
      }
      return out;
    };
    const wet = [];
    if (cx === 2) { for (let y = 32; y < 44; y += 1) if (valeWaterAt(63, y)) wet.push([64, y, 'west']); }
    else for (let x = 32; x < 64; x += 1) if (valeWaterAt(x, 43)) wet.push([x, 44, 'north']);
    assert.ok(wet.length > 0, `chunk ${cx},${cy} meets the vale’s sea`);
    const foamy = (list) => list.filter(([x, y, side]) => edge(x, y, side).includes(foam.join(','))).length;
    assert.ok(foamy(wet) > 0, `chunk ${cx},${cy}: the wilds art draws foam against the vale (what's being mended)`);
    mendValeSeam(rgba, cx, cy, ppt);
    // Sparkles in open water are the art's own; the edge line (two in three pixels) is what goes.
    for (const [x, y, side] of wet) {
      const count = edge(x, y, side).filter((c) => c === foam.join(',')).length;
      assert.ok(count <= 2, `chunk ${cx},${cy}: tile ${x},${y} has no foam line left (${count})`);
    }
  }
});

// ---------- the harbor's mist ----------

const MIST_STEP = { 0: 0, 0.24: 1, 0.42: 2, 0.58: 3 };
// The mist over one pixel as a canvas lays it (what renderMap's bake does, and the map too).
const misted = (rgb, a, tint = HARBOR_MIST.tint) => {
  const A = Math.round(255 * a) / 255;
  return rgb.map((c, i) => Math.round(tint[i] * A + c * (1 - A)));
};

test('the harbor’s mist is the engine’s own bank, and the vale’s picture holds it to its box', () => {
  const engine = readFileSync(new URL('../src/world/engine.js', import.meta.url), 'utf8');
  const flat = engine.replace(/\s+/g, ' ');
  const circles = flat.match(/const FOG_CIRCLES = \[(.*?)\];/);
  assert.ok(circles, 'the engine bakes its mist from FOG_CIRCLES');
  const list = [...circles[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map((m) => m.slice(1, 4).map(Number));
  assert.deepEqual(HARBOR_MIST.circles.map((c) => [...c]), list, 'the same circles as the engine');
  const box = flat.match(/const fogBox = \{ x: \(harbor\.area\.x - (\d+)\) \* TILE, y: \(harbor\.area\.y - (\d+)\) \* TILE, w: \(harbor\.area\.w \+ (\d+)\) \* TILE, h: \(harbor\.area\.h \+ (\d+)\) \* TILE \}/);
  assert.ok(box, 'the engine’s mist box is the harbor grown on every side');
  const area = placeById('harbor').area;
  const [left, top, grow, growH] = box.slice(1).map(Number);
  assert.deepEqual({ ...HARBOR_MIST.box }, { x: area.x - left, y: area.y - top, w: area.w + grow, h: area.h + growH });
  const outer = flat.match(/fogOuterBox = W \? \{ x: fogBox\.x, y: fogBox\.y, w: fogBox\.w \+ (\d+) \* TILE, h: fogBox\.h \+ (\d+) \* TILE \}/);
  assert.ok(outer, 'with the wilds the bank runs on to fogOuterBox');
  assert.deepEqual({ ...HARBOR_MIST.outer }, { ...HARBOR_MIST.box, w: HARBOR_MIST.box.w + Number(outer[1]), h: HARBOR_MIST.box.h + Number(outer[2]) });
  // The same density, noise and steps as bakeFog.
  for (const part of [
    'Math.hypot(wx - cx, (wy - cy) * 1.15) / r',
    'density += (smoothNoise(px, py, 22, 101) - 0.5) * 0.18 * Math.min(1, density * 4)',
    'if (density <= 0.05) continue',
    'const a = density > 0.42 ? 0.58 : density > 0.2 ? 0.42 : 0.24',
    "const tint = rgbaOf('c')",
  ]) assert.ok(flat.includes(part), `the engine’s bake still has: ${part}`);
  assert.equal(HARBOR_MIST.squash, 1.15);
  assert.deepEqual({ ...HARBOR_MIST.noise }, { cell: 22, seed: 101, amount: 0.18 });
  assert.deepEqual([...HARBOR_MIST.tint], rgbaOf('c').slice(0, 3));
  // The vale's picture (drawScene with valeOnly, so no wilds) draws only fogBox's bake: the rest is
  // the map's to lay on. If the engine ever draws the whole bank there, the map's own goes.
  assert.ok(flat.includes('const mist = wild && fogOuterBox ? fogOuterBox : fogBox;'), 'renderMap still stops the mist at fogBox');
  assert.equal(TILE, 16);
});

test('the harbor’s mist runs on past the vale’s edge and fades out inside its own bank', () => {
  const { box, outer } = HARBOR_MIST;
  const level = (px, py) => MIST_STEP[harborMistAt(px, py)];
  for (const [px, py] of [[50 * 16, 37 * 16], [53 * 16, 41 * 16], [59 * 16, 39 * 16]]) assert.equal(harborMistAt(px, py), 0.58, 'thick in the middle');
  assert.equal(harborMistAt(10 * 16, 10 * 16), 0, 'nowhere near the harbor');
  assert.equal(harborMistAt(53 * 16, 60 * 16), 0);
  // The vale's south edge: the bank crosses it and runs on, each column a step at most apart.
  const south = VALE.h * 16;
  let crossing = 0;
  for (let px = outer.x * 16; px < (outer.x + outer.w) * 16; px += 1) {
    const above = level(px, south - 1);
    const below = level(px, south);
    assert.ok(Math.abs(above - below) <= 1, `column ${px}: ${above} above the vale’s edge, ${below} below`);
    if (above && below) crossing += 1;
  }
  assert.ok(crossing > 16 * 12, `the bank runs on past the vale’s south edge over ${crossing} px`);
  // And past the column where the vale's picture stops it (the box's east side, a tile inside the vale).
  const east = (box.x + box.w) * 16;
  let across = 0;
  for (let py = outer.y * 16; py < south; py += 1) {
    const inside = level(east - 1, py);
    const beyond = level(east, py);
    assert.ok(Math.abs(inside - beyond) <= 1, `row ${py}`);
    if (inside && beyond) across += 1;
  }
  assert.ok(across > 16 * 5, `the bank runs on past the box’s east side over ${across} px`);
  // Faded to nothing on every side of the whole bank: no new straight edge.
  const x0 = outer.x * 16;
  const y0 = outer.y * 16;
  const x1 = (outer.x + outer.w) * 16 - 1;
  const y1 = (outer.y + outer.h) * 16 - 1;
  for (let px = x0; px <= x1; px += 1) assert.ok(!harborMistAt(px, y0) && !harborMistAt(px, y1), `bank edge at column ${px}`);
  for (let py = y0; py <= y1; py += 1) assert.ok(!harborMistAt(x0, py) && !harborMistAt(x1, py), `bank edge at row ${py}`);
  // The chunks under it: the sea south of the vale and east of it, never the ones inside the vale.
  const touching = [];
  for (let cy = -3; cy <= 3; cy += 1) for (let cx = -3; cx <= 4; cx += 1) if (chunkTouchesMist(cx, cy)) touching.push(`${cx},${cy}`);
  assert.deepEqual(touching.sort(), ['1,1', '2,0', '2,1']);
});

test('the map lays on only the mist the vale’s picture leaves out, and the lake has no seam', () => {
  const { box, outer } = HARBOR_MIST;
  const WATER = [120, 170, 220];
  // The vale's picture as renderMap makes it: its sea, misted inside fogBox only.
  const W = VALE.w * 16;
  const H = VALE.h * 16;
  const vale = new Uint8ClampedArray(W * H * 4);
  const ideal = new Uint8ClampedArray(W * H * 4);
  let missing = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      const a = harborMistAt(x, y);
      const inBox = x >= box.x * 16 && y >= box.y * 16 && x < (box.x + box.w) * 16 && y < (box.y + box.h) * 16;
      vale.set([...(inBox && a ? misted(WATER, a) : WATER), 255], o);
      ideal.set([...(a ? misted(WATER, a) : WATER), 255], o);
      if (a && !inBox) missing += 1;
    }
  }
  assert.ok(missing > 0, 'the picture really does stop the mist short');
  assert.equal(layHarborMist(vale, VALE.x, VALE.y, W, H, 16, 'vale'), missing, 'every pixel it left out, and no other');
  assert.deepEqual(vale, ideal, 'the vale reads as the world view draws it');
  // The chunk below (1, 1) at 8 px a tile: its vale tiles are clear (the picture covers them).
  const ppt = 8;
  const S = CHUNK_TILES * ppt;
  const chunk = new Uint8ClampedArray(S * S * 4);
  for (let j = 0; j < S; j += 1) for (let i = 0; i < S; i += 1) if (!inVale(32 + Math.floor(i / ppt), 32 + Math.floor(j / ppt))) chunk.set([...WATER, 255], (j * S + i) * 4);
  const before = chunk.slice();
  const n = layHarborMist(chunk, 32, 32, S, S, ppt, 'wilds');
  assert.ok(n > 0);
  const at = (buf, x, y) => [...buf.slice(((y - 32 * ppt) * S + (x - 32 * ppt)) * 4, ((y - 32 * ppt) * S + (x - 32 * ppt)) * 4 + 4)];
  for (let j = 0; j < S; j += 1) {
    for (let i = 0; i < S; i += 1) {
      const o = (j * S + i) * 4;
      const tx = 32 + Math.floor(i / ppt);
      const ty = 32 + Math.floor(j / ppt);
      if (inVale(tx, ty)) assert.equal(chunk[o + 3], 0, 'the vale’s own tiles stay clear');
      else if (ty >= outer.y + outer.h || tx < outer.x) assert.deepEqual([...chunk.slice(o, o + 4)], [...before.slice(o, o + 4)], `untouched past the bank at ${tx},${ty}`);
    }
  }
  assert.notDeepEqual(at(chunk, 53 * ppt + 4, 44 * ppt + 1), [...WATER, 255], 'mist just below the vale’s edge');
  // Across the edge, the vale made small (16 → 8 px a tile, as the map does) against the chunk.
  const small = downscaleMode(vale, W, H, 2);
  const diff = (withMist) => {
    const wild = withMist ? chunk : before;
    let sum = 0;
    let count = 0;
    for (let x = outer.x * ppt; x < (VALE.x + VALE.w) * ppt; x += 1) {
      const o = ((VALE.h * ppt - 1) * small.width + x) * 4;
      const u = at(wild, x, VALE.h * ppt);
      // Only where the vale’s last row is misted.
      if (!small.data[o + 3] || (small.data[o] === WATER[0] && small.data[o + 1] === WATER[1] && small.data[o + 2] === WATER[2])) continue;
      sum += Math.abs(small.data[o] - u[0]) + Math.abs(small.data[o + 1] - u[1]) + Math.abs(small.data[o + 2] - u[2]);
      count += 3;
    }
    return sum / count;
  };
  const seam = diff(false);
  const mended = diff(true);
  assert.ok(seam > 20, `without the map’s mist the bank ends in a line (${seam.toFixed(1)} a channel)`);
  assert.ok(mended < 4, `with it the lake runs on (${mended.toFixed(1)} a channel)`);
  // Bad input is left alone.
  assert.equal(layHarborMist(null, 32, 32, S, S, ppt), 0);
  assert.equal(layHarborMist(new Uint8ClampedArray(16), 32, 32, S, S, ppt), 0);
  assert.equal(layHarborMist(chunk, NaN, 32, S, S, ppt), 0);
  const far = new Uint8ClampedArray(S * S * 4).fill(9);
  assert.equal(layHarborMist(far, -320, 640, S, S, ppt), 0);
  assert.ok(far.every((v) => v === 9));
});

test('region names stay inside the map while their place is on screen', () => {
  const box = { w: 700, h: 500 };
  const size = { w: 160, h: 16 };
  assert.deepEqual(placeLabel({ x: 350, y: 250 }, size, box), { x: 350, y: 250, alpha: 1 }, 'in the middle, untouched');
  assert.deepEqual(placeLabel({ x: 690, y: 250 }, size, box), { x: 700 - 80 - 6, y: 250, alpha: 1 }, 'pulled in from the right edge');
  assert.deepEqual(placeLabel({ x: 10, y: 250 }, size, box), { x: 86, y: 250, alpha: 1 }, 'and the left');
  assert.deepEqual(placeLabel({ x: 300, y: 4 }, size, box), { x: 300, y: 22, alpha: 1 }, 'below the top');
  assert.deepEqual(placeLabel({ x: 300, y: 510 }, size, box), { x: 300, y: 494, alpha: 1 }, 'above the bottom');
  // A place leaving the map: its name waits at the edge and fades, never cut.
  assert.deepEqual(placeLabel({ x: -24, y: 250 }, size, box), { x: 86, y: 250, alpha: 0.5 });
  assert.equal(placeLabel({ x: -48, y: 250 }, size, box).alpha, 0);
  assert.equal(placeLabel({ x: -300, y: 250 }, size, box).alpha, 0, 'far off screen, gone');
  assert.equal(placeLabel({ x: 350, y: 900 }, size, box).alpha, 0);
  assert.equal(placeLabel({ x: 350, y: 512 }, size, box).alpha, 1, 'a baseline just under the frame still counts as on screen');
  let last = 1;
  for (let x = 700; x <= 760; x += 4) {
    const { alpha } = placeLabel({ x, y: 250 }, size, box);
    assert.ok(alpha <= last, 'fades steadily as it goes');
    last = alpha;
  }
  // Wider than the map: pinned to the left margin.
  assert.deepEqual(placeLabel({ x: 50, y: 50 }, { w: 800, h: 16 }, box, 6), { x: 406, y: 50, alpha: 1 });
  // It steps round the compass chip in the bottom-left corner, by the shorter way.
  const compass = { x: 12, y: 400, w: 34, h: 88 };
  const low = placeLabel({ x: 60, y: 480 }, size, box, 6, 48, [compass]);
  assert.deepEqual(low, { x: 12 + 34 + 6 + 80, y: 480, alpha: 1 }, 'to its right');
  const high = placeLabel({ x: 60, y: 404 }, size, box, 6, 48, [compass]);
  assert.deepEqual(high, { x: 86, y: 394, alpha: 1 }, 'or just above it');
  const clearOf = (p) => p.x - 80 >= compass.x + compass.w || p.y <= compass.y;
  assert.ok(clearOf(low) && clearOf(high));
  assert.deepEqual(placeLabel({ x: 400, y: 480 }, size, box, 6, 48, [compass]), { x: 400, y: 480, alpha: 1 }, 'clear of it, untouched');
  assert.deepEqual(placeLabel({ x: 400, y: 480 }, size, box, 6, 48, [null, { x: 0, y: 0, w: 0, h: 0 }]), { x: 400, y: 480, alpha: 1 });
});

// ---------- markers ----------

test('marker icons: every kind, whole rows, known colours, centred', () => {
  const base = new Set(Object.keys(PALETTE));
  const samples = [
    { kind: 'milo' }, { kind: 'home' }, { kind: 'lantern', lit: true }, { kind: 'lantern', lit: false },
    { kind: 'rift', genre: 'neon', stage: 'hairline' }, { kind: 'rift', genre: 'gothic', stage: 'open' }, { kind: 'rift', genres: ['void', 'gothic'], stage: 'gaping' },
    { kind: 'rift' }, { kind: 'poi', type: 'ruin' }, { kind: 'poi', type: 'chest' }, { kind: 'poi', type: 'mystery' }, { kind: 'poi' },
  ];
  for (const m of samples) {
    const art = markerArt(m);
    assert.ok(art, JSON.stringify(m));
    assert.ok(art.rows.every((row) => row.length === art.w));
    assert.equal(art.rows.length, art.h);
    assert.ok(art.w <= 13 && art.h <= 13, 'small');
    for (const row of art.rows) for (const ch of row) assert.ok(ch === '.' || art.colours[ch], `${m.kind} key ${ch}`);
    for (const ch of new Set(art.rows.join(''))) if (ch !== '.' && !/\d/.test(ch)) assert.ok(base.has(ch));
    assert.ok(art.anchor.x >= 0 && art.anchor.x < art.w && art.anchor.y >= 0 && art.anchor.y < art.h);
    assert.ok(Math.abs(art.anchor.x - (art.w - 1) / 2) <= 0.5 && Math.abs(art.anchor.y - (art.h - 1) / 2) <= 0.5, 'centred on the tile');
    // Outlined in ink (or the genre's ink): the first row has something drawn.
    assert.ok(art.rows[0].replace(/\./g, '').length > 0);
  }
  assert.equal(markerArt({ kind: 'region' }), null);
  assert.equal(markerArt({ kind: 'dragon' }), null);
  assert.equal(markerArt(null), null);
  // Sleeping lanterns are grey: no honey, butter or clay left.
  const sleeping = markerArt({ kind: 'lantern', lit: false }).rows.join('');
  assert.ok(!/[uUcR]/.test(sleeping), sleeping);
  assert.ok(/[uU]/.test(markerArt({ kind: 'lantern', lit: true }).rows.join('')));
  // Tears grow with the stage.
  const sizes = ['hairline', 'open', 'gaping'].map((stage) => markerArt({ kind: 'rift', stage }).h);
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
  assert.deepEqual([...MARKER_KINDS].sort(), ['home', 'lantern', 'milo', 'poi', 'region', 'rift']);
});

test('rifts wear their genre: from content colours, the marker, or a fusion', () => {
  const neon = riftTint({ genre: 'neon' });
  assert.deepEqual(neon.inner, GENRE_TINTS.neon.inner);
  assert.deepEqual(neon.second, GENRE_TINTS.neon.inner);
  const fusion = riftTint({ genres: ['void', 'gothic'] });
  assert.deepEqual(fusion.inner, GENRE_TINTS.void.inner);
  assert.deepEqual(fusion.second, GENRE_TINTS.gothic.inner);
  assert.deepEqual(riftTint({ genre: 'neon', colour: '#102030' }).inner, [16, 32, 48]);
  assert.deepEqual(riftTint({ genre: 'noir', colour: { rim: [1, 2, 3], inner: '#0a0b0c' } }), { rim: [1, 2, 3], inner: [10, 11, 12], ink: GENRE_TINTS.noir.ink, second: [10, 11, 12], core: [5, 6, 7] });
  assert.ok(riftTint({ genre: 'nope' }).inner.length === 3, 'an unknown genre still draws');
  assert.deepEqual(toRgb([300, -2, 7.4]), [255, 0, 7]);
  assert.equal(toRgb('red'), null);
  assert.equal(toRgb([1, 2]), null);
  // Every genre's tear is distinct from the others'.
  const inners = new Set(Object.keys(GENRE_TINTS).map((g) => riftTint({ genre: g }).inner.join(',')));
  assert.equal(inners.size, Object.keys(GENRE_TINTS).length);
  // The colours the icon uses are the tint's.
  const art = markerArt({ kind: 'rift', genres: ['void', 'gothic'], stage: 'gaping' });
  assert.deepEqual(art.colours[2], GENRE_TINTS.void.inner);
  assert.deepEqual(art.colours[4], GENRE_TINTS.gothic.inner);
  assert.deepEqual(art.colours[3], GENRE_TINTS.void.ink);
});

test('markers are cleaned, labelled and drawn back to front', () => {
  const list = normalizeMarkers([
    { kind: 'milo', x: 3.4, y: -2.6 },
    { kind: 'rift', x: 1, y: 1, id: 'rift:a', label: '  A tear  ' },
    { kind: 'lantern', x: 5, y: 5, lit: true, travel: true, id: 'lantern:5,5' },
    { kind: 'lantern', x: 6, y: 5, lit: false, travel: 'yes', id: 'lantern:6,5' },
    { kind: 'region', x: 0, y: -50, label: 'The Whisperwood' },
    { kind: 'poi', x: 2, y: 2, id: 'poi:ruin:2,2', type: 'ruin' },
    { kind: 'home', x: 31, y: 22, id: 'home', travel: true },
    { kind: 'dragon', x: 1, y: 1 }, { kind: 'rift', x: NaN, y: 1 }, null, 'milo',
    { kind: 'rift', x: 9, y: 9, id: 'rift:a' },
  ]);
  assert.equal(list.length, 8);
  assert.deepEqual(list.map((m) => m.kind), ['region', 'poi', 'lantern', 'lantern', 'home', 'rift', 'rift', 'milo']);
  const milo = list.find((m) => m.kind === 'milo');
  assert.deepEqual([milo.x, milo.y, milo.id, milo.label], [3, -3, 'milo:3,-3', 'Milo']);
  assert.equal(list.find((m) => m.id === 'rift:a').label, 'A tear');
  assert.equal(new Set(list.map((m) => m.id)).size, list.length, 'ids stay unique');
  assert.equal(list.find((m) => m.id === 'lantern:6,5').travel, false, 'travel only when true');
  assert.equal(list.find((m) => m.kind === 'home').label, 'Home');
  for (const m of list) assertCalm(m.label, m.id);
  assert.ok(markerLayer({ kind: 'lantern', lit: true }) > markerLayer({ kind: 'lantern', lit: false }));
  assert.deepEqual(normalizeMarkers('nope'), []);
});

test('hit testing finds the marker under the pointer', () => {
  const v = makeView({ cx: 10, cy: 10, zoom: 4, pixel: 1, width: 400, height: 300 });
  const markers = normalizeMarkers([
    { kind: 'lantern', x: 10, y: 10, lit: true, travel: true, id: 'L' },
    { kind: 'rift', x: 14, y: 10, id: 'R' },
    { kind: 'region', x: 12, y: 12, label: 'Somewhere', id: 'G' },
    { kind: 'poi', x: 10, y: 10, id: 'P' },
  ]);
  const at = (id) => markerHotspot(markers.find((m) => m.id === id), v);
  const L = at('L');
  // Tile (10, 10)'s centre is at (202, 152); the 7×10 icon at 2× spans 196..210 × 142..162.
  assert.deepEqual([L.left, L.top, L.w, L.h, L.x, L.y], [196, 142, 14, 20, 203, 152]);
  // On a tie the one drawn on top wins (the lit lantern over the point of interest).
  assert.equal(hitTestMarkers(markers, v, L.x, L.y).id, 'L');
  const R = at('R');
  assert.equal(hitTestMarkers(markers, v, R.x + 3, R.y - 4).id, 'R');
  assert.equal(hitTestMarkers(markers, v, 20, 20), null, 'nothing out in the open');
  const region = tileToScreen(v, 12.5, 12.5);
  assert.equal(hitTestMarkers(markers.filter((m) => m.kind === 'region'), v, region.x, region.y), null, 'labels are not targets');
  // Slop widens the reach a little, not a lot.
  assert.equal(hitTestMarkers(markers, v, R.x + R.r + 5, R.y, { slop: 4 }), null);
  assert.equal(hitTestMarkers(markers, v, R.x + R.r + 5, R.y, { slop: 30 }).id, 'R');
  // At 2× pixels the icon doubles.
  const v2 = makeView({ ...v, pixel: 2, icon: null, width: 800, height: 600 });
  assert.equal(markerHotspot(markers[1], v2).w, markerHotspot(markers[1], v).w * 2);
});

test('travel: home first, then the nearest lit lanterns, with calm directions', () => {
  assert.equal(describeOffset({ x: 0, y: 0 }, { x: 1, y: 1 }), 'Right here');
  const dirs = [[10, 0, 'east'], [10, -10, 'north-east'], [0, -10, 'north'], [-10, -10, 'north-west'], [-10, 0, 'west'], [-10, 10, 'south-west'], [0, 10, 'south'], [10, 10, 'south-east'], [100, -30, 'east'], [-3, -120, 'north']];
  for (const [dx, dy, word] of dirs) {
    const text = describeOffset({ x: 5, y: 5 }, { x: 5 + dx, y: 5 + dy });
    assert.equal(text, `${Math.round(Math.hypot(dx, dy))} tiles ${word}`);
    assertCalm(text, word);
  }
  assert.equal(describeOffset(null, { x: 1, y: 1 }), '');
  const markers = normalizeMarkers([
    { kind: 'milo', x: 30, y: -30, id: 'milo', travel: true },
    { kind: 'lantern', x: 30, y: -80, lit: true, travel: true, id: 'far', label: 'Lantern at the wood’s edge' },
    { kind: 'lantern', x: 28, y: -34, lit: true, travel: true, id: 'near', label: 'Lantern on the north road' },
    { kind: 'lantern', x: 12, y: -18, lit: false, id: 'asleep' },
    { kind: 'home', x: 31, y: 22, travel: true, id: 'home', label: 'Hearthvale' },
    { kind: 'region', x: 0, y: 0, travel: true, id: 'region' },
  ]);
  const dests = travelDestinations(markers, { x: 30, y: -30 });
  assert.deepEqual(dests.map((d) => d.id), ['home', 'near', 'far']);
  assert.equal(dests[1].note, '4 tiles north-west');
  assert.equal(dests[0].note, '52 tiles south');
  for (const d of dests) { assertCalm(d.label, d.id); assertCalm(d.note, d.id); }
  assert.deepEqual(travelDestinations(markers).map((d) => d.id), ['home', 'far', 'near'], 'no Milo: home, then by name');
  assert.deepEqual(travelDestinations([]), []);
});

test('the lantern Milo rests at comes right after home on the travel list, and says so', () => {
  const markers = normalizeMarkers([
    { kind: 'home', x: 31, y: 22, travel: true, id: 'home', label: 'Hearthvale' },
    { kind: 'lantern', x: 28, y: -34, lit: true, travel: true, id: 'near', label: 'Lantern on the north road' },
    { kind: 'lantern', x: 30, y: -80, lit: true, travel: true, rest: true, id: 'rest', label: 'Lantern at the wood’s edge' },
  ]);
  const dests = travelDestinations(markers, { x: 30, y: -30 });
  assert.deepEqual(dests.map((d) => d.id), ['home', 'rest', 'near'], 'nearer lanterns come after it');
  assert.deepEqual(dests.map(destinationNote), ['Home · 52 tiles south', 'Where Milo rests · 50 tiles north', '4 tiles north-west']);
  assert.equal(destinationNote({ marker: { kind: 'lantern', rest: true }, note: 'Right here' }), 'Where Milo rests · right here');
  assert.equal(destinationNote({ marker: { kind: 'home' }, note: 'Right here' }), 'Home · right here');
  assert.equal(destinationNote({ marker: { kind: 'lantern' }, note: '' }), 'A lit lantern');
  for (const d of dests) assertCalm(destinationNote(d), d.id);
});

test('the travel question reads as one sentence, whatever the shell calls the place', () => {
  assert.equal(inSentence('A lantern by the road'), 'a lantern by the road');
  assert.equal(inSentence('An old lantern'), 'an old lantern');
  assert.equal(inSentence('The Whisperwood'), 'the Whisperwood');
  for (const kept of ['Anna’s lantern', 'Theo’s gate', 'Hearthvale', 'Andover', 'A', '']) assert.equal(inSentence(kept), kept);
  const asked = [
    [{ kind: 'lantern', label: 'A lantern in the Whisperwood' }, 'Travel to a lantern in the Whisperwood?'],
    [{ kind: 'lantern', label: 'A lantern by the road' }, 'Travel to a lantern by the road?'],
    [{ kind: 'lantern', label: 'Lantern on the north road' }, 'Travel to Lantern on the north road?'],
    [{ kind: 'lantern', label: 'The crossroads lantern' }, 'Travel to the crossroads lantern?'],
    [{ kind: 'home', label: 'Hearthvale' }, 'Travel to Hearthvale?'],
    [{ kind: 'home', label: 'Home' }, 'Travel home?'],
    [{ kind: 'lantern' }, 'Travel to a lantern?'],
    [{ kind: 'lantern', label: '   ' }, 'Travel to a lantern?'],
    [null, 'Travel there?'],
  ];
  for (const [marker, question] of asked) {
    assert.equal(travelQuestion(marker), question);
    assertCalm(question, 'travel question');
    assert.ok(!/\s(A|An|The)\s/.test(question), `no capital article mid-sentence: ${question}`);
  }
  // Markers without labels get ones that read well both on their own and mid-sentence.
  const cleaned = normalizeMarkers([{ kind: 'lantern', x: 1, y: 1, lit: true, travel: true }, { kind: 'rift', x: 2, y: 2 }]);
  assert.deepEqual(cleaned.map((m) => m.label), ['A lantern', 'A rift']);
  assert.equal(travelQuestion(cleaned[0]), 'Travel to a lantern?');
});

test('the travel question sits above its lantern, or below, and inside the map', () => {
  const box = { w: 700, h: 500 };
  const size = { w: 220, h: 90 };
  assert.deepEqual(placePopover({ x: 350, y: 300 }, size, box), { left: 240, top: 196, side: 'above' });
  assert.deepEqual(placePopover({ x: 350, y: 40 }, size, box), { left: 240, top: 54, side: 'below' });
  assert.deepEqual(placePopover({ x: 5, y: 300 }, size, box), { left: 8, top: 196, side: 'above' });
  assert.deepEqual(placePopover({ x: 698, y: 499 }, size, box), { left: 472, top: 395, side: 'above' });
  const tiny = placePopover({ x: 10, y: 10 }, size, { w: 100, h: 50 });
  assert.ok(tiny.left === 8 && tiny.top === 8, 'a map smaller than the card keeps it at the corner');
});

test('caches are bounded by entries and by pixels', () => {
  const lru = new Lru(3, 100);
  lru.set('a', 1, 10); lru.set('b', 2, 10); lru.set('c', 3, 10);
  assert.equal(lru.get('a'), 1, 'a is fresh again');
  lru.set('d', 4, 10);
  assert.equal(lru.get('b'), undefined, 'the least recently used goes first');
  assert.deepEqual([lru.get('a'), lru.get('c'), lru.get('d')], [1, 3, 4]);
  lru.set('big', 5, 90);
  assert.equal(lru.size, 2, 'over the pixel budget, older entries go');
  assert.equal(lru.cost, 100);
  lru.set('huge', 6, 500);
  assert.equal(lru.get('huge'), 6, 'one entry always stays, however big');
  assert.equal(lru.size, 1);
  lru.delete('huge');
  assert.equal(lru.cost, 0);
  lru.set('x', null, 0);
  assert.equal(lru.get('x'), null, 'null is a value (a chunk with nothing to paint)');
  assert.equal(lru.get('y'), undefined);
});

// ---------- the DOM half, against a fake document ----------

function fakeDom({ width = 716, height = 540 } = {}) {
  const listeners = new WeakMap();
  const rafs = [];
  const timers = new Map();
  let timerId = 0;
  const canvases = [];
  const ctx2d = (canvas) => ({
    canvas,
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillStyle: '',
    calls: [],
    fillRect() {}, clearRect() {}, drawImage(...args) { this.calls.push(['drawImage', ...args.slice(1)]); }, save() {}, restore() {}, strokeText() {}, fillText(text) { this.calls.push(['fillText', text]); },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h }; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData(image) { this.calls.push(['putImageData', image]); },
  });
  class Node {
    constructor(tag, doc) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.children = [];
      this.parentNode = null;
      this.attributes = {};
      this.dataset = {};
      this.style = { setProperty(k, v) { this[k] = v; } };
      this.hidden = false;
      this.disabled = false;
      this._text = '';
      this.classList = {
        set: new Set(),
        add: (...c) => c.forEach((x) => this.classList.set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList.set.delete(x)),
        contains: (c) => this.classList.set.has(c),
      };
      if (tag === 'canvas') {
        this.width = 300;
        this.height = 150;
        this._ctx = ctx2d(this);
        canvases.push(this);
      }
    }
    get className() { return [...this.classList.set].join(' '); }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get innerHTML() { throw new Error('innerHTML is not used'); }
    set innerHTML(v) { throw new Error('innerHTML is not used'); }
    get textContent() { return this.children.length ? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('') : this._text; }
    set textContent(v) { this.children = []; this._text = String(v); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.body || n === this.ownerDocument.documentElement; }
    get offsetWidth() { return 220; }
    get offsetHeight() { return 90; }
    get clientWidth() { return width; }
    get clientHeight() { return height; }
    getContext() { return this._ctx || null; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v); if (k === 'class') this.className = v; }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    append(...nodes) { for (const n of nodes) { if (typeof n !== 'string') { n.parentNode?.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = this; } this.children.push(n); } }
    replaceChildren(...nodes) { for (const c of this.children) if (typeof c !== 'string') c.parentNode = null; this.children = []; this.append(...nodes); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    matches(sel) {
      return sel.split(',').map((s) => s.trim()).some((s) => {
        if (s === '[hidden]') return this.hidden === true;
        let m = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
        if (m) return m[2] === undefined ? this.getAttribute(m[1]) !== null : this.getAttribute(m[1]) === m[2];
        m = s.match(/^\.([\w-]+)$/);
        if (m) return this.classList.contains(m[1]);
        return this.tagName === s.toUpperCase();
      });
    }
    closest(sel) { let n = this; while (n && n.matches) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (typeof c === 'string') continue; if (c.matches(sel)) out.push(c); walk(c); } };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(type, fn) { const map = listeners.get(this) || {}; (map[type] = map[type] || []).push(fn); listeners.set(this, map); }
    removeEventListener(type, fn) { const map = listeners.get(this); if (map?.[type]) map[type] = map[type].filter((f) => f !== fn); }
    focus() { this.ownerDocument.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width, height, right: width, bottom: height }; }
    setPointerCapture() {}
    releasePointerCapture() {}
  }
  const doc = {
    hidden: false,
    activeElement: null,
    createElement: (tag) => new Node(tag, doc),
    createElementNS: (ns, tag) => new Node(tag, doc),
    addEventListener() {}, removeEventListener() {},
  };
  doc.documentElement = new Node('html', doc);
  doc.body = new Node('body', doc);
  doc.documentElement.append(doc.body);
  doc.activeElement = doc.body;
  const win = {
    devicePixelRatio: 1,
    performance,
    console: { warn() {} },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => { timerId += 1; timers.set(timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, removeEventListener() {},
  };
  doc.defaultView = win;
  const fire = (target, type, props = {}) => {
    let stopped = false;
    const event = { type, target, key: props.key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, button: 0, pointerId: 1, clientX: 0, clientY: 0, deltaY: 0, ...props, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
    for (let n = target; n && !stopped; n = n.parentNode) for (const fn of listeners.get(n)?.[type] || []) fn(event);
    return event;
  };
  const flush = () => { while (rafs.length) rafs.shift()(performance.now()); };
  return { doc, win, fire, flush, canvases, timers };
}

function mountMap(extra = {}) {
  const dom = fakeDom();
  const root = dom.doc.createElement('section');
  root.hidden = true;
  dom.doc.body.append(root);
  const paints = [];
  const log = [];
  const explored = new Set(['0,-1', '0,-2', '1,-1']);
  const markers = [
    { kind: 'milo', id: 'milo', x: 30, y: -30, label: 'Milo' },
    { kind: 'home', id: 'home', x: 31, y: 22, label: 'Hearthvale', travel: true },
    { kind: 'lantern', id: 'lantern:28,-34', x: 28, y: -34, lit: true, travel: true, label: 'Lantern on the north road' },
    { kind: 'lantern', id: 'lantern:12,-18', x: 12, y: -18, lit: false, label: 'Sleeping lantern' },
    { kind: 'rift', id: 'rift:a', x: 40, y: -12, genre: 'nocturne', stage: 'open', label: 'A nocturne rift' },
    { kind: 'region', id: 'region:w', x: 31, y: -58, label: 'The Whisperwood', hush: true },
  ];
  const view = createMapView(root, {
    paintChunk: (cx, cy, ppt) => {
      paints.push([cx, cy, ppt]);
      const c = dom.doc.createElement('canvas');
      c.width = 32 * ppt;
      c.height = 32 * ppt;
      return c;
    },
    valeImage: () => { const c = dom.doc.createElement('canvas'); c.width = 1024; c.height = 704; return c; },
    explored: () => explored,
    markers: () => markers,
    onTravel: (id, marker) => log.push(['travel', id, marker.kind]),
    onClose: (info) => log.push(['close', info.reason]),
    now: () => 0,
    motion: () => false,
    ...extra,
  });
  return { dom, root, view, paints, log, explored, markers };
}

test('the view builds safe DOM, opens, and draws only what is known', () => {
  const { dom, root, view, paints } = mountMap();
  assert.equal(view.isOpen(), false);
  assert.equal(root.hidden, true, 'shut until opened');
  assert.equal(root.children.length, 0, 'built only when first opened');
  assert.equal(paints.length, 0, 'nothing painted before it opens');
  view.open();
  dom.flush();
  assert.equal(view.isOpen(), true);
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute('role'), 'dialog');
  assert.equal(root.getAttribute('aria-modal'), 'true');
  assert.ok(root.classList.contains('map-view') && root.classList.contains('px'), 'MILO’s pixel frame');
  assert.ok(root.querySelector('.map-title').textContent === 'Map');
  assert.equal(dom.doc.activeElement, root.querySelector('.map-title'), 'focus lands on the title, like a panel');
  // Zoom buttons, centre, close, travel list, key.
  const zooms = root.querySelectorAll('[data-zoom]');
  assert.deepEqual(zooms.map((b) => b.textContent), ['Far', 'Middle', 'Near']);
  assert.deepEqual(zooms.map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.ok(root.querySelectorAll('button').some((b) => b.textContent === 'Centre on Milo'));
  assert.ok(root.querySelectorAll('button').some((b) => b.getAttribute('aria-label') === 'Close map'));
  const dests = root.querySelectorAll('.map-dest');
  assert.deepEqual(dests.map((b) => b.dataset.marker), ['home', 'lantern:28,-34']);
  assert.ok(dests[1].textContent.includes('Lantern on the north road') && dests[1].textContent.includes('4 tiles north-west'));
  assert.equal(root.querySelector('.map-empty').hidden, true);
  for (const node of [...root.querySelectorAll('p'), ...root.querySelectorAll('.map-legend')]) if (node.textContent) assertCalm(node.textContent, node.className);
  for (const b of root.querySelectorAll('button')) if (b.textContent) assertCalm(b.textContent, 'button');
  // Painted lazily, at 8 px a tile (reduced for the middle zoom), and only chunks with known ground.
  assert.ok(paints.length > 0);
  assert.ok(paints.every(([, , ppt]) => ppt === 8));
  for (const [cx, cy] of paints) {
    assert.ok(chunkStatus(new Set(['0,-1', '0,-2', '1,-1']), cx, cy) > 0, `painted ${cx},${cy}`);
    assert.ok(!chunkInVale(cx, cy), 'chunks the vale covers are never painted');
  }
  const debug = view.debug();
  assert.equal(debug.view.zoom, 4);
  assert.equal(debug.view.cx, 30.5, 'centred on Milo');
  assert.equal(debug.markers, 6);
  // Region names are written on the map.
  const main = dom.canvases.find((c) => c.classList.contains('map-canvas'));
  assert.ok(main._ctx.calls.some(([k, t]) => k === 'fillText' && t === 'THE WHISPERWOOD'));
});

test('keys: arrows pan, plus and minus zoom, Esc and M close with onClose', () => {
  const { dom, root, view, log } = mountMap();
  view.open({ center: { x: 20, y: -20 } });
  dom.flush();
  const title = root.querySelector('.map-title');
  const v0 = view.debug().view;
  assert.equal(v0.cx, 20.5);
  dom.fire(title, 'keydown', { key: 'ArrowRight' });
  dom.fire(title, 'keydown', { key: 'ArrowUp' });
  const v1 = view.debug().view;
  assert.ok(v1.cx > v0.cx && v1.cy < v0.cy);
  const e = dom.fire(title, 'keydown', { key: '+' });
  assert.ok(e.defaultPrevented);
  assert.equal(view.debug().view.zoom, 8);
  dom.fire(title, 'keydown', { key: '-' });
  dom.fire(title, 'keydown', { key: '-' });
  dom.fire(title, 'keydown', { key: '-' });
  assert.equal(view.debug().view.zoom, 2);
  assert.deepEqual(root.querySelectorAll('[data-zoom]').map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  dom.fire(title, 'keydown', { key: 'c' });
  assert.equal(view.debug().view.cx, 30.5, 'C centres on Milo (at once with motion off)');
  // Ctrl+M isn't ours.
  dom.fire(title, 'keydown', { key: 'm', ctrlKey: true });
  assert.equal(view.isOpen(), true);
  const esc = dom.fire(title, 'keydown', { key: 'Escape' });
  assert.ok(esc.defaultPrevented);
  assert.equal(view.isOpen(), false);
  assert.equal(root.hidden, true);
  assert.deepEqual(log, [['close', 'key']]);
  view.open();
  dom.fire(root.querySelector('.map-title'), 'keydown', { key: 'M' });
  assert.equal(view.isOpen(), false);
  view.open();
  root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close map');
  dom.fire(root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close map'), 'click');
  assert.deepEqual(log, [['close', 'key'], ['close', 'key'], ['close', 'button']]);
  // close() from the shell is quiet.
  view.open();
  view.close();
  assert.equal(log.length, 3);
  view.close();
});

test('travel from the list: the question, then onClose and onTravel', () => {
  const { dom, root, view, log } = mountMap();
  view.open();
  dom.flush();
  const lantern = root.querySelectorAll('.map-dest').find((b) => b.dataset.marker === 'lantern:28,-34');
  lantern.focus();
  dom.fire(lantern, 'click');
  const ask = root.querySelector('.map-ask');
  assert.equal(ask.hidden, false);
  assert.equal(root.querySelector('.map-ask-q').textContent, 'Travel to Lantern on the north road?');
  assertCalm(root.querySelector('.map-ask-q').textContent, 'question');
  assert.equal(root.querySelector('.map-ask-note').textContent, '4 tiles north-west');
  assert.equal(dom.doc.activeElement.textContent, 'Travel');
  // Esc backs out of the question, back to the list.
  dom.fire(dom.doc.activeElement, 'keydown', { key: 'Escape' });
  assert.equal(ask.hidden, true);
  assert.equal(view.isOpen(), true);
  assert.equal(dom.doc.activeElement, lantern);
  // Down arrow walks the list.
  const home = root.querySelectorAll('.map-dest')[0];
  home.focus();
  dom.fire(home, 'keydown', { key: 'ArrowDown' });
  assert.equal(dom.doc.activeElement, lantern);
  dom.fire(lantern, 'click');
  dom.fire(root.querySelectorAll('button').find((b) => b.textContent === 'Travel'), 'click');
  assert.equal(view.isOpen(), false);
  assert.deepEqual(log, [['close', 'travel'], ['travel', 'lantern:28,-34', 'lantern']]);
});

test('pointer: a click on a lit lantern asks, a drag pans and never asks', () => {
  const { dom, root, view } = mountMap();
  view.open();
  dom.flush();
  const viewport = root.querySelector('.map-viewport');
  const canvas = root.querySelector('.map-canvas');
  const d = view.debug();
  const lantern = markerHotspot({ kind: 'lantern', lit: true, x: 28, y: -34 }, d.view);
  dom.fire(canvas, 'pointerdown', { clientX: lantern.x, clientY: lantern.y });
  dom.fire(canvas, 'pointerup', { clientX: lantern.x, clientY: lantern.y });
  assert.equal(root.querySelector('.map-ask').hidden, false);
  assert.equal(view.debug().ask, 'lantern:28,-34');
  // Hovering the rift shows its label.
  const rift = markerHotspot({ kind: 'rift', stage: 'open', x: 40, y: -12 }, view.debug().view);
  dom.fire(canvas, 'pointerdown', { clientX: 10, clientY: 10 });
  dom.fire(canvas, 'pointerup', { clientX: 10, clientY: 10 });
  assert.equal(root.querySelector('.map-ask').hidden, true, 'a click on open ground puts the question away');
  dom.fire(canvas, 'pointermove', { clientX: rift.x, clientY: rift.y });
  assert.equal(root.querySelector('.map-tip').hidden, false);
  assert.equal(root.querySelector('.map-tip').textContent, 'A nocturne rift');
  // A drag.
  const before = view.debug().view;
  dom.fire(canvas, 'pointerdown', { clientX: 100, clientY: 100 });
  dom.fire(canvas, 'pointermove', { clientX: 140, clientY: 120 });
  dom.fire(canvas, 'pointermove', { clientX: 180, clientY: 130 });
  dom.fire(canvas, 'pointerup', { clientX: 180, clientY: 130 });
  const after = view.debug().view;
  assert.equal(after.cx, before.cx - 80 / 4);
  assert.equal(after.cy, before.cy - 30 / 4);
  assert.equal(root.querySelector('.map-ask').hidden, true);
  assert.ok(!viewport.classList.contains('dragging'));
  // The wheel zooms at the pointer.
  dom.fire(viewport, 'wheel', { deltaY: -100, clientX: 200, clientY: 200 });
  assert.equal(view.debug().view.zoom, 8);
});

test('refresh reads the shell again; a lantern that stops being a destination drops its question', () => {
  const { dom, root, view, explored, markers, paints } = mountMap();
  view.open({ focus: 'rift:a' });
  dom.flush();
  assert.equal(view.debug().view.cx, 40.5, 'open({ focus }) centres on it');
  const lantern = root.querySelectorAll('.map-dest').find((b) => b.dataset.marker === 'lantern:28,-34');
  dom.fire(lantern, 'click');
  assert.equal(root.querySelector('.map-ask').hidden, false);
  markers[2] = { ...markers[2], lit: false, travel: false };
  explored.add('5,5');
  view.refresh();
  assert.equal(root.querySelector('.map-ask').hidden, true);
  assert.equal(root.querySelectorAll('.map-dest').length, 1);
  assert.equal(root.querySelector('.map-empty').hidden, false);
  assert.equal(view.debug().known, 4);
  // Chunk art is kept across refreshes (the ground doesn't change), and cleared on request.
  const before = paints.length;
  view.refresh();
  dom.flush();
  assert.equal(paints.length, before);
  view.refresh({ repaint: true });
  dom.flush();
  assert.ok(paints.length > before);
  view.dispose();
  assert.equal(root.children.length, 0);
  view.open();
  assert.equal(view.isOpen(), false, 'a disposed view stays shut');
});

test('focus finds its way back after a refresh rebuilds the list under the question', () => {
  const { dom, root, view, markers } = mountMap();
  // The shell's own kind of label.
  markers[2] = { ...markers[2], label: 'A lantern by the road' };
  view.open();
  dom.flush();
  const pick = () => root.querySelectorAll('.map-dest').find((b) => b.dataset.marker === 'lantern:28,-34');
  const first = pick();
  first.focus();
  dom.fire(first, 'click');
  assert.equal(root.querySelector('.map-ask-q').textContent, 'Travel to a lantern by the road?');
  assert.equal(dom.doc.activeElement.textContent, 'Travel');
  // Something finishes in the vale and the shell refreshes the map: the list is built again.
  view.refresh({ vale: true });
  const rebuilt = pick();
  assert.notEqual(rebuilt, first, 'the list really was rebuilt');
  assert.equal(first.isConnected, false);
  assert.equal(root.querySelector('.map-ask').hidden, false, 'the question stays');
  assert.equal(dom.doc.activeElement.textContent, 'Travel', 'and so does focus');
  dom.fire(dom.doc.activeElement, 'keydown', { key: 'Escape' });
  assert.equal(root.querySelector('.map-ask').hidden, true);
  assert.equal(view.isOpen(), true);
  assert.equal(dom.doc.activeElement, rebuilt, 'back on the same place in the new list');
  // The map's keys still reach it there.
  dom.fire(dom.doc.activeElement, 'keydown', { key: '+' });
  assert.equal(view.debug().view.zoom, 8);
  // Cancel does the same.
  dom.fire(rebuilt, 'click');
  view.refresh();
  dom.fire(root.querySelector('.map-ask-cancel'), 'click');
  assert.equal(dom.doc.activeElement, pick());
  // The place stops being a destination while its question is open: the map itself takes focus.
  dom.fire(pick(), 'click');
  markers[2] = { ...markers[2], lit: false, travel: false };
  view.refresh();
  assert.equal(root.querySelector('.map-ask').hidden, true);
  const viewport = root.querySelector('.map-viewport');
  assert.equal(dom.doc.activeElement, viewport);
  const cx = view.debug().view.cx;
  dom.fire(dom.doc.activeElement, 'keydown', { key: 'ArrowLeft' });
  assert.ok(view.debug().view.cx < cx, 'and the arrow keys still pan');
  // A focused list entry whose place goes: its neighbour in the list takes focus.
  markers[2] = { ...markers[2], lit: true, travel: true };
  view.refresh();
  pick().focus();
  markers[2] = { ...markers[2], lit: false, travel: false };
  view.refresh();
  assert.equal(dom.doc.activeElement, root.querySelectorAll('.map-dest')[0]);
  assert.equal(dom.doc.activeElement.dataset.marker, 'home');
  // And one still there keeps it.
  markers[2] = { ...markers[2], lit: true, travel: true };
  view.refresh();
  pick().focus();
  view.refresh();
  assert.equal(dom.doc.activeElement, pick());
  // The wheel puts the question away while Travel has focus: the map takes it, not the page.
  dom.fire(pick(), 'click');
  assert.equal(dom.doc.activeElement.textContent, 'Travel');
  dom.fire(viewport, 'wheel', { deltaY: 100, clientX: 200, clientY: 200 });
  assert.equal(root.querySelector('.map-ask').hidden, true);
  assert.equal(dom.doc.activeElement, viewport);
});

test('the harbor’s mist is laid on the chunks and the vale’s picture as they are made', () => {
  const { dom, view } = mountMap();
  view.open({ center: { x: 56, y: 44 }, zoom: 8 });
  dom.flush();
  const images = dom.canvases.flatMap((c) => c._ctx.calls.filter(([k]) => k === 'putImageData').map(([, image]) => image));
  const grey = (w, h) => new Uint8ClampedArray(w * h * 4).fill(200); // what the fake canvases read back
  const has = (data) => images.some((im) => im.data.length === data.length && im.data.every((v, i) => v === data[i]));
  // (2, 0) lies in the bank's box but the mist has faded before it.
  for (const [cx, cy] of [[1, 1], [2, 1]]) {
    const want = grey(256, 256);
    assert.ok(layHarborMist(want, cx * 32, cy * 32, 256, 256, 8, 'wilds') > 0);
    assert.ok(has(want), `chunk ${cx},${cy} wears the mist`);
  }
  const vale = grey(1024, 704);
  assert.ok(layHarborMist(vale, 0, 0, 1024, 704, 16, 'vale') > 0);
  assert.ok(has(downscaleMode(vale, 1024, 704, 2).data), 'and the vale’s picture, past its box');
  assert.ok(!has(downscaleMode(grey(1024, 704), 1024, 704, 2).data), 'never without it');
});

test('the vale is reduced once per picture, and again when the shell says it was redrawn', () => {
  let picture = null;
  let reads = 0;
  const { dom, view } = mountMap({ valeImage: () => picture });
  const make = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const node = make(tag);
    if (tag === 'canvas') {
      const read = node._ctx.getImageData;
      node._ctx.getImageData = function (x, y, w, h) { if (w === 1024 && h === 704) reads += 1; return read.call(this, x, y, w, h); };
    }
    return node;
  };
  picture = dom.doc.createElement('canvas');
  picture.width = 1024;
  picture.height = 704;
  view.open();
  dom.flush();
  assert.equal(reads, 1, 'read once to make it small');
  view.close();
  view.open();
  dom.flush();
  view.refresh();
  dom.flush();
  assert.equal(reads, 1, 'the same picture is kept across opens and plain refreshes');
  view.refresh({ vale: true });
  dom.flush();
  assert.equal(reads, 2, 'a redrawn vale is read again');
  const next = dom.doc.createElement('canvas');
  next.width = 1024;
  next.height = 704;
  picture = next;
  view.close();
  view.open();
  dom.flush();
  assert.equal(reads, 3, 'a new picture is read on open');
});

test('a shell that hands over nothing still gets a calm, working map', () => {
  const dom = fakeDom();
  const root = dom.doc.createElement('section');
  dom.doc.body.append(root);
  const view = createMapView(root, {
    paintChunk: () => { throw new Error('not ready'); },
    valeImage: () => null,
    explored: () => { throw new Error('boom'); },
    markers: () => 'nothing',
  });
  view.open();
  dom.flush();
  assert.equal(view.isOpen(), true);
  assert.equal(view.debug().view.cx, 32, 'centred on the vale');
  assert.equal(root.querySelectorAll('.map-dest').length, 0);
  assert.equal(root.querySelector('.map-empty').hidden, false);
  assert.ok(root.querySelectorAll('button').find((b) => b.textContent === 'Centre on Milo').disabled);
  view.refresh();
  view.close();
  assert.throws(() => createMapView(null, {}), /root/);
});
