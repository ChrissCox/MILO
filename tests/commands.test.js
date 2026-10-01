// The command bar (src/commands.js) and the Grimoire (content/spells.json): plain words or `::`
// spells read into one Intent. CONTRACT-PHASE4.md §7.6, §9.11, §12.4; LORE.md §11, §21; PLAN.md §7, §10.
// Run: node --test tests/commands.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseCommand, completions } from '../src/commands.js';
import { assertCalm, assertName, assertOwnWords, assertCosy, loreIndex, normaliseName } from './calm.js';

const grimoire = JSON.parse(readFileSync(new URL('../content/spells.json', import.meta.url), 'utf8'));
const places = [
  { id: 'watchtower', name: 'The Watchtower' }, { id: 'plot-pond', name: 'Pondside plot', words: ['the pond'] },
  { id: 'lantern:-12,40', name: 'The lantern by the ford' }, 'war-table',
];
const ctx = { grimoire, places };
const parse = (text) => parseCommand(text, ctx);
// Names LORE §21 doesn't have yet, used in the Grimoire's flavour lines (§16.3's pending list).
const PENDING_NAMES = ['Creeper', 'Grimoire'];

test('Phase 4 understands its commands with ::', () => {
  assert.deepEqual(parse('::kindle'), { kind: 'spell', spell: 'kindle', arg: null });
  assert.deepEqual(parse('::banked-coals'), { kind: 'spell', spell: 'banked-coals', arg: null });
  assert.deepEqual(parse('::rest'), { kind: 'spell', spell: 'banked-coals', arg: null });
  assert.deepEqual(parse('::stop'), { kind: 'spell', spell: 'stop', arg: null });
  assert.deepEqual(parse('::muster'), { kind: 'open', panel: 'muster' });
  assert.deepEqual(parse('::chronicle'), { kind: 'open', panel: 'chronicle' });
  assert.deepEqual(parse('::recall-the-road'), { kind: 'open', panel: 'chronicle' }, 'Recall the Road is the Chronicle');
  assert.deepEqual(parse('::map'), { kind: 'open', panel: 'map' });
  assert.deepEqual(parse('::skills'), { kind: 'open', panel: 'skills' });
  assert.deepEqual(parse('::home'), { kind: 'go', place: 'home' });
  assert.deepEqual(parse('::quiet'), { kind: 'hud', mode: 'quiet' });
  assert.deepEqual(parse('::adventure'), { kind: 'hud', mode: 'adventure' });
  assert.deepEqual(parse('::help'), { kind: 'help' });
  assert.deepEqual(parse('  ::Kindle  '), parse('::kindle'), 'case and spaces don’t matter');
});

test('::wayfinding goes to a place by id, name or word; alone it opens the map', () => {
  assert.deepEqual(parse('::wayfinding watchtower'), { kind: 'go', place: 'watchtower' });
  assert.deepEqual(parse('::wayfinding the Watchtower'), { kind: 'go', place: 'watchtower' });
  assert.deepEqual(parse('::wayfinding the pond'), { kind: 'go', place: 'plot-pond' });
  assert.deepEqual(parse('::wayfinding pondside'), { kind: 'go', place: 'plot-pond' }, 'a name’s start is enough');
  assert.deepEqual(parse('::wayfinding war-table'), { kind: 'go', place: 'war-table' });
  assert.deepEqual(parse('::wayfinding home'), { kind: 'go', place: 'home' });
  assert.deepEqual(parse('::wayfinding'), { kind: 'open', panel: 'map' });
  assert.deepEqual(parse('::wayfinding the watchtowr'), { kind: 'unknown', text: '::wayfinding the watchtowr', suggest: '::wayfinding The Watchtower' });
  assert.deepEqual(parse('::wayfinding the moon'), { kind: 'unknown', text: '::wayfinding the moon', suggest: null });
  assert.deepEqual(parseCommand('::wayfinding anywhere', {}), { kind: 'unknown', text: '::wayfinding anywhere', suggest: null }, 'no places, nowhere to go');
});

