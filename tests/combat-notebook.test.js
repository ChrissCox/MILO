// The notebook (src/combat/notebook.js; CONTRACT-PHASE4.md §5.10, §5.11, §7.2, §10.2, §15; COMBAT.md
// §3.3): notes and frames, learning only from accepts and changes, never dropping a note, lessons,
// sync, per-slot drafts, confidence on a new genre, the index's exact 7 nearest, determinism, guard
// rails, and the 50,000-note budget.
//   node --test tests/combat-notebook.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import {
  NOTE_BYTES, SITUATION_BYTES, FRAME_HEADER, CHOICES, RULE_IFS, RULE_THENS, encodeNote, decodeNote, frame, unframe, crc32, createNotebook,
  withNotebookMeta, draftFor, learn, habits, sync, teachNotes, addNotes, nextOrder, ruleText, situationOf, choiceOf, choicesOf, resolveChoice,
  nearestNotes, bruteNearest, situationDistance, abilityHash, TEMPLATE_IDS, habitWhy, countWord,
} from '../src/combat/notebook.js';
import { makeMinds, scriptedPlan, workable } from '../src/combat/ai.js';
import { ticksOf } from '../src/combat/round.js';
import { createBattle, apply, saveBattle } from '../src/combat/battle.js';
import { commit, step } from '../src/combat/driver.js';
import { hashInts } from '../src/world/rng.js';
import { assertCalm, COSY } from './calm.js';
import {
  world, ctxFor, partyAt, roomsFor, playGuided, learnInto, snapshots, jitteredNotes, randomNotes, medianMs, rand, randInt, TERMINAL,
} from './minds-kit.js';
import { hero, stray, fightSpec, makeCtx, OPEN, findUnit } from './combat-kit.js';

const require = createRequire(import.meta.url);
const T = TEMPLATE_IDS;

const situation = (seed) => {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) s[i] = hashInts(seed, i) & 0xff;
  return s;
};

// ---------------------------------------------------------------------------
// Notes and frames

test('a note round-trips through its 24 bytes, every field at its edges', () => {
  assert.equal(NOTE_BYTES, 24);
  assert.equal(SITUATION_BYTES, 16);
  for (let i = 0; i < 500; i += 1) {
    const c = CHOICES[i % CHOICES.length];
    const note = {
      situation: situation(i), template: c.id, slot: i % 4, cost: i % 4, relation: c.relation, ability: hashInts(i, 'ab') & 0xffff,
      weight: 1 + (i % 2), taught: i % 3 === 0, order: i === 7 ? 0xffffff : hashInts(i, 'o') & 0xffffff,
    };
    const bytes = encodeNote(note);
    assert.equal(bytes.length, 24);
    const back = decodeNote(bytes);
    assert.deepEqual([...back.situation], [...note.situation]);
    for (const k of ['template', 'slot', 'cost', 'relation', 'ability', 'weight', 'taught', 'order']) assert.equal(back[k], note[k], `${k} at ${i}`);
    assert.equal(back.habit, `${note.template}:${note.ability}`);
    // Bits §5.10 keeps zero stay zero.
    assert.equal(bytes[17] >> 6, 0);
    assert.equal(bytes[20] >> 3, 0);
    // A note in the middle of a run decodes at its offset.
    const run = new Uint8Array(72);
    run.set(bytes, 24);
    assert.equal(decodeNote(run, 24).order, note.order);
  }
});

test('crc32 is zlib’s, and a frame is §10.2’s header and whole notes', () => {
  for (let i = 0; i < 50; i += 1) {
    const bytes = new Uint8Array(i * 7).map((_, k) => hashInts(i, k) & 0xff);
    assert.equal(crc32(bytes), zlib.crc32(bytes) >>> 0);
  }
  const notes = new Uint8Array(3 * 24).map((_, k) => k & 0xff);
  const f = frame(notes, 0xdeadbeef);
  assert.equal(f.length, FRAME_HEADER + 72);
  const view = Buffer.from(f);
  assert.equal(view.readUInt16LE(0), 0x424e);
  assert.equal(view.readUInt8(2), 1);
  assert.equal(view.readUInt16LE(3), 3);
  assert.equal(view.readUInt32LE(5), zlib.crc32(notes) >>> 0);
  assert.equal(view.readUInt32LE(9), 0xdeadbeef);
  assert.throws(() => frame(new Uint8Array(25), 1), /whole notes/);
});

test('unframe keeps good frames, steps over a bad CRC, stops at a torn tail, and reports good and lastKey as main reads them', () => {
  const { goodEnd } = require('../electron/notebooks.cjs');
  const a = frame(new Uint8Array(48).fill(1), 11);
  const bad = frame(new Uint8Array(24).fill(2), 22);
  bad[FRAME_HEADER + 3] ^= 0xff; // the notes no longer match the CRC
  const c = frame(new Uint8Array(24).fill(3), 33);
  const torn = frame(new Uint8Array(72).fill(4), 44).slice(0, 40);
  const file = new Uint8Array([...a, ...bad, ...c, ...torn]);
  const r = unframe(file);
  assert.equal(r.frames, 2);
  assert.equal(r.notes.length, 72);
  assert.deepEqual([...r.notes.slice(0, 48)], new Array(48).fill(1));
  assert.deepEqual([...r.notes.slice(48)], new Array(24).fill(3));
  assert.equal(r.good, a.length + bad.length + c.length);
  assert.equal(r.torn, torn.length);
  assert.equal(r.lastKey, 33);
  assert.equal(r.good, goodEnd(file));
  // Nothing at all, and junk only.
  assert.deepEqual(unframe(new Uint8Array(0)), { notes: new Uint8Array(0), frames: 0, torn: 0, good: 0, lastKey: null });
  assert.equal(unframe(new Uint8Array(30).fill(9)).good, 0);
  // Random corruption of a run of frames: our `good` is always main's.
  for (let i = 0; i < 300; i += 1) {
    const parts = [];
    for (let k = 0; k < 1 + (i % 5); k += 1) parts.push(frame(new Uint8Array(24 * (k % 3)).map((_, j) => hashInts(i, k, j) & 0xff), hashInts(i, k)));
    const bytes = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.length; }
    const cut = bytes.slice(0, bytes.length - (hashInts(i, 'cut') % 20));
    if (cut.length > 5) cut[hashInts(i, 'flip') % cut.length] ^= 1 << (i % 8);
    assert.equal(unframe(cut).good, goodEnd(cut), `case ${i}`);
  }
});

// ---------------------------------------------------------------------------
// Learning

function levelOneMinds(ids = ['milo', 'claude']) {
  const heroes = partyAt(world, 1, 4).filter((h) => ids.includes(h.id));
  const notebooks = Object.fromEntries(heroes.map((h) => [h.id, createNotebook(h.id)]));
  const ctx = ctxFor(world, heroes, { notebooks });
  return { heroes, notebooks, ctx };
}

