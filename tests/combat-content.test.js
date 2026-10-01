// content/combat/rules.json (module B; CONTRACT-PHASE4.md §4, §9.2): every table cell for cell
// against §4, and the conditions and surfaces against this file's transcription of COMBAT.md §7
// and §4.3, with calm copy in everything a player reads.
//   node --test tests/combat-content.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertCalm, assertOwnWords, assertCosy } from './calm.js';
import { CONDITION_IDS, SURFACE_IDS } from '../src/combat/effects.js';

const rules = JSON.parse(readFileSync(new URL('../content/combat/rules.json', import.meta.url), 'utf8'));
const genresFile = JSON.parse(readFileSync(new URL('../content/genres.json', import.meta.url), 'utf8'));

// Names this file's copy uses that LORE §21 doesn't list yet (wave 4 adds them; §16.3).
const PENDING_NAMES = ['Stride', 'Step', 'Strike', 'Striding', 'Interact', 'Assist', 'Seek', 'Breather', 'Reboot', 'Reboots', 'Hit', 'Critical', 'Graze',
  'Guard', 'Resolve', 'Light', 'Lights', 'Spark', 'Static', 'Chill', 'Ink', 'Integrity', 'Singed', 'Soaked', 'Sparked', 'Drowsy', 'Tumbles',
  'Tumbled', 'Winded', 'Quickened', 'Brisk', 'Overclock', 'Surge', 'Bead', 'Wanted', 'Tale-lead', 'Neon', 'Gothic', 'Iron', 'Void', 'Nocturne',
  'Frontier', 'Flooded', 'Overgrown', 'Snowbound', 'Kaiju', 'Candle', 'Oil', 'Moonbrew', 'Foliage', 'Water', 'Ink', 'Lingering', 'N'];

const calm = (text, where) => {
  const t = /^\p{L}/u.test(text) ? text : `Effect: ${text}`;
  assertCalm(t, where, { proper: PENDING_NAMES });
  assertOwnWords(text, where);
  assertCosy(text, where);
};

test('rules.json is version 1 with a calm about', () => {
  assert.equal(rules.version, 1);
  calm(rules.about, 'about');
});

test('the bands, the edge reference and heat equal §4.1–§4.3', () => {
  assert.deepEqual(rules.bands, { cool: { to: 30, bars: [5, 80, 10, 5] }, warm: { to: 60, bars: [15, 60, 15, 10] }, hot: { to: 100, bars: [30, 35, 15, 20] } });
  assert.equal(rules.edge.cap, 3);
  assert.equal(rules.edge.step, 10);
  assert.deepEqual(rules.edge.reference.hot['-1'], [20, 35, 15, 30]);
  assert.deepEqual({ ...rules.heat, companions: undefined, temperaments: undefined, room: undefined }, {
    max: 100, attack: 20, attackLight: 10, drift: 10, driftLantern: 20, coolDown: 30, maudsIdle: 15, companions: undefined, temperaments: undefined, room: undefined,
  });
  assert.deepEqual(rules.heat.room, { neon: 10, iron: -10 });
  assert.deepEqual(rules.heat.companions, {
    rivet: 10, nell: 15, tollkeeper: 15, milo: 20, tova: 20, whisper: 20, vesperine: 20, claude: 25, codex: 30, dusty: 30, mae: 30, lumi: 35, juno: 40, pip: 45, jev: 50,
  });
  assert.deepEqual(rules.heat.temperaments, { shy: 15, curious: 35, grumpy: 45, dramatic: 60, sleepy: 20, polite: 20, lost: 25, nosy: 35, proud: 40 });
});

