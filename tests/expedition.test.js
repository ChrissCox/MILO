// Module L1's doors and the expedition's life (src/ui/expedition.js; CONTRACT-PHASE4.md §12.4 "L",
// §4.18, §4.20, §8.3, §13 wave 3 L1's proofs, §18.2 items 3 and 9): an expedition's life, a resume
// rebuilt from its source, the five field skills and a Mimic's chest, caves keeping their day, wild
// rifts rebuilt from their spawn, and real and wild stitches paying once.
//   node --test tests/expedition.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertCalm } from './calm.js';
import { createState, normalizeState } from '../src/model.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { wildRiftsForChunk, dayNumber } from '../src/rifts.js';
import { runRiftLoop, phase4Passes } from '../src/ui/frontier.js';
import * as state4 from '../src/state4.js';
import * as embers from '../src/embers.js';
import * as lifeskills from '../src/lifeskills.js';
import * as party from '../src/party.js';
import { saveBattle } from '../src/combat/battle.js';
import {
  createExpedition, door, sourceFor, spawnInputs, rebuildPlace, placeKind, placeClosed, clearClosed, beginExpedition, leaveExpedition,
  settleRoom, fieldSkill, openChest, preparePlace, fightFor, combatOf, suggestedLevel, payWildStitch, hiddenFor, samePlace,
} from '../src/ui/expedition.js';
import { createFight } from '../src/ui/fight.js';
import { caveSpec, caveFromSource } from '../src/world/caves.js';
import { isFieldBoss } from '../src/world/fieldboss.js';

const require = createRequire(import.meta.url);
const { loadContent } = require('../electron/content.cjs');
const content = await loadContent();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A Wednesday afternoon, far from the evening bell.
const NOW = new Date(2026, 8, 30, 13, 0, 0).getTime();
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: content.riftgen.regionWords });
const riftgen = createRiftgen({ words: content.riftgen, genres: content.genres });
const wilds = createWilds({ worldgen, maxChunks: 64 });
const isFree = (x, y) => worldgen.walkable(x, y) && !wilds.blocked(x, y);
const { rules } = combatOf(content);

/** Today's wild rifts near the vale, the gaping and open ones first. */
function wildRifts(now = NOW, n = 6) {
  const out = [];
  for (let cy = -6; cy <= 6 && out.length < n; cy += 1) {
    for (let cx = -6; cx <= 6 && out.length < n; cx += 1) {
      for (const r of wildRiftsForChunk({ worldgen, riftgen, cx, cy, day: dayNumber(now) })) if (r.spec.stage !== 'hairline' && out.length < n) out.push(r);
    }
  }
  return out;
}
const [WILD, OTHER] = wildRifts();

function freshState({ balance = 40, now = NOW } = {}) {
  const s = createState(now);
  return { ...s, lastSeenAt: now - HOUR, firstSeenAt: now - 10 * DAY, embers: { ...s.embers, balance, through: s.embers.through ?? { sessionsFinished: 0, answered: 0, stitchedReal: 0, buildingsDesigned: 0 } } };
}

/** A shell for the doors and the fight, in Node: the state, a manual clock, a world that records its calls. */
function fakeShell(state0, { now = NOW, refuse = null } = {}) {
  let state = state0;
  const listeners = {};
  const calls = [];
  const logs = [];
  const bubbles = [];
  const files = new Map();
  const clock = { now };
  let last = null;
  const shell = {
    get state() { return state; },
    set(next) { if (next === state) return false; state = next; for (const f of listeners.state || []) f(); return true; },
    now: () => clock.now,
    content: () => content,
    snapshot: () => null,
    world(name, ...args) {
      calls.push([name, ...args]);
      if (refuse && refuse === name) return Promise.resolve(false);
      if (['playEvents', 'enterElsewhere', 'enterCave', 'startCombat', 'endCombat'].includes(name)) return Promise.resolve(true);
      return undefined;
    },
    bubble(m) { bubbles.push(m); },
    log(e) { logs.push(e.text); },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; },
    emit(ev, payload) { if (ev === 'combat') last = payload; for (const f of listeners[ev] || []) f(payload); },
    feature() {},
    leaveElsewhere: () => Promise.resolve(true),
    travel: () => Promise.resolve(true),
    openPanel() {},
    bridge: { notebooks: {
      read: async (id) => ({ ok: true, bytes: files.get(id) || new Uint8Array(0) }),
      append: async (id, bytes, at) => {
        const old = files.get(id) || new Uint8Array(0);
        if (old.length < at) return { ok: false, code: 'moved', size: old.length };
        const next = new Uint8Array(at + bytes.length);
        next.set(old.subarray(0, at));
        next.set(bytes, at);
        files.set(id, next);
        return { ok: true, size: next.length };
      },
    } },
  };
  return { shell, calls, logs, bubbles, files, clock, last: () => last, setState: (s) => { state = s; } };
}

