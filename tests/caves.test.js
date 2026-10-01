// Caves (module E): src/world/caves.js, a cave's spec, layout and label from its point of interest
// (CONTRACT-PHASE4.md §3.1, §7.7, COMBAT.md §8.5).
// Run: node --test tests/caves.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { assertCalm } from './calm.js';
import { createWorldgen, CHUNK } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { hashInts } from '../src/world/rng.js';
import {
  caveSpec, caveLayout, caveLabel, caveRegion, creaturesFor, stageForTier, cavePanelId, cavePoiId, caveSource, caveFromSource,
  CAVE_CREATURES, CAVE_BORROW,
} from '../src/world/caves.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const words = read('riftgen.json');
const genres = read('genres.json');
const FOES = new URL('../content/combat/foes.json', import.meta.url);
const foesFile = existsSync(FOES) ? JSON.parse(readFileSync(FOES, 'utf8')) : null;

const world = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
const wilds = createWilds({ worldgen: world, maxChunks: 16 });
const riftgen = createRiftgen({ words, genres });
// Names for the unnamed wilds come from riftgen.json's region words ("the Saltglass Reach").
const REGION_WORDS = [...words.regionWords.first, ...words.regionWords.second];

/** Every cave worldgen puts in the chunks round the vale, and round Cinderforge and the Archive Peaks (tiers 3 and 4). */
function cavesIn(w, span = 7, regions = ['cinderforge', 'archive-peaks']) {
  const keys = new Set();
  for (let cy = -span; cy <= span; cy += 1) for (let cx = -span; cx <= span; cx += 1) keys.add(`${cx},${cy}`);
  for (const id of regions) {
    const a = w.anchorById[id];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) keys.add(`${Math.floor(a.x / CHUNK) + dx},${Math.floor(a.y / CHUNK) + dy}`);
  }
  const out = [];
  for (const key of keys) {
    const [cx, cy] = key.split(',').map(Number);
    for (const poi of w.chunk(cx, cy).pois) if (poi.type === 'cave') out.push(poi);
  }
  return out;
}
const CAVES = cavesIn(world);

test('there are caves to test, round the vale and out in the regions, at several tiers and both stages', () => {
  assert.ok(CAVES.length >= 12, `${CAVES.length} caves`);
  const specs = CAVES.map((poi) => caveSpec(poi, { worldgen: world, wilds, words }));
  assert.ok(new Set(specs.map((s) => s.region)).size >= 4, 'several regions');
  assert.ok(new Set(specs.map((s) => s.tier)).size >= 3, 'several tiers');
  assert.deepEqual([...new Set(specs.map((s) => s.stage))].sort(), ['hairline', 'open'], 'both stages');
});

test('a cave’s spec comes from its tile: its own seed tag, the tile’s tier and depth, and no rift in it', () => {
  const S = world.seed >>> 0;
  for (const poi of CAVES) {
    const cave = caveSpec(poi, { worldgen: world, wilds, words });
    // §7.7's keys in order, then §18.2 item 3's `day`.
    assert.deepEqual(Object.keys(cave), ['id', 'seed', 'kind', 'x', 'y', 'tier', 'depth', 'stage', 'region', 'name', 'genres', 'affixes', 'strays', 'taleLead', 'loot', 'creatures', 'day']);
    assert.equal(cave.id, `cave:${poi.x},${poi.y}`);
    assert.equal(cave.id, cavePanelId(poi), 'the cave panel’s id is the cave’s');
    assert.match(cave.id, /^cave:-?\d+,-?\d+$/);
    assert.equal(cave.seed, hashInts(S, poi.x, poi.y, 'cave'));
    assert.equal(cave.kind, 'cave');
    assert.equal(cave.tier, world.tierAt(poi.x, poi.y), 'the tier of its tile');
    assert.equal(cave.depth, poi.depth);
    assert.equal(cave.stage, cave.tier >= 4 ? 'open' : 'hairline');
    assert.deepEqual([cave.genres, cave.affixes, cave.strays, cave.loot, cave.taleLead], [[], [], [], [], null]);
    assert.ok(Object.isFrozen(cave) && Object.isFrozen(cave.creatures) && Object.isFrozen(cave.genres), 'frozen');
    assert.ok(cave.creatures.length >= 1, `${cave.id} has creatures`);
  }
});

