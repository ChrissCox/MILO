// The sky (src/sky.js, content/sky.json): day and night from the real clock, seasons from the
// real date, weather from a seeded daily roll, and a key that changes only when what's drawn does.
// CONTRACT-PHASE4.md §7.6, §9.11, §12.4 (the Westwatch's night).
// Run: node --test tests/sky.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { skyAt, isNight, DEFAULT_SKY, DAYPARTS, SEASONS, WEATHER_KINDS } from '../src/sky.js';
import { dayNumber } from '../src/clean.js';
import { hashInts, hashString, unit } from '../src/world/rng.js';
import { PALETTE } from '../src/world/sprites.js';
import { assertCalm } from './calm.js';

const sky = JSON.parse(readFileSync(new URL('../content/sky.json', import.meta.url), 'utf8'));
const MIN = 60 * 1000;
const at = (m, d, h = 12, min = 0) => new Date(2026, m - 1, d, h, min, 0).getTime(); // local time, 2026
const opts = { sky };

test('sky.json holds the sun table, tints, seasons, weather and particles, and the code’s defaults are the file', () => {
  assert.equal(sky.version, 1);
  assertCalm(sky.about, 'sky.about', { proper: ['CONTRACT-PHASE4.md', 'Hushlands'] });
  const { version, about, ...rest } = sky;
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_SKY)), rest);
  assert.deepEqual(Object.keys(sky.sun), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  for (const [month, { rise, set }] of Object.entries(sky.sun)) {
    assert.match(rise, /^\d\d:\d\d$/, month);
    assert.match(set, /^\d\d:\d\d$/, month);
    assert.ok(rise < set, `${month}: the sun rises before it sets`);
  }
  assert.deepEqual(sky.sun['1'], { rise: '07:40', set: '17:10' });
  assert.equal(sky.twilight, 40);
  assert.deepEqual(sky.tints, { dawn: [255, 214, 170, 0.12], dusk: [255, 170, 120, 0.16], night: [40, 50, 110, 0.38] });
  assert.deepEqual(Object.values(sky.seasons).flat().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'every month in one season');
  assert.deepEqual(Object.keys(sky.seasons), [...SEASONS]);
  assert.deepEqual(Object.keys(sky.weather), [...SEASONS]);
  for (const weights of Object.values(sky.weather)) {
    for (const [kind, w] of Object.entries(weights)) assert.ok(WEATHER_KINDS.includes(kind) && w > 0, kind);
  }
  for (const [kind, particle] of Object.entries(sky.particles)) {
    assert.ok(WEATHER_KINDS.includes(kind) && kind !== 'clear', kind);
    assert.ok(Object.hasOwn(PALETTE, particle.key), `${kind} draws with a palette key`);
    assert.ok(particle.density > 0 && particle.density < 0.05);
  }
});

test('the dayparts follow the month’s sun, with twilight either side', () => {
  // September: sunrise 07:05, sunset 19:30, twilight 40 minutes.
  const cases = [
    [0, 30, 'night'], [6, 24, 'night'], [6, 25, 'dawn'], [7, 44, 'dawn'], [7, 45, 'day'], [12, 0, 'day'],
    [18, 49, 'day'], [18, 50, 'dusk'], [20, 9, 'dusk'], [20, 10, 'night'], [23, 59, 'night'],
  ];
  for (const [h, m, part] of cases) assert.equal(skyAt(at(9, 29, h, m), opts).daypart, part, `${h}:${m}`);
  assert.equal(skyAt(at(6, 21, 21, 0), opts).daypart, 'dusk', 'midsummer evenings are long');
  assert.equal(skyAt(at(12, 21, 18, 0), opts).daypart, 'night', 'midwinter evenings are short');
  const noon = skyAt(at(9, 29, 12), opts);
  assert.deepEqual([noon.light, noon.night, noon.tint], [1, false, [255, 255, 255, 0]]);
  const midnight = skyAt(at(9, 29, 0), opts);
  assert.deepEqual([midnight.light, midnight.night, midnight.tint], [0, true, [40, 50, 110, 0.38]]);
  for (const part of DAYPARTS) assert.ok(['dawn', 'day', 'dusk', 'night'].includes(part));
});

test('light and tint move through dawn and dusk in ten-minute steps', () => {
  let last = -1;
  for (let m = 0; m < 80; m += 10) {
    const s = skyAt(at(9, 29, 6, 25) + m * MIN, opts);
    assert.equal(s.daypart, 'dawn');
    assert.ok(s.light > last, `light rises at dawn (${m})`);
    last = s.light;
    assert.equal(s.tint.length, 4);
  }
  assert.deepEqual(skyAt(at(9, 29, 6, 25), opts).tint, [40, 50, 110, 0.38], 'dawn begins in the night’s tint');
  const dusk = [0, 20, 40, 60, 70].map((m) => skyAt(at(9, 29, 18, 50) + m * MIN, opts).light);
  assert.deepEqual(dusk, [...dusk].sort((a, b) => b - a), 'light falls at dusk');
  assert.deepEqual(skyAt(at(9, 29, 18, 50), opts).tint, [255, 170, 120, 0], 'dusk begins clear');
  assert.equal(skyAt(at(9, 29, 18, 50) + 40 * MIN, opts).tint[3], 0.16, 'and deepens to its own tint');
});

