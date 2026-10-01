// The shell's Phase 3 helpers (src/ui/frontier.js, wildtext.js, panels.js, panelart.js): the rift
// loop against fixture snapshots, the words for rifts and places, loot rolls, the panels' HTML
// (escaping, calm copy, data attributes the UI test reads) and the panel pictures.
//
//   node --test tests/shell.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../src/model.js';
import { dayNumber, dayKey } from '../src/model.js';
import { createWorldgen, TERRAIN, GATES } from '../src/world/worldgen.js';
import { createNav } from '../src/world/nav.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { createWilds } from '../src/world/wilds.js';
import {
  runRiftLoop, echoesFor, wildStateOf, warGroups, riftWhere, stageWord, wardUntilText, heldRule, riftActions, rowActions,
  areaStatus, areaLabel, eveningBellOptions, bootRiftLine, loopBubbles, genreTable, genreChips, anchorNames, riftsSignature,
  snapshotUsable, inHeart, midName, elsewhereLandmarks, elsewhereEntries, createReachTest, stageTag, kindTag, closedWord,
  engineLandmarks, sharedWorldgen, terrainSource, startName, gateEntries, contentProblem, stillStanding, LANDMARK_ORDER,
} from '../src/ui/frontier.js';
import {
  pickLine, rollRange, chanceFor, lootFor, materialsText, materialItems, lootItems, listWords, floatWords, chopLogs, woodOf, parseId, tabletKeys, chunkKeyOf,
  noteFor, statueFor, strayOf, poiView, lanternView, openChest, searchRuin, strayLine, chopLine, LOG_RANGES, travelChoices, lightingLine, LIGHTING_LINE,
} from '../src/ui/wildtext.js';
import {
  esc, riftRow, closedRow, riftSection, riftPanel, warTablePanel, hearthPanel, satchelSection, lanternPanel, poiPanel,
  storyPanel, trackerCard, elsewhereBanner, entityList, eveningBellSetting, actionWord, splitSignature, requirementTag, materialTag, costWord,
} from '../src/ui/panels.js';
import { riftScene, poiScene, hearthScene, spriteScene, frontierOverlay, makeImage, POI_SPRITES, fitScale, riftFrame, hushTable, bleedGenreAt } from '../src/ui/panelart.js';
import { baseTable } from '../src/world/sprites.js';
import { hearthStatus } from '../src/hearth.js';
import { prologueStatus } from '../src/story.js';
import { WARD_POST_RULES, wildRiftsForChunk } from '../src/rifts.js';
import { buildElsewhere } from '../src/world/elsewhere.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const content = { genres: read('genres'), riftgen: read('riftgen'), fortress: read('fortress'), wilds: read('wilds'), story: read('story') };
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: content.riftgen.regionWords });
const riftgen = createRiftgen({ words: content.riftgen, genres: content.genres });
const wilds = createWilds({ worldgen, maxChunks: 16 });
const genres = genreTable(content.genres);
const anchors = anchorNames(worldgen);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A Sunday afternoon, far from the evening bell, so only the signals a test adds open rifts.
const NOON = new Date(2026, 8, 27, 13, 0, 0).getTime();

// Calm copy: no exclamation marks, no "please" or "successfully", no emoji.
function assertCalm(text, where = '') {
  const plain = String(text).replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(plain, /!/, `no exclamation marks ${where}: ${plain.slice(0, 120)}`);
  assert.doesNotMatch(plain, /\bplease\b/i, `no please ${where}`);
  assert.doesNotMatch(plain, /successfully/i, `no successfully ${where}`);
  assert.doesNotMatch(plain, /\p{Extended_Pictographic}/u, `no emoji ${where}`);
}

const source = (ok = true) => ({ ok, path: '', count: 1, live: ok });
function snapshotWith({ sessions = [], capacity = null, at = NOON } = {}) {
  return { scannedAt: at, sessions, tools: [], sources: { claude: source(), codex: source() }, capacity: { codex: capacity } };
}
const reading = (usedPercent, at = NOON) => ({ usedPercent, resetsAt: at + 3 * DAY, windowMinutes: 10080, at: at - 60_000 });
function waiting(id, hours, at = NOON) {
  return {
    id: `claude:${id}`, agent: 'claude', sessionId: id, title: 'Letters to answer', project: 'Post', cwd: 'C:\\Post',
    startedAt: at - (hours + 1) * HOUR, lastActivityAt: at - hours * HOUR, status: 'needs-you', statusDetail: 'Waiting on you',
    live: true, lastMessage: '', completions: [], turns: 1, model: '', source: 'cli', archived: false, waitingSince: at - hours * HOUR,
  };
}
function freshState(extra = {}) {
  const state = createState(NOON);
  return { ...state, lastSeenAt: NOON - HOUR, firstSeenAt: NOON - 10 * DAY, ...extra };
}
const isFree = (x, y) => worldgen.walkable(x, y) && !wilds.blocked(x, y);
const loop = (state, snapshot, now = NOON) => runRiftLoop({ state, snapshot, now, content, riftgen, worldgen, isFree });

// ---------------------------------------------------------------------------
// The rift loop.

test('a Codex reading over 85% opens a capacity rift outside the ward, naming its cause', () => {
  const result = loop(freshState(), snapshotWith({ capacity: reading(91) }));
  const capacity = result.rifts.find((rift) => rift.realKind === 'capacity');
  assert.ok(capacity, 'a capacity rift');
  assert.match(capacity.cause, /^Codex has used 91% of its weekly allowance\. It refills on \w+ at \d\d:\d\d\.$/);
  assert.ok(Number.isFinite(capacity.x) && Number.isFinite(capacity.y));
  assert.equal(inHeart(capacity.x, capacity.y), false, 'never in the vale');
  assert.ok(worldgen.heartDistance(capacity.x, capacity.y) > result.wardRadius);
  assert.ok(result.state.rifts.open[capacity.key], 'it is open in the state');
  assert.deepEqual(result.opened.map((r) => r.key), [capacity.key]);
  assert.equal(result.bell.length, 0, 'not at the walls at 91%');
  assert.equal(result.state.tally.sessionsFinished, 0);
  assert.match(riftWhere(capacity, anchors), /^\d+ tiles out, toward Cinderforge$/);
});

test('the rift seals once its signal clears, with its loot, and Milo says so calmly', () => {
  const opened = loop(freshState(), snapshotWith({ capacity: reading(91) }));
  const later = NOON + 10 * 60_000;
  const cleared = loop(opened.state, snapshotWith({ capacity: reading(20, later), at: later }), later);
  assert.equal(cleared.rifts.filter((r) => r.realKind === 'capacity').length, 0);
  assert.equal(cleared.sealed.length, 1);
  const [seal] = cleared.sealed;
  assert.equal(cleared.state.rifts.history[0].how, 'sealed');
  assert.equal(cleared.state.rifts.stitched.real, 1);
  const bubbles = loopBubbles({ sealed: cleared.sealed, state: cleared.state, story: content.story });
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].kind, 'sealed');
  assert.equal(bubbles[0].title, 'A rift sealed itself');
  assert.match(bubbles[0].lines[0], new RegExp(seal.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const bubble of bubbles) assertCalm([bubble.title, ...bubble.lines].join(' '), 'in the seal bubble');
  assert.match(bootRiftLine({ sealed: cleared.sealed }), /^While you were away, the Codex capacity rift sealed itself\.$/);
});

test('a watcher hiccup never seals a rift', () => {
  const opened = loop(freshState(), snapshotWith({ capacity: reading(91) }));
  const blind = { scannedAt: NOON + 60_000, sessions: [], tools: [], sources: { claude: source(false), codex: source(false) }, capacity: { codex: null } };
  const result = loop(opened.state, blind, NOON + 60_000);
  assert.equal(result.sealed.length, 0);
  assert.ok(result.rifts.some((r) => r.realKind === 'capacity'), 'the rift is carried');
  assert.equal(snapshotUsable(blind), false);
});

test('a rift at the walls rings the bell once; a note only at tier 2 with the Gate Bell on', () => {
  const tier1 = loop(freshState(), snapshotWith({ capacity: reading(99) }));
  assert.equal(tier1.bell.length, 1);
  assert.equal(tier1.notify, false, 'tier 1: a bubble only');
  const again = loop(tier1.state, snapshotWith({ capacity: reading(99), at: NOON + 60_000 }), NOON + 60_000);
  assert.equal(again.bell.length, 0, 'it rings once');
  const tier2 = loop(freshState({ hearth: { tier: 2, raisedAt: {} } }), snapshotWith({ capacity: reading(99) }));
  assert.equal(tier2.bell.length, 1);
  assert.equal(tier2.notify, true);
  assert.equal(tier2.wardRadius, 12);
  const quiet = loop(freshState({ hearth: { tier: 2, raisedAt: {} }, settings: { ...createState().settings, gateBell: false } }), snapshotWith({ capacity: reading(99) }));
  assert.equal(quiet.notify, false, 'the Gate Bell switched off');
  const bubbles = loopBubbles({ bell: tier2.bell, opened: tier2.opened, state: tier2.state, warTable: true });
  assert.equal(bubbles[0].kind, 'bell');
  assert.equal(bubbles[0].title, 'A rift is at the walls');
  assert.equal(bubbles[0].place, 'war-table');
  assert.ok(!bubbles.some((b) => b.kind === 'rift'), 'a belled rift gets no second bubble');
  for (const rift of tier2.rifts) if (!rift.held) assert.ok(worldgen.heartDistance(rift.x, rift.y) > 12, 'outside the tier 2 ward');
});

test('the reach test finds pockets closed off from the roads, and remembers each one', () => {
  // A little map: '.' open, '#' blocked, '=' road. The pocket on the right is walled in.
  const rows = [
    '##########',
    '#..=.#...#',
    '#..=.#.#.#',
    '#..=.#...#',
    '##########',
  ];
  let calls = 0;
  const walkable = (x, y) => { calls += 1; return rows[y]?.[x] === '.' || rows[y]?.[x] === '='; };
  const reach = createReachTest({ walkable, isRoad: (x, y) => rows[y]?.[x] === '=' });
  assert.equal(reach(1, 1), true, 'open ground beside the road');
  assert.equal(reach(6, 1), false, 'the walled pocket');
  const before = calls;
  assert.equal(reach(8, 3), false, 'the same pocket, remembered');
  assert.equal(reach(2, 2), true, 'ground the first search saw, remembered');
  assert.equal(calls, before, 'no second search');
  assert.equal(reach(4, 2), true, 'across the road');
  assert.equal(reach(0, 0), false, 'a wall is never free');
  const wide = createReachTest({ walkable: () => true, isRoad: () => false, budget: 50 });
  assert.equal(wide(0, 0), true, 'ground too wide to be a pocket counts as reachable');
  assert.equal(createReachTest({ walkable: () => true, isRoad: () => false, inHeart: (x, y) => x > 3, budget: 500 })(0, 0), true, 'the vale counts');
});

test('real rifts stand where Milo can walk to them, wherever such ground is near their spot', () => {
  const nav = createNav({ worldgen, wildBlocked: (x, y) => wilds.blocked(x, y), extraBlocked: (x, y) => wilds.ringBlocked(x, y, 1) });
  const reach = createReachTest({ walkable: nav.walkable, isRoad: (x, y) => [TERRAIN.ROAD, TERRAIN.BRIDGE].includes(wilds.terrainAt(x, y)), inHeart: worldgen.inHeart });
  const free = (x, y) => nav.walkable(x, y) && reach(x, y);
  const door = { x: 31, y: 16 };
  // Capacity readings over many refill times (each its own key, so its own spot), and two that
  // once landed in a meadow closed in by water west of the vale.
  const times = [1790808437000, 1790807029000, ...Array.from({ length: 22 }, (_, i) => NOON + (i + 1) * 2 * 3600_000)];
  let walkable = 0;
  const closedIn = [];
  for (const resetsAt of times) {
    const at = Math.min(resetsAt - HOUR, NOON);
    const snap = { ...snapshotWith({ capacity: { usedPercent: 91, resetsAt, windowMinutes: 10080, at: at - 60_000 } }), scannedAt: at };
    const rift = runRiftLoop({ state: freshState(), snapshot: snap, now: at, content, riftgen, worldgen, isFree: free }).rifts.find((r) => r.realKind === 'capacity');
    assert.ok(rift, `a capacity rift for ${resetsAt}`);
    if (free(rift.x, rift.y)) {
      const around = [[0, 1], [-1, 0], [1, 0], [0, -1]].map(([dx, dy]) => ({ x: rift.x + dx, y: rift.y + dy })).filter((t) => nav.walkable(t.x, t.y));
      assert.ok(around.some((t) => nav.findPath(door, t, { maxNodes: 80000, margin: 60 }).length > 0), `Milo can walk to ${rift.spec.name} at ${rift.x},${rift.y}`);
      walkable += 1;
    } else {
      // rifts.js keeps the rift's own spot when nothing within 6 tiles is free. Then Step through
      // lets the tear reach for Milo, and he comes back out on the nearest open ground (app.js).
      let near = false;
      for (let dy = -6; dy <= 6 && !near; dy += 1) for (let dx = -6; dx <= 6 && !near; dx += 1) near = dx * dx + dy * dy <= 36 && free(rift.x + dx, rift.y + dy);
      assert.equal(near, false, `${rift.x},${rift.y} is only closed in when nothing near it is free`);
      closedIn.push(`${rift.x},${rift.y}`);
    }
  }
  assert.ok(walkable >= times.length - 4, `most rifts stand on ground Milo can walk to (closed in: ${closedIn.join(' ')})`);
});

