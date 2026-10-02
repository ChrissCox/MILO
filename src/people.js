// People (PLAN.md Phase 5.1; LORE.md §9.1): how the Hushlands' named people come to like Chris, and
// how someone ends up at his camp. Pathfinder 2e's Influence without the dice: Chris learns what a
// person cares about by trying, each conversation choice is an approach that fits them or doesn't,
// and the fit is read, never rolled, so the same words land the same way every time.
//
// Pure: every step takes `now` and returns a new state (or the same one when nothing changed).
// A person's file is content/people/npcs/<id>.json; their saved side is `state.people[id]`.
import { isRecord, dayKey, cleanCount } from './clean.js';
import { APPROACHES, PEOPLE_LIMITS } from './state5.js';
import { chapterDone } from './acts.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const DAY = 24 * 60 * 60 * 1000;

/** How many subjects someone will talk about in a day before they'd rather get on. */
export const DAY_TURNS = 3;
/** Approval never goes below this. */
export const FLOOR = -2;
/** Beds at the camp by Hearth tier (index tier - 1). */
export const BEDS = Object.freeze([2, 3, 4, 6, 8, 10, 12, 14]);

export const APPROACH_WORDS = Object.freeze({
  kind: 'A kind word', joke: 'A joke', favour: 'A favour', truth: 'The plain truth', craft: 'Shared craft',
});

export const LEVELS = Object.freeze(['wary', 'neutral', 'warm', 'fond', 'devoted']);
const LEVEL_WORDS = Object.freeze({ wary: 'Wary', neutral: 'Neutral', warm: 'Warm', fond: 'Fond', devoted: 'Devoted' });
export const levelWord = (level) => LEVEL_WORDS[level] || '';

const entryOf = (state, id) => (isRecord(state?.people) && isRecord(state.people[id]) ? state.people[id] : null);
const blank = () => ({
  points: 0, met: null, seen: null, done: [], turn: { day: null, n: 0, last: null },
  found: { likes: [], dislikes: [], resists: [], gifts: [] }, gift: null, memories: [], camp: null,
});
const withPerson = (state, id, person) => ({ ...state, people: { ...(isRecord(state?.people) ? state.people : {}), [id]: person } });

/** A person's file, validated: the fields the engine reads, or null when it can't be used. */
export function personOf(content, id) {
  const npc = isRecord(content?.people?.npcs) ? content.people.npcs[id] : null;
  if (!isRecord(npc) || npc.id !== id || typeof npc.name !== 'string' || !Array.isArray(npc.topics)) return null;
  return npc;
}

/** Every person the content has, in file order. */
export function allPeople(content) {
  const npcs = isRecord(content?.people?.npcs) ? content.people.npcs : {};
  return Object.keys(npcs).map((id) => personOf(content, id)).filter(Boolean);
}

/** Points that count: Warm is a floor that stays, the rest fade a point a week if you never come back (never below Neutral). */
export function pointsNow(person, entry, now) {
  const points = entry ? entry.points : 0;
  if (!entry || !finite(now) || !finite(entry.seen) || entry.camp || points <= 0) return points;
  const weeks = Math.floor(Math.max(0, now - entry.seen) / (7 * DAY));
  const warm = Math.ceil(person.threshold / 2);
  return points >= warm ? points : Math.max(0, points - weeks);
}

/** 'wary' (below 0), 'neutral', 'warm' (half the threshold), 'fond' (the threshold), 'devoted' (twice it). */
export function levelOf(person, points) {
  const t = Math.max(2, cleanCount(person?.threshold) || 5);
  if (points < 0) return 'wary';
  if (points >= t * 2) return 'devoted';
  if (points >= t) return 'fond';
  if (points >= Math.ceil(t / 2)) return 'warm';
  return 'neutral';
}

const fitOf = (person, approach) => {
  if (Array.isArray(person.resists) && person.resists.includes(approach)) return { delta: 0, kind: 'resists' };
  if (Array.isArray(person.dislikes) && person.dislikes.includes(approach)) return { delta: -1, kind: 'dislikes' };
  const like = isRecord(person.likes) ? person.likes[approach] : 0;
  return like > 0 ? { delta: Math.min(3, Math.round(like)), kind: 'likes' } : { delta: 0, kind: 'neutral' };
};

/** The first meeting, if it hasn't happened. */
export function meet(state, person, now) {
  const entry = entryOf(state, person.id);
  if (entry?.met) return state;
  return withPerson(state, person.id, { ...(entry || blank()), met: Math.round(now), seen: Math.round(now) });
}

const turnToday = (entry, now) => (entry.turn.day === dayKey(now) ? entry.turn : { day: dayKey(now), n: 0, last: null });

/** The next subject they'll raise: the first not yet done whose approval is reached. null when there's none. */
export function nextTopic(person, state, now) {
  const entry = entryOf(state, person.id) || blank();
  const points = pointsNow(person, entry, now);
  return person.topics.find((t) => !entry.done.includes(t.id) && (!finite(t.needs) || points >= t.needs)) || null;
}

