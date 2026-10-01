// Shared set-up for module D's suites (CONTRACT-PHASE4.md §13 "D", §7.3): arena.test.js,
// bestiary.test.js, encounters.test.js and content-foes.test.js. Not a test file.
//
// D's code reads B's combat rules (src/combat/rules.js: strayRow, integrityFactor, adaptStep) and
// B's content/combat/rules.json. Wave 1 builds B and D side by side, so when either of B's files is
// missing (or won't load) this kit stands in for them: a Rules object transcribed from §4 and §9.2,
// and a stub rules.js with the contract's three functions, wired in with a module hook before D's
// modules load. Once B's files are there, the suites run against B's real ones.
//
//   const kit = await loadD();   // { mode: 'real' | 'stub', rules, arena, bestiary, encounters, leadname, … }
//   const bare = await loadD({ tuning: null });   // the same, with rules.json alone (every integrityFactor 1)
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const ROOT = new URL('../', import.meta.url);
export const read = (name) => JSON.parse(readFileSync(new URL(`content/${name}.json`, ROOT), 'utf8'));
export const has = (path) => existsSync(new URL(path, ROOT));

const line = (list) => Object.freeze(list);

/** §4 and §9.2's numbers, as rules.json holds them (only the parts D reads, plus their neighbours). */
export function fixtureRules() {
  const genre = (kind, weak, fights, noise, abilities) => ({ kind, weak, fights, noise, abilities });
  return {
    version: 1,
    bands: { cool: { to: 30, bars: [5, 80, 10, 5] }, warm: { to: 60, bars: [15, 60, 15, 10] }, hot: { to: 100, bars: [30, 35, 15, 20] } },
    lines: {
      one: line([5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17]),
      strike: line([7, 9, 10, 12, 13, 15, 17, 18, 20, 22, 24, 26]),
      two: line([12, 15, 17, 20, 22, 25, 28, 30, 33, 36, 39, 42]),
      three: line([18, 22, 26, 29, 33, 37, 41, 46, 50, 54, 58, 62]),
      area: line([13, 16, 19, 21, 24, 27, 30, 34, 37, 40, 43, 46]),
    },
    strays: {
      integrity: line([15, 20, 34, 48, 61, 75, 92, 109, 126, 143, 160, 177, 194]),
      strike: line([5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 22, 23]),
      resist: line([2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11]),
      past12: { integrity: 17, strike: 1.5 },
    },
    archetypes: {
      walker: { integrity: 1, speed: 5, grace: 1, guard: 1, resolve: { body: 1, mind: 0 }, range: 0, hovers: false, flies: false, throughWalls: false, resist: {}, weak: {}, ignores: [], abilities: [] },
      crawler: { integrity: 1, speed: 6, grace: 3, guard: 0, resolve: { body: 0, mind: 1 }, range: 0, hovers: false, flies: false, throughWalls: false, resist: {}, weak: {}, ignores: [], abilities: ['pounce'] },
      floater: { integrity: 0.8, speed: 4, grace: 0, guard: 0, resolve: { body: 0, mind: 1 }, range: 8, hovers: true, flies: false, throughWalls: false, resist: {}, weak: {}, ignores: [], abilities: [] },
      flier: { integrity: 0.8, speed: 6, grace: 3, guard: 0, resolve: { body: 0, mind: 1 }, range: 0, hovers: false, flies: true, throughWalls: false, resist: {}, weak: {}, ignores: [], abilities: [] },
      ghost: { integrity: 0.8, speed: 5, grace: 1, guard: 0, resolve: { body: 0, mind: 1 }, range: 0, hovers: false, flies: false, throughWalls: true, resist: { plain: true }, weak: { light: true }, ignores: ['tangled', 'tumbled'], abilities: ['spooky-touch'] },
      construct: { integrity: 1.25, speed: 4, grace: -1, guard: 1, resolve: { body: 2, mind: 0 }, range: 0, hovers: false, flies: false, throughWalls: false, resist: {}, weak: { spark: true }, ignores: ['queasy', 'drowsy', 'beguiled'], abilities: [] },
    },
    lackey: { levels: -2, integrity: 0.5, strike: 0.75 },
    elite: { integrity: [[1, 10], [4, 15], [99, 20]], edge: 1, damage: 2 },
    lead: {
      below: { hairline: 2, open: 2, gaping: 1 }, range: 8, phases: { hairline: 2, open: 3, gaping: 3 },
      asides: { storybook: [1, 1, 1], 'long-road': [1, 2, 2], 'mauds-table': [2, 3, 3] }, lastPage: 8, bow: 1.25,
    },
    genres: {
      neon: genre('static', 'warp', true, { id: 'lag', rate: 0.2 }, ['glitch-slash']),
      nocturne: genre('chill', 'dust', true, { id: 'nodding-off', rate: [1, 6] }, ['nightwing-swirl']),
      gothic: genre('dread', 'light', true, { id: 'guttering', rate: 1 }, ['candle-puff']),
      iron: genre('grind', 'static', true, { id: 'backlog', rate: 4 }, ['steam-burst']),
      void: genre('warp', 'ink', true, { id: 'out-of-order', rate: 0.25 }, ['star-specks']),
      noir: genre('doubt', 'light', true, { id: 'hidden', rate: 1 }, ['red-herring']),
      frontier: genre('dust', 'chill', true, { id: 'fastest', rate: 1 }, ['cork-gun-pop']),
      kaiju: genre('quake', 'plain', true, { id: 'tremor', rate: 1 }, ['stomp-ring']),
      verdant: genre(null, null, false, null, []),
      starlight: genre(null, null, false, { id: 'kind', rate: 0.1 }, []),
      summit: genre(null, null, false, null, []),
      backhalls: genre(null, null, false, { id: 'hum', rate: 1 }, []),
    },
    temperaments: {
      shy: { heat: 15, talk: 2 }, curious: { heat: 35, talk: 3 }, grumpy: { heat: 45, talk: 4 }, dramatic: { heat: 60, talk: 2 },
      sleepy: { heat: 20, talk: 3 }, polite: { heat: 20, talk: 2 }, lost: { heat: 25, talk: 2 }, nosy: { heat: 35, talk: 3 }, proud: { heat: 40, talk: 4 },
    },
    gentle: ['shy', 'polite', 'sleepy', 'lost', 'curious', 'nosy', 'proud', 'grumpy', 'dramatic'],
    budgets: {
      cost: { '-4': 10, '-3': 15, '-2': 20, '-1': 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 }, below: 5,
      for4: { trivial: 40, low: 60, moderate: 80, severe: 120 }, fewer: { trivial: 10, low: 15, moderate: 20, severe: 30 },
      depth: { from: 3, perHero: 2, max: 10 }, affixes: { crowded: 1.25, lonely: 0.6 }, caps: { foes: 8, kinds: 3, eliteDepth: 7 },
      leadBar: { 2: 30, 1: 40 }, surfaceShare: 0.15,
    },
    tiers: [1, 2, 4, 5, 7, 9, 10, 11],
    deepRank: { every: 3, integrity: 0.1, damage: 1, loot: 0.1 },
    road: {
      xp: [0, 200, 1000, 3800, 11500, 24000, 46000, 84000, 147000, 250000, 380000, 550000],
      perWeight: [10, 20, 35, 55, 80, 110, 145, 185, 230, 280, 335, 395], past12: 60, deep: 45,
      leadWeights: { hairline: 8, open: 10, gaping: 12 }, wildStitch: 4, realStitch: 8,
    },
    rewards: { marks: 4, essence: 0.3, leadEssences: [2, 4], relic: 0.2, tonic: 0.25, cordial: 0.7 },
    adapt: { lackey: 0, stray: 1, elite: 2, lead: 3 },
    modes: {
      storybook: { foeLevel: -1, damage: 0.75, cooler: true, adapt: false, noise: 'off', breathers: 3 },
      'long-road': { foeLevel: 0, damage: 1, cooler: false, adapt: true, noise: 'room', breathers: 2 },
      'mauds-table': { foeLevel: 1, damage: 1, cooler: false, adapt: true, adaptPlus: 1, noise: 'all', breathers: 1, lastPage: false },
    },
    sight: { lit: 6, dim: 3, lantern: 3, lanternRaised: 5 },
    lights: { lamp: 3, candle: 1, max: 24 },
  };
}

