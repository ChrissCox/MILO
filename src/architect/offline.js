// Milo's own ideas and his offline kit designer. Pure ESM: no fs, no network.
//
//   localSuggestions(plot, signals, { question, exclude }) -> Suggestion[3]
//   kitBlueprint(idea, { plot, tweak, previous }) -> Blueprint (always valid)
//
// Suggestions come from a curated pool matched against Chris's signals (skill names and
// descriptions, project folder names, existing buildings). Every `why` names its evidence.
// The five plots share the pool out so each one leads with a different idea that fits it.

import {
  DEFAULT_STYLE, LIMITS, cleanText, ideaFromText, matchColour, sameTitle, shapeFromName, validateBlueprint,
} from './blueprint.js';

// ---------------------------------------------------------------------------------------------
// Emblems (12x12, emblem keys: o ink, c cream, r clay, u butter, U honey, e slate, l leaf,
// L leafDeep, k blossom, v lavender, b wood, B woodDeep, s stone, w water)

export const EMBLEMS = Object.freeze({
  house: [
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
  ],
  play: [
    '............',
    '.oooooooooo.',
    'orrrrrrrrrro',
    'orrrcrrrrrro',
    'orrrccrrrrro',
    'orrrcccrrrro',
    'orrrccccrrro',
    'orrrcccrrrro',
    'orrrccrrrrro',
    'orrrcrrrrrro',
    'orrrrrrrrrro',
    '.oooooooooo.',
  ],
  brush: [
    '.........oo.',
    '........obbo',
    '.......obbo.',
    '......obbo..',
    '.....obbo...',
    '....osso....',
    '...okkko....',
    '..okkkko....',
    '.okkkko.....',
    '.okkko......',
    '..ooo.......',
    '............',
  ],
  d20: [
    '............',
    '.....oo.....',
    '...oovvoo...',
    '.oovvccvvoo.',
    '.ovvvccvvvo.',
    '.ovvcvvcvvo.',
    '.ovvcvvcvvo.',
    '.ovcvvvvcvo.',
    '.occcccccco.',
    '.oovvvvvvoo.',
    '...oovvoo...',
    '.....oo.....',
  ],
  scroll: [
    '............',
    '.oooooooooo.',
    'obbbbbbbbbbo',
    '.oooooooooo.',
    '.occcccccco.',
    '.ocssssssco.',
    '.occcccccco.',
    '.ocssssccco.',
    '.occcccccco.',
    '.oooooooooo.',
    'obbbbbbbbbbo',
    '.oooooooooo.',
  ],
  // Butter pages with slate lines on a clay cover, so the open book stands out on a cream sign.
  book: [
    '............',
    '.oooo..oooo.',
    'ouuuuoouuuuo',
    'oeeeuooueeeo',
    'ouuuuoouuuuo',
    'oeeeuooueeeo',
    'ouuuuoouuuuo',
    'oeeeuooueeeo',
    'ouuuuoouuuuo',
    'orrrrrrrrrro',
    '.oooooooooo.',
    '............',
  ],
  football: [
    '............',
    '............',
    '....oooo....',
    '..oobbbboo..',
    '.obbbbbbbbo.',
    'obbbcbcbcbbo',
    'obbccccccbbo',
    'obbbcbcbcbbo',
    '.obbbbbbbbo.',
    '..oobbbboo..',
    '....oooo....',
    '............',
  ],
  envelope: [
    '............',
    '............',
    'oooooooooooo',
    'oouuuuuuuuoo',
    'ocouuuuuuoco',
    'occouuuuocco',
    'occcorroccco',
    'occccoocccco',
    'occcccccccco',
    'oooooooooooo',
    '............',
    '............',
  ],
  board: [
    '............',
    '.oooooooooo.',
    '.obbbbbbbbo.',
    '.obccbuubbo.',
    '.obccbuubbo.',
    '.obbbbbbbbo.',
    '.obkkbbccbo.',
    '.obkkbbccbo.',
    '.obbbbbbbbo.',
    '.oooooooooo.',
    '..ob....bo..',
    '..oo....oo..',
  ],
  sprout: [
    '............',
    '..oo....oo..',
    '.ollo..oLLo.',
    '.olllooLLLo.',
    '..olllLLLo..',
    '...oolLoo...',
    '....olLo....',
    '..oooooooo..',
    '..orrrrrro..',
    '...orrrro...',
    '...oooooo...',
    '............',
  ],
  star: [
    '.....oo.....',
    '....ouuo....',
    '....ouuo....',
    '.oooouuoooo.',
    '.ouuuuuuuuo.',
    '..ouuuuuuo..',
    '...ouuuuo...',
    '...ouuuuo...',
    '..ouuoouuo..',
    '..ouo..ouo..',
    '..oo....oo..',
    '............',
  ],
  note: [
    '............',
    '....ooooooo.',
    '....ovvvvvo.',
    '....ooooooo.',
    '....o.....o.',
    '....o.....o.',
    '....o.....o.',
    '..ooo...ooo.',
    '.ovvo..ovvo.',
    '.ovvo..ovvo.',
    '..oo....oo..',
    '............',
  ],
  hammer: [
    '............',
    '..oooooooo..',
    '..osssssso..',
    '..osssssso..',
    '..ooobbooo..',
    '....obbo....',
    '....obbo....',
    '....obbo....',
    '....oBBo....',
    '....oBBo....',
    '....oooo....',
    '............',
  ],
  gear: [
    '.....oo.....',
    '..o.osso.o..',
    '.osoossooso.',
    '..osssssso..',
    '.ossoooosso.',
    'ossso..ossso',
    'ossso..ossso',
    '.ossoooosso.',
    '..osssssso..',
    '.osoossooso.',
    '..o.osso.o..',
    '.....oo.....',
  ],
  fish: [
    '............',
    '............',
    '...oooooo...',
    '..owwwwwwo.o',
    '.owowwwwwwoo',
    'owwwwwwwwwwo',
    '.owwwwwwwwoo',
    '..owwwwwwo.o',
    '...oooooo...',
    '............',
    '............',
    '............',
  ],
  bread: [
    '............',
    '............',
    '............',
    '...oooooo...',
    '..oUUUUUUo..',
    '.oUUuUUuUUo.',
    '.oUuUUuUUUo.',
    '.oUUUUUUUUo.',
    '.obbbbbbbbo.',
    '..oooooooo..',
    '............',
    '............',
  ],
  pot: [
    '....s...s...',
    '...s...s....',
    '....s...s...',
    '.....oo.....',
    '..oooooooo..',
    'oooeeeeeeooo',
    'o.oecceeeo.o',
    'oooeeeeeeooo',
    '..oeeeeeeo..',
    '..oeeeeeeo..',
    '...oooooo...',
    '............',
  ],
  coin: [
    '............',
    '....oooo....',
    '..ooUUUUoo..',
    '.oUUuuuuUUo.',
    '.oUuuoouuUo.',
    'oUuuuoouuuUo',
    'oUuuuoouuuUo',
    '.oUuuoouuUo.',
    '.oUUuuuuUUo.',
    '..ooUUUUoo..',
    '....oooo....',
    '............',
  ],
  clock: [
    '............',
    '....oooo....',
    '..oossssoo..',
    '.osscoccsso.',
    '.osccocccso.',
    'osccooccccso',
    'osccooooccso',
    '.osccccccso.',
    '.ossccccsso.',
    '..oossssoo..',
    '....oooo....',
    '............',
  ],
  cap: [
    '............',
    '.....oo.....',
    '...ooeeoo...',
    '.ooeeeeeeoo.',
    'oeeeeeeeeeeo',
    '.ooeeeeeeoou',
    '...oeeeeo.u.',
    '...oeeeeo.u.',
    '...oooooo.U.',
    '..........U.',
    '............',
    '............',
  ],
  bell: [
    '.....oo.....',
    '....oUUo....',
    '...oUuuUo...',
    '...oUuuUo...',
    '..oUuuuuUo..',
    '..oUuuuuUo..',
    '.oUuuuuuuUo.',
    '.oUuuuuuuUo.',
    'oooooooooooo',
    '....oUUo....',
    '.....oo.....',
    '............',
  ],
  heart: [
    '............',
    '..oo....oo..',
    '.okko..okko.',
    'okckkookkkko',
    'okkkkkkkkkko',
    'okkkkkkkkkko',
    '.okkkkkkkko.',
    '..okkkkkko..',
    '...okkkko...',
    '....okko....',
    '.....oo.....',
    '............',
  ],
});

/** Swaps emblem keys, e.g. recolorEmblem(EMBLEMS.play, { r: 'e' }). */
export function recolorEmblem(rows, map) {
  return rows.map((row) => Array.from(row).map((ch) => map[ch] || ch).join(''));
}

// ---------------------------------------------------------------------------------------------
// Themes: how the kit dresses a building for a kind of job

const prop = (kind, side) => ({ kind, side });

