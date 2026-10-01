// The engine in Phase 4 (module J: src/world/engine.js's wiring, scene-combat.js, anim.js, follow.js,
// scene-camp.js, scene-sky.js, and the Phase 4 parts of scene-elsewhere.js, scene-rifts.js and
// scene-wilds.js). CONTRACT-PHASE4.md §11, §13 wave 2 J, §15.
// Run: node --test tests/engine4.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/world/engine.js';
import { MAP, TILE, placeById, isWalkable } from '../src/world/map.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { buildElsewhere } from '../src/world/elsewhere.js';
import { createPainter, numberRows } from '../src/world/scene-art.js';
import { createRiftLayer } from '../src/world/scene-rifts.js';
import { hashInts } from '../src/world/rng.js';
import { isFieldBoss, NO_FIGHT_MECHANICS, PUZZLE_GENRES } from '../src/world/fieldboss.js';
import { clipFrames, poseOps } from '../src/world/sprites-party.js';
import { timeline, beatKey, poseFrame, withLegs, clipInfo, clipFrame, actionClip, DEFAULT_TIMING } from '../src/world/anim.js';
import { FORMATIONS, formationSteps, standAround, stepToward } from '../src/world/follow.js';
import { createSkyLayer, weatherSpots, weatherOffset, WEATHER_TILE } from '../src/world/scene-sky.js';
import { benchView, boardOf, shadeAt, unitFeet, createCombatLayer, SWIPE_MARK, AREA_HATCH, CAUGHT_MARKS } from '../src/world/scene-combat.js';
import { INTENT_ICONS, FLASHES } from '../src/world/icons.js';
import { MOMENTS, campFrame } from '../src/world/scene-camp.js';
import { prepareElsewhere, prepareCave } from '../src/combat/encounters.js';
import { manualClock, fakeDom, flush, drive, testSpec } from './fakedom.js';
import { assertCalm } from './calm.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const CONTENT = Object.fromEntries(['genres', 'riftgen', 'fortress', 'wilds', 'story'].map((name) => [name, read(name)]));
CONTENT.combat = Object.fromEntries(['rules', 'leads', 'foes', 'anims'].map((name) => [name, read(`combat/${name}`)]));
const { anims: ANIMS, rules: RULES } = CONTENT.combat;
const RIFTGEN = createRiftgen({ words: CONTENT.riftgen, genres: CONTENT.genres });
const WILD_STATE = { day: 20000, tier: 1, wardRadius: 0, closed: [], lit: [], opened: [], felled: {} };
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => a.x === b.x && a.y === b.y;

// ---------- helpers ----------

/** A world with content (combat's too), recording every Phase 4 callback. */
function world4({ clock = null, motion = false, width = 1000, height = 700, start = null, content = CONTENT, media = null, ...options } = {}) {
  const dom = fakeDom({ clock, width, height });
  if (media) dom.canvas.ownerDocument.defaultView.matchMedia = () => media; // the system's reduced-motion query
  const ev = { cmds: [], hovers: [], menus: [], steps: [], moves: [], entities: [], crew: [], areas: [] };
  const world = createWorld(dom.canvas, {
    motion: typeof motion === 'function' ? motion : () => motion,
    content,
    startTile: start,
    onCombatCommand: (c) => ev.cmds.push(c),
    onCombatHover: (h) => ev.hovers.push(h),
    onContextMenu: (m) => ev.menus.push(m),
    onSceneStep: (s) => ev.steps.push(s),
    onMiloMove: (t) => ev.moves.push(t),
    onEntityClick: (e) => ev.entities.push(e),
    onCrewClick: (id) => ev.crew.push(id),
    onAreaChange: (info) => ev.areas.push(info),
    ...options,
  });
  if (content) world.setWildState(WILD_STATE);
  return { world, ev, ...dom, done: () => { world.dispose(); dom.cleanup(); } };
}

/** A wild rift made ready for fights: its spec, the rift record and prepareElsewhere's plan. */
function fightRift(genres = ['neon'], stage = 'open', salt = 0) {
  const spec = testSpec(genres, stage, salt);
  const rift = { id: spec.id, key: null, kind: 'wild', spec, x: 34, y: -12, stage: spec.stage };
  const prep = prepareElsewhere(spec, {
    riftgen: RIFTGEN, genres: CONTENT.genres, words: CONTENT.riftgen, kind: 'wild', roadLevel: 2, partySize: 3,
    rules: RULES, leads: CONTENT.combat.leads, foes: CONTENT.combat.foes, tuning: null, hooks: [],
  });
  return { spec, rift, prep, options: { layout: prep.layout, fight: { plan: prep.plan, encounters: prep.encounters } } };
}

const HEROES = [
  { id: 'milo', look: { kind: 'rig', rig: 'coat', who: 'milo', likeness: null }, name: 'Milo' },
  { id: 'claude', look: { kind: 'rig', rig: 'robe', who: 'claude', likeness: null }, name: 'The Scribe' },
  { id: 'codex', look: { kind: 'rig', rig: 'robe', who: 'codex', likeness: null }, name: 'The Artificer' },
];
const heroView = (h, at) => ({ id: h.id, side: 'party', rank: 'hero', talkKind: null, look: h.look, x: at.x, y: at.y, size: 1, facing: 'right', name: h.name, integrity: 20, max: 20, buffer: 0, offline: false, sorted: null, conditions: [], heat: 20, bar: null });
const foeView = (u) => ({ id: u.id, side: u.side, rank: u.rank, talkKind: u.talkKind, look: u.look, x: u.post.x, y: u.post.y, size: u.size, facing: 'left', name: u.name, integrity: u.integrity, max: u.maxIntegrity, buffer: 0, offline: false, sorted: null, conditions: [], heat: 20, bar: null });
/** A startCombat view for a room's fight: the heroes on its entry tiles, its foes at their posts. */
function viewOf(room) {
  const f = room.fight;
  return { arena: f.arena, units: [...HEROES.map((h, i) => heroView(h, f.arena.entry[i])), ...f.foes.map(foeView)], objects: f.objects, surfaces: f.surfaces, lights: [], telegraphs: [] };
}

/** The last whole frame drawn (each ends with the buffer scaled up onto the canvas). */
function lastFrame(draws) {
  const ends = draws.map((d, i) => (d.args.length === 8 && d.args[6] > d.args[2] ? i : -1)).filter((i) => i >= 0);
  if (!ends.length) return [];
  return draws.slice(ends.length > 1 ? ends.at(-2) + 1 : 0, ends.at(-1) + 1);
}
async function frame(world, draws) {
  draws.length = 0;
  world.resize();
  await wait(40);
  return lastFrame(draws);
}
const tagsOf = (list) => list.map((d) => d.image._milo).filter((t) => typeof t === 'string');
const sig = (list) => list.map((d) => `${d.image._milo || `${d.image.width}x${d.image.height}`}@${d.args.join(',')}@${d.alpha}`).join('|');

/** Walk the clock until `promise` settles (or the time runs out). → its value, or 'pending'. */
async function run(clock, promise, ms = 20000) {
  let value = 'pending';
  promise.then((v) => { value = v; });
  for (let t = 0; t < ms && value === 'pending'; t += 50) {
    clock.advance(50);
    await flush();
  }
  return value;
}

/** Walk the clock until check() is true. → whether it came true. */
async function until(clock, check, ms = 20000) {
  for (let t = 0; t < ms && !check(); t += 50) {
    clock.advance(50);
    await flush();
  }
  return !!check();
}

/** Move the pointer over a tile's feet (a few px up, on the sprite). */
const pointAt = (world, tile, dy = -6) => {
  const at = world.screenOfTile(tile);
  return { clientX: at.x, clientY: at.y + dy, button: 0, preventDefault() {} };
};

// ---------- the layer protocol ----------

test('the layer protocol runs in both scenes: ground, then the y-sort, then above; update on dt, settle and dispose', async () => {
  const { world, draws, done } = world4();
  const log = [];
  const probe = {
    ground: () => log.push('ground'),
    collect: (drawables) => { log.push('collect'); drawables.push({ y: -1e9, x: 0, draw: () => log.push('sorted') }); },
    above: (target, visible, t, view) => { log.push('above'); assert.ok(view && Number.isFinite(view.w), 'above is told the view'); },
    settle: () => log.push('settle'),
    dispose: () => log.push('dispose'),
  };
  try {
    const remove = world.addLayer(probe);
    await world.travelTo({ x: 30, y: -10 });
    for (const where of ['the wilds', 'an Elsewhere']) {
      if (where === 'an Elsewhere') assert.equal(await world.enterElsewhere(fightRift().rift), true);
      log.length = 0;
      await frame(world, draws);
      const order = ['ground', 'collect', 'sorted', 'above'].map((step) => log.indexOf(step));
      assert.ok(order.every((i) => i >= 0), `${where}: every hook ran (${log.join(', ')})`);
      assert.deepEqual([...order].sort((a, b) => a - b), order, `${where}: in order`);
    }
    remove();
    log.length = 0;
    await frame(world, draws);
    assert.deepEqual(log, [], 'a removed layer draws nothing');
    world.addLayer(probe);
  } finally { done(); }
  assert.ok(log.includes('dispose'), 'dispose reaches the layers');

  // update: on the tick's clamped dt; settle: when motion goes off (the watchdog).
  const clock = manualClock();
  let motion = true;
  const w = world4({ clock, motion: () => motion });
  const seen = [];
  try {
    w.world.addLayer({ update: (dt) => { seen.push(dt); return false; }, settle: () => seen.push('settle') });
    clock.advance(200);
    assert.ok(seen.length >= 3 && seen.every((dt) => dt > 0 && dt <= 100), `update gets each tick's dt (${seen.slice(0, 4)})`);
    clock.t += 60000; // a long gap with no frames (a hidden window): the next dt is clamped
    clock.advance(20);
    assert.ok(seen.at(-1) <= 100, 'the dt after a gap is clamped to 100 ms');
    motion = false;
    await wait(460);
    assert.ok(seen.includes('settle'), 'motion off settles the layers');
  } finally { w.done(); }
});

// ---------- combat is a mode ----------

test('combat mode refuses walks, travel, chops and scene changes, never walks on WASD, and forwards no keys', async () => {
  const { world, listeners, done } = world4();
  try {
    await world.travelTo({ x: 26, y: -6 });
    const tree = world.nearbyEntities().find((e) => e.kind === 'tree');
    assert.ok(tree, 'a tree nearby');
    assert.equal(world.mode(), 'explore');
    assert.equal(world.setMode('combat'), true);
    assert.equal(world.mode(), 'combat');
    const at = world.miloTile();
    assert.equal(await world.walkTo({ x: at.x + 2, y: at.y }), false, 'no walk');
    assert.equal(await world.walkToEntity(tree.id), false, 'no walk to an entity');
    assert.deepEqual(await world.chop(tree.id), { ok: false, kind: null }, 'no chop');
    assert.equal(await world.travelTo('home'), false, 'no travel');
    const { rift } = fightRift();
    assert.equal(await world.enterElsewhere(rift), false, 'no stepping through');
    assert.equal(await world.enterCave({ id: 'cave:1,1', kind: 'cave', seed: 1, x: 1, y: 1, stage: 'hairline', depth: 1 }), false, 'no cave');
    for (const key of ['w', 'a', 's', 'd', 'W', 'ArrowUp', 'ArrowLeft', 'Enter', ' ', 'm', 'A']) {
      let prevented = false;
      listeners.keydown({ key, preventDefault() { prevented = true; } });
      assert.equal(prevented, false, `${key} is left for the shell's key stack`);
    }
    assert.deepEqual(world.miloTile(), at, 'WASD never walks in a fight');
    assert.equal(world.setMode('explore'), true);
    assert.equal(await world.walkTo({ x: at.x + 1, y: at.y }), true, 'back to exploring, he walks');
    // In an Elsewhere, a fight keeps him in it.
    assert.equal(await world.enterElsewhere(rift), true);
    world.setMode('combat');
    assert.equal(await world.leaveElsewhere(), false, 'no leaving mid-fight');
    assert.equal(world.setMode('dancing'), false);
  } finally { done(); }
  // While a scene change fades out, neither the mode nor a fight may begin.
  const clock = manualClock();
  const w = world4({ clock, motion: true });
  try {
    const trip = w.world.travelTo({ x: 30, y: -10 });
    clock.advance(40);
    assert.equal(w.world.stats().changing, true);
    assert.equal(w.world.setMode('combat'), false, 'setMode is refused while changing');
    assert.equal(await w.world.startCombat(benchView({ x: 30, y: -10 }).view), false, 'startCombat is refused while changing');
    assert.equal(await run(clock, trip), true);
  } finally { w.done(); }
});