// The stand-in for B's src/combat/rules.js: the three functions D calls, exactly as §7.1 and §4 say.
const STUB = `
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function strayRow(rules, row, level) {
  const n = Math.max(0, Math.floor(level));
  const list = rules.strays[row];
  if (n < list.length) return list[n];
  if (row === 'integrity') return list[12] + rules.strays.past12.integrity * (n - 12);
  if (row === 'strike') return list[12] + Math.floor(rules.strays.past12.strike * (n - 12));
  return 3 + Math.floor((3 * (n - 1)) / 4);
}
export function integrityFactor(rules, level, partySize) {
  const f = rules.tuning?.integrityFactor?.[String(level)]?.[String(partySize)];
  return typeof f === 'number' && f > 0 ? f : 1;
}
export function adaptStep({ rank, level, roomLevel, roadLevel }, { mode = 'long-road', adaptation = true, rules } = {}) {
  if (mode === 'storybook' || adaptation === false) return 0;
  let step = rules.adapt[rank] ?? 0;
  const at = rank === 'lead' || rank === 'lackey' ? roomLevel : level;
  if (at <= roadLevel - 2) step -= 1;
  else if (at >= roadLevel + 2) step += 1;
  if (mode === 'mauds-table') step += rules.modes['mauds-table'].adaptPlus ?? 1;
  return clamp(step, 0, 4);
}
export function loadRules(json) { return json; }
`;

