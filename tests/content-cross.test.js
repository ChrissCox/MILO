// Ids that one content file names in another, all resolving (CONTRACT-PHASE4.md §13 wave 3 L1,
// COMBAT.md §16.4): leads.json's hooks → companions and camp talks; trails → features and places;
// callings → abilities; the regulars' signatures and tricks; rules.json's and foes.json's ability
// ids; the companions' field skills, callings, paths, moves, reactions and personalities; camp
// scenes' and talks' people; and no combat name colliding with another thing in LORE's name index
// unless calm.js's ECHOES name it a deliberate echo. Each check is a function that returns its
// problems, run on the real content (no problems) and on a broken copy (the problem it must find).
//   node --test tests/content-cross.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loreIndex, normaliseName, ECHOES } from './calm.js';
import { buildAbilityIndex, REACTION_IDS, OBJECT_KINDS, CONDITION_IDS } from '../src/combat/abilities.js';
import { conditionName } from '../src/combat/describe.js';
import { PERSONALITIES } from '../src/combat/ai.js';
import { MECHANICS } from '../src/combat/leads.js';
import { STEP_KINDS, FEATURES, solveKnown, isPlace, LAST_BRIDGE_ID } from '../src/world/trail.js';
import { parseTalk, parseNeeds } from '../src/camp.js';
import { FIELD_SKILLS } from '../src/ui/menus.js';
import { FIELD_SKILLS as DOING } from '../src/ui/expedition.js';

const require = createRequire(import.meta.url);
const { loadContent } = require('../electron/content.cjs');
const content = await loadContent();
const clone = (v) => JSON.parse(JSON.stringify(v));
const companionsOf = (c) => c.party.companions;
const indexOf = (c) => buildAbilityIndex({
  callings: c.combat.callings, spells: c.combat.spells, companions: c.party.companions, regulars: c.party.regulars, foes: c.combat.foes, leads: c.combat.leads,
});
// A talk that won't parse is a problem of its own (the parser already refuses a [join] or [likes] for nobody).
const talksOf = (c, problems = []) => Object.fromEntries(Object.entries(c.camp.talks || {}).flatMap(([id, text]) => {
  try { return [[id, parseTalk(text)]]; } catch (error) { problems.push(`talk ${id}: ${error.message}`); return []; }
}));

// ---------------------------------------------------------------------------
// The checks

/** leads.json's hooks (a lead named for a companion on purpose): each names a companion and a camp talk. */
function hookProblems(c) {
  const out = [];
  const hooks = c.combat.leads.hooks;
  if (!Array.isArray(hooks)) return ['leads.json hooks isn’t a list'];
  for (const h of hooks) {
    if (typeof h?.name !== 'string' || !h.name) out.push(`a hook without a name: ${JSON.stringify(h)}`);
    if (!Object.hasOwn(companionsOf(c), h?.companion)) out.push(`hook ${h?.name}: no companion ${h?.companion}`);
    if (!Object.hasOwn(c.camp.talks || {}, h?.talk)) out.push(`hook ${h?.name}: no camp talk ${h?.talk}`);
  }
  return out;
}

/** Every trail step's solve names a feature or a real place, and its end a landmark, a talk and who joins. */
function trailProblems(c) {
  const out = [];
  const talks = c.camp.talks || {};
  for (const trail of c.trails.trails || []) {
    if (!Object.hasOwn(c.trails.tiers || {}, trail.tier)) out.push(`${trail.id}: no tier ${trail.tier}`);
    for (const step of trail.steps || []) {
      if (!STEP_KINDS.includes(step.solve?.kind)) out.push(`${trail.id}/${step.id}: no step kind ${step.solve?.kind}`);
      else if (!solveKnown(step.solve)) out.push(`${trail.id}/${step.id}: ${step.solve.kind} ${step.solve.target} names nothing real`);
      if (step.solve?.kind === 'feature' && !FEATURES.includes(step.solve.target)) out.push(`${trail.id}/${step.id}: no feature ${step.solve.target}`);
      if (!['chest', 'given'].includes(step.found)) out.push(`${trail.id}/${step.id}: found ${step.found}`);
    }
    const end = trail.end || {};
    if (end.landmark !== LAST_BRIDGE_ID && !isPlace(end.landmark)) out.push(`${trail.id}: no landmark ${end.landmark}`);
    if (!Object.hasOwn(talks, end.talk)) out.push(`${trail.id}: no talk ${end.talk}`);
    const joiner = companionsOf(c)[end.joins];
    if (!joiner) out.push(`${trail.id}: no companion ${end.joins} to join`);
    else if (joiner.joins?.trail !== trail.id) out.push(`${trail.id}: ${end.joins} doesn’t join by this trail`);
  }
  return out;
}

