// Party tests (C, CONTRACT-PHASE4.md §4.7, §4.11–§4.14, §4.18–§4.19, §5.2, §7.5): heroes' specs
// level by level (every Wayfarer feature to 12 and every path feature has its own test), the Road
// level and its cap, work levels, warmth, Cheers, rests, paying fights and stitches once, regulars,
// the muster, and the notebooks' state.
//   node --test tests/party.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import * as party from '../src/party.js';
import { emptyState4, normalize4 } from '../src/state4.js';
import { xpForLevel } from '../src/lifeskills.js';
import { loadRules } from '../src/combat/rules.js';
import { assertCalm } from './calm.js';

const ROOT = new URL('../content/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const rulesJson = read('combat/rules.json');
const rules = loadRules(rulesJson);
const content = {
  genres: read('genres.json'),
  riftgen: read('riftgen.json'),
  combat: { rules: rulesJson, callings: read('combat/callings.json'), spells: read('combat/spells.json'), leads: read('combat/leads.json'), foes: read('combat/foes.json') },
  party: {
    companions: Object.fromEntries(readdirSync(new URL('party/companions/', ROOT)).map((f) => [f.slice(0, -5), read(`party/companions/${f}`)])),
    regulars: read('party/regulars.json'), teamups: read('party/teamups.json'), banter: read('party/banter.json'),
  },
};
const opts = { content, rules };

const NOW = new Date(2026, 8, 29, 12, 0).getTime(); // a Tuesday; the week began on Monday the 28th
const DAY = 24 * 60 * 60 * 1000;
const ROAD_XP = rules.road.xp;
const WORK = rules.work;

/** A fresh state with Phase 3's sections as the party code reads them. */
function makeState({ tier = 1, road = 1, byCrew = {}, warding = 0, real = 0, tonics = { cordial: 0, brew: 0 }, essences = {} } = {}) {
  const s4 = emptyState4();
  const genres = Object.fromEntries(Object.keys(essences).map((name) => [name, name.split(' ')[0].toLowerCase()]));
  return {
    ...s4,
    settings: { eveningBell: '22:00' },
    tally: { sessionsFinished: 0, finishedIds: [], byCrew: { claude: 0, codex: 0, jev: 0, whisper: 0, ...byCrew }, features: {} },
    hearth: { tier },
    satchel: { materials: {}, essences, essenceGenres: genres, relics: [], marks: 0, tonics },
    story: { trails: {}, facts: {} },
    rifts: { stitched: { real, wild: 0, story: 0 } },
    road: { ...s4.road, xp: ROAD_XP[road - 1] },
    xp: { ...s4.xp, skills: warding ? { warding: xpForLevel(warding) } : {} },
  };
}
const withMember = (state, id, patch) => ({ ...state, party: { ...state.party, roster: { ...state.party.roster, [id]: { ...state.party.roster[id], ...patch } } } });
const spec = (state, id, extra = {}) => party.heroSpec(state, id, { ...opts, now: NOW, ...extra });
const WON = { outcome: 'won', bow: false, auto: false };

// ---------------------------------------------------------------------------
// Integrity, defences and the Road level

test('Milo’s Integrity is 18 at level 1 and 64 at level 5, and his spec reads as COMBAT §5.4 says', () => {
  const one = spec(makeState(), 'milo');
  assert.equal(one.maxIntegrity, 18);
  assert.equal(one.integrity, 18);
  const five = spec(makeState({ tier: 2, road: 5 }), 'milo');
  assert.equal(five.level, 5);
  assert.equal(five.maxIntegrity, 64);
  assert.equal(one.speed, 4, 'Small: Speed 4');
  assert.equal(one.guard, 0, 'Guard 0 in his raincoat');
  assert.deepEqual(one.resolve, { body: 0, mind: 2 });
  assert.equal(one.keyAdjust, 0, 'Heed +3 is his key');
  assert.equal(one.idleHeat, 20);
  assert.equal(one.strike.amount, 5, 'a light weapon: the Strike line less 2');
  assert.equal(one.strike.kind, 'plain', 'a Strike is Plain for weapons (COMBAT §3.4); Light is his spells’ kind');
  assert.deepEqual(one.charges, { pool: 'three-quarter', max: 2, left: 2, circle: 1 });
  assert.deepEqual(one.carry, { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] });
  assert.ok(Object.isFrozen(one) && Object.isFrozen(one.abilities), 'the spec is frozen');
  for (const id of ['hooklight', 'raise-lantern', 'stand-in-my-light', 'mote', 'flare', 'tripping-cut', 'cordial', 'brew-of-clear-morning']) assert.ok(one.abilityIds.includes(id), id);
  assert.ok(!one.abilityIds.includes('scarf'), 'Scarf waits for level 2');
  assert.equal(one.reactions['stand-in-my-light'], 'under-half');
  assert.equal(one.reactions['parting-swipe'], 'always');
  assert.equal(one.uses['stand-in-my-light'], 2);
  assert.equal(five.uses['stand-in-my-light'], 3);
  assert.ok(five.abilityIds.includes('the-lantern-calls'));
});

test('Strikes are Plain for weapons, spells keep each hero’s own kind, and residents and regulars strike in their genre’s kind', async () => {
  const { casterKind } = await import('../src/combat/round.js');
  const state = party.recruit(makeState({ tier: 2 }), 'tollkeeper', NOW, { content });
  const own = { milo: 'light', claude: 'ink', codex: 'spark', jev: 'plain', tollkeeper: 'plain' };
  for (const [id, kind] of Object.entries(own)) {
    const s = spec(state, id);
    assert.equal(s.strike.kind, 'plain', `${id}’s Strike is Plain (COMBAT §3.4, §5.1)`);
    assert.equal(casterKind(s, rules), kind, `${id}’s spells and knacks still deal ${kind} (B’s caster kind)`);
  }
  // Residents deal their genre's kind with their Strikes too (COMBAT §3.7: Pip's Strikes deal Warp).
  const pip = spec(withMember(state, 'pip', {}), 'pip');
  assert.equal(pip.strike.kind, 'warp');
});

test('only Milo’s spec carries the party’s tonics; the Scribe her Margin Notes and the Artificer their Spare Parts', () => {
  let state = party.recruit(makeState({ tonics: { cordial: 3, brew: 2 } }), 'tollkeeper', NOW, { content });
  state = withMember(state, 'claude', { gifts: { margin: 2, spare: 3, through: 0 } });
  state = withMember(state, 'codex', { gifts: { margin: 3, spare: 1, through: 0 } });
  assert.deepEqual(spec(state, 'milo').carry, { cordial: 3, brew: 2, margin: 0, spare: 0, essences: 0, stitched: [] });
  assert.deepEqual(spec(state, 'claude').carry, { cordial: 0, brew: 0, margin: 2, spare: 0, essences: 0, stitched: [] });
  assert.deepEqual(spec(state, 'codex').carry, { cordial: 0, brew: 0, margin: 0, spare: 1, essences: 0, stitched: [] });
  for (const id of ['jev', 'tollkeeper']) assert.deepEqual(spec(state, id).carry, { cordial: 0, brew: 0, margin: 0, spare: 0, essences: 0, stitched: [] }, id);
});

test('Grace 3 adds 1 Guard only in no or light armour, and Guard never passes 2', () => {
  assert.equal(spec(makeState(), 'jev').guard, 1, 'Jev: light armour 0, +1 for Grace 3');
  const inMail = (armour) => {
    const callingsFile = { ...content.combat.callings, callings: content.combat.callings.callings.map((c) => (c.id === 'skirmisher' ? { ...c, armour } : c)) };
    return { ...content, combat: { ...content.combat, callings: callingsFile } };
  };
  assert.equal(party.heroSpec(makeState(), 'jev', { content: inMail('mail'), rules }).guard, 1, 'in mail: mail’s 1, and no +1 for Grace');
  assert.equal(party.heroSpec(makeState(), 'jev', { content: inMail('plate'), rules }).guard, 2, 'in plate: plate’s 2, never 3');
  assert.equal(party.heroSpec(makeState(), 'jev', { content: inMail('none'), rules }).guard, 1, 'in none: +1 for Grace');
});

test('every hero’s spec has exactly §5.2’s fields in order, and a Warden wears plate from Road level 5', () => {
  const keys = ['id', 'side', 'name', 'kind', 'talkKind', 'rank', 'level', 'size', 'small', 'archetype', 'genres', 'temperament', 'calling', 'path',
    'abilities', 'maxIntegrity', 'integrity', 'guard', 'resolve', 'speed', 'moves', 'strike', 'ranged', 'keyAdjust', 'flat', 'attackEdge', 'resist',
    'weak', 'ignores', 'idleHeat', 'shield', 'charges', 'abilityIds', 'uses', 'reactions', 'control', 'adapt', 'rattled', 'lead', 'post', 'look', 'carry'];
  let state = party.recruit(makeState({ tier: 2, road: 4 }), 'tollkeeper', NOW, { content });
  for (const id of ['milo', 'claude', 'codex', 'jev', 'tollkeeper']) assert.deepEqual(Object.keys(spec(state, id)), keys, id);
  assert.equal(spec(state, 'tollkeeper').guard, 1, 'mail at Road level 4');
  state = { ...state, road: { ...state.road, xp: ROAD_XP[4] } };
  const toll = spec(state, 'tollkeeper');
  assert.equal(toll.guard, 2, 'plate from Road level 5');
  assert.equal(toll.maxIntegrity, 70 + 4, 'Sturdy 70 at 5, Grit +2');
  assert.equal(toll.idleHeat, 15);
  assert.equal(toll.shield, true);
  assert.equal(toll.strike.amount, 13, 'a standard weapon: the Strike line');
  const jev = spec(state, 'jev');
  assert.equal(jev.speed, 7, 'a flier at 6, +1 for Grace 3');
  assert.equal(jev.guard, 1, 'Grace 3 in light armour');
  assert.ok(jev.moves.flies);
  assert.equal(jev.idleHeat, 50);
});

test('a Warden’s plate follows the level a BattleSave pins, so a Road level that rises mid-pause waits for the fight’s end (§5.4)', async () => {
  const at5 = party.recruit(makeState({ tier: 2, road: 5 }), 'tollkeeper', NOW, { content });
  assert.equal(spec(at5, 'tollkeeper').guard, 2, 'plate at Road level 5');
  const pinned = spec(at5, 'tollkeeper', { level: 4 });
  assert.deepEqual([pinned.level, pinned.guard], [4, 1], 'mail at the pinned level 4, as the fight began');
  // A construct regular is a Warden too.
  const r = party.inviteRegular(at5, { rift: rift(81, [STRAY('iron', 'shy', { archetype: 'construct' })]) }, NOW, opts);
  assert.equal(r.regular.calling, 'warden');
  assert.equal(spec(r.state, r.regular.id).guard, 2);
  assert.equal(spec(r.state, r.regular.id, { level: 4 }).guard, 1);
  // Through B: a fight saved at Road level 4 and restored after the level reached 5 keeps Guard 1.
  const { saveBattle, restoreBattle } = await import('../src/combat/battle.js');
  const k = await kernel();
  const at4 = { ...r.state, road: { ...r.state.road, xp: ROAD_XP[3] }, party: { ...r.state.party, chosen: ['tollkeeper', r.regular.id] } };
  const fight = k.kit.fightSpec({ foes: [k.kit.stray('f0', { x: 13, y: 4 })] });
  const begun = k.kit.createBattle(fight, party.partySpecs(at4, { ...opts, abilities: k.index }), { roadLevel: 4 }, k.ctx);
  const save = saveBattle(begun);
  const later = { ...at4, road: { ...at4.road, xp: ROAD_XP[4] } };
  const back = restoreBattle(save, k.ctx, { fight, heroes: party.partySpecs(later, { ...opts, abilities: k.index, levels: save.levels }) });
  assert.ok(back, 'the save restores');
  for (const id of ['tollkeeper', r.regular.id]) {
    assert.equal(k.unit(begun, id).guard, 1, `${id} began in mail`);
    assert.equal(k.unit(back, id).guard, 1, `${id} comes back in mail`);
    assert.equal(k.unit(back, id).level, 4);
  }
});

test('the Road level caps by the Hearth’s tier, XP past the cap counts when it rises, and levels never drop', () => {
  const capped = makeState({ tier: 1, road: 5 });
  assert.deepEqual(party.roadLevel(capped, rules), { level: 3, cap: 3, xp: ROAD_XP[4], next: ROAD_XP[3], capped: true });
  const raised = { ...capped, hearth: { tier: 2 } };
  assert.equal(party.roadLevel(raised, rules).level, 5, 'the kept XP counts the moment the cap rises');
  assert.equal(party.roadLevel(raised, rules).capped, false);
  assert.equal(party.roadLevel(makeState({ tier: 7, road: 12 }), rules).next, null);
  // Levels never drop: XP only rises, and a level already shown holds even if the cap were to fall.
  const shown = party.showLevel(raised, 5, NOW);
  assert.equal(party.roadLevel({ ...shown, hearth: { tier: 1 } }, rules).level, 5);
  assert.equal(party.showLevel(shown, 4, NOW), shown, 'levelShown only rises');
  let state = makeState({ tier: 2 });
  let last = 1;
  for (let i = 0; i < 40; i += 1) {
    state = party.payFight(state, `fight:rift:x:w:r${i}`, { weight: 10, n: 5, deepRank: 0 }, WON, NOW, { rules }).state;
    const now = party.roadLevel(state, rules).level;
    assert.ok(now >= last, 'never drops');
    last = now;
  }
  assert.equal(last, 5);
});

test('work levels follow §4.14’s table, and past 12 each level needs 140 more pieces', () => {
  const want = [[0, 1], [4, 1], [5, 2], [15, 3], [30, 4], [50, 5], [80, 6], [120, 7], [170, 8], [230, 9], [300, 10], [400, 11], [520, 12], [659, 12], [660, 13], [800, 14]];
  for (const [pieces, level] of want) assert.equal(party.workLevel(pieces, rules), level, `${pieces} pieces`);
});

test('a Wayfarer’s fighting level is never below their work level, and Jev fights at the Road level', () => {
  for (const road of [1, 2, 3, 4, 5]) {
    for (const pieces of [0, 5, 15, 30, 50, 170, 520, 900]) {
      const state = makeState({ tier: 2, road, byCrew: { claude: pieces, codex: pieces, jev: pieces } });
      for (const id of ['claude', 'codex']) {
        const level = party.fightingLevel(state, id, rules);
        assert.ok(level >= party.workLevel(pieces, rules), `${id} at ${pieces} pieces, Road ${road}`);
        assert.equal(level, Math.max(party.workLevel(pieces, rules), road - 1));
      }
      assert.equal(party.fightingLevel(state, 'jev', rules), road, 'Jev’s pieces wait for Phase 7');
      assert.equal(party.fightingLevel(state, 'milo', rules), road);
    }
  }
});

