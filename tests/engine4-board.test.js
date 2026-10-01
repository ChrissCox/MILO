// The engine's fight board after wave 2 (module J: anim.js's timeline, scene-combat.js's board, and
// their wiring in engine.js, scene-rifts.js, scene-wilds.js and scene-elsewhere.js). It pins the
// wave 2.5 settle: every change B sends lands on the board (CONTRACT-PHASE4.md §5.8, §18.3 item 2),
// in B's order and facing, thoughts and feints in their own actor's moment, every addition to a
// playback held where it came (at the next call and a new speed too), telegraphs drawn as the HUD's
// cards show them, a new speed with no jump, a field boss's arena check out of the draw, the fight's
// marks over the night's tint, a chest hidden by its loot id, the Mimic awake, and no hover once a
// fight is over. §11, §15, §18.3.
// Run: node --test tests/engine4-board.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/world/engine.js';
import { TILE } from '../src/world/map.js';
import { SPRITES } from '../src/world/sprites.js';
import { INTENT_ICONS } from '../src/world/icons.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { createRiftLayer } from '../src/world/scene-rifts.js';
import { createPainter } from '../src/world/scene-art.js';
import { hashInts } from '../src/world/rng.js';
import { isFieldBoss, NO_FIGHT_MECHANICS, PUZZLE_GENRES } from '../src/world/fieldboss.js';
import { timeline } from '../src/world/anim.js';
import { createCombatLayer, benchView } from '../src/world/scene-combat.js';
import { prepareElsewhere } from '../src/combat/encounters.js';
import { manualClock, fakeDom, flush, testSpec } from './fakedom.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const CONTENT = Object.fromEntries(['genres', 'riftgen', 'fortress', 'wilds', 'story'].map((name) => [name, read(name)]));
CONTENT.combat = Object.fromEntries(['rules', 'leads', 'foes', 'anims'].map((name) => [name, read(`combat/${name}`)]));
const { anims: ANIMS, rules: RULES } = CONTENT.combat;
const RIFTGEN = createRiftgen({ words: CONTENT.riftgen, genres: CONTENT.genres });

// ---------- helpers ----------