test('caves are deterministic: the same point of interest in a fresh world gives the same cave', () => {
  const again = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const againWilds = createWilds({ worldgen: again, maxChunks: 16 });
  const byId = new Map(cavesIn(again).map((p) => [`${p.x},${p.y}`, p]));
  for (const poi of CAVES) {
    const other = byId.get(`${poi.x},${poi.y}`);
    assert.ok(other, `the cave at ${poi.x},${poi.y} is still there`);
    assert.deepEqual(caveSpec(other, { worldgen: again, wilds: againWilds, words }), caveSpec(poi, { worldgen: world, wilds, words }));
  }
  // And a second call on the same world, and another seed's world gives other caves.
  assert.deepEqual(caveSpec(CAVES[0], { worldgen: world, wilds }), caveSpec(CAVES[0], { worldgen: world, wilds }));
  const moon = createWorldgen({ seed: 'moonrise', regionWords: words.regionWords });
  const moonCaves = cavesIn(moon, 4, []).map((poi) => caveSpec(poi, { worldgen: moon, wilds: createWilds({ worldgen: moon, maxChunks: 4 }) }));
  assert.ok(moonCaves.length > 0);
  for (const cave of moonCaves) assert.equal(cave.seed, hashInts(moon.seed >>> 0, cave.x, cave.y, 'cave'));
});

test('a cave’s region is the nearest story region by the wilds’ own regionDistance, out in the unnamed wilds too', () => {
  const anchors = world.anchors.filter((a) => a.radius > 0);
  let inside = 0;
  let outside = 0;
  for (const poi of CAVES) {
    const cave = caveSpec(poi, { worldgen: world, wilds });
    const ranked = anchors.map((a) => ({ id: a.id, d: wilds.regionDistance(a, poi.x, poi.y) })).sort((a, b) => a.d - b.d);
    assert.equal(cave.region, ranked[0].id, `${cave.id} belongs to ${ranked[0].id}`);
    assert.equal(caveRegion(poi.x, poi.y, { worldgen: world, wilds }), cave.region);
    if (ranked[0].d < 1) inside += 1;
    else outside += 1;
  }
  assert.ok(inside > 0 && outside > 0, `caves in regions (${inside}) and between them (${outside})`);
  // None of the real caves above lies where regionDistance and plain distance (hypot / radius)
  // disagree, so a made-up cave at a tile where they do: regionDistance says the Archive Peaks,
  // plain distance the Whisperwood. Only the wilds' own metric gives the right answer here.
  const odd = { type: 'cave', x: 25, y: -128, name: 'A cave mouth', depth: world.depthAt(25, -128) };
  const byWilds = anchors.map((a) => ({ id: a.id, d: wilds.regionDistance(a, odd.x, odd.y) })).sort((a, b) => a.d - b.d)[0].id;
  const byPlain = anchors.map((a) => ({ id: a.id, d: Math.hypot(odd.x - a.x, odd.y - a.y) / a.radius })).sort((a, b) => a.d - b.d)[0].id;
  assert.deepEqual([byWilds, byPlain], ['archive-peaks', 'whisperwood'], 'the two metrics disagree at (25, −128)');
  assert.equal(caveSpec(odd, { worldgen: world, wilds }).region, 'archive-peaks', 'the cave goes by regionDistance');
  assert.equal(caveRegion(odd.x, odd.y, { worldgen: world, wilds }), 'archive-peaks');
  // Hearthvale has no reach of its own, so it's never a cave's region.
  assert.ok(CAVES.every((poi) => caveSpec(poi, { worldgen: world, wilds }).region !== 'hearthvale'));
});

test('a cave’s stage is hairline at tiers 1–3 and open from 4', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(stageForTier), ['hairline', 'hairline', 'hairline', 'open', 'open', 'open', 'open', 'open']);
  // A cave far enough out for tier 4 and beyond.
  const far = { type: 'cave', x: 150, y: -170, name: 'A cave mouth', depth: world.depthAt(150, -170) };
  const cave = caveSpec(far, { worldgen: world, wilds });
  assert.equal(cave.tier, world.tierAt(150, -170));
  assert.equal(cave.stage, stageForTier(cave.tier));
});

