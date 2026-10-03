// Phase 6: commissions. The rules (one folder, a ward, Chris sends it himself, one at a time), the
// drafts, building levels, and the runner under the fake crew. No real CLI is ever started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createState, normalizeState } from '../src/model.js';
import {
  emptyCommissions, cleanCommissions, folderProblem, levelOf, nextLevel, buildable, draftForBuilding, draftForQuest, draftFree,
  updateDraft, remove, running, sendProblem, send, comeBack, accept, again, view, briefFor,
  CREW, WARDS, WARD_WORDS, WARD_HINTS, STATUSES, LIMITS, MAX_LEVEL, wardWrites,
} from '../src/commissions.js';
import { createRunner, checkFolder, claudeRunArgs, codexRunArgs, readAnswer, changedSince, RUN_LIMIT_MS } from '../src/commission/runner.js';
import { addQuest } from '../src/quests.js';
import { buildCommissions, COPY } from '../src/ui/commissions-view.js';

const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const HOME = 'C:\\Users\\chris';
const OWN = 'C:\\Users\\chris\\Projects\\MILO';
const ENV = { home: HOME, own: OWN };
const FOLDER = 'C:\\Users\\chris\\Projects\\Habitack';
const fresh = () => createState(T0);
const levels = [1, 2, 3, 4, 5].map((level) => ({ level, title: `Level ${level} thing`, summary: `Does thing ${level}.`, proof: `You can see thing ${level}.` }));
const withBuilding = (state, plotId = 'plot-meadow', name = 'The Quest Hall') => ({
  ...state, plots: { ...state.plots, [plotId]: { ...state.plots[plotId], status: 'built', name, blueprint: { name, levels } } },
});
const drafted = (ward = 'look') => {
  const r = draftFree(fresh(), 'Tidy the notes', T0);
  return { id: r.id, state: updateDraft(r.state, r.id, { folder: FOLDER, ward }) };
};

test('a new save has no commissions, and the wards go from least to most', () => {
  assert.deepEqual(fresh().commissions, emptyCommissions());
  assert.deepEqual(emptyCommissions(), { list: [], seq: 0, folders: {}, levels: {}, checks: {}, checked: {} });
  assert.deepEqual([...WARDS], ['look', 'suggest', 'change']);
  assert.deepEqual([...CREW], ['claude', 'codex']);
  assert.deepEqual(WARDS.map(wardWrites), [false, false, true]);
  for (const w of WARDS) assert.ok(WARD_WORDS[w] && WARD_HINTS[w]);
  assert.match(WARD_HINTS.look, /Nothing is changed/);
  assert.match(WARD_HINTS.change, /inside this folder, and nowhere else/);
});

test('a commission’s folder: never the home folder, a whole drive, MILO’s own, or the crew’s own things', () => {
  assert.equal(folderProblem(FOLDER, ENV), '');
  assert.equal(folderProblem('D:/work/site', ENV), '');
  const bad = [
    ['', /Pick a folder/], ['   ', /Pick a folder/], ['Projects\\Habitack', /full path/], ['C:\\', /whole drive/], ['C:', /whole drive|full path/],
    [HOME, /home folder/], ['C:\\Users', /holds your whole home/], ['c:/users/CHRIS/', /home folder/],
    [`${HOME}\\.claude`, /crew keep/], [`${HOME}\\.claude\\projects\\x`, /crew keep/], [`${HOME}\\.codex\\sessions`, /crew keep/],
    [OWN, /MILO’s own/], [`${OWN}\\src`, /MILO’s own/], ['C:\\Users\\chris\\Projects', /MILO’s own/],
    ['C:\\Users\\chris\\Projects\\..\\..', /goes back/], [`C:\\${'x'.repeat(500)}`, /too long/],
  ];
  for (const [folder, why] of bad) assert.match(folderProblem(folder, ENV), why, folder);
  assert.match(folderProblem(null, ENV), /Pick a folder/);
});

