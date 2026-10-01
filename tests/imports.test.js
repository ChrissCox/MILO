// No game path reaches the crew or the cloud (CONTRACT-PHASE4.md §2 "Privacy" and "Imports",
// §13 wave 0): every source file Phase 4 creates (§14's table), and everything it imports in turn,
// statically or with import(), stays out of src/architect/** and src/watch/**, and none of it
// imports src/model.js, src/hearth.js or src/rifts.js (model.js loads the architect at top
// level). A listed file that isn't written yet is skipped.
//   node --test tests/imports.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every src file Phase 4 creates, by module (§14). src/combat/** and src/world/party/** are also swept whole. */
export const PHASE4_FILES = [
  // wave 0
  'src/content4.js',
  // A, groundwork
  'src/clean.js', 'src/state4.js', 'src/embers.js', 'src/chronicle.js', 'src/kindle.js', 'src/lifeskills.js', 'src/commands.js', 'src/sky.js',
  // B, the combat kernel
  'src/combat/heat.js', 'src/combat/rules.js', 'src/combat/grid.js', 'src/combat/effects.js', 'src/combat/abilities.js',
  'src/combat/battle.js', 'src/combat/round.js', 'src/combat/driver.js', 'src/combat/describe.js',
  // C, party and camp
  'src/party.js', 'src/camp.js',
  // D, encounters
  'src/world/arena.js', 'src/world/leadname.js', 'src/combat/bestiary.js', 'src/combat/encounters.js',
  // E, world additions
  'src/world/caves.js', 'src/world/fieldboss.js', 'src/world/trail.js',
  // F, art
  'src/world/sprites-party.js', 'src/world/party/coat.js', 'src/world/party/robe.js', 'src/world/party/jev.js', 'src/world/party/toll.js',
  'src/world/icons.js', 'src/world/fx.js', 'src/world/props4.js',
  // H, the minds; I, leads
  'src/combat/notebook.js', 'src/combat/ai.js', 'src/combat/strays.js', 'src/combat/leads.js',
  // J, the engine
  'src/world/scene-combat.js', 'src/world/anim.js', 'src/world/follow.js', 'src/world/scene-camp.js', 'src/world/scene-sky.js',
  // K1, groundwork UI
  'src/ui/log.js', 'src/ui/menus.js', 'src/ui/examine.js', 'src/ui/wallet.js', 'src/ui/chronicle-view.js', 'src/ui/kindle-view.js',
  'src/ui/hud.js', 'src/ui/skills-view.js', 'src/ui/trail-view.js', 'src/ui/satchel-view.js',
  // K2, company UI
  'src/ui/combat-hud.js', 'src/ui/planner.js', 'src/ui/combatants.js', 'src/ui/muster.js', 'src/ui/camp-view.js', 'src/ui/company-view.js',
  'src/ui/dialogue.js', 'src/ui/notebook-view.js', 'src/ui/levelup.js',
  // L1, the fight in the shell
  'src/ui/fight.js', 'src/ui/expedition.js',
];
const SWEPT = ['src/combat', 'src/world/party'];
const BARRED_DIRS = ['src/architect/', 'src/watch/'];
const BARRED_FILES = ['src/model.js', 'src/hearth.js', 'src/rifts.js'];

/**
 * The imports in a module's source: { specifiers, dynamic } where specifiers are the string
 * specifiers of `import … from`, `import '…'`, `export … from` and `import('…')`, and dynamic
 * lists any import(…) whose specifier isn't a plain string (which the walk can't follow).
 */
