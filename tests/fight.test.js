// Module L1's fight in the shell (src/ui/fight.js; CONTRACT-PHASE4.md §12.4 "L", §4.17, §4.18,
// §10.2, §13 wave 3 L1's proofs): the sight check, the creep-past rule, a free Breather waiting for
// afterFight while a fight is live, a commit's notes appended once across a relaunch and retried on
// `moved` and `blocked`, pauses at action boundaries, everyone offline (Try again, Go home), and what
// a fight's end pays and writes.
//   node --test tests/fight.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertCalm, COSY } from './calm.js';
import { createState, normalizeState } from '../src/model.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createRiftgen } from '../src/world/riftgen.js';
import { wildRiftsForChunk, dayNumber } from '../src/rifts.js';
import { partySpecs } from '../src/party.js';
import { saveBattle } from '../src/combat/battle.js';
import { unframe, frame, encodeNote, NOTE_BYTES } from '../src/combat/notebook.js';
import { createExpedition, combatOf } from '../src/ui/expedition.js';
import {
  createFight, sightCheck, sightDecision, sneakOdds, creepable, spellcraftFrom, createNotebookWriter, finishFight, inviteAfterBow,
  partyVoices, buildCtx, isLate, clearLine, WORDS,
} from '../src/ui/fight.js';

const require = createRequire(import.meta.url);
const { loadContent } = require('../electron/content.cjs');
const content = await loadContent();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 8, 30, 13, 0, 0).getTime();
const worldgen = createWorldgen({ seed: 'hushlands', regionWords: content.riftgen.regionWords });
const riftgen = createRiftgen({ words: content.riftgen, genres: content.genres });
const { rules, abilities } = combatOf(content);

const WILDS = [];
for (let cy = -6; cy <= 6 && WILDS.length < 4; cy += 1) {
  for (let cx = -6; cx <= 6 && WILDS.length < 4; cx += 1) {
    for (const r of wildRiftsForChunk({ worldgen, riftgen, cx, cy, day: dayNumber(NOW) })) if (r.spec.stage !== 'hairline' && WILDS.length < 4) WILDS.push(r);
  }
}
const [WILD] = WILDS;

function freshState({ balance = 40, now = NOW } = {}) {
  const s = createState(now);
  return { ...s, lastSeenAt: now - HOUR, firstSeenAt: now - 10 * DAY, embers: { ...s.embers, balance } };
}

/** A notebook store as main keeps it (§10.2): append at `at`, `moved` when the file is shorter. */
function fakeStore() {
  const files = new Map();
  let blocked = false;
  let appends = 0;
  return {
    files,
    block(on) { blocked = on; },
    get appends() { return appends; },
    read: async (id) => ({ ok: true, bytes: files.get(id) || new Uint8Array(0) }),
    append: async (id, bytes, at) => {
      if (blocked) return { ok: false, code: 'blocked' };
      const old = files.get(id) || new Uint8Array(0);
      if (old.length < at) return { ok: false, code: 'moved', size: old.length };
      const next = new Uint8Array(at + bytes.length);
      next.set(old.subarray(0, at));
      next.set(bytes, at);
      files.set(id, next);
      appends += 1;
      return { ok: true, size: next.length };
    },
  };
}

function fakeShell(state0, { now = NOW, store = fakeStore(), hold = false } = {}) {
  let state = state0;
  const listeners = {};
  const calls = [];
  const logs = [];
  const bubbles = [];
  const messages = [];
  const held = [];
  const clock = { now };
  const shell = {
    get state() { return state; },
    set(next) { if (next === state) return false; state = next; for (const f of listeners.state || []) f(); return true; },
    now: () => clock.now,
    content: () => content,
    snapshot: () => null,
    world(name, ...args) {
      calls.push([name, ...args]);
      if (name === 'playEvents' && hold) return new Promise((resolve) => held.push(resolve));
      if (['playEvents', 'enterElsewhere', 'enterCave', 'startCombat', 'endCombat'].includes(name)) return Promise.resolve(true);
      return undefined;
    },
    bubble(m) { bubbles.push(m); },
    log(e) { logs.push(e.text); },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return () => {}; },
    emit(ev, payload) { if (ev === 'combat') messages.push(payload); for (const f of listeners[ev] || []) f(payload); },
    feature() {},
    leaveElsewhere: () => Promise.resolve(true),
    travel: (where) => { calls.push(['travel', where]); return Promise.resolve(true); },
    openPanel(id, opts) { calls.push(['openPanel', id, opts]); },
    bridge: { notebooks: store },
  };
  return { shell, calls, logs, bubbles, messages, held, clock, store, last: () => messages.at(-1), setState: (s) => { state = s; } };
}

