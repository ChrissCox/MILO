// The company's UI (K2, CONTRACT-PHASE4.md §12.3–§12.4, §13 wave 2 K2, §15): the combat HUD and
// the round planner, the combatant list, Setting out, the camp fire and talks, the company sheet,
// the dialogue box, the notebook page, Level up and panelart's portraits. Their builders run in
// Node: escaping, data-* attributes and focus keys, calm copy, determinism, the keyboard as a
// table, odds in bars and in words, dashed drafts, Jev's why in the planner's voice, one builder
// test each for the named pieces, the planner's reducer, and the HUD updating in place (≤ 4 ms a
// tick, no innerHTML per tick) through a small DOM made here.
//   node --test tests/ui-company.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

import { assertCalm, uncosyIn, deniedIn } from './calm.js';
import { makeCtx, fightSpec, hero, stray, createBattle, apply, A, plan, arena, OPEN } from './combat-kit.js';
import { roundView, commit, step, answer } from '../src/combat/driver.js';
import { createGrid } from '../src/combat/grid.js';
import { oddsByTarget } from '../src/combat/abilities.js';
import { emptyState4 } from '../src/state4.js';
import { loadRules } from '../src/combat/rules.js';
import { musterView } from '../src/party.js';

import * as planner from '../src/ui/planner.js';
import * as hud from '../src/ui/combat-hud.js';
import * as combatants from '../src/ui/combatants.js';
import * as muster from '../src/ui/muster.js';
import * as campView from '../src/ui/camp-view.js';
import * as company from '../src/ui/company-view.js';
import * as dialogue from '../src/ui/dialogue.js';
import * as notebookView from '../src/ui/notebook-view.js';
import * as levelup from '../src/ui/levelup.js';
import { rowsScene, portraitScene } from '../src/ui/panelart.js';

const require = createRequire(import.meta.url);
const { loadContent } = require('../electron/content.cjs');
const content = await loadContent();
const rulesLoaded = loadRules(content.combat.rules);

const IMG = '<img src=x onerror=alert(1)>';
const SCRIPT = '<script>alert(1)</script>';
const EVENING = new Date(2026, 8, 29, 20, 30).getTime();
const NOON = new Date(2026, 8, 29, 12, 0).getTime();

// ---- Helpers ---------------------------------------------------------------
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');

/** The words a builder shows: its text between tags, and its aria-label and title values. */
const wordsOf = (html) => [...html.matchAll(/>([^<]+)</g), ...html.matchAll(/\s(?:aria-label|title)="([^"]*)"/g)].map((m) => decode(m[1]).trim()).filter(Boolean);

/** Calm copy in an HTML string: no !, straight quotes, please or successfully, emoji, other games' words or uncosy ones. */
function assertCalmHtml(html, where) {
  for (const text of wordsOf(html)) {
    if (/^[\d/%.,:×·✦✧◂▸?\s−+-]*$/.test(text)) continue;
    assert.ok(!text.includes('!'), `${where}: no exclamation mark in “${text}”`);
    assert.ok(!text.includes('"') && !text.includes('\''), `${where}: curly quotes only in “${text}”`);
    assert.ok(!/\bplease\b|successfully/i.test(text), `${where}: no please or successfully in “${text}”`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where}: no emoji in “${text}”`);
    assert.deepEqual(uncosyIn(text), [], `${where}: cosy words in “${text}”`);
    assert.deepEqual(deniedIn(text), [], `${where}: no other game’s words in “${text}”`);
  }
}

/** No raw hostile markup got through. */
function assertEscaped(html, where) {
  assert.ok(!/<img\b/i.test(html), `${where}: an <img> got through`);
  assert.ok(!/<script\b/i.test(html), `${where}: a <script> got through`);
}

/** Every button and select carries data-action and a data-focus-key, and focus keys are unique. */
function assertControls(html, where, { entity = false } = {}) {
  const keys = [];
  for (const [, tag, attrs] of html.matchAll(/<(button|select)\b([^>]*)>/g)) {
    if (entity && /\sdata-entity="/.test(attrs)) continue;
    assert.match(attrs, /\sdata-action="[a-z]+-[a-z-]+"/, `${where}: a ${tag} without data-action: ${attrs.slice(0, 120)}`);
    const key = /\sdata-focus-key="([^"]+)"/.exec(attrs);
    assert.ok(key, `${where}: a ${tag} without data-focus-key: ${attrs.slice(0, 120)}`);
    keys.push(key[1]);
  }
  assert.equal(new Set(keys).size, keys.length, `${where}: focus keys are unique (${keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')})`);
}

function makeState({ tier = 2, chosen = null, roster = null, accepts = null, regulars = [], expedition = null } = {}) {
  const s4 = emptyState4();
  let party = { ...s4.party, regulars, ...(chosen ? { chosen } : {}), ...(roster ? { roster: { ...s4.party.roster, ...roster } } : {}) };
  for (const [id, text] of Object.entries(accepts || {})) party = { ...party, roster: { ...party.roster, [id]: { ...party.roster[id], notebook: { ...party.roster[id].notebook, accepts: text } } } };
  return {
    ...s4, party, expedition, settings: { eveningBell: '22:00' }, hearth: { tier }, story: { trails: {}, facts: {} }, rifts: { stitched: { real: 0, wild: 0, story: 0 } },
    tally: { sessionsFinished: 0, finishedIds: [], byCrew: { claude: 0, codex: 0, jev: 0, whisper: 0 }, features: {} },
    satchel: { materials: {}, essences: {}, essenceGenres: {}, relics: [], marks: 0, tonics: { cordial: 0, brew: 0 } },
  };
}

const ctx = makeCtx();
const threeHeroes = (over = {}) => [hero('milo', over.milo), hero('claude', over.claude), hero('codex', over.codex)];
function battleOf({ foes = null, heroes = null, ctxUse = ctx, fight = {} } = {}) {
  const spec = fightSpec({ foes: foes || [stray('f0', { x: 8, y: 2 }), stray('f1', { x: 9, y: 3, archetype: 'crawler', temperament: 'curious' })], ...fight });
  return createBattle(spec, heroes || threeHeroes(), {}, ctxUse);
}
const env = (battle, c = ctx) => ({ battle, roundView: roundView(battle, c), ctx: c });
const setPlans = (battle, intents, c = ctx) => intents.reduce((b, it) => (it.t === 'plan' ? apply(b, { t: 'plan', unitId: it.unitId, plan: it.plan }, c).battle : b), battle);
const BRACE = Object.freeze({ id: 'brace', ability: null, cost: 1, target: null, extra: 0, choice: null, cheer: false, trigger: null });
const bracePlan = (unitId) => ({ unitId, slots: [BRACE, BRACE, BRACE], reactions: {}, by: 'you', changed: [false, false, false] });
const lurk = (b, ids) => ({ ...b, units: b.units.map((u) => (ids.includes(u.id) ? { ...u, conditions: [...(u.conditions || []), { id: 'unseen', n: null, source: null, data: null }] } : u)) });
// Commits a round and steps until the unit's first action has resolved: the battle and the events so far.
function playFirst(battle, plans, unitId, c = ctx) {
  let [b, events] = [commit(battle, plans, c).battle, []];
  const done = () => events.some((ev) => ev.unit === unitId && (ev.t === 'act' || ev.t === 'improvise'));
  for (let i = 0, s; i < 60 && (b.status === 'running' || b.status === 'asking') && !done(); i += 1) {
    s = b.status === 'asking' ? answer(b, true, c) : step(b, c);
    [b, events] = [s.battle, [...events, ...s.events]];
  }
  return { battle: b, events };
}

// ---- A small DOM, enough for createCombatHud: parses the HUD's own well-formed HTML.
const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr']);
let innerHtmlSets = 0;
const dataName = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
class Elem {
  constructor(tag, doc) {
    Object.assign(this, { tagName: tag.toUpperCase(), attrs: new Map(), children: [], parent: null, text: null, ownerDocument: doc, listeners: {} });
    const el = this;
    this.style = { props: new Map(), setProperty(k, v) { this.props.set(k, v); }, getPropertyValue(k) { return this.props.get(k) || ''; } };
    this.dataset = new Proxy({}, { get: (_, key) => (typeof key === 'string' && el.attrs.has(dataName(key)) ? el.attrs.get(dataName(key)) : undefined), set: (_, key, value) => { el.attrs.set(dataName(key), String(value)); return true; } });
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; } setAttribute(n, v) { this.attrs.set(n, String(v)); if (n === 'style') this.readStyle(); }
  removeAttribute(n) { this.attrs.delete(n); } hasAttribute(n) { return this.attrs.has(n); }
  get hidden() { return this.attrs.has('hidden'); } set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get disabled() { return this.attrs.has('disabled'); } readStyle() { for (const part of (this.attrs.get('style') || '').split(';')) { const i = part.indexOf(':'); if (i > 0) this.style.props.set(part.slice(0, i).trim(), part.slice(i + 1).trim()); } }
  get textContent() { return this.text !== null ? this.text : this.children.map((c) => c.textContent).join(''); } set textContent(v) { this.children = []; this.text = String(v); }
  set innerHTML(html) { innerHtmlSets += 1; this.text = null; this.children = []; parseInto(this, html, this.ownerDocument); }
  get firstElementChild() { return this.children.find((c) => c instanceof Elem) || null; }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  closest(sel) { for (let n = this; n; n = n.parent) if (n instanceof Elem && matches(n, sel)) return n; return null; }
  *walk() { for (const c of this.children) if (c instanceof Elem) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) { return [...this.walk()].filter((e) => matches(e, sel)); } querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  focus() { this.ownerDocument.activeElement = this; } getContext() { return null; }
}
const textNode = (value, parent) => ({ value, parent, get textContent() { return this.value; } });
function matches(el, sel) {
  const m = /^([a-z]*)((?:\.[a-z-]+)*)((?:\[[a-z-]+(?:="[^"]*")?\])*)$/.exec(sel.trim());
  if (!m) throw new Error(`the test DOM can’t match ${sel}`);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const classes = (el.attrs.get('class') || '').split(/\s+/);
  if (m[2].split('.').filter(Boolean).some((c) => !classes.includes(c))) return false;
  return [...m[3].matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)].every((a) => el.attrs.has(a[1]) && (a[2] === undefined || el.attrs.get(a[1]) === a[2]));
}
function parseInto(root, html, doc) {
  const stack = [root]; const re = /<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      while (stack.length > 1 && stack[stack.length - 1].tagName !== m[1].toUpperCase()) stack.pop();
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      const el = Object.assign(new Elem(m[2], doc), { parent: top });
      for (const a of m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) el.attrs.set(a[1], a[2] === undefined ? '' : decode(a[2]));
      el.readStyle();
      top.children.push(el);
      if (!VOID.has(m[2].toLowerCase())) stack.push(el);
    } else if (m[4]) top.children.push(textNode(decode(m[4]), top));
  }
}
function fakeRoot() {
  const doc = { activeElement: null, getElementById: (idName) => (idName === 'combat-hud' ? root : null) }; const root = new Elem('div', doc); return { root, doc };
}

// ---- The keyboard, as a table ----------------------------------------------
test('the combat keys are a pure table: never Tab, [ and ] cycle, and every key §12.1 names is there', () => {
  assert.ok(planner.COMBAT_KEYS.every((r) => r.key !== 'Tab'), 'Tab is never taken');
  assert.deepEqual([planner.combatKey({ key: '[' }), planner.combatKey({ key: ']' })], [{ t: 'cycle', dir: -1 }, { t: 'cycle', dir: 1 }]);
  assert.deepEqual([planner.combatKey({ key: 'Tab' }), planner.combatKey({ key: 'Tab', shiftKey: true })], [null, null]);
  const expect = {
    ArrowUp: 'cursor', ArrowDown: 'cursor', ArrowLeft: 'cursor', ArrowRight: 'cursor', Enter: 'confirm', Escape: 'back', m: 'move', M: 'move',
    Backspace: 'clear', y: 'why', ' ': 'run', p: 'pause', g: 'guided', w: 'wrap', a: 'hand-over', '?': 'keys', 1: 'option', 0: 'option',
  };
  for (const [key, t] of Object.entries(expect)) assert.equal(planner.combatKey({ key, shiftKey: key === '?' || key === 'M' })?.t, t, key);
  assert.deepEqual(planner.combatKey({ key: 'Enter', shiftKey: true }), { t: 'accept-all' }, 'Shift+Enter accepts every draft');
  assert.deepEqual(planner.combatKey({ key: '7' }), { t: 'option', key: '7' });
  assert.equal(planner.combatKey({ key: 'm' }, { typing: true }), null, 'nothing while typing in the command bar');
  assert.deepEqual([planner.combatKey({ key: 'Enter' }, { control: true }), planner.combatKey({ key: ' ' }, { control: true })], [null, null], 'Enter and Space stay with a focused button');
  assert.deepEqual([planner.combatKey({ key: 'Enter', shiftKey: true }, { control: true }), planner.combatKey({ key: 'Enter', shiftKey: true }, { control: true, select: true })], [{ t: 'accept-all' }, null], 'Shift+Enter is no button’s own; a select keeps it');
  assert.deepEqual(planner.combatKey({ key: 'm' }, { control: true }), { t: 'move' }, 'letters still work with a button focused');
  assert.equal(planner.combatKey({ key: 'r', ctrlKey: true }), null, 'Ctrl, Alt and Meta shortcuts are left alone');
  assert.equal(planner.combatKey({ key: 'x' }), null, 'unknown keys go on down the stack');
  assert.ok(Object.isFrozen(planner.COMBAT_KEYS) && planner.COMBAT_KEYS.every((r) => Object.isFrozen(r) && Object.isFrozen(r.command)), 'the table is frozen');
  const html = planner.buildPlanner(planner.plannerView(battleOf(), roundView(battleOf(), ctx), { popover: 'keys' }, ctx));
  for (const k of ['[ ]', 'Shift+Enter', 'Esc', 'Space', '?']) assert.ok(html.includes(`<kbd>${k}</kbd>`), `the ? popover names ${k}`);
  assert.ok(!html.includes('<kbd>Tab</kbd>'), 'and never Tab');
});

// ---- The planner -----------------------------------------------------------
test('the planner shows three slots a hero (four when Quickened), each draft’s confidence and why?, and a draft under 50% is dashed', () => {
  const low = makeCtx({ draft: (b, id) => (id === 'claude' ? { unitId: id, plan: plan(id, [A.brace(), A.seek(), A.cool()], { by: 'draft' }), confidence: 38, source: 'habit', why: [{ slot: 0, layer: 'habit', text: 'You braced before a bite in 3 of 4 fights like this.', count: 3, of: 4 }], choices: [] } : { unitId: id, plan: plan(id, [A.brace()], { by: 'draft' }), confidence: 71, source: 'habit', why: [], choices: [] }) });
  const b = battleOf({ ctxUse: low });
  const view = planner.plannerView(b, roundView(b, low), {}, low, { sync: { claude: 40 } });
  assert.deepEqual(view.heroes.map((h) => h.slots.length), [3, 3, 3], 'three slots each');
  const scribe = view.heroes.find((h) => h.id === 'claude');
  assert.deepEqual([scribe.draft.confidence, scribe.draft.dashed, scribe.draft.sync], [38, true, 40]);
  assert.equal(view.heroes.find((h) => h.id === 'milo').draft.dashed, false, '71% is drawn solid');
  const html = planner.buildPlanner(view);
  assert.match(html, /<li class="hero-row" data-unit="claude"[^>]*data-dashed="true"/, 'the Scribe’s row is dashed');
  assert.match(html, /<li class="hero-row" data-unit="milo"(?![^>]*data-dashed)/, 'Milo’s isn’t');
  assert.match(html, /<span class="draft-conf" data-dashed="true">38% sure<\/span><span class="draft-sync">sync 40%<\/span>/);
  assert.match(html, /data-action="planner-why" data-unit="claude"/);
  assertControls(html, 'the planner');
  assertCalmHtml(html, 'the planner');
  assert.equal(planner.buildPlanner(view), html, 'the same view gives the same string');
  const quick = { ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, conditions: [{ id: 'quickened', n: null, source: null, data: null }] } : u)) };
  assert.deepEqual(planner.plannerView(quick, roundView(quick, ctx), {}, ctx).heroes.map((h) => h.slots.length), [3, 4, 3], 'a Quickened hero gets a fourth');
});

test('a draft is read out for screen readers with its confidence and why', () => {
  const c = makeCtx({ draft: (b, id) => ({ unitId: id, plan: plan(id, [A.strike('f0'), A.brace()], { by: 'draft' }), confidence: 38, source: 'habit', why: [{ slot: 0, layer: 'habit', text: 'New to Neon.', count: null, of: null }], choices: [] }) });
  const b = battleOf({ ctxUse: c, foes: [stray('f0', { x: 2, y: 2 })] });
  const html = planner.buildPlanner(planner.plannerView(b, roundView(b, c), {}, c));
  const readout = decode(/<p class="sr-only" id="planner-readout-claude">([^<]+)<\/p>/.exec(html)[1]);
  assert.equal(readout, 'The Scribe drafts Strike on glitch beetle, Brace. 38 percent sure: new to Neon.');
  assert.match(html, /data-action="planner-select" data-unit="claude" data-focus-key="planner-hero-claude" aria-pressed="false" aria-describedby="planner-readout-claude"/);
  assertCalm(readout, 'the readout', { proper: ['Neon', 'Strike', 'Brace'] });
});