test('a likeness has identical stats and the same notebook, and the muster says so with the session title only', () => {
  const state = makeState({ byCrew: { claude: 30 } });
  const working = { sessions: [{ id: 'claude:1', agent: 'claude', status: 'working', archived: false, title: 'MILO plan', lastMessage: 'secret words' }], sources: { claude: { ok: true }, codex: { ok: true } } };
  const idle = { sessions: [{ id: 'claude:1', agent: 'claude', status: 'needs-you', archived: false, title: 'MILO plan' }], sources: { claude: { ok: true }, codex: { ok: true } } };
  const away = spec(state, 'claude', { snapshot: working });
  const here = spec(state, 'claude', { snapshot: idle });
  assert.equal(away.look.likeness, 'clay');
  assert.equal(here.look.likeness, null, 'needs-you is idle: she comes herself');
  assert.deepEqual({ ...away, look: null }, { ...here, look: null }, 'identical stats');
  assert.equal(away.id, here.id, 'the same notebook (it’s keyed by her id)');
  assert.equal(party.crewStateOf(working, 'claude'), 'working');
  assert.equal(party.crewStateOf(idle, 'claude'), 'idle');
  assert.equal(party.crewStateOf(null, 'claude'), 'unknown');
  assert.equal(party.crewStateOf({ sessions: [], sources: { claude: { ok: false } } }, 'claude'), 'unknown');
  // An archived session isn't work in progress, even if its last status said working.
  const archived = { ...working, sessions: [{ ...working.sessions[0], archived: true }] };
  assert.equal(party.crewStateOf(archived, 'claude'), 'idle');
  assert.equal(spec(state, 'claude', { snapshot: archived }).look.likeness, null);
  assert.equal(party.musterView(state, { ...opts, snapshot: archived }).members.find((m) => m.id === 'claude').likeness, null);
  const both = { ...working, sessions: [{ ...working.sessions[0], id: 'claude:0', archived: true, title: 'Old notes' }, working.sessions[0]] };
  assert.equal(party.musterView(state, { ...opts, snapshot: both }).members.find((m) => m.id === 'claude').likeness, 'Claude is working on ‘MILO plan’. Her likeness will go.', 'the title is the live session’s, never an archived one’s');
  const view = party.musterView(state, { ...opts, snapshot: working, now: NOW });
  const scribe = view.members.find((m) => m.id === 'claude');
  assert.equal(scribe.likeness, 'Claude is working on ‘MILO plan’. Her likeness will go.');
  assert.ok(!JSON.stringify(view).includes('secret words'), 'never the session’s message');
  assertCalm(scribe.likeness, 'likeness line');
  const codexWorking = { sessions: [{ id: 'codex:1', agent: 'codex', status: 'working', title: 'Fix the gate' }], sources: { claude: { ok: true }, codex: { ok: true } } };
  assert.equal(party.musterView(state, { ...opts, snapshot: codexWorking }).members.find((m) => m.id === 'codex').likeness, 'Codex is working on ‘Fix the gate’. Their likeness will go.');
});

// ---------------------------------------------------------------------------
// Every Wayfarer feature to level 12, and every path feature, on heroSpec

/** A Wayfarer (or Jev) at a fighting level: work pieces for the Scribe and the Artificer, the Road level for Jev. */
function atLevel(id, level, path = null) {
  let state = id === 'jev' ? makeState({ tier: 7, road: level }) : makeState({ byCrew: { [id]: WORK[level - 1] } });
  if (path) state = withMember(state, id, { path });
  return state;
}

const WAYFARER_FEATURES = [
  ['claude', 'pages', 1], ['claude', 'proofread', 1], ['claude', 'turn-back-a-page', 2], ['claude', 'two-sustained', 10],
  ['codex', 'bench-drone', 1], ['codex', 'drone-order', 1], ['codex', 'pop-up-cover', 1], ['codex', 'quick-fix', 1], ['codex', 'tune-ups', 2], ['codex', 'two-drones', 10],
  ['jev', 'unseen-strike', 1], ['jev', 'slip', 2], ['jev', 'tuck-and-roll', 5], ['jev', 'quick-feet', 7], ['jev', 'swipe-strike', 10],
];
const WHO = { claude: 'the Scribe', codex: 'the Artificer', jev: 'Jev' };

for (const [id, feature, from] of WAYFARER_FEATURES) {
  test(`${WHO[id]} gains ${feature} at level ${from} and keeps it to 12`, () => {
    for (let level = 1; level <= 12; level += 1) {
      const s = spec(atLevel(id, level), id);
      assert.equal(s.level, level);
      assert.equal(s.abilityIds.includes(feature), level >= from, `${feature} at level ${level}`);
    }
  });
}

test('the Wayfarers’ counted features grow by level: Proofread 2/3/4, Turn back a page twice from 7, Pop-up cover three from 7, Quick fix Wit times', () => {
  const uses = (id, level, ability) => spec(atLevel(id, level), id).uses[ability];
  assert.deepEqual([1, 4, 5, 8, 9, 12].map((l) => uses('claude', l, 'proofread')), [2, 2, 3, 3, 4, 4]);
  assert.deepEqual([2, 6, 7, 12].map((l) => uses('claude', l, 'turn-back-a-page')), [1, 1, 2, 2]);
  assert.deepEqual([1, 6, 7, 12].map((l) => uses('codex', l, 'pop-up-cover')), [2, 2, 3, 3]);
  assert.equal(uses('codex', 1, 'quick-fix'), 3, 'Wit +3');
  assert.equal(spec(atLevel('claude', 1), 'claude').reactions.proofread, 'ask');
  assert.equal(spec(atLevel('claude', 1), 'claude').reactions.shoulder, 'always', 'her own default over §4.4’s');
  // Boons at 4, 8 and 12 wait as choices.
  assert.equal(party.pendingChoices(atLevel('codex', 3), 'codex', opts).some((c) => c.kind === 'boon'), false);
  assert.equal(party.pendingChoices(atLevel('codex', 4, 'bench'), 'codex', opts).some((c) => c.kind === 'boon'), true);
});

const PATH_FEATURES = [
  ['claude', 'three-pens', 'three-pens', 3], ['claude', 'three-pens', 'three-pens-second-draft', 6], ['claude', 'three-pens', 'three-pens-fair-copy', 11],
  ['claude', 'footnote', 'footnote', 3], ['claude', 'footnote', 'footnote-small-print', 6], ['claude', 'footnote', 'footnote-appendix', 11],
  ['codex', 'bench', 'bench', 3], ['codex', 'bench', 'bench-tool-belt', 6], ['codex', 'bench', 'bench-workshop', 11],
  ['codex', 'slate', 'slate', 3], ['codex', 'slate', 'slate-clean-build', 6], ['codex', 'slate', 'slate-clean-slate', 11],
  ['jev', 'gavel', 'gavel', 3], ['jev', 'gavel', 'gavel-ruling', 6], ['jev', 'gavel', 'gavel-last-word', 11],
  ['jev', 'courier', 'courier', 3], ['jev', 'courier', 'courier-express', 6], ['jev', 'courier', 'courier-return-post', 11],
];

for (const [id, path, feature, from] of PATH_FEATURES) {
  test(`${WHO[id]}’s ${path} path brings ${feature} at level ${from}, and only on that path`, () => {
    const other = content.party.companions[id].paths.find((p) => p !== path);
    for (let level = 3; level <= 12; level += 1) {
      assert.equal(spec(atLevel(id, level, path), id).abilityIds.includes(feature), level >= from, `${feature} at ${level}`);
      assert.equal(spec(atLevel(id, level, other), id).abilityIds.includes(feature), false, `not on ${other}`);
    }
  });
}

test('the Tollkeeper’s Bridge and Troll-kin bring their feature at 3, shift his idle heat, and keep 6 and 11 for later', () => {
  const at = (path, road) => {
    const state = party.recruit(makeState({ tier: 2, road }), 'tollkeeper', NOW, { content });
    return spec(withMember(state, 'tollkeeper', { path }), 'tollkeeper');
  };
  assert.ok(at('bridge', 3).abilityIds.includes('bridge'));
  assert.ok(!at('bridge', 3).abilityIds.includes('troll-kin'));
  assert.ok(at('troll-kin', 3).abilityIds.includes('troll-kin'));
  assert.equal(at('bridge', 3).idleHeat, 10, 'Bridge runs 5 cooler');
  assert.equal(at('troll-kin', 3).idleHeat, 20, 'Troll-kin runs 5 warmer');
  assert.equal(at('bridge', 2).idleHeat, 15, 'no path before level 3');
  for (const stub of ['bridge-hold-fast', 'bridge-all-cross', 'troll-kin-stone', 'troll-kin-old-stories']) {
    assert.ok(!at('bridge', 5).abilityIds.includes(stub) && !at('troll-kin', 5).abilityIds.includes(stub), `${stub} waits`);
  }
});

test('Jev’s paths shift its idle heat by 10 either way, and Milo’s three paths bring their rules', () => {
  assert.equal(spec(atLevel('jev', 3, 'gavel'), 'jev').idleHeat, 60);
  assert.equal(spec(atLevel('jev', 3, 'courier'), 'jev').idleHeat, 40);
  const milo = (path) => spec(withMember(makeState({ road: 3 }), 'milo', { path }), 'milo');
  assert.ok(milo('hearth').abilityIds.includes('hearth-path'));
  assert.ok(milo('wick').abilityIds.includes('wick-path'));
  assert.ok(milo('wayward').abilityIds.includes('wayward-path') && milo('wayward').abilityIds.includes('wayward-step'));
  assert.ok(!milo('wick').abilityIds.includes('hearthburst'), 'Hearthburst is a stub until it ships');
});

test('charges and highest circles match §4.12 for every pool, through heroSpec', () => {
  const tables = content.combat.callings.charges;
  const circleOf = (pool, level) => {
    let c = 0;
    for (const [at, v] of Object.entries(content.combat.callings.circles[pool])) if (Number(at) <= level) c = Math.max(c, v);
    return c;
  };
  for (let level = 1; level <= 12; level += 1) {
    const milo = spec(makeState({ tier: 7, road: level }), 'milo');
    assert.deepEqual([milo.charges.max, milo.charges.circle], [tables['three-quarter'][level - 1], circleOf('three-quarter', level)], `Milo at ${level}`);
    const scribe = spec(atLevel('claude', level), 'claude');
    assert.deepEqual([scribe.charges.max, scribe.charges.circle], [tables.full[level - 1], circleOf('full', level)], `the Scribe at ${level}`);
    const artificer = spec(atLevel('codex', level), 'codex');
    assert.deepEqual([artificer.charges.max, artificer.charges.circle], [tables.half[level - 1], circleOf('half', level)], `the Artificer at ${level}`);
    assert.deepEqual(spec(atLevel('jev', level), 'jev').charges, { pool: null, max: 0, left: 0, circle: 0 });
  }
  // Past 12 the Wayfarer's charges stay at level 12's.
  const past = spec(makeState({ byCrew: { claude: 900 } }), 'claude');
  assert.ok(past.level > 12);
  assert.equal(past.charges.max, 16);
  assert.equal(past.maxIntegrity, 120 + (past.level - 12) * 10, 'Light adds 10 a level past 12');
  // Circle 3 at 5 for the full casters, circle 2 at 5 for half casters: the power jump.
  assert.equal(spec(atLevel('claude', 5), 'claude').charges.circle, 3);
  assert.equal(spec(atLevel('codex', 5), 'codex').charges.circle, 2);
  assert.equal(spec(atLevel('claude', 9), 'claude').charges.circle, 5);
});

// ---------------------------------------------------------------------------
// Warmth and Cheers

test('warmth never falls, an outing pays +2 at most +6 a local-Monday week, a habit +1 on its day, and nothing notifies', () => {
  let state = makeState();
  const w = (s) => s.party.roster.claude.warmth;
  state = party.addWarmth(state, 'claude', 2, 'outing', NOW);
  state = party.addWarmth(state, 'claude', 2, 'outing', NOW + DAY);
  state = party.addWarmth(state, 'claude', 2, 'outing', NOW + 2 * DAY);
  assert.equal(w(state), 6);
  const capped = party.addWarmth(state, 'claude', 2, 'outing', NOW + 3 * DAY);
  assert.equal(capped, state, 'the week’s cap holds (the same state)');
  const monday = new Date(2026, 9, 5, 0, 30).getTime(); // the next Monday
  state = party.addWarmth(state, 'claude', 2, 'outing', monday);
  assert.equal(w(state), 8, 'a new week starts on the local Monday');
  state = party.addWarmth(state, 'claude', 1, 'habit', monday);
  assert.equal(w(state), 9);
  assert.equal(party.addWarmth(state, 'claude', 1, 'habit', monday + 60_000), state, 'a habit pays once a day');
  assert.equal(party.addWarmth(state, 'claude', -5, 'outing', monday), state, 'warmth never falls');
  assert.equal(party.addWarmth(state, 'milo', 2, 'outing', monday), state, 'Milo has no warmth');
  const top = party.addWarmth(withMember(state, 'claude', { warmth: 999 }), 'claude', 2, 'outing', monday + 2 * DAY);
  assert.deepEqual([w(top), top.party.roster.claude.warmthWeek.outing], [1000, 3], 'warmth stops at A’s 1,000, and only what was paid counts');
  assert.deepEqual(Object.keys(state).sort(), Object.keys(makeState()).sort(), 'no notification is queued anywhere');
  assert.deepEqual(['stranger', 'acquaintance', 'companion', 'friend', 'fireside'], [0, 10, 30, 60, 100].map(party.warmthStep));
  assert.equal(party.warmthStep(59), 'companion');
});

const battleOf = (state, extra = {}) => {
  const specs = party.partySpecs(state, opts);
  return { kind: 'room', cheers: state.party.cheers, units: specs.map((s) => ({ ...s, offline: false, charges: { ...s.charges } })), ...extra };
};

test('afterFight pays the outing’s warmth once per outing and the first win’s Cheer once', () => {
  let state = party.campfire(makeState(), NOW, { where: 'muster' }).state;
  state = party.afterFight(state, battleOf(state), WON, NOW, opts);
  assert.equal(state.party.roster.claude.warmth, 2);
  assert.equal(state.party.roster.jev.warmth, 2);
  assert.equal(state.party.cheers, 1, 'the first fight ever won gives a Cheer');
  assert.equal(state.road.firstWin, true);
  state = party.afterFight(state, battleOf(state), WON, NOW + 1000, opts);
  assert.equal(state.party.roster.claude.warmth, 2, 'once per outing');
  assert.equal(state.party.cheers, 1, 'the first win pays once');
  state = party.campfire(state, NOW + 2000, { where: 'home' }).state;
  state = party.afterFight(state, battleOf(state), WON, NOW + 3000, opts);
  assert.equal(state.party.roster.claude.warmth, 4, 'a new outing warms again');
});

test('afterFight keeps the Cheers the fight left, and marks the first lead met after a lead or field fight', () => {
  let state = party.addCheer(makeState(), 3, NOW);
  state = { ...state, road: { ...state.road, firstWin: true } };
  assert.equal(party.afterFight(state, battleOf(state, { cheers: 1 }), WON, NOW, opts).party.cheers, 1, 'two spent in the fight stay spent');
  assert.equal(party.afterFight(state, battleOf(state, { cheers: 4 }), WON, NOW, opts).party.cheers, 4, 'one earned by a talk-down is kept');
  assert.equal(party.afterFight(state, battleOf(state, { cheers: 9 }), WON, NOW, opts).party.cheers, 4, 'never more than 4');
  assert.equal(party.afterFight(state, battleOf(state, { cheers: 0 }), { outcome: 'offline' }, NOW, opts).party.cheers, 0, 'spent even when everyone went offline');
  assert.equal(party.afterFight(state, battleOf(state), WON, NOW, opts).party.firstLeadMet, false, 'a stray room is no lead');
  for (const extra of [{ kind: 'lead' }, { kind: 'field' }, { kind: 'room', lead: { unitId: 'lead', mechanic: 'alibis' } }]) {
    assert.equal(party.afterFight(state, battleOf(state, extra), { outcome: 'bowed', bow: true }, NOW, opts).party.firstLeadMet, true, JSON.stringify(extra));
  }
});