test('actions, lights, lines, Integrity and the stray rows equal §4.4–§4.9', () => {
  assert.deepEqual(rules.actions, {
    speed: 5, small: 4, flies: 6, grace: 3, seek: 6, seekHeed: 8, reboot: 0.25, throwBase: 3, throwMight: 2, jumpBase: 2, brace: 3, shield: 2, bowRange: 12,
    drink: 1, give: 2, difficult: 2, stepUp: 1,
  });
  assert.deepEqual(rules.lights, { lamp: 3, candle: 1, max: 24 });
  assert.deepEqual(rules.lines, {
    one: [5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17],
    strike: [7, 9, 10, 12, 13, 15, 17, 18, 20, 22, 24, 26],
    two: [12, 15, 17, 20, 22, 25, 28, 30, 33, 36, 39, 42],
    three: [18, 22, 26, 29, 33, 37, 41, 46, 50, 54, 58, 62],
    area: [13, 16, 19, 21, 24, 27, 30, 34, 37, 40, 43, 46],
  });
  rules.lines.area.forEach((v, i) => assert.equal(v, Math.floor(rules.lines.three[i] * 0.75), 'area is the three line × 0.75, rounded down'));
  assert.deepEqual(rules.integrity, {
    sturdy: [22, 34, 46, 58, 70, 84, 98, 112, 126, 140, 154, 168],
    middle: [18, 28, 39, 49, 60, 72, 84, 96, 108, 120, 132, 144],
    light: [16, 24, 33, 41, 50, 60, 70, 80, 90, 100, 110, 120],
    gritBase: 1,
  });
  assert.deepEqual(rules.strays, {
    integrity: [15, 20, 34, 48, 61, 75, 92, 109, 126, 143, 160, 177, 194],
    strike: [5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 22, 23],
    resist: [2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11],
    past12: { integrity: 17, strike: 1.5 },
  });
});

test('the six archetypes, lackeys, elites and leads equal §4.9', () => {
  const want = {
    walker: [1, 5, 1, 1, 1, 0, 0], crawler: [1, 6, 3, 0, 0, 1, 0], floater: [0.8, 4, 0, 0, 0, 1, 8],
    flier: [0.8, 6, 3, 0, 0, 1, 0], ghost: [0.8, 5, 1, 0, 0, 1, 0], construct: [1.25, 4, -1, 1, 2, 0, 0],
  };
  assert.deepEqual(Object.keys(rules.archetypes), Object.keys(want));
  for (const [id, [integrity, speed, grace, guard, body, mind, range]] of Object.entries(want)) {
    const a = rules.archetypes[id];
    assert.deepEqual([a.integrity, a.speed, a.grace, a.guard, a.resolve.body, a.resolve.mind, a.range], [integrity, speed, grace, guard, body, mind, range], id);
  }
  assert.equal(rules.archetypes.floater.hovers, true);
  assert.equal(rules.archetypes.flier.flies, true);
  assert.equal(rules.archetypes.ghost.throughWalls, true);
  assert.deepEqual(rules.archetypes.ghost.ignores, ['tangled', 'tumbled']);
  assert.deepEqual(rules.archetypes.construct.ignores, ['queasy', 'drowsy', 'beguiled']);
  assert.deepEqual(rules.archetypes.construct.weak, { spark: 1 });
  assert.deepEqual(rules.archetypes.ghost.resist, { plain: 1 });
  assert.deepEqual(rules.archetypes.ghost.weak, { light: 1 });
  assert.deepEqual(rules.archetypes.crawler.abilities, ['pounce']);
  assert.equal(rules.archetypes.ghost.abilities.length, 1, 'the ghost’s Spook rider');
  assert.deepEqual(rules.lackey, { levels: -2, integrity: 0.5, strike: 0.75 });
  assert.deepEqual(rules.elite, { integrity: [[1, 10], [4, 15], [99, 20]], edge: 1, damage: 2 });
  assert.deepEqual(rules.lead.below, { hairline: 2, open: 2, gaping: 1 });
  assert.equal(rules.lead.range, 8);
  assert.deepEqual(rules.lead.phases, { hairline: 2, open: 3, gaping: 3 });
  assert.deepEqual(rules.lead.asides, { storybook: [1, 1, 1], 'long-road': [1, 2, 2], 'mauds-table': [2, 3, 3] });
  assert.equal(rules.lead.lastPage, 8);
  assert.equal(rules.lead.bow, 1.25);
});

