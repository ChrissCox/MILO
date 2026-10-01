// Phase 3's golden fixtures (CONTRACT-PHASE4.md §16.2): SHA-256 hashes of what the Phase 3
// generators make, taken from the untouched tree at 0b8f5ae before any Phase 4 module edits
// riftgen, elsewhere, worldgen, straygen or sprites. tests/golden.test.js rebuilds every case with
// the same builders (they're exported from here) and compares the hashes, so a change in draw
// order, a moved room or a repainted stray fails a test instead of quietly moving saved places.
//
//   node tests/fixtures/make-golden.mjs            writes tests/fixtures/phase3-golden.json
//   node tests/fixtures/make-golden.mjs --force    overwrites it (nobody uses this in Phase 4)
//
// Each entry is the SHA-256 of JSON.stringify(value), with typed arrays written as arrays. Two
// things are left out on purpose, both here and in the test: a layout's roomRects (Phase 4 adds
// them) and the tale-lead object's name and label (a lead's shown name changes on purpose, §7.3).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRiftgen } from '../../src/world/riftgen.js';
import { buildElsewhere } from '../../src/world/elsewhere.js';
import { createWorldgen, CHUNK } from '../../src/world/worldgen.js';
import { createWilds } from '../../src/world/wilds.js';
import { createNav } from '../../src/world/nav.js';
import { ARCHETYPES, PARTS, composeStray } from '../../src/world/straygen.js';
import { strayActors } from '../../src/world/riftfx.js';
import { hashInts } from '../../src/world/rng.js';
import { wildRiftsForChunk } from '../../src/rifts.js';

export const GOLDEN_FILE = fileURLToPath(new URL('./phase3-golden.json', import.meta.url));
export const BASELINE = '0b8f5ae';
export const GROUPS = ['specs', 'layouts', 'scenes', 'worldgen', 'wildObjects', 'strays', 'wildActors'];

/** The awkward shapes every 8th wild rift is forced into, in turn. */
export const AWKWARD = ['mirrored', 'labyrinthine', 'sunken', 'overgrown', 'flooded', 'vast', 'tiny'];
const URGENCIES = [0.2, 0.5, 0.9]; // hairline, open and gaping for a real rift
const WORLD_SEEDS = ['hushlands', 'moonrise'];
const SPAWN_DAY = 20000;
const SCENE_TIMES = [0, 5000, 60000];
const ACTOR_TIMES = [0, 5000];
const BODY_KEYS = ['r', 'e', 'k'];

const readContent = (name) => JSON.parse(readFileSync(new URL(`../../content/${name}.json`, import.meta.url), 'utf8'));

// ---------- hashing ----------

const isTyped = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);
const MARK = '\u0000golden-typed-array\u0000';
const MARKED = /"\\u0000golden-typed-array\\u0000(\d+)"/g;

/**
 * SHA-256 (hex) of JSON.stringify(value), typed arrays as arrays. The bytes hashed are exactly
 * JSON.stringify(value, (k, v) => (isTyped(v) ? Array.from(v) : v)); a big typed array (an
 * Elsewhere's ground is up to 1.6 million pixels) is written with join(',') rather than as a
 * million-element array, which is the same text, several times faster.
 */
export function hashValue(value) {
  const typed = [];
  const text = JSON.stringify(value, (_key, v) => {
    if (!isTyped(v)) return v;
    typed.push(v);
    return `${MARK}${typed.length - 1}`;
  }) ?? 'undefined';
  const hash = createHash('sha256');
  let from = 0;
  for (const match of text.matchAll(MARKED)) {
    hash.update(text.slice(from, match.index));
    hash.update(`[${typed[Number(match[1])].join(',')}]`);
    from = match.index + match[0].length;
  }
  hash.update(text.slice(from));
  return hash.digest('hex');
}

// ---------- the parts the golden test ignores ----------

/** A layout without its roomRects (Phase 4 adds them, §7.3). */
export function layoutView(layout) {
  const { roomRects: _ignored, ...rest } = layout;
  return rest;
}

