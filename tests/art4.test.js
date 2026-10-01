// Module F, the art (CONTRACT-PHASE4.md §7.8, §9.9, §13 wave 1 F; COMBAT.md §14): the party's rigs and
// clips, the posed and fight-sized strays, anims.json, icons, numbers, effects, surfaces, projectiles
// and props.
//   node --test tests/art4.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTE, SPRITES, pad, MILO, recolor } from '../src/world/sprites.js';
import { RIGS, CLIPS, CLIP_TIMING, SIGNATURE_CLIPS, RIG_DATA, clipFrames, clipsOf, exploreFrames, likenessTable, signatureClip, poseOps, handPoseCounts, wearMask } from '../src/world/sprites-party.js';
import { ARCHETYPES, PARTS, SIZE, composeStray, restFeet, marginsAt, POSE_OPS } from '../src/world/straygen.js';
import { outfitGrid, leadSprite, COAT_TONES, OUTFITS } from '../src/world/riftfx.js';
import { createPainter, numberRows, textRows, NUMBER_SIZES, BASE_RGBA } from '../src/world/scene-art.js';
import { ring, sparks, beam, fillRows, swirl, effectFrame, spellEffect, impactFrame, flourishFrame, flourishLength, shimmerOutline, SURFACE_IDS, surfaceTile, PROJECTILES, projectileFrame } from '../src/world/fx.js';
import { INTENT_ICONS, CONDITION_ICONS, KIND_ICONS, THOUGHT_ICONS, MARKERS, FLASHES, NUMBER_SLOT, ICON_SETS } from '../src/world/icons.js';
import { PROPS4, PROP_FLAGS, propFrame, lastBridgeRows } from '../src/world/props4.js';
import { goldenCases, hashValue, GOLDEN_FILE } from './fixtures/make-golden.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const anims = readJson('../content/combat/anims.json');
const genres = readJson('../content/genres.json').genres;
// Other modules' content (C's callings and spells, B's rules), read as data: the ids and numbers the
// art must line up with.
const callings = readJson('../content/combat/callings.json');
const grimoire = readJson('../content/combat/spells.json');
const rules = readJson('../content/combat/rules.json');

const PINNED_KEYS = 'o c C g G h j q l L M p P w W f b B n m s S z r R Q k K u U Y e E N v V t x'.split(' ');
const paletteOnly = (rows) => rows.every((row) => [...row].every((ch) => ch === '.' || PALETTE[ch]));
const inked = (rows) => rows.some((row) => /[^.]/.test(row));
/** How many drawn pixels sit on the rows' outermost rows and columns. */
const edgeInk = (rows) => {
  const h = rows.length;
  const w = rows[0].length;
  let n = 0;
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.' && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) n += 1; }));
  return n;
};
/** The lowest row with anything drawn on it. */
const lowestInk = (rows) => {
  let y = rows.length - 1;
  while (y > 0 && !/[^.]/.test(rows[y])) y -= 1;
  return y;
};

const LOOKS = [
  { kind: 'rig', rig: 'coat', who: 'milo', likeness: null },
  { kind: 'rig', rig: 'robe', who: 'claude', likeness: null },
  { kind: 'rig', rig: 'robe', who: 'codex', likeness: null },
  { kind: 'rig', rig: 'robe', who: 'claude', likeness: 'clay' },
  { kind: 'rig', rig: 'robe', who: 'codex', likeness: 'slate' },
  { kind: 'rig', rig: 'jev', who: 'jev', likeness: null },
  { kind: 'rig', rig: 'toll', who: 'tollkeeper', likeness: null },
];
const FACINGS = ['right', 'left', 'down'];
function* allFrames() {
  for (const look of LOOKS) for (const clip of clipsOf(look)) for (const facing of FACINGS) {
    for (const frame of clipFrames(look, clip, facing)) yield { look, clip, facing, frame };
  }
}

function fakeCanvas(w, h) {
  const canvas = { width: w, height: h, pixels: null };
  canvas.getContext = () => ({
    createImageData: (iw, ih) => ({ width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) }),
    putImageData: (image) => { canvas.pixels = image.data; },
  });
  return canvas;
}

// ---------- the palette ----------

test('the 38 palette keys stay pinned, and every new grid uses only them', () => {
  assert.deepEqual(Object.keys(PALETTE).sort(), [...PINNED_KEYS].sort());
  assert.equal(Object.keys(PALETTE).length, 38);
  let n = 0;
  for (const { look, clip, facing, frame } of allFrames()) {
    assert.ok(paletteOnly(frame.rows), `${look.who}/${look.likeness} ${clip} ${facing} is palette keys only`);
    n += 1;
  }
  for (const look of LOOKS) for (const dir of ['down', 'up', 'left', 'right']) for (const f of exploreFrames(look, dir)) assert.ok(paletteOnly(f.rows), `${look.who} explore ${dir}`);
  for (const [set, icons] of Object.entries(ICON_SETS)) for (const [id, rows] of Object.entries(icons)) assert.ok(paletteOnly(rows), `${set} ${id}`);
  for (const [id, rows] of Object.entries(MARKERS)) assert.ok(paletteOnly(rows), `marker ${id}`);
  for (const [id, frames] of Object.entries(FLASHES)) for (const rows of frames) assert.ok(paletteOnly(rows), `flash ${id}`);
  for (const [id, p] of Object.entries(PROPS4)) for (const rows of p.frames) assert.ok(paletteOnly(rows), `prop ${id}`);
  for (const id of Object.keys(anims.effects)) for (let f = 0; f < anims.effects[id].frames; f += 1) assert.ok(paletteOnly(effectFrame(id, f, { anims })), `effect ${id} #${f}`);
  for (const [genre, fl] of Object.entries(anims.flourishes)) for (const rows of fl.frames) assert.ok(paletteOnly(rows), `flourish ${genre}`);
  for (const id of SURFACE_IDS) for (let f = 0; f < 3; f += 1) assert.ok(paletteOnly(surfaceTile(id, f, { edges: 5 })), `surface ${id}`);
  for (const id of Object.keys(PROJECTILES)) for (const dir of ['right', 'left', 'up', 'down']) assert.ok(paletteOnly(projectileFrame(id, 1, dir)), `projectile ${id} ${dir}`);
  for (const t of ['17', '+5', '14?', 'miss', '0123456789']) for (const size of ['small', 'big']) assert.ok(paletteOnly(numberRows(t, { size, star: true })));
  assert.ok(n > 1500, `every look, clip and facing checked (${n} frames)`);
});

// ---------- the rigs ----------

test('every frame is its rig\'s size, carries its rig\'s feet point, and keeps its ink off the frame\'s edge', () => {
  assert.deepEqual(RIGS.coat.frame, [32, 28]);
  assert.deepEqual(RIGS.coat.feet, [16, 26]);
  assert.equal(RIGS.coat.split, 18);
  assert.deepEqual([RIGS.robe.frame, RIGS.robe.feet], [[32, 28], [16, 26]]);
  assert.deepEqual([RIGS.jev.w, RIGS.jev.h, RIGS.jev.frame, RIGS.jev.feet], [12, 10, [32, 28], [16, 26]]);
  assert.deepEqual([RIGS.toll.w, RIGS.toll.h, RIGS.toll.frame, RIGS.toll.feet], [20, 26, [36, 34], [18, 32]]);
  for (const { look, clip, facing, frame } of allFrames()) {
    const rig = RIGS[look.rig];
    const where = `${look.who} ${clip} ${facing}`;
    assert.deepEqual([frame.w, frame.h], rig.frame, where);
    assert.equal(frame.rows.length, frame.h, where);
    assert.ok(frame.rows.every((r) => r.length === frame.w), `${where} is rectangular`);
    assert.deepEqual(frame.feet, rig.feet, `${where} stands on the rig's feet`);
    assert.ok(inked(frame.rows), `${where} isn't empty`);
    const [w, h] = rig.frame;
    assert.ok(!/[^.]/.test(frame.rows[0]) && !/[^.]/.test(frame.rows[h - 1]), `${where}: no ink on the top or bottom row`);
    assert.ok(frame.rows.every((r) => r[0] === '.' && r[w - 1] === '.'), `${where}: no ink on the left or right column`);
    for (const name of ['head', 'handL', 'handR', 'back']) {
      const [x, y] = frame.anchors[name];
      assert.ok(x >= 0 && y >= 0 && x < w && y < h, `${where} anchor ${name} is inside the frame`);
    }
  }
});

test('a standing frame\'s feet are on the ground: the boots\' (or hem\'s) ink sits on the feet row', () => {
  for (const look of LOOKS.filter((l) => !l.likeness)) {
    const f = clipFrames(look, 'ready', 'right')[0];
    const row = f.rows[f.feet[1]];
    assert.ok(/[^.]/.test(row), `${look.who} has ink on its feet row`);
    assert.ok(!/[^.]/.test(f.rows[f.feet[1] + 1] || ''), `${look.who} has nothing below its feet`);
    const lit = [...row].map((ch, x) => (ch !== '.' ? x : null)).filter((x) => x !== null);
    assert.ok(Math.min(...lit) <= f.feet[0] + 1 && Math.max(...lit) >= f.feet[0] - 1, `${look.who}'s feet are under the frame's middle`);
  }
});

// The only hand poses drawn off the ground (their lowest ink above the feet row): the top of a leap.
const AIRBORNE_POSES = { coat: { jump: -4 }, robe: { jump: -1 } };
const liftOf = (entry) => (Array.isArray(entry) ? entry.slice(1).reduce((dy, op) => dy + (op.op === 'lift' ? op.dy || 0 : 0), 0) : 0);
const poseOf = (entry) => (Array.isArray(entry) ? entry[0] : entry);

test('every frame stands on its rig\'s ground row, leaving it only for a leap or a lift its clip names', () => {
  let checked = 0;
  let grounded = 0;
  for (const look of LOOKS) for (const clip of clipsOf(look)) for (const facing of FACINGS) {
    const recipes = RIG_DATA[look.rig].clips[clip];
    const list = facing === 'down' ? recipes.front || recipes.side : recipes.side || recipes.front;
    clipFrames(look, clip, facing).forEach((f, i) => {
      const off = (AIRBORNE_POSES[look.rig]?.[poseOf(list[i])] || 0) + liftOf(list[i]);
      assert.equal(lowestInk(f.rows), f.feet[1] + off, `${look.who}/${look.likeness} ${clip} ${facing} #${i}: ${off ? `${-off} px up, as its recipe says` : 'on the ground row'}`);
      checked += 1;
      if (!off) grounded += 1;
    });
  }
  assert.ok(checked > 1500 && grounded > checked * 0.85, `${grounded} of ${checked} frames stand on the ground`);
  // exploration frames stand on their bottom row, as the engine draws the crew
  for (const look of LOOKS) for (const dir of ['down', 'up', 'left', 'right']) {
    for (const f of exploreFrames(look, dir)) assert.equal(lowestInk(f.rows), f.feet[1], `${look.who} explore ${dir}`);
  }
});

test('every clip has its frame count at every facing, a still frame, and a rate of 8 to 12 frames a second', () => {
  for (const clip of CLIPS) {
    const t = CLIP_TIMING[clip];
    assert.ok(t, `${clip} has timing`);
    assert.ok(['first', 'last'].includes(t.still), `${clip} has a still frame`);
    assert.ok(t.fps >= 8 && t.fps <= 12, `${clip} plays at ${t.fps} fps`);
    assert.equal(typeof t.loop, 'boolean');
  }
  for (const look of LOOKS) {
    for (const clip of CLIPS) for (const facing of FACINGS) {
      const frames = clipFrames(look, clip, facing);
      assert.equal(frames.length, CLIP_TIMING[clip].frames, `${look.who} ${clip} ${facing} has ${CLIP_TIMING[clip].frames} frames`);
      const still = CLIP_TIMING[clip].still === 'last' ? frames[frames.length - 1] : frames[0];
      assert.ok(still && inked(still.rows), `${look.who} ${clip} ${facing}'s still frame draws`);
    }
  }
  const [lo, hi] = rules.timing.fps;
  for (const t of Object.values(CLIP_TIMING)) assert.ok(t.fps >= lo && t.fps <= hi, 'within rules.json timing.fps');
});

test('melee, cast and hit last rules.json\'s beats, for the heroes\' clips and every archetype\'s poses', () => {
  const ms = (frames, fps) => Math.round((frames / fps) * 1000);
  const beats = { melee: rules.timing.melee, cast: rules.timing.cast, hit: rules.timing.hit };
  assert.deepEqual(beats, { melee: 600, cast: 800, hit: 250 }, 'COMBAT §14.1\'s beats');
  for (const [clip, beat] of Object.entries(beats)) assert.equal(ms(CLIP_TIMING[clip].frames, CLIP_TIMING[clip].fps), beat, `the ${clip} clip lasts ${beat} ms`);
  for (const clip of Object.values(SIGNATURE_CLIPS)) assert.equal(ms(CLIP_TIMING[clip].frames, CLIP_TIMING[clip].fps), beats.cast, `${clip} plays in place of cast, so it lasts a cast`);
  for (const [archetype, poses] of Object.entries(anims.poses)) {
    for (const [clip, beat] of Object.entries(beats)) {
      const pose = poses[anims.clipPoses[clip]];
      assert.equal(ms(pose.frames.length, pose.fps), beat, `a ${archetype}'s ${anims.clipPoses[clip]} lasts ${beat} ms`);
    }
  }
});

