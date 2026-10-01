// Examine on everything (CONTRACT-PHASE4.md §9.12, §12.4 K1; COMBAT.md §15; PLAN.md §2): which
// lines an entity reads from, the line itself, and the note bubble an Examine opens. Pure but for
// examineEntity and mount, which reach the shell only through `shell`.
//
// examineKey follows §9.12's table exactly, with E's settled reading of it (reports/E.md): an
// entry that's a list is its lines; an entry with variants gives the variant's lines, or when
// there's no variant (or none of that name) its first variant's. A wild point of interest reads
// Phase 3's own wilds.examine, unchanged; a combatant reads describe.examineLine once it's known
// (an ally, or a foe the party has Examined, the 1-action Examine of CONTRACT §4.4), and before
// that only what anyone can see. The same thing always says the same line (wildtext.pickLine, by
// its id).
import { pickLine } from './wildtext.js';
import { examineLine as combatantLine } from '../combat/describe.js';
import { skyAt } from '../sky.js';
import { markFact } from '../state4.js';
import { PLACES } from '../world/map.js';

export const id = 'examine';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value) => (typeof value === 'string' ? value : '');
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The camp's own things (examine.json `camp`); every other vale place kind reads `vale`. */
export const CAMP_KINDS = Object.freeze(['camp', 'campfire', 'hook', 'tent', 'cabin', 'bench', 'stump', 'workbench', 'woodpile',
  'bedroll', 'handcart', 'tea', 'paper-lantern']);
/** The vale's other place kinds (examine.json `vale`). */
export const VALE_KINDS = Object.freeze(['watchtower', 'townhall', 'plot', 'building', 'gate', 'war-table', 'bell', 'fog', 'pond', 'well', 'statue']);
/** Company members with lines of their own; a regular (`reg-…`) reads `company.regular`. */
export const COMPANY_IDS = Object.freeze(['milo', 'claude', 'codex', 'ollama', 'jev', 'whisper', 'tollkeeper']);
/** Stray archetypes (examine.json `creatures`). */
export const ARCHETYPE_IDS = Object.freeze(['walker', 'crawler', 'floater', 'flier', 'ghost', 'construct']);
/** Weather kinds (examine.json `sky`, sky.js WEATHER_KINDS). */
export const WEATHER_IDS = Object.freeze(['clear', 'rain', 'snow', 'mist', 'wind', 'leaves']);
const DAYPARTS = Object.freeze(['dawn', 'day', 'dusk', 'night']);
const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
/** Things inside an Elsewhere or a cave that read `elsewhere` by their own kind. */
const ELSEWHERE_KINDS = Object.freeze(['stitch', 'exit', 'curio', 'nook', 'rift', 'echo']);

/** A line for anything with no lines of its own (never shown for an entity in §9.12's table). */
export const FALLBACK_LINE = 'Nothing about it stands out.';
/** What a free look at a foe nobody has Examined yet adds (Examine in a fight is an action, §4.4). */
export const UNEXAMINED_LINE = 'Its resistances and weaknesses show once someone examines it.';