test('Cheers are held up to 4', () => {
  let state = makeState();
  state = party.addCheer(state, 3, NOW);
  state = party.addCheer(state, 3, NOW);
  assert.equal(state.party.cheers, 4);
  assert.equal(party.addCheer(state, 1, NOW), state);
});

// ---------------------------------------------------------------------------
// Paying fights and stitches once

test('a fight id pays once, after a restore or a Try again, and auto modes pay in full', () => {
  const rewards = { weight: 4, n: 2, deepRank: 0, essences: [{ name: 'Neon shards', genre: 'neon', qty: 1 }], relic: null, tonics: { cordial: 1, brew: 0 } };
  const first = party.payFight(makeState(), 'fight:rift:abc:w:r1', rewards, WON, NOW, { rules });
  assert.equal(first.paid, true);
  assert.equal(first.xp, 80, '4 weights × 20 at n = 2');
  assert.equal(first.marks, 32);
  assert.equal(first.state.road.xp, 80);
  assert.equal(first.state.xp.skills.warding, 80, 'Warding gets the same amount');
  assert.equal(first.state.satchel.marks, 32);
  assert.equal(first.state.satchel.essences['Neon shards'], 1);
  assert.deepEqual(first.state.satchel.essenceGenres, { 'Neon shards': 'neon' }, 'each essence keeps the genre it came from');
  assert.equal(first.state.satchel.tonics.cordial, 1);
  // That genre is what a Weaver carries as stitched, for Borrow a rule.
  const weaver = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(5, [STRAY('iron', 'shy', { archetype: 'floater' })]) }, NOW, opts);
  const out = party.choose(party.payFight(weaver.state, 'fight:rift:abc:w:r1', rewards, WON, NOW, { rules }).state, [weaver.regular.id], NOW);
  assert.deepEqual([spec(out, weaver.regular.id).carry.essences, spec(out, weaver.regular.id).carry.stitched], [1, ['neon']]);
  const again = party.payFight(first.state, 'fight:rift:abc:w:r1', rewards, WON, NOW + 1, { rules });
  assert.equal(again.paid, false, 'a Try again of the same room pays nothing more');
  assert.equal(again.state, first.state);
  const restored = { ...first.state, ...normalize4(JSON.parse(JSON.stringify(first.state)), { now: NOW + 2, tally: first.state.tally }) };
  assert.equal(party.payFight(restored, 'fight:rift:abc:w:r1', rewards, WON, NOW + 2, { rules }).paid, false, 'a relaunch never pays twice');
  const auto = party.payFight(makeState(), 'fight:rift:abc:w:r1', rewards, { ...WON, auto: true }, NOW, { rules });
  assert.equal(auto.xp, first.xp);
  assert.equal(auto.marks, first.marks);
  const talked = party.payFight(makeState(), 'fight:rift:abc:w:r1', rewards, { outcome: 'talked' }, NOW, { rules });
  assert.equal(talked.xp, first.xp, 'talking down pays in full');
  const found = party.payFight(makeState({ tonics: { cordial: 1, brew: 1 } }), 'fight:rift:abc:w:r2', { ...rewards, relic: { name: 'A brass key', genre: 'noir' }, tonics: { cordial: 0, brew: 2 } }, WON, NOW, { rules });
  assert.deepEqual(found.state.satchel.relics, [{ name: 'A brass key', text: 'Brought home from a fight in an Elsewhere.', genre: 'noir', at: NOW }]);
  assert.deepEqual(found.state.satchel.tonics, { cordial: 1, brew: 3 }, 'a Brew found joins the ones carried');
});

test('Road XP and Marks floor once, after the bow: Low for three heroes at n = 1', () => {
  const low3 = { weight: 45 / 20, n: 1, deepRank: 0 };
  const plain = party.payFight(makeState(), 'fight:rift:a:w:r0', low3, WON, NOW, { rules });
  assert.deepEqual([plain.xp, plain.marks], [22, 9], '2.25 × 10 = 22.5 → 22; 4 × 2.25 = 9');
  const bowed = party.payFight(makeState(), 'fight:rift:a:w:r0', low3, { outcome: 'bowed', bow: true }, NOW, { rules });
  assert.deepEqual([bowed.xp, bowed.marks], [28, 11], '22.5 × 1.25 = 28.125 → 28 (not 27); 9 × 1.25 = 11.25 → 11');
  const deep = party.payFight(makeState(), 'fight:rift:a:w:r0', { weight: 4, n: 11, deepRank: 2 }, WON, NOW, { rules });
  assert.equal(deep.xp, 4 * (335 + 45 * 2), '+45 a weight per deep rank');
  const past = party.payFight(makeState(), 'fight:rift:a:w:r0', { weight: 1, n: 14, deepRank: 0 }, WON, NOW, { rules });
  assert.equal(past.xp, 395 + 60 * 2, 'past n = 12 the table adds 60 a level');
});

test('everyone offline spends nothing and loses nothing, and going back in is free once', () => {
  let state = makeState({ tonics: { cordial: 2, brew: 1 }, essences: { 'Neon shards': 3 } });
  state = { ...state, embers: { ...state.embers, balance: 12 }, expedition: { riftId: 'rift:abc', inside: true, battle: null } };
  state = withMember(state, 'milo', {});
  state = { ...state, party: { ...state.party, outing: { ...state.party.outing, heroes: { milo: { integrity: 3, charges: 1, uses: {}, rattled: true } } } } };
  const offline = party.payFight(state, 'fight:rift:abc:w:r1', { weight: 4, n: 1, deepRank: 0 }, { outcome: 'offline' }, NOW, { rules });
  assert.equal(offline.paid, false);
  assert.equal(offline.state, state, 'nothing paid, nothing taken');
  const woke = party.wake(state, NOW);
  assert.equal(woke.embers, state.embers, 'no Embers spent');
  assert.equal(woke.satchel, state.satchel, 'everything found is kept');
  assert.equal(spec(woke, 'milo').integrity, 18, 'full Integrity at the wake');
  assert.ok(Object.hasOwn(woke.party.rests.freeReentry, 'rift:abc'), 'going back in is free once');
  assert.equal(party.wake(woke, NOW), woke, 'waking again changes nothing (§2: the same object)');
  assert.equal(party.wake(woke, NOW + DAY), woke, 'and the free way back in keeps the time it was given');
  const again = party.wake({ ...woke, party: { ...woke.party, outing: state.party.outing } }, NOW + DAY);
  assert.deepEqual([again.party.rests.freeReentry['rift:abc'], spec(again, 'milo').integrity], [NOW, 18], 'a second wake-up before going back keeps the grant’s first time');
  // A cave has no rift: its free way back in is keyed by the expedition's own key.
  const cave = party.wake({ ...state, expedition: { kind: 'cave', riftId: null, key: 'cave:12,-3', inside: false, battle: null } }, NOW);
  assert.deepEqual(Object.keys(cave.party.rests.freeReentry), ['cave:12,-3']);
  const clean = normalize4(JSON.parse(JSON.stringify(cave)), { now: NOW, tally: cave.tally });
  assert.ok(Object.hasOwn(clean.party.rests.freeReentry, 'cave:12,-3'), 'and A’s cleaner keeps it');
});

test('a wild stitch’s key pays once, and each real stitch past road.stitchedThrough pays once', () => {
  const stitch = party.payStitch(makeState(), { kind: 'wild', level: 2, depth: 4, key: 'stitch:rift:abc' }, NOW, { rules });
  assert.equal(stitch.paid, true);
  assert.equal(stitch.xp, 80, '4 weights at n = 2');
  assert.equal(stitch.state.xp.skills.warding, 80);
  assert.equal(stitch.state.xp.skills.seamcraft, 300 + 30 * 4);
  assert.equal(party.payStitch(stitch.state, { kind: 'wild', level: 2, depth: 4, key: 'stitch:rift:abc' }, NOW, { rules }).paid, false);
  // Real stitches: the first look seeds the mark and pays nothing.
  let state = makeState({ real: 3 });
  let paid = party.payRealStitches(state, NOW, { rules });
  assert.equal(paid.paid, 0);
  assert.equal(paid.state.road.stitchedThrough, 3);
  state = { ...paid.state, rifts: { stitched: { real: 5, wild: 0, story: 0 } } };
  paid = party.payRealStitches(state, NOW, { rules });
  assert.equal(paid.paid, 2);
  assert.equal(paid.state.road.xp, 2 * 8 * 10, '8 weights at Road level 1, twice');
  assert.equal(paid.state.xp.skills.warding, 2 * 8 * 10, 'and Warding the same amount');
  assert.equal(paid.state.xp.skills.seamcraft, 1000, 'Seamcraft 500 each');
  const relaunched = { ...paid.state, ...normalize4(JSON.parse(JSON.stringify(paid.state)), { now: NOW, tally: paid.state.tally }) };
  assert.equal(party.payRealStitches(relaunched, NOW + 1, { rules }).paid, 0, 'a relaunch never pays twice');
  // At the party’s Road level: 8 weights at level 3 (35 each) is 280 a stitch.
  const three = party.payRealStitches(makeState({ tier: 2, road: 3, real: 1 }), NOW, { rules }).state;
  const later = party.payRealStitches({ ...three, rifts: { stitched: { real: 3, wild: 0, story: 0 } } }, NOW, { rules }).state;
  assert.deepEqual([later.road.xp - three.road.xp, later.xp.skills.warding], [2 * 280, 2 * 280]);
});

test('a level up from a fight is reported with the hero ids that rose', () => {
  const state = makeState({ tier: 2 });
  const { levelUps } = party.payFight(state, 'fight:rift:a:w:r0', { weight: 10, n: 2, deepRank: 0 }, WON, NOW, { rules });
  assert.deepEqual(levelUps.sort(), ['jev', 'milo'], 'Road level 2: Milo and Jev; the Wayfarers are at road − 1 or their work');
});

// ---------------------------------------------------------------------------
// Regulars

const STRAY = (genre, temperament, extra = {}) => ({ name: `${genre} ${temperament} stray`, genre, second: null, archetype: 'walker', bodyKey: 'r', parts: [{ id: 'horn', layer: 0 }], count: 2, temperament, ...extra });
const rift = (seed, strays) => ({ id: `rift:${seed.toString(36)}`, seed, kind: 'wild', genres: [strays[0].genre], strays, taleLead: null });

test('gentlestStray follows §4.6’s order, skips strays that never fight, and ties go to the lower index', () => {
  assert.equal(party.gentlestStray(rift(1, [STRAY('neon', 'grumpy'), STRAY('neon', 'polite'), STRAY('verdant', 'shy')]), { genres: content.genres }), 1);
  assert.equal(party.gentlestStray(rift(1, [STRAY('neon', 'shy'), STRAY('iron', 'shy')])), 0);
  const order = ['shy', 'polite', 'sleepy', 'lost', 'curious', 'nosy', 'proud', 'grumpy', 'dramatic'];
  for (let i = 0; i < order.length; i += 1) {
    const strays = order.slice(i).reverse().map((t) => STRAY('noir', t));
    assert.equal(strays[party.gentlestStray(rift(2, strays))].temperament, order[i]);
  }
  assert.equal(party.gentlestStray(rift(3, [STRAY('backhalls', 'shy'), STRAY('summit', 'polite')]), { genres: content.genres }), null);
});

test('the regulars’ room follows the tier, “Another time, then.” when full, and letting a rift go re-offers its invitation', () => {
  const a = rift(11, [STRAY('neon', 'curious'), STRAY('neon', 'shy', { archetype: 'floater' })]);
  let state = makeState({ tier: 1 });
  let r = party.inviteRegular(state, { rift: a, stray: party.gentlestStray(a) }, NOW, opts);
  assert.equal(r.ok, false, 'the Camp has no room');
  assert.equal(r.words, 'Another time, then.');
  state = makeState({ tier: 2 });
  r = party.inviteRegular(state, { rift: a, stray: 1 }, NOW, opts);
  assert.equal(r.ok, true);
  assert.equal(r.words, 'Can I sit by the fire a while?');
  assert.match(r.regular.id, /^reg-[a-z0-9]+$/);
  assert.equal(r.regular.calling, 'weaver', 'a floater regular is a Weaver');
  const twice = party.inviteRegular(r.state, { rift: a, stray: 1 }, NOW, opts);
  assert.deepEqual([twice.ok, twice.words, twice.state], [false, 'They’re already by the fire.', r.state], 'the same stray already joined');
  const bright = party.inviteRegular(r.state, { rift: rift(14, [STRAY('verdant', 'shy')]) }, NOW, opts);
  assert.deepEqual([bright.ok, bright.words], [false, 'Nobody here is asking to stay.'], 'bright strays never fight, so never ask');
  assert.equal(party.inviteRegular(r.state, { rift: null }, NOW, opts).words, 'Nobody here is asking to stay.');
  for (const w of [twice.words, bright.words]) assertCalm(w, 'invite words');
  // Nobody is missable: a later stitch of the same genre asks again, with no memory kept.
  const b = rift(12, [STRAY('neon', 'polite')]);
  const r2 = party.inviteRegular(r.state, { rift: b }, NOW, opts);
  assert.equal(r2.ok, true);
  const c = rift(13, [STRAY('neon', 'lost')]);
  const r3 = party.inviteRegular(r2.state, { rift: c }, NOW, opts);
  assert.equal(r3.ok, false);
  assert.equal(r3.words, 'Another time, then.', 'the Stockade holds 2');
  assert.deepEqual(party.musterView(r2.state, opts).room, { used: 2, max: 2 });
  // A regular survives the cleaner, fights at the Road level with its genre’s kind, and no path.
  const clean = { ...r2.state, ...normalize4(JSON.parse(JSON.stringify(r2.state)), { now: NOW, tally: r2.state.tally }) };
  assert.equal(clean.party.regulars.length, 2);
  const reg = spec(clean, r.regular.id);
  assert.equal(reg.kind, 'regular');
  assert.equal(reg.calling, 'weaver');
  assert.equal(reg.strike.kind, 'static');
  assert.equal(reg.idleHeat, 15, 'a shy regular’s idle heat');
  assert.equal(reg.resist.static, 3);
  assert.equal(reg.weak.warp, 3);
  assert.deepEqual(reg.genres, ['neon']);
  assert.ok(reg.abilityIds.includes('static-snap'), 'its genre’s signature');
  assert.ok(reg.moves.hovers);
  assert.equal(party.pendingChoices(withMember(makeState({ tier: 2, road: 3 }), r.regular.id, {}), r.regular.id, opts).length, 0);
});

