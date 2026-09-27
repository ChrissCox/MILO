// Module E (Architect) tests. Run: node --test tests/architect.test.js
//
// Crew calls run the fake CLIs in tests/fixtures/architect/ (never the real Claude Code or Codex).
// Homes and project folders are built in temp directories with made-up text; the real ~/.claude,
// ~/.codex and Projects folder are never read here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from '../src/architect/blueprint.js';
import { cleanBuilt, createSignalReader, parseFrontmatter, readProjects, readSkills } from '../src/architect/context.js';
import {
  CLAUDE_AUTH_ARGS, CODEX_LOCKDOWN, CODEX_LOGIN_ARGS, KILL_GRACE_MS, TEMP_PREFIX, childEnv, claudeArgs, claudeEnv, codexAgentsFile,
  codexArgs, codexOwnLines, compareVersions, extractJson, findClaude, findCodex, interpretClaude, interpretCodex, runProcess,
  sweepCrewTempDirs,
} from '../src/architect/crew.js';
import { BUSY_MESSAGE, DETAILS, PROBE_TTL_MS, cleanPlot, createArchitect, reasonPhrase } from '../src/architect/index.js';
import {
  EMBLEMS, IDEAS, PLOT_ORDER, THEMES, THEME_LEVELS, allocate, kitBlueprint, localSuggestions, namedIdea, themeFor,
} from '../src/architect/offline.js';
import { designPrompt, quoteLine, suggestPrompt } from '../src/architect/prompts.js';
import { PALETTE } from '../src/world/sprites.js';
import { GOOD_BLUEPRINT } from './fixtures/architect/crew-payloads.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKES = path.join(here, 'fixtures', 'architect');
const FAKE_CLAUDE = path.join(FAKES, 'fake-claude.mjs');
const FAKE_CODEX = path.join(FAKES, 'fake-codex.mjs');
const GRANDCHILD = path.join(FAKES, 'grandchild.mjs');

const PLOTS = [
  { id: 'plot-meadow', name: 'Long meadow', w: 13, h: 4 },
  { id: 'plot-rise', name: 'Sunny rise', w: 7, h: 5 },
  { id: 'plot-birch', name: 'Birch hollow', w: 6, h: 5 },
  { id: 'plot-pond', name: 'Pondside plot', w: 6, h: 4 },
  { id: 'plot-orchard', name: 'Old orchard', w: 7, h: 5 },
];
const RISE = PLOTS[1];
const CLIP_IDEA = 'Clip studio: turns my drawing streams into TikToks';

const MARKERS = {
  body: 'BODY-TEXT-NEVER-READ',
  memory: 'PRIVATE-MEMORY-MARKER',
  transcript: 'PRIVATE-TRANSCRIPT-MARKER',
  codex: 'PRIVATE-CODEX-MARKER',
};

// Skill names mirror the ones on Chris's PC; every description is made up.
const SKILLS = {
  'expert-fantasy-football-drafting': 'Made-up expert pack on fantasy football drafting: tiers, ADP and sleepers.',
  'expert-pf2e-encounter-design': 'Made-up expert pack on Pathfinder 2e encounter budgets and difficulty.',
  'expert-ttrpg-campaign-structure': 'Made-up expert pack on campaign arcs and session pacing.',
  jev: 'Made-up sorter that can triage, label and rank piles of text.',
  'video-expert': 'Made-up skill that learns a topic from YouTube and TikTok videos.',
  'video-to-agent': 'Made-up skill that turns a tutorial video into a working skill.',
};

// ---------------------------------------------------------------------------------------------
// Helpers

async function write(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
}

async function makeHome(t, { skills = SKILLS, projects = ['Habitack', 'MILO'] } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-architect-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const home = path.join(root, 'home');
  const claudeHome = path.join(home, '.claude');
  for (const [name, description] of Object.entries(skills)) {
    await write(path.join(claudeHome, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${MARKERS.body}\n`);
  }
  await write(path.join(claudeHome, 'projects', 'Z--Demo', 'memory', 'notes.md'), `${MARKERS.memory}\n`);
  await write(path.join(claudeHome, 'projects', 'Z--Demo', 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), `${JSON.stringify({ type: 'user', message: { content: MARKERS.transcript } })}\n`);
  await write(path.join(home, '.codex', 'session_index.jsonl'), `${JSON.stringify({ id: 'made-up', thread_name: MARKERS.codex })}\n`);
  const projectsDir = path.join(root, 'Projects');
  for (const name of projects) await write(path.join(projectsDir, name, 'README.md'), 'made-up\n');
  await write(path.join(projectsDir, '.hidden', 'README.md'), 'hidden\n');
  await write(path.join(projectsDir, 'notes.txt'), 'a file, not a project\n');
  return { root, home, claudeHome, projectsDir, log: path.join(root, 'crew.log') };
}

function readLog(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** A spawnImpl that records each call and runs the fake CLI script under this Node. */
function recordingSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options, env: undefined } });
    return spawn(process.execPath, [command, ...args], options);
  };
}

function makeArchitect(ctx, { mode = 'auto', claude = 'ok', codex = 'ok', calls = [], spawnImpl, timeoutMs, env = {}, now } = {}) {
  return createArchitect({
    env: {
      ...process.env,
      CODEX_HOME: path.join(ctx.home, '.codex'),
      MILO_CLAUDE_BIN: FAKE_CLAUDE,
      MILO_CODEX_BIN: FAKE_CODEX,
      MILO_FAKE_CLAUDE: claude,
      MILO_FAKE_CODEX: codex,
      MILO_FAKE_CREW_LOG: ctx.log,
      ...env,
    },
    home: ctx.home,
    claudeHome: ctx.claudeHome,
    projectsDir: ctx.projectsDir,
    mode,
    spawnImpl: spawnImpl === undefined ? recordingSpawn(calls) : spawnImpl || undefined,
    timeoutMs,
    ...(now ? { now } : {}),
  });
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

function assertBlueprintShape(bp) {
  assert.equal(bp.version, 1);
  assert.ok(bp.name && Array.from(bp.name).length <= B.LIMITS.name);
  assert.ok(Array.from(bp.tagline).length <= B.LIMITS.tagline);
  assert.ok(Array.from(bp.purpose).length <= B.LIMITS.purpose);
  assert.ok(B.SHAPES.includes(bp.style.shape));
  assert.ok(B.WALLS.includes(bp.style.walls));
  assert.ok(B.ROOFS.includes(bp.style.roof));
  assert.ok(B.DOORS.includes(bp.style.door));
  assert.ok(B.WINDOWS.includes(bp.style.windows));
  for (const field of ['wallColor', 'roofColor', 'trim']) assert.ok(B.COLOURS.includes(bp.style[field]), field);
  for (const field of ['flag', 'awning']) assert.ok(B.ACCENTS.includes(bp.style[field]), field);
  assert.equal(typeof bp.style.chimney, 'boolean');
  assert.equal(bp.emblem.length, 12);
  for (const row of bp.emblem) {
    assert.equal(row.length, 12);
    for (const ch of row) assert.ok(ch === '.' || B.EMBLEM_KEYS[ch], `emblem key ${ch}`);
  }
  assert.ok(bp.props.length <= 4);
  for (const item of bp.props) {
    assert.ok(B.PROP_KINDS.includes(item.kind));
    assert.ok(B.PROP_SIDES.includes(item.side));
  }
  assert.ok(B.YARDS.includes(bp.yard));
  assert.deepEqual(bp.levels.map((item) => item.level), [1, 2, 3, 4, 5]);
  for (const item of bp.levels) {
    assert.ok(item.title && Array.from(item.title).length <= B.LIMITS.levelTitle);
    assert.ok(item.summary && Array.from(item.summary).length <= B.LIMITS.levelSummary);
    assert.ok(item.proof && Array.from(item.proof).length <= B.LIMITS.levelProof);
  }
  assert.deepEqual(Object.keys(bp), ['version', 'name', 'tagline', 'purpose', 'style', 'emblem', 'props', 'yard', 'levels']);
}

function assertCalm(text) {
  assert.ok(!/!/.test(text), `no exclamation marks: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `no emoji: ${text}`);
  assert.ok(!/\bplease\b|\bsuccessfully\b/i.test(text), `calm copy: ${text}`);
}

// ---------------------------------------------------------------------------------------------
// blueprint.js

test('schemas are strict and use only keywords both crews accept', () => {
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description']);
  const walk = (schema, where) => {
    for (const key of Object.keys(schema)) assert.ok(allowed.has(key), `${where}: ${key}`);
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, where);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), where);
      for (const [key, child] of Object.entries(schema.properties)) walk(child, `${where}.${key}`);
    }
    if (schema.type === 'array') walk(schema.items, `${where}[]`);
  };
  walk(B.BLUEPRINT_SCHEMA, 'blueprint');
  walk(B.SUGGESTIONS_SCHEMA, 'suggestions');
  assert.equal(B.BLUEPRINT_SCHEMA.type, 'object');
  assert.equal(B.SUGGESTIONS_SCHEMA.type, 'object');
  assert.deepEqual(B.BLUEPRINT_SCHEMA.properties.style.properties.shape.enum, [...B.SHAPES]);
  assert.deepEqual(B.BLUEPRINT_SCHEMA.properties.props.items.properties.kind.enum, [...B.PROP_KINDS]);
  assert.ok(Object.isFrozen(B.BLUEPRINT_SCHEMA) && Object.isFrozen(B.BLUEPRINT_SCHEMA.properties.style));
  assert.ok(JSON.stringify(B.BLUEPRINT_SCHEMA).length < 8000, 'schema fits comfortably on a command line');
});

test('enums match the contract and every key maps to the world palette', () => {
  assert.equal(B.SHAPES.length, 10);
  assert.equal(B.COLOURS.length, 18);
  assert.equal(B.PROP_KINDS.length, 28);
  assert.deepEqual(Object.keys(B.EMBLEM_KEYS).sort(), ['B', 'L', 'U', 'b', 'c', 'e', 'k', 'l', 'o', 'r', 's', 'u', 'v', 'w'].sort());
  for (const key of Object.keys(B.EMBLEM_KEYS)) assert.ok(PALETTE[key], `emblem key ${key} is a palette key`);
  for (const colour of B.COLOURS) {
    const key = B.COLOUR_KEYS[colour];
    assert.ok(PALETTE[key], colour);
    assert.equal(PALETTE[key].name, colour);
  }
});

