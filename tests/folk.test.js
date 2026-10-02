// Phase 5b.1: the folk of the hamlets, and everyone standing where their story is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { folkFor, folkLine, hamletAge, ageLine, FOLK_DYES, folkLook } from '../src/world/folk.js';
import { PALETTE } from '../src/world/sprites.js';
import { registerLook, exploreFrames } from '../src/world/sprites-party.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { lastBridge } from '../src/world/trail.js';

const folk = JSON.parse(readFileSync(new URL('../content/people/folk.json', import.meta.url), 'utf8'));
const dir = new URL('../content/people/npcs/', import.meta.url);
const npcs = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')));
const HAMLET = { id: 'poi:hamlet:106,-5', x: 106, y: -5, name: 'Ember Hamlet' };
const open = () => true;

test('the folk file: names, ten jobs, and lines for any hamlet, an old one and a new one', () => {
  assert.ok(folk.names.length >= 20 && new Set(folk.names).size === folk.names.length, 'names are many and distinct');
  assert.ok(folk.roles.length >= 8);
  assert.equal(new Set(folk.roles.map((r) => r.id)).size, folk.roles.length);
  for (const age of ['old', 'new']) assert.ok(folk.ages[age]);
  for (const role of folk.roles) {
    assert.match(role.id, /^[a-z][a-z-]{1,30}$/);
    assert.ok(role.title && role.any.length >= 2 && role.old.length >= 1 && role.new.length >= 1, role.id);
  }
});

test('folk only speak, plainly: no stage directions, ellipses, dashes, similes or "it’s not X, it’s Y"', () => {
  const lines = folk.roles.flatMap((r) => [...r.any, ...r.old, ...r.new]);
  assert.equal(new Set(lines).size, lines.length, 'no line is said by two jobs');
  for (const text of [...lines, ...Object.values(folk.ages)]) {
    assert.ok(!text.includes('!') && !text.includes("'") && !/\bplease\b/i.test(text), `calm: ${text}`);
    assert.ok(text.length <= 140, `short: ${text}`);
    assert.ok(!/…|\.\.\.|—|–|;/.test(text), `no ellipses, dashes or semicolons: ${text}`);
    assert.ok(!/\b(?:as if|as though|like an?)\b/i.test(text), `no similes: ${text}`);
    assert.ok(!/^(?:He|She|They)\s+(?:is|does|looks|takes|writes|considers|stares|nods|says|smiles|laughs|pauses)\b/.test(text), `speech, not narration: ${text}`);
    assert.ok(!/\b(?:isn’t|is not|aren’t|are not|not)\b[^.?!]{0,60}[.,]\s*(?:it’s|it is|that’s|that is|they’re|they are)\b/i.test(text), `no "it’s not X, it’s Y": ${text}`);
  }
});

test('a hamlet has two or three folk, the same every time, each with their own name, job and tile', () => {
  const a = folkFor(HAMLET, folk, { free: open });
  assert.deepEqual(a, folkFor(HAMLET, folk, { free: open }));
  assert.ok(a.length === 2 || a.length === 3);
  assert.equal(new Set(a.map((p) => p.name)).size, a.length);
  assert.equal(new Set(a.map((p) => p.role)).size, a.length);
  assert.equal(new Set(a.map((p) => `${p.x},${p.y}`)).size, a.length);
  for (const p of a) {
    assert.match(p.id, /^folk-106_-5-\d$/);
    assert.ok(Math.abs(p.x - HAMLET.x) <= 5 && Math.abs(p.y - HAMLET.y) <= 4, 'near home');
    assert.ok(p.lines.length >= 3);
    assert.equal(p.age, hamletAge(HAMLET));
  }
});

test('folk stand only where someone can stand, and a hamlet with no room has nobody', () => {
  assert.deepEqual(folkFor(HAMLET, folk, { free: () => false }), []);
  const only = new Set(['110,-2']);
  const one = folkFor(HAMLET, folk, { free: (x, y) => only.has(`${x},${y}`) });
  assert.deepEqual(one.map((p) => [p.x, p.y]), [[110, -2]]);
  assert.deepEqual(folkFor(null, folk), []);
  assert.deepEqual(folkFor(HAMLET, null), []);
  assert.deepEqual(folkFor(HAMLET, { names: [], roles: [] }), []);
});