test('a draft from a line, from a quest, and for a building’s next level', () => {
  let r = draftFree(fresh(), '  Tidy   the notes ', T0);
  assert.equal(r.id, 'c1');
  let c = r.state.commissions.list[0];
  assert.deepEqual([c.title, c.status, c.who, c.ward, c.folder, c.source], ['Tidy the notes', 'draft', 'claude', 'look', '', { kind: 'free' }]);
  assert.equal(draftFree(fresh(), '   ', T0).id, null);

  const board = addQuest(fresh(), 'Fix the login page', T0).state;
  const quest = board.board.quests[0];
  r = draftForQuest(board, quest.id, T0);
  c = r.state.commissions.list[0];
  assert.equal(c.title, 'Fix the login page');
  assert.deepEqual(c.source, { kind: 'quest', questId: quest.id });
  assert.equal(draftForQuest(board, 'q-nope', T0).id, null);

  const built = withBuilding(fresh());
  assert.deepEqual(buildable(built), [{ plotId: 'plot-meadow', name: 'The Quest Hall', level: 1, title: 'Level 1 thing' }]);
  r = draftForBuilding(built, 'plot-meadow', T0);
  c = r.state.commissions.list[0];
  assert.equal(c.title, 'The Quest Hall, level 1: Level 1 thing');
  assert.match(c.brief, /Build level 1 of The Quest Hall: Level 1 thing\.\nDoes thing 1\.\nIt is done when: You can see thing 1\./);
  assert.deepEqual(c.source, { kind: 'building', plotId: 'plot-meadow', level: 1 });
  assert.equal(draftForBuilding(fresh(), 'plot-meadow', T0).id, null, 'an empty plot has nothing to build');
  assert.deepEqual(buildable(fresh()), []);
});

test('a draft can be changed until it is sent, and a building remembers its folder', () => {
  const built = withBuilding(fresh());
  let { state, id } = draftForBuilding(built, 'plot-meadow', T0);
  state = updateDraft(state, id, { who: 'codex', ward: 'change', folder: FOLDER, brief: 'Do it carefully.' });
  const c = state.commissions.list[0];
  assert.deepEqual([c.who, c.ward, c.folder, c.brief], ['codex', 'change', FOLDER, 'Do it carefully.']);
  assert.deepEqual(state.commissions.folders, { 'plot-meadow': FOLDER });
  const second = draftForBuilding(state, 'plot-meadow', T0);
  assert.equal(second.state.commissions.list[1].folder, FOLDER, 'the next one starts in the same folder');
  assert.equal(updateDraft(state, id, { who: 'gemini', ward: 'anything' }), state, 'unknown crew and wards change nothing');
  assert.equal(updateDraft(state, 'c99', { brief: 'x' }), state);
  assert.equal(remove(state, id).commissions.list.length, 0);
});

test('sending: a brief, a folder that passes, and one at a time', () => {
  let { state, id } = draftFree(fresh(), 'Tidy the notes', T0);
  assert.match(sendProblem(state, id, ENV), /Pick a folder/);
  state = updateDraft(state, id, { folder: HOME });
  assert.match(sendProblem(state, id, ENV), /home folder/);
  assert.equal(send(state, id, T0, ENV).ok, false);
  state = updateDraft(state, id, { folder: FOLDER, brief: '   ' });
  assert.match(sendProblem(state, id, ENV), /Say what you want done/);
  state = updateDraft(state, id, { brief: 'Tidy them.' });
  assert.equal(sendProblem(state, id, ENV), '');
  const sent = send(state, id, T0, ENV);
  assert.equal(sent.ok, true);
  assert.deepEqual([running(sent.state).id, sent.state.commissions.list[0].sentAt], [id, T0]);
  // a second can't go while the first is out
  const two = draftFree(sent.state, 'Another', T0);
  const ready = updateDraft(two.state, two.id, { folder: FOLDER });
  assert.match(sendProblem(ready, two.id, ENV), /One at a time/);
  assert.equal(send(ready, two.id, T0, ENV).ok, false);
  assert.equal(send(sent.state, id, T0, ENV).ok, false, 'it has already been sent');
  assert.equal(remove(sent.state, id), sent.state, 'whoever is out can’t be removed');
  assert.equal(updateDraft(sent.state, id, { brief: 'changed' }), sent.state, 'nor rewritten');
});

