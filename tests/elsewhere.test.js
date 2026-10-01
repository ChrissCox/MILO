// Rift drawing and the Elsewhere (CONTRACT-PHASE3.md §7.2, §7.3 and §9 F): src/world/riftfx.js and
// src/world/elsewhere.js. The tear in every stage and genre, sprite tables, bleeds that never touch
// the heart, strays that keep to walkable ground inside the bleed, and Elsewheres that can always
// be walked from the way in to the seam, the way home, the loot and the curio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PALETTE, SPRITES, MILO, rowsToImageData } from '../src/world/sprites.js';
import { buildGenrePalette, ROLES } from '../src/world/genres.js';
import { createRiftgen, reachable } from '../src/world/riftgen.js';
import { createWorldgen, CHUNK, HEART } from '../src/world/worldgen.js';
import { basePaletteByCode, colourise, paintRegion } from '../src/world/wildsart.js';
import { createRng, hashInts } from '../src/world/rng.js';
import * as fx from '../src/world/riftfx.js';
import { buildElsewhere, paintGround } from '../src/world/elsewhere.js';
import { leadDisplayName } from '../src/world/leadname.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../content/${file}`, import.meta.url), 'utf8'));
const words = read('riftgen.json');
const genres = read('genres.json');
const riftgen = createRiftgen({ words, genres });
const GENRES = genres.genres;
const byId = Object.fromEntries(GENRES.map((g) => [g.id, g]));
const IDS = GENRES.map((g) => g.id);
const STAGES = ['hairline', 'open', 'gaping'];
const KEYS = new Set(Object.keys(PALETTE));
const BASE = basePaletteByCode();
const T = 16;
const feetTile = (p) => ({ x: Math.floor(p.x / T), y: Math.floor((p.y - 13 + 8) / T) });
const inHeart = (x, y) => x >= HEART.x && y >= HEART.y && x < HEART.x + HEART.w && y < HEART.y + HEART.h;
const inHeartOrRing = (x, y) => x >= -1 && y >= -1 && x <= HEART.w && y <= HEART.h;
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

/** A rift as the engine sees it (CONTRACT-PHASE3.md §4.4), built from a riftgen spec. */
function rift(spec, x, y, over = {}) {
  return { id: spec.id, key: spec.key ?? null, kind: spec.kind, spec, x, y, stage: spec.stage, urgency: 0.5, held: null, warded: null, ...over };
}
const withStage = (spec, stage) => ({ ...spec, stage });
const wildSpec = (i, extra = {}) => riftgen.wildRift({ seed: hashInts(i, 'fx-test'), tier: 1 + (i % 8), depth: 1 + (i % 9), ...extra });
/** A wild spec of one genre alone (the first seed from i that rolls no fusion). */
function specOf(genre, i = 1) {
  const weights = Object.fromEntries(IDS.map((id) => [id, id === genre ? 100 : 1e-6]));
  for (let n = i; ; n += 1000) {
    const spec = wildSpec(n, { weights });
    if (spec.genres.length === 1 && spec.genres[0] === genre) return spec;
  }
}

// Calm copy, as tests/core.test.js checks it.
const PROPER = new Set(['Milo', 'MILO', 'Chris']);
function assertCalm(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.ok(!text.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji: ${text}`);
  assert.ok(!text.includes('"'), `${where} uses curly quotes only: ${text}`);
  const first = text.match(/\p{L}/u);
  if (first) assert.equal(first[0], first[0].toUpperCase(), `${where} starts with a capital: ${text}`);
  for (const word of text.split(/\s+/).slice(1).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}’]+$/gu, ''))) {
    if (!word || PROPER.has(word)) continue;
    assert.equal(word[0], word[0].toLowerCase(), `${where} is sentence case, "${word}" in: ${text}`);
  }
}

// ---------- the tear ----------

test('every tear stage and genre renders with valid colours, shimmers and can be warded', () => {
  const BODY = { hairline: [5, 13], open: [9, 21], gaping: [13, 29] };
  for (const genre of GENRES) {
    const palette = buildGenrePalette(genre);
    let lastArea = 0;
    for (const stage of STAGES) {
      const frames = new Set();
      for (let frame = 0; frame < fx.TEAR_FRAMES; frame += 1) {
        for (const warded of [false, true]) {
          const art = fx.tearArt(stage, genre, frame, { warded });
          const where = `${genre.id} ${stage} frame ${frame}${warded ? ' warded' : ''}`;
          assert.equal(art.h, art.rows.length, where);
          assert.ok(art.rows.every((row) => row.length === art.w), `${where}: rectangular`);
          const used = new Set(art.rows.join('').replace(/\./g, ''));
          for (const key of used) assert.ok(isRgb(art.colours[key]), `${where}: colour for '${key}'`);
          for (const key of Object.keys(art.colours)) assert.ok(used.has(key), `${where}: '${key}' is used`);
          assert.deepEqual([art.body.w, art.body.h], BODY[stage], `${where}: body size`);
          assert.ok(art.body.x >= 0 && art.body.y >= 0 && art.body.x + art.body.w <= art.w && art.body.y + art.body.h <= art.h, `${where}: body inside`);
          assert.ok(art.anchor.x >= art.body.x && art.anchor.x < art.body.x + art.body.w, `${where}: anchor under the tear`);
          assert.ok(art.anchor.y >= art.body.y + art.body.h - 1, `${where}: anchor at or below its tip`);
          // The tear is the genre's: ink, rim and the other world inside.
          assert.deepEqual(art.colours.d, palette.o, `${where}: ink`);
          assert.deepEqual(art.colours.a, palette[ROLES[genre.rift.rim][0]], `${where}: rim`);
          if (art.colours.b) assert.deepEqual(art.colours.b, palette[ROLES[genre.rift.inner][0]], `${where}: inner`);
          if (warded) {
            assert.ok(used.has('t'), `${where}: a binding stitch`);
            assert.deepEqual(art.colours.t, BASE['c'.charCodeAt(0)], `${where}: in the Hushlands' cream thread`);
          } else {
            assert.ok(!used.has('t'), `${where}: no stitch unless warded`);
            frames.add(art.rows.join('\n'));
          }
        }
      }
      assert.ok(frames.size >= 3, `${genre.id} ${stage}: at least 3 shimmer frames (${frames.size})`);
      const area = fx.tearArt(stage, genre, 0).body.w * fx.tearArt(stage, genre, 0).body.h;
      assert.ok(area > lastArea, `${stage} is bigger than the stage before`);
      lastArea = area;
      assert.deepEqual(fx.tearArt(stage, genre, fx.TEAR_FRAMES + 1), fx.tearArt(stage, genre, 1), 'frames wrap');
      assert.deepEqual(fx.tearArt(stage, genre, -1), fx.tearArt(stage, genre, fx.TEAR_FRAMES - 1), 'negative frames wrap');
      assert.notDeepEqual(fx.tearArt(stage, genre, 0, { warded: true }).rows, fx.tearArt(stage, genre, 0).rows);
    }
  }
  // Without a genre it still draws, in the world's own colours; motion off shows frame 0.
  const plain = fx.tearArt('open', null, 0);
  assert.ok(Object.values(plain.colours).every(isRgb));
  assert.equal(fx.tearFrameAt(null), 0);
  assert.equal(fx.tearFrameAt(fx.TEAR_FRAME_MS * 5), 5 % fx.TEAR_FRAMES);
});

test('the seal and the let-go have art at every step, and finish with nothing left', () => {
  for (const stage of STAGES) {
    for (const id of ['neon', 'gothic', 'starlight']) {
      const genre = byId[id];
      const base = fx.tearArt(stage, genre, 0);
      const inked = (rows) => rows.join('').replace(/\./g, '').length;
      let threaded = false;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const art = fx.sealArt(stage, genre, p);
        assert.equal(art.rows.length, base.rows.length, 'same frame as the tear');
        assert.ok(art.rows.every((row) => row.length === base.w));
        for (const key of new Set(art.rows.join('').replace(/\./g, ''))) assert.ok(isRgb(art.colours[key]), `seal ${stage} ${p}: '${key}'`);
        if (art.rows.join('').includes('t')) threaded = true;
      }
      assert.ok(threaded, 'the thread runs through it');
      assert.ok(inked(fx.sealArt(stage, genre, 0.95).rows) < inked(fx.sealArt(stage, genre, 0.3).rows), 'it closes');
      assert.equal(inked(fx.sealArt(stage, genre, 1).rows), 0, 'nothing left at the end');
      let lastDx = 1;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const f = fx.letGoFrame(stage, genre, p);
        for (const key of new Set(f.rows.join('').replace(/\./g, ''))) assert.ok(isRgb(f.colours[key]), `let go ${p}: '${key}'`);
        assert.ok(f.alpha >= 0 && f.alpha <= 1);
        assert.ok(f.dx <= lastDx, 'the moth only flies west');
        lastDx = f.dx;
      }
      assert.equal(fx.letGoFrame(stage, genre, 0).alpha, 1);
      assert.equal(fx.letGoFrame(stage, genre, 1).alpha, 0);
      assert.ok(fx.letGoFrame(stage, genre, 1).dx < -40, 'it has flown well west');
    }
  }
  assert.notDeepEqual(fx.mothArt(0).rows, fx.mothArt(1).rows, 'the moth beats its wings');
  assert.deepEqual(fx.ANIMATION_MS, { seal: 1200, letGo: 2000 });
});