test('hamlets are old or new for good, both kinds exist, and the folk talk accordingly', () => {
  const ages = [];
  for (let i = 0; i < 60; i += 1) ages.push(hamletAge({ x: i * 7 - 200, y: i * 13 - 300 }));
  assert.ok(ages.includes('old') && ages.includes('new'));
  assert.equal(hamletAge(HAMLET), hamletAge({ ...HAMLET }));
  assert.equal(ageLine(HAMLET, folk), folk.ages[hamletAge(HAMLET)]);
  const person = folkFor(HAMLET, folk, { free: open })[0];
  const role = folk.roles.find((r) => r.id === person.role);
  const other = person.age === 'old' ? 'new' : 'old';
  assert.ok(role[person.age].every((l) => person.lines.includes(l)));
  assert.ok(!role[other].some((l) => person.lines.includes(l)), 'never the other age’s lines');
});

test('one of the folk says one thing a day, and something else tomorrow', () => {
  const person = folkFor(HAMLET, folk, { free: open })[0];
  assert.equal(folkLine(person, 10), folkLine(person, 10));
  assert.notEqual(folkLine(person, 10), folkLine(person, 11));
  assert.ok(person.lines.includes(folkLine(person, 10)));
  assert.equal(folkLine({ id: 'x', lines: [] }, 1), '');
});

test('folk are drawn as Milo’s chibi in eight sets of colours', () => {
  assert.equal(FOLK_DYES.length, 8);
  FOLK_DYES.forEach((dye, i) => {
    for (const [from, to] of Object.entries(dye)) assert.ok(PALETTE[from] && PALETTE[to], `dye ${i} ${from}→${to}`);
    registerLook('coat', `folk-${i}`, dye);
  });
  assert.equal(folkLook(9).who, 'folk-1');
  const frames = new Set(FOLK_DYES.map((_, i) => exploreFrames(folkLook(i), 'down')[0].rows.join('')));
  assert.equal(frames.size, 8, 'each set looks different');
});

test('every named person stands where their story is, and their sheet says why', () => {
  const worldgen = createWorldgen({ seed: 'hushlands' });
  const wilds = createWilds({ worldgen, maxChunks: 64 });
  const at = Object.fromEntries(npcs.map((n) => [n.id, n.where]));
  for (const n of npcs) {
    assert.ok(typeof n.why === 'string' && n.why.length >= 30, `${n.id} says why they stand there`);
    assert.ok(worldgen.walkable(n.where.x, n.where.y) && !wilds.blocked(n.where.x, n.where.y), `${n.id} can stand there`);
    assert.ok(!worldgen.inHeart(n.where.x, n.where.y), `${n.id} is out in the world`);
  }
  // Wendell: on the north road, about halfway between the gate and the Last Bridge.
  const bridge = lastBridge(worldgen);
  const gate = { x: 32, y: 0 };
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(Math.abs(d(at.wendell, gate) - d(at.wendell, bridge.stand)) <= 8, 'Wendell is near the middle');
  // Gorrin: east of the vale, on the way to Mistmere. Jonas: by the Ivory College. Mags: by the north gate.
  assert.ok(at.gorrin.x > 64 && at.gorrin.x < 108 && Math.abs(at.gorrin.y - 14) <= 3, 'Gorrin is beside the east road');
  assert.ok(d(at.jonas, worldgen.anchorById['ivory-college']) <= 6, 'Jonas is outside the Ivory College');
  assert.ok(d(at.mags, gate) <= 8, 'Mags is by the north gate');
  // Scattered: no two of them within sight of each other, apart from nobody.
  const ids = Object.keys(at);
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) assert.ok(d(at[ids[i]], at[ids[j]]) >= 20, `${ids[i]} and ${ids[j]} are apart`);
});
