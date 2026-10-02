// Errands (PLAN.md Phase 5.5): the small thing a person asks of you once they've warmed to you. A
// want, a little doing, and a kindness at the end. An errand's steps are things MILO already does:
// standing somewhere, cooking something at the fire, or bringing what Milo gathered. It pays in
// approval, a memory and a keepsake, never Embers: those come only from real work.
//
// Pure. A person's errand is `errand` in their file; the saved side is `state.people[id].errand`:
// { id, at, steps: [ms | null], done: ms | null }.
import { isRecord, cleanCount } from './clean.js';
import { PEOPLE_LIMITS } from './state5.js';
import { allPeople, levelOf, pointsNow, LEVELS } from './people.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const STEP_KINDS = Object.freeze(['visit', 'cook', 'give']);

const entryOf = (state, id) => (isRecord(state?.people) && isRecord(state.people[id]) ? state.people[id] : null);
const withPerson = (state, id, person) => ({ ...state, people: { ...(isRecord(state?.people) ? state.people : {}), [id]: person } });
const materialsOf = (state) => (isRecord(state?.satchel) && isRecord(state.satchel.materials) ? state.satchel.materials : {});

/** A person's errand from their file, or null when it can't be used. */
export function errandOf(person) {
  const e = person?.errand;
  if (!isRecord(e) || typeof e.id !== 'string' || !Array.isArray(e.steps) || !e.steps.length) return null;
  if (!e.steps.every((s) => isRecord(s) && STEP_KINDS.includes(s.kind))) return null;
  return e;
}

const savedOf = (state, person, errand) => {
  const saved = entryOf(state, person.id)?.errand;
  return isRecord(saved) && saved.id === errand.id ? saved : null;
};

/**
 * Where a person's errand stands: null when they have none, else
 * { id, title, state: 'hidden' | 'offer' | 'doing' | 'ready' | 'done',
 *   steps: [{ index, kind, text, done, item, n, have }], keepsake }.
 * It's offered once they are as warm as the errand asks (`needs`, 'warm' unless it says).
 */
export function errandView(state, person, now) {
  const errand = errandOf(person);
  if (!errand) return null;
  const entry = entryOf(state, person.id);
  const saved = savedOf(state, person, errand);
  const steps = errand.steps.map((s, index) => ({
    index, kind: s.kind, text: String(s.text || ''),
    done: Boolean(saved && finite(saved.steps?.[index])),
    item: s.kind === 'give' ? s.item : null, n: s.kind === 'give' ? cleanCount(s.n) : 0,
    have: s.kind === 'give' ? cleanCount(materialsOf(state)[s.item]) : 0,
  }));
  let where;
  if (saved && finite(saved.done)) where = 'done';
  else if (saved) where = steps.every((s) => s.done) ? 'ready' : 'doing';
  else {
    const level = levelOf(person, pointsNow(person, entry, now));
    const needs = LEVELS.includes(errand.needs) ? errand.needs : 'warm';
    where = entry?.met && LEVELS.indexOf(level) >= LEVELS.indexOf(needs) ? 'offer' : 'hidden';
  }
  return { id: errand.id, title: String(errand.title || ''), state: where, steps, keepsake: isRecord(errand.keepsake) ? errand.keepsake : null };
}

/** Takes the errand on. Nothing changes unless it's on offer. */
export function startErrand(state, person, now) {
  const errand = errandOf(person);
  if (!errand || !finite(now) || errandView(state, person, now).state !== 'offer') return state;
  const entry = entryOf(state, person.id);
  return withPerson(state, person.id, { ...entry, seen: Math.round(now), errand: { id: errand.id, at: Math.round(now), steps: errand.steps.map(() => null), done: null } });
}

const markStep = (state, person, errand, index, now) => {
  const entry = entryOf(state, person.id);
  const saved = savedOf(state, person, errand);
  if (!saved || finite(saved.done) || finite(saved.steps?.[index])) return state;
  const steps = errand.steps.map((_, i) => (i === index ? Math.round(now) : (finite(saved.steps?.[i]) ? saved.steps[i] : null)));
  return withPerson(state, person.id, { ...entry, errand: { ...saved, steps } });
};

