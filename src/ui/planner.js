// The round planner (CONTRACT-PHASE4.md §12.4 K2, §5.5–§5.7, §5.11, §7.1; COMBAT.md §3.2–§3.7,
// §13, §15): three slots per hero (four when Quickened), each draft's confidence (dashed under
// 50%), sync and why?, the odds for the slot in hand (bars or words, amounts with "?" until the
// target is Examined, "could change" when a telegraphed foe action can still move the edge), the
// likeliest trouble under a slot, an area slot's list of everyone it would catch (allies too),
// reactions' Ask, Always, Under half and Never, a Cheer per slot, undo back to the round's start,
// and the Playbook popover. Drafts are read out for screen readers with their confidence and why.
//
// Pure: `plannerView` reads a Battle, the driver's roundView and the HUD's `ui`; `buildPlanner`
// turns that view into HTML (every value through esc()); `combatKey` and `COMBAT_KEYS` are the
// keyboard as a table (never Tab; [ and ] cycle); `plannerReduce` turns a click or a key into the
// next `ui` and the intents the fight acts on ({ t: 'plan' | 'cheer' | 'run' | … }). Nothing here
// reads a clock or the DOM.
import { esc } from './panels.js';
import { oddsText, actionWords, draftReadout, nameOf, nameIn, tileName } from '../combat/describe.js';
import { legalActions } from '../combat/battle.js';
import { oddsByTarget, specFor } from '../combat/abilities.js';
import { ticksOf, speedOf, hasRule } from '../combat/round.js';
import { createGrid, unitDist } from '../combat/grid.js';
import { areaTiles, canStep } from '../combat/effects.js';
import { bandOf } from '../combat/heat.js';

export const id = 'planner';

// ---------------------------------------------------------------------------
// Words and small shared pieces

export const REACTION_SETTINGS = Object.freeze(['ask', 'always', 'under-half', 'never']);
export const SETTING_WORDS = Object.freeze({ ask: 'Ask', always: 'Always', 'under-half': 'Under half', never: 'Never' });
export const CONTROL_WORDS = Object.freeze({ mine: 'Mine', review: 'Review', choose: 'Let them choose', auto: 'On their own' });
export const BAND_WORDS = Object.freeze({ cool: 'Cool', warm: 'Warm', hot: 'Hot' });
const DEGREES = Object.freeze(['crit', 'hit', 'graze', 'miss']);
const DEGREE_WORDS = Object.freeze({ crit: 'Critical', hit: 'Hit', graze: 'Graze', miss: 'Miss' });
const REACTION_NAMES = Object.freeze({ 'parting-swipe': 'Parting swipe', shoulder: 'Shoulder', ready: 'Ready' });
const LOST_WORDS = Object.freeze({
  'wont-fit': 'This won’t fit in the round.', slowed: 'Slowed: this one is lost.', winded: 'Winded: this one is lost.',
  asleep: 'Surprised: this one is lost.', dazed: 'Dazed: this one is lost.',
});
const PAGE = 10;
// Easing sticks (the HUD sets party.mode too), so the fights after start in Storybook until Setting out changes it.
export const EASE_WORDS = 'Storybook from the next round, and for the fights after. Setting out can change it back.';
const READY_WORDS = Object.freeze({ 'foe-enters-reach': 'for a foe in reach', 'foe-moves-in-sight': 'for a foe moving in sight', 'strike-at-ally': 'for a strike at an ally' });
const MINUS = '−';

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const pct = (v) => `${clampInt(v, 0, 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0');
const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const attr = (name, value) => (value === null || value === undefined || value === false ? '' : ` ${name}="${esc(value === true ? 'true' : value)}"`);
const unitIn = (battle, unitId) => (battle?.units || []).find((u) => u.id === unitId) || null;
const standing = (u) => !!u && !u.sorted && !u.offline;
const ability = (ctx, abilityId) => (abilityId && ctx?.abilities?.get ? ctx.abilities.get(abilityId) || null : null);
const sameAction = (a, b) => !!a && !!b && JSON.stringify({ ...a, cheer: false }) === JSON.stringify({ ...b, cheer: false });
const isUnseen = (u) => !!u && u.side !== 'party' && (u.conditions || []).some((c) => c.id === 'unseen');
// A foe whose telegraphs the HUD's cards and the board show (§18.3 item 5): there, standing, not Unseen.
const inView = (battle, unitId) => { const u = unitIn(battle, unitId); return !!u && !u.sorted && !isUnseen(u); };
const UNSEEN = 'something unseen';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The battle as the planner's words name it: an Unseen foe is "something unseen", as its HUD card is.
function veiled(battle) {
  if (!(battle?.units || []).some(isUnseen)) return battle;
  return { ...battle, units: battle.units.map((u) => (isUnseen(u) ? { ...u, name: UNSEEN } : u)) };
}

/**
 * The engine's own words (a slot's trouble, an Ask) with each Unseen foe's name as "something
 * unseen", unless someone in view has the same name.
 */
export function veilWords(battle, text) {
  const units = battle?.units || [];
  const shown = new Set(units.filter((u) => !isUnseen(u)).map((u) => String(u.name || '').toLowerCase()));
  let s = String(text ?? '');
  for (const u of units) {
    const name = String(u.name || '').replace(/^the /i, '');
    if (!isUnseen(u) || !name || shown.has(String(u.name).toLowerCase())) continue;
    s = s.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:the )?${escRe(name)}(?![\\p{L}\\p{N}])`, 'giu'), (m, at) => (at === 0 ? upper(UNSEEN) : UNSEEN));
  }
  return s;
}

// A trouble line as the planner shows it: an Unseen foe unnamed, and never what one means to do.
function troubleWords(battle, words) {
  const said = veilWords(battle, words);
  return said !== String(words ?? '') && /\bmeans to\b/.test(said) ? null : said;
}

/**
 * The heat gauge (COMBAT §13, §15): a colour-blind-safe thermometer with its number, the band
 * named, and a tick at each band's edge (30 and 60).
 */
export function heatGauge(heat, { idle = null, unitId = '' } = {}) {
  const value = clampInt(heat, 0, 100);
  const band = bandOf(value);
  const label = `Heat ${value}, ${BAND_WORDS[band]}${Number.isFinite(idle) ? `, rests at ${clampInt(idle, 0, 100)}` : ''}`;
  const key = unitId ? `${unitId}.heat` : '';
  const cell = (suffix) => (key ? ` data-cell="${esc(key + suffix)}"` : '');
  return `<span class="heat" data-band="${band}" data-heat="${value}" role="img" aria-label="${esc(label)}" style="--heat:${value}%"${cell('')}>`
    + '<span class="heat-tube" aria-hidden="true"><span class="heat-fill"></span><i class="heat-mark" style="--at:30%"></i><i class="heat-mark" style="--at:60%"></i></span>'
    + `<span class="heat-num" aria-hidden="true"${cell('.num')}>${value}</span><span class="heat-band" aria-hidden="true"${cell('.band')}>${BAND_WORDS[band]}</span></span>`;
}

/** Charges as ✦ (left) and ✧ (spent). */
export function chargePips(left, max) {
  const m = clampInt(max, 0, 12);
  const l = clampInt(left, 0, m);
  if (!m) return '';
  return `<span class="charges" role="img" aria-label="${l} of ${m} charges">${'✦'.repeat(l)}${'✧'.repeat(m - l)}</span>`;
}

// ---------------------------------------------------------------------------
// Reading a battle

/** Heroes in formation order (the party's units, devices left out). */
export function heroesOf(battle) {
  return (battle?.units || []).filter((u) => u.side === 'party' && u.rank === 'hero');
}

/** The plan a hero shows: the one set this round, else the draft's, else an empty one (Mine). */
export function currentPlan(battle, roundView, unitId) {
  const set = battle?.plans?.[unitId];
  if (set) return set;
  const draft = roundView?.drafts?.[unitId];
  if (draft?.plan) return draft.plan;
  return { unitId, slots: [], reactions: {}, by: 'you', changed: [] };
}

const isPlanning = (battle) => battle?.status === 'planning';

/** Whether Chris may change a hero's plan now. */
export function editable(battle, unit, ui = {}) {
  if (!isPlanning(battle) || !standing(unit) || ui.handed) return false;
  return unit.control !== 'choose' && unit.control !== 'auto';
}

/** A Delay (§5.5): it waits one tick, so the slots after it keep their ticks. */
const DELAY = Object.freeze({ id: 'delay', ability: null, cost: 0, target: null, extra: 0, choice: null, cheer: false, trigger: null });
const PROBE = Object.freeze({ ...DELAY, id: 'strike', cost: 1 });
const MAX_SLOTS = 4; // battle.js keeps at most four actions a plan

/**
 * The tick an action set in slot `index` starts at when that slot is empty: the plan's actions
 * before it, then a Delay in each empty slot between (as placeInSlot pads them).
 */
export function openTick(plan, unit, index) {
  const slots = (plan?.slots || []).slice(0, index);
  while (slots.length < index) slots.push(DELAY);
  const ticks = ticksOf({ slots: [...slots, PROBE] }, unit);
  return ticks[ticks.length - 1]?.tick ?? index + 1;
}

/**
 * How many slots a hero's round shows: the plan's actions, then an empty slot for each tick left
 * (3 ticks, 4 when Quickened; a 2-action activity uses two, a free action none), at most four.
 */
export function slotCount(unit, plan) {
  const conds = (unit?.conditions || []).filter((c) => !c?.data?.fresh);
  const full = conds.some((c) => c.id === 'quickened' || c.id === 'brisk') ? 4 : 3;
  const len = Math.min(MAX_SLOTS, plan?.slots?.length || 0);
  let n = len;
  while (n < MAX_SLOTS && openTick(plan, unit, n) <= full) n += 1;
  return n;
}

/** The reactions a hero has and how each is set this round (the plan, then the hero, then the rules). */
export function reactionsOf(battle, unit, plan, ctx) {
  if (!unit) return [];
  const ids = ['parting-swipe', 'shoulder'];
  for (const abilityId of unit.abilityIds || []) {
    const a = ability(ctx, abilityId);
    if (a?.kind === 'reaction' && !ids.includes(abilityId)) ids.push(abilityId);
  }
  const rules = ctx?.rules?.reactions || {};
  return ids.map((reactionId) => {
    const setting = plan?.reactions?.[reactionId] || unit.reactions?.[reactionId] || rules[reactionId] || rules.default || 'always';
    return { id: reactionId, name: REACTION_NAMES[reactionId] || ability(ctx, reactionId)?.name || upper(reactionId.replace(/-/g, ' ')), setting };
  });
}

