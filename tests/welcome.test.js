// Phase 5b: a settlement's welcome, the folk's day, and the kits each region builds from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, normalizeState, markFelled } from '../src/model.js';
import { cleanCamplife, emptyCamplife } from '../src/state5.js';
import { dayNumber } from '../src/clean.js';
import { visitsTo, visitPlace, felledNear, welcomeAt, welcomeLine, NEAR_TREES, WARM_VISITS } from '../src/welcome.js';
import { KIT, REGION_KITS, kitFor, layoutSettlement, hamletAge } from '../src/world/settlement.js';
import { folkFor, folkLine } from '../src/world/folk.js';
import { SPRITES } from '../src/world/sprites.js';
import { FIELD_COVER } from '../src/world/fieldboss.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { campfire } from '../src/party.js';

const folk = JSON.parse(readFileSync(new URL('../content/people/folk.json', import.meta.url), 'utf8'));
const riftgen = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const fresh = () => createState(T0);
const EMBER = { id: 'poi:hamlet:106,-5', x: 106, y: -5 };
const open = () => true;
const WELL = { part: 'well', x: 108, y: -2, w: 1, h: 1 };
const STALL = { part: 'stall', x: 101, y: -8, w: 2, h: 1 };

// ---- the welcome ----

test('a hamlet knows you after three different days, and a day counts once', () => {
  let state = fresh();
  assert.equal(visitsTo(state, EMBER.id), 0);
  assert.equal(welcomeAt(state, EMBER, T0), 'plain');
  state = visitPlace(state, EMBER.id, T0);
  assert.equal(visitPlace(state, EMBER.id, T0 + 3600_000), state, 'the same day again changes nothing');
  state = visitPlace(state, EMBER.id, T0 + DAY);
  assert.equal(welcomeAt(state, EMBER, T0 + DAY), 'plain');
  state = visitPlace(state, EMBER.id, T0 + 2 * DAY);
  assert.equal(visitsTo(state, EMBER.id), WARM_VISITS);
  assert.equal(welcomeAt(state, EMBER, T0 + 2 * DAY), 'warm');
  assert.equal(welcomeLine('warm'), 'They know you here.');
  assert.equal(welcomeLine('plain'), '');
  // only hamlets are counted, and junk changes nothing
  assert.equal(visitPlace(state, 'poi:cave:1,2', T0), state);
  assert.equal(visitPlace(state, EMBER.id, NaN), state);
  assert.equal(visitPlace(null, EMBER.id, T0), null);
});

test('fell one of its trees and the hamlet is cool for as long as the stump stands', () => {
  const today = dayNumber(T0);
  let state = visitPlace(visitPlace(visitPlace(fresh(), EMBER.id, T0 - 2 * DAY), EMBER.id, T0 - DAY), EMBER.id, T0);
  assert.equal(welcomeAt(state, EMBER, T0), 'warm');
  state = markFelled(state, `tree:${EMBER.x + NEAR_TREES},${EMBER.y}`, today);
  assert.equal(felledNear(state, EMBER, T0), true);
  assert.equal(welcomeAt(state, EMBER, T0), 'cool', 'a regular is frowned at too');
  assert.match(welcomeLine('cool'), /frown/);
  assert.match(welcomeLine('cool'), /stall is shut/);
  assert.equal(welcomeAt(state, EMBER, T0 + DAY), 'warm', 'tomorrow the tree is back, and so is the welcome');
  // a tree further off is nobody's
  const far = markFelled(fresh(), `tree:${EMBER.x + NEAR_TREES + 1},${EMBER.y}`, today);
  assert.equal(felledNear(far, EMBER, T0), false);
  assert.equal(felledNear(fresh(), null, T0), false);
});

test('the places Milo is known survive a save, and junk is dropped', () => {
  const state = visitPlace(fresh(), EMBER.id, T0);
  const back = normalizeState(JSON.parse(JSON.stringify(state)), T0);
  assert.deepEqual(back.camplife.places, state.camplife.places);
  assert.deepEqual(emptyCamplife().places, {});
  const odd = cleanCamplife({ places: { [EMBER.id]: { days: 'many', last: '2026-10-05' }, 'poi:cave:1,1': { days: 2, last: '2026-10-05' }, 'poi:hamlet:2,2': { days: 2, last: 'never' }, 'poi:hamlet:3,3': 'x' } });
  assert.deepEqual(odd.places, { [EMBER.id]: { days: 1, last: '2026-10-05' } });
});