test('in a fight the pointer goes to onCombatCommand and onCombatHover, and a right-click only to onContextMenu', async () => {
  const { world, listeners, ev, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const { rift, prep, options } = fightRift();
    await world.enterElsewhere(rift, options);
    const room = prep.encounters.rooms[0];
    const view = viewOf(room);
    world.hideActors([`enc:${room.roomId}`]);
    assert.equal(await world.startCombat(view), true);
    const foe = view.units.find((u) => u.side === 'foe');
    listeners.pointermove(pointAt(world, foe));
    assert.deepEqual(ev.hovers.at(-1), { tile: { x: foe.x, y: foe.y }, unitId: foe.id }, 'hovering a unit names it');
    listeners.pointerdown({ ...pointAt(world, foe), shiftKey: true });
    assert.deepEqual(ev.cmds.at(-1), { kind: 'unit', tile: { x: foe.x, y: foe.y }, unitId: foe.id, shift: true, alt: false });
    const floor = view.arena.entry[3] || { x: view.arena.rect.x + 1, y: view.arena.rect.y + 1 };
    const moves = ev.moves.length;
    listeners.pointerdown({ ...pointAt(world, floor, 2), altKey: true });
    assert.equal(ev.cmds.at(-1).kind, 'tile');
    assert.equal(ev.cmds.at(-1).alt, true);
    assert.equal(ev.moves.length, moves, 'a click in a fight walks nobody');
    const cmds = ev.cmds.length;
    let prevented = false;
    listeners.contextmenu({ ...pointAt(world, foe), preventDefault() { prevented = true; } });
    assert.equal(prevented, true, 'the browser menu never opens');
    assert.equal(ev.cmds.length, cmds, 'a right-click never reaches onCombatCommand');
    assert.equal(ev.menus.at(-1).kind, 'combatant');
    assert.equal(ev.menus.at(-1).id, `cb:${foe.id}`);
    assert.deepEqual(ev.menus.at(-1).tile, { x: foe.x, y: foe.y });
    listeners.pointerleave({});
    assert.equal(ev.hovers.at(-1), null, 'leaving the canvas clears the hover');
  } finally { done(); }
});

test('combatants come first in both hit tests and in the entity lists', async () => {
  const { world, listeners, ev, done } = world4();
  try {
    // The wilds (a field boss's ground): a synthetic fight round Milo.
    await world.travelTo({ x: 30, y: -10 });
    const { view } = benchView(world.miloTile(), { actors: 12 });
    assert.equal(await world.startCombat(view), true);
    const near = world.nearbyEntities();
    const firstOther = near.findIndex((e) => e.kind !== 'combatant');
    const lastCombatant = near.map((e) => e.kind).lastIndexOf('combatant');
    assert.ok(lastCombatant >= 0 && (firstOther < 0 || lastCombatant < firstOther), 'the wilds: combatants lead the list');
    for (const u of view.units.slice(0, 5)) {
      listeners.contextmenu(pointAt(world, u));
      assert.equal(ev.menus.at(-1).id, `cb:${u.id}`, `the wilds: ${u.id} is hit first`);
    }
    await world.endCombat();
    assert.equal(world.nearbyEntities().some((e) => e.kind === 'combatant'), false, 'gone after the fight');
    // An Elsewhere, whose branch never reached the crew: combatants first there too.
    const { rift, prep, options } = fightRift(['gothic'], 'open', 3);
    await world.enterElsewhere(rift, options);
    const room = prep.encounters.rooms[0];
    const fight = viewOf(room);
    await world.startCombat(fight);
    const list = world.elsewhereEntities();
    const kinds = list.map((e) => e.kind);
    assert.ok(kinds.slice(0, fight.units.length).every((k) => k === 'combatant'), 'elsewhereEntities: combatants first');
    assert.equal(kinds.filter((k) => k === 'combatant').length, fight.units.length);
    assert.equal(world.nearbyEntities()[0].kind, 'combatant', 'nearbyEntities: combatants first');
    // A foe standing at its post, drawn over by its idle post actor: the combatant wins the hit.
    const foe = fight.units.find((u) => u.side === 'foe');
    listeners.contextmenu(pointAt(world, foe));
    assert.equal(ev.menus.at(-1).kind, 'combatant');
  } finally { done(); }
});

// ---------- hiding ----------

test('hidden actors vanish from draws, hits and lists; enc:<roomId> hides a whole room; party:<id> never hides a crew member', async () => {
  // A window wide enough to show the whole Elsewhere, so every post is in view.
  const { world, draws, listeners, ev, done } = world4({ width: 4000, height: 3000 });
  try {
    await world.travelTo({ x: 30, y: -10 });
    const { rift, prep, options } = fightRift(['neon'], 'open', 1);
    await world.enterElsewhere(rift, options);
    const ids = () => world.elsewhereEntities().map((e) => e.id);
    const posts = ids().filter((id) => id.startsWith('enc:'));
    assert.ok(posts.length >= 2, `the fight rooms' foes idle at their posts (${posts.length})`);
    const room = posts[0].split(':')[1];
    const before = tagsOf(await frame(world, draws)).filter((t) => t === 'enc').length;
    world.hideActors([`enc:${room}`]);
    assert.equal(ids().some((id) => id.startsWith(`enc:${room}:`)), false, 'the whole room leaves the list');
    assert.ok(ids().some((id) => id.startsWith('enc:') && !id.startsWith(`enc:${room}:`)), 'the other rooms stay');
    const after = tagsOf(await frame(world, draws)).filter((t) => t === 'enc').length;
    assert.equal(after, before - posts.filter((id) => id.startsWith(`enc:${room}:`)).length, 'and its posts are drawn no more');
    const one = posts.find((id) => !id.startsWith(`enc:${room}:`));
    world.hideActors([one]);
    assert.equal(ids().includes(one), false, 'one post by its own id');
    // A wandering stray and the Tale-lead object.
    world.hideActors([]);
    const stray = world.elsewhereEntities().find((e) => e.kind === 'stray' && !e.id.startsWith('enc:'));
    if (stray) {
      listeners.pointermove(pointAt(world, stray, -4));
      world.hideActors([stray.id]);
      assert.equal(ids().includes(stray.id), false, 'a wandering stray leaves the list');
      listeners.pointermove(pointAt(world, stray, -4));
      assert.notEqual(ev.menus.length === 0 ? null : ev.menus.at(-1)?.id, stray.id);
      listeners.contextmenu(pointAt(world, stray, -4));
      assert.notEqual(ev.menus.at(-1).id, stray.id, 'nor is it hit');
    }
    // Milo himself.
    world.hideActors([]);
    assert.ok(tagsOf(await frame(world, draws)).includes('outfit:milo'), 'Milo is drawn (in the genre\'s coat)');
    world.hideActors(['milo']);
    assert.equal(tagsOf(await frame(world, draws)).includes('outfit:milo'), false, 'hidden, he is not');
    world.hideActors([]);
  } finally { done(); }
  // A follower hidden by 'party:claude' while the crew member claude sits at the fire.
  const w = world4({ start: MAP.miloHome });
  try {
    w.world.setCrew([{ id: 'claude', state: 'done', label: 'Claude Code', count: 0 }]);
    w.world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }]);
    const kinds = () => w.world.keepClear().map((r) => r.id || r.kind);
    assert.ok(kinds().includes('party:claude') && kinds().includes('claude'), 'the follower and the crew member both keep clear');
    w.world.hideActors(['party:claude']);
    assert.ok(!kinds().includes('party:claude'), 'the follower is hidden');
    assert.ok(kinds().includes('claude'), 'the crew member is not');
    const seated = w.world.keepClear().find((r) => r.id === 'claude');
    w.listeners.pointerdown({ clientX: seated.x + seated.w / 2, clientY: seated.y + seated.h / 2, button: 0 });
    assert.equal(w.ev.crew.at(-1), 'claude', 'and still answers a click');
  } finally { w.done(); }
  // Trees in the wilds, by place id, for a fight there (felled is never touched).
  const t = world4();
  try {
    await t.world.travelTo({ x: 26, y: -6 });
    const tree = t.world.nearbyEntities().find((e) => e.kind === 'tree');
    t.world.hideActors([tree.id]);
    assert.equal(t.world.nearbyEntities().some((e) => e.id === tree.id), false, 'a hidden tree leaves the list');
    t.world.hideActors([]);
    assert.ok(t.world.nearbyEntities().some((e) => e.id === tree.id), 'and comes back');
  } finally { t.done(); }
});

// ---------- playback ----------

test('playback runs on the tick’s dt, holds while hidden, and resolves at once with motion off', async () => {
  const clock = manualClock();
  const { world, canvas, done } = world4({ clock, motion: true });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const { view } = benchView(world.miloTile(), { actors: 8 });
    const opened = await run(clock, world.startCombat(view));
    assert.equal(opened, true, 'the fight opens once its swirl and fade are done');
    const milo = view.units.find((u) => u.id === 'milo');
    const to = { x: milo.x + 3, y: milo.y };
    const events = [
      { t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'stride' } },
      { t: 'move', round: 1, tick: 1, unit: 'milo', by: null, path: [{ x: milo.x + 1, y: milo.y }, { x: milo.x + 2, y: milo.y }, to], how: 'stride' },
    ];
    let over = false;
    world.playEvents(events).then(() => { over = true; });
    clock.advance(200);
    await flush();
    assert.equal(over, false, 'three tiles take longer than 200 ms');
    // Hidden: the tick stops, and so does the playback, however long it's hidden.
    canvas.ownerDocument.hidden = true;
    clock.advance(5000);
    await flush();
    assert.equal(over, false, 'a hidden window holds the fight');
    clock.t += 100000; // absolute time runs on; playback never reads it
    canvas.ownerDocument.hidden = false;
    world.setPaused(false);
    clock.advance(40);
    await flush();
    assert.equal(over, false, 'coming back, it picks up where it was, not at the end');
    assert.equal(await until(clock, () => over, 2000), true, 'and ends on the clock');
    const cb = world.nearbyEntities().find((e) => e.id === 'cb:milo');
    assert.deepEqual({ x: cb.x, y: cb.y }, to, 'Milo stands where the move ended');
    // A step per call, as the driver resolves them: f0 and f3 (one kind) still take one beat, not two (the reviewer's 70 + 70 ms).
    const at = (id) => { const e = world.nearbyEntities().find((it) => it.id === `cb:${id}`); return { x: e.x, y: e.y }; };
    const stride = (id, n = 1) => { const p = at(id); return [{ t: 'act', round: 1, tick: 2, unit: id, action: { id: 'stride' } }, { t: 'move', round: 1, tick: 2, unit: id, by: null, path: [{ x: p.x, y: p.y + n }], how: 'stride' }]; };
    const timed = async (list) => { const t0 = clock.t; let n = 0; for (const p of list) p.then(() => { n += 1; }); await flush(); assert.equal(n, 0, 'nothing cut short'); await until(clock, () => n === list.length, 3000); return clock.t - t0; };
    const [a0, b0] = [at('f0'), at('f3')];
    const joined = await timed([world.playEvents(stride('f0')), world.playEvents(stride('f3'))]);
    assert.deepEqual([at('f0'), at('f3')], [{ x: a0.x, y: a0.y + 1 }, { x: b0.x, y: b0.y + 1 }]);
    const apart = await timed([world.playEvents(stride('f0', -1))]) + await timed([world.playEvents(stride('f3', -1))]);
    assert.ok(joined < apart, `one beat (${joined} ms), where awaiting each is two (${apart} ms)`);
    // A benchmark mid-playback lets the playback land first (its promise settles), and puts that board back.
    const p0 = at('f0');
    let landed = false;
    world.playEvents(stride('f0', 2)).then(() => { landed = true; });
    clock.advance(20);
    world.benchmark({ frames: 3, actors: 16 });
    await flush();
    assert.deepEqual([landed, at('f0')], [true, { x: p0.x, y: p0.y + 2 }]);
  } finally { done(); }
  // Motion off: at once, on the final frame.
  const w = world4();
  try {
    await w.world.travelTo({ x: 30, y: -10 });
    const { view } = benchView(w.world.miloTile(), { actors: 8 });
    await w.world.startCombat(view);
    const f0 = view.units.find((u) => u.id === 'f0');
    let over = false;
    const played = w.world.playEvents([
      { t: 'act', round: 1, tick: 1, unit: 'f0', action: { id: 'strike', target: { unit: 'milo' } } },
      { t: 'move', round: 1, tick: 1, unit: 'f0', by: null, path: [{ x: f0.x - 1, y: f0.y }], how: 'step' },
      { t: 'outcome', round: 1, tick: 1, unit: 'f0', target: 'milo', degree: 'crit', bars: [5, 80, 10, 5], k: 0 },
      { t: 'damage', round: 1, tick: 1, unit: 'f0', target: 'milo', amount: 9, kind: 'static', degree: 'crit', integrity: 11, max: 20 },
    ]).then(() => { over = true; });
    await flush();
    assert.equal(over, true, 'resolved at once');
    await played;
    const cb = w.world.nearbyEntities().find((e) => e.id === 'cb:f0');
    assert.deepEqual({ x: cb.x, y: cb.y }, { x: f0.x - 1, y: f0.y }, 'on its final tile');
  } finally { w.done(); }
});