export const THEMES = Object.freeze({
  clips: {
    name: 'Clip studio', tagline: 'Long streams in, short clips out', topic: 'clip',
    pitch: 'Turns long recordings into short clips, cropped and ready to post.',
    words: ['clip', 'tiktok', 'video', 'stream', 'film', 'movie', 'reel', 'youtube', 'edit', 'footage', 'vod', 'shorts', 'record', 'montage', 'highlight', 'trailer'],
    style: { shape: 'workshop', walls: 'plank', wallColor: 'lavender', roof: 'gable', roofColor: 'slateDeep', trim: 'woodDeep', door: 'double', windows: 'tall', chimney: false, flag: 'blossom', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'clay', trim: 'woodDeep', flag: 'lavender' }, { wallColor: 'blossom', roofColor: 'slate', trim: 'slateDeep', flag: 'butter' }],
    props: [prop('camera', 'left'), prop('filmreel', 'right'), prop('easel', 'front')], yard: 'path', emblem: EMBLEMS.play,
  },
  art: {
    name: 'Art studio', tagline: 'Good light and a clean canvas', topic: 'drawing',
    pitch: 'A bright studio for your drawings: references, progress shots and a place to show them.',
    words: ['draw', '=art', 'artist', 'artwork', 'paint', 'sketch', 'illustrat', 'gallery', 'portfolio', 'doodle', 'canvas', 'comic', 'commission'],
    style: { shape: 'cottage', walls: 'plaster', wallColor: 'blossom', roof: 'shingle', roofColor: 'lavender', trim: 'woodDeep', door: 'arched', windows: 'tall', chimney: false, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'slate', trim: 'woodDeep' }, { wallColor: 'butter', roofColor: 'clay', trim: 'woodDeep' }],
    props: [prop('easel', 'left'), prop('pottedplant', 'right'), prop('bench', 'front')], yard: 'flowers', emblem: EMBLEMS.brush,
  },
  game: {
    name: 'Game table', tagline: 'Roll for initiative', topic: 'encounter',
    pitch: 'A cozy hall for game prep: encounters, maps and session plans.',
    words: ['game', 'dice', 'tabletop', 'ttrpg', '=rpg', 'pathfinder', 'pf2e', '=d&d', '=dnd', 'dungeon', 'encounter', 'monster', '=gm', 'boardgame', 'initiative', 'combat'],
    style: { shape: 'hall', walls: 'stone', wallColor: 'stone', roof: 'shingle', roofColor: 'clayDeep', trim: 'woodDeep', door: 'arched', windows: 'round', chimney: true, flag: 'lavender', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'slateDeep', trim: 'woodDeep', flag: 'clay' }, { wallColor: 'sand', roofColor: 'leafDeep', trim: 'woodDeep', flag: 'butter' }],
    props: [prop('dicetable', 'front'), prop('lantern', 'left'), prop('scrollrack', 'right')], yard: 'stone', emblem: EMBLEMS.d20,
  },
  archive: {
    name: 'Campaign archive', tagline: 'Every arc, every NPC, right where you left them', topic: 'lore',
    pitch: 'Keeps your campaign notes, arcs and characters in one place.',
    words: ['campaign', 'lore', 'archive', '=npc', 'npcs', 'worldbuild', 'story', 'stories', '=arc', 'arcs', 'history', 'wiki', 'chronicle'],
    style: { shape: 'tower', walls: 'stone', wallColor: 'cream', roof: 'hip', roofColor: 'slateDeep', trim: 'woodDeep', door: 'arched', windows: 'round', chimney: false, flag: 'butter', awning: 'none' },
    palettes: [{ wallColor: 'stone', roofColor: 'lavender', trim: 'stoneDeep', flag: 'clay' }, { wallColor: 'sand', roofColor: 'clayDeep', trim: 'woodDeep', flag: 'slate' }],
    props: [prop('scrollrack', 'left'), prop('lantern', 'right')], yard: 'path', emblem: EMBLEMS.scroll,
  },
  library: {
    name: 'Library', tagline: 'Quiet shelves that answer back', topic: 'reading',
    pitch: 'Keeps your notes and saved reading in one place and answers questions about them.',
    words: ['book', 'read', 'library', 'note', 'study', 'course', 'class', 'school', 'learn', 'research', 'paper', 'article', 'journal', 'homework', 'exam', 'lecture'],
    style: { shape: 'hall', walls: 'brick', wallColor: 'clay', roof: 'hip', roofColor: 'slateDeep', trim: 'cream', door: 'arched', windows: 'tall', chimney: true, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'leafDeep', trim: 'woodDeep' }, { wallColor: 'sand', roofColor: 'slate', trim: 'woodDeep' }],
    props: [prop('bookcart', 'left'), prop('bench', 'right'), prop('lantern', 'front')], yard: 'path', emblem: EMBLEMS.book,
  },
  draft: {
    name: 'Draft room', tagline: 'Tiers on the wall, sleepers in the notebook', topic: 'draft',
    pitch: 'Keeps a draft board with tiers and value picks ready for draft day.',
    words: ['football', 'fantasy', 'draft', '=nfl', 'league', 'sport', 'lineup', 'waiver', 'roster', 'bracket', '=adp', 'ranking', 'playoff'],
    style: { shape: 'pavilion', walls: 'plank', wallColor: 'cream', roof: 'gable', roofColor: 'leafDeep', trim: 'woodDeep', door: 'double', windows: 'square', chimney: false, flag: 'leaf', awning: 'none' },
    palettes: [{ wallColor: 'butter', roofColor: 'clayDeep', trim: 'woodDeep', flag: 'clay' }, { wallColor: 'cream', roofColor: 'slateDeep', trim: 'slateDeep', flag: 'slate' }],
    props: [prop('chalkboard', 'left'), prop('trophy', 'right'), prop('bench', 'front')], yard: 'grass', emblem: EMBLEMS.football,
  },
  post: {
    name: 'Post office', tagline: 'Every letter in its pigeonhole', topic: 'sorting',
    pitch: 'Sorts incoming mail and drafts replies for you to check.',
    words: ['mail', 'email', 'inbox', 'letter', '=post', 'sort', 'triage', 'label', 'classif', 'message', 'reply', 'ticket', '=jev', 'pile', 'queue'],
    style: { shape: 'shop', walls: 'brick', wallColor: 'clay', roof: 'hip', roofColor: 'slate', trim: 'cream', door: 'double', windows: 'shopfront', chimney: true, flag: 'slate', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'clayDeep', trim: 'woodDeep', flag: 'clay' }, { wallColor: 'sand', roofColor: 'slateDeep', trim: 'woodDeep', flag: 'butter' }],
    props: [prop('mailbox', 'left'), prop('crates', 'right'), prop('handcart', 'front')], yard: 'path', emblem: EMBLEMS.envelope,
  },
  townhall: {
    name: 'Town hall', tagline: "Today's quests, pinned to the board", topic: 'quest',
    pitch: 'A quest board in the village for your habits and daily tasks.',
    words: ['habit', 'quest', 'task', 'todo', 'goal', 'board', 'chore', 'routine', 'streak', 'habitack', 'town', 'checklist', 'errand'],
    style: { shape: 'hall', walls: 'stone', wallColor: 'cream', roof: 'hip', roofColor: 'clay', trim: 'woodDeep', door: 'double', windows: 'tall', chimney: true, flag: 'clay', awning: 'none' },
    palettes: [{ wallColor: 'sand', roofColor: 'slateDeep', trim: 'woodDeep', flag: 'butter' }, { wallColor: 'stone', roofColor: 'leafDeep', trim: 'woodDeep', flag: 'blossom' }],
    props: [prop('signboard', 'left'), prop('well', 'right'), prop('bench', 'front')], yard: 'stone', emblem: EMBLEMS.board,
  },
  garden: {
    name: 'Greenhouse', tagline: 'Small habits, tended daily', topic: 'habit',
    pitch: 'Grows small daily habits with a gentle check-in and a streak that blooms.',
    words: ['garden', 'plant', 'grow', 'green', 'seed', 'flower', 'herb', 'veg', 'harvest', 'farm', 'compost', 'bloom'],
    style: { shape: 'greenhouse', walls: 'glass', wallColor: 'water', roof: 'gable', roofColor: 'leafDeep', trim: 'cream', door: 'sliding', windows: 'tall', chimney: false, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'water', roofColor: 'leaf', trim: 'woodDeep' }, { wallColor: 'cream', roofColor: 'leafDeep', trim: 'leafDeep' }],
    props: [prop('gardenbed', 'left'), prop('pottedplant', 'right'), prop('beehive', 'front')], yard: 'garden', emblem: EMBLEMS.sprout,
  },
  sky: {
    name: 'Observatory', tagline: 'A clear view of the week', topic: 'weekly review',
    pitch: 'A weekly look at what your crew did: runs, time spent and what it cost.',
    words: ['star', 'sky', 'telescope', 'space', 'astro', 'observ', 'insight', 'analytic', 'stats', 'metric', 'report', 'dashboard', 'usage', 'cost', 'trend'],
    style: { shape: 'observatory', walls: 'stone', wallColor: 'cream', roof: 'dome', roofColor: 'slate', trim: 'stoneDeep', door: 'arched', windows: 'round', chimney: false, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'stone', roofColor: 'lavender', trim: 'stoneDeep' }, { wallColor: 'sand', roofColor: 'slateDeep', trim: 'woodDeep' }],
    props: [prop('telescope', 'right'), prop('bench', 'left')], yard: 'stone', emblem: EMBLEMS.star,
  },
  music: {
    name: 'Listening room', tagline: 'Every word, written down', topic: 'recording',
    pitch: 'Transcribes voice memos and recordings on your PC and files the notes.',
    words: ['music', 'song', 'audio', 'podcast', 'voice', 'sound', 'whisper', 'transcri', 'speech', 'listen', 'memo', 'guitar', 'piano', 'band', 'sing', '=mic'],
    style: { shape: 'cottage', walls: 'plaster', wallColor: 'lavender', roof: 'thatch', roofColor: 'honey', trim: 'woodDeep', door: 'arched', windows: 'round', chimney: true, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'honey', trim: 'woodDeep' }, { wallColor: 'blossom', roofColor: 'woodLight', trim: 'woodDeep' }],
    props: [prop('musicstand', 'left'), prop('lantern', 'right'), prop('bench', 'front')], yard: 'flowers', emblem: EMBLEMS.note,
  },
  forge: {
    name: 'Workshop', tagline: 'Small tools, made to order', topic: 'tool',
    pitch: 'A bench for small scripts and tools you ask the crew to make.',
    words: ['tool', 'build', 'forge', 'skill', 'agent', 'code', 'script', 'make', 'craft', 'workshop', 'tinker', 'repair', 'smith', 'automat', '=bot', '=app', '=fix'],
    style: { shape: 'workshop', walls: 'log', wallColor: 'wood', roof: 'shingle', roofColor: 'stoneDeep', trim: 'woodDeep', door: 'sliding', windows: 'square', chimney: true, flag: 'honey', awning: 'none' },
    palettes: [{ wallColor: 'woodLight', roofColor: 'clayDeep', trim: 'woodDeep', flag: 'clay' }, { wallColor: 'wood', roofColor: 'slateDeep', trim: 'woodDeep', flag: 'butter' }],
    props: [prop('anvil', 'left'), prop('workbench', 'right'), prop('kiln', 'front')], yard: 'path', emblem: EMBLEMS.hammer,
  },
  mill: {
    name: 'Mill', tagline: 'Raw files in, tidy data out', topic: 'batch',
    pitch: 'Grinds messy files into tidy tables, one batch at a time.',
    words: ['data', 'pipeline', 'process', 'convert', 'batch', 'import', 'export', 'spreadsheet', '=csv', 'transform'],
    style: { shape: 'mill', walls: 'stone', wallColor: 'cream', roof: 'gable', roofColor: 'woodDeep', trim: 'woodDeep', door: 'plain', windows: 'square', chimney: false, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'stone', roofColor: 'clayDeep', trim: 'woodDeep' }, { wallColor: 'sand', roofColor: 'slateDeep', trim: 'woodDeep' }],
    props: [prop('barrels', 'left'), prop('handcart', 'right'), prop('crates', 'front')], yard: 'path', emblem: EMBLEMS.gear,
  },
  fish: {
    name: 'Fishing hut', tagline: 'Casts a line, reels in the news', topic: 'news',
    pitch: 'Casts a line each morning for news on topics you follow and reels in a short digest.',
    words: ['fish', 'pond', 'lake', 'boat', 'sail', 'news', 'digest', 'feed', '=rss', 'catch', 'headline', 'newsletter'],
    style: { shape: 'cottage', walls: 'log', wallColor: 'wood', roof: 'thatch', roofColor: 'honey', trim: 'woodDeep', door: 'plain', windows: 'round', chimney: true, flag: 'water', awning: 'none' },
    palettes: [{ wallColor: 'woodLight', roofColor: 'slate', trim: 'woodDeep', flag: 'clay' }, { wallColor: 'wood', roofColor: 'leafDeep', trim: 'woodDeep', flag: 'butter' }],
    props: [prop('fishingrack', 'right'), prop('barrels', 'left'), prop('lantern', 'front')], yard: 'sand', emblem: EMBLEMS.fish,
  },
  bakery: {
    name: 'Bakery', tagline: 'Good bakes, written down and repeated', topic: 'baking',
    pitch: 'Keeps your bread and bake recipes, scales them and times each bake.',
    words: ['bak', 'bread', 'cake', 'pastr', 'recipe', 'loaf', 'loaves', 'sourdough', 'dough', '=oven', 'cookie', 'muffin', '=pie', 'pies', 'croissant', '=bun', 'buns'],
    style: { shape: 'shop', walls: 'plaster', wallColor: 'butter', roof: 'gable', roofColor: 'clayDeep', trim: 'woodDeep', door: 'plain', windows: 'shopfront', chimney: true, flag: 'none', awning: 'clay' },
    palettes: [{ wallColor: 'cream', roofColor: 'clay', trim: 'woodDeep', awning: 'honey' }, { wallColor: 'blossom', roofColor: 'woodDeep', trim: 'woodDeep', awning: 'clay' }],
    props: [prop('crates', 'left'), prop('barrels', 'right'), prop('signboard', 'front')], yard: 'path', emblem: EMBLEMS.bread,
  },
  kitchen: {
    name: 'Kitchen', tagline: 'Fresh plans every morning', topic: 'meal plan',
    pitch: "Plans the week's meals and turns them into one shopping list.",
    words: ['cook', 'kitchen', 'food', 'meal', 'grocer', 'dinner', 'lunch', 'breakfast', 'snack', '=menu', 'supper'],
    style: { shape: 'cottage', walls: 'log', wallColor: 'woodLight', roof: 'gable', roofColor: 'clay', trim: 'woodDeep', door: 'plain', windows: 'square', chimney: true, flag: 'none', awning: 'none' },
    palettes: [{ wallColor: 'butter', roofColor: 'leafDeep', trim: 'woodDeep' }, { wallColor: 'cream', roofColor: 'clayDeep', trim: 'woodDeep' }],
    props: [prop('gardenbed', 'left'), prop('barrels', 'right'), prop('crates', 'front')], yard: 'garden', emblem: EMBLEMS.pot,
  },
  market: {
    name: 'Trading post', tagline: 'Stock, prices and a tidy ledger', topic: 'ledger',
    pitch: "Keeps a shop's stock, prices and ledger tidy and adds up each month.",
    words: ['money', 'budget', 'bank', 'financ', 'shop', 'store', 'market', 'sell', 'trade', 'price', 'expense', 'invoice', 'ledger', 'credit', 'inventory', 'merch'],
    style: { shape: 'shop', walls: 'plank', wallColor: 'woodLight', roof: 'gable', roofColor: 'leafDeep', trim: 'woodDeep', door: 'double', windows: 'shopfront', chimney: false, flag: 'none', awning: 'butter' },
    palettes: [{ wallColor: 'cream', roofColor: 'slateDeep', trim: 'woodDeep', awning: 'leaf' }, { wallColor: 'wood', roofColor: 'clayDeep', trim: 'woodDeep', awning: 'blossom' }],
    props: [prop('crates', 'left'), prop('handcart', 'right'), prop('signboard', 'front')], yard: 'path', emblem: EMBLEMS.coin,
  },
  clock: {
    name: 'Clock tower', tagline: 'Nothing sneaks up on you', topic: 'reminder',
    pitch: 'Keeps your deadlines and nudges you a few days before each one.',
    words: ['calendar', 'time', 'clock', 'schedule', 'deadline', 'remind', 'alarm', 'timetable', 'agenda', '=due', 'appointment'],
    style: { shape: 'tower', walls: 'brick', wallColor: 'clay', roof: 'hip', roofColor: 'slateDeep', trim: 'cream', door: 'arched', windows: 'round', chimney: false, flag: 'butter', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'clayDeep', trim: 'woodDeep', flag: 'slate' }, { wallColor: 'sand', roofColor: 'leafDeep', trim: 'woodDeep', flag: 'clay' }],
    props: [prop('lantern', 'left'), prop('bench', 'right')], yard: 'stone', emblem: EMBLEMS.clock,
  },
  academy: {
    name: 'Expert academy', tagline: 'Know-how, kept fresh', topic: 'study',
    pitch: 'Keeps what you have learned fresh, with quick quizzes and refreshers.',
    words: ['expert', 'teach', 'tutor', 'knowledge', 'lesson', 'mentor', 'academy', 'quiz', 'flashcard'],
    style: { shape: 'hall', walls: 'stone', wallColor: 'cream', roof: 'hip', roofColor: 'slate', trim: 'slateDeep', door: 'double', windows: 'tall', chimney: false, flag: 'lavender', awning: 'none' },
    palettes: [{ wallColor: 'stone', roofColor: 'lavender', trim: 'stoneDeep', flag: 'butter' }, { wallColor: 'sand', roofColor: 'slateDeep', trim: 'woodDeep', flag: 'clay' }],
    props: [prop('chalkboard', 'left'), prop('scrollrack', 'right'), prop('bookcart', 'front')], yard: 'stone', emblem: EMBLEMS.cap,
  },
  signal: {
    name: 'Signal tower', tagline: 'Rings when something needs you', topic: 'alert',
    pitch: 'Watches the things you care about and rings a calm bell when one needs you.',
    words: ['radio', 'antenna', 'signal', 'monitor', 'watch', 'alert', 'ping', 'uptime', 'github', '=ci', 'notif', 'status'],
    style: { shape: 'tower', walls: 'plank', wallColor: 'slate', roof: 'flat', roofColor: 'stoneDeep', trim: 'woodDeep', door: 'plain', windows: 'square', chimney: false, flag: 'clay', awning: 'none' },
    palettes: [{ wallColor: 'cream', roofColor: 'slateDeep', trim: 'woodDeep', flag: 'butter' }, { wallColor: 'woodLight', roofColor: 'clayDeep', trim: 'woodDeep', flag: 'slate' }],
    props: [prop('antenna', 'right'), prop('lantern', 'left')], yard: 'grass', emblem: EMBLEMS.bell,
  },
  health: {
    name: 'Wellness spring', tagline: 'A gentle check-in, every day', topic: 'check-in',
    pitch: 'A gentle daily check-in on sleep, movement and how you feel.',
    words: ['health', 'fitness', '=gym', 'running', 'walk', 'sleep', 'exercise', 'workout', 'meditat', 'yoga', 'stretch', 'wellness', 'mood'],
    style: { shape: 'pavilion', walls: 'plaster', wallColor: 'cream', roof: 'dome', roofColor: 'leaf', trim: 'leafDeep', door: 'arched', windows: 'tall', chimney: false, flag: 'leaf', awning: 'none' },
    palettes: [{ wallColor: 'blossom', roofColor: 'leafDeep', trim: 'leafDeep', flag: 'blossom' }, { wallColor: 'sand', roofColor: 'water', trim: 'slateDeep', flag: 'none' }],
    props: [prop('fountain', 'front'), prop('bench', 'left'), prop('pottedplant', 'right')], yard: 'flowers', emblem: EMBLEMS.heart,
  },
  cottage: {
    name: 'Idea cottage', tagline: 'A tidy little home for a new idea', topic: 'small',
    pitch: 'A tidy little place to try out a new idea with the crew.',
    words: [],
    style: { ...DEFAULT_STYLE },
    palettes: [{ wallColor: 'butter', roofColor: 'slate', trim: 'woodDeep' }, { wallColor: 'blossom', roofColor: 'leafDeep', trim: 'woodDeep' }],
    props: [prop('bench', 'left'), prop('pottedplant', 'right')], yard: 'grass', emblem: EMBLEMS.house,
  },
});

