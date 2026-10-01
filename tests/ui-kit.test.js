// K1, the groundwork UI (src/ui/log.js, menus.js, examine.js, wallet.js, chronicle-view.js,
// kindle-view.js, hud.js, skills-view.js, trail-view.js, satchel-view.js and kit.css):
// CONTRACT-PHASE4.md §12 (all of it), §13 "K1. Groundwork UI" and the K1/K2 proofs, §9.12's
// examineKey table, §4.20–§4.23. The builders are proven here in Node: escaping (the <img onerror>
// and <script> titles), data-* attributes and focus keys, calm copy, determinism, Examine always
// last, keyboard maps as pure tables, examineKey against §9.12, each HUD tab opening its panel,
// and the trail note. The mounts are exercised against a stub shell (no DOM, or a small fake one);
// they're mounted and proven in the app in wave 3.
//
//   node --test tests/ui-kit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createState, normalizeState } from '../src/model.js';
import { payFromSignals, spend } from '../src/embers.js';
import { kindleStart, kindleTick, nextAlarm, FOCUS_MS, REST_MS } from '../src/kindle.js';
import { noteFight } from '../src/chronicle.js';
import { addXp, SKILL_IDS } from '../src/lifeskills.js';
import { markFeature, markFact } from '../src/state4.js';
import { handOut, stepDone } from '../src/world/trail.js';
import { skyAt } from '../src/sky.js';
import { createWorldgen } from '../src/world/worldgen.js';
import { createWilds } from '../src/world/wilds.js';
import { assertCalm, assertCosy, assertOwnWords, deniedIn, uncosyIn } from './calm.js';

import * as log from '../src/ui/log.js';
import * as menus from '../src/ui/menus.js';
import * as examine from '../src/ui/examine.js';
import * as wallet from '../src/ui/wallet.js';
import * as chronicleView from '../src/ui/chronicle-view.js';
import * as kindleUi from '../src/ui/kindle-view.js';
import * as hud from '../src/ui/hud.js';
import * as skillsUi from '../src/ui/skills-view.js';
import * as trailUi from '../src/ui/trail-view.js';
import * as satchelUi from '../src/ui/satchel-view.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const companions = Object.fromEntries(readdirSync(new URL('../content/party/companions/', import.meta.url))
  .filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), read(`party/companions/${f.slice(0, -5)}`)]));
const CONTENT = Object.freeze({
  skills: read('skills'), xp: read('xp'), economy: read('economy'), spells: read('spells'), sky: read('sky'), examine: read('examine'),
  trails: read('trails'), wilds: read('wilds'),
  combat: { callings: read('combat/callings'), foes: read('combat/foes') },
  party: { companions },
});

// Names LORE.md §21 doesn't have yet, which this copy uses (§16.3): wave 4 adds them to the index.
const PENDING_NAMES = ['Ember', 'Grimoire', 'HUD', 'Mana', 'Mark', 'XP'];
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = new Date(2026, 8, 29, 9, 10, 0).getTime(); // 09:10 local, 29 September 2026
const IMG = '<img src=x onerror=alert(1)>';
const SCRIPT = '<script>alert(1)</script>';
const K1_FILES = ['log', 'menus', 'examine', 'wallet', 'chronicle-view', 'kindle-view', 'hud', 'skills-view', 'trail-view', 'satchel-view'];