test('why? shows the evidence, and Jev’s why is in the planner’s voice, never Jev’s', () => {
  const jevWhy = 'Jev piles the nearest stray first, in 5 of 6 fights like this.';
  const c = makeCtx({
    draft: (b, id) => ({ unitId: id, plan: plan(id, [A.strike('f0')], { by: 'draft' }), confidence: 82, source: 'habit', why: [{ slot: 0, layer: 'habit', text: id === 'jev' ? jevWhy : 'You patched the most hurt ally in 11 of 12 fights like this.', count: 5, of: 6 }, { slot: 'reaction', layer: 'rule', text: 'Shoulder: always, as you set it.', count: null, of: null }], choices: [] }),
  });
  const jev = hero('pip', { id: 'jev', name: 'Jev', kind: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev', likeness: null } });
  const b = battleOf({ ctxUse: c, heroes: [hero('milo'), jev], foes: [stray('f0', { x: 2, y: 3 })] });
  const view = planner.plannerView(b, roundView(b, c), { selected: 'jev', popover: 'why' }, c);
  assert.equal(view.why.voice, 'pictures', 'Jev’s voice is pictures');
  const pop = decode(/<div class="planner-why[^>]*>(.*?)<\/div>/.exec(planner.buildPlanner(view))[1]);
  assert.ok(pop.includes('Why Jev drafted this, 82% sure'), 'the heading speaks about Jev');
  assert.ok(pop.includes(jevWhy), 'the evidence is the planner’s sentence, as written');
  assert.ok(!/“|”/.test(pop) && !/\bI\b|\bI’/.test(pop), 'nothing in it is quoted as Jev speaking, and no first person');
  assert.ok(pop.includes('<span class="why-slot">Reaction</span>'), 'the reaction’s setting has its line');
  for (const w of view.why.lines) assertCalm(w.text, 'a why line');
  // Slots that give the same reason share a line.
  const same = 'Nothing like this in the notebook yet. The Scribe plays it careful.';
  assert.deepEqual(planner.whyLines([{ slot: 0, layer: 'personality', text: same }, { slot: 1, layer: 'personality', text: same }, { slot: 2, layer: 'personality', text: same }, { slot: 'reaction', layer: 'rule', text: 'Reactions as you set them.' }])
    .map((l) => [l.label, l.text]), [['Slots 1 to 3', same], ['Reaction', 'Reactions as you set them.']]);
  assert.deepEqual(planner.whyLines([{ slot: 0, text: 'A.' }, { slot: 1, text: 'B.' }, { slot: 2, text: 'A.' }]).map((l) => l.label), ['Slots 1 and 3', 'Slot 2']);
});

test('odds show as four bars with amounts and "?" until the target is Examined, and as words', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 2, y: 2 })] });
  const b = apply(b0, { t: 'plan', unitId: 'claude', plan: plan('claude', [A.strike('f0'), A.strike('f0')], { by: 'you' }) }, ctx).battle;
  const oddsOf = (battle, ui = {}) => planner.plannerView(battle, roundView(battle, ctx), { selected: 'claude', slot: 1, ...ui }, ctx).odds;
  const bars = oddsOf(b); assert.ok(bars && bars.rows.length === 1, 'the selected slot has odds');
  const row = bars.rows[0]; assert.equal(row.odds.bars.reduce((s, n) => s + n, 0), 100, 'whole percents summing to 100');
  assert.match(row.title, /^(Cool|Warm|Hot) \d+, [−+]?\d edge$/);
  assert.ok(row.parts.some((p) => /second attack −1/.test(p)), `the second attack's −1 is named (${row.parts})`);
  const html = planner.oddsHtml(bars);
  const items = [...html.matchAll(/<li class="odds-bar" data-degree="(crit|hit|graze|miss)" style="--pct:(\d+)%"><span>(\w+) (\d+)%([^<]*)<\/span>/g)];
  assert.deepEqual(items.map((m) => m[3]), ['Critical', 'Hit', 'Graze', 'Miss'], 'four bars');
  assert.deepEqual(items.map((m) => Number(m[4])), row.odds.bars, 'the bars shown are the odds');
  assert.ok(items.slice(0, 3).every((m) => /^ \d+\?$/.test(m[5])), 'amounts carry "?" before an Examine');
  const examined = { ...b, units: b.units.map((u) => (u.id === 'f0' ? { ...u, examined: true } : u)) };
  assert.ok(!planner.oddsHtml(oddsOf(examined)).includes('?'), 'no "?" once Examined');
  const wordsHtml = planner.oddsHtml(oddsOf(b, { odds: 'words' }));
  assert.match(wordsHtml, /<p class="odds-words">(Likely|About even|A long shot)\.( A Critical is in reach\.)?<\/p>/);
  assert.ok(!wordsHtml.includes('odds-bar'), 'no bars in words');
  assertCalmHtml(html, 'odds');
});

test('odds a telegraphed foe action can still change say "could change" and what', () => {
  const c = makeCtx({ foePlan: (b, id) => (id === 'f0' ? plan('f0', [A.stride([{ x: 4, y: 1 }, { x: 5, y: 1 }]), A.brace()], { by: 'foe' }) : null) });
  const b0 = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 1 })] }), threeHeroes(), {}, c);
  assert.ok(b0.telegraphs.some((t) => t.unitId === 'f0' && t.icon === 'move' && t.tick === 1), 'the beetle telegraphs a move in tick 1');
  const b = apply(b0, { t: 'plan', unitId: 'claude', plan: plan('claude', [A.brace(), A.strike('f0')], { by: 'you' }) }, c).battle;
  const view = planner.plannerView(b, roundView(b, c), { selected: 'claude', slot: 1 }, c); const row = view.odds.rows[0];
  assert.equal(row.odds.changeable, true);
  assert.match(row.change, /^Could change: glitch beetle means to stride to [a-t]\d+ first\.$/);
  assert.ok(planner.oddsHtml(view.odds).includes(`<p class="odds-change">${row.change}</p>`));
  assertCalm(row.change, 'could change');
  // An Unseen or sorted foe's plan is never named (its card shows none), and an Unseen foe is only "something unseen".
  const moth = { ...b.units.find((u) => u.id === 'f0'), id: 'f9', name: 'Hush moth', x: 12, y: 5 };
  const stomp = { unitId: 'f9', slot: 0, tick: 1, icon: 'area', words: 'Stomp on d2', targets: [], tiles: [{ x: 3, y: 1 }], hidden: false, falseTarget: null, adapting: null, aside: false };
  for (const [bb, why] of [[lurk({ ...b, units: [...b.units, moth], telegraphs: [stomp] }, ['f9']), 'Unseen'], [{ ...b, units: [...b.units, { ...moth, sorted: 'settled' }], telegraphs: [stomp] }, 'sorted']]) {
    assert.equal(planner.plannerView(bb, roundView(bb, c), { selected: 'claude', slot: 1 }, c).odds.rows[0].change, 'Could change before it lands.', `a ${why} foe’s stomp`);
  }
  const hid = lurk(b, ['f0']); const rv = { ...roundView(hid, c), drafts: { codex: { unitId: 'codex', plan: plan('codex', [A.strike('f0')], { by: 'draft' }), confidence: 60, why: [], source: 'personality' } } };
  const hv = planner.plannerView(hid, rv, { selected: 'claude', slot: 1 }, c); const say = planner.plannerReduce({}, { t: 'select', unitId: 'codex' }, { battle: hid, roundView: rv, ctx: c }).say;
  assert.deepEqual([hv.odds.rows[0].change, hv.odds.rows[0].name, hv.odds.words, hv.heroes.find((h) => h.id === 'claude').slots[1].words, say], ['Could change before it lands.', 'something unseen', 'Strike something unseen', 'Strike something unseen', 'The Artificer drafts Strike on something unseen. 60 percent sure.']);
  for (const s of [JSON.stringify(hv), hud.buildCombatHud(hud.buildHudView(hid, rv, { selected: 'claude', slot: 1 }, c))]) assert.ok(!/glitch beetle|stride to/i.test(s), 'the Unseen beetle’s name and plan appear nowhere');
});

test('the likeliest trouble shows under its slot', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 2, y: 2 })] });
  const b = apply(b0, { t: 'plan', unitId: 'claude', plan: plan('claude', [A.strike('f0'), A.strike('f0'), A.strike('f0'), A.strike('f0')], { by: 'you' }) }, ctx).battle;
  const withCond = (cond) => ({ ...b, units: b.units.map((u) => (u.id === 'claude' ? { ...u, conditions: [{ id: cond, n: cond === 'slowed' ? 1 : null, source: null, data: null }] } : u)) });
  const slowed = withCond('slowed');
  const slowHtml = planner.buildPlanner(planner.plannerView(slowed, roundView(slowed, ctx), {}, ctx));
  assert.match(slowHtml, /<li class="slot" data-slot="2" data-lost="(slowed|wont-fit)"[^>]*>.*?<p class="slot-trouble">This won’t fit in the round\.<\/p>/, 'a slot past the round says so');
  assert.match(slowHtml, /data-focus-key="planner-slot-claude-2"[^>]*aria-describedby="planner-notes-claude-2".*?<div class="slot-notes" id="planner-notes-claude-2"><p class="slot-trouble">/, 'and the line describes its slot’s button');
  const q = withCond('quickened');
  const ok = planner.plannerView(q, roundView(q, ctx), {}, ctx).heroes.find((h) => h.id === 'claude');
  assert.deepEqual([ok.slots.length, ok.slots[3].lost], [4, null], 'Quickened, the fourth fits');
  // A telegraphed bite on the tile you're leaving.
  const c = makeCtx({ foePlan: (bb, id) => (id === 'f0' ? plan('f0', [A.brace(), A.strike('milo')], { by: 'foe' }) : null) });
  const b1 = createBattle(fightSpec({ foes: [stray('f0', { x: 2, y: 2 })] }), threeHeroes(), {}, c);
  const moved = apply(b1, { t: 'plan', unitId: 'milo', plan: plan('milo', [A.strideTo({ x: 5, y: 4 })], { by: 'you' }) }, c).battle;
  const lines = planner.plannerView(moved, roundView(moved, c), {}, c).heroes.find((h) => h.id === 'milo').slots[0].trouble;
  assert.deepEqual(lines, ['Glitch beetle means to hit you here after you’ve moved.']);
  for (const l of lines) assertCalm(l, 'trouble');
  const hid = lurk(moved, ['f0']); // Unseen, its plan never shows, and its name only as "something unseen"
  assert.deepEqual(planner.plannerView(hid, roundView(hid, c), {}, c).heroes.find((h) => h.id === 'milo').slots[0].trouble, []);
  assert.deepEqual(['Glitch beetle may be sorted before this.', 'Milo may be sorted before this.'].map((w) => planner.veilWords(hid, w)), ['Something unseen may be sorted before this.', 'Milo may be sorted before this.']);
});

test('an area slot lists everyone it would catch, allies included', () => {
  const c = makeCtx();
  const b0 = createBattle(fightSpec({ foes: [stray('f0', { x: 3, y: 2 }), stray('f1', { x: 9, y: 4 })] }), [hero('milo'), hero('claude', { abilityIds: ['volley', 'letter'] }), hero('codex')], {}, c);
  // Volley: a burst of 1 at a tile, hitting foes; Milo stands beside the beetle, so he's caught too.
  const placed = { ...b0, units: b0.units.map((u) => (u.id === 'milo' ? { ...u, x: 3, y: 3 } : u)) };
  const b = apply(placed, { t: 'plan', unitId: 'claude', plan: plan('claude', [A.use('volley', { tile: { x: 3, y: 2 } }, { cost: 2 })], { by: 'you' }) }, c).battle;
  const slot = planner.plannerView(b, roundView(b, c), {}, c).heroes.find((h) => h.id === 'claude').slots[0];
  assert.ok(slot.caught.some((x) => x.id === 'milo' && x.ally), 'Milo, beside the beetle, is caught and marked an ally');
  assert.ok(slot.caught.some((x) => x.id === 'f0' && !x.ally), 'the beetle is caught');
  for (const x of slot.caught) assert.equal(x.ally, b.units.find((u) => u.id === x.id).side === 'party', `${x.id} is marked by its side`);
  const html = planner.buildPlanner(planner.plannerView(b, roundView(b, c), {}, c));
  assert.match(html, /<p class="slot-caught" data-helpful="false">Catches: [^<]*Milo \(ally\)[^<]*\.<\/p>/);
  assert.match(html, /<p class="slot-caught" data-helpful="false">Catches: [^<]*glitch beetle[^<]*\.<\/p>/);
  const letter = apply(placed, { t: 'plan', unitId: 'claude', plan: plan('claude', [A.use('letter', null, { cost: 3 })], { by: 'you' }) }, c).battle;
  const helpful = planner.plannerView(letter, roundView(letter, c), {}, c).heroes.find((h) => h.id === 'claude').slots[0];
  assert.ok(helpful.helpful && helpful.caught.some((x) => x.id === 'claude' && x.ally), 'a patch area catches the caster too');
});

test('reactions show Ask, Always, Under half and Never, and a Cheer can go on any slot', () => {
  const b = battleOf(); const view = planner.plannerView(b, roundView(b, ctx), {}, ctx);
  assert.deepEqual(view.heroes.find((h) => h.id === 'claude').reactions.map((r) => [r.id, r.setting]), [['parting-swipe', 'always'], ['shoulder', 'always'], ['proofread', 'never']], 'her own settings over the rules’ defaults');
  const html = planner.buildPlanner(view);
  const sel = /<select class="px-select" data-action="planner-reaction" data-unit="claude" data-reaction="shoulder"[^>]*>(.*?)<\/select>/.exec(html);
  assert.deepEqual([...sel[1].matchAll(/<option value="([a-z-]+)"( selected)?>([^<]+)<\/option>/g)].map((m) => [m[1], m[3], !!m[2]]),
    [['ask', 'Ask', false], ['always', 'Always', true], ['under-half', 'Under half', false], ['never', 'Never', false]]);
  assert.match(html, /data-action="planner-cheer" data-unit="claude" data-slot="0"[^>]*aria-pressed="false"/);
});

test('the Playbook popover edits a companion’s rules as if/then selects, up to the room Warding gives', () => {
  const unit = { id: 'claude', name: 'The Scribe' };
  const ifs = [{ id: 'anyone-below-half', words: 'anyone’s below half' }, { id: 'a-foe-telegraphs-a-bite', words: 'a stray means to bite' }];
  const thens = [{ id: 'patch-them-first', words: 'patch them first' }, { id: 'brace', words: 'brace' }];
  const html = planner.playbookHtml(planner.playbookView(unit, { rules: [{ if: 'anyone-below-half', then: 'patch-them-first' }], max: 3, ifs, thens }));
  assert.match(html, /role="dialog" aria-label="The Scribe’s playbook"/);
  assert.match(html, /<select class="px-select" data-action="planner-rule" data-unit="claude" data-index="0" data-part="if"[^>]*><option value="anyone-below-half" selected>anyone’s below half<\/option>/);
  assert.match(html, /data-part="then"[^>]*><option value="patch-them-first" selected>patch them first<\/option><option value="brace">brace<\/option>/);
  assert.ok(/data-action="planner-rule-add" data-unit="claude"/.test(html) && html.includes('Room for 3.'), 'room for more');
  const full = planner.playbookHtml(planner.playbookView(unit, { rules: [{ if: 'anyone-below-half', then: 'brace' }], max: 1, ifs, thens }));
  assert.ok(!full.includes('planner-rule-add') && full.includes('That’s all the room they have. Warding opens more.'), 'no Add past maxRules');
  const waiting = planner.playbookHtml(planner.playbookView(unit, { rules: [], max: 1 }));
  assert.ok(waiting.includes('The playbook opens once their notebook is ready.'));
  for (const h of [html, full, waiting]) { assertControls(h, 'the playbook'); assertCalmHtml(h, 'the playbook'); }
  // Through the reducer: a rule change becomes a rules intent the HUD writes with party.setRules.
  const r = planner.plannerReduce({}, { t: 'rule-set', unitId: 'claude', index: 0, part: 'then', value: 'brace', rules: [{ if: 'anyone-below-half', then: 'patch-them-first' }] }, env(battleOf()));
  assert.deepEqual(r.intents, [{ t: 'rules', unitId: 'claude', rules: [{ if: 'anyone-below-half', then: 'brace' }] }]);
});

test('the heat gauge is a thermometer with its number, its band in words, and marks at 30 and 60', () => {
  const warm = planner.heatGauge(45, { idle: 25, unitId: 'p.claude' });
  assert.match(warm, /^<span class="heat" data-band="warm" data-heat="45" role="img" aria-label="Heat 45, Warm, rests at 25" style="--heat:45%" data-cell="p\.claude\.heat">/);
  assert.match(warm, /<i class="heat-mark" style="--at:30%"><\/i><i class="heat-mark" style="--at:60%"><\/i>/);
  assert.match(warm, /<span class="heat-num" aria-hidden="true" data-cell="p\.claude\.heat\.num">45<\/span><span class="heat-band" aria-hidden="true" data-cell="p\.claude\.heat\.band">Warm<\/span>/);
  assert.match(planner.heatGauge(30), /data-band="cool"[^>]*aria-label="Heat 30, Cool"/);
  assert.match(planner.heatGauge(61), /data-band="hot"[^>]*aria-label="Heat 61, Hot"/);
  assert.ok(/data-heat="100"/.test(planner.heatGauge(250)) && /data-heat="0"/.test(planner.heatGauge(-5)), 'clamped to 0 to 100');
});

