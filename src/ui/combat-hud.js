// The combat HUD (CONTRACT-PHASE4.md §12.1, §12.4 K2, §15; COMBAT.md §3.2, §13, §15): the
// initiative ribbon (allies on circles, foes on dashed diamonds, neutrals on squares; ◂ on the
// actor; "tick 2 of 3"), the portraits (Integrity notched every 10 with numbers, Buffer,
// conditions with numbers, charges as ✦, a sustained-spell flame, the control badge and each
// hero's heat thermometer), each foe's bar with its check segments (a lead's phases), calm pips
// beside each kind's telegraphs, the noise banner, Cheers, playback, the round planner, a
// reaction's Ask, and the cards: victory (with the Breather and the room's pay), a bow, the wake
// card ("Everyone went offline. Everyone’s fine.", Try again and Go home) and a real rift's yield
// card (Stitch, Ward and Let go).
//
// `buildHudView` and `buildCombatHud` are pure and deterministic. `createCombatHud` is the thin DOM
// side: it builds once, then updates cells in place (text, attributes and styles), re-rendering a
// region only when its structure changes (a new round's planner, a card), never per tick.
// `mount(shell)` wires it to the shell's 'combat' messages and key stack (§12.2); nothing in app.js
// calls it until wave 3.
import { esc } from './panels.js';
import { nameOf, conditionName, examineLine } from '../combat/describe.js';
import { plannerView, buildPlanner, oddsHtml, plannerReduce, barOptions, plannerOverlay, combatKey, keyTarget, heatGauge, veilWords, CONTROL_WORDS, BAND_WORDS } from './planner.js';
import { bandOf } from '../combat/heat.js';
import { portraitCanvas, paintPortraits } from './dialogue.js';
import { setRules, setCalm, setMode, maxRules } from '../party.js';

export const id = 'combat-hud';

const TERMINAL = Object.freeze(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);
const COND_SLOTS = 8;
// A lead can telegraph 7 or 8 things (its own 3 or 4, up to 3 Asides, and its mechanic's, listed last:
// the stomp), so its card keeps 8 lines (§18.3 item 5).
const TELE_SLOTS = 8;
const SEGMENTS = 10;
const PHASES = Object.freeze({ 2: ['Opening', 'Last page'], 3: ['Opening', 'Twist', 'Last page'] });
const SHAPES = Object.freeze({ party: 'circle', foe: 'diamond', neutral: 'square' });
const ICON_WORDS = Object.freeze({
  strike: 'Strike', bite: 'Bite', shoot: 'Shoot', cast: 'Cast', area: 'Area', move: 'Move', brace: 'Brace', patch: 'Patch', summon: 'Summon',
  surface: 'Surface', shove: 'Shove', talk: 'Talk', hide: 'Hide', examine: 'Examine', mechanic: 'Mechanic', wait: 'Wait',
});

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const share = (n, max) => (max > 0 ? clampInt((100 * n) / max, 0, 100) : 0);
const unitIn = (battle, unitId) => (battle?.units || []).find((u) => u.id === unitId) || null;
const unseen = (u) => u.side !== 'party' && (u.conditions || []).some((c) => c.id === 'unseen');

// ---------------------------------------------------------------------------
// The view

function ribbonView(battle, ui) {
  const order = Array.isArray(battle.order) && battle.order.length ? battle.order : (battle.units || []).map((u) => u.id);
  const running = battle.status === 'running' || battle.status === 'asking';
  const actor = running ? (battle.schedule || [])[Math.max(0, (battle.cursor || 0) - 1)]?.unitId || null : null;
  return order.map((uid) => unitIn(battle, uid)).filter(Boolean).map((u) => {
    const hidden = unseen(u);
    const name = hidden ? 'Something unseen' : nameOf(battle, u.id);
    const acting = actor === u.id && (battle.cursor || 0) > 0;
    const state = u.sorted ? 'sorted' : u.offline ? 'offline' : null;
    return {
      id: u.id, name, side: u.side, shape: SHAPES[u.side] || 'square', acting, state, selected: ui.selected === u.id,
      label: `${name}${u.side === 'party' ? '' : u.side === 'neutral' ? ', cheering from the side' : ''}${state === 'sorted' ? ', sorted' : state === 'offline' ? ', offline' : ''}${acting ? ', acting' : ''}`,
    };
  });
}

function conditionsView(u) {
  return (u.conditions || []).slice(0, COND_SLOTS).map((c) => {
    const name = conditionName(c.id);
    const n = Number.isFinite(c.n) && c.n ? c.n : null;
    return { id: c.id, n, text: n ? `${name} ${n}` : name };
  });
}

function sustainedView(battle, u, ctx) {
  const s = (battle.sustained || []).find((x) => x.unitId === u.id);
  if (!s) return null;
  const a = ctx?.abilities?.get ? ctx.abilities.get(s.abilityId) : null;
  return { abilityId: s.abilityId, name: a?.name || String(s.abilityId).replace(/-/g, ' '), rounds: Number.isFinite(s.rounds) ? s.rounds : null };
}

function notches(max) {
  const out = [];
  for (let at = 10; at < max && out.length < 40; at += 10) out.push(share(at, max));
  return out;
}

function portraitView(battle, u, ctx, ui) {
  const device = u.rank === 'device';
  const charges = u.charges && u.charges.max > 0 ? { left: clampInt(u.charges.left, 0, u.charges.max), max: clampInt(u.charges.max, 0, 12) } : null;
  return {
    id: u.id,
    name: nameOf(battle, u.id),
    rank: u.rank,
    device,
    look: u.look || null,
    integrity: u.integrity,
    max: u.maxIntegrity,
    share: share(u.integrity, u.maxIntegrity),
    notches: notches(u.maxIntegrity),
    buffer: u.buffer || 0,
    conditions: conditionsView(u),
    charges,
    sustained: sustainedView(battle, u, ctx),
    control: device ? null : u.control || 'review',
    controlWords: device ? null : CONTROL_WORDS[u.control] || CONTROL_WORDS.review,
    heat: device ? null : clampInt(u.heat, 0, 100),
    idle: Number.isFinite(u.idleHeat) ? u.idleHeat : null,
    offline: !!u.offline,
    selected: ui.selected === u.id,
  };
}

function barView(battle, u) {
  if (u.id === 'lead' && battle.lead && Array.isArray(battle.lead.bars) && battle.lead.bars.length) {
    const bars = battle.lead.bars;
    const now = clampInt(battle.lead.bar, 0, bars.length - 1);
    const names = PHASES[bars.length] || bars.map((_, i) => `Phase ${i + 1}`);
    return {
      kind: 'phases',
      phases: bars.map((max, i) => {
        const state = i < now || u.sorted ? 'done' : i === now ? 'now' : 'next';
        const checked = state === 'done' ? SEGMENTS : state === 'now' ? Math.floor((SEGMENTS * (u.maxIntegrity - u.integrity)) / Math.max(1, u.maxIntegrity)) : 0;
        return { name: names[i], max, state, checked: clampInt(checked, 0, SEGMENTS) };
      }),
    };
  }
  const checked = u.sorted ? SEGMENTS : Math.floor((SEGMENTS * (u.maxIntegrity - u.integrity)) / Math.max(1, u.maxIntegrity));
  return { kind: 'checks', checked: clampInt(checked, 0, SEGMENTS) };
}