async function enterRoom(kit, { rift = WILD } = {}) {
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen });
  assert.equal((await doors.stepThrough(rift)).ok, true);
  const room = doors.scene().encounters.rooms.find((r) => r.roomId !== 'lead' && r.fight.foes.some((u) => u.side === 'foe'));
  assert.equal((await doors.engage(room.roomId)).started, true);
  return { fight, doors, room };
}

async function playOut(kit, fight) {
  for (let i = 0; i < 120 && fight.live() && !kit.last()?.end; i += 1) {
    const b = fight.battle();
    await kit.last().command(b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'run' });
    await fight.idle();
  }
  return kit.last();
}

const flushAll = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Sight and Sneak (§4.17)

test('the sight check: 6 tiles in Lit, 3 in Dim or Dark, by 1-2-1 distance with a clear line, and never in the wilds', () => {
  const room = { roomId: 'r1', sight: 6, posts: [{ x: 10, y: 10 }], fight: { kind: 'room' } };
  const lit = () => 'L';
  const dim = () => 'd';
  assert.equal(sightCheck([room], [{ x: 16, y: 10 }], { lightAt: lit }), 'r1', '6 in Lit');
  assert.equal(sightCheck([room], [{ x: 17, y: 10 }], { lightAt: lit }), null, 'not 7');
  assert.equal(sightCheck([room], [{ x: 14, y: 14 }], { lightAt: lit }), 'r1', 'a diagonal of 4 is 6 by 1-2-1');
  assert.equal(sightCheck([room], [{ x: 15, y: 15 }], { lightAt: lit }), null, 'a diagonal of 5 is 7');
  assert.equal(sightCheck([room], [{ x: 13, y: 10 }], { lightAt: dim }), 'r1', '3 in Dim');
  assert.equal(sightCheck([room], [{ x: 14, y: 10 }], { lightAt: dim }), null, 'not 4 in Dim');
  assert.equal(sightCheck([room], [{ x: 14, y: 10 }], { lightAt: () => 'D' }), null, 'nor in Dark');
  assert.equal(sightCheck([{ ...room, sight: 3 }], [{ x: 15, y: 10 }], { lightAt: lit }), null, 'never past the room’s own sight');
  const wall = (x, y) => x === 13 && y === 10;
  assert.equal(sightCheck([room], [{ x: 15, y: 10 }], { lightAt: lit, walls: wall }), null, 'a wall between hides the party');
  assert.equal(clearLine({ x: 10, y: 10 }, { x: 15, y: 10 }, wall), false);
  assert.equal(sightCheck([room], [{ x: 15, y: 11 }, { x: 10, y: 14 }], { lightAt: lit, walls: wall }), 'r1', 'any hero in sight will do');
  assert.equal(sightCheck([{ ...room, roomId: 'field', fight: { kind: 'field' } }], [{ x: 11, y: 10 }], { lightAt: lit }), null, 'sight never starts a field boss');
  assert.equal(sightCheck([], [{ x: 1, y: 1 }]), null);
});