test('all twelve genres, in genres.json’s order, with §4.9’s kinds and weaknesses; every fighting genre names its big move', () => {
  assert.deepEqual(Object.keys(rules.genres), genresFile.genres.map((g) => g.id));
  const table = { neon: ['static', 'warp'], nocturne: ['chill', 'dust'], gothic: ['dread', 'light'], iron: ['grind', 'static'], void: ['warp', 'ink'], noir: ['doubt', 'light'], frontier: ['dust', 'chill'], kaiju: ['quake', 'plain'] };
  for (const [g, [kind, weak]] of Object.entries(table)) {
    assert.equal(rules.genres[g].kind, kind, g);
    assert.equal(rules.genres[g].weak, weak, g);
    assert.equal(rules.genres[g].fights, true);
    assert.equal(rules.genres[g].abilities.length, 1, `${g} names its big move`);
  }
  for (const g of ['verdant', 'starlight', 'summit', 'backhalls']) assert.equal(rules.genres[g].fights, false, `${g} never fights`);
  assert.deepEqual(rules.genres.neon.noise, { id: 'lag', rate: 0.2 });
  assert.deepEqual(rules.genres.nocturne.noise, { id: 'nodding-off', rate: [1, 6] });
  assert.equal(rules.genres.void.noise.rate, 0.25);
  assert.equal(rules.genres.iron.noise.cap, 4);
  assert.equal(rules.genres.starlight.noise.rate, 0.1);
  assert.deepEqual(rules.hidden, { voidFalse: [1, 3], noirHidden: true });
});

test('temperaments and the gentle order equal §4.6', () => {
  assert.deepEqual(Object.keys(rules.temperaments), ['shy', 'curious', 'grumpy', 'dramatic', 'sleepy', 'polite', 'lost', 'nosy', 'proud']);
  const talk = { shy: 2, curious: 3, grumpy: 4, dramatic: 2, sleepy: 3, polite: 2, lost: 2, nosy: 3, proud: 4 };
  for (const [t, n] of Object.entries(talk)) {
    assert.equal(rules.temperaments[t].talk, n, t);
    assert.equal(rules.temperaments[t].heat, rules.heat.temperaments[t], t);
  }
  assert.deepEqual(rules.temperaments.grumpy.talkWith, { ids: ['dusty', 'mae'], talk: 3 });
  assert.deepEqual(rules.temperaments.proud.talkWith, { ids: ['dusty', 'mae'], talk: 3 });
  assert.equal(rules.temperaments.dramatic.afterBig, true);
  assert.deepEqual(rules.gentle, ['shy', 'polite', 'sleepy', 'lost', 'curious', 'nosy', 'proud', 'grumpy', 'dramatic']);
});