test('a hamlet’s bed is the company’s Campfire: once a real day away from home', () => {
  const first = campfire(fresh(), T0, { where: 'lantern' });
  assert.equal(first.ok, true);
  const again = campfire(first.state, T0 + 3600_000, { where: 'lantern' });
  assert.equal(again.ok, false);
  assert.equal(campfire(first.state, T0 + DAY, { where: 'lantern' }).ok, true);
});

// ---- the folk's day ----

test('every hamlet has a seller and a keeper of something, the same people at any hour', () => {
  for (const h of [EMBER, { x: 3, y: 7 }, { x: -40, y: 90 }, { x: 200, y: -33 }]) {
    const all = folkFor(h, folk, { free: open, parts: [WELL, STALL] });
    assert.ok(all.length === 3 || all.length === 4, `${all.length} folk`);
    assert.equal(all[0].role, 'merchant', 'the first is the seller');
    assert.ok(folk.roles.find((r) => r.id === all[1].role).keeper, `the second keeps something: ${all[1].role}`);
    assert.equal(new Set(all.map((p) => p.role)).size, all.length);
    // whoever is out at night has the same name, job and id as by day
    const night = folkFor(h, folk, { free: open, parts: [WELL, STALL], part: 'night' });
    for (const p of night) {
      const day = all.find((d) => d.id === p.id);
      assert.deepEqual([p.name, p.role], [day.name, day.role]);
    }
  }
  assert.ok(folk.roles.filter((r) => r.keeper).length >= 3);
  assert.equal(folk.roles.filter((r) => r.post === 'stall').length, 1);
});

test('at night only those whose job is the night are out', () => {
  const nightJobs = new Set(folk.roles.filter((r) => r.night).map((r) => r.id));
  assert.ok(nightJobs.has('lamplighter') && nightJobs.has('road-watcher'));
  let seenSomeone = false;
  for (let i = 0; i < 40; i += 1) {
    const h = { x: i * 7 - 100, y: i * 11 - 150 };
    const by = folkFor(h, folk, { free: open, parts: [WELL, STALL] });
    const night = folkFor(h, folk, { free: open, parts: [WELL, STALL], part: 'night' });
    assert.ok(night.length < by.length, 'most of the hamlet is asleep');
    for (const p of night) { seenSomeone = true; assert.ok(nightJobs.has(p.role), `${p.role} at night`); }
  }
  assert.ok(seenSomeone);
});

test('in the rain the seller stays under the awning and the rest go in', () => {
  const wet = folkFor(EMBER, folk, { free: open, parts: [WELL, STALL], part: 'afternoon', rain: true });
  assert.ok(wet.some((p) => p.role === 'merchant'));
  for (const p of wet) assert.ok(p.role === 'merchant' || folk.roles.find((r) => r.id === p.role).night, `${p.role} out in the rain`);
  const seller = wet.find((p) => p.role === 'merchant');
  assert.ok(seller.y === STALL.y + 1 || seller.y === STALL.y, 'at the stall');
});

test('of an evening they gather at the well', () => {
  const eve = folkFor(EMBER, folk, { free: open, parts: [WELL, STALL], part: 'evening' });
  const gathered = eve.filter((p) => p.role !== 'merchant' && !folk.roles.find((r) => r.id === p.role).night);
  assert.ok(gathered.length >= 1);
  for (const p of gathered) assert.ok(Math.abs(p.x - WELL.x) <= 2 && Math.abs(p.y - WELL.y) <= 2, `${p.role} is by the well`);
  assert.equal(new Set(eve.map((p) => `${p.x},${p.y}`)).size, eve.length);
  // with no well, they stay where they work
  const dry = folkFor(EMBER, folk, { free: open, parts: [STALL], part: 'evening' });
  assert.deepEqual(dry.map((p) => [p.x, p.y]), folkFor(EMBER, folk, { free: open, parts: [STALL], part: 'morning' }).map((p) => [p.x, p.y]));
});