test('tear art is cached and frozen, so drawing it every frame is cheap', () => {
  const neon = byId.neon;
  const art = fx.tearArt('gaping', neon, 1, { warded: true });
  assert.equal(fx.tearArt('gaping', neon, 1, { warded: true }), art, 'the same art object each time');
  assert.equal(fx.tearArt('gaping', neon, 1 + fx.TEAR_FRAMES, { warded: true }), art, 'wrapped frames share it');
  assert.equal(fx.tearArt('gaping', 'neon', 1, { warded: true, genres }), art, 'by id too');
  assert.notEqual(fx.tearArt('gaping', neon, 1), art, 'the ward is its own art');
  assert.notEqual(fx.tearArt('gaping', byId.gothic, 1, { warded: true }), art, 'each genre its own');
  for (const part of [art, art.rows, art.colours, art.anchor, art.body, art.colours.a, art.colours.t]) assert.ok(Object.isFrozen(part));
  assert.throws(() => { art.rows[0] = 'x'; }, TypeError, 'frozen (modules are strict)');
  // The genre's own palette isn't frozen or shared out through the tear.
  assert.ok(!Object.isFrozen(buildGenrePalette(neon).o));
  // Seal and let-go frames start from the cached tear and leave it as it was.
  const before = JSON.stringify(fx.tearArt('gaping', neon, 0));
  for (let p = 0; p <= 1; p += 0.1) { fx.sealArt('gaping', neon, p); fx.letGoFrame('gaping', neon, p); }
  assert.equal(JSON.stringify(fx.tearArt('gaping', neon, 0)), before);
  // A frame with three gaping tears, one sealing and one letting go (§10: a wilds frame ≤ 12 ms).
  const ids = ['neon', 'gothic', 'void'];
  for (const id of ids) for (let f = 0; f < fx.TEAR_FRAMES; f += 1) fx.tearArt('gaping', byId[id], f); // warm
  const frames = 200;
  const started = performance.now();
  for (let n = 0; n < frames; n += 1) {
    for (const id of ids) fx.tearArt('gaping', byId[id], fx.tearFrameAt(n * 16));
    fx.sealArt('gaping', byId.neon, (n % 72) / 72);
    fx.letGoFrame('gaping', byId.gothic, (n % 120) / 120);
  }
  const perFrame = (performance.now() - started) / frames;
  assert.ok(perFrame < 0.5, `rift art costs ${perFrame.toFixed(3)} ms a frame`);
});

// ---------- sprite tables ----------

test('spriteTable dresses every palette key in the genre and keeps the shadow translucent', () => {
  const baseShadowAlpha = Math.round(Number(PALETTE.x.hex.slice(5, -1).split(',')[3]) * 255);
  const TONES = Object.values(fx.COAT_TONES);
  for (const tone of TONES) assert.ok(!KEYS.has(tone) && tone !== '.', `coat tone '${tone}' is no palette key`);
  for (const genre of GENRES) {
    const table = fx.spriteTable(genre);
    const palette = buildGenrePalette(genre);
    assert.deepEqual(Object.keys(table).sort(), [...KEYS, ...TONES].sort(), `${genre.id}: every key, and the coat's tones`);
    for (const [key, rgba] of Object.entries(table)) {
      assert.equal(rgba.length, 4, `${genre.id} ${key}`);
      assert.ok(rgba.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `${genre.id} ${key}: ${rgba}`);
      if (TONES.includes(key)) {
        assert.deepEqual(rgba, [...fx.coatColours(genre)[TONES.indexOf(key)], 255], `${genre.id} coat tone ${key}`);
      } else if (key === 'x') {
        assert.equal(rgba[3], baseShadowAlpha, 'the shadow stays translucent');
        assert.deepEqual(rgba.slice(0, 3), palette.o, 'in the genre ink');
      } else {
        assert.equal(rgba[3], 255, `${genre.id} ${key} opaque`);
        assert.deepEqual(rgba.slice(0, 3), palette[key], `${genre.id} ${key} from buildGenrePalette`);
      }
    }
    assert.equal(fx.spriteTable(genre), table, 'cached');
    assert.ok(Object.isFrozen(table));
  }
  assert.deepEqual(fx.spriteTable(null).g, [...BASE['g'.charCodeAt(0)], 255], 'no genre: the world as it is');
  for (const [key, tone] of Object.entries(fx.COAT_TONES)) assert.deepEqual(fx.spriteTable(null)[tone], fx.spriteTable(null)[key], 'no genre: his own coat');
  assert.equal(fx.spriteTable('neon', { genres }), fx.spriteTable(byId.neon), 'a genre id, with genres');
  assert.deepEqual(fx.spriteTable('neon').g, fx.spriteTable(null).g, 'an id it can’t look up: the world’s own colours');
  assert.deepEqual(fx.tearArt('open', 'void', 0, { genres }), fx.tearArt('open', byId.void, 0));
});

// ---------- outfits ----------

test('in a genre Milo keeps his own face and hair: only his raincoat and scarf change', () => {
  const base = fx.spriteTable(null);
  const names = Object.keys(SPRITES).filter((name) => name.startsWith('milo.'));
  assert.ok(names.length >= 12, 'walks, breaths and chops');
  const HEAD = new Set(['t', 'o', 'm', 'k']); // skin, eyes and outline, hair, blush
  for (const id of ['neon', 'gothic', 'void', 'noir', 'kaiju']) {
    const dressed = fx.spriteTable(byId[id]);
    for (const name of names) {
      SPRITES[name].forEach((rows, frame) => {
        const where = `${id} ${name}[${frame}]`;
        const outfit = fx.outfitGrid(name, rows);
        assert.ok(outfit, `${where}: something to dress`);
        assert.equal(fx.outfitGrid(name, rows), outfit, 'cached per grid');
        const img = fx.outfitPixels(name, rows, byId[id]);
        assert.equal(img.width, rows[0].length);
        assert.equal(img.height, rows.length);
        let coat = 0;
        let face = 0;
        rows.forEach((row, y) => [...row].forEach((key, x) => {
          if (key === '.') return;
          const got = [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
          const head = y < MILO.headSplit;
          if (HEAD.has(key) || (head && key === 'b') || key === 'B' || key === 'n' || key === 's' || key === 'S' || key === 'c') {
            // His face, eyes, hair and boots (and an axe) are his own, whatever he stands in.
            assert.deepEqual(got, base[key], `${where}: '${key}' at ${x},${y} keeps its own colour`);
            if (key === 't') face += 1;
          } else if ('uUYrRQ'.includes(key)) {
            // The coat in the coat's own tones (coatColours), the scarf in the genre's clay.
            const want = dressed[fx.COAT_TONES[key] || key];
            assert.deepEqual(got, want, `${where}: '${key}' at ${x},${y} is the genre's`);
            coat += 1;
          }
        }));
        assert.ok(coat >= 20, `${where}: the coat and scarf take the genre (${coat})`);
        assert.ok(face >= 3 || name.startsWith('milo.up') || name.startsWith('milo.breath.up') || name.startsWith('milo.chop.up'), `${where}: a face (${face})`);
      });
    }
  }
  // The coat's shaded edge (wood 'b' in the grid) goes with the coat, in the genre's deepest coat
  // colour, while the same key on his head (the shine on his hair) stays hair.
  const rows = SPRITES['milo.down'][0];
  const outfit = fx.outfitGrid('milo.down', rows);
  const neon = fx.outfitPixels('milo.down', rows, byId.neon);
  const px = (x, y) => [...neon.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.equal(rows[13][13], 'b');
  assert.equal(outfit.rows[13][13], fx.COAT_TONES.Y);
  assert.equal(outfit.layers[13][13], '1');
  assert.deepEqual(px(13, 13), fx.spriteTable(byId.neon).Y, 'the coat edge in Neon (its glow is no clash)');
  assert.deepEqual(px(13, 13), fx.spriteTable(byId.neon)[fx.COAT_TONES.Y]);
  assert.equal(rows[3][5], 'b');
  assert.equal(outfit.layers[3][5], '0');
  assert.deepEqual(px(5, 3), base.b, 'the shine on his hair stays');
  assert.deepEqual(px(3, 7), base.t, 'his face is never pink');
  assert.deepEqual(px(5, 2), base.m, 'nor his hair black');
  // Wood chips flying from the axe (below his head, but clear of him) are the tree's, not his coat.
  const strike = SPRITES['milo.chop.down'][1];
  const chopped = fx.outfitGrid('milo.chop.down', strike);
  const chips = fx.outfitPixels('milo.chop.down', strike, byId.neon);
  for (const [x, y, key] of [[15, 11, 'b'], [0, 16, 'n'], [1, 18, 'c']]) {
    assert.equal(strike[y][x], key, `a chip at ${x},${y}`);
    assert.equal(chopped.layers[y][x], '0');
    assert.deepEqual([...chips.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)], base[key]);
  }
  // No genre: exactly the world's own colours.
  assert.deepEqual(fx.outfitPixels('milo.down', rows, null).data, fx.outfitPixels('milo.down', rows, 'nope', { genres }).data);
  const plain = fx.outfitPixels('milo.down', rows, null);
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (key !== '.') assert.deepEqual([...plain.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)], base[key]);
  }));
});