test('left is right with mirror: true, the same rows; frames are frozen and built once', () => {
  for (const look of LOOKS) for (const clip of clipsOf(look)) {
    const right = clipFrames(look, clip, 'right');
    const left = clipFrames(look, clip, 'left');
    assert.equal(clipFrames(look, clip, 'right'), right, 'memoised');
    assert.ok(Object.isFrozen(right) && Object.isFrozen(right[0]) && Object.isFrozen(right[0].rows));
    right.forEach((f, i) => {
      assert.equal(f.mirror, false);
      assert.equal(left[i].mirror, true, `${look.who} ${clip} left mirrors`);
      assert.equal(left[i].rows, f.rows, 'the same rows, so the painter\'s cache hits');
      assert.deepEqual(Object.keys(left[i].anchors), ['head', 'handL', 'handR', 'back']);
      for (const [k, [x, y]] of Object.entries(f.anchors)) assert.deepEqual(left[i].anchors[k], [f.w - 1 - x, y], `${look.who} ${clip}: the ${k} anchor mirrors with it`);
    });
  }
  // a front view where there is one, the side frames where there isn't
  const milo = LOOKS[0];
  assert.notEqual(clipFrames(milo, 'ready', 'down')[0].rows, clipFrames(milo, 'ready', 'right')[0].rows);
  assert.equal(clipFrames(milo, 'melee', 'down')[2].rows, clipFrames(milo, 'melee', 'right')[2].rows);
  assert.equal(clipFrames(milo, 'nonsense', 'right').length, 0);
  assert.equal(clipFrames({ kind: 'stray', archetype: 'walker' }, 'ready', 'right').length, 0, 'strays play anims.json poses instead');
});

test('frames carry their family, and the clips reuse frames where a slow loop holds', () => {
  assert.equal(clipFrames(LOOKS[0], 'ready', 'right')[0].family, 'milo');
  assert.equal(clipFrames(LOOKS[1], 'ready', 'right')[0].family, 'claude');
  assert.equal(clipFrames(LOOKS[2], 'ready', 'right')[0].family, 'codex');
  assert.equal(clipFrames(LOOKS[3], 'ready', 'right')[0].family, null, 'a likeness draws plain');
  assert.equal(clipFrames(LOOKS[5], 'ready', 'right')[0].family, null, 'Jev draws plain');
  assert.equal(clipFrames(LOOKS[6], 'ready', 'right')[0].family, null, 'the Tollkeeper draws plain');
  const dozing = clipFrames(LOOKS[0], 'dozing', 'right');
  assert.equal(dozing[0], dozing[7], 'a held frame is the same frame object');
  assert.equal(new Set(dozing).size, 2);
});

test('Milo has his own clips for Scarf, Raise the lantern and the Wayward step, keyed by the actions\' ability ids; others play cast', () => {
  const milo = LOOKS[0];
  // The ids come from callings.json: each is a feature Milo uses as an action (a `use` Action's
  // `ability`), never a passive, so the clip can actually play.
  const byId = new Map(callings.abilities.map((a) => [a.id, a]));
  const named = { scarf: 'Scarf', 'raise-lantern': 'Raise the lantern', 'wayward-step': 'Wayward step' };
  for (const [id, name] of Object.entries(named)) {
    const ability = byId.get(id);
    assert.ok(ability, `callings.json has ${id}`);
    assert.equal(ability.name, name);
    assert.notEqual(ability.kind, 'passive', `${id} is an action`);
    assert.ok(Array.isArray(ability.costs) && ability.costs.length > 0, `${id} costs actions`);
    assert.ok(SIGNATURE_CLIPS[id], `${name} has a signature clip`);
  }
  assert.deepEqual(Object.keys(SIGNATURE_CLIPS).sort(), Object.keys(named).sort());
  for (const [ability, clip] of Object.entries(SIGNATURE_CLIPS)) {
    assert.equal(signatureClip(milo, ability), clip);
    for (const facing of FACINGS) assert.equal(clipFrames(milo, clip, facing).length, CLIP_TIMING[clip].frames);
    for (const other of LOOKS.slice(1)) assert.equal(signatureClip(other, ability), null, `${other.who} plays cast`);
  }
  assert.equal(signatureClip(milo, 'wayward-step'), 'wayward-step', 'the Wayward step\'s own action');
  assert.equal(byId.get('wayward-path')?.kind, 'passive');
  assert.equal(signatureClip(milo, 'wayward-path'), null, 'the Wayward passive never acts, so it has no clip');
  assert.equal(signatureClip(milo, 'mote'), null);
  const hand = handPoseCounts();
  assert.ok(hand.coat >= 36 && hand.robe >= 60 && hand.jev >= 12 && hand.toll >= 13, JSON.stringify(hand));
});

// ---------- dressing ----------

/** The distinct frames a look shows facing right and down (left shares their rows). */
const distinctFrames = (look) => [...new Set(clipsOf(look).flatMap((clip) => [...clipFrames(look, clip, 'right'), ...clipFrames(look, clip, 'down')]))];
/** The figure's body as the tests see it: the largest 8-connected group of drawn pixels not held. */
function bodyOfFrame(f) {
  const open = (x, y) => f.rows[y]?.[x] !== undefined && f.rows[y][x] !== '.' && !(f.held && f.held[y][x] === '1');
  const seen = new Set();
  let best = new Set();
  f.rows.forEach((row, y) => [...row].forEach((_, x) => {
    if (seen.has(`${x},${y}`) || !open(x, y)) return;
    const group = new Set([`${x},${y}`]);
    const stack = [[x, y]];
    seen.add(`${x},${y}`);
    while (stack.length) {
      const [px, py] = stack.pop();
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const k = `${px + dx},${py + dy}`;
        if (!seen.has(k) && open(px + dx, py + dy)) { seen.add(k); group.add(k); stack.push([px + dx, py + dy]); }
      }
    }
    if (group.size > best.size) best = group;
  }));
  return (x, y) => best.has(`${x},${y}`);
}

test('Milo is dressed from his body: every coat and scarf pixel on him is worn, raised sleeves too, never the lantern, its light or his head', () => {
  const KEYS = OUTFITS.milo.keys;
  assert.equal(RIG_DATA.coat.clothes.milo, KEYS, 'the rig\'s clothes keys are riftfx\'s');
  const frames = distinctFrames(LOOKS[0]);
  assert.ok(frames.length > 80, `${frames.length} distinct frames`);
  let raised = 0;
  let lantern = 0;
  for (const f of frames) {
    assert.equal(f.split, 0, 'his mask carries his head, so the clothes may start at the top row');
    assert.ok(Array.isArray(f.wear) && f.wear.length === f.h, 'every frame of his has a wear mask');
    assert.ok(Number.isFinite(f.neck), 'and a neck row, for poseOps');
    const out = outfitGrid('milo', f.rows, { split: f.split, wear: f.wear });
    if (!out) {
      assert.ok(f.rows.every((row, y) => [...row].every((ch, x) => !KEYS.includes(ch) || f.held?.[y][x] === '1')), 'only a frame with no coat showing (tucked in his bedroll) has nothing to dress');
      continue;
    }
    const inBody = bodyOfFrame(f);
    let up = 0;
    f.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const worn = out.layers[y][x] === '1';
      const held = f.held && f.held[y][x] === '1';
      const where = `${f.family} ${ch}@${x},${y}`;
      if (held && ch !== '.') assert.ok(!worn, `${where}: a held thing, or the light it throws, is never dressed`);
      if (KEYS.includes(ch) && !held) assert.ok(worn, `${where}: coat and scarf on his body are worn wherever they are`);
      if (worn) assert.ok(inBody(x, y), `${where}: nothing is worn apart from his body`);
      if (worn && y < f.neck) { up += 1; assert.ok(KEYS.includes(ch), `${where}: above the neck only a sleeve is worn`); }
      if (ch === 'b' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => f.rows[y + dy]?.[x + dx] === 'm')) assert.ok(!worn, `${where}: his hair's shine is never the coat's trim`);
    }));
    if (up) raised += 1;
    if (f.held) lantern += 1;
  }
  assert.ok(raised >= 20, `raised sleeves are dressed (${raised} frames wear coat above the neck)`);
  assert.ok(lantern > 60, 'most of his frames hold the Hooklight');
  // Named pixels, looked at on the sheets: the cheer's raised sleeves are worn; the melee swing's
  // trail of light and the raised lantern's sparkles are not.
  const at = (clip, i, facing = 'right') => {
    const f = clipFrames(LOOKS[0], clip, facing)[i];
    const out = outfitGrid('milo', f.rows, { split: f.split, wear: f.wear });
    return (x, y) => [f.rows[y][x], out.layers[y][x]];
  };
  const cheer = at('cheer', 0, 'down');
  for (const [x, y] of [[8, 13], [8, 16], [23, 13], [23, 16]]) assert.deepEqual(cheer(x, y), ['U', '1'], `the cheer's sleeve at ${x},${y}`);
  const swing = at('melee', 2);
  for (const [x, y] of [[27, 17], [28, 18], [28, 19]]) assert.deepEqual(swing(x, y), ['u', '0'], `the swing's light at ${x},${y}`);
  const raise = at('raise-lantern', 3);
  for (const [x, y] of [[10, 1], [26, 4]]) assert.deepEqual(raise(x, y), ['u', '0'], `a sparkle at ${x},${y}`);
  assert.deepEqual(raise(23, 10), ['U', '1'], 'the arm raising the lantern is his sleeve');
  // the lantern's butter glass would be dressed without the mask: the mask is what saves it
  const ready = clipFrames(LOOKS[0], 'ready', 'right')[0];
  const masked = outfitGrid('milo', ready.rows, { split: ready.split, wear: ready.wear });
  const bare = outfitGrid('milo', ready.rows, { split: ready.split });
  let saved = 0;
  ready.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ready.wear[y][x] === '.' && 'uU'.includes(ch)) {
      assert.equal(masked.layers[y][x], '0');
      assert.equal(masked.rows[y][x], ch, 'the glass keeps its own key, not a coat tone');
      if (bare.layers[y][x] === '1') saved += 1;
    }
  }));
  assert.ok(saved >= 3, `without the mask the glass would be dressed (${saved} px)`);
  assert.ok(Object.values(COAT_TONES).some((tone) => masked.rows.join('').includes(tone)), 'the coat takes its tones');
  assert.equal(outfitGrid('milo', ready.rows, { split: ready.split, wear: ready.wear }), masked, 'cached per grid, split and mask');
});

test('the two-argument outfitGrid is unchanged: cached by the grid, the head split at 11', () => {
  const rows = SPRITES['milo.right'][0];
  const a = outfitGrid('milo.right', rows);
  assert.equal(outfitGrid('milo.right', rows), a);
  assert.equal(outfitGrid('milo.right', rows, {}), a, 'no split and no mask is the old call');
  for (let y = 0; y < MILO.headSplit; y += 1) assert.ok(!a.layers[y].includes('1'));
  assert.equal(outfitGrid('jev.idle', SPRITES['jev.idle'][0]), null);
  // the robe families dress in any pose, and a held quill or wrench stays as it is
  for (const who of ['claude', 'codex']) {
    const f = clipFrames({ kind: 'rig', rig: 'robe', who }, 'melee', 'right')[2];
    const out = outfitGrid(who, f.rows, { split: f.split, wear: f.wear });
    assert.ok(out && out.layers.join('').split('1').length > 40, `${who}'s robe is dressed`);
    f.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (f.wear[y][x] === '.' && ch !== '.') assert.equal(out.layers[y][x], '0', `${who}'s held thing stays`); }));
  }
});

test('wearMask keeps what\'s held, what\'s apart from the body, loose specks and the head undressed', () => {
  const KEYS = OUTFITS.milo.keys;
  // Specks: one touching only the body's ink is loose light; one touching the hand is the coat; one
  // out in the air is apart from the body.
  const specks = [
    '.oUUoo..',
    '.oUUo.u.',
    '.oUUto..',
    '.oooottu',
    '........',
    '.......u',
    '.....cuu',
  ];
  // (the last row's butter touches its cream, so it isn't a speck; it's apart from the body all the same)
  assert.deepEqual(wearMask(specks, null, null, KEYS), ['11111111', '111111.1', '11111111', '11111111', '11111111', '1111111.', '11111...']);
  // A patch bigger than a speck touching only ink (a robe rolled up in a tumble) is still worn.
  assert.equal(wearMask(['ooooooo', 'oUUUUUo', 'ooooooo'], null, null, KEYS), null, 'nothing kept undressed');
  assert.deepEqual(wearMask(['oooooo', 'oUUUUo', 'oooooo'], null, null, KEYS), ['111111', '1....1', '111111'], 'four pixels are a speck');
  // The head: above the neck only clothes keys are worn (a raised sleeve), never the hair's shine;
  // and what's held never is.
  const head = [
    '.mbm.',
    '.oUo.',
    '.orro',
    '.oUUB',
  ];
  const held = ['.....', '.....', '.....', '....1'];
  const mask = wearMask(head, held, 2, KEYS);
  assert.deepEqual(mask, ['1...1', '1.1.1', '11111', '1111.']);
  // outfitGrid honours it: the shine touching the sleeve would be dressed as trim without the mask
  const dressed = outfitGrid('milo', head, { split: 0, wear: mask });
  const bare = outfitGrid('milo', head, { split: 0 });
  assert.deepEqual([bare.layers[0][2], bare.rows[0][2]], ['1', COAT_TONES.Y], 'trim floods into the unmasked shine');
  assert.deepEqual([dressed.layers[0][2], dressed.rows[0][2]], ['0', 'b'], 'the mask keeps the trim flood off his hair');
  assert.deepEqual([dressed.layers[1][2], dressed.layers[3][4]], ['1', '0'], 'the raised sleeve is worn, the held thing is not');
});

