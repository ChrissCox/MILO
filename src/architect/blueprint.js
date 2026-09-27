// Blueprints and suggestions: what the crew sends back and what MILO's kit draws.
//
// Pure ESM, shared by the main process and the renderer: no DOM, no fs, no network.
// Everything that arrives from a crew member is untrusted data. It is only ever cleaned,
// clamped and matched against the lists below; it is never used as HTML, a path or a command.

export const BLUEPRINT_VERSION = 1;

export const LIMITS = Object.freeze({
  name: 28,
  tagline: 70,
  purpose: 160,
  levelTitle: 50,
  levelSummary: 140,
  levelProof: 140,
  title: 28,
  pitch: 110,
  why: 110,
  emblem: 12,
  props: 4,
  levels: 5,
  suggestions: 3,
});

export const SHAPES = Object.freeze(['cottage', 'hall', 'tower', 'barn', 'shop', 'greenhouse', 'observatory', 'mill', 'pavilion', 'workshop']);
export const WALLS = Object.freeze(['log', 'plank', 'stone', 'plaster', 'brick', 'glass']);
export const ROOFS = Object.freeze(['gable', 'hip', 'flat', 'dome', 'thatch', 'shingle', 'awning']);
export const DOORS = Object.freeze(['plain', 'arched', 'double', 'sliding']);
export const WINDOWS = Object.freeze(['none', 'square', 'round', 'tall', 'shopfront']);
export const COLOURS = Object.freeze([
  'cream', 'wood', 'woodDeep', 'woodLight', 'stone', 'stoneDeep', 'clay', 'clayDeep', 'blossom',
  'butter', 'honey', 'slate', 'slateDeep', 'lavender', 'leaf', 'leafDeep', 'water', 'sand',
]);
export const ACCENTS = Object.freeze([...COLOURS, 'none']);   // flag and awning
export const PROP_KINDS = Object.freeze([
  'easel', 'anvil', 'crates', 'barrels', 'bookcart', 'telescope', 'camera', 'filmreel', 'musicstand',
  'gardenbed', 'lantern', 'bench', 'mailbox', 'pottedplant', 'well', 'handcart', 'dicetable', 'chalkboard',
  'antenna', 'beehive', 'workbench', 'scrollrack', 'trophy', 'kiln', 'fishingrack', 'birdhouse', 'fountain', 'signboard',
]);
export const PROP_SIDES = Object.freeze(['left', 'right', 'front']);
export const YARDS = Object.freeze(['grass', 'path', 'stone', 'flowers', 'garden', 'sand']);
export const SOURCES = Object.freeze(['local', 'claude', 'codex']);
export const DESIGNERS = Object.freeze(['claude', 'codex', 'kit']);

/** Blueprint colour name -> world PALETTE key (src/world/sprites.js). */
export const COLOUR_KEYS = Object.freeze({
  cream: 'c', wood: 'b', woodDeep: 'B', woodLight: 'n', stone: 's', stoneDeep: 'S', clay: 'r', clayDeep: 'R',
  blossom: 'k', butter: 'u', honey: 'U', slate: 'e', slateDeep: 'E', lavender: 'v', leaf: 'l', leafDeep: 'L',
  water: 'w', sand: 'p',
});

/** Emblem pixel key -> colour name. '.' is transparent. The keys are world PALETTE keys too. */
export const EMBLEM_KEYS = Object.freeze({
  o: 'ink', c: 'cream', r: 'clay', u: 'butter', U: 'honey', e: 'slate', l: 'leaf', L: 'leafDeep',
  k: 'blossom', v: 'lavender', b: 'wood', B: 'woodDeep', s: 'stone', w: 'water',
});

export const DEFAULT_STYLE = Object.freeze({
  shape: 'cottage', walls: 'plank', wallColor: 'cream', roof: 'gable', roofColor: 'clay', trim: 'woodDeep',
  door: 'plain', windows: 'square', chimney: true, flag: 'none', awning: 'none',
});

/** A little house, used when an emblem is missing or unreadable. */
export const DEFAULT_EMBLEM = Object.freeze([
  '............',
  '.....oo.....',
  '....orro....',
  '...orrrro...',
  '..orrrrrro..',
  '.oooooooooo.',
  '..occcccco..',
  '..oecbbceo..',
  '..oecbbceo..',
  '..occbbcco..',
  '..oooooooo..',
  '............',
]);

