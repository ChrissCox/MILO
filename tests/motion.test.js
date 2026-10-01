// Walking under reduced motion (src/world/engine.js). When the system asks for reduced motion,
// Milo still walks his path to where you clicked, and only decoration holds still; MILO's own
// Motion setting, switched off, still makes him arrive at once.
//
//   node --test tests/motion.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeById } from '../src/world/map.js';
import { createWorld } from '../src/world/engine.js';
import { manualClock, fakeDom, flush } from './fakedom.js';

// A fake window whose system setting asks for reduced motion (or doesn't).
function worldWith({ reduced, motion }) {
  const clock = manualClock();
  const dom = fakeDom({ clock });
  dom.canvas.ownerDocument.defaultView.matchMedia = () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} });
  const world = createWorld(dom.canvas, { motion: () => motion, startTile: placeById('plot-orchard').door });
  return { clock, world, dom };
}

const same = (a, b) => a.x === b.x && a.y === b.y;

test('with the system asking for reduced motion, Milo walks tile by tile to where he was sent', async () => {
  const { clock, world, dom } = worldWith({ reduced: true, motion: true });
  try {
    const start = world.miloTile();
    const goal = placeById('plot-rise').door;
    let arrived = false;
    const walk = world.walkTo('plot-rise').then(() => { arrived = true; });
    await flush();
    assert.ok(same(world.miloTile(), start), 'he hasn’t jumped anywhere yet');
    const seen = [];
    for (let ms = 0; ms < 30000 && !arrived; ms += 100) {
      clock.advance(100);
      await flush();
      const tile = world.miloTile();
      if (!seen.length || !same(seen[seen.length - 1], tile)) seen.push(tile);
    }
    await walk;
    assert.ok(same(world.miloTile(), goal), 'he ends at the door he was sent to');
    assert.ok(seen.length >= 4, `he passed through the tiles between (${seen.length} seen)`);
    for (let i = 1; i < seen.length; i += 1) {
      const step = Math.abs(seen[i].x - seen[i - 1].x) + Math.abs(seen[i].y - seen[i - 1].y);
      assert.equal(step, 1, 'one tile at a time, never a jump');
    }
  } finally {
    world.dispose();
    dom.cleanup();
  }
});

test('under reduced motion the loop runs only while somebody walks, then the world rests', async () => {
  const { clock, world, dom } = worldWith({ reduced: true, motion: true });
  try {
    clock.advance(200);
    await flush();
    assert.equal(clock.frames.size, 0, 'nobody walking: no animation frames are asked for');
    let arrived = false;
    world.walkTo('plot-rise').then(() => { arrived = true; });
    await flush();
    assert.ok(clock.frames.size > 0, 'a walk starts the loop');
    for (let ms = 0; ms < 30000 && !arrived; ms += 100) {
      clock.advance(100);
      await flush();
    }
    assert.ok(arrived, 'he arrives');
    clock.advance(100);
    await flush();
    assert.equal(clock.frames.size, 0, 'once he’s there, the loop stops again');
  } finally {
    world.dispose();
    dom.cleanup();
  }
});

test('with MILO’s own Motion switched off, he still arrives at once', async () => {
  for (const reduced of [false, true]) {
    const { world, dom } = worldWith({ reduced, motion: false });
    try {
      await world.walkTo('plot-rise');
      assert.ok(same(world.miloTile(), placeById('plot-rise').door), `there at once (system reduced: ${reduced})`);
    } finally {
      world.dispose();
      dom.cleanup();
    }
  }
});

test('with full motion, the walk takes time as it always has', async () => {
  const { clock, world, dom } = worldWith({ reduced: false, motion: true });
  try {
    let arrived = false;
    world.walkTo('plot-rise').then(() => { arrived = true; });
    clock.advance(200);
    await flush();
    assert.equal(arrived, false, 'still on the way after 200 ms');
    for (let ms = 0; ms < 30000 && !arrived; ms += 100) {
      clock.advance(100);
      await flush();
    }
    assert.ok(arrived);
  } finally {
    world.dispose();
    dom.cleanup();
  }
});