const THEME_ORDER = Object.keys(THEMES);

// ---------------------------------------------------------------------------------------------
// Words

const STOP = new Set(['something', 'somewhere', 'place', 'thing', 'things', 'stuff', 'for', 'the', 'and', 'with', 'that',
  'this', 'what', 'should', 'could', 'would', 'here', 'there', 'about', 'into', 'from', 'your', 'you', 'mine', 'our',
  'make', 'build', 'want', 'need', 'help', 'helps', 'some', 'any', 'more', 'less', 'like', 'just', 'really', 'good',
  'nice', 'new', 'app', 'apps', 'tool', 'tools', 'idea', 'ideas', 'plot', 'building', 'go', 'goes', 'put', 'can', 'use']);

/** Lowercase word tokens of a text, keeping '&' inside words (d&d). */
export function tokens(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9&+-]+/).map((word) => word.replace(/^[-+]+|[-+]+$/g, '')).filter(Boolean);
}

/** How many of `words` appear in `list` of tokens. '=word' must match whole; others match as prefixes. */
export function wordHits(list, words) {
  let hits = 0;
  for (const word of words) {
    const exact = word.startsWith('=');
    const key = exact ? word.slice(1) : word;
    if (list.some((token) => (exact ? token === key : token.startsWith(key) || (token.length >= 4 && key.startsWith(token) && key.length - token.length <= 2)))) hits += 1;
  }
  return hits;
}

/** Best theme key for an idea text, or 'cottage'. */
export function themeFor(text) {
  const list = tokens(text).filter((token) => !STOP.has(token));
  let best = 'cottage';
  let bestHits = 0;
  for (const key of THEME_ORDER) {
    const hits = wordHits(list, THEMES[key].words);
    if (hits > bestHits) {
      best = key;
      bestHits = hits;
    }
  }
  return best;
}

function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

// ---------------------------------------------------------------------------------------------
// Level trees

function level(n, title, summary, proof) {
  return { level: n, title, summary, proof };
}

export function genericLevels(topic = 'small') {
  return [
    level(1, 'Answers one request', `Hands the crew one ${topic} job and shows the result here.`, "One run finishes and its answer shows in this building's panel."),
    level(2, 'Keeps a tidy folder', 'Saves every result with the date so you can find it again.', "A dated file appears in the building's folder after each run."),
    level(3, 'Works from your files', 'Reads the files you point it at, like notes or recordings, and builds on them.', 'A run given a file mentions a detail that only that file contains.'),
    level(4, 'Runs on a timetable', 'Starts by itself at a time you pick, no prompt needed.', 'A run starts at the set time and its result is waiting when you look.'),
    level(5, "Tells you when it's ready", 'Sends a calm alert with a one-line summary when a run finishes.', 'A finished run shows a MILO alert with its summary.'),
  ];
}

