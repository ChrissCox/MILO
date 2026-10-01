// Embers: earned only from real work, spent on the trip and never the swing (CONTRACT-PHASE4.md
// §4.20, §7.6; COMBAT.md §12; PLAN.md §6). Pure: the clock comes in as `now`, and every number
// comes from content/economy.json (DEFAULT_ECONOMY mirrors it, and a test pins the two together).
//
// Only `earn` raises the balance, and only payFromSignals and kindleTick (src/kindle.js) call it.
// Event sources pay once by key (`embers.paid`); the counter-driven signals pay from high-water
// marks on their monotone counters (`embers.through`), so a relaunch can never pay twice.
import { isRecord, clip, cleanCount, dayKey } from './clean.js';
import { STATE4_LIMITS, emptyEmbers, prunePaid, eventTime, signalCounts, isEventKey, ledgerText } from './state4.js';
import { note } from './chronicle.js';
import { addXp, ratesOf } from './lifeskills.js';

const L = STATE4_LIMITS;

export const DEFAULT_ECONOMY = Object.freeze({
  cap: 100,
  ledger: 300,
  earn: Object.freeze([
    { id: 'focus', n: 10 }, { id: 'rest', n: 5 }, { id: 'crew', n: 2, perDay: 10 }, { id: 'answered', n: 1, perDay: 5 },
    { id: 'stitch', n: 5 }, { id: 'design', n: 5 }, { id: 'quest-main', n: 3 }, { id: 'quest-side', n: 2 },
  ].map(Object.freeze)),
  spend: Object.freeze({ wild: Object.freeze({ base: 5, every: 3, offset: 1, max: 10 }), real: 5, story: 0, field: 5, cave: 3, chunk: 1 }),
});

// The chunks that touch Hearthvale (worldgen's HEART, 64 × 44 tiles at the origin, in 32-tile chunks).
const CHUNK = 32;
const HEART = Object.freeze({ w: 64, h: 44 });
const EXPLORED_MAX = 20000; // model.js STATE_LIMITS.explored
const CHUNK_KEY = /^(-?\d{1,6}),(-?\d{1,6})$/;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const whole = (value) => (finite(value) && value >= 0 && Math.floor(value) === value ? value : null);

/**
 * economy.json read with its defaults: { cap, ledger, earn: { [id]: { n, perDay } }, spend }. The
 * bank's `cap` and the `ledger`'s length are also the save's own limits (§8.3: 100 and 300), which
 * every load enforces, so the file can lower them but never raise them past those.
 */
export function economyOf(economy) {
  const src = isRecord(economy) ? economy : {};
  const rates = {};
  for (const entry of [...DEFAULT_ECONOMY.earn, ...(Array.isArray(src.earn) ? src.earn : [])]) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    rates[entry.id] = { n: cleanCount(entry.n, L.ledgerMax), perDay: cleanCount(entry.perDay) || null };
  }
  const spend = { ...DEFAULT_ECONOMY.spend, ...(isRecord(src.spend) ? src.spend : {}) };
  const wild = { ...DEFAULT_ECONOMY.spend.wild, ...(isRecord(spend.wild) ? spend.wild : {}) };
  return {
    cap: cleanCount(src.cap, L.cap) || DEFAULT_ECONOMY.cap,
    ledger: cleanCount(src.ledger, L.ledger) || DEFAULT_ECONOMY.ledger,
    earn: rates,
    spend: {
      wild: { base: cleanCount(wild.base), every: cleanCount(wild.every) || 1, offset: cleanCount(wild.offset), max: cleanCount(wild.max) },
      real: cleanCount(spend.real), story: cleanCount(spend.story), field: cleanCount(spend.field), cave: cleanCount(spend.cave), chunk: cleanCount(spend.chunk),
    },
  };
}

/**
 * What stepping in costs: 'wild' (and a ladder rung) `min(max, base + floor((depth − offset) /
 * every))` (5 at depth 1–3, 6 at 4–6 … 10 from 16), 'real' 5, 'story' 0, 'field' 5, 'cave' 3,
 * 'chunk' 1. Any other kind costs what a wild rift does.
 */
export function entryCost(kind, { depth = 1, economy = null } = {}) {
  const { spend } = economyOf(economy);
  if (['real', 'story', 'field', 'cave', 'chunk'].includes(kind)) return spend[kind];
  const d = finite(depth) ? Math.max(1, Math.floor(depth)) : 1;
  return Math.min(spend.wild.max, spend.wild.base + Math.floor(Math.max(0, d - spend.wild.offset) / spend.wild.every));
}