/** A combat layer on recording canvases: every grid remembers its rows and tag, every context its fills. */
function layerFor(motion = false) {
  const canvases = [];
  const makeCanvas = (w, h) => {
    const rects = [];
    const ctx = new Proxy({ rects }, { get: (t, p) => (p in t ? t[p] : p === 'fillRect' ? (x, y, cw, ch) => rects.push([x, y, cw, ch]) : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
    const c = { width: w, height: h, getContext: () => ctx, rects };
    canvases.push(c);
    return c;
  };
  const painter = { grid: (rows, table, key, opts = {}) => ({ width: rows[0].length, height: rows.length, rows, _milo: opts.tag }), made: 0 };
  const layer = createCombatLayer({ painter, makeCanvas, anims: () => ANIMS, rules: () => RULES, tableFor: () => null, dressAt: () => null, genreAt: () => null, motion: () => motion, wake: () => {} });
  return { layer, canvases };
}

const rig = (who, rigName = 'robe') => ({ kind: 'rig', rig: rigName, who, likeness: null });
const stray = (archetype = 'walker') => ({ kind: 'stray', archetype, bodyKey: 'r', parts: [], eyeKey: null, genres: ['neon'], scale: 1 });
const unit = (id, side, x, y, more = {}) => ({ id, side, rank: side === 'party' ? 'hero' : 'stray', talkKind: null, look: side === 'party' ? rig(id) : stray(), x, y, size: 1, facing: side === 'party' ? 'right' : 'left', name: id, integrity: 20, max: 20, buffer: 0, offline: false, sorted: null, conditions: [], heat: 20, bar: null, ...more });
function arenaOf(w = 14, h = 8) {
  const n = w * h;
  return { rect: { x: 0, y: 0, w, h }, cells: '.'.repeat(n), height: '0'.repeat(n), light: 'L'.repeat(n), mouths: [], entry: [] };
}
const viewWith = (units, more = {}) => ({ arena: arenaOf(), units, objects: [], surfaces: [], lights: [], telegraphs: [], noticed: [], ...more });
const ev = (t, o) => ({ t, round: 1, tick: 1, ...o });
const act = (u, action, o = {}) => ev('act', { unit: u, action, words: '', ...o });
const walk = (u, path, how = 'stride') => ev('move', { unit: u, by: null, path, how });
/** Where a combatant is drawn, as its entity says (rounded to a tile). */
const drawnX = (layer, id) => layer.entities({ x0: -50, y0: -50, x1: 50, y1: 50 }, 0).find((e) => e.id === `cb:${id}`)?.x ?? null;
/** Every combatant's feet as drawn (px, unrounded), by id. */
function feetPx(layer) {
  const at = {};
  let tag = null;
  const target = { drawImage: (c) => { if (c && c._milo) tag = c._milo; }, set globalAlpha(v) {}, get globalAlpha() { return 1; } };
  const list = [];
  layer.collect(list, target, () => true, null, () => {});
  for (const d of list) {
    tag = null;
    d.draw();
    if (tag && tag.startsWith('cb:')) at[tag.slice(3)] = d.x;
  }
  return at;
}
const tl = (events, units, o = {}) => timeline(events, { units, anims: ANIMS, rules: RULES, motion: true, speed: 1, fastFoes: true, ...o });
const shown = (t, kind, ms) => t.at(ms).marks.some((m) => m.kind === kind);

/** A world with content, recording the fight's callbacks. */
function world4({ clock = null, motion = false, width = 1000, height = 700 } = {}) {
  const dom = fakeDom({ clock, width, height });
  const hovers = [];
  const world = createWorld(dom.canvas, { motion: () => motion, content: CONTENT, onCombatHover: (h) => hovers.push(h) });
  world.setWildState({ day: 20000, tier: 1, wardRadius: 0, closed: [], lit: [], opened: [], felled: {} });
  return { world, hovers, ...dom, done: () => { world.dispose(); dom.cleanup(); } };
}
function lastFrame(draws) {
  const ends = draws.map((d, i) => (d.args.length === 8 && d.args[6] > d.args[2] ? i : -1)).filter((i) => i >= 0);
  if (!ends.length) return [];
  return draws.slice(ends.length > 1 ? ends.at(-2) + 1 : 0, ends.at(-1) + 1);
}
async function run(clock, promise, ms = 20000) {
  let value = 'pending';
  promise.then((v) => { value = v; });
  for (let t = 0; t < ms && value === 'pending'; t += 50) {
    clock.advance(50);
    await flush();
  }
  return value;
}
const pointAt = (world, tile, dy = -6) => {
  const at = world.screenOfTile(tile);
  return { clientX: at.x, clientY: at.y + dy, button: 0, preventDefault() {} };
};

// ---------- thoughts and feints ----------

test('a drafted hero’s thought shows over its own act, and nothing added re-times a stray already walking', () => {
  const units = [unit('jev', 'party', 1, 4, { look: rig('jev', 'jev') }), unit('f0', 'foe', 12, 1, { talkKind: 'k0' })];
  const path = Array.from({ length: 8 }, (_, i) => ({ x: 11 - i, y: 1 }));
  const stepA = [act('f0', { id: 'stride' }), walk('f0', path)];
  const stepB = [ev('thought', { unit: 'jev', text: null, picture: 'pile' }), act('jev', { id: 'stride' }), walk('jev', [{ x: 2, y: 4 }, { x: 3, y: 4 }])];
  const withThought = tl([...stepA, ...stepB], units);
  const without = tl([...stepA, ...stepB.slice(1)], units);
  // The stray's walk is timed exactly as it is without Jev's thought.
  for (let ms = 0; ms <= without.duration; ms += 25) assert.equal(withThought.at(ms).units.f0.x, without.at(ms).units.f0.x, `f0 at ${ms} ms`);
  // The thought shows while Jev walks, never during the stray's walk, for its whole 900 ms.
  const jevStarts = [...Array(400).keys()].map((k) => k * 10).find((ms) => withThought.at(ms).units.jev.x !== 1);
  assert.ok(Number.isFinite(jevStarts), 'Jev walks');
  assert.equal(shown(withThought, 'thought', jevStarts - 30), false, 'not over the stray’s turn');
  assert.equal(shown(withThought, 'thought', jevStarts + 10), true, 'over Jev as he goes');
  let visible = 0;
  for (let ms = 0; ms < withThought.duration + 1000; ms += 10) if (shown(withThought, 'thought', ms)) visible += 10;
  assert.ok(visible >= 850, `shown ${visible} ms, not cut short by a fast foe’s turn`);
  // The reviewer's case: Jev's step added to a running playback while the stray is half-way along.
  const { layer } = layerFor(true);
  layer.sync(viewWith(units));
  layer.play(stepA, { speed: 1 });
  for (let i = 0; i < 10; i += 1) layer.update(30);
  const before = drawnX(layer, 'f0');
  assert.ok(before < 12 && before > 4, `the stray is part-way (${before})`);
  layer.play(stepB, { speed: 1 });
  layer.update(0);
  assert.equal(drawnX(layer, 'f0'), before, 'the stray stays where it was drawn');
});

test('a stray’s step added while its kind moves still joins their beat, even with an improvise ahead of its act', () => {
  const units = [unit('f0', 'foe', 12, 1, { talkKind: 'k0' }), unit('f1', 'foe', 12, 3, { talkKind: 'k0' })];
  const stepA = [act('f0', { id: 'stride' }), walk('f0', [{ x: 11, y: 1 }, { x: 10, y: 1 }, { x: 9, y: 1 }])];
  const act1 = [act('f1', { id: 'stride' }), walk('f1', [{ x: 11, y: 3 }, { x: 10, y: 3 }, { x: 9, y: 3 }])];
  const improvise = ev('improvise', { unit: 'f1', from: { id: 'strike' }, to: { id: 'stride' }, why: 'wont-fit' });
  const where = (stepB) => {
    const { layer } = layerFor(true);
    layer.sync(viewWith(units));
    layer.play(stepA);
    layer.update(30);
    layer.play(stepB);
    layer.update(60);
    return [drawnX(layer, 'f0'), drawnX(layer, 'f1')];
  };
  const plain = where(act1);
  assert.ok(plain[1] < 12, `f1 sets off at once with f0 (${plain})`);
  assert.deepEqual(where([improvise, ...act1]), plain, 'the improvise changes nothing');
});

test('a late joiner to a kind’s beat stays held where it came, when the next call or a new speed comes', () => {
  const units = [unit('milo', 'party', 1, 4, { look: rig('milo', 'coat') }), unit('f0', 'foe', 14, 1, { talkKind: 'k0' }), unit('f1', 'foe', 14, 3, { talkKind: 'k0' })];
  const stride = (u, y) => [act(u, { id: 'stride' }), walk(u, Array.from({ length: 8 }, (_, i) => ({ x: 13 - i, y })))];
  for (const next of ['call', 'speed']) {
    const { layer } = layerFor(true);
    layer.sync(viewWith(units, { arena: arenaOf(16, 8) }));
    layer.play(stride('f0', 1));
    layer.update(30);
    layer.play(stride('f1', 3)); // joins f0's beat 30 ms late: held to that moment
    layer.update(30);
    const before = feetPx(layer);
    assert.ok(before.f1 < 14 * TILE + 8, `f1 is on its way (${before.f1})`);
    if (next === 'call') layer.play([act('milo', { id: 'brace' })]);
    else layer.play([], { speed: 2 });
    layer.update(0);
    const after = feetPx(layer);
    assert.deepEqual([after.f0, after.f1], [before.f0, before.f1], `nobody jumps at the ${next}`);
    layer.update(20);
    assert.ok(feetPx(layer).f1 < before.f1, `and f1 walks on from there (${next})`);
  }
});

test('events added to a playback never join a segment already playing, at any addition', () => {
  const units = [unit('milo', 'party', 2, 4, { look: rig('milo', 'coat'), integrity: 22, max: 22 }), unit('f0', 'foe', 3, 4), unit('jev', 'party', 1, 6, { look: rig('jev', 'jev') })];
  const blow = (integrity) => ev('damage', { unit: 'f0', target: 'milo', amount: 2, kind: 'grind', degree: 'hit', weak: 0, resist: 0, buffered: 0, integrity, max: 22 });
  const strike = [act('f0', { id: 'strike', target: { unit: 'milo' } }), ev('outcome', { unit: 'f0', target: 'milo', degree: 'hit', bars: [0, 100, 0, 0], k: 1, cheer: false, by: null }), blow(20)];
  const one = tl(strike, units);
  const hit = one.events.find((e) => e.ev === strike[2]).at;
  const now = one.timeAt(hit + 200);
  // B's calls each start with an act; one that didn't still waits for now, never landing in the past.
  const extra = blow(18);
  const two = tl([...strike, extra], units, { from: { index: 3, at: now } });
  const landed = two.events.find((e) => e.ev === extra).at;
  assert.ok(landed >= now, `the added blow lands from now on (${landed} ≥ ${now})`);
  // A third call keeps the second's boundary and hold: nothing already placed moves.
  const brace = act('milo', { id: 'brace' });
  const three = tl([...strike, extra, brace], units, { from: [{ index: 3, at: now }, { index: 4, at: one.timeAt(hit + 260) }] });
  assert.equal(three.events.find((e) => e.ev === extra).at, landed, 'the second call’s blow keeps its moment');
  assert.equal(three.events.find((e) => e.ev === strike[2]).at, hit, 'and the first call’s its own');
  // Nor does a look-ahead reach past an addition: a thought that came with no act keeps its moment.
  const thought = ev('thought', { unit: 'jev', text: null, picture: 'pile' });
  const holds = [{ index: 3, at: now }];
  const first = (t) => [...Array(600).keys()].map((k) => k * 10).find((ms) => shown(t, 'thought', ms));
  const alone = tl([...strike, thought], units, { from: holds });
  const joined = tl([...strike, thought, act('jev', { id: 'stride' }), walk('jev', [{ x: 2, y: 6 }])], units, { from: [...holds, { index: 4, at: now + 300 }] });
  assert.ok(Number.isFinite(first(alone)), 'the thought shows');
  assert.equal(first(joined), first(alone), 'and stays where it was when the act comes in the next call');
});

test('a spotted feint marks the lead in its own moment, taking no time from the stray before it', () => {
  const units = [unit('milo', 'party', 1, 4, { look: rig('milo', 'coat') }), unit('f0', 'foe', 12, 1, { talkKind: 'k0' }), unit('lead', 'foe', 10, 5, { rank: 'lead' })];
  // A walk long enough that anything stretching its segment would slow it (past a stray-beat).
  const moves = [act('f0', { id: 'stride' }), walk('f0', Array.from({ length: 8 }, (_, i) => ({ x: 11 - i, y: 1 })))];
  const feint = tl([...moves, ev('feint', { unit: 'lead', spotted: true })], units);
  const plain = tl(moves, units);
  for (let ms = 0; ms <= plain.duration; ms += 20) assert.equal(feint.at(ms).units.f0.x, plain.at(ms).units.f0.x, `f0 at ${ms} ms`);
  const marks = [...Array(300).keys()].map((k) => feint.at(k * 10).marks).flat().filter((m) => m.kind === 'feint');
  assert.ok(marks.length > 0 && marks.every((m) => m.unit === 'lead'), 'the “!” shows over the lead');
});

test('a mark takes no time: a spotted feint, or a thought with no act of its own, never delays the act after it', () => {
  const units = [unit('milo', 'party', 1, 4, { look: rig('milo', 'coat') }), unit('jev', 'party', 1, 6, { look: rig('jev', 'jev') }), unit('lead', 'foe', 10, 5, { rank: 'lead' })];
  const moves = [act('milo', { id: 'stride' }), walk('milo', [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }])];
  const plain = tl(moves, units);
  for (const mark of [ev('feint', { unit: 'lead', spotted: true }), ev('thought', { unit: 'jev', text: null, picture: 'pile' })]) {
    const marked = tl([mark, ...moves], units);
    for (let ms = 0; ms <= plain.duration; ms += 20) assert.equal(marked.at(ms).units.milo.x, plain.at(ms).units.milo.x, `${mark.t}: Milo at ${ms} ms`);
    assert.ok(marked.at(20).marks.some((m) => m.kind === mark.t), `the ${mark.t} still shows`);
  }
});

// ---------- every drawn change has an event ----------

test('the board takes every change B sends: a count-down, Buffers at a round’s start, a hero going offline, the lead’s bar, a settle', () => {
  const { layer } = layerFor(false);
  const lead = unit('lead', 'foe', 10, 5, { rank: 'lead', size: 2, bar: { phase: 'opening', bar: 0, bars: [40, 40] } });
  layer.sync(viewWith([
    unit('milo', 'party', 2, 2, { look: rig('milo', 'coat'), buffer: 4, conditions: [{ id: 'soaked', n: 2 }, { id: 'spooked', n: 1 }] }),
    unit('claude', 'party', 2, 4, { buffer: 3, conditions: [{ id: 'tumbled', n: null }] }),
    lead,
  ]));
  layer.play([ev('condition', { target: 'milo', id: 'soaked', n: 1, on: true })]);
  assert.deepEqual(layer.unit('milo').conditions, [{ id: 'soaked', n: 1 }, { id: 'spooked', n: 1 }], 'a count-down changes the badge where it stands');
  layer.play([ev('buffer', { unit: 'milo', buffer: 0 })]);
  assert.deepEqual([layer.unit('milo').buffer, layer.unit('claude').buffer], [0, 3], 'a Buffer event of 0 clears that badge alone');
  layer.play([ev('round', { round: 2, tick: 0 })]);
  assert.deepEqual([layer.unit('milo').buffer, layer.unit('claude').buffer], [0, 0], 'a round’s start clears every Buffer');
  layer.play([ev('buffer', { unit: 'claude', buffer: 5 }), ev('offline', { unit: 'claude' })]);
  const claude = layer.unit('claude');
  assert.deepEqual([claude.offline, claude.buffer, claude.conditions], [true, 0, []], 'a dozing hero wears no badges');
  layer.play([ev('bar', { unit: 'lead', bar: 1, integrity: 30, max: 40 }), ev('phase', { unit: 'lead', phase: 'twist', quote: '' })]);
  assert.deepEqual(layer.unit('lead').bar, { phase: 'twist', bar: 1, bars: [40, 40] }, 'the lead’s bar and phase');
  assert.equal(layer.unit('lead').integrity, 30);
  layer.play([ev('condition', { target: 'lead', id: 'soaked', n: 2, on: true }), ev('sorted', { unit: 'lead', how: 'settled' })]);
  assert.deepEqual([layer.unit('lead').integrity, layer.unit('lead').conditions], [0, []], 'settled: no Integrity, no badges');
});

test('the Hooklight walks with Milo: a change sent after his walk lands as he arrives, one sent ahead as he reaches its tile', () => {
  const units = [unit('milo', 'party', 2, 2, { look: rig('milo', 'coat') })];
  const hook = (x, y) => ev('light', { lights: [{ id: 'hooklight', x, y, radius: 3, rounds: null, source: 'milo' }] });
  const path = [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }];
  const arrives = (t) => [...Array(200).keys()].map((k) => k * 10).find((ms) => t.at(ms).units.milo.x >= 5);
  const after = tl([act('milo', { id: 'stride' }), walk('milo', path), hook(5, 2)], units);
  const landed = after.events.find((e) => e.ev.t === 'light').at;
  assert.ok(landed >= arrives(after) - 10, `after the walk: lands as he arrives (${landed} ms)`);
  const ahead = tl([act('milo', { id: 'stride' }), hook(3, 2), hook(4, 2), hook(5, 2), walk('milo', path)], units);
  const times = ahead.events.filter((e) => e.ev.t === 'light').map((e) => e.at);
  assert.equal(times.length, 3);
  assert.ok(times[0] > 0 && times[0] < times[1] && times[1] < times[2], `sent ahead: one by one as he walks (${times})`);
  const { layer } = layerFor(false);
  layer.sync(viewWith(units, { lights: [{ id: 'hooklight', x: 2, y: 2, radius: 3, rounds: null, source: 'milo' }] }));
  layer.play([act('milo', { id: 'stride' }), walk('milo', path), hook(5, 2)]);
  assert.equal(layer.lights()[0].x, 5 * TILE + 8, 'the board’s light is where he stands');
});

test('new telegraphs outrank the planner’s older ones: their icons, and the threats drawn from their areas', () => {
  const { layer, canvases } = layerFor(false);
  const units = [unit('milo', 'party', 2, 2, { look: rig('milo', 'coat') }), unit('f0', 'foe', 8, 2)];
  const old = { unitId: 'f0', slot: 0, tick: 1, icon: 'strike', words: 'Strike Milo', targets: ['milo'], tiles: [], hidden: false, falseTarget: null, adapting: null, aside: false };
  layer.sync(viewWith(units, { telegraphs: [old] }));
  layer.overlay({ telegraphs: [old], threats: [{ x: 3, y: 2 }] });
  const area = { ...old, icon: 'area', words: 'Stomp', targets: [], tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }] };
  layer.play([act('f0', { id: 'stride' }), walk('f0', [{ x: 7, y: 2 }]), ev('telegraphs', { list: [area] })]);
  const drawn = [];
  const target = { drawImage: (image) => drawn.push(image), fillRect() {}, set globalAlpha(v) {}, get globalAlpha() { return 1; } };
  layer.above(target, () => true, null, { x: 0, y: 0, w: 300, h: 200 });
  assert.ok(drawn.some((c) => c.rows === INTENT_ICONS.area), 'the new intent is drawn');
  assert.equal(drawn.some((c) => c.rows === INTENT_ICONS.strike), false, 'the old one isn’t');
  const plan = canvases.filter((c) => c._milo === 'overlay:plan').at(-1);
  const corners = plan.rects.filter(([, , w, h]) => w === 2 && h === 2).length;
  assert.equal(corners, 4 * area.tiles.length, 'every tile of the new area is marked a threat');
  layer.play([ev('end', { result: { outcome: 'won' } })]);
  drawn.length = 0;
  layer.above(target, () => true, null, { x: 0, y: 0, w: 300, h: 200 });
  assert.equal(drawn.some((c) => Object.values(INTENT_ICONS).includes(c.rows)), false, 'a fight that’s over shows no intents');
});