// A hidden telegraph shows '?' and nothing else: no eye's words (its title), no targets, no aside
// (§18.3 item 5), whatever the Battle still carries.
function telegraphView(battle, t) {
  const hidden = !!t.hidden;
  const shown = t.falseTarget && !unitIn(battle, t.unitId)?.examined ? t.falseTarget : null;
  return {
    unitId: t.unitId, slot: t.slot, tick: t.tick, icon: hidden ? 'hidden' : t.icon,
    words: hidden ? '?' : String(t.words || ''), hidden, adapting: hidden ? null : t.adapting || null, aside: !hidden && !!t.aside,
    targets: hidden ? [] : shown ? [shown] : [...(t.targets || [])],
    label: hidden ? `Tick ${t.tick}: something hidden` : `Tick ${t.tick}: ${t.words}${t.adapting ? `. ${t.adapting}` : ''}${t.aside ? ', an aside' : ''}`,
  };
}

function calmView(battle) {
  const out = [];
  for (const [kind, c] of Object.entries(battle.talk || {})) {
    if (!c || !(c.need > 0)) continue;
    const sample = (battle.units || []).find((u) => u.talkKind === kind);
    out.push({ kind, name: sample ? nameOf(battle, sample.id) : 'These strays', calm: clampInt(c.calm, 0, c.need), need: clampInt(c.need, 1, 12), done: !!c.done });
  }
  return out;
}

function foeView(battle, u, telegraphs, calm) {
  const hidden = unseen(u);
  return {
    id: u.id,
    name: hidden ? 'Something unseen' : nameOf(battle, u.id),
    side: u.side,
    rank: u.rank,
    unseen: hidden,
    state: u.sorted ? 'sorted' : u.offline ? 'offline' : null,
    integrity: u.integrity,
    max: u.maxIntegrity,
    bar: hidden ? null : barView(battle, u),
    conditions: hidden ? [] : conditionsView(u),
    telegraphs: hidden || u.sorted ? [] : telegraphs.filter((t) => t.unitId === u.id).slice(0, TELE_SLOTS),
    calm: hidden ? null : calm.find((c) => c.kind === u.talkKind) || null,
    examined: !hidden && u.examined ? examineLine(battle, u.id) : null,
  };
}

const outcomeOf = (battle) => battle.result?.outcome || (TERMINAL.includes(battle.status) ? battle.status : null);

function payLines(pay) {
  if (!pay) return [];
  const bits = [];
  if (pay.xp) bits.push(`Road XP +${clampInt(pay.xp, 0, 1e7)}`);
  if (pay.marks) bits.push(`${clampInt(pay.marks, 0, 1e7)} Marks`);
  const lines = bits.length ? [`${bits.join(' and ')}.`] : [];
  const loot = (Array.isArray(pay.loot) ? pay.loot : []).map(String).filter(Boolean).slice(0, 8);
  if (loot.length) lines.push(`Found: ${loot.join(', ')}.`);
  return lines;
}

/**
 * The card when a fight is over (§12.4). `end` (from the fight, through `ui.end`): { pay: { xp,
 * marks, loot: string[] }, breather: true | string (why not) | null, invite: null | { name, words },
 * rift: null | { id, name } }. `focus` is the action that takes the focus when the card appears:
 * the safe one (§12.3), Carry on where there is one, never Come along or the Breather.
 */
export function cardView(battle, end = {}) {
  const card = cardBody(battle, end);
  if (!card) return null;
  const safe = card.actions.find((a) => a.id === 'continue') || card.actions.find((a) => a.primary) || card.actions[0] || null;
  return { ...card, focus: safe ? safe.id : null };
}

function cardBody(battle, end = {}) {
  const outcome = outcomeOf(battle);
  if (!outcome) return null;
  const result = battle.result || {};
  const summary = result.summary ? [String(result.summary)] : [];
  const breather = end?.breather === true ? [{ id: 'breather', label: 'Take a Breather', primary: false }] : [];
  const breatherWhy = typeof end?.breather === 'string' && end.breather ? [end.breather] : [];
  const invite = end?.invite?.words ? {
    lines: [`${end.invite.name ? `${end.invite.name}: ` : ''}“${String(end.invite.words).replace(/^“|”$/g, '')}”`],
    actions: [{ id: 'invite-yes', label: 'Come along', primary: false }, { id: 'invite-no', label: 'Not this time', primary: false }],
  } : { lines: [], actions: [] };
  const carryOn = { id: 'continue', label: 'Carry on', primary: true };
  switch (outcome) {
    case 'offline':
      return {
        kind: 'offline', title: 'Everyone went offline. Everyone’s fine.',
        lines: ['You’ll wake by the last lantern with everything you found. Trying again is free.'],
        actions: [{ id: 'try-again', label: 'Try again', primary: true }, { id: 'go-home', label: 'Go home', primary: false }],
      };
    case 'yielded':
      if (result.real) {
        return {
          kind: 'yielded', title: 'The Tale-lead yields',
          lines: [String(result.real.cause || ''), 'The seam won’t take the thread until the real thing is sorted.'].filter(Boolean),
          actions: [{ id: 'stitch', label: 'Stitch', primary: true }, { id: 'ward', label: 'Ward', primary: false }, { id: 'let-go', label: 'Let go', primary: false }],
          rift: end?.rift || null,
        };
      }
      return { kind: 'victory', title: 'The Tale-lead yields', lines: [...summary, ...payLines(end?.pay), ...breatherWhy, ...invite.lines], actions: [...invite.actions, ...breather, carryOn] };
    case 'bowed':
      return {
        kind: 'bow', title: 'A bow', lines: [...summary, 'A bow pays a quarter more.', ...payLines(end?.pay), ...breatherWhy, ...invite.lines],
        actions: [...invite.actions, ...breather, carryOn],
      };
    case 'last-page':
      return { kind: 'last-page', title: 'The last page', lines: [...summary, ...payLines(end?.pay), ...breatherWhy], actions: [...breather, carryOn] };
    case 'home':
      return { kind: 'home', title: 'Home again', lines: ['The Hooklight took everyone home, keeping everything.'], actions: [carryOn] };
    default:
      return {
        kind: 'victory', title: 'The room is quiet', lines: [...summary, ...payLines(end?.pay), ...breatherWhy, ...invite.lines],
        actions: [...invite.actions, ...breather, carryOn],
      };
  }
}

/**
 * The HUD's view (§12.4): { ribbon, portraits, foes, telegraphs, calm, noise, cheers, playback,
 * card, ask, planner, live, title, phase, round }. `ui` is the HUD's (planner.js's fields, plus
 * `end` for the card, `sync` and `playbook` for the planner, `say` for the live line, `paused`).
 */