// ---- The planner's reducer -------------------------------------------------
test('the planner’s reducer picks, aims and places an action, cycles, clears, undoes and runs', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 2, y: 3 }), stray('f1', { x: 2, y: 1 })] }); let e = env(b0);
  let r = planner.plannerReduce({}, { t: 'select', unitId: 'claude' }, e);
  assert.deepEqual([r.ui.selected, r.ui.slot], ['claude', 0], 'a full draft starts at slot 1');
  assert.match(r.say, /^The Scribe drafts /, 'selecting reads the draft out');
  const strike = planner.barOptions(e.battle, e.roundView, 'claude', 0, ctx).find((o) => o.action.id === 'strike' && !o.why);
  r = planner.plannerReduce(r.ui, { t: 'option', index: strike.index }, e);
  assert.deepEqual(r.ui.pick, { option: strike.index, target: 0 }, 'two foes in reach: pick one'); const first = r.say;
  r = planner.plannerReduce(r.ui, { t: 'cycle', dir: 1 }, e);
  assert.equal(r.ui.pick.target, 1); assert.notEqual(r.say, first, '] names the next target');
  r = planner.plannerReduce(r.ui, { t: 'confirm' }, e);
  assert.equal(r.intents.length, 1); const set = r.intents[0];
  assert.deepEqual([set.t, set.plan.slots[0].id, set.plan.slots[0].target.unit], ['plan', 'strike', strike.targets[1].unit]);
  assert.equal(set.plan.by, 'draft', 'a changed draft is still a draft');
  const drafted = e.roundView.drafts.claude.plan.slots;
  assert.deepEqual(set.plan.changed, set.plan.slots.map((a, i) => JSON.stringify(a) !== JSON.stringify(drafted[i])), 'changed marks the slots that differ from the draft');
  assert.equal(r.ui.slot, 1, 'on to the next slot'); const b = setPlans(e.battle, r.intents);
  e = env(b);
  // Backspace clears the slot in hand: it waits (a Delay), so the slots after it keep their ticks;
  // waits left at the end go. Undo brings the last plan back.
  r = planner.plannerReduce({ ...r.ui, slot: 0 }, { t: 'clear' }, e);
  assert.deepEqual(r.intents[0].plan.slots, [{ ...BRACE, id: 'delay', cost: 0 }, ...b.plans.claude.slots.slice(1)], 'the cleared slot waits, the later ones untouched');
  assert.equal(r.say, 'Slot 1 cleared. The Scribe waits a tick there, so the rest keep their ticks.', 'and says so');
  const cleared = setPlans(b, r.intents);
  const ticksOf = (battle) => planner.plannerView(battle, roundView(battle, ctx), {}, ctx).heroes.find((h) => h.id === 'claude').slots.map((s) => s.tick);
  assert.deepEqual(ticksOf(cleared), ticksOf(b), 'every slot keeps its tick');
  assert.deepEqual(planner.plannerReduce(r.ui, { t: 'undo' }, env(cleared)).intents[0].plan.slots, b.plans.claude.slots, 'undo restores the plan before the clear');
  let trimmed = cleared;
  for (const slot of [2, 1]) trimmed = setPlans(trimmed, planner.plannerReduce({ selected: 'claude', slot }, { t: 'clear' }, env(trimmed)).intents);
  assert.deepEqual(trimmed.plans.claude.slots, [], 'clearing the last real action leaves no waits behind');
  // Escape backs out one step at a time, then lets the key go.
  let ui = { selected: 'claude', slot: 1, pick: { option: 0, target: 0 }, popover: 'why' }; const order = [];
  for (let i = 0; i < 6; i += 1) ({ ui, handled: order[i] } = planner.plannerReduce(ui, { t: 'back' }, e));
  assert.deepEqual(order, [true, true, true, true, false, false]);
  // Space runs; Wrap it up only when offered.
  assert.deepEqual(planner.plannerReduce({}, { t: 'run' }, e).intents, [{ t: 'run' }]);
  const noWrap = planner.plannerReduce({}, { t: 'wrap' }, { ...e, roundView: { ...e.roundView, canWrap: false } });
  assert.deepEqual([noWrap.intents, noWrap.say], [[], 'Not yet: there’s still a fight in them.']);
  assert.deepEqual(planner.plannerReduce({}, { t: 'wrap' }, { ...e, roundView: { ...e.roundView, canWrap: true } }).intents, [{ t: 'wrap' }]);
  // Handed over, Space takes the company back.
  const handed = planner.plannerReduce({}, { t: 'hand-over' }, e); assert.equal(handed.ui.handed, true);
  assert.deepEqual(planner.plannerReduce(handed.ui, { t: 'run' }, e).intents, [{ t: 'take-back' }]);
});

test('Enter accepts the selected draft, Shift+Enter every draft, and a Cheer or a reaction changes the plan', () => {
  const e = env(battleOf()); const one = planner.plannerReduce({ selected: 'milo', slot: 0 }, { t: 'confirm' }, e);
  assert.deepEqual([one.intents.length, one.intents[0].plan.by, one.intents[0].plan.changed], [1, 'draft', [false, false, false]]);
  assert.deepEqual(planner.plannerReduce({}, { t: 'accept-all' }, e).intents.map((i) => i.unitId), ['milo', 'claude', 'codex']);
  assert.equal(planner.plannerReduce({}, { t: 'cheer', unitId: 'milo', slot: 0 }, e).say, 'No Cheers left to spend.', 'no Cheers held');
  const cheered = { ...e.battle, cheers: 1 };
  const withCheer = planner.plannerReduce({}, { t: 'cheer', unitId: 'milo', slot: 0 }, env(cheered));
  assert.equal(withCheer.intents[0].plan.slots[0].cheer, true); const b2 = setPlans(cheered, withCheer.intents);
  assert.equal(b2.plans.milo.slots[0].cheer, true, 'the battle keeps the Cheer');
  const off = planner.plannerReduce({}, { t: 'cheer', unitId: 'milo', slot: 0 }, env(b2));
  assert.deepEqual(off.intents, [{ t: 'cheer', unitId: 'milo', slot: 0, on: false }], 'a set plan takes the cheer command');
  const react = planner.plannerReduce({}, { t: 'reaction', unitId: 'claude', reactionId: 'shoulder', setting: 'under-half' }, e);
  assert.deepEqual([react.intents[0].plan.reactions.shoulder, react.say], ['under-half', 'Shoulder: Under half.']);
});

test('ghosted suggestions in Command: pale words in a Mine hero’s empty slots while the switch is on, taken as your own', () => {
  const c = makeCtx({ draft: (b, id) => ({ unitId: id, plan: plan(id, [A.brace(), A.seek()], { by: 'draft' }), confidence: 60, source: 'habit', why: [], choices: [] }) });
  const b = battleOf({ ctxUse: c, heroes: ['milo', 'claude', 'codex'].map((id) => hero(id, { control: 'mine' })) });
  const rv = roundView(b, c);
  const e = { battle: b, roundView: { ...rv, ghosts: { claude: c.minds.draft(b, 'claude') } }, ctx: c };
  const scribe = planner.plannerView(b, e.roundView, {}, c).heroes.find((h) => h.id === 'claude');
  assert.deepEqual([rv.drafts, scribe.draft, scribe.ghost, scribe.slots.map((s) => s.ghost)], [{}, null, true, ['Brace', 'Seek', null]], 'Command drafts nothing; the ghost is only a suggestion');
  const html = planner.buildPlanner(planner.plannerView(b, e.roundView, {}, c));
  assert.match(html, /<li class="slot" data-slot="0" data-empty="true" data-ghost="true"[^>]*><button[^>]*aria-label="Slot 1: Empty, suggested: Brace"><span class="slot-n"[^>]*>1<\/span><span class="slot-words">Empty<\/span><span class="slot-ghost" aria-hidden="true">Brace<\/span>/);
  assert.match(html, /data-action="planner-accept" data-unit="claude" data-focus-key="planner-accept-claude">Use the suggestion<\/button>/);
  const took = planner.plannerReduce({ selected: 'claude', slot: 0 }, { t: 'confirm' }, e);
  assert.deepEqual([took.intents[0].plan.slots.map((a) => a.id), took.intents[0].plan.by, took.say], [['brace', 'seek'], 'you', 'The Scribe takes the suggestion.'], 'Enter takes it, written as yours');
  // Through mount: the HUD asks the fight's minds once a round per hero, only while party.calm.ghosts is on.
  const { root, doc } = fakeRoot(); const handlers = {};
  let [state, asked] = [makeState(), 0];
  const counted = { ...c, minds: { ...c.minds, draft: (bb, id) => { asked += 1; return c.minds.draft(bb, id); } } };
  hud.mount({ get state() { return state; }, set(n) { state = n; }, now: () => NOON, content: () => content, world: () => null, on: (ev, fn) => { handlers[ev] = fn; return () => {}; }, keys: { push: () => () => {} } }, { document: doc });
  const send = () => handlers.combat({ live: true, battle: b, roundView: rv, ctx: counted, command: () => {} });
  send();
  assert.deepEqual([root.querySelectorAll('li[data-ghost="true"]').length, asked], [0, 0], 'off by default');
  state = { ...state, party: { ...state.party, calm: { ...state.party.calm, ghosts: true } } };
  send();
  send();
  assert.deepEqual([root.querySelectorAll('li[data-ghost="true"]').length, asked], [6, 3], 'on: two pale slots each, one draft a hero');
});

test('a Stride picks its tile with the cursor, and the overlay shows the reach and the path', () => {
  const e = env(battleOf());
  const stride = planner.barOptions(e.battle, e.roundView, 'milo', 0, ctx).find((o) => o.action.id === 'stride');
  let r = planner.plannerReduce({ selected: 'milo', slot: 0 }, { t: 'move' }, e);
  assert.equal(r.ui.pick.option, stride.index, 'M picks Stride'); const start = r.ui.cursor;
  r = planner.plannerReduce(r.ui, { t: 'cursor', dx: 2, dy: 0 }, e);
  assert.deepEqual(r.ui.cursor, { x: start.x + 2, y: start.y });
  const overlay = planner.plannerOverlay(e.battle, e.roundView, r.ui, ctx);
  assert.ok(overlay.selected === 'milo' && overlay.reachable.length > 4);
  assert.ok(overlay.path && overlay.path.tiles.length >= 2 && overlay.path.of === 4, 'Milo strides 4');
  r = planner.plannerReduce(r.ui, { t: 'confirm' }, e);
  assert.deepEqual(r.intents[0].plan.slots[0].target.path.at(-1), { x: start.x + 2, y: start.y });
  // The engine's pointer: a tile click confirms a pick.
  const p = planner.plannerReduce(planner.plannerReduce({ selected: 'milo', slot: 0 }, { t: 'move' }, e).ui, { t: 'pointer', kind: 'tile', tile: { x: start.x + 1, y: start.y + 1 } }, e);
  assert.deepEqual(p.intents[0].plan.slots[0].target.path.at(-1), { x: start.x + 1, y: start.y + 1 });
});

test('a tile pick the kernel would refuse is refused calmly, one it takes is walked, and the overlay agrees with the pick', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 13, y: 3 }), stray('f1', { x: 14, y: 4 })] }); const e = env(b0);
  const [milo, claude, codex] = ['milo', 'claude', 'codex'].map((id) => b0.units.find((u) => u.id === id));
  const at = (dx, dy, u = milo) => ({ x: u.x + dx, y: u.y + dy });
  const optionOf = (unitId, actionId, ability = null) => planner.barOptions(e.battle, e.roundView, unitId, 0, ctx).find((o) => o.action.id === actionId && (!ability || o.action.ability === ability) && !o.why);
  const pickFor = (unitId, actionId, ability) => planner.plannerReduce({ selected: unitId, slot: 0 }, { t: 'option', index: optionOf(unitId, actionId, ability).index }, e).ui;
  const aimAt = (ui, tile) => planner.plannerReduce(ui, { t: 'pointer', kind: 'tile', tile }, e);
  const say = (ui, tile) => aimAt(ui, tile).say;
  const target = (ui, tile) => aimAt(ui, tile).intents[0].plan.slots[0].target;
  // A Stride past Milo's speed (4): nothing is planned, the pick stays open, and the pick line says why.
  const stride = pickFor('milo', 'stride'); const [far, near] = [at(8, 0), at(3, 0)];
  const tooFar = 'That’s further than Milo can go in one Stride.'; const refused = aimAt(stride, far);
  assert.deepEqual([refused.intents, refused.say, !!refused.ui.pick], [[], tooFar, true], 'nothing planned, and the pick stays open');
  const shown = planner.plannerView(e.battle, e.roundView, { ...refused.ui, cursor: far }, ctx);
  assert.equal(shown.pick.trouble, tooFar);
  assert.ok(planner.buildPlanner(shown).includes(`<span class="pick-trouble">${tooFar}</span>`));
  assertCalmHtml(planner.buildPlanner(shown), 'a pick with its Confirm and Back');
  // The kernel agrees: that Stride written by hand improvises as blocked, and one the pick takes is walked.
  const byHand = { unitId: 'milo', slots: [{ ...BRACE, id: 'stride', target: { path: createGrid(b0, ctx.rules).path('milo', far) } }], reactions: {}, by: 'you', changed: [false] };
  const others = { claude: bracePlan('claude'), codex: bracePlan('codex') };
  assert.ok(playFirst(b0, { milo: byHand, ...others }, 'milo').events.some((ev) => ev.t === 'improvise' && ev.unit === 'milo' && ev.why === 'blocked'), 'the kernel refuses it too');
  const placed = aimAt(stride, near); assert.match(placed.say, /^Stride to [a-z]+\d+ in slot 1\.$/);
  const walked = playFirst(b0, { milo: placed.intents[0].plan, ...others }, 'milo');
  assert.ok(!walked.events.some((ev) => ev.t === 'improvise' && ev.unit === 'milo'), 'no improvising');
  const there = walked.battle.units.find((u) => u.id === 'milo');
  assert.deepEqual({ x: there.x, y: there.y }, near, 'Milo gets there');
  // The overlay's reach is exactly the tiles the pick takes.
  const reach = new Set(planner.plannerOverlay(e.battle, e.roundView, stride, ctx).reachable.map((t) => `${t.x},${t.y}`));
  const aim = planner.tileAim(e.battle, e.roundView, 'milo', optionOf('milo', 'stride'), 0, ctx);
  const { rect } = e.battle.arena;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) assert.equal(!!aim.aim({ x, y }).target, reach.has(`${x},${y}`), `the overlay and the pick agree at ${x},${y}`);
  }
  // Where a move can't end (itself, a friend, a wall); a Step goes one tile, a Jump as far as Might allows (Milo's 1).
  const [stepUi, jumpUi] = [pickFor('milo', 'step'), pickFor('milo', 'jump')];
  assert.deepEqual([say(stride, at(0, 0)), say(stride, claude), say(stepUi, at(2, 0)), say(stepUi, at(0, -1)), say(jumpUi, at(2, 0))],
    ['Milo is already there.', 'The Scribe is standing there.', 'A Step goes one tile.', 'There’s no room to stand there.', 'That’s further than Milo can jump.']);
  assert.deepEqual([target(stepUi, at(1, 0)), target(jumpUi, at(1, 0))], [{ tile: at(1, 0) }, { tile: at(1, 0) }]);
  const steps = planner.plannerOverlay(e.battle, e.roundView, stepUi, ctx).reachable;
  assert.ok(steps.length >= 2 && steps.every((t) => Math.max(Math.abs(t.x - milo.x), Math.abs(t.y - milo.y)) === 1), 'a Step’s overlay is the tiles beside Milo');
  // An ability's tile: its range (the Artificer's pop-up cover reaches 3).
  const cover = pickFor('codex', 'use', 'pop-up-cover'); assert.equal(say(cover, at(5, 0, codex)), 'That’s out of range.');
  assert.deepEqual(target(cover, at(2, 0, codex)), { tile: at(2, 0, codex) });
  for (const words of [tooFar, 'A Step goes one tile.', 'That’s further than Milo can jump.', 'That’s out of range.', 'The Scribe is standing there.']) assertCalm(words, 'a refused pick', { proper: ['Stride', 'Step'] });
});

test('the overlay carries the foes’ telegraphs (a hidden one as “?” only) and every visible area’s or stomp’s tiles as threats, through the round too', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 8, y: 2 }), stray('f1', { x: 9, y: 3 }), stray('f2', { x: 10, y: 4 })] });
  const tele = (unitId, over) => ({ unitId, slot: 0, tick: 1, icon: 'strike', words: 'Bite Milo', targets: ['milo'], tiles: [{ x: 3, y: 3 }], hidden: false, falseTarget: null, adapting: null, aside: false, ...over });
  const area = [{ x: 4, y: 4 }, { x: 5, y: 4 }]; const unseen = { id: 'unseen', n: null, source: null, data: null };
  const b = { ...b0, units: b0.units.map((u) => (u.id === 'f2' ? { ...u, conditions: [unseen] } : u)), telegraphs: [
    tele('f0', { icon: 'area', words: 'Stomp: stand on the plan', targets: [], tiles: [...area, area[0]] }), tele('f0', { slot: 1, tick: 2, falseTarget: 'claude' }),
    tele('f1', { icon: 'area', hidden: true, tiles: [{ x: 7, y: 7 }], adapting: 'Holding back.', aside: true }), tele('f2', { icon: 'area', tiles: [{ x: 9, y: 9 }] })] };
  const rv = roundView(b, ctx); const o = planner.plannerOverlay(b, rv, {}, ctx);
  assert.deepEqual(o.threats, area, 'the visible area’s tiles, once each: never a hidden or an Unseen foe’s');
  assert.deepEqual(o.telegraphs.map((t) => [t.unitId, t.words, t.targets, t.tiles.length, t.adapting, t.aside]), [['f0', 'Stomp: stand on the plan', [], 3, null, false], ['f0', 'Bite Milo', ['claude'], 1, null, false], ['f1', '?', [], 0, null, false]], 'the Void lie names its false target');
  assert.deepEqual(Object.keys(planner.plannerOverlay(b, rv, { selected: 'milo' }, ctx)), ['selected', 'telegraphs', 'threats'], 'a hero selected keeps them');
  const run = { ...commit(b, {}, ctx).battle, telegraphs: b.telegraphs }; const at = (status) => planner.plannerOverlay({ ...run, status }, rv, { selected: 'milo', slot: 0 }, ctx);
  assert.deepEqual([run.status, Object.keys(at('running')), at('running').threats, at('asking').threats, at('won')], ['running', ['telegraphs', 'threats'], area, area, null], 'while the round runs only these, so a stomp’s tiles stay until it lands; none once it’s over');
});

test('an action set in a later, empty slot keeps that slot’s tick: the slots before it wait with a Delay', () => {
  const e = env(battleOf({ heroes: [hero('milo', { control: 'mine' }), hero('claude'), hero('codex')] }));
  assert.equal(e.roundView.drafts.milo, undefined, 'Milo’s is yours to write');
  const brace = planner.barOptions(e.battle, e.roundView, 'milo', 2, ctx).find((o) => o.action.id === 'brace');
  const place = (slot) => planner.plannerReduce(planner.plannerReduce(null, { t: 'slot', unitId: 'milo', slot }, e).ui, { t: 'option', index: brace.index }, e);
  const r = place(2); assert.equal(r.say, 'Brace in slot 3, after a Delay in slots 1 and 2.');
  assertCalm(r.say, 'placing in a later slot', { proper: ['Brace', 'Delay'] });
  const b1 = setPlans(e.battle, r.intents);
  assert.deepEqual(b1.plans.milo.slots.map((a) => a.id), ['delay', 'delay', 'brace'], 'the battle takes the plan');
  const rows = planner.plannerView(b1, roundView(b1, ctx), r.ui, ctx).heroes.find((h) => h.id === 'milo').slots;
  assert.deepEqual(rows.map((s) => `${s.index + 1}:${s.words}@${s.tick}`), ['1:Delay@1', '2:Delay@2', '3:Brace@3'], 'Brace lands in tick 3, as its slot says');
  assert.deepEqual([place(1).say, place(0).say], ['Brace in slot 2, after a Delay in slot 1.', 'Brace in slot 1.']);
  assert.deepEqual(place(0).intents[0].plan.slots.map((a) => a.id), ['brace'], 'the next free slot takes it as it is');
  // A 2-action activity takes two ticks, so only the slots a tick is left for show, and each keeps its tick.
  const b2 = setPlans(battleOf({ heroes: [hero('milo'), hero('claude', { control: 'mine', abilityIds: ['volley'] }), hero('codex')] }), [{ t: 'plan', unitId: 'claude', plan: plan('claude', [A.use('volley', { tile: { x: 8, y: 2 } }, { cost: 2 })], { by: 'you' }) }]);
  const e2 = env(b2);
  const rowsOf = (b) => planner.plannerView(b, roundView(b, ctx), {}, ctx).heroes.find((h) => h.id === 'claude').slots.map((s) => `${s.index + 1}:${s.empty ? 'Empty' : s.action.id}@${s.tick}`);
  assert.deepEqual(rowsOf(b2), ['1:use@1', '2:Empty@3'], 'Volley takes ticks 1 and 2: one empty slot, at tick 3');
  const ui2 = planner.plannerReduce(null, { t: 'slot', unitId: 'claude', slot: 2 }, e2).ui;
  assert.equal(ui2.slot, 1, 'a slot with no tick left can’t be picked');
  const braced = planner.plannerReduce(ui2, { t: 'option', index: planner.barOptions(b2, e2.roundView, 'claude', 1, ctx).find((o) => o.action.id === 'brace').index }, e2);
  assert.deepEqual([braced.say, rowsOf(setPlans(b2, braced.intents))], ['Brace in slot 2.', ['1:use@1', '2:brace@3']], 'Brace lands in tick 3, as its slot said');
  assert.equal(planner.plannerReduce({ selected: 'claude', slot: 2 }, { t: 'option', key: '1' }, e2).handled, false, 'nor can a key place one past the round');
});