export const CREW_NAMES = Object.freeze({ claude: 'Claude Code', codex: 'Codex', kit: 'Milo' });
const CREW_MAKERS = { claude: 'Anthropic', codex: 'OpenAI' };

// ---------------------------------------------------------------------------------------------
// Copy helpers the renderer can share

/** Everything a crew brief carries about Chris, in plain words (keep in step with prompts.js). */
export const SHARED_ITEMS = "your idea, this plot's name and size, the names of your buildings and projects, and your skills' names with the start of each description";

/**
 * The plain "who is asked and what is shared" line. `auto`: the Designer setting is Automatic, so
 * Codex may still be asked if Claude Code turns out not to be signed in.
 */
export function shareNote(designer, { auto = false } = {}) {
  if (designer === 'claude' || designer === 'codex') {
    const text = `Milo asks ${CREW_NAMES[designer]} (${CREW_MAKERS[designer]}) to draw up plans. It shares ${SHARED_ITEMS}. Never your sessions, and it can't open your files.`;
    return auto && designer === 'claude' ? `${text} If Claude Code turns out not to be signed in, Milo asks Codex (OpenAI) instead.` : text;
  }
  return 'Milo draws these plans himself. Nothing leaves your PC.';
}

/** Calm progress line: 'Codex is drawing up plans…' / 'Codex is thinking up ideas…'. */
export function progressText(designer, kind = 'design') {
  const who = CREW_NAMES[designer] || 'Milo';
  return kind === 'suggest' ? `${who} is thinking up ideas…` : `${who} is drawing up plans…`;
}

// ---------------------------------------------------------------------------------------------
// JSON Schemas (strict: every property required, no additional properties).
//
// Only keywords that both `claude --json-schema` and OpenAI strict structured outputs
// (`codex exec --output-schema`) accept are used: type, properties, required,
// additionalProperties, items, enum, description. Lengths and counts live in the
// descriptions and are enforced by validateBlueprint / validateSuggestions.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const text = (description) => ({ type: 'string', description });
const oneOf = (values, description) => (description ? { type: 'string', enum: [...values], description } : { type: 'string', enum: [...values] });
function object(properties, description) {
  const schema = { type: 'object' };
  if (description) schema.description = description;
  schema.properties = properties;
  schema.required = Object.keys(properties);
  schema.additionalProperties = false;
  return schema;
}

export const BLUEPRINT_SCHEMA = deepFreeze(object({
  version: { type: 'integer', enum: [1] },
  name: text('Building name in sentence case, at most 28 characters, e.g. "Clip studio"'),
  tagline: text('One calm line, at most 70 characters'),
  purpose: text('What the app or tool will do for Chris, at most 160 characters'),
  style: object({
    shape: oneOf(SHAPES),
    walls: oneOf(WALLS),
    wallColor: oneOf(COLOURS),
    roof: oneOf(ROOFS),
    roofColor: oneOf(COLOURS),
    trim: oneOf(COLOURS),
    door: oneOf(DOORS),
    windows: oneOf(WINDOWS),
    chimney: { type: 'boolean' },
    flag: oneOf(ACCENTS, 'Flag colour, or none'),
    awning: oneOf(ACCENTS, 'Awning colour, or none'),
  }),
  emblem: {
    type: 'array',
    description: 'Sign icon: exactly 12 strings of exactly 12 characters. "." is transparent; other characters are colour keys: o ink, c cream, r clay, u butter, U honey, e slate, l leaf, L leafDeep, k blossom, v lavender, b wood, B woodDeep, s stone, w water',
    items: { type: 'string' },
  },
  props: {
    type: 'array',
    description: '0 to 4 props around the building',
    items: object({ kind: oneOf(PROP_KINDS), side: oneOf(PROP_SIDES) }),
  },
  yard: oneOf(YARDS),
  levels: {
    type: 'array',
    description: 'Exactly 5 levels, 1 to 5 in order',
    items: object({
      level: { type: 'integer', enum: [1, 2, 3, 4, 5] },
      title: text('At most 50 characters'),
      summary: text('At most 140 characters'),
      proof: text('A concrete check that shows the level works, at most 140 characters'),
    }),
  },
}));

