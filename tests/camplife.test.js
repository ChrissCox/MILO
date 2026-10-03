// Phase 5.4: what Milo gathers while you focus, and what the fire makes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, normalizeState } from '../src/model.js';
import { kindleStart, kindleTick, kindleStop, FOCUS_MS } from '../src/kindle.js';
import { cleanCamplife, emptyCamplife } from '../src/state5.js';
import {
  ACTIVITIES, ACTIVITY_IDS, GATHER_SKILLS, ITEM_NAMES, ITEM_IDS, RECIPES, RECIPE_IDS, chooseGather, haulFor, payHaul, itemsWords, haulWords,
  cookView, cook, MAX_TONICS, MAX_CHEERS, GATHER_XP, RARE_FROM,
} from '../src/camplife.js';

const T0 = new Date(2026, 9, 5, 10, 0, 0).getTime();
const fresh = () => createState(T0);
const sum = (items) => Object.values(items).reduce((a, b) => a + b, 0);
const withLevel = (state, skill, xp) => ({ ...state, xp: { ...state.xp, skills: { ...state.xp.skills, [skill]: xp } } });
const withMaterials = (state, add) => ({ ...state, satchel: { ...state.satchel, materials: { ...state.satchel.materials, ...add } } });

test('the lists agree: every activity, item and recipe is known to the saved state', () => {
  assert.deepEqual(ACTIVITY_IDS, Object.keys(ACTIVITIES));
  assert.deepEqual([...GATHER_SKILLS], ACTIVITY_IDS);
  assert.deepEqual([...ITEM_IDS], Object.keys(ITEM_NAMES));
  assert.deepEqual([...RECIPE_IDS], RECIPES.map((r) => r.id));
  for (const a of Object.values(ACTIVITIES)) assert.ok(a.items.every((i) => ITEM_IDS.includes(i)));
  for (const r of RECIPES) assert.ok(Object.keys(r.needs).every((i) => ITEM_IDS.includes(i)));
});

test('a fresh state gathers nothing, and the choice is kept', () => {
  assert.deepEqual(fresh().camplife, emptyCamplife());
  const start = fresh();
  assert.equal(chooseGather(start, 'bogus'), start, 'an unknown choice changes nothing');
  const s = chooseGather(fresh(), 'fishing');
  assert.equal(s.camplife.gather, 'fishing');
  assert.equal(chooseGather(s, 'fishing'), s, 'the same choice changes nothing');
  assert.equal(chooseGather(s, null).camplife.gather, null);
  assert.equal(normalizeState(JSON.parse(JSON.stringify(s)), T0).camplife.gather, 'fishing');
});

test('a haul is three to five things, the same every time, with better kinds from level 5', () => {
  for (const activity of ACTIVITY_IDS) {
    const a = haulFor(fresh(), activity, T0);
    assert.deepEqual(a, haulFor(fresh(), activity, T0));
    assert.ok(a.count >= 3 && a.count <= 5 && sum(a.items) === a.count, `${activity}: ${a.count}`);
    assert.ok(Object.keys(a.items).every((id) => ACTIVITIES[activity].items.includes(id)));
  }
  for (let i = 0; i < 40; i += 1) assert.equal(haulFor(fresh(), 'fishing', T0 + i).items.trout, undefined, 'no trout at level 1');
  const skilled = withLevel(fresh(), 'fishing', 400); // level 5 and above
  assert.ok(Array.from({ length: 40 }, (_, i) => haulFor(skilled, 'fishing', T0 + i).items.trout || 0).some((n) => n > 0), 'trout turn up');
  assert.ok(RARE_FROM === 5);
  const high = withLevel(fresh(), 'mining', 3_000_000);
  assert.ok(haulFor(high, 'mining', T0).count > 5, 'a higher level brings more');
});

test('a finished focus session pays its haul once, with XP; stopping early pays nothing', () => {
  let state = chooseGather(fresh(), 'foraging');
  state = kindleStart(state, T0).state;
  const mid = kindleTick(state, T0 + FOCUS_MS / 2);
  assert.equal(mid.state.camplife.last, null);
  const done = kindleTick(state, T0 + FOCUS_MS + 1000);
  const last = done.state.camplife.last;
  assert.equal(last.session, T0);
  assert.deepEqual(last.items, haulFor(state, 'foraging', T0).items);
  for (const [id, n] of Object.entries(last.items)) assert.equal(done.state.satchel.materials[id], n);
  assert.equal(done.state.xp.skills.foraging, GATHER_XP);
  const again = kindleTick(done.state, T0 + FOCUS_MS + 60_000);
  assert.deepEqual(again.state.satchel.materials, done.state.satchel.materials, 'it pays once');
  assert.equal(payHaul(done.state, T0, T0 + FOCUS_MS).haul, null, 'asking again pays nothing');
  // stopped early: no haul
  const stopped = kindleStop(kindleStart(chooseGather(fresh(), 'mining'), T0).state, T0 + 10 * 60_000);
  assert.equal(stopped.state.camplife.last, null);
  assert.equal(stopped.state.satchel.materials.stone, undefined);
});