test('its creatures are its region’s cave list, or a listed region’s where it has none', () => {
  for (const [region, list] of Object.entries(CAVE_CREATURES)) assert.deepEqual(creaturesFor(region, { worldgen: world }), [...list]);
  assert.deepEqual(creaturesFor('painted-hills', { worldgen: world }), [...CAVE_CREATURES.mistmere], 'the Painted Hills borrow Mistmere’s');
  assert.deepEqual(creaturesFor('ivory-college', { worldgen: world }), [...CAVE_CREATURES['glass-fen']], 'the College borrows the Glass Fen’s');
  assert.deepEqual(creaturesFor('hearthvale', { worldgen: world }), [...CAVE_CREATURES.mistmere]);
  assert.deepEqual(creaturesFor('far-shore', { worldgen: world }), [...CAVE_CREATURES.cinderforge]);
  // A region nobody has listed or borrowed for takes the nearest listed region's, anchor to anchor.
  assert.deepEqual(creaturesFor('far-shore', { worldgen: world, borrow: {} }), [...CAVE_CREATURES.cinderforge]);
  for (const region of world.anchors.map((a) => a.id)) assert.ok(creaturesFor(region, { worldgen: world }).length >= 1, region);
  // Every id is one COMBAT §8.5 names: the eight regions' creatures and delve foes.
  const known = new Set(Object.values(CAVE_CREATURES).flat());
  for (const list of Object.values(CAVE_BORROW)) assert.ok(CAVE_CREATURES[list], `${list} has a list to lend`);
  assert.equal(known.size, 13);
});

test('D’s foes.json agrees with the cave lists, and a cave takes its lists from it when given', { skip: !foesFile && 'content/combat/foes.json isn’t written yet' }, () => {
  assert.deepEqual(foesFile.caves, JSON.parse(JSON.stringify(CAVE_CREATURES)));
  if (foesFile.borrow) assert.deepEqual(foesFile.borrow, { ...CAVE_BORROW });
  const poi = CAVES.find((p) => caveSpec(p, { worldgen: world, wilds }).region === 'whisperwood') || CAVES[0];
  const custom = { caves: { ...foesFile.caves, whisperwood: ['murmurs'] }, borrow: foesFile.borrow };
  const cave = caveSpec(poi, { worldgen: world, wilds, foes: custom });
  assert.deepEqual([...cave.creatures], creaturesFor(cave.region, { worldgen: world, lists: custom.caves, borrow: custom.borrow }));
});

test('a cave’s layout is riftgen’s carving on the cave’s own seed and stage, with no affixes, and the same every time', () => {
  const seen = new Set();
  for (const poi of CAVES.slice(0, 12)) {
    const cave = caveSpec(poi, { worldgen: world, wilds });
    const layout = caveLayout(cave, riftgen);
    assert.deepEqual(layout, riftgen.layout({ seed: cave.seed, stage: cave.stage, depth: cave.depth, affixes: [] }));
    assert.deepEqual(caveLayout(cave, riftgen), layout, 'deterministic');
    const base = { hairline: [40, 26], open: [52, 34] }[cave.stage];
    const grow = 1 + Math.min(0.6, (cave.depth - 1) * 0.04);
    assert.equal(layout.w, Math.max(28, Math.round(base[0] * grow)), 'no affix changes its size');
    assert.equal(layout.rows.join('').split('E').length - 1, 1, 'one way in');
    seen.add(layout.rows.join('\n'));
  }
  assert.equal(seen.size, 12, 'every cave is carved its own way');
  assert.equal(caveLayout(null, riftgen), null);
});

test('a cave says where it is, calmly: its label on hover and its name', () => {
  const byRegion = { cinderforge: 'A cave mouth · Cinderforge side', whisperwood: 'A cave mouth · Whisperwood side', 'glass-fen': 'A cave mouth · Glass Fen side', mistmere: 'A cave mouth · Mistmere side' };
  for (const [region, label] of Object.entries(byRegion)) assert.equal(caveLabel({ region }), label);
  assert.equal(caveLabel({ region: 'nowhere' }), 'A cave mouth');
  assert.equal(caveLabel(null), 'A cave mouth');
  for (const poi of CAVES) {
    const cave = caveSpec(poi, { worldgen: world, wilds });
    assertCalm(cave.name, cave.id, { proper: REGION_WORDS });
    assertCalm(caveLabel(cave), `${cave.id} label`);
    assert.match(cave.name, /^A cave in /);
    assert.ok(cave.name.length <= 60);
  }
});