test('a fight opens with the "noticed you" swirl and then the grid fading in; with motion off it opens at once', async () => {
  const clock = manualClock();
  const { world, draws, done } = world4({ clock, motion: true });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const { view } = benchView(world.miloTile(), { actors: 8 });
    let opened = false;
    world.startCombat(view).then((v) => { opened = v; });
    draws.length = 0;
    clock.advance(100);
    const early = lastFrame(draws);
    assert.ok(tagsOf(early).includes('fx'), 'the swirl is drawn over the foes');
    const grid = (list) => list.filter((d) => d.image._milo === 'overlay:grid').map((d) => d.alpha);
    assert.ok(grid(early).every((a) => a === 0), 'the grid waits for the swirl');
    clock.advance(700);
    const mid = grid(lastFrame(draws));
    assert.ok(mid.length && mid[0] > 0 && mid[0] < 1, `then fades in (${mid})`);
    await until(clock, () => opened, 3000);
    assert.equal(opened, true);
    draws.length = 0;
    clock.advance(40);
    assert.ok(grid(lastFrame(draws)).every((a) => a === 1), 'and stays');
  } finally { done(); }
  const w = world4();
  try {
    await w.world.travelTo({ x: 30, y: -10 });
    let opened = null;
    w.world.startCombat(benchView(w.world.miloTile(), { actors: 8 }).view).then((v) => { opened = v; });
    await flush();
    assert.equal(opened, true, 'motion off: open at once');
  } finally { w.done(); }
});

test('the timeline opens with the swirl over the foes that saw the party, and plays one kind’s strays as one beat', () => {
  const units = benchView({ x: 20, y: 20 }, { actors: 16 }).view.units;
  const opening = timeline([], { units, anims: ANIMS, rules: RULES, motion: true, opening: ['f0', 'f1'] });
  const start = opening.at(0);
  assert.deepEqual(start.effects.map((e) => e.effect), ['noticed', 'noticed'], 'the swirl, never a "!"');
  assert.equal(start.marks.length, 0);
  assert.deepEqual(start.effects.map((e) => [e.x, e.y]), ['f0', 'f1'].map((id) => { const u = units.find((it) => it.id === id); return [u.x, u.y]; }));
  assert.equal(start.grid, 0, 'the grid comes after');
  assert.equal(opening.at(opening.duration).grid, 1);
  assert.ok(opening.duration >= 900 && opening.duration <= 1200, `the opening takes about a second (${opening.duration})`);
  // f0 and f3 are both kind k0 (bench strays cycle k0, k1, k2); f1 is k1.
  const strike = (unit, target = 'milo') => [
    { t: 'act', round: 1, tick: 1, unit, action: { id: 'strike', target: { unit: target } } },
    { t: 'outcome', round: 1, tick: 1, unit, target, degree: 'hit', bars: [5, 80, 10, 5], k: 0 },
    { t: 'damage', round: 1, tick: 1, unit, target, amount: 3, kind: 'static', degree: 'hit', integrity: 17, max: 24 },
  ];
  const f3 = units.find((u) => u.id === 'f3');
  const f0 = units.find((u) => u.id === 'f0');
  assert.equal(f0.talkKind, f3.talkKind);
  const tl = timeline([...strike('f0'), ...strike('f3'), ...strike('f1')], { units, anims: ANIMS, rules: RULES, motion: true, fastFoes: true });
  const clipAt = (ms, id) => tl.at(ms).units[id].clip;
  assert.notEqual(clipAt(20, 'f0'), 'ready', 'f0 acts at once');
  assert.equal(clipAt(20, 'f3'), clipAt(20, 'f0'), 'and f3, the same kind, acts with it: one beat');
  assert.equal(clipAt(20, 'f1'), 'ready', 'f1, another kind, waits its turn');
  const beat = RULES.timing.strayBeat / 2;
  const f1Starts = [...Array(3000).keys()].find((ms) => clipAt(ms, 'f1') !== 'ready');
  assert.ok(f1Starts > 0 && f1Starts <= beat + 1, `the beat lasts at most half a stray beat with fast foes (${f1Starts} ≤ ${beat})`);
  const slow = timeline([...strike('f0'), ...strike('f3'), ...strike('f1')], { units, anims: ANIMS, rules: RULES, motion: true, fastFoes: false });
  assert.ok(slow.duration > tl.duration, 'fast foe turns are faster');
  const quick = timeline([...strike('f0'), ...strike('f3'), ...strike('f1')], { units, anims: ANIMS, rules: RULES, motion: true, speed: 2 });
  assert.ok(Math.abs(quick.duration - tl.duration / 2) <= 60, `2× playback halves it (${quick.duration} of ${tl.duration})`);
  // Events added to a playback (`from`, as playEvents does mid-play): a kind's strays still join the beat; nothing added jumps.
  const one = timeline(strike('f0'), { units, anims: ANIMS, rules: RULES, motion: true });
  const pair = [...strike('f0'), ...strike('f3')];
  assert.equal(timeline(pair, { units, anims: ANIMS, rules: RULES, motion: true, from: { index: 3, at: one.timeAt(0) } }).duration, one.duration, 'added as the beat starts, f3 joins it');
  const mid = Math.round(one.duration / 2);
  const late = timeline(pair, { units, anims: ANIMS, rules: RULES, motion: true, from: { index: 3, at: one.timeAt(mid) } });
  assert.deepEqual(late.at(mid).units.f0, one.at(mid).units.f0, 'what was playing plays on unchanged');
  assert.deepEqual([late.at(mid - 1).units.f3.clip === 'ready', late.at(mid + 20).units.f3.clip === 'ready'], [true, false], 'added part way through, f3 starts from now');
  assert.ok(Math.abs(late.duration - (mid + one.duration)) <= 1, `a beat from now (${late.duration} ms)`);
  // beatKey, for a caller that awaits each step and batches a beat's steps into one call.
  assert.equal(beatKey(strike('f0'), units), `1:1|${f0.talkKind}`);
  assert.equal(beatKey(strike('f3'), units), beatKey(strike('f0'), units), 'a kind’s strays in one tick share a beat');
  assert.notEqual(beatKey(strike('f1'), units), beatKey(strike('f0'), units), 'another kind doesn’t');
  assert.notEqual(beatKey(strike('f0').map((e) => ({ ...e, tick: 2 })), units), beatKey(strike('f3'), units), 'nor another tick');
  assert.equal(beatKey(strike('milo', 'f0'), units), null, 'a hero has none');
});

test('the timeline: a Critical holds the picture; reduced motion slides with still badges; motion off is the final frame; the numbers', () => {
  const units = benchView({ x: 20, y: 20 }, { actors: 8 }).view.units;
  const milo = units.find((u) => u.id === 'milo');
  const hit = (degree) => [
    { t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'strike', target: { unit: 'f0' } } },
    { t: 'outcome', round: 1, tick: 1, unit: 'milo', target: 'f0', degree, bars: [5, 80, 10, 5], k: 0 },
    { t: 'damage', round: 1, tick: 1, unit: 'milo', target: 'f0', amount: 7, kind: 'light', degree, integrity: 10, max: 17 },
  ];
  const plain = timeline(hit('hit'), { units, anims: ANIMS, rules: RULES, motion: true });
  const crit = timeline(hit('crit'), { units, anims: ANIMS, rules: RULES, motion: true });
  assert.equal(Math.round(crit.duration - plain.duration), RULES.timing.hitStop, 'a Critical adds its hit-stop');
  const flashAt = [...Array(Math.ceil(crit.duration)).keys()].find((ms) => crit.at(ms).units.f0.flash);
  assert.equal(crit.at(flashAt).units.f0.flash.kind, 'crit', 'with its flash');
  assert.ok(crit.at(flashAt + 1).flash > 0, 'and the ink flash');
  assert.deepEqual(crit.at(flashAt + 10).units.milo, crit.at(flashAt + 60).units.milo, 'the picture holds through the hit-stop');
  const big = crit.at(flashAt + 100).numbers.find((n) => n.unit === 'f0');
  assert.deepEqual([big.text, big.size, big.star, big.fill], ['7', 'big', true, 'u'], 'a Critical’s number is big, butter, with a star');
  const walk = [
    { t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'stride' } },
    { t: 'move', round: 1, tick: 1, unit: 'milo', path: [{ x: milo.x + 1, y: milo.y }, { x: milo.x + 2, y: milo.y }], how: 'stride' },
    ...hit('crit'),
  ];
  const reduced = timeline(walk, { units, anims: ANIMS, rules: RULES, motion: 'reduced' });
  const xs = new Set();
  const badges = new Set();
  for (let ms = 0; ms <= reduced.duration; ms += 10) {
    const f = reduced.at(ms);
    xs.add(f.units.milo.x);
    for (const u of Object.values(f.units)) if (u.flash) badges.add(`${u.flash.kind}:${u.flash.frame}`);
    assert.equal(f.effects.length, 0, 'no effects or particles');
    assert.equal(f.flash, 0, 'no ink flash');
    assert.deepEqual(f.shake, { dx: 0, dy: 0 }, 'no shake');
    assert.equal(f.units.milo.frame, clipFrame(clipInfo(milo.look, f.units.milo.clip, ANIMS), null, true), 'clips hold their still frame');
  }
  assert.ok(xs.size > 4, `but Milo slides from tile to tile (${xs.size} positions)`);
  assert.deepEqual([...badges], ['crit:1'], 'the outcome shows as a still badge: one frame, never animated (COMBAT §15)');
  const full = timeline(walk, { units, anims: ANIMS, rules: RULES, motion: true });
  assert.equal(Math.round(full.duration - reduced.duration), RULES.timing.hitStop, 'and there is no hit-stop');
  const still = timeline(walk, { units, anims: ANIMS, rules: RULES, motion: false });
  assert.equal(still.duration, 0);
  const end = still.at(0);
  assert.equal(end.done, true);
  assert.deepEqual([end.units.milo.x, end.units.milo.y], [milo.x + 2, milo.y], 'motion off: the final frame');
  assert.equal(end.numbers.length + end.effects.length, 0);
  assert.equal(still.events.length, walk.length, 'every event lands, at 0 ms');
  assert.ok(still.events.every((e) => e.at === 0));
  // COMBAT §14.4's numbers (the big 6×9 font, the smaller 4×6 for a Graze, a grey "miss"), and §15's still badge for each outcome.
  const seen = (tl, of) => { const out = new Set(); for (let ms = 0; ms <= tl.duration; ms += 5) for (const it of of(tl.at(ms))) out.add(it); return [...out]; };
  const numbers = (tl) => seen(tl, (f) => f.numbers.map((n) => `${n.text}/${n.size}/${n.fill}/${n.star}`));
  const flashes = (tl) => seen(tl, (f) => Object.values(f.units).filter((u) => u.flash).map((u) => `${u.flash.kind}:${u.flash.frame}`));
  const swing = (degree) => (degree === 'miss' ? hit('miss').slice(0, 2) : hit(degree));
  const patch = [{ t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'use', ability: 'patch-up' } }, { t: 'patch', round: 1, tick: 1, unit: 'milo', target: 'claude', amount: 5, integrity: 20, max: 24 }];
  for (const motion of [true, 'reduced']) {
    const tl = (events) => timeline(events, { units, anims: ANIMS, rules: RULES, motion });
    const want = { crit: '7/big/u/true', hit: '7/big/c/false', graze: '7/small/c/false', miss: 'miss/small/S/false' };
    for (const [degree, n] of Object.entries(want)) assert.deepEqual(numbers(tl(swing(degree))), [n], `${motion}: ${degree}`);
    assert.deepEqual(numbers(tl(patch)), ['+5/big/l/false'], `${motion}: a patch, green`);
    for (const degree of ['crit', 'graze', 'miss']) assert.deepEqual(flashes(tl(swing(degree))), motion === true ? [0, 1, 2].map((i) => `${degree}:${i}`) : [`${degree}:1`], `${motion}: ${degree}’s flash`);
  }
  assert.ok(numberRows('7', { size: 'small' }).length < numberRows('7', { size: 'big' }).length, 'the Graze’s font is the smaller');
});