/** What an Elsewhere scene pins: its ground, objects (no tale-lead name or label), spawn and strays. */
export function sceneView(scene) {
  const objects = scene.objects.map((object) => {
    if (object.kind !== 'tale-lead') return object;
    const { name: _name, label: _label, ...rest } = object;
    return rest;
  });
  const strays = scene.strays.map((stray) => ({ id: stray.id, home: stray.home, at: SCENE_TIMES.map((t) => stray.positionAt(t)) }));
  // Where you can walk, what each tile is, and which genre owns it (a fusion's patchwork), per tile.
  const half = scene.tileSize / 2;
  let walk = '';
  const cells = [];
  const owners = [];
  for (let y = 0; y < scene.h; y++) {
    for (let x = 0; x < scene.w; x++) {
      walk += scene.walkable(x, y) ? '1' : '0';
      cells.push(scene.cellAt(x, y));
      owners.push(scene.genreAt(x * scene.tileSize + half, y * scene.tileSize + half));
    }
  }
  return { ground: scene.ground, objects, spawn: scene.spawn, strays, walk, cells, owners, palettes: scene.palettes };
}

/** What a wild rift's actors pin: ids, homes, temperaments and where they stand (not names). */
export function actorsView(actors) {
  return actors.map((actor) => ({ id: actor.id, home: actor.home, temperament: actor.temperament, at: ACTOR_TIMES.map((t) => actor.positionAt(t)) }));
}

// ---------- the cases ----------

/**
 * Every case, by group: { [group]: [{ key, value: () => any }] }. Values are built lazily, so the
 * test can time and report each group on its own. The builders read the real content files.
 */