const tree = (...items) => Object.freeze(items.map(([title, summary, proof], index) => Object.freeze(level(index + 1, title, summary, proof))));

// Level trees for the kit's themes: real features for that kind of building, small to full.
// Themes whose pool idea has its own tree (clips, game, archive, draft, townhall, academy) use it.
export const THEME_LEVELS = Object.freeze({
  art: tree(
    ['Files one drawing', 'Saves a finished drawing with its date, title and the stream it came from.', 'The drawing appears in the studio folder with its date and title.'],
    ['Keeps a reference board', 'Collects the reference images for a piece in one folder per drawing.', "Opening a drawing's board shows its reference images side by side."],
    ['Pulls progress shots', 'Takes a few progress frames from the stream recording of each drawing.', 'Four progress frames from one recording appear beside the finished drawing.'],
    ['Tracks where it was posted', 'Notes where and when each drawing was posted.', 'The panel lists each drawing with the places and dates it was posted.'],
    ['Suggests what to draw next', 'Offers prompts drawn from your past work and the themes you come back to.', 'Asking for a prompt returns three ideas, each linked to a past drawing.'],
  ),
  library: tree(
    ['Answers from one file', 'Answers a question about one PDF or note you point it at, quoting the page.', 'An answer appears with a short quote and the page it came from.'],
    ['Keeps a reading shelf', 'Files each reading with its title, date and a three-line summary.', 'The panel lists every reading on the shelf with its summary.'],
    ['Searches the whole shelf', 'Finds which readings mention a topic and what each one says about it.', 'Searching a topic lists each matching reading with a short quote.'],
    ['Links related readings', 'Spots readings that cover the same idea and links them together.', 'Opening a reading shows at least two related ones and why they match.'],
    ['Weekly reading digest', 'Sums up what you read this week and what is worth another look.', "A dated digest appears each Sunday with the week's readings and three ideas to revisit."],
  ),
  post: tree(
    ['Drafts one reply', 'Drafts a reply to one email you paste in, for you to edit and send yourself.', 'A draft reply appears in the panel. Nothing is sent.'],
    ['Matches your voice', 'Learns your tone from a few replies you have written.', 'New drafts use your usual greeting and sign-off.'],
    ['Sorts the pile', 'Sorts a pile of messages into reply, read later and archive.', 'Every message in a pasted pile comes back with one of the three labels.'],
    ['Keeps reply templates', 'Saves replies you send often as templates.', 'A saved template fills a new draft with one click.'],
    ['Morning post', 'Has drafts ready each morning for the messages that need you.', 'A morning summary lists new messages that need a reply, each with a draft.'],
  ),
  garden: tree(
    ['Checks in once a day', 'Asks one gentle question about a habit each day and notes your answer.', "Today's check-in and your answer appear in the panel."],
    ['Grows a streak', 'Shows each habit as a plant that grows with every day you keep it.', 'Keeping a habit three days running shows a bigger plant than on day one.'],
    ['Weekly bloom report', 'Sums up the week: which habits held and which slipped.', 'A weekly note lists each habit with its days kept out of seven.'],
    ['Gentle nudges', 'Sends a calm MILO alert at a time you pick if a habit is still open.', 'An open habit brings one alert at the set time, and none once it is done.'],
    ['Adjusts the goal', 'Suggests a smaller step when a habit keeps slipping.', 'A habit missed four times in a week gets one concrete, smaller suggestion.'],
  ),
  sky: tree(
    ["Counts the week's runs", "Counts your crew's runs this week by agent and project.", 'The panel shows run counts per agent that match the Watchtower.'],
    ['Adds up the time', 'Adds up how long each project kept the crew busy.', 'Each project shows its hours this week, and they add up to the total.'],
    ['Totals the cost', 'Reads the usage your tools report and totals the cost for the week.', "The week's cost appears beside each tool, with a total."],
    ['Draws a star chart', 'Draws the week as a small chart of runs per day.', 'A seven-bar chart of runs per day appears, one bar for each day.'],
    ['Sunday review', 'Writes a short review of the week with one thing to try next week.', "A dated review appears each Sunday with the week's numbers and one suggestion."],
  ),
  music: tree(
    ['Transcribes one recording', 'Turns one voice memo into text with Whisper, on your PC.', "A text file with the memo's words appears beside the recording."],
    ['Files the transcripts', 'Names and dates each transcript and files it by topic.', 'Each new transcript lands in a dated folder with a short title.'],
    ['Pulls out the to-dos', 'Picks out the tasks and dates you mentioned in a recording.', "A memo that mentions a task shows it in the panel's to-do list."],
    ['Searches what you said', 'Finds which recordings mention a word or a topic.', 'Searching a topic lists each recording that mentions it, with the quote.'],
    ['Watches a folder', 'Transcribes new recordings in a folder you pick as they arrive.', 'A recording dropped in the folder has its transcript within a few minutes.'],
  ),
  forge: tree(
    ['Makes one small script', 'Asks the crew for one small script from a sentence you type.', 'A script file appears in the workshop folder and runs without errors.'],
    ['Tests before handing over', 'Runs each new script on a sample and shows what it did.', 'Each script arrives with a short test log from a sample run.'],
    ['Keeps a tool shelf', 'Lists every script with what it does and how to run it.', 'The panel lists each tool with a one-line description and its command.'],
    ['Fixes what breaks', 'Takes an error message and has the crew repair the script.', 'A script that failed runs cleanly after one repair request.'],
    ['Tools on a button', 'Runs any tool on the shelf from its panel with one click.', "Clicking a tool's button runs it and shows its output in the panel."],
  ),
  mill: tree(
    ['Tidies one file', 'Turns one messy CSV or spreadsheet into a clean table.', 'A cleaned copy appears with consistent columns and no blank rows.'],
    ['Remembers the recipe', 'Saves the cleaning steps so the next file of that kind takes one click.', 'A second file of the same kind comes out clean with no new instructions.'],
    ['Batches a folder', 'Cleans every file in a folder in one run.', 'Every file in the folder gets a cleaned copy and a one-line report.'],
    ['Checks the numbers', 'Flags rows that look wrong, like dates in the future or missing totals.', 'A file with a planted bad row comes back with that row flagged.'],
    ['Runs on a timetable', 'Cleans new files as they arrive each day.', 'A file added in the morning has its clean copy waiting by the afternoon.'],
  ),
  fish: tree(
    ['Catches one topic', 'Gathers the latest on one topic you follow into a short digest.', 'A digest with five items and their links appears in the panel.'],
    ['Keeps a tackle box', 'Saves the topics and sources you follow.', 'The panel lists your topics, and each digest uses only those sources.'],
    ['Throws back repeats', 'Leaves out stories you have already seen.', "A story from yesterday's digest doesn't appear again today."],
    ['Morning catch', 'Has the digest ready each morning at a time you pick.', "The morning's digest is waiting at the set time with today's date."],
    ['Five-line summary', 'Boils the catch down to a summary you can skim in a minute.', 'The summary fits in five lines and links to each full story.'],
  ),
  bakery: tree(
    ['Keeps one recipe', 'Saves a bake recipe you paste in as a tidy card with its ingredients and steps.', 'A pasted recipe shows up as a card with its ingredients and steps.'],
    ['Scales a recipe', "Scales a recipe to any batch size and works out the baker's percentages.", 'Doubling a loaf recipe doubles every amount and keeps the oven time the same.'],
    ['Logs each bake', 'Notes how each bake went: flour, water, proving time and how it turned out.', 'A dated bake log with its notes appears under the recipe.'],
    ['Bake day timers', 'Walks you through a bake with its steps and named timers, all on your PC.', 'A two-recipe bake runs with named timers, and ticked steps survive a restart.'],
    ['Suggests the next tweak', 'Compares your bake logs and suggests one change to try next time.', 'After three logged bakes, asking returns one concrete change and the bakes behind it.'],
  ),
  kitchen: tree(
    ['Plans a week of dinners', "Plans seven dinners from what you like and what's in season.", 'A dated plan with seven dinners appears in the panel.'],
    ['Writes the shopping list', "Adds up the week's ingredients into one list, grouped by aisle.", 'A shopping list appears with each ingredient once and its total amount.'],
    ['Cooks from the cupboard', "Plans around what's already in your fridge and cupboards.", 'Listing three things you have gives a plan that uses all three.'],
    ['Keeps your favourites', 'Remembers the dinners you liked and brings them back now and then.', 'A dinner marked as a favourite shows up again within a month.'],
    ['Sunday prep', "Has next week's plan and shopping list ready every Sunday morning.", 'A dated plan and shopping list are waiting each Sunday morning.'],
  ),
  market: tree(
    ['Keeps one ledger', 'Records the sales and costs you type in and keeps a running total.', 'Adding three entries shows a total that matches their sum.'],
    ['Tracks the stock', 'Keeps a count for each item and lowers it with each sale.', 'Selling two of an item lowers its stock count by two.'],
    ['Does the monthly books', 'Adds up each month: money in, money out and what is left.', 'A monthly summary appears with totals that match the ledger.'],
    ['Warns when stock runs low', 'Lists items that fall below a level you set.', 'An item falling below its set level shows up on the warning list.'],
    ['Checks the prices', "Shows each item's margin and flags anything priced below cost.", 'An item priced below its cost appears flagged with its margin.'],
  ),
  clock: tree(
    ['Lists your deadlines', 'Keeps the deadlines you type in, sorted by date.', 'The panel lists each deadline in date order with the days left.'],
    ['Reads a syllabus', 'Pulls due dates out of a syllabus or email you paste in.', 'Pasting a syllabus adds each of its due dates to the list.'],
    ['Nudges ahead of time', 'Sends a calm MILO alert a few days before each deadline.', 'A deadline three days out brings one alert with its name and date.'],
    ['Plans the run-up', 'Splits a big deadline into small steps across the days before it.', 'A deadline two weeks out gets a dated step plan that ends the day before.'],
    ['Weekly look ahead', 'Sums up the next two weeks every Monday morning.', "A Monday note lists the next fourteen days' deadlines and steps."],
  ),
  signal: tree(
    ['Watches one thing', 'Checks one page, file or service you choose and notes when it changes.', 'A change to the watched item shows up in the panel with the time.'],
    ['Rings a calm bell', 'Sends a MILO alert when something you watch changes.', 'A change brings exactly one alert naming what changed.'],
    ['Watches several things', 'Keeps a list of things to watch, each with its own check.', 'The panel lists each watched item with its last check and status.'],
    ['Keeps quiet hours', 'Holds alerts during times you pick and sums them up afterwards.', 'Changes during quiet hours arrive as one summary when they end.'],
    ['Explains the change', 'Says what changed and whether it needs you, in one line.', 'Each alert carries a one-line reason and a needs-you or for-your-info label.'],
  ),
  health: tree(
    ['Daily check-in', 'Asks how you slept, moved and feel, in three quick taps.', "Today's three answers appear in the panel after the check-in."],
    ['Keeps a gentle log', 'Saves each check-in by date so you can look back.', 'The panel shows the last seven check-ins in order.'],
    ['Spots patterns', 'Notices links, like a better mood on days with a walk.', 'A week of check-ins shows at least one pattern with the days behind it.'],
    ['Kind reminders', "Reminds you calmly at a time you pick if you haven't checked in.", 'A missed check-in brings one calm alert at the set time.'],
    ['Monthly note', 'Writes a short, kind summary of the month.', 'A dated monthly note appears with averages for sleep, movement and mood.'],
  ),
});

