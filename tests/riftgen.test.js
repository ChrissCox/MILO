// Procedural rifts and strays (RIFTS.md §10): src/world/riftgen.js, straygen.js and rng.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTE } from '../src/world/sprites.js';
import { createRiftgen, reachable, pairKey } from '../src/world/riftgen.js';
import { ARCHETYPES, PARTS, SIZE, composeStray } from '../src/world/straygen.js';
import { createRng, hashInts, hashString, perlin, fbm } from '../src/world/rng.js';

const wordsText = readFileSync(new URL('../content/riftgen.json', import.meta.url), 'utf8');
const words = JSON.parse(wordsText);
const genres = JSON.parse(readFileSync(new URL('../content/genres.json', import.meta.url), 'utf8'));
const rifts = createRiftgen({ words, genres });
const IDS = genres.genres.map((g) => g.id);
const KEYS = new Set(Object.keys(PALETTE));
const TOKENS = new Set(['adj', 'noun', 'place', 'name', 'title', 'num', 'time', 'subject']);
const wild = (i, extra = {}) => rifts.wildRift({ seed: hashInts(i, 'test'), tier: 1 + (i % 8), depth: 1 + (i % 9), ...extra });

// ---------- rng ----------

test('the random numbers are seeded, stable and spread out', () => {
  const a = createRng(123);
  const b = createRng(123);
  const draws = Array.from({ length: 1000 }, () => a.next());
  assert.deepEqual(draws, Array.from({ length: 1000 }, () => b.next()));
  assert.ok(draws.every((v) => v >= 0 && v < 1));
  const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
  const r = createRng(7);
  for (let i = 0; i < 200; i += 1) {
    const n = r.int(3, 6);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 6);
  }
  assert.equal(r.weighted([['only', 1], ['never', 0]]), 'only');
  assert.equal(new Set(createRng(9).sample([1, 2, 3, 4, 5], 3)).size, 3);
  assert.equal(hashString('milo'), hashString('milo'));
  assert.notEqual(hashString('milo'), hashString('Milo'));
  assert.notEqual(hashInts(1, 2), hashInts(2, 1));
  for (let i = 0; i < 200; i += 1) {
    const v = perlin(i * 0.37, i * 0.11, 5);
    const f = fbm(i * 0.21, -i * 0.13, 5);
    assert.ok(v >= 0 && v <= 1 && f >= 0 && f <= 1);
  }
});

// ---------- content ----------

test('the rift word banks are complete, and every pattern uses known tokens', () => {
  for (const id of IDS) {
    const g = words.genres[id];
    assert.ok(g, `words for ${id}`);
    for (const bank of ['adjectives', 'nouns', 'places', 'titles', 'patterns', 'patternsReal', 'bossPatterns', 'mechanics', 'quotes', 'essences', 'relics', 'parts', 'bodyKeys', 'preferred']) {
      assert.ok(Array.isArray(g[bank]) && g[bank].length > 0, `${id}.${bank}`);
    }
    assert.ok(g.names?.length || (g.namePrefixes?.length && g.nameSuffixes?.length), `${id} has names`);
    for (const pattern of [...g.patterns, ...g.patternsReal, ...g.bossPatterns, ...g.places, ...g.quotes]) {
      for (const [, token] of pattern.matchAll(/\{(\w+)\}/g)) assert.ok(TOKENS.has(token), `${id}: {${token}} in "${pattern}"`);
    }
    for (const pattern of g.patternsReal) assert.ok(pattern.includes('{subject}'), `${id} real pattern names its cause: "${pattern}"`);
    for (const archetype of [...g.preferred, ...Object.keys(g.archetypes)]) assert.ok(ARCHETYPES[archetype], `${id} archetype ${archetype}`);
    for (const part of g.parts) assert.ok(PARTS[part], `${id} part ${part}`);
    for (const key of g.bodyKeys) assert.ok(KEYS.has(key), `${id} body key ${key}`);
  }
  const affixIds = new Set();
  for (const affix of words.affixes) {
    assert.ok(!affixIds.has(affix.id), `duplicate affix ${affix.id}`);
    affixIds.add(affix.id);
    assert.ok(affix.name && affix.text, affix.id);
    if (affix.extraGenre) assert.ok(IDS.includes(affix.extraGenre), `${affix.id} extra genre`);
  }
  assert.ok(words.affixes.length >= 30 && words.deeds.length >= 10);
});