test('moving the evening bell lets tonight’s Nocturne go quietly, never as a seal with loot', () => {
  const late = new Date(2026, 8, 25, 23, 30).getTime(); // a Friday, past the 22:00 bell
  const working = { ...waiting('n1', 0, late), status: 'working', statusDetail: 'Working now', lastActivityAt: late - 60_000, waitingSince: null };
  const at = (t) => snapshotWith({ sessions: [{ ...working, lastActivityAt: t - 60_000 }], at: t });
  const night = loop(freshState({ firstSeenAt: late - DAY, lastSeenAt: late - HOUR }), at(late), late);
  const nocturne = night.rifts.find((r) => r.realKind === 'nocturne');
  assert.ok(nocturne, 'crew working past the bell opens a Nocturne');
  assert.deepEqual(night.closed, [], 'nothing closes as it opens');
  // The bell switched off: the loop's own pass closes it quietly, with no seal, loot or bubble.
  const off = { ...night.state, settings: { ...night.state.settings, eveningBell: null } };
  const after = loop(off, at(late + 60_000), late + 60_000);
  assert.deepEqual(after.closed.map((c) => [c.key, c.id]), [[nocturne.key, nocturne.id]]);
  assert.equal(after.state.rifts.open[nocturne.key], undefined);
  assert.equal(after.sealed.length, 0, 'no seal');
  assert.equal(after.state.rifts.history[0].how, 'closed', 'closed, not sealed');
  assert.deepEqual(after.state.satchel, night.state.satchel, 'no loot');
  assert.deepEqual(after.state.rifts.stitched, night.state.rifts.stitched, 'nothing counted as mended');
  assert.deepEqual(loopBubbles({ opened: after.opened, sealed: after.sealed, state: after.state }), [], 'no bubble from the loop');
  const [closed] = warGroups(after.rifts, after.state, late + 60_000).filter((g) => g.id === 'closed');
  assert.match(closed.closed[0].text, /^Closed today$/, 'the War Table says it closed, not that it sealed');
  // The bell back on: the Nocturne stands again, and isn't also listed as closed.
  const again = loop({ ...after.state, settings: { ...after.state.settings, eveningBell: '22:00' } }, at(late + 120_000), late + 120_000);
  assert.ok(again.rifts.some((r) => r.key === nocturne.key), 'it opens again');
  const table = warGroups(again.rifts, again.state, late + 120_000);
  assert.ok(!(table.find((g) => g.id === 'closed')?.closed || []).some((entry) => entry.key === nocturne.key), 'not both open and closed');
  // A bell that still covers the hour closes nothing, and neither does a blind watcher.
  const later = { ...night.state, settings: { ...night.state.settings, eveningBell: '23:00' } };
  assert.deepEqual(loop(later, at(late + 60_000), late + 60_000).closed, []);
  const blind = { scannedAt: late, sessions: [], tools: [], sources: { claude: source(false), codex: source(false) }, capacity: { codex: null } };
  const unseen = loop(off, blind, late + 60_000);
  assert.deepEqual([unseen.closed, unseen.sealed], [[], []]);
  assert.ok(unseen.state.rifts.open[nocturne.key], 'a watcher hiccup carries it');
});

test('a session waiting 25 hours knocks, and the dry run changes nothing', () => {
  const snap = snapshotWith({ sessions: [waiting('k1', 25)] });
  const result = loop(freshState(), snap);
  const knock = result.rifts.find((r) => r.realKind === 'knocking');
  assert.ok(knock);
  assert.equal(knock.cause, '“Letters to answer” has waited on you for 25 hours.');
  assert.equal(knock.echo.place, 'watchtower');
  const before = freshState();
  const dry = runRiftLoop({ state: before, snapshot: snap, now: NOON, content, riftgen, worldgen, isFree, dryRun: true });
  assert.equal(dry.state, before, 'a dry run leaves the state alone');
  assert.equal(dry.sealed.length, 0);
  // The story rift appears once Oriel's letter is read, past the north gate.
  const lettered = { ...freshState({ tally: { daysSeen: 2, lastDay: dayKey(NOON), sessionsFinished: 1, finishedIds: ['claude:x'], buildingsDesigned: 1 } }) };
  lettered.story = { prologue: { done: {} }, letterReadAt: NOON - HOUR, trackerHidden: false };
  const story = loop(lettered, snap).rifts.find((r) => r.kind === 'story');
  assert.ok(story, 'the story rift');
  assert.equal(story.x, 32);
  assert.ok(story.y < -1);
  assert.match(riftWhere(story, anchors), /past the north gate$/);
});

test('a building being redesigned keeps its bright rift; clearing it lets the rift fade', () => {
  const blueprint = { version: 1, name: 'Stream cave', tagline: '', purpose: '', style: {}, emblem: [], props: [], yard: 'grass', levels: [] };
  const builtAt = NOON - 2 * HOUR;
  const built = freshState();
  built.plots = { ...built.plots, 'plot-rise': { ...built.plots['plot-rise'], status: 'built', blueprint, builtAt, designedBy: 'kit' } };
  const first = loop(built, snapshotWith({}));
  const bright = first.rifts.find((r) => r.realKind === 'built');
  assert.ok(bright?.bright, 'a new building shines as a bright rift');
  // A redesign puts a scaffold round it: the plot says 'designing', and the building still stands.
  const plot = first.state.plots['plot-rise'];
  const redesigning = { ...first.state, plots: { ...first.state.plots, 'plot-rise': { ...plot, status: 'designing' } } };
  const during = loop(redesigning, snapshotWith({ at: NOON + 60_000 }), NOON + 60_000);
  assert.deepEqual([during.sealed, during.opened, during.closed], [[], [], []], 'nothing seals or opens while it is redesigned');
  assert.ok(during.rifts.some((r) => r.key === bright.key));
  assert.equal(during.state.plots['plot-rise'].status, 'designing', 'the loop never touches the plot');
  // The new look lands (builtAt moves, firstBuiltAt stays): the same building, the same rift.
  const relooked = { ...during.state, plots: { ...during.state.plots, 'plot-rise': { ...plot, status: 'built', builtAt: NOON + 90_000, firstBuiltAt: builtAt } } };
  const landed = loop(relooked, snapshotWith({ at: NOON + 100_000 }), NOON + 100_000);
  assert.deepEqual([landed.sealed, landed.opened], [[], []], 'a redesign never seals the old rift or opens a second');
  assert.deepEqual(landed.rifts.filter((r) => r.realKind === 'built').map((r) => r.key), [bright.key]);
  // A first design in progress has no building yet, so nothing shines for it.
  const empty = freshState();
  empty.plots = { ...empty.plots, 'plot-rise': { ...empty.plots['plot-rise'], status: 'designing' } };
  assert.equal(loop(empty, snapshotWith({})).rifts.filter((r) => r.realKind === 'built').length, 0);
  const cleared = { ...first.state, plots: { ...first.state.plots, 'plot-rise': { ...first.state.plots['plot-rise'], status: 'empty', blueprint: null, builtAt: null, firstBuiltAt: null } } };
  const gone = loop(cleared, snapshotWith({ at: NOON + 120_000 }), NOON + 120_000);
  assert.deepEqual(gone.sealed.map((s) => s.key), [bright.key]);
  assert.deepEqual(loopBubbles({ sealed: gone.sealed, state: gone.state }), [], 'a bright rift fading never bubbles');
  // On the War Table it faded: it was a gift, never a tear to seal.
  const closed = warGroups(gone.rifts, gone.state, NOON + 120_000).find((g) => g.id === 'closed');
  assert.equal(closed.closed[0].text, 'Faded today');
});

test('echoes, the engine’s wild state and signatures', () => {
  const result = loop(freshState(), snapshotWith({ capacity: reading(91), sessions: [waiting('k2', 30)] }));
  const echoes = echoesFor(result.rifts);
  assert.equal(echoes.length, result.rifts.filter((r) => !r.held).length);
  for (const echo of echoes) {
    assert.match(echo.id, /^echo:rift:/);
    assert.ok(['camp', 'watchtower', 'workbench'].includes(echo.place));
    assert.ok(echo.label.length > 3);
  }
  const state = {
    ...createState(), rifts: { ...createState().rifts, closedWild: { 'rift:a': dayNumber(NOON), 'rift:b': dayNumber(NOON) - 1 }, visited: { 'rift:c': NOON } },
    wilds: { ...createState().wilds, lanterns: { 'lantern:1,2': NOON }, opened: { 'poi:chest:1,1': NOON }, felled: { 'tree:3,4': dayNumber(NOON), 'tree:5,6': dayNumber(NOON) - 1 } },
  };
  const wild = wildStateOf(state, NOON, { tier: 2, wardRadius: 12 });
  assert.deepEqual(wild.closed, ['rift:a']);
  assert.deepEqual(wild.felled, ['tree:3,4']);
  assert.deepEqual(wild.lit, ['lantern:1,2']);
  assert.deepEqual(wild.opened, ['poi:chest:1,1']);
  assert.deepEqual(wild.visited, ['rift:c'], 'claimed Elsewhere chests stand open');
  assert.equal(wild.day, dayNumber(NOON));
  assert.equal(wild.tier, 2);
  const sig = riftsSignature(result.rifts);
  assert.equal(riftsSignature(result.rifts.map((r) => ({ ...r }))), sig);
  assert.notEqual(riftsSignature([{ ...result.rifts[0], x: result.rifts[0].x + 1 }]), riftsSignature([result.rifts[0]]));
});

test('the War Table groups every rift, closed ones last', () => {
  const tier2 = freshState({ hearth: { tier: 2, raisedAt: {} } });
  const result = loop(tier2, snapshotWith({ capacity: reading(99), sessions: [waiting('k3', 26)] }));
  const warded = { ...result.rifts.find((r) => r.realKind === 'knocking'), warded: { until: NOON + DAY, stage: 'hairline' } };
  const rifts = result.rifts.map((r) => (r.realKind === 'knocking' ? warded : r));
  const history = [{ key: 'capacity:codex:1', id: 'rift:old', name: 'Old one', genres: ['neon'], kind: 'real', openedAt: NOON - 2 * DAY, closedAt: NOON - DAY, how: 'sealed' }];
  const groups = warGroups(rifts, { rifts: { history } }, NOON);
  assert.deepEqual(groups.map((g) => g.id), ['walls', 'warded', 'closed']);
  // Pressing enough to ring the Gate Bell, yet a few tiles out past the ward: close, not at.
  assert.equal(groups[0].title, 'Close to the walls');
  assert.match(riftWhere(groups[0].rifts[0], anchors), /^(\d+ tiles? out|At the edge of the ward)/, 'its row says how far out it stands');
  assert.equal(groups[2].closed[0].text, 'Sealed yesterday');
  const held = warGroups([{ ...warded, warded: null, held: 'patient-knock' }], {}, NOON);
  assert.deepEqual(held.map((g) => g.id), ['held']);
  assert.equal(heldRule({ held: 'patient-knock' }).name, 'A patient knock');
  assert.match(wardUntilText(warded, NOON), /^The ward holds until tomorrow at 13:00\. It won’t grow or ring the Gate Bell until then\.$/);
  assert.equal(stageWord(warded), 'Hairline · warded');
  assert.equal(stageWord({ stage: 'gaping' }), 'Gaping');
});