test('a Longshot regular shoots 12 tiles, and a regular’s resistances and weakness grow with its level as a stray’s do', () => {
  const r = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(91, [STRAY('neon', 'shy', { archetype: 'flier' })]) }, NOW, opts);
  assert.equal(r.regular.calling, 'longshot', 'a flier regular is a Longshot');
  const at = (road) => spec({ ...r.state, road: { ...r.state.road, xp: ROAD_XP[road - 1] } }, r.regular.id);
  assert.deepEqual([at(1).strike.weapon, at(1).strike.range, at(1).strike.reach], ['ranged', 12, 1], 'a ranged Strike reaches 12');
  assert.ok(at(1).moves.flies);
  const rows = [1, 2, 3, 4, 5].map((level) => [at(level).level, at(level).resist.static, at(level).weak.warp]);
  assert.deepEqual(rows, [[1, 3, 3], [2, 3, 3], [3, 4, 4], [4, 5, 5], [5, 6, 6]], 'the stray resist row at levels 1 to 5');
  // A pinned level reads that level's row too.
  assert.equal(spec({ ...r.state, road: { ...r.state.road, xp: ROAD_XP[4] } }, r.regular.id, { level: 3 }).resist.static, 4);
  // A walker regular (a Chorister) strikes in reach, not at range.
  const w = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(92, [STRAY('neon', 'shy')]) }, NOW, opts);
  assert.deepEqual([w.regular.calling, spec(w.state, w.regular.id).strike.range], ['chorister', 0]);
});

test('a bowed Tale-lead who stays keeps its mechanic as a once-a-fight trick', () => {
  const a = { ...rift(21, [STRAY('noir', 'proud')]), taleLead: { genre: 'noir', name: 'The Man with No Clues', mechanic: content.combat.leads.mechanics.find((m) => m.id === 'alibis').text } };
  const r = party.inviteRegular(makeState({ tier: 2 }), { rift: a, lead: true }, NOW, opts);
  assert.equal(r.ok, true);
  assert.equal(r.regular.lead, true);
  assert.equal(r.regular.mechanic, 'alibis');
  const s = spec(r.state, r.regular.id);
  assert.ok(s.abilityIds.includes('hunch-trick'));
  assert.equal(s.uses['hunch-trick'], 1);
});

test('a bowed Tale-lead joins under the name its fight showed: clear of the company’s names unless hooked, and clipped the same way', async () => {
  const { createRiftgen } = await import('../src/world/riftgen.js');
  const { leadUnit } = await import('../src/combat/bestiary.js');
  const { companyNamesIn } = await import('../src/world/leadname.js');
  const rg = createRiftgen({ words: content.riftgen, genres: content.genres });
  const leads = content.combat.leads;
  const fights = (r) => content.genres.genres.find((g) => g.id === r.taleLead?.genre)?.kind === 'shadow';
  const shown = (r, hooks = (leads.hooks || []).map((h) => h.name)) => leadUnit(r, { level: 3, rules, leads, words: content.riftgen, hooks }).name;
  const join = (r, c = content) => party.inviteRegular(makeState({ tier: 2 }), { rift: r, lead: true }, NOW, { content: c, rules });
  const clashing = [];
  const long = [];
  for (let seed = 1; seed < 2500 && (clashing.length < 4 || long.length < 2); seed += 1) {
    const r = rg.wildRift({ seed, tier: 3, depth: 1 });
    if (!fights(r)) continue;
    if (companyNamesIn(r.taleLead.name).length) { if (clashing.length < 4) clashing.push(r); } else if (r.taleLead.name.length > 40 && long.length < 2) long.push(r);
  }
  assert.deepEqual([clashing.length, long.length], [4, 2]);
  assert.deepEqual([clashing[0].taleLead.name, join(clashing[0]).regular.name], ['Enforcer Juno of Arcology 9', 'Enforcer Mori of Arcology 9'], 'riftgen’s seed 14');
  for (const r of [...clashing, ...long]) {
    const joined = join(r);
    const name = shown(r);
    assert.equal(joined.regular.name, name, `“${r.taleLead.name}” joins as the fight showed it`);
    assert.equal(spec(joined.state, joined.regular.id).name, name, 'fights under it');
    assert.equal(party.musterView(joined.state, opts).members.find((m) => m.id === joined.regular.id).name, name, 'and is mustered under it');
    assert.deepEqual(companyNamesIn(name), [], 'never a company name');
    assert.ok(name.length <= 40);
  }
  // A pairing leads.json plans as a hook keeps its name, in the fight and at the fire.
  const word = companyNamesIn(clashing[0].taleLead.name)[0];
  const hooked = { ...content, combat: { ...content.combat, leads: { ...leads, hooks: [{ name: word, companion: 'juno', talk: 'first-night' }] } } };
  assert.equal(join(clashing[0], hooked).regular.name, shown(clashing[0], [word]));
  assert.equal(join(clashing[0], hooked).regular.name, clashing[0].taleLead.name);
});

// COMBAT §2.4 and §4.9's archetype table; §4.6's heat by temperament. Genres are picked so the
// archetype's own kinds show: a ghost resists Plain and is weak to Light, a construct weak to Spark.
const ARCHETYPE_ROWS = [
  // archetype, genre, temperament, calling, Speed, moves, ignores, resist, weak, idle heat
  ['walker', 'kaiju', 'lost', 'chorister', 5, [], [], { quake: 3 }, { plain: 3 }, 25],
  ['crawler', 'neon', 'dramatic', 'skirmisher', 6, [], [], { static: 3 }, { warp: 3 }, 60],
  ['floater', 'void', 'nosy', 'weaver', 4, ['hovers'], [], { warp: 3 }, { ink: 3 }, 35],
  ['flier', 'frontier', 'proud', 'longshot', 6, ['flies'], [], { dust: 3 }, { chill: 3 }, 40],
  ['ghost', 'neon', 'sleepy', 'mender', 5, ['throughWalls', 'darksight'], ['tangled', 'tumbled'], { static: 3, plain: 3 }, { warp: 3, light: 3 }, 20],
  ['ghost', 'noir', 'curious', 'mender', 5, ['throughWalls', 'darksight'], ['tangled', 'tumbled'], { doubt: 3, plain: 3 }, { light: 3 }, 35],
  ['construct', 'iron', 'grumpy', 'warden', 4, [], ['queasy', 'drowsy', 'beguiled'], { grind: 3 }, { static: 3, spark: 3 }, 45],
];

test('each archetype’s regular moves, resists and ignores as its stray does, idles at its temperament’s heat, and only a lead has a trick', () => {
  ARCHETYPE_ROWS.forEach(([archetype, genre, temperament, calling, speed, moves, ignores, resist, weak, heat], i) => {
    const r = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(300 + i, [STRAY(genre, temperament, { archetype })]), stray: 0 }, NOW, opts);
    const s = spec(r.state, r.regular.id);
    const what = `${temperament} ${genre} ${archetype}`;
    assert.deepEqual([s.calling, s.temperament, s.speed], [calling, temperament, speed], `${what}: calling, temperament and §4.9’s Speed`);
    assert.equal(s.speed, rules.archetypes[archetype].speed, `${what}: as fast as the stray it was`);
    assert.deepEqual(s.moves, { flies: moves.includes('flies'), hovers: moves.includes('hovers'), throughWalls: moves.includes('throughWalls'), darksight: moves.includes('darksight') }, what);
    assert.deepEqual([s.ignores, s.resist, s.weak], [ignores, resist, weak], `${what}: ignores, resistances and weaknesses, each kind once`);
    assert.equal(s.idleHeat, heat, `${what}: a ${temperament} regular idles at ${heat}`);
    assert.equal(s.strike.kind, rules.genres[genre].kind, `${what}: strikes in its genre’s kind`);
    assert.ok(s.abilityIds.includes(content.party.regulars.signatures[genre]), `${what}: its genre’s signature`);
    assert.deepEqual(s.abilityIds.filter((id) => id.endsWith('-trick')), [], `${what}: no trick unless it was a Tale-lead`);
  });
  // Grace 3 still adds its +1 (§4.4) when an Ability up brings a regular there; the archetype’s own is counted once.
  const at = (archetype, boons) => {
    const r = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(320, [STRAY('neon', 'shy', { archetype })]) }, NOW, opts);
    return spec(withMember(r.state, r.regular.id, { boons }), r.regular.id);
  };
  assert.deepEqual([at('walker', []).abilities.grace, at('walker', []).speed, at('walker', ['ability-up-grace']).speed], [2, 5, 6], 'a Chorister at Grace 3');
  assert.deepEqual([at('crawler', ['ability-up-grace']).abilities.grace, at('crawler', ['ability-up-grace']).speed], [4, 6], 'a Skirmisher past 3 gains nothing more');
});

const reload = (s) => ({ ...s, ...normalize4(JSON.parse(JSON.stringify(s)), { now: NOW, tally: s.tally }) });

// §18.2 item 2: D's bestiary.defencesFor is the one rule, so a stray and the regular made from it always match.
test('a regular resists and is weak as the stray it was, by D’s defencesFor: a kind in both lists counts in neither', async () => {
  const { strayUnit } = await import('../src/combat/bestiary.js');
  const { createRiftgen } = await import('../src/world/riftgen.js');
  const regular = (stray) => {
    const r = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: rift(400, [stray]), stray: 0 }, NOW, opts);
    return spec(r.state, r.regular.id);
  };
  for (const [genre, second, archetype, resist, weak] of [
    ['kaiju', null, 'ghost', { quake: 4 }, { light: 4 }], // Titan's weakness is Plain, which a ghost resists
    ['nocturne', 'frontier', 'walker', { chill: 4 }, {}], // Nocturne's weakness is Frontier's own kind
    ['iron', 'neon', 'construct', { grind: 4 }, { spark: 4 }], // Iron's weakness is Neon's own kind
  ]) {
    const s = regular(STRAY(genre, 'shy', { second, archetype }));
    assert.deepEqual([s.resist, s.weak], [resist, weak], `${genre}${second ? `+${second}` : ''} ${archetype}`);
  }
  // Every fighting stray of 400 real wild rifts: the regular's defences are the stray's at the same level.
  const rg = createRiftgen({ words: content.riftgen, genres: content.genres });
  let both = 0;
  let camel = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const r = rg.wildRift({ seed, tier: 3, depth: 1 });
    r.strays.forEach((stray, i) => {
      if (!rules.genres[stray.genre]?.fights) return;
      const joined = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: r, stray: i }, NOW, opts);
      const s = spec(joined.state, joined.regular.id);
      const foe = strayUnit(r, i, 3, { level: 3, rules });
      assert.deepEqual([s.resist, s.weak], [foe.resist, foe.weak], `seed ${seed} stray ${i}`);
      // Straygen's part ids are camelCase (batWings, jetFlame): the regular wears every one the stray did.
      assert.deepEqual(s.look.parts, foe.look.parts, `seed ${seed} stray ${i}: its parts`);
      if (foe.look.parts.some((p) => /[A-Z]/.test(p.id))) camel += 1;
      const arch = rules.archetypes[stray.archetype];
      const weakTo = [rules.genres[stray.genre].weak, ...Object.keys(arch.weak)];
      if ([rules.genres[stray.genre].kind, rules.genres[stray.second]?.kind, ...Object.keys(arch.resist)].some((k) => weakTo.includes(k))) both += 1;
    });
  }
  assert.ok(both >= 10, `the sweep met kinds named twice (${both})`);
  assert.ok(camel >= 100, `the sweep met camelCase parts (${camel})`);
});

// A save keeps a regular's parts too, so A's cleaner (state4.js) must take straygen's camelCase ids.
test('a regular made from a real stray keeps its stray’s parts after a save', async () => {
  const { strayUnit } = await import('../src/combat/bestiary.js');
  const { createRiftgen } = await import('../src/world/riftgen.js');
  const rg = createRiftgen({ words: content.riftgen, genres: content.genres });
  for (let seed = 1; seed <= 100; seed += 1) {
    const r = rg.wildRift({ seed, tier: 3, depth: 1 });
    r.strays.forEach((stray, i) => {
      const joined = party.inviteRegular(makeState({ tier: 2 }), { rift: r, stray: i }, NOW, opts);
      if (joined.ok) assert.deepEqual(spec(reload(joined.state), joined.regular.id).look.parts, strayUnit(r, i, 1, { rules }).look.parts, `seed ${seed} stray ${i}`);
    });
  }
});

// §18.2 item 7: the rift record or its spec; A keeps at most 4 parts; a stray's name is clipped as its fight clips it.
test('inviteRegular takes the rift record or its spec, keeps at most four parts, and names a stray as its fight did', async () => {
  const { createRiftgen } = await import('../src/world/riftgen.js');
  const { strayUnit, leadUnit } = await import('../src/combat/bestiary.js');
  const { clip } = await import('../src/clean.js');
  const rg = createRiftgen({ words: content.riftgen, genres: content.genres });
  let checked = 0;
  for (let seed = 1; checked < 5; seed += 1) {
    const spec0 = rg.wildRift({ seed, tier: 3, depth: 1 });
    const record = { id: spec0.id, key: null, kind: 'wild', spec: spec0, x: 40, y: -12, stage: spec0.stage };
    const bySpec = party.inviteRegular(makeState({ tier: 2 }), { rift: spec0 }, NOW, opts);
    if (!bySpec.ok) continue;
    assert.deepEqual(party.inviteRegular(makeState({ tier: 2 }), { rift: record }, NOW, opts), bySpec, `seed ${seed}: the record joins the same regular`);
    assert.equal(bySpec.regular.riftId, spec0.id);
    checked += 1;
  }
  const many = STRAY('neon', 'shy', { parts: ['horn', 'fin', 'gear', 'candle', 'rivets', 'fedora', 'lasso'].map((id) => ({ id, layer: 0 })), second: 'void', eyeKey: 'k' });
  const r = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(77, [many]) }, NOW, opts);
  assert.deepEqual(r.regular.parts.map((p) => p.id), ['horn', 'gear', 'candle', 'rivets'], 'A’s cap of four, of parts straygen draws');
  assert.deepEqual(reload(r.state).party.regulars, r.state.party.regulars, 'so a reload keeps every part');
  assert.deepEqual([spec(r.state, r.regular.id).look.genres, spec(r.state, r.regular.id).look.eyeKey], [['neon', 'void'], 'k'], 'and looks as the stray did');
  // A long name is clipped at a word, as the fight clips the stray's.
  const name = 'The long-winded stray of the flooded arcade halls';
  const long = { ...rift(78, [STRAY('neon', 'shy', { name })]), id: 'rift:long' };
  const joined = party.inviteRegular(makeState({ tier: 2 }), { rift: long }, NOW, opts);
  assert.equal(joined.regular.name, strayUnit(long, 0, 1, { rules }).name);
  assert.notEqual(joined.regular.name, clip(name, 40), 'not cut mid-word');
  // A bowed lead looks like its own genre's stray, not the rift's first.
  const mixed = { ...rift(79, [STRAY('iron', 'shy', { archetype: 'construct' }), STRAY('noir', 'proud', { archetype: 'ghost' })]), taleLead: { genre: 'noir', name: 'The Quiet Man', mechanic: 'none' } };
  assert.equal(party.inviteRegular(makeState({ tier: 2 }), { rift: mixed, lead: true }, NOW, opts).regular.archetype, 'ghost');
  // A bowed lead keeps the temperament, and so the idle heat, D's leadUnit fought with (riftgen's taleLead has none).
  let leads = 0;
  for (let seed = 1; leads < 60; seed += 1) {
    const r0 = rg.wildRift({ seed, tier: 3, depth: 1 });
    const bowed = party.inviteRegular(makeState({ tier: 2 }), { rift: r0, lead: true }, NOW, opts);
    if (!bowed.ok) continue;
    const foe = leadUnit(r0, { level: 1, rules, leads: content.combat.leads, words: content.riftgen });
    assert.deepEqual([spec(bowed.state, bowed.regular.id).temperament, spec(bowed.state, bowed.regular.id).idleHeat], [foe.temperament, foe.idleHeat], `seed ${seed}`);
    leads += 1;
  }
});