test('validateBlueprint accepts a clean blueprint as is, and is idempotent', () => {
  const first = B.validateBlueprint(GOOD_BLUEPRINT);
  assert.equal(first.ok, true);
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.blueprint, GOOD_BLUEPRINT);
  const again = B.validateBlueprint(first.blueprint);
  assert.deepEqual(again, first);
  assert.deepEqual(B.validateBlueprint(JSON.stringify(GOOD_BLUEPRINT)).blueprint, GOOD_BLUEPRINT);
});

test('validateBlueprint repairs what it safely can', () => {
  const messy = {
    version: 3,
    name: '  The Grand Clip Studio For Streams And Also More Things!  ',
    tagline: 'x'.repeat(200),
    purpose: 'Turns streams into clips 🎬 for you!',
    style: {
      shape: 'Castle', walls: 'Wooden', wallColor: 'purple', roof: 'domed', roofColor: 'navy', trim: 'wood-deep',
      door: 'portal', windows: 'circular', chimney: 'yes', flag: false, awning: 'red',
    },
    emblem: ['oooo', 'o##o', 'oZZo', 'oooo'],
    props: [
      { kind: 'Camera', side: 'LEFT' }, { kind: 'dragon', side: 'right' }, { kind: 'tripod', side: 'front' },
      { kind: 'camera', side: 'left' }, { kind: 'lantern', side: 'up' }, { kind: 'bench', side: 'left' }, { kind: 'well', side: 'right' },
    ],
    yard: 'lawn',
    levels: [
      { level: 3, title: 'Third', summary: 'Three.', proof: 'Three shows.' },
      { level: 1, title: 'First Level Title Here', summary: 'One.', proof: 'One shows.' },
      { level: 2, title: 'Second', summary: 'Two.', proof: 'Two shows.' },
      { level: 5, title: 'Fifth', summary: 's'.repeat(300), proof: 'Five shows.' },
      { level: 4, title: 'Fourth', summary: 'Four.', proof: '' },
      { level: 6, title: 'Sixth', summary: 'Six.', proof: 'Six shows.' },
      'not a level',
    ],
  };
  const { ok, blueprint, problems } = B.validateBlueprint(messy);
  assert.equal(ok, true);
  assert.ok(problems.length > 5);
  assertBlueprintShape(blueprint);
  assert.equal(blueprint.name, 'The grand clip studio');
  assertCalm(blueprint.name);
  assert.ok(blueprint.tagline.endsWith('…'));
  assert.equal(blueprint.purpose, 'Turns streams into clips for you.');
  assert.equal(blueprint.style.shape, B.DEFAULT_STYLE.shape);
  assert.equal(blueprint.style.walls, 'plank');
  assert.equal(blueprint.style.wallColor, 'lavender');
  assert.equal(blueprint.style.roof, 'dome');
  assert.equal(blueprint.style.roofColor, 'slateDeep');
  assert.equal(blueprint.style.trim, 'woodDeep');
  assert.equal(blueprint.style.door, B.DEFAULT_STYLE.door);
  assert.equal(blueprint.style.windows, 'round');
  assert.equal(blueprint.style.chimney, true);
  assert.equal(blueprint.style.flag, 'none');
  assert.equal(blueprint.style.awning, 'clay');
  assert.deepEqual(blueprint.props.map((item) => item.kind), ['camera', 'camera', 'lantern', 'bench']);
  assert.deepEqual(blueprint.props[1], { kind: 'camera', side: 'front' });
  assert.equal(blueprint.yard, 'grass');
  assert.deepEqual(blueprint.levels.map((item) => item.title), ['First level title here', 'Second', 'Third', 'Fourth', 'Fifth']);
  assert.ok(blueprint.levels[3].proof.length > 0);
  assert.ok(blueprint.levels[4].summary.endsWith('…'));
  // A 4x4 emblem is centred in the 12x12 grid; unknown keys become transparent, '#' becomes ink.
  assert.equal(blueprint.emblem[4], '....oooo....');
  assert.equal(blueprint.emblem[5], '....oooo....');
  assert.equal(blueprint.emblem[6], '....o..o....');
});

test('validateBlueprint says unusable only when it is', () => {
  for (const bad of [null, undefined, 42, 'nope', [], {}, { name: '' }, { name: '!!!' }]) {
    assert.equal(B.validateBlueprint(bad).ok, false, JSON.stringify(bad));
  }
  const twoLevels = { ...GOOD_BLUEPRINT, levels: GOOD_BLUEPRINT.levels.slice(0, 2) };
  assert.equal(B.validateBlueprint(twoLevels).ok, false);
  assert.equal(B.validateBlueprint(twoLevels, { fallback: GOOD_BLUEPRINT }).ok, false, 'fewer than 3 real levels stays unusable');
  const fourLevels = { ...GOOD_BLUEPRINT, levels: GOOD_BLUEPRINT.levels.slice(0, 4) };
  assert.equal(B.validateBlueprint(fourLevels).ok, false, 'no fallback to fill from');
  const kit = kitBlueprint('Clip studio');
  const filled = B.validateBlueprint(fourLevels, { fallback: kit });
  assert.equal(filled.ok, true);
  assert.equal(filled.blueprint.levels.length, 5);
  assert.equal(filled.blueprint.levels[4].title, kit.levels[4].title);
  // A crew title that matches one of the kit's later levels still leaves room to fill from the others.
  const clash = { ...GOOD_BLUEPRINT, levels: [...GOOD_BLUEPRINT.levels.slice(0, 3), { ...GOOD_BLUEPRINT.levels[3], title: kit.levels[4].title }] };
  const clashed = B.validateBlueprint(clash, { fallback: kit });
  assert.equal(clashed.ok, true, clashed.problems.join(', '));
  assert.equal(new Set(clashed.blueprint.levels.map((item) => item.title.toLowerCase())).size, 5, 'no level twice');
  const three = { ...GOOD_BLUEPRINT, levels: [...GOOD_BLUEPRINT.levels.slice(0, 2), { ...GOOD_BLUEPRINT.levels[2], title: kit.levels[3].title }] };
  assert.equal(B.validateBlueprint(three, { fallback: kit }).ok, true);
  const nullLevel = { ...GOOD_BLUEPRINT, levels: GOOD_BLUEPRINT.levels.map((item, index) => (index === 4 ? { ...item, level: null } : item)) };
  assert.equal(B.validateBlueprint(nullLevel).blueprint.levels[4].title, 'Whole stream', 'a level with no number keeps its place');
  const oddNumbers = { ...GOOD_BLUEPRINT, levels: GOOD_BLUEPRINT.levels.map((item, index) => ({ ...item, level: index === 0 ? 'first' : item.level })) };
  assert.equal(B.validateBlueprint(oddNumbers).blueprint.levels[0].title, 'Finds good moments');
  const nameOnly = B.validateBlueprint({ name: 'Just a name', levels: GOOD_BLUEPRINT.levels }, { fallback: kit });
  assert.equal(nameOnly.ok, true);
  assert.deepEqual(nameOnly.blueprint.style, kit.style);
  assert.deepEqual(nameOnly.blueprint.emblem, kit.emblem);
  const wrapped = B.validateBlueprint({ blueprint: GOOD_BLUEPRINT });
  assert.equal(wrapped.ok, true);
});

test('normalizeEmblem keeps a proper emblem and rescues odd sizes', () => {
  const exact = B.normalizeEmblem(EMBLEMS.book);
  assert.deepEqual(exact, { rows: EMBLEMS.book, fixed: false });
  const big = B.normalizeEmblem(Array.from({ length: 16 }, () => 'o'.repeat(16)));
  assert.equal(big.rows.length, 12);
  assert.ok(big.rows.every((row) => row === 'o'.repeat(12)));
  assert.equal(B.normalizeEmblem(['o.', '..']), null, 'too few pixels to read');
  assert.equal(B.normalizeEmblem(42), null);
  const fromText = B.normalizeEmblem(EMBLEMS.star.join('\n'));
  assert.deepEqual(fromText.rows, EMBLEMS.star);
});

test('cleanText keeps copy calm and never splits a character', () => {
  assert.equal(B.cleanText('Wow! Great!!', 40), 'Wow. Great.');
  assert.equal(B.cleanText('Why?! Now', 40), 'Why? Now');
  assert.equal(B.cleanText('**Bold** `code` 🎉 done', 40), 'Bold code done');
  assert.equal(B.cleanText('Clip Studio', 28, { sentence: true }), 'Clip studio');
  assert.equal(B.cleanText('Encounter Builder for Pathfinder', 50, { sentence: true }), 'Encounter builder for Pathfinder');
  assert.equal(B.cleanText('Posts to TikTok', 50, { sentence: true }), 'Posts to TikTok');
  assert.equal(B.cleanText('Wait... okay', 40), 'Wait... okay');
  assert.equal(B.cleanText(null, 10), '');
  const emoji = `${'a'.repeat(9)}𝒳𝒳𝒳`;
  const cut = B.clampText(emoji, 10);
  assert.equal(Array.from(cut).length, 10);
  assert.ok(!/[\uD800-\uDBFF]$/.test(cut));
  assert.equal(B.clampText('one two three four five', 12, { ellipsis: true }), 'one two…');
});