/** Callings, paths, weapon arts, boons, items and gifts: every id an ability. */
function callingProblems(c, index = indexOf(c)) {
  const out = [];
  const cc = c.combat.callings;
  const has = (aid, where) => { if (!index.has(aid)) out.push(`${where}: no ability ${aid}`); };
  for (const calling of cc.callings) {
    for (const [level, ids] of Object.entries(calling.levels || {})) for (const aid of ids) if (aid !== 'path' && aid !== 'boon') has(aid, `${calling.id} level ${level}`);
    for (const aid of calling.spells || []) has(aid, `${calling.id} spells`);
  }
  const callings = new Set(cc.callings.map((x) => x.id));
  for (const path of cc.paths) {
    if (!callings.has(path.calling)) out.push(`path ${path.id}: no calling ${path.calling}`);
    if (path.companion !== 'milo' && !Object.hasOwn(companionsOf(c), path.companion)) out.push(`path ${path.id}: no companion ${path.companion}`);
    for (const [level, ids] of Object.entries(path.levels || {})) for (const aid of ids) has(aid, `path ${path.id} level ${level}`);
  }
  for (const aid of Object.values(cc.weaponArts || {})) has(aid, 'weaponArts');
  for (const aid of cc.boons || []) has(aid, 'boons');
  for (const aid of cc.items || []) has(aid, 'items');
  for (const aid of Object.values(cc.gifts || {})) has(aid, 'gifts');
  return out;
}

const fightingGenres = (c) => Object.entries(c.combat.rules.genres).filter(([, g]) => g.fights).map(([id]) => id);

/** The regulars: a signature and a trick for every fighting genre, callings by archetype, personalities by temperament. */
function regularProblems(c, index = indexOf(c)) {
  const out = [];
  const r = c.party.regulars;
  for (const genre of fightingGenres(c)) {
    if (!index.has(r.signatures?.[genre])) out.push(`no signature for ${genre}: ${r.signatures?.[genre]}`);
    if (!index.has(r.tricks?.[genre])) out.push(`no trick for ${genre}: ${r.tricks?.[genre]}`);
  }
  for (const [genre, aid] of Object.entries({ ...r.signatures, ...r.tricks })) if (!index.has(aid)) out.push(`${genre}: no ability ${aid}`);
  const callings = new Set(c.combat.callings.callings.map((x) => x.id));
  for (const archetype of Object.keys(c.combat.rules.archetypes)) {
    if (!callings.has(r.callingByArchetype?.[archetype])) out.push(`${archetype}: no calling ${r.callingByArchetype?.[archetype]}`);
  }
  for (const temperament of Object.keys(c.combat.rules.temperaments)) {
    if (!Object.hasOwn(PERSONALITIES, r.personalityByTemperament?.[temperament])) out.push(`${temperament}: no personality ${r.personalityByTemperament?.[temperament]}`);
  }
  return out;
}