/** Plays the live fight to its card: Run each round (drafts and personality), Asks answered yes. */
async function playOut(kit, fight, { rounds = 30 } = {}) {
  for (let i = 0; i < rounds * 4 && fight.live() && !kit.last()?.end; i += 1) {
    const b = fight.battle();
    await kit.last().command(b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'run' });
    await fight.idle();
  }
  return kit.last();
}

const strayRoom = (scene) => scene.encounters.rooms.find((r) => r.roomId !== 'lead' && r.fight.foes.some((u) => u.side === 'foe'));

// ---------------------------------------------------------------------------

test('a door spends after the still-standing check, refuses calmly when short, and gives the Embers back when the world refuses', async () => {
  const short = fakeShell(freshState({ balance: 3 }));
  const fight = createFight(short.shell);
  const doors = createExpedition(short.shell, { fight, riftgen, worldgen });
  const r = await doors.stepThrough(WILD);
  const cost = embers.entryCost('wild', { depth: WILD.spec.depth, economy: content.economy });
  assert.equal(r.ok, false);
  assert.equal(r.words, `That needs ${cost} Embers. You have 3.`);
  assertCalm(r.words, 'the short wallet', { proper: ['Embers'] });
  assert.equal(short.shell.state.embers.balance, 3, 'nothing spent');
  assert.equal(short.shell.state.expedition, null, 'no expedition');
  assert.ok(!short.calls.some(([name]) => name === 'enterElsewhere'), 'never entered');

  const gone = fakeShell(freshState());
  const doors2 = createExpedition(gone.shell, { fight: createFight(gone.shell), riftgen, worldgen });
  const closed = await doors2.stepThrough(WILD, { standing: () => false });
  assert.equal(closed.ok, false);
  assert.equal(gone.shell.state.embers.balance, 40, 'a rift that closed while Milo walked costs nothing');

  const refused = fakeShell(freshState(), { refuse: 'enterElsewhere' });
  const doors3 = createExpedition(refused.shell, { fight: createFight(refused.shell), riftgen, worldgen });
  const no = await doors3.stepThrough(WILD);
  assert.equal(no.ok, false);
  assertCalm(no.words, 'the refused tear');
  assert.equal(refused.shell.state.embers.balance, 40, 'the Embers come back when the tear won’t open');
  assert.equal(refused.shell.state.expedition, null);

  // The story's crack costs nothing (§4.20); a real rift 5; a field boss 5; a cave 3.
  for (const [kind, n] of [['story', 0], ['real', 5], ['field', 5], ['cave', 3]]) {
    const d = door(freshState({ balance: 10 }), { kind, riftId: 'rift:abc', key: kind === 'story' ? 'story:first-crack' : 'knock:x', since: NOW, source: { poi: 'poi:cave:1,2', day: 1 }, depth: 1, tier: 1 }, NOW, { economy: content.economy });
    assert.equal(d.ok, true, kind);
    assert.equal(d.cost, n, `${kind} costs ${n}`);
    assert.equal(d.state.embers.balance, 10 - n);
  }
});