const STUDY_LEVELS = tree(
  ['Summarises one reading', 'Turns one course reading into a one-page summary with its key terms.', 'A summary with a key-terms list appears beside the reading.'],
  ['Pulls out the method', "For a journal article, notes the question, sample, method and main result.", "The article's summary shows its question, sample, method and result on separate lines."],
  ['Makes flashcards', "Turns each summary's key terms into flashcards you can review.", 'A deck of at least ten cards for one reading opens in the panel.'],
  ['Plans the reading week', "Spreads the week's readings over the days you pick, around due dates.", "The panel shows this week's readings, one or two a day, done before each due date."],
  ['Quizzes you before class', 'Asks five questions on the readings due next and marks what to reread.', 'A five-question quiz appears with answers and the pages to reread for any you missed.'],
);

const REQUEST_LEVELS = tree(
  ["Collects one stream's requests",'Gathers the drawing requests from one saved stream chat into a list.', 'The panel lists each request from a saved chat log, with who asked.'],
  ['Pins them to the board', 'Keeps requests from stream to stream and marks the ones you have drawn.', 'A request drawn last stream shows as done, and the rest stay pinned.'],
  ['Picks the next sketch', 'Suggests the next request by how often it was asked and how long it has waited.', 'Asking for a pick returns one request with how many asked and when.'],
  ['Groups the repeats', 'Merges requests that ask for the same thing in different words.', 'Two requests for the same subject in different words show as one, asked twice.'],
  ['Listens while you stream', 'Reads chat during a stream and pins new requests as they come in.', 'A request typed in chat during a stream appears on the board within a minute.'],
);

const STREAM_LEVELS = tree(
  ['Runs the go-live checklist', 'Walks through your go-live steps and ticks each one off.', 'The checklist shows every step ticked before the stream starts.'],
  ['Writes the stream title', 'Suggests a title and tags from what you plan to draw.', 'Three title ideas appear, each within the length the platform allows.'],
  ['Drafts the go-live post', 'Drafts a short post for when you go live, for you to send.', 'A go-live post appears ready to copy. Nothing is posted for you.'],
  ['Marks the highlights', 'Lets you mark moments during the stream with one key.', 'Marked moments appear after the stream as a list of timestamps.'],
  ['Wraps up the stream', 'Files the recording and hands the marked moments on as clip ideas.', 'The recording is filed by date and its marks show up as clip ideas.'],
);

// ---------------------------------------------------------------------------------------------
// The idea pool
//
// evidence: { skill: RegExp on skill names, text: RegExp on skill descriptions, project: RegExp on
// project folder names }. Ideas with evidence are tailored; the others are good general picks.

export const PLOT_TRAITS = Object.freeze({
  'plot-meadow': ['wide', 'open', 'busy', 'sport'],
  'plot-rise': ['high', 'sunny', 'view', 'studio'],
  'plot-birch': ['quiet', 'shade', 'books'],
  'plot-pond': ['water', 'cozy', 'games'],
  'plot-orchard': ['garden', 'old', 'craft'],
});
export const PLOT_ORDER = Object.freeze(Object.keys(PLOT_TRAITS));

const PLOT_FLAVOUR = {
  'plot-meadow': 'The long meadow has room for something big',
  'plot-rise': 'Sunny rise gets the best light and view',
  'plot-birch': 'Birch hollow is quiet and shady',
  'plot-pond': 'This plot sits right by the pond',
  'plot-orchard': 'The old orchard has good soil and old trees',
};

// Where a plot's flavour really is the reason (a telescope on the rise, a fishing hut by the pond).
// Anywhere else an idea keeps its own why. At most one card per plot uses the flavour.
const FLAVOUR_FITS = {
  'plot-meadow': ['town-hall', 'draft-room', 'workshop'],
  'plot-rise': ['observatory', 'clock-tower', 'gallery'],
  'plot-birch': ['library', 'study-hall', 'campaign-archive', 'listening-room'],
  'plot-pond': ['fishing-hut'],
  'plot-orchard': ['greenhouse', 'kitchen', 'wellness-spring'],
};