test('coming back: a finished run waits to be read; one that failed or was called back says why', () => {
  const { state: s0, id } = drafted();
  const out = send(s0, id, T0, ENV).state;
  const back = comeBack(out, id, { ok: true, summary: 'Read 4 files.', files: ['a.md', 'b.md'], ms: 900 }, T0 + 900);
  let c = back.commissions.list[0];
  assert.deepEqual([c.status, c.endedAt, c.result.summary, c.result.files], ['review', T0 + 900, 'Read 4 files.', ['a.md', 'b.md']]);
  assert.equal(running(back), null);
  c = comeBack(out, id, { ok: false, why: 'They need signing in again.' }, T0 + 5).commissions.list[0];
  assert.deepEqual([c.status, c.result.why], ['failed', 'They need signing in again.']);
  c = comeBack(out, id, { ok: false, stopped: true, why: 'You called them back.' }, T0 + 5).commissions.list[0];
  assert.equal(c.status, 'stopped');
  assert.equal(comeBack(back, id, { ok: true, summary: 'again' }, T0), back, 'only someone who is out can come back');
  // what comes back is kept short and plain
  const huge = comeBack(out, id, { ok: true, summary: 'x'.repeat(9000), files: Array.from({ length: 200 }, (_, i) => `f${i}.js`) }, T0).commissions.list[0];
  assert.deepEqual([huge.result.summary.length <= LIMITS.summary, huge.result.files.length], [true, LIMITS.files]);
});

test('reading it: Done files it away; again makes a fresh draft', () => {
  const { state: s0, id } = drafted();
  const back = comeBack(send(s0, id, T0, ENV).state, id, { ok: true, summary: 'Fine.' }, T0 + 1);
  const read = accept(back, id, T0 + 2);
  assert.deepEqual([read.ok, read.levelled, read.state.commissions.list[0].status], [true, null, 'done']);
  assert.equal(accept(read.state, id, T0 + 3).ok, false);
  const more = again(read.state, id, T0 + 4);
  assert.equal(more.id, 'c2');
  const c = more.state.commissions.list[1];
  assert.deepEqual([c.status, c.title, c.folder, c.ward, c.result], ['draft', 'Tidy the notes', FOLDER, 'look', null]);
  assert.equal(again(s0, id, T0).id, null, 'a draft has nothing to repeat');
});

test('a building goes up a level only when files could change and Chris has seen it work', () => {
  const built = withBuilding(fresh());
  assert.equal(levelOf(built, 'plot-meadow'), 0);
  const prove = (ward, proved) => {
    let { state, id } = draftForBuilding(built, 'plot-meadow', T0);
    state = updateDraft(state, id, { folder: FOLDER, ward });
    state = comeBack(send(state, id, T0, ENV).state, id, { ok: true, summary: 'Built.' }, T0 + 1);
    return { before: view(state, ENV).rows[0].canProve, ...accept(state, id, T0 + 2, { proved }) };
  };
  let r = prove('look', true);
  assert.deepEqual([r.before, r.levelled, levelOf(r.state, 'plot-meadow')], [false, null, 0], 'a look builds nothing');
  r = prove('change', false);
  assert.deepEqual([r.before, r.levelled, levelOf(r.state, 'plot-meadow')], [true, null, 0], 'not yet seen working');
  r = prove('change', true);
  assert.deepEqual([r.levelled, levelOf(r.state, 'plot-meadow'), r.state.commissions.list[0].proved], [{ plotId: 'plot-meadow', level: 1 }, 1, true]);
  assert.equal(nextLevel(r.state, 'plot-meadow').level, 2);
  // level five is the last
  const top = { ...built, commissions: { ...emptyCommissions(), levels: { 'plot-meadow': MAX_LEVEL } } };
  assert.equal(nextLevel(top, 'plot-meadow'), null);
  assert.deepEqual(buildable(top), []);
});

test('the saved section repairs itself, and whoever was out when MILO closed was called back', () => {
  for (const junk of [null, 4, 'x', [], { list: 'no' }, { list: [null, 5, { id: 'BAD' }, { id: 'c1' }] }]) assert.deepEqual(cleanCommissions(junk, { now: T0 }).list, []);
  const { state: s0, id } = drafted('change');
  const out = send(s0, id, T0, ENV).state;
  const back = normalizeState(JSON.parse(JSON.stringify(out)), T0 + 1000);
  assert.equal(back.commissions.list[0].status, 'stopped');
  assert.equal(running(back), null);
  const odd = cleanCommissions({
    seq: 2, list: [{ id: 'c7', title: 'T', who: 'x', ward: 'y', status: 'z', source: { kind: 'building', plotId: 'BAD' }, result: { files: [1, 'a.js'] } }, { id: 'c7', title: 'twice' }],
    folders: { 'plot-meadow': FOLDER, nope: 'C:\\x' }, levels: { 'plot-meadow': 99, 'plot-rise': 0, bad: 2 },
  }, { now: T0 });
  assert.deepEqual([odd.list.length, odd.list[0].who, odd.list[0].ward, odd.list[0].status, odd.list[0].source, odd.list[0].result.files], [1, 'claude', 'look', 'draft', { kind: 'free' }, ['a.js']]);
  assert.equal(odd.seq, 7, 'an id is never reused');
  assert.deepEqual([odd.folders, odd.levels], [{ 'plot-meadow': FOLDER }, { 'plot-meadow': MAX_LEVEL }]);
  assert.ok(STATUSES.includes('review'));
});