test('rift copy stays calm: no exclamation marks anywhere', () => {
  assert.ok(!wordsText.includes('!'), 'content/riftgen.json has no "!"');
});

// ---------- real rifts ----------

test('a real rift comes from its signals: same cause, same rift', () => {
  const input = { key: 'repo:milo', subject: 'the MILO build', signals: ['check-failing'], urgency: 0.8 };
  const a = rifts.realRift(input);
  assert.deepEqual(rifts.realRift(input), a);
  assert.deepEqual(a.genres, ['neon']);
  assert.equal(a.kind, 'real');
  assert.equal(a.stage, 'gaping');
  assert.equal(a.subject, 'the MILO build');
  assert.ok(a.name.includes('MILO build'), a.name);
  assert.equal(rifts.genreForSignal('check-failing'), 'neon');
  assert.equal(rifts.genreForSignal('nothing-at-all'), null);
  // Urgency sets how far the rift has opened.
  assert.equal(rifts.realRift({ ...input, urgency: 0.1 }).stage, 'hairline');
  assert.equal(rifts.realRift({ ...input, urgency: 0.5 }).stage, 'open');
  // A different cause is a different rift.
  assert.notEqual(rifts.realRift({ ...input, key: 'repo:habitack' }).seed, a.seed);
  assert.throws(() => rifts.realRift({ key: 'x', signals: ['nothing-at-all'] }), /No genre/);
});

test('two signals make a fusion, three make a Maelstrom', () => {
  const haunted = rifts.realRift({ key: 'repo:habitack', subject: 'Habitack', signals: ['check-failing', 'task-stale'] });
  assert.deepEqual([...haunted.genres].sort(), ['gothic', 'neon']);
  assert.equal(haunted.fusion, 'Haunted Machine');
  assert.equal(haunted.name, 'Haunted Machine: Habitack');
  for (const fusion of genres.fusions) {
    const a = fusion.ids[0];
    const b = fusion.ids[1];
    const signal = (id) => genres.genres.find((g) => g.id === id).signals[0];
    const spec = rifts.realRift({ key: `fusion:${pairKey(fusion.ids)}`, subject: 'a thing', signals: [signal(a), signal(b)] });
    assert.equal(spec.fusion, fusion.name);
    // Four kinds, or five when an affix brings a guest genre.
    assert.equal(spec.strays.length, spec.affixes.some((a) => a.extraGenre) ? 5 : 4, `${fusion.name} strays`);
  }
  const storm = rifts.realRift({ key: 'plan', subject: 'the plan', signals: ['scope-growing', 'task-too-vague', 'task-stale'] });
  assert.equal(storm.maelstrom, true);
  assert.equal(storm.name, 'The Maelstrom of the plan');
  assert.equal(storm.taleLead.council.length, 2);
  assert.ok(storm.loot.some((l) => l.item === 'Maelstrom glass'));
});

// ---------- wild rifts ----------

test('wild rifts are endless and varied: thousands of names, every genre, fusions and Maelstroms', () => {
  const names = new Set();
  const seenGenres = new Set();
  const affixes = new Set();
  let fusions = 0;
  let storms = 0;
  const N = 3000;
  for (let i = 0; i < N; i += 1) {
    const spec = wild(i);
    names.add(spec.name);
    spec.genres.forEach((id) => seenGenres.add(id));
    spec.affixes.forEach((a) => affixes.add(a.id));
    if (spec.genres.length === 2) fusions += 1;
    if (spec.genres.length >= 3) storms += 1;
    assert.match(spec.name, /^[A-Z0-9]/, `capitalised: ${spec.name}`);
    assert.ok(!/[{}!]|undefined|null|NaN| {2}/.test(spec.name), `clean: ${spec.name}`);
    assert.ok(spec.name.length <= 90, spec.name);
    assert.ok(spec.affixes.length >= 1 && spec.affixes.length <= 3);
    assert.equal(new Set(spec.affixes.map((a) => a.id)).size, spec.affixes.length, 'no repeated affix');
    assert.ok(['hairline', 'open', 'gaping'].includes(spec.stage));
  }
  assert.ok(names.size / N > 0.8, `${names.size} unique names of ${N}`);
  assert.deepEqual([...seenGenres].sort(), [...IDS].sort(), 'every genre turns up');
  assert.ok(fusions > N * 0.1 && storms > 0 && storms < fusions, `fusions ${fusions}, Maelstroms ${storms}`);
  assert.ok(affixes.size >= 30, `${affixes.size} affixes seen`);
  assert.deepEqual(wild(17), wild(17), 'the same seed is the same rift');
});