test('rift tags read plainly: the stage (and its ward), and what real thing it stands for', () => {
  // A ward holds a rift at the stage it had: that stage, then the ward, never "Warded at open".
  assert.equal(stageTag({ kind: 'real', stage: 'gaping', warded: { until: NOON + DAY, stage: 'open' } }), 'Open · warded');
  assert.equal(stageTag({ kind: 'real', stage: 'hairline' }), 'Hairline');
  assert.equal(stageTag({ kind: 'real', stage: 'open', held: 'nights-off' }), 'Held back');
  assert.equal(stageTag({ kind: 'real', stage: 'open', bright: true }), 'Bright');
  assert.equal(kindTag({ kind: 'real', realKind: 'nocturne' }), 'Late night');
  assert.equal(kindTag({ kind: 'real', realKind: 'knocking' }), 'Waiting on you');
  assert.equal(kindTag({ kind: 'real', realKind: 'capacity' }), 'Crew capacity');
  assert.equal(kindTag({ kind: 'real', realKind: 'built', bright: true }), 'New building');
  assert.equal(kindTag({ kind: 'story' }), 'The Prologue');
  assert.equal(kindTag({ kind: 'wild' }), 'Wild');
  assert.equal(kindTag({ kind: 'real' }), 'Real');
  assert.equal(riftWhere({ kind: 'real', x: 70, y: 3, beyond: 0 }, anchors), 'At the edge of the ward');
  // A held rift says so once in its row (the tag), and the line under it says who holds it.
  assert.equal(riftWhere({ kind: 'real', held: 'nights-off', x: null, y: null }, anchors), 'The ward-post holds it, so it hasn’t opened');
  const heldPanel = riftPanel({ id: 'rift:h', kind: 'real', name: 'Held', genres: [], stage: 'Held back', stageId: 'open', cause: 'c', stitch: 's', held: heldRule({ held: 'nights-off' }), actions: ['war-table'] });
  assert.match(heldPanel, /data-note="held">The ward-post’s rule “Weekend nights off” holds it back\. /);
  assert.equal((heldPanel.match(/Held back/g) || []).length, 1, 'the panel says “held back” once, in its tag');
  // How closed ones went: a bright rift fades, whether it ran its course or was let be.
  assert.equal(closedWord({ key: 'built:plot-rise:1', how: 'sealed' }), 'Faded');
  assert.equal(closedWord({ key: 'built:plot-rise:1', how: 'let-go' }), 'Faded');
  assert.equal(closedWord({ key: 'capacity:codex:1', how: 'sealed' }), 'Sealed');
  assert.equal(closedWord({ key: 'night:2026-09-25', how: 'closed' }), 'Closed');
  assert.equal(closedWord({ key: null, how: 'stitched' }), 'Stitched');
  // Every tag the real loop can make is short, calm and never a genre's name.
  const result = loop(freshState({ hearth: { tier: 2, raisedAt: {} } }), snapshotWith({ capacity: reading(99), sessions: [waiting('t1', 30)] }));
  const genreNames = new Set([...genres.values()].map((g) => g.name));
  for (const rift of [...result.rifts, { ...result.rifts[0], warded: { until: NOON + DAY, stage: 'open' } }]) {
    for (const tag of [stageTag(rift), kindTag(rift)]) {
      assert.ok(tag.length > 0 && tag.length <= 16, `short: ${tag}`);
      assert.doesNotMatch(tag, /^Warded at/);
      assert.ok(!genreNames.has(tag), `not a genre: ${tag}`);
      assertCalm(tag);
    }
  }
});

