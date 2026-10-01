// Phase 3's worlds stay put (CONTRACT-PHASE4.md §1's promise, §16.2): every rift spec, layout,
// Elsewhere scene, worldgen chunk, wild object, stray sprite and wild stray in
// tests/fixtures/phase3-golden.json (hashed at 0b8f5ae by tests/fixtures/make-golden.mjs) is rebuilt
// here with the same builders and must hash the same. Only a layout's roomRects and the tale-lead
// object's name and label are ignored.
//   node --test tests/golden.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOLDEN_FILE, GROUPS, BASELINE, goldenCases, hashValue, layoutView, sceneView } from './fixtures/make-golden.mjs';

const golden = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
const cases = goldenCases();

const WHAT = {
  specs: 'rift specs (wildRift, realRift, deeper)',
  layouts: 'layouts (riftgen.layout, without roomRects)',
  scenes: 'Elsewhere scenes (ground, objects, spawn, strays)',
  worldgen: 'worldgen chunks, fixed places and wild rift spawns',
  wildObjects: 'wild objects (createWilds().chunk().objects)',
  strays: 'stray sprites (composeStray at 20×20)',
  wildActors: 'wild strays (strayActors: ids, homes, temperaments, places)',
};

test('the golden fixture was made from the Phase 3 baseline and names every group', () => {
  assert.equal(golden.version, 1);
  assert.equal(golden.baseline, BASELINE);
  assert.deepEqual(Object.keys(golden.groups), GROUPS);
  const floors = { specs: 450, layouts: 450, scenes: 100, worldgen: 600, wildObjects: 49, strays: 900, wildActors: 50 };
  for (const group of GROUPS) {
    const n = Object.keys(golden.groups[group]).length;
    assert.ok(n >= floors[group], `${group}: ${n} cases`);
    assert.ok(Object.values(golden.groups[group]).every((h) => /^[0-9a-f]{64}$/.test(h)), `${group}: every entry is a SHA-256`);
  }
});

for (const group of GROUPS) {
  test(`Phase 3’s ${WHAT[group]} are byte-identical`, () => {
    const want = golden.groups[group];
    const built = cases[group];
    assert.deepEqual(built.map((c) => c.key), Object.keys(want), `${group}: the same cases, in the same order`);
    const changed = [];
    for (const { key, value } of built) {
      if (hashValue(value()) !== want[key]) changed.push(key);
    }
    assert.equal(changed.length, 0, `${group}: ${changed.length} of ${built.length} changed since ${BASELINE}, first ${changed.slice(0, 10).join(', ')}`);
  });
}

test('the golden test ignores exactly a layout’s roomRects and the tale-lead’s name and label', () => {
  const layout = { w: 3, h: 1, rows: ['E.B'], rooms: 2, entrance: { x: 0, y: 0 } };
  assert.equal(hashValue(layoutView({ ...layout, roomRects: [{ id: 0, x: 0, y: 0, w: 3, h: 1, role: 'lead' }] })), hashValue(layoutView(layout)));
  assert.notEqual(hashValue(layoutView({ ...layout, rooms: 3 })), hashValue(layoutView(layout)));

  const stray = { id: 'stray:rift:a:0', name: 'A drone', home: { x: 1, y: 1 }, positionAt: (t) => ({ x: 24, y: 29, dir: 'down', moving: t > 0 }) };
  const scene = (lead, extra = {}) => ({
    ground: new Uint8Array([1, 2, 3]),
    objects: [{ id: 'exit', kind: 'exit', label: 'The way home' }, { id: 'tale-lead', kind: 'tale-lead', x: 2, y: 0, ...lead }],
    spawn: { x: 1, y: 0, dir: 'down' },
    strays: [stray],
    ...extra,
  });
  const base = hashValue(sceneView(scene({ name: 'The Duke of Rain', label: 'The Duke of Rain', line: 'Rain.' })));
  assert.equal(hashValue(sceneView(scene({ name: 'The Duke of Mist', label: 'The Duke of Mist', line: 'Rain.' }))), base, 'a lead’s shown name may change');
  assert.notEqual(hashValue(sceneView(scene({ name: 'The Duke of Rain', label: 'The Duke of Rain', line: 'Mist.' }))), base, 'its line may not');
  assert.notEqual(hashValue(sceneView(scene({ name: 'The Duke of Rain', label: 'The Duke of Rain', line: 'Rain.' }, { ground: new Uint8Array([1, 2, 4]) }))), base, 'nor the ground');
  const renamed = scene({ name: 'The Duke of Rain', label: 'The Duke of Rain', line: 'Rain.' });
  renamed.objects[0] = { ...renamed.objects[0], label: 'The door' };
  assert.notEqual(hashValue(sceneView(renamed)), base, 'nor any other object’s label');
});

test('a typed array hashes as the plain array JSON would write', () => {
  const plain = (v) => JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x));
  const value = { a: new Uint8Array([0, 255, 7]), b: [new Int16Array([-3, 4]), 'text'], c: new Float32Array(0) };
  assert.equal(plain(value), '{"a":[0,255,7],"b":[[-3,4],"text"],"c":[]}');
  assert.equal(hashValue(value), hashValue(JSON.parse(plain(value))));
  assert.notEqual(hashValue({ a: new Uint8Array([1]) }), hashValue({ a: new Uint8Array([2]) }));
});