export const IDEAS = Object.freeze([
  {
    key: 'clip-studio', title: 'Clip studio', theme: 'clips', base: 3, traits: ['studio', 'sunny'],
    general: 'Short clips carry a long stream a lot further',
    pitch: 'Turns your drawing streams into short vertical clips, ready for TikTok.',
    purpose: 'Finds the best moments in your drawing streams and turns them into short vertical clips, ready for TikTok.',
    keywords: ['drawing', 'short'],
    evidence: { skill: /video|clip|tiktok|stream|edit/i, text: /tiktok|youtube|clip|stream|editing|ffmpeg/i, project: /clip|video|stream|tiktok/i },
    levels: [
      level(1, 'Finds the best moments', 'Reads one stream recording and lists the moments worth a clip, with timestamps.', 'A list of timestamps for one recording appears in the clips folder.'),
      level(2, 'Cuts a clip', 'Cuts one chosen moment into a short clip with ffmpeg.', 'A clip file appears in the output folder and plays start to finish.'),
      level(3, 'Vertical crop and captions', 'Crops to 9:16 around your canvas and adds captions from Whisper, on your PC.', 'A 1080x1920 clip with readable captions plays end to end.'),
      level(4, 'Speeds up the slow parts', 'Ramps through long stretches of drawing so each clip stays under a minute.', 'A 20-minute segment becomes a clip under 60 seconds.'),
      level(5, 'A whole stream in one go', 'Turns a full stream into a batch of ready-to-post clips while you rest.', 'Five or more clips from one stream land in the folder, each under 60 seconds.'),
    ],
  },
  {
    key: 'game-table', title: 'Game table', theme: 'game', base: 2, traits: ['games', 'cozy'],
    general: 'Game prep goes faster with the numbers done for you',
    pitch: 'Builds balanced Pathfinder encounters and session plans for your table.',
    purpose: 'Builds balanced PF2e encounters and session plans for your games, using your expert packs.',
    keywords: ['session', 'party', 'prep'],
    evidence: { skill: /pf2e|pathfinder|ttrpg|dnd|d-and-d|encounter|dungeon|rpg/i, text: /pathfinder|pf2e|ttrpg|encounter|dungeon/i, project: /pf2e|pathfinder|dnd|ttrpg|campaign|dungeon|labyrinth/i },
    levels: [
      level(1, 'Builds one encounter', 'Builds a balanced PF2e encounter from a party level, size and theme you give it.', "An encounter with its XP budget and threat level appears in this building's panel."),
      level(2, 'Keeps a session folder', 'Saves each encounter, with monsters and tactics, in a folder per session.', 'A session folder with a dated encounter file appears after a run.'),
      level(3, 'Tunes the difficulty', "Checks an encounter against the GM Core rules and suggests a fix when it's swingy.", 'A deliberately overtuned encounter comes back flagged with a concrete fix.'),
      level(4, 'Plans a whole session', "Lays out a session's encounters, hazards and pacing around your current arc.", 'A session plan lists 3 to 5 scenes with threat levels that rise and fall.'),
      level(5, 'Prep night in one go', "Turns your last session's notes into next session's prep while you rest.", "Next session's plan and stat blocks appear, built from the notes you dropped in."),
    ],
  },
  {
    key: 'campaign-archive', title: 'Campaign archive', theme: 'archive', base: 1, traits: ['books', 'quiet', 'old'],
    general: 'A long campaign is easier when every NPC is one question away',
    pitch: "Keeps your campaign's arcs, NPCs and session recaps, ready to recall.",
    keywords: ['campaign', 'npc', 'recap', 'lore', 'notes'],
    evidence: { skill: /campaign|ttrpg|lore|worldbuild/i, text: /campaign|arc structure|worldbuild|lore/i, project: /campaign|lore|world/i },
    levels: [
      level(1, 'Recalls one thing', 'Answers a question about your campaign from its notes, like who an NPC is.', 'Asking about an NPC returns their role and the session they first appeared in.'),
      level(2, 'Files session recaps', "Turns a session's rough notes into a tidy recap in the archive.", 'A dated recap with the key events appears in the archive folder.'),
      level(3, 'Tracks your arcs', 'Keeps your A, B and C plots with where each one stands.', 'The panel lists each arc with its last session and its next beat.'),
      level(4, 'Keeps a cast list', 'Builds a list of NPCs, places and factions as they show up.', 'An NPC first mentioned in new notes appears in the list after the next run.'),
      level(5, 'Drafts the next arc', "Drafts the next arc's beats from what has happened so far, grounded in the archive.", 'An arc outline appears that cites at least three past sessions.'),
    ],
  },
  {
    key: 'draft-room', title: 'Draft room', theme: 'draft', base: 2, traits: ['sport', 'wide'],
    general: 'Draft day is calmer with your tiers already on the wall',
    pitch: 'Keeps your fantasy draft board, tiers and sleepers ready for draft day.',
    keywords: ['player', 'fantasy', 'football'],
    evidence: { skill: /fantasy|football|nfl|draft|sports?/i, text: /fantasy|football|adp|draft/i, project: /fantasy|football|draft|league/i },
    levels: [
      level(1, 'Builds a cheat sheet', "Makes one tiered cheat sheet for your league's scoring and roster size.", "A tiered list by position appears in this building's folder."),
      level(2, 'Tracks ADP', 'Pulls current ADP and marks players going later than their tier.', 'The sheet shows ADP beside each player, with value picks marked.'),
      level(3, 'Mock draft partner', 'Runs a mock draft with you, pick by pick, and explains its picks.', 'A full mock draft log with a reason for each pick appears.'),
      level(4, 'Live draft helper', "Suggests your next pick from who's left and what your roster needs.", 'Entering the last few picks returns a best-available pick and a backup.'),
      level(5, 'In-season manager', 'Checks waivers and start/sit calls each week and leaves a short note.', 'A weekly note appears with waiver targets and lineup calls for your team.'),
    ],
  },
  {
    key: 'sorting-office', title: 'Sorting office', theme: 'post', base: 2, traits: ['busy', 'water'],
    general: 'A big pile is easier once someone has sorted it',
    pitch: 'Hands piles of email, notes and tickets to Jev and files each verdict.',
    keywords: ['sort', 'triage', 'inbox', 'email', 'pile', 'label'],
    evidence: { skill: /^jev$|triage|sort|classif/i, text: /triage|sort|classif|inbox/i, project: /triage|inbox|sort/i },
    levels: [
      level(1, 'Sorts one pile', 'Hands one list of emails or notes to Jev and shows each verdict.', 'Every item in a pasted list comes back with a label in the panel.'),
      level(2, 'Files the verdicts', 'Saves each sorted pile as a table you can open in Excel.', 'A dated CSV with one row per item appears in the office folder.'),
      level(3, 'Remembers your labels', 'Keeps your favourite label sets so a new pile needs one click.', 'A saved label set sorts a new pile without retyping the labels.'),
      level(4, 'Drafts the replies', 'Has the crew draft replies for the items Jev marks as needing one.', 'Items marked as needing a reply each get a draft to read. Nothing is sent.'),
      level(5, 'Morning sort', 'Sorts a folder of new items each morning and leaves a short summary.', 'A morning summary appears on schedule with a count for each label.'),
    ],
  },
  {
    key: 'town-hall', title: 'Town hall', theme: 'townhall', base: 2, traits: ['wide', 'busy', 'open'],
    general: 'Daily tasks feel lighter pinned up where you can see them',
    pitch: (ev) => (ev.projects.length
      ? `Hangs your ${ev.projects[0]} quest board in the village, with today's quests on the wall.`
      : 'A quest board in the village for your habits and daily tasks.'),
    keywords: ['habit', 'quest', 'task', 'todo', 'goal'],
    evidence: { skill: /habit|quest|todo|task/i, text: /habit tracker|quest board|to-do/i, project: /habitack|habit|quest|todo/i },
    levels: [
      level(1, "Shows today's quests", "Reads your quest board and shows today's quests on the hall's wall.", "The hall's panel lists the same quests your quest board shows today."),
      level(2, 'Posts a new quest', 'Adds a quest to the board from a sentence you type here.', 'A quest typed in the hall appears on the quest board.'),
      level(3, 'Weekly town meeting', 'Sums up the week: quests done, streaks kept, what slipped.', 'A weekly recap with done and missed counts appears each Sunday.'),
      level(4, 'Quests for the crew', "Turns the app's open priorities into tasks the crew can pick up.", 'An open priority becomes a crew task with its own branch and a summary.'),
      level(5, 'Village festival', 'Celebrates long streaks in the village with a small, calm reveal.', 'Keeping a 7-day streak hangs a festival banner in the town square.'),
    ],
  },
  {
    key: 'skill-forge', title: 'Skill forge', theme: 'forge', base: 1, traits: ['craft', 'old'],
    general: 'A good tutorial can become a skill your crew keeps',
    pitch: 'Turns tutorial videos into new Claude skills, start to finish.',
    keywords: ['skill', 'tutorial', 'agent', 'automate', 'workflow'],
    evidence: { skill: /video-to-agent|to-agent|skill-creator|skill-?maker|agent-?builder/i, text: /into a (working )?(claude code )?skill|scaffolds a skill|turn .* into .* skill/i, project: /skills?|agents?/i },
    levels: [
      level(1, 'Reads one tutorial', 'Watches one tutorial video and writes down the steps it teaches.', 'A step list with timestamps for one video appears in the forge folder.'),
      level(2, 'Drafts a skill', 'Turns those steps into a draft SKILL.md for Claude Code.', 'A SKILL.md with a name, description and steps appears in a drafts folder.'),
      level(3, 'Tests the skill', 'Runs the draft skill on a small example and notes what broke.', 'A test report shows the example run and any steps that failed.'),
      level(4, 'Installs with your okay', 'Moves a skill you approve into your skills folder.', "An approved skill shows up in Claude Code's list of skills."),
      level(5, 'Keeps skills fresh', 'Rechecks each forged skill every month against newer videos.', 'A monthly note lists any forged skill whose steps have changed.'),
    ],
  },
  {
    key: 'expert-academy', title: 'Expert academy', theme: 'academy', base: 0, traits: ['books', 'quiet', 'high'],
    general: 'What you learn stays useful with a quick refresher now and then',
    pitch: 'Keeps your expert packs fresh and tells you which ones are getting stale.',
    keywords: ['expert', 'learn', 'knowledge', 'research', 'topic'],
    evidence: { skill: /^expert-|video-expert/i, text: /expertise pack|expert knowledge/i, project: /expert|research/i },
    why: (ev) => {
      const packs = ev.skills.filter((name) => /^expert-/i.test(name));
      if (packs.length >= 2) return `You have ${packs.length} expert packs, like ${packs[0]}`;
      return null;
    },
    levels: [
      level(1, 'Lists your experts', 'Shows every expert pack with its topic and the date it was built.', 'The panel lists each expert-* skill with its build date.'),
      level(2, 'Spots stale packs', 'Flags packs older than a season, like rankings before a new draft.', 'A pack older than 90 days shows up marked as stale.'),
      level(3, 'Refreshes one pack', 'Reruns the research on a stale topic and shows what changed.', 'A refreshed pack appears with a short list of the claims that changed.'),
      level(4, 'Quizzes you', 'Asks you a few questions from a pack so the knowledge sticks.', 'A five-question quiz from one pack appears with answers and sources.'),
      level(5, 'Picks the next topic', 'Suggests a new expert pack to build from your projects and skills.', 'A suggested topic appears with five candidate videos to learn from.'),
    ],
  },
  // General picks: no evidence needed, placed by how well they suit a plot.
  { key: 'library', title: 'Library', theme: 'library', base: 1, traits: ['quiet', 'books', 'shade'], why: 'Every village needs one, and yours has none yet' },
  { key: 'observatory', title: 'Observatory', theme: 'sky', base: 1, traits: ['high', 'view'], why: 'Your crew works a lot. This shows you where the time goes' },
  { key: 'greenhouse', title: 'Greenhouse', theme: 'garden', base: 1, traits: ['garden', 'sunny'], why: 'A small daily habit is easier with a gentle nudge' },
  { key: 'workshop', title: 'Workshop', theme: 'forge', base: 1, traits: ['craft', 'wide'], why: 'Handy for the small scripts your crew could make for you' },
  { key: 'gallery', title: 'Gallery', theme: 'art', base: 1, traits: ['sunny', 'quiet', 'studio'], pitch: 'Keeps your finished drawings in one place and tracks where each one was posted.', why: 'A home for finished work, apart from the works in progress' },
  { key: 'study-hall', title: 'Study hall', theme: 'library', base: 1, traits: ['quiet', 'books'], pitch: 'Turns course readings into summaries, flashcards and practice questions.', why: 'A quiet room for coursework and readings', emblem: EMBLEMS.cap, keywords: ['course', 'study', 'class', 'exam', 'reading', 'article', 'university', 'college', 'lecture', 'textbook'], tagline: 'Readings in, notes and flashcards out', levels: STUDY_LEVELS },
  { key: 'fishing-hut', title: 'Fishing hut', theme: 'fish', base: 0, traits: ['water', 'cozy'], why: 'A calm morning read without the endless scroll' },
  { key: 'bakery', title: 'Bakery', theme: 'bakery', base: 0, traits: ['cozy', 'busy'], why: 'Bake days go smoother with the steps and timers laid out' },
  { key: 'kitchen', title: 'Kitchen', theme: 'kitchen', base: 0, traits: ['cozy', 'garden'], keywords: ['meal', 'dinner', 'grocer', 'shopping', 'cook', 'week', 'lunch'], why: 'Dinner plans sorted once a week, not every night' },
  { key: 'post-office', title: 'Post office', theme: 'post', base: 0, traits: ['busy', 'water'], pitch: 'Drafts replies to your email for you to read and send yourself.', why: 'Replies drafted for you, and you always press send' },
  { key: 'listening-room', title: 'Listening room', theme: 'music', base: 0, traits: ['water', 'quiet'], why: 'Whisper can already run on your PC' },
  { key: 'clock-tower', title: 'Clock tower', theme: 'clock', base: 0, traits: ['high', 'busy'], why: 'Deadlines are easier when they wave from a distance' },
  { key: 'trading-post', title: 'Trading post', theme: 'market', base: 0, traits: ['water', 'busy'], why: 'Handy for any shop, store or game economy you run' },
  { key: 'stream-booth', title: 'Stream booth', theme: 'clips', base: 0, traits: ['studio', 'busy'], pitch: 'Runs your go-live checklist: scenes, title and a post when you start streaming.', why: 'Going live gets easier with a checklist that runs itself', emblem: recolorEmblem(EMBLEMS.play, { r: 'e' }), keywords: ['stream', 'live', 'twitch', 'obs', 'broadcast'], tagline: 'Checklist done, lights on, going live', levels: STREAM_LEVELS },
  { key: 'request-board', title: 'Request board', theme: 'art', base: 0, traits: ['studio', 'busy'], pitch: 'Collects drawing requests from your stream chat so you can pick the next sketch.', why: 'Chat requests scroll past while you draw', emblem: EMBLEMS.board, keywords: ['drawing', 'stream', 'request', 'chat', 'viewer', 'prompt', 'commission', 'sketch'], tagline: 'Requests pinned up, next sketch picked', levels: REQUEST_LEVELS },
  { key: 'wellness-spring', title: 'Wellness spring', theme: 'health', base: 0, traits: ['garden', 'water'], why: 'A small daily check-in on how you feel' },
]);

const IDEA_BY_KEY = Object.fromEntries(IDEAS.map((idea) => [idea.key, idea]));

// ---------------------------------------------------------------------------------------------
// Evidence

/** For each pool idea, which of Chris's skills and projects point at it. */
export function evidenceFor(idea, signals) {
  const out = { skills: [], textSkills: [], projects: [], score: 0 };
  if (!idea.evidence) return out;
  const { skill, text, project } = idea.evidence;
  for (const item of signals.skills || []) {
    if (skill && skill.test(item.name)) out.skills.push(item.name);
    else if (text && text.test(item.description || '')) out.textSkills.push(item.name);
  }
  for (const name of signals.projects || []) if (project && project.test(name)) out.projects.push(name);
  out.score = 3 * out.skills.length + out.textSkills.length + 3 * out.projects.length;
  return out;
}