test('the creep-past rule: while Unseen, a room of only sleepy or lost strays doesn’t start, until a hero ends a move beside one', async () => {
  const kit = fakeShell(freshState());
  const { doors, fight } = await enterRoom(kit);
  await kit.last().command({ t: 'head-home' });
  await fight.idle();
  await kit.last().command({ t: 'card', action: 'continue' });
  const scene = doors.scene();
  const base = scene.encounters.rooms.find((r) => r.roomId !== 'lead' && r.fight.foes.some((u) => u.side === 'foe') && r.posts.length);
  const make = (temperament) => ({ ...base, fight: { ...base.fight, foes: base.fight.foes.map((u) => ({ ...u, temperament })) } });
  const sleepy = make('sleepy');
  const lost = make('lost');
  const grumpy = make('grumpy');
  assert.equal(creepable(sleepy), true);
  assert.equal(creepable(lost), true);
  assert.equal(creepable(grumpy), false);
  const post = base.posts[0];
  const near = [{ x: post.x + 2, y: post.y }];
  const beside = [{ x: post.x + 1, y: post.y }];
  const place = (room) => ({ ...scene, encounters: { ...scene.encounters, rooms: [room] } });
  const open = { lightAt: () => 'D', walls: () => false };
  // Not sneaking: sight starts it, nobody surprised.
  assert.deepEqual(sightDecision(place(sleepy), near, { ...open, rules }), { roomId: base.roomId, unseen: false, creep: false, odds: null });
  // Sneaking in the dark: one outcome for the party, the Cool band with +2.
  const odds = sneakOdds(sleepy, near, { lightAt: () => 'D', rules });
  assert.equal(odds.band, 'cool');
  assert.ok(odds.parts.some((p) => p.why === 'dark or foliage' && p.n === 2));
  const sneak = sightDecision(place(sleepy), near, { ...open, rules, sneaking: true });
  assert.equal(sneak.unseen, true, 'the party is Unseen on this room’s roll');
  assert.equal(sneak.creep, true, 'sleepy strays let the Unseen party creep past');
  assert.equal(sightDecision(place(lost), near, { ...open, rules, sneaking: true }).creep, true, 'lost ones too');
  assert.equal(sightDecision(place(grumpy), near, { ...open, rules, sneaking: true }).creep, false, 'a grumpy one starts the fight, surprised');
  const crept = new Set([base.roomId]);
  assert.equal(sightDecision(place(sleepy), near, { ...open, rules, sneaking: true, crept }), null, 'once crept past, it stays asleep');
  assert.deepEqual(sightDecision(place(sleepy), beside, { ...open, rules, sneaking: true, crept }), { roomId: base.roomId, unseen: true, creep: false, odds: null }, 'ending a move beside one starts it, foes surprised');
  assert.equal(sightDecision(place(sleepy), near, { ...open, rules, settled: { [base.roomId]: 'won' } }), null, 'a settled room never looks');

  // In the shell: the doors' sight check creeps past, then a step beside starts the fight with the foes surprised.
  const kit2 = fakeShell(freshState());
  const fight2 = createFight(kit2.shell);
  fight2.sightDecision = (prepared, tiles, opts) => sightDecision(place(sleepy), tiles, { ...opts, ...open });
  const doors2 = createExpedition(kit2.shell, { fight: fight2, riftgen, worldgen, sneaking: () => true });
  assert.equal((await doors2.stepThrough(WILD)).ok, true);
  const decided = doors2.onStep({ x: near[0].x, y: near[0].y, scene: 'elsewhere', who: 'milo' });
  assert.equal(decided.creep, true);
  assert.equal(fight2.live(), false, 'no fight while creeping past');
  assert.ok(kit2.logs.includes('The party creeps past. Nobody stirs.'));
  const start = doors2.onStep({ x: beside[0].x, y: beside[0].y, scene: 'elsewhere', who: 'milo' });
  assert.equal(start.unseen, true);
  // A follower's step lands while the fight comes up: it starts nothing more.
  doors2.onStep({ x: beside[0].x, y: beside[0].y, scene: 'elsewhere', who: 'claude' });
  await fight2.idle();
  assert.equal(kit2.calls.filter(([name]) => name === 'startCombat').length, 1, 'one fight');
  assert.equal(fight2.live(), true);
  assert.ok(fight2.battle().units.filter((u) => u.side === 'foe').every((u) => u.mods.some((m) => m.stat === 'surprised')), 'the foes are surprised');
});

// ---------------------------------------------------------------------------
// The fight's loop