/** A state whose Ember backlog is paid, with an empty wallet. */
function fresh(now = T) {
  const state = payFromSignals(createState(now - HOUR), now - HOUR, CONTENT.economy).state;
  return { ...state, embers: { ...state.embers, balance: 0 } };
}
const relaunch = (state, now) => normalizeState(JSON.parse(JSON.stringify(state)), now);
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Visible text: tags out, entities back. */
function visible(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
/** Calm basics for any text a builder shows. */
function assertCalmText(html, where) {
  const text = visible(html);
  assert.ok(!text.includes('!'), `${where}: no exclamation marks: ${text.slice(0, 160)}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where}: no please or successfully`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where}: no emoji`);
  assert.ok(!/["']/.test(text), `${where}: curly quotes and apostrophes only: ${text.match(/.{0,30}["'].{0,30}/)?.[0]}`);
  assert.deepEqual(uncosyIn(text), [], `${where}: cosy words`);
  assert.deepEqual(deniedIn(text), [], `${where}: its own words`);
}
function assertEscaped(html, where) {
  assert.ok(!/<img|<script/i.test(html), `${where} escapes what it shows: ${html.slice(0, 200)}`);
  assert.ok(/&lt;(img|script)/.test(html), `${where} shows the hostile text as text`);
}
/** Every <button …> tag's attributes, as maps. */
function buttons(html) {
  return [...String(html).matchAll(/<button\b([^>]*)>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
}
const ACTION = /^(log|menu|hud|kindle|chronicle|skills|trail|tracker)-[a-z-]+$/;
function assertControls(html, where) {
  const list = buttons(html);
  const keys = new Set();
  for (const b of list) {
    assert.ok(b['data-focus-key'], `${where}: a button without a focus key: ${JSON.stringify(b)}`);
    assert.ok(!keys.has(b['data-focus-key']), `${where}: focus key ${b['data-focus-key']} is used twice`);
    keys.add(b['data-focus-key']);
    assert.ok(b['data-action'] ? ACTION.test(b['data-action']) : Boolean(b['data-setting']), `${where}: ${JSON.stringify(b)} has a <module>-<verb> action`);
    assert.equal(b.type, 'button', `${where}: every button is type="button"`);
  }
  for (const m of String(html).matchAll(/style="([^"]*)"/g)) assert.match(m[1], /^(width|height):\d{1,3}%$/, `${where}: a style carries a size only`);
  return list;
}

/** A shell with what §12.2 lists, recording what the modules ask of it. */
function stubShell({ state = fresh(), now = T, content = CONTENT, snapshot = null, area = { area: 'vale' } } = {}) {
  let [current, clock, stack, ring] = [state, now, [], null];
  const handlers = new Map();
  const calls = { bubbles: [], panels: [], features: [], travel: [], world: [], statuses: [], alarms: [], settings: [], sets: 0, refresh: [], insets: [], map: 0, emits: [] };
  const registered = new Map();
  const emit = (event, payload) => { for (const fn of [...(handlers.get(event) || [])]) fn(payload); };
  const shell = {
    get state() { return current; },
    set(next) { if (next === current) return false; [current, calls.sets] = [next, calls.sets + 1]; emit('state'); return true; },
    now: () => clock, motion: () => false, content: () => content, snapshot: () => snapshot, area: () => area,
    world(method, ...args) { calls.world.push([method, ...args]); return method === 'miloTile' ? { x: 10, y: 12 } : undefined; },
    bubble: (message) => calls.bubbles.push(message), log: () => {},
    openPanel: (id, opts) => calls.panels.push([id, opts ?? null]), closePanel() {}, refreshPanel: (opts) => calls.refresh.push(opts ?? null),
    registerPanel(prefix, def) { registered.set(prefix, def); return () => registered.delete(prefix); },
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); return () => handlers.get(event).delete(fn); },
    keys: { push(handler) { stack.push(handler); return () => { stack = stack.filter((h) => h !== handler); }; } },
    insets: (name, rect) => calls.insets.push([name, rect]), travel: (target) => calls.travel.push(target), leaveElsewhere() {},
    feature(featureId) { calls.features.push(featureId); current = markFeature(current, featureId, clock); },
    status: (source, text) => calls.statuses.push([source, text]), emit: (event, payload) => calls.emits.push([event, payload]), openMap: () => { calls.map += 1; },
    bridge: { alarm: { set: (alarm) => { calls.alarms.push(alarm); return Promise.resolve(true); }, onRing: (cb) => { ring = cb; return () => { ring = null; }; } }, notebooks: null, notify: () => {} },
    settings: { get: (key) => current.settings?.[key], set(key, value) { calls.settings.push([key, value]); current = { ...current, settings: { ...current.settings, [key]: value } }; } },
  };
  return { shell, calls, registered, emit, advance(ms) { clock += ms; }, at(t) { clock = t; }, keys: () => stack, ring: () => ring };
}

/** A stray entity, as the engine would hand it over (with what the shell adds). */
const stray = (archetype, extra = {}) => ({ kind: 'stray', id: `stray:rift:abc:${archetype}`, label: 'A glitch beetle', archetype, temperament: 'curious', genre: 'neon', ...extra });

/* ------------------------------------------------------------------ escaping, focus keys and determinism */

test('every builder shows an <img onerror> or <script> title as text, never as markup', () => {
  const hostile = `${IMG} and ${SCRIPT}`;
  // The Log: a line's words, its detail and its action.
  const line = { tab: 'crew', text: hostile, at: T, detail: [hostile], action: { id: 'panel:chronicle', label: hostile }, seq: 1 };
  assertEscaped(log.buildLogLine(line, { open: [1] }), 'a Log line');
  assertEscaped(log.buildLog({ ...log.logView({ lines: [line], open: [1] }), hint: [hostile] }), 'the Log');
  // Menus: a target's label comes into its options and the menu's title.
  const options = menus.optionsFor({ kind: 'poi', id: 'poi:ruin:1,2', label: hostile }, menus.menuContext());
  assertEscaped(menus.buildMenu({ title: hostile, options }), 'a context menu');
  // The Chronicle: a ledger entry, a fight and an XP line.
  let state = fresh();
  state = { ...state, embers: { ...state.embers, ledger: [...state.embers.ledger, { at: T, n: 5, banked: 5, source: 'focus', text: hostile }] } };
  state = noteFight(state, T, { id: 'fight:1', at: T, where: hostile, outcome: 'won', rounds: 3, xp: 40, marks: 2, summary: hostile });
  state = addXp(state, 'focus', 1000, T, { source: 'focus-session', text: hostile }).state;
  assertEscaped(chronicleView.buildChronicle(chronicleView.chronicleView(state, T + MIN)), 'the Chronicle');
  // Skills: a name from content.
  const skills = clone(CONTENT.skills);
  skills.skills[0].name = hostile;
  skills.skills[0].unlocks[0].text = hostile;
  assertEscaped(skillsUi.buildSkills(skillsUi.skillsPanelView(state, { skills }, { open: skills.skills[0].id })), 'the Skills panel');
  // The trail: a riddle, its sign and its hint.
  const trail = { trail: { id: 'first-trail', title: hostile, tier: 'easy', tierName: hostile }, step: { id: 's1', riddle: [hostile], sign: hostile, hint: hostile },
    steps: [{ id: 's1', riddle: [hostile], sign: hostile, hint: hostile, done: false }], done: false, atBridge: false, hinted: ['s1'] };
  assertEscaped(trailUi.buildTrail(trail), 'the trail panel');
  assertEscaped(trailUi.trailCard(trail), 'the trail card');
  // The satchel: essences, relics and a tonic's name from content.
  const satchel = satchelUi.satchelView({ satchel: { marks: 3, tonics: { cordial: 1 }, essences: { [hostile]: 2 }, essenceGenres: {}, relics: [{ name: hostile, text: hostile }] } },
    { combat: { callings: { items: [], abilities: [{ id: 'cordial', name: hostile, text: hostile }] } } });
  assertEscaped(satchelUi.buildSatchel(satchel), 'the satchel');
  // Kindle, the HUD and the wallet show numbers and their own words; what reaches them is escaped anyway.
  assertEscaped(kindleUi.buildKindle({ phase: 'focus', endsText: hostile, today: { focus: 1, rests: 0 }, bell: true }), 'the Kindle panel');
  assertEscaped(kindleUi.buildKindleOrb({ phase: 'focus', text: hostile }), 'the Kindle orb');
  const view = hud.hudView({ state: fresh(), now: T });
  view.orbs.mana.label = hostile;
  view.tabs[0].label = hostile;
  assertEscaped(hud.buildHud(view), 'the HUD');
});

test('every button carries a <module>-<verb> action and a focus key of its own, and every style is a size', () => {
  let state = fresh();
  state = kindleStart(state, T, { economy: CONTENT.economy, xp: CONTENT.xp }).state;
  const builds = {
    log: log.buildLog(log.logView({ lines: [{ tab: 'milo', text: 'Hello.', at: T, seq: 1, detail: ['More.'], action: { id: 'panel:chronicle', label: 'Open' } }], combat: true })),
    menu: menus.buildMenu({ title: 'A lantern', options: menus.optionsFor({ kind: 'lantern', id: 'lantern:1,2' }) }),
    kindleIdle: kindleUi.buildKindle(kindleUi.kindlePanelView(fresh(), T)),
    kindleFocus: kindleUi.buildKindle(kindleUi.kindlePanelView(state, T + MIN)),
    kindleConfirm: kindleUi.buildKindle(kindleUi.kindlePanelView(state, T + MIN, { confirming: 'stop' })),
    chronicle: chronicleView.buildChronicle(chronicleView.chronicleView(state, T + MIN)),
    skills: skillsUi.buildSkills(skillsUi.skillsPanelView(state, CONTENT, { open: 'focus' })),
    hudAdventure: hud.buildHud(hud.hudView({ state, now: T, area: { area: 'elsewhere' } })),
    hudQuiet: hud.buildHud({ mode: 'quiet' }),
    hudSettings: hud.buildHudSettings({ kindleBell: true, hud: 'adventure' }),
    satchel: satchelUi.buildSatchel(satchelUi.satchelView(state, CONTENT)),
  };
  for (const [where, html] of Object.entries(builds)) {
    const list = assertControls(html, where);
    assert.ok(where === 'satchel' ? list.length === 0 : list.length > 0, `${where} has controls (the satchel is read-only)`);
  }
  // The panels' own actions all start with their module's name.
  assert.ok(buttons(builds.kindleConfirm).every((b) => b['data-action'].startsWith('kindle-')));
  assert.ok(buttons(builds.chronicle).every((b) => b['data-action'].startsWith('chronicle-')));
  assert.ok(buttons(builds.skills).every((b) => b['data-action'] === 'skills-guide'));
});

test('the same view always builds the same string, and a panel’s HTML holds still from one second to the next', () => {
  let state = fresh();
  state = kindleStart(state, T, { economy: CONTENT.economy, xp: CONTENT.xp }).state;
  state = noteFight(state, T, { id: 'fight:1', at: T, where: 'The Crowded Crypt', outcome: 'won', rounds: 3, xp: 40, marks: 2, summary: 'Milo kept the lantern high.' });
  const views = [
    [log.buildLog, log.logView({ lines: [{ tab: 'milo', text: 'Hello.', at: T, seq: 1, detail: null, action: null }] })],
    [menus.buildMenu, { title: 'A tree', options: menus.optionsFor({ kind: 'tree', id: 'tree:1,2' }) }],
    [chronicleView.buildChronicle, chronicleView.chronicleView(state, T + MIN)],
    [kindleUi.buildKindle, kindleUi.kindlePanelView(state, T + MIN, { content: CONTENT })],
    [hud.buildHud, hud.hudView({ state, now: T })],
    [skillsUi.buildSkills, skillsUi.skillsPanelView(state, CONTENT)],
    [trailUi.buildTrail, trailUi.trailPanelView(state, CONTENT.trails, T)],
    [satchelUi.buildSatchel, satchelUi.satchelView(state, CONTENT)],
    [wallet.buildWallet, { balance: 42, cap: 100, lifetime: 120, today: { earned: 10, spent: 5 } }],
  ];
  for (const [build, view] of views) {
    assert.equal(build(view), build(clone(view)), `${build.name} is deterministic`);
  }
  // Per-second text lives outside #panel: the Kindle, Chronicle and Skills panels read the same a second later.
  for (const t of [T + MIN, T + 20 * MIN, T + 49 * MIN + 58000]) {
    assert.equal(kindleUi.buildKindle(kindleUi.kindlePanelView(state, t)), kindleUi.buildKindle(kindleUi.kindlePanelView(state, t + 1000)), `Kindle at ${t - T}`);
    assert.equal(chronicleView.buildChronicle(chronicleView.chronicleView(state, t)), chronicleView.buildChronicle(chronicleView.chronicleView(state, t + 1000)));
  }
  // The orb counts down every second instead.
  assert.notEqual(kindleUi.orbView(state, T + MIN).text, kindleUi.orbView(state, T + MIN + 1000).text);
});

test('no K1 source reads the clock, rolls dice, imports app.js, or passes 1,500 lines', () => {
  for (const name of K1_FILES) {
    const source = readFileSync(new URL(`../src/ui/${name}.js`, import.meta.url), 'utf8');
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/Date\.now\(|Math\.random\(|performance\.now\(/.test(code), `${name}.js is pure of the clock and dice`);
    assert.ok(!/from\s+['"][^'"]*app\.js['"]/.test(code), `${name}.js never imports app.js`);
    assert.ok(!/location\.hash|pushState|replaceState/.test(code), `${name}.js never touches the URL`);
    assert.ok(source.split('\n').length <= 1500, `${name}.js is at most 1,500 lines`);
    assert.match(code, /export const id = '/, `${name}.js exports its id`);
    assert.match(code, /export function mount\(shell/, `${name}.js exports mount(shell)`);
  }
});

/* ------------------------------------------------------------------ calm copy */

test('every line K1 writes itself is calm, cosy and its own', () => {
  const lines = [
    ...Object.values(kindleUi.COPY), kindleUi.payNote(kindleUi.kindlePay(CONTENT)),
    ...Object.values(trailUi.COPY), ...Object.values(satchelUi.COPY),
    log.EMPTY_LINE, log.HELP.text, ...log.HELP.detail, hud.GRIMOIRE_LINE, examine.FALLBACK_LINE, examine.UNEXAMINED_LINE, ...Object.values(log.CANT),
    ...Object.values(chronicleView.SOURCE_WORDS), ...Object.values(chronicleView.OUTCOME_WORDS),
    kindleUi.statusLine(kindleStart(fresh(), T).state, T + MIN), kindleUi.statusLine(kindleStart(fresh(), T).state, T + FOCUS_MS + MIN),
    kindleUi.orbView(fresh(), T).label, kindleUi.orbView(kindleStart(fresh(), T).state, T + MIN).label,
    hud.manaView(null, T).label, hud.manaView(null, T).line,
    hud.manaView({ capacity: { codex: { usedPercent: 40, resetsAt: T + HOUR } } }, T).line,
    hud.emberOrb(fresh(), T).label, wallet.walletLabel({ balance: 42, cap: 100 }),
    skillsUi.levelLine({ skill: 'cartography', level: 5 }),
    log.commandReply({ kind: 'not-yet', spell: 'found-things', from: 'Phase 7' }, { grimoire: CONTENT.spells }).text,
    log.commandReply({ kind: 'not-yet', spell: 'bottle-a-rift', from: 'Later' }, { grimoire: CONTENT.spells }).text,
    log.commandReply({ kind: 'unknown', text: 'kindel', suggest: '::kindle' }).text,
    log.commandReply({ kind: 'unknown', text: 'zzz', suggest: null }).text,
    ...kindleUi.phaseBubbles([{ t: 'focus-done' }, { t: 'rest-done' }], { paid: 15 }).flatMap((b) => b.lines),
    ...kindleUi.phaseBubbles([{ t: 'focus-done' }], { paid: 10 }).flatMap((b) => b.lines),
    ...kindleUi.phaseBubbles([{ t: 'rest-done' }], { paid: 1 }).flatMap((b) => b.lines),
    ...['start', 'rest', 'stop'].flatMap((verb) => ['focus', 'rest', null].flatMap((lost) => kindleUi.phaseBubbles([{ t: 'focus-started' }, { t: 'rest-started' }, { t: 'stopped' }], { verb, lost }).flatMap((b) => b.lines))),
  ];
  for (const [i, line] of lines.entries()) {
    assert.equal(typeof line, 'string', `line ${i}`);
    assertCalm(line, `K1 line ${i}`, { proper: PENDING_NAMES });
    assertCosy(line, `K1 line ${i}`);
    assertOwnWords(line, `K1 line ${i}`);
  }
  // Bubble titles have no full stop, and are calm.
  const titles = [...kindleUi.phaseBubbles([{ t: 'focus-done' }, { t: 'rest-done' }, { t: 'focus-started' }], { verb: 'start' }), ...kindleUi.phaseBubbles([{ t: 'focus-done' }])].map((b) => b.title);
  for (const title of titles) {
    assertCalm(title, 'a bubble title', { proper: PENDING_NAMES });
    assert.ok(!/\.$/.test(title), `${title} has no full stop`);
  }
  // Menu labels and why lines.
  const ctx = menus.menuContext({ state: { party: { roster: { milo: {}, claude: {}, codex: {}, jev: {} }, chosen: ['claude'] } }, content: CONTENT });
  for (const target of MENU_TARGETS) {
    // A thing's own name keeps its capitals ("the Portrait of …" is a rift's name).
    const named = [...PENDING_NAMES, ...String(target.label || '').split(/\s+/).filter((w) => /^\p{Lu}/u.test(w))];
    for (const item of menus.optionsFor(target, ctx)) {
      assertCalm(item.label, `${target.kind}: ${item.label}`, { proper: named });
      if (item.why) assertCalm(item.why, `${target.kind}: why`, { proper: PENDING_NAMES });
    }
  }
});

test('what every builder shows reads calm: no exclamation marks, no please, curly quotes, cosy words', () => {
  let state = fresh();
  state = kindleStart(state, T, { economy: CONTENT.economy, xp: CONTENT.xp }).state;
  state = kindleTick(state, T + FOCUS_MS + MIN, { economy: CONTENT.economy, xp: CONTENT.xp }).state;
  state = noteFight(state, T, { id: 'fight:1', at: T, where: 'The Crowded Crypt', outcome: 'offline', rounds: 4, xp: 40, marks: 2, summary: 'Everyone went offline. Everyone’s fine.' });
  const opened = handOut({ ...state, story: { ...state.story, prologue: { done: { 'first-crack': T } } } }, CONTENT.trails, 'chest', T).state;
  const builds = {
    log: log.buildLog(log.logView({ lines: [], combat: true })),
    kindle: kindleUi.buildKindle(kindleUi.kindlePanelView(state, T + FOCUS_MS + MIN, { content: CONTENT })),
    kindleIdle: kindleUi.buildKindle(kindleUi.kindlePanelView(fresh(), T, { content: CONTENT })),
    kindleStart: kindleUi.buildKindle(kindleUi.kindlePanelView(state, T + FOCUS_MS + MIN, { confirming: 'start' })),
    chronicle: chronicleView.buildChronicle(chronicleView.chronicleView(state, T + FOCUS_MS + 2 * MIN)),
    chronicleEmpty: chronicleView.buildChronicle(chronicleView.chronicleView(fresh(), T)),
    skills: skillsUi.buildSkills(skillsUi.skillsPanelView(state, CONTENT, { open: 'cartography' })),
    trail: trailUi.buildTrail(trailUi.trailPanelView(opened, CONTENT.trails, T)),
    trailNone: trailUi.buildTrail(trailUi.trailPanelView(fresh(), CONTENT.trails, T)),
    satchel: satchelUi.buildSatchel(satchelUi.satchelView(state, CONTENT)),
    hud: hud.buildHud(hud.hudView({ state, now: T, area: { area: 'elsewhere' } })),
    hudSettings: hud.buildHudSettings({}),
  };
  for (const [where, html] of Object.entries(builds)) assertCalmText(html, where);
});

/* ------------------------------------------------------------------ menus */

// Everything Chris can point at, with the shapes the engine and the shell hand over.
const MENU_TARGETS = [
  { kind: 'milo', id: 'milo' }, { kind: 'crew', id: 'claude', label: 'Claude' }, { kind: 'crew', id: 'ollama' },
  { kind: 'party', id: 'party:codex' }, { kind: 'party', id: 'party:claude', unchained: true },
  { kind: 'place', id: 'watchtower', label: 'Watchtower' }, { kind: 'gate', id: 'gate:n' }, { kind: 'war-table', id: 'war-table' },
  { kind: 'rift', id: 'rift:abc' }, { kind: 'rift', id: 'rift:boss', fieldBoss: true }, { kind: 'echo', id: 'echo:rift:abc' },
  { kind: 'lantern', id: 'lantern:3,4' }, { kind: 'lantern', id: 'lantern:5,6', lit: true },
  { kind: 'poi', id: 'poi:ruin:1,2', label: 'An old ruin' }, { kind: 'poi', id: 'poi:statue:1,2' }, { kind: 'poi', id: 'poi:chest:1,2', label: 'A chest' },
  { kind: 'poi', id: 'poi:cave:1,2', label: 'A cave' }, { kind: 'tree', id: 'tree:1,2' }, { kind: 'rock', id: 'rock:1,2' }, { kind: 'bush', id: 'bush:1,2' },
  stray('crawler'), { kind: 'stray', id: 'stray:rift:abc:lead', fieldBoss: true }, { kind: 'tale-lead', id: 'tale-lead' },
  { kind: 'stray', id: 'enc:room-2:u1', foe: 'unwritten' }, { kind: 'stray', id: 'enc:room-3:u1', foe: 'tollmen' },
  { kind: 'exit', id: 'exit' }, { kind: 'stitch', id: 'stitch' }, { kind: 'loot', id: 'loot:1' }, { kind: 'loot', id: 'loot:2', locked: true },
  { kind: 'loot', id: 'loot:3', opened: true }, { kind: 'curio', id: 'curio' }, { kind: 'nook', id: 'nook' },
  { kind: 'landmark', id: 'landmark:last-bridge' }, { kind: 'landmark', id: 'landmark:tollkeeper' },
  { kind: 'combatant', id: 'cb:beetle', label: 'Glitch beetle' }, { kind: 'ground', id: 'ground', tile: { x: 1, y: 2 } },
  { kind: 'rift-row', id: 'rift:abc', label: 'The Portrait of a waiting session' },
];

test('every menu puts the left-click default first and Examine last, once, in the { id, label, disabled, why } shape', () => {
  const ctx = menus.menuContext({ state: fresh(), content: CONTENT });
  const fight = { ...ctx, combat: true };
  for (const context of [ctx, fight]) {
    for (const target of MENU_TARGETS) {
      const options = menus.optionsFor(target, context);
      assert.ok(options.length >= 2, `${target.kind} has options`);
      assert.equal(options[0].id, 'default', `${target.kind}: the left-click default comes first`);
      assert.equal(options.at(-1).id, 'examine', `${target.kind}: Examine is last`);
      assert.equal(options.at(-1).label, 'Examine');
      assert.equal(options.filter((o) => o.id === 'examine').length, 1, `${target.kind}: Examine once`);
      for (const item of options) {
        assert.deepEqual(Object.keys(item), ['id', 'label', 'disabled', 'why'], `${target.kind}: the option's shape`);
        assert.equal(typeof item.disabled, 'boolean');
        assert.ok(item.disabled ? typeof item.why === 'string' && item.why : item.why === null, `${target.kind}: a greyed option says why, an open one doesn't`);
      }
      if (context.combat) assert.ok(!options.some((o) => /^field-|^challenge$/.test(o.id)), `${target.kind}: no field skills or Challenge in a fight`);
    }
  }
  // A Log line has no Examine: only what it can show or do.
  assert.deepEqual(menus.optionsFor({ kind: 'log-line', detail: ['More.'], action: { id: 'panel:chronicle', label: 'Open the Chronicle' } }, ctx).map((o) => o.id), ['default', 'log-action']);
  assert.deepEqual(menus.optionsFor({ kind: 'log-line', detail: null, action: null }, ctx), []);
  assert.deepEqual(menus.optionsFor(null, ctx), []);
});

test('greyed field skills name who could: “Pick lock (the Artificer, at camp)”', () => {
  const party = (chosen, roster = ['milo', 'claude', 'codex', 'jev']) => menus.menuContext({ state: { party: { roster: Object.fromEntries(roster.map((id) => [id, {}])), chosen } }, content: CONTENT });
  const locked = { kind: 'loot', id: 'loot:1', locked: true };
  const atCamp = menus.optionsFor(locked, party(['claude', 'jev'])).find((o) => o.id === 'field-pick');
  assert.deepEqual(atCamp, { id: 'field-pick', label: 'Pick lock (the Artificer, at camp)', disabled: true, why: 'The Artificer can do this, but they’re at camp. Bring them along at the muster.' });
  const out = menus.optionsFor(locked, party(['codex'])).find((o) => o.id === 'field-pick');
  assert.deepEqual(out, { id: 'field-pick', label: 'Pick lock (the Artificer)', disabled: false, why: null });
  // Jev sorts chests; the Scribe reads ruins and statues and listens to the Unwritten; the Tollkeeper trades riddles.
  assert.equal(menus.optionsFor({ kind: 'poi', id: 'poi:chest:1,2' }, party(['jev'])).find((o) => o.id === 'field-sort').label, 'Check for a Mimic (Jev)');
  assert.equal(menus.optionsFor({ kind: 'poi', id: 'poi:ruin:1,2' }, party([])).find((o) => o.id === 'field-read').label, 'Read the glyphs (the Scribe, at camp)');
  assert.equal(menus.optionsFor({ kind: 'stray', id: 'enc:r:u', foe: 'unwritten' }, party(['claude'])).find((o) => o.id === 'field-read').label, 'Listen (the Scribe)');
  const toll = menus.optionsFor({ kind: 'stray', id: 'enc:r:u', foe: 'tollmen' }, party(['claude'])).find((o) => o.id === 'field-riddle');
  assert.deepEqual([toll.label, toll.disabled, toll.why], ['Trade riddles (the Tollkeeper, not in the Company yet)', true, 'The Tollkeeper could do this, but hasn’t joined the Company yet.']);
  assert.equal(menus.optionsFor({ kind: 'stray', id: 'enc:r:u', foe: 'tollmen' }, party(['tollkeeper'], ['milo', 'claude', 'codex', 'jev', 'tollkeeper'])).find((o) => o.id === 'field-riddle').disabled, false);
  // Milo always carries the lantern: Light is never greyed.
  assert.deepEqual(menus.optionsFor({ kind: 'lantern', id: 'lantern:1,2' }, party([])).find((o) => o.id === 'field-light'), { id: 'field-light', label: 'Light it (Milo)', disabled: false, why: null });
  assert.equal(menus.optionsFor({ kind: 'lantern', id: 'lantern:1,2', lit: true }, party([])).some((o) => o.id === 'field-light'), false, 'a lit lantern needs no lighting');
  // The five Phase 4 skills belong to the companions whose files name them; the other ten are data only and never offered.
  for (const [idOf, file] of Object.entries(companions)) {
    const skill = menus.FIELD_SKILLS[file.fieldSkill];
    assert.ok(skill, `${idOf}’s ${file.fieldSkill} is listed`);
    assert.equal(skill.who, idOf);
    assert.equal(skill.phase4, file.joins.phase <= 4, `${file.fieldSkill} ships with its companion`);
  }
  assert.equal(Object.keys(menus.FIELD_SKILLS).length, 15);
  const offered = new Set(MENU_TARGETS.flatMap((t) => menus.optionsFor(t, party(['claude', 'codex', 'jev']))).map((o) => o.id).filter((o) => o.startsWith('field-')));
  assert.deepEqual([...offered].sort(), ['field-light', 'field-pick', 'field-read', 'field-riddle', 'field-sort']);
});

test('the hover tip reads “first / n more options”', () => {
  assert.equal(menus.tipText(menus.optionsFor({ kind: 'tree', id: 'tree:1,2' })), 'Chop the tree / 1 more option');
  assert.equal(menus.hoverTip({ kind: 'lantern', id: 'lantern:1,2' }, menus.menuContext()), 'Go to the lantern / 2 more options');
  assert.equal(menus.tipText([{ id: 'default', label: 'Travel home' }]), 'Travel home');
  assert.equal(menus.tipText([]), '');
});

test('the menu holds only its items: its title names it from outside, and a greyed option’s reason sits after it', () => {
  const ctx = menus.menuContext({ state: { party: { roster: { milo: {}, claude: {}, codex: {}, jev: {} }, chosen: ['claude'] } }, content: CONTENT });
  const html = menus.buildMenu({ title: 'A locked chest', options: menus.optionsFor({ kind: 'loot', id: 'loot:1', locked: true }, ctx) });
  const [title, rest] = html.split('<div class="menu-items" role="menu" aria-labelledby="context-menu-title">');
  const [menu, whys] = rest.split('<div class="sr-only menu-whys">');
  assert.equal(title, '<p class="menu-title" id="context-menu-title">A locked chest</p>', 'the title sits above the menu, and names it');
  // Inside: menuitems, and role=group wrappers whose own names are aria-hidden (aria-labelledby names the group).
  assert.equal(menu.replace(/<button [^>]*role="menuitem"[^>]*>[^<]*<\/button>|<div class="menu-group" role="group"[^>]*><p [^>]*aria-hidden="true">[^<]*<\/p>|<\/div>/g, ''), '');
  const described = [...menu.matchAll(/aria-describedby="(menu-why-\d+)"/g)].map((m) => m[1]);
  assert.equal(described.length, 2, 'the Artificer’s and Jev’s reasons');
  for (const idOf of described) assert.match(whys, new RegExp(`<span id="${idOf}">[^<]+</span>`), 'each is there, after the menu');
  const count = (text, re) => (text.match(re) || []).length;
  assert.ok(menu.endsWith('</div>') && count(menu, /<\/div>/g) === count(menu, /<div\b/g) + 1 && /^(<span id="menu-why-\d+">[^<]+<\/span>)+<\/div>$/.test(whys), 'the menu closes before its reasons, which sit outside it');
  const plain = menus.buildMenu({ options: menus.optionsFor({ kind: 'tree', id: 'tree:1,2' }) });
  assert.ok(plain.startsWith(`<div class="menu-items" role="menu" aria-label="${menus.MENU_NAME}">`) && !plain.includes('menu-whys'), 'no title: a name of its own');
  assertCalm(menus.MENU_NAME, 'the menu’s name');
});

test('keyboard maps are pure tables that never take Tab, [ or ]', () => {
  const tables = { MENU_KEYS: menus.MENU_KEYS, COMMAND_KEYS: log.COMMAND_KEYS, TAB_KEYS: log.TAB_KEYS, LINE_KEYS: log.LINE_KEYS };
  for (const [name, table] of Object.entries(tables)) {
    assert.ok(Object.isFrozen(table), `${name} is a frozen table`);
    for (const key of ['Tab', '[', ']']) assert.ok(!Object.hasOwn(table, key), `${name} leaves ${key} alone`);
    for (const value of Object.values(table)) assert.equal(typeof value, 'string');
  }
  const key = (k, mods = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  assert.deepEqual([key('ArrowDown'), key('Escape'), key('Tab'), key('ArrowDown', { ctrlKey: true })].map(menus.menuKey), ['next', 'close', null, null], 'a modifier key is the system’s');
  assert.deepEqual([key('ContextMenu'), key('F10', { shiftKey: true }), key('F10'), key('F10', { shiftKey: true, ctrlKey: true })].map(menus.opensMenu), [true, true, false, false]);
  assert.deepEqual([menus.stepIndex('next', 2, 3), menus.stepIndex('prev', 0, 3), menus.stepIndex('first', 2, 3), menus.stepIndex('last', 0, 3), menus.stepIndex('next', -1, 3)], [0, 2, 0, 2, 0]);
  assert.deepEqual([log.keyAction(log.COMMAND_KEYS, key('Enter')), log.keyAction(log.COMMAND_KEYS, key('Enter', { shiftKey: true })), log.keyAction(log.LINE_KEYS, key(' '))], ['run', null, 'toggle']);
  assert.deepEqual([log.moveIndex('next', 4, 5), log.moveIndex('prev', 0, 5), log.moveIndex('last', 0, 5)], [4, 0, 4], 'tabs and lines stop at the ends');
});

test('a menu stays inside a 1000×700 window and under the title bar', () => {
  const view = { width: 1000, height: 700 };
  const size = { width: 200, height: 160 };
  for (const at of [{ x: 10, y: 10 }, { x: 990, y: 690 }, { x: 500, y: 350 }, { x: 999, y: 40 }, null]) {
    const p = menus.placeMenu(at, size, view);
    assert.ok(p.left >= 8 && p.left + size.width <= 992, `inside sideways at ${JSON.stringify(at)}`);
    assert.ok(p.top >= 36 && p.top + size.height <= 692, `inside up and down at ${JSON.stringify(at)}`);
  }
  assert.deepEqual(menus.placeMenu({ x: 300, y: 200 }, size, view), { left: 302, top: 202 }, 'beside the pointer when it fits');
});

test('a DOM element becomes its menu’s target: crew chips, place-list buttons, rift rows and Log lines', () => {
  const el = (attrs, text = '', extra = {}) => ({ getAttribute: (n) => attrs[n] ?? null, textContent: text, closest: () => null, ...extra });
  assert.deepEqual(menus.targetOfElement(el({ 'data-crew': 'claude' }, 'Claude')), { kind: 'crew', id: 'claude', label: 'Claude' });
  assert.deepEqual(menus.targetOfElement(el({ 'data-place': 'watchtower' }, 'Watchtower')), { kind: 'place', id: 'watchtower', label: 'Watchtower' });
  assert.equal(menus.targetOfElement(el({ 'data-entity': 'cb:beetle', 'data-kind': 'combatant' }, 'Glitch beetle')).kind, 'combatant');
  assert.equal(menus.targetOfElement(el({ 'data-entity': 'home' }, 'Travel home')).kind, 'home');
  const line = { text: 'Hello.', detail: ['More.'], action: null, open: false };
  assert.deepEqual(menus.targetOfElement(el({ 'data-line': '7' }), { lines: (n) => (n === 7 ? line : null) }),
    { kind: 'log-line', id: 'line:7', detail: ['More.'], action: null, open: false, label: 'Hello.' });
  const row = { getAttribute: (n) => ({ 'data-rift-id': 'rift:abc', 'data-rift-kind': 'wild' })[n] ?? null, querySelector: () => ({ textContent: 'The Portrait' }) };
  assert.deepEqual(menus.targetOfElement(el({}, 'Step through', { closest: () => row })), { kind: 'rift-row', id: 'rift:abc', label: 'The Portrait', riftKind: 'wild' });
  assert.deepEqual(menus.entityOfTarget({ kind: 'rift-row', id: 'rift:abc', label: 'The Portrait' }), { kind: 'rift', id: 'rift:abc', label: 'The Portrait' });
  // Each default is what a click on the thing does: a closed row has none, a stump and a gate are looked at, a canvas place is named.
  const closed = menus.targetOfElement(el({}, 'x', { closest: () => ({ ...row, classList: { contains: (c) => c === 'closed' } }) }));
  assert.deepEqual(menus.optionsFor(closed).map((o) => o.id), ['examine']);
  assert.equal(menus.optionsFor({ kind: 'tree', id: 'tree:1,2', felled: true })[0].label, 'Look at the stump');
  assert.deepEqual([examine.examineKey({ kind: 'tree', id: 'tree:1,2', felled: true }), examine.examineTitle({ kind: 'tree', felled: true })], [{ group: 'poi', id: 'stump', variant: null }, 'A stump']);
  assert.ok(examine.linesFor({ group: 'poi', id: 'stump' }, CONTENT).length >= 3, 'Phase 3’s stump lines');
  assert.equal(menus.optionsFor({ kind: 'gate', id: 'gate:n' })[0].label, 'Look at the gate');
  assert.equal(menus.optionsFor(menus.targetOfHit({ kind: 'place', id: 'camp', entity: null }))[0].label, 'Go to Milo’s camp');
  assert.equal(examine.examineTitle({ kind: 'place', id: 'plot-meadow' }), 'Long meadow');
  assert.equal(menus.optionsFor({ kind: 'ground', tile: { x: 1, y: 2 } }, { ...menus.menuContext(), combat: true })[0].label, 'Choose this tile');
});

test('runOption examines, opens sheets, chains followers and walks, and leaves the rest to the shell', () => {
  const { shell, calls } = stubShell();
  assert.equal(menus.runOption(shell, { id: 'company', disabled: false }, { kind: 'party', id: 'party:codex' }), true);
  assert.deepEqual(calls.panels.at(-1), ['company:codex', null]);
  assert.equal(menus.runOption(shell, { id: 'unchain', disabled: false }, { kind: 'party', id: 'party:codex' }), true);
  assert.deepEqual(calls.world.at(-1), ['chain', 'codex', false]);
  assert.equal(menus.runOption(shell, { id: 'default', disabled: false }, { kind: 'tree', id: 'tree:1,2' }), true);
  assert.deepEqual(calls.world.at(-1), ['walkToEntity', 'tree:1,2']);
  // A canvas entity walks as the canvas's own click does (walkToEntity(hit.entity)); a vale place
  // opens its panel and walks there, as its place-list button does; a canvas crew member's card is the shell's.
  const pine = { kind: 'tree', id: 'tree:4,5', x: 4, y: 5, label: 'Pine · chop', wood: 'pine', felled: false };
  const go = (target) => menus.runOption(shell, { id: 'default', disabled: false }, target);
  assert.deepEqual([go(pine), calls.world.at(-1)], [true, ['walkToEntity', pine]]);
  assert.deepEqual([go(menus.targetOfHit({ kind: 'place', id: 'watchtower', entity: null })), calls.panels.at(-1)], [true, ['watchtower', { walk: true }]]);
  const worldCalls = calls.world.length;
  assert.deepEqual([go(menus.targetOfHit({ kind: 'crew', id: 'claude' })), calls.world.length], [false, worldCalls], 'nothing walks for a crew member');
  let clicked = 0;
  assert.equal(menus.runOption(shell, { id: 'default', disabled: false }, { kind: 'crew', id: 'claude' }, { source: { click: () => { clicked += 1; } } }), true);
  assert.equal(clicked, 1, 'a button’s default is its own click');
  assert.equal(menus.runOption(shell, { id: 'examine', disabled: false }, { kind: 'tree', id: 'tree:1,2' }), true);
  assert.equal(calls.bubbles.at(-1).kind, 'note');
  for (const idOf of ['field-pick', 'challenge']) assert.equal(menus.runOption(shell, { id: idOf, disabled: false }, { kind: 'loot', id: 'loot:1' }), false, `${idOf} is the shell’s`);
  assert.equal(menus.runOption(shell, { id: 'field-pick', disabled: true }, { kind: 'loot', id: 'loot:1' }), false, 'a greyed option does nothing');
  assert.equal(menus.runOption(shell, { id: 'default', disabled: false }, { kind: 'ground', tile: { x: 1, y: 1 } }, { combat: true }), false, 'nothing walks in a fight');
});

/** A fake document with #context-menu (its buttons parsed from innerHTML), #stage and canvas#world 32 px down. */
function menuDom({ mode = 'explore' } = {}) {
  const listeners = new Map();
  const cache = new Map();
  const dom = { active: null, listeners };
  const root = {
    innerHTML: '', hidden: true, style: {}, attrs: {},
    setAttribute(n, v) { this.attrs[n] = v; }, removeAttribute(n) { delete this.attrs[n]; },
    getBoundingClientRect: () => ({ width: 200, height: 120 }),
    addEventListener(type, fn) { listeners.set(`root:${type}`, fn); }, removeEventListener(type) { listeners.delete(`root:${type}`); },
    querySelectorAll() {
      if (!cache.has(this.innerHTML)) cache.set(this.innerHTML, buttons(this.innerHTML).map((attrs) => ({ attrs, getAttribute: (n) => attrs[n] ?? null, focus() { dom.active = this; }, closest() { return this; } })));
      return cache.get(this.innerHTML);
    },
    contains(el) { return this.querySelectorAll().includes(el); },
  };
  const before = globalThis.document;
  const elements = { 'context-menu': root, stage: { dataset: { mode } }, world: { getBoundingClientRect: () => ({ left: 0, top: 32 }) } };
  globalThis.document = {
    documentElement: { dataset: {} }, get activeElement() { return dom.active; }, getElementById: (idOf) => elements[idOf] ?? null,
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
  };
  const pick = (i) => listeners.get('root:click')({ target: root.querySelectorAll().at(i), preventDefault() {} });
  return Object.assign(dom, { root, pick, restore: () => { globalThis.document = before; } });
}

test('the context menu opens beside the pointer, moves by its keys, closes on Escape, and hands each choice to the shell first', () => {
  const dom = menuDom();
  const { root: menuRoot, listeners: docListeners } = dom;
  const stub = stubShell();
  const chosen = [];
  try {
    const handle = menus.mount(stub.shell, { choose: (option) => { chosen.push(option.id); return option.id === 'field-pick'; } });
    assert.equal(handle.open({ kind: 'loot', id: 'loot:1', locked: true, label: 'A locked chest' }, { x: 300, y: 200 }), true);
    assert.deepEqual([menuRoot.hidden, menuRoot.style.left, menuRoot.style.top], [false, '302px', '202px']);
    // The container is plain: the role=menu is inside it, named by the title above it.
    assert.deepEqual([menuRoot.attrs.role, menuRoot.attrs['aria-labelledby']], [undefined, undefined]);
    assert.ok(menuRoot.innerHTML.startsWith('<p class="menu-title" id="context-menu-title">A locked chest</p><div class="menu-items" role="menu" aria-labelledby="context-menu-title">'));
    const items = menuRoot.querySelectorAll();
    assert.deepEqual(items.map((i) => i.attrs['data-option']), ['default', 'field-pick', 'field-sort', 'examine']);
    assert.equal(dom.active, items[0], 'focus starts on the first option');
    assert.equal(stub.keys().length, 1, 'the open menu is on top of the key stack');
    const press = (key) => stub.keys()[0]({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} });
    assert.deepEqual([press('ArrowDown'), dom.active], [true, items[1]]);
    assert.deepEqual([press('ArrowUp') && press('ArrowUp'), dom.active], [true, items[3]], 'up from the first wraps to Examine');
    assert.equal(press('Tab'), false, 'Tab is left alone');
    assert.deepEqual([press('Escape'), handle.isOpen(), menuRoot.hidden], [true, false, true]);
    assert.equal(stub.keys().length, 0, 'closing pops the key stack');
    // A choice goes to the shell first; what it leaves, runOption does.
    handle.open({ kind: 'loot', id: 'loot:1', locked: true, label: 'A locked chest' }, { x: 10, y: 10 });
    docListeners.get('root:click')({ target: menuRoot.querySelectorAll()[1], preventDefault() {} });
    assert.deepEqual(chosen, ['field-pick']);
    assert.equal(handle.isOpen(), false);
    handle.open({ kind: 'tree', id: 'tree:1,2', label: 'An old oak' }, { x: 10, y: 10 });
    docListeners.get('root:click')({ target: menuRoot.querySelectorAll().at(-1), preventDefault() {} });
    assert.deepEqual(chosen, ['field-pick', 'examine']);
    assert.equal(stub.calls.bubbles.at(-1).kind, 'note', 'the shell left Examine to runOption, which opened the note');
    // A greyed option does nothing, and the menu stays open.
    stub.shell.set({ ...stub.shell.state, party: { ...stub.shell.state.party, chosen: ['claude'] } });
    handle.open({ kind: 'loot', id: 'loot:1', locked: true }, { x: 10, y: 10 });
    const pick = menuRoot.querySelectorAll()[1];
    assert.equal(pick.attrs['aria-disabled'], 'true');
    docListeners.get('root:click')({ target: pick, preventDefault() {} });
    assert.deepEqual(chosen, ['field-pick', 'examine']);
    assert.equal(handle.isOpen(), true);
    handle.close();
    // A right-click on a crew chip, and the ContextMenu key on a place-list button, open theirs.
    const chip = { getAttribute: (n) => ({ 'data-crew': 'claude' })[n] ?? null, textContent: 'Claude', closest() { return this; }, getBoundingClientRect: () => ({ left: 20, bottom: 40 }), focus() {} };
    let prevented = 0;
    docListeners.get('contextmenu')({ target: chip, clientX: 40, clientY: 50, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1);
    assert.equal(handle.isOpen(), true);
    assert.equal(menuRoot.querySelectorAll()[0].attrs['data-option'], 'default');
    handle.close();
    dom.active = { getAttribute: (n) => ({ 'data-place': 'watchtower' })[n] ?? null, textContent: 'Watchtower', closest() { return this; }, getBoundingClientRect: () => ({ left: 20, bottom: 600 }), focus() {} };
    docListeners.get('keydown')({ key: 'F10', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    assert.equal(handle.isOpen(), true, 'Shift+F10 opens the focused thing’s menu');
    handle.dispose();
    assert.equal(docListeners.has('contextmenu'), false, 'dispose takes its listeners away');
  } finally {
    dom.restore();
  }
});

test('in a fight a combatant’s menu lists the hero’s actions, Examine reads the live battle however it opened, and canvas menus sit at the pointer', () => {
  const beetle = { id: 'f0', name: 'Glitch beetle', side: 'foe', rank: 'stray', archetype: 'crawler', resist: { static: 3 }, weak: { warp: 3 }, temperament: 'curious', examined: false };
  const battle = { id: 'fight:1', units: [{ id: 'pip', name: 'Pip', side: 'party', rank: 'hero' }, beetle] };
  const legal = [{ action: { id: 'stride', cost: 1 }, words: 'Stride', targets: 'path', why: null }, { action: { id: 'strike', cost: 1 }, words: 'Strike', targets: [{ unit: 'f0' }], why: null },
    { action: { id: 'examine', cost: 1 }, words: 'Examine', targets: [{ unit: 'f0' }], why: null }, { action: { id: 'assist', cost: 1 }, words: 'Assist', targets: [{ units: ['pip', 'f0'] }], why: null },
    { action: { id: 'shove', cost: 1 }, words: 'Shove', targets: [], why: 'Nothing beside you' }];
  const ctx = menus.menuContext({ state: fresh(), content: CONTENT, combat: true, battle, actions: { hero: 'The Scribe', list: legal } });
  const options = menus.optionsFor({ kind: 'combatant', id: 'cb:f0', label: 'Glitch beetle' }, ctx);
  assert.deepEqual(options.map((o) => o.label), ['Strike glitch beetle', 'Examine glitch beetle', 'Assist Pip on glitch beetle', 'Examine']);
  assert.equal(menus.tipText(options), 'Strike glitch beetle / 3 more options', 'COMBAT §13’s tip, and the default is the left click’s Strike');
  assert.deepEqual([options[1].id, options[1].group, options[1].act], ['act:2', 'For the Scribe', { index: 2, unit: 'f0', action: { id: 'examine', cost: 1, target: { unit: 'f0' } } }]);
  assert.match(menus.buildMenu({ options }), /<div class="menu-group" role="group" aria-labelledby="menu-group-1"><p class="menu-group-title" id="menu-group-1" aria-hidden="true">For the Scribe<\/p>/);
  assert.equal(menus.runOption(stubShell().shell, options[1], { kind: 'combatant', id: 'cb:f0' }), false, 'planning an action is the shell’s');
  assert.equal(menus.optionsFor({ kind: 'combatant', id: 'cb:pip' }, ctx)[0].label, 'Select Pip');
  assert.equal(menus.optionsFor({ kind: 'combatant', id: 'cb:f0' }, { ...ctx, actions: null })[0].label, 'Target glitch beetle', 'no slot in hand: a click targets it');
  for (const text of [...options.map((o) => o.label), options[1].group, 'Choose this tile', 'Look at the stump']) assertCalm(text, text, { proper: PENDING_NAMES });
  const dom = menuDom({ mode: 'combat' });
  const stub = stubShell();
  try {
    const handle = menus.mount(stub.shell, { battle: () => battle, actions: () => ({ hero: 'Pip', list: legal }) });
    // The place list's cb: entry, opened by the ContextMenu key: Examine reads the battle through options.battle.
    dom.active = { getAttribute: (n) => ({ 'data-entity': 'cb:f0', 'data-kind': 'combatant' })[n] ?? null, textContent: 'Glitch beetle', closest() { return this; }, getBoundingClientRect: () => ({ left: 20, bottom: 600 }), focus() {} };
    dom.listeners.get('keydown')({ key: 'ContextMenu', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    assert.deepEqual(dom.root.querySelectorAll().map((i) => i.attrs['data-option']), ['default', 'act:2', 'act:3', 'examine']);
    dom.pick(-1);
    assert.ok(stub.calls.bubbles.at(-1).lines[0].endsWith(examine.UNEXAMINED_LINE), 'not Examined yet: a look, no numbers');
    beetle.examined = true;
    handle.open({ kind: 'combatant', id: 'cb:f0', label: 'Glitch beetle' }, { x: 10, y: 10 });
    dom.pick(-1);
    assert.deepEqual(stub.calls.bubbles.at(-1).lines, ['Resists Static 3. Weak to Warp 3. Curious.']);
    // The engine's px are the canvas's own: openHit adds where canvas#world sits (under the 32 px title bar), and names the place.
    assert.equal(handle.openHit({ kind: 'place', id: 'watchtower', entity: null, x: 300, y: 200 }), true);
    assert.deepEqual([dom.root.style.left, dom.root.style.top, dom.root.innerHTML.includes('>Watchtower</p>')], ['302px', '234px', true]);
    handle.dispose();
  } finally { dom.restore(); }
});

/* ------------------------------------------------------------------ Examine */

const SKY_DAY = skyAt(new Date(2026, 6, 1, 13, 0).getTime(), { sky: CONTENT.sky });
const SKY_NIGHT = skyAt(new Date(2026, 0, 10, 23, 0).getTime(), { sky: CONTENT.sky });

test('examineKey follows §9.12’s table, row by row', () => {
  const k = (entity, opts = {}) => examine.examineKey(entity, opts);
  const rows = [
    // Milo, a crew member, a party follower, the Tollkeeper → company, the member id
    [{ kind: 'milo', id: 'milo' }, { group: 'company', id: 'milo', variant: null }],
    [{ kind: 'crew', id: 'codex' }, { group: 'company', id: 'codex', variant: null }],
    [{ kind: 'party', id: 'party:claude' }, { group: 'company', id: 'claude', variant: null }],
    [{ kind: 'party', id: 'party:reg-glitch-beetle' }, { group: 'company', id: 'regular', variant: null }],
    [{ kind: 'landmark', id: 'landmark:tollkeeper' }, { group: 'company', id: 'tollkeeper', variant: null }],
    // a vale place → vale or camp, the place kind
    [{ kind: 'place', id: 'camp' }, { group: 'camp', id: 'camp', variant: null }],
    [{ kind: 'place', id: 'watchtower' }, { group: 'vale', id: 'watchtower', variant: null }],
    [{ kind: 'place', id: 'plot-meadow' }, { group: 'vale', id: 'plot', variant: null }],
    [{ kind: 'place', id: 'plot-meadow', built: true }, { group: 'vale', id: 'building', variant: null }],
    [{ kind: 'place', id: 'harbor' }, { group: 'vale', id: 'fog', variant: null }],
    [{ kind: 'place', id: 'hearth' }, { group: 'camp', id: 'hook', variant: null }],
    [{ kind: 'gate', id: 'gate:n' }, { group: 'vale', id: 'gate', variant: null }],
    [{ kind: 'war-table', id: 'war-table' }, { group: 'vale', id: 'war-table', variant: null }],
    [{ kind: 'campfire', id: 'campfire' }, { group: 'camp', id: 'campfire', variant: null }],
    [{ kind: 'place', id: 'bell', placeKind: 'bell' }, { group: 'vale', id: 'bell', variant: null }],
    // a lantern → wilds, lantern (lit when lit)
    [{ kind: 'lantern', id: 'lantern:1,2' }, { group: 'wilds', id: 'lantern', variant: null }],
    [{ kind: 'lantern', id: 'lantern:1,2', lit: true }, { group: 'wilds', id: 'lantern', variant: 'lit' }],
    // a wild POI → poi, its kind (Phase 3's wilds.examine)
    [{ kind: 'poi', id: 'poi:ruin:1,2' }, { group: 'poi', id: 'ruin', variant: null }],
    [{ kind: 'poi', id: 'poi:cave:1,2' }, { group: 'poi', id: 'cave', variant: null }],
    [{ kind: 'poi', id: 'poi:chest:1,2', opened: true }, { group: 'poi', id: 'chest', variant: 'opened' }],
    [{ kind: 'poi', id: 'poi:chest:1,2', label: 'An open chest', poiType: 'chest', mimic: false }, { group: 'poi', id: 'chest', variant: 'opened' }],
    [{ kind: 'poi', id: 'poi:chest:1,2', label: 'An old chest', poiType: 'chest', mimic: false }, { group: 'poi', id: 'chest', variant: null }],
    // a tree, rock or bush → wilds, its place kind
    [{ kind: 'tree', id: 'tree:1,2', look: 'tree.birch' }, { group: 'wilds', id: 'birch', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', look: 'pine.snow' }, { group: 'wilds', id: 'pine', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', look: 'tree.blossom' }, { group: 'wilds', id: 'tree', variant: SKY_DAY.season }, { sky: SKY_DAY }],
    [{ kind: 'rock', id: 'rock:1,2', look: 'rock.basalt' }, { group: 'wilds', id: 'rock', variant: null }],
    [{ kind: 'bush', id: 'bush:1,2', look: 'bush.berry' }, { group: 'wilds', id: 'bush', variant: null }],
    // ... and as wilds.js hands trees over: { kind, id, label, wood, felled }, with no sprite kind.
    [{ kind: 'tree', id: 'tree:1,2', label: 'Pine · chop', wood: 'pine', felled: false }, { group: 'wilds', id: 'pine', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', label: 'Snowy pine · chop', wood: 'pine', felled: false }, { group: 'wilds', id: 'pine', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', label: 'Birch tree · chop', wood: 'birch', felled: false }, { group: 'wilds', id: 'birch', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', label: 'Ash tree · chop', wood: 'ash', felled: false }, { group: 'wilds', id: 'tree', variant: SKY_DAY.season }, { sky: SKY_DAY }],
    [{ kind: 'tree', id: 'tree:1,2', label: 'Blossom tree · chop', wood: 'ash', felled: false }, { group: 'wilds', id: 'tree', variant: SKY_NIGHT.season }, { sky: SKY_NIGHT }],
    // Its label alone, or its wood alone, is enough.
    [{ kind: 'tree', id: 'tree:1,2', label: 'Birch tree · chop' }, { group: 'wilds', id: 'birch', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', wood: 'pine' }, { group: 'wilds', id: 'pine', variant: null }], [{ kind: 'tree', id: 'tree:1,2', wood: 'birch', label: 'A tree' }, { group: 'wilds', id: 'birch', variant: null }],
    [{ kind: 'tree', id: 'tree:1,2', label: 'Stump', wood: 'pine', felled: true }, { group: 'poi', id: 'stump', variant: null }],
    // a rift, an echo → elsewhere, rift or echo
    [{ kind: 'rift', id: 'rift:abc' }, { group: 'elsewhere', id: 'rift', variant: null }],
    [{ kind: 'echo', id: 'echo:rift:abc' }, { group: 'elsewhere', id: 'echo', variant: null }],
    // a stray, an encounter post → creatures, its archetype (sleeping when sleepy)
    [stray('crawler'), { group: 'creatures', id: 'crawler', variant: null }],
    [stray('ghost', { temperament: 'sleepy' }), { group: 'creatures', id: 'ghost', variant: 'sleeping' }],
    [{ kind: 'stray', id: 'enc:room-2:u3', stray: { archetype: 'flier', temperament: 'shy' } }, { group: 'creatures', id: 'flier', variant: null }],
    // the Tale-lead, a field boss → foes, tale-lead
    [{ kind: 'tale-lead', id: 'tale-lead' }, { group: 'foes', id: 'tale-lead', variant: null }],
    [{ kind: 'stray', id: 'stray:rift:abc:lead' }, { group: 'foes', id: 'tale-lead', variant: null }],
    // a canon foe or cave creature → foes, its foes.json id
    [{ kind: 'stray', id: 'enc:room-1:u1', foe: 'hollow-sentries' }, { group: 'foes', id: 'hollow-sentries', variant: null }],
    [{ kind: 'foe', id: 'foe:mimic' }, { group: 'foes', id: 'mimic', variant: null }],
    // inside an Elsewhere → elsewhere, stitch / exit / chest (opened) / curio / nook
    [{ kind: 'stitch', id: 'stitch' }, { group: 'elsewhere', id: 'stitch', variant: null }],
    [{ kind: 'exit', id: 'exit' }, { group: 'elsewhere', id: 'exit', variant: null }],
    [{ kind: 'loot', id: 'loot:1' }, { group: 'elsewhere', id: 'chest', variant: null }],
    [{ kind: 'loot', id: 'loot:1', opened: true }, { group: 'elsewhere', id: 'chest', variant: 'opened' }],
    // ... and as scene-elsewhere.js hands chests over: an opened one says so only by its label.
    [{ kind: 'loot', id: 'loot', label: 'An open chest', riftId: 'rift:abc' }, { group: 'elsewhere', id: 'chest', variant: 'opened' }],
    [{ kind: 'loot', id: 'loot:0', label: 'A locked chest', riftId: 'cave:1,2' }, { group: 'elsewhere', id: 'chest', variant: null }],
    [{ kind: 'curio', id: 'curio' }, { group: 'elsewhere', id: 'curio', variant: null }],
    [{ kind: 'nook', id: 'nook' }, { group: 'elsewhere', id: 'nook', variant: null }],
    // the Last Bridge → things, last-bridge
    [{ kind: 'landmark', id: 'landmark:last-bridge' }, { group: 'things', id: 'last-bridge', variant: 'sleeping' }],
    [{ kind: 'last-bridge', id: 'landmark:last-bridge', dry: true }, { group: 'things', id: 'last-bridge', variant: 'opened' }],
    // a combatant → none (describe.examineLine)
    [{ kind: 'combatant', id: 'cb:beetle' }, null],
    // the sky, from empty ground → sky, the weather, the daypart
    [{ kind: 'ground', id: 'ground' }, { group: 'sky', id: SKY_NIGHT.weather.kind, variant: 'night' }, { sky: SKY_NIGHT }],
    // and the unique things
    [{ kind: 'hooklight', id: 'hooklight' }, { group: 'things', id: 'hooklight', variant: null }],
    [{ kind: 'riddle-note', id: 'note:first-trail-1' }, { group: 'things', id: 'riddle-note', variant: null }],
  ];
  for (const [entity, want, opts] of rows) assert.deepEqual(k(entity, opts), want, JSON.stringify(entity));
  // A lantern lit in the saved wilds, and a chest opened there, read their state from it too.
  const state = { wilds: { lanterns: { 'lantern:1,2': 5 }, opened: { 'poi:chest:1,2': 5 } } };
  assert.equal(k({ kind: 'lantern', id: 'lantern:1,2' }, { state }).variant, 'lit');
  assert.equal(k({ kind: 'poi', id: 'poi:chest:1,2' }, { state }).variant, 'opened');
  assert.equal(k(null), null);
});

test('every kind of thing reads real lines, and the Hooklight says its canon line', () => {
  const foes = CONTENT.combat.foes;
  const foeIds = [...(foes.canon || []).map((f) => f.id), ...(foes.creatures || []).map((f) => f.id), foes.mimic?.id].filter(Boolean);
  const entities = [
    ...examine.COMPANY_IDS.map((id) => ({ kind: 'crew', id })), { kind: 'party', id: 'party:reg-x' },
    ...examine.CAMP_KINDS.map((kind) => ({ kind, id: kind })), ...examine.VALE_KINDS.map((kind) => ({ kind, id: kind })),
    ...['camp', 'watchtower', 'plot-meadow', 'harbor', 'hearth'].map((id) => ({ kind: 'place', id })),
    { kind: 'lantern', id: 'lantern:1,2' }, { kind: 'lantern', id: 'lantern:1,2', lit: true },
    ...['ruin', 'cave', 'chest', 'note', 'hamlet', 'statue', 'landmark', 'quay', 'ore', 'herbs', 'fishing'].map((type) => ({ kind: 'poi', id: `poi:${type}:1,2` })),
    { kind: 'poi', id: 'poi:chest:1,2', opened: true }, { kind: 'poi', id: 'poi:ruin:1,2', opened: true }, { kind: 'poi', id: 'poi:landmark:9,9', label: 'The Westwatch' },
    ...['tree', 'rock', 'bush'].map((kind) => ({ kind, id: `${kind}:1,2` })), { kind: 'tree', id: 'tree:1,2', look: 'pine' }, { kind: 'tree', id: 'tree:1,2', look: 'tree.birch' },
    { kind: 'rift', id: 'rift:a' }, { kind: 'echo', id: 'echo:a' },
    ...examine.ARCHETYPE_IDS.flatMap((a) => [stray(a), stray(a, { temperament: 'sleepy' })]),
    { kind: 'tale-lead', id: 'tale-lead' }, ...foeIds.map((foe) => ({ kind: 'stray', id: `enc:r:${foe}`, foe })),
    ...['stitch', 'exit', 'curio', 'nook'].map((kind) => ({ kind, id: kind })), { kind: 'loot', id: 'l' }, { kind: 'loot', id: 'l', opened: true },
    { kind: 'landmark', id: 'landmark:last-bridge' }, { kind: 'landmark', id: 'landmark:last-bridge', dry: true },
    { kind: 'hooklight', id: 'hooklight' }, { kind: 'riddle-note', id: 'riddle-note' },
    // The engine's own shapes (wilds.js trees, scene-elsewhere.js's opened chest).
    { kind: 'tree', id: 'tree:3,4', label: 'Pine · chop', wood: 'pine', felled: false }, { kind: 'tree', id: 'tree:3,4', label: 'Birch tree · chop', wood: 'birch', felled: false },
    { kind: 'loot', id: 'loot', label: 'An open chest' },
  ];
  const skies = [SKY_DAY, SKY_NIGHT, ...[5, 7, 18, 20].map((h) => skyAt(new Date(2026, 3, 12, h, 20).getTime(), { sky: CONTENT.sky }))];
  for (const sky of skies) entities.push({ kind: 'ground', id: 'ground' }, { kind: 'tree', id: 'tree:9,9', look: 'tree' }, { kind: 'tree', id: 'tree:9,8', label: 'Ash tree · chop', wood: 'ash', felled: false });
  for (const [i, entity] of entities.entries()) {
    const sky = skies[i % skies.length];
    const key = examine.examineKey(entity, { sky });
    const pool = examine.linesFor(key, CONTENT);
    assert.ok(pool.length >= 1, `${JSON.stringify(entity)} → ${JSON.stringify(key)} has lines`);
    const line = examine.examineLine(entity, { content: CONTENT, sky });
    assert.ok(pool.includes(line), `${JSON.stringify(entity)} says one of its own lines`);
    assert.notEqual(line, examine.FALLBACK_LINE);
  }
  assert.equal(examine.examineLine({ kind: 'hooklight', id: 'hooklight' }, { content: CONTENT }), 'Lit from the Hook. The big one stays home, so home stays safe.');
});

test('the engine’s own trees read their own lines, and its opened and locked chests offer what a click would', () => {
  // Real trees from wilds.js, handed over as { kind: 'tree', id, label, wood, felled }, with no sprite kind.
  const wilds = createWilds({ worldgen: createWorldgen({ seed: 'hushlands', regionWords: CONTENT.wilds.regionWords }), maxChunks: 400 });
  const found = new Map();
  for (let i = 0; i < 169 && found.size < 3; i += 1) {
    const [cx, cy] = [(i % 13) - 6, Math.floor(i / 13) - 6];
    wilds.chunk(cx, cy);
    for (const e of wilds.entitiesIn({ x0: cx * 32, y0: cy * 32, x1: cx * 32 + 31, y1: cy * 32 + 31 }, {})) if (e.kind === 'tree' && !found.has(e.wood)) found.set(e.wood, e);
  }
  assert.deepEqual([...found.keys()].sort(), ['ash', 'birch', 'pine'], 'the hushlands grow all three woods');
  const winter = skyAt(new Date(2027, 0, 15, 12).getTime(), { sky: CONTENT.sky });
  const wants = { ash: { group: 'wilds', id: 'tree', variant: winter.season }, birch: { group: 'wilds', id: 'birch', variant: null }, pine: { group: 'wilds', id: 'pine', variant: null } };
  for (const [wood, tree] of found) {
    assert.ok(!('look' in tree) && !('sprite' in tree), 'the engine sends no sprite kind');
    assert.deepEqual(examine.examineKey(tree, { sky: winter }), wants[wood], `${wood}: ${JSON.stringify(tree)}`);
    assert.ok(examine.linesFor(wants[wood], CONTENT).includes(examine.examineLine(tree, { content: CONTENT, sky: winter })), `a ${wood} says its own line`);
    assert.equal(menus.optionsFor(tree)[0].label, 'Chop the tree');
  }
  assert.deepEqual([examine.examineTitle(found.get('pine')), examine.examineTitle({ kind: 'tree', label: 'Birch tree · chop' })], ['Pine', 'Birch tree'], 'no click verb in a title');
  // The labels relied on are the engine's own (an opened chest in wilds.js and scene-elsewhere.js, a locked one in elsewhere.js).
  const source = (file) => readFileSync(new URL(`../src/world/${file}`, import.meta.url), 'utf8');
  assert.ok(source('wilds.js').includes('label = \'An open chest\'') && source('scene-elsewhere.js').includes('entity.label = \'An open chest\'') && source('elsewhere.js').includes('\'A locked chest\''));
  // A wild chest opened in the saved wilds (or by its label) offers no Mimic check, as its Examine says it's open.
  const state = { ...fresh(), wilds: { ...fresh().wilds, opened: { 'poi:chest:4,5': T - MIN } } };
  const labels = (target, ctx = menus.menuContext({ state, content: CONTENT })) => menus.optionsFor(target, ctx).map((o) => o.label);
  const wildChest = { kind: 'poi', id: 'poi:chest:4,5', label: 'An old chest', poiType: 'chest', mimic: false };
  assert.deepEqual([labels(wildChest), examine.examineKey(wildChest, { state }).variant], [['Go to an old chest', 'Examine'], 'opened']);
  assert.deepEqual(labels({ ...wildChest, label: 'An open chest' }, menus.menuContext()), ['Go to an open chest', 'Examine']);
  assert.deepEqual(labels({ ...wildChest, id: 'poi:chest:9,9' }), ['Go to an old chest', 'Check for a Mimic (Jev)', 'Examine'], 'an unopened one still offers it');
  // The Elsewhere's opened chest says so by its label alone; its click says it's open and emptied.
  const opened = { kind: 'loot', id: 'loot', label: 'An open chest', riftId: 'rift:abc' };
  assert.deepEqual(labels(opened), ['Look in the chest', 'Examine']);
  assert.ok(examine.linesFor({ group: 'elsewhere', id: 'chest', variant: 'opened' }, CONTENT).includes(examine.examineLine(opened, { content: CONTENT, state })));
  assert.deepEqual(labels({ kind: 'loot', id: 'loot', label: 'A chest' }), ['Open the chest', 'Check for a Mimic (Jev)', 'Examine']);
  // A cave's locked chest reaches the menu with its label, not its flag; an explicit flag wins.
  assert.deepEqual(labels({ kind: 'loot', id: 'loot:0', label: 'A locked chest', riftId: 'cave:1,2' }), ['Open the chest', 'Pick lock (the Artificer)', 'Check for a Mimic (Jev)', 'Examine']);
  assert.deepEqual(labels({ kind: 'loot', id: 'loot:0', label: 'A locked chest', locked: false }), ['Open the chest', 'Check for a Mimic (Jev)', 'Examine']);
  assert.deepEqual(labels({ kind: 'loot', id: 'loot:0', label: 'An open chest', locked: true }), ['Look in the chest', 'Examine'], 'nothing to pick once it’s open');
  assert.deepEqual([examine.chestOpened({ id: 'loot' }, new Set(['loot'])), examine.chestOpened({ id: 'loot' }, ['x']), examine.chestOpened(null)], [true, false, false]);
});

test('the same thing always says the same line, a combatant says describe’s once it’s known, and nothing says nothing', () => {
  const tree = { kind: 'tree', id: 'tree:12,-4', look: 'pine' };
  const first = examine.examineLine(tree, { content: CONTENT });
  for (let i = 0; i < 5; i += 1) assert.equal(examine.examineLine({ ...tree }, { content: CONTENT }), first);
  const lines = new Set(Array.from({ length: 40 }, (_, i) => examine.examineLine({ kind: 'tree', id: `tree:${i},0`, look: 'pine' }, { content: CONTENT })));
  assert.ok(lines.size >= 2, 'different trees can say different things');
  // A foe's numbers are the 1-action Examine's to reveal (§4.4): before it, a free look shows only what a crawler looks like.
  const beetle = { id: 'beetle', name: 'Glitch beetle', side: 'foe', rank: 'stray', archetype: 'crawler', resist: { static: 3 }, weak: { warp: 3 }, temperament: 'curious' };
  const battle = (examined) => ({ id: 'fight:1', units: [{ ...beetle, examined }, { id: 'pip', name: 'Pip', side: 'party', rank: 'hero', resist: {}, weak: {} }] });
  assert.equal(examine.examineLine({ kind: 'combatant', id: 'cb:beetle' }, { battle: battle(true) }), 'Resists Static 3. Weak to Warp 3. Curious.');
  const look = examine.examineLine({ kind: 'combatant', id: 'cb:beetle' }, { battle: battle(false), content: CONTENT });
  assert.ok(look.endsWith(` ${examine.UNEXAMINED_LINE}`) && !/Static|Warp|Curious/.test(look), `no numbers and no temperament: ${look}`);
  assert.ok(examine.linesFor({ group: 'creatures', id: 'crawler' }, CONTENT).some((line) => look.startsWith(line)));
  assert.equal(examine.examineLine({ kind: 'combatant', id: 'cb:pip' }, { battle: battle(false) }), 'No resistances or weaknesses.', 'an ally is always known');
  assert.equal(examine.examineLine({ kind: 'combatant', id: 'cb:beetle' }, {}), examine.FALLBACK_LINE);
  assert.equal(examine.examineLine({ kind: 'mystery', id: 'x' }, { content: CONTENT }), examine.FALLBACK_LINE);
  assert.equal(examine.examineLine(null), examine.FALLBACK_LINE);
});

test('an Examine opens a note bubble, marks the feature and the stray’s fact once, and tells its listeners', () => {
  const { shell, calls } = stubShell();
  const heard = [];
  const off = examine.onExamine((payload) => heard.push(payload));
  const beetle = stray('crawler');
  const line = examine.examineEntity(shell, beetle);
  assert.ok(line && line !== examine.FALLBACK_LINE);
  assert.deepEqual(calls.bubbles.at(-1), { kind: 'note', title: 'A glitch beetle', lines: [line], duration: 7000 });
  assert.deepEqual(calls.features, ['examine']);
  assert.ok(shell.state.story.facts['examined:neon:crawler'], 'the stray’s fact is written');
  const sets = calls.sets;
  examine.examineEntity(shell, beetle);
  assert.equal(calls.sets, sets, 'a fact already written writes nothing');
  examine.examineEntity(shell, { kind: 'war-table', id: 'war-table' });
  assert.deepEqual(heard.map((h) => h.target), [beetle.id, beetle.id, 'war-table'], 'a trail step’s target');
  assert.deepEqual(heard[2].key, { group: 'vale', id: 'war-table', variant: null });
  off();
  examine.examineEntity(shell, { kind: 'war-table', id: 'war-table' });
  assert.equal(heard.length, 3, 'off stops the listening');
  // A field boss can be Challenged from its Examine (COMBAT §2), never mid-fight.
  examine.examineEntity(shell, { kind: 'stray', id: 'stray:rift:boss:lead', fieldBoss: true });
  assert.deepEqual([calls.bubbles.at(-1).challenge, calls.bubbles.at(-1).actions.map((a) => a.id)], ['stray:rift:boss:lead', ['challenge', 'later']]);
  examine.examineEntity(shell, { kind: 'stray', id: 'stray:rift:boss:lead', fieldBoss: true }, { combat: true });
  assert.equal(calls.bubbles.at(-1).actions, undefined);
  assert.deepEqual([examine.examineTitle({ kind: 'ground' }), examine.examineTitle({ kind: 'tree', label: 'an old oak.' })], ['Looking up', 'An old oak']);
  assert.equal(examine.examinedFact({ kind: 'stray', archetype: 'walker' }), null, 'no genre, no fact');
});

/* ------------------------------------------------------------------ the HUD */

test('each HUD tab opens its panel', () => {
  const state = fresh();
  const panel = (id, opts = {}) => ({ kind: 'panel', panel: id, opts });
  const expected = {
    skills: panel('skills'), quests: panel('board'), satchel: panel('satchel'), company: panel(`company:${state.party.chosen[0]}`),
    grimoire: { kind: 'say', title: 'The Grimoire', lines: [hud.GRIMOIRE_LINE] }, crew: { kind: 'log', tab: 'crew' },
    chronicle: panel('chronicle'), settings: panel('camp', { section: 'settings', focus: 'setting-motion' }),
  };
  assert.deepEqual(hud.HUD_TABS.map((t) => t.id), Object.keys(expected));
  for (const tab of hud.HUD_TABS) assert.deepEqual(hud.hudTabTarget(tab.id, { state }), expected[tab.id], tab.id);
  assert.equal(state.party.chosen[0], 'claude');
  assert.deepEqual(hud.hudTabTarget('company', { state: { party: { chosen: [] } } }), { kind: 'panel', panel: 'company:milo', opts: {} }, 'Milo’s sheet with nobody chosen');
  assert.match(hud.GRIMOIRE_LINE, /arrives in Phase 5/);
  assert.equal(hud.hudTabTarget('gear'), null);

  // And through the mount: a click on each tab button does what its target says.
  const clicks = [];
  const root = fakeRoot('hud');
  const { shell, calls } = stubShell({ state });
  const restore = withDocument({ hud: root });
  try {
    const handle = hud.mount(shell);
    assert.match(root.innerHTML, /id="side-tabs"/);
    for (const b of buttons(root.innerHTML).filter((x) => x['data-action'] === 'hud-tab')) {
      root.click(b);
      clicks.push(b['data-tab']);
    }
    handle.dispose();
  } finally { restore(); }
  assert.deepEqual(clicks, Object.keys(expected));
  assert.deepEqual(calls.panels.map(([idOf]) => idOf), ['skills', 'board', 'satchel', 'company:claude', 'chronicle', 'camp']);
  assert.deepEqual(calls.bubbles.map((b) => b.title), ['The Grimoire']);
});

test('the HUD: Quiet is one button back, the Sneak toggle shows only inside, and the orbs read the wallet, Codex and Kindle', () => {
  const state = kindleStart(fresh(), T).state;
  const adventure = hud.hudView({ state, now: T + MIN, snapshot: { capacity: { codex: { usedPercent: 40, resetsAt: T + HOUR } } } });
  assert.deepEqual([adventure.mode, adventure.orbs.mana.pct, adventure.orbs.focus.text, adventure.orbs.ember.text], ['adventure', 60, '49:00', '0']);
  const html = hud.buildHud(adventure);
  assert.match(html, /<canvas class="hud-minimap[^"]*" width="96" height="96"/);
  assert.equal(buttons(html).filter((b) => b['data-action'] === 'hud-tab').length, 8);
  assert.ok(!html.includes('hud-sneak'), 'no Sneak in the open');
  const inside = hud.buildHud(hud.hudView({ state, now: T, area: { area: 'elsewhere' }, sneaking: true }));
  assert.match(inside, /data-action="hud-sneak" aria-pressed="true"/);
  assert.match(hud.buildHud(hud.hudView({ state, now: T, area: { area: 'wilds', cave: true } })), /hud-sneak/, 'a cave has Sneak too');
  const quiet = hud.buildHud(hud.hudView({ state: { ...state, settings: { ...state.settings, hud: 'quiet' } }, now: T }));
  assert.deepEqual(buttons(quiet).map((b) => [b['data-action'], b['data-mode']]), [['hud-mode', 'adventure']]);
  assert.equal(hud.manaView(null, T).pct, null);
  assert.equal(hud.manaView({ capacity: { codex: { usedPercent: 130 } } }, T).pct, 0);
});

test('::quiet and ::adventure switch the HUD through setHudMode, and the Settings rows switch it too', () => {
  const { shell, calls } = stubShell();
  assert.deepEqual([hud.setHudMode(shell, 'quiet'), shell.state.settings.hud, calls.emits.at(-1)], [true, 'quiet', ['hud', { mode: 'quiet' }]]);
  assert.deepEqual([hud.setHudMode(shell, 'sideways'), shell.state.settings.hud], [false, 'quiet']);
  const rows = hud.buildHudSettings({ kindleBell: false, hud: 'quiet' });
  assert.match(rows, /data-setting="kindleBell"[^>]*>.*Off/s);
  assert.match(rows, /data-action="hud-mode" data-mode="adventure"/, 'Quiet offers Adventure');
  assert.match(hud.buildHudSettings({}), /data-action="hud-mode" data-mode="quiet"/, 'Adventure by default offers Quiet');
});

test('the minimap covers 96 tiles round Milo, with fog where nothing is charted', () => {
  const plan = hud.minimapPlan({ x: 100, y: -40 }, { explored: ['2,-2', '3,-2'] });
  assert.deepEqual(plan.milo, { x: 48, y: 48 });
  const covered = new Set();
  for (const c of plan.chunks) {
    for (let y = Math.max(0, c.dy); y < Math.min(96, c.dy + 32); y += 1) for (let x = Math.max(0, c.dx); x < Math.min(96, c.dx + 32); x += 1) covered.add(`${x},${y}`);
  }
  assert.equal(covered.size, 96 * 96, 'every minimap pixel is under one chunk');
  assert.ok(plan.chunks.length >= 9 && plan.chunks.length <= 16);
  assert.equal(plan.chunks.find((c) => c.key === '2,-2').fog, false);
  assert.equal(plan.chunks.find((c) => c.key === '4,-1').fog, true);
  assert.equal(hud.minimapPlan({ x: 10, y: 10 }).chunks.find((c) => c.key === '0,0').fog, false, 'the vale is never under fog');
  assert.deepEqual(hud.minimapPlan(null), { chunks: [], milo: null });
});

test('a minimap chunk the world couldn’t paint yet is asked for again next second, and a painted one is kept', () => {
  const [drawn, asked] = [[], []];
  const canvas = { getContext: () => ({ fillRect() {}, drawImage: (image) => drawn.push(image.key) }) };
  const root = Object.assign(fakeRoot('hud'), { querySelector: (selector) => (selector === '.hud-minimap' ? canvas : null) });
  const stub = stubShell();
  let ready = false;
  stub.shell.world = (method, cx, cy) => {
    if (method === 'paintMapChunk') asked.push(`${cx},${cy}`);
    return method === 'miloTile' ? { x: 10, y: 12 } : method === 'paintMapChunk' && ready ? { key: `${cx},${cy}` } : null;
  };
  const restore = withDocument({ hud: root });
  try {
    const handle = hud.mount(stub.shell);
    const first = asked.length;
    assert.ok(first >= 1 && drawn.length === 0, 'the first paint asks for the vale’s chunks, and the world isn’t ready');
    ready = true;
    stub.emit('second');
    assert.ok(asked.length > first && drawn.includes('0,0'), 'the next second asks again, and draws what it got');
    const [painted, draws] = [asked.length, drawn.length];
    stub.emit('second');
    assert.deepEqual([asked.length, drawn.length], [painted, draws], 'a painted chunk is kept, and nothing changed: no repaint');
    handle.dispose();
  } finally { restore(); }
});

/* ------------------------------------------------------------------ the Log and the command bar */

test('the Log keeps the newest 200 lines, cleans every entry, and shows Combat only in a fight', () => {
  assert.deepEqual(log.cleanEntry({ tab: 'nowhere', text: '  Hello  there.  ', at: 5 }), { tab: 'milo', text: 'Hello there.', at: 5, detail: null, action: null });
  assert.deepEqual([log.cleanEntry({ text: '' }), log.cleanEntry({ text: 'x'.repeat(300) }).text.length, log.cleanEntry({ text: 'a', detail: Array(30).fill('d') }).detail.length, log.cleanEntry({ text: 'a', action: { id: 'x' } }).action, log.cleanEntry({ text: 'a' }, T).at],
    [null, 120, 12, null, T], 'no text, no line; text ≤ 120 and detail ≤ 12; an action needs a label; the time defaults to now');
  let lines = [];
  for (let i = 1; i <= 250; i += 1) lines = log.pushLine(lines, log.cleanEntry({ tab: i % 2 ? 'crew' : 'world', text: `Line ${i}.`, at: T + i }), i);
  assert.deepEqual([lines.length, lines[0].seq, lines.at(-1).seq], [log.LOG_MAX, 51, 250]);
  assert.deepEqual([log.linesOn(lines, 'crew').length, log.linesOn(lines, 'all').length], [100, 200]);
  assert.deepEqual([log.tabsShown(false), log.tabsShown(true)], [['all', 'crew', 'milo', 'world'], ['all', 'crew', 'milo', 'world', 'combat']]);
  assert.equal(log.logView({ lines, tab: 'combat', combat: false }).tab, 'all', 'no Combat tab outside a fight');
  const html = log.buildLog(log.logView({ lines, tab: 'crew', combat: true }));
  assert.match(html, /<div class="log-panel" role="tabpanel" id="log-panel" aria-labelledby="log-tab-crew"><ol class="log-lines" id="log-lines" aria-live="polite"/);
  assert.match(html, /aria-controls="log-panel"/);
  assert.match(html, /<input type="text" id="command"/);
  assert.ok(!html.includes('aria-describedby'), 'nothing points a screen reader at the eye-only completions');
  assert.match(html, /role="tab"[^>]*data-tab="crew" aria-selected="true"[^>]*tabindex="0"/);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 2, 'one tab and the list are tab stops; lines move by arrows');
  assert.equal((html.match(/<li class="log-line"/g) || []).length, 100);
  assert.ok(!html.includes('<form'), 'the command bar is no form (the CSP forbids submits)');
  // A line expands to its detail.
  const line = { tab: 'combat', text: 'Pip — Critical — 17 Warp', at: T, seq: 9, detail: ['Odds: Critical 20%.'], action: null };
  assert.ok(!log.buildLogLine(line).includes('log-detail'));
  assert.match(log.buildLogLine(line, { open: [9] }), /aria-expanded="true".*<ul class="log-detail"><li>Odds: Critical 20%\.<\/li><\/ul>/s);
  assert.match(log.buildLogLines(log.logView()), /log-empty/);
});

test('the command bar does what a button would: ::kindle, “open the chronicle”, and a calm answer to nonsense', () => {
  const stub = stubShell();
  const { shell, calls } = stub;
  // ::kindle lights the lantern, as the Kindle panel's button does.
  let result = log.runCommand(shell, '::kindle');
  assert.deepEqual([result.intent.kind, shell.state.kindle.phase, shell.state.kindle.startedAt, calls.features.slice(0, 2), calls.bubbles.at(-1).title, result.reply],
    ['spell', 'focus', T, ['command', 'kindle'], 'The lantern’s lit', null]);
  result = log.runCommand(shell, 'kindle the lantern');
  assert.match(result.reply.text, /^The lantern’s already lit\. Focus: 50 minutes left\.$/);
  // Words for panels open them, exactly as the tabs do.
  for (const text of ['open the chronicle', '::skills', '::muster']) log.runCommand(shell, text);
  assert.deepEqual(calls.panels.map(([idOf]) => idOf), ['chronicle', 'skills', 'muster']);
  log.runCommand(shell, '::map');
  assert.equal(calls.map, 1);
  log.runCommand(shell, 'go home');
  assert.deepEqual(calls.travel, ['home']);
  log.runCommand(shell, '::wayfinding watchtower');
  assert.deepEqual(calls.panels.at(-1), ['watchtower', { walk: true }]);
  // Where a command can't go, Milo says why: the War Table before the Stockade; walking or the map mid-fight.
  const panelsBefore = calls.panels.length;
  assert.equal(log.runCommand(shell, 'go to war table').reply.text, log.CANT.noWarTable);
  assert.deepEqual(['::home', '::wayfinding watchtower', '::map'].map((text) => log.runCommand(shell, text, { combat: true }).reply.text), [log.CANT.homeInFight, log.CANT.goInFight, log.CANT.mapInFight]);
  assert.deepEqual([calls.panels.length, calls.travel, calls.map], [panelsBefore, ['home'], 1], 'and nothing moved');
  result = log.runCommand(shell, '::quiet');
  assert.equal(shell.state.settings.hud, 'quiet');
  assertCalm(result.reply.text, 'the Quiet reply', { proper: PENDING_NAMES });
  // Help, a spell not here yet, and nonsense get calm answers.
  result = log.runCommand(shell, '::help');
  assert.deepEqual([result.reply.text, result.reply.detail], [log.HELP.text, [...log.HELP.detail]]);
  assert.equal(log.runCommand(shell, '::found-things').reply.text, 'Found Things arrives in Phase 7.');
  result = log.runCommand(shell, 'flibbertigibbet wobble');
  assert.equal(result.intent.kind, 'unknown');
  assertCalm(result.reply.text, 'the answer to nonsense');
  assert.match(result.reply.text, /^I’m not sure what that means\./);
  assert.equal(log.runCommand(shell, '::kindel').reply.text, 'I’m not sure what that means. Did you mean ::kindle?');
  assert.equal(log.runCommand(shell, '   ').reply, null, 'an empty line says nothing');
  // ::stop puts it out; banked coals rest.
  log.runCommand(shell, '::stop');
  assert.equal(shell.state.kindle.phase, 'idle');
  log.runCommand(shell, 'rest');
  assert.ok(shell.state.kindle.phase === 'rest' && calls.features.includes('rest'));
  assert.ok(log.commandPlaces().some((p) => p.id === 'watchtower'));
});

test('the Log mounts on a fake #log: lines arrive, tabs switch, a line expands, and Enter runs the command bar', () => {
  const root = fakeRoot('log', { query: true });
  const { shell, calls } = stubShell();
  const restore = withDocument({ log: root });
  try {
    const handle = log.mount(shell);
    assert.ok(root.innerHTML.includes('id="command"'));
    const first = handle.add({ tab: 'crew', text: 'Claude finished ‘MILO plan’.', detail: ['It ran for 20 minutes.'] });
    assert.equal(first.seq, 1);
    assert.equal(handle.add({ tab: 'crew', text: '' }), null, 'nothing to say, no line');
    assert.equal(handle.line(1).open, false);
    root.click({ 'data-action': 'log-expand', 'data-line': '1' });
    assert.equal(handle.line(1).open, true);
    assert.equal(handle.showTab('combat'), false, 'no Combat tab outside a fight');
    assert.equal(handle.showTab('crew'), true);
    assert.equal(log.showTab('world'), true, 'the HUD reaches the mounted Log');
    root.input.value = '::chronicle';
    root.key(root.input, { key: 'Enter' });
    assert.deepEqual(calls.panels.at(-1), ['chronicle', null]);
    assert.equal(root.input.value, '', 'the command bar clears');
    handle.showTab('all');
    root.input.value = 'nonsense words';
    root.key(root.input, { key: 'Enter' });
    assert.ok(root.appended.some((html) => html.includes('I’m not sure what that means.')), 'Milo’s answer is written as a line');
    handle.dispose();
    assert.equal(log.showTab('crew'), false, 'a disposed Log shows nothing');
  } finally { restore(); }
});

test('the Log reads the combat message’s live (§18.3 item 10): Combat shows while it’s true, and { live: false } ends the fight whatever the stage says', () => {
  assert.deepEqual([true, false, null, undefined, 'combat', {}, { battle: {} }, { live: true }, { live: false, battle: {} }].map(log.combatLive), [true, false, false, false, false, false, true, true, false]);
  const [root, stub, stage] = [fakeRoot('log', { query: true }), stubShell(), { dataset: { mode: 'combat' } }];
  const restore = withDocument({ log: root, stage });
  const said = (text) => { root.input.value = text; root.key(root.input, { key: 'Enter' }); return visible(root.appended.at(-1) || ''); };
  try {
    const handle = log.mount(stub.shell);
    assert.ok(said('::home').includes(log.CANT.homeInFight), 'before any message, the stage’s mode says');
    const message = { live: true, battle: { id: 'fight:1', units: [] }, roundView: null, ctx: {}, command() {} };
    for (let i = 0; i < 3; i += 1) stub.emit('combat', message);
    assert.deepEqual([handle.showTab('combat'), handle.showTab('all')], [true, true], 'live: true shows the Combat tab');
    stage.dataset.mode = 'explore';
    assert.ok(said('::map').includes(log.CANT.mapInFight) && stub.calls.map === 0, 'live: true, whatever the stage says');
    stage.dataset.mode = 'combat';
    handle.showTab('combat');
    stub.emit('combat', { live: false });
    assert.equal(handle.showTab('combat'), false, 'live: false takes the Combat tab away');
    assert.ok(handle.add({ tab: 'crew', text: 'Claude finished.' }) && visible(root.appended.at(-1)).includes('Claude finished.'), 'and the Log is back on All');
    said('::home');
    assert.deepEqual(stub.calls.travel, ['home'], 'live: false ends the fight for the command bar, though the stage still says combat');
    handle.dispose();
  } finally { restore(); }
});

/* ------------------------------------------------------------------ Kindle */

test('Kindle’s steps: the start, the pay at a phase’s end, once, and the features the trail waits on', () => {
  let state = fresh();
  const content = CONTENT;
  let step = kindleUi.kindleStep(state, 'start', T, content);
  assert.deepEqual(step.features, ['kindle']);
  assert.equal(step.bubbles[0].title, 'The lantern’s lit');
  state = step.state;
  step = kindleUi.kindleStep(state, 'tick', T + 20 * MIN, content);
  assert.equal(step.state, state, 'nothing moves mid-session');
  assert.deepEqual(step.bubbles, []);
  step = kindleUi.kindleStep(relaunch(state, T + 51 * MIN), 'tick', T + 51 * MIN, content);
  assert.equal(step.paid, 10);
  assert.deepEqual(step.bubbles.map((b) => b.title), ['The focus session is done']);
  assert.match(step.bubbles[0].lines[0], /10 Embers for that\.$/);
  assert.deepEqual(step.features, ['rest'], 'the rest starts, and the trail’s rest step can see it');
  state = step.state;
  const again = kindleUi.kindleStep(relaunch(state, T + 52 * MIN), 'tick', T + 52 * MIN, content);
  assert.equal(again.paid, 0);
  assert.deepEqual(again.bubbles, [], 'a relaunch pays nothing twice');
  step = kindleUi.kindleStep(state, 'tick', T + FOCUS_MS + REST_MS + MIN, content);
  assert.equal(step.paid, 5);
  assert.deepEqual(step.bubbles.map((b) => b.title), ['The rest is over']);
  // Both at once, after a long time away: one bubble.
  const away = kindleUi.kindleStep(kindleStart(fresh(), T).state, 'tick', T + 3 * HOUR, content);
  assert.deepEqual(away.bubbles.map((b) => b.title), ['The focus session and the rest are done']);
  assert.match(away.bubbles[0].lines[0], /15 Embers for that\./);
  assert.equal(kindleUi.kindleStep(fresh(), 'stop', T, content).words, 'The lantern isn’t lit.');
});

test('the Kindle panel, orb and status line read the phase without a per-second change in the panel', () => {
  const idle = kindleUi.buildKindle(kindleUi.kindlePanelView(fresh(), T, { content: CONTENT }));
  assert.deepEqual(buttons(idle).map((b) => b['data-action']), ['kindle-start', 'kindle-rest', 'kindle-bell']);
  assert.match(idle, /Focus pays 10 Embers. A full rest pays 5./);
  const focusing = kindleStart(fresh(), T).state;
  const focus = kindleUi.buildKindle(kindleUi.kindlePanelView(focusing, T + MIN));
  assert.match(focus, /Focusing until 10:00\./);
  assert.deepEqual(buttons(focus).map((b) => b['data-action']), ['kindle-stop', 'kindle-bell']);
  const confirm = kindleUi.buildKindle(kindleUi.kindlePanelView(focusing, T + MIN, { confirming: 'stop' }));
  assert.match(confirm, /<div class="confirm" role="alertdialog"/);
  const safe = buttons(confirm).find((b) => b['data-action'] === 'kindle-keep');
  assert.ok(safe && /primary/.test(safe.class), 'the safe button is the primary one, which the shell focuses first');
  const rest = kindleTick(focusing, T + FOCUS_MS + MIN).state;
  const resting = kindleUi.kindlePanelView(rest, T + FOCUS_MS + MIN);
  assert.equal(resting.earned, true);
  assert.match(kindleUi.buildKindle(resting), /Resting until 10:15\./);
  assert.deepEqual([kindleUi.orbView(focusing, T + MIN).text, kindleUi.orbView(fresh(), T).text], ['49:00', 'Kindle']);
  assert.equal(kindleUi.statusLine(focusing, T + MIN), 'Focusing · 49 minutes left');
  assert.equal(kindleUi.statusLine(rest, T + FOCUS_MS + 14 * MIN + 30000), 'Resting · under a minute left');
  assert.equal(kindleUi.statusLine(fresh(), T), null);
  assert.deepEqual(['0:00', '0:05', '1:00', '49:59'], [0, 4200, 60000, 49 * MIN + 59000].map(kindleUi.clockText));
  assert.match(kindleUi.buildKindleOrb(kindleUi.orbView(focusing, T)), /<span class="orb-time" data-phase="focus">50:00<\/span>/);
});

test('Kindle’s mount ticks, arms main’s bell after every change, keeps the status line, and the panel’s buttons run the same steps', () => {
  const stub = stubShell();
  const { shell, calls, registered, emit } = stub;
  const handle = kindleUi.mount(shell);
  assert.ok(registered.has('kindle'), 'the kindle panel is registered');
  assert.deepEqual(calls.alarms, [null], 'nothing to ring yet: the slot is cleared once');
  const panel = registered.get('kindle');
  assert.equal(panel.title(), 'Kindle');
  const button = (action) => ({ getAttribute: (n) => (n === 'data-action' ? action : null) });
  assert.deepEqual([panel.action(button('kindle-start')), shell.state.kindle.phase, calls.alarms.at(-1), calls.alarms.at(-1).at, calls.statuses.at(-1)],
    [true, 'focus', nextAlarm(shell.state), T + FOCUS_MS, ['kindle', 'Focusing · 50 minutes left']]);
  // Stopping a focus session asks first; the safe answer keeps it.
  panel.action(button('kindle-stop'));
  assert.match(panel.render(), /role="alertdialog"/);
  assert.deepEqual(calls.refresh.at(-1), { focus: 'kindle-keep' });
  panel.action(button('kindle-keep'));
  assert.equal(shell.state.kindle.phase, 'focus');
  // The clock moves on; 'second' ticks it; the bell moves to the rest's end, and pays once.
  stub.advance(FOCUS_MS + MIN);
  emit('second');
  assert.deepEqual([shell.state.kindle.phase, calls.alarms.at(-1).at, calls.bubbles.at(-1).title], ['rest', T + FOCUS_MS + REST_MS, 'The focus session is done']);
  const lifetime = shell.state.embers.lifetime;
  emit('second');
  stub.ring()?.({ id: 'x' });
  assert.equal(shell.state.embers.lifetime, lifetime, 'ticking again pays nothing more');
  // The bell switch.
  panel.action(button('kindle-bell'));
  assert.deepEqual(calls.settings.at(-1), ['kindleBell', false]);
  assert.match(panel.render(), /aria-checked="false"/);
  // The command bar runs the same step as the button.
  log.runCommand(shell, '::stop');
  assert.deepEqual([shell.state.kindle.phase, calls.alarms.at(-1), calls.statuses.at(-1)], ['idle', null, ['kindle', null]], 'out, with nothing to ring');
  assert.ok(calls.emits.some(([event]) => event === 'kindle'), 'the shell hears Kindle’s events');
  handle.dispose();
  assert.ok(!registered.has('kindle'), 'dispose unregisters the panel');
});

test('Kindle never breaks an honoured rest unasked, a confirm never outlives its phase, and a command’s bubble says what it gave up', () => {
  const stub = stubShell();
  const { shell, registered, emit } = stub;
  const handle = kindleUi.mount(shell);
  const panel = registered.get('kindle');
  const press = (action) => panel.action({ getAttribute: (n) => (n === 'data-action' ? action : null) });
  press('kindle-start');
  press('kindle-stop');
  assert.match(panel.render(), /Stopping now ends the session, and it won’t pay\./);
  // The session ends with the confirm still open: it goes, and its stale "Put it out" asks again instead of breaking the rest.
  stub.advance(FOCUS_MS + MIN);
  emit('second');
  assert.equal(shell.state.kindle.phase, 'rest');
  assert.ok(!/role="alertdialog"/.test(panel.render()), 'the old confirm is gone');
  press('kindle-stop-confirm');
  assert.equal(shell.state.kindle.phase, 'rest', 'a stale confirm breaks nothing');
  assert.match(panel.render(), /Stopping now ends the rest, and it won’t be honoured\..*Keep resting/s);
  press('kindle-keep');
  press('kindle-stop');
  assert.match(panel.render(), /role="alertdialog"/, 'stopping an honoured rest asks first');
  press('kindle-keep');
  stub.advance(REST_MS);
  emit('second');
  assert.equal(shell.state.tally.restsHonoured, 1, 'the rest ran its course and was honoured');
  press('kindle-start');
  press('kindle-rest');
  assert.equal(shell.state.kindle.phase, 'focus', 'an older panel’s Bank the coals changes nothing mid-session');
  handle.dispose();
  // The command bar can't ask, so its bubble says what went first.
  const lines = (state, verb, now) => kindleUi.kindleStep(state, verb, now, CONTENT).bubbles.at(-1).lines;
  const focusing = kindleStart(fresh(), T).state;
  assert.equal(lines(focusing, 'rest', T + MIN)[0], kindleUi.COPY.lostFocus);
  assert.equal(lines(focusing, 'stop', T + MIN)[0], kindleUi.COPY.lostFocus);
  const honoured = kindleTick(focusing, T + FOCUS_MS + MIN, { economy: CONTENT.economy, xp: CONTENT.xp }).state;
  assert.equal(lines(honoured, 'start', T + FOCUS_MS + 2 * MIN)[0], kindleUi.COPY.lostRest);
  assert.equal(lines(honoured, 'stop', T + FOCUS_MS + 2 * MIN)[0], kindleUi.COPY.lostRest);
  assert.equal(kindleUi.kindleStep(focusing, 'stop', T + FOCUS_MS + MIN, CONTENT).lost, 'rest', 'a session that ended unticked still earned its rest');
  assert.deepEqual(lines(kindleUi.kindleStep(fresh(), 'rest', T, CONTENT).state, 'stop', T + MIN), ['Kindle it again whenever you like.'], 'a plain rest loses nothing');
});

/* ------------------------------------------------------------------ the wallet and the Chronicle */

test('the wallet shows the balance, says it’s full at the cap, and opens the Chronicle', () => {
  assert.equal(visible(wallet.buildWallet({ balance: 42, cap: 100 })), '42');
  assert.ok(!wallet.buildWallet({ balance: 42, cap: 100 }).includes('data-full'));
  assert.match(wallet.buildWallet({ balance: 100, cap: 100 }), /data-full="true"/);
  assert.equal(wallet.walletLabel({ balance: 42, cap: 100 }), 'Embers: 42 of 100. Open the Chronicle.');
  assert.equal(wallet.walletTitle({ balance: 42, cap: 100, lifetime: 1234, today: { earned: 10 } }), '42 of 100 in the wallet · 1,234 in all · 10 today');
  assert.equal(wallet.buildWallet({ balance: -5 }).includes('>0<'), true, 'never below nothing');
  const root = fakeRoot('wallet');
  const { shell, calls } = stubShell();
  const restore = withDocument({ wallet: root });
  try {
    const handle = wallet.mount(shell);
    assert.equal(root.attrs['aria-label'], 'Embers: 0 of 100. Open the Chronicle.');
    root.fire('click');
    assert.deepEqual(calls.panels, [['chronicle', null]]);
    handle.dispose();
  } finally { restore(); }
});

test('the Chronicle: today, this week in Starfall’s shape, the ledger with every source, the fights, the day’s XP lines and Show more', () => {
  const opts = { economy: CONTENT.economy, xp: CONTENT.xp };
  let state = fresh();
  state = kindleStart(state, T, opts).state;
  state = kindleTick(state, T + FOCUS_MS + REST_MS + MIN, opts).state;
  state = { ...state, embers: { ...state.embers, balance: 20 } };
  state = spend(state, { n: 3, what: 'cave' }, T + 2 * HOUR, CONTENT.economy).state;
  state = noteFight(state, T + 2 * HOUR, { id: 'fight:cave:1', at: T + 2 * HOUR, where: 'A cave by the Murmur', outcome: 'won', rounds: 3, xp: 40, marks: 12, summary: 'Rivet held the door.' });
  const now = T + 3 * HOUR;
  const view = chronicleView.chronicleView(state, now);
  assert.deepEqual([view.label, view.totals.focus, view.totals.rests], ['Today', 1, 1]);
  assert.deepEqual(view.week.days.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(view.week.days.filter((d) => d.today).length, 1);
  assert.equal(view.week.days.find((d) => d.today).focus, 1);
  const html = chronicleView.buildChronicle(view);
  assert.match(html, /Focus 1,000: focus session 09:10–10:00/, 'the day’s XP lines');
  assert.match(html, /<li class="ledger-row" data-source="focus" data-sign="in">.*Focus session 09:10–10:00.*\+10/s);
  assert.match(html, /data-source="rest" data-sign="in"/);
  assert.match(html, /data-source="cave" data-sign="out">.*Went into a cave.*−3/s);
  assert.match(html, /A cave by the Murmur<\/strong> <span class="stage-tag">Settled<\/span>/);
  assert.match(html, /3 rounds · 40 Road XP · 12 Marks/);
  assert.match(html, /Rivet held the door\./);
  assert.equal(buttons(html).filter((b) => b['data-action'] === 'chronicle-day').length, 7);
  assert.ok(!html.includes('chronicle-more'), 'nothing more to show yet');
  // 25 entries show 20 at a time.
  const many = { ...state, embers: { ...state.embers, ledger: Array.from({ length: 25 }, (_, i) => ({ at: T + i * MIN, n: 1, banked: 1, source: 'crew', text: `Crew session ${i + 1}` })) } };
  const paged = chronicleView.chronicleView(many, now);
  assert.deepEqual([paged.ledger.entries.length, paged.ledger.entries[0].text, paged.ledger.more], [20, 'Crew session 25', true], '20, newest first, and more');
  assert.match(chronicleView.buildChronicle(paged), /data-action="chronicle-more" data-list="ledger"/);
  assert.equal(chronicleView.chronicleView(many, now, { limits: { ledger: 40 } }).ledger.more, false);
  // Another day, picked from the week.
  const yesterday = chronicleView.chronicleView(state, now + DAY, { day: view.today });
  assert.equal(yesterday.label, 'Yesterday');
  assert.match(chronicleView.buildChronicle(yesterday), /data-action="chronicle-today"/);
  assert.match(chronicleView.dayLabel('2026-09-21', '2026-09-29'), /^Monday 21 September$/);
  // What the cap kept back.
  assert.match(chronicleView.ledgerRow({ at: T, n: 10, banked: 7, source: 'focus', text: 'Focus session' }, '2026-09-29'), /7 banked, 3 past the cap/);
  assert.match(chronicleView.ledgerRow({ at: T, n: 1000, banked: 100, source: 'backlog', text: '' }, '2026-09-29'), /From before the Kit.*\+1,000/s);
  assert.deepEqual(chronicleView.totalsWords({ focus: 2, embersIn: 1, fights: 1 }), ['2 focus sessions', '1 Ember in', '1 fight']);
});

test('the Chronicle’s mount pages, picks a day, and marks the feature the trail waits on', async () => {
  const { shell, calls, registered } = stubShell();
  const handle = chronicleView.mount(shell);
  const panel = registered.get('chronicle');
  assert.equal(panel.title(), 'The Chronicle');
  panel.render();
  await Promise.resolve();
  assert.deepEqual(calls.features, ['chronicle']);
  const button = (attrs) => ({ getAttribute: (n) => attrs[n] ?? null });
  assert.equal(panel.action(button({ 'data-action': 'chronicle-more', 'data-list': 'ledger' })), true);
  assert.deepEqual(calls.refresh.at(-1), { focus: 'chronicle-more-ledger' });
  assert.equal(panel.action(button({ 'data-action': 'chronicle-more', 'data-list': 'nope' })), false);
  assert.equal(panel.action(button({ 'data-action': 'chronicle-day', 'data-day': '2026-09-28' })), true);
  assert.match(panel.render(), /data-day="2026-09-28"/);
  assert.equal(panel.action(button({ 'data-action': 'chronicle-day', 'data-day': 'soon' })), false);
  assert.equal(panel.action(button({ 'data-action': 'something-else' })), false);
  handle.dispose();
  assert.ok(!registered.has('chronicle'));
});

/* ------------------------------------------------------------------ skills */

test('the Skills panel lists the 24 in three families, opens a guide, and keeps clear of Milo’s Arts', () => {
  let state = fresh();
  state = addXp(state, 'cartography', 400, T, { source: 'chunk-charted', text: 'ten new chunks charted' }).state;
  const view = skillsUi.skillsPanelView(state, CONTENT, { open: 'cartography' });
  assert.deepEqual(view.families.map((f) => f.skills.length), [9, 5, 10]);
  assert.deepEqual(view.families.flatMap((f) => f.skills.map((s) => s.id)), [...SKILL_IDS]);
  assert.equal(view.total, 23 + skillsUi.skillsPanelView(state, CONTENT).families.flatMap((f) => f.skills).find((s) => s.id === 'cartography').level);
  const html = skillsUi.buildSkills(view);
  assert.equal((html.match(/<li class="life-skill"/g) || []).length, 24);
  assert.ok(!/class="skill"|data-skill="/.test(html), 'Phase 3’s .skill[data-skill] stays Milo’s Arts’');
  assert.match(html, /data-life-skill="cartography" data-level="5"/);
  assert.match(html, /400 of 512 XP/);
  assert.match(html, /aria-expanded="true" aria-controls="guide-cartography"/);
  assert.equal((html.match(/aria-controls=/g) || []).length, 1, 'only the open guide is named: the shut ones aren’t in the page');
  assert.match(html, /Rises from every new chunk of the wilds you chart: 40 a chunk\./);
  assert.equal((html.match(/life-skill-guide/g) || []).length, 1, 'one guide open at a time');
  assert.equal(skillsUi.levelProgress(0, 1), 0);
  assert.equal(skillsUi.levelProgress(13034431, 99), 100);
  assert.match(skillsUi.skillRow({ id: 'focus', name: 'Focus', level: 99, xp: 13034431, next: null }), /As high as it goes\./);
});

test('XP drops float up at most one a second, and a new level rings “Cartography is level 5.”', () => {
  const before = fresh();
  const after = addXp(addXp(before, 'cartography', 400, T).state, 'focus', 1000, T).state;
  const drops = skillsUi.xpDrops(before, after);
  assert.deepEqual(drops, [{ skill: 'focus', amount: 1000, level: 9, levelled: true }, { skill: 'cartography', amount: 400, level: 5, levelled: true }]);
  assert.deepEqual(skillsUi.xpDrops(after, after), []);
  assert.equal(skillsUi.dropText({ skill: 'cartography', amount: 40 }), '+40 cartography xp');
  assert.equal(skillsUi.levelLine({ skill: 'cartography', level: 5 }), 'Cartography is level 5.');
  let queue = skillsUi.queueDrop([], { skill: 'cartography', amount: 40, level: 1, levelled: false });
  queue = skillsUi.queueDrop(queue, { skill: 'cartography', amount: 40, level: 2, levelled: true });
  assert.deepEqual(queue, [{ skill: 'cartography', amount: 80, level: 2, levelled: true }]);

  const stub = stubShell({ state: before });
  const { shell, calls, emit, registered } = stub;
  const handle = skillsUi.mount(shell);
  assert.ok(registered.has('skills'));
  shell.set(addXp(shell.state, 'cartography', 40, T).state);
  shell.set(addXp(shell.state, 'cartography', 40, T).state);
  shell.set(addXp(shell.state, 'woodcutting', 25, T).state);
  shell.set(addXp(shell.state, 'cartography', 400, T).state);
  assert.equal(calls.world.filter(([m]) => m === 'floatText').length, 0, 'nothing floats until the second ticks');
  emit('second');
  const floats = () => calls.world.filter(([m]) => m === 'floatText');
  assert.deepEqual(floats().map(([, text, tile]) => [text, tile]), [['+480 cartography xp', { x: 10, y: 12 }]]);
  assert.deepEqual(calls.bubbles.map((b) => b.lines[0]), ['Cartography is level 5.']);
  emit('second');
  assert.deepEqual(floats().map(([, text]) => text), ['+480 cartography xp', '+25 woodcutting xp'], 'one drop a second');
  emit('second');
  assert.equal(floats().length, 2);
  handle.dispose();
});

/* ------------------------------------------------------------------ the trail */

test('the trail note: its riddle in Tamsin’s hand, its sign, the hint once asked for, and the steps done', () => {
  let state = fresh();
  state = { ...state, story: { ...state.story, prologue: { ...(state.story.prologue || {}), done: { 'first-crack': T - DAY } } } };
  const trails = CONTENT.trails;
  const first = trails.trails[0].steps[0];
  assert.equal(trailUi.buildTrail(trailUi.trailPanelView(state, trails, T)).includes(trailUi.COPY.none), true, 'no note yet');
  state = handOut(state, trails, 'chest', T).state;
  let view = trailUi.trailPanelView(state, trails, T);
  let html = trailUi.buildTrail(view);
  for (const line of first.riddle) assert.ok(html.includes(visibleEsc(line)), `the riddle line “${line}”`);
  assert.match(html, /<blockquote class="letter note-text riddle-note">/);
  assert.match(html, /<footer>— T\.<\/footer>/);
  assert.match(html, /data-action="trail-hint" data-step="first-trail-1"/);
  assert.ok(!html.includes(visibleEsc(first.hint)), 'the hint waits to be asked for');
  assert.match(html, /Birch-bark · The Tollkeeper’s Riddles/);
  assert.doesNotMatch(html, /Phase 5/, 'no word about a later phase');
  // Asking for the hint keeps it asked for.
  const stub = stubShell({ state });
  const handle = trailUi.mount(stub.shell);
  const panel = stub.registered.get('trail');
  assert.equal(panel.title(), 'Riddle Notes');
  assert.equal(panel.action({ getAttribute: (n) => ({ 'data-action': 'trail-hint', 'data-step': 'first-trail-1' })[n] ?? null }), true);
  assert.ok(stub.shell.state.story.facts['hint:first-trail-1']);
  html = panel.render();
  assert.ok(html.includes(visibleEsc(first.hint)), 'the hint shows');
  assert.ok(!html.includes('data-action="trail-hint"'));
  assert.ok(relaunch(stub.shell.state, T + MIN).story.facts['hint:first-trail-1'], 'and stays asked for across a relaunch');
  // 250 facts later (glimmers heard, notes read), story.facts's newest 200 would drop it: the mount writes it again first.
  const asked = stub.shell.state.story.facts['hint:first-trail-1'];
  assert.equal(trailUi.keepHint(stub.shell.state, trails, T + MIN), stub.shell.state, 'nothing to do yet');
  let alone = stub.shell.state;
  for (let i = 0; i < 250; i += 1) {
    stub.advance(MIN);
    alone = markFact(alone, `glimmer:poi:statue:${i},0`, stub.shell.now());
    stub.shell.set(markFact(stub.shell.state, `glimmer:poi:statue:${i},0`, stub.shell.now()));
  }
  assert.ok(!Object.hasOwn(alone.story.facts, 'hint:first-trail-1'), 'left alone, the hint falls off');
  assert.ok(Object.keys(stub.shell.state.story.facts).length <= 200 && stub.shell.state.story.facts['hint:first-trail-1'] > asked);
  assert.ok(panel.render().includes(visibleEsc(first.hint)), 'and it still shows');
  assert.deepEqual([trailUi.keepHint(null, trails, T), trailUi.keepHint(state, trails, Number.NaN)], [null, state], 'pure, and calm without a clock');
  handle.dispose();
  // Solve the first step: it's listed as done, with the next note on.
  state = stepDone(stub.shell.state, trails, { kind: 'feature', target: 'kindle' }, T + HOUR);
  view = trailUi.trailPanelView(state, trails, T + HOUR);
  html = trailUi.buildTrail(view);
  assert.equal(view.step.id, 'first-trail-2');
  assert.match(html, /<li data-step="first-trail-1" data-level-state="proven">.*Solved/s);
  assert.match(html, /<li data-step="first-trail-2" data-level-state="next">.*Now/s);
  const card = trailUi.trailCard(view);
  assert.match(card, /<p class="tracker-kicker">Riddle Notes · 1 solved<\/p>/);
  assert.match(card, /data-action="tracker-hide"/);
  assert.match(trailUi.trailCard(view, { hidden: true }), /class="tracker-pill" data-action="tracker-show"/);
  assert.equal(trailUi.trailCard({ trail: null }), '');
  // Every note solved, the Tollkeeper not yet joined: he waits at the bridge.
  const bridge = trailUi.buildTrail({ ...view, step: null, done: true, atBridge: true });
  assert.match(bridge, /The Tollkeeper is waiting at the Last Bridge\./);
});

/** A line as esc() writes it. */
const visibleEsc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ------------------------------------------------------------------ the satchel */

test('the satchel shows Marks, tonics by their names, and Phase 3’s materials, essences and relics, read-only', () => {
  const state = { satchel: { marks: 1240, tonics: { cordial: 2, brew: 0 }, materials: { birch: 12, ash: 0, pine: 3 },
    essences: { 'Glitch pearl': 2 }, essenceGenres: { 'Glitch pearl': 'neon' }, relics: [{ name: 'A brass key', text: 'Warm to the touch.' }] } };
  const view = satchelUi.satchelView(state, CONTENT);
  assert.equal(view.marks, 1240);
  assert.deepEqual(view.tonics.map((t) => [t.id, t.name, t.qty]), [['cordial', 'Hearthberry cordial', 2], ['brew', 'Brew of clear morning', 0]]);
  const html = satchelUi.buildSatchel(view);
  assert.match(html, /<strong>1,240<\/strong> Marks/);
  assert.match(html, /Hearthberry cordial<\/strong> <span class="qty">× 2<\/span>/);
  assert.match(html, /Glitch pearl <span class="qty">× 2<\/span>/);
  assert.match(html, /A brass key/);
  assert.match(html, /data-material="birch".*12/s);
  assert.deepEqual(buttons(html), [], 'read-only: nothing to press');
  assert.match(satchelUi.buildSatchel(satchelUi.satchelView(fresh(), CONTENT)), /No tonics yet\./);
  assert.equal(satchelUi.satchelView(null).marks, 0);
});

/* ------------------------------------------------------------------ mounts */

test('every mount returns a handle without a container or a shell, and never throws on a hostile shell', () => {
  const modules = [log, menus, examine, wallet, chronicleView, kindleUi, hud, skillsUi, trailUi, satchelUi];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    for (const m of modules) {
      for (const shell of [null, undefined]) {
        const handle = m.mount(shell);
        assert.equal(typeof handle.dispose, 'function', `${m.id}: dispose`);
        handle.dispose();
      }
      const hostile = new Proxy({}, { get: () => { throw new Error('nope'); } });
      const handle = m.mount(hostile);
      assert.equal(typeof handle.dispose, 'function', `${m.id}: a handle from a hostile shell`);
      assert.doesNotThrow(() => handle.dispose());
      assert.doesNotThrow(() => handle.refresh?.());
    }
    // With a shell but no document, the container-owning modules are no-ops; the panel modules register.
    const stub = stubShell();
    for (const m of modules) m.mount(stub.shell).dispose();
  } finally {
    console.error = original;
  }
  assert.ok(errors.every(([label]) => typeof label === 'string' && label.startsWith('[MILO]')), 'errors are caught and labelled');
});

/* ------------------------------------------------------------------ kit.css */

test('kit.css places the Log and the menu as §12.1 says, rings every control, and fits 1000×700 clear of the place list', () => {
  const css = readFileSync(new URL('../src/ui/kit.css', import.meta.url), 'utf8');
  const rule = (selector) => {
    const i = css.indexOf(`${selector} {`);
    assert.ok(i >= 0, `kit.css has ${selector}`);
    return css.slice(i, css.indexOf('}', i));
  };
  const logRule = rule('#log');
  for (const want of ['position: fixed', 'right: 14px', 'bottom: 18px', 'z-index: 5', 'width: min(360px, 34vw)', 'max-height: 30vh']) assert.ok(logRule.includes(want), `#log: ${want}`);
  assert.ok(rule('#context-menu').includes('z-index: 13'));
  for (const selector of ['#wallet:focus-visible, #kindle-orb:focus-visible', '.hud-orb:focus-visible', '.side-tab:focus-visible', '.log-tab:focus-visible',
    '.log-lines:focus-visible', '.log-line button:focus-visible', '.log-input:focus-visible', '.menu-item:focus-visible']) {
    assert.match(rule(selector), /outline: 2px dashed var\(--focus\)/, `${selector} shows the focus ring`);
  }
  assert.ok(!/@keyframes|animation:|transition:/.test(css), 'nothing in kit.css moves');
  // The fit at 1000×700 (the stage is the window less the 32 px title bar), with the panel shut and open.
  const W = 1000;
  const H = 700 - 32;
  const panelW = Math.min(390, W - 48);
  const logBox = (open) => {
    const width = open ? Math.min(360, 0.34 * W, W - panelW - 282) : Math.min(360, 0.34 * W);
    const right = open ? panelW + 28 : 14;
    return { left: W - right - width, right: W - right, top: H - 18 - 0.3 * 700, bottom: H - 18 };
  };
  const hudBox = { left: W - 14 - 158, right: W - 14, top: 14, bottom: 14 + 96 + 8 + 4 * 30 + 3 * 6 + 8 + 24 };
  for (const open of [false, true]) {
    const box = logBox(open);
    assert.ok(box.left >= 240, `the Log (panel ${open ? 'open' : 'shut'}) keeps clear of the place list’s 240 px: ${box.left}`);
    assert.ok(box.left >= 0 && box.right <= W && box.top >= 0, 'the Log fits the window');
  }
  assert.ok(hudBox.bottom < logBox(false).top, 'the HUD and the Log never meet');
  assert.ok(rule('.stage[data-panel="open"] #hud').includes('visibility: hidden'), 'the HUD steps out of the panel’s way');
  // In a fight the minimap, the side tabs, Sneak and the Quiet button fold away (§12.1).
  const folded = css.slice(css.indexOf('.stage[data-mode="combat"] #hud'), css.indexOf('{ display: none; }', css.indexOf('.stage[data-mode="combat"] #hud')));
  for (const part of ['.hud-minimap', '.side-tabs', '.hud-sneak', '.hud-quiet']) assert.ok(folded.includes(`.stage[data-mode="combat"] #hud ${part}`), `${part} hides in a fight`);
});

// ---------------------------------------------------------------------------
// A fake DOM just big enough for the mounts: a container whose innerHTML is kept as a string,
// click delegation through closest(), and (for the Log) the few elements it queries.

function withDocument(elements) {
  const before = globalThis.document;
  globalThis.document = { documentElement: { dataset: {} }, activeElement: null, getElementById: (idOf) => elements[idOf] ?? null, addEventListener() {}, removeEventListener() {} };
  return () => { globalThis.document = before; };
}

function fakeRoot(idOf, { query = false } = {}) {
  const listeners = new Map();
  const attrs = {};
  const appended = [];
  const makeEl = (extra = {}) => ({
    attrs: {}, setAttribute(n, v) { this.attrs[n] = String(v); }, getAttribute(n) { return this.attrs[n] ?? null; }, removeAttribute(n) { delete this.attrs[n]; },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, innerHTML: '', ...extra,
  });
  const input = makeEl({ value: '', id: 'command' });
  const list = makeEl({ scrollHeight: 0, scrollTop: 0, clientHeight: 0, insertAdjacentHTML(_where, html) { appended.push(html); }, contains: () => false });
  const queried = { '#command': input, '.log-lines': list };
  return {
    id: idOf, innerHTML: '', hidden: true, attrs, appended, input,
    setAttribute(n, v) { attrs[n] = String(v); }, getAttribute(n) { return attrs[n] ?? null; }, removeAttribute(n) { delete attrs[n]; },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
    contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), querySelectorAll: () => [],
    querySelector: (selector) => (!query ? null : queried[selector] || (selector === '.log-tabs' || selector === '.log-hint' ? makeEl() : null)),
    fire(type, event = {}) { listeners.get(type)?.({ target: null, preventDefault() {}, ...event }); },
    click(attributes) { listeners.get('click')?.({ target: { getAttribute: (n) => attributes[n] ?? null, closest() { return this; } }, preventDefault() {} }); },
    key(target, event) { listeners.get('keydown')?.({ target, preventDefault() {}, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...event }); },
  };
}