test('budgets, tiers, rewards, the Road, work, adaptation and modes equal §4.10–§4.15', () => {
  assert.deepEqual(rules.budgets.cost, { '-4': 10, '-3': 15, '-2': 20, '-1': 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 });
  assert.equal(rules.budgets.below, 5);
  assert.deepEqual(rules.budgets.for4, { trivial: 40, low: 60, moderate: 80, severe: 120 });
  assert.deepEqual(rules.budgets.fewer, { trivial: 10, low: 15, moderate: 20, severe: 30 });
  assert.deepEqual(rules.budgets.depth, { from: 3, perHero: 2, max: 10 });
  assert.deepEqual(rules.budgets.affixes, { crowded: 1.25, lonely: 0.6 });
  assert.deepEqual(rules.budgets.caps, { foes: 8, kinds: 3, eliteDepth: 7 });
  assert.deepEqual(rules.budgets.leadBar, { 2: 30, 1: 40 });
  assert.equal(rules.budgets.surfaceShare, 0.15);
  assert.deepEqual(rules.tiers, [1, 2, 4, 5, 7, 9, 10, 11]);
  assert.deepEqual(rules.deepRank, { every: 3, integrity: 0.1, damage: 1, loot: 0.1 });
  assert.deepEqual(rules.road.xp, [0, 200, 1000, 3800, 11500, 24000, 46000, 84000, 147000, 250000, 380000, 550000]);
  assert.deepEqual(rules.road.cap, { camp: 3, stockade: 5, hold: 7, keep: 8, castle: 10, citadel: 11, kingdom: 12, 'bright-kingdom': 12 });
  assert.deepEqual(rules.road.regulars, { camp: 0, stockade: 2, hold: 4, keep: 6, castle: 8, citadel: 12, kingdom: 12, 'bright-kingdom': 12 });
  assert.deepEqual(rules.road.perWeight, [10, 20, 35, 55, 80, 110, 145, 185, 230, 280, 335, 395]);
  assert.equal(rules.road.past12, 60);
  assert.equal(rules.road.deep, 45);
  assert.deepEqual(rules.road.leadWeights, { hairline: 8, open: 10, gaping: 12 });
  assert.equal(rules.road.wildStitch, 4);
  assert.equal(rules.road.realStitch, 8);
  assert.deepEqual(rules.rewards, { marks: 4, essence: 0.3, leadEssences: [2, 4], relic: 0.2, tonic: 0.25, cordial: 0.7 });
  assert.deepEqual(rules.work, [0, 5, 15, 30, 50, 80, 120, 170, 230, 300, 400, 520]);
  assert.equal(rules.workPast12, 140);
  assert.deepEqual(rules.adapt, { lackey: 0, stray: 1, elite: 2, lead: 3 });
  assert.deepEqual(rules.modes.storybook, { foeLevel: -1, damage: 0.75, cooler: true, adapt: false, noise: 'off', breathers: 3 });
  assert.deepEqual(rules.modes['long-road'], { foeLevel: 0, damage: 1, cooler: false, adapt: true, noise: 'room', breathers: 2 });
  assert.deepEqual(rules.modes['mauds-table'], { foeLevel: 1, damage: 1, cooler: false, adapt: true, adaptPlus: 1, noise: 'all', breathers: 1, lastPage: false });
  assert.deepEqual(rules.rests, { topUp: 0.5, breatherPatch: 0.5 });
  assert.deepEqual(rules.cheers, { max: 4 });
  assert.deepEqual(rules.warmth, { stranger: 0, acquaintance: 10, companion: 30, friend: 60, fireside: 100, outing: 2, outingWeek: 6, habit: 1 });
  assert.deepEqual({ ...rules.warding, ambushRange: undefined }, { wedge: 5, ready: 10, rules: [[0, 1], [15, 3], [50, 6]], ambush: 30, ambushRange: undefined });
  assert.deepEqual(rules.tuning.win, { storybook: 0.99, moderate: 0.95, chained: 0.85, lead: 0.8, maudsTable: [0.6, 0.8] });
  assert.deepEqual(rules.tuning.minutes, { command: 12, guided: 6, round: { command: 75, guided: 40 }, walk: 90 });
  assert.deepEqual(rules.sight, { lit: 6, dim: 3, lantern: 3, lanternRaised: 5 });
  assert.deepEqual(rules.weapons, { light: -2, standard: 0, heavy: 2, rangedRange: 12 });
  assert.deepEqual(rules.armour, { none: 0, light: 0, mail: 1, plate: 2 });
  assert.deepEqual(rules.timing, { tile: 140, melee: 600, cast: 800, effect: [400, 700], hit: 250, flash: 150, strayBeat: 1500, hitStop: 80, fps: [8, 12] });
  assert.deepEqual(rules.odds, { likely: 70, even: 40, crit: 20 });
  assert.deepEqual(rules.surfaceGrowth, { every: 3, from: 1 });
  assert.deepEqual(rules.hazard, { line: 'two', kind: 'plain', radius: 1, burstOn: 'light' });
});