test('validateSuggestions cleans, de-duplicates and skips what is built', () => {
  const list = B.validateSuggestions({
    suggestions: [
      { title: 'Clip Studio', pitch: 'Cuts clips!', why: 'You stream' },
      { title: 'clip studio', pitch: 'dup', why: 'dup' },
      { title: '', pitch: 'untitled', why: 'x' },
      { title: 'Town hall', pitch: 'built already', why: 'x' },
      { title: 'Map room', pitch: 'p'.repeat(300), why: 'w'.repeat(300), id: 'bad id with spaces' },
      { title: 'Seed library', pitch: 'Saves prompts.', why: 'Made up', id: 'local:seed', source: 'local' },
      { title: 'Fourth', pitch: 'extra', why: 'extra' },
    ],
  }, { source: 'codex', built: ['Town Hall'] });
  assert.deepEqual(list.map((item) => item.title), ['Clip studio', 'Map room', 'Seed library']);
  assert.deepEqual(list.map((item) => item.id), ['codex:1', 'codex:2', 'local:seed']);
  assert.deepEqual(list.map((item) => item.source), ['codex', 'codex', 'local']);
  assert.equal(list[0].pitch, 'Cuts clips.');
  assert.ok(Array.from(list[1].pitch).length <= B.LIMITS.pitch && list[1].pitch.endsWith('…'));
  assert.ok(Array.from(list[1].why).length <= B.LIMITS.why);
  for (const item of list) assert.deepEqual(Object.keys(item), ['id', 'title', 'pitch', 'why', 'source']);
  assert.deepEqual(B.validateSuggestions('garbage'), []);
  assert.deepEqual(B.validateSuggestions({ suggestions: [{ title: '日記' }, { title: '日記' }, { title: '読書室' }] }, { built: ['読書室'] }).map((item) => item.title), ['日記']);
  assert.deepEqual(B.validateSuggestions([{ title: 'Café corner' }, { title: 'Cafe corner' }]).map((item) => item.title), ['Café corner']);
  assert.equal(B.sameTitle('Caf', 'Café'), false);
  assert.equal(B.sameTitle('ドア', 'トア'), false, 'kana voicing marks count');
  assert.equal(B.sameTitle('कला', 'कल'), false, 'Indic vowel signs count');
  assert.equal(B.titleKey('  The Café! '), 'thecafe');
  assert.deepEqual(B.validateSuggestions([{ title: 'A' }, { title: 'B' }], { exclude: [{ title: 'A' }] }).map((item) => item.title), ['B']);
});

test('ideaFromText turns typed ideas into suggestions', () => {
  assert.deepEqual(B.ideaFromText(CLIP_IDEA), {
    id: 'own:clipstudio', title: 'Clip studio', pitch: 'Turns my drawing streams into TikToks', why: 'Your own idea', source: 'local',
  });
  assert.equal(B.ideaFromText('a bakery').title, 'Bakery');
  assert.equal(B.ideaFromText('Recipe box - saves recipes I like').pitch, 'Saves recipes I like');
  assert.equal(B.ideaFromText('somewhere to plan my Pathfinder sessions with friends every week').title, 'Your idea');
  assert.equal(B.ideaFromText('   '), null);
  assert.equal(namedIdea('somewhere to plan my Pathfinder sessions with friends every week').title, 'Game table');
});

test('share and progress lines say who is asked and what is shared', () => {
  assert.equal(B.shareNote('codex'), "Milo asks Codex (OpenAI) to draw up plans. It shares your idea, this plot's name and size, the names of your buildings and projects, and your skills' names with the start of each description. Never your sessions, and it can't open your files.");
  assert.match(B.shareNote('claude'), /^Milo asks Claude Code \(Anthropic\)/);
  assert.ok(!/Codex/.test(B.shareNote('claude')));
  assert.match(B.shareNote('claude', { auto: true }), /If Claude Code turns out not to be signed in, Milo asks Codex \(OpenAI\) instead\.$/);
  assert.equal(B.shareNote('codex', { auto: true }), B.shareNote('codex'));
  assertCalm(B.shareNote('claude', { auto: true }));
  assert.match(B.shareNote('kit'), /Nothing leaves your PC/);
  assert.equal(B.progressText('codex'), 'Codex is drawing up plans…');
  assert.equal(B.progressText('claude', 'suggest'), 'Claude Code is thinking up ideas…');
  for (const line of [B.shareNote('codex'), B.shareNote('claude'), B.shareNote('kit'), B.progressText('kit')]) assertCalm(line);
});

// ---------------------------------------------------------------------------------------------
// context.js

test('parseFrontmatter reads plain, quoted, folded and continued values', () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: plain words\n---\nbody'), { name: 'a', description: 'plain words' });
  assert.equal(parseFrontmatter('---\nname: "q"\ndescription: "Quoted: with \\"escapes\\""\n---').description, 'Quoted: with "escapes"');
  assert.equal(parseFrontmatter("---\ndescription: 'it''s single'\n---").description, "it's single");
  assert.equal(parseFrontmatter('---\ndescription: >\n  folded one\n  folded two\nname: f\n---').description, 'folded one folded two');
  assert.equal(parseFrontmatter('---\ndescription: |\n  line one\n\n  line two\n---').description, 'line one line two');
  assert.equal(parseFrontmatter('---\ndescription: starts here\n  and continues\n---').description, 'starts here and continues');
  assert.equal(parseFrontmatter('# no frontmatter'), null);
  const BOM = String.fromCharCode(0xfeff);
  assert.equal(parseFrontmatter(`${BOM}---\nname: bom\n---`).name, 'bom');
});

test('readSkills reads only frontmatter: names and 160-character descriptions', async (t) => {
  const ctx = await makeHome(t, {
    skills: {
      alpha: 'x'.repeat(400),
      beta: 'Short one.',
    },
  });
  await write(path.join(ctx.claudeHome, 'skills', 'no-name', 'SKILL.md'), '---\ndescription: Has no name field\n---\n');
  await write(path.join(ctx.claudeHome, 'skills', 'no-front', 'SKILL.md'), `# Just a body\n${MARKERS.body}\n`);
  await write(path.join(ctx.claudeHome, 'skills', 'no-file', 'README.md'), 'not a skill\n');
  await write(path.join(ctx.claudeHome, 'skills', '.hidden', 'SKILL.md'), '---\nname: hidden\n---\n');
  const skills = readSkills(path.join(ctx.claudeHome, 'skills'));
  assert.deepEqual(skills.map((skill) => skill.name), ['alpha', 'beta', 'no-front', 'no-name']);
  assert.equal(skills[0].description.length, 160);
  assert.equal(skills[1].description, 'Short one.');
  assert.equal(skills[2].description, '');
  assert.equal(skills[3].description, 'Has no name field');
  assert.ok(!JSON.stringify(skills).includes(MARKERS.body));
  assert.deepEqual(readSkills(path.join(ctx.root, 'nowhere')), []);
});

test('readProjects lists folder names only', async (t) => {
  const ctx = await makeHome(t, { projects: ['MILO', 'Habitack', 'art-stuff'] });
  await fsp.mkdir(path.join(ctx.projectsDir, 'node_modules'));
  assert.deepEqual(readProjects(ctx.projectsDir), ['art-stuff', 'Habitack', 'MILO']);
  assert.deepEqual(readProjects(path.join(ctx.root, 'nowhere')), []);
});

test('signals hold skills, projects and building names, nothing else, and are cached briefly', async (t) => {
  const ctx = await makeHome(t);
  let clock = 1000;
  const reader = createSignalReader({ claudeHome: ctx.claudeHome, projectsDir: ctx.projectsDir, now: () => clock });
  const first = reader.read(['Town hall', 'town hall', '', { name: 'Map room' }, 42]);
  assert.deepEqual(Object.keys(first), ['skills', 'projects', 'built']);
  assert.equal(first.skills.length, 6);
  assert.deepEqual(first.projects, ['Habitack', 'MILO']);
  assert.deepEqual(first.built, ['Town hall', 'Map room']);
  await write(path.join(ctx.projectsDir, 'Later', 'README.md'), 'x');
  assert.deepEqual(reader.read().projects, ['Habitack', 'MILO'], 'cached');
  clock += 60 * 1000;
  assert.deepEqual(reader.read().projects, ['Habitack', 'Later', 'MILO'], 'refreshed');
  const text = JSON.stringify(reader.read());
  for (const marker of Object.values(MARKERS)) assert.ok(!text.includes(marker), marker);
  assert.deepEqual(cleanBuilt(['a', 'A', ' b ']), ['a', 'b']);
});

// ---------------------------------------------------------------------------------------------
// offline.js

test("emblems are 12x12 and every theme's kit design is clean", () => {
  for (const [name, rows] of Object.entries(EMBLEMS)) {
    assert.equal(rows.length, 12, name);
    for (const row of rows) {
      assert.equal(row.length, 12, name);
      for (const ch of row) assert.ok(ch === '.' || B.EMBLEM_KEYS[ch], `${name}: ${ch}`);
    }
  }
  for (const [key, theme] of Object.entries(THEMES)) {
    for (let variant = 0; variant < 3; variant += 1) {
      const bp = kitBlueprint(theme.name, { variant });
      const checked = B.validateBlueprint(bp);
      assert.equal(checked.ok, true, key);
      assert.deepEqual(checked.problems, [], key);
      assertBlueprintShape(bp);
      assert.notEqual(bp.style.wallColor, bp.style.roofColor, `${key} walls and roof differ`);
    }
  }
});

test('the kit designs any idea by keyword', () => {
  const bakery = kitBlueprint('a bakery');
  assert.equal(bakery.name, 'Bakery');
  assert.notEqual(bakery.style.awning, 'none');
  assert.ok(['butter', 'honey', 'cream', 'blossom', 'clay'].includes(bakery.style.wallColor));
  assert.ok(bakery.props.some((item) => item.kind === 'crates'));
  assert.deepEqual(bakery.emblem, EMBLEMS.bread);

  const studio = kitBlueprint(CLIP_IDEA, { plot: RISE });
  assert.equal(studio.name, 'Clip studio');
  assert.ok(studio.props.some((item) => item.kind === 'easel'));
  assert.ok(studio.props.some((item) => item.kind === 'camera'));
  assert.equal(studio.purpose, 'Finds the best moments in your drawing streams and turns them into short vertical clips, ready for TikTok.');
  assert.equal(studio.levels[1].proof, 'A clip file appears in the output folder and plays start to finish.');

  const own = kitBlueprint('Pebble tracker: counts my pebbles');
  assert.equal(own.name, 'Pebble tracker');
  assert.equal(own.purpose, 'Counts your pebbles.');
  assert.equal(own.style.shape, 'cottage');
  assert.deepEqual(own.emblem, EMBLEMS.house);
  assert.match(own.levels[0].summary, /one small job/);

  assert.equal(kitBlueprint('somewhere to plan my Pathfinder sessions').name, 'Game table');
  assert.equal(themeFor('turns my drawing streams into TikToks'), 'clips');
  assert.equal(themeFor('a gallery for my sketches'), 'art');
  assert.equal(themeFor('xyzzy'), 'cottage');

  const texts = ['a library', 'fantasy football help', 'sort my inbox', 'habit quests', 'herb garden', 'stats dashboard',
    'voice memos', 'tiny scripts', 'csv cleanup', 'news digest', 'meal plans', 'budget ledger', 'deadline reminders',
    'expert quizzes', 'github alerts', 'sleep and yoga', 'dice night', 'lore wiki', '', '!!!', 'x'.repeat(500)];
  for (const idea of texts) {
    const bp = kitBlueprint(idea || 'Idea');
    assert.deepEqual(B.validateBlueprint(bp).problems, [], idea);
    for (const item of bp.levels) assertCalm(`${item.title} ${item.summary} ${item.proof}`);
    assertCalm(`${bp.name} ${bp.tagline} ${bp.purpose}`);
  }
});