test('the board draws B’s telegraphs as the HUD’s cards show them: none from an Unseen foe, and a Void lie only until Examined', () => {
  const { layer, canvases } = layerFor(false);
  const units = [unit('milo', 'party', 2, 2, { look: rig('milo', 'coat') }), unit('claude', 'party', 2, 6), unit('f0', 'foe', 8, 4, { conditions: [{ id: 'unseen', n: null }] }), unit('f1', 'foe', 8, 2)];
  const tg = (unitId, more) => ({ unitId, slot: 0, tick: 1, icon: 'strike', words: 'Strike', targets: [], tiles: [], hidden: false, falseTarget: null, adapting: null, aside: false, ...more });
  const stomp = tg('f0', { icon: 'area', words: 'Stomp', tiles: [{ x: 4, y: 5 }, { x: 5, y: 5 }] });
  const lie = tg('f1', { targets: ['milo'], falseTarget: 'claude' });
  layer.sync(viewWith(units));
  layer.overlay({ telegraphs: [], threats: [] });
  const drawn = [];
  const target = { drawImage: (image) => drawn.push(image), fillRect() {}, set globalAlpha(v) {}, get globalAlpha() { return 1; } };
  const icons = (rows) => { drawn.length = 0; layer.above(target, () => true, null, { x: 0, y: 0, w: 300, h: 200 }); return drawn.filter((c) => c.rows === rows).length; };
  const plan = () => canvases.filter((c) => c._milo === 'overlay:plan').at(-1).rects;
  const dotRows = () => new Set(plan().filter(([, , w, h]) => w === 1 && h === 1).map(([, y]) => y));
  const corners = () => plan().filter(([, , w, h]) => w === 2 && h === 2).length;
  layer.play([ev('telegraphs', { list: [stomp, lie] })]);
  assert.equal(icons(INTENT_ICONS.area), 0, 'the Unseen foe’s intent isn’t drawn');
  assert.equal(corners(), 0, 'nor the tiles it threatens');
  assert.equal(icons(INTENT_ICONS.strike), 1, 'the seen foe’s is');
  assert.ok(dotRows().size > 1, 'its arrow points at the false target, down the board');
  layer.play([ev('reveal', { unit: 'f1', what: 'stats', text: 'f1 is examined.' })]);
  assert.equal(dotRows().size, 1, 'Examined: the arrow points along its row, at Milo');
  layer.play([ev('condition', { target: 'f0', id: 'unseen', n: null, on: false }), ev('reveal', { unit: 'f0', what: 'unseen', text: 'f0 is found.' })]);
  assert.equal(icons(INTENT_ICONS.area), 1, 'found: its intent shows');
  assert.equal(corners(), 4 * stomp.tiles.length, 'and the tiles it threatens');
});

