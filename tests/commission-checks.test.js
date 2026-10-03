// Phase 6: a building's check, what a commission pays once it is read, and the rifts for a failing
// check and for work that came back unfinished. No real CLI or check command is run here, apart
// from the runner's own fake mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createState, normalizeState } from '../src/model.js';
import {
  draftForBuilding, draftFree, updateDraft, send, comeBack, accept, setCheck, recordCheck, checkFor, lastCheck, canProve, commissionFacts,
  levelOf, view, CHECK_LIMIT_MS, LIMITS, emptyCommissions,
} from '../src/commissions.js';
import { payForCommission, paidWords, spoilsFor, SPOILS } from '../src/commission/pay.js';
import { runCheck, commandWords } from '../src/commission/runner.js';
import { deriveSignals } from '../src/rifts.js';
const computeSignals = (state, { now }) => deriveSignals({ state, now });
import { buildCommissions, COPY, LOW_MANA } from '../src/ui/commissions-view.js';
import { manaView } from '../src/ui/hud.js';

const economy = JSON.parse(readFileSync(new URL('../content/economy.json', import.meta.url), 'utf8'));
const rates = JSON.parse(readFileSync(new URL('../content/xp.json', import.meta.url), 'utf8'));
const T0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const ENV = { home: 'C:\\Users\\chris', own: 'C:\\Users\\chris\\Projects\\MILO' };
const FOLDER = 'C:\\Users\\chris\\Projects\\Habitack';
const levels = [1, 2, 3, 4, 5].map((level) => ({ level, title: `Level ${level} thing`, summary: `Does thing ${level}.`, proof: `You can see thing ${level}.` }));
const built = () => {
  const s = createState(T0);
  return { ...s, plots: { ...s.plots, 'plot-meadow': { ...s.plots['plot-meadow'], status: 'built', name: 'The Quest Hall', blueprint: { name: 'The Quest Hall', levels } } } };
};
/** A Change files commission for the Quest Hall's next level, back and waiting to be read. */
const back = (state = built(), at = T0) => {
  let { state: s, id } = draftForBuilding(state, 'plot-meadow', at);
  s = updateDraft(s, id, { folder: FOLDER, ward: 'change' });
  s = send(s, id, at, ENV).state;
  return { id, state: comeBack(s, id, { ok: true, summary: 'Built level 1.', files: ['src/a.js'] }, at + 1000) };
};

test('a building’s check is Chris’s own command, kept on one line, and clearing it forgets its result', () => {
  let s = setCheck(built(), 'plot-meadow', '  npm test\r\n -- --watch=false ');
  assert.equal(checkFor(s, 'plot-meadow'), 'npm test  -- --watch=false');
  s = recordCheck(s, 'plot-meadow', { ok: false, tail: 'x'.repeat(5000) }, T0);
  assert.deepEqual([lastCheck(s, 'plot-meadow').ok, lastCheck(s, 'plot-meadow').tail.length], [false, LIMITS.tail]);
  s = setCheck(s, 'plot-meadow', '');
  assert.equal(checkFor(s, 'plot-meadow'), '');
  assert.equal(lastCheck(s, 'plot-meadow'), null);
  assert.equal(setCheck(s, 'not-a-plot', 'npm test'), s);
  assert.equal(setCheck(s, 'plot-meadow', 5), s);
  assert.equal(setCheck(s, 'plot-meadow', 'x'.repeat(500)).commissions.checks['plot-meadow'].length, LIMITS.check);
  assert.equal(CHECK_LIMIT_MS, 10 * 60 * 1000);
});

test('with a check set, It works waits for the check to pass after the commission came back', () => {
  let { id, state } = back(setCheck(built(), 'plot-meadow', 'npm test'));
  const c = () => state.commissions.list.find((x) => x.id === id);
  assert.equal(canProve(state, c()), false, 'not until the check has run');
  assert.equal(accept(state, id, T0 + 2, { proved: true }).levelled, null);
  state = recordCheck(state, 'plot-meadow', { ok: false, tail: '1 failing' }, T0 + 2, id);
  assert.deepEqual(c().check, { ok: false, at: T0 + 2 });
  assert.equal(canProve(state, c()), false);
  state = recordCheck(state, 'plot-meadow', { ok: true, tail: 'all passing' }, T0 + 3, id);
  assert.equal(canProve(state, c()), true);
  const r = accept(state, id, T0 + 4, { proved: true });
  assert.deepEqual([r.levelled, levelOf(r.state, 'plot-meadow')], [{ plotId: 'plot-meadow', level: 1 }, 1]);
  // without a check, Chris’s word is the proof
  const plain = back();
  assert.equal(canProve(plain.state, plain.state.commissions.list[0]), true);
});

