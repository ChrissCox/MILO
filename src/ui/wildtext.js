// What the wilds say and give (CONTRACT-PHASE3 §8, §12): examine lines picked by the place's id,
// so the same place always says the same thing; chest and ruin loot rolled from content ranges,
// seeded by id; chopping; notes, statues, lanterns and landmarks. Pure ESM, runs in Node.
import { hashString, hashInts } from '../world/rng.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const lines = (value) => (Array.isArray(value) ? value.filter((line) => typeof line === 'string' && line.trim()) : []);
const unit = (hash) => (hash >>> 0) / 4294967296;

export const MATERIALS = Object.freeze(['birch', 'ash', 'pine']);
/** Logs from one felled tree: birch trees 4–7 birch, forest trees 3–5 ash, pines 2–4 pine. */
export const LOG_RANGES = Object.freeze({ birch: [4, 7], ash: [3, 5], pine: [2, 4] });
const CHUNK = 32;

/** A line from `list`, picked by hashString(id) (and a salt, so two lists at one place can differ). */
export function pickLine(list, id, salt = '') {
  const pool = lines(list);
  if (!pool.length) return '';
  return pool[hashString(`${salt}${id}`) % pool.length];
}

/** An inclusive whole number in [lo, hi], seeded. */
export function rollRange(range, seed) {
  if (!Array.isArray(range) || range.length < 2) return 0;
  const lo = Math.max(0, Math.floor(Number(range[0]) || 0));
  const hi = Math.max(lo, Math.floor(Number(range[1]) || 0));
  return lo + (hashInts(seed >>> 0, lo, hi) % (hi - lo + 1));
}

/** True with probability p, seeded by the id (the same place always gives the same answer). */
export function chanceFor(id, p, salt = 'chance') {
  const odds = Number(p);
  if (!Number.isFinite(odds) || odds <= 0) return false;
  return unit(hashString(`${salt}:${id}`)) < odds;
}

/** Materials from a loot table ({ birch: [8, 20], … }) seeded by the place's id: { birch: 12, ash: 4 } (no zeros). */
export function lootFor(id, table, salt = 'loot') {
  const out = {};
  if (!isRecord(table)) return out;
  for (const material of MATERIALS) {
    const amount = rollRange(table[material], hashString(`${salt}:${material}:${id}`));
    if (amount > 0) out[material] = amount;
  }
  return out;
}

/** ['12 birch', '4 ash']: each material found, for a longer list of finds. */
export function materialItems(materials) {
  return MATERIALS.filter((m) => (materials?.[m] || 0) > 0).map((m) => `${materials[m]} ${m}`);
}

/** '12 birch and 4 ash' */
export function materialsText(materials) {
  return listWords(materialItems(materials));
}

/** 'a, b and c' */
export function listWords(items) {
  const parts = (Array.isArray(items) ? items : []).filter(Boolean);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * A rift's loot in words: essences in lower case with their count ('glitch pearl × 2'), relics by
 * their own names. At most `max` of them.
 */
export function lootItems(loot, max = 3) {
  return (Array.isArray(loot) ? loot : []).filter((item) => item && typeof item.item === 'string' && item.item)
    .slice(0, max)
    .map((item) => (item.relic ? item.item : `${item.item.charAt(0).toLowerCase()}${item.item.slice(1)} × ${item.qty}`));
}

/** '+12 birch · +4 ash', for the small drifting text over the spot. */
export function floatWords(materials) {
  return MATERIALS.filter((m) => (materials?.[m] || 0) > 0).map((m) => `+${materials[m]} ${m}`).join(' · ');
}

/** Which log a tree gives, from its sprite kind or the engine's word. */
export function woodOf(kind) {
  if (kind === 'birch' || kind === 'tree.birch') return 'birch';
  if (kind === 'pine' || kind === 'pine.snow') return 'pine';
  return 'ash';
}

/** Logs from chopping a tree today: { kind, amount }, the same all day for the same tree. */
export function chopLogs(treeId, kind, day) {
  const wood = woodOf(kind);
  return { kind: wood, amount: rollRange(LOG_RANGES[wood], hashString(`chop:${treeId}:${day}`)) };
}

// ---------------------------------------------------------------------------
// Ids and places.

/** 'lantern:12,-18' → { kind: 'lantern', type: 'lantern', x: 12, y: -18 }; 'poi:chest:1,-26' → { kind: 'poi', type: 'chest', … }. */
export function parseId(id) {
  if (typeof id !== 'string') return null;
  let match = /^lantern:(-?\d+),(-?\d+)$/.exec(id);
  if (match) return { kind: 'lantern', type: 'lantern', x: Number(match[1]), y: Number(match[2]) };
  match = /^poi:([a-z]+):(-?\d+),(-?\d+)$/.exec(id);
  if (match) return { kind: 'poi', type: match[1], x: Number(match[2]), y: Number(match[3]) };
  match = /^tree:(-?\d+),(-?\d+)$/.exec(id);
  if (match) return { kind: 'tree', type: 'tree', x: Number(match[1]), y: Number(match[2]) };
  return null;
}

const floorDiv = (a, b) => Math.floor(a / b);

/** The 3×3 chunk keys around a tile, for a map tablet. */
export function tabletKeys(x, y) {
  const cx = floorDiv(x, CHUNK);
  const cy = floorDiv(y, CHUNK);
  const out = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) out.push(`${cx + dx},${cy + dy}`);
  return out;
}