// CIE76 ΔE between two [r, g, b] colours, worked out here on its own (not riftfx's).
function deltaE(a, b) {
  const lab = ([r, g, b]) => {
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
    const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
    const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

test('in every genre Milo’s coat visibly changes, even where its glow is as honey as his coat', () => {
  const base = fx.spriteTable(null);
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const light = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  const names = ['milo.down', 'milo.up', 'milo.right', 'milo.left', 'milo.chop.down', 'milo.chop.right'];
  let swapped = 0;
  for (const genre of GENRES) {
    const table = fx.spriteTable(genre);
    // The coat as he's drawn, pixel by pixel, against his own honey coat: a clear margin in every genre.
    let sum = 0;
    let count = 0;
    for (const name of names) {
      const rows = SPRITES[name][0];
      const img = fx.outfitPixels(name, rows, genre);
      rows.forEach((row, y) => [...row].forEach((key, x) => {
        if (y < MILO.headSplit || !'uUY'.includes(key)) return;
        const i = (y * img.width + x) * 4;
        sum += deltaE([...img.data.slice(i, i + 3)], base[key].slice(0, 3));
        count += 1;
      }));
    }
    assert.ok(count > 100, `${genre.id}: coat pixels (${count})`);
    assert.ok(sum / count >= 30, `${genre.id}: his coat looks ${(sum / count).toFixed(1)} ΔE from his own honey, not a clear change`);
    // Three tones, light to deep, in one hue: the shading steps survive.
    const coat = fx.coatColours(genre);
    assert.ok(light(coat[0]) >= light(coat[1]) && light(coat[1]) >= light(coat[2]), `${genre.id}: ${JSON.stringify(coat)} shades light to deep`);
    // The glow the coat shares keys with is still the genre's own: lanterns and lit windows keep it.
    for (const key of 'uUY') assert.deepEqual(table[key].slice(0, 3), buildGenrePalette(genre)[key], `${genre.id}: glow '${key}' untouched`);
    const own = buildGenrePalette(genre);
    if (deltaE(own.U, base.U.slice(0, 3)) < 30) swapped += 1;
    else assert.deepEqual(coat.map((rgb) => [...rgb]), ['u', 'U', 'Y'].map((k) => own[k]), `${genre.id}: a glow far enough from honey is the coat as it was`);
  }
  assert.ok(swapped >= 1, 'some genre’s glow is honey enough to need another colour');
  // Gothic's candlelight (#f5c35c) is honey: the coat takes the crimson inside its tears instead.
  const gothic = byId.gothic;
  assert.ok(deltaE(buildGenrePalette(gothic).U, base.U.slice(0, 3)) < 30, 'Gothic’s own glow would leave the coat honey');
  assert.deepEqual([...fx.coatColours(gothic)[1]], hexRgb(gothic.roles[gothic.rift.inner]), 'the honey tone is the tear’s inner colour');
  const tear = fx.tearArt('open', gothic, 0);
  assert.deepEqual([...fx.coatColours(gothic)[1]], [...tear.colours.b], 'the same colour as inside a Gothic tear');
  // In the painter's terms too: the dressed grid carries the coat tones, and the genre's table dresses them.
  const outfit = fx.outfitGrid('milo.down', SPRITES['milo.down'][0]);
  const tones = new Set(Object.values(fx.COAT_TONES));
  const worn = outfit.rows.join('').split('').filter((ch) => tones.has(ch)).length;
  assert.ok(worn > 30, `the coat's pixels wear its tones (${worn})`);
  outfit.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (tones.has(ch)) assert.equal(outfit.layers[y][x], '1', `a coat tone at ${x},${y} is on the clothes`);
  }));
  // Not the other crew: Ollama's blanket shares the glow's keys and keeps the genre's glow.
  assert.ok(!fx.outfitGrid('ollama.stand', SPRITES['ollama.stand'][0]).rows.join('').split('').some((ch) => tones.has(ch)));
  // An unknown genre, or none: his own honey coat.
  assert.deepEqual(fx.coatColours(null).map((rgb) => [...rgb]), ['u', 'U', 'Y'].map((k) => base[k].slice(0, 3)));
  assert.equal(fx.coatColours('gothic', { genres }), fx.coatColours(gothic), 'by id, cached');
});

test('the crew keep their faces in a genre too: only their robes change', () => {
  const neon = fx.spriteTable(byId.neon);
  const base = fx.spriteTable(null);
  const check = (name, keep, wear, from = 0) => {
    for (const rows of SPRITES[name]) {
      const img = fx.outfitPixels(name, rows, byId.neon);
      let worn = 0;
      rows.forEach((row, y) => [...row].forEach((key, x) => {
        if (key === '.') return;
        const got = [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
        if (keep.includes(key) || y < from) assert.deepEqual(got, base[key], `${name}: '${key}' at ${x},${y} stays`);
        else if (wear.includes(key)) {
          assert.deepEqual(got, neon[key], `${name}: '${key}' at ${x},${y} is dressed`);
          worn += 1;
        }
      }));
      assert.ok(worn >= 10, `${name}: the robe changes (${worn})`);
    }
  };
  check('claude.stand', 'ockb', 'rRQ'); // cream face, ink eyes, blush
  check('codex.stand', 'otkcb', 'eEN'); // skin, eyes, blush, the book
  check('claude.work', 'ockb', 'rRQ');
  check('ollama.stand', 'ocCB', 'kKuU', 10); // ears and cheeks above the blanket stay
  // Creatures with nothing to wear stay just as they are.
  for (const name of ['helper.stand', 'helper1.work', 'jev.idle', 'whisper.idle']) {
    assert.equal(fx.outfitGrid(name, SPRITES[name][0]), null, name);
    assert.deepEqual(fx.outfitPixels(name, SPRITES[name][0], byId.neon).data, fx.outfitPixels(name, SPRITES[name][0], null).data, name);
  }
});

test('a genre table drives sprites.rowsToImageData when it takes one', (t) => {
  const make = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const table = fx.spriteTable(byId.neon);
  const image = rowsToImageData(['go'], make, table);
  if (image.data[0] !== table.g[0] || image.data[1] !== table.g[1]) {
    t.skip('sprites.rowsToImageData does not take a table yet (module D)');
    return;
  }
  assert.deepEqual([...image.data.slice(0, 4)], table.g);
  assert.deepEqual([...image.data.slice(4, 8)], table.o);
});

// ---------- the bleed ----------

test('bleeds are shaped by stage, fused by genre and positioned by origin', () => {
  const fusion = riftgen.realRift({ key: 'repo:x', subject: 'the build', signals: ['check-failing', 'working-past-bell'], urgency: 0.5 });
  for (const stage of STAGES) {
    const r = rift(withStage(fusion, stage), -20, 10);
    const bleeds = fx.bleedsFor(r, { genres, originX: -512, originY: 0 });
    assert.equal(bleeds.length, 2, 'one per genre');
    assert.deepEqual(bleeds.map((b) => b.genre), fusion.genres);
    // A fusion bleeds as one lobe per genre, each set off the tear on its own side.
    const lobes = fx.bleedLobes(r, { genres });
    assert.equal(lobes.length, 2);
    bleeds.forEach((b, n) => {
      assert.equal(b.lobe, n);
      assert.equal(b.riftId, r.id, 'the lobe belongs to its rift');
      assert.equal(b.x, (lobes[n].x + 0.5) * 16 + 512);
      assert.equal(b.y, (lobes[n].y + 0.5) * 16);
      const off = Math.hypot(b.x - ((-20 + 0.5) * 16 + 512), b.y - 10.5 * 16) / 16;
      assert.ok(Math.abs(off - fx.LOBE_OFFSET[stage]) < 0.3, `${stage}: about ${fx.LOBE_OFFSET[stage]} tiles off the tear (${off})`);
      assert.ok(Number.isInteger(b.x) && Number.isInteger(b.y), 'lobes sit on whole pixels');
      assert.equal(b.inner, 1.6 * 16);
      assert.equal(b.outer, fx.RIFT_RADIUS[stage] * 16);
      assert.ok(b.wobble > 0 && Number.isInteger(b.seed));
      assert.equal(b.seed, bleeds[0].seed, 'a fusion shares one shape');
      const palette = buildGenrePalette(byId[b.genre]);
      for (const [key, rgb] of Object.entries(palette)) assert.deepEqual(b.palette[key.charCodeAt(0)], rgb, 'palette by key code');
      assert.deepEqual(b.heart, { x0: 512, y0: 0, x1: 64 * 16 + 512, y1: 44 * 16 });
    });
    const dot = (bleeds[0].x - (-19.5 * 16 + 512)) * (bleeds[1].x - (-19.5 * 16 + 512)) + (bleeds[0].y - 168) * (bleeds[1].y - 168);
    assert.ok(dot < 0, 'the two lobes lie on opposite sides of the tear');
  }
  // One genre: one bleed, centred on the tear.
  const single = rift(withStage(specOf('neon'), 'open'), -20, 10);
  const [one] = fx.bleedsFor(single, { genres });
  assert.deepEqual([one.x, one.y, one.lobe], [-19.5 * 16, 10.5 * 16, 0]);
  assert.deepEqual(fx.bleedLobes(single, { genres }), [single]);
  assert.deepEqual(fx.RIFT_RADIUS, { hairline: 3, open: 5, gaping: 7 });
  const r = rift(fusion, -20, 10);
  assert.deepEqual(fx.bleedsFor({ ...r, x: null, y: null, held: 'nights-off' }, { genres }), [], 'a held rift has no bleed');
  assert.deepEqual(fx.bleedsFor({ ...r, held: 'nights-off' }, { genres }), []);
  assert.equal(fx.bleedsFor(r, { genres, tileSize: 8 })[0].outer, 5 * 8, 'scales with the tile size');
  const known = fx.bleedsFor({ ...r, spec: { ...fusion, genres: ['neon', 'nope'] } }, { genres });
  assert.equal(known.length, 1, 'unknown genres are skipped');
  assert.deepEqual([known[0].x, known[0].y], [-19.5 * 16, 10.5 * 16], 'and one known genre bleeds from the tear itself');
  // A standing bleed (the Greyreach's patchwork) works too.
  const standing = fx.bleedsFor({ x: 5, y: -90, radius: 9, genre: 'gothic' }, { genres });
  assert.equal(standing.length, 1);
  assert.equal(standing[0].outer, 9 * 16);
});

test('bleeds never touch the heart', () => {
  const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const cases = [];
  // Real rifts, placed as the shell places them with the smallest ward, at every urgency.
  const signals = [['working-past-bell'], ['needs-you-unanswered'], ['crew-capacity-high'], ['milestone-reached'], ['check-failing', 'task-stale'], ['deadline-near', 'session-after-midnight', 'scope-growing']];
  signals.forEach((sig, n) => {
    for (const urgency of [0.05, 0.4, 0.7, 0.95, 1]) {
      const spec = riftgen.realRift({ key: `test:${n}:${urgency}`, subject: 'something', signals: sig, urgency });
      const at = world.placeRealRift(spec, { urgency, wardRadius: 0 });
      cases.push(rift(withStage(spec, 'gaping'), at.x, at.y));
    }
  });
  // Rifts pressed right up against the walls, on every side.
  const spec = wildSpec(3);
  for (const [x, y] of [[32, -2], [-2, 20], [65, 14], [11, 45], [-2, -2], [66, 46], [20, -3]]) cases.push(rift(withStage(spec, 'gaping'), x, y));
  // Wild rifts in the chunks round the vale.
  for (let cy = -2; cy <= 2; cy += 1) for (let cx = -2; cx <= 3; cx += 1) {
    for (const spawn of world.wildRiftSpawns(cx, cy, 0, { wardRadius: 0 })) cases.push(rift(riftgen.wildRift(spawn), spawn.x, spawn.y));
  }
  assert.ok(cases.length >= 40);
  let heartPixelsInReach = 0;
  const S = 4; // paint at 4 px per tile to keep this quick; the bleed scales with it
  for (const r of cases) {
    const reach = fx.RIFT_RADIUS[r.stage] + 3;
    const x0 = r.x - reach;
    const y0 = r.y - reach;
    const w = reach * 2 + 1;
    const h = reach * 2 + 1;
    const region = paintRegion(world, x0, y0, w, h, S);
    const bleeds = fx.bleedsFor(r, { genres, tileSize: S, originX: x0 * S, originY: y0 * S });
    const rgba = colourise(region.keys, region.width, region.height, BASE, bleeds);
    for (let py = 0; py < region.height; py += 1) {
      for (let px = 0; px < region.width; px += 1) {
        const tx = x0 + Math.floor(px / S);
        const ty = y0 + Math.floor(py / S);
        if (!inHeart(tx, ty)) continue;
        const i = py * region.width + px;
        assert.equal(region.keys[i], 0, 'heart ground is left clear');
        assert.equal(rgba[i * 4 + 3], 0, `rift at ${r.x},${r.y} left heart pixel ${tx},${ty} alone`);
        const wx = (x0 * S + px) * (T / S);
        const wy = (y0 * S + py) * (T / S);
        if (Math.hypot(wx - (r.x + 0.5) * T, wy - (r.y + 0.5) * T) < fx.RIFT_RADIUS[r.stage] * T) heartPixelsInReach += 1;
      }
    }
    // And the genre picker agrees: nothing standing in the heart is ever dressed in a genre.
    for (let wy = Math.max(0, (r.y - reach) * T); wy < Math.min(HEART.h * T, (r.y + reach) * T); wy += 3) {
      for (let wx = Math.max(0, (r.x - reach) * T); wx < Math.min(HEART.w * T, (r.x + reach) * T); wx += 3) {
        assert.equal(fx.bleedAt([r], wx, wy, { genres }), null, `bleedAt(${wx}, ${wy}) in the heart`);
      }
    }
    assert.ok(r.spec.genres.includes(fx.bleedAt([r], (r.x + 0.5) * T, (r.y + 0.5) * T, { genres })), 'the tear itself is in its genre');
  }
  assert.ok(heartPixelsInReach > 1000, `the test reached into the heart (${heartPixelsInReach} px)`);
  // Weather never falls inside the heart either.
  const close = rift(withStage(specOf('noir'), 'gaping'), 30, -2);
  for (let t = 0; t < 4000; t += 500) {
    for (const p of fx.weatherPixels(close, { genres, t })) assert.ok(!inHeart(Math.floor(p.x / T), Math.floor(p.y / T)));
  }
});

test('bleedAt picks the genre the recolouring paints, block by block', () => {
  // South of the vale world px are positive, so a buffer from (0, 0) has local = world pixels.
  const W = 1280;
  const H = 1100;
  const keys = new Uint8Array(W * H).fill('g'.charCodeAt(0));
  const fusion = riftgen.realRift({ key: 'repo:y', subject: 'the build', signals: ['check-failing', 'working-past-bell'], urgency: 0.8 });
  const rifts = [
    rift(withStage(fusion, 'gaping'), 30, 50),
    rift(withStage(specOf('gothic', 4), 'open'), 36, 56),
    rift(withStage(specOf('frontier', 5), 'hairline'), 60, 45),
    rift(withStage(specOf('void', 6), 'open'), 10, 60, { x: null, y: null, held: 'capacity-95' }),
  ];
  const bleeds = rifts.flatMap((r) => fx.bleedsFor(r, { genres }));
  // wildsart.colourise decides pixel by pixel; the bleed shapes still match block by block
  // everywhere but a thin dithered fringe.
  const rgba = colourise(keys, W, H, BASE, bleeds);
  const colourOf = (id) => buildGenrePalette(byId[id]).g;
  const counts = {};
  let agree = 0;
  let outside = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const got = fx.bleedAt(rifts, x, y, { genres });
      counts[got] = (counts[got] || 0) + 1;
      assert.equal(fx.bleedAt(rifts, x ^ 1, y ^ 1, { genres }), got, 'one genre per 2x2 block');
      if (inHeart(x >> 4, y >> 4)) {
        assert.equal(got, null, 'never in the heart');
        continue;
      }
      outside += 1;
      const i = (y * W + x) * 4;
      const want = got ? colourOf(got) : BASE['g'.charCodeAt(0)];
      if (rgba[i] === want[0] && rgba[i + 1] === want[1] && rgba[i + 2] === want[2]) agree += 1;
    }
  }
  assert.ok(agree / outside > 0.99, `${((agree / outside) * 100).toFixed(2)}% agree`);
  for (const id of ['neon', 'nocturne', 'gothic', 'frontier']) assert.ok(counts[id] > 200, `${id} appears (${counts[id]})`);
  assert.ok(!counts.void, 'a held rift bleeds nowhere');
});