export const SUGGESTIONS_SCHEMA = deepFreeze(object({
  suggestions: {
    type: 'array',
    description: 'Exactly 3 distinct buildings',
    items: object({
      title: text('Building name in sentence case, at most 28 characters, e.g. "Clip studio"'),
      pitch: text('What it would do for Chris, at most 110 characters'),
      why: text('The evidence from his skills, projects or question, at most 110 characters'),
    }),
  },
}));

// ---------------------------------------------------------------------------------------------
// Text cleaning

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{1f1e6}-\u{1f1ff}\u{fe0f}\u{20e3}]/gu;
const BRANDS = new Set(['TikTok', 'YouTube', 'Pathfinder', 'Claude', 'Codex', 'Jev', 'Whisper', 'Ollama', 'Milo', 'MILO',
  'GitHub', 'Windows', 'Google', 'Discord', 'Twitch', 'Instagram', 'Obsidian', 'Excel', 'Word', 'Spotify', 'Steam',
  'Habitack', 'TypeSafe', 'Sleeper', 'Yahoo', 'ESPN', 'NFL', 'OBS', 'Chris', 'Sunday', 'Monday', 'Tuesday',
  'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Golarion', 'Anthropic', 'OpenAI']);

const MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'nor', 'of', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'into', 'onto', 'over', 'my', 'your', 'as', 'per', 'via']);

/**
 * Cuts a string to `max` characters (code points), preferring a word boundary and never ending on
 * a dangling little word ('The grand clip studio for' -> 'The grand clip studio').
 */