// The area an action's use would cover (null when it isn't an area use), and who'd be caught.
function areaOf(battle, unitId, action, ctx) {
  if (!action || action.id !== 'use') return null;
  const a = ability(ctx, action.ability);
  const spec = a ? specFor(a, { cost: action.cost, choice: action.choice }) : null;
  const area = spec?.target?.area;
  const u = unitIn(battle, unitId);
  if (!area || !u) return null;
  const grid = createGrid(battle, ctx.rules);
  const wit = (u.abilities?.wit ?? 0) >= 3 && a.kind === 'spell' && (action.cost || 1) >= 2 ? 1 : 0;
  const tiles = areaTiles(battle, grid, u, area, action.target, wit, area.at === 'self' || spec.target.who === 'self');
  if (!tiles) return null;
  const said = veiled(battle);
  const caught = grid.caught(tiles).map((uid) => {
    const v = unitIn(battle, uid);
    return { id: uid, name: nameIn(said, uid), ally: v?.side === u.side };
  });
  return { tiles, caught, helpful: !!a.helpful };
}

// The battle with the unit on the tile its moves before `slot` leave it on (for areas and the tile
// cursor; legalActions and oddsFor project heat, attacks and charges for themselves).
function projected(battle, unitId, plan, slot, ctx) {
  if (!plan || !slot) return battle;
  const before = { ...plan, slots: plan.slots.slice(0, slot) };
  let b = battle;
  const u0 = unitIn(battle, unitId);
  if (!u0) return battle;
  let x = u0.x;
  let y = u0.y;
  for (const a of before.slots) {
    if (!a || !['stride', 'step', 'jump'].includes(a.id) || !a.target) continue;
    const end = a.target.path?.length ? a.target.path[a.target.path.length - 1] : a.target.tile;
    if (end) { x = end.x; y = end.y; }
  }
  if (x !== u0.x || y !== u0.y) b = { ...battle, units: battle.units.map((v) => (v.id === unitId ? { ...v, x, y } : v)) };
  return b;
}

/**
 * Why an odds row could still change: the telegraphed foe action that resolves first, from a foe
 * the HUD's cards show (inView, as foeIntents); an Unseen or sorted foe's is never named.
 */
function changeWords(battle, unitId, targetId, plan, slot, unit) {
  const ticks = plan && unit ? ticksOf(plan, unit) : [];
  const myTick = ticks.find((t) => t.slot === slot)?.ends ?? slot + 1;
  const tele = (battle.telegraphs || []).find((t) => inView(battle, t.unitId) && t.tick < myTick
    && ((t.icon === 'move' && (t.unitId === targetId || t.unitId === unitId)) || ['mechanic', 'surface', 'area'].includes(t.icon)));
  if (!tele) return 'Could change before it lands.';
  const mover = nameIn(battle, tele.unitId);
  if (tele.hidden) return `Could change: ${mover} has something planned first.`;
  return `Could change: ${mover} means to ${lower(tele.words)} first.`;
}

/**
 * The odds rows for one slot: one per target the action picks for, with the words the planner
 * shows (bars or words), the parts that make up its edge and whether a telegraphed foe action
 * could still change it.
 */
export function slotOdds(battle, unitId, action, ctx, { slot = 0, plan = null, style = 'bars' } = {}) {
  if (!action) return [];
  const u = unitIn(battle, unitId);
  const said = veiled(battle);
  let rows;
  try {
    rows = oddsByTarget(battle, unitId, action, ctx, { slot, plan });
  } catch {
    rows = [];
  }
  return rows.map(({ targetId, odds }) => ({
    target: targetId,
    name: targetId ? nameIn(said, targetId) : null,
    odds,
    text: oddsText(odds, { style }),
    title: `${BAND_WORDS[odds.band]} ${odds.heat}, ${signed(odds.edge)} edge`,
    parts: (odds.parts || []).filter((p) => p && p.n).map((p) => `${p.why} ${signed(p.n)}`),
    change: odds.changeable ? changeWords(battle, unitId, targetId, plan, slot, u) : null,
  }));
}

// ---------------------------------------------------------------------------
// The view

/**
 * A draft's why? lines, one per piece of evidence: slots that give the same reason share a line
 * ("Slots 1 to 3"), and the reaction's setting keeps its own.
 */