test('the kit applies tweaks and moves on when redesigning', () => {
  const bakery = kitBlueprint('a bakery');
  const cozier = kitBlueprint('a bakery', { tweak: 'make it cozier', previous: bakery });
  assert.equal(cozier.style.chimney, true);
  assert.equal(cozier.style.walls, 'log');
  assert.equal(cozier.yard, 'flowers');
  assert.ok(cozier.props.some((item) => item.kind === 'lantern'));
  assert.equal(cozier.style.shape, bakery.style.shape, 'keeps the old shape');
  const blue = kitBlueprint('a bakery', { tweak: 'blue roof, taller, stone walls', previous: bakery });
  assert.equal(blue.style.roofColor, 'slate');
  assert.equal(blue.style.shape, 'tower');
  assert.equal(blue.style.walls, 'stone');
  const again = kitBlueprint('a bakery', { previous: bakery });
  assert.notEqual(`${again.style.wallColor}/${again.style.roofColor}`, `${bakery.style.wallColor}/${bakery.style.roofColor}`);
  for (const bp of [cozier, blue, again]) assert.deepEqual(B.validateBlueprint(bp).problems, []);
});

test("local suggestions are tailored to Chris's signals and differ per plot", async (t) => {
  const ctx = await makeHome(t);
  const signals = createSignalReader({ claudeHome: ctx.claudeHome, projectsDir: ctx.projectsDir }).read([]);
  const lists = PLOTS.map((plot) => localSuggestions(plot, signals));
  const titles = lists.map((list) => list.map((item) => item.title));
  assert.deepEqual(titles.map((list) => list[0]), ['Town hall', 'Clip studio', 'Campaign archive', 'Game table', 'Skill forge']);
  for (const list of lists) {
    assert.equal(list.length, 3);
    assert.equal(new Set(list.map((item) => item.title)).size, 3);
    for (const item of list) {
      assert.deepEqual(Object.keys(item), ['id', 'title', 'pitch', 'why', 'source']);
      assert.equal(item.source, 'local');
      assert.ok(item.id.startsWith('local:'));
      assert.ok(Array.from(item.title).length <= B.LIMITS.title);
      assert.ok(Array.from(item.pitch).length <= B.LIMITS.pitch);
      assert.ok(Array.from(item.why).length <= B.LIMITS.why);
      assertCalm(`${item.title} ${item.pitch} ${item.why}`);
    }
  }
  assert.equal(new Set(titles.flat()).size, 15, 'no idea appears on two plots');
  const all = lists.flat();
  const byTitle = Object.fromEntries(all.map((item) => [item.title, item]));
  assert.equal(byTitle['Clip studio'].why, 'You have the video-expert and video-to-agent skills');
  assert.equal(byTitle['Town hall'].why, "You're building Habitack");
  assert.match(byTitle['Town hall'].pitch, /Habitack/);
  assert.equal(byTitle['Sorting office'].why, 'You have the jev skill');
  assert.match(byTitle['Draft room'].why, /expert-fantasy-football-drafting/);
  assert.match(byTitle['Game table'].why, /expert-pf2e-encounter-design/);
  const tailored = all.filter((item) => /^You/.test(item.why));
  assert.ok(tailored.length >= 8, 'every tailored idea names its evidence');
  // Stable: the same signals give the same lists.
  assert.deepEqual(PLOTS.map((plot) => localSuggestions(plot, signals)), lists);
});

test('local suggestions never repeat a building, answer questions and stay fresh', async (t) => {
  const ctx = await makeHome(t);
  const reader = createSignalReader({ claudeHome: ctx.claudeHome, projectsDir: ctx.projectsDir });
  const withBuilt = reader.read(['Clip studio', 'Town Hall']);
  for (const plot of PLOTS) {
    for (const item of localSuggestions(plot, withBuilt)) assert.ok(!['clip studio', 'town hall'].includes(item.title.toLowerCase()));
  }
  const signals = reader.read([]);
  const shown = localSuggestions(RISE, signals);
  const asked = localSuggestions(RISE, signals, { question: 'something for my drawing streams', exclude: shown });
  assert.equal(asked.length, 3);
  for (const item of asked) assert.ok(!shown.some((other) => other.title === item.title), item.title);
  assert.ok(asked.some((item) => /stream|art|draw/i.test(`${item.title} ${item.pitch}`)));
  assert.equal(localSuggestions(RISE, signals, { question: 'something for my drawing streams' })[0].title, 'Clip studio');
  const bakery = localSuggestions(PLOTS[3], signals, { question: 'a bakery' });
  assert.equal(bakery[0].title, 'Bakery');
  assert.equal(bakery[0].why, 'You asked for a bakery');
  const odd = localSuggestions(PLOTS[2], signals, { question: 'zxqv' });
  assert.equal(odd.length, 3);
  const more = localSuggestions(PLOTS[3], signals, { exclude: localSuggestions(PLOTS[3], signals) });
  assert.equal(more.length, 3);
  assert.equal(new Set(more.map((item) => item.title)).size, 3);
});

test('local ideas give their own reasons: the plot flavour fits, shows once at most, never repeats', async (t) => {
  const ctx = await makeHome(t);
  const rich = createSignalReader({ claudeHome: ctx.claudeHome, projectsDir: ctx.projectsDir }).read([]);
  const thin = { skills: [{ name: 'jev', description: 'Made-up sorter.' }], projects: [], built: [] };
  const empty = { skills: [], projects: [], built: [] };
  for (const [label, signals] of [['rich', rich], ['thin', thin], ['empty', empty]]) {
    for (const plot of PLOTS) {
      const list = localSuggestions(plot, signals);
      const whys = list.map((item) => item.why);
      assert.equal(new Set(whys).size, 3, `${label} ${plot.id}: ${whys.join(' | ')}`);
      assert.ok(whys.filter((why) => /a good fit for/.test(why)).length <= 1, `${label} ${plot.id}`);
      for (const item of list) {
        assert.ok(!/soil and old trees, a good fit for an? (bakery|skill forge)/i.test(item.why), item.why);
        assert.ok(!/by the pond, a good fit for an? (bakery|game table)/i.test(item.why), item.why);
        assert.notEqual(item.why, 'A good all-round pick for a new plot', `${label} ${plot.id} ${item.title}`);
      }
    }
  }
  const bakery = localSuggestions(PLOTS[3], empty, { question: 'somewhere for my sourdough' });
  assert.equal(bakery[0].title, 'Bakery');
});

test('local suggestions still work with no signals at all', () => {
  const empty = { skills: [], projects: [], built: [] };
  const lists = PLOTS.map((plot) => localSuggestions(plot, empty));
  for (const list of lists) assert.equal(list.length, 3);
  assert.equal(new Set(lists.flat().map((item) => item.title)).size, 15);
  const everything = { skills: [], projects: [], built: [...IDEAS.map((idea) => idea.title), ...Object.values(THEMES).map((theme) => theme.name)] };
  const fallback = localSuggestions({ id: 'plot-x' }, everything);
  assert.ok(fallback.length <= 3);
  for (const item of fallback) assert.ok(!everything.built.some((name) => B.sameTitle(name, item.title)));
  const unknownPlot = localSuggestions({ id: 'plot-new', name: 'New', w: 5, h: 5 }, empty);
  assert.equal(unknownPlot.length, 3);
  const shares = allocate(empty, PLOT_ORDER);
  assert.deepEqual(Object.keys(shares), [...PLOT_ORDER]);
});

// ---------------------------------------------------------------------------------------------
// prompts.js