test('the robes are dressed from the body too: every robe pixel is worn, anywhere on the figure, and nothing held is', () => {
  for (const who of ['claude', 'codex']) {
    const KEYS = OUTFITS[who].keys;
    assert.equal(RIG_DATA.robe.clothes[who], KEYS);
    let holding = 0;
    for (const f of distinctFrames({ kind: 'rig', rig: 'robe', who })) {
      assert.equal(f.split, null, 'the hood is robe too: nothing to split');
      const out = outfitGrid(who, f.rows, { split: f.split, wear: f.wear });
      const inBody = bodyOfFrame(f);
      if (f.held) holding += 1;
      f.rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const worn = out.layers[y][x] === '1';
        const held = f.held && f.held[y][x] === '1';
        if (held && ch !== '.') assert.ok(!worn, `${who} ${ch}@${x},${y}: a held thing stays`);
        if (KEYS.includes(ch) && !held) assert.ok(worn, `${who} ${ch}@${x},${y}: the robe is worn`);
        if (worn) assert.ok(inBody(x, y), `${who} ${ch}@${x},${y}: nothing worn apart from the body`);
      }));
    }
    assert.ok(holding > 30, `${who} holds things in ${holding} frames`);
  }
});

test('likenesses recolour the whole figure to one ramp, the Clay Likeness with a thumbprint', () => {
  for (const kind of ['clay', 'slate']) {
    const table = likenessTable(kind);
    for (const key of Object.keys(PALETTE)) assert.ok(PALETTE[table[key]], `${kind} maps ${key}`);
    assert.equal(table.o, 'o', 'ink stays ink');
    assert.equal(table.x, 'x', 'a shadow stays a shadow');
    const ramp = kind === 'clay' ? 'rRQ' : 'eEN';
    for (const key of Object.keys(PALETTE)) if (key !== 'o' && key !== 'x') assert.ok(ramp.includes(table[key]), `${kind} takes ${key} into its ramp, not ${table[key]}`);
  }
  assert.equal(likenessTable('marble'), null);
  const real = clipFrames(LOOKS[1], 'ready', 'right')[0];
  const clay = clipFrames(LOOKS[3], 'ready', 'right')[0];
  assert.ok(!/[ctk]/.test(clay.rows.join('')), 'no cream face on the Clay Likeness');
  assert.notDeepEqual(clay.rows, real.rows);
  // The thumbprint: every Clay Likeness frame is the Scribe's own frame in the clay ramp but for
  // exactly one pixel, a deep clay Q on her face (cream or blush), never on ink or in the air.
  let frames = 0;
  for (const clip of clipsOf(LOOKS[3])) for (const facing of FACINGS) {
    const own = clipFrames(LOOKS[1], clip, facing);
    clipFrames(LOOKS[3], clip, facing).forEach((f, i) => {
      const ramp = recolor(own[i].rows, likenessTable('clay'));
      const diff = [];
      f.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ramp[y][x]) diff.push([ch, own[i].rows[y][x]]); }));
      assert.equal(diff.length, 1, `${clip} ${facing} #${i} has one thumbprint`);
      assert.equal(diff[0][0], 'Q');
      assert.ok('cCk'.includes(diff[0][1]), `${clip} ${facing} #${i}: the thumbprint is on her face, not on ${diff[0][1]}`);
      frames += 1;
    });
  }
  assert.ok(frames > 400, `${frames} frames checked`);
  const slate = clipFrames(LOOKS[4], 'ready', 'right')[0];
  assert.ok(/^[.oeENx]*$/.test(slate.rows.join('')), 'the Slate Double is slate through and through');
});

test('exploration frames: the Tollkeeper is 20 × 26 at the bridge, and the Wayfarers walk four ways', () => {
  const toll = { kind: 'rig', rig: 'toll', who: 'tollkeeper' };
  for (const dir of ['down', 'up', 'left', 'right']) {
    const frames = exploreFrames(toll, dir);
    assert.equal(frames.length, 3, `${dir}: a stand and two strides`);
    for (const f of frames) assert.deepEqual([f.w, f.h, f.rows[0].length, f.rows.length], [20, 26, 20, 26]);
    assert.deepEqual(frames[0].feet, [10, 25]);
    assert.notDeepEqual(frames[1].rows, frames[0].rows);
  }
  assert.deepEqual(exploreFrames(toll, 'left')[0].rows[5], [...exploreFrames(toll, 'right')[0].rows[5]].reverse().join(''));
  for (const who of ['claude', 'codex']) for (const dir of ['down', 'up', 'left', 'right']) {
    const frames = exploreFrames({ kind: 'rig', rig: 'robe', who }, dir);
    assert.equal(frames.length, 3);
    assert.deepEqual([frames[0].w, frames[0].h], [16, 18], `${who} ${dir} is the crew's size`);
    assert.equal(frames[0].family, who);
  }
  assert.equal(exploreFrames({ kind: 'rig', rig: 'robe', who: 'claude' }, 'down'), exploreFrames({ kind: 'rig', rig: 'robe', who: 'claude' }, 'down'), 'memoised');
  const jev = exploreFrames({ kind: 'rig', rig: 'jev', who: 'jev' }, 'left');
  assert.deepEqual(jev[0].rows, SPRITES['jev.idle'][0], 'Jev follows on his own perched frames, facing his way');
  assert.deepEqual(exploreFrames(LOOKS[0], 'up')[0].rows, SPRITES['milo.up'][0]);
  // a follower without art of its own falls back to the crew's frames
  assert.equal(exploreFrames({ kind: 'rig', rig: 'robe', who: 'nobody' }, 'down')[0].family, 'claude');
});

test('poseOps moves rows, the wear mask, what\'s held, anchors and the neck together', () => {
  const f = clipFrames(LOOKS[0], 'ready', 'right')[0];
  assert.equal(f.neck, RIGS.coat.split, 'a standing frame\'s neck is the rig\'s split row');
  const lifted = poseOps(f, { op: 'lift', dy: -2 });
  assert.equal(lifted.rows[f.neck - 2], f.rows[f.neck]);
  assert.equal(lifted.neck, f.neck - 2);
  assert.equal(lifted.split, 0, 'the split stays 0: the mask moves with the pixels');
  assert.equal(lifted.anchors.head[1], f.anchors.head[1] - 2);
  assert.equal(lifted.wear[10], f.wear[12]);
  assert.equal(lifted.held[20], f.held[22]);
  const leaned = poseOps(f, { op: 'shift', dx: 1, top: 0, bottom: 18 });
  assert.equal(leaned.anchors.head[0], f.anchors.head[0] + 1);
  assert.equal(leaned.anchors.handR[0], f.anchors.handR[0] + (f.anchors.handR[1] < 18 ? 1 : 0));
  assert.ok(Object.isFrozen(leaned.rows));
  assert.equal(poseOps(f, null), f);
  // breathe and squash sink everything above their row, anchors with it, and nothing below
  const row = f.neck;
  const above = Object.entries(f.anchors).filter(([, [, y]]) => y < row).map(([k]) => k);
  const below = Object.entries(f.anchors).filter(([, [, y]]) => y >= row).map(([k]) => k);
  assert.ok(above.includes('head') && below.length >= 2, `anchors on both sides of row ${row}`);
  for (const [op, n] of [[{ op: 'breathe', row }, 1], [{ op: 'breathe' }, 1], [{ op: 'squash', row, n: 2 }, 2]]) {
    const sunk = poseOps(f, op);
    for (const k of above) assert.deepEqual(sunk.anchors[k], [f.anchors[k][0], f.anchors[k][1] + n], `${JSON.stringify(op)} sinks ${k}`);
    for (const k of below) assert.deepEqual(sunk.anchors[k], f.anchors[k], `${JSON.stringify(op)} leaves ${k}`);
    assert.equal(sunk.rows[n], f.rows[0]);
    assert.equal(sunk.rows[row + 1], f.rows[row + 1], 'the body below the row stays');
    assert.equal(sunk.rows[row], f.rows[row - n], 'the head sinks onto the neck');
  }
  assert.equal(poseOps(f, { op: 'lift', dy: -2 }), lifted, 'memoised: the same op on the same frame is the same Frame, so the painter\'s cache hits');
});

/** The screen columns a frame's ink covers as the painter draws it (a left frame's rows mirrored). */
const screenInk = (f, rowsWanted = null) => {
  const xs = [];
  f.rows.forEach((row, y) => {
    if (rowsWanted && !rowsWanted(y)) return;
    [...row].forEach((ch, x) => { if (ch !== '.') xs.push(f.mirror ? f.w - 1 - x : x); });
  });
  return [Math.min(...xs), Math.max(...xs)];
};

test('poseOps works in the figure\'s own facing: on a left-facing frame the drawn pixels and the anchors move together', () => {
  const OPS = [{ op: 'nudge', dx: -2 }, { op: 'nudge', dx: 1 }, { op: 'shift', dx: 1, top: 0, bottom: 18 }, { op: 'lift', dy: -2 },
    { op: 'breathe' }, { op: 'squash', n: 2 }, { op: 'overlay', id: 'z', at: [2, 2] }];
  let checked = 0;
  for (const look of LOOKS) {
    const right = clipFrames(look, 'ready', 'right')[0];
    const left = clipFrames(look, 'ready', 'left')[0];
    for (const op of OPS) {
      const r = poseOps(right, op);
      const l = poseOps(left, op);
      const where = `${look.who}/${look.likeness} ${JSON.stringify(op)}`;
      assert.equal(l.mirror, true, `${where} still faces left`);
      assert.equal(l.rows, r.rows, `${where}: the left frame is the right one mirrored, the same rows`);
      assert.equal(l.held, r.held);
      assert.equal(l.wear, r.wear);
      for (const [k, [x, y]] of Object.entries(r.anchors)) assert.deepEqual(l.anchors[k], [l.w - 1 - x, y], `${where}: ${k} mirrors`);
      assert.equal(poseOps(left, op), l, `${where}: memoised`);
      checked += 1;
    }
    // On screen, a nudge moves the ink and every anchor by the same amount: forward (dx > 0) is
    // toward the way the figure faces, so a left frame's nudge goes the other way on screen.
    for (const [f, sign] of [[right, 1], [left, -1]]) {
      for (const dx of [-2, 1]) {
        const g = poseOps(f, { op: 'nudge', dx });
        const [a0, a1] = screenInk(f);
        const [b0, b1] = screenInk(g);
        assert.deepEqual([b0 - a0, b1 - a1], [sign * dx, sign * dx], `${look.who} ${f.mirror ? 'left' : 'right'}: the ink moves ${sign * dx} on screen`);
        for (const k of Object.keys(f.anchors)) assert.equal(g.anchors[k][0] - f.anchors[k][0], sign * dx, `${look.who} ${f.mirror ? 'left' : 'right'}: ${k} moves with the ink`);
      }
      // a lean above the neck: the band's ink and the anchors in it move together, and nothing below moves
      const band = f.neck;
      const leaned = poseOps(f, { op: 'shift', dx: 1, top: 0, bottom: band });
      assert.deepEqual(screenInk(leaned, (y) => y < band).map((v, i) => v - screenInk(f, (y) => y < band)[i]), [sign, sign], `${look.who} lean`);
      assert.deepEqual(screenInk(leaned, (y) => y >= band), screenInk(f, (y) => y >= band));
      for (const [k, [x, y]] of Object.entries(f.anchors)) assert.equal(leaned.anchors[k][0], y < band ? x + sign : x, `${look.who} lean: ${k}`);
    }
  }
  assert.ok(checked >= 40, `${checked} ops checked facing left`);
  // the reviewer's case: Milo facing left, nudged 2 back
  const milo = clipFrames(LOOKS[0], 'ready', 'left')[0];
  const back = poseOps(milo, { op: 'nudge', dx: -2 });
  const y = milo.anchors.handR[1];
  const inkRow = (f) => screenInk(f, (ry) => ry === y);
  assert.equal(back.anchors.handR[0] - milo.anchors.handR[0], 2);
  assert.deepEqual(inkRow(back).map((v, i) => v - inkRow(milo)[i]), [2, 2]);
  // A left frame that clipFrames didn't build (a copy anim.js makes) finds its right twin by flipping
  // its anchors back, so it poses exactly as the one clipFrames gave.
  const copy = Object.freeze({ ...milo });
  for (const op of [{ op: 'nudge', dx: -2 }, { op: 'shift', dx: 1, top: 0, bottom: 18 }, { op: 'overlay', id: 'z', at: [2, 2] }]) {
    const a = poseOps(copy, op);
    const b = poseOps(milo, op);
    assert.equal(a.mirror, true);
    assert.deepEqual([...a.rows], [...b.rows], `${JSON.stringify(op)}: a copied left frame's rows`);
    assert.deepEqual(a.anchors, b.anchors, `${JSON.stringify(op)}: a copied left frame's anchors`);
    assert.equal(poseOps(copy, op), a, 'memoised for the copy too');
  }
});