/** rules.json's archetype and genre moves, foes.json's moves, cave lists and borrows, and leads.json's objects. */
function foeProblems(c, index = indexOf(c)) {
  const out = [];
  const { rules, foes, leads } = c.combat;
  for (const [id, a] of Object.entries(rules.archetypes)) for (const aid of a.abilities || []) if (!index.has(aid)) out.push(`archetype ${id}: no ability ${aid}`);
  for (const [id, g] of Object.entries(rules.genres)) for (const aid of g.abilities || []) if (!index.has(aid)) out.push(`genre ${id}: no ability ${aid}`);
  for (const f of [...foes.canon, ...foes.creatures, foes.mimic]) for (const aid of f?.abilities || []) if (!index.has(aid)) out.push(`${f.id}: no ability ${aid}`);
  const known = new Set([...foes.canon, ...foes.creatures].map((f) => f.id));
  for (const [region, list] of Object.entries(foes.caves)) for (const fid of list) if (!known.has(fid)) out.push(`cave ${region}: no foe ${fid}`);
  for (const [region, to] of Object.entries(foes.borrow || {})) if (!Object.hasOwn(foes.caves, to)) out.push(`borrow ${region}: ${to} has no list`);
  for (const m of leads.mechanics) {
    for (const o of m.objects || []) if (!OBJECT_KINDS.includes(o.kind)) out.push(`${m.id}: no object kind ${o.kind}`);
    if (m.ships && !Object.hasOwn(MECHANICS, m.id)) out.push(`${m.id} ships with no mechanic in play`);
  }
  return out;
}

/** The companions: calling, paths, moves, reactions, personality, field skill, trail and team-ups. */
function companionProblems(c, index = indexOf(c)) {
  const out = [];
  const callings = new Set(c.combat.callings.callings.map((x) => x.id));
  const paths = new Set(c.combat.callings.paths.map((x) => x.id));
  const trails = new Set((c.trails.trails || []).map((t) => t.id));
  for (const [id, file] of Object.entries(companionsOf(c))) {
    if (file.id !== id) out.push(`${id}: its file says ${file.id}`);
    if (!callings.has(file.calling)) out.push(`${id}: no calling ${file.calling}`);
    for (const p of file.paths || []) if (!paths.has(p)) out.push(`${id}: no path ${p}`);
    for (const m of file.moves || []) if (!index.has(m)) out.push(`${id}: no move ${m}`);
    if (file.heartFeat && !index.has(file.heartFeat)) out.push(`${id}: no heart feat ${file.heartFeat}`);
    for (const r of Object.keys(file.reactions || {})) if (!REACTION_IDS.includes(r)) out.push(`${id}: no reaction ${r}`);
    if (file.personality && !Object.hasOwn(PERSONALITIES, file.personality)) out.push(`${id}: no personality ${file.personality}`);
    if (!Object.hasOwn(FIELD_SKILLS, file.fieldSkill)) out.push(`${id}: no field skill ${file.fieldSkill}`);
    else if (FIELD_SKILLS[file.fieldSkill].who !== id) out.push(`${id}: ${file.fieldSkill} belongs to ${FIELD_SKILLS[file.fieldSkill].who}`);
    if (file.joins?.trail && !trails.has(file.joins.trail)) out.push(`${id}: no trail ${file.joins.trail}`);
  }
  for (const t of c.party.teamups?.teamups || []) for (const m of t.members || []) if (!Object.hasOwn(companionsOf(c), m)) out.push(`team-up ${t.id}: no companion ${m}`);
  return out;
}