test('briefs describe the job and carry only allowed signals', async (t) => {
  const ctx = await makeHome(t);
  const signals = createSignalReader({ claudeHome: ctx.claudeHome, projectsDir: ctx.projectsDir }).read(['Town hall']);
  const idea = { id: 'local:clip-studio', title: 'Clip studio', pitch: 'Turns drawing streams into clips.', why: 'You have the video-expert skill', source: 'local' };
  const brief = designPrompt({ plot: RISE, idea, tweak: 'make it "cozier"\nplease', signals, previous: GOOD_BLUEPRINT });
  assert.match(brief, /Sunny rise, 7 x 5 tiles of 16 px/);
  assert.match(brief, /Chris's idea: "Clip studio: Turns drawing streams into clips\."/);
  assert.match(brief, /Chris's change for this version: "make it 'cozier' please"/);
  assert.match(brief, /redesign of "Clip studio", which was a workshop with plank walls in lavender/);
  assert.match(brief, /Buildings already in the village: Milo's camp, the Watchtower, Town hall\./);
  assert.match(brief, /His project folders: Habitack, MILO\./);
  for (const [name, description] of Object.entries(SKILLS)) assert.ok(brief.includes(`- ${name}: ${description}`), name);
  assert.match(brief, /exactly 12 strings of exactly 12 characters/);
  assert.match(brief, /Level 1 is small but useful on its own/);
  // Two emblems that read well show the format; the brief asks for a look that names the job.
  assert.ok(brief.includes(EMBLEMS.d20.join('\n')) && brief.includes(EMBLEMS.book.join('\n')));
  assert.match(brief, /guess the job from the building alone/);
  assert.match(brief, /Keep the name Chris gave his idea/);
  const typed = { id: 'own:x', title: 'Study hall', pitch: 'Something for my coursework reading', why: 'Your own idea', source: 'local' };
  const unnamed = designPrompt({ plot: RISE, idea: typed, signals, named: false });
  assert.match(unnamed, /Chris's idea, in his words: "Something for my coursework reading"\. He didn't name it, so name it yourself\./);
  assert.ok(!unnamed.includes('Study hall'), "the kit's stand-in title stays out of the brief");
  const ask = suggestPrompt({ plot: PLOTS[0], question: 'something for my drawing streams', signals, exclude: [{ title: 'Map room' }] });
  assert.match(ask, /Suggest exactly 3 buildings for the plot Long meadow, 13 x 4 tiles of 16 px \(wide and shallow\)/);
  assert.match(ask, /Chris asked: "something for my drawing streams"/);
  assert.match(ask, /Already suggested here, so offer different ones: Map room\./);
  for (const text of [brief, ask]) {
    for (const marker of Object.values(MARKERS)) assert.ok(!text.includes(marker), marker);
    assert.ok(!text.includes('.hidden') && !text.includes('notes.txt'));
  }
  assert.equal(quoteLine('a\nb "c"', 300), `"a b 'c'"`);
  assert.equal(quoteLine('x'.repeat(500), 10), `"${'x'.repeat(10)}"`);
});

// ---------------------------------------------------------------------------------------------
// crew.js

test('crew argument shapes are exact', () => {
  assert.deepEqual(claudeArgs({ a: 1 }), [
    '-p', '--output-format', 'json', '--json-schema', '{"a":1}', '--tools', '', '--no-session-persistence',
    '--setting-sources', 'project', '--model', 'sonnet',
  ]);
  const dir = path.join(os.tmpdir(), 'milo-crew-abc');
  assert.deepEqual(codexArgs(dir), [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules',
    ...CODEX_LOCKDOWN.flatMap((setting) => ['-c', setting]),
    '-C', dir, '--output-schema', path.join(dir, 'schema.json'), '-o', path.join(dir, 'out.json'), '--color', 'never', '-',
  ]);
  // Checked with a localhost capture of codex-cli 0.158: these keep the skills block, the file and
  // command tools and the environment notes out of the request. Only -c settings: an unknown one
  // is ignored by Codex, where an unknown --disable would stop it.
  for (const setting of [
    'skills.include_instructions=false', 'features.shell_tool=false', 'features.unified_exec=false', 'features.code_mode_host=false',
    'features.view_image=false', 'include_environment_context=false', 'include_permissions_instructions=false', 'web_search="disabled"',
  ]) assert.ok(CODEX_LOCKDOWN.includes(setting), setting);
  assert.ok(!codexArgs(dir).includes('--disable') && !codexArgs(dir).includes('--enable'));
  for (const setting of CODEX_LOCKDOWN) assert.match(setting, /^[a-z_.]+=(false|"[a-z]+")$/);
  assert.deepEqual([...CLAUDE_AUTH_ARGS], ['auth', 'status', '--json']);
  assert.deepEqual([...CODEX_LOGIN_ARGS], ['login', 'status']);
});

test('finds Claude Code and Codex in the documented places', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-bins-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const env = {
    USERPROFILE: path.join(root, 'profile'), APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'),
    Path: path.join(root, 'pathbin'),
  };
  const opts = { env, home: path.join(root, 'home'), platform: 'win32' };
  assert.equal(findClaude(opts), null);
  assert.equal(findCodex(opts), null);

  const version = (v) => path.join(env.APPDATA, 'Claude', 'claude-code', v, 'claude.exe');
  for (const v of ['2.1.99', '2.1.280', '2.1.281']) await write(version(v), 'fake');
  await fsp.mkdir(path.join(env.APPDATA, 'Claude', 'claude-code', '2.9.0'), { recursive: true });
  assert.equal(findClaude(opts), version('2.1.281'));
  const local = path.join(env.USERPROFILE, '.local', 'bin', 'claude.exe');
  await write(local, 'fake');
  assert.equal(findClaude(opts), local);
  assert.equal(findClaude({ ...opts, env: { ...env, MILO_CLAUDE_BIN: FAKE_CLAUDE } }), FAKE_CLAUDE);
  assert.equal(findClaude({ ...opts, env: { ...env, MILO_CLAUDE_BIN: path.join(root, 'missing.exe') } }), null);

  const onPath = path.join(env.Path, 'codex.exe');
  await write(onPath, 'fake');
  assert.equal(findCodex(opts), onPath);
  const older = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', 'aaaa', 'codex.exe');
  const newer = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', 'bbbb', 'codex.exe');
  await write(older, 'fake');
  await write(newer, 'fake');
  await write(path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', 'cccc', 'rg.exe'), 'fake');
  await fsp.utimes(older, new Date('2026-09-01'), new Date('2026-09-01'));
  await fsp.utimes(newer, new Date('2026-09-20'), new Date('2026-09-20'));
  assert.equal(findCodex(opts), newer);
  assert.equal(findCodex({ ...opts, env: { ...env, MILO_CODEX_BIN: FAKE_CODEX } }), FAKE_CODEX);
  assert.ok(compareVersions('2.1.281', '2.1.99') > 0);
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('crew runs without the host session markers', () => {
  const nested = {
    Path: 'x', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_CODE_OAUTH_SCOPES: 's', CLAUDE_AGENT_SDK_VERSION: '1',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'k', ELECTRON_RUN_AS_NODE: '1', CODEX_HOME: 'c',
  };
  assert.deepEqual(childEnv(nested), { Path: 'x', ANTHROPIC_API_KEY: 'k', CODEX_HOME: 'c' });
  const plain = { Path: 'x', CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'u' };
  assert.deepEqual(childEnv(plain), plain);
});

test('crew answers are read as data', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure: {"a":{"b":2}} done'), { a: { b: 2 } });
  assert.equal(extractJson('[1,2]'), null);
  assert.equal(extractJson('nothing'), null);
  const envelope = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '', error: null, ms: 5 });
  assert.deepEqual(interpretClaude(envelope({ type: 'result', is_error: false, result: '', structured_output: { a: 1 } })), { ms: 5, ok: true, data: { a: 1 }, loose: false });
  assert.equal(interpretClaude({ ...envelope({ type: 'result', is_error: true, result: 'Failed to authenticate. API Error: 401' }), code: 1 }).code, 'auth');
  assert.equal(interpretClaude({ code: 1, stdout: '', stderr: 'Not logged in · Please run /login', error: null }).code, 'auth');
  assert.equal(interpretClaude({ ...envelope({ type: 'result', is_error: false, result: 'no json here' }) }).code, 'invalid');
  assert.equal(interpretClaude({ code: null, stdout: '', stderr: '', error: 'timeout' }).code, 'timeout');
  assert.equal(interpretClaude({ code: 3, stdout: '', stderr: 'boom', error: null }).code, 'failed');
  assert.equal(interpretClaude(envelope({ type: 'result', is_error: false, result: '```json\n{"a":1}\n```' })).loose, true);
  assert.deepEqual(interpretCodex({ code: 0, stdout: '', stderr: '', error: null, ms: 1 }, '{"a":1}'), { ms: 1, ok: true, data: { a: 1 }, loose: false });
  assert.equal(interpretCodex({ code: 1, stdout: '', stderr: 'Error: Not logged in', error: null }, null).code, 'auth');
  assert.equal(interpretCodex({ code: 0, stdout: 'blah', stderr: '', error: null }, 'blah').code, 'invalid');
  assert.equal(interpretCodex({ code: 2, stdout: '', stderr: 'boom', error: null }, null).code, 'failed');
  assert.equal(interpretCodex({ code: null, stdout: '', stderr: '', error: 'cancelled' }, null).code, 'cancelled');
});

// ---------------------------------------------------------------------------------------------
// index.js with the fake crew

test('Codex designs a building: exact flags, no shell, a fresh temp dir and the brief on stdin', async (t) => {
  const ctx = await makeHome(t);
  const calls = [];
  const architect = makeArchitect(ctx, { mode: 'codex', calls });
  const result = await architect.design({ plot: RISE, idea: CLIP_IDEA, built: ['Town hall'] });
  assert.equal(result.by, 'codex');
  assert.deepEqual(result.repairs, []);
  assert.equal(result.note, '');
  assert.deepEqual(result.blueprint, GOOD_BLUEPRINT);
  assert.equal(result.idea.title, 'Clip studio');
  assertBlueprintShape(result.blueprint);
  assert.equal(calls.length, 1);
  const [call] = calls;
  const dir = call.options.cwd;
  assert.equal(call.command, FAKE_CODEX);
  assert.deepEqual(call.args, codexArgs(dir));
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(path.dirname(dir), os.tmpdir());
  assert.match(path.basename(dir), /^milo-crew-/);
  assert.ok(!fs.existsSync(dir), 'temp dir removed afterwards');
  const [run] = readLog(ctx.log);
  assert.deepEqual(run.cwdEntries, ['schema.json']);
  assert.equal(run.nested, false);
  assert.match(run.stdin, /Design one building for the plot Sunny rise, 7 x 5 tiles/);
  assert.match(run.stdin, /Chris's idea: "Clip studio: Turns my drawing streams into TikToks"/);
  for (const marker of Object.values(MARKERS)) assert.ok(!run.stdin.includes(marker), marker);
});

test('Claude Code designs a building with the exact flags from an empty temp dir', async (t) => {
  const ctx = await makeHome(t);
  const calls = [];
  const architect = makeArchitect(ctx, { mode: 'claude', calls });
  const result = await architect.design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(result.by, 'claude');
  assert.deepEqual(result.blueprint, GOOD_BLUEPRINT);
  const call = calls.find((item) => item.args[0] === '-p');
  assert.deepEqual(call.args, [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(B.BLUEPRINT_SCHEMA), '--tools', '', '--no-session-persistence',
    '--setting-sources', 'project', '--model', 'sonnet',
  ]);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  const run = readLog(ctx.log).find((item) => item.argv[0] === '-p');
  assert.deepEqual(run.cwdEntries, []);
  assert.match(run.stdin, /Design one building/);
});

test('auto mode: Claude Code signed out, so Codex is asked and status says how to sign in', async (t) => {
  const ctx = await makeHome(t);
  const calls = [];
  const architect = makeArchitect(ctx, { claude: 'auth', calls });
  const status = await architect.status();
  assert.equal(status.designer, 'codex');
  assert.equal(status.mode, 'auto');
  assert.equal(status.share, B.shareNote('codex'));
  assert.deepEqual(status.crew, [
    { id: 'claude', found: true, ready: false, detail: DETAILS.claudeSignIn },
    { id: 'codex', found: true, ready: true, detail: DETAILS.ready },
  ]);
  const result = await architect.design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(result.by, 'codex');
  assert.ok(!calls.some((item) => item.args[0] === '-p'), 'Claude was never asked to design');
  assert.deepEqual(calls.filter((item) => item.args[0] === 'auth').length, 1, 'sign-in probed once');
});

test('auto mode: a Claude call that fails to authenticate moves on to Codex', async (t) => {
  const ctx = await makeHome(t);
  const calls = [];
  const architect = makeArchitect(ctx, { claude: 'auth-call', calls });
  assert.equal((await architect.status()).designer, 'claude');
  const result = await architect.design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(result.by, 'codex');
  assert.equal(result.note, "Claude Code isn't signed in, so Codex drew this one.");
  assert.deepEqual(calls.map((item) => item.args[0]).filter((arg) => arg !== 'auth' && arg !== 'login'), ['-p', 'exec']);
  const after = await architect.status();
  assert.equal(after.designer, 'codex');
  assert.deepEqual(after.crew[0], { id: 'claude', found: true, ready: false, detail: 'Sign in by running claude in a terminal once' });
  const next = await architect.suggest({ plot: RISE });
  assert.equal(next.by, 'codex');
  assert.equal(calls.filter((item) => item.args[0] === '-p').length, 1, 'not asked again this launch');
});

test('Claude Code chosen but signed out: Milo draws it himself and says so', async (t) => {
  const ctx = await makeHome(t);
  const calls = [];
  const architect = makeArchitect(ctx, { mode: 'claude', claude: 'auth', calls });
  const result = await architect.design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(result.by, 'kit');
  assert.equal(result.note, "Claude Code isn't signed in, so Milo drew this one himself.");
  assertBlueprintShape(result.blueprint);
  const ideas = await architect.suggest({ plot: RISE });
  assert.equal(ideas.by, 'kit');
  assert.equal(ideas.suggestions.length, 3);
  assert.equal(ideas.note, "Claude Code isn't signed in, so these are Milo's own ideas.");
  assert.equal(calls.filter((item) => item.args[0] === '-p').length, 1, 'asked once, then skipped for this launch');
  const status = await architect.status();
  assert.equal(status.designer, 'kit');
  assert.equal(status.share, B.shareNote('kit'));
  assert.deepEqual(status.crew[0], { id: 'claude', found: true, ready: false, detail: DETAILS.claudeSignIn });
});

test('odd crew output is repaired, or the kit steps in', async (t) => {
  const ctx = await makeHome(t);
  const run = (codex, extra = {}) => makeArchitect(ctx, { mode: 'codex', codex, ...extra }).design({ plot: RISE, idea: CLIP_IDEA });

  const garbage = await run('garbage');
  assert.equal(garbage.by, 'kit');
  assert.equal(garbage.note, "Codex's answer was hard to read, so Milo drew this one himself.");
  assertBlueprintShape(garbage.blueprint);

  const partial = await run('partial');
  assert.equal(partial.by, 'codex');
  assert.ok(partial.repairs.length > 3);
  assertBlueprintShape(partial.blueprint);
  assert.equal(partial.blueprint.name, 'The grand clip studio');
  assert.equal(partial.blueprint.style.wallColor, 'lavender');
  assert.equal(partial.blueprint.style.roof, 'dome');
  assert.equal(partial.blueprint.style.walls, 'plank');
  assert.deepEqual(partial.blueprint.props.map((item) => item.kind), ['camera', 'camera', 'easel', 'lantern']);
  assert.deepEqual(partial.blueprint.levels.map((item) => item.title), ['Finds good moments', 'Cuts a clip', 'Vertical crop', 'Captions', 'Whole stream']);

  const thin = await run('thin');
  assert.equal(thin.by, 'kit');
  assert.match(thin.note, /hard to read/);

  const text = await run('text');
  assert.equal(text.by, 'codex');
  assert.deepEqual(text.repairs, ['read JSON from plain text']);

  const crash = await run('crash');
  assert.equal(crash.by, 'kit');
  assert.equal(crash.note, "Codex didn't answer, so Milo drew this one himself.");

  const claudeText = await makeArchitect(ctx, { mode: 'claude', claude: 'text' }).design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(claudeText.by, 'claude');
  assert.deepEqual(claudeText.blueprint, GOOD_BLUEPRINT);
});

test('a crew member that never answers times out and the kit steps in', async (t) => {
  const ctx = await makeHome(t);
  const started = Date.now();
  const result = await makeArchitect(ctx, { mode: 'codex', codex: 'hang', timeoutMs: 700 }).design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(result.by, 'kit');
  assert.equal(result.note, "Codex didn't answer, so Milo drew this one himself.");
  assert.ok(Date.now() - started < 6000);
  const [run] = readLog(ctx.log);
  assert.ok(await waitFor(() => !isAlive(run.pid)), 'the hung process was stopped');
});

test('cancel() stops a running design and frees the architect', async (t) => {
  const ctx = await makeHome(t);
  const architect = makeArchitect(ctx, { mode: 'codex', codex: 'hang' });
  const pending = architect.design({ plot: RISE, idea: CLIP_IDEA });
  const run = await waitFor(() => readLog(ctx.log).find((item) => item.argv[0] === 'exec'));
  assert.ok(run, 'the crew call started');
  assert.equal(architect.busy(), true);
  architect.cancel();
  await assert.rejects(pending, { code: 'cancelled', message: 'Milo stopped asking the crew' });
  assert.equal(architect.busy(), false);
  assert.ok(await waitFor(() => !isAlive(run.pid)), 'the process was stopped');
  architect.cancel();
});

test('one crew call at a time', async (t) => {
  const ctx = await makeHome(t);
  const architect = makeArchitect(ctx, { mode: 'codex', codex: 'hang' });
  const pending = architect.design({ plot: RISE, idea: CLIP_IDEA });
  await assert.rejects(architect.suggest({ plot: RISE }), { code: 'busy', message: BUSY_MESSAGE });
  await assert.rejects(architect.design({ plot: RISE, idea: 'x' }), { code: 'busy' });
  const cancelledAt = Date.now();
  architect.cancel();   // lands before the crew process has even started
  await assert.rejects(pending, { code: 'cancelled' });
  assert.ok(Date.now() - cancelledAt < 5000, 'a cancel during start-up still stops the call promptly');
  assert.equal(architect.busy(), false);
  await assert.rejects(architect.design({ plot: RISE, idea: '   ' }), { code: 'no-idea' });
});

test('kit mode never runs a crew CLI', async (t) => {
  const ctx = await makeHome(t);
  const refuse = () => { throw new Error('no spawning in kit mode'); };
  for (const mode of ['kit', 'offline']) {
    const architect = makeArchitect(ctx, { mode, spawnImpl: refuse });
    const status = await architect.status({ designer: 'codex' });
    assert.equal(status.designer, 'kit');
    assert.equal(status.share, B.shareNote('kit'));
    assert.ok(status.crew.every((entry) => entry.detail === DETAILS.offline));
    const ideas = await architect.suggest({ plot: RISE, question: 'a bakery', designer: 'claude' });
    assert.equal(ideas.by, 'kit');
    assert.equal(ideas.suggestions[0].title, 'Bakery');
    const built = await architect.design({ plot: RISE, idea: ideas.suggestions[0], designer: 'codex' });
    assert.equal(built.by, 'kit');
    assert.equal(built.blueprint.name, 'Bakery');
  }
  assert.deepEqual(readLog(ctx.log), []);
});

test('the designer setting picks the crew per call', async (t) => {
  const ctx = await makeHome(t);
  const calls = [];
  const architect = makeArchitect(ctx, { calls });
  assert.equal((await architect.status({ designer: 'kit' })).designer, 'kit');
  assert.equal((await architect.status({ designer: 'codex' })).designer, 'codex');
  assert.equal((await architect.design({ plot: RISE, idea: CLIP_IDEA, designer: 'kit' })).by, 'kit');
  assert.equal((await architect.design({ plot: RISE, idea: CLIP_IDEA, designer: 'codex' })).by, 'codex');
  assert.equal((await architect.design({ plot: RISE, idea: CLIP_IDEA, designer: 'claude' })).by, 'claude');
  assert.equal((await architect.design({ plot: RISE, idea: CLIP_IDEA })).by, 'claude', 'auto prefers a signed-in Claude Code');
});

test('a script crew runs without spawnImpl (MILO_*_BIN)', async (t) => {
  const ctx = await makeHome(t);
  const architect = makeArchitect(ctx, { mode: 'codex', spawnImpl: null });
  const result = await architect.design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(result.by, 'codex');
  assert.deepEqual(result.blueprint, GOOD_BLUEPRINT);
});

test('Codex suggests three ideas; thin or messy answers are tidied and topped up', async (t) => {
  const ctx = await makeHome(t);
  const ask = (codex) => makeArchitect(ctx, { mode: 'codex', codex }).suggest({
    plot: PLOTS[0], question: 'something for my drawing streams', built: ['Town hall'], exclude: [{ title: 'Draft room' }],
  });
  const good = await ask('ok');
  assert.equal(good.by, 'codex');
  assert.deepEqual(good.repairs, []);
  assert.deepEqual(good.suggestions.map((item) => item.title), ['Kiln room', 'Map room', 'Seed library']);
  assert.deepEqual(good.suggestions.map((item) => item.id), ['codex:1', 'codex:2', 'codex:3']);
  assert.ok(good.suggestions.every((item) => item.source === 'codex'));
  const brief = readLog(ctx.log).find((item) => item.argv[0] === 'exec').stdin;
  assert.match(brief, /Chris asked: "something for my drawing streams"/);
  assert.match(brief, /Already suggested here, so offer different ones: Draft room\./);
  assert.match(brief, /Buildings already in the village: Milo's camp, the Watchtower, Town hall\./);

  const thin = await ask('thin');
  assert.equal(thin.by, 'codex');
  assert.equal(thin.suggestions.length, 3);
  assert.equal(thin.suggestions[0].title, 'Kiln room');
  assert.ok(thin.suggestions.slice(1).every((item) => item.source === 'local'));
  assert.ok(thin.suggestions.every((item) => !['Town hall', 'Draft room'].includes(item.title)));
  assert.ok(thin.repairs.includes("topped up with Milo's own ideas"));

  const messy = await ask('partial');
  assert.deepEqual(messy.suggestions.map((item) => item.title), ['Kiln room', 'Map room', 'Seed library']);
  assert.equal(messy.suggestions[0].pitch, 'Fires off small batch jobs overnight.');
  assert.ok(messy.suggestions[1].pitch.endsWith('…'));
  assert.ok(messy.repairs.length > 0);

  const broken = await ask('garbage');
  assert.equal(broken.by, 'kit');
  assert.equal(broken.suggestions.length, 3);
  assert.equal(broken.note, "Codex's answer was hard to read, so these are Milo's own ideas.");
});

test('localSuggestions on the architect is instant and offline', async (t) => {
  const ctx = await makeHome(t);
  const refuse = () => { throw new Error('no spawning for local ideas'); };
  const architect = makeArchitect(ctx, { spawnImpl: refuse });
  const list = architect.localSuggestions(RISE, ['Gallery']);
  assert.equal(list.length, 3);
  assert.deepEqual(list.slice(0, 2).map((item) => item.title), ['Clip studio', 'Observatory']);
  assert.ok(!list.some((item) => item.title === 'Gallery'));
  assert.deepEqual(cleanPlot({ id: '../etc', name: 'x'.repeat(80), w: 999, h: -1 }), { id: 'plot', name: 'x'.repeat(40), w: 64, h: 6 });
});

test("fake mode gives the UI tests a deterministic crew", async () => {
  const architect = createArchitect({ mode: 'fake', fakeDelayMs: 30, env: {}, home: os.tmpdir(), claudeHome: path.join(os.tmpdir(), 'milo-none'), projectsDir: path.join(os.tmpdir(), 'milo-none') });
  const status = await architect.status();
  assert.equal(status.designer, 'codex');
  assert.equal(status.crew[0].detail, DETAILS.claudeSignIn);
  const first = await architect.suggest({ plot: RISE });
  const second = await architect.suggest({ plot: RISE, question: 'more' });
  assert.equal(first.by, 'codex');
  assert.equal(first.suggestions.length, 3);
  assert.equal(second.suggestions.length, 3);
  assert.ok(first.suggestions.every((item) => !second.suggestions.some((other) => other.title === item.title)), 'asking again gives new ones');
  const built = await architect.design({ plot: RISE, idea: first.suggestions[0] });
  assert.equal(built.by, 'codex');
  assert.equal(built.blueprint.name, first.suggestions[0].title);
  assert.deepEqual(B.validateBlueprint(built.blueprint).problems, []);
  const failed = await architect.design({ plot: RISE, idea: 'Something that will fail' });
  assert.equal(failed.by, 'kit');
  assert.equal(failed.note, "Codex didn't answer, so Milo drew this one himself.");
  const redesign = await architect.design({ plot: RISE, idea: first.suggestions[0], tweak: 'make it cozier', previous: built.blueprint });
  assert.equal(redesign.blueprint.style.chimney, true);
  assert.equal((await architect.status({ designer: 'kit' })).designer, 'kit');
  assert.equal((await architect.design({ plot: RISE, idea: 'x', designer: 'kit' })).by, 'kit');
});

test('an idea typed without a name reaches the crew in his words, and the crew names it', async (t) => {
  const ctx = await makeHome(t);
  const architect = makeArchitect(ctx, { mode: 'codex', calls: [] });
  const result = await architect.design({ plot: RISE, idea: 'Something for my university coursework reading' });
  assert.equal(result.by, 'codex');
  assert.equal(result.idea.title, 'Study hall', "the kit's stand-in title while the crew works");
  const [run] = readLog(ctx.log);
  assert.match(run.stdin, /Chris's idea, in his words: "Something for my university coursework reading"\. He didn't name it, so name it yourself\./);
  assert.ok(!run.stdin.includes('Study hall'));
});

test("the kit's own designs fit the idea: pool matches, theme trees and honest fallbacks", () => {
  const typed = namedIdea('Something for my university coursework reading');
  assert.equal(typed.title, 'Study hall');
  const study = kitBlueprint(typed);
  assert.equal(study.levels[0].title, 'Summarises one reading');
  assert.equal(study.purpose, 'Turns course readings into summaries, flashcards and practice questions.');
  assert.equal(kitBlueprint('Something for my university coursework reading').name, 'Study hall');

  const bakery = kitBlueprint('A cozy bakery');
  assert.equal(bakery.name, 'Cozy bakery');
  assert.notEqual(bakery.purpose, 'A cozy bakery.', 'a name alone is not a purpose');
  assert.equal(bakery.levels[0].title, 'Keeps one recipe');
  const bread = kitBlueprint('A cozy bakery where I try out new bread recipes');
  assert.deepEqual(bread.levels.map((item) => item.title).slice(0, 2), ['Keeps one recipe', 'Scales a recipe']);
  assert.ok(!bread.levels.some((item) => /dinner|shopping/i.test(item.title)), 'a bread bakery bakes');
  const kitchen = kitBlueprint('somewhere to plan my dinners and the shopping');
  assert.equal(kitchen.name, 'Kitchen');
  assert.equal(kitchen.levels[0].title, 'Plans a week of dinners');
  assert.deepEqual(kitchen.emblem, EMBLEMS.pot);
  // A named building type gets that shape, and a loose keyword match doesn't borrow another job's line.
  const shed = kitBlueprint('a fail-safe backup shed');
  assert.equal(shed.style.shape, 'barn');
  assert.notEqual(shed.tagline, THEMES.mill.tagline);
  assert.equal(kitBlueprint('Clock tower').style.shape, 'tower');
  assert.equal(kitBlueprint('Guitar practice log').tagline, THEMES.cottage.tagline);
  assert.equal(B.shapeFromName('Backup shed'), 'barn');
  assert.equal(B.shapeFromName('Pebble tracker'), null);

  // A loose keyword match borrows the look, not someone else's features.
  const guitar = kitBlueprint('Guitar practice log');
  assert.equal(guitar.levels[0].title, 'Answers one request');
  assert.equal(guitar.purpose, 'A home for this idea, built up with the crew one level at a time.');

  const requests = kitBlueprint('somewhere to keep my drawing requests from chat');
  assert.equal(requests.name, 'Request board');
  for (const [key, levels] of Object.entries(THEME_LEVELS)) {
    assert.equal(levels.length, 5, key);
    levels.forEach((item, index) => {
      assert.equal(item.level, index + 1, key);
      assert.ok(item.title.length <= B.LIMITS.levelTitle && item.summary.length <= B.LIMITS.levelSummary && item.proof.length <= B.LIMITS.levelProof, `${key} ${item.title}`);
      assertCalm(`${item.title} ${item.summary} ${item.proof}`);
    });
  }
});

test('local answers to a question speak to Chris, not in his words', () => {
  const signals = { skills: [{ name: 'video-expert', description: 'Learn a field from videos.' }], projects: ['Habitack'], built: [] };
  const plot = { id: 'plot-rise', name: 'Sunny rise', w: 7, h: 5 };
  const shown = localSuggestions(plot, signals);
  const asked = localSuggestions(plot, signals, { question: 'something for my drawing streams', exclude: shown });
  assert.equal(asked.length, 3);
  assert.ok(asked.some((item) => item.title === 'Request board'), asked.map((item) => item.title).join(', '));
  for (const item of asked) assert.ok(!/\bmy\b/i.test(item.why), item.why);
});

// ---------------------------------------------------------------------------------------------
// Review fixes: what each crew CLI adds on its own, stopping whole process trees, stale sign-ins

test("Claude Code runs with Chris's CLAUDE.md files and auto memory switched off, nested or not", async (t) => {
  assert.deepEqual(claudeEnv({ Path: 'x' }), { Path: 'x', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  for (const nested of [false, true]) {
    const ctx = await makeHome(t);
    const env = nested ? { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' } : {};
    const architect = makeArchitect(ctx, { mode: 'claude', env });
    assert.equal((await architect.status()).designer, 'claude');
    assert.equal((await architect.design({ plot: RISE, idea: CLIP_IDEA })).by, 'claude');
    const runs = readLog(ctx.log).filter((item) => item.crew === 'claude');
    assert.ok(runs.some((item) => item.argv[0] === '-p') && runs.some((item) => item.argv[0] === 'auth'));
    for (const run of runs) {
      assert.deepEqual(run.switches, { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, `${run.argv[0]} nested=${nested}`);
      assert.equal(run.nested, false);
    }
  }
  // Codex doesn't get Claude's switches (it has its own -c settings).
  const ctx = await makeHome(t);
  await makeArchitect(ctx, { mode: 'codex' }).design({ plot: RISE, idea: CLIP_IDEA });
  assert.ok(readLog(ctx.log).every((item) => Object.keys(item.switches).length === 0));
});

test('Codex sign-in trouble is read from its own error lines, never from the brief it echoes', async (t) => {
  const brief = 'Design one building.\nBuildings already in the village: Refresh token desk, Unauthorized access log.\nReply.';
  const echoed = `OpenAI Codex\n--------\nuser\n${brief}\nERROR: stream disconnected before completion\n`;
  assert.equal(codexOwnLines(echoed, brief), 'ERROR: stream disconnected before completion');
  assert.equal(interpretCodex({ code: 1, stdout: '', stderr: echoed, error: null }, null, brief).code, 'failed');
  // Even without the brief to strip, a line of Chris's words never starts like one of Codex's own.
  assert.equal(interpretCodex({ code: 1, stdout: '', stderr: echoed, error: null }, null).code, 'failed');
  const signedOut = `user\n${brief}\n2026-09-27T01:24:29.648828Z ERROR codex_api: 401 Unauthorized\nERROR: Reconnecting... 1/5\nERROR: unexpected status 401 Unauthorized: Missing bearer\n`;
  assert.equal(interpretCodex({ code: 1, stdout: '', stderr: signedOut.replace(/\n/g, '\r\n'), error: null }, null, brief).code, 'auth');

  // End to end: a building name that looks like a sign-in error doesn't sign Codex out.
  const ctx = await makeHome(t);
  const architect = makeArchitect(ctx, { mode: 'codex', codex: 'echo-fail' });
  const first = await architect.design({ plot: RISE, idea: CLIP_IDEA, built: ['Refresh token desk', 'Unauthorized access log'] });
  assert.equal(first.by, 'kit');
  assert.deepEqual(first.fallback, { by: 'codex', code: 'failed' });
  assert.equal(first.note, "Codex didn't answer, so Milo drew this one himself.");
  assert.equal((await architect.status()).designer, 'codex', 'still asked next time');
  const real = await makeArchitect(ctx, { mode: 'codex', codex: 'echo-auth' }).design({ plot: RISE, idea: CLIP_IDEA });
  assert.deepEqual(real.fallback, { by: 'codex', code: 'auth' });
});

test('stopping a crew call stops everything it started, and its temp folder goes', { skip: process.platform !== 'win32' || /\s/.test(process.execPath + GRANDCHILD) }, async (t) => {
  // cmd.exe is a crew root that isn't Node, and the grandchild keeps cmd's output pipe open, like a
  // shell command a crew CLI is running when Chris presses Cancel or the time limit runs out.
  const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  for (const how of ['cancel', 'timeout']) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    const treeLog = path.join(dir, '..', `${path.basename(dir)}-tree.log`);
    t.after(() => fsp.rm(treeLog, { force: true }));
    const run = runProcess({
      command: cmd, args: ['/d', '/c', process.execPath, GRANDCHILD], cwd: dir,
      env: { ...process.env, MILO_TREE_LOG: treeLog }, timeoutMs: how === 'timeout' ? 1500 : 60 * 1000,
    });
    const grand = Number(await waitFor(() => { try { return fs.readFileSync(treeLog, 'utf8').trim(); } catch { return ''; } }));
    assert.ok(grand > 0, 'the grandchild started');
    t.after(() => { try { process.kill(grand); } catch { /* gone */ } });
    const stoppedAt = Date.now();
    if (how === 'cancel') run.kill('cancelled');
    const result = await run.promise;
    const settledIn = Date.now() - stoppedAt;
    assert.equal(result.error, how === 'cancel' ? 'cancelled' : 'timeout');
    assert.ok(await waitFor(() => !isAlive(grand), 3000), `${how}: the grandchild was stopped too`);
    if (how === 'cancel') assert.ok(settledIn < KILL_GRACE_MS, `${how}: settled in ${settledIn} ms, before the grace period`);
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    assert.ok(!fs.existsSync(dir), `${how}: the temp folder can be removed`);
  }
});

test("left-behind crew folders are swept, and only MILO's", async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'milo-sweep-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));
  const old = path.join(tmp, `${TEMP_PREFIX}old111`);
  const fresh = path.join(tmp, `${TEMP_PREFIX}new222`);
  const other = path.join(tmp, 'someone-else-old');
  for (const dir of [old, fresh, other]) await write(path.join(dir, 'schema.json'), '{}');
  const long = new Date(Date.now() - 60 * 60 * 1000);
  for (const dir of [old, other]) await fsp.utimes(dir, long, long);
  assert.equal(await sweepCrewTempDirs({ olderThanMs: 10 * 60 * 1000, tmp }), 1);
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other));
});

test('signing in while MILO is open counts: a stale "not signed in" is checked again', async (t) => {
  let clock = 1_000_000;
  const setup = async () => {
    const ctx = await makeHome(t);
    const env = {
      ...process.env, CODEX_HOME: path.join(ctx.home, '.codex'), MILO_CLAUDE_BIN: FAKE_CLAUDE, MILO_CODEX_BIN: FAKE_CODEX,
      MILO_FAKE_CLAUDE: 'auth', MILO_FAKE_CODEX: 'ok', MILO_FAKE_CREW_LOG: ctx.log,
    };
    const architect = createArchitect({
      env, home: ctx.home, claudeHome: ctx.claudeHome, projectsDir: ctx.projectsDir, spawnImpl: recordingSpawn([]), now: () => clock,
    });
    return { env, architect };
  };
  const first = await setup();
  const before = await first.architect.status();
  assert.equal(before.designer, 'codex');
  assert.equal(before.crew[0].detail, DETAILS.claudeSignIn);
  first.env.MILO_FAKE_CLAUDE = 'ok';   // Chris runs claude in a terminal and signs in
  assert.equal((await first.architect.status()).designer, 'codex', 'the last answer holds for a little while');
  assert.equal((await first.architect.status({ refresh: true })).designer, 'claude', 'refresh asks again at once');
  first.env.MILO_FAKE_CLAUDE = 'auth';
  clock += PROBE_TTL_MS + 1;
  assert.equal((await first.architect.status()).crew[0].detail, DETAILS.ready, 'signed in holds until a call says otherwise');

  const second = await setup();
  assert.equal((await second.architect.status()).designer, 'codex');
  second.env.MILO_FAKE_CLAUDE = 'ok';
  clock += PROBE_TTL_MS + 1;
  assert.equal((await second.architect.design({ plot: RISE, idea: CLIP_IDEA })).by, 'claude', 'after a minute, a design asks Claude Code again');
  // A real call that fails to sign in still counts for the whole launch.
  second.env.MILO_FAKE_CLAUDE = 'auth-call';
  assert.equal((await second.architect.design({ plot: RISE, idea: CLIP_IDEA })).by, 'codex');
  second.env.MILO_FAKE_CLAUDE = 'ok';
  clock += 10 * PROBE_TTL_MS;
  assert.equal((await second.architect.status({ refresh: true })).designer, 'codex');
});

test("a Codex AGENTS.md keeps Codex out (MILO only checks that it's there)", async (t) => {
  const ctx = await makeHome(t);
  const codexHome = path.join(ctx.home, '.codex');
  assert.equal(codexAgentsFile({ env: { CODEX_HOME: codexHome } }), null);
  await write(path.join(codexHome, 'AGENTS.md'), 'made-up instructions\n');
  assert.equal(codexAgentsFile({ env: { CODEX_HOME: codexHome } }), 'AGENTS.md');
  assert.equal(codexAgentsFile({ env: {}, home: ctx.home }), 'AGENTS.md');
  const auto = makeArchitect(ctx, { claude: 'auth' });
  const status = await auto.status();
  assert.equal(status.designer, 'kit');
  assert.deepEqual(status.crew[1], { id: 'codex', found: true, ready: false, detail: DETAILS.codexAgents });
  const built = await auto.design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(built.by, 'kit');
  const chosen = await makeArchitect(ctx, { mode: 'codex' }).design({ plot: RISE, idea: CLIP_IDEA });
  assert.equal(chosen.by, 'kit');
  assert.deepEqual(chosen.fallback, { by: 'codex', code: 'agents' });
  assert.match(chosen.note, /AGENTS\.md/);
  assert.ok(!readLog(ctx.log).some((item) => item.crew === 'codex' && item.argv[0] === 'exec'), 'Codex never got a brief');
});

test('the UI hears who has the brief, and why Milo drew it himself', async (t) => {
  const ctx = await makeHome(t);
  const asked = [];
  const moved = await makeArchitect(ctx, { claude: 'auth-call' }).design({ plot: RISE, idea: CLIP_IDEA, onAsk: (id) => asked.push(id) });
  assert.deepEqual(asked, ['claude', 'codex']);
  assert.equal(moved.by, 'codex');
  assert.deepEqual(moved.skipped, ['claude']);
  assert.equal(moved.fallback, null);
  const heard = [];
  const ideas = await makeArchitect(ctx, { claude: 'auth-call' }).suggest({ plot: RISE, onAsk: (id) => heard.push(id) });
  assert.deepEqual(heard, ['claude', 'codex']);
  assert.deepEqual(ideas.skipped, ['claude']);
  // Nobody signed in: the note says so, rather than "couldn't reach the crew".
  const none = await makeArchitect(ctx, { claude: 'auth', codex: 'auth' }).design({ plot: RISE, idea: CLIP_IDEA, onAsk: () => assert.fail('nobody is asked') });
  assert.deepEqual(none.fallback, { by: null, code: 'auth' });
  assert.equal(none.note, "The crew isn't signed in, so Milo drew this one himself.");
  assert.equal(reasonPhrase({ by: 'codex', code: 'invalid' }), "Codex's answer was hard to read");
  assert.equal(reasonPhrase({ by: 'claude', code: 'timeout' }), "Claude Code didn't answer");
  const fake = createArchitect({ mode: 'fake', fakeDelayMs: 5, env: {}, home: os.tmpdir(), claudeHome: path.join(os.tmpdir(), 'milo-none'), projectsDir: path.join(os.tmpdir(), 'milo-none') });
  const fakeAsked = [];
  await fake.design({ plot: RISE, idea: CLIP_IDEA, onAsk: (id) => fakeAsked.push(id) });
  assert.deepEqual(fakeAsked, ['codex']);
});

test("a redesign the crew can't finish keeps the building that's there", async (t) => {
  const ctx = await makeHome(t);
  const previous = (await makeArchitect(ctx, { mode: 'codex' }).design({ plot: RISE, idea: CLIP_IDEA })).blueprint;
  for (const [codex, message] of [
    ['crash', "Codex didn't answer, so the building stays as it was."],
    ['garbage', "Codex's answer was hard to read, so the building stays as it was."],
    ['auth-call', "Codex isn't signed in, so the building stays as it was."],
  ]) {
    await assert.rejects(
      makeArchitect(ctx, { mode: 'codex', codex }).design({ plot: RISE, idea: CLIP_IDEA, tweak: 'make it cozier', previous }),
      (error) => error.code === 'crew-failed' && error.message === message && error.fallback.by === 'codex',
      codex,
    );
  }
  // When Milo was always going to draw it (his kit, or no crew to ask), a redesign is his.
  assert.equal((await makeArchitect(ctx, { mode: 'kit' }).design({ plot: RISE, idea: CLIP_IDEA, previous })).by, 'kit');
  const signedOut = await makeArchitect(ctx, { mode: 'codex', codex: 'auth', claude: 'auth' });
  await assert.rejects(signedOut.design({ plot: RISE, idea: CLIP_IDEA, previous }), { code: 'crew-failed' });
  assert.equal((await signedOut.design({ plot: RISE, idea: CLIP_IDEA, previous })).by, 'kit', 'once Codex is known to be signed out, Milo draws it');
  const fake = createArchitect({ mode: 'fake', fakeDelayMs: 5, env: {}, home: os.tmpdir(), claudeHome: path.join(os.tmpdir(), 'milo-none'), projectsDir: path.join(os.tmpdir(), 'milo-none') });
  await assert.rejects(fake.design({ plot: RISE, idea: CLIP_IDEA, tweak: 'this will fail', previous }), { code: 'crew-failed' });
});
