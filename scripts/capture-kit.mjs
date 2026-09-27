// Renders MILO's building kit so it can be looked at: a gallery of varied blueprints (every
// shape, wall, roof, window and prop appears at least once, plus realistic ideas) and a few of
// them standing on real plots in the world.
//
//   node scripts/capture-kit.mjs       -> test-results/kit-gallery.png (3x), test-results/kit-world.png
//
// Blueprint files (for example real designs from the crew, kept outside the repo):
//
//   node scripts/capture-kit.mjs --blueprints <file.json|folder>... [--out <folder>] [--prefix <name>]
//     -> <out>/<prefix>-gallery.png    each design at its plot's size (3x) with its emblem at 8x
//        <out>/<prefix>-world.png      the designs standing on their plots (2x); a plot used twice
//                                      gets a second map (-world-2.png)
//        <out>/<prefix>-closeups.png   each plot at 3x beside the hand-made camp and watchtower
//   A file holds a blueprint, { blueprint }, or an architect result { result: { blueprint, by } },
//   plus an optional plot id ('plot-rise'). <out> defaults to test-results, <prefix> to 'blueprints'.
//
// Importing this module only exposes the sample blueprints (capture-world.mjs reuses them);
// Electron starts only when the script is run directly.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const E = (text) => text.split('\n').map((row) => row.trim()).filter(Boolean);