test('the bar shows every option: nine a page behind More (0), with the right page count', () => {
  const e = env(battleOf());
  for (const [unitId, slot] of [['milo', 0], ['claude', 1], ['codex', 2]]) {
    const all = planner.barOptions(e.battle, e.roundView, unitId, slot, ctx);
    const pages = Math.ceil(all.length / 9);
    assert.ok(pages >= 3, `${unitId} has ${all.length} options`);
    const seen = [];
    let ui = { selected: unitId, slot, page: 0 };
    for (let p = 0; p < pages; p += 1, ui = planner.plannerReduce(ui, { t: 'option', key: '0' }, e).ui) {
      const view = planner.plannerView(e.battle, e.roundView, ui, ctx);
      assert.deepEqual([view.bar.page, view.bar.pages, view.bar.options.length], [p, pages, p < pages - 1 ? 9 : all.length - 9 * (pages - 1)], 'nine a page, the rest on the last');
      assert.deepEqual(view.bar.options.map((o) => o.key), view.bar.options.map((_, i) => String(i + 1)), 'keys 1 to 9; 0 is More');
      assert.ok(planner.buildPlanner(view).includes(`aria-label="More actions, page ${p + 1} of ${pages}"`), 'More says which page');
      assert.match(planner.buildPlanner(view), /<div class="planner-bar" role="group" aria-label="Actions for /, 'a group: the arrows are the tile cursor’s, never a toolbar’s');
      seen.push(...view.bar.options.map((o) => o.index));
    }
    assert.equal(ui.page, 0, 'More wraps back to the first page');
    assert.deepEqual(seen.sort((a, b) => a - b), all.map((o) => o.index).sort((a, b) => a - b), 'every option shows, once');
    assert.deepEqual([pages - 2, pages - 1].map((page) => planner.plannerReduce({ selected: unitId, slot, page }, { t: 'more' }, e).ui.page), [pages - 1, 0], 'the More button too');
  }
});

test('the Playbook opens between rounds for every hero standing, “Let them choose” and “On their own” too', () => {
  const b = battleOf({ heroes: [hero('milo'), hero('claude', { control: 'choose' }), hero('codex', { control: 'auto' })] });
  const rv = roundView(b, ctx); const html = planner.buildPlanner(planner.plannerView(b, rv, {}, ctx));
  for (const id of ['milo', 'claude', 'codex']) assert.ok(html.includes(`data-focus-key="planner-rules-${id}"`), `${id} has a Playbook`);
  const r = planner.plannerReduce({}, { t: 'rules', unitId: 'claude' }, env(b));
  const pb = planner.plannerView(b, rv, r.ui, ctx, { playbook: { rules: [], max: 2, ifs: [{ id: 'a', words: 'anyone’s below half' }], thens: [{ id: 'b', words: 'patch them first' }] } }).playbook;
  assert.deepEqual([pb.unitId, pb.canEdit], ['claude', true], 'the Scribe’s rules can be edited though she chooses her own turns');
  assert.ok(planner.playbookHtml(pb).includes('data-action="planner-rule-add"'));
  assert.ok(!planner.buildPlanner(planner.plannerView({ ...b, status: 'running' }, rv, {}, ctx)).includes('planner-rules-'), 'not while the round runs');
});

// ---- The HUD ---------------------------------------------------------------
test('the HUD’s ribbon shows sides by shape and ◂ on the actor, and the title says the tick', () => {
  let b = battleOf(); const v0 = hud.buildHudView(b, roundView(b, ctx), {}, ctx);
  assert.equal(v0.title, 'Round 1 · planning');
  assert.deepEqual([...new Set(v0.ribbon.map((r) => `${r.side}:${r.shape}`))].sort(), ['foe:diamond', 'party:circle']);
  b = step(commit(b, {}, ctx).battle, ctx).battle;
  const v1 = hud.buildHudView(b, roundView(b, ctx), {}, ctx); assert.match(v1.title, /^Round 1 · tick [1-3] of 3$/);
  const acting = v1.ribbon.filter((r) => r.acting); assert.equal(acting.length, 1, 'one actor at a time');
  const html = hud.buildCombatHud(v1);
  assert.match(html, new RegExp(`<li class="ribbon-unit" data-side="[a-z]+" data-unit="${acting[0].id}" data-acting="true"`));
  assert.match(html, /<span class="shape" data-shape="diamond" aria-hidden="true"><\/span>/);
  const neutral = { ...b, units: [...b.units, { ...b.units.find((u) => u.id === 'f1'), id: 'f9', side: 'neutral', name: 'Kind star' }], order: [...b.order, 'f9'] };
  assert.equal(hud.buildHudView(neutral, roundView(neutral, ctx), {}, ctx).ribbon.find((r) => r.id === 'f9').shape, 'square', 'neutrals on squares');
});

test('portraits show Integrity notched every 10 with numbers, Buffer, conditions with numbers, charges as ✦, the control badge, and a sustained spell’s flame', () => {
  const b0 = battleOf({ heroes: [hero('milo'), hero('claude', { maxIntegrity: 34, integrity: 20 }), hero('codex')] });
  const b = { ...b0, units: b0.units.map((u) => (u.id === 'claude' ? { ...u, buffer: 4, conditions: [{ id: 'spooked', n: 1, source: null, data: null }, { id: 'exposed', n: null, source: null, data: null }], charges: { ...u.charges, left: 1, max: 2 } } : u)) };
  const v = hud.buildHudView(b, roundView(b, ctx), {}, ctx); const p = v.portraits.find((x) => x.id === 'claude');
  assert.deepEqual([p.notches, p.share], [[29, 59, 88], 59], 'a notch at 10, 20 and 30 of 34');
  const html = hud.buildCombatHud(v);
  assert.match(html, /<span class="int-bar" role="img" aria-label="20 of 34 Integrity" data-cell="p\.claude\.bar"><span class="int-fill" style="--int:59%" data-cell="p\.claude\.fill"><\/span><i class="notch" style="--at:29%"><\/i><i class="notch" style="--at:59%"><\/i><i class="notch" style="--at:88%"><\/i><\/span>/);
  assert.match(html, /<span class="int-num" data-cell="p\.claude\.int">20\/34<\/span><span class="buffer" data-cell="p\.claude\.buffer">Buffer 4<\/span>/);
  assert.match(html, /<span class="cond" data-cond="spooked" data-cell="p\.claude\.c0">Spooked 1<\/span><span class="cond" data-cond="exposed" data-cell="p\.claude\.c1">Exposed<\/span><span class="cond" hidden data-cell="p\.claude\.c2"><\/span>/);
  assert.match(html, /<span class="charges" role="img" aria-label="1 of 2 charges" data-cell="p\.claude\.charges">✦✧<\/span>/);
  assert.match(html, /<span class="control-badge" data-control="review" data-cell="p\.claude\.control">Review<\/span>/);
  assert.match(html, /data-cell="p\.claude\.heat"/, 'each hero’s heat gauge');
  // A sustained spell's flame on the caster.
  const s = { ...b0, sustained: [{ unitId: 'claude', abilityId: 'inkdarts', rounds: 2, target: null, cost: 2 }] };
  const sv = hud.buildHudView(s, roundView(s, ctx), {}, ctx);
  assert.deepEqual(sv.portraits.find((x) => x.id === 'claude').sustained, { abilityId: 'inkdarts', name: 'Inkdarts', rounds: 2 });
  const shtml = hud.buildCombatHud(sv);
  assert.match(shtml, /<span class="flame" role="img" aria-label="Sustaining Inkdarts" data-cell="p\.claude\.flame"><span class="flame-name">Inkdarts<\/span><\/span>/);
  assert.match(shtml, /<span class="flame" hidden role="img" aria-label="" data-cell="p\.milo\.flame">/, 'no flame without a sustained spell');
});

test('a stray’s bar shows its check segments, and a lead’s bar its phases', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 8, y: 2 })] });
  const b = { ...b0, units: b0.units.map((u) => (u.id === 'f0' ? { ...u, integrity: 10 } : u)) };
  const v = hud.buildHudView(b, roundView(b, ctx), {}, ctx);
  assert.deepEqual(v.foes[0].bar, { kind: 'checks', checked: 5 }, 'half its Integrity gone: five of ten checked');
  const segs = [...hud.buildCombatHud(v).matchAll(/<i class="seg"( data-checked="true")? data-cell="f\.f0\.s(\d)"><\/i>/g)];
  assert.deepEqual(segs.map((m) => !!m[1]), [true, true, true, true, true, false, false, false, false, false], 'ten segments, a tenth of its max each');
  const sorted = { ...b, units: b.units.map((u) => (u.id === 'f0' ? { ...u, sorted: 'settled' } : u)) };
  assert.equal(hud.buildHudView(sorted, roundView(sorted, ctx), {}, ctx).foes[0].bar.checked, 10, 'sorted, every check is green');
  const lead = { ...stray('lead', { x: 8, y: 2, name: 'The Night Clerk' }), rank: 'lead', maxIntegrity: 30, integrity: 21 };
  const lb0 = battleOf({ foes: [], fight: { leadUnit: lead } });
  const lb = { ...lb0, lead: { ...(lb0.lead || {}), unitId: 'lead', phase: 'twist', bar: 1, bars: [30, 30, 40] }, units: lb0.units.map((u) => (u.id === 'lead' ? { ...u, integrity: 21, maxIntegrity: 30 } : u)) };
  const lv = hud.buildHudView(lb, roundView(lb, ctx), {}, ctx);
  assert.deepEqual(lv.foes.find((f) => f.id === 'lead').bar.phases.map((p) => [p.name, p.state, p.checked]), [['Opening', 'done', 10], ['Twist', 'now', 3], ['Last page', 'next', 0]]);
  const lhtml = hud.buildCombatHud(lv);
  assert.match(lhtml, /<span class="phase" data-state="now" data-cell="f\.lead\.ph1"><span class="phase-name">Twist<\/span>/);
  assert.match(lhtml, /aria-label="21 of 30 Integrity, twist"/);
});

test('calm pips sit beside each kind’s telegraphs, and every card of a kind keeps up in place', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 8, y: 2, talkKind: 'k0' }), stray('f1', { x: 9, y: 3, talkKind: 'k1' }), stray('f2', { x: 9, y: 5, talkKind: 'k0' })] });
  const withCalm = (calm) => ({ ...b0, talk: { k0: { calm, need: 3, done: false } } });
  const v = hud.buildHudView(withCalm(1), roundView(b0, ctx), {}, ctx);
  assert.deepEqual(v.calm, [{ kind: 'k0', name: 'Glitch beetle', calm: 1, need: 3, done: false }]);
  const html = hud.buildCombatHud(v);
  const card = /<li class="foe-card" data-unit="f0"[^>]*>(.*?)<\/li><li class="foe-card"/.exec(html)[1];
  assert.match(card, /<span class="calm" data-kind="k0" role="img" aria-label="Calm 1 of 3" data-cell="f\.f0\.calm"><i class="pip" data-on="true" data-cell="f\.f0\.calm\.0"><\/i><i class="pip" data-cell="f\.f0\.calm\.1"><\/i><i class="pip" data-cell="f\.f0\.calm\.2"><\/i><\/span>/);
  assert.ok(card.indexOf('class="calm"') < card.indexOf('class="teles"'), 'beside its telegraphs');
  assert.ok(!/<li class="foe-card" data-unit="f1"[^>]*>(.*?)<\/li>/.exec(html)[1].includes('class="calm"'), 'a kind nobody’s talked to shows no pips');
  // Two cards of one kind: calm 1 → 2 patches both in place, with no re-render.
  const { root } = fakeRoot(); const h = hud.createCombatHud(root, {});
  h.show(v);
  assert.equal(h.update(hud.buildHudView(withCalm(2), roundView(b0, ctx), {}, ctx)), false, 'no region re-renders');
  const pips = (id) => root.querySelector(`[data-cell="f.${id}.calm"]`).querySelectorAll('i').map((p) => (p.getAttribute('data-on') ? 1 : 0)).join('');
  assert.deepEqual(['f0', 'f2'].map((id) => [pips(id), root.querySelector(`[data-cell="f.${id}.calm"]`).getAttribute('aria-label')]), [['110', 'Calm 2 of 3'], ['110', 'Calm 2 of 3']]);
});

test('telegraphs show in words by tick, "?" when hidden, and the adapting eye with its words', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 8, y: 2 })] }); const t = b0.telegraphs.filter((x) => x.unitId === 'f0');
  // A hidden one shows '?' only: no eye's words (its title) and no aside, whatever the Battle still carries (§18.3 item 5).
  const b = { ...b0, telegraphs: [{ ...t[0], adapting: 'Staying off the stairs: Dusty’s climbed them twice.' }, { ...t[1], hidden: true, adapting: 'Holding back: you’ve gone for Milo twice.', aside: true }, ...t.slice(2)] };
  const html = hud.buildCombatHud(hud.buildHudView(b, roundView(b, ctx), {}, ctx));
  assert.match(html, /<li class="tele" data-icon="[a-z]+" data-adapting="true" title="Staying off the stairs: Dusty’s climbed them twice\." aria-label="Tick 1: [^"]+\. Staying off the stairs/);
  assert.match(html, /<li class="tele" data-icon="hidden" aria-label="Tick \d: something hidden" data-cell="f\.f0\.t1"><span class="tele-tick"[^>]*>\d<\/span><span class="tele-words" data-cell="f\.f0\.t1\.words">\?<\/span><\/li>/);
  const { root } = fakeRoot(); const h = hud.createCombatHud(root, {}); h.show(hud.buildHudView(b, roundView(b, ctx), {}, ctx));
  h.update(hud.buildHudView({ ...b, telegraphs: [{ ...b.telegraphs[0], hidden: true }, ...b.telegraphs.slice(1)] }, roundView(b, ctx), {}, ctx));
  assert.deepEqual(['title', 'data-adapting', 'aria-label'].map((a) => root.querySelector('[data-cell="f.f0.t0"]').getAttribute(a)), [null, null, 'Tick 1: something hidden'], 'gone hidden in place');
  // A lead's card keeps eight lines, so the mechanic's own (the stomp, listed last) still shows.
  const lb = battleOf({ foes: [], fight: { leadUnit: { ...stray('lead', { x: 8, y: 2 }), rank: 'lead' } } });
  const eight = Array.from({ length: 8 }, (_, i) => ({ ...t[0], unitId: 'lead', slot: i, tick: 1 + (i % 3), icon: i === 7 ? 'area' : 'strike', words: i === 7 ? 'Stomp: stand on the plan' : `Strike ${i + 1}`, aside: i > 3 && i < 7 }));
  const lv = hud.buildHudView({ ...lb, telegraphs: eight }, roundView(lb, ctx), {}, ctx);
  assert.deepEqual([lv.foes.find((f) => f.id === 'lead').telegraphs.length, /data-cell="f\.lead\.t7\.words">Stomp: stand on the plan</.test(hud.buildCombatHud(lv))], [8, true]);
});

test('the noise banner, Cheers and playback 1×, 2× and 4× sit above Run', () => {
  const b = { ...battleOf(), cheers: 2 }; const v = hud.buildHudView(b, roundView(b, ctx), { playback: 2 }, ctx);
  assert.equal(v.noise.words, 'Neon: lag. About 1 action in 5 lands a tick late.'); const html = hud.buildCombatHud(v);
  assert.match(html, /<p class="noise-banner" data-cell="planner\.noise">Neon: lag\. About 1 action in 5 lands a tick late\.<\/p>/);
  assert.match(html, /<span class="cheers" data-cell="planner\.cheers" aria-label="2 of 2 Cheers left">Cheers ✦✦<\/span>/);
  assert.match(html, /data-action="planner-playback" data-speed="2" data-focus-key="planner-playback-2" aria-pressed="true">2×/);
  assert.ok(html.indexOf('noise-banner') < html.indexOf('planner-run'), 'the banner comes before Run');
  // A Cheer spent counts once: in the plan while planning, then off battle.cheers once the round runs.
  const cheered = setPlans(b, planner.plannerReduce({}, { t: 'cheer', unitId: 'milo', slot: 0, on: true }, env(b)).intents);
  const cheersOf = (battle) => { const cells = hud.hudCells(hud.buildHudView(battle, roundView(battle, ctx), {}, ctx)); return [cells['planner.cheers'].text, cells['planner.cheers'].attrs['aria-label']]; };
  const run = commit(cheered, cheered.plans, ctx).battle;
  assert.deepEqual([cheersOf(cheered), run.cheers, cheersOf(step(run, ctx).battle)], [['Cheers ✦✧', '1 of 2 Cheers left'], 1, ['Cheers ✦', '1 of 1 Cheers left']]);
});