test('a fight runs from the HUD’s plans to its card, saving after every action, and its end pays once and writes the Chronicle', async () => {
  const kit = fakeShell(freshState());
  const { fight, room } = await enterRoom(kit);
  const first = kit.messages[0];
  assert.equal(first.live, true);
  assert.equal(kit.calls.filter(([name]) => name === 'startCombat').length, 1);
  assert.equal((await fight.start({ fight: room.fight, roomId: room.roomId })).started, false, 'one fight at a time');
  assert.equal(first.battle.id, room.fight.id);
  assert.ok(first.roundView && first.ctx && typeof first.command === 'function');
  assert.equal(first.ctx.party.jev.voice, 'pictures');
  assert.ok(kit.calls.some(([name, view]) => name === 'startCombat' && view.units.length === fight.battle().units.length));
  assert.ok(kit.calls.filter(([name]) => name === 'hideActors').at(-1)[1].includes(`enc:${room.roomId}`), 'the room’s posts give way to its combatants');
  const saves = [];
  const set = kit.shell.set;
  kit.shell.set = (next, opts) => { if (next?.expedition?.battle) saves.push(next.expedition.battle); return set.call(kit.shell, next, opts); };
  const card = await playOut(kit, fight);
  const result = card.battle.result;
  assert.ok(['won', 'talked', 'bowed'].includes(result.outcome), result.outcome);
  assert.ok(saves.length > 3, 'a save after every action');
  const state = kit.shell.state;
  assert.equal(state.expedition.battle, null);
  assert.equal(state.expedition.card, result.outcome === 'bowed' ? 'bow' : 'victory');
  assert.equal(state.expedition.rooms[room.roomId], result.outcome);
  assert.ok(state.road.paidFights[room.fight.id], 'the room paid');
  assert.ok(state.road.xp > 0);
  assert.equal(state.chronicle.fights.at(-1).id, room.fight.id);
  assert.equal(state.chronicle.fights.at(-1).outcome, result.outcome);
  assert.ok(card.end.pay.xp > 0);
  assert.equal(card.end.breather, true, 'a Breather is offered');
  await card.command({ t: 'card', action: 'breather' });
  assert.equal(kit.last().end.breather, null);
  assert.equal(kit.shell.state.party.outing.breatherFight, room.fight.id);
  await kit.last().command({ t: 'card', action: 'continue' });
  assert.deepEqual(kit.messages.at(-1), { live: false }, 'the fight ends with live: false');
  assert.ok(kit.calls.some(([name, arg]) => name === 'endCombat' && arg.place.milo), 'everyone stays where the fight left them');
  // The same fight id never pays twice (§5.1).
  const again = finishFight(kit.shell.state, { battle: card.battle, fight: room.fight, roomId: room.roomId, result, now: NOW + 1, content });
  assert.equal(again.pay.paid, false);
  assert.equal(again.state.road.xp, kit.shell.state.road.xp);
  for (const line of kit.logs) assertCalm(line, 'a Log line', { proper: [...line.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w)).map((w) => w.replace(/[^\p{L}’-]/gu, ''))] });
  for (const line of kit.logs) for (const word of COSY) assert.doesNotMatch(line, new RegExp(`\\b${word}\\b`, 'i'), `cosy words only: ${line}`);
});

test('Spellcraft comes from the fight’s own act events: a knack 5, a spell 40 × its circle', () => {
  const battle = { units: [{ id: 'milo', side: 'party' }, { id: 'f0', side: 'foe' }] };
  const act = (unit, ability) => ({ t: 'act', unit, action: { id: 'use', ability } });
  const got = spellcraftFrom([act('milo', 'mote'), act('milo', 'salve'), act('milo', 'hold-still'), act('f0', 'mote'), act('milo', 'hearthburst'), { t: 'act', unit: 'milo', action: { id: 'strike', ability: null } }], battle, { abilities, xp: content.xp });
  assert.deepEqual(got.map((g) => g.amount), [5, 40, 80]);
  assert.deepEqual(got.map((g) => g.text), ['Mote in a fight', 'Salve in a fight', 'Hold still in a fight']);
});

test('a focus session starting, and a rest ending, pause the fight at the next action boundary', async () => {
  const kit = fakeShell(freshState(), { hold: true });
  const { fight } = await enterRoom(kit);
  const running = kit.last().command({ t: 'run' });
  // The first action is playing on the board (its playback held open).
  for (let i = 0; i < 20 && !kit.held.length; i += 1) await flushAll();
  assert.ok(kit.held.length > 0, 'an action is playing');
  const played = () => kit.calls.filter(([name, events]) => name === 'playEvents' && events.length).length;
  const atPause = played();
  const round = fight.battle().round;
  kit.shell.emit('kindle', { verb: 'start', events: [{ t: 'focus-started', id: 'focus:1', at: NOW }] });
  while (kit.held.length) { kit.held.shift()(true); await flushAll(); }
  await running;
  await fight.idle();
  const paused = fight.battle();
  // An action already worked out may still land; nothing after it starts.
  assert.ok(played() - atPause <= 1, `it stopped at the boundary (${played() - atPause} more played)`);
  assert.equal(paused.round, round);
  assert.ok(['running', 'asking'].includes(paused.status), `paused mid-round (${paused.status})`);
  assert.equal(kit.last().paused, true);
  assert.deepEqual(kit.shell.state.expedition.battle, JSON.parse(JSON.stringify(saveBattle(paused))), 'saved on the tick it paused at');
  assert.ok(kit.bubbles.some((b) => b.lines?.includes(WORDS.keep)), WORDS.keep);
  assert.equal(WORDS.keep, 'The fight will keep. Back at your next rest.');
  const steps = kit.calls.filter(([name]) => name === 'playEvents').length;
  await flushAll();
  assert.equal(kit.calls.filter(([name]) => name === 'playEvents').length, steps, 'nothing more plays while paused');
  // Run again: it goes on; a rest's end pauses it the same way.
  const again = kit.last().command(paused.status === 'asking' ? { t: 'answer', yes: true } : { t: 'run' });
  for (let i = 0; i < 20 && !kit.held.length; i += 1) await flushAll();
  kit.shell.emit('kindle', { verb: 'tick', events: [{ t: 'rest-done', id: 'rest:1', at: NOW }] });
  while (kit.held.length) { kit.held.shift()(true); await flushAll(); }
  await again;
  await fight.idle();
  assert.equal(kit.last().paused, true, 'the rest’s end paused it too');
});