test('the brief as it is handed over says what the ward allows, in plain words', () => {
  const brief = (ward) => briefFor({ brief: 'Tidy the notes.', ward });
  assert.match(brief('look'), /^Tidy the notes\.\n\nRead what you need in this folder\. Do not change, create or delete any file\./);
  assert.match(brief('suggest'), /Write up the changes you would make/);
  assert.match(brief('change'), /inside this folder only\. Do not touch anything outside it\. Do not delete files you did not create\. Do not commit, push, install/);
  assert.match(brief('nonsense'), /Do not change, create or delete any file/, 'an unknown ward is the strictest one');
});

// ---- the runner ----

test('what a ward allows is set by the CLI’s own switches', () => {
  const tools = (ward) => { const a = claudeRunArgs(ward); return a[a.indexOf('--tools') + 1]; };
  assert.equal(tools('look'), 'Read,Glob,Grep');
  assert.equal(tools('suggest'), 'Read,Glob,Grep');
  assert.equal(tools('change'), 'Read,Glob,Grep,Edit,Write');
  for (const ward of WARDS) {
    const a = claudeRunArgs(ward);
    assert.ok(!a.join(' ').includes('Bash'), 'Claude is never handed a shell');
    assert.ok(!a.some((x) => /dangerously|bypassPermissions/.test(x)), 'and nothing is bypassed');
    assert.equal(a.includes('--permission-mode'), ward === 'change', 'only the change ward accepts edits');
    assert.ok(a.includes('-p') && a.includes('--no-session-persistence'));
  }
  const sandbox = (ward) => { const a = codexRunArgs(ward, FOLDER, 'out.txt'); return a[a.indexOf('--sandbox') + 1]; };
  assert.deepEqual(WARDS.map(sandbox), ['read-only', 'read-only', 'workspace-write']);
  for (const ward of WARDS) {
    const a = codexRunArgs(ward, FOLDER, 'out.txt');
    assert.ok(!a.some((x) => /dangerously|danger-full-access|approve-for-me/.test(x)));
    assert.equal(a[a.indexOf('-C') + 1], FOLDER, 'rooted at the folder');
    assert.ok(a.includes('--ephemeral') && a.at(-1) === '-');
  }
  assert.equal(RUN_LIMIT_MS, 20 * 60 * 1000);
});

test('an answer is a summary and the files it lists at the end', () => {
  assert.deepEqual(readAnswer('I read the notes.\nThey are tidy.\n\n- notes/a.md\n- notes/b.md\n'), { summary: 'I read the notes.\nThey are tidy.', files: ['notes/a.md', 'notes/b.md'] });
  assert.deepEqual(readAnswer('Nothing to list.'), { summary: 'Nothing to list.', files: [] });
  assert.deepEqual(readAnswer(''), { summary: '', files: [] });
  assert.deepEqual(readAnswer('Done.\n- not a path at all'), { summary: 'Done.\n- not a path at all', files: [] });
});

const tmp = mkdtempSync(path.join(os.tmpdir(), 'milo-commission-test-'));
const project = path.join(tmp, 'project');
mkdirSync(path.join(project, 'src'), { recursive: true });
mkdirSync(path.join(project, 'node_modules', 'x'), { recursive: true });
writeFileSync(path.join(project, 'README.md'), 'hello\n');
writeFileSync(path.join(project, 'src', 'main.js'), 'x\n');
writeFileSync(path.join(project, 'node_modules', 'x', 'index.js'), 'x\n');
// The project was there before any commission: its files are an hour old.
const hourAgo = new Date(Date.now() - 3600_000);
for (const f of ['README.md', path.join('src', 'main.js')]) utimesSync(path.join(project, f), hourAgo, hourAgo);
test.after(() => rmSync(tmp, { recursive: true, force: true }));
// The test's own "home" and "MILO" are folders that don't hold the project.
const fakeEnv = { home: path.join(tmp, 'home'), own: path.join(tmp, 'milo') };