let base = null;
const byTuning = new Map();

/**
 * Loads D's modules against B's real rules when they're there (and load), else against the stub.
 * MILO_D_STUB=1 forces the stub.
 *
 * `tuning` picks the rules a suite pins (CONTRACT-PHASE4.md §18.3 item 13):
 * - 'file' (the default): rules.json with content/combat/tuning.json beside it, as the app loads them;
 * - null: rules.json alone, so every integrityFactor is 1. §4.9's worked numbers are written at
 *   factor 1, so a suite that pins them asks for this and never reads the tuned file.
 * The stub's rules carry no tuning either way. Both share one set of D's modules.
 */
export async function loadD({ tuning = 'file' } = {}) {
  if (tuning !== 'file' && tuning !== null) throw new TypeError(`loadD's tuning is 'file' or null, not ${JSON.stringify(tuning)}`);
  const key = tuning === 'file' ? 'file' : 'none';
  if (byTuning.has(key)) return byTuning.get(key);
  const b = await loadBase();
  let rules = fixtureRules();
  if (b.mode === 'real') {
    const tuned = key === 'file' && has('content/combat/tuning.json') ? read('combat/tuning') : null;
    rules = b.rulesApi.loadRules(read('combat/rules'), tuned);
  }
  const loaded = { ...b, rules };
  byTuning.set(key, loaded);
  return loaded;
}

/** B's rules or the stub, and D's modules: everything loadD shares between its two kinds of rules. */
async function loadBase() {
  if (base) return base;
  let mode = 'stub';
  let why = '';
  if (process.env.MILO_D_STUB !== '1' && has('src/combat/rules.js') && has('content/combat/rules.json')) {
    try {
      const R = await import('../src/combat/rules.js');
      for (const fn of ['loadRules', 'strayRow', 'integrityFactor', 'adaptStep']) if (typeof R[fn] !== 'function') throw new Error(`rules.js has no ${fn}`);
      R.loadRules(read('combat/rules'));
      mode = 'real';
    } catch (error) {
      why = String(error?.message || error);
    }
  } else why = process.env.MILO_D_STUB === '1' ? 'MILO_D_STUB=1' : 'B’s rules.js or rules.json is not there yet';
  if (mode === 'stub') {
    const url = `data:text/javascript,${encodeURIComponent(STUB)}`;
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === './rules.js' && /\/src\/combat\/[a-z-]+\.js$/.test(context.parentURL || '')) return { url, shortCircuit: true, format: 'module' };
        return nextResolve(specifier, context);
      },
    });
  }
  const [arena, bestiary, encounters, leadname, elsewhere, riftgenModule, rules4] = await Promise.all([
    import('../src/world/arena.js'),
    import('../src/combat/bestiary.js'),
    import('../src/combat/encounters.js'),
    import('../src/world/leadname.js'),
    import('../src/world/elsewhere.js'),
    import('../src/world/riftgen.js'),
    mode === 'real' ? import('../src/combat/rules.js') : import(`data:text/javascript,${encodeURIComponent(STUB)}`),
  ]);
  const genres = read('genres');
  const words = read('riftgen');
  const leads = read('combat/leads');
  const foes = read('combat/foes');
  const riftgen = riftgenModule.createRiftgen({ words, genres });
  const hooks = (leads.hooks || []).map((h) => h.name);
  base = { mode, why, rulesApi: rules4, arena, bestiary, encounters, leadname, elsewhere, riftgen, riftgenModule, genres, words, leads, foes, hooks };
  return base;
}