test('learning writes accepted slots at weight 1 and changed ones at weight 2, Command at 1, and nothing for auto or an empty slot', () => {
  const { heroes, notebooks, ctx } = levelOneMinds();
  const room = roomsFor(world, { level: 1, room: 'moderate', partySize: 2, seed: 3, count: 1 })[0];
  const b = createBattle(room.fights[0], heroes, { roadLevel: 1 }, ctx);
  const draft = ctx.minds.draft(b, 'claude');
  // Keep her first slot, change the rest to Brace.
  const mine = { ...draft.plan, slots: draft.plan.slots.map((a, i) => (i === 0 ? a : { ...a, id: 'brace', ability: null, target: null, cost: 1, choice: null })), by: 'draft' };
  const c = commit(b, { claude: mine, milo: ctx.minds.draft(b, 'milo').plan }, ctx);
  const rec = c.record.units.claude;
  assert.equal(rec.auto, false);
  assert.equal(rec.accepted[0], true);
  const { notebook, added } = learn(notebooks.claude, c.record, 'claude');
  const notes = [];
  for (let i = 0; i < added.length; i += 24) notes.push(decodeNote(added, i));
  assert.equal(notes.length, rec.choices.filter(Boolean).length);
  assert.equal(notebook.count, notes.length);
  notes.forEach((n) => {
    assert.equal(n.weight, rec.accepted[n.slot] ? 1 : 2, `slot ${n.slot}`);
    assert.equal(n.template, rec.choices[n.slot].template);
    assert.deepEqual([...n.situation], [...Buffer.from(rec.situation, 'base64')]);
  });
  assert.deepEqual(notes.map((n) => n.order), notes.map((_, i) => i), 'orders run from 0');
  // Command writes count once.
  assert.ok(decodeNoteAll(learn(notebooks.claude, c.record, 'claude', { command: true }).added).every((n) => n.weight === 1));
  // Auto records teach nothing.
  const auto = { ...c.record, units: { claude: { ...rec, auto: true } } };
  const r2 = learn(notebooks.claude, auto, 'claude');
  assert.equal(r2.notebook, notebooks.claude);
  assert.equal(r2.added.length, 0);
  // A slot with no choice (Head home) writes nothing.
  const home = { ...c.record, units: { claude: { ...rec, choices: [null, ...rec.choices.slice(1)] } } };
  assert.equal(learn(notebooks.claude, home, 'claude').added.length, (rec.choices.filter(Boolean).length - 1) * 24);
});

function decodeNoteAll(bytes) {
  const out = [];
  for (let i = 0; i + 24 <= bytes.length; i += 24) out.push(decodeNote(bytes, i));
  return out;
}

test('20 rounds with a companion on Let them choose add 0 notes to her notebook, while Milo on review learns', () => {
  const { heroes, notebooks, ctx } = levelOneMinds();
  const choose = heroes.map((h) => (h.id === 'claude' ? { ...h, control: 'choose' } : h));
  const nbs = { milo: notebooks.milo, claude: notebooks.claude };
  const minds = ctxFor(world, choose, { notebooks: nbs });
  let rounds = 0;
  for (let seed = 1; rounds < 20 && seed < 40; seed += 1) {
    const room = roomsFor(world, { level: 1, room: 'moderate', partySize: 2, seed, count: 1 })[0];
    const b = createBattle(room.fights[0], choose, { roadLevel: 1 }, minds);
    playGuided(b, minds, {
      onRecord: (record) => {
        rounds += 1;
        assert.equal(record.units.claude?.auto ?? true, true);
        learnInto(nbs, null, record);
      },
    });
  }
  assert.ok(rounds >= 20, `${rounds} rounds played`);
  assert.equal(nbs.claude.count, 0, 'nothing played on auto is learned');
  assert.ok(nbs.milo.count > 0, 'Milo, on review, learns');
  assert.ok(ctx);
});

test('an improvisation is never a note: the round teaches its committed choices, not what she did instead', () => {
  const ctx = makeCtxReal();
  const f0 = stray('f0', { x: 4, y: 2, integrity: 1, maxIntegrity: 20 });
  const f1 = stray('f1', { x: 12, y: 3, talkKind: 'k1' });
  const fight = fightSpec({ foes: [f0, f1] });
  const heroes = [hero('milo', { abilityIds: [], carry: { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] } }), hero('claude', { abilityIds: [] })];
  const nb = createNotebook('claude');
  let b = createBattle(fight, heroes, {}, ctx);
  // Milo sorts the one-Integrity stray in tick 1; the Scribe's tick-3 Strike on it has to change.
  const miloPlan = { unitId: 'milo', slots: [act('stride', { target: { tile: { x: 3, y: 2 } } }), act('strike', { target: { unit: 'f0' } }), act('brace')], reactions: {}, by: 'you', changed: [false, false, false] };
  const herPlan = { unitId: 'claude', slots: [act('brace'), act('delay', { cost: 0 }), act('strike', { target: { unit: 'f0' } })], reactions: {}, by: 'you', changed: [false, false, false] };
  const c = commit(b, { milo: miloPlan, claude: herPlan }, ctx);
  const learned = learn(nb, c.record, 'claude');
  b = c.battle;
  const events = [];
  while (b.status === 'running' || b.status === 'asking') {
    const s = step(b, ctx);
    events.push(...s.events);
    if (s.battle === b) break;
    b = s.battle;
  }
  const improvised = events.filter((e) => e.t === 'improvise' || (e.t === 'lost' && e.unit === 'claude'));
  assert.ok(findUnit(b, 'f0').sorted, 'the stray was sorted before her Strike');
  assert.ok(improvised.some((e) => e.unit === 'claude'), 'her Strike couldn’t happen as planned');
  const notes = decodeNoteAll(learned.added);
  assert.deepEqual(notes.map((n) => n.template), c.record.units.claude.choices.filter(Boolean).map((x) => x.template), 'only the committed choices');
  assert.ok(notes.some((n) => n.template === T['hit-weakest'] || n.template === T['hit-other'] || n.template === T['hit-threat']));
});

function makeCtxReal() {
  const ctx = { rules: makeCtx().rules, abilities: makeCtx().abilities, minds: null, mechanics: {}, bows: null, genres: makeCtx().genres, party: makeCtx().party };
  ctx.minds = makeMinds(ctx);
  return Object.freeze(ctx);
}

const act = (id, extra = {}) => ({ id, ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null, ...extra });