test('the folder is checked on the real disk', async () => {
  assert.deepEqual(await checkFolder(project, fakeEnv), { ok: true, folder: project });
  assert.match((await checkFolder(path.join(tmp, 'nowhere'), fakeEnv)).why, /isn’t there/);
  assert.match((await checkFolder(path.join(project, 'README.md'), fakeEnv)).why, /Pick a folder/);
  assert.match((await checkFolder(project, { home: project, own: '' })).why, /home folder/);
  assert.match((await checkFolder(project, { home: fakeEnv.home, own: project })).why, /MILO’s own/);
  assert.match((await checkFolder('', fakeEnv)).why, /Pick a folder/);
});

test('the fake crew looks and changes nothing; under the change ward it writes one file, inside the folder', async () => {
  const runner = createRunner({ ...fakeEnv, mode: 'fake' });
  assert.deepEqual(runner.crew(), { claude: true, codex: true });
  const before = readdirSync(project).sort();
  const look = await runner.run({ title: 'Look', brief: 'Look at it.', who: 'claude', ward: 'look', folder: project });
  assert.deepEqual([look.ok, look.stopped, look.why], [true, false, '']);
  assert.match(look.summary, /Claude read 3 things in the folder\./);
  assert.deepEqual(look.files, ['README.md', 'node_modules/', 'src/']);
  assert.deepEqual(readdirSync(project).sort(), before, 'nothing was added');
  const change = await runner.run({ title: 'Make a thing', brief: 'Make it.', who: 'codex', ward: 'change', folder: project });
  assert.equal(change.ok, true);
  assert.deepEqual(change.files, ['COMMISSION.txt'], 'the files that really changed, read off the disk');
  assert.equal(readFileSync(path.join(project, 'COMMISSION.txt'), 'utf8'), 'Make a thing\n');
  assert.ok(!existsSync(path.join(tmp, 'COMMISSION.txt')), 'and nothing outside it');
});

test('the runner refuses a bad folder or an incomplete commission before anything starts, and runs one at a time', async () => {
  const runner = createRunner({ ...fakeEnv, mode: 'fake' });
  assert.match((await runner.run({ title: 'x', brief: 'x', who: 'claude', ward: 'look', folder: path.join(tmp, 'nowhere') })).why, /isn’t there/);
  assert.match((await runner.run({ title: 'x', brief: '  ', who: 'claude', ward: 'look', folder: project })).why, /isn’t complete/);
  assert.match((await runner.run({ title: 'x', brief: 'x', who: 'gemini', ward: 'look', folder: project })).why, /isn’t complete/);
  assert.match((await runner.run(null)).why, /isn’t complete/);
  const first = runner.run({ title: 'a', brief: 'a', who: 'claude', ward: 'look', folder: project });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runner.busy, true);
  assert.match((await runner.run({ title: 'b', brief: 'b', who: 'claude', ward: 'look', folder: project })).why, /One at a time/);
  assert.equal((await first).ok, true);
  assert.equal(runner.busy, false);
});

test('calling them back stops the run', async () => {
  const runner = createRunner({ ...fakeEnv, mode: 'fake' });
  assert.equal(runner.cancel(), false, 'nobody is out');
  const run = runner.run({ title: 'a', brief: 'a', who: 'claude', ward: 'change', folder: project });
  await new Promise((resolve) => setTimeout(resolve, 30));
  rmSync(path.join(project, 'COMMISSION.txt'), { force: true });
  assert.equal(runner.cancel(), true);
  const r = await run;
  assert.deepEqual([r.ok, r.stopped, r.why], [false, true, 'You called them back.']);
  assert.ok(!existsSync(path.join(project, 'COMMISSION.txt')), 'called back before writing anything');
});

test('a real run goes through the CLI with the ward’s switches, in the folder, and never through a shell', async () => {
  const calls = [];
  const { EventEmitter } = await import('node:events');
  const { Readable, Writable } = await import('node:stream');
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = Readable.from([JSON.stringify({ type: 'result', is_error: false, result: 'Read it all.\n- src/main.js' })]);
    child.stderr = Readable.from([]);
    child.stdin = new Writable({ write(chunk, _enc, cb) { child.brief = (child.brief || '') + chunk; cb(); } });
    child.kill = () => true;
    child.stdout.on('end', () => setTimeout(() => child.emit('close', 0, null), 5));
    return child;
  };
  const bin = path.join(tmp, 'claude.exe');
  writeFileSync(bin, '');
  const runner = createRunner({ ...fakeEnv, env: { MILO_CLAUDE_BIN: bin }, spawnImpl });
  const r = await runner.run({ title: 'Look', brief: 'Look at it.', who: 'claude', ward: 'look', folder: project });
  assert.deepEqual([r.ok, r.summary, r.files], [true, 'Read it all.', ['src/main.js']]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, bin);
  assert.equal(calls[0].options.cwd, project);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args, claudeRunArgs('look'));
  // with no CLI on this PC, it says so and nothing is started
  const none = createRunner({ ...fakeEnv, env: { MILO_CLAUDE_BIN: path.join(tmp, 'missing.exe') }, spawnImpl });
  const miss = await none.run({ title: 'Look', brief: 'Look.', who: 'claude', ward: 'look', folder: project });
  assert.deepEqual([miss.ok, miss.why], [false, 'They aren’t set up on this PC.']);
  assert.equal(calls.length, 1);
});