/** The same wild specs riftgen.test.js and the golden fixture build: wild(i), every 8th with an awkward affix. */
export function wildSpecs(riftgen, count, { from = 0, hashInts } = {}) {
  const AWKWARD = ['mirrored', 'labyrinthine', 'sunken', 'overgrown', 'flooded', 'vast', 'tiny'];
  const out = [];
  for (let i = from; i < from + count; i += 1) {
    let spec = riftgen.wildRift({ seed: hashInts(i, 'test'), tier: 1 + (i % 8), depth: 1 + (i % 9) });
    if (i % 8 === 0) spec = { ...spec, affixes: [...spec.affixes, { id: AWKWARD[(i / 8) % AWKWARD.length], name: AWKWARD[(i / 8) % AWKWARD.length] }] };
    out.push(spec);
  }
  return out;
}

/**
 * About 500 specs the way elsewhere.test.js sweeps them: wild rifts (every 8th with an awkward
 * affix, every 13th with three), real rifts for signal pairs at three urgencies, the story crack,
 * and 20 ladder rungs. Each is { spec, kind } with the kind the shell would pass.
 */
export function sweepSpecs(riftgen, genres, { wild = 460, hashInts } = {}) {
  const AWKWARD = [null, 'mirrored', 'labyrinthine', 'sunken', 'overgrown', 'flooded', 'vast', 'tiny'];
  const out = [];
  for (let i = 0; i < wild; i += 1) {
    let spec = riftgen.wildRift({ seed: hashInts(i + 2000, 'sweep'), tier: 1 + (i % 8), depth: 1 + (i % 12) });
    const extra = AWKWARD[i % 8];
    if (extra) spec = { ...spec, affixes: [...spec.affixes, { id: extra, name: extra }] };
    if (i % 13 === 0) spec = { ...spec, affixes: [...spec.affixes, { id: 'mirrored', name: 'Mirrored' }, { id: 'labyrinthine', name: 'Labyrinthine' }, { id: 'sunken', name: 'Sunken' }] };
    out.push({ spec, kind: 'wild' });
  }
  const signals = genres.genres.flatMap((g) => g.signals.slice(0, 1));
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i; j < signals.length; j += 4) {
      const urgency = [0.2, 0.5, 0.9][(i + j) % 3];
      out.push({ spec: riftgen.realRift({ key: `real:${i}:${j}`, subject: 'a real thing', signals: i === j ? [signals[i]] : [signals[i], signals[j]], urgency }), kind: 'real' });
    }
  }
  out.push({ spec: riftgen.realRift({ key: 'story:first-crack', subject: 'the north gate', signals: ['sync-error'], urgency: 0.2 }), kind: 'story' });
  let rung = riftgen.wildRift({ seed: hashInts(77, 'sweep'), tier: 6, depth: 1 });
  for (let d = 0; d < 20; d += 1) { rung = riftgen.deeper(rung); out.push({ spec: rung, kind: 'wild' }); }
  return out;
}

/** A cave the way E's caveSpec makes one (§7.7), for tests: the shape, not E's code. */
export function caveOf(x, y, { region = 'cinderforge', tier = 2, depth = 2, hashInts }) {
  return {
    id: `cave:${x},${y}`, seed: hashInts(hashInts(0, 'hushlands'), x, y, 'cave'), kind: 'cave', x, y, tier, depth,
    stage: tier <= 3 ? 'hairline' : 'open', region, name: 'A cave mouth', genres: [], affixes: [], strays: [], taleLead: null, loot: [], creatures: [],
  };
}

/** The options prepareElsewhere takes, from the kit. */
export function prepareOptions(D, kind, extra = {}) {
  return { riftgen: D.riftgen, genres: D.genres, words: D.words, kind, roadLevel: 3, partySize: 4, rules: D.rules, leads: D.leads, foes: D.foes, hooks: D.hooks, ...extra };
}