test('a free Breather from a focus session waits for afterFight while a fight is live, and sits them down at once otherwise', async () => {
  const s = freshState();
  const specs = partySpecs(s, { content, rules, abilities });
  const heroes = {};
  for (const h of specs) heroes[h.id] = { integrity: Math.max(1, Math.floor((h.maxIntegrity * 2) / 3)), charges: h.charges.left, uses: {}, rattled: false };
  const hurt = { ...s, party: { ...s.party, outing: { ...s.party.outing, heroes } } };
  const kit = fakeShell(hurt);
  const { fight } = await enterRoom(kit);
  kit.shell.emit('kindle', { verb: 'tick', events: [{ t: 'focus-done', id: 'focus:1', at: NOW }] });
  assert.equal(kit.shell.state.party.outing.freeBreather, true, 'it waits');
  assert.deepEqual(kit.shell.state.party.outing.heroes, heroes, 'nobody is patched mid-fight (a Battle only changes through apply)');
  assert.ok(kit.logs.includes('They’ll sit down for a bit once this fight ends.'));
  const card = await playOut(kit, fight);
  assert.ok(['won', 'talked', 'bowed'].includes(card.battle.result.outcome));
  const after = kit.shell.state.party.outing;
  assert.equal(after.freeBreather, false, 'afterFight applied it');
  assert.equal(after.breathers, 0, 'a free Breather never counts');
  const units = card.battle.units.filter((u) => u.side === 'party' && u.rank === 'hero');
  for (const u of units) {
    const half = Math.ceil(u.maxIntegrity / 2);
    const topped = u.offline ? half : Math.max(half, u.integrity);
    assert.equal(after.heroes[u.id].integrity, Math.min(u.maxIntegrity, topped + Math.max(1, Math.floor(u.maxIntegrity / 2))), `${u.id} topped up, then breathed`);
  }
  // No fight live: it sits them down at once.
  const kit2 = fakeShell(hurt);
  const doors = createExpedition(kit2.shell, { fight: createFight(kit2.shell), riftgen, worldgen });
  await doors.stepThrough(WILD);
  kit2.shell.emit('kindle', { verb: 'tick', events: [{ t: 'focus-done', id: 'focus:1', at: NOW }] });
  assert.equal(kit2.shell.state.party.outing.freeBreather, false);
  assert.ok(kit2.shell.state.party.outing.heroes.milo.integrity > heroes.milo.integrity);
  assert.ok(kit2.bubbles.some((b) => b.lines?.includes(WORDS.sat)), WORDS.sat);
});