test('strays sharing a beat land their events in B’s order, so the board keeps the last blow’s Integrity', () => {
  const { layer } = layerFor(true);
  const units = [unit('milo', 'party', 5, 3, { look: rig('milo', 'coat'), integrity: 22, max: 22 }), unit('f1', 'foe', 12, 3, { talkKind: 'k0' }), unit('f0', 'foe', 6, 3, { talkKind: 'k0' })];
  layer.sync(viewWith(units));
  const hit = (u, integrity) => [
    act(u, { id: 'strike', target: { unit: 'milo' } }),
    ev('outcome', { unit: u, target: 'milo', degree: 'hit', bars: [0, 100, 0, 0], k: 1, cheer: false, by: null }),
    ev('damage', { unit: u, target: 'milo', amount: 6, kind: 'grind', degree: 'hit', weak: 0, resist: 0, buffered: 0, integrity, max: 22 }),
  ];
  const events = [...hit('f1', 16), ...hit('f0', 10)];
  const order = tl(events, units).events.filter((e) => e.ev.t === 'damage').map((e) => e.ev.integrity);
  assert.deepEqual(order, [16, 10], 'the far stray’s blow first, as B sent it');
  layer.play(events);
  for (let i = 0; i < 200 && layer.busy(); i += 1) layer.update(33);
  assert.equal(layer.unit('milo').integrity, 10);
});