export function buildHudView(battle, roundView, ui = {}, ctx = {}) {
  const u = ui || {};
  const planner = plannerView(battle, roundView, u, ctx, { sync: u.sync || {}, playbook: u.playbook || null, paused: !!u.paused, guided: u.guided });
  // The Battle’s own telegraphs (rebuilt after every step), so a roundView from the round’s start never shows stale ones.
  const telegraphs = (battle.telegraphs || roundView?.telegraphs || []).map((t) => telegraphView(battle, t));
  const calm = calmView(battle);
  const portraits = (battle.units || []).filter((x) => x.side === 'party').map((x) => portraitView(battle, x, ctx, u));
  const foes = (battle.units || []).filter((x) => x.side !== 'party').map((x) => foeView(battle, x, telegraphs, calm));
  const card = cardView(battle, u.end || {});
  // An Ask's words name an Unseen foe only as "something unseen", as its card does.
  const ask = battle.status === 'asking' && battle.ask ? { words: veilWords(battle, battle.ask.words || ''), unitId: battle.ask.unitId, reactionId: battle.ask.reactionId } : null;
  // The aria-live line says what the Log doesn't: while a round plays, the Log (aria-live itself)
  // reads each line, so this keeps what the last command said ("Running the round.") and nothing more.
  const drafted = planner.heroes.some((h) => h.draft);
  let live;
  if (card) live = card.title;
  else if (ask) live = ask.words;
  else if (planner.phase === 'running') live = u.say || '';
  else live = `${planner.title}. ${u.say || (drafted ? 'Your company has drafted.' : 'Every plan is yours to write.')}`;
  return {
    round: battle.round || 1,
    phase: card ? 'over' : planner.phase,
    title: planner.title,
    genre: (battle.genres || [])[0] || null,
    ribbon: ribbonView(battle, u),
    portraits,
    foes,
    telegraphs,
    calm,
    noise: planner.noise,
    cheers: planner.cheers,
    playback: planner.playback,
    card,
    ask,
    planner,
    live,
  };
}

// ---------------------------------------------------------------------------
// HTML (each changing value carries a data-cell key; hudCells lists the same cells)

const attrs = (list) => Object.entries(list).filter(([, v]) => v !== null && v !== undefined && v !== false)
  .map(([k, v]) => ` ${k}="${esc(v === true ? 'true' : v)}"`).join('');

function ribbonHtml(view) {
  const items = view.ribbon.map((r) => `<li class="ribbon-unit" data-side="${esc(r.side)}" data-unit="${esc(r.id)}"${attrs(ribbonAttrs(r))} data-cell="${esc(`r.${r.id}`)}">`
    + `<button type="button" class="ribbon-btn" data-action="combat-hud-select" data-unit="${esc(r.id)}" data-focus-key="${esc(`hud-ribbon-${r.id}`)}" aria-label="${esc(r.label)}" data-cell="${esc(`r.${r.id}.btn`)}">`
    + `<span class="shape" data-shape="${esc(r.shape)}" aria-hidden="true"></span><span class="ribbon-name">${esc(r.name)}</span>`
    + `<span class="acting-mark" aria-hidden="true"${r.acting ? '' : ' hidden'} data-cell="${esc(`r.${r.id}.mark`)}">◂</span></button></li>`).join('');
  return `<div class="hud-ribbon px" data-region="ribbon"><p class="hud-title" data-cell="hud.title">${esc(view.title)}</p>`
    + `<ol class="ribbon" aria-label="Initiative">${items}</ol></div>`;
}
const ribbonAttrs = (r) => ({ 'data-acting': r.acting, 'data-state': r.state, 'data-selected': r.selected });

function conditionsHtml(prefix, list) {
  let html = '<span class="conds">';
  for (let i = 0; i < COND_SLOTS; i += 1) {
    const c = list[i];
    html += `<span class="cond"${c ? ` data-cond="${esc(c.id)}"` : ' hidden'} data-cell="${esc(`${prefix}.c${i}`)}">${esc(c ? c.text : '')}</span>`;
  }
  return `${html}</span>`;
}

const intLabel = (p) => (p.offline ? `${p.name}, offline` : `${p.integrity} of ${p.max} Integrity`);

function portraitHtml(p, genre) {
  const k = `p.${p.id}`;
  let html = `<li class="portrait-card" data-unit="${esc(p.id)}"${p.device ? ' data-device="true"' : ''}${attrs({ 'data-offline': p.offline, 'data-selected': p.selected })} data-cell="${esc(k)}">`;
  html += `<button type="button" class="portrait-btn" data-action="combat-hud-select" data-unit="${esc(p.id)}" data-focus-key="${esc(`hud-portrait-${p.id}`)}" aria-label="${esc(p.name)}">`;
  html += portraitCanvas(p.look, { label: p.name, size: p.device ? 24 : 36, genre });
  html += `<span class="portrait-name">${esc(p.name)}</span></button>`;
  html += `<span class="int-bar" role="img" aria-label="${esc(intLabel(p))}" data-cell="${esc(`${k}.bar`)}"><span class="int-fill" style="--int:${p.share}%" data-cell="${esc(`${k}.fill`)}"></span>`
    + `${p.notches.map((n) => `<i class="notch" style="--at:${n}%"></i>`).join('')}</span>`;
  html += `<span class="int-num" data-cell="${esc(`${k}.int`)}">${esc(`${p.integrity}/${p.max}`)}</span>`;
  html += `<span class="buffer"${p.buffer ? '' : ' hidden'} data-cell="${esc(`${k}.buffer`)}">${esc(`Buffer ${p.buffer}`)}</span>`;
  if (!p.device) html += heatGauge(p.heat, { idle: p.idle, unitId: k });
  html += conditionsHtml(k, p.conditions);
  if (p.charges) html += `<span class="charges" role="img" aria-label="${esc(`${p.charges.left} of ${p.charges.max} charges`)}" data-cell="${esc(`${k}.charges`)}">${'✦'.repeat(p.charges.left)}${'✧'.repeat(p.charges.max - p.charges.left)}</span>`;
  html += `<span class="flame"${p.sustained ? '' : ' hidden'} role="img" aria-label="${esc(p.sustained ? `Sustaining ${p.sustained.name}` : '')}" data-cell="${esc(`${k}.flame`)}">`
    + `<span class="flame-name">${esc(p.sustained ? p.sustained.name : '')}</span></span>`;
  if (p.control) html += `<span class="control-badge" data-control="${esc(p.control)}" data-cell="${esc(`${k}.control`)}">${esc(p.controlWords)}</span>`;
  return `${html}</li>`;
}

function partyHtml(view) {
  return `<div class="hud-party" data-region="party"><ol class="portraits" aria-label="The company">${view.portraits.map((p) => portraitHtml(p, view.genre)).join('')}</ol></div>`;
}

function segHtml(prefix, checked, n = SEGMENTS) {
  let html = '';
  for (let i = 0; i < n; i += 1) html += `<i class="seg"${i < checked ? ' data-checked="true"' : ''} data-cell="${esc(`${prefix}.s${i}`)}"></i>`;
  return html;
}