test('poseOps draws a rig\'s overlay in the frame\'s own colours, held and undressed, and replays every clip recipe', () => {
  const milo = clipFrames(LOOKS[0], 'ready', 'right')[0];
  const z = RIG_DATA.coat.overlays.z;
  const drawn = poseOps(milo, { op: 'overlay', id: 'z', at: [2, 2] });
  let added = 0;
  drawn.rows.forEach((row, ry) => [...row].forEach((ch, x) => {
    const k = z[ry - 2]?.[x - 2];
    if (milo.rows[ry][x] !== '.') assert.equal(ch, milo.rows[ry][x], 'behind the body');
    else if (k && k !== '.') { assert.equal(ch, k, `the z at ${x},${ry}`); assert.equal(drawn.held[ry][x], '1', 'held'); assert.equal(drawn.wear[ry][x], '.', 'never dressed'); added += 1; } else assert.equal(ch, '.');
  }));
  assert.ok(added >= 20, `the z is drawn (${added} px)`);
  assert.equal(poseOps(milo, { op: 'overlay', id: 'nothing', at: [2, 2] }).rows.join('/'), milo.rows.join('/'), 'an unknown overlay changes nothing');
  // a Clay Likeness's z is clay, like the rest of her
  const clay = clipFrames(LOOKS[3], 'ready', 'right')[0];
  const clayZ = poseOps(clay, { op: 'overlay', id: 'z', at: [2, 2] });
  const zKeys = new Set(clayZ.rows.flatMap((row, ry) => [...row].filter((ch, x) => ch !== clay.rows[ry][x])));
  assert.deepEqual([...zKeys].sort(), [...new Set(['o', likenessTable('clay').c])].sort(), 'drawn in her ramp');
  assert.deepEqual(clay.look, { kind: 'rig', rig: 'robe', who: 'claude', likeness: 'clay' });
  // Every recipe a clip derives by ops, replayed through poseOps on its bare pose, gives the clip's own
  // frame: the same rows, anchors, what's held and neck.
  let replayed = 0;
  let dressed = 0;
  for (const look of LOOKS) {
    const data = RIG_DATA[look.rig];
    const bare = new Map();
    const derived = [];
    for (const clip of clipsOf(look)) for (const [side, facing] of [['side', 'right'], ['front', 'down']]) {
      const list = data.clips[clip]?.[side];
      if (!list) continue;
      const frames = clipFrames(look, clip, facing);
      list.forEach((entry, i) => (typeof entry === 'string' ? bare.set(entry, frames[i]) : derived.push([entry, frames[i]])));
    }
    for (const [[poseId, ...ops], built] of derived) {
      const start = bare.get(poseId);
      if (!start) continue;
      const out = ops.reduce((f, op) => poseOps(f, op), start);
      const where = `${look.who}/${look.likeness} ${poseId} ${JSON.stringify(ops)}`;
      if (look.likeness === 'clay') {
        // A Clay thumbprint is stamped after the ops, on the nearest face pixel, where poseOps carries
        // the bare frame's with the pixels: the rows differ at most at the thumbprint's two spots.
        const diffs = [];
        out.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== built.rows[y][x]) diffs.push([ch, built.rows[y][x]]); }));
        assert.ok(diffs.length <= 2 && diffs.every((d) => d.includes('Q')), `${where}: rows, off the thumbprint (${JSON.stringify(diffs)})`);
      } else assert.deepEqual([...out.rows], [...built.rows], `${where}: rows`);
      assert.deepEqual(out.anchors, built.anchors, `${where}: anchors`);
      assert.deepEqual(out.held, built.held, `${where}: what's held`);
      assert.equal(out.neck, built.neck, `${where}: neck`);
      // The clip builds its wear mask afresh from the body; poseOps moves the bare one with the
      // pixels. They may differ on a sunk head row, never on anything dressed: the person is dressed
      // the same.
      if (built.family) {
        assert.deepEqual(outfitGrid(built.family, built.rows, { split: built.split, wear: out.wear }), outfitGrid(built.family, built.rows, { split: built.split, wear: built.wear }), `${where}: dressed the same`);
        dressed += 1;
      }
      replayed += 1;
    }
  }
  assert.ok(replayed >= 500 && dressed >= 150, `${replayed} derived frames replayed, ${dressed} of them dressed`);
});

test('every rig frame has a neck where its own clips breathe, so a bare breathe or squash bends there', () => {
  // The rows the rigs' own recipes breathe each pose at.
  for (const look of LOOKS.filter((l) => !l.likeness)) {
    const data = RIG_DATA[look.rig];
    const rows = new Map();
    for (const clip of clipsOf(look)) for (const side of ['side', 'front']) for (const entry of data.clips[clip]?.[side] || []) {
      if (!Array.isArray(entry)) continue;
      const lift = entry.slice(1).findIndex((op) => op.op === 'lift');
      const at = entry.findIndex((op) => op?.op === 'breathe');
      if (at < 0 || (lift >= 0 && lift + 1 < at)) continue;
      if (!rows.has(entry[0])) rows.set(entry[0], new Set());
      rows.get(entry[0]).add(entry[at].row ?? 'neck');
    }
    let checked = 0;
    for (const clip of clipsOf(look)) for (const facing of ['right', 'down']) {
      const recipes = data.clips[clip][facing === 'down' ? 'front' : 'side'];
      if (!recipes) continue;
      clipFrames(look, clip, facing).forEach((f, i) => {
        assert.ok(Number.isFinite(f.neck) && f.neck > 0 && f.neck < f.h, `${look.who} ${clip} #${i} has a neck`);
        if (typeof recipes[i] !== 'string') return;
        const own = rows.get(recipes[i]);
        if (own && !own.has('neck')) {
          assert.ok(own.has(f.neck), `${look.who} ${recipes[i]}'s neck ${f.neck} is a row its clips breathe at (${[...own]})`);
          checked += 1;
        }
      });
    }
    assert.ok(look.rig === 'coat' || checked >= 8, `${look.who}: ${checked} bare frames checked against their breaths`);
  }
  // The reviewer's cases: the robe breathes at 17, Jev at 23, the Tollkeeper at 21, and a bare
  // breathe on the standing frame is exactly the ready clip's own breath.
  for (const [look, row] of [[LOOKS[1], 17], [LOOKS[2], 17], [LOOKS[5], 23], [LOOKS[6], 21], [LOOKS[0], 18]]) {
    const ready = clipFrames(look, 'ready', 'right');
    assert.equal(ready[0].neck, row, `${look.who} breathes at ${row}`);
    const breath = RIG_DATA[look.rig].clips.ready.side.findIndex((e) => Array.isArray(e) && e[1].op === 'breathe');
    if (breath >= 0) assert.deepEqual([...poseOps(ready[0], { op: 'breathe' }).rows], [...ready[breath].rows], `${look.who}: a bare breathe is the clip's breath`);
    const squashed = poseOps(ready[0], { op: 'squash', n: 2 });
    assert.deepEqual([...squashed.rows.slice(row + 1)], [...ready[0].rows.slice(row + 1)], `${look.who}: a squash leaves the body below the neck`);
    assert.equal(squashed.rows[row], ready[0].rows[row - 2]);
  }
  // the robe's head: its face keeps its rows above the neck, the Scribe's cheek row sinking whole
  const scribe = clipFrames(LOOKS[1], 'ready', 'right')[0];
  assert.equal(poseOps(scribe, { op: 'breathe' }).rows[15], scribe.rows[14], 'the face sinks a row, whole');
  // a lower head breathes lower: the dozing robe and Tollkeeper
  assert.equal(clipFrames(LOOKS[1], 'dozing', 'right')[0].neck, 22);
  assert.equal(clipFrames(LOOKS[1], 'sleep', 'down')[0].neck, 22, 'asleep sitting up, the robe\'s whole head sinks a row, as its dozing does');
  assert.equal(clipFrames(LOOKS[1], 'sit', 'down')[0].neck, 20);
  assert.equal(clipFrames(LOOKS[6], 'dozing', 'right')[0].neck, 26);
  // and a lift carries the neck
  assert.equal(poseOps(scribe, { op: 'lift', dy: -3 }).neck, 14);
});

test('a clip\'s overlay (a doze\'s blink of light, a z) is drawn behind the body and never covers it', () => {
  let compared = 0;
  let tucked = 0;
  for (const [rigId, data] of Object.entries(RIG_DATA)) {
    for (const who of Object.keys(data.looks || { [data.defaultWho]: 1 })) {
      const look = { kind: 'rig', rig: rigId, who };
      // every plain recipe's frame, by pose id, from the clips that show it
      const plain = new Map();
      const withOverlay = [];
      for (const clip of clipsOf(look)) {
        const recipes = data.clips[clip] || {};
        for (const [side, facing] of [['side', 'right'], ['front', 'down']]) {
          const list = recipes[side];
          if (!list) continue;
          const frames = clipFrames(look, clip, facing);
          list.forEach((entry, i) => {
            if (typeof entry === 'string') plain.set(entry, frames[i]);
            else if (entry.length === 2 && entry[1].op === 'overlay') withOverlay.push([entry[0], entry[1], frames[i]]);
          });
        }
      }
      for (const [poseId, op, frame] of withOverlay) {
        const bare = plain.get(poseId);
        if (!bare) continue;
        const art = data.overlays[op.id];
        const [ox, oy] = op.at;
        frame.rows.forEach((row, y) => [...row].forEach((ch, x) => {
          const k = art[y - oy]?.[x - ox];
          const over = k && k !== '.';
          if (bare.rows[y][x] !== '.') {
            assert.equal(ch, bare.rows[y][x], `${who} ${poseId} + ${op.id}: the body at ${x},${y} is kept`);
            if (over) tucked += 1;
          } else if (over) {
            assert.notEqual(ch, '.', `${who} ${poseId} + ${op.id} draws at ${x},${y}`);
          } else {
            assert.equal(ch, '.', `${who} ${poseId} + ${op.id}: only the overlay is added`);
          }
        }));
        assert.ok(frame.held, 'an overlay is never dressed');
        compared += 1;
      }
    }
  }
  assert.ok(compared >= 4, `${compared} overlaid frames compared with their bare pose`);
  assert.ok(tucked > 0, `some overlay pixels (${tucked}) fall on the body and stay behind it`);
});

// ---------- strays ----------

test('composeStray\'s default output is byte-identical to Phase 3\'s golden strays', () => {
  const golden = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')).groups.strays;
  const cases = goldenCases().strays;
  assert.ok(cases.length > 900);
  let changed = 0;
  for (const c of cases) if (hashValue(c.value()) !== golden[c.key]) changed += 1;
  assert.equal(changed, 0, `${changed} of ${cases.length} strays changed`);
  const a = composeStray({ archetype: 'walker', bodyKey: 'r', parts: [] });
  const b = composeStray({ archetype: 'walker', bodyKey: 'r', parts: [] });
  assert.notEqual(a, b, 'the default is built fresh each call, not memoised');
  assert.ok(!Object.isFrozen(a));
  assert.equal(a.rows.length, SIZE);
});

test('pad(x, 4) equals the size-28 rest pose, for every archetype with every part and every lead', () => {
  assert.deepEqual(marginsAt(20), [2, 4]);
  assert.deepEqual(marginsAt(28), [6, 8]);
  const partSets = [[], ...Object.keys(PARTS).map((id) => [{ id, layer: 0 }]), ...Object.keys(PARTS).map((id) => [{ id, layer: 1 }])];
  for (const archetype of Object.keys(ARCHETYPES)) for (const parts of partSets) for (const bodyKey of ['r', 'e']) {
    const small = composeStray({ archetype, bodyKey, parts });
    const big = composeStray({ archetype, bodyKey, parts, size: 28 });
    assert.deepEqual([...big.rows], pad(small.rows, { top: 4, left: 4, right: 4, bottom: 4 }), `${archetype} ${parts[0]?.id || 'bare'}`);
    assert.deepEqual([...big.layers], pad(small.layers.map((r) => r.replace(/0/g, '.')), { top: 4, left: 4, right: 4, bottom: 4 }).map((r) => r.replace(/\./g, '0')));
  }
  const lead = leadSprite({ genres: ['neon'], taleLead: { genre: 'neon' }, strays: [] });
  assert.ok(Array.isArray(lead.parts) && lead.parts.length === 4, 'leadSprite returns its parts');
  assert.deepEqual(composeStray({ archetype: lead.archetype, bodyKey: lead.bodyKey, parts: lead.parts }).rows, lead.sprite.rows);
});