export function whyLines(why) {
  const out = [];
  for (const w of Array.isArray(why) ? why : []) {
    if (!w || !w.text) continue;
    const text = String(w.text);
    const layer = w.layer || 'personality';
    const same = Number.isInteger(w.slot) ? out.find((o) => o.text === text && o.layer === layer && o.slots.length) : null;
    if (same) same.slots.push(w.slot);
    else out.push({ slot: w.slot, layer, text, slots: Number.isInteger(w.slot) ? [w.slot] : [] });
  }
  return out.map((o) => {
    const n = o.slots.map((s) => s + 1);
    const run = n.length > 1 && n.every((x, i) => i === 0 || x === n[i - 1] + 1);
    const label = o.slot === 'reaction' ? 'Reaction' : !n.length ? 'Draft' : n.length === 1 ? `Slot ${n[0]}`
      : run ? `Slots ${n[0]} to ${n[n.length - 1]}` : `Slots ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
    return { slot: o.slot, slots: o.slots, layer: o.layer, text: o.text, label };
  });
}

function draftView(battle, draft, ctx, sync) {
  if (!draft) return null;
  const confidence = clampInt(draft.confidence, 0, 100);
  return {
    confidence,
    dashed: confidence < 50,
    source: draft.source || 'personality',
    sync: Number.isFinite(sync) ? clampInt(sync, 0, 100) : null,
    why: whyLines(draft.why),
    readout: draftReadout(draft, veiled(battle), ctx),
  };
}

// The schedule's progress for a slot while the round runs: done, now or waiting.
function runState(battle, unitId, slot) {
  const sched = battle.schedule || [];
  const at = sched.findIndex((e) => e.unitId === unitId && e.slot === slot);
  if (at < 0) return null;
  if (at < (battle.cursor || 0) - 1) return 'done';
  if (at === (battle.cursor || 0) - 1) return 'now';
  return 'waiting';
}

function slotsView(battle, unit, plan, draft, ctx, ui, { troubles, canEdit, ghostPlan = null }) {
  const n = slotCount(unit, plan);
  const ticks = ticksOf(plan, unit);
  const out = [];
  const running = battle.status === 'running' || battle.status === 'asking';
  const planning = isPlanning(battle);
  const said = veiled(battle);
  for (let i = 0; i < n; i += 1) {
    const action = plan.slots[i] || null;
    const t = ticks.find((x) => x.slot === i) || null;
    const selected = ui.selected === unit.id && ui.slot === i;
    // Areas and trouble are planning aids; while the round runs the slots hold still (no rebuild per tick).
    const area = action && planning ? areaOf(projected(battle, unit.id, plan, i, ctx), unit.id, action, ctx) : null;
    const words = action ? actionWords(said, unit.id, action, ctx) : 'Empty';
    const trouble = planning ? (troubles || []).filter((x) => x.slot === i).map((x) => troubleWords(battle, x.words)).filter(Boolean) : [];
    if (t?.lost && !trouble.length) trouble.push(LOST_WORDS[t.lost] || LOST_WORDS['wont-fit']);
    const drafted = draft?.plan?.slots?.[i] || null;
    const ghost = !action && ghostPlan?.slots?.[i] ? actionWords(said, unit.id, ghostPlan.slots[i], ctx) : null;
    out.push({
      index: i,
      action,
      words,
      empty: !action,
      ghost,
      cost: action ? (t?.ends ? t.ends - t.tick + 1 : action.cost || 0) : 0,
      // An empty slot's tick is where an action set there would start (openTick).
      tick: t?.tick ?? (action ? null : openTick(plan, unit, i)),
      ends: t?.ends ?? null,
      winding: !!(t && t.ends && t.ends > t.tick),
      lost: t?.lost || null,
      changed: !!action && (planning ? !!draft && plan.by !== 'you' && !sameAction(action, drafted) : !!plan.changed?.[i]),
      cheer: !!action?.cheer,
      selected,
      trouble,
      caught: area ? area.caught : null,
      helpful: area ? area.helpful : null,
      run: running && action ? runState(battle, unit.id, i) : null,
      canEdit,
    });
  }
  return out;
}

/**
 * A ghosted suggestion (COMBAT §15's Command setting): a pale draft for a hero on Mine, from
 * `roundView.ghosts` (the HUD fills it while `party.calm.ghosts` is on). Never a draft: taking it
 * writes the plan as yours.
 */
export function ghostOf(battle, roundView, unitId) {
  const u = unitIn(battle, unitId);
  const g = roundView?.ghosts?.[unitId];
  return isPlanning(battle) && u?.control === 'mine' && !roundView?.drafts?.[unitId] && Array.isArray(g?.plan?.slots) && g.plan.slots.length ? g : null;
}

function heroView(battle, roundView, unit, ctx, ui, extra) {
  const plan = currentPlan(battle, roundView, unit.id);
  const draftRaw = roundView?.drafts?.[unit.id] || null;
  const draft = isPlanning(battle) ? draftView(battle, draftRaw, ctx, extra.sync?.[unit.id]) : null;
  const canEdit = editable(battle, unit, ui);
  const troubles = roundView?.trouble?.[unit.id] || [];
  const ghost = canEdit ? ghostOf(battle, roundView, unit.id) : null;
  return {
    id: unit.id,
    name: unit.name,
    integrity: unit.integrity,
    max: unit.maxIntegrity,
    heat: unit.heat,
    idle: Number.isFinite(unit.idleHeat) ? unit.idleHeat : null,
    offline: !!unit.offline,
    control: unit.control || 'review',
    controlWords: CONTROL_WORDS[unit.control] || CONTROL_WORDS.review,
    voice: ctx?.party?.[unit.id]?.voice === 'pictures' ? 'pictures' : 'words',
    selected: ui.selected === unit.id,
    canEdit,
    // The Playbook opens between rounds for anyone standing, "Let them choose" and "On their own" most of all.
    canRules: isPlanning(battle) && standing(unit),
    set: !!battle.plans?.[unit.id],
    by: plan.by || 'you',
    draft,
    ghost: !!ghost,
    slots: unit.offline ? [] : slotsView(battle, unit, plan, draftRaw, ctx, ui, { troubles, canEdit, ghostPlan: ghost?.plan || null }),
    reactions: unit.offline ? [] : reactionsOf(battle, unit, plan, ctx),
  };
}

/** The bar for the selected slot: every legal action, enabled ones first, ten keys to a page. */
export function barOptions(battle, roundView, unitId, slot, ctx) {
  const plan = currentPlan(battle, roundView, unitId);
  const before = { ...plan, slots: plan.slots.slice(0, slot) };
  let list;
  try {
    list = legalActions(battle, unitId, ctx, { slot, plan: before });
  } catch {
    list = [];
  }
  const indexed = list.map((o, index) => ({ ...o, index }));
  return [...indexed.filter((o) => !o.why), ...indexed.filter((o) => o.why)];
}

// Ten keys to a page; when there's more than one page, 0 is More, so each page shows nine.
function barView(options, page) {
  const more = options.length > PAGE;
  const per = more ? PAGE - 1 : PAGE;
  const pages = more ? Math.ceil(options.length / per) : 1;
  const p = clampInt(page, 0, pages - 1);
  const start = p * per;
  const shown = options.slice(start, start + per);
  return {
    page: p,
    pages,
    options: shown.map((o, i) => ({
      key: String((i + 1) % 10),
      index: o.index,
      words: o.action?.id === 'ready' && READY_WORDS[o.action.trigger] ? `${o.words} ${READY_WORDS[o.action.trigger]}` : o.words,
      cost: o.cost,
      disabled: !!o.why,
      why: o.why || null,
      targets: Array.isArray(o.targets) ? 'units' : o.targets || null,
    })),
    more,
  };
}

function targetWords(battle, unitId, option, target) {
  if (!target) return '';
  return actionWords(veiled(battle), unitId, { ...option.action, target });
}

/**
 * A tile pick's rules, from where the unit stands when that slot comes up (§4.4, as the kernel
 * checks them): a Stride within its speed, a Step one tile, a Jump within its range, and an
 * ability's range and sight. → { grid, unit, budget, ignoreDifficult, aim(tile) → { target, say } },
 * where `target` is null (with calm words saying why) when the action can't land there; null
 * without the unit.
 */
export function tileAim(battle, roundView, unitId, option, slot, ctx = {}) {
  const plan = currentPlan(battle, roundView, unitId);
  const b = projected(battle, unitId, plan, slot || 0, ctx);
  const u = unitIn(b, unitId);
  if (!u || !option) return null;
  const grid = createGrid(b, ctx?.rules);
  const Who = nameOf(b, u.id);
  const who = nameIn(b, u.id);
  const id = option.action?.id;
  const here = (t) => t.x === u.x && t.y === u.y;
  // Where a move can't end: someone's there (never naming an Unseen foe), or a wall, a gap or a tall prop.
  const standWhy = (t) => {
    if (grid.canStand(t.x, t.y, u.id)) return null;
    const v = unitIn(b, grid.occupant(t.x, t.y));
    const hidden = v && v.side !== u.side && (v.conditions || []).some((c) => c.id === 'unseen');
    return v && v.id !== u.id && !hidden ? `${nameOf(b, v.id)} is standing there.` : 'There’s no room to stand there.';
  };
  if (option.targets === 'path') {
    const budget = speedOf(b, u, ctx, { stride: true });
    const ignoreDifficult = hasRule(ctx, u, 'ignore-difficult');
    return {
      grid, unit: u, budget, ignoreDifficult,
      aim(t) {
        if (here(t)) return { target: null, say: `${Who} is already there.` };
        const stand = standWhy(t);
        if (stand) return { target: null, say: stand };
        const path = grid.path(u.id, t, { budget, ignoreDifficult });
        if (path && path.length) return { target: { path } };
        const any = grid.path(u.id, t, { ignoreDifficult });
        return { target: null, say: any && any.length ? `That’s further than ${who} can go in one Stride.` : 'There’s no way there.' };
      },
    };
  }
  let check = () => null;
  if (id === 'step') {
    check = (t) => (unitDist(u, t) > 1 ? 'A Step goes one tile.' : standWhy(t) || (canStep(grid, u, t) ? null : 'There’s no room to step there.'));
  } else if (id === 'jump') {
    const range = Math.max(1, (ctx?.rules?.actions?.jumpBase ?? 2) + (u.abilities?.might ?? 0));
    check = (t) => (unitDist(u, t) > range ? `That’s further than ${who} can jump.` : standWhy(t) || (grid.canJump(u.id, t, range) ? null : `${Who} can’t jump there.`));
  } else if (id === 'use') {
    const a = ability(ctx, option.action.ability);
    const spec = a ? specFor(a, { cost: option.action.cost, choice: option.action.choice }) : null;
    const t0 = spec?.target;
    if (t0?.who === 'tile') {
      const wit = (u.abilities?.wit ?? 0) >= 3 && a.kind === 'spell' && (option.action.cost || 1) >= 2 ? 1 : 0;
      const range = (t0.range ?? 1) + wit;
      check = (t) => (!grid.inside(t.x, t.y) ? 'That’s outside the room.' : unitDist(u, t) > range ? 'That’s out of range.'
        : t0.sight !== false && !grid.sees(u, t) ? `${Who} can’t see there.` : null);
    }
  }
  const moves = id === 'step' || id === 'jump';
  return {
    grid, unit: u, budget: null, ignoreDifficult: false,
    aim(t) {
      if (moves && here(t)) return { target: null, say: `${Who} is already there.` };
      const why = check(t);
      return why ? { target: null, say: why } : { target: { tile: { x: t.x, y: t.y } } };
    },
  };
}

function pickView(battle, roundView, unitId, options, ui, ctx) {
  const pick = ui.pick;
  if (!pick) return null;
  const option = options.find((o) => o.index === pick.option);
  if (!option) return null;
  if (option.targets === 'tile' || option.targets === 'path') {
    const at = ui.cursor ? tileName(battle, ui.cursor) : null;
    let trouble = null;
    if (ui.cursor) {
      const aim = tileAim(battle, roundView, unitId, option, ui.slot, ctx);
      trouble = aim ? aim.aim(ui.cursor).say || null : 'There’s no way there.';
    }
    return { mode: 'tile', words: option.words, at, trouble, hint: 'Arrows move the cursor, Enter confirms, Esc goes back.' };
  }
  const targets = Array.isArray(option.targets) ? option.targets : [];
  const i = clampInt(pick.target, 0, Math.max(0, targets.length - 1));
  return {
    mode: 'target', words: option.words, index: i, count: targets.length,
    at: targetWords(battle, unitId, option, targets[i]), trouble: null,
    hint: '[ and ] cycle targets, Enter confirms, Esc goes back.',
  };
}

/** The Playbook popover's view: a companion's rules as if/then selects, up to `max`. */
export function playbookView(unit, { rules = [], max = 1, ifs = [], thens = [], text = null, canEdit = true } = {}) {
  if (!unit) return null;
  const list = (Array.isArray(rules) ? rules : []).slice(0, 6).map((r, i) => ({
    index: i, if: r?.if || '', then: r?.then || '', text: typeof text === 'function' ? text(r) : null,
  }));
  return {
    unitId: unit.id,
    name: unit.name,
    rules: list,
    max: clampInt(max, 1, 6),
    room: list.length < clampInt(max, 1, 6),
    ifs: (ifs || []).map((x) => ({ id: String(x.id), words: String(x.words) })),
    thens: (thens || []).map((x) => ({ id: String(x.id), words: String(x.words) })),
    ready: (ifs || []).length > 0 && (thens || []).length > 0,
    canEdit,
  };
}

/**
 * The planner's view (§12.4). `ui` is the HUD's (§12.4: selected, slot, cursor, hover, popover,
 * odds, playback; K2 adds page, pick, handed, history). `extra`: { sync: { [heroId]: 0–100 },
 * playbook: playbookView options for the selected hero, paused }.
 */
export function plannerView(battle, roundView, ui = {}, ctx = {}, extra = {}) {
  const style = ui.odds === 'words' ? 'words' : 'bars';
  const status = battle?.status || 'planning';
  const phase = status === 'planning' ? 'planning' : status === 'running' ? 'running' : status === 'asking' ? 'asking' : 'over';
  const heroes = heroesOf(battle).map((u) => heroView(battle, roundView, u, ctx, ui, extra));
  const selected = heroes.find((h) => h.selected) || null;
  const unit = selected ? unitIn(battle, selected.id) : null;
  let bar = null;
  let pick = null;
  if (phase === 'planning' && selected?.canEdit && Number.isInteger(ui.slot) && ui.slot < selected.slots.length) {
    const options = barOptions(battle, roundView, selected.id, ui.slot, ctx);
    bar = { unitId: selected.id, slot: ui.slot, ...barView(options, ui.page || 0) };
    pick = pickView(battle, roundView, selected.id, options, ui, ctx);
  }
  // The odds shown: the hovered slot's, else the selected slot's.
  const focus = parseFocus(ui.hover) || (selected && Number.isInteger(ui.slot) ? { unitId: selected.id, slot: ui.slot } : null);
  let odds = null;
  if (focus && phase === 'planning') {
    const plan = currentPlan(battle, roundView, focus.unitId);
    const action = plan.slots[focus.slot];
    if (action) {
      const rows = slotOdds(battle, focus.unitId, action, ctx, { slot: focus.slot, plan, style });
      odds = { unitId: focus.unitId, slot: focus.slot, words: actionWords(veiled(battle), focus.unitId, action, ctx), style, rows };
    }
  }
  const cheersHeld = clampInt(battle?.cheers ?? roundView?.cheers ?? 0, 0, 4);
  // Run takes the Cheers spent off battle.cheers, so only a plan still being written has some to count.
  const cheersUsed = phase === 'planning' ? Math.min(cheersHeld, heroes.reduce((n, h) => n + h.slots.filter((s) => s.cheer).length, 0)) : 0;
  const tick = battle?.tick || 0;
  // A fourth tick is a Quickened hero’s, never a lagged action (which lands after tick 3).
  const ticks = (battle?.schedule || []).some((e) => e.tick === 4 && !e.late) ? 4 : 3;
  const whyFor = ui.popover === 'why' && selected?.draft ? selected : null;
  const history = Array.isArray(ui.history) ? ui.history.length : 0;
  return {
    phase,
    round: battle?.round || 1,
    title: phase === 'planning' ? `Round ${battle?.round || 1} · planning` : phase === 'over' ? `Round ${battle?.round || 1} · over`
      : `Round ${battle?.round || 1} · tick ${Math.max(1, tick)} of ${ticks}`,
    heroes,
    selected: selected ? selected.id : null,
    slot: Number.isInteger(ui.slot) ? ui.slot : null,
    bar,
    pick,
    odds,
    style,
    why: whyFor ? { unitId: whyFor.id, name: whyFor.name, voice: whyFor.voice, lines: whyFor.draft.why, confidence: whyFor.draft.confidence } : null,
    playbook: ui.popover === 'rules' && unit ? playbookView(unit, { ...(extra.playbook || {}), canEdit: phase === 'planning' }) : null,
    keys: ui.popover === 'keys',
    cheers: { held: cheersHeld, used: cheersUsed, left: Math.max(0, cheersHeld - cheersUsed) },
    noise: roundView?.noise || null,
    playback: [1, 2, 4].includes(ui.playback) ? ui.playback : 1,
    canRun: phase === 'planning' && !ui.handed,
    canWrap: !!roundView?.canWrap,
    canUndo: phase === 'planning' && history > 0,
    handed: !!ui.handed,
    paused: !!extra.paused,
    guided: extra.guided !== false,
    easing: battle?.mode !== 'storybook' && battle?.modeNext !== 'storybook' && !['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home'].includes(status),
  };
}

const parseFocus = (hover) => {
  const m = /^slot:(.+):(\d)$/.exec(String(hover || ''));
  return m ? { unitId: m[1], slot: Number(m[2]) } : null;
};

// ---------------------------------------------------------------------------
// HTML

const fkey = (...parts) => esc(parts.join('-'));
const btn = (action, label, { cls = 'px-btn small', focus, data = {}, pressed = null, disabled = false, describedby = null, aria = null, title = null } = {}) => {
  const dataAttrs = Object.entries(data).map(([k, v]) => attr(`data-${k}`, v)).join('');
  return `<button type="button" class="${esc(cls)}" data-action="${esc(action)}"${dataAttrs} data-focus-key="${esc(focus)}"`
    + `${pressed === null ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`}${disabled ? ' disabled' : ''}`
    + `${attr('aria-describedby', describedby)}${attr('aria-label', aria)}${attr('title', title)}>${label}</button>`;
};

function slotHtml(hero, s) {
  const label = `Slot ${s.index + 1}: ${s.words}${s.ghost ? `, suggested: ${s.ghost}` : ''}${s.changed ? ', changed' : ''}${s.cheer ? ', with a Cheer' : ''}${s.lost ? ', lost' : ''}`;
  // The trouble and caught lines describe the slot's button for screen readers.
  const notesId = s.trouble.length || s.caught ? `planner-notes-${hero.id}-${s.index}` : null;
  let html = `<li class="slot" data-slot="${s.index}"${s.empty ? ' data-empty="true"' : ''}${s.changed ? ' data-changed="true"' : ''}`
    + `${s.lost ? ` data-lost="${esc(s.lost)}"` : ''}${s.cheer ? ' data-cheer="true"' : ''}${s.winding ? ' data-winding="true"' : ''}${s.ghost ? ' data-ghost="true"' : ''}`
    + `${s.run ? ` data-run="${esc(s.run)}"` : ''}${s.selected ? ' data-selected="true"' : ''} data-cell="${fkey(hero.id, 'slot', s.index)}">`;
  html += btn('planner-slot', `<span class="slot-n" aria-hidden="true">${s.index + 1}</span><span class="slot-words">${esc(s.words)}</span>`
    + `${s.ghost ? `<span class="slot-ghost" aria-hidden="true">${esc(s.ghost)}</span>` : ''}${s.changed ? '<span class="slot-changed">changed</span>' : ''}`, {
    cls: 'slot-btn', focus: `planner-slot-${hero.id}-${s.index}`, data: { unit: hero.id, slot: s.index }, pressed: s.selected,
    aria: label, describedby: notesId,
  });
  if (hero.canEdit && s.action) {
    html += btn('planner-cheer', '✦', {
      cls: 'cheer-btn', focus: `planner-cheer-${hero.id}-${s.index}`, data: { unit: hero.id, slot: s.index }, pressed: s.cheer,
      aria: s.cheer ? `Take the Cheer off slot ${s.index + 1}` : `Spend a Cheer on slot ${s.index + 1}`,
    });
  }
  if (notesId) {
    html += `<div class="slot-notes" id="${esc(notesId)}">`;
    for (const t of s.trouble) html += `<p class="slot-trouble">${esc(t)}</p>`;
    if (s.caught) {
      const names = s.caught.length ? s.caught.map((c) => `${c.name}${c.ally ? ' (ally)' : ''}`).join(', ') : 'nobody yet';
      html += `<p class="slot-caught" data-helpful="${s.helpful ? 'true' : 'false'}">Catches: ${esc(names)}.</p>`;
    }
    html += '</div>';
  }
  return `${html}</li>`;
}

function reactionsHtml(hero) {
  if (!hero.reactions.length) return '';
  const items = hero.reactions.map((r) => {
    const options = REACTION_SETTINGS.map((s) => `<option value="${s}"${s === r.setting ? ' selected' : ''}>${SETTING_WORDS[s]}</option>`).join('');
    return `<label class="reaction"><span>${esc(r.name)}</span><select class="px-select" data-action="planner-reaction" data-unit="${esc(hero.id)}"`
      + ` data-reaction="${esc(r.id)}" data-focus-key="${fkey('planner-reaction', hero.id, r.id)}"${hero.canEdit ? '' : ' disabled'}>${options}</select></label>`;
  }).join('');
  return `<div class="reactions" role="group" aria-label="${esc(`${hero.name}’s reactions`)}">${items}</div>`;
}

function heroHtml(hero) {
  const readoutId = `planner-readout-${hero.id}`;
  let html = `<li class="hero-row" data-unit="${esc(hero.id)}" data-control="${esc(hero.control)}"${hero.selected ? ' data-selected="true"' : ''}`
    + `${hero.offline ? ' data-offline="true"' : ''}${hero.draft?.dashed ? ' data-dashed="true"' : ''}${hero.canEdit ? '' : ' data-locked="true"'}>`;
  html += '<div class="hero-head">';
  html += btn('planner-select', esc(hero.name), { cls: 'hero-name', focus: `planner-hero-${hero.id}`, data: { unit: hero.id }, pressed: hero.selected, describedby: hero.draft ? readoutId : null });
  html += `<span class="hero-int" data-cell="${fkey(hero.id, 'int')}">${esc(`${hero.integrity}/${hero.max}`)}</span>`;
  html += heatGauge(hero.heat, { idle: hero.idle, unitId: `planner.${hero.id}` });
  html += `<span class="control-badge" data-control="${esc(hero.control)}">${esc(hero.controlWords)}</span>`;
  html += '</div>';
  if (hero.offline) {
    html += '<p class="hero-offline">Offline, dozing. A Reboot brings them back.</p>';
    return `${html}</li>`;
  }
  html += `<ol class="slots" aria-label="${esc(`${hero.name}’s actions`)}">${hero.slots.map((s) => slotHtml(hero, s)).join('')}</ol>`;
  html += '<div class="hero-draft">';
  if (hero.draft) {
    html += `<span class="draft-conf"${hero.draft.dashed ? ' data-dashed="true"' : ''}>${hero.draft.confidence}% sure</span>`;
    if (hero.draft.sync !== null) html += `<span class="draft-sync">sync ${hero.draft.sync}%</span>`;
    html += btn('planner-why', 'why?', { cls: 'link-btn', focus: `planner-why-${hero.id}`, data: { unit: hero.id } });
    if (hero.canEdit) html += btn('planner-accept', 'Accept', { focus: `planner-accept-${hero.id}`, data: { unit: hero.id }, describedby: readoutId });
    html += `<p class="sr-only" id="${esc(readoutId)}">${esc(hero.draft.readout)}</p>`;
  } else if (hero.control === 'mine') {
    html += '<span class="draft-none">Yours to write</span>';
    if (hero.ghost) html += btn('planner-accept', 'Use the suggestion', { cls: 'link-btn', focus: `planner-accept-${hero.id}`, data: { unit: hero.id } });
  }
  if (hero.canRules) html += btn('planner-rules', 'Playbook', { cls: 'link-btn', focus: `planner-rules-${hero.id}`, data: { unit: hero.id } });
  html += '</div>';
  html += reactionsHtml(hero);
  return `${html}</li>`;
}

function barHtml(view) {
  const bar = view.bar;
  if (!bar) return '';
  const hero = view.heroes.find((h) => h.id === bar.unitId);
  // A group, not a toolbar: the arrows move the tile cursor, and Tab moves between the buttons.
  let html = `<div class="planner-bar" role="group" aria-label="${esc(`Actions for ${hero?.name || ''}, slot ${bar.slot + 1}`)}">`;
  for (const o of bar.options) {
    html += btn('planner-option', `<kbd aria-hidden="true">${esc(o.key)}</kbd> ${esc(o.words)}${o.cost > 1 ? ` <span class="cost">${o.cost}</span>` : ''}`, {
      cls: 'px-btn small bar-option', focus: `planner-option-${o.index}`, data: { index: o.index, key: o.key }, disabled: o.disabled,
      aria: `${o.words}${o.cost !== 1 ? `, ${o.cost} actions` : ''}${o.why ? `, ${lower(o.why)}` : ''}`, title: o.why,
    });
  }
  if (bar.more) html += btn('planner-more', `<kbd aria-hidden="true">0</kbd> More`, { cls: 'px-btn small bar-more', focus: 'planner-more', aria: `More actions, page ${bar.page + 1} of ${bar.pages}` });
  html += '</div>';
  if (view.pick) {
    // The pick's own Confirm takes the focus while it's open, so Enter confirms it natively (§12.1).
    html += `<div class="planner-pick-row"><p class="planner-pick" role="status">${esc(view.pick.words)}${view.pick.at ? `: ${esc(view.pick.at)}` : ''}.`
      + `${view.pick.trouble ? ` <span class="pick-trouble">${esc(view.pick.trouble)}</span>` : ''} <span class="hint">${esc(view.pick.hint)}</span></p>`
      + btn('planner-confirm', 'Confirm', { cls: 'px-btn small primary', focus: 'planner-confirm', aria: `Confirm ${view.pick.words}${view.pick.at ? `: ${view.pick.at}` : ''}` })
      + btn('planner-back', 'Back', { cls: 'link-btn', focus: 'planner-back', aria: 'Back out of this pick' })
      + '</div>';
  }
  return html;
}

/** The odds line: bars (or words) for each target, the edge's parts and "could change". */
export function oddsHtml(odds) {
  if (!odds || !odds.rows.length) return '';
  let html = `<div class="planner-odds" role="note" data-style="${esc(odds.style)}" aria-label="${esc(`Odds for ${odds.words}`)}">`;
  for (const row of odds.rows) {
    html += '<div class="odds-row">';
    html += `<p class="odds-title">${esc(odds.words)}${row.name && !odds.words.includes(row.name) ? ` on ${esc(row.name)}` : ''} · ${esc(row.title)}</p>`;
    if (odds.style === 'words') {
      html += `<p class="odds-words">${esc(row.text)}</p>`;
    } else {
      html += '<ol class="odds-bars">';
      DEGREES.forEach((d, i) => {
        const amount = row.odds.amounts && i < 3 ? ` ${row.odds.amounts[i]}${row.odds.known ? '' : '?'}` : '';
        html += `<li class="odds-bar" data-degree="${d}" style="--pct:${pct(row.odds.bars[i])}"><span>${DEGREE_WORDS[d]} ${clampInt(row.odds.bars[i], 0, 100)}%${esc(amount)}</span></li>`;
      });
      html += '</ol>';
      html += `<p class="sr-only">${esc(row.text)}</p>`;
    }
    if (row.parts.length) html += `<p class="odds-parts">${esc(row.parts.join(', '))}</p>`;
    if (row.change) html += `<p class="odds-change">${esc(row.change)}</p>`;
    html += '</div>';
  }
  return `${html}</div>`;
}

function whyHtml(why) {
  if (!why) return '';
  const heading = `Why ${nameMid(why.name)} drafted this`;
  const lines = why.lines.length ? why.lines.map((l) => `<li data-layer="${esc(l.layer)}"><span class="why-slot">${esc(l.label)}</span> ${esc(l.text)}</li>`).join('')
    : '<li>Nothing in the notebook yet. This is their instinct.</li>';
  return `<div class="planner-why popover px" role="dialog" aria-label="${esc(heading)}"><p class="popover-title">${esc(heading)}, ${why.confidence}% sure</p>`
    + `<ol class="why-lines">${lines}</ol>${btn('planner-close', 'Close', { focus: 'planner-why-close' })}</div>`;
}

const nameMid = (name) => String(name || '').replace(/^The /, 'the ');

/** The Playbook popover: a companion's standing rules as if/then selects, between rounds. */
export function playbookHtml(pb) {
  if (!pb) return '';
  const title = `${pb.name}’s playbook`;
  let html = `<div class="planner-playbook popover px" role="dialog" aria-label="${esc(title)}"><p class="popover-title">${esc(title)}</p>`;
  html += `<p class="popover-note">Standing rules always win over habits. Room for ${pb.max}.</p>`;
  if (!pb.ready) {
    html += '<p class="popover-note">The playbook opens once their notebook is ready.</p>';
  } else {
    html += '<ol class="playbook-rules">';
    pb.rules.forEach((r) => {
      const sel = (kind, list, value) => `<select class="px-select" data-action="planner-rule" data-unit="${esc(pb.unitId)}" data-index="${r.index}" data-part="${kind}"`
        + ` data-focus-key="${fkey('planner-rule', pb.unitId, r.index, kind)}" aria-label="${esc(kind === 'if' ? `Rule ${r.index + 1}: if` : `Rule ${r.index + 1}: then`)}"${pb.canEdit ? '' : ' disabled'}>`
        + list.map((o) => `<option value="${esc(o.id)}"${o.id === value ? ' selected' : ''}>${esc(o.words)}</option>`).join('') + '</select>';
      html += `<li class="playbook-rule"><span>If</span>${sel('if', pb.ifs, r.if)}<span>then</span>${sel('then', pb.thens, r.then)}`;
      if (pb.canEdit) html += btn('planner-rule-remove', 'Remove', { cls: 'link-btn', focus: `planner-rule-remove-${pb.unitId}-${r.index}`, data: { unit: pb.unitId, index: r.index } });
      html += '</li>';
    });
    html += '</ol>';
    if (!pb.rules.length) html += '<p class="popover-note">No rules yet. They play from their notebook.</p>';
    if (pb.canEdit && pb.room) html += btn('planner-rule-add', 'Add a rule', { focus: `planner-rule-add-${pb.unitId}`, data: { unit: pb.unitId } });
    else if (!pb.room) html += '<p class="popover-note">That’s all the room they have. Warding opens more.</p>';
  }
  return `${html}${btn('planner-close', 'Close', { focus: 'planner-rules-close' })}</div>`;
}

/** The keys, from the table (the ? key). */
function keysHtml() {
  const rows = KEY_HELP.map(([k, words]) => `<li><kbd>${esc(k)}</kbd> ${esc(words)}</li>`).join('');
  return `<div class="planner-keys popover px" role="dialog" aria-label="Keys"><p class="popover-title">Keys</p><ul class="key-list">${rows}</ul>`
    + `${btn('planner-close', 'Close', { focus: 'planner-keys-close' })}</div>`;
}

function footHtml(view) {
  let html = '<div class="planner-foot">';
  html += `<p class="noise-banner"${view.noise ? '' : ' hidden'} data-cell="planner.noise">${esc(view.noise?.words || '')}</p>`;
  html += `<span class="cheers" data-cell="planner.cheers" aria-label="${esc(`${view.cheers.left} of ${view.cheers.held} Cheers left`)}">Cheers ${'✦'.repeat(view.cheers.left)}${'✧'.repeat(view.cheers.used)}</span>`;
  html += `<div class="playback" role="group" aria-label="Playback speed">${[1, 2, 4].map((s) => btn('planner-playback', `${s}×`, {
    cls: 'px-btn small', focus: `planner-playback-${s}`, data: { speed: s }, pressed: view.playback === s,
  })).join('')}</div>`;
  html += btn('planner-odds-style', view.style === 'words' ? 'Odds as bars' : 'Odds as words', { cls: 'link-btn', focus: 'planner-odds-style' });
  if (view.canUndo) html += btn('planner-undo', 'Undo', { focus: 'planner-undo' });
  if (view.phase === 'planning' && !view.handed) html += btn('planner-accept-all', 'Accept all', { focus: 'planner-accept-all' });
  if (view.easing) html += btn('planner-ease', 'Ease to Storybook', { cls: 'link-btn', focus: 'planner-ease', title: EASE_WORDS });
  if (view.canWrap) html += btn('planner-wrap', 'Wrap it up', { focus: 'planner-wrap' });
  if (view.phase === 'running' || view.phase === 'asking') html += btn('planner-pause', view.paused ? 'Resume' : 'Pause', { focus: 'planner-pause', pressed: view.paused });
  if (view.handed) html += btn('planner-take-back', 'Take them back', { cls: 'px-btn primary', focus: 'planner-take-back' });
  else if (view.phase === 'planning') html += btn('planner-hand-over', 'Let them handle it', { cls: 'link-btn', focus: 'planner-hand-over' });
  html += btn('planner-keys', 'Keys', { cls: 'link-btn', focus: 'planner-keys', aria: 'Show the keys' });
  if (view.canRun) html += btn('planner-run', 'Run ▸', { cls: 'px-btn primary run-btn', focus: 'planner-run' });
  return `${html}</div>`;
}

/**
 * The planner's HTML (§12.4). Deterministic: the same view gives the same string. The HUD draws
 * the odds in a region of their own (`odds: false`), so hovering a slot never redraws the slots.
 */
export function buildPlanner(view, { odds = true } = {}) {
  let html = `<section class="planner px" data-region="planner" data-phase="${esc(view.phase)}" aria-label="Round planner">`;
  html += `<h2 class="planner-title" data-cell="planner.title">${esc(view.title)}</h2>`;
  html += `<ol class="planner-heroes">${view.heroes.map(heroHtml).join('')}</ol>`;
  html += barHtml(view);
  if (odds) html += oddsHtml(view.odds);
  html += whyHtml(view.why);
  html += playbookHtml(view.playbook);
  if (view.keys) html += keysHtml();
  html += footHtml(view);
  return `${html}</section>`;
}

// ---------------------------------------------------------------------------
// The keyboard, as a table (§12.1; COMBAT §13 with §17.22's change: [ and ] cycle, never Tab)

export const COMBAT_KEYS = Object.freeze([
  Object.freeze({ key: '[', command: Object.freeze({ t: 'cycle', dir: -1 }), words: 'Previous target or slot' }),
  Object.freeze({ key: ']', command: Object.freeze({ t: 'cycle', dir: 1 }), words: 'Next target or slot' }),
  Object.freeze({ key: 'ArrowUp', command: Object.freeze({ t: 'cursor', dx: 0, dy: -1 }), words: 'Move the tile cursor' }),
  Object.freeze({ key: 'ArrowDown', command: Object.freeze({ t: 'cursor', dx: 0, dy: 1 }), words: 'Move the tile cursor' }),
  Object.freeze({ key: 'ArrowLeft', command: Object.freeze({ t: 'cursor', dx: -1, dy: 0 }), words: 'Move the tile cursor' }),
  Object.freeze({ key: 'ArrowRight', command: Object.freeze({ t: 'cursor', dx: 1, dy: 0 }), words: 'Move the tile cursor' }),
  Object.freeze({ key: 'Enter', shift: true, command: Object.freeze({ t: 'accept-all' }), words: 'Accept every draft' }),
  Object.freeze({ key: 'Enter', command: Object.freeze({ t: 'confirm' }), words: 'Confirm, or accept the selected draft' }),
  Object.freeze({ key: 'Escape', command: Object.freeze({ t: 'back' }), words: 'Go back' }),
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => Object.freeze({ key: k, command: Object.freeze({ t: 'option', key: k }), words: 'Pick from the bar' })),
  Object.freeze({ key: 'm', command: Object.freeze({ t: 'move' }), words: 'Move' }),
  Object.freeze({ key: 'Backspace', command: Object.freeze({ t: 'clear' }), words: 'Clear the slot' }),
  Object.freeze({ key: 'y', command: Object.freeze({ t: 'why' }), words: 'Show why' }),
  Object.freeze({ key: ' ', command: Object.freeze({ t: 'run' }), words: 'Run the round, or take the company back' }),
  Object.freeze({ key: 'p', command: Object.freeze({ t: 'pause' }), words: 'Pause' }),
  Object.freeze({ key: 'g', command: Object.freeze({ t: 'guided' }), words: 'Guided on or off' }),
  Object.freeze({ key: 'w', command: Object.freeze({ t: 'wrap' }), words: 'Wrap it up, when offered' }),
  Object.freeze({ key: 'a', command: Object.freeze({ t: 'hand-over' }), words: 'Let them handle it' }),
  Object.freeze({ key: '?', command: Object.freeze({ t: 'keys' }), words: 'Show the keys' }),
]);

const KEY_HELP = Object.freeze([
  ['[ ]', 'Cycle targets and slots'], ['Arrows', 'Move the tile cursor'], ['Enter', 'Confirm, or accept the selected draft'],
  ['Shift+Enter', 'Accept every draft'], ['Esc', 'Go back'], ['1–9, 0', 'Pick from the bar'], ['M', 'Move'], ['Backspace', 'Clear the slot'],
  ['Y', 'Show why'], ['Space', 'Run, or take the company back'], ['P', 'Pause'], ['G', 'Guided on or off'], ['W', 'Wrap it up, when offered'],
  ['A', 'Let them handle it'], ['?', 'Show the keys'],
]);

const CONTROL_TAGS = Object.freeze(['BUTTON', 'SELECT', 'A', 'SUMMARY']);
const CONTROL_ROLES = Object.freeze(['button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'checkbox', 'radio', 'switch', 'link']);
const SELECT_KEYS = Object.freeze(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * What a keydown's target is, for combatKey: `typing` (an input, a textarea or contenteditable),
 * `control` (a focused button, select, link or [role=button|menuitem|…], anywhere in the window:
 * Enter and Space are its own) and `select` (a select, whose letters and arrows are its own too).
 */
export function keyTarget(target) {
  const tag = typeof target?.tagName === 'string' ? target.tagName.toUpperCase() : '';
  const role = typeof target?.getAttribute === 'function' ? String(target.getAttribute('role') || '').toLowerCase() : '';
  return {
    typing: tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true,
    control: CONTROL_TAGS.includes(tag) || CONTROL_ROLES.includes(role),
    select: tag === 'SELECT' || role === 'listbox' || role === 'combobox',
  };
}

/**
 * The command for a keydown, or null to leave the key alone. Never Tab; nothing while typing or
 * with Ctrl, Alt or Meta held; Enter and Space stay with a focused control (`control`, see
 * keyTarget), so they activate it natively, though Shift+Enter still accepts every draft; a focused
 * select (`select`) keeps its letters, digits, arrows, Enter and Space.
 */
export function combatKey(event, { typing = false, control = false, select = false } = {}) {
  if (!event || typing || event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = typeof event.key === 'string' ? event.key : '';
  if (key === 'Tab') return null;
  // Shift+Enter (accept every draft) is no button's own, so it works with one focused; a select keeps it.
  const acceptAll = key === 'Enter' && !!event.shiftKey && !select;
  if ((control || select) && !acceptAll && (key === 'Enter' || key === ' ' || key === 'Spacebar')) return null;
  if (select && (key.length === 1 || SELECT_KEYS.includes(key))) return null;
  const k = key.length === 1 && key !== ' ' ? key.toLowerCase() : key;
  const shift = !!event.shiftKey;
  const row = COMBAT_KEYS.find((r) => r.key === k && (r.shift ? shift : !(shift && r.key === 'Enter')))
    || (key === 'Spacebar' ? COMBAT_KEYS.find((r) => r.key === ' ') : null);
  return row ? { ...row.command } : null;
}

// ---------------------------------------------------------------------------
// The reducer: a click or a key → the next ui and the fight's intents

const emptyPlan = (unitId) => ({ unitId, slots: [], reactions: {}, by: 'you', changed: [] });

function nextPlan(battle, roundView, unit, slots, reactions = null) {
  const draft = roundView?.drafts?.[unit.id] || null;
  const base = currentPlan(battle, roundView, unit.id);
  const fromDraft = !!draft && unit.control !== 'mine';
  return {
    unitId: unit.id,
    slots,
    reactions: reactions || { ...(base.reactions || {}) },
    by: fromDraft ? 'draft' : 'you',
    changed: slots.map((a, i) => (fromDraft ? !sameAction(a, draft.plan?.slots?.[i]) : false)),
  };
}

function withHistory(ui, battle, unitId) {
  const before = battle.plans?.[unitId] || null;
  const history = [...(Array.isArray(ui.history) ? ui.history : []), { unitId, before }].slice(-60);
  return { ...ui, history };
}

function setIntent(ui, battle, roundView, unit, slots, reactions = null) {
  const plan = nextPlan(battle, roundView, unit, slots, reactions);
  return { ui: withHistory(ui, battle, unit.id), intent: { t: 'plan', unitId: unit.id, plan } };
}

/** The action a confirmed pick makes, or null (with words saying why). */
function pickedAction(battle, roundView, unit, option, ui, ctx) {
  if (option.targets === 'tile' || option.targets === 'path') {
    const at = ui.cursor;
    if (!at) return { action: null, say: 'Pick a tile first.' };
    const aim = tileAim(battle, roundView, unit.id, option, ui.slot || 0, ctx);
    const r = aim ? aim.aim({ x: at.x, y: at.y }) : { target: null, say: 'There’s no way there.' };
    return r.target ? { action: { ...option.action, target: r.target } } : { action: null, say: r.say };
  }
  if (Array.isArray(option.targets)) {
    const t = option.targets[clampInt(ui.pick?.target, 0, Math.max(0, option.targets.length - 1))];
    if (!t) return { action: null, say: 'Nothing to aim at.' };
    return { action: { ...option.action, target: t } };
  }
  return { action: { ...option.action, target: null } };
}

// The plan Accept takes: the draft's (by 'draft'), or a ghosted suggestion's, written as yours.
function takenPlan(battle, roundView, unit) {
  const draft = roundView?.drafts?.[unit.id] || null;
  const source = draft || ghostOf(battle, roundView, unit.id);
  if (!source?.plan) return null;
  const slots = source.plan.slots.map((a) => ({ ...a }));
  return { unitId: unit.id, slots, reactions: { ...(source.plan.reactions || {}) }, by: draft ? 'draft' : 'you', changed: slots.map(() => false) };
}

function unitStart(battle, roundView, unit, ui, ctx) {
  const plan = currentPlan(battle, roundView, unit.id);
  const b = projected(battle, unit.id, plan, ui.slot || 0, ctx);
  const u = unitIn(b, unit.id);
  return u ? { x: u.x, y: u.y } : { x: unit.x, y: unit.y };
}

// An action set in a later, empty slot keeps that slot's tick (openTick): the empty slots before it
// wait (a Delay each). Only slots a tick is left for are shown (slotCount), so it always fits.
function placeInSlot(env, ui, unit, action) {
  const { battle, roundView } = env;
  const plan = currentPlan(battle, roundView, unit.id);
  const slots = plan.slots.slice();
  const i = clampInt(ui.slot, 0, slotCount(unit, plan) - 1);
  const held = Math.max(0, i - slots.length);
  while (slots.length < i) slots.push({ ...DELAY });
  slots[i] = action;
  const r = setIntent(ui, battle, roundView, unit, slots);
  const next = { ...r.ui, pick: null, cursor: null, page: 0, slot: Math.min(i + 1, slotCount(unit, { slots }) - 1) };
  const first = i - held + 1;
  const waits = held === 1 ? `, after a Delay in slot ${i}` : held === 2 ? `, after a Delay in slots ${first} and ${i}` : held > 2 ? `, after a Delay in slots ${first} to ${i}` : '';
  return { ui: next, intents: [r.intent], handled: true, say: `${upper(actionWords(veiled(battle), unit.id, action, env.ctx))} in slot ${i + 1}${waits}.` };
}

const result = (ui, intents = [], handled = true, say = null) => ({ ui, intents, handled, say });

/**
 * One planner command (a click, a key's command, or the engine's pointer as { t: 'pointer', kind,
 * tile, unitId }) → { ui, intents, handled, say }. `env` = { battle, roundView, ctx }. Intents the
 * fight acts on: { t: 'plan', unitId, plan }, { t: 'cheer', unitId, slot, on }, { t: 'run' },
 * { t: 'answer', yes }, { t: 'pause' }, { t: 'wrap' }, { t: 'hand-over' }, { t: 'take-back' },
 * { t: 'guided' }, { t: 'playback', speed }, { t: 'mode', mode: 'storybook' }, { t: 'rules', unitId,
 * rules }, { t: 'odds', style }. `handled` false leaves the key to the
 * next handler (Escape with nothing to back out of).
 */
export function plannerReduce(ui0, command, env) {
  const ui = { selected: null, slot: null, cursor: null, hover: null, popover: null, odds: 'bars', playback: 1, page: 0, pick: null, history: [], ...(ui0 || {}) };
  const { battle, roundView, ctx } = env || {};
  if (!command || !battle) return result(ui, [], false);
  const planning = isPlanning(battle);
  const heroes = heroesOf(battle).filter((u) => standing(u));
  const unit = ui.selected ? unitIn(battle, ui.selected) : null;
  const canEdit = unit ? editable(battle, unit, ui) : false;
  // Only a slot that's shown (one a tick is left for) takes an action.
  const shown = () => unit && canEdit && Number.isInteger(ui.slot) && ui.slot < slotCount(unit, currentPlan(battle, roundView, unit.id));
  const options = () => (shown() ? barOptions(battle, roundView, unit.id, ui.slot, ctx) : []);
  switch (command.t) {
    case 'select': {
      const u = unitIn(battle, command.unitId);
      if (!u) return result(ui, [], false);
      if (ui.pick && !command.hero) return plannerReduce(ui, { t: 'pointer', kind: 'unit', unitId: u.id }, env);
      if (u.side !== 'party' || u.rank !== 'hero') return result({ ...ui, hover: u.id }, [], true, null);
      const plan = currentPlan(battle, roundView, u.id);
      const firstEmpty = plan.slots.length < slotCount(u, plan) ? plan.slots.length : 0;
      return result({ ...ui, selected: u.id, slot: editable(battle, u, ui) ? firstEmpty : null, pick: null, cursor: null, page: 0 }, [], true,
        roundView?.drafts?.[u.id] ? draftReadout(roundView.drafts[u.id], veiled(battle), ctx) : `${u.name} selected.`);
    }
    case 'slot': {
      const u = unitIn(battle, command.unitId);
      if (!u || u.side !== 'party') return result(ui, [], false);
      return result({ ...ui, selected: u.id, slot: clampInt(command.slot, 0, slotCount(u, currentPlan(battle, roundView, u.id)) - 1), pick: null, cursor: null, page: 0 });
    }
    case 'hover':
      return result({ ...ui, hover: command.slot !== undefined && command.unitId ? `slot:${command.unitId}:${command.slot}` : command.unitId || null });
    case 'option': {
      if (!planning || !shown()) return result(ui, [], false);
      const list = options();
      const bar = barView(list, ui.page || 0);
      let entry = null;
      if (command.key !== undefined) {
        if (bar.more && String(command.key) === '0') return result({ ...ui, page: (bar.page + 1) % bar.pages });
        entry = bar.options.find((o) => o.key === String(command.key));
      } else if (Number.isInteger(command.index)) {
        entry = list.find((o) => o.index === command.index);
      }
      const option = entry ? list.find((o) => o.index === entry.index) : null;
      if (!option) return result(ui, [], true);
      if (option.why) return result(ui, [], true, `${option.words}: ${lower(option.why)}.`);
      if (option.targets === 'tile' || option.targets === 'path') {
        return result({ ...ui, pick: { option: option.index, target: 0 }, cursor: unitStart(battle, roundView, unit, ui, ctx) }, [], true, `${option.words}: pick a tile.`);
      }
      if (Array.isArray(option.targets) && option.targets.length > 1) {
        return result({ ...ui, pick: { option: option.index, target: 0 } }, [], true, `${option.words}: ${targetWords(battle, unit.id, option, option.targets[0])}?`);
      }
      const { action, say } = pickedAction(battle, roundView, unit, option, { ...ui, pick: { option: option.index, target: 0 } }, ctx);
      return action ? placeInSlot(env, ui, unit, action) : result(ui, [], true, say);
    }
    case 'more':
      return result({ ...ui, page: (ui.page || 0) + 1 >= barView(options(), ui.page || 0).pages ? 0 : (ui.page || 0) + 1 });
    case 'cycle': {
      if (ui.pick) {
        const option = options().find((o) => o.index === ui.pick.option);
        const n = Array.isArray(option?.targets) ? option.targets.length : 0;
        if (!n) return result(ui);
        const target = ((ui.pick.target || 0) + (command.dir < 0 ? -1 : 1) + n) % n;
        return result({ ...ui, pick: { ...ui.pick, target } }, [], true, targetWords(battle, unit.id, option, option.targets[target]));
      }
      // Slots of the selected hero, then on to the next hero's.
      const order = [];
      for (const h of heroes) {
        const n = slotCount(h, currentPlan(battle, roundView, h.id));
        for (let s = 0; s < n; s += 1) order.push([h.id, s]);
      }
      if (!order.length) return result(ui);
      const at = order.findIndex(([hid, s]) => hid === ui.selected && s === ui.slot);
      const next = order[(at + (command.dir < 0 ? -1 : 1) + order.length) % order.length] || order[0];
      return result({ ...ui, selected: next[0], slot: next[1], pick: null, cursor: null, page: 0 });
    }
    case 'cursor': {
      const base = ui.cursor || (unit ? unitStart(battle, roundView, unit, ui, ctx) : null);
      if (!base) return result(ui, [], false);
      const rect = battle.arena?.rect || { x: 0, y: 0, w: 1, h: 1 };
      const x = clampInt(base.x + (command.dx || 0), rect.x, rect.x + rect.w - 1);
      const y = clampInt(base.y + (command.dy || 0), rect.y, rect.y + rect.h - 1);
      return result({ ...ui, cursor: { x, y } }, [], true, tileName(battle, { x, y }));
    }
    case 'pointer': {
      if (ui.pick && unit) {
        const option = options().find((o) => o.index === ui.pick.option);
        if (!option) return result({ ...ui, pick: null });
        if (command.kind === 'tile' && command.tile && (option.targets === 'tile' || option.targets === 'path')) {
          return plannerReduce({ ...ui, cursor: { x: command.tile.x, y: command.tile.y } }, { t: 'confirm' }, env);
        }
        if (command.unitId && Array.isArray(option.targets)) {
          const i = option.targets.findIndex((t) => t.unit === command.unitId || t.units?.includes(command.unitId));
          if (i >= 0) return plannerReduce({ ...ui, pick: { ...ui.pick, target: i } }, { t: 'confirm' }, env);
          const other = unitIn(battle, command.unitId);
          if (other?.side === 'party' && other.rank === 'hero') return plannerReduce({ ...ui, pick: null, cursor: null }, { t: 'select', unitId: other.id, hero: true }, env);
          return result(ui, [], true, `${nameOf(veiled(battle), command.unitId)} can’t be picked for that.`);
        }
        return result(ui);
      }
      if (command.unitId) {
        const u = unitIn(battle, command.unitId);
        if (u?.side === 'party' && u.rank === 'hero') return plannerReduce(ui, { t: 'select', unitId: u.id }, env);
        // A foe clicked with a slot in hand: Strike it when that's legal.
        if (u && canEdit && Number.isInteger(ui.slot)) {
          const strike = options().find((o) => !o.why && o.action.id === 'strike' && Array.isArray(o.targets) && o.targets.some((t) => t.unit === u.id));
          if (strike) return placeInSlot(env, ui, unit, { ...strike.action, target: { unit: u.id } });
        }
        return result({ ...ui, hover: command.unitId });
      }
      if (command.tile) return result({ ...ui, cursor: { x: command.tile.x, y: command.tile.y } });
      return result(ui, [], false);
    }
    case 'confirm': {
      if (ui.pick && unit) {
        const option = options().find((o) => o.index === ui.pick.option);
        if (!option) return result({ ...ui, pick: null });
        const { action, say } = pickedAction(battle, roundView, unit, option, ui, ctx);
        return action ? placeInSlot(env, ui, unit, action) : result(ui, [], true, say);
      }
      if (unit && canEdit && (roundView?.drafts?.[unit.id] || ghostOf(battle, roundView, unit.id))) return plannerReduce(ui, { t: 'accept', unitId: unit.id }, env);
      return result(ui, [], false);
    }
    case 'accept': {
      const u = unitIn(battle, command.unitId);
      if (!u || !editable(battle, u, ui)) return result(ui, [], false);
      const plan = takenPlan(battle, roundView, u);
      if (!plan) return result(ui, [], false);
      return result({ ...withHistory(ui, battle, u.id), pick: null }, [{ t: 'plan', unitId: u.id, plan }], true, plan.by === 'draft' ? `${u.name}’s draft accepted.` : `${u.name} takes the suggestion.`);
    }
    case 'accept-all': {
      if (!planning) return result(ui, [], false);
      let next = ui;
      const intents = [];
      for (const u of heroes) {
        const plan = editable(battle, u, ui) ? takenPlan(battle, roundView, u) : null;
        if (!plan) continue;
        next = withHistory(next, battle, u.id);
        intents.push({ t: 'plan', unitId: u.id, plan });
      }
      return result({ ...next, pick: null }, intents, true, intents.length ? 'Every draft accepted.' : null);
    }
    case 'clear': {
      if (!unit || !canEdit || !Number.isInteger(ui.slot)) return result(ui, [], false);
      const plan = currentPlan(battle, roundView, unit.id);
      if (ui.slot >= plan.slots.length) return result(ui);
      // A plan has no gaps (battle.js drops them), so a cleared slot with actions after it waits (a
      // Delay): the rest keep their ticks, and the hero really does wait there. Waits left at the end go.
      const slots = plan.slots.map((a, i) => (i === ui.slot ? { ...DELAY } : a));
      while (slots.length && slots[slots.length - 1]?.id === 'delay') slots.pop();
      const r = setIntent(ui, battle, roundView, unit, slots);
      const waits = slots[ui.slot]?.id === 'delay' ? ` ${nameOf(battle, unit.id)} waits a tick there, so the rest keep their ticks.` : '';
      return result({ ...r.ui, pick: null }, [r.intent], true, `Slot ${ui.slot + 1} cleared.${waits}`);
    }
    case 'move': {
      if (!unit || !canEdit || !Number.isInteger(ui.slot)) return result(ui, [], false);
      const stride = options().find((o) => o.action.id === 'stride');
      if (!stride) return result(ui);
      return plannerReduce(ui, { t: 'option', index: stride.index }, env);
    }
    case 'cheer': {
      const u = unitIn(battle, command.unitId);
      if (!u || !editable(battle, u, ui)) return result(ui, [], false);
      const plan = currentPlan(battle, roundView, u.id);
      const slot = clampInt(command.slot, 0, 3);
      const action = plan.slots[slot];
      if (!action) return result(ui);
      const on = command.on === undefined ? !action.cheer : !!command.on;
      if (on) {
        const used = heroesOf(battle).reduce((n, h) => n + currentPlan(battle, roundView, h.id).slots.filter((a) => a?.cheer).length, 0);
        if (used >= (battle.cheers || 0)) return result(ui, [], true, 'No Cheers left to spend.');
      }
      if (battle.plans?.[u.id]) return result(ui, [{ t: 'cheer', unitId: u.id, slot, on }], true, on ? 'Cheer spent: at least a Hit.' : 'Cheer back.');
      const slots = plan.slots.map((a, i) => (i === slot ? { ...a, cheer: on } : a));
      const r = setIntent(ui, battle, roundView, u, slots);
      return result(r.ui, [r.intent], true, on ? 'Cheer spent: at least a Hit.' : 'Cheer back.');
    }
    case 'reaction': {
      const u = unitIn(battle, command.unitId);
      if (!u || !editable(battle, u, ui) || !REACTION_SETTINGS.includes(command.setting)) return result(ui, [], false);
      const plan = currentPlan(battle, roundView, u.id);
      const reactions = { ...(plan.reactions || {}), [command.reactionId]: command.setting };
      const r = setIntent(ui, battle, roundView, u, plan.slots.map((a) => ({ ...a })), reactions);
      return result(r.ui, [r.intent], true, `${reactionsOf(battle, u, plan, ctx).find((x) => x.id === command.reactionId)?.name || 'Reaction'}: ${SETTING_WORDS[command.setting]}.`);
    }
    case 'undo': {
      const history = Array.isArray(ui.history) ? ui.history.slice() : [];
      const last = history.pop();
      if (!last || !planning) return result(ui, [], false);
      const u = unitIn(battle, last.unitId);
      const draft = roundView?.drafts?.[last.unitId];
      const plan = last.before || (draft ? { ...draft.plan, by: 'draft', changed: draft.plan.slots.map(() => false) } : emptyPlan(last.unitId));
      return result({ ...ui, history, pick: null }, u ? [{ t: 'plan', unitId: u.id, plan }] : [], true, 'Undone.');
    }
    case 'back': {
      if (ui.pick) return result({ ...ui, pick: null, cursor: null });
      if (ui.popover) return result({ ...ui, popover: null });
      if (Number.isInteger(ui.slot)) return result({ ...ui, slot: null, page: 0 });
      if (ui.selected || ui.hover) return result({ ...ui, selected: null, hover: null });
      return result(ui, [], false);
    }
    case 'why': {
      const target = command.unitId || ui.selected;
      if (!target) return result(ui, [], false);
      return result({ ...ui, selected: target, popover: ui.popover === 'why' && ui.selected === target ? null : 'why' });
    }
    case 'rules': {
      const target = command.unitId || ui.selected;
      if (!target) return result(ui, [], false);
      return result({ ...ui, selected: target, popover: ui.popover === 'rules' && ui.selected === target ? null : 'rules' });
    }
    case 'keys':
      return result({ ...ui, popover: ui.popover === 'keys' ? null : 'keys' });
    case 'close':
      return result({ ...ui, popover: null });
    case 'odds-style': {
      const style = ui.odds === 'words' ? 'bars' : 'words';
      return result({ ...ui, odds: style }, [{ t: 'odds', style }]);
    }
    case 'playback': {
      const speed = [1, 2, 4].includes(Number(command.speed)) ? Number(command.speed) : 1;
      return result({ ...ui, playback: speed }, [{ t: 'playback', speed }]);
    }
    case 'run':
      if (ui.handed) return result({ ...ui, handed: false }, [{ t: 'take-back' }], true, 'The company is yours again.');
      if (!planning) return result(ui, [], false);
      return result({ ...ui, pick: null, popover: null, slot: null, history: [] }, [{ t: 'run' }], true, 'Running the round.');
    case 'take-back':
      return result({ ...ui, handed: false }, [{ t: 'take-back' }]);
    case 'hand-over':
      return result({ ...ui, handed: true, pick: null, slot: null, popover: null }, [{ t: 'hand-over' }], true, 'They’ll handle it. Space takes them back.');
    case 'pause':
      return result(ui, [{ t: 'pause' }]);
    case 'guided':
      return result(ui, [{ t: 'guided' }]);
    case 'wrap':
      if (!roundView?.canWrap) return result(ui, [], true, 'Not yet: there’s still a fight in them.');
      return result(ui, [{ t: 'wrap' }], true, 'Wrapping it up.');
    case 'ease':
      return result(ui, [{ t: 'mode', mode: 'storybook' }], true, EASE_WORDS);
    case 'answer':
      return result(ui, [{ t: 'answer', yes: !!command.yes }]);
    case 'rule-set':
    case 'rule-add':
    case 'rule-remove': {
      const rules = Array.isArray(command.rules) ? command.rules : [];
      const next = rules.map((r) => ({ if: r.if, then: r.then }));
      if (command.t === 'rule-add' && command.rule) next.push({ if: command.rule.if, then: command.rule.then });
      if (command.t === 'rule-remove') next.splice(clampInt(command.index, 0, next.length), 1);
      if (command.t === 'rule-set' && next[command.index]) next[command.index] = { ...next[command.index], [command.part === 'then' ? 'then' : 'if']: command.value };
      return result(ui, [{ t: 'rules', unitId: command.unitId, rules: next }]);
    }
    default:
      return result(ui, [], false);
  }
}

/**
 * The foes' telegraphs as the board may draw them (§18.3 item 5), matching the HUD's cards: none
 * from a foe that's Unseen or sorted; a hidden one keeps only its unit, slot, tick and icon (the
 * engine draws '?'), with no words, targets, tiles, eye or aside; a Void lie names its false target
 * until the foe is Examined. `threats` are the tiles of every visible area telegraph (a stomp is
 * one: icon 'area'), each once.
 */
export function foeIntents(battle) {
  const telegraphs = [];
  const threats = [];
  const seen = new Set();
  for (const t of battle?.telegraphs || []) {
    if (!inView(battle, t?.unitId)) continue;
    const u = unitIn(battle, t.unitId);
    if (t.hidden) {
      telegraphs.push({ unitId: t.unitId, slot: t.slot, tick: t.tick, icon: t.icon, words: '?', targets: [], tiles: [], hidden: true, falseTarget: null, adapting: null, aside: false });
      continue;
    }
    const lie = t.falseTarget && !u.examined ? t.falseTarget : null;
    const tiles = (t.tiles || []).map((p) => ({ x: p.x, y: p.y }));
    telegraphs.push({ ...t, targets: lie ? [lie] : [...(t.targets || [])], tiles, falseTarget: lie, adapting: t.adapting || null, aside: !!t.aside });
    if (t.icon !== 'area') continue;
    for (const p of tiles) {
      const k = `${p.x},${p.y}`;
      if (!seen.has(k)) { seen.add(k); threats.push(p); }
    }
  }
  return { telegraphs, threats };
}

/**
 * What the engine draws for the planner (§11.3's Overlay) while a round is planned: the foes'
 * telegraphs and the tiles their areas and stomps threaten (foeIntents, whoever is selected), then
 * for the selected hero the tiles a Stride can reach and the path to the cursor, the targets a pick
 * can take, and an area slot's tiles with who it catches. While the round runs (or waits on an Ask)
 * only the telegraphs and threats, so a stomp's tiles stay drawn until it lands (the board takes
 * B's newer `telegraphs` events over them). null when there's nothing to show, and once it's over.
 */
export function plannerOverlay(battle, roundView, ui = {}, ctx = {}) {
  if (!battle) return null;
  const intents = foeIntents(battle);
  if (battle.status === 'running' || battle.status === 'asking') return intents.telegraphs.length ? intents : null;
  if (!isPlanning(battle)) return null;
  const unit = ui.selected ? unitIn(battle, ui.selected) : null;
  if (!unit) return intents.telegraphs.length ? intents : null;
  const overlay = { selected: unit.id, ...intents };
  const plan = currentPlan(battle, roundView, unit.id);
  if (ui.pick && Number.isInteger(ui.slot)) {
    const option = barOptions(battle, roundView, unit.id, ui.slot, ctx).find((o) => o.index === ui.pick.option);
    const aim = option && (option.targets === 'path' || option.targets === 'tile') ? tileAim(battle, roundView, unit.id, option, ui.slot, ctx) : null;
    if (aim && option.targets === 'path') {
      // The same reach the pick checks (tileAim): the Stride's speed, difficult ground as the kernel counts it.
      const { grid, budget, ignoreDifficult } = aim;
      const reach = grid.reachable(unit.id, { budget, ignoreDifficult });
      reach.delete(`${aim.unit.x},${aim.unit.y}`); // a Stride back to where it stands isn't one
      overlay.reachable = [...reach.keys()].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
      if (ui.cursor) {
        overlay.cursor = { x: ui.cursor.x, y: ui.cursor.y };
        const hit = reach.get(`${ui.cursor.x},${ui.cursor.y}`);
        const path = hit ? grid.path(unit.id, ui.cursor, { budget, ignoreDifficult }) : null;
        if (path && hit) {
          overlay.path = { tiles: path, cost: hit.cost, of: budget, swipes: (hit.swipes || []).map((sid) => { const v = unitIn(battle, sid); return v ? { x: v.x, y: v.y } : null; }).filter(Boolean) };
        }
      }
    } else if (aim) {
      // A Step, a Jump or an ability's tile: every tile in the arena the pick would take.
      const rect = battle.arena?.rect || { x: 0, y: 0, w: 0, h: 0 };
      const tiles = [];
      for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) if (aim.aim({ x, y }).target) tiles.push({ x, y });
      overlay.reachable = tiles;
      if (ui.cursor) overlay.cursor = { x: ui.cursor.x, y: ui.cursor.y };
    } else if (option && Array.isArray(option.targets)) {
      overlay.targets = [...new Set(option.targets.flatMap((t) => (t.unit ? [t.unit] : t.units || [])))];
    }
  }
  const action = Number.isInteger(ui.slot) ? plan.slots[ui.slot] : null;
  const area = action ? areaOf(projected(battle, unit.id, plan, ui.slot, ctx), unit.id, action, ctx) : null;
  if (area) overlay.areas = [{ tiles: area.tiles, kind: area.helpful ? 'help' : 'harm', caught: area.caught.map((c) => c.id) }];
  return overlay;
}

/** Nothing to mount on its own: combat-hud.js draws the planner inside #combat-hud (§12.3). */
export function mount() {
  return { dispose() {} };
}