test('a check run for another building, or after the commission was read, changes nothing on it', () => {
  const { id, state } = back(setCheck(built(), 'plot-meadow', 'npm test'));
  const other = recordCheck(state, 'plot-rise', { ok: true, tail: '' }, T0 + 2, id);
  assert.equal(other.commissions.list[0].check, null);
  assert.ok(other.commissions.checked['plot-rise']);
  const read = accept(state, id, T0 + 2).state;
  assert.equal(recordCheck(read, 'plot-meadow', { ok: true }, T0 + 3, id).commissions.list[0].check, null);
  assert.equal(recordCheck(state, 'plot-meadow', { ok: 'yes' }, T0), state);
  // and a saved check result survives a reload
  const kept = recordCheck(state, 'plot-meadow', { ok: true, tail: 'ok' }, T0 + 2, id);
  const reloaded = normalizeState(JSON.parse(JSON.stringify(kept)), T0 + 3);
  assert.deepEqual(reloaded.commissions.list[0].check, { ok: true, at: T0 + 2 });
  assert.deepEqual(reloaded.commissions.checked['plot-meadow'], { ok: true, at: T0 + 2, tail: 'ok' });
  assert.deepEqual(emptyCommissions().checks, {});
});

test('one that didn’t finish is put away, proves nothing and pays nothing', () => {
  let { state, id } = draftFree(createState(T0), 'Tidy', T0);
  state = updateDraft(state, id, { folder: FOLDER });
  state = comeBack(send(state, id, T0, ENV).state, id, { ok: false, why: 'They need signing in again.' }, T0 + 1);
  const c = state.commissions.list[0];
  assert.equal(c.status, 'failed');
  const r = accept(state, id, T0 + 2, { proved: true });
  assert.deepEqual([r.ok, r.levelled, r.state.commissions.list[0].status], [true, null, 'done']);
  assert.deepEqual(payForCommission(r.state, c, T0 + 2, { economy, rates }).paid, null);
});

test('reading a commission pays 5 Embers once and Command XP; proving a level pays more XP', () => {
  const { id, state } = back();
  const c = state.commissions.list.find((x) => x.id === id);
  const read = accept(state, id, T0 + 2).state;
  const paid = payForCommission(read, { ...c, status: 'done' }, T0 + 2, { economy, rates });
  assert.deepEqual(paid.paid, { embers: 5, xp: 100, skill: 'command', spoils: { 'forged-part': 1 } });
  assert.equal(paid.state.embers.balance, 5);
  assert.equal(paid.state.satchel.materials['forged-part'], 1, 'real changes leave a Forged Part');
  assert.equal(paidWords(paid.paid), '+5 Embers · Command +100 · a Forged Part');
  assert.equal(payForCommission(paid.state, { ...c, status: 'done' }, T0 + 3, { economy, rates }).paid.embers, 0, 'the same commission never pays Embers twice');
  const proved = payForCommission(read, { ...c, status: 'done' }, T0 + 2, { economy, rates, proved: true });
  assert.deepEqual([proved.paid.embers, proved.paid.xp], [5, 400]);
  assert.equal(proved.state.embers.ledger.at(-1).text, 'A commission that proved a level');
});

test('commissions pay at most 15 Embers a day', () => {
  let state = built();
  let total = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = back(state, T0 + i * 10_000);
    state = accept(r.state, r.id, T0 + i * 10_000 + 2).state;
    const c = state.commissions.list.find((x) => x.id === r.id);
    const p = payForCommission(state, c, T0 + i * 10_000 + 3, { economy, rates });
    state = p.state;
    total += p.paid.embers;
  }
  assert.equal(total, 15);
  const tomorrow = back(state, T0 + DAY);
  const read = accept(tomorrow.state, tomorrow.id, T0 + DAY + 2).state;
  assert.equal(payForCommission(read, read.commissions.list.find((x) => x.id === tomorrow.id), T0 + DAY + 3, { economy, rates }).paid.embers, 5);
});