test('restFeet is taken once from the rest frame, so a jump leaves the ground', () => {
  assert.deepEqual(restFeet({ archetype: 'walker', size: 28 }), [14, 23]);
  assert.deepEqual(restFeet({ archetype: 'floater' }), [10, 18]);
  const pose = anims.poses.walker.jump;
  const up = composeStray({ archetype: 'walker', pose, poseName: 'jump', frame: 1, size: 28 });
  let bottom = up.rows.length - 1;
  while (!/[^.]/.test(up.rows[bottom])) bottom -= 1;
  assert.ok(bottom < restFeet({ archetype: 'walker', size: 28 })[1], 'the jump frame is off the ground');
});

test('a posed stray is built once per pose and frame, frozen, and the painter\'s count stays flat', () => {
  let made = 0;
  const painter = createPainter((w, h) => { made += 1; return fakeCanvas(w, h); });
  const look = { archetype: 'crawler', bodyKey: 's', parts: [{ id: 'gear', layer: 0 }, { id: 'goggles', layer: 1 }] };
  const pass = () => {
    for (const [poseName, pose] of Object.entries(anims.poses.crawler)) {
      pose.frames.forEach((_, frame) => {
        const s = composeStray({ ...look, pose, poseName, frame, size: 28 });
        painter.grid(s.rows, null, 'iron|neon', { layers: s.layers, table2: {} });
      });
    }
  };
  pass();
  const first = painter.made;
  assert.ok(first > 30);
  for (let i = 0; i < 5; i += 1) pass();
  assert.equal(painter.made, first, 'no new canvases on later passes');
  assert.equal(made, first);
  const s = composeStray({ ...look, pose: anims.poses.crawler.attack, poseName: 'attack', frame: 2, size: 28 });
  assert.equal(composeStray({ ...look, pose: anims.poses.crawler.attack, poseName: 'attack', frame: 2, size: 28 }), s);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.rows));
  // The memo keys the size (§7.8): the same pose and frame at 24 is its own, 24 × 24 stray.
  const at24 = composeStray({ ...look, pose: anims.poses.crawler.attack, poseName: 'attack', frame: 2, size: 24 });
  assert.notEqual(at24, s);
  assert.deepEqual([at24.rows.length, at24.rows[0].length, s.rows.length], [24, 24, 28]);
  assert.deepEqual([...s.rows], pad([...at24.rows], { top: 2, left: 2, right: 2, bottom: 2 }), 'the same stray, two px more margin each side');
  assert.equal(composeStray({ ...look, pose: anims.poses.crawler.attack, poseName: 'attack', frame: 2, size: 24 }), at24);
  // A loop driven by a running counter: the index wraps round the pose before it keys the memo, so
  // frame 8 of an 8-frame idle is frame 0's very object, and 200 ticks make no new canvas.
  const idle = anims.poses.crawler.idle;
  const n = idle.frames.length;
  const at = (frame) => composeStray({ ...look, pose: idle, poseName: 'idle', frame, size: 28 });
  assert.equal(at(n), at(0));
  assert.equal(at(3 * n + 2), at(2));
  assert.equal(at(-1), at(n - 1), 'a negative index wraps too');
  const before = painter.made;
  const seen = new Set();
  for (let tick = 0; tick < 200; tick += 1) {
    const frame = at(tick);
    seen.add(frame);
    painter.grid(frame.rows, null, 'iron|neon', { layers: frame.layers, table2: {} });
  }
  assert.equal(seen.size, n, `200 ticks give the pose's ${n} frames and no more`);
  assert.equal(painter.made, before, 'painter.made stays flat over 200 ticks');
});

test('pose ops move the body and its parts together, and every pose keeps the stray on the frame', () => {
  const look = { archetype: 'walker', bodyKey: 'b', parts: [{ id: 'lasso', layer: 0 }, { id: 'cowboyHat', layer: 0 }] };
  const rest = composeStray({ ...look, size: 28 });
  const lunge = composeStray({ ...look, pose: { frames: [{ ops: [{ op: 'shift', top: 0, bottom: 16, dx: 3 }] }] }, poseName: 'x-lunge', size: 28 });
  assert.deepEqual([...lunge.rows], rest.rows.map((r) => `...${r.slice(0, -3)}`), 'a whole-body shift carries the parts');
  const raised = composeStray({ ...look, pose: { frames: [{ anchors: { right: [0, -2] }, ops: [] }] }, poseName: 'x-raise', size: 28 });
  assert.notDeepEqual(raised.rows, rest.rows, 'an anchor offset moves the right-hand part');
  // A flash turns every key but ink to cream (or its own key): the ink and the clear stay exactly.
  for (const [ops, to] of [[[{ op: 'flash' }], 'c'], [[{ op: 'flash', key: 'u' }], 'u']]) {
    const flashed = composeStray({ ...look, pose: { frames: [{ ops }] }, poseName: `x-flash-${to}`, size: 28 });
    let lit = 0;
    rest.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const want = ch === '.' ? '.' : ch === 'o' ? 'o' : to;
      assert.equal(flashed.rows[y][x], want, `flash ${to} at ${x},${y} (was ${ch})`);
      if (want === to) lit += 1;
    }));
    assert.ok(lit > 40 && rest.rows.join('').includes('o'), `the flash lights ${lit} px and keeps the ink`);
  }
  const gone = composeStray({ ...look, pose: { frames: [{ ops: [{ op: 'dither', level: 16 }] }] }, poseName: 'x-gone', size: 28 });
  assert.ok(!inked(gone.rows), 'a full dither leaves nothing');
  // An eye swapped to the body's own colour (or its shade) turns to ink, so it never vanishes; any
  // other swap shows in its own key. Compared with the same stray with no eye swap.
  const [mx, my] = marginsAt(28);
  const eyeAt = [];
  ARCHETYPES.construct.grid.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') eyeAt.push([x + mx, y + my]); }));
  assert.equal(eyeAt.length, 2, 'the construct has two eyes');
  const isEye = (x, y) => eyeAt.some(([ex, ey]) => ex === x && ey === y);
  const withEyes = (eyes) => composeStray({ archetype: 'construct', bodyKey: 'c', pose: { frames: [{ ops: [], eyes }] }, poseName: `x-eyes-${eyes}`, size: 28 });
  const plain = withEyes(null);
  for (const [x, y] of eyeAt) assert.equal(plain.rows[y][x], 'u', 'the construct\'s own butter eyes');
  for (const eyes of ['c', 'C', 'l']) {
    const swapped = withEyes(eyes);
    swapped.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (isEye(x, y)) assert.equal(ch, eyes === 'l' ? 'l' : 'o', `eyes ${eyes} at ${x},${y}`);
      else assert.equal(ch, plain.rows[y][x], 'nothing but the eyes changes');
    }));
  }
  // every shipped pose, every archetype: ink stays inside the 28 × 28 frame's edge
  for (const [archetype, poses] of Object.entries(anims.poses)) for (const [poseName, pose] of Object.entries(poses)) pose.frames.forEach((_, frame) => {
    for (const parts of [[], Object.keys(PARTS).filter((id) => PARTS[id].anchor === 'right' || PARTS[id].anchor === 'headTop').slice(0, 6).map((id) => ({ id, layer: 0 }))]) {
      const s = composeStray({ archetype, bodyKey: 'r', parts, pose, poseName, frame, size: 28 });
      assert.ok(!/[^.]/.test(s.rows[0]) && !/[^.]/.test(s.rows[27]) && s.rows.every((r) => r[0] === '.' && r[27] === '.'), `${archetype} ${poseName} #${frame} keeps off the edge`);
    }
  });
});

test('a squash, a stretch and a lift carry the stray\'s parts with its body, and the eye key is its own', () => {
  // A hat on the head (layer 1, so its pixels can be told from the body's): the head's anchor is above
  // row 8, so a squash at row 8 sinks it 1 and a stretch raises it 1; a lift moves everything.
  const look = { archetype: 'walker', bodyKey: 'b', parts: [{ id: 'cowboyHat', layer: 1 }] };
  assert.ok(PARTS.cowboyHat.anchor === 'headTop' && !PARTS.cowboyHat.behind);
  assert.ok(ARCHETYPES.walker.anchors.headTop[1] < 8, 'the head is above the squash row');
  const hat = (s) => {
    const at = [];
    s.layers.forEach((row, y) => [...row].forEach((l, x) => { if (l === '1') at.push(`${x},${y}`); }));
    return at;
  };
  const moved = (list, dy) => list.map((p) => { const [x, y] = p.split(',').map(Number); return `${x},${y + dy}`; });
  const rest = composeStray({ ...look, size: 28 });
  assert.ok(hat(rest).length >= 6, 'the hat is drawn');
  const posed = (name, ops) => composeStray({ ...look, pose: { frames: [{ ops }] }, poseName: name, size: 28 });
  assert.deepEqual(hat(posed('x-squash', [{ op: 'squash', row: 8 }])), moved(hat(rest), 1), 'a squash sinks the hat with the head');
  assert.deepEqual(hat(posed('x-stretch', [{ op: 'stretch', row: 8 }])), moved(hat(rest), -1), 'a stretch raises the hat with the head');
  const lifted = posed('x-lift', [{ op: 'lift', dy: -3 }]);
  assert.deepEqual([...lifted.rows], [...rest.rows.slice(3), ...Array(3).fill('.'.repeat(28))], 'a lift moves the whole stray, parts and all');
  assert.deepEqual([...lifted.layers], [...rest.layers.slice(3), ...Array(3).fill('0'.repeat(28))]);
  // below the squash row the body and a right-hand part stay put
  const [ax, ay] = ARCHETYPES.walker.anchors.right;
  assert.ok(ay >= 8);
  const withLasso = { ...look, parts: [{ id: 'lasso', layer: 1 }] };
  const lassoRest = composeStray({ ...withLasso, size: 28 });
  const lassoSquash = composeStray({ ...withLasso, pose: { frames: [{ ops: [{ op: 'squash', row: 8 }] }] }, poseName: 'x-squash', size: 28 });
  assert.deepEqual(hat(lassoSquash), hat(lassoRest), `a part anchored at ${ax},${ay}, below the row, stays`);
  // swapLegs lifts one half of the frame's legs a row: the other half stays exactly as it was.
  const bare = { archetype: 'walker', bodyKey: 'r', parts: [] };
  const restBare = composeStray({ ...bare, size: 28 });
  for (const lift of ['left', 'right']) {
    const stride = composeStray({ ...bare, pose: { frames: [{ ops: [{ op: 'swapLegs', lift, from: 12 }] }] }, poseName: `x-legs-${lift}`, size: 28 });
    const from = 12 + marginsAt(28)[1];
    let raisedPx = 0;
    for (let x = 0; x < 28; x += 1) {
      const lifted = lift === 'right' ? x >= 14 : x < 14;
      for (let y = 0; y < 28; y += 1) {
        if (!lifted) assert.equal(stride.rows[y][x], restBare.rows[y][x], `${lift} stride: ${x},${y} stays`);
        else if (y >= from && y < 27) { assert.equal(stride.rows[y][x], restBare.rows[y + 1][x], `${lift} stride: ${x},${y} rises a row`); if (restBare.rows[y + 1][x] !== '.') raisedPx += 1; } else if (y === 27) assert.equal(stride.rows[y][x], '.');
      }
    }
    assert.ok(raisedPx >= 3, `the ${lift} leg rises (${raisedPx} px)`);
  }
  // A squash or a stretch with column bounds (the flier's wings) moves only its columns [left, right).
  const flier = { archetype: 'flier', bodyKey: 'r', parts: [] };
  const restFlier = composeStray({ ...flier, size: 28 });
  const [fx, fy] = marginsAt(28);
  for (const op of [{ op: 'squash', row: 9, left: 0, right: 5 }, { op: 'stretch', row: 8, left: 11, right: 16 }]) {
    const wing = composeStray({ ...flier, pose: { frames: [{ ops: [op] }] }, poseName: `x-wing-${op.op}`, size: 28 });
    const [x0, x1, split] = [op.left + fx, op.right + fx, op.row + fy];
    let moved = 0;
    for (let y = 0; y < 28; y += 1) for (let x = 0; x < 28; x += 1) {
      const inside = x >= x0 && x < x1;
      let want = restFlier.rows[y][x];
      if (inside && op.op === 'squash' && y <= split) want = y > 0 ? restFlier.rows[y - 1][x] : '.';
      if (inside && op.op === 'stretch' && y < split) want = restFlier.rows[y + 1][x];
      assert.equal(wing.rows[y][x], want, `${op.op} [${op.left}, ${op.right}) at ${x},${y}`);
      if (want !== restFlier.rows[y][x]) moved += 1;
    }
    assert.ok(moved >= 3, `the wing moves (${moved} px)`);
  }
  // The eye key: a posed stray draws its own eyeKey, and the memo keeps each eye apart.
  const [mx, my] = marginsAt(28);
  const eyes = [];
  ARCHETYPES.construct.grid.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') eyes.push([x + mx, y + my]); }));
  const pose = { frames: [{ ops: [], eyes: null }] };
  for (const eyeKey of ['l', 'W', 'l', null]) {
    const s = composeStray({ archetype: 'construct', bodyKey: 'r', eyeKey, pose, poseName: 'x-eyes', frame: 0, size: 28 });
    for (const [x, y] of eyes) assert.equal(s.rows[y][x], eyeKey || ARCHETYPES.construct.eye || 'u', `eyeKey ${eyeKey} at ${x},${y}`);
  }
});