test('an expedition’s life: settle a room, Head home, step back in paying again with the room still settled; the place closes and it clears; another place replaces it', async () => {
  const kit = fakeShell(freshState({ balance: 40 }));
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen });
  const cost = embers.entryCost('wild', { depth: WILD.spec.depth, economy: content.economy });
  const first = await doors.stepThrough(WILD);
  assert.equal(first.ok, true);
  assert.equal(kit.shell.state.embers.balance, 40 - cost);
  const e0 = kit.shell.state.expedition;
  assert.equal(e0.kind, 'wild');
  assert.equal(e0.riftId, WILD.id);
  assert.equal(e0.inside, true);
  assert.equal(e0.embersPaid, cost);
  assert.ok(kit.calls.some(([name, rift, opts]) => name === 'enterElsewhere' && rift.id === WILD.id && opts.fight.plan && opts.fight.encounters), 'entered fight-ready');

  // Settle a room.
  const room = strayRoom(doors.scene());
  assert.equal((await doors.engage(room.roomId)).started, true);
  const card = await playOut(kit, fight);
  assert.ok(['won', 'talked', 'bowed'].includes(card.battle.result.outcome), `the room is settled (${card.battle.result.outcome})`);
  await card.command({ t: 'card', action: 'continue' });
  assert.equal(kit.shell.state.expedition.rooms[room.roomId], card.battle.result.outcome);
  assert.equal(kit.shell.state.expedition.battle, null);
  assert.ok(kit.calls.at(-1)[0] === 'hideActors' && kit.calls.at(-1)[1].includes(`enc:${room.roomId}`), 'a settled room’s strays stay hidden');

  // Head home from the next fight: it pays nothing and the party is out.
  const next = doors.scene().encounters.rooms.find((r) => r.roomId !== room.roomId && r.roomId !== 'lead' && r.fight.foes.length);
  assert.equal((await doors.engage(next.roomId)).started, true);
  await kit.last().command({ t: 'head-home' });
  await fight.idle();
  assert.equal(kit.last().battle.result.outcome, 'home');
  await kit.last().command({ t: 'card', action: 'continue' });
  const out = kit.shell.state.expedition;
  assert.equal(out.inside, false, 'Head home leaves the place');
  assert.equal(out.rooms[room.roomId], card.battle.result.outcome, 'and remembers what was settled');
  assert.equal(out.rooms[next.roomId], undefined, 'a room left by Head home isn’t settled');

  // Step back in: the entry is paid again, and the settled room stays settled (no fight there).
  const balance = kit.shell.state.embers.balance;
  assert.equal((await doors.stepThrough(WILD)).ok, true);
  assert.equal(kit.shell.state.embers.balance, balance - cost, 'leaving by choice and going back costs the entry again');
  assert.equal(kit.shell.state.expedition.runId, e0.runId, 'the same expedition');
  assert.equal(kit.shell.state.expedition.embersPaid, 2 * cost);
  assert.equal(kit.shell.state.expedition.rooms[room.roomId], card.battle.result.outcome);
  assert.equal((await doors.engage(room.roomId)).started, false, 'a settled room never fights again');
  assert.ok(hiddenFor(kit.shell.state.expedition).includes(`enc:${room.roomId}`));

  // Entering another place replaces it.
  const before = kit.shell.state;
  await kit.shell.world('leaveElsewhere');
  kit.setState(leaveExpedition(before));
  assert.equal((await doors.stepThrough(OTHER)).ok, true);
  assert.equal(kit.shell.state.expedition.riftId, OTHER.id);
  assert.deepEqual(kit.shell.state.expedition.rooms, {}, 'the other place’s settled rooms are forgotten');

  // The place closes (a wild rift's id rolls over with the day): the frontier's pass clears it once the party's out.
  const outside = leaveExpedition(kit.shell.state);
  assert.equal(clearClosed(outside, { now: NOW + HOUR }), outside, 'still today: kept');
  assert.equal(clearClosed(outside, { now: NOW + DAY }).expedition, null, 'tomorrow: gone');
  const inside = kit.shell.state;
  assert.equal(clearClosed(inside, { now: NOW + DAY }), inside, 'inside at midnight: kept until the party’s out');
  const fighting = { ...outside, expedition: { ...outside.expedition, battle: { v: 2, id: 'fight:x' } } };
  assert.equal(clearClosed(fighting, { now: NOW + DAY }).expedition.closing, true, 'a saved fight marks it closing instead');
});

test('the frontier’s loop runs the Phase 4 passes and clears an expedition whose real rift’s episode ended', () => {
  const passes = phase4Passes({ state4, embers, lifeskills, party, expedition: { clearClosed } }, { problem: { groundwork: null, combat: null, party: null, world: null }, content, rules });
  for (const fn of ['tallyAnswered', 'payFromSignals', 'payLifeFromSignals', 'topUpCrewGifts', 'payRealStitches', 'clearClosed']) assert.equal(typeof passes[fn], 'function', fn);
  assert.equal(phase4Passes({ state4, embers }, { problem: { groundwork: 'economy.json', combat: null, party: null } }), null, 'a broken area leaves its passes out');
  const groundOnly = phase4Passes({ state4, embers, lifeskills, party, expedition: { clearClosed } }, { problem: { combat: 'rules.json' }, content, rules });
  assert.equal(groundOnly.payRealStitches, undefined);
  assert.equal(groundOnly.clearClosed, undefined);
  assert.equal(typeof groundOnly.payFromSignals, 'function');

  const opened = runRiftLoop({ state: freshState(), snapshot: capacitySnapshot(91, NOW), now: NOW, content, riftgen, worldgen, isFree, phase4: passes });
  const rift = opened.rifts.find((r) => r.realKind === 'capacity');
  assert.ok(rift);
  const entry = { kind: 'real', riftId: rift.id, key: rift.key, since: rift.since, source: sourceFor('real', rift, { riftgen }), depth: 1, tier: 1 };
  const inside = door(opened.state, entry, NOW, { economy: content.economy }).state;
  const away = leaveExpedition(inside);
  // A watcher hiccup is no look at the crew: the episode isn't judged.
  const blind = runRiftLoop({ state: away, snapshot: { scannedAt: NOW + 60_000, sessions: [], tools: [], sources: { claude: { ok: false }, codex: { ok: false } }, capacity: {} }, now: NOW + 60_000, content, riftgen, worldgen, isFree, phase4: passes });
  assert.ok(blind.state.expedition, 'a hiccup keeps it');
  const sealed = runRiftLoop({ state: away, snapshot: capacitySnapshot(20, NOW + 120_000), now: NOW + 120_000, content, riftgen, worldgen, isFree, phase4: passes });
  assert.equal(sealed.sealed.length, 1);
  assert.equal(sealed.state.expedition, null, 'the seal ends the episode, and the expedition goes');
  // Without phase4 it's Phase 3's loop: nothing of Phase 4 runs.
  const plain = runRiftLoop({ state: away, snapshot: capacitySnapshot(20, NOW + 120_000), now: NOW + 120_000, content, riftgen, worldgen, isFree });
  assert.ok(plain.state.expedition, 'Phase 3’s loop leaves the expedition alone');
  assert.deepEqual([plain.paid, plain.drops, plain.stitches], [[], [], 0]);
});