test('a failing check opens a Neon rift over its building, and a passing one seals it', () => {
  let state = setCheck(built(), 'plot-meadow', 'npm test');
  state = recordCheck(state, 'plot-meadow', { ok: false, tail: '1 failing' }, T0);
  let facts = commissionFacts(state);
  assert.deepEqual(facts.failing.map((f) => [f.plotId, f.name]), [['plot-meadow', 'The Quest Hall']]);
  const sig = computeSignals(state, { now: T0 + 1000 }).find((s) => s.key === 'check:plot-meadow');
  assert.ok(sig, 'the rift is there');
  assert.deepEqual([sig.kind, sig.signals, sig.echo.place], ['check', ['check-failing'], 'plot-meadow']);
  assert.match(sig.cause, /The check for The Quest Hall is failing\./);
  state = recordCheck(state, 'plot-meadow', { ok: true, tail: '' }, T0 + 2000);
  assert.deepEqual(commissionFacts(state).failing, []);
  assert.ok(!computeSignals(state, { now: T0 + 3000 }).some((s) => s.key === 'check:plot-meadow'));
  // a check with no building standing, or cleared, opens nothing
  facts = commissionFacts(setCheck(recordCheck(setCheck(built(), 'plot-meadow', 'npm test'), 'plot-meadow', { ok: false }, T0), 'plot-meadow', ''));
  assert.deepEqual(facts.failing, []);
});

test('work that came back unfinished opens one Noir rift over the camp until it is read', () => {
  let state = createState(T0);
  for (const title of ['One', 'Two']) {
    const d = draftFree(state, title, T0);
    state = updateDraft(d.state, d.id, { folder: FOLDER });
    state = comeBack(send(state, d.id, T0, ENV).state, d.id, { ok: false, why: 'They came back without an answer.' }, T0 + 5);
  }
  const sigs = computeSignals(state, { now: T0 + 1000 }).filter((s) => s.key === 'failed:crew');
  assert.equal(sigs.length, 1);
  assert.deepEqual([sigs[0].kind, sigs[0].signals, sigs[0].echo.place], ['failed', ['unexplained-failure'], 'camp']);
  assert.match(sigs[0].cause, /2 commissions came back without finishing\./);
  for (const c of state.commissions.list) state = accept(state, c.id, T0 + 10).state;
  assert.ok(!computeSignals(state, { now: T0 + 2000 }).some((s) => s.key === 'failed:crew'), 'read, it seals');
});