// ---------- facing ----------

test('units face the way B says: toward a target only while striking, and after a walk the way its last sideways step went', () => {
  const units = [unit('milo', 'party', 5, 5, { look: rig('milo', 'coat') }), unit('f0', 'foe', 3, 5)];
  const strike = tl([act('milo', { id: 'strike', target: { unit: 'f0' } }), ev('outcome', { unit: 'milo', target: 'f0', degree: 'hit', bars: [0, 100, 0, 0], k: 1, cheer: false, by: null })], units);
  assert.equal(strike.at(20).units.milo.facing, 'left', 'turned to strike');
  assert.equal(strike.final.milo.facing, 'right', 'and back as B has him after');
  assert.equal(strike.at(strike.duration + 1).units.milo.facing, 'right');
  const path = [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 6 }];
  const moved = tl([act('milo', { id: 'stride' }), walk('milo', path)], units);
  assert.equal(moved.final.milo.facing, 'left', 'the last step went left');
  assert.equal(moved.at(60).units.milo.facing, 'right', 'the first went right');
  const { layer } = layerFor(false);
  layer.sync(viewWith(units));
  layer.play([act('milo', { id: 'stride' }), walk('milo', path)]);
  assert.equal(layer.unit('milo').facing, 'left', 'the board agrees');
  layer.play([act('milo', { id: 'strike', target: { unit: 'f0' } })]);
  assert.equal(layer.unit('milo').facing, 'left');
  layer.play([walk('milo', [{ x: 6, y: 7 }])]);
  assert.equal(layer.unit('milo').facing, 'left', 'a step straight down keeps it');
});