export function clampText(value, max, { ellipsis = false } = {}) {
  const chars = Array.from(String(value || ''));
  if (chars.length <= max) return chars.join('');
  const room = ellipsis ? max - 1 : max;
  let cut = chars.slice(0, room).join('');
  const space = cut.lastIndexOf(' ');
  if (space >= Math.floor(room * 0.6)) {
    cut = cut.slice(0, space);
    const words = cut.split(' ');
    while (words.length > 2 && MINOR_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
    cut = words.join(' ');
  }
  cut = cut.replace(/[\s,;:.\-–—(/&]+$/u, '');
  return ellipsis ? `${cut}…` : cut;
}

function isTitleCase(words) {
  const long = words
    .map((word) => word.replace(/[.,:;]+$/, ''))
    .filter((word) => /^[A-Za-z][A-Za-z'’-]{2,}$/.test(word) && !MINOR_WORDS.has(word.toLowerCase()));
  return long.length >= 2 && long.every((word) => /^[A-Z]/.test(word));
}

/** 'Clip Studio' -> 'Clip studio'. Only touches strings written wholly in Title Case. Brand names stay. */
export function sentenceCase(value, keep = []) {
  const words = String(value || '').split(' ');
  if (!isTitleCase(words)) return String(value || '');
  const kept = new Set([...BRANDS, ...keep]);
  return words.map((word, index) => {
    if (index === 0 || kept.has(word) || kept.has(word.replace(/[^A-Za-z]/g, ''))) return word;
    if (word === 'A') return 'a';
    return /^[A-Z][a-z'’-]+[.,:;]?$/.test(word) ? word.toLowerCase() : word;
  }).join(' ');
}

/**
 * Tidies one piece of crew text for calm display: no control characters, emoji or markdown
 * emphasis, no exclamation marks, whitespace collapsed, wrapping quotes removed, clamped.
 */
export function cleanText(value, max, { ellipsis = false, sentence = false } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return '';
  let out = value
    .replace(CONTROL, ' ')
    .replace(PICTOGRAPHS, '')
    .replace(/\*\*|__|`+/g, '')
    .replace(/\s*!+(?=\s|$)/g, '.')
    .replace(/!+/g, '')
    .replace(/\?\./g, '?')
    .replace(/(^|[^.])\.\.(?!\.)/g, '$1.')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (sentence) out = sentenceCase(out).replace(/[.]+$/, '').trim();
  return clampText(out, max, { ellipsis });
}

// ---------------------------------------------------------------------------------------------
// Enum matching with forgiving aliases

const squash = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  colour: {
    white: 'cream', ivory: 'cream', offwhite: 'cream', beige: 'sand', tan: 'sand', brown: 'wood', oak: 'wood',
    darkbrown: 'woodDeep', darkwood: 'woodDeep', walnut: 'woodDeep', lightwood: 'woodLight', pine: 'woodLight',
    grey: 'stone', gray: 'stone', silver: 'stone', darkgrey: 'stoneDeep', darkgray: 'stoneDeep', charcoal: 'stoneDeep',
    red: 'clay', terracotta: 'clay', coral: 'clay', salmon: 'clay', rust: 'clayDeep', darkred: 'clayDeep', maroon: 'clayDeep',
    brick: 'clayDeep', pink: 'blossom', rose: 'blossom', yellow: 'butter', gold: 'honey', golden: 'honey',
    orange: 'honey', amber: 'honey', mustard: 'honey', blue: 'slate', periwinkle: 'slate', navy: 'slateDeep', darkblue: 'slateDeep',
    indigo: 'slateDeep', purple: 'lavender', violet: 'lavender', lilac: 'lavender', mauve: 'lavender', green: 'leaf',
    sage: 'leaf', mint: 'leaf', moss: 'leafDeep', darkgreen: 'leafDeep', forest: 'leafDeep', olive: 'leafDeep',
    teal: 'water', cyan: 'water', aqua: 'water', lightblue: 'water', skyblue: 'water', sky: 'water', turquoise: 'water',
  },
  shape: {
    house: 'cottage', home: 'cottage', cabin: 'cottage', hut: 'cottage', lodge: 'hall', library: 'hall', townhall: 'hall',
    school: 'hall', academy: 'hall', lighthouse: 'tower', clocktower: 'tower', turret: 'tower', spire: 'tower',
    stable: 'barn', shed: 'barn', warehouse: 'barn', store: 'shop', market: 'shop', stall: 'shop', bakery: 'shop',
    storefront: 'shop', conservatory: 'greenhouse', glasshouse: 'greenhouse', planetarium: 'observatory', dome: 'observatory',
    windmill: 'mill', watermill: 'mill', gazebo: 'pavilion', bandstand: 'pavilion', tent: 'pavilion', forge: 'workshop',
    smithy: 'workshop', studio: 'workshop', atelier: 'workshop', lab: 'workshop',
  },
  walls: {
    wood: 'plank', wooden: 'plank', timber: 'plank', boards: 'plank', planks: 'plank', logs: 'log', rock: 'stone',
    cobble: 'stone', cobblestone: 'stone', stucco: 'plaster', render: 'plaster', whitewash: 'plaster', bricks: 'brick',
    glasshouse: 'glass', windows: 'glass', crystal: 'glass',
  },
  roof: {
    gabled: 'gable', pitched: 'gable', peaked: 'gable', hipped: 'hip', domed: 'dome', thatched: 'thatch', straw: 'thatch',
    shingles: 'shingle', tile: 'shingle', tiles: 'shingle', tiled: 'shingle', slate: 'shingle', canopy: 'awning', none: 'flat',
    terrace: 'flat',
  },
  door: {
    normal: 'plain', single: 'plain', wooden: 'plain', simple: 'plain', arch: 'arched', round: 'arched', doubledoor: 'double',
    doubledoors: 'double', twin: 'double', wide: 'double', slide: 'sliding', barn: 'sliding', barndoor: 'sliding',
  },
  windows: {
    no: 'none', nowindows: 'none', square: 'square', squares: 'square', box: 'square', small: 'square', circle: 'round',
    circular: 'round', porthole: 'round', portholes: 'round', long: 'tall', arched: 'tall', narrow: 'tall', shop: 'shopfront',
    display: 'shopfront', storefront: 'shopfront', shopwindow: 'shopfront',
  },
  yard: {
    lawn: 'grass', meadow: 'grass', gravel: 'path', dirt: 'path', cobble: 'stone', cobbles: 'stone', paved: 'stone',
    stones: 'stone', flowerbed: 'flowers', flowerbeds: 'flowers', flower: 'flowers', vegetable: 'garden', veggie: 'garden',
    vegetables: 'garden', beach: 'sand',
  },
  prop: {
    tripod: 'camera', videocamera: 'camera', cam: 'camera', film: 'filmreel', reel: 'filmreel', books: 'bookcart',
    bookcase: 'scrollrack', bookshelf: 'scrollrack', shelf: 'scrollrack', crate: 'crates', boxes: 'crates', box: 'crates',
    barrel: 'barrels', plant: 'pottedplant', pot: 'pottedplant', flowerpot: 'pottedplant', plantpot: 'pottedplant',
    lamp: 'lantern', lamppost: 'lantern', streetlamp: 'lantern', sign: 'signboard', signpost: 'signboard', seat: 'bench',
    mail: 'mailbox', letterbox: 'mailbox', postbox: 'mailbox', cart: 'handcart', wheelbarrow: 'handcart', dice: 'dicetable',
    gametable: 'dicetable', table: 'dicetable', blackboard: 'chalkboard', board: 'chalkboard', radio: 'antenna',
    dish: 'antenna', mast: 'antenna', bees: 'beehive', hive: 'beehive', desk: 'workbench', scroll: 'scrollrack',
    scrolls: 'scrollrack', cup: 'trophy', award: 'trophy', oven: 'kiln', furnace: 'kiln', fish: 'fishingrack',
    fishingrod: 'fishingrack', bird: 'birdhouse', planter: 'gardenbed', garden: 'gardenbed', music: 'musicstand',
    stand: 'musicstand', canvas: 'easel', scope: 'telescope',
  },
  side: { l: 'left', west: 'left', r: 'right', east: 'right', f: 'front', south: 'front', centre: 'front', center: 'front', back: 'left' },
};

/** Canonical enum value for `value`, or null. Case, spaces and dashes don't matter. */
export function matchEnum(value, list, aliases = null) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const key = squash(value);
  if (!key) return null;
  for (const item of list) if (squash(item) === key) return item;
  if (aliases) {
    const hit = Object.entries(aliases).find(([alias]) => squash(alias) === key);
    if (hit && list.includes(hit[1])) return hit[1];
  }
  return null;
}

export const matchColour = (value) => matchEnum(value, COLOURS, ALIASES.colour);

/** The building shape a name asks for by its noun ('Backup shed' -> barn, 'Clock tower' -> tower), or null. */
export function shapeFromName(name) {
  const words = String(name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const shape = matchEnum(words[i], SHAPES, ALIASES.shape);
    if (shape) return shape;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Emblem

const EMBLEM_SIZE = LIMITS.emblem;
const EMBLEM_CHAR_FIX = { ' ': '.', _: '.', '-': '.', 0: '.', '#': 'o', O: 'o', C: 'c', R: 'r', E: 'e', K: 'k', V: 'v', S: 's', W: 'w', X: 'o', x: 'o' };

/**
 * Normalizes an emblem to exactly 12 rows of 12 keys. Returns { rows, fixed } or null when there is
 * nothing readable. A correctly sized emblem keeps its layout; any other size is cropped around
 * (or padded to centre) its drawn pixels.
 */
export function normalizeEmblem(value) {
  let lines = null;
  if (Array.isArray(value)) lines = value.filter((row) => typeof row === 'string');
  else if (typeof value === 'string') lines = value.split(/\r?\n/);
  if (!lines || !lines.length) return null;
  let fixed = false;
  const cells = lines.map((line) => Array.from(line).map((ch) => {
    if (ch === '.' || EMBLEM_KEYS[ch]) return ch;
    fixed = true;
    return EMBLEM_CHAR_FIX[ch] || '.';
  }));
  const exact = cells.length === EMBLEM_SIZE && cells.every((row) => row.length === EMBLEM_SIZE);
  let top = Infinity; let bottom = -1; let left = Infinity; let right = -1; let count = 0;
  cells.forEach((row, y) => row.forEach((ch, x) => {
    if (ch === '.') return;
    count += 1;
    top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
  }));
  if (count < 6) return null;
  if (exact) return { rows: cells.map((row) => row.join('')), fixed };
  fixed = true;
  let w = right - left + 1;
  let h = bottom - top + 1;
  if (w > EMBLEM_SIZE) { left += Math.floor((w - EMBLEM_SIZE) / 2); w = EMBLEM_SIZE; }
  if (h > EMBLEM_SIZE) { top += Math.floor((h - EMBLEM_SIZE) / 2); h = EMBLEM_SIZE; }
  const offX = Math.floor((EMBLEM_SIZE - w) / 2);
  const offY = Math.floor((EMBLEM_SIZE - h) / 2);
  const out = Array.from({ length: EMBLEM_SIZE }, () => Array(EMBLEM_SIZE).fill('.'));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ch = (cells[top + y] || [])[left + x];
      if (ch && ch !== '.') out[offY + y][offX + x] = ch;
    }
  }
  return { rows: out.map((row) => row.join('')), fixed };
}

// ---------------------------------------------------------------------------------------------
// Blueprint validation

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const key = squash(value);
    if (['true', 'yes', 'y', '1', 'on'].includes(key)) return true;
    if (['false', 'no', 'n', '0', 'off', 'none'].includes(key)) return false;
  }
  return null;
}

const STYLE_FIELDS = [
  ['shape', SHAPES, ALIASES.shape],
  ['walls', WALLS, ALIASES.walls],
  ['wallColor', COLOURS, ALIASES.colour],
  ['roof', ROOFS, ALIASES.roof],
  ['roofColor', COLOURS, ALIASES.colour],
  ['trim', COLOURS, ALIASES.colour],
  ['door', DOORS, ALIASES.door],
  ['windows', WINDOWS, ALIASES.windows],
];

function normalizeStyle(input, fallbackStyle, problems) {
  const source = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) problems.push('style was missing');
  const base = { ...DEFAULT_STYLE, ...(fallbackStyle || {}) };
  const style = {};
  for (const [field, list, aliases] of STYLE_FIELDS) {
    const value = matchEnum(source[field], list, aliases);
    if (value) style[field] = value;
    else {
      style[field] = base[field];
      if (isPlainObject(input)) problems.push(`style.${field} replaced`);
    }
  }
  const chimney = toBoolean(source.chimney);
  style.chimney = chimney === null ? Boolean(base.chimney) : chimney;
  if (chimney === null && isPlainObject(input)) problems.push('style.chimney replaced');
  for (const field of ['flag', 'awning']) {
    const raw = source[field];
    const off = raw === null || raw === false || (typeof raw === 'string' && ['none', 'no', 'false', ''].includes(squash(raw)));
    const value = off ? 'none' : matchEnum(raw, COLOURS, ALIASES.colour);
    if (value) style[field] = value;
    else {
      style[field] = base[field];
      if (isPlainObject(input)) problems.push(`style.${field} replaced`);
    }
  }
  return style;
}

function normalizeProps(input, fallbackProps, problems) {
  if (!Array.isArray(input)) {
    problems.push('props were missing');
    return Array.isArray(fallbackProps) ? fallbackProps.map((prop) => ({ ...prop })) : [];
  }
  const out = [];
  const seen = new Set();
  input.forEach((item, index) => {
    const kind = matchEnum(isPlainObject(item) ? item.kind : item, PROP_KINDS, ALIASES.prop);
    if (!kind) {
      problems.push('dropped an unknown prop');
      return;
    }
    let side = matchEnum(isPlainObject(item) ? item.side : null, PROP_SIDES, ALIASES.side);
    if (!side) {
      side = PROP_SIDES[index % 3];
      problems.push('prop side replaced');
    }
    const key = `${kind}:${side}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, side });
  });
  if (out.length > LIMITS.props) problems.push('kept the first 4 props');
  return out.slice(0, LIMITS.props);
}

function normalizeLevels(input, fallbackLevels, problems) {
  const list = Array.isArray(input) ? input : [];
  if (!Array.isArray(input)) problems.push('levels were missing');
  const items = [];
  list.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const title = cleanText(item.title, LIMITS.levelTitle, { sentence: true });
    if (!title) return;
    let summary = cleanText(item.summary, LIMITS.levelSummary, { ellipsis: true });
    let proof = cleanText(item.proof, LIMITS.levelProof, { ellipsis: true });
    if (!summary) { summary = title; problems.push('a level summary was missing'); }
    if (!proof) { proof = 'You can see it working in this building.'; problems.push('a level proof was missing'); }
    if (typeof item.title === 'string' && Array.from(item.title.trim()).length > LIMITS.levelTitle) problems.push('a level title was shortened');
    if (typeof item.summary === 'string' && Array.from(item.summary.trim()).length > LIMITS.levelSummary) problems.push('a level summary was shortened');
    if (typeof item.proof === 'string' && Array.from(item.proof.trim()).length > LIMITS.levelProof) problems.push('a level proof was shortened');
    // A level with no usable number (missing, null, '', 'first') keeps its place in the list.
    const raw = item.level;
    const level = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
    items.push({ level: Number.isFinite(level) ? level : index + 1, index, title, summary, proof });
  });
  const own = items.length;
  const sorted = [...items].sort((a, b) => (a.level - b.level) || (a.index - b.index));
  if (sorted.some((item, index) => item !== items[index])) problems.push('levels were reordered');
  if (sorted.length > LIMITS.levels) problems.push('kept the first 5 levels');
  const levels = sorted.slice(0, LIMITS.levels);
  if (levels.length < LIMITS.levels && Array.isArray(fallbackLevels)) {
    // The fallback's later levels first (they fit the gap), then its earlier ones, never a repeat.
    const titles = new Set(levels.map((item) => item.title.toLowerCase()));
    const order = [...fallbackLevels.slice(levels.length), ...fallbackLevels.slice(0, levels.length)];
    for (const extra of order) {
      if (levels.length >= LIMITS.levels) break;
      if (!extra || typeof extra.title !== 'string' || titles.has(extra.title.toLowerCase())) continue;
      titles.add(extra.title.toLowerCase());
      levels.push({ title: extra.title, summary: extra.summary, proof: extra.proof });
    }
    problems.push('filled in missing levels');
  }
  const numbered = levels.map((item, index) => {
    if (item.level !== undefined && item.level !== index + 1 && index < own) problems.push('levels were renumbered');
    return { level: index + 1, title: item.title, summary: item.summary, proof: item.proof };
  });
  return { levels: numbered, own };
}