function capacitySnapshot(pct, at) {
  const ok = { ok: true, path: '', count: 1, live: true };
  return { scannedAt: at, sessions: [], tools: [], sources: { claude: ok, codex: ok }, capacity: { codex: { usedPercent: pct, resetsAt: at + 3 * DAY, windowMinutes: 10080, at: at - 60_000 } } };
}

test('a resume rebuilds the place from expedition.source, even after the live signal’s urgency moved, and lands on the saved tick', async () => {
  const loop = (state, pct, at) => runRiftLoop({ state, snapshot: capacitySnapshot(pct, at), now: at, content, riftgen, worldgen, isFree });
  const opened = loop(freshState(), 86, NOW);
  const rift = opened.rifts.find((r) => r.realKind === 'capacity');
  assert.equal(rift.spec.stage, 'open');
  const kit = fakeShell({ ...opened.state, embers: { ...opened.state.embers, balance: 40 } });
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen });
  assert.equal((await doors.stepThrough(rift)).ok, true);
  const source = kit.shell.state.expedition.source;
  assert.equal(source.key, rift.key);
  assert.equal(source.urgency, rift.urgency);
  const room = strayRoom(doors.scene());
  await doors.engage(room.roomId);
  await kit.last().command({ t: 'run' });
  await fight.idle();
  // Stop mid-round: the save carries the tick.
  let guard = 0;
  while (fight.battle().status === 'planning' && guard++ < 5) { await kit.last().command({ t: 'run' }); await fight.idle(); }
  const live = fight.battle();
  const saved = kit.shell.state.expedition.battle;
  assert.deepEqual(saved, JSON.parse(JSON.stringify(saveBattle(live))));

  // The crew's reading climbs: the live rift gapes now, so the live signal would build another place.
  const later = loop(kit.shell.state, 99, NOW + 10 * 60_000);
  const moved = later.rifts.find((r) => r.realKind === 'capacity');
  assert.equal(moved.id, rift.id);
  assert.equal(moved.spec.stage, 'gaping', 'the live signal moved the stage');
  assert.notDeepEqual(riftgen.layout(moved.spec), riftgen.layout(rift.spec), 'a rebuild from the live signal would differ');

  // Relaunch: the save through JSON and normalizeState, a fresh shell, the place from the source.
  const relaunched = normalizeState(JSON.parse(JSON.stringify(later.state)), NOW + 11 * 60_000);
  const kit2 = fakeShell(relaunched, { now: NOW + 11 * 60_000 });
  const fight2 = createFight(kit2.shell);
  const doors2 = createExpedition(kit2.shell, { fight: fight2, riftgen, worldgen });
  const back = await doors2.resume();
  assert.equal(back.resumed, true);
  const entered = kit2.calls.find(([name]) => name === 'enterElsewhere');
  assert.deepEqual(entered[1].spec, rift.spec, 'the Elsewhere is the one entered, from the source');
  assert.deepEqual(doors2.scene().layout, doors.scene().layout);
  const restored = fight2.battle();
  assert.equal(restored.round, live.round);
  assert.equal(restored.tick, live.tick, 'it lands on the same tick');
  assert.deepEqual(JSON.parse(JSON.stringify(saveBattle(restored))), saved, 'and is the saved battle');
  assert.ok(kit2.calls.some(([name]) => name === 'syncCombat'), 'the board is synced to it');
});