test('the check is run in the folder as words, never as anything the crew wrote; fake mode passes unless it says fail', async () => {
  assert.deepEqual(commandWords('npm test'), ['npm', 'test']);
  assert.deepEqual(commandWords('node "C:\\My Tools\\check.js" --quick'), ['node', 'C:\\My Tools\\check.js', '--quick']);
  assert.deepEqual(commandWords(''), []);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'milo-check-test-'));
  const project = path.join(tmp, 'project');
  mkdirSync(project);
  const env = { home: path.join(tmp, 'home'), own: path.join(tmp, 'milo') };
  try {
    assert.deepEqual((await runCheck(project, 'npm test', { ...env, mode: 'fake' })).ok, true);
    const bad = await runCheck(project, 'npm run fail-on-purpose', { ...env, mode: 'fake' });
    assert.deepEqual([bad.ok, bad.tail], [false, '1 failing']);
    assert.match((await runCheck(project, '', { ...env, mode: 'fake' })).why, /Set a check first/);
    assert.match((await runCheck(path.join(tmp, 'nowhere'), 'npm test', { ...env, mode: 'fake' })).why, /isn’t there/);
    // a real run goes through the system shell in the folder, with the command's own words
    const calls = [];
    const { EventEmitter } = await import('node:events');
    const { Readable, Writable } = await import('node:stream');
    const spawnImpl = (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = Readable.from(['\u001b[32m3 passing\u001b[0m\n']);
      child.stderr = Readable.from([]);
      child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
      child.kill = () => true;
      child.stdout.on('end', () => setTimeout(() => child.emit('close', 0, null), 5));
      return child;
    };
    const r = await runCheck(project, 'npm test', { ...env, spawnImpl, env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } });
    assert.deepEqual([r.ok, r.tail], [true, '3 passing']);
    assert.equal(calls[0].options.cwd, project);
    assert.equal(calls[0].options.shell, false);
    if (process.platform === 'win32') assert.deepEqual([calls[0].command, calls[0].args], ['C:\\Windows\\System32\\cmd.exe', ['/d', '/c', 'npm', 'test']]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the panel: a building’s draft has its check; what came back shows the check and holds It works until it passes', () => {
  let { state, id } = draftForBuilding(built(), 'plot-meadow', T0);
  state = setCheck(state, 'plot-meadow', 'npm test');
  let html = buildCommissions(view(state, ENV), { open: id }, {}, T0);
  assert.match(html, /data-field="commission-check"[^>]*/);
  assert.ok(html.includes('value="npm test"'));
  const r = back(setCheck(built(), 'plot-meadow', 'npm test'));
  html = buildCommissions(view(r.state, ENV), {}, {}, T0);
  assert.match(html, /data-action="commission-run-check"/);
  assert.match(html, /<code>npm test<\/code>/);
  assert.match(html, /data-action="commission-proved"[^>]*disabled/);
  const passed = recordCheck(r.state, 'plot-meadow', { ok: true, tail: '3 passing <b>' }, T0 + 2, r.id);
  html = buildCommissions(view(passed, ENV), {}, {}, T0);
  assert.ok(!/data-action="commission-proved"[^>]*disabled/.test(html));
  assert.ok(html.includes(COPY.passed));
  assert.ok(html.includes('3 passing &lt;b&gt;'), 'what the check printed is text, never markup');
  html = buildCommissions(view(passed, ENV), { checking: r.id }, {}, T0);
  assert.ok(html.includes(COPY.checking));
});

test('the crew panel shows Codex’s allowance, and a Codex draft says when it is nearly gone', () => {
  let { state, id } = draftFree(createState(T0), 'Tidy', T0);
  state = updateDraft(state, id, { folder: FOLDER, who: 'codex' });
  const at = (used) => manaView({ capacity: { codex: { usedPercent: used, resetsAt: T0 + 3600_000 } } }, T0);
  let html = buildCommissions(view(state, ENV), { open: id }, { crew: { claude: true, codex: true }, mana: at(38) }, T0);
  assert.match(html, /Codex <span class="commission-meta">ready · 62% left<\/span>/);
  assert.ok(!html.includes(COPY.lowMana));
  html = buildCommissions(view(state, ENV), { open: id }, { crew: { claude: true, codex: true }, mana: at(100 - LOW_MANA + 1) }, T0);
  assert.ok(html.includes(COPY.lowMana));
  assert.ok(!/data-action="commission-send"[^>]*disabled/.test(html), 'it says so; it doesn’t stop him');
  html = buildCommissions(view(state, ENV), { open: id }, { crew: { claude: true, codex: true }, mana: manaView(null, T0) }, T0);
  assert.ok(!html.includes('left</span>'), 'no reading, nothing shown');
});