test('timeline details: clips per action, Offline and Reboot, sorted strays leave, spawns arrive, swaps move together', () => {
  const units = benchView({ x: 20, y: 20 }, { actors: 8 }).view.units;
  const milo = units.find((u) => u.id === 'milo');
  const f0 = units.find((u) => u.id === 'f0');
  assert.equal(actionClip({ id: 'strike', target: { unit: 'f0' } }, milo, { target: f0 }).clip, 'ranged', 'a far Strike is ranged');
  assert.equal(actionClip({ id: 'strike' }, milo, { target: { x: milo.x + 1, y: milo.y } }).clip, 'melee');
  assert.equal(actionClip({ id: 'use', ability: 'scarf' }, milo).clip, 'scarf', 'Milo’s own clips');
  assert.equal(actionClip({ id: 'use', ability: 'mote' }, milo, { anims: ANIMS }).effect, 'mote', 'a spell brings its effect');
  assert.equal(actionClip({ id: 'brace' }, milo).clip, 'brace');
  const events = [
    { t: 'act', round: 1, tick: 2, unit: 'f0', action: { id: 'strike', target: { unit: 'claude' } } },
    { t: 'damage', round: 1, tick: 2, unit: 'f0', target: 'claude', amount: 20, kind: 'static', degree: 'hit', integrity: 0, max: 20 },
    { t: 'offline', round: 1, tick: 2, unit: 'claude' },
    { t: 'act', round: 1, tick: 3, unit: 'milo', action: { id: 'reboot', target: { unit: 'claude' } } },
    { t: 'reboot', round: 1, tick: 3, unit: 'claude', by: 'milo' },
    { t: 'act', round: 1, tick: 3, unit: 'codex', action: { id: 'strike', target: { unit: 'f1' } } },
    { t: 'sorted', round: 1, tick: 3, unit: 'f1', how: 'settled' },
    { t: 'spawn', round: 1, tick: 3, unit: { ...f0, id: 's0', x: f0.x, y: f0.y + 2 }, object: null },
    { t: 'act', round: 1, tick: 3, unit: 'milo', action: { id: 'use', ability: 'shuffle' } },
    { t: 'move', round: 1, tick: 3, unit: 'milo', by: 'milo', path: [{ x: 9, y: 9 }], how: 'swap' },
    { t: 'move', round: 1, tick: 3, unit: 'codex', by: 'milo', path: [{ x: milo.x, y: milo.y }], how: 'swap' },
  ];
  const tl = timeline(events, { units, anims: ANIMS, rules: RULES, motion: true });
  const clips = new Map();
  for (let ms = 0; ms <= tl.duration; ms += 5) {
    for (const [id, u] of Object.entries(tl.at(ms).units)) {
      if (!clips.has(id)) clips.set(id, new Set());
      clips.get(id).add(u.clip);
    }
  }
  for (const clip of ['hit', 'offline', 'dozing', 'reboot']) assert.ok(clips.get('claude').has(clip), `the Scribe plays ${clip}`);
  assert.ok(clips.get('f1').has('sorted'), 'a settled stray plays its settle');
  assert.equal(tl.final.f1.gone, true);
  assert.equal(tl.at(tl.duration).units.f1.alpha, 0, 'and is gone after');
  assert.equal(tl.at(0).units.s0.alpha, 0, 'a spawned clerk isn’t there before it arrives');
  assert.equal(tl.at(tl.duration).units.s0.alpha, 1, 'and is after');
  assert.equal(tl.final.claude.base, 'ready', 'rebooted, the Scribe is back to ready');
  const codex = units.find((u) => u.id === 'codex');
  const between = (u, a, b) => !(u.x === a.x && u.y === a.y) && !(u.x === b.x && u.y === b.y);
  const moving = [...Array(Math.ceil(tl.duration)).keys()].filter((ms) => { const f = tl.at(ms).units; return between(f.milo, milo, { x: 9, y: 9 }) && between(f.codex, codex, milo); });
  assert.ok(moving.length > 0, 'the two halves of a swap move at the same time');
  assert.deepEqual([tl.final.milo.x, tl.final.milo.y], [9, 9]);
  for (const ev of events) assert.ok(tl.events.some((e) => e.ev === ev), `${ev.t} lands on the board`);
  const times = tl.events.map((e) => e.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'in time order');
});

test('poseFrame moves rows, masks and anchors together, memoised; withLegs swaps leg rows in', () => {
  const frame = clipFrames({ kind: 'rig', rig: 'coat', who: 'milo', likeness: null }, 'ready', 'right')[0];
  const op = { op: 'nudge', dx: 2 };
  const moved = poseFrame(frame, op);
  assert.equal(moved, poseOps(frame, op), 'a rig frame goes through the rig’s own poseOps');
  assert.equal(poseFrame(frame, op), moved, 'the same object every time');
  assert.equal(poseFrame(frame, [op, { op: 'lift', dy: 1 }]), poseFrame(poseFrame(frame, op), { op: 'lift', dy: 1 }), 'a list runs in order');
  const plain = Object.freeze({ rows: Object.freeze(['.ab.', '.cd.', '....']), layers: Object.freeze(['.10.', '.00.', '....']), wear: null, anchors: Object.freeze({ head: Object.freeze([1, 0]) }), feet: [2, 2] });
  const lifted = poseFrame(plain, { op: 'lift', dy: 1 });
  assert.deepEqual([...lifted.rows], ['.cd.', '....', '....']);
  assert.deepEqual([...lifted.layers], ['.00.', '....', '....'], 'the layers move with the rows');
  assert.deepEqual([...lifted.anchors.head], [1, -1], 'and the anchors');
  const nudged = poseFrame(plain, { op: 'nudge', dx: 1 });
  assert.deepEqual([...nudged.rows], ['..ab', '..cd', '....']);
  assert.equal(poseFrame(plain, { op: 'nudge', dx: 1 }), nudged, 'memoised');
  assert.equal(Object.isFrozen(nudged) && Object.isFrozen(nudged.rows), true);
  assert.deepEqual(withLegs(['a', 'b', 'c', 'd'], ['X', 'Y']), ['a', 'b', 'X', 'Y']);
  assert.deepEqual(withLegs(['a', 'b', 'c', 'd'], ['X'], 1), ['a', 'X', 'c', 'd']);
  // Clip timing: a hero's from CLIP_TIMING, a stray's from its anims.json pose; still frames first or last.
  assert.equal(clipInfo({ kind: 'rig', rig: 'coat' }, 'melee').frames, 6);
  const walker = clipInfo({ kind: 'stray', archetype: 'walker' }, 'melee', ANIMS);
  assert.equal(walker.poseName, 'attack');
  assert.equal(clipFrame(walker, null, true), walker.still === 'last' ? walker.frames - 1 : 0);
  assert.equal(clipFrame({ fps: 10, frames: 4, loop: true, still: 'first' }, 450), 0, 'a loop wraps');
  assert.equal(clipFrame({ fps: 10, frames: 4, loop: false, still: 'last' }, 9000), 3, 'a one-shot holds its last');
  assert.deepEqual(DEFAULT_TIMING.effect, RULES.timing.effect, 'the fallback timing is rules.json’s');
});

// ---------- the board ----------

test('syncCombat puts a resumed board exactly where the view says, at once', async () => {
  const { world, draws, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const { view } = benchView(world.miloTile(), { actors: 16 });
    // A resume: no startCombat first. It enters the fight and lays the board down whole.
    world.syncCombat(view);
    assert.equal(world.mode(), 'combat');
    const where = () => Object.fromEntries(world.nearbyEntities().filter((e) => e.kind === 'combatant').map((e) => [e.id, [e.x, e.y]]));
    assert.deepEqual(where(), Object.fromEntries(view.units.map((u) => [`cb:${u.id}`, [u.x, u.y]])));
    const tags = tagsOf(await frame(world, draws));
    for (const tag of ['overlay:grid', 'overlay:light', 'overlay:surface', 'cb:o0', 'cb:o1']) assert.ok(tags.includes(tag), `${tag} is drawn`);
    // A later save: some moved, one sorted, one offline, the surfaces gone, the lights changed.
    const next = JSON.parse(JSON.stringify(view));
    next.units[0].x += 2;
    next.units[4].y -= 1;
    next.units[5].sorted = 'settled';
    next.units[1].offline = true;
    next.surfaces = [];
    next.lights = [];
    let pending = false;
    world.playEvents([{ t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'stride' } }]).then(() => { pending = true; });
    world.syncCombat(next);
    await flush();
    assert.equal(pending, true, 'anything playing settles');
    const expected = Object.fromEntries(next.units.filter((u) => !u.sorted).map((u) => [`cb:${u.id}`, [u.x, u.y]]));
    assert.deepEqual(where(), expected, 'every unit where the view says; the sorted one gone');
    const after = tagsOf(await frame(world, draws));
    assert.equal(after.includes('overlay:surface'), false, 'no surfaces left');
  } finally { done(); }
});