test('nothing leaves a notebook: learning, lessons and strike-outs only add or filter, and the bytes stay put', () => {
  const base = randomNotes(300, 17);
  let nb = createNotebook('claude', base);
  const keep = nb.notes.slice();
  const keys = habits(nb).map((h) => h.key);
  const struck = withNotebookMeta(nb, { struck: [keys[0], keys[1]] });
  assert.equal(struck.count, nb.count, 'a strike-out keeps every note');
  assert.deepEqual([...struck.notes], [...keep]);
  assert.ok(habits(struck).find((h) => h.key === keys[0]).struck, 'it’s crossed out on the page');
  // Struck habits stop counting in drafts' nearest notes.
  const sit = situation(4);
  const near = nearestNotes(struck, sit, [0, 'any']);
  for (const list of near.values()) for (const n of list) assert.ok(![keys[0], keys[1]].includes(`${struck.index.store.bytes[n.i * 24 + 16]}:${struck.index.store.bytes[n.i * 24 + 18] | (struck.index.store.bytes[n.i * 24 + 19] << 8)}`));
  // A lesson and more learning only grow it.
  const lesson = teachNotes(nb, keys[2], nextOrder(nb));
  nb = addNotes(nb, lesson);
  assert.equal(nb.count, 300 + lesson.length / 24);
  assert.deepEqual([...nb.notes.slice(0, keep.length)], [...keep]);
  // An old version stays whole when a newer one grows from it twice.
  const v1 = addNotes(nb, lesson);
  const v2 = addNotes(nb, teachNotes(nb, keys[3], nextOrder(nb)));
  assert.deepEqual([...v1.notes.slice(0, nb.notes.length)], [...nb.notes]);
  assert.deepEqual([...v2.notes.slice(0, nb.notes.length)], [...nb.notes]);
  assert.equal(nb.count, 300 + lesson.length / 24);
  // No export removes notes: every notebook-returning call keeps the count or raises it.
  for (const f of [(x) => withNotebookMeta(x, { struck: [] }), (x) => withNotebookMeta(x, { rules: [{ if: 'always', then: 'brace' }] }), (x) => addNotes(x, new Uint8Array(0))]) {
    assert.ok(f(nb).count >= nb.count);
  }
});

test('a lesson copies exactly one habit, taught and counting once, renumbered from the next order', () => {
  const from = createNotebook('rivet', randomNotes(400, 23));
  const to = createNotebook('tova', randomNotes(50, 29));
  for (const h of habits(from).slice(0, 5)) {
    const start = nextOrder(to);
    const bytes = teachNotes(from, h.key, start);
    const notes = decodeNoteAll(bytes);
    assert.equal(notes.length, h.count, h.key);
    assert.ok(notes.every((n) => n.habit === h.key && n.taught && n.weight === 1));
    assert.deepEqual(notes.map((n) => n.order), notes.map((_, i) => start + i));
    const after = addNotes(to, bytes);
    const before = new Map(habits(to).map((x) => [x.key, x.count]));
    const grew = habits(after).filter((x) => x.count !== (before.get(x.key) || 0));
    assert.deepEqual(grew.map((x) => x.key), [h.key], 'only that habit grows');
  }
  // A struck habit can't be taught.
  const key = habits(from)[0].key;
  assert.equal(teachNotes(withNotebookMeta(from, { struck: [key] }), key, 0).length, 0);
});

test('sync is the share of accepted slots among the last 50', () => {
  assert.equal(sync(''), 0);
  assert.equal(sync('1111'), 100);
  assert.equal(sync('10'), 50);
  assert.equal(sync(`${'0'.repeat(50)}${'1'.repeat(40)}${'0'.repeat(10)}`), 80);
  assert.equal(sync('1x1'), 100, 'junk is ignored');
});

test('pinned: sync after 20 scripted fights is at least 80% (the Scribe at level 1, an empty notebook, seeds 1–20, Long Road stray rooms at n = 1)', (t) => {
  const { heroes, notebooks, ctx } = levelOneMinds();
  const accepts = {};
  for (let seed = 1; seed <= 20; seed += 1) {
    const room = roomsFor(world, { level: 1, room: 'moderate', partySize: heroes.length, seed, count: 1 })[0];
    const b = createBattle(room.fights[0], heroes, { roadLevel: 1, mode: 'long-road' }, ctx);
    playGuided(b, ctx, { onRecord: (record) => learnInto(notebooks, accepts, record) });
  }
  const s = sync(accepts.claude);
  t.diagnostic(`the Scribe’s sync: ${s}%`);
  assert.ok(notebooks.claude.count > 60, `${notebooks.claude.count} notes`);
  assert.ok(s >= 80, `the Scribe’s sync is ${s}% (${accepts.claude})`);
});

// ---------------------------------------------------------------------------
// Drafting

test('a draft is per slot and never puts a habit into a slot it doesn’t fit', () => {
  const snap = snapshots({ level: 3, count: 12, seed: 7 });
  // A notebook whose strongest habit is the 2-action Letter on the most hurt ally, in every slot.
  const letter = abilityHash('letter');
  const base = snap.choices.filter((c) => c.id === 'claude');
  const bytes = [];
  let order = 0;
  for (const c of base) {
    for (const slot of [0, 1, 2]) {
      bytes.push(...encodeNote({ situation: c.situation, template: T['patch-lowest'], slot, cost: 2, relation: 2, ability: letter, weight: 2, order: order++ }));
      bytes.push(...encodeNote({ situation: c.situation, template: c.choice.template, slot, cost: 1, relation: c.choice.relation, ability: c.choice.ability, weight: 1, order: order++ }));
    }
  }
  const nb = createNotebook('claude', new Uint8Array(bytes));
  let checked = 0;
  for (const b of snap.battles) {
    const u = findUnit(b, 'claude');
    if (!u || u.offline) continue;
    const d = draftFor(nb, b, 'claude', snap.ctx);
    const ticks = ticksOf(d.plan, u);
    assert.ok(ticks.every((t) => !t.lost), 'every slot fits the round');
    d.plan.slots.forEach((a, slot) => {
      const t = ticks.find((x) => x.slot === slot);
      if (a.ability === 'letter') assert.ok(t.ends <= 3 && a.cost === 2);
    });
    assert.equal(d.why.filter((w) => typeof w.slot === 'number').length, d.plan.slots.length, 'a why for every slot');
    assert.ok(d.why.every((w) => w.text && ['rule', 'habit', 'personality', 'rail'].includes(w.layer)));
    checked += 1;
  }
  assert.ok(checked >= 10, `${checked} drafts checked`);
});