test('spoils: a Forged Part for files really changed, a Captain’s Seal for a check passed or a level proved', () => {
  assert.deepEqual(Object.keys(SPOILS), ['forged-part', 'captains-seal']);
  assert.deepEqual(spoilsFor({ ward: 'look', result: { files: ['a.md'] } }), {}, 'a look changes nothing, and earns no part');
  assert.deepEqual(spoilsFor({ ward: 'change', result: { files: [] } }), {}, 'nor a change that changed nothing');
  assert.deepEqual(spoilsFor({ ward: 'change', result: { files: ['a.js'] } }), { 'forged-part': 1 });
  assert.deepEqual(spoilsFor({ ward: 'change', result: { files: ['a.js'] }, check: { ok: true, at: T0 } }), { 'forged-part': 1, 'captains-seal': 1 });
  assert.deepEqual(spoilsFor({ ward: 'change', result: { files: ['a.js'] }, check: { ok: false, at: T0 } }), { 'forged-part': 1 });
  assert.deepEqual(spoilsFor({ ward: 'suggest', result: { files: [] } }, { proved: true }), { 'captains-seal': 1 });
  assert.deepEqual(spoilsFor(null), {});
  const { id, state } = back(setCheck(built(), 'plot-meadow', 'npm test'));
  const checked = recordCheck(state, 'plot-meadow', { ok: true, tail: '' }, T0 + 2, id);
  const r = accept(checked, id, T0 + 3, { proved: true });
  const c = r.state.commissions.list.find((x) => x.id === id);
  const paid = payForCommission(r.state, c, T0 + 3, { economy, rates, proved: true });
  assert.deepEqual(paid.paid.spoils, { 'forged-part': 1, 'captains-seal': 1 });
  assert.equal(paidWords(paid.paid), '+5 Embers · Command +400 · a Forged Part · a Captain’s Seal');
  assert.deepEqual([paid.state.satchel.materials['forged-part'], paid.state.satchel.materials['captains-seal']], [1, 1]);
  // and the save keeps them
  const reloaded = normalizeState(JSON.parse(JSON.stringify(paid.state)), T0 + 4);
  assert.equal(reloaded.satchel.materials['captains-seal'], 1);
});

test('a crew session MILO has seen working for three hours without a break opens a Neon rift over the Watchtower', () => {
  const HOUR = 3600_000;
  const snapshot = (sessions) => ({ scannedAt: T0, sources: { claude: { ok: true }, codex: { ok: true } }, sessions });
  const session = (over = {}) => ({ id: 'claude:abc', agent: 'claude', title: 'Refactor the board', status: 'working', lastActivityAt: T0, startedAt: T0 - 48 * HOUR, ...over });
  const loops = (sessions) => deriveSignals({ snapshot: snapshot(sessions), state: createState(T0), now: T0 }).filter((s) => s.kind === 'loop');
  assert.deepEqual(loops([session()]), [], 'a session started long ago counts for nothing without MILO having seen it busy that long');
  assert.deepEqual(loops([session({ busySince: T0 - 2 * HOUR })]), [], 'two hours is a long piece of work, not a loop');
  const [sig] = loops([session({ busySince: T0 - 3.5 * HOUR })]);
  assert.ok(sig);
  assert.deepEqual([sig.key, sig.signals, sig.echo.place, sig.sessionId], ['loop:claude:abc', ['agent-loop'], 'watchtower', 'claude:abc']);
  assert.match(sig.cause, /has been working for .* without a break\./);
  assert.match(sig.stitch, /If it is going round in circles, stop it\./);
  assert.deepEqual(loops([session({ busySince: T0 - 5 * HOUR, status: 'idle' })]), [], 'a break seals it');
  assert.deepEqual(loops([session({ busySince: T0 - 5 * HOUR, archived: true })]), []);
});

test('the Hold counts what Phases 5 and 6 made real: proven levels, finished quests, residents, and mined stone and copper', async () => {
  const { hearthStatus } = await import('../src/hearth.js');
  const fortress = JSON.parse(readFileSync(new URL('../content/fortress.json', import.meta.url), 'utf8'));
  let state = { ...built(), hearth: { ...built().hearth, tier: 2 } };
  state = { ...state, commissions: { ...state.commissions, levels: { 'plot-meadow': 1 } } };
  state = { ...state, board: { ...state.board, quests: Array.from({ length: 25 }, (_, i) => ({ id: `q-${i}`, title: 'x', status: 'done' })) } };
  state = { ...state, satchel: { ...state.satchel, materials: { ...state.satchel.materials, stone: 200, copper: 40, copperstone: 20 } } };
  const next = hearthStatus(state, fortress).next;
  assert.equal(next.id, 'hold');
  const req = Object.fromEntries(next.requirements.map((r) => [r.kind, [r.have, r.met, r.future]]));
  assert.deepEqual(req['building-level'], [1, true, false]);
  assert.deepEqual(req['quests-finished'], [25, true, false]);
  const mat = Object.fromEntries(next.materials.map((m) => [m.id, [m.have, m.met, Boolean(m.future)]]));
  assert.deepEqual(mat.stone, [200, true, false]);
  assert.deepEqual(mat.copperstone, [60, true, false], 'the copper Milo mines is copperstone');
});