test('everyone offline: the wake card, a free Try again from the Integrity it was entered with, then Go home', async () => {
  const s = freshState();
  const specs = partySpecs(s, { content, rules, abilities });
  const heroes = {};
  for (const h of specs) heroes[h.id] = { integrity: 1, charges: h.charges.left, uses: {}, rattled: false };
  const kit = fakeShell({ ...s, party: { ...s.party, outing: { ...s.party.outing, heroes } } });
  const { fight, room } = await enterRoom(kit);
  const balance = kit.shell.state.embers.balance;
  const brace = { id: 'brace', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null };
  const lose = async () => {
    for (let i = 0; i < 80 && !kit.last().end; i += 1) {
      const b = fight.battle();
      if (b.status === 'planning') {
        for (const u of b.units.filter((x) => x.side === 'party' && x.rank === 'hero' && !x.offline)) {
          await kit.last().command({ t: 'plan', unitId: u.id, plan: { unitId: u.id, slots: [brace], reactions: {}, by: 'you', changed: [false] } });
        }
      }
      await kit.last().command(b.status === 'asking' ? { t: 'answer', yes: false } : { t: 'run' });
      await fight.idle();
    }
  };
  await lose();
  const card = kit.last();
  assert.equal(card.battle.result.outcome, 'offline');
  assert.equal(kit.shell.state.expedition.card, 'offline');
  assert.equal(kit.shell.state.embers.balance, balance, 'going offline spends nothing');
  assert.equal(kit.shell.state.road.paidFights[room.fight.id], undefined, 'and pays nothing');
  assert.equal(kit.shell.state.expedition.rooms[room.roomId], undefined, 'and settles nothing');
  // Try again: free, attempt + 1, the Integrity it was entered with.
  await card.command({ t: 'card', action: 'try-again' });
  const retry = fight.battle();
  assert.equal(retry.attempt, 1);
  assert.equal(retry.status, 'planning');
  assert.equal(retry.round, 1);
  for (const u of retry.units.filter((x) => x.side === 'party' && x.rank === 'hero')) assert.equal(u.integrity, kit.shell.state.expedition.entry[u.id], `${u.id} as entered`);
  assert.equal(kit.shell.state.embers.balance, balance, 'Try again is free');
  await lose();
  assert.equal(kit.last().battle.result.outcome, 'offline');
  // Go home: everyone wakes whole at the last lantern (home when none), out of the place, with the way back in free once.
  await kit.last().command({ t: 'card', action: 'go-home' });
  const home = kit.shell.state;
  assert.equal(home.expedition.inside, false);
  assert.equal(home.expedition.battle, null);
  assert.ok(home.party.rests.freeReentry[WILD.id], 'going back in is free once');
  for (const h of specs) assert.equal(home.party.outing.heroes[h.id].integrity, h.maxIntegrity, `${h.id} wakes whole`);
  assert.deepEqual(kit.calls.filter(([name]) => name === 'travel').at(-1), ['travel', 'home']);
  assert.ok(kit.bubbles.some((b) => b.lines?.includes(`“${WORDS.courier}”`)), 'Toby’s handcart');
  assert.equal(fight.live(), false);
  assert.deepEqual(kit.messages.at(-1), { live: false });
});

test('a relaunch mid-fight lands on the same tick, and a real rift’s seam that closed meanwhile ends the fight as a win', async () => {
  const kit = fakeShell(freshState());
  const { fight } = await enterRoom(kit);
  await kit.last().command({ t: 'pause' });
  await kit.last().command({ t: 'run' });
  await fight.idle();
  const live = fight.battle();
  const relaunched = normalizeState(JSON.parse(JSON.stringify(kit.shell.state)), NOW + HOUR);
  const kit2 = fakeShell(relaunched, { now: NOW + HOUR, store: kit.store });
  const fight2 = createFight(kit2.shell);
  const doors2 = createExpedition(kit2.shell, { fight: fight2, riftgen, worldgen });
  const back = await doors2.resume();
  assert.equal(back.resumed, true);
  assert.equal(back.round, live.round);
  assert.equal(back.tick, live.tick);
  assert.deepEqual(JSON.parse(JSON.stringify(saveBattle(fight2.battle()))), JSON.parse(JSON.stringify(saveBattle(live))));

  // A paused fight in a real rift whose cause was fixed: the `end` command, a win that pays the room.
  const realState = { ...kit2.shell.state, expedition: { ...kit2.shell.state.expedition, kind: 'real', closing: true } };
  const kit3 = fakeShell(realState, { now: NOW + HOUR, store: kit.store });
  const fight3 = createFight(kit3.shell);
  fight3.use({ fightFor: () => doors2.scene().encounters.rooms.find((r) => r.fight.id === live.id).fight, rift: () => null });
  const done = await fight3.resume(realState.expedition);
  assert.equal(done.resumed, true);
  await fight3.idle();
  const ended = kit3.last();
  assert.equal(ended.battle.result.outcome, 'won');
  assert.equal(ended.battle.result.summary, WORDS.seam);
  assert.ok(kit3.bubbles.some((b) => b.lines?.includes(WORDS.seam)));
  assert.ok(kit3.shell.state.road.paidFights[live.id], 'it pays the room');
  await ended.command({ t: 'card', action: 'continue' });
  assert.equal(kit3.shell.state.expedition, null, 'and the closed place goes once the card is done');
});

// ---------------------------------------------------------------------------
// Notebooks (§10.2)