test('one correction teaches one slot: after one round of notes, the corrected slot drafts it and the others keep theirs', (t) => {
  const brace = (a) => ({ ...a, id: 'brace', ability: null, target: null, cost: 1, choice: null, extra: 0 });
  let taught = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const { heroes, notebooks, ctx } = levelOneMinds();
    const room = roomsFor(world, { level: 1, room: 'moderate', partySize: 2, seed, count: 1 })[0];
    const b = createBattle(room.fights[0], heroes, { roadLevel: 1 }, ctx);
    const draft = ctx.minds.draft(b, 'claude');
    // You change one slot (the first that isn't a Brace already) to a Brace, and accept the rest.
    const at = draft.plan.slots.findIndex((a) => a.id !== 'brace');
    if (at < 0 || draft.plan.slots.length < 3) continue;
    const mine = { ...draft.plan, slots: draft.plan.slots.map((a, i) => (i === at ? brace(a) : a)), by: 'draft' };
    const c = commit(b, { claude: mine, milo: ctx.minds.draft(b, 'milo').plan }, ctx);
    learnInto(notebooks, null, c.record);
    const kept = c.record.units.claude.choices;
    const next = draftFor(notebooks.claude, b, 'claude', ctx);
    next.choices.forEach((ch) => {
      if (!kept[ch.slot]) return;
      const where = `seed ${seed} slot ${ch.slot}: ${JSON.stringify(next.choices)} vs ${JSON.stringify(kept)}`;
      // The same situation: a slot drafted from habit drafts what you committed in that slot (one the
      // new plan can't reach falls to personality), and the Brace goes only where you put one.
      if (next.why[ch.slot].layer === 'habit') assert.equal(ch.template, kept[ch.slot].template, where);
      if (kept[ch.slot].template !== T.brace) assert.notEqual(ch.template, T.brace, where);
    });
    assert.equal(next.plan.slots[at].id, 'brace', `seed ${seed}: the corrected slot`);
    const keys = (list) => new Set(list.filter(Boolean).map((ch) => `${ch.template}:${ch.ability}`)).size;
    assert.ok(keys(next.choices) > 1 || keys(kept) === 1, `seed ${seed}: one habit in every slot ${JSON.stringify(next.choices)}`);
    taught += 1;
  }
  assert.ok(taught >= 6, `${taught} fights taught`);
  // Then one notebook over ten fights: you correct one slot to a Brace once, and accept every draft after.
  const { heroes, notebooks, ctx } = levelOneMinds();
  let corrected = null;
  for (let seed = 1; seed <= 10; seed += 1) {
    const room = roomsFor(world, { level: 1, room: 'moderate', partySize: 2, seed, count: 1 })[0];
    playGuided(createBattle(room.fights[0], heroes, { roadLevel: 1 }, ctx), ctx, {
      planFor: (bb, id) => {
        const d = ctx.minds.draft(bb, id);
        if (!d || id !== 'claude' || corrected !== null) return d?.plan || null;
        corrected = d.plan.slots.findIndex((a) => a.id !== 'brace');
        return { ...d.plan, slots: d.plan.slots.map((a, i) => (i === corrected ? brace(a) : a)) };
      },
      onRecord: (record) => learnInto(notebooks, null, record),
    });
  }
  const notes = decodeNoteAll(notebooks.claude.notes);
  const braced = notes.filter((n) => n.template === T.brace);
  const bySlot = [0, 1, 2, 3].map((s) => [braced.filter((n) => n.slot === s).length, notes.filter((n) => n.slot === s).length]);
  t.diagnostic(`corrected slot ${corrected}; braced in ${braced.length} of ${notes.length} notes (by slot ${bySlot.map(([a, n]) => `${a}/${n}`).join(', ')})`);
  // Before §18.3 the Brace took every slot (215 of 216 notes here); now it stays where you put it.
  assert.ok(braced.length / notes.length <= 0.5, `braced in ${braced.length} of ${notes.length} notes`);
  const [other, of] = bySlot[corrected === 0 ? 1 : 0];
  assert.ok(of > 5 && other / of <= 0.25, `slot ${corrected === 0 ? 1 : 0}, never corrected, braced in ${other} of ${of}`);
});

test('a habit wins over personality only at personality’s 35% or more', () => {
  const ctx = makeCtxReal();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 3 })] }), [hero('milo'), hero('claude')], {}, ctx);
  const s = situationOf(b, 'claude', ctx);
  // Seven notes in slot 0 at this very situation (closeness 1): a Brace in two or three of them, the rest split.
  const book = (templates) => createNotebook('claude', new Uint8Array(templates.flatMap((t, i) => [...encodeNote({ situation: s, template: t, slot: 0, cost: 1, relation: 1, order: i })])));
  const split = draftFor(book([T.seek, T['cool-down'], T.wait, T.seek, T['cool-down'], T.brace, T.brace]), b, 'claude', ctx);
  assert.equal(split.why[0].layer, 'personality', `two of seven (29%): ${split.why[0].text}`);
  const three = draftFor(book([T.seek, T['cool-down'], T.wait, T.seek, T.brace, T.brace, T.brace]), b, 'claude', ctx);
  assert.equal(three.why[0].layer, 'habit', 'three of seven (43%)');
  assert.equal(three.plan.slots[0].id, 'brace');
});

test('a draft’s why counts rounds, never notes, in words from one to nine', () => {
  assert.equal(habitWhy('braced', 1, 1), 'You braced in the one round like this.');
  assert.equal(habitWhy('braced', 2, 2), 'You braced in both rounds like this.');
  assert.equal(habitWhy('braced', 3, 3), 'You braced in all three rounds like this.');
  assert.equal(habitWhy('braced', 2, 7), 'You braced in two of seven rounds like this.');
  assert.equal(habitWhy('braced', 9, 12), 'You braced in nine of 12 rounds like this.');
  assert.equal(countWord(10), '10');
  const ctx = makeCtxReal();
  const b = createBattle(fightSpec({ foes: [stray('f0', { x: 12, y: 3 })] }), [hero('milo'), hero('claude')], {}, ctx);
  const s = situationOf(b, 'claude', ctx);
  const note = (template, slot, order, sit = s) => [...encodeNote({ situation: sit, template, slot, cost: 1, relation: 1, order })];
  // One round braced in slots 0 and 1: slot 2 has no notes of its own, so it borrows both, and that's one round, not two.
  const one = draftFor(createNotebook('claude', new Uint8Array([...note(T.brace, 0, 0), ...note(T.brace, 1, 1)])), b, 'claude', ctx);
  assert.equal(one.why[2].layer, 'habit');
  assert.equal(one.why[2].text, 'You braced in the one round like this.');
  assert.deepEqual([one.why[2].count, one.why[2].of], [1, 1]);
  // Three rounds in slot 0 (each a situation a step apart): braced in two of them.
  const near = (d) => Object.assign(s.slice(), { 9: Math.min(255, s[9] + d) });
  const three = draftFor(createNotebook('claude', new Uint8Array([...note(T.brace, 0, 0, near(1)), ...note(T.brace, 0, 1, near(2)), ...note(T.seek, 0, 2, near(3))])), b, 'claude', ctx);
  assert.equal(three.why[0].text, 'You braced in two of three rounds like this.');
  assert.deepEqual([three.why[0].count, three.why[0].of], [2, 3]);
});