test('frameArena centres the arena in the free rect left by all four insets, and follows the cursor when it doesn’t fit', async () => {
  const { world, done } = world4({ width: 1280, height: 820 });
  try {
    await world.travelTo({ x: 30, y: -10 });
    const insets = { top: 44, right: 360, bottom: 210, left: 30 };
    world.setInsets(insets);
    const { view, overlay } = benchView({ x: 34, y: -12 }, { actors: 8 });
    await world.startCombat(view);
    const r = view.arena.rect;
    const k = world.scale;
    const corner = world.screenOfTile({ x: r.x, y: r.y });
    const centre = { x: corner.x + ((r.w * TILE) / 2 - 8) * k, y: corner.y + ((r.h * TILE) / 2 - 13) * k };
    const free = { x: insets.left + (1280 - insets.left - insets.right) / 2, y: insets.top + (820 - insets.top - insets.bottom) / 2 };
    assert.ok(Math.abs(centre.x - free.x) <= k && Math.abs(centre.y - free.y) <= k, `centred in the free rect (${centre.x}, ${centre.y} vs ${free.x}, ${free.y})`);
    // An arena that wouldn't fit at 3× beside the HUD is shown whole by stepping out to 2×, never below.
    const fitsAt3 = r.w * TILE * 3 <= 1280 - insets.left - insets.right && r.h * TILE * 3 <= 820 - insets.top - insets.bottom;
    assert.equal(k, fitsAt3 ? 3 : 2, 'the arena is shown whole: at 3×, or a step out when it would not fit');
    // A 12×9 lead arena fits at 3× at 1280×820 with the HUD (COMBAT §14.1), so the zoom comes back.
    world.frameArena({ x: r.x, y: r.y, w: 12, h: 9 });
    assert.equal(world.scale, 3);
    const c2 = world.screenOfTile({ x: r.x, y: r.y });
    assert.ok(c2.x >= insets.left && c2.y - 13 * 3 >= insets.top && c2.x + 12 * TILE * 3 <= 1280 - insets.right && c2.y + (9 * TILE - 13) * 3 <= 820 - insets.bottom, 'the whole lead arena is in view, clear of the HUD');
    // And when the fight ends the window's own zoom is back.
    world.frameArena(r);
    await world.endCombat();
    assert.equal(world.scale, 3, 'the window’s own zoom after the fight');
    await world.startCombat(view);
    world.frameArena(r);
    world.showOverlay(overlay);
  } finally { done(); }
  // A small window: the arena doesn't fit, so the view follows the tile cursor.
  const w = world4({ width: 700, height: 460 });
  try {
    await w.world.travelTo({ x: 30, y: -10 });
    const { view } = benchView({ x: 30, y: -10 }, { actors: 8 });
    const big = { ...view, arena: { ...view.arena, rect: { ...view.arena.rect, w: 20, h: 16 }, cells: '.'.repeat(320), height: '0'.repeat(320), light: 'L'.repeat(320) } };
    w.world.setInsets({ top: 40, right: 120, bottom: 160, left: 20 });
    await w.world.startCombat(big);
    const r = big.arena.rect;
    const inFree = (tile) => {
      const at = w.world.screenOfTile(tile);
      return at.x >= 20 && at.x <= 700 - 120 && at.y >= 40 && at.y <= 460 - 160;
    };
    for (const cursor of [{ x: r.x + 1, y: r.y + 1 }, { x: r.x + r.w - 2, y: r.y + r.h - 2 }, { x: r.x + 2, y: r.y + r.h - 1 }]) {
      w.world.showOverlay({ cursor });
      assert.ok(inFree(cursor), `the cursor at ${cursor.x},${cursor.y} stays in view`);
    }
    w.world.showOverlay({ selected: 'milo' });
    assert.ok(inFree(big.units[0]), 'with no cursor, the selected unit');
  } finally { w.done(); }
  // In an Elsewhere the clamp lets the arena sit above the bottom inset, near the scene's floor.
  const e = world4({ width: 1280, height: 820 });
  try {
    await e.world.travelTo({ x: 30, y: -10 });
    const { rift, prep, options } = fightRift(['noir'], 'open', 2);
    await e.world.enterElsewhere(rift, options);
    e.world.setInsets({ top: 40, right: 0, bottom: 260, left: 0 });
    const rooms = [...prep.encounters.rooms].sort((a, b) => (b.fight.arena.rect.y + b.fight.arena.rect.h) - (a.fight.arena.rect.y + a.fight.arena.rect.h));
    const room = rooms[0];
    await e.world.startCombat(viewOf(room));
    const r = room.fight.arena.rect;
    const bottom = e.world.screenOfTile({ x: r.x, y: r.y + r.h - 1 }).y + 3 * e.world.scale;
    assert.ok(bottom <= 820 - 260 + e.world.scale, `the arena's last row (${Math.round(bottom)}) sits above the planner`);
  } finally { e.done(); }
});

test('two still frames of a fight draw identical lists, and Milo and the followers are the combatants', async () => {
  const { world, draws, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }]);
    const { rift, prep, options } = fightRift(['iron'], 'open', 4);
    await world.enterElsewhere(rift, options);
    const before = tagsOf(await frame(world, draws));
    assert.ok(before.includes('outfit:milo') && before.includes('party:claude'), 'exploring: Milo and his follower');
    const room = prep.encounters.rooms[0];
    world.hideActors([`enc:${room.roomId}`]);
    await world.startCombat(viewOf(room));
    world.showOverlay(benchView({ x: 0, y: 0 }).overlay);
    const a = await frame(world, draws);
    const b = await frame(world, draws);
    assert.ok(a.length > 20);
    assert.equal(sig(a), sig(b), 'the same list, twice');
    const tags = tagsOf(a);
    assert.ok(tags.includes('overlay:grid') && tags.some((t) => t.startsWith('cb:')), 'the grid and the combatants');
    assert.equal(tags.includes('outfit:milo'), false, 'the engine’s own Milo steps aside for his combatant');
    assert.equal(tags.includes('party:claude'), false, 'and so does the follower');
    await world.endCombat({ place: { milo: world.miloTile() } });
    const after = tagsOf(await frame(world, draws));
    assert.ok(after.includes('outfit:milo') && after.includes('party:claude'), 'after the fight they are back');
    assert.equal(after.includes('overlay:grid'), false);
  } finally { done(); }
});

test('painter.made stays flat over 200 combat frames, idle loops and a replayed round included', async () => {
  const clock = manualClock();
  const { world, done } = world4({ clock, motion: true });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const { view, overlay } = benchView(world.miloTile(), { actors: 16 });
    await run(clock, world.startCombat(view));
    world.showOverlay(overlay);
    const f1 = view.units.find((u) => u.id === 'f1');
    const round = [
      { t: 'act', round: 1, tick: 1, unit: 'f1', action: { id: 'strike', target: { unit: 'milo' } } },
      { t: 'outcome', round: 1, tick: 1, unit: 'f1', target: 'milo', degree: 'crit', bars: [5, 80, 10, 5], k: 0 },
      { t: 'damage', round: 1, tick: 1, unit: 'f1', target: 'milo', amount: 7, kind: 'static', degree: 'crit', integrity: 13, max: 24 },
      { t: 'act', round: 1, tick: 2, unit: 'milo', action: { id: 'use', ability: 'mote', target: { unit: 'f1' } } },
      { t: 'damage', round: 1, tick: 2, unit: 'milo', target: 'f1', amount: 4, kind: 'light', degree: 'hit', integrity: 6, max: 10 },
    ];
    const back = round.map((e) => ({ ...e })); // the same round again: the same frames
    await run(clock, world.playEvents(round));
    clock.advance(3000); // every idle loop has turned over
    const made = world.stats().made;
    await run(clock, world.playEvents(back));
    for (let i = 0; i < 200; i += 1) clock.advance(34);
    assert.equal(world.stats().made, made, `no canvas built after the warm-up (${world.stats().made - made} new)`);
    assert.ok(f1);
  } finally { done(); }
});

test('the combat frame budget: world.benchmark draws 16 actors in at most 12 ms (the fake canvas’s ceiling)', async () => {
  const { world, draws, done } = world4({ width: 1280, height: 820 });
  try {
    await world.travelTo({ x: 30, y: -10 });
    world.benchmark({ frames: 30, actors: 16 }); // warm
    draws.length = 0;
    const result = world.benchmark({ frames: 200, actors: 16 });
    assert.equal(result.actors, 16);
    assert.equal(result.frames, 200);
    assert.ok(draws.filter((d) => typeof d.image._milo === 'string' && d.image._milo.startsWith('cb:')).length >= 200 * 3, 'it really drew combatants');
    assert.ok(result.median <= 12, `median ${result.median.toFixed(3)} ms`);
    assert.ok(result.p90 <= 12, `p90 ${result.p90.toFixed(3)} ms`);
    assert.equal(world.mode(), 'explore', 'nothing left behind');
    assert.equal(world.nearbyEntities().some((e) => e.kind === 'combatant'), false);
    // The legacy call still times plain frames.
    const plain = world.benchmark(10);
    assert.equal(plain.frames, 10);
  } finally { done(); }
});

// ---------- followers ----------

