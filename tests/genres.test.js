// content/genres.json and the genre palette builder (RIFTS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES, buildGenrePalette, rgbToHsl, basePalette } from '../src/world/genres.js';

const content = JSON.parse(readFileSync(new URL('../content/genres.json', import.meta.url), 'utf8'));
const { genres, fusions } = content;
const HEX = /^#[0-9a-f]{6}$/i;
const PARTICLES = new Set(['rain', 'stars', 'fog', 'smog', 'specks', 'dust', 'sparkles', 'petals', 'mist', 'none']);

test('every genre is complete and well-formed', () => {
  const ids = new Set();
  for (const genre of genres) {
    assert.match(genre.id, /^[a-z]+$/, genre.id);
    assert.ok(!ids.has(genre.id), `duplicate genre ${genre.id}`);
    ids.add(genre.id);
    assert.ok(genre.name && genre.genre && genre.mood, `${genre.id} has a name, genre and mood`);
    assert.ok(['shadow', 'bright', 'neutral'].includes(genre.kind), `${genre.id} kind`);
    for (const role of Object.keys(ROLES)) assert.match(genre.roles[role] || '', HEX, `${genre.id}.${role}`);
    for (const [key, hex] of Object.entries(genre.overrides || {})) {
      assert.ok(Object.values(ROLES).flat().includes(key), `${genre.id} override key ${key}`);
      assert.match(hex, HEX);
    }
    assert.ok(ROLES[genre.rift.rim] && ROLES[genre.rift.inner], `${genre.id} rift roles`);
    assert.ok(PARTICLES.has(genre.particles.type), `${genre.id} particles`);
    assert.ok(genre.particles.density >= 0 && genre.particles.density < 0.05, `${genre.id} density stays light`);
    assert.ok(Array.isArray(genre.signals) && genre.signals.length > 0, `${genre.id} has real signals`);
  }
  assert.ok(genres.length >= 12);
});

test('fusions name two real, different genres, and each pair appears once', () => {
  const ids = new Set(genres.map((g) => g.id));
  const pairs = new Set();
  for (const fusion of fusions) {
    assert.equal(fusion.ids.length, 2, fusion.name);
    assert.notEqual(fusion.ids[0], fusion.ids[1], fusion.name);
    for (const id of fusion.ids) assert.ok(ids.has(id), `${fusion.name} names ${id}`);
    const key = [...fusion.ids].sort().join('+');
    assert.ok(!pairs.has(key), `${fusion.name} repeats ${key}`);
    pairs.add(key);
    assert.ok(fusion.name && fusion.when && fusion.look, fusion.name);
  }
});

test('a genre palette covers every world colour and keeps the shading', () => {
  const keys = basePalette().map((entry) => entry.key);
  for (const genre of genres) {
    const palette = buildGenrePalette(genre);
    for (const key of keys) {
      assert.ok(Array.isArray(palette[key]) && palette[key].length === 3, `${genre.id} colours ${key}`);
      for (const channel of palette[key]) assert.ok(channel >= 0 && channel <= 255);
    }
    // Grass stays shaded: deep grass darker than grass, light grass lighter.
    const light = (key) => rgbToHsl(palette[key])[2];
    assert.ok(light('G') < light('g') && light('g') < light('h'), `${genre.id} grass shading`);
    assert.ok(light('m') < light('b'), `${genre.id} bark darker than wood`);
  }
});