test('caves keep the day they were entered on (§18.2 item 3), are rebuilt with it, and close when the day rolls', async () => {
  const pois = [];
  for (let cy = -4; cy <= 4 && pois.length < 4; cy += 1) for (let cx = -4; cx <= 4 && pois.length < 4; cx += 1) for (const p of worldgen.chunk(cx, cy).pois) if (p.type === 'cave') pois.push(p);
  const poi = pois[0];
  const kit = fakeShell(freshState({ balance: 10, now: NOW + 10 * HOUR + 50 * 60_000 }), { now: NOW + 10 * HOUR + 50 * 60_000 });
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen, wilds });
  const r = await doors.enterCave(poi);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 3);
  assert.equal(kit.shell.state.embers.balance, 7);
  const day = dayNumber(kit.clock.now);
  const e = kit.shell.state.expedition;
  assert.equal(e.kind, 'cave');
  assert.equal(e.riftId, `cave:${poi.x},${poi.y}`);
  assert.deepEqual(e.source, { poi: `poi:cave:${poi.x},${poi.y}`, day });
  assert.ok(kit.calls.some(([name, cave]) => name === 'enterCave' && cave.day === day));
  const ids = doors.scene().encounters.rooms.map((room) => room.fight.id);
  assert.ok(ids.every((fid) => fid.startsWith(`fight:cave:${poi.x},${poi.y}:${day}:`)), 'fight ids carry the entry day');

  // After midnight the same source rebuilds the same cave, day and all.
  const after = normalizeState(JSON.parse(JSON.stringify(kit.shell.state)), kit.clock.now + 2 * HOUR);
  assert.deepEqual(after.expedition.source, e.source, 'the cleaner keeps the day');
  const rebuilt = rebuildPlace(after.expedition, { riftgen, worldgen, wilds, content });
  assert.equal(rebuilt.cave.day, day);
  const ready = preparePlace('cave', rebuilt, { content, riftgen, worldgen, wilds, level: e.roadLevel, size: e.partySize });
  assert.deepEqual(ready.encounters.rooms.map((room) => room.fight.id), ids);
  assert.deepEqual(caveFromSource(e.source, { worldgen, wilds, words: content.riftgen, foes: content.combat.foes }), rebuilt.cave);
  // The day rolls: the cave's rooms reset, so the place has closed.
  assert.equal(placeClosed(e, { now: kit.clock.now }), false);
  assert.equal(placeClosed(e, { now: kit.clock.now + 2 * HOUR }), true);
  assert.equal(clearClosed(leaveExpedition(kit.shell.state), { now: kit.clock.now + 2 * HOUR }).expedition, null);
});

test('wild rifts rebuild from the spawn’s inputs, weights and all (§18.2 item 9)', () => {
  let differs = 0;
  const rifts = wildRifts(NOW, 12);
  for (const rift of rifts) {
    const inputs = spawnInputs(rift, { worldgen, riftgen });
    assert.ok(inputs, `${rift.id} has its spawn`);
    assert.equal(inputs.seed, rift.spec.seed);
    assert.ok(Object.keys(inputs.weights).length > 0, 'the spawn’s weights are kept');
    const source = sourceFor('wild', rift, { worldgen, riftgen });
    const expedition = beginExpedition(freshState(), { kind: 'wild', riftId: rift.id, since: rift.since, source, depth: rift.spec.depth, tier: rift.spec.tier }, NOW).expedition;
    // Through JSON and A's cleaner, as a relaunch has it.
    const kept = normalizeState(JSON.parse(JSON.stringify({ ...freshState(), expedition })), NOW + HOUR).expedition;
    assert.deepEqual(kept.source.weights, inputs.weights);
    const again = rebuildPlace(kept, { riftgen });
    assert.deepEqual(again.rift.spec, rift.spec, `${rift.id} rebuilds exactly`);
    const bare = riftgen.wildRift({ seed: rift.spec.seed, tier: rift.spec.tier, depth: rift.spec.depth, weights: {} });
    if (JSON.stringify(bare) !== JSON.stringify(rift.spec)) differs += 1;
  }
  assert.ok(differs > 0, `without the spawn's weights a rebuild differs (${differs} of ${rifts.length})`);
  // A rung is the base's inputs and its count of deeper steps.
  const base = sourceFor('wild', rifts[0], { worldgen, riftgen });
  const deeper = riftgen.deeper(riftgen.deeper(rifts[0].spec));
  const rung = sourceFor('rung', { ...rifts[0], spec: deeper }, { base: { ...base, rungs: 1 } });
  assert.equal(rung.rungs, 2);
  assert.deepEqual(rebuildPlace({ kind: 'rung', riftId: deeper.id, source: rung }, { riftgen }).rift.spec, deeper);
  assert.equal(placeKind({ ...rifts[0], parent: rifts[0].id }), 'rung');
});