const embersOf = (state) => (isRecord(state.embers) ? state.embers : emptyEmbers());
const balanceOf = (embers, cap) => (finite(embers.balance) ? Math.min(cap, Math.max(0, Math.floor(embers.balance))) : 0);
const ledgerOf = (embers) => (Array.isArray(embers.ledger) ? embers.ledger : []);
const paidOf = (embers) => (isRecord(embers.paid) ? embers.paid : {});

/**
 * Earns `n` Embers: `lifetime` counts all of them, the balance banks up to the cap, and the ledger
 * and the Chronicle say where they came from. An event `key` ('<source>:<ms>', such as
 * 'focus:<ms>') pays once, ever: a key already in `embers.paid`, or whose time is at or before
 * `paidBefore`, pays nothing. The ledger never stores a session title (§8.3): a quoted one in
 * `text` becomes "a waiting session". Called only by payFromSignals and kindleTick.
 * → { state, entry: LedgerEntry | null }
 */
export function earn(state, { source, key = null, n, text } = {}, now, economy) {
  const amount = whole(n);
  if (!isRecord(state) || !finite(now) || !amount || amount > L.ledgerMax) return { state, entry: null };
  const { cap, ledger: ledgerMax } = economyOf(economy);
  const embers = embersOf(state);
  let paid = paidOf(embers);
  let paidBefore = finite(embers.paidBefore) ? embers.paidBefore : 0;
  if (key !== null) {
    if (!isEventKey(key) || Object.hasOwn(paid, key)) return { state, entry: null };
    const at = eventTime(key);
    if (at !== null && at <= paidBefore) return { state, entry: null };
  }
  const balance = balanceOf(embers, cap);
  const entry = {
    at: Math.round(now), n: amount, banked: Math.min(amount, cap - balance, L.cap),
    source: clip(source, L.ledgerSource) || 'embers', text: ledgerText(text),
  };
  if (key !== null) ({ paid, paidBefore } = prunePaid({ ...paid, [key]: entry.at }, paidBefore));
  const next = {
    ...state,
    embers: {
      ...embers,
      balance: balance + entry.banked,
      lifetime: cleanCount(embers.lifetime) + amount,
      ledger: [...ledgerOf(embers), entry].slice(-ledgerMax),
      paid,
      paidBefore,
    },
  };
  return { state: note(next, now, { embersIn: amount }), entry };
}

/** Quests that pay in full in a local day; each one after pays a quarter (at least 1). */
export const QUEST_FULL_PER_DAY = 12;

/**
 * A finished quest's pay (PLAN.md Phase 5): `quest-main` Embers for a main quest and `quest-side`
 * for a side one (3 and 2), and past QUEST_FULL_PER_DAY paid quests in a local day a quarter of
 * that. `key` ('quest:<ms>') pays once. The text never holds a quest's title.
 * → { state, entry: LedgerEntry | null }
 */
export function payQuest(state, { kind, key = null } = {}, now, economy) {
  if (!isRecord(state) || !finite(now)) return { state, entry: null };
  const side = kind !== 'main';
  const full = economyOf(economy).earn[side ? 'quest-side' : 'quest-main']?.n ?? 0;
  const today = dayKey(now);
  const paidToday = ledgerOf(embersOf(state)).filter((e) => isRecord(e) && e.source === 'quest' && finite(e.at) && dayKey(e.at) === today).length;
  const amount = paidToday >= QUEST_FULL_PER_DAY ? Math.max(1, Math.ceil(full / 4)) : full;
  return earn(state, { source: 'quest', key, n: amount, text: side ? 'A side quest finished' : 'A main quest finished' }, now, economy);
}

const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
const SIGNALS = Object.freeze([
  // [counter, economy id, chronicle count, words]
  ['sessionsFinished', 'crew', 'crew', (n) => `Watched ${plural(n, 'a crew session', 'crew sessions')} finish`],
  ['answered', 'answered', 'answered', (n) => `Answered ${plural(n, 'a needs-you', 'needs-you')}`],
  ['stitchedReal', 'stitch', 'stitched', (n) => `Stitched ${plural(n, 'a real rift', 'real rifts')}`],
  ['buildingsDesigned', 'design', null, (n) => `Designed ${plural(n, 'a building', 'buildings')}`],
]);

/**
 * Pays the counter-driven signals since their high-water marks: crew sessions watched to the end
 * (2 each, at most 10 Embers a local day), needs-you answered (1 each, at most 5 a day), real rifts
 * stitched (5) and first designs (5). A mark always advances in full, so what's past a day's cap
 * is forfeited, never carried over. The first run after the Kit lands (`through: null`) pays every
 * counter's whole count once, ignoring the caps, as one entry "From before the Kit".
 * → { state, paid: LedgerEntry[] }
 */