function foeBarHtml(f) {
  const k = `f.${f.id}`;
  if (!f.bar) return '';
  if (f.bar.kind === 'phases') {
    return `<span class="foe-bar phases" role="img" aria-label="${esc(barLabel(f))}" data-cell="${esc(`${k}.bar`)}">${f.bar.phases.map((ph, i) => `<span class="phase" data-state="${esc(ph.state)}" data-cell="${esc(`${k}.ph${i}`)}">`
      + `<span class="phase-name">${esc(ph.name)}</span>${segHtml(`${k}.ph${i}`, ph.checked)}</span>`).join('')}</span>`;
  }
  return `<span class="foe-bar checks" role="img" aria-label="${esc(barLabel(f))}" data-cell="${esc(`${k}.bar`)}">${segHtml(k, f.bar.checked)}</span>`;
}

function barLabel(f) {
  if (f.state === 'sorted') return `${f.name}, sorted`;
  if (!f.bar) return f.name;
  const now = f.bar.kind === 'phases' ? f.bar.phases.find((p) => p.state === 'now') : null;
  return `${f.integrity} of ${f.max} Integrity${now ? `, ${now.name.toLowerCase()}` : ''}`;
}

function teleHtml(k, t, i) {
  return `<li class="tele"${t ? '' : ' hidden'}${attrs(teleAttrs(t))} data-cell="${esc(`${k}.t${i}`)}"><span class="tele-tick" aria-hidden="true" data-cell="${esc(`${k}.t${i}.tick`)}">${t ? t.tick : ''}</span>`
    + `<span class="tele-words" data-cell="${esc(`${k}.t${i}.words`)}">${esc(t ? t.words : '')}</span></li>`;
}
const teleAttrs = (t) => (t ? { 'data-icon': t.icon, 'data-adapting': !!t.adapting, 'data-aside': t.aside, title: t.adapting || null, 'aria-label': t.label } : {});

// A kind's calm, drawn on each of its foes' cards: the cells are the foe's own (`f.<id>.calm`), so
// every card of a kind updates in place.
function calmHtml(k, c) {
  if (!c) return '';
  let pips = '';
  for (let i = 0; i < c.need; i += 1) pips += `<i class="pip"${i < c.calm ? ' data-on="true"' : ''} data-cell="${esc(`${k}.calm.${i}`)}"></i>`;
  return `<span class="calm" data-kind="${esc(c.kind)}" role="img" aria-label="${esc(`Calm ${c.calm} of ${c.need}`)}" data-cell="${esc(`${k}.calm`)}">${pips}</span>`;
}

function foeHtml(f) {
  const k = `f.${f.id}`;
  let html = `<li class="foe-card" data-unit="${esc(f.id)}" data-side="${esc(f.side)}" data-rank="${esc(f.rank)}"${attrs({ 'data-state': f.state, 'data-unseen': f.unseen })} data-cell="${esc(k)}">`;
  html += `<button type="button" class="foe-name" data-action="combat-hud-select" data-unit="${esc(f.id)}" data-focus-key="${esc(`hud-foe-${f.id}`)}">${esc(f.name)}</button>`;
  if (f.side === 'neutral') return `${html}<span class="foe-note">Cheering from the side</span></li>`;
  html += foeBarHtml(f);
  html += `<span class="int-num" data-cell="${esc(`${k}.int`)}"${f.unseen ? ' hidden' : ''}>${esc(f.unseen ? '' : `${f.integrity}/${f.max}`)}</span>`;
  html += calmHtml(k, f.calm);
  html += conditionsHtml(k, f.conditions);
  html += `<ol class="teles" aria-label="${esc(`What ${f.name} means to do`)}">`;
  for (let i = 0; i < TELE_SLOTS; i += 1) html += teleHtml(k, f.telegraphs[i], i);
  html += '</ol>';
  if (f.examined) html += `<p class="foe-examined">${esc(f.examined)}</p>`;
  return `${html}</li>`;
}

function foesHtml(view) {
  return `<div class="hud-foes" data-region="foes"><ol class="foes" aria-label="Across the room">${view.foes.map(foeHtml).join('')}</ol></div>`;
}

function askHtml(view) {
  if (!view.ask) return '<div class="hud-ask" data-region="ask" hidden></div>';
  return `<div class="hud-ask px" data-region="ask" role="alertdialog" aria-label="${esc(view.ask.words)}"><p class="ask-words">${esc(view.ask.words)}</p>`
    + '<div class="ask-actions"><button type="button" class="px-btn primary" data-action="combat-hud-answer" data-yes="true" data-focus-key="hud-answer-yes">Yes</button>'
    + '<button type="button" class="px-btn" data-action="combat-hud-answer" data-yes="false" data-focus-key="hud-answer-no">No</button></div></div>';
}

/** A card's HTML: the fight's end (§12.4), its safe action focused first. */
export function cardHtml(card) {
  if (!card) return '<div class="hud-card" data-region="card" hidden></div>';
  let html = `<div class="hud-card px" data-region="card" data-card="${esc(card.kind)}" role="alertdialog" aria-labelledby="hud-card-title">`;
  html += `<p class="card-title" id="hud-card-title">${esc(card.title)}</p>`;
  for (const line of card.lines) html += `<p class="card-line">${esc(line)}</p>`;
  html += '<div class="card-actions">';
  for (const a of card.actions) {
    html += `<button type="button" class="px-btn${a.primary ? ' primary' : ''}" data-action="combat-hud-card" data-card-action="${esc(a.id)}" data-focus-key="${esc(`hud-card-${a.id}`)}">${esc(a.label)}</button>`;
  }
  return `${html}</div></div>`;
}

const REGIONS = Object.freeze(['ribbon', 'party', 'foes', 'odds', 'planner', 'ask', 'card']);
const REGION_HTML = Object.freeze({
  ribbon: ribbonHtml, party: partyHtml, foes: foesHtml,
  odds: (v) => `<div class="hud-odds" data-region="odds"${v.planner.odds ? '' : ' hidden'}>${oddsHtml(v.planner.odds)}</div>`,
  planner: (v) => buildPlanner(v.planner, { odds: false }), ask: askHtml, card: (v) => cardHtml(v.card),
});
const BOTTOM = Object.freeze(['odds', 'planner']);

/** One region's HTML (for the in-place updater's rare re-render). */
export const regionHtml = (name, view) => REGION_HTML[name](view);

/** The whole HUD's HTML. Deterministic. The odds and the planner share the bottom column. */
export function buildCombatHud(view) {
  const slot = (r) => `<div class="hud-slot" data-hud-slot="${r}">${REGION_HTML[r](view)}</div>`;
  return `<div class="combat-hud" data-phase="${esc(view.phase)}" data-round="${view.round}">`
    + REGIONS.filter((r) => !BOTTOM.includes(r)).map(slot).join('')
    + `<div class="hud-bottom">${BOTTOM.map(slot).join('')}</div>`
    + `<p class="sr-only" aria-live="polite" data-cell="hud.live">${esc(view.live)}</p></div>`;
}

// ---------------------------------------------------------------------------
// In place: the cells that change without a structure change, and each region's structure

const setCell = (map, key, cell) => { map[key] = cell; };

/**
 * Every cell that can change in place, as { key: { text?, attrs?, style? } }. `hidden` rides in
 * attrs (null removes it). The builder writes the same keys, so update() can patch them.
 */