test('a fusion bleeds as its lobes everywhere: ground, genre picker, cover, reach and weather agree', () => {
  const fusion = riftgen.realRift({ key: 'repo:lobes', subject: 'the build', signals: ['check-failing', 'working-past-bell'], urgency: 0.8 });
  for (const stage of STAGES) {
    const r = rift(withStage(fusion, stage), 90, -30);
    const lobes = fx.bleedLobes(r, { genres });
    assert.equal(fx.bleedLobes(r, { genres }), lobes, 'cached per rift');
    assert.deepEqual(fx.bleedLobes(lobes[0], { genres }), [lobes[0]], 'a lobe is its own single bleed');
    assert.ok(lobes.every((l) => l.lobeOf === r.id && l.spec.genres.length === 1 && l.id.startsWith(`${r.id}~`)));
    // The picker reads the whole rift exactly as it reads its lobes.
    const reach = fx.bleedReach(r);
    assert.equal(reach, (fx.RIFT_RADIUS[stage] + fx.WOBBLE / 2 + fx.LOBE_OFFSET[stage]) * T, 'the reach allows for the lobes');
    const cx = (r.x + 0.5) * T;
    const cy = (r.y + 0.5) * T;
    const seen = new Set();
    let far = 0;
    for (let y = cy - reach - 8; y <= cy + reach + 8; y += 3) {
      for (let x = cx - reach - 8; x <= cx + reach + 8; x += 3) {
        const got = fx.bleedAt([r], x, y, { genres });
        assert.equal(got, fx.bleedAt(lobes, x, y, { genres }), `${stage}: ${x},${y}`);
        if (got) seen.add(got);
        if (got && Math.hypot(x - cx, y - cy) > reach) far += 1;
      }
    }
    assert.deepEqual([...seen].sort(), [...fusion.genres].sort(), 'both stories bleed');
    assert.equal(far, 0, 'nothing past the reach');
    // Each side belongs to its own lobe's story.
    for (const lobe of lobes) {
      const dx = lobe.x - r.x;
      const dy = lobe.y - r.y;
      let mine = 0;
      for (let i = 0; i < 64; i += 1) {
        const px = (r.x + 0.5 + dx * 1.8) * T + (i % 8) * 2 - 8;
        const py = (r.y + 0.5 + dy * 1.8) * T + Math.floor(i / 8) * 2 - 8;
        if (fx.bleedAt([r], px, py, { genres }) === lobe.spec.genres[0]) mine += 1;
      }
      assert.ok(mine > 40, `${stage}: ${lobe.spec.genres[0]} holds its side (${mine} of 64)`);
    }
    // The ground a chunk painter makes from bleedsFor(rift) is the ground bleedAt reads.
    const S = 4;
    const x0 = r.x - 12;
    const y0 = r.y - 12;
    const keys = new Uint8Array(25 * S * 25 * S).fill('g'.charCodeAt(0));
    const rgba = colourise(keys, 25 * S, 25 * S, BASE, fx.bleedsFor(r, { genres, tileSize: S, originX: x0 * S, originY: y0 * S }));
    const lobed = colourise(keys, 25 * S, 25 * S, BASE, lobes.flatMap((l) => fx.bleedsFor(l, { genres, tileSize: S, originX: x0 * S, originY: y0 * S })));
    assert.deepEqual(rgba, lobed, `${stage}: the map painter's bleed is the lobes'`);
    // Weather falls on each story's own ground.
    if (stage !== 'hairline') {
      const rgbOf = (id) => {
        const g = byId[id];
        const p = buildGenrePalette(g);
        return (p[g.particles.key] || p.c).join();
      };
      const pixels = fx.weatherPixels(r, { genres, t: 4321 });
      assert.ok(pixels.length > 5);
      for (const p of pixels) {
        const at = fx.bleedAt([r], p.x, p.y, { genres });
        assert.ok(at, 'inside the bleed');
        assert.equal(p.rgb.join(), rgbOf(at), `${stage}: ${at} weather at ${p.x},${p.y}`);
      }
    }
  }
});

