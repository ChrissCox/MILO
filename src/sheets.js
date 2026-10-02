// Character sheets (PLAN.md Phase 5b; LORE.md §9.0): what makes a named person a person beyond
// their conversations. Wants that move on, a voice of their own, an answer to every gift, a line
// for each part of the day, what they think of their neighbours, and callbacks to what they
// remember about Chris.
//
// Pure. The sheet is the rest of a person's file (content/people/npcs/<id>.json): `why`, `sheet`,
// `voice`, `gifts`, `day`, `thinks`, `recalls`, `arc` and `helloAfter`. The saved side is two
// fields on `state.people[id]`: `gift` (the day a gift last counted) and `found.gifts`.
import { isRecord, dayKey, cleanCount } from './clean.js';
import { PEOPLE_LIMITS } from './state5.js';
import { levelOf, pointsNow, LEVELS, allPeople } from './people.js';
import { ITEM_NAMES } from './camplife.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const lines = (value) => (Array.isArray(value) ? value.filter(text) : []);

/** What Chris can hand over: everything Milo gathers. */
export const GIFT_ITEMS = Object.freeze(Object.keys(ITEM_NAMES));
export const DAY_PARTS = Object.freeze(['morning', 'afternoon', 'evening', 'night']);
/** Approval for a gift they love, and for one they like. */
export const GIFT_LOVE = 2;
export const GIFT_LIKE = 1;

const entryOf = (state, id) => (isRecord(state?.people) && isRecord(state.people[id]) ? state.people[id] : null);
const withPerson = (state, id, person) => ({ ...state, people: { ...(isRecord(state?.people) ? state.people : {}), [id]: person } });
const materialsOf = (state) => (isRecord(state?.satchel) && isRecord(state.satchel.materials) ? state.satchel.materials : {});

function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