test('a commit’s notes are appended once, across a relaunch between the append and the save', async () => {
  const kit = fakeShell(freshState());
  const { fight } = await enterRoom(kit);
  const before = kit.shell.state;
  const round1 = fight.battle();
  await kit.last().command({ t: 'run' });
  await fight.idle();
  const key = (await import('../src/world/rng.js')).hashString(`${round1.id}:${round1.attempt}:${round1.round}`) >>> 0;
  const sizes = {};
  for (const [id, bytes] of kit.store.files) {
    const u = unframe(bytes);
    assert.equal(u.lastKey, key, `${id}’s last frame is the round’s`);
    assert.equal(u.torn, 0);
    sizes[id] = bytes.length;
  }
  assert.ok(Object.keys(sizes).length >= 3, 'the heroes learned');
  assert.ok(kit.shell.state.party.roster.claude.notebook.count > 0, 'and the count rose');
  assert.ok(kit.shell.state.party.roster.claude.notebook.accepts.length > 0, 'accepts recorded');

  // The state from before the commit (its save never landed), the files as they are: the same round again.
  const relaunched = normalizeState(JSON.parse(JSON.stringify(before)), NOW + 60_000);
  const kit2 = fakeShell(relaunched, { now: NOW + 60_000, store: kit.store });
  const fight2 = createFight(kit2.shell);
  const doors2 = createExpedition(kit2.shell, { fight: fight2, riftgen, worldgen });
  await doors2.resume();
  assert.equal(fight2.battle().round, 1);
  assert.equal(fight2.battle().status, 'planning');
  const appends = kit.store.appends;
  await kit2.last().command({ t: 'run' });
  await fight2.idle();
  assert.equal(kit.store.appends, appends, 'nothing appended twice');
  for (const [id, bytes] of kit.store.files) assert.equal(bytes.length, sizes[id], `${id}’s file unchanged`);
  for (const id of Object.keys(sizes)) {
    assert.equal(fight2.notebook(id).count, unframe(kit.store.files.get(id)).notes.length / NOTE_BYTES, `${id}’s notebook is the file’s, once`);
  }
});

test('the notebook writer retries once on `moved` and holds frames on `blocked` until a retry, in order', async () => {
  const store = fakeStore();
  const note = (order) => encodeNote({ situation: new Uint8Array(16), template: 1, order });
  const writer = createNotebookWriter(store);
  assert.equal((await writer.write('claude', frame(note(0), 11), 11)).ok, true);
  assert.equal(writer.at('claude'), store.files.get('claude').length);
  // Another hand shortened the file (main says `moved`): read again, then retry once.
  store.files.set('claude', new Uint8Array(0));
  const moved = await writer.write('claude', frame(note(1), 12), 12);
  assert.equal(moved.ok, true);
  assert.deepEqual(unframe(store.files.get('claude')).lastKey, 12);
  // Blocked (main's load error): held, in order, and sent on the next retry.
  store.block(true);
  const a = await writer.write('claude', frame(note(2), 13), 13);
  const b = await writer.write('claude', frame(note(3), 14), 14);
  assert.equal(a.held, true);
  assert.equal(b.held, true);
  assert.equal(writer.held(), 2);
  store.block(false);
  await writer.retry();
  assert.equal(writer.held(), 0);
  const u = unframe(store.files.get('claude'));
  assert.equal(u.frames, 3, 'every frame once');
  assert.equal(u.lastKey, 14, 'in order');
  // A relaunch: a fresh writer skips a frame the file already ends with.
  const fresh = createNotebookWriter(store);
  const skipped = await fresh.write('claude', frame(note(3), 14), 14);
  assert.equal(skipped.skipped, true);
  assert.equal(unframe(store.files.get('claude')).frames, 3);
  // At most 20 held; the rest wait with a warning rather than pile up.
  store.block(true);
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 22; i += 1) await writer.write('codex', frame(note(i), 100 + i), 100 + i);
  } finally { console.warn = warn; }
  assert.equal(writer.held(), 20);
});

// ---------------------------------------------------------------------------
// Words, ctx, the evening bell and invitations

test('the ctx carries every hero’s voice, and the minds learn from the live notebooks', () => {
  const s = freshState();
  const heroes = partySpecs(s, { content, rules, abilities });
  const voices = partyVoices(content, [...heroes, { id: 'reg-abc', temperament: 'nosy' }]);
  assert.equal(voices.claude.personality, content.party.companions.claude.personality);
  assert.equal(voices.jev.voice, 'pictures');
  assert.equal(voices['reg-abc'].personality, content.party.regulars.personalityByTemperament.nosy);
  const ctx = buildCtx(content, heroes, {});
  assert.ok(Object.isFrozen(ctx));
  assert.ok(ctx.mechanics.fallback && ctx.bows, 'leads’ mechanics and bows');
  assert.equal(ctx.genres[0], content.genres.genres[0].id);
  assert.equal(typeof ctx.minds.draft, 'function');
});