/**
 * Checks and repairs a blueprint.
 *   validateBlueprint(x, { fallback }) -> { ok, blueprint, problems }
 * Repairs what it safely can: clamps text, drops unknown props, fixes the emblem's size, replaces
 * unknown enum values with defaults (or the fallback blueprint's values). `ok` is false only when the
 * design is unusable: not an object, no name, or fewer than 3 real levels (fewer than 5 without a
 * fallback to fill from). `problems` lists each repair; an empty list means it came in clean.
 */
export function validateBlueprint(input, { fallback = null } = {}) {
  const problems = [];
  let x = parseMaybeJson(input);
  if (isPlainObject(x) && !('name' in x) && isPlainObject(x.blueprint)) {
    x = x.blueprint;
    problems.push('unwrapped the blueprint');
  }
  if (!isPlainObject(x)) return { ok: false, blueprint: null, problems: ['not a blueprint object'] };
  const fb = fallback && isPlainObject(fallback) ? fallback : null;

  if (x.version !== BLUEPRINT_VERSION) problems.push('version set to 1');
  const rawName = typeof x.name === 'string' ? x.name.trim() : '';
  const name = cleanText(x.name, LIMITS.name, { sentence: true });
  if (!name) return { ok: false, blueprint: null, problems: [...problems, 'no name'] };
  if (Array.from(rawName).length > LIMITS.name) problems.push('name was shortened');

  const textField = (field, max) => {
    const raw = typeof x[field] === 'string' ? x[field].trim() : '';
    let value = cleanText(x[field], max, { ellipsis: true });
    if (!value) {
      value = fb && typeof fb[field] === 'string' ? fb[field] : '';
      problems.push(`${field} was missing`);
    } else if (Array.from(raw).length > max) problems.push(`${field} was shortened`);
    return value;
  };
  const tagline = textField('tagline', LIMITS.tagline);
  const purpose = textField('purpose', LIMITS.purpose);
  const style = normalizeStyle(x.style, fb && fb.style, problems);

  let emblem = normalizeEmblem(x.emblem);
  if (!emblem) {
    problems.push('emblem was unreadable');
    emblem = { rows: fb && Array.isArray(fb.emblem) ? [...fb.emblem] : [...DEFAULT_EMBLEM], fixed: false };
  } else if (emblem.fixed) problems.push('emblem was resized or recoloured');

  const props = normalizeProps(x.props, fb && fb.props, problems);
  let yard = matchEnum(x.yard, YARDS, ALIASES.yard);
  if (!yard) {
    yard = (fb && fb.yard) || 'grass';
    problems.push('yard replaced');
  }
  const { levels, own } = normalizeLevels(x.levels, fb && fb.levels, problems);
  if (own < 3 || levels.length !== LIMITS.levels) {
    return { ok: false, blueprint: null, problems: [...problems, 'not enough levels'] };
  }
  const blueprint = { version: BLUEPRINT_VERSION, name, tagline, purpose, style, emblem: emblem.rows, props, yard, levels };
  return { ok: true, blueprint, problems: [...new Set(problems)] };
}