/** Camp scenes and talks: every person a companion (or a scene's generic regular), every need resolvable. */
function campProblems(c) {
  const out = [];
  const people = companionsOf(c);
  const trails = new Map((c.trails.trails || []).map((t) => [t.id, new Set((t.steps || []).map((s) => s.id))]));
  const need = (r, where) => {
    if ((r.kind === 'with' || r.kind === 'warmth') && !Object.hasOwn(people, r.id)) out.push(`${where}: no companion ${r.id}`);
    if (r.kind === 'trail') {
      const [trail, stepId] = String(r.id).split(':');
      if (!trails.get(trail)?.has(stepId)) out.push(`${where}: no trail step ${r.id}`);
    }
  };
  for (const scene of c.camp.scenes.scenes) {
    if (scene.who !== 'regular' && !Object.hasOwn(people, scene.who)) out.push(`scene ${scene.id}: no companion ${scene.who}`);
    for (const r of scene.needs ? parseNeeds(scene.needs) : []) need(r, `scene ${scene.id}`);
  }
  for (const [id, talk] of Object.entries(talksOf(c, out))) {
    if (talk.id !== id) out.push(`talk ${id}: says it’s ${talk.id}`);
    if (talk.with !== 'none' && !Object.hasOwn(people, talk.with)) out.push(`talk ${id}: with ${talk.with}`);
    for (const r of talk.needs || []) need(r, `talk ${id}`);
    for (const [nodeId, node] of Object.entries(talk.nodes)) {
      for (const choice of node.choices) {
        for (const r of choice.needs || []) need(r, `talk ${id}/${nodeId}`);
        for (const who of [choice.join, choice.likes]) if (who && !Object.hasOwn(people, who)) out.push(`talk ${id}/${nodeId}: no companion ${who}`);
        if (choice.next && !Object.hasOwn(talk.nodes, choice.next)) out.push(`talk ${id}/${nodeId}: no node ${choice.next}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names (COMBAT §16.4)

// The groups of LORE §21 that hold the fight's own names. A combat name listed in one of these is
// the index's own entry for it; LORE lists one thing in two groups when it's the same thing seen
// twice (§21's note: Old Patience is a relic, a chapter and Tova's heart feat).
const COMBAT_GROUPS = new Set([
  'Callings', 'Paths', 'Calling features, weapon arts and boons', 'Companions’ moves and heart feats', 'Companions\' moves and heart feats',
  'Spells and knacks', 'Conditions', 'Genre noise', 'Modes and ways to play', 'Rests, rewards and Tale-lead fights', 'Delve foes and Great Ones',
  'Wild creatures', 'The party', 'Rounds and notebooks', 'Elites', 'Strays and Tale-leads named here', 'Team-ups', 'People',
]);
// A companion's name is also its own title (the Scribe's first title is Scribe): the same thing seen twice.
const HOME_GROUPS = Object.freeze({ companion: ['Titles'] });

/** The fight's names: callings, paths, abilities, companions, foes and creatures, as { kind, id, name, group }. */
function combatNames(c) {
  const out = [];
  const add = (kind, id, name, group = kind) => { if (typeof name === 'string' && name) out.push({ kind, id, name, group }); };
  const cc = c.combat.callings;
  for (const x of cc.callings) add('calling', x.id, x.name);
  for (const x of cc.paths) add('path', x.id, x.name, `path:${x.id}`);
  // A path's own feature carries its path's name (§9.4): the same thing as the path.
  const pathOwn = new Map(cc.paths.map((p) => [p.id, p.id]));
  for (const x of cc.abilities) add('ability', x.id, x.name, pathOwn.has(x.id) || pathOwn.has(x.id.replace(/-path$/, '')) ? `path:${x.id.replace(/-path$/, '')}` : 'ability');
  for (const x of c.combat.spells.spells) add('spell', x.id, x.name);
  for (const [id, f] of Object.entries(companionsOf(c))) {
    add('companion', id, f.name, `who:${id}`);
    for (const a of f.abilityDefs || []) add('move', a.id, a.name);
  }
  for (const a of c.party.regulars.abilityDefs || []) add('regular-move', a.id, a.name);
  for (const a of c.combat.foes.abilities || []) add('foe-move', a.id, a.name);
  for (const f of c.combat.foes.canon) add('canon', f.id, f.name);
  for (const f of c.combat.foes.creatures) add('creature', f.id, f.name);
  for (const g of c.combat.foes.greatOnes || []) add('great-one', g.id, g.name, `who:${g.id}`);
  add('mimic', 'mimic', c.combat.foes.mimic?.name);
  for (const id of CONDITION_IDS) add('condition', id, conditionName(id));
  return out;
}

// Abilities granted together at the same level of one calling are one feature's parts (the Bench
// drone and its orders), so they may share its name.
function partsOfOneFeature(c, a, b) {
  return c.combat.callings.callings.some((calling) => Object.values(calling.levels || {}).some((ids) => ids.includes(a.id) && ids.includes(b.id)));
}

/** Collisions: one name for two different combat things, or a combat name the index lists only as something else. */
function nameProblems(c, index = loreIndex()) {
  const out = [];
  const echoes = new Set(ECHOES.map(normaliseName));
  const groupsOf = new Map();
  for (const [group, names] of Object.entries(index)) for (const n of names) groupsOf.set(n, new Set([...(groupsOf.get(n) || []), group]));
  const byName = new Map();
  for (const entry of combatNames(c)) {
    const n = normaliseName(entry.name);
    byName.set(n, [...(byName.get(n) || []), entry]);
  }
  for (const [n, entries] of byName) {
    if (echoes.has(n)) continue;
    const groups = [...new Set(entries.map((e) => e.group))];
    if (groups.length > 1) {
      const sanctioned = groupsOf.get(n) && [...groupsOf.get(n)].filter((g) => COMBAT_GROUPS.has(g)).length >= Math.min(2, groups.length);
      const oneFeature = entries.length === 2 && partsOfOneFeature(c, entries[0], entries[1]);
      const samePerson = entries.every((e) => e.group === entries[0].group || e.id === entries[0].id);
      if (!sanctioned && !oneFeature && !samePerson) out.push(`“${entries[0].name}” names ${entries.map((e) => `${e.kind} ${e.id}`).join(' and ')}`);
    }
    const listed = groupsOf.get(n);
    const home = (g) => COMBAT_GROUPS.has(g) || entries.some((e) => (HOME_GROUPS[e.kind] || []).includes(g));
    if (listed && ![...listed].some(home)) out.push(`“${entries[0].name}” (${entries.map((e) => e.kind).join(', ')}) is LORE’s ${[...listed].join(' and ')}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tests

test('leads.json’s hooks name companions and camp talks', () => {
  assert.deepEqual(hookProblems(content), []);
  const broken = clone(content);
  broken.combat.leads.hooks = [{ name: 'Rivet the Bold', companion: 'rivett', talk: 'no-such-talk' }];
  assert.deepEqual(hookProblems(broken), ['hook Rivet the Bold: no companion rivett', 'hook Rivet the Bold: no camp talk no-such-talk']);
});

test('every trail step names a feature or a real place, and its end a landmark, a talk and who joins', () => {
  assert.deepEqual(trailProblems(content), []);
  const broken = clone(content);
  broken.trails.trails[0].steps[0].solve = { kind: 'feature', target: 'juggling' };
  broken.trails.trails[0].steps[1].solve = { kind: 'visit', target: 'gate:q' };
  broken.trails.trails[0].end.talk = 'missing';
  const problems = trailProblems(broken);
  assert.equal(problems.length, 4);
  assert.ok(problems.some((p) => /feature juggling/.test(p)));
  assert.ok(problems.some((p) => /visit gate:q names nothing real/.test(p)));
  assert.ok(problems.some((p) => /no talk missing/.test(p)));
});

test('callings, paths, weapon arts, boons, items and gifts all name abilities', () => {
  assert.deepEqual(callingProblems(content), []);
  const broken = clone(content);
  broken.combat.callings.callings[0].levels['2'] = ['scarf', 'no-such-move'];
  broken.combat.callings.weaponArts.light = 'missing-art';
  assert.deepEqual(callingProblems(broken, indexOf(content)), ['lanternkeeper level 2: no ability no-such-move', 'weaponArts: no ability missing-art']);
});

test('the regulars have a signature and a trick for every fighting genre, and callings and personalities that exist', () => {
  assert.deepEqual(regularProblems(content), []);
  const broken = clone(content);
  delete broken.party.regulars.tricks.noir;
  broken.party.regulars.personalityByTemperament.shy = 'bashful';
  const problems = regularProblems(broken, indexOf(content));
  assert.ok(problems.includes('no trick for noir: undefined'));
  assert.ok(problems.includes('shy: no personality bashful'));
});

test('rules.json’s and foes.json’s ability ids resolve, cave lists name foes, and leads’ objects are real kinds', () => {
  assert.deepEqual(foeProblems(content), []);
  const broken = clone(content);
  broken.combat.rules.genres.neon.abilities = ['glitch-slash', 'glitch-stomp'];
  broken.combat.foes.caves.mistmere = ['kite-crabs', 'sea-dragons'];
  broken.combat.foes.borrow['far-shore'] = 'nowhere';
  const problems = foeProblems(broken, indexOf(content));
  assert.deepEqual(problems, ['genre neon: no ability glitch-stomp', 'cave mistmere: no foe sea-dragons', 'borrow far-shore: nowhere has no list']);
});

test('every companion’s calling, paths, moves, reactions, personality, field skill and trail resolve', () => {
  assert.deepEqual(companionProblems(content), []);
  // The five field skills Phase 4 does are the five the companions carry.
  for (const [skill, who] of Object.entries(DOING)) {
    assert.equal(FIELD_SKILLS[skill].who, who, skill);
    assert.equal(FIELD_SKILLS[skill].phase4, true);
    assert.equal(companionsOf(content)[who].fieldSkill, skill, `${who}’s file`);
  }
  const broken = clone(content);
  broken.party.companions.claude.fieldSkill = 'pick';
  broken.party.companions.codex.moves = ['device', 'overclock'];
  broken.party.companions.jev.reactions = { 'tail-flick': 'always' };
  const problems = companionProblems(broken, indexOf(content));
  assert.ok(problems.includes('claude: pick belongs to codex'));
  assert.ok(problems.includes('codex: no move overclock'));
  assert.ok(problems.includes('jev: no reaction tail-flick'));
});

test('camp scenes and talks name companions (or a scene’s generic regular), and every need resolves', () => {
  assert.deepEqual(campProblems(content), []);
  assert.ok(content.camp.scenes.scenes.some((s) => s.who === 'regular'), 'a regular’s arrival');
  const broken = clone(content);
  broken.camp.scenes.scenes[0].who = 'maud';
  broken.camp.talks['tollkeeper-riddles'] = broken.camp.talks['tollkeeper-riddles'].replace('[join: tollkeeper]', '[join: toll]');
  const problems = campProblems(broken);
  assert.ok(problems.some((p) => /no companion maud/.test(p)));
  assert.ok(problems.some((p) => /talk tollkeeper-riddles: .*toll/.test(p)), problems.join('\n'));
});

test('no combat name collides with another thing in LORE’s index, unless it’s a deliberate echo', () => {
  assert.deepEqual(nameProblems(content), []);
  // A move named for a region, and a spell sharing a creature's name, are caught.
  const broken = clone(content);
  broken.party.companions.tova.abilityDefs = broken.party.companions.tova.abilityDefs.map((a) => (a.id === 'hammer-tap' ? { ...a, name: 'Cinderforge' } : a));
  broken.combat.spells.spells = broken.combat.spells.spells.map((s) => (s.id === 'mote' ? { ...s, name: 'Fog seals' } : s));
  const problems = nameProblems(broken);
  assert.ok(problems.some((p) => /“Cinderforge” \(move\) is LORE’s Regions/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /“Fog seals” names spell mote and creature fog-seals/.test(p)), problems.join('\n'));
  // The echoes (Milo's Hearth, Nell's Quiet Order…) are named on purpose: one more thing called Hearth isn't a collision.
  assert.ok(ECHOES.includes('Hearth') && ECHOES.includes('Quiet Order'));
  const echoed = clone(content);
  echoed.combat.spells.spells = echoed.combat.spells.spells.map((s) => (s.id === 'flare' ? { ...s, name: 'Quiet Order' } : s));
  assert.deepEqual(nameProblems(echoed), [], 'an echo passes');
  const index = loreIndex();
  assert.ok(index.Factions.includes(normaliseName('the Quiet Order')), 'and it does echo the faction');
});