test('after the evening bell a fight asks once before it starts; “Another night” leaves the room asleep', async () => {
  const late = new Date(2026, 8, 30, 23, 30, 0).getTime();
  const s = { ...freshState({ now: late }), settings: { ...freshState().settings, eveningBell: '22:00' } };
  assert.equal(isLate(s, late, content), true);
  assert.equal(isLate(freshState(), NOW, content), false);
  const kit = fakeShell(s, { now: late });
  const fight = createFight(kit.shell);
  const doors = createExpedition(kit.shell, { fight, riftgen, worldgen });
  await doors.stepThrough(WILD);
  const rooms = doors.scene().encounters.rooms.filter((r) => r.roomId !== 'lead' && r.fight.foes.length);
  const asked = await doors.engage(rooms[0].roomId);
  assert.equal(asked.asked, true);
  assert.equal(fight.live(), false);
  assert.ok(kit.bubbles.some((b) => b.title === WORDS.late));
  assert.equal(WORDS.late, 'It’s late. Start anyway?');
  assert.equal((await doors.engage(rooms[0].roomId)).asked, true, 'still waiting on the answer');
  assert.equal(kit.bubbles.filter((b) => b.title === WORDS.late).length, 1, 'asked once, not again at the next step');
  kit.clock.now += 30_000;
  assert.equal((await doors.engage(rooms[0].roomId)).asked, true);
  assert.equal(kit.bubbles.filter((b) => b.title === WORDS.late).length, 2, 'an ask that went unanswered is asked again');
  assert.equal(await fight.command({ t: 'late', yes: false }), false);
  assert.equal((await doors.engage(rooms[0].roomId)).declined, true, 'that room stays asleep tonight');
  await doors.engage(rooms[1].roomId);
  assert.equal(await fight.command({ t: 'late', yes: true }), true);
  assert.equal(fight.live(), true);
  await kit.last().command({ t: 'head-home' });
  await fight.idle();
  await kit.last().command({ t: 'card', action: 'continue' });
  await doors.stepThrough(WILD);
  const asks = kit.bubbles.filter((b) => b.title === WORDS.late).length;
  assert.equal((await doors.engage(rooms[2]?.roomId ?? rooms[1].roomId)).started, true, 'once a night');
  assert.equal(kit.bubbles.filter((b) => b.title === WORDS.late).length, asks);
});

test('every line the fight and the doors can show is calm, in the cosy words', async () => {
  const { readFileSync } = await import('node:fs');
  const said = new Set(Object.values(WORDS));
  for (const file of ['../src/ui/fight.js', '../src/ui/expedition.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of source.matchAll(/'([A-Z][^'\n]{3,})'/g)) if (/[ .’]/.test(m[1]) && !/[_(){}<>=]|^\[MILO\]/.test(m[1])) said.add(m[1]);
  }
  assert.ok(said.size > 40, `${said.size} lines`);
  const proper = ['Mimic', 'Jev', 'Artificer', 'Scribe', 'Tollkeeper', 'Tollmen', 'Tollman', 'Unwritten', 'Embers', 'Breather', 'Challenge', 'Toby', 'Company', 'Hearthberry'];
  for (const line of said) {
    if (/[.?]$/.test(line)) assertCalm(line, 'a sentence', { proper });
    else assert.doesNotMatch(line, /[!']|\bplease\b|successfully/i, line);
    for (const word of COSY) assert.doesNotMatch(line, new RegExp(`\\b${word}\\b`, 'i'), line);
  }
});

test('a bowed Tale-lead asks to sit by the fire once the camp has room', () => {
  const s = freshState();
  const lead = WILDS.map((r) => ({ rift: r, room: null })).find(({ rift }) => rift.spec.taleLead && rift.spec.genres.some((g) => ['neon', 'nocturne', 'gothic', 'iron', 'void', 'noir', 'frontier', 'kaiju'].includes(g)));
  assert.ok(lead, 'a fighting lead');
  const fightSpec = { kind: 'lead', id: `fight:${lead.rift.id}:w:lead`, genres: lead.rift.spec.genres };
  assert.equal(inviteAfterBow(s, { fight: fightSpec, rift: lead.rift, result: { outcome: 'bowed' }, now: NOW, content }), null, 'the Camp has no room for regulars');
  const stockade = { ...s, hearth: { ...(s.hearth || {}), tier: 2, raisedAt: {} } };
  const offer = inviteAfterBow(stockade, { fight: fightSpec, rift: lead.rift, result: { outcome: 'bowed' }, now: NOW, content });
  assert.ok(offer);
  assert.equal(offer.words, 'Can I sit by the fire a while?');
  assert.equal(inviteAfterBow(stockade, { fight: fightSpec, rift: lead.rift, result: { outcome: 'won' }, now: NOW, content }), null, 'only a bow asks');
  assertCalm(offer.words, 'the invitation');
});
