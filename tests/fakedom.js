// Shared fakes for engine tests (CONTRACT-PHASE4.md §13 wave 0, §16.3), moved here unchanged
// from tests/world.test.js so every engine suite drives the same fake window. Not a test file.
//
//   import { manualClock, fakeDom, flush, drive, testSpec } from './fakedom.js';
//
// New engine tests pass a manualClock to fakeDom and step it with drive(), never real timers:
// without a clock, fakeDom's animation frames are 16 ms setTimeouts and every walk takes real time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRiftgen } from '../src/world/riftgen.js';

// A frame clock the test drives: advance(ms, each) runs the animation frames due in that time.
export function manualClock() {
  const clock = { t: 1000, frames: new Map(), next: 1 };
  clock.performance = { now: () => clock.t };
  clock.requestAnimationFrame = (cb) => {
    const id = clock.next;
    clock.next += 1;
    clock.frames.set(id, cb);
    return id;
  };
  clock.cancelAnimationFrame = (id) => clock.frames.delete(id);
  clock.advance = (ms, each = () => {}) => {
    for (let left = ms; left > 0; left -= 16) {
      clock.t += 16;
      const due = [...clock.frames.values()];
      clock.frames.clear();
      for (const cb of due) cb(clock.t);
      if (each(clock.t) === false) return;
    }
  };
  return clock;
}

/**
 * A canvas in a fake window and document: fakeDom({ width, height, clock }) → { canvas, listeners,
 * draws, cleanup }. Every drawImage is kept in draws as { image, args, alpha }; a canvas made with
 * createElement keeps what's put into it as element.pixels; any other context call is a no-op.
 */
export function fakeDom({ width = 1000, height = 700, clock = null } = {}) {
  const listeners = {};
  const draws = [];
  // A canvas's context; what's put into it is kept as owner.pixels (so a test can look at a sprite).
  const makeContext = (owner = null) => new Proxy({}, {
    get(target, prop) {
      if (prop === 'drawImage') return (image, ...args) => draws.push({ image, args, alpha: target.globalAlpha ?? 1 });
      if (prop === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'putImageData' && owner) return (image) => { owner.pixels = image.data; };
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const timers = new Set();
  const win = {
    devicePixelRatio: 1,
    performance: clock ? clock.performance : performance,
    requestAnimationFrame(cb) {
      if (clock) return clock.requestAnimationFrame(cb);
      const id = setTimeout(() => {
        timers.delete(id);
        cb(performance.now());
      }, 16);
      timers.add(id);
      return id;
    },
    cancelAnimationFrame(id) {
      if (clock) return clock.cancelAnimationFrame(id);
      clearTimeout(id);
      timers.delete(id);
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = {
    hidden: false,
    defaultView: win,
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      const element = { width: 1, height: 1, pixels: null };
      const context = makeContext(element);
      element.getContext = () => context;
      return element;
    },
  };
  const context = makeContext();
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    ownerDocument: doc,
    clientWidth: width,
    clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    hasAttribute: () => false,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener(type) {
      delete listeners[type];
    },
  };
  return { canvas, listeners, draws, cleanup: () => timers.forEach((id) => clearTimeout(id)) };
}

/** Lets pending promise callbacks run (eight microtask turns). */
export const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

// Runs the manual clock until a promise settles; → its value.
export async function drive(clock, promise, ms = 30000) {
  let settled = false;
  let value;
  promise.then((v) => { settled = true; value = v; });
  for (let t = 0; t < ms && !settled; t += 100) {
    clock.advance(100);
    await flush();
  }
  assert.ok(settled, 'it settles');
  return value;
}

let riftgen = null;
let genres = null;
const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));

// A synthetic rift with these genres at this stage (the generator's own, nothing real).
export function testSpec(genreIds, stage, salt = 0) {
  if (!riftgen) {
    genres = read('genres');
    riftgen = createRiftgen({ words: read('riftgen'), genres });
  }
  const weights = Object.fromEntries(genres.genres.map((g) => [g.id, genreIds.includes(g.id) ? 400 : 0.0001]));
  for (let seed = 1 + salt * 7919; seed < 20000 + salt * 7919; seed += 1) {
    const spec = riftgen.wildRift({ seed, tier: 2, depth: 1, weights });
    if (spec.stage === stage && spec.genres.length === genreIds.length && genreIds.every((g) => spec.genres.includes(g))) return spec;
  }
  throw new Error(`no ${genreIds} ${stage} spec`);
}