// ---------------------------------------------------------------------------
// Rests

test('a second Breather for the same fight is refused, and a lantern rest counts toward the Campfire’s limit', () => {
  let state = party.campfire(makeState({ tier: 2, road: 2 }), NOW, { where: 'muster' }).state;
  state = withMember(state, 'milo', {});
  state = { ...state, party: { ...state.party, outing: { ...state.party.outing, heroes: { milo: { integrity: 4, charges: 0, uses: { 'the-lantern-calls': 0 }, rattled: true } } } } };
  assert.equal(spec(state, 'milo').maxIntegrity, 29, 'an odd max, so the rounding shows');
  let r = party.breather(state, NOW, { ...opts, fightId: 'fight:rift:a:w:r1', where: 'victory' });
  assert.equal(r.ok, true);
  assert.equal(r.state.party.outing.heroes.milo.integrity, 4 + 14, 'half of 29 back, rounded down (§19: only the Breather’s half rounds down)');
  assert.equal(r.state.party.outing.heroes.milo.rattled, false, 'a Breather clears Rattled');
  assert.equal(r.state.party.outing.heroes.milo.uses['the-lantern-calls'], 0, 'a per-Campfire use waits for the Campfire');
  const again = party.breather(r.state, NOW, { ...opts, fightId: 'fight:rift:a:w:r1', where: 'victory' });
  assert.equal(again.ok, false);
  assert.equal(again.state, r.state);
  assertCalm(again.reason, 'refusal');
  r = party.breather(r.state, NOW, { ...opts, where: 'lantern' });
  assert.equal(r.ok, true, 'a lantern rest');
  const third = party.breather(r.state, NOW, { ...opts, fightId: 'fight:rift:a:w:r2', where: 'victory' });
  assert.equal(third.ok, false, 'Long Road allows 2 a Campfire, and the lantern rest was one');
  const free = party.breather(r.state, NOW, { ...opts, free: true, where: 'focus' });
  assert.equal(free.ok, true, 'a focus session’s Breather never counts');
  assert.equal(free.state.party.outing.breathers, 2);
  assert.equal(party.campfire(r.state, NOW, { where: 'muster' }).state.party.outing.breathers, 0, 'a Campfire brings them back');
});

test('Breathers per Campfire follow the mode: Storybook 3, Long Road 2, Maud’s Table 1', () => {
  for (const [mode, limit] of [['storybook', 3], ['long-road', 2], ['mauds-table', 1]]) {
    let state = party.setMode(party.campfire(makeState(), NOW, { where: 'muster' }).state, mode, NOW);
    assert.equal(state.party.mode, mode);
    for (let i = 0; i < limit; i += 1) {
      const r = party.breather(state, NOW, { ...opts, fightId: `fight:rift:a:w:r${i}`, where: 'victory' });
      assert.equal(r.ok, true, `${mode}: Breather ${i + 1} of ${limit}`);
      state = r.state;
    }
    for (const where of ['victory', 'lantern']) {
      const over = party.breather(state, NOW, { ...opts, fightId: 'fight:rift:a:w:r9', where });
      assert.deepEqual([over.ok, over.reason, over.state], [false, 'No Breathers left until the next Campfire.', state], `${mode}: no more than ${limit}`);
    }
    assert.equal(party.breather(state, NOW, { ...opts, free: true, where: 'focus' }).ok, true, `${mode}: a free Breather still comes`);
  }
});

test('Turn back a page: a Breather also brings back half the Scribe’s level in charges, once a Campfire, twice from level 7', () => {
  const rest = (state) => party.breather(state, NOW, { ...opts, where: 'lantern' }).state;
  const scribe = (state) => state.party.outing.heroes.claude;
  // Storybook allows three Breathers, so the third shows the use running out rather than the mode's limit.
  const drained = (level, charges = 0) => {
    const state = party.setMode(party.campfire(atLevel('claude', level), NOW, { where: 'muster' }).state, 'storybook', NOW);
    return { ...state, party: { ...state.party, outing: { ...state.party.outing, heroes: { claude: { charges, uses: {} } } } } };
  };
  // Level 2: charges 3 at most; half of 2 is 1, once.
  let s = drained(2);
  assert.deepEqual([spec(s, 'claude').charges.max, spec(s, 'claude').uses['turn-back-a-page']], [3, 1]);
  s = rest(s);
  assert.deepEqual([scribe(s).charges, scribe(s).uses['turn-back-a-page']], [1, 0], 'level 2: one charge back, and the page is turned');
  s = rest(s);
  assert.equal(scribe(s).charges, 1, 'once a Campfire at level 2');
  // Level 7: charges 10 at most; half of 7 is 3, twice.
  s = drained(7);
  assert.deepEqual([spec(s, 'claude').charges.max, spec(s, 'claude').uses['turn-back-a-page']], [10, 2]);
  s = rest(s);
  assert.deepEqual([scribe(s).charges, scribe(s).uses['turn-back-a-page']], [3, 1], 'level 7: three back (half of 7, rounded down)');
  s = rest(s);
  assert.deepEqual([scribe(s).charges, scribe(s).uses['turn-back-a-page']], [6, 0], 'and again');
  s = rest(s);
  assert.equal(scribe(s).charges, 6, 'twice a Campfire from level 7, never three times');
  // Never past the top, and a Breather at full charges keeps the page for later.
  s = rest(drained(7, 9));
  assert.deepEqual([scribe(s).charges, scribe(s).uses['turn-back-a-page']], [10, 1], 'one short of 10: capped at 10');
  s = rest(drained(7, 10));
  assert.deepEqual([scribe(s).charges, spec(s, 'claude').uses['turn-back-a-page']], [10, 2], 'already full: nothing spent');
  // Level 1 has no page to turn: her charges wait for the Campfire.
  s = rest(drained(1));
  assert.equal(scribe(s).charges, 0);
  // A Campfire brings the page back.
  const lit = party.campfire(rest(drained(2)), NOW, { where: 'home' }).state;
  assert.equal(spec(lit, 'claude').uses['turn-back-a-page'], 1);
});

test('a free Breather while a fight is live waits for afterFight', () => {
  let state = party.campfire(makeState(), NOW, { where: 'muster' }).state;
  state = { ...state, expedition: { riftId: 'rift:abc', inside: true, battle: { v: 2, id: 'fight:rift:abc:w:r1' } } };
  const r = party.breather(state, NOW, { ...opts, free: true, where: 'focus' });
  assert.equal(r.ok, true);
  assert.equal(r.state.party.outing.freeBreather, true);
  assert.equal(r.state.party.outing.heroes.milo, undefined, 'the Battle only changes through apply, so nothing is patched yet');
  assert.equal(party.breather(r.state, NOW, { ...opts, where: 'victory', fightId: 'x' }).ok, false, 'a real Breather waits for the fight to end');
  const battle = battleOf(r.state);
  battle.units[0] = { ...battle.units[0], integrity: 2 };
  const after = party.afterFight(r.state, battle, WON, NOW, opts);
  assert.equal(after.party.outing.freeBreather, false);
  assert.equal(after.party.outing.heroes.milo.integrity, 9 + 9, 'topped up to half (9), then the free Breather’s half (9)');
});

// §18.2 item 8 (the cross-check's item 1): A's cleaner reads a missing count as 0, so a write without
// `charges` lost every charge at the next save. Every write now carries all four of §8.3's keys.
test('every outing-hero write carries integrity, charges, uses and Rattled, so a save never changes a hero’s spec', () => {
  const kept = (state, what) => {
    for (const [id, hero] of Object.entries(state.party.outing.heroes)) assert.deepEqual(Object.keys(hero), ['integrity', 'charges', 'uses', 'rattled'], `${what}: ${id}`);
    const again = reload(state);
    for (const id of ['milo', ...state.party.chosen]) assert.deepEqual(spec(again, id), spec(state, id), `${what}: ${id} after a save`);
    return state;
  };
  const camp = party.campfire(makeState({ tier: 2, road: 3, byCrew: { claude: WORK[2], codex: WORK[2] } }), NOW, { where: 'muster' }).state;
  // The cross-check's probe: a Campfire, a free (focus) Breather at camp, then a save.
  let state = kept(party.breather(camp, NOW, { ...opts, free: true, where: 'focus' }).state, 'a free Breather at camp');
  assert.deepEqual(['milo', 'claude'].map((id) => spec(reload(state), id).charges.left), [3, 4], 'Milo and the Scribe keep full charges');
  // A fight spends some, and each rest and wake after it keeps what's left.
  const battle = battleOf(state);
  battle.units = battle.units.map((u) => ({ ...u, integrity: 3, charges: { ...u.charges, left: Math.min(1, u.charges.left) } }));
  state = kept(party.afterFight(state, battle, WON, NOW, opts), 'afterFight');
  assert.deepEqual(['milo', 'claude'].map((id) => state.party.outing.heroes[id].charges), [1, 1]);
  state = kept(party.breather(state, NOW, { ...opts, where: 'victory', fightId: 'fight:rift:a:w:r1' }).state, 'a victory Breather');
  assert.equal(state.party.outing.heroes.claude.charges, 2, 'Turn back a page: half of 3 back');
  const live = { ...state, expedition: { riftId: 'rift:abc', inside: true, battle: { v: 2, id: 'fight:rift:abc:w:r2' } } };
  state = kept(party.afterFight(party.breather(live, NOW, { ...opts, free: true, where: 'focus' }).state, battleOf(state), WON, NOW, opts), 'afterFight with a free Breather waiting');
  for (const extra of [{}, opts]) {
    const woke = kept(party.wake({ ...state, expedition: { riftId: 'rift:abc', inside: false, battle: null } }, NOW, extra), 'a wake');
    assert.deepEqual(['milo', 'claude'].map((id) => [spec(woke, id).integrity, spec(woke, id).charges.left]), ['milo', 'claude'].map((id) => [spec(state, id).maxIntegrity, spec(state, id).charges.left]), 'full Integrity, charges as they were');
    assert.equal(woke.party.outing.heroes.milo.integrity, extra.rules ? spec(state, 'milo').maxIntegrity : 0, 'the max when the rules are passed; 0 (read as full) without');
  }
  // An entry that somehow lacks its charges reads as A's cleaner keeps it: 0, before a save and after.
  const bare = { ...camp, party: { ...camp.party, outing: { ...camp.party.outing, heroes: { milo: { integrity: 5, uses: {}, rattled: false } } } } };
  assert.deepEqual([spec(bare, 'milo').charges.left, spec(reload(bare), 'milo').charges.left, spec(camp, 'milo').charges.left], [0, 0, 3]);
  assert.equal(kept(party.wake(bare, NOW), 'waking it').party.outing.heroes.milo.charges, 0, 'and a wake writes that 0 down');
});

// A swap at a lit lantern, outside a fight: A keeps four entries (Milo and three), so only who's out keeps one.
test('a swap mid-outing keeps only who’s out, so a save keeps the new hero as they are', () => {
  let s = party.choose(party.recruit(makeState({ tier: 2, road: 3 }), 'tollkeeper', NOW, { content }), ['claude', 'codex', 'jev'], NOW);
  s = party.breather(party.campfire(s, NOW, { where: 'muster' }).state, NOW, { ...opts, where: 'lantern' }).state;
  assert.deepEqual(Object.keys(s.party.outing.heroes), ['milo', 'claude', 'codex', 'jev']);
  s = party.choose(s, ['claude', 'codex', 'tollkeeper'], NOW);
  assert.deepEqual(Object.keys(s.party.outing.heroes), ['milo', 'claude', 'codex'], 'Jev rests in the lantern-light');
  const battle = battleOf(s);
  battle.units = battle.units.map((u) => (u.id === 'tollkeeper' ? { ...u, integrity: u.maxIntegrity - 1, uses: { ...u.uses, 'hold-here': 0 } } : u));
  s = party.afterFight(s, battle, WON, NOW, opts);
  const out = ['milo', 'claude', 'codex', 'tollkeeper'];
  assert.deepEqual(Object.keys(s.party.outing.heroes), out);
  const toll = spec(s, 'tollkeeper');
  assert.deepEqual([toll.integrity, toll.uses['hold-here']], [toll.maxIntegrity - 1, 0], 'hurt, and Hold here spent');
  for (const id of out) assert.deepEqual(spec(reload(s), id), spec(s, id), `${id} after a save`);
  // Every write keeps only who's out, even past a stale entry (a save from before this rule).
  const stale = (x) => ({ ...x, party: { ...x.party, outing: { ...x.party.outing, heroes: { jev: { integrity: 3, charges: 0, uses: {}, rattled: true }, ...x.party.outing.heroes } } } });
  assert.deepEqual(Object.keys(party.breather(stale(s), NOW, { ...opts, free: true, where: 'focus' }).state.party.outing.heroes), out, 'a Breather');
  assert.deepEqual(Object.keys(party.afterFight(stale(s), battleOf(s), WON, NOW, opts).party.outing.heroes), out, 'afterFight');
  assert.deepEqual(Object.keys(party.wake(stale(party.wake(s, NOW, opts)), NOW, opts).party.outing.heroes), out, 'a wake, when everyone out is already awake');
  // Someone out with no spec (a regular whose record is gone) has nothing to rest: no entry is written, and one kept is left alone.
  const gone = { ...s, party: { ...s.party, chosen: ['claude', 'reg-gone'], roster: { ...s.party.roster, 'reg-gone': s.party.roster.claude } } };
  assert.equal(spec(gone, 'reg-gone'), null);
  assert.deepEqual(Object.keys(party.breather(gone, NOW, { ...opts, free: true, where: 'focus' }).state.party.outing.heroes), ['milo', 'claude']);
  const held = { integrity: 2, charges: 0, uses: {}, rattled: true };
  const holding = { ...gone, party: { ...gone.party, outing: { ...gone.party.outing, heroes: { ...gone.party.outing.heroes, 'reg-gone': held } } } };
  assert.equal(party.breather(holding, NOW, { ...opts, free: true, where: 'focus' }).state.party.outing.heroes['reg-gone'], held);
  // Called back later, Jev comes out fresh.
  s = party.choose(s, ['claude', 'jev', 'tollkeeper'], NOW);
  assert.deepEqual([Object.keys(s.party.outing.heroes), spec(s, 'jev').integrity], [['milo', 'claude', 'tollkeeper'], spec(s, 'jev').maxIntegrity]);
});

