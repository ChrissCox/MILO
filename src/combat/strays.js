// Strays that read you (CONTRACT-PHASE4.md §4.15, §4.16, §6.6, §7.2; COMBAT.md §3.6, §8.3): the
// telegraphs the party sees (a Noir stray's hidden intents, a Void stray's false targets, the
// adapting eye), what a stray counters at its adaptation step, a Tale-lead's feints, and a genre's
// memory of your most-used habit across fights, and Maud's Table's focus fire and surface combos (§4.15).
// Pure; the only variety is seeded hashes.
import { hashInts, unit as unit01 } from '../world/rng.js';
import { adaptStep } from './rules.js';
import { unitIn, standing, effMode, plainTelegraphs, ticksOf, inHooklight, oddsAgainst, speedOf } from './round.js';
import { actionWords } from './describe.js';
import { unitDist, footprint } from './grid.js';
import { legalActions, abilityWhy } from './abilities.js';
import { strikePk } from './effects.js';
import { choiceInfo } from './notebook.js';
import { foesOf, bestAttack, weakestOf, gridFor, act, hurtsAt, abilityVariants, strikeAmount, ribbonIndex } from './ai.js';

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

// ---------------------------------------------------------------------------
// Adaptation (§4.15)

/** A foe's adaptation step now: by rank and level, the mode in play and the switch. */
export function stepOf(battle, u, ctx) {
  if (!u || u.side !== 'foe') return 0;
  const rank = ['lackey', 'stray', 'elite', 'lead'].includes(u.rank) ? u.rank : u.rank === 'device' ? null : 'stray';
  if (!rank) return 0;
  return adaptStep({ rank, level: u.level ?? 0, roomLevel: battle.level, roadLevel: battle.roadLevel },
    { mode: effMode(battle), adaptation: battle.calm?.adaptation !== false, rules: ctx?.rules });
}