// ---------- anims.json ----------

test('anims.json: 16 pose specs for each of the six archetypes, closed ops, and every clip mapped to a pose', () => {
  assert.equal(anims.version, 1);
  assert.deepEqual(Object.keys(anims.poses).sort(), Object.keys(ARCHETYPES).sort());
  let total = 0;
  const names = Object.keys(anims.poses.walker);
  assert.equal(names.length, 16);
  for (const [archetype, poses] of Object.entries(anims.poses)) {
    assert.deepEqual(Object.keys(poses), names, `${archetype} has the same 16 poses`);
    for (const [name, pose] of Object.entries(poses)) {
      total += 1;
      assert.ok(pose.fps >= 8 && pose.fps <= 12, `${archetype}.${name} fps`);
      assert.equal(typeof pose.loop, 'boolean');
      assert.ok(['first', 'last'].includes(pose.still), `${archetype}.${name} has a still frame`);
      assert.ok(pose.frames.length >= 2, `${archetype}.${name} moves`);
      for (const frame of pose.frames) {
        for (const op of frame.ops) assert.ok(POSE_OPS.includes(op.op), `${op.op} is one of the closed ops`);
        for (const [anchor, off] of Object.entries(frame.anchors || {})) assert.ok(ARCHETYPES[archetype].anchors[anchor] && off.length === 2);
        assert.ok(frame.eyes === null || PALETTE[frame.eyes]);
      }
    }
  }
  assert.equal(total, 96);
  assert.deepEqual(POSE_OPS, ['swapLegs', 'squash', 'stretch', 'shift', 'lift', 'flash', 'dither']);
  for (const clip of [...CLIPS, ...Object.values(SIGNATURE_CLIPS), 'sorted']) assert.ok(names.includes(anims.clipPoses[clip]), `clipPoses maps ${clip}`);
  for (const pose of ['idle', 'move', 'attack', 'hit', 'settle']) assert.ok(names.includes(pose), `COMBAT §14.3's ${pose}`);
});

test('a regular who goes Offline stays on the board dozing; only a sorted stray settles away', () => {
  // A regular fights in a stray's look, so its Offline plays a stray pose: it must end drawn (nothing
  // is lost, and dozing and Reboot follow). A stray that's sorted (the `sorted` Event) plays settle,
  // which pops or fades it away.
  // §18.2 item 12: offline is 'tumble', and the extra key `sorted` is 'settle'.
  assert.equal(anims.clipPoses.sorted, 'settle');
  assert.equal(anims.clipPoses.offline, 'tumble');
  const look = { bodyKey: 'r', parts: [{ id: 'goggles', layer: 0 }] };
  for (const [archetype, poses] of Object.entries(anims.poses)) {
    for (const clip of ['offline', 'dozing', 'reboot']) {
      const name = anims.clipPoses[clip];
      const pose = poses[name];
      pose.frames.forEach((spec, frame) => {
        assert.ok(!spec.ops.some((op) => op.op === 'dither'), `${archetype}'s ${clip} (${name}) never fades`);
        assert.ok(inked(composeStray({ archetype, ...look, pose, poseName: name, frame, size: 28 }).rows), `${archetype}'s ${clip} #${frame} is drawn`);
      });
    }
    const offline = poses[anims.clipPoses.offline];
    assert.equal(offline.still, 'last');
    const down = composeStray({ archetype, ...look, pose: offline, poseName: anims.clipPoses.offline, frame: offline.frames.length - 1, size: 28 });
    const rest = composeStray({ archetype, ...look, size: 28 });
    assert.ok(down.rows.join('').replace(/\./g, '').length > rest.rows.join('').replace(/\./g, '').length * 0.6, `${archetype} lies there, still mostly drawn`);
    const settle = poses[anims.clipPoses.sorted];
    assert.equal(settle.still, 'last');
    assert.ok(!inked(composeStray({ archetype, ...look, pose: settle, poseName: 'settle', frame: settle.frames.length - 1, size: 28 }).rows), `a sorted ${archetype} settles away`);
  }
});

test('anims.json: eight flourishes of two hand frames each, and every effect and spell resolves', () => {
  assert.deepEqual(Object.keys(anims.flourishes).sort(), ['frontier', 'gothic', 'iron', 'kaiju', 'neon', 'nocturne', 'noir', 'void']);
  for (const [genre, fl] of Object.entries(anims.flourishes)) {
    assert.ok(genres.some((g) => g.id === genre && g.kind === 'shadow'), `${genre} is a shadow genre`);
    assert.equal(fl.frames.length, 2);
    for (const rows of fl.frames) {
      assert.ok(rows.length === 16 && rows.every((r) => r.length === 16) && inked(rows));
      assert.equal(edgeInk(rows), 0, `${genre}'s hand frame keeps its ink off the edge`);
    }
    assert.ok(anims.effects[fl.effect], `${genre}'s ${fl.effect}`);
    assert.equal(flourishLength(genre, { anims }), 2 + anims.effects[fl.effect].frames);
    assert.equal(flourishFrame(genre, 0, { anims }), fl.frames[0]);
    assert.ok(flourishFrame(genre, 2, { anims }));
  }
  const shipped = ['mote', 'flare', 'loose-thread', 'full-stop', 'hum-off-key', 'ink-blot', 'little-light', 'steady-hand', 'salve', 'kind-word', 'take-heart', 'inkdarts', 'sudden-shelter', 'lullaby', 'tangleweed', 'hold-still', 'step-through-the-seam', 'quiet', 'fogcloak', 'clear-morning'];
  for (const id of shipped) assert.ok(spellEffect(id, { anims }), `${id} has an effect`);
  for (const [spell, effect] of Object.entries(anims.spells)) assert.ok(anims.effects[effect], `${spell} → ${effect}`);
  for (const kind of ['static', 'chill', 'dread', 'grind', 'warp', 'doubt', 'dust', 'quake', 'light', 'ink', 'spark', 'plain']) {
    for (let f = 0; f < anims.effects[`impact.${kind}`].frames; f += 1) assert.ok(inked(impactFrame(kind, f, { anims })), `${kind} impact #${f}`);
  }
  assert.ok(anims.effects.noticed, 'the "noticed you" swirl');
  assert.equal(effectFrame('nope', 0, { anims }), null);
  assert.equal(effectFrame('mote', 0, {}), null);
});

// ---------- effects ----------

test('effect frames are the effect\'s size, cached, keep their ink off the square\'s edge, and grow or shrink as their parameters run', () => {
  let frames = 0;
  for (const [id, spec] of Object.entries(anims.effects)) {
    for (let f = 0; f < spec.frames; f += 1) {
      const rows = effectFrame(id, f, { anims });
      assert.ok(rows.length === spec.size && rows.every((r) => r.length === spec.size), `${id} #${f} is ${spec.size} square`);
      assert.equal(effectFrame(id, f, { anims }), rows, 'cached');
      assert.equal(edgeInk(rows), 0, `${id} #${f} fits its ${spec.size} × ${spec.size} square, nothing cut off at the edge`);
      frames += 1;
    }
  }
  assert.ok(frames >= 250, `${frames} effect frames checked`);
  for (const genre of Object.keys(anims.flourishes)) {
    for (let f = 0; f < flourishLength(genre, { anims }); f += 1) assert.equal(edgeInk(flourishFrame(genre, f, { anims })), 0, `${genre} flourish #${f}`);
  }
  const count = (rows) => rows.join('').replace(/\./g, '').length;
  assert.ok(count(effectFrame('little-light', 4, { anims })) > count(effectFrame('little-light', 0, { anims })), 'a growing ring grows');
  assert.ok(count(ring({ r: 5, key: 'u' })) > count(ring({ r: 5, key: 'u', dither: true })), 'a dithered ring is lighter');
  assert.ok(inked(sparks({ n: 5, key: 'u', spread: 4, seed: 2 })));
  assert.deepEqual(sparks({ n: 5, key: 'u', spread: 4, seed: 2 }, 1), sparks({ n: 5, key: 'u', spread: 4, seed: 2 }, 1), 'seeded, so the same every time');
  assert.equal(beam({ length: 10, dir: 'right', key: 'e' })[0].length, 10);
  assert.equal(beam({ length: 10, dir: 'up', key: 'e' }).length, 10);
  assert.deepEqual(fillRows({ w: 3, h: 2, key: 'l' }), ['lll', 'lll']);
  assert.ok(count(fillRows({ w: 8, h: 8, key: 'l', dither: 8 })) === 32, 'half the pixels at dither 8');
  assert.ok(inked(swirl({ n: 6, r: 5 }, 2)));
  // The "noticed you" swirl turns: every frame is a new turn of the same dots.
  for (let f = 0; f < 3; f += 1) {
    assert.notDeepEqual(swirl({ n: 6, r: 5 }, f), swirl({ n: 6, r: 5 }, f + 1), `the swirl turns between frames ${f} and ${f + 1}`);
  }
  const noticed = anims.effects.noticed;
  for (let f = 0; f + 1 < noticed.frames; f += 1) assert.notDeepEqual(effectFrame('noticed', f, { anims }), effectFrame('noticed', f + 1, { anims }), `noticed #${f} → #${f + 1}`);
  // A diagonal beam runs from its origin toward its corner: its top row's ink is on the side it
  // heads for when it rises (up-right: right), the far side when it falls.
  for (const [dir, [dx, dy]] of Object.entries({ upright: [1, -1], upleft: [-1, -1], downright: [1, 1], downleft: [-1, 1] })) {
    const rows = beam({ length: 10, dir, key: 'e' });
    const lit = (y) => [...rows[y]].map((ch, x) => (ch === 'c' ? x : null)).filter((x) => x !== null);
    const top = rows.findIndex((r) => r.includes('c'));
    const bottom = rows.length - 1 - [...rows].reverse().findIndex((r) => r.includes('c'));
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(bottom - top >= 8, `${dir} spans the square`);
    assert.equal(Math.sign(mean(lit(top)) - mean(lit(bottom))), -dx * dy, `${dir}'s core runs ${dy < 0 ? 'up' : 'down'} to the ${dx > 0 ? 'right' : 'left'}`);
    // i = 0, the first pixel of the core, is at the origin: the corner opposite the way it heads
    const origin = dx > 0 ? (dy > 0 ? [1, 1] : [1, 10]) : (dy > 0 ? [10, 1] : [10, 10]);
    assert.equal(rows[origin[1]][origin[0]], 'c', `${dir} starts at ${origin}`);
  }
});

test('every spell draws at 32 × 32, or 48 × 48 when its area is wider, and fills its square', () => {
  // COMBAT §14.4: the first 29 spells "at 32×32 or 48×48". An area's width on the board, at 16 px a
  // tile: a burst of radius n is 2n + 1 tiles, a square or a line n tiles; one target is one tile.
  const TILE = 16;
  const span = (area) => (!area ? TILE : area.shape === 'burst' ? (2 * area.size + 1) * TILE : area.size * TILE);
  const widest = (id, spec) => {
    let most = 0;
    for (let f = 0; f < spec.frames; f += 1) {
      const rows = effectFrame(id, f, { anims });
      const xs = [];
      const ys = [];
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { xs.push(x); ys.push(y); } }));
      if (xs.length) most = Math.max(most, Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1);
    }
    return most;
  };
  assert.equal(grimoire.spells.length, 29);
  assert.deepEqual(Object.keys(anims.spells).sort(), grimoire.spells.map((s) => s.id).sort(), 'anims.json maps the 29 spells');
  let big = 0;
  for (const spell of grimoire.spells) {
    const id = spellEffect(spell.id, { anims });
    assert.ok(id, `${spell.id} has an effect`);
    const spec = anims.effects[id];
    const px = span(spell.target?.area);
    assert.ok([32, 48].includes(spec.size), `${spell.id} draws at 32 or 48, not ${spec.size}`);
    assert.ok(spec.size >= Math.min(48, px), `${spell.id}'s ${px} px area gets a ${spec.size} px square`);
    const reach = widest(id, spec);
    assert.ok(reach >= spec.size / 2, `${spell.id} fills its square (${reach} of ${spec.size} px)`);
    if (px > TILE) assert.ok(reach >= 0.7 * Math.min(spec.size, px), `${spell.id}'s effect spreads over its area (${reach} px of ${Math.min(spec.size, px)})`);
    if (spec.size === 48) big += 1;
  }
  assert.ok(big >= 8, `the wide areas draw at 48 (${big} spells)`);
});

test('heat shimmer is a one-pixel outline, honey when warm and slate when cool, cached per grid', () => {
  const f = clipFrames(LOOKS[0], 'ready', 'right')[0];
  const warm = shimmerOutline(f.rows, true);
  const cool = shimmerOutline(f.rows, false);
  assert.equal(shimmerOutline(f.rows, true), warm);
  assert.deepEqual([warm.length, warm[0].length], [f.h, f.w]);
  assert.ok(/^[.U]*$/.test(warm.join('')) && /^[.e]*$/.test(cool.join('')));
  warm.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    assert.equal(f.rows[y][x], '.', 'outside the sprite');
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => f.rows[y + dy]?.[x + dx] && f.rows[y + dy][x + dx] !== '.'), 'touching it');
  }));
});