test('after a fight everyone tops up to half, Offline heroes come back at half, both rounded up, and what was carried goes back', () => {
  // Odd maxes, so rounding up and down differ: Milo 29 (Road level 2), the Scribe 33 (work level 3).
  let state = makeState({ tier: 2, road: 2, tonics: { cordial: 3, brew: 1 }, byCrew: { claude: WORK[2], codex: WORK[1] } });
  state = withMember(state, 'claude', { gifts: { margin: 2, spare: 0, through: 0 } });
  state = withMember(state, 'codex', { gifts: { margin: 0, spare: 1, through: 0 } });
  assert.deepEqual(['milo', 'claude', 'codex'].map((id) => spec(state, id).maxIntegrity), [29, 33, 35]);
  const battle = battleOf(state);
  const unit = (id) => battle.units.findIndex((u) => u.id === id);
  battle.units[unit('milo')] = { ...battle.units[unit('milo')], integrity: 2, carry: { ...battle.units[unit('milo')].carry, cordial: 1 } };
  battle.units[unit('claude')] = { ...battle.units[unit('claude')], integrity: 0, offline: true, carry: { ...battle.units[unit('claude')].carry, margin: 1 } };
  battle.units[unit('codex')] = { ...battle.units[unit('codex')], integrity: 20, rattled: true };
  const after = party.afterFight(state, battle, WON, NOW, opts);
  assert.equal(after.party.outing.heroes.milo.integrity, 15, 'up to half of 29, rounded up (§4.18, §19)');
  assert.equal(after.party.outing.heroes.claude.integrity, 17, 'Offline comes back at half of 33, rounded up');
  assert.equal(after.party.outing.heroes.codex.integrity, 20, 'above half stays');
  assert.equal(after.party.outing.heroes.codex.rattled, true, 'a Reboot’s Rattled lasts to the next Breather');
  const rested = party.breather(after, NOW, { ...opts, fightId: 'fight:rift:a:w:r1', where: 'victory' });
  assert.equal(rested.state.party.outing.heroes.milo.integrity, 15 + 14, 'then a Breather’s half of 29, rounded down');
  assert.equal(rested.state.party.outing.heroes.claude.integrity, 33, 'capped at max');
  assert.equal(rested.state.party.outing.heroes.codex.rattled, false);
  assert.deepEqual(after.satchel.tonics, { cordial: 1, brew: 1 });
  assert.equal(after.party.roster.claude.gifts.margin, 1);
  assert.equal(after.party.roster.codex.gifts.spare, 1);
});

test('a Breather and afterFight need the content and rules, and say so instead of skipping what they can’t do', () => {
  const state = makeState();
  assert.throws(() => party.breather(state, NOW, { rules, where: 'victory', fightId: 'f' }), /party\.breather needs \{ content, rules \}/);
  assert.throws(() => party.breather(state, NOW, { content, where: 'lantern' }), /needs \{ content, rules \}/);
  assert.throws(() => party.afterFight(state, battleOf(state), WON, NOW), /party\.afterFight needs \{ content, rules \}/);
  assert.throws(() => party.afterFight(state, battleOf(state), WON, NOW, { rules }), /needs \{ content, rules \}/);
  // With them, a Breather brings back what the contract's bare arguments couldn't: pact charges and per-Breather uses.
  const a = rift(41, [STRAY('void', 'shy', { archetype: 'floater' })]);
  const r = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: a }, NOW, opts);
  let s = { ...r.state, party: { ...r.state.party, chosen: [r.regular.id] } };
  const battle = battleOf(s);
  battle.units = battle.units.map((u) => ({ ...u, charges: { ...u.charges, left: 0 }, uses: Object.fromEntries(Object.keys(u.uses).map((k) => [k, 0])) }));
  s = party.afterFight(s, battle, WON, NOW, opts);
  assert.equal(spec(s, r.regular.id).charges.left, 0);
  assert.equal(spec(s, 'milo').uses['tripping-cut'], 0);
  s = party.breather(s, NOW, { ...opts, where: 'victory', fightId: 'f1' }).state;
  assert.deepEqual([spec(s, r.regular.id).charges.left, spec(s, r.regular.id).charges.max], [2, 2], 'a Weaver’s pact charges all come back');
  assert.equal(spec(s, 'milo').uses['tripping-cut'], 1, 'a weapon art is once a Breather');
  assert.equal(spec(s, 'milo').uses['stand-in-my-light'], 0, 'a per-Campfire use waits for the Campfire');
});

test('once-a-fight uses come back at every fight’s end, across fights and Breathers', () => {
  // Jev on the Gavel at level 11: Gavel: last word is once a fight.
  let state = withMember(makeState({ tier: 7, road: 11 }), 'jev', { path: 'gavel' });
  assert.equal(spec(state, 'jev').uses['gavel-last-word'], 1);
  for (let fight = 1; fight <= 3; fight += 1) {
    const battle = battleOf(state);
    battle.units = battle.units.map((u) => (u.id === 'jev' ? { ...u, uses: { ...u.uses, 'gavel-last-word': 0 } } : u));
    state = party.afterFight(state, battle, WON, NOW + fight, opts);
    assert.equal(state.party.outing.heroes.jev.uses['gavel-last-word'], undefined, `fight ${fight}: nothing once-a-fight is saved`);
    assert.equal(spec(state, 'jev').uses['gavel-last-word'], 1, `fight ${fight + 1} starts with it back`);
  }
  state = party.breather(state, NOW + 10, { ...opts, where: 'victory', fightId: 'f3' }).state;
  assert.equal(spec(state, 'jev').uses['gavel-last-word'], 1, 'and after a Breather');
  // A saved zero from an older save is ignored too.
  const old = { ...state, party: { ...state.party, outing: { ...state.party.outing, heroes: { jev: { uses: { 'gavel-last-word': 0 } } } } } };
  assert.equal(spec(old, 'jev').uses['gavel-last-word'], 1);
});

test('a Weaver’s burnt essences come off the satchel after the fight, and two Weavers never burn more than it holds', () => {
  const a = rift(31, [STRAY('void', 'shy', { archetype: 'floater' }), STRAY('void', 'polite', { archetype: 'floater' })]);
  let state = makeState({ tier: 2, essences: { 'Folded stars': 2, 'Neon shards': 1 } });
  const r = party.inviteRegular(state, { rift: a }, NOW, opts);
  state = { ...r.state, party: { ...r.state.party, chosen: ['claude', r.regular.id] } };
  const weaver = spec(state, r.regular.id);
  assert.equal(weaver.carry.essences, 3);
  assert.deepEqual(weaver.carry.stitched, ['folded', 'neon']);
  const battle = battleOf(state);
  const i = battle.units.findIndex((u) => u.id === r.regular.id);
  battle.units[i] = { ...battle.units[i], carry: { ...battle.units[i].carry, essences: 2 } };
  const after = party.afterFight(state, battle, WON, NOW, opts);
  const count = (s) => Object.values(s.satchel.essences).reduce((sum, n) => sum + n, 0);
  assert.equal(count(after), 2, 'one burnt, one gone');
  // Two Weavers and one essence: the first carries it, the second carries none while the first can still burn.
  let two = makeState({ tier: 3, essences: { 'Folded stars': 1 } });
  const r1 = party.inviteRegular(two, { rift: a, stray: 0 }, NOW, opts);
  const r2 = party.inviteRegular(r1.state, { rift: a, stray: 1 }, NOW, opts);
  assert.ok(r1.ok && r2.ok);
  two = { ...r2.state, party: { ...r2.state.party, chosen: [r1.regular.id, r2.regular.id] } };
  assert.deepEqual([spec(two, r1.regular.id).carry.essences, spec(two, r2.regular.id).carry.essences], [1, 0]);
  // The second still knows the genre stitched, for Borrow a rule: stitched is what the party has, essences what it may burn.
  assert.deepEqual([spec(two, r1.regular.id).carry.stitched, spec(two, r2.regular.id).carry.stitched], [['folded'], ['folded']]);
  const both = battleOf(two);
  both.units = both.units.map((u) => (u.calling === 'weaver' ? { ...u, carry: { ...u.carry, essences: 0 } } : u));
  const spent = party.afterFight(two, both, WON, NOW, opts);
  assert.equal(count(spent), 0, 'the one essence is gone, and nothing more');
  // Once the first has burnt this Campfire, the second carries it.
  const burntFirst = { ...two, party: { ...two.party, outing: { ...two.party.outing, heroes: { [r1.regular.id]: { uses: { 'burn-an-essence': 0 } } } } } };
  assert.deepEqual([spec(burntFirst, r1.regular.id).carry.essences, spec(burntFirst, r2.regular.id).carry.essences], [1, 1]);
});

test('Campfires: free at the muster and at home, a lantern once a real day outside any Elsewhere, a nook once each', () => {
  let state = makeState();
  let r = party.campfire(state, NOW, { where: 'lantern', lanternId: 'lantern:1' });
  assert.equal(r.ok, true);
  const again = party.campfire(r.state, NOW + 60_000, { where: 'lantern', lanternId: 'lantern:2' });
  assert.equal(again.ok, false);
  assertCalm(again.reason, 'lantern refusal');
  assert.equal(party.campfire(r.state, NOW + DAY, { where: 'lantern' }).ok, true, 'the next day');
  assert.equal(party.campfire(r.state, NOW, { where: 'home' }).ok, true, 'home’s fire is always free');
  const inside = { ...state, expedition: { riftId: 'rift:abc', inside: true, battle: null } };
  assert.equal(party.campfire(inside, NOW, { where: 'lantern' }).ok, false);
  r = party.campfire(inside, NOW, { where: 'nook', riftId: 'rift:abc' });
  assert.equal(r.ok, true);
  assert.equal(r.state.expedition.nookUsed, true);
  assert.equal(party.campfire(r.state, NOW, { where: 'nook', riftId: 'rift:abc' }).ok, false);
});

// ---------------------------------------------------------------------------
// Settings, rules, paths, boons and Pages