test('bleedCover measures how much of a tile a rift dresses', () => {
  const byRing = { open: [], gaping: [] };
  for (let n = 0; n < 40; n += 1) {
    for (const stage of ['open', 'gaping']) {
      const r = rift(withStage(wildSpec(n + 300), stage), -200 + n * 3, 30 + (n % 5));
      assert.ok(fx.bleedCover(r, r.x, r.y, { genres }) >= 0.75, 'the tear stands on its own ground');
      const far = fx.RIFT_RADIUS[stage] + fx.WOBBLE;
      assert.equal(fx.bleedCover(r, r.x + Math.ceil(far) + 1, r.y), 0, 'nothing past the bleed');
      for (let ring = 0; ring <= fx.RIFT_RADIUS[stage] + 2; ring += 1) {
        const v = fx.bleedCover(r, r.x + ring, r.y, { genres });
        assert.ok(v >= 0 && v <= 1);
        (byRing[stage][ring] ||= []).push(v);
      }
      assert.equal(fx.bleedCover({ ...r, x: null, y: null, held: 'nights-off' }, r.x, r.y), 0, 'a held rift dresses nothing');
    }
  }
  for (const stage of ['open', 'gaping']) {
    const means = byRing[stage].map((list) => list.reduce((a, b) => a + b, 0) / list.length);
    for (let ring = 1; ring < means.length; ring += 1) assert.ok(means[ring] <= means[ring - 1] + 0.02, `${stage}: thins out with distance (${means.map((m) => m.toFixed(2))})`);
    assert.ok(means[0] > 0.95 && means[means.length - 1] < 0.05);
  }
  // Right against the wall, the heart's own tiles are never dressed.
  const r = rift(withStage(wildSpec(9), 'gaping'), 30, -1);
  for (let x = 26; x <= 34; x += 1) for (let y = 0; y <= 4; y += 1) assert.equal(fx.bleedCover(r, x, y, { genres }), 0);
});

test('sprites wear a bleed whole: what stands is dressed by its tile, and a walker changes once per crossing', () => {
  assert.deepEqual({ ...fx.DRESS }, { at: 0.5, on: 0.55, off: 0.45, swap: 0.1, spread: 8 });
  let dressedIn = 0;
  let bareOut = 0;
  for (let n = 0; n < 24; n += 1) {
    for (const stage of STAGES) {
      const spec = withStage(wildSpec(n + 700), stage);
      const r = rift(spec, -150 + (n % 8) * 30, 60 + Math.floor(n / 8) * 30);
      // Whatever stands on a tile the bleed mostly recolours is dressed; one it barely touches isn't.
      for (let dy = -9; dy <= 9; dy += 1) {
        for (let dx = -9; dx <= 9; dx += 1) {
          const cover = fx.bleedCover(r, r.x + dx, r.y + dy, { genres });
          const dress = fx.tileDressAt([r], r.x + dx, r.y + dy, { genres });
          if (cover >= 0.75) {
            assert.ok(spec.genres.includes(dress), `${stage}: ${dx},${dy} (cover ${cover.toFixed(2)}) is dressed`);
            dressedIn += 1;
          } else if (cover <= 0.25) {
            assert.equal(dress, null, `${stage}: ${dx},${dy} (cover ${cover.toFixed(2)}) is not dressed`);
            bareOut += 1;
          }
        }
      }
      // A sprite standing at a pixel is one answer for its whole foot, not a dithered pixel.
      const at = fx.bleedStrengthAt([r], (r.x + 0.5) * T, (r.y + 0.5) * T, { genres });
      assert.ok(at && at.s > 0.5 && spec.genres.includes(at.genre), 'the tear holds its own ground');
      if (spec.genres.length === 1) assert.equal(at.s, 1, 'whole, for a rift of one genre');
      assert.ok(spec.genres.includes(fx.bleedDressAt([r], (r.x + 0.5) * T, (r.y + 0.5) * T, { genres })));
    }
  }
  assert.ok(dressedIn > 1000 && bareOut > 1000, `${dressedIn} dressed and ${bareOut} bare tiles checked`);
  // Walking straight through a gaping bleed, Milo's coat changes as he goes in and as he comes out,
  // and no more, however the fringe's dither flickers under him (it does, many times).
  let walks = 0;
  let flicker = 0;
  for (let n = 0; n < 30; n += 1) {
    const spec = withStage(wildSpec(n + 900), 'gaping');
    const r = rift(spec, -150 + (n % 10) * 30, 60 + Math.floor(n / 10) * 30);
    const single = spec.genres.length === 1;
    for (const off of [-2, 0, 2]) {
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const dress = fx.makeDresser({ genres });
        let changes = 0;
        let ground = 0;
        let prev = null;
        let prevGround = null;
        for (let k = -12 * T; k <= 12 * T; k += 1) {
          const px = (r.x + 0.5 + (ay ? off : 0)) * T + ax * k;
          const py = (r.y + 0.5 + (ax ? off : 0)) * T + ay * k;
          const g = dress([r], px, py);
          if (g !== prev) changes += 1;
          prev = g;
          const under = fx.bleedAt([r], px, py, { genres });
          if (under !== prevGround) ground += 1;
          prevGround = under;
        }
        assert.ok(changes >= 2, 'he wears the genre inside');
        assert.ok(changes <= (single ? 2 : 4), `${spec.genres.join('+')}: ${changes} changes of coat on one walk (the ground flips ${ground} times)`);
        if (ground > 10) flicker += 1;
        walks += 1;
      }
    }
  }
  assert.ok(flicker > walks / 2, 'the dithered ground under him flickers on most walks');
  // Hysteresis: on at 0.55, off at 0.45, and another genre only when clearly stronger.
  const hit = (genre, s, strengths = { [genre]: s }) => ({ genre, s, strengths });
  assert.equal(fx.nextDress(null, hit('neon', 0.52)), null);
  assert.equal(fx.nextDress(null, hit('neon', 0.56)), 'neon');
  assert.equal(fx.nextDress('neon', hit('neon', 0.46)), 'neon');
  assert.equal(fx.nextDress('neon', hit('neon', 0.44)), null);
  assert.equal(fx.nextDress('neon', null), null);
  assert.equal(fx.nextDress('neon', hit('iron', 0.6, { iron: 0.6, neon: 0.55 })), 'neon');
  assert.equal(fx.nextDress('neon', hit('iron', 0.7, { iron: 0.7, neon: 0.55 })), 'iron');
  assert.equal(fx.nextDress('neon', hit('iron', 0.7, { iron: 0.7 })), 'iron', 'out of one and straight into another');
  // Never in the heart.
  const close = rift(withStage(specOf('noir'), 'gaping'), 30, -2);
  for (let x = 24; x <= 38; x += 1) for (let y = 0; y <= 5; y += 1) assert.equal(fx.tileDressAt([close], x, y, { genres }), null);
  assert.equal(fx.bleedDressAt([close], 30 * T + 8, 2 * T + 12, { genres }), null);
  assert.equal(fx.makeDresser({ genres })([close], 30 * T + 8, 1 * T + 2), null);
  // A fusion's lobes each dress their own side, whole.
  const fusion = riftgen.realRift({ key: 'repo:dress', subject: 'the build', signals: ['check-failing', 'working-past-bell'], urgency: 0.8 });
  const fr = rift(withStage(fusion, 'gaping'), 90, -30);
  for (const lobe of fx.bleedLobes(fr, { genres })) {
    const tx = Math.round(fr.x + (lobe.x - fr.x) * 1.8);
    const ty = Math.round(fr.y + (lobe.y - fr.y) * 1.8);
    assert.equal(fx.tileDressAt([fr], tx, ty, { genres }), lobe.spec.genres[0], `${lobe.spec.genres[0]} dresses its side`);
  }
});

test('the wilds recolour chunks the way bleedAt reads them', async (t) => {
  const url = new URL('../src/world/wilds.js', import.meta.url);
  if (!existsSync(url)) {
    t.skip('src/world/wilds.js is not written yet (module E)');
    return;
  }
  const wilds = await import(url);
  if (typeof wilds.colouriseChunk !== 'function') {
    t.skip('wilds.colouriseChunk is not exported yet (module E)');
    return;
  }
  for (const [cx, cy, dx, dy] of [[-2, -1, 12, 14], [1, 1, 2, 13], [0, 2, 20, 1]]) checkChunk(wilds, cx, cy, dx, dy);
});

function checkChunk(wilds, cx, cy, dx, dy) {
  // A chunk anywhere (negative world px too), with a fusion and a single-genre rift in it.
  const originX = cx * CHUNK * T;
  const originY = cy * CHUNK * T;
  const S = CHUNK * T;
  // Chunk ground leaves the heart's pixels clear (0), as wilds.ground does.
  const keys = new Uint8Array(S * S).fill('g'.charCodeAt(0));
  for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) if (inHeart((originX + x) >> 4, (originY + y) >> 4)) keys[y * S + x] = 0;
  const fusion = riftgen.realRift({ key: 'repo:z', subject: 'the build', signals: ['check-failing', 'task-stale'], urgency: 0.8 });
  const rifts = [rift(withStage(fusion, 'gaping'), cx * CHUNK + dx, cy * CHUNK + dy), rift(withStage(specOf('iron', 9), 'open'), cx * CHUNK + dx + 8, cy * CHUNK + dy + 6)];
  const bleeds = rifts.flatMap((r) => fx.bleedsFor(r, { genres, originX, originY }));
  const rgba = wilds.colouriseChunk(keys, { base: BASE, bleeds, originX, originY });
  let mismatches = 0;
  let tinted = 0;
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const got = fx.bleedAt(rifts, originX + x, originY + y, { genres });
      const i = (y * S + x) * 4;
      if (!keys[y * S + x]) {
        assert.equal(got, null, 'nothing is dressed in the heart');
        assert.equal(rgba[i + 3], 0, 'the heart stays clear');
        continue;
      }
      if (got) tinted += 1;
      const want = got ? buildGenrePalette(byId[got]).g : BASE['g'.charCodeAt(0)];
      if (rgba[i] !== want[0] || rgba[i + 1] !== want[1] || rgba[i + 2] !== want[2]) mismatches += 1;
    }
  }
  assert.ok(tinted > 1000, `the rifts bleed into chunk ${cx},${cy}`);
  assert.equal(mismatches, 0, `chunk ${cx},${cy}: ${mismatches} pixels disagree with bleedAt`);
}