test('the 16 surfaces tile at 16 × 16 in three frames, thinning out in a dither where they end', () => {
  assert.equal(SURFACE_IDS.length, 16);
  for (const id of SURFACE_IDS) {
    for (let f = 0; f < 3; f += 1) {
      const rows = surfaceTile(id, f);
      assert.ok(rows.length === 16 && rows.every((r) => r.length === 16), `${id} #${f}`);
      assert.ok(rows.join('').replace(/\./g, '').length > 60, `${id} covers its tile`);
      assert.equal(surfaceTile(id, f), rows, 'cached');
    }
    const whole = surfaceTile(id, 0, { edges: 15 });
    const alone = surfaceTile(id, 0, { edges: 0 });
    const edgeInk = (rows) => rows[0].replace(/\./g, '').length + rows[15].replace(/\./g, '').length;
    assert.ok(edgeInk(alone) < edgeInk(whole) || edgeInk(alone) === 0, `${id} thins at an open edge`);
    assert.equal(alone[0].replace(/\./g, '').length, 0, `${id} leaves its open rim clear`);
    // Each edge bit on its own (1 north, 2 east, 4 south, 8 west): only that side thins. Its outer
    // line is clear, and every pixel 4 or more in from it is the whole tile's.
    const inFrom = { 1: (x, y) => y, 2: (x) => 15 - x, 4: (x, y) => 15 - y, 8: (x) => x };
    for (const bit of [1, 2, 4, 8]) {
      const open = surfaceTile(id, 0, { edges: 15 ^ bit });
      let thinned = 0;
      for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
        const d = inFrom[bit](x, y);
        if (d === 0) assert.equal(open[y][x], '.', `${id} edges ${15 ^ bit}: its open side's rim at ${x},${y} is clear`);
        else if (d >= 4) assert.equal(open[y][x], whole[y][x], `${id} edges ${15 ^ bit}: ${x},${y} is the whole tile's`);
        if (open[y][x] !== whole[y][x]) thinned += 1;
      }
      assert.ok(thinned > 0 || !whole.some((r, y) => [...r].some((ch, x) => ch !== '.' && inFrom[bit](x, y) === 0)), `${id} thins toward bit ${bit}`);
    }
  }
  // A surface that moves has three different frames; a still one is one tile, three times.
  let moving = 0;
  for (const id of SURFACE_IDS) {
    const [a, b, c] = [0, 1, 2].map((f) => surfaceTile(id, f));
    if (a === b && b === c) continue;
    assert.ok(a.join('') !== b.join('') && b.join('') !== c.join('') && a.join('') !== c.join(''), `${id}'s three frames differ`);
    moving += 1;
  }
  assert.equal(moving, 11, 'every moving surface moves (the wax, a streetlight\'s pool, foliage, ice and rough ground hold still)');
  assert.equal(surfaceTile('candle-wax', 2), surfaceTile('candle-wax', 0));
  assert.equal(surfaceTile('lava'), null);
});

test('projectiles: one hand frame each, a derived trail, and turns', () => {
  assert.deepEqual(Object.keys(PROJECTILES).sort(), ['bolt', 'cork', 'feather', 'flame', 'glitch', 'mote', 'nightwing', 'quill', 'rivet', 'star']);
  for (const id of Object.keys(PROJECTILES)) {
    const a = projectileFrame(id, 0);
    const b = projectileFrame(id, 1);
    assert.deepEqual([a.length, a[0].length], [b.length, b[0].length], `${id}'s two frames line up`);
    assert.ok(b.join('').replace(/\./g, '').length > a.join('').replace(/\./g, '').length, `${id} leaves a trail`);
    // Frame 0 is the art two px in from the tail; frame 1 is frame 0 with a dithered trail behind:
    // every other pixel of the art (a checkerboard's dark squares) left where the art was.
    const art = PROJECTILES[id];
    let trail = 0;
    b.forEach((row, y) => [...row].forEach((ch, x) => {
      const front = art[y][x - 2];
      assert.equal(a[y][x], front && front !== '.' ? front : '.', `${id} #0 at ${x},${y}`);
      const behind = art[y][x];
      const want = a[y][x] !== '.' ? a[y][x] : behind && behind !== '.' && ((x + y) & 1) === 0 ? behind : '.';
      assert.equal(ch, want, `${id} #1 at ${x},${y}: ${a[y][x] !== '.' ? 'the art' : 'the trail'}`);
      if (a[y][x] === '.' && ch !== '.') trail += 1;
    }));
    assert.ok(trail > 0 && trail <= Math.ceil(art.join('').replace(/\./g, '').length / 2) + 1, `${id}'s trail is dithered (${trail} px)`);
    assert.deepEqual(projectileFrame(id, 0, 'left'), a.map((r) => [...r].reverse().join('')));
    const up = projectileFrame(id, 0, 'up');
    assert.deepEqual([up.length, up[0].length], [a[0].length, a.length], `${id} turns`);
    // Drawn flying right, its nose is the right-hand column: turned 'up' a quarter anticlockwise the
    // nose is the top row, and turned 'down' a quarter clockwise it's the bottom row; the trail follows.
    for (const f of [0, 1]) {
      const right = projectileFrame(id, f);
      const [w, h] = [right[0].length, right.length];
      const u = projectileFrame(id, f, 'up');
      const d = projectileFrame(id, f, 'down');
      right.forEach((row, y) => [...row].forEach((ch, x) => {
        assert.equal(u[w - 1 - x][y], ch, `${id} #${f} up at ${x},${y}`);
        assert.equal(d[x][h - 1 - y], ch, `${id} #${f} down at ${x},${y}`);
      }));
      assert.equal(u[0], [...right].map((row) => row[w - 1]).join(''), `${id} #${f}: the nose leads upward`);
    }
    assert.equal(projectileFrame(id, 0), a, 'cached');
  }
  assert.equal(projectileFrame('boulder', 0), null);
});

// ---------- icons, numbers ----------

test('icons are 8 × 8 with a closed ink outline, one per intent, condition, damage kind and thought', () => {
  assert.deepEqual(Object.keys(INTENT_ICONS).sort(), ['area', 'bite', 'brace', 'cast', 'examine', 'hidden', 'hide', 'mechanic', 'move', 'patch', 'shoot', 'shove', 'strike', 'summon', 'surface', 'talk', 'wait']);
  assert.deepEqual(Object.keys(CONDITION_ICONS).sort(), ['beguiled', 'brisk', 'dazed', 'dazzled', 'drowsy', 'exposed', 'hushed', 'lingering', 'offline', 'queasy', 'quickened', 'rattled', 'singed', 'singled-out', 'slowed', 'soaked', 'sparked', 'spooked', 'tangled', 'tumbled', 'unseen', 'winded']);
  assert.deepEqual(Object.keys(KIND_ICONS).sort(), ['chill', 'doubt', 'dread', 'dust', 'grind', 'ink', 'light', 'plain', 'quake', 'spark', 'static', 'warp']);
  assert.deepEqual(Object.keys(THOUGHT_ICONS).sort(), ['pile', 'tilt']);
  for (const [set, icons] of Object.entries(ICON_SETS)) for (const [id, rows] of Object.entries(icons)) {
    const where = `${set} ${id}`;
    assert.ok(rows.length === 8 && rows.every((r) => r.length === 8), `${where} is 8 × 8`);
    assert.ok(rows.join('').includes('o'), `${where} has ink`);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || ch === 'o') return;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = rows[y + dy]?.[x + dx];
        assert.ok(n !== undefined && n !== '.', `${where}: colour at ${x},${y} is inside its ink outline`);
      }
    }));
  }
  const all = Object.values(CONDITION_ICONS).map((r) => r.join(''));
  assert.equal(new Set(all).size, all.length, 'no two conditions share a picture');
  // Across every set (a unit card shows an intent, conditions and damage kinds side by side), no two
  // icons are the same picture, or the same drawing in other colours: each pair's ink differs in at
  // least 4 pixels, so they're told apart by shape, never by colour alone.
  const every = Object.entries(ICON_SETS).flatMap(([set, icons]) => Object.entries(icons).map(([id, rows]) => [`${set}.${id}`, rows]));
  assert.equal(every.length, 53);
  const inkOf = (rows) => rows.map((r) => r.replace(/[^.o]/g, '#'));
  let closest = Infinity;
  for (let i = 0; i < every.length; i += 1) for (let j = i + 1; j < every.length; j += 1) {
    const [a, ra] = every[i];
    const [b, rb] = every[j];
    assert.notEqual(ra.join('/'), rb.join('/'), `${a} and ${b} are different pictures`);
    const [ia, ib] = [inkOf(ra), inkOf(rb)];
    let differ = 0;
    ia.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ib[y][x]) differ += 1; }));
    assert.ok(differ >= 4, `${a} and ${b} differ in shape (${differ} px of ink and outline)`);
    closest = Math.min(closest, differ);
  }
  assert.ok(closest >= 4, `the closest two icons differ in ${closest} px`);
  assert.deepEqual(NUMBER_SLOT, { x: 8, y: 2, w: NUMBER_SIZES.small.w, h: NUMBER_SIZES.small.h }, 'room for a 4 × 6 number beside each condition');
});

test('markers tell sides apart by shape, and each outcome flash has three frames', () => {
  for (const id of ['active', 'target', 'ally', 'foe', 'neutral', 'pathDot', 'coverLow', 'coverHeavy', 'heightUp', 'heightDown', 'reach', 'eye', 'feint', 'cheer']) {
    assert.ok(MARKERS[id] && inked(MARKERS[id]), id);
    assert.ok(MARKERS[id].every((r) => r.length === MARKERS[id][0].length), `${id} is rectangular`);
  }
  const shape = (rows) => rows.map((r) => r.replace(/[^.o]/g, '#')).join('/');
  assert.equal(new Set([shape(MARKERS.ally), shape(MARKERS.foe), shape(MARKERS.neutral)]).size, 3, 'circle, diamond and square differ in shape alone');
  for (const id of ['crit', 'graze', 'miss']) {
    assert.equal(FLASHES[id].length, 3);
    for (const rows of FLASHES[id]) assert.ok(inked(rows) && rows.every((r) => r.length === rows[0].length));
  }
});

test('numbers: 4 × 6 and 6 × 9 glyph cells, cream damage, green patches, a starred Critical and a grey miss', () => {
  assert.deepEqual(NUMBER_SIZES, { small: { w: 4, h: 6 }, big: { w: 6, h: 9 } });
  const small = numberRows('23');
  assert.equal(small.length, 6);
  assert.equal(small[0].length, 2 * 4 - 1 + 1, 'two 3-wide digits, a gap and the shadow');
  assert.equal(numberRows('23'), small, 'cached');
  const big = numberRows('17', { size: 'big' });
  assert.equal(big.length, 9);
  assert.equal(big[0].length, 2 * 6 - 1 + 1);
  assert.ok(small.join('').includes('c') && small.join('').includes('o'), 'cream with an ink shadow');
  assert.ok(numberRows('+5', { fill: 'l' }).join('').includes('l'));
  const crit = numberRows('23', { fill: 'u', star: true });
  assert.ok(crit[0].length > numberRows('23', { fill: 'u' })[0].length, 'the star follows the number');
  assert.ok(crit.join('').includes('u') && crit.join('').includes('c'));
  assert.ok(/^[.So]*$/.test(numberRows('miss', { fill: 'S' }).join('')), 'miss is grey');
  assert.ok(numberRows('14?').join('').replace(/[.o]/g, '').length > numberRows('14').join('').replace(/[.o]/g, '').length);
  // the ink shadow falls right and down, never up or left of a lit pixel's own row start
  small.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== 'o') return;
    assert.ok(['c'].includes(small[y]?.[x - 1]) || ['c'].includes(small[y - 1]?.[x]) || ['c'].includes(small[y - 1]?.[x - 1]), 'shadow sits right of, below or below-right of a lit pixel');
  }));
  assert.equal(textRows('+5 birch').length, 7, 'textRows is unchanged');
});

test('the number cache drops the least recently used number, so one drawn every frame stays cached', () => {
  const hot = numberRows('0', { fill: 'W' });
  const cold = numberRows('00', { fill: 'W' });
  for (let i = 1; i <= 250; i += 1) {
    numberRows(String(1000 + i), { fill: 'W' });
    assert.equal(numberRows('0', { fill: 'W' }), hot, `the hot number is still the same rows after ${i} others`);
  }
  const again = numberRows('00', { fill: 'W' });
  assert.notEqual(again, cold, 'an unused number has been dropped and is built afresh');
  assert.deepEqual(again, cold, 'to the same rows');
  // The cache keys the fill, the size and the star: a patch's '5' is never a cached cream '5'.
  const variants = [numberRows('5'), numberRows('5', { fill: 'l' }), numberRows('5', { size: 'big' }), numberRows('5', { star: true }), numberRows('5', { fill: 'u', star: true })];
  assert.equal(new Set(variants.map((rows) => rows.join('/'))).size, variants.length, 'five different drawings');
  assert.ok(/c/.test(variants[0].join('')) && !/l/.test(variants[0].join('')), 'damage is cream');
  assert.ok(/l/.test(variants[1].join('')) && !/c/.test(variants[1].join('')), 'a patch is green, with no cream in it');
  assert.equal(numberRows('5', { fill: 'l' }), variants[1], 'and cached as its own');
  assert.deepEqual([variants[0].length, variants[2].length], [6, 9]);
});