test('maxRules gives 1, 3 and 6 at Warding 0, 15 and 50, and setRules refuses past it', () => {
  assert.equal(party.maxRules(makeState()), 1);
  assert.equal(party.maxRules(makeState({ warding: 14 })), 1);
  assert.equal(party.maxRules(makeState({ warding: 15 })), 3);
  assert.equal(party.maxRules(makeState({ warding: 50 })), 6);
  const rule = { if: 'ally-below-half', then: 'patch-them' };
  const one = party.setRules(makeState(), 'claude', [rule], NOW);
  assert.deepEqual(one.party.roster.claude.notebook.rules, [rule]);
  const two = party.setRules(makeState(), 'claude', [rule, { if: 'foe-hurt', then: 'strike-it' }], NOW);
  assert.equal(two.party.roster.claude.notebook.rules.length, 0, 'refused past 1');
  assert.equal(party.setRules(makeState({ warding: 15 }), 'claude', [rule, rule, rule], NOW).party.roster.claude.notebook.rules.length, 3);
  const fresh = makeState({ warding: 15 });
  for (const bad of [[null], ['ally-below-half'], [{ if: 'Ally below half', then: 'patch-them' }], [{ if: 'ally-below-half' }], [rule, { if: 'x', then: '<b>' }]]) {
    assert.equal(party.setRules(fresh, 'claude', bad, NOW), fresh, `refused: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(party.setRules(fresh, 'claude', [{ ...rule, why: 'extra' }], NOW).party.roster.claude.notebook.rules, [rule], 'only if and then are kept');
  assert.equal(party.setFormation(makeState(), 'wedge', NOW).party.formation, 'line', 'Wedge waits for Warding 5');
  assert.equal(party.setFormation(makeState({ warding: 5 }), 'wedge', NOW).party.formation, 'wedge');
});

test('swapPath, swapBoon and preparePages (Wit + level) happen at camp only', () => {
  const inside = (s) => ({ ...s, expedition: { riftId: 'rift:abc', inside: true, battle: null } });
  let milo = withMember(makeState({ road: 3 }), 'milo', { path: 'hearth', boons: ['early-riser'] });
  assert.equal(party.swapPath(milo, 'milo', 'wick', NOW, { content }).party.roster.milo.path, 'wick');
  assert.equal(party.swapPath(inside(milo), 'milo', 'wick', NOW, { content }).party.roster.milo.path, 'hearth', 'not mid-dungeon');
  const scribe = withMember(makeState({ byCrew: { claude: 15 } }), 'claude', { path: 'three-pens' });
  assert.equal(party.swapPath(scribe, 'claude', 'footnote', NOW, { content }), scribe, 'a companion’s second path waits for Friend warmth (Phase 5)');
  assert.deepEqual(party.swapBoon(milo, 'milo', 'early-riser', 'good-boots', NOW, { content }).party.roster.milo.boons, ['good-boots']);
  const away = inside(milo);
  assert.equal(party.swapBoon(away, 'milo', 'early-riser', 'good-boots', NOW, { content }), away);
  for (const to of ['mote', 'hooklight', 'ability-up', 'ability-up-luck', 'wick']) assert.equal(party.swapBoon(milo, 'milo', 'early-riser', to, NOW, { content }), milo, `${to} isn’t a boon`);
  const two = withMember(milo, 'milo', { boons: ['early-riser', 'good-boots'] });
  assert.equal(party.swapBoon(two, 'milo', 'early-riser', 'good-boots', NOW, { content }), two, 'a boon already held');
  assert.equal(party.swapBoon(milo, 'milo', 'steady-hands', 'good-boots', NOW, { content }), milo, 'only a boon held can be swapped');
  milo = party.swapBoon(milo, 'milo', 'early-riser', 'ability-up-heed', NOW, { content });
  assert.equal(spec(milo, 'milo').abilities.heed, 4, 'an ability up is applied to the spec');
  // Pages: Wit (3) + level (1) spells, circle 1 at level 1.
  const state = makeState();
  const four = ['salve', 'kind-word', 'inkdarts', 'lullaby'];
  const prepared = party.preparePages(state, 'claude', four, NOW, { ...opts, where: 'camp' });
  assert.deepEqual(prepared.party.roster.claude.prepared, four);
  assert.equal(party.preparePages(state, 'claude', [...four, 'tangleweed'], NOW, { ...opts, where: 'camp' }), state, 'Wit + level at most');
  assert.equal(party.preparePages(state, 'claude', ['hold-still'], NOW, { ...opts, where: 'camp' }), state, 'circle 2 waits for level 3');
  const out = inside(state);
  assert.equal(party.preparePages(out, 'claude', four, NOW, { ...opts, where: 'camp' }), out, 'never mid-dungeon');
  assert.equal(party.preparePages(state, 'claude', four, NOW, { ...opts, where: 'fight' }), state);
  assert.ok(party.preparePages(state, 'claude', four, NOW, { ...opts, where: 'lantern' }) !== state, 'a lantern works too');
  const s = spec(prepared, 'claude');
  for (const id of four) assert.ok(s.abilityIds.includes(id), `${id} is on her Pages`);
  assert.ok(!s.abilityIds.includes('tangleweed'), 'unprepared spells aren’t');
  assert.ok(s.abilityIds.includes('full-stop') && s.abilityIds.includes('ink-blot'), 'knacks need no Pages');
  const fresh = spec(state, 'claude');
  assert.deepEqual(['salve', 'kind-word', 'inkdarts', 'sudden-shelter'].map((id) => fresh.abilityIds.includes(id)), [true, true, true, true], 'until she prepares them, the first Wit + level in her list');
  assert.ok(!fresh.abilityIds.includes('lullaby'));
});

test('Level up offers a path at 3 (Milo his three) and boons at 4, 8 and 12, and never while a fight is live', () => {
  assert.deepEqual(party.pendingChoices(makeState({ tier: 2, road: 2 }), 'milo', opts), [], 'nothing waits at level 2');
  assert.deepEqual(party.pendingChoices(makeState({ tier: 2, road: 3 }), 'milo', opts).map((p) => p.kind), ['path'], 'a path at 3');
  let state = makeState({ tier: 2, road: 4 });
  const pending = party.pendingChoices(state, 'milo', opts);
  assert.deepEqual(pending.map((p) => p.kind), ['path', 'boon']);
  assert.deepEqual(pending[0].options.map((o) => o.id), ['hearth', 'wick', 'wayward']);
  const wit = pending[1].options.find((o) => o.id === 'ability-up-wit');
  assert.deepEqual([wit.name, wit.text], ['Ability up: Wit', '+1 Wit, never above 5.']);
  for (const o of pending[1].options) assertCalm(o.name, 'boon name', { proper: ['Ability', 'Might', 'Grace', 'Grit', 'Wit', 'Heed', 'Charm', 'Good', 'Early', 'Steady'] });
  const live = { ...state, expedition: { riftId: 'rift:a', inside: true, battle: { v: 2, id: 'x' } } };
  assert.equal(party.levelUp(live, 'milo', { kind: 'path', id: 'wick' }, NOW, opts), live);
  state = party.levelUp(state, 'milo', { kind: 'path', id: 'wick' }, NOW, opts);
  state = party.levelUp(state, 'milo', { kind: 'boon', id: 'good-boots' }, NOW, opts);
  assert.equal(state.party.roster.milo.path, 'wick');
  assert.deepEqual(state.party.roster.milo.boons, ['good-boots']);
  assert.deepEqual(party.pendingChoices(state, 'milo', opts), []);
  // At 8 and 12 another boon waits, never one already held, though an Ability up can come again.
  const boonsAt = (s, level) => party.pendingChoices({ ...s, hearth: { tier: 7 }, road: { ...s.road, xp: ROAD_XP[level - 1] } }, 'milo', opts).find((p) => p.kind === 'boon').options.map((o) => o.id);
  assert.deepEqual(boonsAt(state, 8).filter((b) => !b.startsWith('ability-up-')), ['early-riser', 'steady-hands'], 'Good boots is held');
  const upped = withMember(state, 'milo', { boons: ['good-boots', 'ability-up-wit'] });
  assert.deepEqual(boonsAt(upped, 12).filter((b) => !b.startsWith('ability-up-')), ['early-riser', 'steady-hands']);
  assert.ok(boonsAt(upped, 12).includes('ability-up-wit'));
  assert.deepEqual(party.pendingChoices(state, 'claude', opts).map((p) => p.kind), ['path'], 'the Scribe fights at Road level 4 − 1 and picks a path');
  const paged = party.preparePages(state, 'claude', ['salve'], NOW, { ...opts, where: 'camp' });
  assert.deepEqual(party.pendingChoices(paged, 'claude', opts).map((p) => p.kind), ['path', 'spells'], 'room on her Pages waits to be written');
});

test('settings: control, reactions, mode, play and the calm switches', () => {
  let state = makeState();
  state = party.setControl(state, 'claude', 'mine', NOW);
  assert.equal(spec(state, 'claude').control, 'mine');
  state = party.setReaction(state, 'claude', 'shoulder', 'never', NOW);
  assert.equal(spec(state, 'claude').reactions.shoulder, 'never');
  for (const [rid, setting] of [['shoulder', 'sometimes'], ['shoulder', 'Always'], ['Shoulder', 'ask'], ['__proto__', 'ask'], ['a'.repeat(41), 'ask'], [7, 'ask']]) {
    assert.equal(party.setReaction(state, 'claude', rid, setting, NOW), state, `${String(rid).slice(0, 12)} / ${setting} is refused`);
  }
  assert.equal(party.setReaction(state, 'rivet', 'shoulder', 'ask', NOW), state, 'only someone on the roster');
  assert.equal(party.setMode(state, 'mauds-table', NOW).party.mode, 'mauds-table');
  assert.equal(party.setMode(state, 'hard', NOW), state);
  const command = party.setPlay(state, 'command', NOW);
  assert.equal(spec(command, 'jev').control, 'mine', 'Command sets everyone to Mine');
  assert.equal(spec(command, 'milo').control, 'mine', 'Milo too');
  const choosing = party.setPlay(state, 'choose', NOW);
  assert.equal(spec(choosing, 'jev').control, 'choose');
  assert.equal(spec(choosing, 'claude').control, 'choose', 'over her own Mine');
  assert.equal(spec(choosing, 'milo').control, 'review', 'Let them choose leaves Milo with you');
  assert.equal(spec(party.setControl(choosing, 'milo', 'mine', NOW), 'milo').control, 'mine', 'as you set him');
  assert.deepEqual(party.setCalm(state, { noise: false, odds: 'words', playback: 3 }, NOW).party.calm, { ...state.party.calm, noise: false, odds: 'words' });
  assert.equal(party.setCalm(state, { noise: true }, NOW), state);
});

test('choose picks up to three from the roster, never Milo, and not while a fight is live', () => {
  let state = party.recruit(makeState(), 'tollkeeper', NOW, { content });
  assert.equal(state.story.trails['first-trail'].joinedAt, NOW, 'joining ends the first trail');
  state = party.choose(state, ['tollkeeper', 'milo', 'claude', 'claude', 'jev', 'codex'], NOW);
  assert.deepEqual(state.party.chosen, ['tollkeeper', 'claude', 'jev']);
  const live = { ...state, expedition: { battle: { v: 2, id: 'x' } } };
  assert.equal(party.choose(live, ['codex'], NOW), live);
  assert.equal(party.recruit(state, 'rivet', NOW, { content }), state, 'Rivet joins from Phase 5');
  assert.equal(party.recruit(state, 'tollkeeper', NOW, { content }), state, 'already here');
  assert.deepEqual(party.partySpecs(state, opts).map((s) => s.id), ['milo', 'tollkeeper', 'claude', 'jev']);
});

// §18.2 item 13: story.trails[…].joinedAt has one writer, E's markJoined, and recruit calls it.
test('recruiting records the join through E’s markJoined: the trail trails.json ends with them, once', async () => {
  const { markJoined } = await import('../src/world/trail.js');
  const trails = read('trails.json');
  const joined = (c) => party.recruit(makeState(), 'tollkeeper', NOW, { content: c });
  const roster = (s) => ({ ...s, party: { ...s.party, roster: { ...s.party.roster, tollkeeper: joined(content).party.roster.tollkeeper } } });
  assert.deepEqual(joined({ ...content, trails }), markJoined(roster(makeState()), trails, 'tollkeeper', NOW), 'exactly markJoined’s write');
  // A trail trails.json renames is the one that ends; the companion file's own trail id isn't read.
  const renamed = { ...content, trails: { ...trails, trails: trails.trails.map((t) => (t.end?.joins === 'tollkeeper' ? { ...t, id: 'river-trail' } : t)) } };
  assert.deepEqual(Object.keys(joined(renamed).story.trails), ['river-trail']);
  assert.equal(joined(renamed).story.trails['river-trail'].joinedAt, NOW);
  // A join already recorded keeps its first time.
  const before = { ...makeState(), story: { trails: { 'first-trail': { found: {}, done: {}, joinedAt: NOW - DAY } }, facts: {} } };
  assert.equal(party.recruit(before, 'tollkeeper', NOW, { content: { ...content, trails } }).story.trails['first-trail'].joinedAt, NOW - DAY);
  assert.equal(party.recruit(makeState(), 'tollkeeper', NOW).story.trails['first-trail'].joinedAt, NOW, 'without content, E’s own table');
});

test('the muster lists the company, suggests a party calmly, and swaps only outside a fight', () => {
  const state = party.recruit(makeState(), 'tollkeeper', NOW, { content });
  const view = party.musterView(state, { ...opts, now: NOW, destination: { kind: 'wild', genres: ['noir'], mechanic: 'red-herrings' } });
  assert.deepEqual(view.members.map((m) => m.id), ['claude', 'codex', 'jev', 'tollkeeper']);
  assert.equal(view.canSwap, true);
  assert.equal(view.suggestion.words, 'Noir rift with herrings to sort. Jev will want this one.');
  assert.equal(view.suggestion.ids[0], 'jev');
  for (const m of view.members) {
    assert.equal(m.sync, 0, 'an empty notebook is in sync with nothing yet');
    assertCalm(m.mood, 'mood');
  }
  assert.deepEqual(view.members.map((m) => m.fieldSkill), ['read', 'pick', 'sort', 'riddle'], 'Read, Pick, Sort and Riddle (§3.1)');
  const synced = party.noteAccepts(state, 'jev', [true, true, false, true], NOW);
  assert.equal(party.musterView(synced, opts).members.find((m) => m.id === 'jev').sync, 75, 'three of the last four drafts taken');
  assert.equal(party.suggestParty(state, { kind: 'cave', genres: [] }, { content }).words, 'Same as last time.');
  assertCalm(party.suggestParty(state, { kind: 'wild', genres: ['kaiju'] }, { content }).words, 'suggestion');
  // Nobody wants Void: a Void regular does, then whoever went last time, then the warmest.
  const reg = party.inviteRegular(makeState({ tier: 2 }), { rift: rift(88, [STRAY('void', 'shy', { name: 'Hollow' })]) }, NOW, opts);
  const suggest = (s) => party.suggestParty({ ...s, party: { ...s.party, chosen: [] } }, { kind: 'wild', genres: ['void'] }, { content });
  assert.deepEqual([suggest(reg.state).ids[0], suggest(reg.state).words], [reg.regular.id, 'Void rift. Hollow will want this one.']);
  const plain = (s) => party.suggestParty(s, { kind: 'wild', genres: ['verdant'] }, { content }).ids;
  assert.deepEqual(plain(party.choose(makeState(), ['codex'], NOW)), ['codex', 'claude', 'jev'], 'last time’s comes first');
  assert.deepEqual(plain(withMember(party.choose(makeState(), [], NOW), 'jev', { warmth: 20 })), ['jev', 'claude', 'codex'], 'then the warmest');
  assert.equal(party.musterView({ ...state, expedition: { inside: true, battle: null } }, opts).canSwap, false);
});

// ---------------------------------------------------------------------------
// Gifts, habits and notebooks

test('Margin Notes and Spare Parts come one per session watched to the end, up to 3 held, with a day’s habit warmth', () => {
  let state = makeState({ byCrew: { claude: 10, codex: 4 } });
  state = party.topUpCrewGifts(state, NOW);
  assert.equal(state.party.roster.claude.gifts.through, 10, 'the first look only seeds the mark');
  assert.equal(state.party.roster.claude.gifts.margin, 0);
  state = { ...state, tally: { ...state.tally, byCrew: { ...state.tally.byCrew, claude: 12, codex: 9 } } };
  state = party.topUpCrewGifts(state, NOW);
  assert.equal(state.party.roster.claude.gifts.margin, 2);
  assert.equal(state.party.roster.codex.gifts.spare, 3, 'at most 3 held');
  assert.equal(state.party.roster.claude.warmth, 1, 'the Scribe’s habit warms her once today');
  assert.equal(party.topUpCrewGifts(state, NOW + 1000), state, 'nothing new, nothing changes');
  assert.equal(spec(state, 'claude').carry.margin, 2);
  assert.ok(spec(state, 'claude').abilityIds.includes('margin-note'));
  // The Tollkeeper warms on a day a feature is tried for the first time.
  let toll = party.recruit(makeState(), 'tollkeeper', NOW, { content });
  toll = party.topUpCrewGifts(toll, NOW);
  toll = { ...toll, tally: { ...toll.tally, features: { kindle: NOW - 3 * DAY } } };
  assert.equal(party.topUpCrewGifts(toll, NOW).party.roster.tollkeeper.warmth, 0);
  toll = { ...toll, tally: { ...toll.tally, features: { kindle: NOW - 3 * DAY, chronicle: NOW - 60_000 } } };
  assert.equal(party.topUpCrewGifts(toll, NOW).party.roster.tollkeeper.warmth, 1);
});

test('strike-out stops at 40 and never un-strikes; accepts keep the last 50; a reset keeps the old count until the next Campfire', () => {
  let state = makeState();
  for (const key of ['not-a-habit', '1:2:3', 12, '1234:1']) assert.equal(party.strikeOut(state, 'claude', key, NOW), state, `${key} isn’t a habit key`);
  for (let i = 0; i < 45; i += 1) state = party.strikeOut(state, 'claude', `${i}:1`, NOW);
  assert.equal(state.party.roster.claude.notebook.struck.length, 40);
  assert.equal(party.strikeOut(state, 'claude', '3:1', NOW), state, 'striking again changes nothing');
  assert.equal(party.strikeOut(state, 'claude', '99:1', NOW), state, 'a 41st is refused');
  state = party.unstrike(state, 'claude', '3:1', NOW);
  assert.equal(state.party.roster.claude.notebook.struck.length, 39, 'only Chris takes a strike back');
  for (let i = 0; i < 30; i += 1) state = party.noteAccepts(state, 'claude', [true, false], NOW);
  assert.equal(state.party.roster.claude.notebook.accepts.length, 50);
  assert.equal(party.musterView(state, opts).members.find((m) => m.id === 'claude').sync, 50);
  state = party.noteGrowth(state, 'claude', 12, NOW, { fight: true });
  const reset = party.resetNotebook(state, 'claude', NOW);
  assert.equal(reset.party.roster.claude.notebook.count, 0);
  assert.equal(reset.party.roster.claude.notebook.previous.count, 12);
  assert.equal(party.restoreNotebook(reset, 'claude', NOW).party.roster.claude.notebook.count, 12);
  // A relaunch between the reset and the restore brings back the fight count and the accepts too.
  const before = state.party.roster.claude.notebook;
  const relaunched = { ...reset, ...normalize4(JSON.parse(JSON.stringify(reset)), { now: NOW, tally: reset.tally }) };
  const back = party.restoreNotebook(relaunched, 'claude', NOW).party.roster.claude.notebook;
  assert.deepEqual([back.count, back.fights, back.accepts], [12, before.fights, before.accepts]);
  assert.equal(before.fights, 1);
  assert.equal(back.accepts.length, 50);
  assert.deepEqual([back.previous, back.previousMeta], [null, null]);
  const camped = party.campfire(reset, NOW, { where: 'home' }).state;
  assert.equal(camped.party.roster.claude.notebook.previousMeta, null);
  assert.equal(camped.party.roster.claude.notebook.previous, null, 'kept only until the next Campfire');
  assert.equal(party.restoreNotebook(camped, 'claude', NOW), camped);
});

test('B’s ability index takes all of C’s content, and every ability a hero may use resolves in it', async () => {
  const { buildAbilityIndex } = await import('../src/combat/abilities.js');
  const index = buildAbilityIndex({
    callings: content.combat.callings, spells: content.combat.spells, companions: content.party.companions,
    regulars: content.party.regulars, foes: content.combat.foes, leads: content.combat.leads,
  });
  let state = party.recruit(makeState({ tier: 2, road: 5, byCrew: { claude: 520, codex: 520 } }), 'tollkeeper', NOW, { content });
  for (const [id, path] of [['milo', 'wayward'], ['claude', 'footnote'], ['codex', 'slate'], ['jev', 'courier'], ['tollkeeper', 'troll-kin']]) state = withMember(state, id, { path });
  for (const id of ['milo', 'claude', 'codex', 'jev', 'tollkeeper']) {
    const withIndex = spec(state, id, { abilities: index });
    assert.deepEqual(withIndex, spec(state, id), `${id} reads the same through the index`);
    for (const aid of withIndex.abilityIds) assert.ok(index.get(aid), `${id}’s ${aid} is in the index`);
    for (const rid of Object.keys(withIndex.reactions)) assert.ok(['parting-swipe', 'shoulder', 'ready'].includes(rid) || index.get(rid)?.reaction, `${id}’s reaction ${rid}`);
  }
});

// ---------------------------------------------------------------------------
// Through B's kernel: C's content does what it says in a real Battle

async function kernel() {
  const { buildAbilityIndex } = await import('../src/combat/abilities.js');
  const { applyUse } = await import('../src/combat/effects.js');
  const { foldBars } = await import('../src/combat/heat.js');
  const kit = await import('./combat-kit.js');
  const index = buildAbilityIndex({
    callings: content.combat.callings, spells: content.combat.spells, companions: content.party.companions,
    regulars: content.party.regulars, foes: content.combat.foes, leads: content.combat.leads,
  });
  const ctx = kit.makeCtx({ abilityIndex: index });
  const battle = (state, foes = [kit.stray('f0', { x: 13, y: 4 })]) => kit.createBattle(kit.fightSpec({ foes }), party.partySpecs(state, { ...opts, abilities: index }), { roadLevel: party.roadLevel(state, rules).level }, ctx);
  const use = (b, unitId, abilityId, target) => applyUse(b, unitId, index.get(abilityId), { target }, ctx);
  return { index, ctx, battle, use, foldBars, kit, unit: (b, id) => b.units.find((u) => u.id === id) };
}

test('through the kernel: Wayward step takes Milo to the tile he picks, once a Breather', async () => {
  const k = await kernel();
  const state = withMember(makeState({ tier: 2, road: 3 }), 'milo', { path: 'wayward' });
  const b = k.battle(state);
  const milo = k.unit(b, 'milo');
  assert.equal(milo.uses['wayward-step'], 1);
  const to = { x: milo.x + 6, y: milo.y };
  const after = k.use(b, 'milo', 'wayward-step', { tile: to });
  assert.deepEqual([k.unit(after.battle, 'milo').x, k.unit(after.battle, 'milo').y], [to.x, to.y], 'he steps into the mote’s tile');
  assert.equal(k.unit(after.battle, 'milo').uses['wayward-step'], 0);
  assert.ok(after.events.some((e) => e.t === 'move' && e.unit === 'milo'));
});

test('through the kernel: Burn an essence spends exactly one essence for one pact charge, and afterFight takes one off the satchel', async () => {
  const k = await kernel();
  const a = rift(51, [STRAY('void', 'shy', { archetype: 'floater' })]);
  for (const held of [1, 2]) {
    const r = party.inviteRegular(makeState({ tier: 2, road: 3, essences: { 'Folded stars': held } }), { rift: a }, NOW, opts);
    const state = { ...r.state, party: { ...r.state.party, chosen: [r.regular.id] } };
    let b = k.battle(state);
    const { legalActions } = await import('../src/combat/abilities.js');
    assert.equal(legalActions(b, r.regular.id, k.ctx).find((o) => o.action.ability === 'burn-an-essence').why, null, 'it can be picked');
    b = { ...b, units: b.units.map((u) => (u.id === r.regular.id ? { ...u, charges: { ...u.charges, left: 0 } } : u)) };
    const after = k.use(b, r.regular.id, 'burn-an-essence', null);
    const weaver = k.unit(after.battle, r.regular.id);
    assert.equal(weaver.carry.essences, held - 1, `${held} carried: one spent`);
    assert.equal(weaver.charges.left, 1, `${held} carried: one charge gained`);
    const home = party.afterFight(state, after.battle, WON, NOW, opts);
    assert.equal(home.satchel.essences['Folded stars'] ?? 0, held - 1, `${held} in the satchel: one comes off`);
  }
  // With none carried it isn't offered at all.
  const r = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: a }, NOW, opts);
  const empty = k.battle({ ...r.state, party: { ...r.state.party, chosen: [r.regular.id] } });
  const { legalActions } = await import('../src/combat/abilities.js');
  const offer = legalActions(empty, r.regular.id, k.ctx).find((o) => o.action.ability === 'burn-an-essence');
  assert.ok(offer, 'every Weaver knows it');
  assert.ok(offer.why, 'but with no essence carried it can’t be picked');
});

// §18.2 item 6: a choice's own `meets` wins, so Borrow a rule's Titan stomp meets body Resolve.
test('through the kernel: Borrow a rule’s Titan stomp meets body Resolve, and its other rules keep the ability’s mind', async () => {
  const k = await kernel();
  const { pkFor, makeRun } = await import('../src/combat/effects.js');
  const r = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: rift(52, [STRAY('void', 'shy', { archetype: 'floater' })]) }, NOW, opts);
  const b = k.battle({ ...r.state, party: { ...r.state.party, chosen: [r.regular.id] } });
  const borrow = k.index.get('borrow-a-rule');
  assert.ok(k.unit(b, r.regular.id).abilityIds.includes('borrow-a-rule'));
  const meets = (choice) => pkFor(makeRun(b, k.ctx), k.unit(b, r.regular.id), borrow, k.unit(b, 'f0'), { choice }).meets;
  assert.equal(meets('kaiju'), 'body', 'a stomp is met with the body');
  for (const choice of Object.keys(borrow.choices).filter((c) => c !== 'kaiju')) assert.equal(meets(choice), 'mind', choice);
});

test('through the kernel: each trick’s own pick is one degree better than its signature’s', async () => {
  const k = await kernel();
  // The five signatures that pick an outcome; Ground shake's burst needs its foe beside the regular (at 1, 2).
  for (const [genre, sig, at, target] of [['neon', 'static-snap', { x: 6, y: 2 }, { unit: 'f0' }], ['gothic', 'candle-hush', { x: 6, y: 2 }, { unit: 'f0' }],
    ['noir', 'hunch', { x: 6, y: 2 }, { unit: 'f0' }], ['frontier', 'fast-hands', { x: 6, y: 2 }, { unit: 'f0' }], ['kaiju', 'ground-shake', { x: 2, y: 2 }, null]]) {
    const lead = { ...rift(61, [STRAY(genre, 'shy')]), taleLead: { genre, name: 'The Big One', mechanic: 'none' } };
    const r = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: lead, lead: true }, NOW, opts);
    const b = k.battle({ ...r.state, party: { ...r.state.party, chosen: [r.regular.id] } }, [k.kit.stray('f0', at)]);
    assert.ok(k.unit(b, r.regular.id).abilityIds.includes(`${sig}-trick`), `${genre}: the lead’s trick`);
    const bars = (id) => k.use(b, r.regular.id, id, target).events.find((e) => e.t === 'outcome' && e.target === 'f0')?.bars;
    assert.ok(bars(sig), `${sig} picks an outcome on f0`);
    assert.deepEqual(bars(`${sig}-trick`), k.foldBars(bars(sig), { sure: true }), `${sig}-trick lands one degree better`);
  }
});

test('through the kernel: a trick’s +1 degree lasts only for its own action, even when it catches no foe', async () => {
  const k = await kernel();
  const lead = { ...rift(63, [STRAY('kaiju', 'shy')]), taleLead: { genre: 'kaiju', name: 'Big Stomp', mechanic: 'none' } };
  const r = party.inviteRegular(makeState({ tier: 2, road: 3 }), { rift: lead, lead: true }, NOW, opts);
  const id = r.regular.id;
  let b = k.battle({ ...r.state, party: { ...r.state.party, chosen: [id] } });
  assert.ok(k.unit(b, id).abilityIds.includes('ground-shake-trick'));
  b = k.kit.play(b, [{ t: 'plan', unitId: id, plan: k.kit.plan(id, [k.kit.A.use('ground-shake-trick', null, { cost: 2 })]) }, { t: 'commit' }], k.ctx).battle;
  let acted = null;
  for (let i = 0; i < 50 && !acted && (b.status === 'running' || b.status === 'asking'); i += 1) {
    const step = k.kit.apply(b, b.status === 'asking' ? { t: 'answer', yes: true } : { t: 'step' }, k.ctx);
    b = step.battle;
    if (step.events.some((e) => e.t === 'act' && e.unit === id)) acted = step;
  }
  assert.ok(acted, 'the regular used its trick');
  assert.equal(k.unit(b, id).uses['ground-shake-trick'], 0, 'once a fight');
  assert.ok(!acted.events.some((e) => e.t === 'outcome'), 'with nobody beside it, nothing was picked');
  assert.deepEqual(k.unit(b, id).mods.filter((m) => m.stat === 'degree-next-on-foe'), [], 'and the +1 degree ended with the action, so it never lifts the next attack');
});

test('through the kernel: a Weaver who carries no essence can’t pick Burn an essence, though a genre is stitched (B’s abilityWhy)', async () => {
  const k = await kernel();
  const { legalActions } = await import('../src/combat/abilities.js');
  const a = rift(31, [STRAY('void', 'shy', { archetype: 'floater' }), STRAY('void', 'polite', { archetype: 'floater' })]);
  const r1 = party.inviteRegular(makeState({ tier: 3, road: 3, essences: { 'Folded stars': 1 } }), { rift: a, stray: 0 }, NOW, opts);
  const r2 = party.inviteRegular(r1.state, { rift: a, stray: 1 }, NOW, opts);
  const b = k.battle({ ...r2.state, party: { ...r2.state.party, chosen: [r1.regular.id, r2.regular.id] } });
  const burn = (id) => legalActions(b, id, k.ctx).find((o) => o.action.ability === 'burn-an-essence');
  assert.equal(burn(r1.regular.id).why, null, 'the first Weaver carries the one essence');
  assert.equal(k.unit(b, r2.regular.id).carry.essences, 0);
  assert.ok(burn(r2.regular.id).why, 'the second carries none, so its burn would spend the use for nothing');
});

const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
};

test('every step returns the same object when nothing changed, and never mutates its input, however deep', () => {
  const plain = deepFreeze(makeState());
  assert.equal(party.choose(plain, plain.party.chosen, NOW), plain);
  assert.equal(party.setFormation(plain, 'line', NOW), plain);
  assert.equal(party.addCheer(plain, 0, NOW), plain);
  assert.equal(party.noteAccepts(plain, 'claude', [], NOW), plain);
  assert.equal(party.resetNotebook(plain, 'claude', NOW), plain);
  // A state mid-outing, frozen all the way down: every step still works, on copies.
  let busy = makeState({ tier: 2, road: 3, tonics: { cordial: 2, brew: 1 }, essences: { 'Neon shards': 2 } });
  busy = party.recruit(busy, 'tollkeeper', NOW, { content });
  busy = party.noteGrowth(party.noteAccepts(busy, 'claude', [true, false], NOW), 'claude', 3, NOW, { fight: true });
  busy = { ...busy, party: { ...busy.party, chosen: ['claude', 'tollkeeper'], outing: { ...busy.party.outing, heroes: { milo: { max: 41, integrity: 10, charges: 1, uses: { 'tripping-cut': 0 }, rattled: true } } } } };
  const battle = deepFreeze(battleOf(busy));
  const frozen = deepFreeze(busy);
  const copy = JSON.stringify(frozen);
  const after = party.afterFight(frozen, battle, WON, NOW, opts);
  assert.notEqual(after.party.outing.heroes, frozen.party.outing.heroes, 'afterFight writes a new outing.heroes');
  party.breather(after, NOW, { ...opts, where: 'lantern' });
  party.breather(frozen, NOW, { ...opts, where: 'lantern' });
  party.campfire(frozen, NOW, { where: 'home' });
  party.wake(frozen, NOW);
  party.payFight(frozen, 'fight:rift:q:w:r0', { weight: 1, n: 1, deepRank: 0, essences: [{ name: 'Neon shards', genre: 'neon', qty: 1 }], tonics: { cordial: 1, brew: 0 } }, WON, NOW, { rules });
  party.payStitch(frozen, { kind: 'wild', level: 2, depth: 1, key: 'stitch:rift:q' }, NOW, { rules });
  party.inviteRegular(frozen, { rift: rift(71, [STRAY('neon', 'shy')]) }, NOW, opts);
  party.levelUp(frozen, 'milo', { kind: 'path', id: 'wick' }, NOW, opts);
  party.restoreNotebook(party.resetNotebook(frozen, 'claude', NOW), 'claude', NOW);
  party.topUpCrewGifts(frozen, NOW);
  party.addWarmth(frozen, 'claude', 2, 'outing', NOW);
  party.musterView(frozen, { ...opts, now: NOW });
  party.partySpecs(frozen, opts);
  assert.equal(JSON.stringify(frozen), copy, 'the input is exactly as it was');
});

test('mood reads Tired only below full Integrity, and A little rattled while Rattled', () => {
  const state = makeState();
  const mood = (s, id) => party.musterView(s, { ...opts, now: NOW }).members.find((m) => m.id === id).mood;
  assert.equal(mood(state, 'claude'), 'Rested');
  const at = (integrity, rattled = false) => ({ ...state, party: { ...state.party, outing: { ...state.party.outing, heroes: { claude: { max: 16, integrity, charges: 2, uses: {}, rattled } } } } });
  assert.equal(mood(at(16), 'claude'), 'Rested', 'a fight fought at full Integrity leaves her rested');
  assert.equal(mood(at(15), 'claude'), 'Tired');
  assert.equal(mood(at(16, true), 'claude'), 'A little rattled');
});

test('a missing now never reads the wall clock: it counts as the epoch, the same every time', () => {
  const real = Date.now;
  Date.now = () => { throw new Error('party.js read the wall clock'); };
  try {
    let state = party.recruit(makeState({ byCrew: { claude: 3 } }), 'tollkeeper', NOW, { content });
    state = { ...state, tally: { ...state.tally, features: { kindle: 1000 } } };
    const warmed = party.addWarmth(state, 'claude', 2, 'outing', undefined);
    assert.deepEqual(warmed, party.addWarmth(state, 'claude', 2, 'outing', 0));
    assert.deepEqual(party.addWarmth(state, 'claude', 1, 'habit', null), party.addWarmth(state, 'claude', 1, 'habit', 0));
    assert.deepEqual(party.campfire(state, undefined, { where: 'lantern' }), party.campfire(state, 0, { where: 'lantern' }));
    assert.deepEqual(party.topUpCrewGifts(state, undefined), party.topUpCrewGifts(state, 0));
    assert.doesNotThrow(() => party.afterFight(party.campfire(state, 0, { where: 'home' }).state, battleOf(state), WON, undefined, opts));
    // Paying marks the key paid, so a missing now must still pay Warding and Seamcraft, exactly as the epoch does.
    for (const now of [undefined, null, Number.NaN]) {
      const fight = party.payFight(makeState(), 'fight:rift:m:w:r0', { weight: 2, n: 1, deepRank: 0 }, WON, now, { rules });
      assert.deepEqual([fight.xp, fight.state.road.xp, fight.state.xp.skills.warding], [20, 20, 20], `a fight at now ${now}`);
      assert.deepEqual(fight.state.xp, party.payFight(makeState(), 'fight:rift:m:w:r0', { weight: 2, n: 1, deepRank: 0 }, WON, 0, { rules }).state.xp);
      const wild = party.payStitch(makeState(), { kind: 'wild', level: 1, depth: 2, key: 'stitch:rift:m' }, now, { rules });
      assert.deepEqual([wild.xp, wild.state.xp.skills.warding, wild.state.xp.skills.seamcraft], [40, 40, 300 + 30 * 2], `a wild stitch at now ${now}`);
      const seeded = party.payRealStitches(makeState({ real: 1 }), now, { rules }).state;
      const real = party.payRealStitches({ ...seeded, rifts: { stitched: { real: 2, wild: 0, story: 0 } } }, now, { rules });
      assert.deepEqual([real.paid, real.state.xp.skills.warding, real.state.xp.skills.seamcraft], [1, 80, 500], `a real stitch at now ${now}`);
    }
  } finally {
    Date.now = real;
  }
});