test('what each rift offers, by kind and by where Milo is', () => {
  assert.deepEqual(riftActions({ kind: 'real' }), ['step', 'ward', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real', warded: { stage: 'open' } }), ['step', 'unward', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real' }, { via: 'echo' }), ['show', 'ward', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real', bright: true }), ['visit', 'let-be']);
  assert.deepEqual(riftActions({ kind: 'story' }), ['step']);
  assert.deepEqual(riftActions({ kind: 'wild' }), ['step', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real', held: 'nights-off' }), ['war-table']);
  assert.deepEqual(riftActions({ kind: 'real' }, { inside: true }), ['leave'], 'a real seam won’t take the thread');
  assert.deepEqual(riftActions({ kind: 'wild' }, { inside: true }), ['stitch', 'leave']);
  assert.deepEqual(riftActions({ kind: 'wild' }, { inside: true, stitched: true }), ['deeper', 'leave']);
  assert.deepEqual(riftActions({ kind: 'story' }, { inside: true, stitched: true }), ['leave']);
  // Inside another rift's Elsewhere: no walk reaches this one from there, so Leave comes first.
  assert.deepEqual(riftActions({ kind: 'real' }, { away: true }), ['leave', 'ward', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real' }, { away: true, via: 'echo' }), ['leave', 'ward', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real', bright: true }, { away: true }), ['leave', 'let-be']);
  assert.deepEqual(riftActions({ kind: 'story' }, { away: true }), ['leave']);
  assert.deepEqual(riftActions({ kind: 'wild' }, { away: true }), ['leave', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'real', held: 'nights-off' }, { away: true }), ['war-table']);
  for (const kind of ['real', 'story', 'wild']) {
    for (const bright of [false, true]) {
      const offered = riftActions({ kind, bright }, { away: true });
      assert.ok(!offered.some((a) => ['step', 'visit', 'show'].includes(a)), `${kind}${bright ? ' bright' : ''} offers no way there from inside another Elsewhere`);
    }
  }
  assert.deepEqual(rowActions({ kind: 'real' }), ['ward', 'let-go']);
  assert.deepEqual(rowActions({ kind: 'story' }), []);
  assert.deepEqual(rowActions({ kind: 'real', bright: true }), ['let-be']);
});

test('inside an Elsewhere, the tear, the chests and the way home are listed wherever they are', () => {
  let checked = 0;
  const specs = [];
  for (let cy = -4; cy <= 4 && specs.length < 8; cy += 2) {
    for (let cx = -4; cx <= 4 && specs.length < 8; cx += 2) {
      for (const rift of wildRiftsForChunk({ worldgen, riftgen, cx, cy, day: dayNumber(NOON), wardRadius: 0, isFree })) specs.push(rift.spec);
    }
  }
  // And the ladder beneath the first: deeper ones, sometimes fused.
  for (let spec = specs[0], n = 0; spec && n < 4; n += 1) specs.push(spec = riftgen.deeper(spec));
  for (const spec of specs) {
    const layout = riftgen.layout(spec);
    const marks = elsewhereLandmarks(spec, layout);
    // The same ids, places and kinds the Elsewhere itself gives its objects, so walkToEntity finds them.
    const built = buildElsewhere(spec, layout, { genres: content.genres, kind: 'wild', words: content.riftgen });
    const clickable = new Map(built.objects.filter((o) => !o.scenery && o.kind !== 'foliage').map((o) => [o.id, o]));
    assert.deepEqual(new Set(marks.map((m) => m.id)), new Set(clickable.keys()), `every object is listed (${spec.name})`);
    for (const mark of marks) {
      const object = clickable.get(mark.id);
      assert.equal(mark.kind, object.kind);
      assert.deepEqual([mark.x, mark.y], [object.x, object.y]);
      assert.ok(mark.label.length > 2);
      assertCalm(mark.label);
    }
    assert.equal(marks[0].id, 'stitch', 'the tear comes first');
    assert.equal(marks.at(-1).id, 'exit', 'the way home comes last');
    const mended = elsewhereLandmarks(spec, layout, { stitched: true, opened: true });
    assert.ok(!mended.some((m) => m.id === 'stitch'), 'a mended tear is off the list');
    assert.ok(mended.filter((m) => m.kind === 'loot').every((m) => m.label === 'An open chest'));
    assert.equal(elsewhereLandmarks(spec, layout, { refused: true })[0].label, 'The seam, holding for now');
    checked += 1;
  }
  assert.ok(checked >= 6, `enough Elsewheres to check (${checked})`);
  // Landmarks first, then what's in view (strays), nearest first, each once; the engine's words win.
  const marks = [{ id: 'stitch', kind: 'stitch', x: 20, y: 5, label: 'The seam · stitch it' }, { id: 'loot:0', kind: 'loot', x: 3, y: 3, label: 'A chest' }, { id: 'exit', kind: 'exit', x: 2, y: 9, label: 'The way home' }];
  const inView = [{ id: 'stray:rift:a:1', kind: 'stray', x: 9, y: 9, label: 'Far stray' }, { id: 'loot:0', kind: 'loot', x: 3, y: 3, label: 'An open chest' }, { id: 'stray:rift:a:0', kind: 'stray', x: 3, y: 8, label: 'Near stray' }];
  const list = elsewhereEntries(marks, inView, { x: 2, y: 8 });
  assert.deepEqual(list.map((e) => e.id), ['stitch', 'loot:0', 'exit', 'stray:rift:a:0', 'stray:rift:a:1']);
  assert.equal(list[1].label, 'An open chest');
  assert.deepEqual(elsewhereLandmarks(null, null), []);
});

test('where Milo is, in the title bar and for screen readers', () => {
  assert.equal(areaStatus({ area: 'vale' }), '');
  assert.equal(areaStatus({ area: 'wilds', regionName: 'The Whisperwood', hush: true }), 'The Whisperwood · waiting in the Hush');
  assert.equal(areaStatus({ area: 'wilds', regionName: 'the Saltglass Reach', hush: false }), 'The Saltglass Reach');
  // A rift's name mid-sentence reads "the …", never "Inside The …".
  assert.equal(areaStatus({ area: 'elsewhere', depth: 4, rift: { id: 'rift:x', name: 'The Crowded Grinding Crypt' } }), 'Inside the Crowded Grinding Crypt · depth 4');
  assert.equal(areaStatus({ area: 'elsewhere', rift: { name: 'Codex: Static Arcade' } }), 'Inside Codex: Static Arcade');
  assert.match(areaLabel({ area: 'vale' }), /^Milo's world\./);
  // The vale says where its gates are, so the wilds can be found without seeing the map.
  assert.match(areaLabel({ area: 'vale' }), /gates in the tree line, north, west, east and south-west, lead out to the wilds\. The place list walks Milo to each\.$/);
  assert.match(areaLabel({ area: 'wilds', regionName: 'The Whisperwood', hush: true }), /^Milo's world, out in the Whisperwood beyond Hearthvale\. It waits in the Hush\./);
  assert.match(areaLabel({ area: 'elsewhere', rift: { name: 'The Crypt' } }), /Leave button/);
  assert.match(areaLabel({ area: 'elsewhere', rift: { name: 'The Crypt' } }), /, inside the Crypt, a pocket world/);
  assert.equal(midName('The Glass Fen'), 'the Glass Fen');
  for (const text of [areaLabel({ area: 'wilds' }), areaLabel({ area: 'elsewhere' }), areaLabel({ area: 'vale' })]) assertCalm(text);
  // The gates, for the vale's place list: each named, with the land its road leads to first, and
  // the first tile of that road, just past the tree line.
  const gates = gateEntries(anchors, GATES);
  assert.deepEqual(gates.map((g) => g.id), ['gate:n', 'gate:w', 'gate:e', 'gate:sw']);
  assert.deepEqual(gates.map((g) => g.title), ['North gate', 'West gate', 'East gate', 'South-west gate']);
  assert.equal(gates[0].note, 'To the Whisperwood');
  assert.equal(gates[1].note, 'To Cinderforge');
  assert.deepEqual(gates[0].out, { x: 32, y: -3 });
  for (const gate of gates) {
    assert.equal(inHeart(gate.out.x, gate.out.y), false, `${gate.id} leads out of the vale`);
    assert.equal(worldgen.walkable(gate.out.x, gate.out.y), true, `${gate.id}'s road is walkable`);
    assertCalm(`${gate.title} ${gate.note}`);
  }
  assert.equal(gateEntries()[0].note, 'To the wilds', 'before the regions are named');
  assert.equal(gateEntries()[0].out, null);
});

test('the evening bell offers Off and 20:00 to 01:00 in half hours', () => {
  const options = eveningBellOptions('22:00');
  assert.deepEqual(options.map((o) => o.value), ['', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00']);
  assert.equal(options[0].label, 'Off');
  assert.ok(eveningBellOptions('19:15').some((o) => o.value === '19:15'), 'a saved time outside the list stays choosable');
});

test('launch folds rift news into one line; later news becomes bubbles', () => {
  const result = loop(freshState(), snapshotWith({ sessions: [waiting('k4', 30)] }));
  // The session is what's waiting, never the rift knocking it over.
  assert.equal(bootRiftLine({ opened: result.opened }), 'A rift has opened over “Letters to answer”, which is waiting on you.');
  assert.equal(bootRiftLine({ opened: [{ ...result.opened[0], subject: '' }] }), 'A rift has opened over a session that’s waiting on you.');
  assert.equal(bootRiftLine({ opened: [...result.opened, { ...result.opened[0], id: 'rift:z' }] }), '2 rifts are open on the frontier. The watchtower lists them.');
  assert.equal(bootRiftLine({ opened: [{ kind: 'real', bright: true }] }), null, 'bright rifts never bubble');
  const bubbles = loopBubbles({ opened: result.opened, state: result.state });
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].kind, 'rift');
  assert.equal(bubbles[0].place, result.opened[0].id);
  assert.equal(bubbles[0].lines[0], result.opened[0].cause);
  // A Prologue step done while MILO is open gets its own quiet bubble.
  const done = loopBubbles({ completed: ['ground'], state: { ...createState(), lastSeenAt: NOON, tally: { ...createState().tally, buildingsDesigned: 1, finishedIds: ['a'] } }, story: content.story });
  assert.equal(done[0].kind, 'story');
  assert.match(done[0].lines[0], /^“Ground That’s Waiting” is done\.$/);
  assert.match(done[0].lines[1], /^Next: /);
  for (const bubble of [...bubbles, ...done]) assertCalm([bubble.title, ...bubble.lines].join(' '));
});

// ---------------------------------------------------------------------------
// The wilds' words and loot.

test('lines are picked by id, so the same place always says the same thing', () => {
  const lines = content.wilds.examine.ruin;
  assert.equal(pickLine(lines, 'poi:ruin:3,4'), pickLine(lines, 'poi:ruin:3,4'));
  const picked = new Set(Array.from({ length: 60 }, (_, i) => pickLine(lines, `poi:ruin:${i},0`)));
  assert.ok(picked.size > 1, 'different places say different things');
  assert.equal(pickLine([], 'x'), '');
  assert.equal(pickLine(null, 'x'), '');
});

test('chest and ruin loot come from the content ranges, inclusive, seeded by id', () => {
  const ranges = content.wilds.loot.chest;
  const seen = { birch: new Set(), ash: new Set(), pine: new Set() };
  for (let i = 0; i < 400; i += 1) {
    const loot = lootFor(`poi:chest:${i},${-i}`, ranges, 'chest');
    for (const [material, amount] of Object.entries(loot)) {
      const [lo, hi] = ranges[material];
      assert.ok(Number.isInteger(amount) && amount >= lo && amount <= hi, `${material} ${amount} in [${lo}, ${hi}]`);
      seen[material].add(amount);
    }
  }
  assert.ok(seen.birch.has(ranges.birch[0]) && seen.birch.has(ranges.birch[1]), 'both ends of the range come up');
  assert.deepEqual(lootFor('poi:chest:1,1', ranges, 'chest'), lootFor('poi:chest:1,1', ranges, 'chest'));
  assert.equal(rollRange([3, 3], 99), 3);
  assert.equal(materialsText({ birch: 12, ash: 4 }), '12 birch and 4 ash');
  assert.equal(materialsText({ birch: 1, ash: 2, pine: 3 }), '1 birch, 2 ash and 3 pine');
  assert.equal(floatWords({ birch: 12, pine: 2 }), '+12 birch · +2 pine');
  // Finds from a mended rift read as one list, with no second 'and'.
  const finds = [...materialItems({ birch: 15, ash: 3, pine: 2 }), ...lootItems([{ item: 'Canned moonbrew', qty: 2 }, { item: 'Mixtape of Rook', relic: true }])];
  assert.equal(listWords(finds), '15 birch, 3 ash, 2 pine, canned moonbrew × 2 and Mixtape of Rook');
  assert.deepEqual(lootItems([{ item: 'A' , qty: 1 }, { item: 'B', qty: 1 }, { item: 'C', qty: 1 }, { item: 'D', qty: 1 }]).length, 3);
  assert.deepEqual(lootItems(null), []);
});

test('chopping gives the contract’s logs, the same all day for one tree', () => {
  for (const [kind, wood] of [['tree.birch', 'birch'], ['tree', 'ash'], ['tree.blossom', 'ash'], ['pine', 'pine'], ['pine.snow', 'pine'], ['birch', 'birch']]) {
    assert.equal(woodOf(kind), wood);
    for (let i = 0; i < 50; i += 1) {
      const logs = chopLogs(`tree:${i},${i * 3}`, kind, 20000);
      assert.equal(logs.kind, wood);
      assert.ok(logs.amount >= LOG_RANGES[wood][0] && logs.amount <= LOG_RANGES[wood][1]);
    }
  }
  assert.deepEqual(LOG_RANGES, { birch: [4, 7], ash: [3, 5], pine: [2, 4] });
  assert.deepEqual(chopLogs('tree:1,1', 'tree', 5), chopLogs('tree:1,1', 'tree', 5));
  assert.ok(chopLine('birch', 'tree:1,1', content.wilds).length > 10);
});

test('ids, chunk keys and map tablets', () => {
  assert.deepEqual(parseId('lantern:12,-18'), { kind: 'lantern', type: 'lantern', x: 12, y: -18 });
  assert.deepEqual(parseId('poi:chest:1,-26'), { kind: 'poi', type: 'chest', x: 1, y: -26 });
  assert.deepEqual(parseId('tree:-4,9'), { kind: 'tree', type: 'tree', x: -4, y: 9 });
  assert.equal(parseId('rift:abc'), null);
  assert.equal(parseId('poi:<b>:1,2'), null);
  assert.equal(chunkKeyOf(-1, 31), '-1,0');
  assert.equal(chunkKeyOf(32, -33), '1,-2');
  assert.deepEqual(tabletKeys(40, -5), ['0,-2', '1,-2', '2,-2', '0,-1', '1,-1', '2,-1', '0,0', '1,0', '2,0']);
  assert.ok(chanceFor('x', 1) && !chanceFor('x', 0));
  const tablets = Array.from({ length: 400 }, (_, i) => chanceFor(`poi:ruin:${i},1`, 0.25, 'tablet')).filter(Boolean).length;
  assert.ok(tablets > 60 && tablets < 140, `about a quarter of ruins hold a tablet (${tablets} of 400)`);
});

test('every kind of place in the wilds has calm words and the right action', () => {
  const state = createState();
  const expect = { chest: 'open', ruin: 'search', note: 'read', statue: 'listen', cave: null, hamlet: null, ore: null, herbs: null, fishing: null, quay: null, landmark: null };
  for (const [type, action] of Object.entries(expect)) {
    const poi = { id: `poi:${type}:5,-40`, type, x: 5, y: -40, name: `A ${type}`, region: type === 'statue' || type === 'landmark' ? 'whisperwood' : undefined };
    const view = poiView(poi, content.wilds, state, { regionId: poi.region });
    assert.ok(view.lines.length >= 1, `${type} has examine words`);
    assert.equal(view.action?.id ?? null, action, `${type}'s action`);
    for (const line of view.lines) assertCalm(line, type);
    if (['cave', 'ore', 'herbs', 'fishing', 'quay'].includes(type)) assert.ok(view.later.length > 10, `${type} says what's to come`);
  }
  const landmark = poiView({ id: 'poi:landmark:1,1', type: 'landmark', name: 'The Whisperwood', region: 'whisperwood' }, content.wilds, state);
  assert.deepEqual(landmark.lines, [content.wilds.regions.whisperwood.arrive, content.wilds.regions.whisperwood.hush]);
  const westwatch = poiView({ id: 'poi:landmark:-200,9', type: 'landmark', name: 'The Westwatch' }, content.wilds, state, { night: true });
  assert.ok(content.wilds.examine.westwatch.night.includes(westwatch.lines[0]), 'the Westwatch sees the Lighthouse at night');
  // Done: opened, read, heard.
  const done = { ...state, wilds: { ...state.wilds, opened: { 'poi:chest:1,1': 1, 'poi:ruin:1,1': 1 }, notes: { 'poi:note:1,1': 1 }, glimmers: { 'poi:statue:1,1': 1 } } };
  assert.equal(poiView({ id: 'poi:chest:1,1', type: 'chest', name: 'An old chest' }, content.wilds, done).done, true);
  assert.equal(poiView({ id: 'poi:ruin:1,1', type: 'ruin', name: 'Maker ruins' }, content.wilds, done).action, null);
  const note = poiView({ id: 'poi:note:1,1', type: 'note', name: 'A note' }, content.wilds, done);
  assert.equal(note.body.kind, 'note');
  assert.ok(content.wilds.notes.some((n) => n.text === note.body.text));
  const statue = poiView({ id: 'poi:statue:1,1', type: 'statue', name: 'A statue', region: 'cinderforge' }, content.wilds, done);
  assert.match(statue.lines[0], /^It’s missing .+\.$/);
  assert.equal(statue.body.text, content.wilds.statues.cinderforge.glimmer);
});

test('chests, mimics, ruins, notes, statues and lanterns', () => {
  const plain = openChest({ id: 'poi:chest:2,2', type: 'chest', mimic: false }, content.wilds);
  const mimic = openChest({ id: 'poi:chest:2,2', type: 'chest', mimic: true }, content.wilds);
  assert.deepEqual(plain.materials, mimic.materials, 'the same chest gives the same loot');
  assert.ok(content.wilds.mimic.includes(mimic.line), 'a mimic speaks in mimic lines');
  assert.equal(plain.line, '', 'a plain chest just shows what was inside');
  // Just opened, the panel shows what was found, not the lines for coming back to it.
  const opened = { ...createState(), wilds: { ...createState().wilds, opened: { 'poi:chest:2,2': 1 } } };
  const chestPoi = { id: 'poi:chest:2,2', type: 'chest', name: 'An old chest' };
  assert.equal(poiView(chestPoi, content.wilds, opened, { fresh: true }).lines.length, 0);
  assert.ok(content.wilds.examine.chestOpened.includes(poiView(chestPoi, content.wilds, opened).lines[0]));
  const ruin = searchRuin({ id: 'poi:ruin:9,-40', type: 'ruin', x: 9, y: -40 }, content.wilds);
  assert.equal(ruin.keys.length, ruin.tablet ? 9 : 0);
  const regional = noteFor('poi:note:1,1', content.wilds, 'whisperwood');
  assert.equal(regional.region, 'whisperwood');
  assert.equal(noteFor('poi:note:1,1', content.wilds, null).region, null);
  assert.equal(statueFor('glass-fen', content.wilds).text, `It’s missing ${content.wilds.statues['glass-fen'].missing}.`);
  assert.equal(statueFor('nowhere', content.wilds), null);
  const state = createState();
  const sleeping = lanternView({ id: 'lantern:12,-18', name: 'A sleeping lantern' }, content.wilds, state);
  assert.equal(sleeping.lit, false);
  assert.ok(content.wilds.examine.lantern.sleeping.includes(sleeping.lines[0]));
  const lit = lanternView({ id: 'lantern:12,-18', name: 'A sleeping lantern' }, content.wilds, { ...state, wilds: { ...state.wilds, lanterns: { 'lantern:12,-18': 1 }, wake: 'lantern:12,-18' } });
  assert.equal(lit.lit, true);
  assert.equal(lit.wake, true);
  assert.equal(lit.title, 'A lit lantern');
  const region = lanternView({ id: 'lantern:34,-52', name: 'The lantern of the Whisperwood', region: 'whisperwood' }, content.wilds, state);
  assert.equal(region.lines[1], content.wilds.regions.whisperwood.arrive);
});

test('strays are named from their rift, and talk by temperament', () => {
  const spec = riftgen.realRift({ key: 'knock:claude:s', subject: '“Letters”', signals: ['needs-you-unanswered'], urgency: 0.9, tier: 1, cause: 'x' });
  const first = strayOf(spec, 0);
  assert.equal(first, spec.strays[0]);
  assert.ok(strayLine(first, 'stray:rift:x:0', content.wilds).length > 5);
  assert.equal(strayOf(spec, 99), null);
});

// ---------------------------------------------------------------------------
// The panels' HTML.

const EVIL = '<img src=x onerror="window.__injected=1">';
const genreFor = (id) => genres.get(id);

function rowFor(overrides = {}) {
  return {
    id: 'rift:abc', key: 'capacity:codex:1', kind: 'real', realKind: 'capacity', name: `Codex ${EVIL}`,
    genres: [genreFor('neon')], cause: `Cause ${EVIL}`, where: '10 tiles out, toward Cinderforge', stage: 'Open', stageId: 'open',
    x: -15, y: 22, warded: false, held: false, bright: false, atWalls: false, actions: ['ward', 'let-go'], ...overrides,
  };
}

test('rift rows escape what they show and expose where each rift stands', () => {
  const html = riftRow(rowFor());
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /data-x="-15" data-y="22"/);
  assert.match(html, /data-rift-id="rift:abc"/);
  assert.match(html, /data-rift-key="capacity:codex:1"/);
  assert.match(html, /data-genre="neon"/);
  assert.match(html, /style="--rim:#[0-9a-f]{6}"/i);
  assert.match(html, /data-action="rift-ward"[^>]*>Ward for 3 days</);
  assert.match(html, /data-action="rift-let-go"[^>]*>Let go</);
  const held = riftRow(rowFor({ held: true, x: null, y: null, actions: [] }));
  assert.doesNotMatch(held, /data-x=/, 'a held rift has no place on the map');
  const confirm = riftRow(rowFor(), { confirming: 'rift:abc' });
  assert.match(confirm, /role="alertdialog"/);
  assert.match(confirm, /Let Codex &lt;img/);
  assert.match(confirm, /data-action="rift-let-go-cancel"[^>]*>Keep it</);
  assert.match(riftRow(rowFor({ genres: [{ id: 'x', name: 'X', rim: 'red;background:url(x)' }] })), /--rim:#9cbfdc/, 'only real colours reach the style');
  const section = riftSection([rowFor(), rowFor({ id: 'rift:def' })]);
  assert.match(section, /data-group="rifts"/);
  assert.match(section, /<span class="count">2<\/span>/);
  assert.match(riftSection([]), /No rifts on the frontier/);
  assert.match(closedRow({ id: 'rift:old', name: EVIL, genres: [], how: 'sealed', text: 'Sealed today' }), /&lt;img/);
  for (const text of [section, riftSection([]), confirm]) assertCalm(text);
});

test('the rift panel says why and how to mend it, with its actions', () => {
  const html = riftPanel({
    id: 'rift:abc', kind: 'real', realKind: 'knocking', name: EVIL, genres: [genreFor('gothic')], stage: 'Gaping', stageId: 'gaping', kindWord: 'Real',
    where: '5 tiles out, toward the Greyreach', cause: `Waited ${EVIL}`, stitch: 'Answer Claude in that session.', mood: 'Candles.',
    wardText: '', held: null, affixes: [{ name: 'Lonely', text: 'Only one stray.' }], lead: { name: 'Lord', mechanic: 'reads letters', line: 'The candles have noticed.' },
    loot: [{ item: 'Raven quill', qty: 4 }, { item: 'Ring', qty: 1, relic: true, text: 'Once belonged.' }], actions: ['step', 'ward', 'let-go'], artLabel: 'A tear',
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<h3>Why<\/h3><p class="rift-text">Waited &lt;img/);
  assert.match(html, /<h3>To mend it<\/h3><p class="rift-text">Answer Claude in that session\.<\/p>/);
  assert.match(html, /canvas class="plot-canvas" data-scene="rift" data-rift-id="rift:abc"/);
  assert.match(html, /The Tale-lead/);
  assert.match(html, /× 4/);
  assert.match(html, /class="px-btn primary" data-action="rift-step"[^>]*>Step through</);
  assert.match(html, /data-action="rift-ward"[^>]*>Ward for 3 days</);
  assert.equal(actionWord('unward'), 'Take the ward down');
  assert.equal(actionWord('show'), 'Show me on the map');
  assert.equal(actionWord('let-be'), 'Let it be');
  assertCalm(html);
  const inside = riftPanel({ id: 'rift:w', kind: 'wild', name: 'Wild', genres: [], stage: 'Open', stageId: 'open', cause: 'c', stitch: 's', actions: ['stitch', 'leave'], inside: true, says: 'Here.' });
  assert.match(inside, /data-inside="true"/);
  assert.match(inside, /data-action="rift-stitch"/);
  // Stitched from inside: nothing left to mend, and the gifts it gave are already in the satchel.
  const mended = riftPanel({
    id: 'rift:w', kind: 'wild', name: 'Wild', genres: [], stage: 'Open', stageId: 'open', cause: 'c', stitch: '', actions: ['deeper', 'leave'],
    inside: true, says: 'Mended.', loot: [{ item: 'Chrome scrap', qty: 2 }], lootTaken: true,
  });
  assert.doesNotMatch(mended, /data-section="mend"|To mend it/, 'no “To mend it” once it’s mended');
  assert.match(mended, /data-section="loot" data-taken="true"><h3>What it left<\/h3><p class="rift-meta">It’s in your satchel now\.<\/p>/);
  assert.doesNotMatch(mended, /What it leaves/);
  assert.match(riftPanel({ id: 'rift:w', kind: 'wild', name: 'Wild', genres: [], stage: 'Open', stageId: 'open', cause: 'c', stitch: 'Stitch the seam from in here.', inside: true, loot: [{ item: 'Chrome scrap', qty: 2 }] }), /<h3>To mend it<\/h3><p class="rift-text">Stitch the seam from in here\.<\/p>[\s\S]*<h3>What it leaves<\/h3>/);
  assertCalm(mended);
  // A rift's name mid-sentence: "Let the Portrait of … go?", never "Let The Portrait …".
  const letGo = riftPanel({ id: 'rift:p', kind: 'real', name: 'The Portrait of “Letters to answer”', genres: [], stage: 'Open', stageId: 'open', cause: 'c', stitch: 's', actions: ['step', 'ward', 'let-go'], confirming: true });
  assert.match(letGo, />Let the Portrait of “Letters to answer” go\?</);
  assert.match(riftRow(rowFor({ name: 'Codex: Static Arcade' }), { confirming: 'rift:abc' }), />Let Codex: Static Arcade go\?</);
  assert.match(hearthPanel({ tier: 1, name: 'The Camp', look: '', ward: 0, defences: [], next: null, satchel: { materials: {}, essences: [], relics: [] } }), /aria-label="Pixel drawing of the Camp"/);
});

test('every rift panel names its Tale-lead, and says where it is', () => {
  const base = { id: 'rift:t', kind: 'real', name: 'Tear', genres: [], stage: 'Open', stageId: 'open', cause: 'c', stitch: 's', actions: ['step'] };
  const lead = { name: `Director ${EVIL}`, mechanic: 'buys the embers', line: 'Everything has a price.' };
  const where = (view) => /data-section="lead" data-lead="(\w+)"/.exec(view)?.[1] ?? null;
  const waiting = riftPanel({ ...base, lead: { ...lead, where: 'waiting' } });
  assert.equal(where(waiting), 'waiting');
  assert.match(waiting, /<strong>Director &lt;img[^<]*<\/strong> buys the embers\./);
  assert.match(waiting, /<p class="lead-line">“Everything has a price\.”<\/p>/);
  assert.match(waiting, /It steps out beside the tear if the rift gapes\./);
  assert.doesNotMatch(waiting, /<img/);
  assert.equal(where(riftPanel({ ...base, stageId: 'gaping', lead: { ...lead, where: 'out' } })), 'out');
  assert.match(riftPanel({ ...base, stageId: 'gaping', lead: { ...lead, where: 'out' } }), /stands beside the tear\./);
  assert.match(riftPanel({ ...base, inside: true, lead: { ...lead, where: 'inside' } }), /farthest room of this place/);
  assert.equal(riftPanel({ ...base, lead: null }).includes('data-section="lead"'), false, 'no lead, no section');
  assertCalm(waiting);
  // A lead named for the middle of a line starts its sentence with a capital.
  assert.match(riftPanel({ ...base, lead: { name: 'the Keeper of Letters Wren', mechanic: 'calls ravens that circle the room', where: 'waiting' } }), /<strong>The Keeper of Letters Wren<\/strong> calls ravens/);
  assert.equal(startName('the Keeper of Letters Wren'), 'The Keeper of Letters Wren');
  assert.equal(startName('Juno, the Holographic Director'), 'Juno, the Holographic Director');
  assert.equal(startName(''), '');
  assert.equal(startName(null), '');
  // Every real lead riftgen makes reads well at the start of a line.
  for (let n = 0; n < 60; n += 1) {
    const spec = riftgen.realRift({ key: `knock:claude:${n}`, subject: '“Letters”', signals: ['needs-you-unanswered'], urgency: 0.5, tier: 1, cause: 'c' });
    if (spec.taleLead?.name) assert.match(startName(spec.taleLead.name), /^[A-Z0-9“]/, spec.taleLead.name);
  }
});

test('the War Table lists groups and holds the defences', () => {
  const settings = { gateBell: true, wardPost: 'capacity-95', eveningBell: '22:30', bellOptions: eveningBellOptions('22:30'), rules: WARD_POST_RULES.map((r) => ({ ...r })) };
  const html = warTablePanel({ groups: [{ id: 'walls', title: 'At the walls', rows: [rowFor({ atWalls: true })] }, { id: 'closed', title: 'Recently closed', closed: [{ id: 'rift:o', name: 'Old', genres: [], how: 'let-go', text: 'Let go today' }] }], settings, mapLabel: 'The frontier' });
  assert.match(html, /data-scene="war-map"/);
  assert.match(html, /data-group="walls"/);
  assert.match(html, /data-walls="true"/);
  assert.match(html, /data-group="closed"/);
  assert.match(html, /data-setting="gateBell"[^>]*>/);
  assert.match(html, /aria-checked="true" aria-labelledby="setting-gateBell"/);
  assert.match(html, /value="capacity-95" data-ward-post="capacity-95" data-focus-key="ward-post-capacity-95" checked/);
  assert.match(html, /value="" data-ward-post="" data-focus-key="ward-post-none">/);
  assert.match(html, /<option value="22:30" selected>22:30<\/option>/);
  assert.match(html, /<option value="">Off<\/option>/);
  for (const rule of WARD_POST_RULES) assert.match(html, new RegExp(rule.name));
  assert.match(warTablePanel({ groups: [], settings, mapLabel: '' }), /The frontier is quiet/);
  // The map's key is in the HTML, so a background refresh repaints the map only when it changes.
  assert.match(warTablePanel({ groups: [], settings, mapLabel: '', mapKey: '12:3:rift:a@1,2' }), /data-scene="war-map" data-map-key="12:3:rift:a@1,2"/);
  assert.match(html, /one quiet note on your desktop while MILO is in the background, even with Alerts off\./);
  assert.match(eveningBellSetting({ ...settings, eveningBell: '' }), /<option value="" selected>Off/);
  assertCalm(html);
});

test('the Hearth panel shows the real counts, have and need', () => {
  const state = { ...createState(), tally: { daysSeen: 3, lastDay: null, sessionsFinished: 12, finishedIds: [], buildingsDesigned: 1 }, satchel: { materials: { birch: 40, ash: 30, pine: 2 }, essences: { 'Neon shard': 3 }, essenceGenres: { 'Neon shard': 'neon' }, relics: [{ name: EVIL, text: 'Old' }] } };
  const status = hearthStatus(state, content.fortress);
  const html = hearthPanel({ tier: status.tier, name: status.def.name, look: status.def.look, ward: status.wardRadius, defences: status.def.defences, next: status.next, satchel: { materials: state.satchel.materials, essences: [{ name: 'Neon shard', qty: 3, genre: 'neon' }], relics: state.satchel.relics }, reason: 'Not yet.' });
  assert.match(html, /data-req="crew-sessions-finished" data-level-state="locked" data-have="12" data-need="20"/);
  assert.match(html, /data-req="buildings-designed" data-level-state="proven" data-have="1" data-need="1"/);
  assert.match(html, /data-req="days-with-milo" data-level-state="locked" data-have="3" data-need="7"/);
  assert.match(html, /data-material="birch" data-level-state="locked" data-have="40" data-need="80"/);
  assert.match(html, /data-material="ash" data-level-state="proven" data-have="30" data-need="30"/);
  assert.match(html, /Next: The Stockade/);
  assert.match(html, /It will want Construction level 5 one day\. That isn’t asked for yet\./);
  assert.doesNotMatch(html, /Phase \d/, 'no build phases in the game’s words');
  assert.match(html, /data-note="not-ready"/);
  assert.doesNotMatch(html, /data-action="raise"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Neon shard <span class="qty">× 3/);
  const ready = hearthPanel({ tier: 1, name: 'The Camp', look: '', ward: 0, defences: [], next: { ...status.next, ready: true }, satchel: {} });
  assert.match(ready, /data-action="raise"[^>]*>Raise the Stockade</);
  assert.match(satchelSection({}), /Empty for now/);
  assertCalm(html);
});

test('a met requirement reads Done, and enough of a material reads as need of need', () => {
  // Four buildings designed where one is asked for, and more birch than the Stockade needs.
  const state = { ...createState(), tally: { daysSeen: 9, lastDay: null, sessionsFinished: 5, finishedIds: [], buildingsDesigned: 4 }, satchel: { materials: { birch: 120, ash: 8, pine: 0 }, essences: {}, relics: [] } };
  const status = hearthStatus(state, content.fortress);
  const html = hearthPanel({ tier: 1, name: 'The Camp', look: '', ward: 0, defences: [], next: status.next, satchel: state.satchel });
  const row = (attr) => new RegExp(`<li ${attr}[^>]*>(.*?)</li>`).exec(html)?.[1] ?? '';
  const tagOf = (attr) => {
    const html = row(attr);
    const at = html.indexOf('<span class="level-tag">');
    return at < 0 ? '' : html.slice(at).replace(/<[^>]*>/g, '');
  };
  assert.equal(tagOf('data-req="buildings-designed"'), 'Done', 'never "4 of 1"');
  assert.equal(tagOf('data-req="days-with-milo"'), 'Done', 'never "9 of 7"');
  assert.equal(tagOf('data-req="crew-sessions-finished"'), '5 of 20', 'one still in progress keeps have and need');
  assert.match(row('data-req="buildings-designed"'), /tick-check/, 'with the check glyph');
  assert.match(row('data-material="birch"'), /tick-check/);
  assert.equal(tagOf('data-material="birch"'), '80 of 80', 'have capped at need once there’s enough');
  assert.equal(tagOf('data-material="ash"'), '8 of 30');
  // The real counts stay on the rows for anything that reads them.
  assert.match(html, /data-req="buildings-designed" data-level-state="proven" data-have="4" data-need="1"/);
  assert.match(html, /data-material="birch" data-level-state="proven" data-have="120" data-need="80"/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /\b4 of 1\b|\b9 of 7\b|\b120 of 80\b/, 'no count past its need');
  assert.equal(requirementTag({ future: true, met: false, have: 0, count: 30 }), 'Later');
  assert.equal(materialTag({ met: true, have: 3, need: 2 }).replace(/<[^>]*>/g, ''), '2 of 2');
  assertCalm(html);
});

test('a lantern Milo rests at comes right after home on his travel lists, and nothing promises more', () => {
  const place = (id) => ({ name: `Lantern ${id}`, note: '12 tiles from home' });
  const lit = { 'lantern:1,1': 1, 'lantern:2,2': 2, 'lantern:3,3': 3 };
  const list = travelChoices(lit, { here: 'lantern:1,1', wake: 'lantern:3,3', place });
  assert.deepEqual(list.map((t) => t.id), ['home', 'lantern:3,3', 'lantern:2,2'], 'home, where Milo rests, then the rest in the order lit');
  assert.equal(list[1].note, 'Where Milo rests');
  assert.deepEqual(travelChoices(lit, { here: 'lantern:3,3', wake: 'lantern:3,3', place }).map((t) => t.id), ['home', 'lantern:1,1', 'lantern:2,2'], 'never the lantern he’s at');
  assert.deepEqual(travelChoices(null, {}).map((t) => t.id), ['home']);
  const resting = lanternPanel({ id: 'lantern:3,3', title: 'A lit lantern', lines: [], lit: true, wake: true, travel: list });
  const notYet = lanternPanel({ id: 'lantern:3,3', title: 'A lit lantern', lines: [], lit: true, wake: false, travel: list });
  for (const html of [resting, notYet]) {
    assert.doesNotMatch(html, /wake/i, 'resting promises nothing the game doesn’t do');
    assertCalm(html);
  }
  // Home always leads the list, so the hint says where the resting lantern really stands: right after it.
  const hint = (html) => html.match(/<p class="setting-hint">([^<]*)<\/p>/)[1];
  assert.equal(hint(resting), 'Milo rested here last. It’s right after home on his travel lists.');
  assert.equal(hint(notYet), 'Sit a while by its light. The lantern Milo rests at comes right after home on his travel lists.');
  for (const html of [resting, notYet]) assert.doesNotMatch(html, /first on his travel list/, 'home is first, not the lantern');
});

test('the shell shares the engine’s worldgen and terrain when it offers them, and lists an Elsewhere from the engine', () => {
  // A whole worldgen is shared; a missing or partial one isn't.
  assert.equal(sharedWorldgen({ worldgen }), worldgen);
  assert.equal(sharedWorldgen({}), null);
  assert.equal(sharedWorldgen(null), null);
  assert.equal(sharedWorldgen({ worldgen: { anchors: [], roads() {} } }), null, 'a partial one is never trusted');
  assert.equal(sharedWorldgen({ get worldgen() { throw new Error('gone'); } }), null);
  // Terrain: the engine's when it has it (roads kept off the ring), else the shell's own wilds'.
  const calls = [];
  const engine = { worldgen, terrainAt: (x, y) => { calls.push([x, y]); return TERRAIN.ROAD; } };
  assert.equal(terrainSource(engine, wilds)(40, -3), TERRAIN.ROAD);
  assert.deepEqual(calls, [[40, -3]]);
  const own = terrainSource({}, wilds);
  assert.equal(own(40, -3), wilds.terrainAt(40, -3));
  assert.equal(terrainSource({}, null), null);
  // A vale-only engine has terrainAt too, but no wilds behind it (world.worldgen is null), so it
  // answers null out there: the shell's own wilds answer instead.
  const valeOnly = { worldgen: null, terrainAt: () => null };
  assert.equal(terrainSource(valeOnly, wilds)(40, -3), wilds.terrainAt(40, -3), 'no worldgen: the shell’s own wilds answer');
  assert.equal(terrainSource({ terrainAt: () => null }, wilds)(40, -3), wilds.terrainAt(40, -3));
  assert.equal(terrainSource({ get worldgen() { throw new Error('gone'); }, terrainAt: () => null }, wilds)(40, -3), wilds.terrainAt(40, -3));
  assert.equal(terrainSource(valeOnly, null), null, 'with nothing else to ask, nothing answers');
  // The engine names the vale's tiles in the vale's own letters; the shell reads the heart there,
  // as its own wilds would, so neither the reach test nor the War Table's map sees a stray code.
  const vale = terrainSource({ worldgen, terrainAt: () => '.' }, wilds, { heart: TERRAIN.HEART });
  assert.equal(vale(10, 10), TERRAIN.HEART);
  assert.equal(vale(10, 10), wilds.terrainAt(10, 10));
  assert.equal(vale(-1, 10), '.', 'outside the heart the engine answers');
  // The engine's own list of an Elsewhere's things: landmarks in order, each once; strays left
  // to what's in view.
  const listed = engineLandmarks([
    { kind: 'stray', id: 'stray:rift:a:0', x: 3, y: 3, label: 'A stray' },
    { kind: 'exit', id: 'exit', x: 1, y: 9, label: 'The way home' },
    { kind: 'loot', id: 'loot:10', x: 8, y: 2, label: 'A chest' },
    { kind: 'loot', id: 'loot:2', x: 7, y: 2, label: 'An open chest' },
    { kind: 'curio', id: 'curio', x: 5, y: 5, label: 'A curio' },
    { kind: 'stitch', id: 'stitch', x: 9, y: 9, label: 'The seam · stitch it' },
    { kind: 'tale-lead', id: 'tale-lead', x: 12, y: 4, label: 'Juno' },
    { kind: 'exit', id: 'exit', x: 1, y: 9, label: 'Twice' },
    { kind: 'loot', id: 'loot:3', x: null, y: 2, label: 'Nowhere' },
    null,
  ]);
  assert.deepEqual(listed.map((e) => e.id), ['stitch', 'tale-lead', 'loot:2', 'loot:10', 'curio', 'exit']);
  assert.equal(listed[2].label, 'An open chest', 'the engine’s words');
  assert.equal(engineLandmarks(undefined), null, 'no list: the shell falls back to the layout');
  // The engine's list and the layout's name the same places for a real Elsewhere.
  for (let n = 0; n < 6; n += 1) {
    const spec = riftgen.realRift({ key: `capacity:codex:${n}`, subject: 'Codex', signals: ['crew-capacity-high'], urgency: 0.6, tier: 1, cause: 'c' });
    const layout = riftgen.layout(spec);
    const scene = buildElsewhere(spec, layout, { genres: content.genres });
    const fromEngine = engineLandmarks(scene.objects.filter((o) => !o.scenery).map((o) => ({ kind: o.kind, id: o.id, x: o.x, y: o.y, label: o.label })));
    const fromLayout = elsewhereLandmarks(spec, layout, { refused: true });
    assert.deepEqual(fromEngine.map((e) => e.id), fromLayout.map((e) => e.id), spec.id);
  }
});

test('lanterns, places and the Prologue', () => {
  const sleeping = lanternPanel({ id: 'lantern:1,2', title: 'A sleeping lantern', lines: ['Cold.'], lit: false, wake: false, travel: [] });
  assert.match(sleeping, /data-action="light"[^>]*>Light it</);
  assert.doesNotMatch(sleeping, /data-action="travel"/);
  const lit = lanternPanel({ id: 'lantern:1,2', title: 'A lit lantern', lines: [], lit: true, wake: false, travel: [{ id: 'lantern:3,4', name: EVIL, note: '' }, { id: 'home', name: 'Home', note: 'Hearthvale' }] });
  assert.match(lit, /data-action="rest"[^>]*>Rest here</);
  assert.match(lit, /data-action="travel" data-target="home"/);
  assert.match(lit, /&lt;img/);
  const resting = lanternPanel({ id: 'lantern:1,2', title: 'A lit lantern', lines: [], lit: true, wake: true, travel: [] });
  assert.match(resting, /disabled>Resting here</);
  const chest = poiPanel({ id: 'poi:chest:1,1', type: 'chest', title: 'An old chest', lines: ['Heavy.'], action: { id: 'open', label: 'Open it' }, done: false, later: '' });
  assert.match(chest, /data-action="poi-open"/);
  const note = poiPanel({ id: 'poi:note:1,1', type: 'note', title: 'A note', lines: [], body: { kind: 'note', from: 'Tamsin', text: EVIL }, action: null, done: true, later: '', result: ['Found: 1.'] });
  assert.match(note, /<footer>— Tamsin<\/footer>/);
  assert.match(note, /&lt;img/);
  // A note that signs itself is signed once, at the foot.
  const signed = poiPanel({ id: 'poi:note:1,1', type: 'note', title: 'A note', lines: [], body: { kind: 'note', from: 'Tamsin', text: 'The nails are in the tin. — T.' }, action: null, done: true, later: '' });
  assert.match(signed, /<p>The nails are in the tin\.<\/p><footer>— T\.<\/footer>/);
  for (const entry of content.wilds.notes) {
    const split = splitSignature(entry.text, entry.from);
    assert.ok(split.text.length > 20 && /^— \S/.test(split.sign), `${entry.id} signs itself once`);
    assert.ok(!split.text.includes('—') || !/—\s*\S+\.?$/.test(split.text), `${entry.id} keeps no second signature`);
  }
  const status = prologueStatus({ ...createState(), lastSeenAt: 1, tally: { ...createState().tally, buildingsDesigned: 1, finishedIds: ['x'] } }, content.story);
  const story = storyPanel({ title: status.title, steps: status.steps, doneCount: 3, letter: content.story.letters.oriel, showLetter: false, letterRead: false });
  assert.match(story, /data-step="letter" data-level-state="next"/);
  assert.match(story, /data-action="letter-read"/);
  const read = storyPanel({ title: status.title, steps: status.steps, doneCount: 4, letter: content.story.letters.oriel, showLetter: true, letterRead: true });
  assert.match(read, /class="letter-section"/);
  assert.match(read, /— O\./);
  const card = trackerCard({ hidden: false, title: 'A Letter by Paper Bird', hint: 'Read it.', doneCount: 3, total: 7, canRead: true });
  assert.match(card, /The Prologue · 3 of 7/);
  assert.match(card, /data-action="letter-read"/);
  assert.match(card, /data-action="tracker-hide"/);
  assert.match(trackerCard({ hidden: true, doneCount: 3, total: 7 }), /data-action="tracker-show"/);
  const banner = elsewhereBanner({ name: EVIL, depth: 4, genres: [genreFor('neon'), genreFor('nocturne')] });
  assert.match(banner, /data-action="leave-elsewhere"[^>]*>Leave</);
  assert.match(banner, /Depth 4/);
  assert.match(banner, /&lt;img/);
  const list = entityList([{ id: 'lantern:1,2', kind: 'lantern', label: EVIL, note: '3 tiles' }]);
  assert.match(list, /data-entity="lantern:1,2" data-kind="lantern"/);
  assert.match(list, /data-entity="home" data-kind="home">Travel home/);
  assert.match(entityList([], { home: 'leave' }), /data-entity="leave"/);
  for (const text of [sleeping, lit, chest, note, story, read, card, banner, list]) { assert.doesNotMatch(text, /<img/); assertCalm(text); }
  assert.equal(esc(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;');
});

// ---------------------------------------------------------------------------
// The panels' pictures.

const opaque = (img) => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n += 1;
  return n;
};

test('rift pictures draw the tear on bled ground, with strays when open', () => {
  for (const [key, signals, urgency] of [['capacity:codex:1', ['crew-capacity-high'], 0.62], ['knock:claude:x', ['needs-you-unanswered'], 0.95], ['night:2026-09-27', ['working-past-bell'], 0.3]]) {
    const spec = riftgen.realRift({ key, subject: 'X', signals, urgency, tier: 1, cause: 'x' });
    const rift = { id: spec.id, spec, stage: spec.stage, kind: 'real' };
    const img = riftScene(rift, { genres: content.genres, words: content.riftgen, frame: 0 });
    assert.equal(opaque(img), img.width * img.height, `${key}: the whole scene is painted`);
    const shimmer = riftScene(rift, { genres: content.genres, words: content.riftgen, frame: 2 });
    assert.equal(shimmer.width, img.width);
    const warded = riftScene({ ...rift, warded: { stage: spec.stage, until: 1 } }, { genres: content.genres, words: content.riftgen });
    assert.notDeepEqual(Buffer.from(warded.data), Buffer.from(img.data), `${key}: a warded tear wears its stitch`);
  }
  assert.equal(riftFrame(null, { spec: { seed: 5 } }), 0, 'still with motion off');
});

test('place pictures exist for every point of interest, and the Hearth for each look', () => {
  for (const type of Object.keys(POI_SPRITES)) {
    const img = poiScene({ type, x: 1, y: 2 });
    assert.ok(img && img.width >= 56 && img.height >= 34, type);
    assert.equal(opaque(img), img.width * img.height);
  }
  const open = poiScene({ type: 'chest', x: 1, y: 2, mimic: true }, { opened: true });
  const shut = poiScene({ type: 'chest', x: 1, y: 2, mimic: true });
  assert.notDeepEqual(Buffer.from(open.data), Buffer.from(shut.data), 'an opened mimic looks awake');
  assert.notDeepEqual(Buffer.from(poiScene({ type: 'lantern', x: 1, y: 1 }, { lit: true }).data), Buffer.from(poiScene({ type: 'lantern', x: 1, y: 1 }).data));
  assert.equal(poiScene({ type: 'nothing', x: 1, y: 1 }), null);
  assert.equal(spriteScene('no.such.sprite'), null);
  for (const tier of [1, 2]) assert.equal(opaque(hearthScene(tier)), hearthScene(tier).width * hearthScene(tier).height);
  assert.equal(fitScale({ width: 100, height: 50 }, { w: 350, h: 400 }, 4), 3);
  assert.equal(fitScale({ width: 500, height: 50 }, { w: 350, h: 400 }, 4), 1);
});

test('the frontier map rings the ward and marks rifts, never inside the vale, never a held one', () => {
  const s = 2;
  const x0 = -30;
  const y0 = -30;
  const w = 64 + 60;
  const h = 44 + 60;
  const img = makeImage(w * s, h * s);
  const rifts = [
    { id: 'rift:a', x: -20, y: 10, stage: 'open', spec: { genres: ['neon'] } },
    { id: 'rift:b', x: 40, y: -20, stage: 'open', bright: true, spec: { genres: ['starlight'] } },
    { id: 'rift:c', x: 80, y: 10, stage: 'open', held: 'capacity-95', spec: { genres: ['neon'] } },
  ];
  frontierOverlay(img, { x0, y0, s, ward: 12, nextWard: 28, rifts, genres, heartDistance: worldgen.heartDistance });
  let inside = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const tx = Math.floor(x / s) + x0;
      const ty = Math.floor(y / s) + y0;
      if (img.data[(y * img.width + x) * 4 + 3] && inHeart(tx, ty)) inside += 1;
    }
  }
  assert.equal(inside, 0, 'nothing is drawn over the vale');
  const at = (tx, ty) => img.data[((((ty - y0) * s + 1) * img.width) + (tx - x0) * s + 1) * 4 + 3];
  assert.ok(at(-20, 10) > 0 || at(-20, 9) > 0, 'the rift is marked');
  assert.equal(at(80, 10) || 0, 0, 'a held rift is not');
  const ringPixels = opaque(img);
  assert.ok(ringPixels > 200, `the ward ring is drawn (${ringPixels} px)`);
});

test('genre chips come from the content, with a fallback for an unknown genre', () => {
  const chips = genreChips({ spec: { genres: ['neon', 'mystery'] } }, genres);
  assert.equal(chips[0].name, 'Neon');
  assert.match(chips[0].rim, /^#[0-9a-f]{6}$/i);
  assert.equal(chips[1].name, 'Mystery');
  assert.equal(genres.get('gothic').name, 'Gothic');
});

// ---------------------------------------------------------------------------
// Fixes after the Phase 3 review.

test('a rift Milo walked out to is stepped into only while it still stands', () => {
  const day = dayNumber(NOON);
  const real = { id: 'rift:r', kind: 'real' };
  const story = { id: 'rift:s', kind: 'story' };
  const wild = { id: 'rift:w', kind: 'wild' };
  const known = new Map([['rift:w', wild]]);
  // Real and story rifts stand while they're among the rifts standing now.
  assert.equal(stillStanding(real, { standing: [real, story] }), true);
  assert.equal(stillStanding(real, { standing: [story] }), false, 'sealed (or faded, or let go) on the way');
  assert.equal(stillStanding(story, { standing: [story] }), true);
  assert.equal(stillStanding({ ...real, bright: true }, { standing: [] }), false, 'a bright rift that faded');
  // A wild one while it's today's and wasn't stitched or let go today.
  assert.equal(stillStanding(wild, { known, closedWild: {}, day }), true);
  assert.equal(stillStanding(wild, { known, closedWild: { 'rift:w': day }, day }), false, 'let go on the way');
  assert.equal(stillStanding(wild, { known, closedWild: { 'rift:w': day - 1 }, day }), true, 'closed yesterday is another day');
  assert.equal(stillStanding(wild, { known: new Map(), closedWild: {}, day }), false, 'a new day’s wilds replaced it');
  assert.equal(stillStanding(null), false);
  assert.equal(stillStanding({ kind: 'real' }), false);
});

test('a damaged fortress.json or riftgen.json keeps the wilds closed instead of half-working', () => {
  assert.equal(contentProblem(content, riftgen), null, 'the real content is whole');
  const withFile = (name, value) => ({ ...content, [name]: value });
  const tryBundle = (bundle) => {
    let rg = null;
    try { rg = createRiftgen({ words: bundle.riftgen, genres: bundle.genres }); } catch { rg = null; }
    return contentProblem(bundle, rg);
  };
  // Unreadable (null), the wrong shape, or missing a tier the game needs.
  assert.equal(tryBundle(withFile('fortress', null)), 'fortress.json');
  assert.equal(tryBundle(withFile('fortress', { tiers: 'x' })), 'fortress.json');
  assert.equal(tryBundle(withFile('fortress', { tiers: [content.fortress.tiers[0]] })), 'fortress.json', 'no Stockade');
  // riftgen.json as {} makes a riftgen, but no rift can ever be made from it.
  assert.equal(tryBundle(withFile('riftgen', {})), 'riftgen.json');
  assert.equal(tryBundle(withFile('riftgen', { ...content.riftgen, genres: {} })), 'riftgen.json');
  const [first] = Object.keys(content.riftgen.genres);
  const { patternsReal, ...partial } = content.riftgen.genres[first];
  assert.ok(Array.isArray(patternsReal));
  assert.equal(tryBundle(withFile('riftgen', { ...content.riftgen, genres: { ...content.riftgen.genres, [first]: partial } })), 'riftgen.json', `a genre (${first}) missing a table`);
  assert.equal(tryBundle(withFile('genres', { genres: [] })), 'genres.json');
  assert.equal(contentProblem(null, riftgen), 'the content');
  assert.equal(contentProblem(content, null), 'riftgen.json');
  // Without a fortress to read, the Hearth has no plans for its tier (the panel says so, never
  // "as high as it goes").
  assert.equal(hearthStatus(createState(NOON), null)?.def ?? null, null);
});

test('lighting a lantern, Milo never says the line its description then shows', () => {
  const lanterns = wilds.fixedPois().filter((poi) => poi.type === 'lantern');
  assert.ok(lanterns.length >= 20, `fixed lanterns to check (${lanterns.length})`);
  // Chunk lanterns too, by id (the words depend on the id alone), with the two the review found.
  const ids = [...lanterns.map((poi) => poi.id), 'lantern:28,-14', 'lantern:28,-38'];
  for (let n = 0; n < 200; n += 1) ids.push(`lantern:${((n * 37) % 181) - 90},${((n * 53) % 173) - 86}`);
  let repeatsBefore = 0;
  for (const id of ids) {
    const poi = lanterns.find((l) => l.id === id) || { id, type: 'lantern', name: 'A sleeping lantern' };
    const lit = { wilds: { lanterns: { [id]: NOON } } };
    const shown = lanternView(poi, content.wilds, lit).lines[0];
    const says = lightingLine(poi, content.wilds);
    assert.ok(says.length > 10, id);
    assert.notEqual(says, shown, `${id}: Milo's words and the description differ`);
    assertCalm(says);
    if (pickLine(content.wilds.examine.lantern.lit, id, 'lit') === shown) repeatsBefore += 1;
  }
  assert.ok(repeatsBefore > 0, 'the old pick did repeat itself somewhere (so this test can fail)');
  assert.equal(lightingLine({ id: 'lantern:1,1' }, null), LIGHTING_LINE, 'with no words, the fixed line');
});

test('place pictures stand on their own ground: water for the quay and fishing, sage in the Hush, a bleed’s colours', () => {
  const BASE = baseTable();
  const rgb = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const grassy = (c) => ['g', 'j', 'h', 'G'].some((k) => same(c, BASE[k]));
  const watery = (c) => ['w', 'W', 'f'].some((k) => same(c, BASE[k]));
  for (const type of ['fishing', 'quay']) {
    const img = poiScene({ type, x: 22, y: -46 });
    assert.equal(opaque(img), img.width * img.height, `${type}: the whole picture is painted`);
    // The top corners and the top middle are water, not a lawn.
    for (const [x, y] of [[1, 1], [img.width - 2, 1], [Math.floor(img.width / 2), 2]]) {
      assert.ok(watery(rgb(img, x, y)), `${type}: water at ${x},${y}`);
      assert.ok(!grassy(rgb(img, x, y)), `${type}: no grass at ${x},${y}`);
    }
  }
  // A fishing spot's bank is grass at the very bottom; the quay's dock is planks.
  const fishing = poiScene({ type: 'fishing', x: 22, y: -46 });
  assert.ok(grassy(rgb(fishing, 3, fishing.height - 1)), 'a grassy bank under the fishing spot');
  const quay = poiScene({ type: 'quay', x: 22, y: -46 });
  assert.ok(['b', 'B', 'n'].some((k) => same(rgb(quay, 3, quay.height - 2), BASE[k])), 'a dock of planks under the boat');
  // In the Hush the ground is sage (the Hush's own colours), and so is what stands there...
  const HUSH = hushTable();
  const inHush = poiScene({ type: 'ruin', x: 5, y: 5 }, { hush: 255 });
  const onGrass = poiScene({ type: 'ruin', x: 5, y: 5 });
  assert.ok(['g', 'j', 'h', 'G'].some((k) => same(rgb(inHush, 0, 0), HUSH[k])), 'sage ground in the Hush');
  assert.ok(!grassy(rgb(inHush, 0, 0)));
  assert.ok(grassy(rgb(onGrass, 0, 0)), 'grass outside it');
  assert.deepEqual(Buffer.from(poiScene({ type: 'ruin', x: 5, y: 5 }, { hush: 100 }).data), Buffer.from(onGrass.data), 'a faint edge of the Hush is still grass');
  // ...except a lit lantern, the light come back, which keeps its warm colours on sage ground.
  const litHush = poiScene({ type: 'lantern', x: 5, y: 5 }, { lit: true, hush: 255 });
  const sleepingHush = poiScene({ type: 'lantern', x: 5, y: 5 }, { hush: 255 });
  const warmKeys = ['r', 'R', 'u', 'U', 'b', 'n'];
  const count = (img, table) => {
    let n = 0;
    for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) if (warmKeys.some((k) => same(rgb(img, x, y), table[k]))) n += 1;
    return n;
  };
  assert.ok(!grassy(rgb(litHush, 0, 0)), 'the lit lantern stands on sage');
  assert.ok(count(litHush, BASE) > 10, 'and keeps its warm colours');
  assert.equal(count(sleepingHush, BASE), 0, 'a sleeping lantern in the Hush is sage all over');
  // In a rift's bleed, its genre's colours.
  const spec = riftgen.realRift({ key: 'capacity:codex:9', subject: 'Codex', signals: ['crew-capacity-high'], urgency: 0.9, tier: 1, cause: 'c' });
  const rift = { id: spec.id, kind: 'real', spec, stage: spec.stage, x: 120, y: 30 };
  const genre = bleedGenreAt([rift], rift.x + 1, rift.y, { genres: content.genres });
  assert.equal(genre, spec.genres[0], 'the tile beside the tear is bled');
  assert.equal(bleedGenreAt([rift], rift.x + 40, rift.y, { genres: content.genres }), null, 'far off it isn’t');
  assert.equal(bleedGenreAt([], 1, 1), null);
  const bled = poiScene({ type: 'ruin', x: 5, y: 5 }, { genre, genres: content.genres });
  assert.ok(!grassy(rgb(bled, 0, 0)), 'bled ground is the genre’s');
  assert.notDeepEqual(Buffer.from(bled.data), Buffer.from(onGrass.data));
  // As wide as its frame asks (the shell fills the frame with it), the same ground all the way.
  for (const type of ['ruin', 'quay', 'fishing', 'lantern']) {
    const wide = poiScene({ type, x: 5, y: 5 }, { w: 118 });
    assert.equal(wide.width, 118, type);
    assert.equal(opaque(wide), wide.width * wide.height, `${type}: painted edge to edge`);
    const edge = rgb(wide, wide.width - 1, 1);
    assert.ok(type === 'quay' || type === 'fishing' ? watery(edge) : grassy(edge), `${type}: its own ground at the far edge`);
  }
  assert.equal(poiScene({ type: 'ruin', x: 5, y: 5 }, { w: 10 }).width, poiScene({ type: 'ruin', x: 5, y: 5 }).width, 'never narrower than it was');
});
// ---------------------------------------------------------------------------
// Phase 4's hooks in the shell's helpers (CONTRACT-PHASE4.md §12.4 "L", module L1): the fight-ready
// Elsewhere's landmarks, combatants first in a fight, Challenge for a field boss, the doors' prices
// and the suggested level on the rift panel, and the cave's door.

const { loadRules } = await import('../src/combat/rules.js');
const { prepareElsewhere, prepareCave } = await import('../src/combat/encounters.js');
const { caveSpec, caveLayout } = await import('../src/world/caves.js');
const { leadDisplayName } = await import('../src/world/leadname.js');
const combat = { rules: read('combat/rules'), leads: read('combat/leads'), foes: read('combat/foes'), tuning: read('combat/tuning') };
const loadedRules = loadRules(combat.rules, combat.tuning);
const hooks = (combat.leads.hooks || []).map((h) => h.name);

test('a fight-ready Elsewhere lists its nook and its Tale-lead as the scene shows them, and a cave its chests without a seam', () => {
  assert.deepEqual(LANDMARK_ORDER, ['stitch', 'tale-lead', 'loot', 'curio', 'nook', 'exit']);
  let nooks = 0;
  const specs = [];
  for (let cy = -5; cy <= 5 && specs.length < 8; cy += 1) {
    for (let cx = -5; cx <= 5 && specs.length < 8; cx += 1) {
      for (const rift of wildRiftsForChunk({ worldgen, riftgen, cx, cy, day: dayNumber(NOON), wardRadius: 0, isFree })) if (rift.spec.stage !== 'hairline') specs.push(rift.spec);
    }
  }
  for (const spec of specs) {
    const ready = prepareElsewhere(spec, { riftgen, genres: content.genres, words: content.riftgen, kind: 'wild', roadLevel: 1, partySize: 4, rules: loadedRules, leads: combat.leads, foes: combat.foes, tuning: combat.tuning, hooks });
    const marks = elsewhereLandmarks(spec, ready.layout, { plan: ready.plan, encounters: ready.encounters, words: content.riftgen, hooks });
    const scene = buildElsewhere(spec, ready.layout, { genres: content.genres, kind: 'wild', words: content.riftgen, hooks, fight: { plan: ready.plan, encounters: ready.encounters } });
    const clickable = new Map(scene.objects.filter((o) => !o.scenery && o.kind !== 'foliage').map((o) => [o.id, o]));
    assert.deepEqual(new Set(marks.map((m) => m.id)), new Set(clickable.keys()), `every object is listed (${spec.name})`);
    for (const mark of marks) {
      assert.equal(mark.kind, clickable.get(mark.id).kind);
      assert.deepEqual([mark.x, mark.y], [clickable.get(mark.id).x, clickable.get(mark.id).y]);
      assertCalm(mark.label);
    }
    const lead = marks.find((m) => m.id === 'tale-lead');
    if (lead) assert.equal(lead.label, leadDisplayName(spec, content.riftgen, { hooks }), 'the lead’s shown name');
    if (lead) assert.equal(lead.label, clickable.get('tale-lead').label);
    const nook = marks.find((m) => m.kind === 'nook');
    if (nook) {
      nooks += 1;
      assert.equal(nook.label, 'Hearth-nook · rest here');
      assert.equal(marks.at(-1).id, 'exit', 'the way home still last');
    }
    const ranks = marks.map((m) => LANDMARK_ORDER.indexOf(m.kind));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'in the landmark order');
    assert.deepEqual(new Set(engineLandmarks([...clickable.values()]).map((m) => m.id)), new Set(marks.map((m) => m.id)), 'the engine’s list holds the same');
  }
  assert.ok(nooks > 0, 'some Elsewhere has a nook');

  const pois = [];
  for (let cy = -4; cy <= 4 && pois.length < 2; cy += 1) for (let cx = -4; cx <= 4 && pois.length < 2; cx += 1) for (const p of worldgen.chunk(cx, cy).pois) if (p.type === 'cave') pois.push(p);
  const cave = caveSpec(pois[0], { worldgen, wilds, foes: combat.foes, day: dayNumber(NOON) });
  const ready = prepareCave(cave, { layout: caveLayout(cave, riftgen), roadLevel: 1, partySize: 4, rules: loadedRules, foes: combat.foes, words: content.riftgen, day: cave.day, genres: content.genres });
  const marks = elsewhereLandmarks(cave, ready.layout, { plan: ready.plan, encounters: ready.encounters });
  const scene = buildElsewhere(cave, ready.layout, { genres: content.genres, kind: 'cave', words: content.riftgen, fight: { plan: ready.plan, encounters: ready.encounters } });
  const clickable = scene.objects.filter((o) => !o.scenery && o.kind !== 'foliage');
  assert.deepEqual(new Set(marks.map((m) => m.id)), new Set(clickable.map((o) => o.id)), 'a cave’s chests, the added ones too');
  assert.ok(!marks.some((m) => m.kind === 'stitch' || m.kind === 'tale-lead'), 'a cave has no seam and no Tale-lead');
  const locked = ready.encounters.chests.find((c) => c.locked);
  assert.equal(marks.find((m) => m.id === locked.id).label, 'A locked chest');
  assert.equal(elsewhereLandmarks(cave, ready.layout, { plan: ready.plan, encounters: ready.encounters, chests: { [locked.id]: NOON } }).find((m) => m.id === locked.id).label, 'An open chest');
});

test('in a fight the place list puts the combatants first; Challenge is offered for a field boss only', () => {
  const marks = [{ id: 'stitch', kind: 'stitch', x: 20, y: 5, label: 'The seam · stitch it' }, { id: 'exit', kind: 'exit', x: 2, y: 9, label: 'The way home' }];
  const inView = [
    { id: 'stray:rift:a:0', kind: 'stray', x: 3, y: 8, label: 'Near stray' },
    { id: 'cb:f0', kind: 'combatant', x: 9, y: 9, label: 'Glitch drone, 6 of 16 Integrity' },
    { id: 'cb:milo', kind: 'combatant', x: 4, y: 9, label: 'Milo, 18 of 18 Integrity' },
  ];
  assert.deepEqual(elsewhereEntries(marks, inView, { x: 2, y: 8 }).map((e) => e.id), ['cb:f0', 'cb:milo', 'stitch', 'exit', 'stray:rift:a:0']);
  assert.deepEqual(riftActions({ kind: 'wild' }, { field: true }), ['step', 'challenge', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'wild' }, { field: true, challenged: true }), ['step', 'let-go'], 'once a day');
  assert.deepEqual(riftActions({ kind: 'wild' }, { field: true, away: true }), ['leave', 'let-go']);
  assert.deepEqual(riftActions({ kind: 'wild' }, { field: true, inside: true }), ['stitch', 'leave']);
  assert.deepEqual(riftActions({ kind: 'real' }, { field: true }), ['step', 'ward', 'let-go'], 'only wild rifts have field bosses');
  assert.equal(actionWord('challenge'), 'Challenge');
  assert.equal(actionWord('enter-cave'), 'Go in');
});

test('the rift panel prices its doors and says the suggested level; the War Table’s rows too; the cave’s door goes in for its Embers', () => {
  assert.equal(costWord('step', 5), 'Step through · 5 Embers');
  assert.equal(costWord('challenge', 1), 'Challenge · 1 Ember');
  assert.equal(costWord('step', 0), 'Step through');
  const view = {
    id: 'rift:abc', kind: 'wild', name: 'The Haunted <b>Choir</b>', genres: [], stage: 'Gaping', stageId: 'gaping', cause: 'c', actions: ['step', 'challenge', 'let-go'],
    costs: { step: 6, challenge: 5 }, level: 'Runs at level 5. Your company is level 3 (4 on average, with the Scribe).',
  };
  const html = riftPanel(view);
  assert.match(html, /data-action="rift-step"[^>]*>Step through · 6 Embers</);
  assert.match(html, /data-action="rift-challenge"[^>]*>Challenge · 5 Embers</);
  assert.match(html, /data-action="rift-let-go"[^>]*>Let go</);
  assert.match(html, /<p class="rift-where rift-level">Runs at level 5\. Your company is level 3 \(4 on average, with the Scribe\)\.<\/p>/);
  assert.doesNotMatch(html, /<b>/, 'escaped');
  assertCalm(html);
  assert.doesNotMatch(riftPanel({ ...view, costs: undefined, level: undefined }), /Embers|rift-level/, 'without them the panel is Phase 3’s');
  const row = riftRow({ id: 'rift:abc', kind: 'real', name: 'X', genres: [], stage: 'Open', stageId: 'open', level: 'Runs at level 2. Your company is level 2.' });
  assert.match(row, /<p class="rift-meta rift-level">Runs at level 2\. Your company is level 2\.<\/p>/);
  const poi = { id: 'poi:cave:86,-115', type: 'cave', x: 86, y: -115, name: 'A cave mouth', depth: 3 };
  const cave = poiPanel({ id: poi.id, type: 'cave', ...poiView(poi, content.wilds, createState(NOON), { phase4World: true, economy: read('economy') }) });
  assert.match(cave, /data-action="poi-enter-cave"[^>]*>Go in · 3 Embers</);
  assert.doesNotMatch(poiPanel({ id: poi.id, type: 'cave', ...poiView(poi, content.wilds, createState(NOON), {}) }), /poi-enter-cave/, 'only with the Phase 4 world');
  // Phase 3's loop returns nothing of Phase 4's without its passes.
  const plain = loop(freshState(), snapshotWith({ capacity: reading(91) }));
  assert.deepEqual([plain.paid, plain.drops, plain.stitches], [[], [], 0]);
});
