// Phase 5b: new places follow your light. A lit lantern brings a camp; a camp you keep visiting
// becomes a hamlet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, lightLantern } from '../src/model.js';
import { CAMP_AFTER_MS, GROW_VISITS, CAMP_KITS, campId, campStage, campFor, campWords } from '../src/world/camps.js';
import { layoutKit, partsLine } from '../src/world/settlement.js';
import { folkFor } from '../src/world/folk.js';
import { visitPlace, visitsTo, welcomeAt } from '../src/welcome.js';
import { cleanCamplife } from '../src/state5.js';
import { SPRITES } from '../src/world/sprites.js';
import { createWorldgen, TERRAIN } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';

const folk = JSON.parse(readFileSync(new URL('../content/people/folk.json', import.meta.url), 'utf8'));
const riftgen = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const LANTERN = { id: 'lantern:28,-14', x: 28, y: -14 };
const open = () => true;

test('a camp goes up two real days after its lantern is lit, and not before', () => {
  assert.equal(campStage(null, 0, T0), 'none', 'a sleeping lantern has nobody beside it');
  assert.equal(campStage(T0, 0, T0), 'none');
  assert.equal(campStage(T0, 0, T0 + CAMP_AFTER_MS - 1), 'none');
  assert.equal(campStage(T0, 0, T0 + CAMP_AFTER_MS), 'camp');
  assert.equal(campStage(T0, GROW_VISITS - 1, T0 + 30 * DAY), 'camp', 'it stays a camp until you keep coming by');
  assert.equal(campStage(T0, GROW_VISITS, T0 + CAMP_AFTER_MS), 'hamlet');
  assert.equal(campStage(T0, 99, T0 + DAY), 'none', 'visits can’t hurry the two days');
  assert.equal(campStage(T0, 0, NaN), 'none');
  assert.equal(campId(LANTERN.id), 'camp:lantern:28,-14');
});

test('a camp is a fire and a tent; a hamlet keeps both where they were and adds a home and a well', () => {
  assert.deepEqual(CAMP_KITS.camp.map((p) => p.part), ['fire', 'tent']);
  assert.deepEqual(CAMP_KITS.hamlet.slice(0, 2), CAMP_KITS.camp);
  assert.ok(CAMP_KITS.hamlet.some((p) => p.part === 'home') && CAMP_KITS.hamlet.some((p) => p.part === 'well'));
  for (const p of CAMP_KITS.hamlet) assert.ok(SPRITES[p.kind], `${p.kind} is a sprite`);
  const camp = campFor(LANTERN, { litAt: T0, visits: 0, now: T0 + 3 * DAY, free: open });
  assert.deepEqual([camp.id, camp.lanternId, camp.stage], ['camp:lantern:28,-14', LANTERN.id, 'camp']);
  assert.deepEqual(camp.parts.map((p) => p.part), ['fire', 'tent']);
  const grown = campFor(LANTERN, { litAt: T0, visits: 3, now: T0 + 3 * DAY, free: open });
  assert.equal(grown.stage, 'hamlet');
  assert.deepEqual(grown.parts.slice(0, 2), camp.parts, 'the fire and the tent haven’t moved');
  assert.deepEqual(grown.parts.map((p) => p.part).sort(), ['fire', 'home', 'tent', 'timber', 'well']);
  assert.deepEqual(campFor(LANTERN, { litAt: T0, visits: 0, now: T0 + 3 * DAY, free: open }), camp, 'the same every time');
});

test('nothing stands on the lantern’s tile or on anything else, and there is a tile between any two', () => {
  const grown = campFor(LANTERN, { litAt: T0, visits: 3, now: T0 + 3 * DAY, free: (x, y) => !(x === LANTERN.x && y === LANTERN.y) });
  const all = grown.parts;
  for (const p of all) assert.ok(!(LANTERN.x >= p.x && LANTERN.x < p.x + p.w && LANTERN.y >= p.y && LANTERN.y < p.y + p.h), `${p.id} is off the lantern’s tile`);
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) {
    const a = all[i];
    const b = all[j];
    assert.ok(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y, `${a.id} and ${b.id} have a way between`);
  }
});

test('no room, no camp; a little room, a smaller camp', () => {
  assert.equal(campFor(LANTERN, { litAt: T0, now: T0 + 3 * DAY, free: () => false }), null);
  assert.equal(campFor(LANTERN, { litAt: T0, now: T0 + 3 * DAY, free: () => { throw new Error('no'); } }), null);
  assert.equal(campFor(null, { litAt: T0, now: T0 + 3 * DAY, free: open }), null);
  assert.equal(campFor(LANTERN, { litAt: T0, now: T0 + DAY, free: open }), null, 'too soon');
  const fireOnly = campFor(LANTERN, { litAt: T0, now: T0 + 3 * DAY, free: (x, y) => x === LANTERN.x + 1 && y === LANTERN.y });
  assert.deepEqual(fireOnly.parts.map((p) => p.part), ['fire']);
  assert.deepEqual(layoutKit(LANTERN, null, open), []);
});