/** Hands over what a "give" step asks for, out of the satchel. → { state, ok, why } */
export function giveStep(state, person, index, now) {
  const errand = errandOf(person);
  const step = errand?.steps?.[index];
  const saved = errand ? savedOf(state, person, errand) : null;
  if (!step || step.kind !== 'give' || !saved || finite(saved.done) || !finite(now)) return { state, ok: false, why: null };
  if (finite(saved.steps?.[index])) return { state, ok: false, why: null };
  const n = cleanCount(step.n);
  const have = cleanCount(materialsOf(state)[step.item]);
  if (have < n) return { state, ok: false, why: 'Not enough yet' };
  const satchel = isRecord(state.satchel) ? state.satchel : {};
  const next = { ...state, satchel: { ...satchel, materials: { ...materialsOf(state), [step.item]: have - n } } };
  return { state: markStep(next, person, errand, index, now), ok: true, why: null };
}

/**
 * Something happened that an errand may be waiting on: { kind: 'visit' | 'cook', target }. Every
 * person's running errand with a step it matches marks that step. → the new state (or the same one).
 */
export function errandEvent(state, content, event, now) {
  if (!isRecord(state) || !isRecord(event) || typeof event.target !== 'string' || !finite(now)) return state;
  let next = state;
  for (const person of allPeople(content)) {
    const errand = errandOf(person);
    if (!errand || !savedOf(next, person, errand)) continue;
    errand.steps.forEach((s, index) => {
      if (s.kind === event.kind && s.kind !== 'give' && s.target === event.target) next = markStep(next, person, errand, index, now);
    });
  }
  return next;
}

/**
 * Tells them it's done. Approval rises, they remember it, and the keepsake goes in the satchel.
 * → { state, ok, lines, notes: [{ kind, text }], level, levelled }
 */
export function finishErrand(state, person, now) {
  const none = { state, ok: false, lines: [], notes: [], level: null, levelled: false };
  const errand = errandOf(person);
  if (!errand || !finite(now) || errandView(state, person, now).state !== 'ready') return none;
  const entry = entryOf(state, person.id);
  const saved = savedOf(state, person, errand);
  const before = pointsNow(person, entry, now);
  const levelBefore = levelOf(person, before);
  const gain = Math.max(0, Math.min(5, cleanCount(errand.approval)));
  const points = Math.min(PEOPLE_LIMITS.points, before + gain);
  const first = person.name.split(' ')[0];
  const notes = [];
  if (gain > 0) notes.push({ kind: 'approves', text: `${first} approves.` });
  let memories = Array.isArray(entry.memories) ? entry.memories : [];
  if (typeof errand.remember === 'string' && isRecord(person.memories) && person.memories[errand.remember] && !memories.some((m) => m.id === errand.remember)) {
    memories = [...memories, { id: errand.remember, at: Math.round(now) }].slice(-PEOPLE_LIMITS.memories);
    notes.push({ kind: 'remembers', text: `${first} will remember that.` });
  }
  let next = withPerson(state, person.id, { ...entry, points, seen: Math.round(now), memories, errand: { ...saved, done: Math.round(now) } });
  const keepsake = isRecord(errand.keepsake) && typeof errand.keepsake.name === 'string' ? errand.keepsake : null;
  if (keepsake) {
    const satchel = isRecord(next.satchel) ? next.satchel : {};
    const relics = Array.isArray(satchel.relics) ? satchel.relics : [];
    if (!relics.some((r) => isRecord(r) && r.name === keepsake.name)) {
      next = { ...next, satchel: { ...satchel, relics: [...relics, { name: keepsake.name, text: String(keepsake.text || ''), genre: null, at: Math.round(now) }] } };
    }
    notes.push({ kind: 'gift', text: `${first} gave you ${keepsake.name.charAt(0).toLowerCase()}${keepsake.name.slice(1)}.` });
  }
  const level = levelOf(person, points);
  return { state: next, ok: true, lines: Array.isArray(errand.done) ? errand.done : [], notes, level, levelled: LEVELS.indexOf(level) > LEVELS.indexOf(levelBefore) };
}

/** The errands under way or finished, for the Board: [{ personId, name, title, state, steps }]. Running ones first. */
export function errandList(state, content, now) {
  const order = { ready: 0, doing: 1, done: 2 };
  return allPeople(content)
    .map((p) => ({ p, view: errandView(state, p, now) }))
    .filter(({ view }) => view && Object.hasOwn(order, view.state))
    .sort((a, b) => order[a.view.state] - order[b.view.state])
    .map(({ p, view }) => ({ personId: p.id, name: p.name, title: view.title, state: view.state, steps: view.steps }));
}