test('every clip loops, or plays once, the same way for heroes and strays, with the same still frame', () => {
  const clips = [...CLIPS, ...Object.values(SIGNATURE_CLIPS)];
  for (const clip of clips) {
    const t = CLIP_TIMING[clip];
    const name = anims.clipPoses[clip];
    for (const [archetype, poses] of Object.entries(anims.poses)) {
      const pose = poses[name];
      assert.equal(pose.loop, t.loop, `${clip} ${t.loop ? 'loops' : 'plays once'} for heroes, and ${archetype}'s ${name} does too`);
      assert.equal(pose.still, t.still, `${clip}'s still frame is the ${t.still}, for heroes and a ${archetype}'s ${name}`);
    }
  }
  // the stray-only `sorted` plays once and ends settled away
  for (const poses of Object.values(anims.poses)) assert.deepEqual([poses[anims.clipPoses.sorted].loop, poses[anims.clipPoses.sorted].still], [false, 'last']);
});

test('the painter\'s dissolve honours layers and a second table, and keeps its old behaviour without them', () => {
  const painter = createPainter(fakeCanvas);
  const rows = ['oooo', 'oooo'];
  const table = { o: [10, 20, 30, 255] };
  const table2 = { o: [200, 100, 50, 255] };
  const layered = painter.dissolve(rows, 0, 8, { table, key: 'a', layers: ['0000', '1111'], table2 });
  assert.deepEqual([...layered.pixels.slice(0, 3)], [10, 20, 30]);
  assert.deepEqual([...layered.pixels.slice(16, 19)], [200, 100, 50], 'layer 1 takes the second table');
  const plain = painter.dissolve(rows, 0, 8, { table, key: 'b' });
  assert.deepEqual([...plain.pixels.slice(16, 19)], [10, 20, 30]);
  const base = painter.dissolve(['oo'], 0, 8);
  assert.deepEqual([...base.pixels.slice(0, 4)], [...BASE_RGBA.o]);
  // inverted (a stray gathering in), the layers keep their tables: all there at the last step, none at the first
  const lit = (c) => [...c.pixels].filter((_, i) => i % 4 === 3 && c.pixels[i] > 0).length;
  const gathered = painter.dissolve(rows, 8, 8, { invert: true, table, key: 'c', layers: ['0000', '1111'], table2 });
  assert.equal(lit(gathered), 8);
  assert.deepEqual([...gathered.pixels.slice(16, 19)], [200, 100, 50]);
  assert.equal(lit(painter.dissolve(rows, 0, 8, { invert: true, table, key: 'd', layers: ['0000', '1111'], table2 })), 0);
});

// ---------- props ----------

test('props: the camp, the Last Bridge, every genre prop, a frame per mechanic state, and the six devices', () => {
  const genreProps = ['crate', 'neon.server-rack', 'neon.vending', 'nocturne.streetlamp', 'nocturne.bench', 'gothic.candelabra', 'gothic.pew', 'iron.oil-drum', 'iron.girder', 'void.shard', 'void.orbit-stone', 'noir.filing-cabinet', 'noir.desk', 'frontier.barrel', 'frontier.cart', 'kaiju.rubble', 'kaiju.car', 'rubble'];
  const states = { junction: ['off', 'on'], lamp: ['lit', 'dark'], candle: ['lit', 'dark'], lever: ['up', 'down'], line: ['running', 'shut'], console: ['idle', 'used'], lectern: ['idle', 'read'], alibi: ['standing', 'broken'], clue: ['hidden', 'found'], 'plan-tile': ['clear', 'marked'], breaker: ['on', 'off'], forge: ['cold', 'stoked'], bell: ['still', 'rung'], 'riddle-board': ['idle', 'solved'], 'device.snare': ['set', 'sprung'], 'device.patch-kit': ['full', 'used'], 'device.pop-up-cover': ['up', 'broken'] };
  for (const id of ['handcart', 'breather-tea', 'paper-lantern', 'bedroll', 'hearth-nook', 'notebook', 'last-bridge.h', 'last-bridge.v', ...genreProps, ...Object.keys(states), 'device.drone', 'device.turret', 'device.decoy']) {
    const p = PROPS4[id];
    assert.ok(p, `${id} is drawn`);
    assert.ok(p.frames.length >= 1);
    for (const rows of p.frames) {
      assert.ok(rows.length === p.h && rows.every((r) => r.length === p.w), `${id}: every frame is ${p.w} × ${p.h}`);
      assert.ok(inked(rows), `${id} draws`);
    }
    assert.ok(p.feet[0] >= 0 && p.feet[0] < p.w && p.feet[1] >= 0 && p.feet[1] < p.h, `${id}'s feet are inside it`);
  }
  for (const [id, list] of Object.entries(states)) {
    assert.deepEqual(PROPS4[id].states, list, `${id}'s states in §5.3's order`);
    assert.equal(PROPS4[id].frames.length, list.length);
    assert.notDeepEqual(PROPS4[id].frames[0], PROPS4[id].frames[1], `${id}'s states look different`);
    assert.equal(propFrame(id, list[1]), PROPS4[id].frames[1]);
  }
  for (const id of genreProps) {
    const flags = PROP_FLAGS[id];
    assert.ok(flags, `${id} has flags`);
    assert.equal(PROPS4[id].cover, flags.includes('cover-high') ? 'high' : flags.includes('cover-low') ? 'low' : null, `${id}'s cover`);
  }
  assert.ok(PROPS4['last-bridge.h'].w >= 48 && PROPS4['last-bridge.v'].h >= 32, 'the Last Bridge spans tiles');
  assert.equal(PROPS4['breather-tea'].frames.length, 3, 'the tea steams');
  assert.equal(PROPS4.notebook.frames.length, 2, 'the pen writes a line');
  assert.equal(propFrame('lever', 'sideways'), PROPS4.lever.frames[0]);
  assert.equal(propFrame('nothing'), null);
});

test('the Last Bridge is built for its deck: every length trail.js makes, both ways, reaching both banks', async () => {
  // E's lastBridge makes decks of rule.deck[0]–rule.deck[1] river tiles, and dry footbridges of dryDeck.
  const { LAST_BRIDGE_RULE } = await import('../src/world/trail.js');
  const lengths = new Set([LAST_BRIDGE_RULE.dryDeck]);
  for (let n = LAST_BRIDGE_RULE.deck[0]; n <= LAST_BRIDGE_RULE.deck[1]; n += 1) lengths.add(n);
  assert.ok(lengths.size >= 5);
  for (const n of lengths) for (const dir of ['h', 'v']) {
    const b = lastBridgeRows(n, dir);
    const where = `${dir} × ${n}`;
    assert.equal(lastBridgeRows(n, dir), b, `${where} is cached`);
    const [sx, sy, sw, sh] = b.span;
    assert.deepEqual([sw, sh], dir === 'h' ? [n * 16, 16] : [16, n * 16], `${where}: the art over the deck is exactly its tiles`);
    assert.ok(sx >= 0 && sy >= 0 && sx + sw <= b.w && sy + sh <= b.h, `${where}: the deck lies inside the art`);
    assert.deepEqual(b.feet, [sx + sw / 2, sy + sh - 1], `${where}: its feet are the deck's bottom middle`);
    const rows = b.frames[0];
    assert.ok(rows.length === b.h && rows.every((r) => r.length === b.w) && paletteOnly(rows));
    // the stonework runs the whole deck and 4 px onto each bank: no gap anywhere along it
    if (dir === 'h') {
      for (let x = sx - 4; x < sx + sw + 4; x += 1) assert.ok(rows.slice(sy, sy + sh).some((r) => r[x] !== '.'), `${where}: column ${x} is bridge`);
      for (let y = sy; y < sy + sh; y += 1) assert.equal(rows[y][sx + sw / 2] === '.', false, `${where}: row ${y} of the deck is drawn`);
    } else {
      for (let y = sy - 4; y < sy + sh + 4; y += 1) assert.ok(rows[y].slice(sx, sx + sw).replace(/\./g, '').length > 0, `${where}: row ${y} is bridge`);
      for (let y = sy; y < sy + sh; y += 1) assert.ok(/^[^.]+$/.test(rows[y].slice(sx + 3, sx + sw - 3)), `${where}: the deck is solid at row ${y}`);
    }
  }
  assert.equal(PROPS4['last-bridge.h'], lastBridgeRows(3, 'h'), 'PROPS4 keeps the dry footbridge\'s three tiles');
  assert.equal(PROPS4['last-bridge.v'], lastBridgeRows(3, 'v'));
  assert.equal(lastBridgeRows(5, 'h').w - lastBridgeRows(1, 'h').w, 64, 'each tile adds 16 px');
  assert.equal(lastBridgeRows(9, 'v'), lastBridgeRows(8, 'v'), 'lengths clamp to 1–8');
});

test('propFrame(object.kind, object.state) draws every FightObject kind in every state of §5.3', () => {
  // §5.3's closed kinds and states, as B's effects.js exports them (OBJECT_KINDS, OBJECT_STATES).
  const KINDS = {
    lever: ['up', 'down'], junction: ['off', 'on'], lamp: ['lit', 'dark'], candle: ['lit', 'dark'], line: ['running', 'shut'],
    console: ['idle', 'used'], lectern: ['idle', 'read'], alibi: ['standing', 'broken'], clue: ['hidden', 'found'],
    'plan-tile': ['clear', 'marked'], breaker: ['on', 'off'], forge: ['cold', 'stoked'], bell: ['still', 'rung'],
    'riddle-board': ['idle', 'solved'], chest: ['shut', 'open'], snare: ['set', 'sprung'], 'patch-kit': ['full', 'used'],
    'pop-up-cover': ['up', 'broken'],
  };
  for (const [kind, states] of Object.entries(KINDS)) {
    const drawn = states.map((state) => propFrame(kind, state));
    drawn.forEach((rows, i) => assert.ok(rows && inked(rows), `a ${kind} object ${states[i]} is drawn`));
    assert.notEqual(drawn[0], drawn[1], `a ${kind}'s two states look different`);
  }
  // a device object's kind draws its device.<template> frame
  assert.equal(propFrame('snare', 'sprung'), PROPS4['device.snare'].frames[1]);
  assert.equal(propFrame('patch-kit', 'used'), PROPS4['device.patch-kit'].frames[1]);
  assert.equal(propFrame('pop-up-cover', 'up'), PROPS4['device.pop-up-cover'].frames[0]);
  // a chest is the world's own chest sprite, shut and open
  assert.equal(propFrame('chest', 'shut'), SPRITES.chest[0]);
  assert.equal(propFrame('chest', 'open'), SPRITES.chest[1]);
  // a prop object's state is its PROPS4 id, and 'rubble' once it bursts
  for (const id of Object.keys(PROP_FLAGS)) assert.equal(propFrame('prop', id), PROPS4[id].frames[0], `a prop object in state ${id}`);
  assert.equal(propFrame('prop', 'rubble'), PROPS4.rubble.frames[0]);
  assert.equal(propFrame('prop', 'nothing'), null);
});

// ---------- purity ----------

test('the art modules are pure: no clock, no Math.random, no DOM, and sprites-party never imports riftfx or the engine', () => {
  const files = ['src/world/sprites-party.js', 'src/world/party/coat.js', 'src/world/party/robe.js', 'src/world/party/jev.js', 'src/world/party/toll.js', 'src/world/icons.js', 'src/world/fx.js', 'src/world/props4.js', 'src/world/straygen.js'];
  for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const banned of ['Date.now', 'Math.random', 'performance.now', 'document.', 'window.']) assert.ok(!src.includes(banned), `${file} has no ${banned}`);
    assert.ok(src.split('\n').length <= 1500, `${file} is at most 1,500 lines`);
  }
  // .gitattributes keeps text files LF; every file F writes stays so
  for (const file of [...files, 'src/world/riftfx.js', 'src/world/scene-art.js', 'content/combat/anims.json', 'scripts/capture-anims.mjs', 'tests/art4.test.js']) {
    assert.ok(!readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('\r'), `${file} has LF line endings`);
  }
  const party = readFileSync(new URL('../src/world/sprites-party.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/(riftfx|engine|anim)\.js'/.test(party), 'sprites-party imports only sprites.js and its rigs');
  assert.ok(!Object.keys(SPRITES).some((name) => /^(coat|robe|toll)\b/.test(name)), 'the rigs stay out of SPRITES');
});

test('anims.json\'s description passes the calm rules', async () => {
  const { assertCalm, assertCosy } = await import('./calm.js');
  assertCalm(anims.about, 'anims.about', { proper: ['CONTRACT-PHASE4.md', 'COMBAT.md'] });
  assertCosy(anims.about, 'anims.about');
  assert.ok(!anims.about.includes('!'));
  assert.ok(RIG_DATA.coat.poses.ready, 'the rig data is reachable for the capture sheet');
});