/** 12 x 12 sign emblems for the samples. */
export const EMBLEMS = {
  play: E(`
    ............
    ..oooooooo..
    .orrrrrrrro.
    .orrcrrrrro.
    .orrccrrrro.
    .orrcccrrro.
    .orrccccrro.
    .orrcccrrro.
    .orrccrrrro.
    .orrcrrrrro.
    .orrrrrrrro.
    ..oooooooo..
  `),
  die: E(`
    ............
    .oooooooooo.
    .okkkkkkkko.
    .okookkooko.
    .okookkooko.
    .okkkookkko.
    .okkkookkko.
    .okookkooko.
    .okookkooko.
    .okkkkkkkko.
    .oooooooooo.
    ............
  `),
  bell: E(`
    .....oo.....
    ....oUUo....
    ...oUuuUo...
    ...ouuuUo...
    ..ouuuuuUo..
    ..ouuuuuUo..
    .ouuuuuuuUo.
    .oUUUUUUUUo.
    .oooooooooo.
    .....oo.....
    ....oUUo....
    .....oo.....
  `),
  football: E(`
    ............
    ....oooo....
    ..oobbbboo..
    .obbbbbbbBo.
    .obbcccccBo.
    obbbcbcbcbBo
    obbbbbbbbBBo
    .obbbbbbBBo.
    .oBbbbbbBBo.
    ..ooBBBBoo..
    ....oooo....
    ............
  `),
  envelope: E(`
    ............
    ............
    .oooooooooo.
    .ooccccccoo.
    .ocooccooco.
    .occcoocc.o.
    .occccrrcco.
    .occcrrrrco.
    .occccrrcco.
    .oooooooooo.
    ............
    ............
  `),
  book: E(`
    ............
    ..ooooooooo.
    ..oeeeeeeeo.
    ..oeuuuuueo.
    ..oeeeeeeeo.
    ..oeeeeeeeo.
    ..oeeeeeeeo.
    ..oeeeeeeeo.
    ..oooooooooo
    ..occcccccco
    ...ooooooooo
    ............
  `),
  bread: E(`
    ............
    ............
    ...oooooo...
    ..oUUUUUUo..
    .oUuUUuUUUo.
    .oUUuUUuUUo.
    .oUUUuUUuUo.
    .oUUUUUUUUo.
    ..oBBBBBBo..
    ...oooooo...
    ............
    ............
  `),
  moon: E(`
    oooooooooooo
    oeeeeeeeeeeo
    oeeeuuueecee
    oeeuuoeeeeeo
    oeuuoeeeeeeo
    oeuuoeeeceeo
    oeuuueeeeeeo
    oeeuuueeeeeo
    oeeeuuuuueeo
    oeceeeeeeeeo
    oeeeeeeeeeeo
    oooooooooooo
  `),
  sprout: E(`
    ............
    ....oo.oo...
    ...olloLlo..
    ...ollLLlo..
    ....oLlLo...
    .....oLo....
    .....oLo....
    ...oooooo...
    ..orrrrrro..
    ...orrrro...
    ...oooooo...
    ............
  `),
  wheat: E(`
    .....oo.....
    ....oUUo....
    ...oUuUUo...
    ...oUUuUo...
    ...oUuUUo...
    ....oUUo....
    .....ob.....
    .....ob.....
    ..oo.ob.oo..
    ..oUoobooUo.
    ...oUbbbUo..
    ....ooooo...
  `),
  hammer: E(`
    ............
    ..oooooo....
    .osssssSo...
    .oSSSSSSo...
    ..oooboo....
    .....ob.....
    .....ob.....
    .....ob.....
    .....ob.....
    .....ob.....
    .....oo.....
    ............
  `),
  lantern: E(`
    .....oo.....
    ....oBBo....
    ...oooooo...
    ...ouuuUo...
    ...oucuUo...
    ...ouuuUo...
    ...ouuuUo...
    ...oooooo...
    ....oBBo....
    .....oo.....
    ............
    ............
  `),
  note: E(`
    ............
    .....oooo...
    .....ovvvo..
    .....ovoovo.
    .....ov.oo..
    .....ov.....
    .....ov.....
    ..ooooov....
    .ovvvvvo....
    .ovvvvvo....
    ..ooooo.....
    ............
  `),
  fish: E(`
    ............
    ............
    ....oooo....
    ..ooeeeeoo.o
    .oeoeeeeeoeo
    oeeeeeeeeeeo
    oeeeeeeeeoeo
    .oEEEEEEoo.o
    ..oooooo....
    ............
    ............
    ............
  `),
  cup: E(`
    ............
    ....o.o.....
    .....o.o....
    ............
    .oooooooo...
    .ockkkkcoo..
    .occccccoco.
    .occccccoco.
    ..occccooo..
    .oooooooooo.
    ..oooooooo..
    ............
  `),
  gear: E(`
    .....oo.....
    ..oo.ss.oo..
    ..osossoso..
    ...osssso...
    ooossoossooo
    osssoo.osss.
    ossso..osss.
    ooossoossooo
    ...osssso...
    ..osossoso..
    ..oo.ss.oo..
    .....oo.....
  `),
  radio: E(`
    ............
    ..o......o..
    .o..o..o..o.
    .o.o....o.o.
    .o.o.oo.o.o.
    .o.o.oo.o.o.
    .o..o..o..o.
    ..o..oo..o..
    .....oo.....
    ....o..o....
    ...o....o...
    ..oooooooo..
  `),
  trophy: E(`
    ............
    ..oooooooo..
    ooouuuuuUooo
    ouo.uuuuUoUo
    ooouuuuuUooo
    ...ouuuUo...
    ....ouUo....
    .....oo.....
    ....oUUo....
    ...oooooo...
    ...oBBBBo...
    ...oooooo...
  `),
  scroll: E(`
    ............
    .oooooooooo.
    ocoooooooooo
    ocoocccccco.
    .ooocooooco.
    ...occcccco.
    ...ocoooooc.
    ...occcccco.
    ..oooooooooo
    .occcccccoco
    ..oooooooooo
    ............
  `),
  vase: E(`
    ....oooo....
    ....orro....
    ...oorroo...
    ..orrrrrRo..
    .orrkrrrrRo.
    .orrrrrrrRo.
    .orrrkkrrRo.
    .oRrrrrrRRo.
    ..oRRRRRRo..
    ...oooooo...
    ............
    ............
  `),
  flower: E(`
    ............
    ....okko....
    ..ookkkkoo..
    .okkkuukkko.
    .okkuUUukko.
    .okkuUUukko.
    .okkkuukkko.
    ..ookkkkoo..
    ....okko....
    .....oL.....
    ....oLLo....
    .....oo.....
  `),
  apple: E(`
    ......oo....
    .....oblo...
    ...oooolo...
    ..orrrrrro..
    .orrcrrrrRo.
    .orcrrrrrRo.
    .orrrrrrrRo.
    .orrrrrrRRo.
    ..orrrRRRo..
    ...oooooo...
    ............
    ............
  `),
  bee: E(`
    ............
    ...oo..oo...
    ..occoocco..
    ...occcco...
    ..oouuuuoo..
    .ouooooooUo.
    .ouuuuuuuUo.
    .ooooooooUo.
    .ouuuuuuuUo.
    ..oUUUUUUo..
    ...oooooo...
    ............
  `),
  check: E(`
    ............
    .oooooooooo.
    .occccccccCo
    .occccccocCo
    .occcccoocCo
    .ocoocoocCCo
    .occoooocCCo
    .occcoocCCCo
    .occcccCCCCo
    .oooooooooo.
    ............
    ............
  `),
};

