// The camp: its day on the real clock, the scenes, the talk grammar and teaching at the fire
// (CONTRACT-PHASE4.md §7.5, §9.10; COMBAT.md §2.6–§2.7, §3.8). Pure: every step takes `now` and
// returns a new state, or the same object when nothing changed. Jev never speaks: a talk that
// gives Jev a line doesn't parse.
import { isRecord, dayNumber } from './clean.js';
import { markFact } from './state4.js';
import { recruit, addCheer, warmthStep, crewStateOf } from './party.js';

const HOUR = 60 * 60 * 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const stamp = (now) => (finite(now) && now > 0 ? Math.round(now) : 0);
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);

// Who a speaker or a requirement names, by id (the fifteen companion files' ids).
const COMPANIONS = Object.freeze(['milo', 'claude', 'codex', 'jev', 'tollkeeper', 'rivet', 'pip', 'dusty', 'juno', 'mae', 'lumi', 'tova', 'nell', 'whisper', 'vesperine']);
const ALIASES = Object.freeze({ scribe: 'claude', artificer: 'codex', 'slate artificer': 'codex', 'scribe in clay': 'claude', judgebird: 'jev' });
// How a requirement's words name them ("With the Scribe", "Friend warmth with the Tollkeeper").
const CALLED = Object.freeze({
  milo: 'Milo', claude: 'the Scribe', codex: 'the Artificer', jev: 'Jev', tollkeeper: 'the Tollkeeper', rivet: 'Rivet', pip: 'Pip',
  dusty: 'Dusty', juno: 'Juno', mae: 'Mae', lumi: 'Lumi', tova: 'Tova', nell: 'Nell', whisper: 'Whisper', vesperine: 'Vesperine',
});
const TAGS = Object.freeze(['needs', 'next', 'reply', 'set', 'likes', 'join', 'end']);
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const FACT = /^[a-z][a-z0-9:,._-]{0,119}$/;

const upper = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const partyName = (id) => CALLED[id] || id;

/** A speaker's id when it names a companion ('Tollkeeper', 'The Scribe', 'claude'), else null. */
function companionOf(name) {
  const key = String(name).trim().replace(/^the\s+/i, '').toLowerCase();
  if (COMPANIONS.includes(key)) return key;
  if (Object.hasOwn(ALIASES, key)) return ALIASES[key];
  const first = key.split(/[\s,]/)[0];
  if (first === 'jev') return 'jev';
  return null;
}

/** Whether a speaker's name names Jev in any words ("The Judgebird Jev", "Jev’s voice"): Jev never speaks. */
const namesJev = (name) => /(?:^|[^a-z])(?:jev|judgebird)/i.test(String(name));

// ---------------------------------------------------------------------------
// Requirements: 'with <id>', 'warmth <id> <n>', 'fact <factId>', 'trail <trailId>:<stepId>',
// each optionally followed by its own words in curly quotes.

function factWords(id) {
  if (id.startsWith('note:')) return 'Once you’ve read the right note';
  if (id.startsWith('riddle:')) return 'Once you’ve answered that riddle';
  if (id.startsWith('examined:')) return 'Once you’ve examined one of those';
  if (id.startsWith('glimmer:')) return 'Once you’ve seen that Glimmer';
  return 'Once you know a little more';
}

/** One requirement from its text, or throws. */
export function parseRequirement(text) {
  const m = /^\s*(with|warmth|fact|trail)\s+(\S+)(?:\s+(\d+))?\s*(?:“([^”]+)”)?\s*$/.exec(String(text));
  if (!m) throw new Error(`a requirement is “with <id>”, “warmth <id> <n>”, “fact <id>” or “trail <trail>:<step>”, not “${text}”`);
  const [, kind, id, n, words] = m;
  if (kind === 'warmth' && !n) throw new Error(`warmth needs a number: “${text}”`);
  if ((kind === 'with' || kind === 'warmth') && !COMPANIONS.includes(id)) throw new Error(`no companion called “${id}”`);
  if (kind === 'fact' && !FACT.test(id)) throw new Error(`“${id}” isn’t a fact id`);
  if (kind === 'trail' && !/^[a-z0-9-]+:[a-z0-9-]+$/.test(id)) throw new Error(`a trail requirement is “trail <trail>:<step>”, not “${id}”`);
  let say = words || null;
  if (!say) {
    if (kind === 'with') say = `With ${partyName(id)}`;
    else if (kind === 'warmth') say = `${upper(warmthStep(Number(n)))} warmth with ${partyName(id)}`;
    else if (kind === 'fact') say = factWords(id);
    else say = 'Once you’ve followed the trail that far';
  }
  return { kind, id, n: n ? Number(n) : null, words: upper(say) };
}