test('weather falls only inside the bleed, and only while motion is on', () => {
  for (const id of IDS) {
    const r = rift(withStage(specOf(id, 11), 'gaping'), -40, 12);
    assert.deepEqual(fx.weatherPixels(r, { genres, t: null }), [], `${id}: still with motion off`);
    const pixels = fx.weatherPixels(r, { genres, t: 12345 });
    if (byId[id].particles.type === 'none') assert.equal(pixels.length, 0, 'the Backhalls only hum');
    else assert.ok(pixels.length > 5, `${id} has weather (${pixels.length})`);
    for (const p of pixels) {
      assert.ok(isRgb(p.rgb));
      assert.notEqual(fx.bleedAt([r], p.x, p.y, { genres }), null, `${id}: weather at ${p.x},${p.y} is inside the bleed`);
    }
    if (pixels.length) assert.notDeepEqual(pixels, fx.weatherPixels(r, { genres, t: 13345 }), 'it moves');
  }
  assert.deepEqual(fx.weatherPixels(rift(specOf('neon'), 0, 0, { x: null, y: null, held: 'nights-off' }), { genres, t: 1 }), []);
});

// ---------- strays ----------

function walkableField(kind) {
  if (kind === 'open') return () => true;
  if (kind === 'woods') return (x, y) => ((hashInts(x, y, 'woods') >>> 0) % 10) < 7;
  // A corridor two tiles tall, running east-west.
  return (x, y) => y === 20 || y === 21;
}

function checkStrays(r, walkable, where) {
  const actors = fx.strayActors(r, { walkable, seed: 'hushlands' });
  const stage = r.stage;
  const strays = actors.filter((a) => !a.lead);
  const leads = actors.filter((a) => a.lead);
  if (stage === 'hairline') {
    assert.equal(actors.length, 0, `${where}: a hairline has no strays`);
    return actors;
  }
  assert.ok(strays.length <= 5, `${where}: at most 5 strays`);
  const perKind = {};
  for (const s of strays) perKind[s.name] = (perKind[s.name] || 0) + 1;
  for (const [name, n] of Object.entries(perKind)) assert.ok(n <= 2, `${where}: at most 2 of ${name}`);
  assert.equal(new Set(actors.map((a) => a.id)).size, actors.length, 'unique ids');
  for (const s of strays) {
    assert.match(s.id, new RegExp(`^stray:${r.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+$`));
    const kind = r.spec.strays.find((k) => k.name === s.name);
    assert.ok(kind, `${where}: ${s.name} is one of the rift's strays`);
    assert.equal(s.genre, kind.genre);
    assert.equal(s.second, kind.second || null);
    assert.equal(s.sprite, kind.sprite);
    assert.ok(s.speed >= 12 && s.speed <= 20, `${where}: ${s.speed} px/s`);
  }
  if (stage === 'gaping' && walkable(r.x + 1, r.y) && !inHeartOrRing(r.x + 1, r.y)) assert.equal(leads.length, 1, `${where}: the Tale-lead stands by a gaping tear`);
  if (stage !== 'gaping') assert.equal(leads.length, 0, `${where}: the Tale-lead comes only at gaping`);
  for (const lead of leads) {
    // Phase 4: the name it shows (leadname.js), with the words and hooks it was given (none here).
    assert.equal(lead.name, leadDisplayName(r.spec, undefined, { hooks: [] }));
    assert.equal(lead.id, `stray:${r.id}:lead`);
    assert.equal(Math.max(Math.abs(lead.home.x - r.x), Math.abs(lead.home.y - r.y)), 1, 'beside the tear');
    assert.ok(walkable(lead.home.x, lead.home.y));
    assert.equal(lead.positionAt(1000).moving, false, 'the Tale-lead stands still');
    assert.equal(lead.sprite.rows.length, 20);
    assert.ok(lead.sprite.rows.join('').replace(/\./g, '').split('').every((k) => KEYS.has(k)), 'palette keys');
  }
  const radius = fx.STRAY_ROAM[stage];
  const cover = new Map();
  const coverOf = (tile) => {
    const k = `${tile.x},${tile.y}`;
    if (!cover.has(k)) cover.set(k, fx.bleedCover(r, tile.x, tile.y, { genres }));
    return cover.get(k);
  };
  for (const s of strays) {
    let still = 0;
    let samples = 0;
    let prev = s.positionAt(0);
    assert.deepEqual(s.positionAt(null), { x: s.home.x * T + 8, y: s.home.y * T + 13, dir: s.positionAt(null).dir, moving: false }, 'motion off: stands at home');
    for (let t = 40; t <= 150000; t += 40) {
      const p = s.positionAt(t);
      samples += 1;
      if (!p.moving) still += 1;
      const tile = feetTile(p);
      assert.ok(walkable(tile.x, tile.y), `${where}: ${s.name} on walkable ground at ${t} ms`);
      assert.ok(Math.hypot(tile.x - r.x, tile.y - r.y) <= radius + 1e-9, `${where}: inside the bleed's core`);
      // Inside the bleed: every tile a stray stands on is mostly dressed in its rift's genres.
      assert.ok(coverOf(tile) >= fx.STRAY_COVER, `${where}: ${s.name} at ${tile.x},${tile.y} stands on ground the bleed dresses (${coverOf(tile)})`);
      assert.ok(!fx.behindTear(stage, r.x, r.y, tile.x, tile.y), `${where}: never hidden behind the tear`);
      assert.ok(!(tile.x === r.x && tile.y === r.y), 'never on the tear');
      assert.ok(!inHeartOrRing(tile.x, tile.y), 'never in the vale or on its walls');
      assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) / 0.04 <= 20.01, `${where}: slow (${Math.hypot(p.x - prev.x, p.y - prev.y) / 0.04} px/s)`);
      assert.ok(['up', 'down', 'left', 'right'].includes(p.dir));
      prev = p;
    }
    assert.ok(still / samples >= 0.45, `${where}: pauses often (${Math.round((still / samples) * 100)}% still)`);
    // Pure: the same moment always gives the same place, whatever came before.
    const times = [99999, 5, 70000, 5, 123456, 99999];
    const once = times.map((t) => s.positionAt(t));
    assert.deepEqual(times.map((t) => s.positionAt(t)), once);
    assert.deepEqual(once[1], once[3]);
  }
  return actors;
}

test('strays wander slowly on walkable tiles inside the bleed, pausing often', () => {
  const fusion = riftgen.realRift({ key: 'repo:w', subject: 'the build', signals: ['check-failing', 'working-past-bell'], urgency: 0.9 });
  let moved = 0;
  let total = 0;
  for (const field of ['open', 'woods', 'corridor']) {
    const walkable = walkableField(field);
    for (const [n, base] of [[0, fusion], [1, specOf('neon', 21)], [2, specOf('gothic', 22)], [3, specOf('starlight', 23)]]) {
      for (const stage of STAGES) {
        const r = rift(withStage(base, stage), -30 - n * 7, 20);
        const actors = checkStrays(r, walkable, `${field} ${base.genres.join('+')} ${stage}`);
        for (const a of actors.filter((x) => !x.lead)) {
          total += 1;
          if ([...Array(200)].some((_, k) => a.positionAt(k * 500).moving)) moved += 1;
        }
      }
    }
  }
  assert.ok(total > 30 && moved / total > 0.8, `most strays wander (${moved}/${total})`);
  // Up against the walls, strays still keep out of the vale and its ring.
  for (const [x, y] of [[32, -3], [66, 14], [-3, 30]]) checkStrays(rift(withStage(fusion, 'gaping'), x, y), () => true, `by the walls at ${x},${y}`);
  // Deterministic, held rifts have none, and nowhere to stand means none.
  const r = rift(withStage(fusion, 'open'), -40, 5);
  const a = fx.strayActors(r, { walkable: () => true, seed: 'hushlands' });
  const b = fx.strayActors(r, { walkable: () => true, seed: 'hushlands' });
  assert.deepEqual(a.map((s) => [s.id, s.home, s.positionAt(31337)]), b.map((s) => [s.id, s.home, s.positionAt(31337)]));
  assert.deepEqual(fx.strayActors({ ...r, x: null, y: null, held: 'nights-off' }, { walkable: () => true }), []);
  assert.deepEqual(fx.strayActors(r, { walkable: () => false }), []);
  assert.ok(fx.strayActors(r, { walkable: () => { throw new Error('no chunk'); } }).length === 0, 'a failing walkable is nowhere to stand');
});

test('the Tale-lead wears every one of its genre\'s parts', () => {
  for (const id of IDS) {
    const spec = withStage(specOf(id, 31), 'gaping');
    const { sprite, archetype } = fx.leadSprite(spec, { words });
    const partsOnly = fx.leadSprite({ ...spec, strays: [] }, { words });
    assert.equal(sprite.rows.length, 20);
    assert.ok(sprite.rows.every((row) => row.length === 20));
    assert.ok(sprite.rows.join('').replace(/\./g, '').split('').every((k) => KEYS.has(k)), `${id}: palette keys`);
    assert.ok(archetype && partsOnly.archetype);
    // More of it is drawn than any one of its strays, since it carries all four parts.
    const inked = (rows) => rows.join('').replace(/\./g, '').length;
    const kin = spec.strays.filter((s) => s.genre === spec.taleLead.genre && s.archetype === archetype);
    for (const s of kin) assert.ok(inked(sprite.rows) >= inked(s.sprite.rows) - 2, `${id}: the lead is at least as dressed as ${s.name}`);
    // The kept copy of the look matches the word banks.
    assert.deepEqual(fx.leadSprite({ ...spec, strays: [] }).sprite, fx.leadSprite({ ...spec, strays: [] }, { words }).sprite, `${id}: LEAD_LOOK matches content/riftgen.json`);
  }
});

// ---------- the Elsewhere ----------