// A blueprint with sensible defaults for anything a sample leaves out.
const bp = (name, style, props, yard, emblem, extra = {}) => ({
  version: 1, name, tagline: '', purpose: '',
  style: { shape: 'cottage', walls: 'plank', wallColor: 'cream', roof: 'gable', roofColor: 'clay', trim: 'woodDeep', door: 'plain', windows: 'square', chimney: false, flag: 'none', awning: 'none', ...style },
  emblem: EMBLEMS[emblem], props: props.map(([kind, side]) => ({ kind, side })), yard, levels: [], ...extra,
});

/** Sample blueprints: every shape, wall, roof, door, window, prop and yard, plus realistic ideas. */
export const BLUEPRINTS = [
  bp('Clip studio', { shape: 'shop', walls: 'plaster', wallColor: 'lavender', roof: 'shingle', roofColor: 'slateDeep', trim: 'cream', door: 'double', windows: 'tall', flag: 'blossom' }, [['camera', 'left'], ['filmreel', 'right'], ['easel', 'front']], 'path', 'play'),
  bp('Game table', { shape: 'pavilion', walls: 'log', wallColor: 'wood', roof: 'thatch', roofColor: 'honey', trim: 'woodDeep', windows: 'none', flag: 'clay' }, [['dicetable', 'front'], ['lantern', 'left'], ['bench', 'right']], 'grass', 'die'),
  bp('Town hall', { shape: 'hall', walls: 'brick', wallColor: 'clay', roof: 'hip', roofColor: 'slateDeep', trim: 'cream', door: 'double', windows: 'tall', flag: 'butter' }, [['trophy', 'left'], ['signboard', 'right'], ['bench', 'front']], 'stone', 'bell'),
  bp('Draft room', { shape: 'barn', walls: 'plank', wallColor: 'clayDeep', roof: 'gable', roofColor: 'stoneDeep', trim: 'cream', door: 'sliding', windows: 'square', flag: 'leaf' }, [['chalkboard', 'left'], ['trophy', 'right']], 'grass', 'football'),
  bp('Sorting office', { shape: 'shop', walls: 'stone', wallColor: 'stone', roof: 'flat', roofColor: 'slate', trim: 'woodDeep', door: 'plain', windows: 'shopfront', awning: 'slate' }, [['mailbox', 'left'], ['crates', 'right'], ['handcart', 'front']], 'path', 'envelope'),
  bp('Library', { shape: 'cottage', walls: 'stone', wallColor: 'stoneDeep', roof: 'gable', roofColor: 'leafDeep', trim: 'cream', door: 'arched', windows: 'round', chimney: true }, [['bookcart', 'left'], ['scrollrack', 'right']], 'flowers', 'book'),
  bp('Bakery', { shape: 'shop', walls: 'plaster', wallColor: 'cream', roof: 'shingle', roofColor: 'clay', trim: 'woodDeep', door: 'arched', windows: 'shopfront', chimney: true, awning: 'clay' }, [['crates', 'left'], ['barrels', 'right']], 'stone', 'bread'),
  bp('Observatory', { shape: 'observatory', walls: 'stone', wallColor: 'slate', roof: 'dome', roofColor: 'slateDeep', trim: 'butter', door: 'arched', windows: 'round', flag: 'butter' }, [['telescope', 'right'], ['antenna', 'left']], 'grass', 'moon'),
  bp('Greenhouse', { shape: 'greenhouse', walls: 'brick', wallColor: 'clay', roof: 'gable', roofColor: 'leaf', trim: 'cream', door: 'double', windows: 'none' }, [['gardenbed', 'left'], ['pottedplant', 'front'], ['beehive', 'right']], 'garden', 'sprout'),
  bp('Flour mill', { shape: 'mill', walls: 'plank', wallColor: 'cream', roof: 'thatch', roofColor: 'honey', trim: 'woodDeep', door: 'plain', windows: 'round' }, [['barrels', 'left'], ['handcart', 'right']], 'path', 'wheat'),
  bp('Forge', { shape: 'workshop', walls: 'log', wallColor: 'wood', roof: 'shingle', roofColor: 'stoneDeep', trim: 'woodLight', door: 'sliding', windows: 'square', chimney: true }, [['anvil', 'front'], ['workbench', 'left']], 'sand', 'hammer'),
  bp('Signal tower', { shape: 'tower', walls: 'stone', wallColor: 'stone', roof: 'flat', roofColor: 'stone', trim: 'woodDeep', door: 'plain', windows: 'tall', flag: 'clay' }, [['lantern', 'left'], ['birdhouse', 'right']], 'grass', 'lantern'),
  bp('Music pavilion', { shape: 'pavilion', walls: 'glass', wallColor: 'cream', roof: 'dome', roofColor: 'blossom', trim: 'woodDeep' }, [['musicstand', 'front'], ['pottedplant', 'left']], 'flowers', 'note'),
  bp('Bait shop', { shape: 'shop', walls: 'plank', wallColor: 'water', roof: 'awning', roofColor: 'slate', trim: 'cream', door: 'plain', windows: 'square' }, [['fishingrack', 'left'], ['barrels', 'right']], 'sand', 'fish'),
  bp('Tea house', { shape: 'cottage', walls: 'plaster', wallColor: 'blossom', roof: 'thatch', roofColor: 'sand', trim: 'leafDeep', door: 'arched', windows: 'square', chimney: true }, [['bench', 'left'], ['pottedplant', 'right'], ['well', 'front']], 'flowers', 'cup'),
  bp('Tinker shed', { shape: 'workshop', walls: 'plank', wallColor: 'slate', roof: 'hip', roofColor: 'honey', trim: 'cream', door: 'double', windows: 'round', chimney: true }, [['workbench', 'right'], ['crates', 'left']], 'path', 'gear'),
  bp('Glass studio', { shape: 'cottage', walls: 'glass', wallColor: 'woodDeep', roof: 'flat', roofColor: 'woodDeep', trim: 'cream', door: 'sliding', windows: 'none' }, [['antenna', 'right'], ['easel', 'left']], 'stone', 'radio'),
  bp('Honey barn', { shape: 'barn', walls: 'log', wallColor: 'honey', roof: 'thatch', roofColor: 'butter', trim: 'woodDeep', door: 'double', windows: 'square' }, [['beehive', 'left'], ['beehive', 'right'], ['gardenbed', 'front']], 'garden', 'bee'),
  bp('Archive', { shape: 'tower', walls: 'brick', wallColor: 'lavender', roof: 'dome', roofColor: 'lavender', trim: 'woodDeep', door: 'arched', windows: 'round', chimney: true }, [['scrollrack', 'left']], 'path', 'scroll'),
  bp('Trophy hall', { shape: 'hall', walls: 'plaster', wallColor: 'butter', roof: 'flat', roofColor: 'honey', trim: 'woodDeep', door: 'double', windows: 'shopfront', flag: 'clay' }, [['trophy', 'front'], ['fountain', 'left']], 'stone', 'trophy'),
  bp('Garden pavilion', { shape: 'pavilion', walls: 'stone', wallColor: 'stoneDeep', roof: 'hip', roofColor: 'leafDeep', trim: 'cream', chimney: true }, [['fountain', 'front'], ['birdhouse', 'left']], 'garden', 'flower'),
  bp('Kiln house', { shape: 'barn', walls: 'stone', wallColor: 'sand', roof: 'shingle', roofColor: 'clayDeep', trim: 'woodDeep', door: 'double', windows: 'tall', chimney: true }, [['kiln', 'left'], ['pottedplant', 'right']], 'sand', 'vase'),
  bp('Signal mill', { shape: 'mill', walls: 'brick', wallColor: 'blossom', roof: 'dome', roofColor: 'slate', trim: 'cream', door: 'arched', windows: 'tall', flag: 'water' }, [['signboard', 'front'], ['mailbox', 'left']], 'flowers', 'radio'),
  bp('Sun room', { shape: 'greenhouse', walls: 'glass', wallColor: 'cream', roof: 'dome', roofColor: 'water', trim: 'leaf', door: 'arched', windows: 'none' }, [['gardenbed', 'right'], ['well', 'left']], 'grass', 'flower'),
  bp('Star tower', { shape: 'observatory', walls: 'plank', wallColor: 'woodDeep', roof: 'hip', roofColor: 'slate', trim: 'cream', door: 'plain', windows: 'square' }, [['telescope', 'left'], ['lantern', 'right']], 'path', 'moon'),
  bp('Market stall', { shape: 'shop', walls: 'log', wallColor: 'woodLight', roof: 'awning', roofColor: 'clay', trim: 'woodDeep', door: 'plain', windows: 'shopfront', awning: 'butter' }, [['crates', 'left'], ['barrels', 'right'], ['signboard', 'front']], 'path', 'apple'),
  bp('Quest board hall', { shape: 'hall', walls: 'log', wallColor: 'woodLight', roof: 'shingle', roofColor: 'clay', trim: 'woodDeep', door: 'double', windows: 'square', chimney: true, flag: 'leaf' }, [['signboard', 'left'], ['lantern', 'right']], 'path', 'check'),
  bp('Bell tower', { shape: 'tower', walls: 'plaster', wallColor: 'cream', roof: 'hip', roofColor: 'clay', trim: 'woodDeep', door: 'arched', windows: 'square', flag: 'slate' }, [['bench', 'front']], 'flowers', 'bell'),
];