test('changed files are read off the disk, skipping what a build makes', async () => {
  const since = Date.now() - 2 * 3600_000;
  const files = await changedSince(project, since);
  assert.ok(files.includes('README.md') && files.includes('src/main.js'));
  assert.ok(!files.some((f) => f.startsWith('node_modules')), 'node_modules is skipped');
  assert.deepEqual(await changedSince(project, Date.now() + 60_000), []);
  assert.deepEqual(await changedSince(path.join(tmp, 'nowhere'), 0), []);
});

// ---- the panel ----

test('the panel: the crew, a draft with its ward and folder, and Send only when it can go', () => {
  const { state, id } = draftFree(fresh(), 'Tidy the notes', T0);
  let html = buildCommissions(view(state, ENV), { open: id }, { crew: { claude: true, codex: false } }, T0);
  assert.match(html, /data-who="claude" data-ready="true"/);
  assert.match(html, /data-who="codex" data-ready="false"/);
  assert.match(html, new RegExp(`data-action="commission-send"[^>]*disabled`));
  assert.match(html, /Pick a folder first\./);
  assert.ok(html.includes(COPY.noFolder));
  const ready = updateDraft(state, id, { folder: FOLDER });
  html = buildCommissions(view(ready, ENV), { open: id }, { crew: { claude: true, codex: true } }, T0);
  assert.ok(!/data-action="commission-send"[^>]*disabled/.test(html));
  assert.ok(html.includes('Sends your brief, and what they read in this folder, to Claude.'), 'it says what leaves the PC');
  // a commission that may change files is asked about once more, with the folder named
  const change = updateDraft(ready, id, { ward: 'change' });
  html = buildCommissions(view(change, ENV), { open: id, confirming: id }, {}, T0);
  assert.ok(html.includes(`They may add and edit files in ${FOLDER}. Nothing else.`.replace(/\\/g, '\\')));
  assert.match(html, /data-action="commission-send-yes"/);
  assert.equal(buildCommissions(view(fresh(), ENV), {}, {}, T0).includes(COPY.empty), true);
});

test('the panel: who is out, what is back to read, and what went before', () => {
  const { state: s0, id } = drafted();
  const out = send(s0, id, T0, ENV).state;
  let html = buildCommissions(view(out, ENV), {}, {}, T0 + 3 * 60_000);
  assert.match(html, /data-group="out"/);
  assert.match(html, /Out for 3 minutes\./);
  assert.match(html, /data-action="commission-cancel"/);
  const back = comeBack(out, id, { ok: true, summary: 'Read <b>4</b> files.\n\nAll tidy.', files: ['a.md'] }, T0 + 1);
  html = buildCommissions(view(back, ENV), {}, {}, T0 + 2);
  assert.match(html, /data-group="review"/);
  assert.ok(html.includes('Read &lt;b&gt;4&lt;/b&gt; files.'), 'what they wrote is shown as text, never as markup');
  assert.match(html, /<li>a\.md<\/li>/);
  assert.match(html, /data-action="commission-accept"/);
  assert.ok(!html.includes('data-action="commission-proved"'), 'no level is at stake');
  const read = accept(back, id, T0 + 3).state;
  html = buildCommissions(view(read, ENV), {}, {}, T0 + 4);
  assert.match(html, /data-group="earlier"/);
  assert.match(html, /Read/);
  for (const text of [...Object.values(COPY).filter((v) => typeof v === 'string'), COPY.shares('Claude'), COPY.changeSure('C:\\x'), ...Object.values(WARD_HINTS)]) {
    assert.ok(!text.includes('!') && !/\bplease\b|successfully/i.test(text), `calm copy: ${text}`);
  }
});