export function payFromSignals(state, now, economy) {
  if (!isRecord(state) || !finite(now)) return { state, paid: [] };
  const econ = economyOf(economy);
  const counts = signalCounts(state);
  const marks = { sessionsFinished: counts.sessionsFinished, answered: counts.answered, stitchedReal: counts.stitchedReal, buildingsDesigned: counts.buildingsDesigned };
  const through = isRecord(embersOf(state).through) ? embersOf(state).through : null;
  const setMarks = (s, extra = {}) => ({ ...s, embers: { ...embersOf(s), through: { ...(through || {}), ...marks }, ...extra } });
  const paid = [];

  if (!through) {
    const total = Math.min(L.ledgerMax, SIGNALS.reduce((sum, [counter, id]) => sum + marks[counter] * (econ.earn[id]?.n || 0), 0));
    let next = setMarks(state, { backlogAt: Math.round(now) });
    if (total > 0) {
      const result = earn(next, { source: 'backlog', n: total, text: 'From before the Kit' }, now, economy);
      next = result.state;
      if (result.entry) paid.push(result.entry);
    }
    return { state: next, paid };
  }

  const deltas = {};
  let moved = false;
  for (const [counter] of SIGNALS) {
    const mark = cleanCount(through[counter]);
    deltas[counter] = Math.max(0, marks[counter] - mark);
    if (mark !== marks[counter]) moved = true; // a counter that went down lowers its mark, so only new work pays
  }
  if (!moved) return { state, paid };

  const today = dayKey(now);
  const savedDay = isRecord(embersOf(state).day) ? embersOf(state).day : {};
  const day = savedDay.key === today
    ? { ...savedDay, crew: cleanCount(savedDay.crew), answered: cleanCount(savedDay.answered) }
    : { ...savedDay, key: today, crew: 0, answered: 0 };
  let dayChanged = false;
  let next = state;
  const counted = {};
  for (const [counter, id, chronicleKey, words] of SIGNALS) {
    const n = deltas[counter];
    if (!n) continue;
    if (chronicleKey) counted[chronicleKey] = n;
    const rate = econ.earn[id] || { n: 0, perDay: null };
    let amount = n * rate.n;
    if (rate.perDay && Object.hasOwn(day, id)) {
      amount = Math.min(amount, Math.max(0, rate.perDay - day[id]));
      day[id] += amount;
      dayChanged = true;
    }
    if (amount <= 0) continue;
    const result = earn(next, { source: id, n: amount, text: words(n) }, now, economy);
    next = result.state;
    if (result.entry) paid.push(result.entry);
  }
  next = setMarks(next, dayChanged ? { day } : {});
  next = note(next, now, counted);
  return { state: next, paid };
}

const SPEND_WORDS = Object.freeze({
  wild: 'Stepped into a wild rift', rung: 'Went a rung deeper', real: 'Stepped into a real rift', story: 'Stepped into the crack',
  field: 'Challenged a field boss', cave: 'Went into a cave', chunk: 'Charted a new chunk',
});

/** 'That needs 5 Embers. You have 3.' */
export const shortWords = (n, balance) => `That needs ${n} ${n === 1 ? 'Ember' : 'Embers'}. You have ${balance}.`;

/**
 * Spends `n` Embers on `what` ('wild', 'real', 'field', 'cave', 'chunk'…). A spend of 0 (a story
 * rift) is always fine and writes nothing. Short of Embers, it refuses calmly and changes nothing.
 * A session title in `text` is never stored (§8.3): anything in “…” reads as one, so quote any other
 * name in ‘…’. → { ok, state, reason: string | null }
 */
export function spend(state, { n, what, text } = {}, now, economy) {
  const amount = whole(n);
  if (!isRecord(state) || !finite(now) || amount === null) return { ok: false, state, reason: 'That can’t be paid for right now.' };
  if (amount === 0) return { ok: true, state, reason: null };
  const { cap, ledger: ledgerMax } = economyOf(economy);
  const embers = embersOf(state);
  const balance = balanceOf(embers, cap);
  if (balance < amount) return { ok: false, state, reason: shortWords(amount, balance) };
  const source = clip(what, L.ledgerSource) || 'spend';
  const entry = { at: Math.round(now), n: -Math.min(amount, -L.ledgerMin), banked: 0, source, text: ledgerText(text) || SPEND_WORDS[what] || 'Spent on the road' };
  const next = { ...state, embers: { ...embers, balance: balance - amount, ledger: [...ledgerOf(embers), entry].slice(-ledgerMax) } };
  return { ok: true, state: note(next, now, { embersOut: amount }), reason: null };
}

/** True when the wallet holds at least `n` Embers. */
export function canAfford(state, n) {
  const amount = whole(n);
  if (amount === null || !isRecord(state)) return false;
  return balanceOf(embersOf(state), Infinity) >= amount;
}