export function hudCells(view) {
  const cells = {};
  setCell(cells, 'hud.title', { text: view.title });
  setCell(cells, 'hud.live', { text: view.live });
  for (const r of view.ribbon) {
    setCell(cells, `r.${r.id}`, { attrs: ribbonAttrs(r) });
    setCell(cells, `r.${r.id}.btn`, { attrs: { 'aria-label': r.label } });
    setCell(cells, `r.${r.id}.mark`, { attrs: { hidden: !r.acting } });
  }
  for (const p of view.portraits) {
    const k = `p.${p.id}`;
    setCell(cells, k, { attrs: { 'data-offline': p.offline, 'data-selected': p.selected } });
    setCell(cells, `${k}.bar`, { attrs: { 'aria-label': intLabel(p) } });
    setCell(cells, `${k}.fill`, { style: { '--int': `${p.share}%` } });
    setCell(cells, `${k}.int`, { text: `${p.integrity}/${p.max}` });
    setCell(cells, `${k}.buffer`, { text: `Buffer ${p.buffer}`, attrs: { hidden: !p.buffer } });
    if (!p.device) heatCells(cells, k, p.heat, p.idle);
    condCells(cells, k, p.conditions);
    if (p.charges) setCell(cells, `${k}.charges`, { text: `${'✦'.repeat(p.charges.left)}${'✧'.repeat(p.charges.max - p.charges.left)}`, attrs: { 'aria-label': `${p.charges.left} of ${p.charges.max} charges` } });
    setCell(cells, `${k}.flame`, { attrs: { hidden: !p.sustained, 'aria-label': p.sustained ? `Sustaining ${p.sustained.name}` : '' } });
    if (p.control) setCell(cells, `${k}.control`, { text: p.controlWords, attrs: { 'data-control': p.control } });
  }
  for (const f of view.foes) {
    const k = `f.${f.id}`;
    setCell(cells, k, { attrs: { 'data-state': f.state, 'data-unseen': f.unseen } });
    if (f.side === 'neutral') continue;
    if (f.bar) {
      setCell(cells, `${k}.bar`, { attrs: { 'aria-label': barLabel(f) } });
      if (f.bar.kind === 'phases') {
        f.bar.phases.forEach((ph, i) => {
          setCell(cells, `${k}.ph${i}`, { attrs: { 'data-state': ph.state } });
          for (let s = 0; s < SEGMENTS; s += 1) setCell(cells, `${k}.ph${i}.s${s}`, { attrs: { 'data-checked': s < ph.checked } });
        });
      } else {
        for (let s = 0; s < SEGMENTS; s += 1) setCell(cells, `${k}.s${s}`, { attrs: { 'data-checked': s < f.bar.checked } });
      }
    }
    setCell(cells, `${k}.int`, { text: f.unseen ? '' : `${f.integrity}/${f.max}` });
    condCells(cells, k, f.conditions);
    for (let i = 0; i < TELE_SLOTS; i += 1) {
      const t = f.telegraphs[i];
      setCell(cells, `${k}.t${i}`, { attrs: { hidden: !t, 'data-icon': t?.icon ?? null, 'data-adapting': !!t?.adapting, 'data-aside': !!t?.aside, title: t?.adapting || null, 'aria-label': t?.label ?? null } });
      setCell(cells, `${k}.t${i}.tick`, { text: t ? String(t.tick) : '' });
      setCell(cells, `${k}.t${i}.words`, { text: t ? t.words : '' });
    }
    if (f.calm) {
      setCell(cells, `${k}.calm`, { attrs: { 'aria-label': `Calm ${f.calm.calm} of ${f.calm.need}` } });
      for (let i = 0; i < f.calm.need; i += 1) setCell(cells, `${k}.calm.${i}`, { attrs: { 'data-on': i < f.calm.calm } });
    }
  }
  const pl = view.planner;
  setCell(cells, 'planner.title', { text: pl.title });
  setCell(cells, 'planner.noise', { text: pl.noise?.words || '', attrs: { hidden: !pl.noise } });
  setCell(cells, 'planner.cheers', { text: `Cheers ${'✦'.repeat(pl.cheers.left)}${'✧'.repeat(pl.cheers.used)}`, attrs: { 'aria-label': `${pl.cheers.left} of ${pl.cheers.held} Cheers left` } });
  for (const h of pl.heroes) {
    setCell(cells, `${h.id}-int`, { text: `${h.integrity}/${h.max}` });
    heatCells(cells, `planner.${h.id}`, h.heat, h.idle);
    for (const s of h.slots) setCell(cells, `${h.id}-slot-${s.index}`, { attrs: { 'data-run': s.run } });
  }
  return cells;
}

function condCells(cells, k, list) {
  for (let i = 0; i < COND_SLOTS; i += 1) {
    const c = list[i];
    setCell(cells, `${k}.c${i}`, { text: c ? c.text : '', attrs: { hidden: !c, 'data-cond': c ? c.id : null } });
  }
}

function heatCells(cells, k, heat, idle) {
  // heatGauge (planner.js) writes `${k}.heat` (its band, label and --heat), `.num` and `.band`.
  const value = clampInt(heat, 0, 100);
  const band = bandOf(value);
  setCell(cells, `${k}.heat`, {
    attrs: { 'data-band': band, 'data-heat': String(value), 'aria-label': `Heat ${value}, ${BAND_WORDS[band]}${Number.isFinite(idle) ? `, rests at ${clampInt(idle, 0, 100)}` : ''}` },
    style: { '--heat': `${value}%` },
  });
  setCell(cells, `${k}.heat.num`, { text: String(value) });
  setCell(cells, `${k}.heat.band`, { text: BAND_WORDS[band] });
}

/** Each region's structure as a string: when it changes, update() re-renders that region. */
export function hudShape(view) {
  const pl = view.planner;
  const plannerShape = {
    ...pl,
    odds: null,
    title: null,
    noise: pl.noise ? pl.noise.words : null,
    cheers: null,
    heroes: pl.heroes.map((h) => ({ ...h, integrity: null, heat: null, slots: h.slots.map((s) => ({ ...s, run: null })) })),
  };
  return {
    ribbon: JSON.stringify(view.ribbon.map((r) => [r.id, r.name, r.side])),
    party: JSON.stringify([view.genre, view.portraits.map((p) => [p.id, p.name, p.max, p.device, p.charges?.max ?? null, p.look, p.notches.length, !!p.control])]),
    foes: JSON.stringify(view.foes.map((f) => [f.id, f.name, f.side, f.max, f.bar?.kind ?? null, f.bar?.phases?.length ?? 0, f.calm ? [f.calm.kind, f.calm.need] : null, f.examined, f.unseen])),
    odds: JSON.stringify(pl.odds),
    planner: JSON.stringify(plannerShape),
    ask: JSON.stringify(view.ask),
    card: JSON.stringify(view.card),
  };
}

// ---------------------------------------------------------------------------
// The DOM side