test('a genre with no notes drafts at under 50% confidence, and a familiar one higher', () => {
  const snap = snapshots({ level: 3, count: 6, seed: 11 });
  const mine = snap.choices.filter((c) => c.id === 'claude');
  let lowest = 100;
  let familiar = 0;
  for (const b of snap.battles.slice(0, 12)) {
    if (findUnit(b, 'claude')?.offline) continue;
    const g = situationOf(b, 'claude', snap.ctx)[5];
    const other = mine.filter((c) => c.situation[5] !== g);
    const same = mine.filter((c) => c.situation[5] === g);
    const make = (list) => createNotebook('claude', new Uint8Array(list.flatMap((c, i) => [...encodeNote({ situation: c.situation, template: c.choice.template, slot: c.slot, cost: c.cost, relation: c.choice.relation, ability: c.choice.ability, order: i })])));
    // Notes only from other genres (made so by moving them to a genre this room doesn't have).
    const moved = mine.map((c) => ({ ...c, situation: Object.assign(c.situation.slice(), { 5: g === 12 ? 11 : 12 }) }));
    const d = draftFor(make(moved), b, 'claude', snap.ctx);
    assert.ok(d.confidence < 50, `confidence ${d.confidence} in a genre with no notes`);
    lowest = Math.min(lowest, d.confidence);
    if (same.length >= 7) familiar = Math.max(familiar, draftFor(make(same), b, 'claude', snap.ctx).confidence);
    assert.ok(other.length >= 0);
  }
  assert.ok(lowest < 50);
  assert.ok(familiar >= 50, `a familiar genre reaches ${familiar}`);
  // §7.2's arithmetic: seven notes a genre away are at least 33 apart.
  const a = situation(1);
  const b = a.slice();
  b[5] = (a[5] + 1) & 0xff;
  assert.equal(situationDistance(a, b), 33);
  assert.equal(situationDistance(a, a), 0);
});

test('the index returns exactly the brute-force 7 nearest over 1,000 random notebooks', () => {
  for (let i = 0; i < 1000; i += 1) {
    const n = randInt(260, i, 'n');
    const bytes = randomNotes(n, i, { genres: 1 + (i % 6) });
    const struck = [];
    let nb = createNotebook('x', bytes);
    if (i % 3 === 0 && n) {
      const hs = habits(nb);
      for (const h of hs.slice(0, 1 + (i % 4))) struck.push(h.key);
      nb = withNotebookMeta(nb, { struck });
    }
    // Sometimes an older version of a notebook that has grown since.
    if (i % 7 === 0 && n > 10) {
      const grown = addNotes(nb, randomNotes(20, i + 5000));
      assert.equal(grown.count, nb.count + 20);
    }
    const q = randomNotes(1, i + 9999, { genres: 1 + (i % 6) }).slice(0, 16);
    const near = nearestNotes(nb, q, [0, 1, 2, 3, 'any']);
    for (const pool of [0, 1, 2, 3, 'any']) {
      const want = bruteNearest(nb, q, pool).map((x) => [x.i, x.d]);
      const got = near.get(pool).map((x) => [x.i, x.d]);
      assert.deepEqual(got, want, `notebook ${i}, pool ${pool}`);
    }
  }
});

test('the same notebook, seed and fight give the same drafts, whether the notebook grew or was read back from its frames', () => {
  const snap = snapshots({ level: 2, count: 4, seed: 31, partySize: 3 });
  const bytes = jitteredNotes(snap.choices.filter((c) => c.id === 'jev'), 3000);
  const a = createNotebook('jev', bytes);
  const b = createNotebook('jev', unframe(frame(bytes, 1)).notes);
  let grown = createNotebook('jev', bytes.slice(0, 1500 * 24));
  grown = addNotes(grown, bytes.slice(1500 * 24));
  for (const battle of snap.battles) {
    if (findUnit(battle, 'jev')?.offline) continue;
    const d1 = draftFor(a, battle, 'jev', snap.ctx);
    assert.deepEqual(draftFor(a, battle, 'jev', snap.ctx), d1);
    assert.deepEqual(draftFor(b, battle, 'jev', snap.ctx), d1);
    assert.deepEqual(draftFor(grown, battle, 'jev', snap.ctx), d1);
  }
});

test('guard rails over 500 seeds: no draft aims at a sorted or offline foe or walks onto a surface that hurts right now', () => {
  const ctx = makeCtxReal();
  const HURTS = new Set(['candlefire', 'burning-oil', 'burning-foliage']);
  const choices = CHOICES.map((c) => c.id);
  for (let seed = 0; seed < 500; seed += 1) {
    const foes = [0, 1, 2].map((i) => stray(`f${i}`, {
      x: 6 + randInt(8, seed, i, 'x'), y: 1 + randInt(4, seed, i, 'y'), talkKind: `k${i}`, archetype: ['walker', 'crawler', 'floater'][i],
      integrity: i === 2 && seed % 2 ? 0 : 20,
    }));
    const surfaces = [];
    for (let k = 0; k < 8; k += 1) surfaces.push({ x: 2 + randInt(12, seed, k, 'sx'), y: 1 + randInt(4, seed, k, 'sy'), id: ['candlefire', 'burning-oil', 'burning-foliage'][k % 3], rounds: null });
    const fight = fightSpec({ foes, surfaces: surfaces.filter((s) => !foes.some((f) => f.post.x === s.x && f.post.y === s.y)), seed: hashInts(seed, 'fight') });
    const heroes = [hero('milo'), hero('claude'), hero('codex')];
    let b = createBattle(fight, heroes, {}, ctx);
    // A sorted foe (settled) and one offline-like: sorted units are never targets.
    if (seed % 2) b = { ...b, units: b.units.map((u) => (u.id === 'f2' ? { ...u, sorted: 'settled', integrity: 0 } : u)) };
    const notes = [];
    for (let i = 0; i < 40; i += 1) {
      const t = choices[randInt(choices.length, seed, i, 't')];
      notes.push(...encodeNote({ situation: situationOf(b, 'claude', ctx), template: t, slot: i % 3, cost: 1, relation: 0, ability: [0, abilityHash('letter'), abilityHash('full-stop')][i % 3], order: i }));
    }
    const nb = createNotebook('claude', new Uint8Array(notes));
    for (const id of ['claude', 'milo']) {
      const d = draftFor(nb, b, id, ctx);
      for (const a of d.plan.slots) {
        const ids = [a.target?.unit, ...(a.target?.units || [])].filter(Boolean);
        for (const tid of ids) {
          const v = findUnit(b, tid);
          if (v && v.side === 'foe') assert.ok(!v.sorted && !v.offline, `seed ${seed}: ${a.id} aims at ${tid}`);
        }
        for (const t of a.target?.path || []) {
          const s = b.surfaces.find((x) => x.x === t.x && x.y === t.y);
          assert.ok(!s || !HURTS.has(s.id), `seed ${seed}: ${id}’s path crosses ${s?.id} at ${t.x},${t.y}`);
        }
      }
    }
  }
});