/* --- §18.2 item 3: caves have a day, and the expedition's ids */

const DAY = 20725; // a MILO day number (clean.js dayNumber), 2026-09-28
/** The wilds' own point of interest for a cave (with its place id), as L1 gets it from the wilds. */
const wildPoi = (poi) => wilds.chunk(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK)).pois.find((p) => p.x === poi.x && p.y === poi.y);

test('a cave carries the day it was entered on, and nothing else about it changes with the day', () => {
  for (const poi of CAVES) {
    const monday = caveSpec(poi, { worldgen: world, wilds, words, day: DAY });
    const tuesday = caveSpec(poi, { worldgen: world, wilds, words, day: DAY + 1 });
    assert.equal(monday.day, DAY);
    assert.equal(tuesday.day, DAY + 1);
    assert.deepEqual({ ...tuesday, day: DAY }, monday, `${monday.id}: only the day differs`);
    assert.deepEqual({ ...caveSpec(poi, { worldgen: world, wilds, words }), day: DAY }, monday);
  }
  // Called as §7.7 writes it, with no day, or with anything but a whole day number, the day is
  // null, so D's prepareCave refuses rather than share one fight id across every day.
  for (const day of [undefined, null, -1, 1.5, '20725', Number.NaN, 1e9]) {
    assert.equal(caveSpec(CAVES[0], { worldgen: world, wilds, day }).day, null, `day ${String(day)}`);
  }
  assert.equal(caveSpec(CAVES[0], { worldgen: world, wilds, day: 0 }).day, 0);
});

test('the expedition’s ids: riftId is the cave’s own cave:<x>,<y>, and source.poi the wilds’ place id poi:cave:<x>,<y>', () => {
  for (const poi of CAVES) {
    const place = wildPoi(poi);
    assert.ok(place, `the wilds have the cave at ${poi.x},${poi.y}`);
    const cave = caveSpec(place, { worldgen: world, wilds, words, day: DAY });
    assert.equal(cave.id, `cave:${poi.x},${poi.y}`, 'the riftId');
    assert.equal(cavePanelId(place), cave.id);
    assert.equal(cavePoiId(cave), place.id, 'source.poi is exactly the wilds’ own place id');
    assert.equal(cavePoiId(place), place.id);
    assert.deepEqual(caveSource(cave), { poi: place.id, day: DAY });
    assert.notEqual(caveSource(cave).poi, cave.id, 'never the riftId, which A’s cleaner would drop the expedition for');
  }
  // No source without a day to store, or for anything but a cave.
  assert.equal(caveSource(caveSpec(CAVES[0], { worldgen: world, wilds })), null);
  for (const bad of [null, {}, { kind: 'wild', x: 1, y: 2, day: DAY }, { kind: 'cave', x: 1.5, y: 2, day: DAY }]) assert.equal(caveSource(bad), null);
});

test('a cave rebuilt from the expedition’s source after a relaunch is the cave that was entered, day and all', () => {
  // L1 stores caveSource(cave) at entry and rebuilds from it on every resume, Try again included:
  // through JSON, in a fresh world, the same CaveSpec, so D's fight ids (which carry the day) match.
  const fresh = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const freshWilds = createWilds({ worldgen: fresh, maxChunks: 16 });
  for (const poi of CAVES) {
    const cave = caveSpec(wildPoi(poi), { worldgen: world, wilds, words, foes: foesFile, day: DAY });
    const saved = JSON.parse(JSON.stringify(caveSource(cave)));
    assert.deepEqual(caveFromSource(saved, { worldgen: fresh, wilds: freshWilds, words, foes: foesFile }), cave, `${cave.id} on day ${DAY}`);
  }
  // Past midnight the saved day still wins: the rebuild never asks the clock.
  const cave = caveSpec(CAVES[0], { worldgen: world, wilds, day: DAY });
  assert.equal(caveFromSource(caveSource(cave), { worldgen: world, wilds }).day, DAY);
  // Not a cave's source: the riftId in place of the place id, another kind's id, no day, junk.
  for (const bad of [{ poi: cave.id, day: DAY }, { poi: `poi:ruin:${cave.x},${cave.y}`, day: DAY }, { poi: cavePoiId(cave) }, { poi: cavePoiId(cave), day: -1 }, null, 'poi:cave:1,2']) {
    assert.equal(caveFromSource(bad, { worldgen: world, wilds }), null, JSON.stringify(bad));
  }
});