test('a field boss starts only by Challenge (5 Embers), never by sight, and its source keeps where it stood', async () => {
  let rift = null;
  for (let cy = -8; cy <= -1 && !rift; cy += 1) {
    for (let cx = -9; cx <= -1 && !rift; cx += 1) {
      rift = wildRiftsForChunk({ worldgen, riftgen, cx, cy, day: dayNumber(NOW) }).find((r) => isFieldBoss(r, { leads: content.combat.leads, rules: content.combat.rules })) || null;
    }
  }
  assert.ok(rift, 'a field boss today');
  const kit = fakeShell(freshState({ balance: 9 }));
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen, wilds });
  // Walking about in the wilds never starts it.
  assert.equal(doors.onStep({ x: rift.x, y: rift.y + 1, scene: 'world', who: 'milo' }), null);
  assert.equal(fight.live(), false);
  const r = await doors.challenge(rift);
  assert.equal(r.ok, true);
  assert.equal(r.started, true);
  assert.equal(kit.shell.state.embers.balance, 4);
  const e = kit.shell.state.expedition;
  assert.equal(e.kind, 'field');
  assert.equal(e.source.x, rift.x);
  assert.equal(e.source.y, rift.y);
  assert.ok(Object.keys(e.source.weights).length);
  assert.equal(fight.battle().kind, 'field');
  const hid = kit.calls.filter(([name]) => name === 'hideActors').at(-1)[1];
  assert.ok(hid.includes(`stray:${rift.id}:lead`), 'the roaming lead is hidden for its fight');
  assert.ok(!kit.calls.some(([name]) => name === 'enterElsewhere'), 'no scene change');
  // Not a field boss: refused calmly, nothing spent.
  const plain = await createExpedition(fakeShell(freshState()).shell, { riftgen, worldgen, wilds }).challenge(WILD);
  assert.equal(plain.ok, false);
  assertCalm(plain.words, 'a challenge refused', { proper: ['Challenge'] });
});