// ---------- speed ----------

test('a new speed carries the playback on from where it is, with no jump', () => {
  const { layer } = layerFor(true);
  const units = [unit('f0', 'foe', 12, 1, { talkKind: 'k0' })];
  layer.sync(viewWith(units));
  const path = Array.from({ length: 8 }, (_, i) => ({ x: 11 - i, y: 1 }));
  let ended = false;
  layer.play([act('f0', { id: 'stride' }), walk('f0', path)], { speed: 1, fastFoes: false }).then(() => { ended = true; });
  for (let i = 0; i < 10; i += 1) layer.update(30);
  const before = drawnX(layer, 'f0');
  assert.ok(before < 12 && before > 4, `part-way (${before})`);
  layer.play([], { speed: 2, fastFoes: false });
  layer.update(0);
  assert.equal(drawnX(layer, 'f0'), before, 'still where it was');
  assert.equal(layer.busy(), true, 'and still walking');
  let ms = 0;
  while (layer.busy() && ms < 5000) { layer.update(10); ms += 10; }
  assert.ok(ms <= (8 * 140 - 300) / 2 + 60, `the rest at twice the speed (${ms} ms)`);
  assert.equal(drawnX(layer, 'f0'), 4);
  return Promise.resolve().then(() => assert.equal(ended, true, 'its promise settles'));
});