test('followers keep 2, 4 and 6 steps back (a formation sets how far), reset on every scene change, unchain and chain back, and a selected one walks instead of Milo', async () => {
  const clock = manualClock();
  const { world, ev, done } = world4({ clock, motion: true, start: { x: 20, y: 17 } });
  try {
    world.setParty(HEROES.slice(1).concat([{ id: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev' }, name: 'Jev' }]).map((m) => ({ id: m.id, look: m.look, name: m.name })));
    const tiles = () => Object.fromEntries(world.partyTiles().map((t) => [t.id, { x: t.x, y: t.y }]));
    const start = world.partyTiles();
    assert.deepEqual(start.map((t) => t.id), ['milo', 'party:claude', 'party:codex', 'party:jev'], 'Milo first, then followers as party:<id>');
    for (const t of start.slice(1)) assert.ok(!same(t, start[0]) && Math.abs(t.x - start[0].x) + Math.abs(t.y - start[0].y) <= 3, 'they stand round him');
    ev.steps.length = 0;
    const goal = { x: 44, y: 17 };
    assert.equal(await run(clock, world.walkTo(goal)), true);
    clock.advance(1500);
    const trail = [start[0], ...ev.steps.filter((s) => s.who === 'milo').map((s) => ({ x: s.x, y: s.y }))].reverse();
    assert.ok(trail.length > 8, `a long walk (${trail.length} tiles)`);
    const now = tiles();
    FORMATIONS.line.forEach((back, i) => {
      const id = ['party:claude', 'party:codex', 'party:jev'][i];
      assert.deepEqual(now[id], trail[back], `${id} stands where Milo stood ${back} steps ago`);
    });
    assert.ok(ev.steps.some((s) => s.who === 'claude'), 'followers’ steps are scene steps too');
    // Formations set the steps back: Loose is 3, 6 and 9 (an unknown one is ignored).
    world.setFormation('loose');
    world.setFormation('nonsense');
    const [from, walked] = [world.miloTile(), ev.steps.length];
    assert.equal(await run(clock, world.walkTo({ x: 24, y: 17 })), true);
    clock.advance(2500);
    const loose = [from, ...ev.steps.slice(walked).filter((s) => s.who === 'milo').map((s) => ({ x: s.x, y: s.y }))].reverse();
    assert.deepEqual([tiles()['party:claude'], tiles()['party:codex'], tiles()['party:jev']], [3, 6, 9].map((n) => loose[n]), 'Loose: three, six and nine steps back');
    world.setFormation('line');
    // Unchained, one stays put; chained back, it rejoins.
    assert.equal(world.chain('codex', false), true);
    assert.equal(world.chain('nobody', false), false);
    const left = tiles()['party:codex'];
    assert.equal(await run(clock, world.walkTo({ x: 44, y: 21 })), true);
    clock.advance(1500);
    assert.deepEqual(tiles()['party:codex'], left, 'unchained, the Artificer stays where she was left');
    // Selected, a floor click moves her, not Milo.
    world.selectMember('codex');
    const miloAt = world.miloTile();
    const spot = { x: left.x - 3, y: left.y };
    assert.equal(await run(clock, world.walkTo(spot)), true);
    assert.deepEqual(tiles()['party:codex'], spot, 'the selected follower walks');
    assert.deepEqual(world.miloTile(), miloAt, 'Milo stays');
    assert.equal(world.chain('codex', true), true);
    clock.advance(4000);
    const back = tiles()['party:codex'];
    assert.ok(Math.abs(back.x - miloAt.x) + Math.abs(back.y - miloAt.y) <= 8, `chained back, she rejoins the company (${back.x},${back.y})`);
    // A trip: everyone stands round Milo again, chained.
    world.chain('jev', false);
    assert.equal(await run(clock, world.travelTo({ x: 30, y: -10 })), true);
    const after = world.partyTiles();
    for (const t of after.slice(1)) assert.ok(Math.abs(t.x - after[0].x) + Math.abs(t.y - after[0].y) <= 3, `${t.id} was reset beside Milo`);
    const jevBefore = tiles()['party:jev'];
    await run(clock, world.walkTo({ x: after[0].x + 6, y: after[0].y }));
    clock.advance(1500);
    assert.notDeepEqual(tiles()['party:jev'], jevBefore, 'the trip chained Jev again');
    // Formations: the steps back change.
    assert.deepEqual(formationSteps('line'), [2, 4, 6]);
    assert.deepEqual(formationSteps('nonsense'), [2, 4, 6]);
    assert.equal(formationSteps('wedge', 4).length, 4);
    world.setParty([]);
    assert.deepEqual(world.partyTiles().map((t) => t.id), ['milo']);
  } finally { done(); }
});

test('follow’s pure helpers: standing round a tile, and stepping one axis at a time', () => {
  const open = (x, y) => !(x === 5 && y === 4);
  const spots = standAround({ x: 5, y: 5 }, 3, open, { dir: 'down' });
  assert.equal(spots.length, 3);
  assert.ok(spots.every((t) => !same(t, { x: 5, y: 5 }) && open(t.x, t.y)));
  assert.equal(new Set(spots.map((t) => `${t.x},${t.y}`)).size, 3);
  assert.deepEqual(standAround({ x: 0, y: 0 }, 2, () => false), []);
  const step = stepToward({ x: 0, y: 0 }, { x: 10, y: 4 }, 6);
  assert.deepEqual([step.x, step.y, step.used, step.dir], [6, 0, 6, 'right']);
});

test('setSneak halves everyone’s speed, and a scene change ends it', async () => {
  const clock = manualClock();
  const { world, done } = world4({ clock, motion: true, start: { x: 20, y: 17 } });
  const timed = async (to) => { // → how long a walk to `to` takes (ms, in 20 ms steps)
    let [ms, over] = [0, false];
    world.walkTo(to).then(() => { over = true; });
    for (; !over && ms < 20000; ms += 20) { clock.advance(20); await flush(); }
    return ms;
  };
  try {
    const normal = await timed({ x: 30, y: 17 });
    world.setSneak(true);
    const sneaking = await timed({ x: 20, y: 17 });
    assert.ok(Math.abs(sneaking / normal - 2) < 0.25, `sneaking takes twice as long (${sneaking} ms vs ${normal} ms)`);
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const here = world.miloTile();
    world.setSneak(false);
    const plain = await timed({ x: here.x + 10, y: here.y });
    world.setSneak(true);
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const afterTrip = await timed({ x: here.x + 10, y: here.y });
    assert.ok(Math.abs(afterTrip / plain - 1) < 0.1, `the trip ended the sneak (${afterTrip} ms, as ${plain} ms unsneaking)`);
  } finally { done(); }
});

test('keepClear’s pins hold with no party, and a party adds its own rects', () => {
  const { world, done } = world4({ start: MAP.miloHome });
  try {
    world.setCrew([
      { id: 'claude', state: 'done', label: 'Claude', count: 1 },
      { id: 'codex', state: 'needs-you', label: 'Codex', count: 1 },
      { id: 'jev', state: 'idle', label: 'Jev', count: 0 },
    ]);
    world.setSky({ tint: [40, 50, 110, 0.38], light: 0, night: true, weather: { kind: 'rain', density: 0.004, key: 'w' }, key: 'night' });
    world.setCamp({ night: true, members: [{ id: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev' }, seat: 0, pose: 'sleep' }], props: ['handcart'] });
    const kinds = () => world.keepClear().map((rect) => rect.id || rect.kind).sort();
    assert.deepEqual(kinds(), ['campfire', 'claude', 'codex', 'jev', 'milo'], 'Phase 3’s pin, with the sky and camp on');
    world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }, { id: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev' }, name: 'Jev' }]);
    assert.deepEqual(kinds(), ['campfire', 'claude', 'codex', 'jev', 'milo', 'party:claude', 'party:jev']);
    assert.ok(world.keepClear().filter((r) => r.kind === 'party').every((r) => r.w > 0 && r.h > 0));
    world.setParty([]);
    assert.deepEqual(kinds(), ['campfire', 'claude', 'codex', 'jev', 'milo']);
  } finally { done(); }
});

// ---------- the scenes ----------

test('onSceneStep fires for every step inside Elsewheres (and caves), for Milo and followers; onMiloMove still never does', async () => {
  const clock = manualClock();
  const { world, ev, done } = world4({ clock, motion: true });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const { rift } = fightRift();
    await run(clock, world.enterElsewhere(rift));
    world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }]);
    ev.steps.length = 0;
    const moves = ev.moves.length;
    const exit = world.elsewhereEntities().find((e) => e.kind === 'stitch');
    await run(clock, world.walkToEntity(exit.id));
    clock.advance(1000);
    assert.ok(ev.steps.length > 1, 'steps inside');
    assert.ok(ev.steps.every((s) => s.scene === 'elsewhere' && s.sceneId === rift.id), 'each names the scene');
    assert.ok(ev.steps.some((s) => s.who === 'milo') && ev.steps.some((s) => s.who === 'claude'), 'Milo and his follower');
    assert.equal(ev.moves.length, moves, 'onMiloMove is unchanged: nothing inside is saved');
    await run(clock, world.leaveElsewhere());
    ev.steps.length = 0;
    const here = world.miloTile();
    await run(clock, world.walkTo({ x: here.x + 2, y: here.y }));
    assert.ok(ev.steps.length && ev.steps.every((s) => s.scene === 'world' && s.sceneId === null), 'in the world too');
    // A cave: kind 'cave', its id as caveId.
    const cave = { id: 'cave:40,-14', seed: 12345, kind: 'cave', x: 40, y: -14, tier: 2, depth: 1, stage: 'hairline', region: 'whisperwood', name: 'A cave in the Whisperwood', genres: [], affixes: [], strays: [], taleLead: null, loot: [], creatures: [], day: 20000 };
    assert.equal(await run(clock, world.enterCave(cave)), true);
    assert.deepEqual(world.elsewhere(), { riftId: null, caveId: cave.id, depth: 1, name: cave.name });
    assert.equal(world.area().area, 'elsewhere');
    assert.equal(world.area().cave, true);
    assert.equal(world.elsewhereEntities().some((e) => e.kind === 'stitch' || e.kind === 'tale-lead'), false, 'no seam, no lead');
    ev.steps.length = 0;
    const inside = world.miloTile();
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: inside.x + dx, y: inside.y + dy })).find((t) => world.isWalkable(t.x, t.y));
    await run(clock, world.walkTo(open));
    assert.ok(ev.steps.some((s) => s.scene === 'cave' && s.sceneId === cave.id));
    assert.equal(await world.enterCave(cave), false, 'not from inside another scene');
  } finally { done(); }
});

test('a cave made ready (prepareCave) stands its foes at their posts', async () => {
  const { world, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const cave = { id: 'cave:40,-14', seed: 777, kind: 'cave', x: 40, y: -14, tier: 2, depth: 1, stage: 'hairline', region: 'whisperwood', name: 'A cave in the Whisperwood', genres: [], affixes: [], strays: [], taleLead: null, loot: [], creatures: ['murmurs', 'fetchfoxes'], day: 20000 };
    const layout = RIFTGEN.layout({ seed: cave.seed, stage: cave.stage, depth: cave.depth, affixes: [] });
    const prep = prepareCave(cave, { layout, roadLevel: 1, partySize: 3, rules: RULES, foes: CONTENT.combat.foes, words: CONTENT.riftgen, day: 20000, genres: CONTENT.genres });
    assert.equal(await world.enterCave(cave, { layout: prep.layout, fight: { plan: prep.plan, encounters: prep.encounters } }), true);
    const posts = world.elsewhereEntities().filter((e) => e.id.startsWith('enc:'));
    assert.ok(posts.length > 0, `posts in the cave (${posts.length})`);
  } finally { done(); }
});

test('enterElsewhere(rift) with no options is exactly Phase 3’s scene', async () => {
  const spec = testSpec(['frontier'], 'gaping', 2);
  const rift = { id: spec.id, key: null, kind: 'wild', spec, x: 34, y: -12, stage: spec.stage };
  const phase3 = buildElsewhere(spec, RIFTGEN.layout(spec), { genres: CONTENT.genres, kind: 'wild', words: CONTENT.riftgen });
  const expected = [...phase3.objects.filter((o) => !o.scenery).map((o) => o.id), ...phase3.strays.map((s) => s.id)].sort();
  const lists = [];
  for (const options of [undefined, {}]) {
    const { world, draws, done } = world4();
    try {
      await world.travelTo({ x: 30, y: -10 });
      assert.equal(options ? await world.enterElsewhere(rift, options) : await world.enterElsewhere(rift), true);
      const ids = world.elsewhereEntities().map((e) => e.id).sort();
      assert.deepEqual(ids, expected, 'the same objects and strays, no posts, props or nook');
      lists.push(sig(await frame(world, draws)));
    } finally { done(); }
  }
  assert.equal(lists[0], lists[1], 'and the same picture');
});

// ---------- the sky ----------

/** A fake DOM whose canvases also record their fills (fillRect with its style and alpha). */
const recordingWorld = (options = {}) => world4({ ...options, content: null });

test('renderMap is untinted and identical to the vale alone, whatever the sky, camp and party', async () => {
  const valeDraws = (world, draws) => {
    draws.length = 0;
    world.renderMap(1);
    return draws.map((d) => `${d.image.width}x${d.image.height}@${d.args.join(',')}`).join('|');
  };
  const alone = recordingWorld({ start: MAP.miloHome });
  const plain = valeDraws(alone.world, alone.draws);
  alone.done();
  const fills = [];
  const { world, draws, canvas, done } = world4({ start: MAP.miloHome });
  try {
    // Record every fill the vale's picture makes.
    const doc = canvas.ownerDocument;
    const make = doc.createElement.bind(doc);
    doc.createElement = () => {
      const el = make();
      const ctx = el.getContext('2d');
      const state = { fillStyle: null, globalAlpha: 1 };
      const wrapped = new Proxy(ctx, {
        get(target, prop) {
          if (prop === 'fillRect') return (...args) => fills.push({ style: state.fillStyle, alpha: state.globalAlpha, args });
          if (prop in state) return state[prop];
          return target[prop];
        },
        set(target, prop, value) {
          if (prop in state) state[prop] = value;
          target[prop] = value;
          return true;
        },
      });
      el.getContext = () => wrapped;
      return el;
    };
    world.setSky({ tint: [40, 50, 110, 0.38], light: 0, night: true, weather: { kind: 'snow', density: 0.003, key: 'c' }, key: 'night' });
    world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }]);
    world.setCamp({ night: true, members: [{ id: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev' }, seat: 1, pose: 'sit' }], props: ['breather-tea'] });
    assert.equal(valeDraws(world, draws), plain, 'the same draw list as the vale-only world');
    assert.equal(fills.some((f) => f.style === 'rgb(40,50,110)'), false, 'no tint in the picture');
  } finally { done(); }
});

test('the sky tints the live view and lets the night’s lights through, never repainting a chunk', async () => {
  const clock = manualClock();
  const { world, draws, done } = world4({ clock, motion: true });
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    world.settle();
    clock.advance(100);
    const chunks = (list) => list.filter((d) => typeof d.image._milo === 'string' && d.image._milo.startsWith('chunk:')).map((d) => d.image);
    draws.length = 0;
    clock.advance(40);
    const day = lastFrame(draws);
    const stats = world.stats();
    world.setSky({ tint: [40, 50, 110, 0.38], light: 0, night: true, weather: { kind: 'rain', density: 0.004, key: 'w' }, key: 'night' });
    draws.length = 0;
    clock.advance(40);
    const night = lastFrame(draws);
    assert.deepEqual(chunks(night), chunks(day), 'the very same chunk canvases, not repainted');
    assert.equal(world.stats().canvases, stats.canvases);
    assert.equal(world.stats().made, stats.made, 'the painter made nothing for the sky');
    assert.ok(night.some((d) => d.image._milo === 'sky'), 'the rain is drawn');
    assert.ok(night.length > day.length, 'and the lights come through');
    world.setSky(null);
    draws.length = 0;
    clock.advance(40);
    assert.equal(lastFrame(draws).some((d) => d.image._milo === 'sky'), false, 'a clear sky draws nothing');
  } finally { done(); }
});

test('the sky’s budgets: its tint at most 0.3 ms and its weather at most 1 ms a frame (median)', () => {
  const noop = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const makeCanvas = (w, h) => ({ width: w, height: h, getContext: () => ({ createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} }) });
  const sky = createSkyLayer({ makeCanvas, lights: () => Array.from({ length: 12 }, (_, i) => ({ x: i * 30, y: 100, r: 16, alpha: 0.8 })), glow: () => ({ width: 32, height: 32 }) });
  sky.setSky({ tint: [40, 50, 110, 0.38], light: 0, night: true, weather: { kind: 'rain', density: 0.01, key: 'w' }, key: 'x' });
  const view = { x: -300, y: 200, w: 427, h: 274 };
  const median = (fn) => {
    for (let i = 0; i < 50; i += 1) fn(i);
    const times = [];
    for (let i = 0; i < 300; i += 1) {
      const t0 = performance.now();
      fn(i);
      times.push(performance.now() - t0);
    }
    return times.sort((a, b) => a - b)[150];
  };
  const tint = median(() => sky.tint(noop, view, 1000));
  const weather = median((i) => sky.above(noop, () => true, 1000 + i * 33, view));
  assert.ok(tint <= 0.3, `tint ${tint.toFixed(4)} ms`);
  assert.ok(weather <= 1, `weather ${weather.toFixed(4)} ms`);
  // Weather is seeded and moves only with time; at t === null it isn't drawn.
  assert.deepEqual(weatherSpots('rain', 0.004), weatherSpots('rain', 0.004));
  assert.equal(weatherSpots('rain', 0.004).length, Math.round(WEATHER_TILE * WEATHER_TILE * 0.004));
  assert.notDeepEqual(weatherOffset('rain', 0), weatherOffset('rain', 500));
  let drawn = 0;
  sky.above({ drawImage: () => { drawn += 1; } }, () => true, null, view);
  assert.equal(drawn, 0, 'still frames have no weather');
});