function evidenceWhy(idea, ev) {
  if (typeof idea.why === 'function') {
    const custom = idea.why(ev);
    if (custom) return custom;
  }
  const skills = ev.skills.length ? ev.skills : ev.textSkills;
  const parts = [];
  if (skills.length) {
    const shown = skills.slice(0, 2);
    parts.push(`You have the ${listNames(shown)} ${shown.length === 1 ? 'skill' : 'skills'}`);
  }
  if (ev.projects.length) {
    const project = `you're building ${ev.projects[0]}`;
    parts.push(parts.length ? project : project.charAt(0).toUpperCase() + project.slice(1));
  }
  return parts.join(', and ');
}

function isBuilt(idea, built) {
  return built.some((name) => sameTitle(name, idea.title) || sameTitle(name, THEMES[idea.theme].name));
}

const affinity = (idea, plotId) => (PLOT_TRAITS[plotId] || []).filter((trait) => idea.traits.includes(trait)).length;

function scored(signals) {
  return IDEAS.map((idea, order) => {
    const ev = evidenceFor(idea, signals);
    const tailored = ev.score > 0;
    return { idea, ev, order, tailored, score: idea.base + (tailored ? 10 + Math.min(ev.score, 4) : 0) };
  });
}

/** Whether this plot's own flavour is the honest reason for an idea (see FLAVOUR_FITS). */
const flavourFits = (entry, plotId) => !entry.tailored && Boolean(PLOT_FLAVOUR[plotId]) && (FLAVOUR_FITS[plotId] || []).includes(entry.idea.key);

/**
 * A pool idea as a Suggestion. Its why names the evidence when it's tailored to Chris, else it's the
 * idea's own reason; `flavour` uses the plot's flavour instead, where that fits.
 */
function toSuggestion(entry, plotId, { flavour = false } = {}) {
  const { idea, ev, tailored } = entry;
  const theme = THEMES[idea.theme];
  const pitch = typeof idea.pitch === 'function' ? idea.pitch(ev) : idea.pitch || theme.pitch;
  let why = tailored ? evidenceWhy(idea, ev) : '';
  if (!why && flavour && flavourFits(entry, plotId)) why = `${PLOT_FLAVOUR[plotId]}, a good fit for ${article(idea.title)} ${idea.title.toLowerCase()}`;
  if (!why) why = typeof idea.why === 'string' ? idea.why : idea.general || 'A good all-round pick for a new plot';
  return {
    id: `local:${idea.key}`,
    title: cleanText(idea.title, LIMITS.title),
    pitch: cleanText(pitch, LIMITS.pitch, { ellipsis: true }),
    why: cleanText(why, LIMITS.why, { ellipsis: true }),
    source: 'local',
  };
}

// ---------------------------------------------------------------------------------------------
// Sharing the pool out across the plots

function pairValue(entry, plotId, picks) {
  let value = entry.score + 3 * affinity(entry.idea, plotId);
  if (picks.some((other) => other.idea.theme === entry.idea.theme)) value -= 5;
  return value;
}

/**
 * Deterministically shares ideas out: each plot leads with a different tailored idea that suits it,
 * then gets a second tailored one while they last, then general picks. No idea appears twice.
 */
export function allocate(signals, plotIds = PLOT_ORDER) {
  const built = signals.built || [];
  const ids = [...new Set(plotIds)];
  const pool = scored(signals).filter((entry) => !isBuilt(entry.idea, built));
  const picks = Object.fromEntries(ids.map((id) => [id, []]));
  const used = new Set();
  const round = (candidates, cap) => {
    for (;;) {
      let best = null;
      for (const entry of candidates) {
        if (used.has(entry.idea.key)) continue;
        ids.forEach((plotId, plotIndex) => {
          if (picks[plotId].length >= cap) return;
          const value = pairValue(entry, plotId, picks[plotId]);
          if (!best || value > best.value || (value === best.value && (entry.order < best.entry.order
            || (entry.order === best.entry.order && plotIndex < best.plotIndex)))) {
            best = { entry, plotId, plotIndex, value };
          }
        });
      }
      if (!best) return;
      used.add(best.entry.idea.key);
      picks[best.plotId].push(best.entry);
    }
  };
  const tailored = pool.filter((entry) => entry.tailored);
  round(tailored, 1);
  round(tailored, 2);
  round(pool, LIMITS.suggestions);
  return picks;
}

// ---------------------------------------------------------------------------------------------
// Suggestions

function questionScore(entry, words) {
  if (!words.length) return 0;
  const theme = THEMES[entry.idea.theme];
  return wordHits(words, [...new Set([...(entry.idea.keywords || []), ...theme.words, ...tokens(entry.idea.title)])]);
}

/** Theme-based ideas for what Chris asked, best match first, leaving out anything taken. */
function customsFromQuestion(question, words, blocked) {
  return THEME_ORDER
    .filter((key) => key !== 'cottage')
    .map((key, order) => ({ key, order, hits: wordHits(words, THEMES[key].words) }))
    .filter((item) => item.hits > 0 && !blocked.some((name) => sameTitle(name, THEMES[item.key].name)))
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .map((item) => ({
      hits: item.hits,
      suggestion: {
        id: `local:ask-${item.key}`,
        title: THEMES[item.key].name,
        pitch: cleanText(THEMES[item.key].pitch, LIMITS.pitch, { ellipsis: true }),
        why: cleanText(`You asked for ${toYou(question.replace(/[?.]+$/, ''))}`, LIMITS.why, { ellipsis: true }),
        source: 'local',
      },
    }));
}

/**
 * Three suggestions for a plot, from Milo's own pool.
 *   localSuggestions({ id, name, w, h }, { skills, projects, built }, { question, exclude })
 * Without a question or exclusions this is the plot's stable share of the pool. With them, ideas
 * that answer the question come first (pool ideas, then themed ones built from the question),
 * then the best of the rest for this plot, preferring ones no other plot is showing.
 */
export function localSuggestions(plot, signals = {}, { question = '', exclude = [] } = {}) {
  const plotId = plot && typeof plot.id === 'string' ? plot.id : 'plot';
  const built = signals.built || [];
  const excluded = (Array.isArray(exclude) ? exclude : [])
    .map((item) => (item && typeof item === 'object' ? item.title : item)).filter((item) => typeof item === 'string');
  const q = cleanText(question, 200);
  const words = tokens(q).filter((word) => !STOP.has(word) && word.length >= 3);
  const plots = PLOT_ORDER.includes(plotId) ? PLOT_ORDER : [...PLOT_ORDER, plotId];
  const shares = allocate(signals, plots);
  let chosen;
  if (!words.length && !excluded.length) {
    const flavoured = shares[plotId].find((entry) => flavourFits(entry, plotId));
    chosen = shares[plotId].map((entry) => toSuggestion(entry, plotId, { flavour: entry === flavoured }));
  } else {
    const elsewhere = new Set(Object.entries(shares).filter(([id]) => id !== plotId).flatMap(([, list]) => list.map((entry) => entry.idea.key)));
    const ranked = scored(signals)
      .filter((entry) => !isBuilt(entry.idea, built) && !excluded.some((title) => sameTitle(title, entry.idea.title)))
      .map((entry) => {
        const hits = questionScore(entry, words);
        return { entry, hits, value: 20 * hits + entry.score + 3 * affinity(entry.idea, plotId) - (elsewhere.has(entry.idea.key) ? 12 : 0) };
      })
      .sort((a, b) => b.value - a.value || a.entry.order - b.entry.order);
    chosen = [];
    const add = (suggestion) => {
      if (chosen.length < LIMITS.suggestions && !chosen.some((other) => sameTitle(other.title, suggestion.title))) chosen.push(suggestion);
    };
    const asked = (item) => {
      const suggestion = toSuggestion(item.entry, plotId);
      return item.entry.tailored ? suggestion : { ...suggestion, why: cleanText(`You asked for ${toYou(q.replace(/[?.]+$/, ''))}`, LIMITS.why, { ellipsis: true }) };
    };
    if (words.length) {
      const matched = ranked.filter((item) => item.hits > 0);
      const blocked = [...built, ...excluded, ...matched.map((item) => item.entry.idea.title), ...IDEAS.map((idea) => idea.title)];
      const customs = customsFromQuestion(q, words, blocked);
      let m = 0;
      let c = 0;
      while (chosen.length < LIMITS.suggestions && (m < matched.length || c < customs.length)) {
        const nextMatch = matched[m];
        const nextCustom = customs[c];
        if (nextMatch && (!nextCustom || nextMatch.hits >= nextCustom.hits)) {
          add(asked(nextMatch));
          m += 1;
        } else {
          add(nextCustom.suggestion);
          c += 1;
        }
      }
    }
    for (const item of ranked) add(toSuggestion(item.entry, plotId));
  }
  // Top up in the unlikely case the pool ran dry (almost everything built).
  for (const key of THEME_ORDER) {
    if (chosen.length >= LIMITS.suggestions) break;
    const theme = THEMES[key];
    const blocked = [...built, ...excluded, ...chosen.map((item) => item.title)];
    if (blocked.some((name) => sameTitle(name, theme.name))) continue;
    chosen.push({ id: `local:theme-${key}`, title: theme.name, pitch: cleanText(theme.pitch, LIMITS.pitch, { ellipsis: true }), why: 'A good all-round pick for a new plot', source: 'local' });
  }
  return chosen.slice(0, LIMITS.suggestions);
}

// ---------------------------------------------------------------------------------------------
// Kit designer