/** 'morning' (6 to 12), 'afternoon' (to 18), 'evening' (to 22), 'night'. */
export function partOfDay(now) {
  const h = new Date(now).getHours();
  if (h < 6 || h >= 22) return 'night';
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** Whether the person will ever come to camp (a companion) or never leaves their place (a named local). */
export const isLocal = (person) => Array.isArray(person?.camp?.never);

/**
 * What a sheet still lacks, as paths ("sheet.wants.now", "gifts.replies.trout"). Empty when the
 * person is whole. The validator and the cast report both read this.
 */
export function sheetGaps(person) {
  const gaps = [];
  const need = (ok, path) => { if (!ok) gaps.push(path); };
  if (!isRecord(person)) return ['person'];
  need(text(person.why) && person.why.length >= 30, 'why');
  need(isRecord(person.where) && Number.isInteger(person.where.x) && Number.isInteger(person.where.y), 'where');
  const sheet = isRecord(person.sheet) ? person.sheet : {};
  const wants = isRecord(sheet.wants) ? sheet.wants : {};
  for (const k of ['now', 'really', 'worry']) need(text(wants[k]), `sheet.wants.${k}`);
  if (isRecord(person.errand)) need(text(wants.next), 'sheet.wants.next');
  const fav = isRecord(sheet.favourites) ? sheet.favourites : {};
  for (const k of ['food', 'weather', 'place', 'topic']) need(text(fav[k]), `sheet.favourites.${k}`);
  need(lines(sheet.aversions).length >= 1, 'sheet.aversions');
  for (const k of ['temperament', 'strangers', 'friends', 'opensUp', 'goesQuiet']) need(text(sheet[k]), `sheet.${k}`);
  const voice = isRecord(person.voice) ? person.voice : {};
  need(Number.isInteger(voice.maxWords) && voice.maxWords >= 6 && voice.maxWords <= 40, 'voice.maxWords');
  need(lines(voice.words).length >= 2, 'voice.words');
  need(lines(voice.never).length >= 1, 'voice.never');
  for (const k of ['rhythm', 'tic', 'hello', 'goodbye', 'pleased', 'putOut']) need(text(voice[k]), `voice.${k}`);
  const gifts = isRecord(person.gifts) ? person.gifts : {};
  const replies = isRecord(gifts.replies) ? gifts.replies : {};
  for (const item of GIFT_ITEMS) need(lines(replies[item]).length >= 1, `gifts.replies.${item}`);
  need(lines(gifts.loves).length + lines(gifts.likes).length >= 1, 'gifts.loves');
  const day = isRecord(person.day) ? person.day : {};
  for (const k of [...DAY_PARTS, 'rain']) need(text(day[k]), `day.${k}`);
  need(isRecord(person.thinks) && Object.values(person.thinks).some((v) => lines(v).length), 'thinks');
  need(isRecord(person.recalls) && Object.values(person.recalls).some((v) => lines(v).length), 'recalls');
  const arc = isRecord(person.arc) ? person.arc : {};
  for (const k of ['want', 'complication', 'kindness']) need(text(arc[k]), `arc.${k}`);
  if (isRecord(person.errand)) need(isRecord(person.helloAfter) && LEVELS.slice(0, 4).every((l) => lines(person.helloAfter[l]).length), 'helloAfter');
  const camp = isRecord(person.camp) ? person.camp : {};
  need(text(camp.role), 'camp.role');
  if (!isLocal(person)) need(text(camp.leaves), 'camp.leaves');
  return gaps;
}

/** Whether their first want has been met: the errand they asked is done. */
export function wantMet(state, person) {
  const done = entryOf(state, person?.id)?.errand?.done;
  return isRecord(person?.errand) && finite(done);
}

/** What they are after right now, as the journal says it: the next want once the first is met. */
export function wantNow(state, person) {
  const wants = isRecord(person?.sheet?.wants) ? person.sheet.wants : {};
  const said = wantMet(state, person) ? wants.next : wants.now;
  return text(said) ? said : '';
}

/**
 * What they say first today. One of three, by the day: their usual hello for how they feel, what
 * they are doing at this time of day (or in the rain), or a callback to something they remember.
 * `hello` is their usual line, given by the caller. → a line, never empty unless `hello` is.
 */
export function opening(person, state, now, { hello = '', weather = null } = {}) {
  if (!isRecord(person) || !finite(now)) return hello;
  const entry = entryOf(state, person.id);
  const day = isRecord(person.day) ? person.day : {};
  const pick = hash('open', person.id, dayKey(now), partOfDay(now)) % 3;
  if (pick === 1) {
    const said = weather === 'rain' && text(day.rain) ? day.rain : day[partOfDay(now)];
    if (text(said)) return said;
  }
  if (pick === 2 && isRecord(person.recalls) && Array.isArray(entry?.memories)) {
    const kept = entry.memories.map((m) => lines(person.recalls[m.id])).flat();
    if (kept.length) return kept[hash('recall', person.id, dayKey(now)) % kept.length];
  }
  return hello;
}

/** What Chris has to give: [{ item, name, have }] for everything in the satchel they can be handed. */
export function giftView(state, person) {
  const replies = isRecord(person?.gifts?.replies) ? person.gifts.replies : {};
  const have = materialsOf(state);
  return GIFT_ITEMS.filter((item) => cleanCount(have[item]) > 0 && lines(replies[item]).length)
    .map((item) => ({ item, name: ITEM_NAMES[item], have: cleanCount(have[item]) }));
}

/** How they take an item: 'loves', 'likes' or 'plain'. */
export function giftKind(person, item) {
  const gifts = isRecord(person?.gifts) ? person.gifts : {};
  if (lines(gifts.loves).includes(item)) return 'loves';
  if (lines(gifts.likes).includes(item)) return 'likes';
  return 'plain';
}

/**
 * Hands them one of something. They always answer; a thing they like earns approval, once a day.
 * → { state, ok, lines, delta, kind, notes: [{ kind, text }], level, levelled }
 */
export function give(state, person, item, now) {
  const none = { state, ok: false, lines: [], delta: 0, kind: 'plain', notes: [], level: null, levelled: false };
  if (!isRecord(state) || !isRecord(person) || !finite(now) || !GIFT_ITEMS.includes(item)) return none;
  const entry = entryOf(state, person.id);
  const reply = lines(person.gifts?.replies?.[item]);
  const have = cleanCount(materialsOf(state)[item]);
  if (!entry?.met || !reply.length || have < 1) return none;
  const kind = giftKind(person, item);
  const today = dayKey(now);
  const counts = entry.gift !== today && kind !== 'plain';
  const before = pointsNow(person, entry, now);
  const levelBefore = levelOf(person, before);
  const delta = counts ? (kind === 'loves' ? GIFT_LOVE : GIFT_LIKE) : 0;
  const points = Math.min(PEOPLE_LIMITS.points, before + delta);
  const found = isRecord(entry.found) ? entry.found : {};
  const known = Array.isArray(found.gifts) ? found.gifts : [];
  const first = person.name.split(' ')[0];
  const notes = [];
  if (delta > 0) notes.push({ kind: 'approves', text: `${first} approves.` });
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const next = withPerson({ ...state, satchel: { ...satchel, materials: { ...materialsOf(state), [item]: have - 1 } } }, person.id, {
    ...entry, points, seen: Math.round(now), gift: counts ? today : (entry.gift ?? null),
    found: { ...found, gifts: known.includes(item) ? known : [...known, item].slice(-GIFT_ITEMS.length) },
  });
  const level = levelOf(person, points);
  return { state: next, ok: true, lines: reply, delta, kind, notes, level, levelled: LEVELS.indexOf(level) > LEVELS.indexOf(levelBefore) };
}

/** What the journal knows of their tastes, from what has been given: { loves: [names], likes: [names], plain: [names] }. */
export function giftsKnown(state, person) {
  const known = entryOf(state, person?.id)?.found?.gifts;
  const out = { loves: [], likes: [], plain: [] };
  for (const item of Array.isArray(known) ? known : []) if (GIFT_ITEMS.includes(item)) out[giftKind(person, item)].push(ITEM_NAMES[item]);
  return out;
}

/** Who they'll talk about: the people Chris has met that they have something to say of. [{ id, name }] */
export function aboutView(state, content, person) {
  const thinks = isRecord(person?.thinks) ? person.thinks : {};
  return allPeople(content)
    .filter((p) => p.id !== person.id && lines(thinks[p.id]).length && entryOf(state, p.id)?.met)
    .map((p) => ({ id: p.id, name: p.name.split(' ')[0] }));
}

/** What they say about someone. */
export const about = (person, otherId) => lines(person?.thinks?.[otherId]);

/**
 * One thing said by the fire tonight: a resident on another resident. The same all day, another
 * tomorrow. → { who, name, about, aboutName, lines } or null when fewer than two live there or
 * nobody has anything to say.
 */
export function fireTalk(state, content, now) {
  if (!finite(now)) return null;
  const home = allPeople(content).filter((p) => entryOf(state, p.id)?.camp);
  const pairs = [];
  for (const a of home) for (const b of home) if (a.id !== b.id && about(a, b.id).length) pairs.push([a, b]);
  if (!pairs.length) return null;
  const [a, b] = pairs[hash('fire', dayKey(now)) % pairs.length];
  return { who: a.id, name: a.name.split(' ')[0], about: b.id, aboutName: b.name.split(' ')[0], lines: about(a, b.id) };
}

/** Every line a person speaks, for the voice lint and the cast report. */
export function spokenLines(person) {
  if (!isRecord(person)) return [];
  const camp = isRecord(person.camp) ? person.camp : {};
  const e = isRecord(person.errand) ? person.errand : {};
  return [
    ...lines(person.meet), ...lines(person.tired), ...lines(person.finished),
    ...Object.values(isRecord(person.hello) ? person.hello : {}).flatMap(lines),
    ...Object.values(isRecord(person.helloAfter) ? person.helloAfter : {}).flatMap(lines),
    ...lines(camp.never), ...lines(camp.early), ...lines(camp.ask), ...lines(camp.yes), ...lines(camp.full),
    ...lines(e.offer), ...lines(e.waiting), ...lines(e.done),
    ...(Array.isArray(person.topics) ? person.topics : []).flatMap((t) => [...lines(t.say), ...(Array.isArray(t.options) ? t.options : []).flatMap((o) => lines(o.reply))]),
    ...Object.values(isRecord(person.gifts?.replies) ? person.gifts.replies : {}).flatMap(lines),
    ...[...DAY_PARTS, 'rain'].map((k) => person.day?.[k]).filter(text),
    ...Object.values(isRecord(person.thinks) ? person.thinks : {}).flatMap(lines),
    ...Object.values(isRecord(person.recalls) ? person.recalls : {}).flatMap(lines),
  ];
}

const WORD = /[A-Za-z’]+/g;
const sentences = (line) => line.split(/(?<=[.?!])\s+/).filter(Boolean);

/**
 * A line against its speaker's voice sheet → what is wrong with it, as words ("says “perhaps”",
 * "a sentence of 31 words"), or [] when it sounds like them.
 */
export function voiceFaults(person, line) {
  const voice = isRecord(person?.voice) ? person.voice : {};
  const faults = [];
  if (!text(line)) return faults;
  for (const word of lines(voice.never)) {
    if (new RegExp(`(^|[^A-Za-z’])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z’]|$)`, 'i').test(line)) faults.push(`says “${word}”`);
  }
  if (Number.isInteger(voice.maxWords)) {
    for (const s of sentences(line)) {
      const n = (s.match(WORD) || []).length;
      if (n > voice.maxWords) faults.push(`a sentence of ${n} words`);
    }
  }
  return faults;
}

/** How often their tic turns up, exactly as written (Jonas's “Also” opens a sentence): { lines, withTic }. */
export function ticCount(person) {
  const tic = person?.voice?.tic;
  const all = spokenLines(person);
  if (!text(tic)) return { lines: all.length, withTic: 0 };
  return { lines: all.length, withTic: all.filter((l) => l.includes(tic)).length };
}
