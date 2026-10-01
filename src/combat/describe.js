// Words for fights (CONTRACT-PHASE4.md §5.8, §7.1; COMBAT.md §3.3, §13, §15): calm Log lines,
// odds as bars or words, why? lines, combatant labels, Examine lines, campfire summaries and
// thought bubbles. Pure; a leaf apart from heat.js.
import { oddsWords } from './heat.js';

const KIND_NAMES = {
  static: 'Static', chill: 'Chill', dread: 'Dread', grind: 'Grind', warp: 'Warp', doubt: 'Doubt', dust: 'Dust', quake: 'Quake',
  light: 'Light', ink: 'Ink', spark: 'Spark', plain: 'Plain',
};
export const kindName = (k) => KIND_NAMES[k] || String(k || '');

const CONDITION_NAMES = {
  tumbled: 'Tumbled', tangled: 'Tangled', drowsy: 'Drowsy', dazzled: 'Dazzled', spooked: 'Spooked', beguiled: 'Beguiled', queasy: 'Queasy',
  rattled: 'Rattled', dazed: 'Dazed', slowed: 'Slowed', quickened: 'Quickened', brisk: 'Brisk', winded: 'Winded', sparked: 'Sparked',
  singed: 'Singed', soaked: 'Soaked', hushed: 'Hushed', unseen: 'Unseen', exposed: 'Exposed', 'singled-out': 'Singled out', offline: 'Offline',
  lingering: 'Lingering',
};
export const conditionName = (id) => CONDITION_NAMES[id] || id;

const DEGREE_WORDS = { crit: 'Critical', hit: 'Hit', graze: 'Graze', miss: 'Miss' };
export const degreeName = (d) => DEGREE_WORDS[d] || d;

const TEMPERAMENTS = { shy: 'Shy', curious: 'Curious', grumpy: 'Grumpy', dramatic: 'Dramatic', sleepy: 'Sleepy', polite: 'Polite', lost: 'Lost', nosy: 'Nosy', proud: 'Proud' };

const find = (battle, id) => (battle?.units || []).find((u) => u.id === id) || null;