function toYou(value) {
  return String(value || '')
    .replace(/\bI'm\b/g, "you're")
    .replace(/\bI've\b/g, "you've")
    .replace(/\bI'll\b/g, "you'll")
    .replace(/\bI\b/g, 'you')
    .replace(/\bmyself\b/gi, 'yourself')
    .replace(/\bmine\b/gi, 'yours')
    .replace(/\bmy\b/g, 'your')
    .replace(/\bMy\b/g, 'Your')
    .replace(/\bme\b/g, 'you');
}

function sentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const capped = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.?…]$/.test(capped) ? capped : `${capped}.`;
}

function normalizeIdea(idea) {
  if (typeof idea === 'string') return ideaFromText(idea);
  if (idea && typeof idea === 'object') {
    const title = cleanText(idea.title, LIMITS.title, { sentence: true });
    const pitch = cleanText(idea.pitch, 300);
    if (!title && !pitch) return null;
    return {
      id: typeof idea.id === 'string' ? idea.id : 'own:idea',
      title: title || 'Your idea',
      pitch,
      why: cleanText(idea.why, LIMITS.why, { ellipsis: true }),
      source: ['local', 'claude', 'codex'].includes(idea.source) ? idea.source : 'local',
    };
  }
  return null;
}

const UNNAMED = 'Your idea';

/**
 * The pool idea an idea is about, or null: by id, by title ('Draft room'), by a title with a word
 * or two in front ('Cozy bakery', 'My clip studio'), or, for an idea Chris typed without a name,
 * by the words he used ('something for my coursework reading' -> Study hall).
 */
function poolIdeaFor(idea) {
  if (idea.id && idea.id.startsWith('local:') && IDEA_BY_KEY[idea.id.slice(6)]) return IDEA_BY_KEY[idea.id.slice(6)];
  const exact = IDEAS.find((entry) => sameTitle(entry.title, idea.title));
  if (exact) return exact;
  const words = tokens(idea.title);
  const tail = IDEAS.find((entry) => {
    const own = tokens(entry.title);
    return words.length > own.length && words.length <= own.length + 2 && own.every((word, i) => words[words.length - own.length + i] === word);
  });
  if (tail) return tail;
  if (!sameTitle(idea.title, UNNAMED)) return null;
  const said = tokens(idea.pitch).filter((word) => !STOP.has(word) && word.length >= 3);
  const theme = themeFor(idea.pitch);
  let best = null;
  IDEAS.forEach((entry, order) => {
    if (!entry.keywords) return;
    const hits = wordHits(said, entry.keywords);
    if (hits >= 2 || (hits === 1 && entry.theme === theme)) {
      if (!best || hits > best.hits || (hits === best.hits && order < best.order)) best = { entry, hits, order };
    }
  });
  return best ? best.entry : null;
}

/** Whether a pitch says what the building does, rather than just naming it ('A cozy bakery'). */
function usefulPitch(pitch, name) {
  const text = String(pitch || '').trim();
  if (!text) return false;
  const bare = text.replace(/^(a|an|the|my|some)\s+/i, '');
  if (sameTitle(bare, name) || sameTitle(text, name)) return false;
  if (/^(something|somewhere|someplace|a place|place|an? (app|tool|thing|spot|building))\b/i.test(text)) return false;
  return tokens(text).length >= 2;
}

const TWEAK_TARGETS = { roof: 'roofColor', roofs: 'roofColor', wall: 'wallColor', walls: 'wallColor', trim: 'trim', door: 'trim', doors: 'trim', flag: 'flag', awning: 'awning' };
const MATERIAL_WORDS = new Set(['stone', 'wood', 'wooden', 'brick', 'slate', 'sand']);

/** Applies a free-text tweak ('make it cozier', 'blue roof', 'taller, stone walls') to a design. */
export function applyTweak(design, tweak) {
  const text = String(tweak || '').toLowerCase();
  if (!text.trim()) return design;
  const style = { ...design.style };
  let props = design.props.map((item) => ({ ...item }));
  let { yard } = design;
  const has = (re) => re.test(text);
  const addProp = (kind) => {
    if (props.some((item) => item.kind === kind)) return;
    const sides = ['left', 'right', 'front'].filter((side) => !props.some((item) => item.side === side));
    if (props.length >= LIMITS.props) props = props.slice(0, LIMITS.props - 1);
    props.push({ kind, side: sides[0] || 'front' });
  };
  if (has(/\bco[sz](y|ier|iest)\b|\bwarm|\bsnug|\bhom(e|ey|ier)\b/)) {
    style.chimney = true;
    if (['plank', 'plaster'].includes(style.walls)) style.walls = 'log';
    if (style.walls === 'log' && !['wood', 'woodLight', 'woodDeep', 'honey', 'butter', 'sand'].includes(style.wallColor)) style.wallColor = 'wood';
    style.roofColor = 'clay';
    style.trim = 'woodDeep';
    yard = 'flowers';
    addProp('lantern');
  }
  if (has(/\bbright|\bcheer|\bsunn|\bhapp|\bcolou?rful|\bfun\b/)) {
    style.wallColor = 'butter';
    style.roofColor = 'clay';
    if (style.flag === 'none') style.flag = 'blossom';
  }
  if (has(/\bcalm|\bquiet|\bsoft|\bmuted|\bgentle|\bpeace/)) {
    style.wallColor = 'cream';
    style.roofColor = 'slate';
  }
  if (has(/\btall|\btower|\bhigher/)) style.shape = 'tower';
  else if (has(/\bbig|\bgrand|\blarge|\bhuge|\bwide/)) style.shape = 'hall';
  else if (has(/\bsmall|\btiny|\blittle|\bcute/)) style.shape = 'cottage';
  if (has(/\bstone\b/)) style.walls = 'stone';
  else if (has(/\bbrick/)) style.walls = 'brick';
  else if (has(/\blogs?\b|\bcabin/)) style.walls = 'log';
  else if (has(/\bglass/)) style.walls = 'glass';
  else if (has(/\bplaster|\bstucco/)) style.walls = 'plaster';
  else if (has(/\bwood(en)?\b|\btimber|\bplank/)) style.walls = 'plank';
  if (has(/\bdome/)) style.roof = 'dome';
  else if (has(/\bthatch/)) style.roof = 'thatch';
  else if (has(/\bflat roof/)) style.roof = 'flat';
  else if (has(/\bshingle/)) style.roof = 'shingle';
  const words = tokens(text);
  let bareColour = null;
  words.forEach((word, index) => {
    if (MATERIAL_WORDS.has(word) && /^(walls?|roofs?)$/.test(words[index + 1] || '')) return;
    const colour = matchColour(word);
    if (!colour) return;
    const near = [words[index + 1], words[index + 2], words[index - 1]].find((other) => TWEAK_TARGETS[other]);
    if (near) style[TWEAK_TARGETS[near]] = colour;
    else if (!bareColour && !MATERIAL_WORDS.has(word)) bareColour = colour;
  });
  if (bareColour) style.wallColor = bareColour;
  if (has(/\bno flags?\b/)) style.flag = 'none';
  else if (has(/\bflag/) && style.flag === 'none') style.flag = 'honey';
  if (has(/\bno chimney/)) style.chimney = false;
  else if (has(/\bchimney/)) style.chimney = true;
  if (has(/\bno awning/)) style.awning = 'none';
  else if (has(/\bawning/) && style.awning === 'none') style.awning = 'clay';
  if (has(/\bgarden|\bvegetable/)) yard = 'garden';
  else if (has(/\bflower/)) yard = 'flowers';
  if (has(/\bmore props|\bbusier|\blived.in|\bclutter/)) { addProp('crates'); addProp('barrels'); }
  if (style.roofColor === style.wallColor) style.roofColor = style.wallColor === 'clay' ? 'clayDeep' : 'clay';
  return { ...design, style, props, yard };
}

/**
 * Milo's own design for any idea, no crew needed.
 *   kitBlueprint(idea, { plot, tweak, previous, variant })
 * `idea` is a Suggestion or free text. A redesign passes `previous` (the old blueprint): with a
 * tweak the tweak is applied to the old look; without one the palette moves on to the next.
 */
export function kitBlueprint(idea, { plot = null, tweak = '', previous = null, variant = null } = {}) {
  const base = normalizeIdea(idea) || { id: 'own:idea', title: 'Your idea', pitch: '', why: '', source: 'local' };
  const pool = poolIdeaFor(base);
  const themeKey = pool ? pool.theme : themeFor(`${base.title} ${base.pitch}`);
  const theme = THEMES[themeKey];
  const name = base.title && base.title !== UNNAMED ? base.title : (pool ? pool.title : theme.name);
  const poolPitch = pool && typeof pool.pitch === 'string' ? pool.pitch : null;
  // A theme's own level tree only when the idea clearly is that kind of building; a loose keyword
  // match gets the generic (but honest) tree rather than someone else's features.
  const said = tokens(`${base.title} ${base.pitch}`).filter((word) => !STOP.has(word));
  const sure = Boolean(pool) || wordHits(said, theme.words) >= 2 || sameTitle(name, theme.name);
  const themeTree = THEME_LEVELS[themeKey] || (IDEAS.find((entry) => entry.theme === themeKey && entry.levels) || {}).levels;
  const purposeSource = (pool && pool.purpose) || (usefulPitch(base.pitch, name) ? toYou(base.pitch) : null)
    || (sure ? poolPitch || theme.pitch : 'A home for this idea, built up with the crew one level at a time');
  const palettes = [{}, ...theme.palettes];
  let paletteIndex = Number.isInteger(variant) ? variant : 0;
  if (!Number.isInteger(variant) && previous && previous.style && !String(tweak || '').trim()) {
    const current = palettes.findIndex((palette) => (palette.wallColor || theme.style.wallColor) === previous.style.wallColor
      && (palette.roofColor || theme.style.roofColor) === previous.style.roofColor);
    paletteIndex = current + 1;
  }
  let style = { ...theme.style, ...palettes[((paletteIndex % palettes.length) + palettes.length) % palettes.length] };
  // A name that says what kind of building it is gets that shape: a backup shed is a barn, not a mill.
  const noun = pool ? null : shapeFromName(name);
  if (noun) style.shape = noun;
  if (previous && previous.style && String(tweak || '').trim()) style = { ...previous.style };
  if (plot && Number(plot.w) >= 2 * Number(plot.h) && style.shape === 'cottage') style.shape = 'hall';
  let design = {
    style,
    props: (previous && String(tweak || '').trim() && Array.isArray(previous.props) ? previous.props : theme.props).map((item) => ({ ...item })),
    yard: previous && String(tweak || '').trim() && previous.yard ? previous.yard : theme.yard,
  };
  design = applyTweak(design, tweak);
  const draft = {
    version: 1,
    name,
    // A loose keyword match borrows the look, not the theme's claim about the job.
    tagline: (pool && pool.tagline) || (sure ? theme.tagline : THEMES.cottage.tagline),
    purpose: sentence(purposeSource),
    style: design.style,
    emblem: [...((pool && pool.emblem) || theme.emblem)],
    props: design.props,
    yard: design.yard,
    levels: [...((pool && pool.levels) || (sure && themeTree) || genericLevels(theme.topic))],
  };
  const checked = validateBlueprint(draft);
  return checked.ok ? checked.blueprint : validateBlueprint({ ...draft, name: theme.name }).blueprint;
}

/** The idea as a Suggestion, with a proper title when Chris typed a long sentence. */
export function namedIdea(idea) {
  const base = normalizeIdea(idea);
  if (!base) return null;
  if (base.title !== 'Your idea') return base;
  const pool = poolIdeaFor(base);
  return { ...base, title: pool ? pool.title : THEMES[themeFor(base.pitch)].name };
}