// ---------- the camp, moments and landmarks ----------

test('the camp sits the company round the fire (crew keep their seats), and moments play on the clock', async () => {
  assert.equal(MAP.slots.campfire.length, 5, 'the fire’s five seats are unchanged');
  const camp = placeById('camp');
  const seats = MAP.slots.camp4;
  assert.equal(seats.length, 8);
  assert.equal(new Set(seats.map((s) => `${s.x},${s.y}`)).size, 8);
  for (const s of seats) {
    assert.ok(s.x >= camp.area.x && s.y >= camp.area.y && s.x < camp.area.x + camp.area.w && s.y < camp.area.y + camp.area.h, 'in the camp');
    assert.ok(isWalkable(s.x, s.y), 'on open ground');
    assert.ok(!MAP.slots.campfire.some((c) => same(c, s)) && !same(s, MAP.miloHome), 'off the crew’s seats and Milo’s spot');
  }
  const { world, draws, done } = world4({ start: MAP.miloHome });
  try {
    world.setCrew([{ id: 'claude', state: 'done', label: 'Claude Code', count: 0 }]);
    world.setCamp({
      night: true,
      members: [
        { id: 'claude', look: HEROES[1].look, seat: 0, pose: 'sit' },
        { id: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev' }, seat: 1, pose: 'sleep', bubble: true },
        { id: 'reg-a1', look: { kind: 'stray', archetype: 'walker', bodyKey: 'e', parts: [], eyeKey: null, genres: ['neon', null], scale: 1 }, seat: 2, pose: 'talk' },
        { id: 'codex', look: HEROES[2].look, seat: 3, pose: 'stand' },
      ],
      props: ['handcart', 'breather-tea', 'nonsense'],
    });
    const tags = tagsOf(await frame(world, draws));
    for (const tag of ['camp:jev', 'camp:reg-a1', 'camp:codex', 'camp:handcart', 'camp:breather-tea', 'camp:bedroll']) assert.ok(tags.includes(tag), `${tag} is drawn`);
    assert.equal(tags.includes('camp:claude'), false, 'Claude sits on the crew’s bench, not twice');
    const again = await frame(world, draws);
    assert.equal(sig(again), sig(lastFrame(draws)), 'still frames repeat');
    world.setCamp(null);
    assert.equal(tagsOf(await frame(world, draws)).some((t) => t.startsWith('camp:')), false);
    // Moments: at once with motion off.
    let over = false;
    world.playMoment('lantern-rise', { x: 31, y: 21 }).then(() => { over = true; });
    await flush();
    assert.equal(over, true);
    assert.equal(await world.playMoment('fireworks', { x: 1, y: 1 }), undefined, 'an unknown moment is a calm no-op');
  } finally { done(); }
  const clock = manualClock();
  const w = world4({ clock, motion: true, start: MAP.miloHome });
  try {
    for (const kind of Object.keys(MOMENTS)) {
      let over = false;
      w.world.playMoment(kind, { x: 31, y: 21 }).then(() => { over = true; });
      clock.advance(MOMENTS[kind] - 200);
      await flush();
      assert.equal(over, false, `${kind} is still playing`);
      clock.advance(400);
      await flush();
      assert.equal(over, true, `${kind} ends after ${MOMENTS[kind]} ms`);
    }
  } finally { w.done(); }
  assert.equal(campFrame('camp-sit', null), 0, 'a still frame');
});

test('landmarks: the Last Bridge over its deck and the Tollkeeper at its stand, as entities', async () => {
  const { world, draws, listeners, ev, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const deck = [{ x: 33, y: -12 }, { x: 34, y: -12 }, { x: 35, y: -12 }];
    world.setLandmarks([
      { id: 'landmark:last-bridge', kind: 'last-bridge', x: 34, y: -12, deck, dir: 'h', label: 'The Last Bridge', dry: true },
      { id: 'landmark:tollkeeper', kind: 'tollkeeper', x: 32, y: -11, deck: null, dir: 'h', label: 'The Tollkeeper', dry: true },
      { id: 'landmark:tollkeeper', kind: 'tollkeeper', x: 1, y: 1 },
      null,
    ]);
    const marks = world.nearbyEntities().filter((e) => e.kind === 'landmark');
    assert.deepEqual(marks.map((e) => e.id).sort(), ['landmark:last-bridge', 'landmark:tollkeeper']);
    for (const m of marks) assertCalm(m.label, m.id);
    const tags = tagsOf(await frame(world, draws));
    assert.ok(tags.includes('landmark:last-bridge') && tags.includes('landmark:tollkeeper'));
    listeners.contextmenu(pointAt(world, { x: 32, y: -11 }, -10));
    assert.equal(ev.menus.at(-1).id, 'landmark:tollkeeper', 'right-click the Tollkeeper');
    assert.equal(await world.walkToEntity('landmark:tollkeeper'), true, 'and walk to him');
    assert.equal(ev.entities.at(-1).id, 'landmark:tollkeeper');
    world.hideActors(['landmark:tollkeeper']);
    assert.equal(world.nearbyEntities().some((e) => e.id === 'landmark:tollkeeper'), false);
  } finally { done(); }
});

test('a field boss roams its bleed with its sight ring drawn softly, and goes by its shown name', () => {
  let rift = null;
  for (let i = 0; i < 4000 && !rift; i += 1) {
    const spec = RIFTGEN.wildRift({ seed: hashInts(7, i, 'test-boss'), tier: 5, depth: 3, weights: { gothic: 3, noir: 3, void: 2 } });
    const r = { id: spec.id, key: null, kind: 'wild', spec, x: 60, y: -60, stage: spec.stage, held: null };
    if (spec.stage === 'gaping' && spec.taleLead && !NO_FIGHT_MECHANICS.includes(spec.taleLead.mechanic) && !PUZZLE_GENRES.includes(spec.taleLead.genre)) rift = r;
  }
  assert.ok(rift && isFieldBoss(rift));
  const dom = fakeDom({});
  const painter = createPainter((w, h) => { const c = dom.canvas.ownerDocument.createElement('canvas'); c.width = w; c.height = h; return c; });
  let hidden = new Set();
  const layer = createRiftLayer({ genres: CONTENT.genres, words: CONTENT.riftgen, painter, hidden: (id) => hidden.has(id), leads: CONTENT.combat.leads, rules: RULES });
  layer.setWild('3,-3', [rift]);
  const lead = layer.actorsFor(rift).find((a) => a.lead);
  assert.equal(lead.roams, true, 'it roams');
  const spots = new Set([0, 3000, 6000, 9000, 12000, 20000, 30000].map((t) => { const p = lead.positionAt(t); return `${p.x},${p.y}`; }));
  assert.ok(spots.size > 1, 'and moves');
  const home = lead.positionAt(null);
  assert.deepEqual([home.x, home.y], [lead.home.x * TILE + 8, lead.home.y * TILE + 13], 'standing at home in a still frame');
  const drawn = [];
  const target = { drawImage: (image) => drawn.push(image._milo), set globalAlpha(v) {}, get globalAlpha() { return 1; } };
  layer.collect([], target, () => true, null, () => {});
  assert.ok(drawn.includes('sight'), 'its sight ring is drawn');
  hidden = new Set([lead.id]);
  drawn.length = 0;
  const drawables = [];
  layer.collect(drawables, target, () => true, null, () => {});
  assert.equal(drawn.includes('sight'), false, 'hidden for a fight, no ring');
  assert.equal(layer.entities({ x0: 40, y0: -80, x1: 80, y1: -40 }, null).some((e) => e.id === lead.id), false, 'nor listed');
  dom.cleanup();
});

// ---------- the calls without content, and the copy ----------

test('with no content every Phase 4 call is a calm no-op', async () => {
  const { world, done } = world4({ content: null, start: MAP.miloHome });
  try {
    world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }]);
    world.setFormation('pairs');
    assert.deepEqual(world.partyTiles(), [{ id: 'milo', ...MAP.miloHome }]);
    assert.equal(world.chain('claude', false), false);
    world.selectMember('claude');
    world.setSneak(true);
    world.hideActors(['milo']);
    world.hideActors([]);
    assert.equal(await world.startCombat(benchView(MAP.miloHome).view), false);
    world.syncCombat(benchView(MAP.miloHome).view);
    assert.equal(await world.playEvents([]), undefined);
    world.showOverlay({ cursor: { x: 1, y: 1 } });
    assert.equal(await world.endCombat({}), undefined);
    world.setSky({ tint: [0, 0, 0, 0.5] });
    world.setLandmarks([]);
    world.setCamp({ members: [] });
    assert.equal(await world.enterCave({ kind: 'cave' }), false);
    assert.equal(await world.playMoment('pen', { x: 1, y: 1 }), undefined);
    assert.equal(world.benchmark({ frames: 5 }).frames, 0);
    assert.deepEqual(world.screenOfTile({ x: 31, y: 22 }), world.screenOfTile({ x: 31, y: 22 }));
    assert.equal(world.screenOfTile(null), null);
    assert.equal(world.mode(), 'explore');
    assert.equal(world.setMode('combat'), true, 'the mode itself still switches');
    assert.equal(await world.walkTo({ x: 30, y: 22 }), undefined, 'a walk in combat settles as the vale alone does');
    world.setMode('explore');
  } finally { done(); }
});

test('a right-click outside a fight names what’s under the pointer, the ground included', async () => {
  const { world, listeners, ev, done } = world4({ start: MAP.miloHome });
  try {
    world.setCrew([{ id: 'claude', state: 'done', label: 'Claude Code', count: 0 }]);
    world.setParty([{ id: 'codex', look: HEROES[2].look, name: 'The Artificer' }]);
    const seated = world.keepClear().find((r) => r.id === 'claude');
    listeners.contextmenu({ clientX: seated.x + seated.w / 2, clientY: seated.y + seated.h / 2, preventDefault() {} });
    assert.equal(ev.menus.at(-1).kind, 'crew');
    assert.equal(ev.menus.at(-1).id, 'claude');
    const follower = world.keepClear().find((r) => r.id === 'party:codex');
    listeners.contextmenu({ clientX: follower.x + follower.w / 2, clientY: follower.y + follower.h * 0.6, preventDefault() {} });
    assert.equal(ev.menus.at(-1).kind, 'party');
    assert.equal(ev.menus.at(-1).id, 'party:codex');
    listeners.contextmenu({ clientX: 5, clientY: 690, preventDefault() {} });
    assert.ok(['ground', 'place', 'entity'].includes(ev.menus.at(-1).kind));
    assert.ok(Number.isInteger(ev.menus.at(-1).tile.x) && Number.isFinite(ev.menus.at(-1).x));
  } finally { done(); }
});

test('endCombat puts Milo on his final tile: once through onMiloMove in the wilds, silently in an Elsewhere, never outside a fight', async () => {
  const { world, ev, done } = world4();
  try {
    await world.travelTo({ x: 30, y: -10 });
    const [here, before] = [world.miloTile(), ev.moves.length];
    await world.endCombat({ place: { milo: { x: here.x + 3, y: here.y } } });
    assert.deepEqual([world.miloTile(), ev.moves.length], [here, before], 'no fight: nobody moves, nothing is said');
    const { view } = benchView(world.miloTile(), { actors: 8 });
    await world.startCombat(view);
    const moves = ev.moves.length;
    const to = { x: view.units[0].x + 2, y: view.units[0].y };
    await world.endCombat({ place: { milo: to, claude: { x: to.x - 1, y: to.y } } });
    assert.deepEqual(world.miloTile(), to);
    assert.equal(ev.moves.length, moves + 1, 'one move in the wilds');
    assert.deepEqual(ev.moves.at(-1), to);
    assert.equal(world.mode(), 'explore');
    const { rift, prep, options } = fightRift(['nocturne'], 'open', 5);
    await world.enterElsewhere(rift, options);
    await world.startCombat(viewOf(prep.encounters.rooms[0]));
    const inside = ev.moves.length;
    const entry = prep.encounters.rooms[0].fight.arena.entry[0];
    await world.endCombat({ place: { milo: entry } });
    assert.deepEqual(world.miloTile(), entry);
    assert.equal(ev.moves.length, inside, 'nothing saved from inside');
  } finally { done(); }
});