// Names for the places the shell lists beside the vale's own (src/world/map.js PLACES).
const PLACE_NAMES = Object.freeze({ hearth: 'The Hearth', 'war-table': 'The War Table', bell: 'The bell' });
/** A vale place's name by its id ('watchtower' → 'Watchtower', 'camp' → 'Milo’s camp'), or ''. */
export function placeName(placeId) {
  const idOf = str(placeId);
  if (Object.hasOwn(PLACE_NAMES, idOf)) return PLACE_NAMES[idOf];
  const place = PLACES.find((p) => p.id === idOf);
  return place ? String(place.name).replace(/'/g, '’') : '';
}

/** A felled tree: the engine's `felled`, or a stump by its label (as Phase 3's click reads it). */
const isStump = (entity) => entity.kind === 'tree' && (entity.felled === true || /stump/i.test(str(entity.label)));

// The vale's place ids (src/world/map.js PLACES) by their kind, and the places the shell lists
// beside them (the Hearth is the camp's hook, the War Table and the gates have kinds of their own).
const PLACE_KIND = Object.freeze({ camp: 'camp', watchtower: 'watchtower', harbor: 'fog', hearth: 'hook', 'war-table': 'war-table', bell: 'bell' });

/** The kind of a vale place: the entity's own `placeKind`, else its id's. */
function placeKindOf(entity) {
  const given = str(entity.placeKind) || str(entity.place?.kind);
  if (given) return given;
  const id = str(entity.id);
  if (Object.hasOwn(PLACE_KIND, id)) return PLACE_KIND[id];
  if (/^plot-/.test(id)) return entity.built || entity.building ? 'building' : 'plot';
  if (/^gate:/.test(id)) return 'gate';
  return id;
}

/** A company member's lines: the member id, or `regular` for a regular (`reg-…`). */
function memberKey(memberId) {
  const idOf = str(memberId).replace(/^party:/, '').replace(/^landmark:/, '');
  if (/^reg-/.test(idOf)) return 'regular';
  return idOf || 'milo';
}

/** The object stem for a tree, rock or bush: 'tree.birch' → 'birch', 'pine.snow' → 'pine', 'tree.blossom' → 'tree'. */
export function objectStem(kind, look) {
  const sprite = str(look).toLowerCase();
  if (/^pine\b|^pine\./.test(sprite)) return 'pine';
  if (/birch/.test(sprite)) return 'birch';
  if (/^rock\b|^rock\./.test(sprite)) return 'rock';
  if (/^bush\b|^bush\./.test(sprite)) return 'bush';
  return ['tree', 'rock', 'bush', 'pine', 'birch'].includes(kind) ? kind : 'tree';
}

/** A tree's lines by the engine's `wood` (wilds.js WOOD: an ash or blossom tree is 'ash'). */
const WOOD_STEM = Object.freeze({ ash: 'tree', birch: 'birch', pine: 'pine' });

/**
 * Which of wilds' tree, pine, birch, rock or bush lines a thing reads: a sprite kind when the
 * entity carries one (`look`, `sprite`, `object`), else a tree's `wood` (the engine's tree
 * entities carry only `{ kind: 'tree', id, label: 'Pine · chop', wood: 'pine', felled }`), else
 * the words of its label ('Snowy pine · chop' → 'pine'), else its kind.
 */
function stemOf(entity, kind) {
  const look = str(entity.look) || str(entity.sprite) || str(entity.object);
  if (look) return objectStem(kind, look);
  if (kind === 'tree') {
    const wood = str(entity.wood).toLowerCase();
    if (Object.hasOwn(WOOD_STEM, wood)) return WOOD_STEM[wood];
    const label = str(entity.label).toLowerCase();
    if (/\bpine\b/.test(label)) return 'pine';
    if (/\bbirch\b/.test(label)) return 'birch';
  }
  return objectStem(kind, '');
}

/** A tree's label without the click's verb: 'Pine · chop' → 'Pine'. */
const treeTitle = (label) => label.replace(/\s*·\s*chop$/i, '');

/**
 * Whether a chest has been opened: a wild chest (`poi`) or an Elsewhere's (`loot`). It's opened
 * when the entity says so (`opened: true`), when the engine's label says so (both wilds.js and
 * scene-elsewhere.js call an opened chest "An open chest", and the Elsewhere's carries nothing
 * else), or when its id is among `opened` (state.wilds.opened: a record by id, a Set or a list).
 */
export function chestOpened(entity, opened = null) {
  if (!isRecord(entity)) return false;
  if (entity.opened === true) return true;
  if (/^an open chest\b/i.test(str(entity.label).trim())) return true;
  const idOf = str(entity.id);
  if (!idOf || opened == null) return false;
  if (opened instanceof Set) return opened.has(idOf);
  if (Array.isArray(opened)) return opened.includes(idOf);
  return isRecord(opened) && Object.hasOwn(opened, idOf) && opened[idOf] != null;
}

const skyOf = (options) => {
  if (isRecord(options.sky) && typeof options.sky.daypart === 'string') return options.sky;
  if (finite(options.now)) {
    const seed = isRecord(options.state?.wilds) && typeof options.state.wilds.seed === 'string' ? options.state.wilds.seed : undefined;
    return skyAt(options.now, { seed, sky: options.content?.sky ?? null });
  }
  return null;
};

const wildsSaved = (state) => (isRecord(state) && isRecord(state.wilds) ? state.wilds : {});
const has = (map, key) => isRecord(map) && Object.hasOwn(map, key) && map[key] != null;

/** The stray's archetype and temperament, wherever the entity carries them. */
function strayOf(entity) {
  const stray = isRecord(entity.stray) ? entity.stray : isRecord(entity.spec) ? entity.spec : {};
  return {
    archetype: str(entity.archetype) || str(stray.archetype),
    temperament: str(entity.temperament) || str(stray.temperament),
    genre: str(entity.genre) || str(stray.genre),
    foe: str(entity.foe) || str(entity.foeId) || str(stray.foe),
  };
}

/**
 * Which lines an entity reads (§9.12's table): { group, id, variant } (variant null when none
 * applies), or null for a combatant (`cb:<id>`, read by describe.examineLine). `options`: { sky
 * (a sky.js Sky), now, state, content } pick the variant: the sky's weather and daypart, a lantern
 * lit or a chest opened in `state.wilds`, a tree's season.
 */
export function examineKey(entity, options = {}) {
  if (!isRecord(entity)) return null;
  const kind = str(entity.kind);
  const entityId = str(entity.id);
  if (kind === 'combatant' || /^cb:/.test(entityId)) return null;
  const opts = isRecord(options) ? options : {};
  const key = (group, idOf, variant = null) => ({ group, id: idOf, variant });
  const saved = wildsSaved(opts.state);

  // The Company: Milo, a crew member, a follower, the Tollkeeper.
  if (kind === 'milo') return key('company', 'milo');
  if (kind === 'crew' || kind === 'party' || kind === 'follower' || kind === 'member') return key('company', memberKey(entity.member || entityId));
  if (kind === 'tollkeeper' || entityId === 'landmark:tollkeeper') return key('company', 'tollkeeper');
  if (/^party:/.test(entityId)) return key('company', memberKey(entityId));

  // Landmarks and unique things.
  if (kind === 'last-bridge' || entityId === 'landmark:last-bridge') return key('things', 'last-bridge', entity.dry === true ? 'opened' : 'sleeping');
  if (kind === 'hooklight') return key('things', 'hooklight');
  if (kind === 'riddle-note') return key('things', 'riddle-note');

  // The vale and the camp.
  if (kind === 'place') {
    const placeKind = placeKindOf(entity);
    return key(CAMP_KINDS.includes(placeKind) ? 'camp' : 'vale', placeKind);
  }
  if (kind === 'gate') return key('vale', 'gate');
  if (kind === 'war-table') return key('vale', 'war-table');
  if (CAMP_KINDS.includes(kind)) return key('camp', kind);
  if (VALE_KINDS.includes(kind)) return key('vale', kind);

  // The wilds.
  if (kind === 'lantern') return key('wilds', 'lantern', entity.lit === true || has(saved.lanterns, entityId) ? 'lit' : null);
  // A felled tree is a stump, and reads Phase 3's stump lines, as its left click does.
  if (isStump(entity)) return key('poi', 'stump');
  if (kind === 'tree' || kind === 'rock' || kind === 'bush') {
    const stem = stemOf(entity, kind);
    const sky = stem === 'tree' ? skyOf(opts) : null;
    return key('wilds', stem, sky && SEASONS.includes(sky.season) ? sky.season : null);
  }
  if (kind === 'poi') {
    const type = str(entity.poiType) || str(entity.type) || (/^poi:([a-z]+):/.exec(entityId) || [])[1] || '';
    if (type === 'chest') return key('poi', 'chest', chestOpened(entity, saved.opened) ? 'opened' : null);
    if (type === 'ruin') return key('poi', 'ruin', entity.opened === true || has(saved.opened, entityId) ? 'opened' : null);
    if (type === 'landmark' && /westwatch/i.test(str(entity.label) || str(entity.name))) {
      const sky = skyOf(opts);
      return key('poi', 'westwatch', sky ? (sky.night ? 'night' : 'day') : null);
    }
    return key('poi', type || 'landmark');
  }

  // Strays, posts and foes.
  if (kind === 'tale-lead' || kind === 'field-boss' || /^stray:[^:]+(?::[^:]+)?:lead$/.test(entityId)) return key('foes', 'tale-lead');
  if (kind === 'stray' || kind === 'encounter' || kind === 'post' || kind === 'foe' || /^enc:/.test(entityId)) {
    const stray = strayOf(entity);
    if (stray.foe) return key('foes', stray.foe);
    if (kind === 'foe') return key('foes', entityId.replace(/^foe:/, ''));
    const sleeping = entity.sleeping === true || stray.temperament === 'sleepy';
    return key('creatures', ARCHETYPE_IDS.includes(stray.archetype) ? stray.archetype : 'walker', sleeping ? 'sleeping' : null);
  }

  // Inside an Elsewhere or a cave.
  if (kind === 'loot' || kind === 'chest') return key('elsewhere', 'chest', chestOpened(entity, saved.opened) ? 'opened' : null);
  if (ELSEWHERE_KINDS.includes(kind)) return key('elsewhere', kind);

  // Empty ground: the sky, by its weather, with the daypart as the variant (E's settled reading).
  if (kind === 'ground' || kind === 'sky' || kind === 'tile' || !kind) {
    const sky = skyOf(opts);
    const weather = sky && WEATHER_IDS.includes(sky.weather?.kind) ? sky.weather.kind : 'clear';
    return key('sky', weather, sky && DAYPARTS.includes(sky.daypart) ? sky.daypart : null);
  }
  return null;
}

// Phase 3's wilds.examine names for a point of interest's state.
const POI_VARIANT = Object.freeze({ chest: { opened: 'chestOpened' }, ruin: { opened: 'ruinSearched' } });

/** The lines a key resolves to, from the content bundle (examine.json, and wilds.json for `poi`). */
export function linesFor(key, content) {
  if (!isRecord(key)) return [];
  const bundle = isRecord(content) ? content : {};
  const listOf = (value) => (Array.isArray(value) ? value.filter((line) => typeof line === 'string' && line.trim()) : []);
  if (key.group === 'poi') {
    const table = isRecord(bundle.wilds) && isRecord(bundle.wilds.examine) ? bundle.wilds.examine : {};
    const named = key.variant && POI_VARIANT[key.id]?.[key.variant];
    const entry = named ? table[named] : table[key.id];
    if (Array.isArray(entry)) return listOf(entry);
    if (isRecord(entry)) return listOf(entry[key.variant] || Object.values(entry)[0]);
    return [];
  }
  const groups = isRecord(bundle.examine) && isRecord(bundle.examine.groups) ? bundle.examine.groups : {};
  const group = isRecord(groups[key.group]) ? groups[key.group] : {};
  const entry = Object.hasOwn(group, key.id) ? group[key.id] : null;
  if (Array.isArray(entry)) return listOf(entry);
  if (isRecord(entry)) return listOf((key.variant && entry[key.variant]) || Object.values(entry)[0]);
  return [];
}

/** A combatant's unit id: 'cb:pip' → 'pip'. */
const unitIdOf = (entity) => str(entity.unitId) || str(entity.id).replace(/^cb:/, '');

/** Whether the party knows a combatant's numbers: an ally, or a foe someone has Examined this fight. */
export function combatantKnown(unit) {
  return isRecord(unit) && (unit.side === 'party' || unit.examined === true);
}

/**
 * A free look at a combatant nobody has Examined: what its kind looks like (its creature's, canon
 * foe's or the Tale-lead's lines, never the sleeping variant, since temperament is Examine's to
 * tell), then UNEXAMINED_LINE.
 */
function lookLine(battle, unit, content) {
  const keys = [];
  if (unit.rank === 'lead' || unit.lead) keys.push({ group: 'foes', id: 'tale-lead', variant: null });
  // A canon foe's kind is its foes.json id; a cave creature's is its talkKind (§5.2).
  for (const idOf of [str(unit.kind), str(unit.talkKind)]) if (idOf) keys.push({ group: 'foes', id: idOf, variant: null });
  if (ARCHETYPE_IDS.includes(unit.archetype)) keys.push({ group: 'creatures', id: unit.archetype, variant: null });
  const pool = keys.map((key) => linesFor(key, content)).find((lines) => lines.length) || [];
  const look = pickLine(pool, `${str(battle?.id)}:${str(unit.id)}`);
  return look ? `${look} ${UNEXAMINED_LINE}` : UNEXAMINED_LINE;
}

/**
 * The Examine line for an entity. `options`: { content (the bundle), state, now, sky, battle }.
 * A combatant reads describe.examineLine(battle, unitId) once combatantKnown, else lookLine;
 * everything else a line from its key's list, picked by the entity's id so the same thing always
 * says the same.
 */
export function examineLine(entity, options = {}) {
  if (!isRecord(entity)) return FALLBACK_LINE;
  const opts = isRecord(options) ? options : {};
  if (entity.kind === 'combatant' || /^cb:/.test(str(entity.id))) {
    const unitId = unitIdOf(entity);
    const unit = Array.isArray(opts.battle?.units) ? opts.battle.units.find((u) => isRecord(u) && u.id === unitId) : null;
    if (!unit) return FALLBACK_LINE;
    if (!combatantKnown(unit)) return lookLine(opts.battle, unit, opts.content);
    return combatantLine(opts.battle, unitId) || FALLBACK_LINE;
  }
  const key = examineKey(entity, opts);
  const pool = linesFor(key, opts.content);
  const pickBy = str(entity.id) || (key ? `${key.group}:${key.id}` : 'examine');
  return pickLine(pool, pickBy) || FALLBACK_LINE;
}

// Bubble titles by kind, when the entity has no label of its own. No full stops (bubble titles).
const TITLES = Object.freeze({
  milo: 'Milo', lantern: 'A lantern', tree: 'A tree', rock: 'A rock', bush: 'A bush', rift: 'A rift', echo: 'An echo',
  stray: 'A stray', 'tale-lead': 'The Tale-lead', stitch: 'The tear', exit: 'The way out', loot: 'A chest', chest: 'A chest',
  curio: 'A curio', nook: 'A nook', ground: 'Looking up', sky: 'Looking up', gate: 'A gate', 'war-table': 'The War Table',
  hooklight: 'The Hooklight', 'riddle-note': 'A Riddle Note', 'last-bridge': 'The Last Bridge', tollkeeper: 'The Tollkeeper',
});

/** The note bubble's title: the entity's own label, else a vale place's name, else its kind's. */
export function examineTitle(entity) {
  let label = isRecord(entity) ? str(entity.label).trim() || (entity.kind === 'place' ? placeName(entity.id) : '') : '';
  if (label && entity.kind === 'tree') label = treeTitle(label);
  if (label) {
    const clipped = label.length > 48 ? `${label.slice(0, 47).trimEnd()}…` : label;
    return (clipped.charAt(0).toUpperCase() + clipped.slice(1)).replace(/[.]+$/, '');
  }
  const kind = isRecord(entity) ? str(entity.kind) : '';
  if (isRecord(entity) && isStump(entity)) return 'A stump';
  return TITLES[kind] || 'A closer look';
}

/** Whether an entity is a field boss Chris can Challenge from its Examine (COMBAT §2): never mid-fight. */
const challengeable = (entity, extra) => entity.fieldBoss === true && !extra?.battle && extra?.combat !== true;

/** The fact an Examine records (§8.2): 'examined:<genre>:<archetype>' for a stray that carries both, else null. */
export function examinedFact(entity) {
  if (!isRecord(entity)) return null;
  const stray = strayOf(entity);
  const slug = /^[a-z][a-z0-9-]{0,24}$/;
  return slug.test(stray.genre) && slug.test(stray.archetype) ? `examined:${stray.genre}:${stray.archetype}` : null;
}

// Who wants to hear about Examines (L2 wires trail.stepDone({ kind: 'examine', target }) here).
const listeners = new Set();

/**
 * Called with { entity, key, line, target } after every Examine; → an off function. `target` is
 * what a trail step names: the entity's id ('war-table', 'gate:n', 'landmark:tollkeeper', a vale
 * place id), or its place id when it has one.
 */
export function onExamine(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The id a trail's `examine` step compares with. */
export function examineTarget(entity) {
  if (!isRecord(entity)) return null;
  const place = str(entity.place) || (isRecord(entity.place) ? str(entity.place.id) : '');
  return place || str(entity.id) || null;
}

/**
 * Examines an entity through the shell: a `note` bubble with its line (and so a Log line), the
 * `examine` feature's first use, the `examined:` fact for a stray, and every onExamine listener.
 * `extra`: { battle } for a combatant, { combat } while a fight is on. A field boss's bubble
 * (outside a fight) carries a **Challenge** action (id 'challenge', with `challenge: entity.id`
 * on the message), COMBAT §2: the shell's bubble handler starts the Challenge.
 * → the line, or '' when nothing could be said.
 */
export function examineEntity(shell, entity, extra = {}) {
  try {
    if (!shell || !isRecord(entity)) return '';
    const content = typeof shell.content === 'function' ? shell.content() : null;
    const now = typeof shell.now === 'function' ? shell.now() : null;
    const state = shell.state;
    const line = examineLine(entity, { content, state, now, battle: extra?.battle ?? null });
    const key = examineKey(entity, { content, state, now });
    const bubble = { kind: 'note', title: examineTitle(entity), lines: [line], duration: 7000 };
    if (challengeable(entity, extra)) {
      Object.assign(bubble, { duration: 12000, challenge: str(entity.id), actions: [{ id: 'challenge', label: 'Challenge' }, { id: 'later', label: 'Not now' }] });
    }
    if (typeof shell.bubble === 'function') shell.bubble(bubble);
    if (typeof shell.feature === 'function') shell.feature('examine');
    const fact = examinedFact(entity);
    if (fact && finite(now) && typeof shell.set === 'function') {
      const next = markFact(shell.state, fact, now);
      if (next !== shell.state) shell.set(next);
    }
    const payload = { entity, key, line, target: examineTarget(entity) };
    for (const fn of [...listeners]) {
      try { fn(payload); } catch (err) { console.error('[MILO] examine listener', err); }
    }
    return line;
  } catch (err) {
    console.error('[MILO] examine', err);
    return '';
  }
}

/**
 * Examine has no container of its own: its handle examines through the shell. → { dispose(),
 * refresh(), examine(entity, extra) }.
 */
export function mount(shell) {
  let live = Boolean(shell);
  return {
    dispose() { live = false; },
    refresh() {},
    examine(entity, extra) { return live ? examineEntity(shell, entity, extra) : ''; },
  };
}