// COMBAT.md §7, transcribed: [id, numbered, effect, ends] (curly apostrophes; markup dropped;
// Offline's "§10" is its first sentence).
const CONDITIONS = [
  ['tumbled', false, 'Melee against it +1 edge, ranged −1; its next Stride only stands it up', 'When it stands'],
  ['tangled', true, 'Can’t Stride or Step; its attacks −1 edge; attacks on it +1', 'Counts down, or an Interact frees it'],
  ['drowsy', true, 'Asleep: no actions or reactions; attacks on it +1 edge', 'Counts down; ends when it takes damage, or when someone beside it spends an Interact'],
  ['dazzled', true, 'Its attacks −1 edge; attacks on it +1', 'Counts down'],
  ['spooked', true, '−1 edge on everything while it can see the source; can’t move closer to it', 'Counts down'],
  ['beguiled', true, 'Can’t target the charmer; spends 1 action a turn drifting toward them', 'Counts down, or ends when the charmer’s side strikes it'],
  ['queasy', true, 'Its attacks and effects −1 edge', 'Counts down'],
  ['rattled', true, '−N edge on everything it does', 'Counts down; a Breather clears it'],
  ['dazed', true, 'Loses its next N actions (a Tale-lead never loses more than 2 in a turn)', 'Drops by 1 for each action lost'],
  ['slowed', true, 'Loses N actions at the start of each turn', 'Counts down'],
  ['quickened', false, 'A fourth action each turn, played in a fourth tick', 'As its source says: Overclock, Surge or Brisk'],
  ['brisk', false, 'Quickened (the fourth action can only Stride or Strike) and +1 Guard; when it ends, Winded', 'When the spell or mechanic ends'],
  ['winded', false, 'Loses 1 action on its next turn', 'After that turn'],
  ['sparked', true, 'No reactions', 'Counts down'],
  ['singed', true, 'Lingering Light N (a flame) at the start of each turn', 'After 3 turns; an Interact, an Assist, water or Soaked ends it'],
  ['soaked', true, 'Spark and Static hit it as a weakness, and Light as a resistance, at the level’s value; ends Singed', 'Counts down; 2 on leaving water'],
  ['hushed', true, 'No spoken or sung spells', 'Counts down'],
  ['unseen', false, 'Attacks on it −2 edge; its first attack from hiding +1 edge', 'Revealed when it attacks, is lit, or is found by a Seek'],
  ['exposed', true, '+1 edge on everything aimed at it; its hidden trick is known', 'Counts down'],
  ['singled-out', false, 'Chosen by a Bead or Wanted; see the feature', 'When the feature moves on'],
  ['offline', false, 'At 0 Integrity a hero sits down and dozes until someone Reboots them', 'A Reboot, or the fight’s end'],
];

test('the conditions equal the transcription of COMBAT §7, with its degree rules and the 22 ids of §5.1', () => {
  assert.deepEqual(Object.keys(rules.conditions), [...CONDITION_IDS]);
  for (const [id, numbered, effect, ends] of CONDITIONS) {
    const c = rules.conditions[id];
    assert.equal(c.numbered, numbered, `${id} numbered`);
    assert.equal(c.text, effect, `${id} effect`);
    assert.equal(c.endsText, ends, `${id} ends`);
    // COMBAT §7: a Critical doubles a number; a Graze halves it; a yes-or-no condition doesn't land on a Graze.
    assert.equal(c.crit, numbered ? 'double' : 'as-hit', `${id} on a Critical`);
    assert.equal(c.graze, numbered ? 'halve' : 'none', `${id} on a Graze`);
    assert.equal(c.class, ['quickened', 'brisk', 'unseen'].includes(id) ? 'boon' : 'bane', `${id} class`);
    calm(c.text, `${id}.text`);
    calm(c.endsText, `${id}.endsText`);
  }
  assert.equal(rules.conditions.lingering.numbered, true);
  assert.equal(rules.lingerTurns, 3);
});

// COMBAT.md §4.3, transcribed: [id, from, effect, reacts with].
const SURFACES = [
  ['neon-puddle', 'Neon, rain', 'Soaked 1 while in it', 'Spark or Static arcs through: half that hit’s damage to everyone in it, and Sparked 1; Chill glazes it to ice'],
  ['candle-wax', 'Gothic', 'Difficult', 'Light: candlefire for 2 rounds (Singed 2 to anyone who ends a tick in it) that Lights the tiles; ghosts in it lose their resistance'],
  ['oil-slick', 'Iron', 'Striding in Tumbles you on a Hit or better (body Resolve)', 'Light: burns for 2 rounds (Singed 3), then smog'],
  ['smog', 'Iron, steam', 'Blocks sight', 'A gust or Chill clears 2×2'],
  ['gravity-well', 'Void', 'Pulls 1 tile inward a turn; leaving costs double', 'Ink collapses it'],
  ['dust-cloud', 'Frontier', 'Ranged attacks through 2+ tiles of it are −1 edge; you can hide in it', 'Water settles it'],
  ['streetlight-pool', 'Nocturne', 'Lit circles in a Dark room', 'Lamps toggle with an Interact'],
  ['moonbrew-spill', 'Nocturne', 'Entering it: Drowsy 1 on a Hit or better (mind Resolve)', 'Light: steam that blocks sight'],
  ['water', 'Flooded', 'Difficult; puts out Singed', 'Spark and Static arc through it; Chill turns it to ice'],
  ['foliage', 'Overgrown', 'Difficult; you can hide in it', 'Light: burns for 2 rounds (Singed 1), then clears'],
  ['ice', 'Snowbound, frozen water', 'Striding in Tumbles you on a Hit or better (body Resolve)', 'Light melts it to water'],
];