function elsewhereSpecs() {
  const specs = [];
  for (let i = 0; i < 460; i += 1) {
    let spec = wildSpec(i + 1000);
    const extra = [null, 'mirrored', 'labyrinthine', 'sunken', 'overgrown', 'flooded', 'vast', 'tiny'][i % 8];
    if (extra) spec = { ...spec, affixes: [...spec.affixes, { id: extra, name: extra }] };
    if (i % 13 === 0) spec = { ...spec, affixes: [...spec.affixes, { id: 'mirrored', name: 'Mirrored' }, { id: 'labyrinthine', name: 'Labyrinthine' }, { id: 'sunken', name: 'Sunken' }] };
    specs.push(spec);
  }
  // Real rifts for every signal pair, stories, and the ladder going down.
  const signals = GENRES.flatMap((g) => g.signals.slice(0, 1));
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i; j < signals.length; j += 3) {
      const urgency = ((i * 7 + j) % 10) / 10;
      specs.push(riftgen.realRift({ key: `real:${i}:${j}`, subject: 'a real thing', signals: i === j ? [signals[i]] : [signals[i], signals[j]], urgency }));
    }
  }
  specs.push(riftgen.realRift({ key: 'story:first-crack', subject: 'the north gate', signals: ['sync-error'], urgency: 0.2 }));
  let rung = wildSpec(77);
  for (let d = 0; d < 20; d += 1) { rung = riftgen.deeper(rung); specs.push(rung); }
  return specs;
}

test('every Elsewhere spawn reaches the stitch, the exit, the loot and the curio', () => {
  const specs = elsewhereSpecs();
  assert.ok(specs.length >= 500, `${specs.length} specs`);
  let mirrored = 0;
  let maze = 0;
  let fords = 0;
  let bushes = 0;
  let maelstroms = 0;
  let councils = 0;
  let strayShort = 0;
  let inDoorway = 0;
  for (const spec of specs) {
    const layout = riftgen.layout(spec);
    const scene = buildElsewhere(spec, layout, { genres, words });
    const where = `${spec.name} (${spec.affixes.map((a) => a.id).join(', ')})`;
    if (spec.affixes.some((a) => a.id === 'mirrored')) mirrored += 1;
    if (spec.affixes.some((a) => a.id === 'labyrinthine')) maze += 1;
    assert.equal(scene.w, layout.w);
    assert.equal(scene.h, layout.h);
    // Milo arrives a step out of the doorway at E (south when he can), facing away from the door.
    const step = { x: scene.spawn.x - layout.entrance.x, y: scene.spawn.y - layout.entrance.y };
    assert.ok(Math.abs(step.x) + Math.abs(step.y) <= 1, `${where}: Milo arrives beside E`);
    if (step.x || step.y) {
      assert.equal(scene.spawn.dir, { '0,1': 'down', '1,0': 'right', '-1,0': 'left', '0,-1': 'up' }[`${step.x},${step.y}`], 'facing away from the door');
      if (step.y !== 1) assert.equal(scene.walkable(layout.entrance.x, layout.entrance.y + 1), false, `${where}: south of the door first`);
    } else inDoorway += 1;
    assert.ok(scene.walkable(scene.spawn.x, scene.spawn.y), `${where}: spawn is walkable`);
    assert.ok(scene.walkable(layout.entrance.x, layout.entrance.y), `${where}: the doorway is walkable`);
    assert.equal(scene.cellAt(-1, 0), 'void');
    assert.equal(scene.walkable(-1, 0), false);
    // Walk from the spawn.
    const seen = new Set([`${scene.spawn.x},${scene.spawn.y}`]);
    const queue = [scene.spawn];
    for (let head = 0; head < queue.length; head += 1) {
      const { x, y } = queue[head];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || !scene.walkable(x + dx, y + dy)) continue;
        seen.add(k);
        queue.push({ x: x + dx, y: y + dy });
      }
    }
    const find = (kind) => scene.objects.filter((o) => o.kind === kind);
    const [exit] = find('exit');
    const [stitch] = find('stitch');
    const loot = find('loot');
    const curio = find('curio');
    assert.deepEqual([exit.x, exit.y], [layout.entrance.x, layout.entrance.y], 'the way home is at E');
    assert.deepEqual([stitch.x, stitch.y], [layout.stitch.x, layout.stitch.y], 'the seam is at S');
    assert.equal(stitch.refused, spec.kind === 'real' && !String(spec.key).startsWith('story:'), `${where}: refused only for a real rift`);
    assert.equal(loot.length, layout.loot.length);
    assert.equal(curio.length, layout.puzzle ? 1 : 0);
    const [lead] = find('tale-lead');
    assert.deepEqual([lead.x, lead.y], [layout.boss.x, layout.boss.y], 'the Tale-lead is at B');
    assert.equal(lead.scale, 2);
    for (const o of [exit, stitch, lead, ...loot, ...curio]) {
      assert.ok(seen.has(`${o.approach.x},${o.approach.y}`), `${where}: ${o.id} can be reached`);
      assert.ok(Math.abs(o.approach.x - o.x) + Math.abs(o.approach.y - o.y) <= 1, `${o.id}: approached from beside it`);
      if (o.blocks) assert.equal(scene.walkable(o.x, o.y), false, `${o.id} blocks its tile`);
      assert.ok(o.label, `${o.id} has a label`);
    }
    assert.equal(exit.blocks, false, 'the way home is walked into');
    assert.deepEqual(loot.map((o) => o.id), loot.map((_, n) => `loot:${n}`));
    assert.equal(new Set(scene.objects.map((o) => `${o.x},${o.y}`)).size, scene.objects.length, 'one object per tile');
    assert.equal(new Set(scene.objects.map((o) => o.id)).size, scene.objects.length, 'unique ids');
    // The riftgen promise still holds for the layout itself.
    const ok = reachable(layout);
    assert.ok(ok(layout.stitch) && ok(layout.boss));
    for (let y = 0; y < scene.h; y += 1) {
      for (let x = 0; x < scene.w; x += 1) {
        const c = scene.cellAt(x, y);
        assert.ok(['wall', 'floor', 'water', 'foliage', 'void'].includes(c));
        if (c === 'wall' || c === 'void') assert.equal(scene.walkable(x, y), false);
        if (c === 'water' && scene.walkable(x, y)) { assert.ok(scene.isFord(x, y)); fords += 1; }
      }
    }
    bushes += scene.objects.filter((o) => o.kind === 'foliage' && o.blocks).length;
    // Every object has the same shape: an approach tile, and a label unless it's scenery.
    for (const o of scene.objects) {
      assert.ok(Number.isInteger(o.approach?.x) && Number.isInteger(o.approach?.y), `${where}: ${o.id} has an approach tile`);
      if (o.kind === 'foliage') {
        assert.equal(o.scenery, true, `${o.id} is scenery`);
        assert.equal(o.label, null, `${o.id} has no hover label`);
        assert.deepEqual(o.approach, { x: o.x, y: o.y }, `${o.id} is approached where it stands`);
        assert.ok(['reeds', 'bush'].includes(o.sprite) && o.blocks === (o.sprite === 'bush'), `${o.id}: reeds are walked through, bushes block`);
      } else {
        assert.ok(!o.scenery, `${o.id} is not scenery`);
        assert.equal(typeof o.label, 'string', `${o.id} has a label`);
      }
    }
    // Strays keep to open ground, up to 2 of a kind and 5 in all, as in the wilds; a Maelstrom's
    // council stands by its Tale-lead.
    const council = scene.strays.filter((s) => s.council);
    const wandering = scene.strays.filter((s) => !s.council);
    assert.ok(wandering.length <= 5, `${where}: at most 5 strays (${wandering.length})`);
    const perKind = {};
    for (const s of wandering) perKind[s.name] = (perKind[s.name] || 0) + 1;
    for (const [name, n] of Object.entries(perKind)) assert.ok(n <= 2, `${where}: at most 2 of ${name}`);
    const wanted = spec.strays.reduce((n, k) => n + Math.min(2, Math.max(0, k.count | 0)), 0);
    strayShort += Math.min(5, wanted) - wandering.length;
    assert.ok(council.length <= Math.max(0, spec.genres.length - 1));
    for (const c of council) {
      assert.ok(Math.abs(c.home.x - layout.boss.x) <= 3 && Math.abs(c.home.y - layout.boss.y) <= 1, 'the council sits with the Tale-lead');
      assert.ok(spec.taleLead.council.includes(c.name));
    }
    if (spec.maelstrom) maelstroms += 1;
    if (council.length) councils += 1;
    for (const s of scene.strays) {
      assert.match(s.id, /^stray:rift:[0-9a-z]+:\d+$/);
      for (let t = 0; t < 60000; t += 700) {
        const tile = feetTile(s.positionAt(t));
        assert.ok(scene.walkable(tile.x, tile.y), `${where}: ${s.name} on open ground`);
      }
    }
  }
  assert.ok(mirrored >= 60 && maze >= 60, `mirrored ${mirrored}, labyrinthine ${maze}`);
  assert.ok(fords > 50, `water gets stepping stones where it must (${fords})`);
  assert.ok(bushes > 50, `growth has bushes (${bushes})`);
  assert.ok(maelstroms > 0 && councils >= maelstroms * 0.8, `Maelstroms seat their councils (${councils}/${maelstroms})`);
  assert.ok(strayShort <= specs.length * 0.05, `strays nearly always find room (${strayShort} short over ${specs.length} scenes)`);
  assert.ok(inDoorway <= specs.length * 0.01, `Milo steps out of the doorway, so the door shows (${inDoorway} arrivals in it)`);
});