test('the wake card says everyone’s fine, with Try again and Go home', () => {
  const b = { ...battleOf(), status: 'offline', result: { fightId: 'fight:test:w:r0', outcome: 'offline', rounds: 3, sorted: 0, calmed: [], bow: false, real: null, auto: false, summary: 'Everyone went offline. Everyone’s fine.' } };
  const { card } = hud.buildHudView(b, roundView(b, ctx), {}, ctx);
  assert.equal(card.title, 'Everyone went offline. Everyone’s fine.');
  assert.deepEqual(card.actions.map((a) => [a.id, a.label]), [['try-again', 'Try again'], ['go-home', 'Go home']]);
  assert.match(hud.cardHtml(card), /role="alertdialog".*data-action="combat-hud-card" data-card-action="try-again" data-focus-key="hud-card-try-again">Try again<\/button>/);
  for (const line of [card.title, ...card.lines]) assertCalm(line, 'the wake card');
});

test('a real rift’s yield card offers Stitch, Ward and Let go, and names the cause', () => {
  const cause = 'Settle me all you like. The Habitack checks are still red.';
  const b = { ...battleOf(), status: 'yielded', result: { fightId: 'fight:rift:x:lead', outcome: 'yielded', rounds: 5, sorted: 2, calmed: [], bow: false, real: { cause }, auto: false, summary: 'The Tale-lead yielded.' } };
  const card = hud.cardView(b, { rift: { id: 'rift:habitack', name: 'The Red Checks' } });
  assert.equal(card.kind, 'yielded');
  assert.deepEqual(card.actions.map((a) => [a.id, a.label]), [['stitch', 'Stitch'], ['ward', 'Ward'], ['let-go', 'Let go']], 'no Send the crew until Phase 6');
  assert.equal(card.lines[0], cause); const html = hud.cardHtml(card);
  for (const id of ['stitch', 'ward', 'let-go']) assert.match(html, new RegExp(`data-card-action="${id}"`));
  for (const line of [card.title, ...card.lines]) assertCalm(line, 'the yield card', { proper: ['Habitack'] });
});

test('the victory card offers a Breather and shows the room’s pay; a bow says it pays a quarter more', () => {
  const won = { ...battleOf(), status: 'won', result: { fightId: 'fight:test:w:r0', outcome: 'won', rounds: 3, sorted: 2, calmed: [], bow: false, real: null, auto: false, summary: 'The strays went home. Milo held on.' } };
  const card = hud.cardView(won, { pay: { xp: 30, marks: 12, loot: ['a Neon essence'] }, breather: true });
  assert.equal(card.title, 'The room is quiet');
  assert.deepEqual(card.lines, ['The strays went home. Milo held on.', 'Road XP +30 and 12 Marks.', 'Found: a Neon essence.']);
  assert.deepEqual(card.actions.map((a) => a.id), ['breather', 'continue']);
  const refused = hud.cardView(won, { breather: 'You’ve had a Breather after this fight.' });
  assert.ok(refused.lines.includes('You’ve had a Breather after this fight.') && !refused.actions.some((a) => a.id === 'breather'));
  const bowed = hud.cardView({ ...won, status: 'bowed', result: { ...won.result, outcome: 'bowed' } }, { invite: { name: 'Glitch beetle', words: 'Can I sit by the fire a while?' } });
  assert.equal(bowed.kind, 'bow');
  assert.ok(bowed.lines.includes('A bow pays a quarter more.') && bowed.lines.includes('Glitch beetle: “Can I sit by the fire a while?”'));
  assert.deepEqual(bowed.actions.map((a) => a.id), ['invite-yes', 'invite-no', 'continue']);
  for (const c of [card, bowed]) for (const line of [c.title, ...c.lines]) assertCalm(line, 'a card', { proper: ['Neon', 'XP'] });
});

test('an Ask pauses on its question with Yes and No, and the live line says only what the Log doesn’t', () => {
  const b = { ...battleOf(), status: 'asking', ask: { unitId: 'claude', reactionId: 'shoulder', trigger: 'hit-on-ally', words: 'Shoulder the hit on Milo?' } };
  const v = hud.buildHudView(b, roundView(b, ctx), {}, ctx);
  assert.deepEqual([v.ask, v.live], [{ words: 'Shoulder the hit on Milo?', unitId: 'claude', reactionId: 'shoulder' }, 'Shoulder the hit on Milo?']);
  const swipe = (ids) => { const bb = lurk({ ...b, ask: { ...b.ask, reactionId: 'parting-swipe', words: 'Parting swipe for glitch beetle?' } }, ids); return hud.buildHudView(bb, roundView(bb, ctx), {}, ctx).ask.words; };
  assert.deepEqual([swipe(['f0', 'f1']), swipe(['f0'])], ['Parting swipe for something unseen?', 'Parting swipe for glitch beetle?'], 'an Unseen foe goes unnamed, unless one in view has its name');
  const html = hud.buildCombatHud(v);
  assert.match(html, /<div class="hud-ask px" data-region="ask" role="alertdialog" aria-label="Shoulder the hit on Milo\?">.*data-action="combat-hud-answer" data-yes="true"/);
  assert.deepEqual(hud.commandFor({ dataset: { action: 'combat-hud-answer', yes: 'false' } }), { t: 'answer', yes: false });
  // The Log reads its own lines aloud, so a playing round's live line never repeats one; "drafted" only when someone did.
  const live = (battle, ui = {}) => hud.buildHudView(battle, roundView(battle, ctx), ui, ctx).live;
  const mine = battleOf({ heroes: ['milo', 'claude', 'codex'].map((id) => hero(id, { control: 'mine' })) });
  assert.deepEqual([live(battleOf()), live(mine)], ['Round 1 · planning. Your company has drafted.', 'Round 1 · planning. Every plan is yours to write.']);
  const running = { ...commit(battleOf(), {}, ctx).battle, log: ['Milo strides to d4.'] };
  assert.deepEqual([running.status, live(running), live(running, { say: 'Running the round.' })], ['running', '', 'Running the round.']);
});

test('the HUD escapes every name and word, carries data-* and focus keys, and reads calmly', () => {
  const foes = [stray('f0', { x: 2, y: 2, name: SCRIPT }), stray('f1', { x: 9, y: 3, name: IMG })];
  const b0 = battleOf({ foes, heroes: [hero('milo'), hero('claude', { name: IMG }), hero('codex', { name: SCRIPT })] });
  const b = { ...b0, log: [`${IMG} — Hit — 6 Static`], talk: { k0: { calm: 1, need: 2, done: false } } };
  for (const ui of [{}, { selected: 'claude', slot: 0 }, { selected: 'claude', slot: 0, popover: 'why' }, { selected: 'claude', popover: 'rules' }, { popover: 'keys' }]) {
    const v = hud.buildHudView(b, roundView(b, ctx), ui, ctx);
    const html = hud.buildCombatHud(v);
    assertEscaped(html, `the HUD with ${JSON.stringify(ui)}`);
    assertControls(html, 'the HUD');
    assert.equal(hud.buildCombatHud(hud.buildHudView(b, roundView(b, ctx), ui, ctx)), html, 'deterministic');
  }
  const plain = hud.buildCombatHud(hud.buildHudView(battleOf(), roundView(battleOf(), ctx), {}, ctx));
  assertCalmHtml(plain, 'the HUD');
  for (const k of Object.keys(hud.hudCells(hud.buildHudView(battleOf(), roundView(battleOf(), ctx), {}, ctx)))) {
    assert.ok(plain.includes(`data-cell="${k}"`), `the builder writes every cell update() patches: ${k}`);
  }
});

const medianOf = (list) => [...list].sort((p, q) => p - q)[list.length >> 1];

test('the HUD updates in place: no innerHTML per tick, and each tick’s view and update well within 4 ms', () => {
  const { root } = fakeRoot(); const commands = [];
  const h = hud.createCombatHud(root, { onCommand: (c) => commands.push(c) }); let b = battleOf();
  h.show(hud.buildHudView(b, roundView(b, ctx), {}, ctx));
  const before = innerHtmlSets;
  b = commit(b, {}, ctx).battle;
  h.update(hud.buildHudView(b, roundView(b, ctx), {}, ctx));
  assert.ok(innerHtmlSets - before <= 1, 'Run re-renders only the planner'); const times = [];
  let rebuilt = 0;
  while (b.status === 'running' || b.status === 'asking') {
    const [round, units] = [b.round, b.units.length];
    b = step(b, ctx).battle;
    const rv = roundView(b, ctx);
    const was = innerHtmlSets;
    const t0 = performance.now(); // each tick's whole cost: building the view and updating in place
    h.update(hud.buildHudView(b, rv, {}, ctx));
    times.push(performance.now() - t0);
    if (innerHtmlSets === was) continue;
    rebuilt += 1;
    assert.ok(b.round !== round || b.units.length !== units, `a region re-rendered only for a new round or a unit coming or going (round ${b.round}, tick ${b.tick})`);
  }
  assert.ok(times.length >= 6 && rebuilt <= 3, `a whole round played (${times.length} ticks), re-rendered ${rebuilt} times`);
  assert.ok(medianOf(times) <= 4, `each tick's view and update take ${medianOf(times).toFixed(2)} ms (median), within 4 ms`);
  // The cells follow the battle.
  const [f0, claude] = ['f0', 'claude'].map((id) => b.units.find((u) => u.id === id));
  assert.equal(root.querySelector('[data-cell="f.f0.int"]').textContent, `${f0.integrity}/${f0.maxIntegrity}`);
  assert.equal(root.querySelector('[data-cell="p.claude.heat.num"]').textContent, String(claude.heat));
  assert.equal(root.querySelector('[data-cell="p.claude.heat"]').style.getPropertyValue('--heat'), `${claude.heat}%`);
  // Clicks become commands.
  const btn = root.querySelector('[data-action="planner-run"]') || root.querySelector('[data-action="planner-accept-all"]');
  if (btn) {
    for (const fn of root.listeners.click) fn({ target: btn, preventDefault() {} });
    assert.equal(commands.length, 1, 'a click on a planner button reaches onCommand');
  }
  h.dispose();
  assert.equal(root.hidden, true);
});

test('with real content and minds, each tick’s view and update take within 4 ms (median and p90), and regions re-render mid-round only when what they show changes', async () => {
  const { loadWorld, ctxFor, partyAt, roomsFor } = await import('../scripts/sim.mjs');
  const world = loadWorld({ tuning: null });
  const TERMINAL = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);
  const hidden = (u) => u.side !== 'party' && (u.conditions || []).some((c) => c.id === 'unseen');
  // What the regions draw as structure: who's there, named how, Examined, Unseen, offline, and an Ask.
  const structure = (b) => JSON.stringify([b.status === 'asking', b.units.map((u) => [u.id, u.name, !!u.examined, hidden(u), !!u.offline, u.maxIntegrity])]);
  const times = []; const unexplained = [];
  let midRound = 0;
  for (const [level, room, seed] of [[1, 'moderate', 11], [3, 'severe', 11], [5, 'lead', 11], [3, 'crowded', 12]]) {
    const heroes = partyAt(world, level, 4);
    const c = ctxFor(world, heroes);
    let b = createBattle(roomsFor(world, { level, room, partySize: 4, seed, count: 1 })[0].fights[0], heroes, { roadLevel: level }, c);
    let rv = roundView(b, c);
    const h = hud.createCombatHud(fakeRoot().root, {});
    h.show(hud.buildHudView(b, rv, {}, c));
    for (let guard = 0; guard < 600 && !TERMINAL.has(b.status); guard += 1) {
      const [round, status, shape] = [b.round, b.status, structure(b)];
      if (status === 'planning') b = commit(b, Object.fromEntries(Object.entries(rv.drafts || {}).map(([hid, d]) => [hid, d.plan])), c).battle;
      else b = (status === 'asking' ? answer(b, true, c) : step(b, c)).battle;
      if (b.status === 'planning' && b.round !== round) rv = roundView(b, c);
      const was = innerHtmlSets;
      const t0 = performance.now();
      h.update(hud.buildHudView(b, rv, {}, c));
      const dt = performance.now() - t0;
      if (status !== 'running' || b.status !== 'running' || b.round !== round) continue;
      times.push(dt);
      if (innerHtmlSets === was) continue;
      midRound += 1;
      if (structure(b) === shape) unexplained.push(`${room} round ${b.round} tick ${b.tick}`);
    }
    assert.ok(TERMINAL.has(b.status), `the ${room} fight at level ${level} ended (${b.status})`);
    h.dispose();
  }
  const p90 = [...times].sort((p, q) => p - q)[Math.floor(times.length * 0.9)];
  assert.ok(times.length >= 60, `${times.length} ticks played`);
  assert.ok(medianOf(times) <= 4 && p90 <= 4, `each tick's view and update take ${medianOf(times).toFixed(2)} ms (median) and ${p90.toFixed(2)} ms (p90), within 4 ms`);
  assert.deepEqual(unexplained, [], `a region re-rendered mid-round with nothing new to draw (${midRound} re-renders over ${times.length} ticks)`);
  assert.ok(midRound <= times.length * 0.15, `${midRound} mid-round re-renders over ${times.length} ticks`);
});

test('the HUD keeps focus on the same control when a region re-renders', () => {
  const { root, doc } = fakeRoot(); const h = hud.createCombatHud(root, {});
  const b = battleOf();
  h.show(hud.buildHudView(b, roundView(b, ctx), {}, ctx));
  root.querySelector('[data-focus-key="planner-run"]').focus();
  h.update(hud.buildHudView(b, roundView(b, ctx), { selected: 'claude', slot: 0 }, ctx));
  assert.equal(doc.activeElement.dataset.focusKey, 'planner-run');
  // A popover takes the focus as it opens, and gives it back to its button as it closes.
  const at = (ui) => { h.update(hud.buildHudView(b, roundView(b, ctx), ui, ctx)); return doc.activeElement?.dataset.focusKey; };
  assert.deepEqual([at({ selected: 'claude', popover: 'why' }), at({ selected: 'claude' }), at({ popover: 'keys' }), at({})], ['planner-why-close', 'planner-why-claude', 'planner-keys-close', 'planner-keys']);
  const pb = { rules: [{ if: 'a', then: 'b' }], max: 2, ifs: [{ id: 'a', words: 'anyone’s below half' }], thens: [{ id: 'b', words: 'brace' }] };
  assert.deepEqual([at({ selected: 'claude', popover: 'rules', playbook: pb }), at({ selected: 'claude' })], ['planner-rule-claude-0-if', 'planner-rules-claude']);
});

test('a card or an Ask that appears takes the focus on its safe action, never Come along or the Breather', () => {
  const b = battleOf();
  const focused = (battle, ui = {}) => {
    const { root, doc } = fakeRoot();
    const h = hud.createCombatHud(root, {});
    h.show(hud.buildHudView(b, roundView(b, ctx), {}, ctx));
    h.update(hud.buildHudView(battle, roundView(battle, ctx), ui, ctx));
    return doc.activeElement?.dataset.focusKey;
  };
  const result = { fightId: 'fight:test:w:r0', outcome: 'offline', rounds: 2, sorted: 0, calmed: [], bow: false, real: null, auto: false, summary: '' };
  const end = { breather: true, invite: { name: 'Glitch beetle', words: 'Can I sit by the fire a while?' } };
  const bowed = { ...b, status: 'bowed', result: { ...result, outcome: 'bowed', bow: true } };
  assert.equal(focused({ ...b, status: 'asking', ask: { unitId: 'claude', reactionId: 'shoulder', trigger: 'hit-on-ally', words: 'Shoulder the hit on Milo?' } }), 'hud-answer-yes');
  assert.equal(focused({ ...b, status: 'offline', result }), 'hud-card-try-again', 'the wake card: Try again, which is free');
  assert.deepEqual(hud.cardView(bowed, end).actions.map((a) => a.id), ['invite-yes', 'invite-no', 'breather', 'continue']);
  assert.equal(focused(bowed, { end }), 'hud-card-continue', 'a bow with an invitation and a Breather: Carry on, so a stray Enter commits nothing');
  assert.equal(hud.cardView({ ...b, status: 'won', result: { ...result, outcome: 'won' } }, end).focus, 'continue', 'the victory card too');
  assert.equal(hud.cardView({ ...b, status: 'yielded', result: { ...result, outcome: 'yielded', real: { cause: 'The build is failing.' } } }, {}).focus, 'stitch', 'the yield card: Stitch, which only opens the rift’s panel');
});

test('every HUD button and select maps to one planner or card command', () => {
  const el = (action, data = {}, value = undefined) => ({ dataset: { action, ...data }, value });
  const table = [
    [el('planner-select', { unit: 'claude' }), { t: 'select', unitId: 'claude' }], [el('combat-hud-select', { unit: 'f0' }), { t: 'select', unitId: 'f0' }],
    [el('planner-slot', { unit: 'claude', slot: '2' }), { t: 'slot', unitId: 'claude', slot: 2 }], [el('planner-option', { index: '4' }), { t: 'option', index: 4 }],
    [el('planner-more'), { t: 'more' }], [el('planner-cheer', { unit: 'milo', slot: '0' }), { t: 'cheer', unitId: 'milo', slot: 0 }],
    [el('planner-why', { unit: 'jev' }), { t: 'why', unitId: 'jev' }], [el('planner-accept', { unit: 'milo' }), { t: 'accept', unitId: 'milo' }],
    [el('planner-accept-all'), { t: 'accept-all' }], [el('planner-rules', { unit: 'claude' }), { t: 'rules', unitId: 'claude' }],
    [el('planner-rule-add', { unit: 'claude' }), { t: 'rule-add', unitId: 'claude' }], [el('planner-rule-remove', { unit: 'claude', index: '1' }), { t: 'rule-remove', unitId: 'claude', index: 1 }],
    [el('planner-close'), { t: 'close' }], [el('planner-keys'), { t: 'keys' }], [el('planner-odds-style'), { t: 'odds-style' }],
    [el('planner-playback', { speed: '4' }), { t: 'playback', speed: 4 }], [el('planner-undo'), { t: 'undo' }], [el('planner-wrap'), { t: 'wrap' }],
    [el('planner-pause'), { t: 'pause' }], [el('planner-hand-over'), { t: 'hand-over' }], [el('planner-take-back'), { t: 'take-back' }],
    [el('planner-run'), { t: 'run' }], [el('planner-ease'), { t: 'ease' }], [el('planner-confirm'), { t: 'confirm' }], [el('planner-back'), { t: 'back' }],
    [el('combat-hud-answer', { yes: 'true' }), { t: 'answer', yes: true }], [el('combat-hud-card', { cardAction: 'let-go' }), { t: 'card', action: 'let-go' }],
  ];
  for (const [e, cmd] of table) assert.deepEqual(hud.commandFor(e, 'click'), cmd, e.dataset.action);
  assert.deepEqual(hud.commandFor(el('planner-reaction', { unit: 'claude', reaction: 'shoulder' }, 'never'), 'change'), { t: 'reaction', unitId: 'claude', reactionId: 'shoulder', setting: 'never' });
  assert.deepEqual(hud.commandFor(el('planner-rule', { unit: 'claude', index: '0', part: 'then' }, 'brace'), 'change'), { t: 'rule-set', unitId: 'claude', index: 0, part: 'then', value: 'brace' });
  assert.equal(hud.commandFor(el('rift-open')), null, 'anything else is someone else’s');
  // Every data-action the HUD draws is one commandFor knows, a pick's Confirm and Back included.
  const e = env(battleOf()); const picking = planner.plannerReduce({ selected: 'milo', slot: 0 }, { t: 'move' }, e).ui;
  for (const ui of [{ selected: 'claude', slot: 0, popover: 'why' }, picking]) {
    const html = hud.buildCombatHud(hud.buildHudView(e.battle, e.roundView, ui, ctx));
    for (const m of html.matchAll(/<(button|select)\b[^>]*data-action="([^"]+)"/g)) assert.ok(hud.commandFor({ dataset: { action: m[2] } }, m[1] === 'select' ? 'change' : 'click'), `${m[2]} has a command`);
  }
});