test('the surfaces equal the transcription of COMBAT §4.3, their reactions follow it, and the 16 ids of §5.1 are all there', () => {
  assert.deepEqual(Object.keys(rules.surfaces), [...SURFACE_IDS]);
  for (const [id, from, effect, reacts] of SURFACES) {
    const s = rules.surfaces[id];
    assert.equal(s.from, from, `${id} from`);
    assert.equal(s.text, effect, `${id} effect`);
    assert.equal(s.reactsText, reacts, `${id} reacts`);
  }
  const reacts = Object.fromEntries(Object.entries(rules.surfaces).map(([id, s]) => [id, s.reacts]));
  assert.deepEqual(reacts['neon-puddle'], { spark: 'arc', static: 'arc', chill: 'ice' });
  assert.deepEqual(reacts['candle-wax'], { light: 'candlefire' });
  assert.deepEqual(reacts['oil-slick'], { light: 'burning-oil' });
  assert.deepEqual(reacts.smog, { chill: 'clear' });
  assert.deepEqual(reacts['gravity-well'], { ink: 'clear' });
  assert.deepEqual(reacts['moonbrew-spill'], { light: 'steam' });
  assert.deepEqual(reacts.water, { spark: 'arc', static: 'arc', chill: 'ice' });
  assert.deepEqual(reacts.foliage, { light: 'burning-foliage' });
  assert.deepEqual(reacts.ice, { light: 'water' });
  assert.equal(rules.surfaces['burning-oil'].then, 'smog');
  assert.equal(rules.surfaces.candlefire.rounds, 2);
  assert.equal(rules.surfaces['burning-foliage'].rounds, 2);
  assert.deepEqual(['candle-wax', 'water', 'foliage', 'rough-ground', 'candlefire', 'burning-foliage'].map((id) => rules.surfaces[id].difficult), [true, true, true, true, true, true]);
  assert.deepEqual(['oil-slick', 'ice'].map((id) => [rules.surfaces[id].slippery, rules.surfaces[id].meets]), [[true, 'body'], [true, 'body']]);
  assert.equal(rules.surfaces['moonbrew-spill'].meets, 'mind');
  assert.deepEqual(['smog', 'steam'].map((id) => rules.surfaces[id].blocksSight), [true, true]);
  assert.deepEqual(['candlefire', 'burning-oil', 'burning-foliage', 'streetlight-pool'].map((id) => rules.surfaces[id].lit), [true, true, true, true]);
  for (const [id, s] of Object.entries(rules.surfaces)) {
    for (const k of ['from', 'text', 'reactsText']) calm(s[k], `${id}.${k}`);
  }
});

test('devices, reactions’ defaults and the cover table are complete', () => {
  assert.deepEqual(Object.keys(rules.devices), ['drone', 'turret', 'decoy', 'snare', 'patch-kit', 'pop-up-cover']);
  assert.equal(rules.devices.drone.integrity, 5);
  assert.equal(rules.devices['pop-up-cover'].integrity, 10);
  assert.equal(rules.devices['pop-up-cover'].perLevel, 2);
  assert.deepEqual(rules.reactions, { 'parting-swipe': 'always', shoulder: 'under-half', 'draw-the-blow': 'under-half', 'stand-in-my-light': 'under-half', proofread: 'ask', 'cross-it-out': 'ask', default: 'always' });
  assert.deepEqual(rules.cover, { tree: 'high', pine: 'high', 'basalt.column': 'high', crag: 'high', rock: 'low', bush: 'low', 'dice.stone': 'low', ruin: 'low', reeds: null });
});