test('the five field skills, each refused calmly without its companion, and a Mimic’s chest starting its fight', async () => {
  const words = [];
  const say = (r) => { words.push(r.words); return r; };
  const base = freshState();
  const noone = { ...base, party: { ...base.party, chosen: [] } };
  // Light (Milo): a lantern.
  const lit = say(fieldSkill(base, 'light', { kind: 'lantern', id: 'lantern:12,-18' }, NOW, { content }));
  assert.equal(lit.state.wilds.lanterns['lantern:12,-18'], NOW);
  assert.equal(say(fieldSkill(lit.state, 'light', { kind: 'lantern', id: 'lantern:12,-18' }, NOW, { content })).state, lit.state, 'once');
  // Read (the Scribe): a ruin's and a statue's read line.
  const ruin = say(fieldSkill(base, 'read', { kind: 'poi', id: 'poi:ruin:4,5', poiType: 'ruin' }, NOW, { content }));
  assert.ok(content.examine.groups.things.ruin.read.includes(ruin.words));
  const statue = say(fieldSkill(base, 'read', { kind: 'poi', id: 'poi:statue:4,5', poiType: 'statue' }, NOW, { content }));
  assert.ok(content.examine.groups.things.statue.read.includes(statue.words));
  const noScribe = say(fieldSkill(noone, 'read', { kind: 'poi', id: 'poi:ruin:4,5', poiType: 'ruin' }, NOW, { content }));
  assert.equal(noScribe.words, 'That needs the Scribe, who’s at camp just now.');
  assert.equal(noScribe.state, noone);

  // A cave for Pick and Sort: its locked chest and its Mimic.
  const pois = [];
  for (let cy = -4; cy <= 4 && pois.length < 3; cy += 1) for (let cx = -4; cx <= 4 && pois.length < 3; cx += 1) for (const p of worldgen.chunk(cx, cy).pois) if (p.type === 'cave') pois.push(p);
  const cave = caveSpec(pois[0], { worldgen, wilds, foes: content.combat.foes, day: dayNumber(NOW) });
  const scene = preparePlace('cave', { cave }, { content, riftgen, worldgen, wilds, level: 1, size: 4 });
  const inCave = door(base, { kind: 'cave', riftId: cave.id, since: NOW, source: { poi: `poi:cave:${cave.x},${cave.y}`, day: cave.day }, depth: 1, tier: 1 }, NOW, { economy: content.economy }).state;
  const chests = scene.encounters.chests;
  const locked = { kind: 'loot', ...chests.find((c) => c.locked) };
  const mimic = { kind: 'loot', ...chests.find((c) => c.mimic) };
  const plainChest = scene.encounters.chests.find((c) => !c.locked && !c.mimic);
  assert.equal(say(openChest(inCave, locked, NOW, { content })).words, 'It’s locked. The Artificer could pick it.');
  const picked = say(fieldSkill(inCave, 'pick', locked, NOW, { content, scene }));
  assert.ok(picked.state.expedition.chests[locked.id], 'picked open, and remembered');
  assert.match(picked.words, /^The Artificer works the lock open\. /);
  assert.notEqual(picked.state.satchel, inCave.satchel, 'its loot is in the satchel');
  assert.equal(say(fieldSkill(picked.state, 'pick', locked, NOW, { content, scene })).state, picked.state, 'once');
  assert.equal(say(fieldSkill({ ...inCave, party: { ...inCave.party, chosen: ['claude', 'jev'] } }, 'pick', locked, NOW, { content, scene })).words, 'That needs the Artificer, who’s at camp just now.');
  // Sort (Jev): which chest is the Mimic, remembered for when it's opened.
  const sorted = say(fieldSkill(inCave, 'sort', mimic, NOW, { content, scene }));
  assert.equal(sorted.words, 'Jev hops back from it, feathers up. It’s a Mimic.');
  assert.equal(sorted.state.expedition.sorted[mimic.id], 'mimic');
  if (plainChest) assert.equal(say(fieldSkill(inCave, 'sort', { kind: 'loot', ...plainChest }, NOW, { content, scene })).words, 'Jev gives the chest a nod. It’s just a chest.');
  assert.equal(say(fieldSkill(base, 'sort', { kind: 'poi', id: 'poi:chest:3,3', mimic: true }, NOW, { content })).words, 'Jev hops back from it, feathers up. It’s a Mimic.', 'a wild chest’s friendly mimic too');
  assert.equal(say(fieldSkill(noone, 'sort', mimic, NOW, { content, scene })).words, 'That needs Jev, who’s at camp just now.');
  // Opening the Mimic: its fight at once, and after Sort the chest has said so first.
  const opened = say(openChest(sorted.state, mimic, NOW, { content }));
  assert.equal(opened.words, 'It’s the Mimic Jev warned you about. It wakes up.');
  assert.equal(opened.fight, mimic.mimic.fight);
  assert.equal(opened.fight.room, 'mimic');
  assert.equal(fightFor(scene, 'mimic'), mimic.mimic.fight);

  // Riddle (the Tollkeeper): refused until he's joined and out; then a room of Tollmen settles and pays like a Talk down.
  assert.equal(say(fieldSkill(inCave, 'riddle', { kind: 'stray', id: 'enc:r1:f0' }, NOW, { content, scene })).words, 'That needs the Tollkeeper, who hasn’t joined the Company yet.');
  const joined = party.recruit(inCave, 'tollkeeper', NOW, { content });
  const withToll = party.choose(joined, ['claude', 'tollkeeper'], NOW);
  const room = strayRoom(scene);
  const tollRoom = { ...room, fight: { ...room.fight, foes: room.fight.foes.map((u) => ({ ...u, kind: 'tollmen' })) } };
  const tollScene = { ...scene, encounters: { ...scene.encounters, rooms: [tollRoom] } };
  const riddled = say(fieldSkill(withToll, 'riddle', { kind: 'stray', id: `enc:${room.roomId}:f0` }, NOW, { content, scene: tollScene }));
  assert.equal(riddled.state.expedition.rooms[room.roomId], 'talked');
  assert.ok(riddled.state.road.paidFights[room.fight.id], 'it pays like talking down');
  assert.equal(say(fieldSkill(riddled.state, 'riddle', { kind: 'stray', id: `enc:${room.roomId}:f0` }, NOW, { content, scene: tollScene })).state, riddled.state, 'once');
  // Read settles a room of Unwritten, who sit down to listen.
  const unwritten = { ...room, fight: { ...room.fight, foes: room.fight.foes.map((u) => ({ ...u, kind: 'unwritten' })) } };
  const listened = say(fieldSkill(inCave, 'read', { kind: 'stray', id: `enc:${room.roomId}:f0`, foe: 'unwritten' }, NOW, { content, scene: { ...scene, encounters: { ...scene.encounters, rooms: [unwritten] } } }));
  assert.equal(listened.state.expedition.rooms[room.roomId], 'talked');
  const mixed = say(fieldSkill(inCave, 'read', { kind: 'stray', id: `enc:${room.roomId}:f0` }, NOW, { content, scene: { ...scene, encounters: { ...scene.encounters, rooms: [{ ...unwritten, fight: { ...unwritten.fight, foes: [...unwritten.fight.foes, { ...room.fight.foes[0], kind: 'creature' }] } }] } } }));
  assert.equal(mixed.state, inCave, 'not while others in the room won’t listen');

  for (const w of words) assertCalm(w, 'a field skill', { proper: ['Mimic', 'Jev', 'Artificer', 'Scribe', 'Tollkeeper', 'Tollmen', 'Unwritten', 'Company'] });

  // Through the doors: the Mimic's fight starts at once, where the party stands.
  const kit = fakeShell(freshState({ balance: 10 }));
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen, wilds });
  assert.equal((await doors.enterCave(pois[0])).ok, true);
  const there = { kind: 'loot', ...doors.scene().encounters.chests.find((c) => c.mimic) };
  const woke = await doors.openChest(there);
  assert.equal(woke.started, true);
  assert.equal(fight.battle().id, there.mimic.fight.id);
  assert.ok(kit.shell.state.expedition.chests[there.id], 'the chest is opened');
  assert.ok(kit.calls.filter(([name]) => name === 'hideActors').at(-1)[1].includes(there.id), 'the chest gives way to the Mimic on the board');
});