test('the plain words for each command', () => {
  const cases = {
    'kindle the lantern': { kind: 'spell', spell: 'kindle', arg: null },
    'Light the lantern.': { kind: 'spell', spell: 'kindle', arg: null },
    'Milo, kindle the lantern please': { kind: 'spell', spell: 'kindle', arg: null },
    focus: { kind: 'spell', spell: 'kindle', arg: null },
    rest: { kind: 'spell', spell: 'banked-coals', arg: null },
    'bank the coals': { kind: 'spell', spell: 'banked-coals', arg: null },
    'stop the timer': { kind: 'spell', spell: 'stop', arg: null },
    'open the chronicle': { kind: 'open', panel: 'chronicle' },
    'Recall the Road': { kind: 'open', panel: 'chronicle' },
    'what did I do last week?': { kind: 'open', panel: 'chronicle' },
    'set out': { kind: 'open', panel: 'muster' },
    'open the map': { kind: 'open', panel: 'map' },
    'show my skills': { kind: 'open', panel: 'skills' },
    'go home': { kind: 'go', place: 'home' },
    'take me home': { kind: 'go', place: 'home' },
    'go to the watchtower': { kind: 'go', place: 'watchtower' },
    'take me to the pond': { kind: 'go', place: 'plot-pond' },
    'quiet mode': { kind: 'hud', mode: 'quiet' },
    'adventure mode': { kind: 'hud', mode: 'adventure' },
    help: { kind: 'help' },
    '?': { kind: 'help' },
    'what can I say': { kind: 'help' },
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(parse(text), want, text);
});

test('every other Grimoire spell answers not-yet with where it comes from', () => {
  const phase4 = new Set(['kindle', 'banked-coals', 'wayfinding', 'recall-the-road']);
  for (const spell of grimoire.spells) {
    if (phase4.has(spell.id)) continue;
    assert.deepEqual(parse(`::${spell.id}`), { kind: 'not-yet', spell: spell.id, from: spell.from }, spell.id);
    assert.deepEqual(parse(spell.name.toLowerCase()), { kind: 'not-yet', spell: spell.id, from: spell.from }, spell.name);
  }
  assert.deepEqual(parse('::summon the scribe'), { kind: 'not-yet', spell: 'summon-the-scribe', from: 'Phase 6' });
  assert.deepEqual(parse('cast starfall'), { kind: 'not-yet', spell: 'starfall', from: 'Phase 9' });
  assert.deepEqual(parse('::judgebirds-glance'), { kind: 'not-yet', spell: 'judgebirds-glance', from: 'Phase 7' });
  assert.deepEqual(parse('Judgebird’s Glance'), { kind: 'not-yet', spell: 'judgebirds-glance', from: 'Phase 7' }, 'curly apostrophes read the same');
});

test('nonsense gets a calm unknown, with a suggestion only when one is close', () => {
  assert.deepEqual(parse('::kindel'), { kind: 'unknown', text: '::kindel', suggest: '::kindle' });
  assert.deepEqual(parse('::chronicel'), { kind: 'unknown', text: '::chronicel', suggest: '::chronicle' });
  assert.deepEqual(parse('kindel the lantern'), { kind: 'unknown', text: 'kindel the lantern', suggest: '::kindle' });
  assert.deepEqual(parse('::xyzzy'), { kind: 'unknown', text: '::xyzzy', suggest: null });
  assert.deepEqual(parse('make me a sandwich'), { kind: 'unknown', text: 'make me a sandwich', suggest: null });
  assert.deepEqual(parse(''), { kind: 'unknown', text: '', suggest: '::help' });
  for (const junk of [null, 5, {}, []]) assert.deepEqual(parseCommand(junk, ctx), { kind: 'unknown', text: '', suggest: '::help' });
  assert.deepEqual(parseCommand('::kindle'), { kind: 'spell', spell: 'kindle', arg: null }, 'the built-in commands work without a Grimoire');
  assert.deepEqual(parseCommand('::starfall'), { kind: 'unknown', text: '::starfall', suggest: null }, 'without the Grimoire, its spells are unknown');
  assert.deepEqual(parse('::kindle'), parse('::kindle'), 'deterministic');
});

test('completions finish a command, a spell or a place', () => {
  assert.deepEqual(completions('::k', ctx), ['::kindle']);
  assert.deepEqual(completions('::st', ctx), ['::stop', '::stillday', '::starfall', '::stitch', '::step-through']);
  assert.deepEqual(completions('::wayfinding the', ctx), ['::wayfinding The Watchtower', '::wayfinding Pondside plot', '::wayfinding The lantern by the ford']);
  assert.deepEqual(completions('::wayfinding pond', ctx), ['::wayfinding Pondside plot']);
  assert.deepEqual(completions('::muster x', ctx), []);
  assert.deepEqual(completions('kindle', ctx), ['kindle the lantern']);
  assert.deepEqual(completions('open the', ctx), ['open the muster', 'open the chronicle', 'open the map', 'open the skills']);
  assert.ok(completions('::', ctx).length <= 8);
  assert.deepEqual(completions('', ctx), []);
  assert.deepEqual(completions(null, ctx), []);
});

test('content/spells.json: every LORE §21 spell once, in its school, with calm words and a from', () => {
  assert.equal(grimoire.version, 1);
  assertCalm(grimoire.about, 'spells.about', { proper: ['LORE', 'CONTRACT-PHASE4.md', ...PENDING_NAMES] });
  const lore = loreIndex();
  const names = grimoire.spells.map((s) => normaliseName(s.name));
  assert.deepEqual([...names].sort(), [...lore.Spells].sort(), 'the Grimoire is LORE §21’s Spells, exactly');
  assert.equal(new Set(grimoire.spells.map((s) => s.id)).size, grimoire.spells.length, 'ids are unique');
  const schools = new Set(lore["The Grimoire's schools"]);
  assert.equal(schools.size, 9);
  const intents = new Set(['kindle', 'banked-coals', 'chronicle', 'wayfinding']);
  for (const spell of grimoire.spells) {
    assert.match(spell.id, /^[a-z][a-z0-9-]{1,39}$/);
    assertName(spell.name, `${spell.id}.name`);
    assert.ok(schools.has(spell.school), `${spell.id}: school ${spell.school}`);
    assert.ok(Array.isArray(spell.words) && spell.words.length >= 1, spell.id);
    for (const word of spell.words) assert.equal(word, word.toLowerCase().trim(), `${spell.id}: “${word}” is plain lower case`);
    assert.match(spell.from, /^(Phase ([4-9]|10)|Later)$/, spell.id);
    assert.ok(spell.intent === null || intents.has(spell.intent), `${spell.id}: intent ${spell.intent}`);
    assert.equal(spell.intent !== null, spell.from === 'Phase 4', `${spell.id}: a Phase 4 spell has an intent, and only those`);
    assertCalm(spell.flavour, `${spell.id}.flavour`, { proper: PENDING_NAMES });
    for (const text of [spell.name, spell.flavour, ...spell.words]) {
      assertOwnWords(text, spell.id);
      assertCosy(text, spell.id);
    }
  }
  assert.deepEqual(grimoire.spells.filter((s) => s.from === 'Phase 4').map((s) => [s.id, s.intent]), [
    ['kindle', 'kindle'], ['wayfinding', 'wayfinding'], ['banked-coals', 'banked-coals'], ['recall-the-road', 'chronicle'],
  ]);
  // A spell's words never cast a different spell than itself.
  for (const spell of grimoire.spells) {
    for (const word of spell.words) {
      const intent = parse(word);
      if (intent.kind === 'not-yet') assert.equal(intent.spell, spell.id, `“${word}”`);
    }
  }
});