export function goldenCases() {
  const words = readContent('riftgen');
  const genres = readContent('genres');
  const riftgen = createRiftgen({ words, genres });
  const wild = (i, extra = {}) => riftgen.wildRift({ seed: hashInts(i, 'test'), tier: 1 + (i % 8), depth: 1 + (i % 9), ...extra });

  // Rift cases: the spec as riftgen makes it, and the spec whose layout and scene are pinned
  // (the same, or with a forced awkward affix appended).
  const rifts = [];
  for (let i = 0; i < 300; i += 1) {
    const spec = wild(i);
    if (i % 8 === 0) {
      const id = AWKWARD[(i / 8) % AWKWARD.length];
      rifts.push({ key: `wild:${i}+${id}`, spec, laid: { ...spec, affixes: [...spec.affixes, { id, name: id }] } });
    } else {
      rifts.push({ key: `wild:${i}`, spec, laid: spec });
    }
  }
  const signalsOf = Object.fromEntries(genres.genres.map((g) => [g.id, g.signals]));
  const real = (key, signals, urgency) => riftgen.realRift({ key, subject: 'the build', signals, urgency });
  genres.genres.forEach((g) => {
    for (const signal of g.signals) {
      for (const urgency of URGENCIES) {
        const spec = real(`golden:${signal}`, [signal], urgency);
        rifts.push({ key: `real:${signal}@${urgency}`, spec, laid: spec });
      }
    }
  });
  for (const fusion of genres.fusions) {
    const signals = fusion.ids.map((id) => signalsOf[id][0]);
    for (const urgency of URGENCIES) {
      const spec = real(`golden:${fusion.ids.join('+')}`, signals, urgency);
      rifts.push({ key: `fusion:${fusion.ids.join('+')}@${urgency}`, spec, laid: spec });
    }
  }
  // A few Maelstroms (three genres or more), since a council changes the scene.
  const ids = genres.genres.map((g) => g.id);
  for (let m = 0; m < 4; m += 1) {
    const trio = [ids[m], ids[m + 4], ids[m + 8]];
    const spec = real(`golden:maelstrom:${m}`, trio.map((id) => signalsOf[id][0]), 0.9);
    rifts.push({ key: `maelstrom:${trio.join('+')}`, spec, laid: spec });
  }
  {
    const spec = riftgen.realRift({ key: 'story:first-crack', subject: 'the north gate', signals: ['sync-error'], urgency: 0.2 });
    rifts.push({ key: 'story:first-crack', spec, laid: spec });
  }
  // The ladder: five rungs down from each of four roots.
  for (let root = 0; root < 4; root += 1) {
    let rung = riftgen.wildRift({ seed: hashInts(root, 'ladder'), tier: 1 + root * 2, depth: 1 });
    for (let d = 1; d <= 5; d += 1) {
      rung = riftgen.deeper(rung);
      rifts.push({ key: `ladder:${root}:${d}`, spec: rung, laid: rung });
    }
  }

  const specs = rifts.map(({ key, spec }) => ({ key, value: () => spec }));
  const layouts = rifts.map(({ key, laid }) => ({ key, value: () => layoutView(riftgen.layout(laid)) }));
  const kindOf = (spec) => (String(spec.key || '').startsWith('story:') ? 'story' : spec.kind);
  // 100 scenes: every 5th rift case, plus the story crack and every Maelstrom.
  const chosen = rifts.filter((c, n) => n % 5 === 0 || c.key === 'story:first-crack' || c.key.startsWith('maelstrom:'));
  const scenes = chosen.map(({ key, laid }) => ({
    key,
    value: () => sceneView(buildElsewhere(laid, riftgen.layout(laid), { genres, kind: kindOf(laid), words })),
  }));

  // Worldgen: two seeds, chunks in [−6, 6]² and every chunk a road crosses.
  const worldgen = [];
  const worlds = new Map();
  const worldOf = (seed) => {
    if (!worlds.has(seed)) worlds.set(seed, createWorldgen({ seed, regionWords: words.regionWords }));
    return worlds.get(seed);
  };
  for (const seed of WORLD_SEEDS) {
    const world = worldOf(seed);
    const keys = new Set();
    for (let cy = -6; cy <= 6; cy += 1) for (let cx = -6; cx <= 6; cx += 1) keys.add(`${cx},${cy}`);
    for (const tile of world.roads().tiles) {
      const [x, y] = tile.split(',').map(Number);
      keys.add(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
    }
    worldgen.push({ key: `${seed}:fixed`, value: () => world.fixedPois() });
    for (const at of [...keys].sort(byChunkKey)) {
      const [cx, cy] = at.split(',').map(Number);
      worldgen.push({ key: `${seed}:chunk:${at}`, value: () => { const c = world.chunk(cx, cy); return { tiles: c.tiles, pois: c.pois }; } });
      worldgen.push({ key: `${seed}:spawns:${at}`, value: () => world.wildRiftSpawns(cx, cy, SPAWN_DAY) });
    }
  }

  // Wild objects: hushlands, chunks in [−3, 3]².
  let wildsOf = null;
  const hushWilds = () => (wildsOf ||= createWilds({ worldgen: worldOf('hushlands') }));
  const wildObjects = [];
  for (let cy = -3; cy <= 3; cy += 1) {
    for (let cx = -3; cx <= 3; cx += 1) wildObjects.push({ key: `hushlands:${cx},${cy}`, value: () => hushWilds().chunk(cx, cy).objects });
  }

  // Strays at 20×20: every archetype with every part alone, in three body colours, and every
  // genre's full lead parts on every archetype.
  const strays = [];
  for (const archetype of Object.keys(ARCHETYPES)) {
    for (const bodyKey of BODY_KEYS) {
      strays.push({ key: `${archetype}:${bodyKey}:bare`, value: () => composeStray({ archetype, bodyKey }) });
      for (const id of Object.keys(PARTS)) strays.push({ key: `${archetype}:${bodyKey}:${id}`, value: () => composeStray({ archetype, bodyKey, parts: [{ id, layer: 0 }] }) });
    }
  }
  for (const genre of ids) {
    const bank = words.genres[genre];
    for (const archetype of Object.keys(ARCHETYPES)) {
      const bodyKey = bank.bodyKeys[0];
      strays.push({ key: `lead:${genre}:${archetype}`, value: () => composeStray({ archetype, bodyKey, parts: bank.parts.map((id) => ({ id, layer: 0 })) }) });
    }
    // A fusion's lead: the second half of the parts in the second genre's colours.
    strays.push({
      key: `lead:${genre}:layered`,
      value: () => composeStray({ archetype: bank.preferred[0], bodyKey: bank.bodyKeys[0], parts: bank.parts.map((id, n) => ({ id, layer: n % 2 })) }),
    });
  }

  // Wild actors: the first 50 wild rifts that have strays out (open or gaping), in hushlands from
  // day 20000 on, found chunk by chunk outward from the vale the way the wilds place them, with
  // the walkable ground the wilds' rift layer gives strays.
  let actorRifts = null;
  const wildActorRifts = () => {
    if (actorRifts) return actorRifts;
    const world = worldOf('hushlands');
    const wilds = hushWilds();
    const nav = createNav({ worldgen: world, wildBlocked: wilds.blocked, extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
    actorRifts = [];
    const ring = [];
    for (let cy = -6; cy <= 6; cy += 1) for (let cx = -6; cx <= 6; cx += 1) ring.push([cx, cy]);
    ring.sort((a, b) => Math.max(Math.abs(a[0]), Math.abs(a[1])) - Math.max(Math.abs(b[0]), Math.abs(b[1])) || a[1] - b[1] || a[0] - b[0]);
    for (let day = SPAWN_DAY; actorRifts.length < 50 && day < SPAWN_DAY + 10; day += 1) {
      for (const [cx, cy] of ring) {
        for (const rift of wildRiftsForChunk({ worldgen: world, riftgen, cx, cy, day, isFree: nav.walkable })) {
          if (actorRifts.length < 50 && rift.stage !== 'hairline') actorRifts.push({ rift, walkable: nav.walkable });
        }
        if (actorRifts.length >= 50) break;
      }
    }
    return actorRifts;
  };
  const wildActors = Array.from({ length: 50 }, (_, n) => ({
    key: `hushlands:${n}`,
    value: () => {
      const entry = wildActorRifts()[n];
      if (!entry) return null;
      const { rift, walkable } = entry;
      return { id: rift.id, stage: rift.stage, x: rift.x, y: rift.y, actors: actorsView(strayActors(rift, { walkable, seed: 0, words })) };
    },
  }));

  return { specs, layouts, scenes, worldgen, wildObjects, strays, wildActors };
}

function byChunkKey(a, b) {
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);
  return ay - by || ax - bx;
}

/** The whole fixture: { version, about, baseline, groups: { [group]: { [key]: sha256 } } }. */
export function buildGolden() {
  const cases = goldenCases();
  const groups = {};
  for (const group of GROUPS) {
    groups[group] = {};
    for (const { key, value } of cases[group]) {
      if (key in groups[group]) throw new Error(`Two golden cases share the key ${group}/${key}`);
      groups[group][key] = hashValue(value());
    }
  }
  return {
    version: 1,
    about: 'Phase 3’s worlds, hashed at 0b8f5ae before Phase 4 touched a generator. Rebuilt and compared by tests/golden.test.js; regenerate only with --force, which nobody uses in Phase 4.',
    baseline: BASELINE,
    groups,
  };
}

async function main() {
  const force = process.argv.includes('--force');
  if (existsSync(GOLDEN_FILE) && !force) {
    console.error(`${GOLDEN_FILE} already exists. It pins Phase 3's worlds, so it isn't rewritten without --force.`);
    process.exitCode = 1;
    return;
  }
  const started = performance.now();
  const golden = buildGolden();
  writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 1)}\n`);
  const counts = GROUPS.map((group) => `${group} ${Object.keys(golden.groups[group]).length}`).join(', ');
  console.log(`Wrote ${GOLDEN_FILE} (${counts}) in ${Math.round(performance.now() - started)} ms.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