test('real stitches and a wild stitch each pay once, across a relaunch', () => {
  const passes = phase4Passes({ state4, embers, lifeskills, party, expedition: { clearClosed } }, { content, rules });
  const loop = (state, pct, at) => runRiftLoop({ state, snapshot: capacitySnapshot(pct, at), now: at, content, riftgen, worldgen, isFree, phase4: passes });
  const a = loop(freshState(), 91, NOW);
  assert.equal(a.state.road.stitchedThrough, 0, 'the first look seeds the mark');
  const b = loop(a.state, 20, NOW + 60_000);
  assert.equal(b.sealed.length, 1);
  assert.equal(b.stitches, 1, 'the seal pays in the same pass');
  const xp = b.state.road.xp;
  assert.ok(xp > 0);
  assert.equal(b.state.xp.skills.seamcraft, 500);
  const c = loop(normalizeState(JSON.parse(JSON.stringify(b.state)), NOW + 120_000), 20, NOW + 120_000);
  assert.equal(c.stitches, 0, 'a relaunch never pays twice');
  assert.equal(c.state.road.xp, xp);

  const wild = payWildStitch(freshState(), WILD, NOW, { content });
  assert.equal(wild.paid, true);
  assert.ok(wild.xp > 0);
  assert.ok(wild.state.road.paidFights[`stitch:${WILD.id}`]);
  assert.equal(wild.state.xp.skills.seamcraft, 300 + 30 * WILD.spec.depth);
  const reloaded = normalizeState(JSON.parse(JSON.stringify(wild.state)), NOW + HOUR);
  const again = payWildStitch(reloaded, WILD, NOW + HOUR, { content });
  assert.equal(again.paid, false);
  assert.equal(again.state, reloaded);
});

test('going back in after everyone went offline is free once', () => {
  const s = freshState({ balance: 2 });
  const entry = { kind: 'wild', riftId: WILD.id, since: WILD.since, source: sourceFor('wild', WILD, { worldgen, riftgen }), depth: WILD.spec.depth, tier: WILD.spec.tier };
  const inside = door({ ...s, embers: { ...s.embers, balance: 10 } }, entry, NOW, { economy: content.economy }).state;
  const woke = leaveExpedition(party.wake(inside, NOW, { content, rules }));
  assert.ok(woke.party.rests.freeReentry[WILD.id]);
  const poor = { ...woke, embers: { ...woke.embers, balance: 0 } };
  const back = door(poor, entry, NOW + 60_000, { economy: content.economy });
  assert.equal(back.ok, true);
  assert.equal(back.free, true);
  assert.equal(back.cost, 0);
  assert.equal(back.state.party.rests.freeReentry[WILD.id], undefined, 'the grant is used up');
  assert.equal(samePlace(back.state.expedition, inside.expedition), true);
  const twice = door(leaveExpedition(back.state), entry, NOW + 120_000, { economy: content.economy });
  assert.equal(twice.ok, false, 'only once');
});

test('suggested levels name the room’s level and the company’s, with the Wayfarers above the Road level', () => {
  const s = freshState();
  const plain = suggestedLevel(WILD, s, { content });
  assert.match(plain.words, /^Runs at level \d+\. Your company is level 1\.$/);
  const busy = { ...s, tally: { ...s.tally, byCrew: { ...s.tally.byCrew, claude: 40 }, sessionsFinished: 40 } };
  const up = suggestedLevel(WILD, busy, { content });
  assert.ok(up.above.includes('the Scribe'));
  assert.match(up.words, /^Runs at level \d+\. Your company is level 1 \(\d+ on average, with the Scribe\)\.$/);
  assertCalm(up.words, 'the suggested level', { proper: ['Scribe'] });
  assert.equal(settleRoom(s, 'r1', 'won'), s, 'nothing to settle without an expedition');
});