// ---------- the Mimic ----------

test('a sprite foe (the Mimic) stands awake in its fight', () => {
  const { layer } = layerFor(false);
  layer.sync(viewWith([unit('mimic', 'foe', 5, 3, { look: { kind: 'sprite', name: 'chest.mimic' } })]));
  const images = [];
  const list = [];
  layer.collect(list, { drawImage: (image) => images.push(image) }, () => true, null, () => {});
  for (const d of list) d.draw();
  const mimic = images.find((c) => c._milo === 'cb:mimic');
  assert.ok(mimic, 'the Mimic is drawn');
  assert.equal(mimic.rows, SPRITES['chest.mimic'][1], 'awake, not the closed chest');
});

// ---------- the field boss ----------

test('a field boss’s arena check waits for an idle slice, never a draw, and one drawn standing first walks off from home', () => {
  let rift = null;
  for (let i = 0; i < 4000 && !rift; i += 1) {
    const spec = RIFTGEN.wildRift({ seed: hashInts(7, i, 'test-boss'), tier: 5, depth: 3, weights: { gothic: 3, noir: 3, void: 2 } });
    const r = { id: spec.id, key: null, kind: 'wild', spec, x: 60, y: -60, stage: spec.stage, held: null };
    if (spec.stage === 'gaping' && spec.taleLead && !NO_FIGHT_MECHANICS.includes(spec.taleLead.mechanic) && !PUZZLE_GENRES.includes(spec.taleLead.genre)) rift = r;
  }
  assert.ok(rift && isFieldBoss(rift));
  const dom = fakeDom({});
  const painter = createPainter((w, h) => { const c = dom.canvas.ownerDocument.createElement('canvas'); c.width = w; c.height = h; return c; });
  let queued = 0;
  const layer = createRiftLayer({ genres: CONTENT.genres, words: CONTENT.riftgen, painter, leads: CONTENT.combat.leads, rules: RULES, deferRoams: true, onRoamQueued: () => { queued += 1; } });
  try {
    layer.setWild('3,-3', [rift]);
    assert.equal(queued, 1, 'its roam is queued as its rift arrives');
    const target = { drawImage() {}, set globalAlpha(v) {}, get globalAlpha() { return 1; } };
    layer.collect([], target, () => true, 5000, () => {});
    const standing = layer.actorsFor(rift).find((a) => a.lead);
    assert.notEqual(standing.roams, true, 'drawn standing: the draw worked nothing out');
    const home = standing.positionAt(5000);
    const task = layer.roamTask();
    assert.equal(typeof task, 'function', 'an idle task');
    task();
    assert.equal(layer.roamTask(), null, 'and only one');
    const lead = layer.actorsFor(rift).find((a) => a.lead);
    assert.equal(lead.roams, true, 'it roams once its idle slice has run');
    const first = lead.positionAt(9000);
    const homeFeet = { x: lead.home.x * TILE + 8, y: lead.home.y * TILE + 13 };
    assert.deepEqual([first.x, first.y], [homeFeet.x, homeFeet.y], 'from home, where it stood');
    assert.deepEqual([home.x, home.y], [homeFeet.x, homeFeet.y], 'which is where it was drawn standing');
    const spots = new Set([12000, 15000, 20000, 30000, 40000, 60000].map((t) => { const p = lead.positionAt(t); return `${p.x},${p.y}`; }));
    assert.ok(spots.size > 1, 'and then it wanders');
  } finally { dom.cleanup(); }
});