/** The command a click or change on an element asks for (data-action and its data-*), or null. */
export function commandFor(el, type = 'click') {
  const d = el?.dataset || {};
  const action = d.action;
  if (!action) return null;
  const num = (v) => (v === undefined ? undefined : Number(v));
  if (type === 'change') {
    if (action === 'planner-reaction') return { t: 'reaction', unitId: d.unit, reactionId: d.reaction, setting: el.value };
    if (action === 'planner-rule') return { t: 'rule-set', unitId: d.unit, index: num(d.index), part: d.part, value: el.value };
    return null;
  }
  switch (action) {
    case 'planner-select': case 'combat-hud-select': return { t: 'select', unitId: d.unit };
    case 'planner-slot': return { t: 'slot', unitId: d.unit, slot: num(d.slot) };
    case 'planner-option': return { t: 'option', index: num(d.index) };
    case 'planner-more': return { t: 'more' };
    case 'planner-cheer': return { t: 'cheer', unitId: d.unit, slot: num(d.slot) };
    case 'planner-why': return { t: 'why', unitId: d.unit };
    case 'planner-accept': return { t: 'accept', unitId: d.unit };
    case 'planner-accept-all': return { t: 'accept-all' };
    case 'planner-rules': return { t: 'rules', unitId: d.unit };
    case 'planner-rule-add': return { t: 'rule-add', unitId: d.unit };
    case 'planner-rule-remove': return { t: 'rule-remove', unitId: d.unit, index: num(d.index) };
    case 'planner-close': return { t: 'close' };
    case 'planner-keys': return { t: 'keys' };
    case 'planner-odds-style': return { t: 'odds-style' };
    case 'planner-playback': return { t: 'playback', speed: num(d.speed) };
    case 'planner-undo': return { t: 'undo' };
    case 'planner-wrap': return { t: 'wrap' };
    case 'planner-pause': return { t: 'pause' };
    case 'planner-hand-over': return { t: 'hand-over' };
    case 'planner-take-back': return { t: 'take-back' };
    case 'planner-run': return { t: 'run' };
    case 'planner-ease': return { t: 'ease' };
    case 'planner-confirm': return { t: 'confirm' };
    case 'planner-back': return { t: 'back' };
    case 'combat-hud-answer': return { t: 'answer', yes: d.yes === 'true' };
    case 'combat-hud-card': return { t: 'card', action: d.cardAction };
    default: return null;
  }
}