/** A unit's name for the start of a sentence. */
export function nameOf(battle, id) {
  const u = find(battle, id);
  const name = u?.name || id || 'Someone';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A unit's name mid-sentence: "the Scribe", "glitch beetle", "Milo". */
export function nameIn(battle, id) {
  const u = find(battle, id);
  const name = u?.name || id || 'someone';
  if (/^The /.test(name)) return `the ${name.slice(4)}`;
  if (u && u.rank !== 'hero' && u.rank !== 'lead' && u.kind !== 'regular' && !/^[A-Z][a-z]+ [A-Z]/.test(name)) {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }
  return name;
}

/** A tile in telegraph words: the arena's column letter and row number ("e5"). */
export function tileName(battle, tile) {
  if (!tile) return '';
  const rect = battle?.arena?.rect || { x: 0, y: 0 };
  const col = tile.x - rect.x;
  const letter = col >= 0 && col < 26 ? String.fromCharCode(97 + col) : `x${col}`;
  return `${letter}${tile.y - rect.y + 1}`;
}

const humanise = (id) => {
  const s = String(id || '').replace(/^mech:/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const BASIC_WORDS = {
  stride: 'Stride', step: 'Step', strike: 'Strike', brace: 'Brace', examine: 'Examine', seek: 'Seek', interact: 'Interact',
  assist: 'Assist', 'talk-down': 'Talk down', 'cool-down': 'Cool down', reboot: 'Reboot', delay: 'Delay', hide: 'Hide', throw: 'Throw',
  shove: 'Shove', jump: 'Jump', dip: 'Dip', sustain: 'Sustain', ready: 'Ready', 'head-home': 'Head home', aside: 'Aside',
};

/** The planner's words for an action: 'Letter Pip', 'Stride to c4', 'Strike glitch beetle'. */
export function actionWords(battle, unitId, action, ctx = null) {
  if (!action) return '';
  let verb = BASIC_WORDS[action.id] || humanise(action.id);
  if (action.id === 'use') {
    const a = action.ability && ctx?.abilities?.get ? ctx.abilities.get(action.ability) : null;
    verb = a?.words || a?.name || humanise(action.ability);
  }
  const t = action.target;
  if (!t) return verb;
  if (t.units && t.units.length) {
    if (action.id === 'assist' && t.units.length >= 2) return `${verb} ${nameIn(battle, t.units[0])} on ${nameIn(battle, t.units[1])}`;
    return `${verb} ${t.units.map((id) => nameIn(battle, id)).join(' and ')}`;
  }
  if (t.unit) return `${verb} ${nameIn(battle, t.unit)}`;
  if (t.object) {
    const o = (battle?.objects || []).find((x) => x.id === t.object);
    return o ? `${verb}: ${o.kind.replace(/-/g, ' ')}` : verb;
  }
  if (t.path && t.path.length) return `${verb} to ${tileName(battle, t.path[t.path.length - 1])}`;
  if (t.tile) return `${verb} at ${tileName(battle, t.tile)}`;
  return verb;
}

// ---------- odds ----------

/** Odds as the planner shows them: bars with amounts, or words. */
export function oddsText(odds, { style = 'bars' } = {}) {
  if (!odds) return '';
  if (style === 'words') {
    const w = oddsWords(odds.bars);
    const first = w.words.charAt(0).toUpperCase() + w.words.slice(1);
    return w.critInReach ? `${first}. A Critical is in reach.` : `${first}.`;
  }
  const names = ['Critical', 'Hit', 'Graze', 'Miss'];
  return names.map((n, i) => {
    const amount = odds.amounts && i < 3 ? ` ${odds.amounts[i]}${odds.known ? '' : '?'}` : '';
    return `${n} ${odds.bars[i]}%${amount}`;
  }).join(' · ');
}

/** A draft's why? evidence as one line. */
export function whyText(why) {
  if (!why) return '';
  const list = Array.isArray(why) ? why : [why];
  return list.map((w) => w.text).filter(Boolean).join(' ');
}

// ---------- labels and Examine ----------

/** 'Resists Static 3. Weak to Warp 3. Curious.' */
export function examineLine(battle, unitId) {
  const u = find(battle, unitId);
  if (!u) return '';
  const bits = [];
  const res = Object.entries(u.resist || {}).filter(([, v]) => v > 0);
  const weak = Object.entries(u.weak || {}).filter(([, v]) => v > 0);
  if (res.length) bits.push(`Resists ${res.map(([k, v]) => `${kindName(k)} ${v}`).join(', ')}.`);
  if (weak.length) bits.push(`Weak to ${weak.map(([k, v]) => `${kindName(k)} ${v}`).join(', ')}.`);
  if (!res.length && !weak.length) bits.push('No resistances or weaknesses.');
  if (u.temperament) bits.push(`${TEMPERAMENTS[u.temperament] || u.temperament}.`);
  return bits.join(' ');
}

const conditionList = (u) => (u.conditions || []).map((c) => (c.n ? `${conditionName(c.id)} ${c.n}` : conditionName(c.id)));

/** The screen reader's combatant line: 'Glitch drone, 6 of 16 Integrity, Spooked 1, telegraphing Bite Milo, Hit or better 85%'. */
export function combatantLabel(battle, unitId, ctx = null) {
  const u = find(battle, unitId);
  if (!u) return '';
  const parts = [nameOf(battle, unitId)];
  if (u.sorted) parts.push(u.sorted === 'talked' ? 'talked down' : u.sorted === 'bowed' ? 'bowed out' : 'sorted');
  else if (u.offline) parts.push('offline, dozing');
  else parts.push(`${u.integrity} of ${u.maxIntegrity} Integrity`);
  parts.push(...conditionList(u));
  if (u.side === 'party') parts.push(`${u.heat} heat`);
  const tele = (battle.telegraphs || []).find((t) => t.unitId === unitId);
  if (tele && !u.sorted) {
    parts.push(tele.hidden ? 'telegraphing something hidden' : `telegraphing ${tele.words}`);
    if (!tele.hidden && ctx?.oddsOf) {
      const odds = ctx.oddsOf(tele);
      if (odds) parts.push(`Hit or better ${odds.bars[0] + odds.bars[1]}%`);
    }
  }
  return parts.join(', ');
}

// ---------- the Log ----------

const clip = (s, n = 100) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

function lineFor(ev, battle, style) {
  switch (ev.t) {
    case 'damage': {
      const amount = `${ev.amount} ${kindName(ev.kind)}`;
      const extra = ev.buffered ? `, ${ev.buffered} into Buffer` : '';
      // Damage with no one behind it (lingering, an arc, a fall, a hazard) is taken, never dealt.
      if (!ev.unit || !ev.degree || ev.degree === 'none') return `${nameOf(battle, ev.target)} takes ${amount}${extra}.`;
      return `${nameOf(battle, ev.unit)} — ${degreeName(ev.degree)} — ${amount}${extra}`;
    }
    case 'outcome':
      if (ev.degree === 'miss') return `${ev.unit ? nameOf(battle, ev.unit) : 'It'} — Miss`;
      if (ev.by) return `${nameOf(battle, ev.by)} moves it to a ${degreeName(ev.degree)}.`;
      return null;
    case 'patch': return `${nameOf(battle, ev.unit || ev.target)} patches ${ev.unit === ev.target ? 'up' : nameIn(battle, ev.target)} for ${ev.amount}.`;
    case 'condition':
      if (ev.down) return null; // a count-down redraws a number; the Log keeps landings and endings
      if (!ev.on) return `${nameOf(battle, ev.target)} is no longer ${conditionName(ev.id)}.`;
      return `${nameOf(battle, ev.target)} is ${conditionName(ev.id)}${ev.n ? ` ${ev.n}` : ''}.`;
    case 'offline': return `${nameOf(battle, ev.unit)} goes offline and dozes.`;
    case 'reboot': return `${nameOf(battle, ev.by)} reboots ${nameIn(battle, ev.unit)}.`;
    case 'sorted':
      if (ev.how === 'talked') return `${nameOf(battle, ev.unit)} is talked down and heads home.`;
      if (ev.how === 'bowed') return `${nameOf(battle, ev.unit)} bows and heads home.`;
      return `${nameOf(battle, ev.unit)} is sorted, waves and goes home.`;
    case 'calm': return `Calm ${ev.calm} of ${ev.need}.`;
    case 'noise': return ev.unit ? `Noise: ${nameIn(battle, ev.unit)}’s action ${NOISE_LINES[ev.what] || 'shifts'}.` : `Noise: ${NOISE_LINES[ev.what] || ev.what}.`;
    case 'lost': return `${nameOf(battle, ev.unit)} loses an action (${LOST_WORDS[ev.why] || ev.why}).`;
    case 'improvise': return `${nameOf(battle, ev.unit)} improvises: ${actionWords(battle, ev.unit, ev.to)}.`;
    case 'reveal': return ev.text ? clip(ev.text) : null;
    case 'phase': return `${nameOf(battle, ev.unit)}: the ${String(ev.phase).replace(/-/g, ' ')}.${ev.quote ? ` “${ev.quote}”` : ''}`;
    case 'bow': return `The bow: ${ev.progress} of ${ev.need}.`;
    case 'feint': return ev.spotted ? `${nameOf(battle, ev.unit)} is about to change its plan.` : `${nameOf(battle, ev.unit)} changes its plan.`;
    case 'line': return ev.text;
    case 'bark': return ev.text ? `${nameOf(battle, ev.unit)}: “${ev.text}”` : null;
    case 'gone': return `${nameOf(battle, ev.unit)} is gone.`;
    case 'take': return `${nameOf(battle, ev.unit)} pinches a tonic.`;
    case 'end': return ev.why === 'standoff' ? STANDOFF_WORDS : ENDINGS[ev.result?.outcome] || null;
    case 'act':
      if (style === 'quiet') return null;
      return ev.words ? `${nameOf(battle, ev.unit)}: ${ev.words}.` : null;
    default: return null;
  }
}

const NOISE_LINES = {
  lag: 'lands a tick late', swap: 'swaps places in the tick', slept: 'is slept through', backlog: 'waits in the backlog',
  fastest: 'goes first, fastest gun', hidden: 'hides in the dark', tremor: 'the ground shakes into rough tiles', repeat: 'repeats, the hum', kind: 'turns kind',
};
const LOST_WORDS = { dazed: 'Dazed', slowed: 'Slowed', winded: 'Winded', 'wont-fit': 'no time left', offline: 'offline', asleep: 'asleep', beguiled: 'Beguiled' };
/** A standoff's ending (§18.2): three rounds with nothing happening. */
export const STANDOFF_WORDS = 'They’ve lost interest and wandered home.';
const ENDINGS = {
  won: 'The strays are sorted. The room is quiet.',
  talked: 'Everyone was talked down. The room is quiet.',
  bowed: 'The Tale-lead bows out.',
  yielded: 'The Tale-lead yields.',
  'last-page': 'The last page: the Tale-lead yields.',
  offline: 'Everyone went offline. Everyone’s fine.',
  home: 'The Hooklight takes everyone home.',
};

/** Calm Log lines for events, at most 100 characters each: 'Pip — Critical — 17 Warp'. */
export function logLines(events, battle, { odds = 'bars' } = {}) {
  const out = [];
  for (const ev of events || []) {
    const line = lineFor(ev, battle, odds);
    if (line) out.push(clip(line));
  }
  return out;
}

// ---------- summaries, thoughts and drafts ----------

/** The campfire summary for a finished fight (≤ 200 characters). */
export function summary(battle, result) {
  const bits = [];
  const heroes = (battle.units || []).filter((u) => u.side === 'party' && u.rank === 'hero');
  const outcome = result?.outcome || battle.status;
  if (outcome === 'offline') bits.push('Everyone went offline. Everyone’s fine.');
  else if (outcome === 'home') bits.push('The Hooklight took everyone home.');
  else if (outcome === 'talked') bits.push('Everyone was talked down.');
  else if (outcome === 'bowed') bits.push('The Tale-lead bowed out.');
  else if (outcome === 'yielded' || outcome === 'last-page') bits.push('The Tale-lead yielded.');
  else if (outcome === 'standoff') bits.push(STANDOFF_WORDS);
  // A lead's room is about the lead (§18.3), never the strays.
  else if (battle.lead || (battle.units || []).some((u) => u.id === 'lead')) bits.push('The Tale-lead settled and went home.');
  else bits.push('The strays went home.');
  const standingHeroes = heroes.filter((u) => !u.offline);
  const tough = [...standingHeroes].sort((a, b) => a.integrity / a.maxIntegrity - b.integrity / b.maxIntegrity)[0];
  if (tough && outcome !== 'offline') bits.push(`${nameOf(battle, tough.id)} held on.`);
  const hook = (battle.lights || []).find((l) => l.id === 'hooklight');
  if (outcome !== 'offline' && hook && hook.radius >= 5 && heroes.some((u) => u.kind === 'milo' && !u.offline)) bits.push('Milo kept the lantern high.');
  return clip(bits.join(' '), 200);
}

// Only the basic actions' verbs (and a patch) turn into -ing words; an ability stays its own name.
const VERB_ING = {
  stride: 'Striding', step: 'Stepping', strike: 'Striking', brace: 'Bracing', examine: 'Examining', seek: 'Seeking', interact: 'Interacting',
  assist: 'Assisting', talk: 'Talking', cool: 'Cooling', reboot: 'Rebooting', delay: 'Delaying', hide: 'Hiding', throw: 'Throwing', shove: 'Shoving',
  jump: 'Jumping', dip: 'Dipping', sustain: 'Sustaining', ready: 'Readying', head: 'Heading', patch: 'Patching',
};

/**
 * The words a drafted slot thinks in: a basic action's planner words ('Strike glitch beetle'), or an
 * ability's name as a noun and whom or where it's for ('Being sure on Milo', 'The lantern calls').
 */
export function thoughtWords(battle, unitId, action, ctx = null) {
  if (!action) return '';
  if (action.id === 'interact' && action.target?.object) {
    const o = (battle?.objects || []).find((x) => x.id === action.target.object);
    if (o) return `Interact with the ${o.kind.replace(/-/g, ' ')}`;
  }
  if (action.id !== 'use' || String(action.ability || '').startsWith('mech:')) return actionWords(battle, unitId, action, ctx);
  const a = action.ability && ctx?.abilities?.get ? ctx.abilities.get(action.ability) : null;
  const name = a?.name || humanise(action.ability);
  const t = action.target || {};
  const ids = (t.units || (t.unit ? [t.unit] : [])).filter((id) => id !== unitId);
  if (ids.length) return `${name} on ${ids.map((id) => nameIn(battle, id)).join(' and ')}`;
  const tile = t.tile || t.path?.[t.path.length - 1];
  return tile ? `${name} at ${tileName(battle, tile)}` : name;
}

/**
 * A drafted slot's thought bubble, in the hero's own voice. Jev (voice 'pictures') gets a picture,
 * never text: a pile for an attack, a tilted head otherwise.
 */
export function thoughtText(layer, words, who) {
  const w = String(words || '').trim();
  if (who && who.voice === 'pictures') {
    const pile = /^(strike|verdict|that pile|mote|flare|shove|throw)/i.test(w);
    return { text: null, picture: pile ? 'pile' : 'tilt' };
  }
  if (!w) return { text: null, picture: null };
  const [first, ...rest] = w.split(' ');
  const ing = VERB_ING[first.toLowerCase()];
  const phrase = ing ? [ing, ...rest].join(' ') : w.charAt(0).toUpperCase() + w.slice(1);
  if (layer === 'rule') return { text: `${phrase}. Your rule.`, picture: null };
  if (layer === 'habit') return { text: `${phrase}, like you would.`, picture: null };
  return { text: `${phrase}. It’s what I do.`, picture: null };
}

/** A draft read out for screen readers: 'The Scribe drafts Letter on Milo, Stride, Draft. 38 percent sure: new to Neon.' */
export function draftReadout(draft, battle, ctx = null) {
  if (!draft) return '';
  const who = nameOf(battle, draft.unitId);
  const spoken = (a) => {
    const verb = actionWords(battle, draft.unitId, { ...a, target: null }, ctx);
    // Words that already end in their own preposition ('Full stop on', 'Volley at') never get a second 'on'.
    const on = /\s(on|at|to|for|from|with|into|onto|beside|across)$/i.test(verb) ? ' ' : ' on ';
    const t = a?.target;
    if (t?.unit) return `${verb}${on}${nameIn(battle, t.unit)}`;
    if (t?.units?.length) return `${verb}${on}${t.units.map((id) => nameIn(battle, id)).join(' and ')}`;
    return verb;
  };
  const slots = (draft.plan?.slots || []).filter(Boolean).map(spoken);
  const why = (draft.why || []).find((w) => w.slot !== 'reaction');
  const reason = why?.text ? `: ${why.text.charAt(0).toLowerCase()}${why.text.slice(1).replace(/\.$/, '')}` : '';
  return `${who} drafts ${slots.join(', ') || 'nothing'}. ${draft.confidence} percent sure${reason}.`;
}