test('with nothing chosen, a focus session brings nothing home', () => {
  const done = kindleTick(kindleStart(fresh(), T0).state, T0 + FOCUS_MS + 1);
  assert.equal(done.state.camplife.last, null);
  assert.equal(done.state.xp.skills.woodcutting, undefined);
});

test('the words for what came home', () => {
  assert.equal(itemsWords({ trout: 3, minnow: 1 }), '3 trout and 1 minnow');
  assert.equal(itemsWords({ berries: 4 }), '4 berries');
  assert.equal(itemsWords({}), '');
  const done = kindleTick(kindleStart(chooseGather(fresh(), 'woodcutting'), T0).state, T0 + FOCUS_MS + 1);
  assert.match(haulWords(done.state), /^Milo chopped and brought back /);
  assert.equal(haulWords(fresh()), '');
});

test('the fire: berries make a cordial, and it trains Cooking', () => {
  let state = withMaterials(fresh(), { berries: 5 });
  const view = cookView(state).find((r) => r.id === 'cordial');
  assert.deepEqual([view.can, view.needs[0].have, view.needs[0].n], [true, 5, 3]);
  const r = cook(state, 'cordial', T0);
  assert.equal(r.ok, true);
  assert.equal(r.state.satchel.materials.berries, 2);
  assert.equal(r.state.satchel.tonics.cordial, 1);
  assert.equal(r.state.xp.skills.cooking, 120);
  assert.equal(r.state.camplife.cooked.cordial, 1);
  assert.equal(cook(r.state, 'cordial', T0).ok, false, 'two berries are not enough');
  assert.equal(cook(r.state, 'cordial', T0).why, 'Not enough yet');
});

test('a recipe asks for its level, and never wastes a full tonic or a full set of Cheers', () => {
  let state = withMaterials(fresh(), { trout: 4, herbs: 4, minnow: 8 });
  assert.equal(cook(state, 'trout-stew', T0).why, 'Cooking level 3');
  state = withLevel(state, 'cooking', 500);
  const stew = cook(state, 'trout-stew', T0);
  assert.equal(stew.ok, true);
  assert.equal(stew.state.party.cheers, 2);
  assert.deepEqual([stew.state.satchel.materials.trout, stew.state.satchel.materials.herbs], [2, 3]);
  let s = stew.state;
  s = cook(s, 'trout-stew', T0).state;
  assert.equal(s.party.cheers, MAX_CHEERS);
  assert.equal(cook(s, 'minnow-supper', T0).why, 'Everyone is cheered');
  const full = { ...withMaterials(fresh(), { herbs: 3 }) };
  full.satchel = { ...full.satchel, tonics: { cordial: 0, brew: MAX_TONICS } };
  assert.equal(cook(full, 'brew', T0).why, 'Full');
});

test('the saved section repairs itself', () => {
  for (const junk of [null, 3, 'x', [], { gather: 'swimming', last: 5, cooked: 'lots' }, { last: { activity: 'fishing' } }]) {
    const c = cleanCamplife(junk);
    assert.ok(c.gather === null && c.last === null && typeof c.cooked === 'object');
  }
  const ok = cleanCamplife({ gather: 'mining', last: { session: T0, at: T0 + 1, activity: 'mining', items: { stone: 3, bogus: 9 } }, cooked: { cordial: 2, nope: 4 } });
  assert.deepEqual(ok, { gather: 'mining', last: { session: T0, at: T0 + 1, activity: 'mining', items: { stone: 3 } }, cooked: { cordial: 2 }, places: {}, outposts: {} });
});

test('the Blossomfield: a flower for every finished quest, only ever adding to the field', async () => {
  const { blossomTiles, blossomsFor, BLOSSOM_AREA, FLOWER_KINDS } = await import('../src/world/blossoms.js');
  const tiles = blossomTiles();
  assert.ok(tiles.length > 40, `room for ${tiles.length} flowers`);
  assert.ok(tiles.every((t) => t.x >= BLOSSOM_AREA.x && t.x < BLOSSOM_AREA.x + BLOSSOM_AREA.w && t.y >= BLOSSOM_AREA.y && t.y < BLOSSOM_AREA.y + BLOSSOM_AREA.h));
  assert.equal(new Set(tiles.map((t) => `${t.x},${t.y}`)).size, tiles.length, 'one flower to a tile');
  assert.deepEqual(blossomsFor(0), []);
  const five = blossomsFor(5);
  assert.equal(five.length, 5);
  assert.deepEqual(blossomsFor(12).slice(0, 5), five, 'a new flower only adds to the field');
  assert.deepEqual(blossomsFor(5), five, 'the same every time');
  assert.equal(blossomsFor(10_000).length, tiles.length, 'the field has an end');
  assert.ok(five.every((f) => FLOWER_KINDS.includes(f.kind) && f.jx >= 0 && f.jx < 8 && f.jy >= 0 && f.jy < 8));
  assert.deepEqual(blossomsFor(-3), []);
});