test('the key changes only when what’s drawn changes', () => {
  const start = at(9, 29, 0, 0);
  const keys = [];
  let changes = 0;
  let previous = null;
  for (let m = 0; m < 24 * 60; m += 1) {
    const s = skyAt(start + m * MIN, opts);
    if (previous && s.key !== previous.key) {
      changes += 1;
      const clock = new Date(start + m * MIN);
      assert.equal(clock.getMinutes() % 5, 0, `the key changes only on a ten-minute step (${clock.toTimeString().slice(0, 5)})`);
    }
    if (previous && s.key === previous.key) {
      assert.deepEqual([s.daypart, s.light, s.tint, s.weather], [previous.daypart, previous.light, previous.tint, previous.weather], 'the same key draws the same sky');
    }
    previous = s;
    keys.push(s.key);
  }
  assert.ok(changes >= 16 && changes <= 20, `${changes} changes in a day: eight steps each through dawn and dusk, and the four daypart changes`);
});

test('seasons come from the month', () => {
  const want = { 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring', 6: 'summer', 7: 'summer', 8: 'summer', 9: 'autumn', 10: 'autumn', 11: 'autumn', 12: 'winter' };
  for (const [month, season] of Object.entries(want)) assert.equal(skyAt(at(Number(month), 15), opts).season, season, month);
});

test('weather is one seeded roll a day, from the season’s weights', () => {
  const day = at(9, 29, 1);
  const first = skyAt(day, opts).weather;
  for (const h of [3, 9, 15, 22]) assert.deepEqual(skyAt(at(9, 29, h), opts).weather, first, 'the same all day');
  const roll = unit(hashInts(hashString('hushlands'), dayNumber(day), 'weather'));
  const weights = sky.weather.autumn;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let left = roll * total;
  let want = 'clear';
  for (const [kind, w] of Object.entries(weights)) { left -= w; if (left < 0) { want = kind; break; } }
  assert.equal(first.kind, want, 'hashInts(hashString(seed), dayNumber(now), \'weather\') against the weights');
  assert.deepEqual(first, want === 'clear' ? { kind: 'clear', density: 0, key: '' } : { kind: want, density: sky.particles[want].density, key: sky.particles[want].key });
  // Over many autumn days, each kind comes up about as often as its weight says.
  const counts = {};
  let n = 0;
  for (let year = 2000; year < 2060; year += 1) {
    for (const month of [9, 10, 11]) {
      for (let d = 1; d <= 28; d += 1) {
        const kind = skyAt(new Date(year, month - 1, d, 12).getTime(), opts).weather.kind;
        counts[kind] = (counts[kind] || 0) + 1;
        n += 1;
      }
    }
  }
  for (const [kind, w] of Object.entries(weights)) {
    const share = counts[kind] / n;
    assert.ok(Math.abs(share - w / total) < 0.03, `${kind}: ${(share * 100).toFixed(1)}% against ${((w / total) * 100).toFixed(1)}%`);
  }
  assert.ok(!('snow' in counts), 'no snow in autumn');
  const other = Array.from({ length: 60 }, (_, i) => skyAt(at(9, 1, 12) + i * 86400000, { seed: 'moonrise', sky }).weather.kind);
  const ours = Array.from({ length: 60 }, (_, i) => skyAt(at(9, 1, 12) + i * 86400000, opts).weather.kind);
  assert.notDeepEqual(other, ours, 'another world has its own weather');
});

test('isNight reads the same sun table as skyAt (it replaces the Westwatch’s 20:00–06:00)', () => {
  for (let m = 0; m < 24 * 60; m += 5) {
    const now = at(9, 29, 0) + m * MIN;
    assert.equal(isNight(now, opts), skyAt(now, opts).night);
  }
  assert.equal(isNight(at(9, 29, 21), opts), true);
  assert.equal(isNight(at(9, 29, 12), opts), false);
  assert.equal(isNight(at(9, 29, 5, 30), opts), true);
  assert.equal(isNight(at(9, 29, 21), {}), true, 'without content the defaults are the file');
});

test('the same moment always gives the same sky, and junk never throws', () => {
  const now = at(3, 29, 19, 42);
  assert.deepEqual(skyAt(now, opts), skyAt(now, opts));
  assert.deepEqual(skyAt(now, {}), skyAt(now, opts), 'the defaults are the file');
  for (const junk of [null, 'x', { sun: 5, tints: [], seasons: null, weather: 'x', particles: 7, twilight: -5 }]) {
    assert.doesNotThrow(() => skyAt(now, { sky: junk }));
    assert.ok(DAYPARTS.includes(skyAt(now, { sky: junk }).daypart));
  }
  for (const bad of [undefined, NaN, 'soon']) assert.doesNotThrow(() => skyAt(bad, opts));
});