test('a region\'s affinity shows in its wild rifts', () => {
  let iron = 0;
  for (let i = 0; i < 400; i += 1) {
    const spec = rifts.wildRift({ seed: hashInts(i, 'forge'), tier: 3, weights: { iron: 12, neon: 1, gothic: 1 } });
    if (spec.genres[0] === 'iron') iron += 1;
  }
  assert.ok(iron > 250, `${iron} of 400 are Iron`);
});

test('the ladder goes down forever, a little harder each time', () => {
  let spec = wild(3, { tier: 2, depth: 1 });
  const names = new Set([spec.name]);
  for (let i = 0; i < 60; i += 1) {
    const next = rifts.deeper(spec);
    assert.equal(next.depth, spec.depth + 1);
    assert.ok(next.tier >= spec.tier && next.tier <= 8);
    assert.notEqual(next.seed, spec.seed);
    assert.ok(next.genres.every((id) => IDS.includes(id)));
    names.add(next.name);
    spec = next;
  }
  assert.equal(spec.depth, 61);
  assert.equal(spec.tier, 8);
  assert.ok(names.size > 50, `${names.size} different rungs`);
  assert.deepEqual(rifts.deeper(wild(3, { tier: 2, depth: 1 })), rifts.deeper(wild(3, { tier: 2, depth: 1 })));
});

// ---------- inside a rift ----------

test('strays are 20 by 20, in palette keys, and a fusion\'s mix shows in the creature', () => {
  let crossed = 0;
  for (let i = 0; i < 400; i += 1) {
    const spec = wild(i);
    assert.ok(spec.strays.length >= 3);
    assert.equal(new Set(spec.strays.map((s) => s.name)).size, spec.strays.length, 'stray names are distinct');
    for (const s of spec.strays) {
      assert.ok(s.count >= 1);
      assert.ok(IDS.includes(s.genre));
      assert.equal(s.sprite.rows.length, SIZE);
      assert.equal(s.sprite.layers.length, SIZE);
      s.sprite.rows.forEach((row, y) => {
        assert.equal(row.length, SIZE);
        [...row].forEach((ch, x) => {
          assert.ok(ch === '.' || KEYS.has(ch), `${s.name}: '${ch}'`);
          const layer = s.sprite.layers[y][x];
          assert.ok(layer === '0' || (layer === '1' && s.second), `${s.name}: layer ${layer}`);
        });
      });
      if (s.second) crossed += 1;
    }
  }
  assert.ok(crossed > 100, `${crossed} crossed strays`);
});

test('every archetype takes every part, and paired parts appear on both sides', () => {
  for (const archetype of Object.keys(ARCHETYPES)) {
    for (const id of Object.keys(PARTS)) {
      const { rows } = composeStray({ archetype, bodyKey: 'e', parts: [{ id, layer: 0 }] });
      assert.equal(rows.length, SIZE);
      assert.ok(rows.every((row) => row.length === SIZE && [...row].every((ch) => ch === '.' || KEYS.has(ch))), `${archetype}+${id}`);
    }
  }
  const plain = composeStray({ archetype: 'floater', bodyKey: 'e' }).rows;
  const winged = composeStray({ archetype: 'floater', bodyKey: 'e', parts: [{ id: 'batWings', layer: 0 }] }).rows;
  const added = [];
  winged.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== plain[y][x]) added.push(x); }));
  assert.ok(added.some((x) => x < SIZE / 2) && added.some((x) => x >= SIZE / 2), 'wings on both sides');
});