/** The chunk key for a tile. */
export const chunkKeyOf = (x, y) => `${floorDiv(x, CHUNK)},${floorDiv(y, CHUNK)}`;

const has = (map, id) => isRecord(map) && Object.hasOwn(map, id) && map[id] != null;

/** A note for a note place: one of its region's notes when it's in a region, else one of the roads'. */
export function noteFor(id, wilds, regionId = null) {
  const notes = Array.isArray(wilds?.notes) ? wilds.notes.filter((n) => isRecord(n) && typeof n.text === 'string') : [];
  if (!notes.length) return null;
  const regional = regionId ? notes.filter((n) => n.region === regionId) : [];
  const pool = regional.length ? regional : notes.filter((n) => !n.region);
  const list = pool.length ? pool : notes;
  return list[hashString(`note:${id}`) % list.length];
}

/** A statue's missing piece and Glimmer: { missing, glimmer, text } or null. */
export function statueFor(regionId, wilds) {
  const entry = isRecord(wilds?.statues) ? wilds.statues[regionId] : null;
  if (!isRecord(entry)) return null;
  const missing = typeof entry.missing === 'string' ? entry.missing : '';
  return { missing, glimmer: entry.glimmer || '', text: missing ? `It’s missing ${missing}.` : '' };
}

/** A stray kind by its actor index (riftfx lays out up to two of each kind, five at most). */
export function strayOf(spec, n) {
  const wanted = [];
  for (const kind of Array.isArray(spec?.strays) ? spec.strays : []) {
    for (let i = 0; i < Math.min(2, Math.max(0, kind.count | 0)); i += 1) wanted.push(kind);
  }
  return wanted.slice(0, 5)[n] || null;
}

/**
 * How a place in the wilds looks in its panel.
 * → { title, lines: string[], body?: { kind: 'note' | 'glimmer' | 'greeting', from?, text }, action: { id, label } | null, done, later: string }
 * `poi` is the wilds point of interest ({ id, type, x, y, name, region?, mimic?, note? }).
 * `state.wilds` says what's been opened, read and heard. `night` picks the Westwatch's night lines.
 * `fresh`: Milo has only just opened or searched it, so the lines for coming back to it wait.
 */
export function poiView(poi, content, state, { regionId = null, night = false, fresh = false } = {}) {
  const wilds = isRecord(content) ? content : {};
  const examine = isRecord(wilds.examine) ? wilds.examine : {};
  const later = isRecord(wilds.notes_later) ? wilds.notes_later : {};
  const saved = isRecord(state?.wilds) ? state.wilds : {};
  const id = poi?.id || '';
  const type = poi?.type || '';
  const region = poi?.region || regionId || null;
  const out = { title: poi?.name || 'Something in the wilds', lines: [], body: null, action: null, done: false, later: '' };
  const say = (list, salt) => { const line = pickLine(list, id, salt); if (line) out.lines.push(line); };
  switch (type) {
    case 'chest':
      if (has(saved.opened, id)) { out.done = true; if (!fresh) say(examine.chestOpened); out.title = 'An open chest'; }
      else { say(examine.chest); out.action = { id: 'open', label: 'Open it' }; }
      break;
    case 'ruin':
      if (has(saved.opened, id)) { out.done = true; if (!fresh) say(examine.ruinSearched); }
      else { say(examine.ruin); out.action = { id: 'search', label: 'Search' }; }
      break;
    case 'note': {
      if (has(saved.notes, id)) {
        out.done = true;
        const note = noteFor(id, wilds, region);
        if (note) out.body = { kind: 'note', from: note.from, text: note.text };
      } else {
        say(examine.note);
        out.action = { id: 'read', label: 'Read' };
      }
      break;
    }
    case 'statue': {
      const statue = statueFor(region, wilds);
      if (has(saved.glimmers, id) && statue) {
        out.done = true;
        out.lines.push(statue.text);
        out.body = { kind: 'glimmer', text: statue.glimmer };
      } else {
        say(examine.statue);
        if (statue?.text) out.lines.push(statue.text);
        out.action = statue ? { id: 'listen', label: 'Listen' } : null;
      }
      break;
    }
    case 'cave':
      say(examine.cave);
      out.later = later.cave || '';
      break;
    case 'hamlet': {
      say(examine.hamlet);
      const greeting = pickLine(wilds.hamlets?.greetings, id, 'greet');
      if (greeting) out.body = { kind: 'greeting', text: greeting };
      break;
    }
    case 'ore':
    case 'herbs':
    case 'fishing':
      say(examine[type]);
      out.later = later.gathering || '';
      break;
    case 'quay':
      say(examine.quay);
      out.later = later.ferry || '';
      break;
    case 'landmark': {
      const words = region && isRecord(wilds.regions) ? wilds.regions[region] : null;
      if (isRecord(words)) {
        if (words.arrive) out.lines.push(words.arrive);
        if (words.hush) out.lines.push(words.hush);
      } else if (isRecord(examine.westwatch) && /westwatch/i.test(out.title)) {
        say(night ? examine.westwatch.night : examine.westwatch.day);
      } else {
        say(examine.landmark);
      }
      break;
    }
    default:
      say(examine[type]);
      break;
  }
  return out;
}