test('a hot companion presses on with attacks; a cool one braces', () => {
  const ctx = makeCtxReal();
  const fight = fightSpec({ foes: [stray('f0', { x: 2, y: 1 }), stray('f1', { x: 12, y: 3, talkKind: 'k1' })] });
  const hot = createBattle(fight, [hero('milo'), hero('claude', { idleHeat: 70 })], {}, ctx);
  const cool = createBattle(fight, [hero('milo'), hero('claude', { idleHeat: 10 })], {}, ctx);
  const empty = createNotebook('claude');
  const dh = draftFor(empty, hot, 'claude', ctx);
  const dc = draftFor(empty, cool, 'claude', ctx);
  assert.ok(!dh.plan.slots.some((a) => a.id === 'brace'), `hot: ${dh.plan.slots.map((a) => a.id)}`);
  assert.ok(dc.plan.slots.some((a) => a.id === 'brace'), `cool: ${dc.plan.slots.map((a) => a.id)}`);
  assert.equal(dh.confidence, 35, 'personality alone drafts at 35');
  assert.equal(dh.source, 'personality');
});

test('playbook rules always win, read as sentences, and say so in the why', () => {
  const snap = snapshots({ level: 3, count: 6, seed: 13 });
  const rule = { if: 'anyone-below-half', then: 'patch-lowest' };
  const nb = withNotebookMeta(createNotebook('claude', jitteredNotes(snap.choices.filter((c) => c.id === 'claude'), 500)), { rules: [rule] });
  let fired = 0;
  // Every other snapshot with Milo hurt, so the rule has something to answer.
  const hurt = snap.battles.map((b, i) => (i % 2 ? b : { ...b, units: b.units.map((u) => (u.id === 'milo' && !u.offline ? { ...u, integrity: Math.max(1, Math.floor(u.maxIntegrity / 4)) } : u)) }));
  for (const b of hurt) {
    const u = findUnit(b, 'claude');
    if (!u || u.offline) continue;
    const s = situationOf(b, 'claude', snap.ctx);
    const d = draftFor(nb, b, 'claude', snap.ctx);
    const ruled = d.why.find((w) => w.layer === 'rule' && typeof w.slot === 'number');
    if (ruled) {
      fired += 1;
      assert.equal(d.plan.slots[ruled.slot].ability === 'letter' || d.plan.slots[ruled.slot].ability === 'salve' || d.plan.slots[ruled.slot].ability === 'kind-word'
        || d.plan.slots[ruled.slot].ability === 'three-pens' || d.plan.slots[ruled.slot].ability === 'cordial', true);
      assert.ok((s[2] & 3) > 0 || s[0] < 128, 'only when someone is below half');
      assert.match(ruled.text, /^Your rule: if anyone’s below half, patch the most hurt ally first\.$/);
    }
  }
  assert.ok(fired > 0, 'the rule fired in some round');
  assert.equal(ruleText(rule), 'If anyone’s below half, patch the most hurt ally first.');
  assert.equal(ruleText({ if: 'always', then: 'brace' }), 'Always brace.');
  assert.equal(ruleText({ if: 'nope', then: 'brace' }), '');
});

test('why lines and every phrase and rule word are calm', () => {
  for (const c of CHOICES) for (const [n, of] of [[1, 1], [2, 2], [3, 3], [3, 7], [9, 12]]) assertCalm(habitWhy(c.phrase, n, of), `choice ${c.key}`);
  for (const r of RULE_IFS) for (const t of RULE_THENS) assertCalm(ruleText({ if: r.id, then: t.id }), `rule ${r.id} → ${t.id}`, { proper: ['Tale-lead'] });
  const snap = snapshots({ level: 1, count: 3, seed: 5, partySize: 4 });
  const nb = createNotebook('jev', jitteredNotes(snap.choices.filter((c) => c.id === 'jev'), 300));
  for (const b of snap.battles) {
    if (findUnit(b, 'jev')?.offline) continue;
    for (const w of draftFor(nb, b, 'jev', snap.ctx).why) {
      assertCalm(w.text, `why ${w.layer}`, { proper: ['Jev', 'Tale-lead', 'Parting', 'Shoulder', 'Ready', 'Draw', 'Proofread', 'Tuck'] });
      for (const bad of COSY) assert.ok(!new RegExp(`\\b${bad}\\b`, 'i').test(w.text));
      assert.ok(!/\bI\b|\bI’m\b/.test(w.text), 'the planner’s voice, never Jev’s');
    }
  }
  // Unique ids and keys, relations in range.
  assert.equal(new Set(CHOICES.map((c) => c.id)).size, CHOICES.length);
  assert.equal(new Set(CHOICES.map((c) => c.key)).size, CHOICES.length);
  assert.ok(CHOICES.every((c) => c.id > 0 && c.id < 256 && c.relation >= 0 && c.relation <= 3));
});

test('habits list the page, strongest first, with a count, an of and the struck ones kept', () => {
  const nb = createNotebook('claude', randomNotes(500, 41));
  const list = habits(nb);
  assert.ok(list.length > 5);
  for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].strength >= list[i].strength);
  assert.equal(list.reduce((s, h) => s + h.count, 0), 500);
  assert.ok(list.every((h) => h.count <= h.of && /^\d{1,3}:\d{1,5}$/.test(h.key) && h.phrase));
  const struck = habits(withNotebookMeta(nb, { struck: [list[0].key] }));
  assert.equal(struck.length, list.length);
  assert.ok(struck.find((h) => h.key === list[0].key).struck);
  // An ability's name, with the index.
  const named = habits(createNotebook('c', encodeNote({ situation: situation(1), template: T['hit-weakest'], ability: abilityHash('full-stop') })), { abilities: world.abilities });
  assert.equal(named[0].phrase, 'struck the most hurt stray in reach (Full stop)');
});

test('situations read the battle as §5.10 lays it out', () => {
  const ctx = makeCtxReal();
  const fight = fightSpec({ genres: ['gothic'], foes: [stray('f0', { x: 3, y: 1, genre: 'gothic', temperament: 'proud' }), stray('f1', { x: 12, y: 3, talkKind: 'k1', genre: 'gothic' })] });
  const b = createBattle(fight, [hero('milo', { integrity: 9 }), hero('claude'), hero('codex')], {}, ctx);
  const s = situationOf(b, 'claude', ctx);
  assert.equal(s[0], 255, 'her own share');
  assert.equal(s[1], Math.round(255 * 9 / 18), 'the lowest ally (Milo)');
  assert.equal(s[2] & 3, 0, 'Milo is at half, not below');
  assert.equal(s[3] >> 5, 2, 'two foes standing');
  assert.equal(s[5], ctx.genres.indexOf('gothic') + 1);
  assert.equal(s[6] & 15, 9, 'the nearest foe is proud (index 8, + 1)');
  assert.equal((s[6] >> 4) & 7, 1, 'a stray');
  assert.equal(s[7], 25, 'her heat');
  assert.equal(s[8] & 15, 1, 'round 1');
  assert.equal((s[14] >> 6) & 3, 2, 'a party of three');
  assert.equal(s[15] & 3, 1, 'Long Road');
  assert.equal((s[15] >> 2) & 3, 0, 'a stray room');
  assert.equal(s[15] >> 4, 8, 'level 1 against a level-1 room');
  const t = s[4] & 7;
  assert.ok(t >= 0 && t <= 5);
});