/**
 * What the panel shows for a person: { id, name, title, level, levelWord, points, threshold, mood,
 * greeting (lines), topic (the subject they raise, or null), tired, finished, known (what Chris has learned),
 * memories ([{ id, text }]), camp: { state: 'in' | 'ask' | 'early' | 'full' | 'none', ... } }.
 */
export function personView(state, person, now, { beds = BEDS[0], residents = null } = {}) {
  const entry = entryOf(state, person.id);
  const e = entry || blank();
  const points = pointsNow(person, e, now);
  const level = levelOf(person, points);
  const turn = turnToday(e, now);
  const topic = nextTopic(person, state, now);
  const tired = turn.n >= DAY_TURNS && Boolean(topic);
  // Once the thing they asked for is done, their talk moves on (`helloAfter`).
  const moved = isRecord(person.helloAfter) && isRecord(person.errand) && finite(e.errand?.done);
  const greetings = moved ? person.helloAfter : person.hello;
  const hello = isRecord(greetings) ? greetings[level] || greetings.neutral || person.hello?.[level] || person.hello?.neutral : null;
  const lived = residents ?? Object.values(isRecord(state?.people) ? state.people : {}).filter((p) => isRecord(p) && p.camp).length;
  let camp;
  if (e.camp) camp = { state: 'in' };
  else if (Array.isArray(person.camp?.never)) camp = { state: 'never' };
  else if (level === 'fond' || level === 'devoted') camp = { state: lived >= beds ? 'full' : 'ask' };
  else camp = { state: 'none' };
  return {
    id: person.id, name: person.name, title: person.title || '', level, levelWord: levelWord(level), points, threshold: person.threshold,
    met: Boolean(e.met), greeting: e.met ? (Array.isArray(hello) ? hello : []) : (Array.isArray(person.meet) ? person.meet : []),
    topic: topic && !tired ? { id: topic.id, say: topic.say, options: topic.options.map((o, index) => ({ index, approach: o.approach, text: o.text })) } : null,
    tired: tired ? (person.tired || []) : null,
    finished: !topic ? (person.finished || []) : null,
    known: { likes: [...e.found.likes], dislikes: [...e.found.dislikes], resists: [...e.found.resists] },
    memories: e.memories.map((m) => ({ id: m.id, text: isRecord(person.memories) && typeof person.memories[m.id] === 'string' ? person.memories[m.id] : '' })).filter((m) => m.text),
    camp,
  };
}

/**
 * Chris answers the subject they raised. The approach fits them or it doesn't (read from their file),
 * and the same approach twice in a row is worth a point less. → { state, ok, delta, reply (lines),
 * notes ([{ kind: 'approves' | 'frowns' | 'remembers' | 'shrugs', text }]), level, levelled }
 */
export function choose(state, person, topicId, optionIndex, now) {
  const none = { state, ok: false, delta: 0, reply: [], notes: [], level: null, levelled: false };
  if (!isRecord(state) || !finite(now)) return none;
  const topic = person.topics.find((t) => t.id === topicId);
  const option = topic?.options?.[optionIndex];
  if (!topic || !option || !APPROACHES.includes(option.approach)) return none;
  const before = entryOf(state, person.id) || blank();
  if (before.done.includes(topic.id)) return none;
  const turn = turnToday(before, now);
  if (turn.n >= DAY_TURNS) return none;
  const pointsBefore = pointsNow(person, before, now);
  const levelBefore = levelOf(person, pointsBefore);
  const fit = fitOf(person, option.approach);
  let delta = fit.delta;
  if (delta > 0 && turn.last === option.approach) delta = Math.max(0, delta - 1);
  const points = Math.max(FLOOR, Math.min(PEOPLE_LIMITS.points, pointsBefore + delta));
  const found = { ...before.found, likes: [...before.found.likes], dislikes: [...before.found.dislikes], resists: [...before.found.resists] };
  const learn = (list) => { if (!list.includes(option.approach)) list.push(option.approach); };
  if (fit.kind === 'likes') learn(found.likes);
  else if (fit.kind === 'dislikes') learn(found.dislikes);
  else if (fit.kind === 'resists') learn(found.resists);
  const notes = [];
  const name = person.name.split(' ')[0];
  if (delta > 0) notes.push({ kind: 'approves', text: `${name} approves.` });
  else if (delta < 0) notes.push({ kind: 'frowns', text: `${name} frowns.` });
  else if (fit.kind === 'resists') notes.push({ kind: 'shrugs', text: `That doesn’t work on ${name}.` });
  let memories = before.memories;
  if (typeof option.remember === 'string' && isRecord(person.memories) && person.memories[option.remember] && !memories.some((m) => m.id === option.remember)) {
    memories = [...memories, { id: option.remember, at: Math.round(now) }].slice(-PEOPLE_LIMITS.memories);
    notes.push({ kind: 'remembers', text: `${name} will remember that.` });
  }
  const person2 = {
    ...before, points, met: before.met ?? Math.round(now), seen: Math.round(now),
    done: [...before.done, topic.id].slice(-PEOPLE_LIMITS.done),
    turn: { day: dayKey(now), n: turn.n + 1, last: option.approach },
    found, memories,
  };
  const level = levelOf(person, points);
  const reply = Array.isArray(option.reply) ? option.reply : [];
  return { state: withPerson(state, person.id, person2), ok: true, delta, reply, notes, level, levelled: level !== levelBefore && LEVELS.indexOf(level) > LEVELS.indexOf(levelBefore) };
}