test('the Elsewhere ground is palette keys: walls in 3/4 view, floors, water and fords', () => {
  const codes = new Set([...KEYS].filter((k) => k !== 'x').map((k) => k.charCodeAt(0)));
  const k = (ch) => ch.charCodeAt(0);
  const flooded = { ...specOf('neon', 41), affixes: [{ id: 'sunken', name: 'Sunken' }] };
  const overgrown = { ...specOf('verdant', 42), affixes: [{ id: 'overgrown', name: 'Overgrown' }] };
  const plain = specOf('gothic', 43);
  for (const spec of [flooded, overgrown, plain]) {
    const layout = riftgen.layout(spec);
    const scene = buildElsewhere(spec, layout, { genres, words });
    const ground = scene.ground;
    assert.equal(ground.length, scene.width * scene.height);
    assert.equal(scene.width, layout.w * 16);
    for (let i = 0; i < ground.length; i += 1) if (!codes.has(ground[i])) assert.fail(`pixel ${i} has key code ${ground[i]}`);
    assert.equal(scene.ground, ground, 'painted once');
    const at = (px, py) => ground[py * scene.width + px];
    let faces = 0;
    for (let y = 0; y < scene.h; y += 1) {
      for (let x = 0; x < scene.w; x += 1) {
        const cell = scene.cellAt(x, y);
        if (cell === 'wall' && ['floor', 'foliage'].includes(scene.cellAt(x, y + 1))) {
          // A front face: brick courses above an ink foot, under a lighter top.
          faces += 1;
          const px = x * 16 + 3;
          assert.equal(at(px, y * 16 + 15), k('o'), 'ink foot');
          assert.ok([k('S'), k('z'), k('s'), k('u'), k('U'), k('o')].includes(at(px, y * 16 + 11)), 'brick face');
          assert.ok([k('s'), k('S'), k('c'), k('o')].includes(at(px, y * 16 + 3)), 'top face');
        }
        if (cell === 'floor') {
          const mid = at(x * 16 + 8, y * 16 + 8);
          assert.ok([k('g'), k('j'), k('G'), k('h'), k('S'), k('s')].includes(mid), 'floor in ground keys');
        }
        if (cell === 'water' && scene.isFord(x, y)) {
          const stones = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].flatMap((ly) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((lx) => at(x * 16 + lx, y * 16 + ly))).filter((c) => c === k('s') || c === k('S'));
          assert.ok(stones.length > 10, 'a ford has stepping stones');
        }
      }
    }
    assert.ok(faces > 5, 'walls show their faces');
  }
  // Deterministic, and quick even for a vast scene deep down the ladder.
  const big = { ...withStage(wildSpec(51, { tier: 8, depth: 30 }), 'gaping'), affixes: [{ id: 'vast', name: 'Vast' }] };
  const layout = riftgen.layout(big);
  const started = performance.now();
  const one = buildElsewhere(big, layout, { genres }).ground;
  const ms = performance.now() - started;
  assert.ok(ms < 600, `a ${layout.w}×${layout.h} scene paints in ${Math.round(ms)} ms`);
  assert.deepEqual(buildElsewhere(big, layout, { genres }).ground, one);
  const scene = buildElsewhere(plain, riftgen.layout(plain), { genres });
  assert.deepEqual(paintGround({ cells: new Uint8Array(4).fill(2), fords: new Uint8Array(4), W: 2, H: 2, seed: 1 }).length, 32 * 32);
  assert.ok(scene.ground.includes(k('o')) && scene.ground.includes(k('s')) && scene.ground.includes(k('g')));
});

test('fusions and Maelstroms are a patchwork of their genres, and everything is recoloured', () => {
  const real = riftgen.realRift({ key: 'repo:m', subject: 'the MILO plan', signals: ['check-failing', 'task-stale', 'deadline-near'], urgency: 0.6 });
  const fusion = riftgen.realRift({ key: 'repo:f', subject: 'the build', signals: ['task-stale', 'working-past-bell'], urgency: 0.6 });
  const single = specOf('iron', 61);
  for (const spec of [real, fusion, single]) {
    const scene = buildElsewhere(spec, riftgen.layout(spec), { genres });
    assert.deepEqual(scene.palettes, spec.genres);
    const counts = Object.fromEntries(spec.genres.map((id) => [id, 0]));
    const groundAt = (px, py) => scene.palettes[scene.genreIndexAt(px, py)];
    let mixed = 0;
    for (let py = 0; py < scene.height; py += 2) {
      for (let px = 0; px < scene.width; px += 2) {
        const id = groundAt(px, py);
        counts[id] += 1;
        assert.equal(groundAt(px + 1, py + 1), id, 'one genre per 2x2 block');
        if (px >= 2 && groundAt(px - 2, py) !== id) mixed += 1;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    for (const [id, n] of Object.entries(counts)) {
      assert.ok(n / total > (spec.genres.length === 1 ? 0.99 : 0.12), `${spec.name}: ${id} holds ${Math.round((n / total) * 100)}%`);
    }
    if (spec.genres.length > 1) assert.ok(mixed > 50, 'the patches interleave along their seams');
    // Every pixel is recoloured by the genre standing there.
    const rgba = scene.rgba(BASE);
    const ground = scene.ground;
    const palettes = Object.fromEntries(spec.genres.map((id) => [id, buildGenrePalette(byId[id])]));
    for (let n = 0; n < 4000; n += 1) {
      const px = (n * 7919) % scene.width;
      const py = (n * 104729) % scene.height;
      const i = py * scene.width + px;
      const key = String.fromCharCode(ground[i]);
      const want = palettes[groundAt(px, py)][key] || BASE[ground[i]];
      assert.deepEqual([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]], [...want, 255], `${key} at ${px},${py}`);
    }
  }
});

test('in a patchwork, a sprite is dressed by the genre that owns its tile, never by one dithered block', () => {
  const real = riftgen.realRift({ key: 'repo:m', subject: 'the MILO plan', signals: ['check-failing', 'task-stale', 'deadline-near'], urgency: 0.6 });
  const fusion = riftgen.realRift({ key: 'repo:f', subject: 'the build', signals: ['task-stale', 'working-past-bell'], urgency: 0.6 });
  for (const spec of [real, fusion]) {
    const scene = buildElsewhere(spec, riftgen.layout(spec), { genres });
    const groundAt = (px, py) => scene.palettes[scene.genreIndexAt(px, py)];
    let seams = 0;
    for (let ty = 0; ty < scene.h; ty += 1) {
      for (let tx = 0; tx < scene.w; tx += 1) {
        // one answer for the whole tile: the genre most of its ground is in
        const owner = scene.genreAt(tx * T + 8, ty * T + 12);
        const counts = {};
        for (let py = ty * T; py < ty * T + T; py += 2) for (let px = tx * T; px < tx * T + T; px += 2) counts[groundAt(px, py)] = (counts[groundAt(px, py)] || 0) + 1;
        if (Object.keys(counts).length > 1) seams += 1;
        assert.equal(Math.max(...Object.values(counts)), counts[owner], `${spec.name}: ${tx},${ty} is dressed by its tile's owner`);
        for (const [px, py] of [[0, 0], [15, 15], [3, 11], [9, 2]]) assert.equal(scene.genreAt(tx * T + px, ty * T + py), owner, 'the same anywhere on the tile');
      }
    }
    assert.ok(seams > 20, `${spec.name}: ${seams} seam tiles checked`);
    // Walking straight across the scene, a sprite's colours change only where the tiles do, and so
    // far fewer times than the ground's blocks do under it.
    for (let row = 1; row < scene.h - 1; row += 3) {
      let dress = 0;
      let blocks = 0;
      let prev = null;
      let prevGround = null;
      for (let px = 0; px < scene.width; px += 1) {
        const py = row * T + 12;
        const g = scene.genreAt(px, py);
        if (prev !== null && g !== prev) {
          dress += 1;
          assert.equal(px % T, 0, 'a dress changes only on a tile edge');
        }
        const ground = groundAt(px, py);
        if (prevGround !== null && ground !== prevGround) blocks += 1;
        prev = g;
        prevGround = ground;
      }
      assert.ok(dress <= blocks, `row ${row}: ${dress} dress changes against ${blocks} in the ground`);
    }
  }
  // A scene of one genre dresses everything in it.
  const single = buildElsewhere(specOf('iron', 61), riftgen.layout(specOf('iron', 61)), { genres });
  assert.equal(single.genreAt(40, 40), 'iron');
});

test('a real rift\'s seam won\'t take the thread; wild and story rifts can be stitched', () => {
  const real = riftgen.realRift({ key: 'knock:claude:abc', subject: 'Letters', signals: ['needs-you-unanswered'], urgency: 0.5 });
  const story = riftgen.realRift({ key: 'story:first-crack', subject: 'the north gate', signals: ['sync-error'], urgency: 0.2 });
  const wild = wildSpec(71);
  const seam = (spec, opts = {}) => buildElsewhere(spec, riftgen.layout(spec), { genres, ...opts }).objects.find((o) => o.kind === 'stitch');
  assert.equal(seam(real).refused, true);
  assert.equal(seam(story).refused, false);
  assert.equal(seam(wild).refused, false);
  assert.equal(seam(riftgen.deeper(wild)).refused, false, 'down the ladder too');
  assert.equal(seam(real, { kind: 'story' }).refused, false, 'the caller can say which kind it is');
  assert.equal(buildElsewhere(story, riftgen.layout(story), { genres }).kind, 'story');
  // Labels are calm.
  for (const spec of [real, story, wild]) {
    for (const o of buildElsewhere(spec, riftgen.layout(spec), { genres }).objects) {
      if (o.kind === 'foliage' || o.kind === 'tale-lead') continue;
      assertCalm(o.label, `${o.kind} label`);
    }
  }
});

test('the same spec always builds the same Elsewhere', () => {
  const rng = createRng(5);
  for (let n = 0; n < 12; n += 1) {
    const spec = wildSpec(rng.int(0, 1e6));
    const a = buildElsewhere(spec, riftgen.layout(spec), { genres, words });
    const b = buildElsewhere(spec, riftgen.layout(spec), { genres, words });
    assert.deepEqual(a.objects, b.objects);
    assert.deepEqual(a.spawn, b.spawn);
    assert.deepEqual(a.strays.map((s) => [s.id, s.home, s.positionAt(4242)]), b.strays.map((s) => [s.id, s.home, s.positionAt(4242)]));
    assert.deepEqual(a.ground, b.ground);
  }
});