export function importsOf(source) {
  const specifiers = [];
  const dynamic = [];
  const add = (s) => { if (!specifiers.includes(s)) specifiers.push(s); };
  for (const m of source.matchAll(/^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"]+)\1/gm)) add(m[2]);
  for (const m of source.matchAll(/^[ \t]*import\s*(['"])([^'"]+)\1/gm)) add(m[2]);
  for (const m of source.matchAll(/\bimport\s*\(\s*(['"`])([^'"`$]+)\1\s*[,)]/g)) add(m[2]);
  source.split('\n').forEach((line, n) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // prose in comments
    for (const m of line.matchAll(/\bimport\s*\(\s*([^)]*)/g)) {
      if (!/^(['"`])[^'"`$]+\1\s*$/.test(m[1].split(',')[0].trim())) dynamic.push(`line ${n + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
  return { specifiers, dynamic };
}

const rel = (file) => path.relative(REPO, file).split(path.sep).join('/');
const readSource = (file) => readFileSync(file, 'utf8');

/**
 * Walks a file's imports, and theirs, through relative specifiers to files that exist.
 * → { reached: Map<relative path, chain[]>, problems: string[] }
 */
export function walk(start, { read = readSource, exists = existsSync } = {}) {
  const reached = new Map([[rel(start), [rel(start)]]]);
  const queue = [start];
  const problems = [];
  while (queue.length) {
    const file = queue.shift();
    const chain = reached.get(rel(file));
    const { specifiers, dynamic } = importsOf(read(file));
    for (const d of dynamic) problems.push(`${chain.join(' → ')} has an import() the test can’t follow (${d})`);
    for (const spec of specifiers) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // not a file in the repo
      const target = path.resolve(path.dirname(file), spec);
      const name = rel(target);
      const next = [...chain, name];
      if (BARRED_DIRS.some((dir) => name.startsWith(dir))) problems.push(`${next.join(' → ')} reaches ${name.split('/').slice(0, 2).join('/')}/`);
      if (BARRED_FILES.includes(name)) problems.push(`${next.join(' → ')} imports ${name}`);
      if (reached.has(name) || !exists(target) || !/\.m?js$/.test(target)) continue;
      reached.set(name, next);
      queue.push(target);
    }
  }
  return { reached, problems };
}

function sweep(dir) {
  const full = path.join(REPO, dir);
  if (!existsSync(full)) return [];
  const out = [];
  for (const name of readdirSync(full)) {
    const child = path.join(full, name);
    if (statSync(child).isDirectory()) out.push(...sweep(rel(child)));
    else if (/\.m?js$/.test(name)) out.push(rel(child));
  }
  return out;
}

test('the walk finds static, re-exported and dynamic imports, and flags an import() it can’t follow', () => {
  const source = [
    "import { a } from './a.js';",
    'import {',
    '  b,',
    "  c } from '../b.js';",
    "import './side.js';",
    "export { d } from './d.js';",
    "export * from './e.js';",
    "const f = await import('./f.js');",
    'const g = import(`./g.js`);',
    '// a note: import(name) in prose is fine',
    'const h = await import(`./${name}.js`);',
    'const i = import.meta.url;',
  ].join('\n');
  const { specifiers, dynamic } = importsOf(source);
  assert.deepEqual(specifiers, ['./a.js', '../b.js', './d.js', './e.js', './side.js', './f.js', './g.js']);
  assert.equal(dynamic.length, 1);
  assert.match(dynamic[0], /^line 11:/);
});

test('the walk follows imports through other files and catches the crew, the cloud and model.js', () => {
  const files = {
    [path.join(REPO, 'src/combat/x.js')]: "import { y } from '../world/y.js';",
    [path.join(REPO, 'src/world/y.js')]: "export const y = () => import('../ui/z.js');",
    [path.join(REPO, 'src/ui/z.js')]: "import '../rifts.js';\nimport { watch } from '../watch/claude.js';",
    [path.join(REPO, 'src/rifts.js')]: "import { m } from './model.js';",
    [path.join(REPO, 'src/model.js')]: "import './architect/blueprint.js';",
  };
  const fake = { read: (file) => files[file] ?? '', exists: (file) => file in files };
  const { reached, problems } = walk(path.join(REPO, 'src/combat/x.js'), fake);
  assert.deepEqual([...reached.keys()], ['src/combat/x.js', 'src/world/y.js', 'src/ui/z.js', 'src/rifts.js', 'src/model.js']);
  assert.ok(problems.some((p) => p.endsWith('imports src/rifts.js') && p.startsWith('src/combat/x.js → src/world/y.js → src/ui/z.js')), problems.join('\n'));
  assert.ok(problems.some((p) => p.endsWith('reaches src/watch/')), problems.join('\n'));
  assert.ok(problems.some((p) => p.endsWith('imports src/model.js')), problems.join('\n'));
  assert.ok(problems.some((p) => p.endsWith('reaches src/architect/')), problems.join('\n'));
  const clean = walk(path.join(REPO, 'src/world/y.js'), { read: () => "import { a } from './rng.js';", exists: () => true });
  assert.deepEqual(clean.problems, []);
});

test('no file Phase 4 creates imports the crew, the cloud, model.js, hearth.js or rifts.js, even at one remove', () => {
  const listed = PHASE4_FILES.filter((file) => existsSync(path.join(REPO, file)));
  const swept = SWEPT.flatMap(sweep).filter((file) => !PHASE4_FILES.includes(file));
  const files = [...listed, ...swept];
  assert.ok(files.includes('src/content4.js'), 'wave 0’s own file is checked');
  const problems = files.flatMap((file) => walk(path.join(REPO, file)).problems);
  assert.deepEqual(problems, [], `${files.length} files checked:\n${problems.join('\n')}`);
});

test('the list covers Phase 4’s source files and nothing Phase 3 made', () => {
  assert.equal(new Set(PHASE4_FILES).size, PHASE4_FILES.length, 'no file listed twice');
  const phase3 = ['src/app.js', 'src/model.js', 'src/hearth.js', 'src/rifts.js', 'src/story.js', 'src/recap.js', 'src/skills.js',
    'src/ui/frontier.js', 'src/ui/panels.js', 'src/ui/wildtext.js', 'src/ui/panelart.js', 'src/ui/mapview.js',
    'src/world/engine.js', 'src/world/riftfx.js', 'src/world/riftgen.js', 'src/world/elsewhere.js', 'src/world/straygen.js', 'src/world/scene-art.js'];
  for (const file of phase3) assert.ok(!PHASE4_FILES.includes(file), `${file} is Phase 3’s and keeps its imports`);
  assert.ok(PHASE4_FILES.every((file) => /^src\/.+\.js$/.test(file)));
});