/** Plot states for the world shot: four buildings up, one being designed. */
export function demoPlots(now = Date.parse('2026-09-26T12:00:00Z')) {
  const built = (name, by) => {
    const blueprint = BLUEPRINTS.find((bp) => bp.name === name);
    return { status: 'built', suggestions: [], asked: null, idea: { id: `local:${name}`, title: name, pitch: '', why: '', source: 'local' }, blueprint, designedBy: by, builtAt: now, name: null };
  };
  return {
    'plot-rise': built('Clip studio', 'codex'),
    'plot-orchard': built('Library', 'claude'),
    'plot-meadow': built('Town hall', 'kit'),
    'plot-birch': built('Bakery', 'codex'),
    'plot-pond': { status: 'designing', suggestions: [], asked: null, idea: { id: 'local:game-table', title: 'Game table', pitch: '', why: '', source: 'local' }, blueprint: null, designedBy: null, builtAt: null, name: null },
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering helpers (they run inside the preview page)

/** Draws labelled tiles into one image: [{ rows, title, note, emblem? }] -> data URL. */
async function galleryImage(page, tiles, { scale = 3, cols = 6, cellW, cellH, emblemScale = 0 }) {
  return page.evaluate(async ({ tiles, scale, cols, cellW, cellH, emblemScale }) => {
    const { rgbaOf } = await import('../src/world/sprites.js');
    const gap = 12;
    const label = 34;
    const emblemW = emblemScale ? 12 * emblemScale + gap : 0;
    const colW = cellW + emblemW;
    const rows = Math.ceil(tiles.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * (colW + gap) + gap;
    canvas.height = rows * (cellH + label + gap) + gap;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3d4038';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const toCanvas = (grid) => {
      const c = document.createElement('canvas');
      c.width = grid[0].length;
      c.height = grid.length;
      const g = c.getContext('2d');
      const image = g.createImageData(c.width, c.height);
      grid.forEach((row, y) => [...row].forEach((ch, x) => { const rgba = ch === '.' ? null : rgbaOf(ch); if (rgba) image.data.set(rgba, (y * c.width + x) * 4); }));
      g.putImageData(image, 0, 0);
      return c;
    };
    ctx.imageSmoothingEnabled = false;
    tiles.forEach((tile, i) => {
      const x = gap + (i % cols) * (colW + gap);
      const y = gap + Math.floor(i / cols) * (cellH + label + gap);
      ctx.drawImage(toCanvas(tile.rows), x, y, tile.rows[0].length * scale, tile.rows.length * scale);
      if (tile.emblem && emblemScale) {
        ctx.fillStyle = '#fff6e2';
        const ex = x + tile.rows[0].length * scale + gap;   // right beside its building
        ctx.fillRect(ex, y, 12 * emblemScale, 12 * emblemScale);
        ctx.drawImage(toCanvas(tile.emblem), ex, y, 12 * emblemScale, 12 * emblemScale);
      }
      ctx.fillStyle = '#fff6e2';
      ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(tile.title, x + 2, y + cellH + 16);
      ctx.fillStyle = '#c1e1a3';
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(tile.note, x + 2, y + cellH + 30);
    });
    return canvas.toDataURL('image/png');
  }, { tiles, scale, cols, cellW, cellH, emblemScale });
}

const RESTING_CREW = [
  { id: 'claude', state: 'done', label: 'Claude Code', count: 1 },
  { id: 'codex', state: 'done', label: 'Codex', count: 0 },
  { id: 'whisper', state: 'idle', label: 'Whisper', count: 0 },
  { id: 'jev', state: 'idle', label: 'Jev', count: 0 },
];

/** The world with `plots` set, cropped to the plots and the camp (tiles 6-58 across, 1-34 down). */
async function worldImage(page, plots, { scale = 2, crew = RESTING_CREW } = {}) {
  return page.evaluate(({ plots, scale, crew }) => {
    window.__world.setPlots(plots);
    window.__world.setCrew(crew);
    const map = window.__world.renderMap(1, { time: 5200 });
    const crop = { x: 6 * 16, y: 1 * 16, w: 52 * 16, h: 33 * 16 };
    const out = document.createElement('canvas');
    out.width = crop.w * scale;
    out.height = crop.h * scale;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(map, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }, { plots, scale, crew });
}

/**
 * Close-ups of places in the world at `scale`, labelled: the hand-made camp and watchtower first
 * (the bar to meet), then each plot in `ids`.
 */
async function closeupImage(page, plots, ids, labels, { scale = 3 } = {}) {
  return page.evaluate(async ({ plots, ids, labels, scale }) => {
    const { PLACES } = await import('../src/world/map.js');
    window.__world.setPlots(plots);
    const map = window.__world.renderMap(1, { time: 5200 });
    const shots = [
      { title: "Milo's camp (hand-made)", box: { x: 24, y: 13, w: 17, h: 9 } },
      { title: 'Watchtower (hand-made)', box: { x: 27, y: 3, w: 10, h: 8 } },
      ...ids.map((id) => {
        const place = PLACES.find((p) => p.id === id);
        return { title: labels[id] || id, box: { x: place.area.x - 1, y: place.area.y - 1, w: place.area.w + 2, h: place.area.h + 2 } };
      }),
    ];
    const gap = 12;
    const label = 24;
    const cols = 3;
    const cellW = Math.max(...shots.map((s) => s.box.w)) * 16 * scale;
    const cellH = Math.max(...shots.map((s) => s.box.h)) * 16 * scale;
    const out = document.createElement('canvas');
    out.width = cols * (cellW + gap) + gap;
    out.height = Math.ceil(shots.length / cols) * (cellH + label + gap) + gap;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#3d4038';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingEnabled = false;
    shots.forEach((shot, i) => {
      const x = gap + (i % cols) * (cellW + gap);
      const y = gap + Math.floor(i / cols) * (cellH + label + gap);
      const { box } = shot;
      ctx.drawImage(map, box.x * 16, box.y * 16, box.w * 16, box.h * 16, x, y, box.w * 16 * scale, box.h * 16 * scale);
      ctx.fillStyle = '#fff6e2';
      ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(shot.title, x + 2, y + cellH + 17);
    });
    return out.toDataURL('image/png');
  }, { plots, ids, labels, scale });
}

// ---------------------------------------------------------------------------------------------
// Blueprint files (--blueprints): designs the crew sent back, saved as JSON

/**
 * Reads blueprint JSON files. A file may hold a bare blueprint, `{ blueprint }` or an architect
 * result `{ result: { blueprint, by } }`, with an optional `plot` id such as 'plot-rise'. A folder
 * loads every .json file in it. Each blueprint goes through validateBlueprint, as in the app,
 * before it is drawn; files without a usable blueprint are skipped.
 */
export async function loadBlueprintFiles(inputs) {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { validateBlueprint } = await import('../src/architect/blueprint.js');
  const files = [];
  for (const input of inputs) {
    const info = await stat(input);
    if (info.isDirectory()) {
      for (const name of (await readdir(input)).sort()) if (name.toLowerCase().endsWith('.json')) files.push(path.join(input, name));
    } else files.push(input);
  }
  const out = [];
  for (const file of files) {
    let data;
    try { data = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
    const raw = data && ((data.result && data.result.blueprint) || data.blueprint || (data.style && data.levels ? data : null));
    if (!raw) continue;
    const checked = validateBlueprint(raw);
    if (!checked.ok) continue;
    out.push({
      file: path.basename(file),
      plot: typeof data.plot === 'string' ? data.plot : null,
      blueprint: checked.blueprint,
      by: (data.result && data.result.by) || data.designedBy || 'codex',
    });
  }
  return out;
}

async function launchPreview(repo) {
  const { _electron } = await import('playwright-core');
  const { default: electronPath } = await import('electron');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const userData = await mkdtemp(path.join(tmpdir(), 'milo-kit-'));
  const env = { ...process.env, MILO_PREVIEW_USER_DATA: userData, MILO_PREVIEW_SIZE: '1000x700' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [path.join(repo, 'scripts', 'world-preview-main.cjs'), `--user-data-dir=${userData}`],
    cwd: repo,
    env,
    timeout: 30000,
  });
  return { app, userData };
}

/** Values after `--name` up to the next flag, or null when the flag is absent. */
function flagValues(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  const values = [];
  for (let i = at + 1; i < argv.length && !argv[i].startsWith('--'); i += 1) values.push(argv[i]);
  return values;
}

async function main() {
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);
  const inputs = flagValues(argv, '--blueprints');
  const outDir = (flagValues(argv, '--out') || [])[0];
  const results = outDir ? path.resolve(outDir) : path.join(repo, 'test-results');
  const prefix = (flagValues(argv, '--prefix') || [])[0] || 'blueprints';
  const previewUrl = pathToFileURL(path.join(repo, 'scripts', 'world-preview.html')).href;
  await mkdir(results, { recursive: true });
  const loaded = inputs ? await loadBlueprintFiles(inputs.map((item) => path.resolve(item))) : null;
  if (inputs && !loaded.length) {
    console.error(`No usable blueprints in ${inputs.join(', ') || '(no paths given)'}`);
    process.exitCode = 1;
    return;
  }
  const { buildableArea, plotGate } = await import('../src/world/map.js');
  const kit = await import('../src/world/kit.js');
  const { app, userData } = await launchPreview(repo);
  const report = { errors: [], shots: [], external: [] };
  const save = async (name, dataUrl) => {
    const file = path.join(results, name);
    await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    const inside = path.relative(repo, file);
    report.shots.push(inside.startsWith('..') ? file : inside);
  };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('request', (request) => { if (!request.url().startsWith('file://')) report.external.push(request.url()); });
    await page.goto(`${previewUrl}?motion=0&crew=rest`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });

    if (loaded) {
      // 1. Each blueprint at its own plot's size (7 x 5 without one) at 3x, its emblem at 8x beside it.
      const tiles = loaded.map((item) => {
        const area = item.plot ? buildableArea(item.plot) : null;
        const size = area ? { w: area.w, h: area.h } : { w: 7, h: 5 };
        const s = item.blueprint.style;
        return {
          rows: kit.drawBuilding(item.blueprint, area ? { ...size, gate: plotGate(item.plot) } : size).rows,
          emblem: item.blueprint.emblem,
          title: `${item.blueprint.name}  (${item.file}${item.plot ? `, ${item.plot}` : ''})`,
          note: `${s.shape} · ${s.walls} · ${s.wallColor}/${s.roofColor} ${s.roof} · ${s.windows} · ${item.blueprint.props.map((p) => p.kind).join(', ') || 'no props'}`,
        };
      });
      const cellW = Math.max(...tiles.map((tile) => tile.rows[0].length)) * 3;
      const cellH = Math.max(...tiles.map((tile) => tile.rows.length)) * 3;
      await save(`${prefix}-gallery.png`, await galleryImage(page, tiles, { scale: 3, cols: cellW > 400 ? 2 : 3, cellW, cellH, emblemScale: 8 }));

      // 2. On the map: each blueprint with a plot stands on it; a plot used twice gets another map.
      const maps = [];
      for (const item of loaded) {
        if (!item.plot || !buildableArea(item.plot)) continue;
        let round = maps.find((plots) => !plots[item.plot]);
        if (!round) maps.push(round = {});
        round[item.plot] = item;
      }
      for (const [index, round] of maps.entries()) {
        const plots = {};
        const labels = {};
        for (const [plotId, item] of Object.entries(round)) {
          plots[plotId] = {
            status: 'built', suggestions: [], asked: null,
            idea: { id: `file:${index}`, title: item.blueprint.name, pitch: '', why: '', source: 'local' },
            blueprint: item.blueprint, designedBy: item.by, builtAt: Date.parse('2026-09-26T12:00:00Z'), name: null,
          };
          labels[plotId] = `${item.blueprint.name} (${plotId})`;
        }
        const suffix = maps.length > 1 ? `-${index + 1}` : '';
        await save(`${prefix}-world${suffix}.png`, await worldImage(page, plots, { scale: 2 }));
        await save(`${prefix}-closeups${suffix}.png`, await closeupImage(page, plots, Object.keys(round), labels, { scale: 3 }));
      }
    } else {
      // Gallery: every sample on a 7 x 5 plot at 3x, labelled, then the empty plot and the four
      // building-site stages, and two buildings being redesigned.
      const plot = { w: 7, h: 5 };
      const tiles = [
        ...BLUEPRINTS.map((bp) => ({ rows: kit.drawBuilding(bp, plot).rows, title: bp.name, note: `${bp.style.shape} · ${bp.style.walls} · ${bp.style.roof} · ${bp.style.windows}` })),
        { rows: kit.drawEmptyPlot(plot).rows, title: 'Empty plot', note: 'staked, with a For you sign' },
        ...[0, 1, 2, 3].map((stage) => ({ rows: kit.drawConstruction(plot, stage).rows, title: `Building site, stage ${stage}`, note: ['stakes', 'frame', 'scaffold and planks', 'nearly done'][stage] })),
        // A redesign: the building stays up, with a light scaffold round it, until the new plans land.
        ...BLUEPRINTS.slice(0, 2).map((bp) => ({ rows: kit.drawRedesign(bp, plot).rows, title: `${bp.name}, being redesigned`, note: 'the building stays up behind a scaffold' })),
      ];
      await save('kit-gallery.png', await galleryImage(page, tiles, { scale: 3, cols: 6, cellW: plot.w * 16 * 3, cellH: plot.h * 16 * 3 }));

      // The world: four buildings on their plots, a fifth being designed with Codex at work.
      await save('kit-world.png', await worldImage(page, demoPlots(), {
        scale: 2,
        crew: [
          { id: 'claude', state: 'done', label: 'Claude Code', count: 1 },
          { id: 'codex', state: 'designing', plotId: 'plot-pond', label: 'Codex', count: 0 },
          { id: 'whisper', state: 'idle', label: 'Whisper', count: 0 },
          { id: 'jev', state: 'idle', label: 'Jev', count: 0 },
        ],
      }));
    }
    report.errors.push(...(await page.evaluate(() => window.__errors)));
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length || report.external.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