test('a camp has two of the folk, and they are new here; a grown one has its full three or four', () => {
  const camp = campFor(LANTERN, { litAt: T0, visits: 0, now: T0 + 3 * DAY, free: open });
  const site = { id: camp.id, x: camp.x, y: camp.y };
  const two = folkFor(site, folk, { free: open, parts: camp.parts, age: 'new', limit: 2 });
  assert.equal(two.length, 2);
  assert.ok(two.every((p) => p.age === 'new'));
  assert.equal(two[0].role, 'merchant');
  const role = folk.roles.find((r) => r.id === two[0].role);
  assert.ok(role.new.every((l) => two[0].lines.includes(l)) && !role.old.some((l) => two[0].lines.includes(l)));
  const grown = campFor(LANTERN, { litAt: T0, visits: 3, now: T0 + 3 * DAY, free: open });
  const more = folkFor(site, folk, { free: open, parts: grown.parts, age: 'new' });
  assert.ok(more.length === 3 || more.length === 4);
  assert.deepEqual(more.slice(0, 2).map((p) => [p.id, p.name, p.role]), two.map((p) => [p.id, p.name, p.role]), 'the first two stayed');
});

test('coming by is counted for a camp as for a hamlet, and it grows on the third day', () => {
  let state = lightLantern(createState(T0), LANTERN.id, T0);
  const id = campId(LANTERN.id);
  const stageAt = (now) => campStage(state.wilds.lanterns[LANTERN.id], visitsTo(state, id), now);
  assert.equal(stageAt(T0 + DAY), 'none');
  assert.equal(stageAt(T0 + 2 * DAY), 'camp');
  state = visitPlace(state, id, T0 + 2 * DAY);
  state = visitPlace(state, id, T0 + 3 * DAY);
  assert.equal(stageAt(T0 + 3 * DAY), 'camp');
  state = visitPlace(state, id, T0 + 4 * DAY);
  assert.equal(stageAt(T0 + 4 * DAY), 'hamlet');
  assert.equal(welcomeAt(state, { id, x: LANTERN.x, y: LANTERN.y }, T0 + 4 * DAY), 'warm', 'and by then they know you');
  assert.deepEqual(Object.keys(cleanCamplife(JSON.parse(JSON.stringify(state.camplife))).places), [id], 'it survives a save');
});

test('what a camp says of itself, and what a grown one holds', () => {
  const camp = campFor(LANTERN, { litAt: T0, visits: 0, now: T0 + 3 * DAY, free: open });
  assert.deepEqual(campWords(camp), { title: 'A camp', lines: ['Somebody pitched it after you lit the lantern.'] });
  const grown = campFor(LANTERN, { litAt: T0, visits: 3, now: T0 + 3 * DAY, free: open });
  assert.equal(campWords(grown).title, 'A new hamlet');
  const others = grown.parts.filter((p) => p.part !== 'home');
  assert.equal(partsLine(others), 'A home, a tent and a well.');
  assert.deepEqual(campWords(null), { title: '', lines: [] });
  for (const text of [...campWords(camp).lines, ...campWords(grown).lines]) assert.ok(!text.includes('!') && !text.includes("'") && text.length <= 80, text);
});

test('in the world: the lantern on the north road has room for its camp, off the road', () => {
  const worldgen = createWorldgen({ seed: 'hushlands', regionWords: riftgen.regionWords });
  const wilds = createWilds({ worldgen, maxChunks: 64 });
  const road = (x, y) => [TERRAIN.ROAD, TERRAIN.BRIDGE].includes(worldgen.terrainAt(x, y));
  const free = (x, y) => worldgen.walkable(x, y) && !wilds.blocked(x, y) && !road(x, y) && !worldgen.inHeart(x, y);
  for (const lantern of [LANTERN, { id: 'lantern:80,-6', x: 80, y: -6 }, { id: 'lantern:-12,18', x: -12, y: 18 }]) {
    const grown = campFor(lantern, { litAt: T0, visits: 3, now: T0 + 3 * DAY, free: (x, y) => free(x, y) && !(x === lantern.x && y === lantern.y) });
    assert.ok(grown, `${lantern.id} has a camp`);
    assert.ok(grown.parts.some((p) => p.part === 'fire') && grown.parts.some((p) => p.part === 'tent') && grown.parts.some((p) => p.part === 'home'), `${lantern.id}: ${grown.parts.map((p) => p.part).join(', ')}`);
    for (const p of grown.parts) for (let y = p.y; y < p.y + p.h; y += 1) for (let x = p.x; x < p.x + p.w; x += 1) assert.ok(free(x, y), `${p.id} stands on open ground`);
  }
});