test('every Elsewhere can be walked from the entrance to the Tale-lead, the stitch, the puzzle and the loot', () => {
  const check = (spec, label) => {
    const layout = rifts.layout(spec);
    assert.equal(layout.rows.length, layout.h, label);
    assert.ok(layout.rows.every((row) => row.length === layout.w), label);
    const text = layout.rows.join('\n');
    for (const mark of ['E', 'B', 'S']) assert.equal(text.split(mark).length - 1, 1, `${label}: one ${mark}`);
    const can = reachable(layout);
    assert.ok(can(layout.entrance), label);
    assert.ok(can(layout.boss), `${label}: Tale-lead`);
    assert.ok(can(layout.stitch), `${label}: stitch`);
    if (layout.puzzle) assert.ok(can(layout.puzzle), `${label}: puzzle`);
    for (const spot of layout.loot) assert.ok(can(spot), `${label}: loot`);
    assert.notDeepEqual(layout.entrance, layout.boss, label);
    return layout;
  };
  for (let i = 0; i < 400; i += 1) check(wild(i), `wild ${i}`);
  // The awkward shapes, forced.
  for (const id of ['mirrored', 'labyrinthine', 'tiny', 'vast', 'flooded', 'sunken', 'overgrown']) {
    for (let i = 0; i < 25; i += 1) {
      const spec = { ...wild(i), affixes: [{ id }] };
      const layout = check(spec, `${id} ${i}`);
      if (id === 'mirrored') assert.ok(layout.rows.every((row) => row.slice(0, 5) === [...row.slice(-5)].reverse().join('') || /[EBSPL]/.test(row)), 'mirrored');
    }
  }
  // Deeper rifts are bigger.
  const shallow = rifts.layout({ ...wild(5), depth: 1, stage: 'open', affixes: [] });
  const deep = rifts.layout({ ...wild(5), depth: 15, stage: 'open', affixes: [] });
  assert.ok(deep.w * deep.h > shallow.w * shallow.h);
  assert.deepEqual(rifts.layout(wild(8)), rifts.layout(wild(8)), 'the same rift, the same Elsewhere');
});

test('loot fits the rift: its genres\' essences, a Maelstrom glass for a Maelstrom, and relics with a story', () => {
  let relics = 0;
  for (let i = 0; i < 1500; i += 1) {
    const spec = wild(i);
    for (const item of spec.loot) {
      assert.ok(item.qty >= 1 && Number.isInteger(item.qty));
      if (item.item === 'Maelstrom glass') assert.ok(spec.maelstrom);
      else assert.ok(spec.genres.includes(item.genre), `${item.item} from ${item.genre}`);
      if (item.relic) {
        relics += 1;
        assert.match(item.text, /^Once belonged to .+, who .+\.$/);
        assert.ok(!/[{}]/.test(item.item + item.text));
      } else if (item.genre) assert.ok(words.genres[item.genre].essences.includes(item.item));
    }
    const lead = spec.taleLead;
    assert.ok(lead.name && lead.mechanic && lead.line);
    assert.ok(!/[{}]/.test(lead.name + lead.line), lead.name);
  }
  assert.ok(relics > 50, `${relics} relics`);
});

test('a {num} or {time} that comes back in one pattern reads the same both times', () => {
  // Every pattern here repeats its numbers and times; a {place} is a pattern of its own.
  const twice = structuredClone(words);
  for (const g of Object.values(twice.genres)) {
    g.patterns = ['{num} past {num}, {time} to {time}'];
    g.patternsReal = ['{subject}: {num} past {num}, {time} to {time}'];
    g.bossPatterns = ['{num} of {place}, the {num}'];
    g.quotes = ['Error {num}. Always error {num}, from {time} until {time}.'];
    g.places = ['Level {num}'];
  }
  const gen = createRiftgen({ words: twice, genres });
  const same = (text, re) => {
    const m = text.match(re);
    assert.ok(m, `${text} matches ${re}`);
    assert.equal(m[1], m[2], `the same {num} twice in “${text}”`);
    if (m.length > 3) assert.equal(m[3], m[4], `the same {time} twice in “${text}”`);
  };
  const nums = new Set();
  const times = new Set();
  const check = (spec) => {
    if (spec.genres.length === 1) {
      same(spec.name, /(\d+) past (\d+), (\d:\d\d) to (\d:\d\d)$/);
      nums.add(spec.name.match(/(\d+) past/)[1]);
      times.add(spec.name.match(/, (\d:\d\d) to/)[1]);
    }
    same(spec.taleLead.name, /^(\d+) of Level \d+, the (\d+)$/);
    same(spec.taleLead.line, /^Error (\d+)\. Always error (\d+), from (\d:\d\d) until (\d:\d\d)\.$/);
    for (const c of spec.taleLead.council || []) same(c, /^(\d+) of Level \d+, the (\d+)$/);
  };
  for (let i = 0; i < 400; i += 1) check(gen.wildRift({ seed: hashInts(i, 'twice'), tier: 1 + (i % 8) }));
  for (const g of genres.genres) check(gen.realRift({ key: `repo-${g.id}`, subject: 'milo', signals: [g.signals[0]] }));
  // Still rolled afresh for each rift, not fixed.
  assert.ok(nums.size > 20 && times.size > 20, `${nums.size} numbers, ${times.size} times`);
});
