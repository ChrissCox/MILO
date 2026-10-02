// Phase 5b.2: a hamlet is a few homes and a well, laid out by rule, and its folk stand at their posts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KIT, hamletAge, layoutSettlement, partsLine } from '../src/world/settlement.js';
import { folkFor, hamletAge as folkAge } from '../src/world/folk.js';
import { SPRITES } from '../src/world/sprites.js';
import { WILD_SHADOWS } from '../src/world/scene-art.js';
import { FIELD_COVER } from '../src/world/fieldboss.js';
import { createWorldgen, CHUNK, TERRAIN } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';

const folk = JSON.parse(readFileSync(new URL('../content/people/folk.json', import.meta.url), 'utf8'));
const riftgen = JSON.parse(readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8'));
const EMBER = { id: 'poi:hamlet:106,-5', x: 106, y: -5 };
const anywhere = () => true;

// A hamlet of each age, found by trying tiles: the rule is the hamlet's own, so any will do.
const ofAge = (age) => { for (let x = 0; x < 200; x += 1) if (hamletAge({ x, y: 7 }) === age) return { x, y: 7 }; throw new Error(age); };

test('the kit: every part has a sprite, a shadow, cover in a fight and a place to stand round the tile', () => {
  assert.deepEqual(Object.keys(KIT), ['old', 'new']);
  for (const [age, parts] of Object.entries(KIT)) {
    assert.ok(parts.some((p) => p.part === 'well') && parts.some((p) => p.part === 'home'), `${age}: a home and a well at least`);
    for (const p of parts) {
      assert.ok(SPRITES[p.kind], `${p.kind} is a sprite`);
      const rows = SPRITES[p.kind][0];
      assert.ok(rows.every((r) => r.length === rows[0].length), `${p.kind} is a rectangle`);
      assert.ok(rows[0].length <= p.w * 16 + 6, `${p.kind} fits its footprint`);
      assert.ok(WILD_SHADOWS[p.kind] || ['tent', 'woodpile', 'lamp.post'].includes(p.kind), `${p.kind} casts a shadow`);
      assert.ok(FIELD_COVER[p.kind], `${p.kind} is cover`);
      assert.ok(p.gap[0] >= 1 && p.gap[1] >= p.gap[0] && p.gap[1] <= 6, `${p.kind} stands near, never on the tile`);
      assert.ok(p.odds === undefined || (p.odds >= 1 && p.odds <= 4));
    }
  }
  assert.ok(KIT.old.some((p) => p.kind === 'cottage.slate') && KIT.new.some((p) => p.kind === 'cottage.new'), 'old and new look different');
  assert.ok(KIT.new.some((p) => p.part === 'tent') && !KIT.old.some((p) => p.part === 'tent'), 'only a new place still has a tent');
});

test('the cottages are the hamlet home one bay narrower, in four roofs', () => {
  const kinds = ['cottage', 'cottage.slate', 'cottage.clay', 'cottage.new'];
  for (const kind of kinds) {
    const rows = SPRITES[kind][0];
    assert.equal(rows.length, SPRITES.hamlet[0].length);
    assert.equal(rows[0].length, 30);
  }
  assert.equal(new Set(kinds.map((k) => SPRITES[k][0].join('\n'))).size, 4);
  // the walls are the same under every roof
  for (const kind of kinds) assert.deepEqual(SPRITES[kind][0].slice(17), SPRITES.cottage[0].slice(17));
});

test('a layout is the hamlet’s own: the same every time, each part at its distance, none on another', () => {
  for (const age of ['old', 'new']) {
    const h = ofAge(age);
    const stand = [];
    const place = (part, x, y) => {
      for (const s of stand) if (x <= s.x + s.w && x + part.w >= s.x && y <= s.y + s.h && y + part.h >= s.y) return false; // a tile between any two
      stand.push({ x, y, w: part.w, h: part.h });
      return true;
    };
    const a = layoutSettlement(h, place);
    stand.length = 0;
    assert.deepEqual(layoutSettlement(h, place), a);
    assert.ok(a.some((p) => p.part === 'well') && a.some((p) => p.part === 'home'));
    assert.equal(new Set(a.map((p) => p.id)).size, a.length, 'each part has its own id');
    for (const p of a) {
      const rule = KIT[age].find((k) => k.kind === p.kind);
      const gap = Math.max(h.x < p.x ? p.x - h.x : h.x > p.x + p.w - 1 ? h.x - (p.x + p.w - 1) : 0, h.y < p.y ? p.y - h.y : h.y > p.y + p.h - 1 ? h.y - (p.y + p.h - 1) : 0);
      assert.ok(gap >= rule.gap[0] && gap <= rule.gap[1], `${p.id} stands ${gap} from the tile`);
    }
  }
});

test('a part with nowhere to go is left out, and a hamlet with no room is only its first home', () => {
  assert.deepEqual(layoutSettlement(EMBER, () => false), []);
  assert.deepEqual(layoutSettlement(EMBER, () => { throw new Error('no'); }), []);
  assert.deepEqual(layoutSettlement(null, anywhere), []);
  assert.deepEqual(layoutSettlement(EMBER, null), []);
  const wells = layoutSettlement(EMBER, (part) => part.part === 'well');
  assert.deepEqual(wells.map((p) => p.part), ['well']);
});

test('hamlets differ: some have a stall or a second cottage, some don’t', () => {
  const seen = new Set();
  for (let i = 0; i < 80; i += 1) seen.add(layoutSettlement({ x: i * 7 - 200, y: i * 13 - 300 }, anywhere).map((p) => p.part).sort().join('+'));
  assert.ok(seen.size >= 6, `${seen.size} kinds of hamlet`);
});

test('what stands in a hamlet, in a line', () => {
  assert.equal(partsLine([]), 'A home.');
  assert.equal(partsLine([{ part: 'well' }]), 'A home and a well.');
  assert.equal(partsLine([{ part: 'home' }, { part: 'home' }, { part: 'tent' }, { part: 'well' }, { part: 'stall' }, { part: 'lamp' }]), 'Three homes, a tent, a well and a stall.');
  assert.equal(partsLine(null), 'A home.');
});

test('the age is one fact: folk.js and settlement.js agree', () => {
  assert.equal(folkAge, hamletAge);
  assert.equal(hamletAge(null), 'old');
});

// ---- in the world ----

const worldgen = createWorldgen({ seed: 'hushlands', regionWords: riftgen.regionWords });
const wilds = createWilds({ worldgen, maxChunks: 64 });
const emberParts = () => { wilds.chunk(3, -1); return wilds.objectsIn(EMBER.x - 9, EMBER.y - 9, EMBER.x + 9, EMBER.y + 9).filter((o) => o.place === EMBER.id && o.part); };

test('Ember Hamlet, east of the vale, is a settlement: homes, a well, and more, all in its chunk and off the road', () => {
  const parts = emberParts();
  assert.ok(parts.length >= 4, `${parts.length} parts`);
  assert.ok(parts.some((p) => p.part === 'well') && parts.some((p) => p.part === 'home'));
  assert.match(partsLine(parts), /homes, .*a well/);
  const taken = new Set();
  for (const p of parts) {
    assert.match(p.id, /^poi:hamlet:106,-5#[a-z]+\d$/);
    assert.equal(p.blocks, true);
    for (let y = p.y; y < p.y + p.h; y += 1) for (let x = p.x; x < p.x + p.w; x += 1) {
      assert.equal(Math.floor(x / CHUNK), 3);
      assert.equal(Math.floor(y / CHUNK), -1);
      assert.ok(![TERRAIN.ROAD, TERRAIN.BRIDGE].includes(worldgen.terrainAt(x, y)), `${p.id} is off the road`);
      assert.ok(wilds.blocked(x, y), `${p.id} is solid`);
      assert.ok(!taken.has(`${x},${y}`));
      taken.add(`${x},${y}`);
    }
  }
  // a tile between any two buildings, the first home included
  const all = wilds.objectsIn(EMBER.x - 9, EMBER.y - 9, EMBER.x + 9, EMBER.y + 9).filter((o) => o.place === EMBER.id);
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) {
    const a = all[i];
    const b = all[j];
    assert.ok(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y, `${a.id} and ${b.id} have a way between them`);
  }
  // and the hamlet's own tile is still somewhere to stand
  assert.ok(worldgen.walkable(EMBER.x, EMBER.y) && !wilds.blocked(EMBER.x, EMBER.y));
});

test('the folk stand at their posts: the seller by the stall, and anyone with a post beside it', () => {
  const parts = emberParts();
  const free = (x, y) => worldgen.walkable(x, y) && !wilds.blocked(x, y) && ![TERRAIN.ROAD, TERRAIN.BRIDGE].includes(worldgen.terrainAt(x, y));
  const people = folkFor(EMBER, folk, { free, parts });
  assert.deepEqual(people, folkFor(EMBER, folk, { free, parts }));
  const stall = parts.find((p) => p.part === 'stall');
  if (stall) {
    assert.equal(people[0].role, 'merchant', 'a stall has a seller');
    assert.ok(people.length >= 3, 'and one more person for it');
  }
  let posted = 0;
  for (const person of people) {
    assert.ok(free(person.x, person.y), `${person.name} can stand there`);
    const post = folk.roles.find((r) => r.id === person.role).post;
    const at = parts.filter((p) => p.part === post);
    if (!at.length) continue;
    posted += 1;
    assert.ok(at.some((p) => person.x >= p.x - 1 && person.x <= p.x + p.w && person.y >= p.y && person.y <= p.y + p.h), `${person.name} (${person.role}) is beside the ${post}`);
  }
  assert.ok(posted >= 1);
  assert.equal(new Set(people.map((p) => `${p.x},${p.y}`)).size, people.length);
});

test('every job’s post is something a hamlet can have', () => {
  const partsKnown = new Set([...KIT.old, ...KIT.new].map((p) => p.part));
  for (const role of folk.roles) if (role.post !== undefined) assert.ok(partsKnown.has(role.post), `${role.id} → ${role.post}`);
  assert.equal(folk.roles.find((r) => r.id === 'merchant').post, 'stall');
  assert.equal(folk.roles.find((r) => r.id === 'well-keeper').post, 'well');
});