test('the HUD reports its bands as the shell’s insets, and clears them when the fight is gone', () => {
  const { doc } = fakeRoot(); const insets = [];
  const handlers = {}; const planned = { left: 234, top: 500, right: 612, bottom: 682, width: 378, height: 182 };
  const ribbon = { left: 300, top: 40, right: 700, bottom: 70, width: 400, height: 30 }; let reads = 0;
  Elem.prototype.getBoundingClientRect = function rect() {
    reads += 1;
    const cls = (this.attrs.get('class') || '').split(' ');
    return cls.includes('planner') ? planned : cls.includes('hud-ribbon') ? ribbon : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  try {
    const shell = {
      state: makeState(), set() {}, now: () => NOON, content: () => content, on: (ev, fn) => { handlers[ev] = fn; return () => {}; },
      keys: { push: () => () => {} }, world: () => null, insets: (name, rect) => insets.push([name, rect]),
    };
    const handle = hud.mount(shell, { document: doc });
    const b = battleOf();
    handlers.combat({ live: true, battle: b, roundView: roundView(b, ctx), ctx, command: () => {} });
    assert.deepEqual([insets.find(([n]) => n === 'combat-bottom'), insets.find(([n]) => n === 'combat-top')], [['combat-bottom', planned], ['combat-top', ribbon]]);
    const [count, read] = [insets.length, reads];
    handlers.combat({ live: true, battle: b, roundView: roundView(b, ctx), ctx, command: () => {} });
    assert.deepEqual([insets.length, reads], [count, read], 'an update that re-renders nothing reads no layout and sends nothing');
    let played = commit(b, {}, ctx).battle;
    handlers.combat({ live: true, battle: played, roundView: roundView(played, ctx), ctx, command: () => {} });
    const afterRun = reads;
    assert.ok(afterRun > read, 'Run re-renders the planner, so the bands are read again');
    for (let i = 0; i < 3 && played.status === 'running'; i += 1) {
      played = step(played, ctx).battle;
      handlers.combat({ live: true, battle: played, roundView: roundView(played, ctx), ctx, command: () => {} });
    }
    assert.equal(reads, afterRun, 'playback ticks read no layout');
    handlers.combat({ live: false });
    assert.deepEqual(insets.slice(-2), [['combat-top', null], ['combat-bottom', null]]);
    handle.dispose();
  } finally {
    delete Elem.prototype.getBoundingClientRect;
  }
});

test('mount(shell) is a calm no-op without #combat-hud, and drives the planner from shell messages', () => {
  assert.doesNotThrow(() => hud.mount({}, { document: { getElementById: () => null } }).dispose());
  const { root, doc } = fakeRoot(); const handlers = {};
  const intents = []; const pushed = [];
  let state = makeState();
  const handle = hud.mount({
    get state() { return state; }, set(next) { state = next; return true; }, now: () => NOON, content: () => content, world: () => null,
    on: (event, fn) => { handlers[event] = fn; return () => delete handlers[event]; },
    keys: { push: (fn) => { pushed.push(fn); return () => pushed.splice(pushed.indexOf(fn), 1); } },
  }, { document: doc });
  const b = battleOf();
  handlers.combat({ live: true, battle: b, roundView: roundView(b, ctx), ctx, command: (it) => intents.push(it) });
  assert.equal(pushed.length, 1, 'the HUD pushes its key handler while a fight shows');
  assert.ok(root.querySelector('[data-region="planner"]'), 'the planner is drawn');
  const key = (k, extra = {}) => pushed[0]({ key: k, target: null, preventDefault() {}, ...extra });
  assert.equal(key('Tab'), false, 'Tab goes by'); assert.equal(key(' '), true);
  assert.deepEqual(intents.at(-1), { t: 'run' }, 'Space runs the round');
  assert.equal(key('m', { target: { tagName: 'INPUT' } }), false, 'typing in the command bar is left alone');
  assert.equal(handle.select('cb:claude'), true, 'a combatant entry selects');
  key('Enter');
  assert.equal(intents.at(-1).t, 'plan', 'Enter accepts the selected draft');
  key('?');
  assert.ok(root.querySelector('[data-focus-key="planner-keys-close"]'), 'the keys popover');
  const click = (action) => { for (const fn of root.listeners.click) fn({ target: root.querySelector(`[data-action="${action}"]`), preventDefault() {} }); };
  click('planner-ease');
  assert.deepEqual(intents.at(-1), { t: 'mode', mode: 'storybook' }, 'easing goes to the fight');
  assert.equal(state.party.mode, 'storybook', 'and sticks for the next fights');
  assert.ok(root.querySelector('[data-cell="hud.live"]').textContent.endsWith(planner.EASE_WORDS) && planner.EASE_WORDS.includes('fights after'), 'which it says');
  assertCalm(planner.EASE_WORDS, 'easing');
  click('planner-odds-style');
  assert.equal(state.party.calm.odds, 'words', 'odds as words is the calm setting');
  assert.ok(root.querySelector('[data-action="planner-odds-style"]').textContent.includes('Odds as bars'));
  // The 'combat' message (§18.3 item 10): live without a battle changes nothing; live: false ends it, even with a battle.
  handlers.combat({ live: true }); assert.deepEqual([pushed.length, root.hidden], [1, false], 'still showing');
  handlers.combat({ live: false, battle: b, roundView: roundView(b, ctx), ctx, command: () => {} });
  assert.deepEqual([pushed.length, root.hidden, root.children.length], [0, true, 0], 'the HUD goes and its key handler pops');
  assert.deepEqual([true, { live: true }, { battle: b }, false, null, { live: false, battle: b }, {}].map(hud.liveOf), [true, true, true, false, false, false, false]);
  handle.dispose();
});

test('from the keyboard a pick opens on its Confirm, so Enter places it; Enter and Space stay with any focused control, and a select keeps its keys', () => {
  const { root, doc } = fakeRoot(); const handlers = {};
  const intents = []; let keyHandler = null;
  let state = makeState(); let b = battleOf({ heroes: [hero('milo', { control: 'mine' }), hero('claude'), hero('codex')] });
  const milo = b.units.find((u) => u.id === 'milo');
  const handle = hud.mount({
    get state() { return state; }, set(next) { state = next; return true; }, now: () => NOON, content: () => content, world: () => null,
    on: (event, fn) => { handlers[event] = fn; return () => {}; }, keys: { push: (fn) => { keyHandler = fn; return () => { keyHandler = null; }; } },
  }, { document: doc });
  const send = () => handlers.combat({ live: true, battle: b, roundView: roundView(b, ctx), ctx, command: (it) => {
    intents.push(it);
    if (it.t === 'plan') { b = apply(b, { t: 'plan', unitId: it.unitId, plan: it.plan }, ctx).battle; send(); }
  } });
  send();
  const click = (el) => { for (const fn of root.listeners.click) fn({ target: el, preventDefault() {} }); };
  // A key as the browser sends it: the stack first, then a focused HUD button's own activation for Enter and Space.
  const press = (key, target = doc.activeElement) => {
    const ev = { key, target, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
    const took = keyHandler(ev);
    if (!took && (key === 'Enter' || key === ' ') && target?.tagName === 'BUTTON' && root.contains(target)) click(target);
    return { took, prevented: ev.prevented };
  };
  const focusKey = () => doc.activeElement?.dataset?.focusKey;
  const planned = (from) => intents.slice(from).filter((i) => i.t === 'plan');
  root.querySelector('[data-focus-key="planner-slot-milo-0"]').focus();
  press('Enter');
  assert.equal(focusKey(), 'planner-slot-milo-0', 'Enter on a slot selects it, natively');
  assert.deepEqual([press('m').took, focusKey()], [true, 'planner-confirm'], 'M picks Stride, and the pick hands the focus to its Confirm');
  press('ArrowRight');
  press('ArrowRight');
  assert.equal(focusKey(), 'planner-confirm', 'the cursor moves, the focus stays');
  assert.match(root.querySelector('.planner-pick').textContent, /^Stride: [a-z]+\d+\. Arrows move the cursor, Enter confirms, Esc goes back\.$/);
  let from = intents.length; assert.equal(press('Enter').took, false, 'Enter stays with the focused Confirm');
  assert.deepEqual(planned(from).map((i) => i.plan.slots[0].target.path.at(-1)), [{ x: milo.x + 2, y: milo.y }], 'and Confirm places the Stride');
  assert.deepEqual([root.querySelector('.planner-pick'), focusKey()], [null, 'planner-slot-milo-1'], 'the pick is closed, and the focus goes on to the next slot');
  // Esc backs out of a pick and hands the focus back to its slot; Back does the same by click.
  press('m');
  assert.deepEqual([press('Escape').took, root.querySelector('.planner-pick'), focusKey()], [true, null, 'planner-slot-milo-1']);
  press('m');
  click(root.querySelector('[data-action="planner-back"]'));
  assert.equal(root.querySelector('.planner-pick'), null, 'Back closes the pick');
  // A pick among units confirms from its Confirm too: Examine, ] to the second foe, Enter.
  const examine = planner.barOptions(b, roundView(b, ctx), 'milo', 1, ctx).find((o) => o.action.id === 'examine' && !o.why);
  click(root.querySelector(`[data-action="planner-option"][data-index="${examine.index}"]`));
  assert.equal(focusKey(), 'planner-confirm');
  press(']');
  from = intents.length;
  press('Enter');
  assert.deepEqual(planned(from).map((i) => i.plan.slots[1].target), [examine.targets[1]], 'the second target, confirmed');
  // Enter and Space on a focused control outside the HUD (the place list, the Log, a menu) are its own.
  from = intents.length;
  const listButton = new Elem('button', doc); const menuItem = new Elem('div', doc);
  menuItem.setAttribute('role', 'menuitem');
  for (const target of [listButton, menuItem]) for (const key of ['Enter', ' ']) assert.deepEqual(press(key, target), { took: false, prevented: false }, `${key} on a ${target.tagName} outside the HUD`);
  assert.equal(press('?', listButton).took, true, 'other combat keys still work there');
  press('?', listButton);
  // A focused select keeps its letters, digits, arrows, Enter and Space; Escape still goes back.
  const select = root.querySelector('select[data-action="planner-reaction"]');
  for (const key of ['a', 'g', 'p', 'w', 'm', '1', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ']) assert.equal(press(key, select).took, false, `${key} stays with the select`);
  assert.equal(intents.length, from, 'nothing ran or was accepted, and no hand-over, Guided, pause or wrap');
  assert.equal(press('Escape', select).took, true, 'Escape goes back');
  // The pure pieces.
  assert.deepEqual([listButton, select, { tagName: 'INPUT' }, null].map((t) => planner.keyTarget(t)), [{ typing: false, control: true, select: false },
    { typing: false, control: true, select: true }, { typing: true, control: false, select: false }, { typing: false, control: false, select: false }]);
  assert.deepEqual([planner.combatKey({ key: 'a' }, { select: true }), planner.combatKey({ key: 'Escape' }, { select: true })?.t, planner.combatKey({ key: 'Backspace' }, { control: true })?.t], [null, 'back', 'clear']);
  handle.dispose();
});

// ---- The combatant list ----------------------------------------------------
test('the combatant list puts every combatant first as cb:<id>, labelled for screen readers', () => {
  const b0 = battleOf({ foes: [stray('f0', { x: 8, y: 2 }), stray('f1', { x: 9, y: 3 }), stray('f2', { x: 10, y: 3 })] });
  const b = { ...b0, units: b0.units.map((u) => (u.id === 'f1' ? { ...u, sorted: 'settled' } : u.id === 'f2' ? { ...u, conditions: [{ id: 'unseen', n: null, source: null, data: null }] } : u.id === 'f0' ? { ...u, integrity: 6, conditions: [{ id: 'spooked', n: 1, source: null, data: null }] } : u)) };
  const list = combatants.combatantsView(b, ctx);
  const ribbon = b.order.map((uid) => b.units.find((u) => u.id === uid)).filter((u) => u && !u.sorted);
  const expected = [...ribbon.filter((u) => u.side === 'party'), ...ribbon.filter((u) => u.side !== 'party')].map((u) => `cb:${u.id}`);
  assert.deepEqual(list.map((c) => c.id), expected, 'the party first, then the rest in ribbon order, sorted ones gone');
  assert.ok(!list.some((c) => c.id === 'cb:f1'), 'the sorted stray has gone home');
  const beetle = list.find((c) => c.id === 'cb:f0');
  assert.match(beetle.label, /^Glitch beetle, 6 of 20 Integrity, Spooked 1, telegraphing [^,]+(, Hit or better \d+%)?$/);
  const near = battleOf({ foes: [stray('f0', { x: 2, y: 1 })] });
  const biting = combatants.combatantsView(near, ctx).find((c) => c.id === 'cb:f0');
  assert.match(biting.label, /^Glitch beetle, 20 of 20 Integrity, telegraphing Strike [^,]+, Hit or better \d+%$/, 'a telegraphed Strike carries its odds');
  assert.equal(list.find((c) => c.id === 'cb:f2').label, 'Something unseen');
  const html = combatants.buildCombatants({ combatants: list, landmarks: [{ id: 'nook', kind: 'nook', label: 'Hearth-nook', note: '3 tiles' }] });
  assert.match(html, /^<li><button type="button" data-entity="cb:milo" data-kind="combatant" data-side="party">Milo, 18 of 18 Integrity, 20 heat<\/button><\/li>/);
  assert.ok(html.indexOf('cb:f0') < html.indexOf('data-entity="nook"'), 'combatants before landmarks');
  assert.equal(combatants.combatantId('cb:f0'), 'f0'); assert.equal(combatants.combatantId('stray:3'), null);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `cb:f${i}`, unitId: `f${i}`, side: 'foe', label: `Stray ${i}` }));
  assert.equal([...combatants.buildCombatants(many).matchAll(/data-kind="combatant"/g)].length, combatants.COMBATANTS_MAX, 'capped at 16');
  const hostile = combatants.buildCombatants(combatants.combatantsView(battleOf({ foes: [stray('f0', { x: 8, y: 2, name: IMG })] }), ctx));
  assertEscaped(hostile, 'the combatant list');
  assertCalmHtml(html, 'the combatant list');
});

test('a Void stray’s false target shows the false target’s odds in the list, never the real one’s', () => {
  // Heroes with different Guard, so each one's odds differ.
  const b = battleOf({ heroes: [hero('milo', { guard: 0 }), hero('claude', { guard: 2 }), hero('codex', { guard: 1 })], foes: [stray('f0', { x: 2, y: 2 })] });
  const tele = b.telegraphs.find((t) => t.unitId === 'f0' && t.targets?.length === 1 && b.plans.f0?.slots?.[t.slot]?.target?.unit);
  const [plan, real] = [b.plans.f0, tele.targets[0]]; const fake = ['milo', 'claude', 'codex'].find((x) => x !== real);
  const against = (unitId) => oddsByTarget(b, 'f0', { ...plan.slots[tele.slot], target: { unit: unitId } }, ctx, { slot: tele.slot, plan }).find((r) => r.targetId === unitId).odds;
  assert.notDeepEqual(against(real), against(fake), 'the two targets’ odds differ, so the odds could tell');
  const oddsOf = combatants.telegraphOdds(b, ctx);
  assert.deepEqual([oddsOf(tele), oddsOf({ ...tele, falseTarget: fake })], [against(real), against(fake)], 'the real one’s, and with a false target the odds the words name');
  const faked = { ...b, telegraphs: b.telegraphs.map((t) => (t === tele ? { ...t, falseTarget: fake } : t)) };
  const { label } = combatants.combatantsView(faked, ctx).find((c) => c.id === 'cb:f0');
  assert.ok(label.endsWith(`Hit or better ${against(fake).bars[0] + against(fake).bars[1]}%`), label);
});

// ---- Setting out -----------------------------------------------------------
const workingSnapshot = () => ({ sources: { claude: { ok: true, sessions: [{ id: 's1', title: 'MILO plan', status: 'working' }] }, codex: { ok: true, sessions: [] } } });
const regularOf = (name) => ({ id: 'reg-abc', name, genre: 'neon', second: null, archetype: 'walker', bodyKey: 'r', parts: [], eyeKey: null, temperament: 'shy', calling: 'chorister', lead: false, mechanic: null, riftId: null, riftSeed: 1, joinedAt: 1 });

test('Setting out shows each companion’s calling, level, warmth, field skill, sync and mood, and a likeness when a Wayfarer is busy', () => {
  const mv = musterView(makeState({ accepts: { claude: '1101' } }), { content, rules: rulesLoaded, snapshot: workingSnapshot(), now: NOON });
  const view = muster.musterPanelView(mv, { where: 'camp', callings: content.combat.callings.callings, wedge: false });
  const html = muster.buildMuster(view); const scribe = view.members.find((m) => m.id === 'claude');
  assert.deepEqual([scribe.calling, scribe.level, scribe.warmthStep, scribe.fieldSkill, scribe.sync, scribe.mood], ['Scrivener', 1, 'Stranger', 'Read', 75, 'Rested']);
  if (mv.members.find((m) => m.id === 'claude').likeness) assert.ok(html.includes('Claude is working on ‘MILO plan’. Her likeness will go.'), 'the likeness line');
  assert.match(html, /<li class="muster-member" data-member="claude" data-chosen="true">/);
  assert.match(html, /data-action="muster-toggle" data-member="claude"[^>]*aria-pressed="true">Leave at camp<\/button>/);
  assert.match(html, /data-action="muster-calm" data-calm="noise"/, 'the calm switches have their own data-calm handler');
  assert.ok(!html.includes('data-setting='), 'never the generic data-setting toggle');
  assert.match(html, /data-action="muster-formation" data-value="wedge"[^>]*disabled title="Opens at Warding 5"/);
  assert.match(html, />Same as last time<\/button>/, 'Same as last time is the default');
  assertControls(html, 'Setting out');
  assertCalmHtml(html, 'Setting out');
  assert.equal(muster.buildMuster(view), html);
  const away = muster.buildMuster(muster.musterPanelView(mv, { where: 'away', callings: content.combat.callings.callings }));
  assert.ok(!away.includes('muster-toggle') && away.includes('Out with Milo'), 'elsewhere it shows who’s out, without swapping');
  assert.ok(muster.buildMuster(muster.musterPanelView(mv, { where: 'camp', opened: ['codex'] })).includes('>Set out with these</button>'));
});

test('Setting out escapes a regular’s name and says when three are going', () => {
  const regular = regularOf(IMG);
  const mv = musterView(makeState({ regulars: [regular], roster: { 'reg-abc': emptyState4().party.roster.claude } }), { content, rules: rulesLoaded, now: NOON });
  const html = muster.buildMuster(muster.musterPanelView(mv, { where: 'camp', callings: content.combat.callings.callings, regulars: [regular] }));
  assertEscaped(html, 'the muster');
  assert.match(html, /data-member="reg-abc"[^>]*disabled title="Three are going already\."/);
});

test('mount registers the muster panel and its buttons change the party through party.js', () => {
  const panels = {}; let state = makeState();
  const handle = muster.mount({
    get state() { return state; }, set(next) { state = next; return true; }, now: () => NOON, content: () => content, snapshot: () => null,
    registerPanel: (prefix, def) => { panels[prefix] = def; return () => delete panels[prefix]; }, refreshPanel() {}, closePanel() {}, feature() {},
  });
  const m = panels.muster;
  assert.ok(m && m.exists('muster') && !m.exists('muster:x') && m.title('muster') === 'Setting out' && /class="muster"/.test(m.render('muster')));
  assert.equal(m.action({ dataset: { action: 'muster-toggle', member: 'jev', focusKey: 'x' } }, 'muster'), true);
  assert.deepEqual(state.party.chosen, ['claude', 'codex']);
  m.action({ dataset: { action: 'muster-calm', calm: 'noise' } }, 'muster');
  m.action({ dataset: { action: 'muster-calm', calm: 'ghosts' } }, 'muster');
  assert.deepEqual([state.party.calm.noise, state.party.calm.ghosts], [false, true], 'a switch that starts off turns on');
  m.action({ dataset: { action: 'muster-mode', value: 'storybook' } }, 'muster');
  assert.equal(state.party.mode, 'storybook');
  assert.equal(m.action({ dataset: { action: 'rift-open' } }, 'muster'), false, 'other buttons pass through');
  // A refused swap says its own cause.
  const noteAfter = (member) => { m.action({ dataset: { action: 'muster-toggle', member } }, 'muster'); return /<p class="plot-note" role="status">([^<]*)<\/p>/.exec(m.render('muster'))?.[1] || null; };
  state = { ...state, party: { ...state.party, chosen: ['claude', 'codex', 'jev'] } };
  assert.equal(noteAfter('tollkeeper'), 'They aren’t in the company yet.');
  state = { ...state, party: { ...state.party, regulars: [regularOf('Pip')], roster: { ...state.party.roster, 'reg-abc': emptyState4().party.roster.claude } } };
  assert.equal(noteAfter('reg-abc'), 'Three are going already.');
  assert.deepEqual([muster.musterRefusal({ ...state, expedition: { battle: { v: 2 } } }, 'claude', ['codex']), muster.musterRefusal(state, 'claude', ['codex'])], ['Swaps wait until the fight is over.', null]);
  handle.dispose();
  assert.equal(panels.muster, undefined);
});

// ---- The company sheet -----------------------------------------------------
test('the company sheet shows calling, level, path, boons, warmth, reactions and the notebook link, with the Scribe’s Pages at camp', () => {
  const state = makeState(); const view = company.companyView(state, 'claude', { content, rules: rulesLoaded, now: NOON });
  assert.deepEqual([view.name, view.title, view.fieldSkill], ['The Scribe', 'Scribe', 'Read']);
  assert.deepEqual(view.calling, { id: 'scrivener', name: 'Scrivener', role: 'Prepared magic and areas' });
  assert.deepEqual(view.warmth, { n: 0, step: 'Stranger', next: { name: 'Acquaintance', at: 10 } });
  assert.ok(view.reactions.some((r) => r.id === 'shoulder' && r.setting === 'always'));
  assert.ok(view.pages && view.pages.max >= 3 && view.pages.spells.length > 0, 'her Pages');
  const html = company.buildCompany(view);
  assert.match(html, /<p class="sheet-line">Scrivener, level 1 · Prepared magic and areas<\/p>/);
  assert.match(html, /data-action="company-reaction" data-member="claude" data-reaction="shoulder" data-value="always"[^>]*aria-pressed="true">Always<\/button>/);
  assert.match(html, /data-action="company-control" data-member="claude" data-value="review"[^>]*aria-pressed="true">Review<\/button>/);
  assert.match(html, /data-action="company-notebook" data-member="claude"[^>]*>Open the notebook page<\/button>/);
  assert.ok(html.includes('Opens at level 3.'));
  assertControls(html, 'the company sheet');
  assertCalmHtml(html, 'the company sheet');
  assert.equal(company.buildCompany(view), html);
  assert.ok(company.buildCompany(company.companyView(state, 'claude', { content, rules: rulesLoaded, now: NOON, atCamp: false })).includes('Pages are written at camp or a lantern.'));
  assert.equal(company.buildCompany(company.companyView(state, 'nobody', { content, rules: rulesLoaded })), '<p class="quiet-note">Nobody by that name is in the company.</p>');
  assert.equal(company.boonName('ability-up-wit', company.abilityDefs(content)), 'Ability up: Wit');
  // Friend unlocks nothing in Phase 4 (§3.2): the second path waits for Phase 5.
  const pathed = company.buildCompany({ ...view, path: { id: 'margins', name: 'Margins', text: 'Notes in the margin.' }, canSwapPath: false });
  assert.ok(!/Phase 5|Friend warmth/.test(pathed), 'no promise about a later phase');
});

test('the company sheet’s buttons set reactions and control through party.js', () => {
  const panels = {}; let state = makeState();
  const opened = [];
  company.mount({
    get state() { return state; }, set(next) { state = next; return true; }, now: () => NOON, content: () => content,
    registerPanel: (prefix, def) => { panels[prefix] = def; return () => {}; }, refreshPanel() {}, openPanel: (x) => opened.push(x),
  });
  const p = panels['company:'];
  assert.ok(p.exists('company:claude') && !p.exists('company:nobody') && p.title('company:claude') === 'The Scribe');
  p.action({ dataset: { action: 'company-reaction', reaction: 'shoulder', value: 'never' } }, 'company:claude');
  p.action({ dataset: { action: 'company-control', value: 'mine' } }, 'company:claude');
  p.action({ dataset: { action: 'company-notebook' } }, 'company:claude');
  assert.deepEqual([state.party.roster.claude.reactions.shoulder, state.party.roster.claude.control, opened], ['never', 'mine', ['notebook:claude']]);
});

// ---- The dialogue box, the camp and talks ----------------------------------
test('the dialogue box has a chat-head portrait, Click to continue, and choices greyed with their requirement', () => {
  const more = dialogue.buildDialogue({ speaker: 'claude', lines: [{ speaker: 'claude', text: 'I brought pages. Rather a lot of them.', gesture: null }], more: true, key: 'arrival-claude' });
  assert.match(more, /<canvas class="chat-head" data-scene="portrait" data-look="[^"]+" role="img" aria-label="The Scribe"/);
  assert.match(more, /<p class="dialogue-line" data-speaker="claude"><span class="dialogue-who">The Scribe<\/span> I brought pages\. Rather a lot of them\.<\/p>/);
  assert.match(more, /data-action="dialogue-next" data-focus-key="dialogue-next-arrival-claude">Click to continue<\/button>/);
  const talk = dialogue.buildDialogue({
    speaker: 'tollkeeper', key: 'tollkeeper-riddles',
    lines: [{ speaker: 'tollkeeper', text: 'The toll is three riddles.', gesture: null }, { speaker: null, text: null, gesture: 'He leans on the rail and waits' }],
    choices: [{ id: 'first.1', text: 'A river.', met: true, why: null }, { id: 'first.3', text: 'The Tide Market.', met: false, why: 'Once you’ve read Brannoch’s note' }],
  });
  assert.match(talk, /<p class="dialogue-line gesture">\(He leans on the rail and waits\)<\/p>/, 'a gesture is a stage direction');
  assert.match(talk, /data-action="dialogue-choose" data-choice="first\.3" data-focus-key="dialogue-choice-first\.3" disabled aria-disabled="true">The Tide Market\.<span class="dialogue-why">Once you’ve read Brannoch’s note<\/span>/);
  assert.match(talk, /data-choice="first\.1" data-focus-key="dialogue-choice-first\.1">A river\.<\/button>/);
  assert.match(talk, /aria-label="Talking with the Tollkeeper"/);
  const jev = dialogue.buildDialogue({ speaker: 'jev', lines: [{ speaker: 'jev', text: null, gesture: 'Jev tilts its head, then nods once' }], key: 'arrival-jev' });
  assert.ok(!/dialogue-who">Jev</.test(jev) && /\(Jev tilts its head, then nods once\)/.test(jev), 'Jev never has a spoken line');
  assertEscaped(dialogue.buildDialogue({ speaker: IMG, lines: [{ speaker: IMG, text: SCRIPT }], choices: [{ id: 'x.1', text: IMG, met: false, why: SCRIPT }], key: 'x' }), 'the dialogue box');
  for (const h of [more, talk, jev]) { assertControls(h, 'the dialogue box'); assertCalmHtml(h, 'the dialogue box'); }
  assert.deepEqual([dialogue.sceneStep(['a', 'b', 'c'], 0), dialogue.sceneStep(['a', 'b', 'c'], 5)], [{ lines: ['a'], more: true }, { lines: ['a', 'b', 'c'], more: false }]);
});

test('the camp fire shows who’s where on the real clock, the arrival scene, the evening’s talks and teaching', () => {
  const state = makeState(); const view = campView.campView(state, EVENING, { content });
  assert.equal(view.part, 'evening');
  assert.deepEqual(view.places.map((p) => [p.id, p.where]), [['claude', 'fire'], ['codex', 'fire'], ['jev', 'tower']]);
  assert.deepEqual([view.scene.id, view.scene.lines.length, view.scene.more, view.teach.open], ['arrival-claude', 1, true, true]);
  assert.ok(view.talks.some((t) => t.id === 'first-night' && t.open)); const html = campView.buildCamp(view);
  assert.match(html, /<section class="dialogue px" data-dialogue="arrival-claude"/);
  assert.match(html, /data-action="camp-talk" data-talk="first-night"/);
  assert.match(html, /data-action="camp-muster" data-focus-key="camp-muster">Setting out<\/button>/);
  assertControls(html, 'the camp fire');
  assertCalmHtml(html, 'the camp fire');
  const late = campView.campView(state, new Date(2026, 8, 29, 23, 30).getTime(), { content });
  assert.ok(late.bell && late.talks.every((t) => !t.open && t.why === 'Past your bell. It waits for tomorrow.'));
  assert.ok(campView.buildCamp(late).includes('Everyone else went to bed.'));
});

test('a talk panel plays through the dialogue box and never locks', () => {
  const panels = {}; let state = makeState();
  campView.mount({
    get state() { return state; }, set(next) { state = next; return true; }, now: () => EVENING, content: () => content, snapshot: () => null,
    registerPanel: (prefix, def) => { panels[prefix] = def; return () => {}; }, refreshPanel() {}, openPanel() {}, closePanel() {},
  });
  const talk = panels['talk:']; const id = 'talk:tollkeeper-riddles';
  assert.ok(talk.exists(id) && !talk.exists('talk:nope'));
  assert.match(talk.render(id), /Tide Market\.<span class="dialogue-why">Once you’ve read Brannoch’s note<\/span>/, 'a greyed choice says what it needs');
  talk.action({ dataset: { action: 'dialogue-choose', choice: 'first.2' } }, id);
  const html = talk.render(id); assert.ok(html.includes('A fair guess. Misers count all day.'), 'the reply shows');
  assert.match(html, /data-choice="first\.2"[^>]*disabled[^>]*>A miser\.<span class="dialogue-why">You’ve said that one\.<\/span>/, 'an answered choice greys, and the others stay open');
  for (const choice of ['first.1', 'second.1', 'third.1']) talk.action({ dataset: { action: 'dialogue-choose', choice } }, id);
  assert.ok(Object.hasOwn(state.party.roster, 'tollkeeper'), 'answering all three, he joins');
  assert.match(talk.render(id), /data-action="dialogue-close"/);
  assertControls(html, 'a talk');
  assertCalmHtml(html, 'a talk');
  const fire = panels['camp-fire']; assert.match(fire.render('camp-fire'), /data-dialogue="arrival-claude"/);
  fire.action({ dataset: { action: 'dialogue-next' } }, 'camp-fire');
  assert.equal([...fire.render('camp-fire').matchAll(/class="dialogue-line"/g)].length, 2, 'Click to continue shows the next line');
});

// ---- The notebook page -----------------------------------------------------
test('the notebook page lists habits strongest first with counts, Strike out, Teach and Reset, and the rules as selects', () => {
  const state = makeState({ accepts: { claude: '1111011110' } });
  const withNb = { ...state, party: { ...state.party, roster: { ...state.party.roster, claude: { ...state.party.roster.claude, notebook: { ...state.party.roster.claude.notebook, fights: 34, rules: [{ if: 'anyone-below-half', then: 'patch-first' }], struck: ['4:7'] } } } } };
  const habits = [['3:0', 'Patches the most hurt ally', 11, 12, 0.9], ['4:7', 'Steps in beside whoever a stray is about to bite', 7, 9, 0.6], ['5:9', 'Opens with Draft on a Tale-lead’s boon', 5, 5, 0.4]]
    .map(([key, phrase, count, of, strength]) => ({ key, phrase, count, of, strength, struck: false }));
  const vocab = { ifs: [{ id: 'anyone-below-half', words: 'anyone’s below half' }], thens: [{ id: 'patch-first', words: 'patch them first' }], text: () => 'If anyone’s below half, patch them first.' };
  const others = [{ id: 'codex', name: 'The Artificer' }];
  const view = notebookView.notebookPageView(withNb, 'claude', { content, habits, vocab, now: EVENING, others });
  assert.equal(view.sync, 80); const html = notebookView.buildNotebookPage(view);
  assert.ok(html.includes('Trained on 34 of your fights · sync 80%'));
  assert.deepEqual([...html.matchAll(/<li class="habit" data-habit="([^"]+)"/g)].map((m) => m[1]), ['3:0', '4:7', '5:9'], 'strongest first, as notebook.habits gives them');
  assert.match(html, /<span class="habit-count">11 of 12 fights like this<\/span>/);
  assert.match(html, /data-habit="4:7" data-struck="true"><span class="habit-phrase"><s>Steps in beside/, 'a struck habit is crossed out');
  assert.match(html, /data-action="notebook-unstrike"[^>]*data-habit="4:7"[^>]*>Put it back</);
  assert.ok(/data-action="notebook-strike"[^>]*data-habit="3:0"/.test(html) && /data-action="notebook-teach"[^>]*data-habit="3:0"/.test(html) && html.includes('data-action="notebook-reset"'));
  assert.match(html, /<select class="px-select" data-action="notebook-rule" data-member="claude" data-index="0" data-part="if"/);
  assert.match(html, /<p class="rule-line">If anyone’s below half, patch them first\.<\/p>/);
  assertControls(html, 'the notebook page');
  assertCalmHtml(html, 'the notebook page');
  assert.equal(notebookView.buildNotebookPage(view), html);
  const teaching = notebookView.buildNotebookPage(notebookView.notebookPageView(withNb, 'claude', { content, habits, vocab, now: EVENING, teaching: '3:0', others }));
  assert.match(teaching, /data-action="notebook-teach-to" data-member="claude" data-habit="3:0" data-to="codex"[^>]*>Show the Artificer<\/button>/);
  assertEscaped(notebookView.buildNotebookPage(notebookView.notebookPageView(withNb, 'claude', { content, habits: [{ key: '1:1', phrase: IMG, count: 1, of: 1 }], vocab: { ifs: [{ id: 'x', words: SCRIPT }], thens: [{ id: 'y', words: IMG }] }, now: EVENING })), 'the notebook page');
});

test('Reset asks first, in the companion’s own words, with the safe button first', () => {
  assert.deepEqual(notebookView.resetQuestion('Rivet', 'he'), { title: 'Start Rivet’s notebook fresh?', body: 'He’ll play on instinct until he learns you again.' });
  assert.deepEqual(notebookView.resetQuestion('The Artificer', 'they'), { title: 'Start the Artificer’s notebook fresh?', body: 'They’ll play on instinct until they learn you again.' });
  const html = notebookView.buildNotebookPage(notebookView.notebookPageView(makeState(), 'claude', { content, habits: [], confirming: 'reset', now: EVENING }));
  assert.match(html, /<div class="confirm" role="alertdialog"[^>]*><p class="confirm-title"[^>]*>Start the Scribe’s notebook fresh\?<\/p><p class="confirm-body"[^>]*>She’ll play on instinct until she learns you again\. The old notebook is kept until the next Campfire\.<\/p>/);
  assert.ok(html.indexOf('notebook-reset-cancel') < html.indexOf('notebook-reset-confirm'), 'Keep it comes first');
  assert.match(html, /class="px-btn primary" data-action="notebook-reset-cancel"[^>]*>Keep it</);
  assert.ok(html.includes('Nothing written yet.'));
});

test('a reset or a restore changes the notebook only once the file has, and says so calmly when it can’t', async () => {
  let state = makeState({ accepts: { claude: '1111011110' } }); const panels = {};
  const calls = []; let settle = null;
  const later = () => new Promise((resolve) => { settle = resolve; });
  const notebooks = {
    replace: (idName, bytes, opts) => { calls.push(['replace', idName, bytes.length, opts]); return later(); },
    restore: (idName) => { calls.push(['restore', idName]); return later(); },
  };
  const mountWith = (bridge) => notebookView.mount({
    get state() { return state; }, set(next) { state = next; }, now: () => EVENING, content: () => content, refreshPanel() {},
    registerPanel: (prefix, panel) => { panels[prefix] = panel; return () => {}; }, bridge,
  }, { habitsOf: () => [], atCamp: () => true });
  mountWith({ notebooks });
  const page = panels['notebook:'];
  const act = (action) => page.action({ dataset: { action, focusKey: `${action}-claude` } }, 'notebook:claude');
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  const respond = async (r) => { settle(r); await turn(); };
  const says = (words) => page.render('notebook:claude').includes(words);
  const nb = () => state.party.roster.claude.notebook;
  // Reset: nothing changes until main says the file is fresh.
  const start = state;
  act('notebook-reset-confirm');
  assert.deepEqual(calls.at(-1), ['replace', 'claude', 0, { keepPrevious: true }]);
  await turn();
  assert.equal(state, start, 'state waits for the file');
  await respond({ ok: false, code: 'blocked' });
  assert.ok(state === start && says('The notebook is busy just now. Try again in a moment.'), 'a blocked reset changes nothing, and says so');
  act('notebook-reset-confirm');
  await respond({ ok: true, size: 0 });
  assert.ok(nb().accepts === '' && nb().previous, 'reset once the file is, the old one kept');
  // Restore: the same, and 'none' says the old one has gone.
  const reset = state;
  act('notebook-restore');
  assert.deepEqual(calls.at(-1), ['restore', 'claude']);
  await respond({ ok: false, code: 'none' });
  assert.ok(state === reset && says('The old notebook has already gone.'));
  act('notebook-restore');
  await respond({ ok: true });
  assert.equal(nb().accepts, '1111011110', 'restored once the file is');
  // Without a bridge, nothing changes.
  mountWith(null);
  const before = state;
  panels['notebook:'].action({ dataset: { action: 'notebook-reset-confirm' } }, 'notebook:claude');
  await turn();
  assert.equal(state, before);
  for (const words of ['The notebook is busy just now. Try again in a moment.', 'The old notebook has already gone.']) assertCalm(words, 'the notebook page');
});

test('a lesson at the fire appends one framed habit at the notebook’s good end, once, and records the night', async () => {
  const appended = []; const files = { claude: new Uint8Array([1, 2, 3]), codex: new Uint8Array([9, 9]) };
  const lastKeys = new Map(); // a file's bytes → the key of its last frame
  let moved = 1; let framedKey = null;
  const bridge = {
    read: async (id) => ({ ok: true, bytes: files[id], size: files[id].length }),
    append: async (id, bytes, at) => {
      if (moved > 0) { moved -= 1; return { ok: false, code: 'moved', size: 99 }; }
      appended.push({ id, at });
      files[id] = new Uint8Array([...files[id], ...bytes]);
      lastKeys.set(files[id], framedKey);
      return { ok: true, size: at + bytes.length };
    },
  };
  const nb = {
    unframe: (bytes) => ({ notes: new Uint8Array(bytes === files.claude ? 24 : 48), frames: 1, torn: 0, good: bytes.length, lastKey: lastKeys.get(bytes) ?? null }),
    createNotebook: (idName, notes, extra) => ({ id: idName, notes, ...extra }),
    teachNotes: (from, habit, start) => { assert.deepEqual([from.id, habit, start], ['claude', '3:0', 2]); return new Uint8Array(48); },
    frame: (notes, key) => { framedKey = key; return new Uint8Array([7, notes.length]); },
  };
  let state = makeState();
  const shell = { get state() { return state; }, set(next) { state = next; }, now: () => EVENING, bridge: { notebooks: bridge } };
  const teach = () => notebookView.teachLesson(shell, 'claude', 'codex', '3:0', { nb });
  assert.equal((await teach()).ok, true);
  assert.deepEqual(appended, [{ id: 'codex', at: 2 }], 'retried once after moved, then appended at the good end');
  assert.equal(state.party.roster.codex.notebook.count, 2, 'two notes counted');
  assert.notEqual(state.party.teachDay, null, 'tonight’s lesson is taught');
  assert.deepEqual(await teach(), { ok: false, words: 'Tonight’s lesson has been taught.', state });
  // A relaunch between the append and the save: the frame is there already, so nothing is appended twice.
  state = makeState();
  assert.equal((await teach()).ok, true);
  assert.equal(appended.length, 1, 'the lesson’s frame key is already the last: skipped');
});

test('lessons happen at the fire once a night, a reset waits for the fight to end, and a regular’s name is escaped everywhere', () => {
  const habits = [{ key: '3:0', phrase: 'Patches the most hurt ally', count: 2, of: 3 }];
  const others = [{ id: 'codex', name: 'The Artificer' }];
  const page = (state, opts = {}) => notebookView.buildNotebookPage(notebookView.notebookPageView(state, 'claude', { content, habits, now: EVENING, others, ...opts }));
  const away = page(makeState(), { atCamp: false });
  assert.ok(!away.includes('notebook-teach') && away.includes('Lessons are taught at the fire.'));
  const tonight = { ...makeState(), party: { ...makeState().party, teachDay: Math.round(Date.UTC(2026, 8, 29) / 86400000) } };
  const done = page(tonight, { now: new Date(2026, 8, 29, 20, 0).getTime() });
  assert.ok(done.includes('Taught tonight.') && !done.includes('notebook-teach'));
  const live = page({ ...makeState(), expedition: { battle: { v: 2, id: 'x' } } });
  assert.ok(live.includes('Not during a fight.') && !live.includes('data-action="notebook-reset"'));
  // A regular's name, escaped on the sheet, Level up, the camp and the notebook page.
  const state = makeState({ regulars: [regularOf(SCRIPT)], roster: { 'reg-abc': emptyState4().party.roster.claude } });
  const sheet = company.buildCompany(company.companyView(state, 'reg-abc', { content, rules: rulesLoaded, now: NOON }));
  const camp = campView.buildCamp(campView.campView(state, EVENING, { content }));
  assert.ok(sheet.includes('&lt;script&gt;') && camp.includes('&lt;script&gt;'), 'the regular is on the sheet and at the fire, escaped');
  for (const [html, where] of [[sheet, 'the company sheet'], [levelup.buildLevelUp(levelup.levelUpView(state, 'reg-abc', { content, rules: rulesLoaded })), 'Level up'], [camp, 'the camp'],
    [notebookView.buildNotebookPage(notebookView.notebookPageView(state, 'reg-abc', { content, habits: [], now: EVENING })), 'the notebook page']]) assertEscaped(html, where);
});

test('with H’s notebook.js, the page reads habits from a file and a lesson lands as taught notes in order', async () => {
  const nb = await import('../src/combat/notebook.js'); const template = nb.CHOICES[1].id;
  const note = (order) => nb.encodeNote({ situation: new Uint8Array(16), template, slot: 0, cost: 1, relation: nb.CHOICES[1].relation, ability: 0, weight: 1, order });
  const three = new Uint8Array(72);
  [0, 1, 2].forEach((i) => three.set(note(i), i * 24));
  const files = { claude: nb.frame(three, 111), codex: nb.frame(note(0), 222) };
  const bridge = {
    read: async (id) => ({ ok: true, bytes: files[id] || new Uint8Array(0), size: (files[id] || []).length }),
    append: async (id, bytes, at) => {
      if ((files[id] || []).length !== at) return { ok: false, code: 'moved', size: files[id].length };
      files[id] = new Uint8Array([...files[id], ...bytes]);
      return { ok: true, size: files[id].length };
    },
  };
  let state = makeState();
  const shell = { get state() { return state; }, set(next) { state = next; }, now: () => EVENING, bridge: { notebooks: bridge } };
  const habits = await notebookView.loadHabits(shell, 'claude', nb);
  assert.deepEqual([habits.length, habits[0].key, habits[0].count], [1, `${template}:0`, 3]);
  const page = notebookView.buildNotebookPage(notebookView.notebookPageView(state, 'claude', { content, habits, now: EVENING, others: [{ id: 'codex', name: 'The Artificer' }] }));
  assert.ok(page.includes(`<span class="habit-phrase">${habits[0].phrase.charAt(0).toUpperCase()}${habits[0].phrase.slice(1)}</span>`), 'the habit’s own phrase shows, as a sentence starts');
  assert.equal((await notebookView.teachLesson(shell, 'claude', 'codex', habits[0].key, { nb })).ok, true);
  const after = nb.unframe(files.codex);
  assert.deepEqual([after.frames, after.notes.length], [2, 4 * 24], 'one frame appended, the old one untouched');
  const taught = [1, 2, 3].map((i) => nb.decodeNote(after.notes, i * 24));
  assert.ok(taught.every((n) => n.taught && n.template === template), 'the lesson’s notes are marked taught');
  assert.deepEqual(taught.map((n) => n.order), [1, 2, 3], 'numbered on from the Artificer’s own notes');
  assert.equal(state.party.roster.codex.notebook.count, 3);
});

// ---- Level up --------------------------------------------------------------
test('Level up offers path, boon and Pages choices, and never during a fight', () => {
  const road3 = { ...makeState(), road: { ...emptyState4().road, xp: rulesLoaded.road.xp[3] } };
  const view = levelup.levelUpView(road3, 'milo', { content, rules: rulesLoaded });
  assert.deepEqual([view.level, view.choices.map((c) => c.kind)], [4, ['path', 'boon']]);
  const html = levelup.buildLevelUp(view); assert.match(html, /<h3>Choose a path<\/h3>/);
  assert.match(html, /data-action="levelup-choose" data-member="milo" data-kind="path" data-choice="hearth"/);
  assert.match(html, /data-kind="boon" data-choice="ability-up-wit"[^>]*>Ability up: Wit<\/button>/);
  assertControls(html, 'Level up');
  assertCalmHtml(html, 'Level up');
  assert.ok(html.includes('Swap paths at camp.') && !html.includes('Friend') && !html.includes('Phase 5'), 'nothing promises Friend a second path or names a later phase (§3.2)');
  const live = levelup.buildLevelUp(levelup.levelUpView({ ...road3, expedition: { battle: { v: 2, id: 'x' } } }, 'milo', { content, rules: rulesLoaded }));
  assert.ok(live.includes('Level ups wait until the fight is over.') && !live.includes('levelup-choose'));
  const bubble = levelup.levelUpBubble('The Scribe', 4, 'claude');
  assert.deepEqual(bubble, { kind: 'levelup', title: 'The Scribe, level 4', lines: ['The Scribe is level 4. There’s a choice waiting.'], place: 'levelup:claude', actions: [{ id: 'show', label: 'Choose now' }] });
  for (const line of bubble.lines) assertCalm(line, 'the level up bubble');
  const panels = {}; let state = road3;
  levelup.mount({ get state() { return state; }, set(n) { state = n; }, now: () => NOON, content: () => content, registerPanel: (p, d) => { panels[p] = d; return () => {}; }, refreshPanel() {} });
  panels['levelup:'].action({ dataset: { action: 'levelup-choose', kind: 'path', choice: 'wick' } }, 'levelup:milo');
  assert.equal(state.party.roster.milo.path, 'wick');
  // The Scribe's Pages show the room left (Wit + level), grey the spare picks once it's full, and say why a pick or a write is refused.
  const s0 = makeState();
  state = { ...s0, party: { ...s0.party, roster: { ...s0.party.roster, claude: { ...s0.party.roster.claude, prepared: ['salve'] } } } };
  const opts = { content, rules: rulesLoaded };
  const ids = levelup.levelUpView(state, 'claude', opts).choices.find((c) => c.kind === 'spells').options.map((o) => o.id);
  const full = levelup.levelUpView(state, 'claude', { ...opts, picked: ids.slice(0, 3) }).choices.find((c) => c.kind === 'spells');
  assert.deepEqual([full.room, full.options.map((o) => o.disabled)], [{ max: 4, prepared: 1, picked: 3, left: 0 }, [false, false, false, true, true]]);
  const pagesHtml = levelup.buildLevelUp(levelup.levelUpView(state, 'claude', { ...opts, picked: ids.slice(0, 3) }));
  assert.ok(pagesHtml.includes('Room for 0 more of 4 Pages, from Wit and level.') && pagesHtml.includes(`data-choice="${ids[3]}" data-focus-key="levelup-page-claude-${ids[3]}" aria-pressed="false" disabled title="No room for more Pages."`));
  const act = (action, choice) => { panels['levelup:'].action({ dataset: { action, choice } }, 'levelup:claude'); return /<p class="plot-note" role="status">([^<]*)<\/p>/.exec(panels['levelup:'].render('levelup:claude'))?.[1] || null; };
  assert.deepEqual([act('levelup-spells'), ...ids.slice(0, 3).map((id) => act('levelup-page', id)), act('levelup-page', ids[3])], ['Pick the Pages to write first.', null, null, null, 'No room for more Pages. Take one off first.']);
  assert.equal(levelup.levelUpRefusal(state, { kind: 'spells', ids: ids.slice(0, 4) }, levelup.pagesRoom(state, 'claude', ids.slice(0, 4), opts)), 'Those don’t fit: there’s room for 3 more.');
  assert.deepEqual([act('levelup-spells'), state.party.roster.claude.prepared], [null, ['salve', ...ids.slice(0, 3)]], 'three fit, and are written');
  for (const html of [pagesHtml, levelup.buildLevelUp(levelup.levelUpView(state, 'claude', { ...opts, note: 'Pick the Pages to write first.' }))]) { assertControls(html, 'Pages'); assertCalmHtml(html, 'Pages'); }
  for (const w of [muster.musterRefusal({ expedition: { battle: {} } }, 'x'), muster.musterRefusal(makeState(), 'nobody'), muster.musterRefusal(makeState(), null), levelup.levelUpRefusal({ expedition: { inside: true } }, { kind: 'spells', ids: ['a'] }), levelup.levelUpRefusal({}, { kind: 'path' }), 'No room for more Pages. Take one off first.', 'Pick the Pages to write first.',
    'Slot 1 cleared. The Scribe waits a tick there, so the rest keep their ticks.', 'The Scribe takes the suggestion.', 'Round 1 · planning. Every plan is yours to write.']) assertCalm(w, 'K2’s new words');
});

test('every mount is calm: a no-op without the shell’s pieces, never throwing, and its panel ids stay clear of Phase 3’s', () => {
  const modules = [hud, planner, combatants, muster, campView, company, dialogue, notebookView, levelup];
  assert.deepEqual(modules.map((m) => m.id), ['combat-hud', 'planner', 'combatants', 'muster', 'camp-view', 'company-view', 'dialogue', 'notebook-view', 'levelup']);
  const original = console.error;
  console.error = () => {};
  try {
    const noDoc = { document: { getElementById: () => null } };
    const broken = { registerPanel() { throw new Error('boom'); }, on() { throw new Error('boom'); } };
    for (const m of modules) {
      assert.equal(typeof m.mount({}, noDoc).dispose, 'function', `${m.id} without a shell`);
      assert.doesNotThrow(() => m.mount(broken, noDoc), `${m.id} with a shell that throws`);
    }
  } finally {
    console.error = original;
  }
  const prefixes = [];
  const shell = { state: makeState(), registerPanel: (p) => { prefixes.push(p); return () => {}; }, content: () => content, now: () => NOON };
  for (const m of [muster, campView, company, notebookView, levelup]) m.mount(shell);
  assert.deepEqual(prefixes.sort(), ['camp-fire', 'company:', 'levelup:', 'muster', 'notebook:', 'talk:']);
  for (const p of prefixes) assert.ok(!/^(rift|lantern|poi):/.test(p) && p.length <= 64 && /^[a-z][a-z0-9:-]*$/.test(p), p);
});

// ---- Portraits (panelart.js) -----------------------------------------------
test('portraits draw every Look the company has, from the fight’s own frames, deterministically', () => {
  const rig = (r, who, likeness = null) => ({ kind: 'rig', rig: r, who, likeness });
  const looks = [rig('coat', 'milo'), rig('robe', 'claude'), rig('robe', 'claude', 'clay'), rig('jev', 'jev'), rig('toll', 'tollkeeper'),
    { kind: 'stray', archetype: 'walker', bodyKey: 'r', parts: [], eyeKey: null, genres: ['neon', null], scale: 1 }, { kind: 'device', template: 'turret' }, { kind: 'sprite', name: 'chest.mimic' }];
  for (const look of looks) {
    const a = portraitScene(look, { genre: 'gothic', genres: content.genres });
    assert.ok(a && a.width > 4 && a.height > 4, `${look.kind} ${look.who || look.archetype || look.template || look.name} draws`);
    assert.deepEqual(a, portraitScene(look, { genre: 'gothic', genres: content.genres }), 'the same look gives the same picture');
    let ink = 0;
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i]) ink += 1;
    assert.ok(ink > 20, 'it has ink');
  }
  assert.notDeepEqual(portraitScene(looks[0], { genres: content.genres }).data, portraitScene(looks[0], { genre: 'gothic', genres: content.genres }).data, 'Milo’s coat takes the genre’s colours');
  assert.deepEqual(portraitScene(looks[2], { genres: content.genres }), portraitScene(looks[2], { genre: 'gothic', genres: content.genres }), 'a likeness is its own clay, never dressed');
  assert.deepEqual([portraitScene({ kind: 'rig', rig: 'nope' }), portraitScene(null)], [null, null]);
  const img = rowsScene(['.o', 'oc'], { scale: 3 });
  assert.deepEqual([img.width, img.height, img.data[3], img.data[(0 * 6 + 3) * 4 + 3]], [6, 6, 0, 255], 'clear stays clear, and ink fills its 3 × 3 block');
  assert.deepEqual([...rowsScene(['c'], { layers: ['1'], table2: { c: [1, 2, 3, 255] } }).data], [1, 2, 3, 255], 'layer 1 draws from table2');
  assert.deepEqual([...rowsScene(['oc'], { mirror: true }).data.slice(4, 8)], [...rowsScene(['o']).data], 'mirror flips');
});