/** A lantern's lines: { title, lines, lit, wake } (region lanterns add their region's arrival line). */
export function lanternView(lantern, content, state) {
  const wilds = isRecord(content) ? content : {};
  const saved = isRecord(state?.wilds) ? state.wilds : {};
  const id = lantern?.id || '';
  const lit = has(saved.lanterns, id);
  const examine = isRecord(wilds.examine?.lantern) ? wilds.examine.lantern : {};
  const out = { title: lantern?.name || 'A lantern', lines: [], lit, wake: saved.wake === id };
  if (lit && /sleeping/i.test(out.title)) out.title = 'A lit lantern';
  const line = pickLine(lit ? examine.lit : examine.sleeping, id);
  if (line) out.lines.push(line);
  const region = lantern?.region && isRecord(wilds.regions) ? wilds.regions[lantern.region] : null;
  if (isRecord(region) && region.arrive) out.lines.push(region.arrive);
  return out;
}

export const LIGHTING_LINE = 'The wick catches, and the old glass warms.';

/**
 * What Milo says as he lights a lantern: a lit line, never the one its description then shows
 * (lanternView picks from the same list), so the panel doesn't say the same thing twice.
 */
export function lightingLine(lantern, content) {
  const id = lantern?.id || '';
  const pool = lines(isRecord(content) && isRecord(content.examine?.lantern) ? content.examine.lantern.lit : null);
  const shown = pickLine(pool, id);
  return pickLine(pool.filter((line) => line !== shown), id, 'lit') || LIGHTING_LINE;
}

/**
 * Where a lit lantern can send Milo, as the lantern panel lists it: home first, then the lantern he
 * rests at, then the other lit lanterns in the order they were lit (never the one he's at).
 * `place(id)` → { name, note } for a lantern. → [{ id, name, note }]
 */
export function travelChoices(lanterns, { here = null, wake = null, place = () => ({}), max = 30 } = {}) {
  const ids = (isRecord(lanterns) ? Object.keys(lanterns) : []).filter((id) => id !== here);
  const rest = wake && ids.includes(wake) ? [{ id: wake, ...place(wake), note: 'Where Milo rests' }] : [];
  const others = ids.filter((id) => id !== wake).slice(0, Math.max(0, max - rest.length)).map((id) => ({ id, ...place(id) }));
  return [{ id: 'home', name: 'Home', note: 'Hearthvale' }, ...rest, ...others];
}

/**
 * Opening a chest: { materials, mimic, line } (the same chest always gives the same). A friendly
 * mimic has something to say (`line`); a plain chest just shows what's inside (`line` is '').
 */
export function openChest(poi, content) {
  const wilds = isRecord(content) ? content : {};
  const id = poi?.id || '';
  const materials = lootFor(id, wilds.loot?.chest, 'chest');
  const mimic = poi?.mimic === true;
  const line = mimic ? pickLine(wilds.mimic, id, 'mimic') : '';
  return { materials, mimic, line };
}

/** Searching a ruin: { materials, tablet, keys } (a map tablet reveals the 3×3 chunks round it). */
export function searchRuin(poi, content) {
  const wilds = isRecord(content) ? content : {};
  const id = poi?.id || '';
  const materials = lootFor(id, wilds.loot?.ruin, 'ruin');
  const tablet = chanceFor(id, wilds.loot?.tabletChance ?? 0, 'tablet');
  return {
    materials,
    tablet,
    keys: tablet ? tabletKeys(poi.x, poi.y) : [],
  };
}

/** A stray's line, by its temperament. */
export function strayLine(stray, id, content) {
  const wilds = isRecord(content) ? content : {};
  return pickLine(wilds.strays?.[stray?.temperament], id, 'stray');
}

/** A chop line for the wood. */
export function chopLine(wood, treeId, content) {
  return pickLine(content?.chop?.[wood], treeId, 'chop');
}