test('situation bytes: the party is Unseen only when every standing hero is, and the level difference reads the Road level, not a Wayfarer’s own', () => {
  const ctx = makeCtxReal();
  const fight = fightSpec({ foes: [stray('f0', { x: 12, y: 3 })] });
  const hide = (b, ids) => ({ ...b, units: b.units.map((u) => (ids.includes(u.id) ? { ...u, conditions: [...u.conditions, { id: 'unseen', n: null, source: null, data: null }] } : u)) });
  const b = createBattle(fight, [hero('milo'), hero('claude'), hero('codex')], {}, ctx);
  assert.equal((situationOf(hide(b, ['claude']), 'milo', ctx)[8] >> 6) & 1, 0, 'one hiding hero isn’t the party');
  assert.equal((situationOf(hide(b, ['milo', 'claude']), 'milo', ctx)[8] >> 6) & 1, 0);
  assert.equal((situationOf(hide(b, ['milo', 'claude', 'codex']), 'milo', ctx)[8] >> 6) & 1, 1, 'everyone hidden is the party Unseen');
  // An Offline hero doesn't stop the rest being the party.
  const dozing = { ...hide(b, ['milo', 'claude']), units: hide(b, ['milo', 'claude']).units.map((u) => (u.id === 'codex' ? { ...u, offline: true, integrity: 0 } : u)) };
  assert.equal((situationOf(dozing, 'milo', ctx)[8] >> 6) & 1, 1);
  // A Wayfarer fighting at level 3 at Road level 1, in a level-1 room: the party is on level (8), whatever her own level.
  const way = createBattle(fight, [hero('milo'), hero('claude', { level: 3 })], { roadLevel: 1 }, ctx);
  assert.equal(situationOf(way, 'claude', ctx)[15] >> 4, 8);
  assert.equal(situationOf(way, 'milo', ctx)[15] >> 4, 8);
  const above = createBattle(fight, [hero('milo'), hero('claude', { level: 3 })], { roadLevel: 3 }, ctx);
  assert.equal(situationOf(above, 'claude', ctx)[15] >> 4, 10, 'Road level 3 against a level-1 room');
});

test('Ready, Dip and a rule to see to the room can all be drafted: Ready from Warding 10 with a trigger that fits, Dip only beside something to dip into, and the rule walks to what needs working', () => {
  const ctx = makeCtxReal();
  const far = fightSpec({ foes: [stray('f0', { x: 13, y: 4 })] });
  const ready = { template: T.ready, ability: 0, relation: 0 };
  const warded = createBattle(far, [hero('milo'), hero('claude')], { warding: 10 }, ctx);
  const r = resolveChoice(warded, 'milo', ready, 0, ctx);
  assert.equal(r?.id, 'ready');
  assert.equal(r.cost, 2);
  assert.equal(r.trigger, 'foe-enters-reach', 'nothing in reach: it waits for a stray to come in');
  assert.equal(resolveChoice(createBattle(far, [hero('milo'), hero('claude')], { warding: 9 }, ctx), 'milo', ready, 0, ctx), null, 'Ready needs Warding 10');
  assert.equal(resolveChoice(warded, 'milo', ready, 0, ctx, { left: 1 }), null, 'two actions or none');
  // A notebook of Readies drafts one, and B takes the plan.
  const s = situationOf(warded, 'milo', ctx);
  const notes = new Uint8Array(7 * NOTE_BYTES);
  for (let i = 0; i < 7; i += 1) notes.set(encodeNote({ situation: s, template: T.ready, slot: 0, cost: 2, relation: 0, order: i }), i * NOTE_BYTES);
  const d = draftFor(createNotebook('milo', notes), warded, 'milo', ctx);
  assert.equal(d.plan.slots[0].id, 'ready');
  assert.equal(d.why[0].layer, 'habit');
  assert.ok(!apply(warded, { t: 'plan', unitId: 'milo', plan: d.plan }, ctx).events.some((e) => e.t === 'refused'));
  // Dip: beside burning oil, yes; on a clean floor, no.
  const dip = { template: T.dip, ability: 0, relation: 1 };
  assert.equal(resolveChoice(warded, 'milo', dip, 0, ctx), null);
  const oily = createBattle(fightSpec({ foes: [stray('f0', { x: 13, y: 4 })], surfaces: [{ x: 2, y: 1, id: 'burning-oil', rounds: 2 }] }), [hero('milo'), hero('claude')], {}, ctx);
  const m = findUnit(oily, 'milo');
  assert.ok(Math.max(Math.abs(m.x - 2), Math.abs(m.y - 1)) <= 1, `Milo at ${m.x},${m.y}`);
  assert.equal(resolveChoice(oily, 'milo', dip, 0, ctx)?.id, 'dip');
  // "If a lamp or candle is out, see to the room first": with the lamp across the room, the rule walks there first.
  const lamp = { id: 'o0', kind: 'lamp', x: 9, y: 2, state: 'dark', flags: [], integrity: null };
  const dark = createBattle(fightSpec({ foes: [stray('f0', { x: 13, y: 4 })], objects: [lamp] }), [hero('milo'), hero('claude')], {}, ctx);
  const nb = withNotebookMeta(createNotebook('claude'), { rules: [{ if: 'lights-out', then: 'light-it' }] });
  const walk = draftFor(nb, dark, 'claude', ctx);
  assert.equal(walk.why[0].layer, 'rule');
  assert.equal(walk.plan.slots[0].id, 'stride');
  const end = walk.plan.slots[0].target.path.at(-1);
  assert.ok(Math.max(Math.abs(end.x - lamp.x), Math.abs(end.y - lamp.y)) < Math.max(Math.abs(findUnit(dark, 'claude').x - lamp.x), Math.abs(findUnit(dark, 'claude').y - lamp.y)), 'closer to the lamp');
  // The draft names what the action reads as (here closing in, since the lamp stands toward the stray), never "worked something".
  assert.equal(walk.choices[0].template, choiceOf(dark, 'claude', walk.plan.slots[0], 0, ctx).template);
  assert.notEqual(walk.choices[0].template, T['work-object']);
  // Beside it: an Interact.
  const beside = { ...dark, units: dark.units.map((u) => (u.id === 'claude' ? { ...u, x: 8, y: 2 } : u)) };
  const lit = draftFor(nb, beside, 'claude', ctx);
  assert.equal(lit.plan.slots[0].id, 'interact');
  assert.equal(lit.plan.slots[0].target.object, 'o0');
});