// ---------------------------------------------------------------------------------------------
// Suggestions

const ID_PATTERN = /^[a-z0-9][a-z0-9:_.-]{0,63}$/i;

/**
 * How titles are compared: case, spacing and punctuation don't count, and neither do Latin accents
 * ('Café' is 'Cafe'). Letters and marks of other scripts are kept, so '日記' matches '日記' and
 * 'ドア' stays different from 'トア'.
 */
export function titleKey(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}

export function sameTitle(a, b) {
  const key = titleKey(a);
  return key !== '' && key === titleKey(b);
}

/**
 * Cleans a list of suggestions (an array, or { suggestions: [...] }).
 *   validateSuggestions(x, { source, built, exclude, max }) -> Suggestion[]
 * Drops untitled ones, duplicates and anything already built; ids are kept when they look safe,
 * otherwise `${source}:${n}`.
 */
export function validateSuggestions(input, { source = 'local', built = [], exclude = [], max = LIMITS.suggestions } = {}) {
  let x = parseMaybeJson(input);
  if (isPlainObject(x) && Array.isArray(x.suggestions)) x = x.suggestions;
  if (!Array.isArray(x)) return [];
  const fallbackSource = SOURCES.includes(source) ? source : 'local';
  const blocked = [...(Array.isArray(built) ? built : []), ...(Array.isArray(exclude) ? exclude : [])]
    .map((item) => (isPlainObject(item) ? item.title || item.name : item)).filter((item) => typeof item === 'string');
  const out = [];
  const ids = new Set();
  for (const item of x) {
    if (!isPlainObject(item)) continue;
    const title = cleanText(item.title, LIMITS.title, { sentence: true });
    if (!title) continue;
    if (out.some((other) => sameTitle(other.title, title)) || blocked.some((name) => sameTitle(name, title))) continue;
    const itemSource = SOURCES.includes(item.source) ? item.source : fallbackSource;
    let id = typeof item.id === 'string' && ID_PATTERN.test(item.id) ? item.id : `${itemSource}:${out.length + 1}`;
    let bump = out.length + 1;
    while (ids.has(id)) id = `${itemSource}:${++bump}`;
    ids.add(id);
    out.push({
      id,
      title,
      pitch: cleanText(item.pitch, LIMITS.pitch, { ellipsis: true }),
      why: cleanText(item.why, LIMITS.why, { ellipsis: true }),
      source: itemSource,
    });
    if (out.length >= max) break;
  }
  return out;
}

