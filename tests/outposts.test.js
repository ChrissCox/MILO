// Phase 6: outposts, the Hold's claimed lanterns, each with a little ward of its own.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, normalizeState, lightLantern } from '../src/model.js';
import {
  OUTPOSTS_FROM_TIER, OUTPOST_RADIUS, OUTPOST_COST, outpostLimit, lanternTile, outposts, nearOutpost, outpostView, claimOutpost,
} from '../src/outposts.js';
import { cleanCamplife } from '../src/state5.js';
import { lanternPanel } from '../src/ui/panels.js';

const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const A = 'lantern:28,-14';
const B = 'lantern:80,-6';
const C = 'lantern:-12,18';
const stocked = (tier = 3) => {
  let s = createState(T0);
  s = { ...s, hearth: { ...s.hearth, tier }, satchel: { ...s.satchel, materials: { ...s.satchel.materials, birch: 100, stone: 100 } } };
  for (const id of [A, B, C]) s = lightLantern(s, id, T0);
  return s;
};

test('outposts open with the Hold: two at the Hold, two more with each tier', () => {
  assert.deepEqual([OUTPOSTS_FROM_TIER, OUTPOST_RADIUS, OUTPOST_COST], [3, 6, { birch: 20, stone: 10 }]);
  assert.deepEqual([1, 2, 3, 4, 5, 8].map((tier) => outpostLimit({ hearth: { tier } })), [0, 0, 2, 4, 6, 12]);
  assert.equal(outpostLimit(null), 0);
  assert.deepEqual(lanternTile(A), { x: 28, y: -14 });
  assert.equal(lanternTile('poi:hamlet:1,2'), null);
  assert.equal(lanternTile(7), null);
});

test('a lit lantern can be claimed once the Hold stands, for 20 birch and 10 stone', () => {
  assert.equal(outpostView(stocked(2), A).state, 'none', 'not before the Hold');
  const dark = { ...stocked(), wilds: { ...stocked().wilds, lanterns: {} } };
  assert.equal(outpostView(dark, A).state, 'none', 'a sleeping lantern is nobody’s');
  const view = outpostView(stocked(), A);
  assert.deepEqual([view.state, view.can, view.problem], ['open', true, '']);
  assert.deepEqual(view.cost, [{ id: 'birch', need: 20, have: 100 }, { id: 'stone', need: 10, have: 100 }]);
  const r = claimOutpost(stocked(), A, T0 + 1000);
  assert.equal(r.ok, true);
  assert.deepEqual([r.state.satchel.materials.birch, r.state.satchel.materials.stone], [80, 90]);
  assert.deepEqual(outposts(r.state), [{ id: A, x: 28, y: -14, at: T0 + 1000 }]);
  assert.equal(outpostView(r.state, A).state, 'claimed');
  assert.equal(claimOutpost(r.state, A, T0 + 2000).ok, false, 'once');
  assert.equal(claimOutpost(stocked(2), A, T0).ok, false);
  assert.equal(claimOutpost(stocked(), 'poi:cave:1,2', T0).ok, false);
  assert.equal(claimOutpost(stocked(), A, NaN).ok, false);
});

test('it needs the materials, and no more than the Hold allows', () => {
  const poor = { ...stocked(), satchel: { ...stocked().satchel, materials: { birch: 19, stone: 100 } } };
  const view = outpostView(poor, A);
  assert.deepEqual([view.state, view.can], ['open', false]);
  assert.equal(view.problem, 'Needs 20 birch and 10 stone.');
  assert.equal(claimOutpost(poor, A, T0).state, poor);
  let s = stocked();
  s = claimOutpost(s, A, T0).state;
  s = claimOutpost(s, B, T0 + 1).state;
  assert.equal(outposts(s).length, 2);
  const third = outpostView(s, C);
  assert.deepEqual([third.can, third.problem], [false, 'Every outpost the Hold allows is taken.']);
  assert.equal(outpostView({ ...s, hearth: { ...s.hearth, tier: 4 } }, C).can, true, 'the Keep allows two more');
});

test('no rift opens within six tiles of an outpost, and the ward is a circle', () => {
  const s = claimOutpost(stocked(), A, T0).state;
  assert.equal(nearOutpost(s, 28, -14), true);
  assert.equal(nearOutpost(s, 34, -14), true, 'six tiles out');
  assert.equal(nearOutpost(s, 35, -14), false);
  assert.equal(nearOutpost(s, 32, -10), true, 'a diagonal inside the circle');
  assert.equal(nearOutpost(s, 33, -9), false, 'and one outside it');
  assert.equal(nearOutpost(stocked(), 28, -14), false, 'a lantern not claimed has no ward');
  assert.equal(nearOutpost(null, 0, 0), false);
});

test('outposts are saved, and junk is dropped', () => {
  const s = claimOutpost(stocked(), A, T0).state;
  const back = normalizeState(JSON.parse(JSON.stringify(s)), T0 + 1000);
  assert.deepEqual(back.camplife.outposts, { [A]: T0 });
  const odd = cleanCamplife({ outposts: { [A]: T0, 'lantern:x,y': T0, 'poi:hamlet:1,1': T0, [B]: 'never', [C]: -5 } });
  assert.deepEqual(odd.outposts, { [A]: T0 });
  assert.deepEqual(cleanCamplife(null).outposts, {});
});

test('the lantern’s panel offers it, shows what it costs, and says when it is yours', () => {
  const view = (state) => ({ id: A, title: 'A lantern', lines: [], lit: true, wake: false, travel: [], says: '', outpost: outpostView(state, A) });
  let html = lanternPanel(view(stocked()));
  assert.match(html, /data-action="claim-outpost"[^>]*>Make it an outpost</);
  assert.match(html, /100 of 20 birch, 100 of 10 stone\./);
  assert.ok(!/data-action="claim-outpost"[^>]*disabled/.test(html));
  html = lanternPanel(view({ ...stocked(), satchel: { ...stocked().satchel, materials: { birch: 1, stone: 1 } } }));
  assert.match(html, /data-action="claim-outpost"[^>]*disabled/);
  html = lanternPanel(view(claimOutpost(stocked(), A, T0).state));
  assert.match(html, /An outpost of yours\. No rift opens near it\./);
  assert.ok(!html.includes('claim-outpost'));
  assert.ok(!lanternPanel(view(stocked(2))).includes('claim-outpost'), 'nothing before the Hold');
});