/** The wallet for the title bar and the Chronicle: { balance, cap, lifetime, today: { earned, spent } }. */
export function walletView(state, now, { economy = null } = {}) {
  const { cap } = economyOf(economy);
  const embers = isRecord(state) ? embersOf(state) : emptyEmbers();
  const days = isRecord(state) && isRecord(state.chronicle) && isRecord(state.chronicle.days) ? state.chronicle.days : {};
  const key = finite(now) ? dayKey(now) : null;
  const today = key && Object.hasOwn(days, key) && isRecord(days[key]) ? days[key] : {};
  return {
    balance: balanceOf(embers, cap),
    cap,
    lifetime: cleanCount(embers.lifetime),
    today: { earned: cleanCount(today.embersIn), spent: cleanCount(today.embersOut) },
  };
}

/** True when a 'cx,cy' chunk overlaps Hearthvale's own tiles. */
export function touchesHeart(key) {
  const m = CHUNK_KEY.exec(key);
  if (!m) return false;
  const cx = Number(m[1]);
  const cy = Number(m[2]);
  return cx * CHUNK < HEART.w && (cx + 1) * CHUNK > 0 && cy * CHUNK < HEART.h && (cy + 1) * CHUNK > 0;
}

/**
 * Charts newly seen chunks ('cx,cy'), in place of markExplored. A chunk that touches the heart, or
 * was explored already, is free; any other costs 1 Ember and pays 40 Cartography, and with an
 * empty wallet it's skipped (left under fog, for the shell to chart once there are Embers again).
 * With `free` (a ruin tablet) every chunk charts at no cost and pays nothing. A day's chunk spends
 * share one ledger entry. → { state, charted: string[], skipped: string[] }
 */
export function chartChunks(state, keys, now, { economy = null, xp = null, free = false } = {}) {
  const none = { state, charted: [], skipped: [] };
  if (!isRecord(state) || !finite(now) || !Array.isArray(keys)) return none;
  const wilds = isRecord(state.wilds) ? state.wilds : {};
  const explored = Array.isArray(wilds.explored) ? wilds.explored : [];
  const seen = new Set(explored);
  const fresh = [...new Set(keys.filter((key) => typeof key === 'string' && CHUNK_KEY.test(key)))].filter((key) => !seen.has(key));
  if (!fresh.length) return none;
  const econ = economyOf(economy);
  const cost = econ.spend.chunk;
  let balance = balanceOf(embersOf(state), econ.cap);
  const charted = [];
  const skipped = [];
  let bought = 0;
  for (const key of fresh) {
    if (free || cost === 0 || touchesHeart(key)) {
      charted.push(key);
    } else if (balance >= cost) {
      balance -= cost;
      bought += 1;
      charted.push(key);
    } else {
      skipped.push(key);
    }
  }
  if (!charted.length) return { state, charted, skipped };
  const tally = isRecord(state.tally) ? state.tally : {};
  let next = {
    ...state,
    wilds: { ...wilds, explored: [...explored, ...charted].slice(-EXPLORED_MAX) },
    tally: { ...tally, chunksCharted: cleanCount(tally.chunksCharted) + charted.length },
  };
  if (bought) {
    next = spendChunks(next, bought, cost, now, econ);
    const rate = ratesOf(xp)['chunk-charted'];
    next = addXp(next, rate.skill, rate.xp * bought, now, { source: 'chunk-charted', text: bought === 1 ? 'a new chunk charted' : `${bought} new chunks charted` }).state;
  }
  return { state: next, charted, skipped };
}

/** Spends `count` chunks' worth, folding the day's chunk spends into one ledger entry. */
function spendChunks(state, count, cost, now, econ) {
  const embers = embersOf(state);
  const amount = count * cost;
  const ledger = ledgerOf(embers);
  const last = ledger[ledger.length - 1];
  const words = (n) => (n === 1 ? 'Charted a new chunk' : `Charted ${n} new chunks`);
  let nextLedger;
  if (isRecord(last) && last.source === 'chunk' && finite(last.at) && dayKey(last.at) === dayKey(now) && finite(last.n) && last.n - amount >= L.ledgerMin) {
    const chunks = Math.round(-last.n / Math.max(1, cost)) + count;
    nextLedger = [...ledger.slice(0, -1), { ...last, at: Math.round(now), n: last.n - amount, text: words(chunks) }];
  } else {
    nextLedger = [...ledger, { at: Math.round(now), n: -amount, banked: 0, source: 'chunk', text: words(count) }].slice(-econ.ledger);
  }
  const next = { ...state, embers: { ...embers, balance: balanceOf(embers, econ.cap) - amount, ledger: nextLedger } };
  return note(next, now, { embersOut: amount });
}