const A_STATE = new URL('../src/state4.js', import.meta.url);
test('A’s cleaner keeps a cave expedition’s riftId and source exactly as caveSource gives them', { skip: !existsSync(A_STATE) && 'src/state4.js isn’t written yet' }, async () => {
  const { normalize4 } = await import('../src/state4.js');
  for (const poi of CAVES.slice(0, 6)) {
    const cave = caveSpec(wildPoi(poi), { worldgen: world, wilds, words, day: DAY });
    const expedition = { runId: `run:${cave.id}:${DAY}`, kind: 'cave', riftId: cave.id, key: null, since: null, source: caveSource(cave), depth: cave.depth, tier: cave.tier };
    const kept = normalize4(JSON.parse(JSON.stringify({ expedition })), { now: Date.UTC(2026, 8, 28, 12), tally: {} }).expedition;
    assert.ok(kept, `${cave.id}: the expedition survives a load`);
    assert.equal(kept.riftId, cave.id);
    assert.deepEqual(kept.source, caveSource(cave));
    assert.deepEqual(caveFromSource(kept.source, { worldgen: world, wilds, words }), cave);
  }
});

const D_CAVE = ['../src/combat/encounters.js', '../src/combat/rules.js', '../content/combat/rules.json', '../content/combat/foes.json'];
test('D’s prepareCave reads the day off the cave: its fight ids carry it, and a cave with no day is refused', { skip: !D_CAVE.every((f) => existsSync(new URL(f, import.meta.url))) && 'the fights aren’t written yet' }, async () => {
  const { prepareCave } = await import('../src/combat/encounters.js');
  const { loadRules } = await import('../src/combat/rules.js');
  const rules = loadRules(read('combat/rules.json'));
  for (const poi of CAVES.slice(0, 3)) {
    const cave = caveSpec(poi, { worldgen: world, wilds, words, foes: foesFile, day: DAY });
    const layout = caveLayout(cave, riftgen);
    // Called as §7.7 writes it, with no day option: the cave's own day serves.
    const out = prepareCave(cave, { layout, roadLevel: 3, partySize: 4, rules, foes: foesFile, words });
    const ids = [...out.encounters.rooms.map((r) => r.fightId), ...out.encounters.chests.filter((c) => c.mimic).map((c) => c.mimic.fight.id)];
    assert.ok(ids.length >= 2 && ids.every((id) => id.startsWith(`fight:${cave.id}:${DAY}:`)), `${cave.id}: ${ids.join(' ')}`);
    // Rebuilt from its source, the same fights.
    const again = caveFromSource(JSON.parse(JSON.stringify(caveSource(cave))), { worldgen: world, wilds, words, foes: foesFile });
    assert.deepEqual(prepareCave(again, { layout: caveLayout(again, riftgen), roadLevel: 3, partySize: 4, rules, foes: foesFile, words }), out);
    assert.throws(() => prepareCave(caveSpec(poi, { worldgen: world, wilds, words, foes: foesFile }), { layout, roadLevel: 3, partySize: 4, rules, foes: foesFile, words }), /day/);
  }
});

test('anything that isn’t a cave, or a cave with no world, gives no cave', () => {
  const ruin = CAVES[0] && { ...CAVES[0], type: 'ruin' };
  assert.equal(caveSpec(ruin, { worldgen: world, wilds }), null);
  assert.equal(caveSpec(null, { worldgen: world, wilds }), null);
  assert.equal(caveSpec({ type: 'cave', x: 1.5, y: 2 }, { worldgen: world, wilds }), null);
  assert.equal(caveSpec(CAVES[0], {}), null);
});

test('reading caves leaves the world as it was: every cave is still a point of interest of its chunk', () => {
  for (const poi of CAVES.slice(0, 10)) caveSpec(poi, { worldgen: world, wilds });
  const fresh = createWorldgen({ seed: 'hushlands', regionWords: words.regionWords });
  const cx = Math.floor(CAVES[0].x / CHUNK);
  const cy = Math.floor(CAVES[0].y / CHUNK);
  assert.deepEqual(world.chunk(cx, cy).pois, fresh.chunk(cx, cy).pois);
  assert.deepEqual([...world.chunk(cx, cy).tiles], [...fresh.chunk(cx, cy).tiles]);
});