const slug = (value) => squash(String(value).replace(/\s+/g, '-')).slice(0, 40) || 'idea';

/**
 * Turns an idea Chris typed into a Suggestion so it can be stored as `plot.idea`.
 * 'Clip studio: turns my drawing streams into TikToks' -> title 'Clip studio', pitch 'Turns my drawing
 * streams into TikToks'. A long sentence with no short name gets the title 'Your idea' (the design
 * result names it properly).
 */
export function ideaFromText(value) {
  const whole = cleanText(value, 300);
  if (!whole) return null;
  const parts = whole.split(/\s*(?::|\s[-–—]\s)\s*/);
  const head = parts[0].replace(/^(a|an|the|some)\s+/i, '');
  const rest = parts.slice(1).join(': ').trim();
  const filler = /^(something|somewhere|someplace|a place|place|an? (app|tool|thing|way|spot|building)|app|tool|thing|way|help|i want|i need|can you|could you|make|build)\b/i;
  const named = head && Array.from(head).length <= LIMITS.title && !filler.test(head) && (rest || head.split(' ').length <= 4);
  const title = named ? cleanText(head.charAt(0).toUpperCase() + head.slice(1), LIMITS.title, { sentence: true }) : 'Your idea';
  const pitchText = named && rest ? rest : whole;
  return {
    id: `own:${slug(named ? title : whole)}`,
    title: title || 'Your idea',
    pitch: cleanText(pitchText.charAt(0).toUpperCase() + pitchText.slice(1), LIMITS.pitch, { ellipsis: true }),
    why: 'Your own idea',
    source: 'local',
  };
}