function applyCell(el, cell) {
  if (!el || !cell) return;
  if (cell.text !== undefined && el.textContent !== cell.text) el.textContent = cell.text;
  if (cell.attrs) {
    for (const [name, value] of Object.entries(cell.attrs)) {
      if (value === null || value === undefined || value === false) {
        if (el.hasAttribute(name)) el.removeAttribute(name);
      } else {
        const v = value === true ? (name === 'hidden' ? '' : 'true') : String(value);
        if (el.getAttribute(name) !== v) el.setAttribute(name, v);
      }
    }
  }
  if (cell.style) for (const [name, value] of Object.entries(cell.style)) if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

// The open popover: its first controls (the first still drawn takes the focus) and its opener.
function popoverOf(pl) {
  if (pl.why) return { id: `why:${pl.why.unitId}`, first: ['planner-why-close'], opener: `planner-why-${pl.why.unitId}` };
  if (pl.playbook) {
    const uid = pl.playbook.unitId;
    return { id: `rules:${uid}`, first: [`planner-rule-${uid}-0-if`, `planner-rule-add-${uid}`, 'planner-rules-close'], opener: `planner-rules-${uid}` };
  }
  return pl.keys ? { id: 'keys', first: ['planner-keys-close'], opener: 'planner-keys' } : null;
}

/**
 * The HUD in `root` (#combat-hud): show(view) builds it once; update(view) patches cells in place
 * and re-renders a region only when its structure changed (keeping focus by data-focus-key);
 * dispose() empties it. onCommand(cmd) gets planner and card commands; onHover(cmd) hover ones.
 */
export function createCombatHud(root, { onCommand = () => {}, onHover = () => {}, genres = null } = {}) {
  let shape = null;
  let index = new Map();
  let shown = false;
  const reindex = () => {
    index = new Map();
    for (const el of root.querySelectorAll('[data-cell]')) index.set(el.dataset.cell, el);
  };
  const slotOf = (name) => root.querySelector(`[data-hud-slot="${name}"]`);
  const focusKey = () => {
    const doc = root.ownerDocument;
    const active = doc?.activeElement;
    return active && root.contains(active) ? active.dataset?.focusKey || null : null;
  };
  // The first of `keys` still drawn takes the focus (a control that went away hands it on).
  const refocus = (...keys) => {
    const list = keys.filter(Boolean);
    if (!list.length) return;
    const els = root.querySelectorAll('[data-focus-key]');
    for (const key of list) {
      for (const el of els) {
        if (el.dataset.focusKey === key) { el.focus?.({ preventScroll: true }); return; }
      }
    }
  };
  let picking = false;
  let popped = null;
  const onClick = (event) => {
    const el = event.target?.closest?.('[data-action]');
    if (!el || !root.contains(el) || el.disabled) return;
    const cmd = commandFor(el, 'click');
    if (cmd) { event.preventDefault?.(); onCommand(cmd); }
  };
  const onChange = (event) => {
    const el = event.target?.closest?.('[data-action]');
    const cmd = el ? commandFor(el, 'change') : null;
    if (cmd) onCommand(cmd);
  };
  const onOver = (event) => {
    const el = event.target?.closest?.('[data-unit]');
    if (!el || !root.contains(el)) return;
    const slot = el.closest?.('[data-slot]');
    onHover(slot && el.dataset.action === 'planner-slot' ? { t: 'hover', unitId: el.dataset.unit, slot: Number(slot.dataset.slot) } : { t: 'hover', unitId: el.dataset.unit });
  };
  const onLeave = (event) => {
    if (!event.relatedTarget || !root.contains(event.relatedTarget)) onHover({ t: 'hover', unitId: null });
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('pointerover', onOver);
  root.addEventListener('focusin', onOver);
  root.addEventListener('pointerleave', onLeave);
  const paint = () => { try { paintPortraits(root, { genres }); } catch (err) { console.error(err); } };
  const api = {
    show(view) {
      root.innerHTML = buildCombatHud(view);
      root.hidden = false;
      shape = hudShape(view);
      shown = true;
      picking = !!view.planner?.pick;
      popped = popoverOf(view.planner || {});
      reindex();
      paint();
      return true;
    },
    update(view) {
      if (!shown) return api.show(view);
      const next = hudShape(view);
      let key = focusKey();
      const had = key;
      let changed = false;
      // A pick that opens hands the focus to its Confirm, so Enter confirms it (a focused button keeps Enter, §12.1);
      // when it closes, the focus goes back to the slot in hand.
      const pl = view.planner || {};
      const pick = !!pl.pick;
      const slotKey = pl.selected && Number.isInteger(pl.slot) ? `planner-slot-${pl.selected}-${pl.slot}` : null;
      if (pick && !picking) key = 'planner-confirm';
      if (!pick && picking && (key === 'planner-confirm' || key === 'planner-back')) key = slotKey;
      picking = pick;
      // A popover (why?, the Playbook, the keys) that opens takes the focus on its first control, as a
      // dialog does; when it closes, the focus goes back to the button that opened it.
      const pop = popoverOf(pl);
      const opening = pop && pop.id !== popped?.id ? pop.first : [];
      const opener = !pop && popped ? popped.opener : null;
      popped = pop;
      for (const name of REGIONS) {
        if (next[name] === shape[name]) continue;
        const slot = slotOf(name);
        if (slot) { slot.innerHTML = REGION_HTML[name](view); changed = true; }
        // A card or an Ask that appears takes the focus, on its safe action (§12.3).
        if (name === 'card' && view.card) key = `hud-card-${view.card.focus}`;
        if (name === 'ask' && view.ask) key = 'hud-answer-yes';
      }
      const outer = root.firstElementChild;
      if (outer) { outer.setAttribute('data-phase', view.phase); outer.setAttribute('data-round', String(view.round)); }
      shape = next;
      // A focused control that went away hands the focus on inside the HUD, never to the page.
      if (changed) {
        reindex();
        paint();
        const card = !!(view.card || view.ask) && key && /^hud-(card|answer)-/.test(key);
        refocus(...(card ? [] : opening), key, opener, had ? slotKey : null, had && pl.selected ? `planner-hero-${pl.selected}` : null, had ? 'planner-run' : null);
      }
      const cells = hudCells(view);
      for (const [k, cell] of Object.entries(cells)) applyCell(index.get(k), cell);
      return changed;
    },
    /** The HUD's two bands in CSS px, for the shell's insets: { top, bottom } (null where nothing shows). */
    bands() {
      const rectOf = (selectors) => {
        let box = null;
        for (const sel of selectors) {
          const el = root.querySelector(sel);
          const r = el && !el.hidden && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          if (!r || !(r.width > 0 && r.height > 0)) continue;
          box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
            : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
        return box ? { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom), width: Math.round(box.right - box.left), height: Math.round(box.bottom - box.top) } : null;
      };
      return { top: rectOf(['.hud-ribbon', '.hud-party', '.hud-foes']), bottom: rectOf(['.hud-odds', '.planner']) };
    },
    hide() {
      root.hidden = true;
    },
    dispose() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('focusin', onOver);
      root.removeEventListener('pointerleave', onLeave);
      root.innerHTML = '';
      root.hidden = true;
      shown = false;
      index = new Map();
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// mount(shell)

const NOOP = Object.freeze({ dispose() {}, refresh() {}, pointer() { return false; }, hover() {}, select() { return false; }, act() { return false; }, actions() { return null; } });
// A unit id from the engine or the place list ('cb:f0' or 'f0'), or null.
const unitOf = (value) => (typeof value === 'string' && value ? value.replace(/^cb:/, '') || null : null);

/**
 * Whether a shell 'combat' message says a fight is showing (§18.3 item 10), read as K1's Log reads
 * it: a boolean as itself, then the message's `live`; a message without `live` is live when it
 * carries a battle, and null is never live.
 */
export function liveOf(message) {
  if (typeof message === 'boolean') return message;
  if (!message || typeof message !== 'object') return false;
  return typeof message.live === 'boolean' ? message.live : !!message.battle;
}

/** Sync from a notebook's accepts string: the share of '1's among the last 50 (as notebook.sync). */
export function syncOf(accepts) {
  const text = typeof accepts === 'string' ? accepts.slice(-50) : '';
  return text.length ? Math.round((100 * [...text].filter((c) => c === '1').length) / text.length) : null;
}

/**
 * Wires the HUD to the shell (§12.2, §12.3). The fight (L1) sends shell 'combat' messages
 * (§18.3 item 10): { live: true, battle, roundView, ctx, command(intent), end?, paused?, guided? }
 * while it shows, and { live: false } once the fight and its card are done. The HUD reads `live` as
 * K1's Log does: false (or null) hides it, even with a battle; a live message without a battle
 * leaves it as it is. The HUD keeps its own `ui`, turns clicks and keys into planner commands
 * (planner.plannerReduce) and hands the fight its intents through `command`. It writes playbook
 * rules (party.setRules) and the odds and playback settings (party.setCalm) itself, pushes its key
 * handler while a fight shows, and shows the planner's overlay through world('showOverlay').
 * Returns { dispose, refresh, pointer(cmd), hover(target), select(unitId), act(choice), actions() }: the shell passes the
 * engine's onCombatCommand and onCombatHover to pointer and hover, and a combatant list entry to select.
 */
export function mount(shell, { document: doc = globalThis.document } = {}) {
  try {
    const root = doc?.getElementById?.('combat-hud');
    if (!root || !shell) return NOOP;
    let msg = null;
    let ui = null;
    let hud = null;
    let popKeys = null;
    let vocab = null;
    let lastOverlay = 'null';
    const offs = [];
    const settingsUi = () => {
      const calm = shell.state?.party?.calm || {};
      return { odds: calm.odds === 'words' ? 'words' : 'bars', playback: [1, 2, 4].includes(calm.playback) ? calm.playback : 1 };
    };
    const freshUi = (battle) => ({
      selected: null, slot: null, cursor: null, hover: null, popover: null, page: 0, pick: null, history: [], handed: false,
      ...settingsUi(), battleId: battle?.id || null, attempt: battle?.attempt ?? 0, round: battle?.round ?? 1,
    });
    const loadVocab = () => {
      if (vocab) return;
      vocab = { ifs: [], thens: [], text: null };
      import('../combat/notebook.js').then((nb) => {
        vocab = { ifs: nb.RULE_IFS || [], thens: nb.RULE_THENS || [], text: typeof nb.ruleText === 'function' ? nb.ruleText : null };
        render();
      }).catch(() => {});
    };
    const extras = () => {
      const state = shell.state || {};
      const roster = state.party?.roster || {};
      const sync = {};
      for (const [rid, m] of Object.entries(roster)) sync[rid] = syncOf(m?.notebook?.accepts);
      const sel = ui?.selected;
      const playbook = sel && ui.popover === 'rules' ? { rules: roster[sel]?.notebook?.rules || [], max: maxRules(state), ...(vocab || {}) } : null;
      return { sync, playbook };
    };
    // Ghosted suggestions (COMBAT §15, the muster's switch): pale drafts for heroes on Mine from the
    // fight's own minds, made once a round per hero, only while the setting is on and the fight
    // didn't send its own (`roundView.ghosts`).
    const ghostCache = new Map();
    let ghostRound = null;
    const roundViewOf = (m) => {
      const rv = m?.roundView || null;
      const b = m?.battle;
      if (!rv || rv.ghosts || !b || b.status !== 'planning' || shell.state?.party?.calm?.ghosts !== true || typeof m.ctx?.minds?.draft !== 'function') return rv;
      const round = `${b.id}:${b.attempt}:${b.round}`;
      if (round !== ghostRound) { ghostRound = round; ghostCache.clear(); }
      const ghosts = {};
      for (const u of b.units) {
        if (u.side !== 'party' || u.rank !== 'hero' || u.control !== 'mine' || u.sorted || u.offline || rv.drafts?.[u.id]) continue;
        if (!ghostCache.has(u.id)) {
          let d = null;
          try { d = m.ctx.minds.draft(b, u.id) || null; } catch (err) { console.error(err); }
          ghostCache.set(u.id, d);
        }
        if (ghostCache.get(u.id)) ghosts[u.id] = ghostCache.get(u.id);
      }
      return Object.keys(ghosts).length ? { ...rv, ghosts } : rv;
    };
    // The bands are read (a layout) only when a region re-rendered, the HUD first shows, or the
    // window resizes: never per playback tick, whose updates change text and attributes only.
    let bandsStale = true;
    const render = () => {
      if (!msg?.battle || !hud) return;
      const rv = roundViewOf(msg);
      const view = buildHudView(msg.battle, rv, { ...ui, ...extras(), end: msg.end || null, paused: !!msg.paused, guided: msg.guided }, msg.ctx);
      if (hud.update(view)) bandsStale = true;
      try {
        const overlay = plannerOverlay(msg.battle, rv, ui, msg.ctx);
        const text = JSON.stringify(overlay);
        if (text !== lastOverlay) { lastOverlay = text; shell.world?.('showOverlay', overlay); }
      } catch (err) { console.error(err); }
      if (bandsStale) { bandsStale = false; reportInsets(hud.bands()); }
    };
    const win = doc?.defaultView || null;
    const onResize = () => { try { if (hud && msg) { bandsStale = false; reportInsets(hud.bands()); } } catch (err) { console.error(err); } };
    win?.addEventListener?.('resize', onResize);
    // The engine frames the arena clear of the HUD's bands (§12.2's insets: 'combat-top', 'combat-bottom').
    const insetKeys = { top: 'null', bottom: 'null' };
    const reportInsets = (bands) => {
      for (const side of ['top', 'bottom']) {
        const text = JSON.stringify(bands?.[side] ?? null);
        if (text === insetKeys[side]) continue;
        insetKeys[side] = text;
        try { shell.insets?.(`combat-${side}`, bands?.[side] ?? null); } catch (err) { console.error(err); }
      }
    };
    const intent = (it) => {
      const now = shell.now?.() ?? 0;
      if (it.t === 'rules') { shell.set?.(setRules(shell.state, it.unitId, it.rules, now)); return; }
      if (it.t === 'odds') { shell.set?.(setCalm(shell.state, { odds: it.style }, now)); }
      if (it.t === 'playback') { shell.set?.(setCalm(shell.state, { playback: it.speed }, now)); }
      // Easing sticks: the next fights start in Storybook too (making things harder waits for the muster).
      if (it.t === 'mode' && it.mode === 'storybook') { shell.set?.(setMode(shell.state, 'storybook', now)); }
      msg?.command?.(it);
    };
    const dispatch = (cmd) => {
      if (!msg?.battle || !cmd) return false;
      if (cmd.t === 'card') { msg.command?.({ t: 'card', action: cmd.action }); return true; }
      let command = cmd;
      if (cmd.t === 'rule-add' || cmd.t === 'rule-remove' || cmd.t === 'rule-set') {
        const rules = shell.state?.party?.roster?.[cmd.unitId]?.notebook?.rules || [];
        const first = { if: vocab?.ifs?.[0]?.id, then: vocab?.thens?.[0]?.id };
        command = { ...cmd, rules, rule: cmd.t === 'rule-add' && first.if && first.then ? first : null };
      }
      if (command.t === 'rules' || command.t === 'why') loadVocab();
      const r = plannerReduce(ui, command, { battle: msg.battle, roundView: roundViewOf(msg), ctx: msg.ctx });
      // A hover says nothing new, so the live line keeps what the last action said.
      ui = { ...r.ui, say: r.say || (command.t === 'hover' ? ui.say || null : null) };
      for (const it of r.intents) intent(it);
      render();
      return r.handled;
    };
    const onKey = (event) => {
      // Enter and Space stay with any focused control (the place list's and the Log's too), and a select keeps its letters and arrows.
      const cmd = combatKey(event, keyTarget(event?.target));
      if (!cmd) return false;
      const handled = dispatch(cmd);
      if (handled) event.preventDefault?.();
      return handled;
    };
    const show = (m) => {
      const battle = m.battle;
      const fresh = !ui || ui.battleId !== battle.id || ui.attempt !== battle.attempt;
      if (fresh) ui = freshUi(battle);
      else if (ui.round !== battle.round) ui = { ...ui, round: battle.round, history: [], pick: null, slot: null, popover: null, say: null };
      msg = m;
      if (!hud) {
        hud = createCombatHud(root, { onCommand: dispatch, onHover: (c) => dispatch(c), genres: shell.content?.()?.genres || null });
        hud.show(buildHudView(battle, roundViewOf(m), { ...ui, ...extras(), end: m.end || null }, m.ctx));
        bandsStale = true;
      }
      if (!popKeys && shell.keys?.push) popKeys = shell.keys.push(onKey);
      render();
    };
    const hide = () => {
      msg = null;
      if (popKeys) { popKeys(); popKeys = null; }
      if (hud) { hud.dispose(); hud = null; }
      if (lastOverlay !== 'null') { lastOverlay = 'null'; shell.world?.('showOverlay', null); }
      reportInsets(null);
    };
    offs.push(shell.on?.('combat', (m) => {
      try {
        const live = liveOf(m);
        if (!live) hide();
        else if (m?.battle) show(m);
      } catch (err) { console.error(err); }
    }));
    offs.push(shell.on?.('state', () => { try { if (msg) { ui = { ...ui, ...settingsUi() }; render(); } } catch (err) { console.error(err); } }));
    return {
      dispose() { hide(); win?.removeEventListener?.('resize', onResize); for (const off of offs) if (typeof off === 'function') off(); },
      refresh() { try { bandsStale = true; render(); } catch (err) { console.error(err); } },
      pointer(cmd) { return dispatch({ t: 'pointer', kind: cmd?.kind, tile: cmd?.tile || null, unitId: unitOf(cmd?.unitId) }); },
      hover(target) { if (msg) { ui = { ...ui, hover: unitOf(target?.unitId), cursor: ui.pick && target?.tile ? { x: target.tile.x, y: target.tile.y } : ui.cursor }; render(); } },
      // The selected hero's legal actions for the slot in hand, for the menu's `act:*` options.
      actions() {
        try {
          if (!msg?.battle || msg.battle.status !== 'planning' || !ui.selected || !Number.isInteger(ui.slot)) return null;
          const unit = (msg.battle.units || []).find((u) => u.id === ui.selected);
          const list = barOptions(msg.battle, roundViewOf(msg), ui.selected, ui.slot, msg.ctx);
          return unit && Array.isArray(list) && list.length ? { hero: nameOf(msg.battle, unit.id) || unit.name || unit.id, list } : null;
        } catch (err) { console.error(err); return null; }
      },
      // A menu's `act:*` choice (menus.actionOptions): the planner's option, then its target.
      act(choice) {
        const act = choice?.act;
        if (!act || !Number.isInteger(act.index)) return false;
        dispatch({ t: 'option', index: act.index });
        return dispatch({ t: 'pointer', kind: 'unit', tile: null, unitId: unitOf(act.unit) });
      },
      // A combatant list entry: a hero is selected; a foe is aimed at (a pick's target, or a Strike for the slot in hand).
      select(unitId) { return dispatch({ t: 'pointer', kind: 'unit', tile: null, unitId: unitOf(unitId) }); },
    };
  } catch (err) {
    console.error(err);
    return NOOP;
  }
}