// Counts in words from one to nine, figures from 10 (§18.3).
const TIMES = ['never', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times'];
const times = (n) => TIMES[n] || `${n} times`;
const GENRE_WORDS = { neon: 'Neon', nocturne: 'Nocturne', gothic: 'Gothic', iron: 'Iron', void: 'Void', noir: 'Noir', frontier: 'Frontier', kaiju: 'Titan' };

// The eye says "you’ve …", so a phrase's first word (notebook.js's past tense) becomes its past
// participle where the two differ: "you’ve gone for the Tale-lead", never "you’ve went".
const PARTICIPLES = {
  went: 'gone', took: 'taken', gave: 'given', drew: 'drawn', threw: 'thrown', ran: 'run', rode: 'ridden', broke: 'broken',
  spoke: 'spoken', saw: 'seen', hid: 'hidden', wrote: 'written', began: 'begun', did: 'done', came: 'come', chose: 'chosen',
  bit: 'bitten', drove: 'driven', fell: 'fallen', forgot: 'forgotten', rose: 'risen', shook: 'shaken', stole: 'stolen',
  woke: 'woken', swam: 'swum', flew: 'flown', knew: 'known', grew: 'grown', blew: 'blown', ate: 'eaten', froze: 'frozen', sang: 'sung',
};
/** A past-tense phrase read after "you’ve": 'went for the Tale-lead' → 'gone for the Tale-lead'. */
export const participle = (phrase) => String(phrase).replace(/^([a-z]+)/, (w) => PARTICIPLES[w] || w);

// What a counter looks like, by its kind (ai.js's activeCounters says where each bites). 'plain' is
// a habit nothing counters: it never changes a plan, so its eye never shows.
const COUNTER_WORDS = {
  spread: 'Spreading its hits',
  'keep-distance': 'Keeping its distance',
  uncovered: 'Going for whoever’s out of cover',
  'high-ground': 'Heading for the high ground',
  'before-brace': 'Striking before you brace',
  'spread-out': 'Keeping clear of its friends',
  'hold-back': 'Holding back a moment',
  'go-for-source': 'Going for whoever hinders it',
  plain: 'Watching you',
};

function phraseOf(habit) {
  const template = Number(String(habit).split(':')[0]);
  return participle(choiceInfo(template)?.phrase || 'done that');
}

/** The eye's words: 'Spreading its hits: you’ve patched the most hurt ally twice.' (≤ 100). */
export function counterWords(habit, count, { kind = null, genre = null, second = null } = {}) {
  const lead = COUNTER_WORDS[kind || counterKind(habit)] || COUNTER_WORDS.plain;
  const also = second ? ` and ${phraseOf(second)}` : '';
  if (genre) return clip(`${lead}: ${GENRE_WORDS[genre] || 'This genre'} remembers you’ve ${phraseOf(habit)}${also}.`, 100);
  return clip(`${lead}: you’ve ${phraseOf(habit)}${also} ${times(count)}.`, 100);
}

// Which counter a habit calls for, by its template id (notebook.js's CHOICES): it avoids the target
// the habit favours (spread: whoever you patch or guard; keep-distance: the most hurt stray, the
// nearest one you strike, or a ranged one you close on), the tile it uses (uncovered, high-ground,
// spread-out), or the opening (before-brace: it strikes those who act after it, before their Brace
// lands; hold-back: it braces first against heroes who go for whoever acts first, or for the
// Tale-lead); or it goes for the hero behind the habit (go-for-source: whoever has the ability that
// hinders it). The rest are plain: they aim at no stray, tile or opening a stray could avoid
// (stepping back or elsewhere, helping an ally, cooling down, examining, seeking, working the room,
// waiting, readying, sustaining, a special move), or any hero could have done them (a Shove, a
// talk-down), so there’s no one hero to go for.
const COUNTER_TEMPLATES = {
  spread: [2, 3, 20, 21, 22, 23, 24, 25, 26, 29],
  'keep-distance': [1, 11, 13],
  uncovered: [4],
  'high-ground': [5],
  'before-brace': [30],
  'spread-out': [14],
  'hold-back': [10, 12, 15, 16],
  'go-for-source': [17],
};
const KIND_OF = new Map(Object.entries(COUNTER_TEMPLATES).flatMap(([k, list]) => list.map((t) => [t, k])));
/** The counter a habit key calls for: spread, keep-distance, uncovered, high-ground, before-brace, spread-out, hold-back, go-for-source, or plain. */
export const counterKind = (habit) => KIND_OF.get(Number(String(habit || '').split(':')[0])) || 'plain';

/**
 * §4.15 (Decided): the habit a foe counters now, or null. Step 0 nothing; 1 the first habit seen
 * twice; 2 from round 2, the habit seen most, or the genre's memory when that's higher; 3 the
 * same from round 1; 4 the top two. → { habit, words, habits, step }
 */
export function counterFor(battle, unitId, ctx) {
  const u = unitIn(battle, unitId);
  if (!u || !standing(u) || u.side !== 'foe') return null;
  const step = stepOf(battle, u, ctx);
  if (step <= 0) return null;
  const seen = Object.entries(battle.seen || {});
  if (step === 1) {
    const first = seen.find(([, n]) => n >= 2);
    return first ? { habit: first[0], habits: [first[0]], step, words: counterWords(first[0], first[1]) } : null;
  }
  if (step === 2 && (battle.round || 1) < 2) return null;
  const ranked = seen.map(([k, n], i) => ({ k, n, i })).sort((a, b) => b.n - a.n || a.i - b.i);
  const top = ranked[0] || null;
  const memory = battle.memory && typeof battle.memory.habit === 'string' ? battle.memory : null;
  let first = top ? { habit: top.k, count: top.n, genre: null } : null;
  if (memory && (!first || memory.count > first.count)) first = { habit: memory.habit, count: memory.count, genre: battle.genres?.[0] || null };
  if (!first) return null;
  const habits = [first.habit];
  if (step >= 4) {
    const next = ranked.find((r) => r.k !== first.habit);
    if (next) habits.push(next.k);
  }
  const words = first.genre
    ? counterWords(first.habit, first.count, { genre: first.genre, second: habits[1] || null })
    : counterWords(first.habit, first.count, { second: habits[1] || null });
  return { habit: first.habit, habits, step, words };
}

// ---------------------------------------------------------------------------
// Telegraphs (§4.16: hidden and false intents; the adapting eye)

const hasGenre = (u, g) => (u.genres || []).includes(g);

/** A Noir stray's intents show "?" until a Seek (for the round), an Examine (for the fight) or the lantern's light reaches it. */
export function noirHidden(battle, u) {
  if (!hasGenre(u, 'noir') || !(battle.genres || []).length) return false;
  if (u.revealedUntil || u.examined) return false;
  return !inHooklight(battle, u);
}

/**
 * The heroes a planned action could legally be aimed at, from where `unitId` will stand when that
 * slot comes (B's legalActions at the slot: range, reach, sight and need, after the plan's earlier
 * moves). → Set of unit ids
 */
export function legalTargetsAt(battle, unitId, plan, slot, action, ctx) {
  const out = new Set();
  if (!action || !ctx) return out;
  let options;
  try {
    options = legalActions(battle, unitId, ctx, { slot, plan });
  } catch {
    return out;
  }
  const same = (x) => (x ?? null);
  for (const o of options) {
    const a = o.action;
    if (!a || a.id !== action.id || same(a.ability) !== same(action.ability) || same(a.choice) !== same(action.choice)) continue;
    if (a.id === 'use' && a.cost !== action.cost) continue;
    if (o.why || !Array.isArray(o.targets)) continue;
    for (const t of o.targets) {
      if (t?.unit) out.add(t.unit);
      for (const id of t?.units || []) out.add(id);
    }
  }
  return out;
}

/**
 * §4.16: the hero a Void stray's telegraph names instead of its real target, or null. The draw is
 * 1 in 3 (`void-false`), and it lies only when another hero is a legal target for the same action
 * from where it will stand. While the round runs, the lie told at planning holds (heroes moving never
 * change it, and no new lie starts) until an Examine ends it or its false target goes down. The
 * telegraph being replaced is found by its unit and slot alone, so B's restore can hand back just
 * `{ unitId, slot, adapting, falseTarget }` (§18.3) and get the same telegraphs.
 */
function falseTargetOf(battle, u, i, plan, t, ctx, rate, before) {
  if (t.targets.length !== 1) return null;
  const real = unitIn(battle, t.targets[0]);
  const a = plan.slots[t.slot];
  if (!real || real.side === u.side || !a || a.target?.unit !== real.id) return null;
  const was = before ? before.find((p) => p && p.unitId === u.id && p.slot === t.slot) : null;
  if (was) {
    const f = was.falseTarget ? unitIn(battle, was.falseTarget) : null;
    return f && standing(f) && f.id !== real.id ? f : null;
  }
  if (unit01(hashInts(battle.seed, battle.attempt, battle.round, i, t.slot, 'void-false')) >= rate) return null;
  const legal = legalTargetsAt(battle, u.id, plan, t.slot, a, ctx);
  const others = foesOf(battle, u).filter((v) => v.id !== real.id && v.rank === 'hero' && legal.has(v.id));
  if (!others.length) return null;
  return others[hashInts(battle.seed, battle.attempt, battle.round, i, t.slot, 'void-pick') % others.length];
}

/**
 * §7.2: a foe's telegraphs: B's plain ones from its plan, then a Noir stray's hidden intents, a Void
 * stray's false targets (1 in 3 per aimed telegraph, while another legal target exists and it isn't
 * Examined: its words, targets and tiles are the false target's, so nothing drawn points at the real
 * one; §18.3) and
 * the adapting eye, on the slots its counter changed (foePlan marks them in the plan's `changed`; a
 * counter that changes nothing shows no eye, and a hidden intent shows none). Cheap and pure: B
 * rebuilds telegraphs after every step.
 */
export function telegraphsOf(battle, unitId, plan, ctx) {
  const u = unitIn(battle, unitId);
  if (!u || !plan) return [];
  const list = plainTelegraphs(battle, unitId, plan, ctx);
  if (!list.length) return list;
  const hidden = noirHidden(battle, u);
  const voidish = hasGenre(u, 'void') && !u.examined;
  const adapted = u.side === 'foe' && effMode(battle) !== 'storybook' && (plan.changed || []).some(Boolean);
  // What was planned holds while the round runs: `seen` grows with every hero's action and heroes
  // move, so the eye's words and a Void stray's lies come from the telegraphs being replaced (this round's).
  const running = battle.status === 'running' || battle.status === 'asking';
  const before = running ? battle.telegraphs || [] : null;
  const prior = adapted && before ? before.find((t) => t.unitId === unitId && t.adapting) : null;
  const counter = !adapted ? null : prior ? { words: prior.adapting } : counterFor(battle, unitId, ctx);
  const i = battle.order.indexOf(unitId);
  const rate = ctx?.rules?.hidden?.voidFalse;
  const voidRate = Array.isArray(rate) ? rate[0] / rate[1] : typeof rate === 'number' ? rate : 1 / 3;
  for (const t of list) {
    if (hidden) t.hidden = true;
    const pick = voidish ? falseTargetOf(battle, u, i, plan, t, ctx, voidRate, before) : null;
    if (pick) {
      // Shown as the same action's telegraph at the false target: its words, targets and tiles.
      const fake = { ...plan.slots[t.slot], target: { unit: pick.id } };
      const shown = plainTelegraphs(battle, unitId, { ...plan, slots: plan.slots.map((x, s) => (s === t.slot ? fake : x)) }, ctx).find((x) => x.slot === t.slot);
      t.falseTarget = pick.id;
      t.words = shown ? shown.words : actionWords(battle, unitId, fake, ctx).slice(0, 60);
      t.targets = shown ? [...shown.targets] : [pick.id];
      t.tiles = shown ? shown.tiles : footprint(pick);
    }
    if (counter && plan.changed[t.slot] && !t.hidden) t.adapting = counter.words;
  }
  return list;
}

// ---------------------------------------------------------------------------
// Feints (leads only; §6.6)

/**
 * §7.2: a Tale-lead's feint: after seeing the party's plans, it swaps the action queued for `tick`
 * for a strike on a hero who isn't braced or guarded, or null to keep it. B counts `feintsLeft`.
 */
export function revise(battle, unitId, tick, ctx) {
  const u = unitIn(battle, unitId);
  if (!u || !standing(u) || u.rank !== 'lead' || !battle.lead) return null;
  if (battle.lead.feintsLeft <= 0) return null;
  const plan = battle.plans?.[unitId];
  if (!plan) return null;
  const entry = ticksOf(plan, u).find((t) => t.ends === tick && !t.lost);
  if (!entry) return null;
  const queued = plan.slots[entry.slot];
  if (!queued) return null;
  const aimed = queued.target?.unit ? unitIn(battle, queued.target.unit) : null;
  const heroes = foesOf(battle, u).filter((v) => v.rank === 'hero');
  if (!heroes.length) return null;
  // Who the party has made safe this round: a Brace planned, or a hero beside them who can Shoulder or Draw the blow.
  const guarded = (h) => {
    const p = battle.plans?.[h.id];
    if (p && p.slots.some((a) => a && a.id === 'brace')) return true;
    if (h.buffer > 0) return true;
    return heroes.some((w) => w.id !== h.id && unitDist(w, h) <= 1 && ['shoulder', 'draw-the-blow'].some((r) => (w.reactions?.[r] || 'never') !== 'never' && !w.reactionUsed));
  };
  if (aimed && aimed.side !== u.side && !guarded(aimed)) return null;
  const open = heroes.filter((h) => !guarded(h));
  if (!open.length) return null;
  const g = gridFor(battle, ctx.rules);
  const hit = bestAttack(battle, g, u, ctx, open, (list) => weakestOf(battle, list, u), { left: Math.max(1, queued.cost || 1) });
  if (!hit || (aimed && hit.target.id === aimed.id)) return null;
  return hit.action;
}

// ---------------------------------------------------------------------------
// A genre's memory across fights (party.strayMemory)

/** §7.2: what a genre remembers of you: { habit, count } or null. */
export function genreMemory(party, genre) {
  const m = party?.strayMemory?.[genre];
  return m && typeof m.habit === 'string' && Number.isFinite(m.count) && m.count > 0 ? { habit: m.habit, count: m.count } : null;
}

const HABIT = /^\d{1,3}:\d{1,5}$/;
const MAX_GENRES = 12;

/**
 * §7.2: remembers a fight's most-used habit against a genre (every committed choice the strays saw,
 * auto rounds included). The same habit adds its count; a new one takes over when it was used more
 * than the old one's count. Returns the same object when nothing changes.
 */
export function rememberHabits(party, genre, records) {
  if (!party || typeof genre !== 'string' || !/^[a-z][a-z-]{1,23}$/.test(genre) || !Array.isArray(records) || !records.length) return party;
  const counts = new Map();
  for (const r of records) {
    for (const unit of Object.values(r?.units || {})) {
      for (const c of unit?.choices || []) {
        if (!c || !Number.isInteger(c.template)) continue;
        const key = `${c.template}:${c.ability || 0}`;
        if (!HABIT.test(key)) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  if (!counts.size) return party;
  let top = null;
  for (const [k, n] of counts) if (!top || n > top.n) top = { k, n };
  const old = genreMemory(party, genre);
  let next;
  if (old && old.habit === top.k) next = { habit: old.habit, count: old.count + top.n };
  else if (!old || top.n > old.count) next = { habit: top.k, count: top.n };
  else return party;
  const memory = { ...(party.strayMemory || {}), [genre]: next };
  const keys = Object.keys(memory);
  if (keys.length > MAX_GENRES) {
    keys.sort((a, b) => memory[a].count - memory[b].count || (a < b ? -1 : 1));
    for (const k of keys.slice(0, keys.length - MAX_GENRES)) if (k !== genre) delete memory[k];
  }
  return { ...party, strayMemory: memory };
}

// ---------------------------------------------------------------------------
// Maud's Table (§4.15): focus fire and surface combos, for ai.js's foe plans

/** How many other party units stand in the same kind of surface near `v` that `u`'s own kind arcs through (0 when it doesn't arc). */
function arcWorth(b, g, rules, u, v) {
  const kind = u.strike?.kind;
  const at = g.surfaceAt(v.x, v.y);
  if (!kind || !at || rules?.surfaces?.[at]?.reacts?.[kind] !== 'arc' || v.moves?.flies || v.moves?.hovers) return 0;
  let n = 1;
  for (const w of b.units) {
    if (w.id === v.id || w.side !== v.side || !standing(w) || w.moves?.flies || w.moves?.hovers) continue;
    if (unitDist(v, w) <= 3 && g.surfaceAt(w.x, w.y) === at) n += 1;
  }
  return n;
}

/** The Strike's expected damage on `v` (its bars as B shows them, its kind against their defences). */
function expectedStrike(b, g, ctx, u, v) {
  if (!u.strike) return 0;
  const kind = u.strike.kind;
  const amount = Math.max(0, strikeAmount(u) + (v.weak?.[kind] || 0) - (v.resist?.[kind] || 0));
  let bars;
  try {
    bars = oddsAgainst(b, ctx, u.id, v.id, strikePk(u, v, { attackIndex: 0 }), g).bars;
  } catch {
    bars = [5, 80, 10, 5];
  }
  return (amount * (2 * bars[0] + bars[1] + 0.5 * bars[2])) / 100;
}

/**
 * Focus fire (Maud's Table): among the heroes this foe can reach this round (else all), the one its
 * Strikes would send offline in the fewest blows (Integrity and Buffer over the expected damage its
 * bars give: Guard, cover, light and defences all count), a surface combo's arc counting as the
 * others it would catch; ties to the nearer, then the ribbon.
 */
export function focusOf(b, u, ctx, pool) {
  const g = gridFor(b, ctx.rules);
  const speed = speedOf(b, u, ctx, { stride: true });
  const reach = Math.max(1, u.strike?.range || 0, u.ranged?.range || 0);
  const near = pool.filter((v) => unitDist(u, v) <= reach + speed * 2);
  const list = near.length ? near : pool;
  let best = null;
  for (const v of list) {
    const blows = (v.integrity + (v.buffer || 0)) / Math.max(0.5, expectedStrike(b, g, ctx, u, v) * Math.max(1, arcWorth(b, g, ctx.rules, u, v)));
    const score = Math.round(blows * 100);
    const d = unitDist(u, v);
    if (!best || score < best.score || (score === best.score && (d < best.d || (d === best.d && ribbonIndex(b, v.id) < ribbonIndex(b, best.v.id))))) best = { v, score, d };
  }
  return best ? best.v : null;
}

/** Where a Shove from `u` would push `v` (one tile straight away), or null when it wouldn't move. */
function pushLanding(g, u, v) {
  const from = footprint(u)[0];
  const at = footprint(v)[0];
  const dx = Math.sign(at.x - from.x);
  const dy = Math.sign(at.y - from.y);
  if ((!dx && !dy) || (v.size || 1) > (u.size || 1)) return null;
  const nx = v.x + dx;
  const ny = v.y + dy;
  if (!g.canStand(nx, ny, v.id) || g.betweenCorners(v.x, v.y, dx, dy, v.id)) return null;
  return { x: nx, y: ny };
}

/** A knock worth a Shove (a surface combo): onto a surface that hurts right now, or off a height. 0 when not. */
export function knockWorth(g, rules, u, v) {
  if (v.rank !== 'hero' || v.moves?.flies) return 0;
  const to = pushLanding(g, u, v);
  if (!to) return 0;
  let worth = hurtsAt(g, rules, v, to.x, to.y) && !footprint(v).some((t) => hurtsAt(g, rules, v, t.x, t.y)) ? 2 : 0;
  if (!v.moves?.hovers) {
    const h0 = Math.max(...footprint(v).map((t) => g.height(t.x, t.y)));
    const h1 = Math.max(...footprint({ x: to.x, y: to.y, size: v.size || 1 }).map((t) => g.height(t.x, t.y)));
    if (h1 < h0) worth += 2 * (h0 - h1);
  }
  return worth;
}

/**
 * Laying a surface (a surface combo): a big move that lays one where it catches two or more
 * heroes and none of its own side. → Action or null.
 */
export function surfaceMove(b, g, u, ctx, heroes, left) {
  for (const id of u.abilityIds || []) {
    for (const v of abilityVariants(ctx, id)) {
      if (!v.a.big || v.cost > left || !(v.spec.effects || []).some((e) => e.do === 'surface')) continue;
      if (abilityWhy(b, u, v.a, v.cost, ctx)) continue;
      const t = v.spec.target || { who: 'self' };
      if (!t.area) continue;
      const count = (tiles) => {
        let n = 0;
        for (const uid of g.caught(tiles)) {
          const w = unitIn(b, uid);
          if (!w || !standing(w)) continue;
          if (w.side === u.side && w.id !== u.id) return 0;
          if (w.side !== u.side && w.side !== 'neutral') n += 1;
        }
        return n;
      };
      if (t.who === 'self' || t.who === 'none' || t.area.at === 'self') {
        if (count(g.area(t.area.shape || 'burst', t.area.size ?? 1, { x: u.x, y: u.y }, { x: u.x, y: u.y })) >= 2) return act('use', { ability: v.a.id, cost: v.cost, choice: v.choice });
        continue;
      }
      if (t.who !== 'tile') continue;
      const range = t.range ?? 6;
      let best = null;
      for (const h of heroes) {
        if (unitDist(u, h) > range || !g.sees(u, h)) continue;
        const n = count(g.area(t.area.shape || 'burst', t.area.size ?? 1, { x: h.x, y: h.y }, { x: u.x, y: u.y }));
        if (n >= 2 && (!best || n > best.n)) best = { n, h };
      }
      if (best) return act('use', { ability: v.a.id, cost: v.cost, choice: v.choice, target: { tile: { x: best.h.x, y: best.h.y } } });
    }
  }
  return null;
}