/** A comma-separated list of requirements ('' is none). */
export function parseNeeds(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '“') depth += 1;
    if (ch === '”') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  return parts.map(parseRequirement);
}

function partyIds(state, party) {
  if (Array.isArray(party)) return party;
  const chosen = Array.isArray(state?.party?.chosen) ? state.party.chosen : [];
  return ['milo', ...chosen];
}

function hasFact(state, facts, id) {
  if (isRecord(state?.story?.facts) && Object.hasOwn(state.story.facts, id)) return true;
  if (Array.isArray(facts)) return facts.includes(id);
  return isRecord(facts) && Object.hasOwn(facts, id);
}

/** Whether a requirement holds now. */
export function requirementMet(req, state, { party = null, facts = null } = {}) {
  if (req.kind === 'with') return partyIds(state, party).includes(req.id);
  if (req.kind === 'warmth') {
    const member = own(state?.party?.roster, req.id);
    return isRecord(member) && finite(member.warmth) && member.warmth >= req.n;
  }
  if (req.kind === 'fact') return hasFact(state, facts, req.id);
  if (req.kind === 'trail') {
    const [trail, step] = req.id.split(':');
    const done = own(own(state?.story?.trails, trail), 'done');
    return isRecord(done) && Object.hasOwn(done, step);
  }
  return false;
}

// ---------------------------------------------------------------------------
// The talk grammar (§9.10)

function parseError(n, what) {
  return new Error(`talk line ${n}: ${what}`);
}

function parseChoice(body, n, nodeId, index) {
  const firstTag = body.search(/\[[a-z]+[\]:]/);
  const text = (firstTag < 0 ? body : body.slice(0, firstTag)).trim();
  const tags = firstTag < 0 ? '' : body.slice(firstTag);
  if (!text) throw parseError(n, 'a choice needs its words before any tags');
  const choice = { id: `${nodeId}.${index}`, text, needs: [], next: null, reply: null, set: null, likes: null, join: null, end: false };
  const re = /\[(\w+)(?::\s*([^\]]*))?\]/g;
  let m;
  while ((m = re.exec(tags))) {
    const [, tag, raw] = m;
    const value = raw === undefined ? null : raw.trim();
    if (!TAGS.includes(tag)) throw parseError(n, `unknown tag [${tag}]`);
    if (tag === 'end') { if (value) throw parseError(n, '[end] takes no value'); choice.end = true; continue; }
    if (!value) throw parseError(n, `[${tag}] needs a value`);
    try {
      if (tag === 'needs') choice.needs = parseNeeds(value);
      else if (tag === 'next') { if (!ID.test(value)) throw new Error(`“${value}” isn’t a node id`); choice.next = value; }
      else if (tag === 'reply') choice.reply = /^“[^“”]*”$/.test(value) ? value.slice(1, -1) : value;
      else if (tag === 'set') { if (!FACT.test(value)) throw new Error(`“${value}” isn’t a fact id`); choice.set = value; }
      else {
        const id = companionOf(value);
        if (!id) throw new Error(`[${tag}] names no companion: “${value}”`);
        choice[tag] = id;
      }
    } catch (error) {
      throw parseError(n, error.message);
    }
  }
  if (tags.replace(re, '').trim()) throw parseError(n, `stray text among the tags: “${tags.replace(re, '').trim()}”`);
  if (choice.next && choice.end) throw parseError(n, 'a choice goes [next] or [end], not both');
  return choice;
}

/**
 * Parses a talk (content/camp/talks/<id>.md): front matter (id, with, once, optional needs), then
 * `# node` headings, `Speaker: text` lines, `(stage directions)` and `> choices [tags]`. Throws with
 * a line number on anything else, including any line spoken by Jev.
 */