test('the board’s helpers: a view made clean, the fight’s light, and feet for Large units; the synthetic fight’s names are calm', () => {
  const { view } = benchView({ x: 10, y: 10 }, { actors: 16 });
  assert.equal(view.units.length, 16);
  const board = boardOf(view);
  assert.equal(board.units.size, 16);
  assert.equal(boardOf({}), null);
  const r = view.arena.rect;
  assert.equal(shadeAt(board, r.x + 8, r.y + 5), 0, 'lit');
  assert.equal(shadeAt(board, r.x + 15, r.y + 11), 2, 'dark');
  assert.equal(shadeAt(board, r.x + 3, r.y + 4), 0, 'dim, but in the Hooklight’s reach');
  assert.deepEqual(unitFeet(2, 3, 2), { x: 2 * TILE + 16, y: 4 * TILE + 13 });
  for (const u of view.units) assertCalm(u.name, u.id, { proper: ['Scribe', 'Artificer', 'Jev', 'Tollkeeper', 'Tale-lead', 'Drone', 'Turret', 'Stray'] });
});

test('under reduced motion a fight’s playback slides units and keeps the loop only while it plays', async () => {
  const clock = manualClock();
  const dom = fakeDom({ clock });
  dom.canvas.ownerDocument.defaultView.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const moves = [];
  const world = createWorld(dom.canvas, { motion: () => true, content: CONTENT, startTile: { x: 30, y: -10 } });
  try {
    world.setWildState(WILD_STATE);
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const { view } = benchView(world.miloTile(), { actors: 8 });
    let opened = null;
    world.startCombat(view).then((v) => { opened = v; });
    await flush();
    assert.equal(opened, true, 'the swirl and fade are decoration: the fight opens at once');
    clock.advance(200);
    assert.equal(clock.frames.size, 0, 'nothing playing: the loop rests');
    const milo = view.units[0];
    let over = false;
    world.playEvents([
      { t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'stride' } },
      { t: 'move', round: 1, tick: 1, unit: 'milo', path: [{ x: milo.x + 1, y: milo.y }, { x: milo.x + 2, y: milo.y }], how: 'stride' },
    ]).then(() => { over = true; });
    await flush();
    assert.ok(clock.frames.size > 0, 'a playback runs the loop');
    const seen = new Set();
    for (let ms = 0; ms < 3000 && !over; ms += 20) {
      clock.advance(20);
      await flush();
      seen.add(world.nearbyEntities().find((e) => e.id === 'cb:milo').x);
      moves.push(world.nearbyEntities().find((e) => e.id === 'cb:milo').x);
    }
    assert.equal(over, true, 'it plays out on the clock');
    assert.ok(moves.length > 5, `the slide takes time (${moves.length} frames)`);
    clock.advance(100);
    assert.equal(clock.frames.size, 0, 'and then the loop rests again');
  } finally { world.dispose(); dom.cleanup(); }
});

test('dispose settles every open promise: a fight’s playback, a moment, a follower’s walk', async () => {
  const clock = manualClock();
  const { world, done } = world4({ clock, motion: true });
  let disposed = false;
  try {
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    const settled = [];
    const watch = (name, promise) => promise.then((v) => settled.push([name, v]));
    world.setParty([{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }]);
    world.chain('claude', false);
    world.selectMember('claude');
    const here = world.miloTile();
    watch('walk', world.walkTo({ x: here.x + 6, y: here.y }));
    clock.advance(40);
    await flush();
    assert.deepEqual(settled, [], 'the Scribe is on her way');
    const { view } = benchView(here, { actors: 8 });
    watch('opening', world.startCombat(view));
    await flush();
    assert.deepEqual(settled, [['walk', false]], 'a fight stops the company, and her walk says it was cut short');
    watch('moment', world.playMoment('tea', here));
    watch('playback', world.playEvents([{ t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'brace' } }]));
    clock.advance(40);
    await flush();
    assert.deepEqual(settled.map(([name]) => name), ['walk', 'opening'], 'a playback ends the opening; the rest are waiting');
    done();
    disposed = true;
    await flush();
    assert.deepEqual(settled.map(([name]) => name).sort(), ['moment', 'opening', 'playback', 'walk']);
  } finally { if (!disposed) done(); }
});

test('a follower’s walk always settles, false when cut short or with no way; she walks on under reduced motion; places are hers, chops Milo’s', async () => {
  const clock = manualClock();
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const { world, done } = world4({ clock, motion: true, media, start: MAP.miloHome });
  let disposed = false;
  const scribe = [{ id: 'claude', look: HEROES[1].look, name: 'The Scribe' }];
  const pick = () => { world.chain('claude', false); world.selectMember('claude'); return world.partyTiles()[1]; };
  const sendOff = async (dx = 6) => { // unchain and select the Scribe and send her off → her walk's { value }
    const from = pick();
    const walk = { value: 'pending' };
    world.walkTo({ x: from.x + dx, y: from.y }).then((v) => { walk.value = v; });
    clock.advance(60);
    await flush();
    assert.equal(walk.value, 'pending', 'she is on her way');
    return walk;
  };
  const cuts = async (why, cut) => { const walk = await sendOff(); await cut(); await flush(); assert.equal(walk.value, false, why); };
  try {
    world.setParty(scribe);
    pick();
    const miloHome = world.miloTile();
    assert.equal(await run(clock, world.walkTo('watchtower')), true, 'walkTo(place) with her selected: she goes');
    assert.ok(((d, t) => Math.abs(t.x - d.x) + Math.abs(t.y - d.y) <= 1)(placeById('watchtower').door, world.partyTiles()[1]), 'to its door');
    assert.deepEqual(world.miloTile(), miloHome, 'and Milo stays');
    await cuts('a trip cuts her walk short (the reviewer’s case)', () => run(clock, world.travelTo({ x: 26, y: -6 })));
    const tree = world.nearbyEntities().find((e) => e.kind === 'tree');
    const left = pick();
    assert.equal((await run(clock, world.chop(tree.id))).ok, true, 'with her selected, a chop is still Milo’s');
    assert.equal(Math.abs(world.miloTile().x - tree.x) + Math.abs(world.miloTile().y - tree.y), 1, 'beside the tree');
    assert.deepEqual(world.partyTiles()[1], left, 'the Scribe stays where she was left');
    await run(clock, world.travelTo({ x: 30, y: -10 }));
    await cuts('a fight stops her', () => { world.startCombat(benchView(world.miloTile(), { actors: 4 }).view); });
    await world.endCombat({ place: {} });
    await cuts('so does setMode alone', () => world.setMode('combat'));
    await world.endCombat({ place: {} });
    await cuts('chained back, she rejoins instead', () => world.chain('claude', true));
    await cuts('left out of the party, she stops', () => world.setParty([]));
    world.setParty(scribe);
    const here = pick();
    assert.equal(await run(clock, world.walkTo({ x: 5000, y: 5000 }), 3000), false, 'no way: false, as Milo’s own walk says (world.test.js)');
    assert.deepEqual(world.partyTiles()[1], here, 'and she stays put');
    assert.equal(await run(clock, world.walkTo({ x: here.x + 2, y: here.y })), true, 'a way there: true');
    // Reduced motion comes on mid-walk (the watchdog looks every 400 ms): she walks on, tile by tile (§18.2 item 16).
    const long = await sendOff(-8);
    media.matches = true;
    await wait(900);
    assert.equal(long.value, 'pending', 'never snapped to the end');
    assert.equal(await until(clock, () => long.value !== 'pending', 5000), true);
    assert.equal(long.value, true, 'and she gets there');
    const last = await sendOff();
    disposed = true; done();
    await flush();
    assert.equal(last.value, false, 'dispose cuts it short');
  } finally { if (!disposed) done(); }
});

test('the planner’s overlay: ⚠ on a swipe step, harm and help hatched apart, caught units marked; one tag per icon', () => {
  const made = new Map(); // rows → the tags they were asked for with
  const drawn = [];
  const painter = { grid: (rows, table, key, opts = {}) => { made.set(rows, (made.get(rows) || new Set()).add(opts.tag)); return { width: rows[0].length, height: rows.length, rows }; } };
  const context = () => new Proxy({}, { get: (t, p) => (p === 'drawImage' ? (img) => drawn.push(img.rows) : p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const makeCanvas = (w, h) => { const ctx = context(); return { width: w, height: h, getContext: () => ctx }; };
  const layer = createCombatLayer({ painter, makeCanvas, anims: () => ANIMS, rules: () => RULES, tableFor: () => null, dressAt: () => null, genreAt: () => null, motion: () => true, wake() {} });
  const { view, overlay } = benchView({ x: 20, y: 20 }, { actors: 8 });
  layer.start(view);
  layer.settle(); // the opening swirl, done
  const r = view.arena.rect;
  const areas = [{ tiles: [{ x: r.x + 9, y: r.y + 2 }], kind: 'harm', caught: ['f0', 'milo'] }, { tiles: [{ x: r.x + 3, y: r.y + 5 }], kind: 'help', caught: ['claude', 'f0'] }];
  layer.overlay({ ...overlay, areas });
  assert.ok(made.has(SWIPE_MARK) && !made.has(INTENT_ICONS.strike), 'a step that draws a Parting swipe shows ⚠, not the Strike intent (COMBAT §4.1)');
  assert.ok(SWIPE_MARK.every((row) => row.length === 11 && /^[.oU]+$/.test(row)));
  assert.ok(AREA_HATCH.harm.every((row, y) => [...row].every((c, x) => (c === '#') === ((x + y) % 4 === 0))), 'harm: diagonal stripes');
  assert.deepEqual([AREA_HATCH.help[1][2], AREA_HATCH.help[2].slice(1, 4), AREA_HATCH.help[3][2], AREA_HATCH.help[0][0]], ['#', '###', '#', '.'], 'help: small crosses, so the kinds differ without colour (COMBAT §15)');
  drawn.length = 0;
  layer.ground(context(), () => true, 1000);
  assert.deepEqual(['harm', 'help'].map((k) => drawn.filter((rows) => rows === CAUGHT_MARKS[k]).length), [2, 1], 'caught: f0 and Milo by harm (harm wins), the Scribe by help');
  layer.play([
    { t: 'act', round: 1, tick: 1, unit: 'milo', action: { id: 'strike', target: { unit: 'f0' } } },
    { t: 'outcome', round: 1, tick: 1, unit: 'milo', target: 'f0', degree: 'crit', bars: [5, 80, 10, 5], k: 0 },
    { t: 'damage', round: 1, tick: 1, unit: 'milo', target: 'f0', amount: 9, kind: 'light', degree: 'crit', integrity: 8, max: 17 },
  ]);
  for (let ms = 0; ms < 1500; ms += 20) {
    layer.update(20, ms);
    layer.ground(context(), () => true, ms);
    layer.above(context(), () => true, ms, { x: 0, y: 0, w: 320, h: 240 });
  }
  const icons = [SWIPE_MARK, ...Object.values(CAUGHT_MARKS), ...FLASHES.crit, ...Object.values(INTENT_ICONS)].filter((rows) => made.has(rows));
  assert.ok(icons.length >= 5, 'icons, marks and the flash were all asked for');
  for (const [rows, tags] of made) assert.equal(tags.size, 1, `one tag per canvas (${[...tags]})`);
  for (const rows of icons) assert.deepEqual([...made.get(rows)], ['overlay:icon']);
  assert.deepEqual([...made.get(numberRows('9', { size: 'big', fill: 'u', star: true }))], ['num'], 'the Critical’s number');
  layer.dispose();
});

test('J’s new modules are pure where they should be, and within 1,500 lines', () => {
  for (const name of ['scene-combat', 'anim', 'follow', 'scene-camp', 'scene-sky']) {
    const source = readFileSync(new URL(`../src/world/${name}.js`, import.meta.url), 'utf8');
    assert.ok(source.split('\n').length <= 1500, `${name}.js is at most 1,500 lines`);
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of ['Date.now', 'Math.random', 'performance.now', 'document.', 'window.', 'setTimeout', 'setInterval']) {
      assert.equal(code.includes(banned), false, `${name}.js never uses ${banned}`);
    }
  }
});