// ---------- the engine: the night, a chest, a hover ----------

test('the fight’s marks draw after the night’s tint and weather, so they read as clearly at night', async () => {
  const clock = manualClock();
  const { world, draws, done } = world4({ clock, motion: true });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    world.settle();
    const { view } = benchView(world.miloTile(), { actors: 16 });
    assert.equal(await run(clock, world.startCombat(view)), true);
    world.setSky({ tint: [40, 50, 110, 0.38], light: 0, night: true, weather: { kind: 'rain', density: 0.004, key: 'w' }, key: 'night' });
    draws.length = 0;
    clock.advance(40);
    const tags = lastFrame(draws).map((d) => d.image._milo);
    const sky = tags.lastIndexOf('sky');
    const num = tags.indexOf('num');
    assert.ok(sky >= 0 && num >= 0, 'rain and badge numbers are both drawn');
    assert.ok(num > sky, 'the badges come after the sky');
  } finally { done(); }
});

test('hideActors hides a chest by its loot id, from draws, hits and lists', async () => {
  const clock = manualClock();
  const { world, draws, done } = world4({ clock, width: 4000, height: 3000 });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const spec = testSpec(['neon'], 'open', 1);
    const prep = prepareElsewhere(spec, { riftgen: RIFTGEN, genres: CONTENT.genres, words: CONTENT.riftgen, kind: 'wild', roadLevel: 2, partySize: 3, rules: RULES, leads: CONTENT.combat.leads, foes: CONTENT.combat.foes, tuning: null, hooks: [] });
    await run(clock, world.enterElsewhere({ id: spec.id, key: null, kind: 'wild', spec, x: 34, y: -12, stage: spec.stage }, { layout: prep.layout, fight: { plan: prep.plan, encounters: prep.encounters } }));
    const chest = world.elsewhereEntities().find((e) => e.kind === 'loot');
    assert.ok(chest && chest.id.startsWith('loot:'), 'a chest to hide');
    // A frame's draws: the whole scene is in view, so the chest (and its shadow) are among them.
    const frame = () => { draws.length = 0; world.settle(); clock.advance(40); return draws.length; };
    frame();
    const shown = frame();
    world.hideActors([chest.id]);
    assert.equal(world.elsewhereEntities().some((e) => e.id === chest.id), false, 'it leaves the list');
    const hidden = frame();
    assert.ok(hidden < shown, `it isn’t drawn (${shown} draws → ${hidden})`);
    world.hideActors([]);
    assert.equal(world.elsewhereEntities().some((e) => e.id === chest.id), true, 'and comes back');
    assert.equal(frame(), shown, 'drawn again');
  } finally { done(); }
});

test('once a fight is over, leaving the canvas sends no stray hover', async () => {
  const { world, listeners, hovers, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const { view } = benchView(world.miloTile(), { actors: 12 });
    assert.equal(await world.startCombat(view), true);
    listeners.pointermove(pointAt(world, view.units.find((u) => u.side === 'foe')));
    assert.ok(hovers.length >= 1 && hovers.at(-1) !== null, 'a hover in the fight');
    await world.endCombat({});
    const seen = hovers.length;
    listeners.pointerleave({});
    assert.equal(hovers.length, seen, 'nothing after the fight');
  } finally { done(); }
});