/** How many people live at the camp. */
export const residentsOf = (state) => Object.values(isRecord(state?.people) ? state.people : {}).filter((p) => isRecord(p) && p.camp).length;

/** Beds the Hearth has (by tier). */
export const bedsFor = (tier) => BEDS[Math.max(0, Math.min(BEDS.length - 1, (Number.isInteger(tier) ? tier : 1) - 1))];

/**
 * Asks someone to come to camp. They come only if they're Fond of Chris and there's a bed.
 * → { state, ok, lines, why: 'early' | 'full' | null }
 */
export function inviteToCamp(state, person, now, { beds = BEDS[0] } = {}) {
  const entry = entryOf(state, person.id) || blank();
  if (entry.camp) return { state, ok: false, lines: [], why: null };
  const camp = isRecord(person.camp) ? person.camp : {};
  // Some people have a life they won't leave. They say so, kindly, whenever they're asked.
  if (Array.isArray(camp.never)) return { state, ok: false, lines: camp.never, why: 'never' };
  const level = levelOf(person, pointsNow(person, entry, now));
  if (level !== 'fond' && level !== 'devoted') return { state, ok: false, lines: camp.early || [], why: 'early' };
  if (residentsOf(state) >= beds) return { state, ok: false, lines: camp.full || [], why: 'full' };
  const next = withPerson(state, person.id, { ...entry, met: entry.met ?? Math.round(now), seen: Math.round(now), camp: Math.round(now) });
  return { state: next, ok: true, lines: camp.yes || [], why: null };
}

/** Sends someone back to their post, gently. They remember you kindly. */
export function sendHome(state, person, now) {
  const entry = entryOf(state, person.id);
  if (!entry?.camp) return state;
  return withPerson(state, person.id, { ...entry, camp: null, seen: Math.round(now) });
}

/** The people at the camp, in the order they came: [{ id, name, look, role }]. */
export function residents(state, content) {
  return allPeople(content)
    .map((p) => ({ p, at: entryOf(state, p.id)?.camp ?? null }))
    .filter((r) => r.at)
    .sort((a, b) => a.at - b.at)
    .map(({ p }) => ({ id: p.id, name: p.name, look: { kind: 'rig', rig: 'coat', who: p.id, likeness: null }, role: p.camp?.role || '' }));
}

const MENDED = Object.freeze(['sealed', 'stitched']);
/** Whether a rift of a genre has ever been mended (sealed or stitched; one let go doesn't count). */
export function riftMended(state, genre) {
  const history = Array.isArray(state?.rifts?.history) ? state.rifts.history : [];
  return history.some((h) => isRecord(h) && MENDED.includes(h.how) && Array.isArray(h.genres) && h.genres.includes(genre));
}

/**
 * Some people arrive later. `after` says what brings them: an Act I chapter's id; { genre } for
 * someone who steps out of a mended rift of that genre and stays; { built: n } once that many
 * buildings have been designed. Whoever has been met has arrived, whatever happens to the history.
 */
export function hasArrived(state, person) {
  const after = person?.after;
  if (after === undefined || after === null) return true;
  if (entryOf(state, person.id)?.met) return true;
  if (typeof after === 'string') return chapterDone(state, after);
  if (!isRecord(after)) return true;
  if (typeof after.genre === 'string') return riftMended(state, after.genre);
  if (Number.isInteger(after.built)) return cleanCount(state?.tally?.buildingsDesigned) >= after.built;
  return true;
}

/** The people standing out in the world (not at camp yet): [{ id, name, title, x, y, look }]. */
export function standing(state, content) {
  return allPeople(content)
    .filter((p) => isRecord(p.where) && Number.isInteger(p.where.x) && Number.isInteger(p.where.y) && !entryOf(state, p.id)?.camp && hasArrived(state, p))
    .map((p) => ({ id: p.id, name: p.name, title: p.title || '', x: p.where.x, y: p.where.y, look: { kind: 'rig', rig: 'coat', who: p.id, likeness: null } }));
}

/** What the journal page tells of what's been learned: "Likes a kind word. Puts him off a joke." as parts. */
export function knownWords(view) {
  const list = (items) => items.map((a) => APPROACH_WORDS[a].toLowerCase());
  return { likes: list(view.known.likes), dislikes: list(view.known.dislikes), resists: list(view.known.resists) };
}