export function parseTalk(text) {
  if (typeof text !== 'string') throw parseError(0, 'a talk is text');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0].trim() !== '---') throw parseError(1, 'a talk starts with front matter between --- lines');
  const front = {};
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== '---'; i += 1) {
    const m = /^(\w+):\s*(.*)$/.exec(lines[i].trim());
    if (!m) throw parseError(i + 1, `front matter lines are “key: value”, not “${lines[i]}”`);
    front[m[1]] = m[2].trim();
  }
  if (i >= lines.length) throw parseError(i, 'the front matter never closes');
  if (!ID.test(front.id || '')) throw parseError(2, 'the front matter needs an id');
  const withId = front.with || 'none';
  if (withId !== 'none' && !COMPANIONS.includes(withId)) throw parseError(2, `“with” names no companion: “${withId}”`);
  if (front.once !== 'true' && front.once !== 'false') throw parseError(2, '“once” is true or false');
  let needs;
  try {
    needs = parseNeeds(front.needs || '');
  } catch (error) {
    throw parseError(2, error.message);
  }
  const nodes = {};
  let start = null;
  let node = null;
  const refs = [];
  for (i += 1; i < lines.length; i += 1) {
    const n = i + 1;
    const raw = lines[i].trim();
    if (!raw) continue;
    let m;
    if ((m = /^#\s+([a-z][a-z0-9-]{0,39})$/.exec(raw))) {
      if (Object.hasOwn(nodes, m[1])) throw parseError(n, `node “${m[1]}” twice`);
      node = { lines: [], choices: [] };
      nodes[m[1]] = node;
      node.id = m[1];
      start ??= m[1];
      continue;
    }
    if (!node) throw parseError(n, 'text before the first # node');
    if (raw.startsWith('>')) {
      const choice = parseChoice(raw.slice(1).trim(), n, node.id, node.choices.length + 1);
      if (choice.next) refs.push([n, choice.next]);
      node.choices.push(choice);
    } else if ((m = /^\((.+)\)$/.exec(raw))) {
      node.lines.push({ speaker: null, text: null, gesture: m[1].trim() });
    } else if ((m = /^([^:()>#[\]]{1,60}):\s+(.+)$/.exec(raw))) {
      const speaker = companionOf(m[1]);
      if (speaker === 'jev' || namesJev(m[1])) throw parseError(n, 'Jev never speaks: write a stage direction in brackets instead');
      node.lines.push({ speaker: speaker || m[1].trim(), text: m[2].trim(), gesture: null });
    } else {
      throw parseError(n, `a line is “Speaker: text”, “(a stage direction)” or “> a choice”, not “${raw}”`);
    }
  }
  if (!start) throw parseError(lines.length, 'a talk needs at least one # node');
  for (const [n, ref] of refs) if (!Object.hasOwn(nodes, ref)) throw parseError(n, `[next: ${ref}] names no node`);
  const out = {};
  for (const [id, { lines: ls, choices }] of Object.entries(nodes)) out[id] = { lines: ls, choices };
  return { id: front.id, with: withId, once: front.once === 'true', needs, start, nodes: out };
}

const choiceNode = (choiceId) => (typeof choiceId === 'string' ? choiceId.slice(0, choiceId.lastIndexOf('.')) : '');

/**
 * What the dialogue box shows at a node (default the start): its lines, and its choices with
 * whether each can be picked and, if not, why in words. `picked` lists choices already answered
 * here (a choice with no next or end returns to its node greyed).
 */
export function talkView(talk, state, { now = 0, party = null, facts = null, node = null, picked = [] } = {}) {
  const at = node && Object.hasOwn(talk.nodes, node) ? node : talk.start;
  const here = talk.nodes[at];
  return {
    node: at,
    lines: here.lines.map((l) => ({ ...l })),
    choices: here.choices.map((c) => {
      const unmet = c.needs.find((r) => !requirementMet(r, state, { party, facts }));
      const done = Array.isArray(picked) && picked.includes(c.id);
      return { id: c.id, text: c.text, needs: c.needs, met: !unmet && !done, why: unmet ? unmet.words : done ? 'You’ve said that one.' : null };
    }),
  };
}

/**
 * Takes a choice: records its fact, pays a liked choice's Cheer (once per talk), applies a join,
 * and says where the talk goes next. A choice whose needs aren't met changes nothing. Never locks:
 * a choice with no next or end returns to its own node. A join passes `content` on to party.recruit,
 * so the trail trails.json ends with them records it. → { state, next, done, liked, reply }
 */
export function chooseLine(talk, state, choiceId, now, { party = null, facts = null, content = null } = {}) {
  const nodeId = choiceNode(choiceId);
  const here = own(talk?.nodes, nodeId);
  const choice = here?.choices.find((c) => c.id === choiceId);
  if (!choice) return { state, next: talk?.start ?? null, done: false, liked: null, reply: null };
  if (choice.needs.some((r) => !requirementMet(r, state, { party, facts }))) return { state, next: nodeId, done: false, liked: null, reply: null };
  let next = state;
  // A's markFact and E's markJoined record nothing at or before the epoch, so a missing `now` (the
  // epoch here, as everywhere in camp.js) is its first millisecond: the fact and the join are kept.
  const at = Math.max(1, instantOf(now));
  if (choice.set) next = markFact(next, choice.set, at);
  let liked = null;
  if (choice.likes) {
    const key = `liked:${talk.id}`;
    const seen = isRecord(next?.party?.seenScenes) ? next.party.seenScenes : {};
    if (!Object.hasOwn(seen, key)) {
      next = addCheer(next, 1, now);
      next = { ...next, party: { ...next.party, seenScenes: { ...(isRecord(next.party.seenScenes) ? next.party.seenScenes : {}), [key]: stamp(now) } } };
      liked = `${upper(partyName(choice.likes))} liked that.`;
    }
  }
  if (choice.join) next = recruit(next, choice.join, at, { content });
  const done = choice.end === true;
  if (done && talk.once) next = sceneSeen(next, `talk:${talk.id}`, now);
  return { state: next, next: done ? null : choice.next ?? nodeId, done, liked, reply: choice.reply };
}

// ---------------------------------------------------------------------------
// The camp's day

function hhmm(text, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

// A missing `now` counts as the epoch, never the wall clock (clean.js's dayNumber would read it).
const instantOf = (now) => (finite(now) ? now : 0);

/** Local minutes past midnight, and the month (1–12). */
function clock(now) {
  const d = new Date(instantOf(now));
  return { minutes: d.getHours() * 60 + d.getMinutes(), month: d.getMonth() + 1 };
}

function partOf(state, now, content) {
  const { minutes, month } = clock(now);
  const sky = isRecord(content?.sky) ? content.sky : {};
  const sun = own(sky.sun, String(month)) || {};
  const rise = hhmm(sun.rise, 7 * 60);
  const set = hhmm(sun.set, 19 * 60);
  const twilight = finite(sky.twilight) ? sky.twilight : 40;
  const bell = hhmm(state?.settings?.eveningBell, 22 * 60);
  const dawnStart = rise - twilight;
  const asleep = bell >= 12 * 60 ? minutes >= bell || minutes < dawnStart : minutes >= bell && minutes < dawnStart;
  if (asleep) return 'asleep';
  if (minutes >= dawnStart && minutes < rise + twilight) return 'dawn';
  if (minutes >= set - twilight && minutes < set + twilight) return 'dusk';
  if (minutes >= rise + twilight && minutes < set - twilight) return 'day';
  const toBell = (bell - minutes + 24 * 60) % (24 * 60);
  return toBell <= 60 ? 'night' : 'evening';
}

/**
 * The camp on the real clock (COMBAT §2.6): the part of the day, where each companion is (Jev on
 * the Watchtower roof, the Tollkeeper at his bridge by day and at the fire from dusk, a busy
 * Wayfarer away at the bench, anyone out with Milo away), and whether the evening bell has rung.
 */
export function campDay(state, now, { content = null, snapshot = null } = {}) {
  const part = partOf(state, now, content);
  const asleep = part === 'asleep';
  const kindle = state?.kindle?.phase;
  const out = isRecord(state?.expedition) && state.expedition.inside === true;
  const chosen = Array.isArray(state?.party?.chosen) ? state.party.chosen : [];
  const roster = isRecord(state?.party?.roster) ? Object.keys(state.party.roster) : ['claude', 'codex', 'jev'];
  const places = [];
  for (const id of roster) {
    if (id === 'milo') continue;
    let where = 'fire';
    let pose = asleep ? 'sleep' : kindle === 'focus' ? 'stand' : part === 'evening' || part === 'night' ? 'talk' : 'sit';
    if (out && chosen.includes(id)) { where = 'away'; pose = 'stand'; }
    else if (id === 'jev') where = 'tower';
    else if (id === 'lumi') where = asleep || part === 'night' ? 'roof' : 'bedroll';
    else if (id === 'tollkeeper' && (part === 'dawn' || part === 'day')) { where = 'bridge'; pose = 'stand'; }
    else if ((id === 'claude' || id === 'codex') && crewStateOf(snapshot, id) === 'working') { where = 'away'; pose = 'stand'; }
    else if (asleep) where = 'bedroll';
    places.push({ id, where, pose });
  }
  return { part, places, bell: asleep };
}

function sceneLines(scene, regular = null) {
  return (scene.lines || []).map((l) => ({
    speaker: l.speaker === 'regular' && regular ? regular.id : l.speaker ?? null,
    text: l.text ?? null,
    gesture: l.gesture ?? null,
  }));
}

/** Marks a scene (or a finished once-only talk, 'talk:<id>') as seen, so it doesn't play again. */
export function sceneSeen(state, sceneId, now) {
  if (!isRecord(state) || typeof sceneId !== 'string' || !/^[a-z][a-z0-9:,._-]{0,63}$/.test(sceneId)) return state;
  const party = isRecord(state.party) ? state.party : {};
  const seen = isRecord(party.seenScenes) ? party.seenScenes : {};
  if (Object.hasOwn(seen, sceneId)) return state;
  return { ...state, party: { ...party, seenScenes: { ...seen, [sceneId]: stamp(now) } } };
}

const WHEN_PARTS = Object.freeze({ night: ['evening', 'night'], dawn: ['dawn'] });

/**
 * The next scene to play at camp: an arrival not yet seen (for each named companion on the roster,
 * and for each regular), else a camp scene whose needs are met at its time of day (each companion's
 * own opens at Acquaintance). Nothing plays once the camp is asleep. Rain scenes need { weather: 'rain' }.
 */
export function nextScene(state, now, { content = null, weather = null } = {}) {
  const scenes = Array.isArray(content?.camp?.scenes?.scenes) ? content.camp.scenes.scenes : [];
  const seen = isRecord(state?.party?.seenScenes) ? state.party.seenScenes : {};
  const roster = isRecord(state?.party?.roster) ? state.party.roster : {};
  const has = (id) => Object.hasOwn(roster, id) || ['milo', 'claude', 'codex', 'jev'].includes(id);
  const part = partOf(state, now, content);
  if (part === 'asleep') return null;
  for (const scene of scenes) {
    if (scene.when !== 'arrival') continue;
    if (scene.who === 'regular') {
      for (const regular of Array.isArray(state?.party?.regulars) ? state.party.regulars : []) {
        const id = `${scene.id}:${regular.id}`;
        if (!Object.hasOwn(seen, id)) return { id, when: 'arrival', who: regular.id, lines: sceneLines(scene, regular), needs: [] };
      }
    } else if (has(scene.who) && !Object.hasOwn(seen, scene.id)) {
      return { id: scene.id, when: 'arrival', who: scene.who, lines: sceneLines(scene), needs: parseNeeds(scene.needs) };
    }
  }
  for (const scene of scenes) {
    if (scene.when === 'arrival' || Object.hasOwn(seen, scene.id) || !has(scene.who)) continue;
    const timely = scene.when === 'rain' ? weather === 'rain' : (WHEN_PARTS[scene.when] || []).includes(part);
    if (!timely) continue;
    const needs = parseNeeds(scene.needs);
    if (needs.every((r) => requirementMet(r, state))) return { id: scene.id, when: scene.when, who: scene.who, lines: sceneLines(scene), needs };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Teaching at the fire

/** The night a moment belongs to: before 6 in the morning still counts as the evening before. */
const nightOf = (now) => dayNumber(instantOf(now) - 6 * HOUR);

/** Once a real night, one companion can teach another a habit at the fire. */
export function canTeach(state, now) {
  return isRecord(state) && state?.party?.teachDay !== nightOf(now);
}

/** Records tonight's lesson (the shell appends the habit's notes to `to`'s notebook file). */
export function markTaught(state, from, to, habitKey, now) {
  if (!canTeach(state, now) || from === to || typeof habitKey !== 'string' || !/^\d{1,3}:\d{1,5}$/.test(habitKey)) return state;
  const roster = isRecord(state.party?.roster) ? state.party.roster : {};
  const present = (id) => Object.hasOwn(roster, id) || ['milo', 'claude', 'codex', 'jev'].includes(id);
  if (!present(from) || !present(to)) return state;
  return { ...state, party: { ...state.party, teachDay: nightOf(now) } };
}