test('while the hamlet is cool they say so; once it is warm, now and then, something for a regular', () => {
  for (const role of folk.roles) {
    assert.ok(role.cool && role.warm, `${role.id} has both`);
    for (const text of [role.cool, role.warm]) {
      assert.ok(!text.includes('!') && !text.includes("'") && text.length <= 140, text);
      assert.ok(!/…|\.\.\.|—|–|;/.test(text) && !/\b(?:as if|as though|like an?)\b/i.test(text), text);
      assert.ok(!/\b(?:isn’t|is not|aren’t|are not|not)\b[^.?!]{0,60}[.,]\s*(?:it’s|it is|that’s|that is|they’re|they are)\b/i.test(text), text);
    }
  }
  const lines = folk.roles.flatMap((r) => [r.cool, r.warm, ...r.any, ...r.old, ...r.new]);
  assert.equal(new Set(lines).size, lines.length, 'nobody says another’s line');
  const p = folkFor(EMBER, folk, { free: open, parts: [WELL, STALL] })[0];
  for (let d = 0; d < 6; d += 1) assert.equal(folkLine(p, d, 'cool'), p.cool);
  const warm = new Set();
  for (let d = 0; d < 9; d += 1) warm.add(folkLine(p, d, 'warm'));
  assert.ok(warm.has(p.warm) && warm.size >= 2, 'the regular’s line, and the usual ones');
  for (let d = 0; d < 9; d += 1) assert.notEqual(folkLine(p, d, 'plain'), p.warm);
  assert.match(p.cool, /^Shut\./, 'the seller’s stall is shut');
});

// ---- regional kits ----

test('each region builds its own way: wood-villages in the Whisperwood, harbor villages at Mistmere', () => {
  assert.deepEqual(Object.keys(REGION_KITS), ['whisperwood', 'mistmere']);
  assert.equal(kitFor(null, 'old'), KIT.old);
  assert.equal(kitFor('nowhere', 'new'), KIT.new);
  assert.equal(kitFor('mistmere', 'old'), REGION_KITS.mistmere.old);
  for (const [region, kit] of Object.entries(REGION_KITS)) {
    for (const [age, parts] of Object.entries(kit)) {
      assert.ok(parts.some((p) => p.part === 'well') && parts.some((p) => p.part === 'home'), `${region} ${age}`);
      for (const p of parts) {
        assert.ok(SPRITES[p.kind], `${p.kind} is a sprite`);
        assert.ok(FIELD_COVER[p.kind], `${p.kind} is cover`);
      }
    }
  }
  assert.ok(REGION_KITS.whisperwood.old.every((p) => p.part !== 'home' || p.kind === 'cottage.moss'), 'mossy roofs in the wood');
  assert.ok(REGION_KITS.whisperwood.old.some((p) => p.part === 'timber'), 'and timber by the door');
  for (const age of ['old', 'new']) {
    const stall = REGION_KITS.mistmere[age].find((p) => p.part === 'stall');
    assert.equal(stall.odds, undefined, 'a harbor village always has a stall');
    assert.ok(REGION_KITS.mistmere[age].some((p) => p.kind === 'barrel') && REGION_KITS.mistmere[age].some((p) => p.kind === 'crate'));
  }
  assert.notDeepEqual(SPRITES['cottage.moss'][0], SPRITES.cottage[0]);
  assert.deepEqual(SPRITES['cottage.moss'][0].slice(17), SPRITES.cottage[0].slice(17), 'the same walls under the moss');
});

test('a hamlet is laid out from its region’s kit', () => {
  const h = { x: 40, y: 40 };
  const kinds = (region) => layoutSettlement(h, open, { region }).map((p) => p.kind);
  const wood = kinds('whisperwood');
  const harbor = kinds('mistmere');
  assert.ok(wood.includes('woodpile') && (wood.includes('cottage.moss') || hamletAge(h) === 'new'));
  assert.ok(harbor.includes('stall') && harbor.includes('barrel') && harbor.includes('crate'));
  assert.notDeepEqual(wood, kinds(null));
});

test('in the world: Ember and Lark, by Mistmere, are harbor villages with a stall and stores', () => {
  const worldgen = createWorldgen({ seed: 'hushlands', regionWords: riftgen.regionWords });
  const wilds = createWilds({ worldgen, maxChunks: 64 });
  for (const [h, chunk] of [[EMBER, [3, -1]], [{ id: 'poi:hamlet:115,11', x: 115, y: 11 }, [3, 0]]]) {
    wilds.chunk(...chunk);
    assert.equal(wilds.hushRegion(h.x, h.y)?.id, 'mistmere');
    const parts = wilds.objectsIn(h.x - 9, h.y - 9, h.x + 9, h.y + 9).filter((o) => o.place === h.id && o.part);
    assert.ok(parts.some((p) => p.part === 'stall'), `${h.id} has its stall`);
    assert.ok(parts.some((p) => p.part === 'stores'), `${h.id} has its stores`);
  }
});