test('the bell and the riddle board aren’t worked by hand (their bows are mech: actions), so “worked something in the room” leaves them be (§18.3)', () => {
  const ctx = makeCtxReal();
  assert.equal(workable({ kind: 'bell', state: 'still' }), false);
  assert.equal(workable({ kind: 'riddle-board', state: 'idle' }), false);
  assert.equal(workable({ kind: 'lever', state: 'up' }), true);
  const work = { template: T['work-object'], ability: 0, relation: 0 };
  const room = (kind, state) => {
    const b = createBattle(fightSpec({ foes: [stray('f0', { x: 13, y: 4 })], objects: [{ id: 'o0', kind, x: 9, y: 2, state, flags: [], integrity: null }] }), [hero('milo'), hero('claude')], {}, ctx);
    return { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, x: 8, y: 2 } : u)) };
  };
  for (const [kind, state] of [['bell', 'still'], ['riddle-board', 'idle']]) {
    const b = room(kind, state);
    assert.equal(resolveChoice(b, 'claude', work, 0, ctx), null, `${kind}: no Interact beside it`);
    // A rule to see to the room doesn't walk to one either, and a notebook of the habit drafts no Interact there.
    assert.equal(resolveChoice(b, 'claude', { ...work, any: true }, 0, ctx), null, `${kind}: no walk to it`);
    const s = situationOf(b, 'claude', ctx);
    const notes = new Uint8Array(7 * NOTE_BYTES);
    for (let i = 0; i < 7; i += 1) notes.set(encodeNote({ situation: s, template: T['work-object'], slot: 0, cost: 1, relation: 0, order: i }), i * NOTE_BYTES);
    const d = draftFor(createNotebook('claude', notes), b, 'claude', ctx);
    assert.ok(!d.plan.slots.some((a) => a.id === 'interact' && a.target?.object === 'o0'), `${kind}: ${JSON.stringify(d.plan.slots.map((a) => a.id))}`);
  }
  // A lever there is still worked.
  assert.deepEqual(resolveChoice(room('lever', 'up'), 'claude', work, 0, ctx)?.target, { object: 'o0' });
});

test('why lines and the eye’s words read in the second person: no phrase says “itself”, “its own” or “it hadn’t”', () => {
  for (const c of CHOICES) {
    const line = habitWhy(c.phrase, 5, 7);
    assert.ok(!/\bitself\b|\bits own\b|\bit hadn’t\b|\bit had\b/.test(line), line);
  }
  assert.equal(CHOICES.find((c) => c.key === 'help-self').phrase, 'shored up');
  assert.equal(CHOICES.find((c) => c.key === 'examine-new').phrase, 'examined a new stray');
  assert.equal(CHOICES.find((c) => c.key === 'self-use').phrase, 'used a special move');
});

test('choices round-trip: a resolved habit classifies as itself for the common moves', () => {
  const snap = snapshots({ level: 3, count: 5, seed: 21 });
  let same = 0;
  let total = 0;
  for (const b of snap.battles) {
    for (const id of ['milo', 'claude', 'jev', 'tollkeeper']) {
      const u = findUnit(b, id);
      if (!u || u.offline) continue;
      const plan = scriptedPlan(b, id, snap.ctx);
      const cs = choicesOf(b, id, plan, snap.ctx);
      cs.forEach((c, slot) => {
        if (!c || ![T['close-in'], T['hit-weakest'], T.brace, T['patch-lowest']].includes(c.template)) return;
        const partial = { ...plan, slots: plan.slots.slice(0, slot) };
        const a = resolveChoice(b, id, { ...c, cost: plan.slots[slot].cost }, slot, snap.ctx, { plan: partial });
        if (!a) return;
        total += 1;
        const back = choiceOf(b, id, a, slot, snap.ctx, { plan: partial });
        if (back && back.template === c.template && back.ability === c.ability) same += 1;
      });
    }
  }
  assert.ok(total > 50);
  assert.ok(same / total >= 0.95, `${same} of ${total}`);
});

test('replaying a fight drafted from a real empty notebook gives the same battle, under any drafting minds', () => {
  const heroes = partyAt(world, 1, 3);
  for (let seed = 1; seed <= 25; seed += 1) {
    const room = roomsFor(world, { level: 1, room: 'moderate', partySize: 3, seed, count: 1 })[0];
    const notebooks = Object.fromEntries(heroes.map((h) => [h.id, createNotebook(h.id)]));
    const ctx = ctxFor(world, heroes, { notebooks });
    const other = ctxFor(world, heroes, { scripted: true });
    let b = createBattle(room.fights[0], heroes, { roadLevel: 1 }, ctx);
    const commands = [];
    const send = (cmd) => {
      commands.push(cmd);
      b = apply(b, cmd, ctx).battle;
    };
    let guard = 0;
    while (!TERMINAL.has(b.status) && guard < 2000 && b.round <= 12) {
      guard += 1;
      if (b.status === 'planning') {
        for (const h of heroes) {
          if (findUnit(b, h.id)?.offline) continue;
          const d = ctx.minds.draft(b, h.id);
          send({ t: 'plan', unitId: h.id, plan: d.plan, draft: { confidence: d.confidence, source: d.source, choices: d.choices, layers: d.why.filter((w) => typeof w.slot === 'number').map((w) => w.layer) } });
        }
        send({ t: 'commit' });
      } else if (b.status === 'asking') send({ t: 'answer', yes: true });
      else send({ t: 'step' });
    }
    let r = createBattle(room.fights[0], heroes, { roadLevel: 1 }, other);
    for (const cmd of commands) r = apply(r, cmd, other).battle;
    assert.deepEqual(saveBattle(r), saveBattle(b), `seed ${seed}`);
  }
});

test('budgets: a 50,000-note notebook drafts in ≤ 0.5 ms (median) and builds its index from bytes in ≤ 50 ms', () => {
  const snap = snapshots({ level: 3, count: 10, seed: 99 });
  const bytes = jitteredNotes(snap.choices.filter((c) => c.id === 'claude'), 50000);
  const builds = [];
  let nb = null;
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    nb = createNotebook('claude', bytes);
    builds.push(performance.now() - t0);
  }
  builds.sort((a, b) => a - b);
  assert.equal(nb.count, 50000);
  assert.ok(builds[2] <= 50, `index build ${builds[2].toFixed(1)} ms`);
  const battles = snap.battles.filter((b) => !findUnit(b, 'claude')?.offline);
  // Also a room in a genre the notebook has never seen.
  const fresh = battles.map((b) => ({ ...b, genres: ['backhalls'] }));
  const all = [...battles, ...fresh.slice(0, 10)];
  const ms = medianMs((i) => draftFor(nb, all[i % all.length], 'claude', snap.ctx), { warm: 30, runs: 300 });
  assert.ok(ms <= 0.5, `draft ${ms.toFixed(3)} ms`);
});
