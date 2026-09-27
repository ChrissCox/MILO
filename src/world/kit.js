// MILO's building kit: turns a blueprint into pixel art in the world's own style.
//
// Pure data and string grids, safe to import in Node (no DOM). Every drawing is a grid of
// PALETTE keys (see sprites.js) with '.' for transparent, like the hand-made camp and
// watchtower. The kit follows the same rules as that art: soft ink outlines (never black),
// light from the upper left (lit left faces and highlights, shaded right faces and
// under-eave shadow rows), stone footings, and small readable details.
//
//   drawBuilding(blueprint, { w, h, gate })   a built plot, sized to w x h tiles
//   drawConstruction(plot, stage 0..3)        stakes, frame, scaffold, nearly done
//   drawEmptyPlot(plot)                       a tidy staked plot with a "For you" signpost
//
// Each returns { rows, ground, sprite, frames, anchor, door, ... }:
//   rows    the whole plot as one opaque picture (panels, galleries)
//   ground  flat yard art only ('.' elsewhere); the world bakes it under everything
//   sprite  the standing art only (building, props); the world y-sorts it by anchor.y
//   frames  sprite frames (a flag waves between two), frames[0] === sprite
//   anchor  { x, y } bottom-centre of the building's footprint, in grid px
//   door    { x, y } the door's threshold on the footprint's bottom edge, in grid px
//   smoke   { x, y } where chimney smoke rises, or null;  props: where each prop landed
// `gate` says where the plot's gate is: { side: 'bottom' | 'left' | 'right', at } with `at`
// in px along that side (defaults to the middle of the bottom edge).
//
// Combinations the kit deliberately reinterprets so every blueprint stays clean:
//   colours   a roof too close to its walls takes a neighbouring colour; trim too close to the
//             walls takes the first of cream, woodDeep, woodLight... that stands out; doors are
//             painted to match a painted roof; pale awnings stripe with their own shade.
//   glass     glass walls and greenhouses get no windows cut into them (the wall is glass);
//             greenhouse roofs are glazed unless thatched or a canopy.
//   chimneys  domes and canopy roofs can't carry one, so it climbs the right wall; workshops,
//             mills and pavilions get a slim stovepipe.
//   pavilion  the open front is the door (door style unused), no windows, an awning becomes a
//             valance under the eave, and the sign hangs in the opening.
//   mill      double and sliding doors become arched, tall and shopfront windows round; the
//             sign hangs beside the door (the sails would hide it) and the flag flies mid-cap.
//   tower     a flat roof gets battlements; a hip roof on a narrow body becomes a pyramid.
//   shop      shingle, hip and thatch roofs get a false front that carries the sign.
//   hall      a bell cupola on the ridge (not on a dome). observatory: a slit and telescope in
//             a dome, or a small domed turret on any other roof.
//   signs     in a front gable, on a false front, else on the eave above the door (or awning).
//   windows   shopfronts need 14 px of wall beside the door, else become square; tall walls
//             get an upper floor, falling back to smaller windows to clear the sign.

import { PALETTE, SPRITES } from './sprites.js';

export const TILE_PX = 16;

// ---------- blueprint vocabulary (mirrors src/architect/blueprint.js) ----------

export const SHAPES = ['cottage', 'hall', 'tower', 'barn', 'shop', 'greenhouse', 'observatory', 'mill', 'pavilion', 'workshop'];
export const WALLS = ['log', 'plank', 'stone', 'plaster', 'brick', 'glass'];
export const ROOFS = ['gable', 'hip', 'flat', 'dome', 'thatch', 'shingle', 'awning'];
export const DOORS = ['plain', 'arched', 'double', 'sliding'];
export const WINDOWS = ['none', 'square', 'round', 'tall', 'shopfront'];
export const COLOURS = ['cream', 'wood', 'woodDeep', 'woodLight', 'stone', 'stoneDeep', 'clay', 'clayDeep', 'blossom',
  'butter', 'honey', 'slate', 'slateDeep', 'lavender', 'leaf', 'leafDeep', 'water', 'sand'];
export const YARDS = ['grass', 'path', 'stone', 'flowers', 'garden', 'sand'];
export const PROP_KINDS = ['easel', 'anvil', 'crates', 'barrels', 'bookcart', 'telescope', 'camera', 'filmreel', 'musicstand',
  'gardenbed', 'lantern', 'bench', 'mailbox', 'pottedplant', 'well', 'handcart', 'dicetable', 'chalkboard',
  'antenna', 'beehive', 'workbench', 'scrollrack', 'trophy', 'kiln', 'fishingrack', 'birdhouse', 'fountain', 'signboard'];
export const PROP_SIDES = ['left', 'right', 'front'];
export const EMBLEM_KEYS = ['o', 'c', 'r', 'u', 'U', 'e', 'l', 'L', 'k', 'v', 'b', 'B', 's', 'w'];

// ---------- colour ramps ----------
// hi: lit edges and highlights, base: the colour itself, lo: shade and texture lines,
// deep: eaves, ridges and the darkest details. Every key is a PALETTE key.

export const RAMPS = {
  cream: { hi: 'c', base: 'c', lo: 'C', deep: 'P', family: 'cream' },
  sand: { hi: 'c', base: 'p', lo: 'P', deep: 'b', family: 'cream' },
  woodLight: { hi: 'c', base: 'n', lo: 'b', deep: 'B', family: 'wood' },
  wood: { hi: 'n', base: 'b', lo: 'B', deep: 'm', family: 'wood' },
  woodDeep: { hi: 'b', base: 'B', lo: 'm', deep: 'm', family: 'wood' },
  stone: { hi: 'c', base: 's', lo: 'S', deep: 'z', family: 'stone' },
  stoneDeep: { hi: 's', base: 'S', lo: 'z', deep: 'z', family: 'stone' },
  clay: { hi: 'k', base: 'r', lo: 'R', deep: 'Q', family: 'clay' },
  clayDeep: { hi: 'r', base: 'R', lo: 'Q', deep: 'm', family: 'clay' },
  blossom: { hi: 'c', base: 'k', lo: 'K', deep: 'R', family: 'pink' },
  butter: { hi: 'c', base: 'u', lo: 'U', deep: 'Y', family: 'yellow' },
  honey: { hi: 'u', base: 'U', lo: 'Y', deep: 'B', family: 'yellow' },
  slate: { hi: 'w', base: 'e', lo: 'E', deep: 'N', family: 'blue' },
  slateDeep: { hi: 'e', base: 'E', lo: 'N', deep: 'N', family: 'blue' },
  lavender: { hi: 'c', base: 'v', lo: 'V', deep: 'E', family: 'purple' },
  leaf: { hi: 'q', base: 'l', lo: 'L', deep: 'M', family: 'green' },
  leafDeep: { hi: 'l', base: 'L', lo: 'M', deep: 'M', family: 'green' },
  water: { hi: 'f', base: 'w', lo: 'W', deep: 'E', family: 'blue' },
};

// Perceived lightness (0-255) of every opaque palette key.
const LUMA = {};
for (const [key, { hex }] of Object.entries(PALETTE)) {
  if (!hex.startsWith('#')) continue;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  LUMA[key] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const lumaOf = (colour) => LUMA[RAMPS[colour].base];

// A roof that would melt into its walls takes the nearest colour that stands apart.
const ROOF_SWAP = {
  cream: 'clay', sand: 'clay', woodLight: 'clayDeep', wood: 'clayDeep', woodDeep: 'clay', stone: 'slateDeep', stoneDeep: 'slate',
  clay: 'clayDeep', clayDeep: 'clay', blossom: 'clayDeep', butter: 'honey', honey: 'clayDeep', slate: 'slateDeep',
  slateDeep: 'slate', lavender: 'slateDeep', leaf: 'leafDeep', leafDeep: 'leaf', water: 'slateDeep',
};
const TRIM_CHOICES = ['cream', 'woodDeep', 'woodLight', 'wood', 'slateDeep'];

/** Colours actually used, after gentle fixes for pairs that would clash or vanish. */
export function resolveColours(style) {
  const wall = style.wallColor;
  let roof = style.roofColor;
  if (roof === wall || (RAMPS[roof].family === RAMPS[wall].family && Math.abs(lumaOf(roof) - lumaOf(wall)) < 26)) roof = ROOF_SWAP[wall];
  let trim = style.trim;
  const trimOk = (t) => Math.abs(lumaOf(t) - lumaOf(wall)) >= 28;
  if (!trimOk(trim)) trim = TRIM_CHOICES.find(trimOk) || 'woodDeep';
  // Doors are painted to match a painted roof, and are plain wood under wood, stone or cream roofs.
  const painted = !['wood', 'stone', 'cream'].includes(RAMPS[roof].family);
  let door = painted ? roof : 'wood';
  if (RAMPS[door].family === RAMPS[wall].family && Math.abs(lumaOf(door) - lumaOf(wall)) < 30) door = lumaOf(wall) > 150 ? 'woodDeep' : 'woodLight';
  const accent = (value) => (value === 'none' ? null : value);
  return { wall, roof, trim, door, flag: accent(style.flag), awning: accent(style.awning) };
}

// Two stripe colours for an awning: its colour and cream, or its own shade when it is pale.
function stripesOf(colour) {
  const ramp = RAMPS[colour];
  if (Math.abs(LUMA[ramp.base] - LUMA.c) >= 30) return [ramp.base, 'c', ramp.lo, 'C'];
  return [ramp.base, ramp.deep, ramp.lo, ramp.deep];
}

// ---------- normalizing (the kit never trusts its input) ----------

const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);

export function normalizeEmblem(rows) {
  const out = [];
  for (let y = 0; y < 12; y += 1) {
    const row = Array.isArray(rows) && typeof rows[y] === 'string' ? [...rows[y]] : [];
    let line = '';
    for (let x = 0; x < 12; x += 1) line += EMBLEM_KEYS.includes(row[x]) ? row[x] : '.';
    out.push(line);
  }
  return out;
}

export function normalizeForKit(input) {
  const src = input && typeof input === 'object' ? input : {};
  const s = src.style && typeof src.style === 'object' ? src.style : {};
  const accent = (value) => (COLOURS.includes(value) ? value : 'none');
  const style = {
    shape: pick(s.shape, SHAPES, 'cottage'),
    walls: pick(s.walls, WALLS, 'plank'),
    wallColor: pick(s.wallColor, COLOURS, 'cream'),
    roof: pick(s.roof, ROOFS, 'gable'),
    roofColor: pick(s.roofColor, COLOURS, 'clay'),
    trim: pick(s.trim, COLOURS, 'woodDeep'),
    door: pick(s.door, DOORS, 'plain'),
    windows: pick(s.windows, WINDOWS, 'square'),
    chimney: s.chimney === true,
    flag: accent(s.flag),
    awning: accent(s.awning),
  };
  const props = (Array.isArray(src.props) ? src.props : [])
    .filter((p) => p && PROP_KINDS.includes(p.kind))
    .slice(0, 4)
    .map((p) => ({ kind: p.kind, side: pick(p.side, PROP_SIDES, 'front') }));
  return {
    name: typeof src.name === 'string' ? src.name.slice(0, 28) : '',
    style,
    emblem: normalizeEmblem(src.emblem),
    props,
    yard: pick(src.yard, YARDS, 'grass'),
  };
}

// ---------- raster layers ----------

function layer(w, h) {
  return { w, h, px: Array.from({ length: h }, () => new Array(w).fill('.')) };
}
const inb = (L, x, y) => x >= 0 && y >= 0 && x < L.w && y < L.h;
function put(L, x, y, k) {
  if (k && k !== '.' && inb(L, x, y)) L.px[y][x] = k;
}
function at(L, x, y) {
  return inb(L, x, y) ? L.px[y][x] : '.';
}
function fillRect(L, x, y, w, h, k) {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) put(L, xx, yy, k);
}
// Copies a layer or a rows grid onto L. `map` optionally recolours keys ({ from: to } or a function).
function blit(L, src, x, y, map = null) {
  const rows = src.px ? src.px : src;
  for (let dy = 0; dy < rows.length; dy += 1) {
    const row = rows[dy];
    for (let dx = 0; dx < row.length; dx += 1) {
      let k = row[dx];
      if (k === '.') continue;
      if (map) k = typeof map === 'function' ? map(k, dx, dy) : (map[k] ?? k);
      put(L, x + dx, y + dy, k);
    }
  }
}
// Inner outline: every opaque pixel with an open (4-neighbour) side becomes ink.
function outline(L, k = 'o', { bottom = true } = {}) {
  const edge = [];
  for (let y = 0; y < L.h; y += 1) {
    for (let x = 0; x < L.w; x += 1) {
      if (L.px[y][x] === '.') continue;
      const open = (xx, yy) => at(L, xx, yy) === '.';
      if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || (bottom && open(x, y + 1))) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) L.px[y][x] = k;
  return L;
}
function toRows(L) {
  return L.px.map((row) => row.join(''));
}
function fromRows(rows) {
  const L = layer(rows[0].length, rows.length);
  blit(L, rows, 0, 0);
  return L;
}
function opaqueBox(L) {
  let x0 = L.w;
  let y0 = L.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < L.h; y += 1) {
    for (let x = 0; x < L.w; x += 1) {
      if (L.px[y][x] === '.') continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// Grid templates use placeholder characters that `legend` turns into palette keys.
function tpl(text) {
  return text.split('\n').map((row) => row.trim()).filter((row) => row.length > 0);
}
function paintTpl(rows, legend) {
  return rows.map((row) => [...row].map((ch) => (ch === '.' ? '.' : legend[ch] ?? ch)).join(''));
}
function hash(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- layout ----------

// Preferred body width, wall height and roof height per shape, in px. The planner shrinks
// them to fit the plot; `tall` shapes grow their walls into spare height instead.
const SHAPE_SPECS = {
  cottage: { w: 60, wall: 22, roof: 22, minW: 44 },
  hall: { w: 90, wall: 24, roof: 20, minW: 58 },
  tower: { w: 34, wall: 40, roof: 20, minW: 28, tall: true, maxWall: 46 },
  barn: { w: 68, wall: 24, roof: 24, minW: 50 },
  shop: { w: 62, wall: 26, roof: 18, minW: 46 },
  greenhouse: { w: 70, wall: 22, roof: 18, minW: 48 },
  observatory: { w: 56, wall: 24, roof: 22, minW: 44 },
  mill: { w: 36, wall: 36, roof: 14, minW: 30, tall: true, maxWall: 44 },
  pavilion: { w: 72, wall: 22, roof: 18, minW: 48 },
  workshop: { w: 60, wall: 22, roof: 20, minW: 46, annex: 18 },
};

const DOOR_SIZE = { plain: { w: 10, h: 14 }, arched: { w: 10, h: 15 }, double: { w: 15, h: 14 }, sliding: { w: 18, h: 15 } };

function gateOf(options, W, H) {
  const gate = options && options.gate && typeof options.gate === 'object' ? options.gate : {};
  const side = ['bottom', 'left', 'right'].includes(gate.side) ? gate.side : 'bottom';
  const span = side === 'bottom' ? W : H;
  const fallback = side === 'bottom' ? Math.floor(W / 2) : H - 8;
  const where = Number.isFinite(gate.at) ? Math.round(gate.at) : fallback;
  return { side, at: clamp(where, 6, span - 7) };
}

// Where everything goes: body box, roof height, door, and the yard's front strip.
function planHouse(bp, W, H, gate) {
  const { style } = bp;
  const spec = SHAPE_SPECS[style.shape];
  const front = H >= 72 ? 14 : 12;
  const yB = H - front - 1;
  // Headroom above the roof for what stands on it: a flag, a chimney, a hall's cupola (with the
  // flag on top), a shop's false front.
  let headroom = 2;
  if (style.chimney) headroom = 6;
  if (style.flag !== 'none') headroom = 10;
  if (style.shape === 'hall' && style.roof !== 'dome') headroom += 7;
  if (style.shape === 'shop' && ['shingle', 'hip', 'thatch'].includes(style.roof)) headroom += 3;
  if (style.shape === 'observatory' && style.roof !== 'dome') headroom += 8;
  const budget = yB - headroom;
  const door = style.shape === 'pavilion' ? { w: 16, h: 14 } : DOOR_SIZE[style.door];
  const awning = style.awning !== 'none';
  const minWall = door.h + 5 + (awning ? 6 : 0);

  let roofH = spec.roof;
  if (style.roof === 'flat') roofH = style.shape === 'tower' ? 11 : 9;
  if (style.roof === 'awning') roofH = Math.min(roofH, 16);
  if (style.roof === 'dome') roofH = Math.max(roofH, 20);
  let wallH = Math.max(spec.wall, minWall);
  if (spec.tall) wallH = Math.max(minWall, Math.min(spec.maxWall, budget - roofH));
  if (wallH + roofH > budget) roofH = Math.max(style.roof === 'flat' ? 8 : 12, budget - wallH);
  if (wallH + roofH > budget) wallH = Math.max(minWall, budget - roofH);

  // Horizontal: centre on the gate for a bottom gate; leave a lane for the path for a side gate.
  const sideNeed = { left: 4, right: 4 };
  for (const prop of bp.props) if (prop.side !== 'front') sideNeed[prop.side] = 20;
  let cx = Math.floor(W / 2);
  if (gate.side === 'bottom') cx = clamp(gate.at, Math.floor(W * 0.3), Math.ceil(W * 0.7));
  if (gate.side === 'right') { cx = Math.floor((W - 16) / 2); sideNeed.right = Math.max(sideNeed.right, 14); }
  if (gate.side === 'left') { cx = Math.ceil((W + 16) / 2); sideNeed.left = Math.max(sideNeed.left, 14); }
  const annex = spec.annex || 0;
  const over = 3;
  const room = Math.min(cx - sideNeed.left, W - 1 - cx - sideNeed.right - annex) - over;
  // Long plots get a longer building.
  let bw = Math.min(Math.round(spec.w * (W >= 176 ? 1.25 : 1)), room * 2);
  bw = Math.max(bw, Math.min(spec.minW, W - 8 - annex));
  bw -= bw % 2;
  const x0 = cx - bw / 2;
  const x1 = x0 + bw - 1;
  return { W, H, gate, front, yB, yT: yB - wallH, wallH, rh: roofH, bw, cx, x0, x1, door, annex };
}

// ---------- walls ----------

// Stone blocks: courses 4 rows high (3 of stone, 1 of mortar), blocks 4-7 px wide, staggered.
function stoneKey(R, rx, ry) {
  const course = Math.floor((ry - 1) / 4);
  const r = mod(ry - 1, 4);
  if (r === 3) return R.lo;
  let start = -Math.floor(hash(course, 3, 11) * 6);
  let i = 0;
  for (;;) {
    const w = 4 + Math.floor(hash(course, i, 13) * 4);
    if (rx < start + w) break;
    start += w;
    i += 1;
  }
  if (rx === start) return R.lo;
  if (r === 0 && rx === start + 1) return R.hi;
  return R.base;
}

function brickKey(R, rx, ry, mortar) {
  const course = Math.floor((ry - 1) / 3);
  const r = mod(ry - 1, 3);
  if (r === 2) return mortar;
  const u = mod(rx + (mod(course, 2) ? 3 : 0), 6);
  if (u === 5) return mortar;
  if (r === 0 && u === 0) return R.hi;
  return R.base;
}

function glassKey(F, rx, ry, x, y, plantsFrom) {
  if (mod(rx, 8) === 0 || ry === 1) return F;
  if (ry >= plantsFrom) {
    const n = hash(Math.floor(x / 2), Math.floor(y / 2), 23);
    const top = ry === plantsFrom;
    if (!top || n > 0.45) return n > 0.8 ? 'q' : n > 0.35 ? 'l' : 'L';
  }
  const d = mod(rx - ry, 9);
  if (d === 3 || (d === 4 && mod(ry, 2) === 0)) return 'f';
  return mod(ry, 7) === 0 ? 'W' : 'w';
}

// Frame colour for glass: the wall colour unless it would vanish into the sky-blue panes.
function glassFrame(R) {
  return Math.abs(LUMA[R.base] - LUMA.w) < 18 ? 'c' : R.base;
}

// The body: walls in their material, a stone footing, and (for a front gable) the gable wall.
function drawBody(P, style, C, { inGable = null, glassUpper = false } = {}) {
  const L = layer(P.W, P.H);
  const R = RAMPS[C.wall];
  const T = RAMPS[C.trim];
  const { x0, x1, yT, yB } = P;
  const material = style.walls;
  const mortar = RAMPS[C.wall].family === 'cream' || C.wall === 'butter' ? R.lo : 'C';
  const kneeTop = yB - 6; // glass sits on a low wall
  const glassRows = material === 'glass' || glassUpper;
  const F = material === 'glass' ? glassFrame(R) : T.base;
  const plantsFrom = Math.max(3, Math.floor((kneeTop - yT) * 0.55));
  const top = inGable ? Math.max(0, yT - P.rh) : yT - 1;
  for (let y = top; y <= yB; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (y < yT - 1 && !(inGable && inGable(x, y))) continue;
      const rx = x - x0 - 1;
      const ry = y - yT;
      let k = R.base;
      if (glassRows && y < kneeTop) k = glassKey(F, rx, ry, x, y, plantsFrom);
      else if (glassRows && y === kneeTop) k = F;
      else if (glassRows && material === 'glass') k = y === kneeTop + 1 ? R.hi : R.base;
      else k = wallKeyOf(material, R, rx, ry, x, y, mortar);
      put(L, x, y, k);
    }
  }
  // Right edge in shade: light comes from the upper left.
  if (!glassRows) for (let y = yT; y < yB - 2; y += 1) if (at(L, x1 - 1, y) === R.base || at(L, x1 - 1, y) === R.hi) put(L, x1 - 1, y, R.lo);
  // Footing: two rows of stone like the cabin's.
  const foot = material === 'stone' && ['stone', 'stoneDeep'].includes(C.wall) ? RAMPS.stoneDeep : RAMPS.stone;
  for (let x = x0; x <= x1; x += 1) {
    put(L, x, yB - 2, mod(x - x0, 6) === 5 ? foot.lo : foot.base);
    put(L, x, yB - 1, foot.lo);
  }
  if (material === 'plaster' && !glassUpper) halfTimber(L, P, T, R);
  outline(L);
  if (material === 'log' && !glassUpper) logEnds(L, P, R);
  return L;
}

function wallKeyOf(material, R, rx, ry, x, y, mortar) {
  switch (material) {
    case 'log': return [R.hi, R.base, R.lo][mod(ry - 1, 3)];
    case 'plank': return [R.hi, R.base, R.base, R.lo][mod(rx, 4)];
    case 'stone': return stoneKey(R, rx, ry);
    case 'brick': return brickKey(R, rx, ry, mortar);
    case 'plaster': return hash(x, y, 3) < 0.035 ? R.lo : R.base;
    default: return R.base;
  }
}

// Plaster walls get a timber frame in the trim colour: corner posts, a top plate and a rail.
function halfTimber(L, P, T, R) {
  const { x0, x1, yT, yB } = P;
  const rail = yT + Math.max(5, Math.floor((yB - yT) * 0.45));
  const beam = (x, y) => { if (at(L, x, y) !== '.' && y < yB - 2) put(L, x, y, T.base); };
  for (let y = yT; y < yB - 2; y += 1) {
    beam(x0 + 1, y); beam(x0 + 2, y);
    beam(x1 - 2, y); beam(x1 - 1, y);
    put(L, x0 + 3, y, at(L, x0 + 3, y) === R.base ? R.lo : at(L, x0 + 3, y));
  }
  for (let x = x0 + 1; x < x1; x += 1) {
    beam(x, yT + 1);
    beam(x, rail);
    if (at(L, x, rail + 1) === R.base) put(L, x, rail + 1, R.lo);
    if (at(L, x, yT + 2) === R.base) put(L, x, yT + 2, R.lo);
  }
  // Studs between the posts, every 14 px or so.
  const span = x1 - x0 - 6;
  const studs = Math.max(0, Math.round(span / 16) - 1);
  for (let i = 1; i <= studs; i += 1) {
    const sx = x0 + 3 + Math.round((span * i) / (studs + 1));
    for (let y = yT + 1; y < yB - 2; y += 1) beam(sx, y);
  }
}

// Round log ends poke out at both corners, as on the cabin.
function logEnds(L, P, R) {
  const { x0, x1, yT, yB } = P;
  for (let y = yT + 1; y + 1 < yB - 2; y += 3) {
    for (const [edge, dir] of [[x0, -1], [x1, 1]]) {
      const face = dir < 0 ? R.hi : R.base;
      put(L, edge + dir, y, 'o');
      put(L, edge + dir, y + 1, 'o');
      put(L, edge, y, face);
      put(L, edge, y + 1, face);
      put(L, edge - dir, y, face);
      put(L, edge - dir, y + 1, face);
      put(L, edge - 2 * dir, y, 'o');
      put(L, edge - 2 * dir, y + 1, 'o');
      put(L, edge, y + 2, 'o');
      put(L, edge - dir, y + 2, 'o');
    }
  }
}

// ---------- roofs ----------
// Each roof function draws into its own layer (then outlines it) and returns where its top is,
// so chimneys, flags and cupolas can stand on it.

function columnTop(L, x) {
  for (let y = 0; y < L.h; y += 1) if (at(L, x, y) !== '.') return y;
  return null;
}

// Side gable, like the cabin: shingle courses every third row, a darker ridge and eave.
function roofShingle(P, R) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 2;
  const right = P.x1 + 2;
  const yBot = P.yT - 1;
  const rh = P.rh;
  for (let t = 0; t < rh; t += 1) {
    const y = yBot - t;
    let inset = Math.floor((t + 1) / 3);
    if (t === rh - 2) inset += 1;
    if (t === rh - 1) inset += 2;
    for (let x = left + inset; x <= right - inset; x += 1) {
      let k = R.base;
      if (t === 1 || t === rh - 2) k = R.lo;
      else if (t >= 2 && (t - 2) % 3 === 2) k = mod(x + Math.floor((t - 2) / 3), 2) ? R.lo : R.base;
      // the gable end on the right sits in shade
      if (t > 1 && t < rh - 2 && x >= right - inset - 2) k = k === R.base ? R.lo : R.deep;
      put(L, x, y, k);
    }
  }
  outline(L);
  const top = yBot - rh + 1;
  return { L, top, flagAt: { x: left + Math.floor((rh + 1) / 3) + 4, y: top }, ridge: [left + 6, right - 6] };
}

// Hip roof: hips at both ends (lit on the left, shaded on the right), tile courses across the
// front. A narrow hip roof comes to a point and splits into a lit and a shaded half, like the
// watchtower's.
function roofHip(P, R) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 2;
  const right = P.x1 + 2;
  const yBot = P.yT - 1;
  const rh = P.rh;
  const half = (right - left) / 2;
  const cx = (left + right) / 2;
  const pyramid = half <= rh * 1.15 || half - rh * 0.55 < 3;
  for (let t = 0; t < rh; t += 1) {
    const y = yBot - t;
    const inset = pyramid ? Math.round((t * (half - 0.5)) / (rh - 0.5)) : Math.floor((t + 1) / 2);
    for (let x = left + inset; x <= right - inset; x += 1) {
      const course = t >= 2 && (t - 2) % 3 === 2;
      let face = 'front';
      if (pyramid) face = x < cx ? 'left' : 'right';
      else if (x < left + t) face = 'left';
      else if (x > right - t) face = 'right';
      let k;
      if (face === 'right') k = course ? R.deep : R.lo;
      else if (face === 'left' && !pyramid) k = course ? R.base : R.hi;
      else k = course ? R.lo : R.base;
      if (t === 1) k = face === 'right' ? R.deep : R.lo;
      put(L, x, y, k);
    }
  }
  outline(L);
  const top = columnTop(L, Math.round(cx));
  return { L, top, flagAt: { x: Math.round(cx), y: top }, pointed: pyramid, ridge: pyramid ? [Math.round(cx), Math.round(cx)] : [left + rh / 2, right - rh / 2] };
}

// Front gable: a roof chevron over a triangular gable wall (the wall shows through).
function roofGable(P, R, T) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 3;
  const right = P.x1 + 3;
  const yBot = P.yT - 1;
  const rh = P.rh;
  const yTop = yBot - rh + 1;
  const cx = (left + right) / 2;
  const half = (right - left + 1) / 2;
  const th = clamp(Math.round(rh * 0.3), 5, 7);
  const outer = (x, y) => Math.abs(x - cx) <= 1 + ((y - yTop) * (half - 1)) / (rh - 1);
  const inner = (x, y) => y - yTop > th && Math.abs(x - cx) <= ((y - yTop - th) * (half - 1)) / (rh - 1) - 1.2;
  for (let y = yTop; y <= yBot; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (!outer(x, y) || inner(x, y)) continue;
      const lit = x < cx;
      const course = mod(y - yTop, 3) === 2;
      let k = lit ? (course ? R.lo : R.base) : course ? R.deep : R.lo;
      if (y === yBot - 1) k = lit ? R.lo : R.deep;
      put(L, x, y, k);
    }
  }
  // A trim bargeboard along the inside of the chevron.
  for (let y = yTop; y <= yBot; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (at(L, x, y) === '.' || y >= yBot - 1) continue;
      if (inner(x, y + 1) || inner(x - 1, y + 1) || inner(x + 1, y + 1)) put(L, x, y, x < cx ? T.hi : T.base);
    }
  }
  outline(L);
  const gableTop = yTop + th + 1;
  return {
    L, top: yTop, flagAt: { x: Math.round(cx), y: yTop }, pointed: true,
    inGable: (x, y) => inner(x, y),
    gable: { cx: Math.round(cx), top: gableTop, bottom: yBot, halfAt: (y) => ((y - yTop - th) * (half - 1)) / (rh - 1) - 1.2 },
  };
}

// Flat roof: a parapet with a lit cap, the roof deck just visible behind it, and a dentil
// cornice. Towers get battlements instead.
function roofFlat(P, R, { battlements = false } = {}) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 1;
  const right = P.x1 + 1;
  const yBot = P.yT - 1;
  const rh = P.rh;
  const yTop = yBot - rh + 1;
  for (let y = yTop; y <= yBot; y += 1) {
    const r = y - yTop;
    for (let x = left; x <= right; x += 1) {
      let k = R.base;
      const side = x <= left + 1 || x >= right - 1;
      if (r === 1) k = R.hi;
      else if (r >= 2 && r <= rh - 6) k = side ? R.hi : hash(x, y, 29) < 0.08 ? R.deep : R.lo;
      else if (r === rh - 5) k = R.hi;
      else if (r === rh - 2) k = mod(x, 2) ? R.lo : R.base;
      if (battlements && r <= 3 && mod(x - left, 7) >= 4 && x > left + 1 && x < right - 1) continue;
      if (battlements && r >= 1 && r <= 3) k = r === 1 ? R.hi : R.base;
      put(L, x, y, k);
    }
  }
  outline(L);
  return { L, top: yTop, flagAt: { x: battlements ? Math.round((left + right) / 2) : left + 4, y: yTop }, flat: true };
}

// Dome on a drum: shaded like a ball lit from the upper left, with two ribs and a finial.
function roofDome(P, R, T, { slit = false } = {}) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 1;
  const right = P.x1 + 1;
  const yBot = P.yT - 1;
  const cx = (left + right) / 2;
  for (let x = left; x <= right; x += 1) {
    put(L, x, yBot - 2, T.hi);
    put(L, x, yBot - 1, mod(x, 3) === 0 ? T.lo : T.base);
    put(L, x, yBot, T.base);
  }
  const base = yBot - 3;
  const rx = Math.max(8, Math.min((right - left) / 2 - 3, 26));
  const ry = Math.max(8, P.rh - 5);
  const sx = Math.round(cx);
  for (let y = base - Math.ceil(ry); y <= base; y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - base - 1) / ry;
      if (nx * nx + ny * ny > 1 || ny > 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const light = -0.55 * nx - 0.5 * ny + 0.62 * nz;
      let k = light > 0.8 ? R.hi : light > 0.35 ? R.base : light > 0.02 ? R.lo : R.deep;
      const rib = Math.abs(Math.abs(nx) - 0.45 * Math.sqrt(Math.max(0, 1 - ny * ny))) < 0.5 / rx;
      if (rib && ny < -0.15) k = nx < 0 ? R.lo : R.deep;
      if (slit && x >= sx && x <= sx + 2 && ny < -0.2) k = x === sx ? 'o' : 'N';
      put(L, x, y, k);
    }
  }
  const top = base - Math.ceil(ry);
  outline(L);
  const fx = sx - 1;
  put(L, fx, top - 1, 'o'); put(L, fx + 1, top - 1, 'o');
  put(L, fx - 1, top, 'o'); put(L, fx, top, 'u'); put(L, fx + 1, top, 'U'); put(L, fx + 2, top, 'o');
  return { L, top: top - 1, flagAt: { x: sx, y: top - 1 }, pointed: true, dome: { cx, base, rx, ry } };
}

// Thatch: a thick rounded straw roof with layered strands and a shaggy fringe.
function roofThatch(P, R) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 3;
  const right = P.x1 + 3;
  const yBot = P.yT - 1;
  const rh = P.rh;
  for (let t = 0; t < rh; t += 1) {
    const y = yBot - t;
    let inset = Math.floor(t * 0.55);
    if (t >= rh - 3) inset += [1, 3, 6][t - (rh - 3)];
    for (let x = left + inset; x <= right - inset; x += 1) {
      const n = hash(x, Math.floor(y / 2), 5);
      let k = R.base;
      if (n < 0.24) k = R.lo;
      else if (n > 0.9) k = R.hi;
      if (t > 1 && (t - 1) % 4 === 0 && mod(x, 3) !== 0) k = R.lo;
      if (t >= rh - 4 && t < rh - 1) k = mod(x, 6) === 0 ? R.lo : R.deep;
      if (x >= right - inset - 2 && k === R.base) k = R.lo;
      put(L, x, y, k);
    }
  }
  for (let x = left + 1; x <= right - 1; x += 1) {
    const drop = hash(x, 1, 9) < 0.55 ? 1 : 2;
    for (let d = 1; d <= drop; d += 1) put(L, x, yBot + d, R.lo);
  }
  outline(L);
  const mid = Math.round((left + right) / 2);
  const top = columnTop(L, mid);
  return { L, top, flagAt: { x: mid, y: top }, ridge: [left + rh, right - rh] };
}

// Striped canopy roof with a scalloped hem.
function roofAwning(P, colour) {
  const L = layer(P.W, P.H);
  const left = P.x0 - 3;
  const right = P.x1 + 3;
  const yBot = P.yT - 1;
  const rh = P.rh;
  const [a, b, aLo, bLo] = stripesOf(colour);
  const cx = Math.round((left + right) / 2);
  const stripe = (x) => mod(Math.floor((x - cx + 2) / 4), 2) === 0;
  const shadeFrom = right - Math.round((right - left) * 0.3);
  for (let t = 0; t < rh; t += 1) {
    const y = yBot - t;
    let inset = Math.floor(t * 0.34);
    if (t === rh - 1) inset += 2;
    for (let x = left + inset; x <= right - inset; x += 1) {
      const shaded = x >= shadeFrom || t === 1;
      let k = stripe(x) ? (shaded ? aLo : a) : shaded ? bLo : b;
      if (t >= rh - 2) k = RAMPS[colour].deep;
      put(L, x, y, k);
    }
  }
  for (let x = left + 1; x < right; x += 1) {
    const u = mod(x - cx + 2, 4);
    const k = stripe(x) ? (x >= shadeFrom ? aLo : a) : x >= shadeFrom ? bLo : b;
    put(L, x, yBot + 1, k);
    if (u === 1 || u === 2) put(L, x, yBot + 2, k);
  }
  outline(L);
  const top = columnTop(L, cx);
  return { L, top, flagAt: { x: cx, y: top }, ridge: [left + 6, right - 6] };
}

// ---------- doors and windows ----------
// Templates: o ink, F frame (trim), L leaf, l leaf plank line, K knob, g pane, G glint, X brace.

const DOOR_TPL = {
  plain: tpl(`
    oooooooooo
    oFFFFFFFFo
    oFLLLLLLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlKFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLLLLLLFo
    oFFFFFFFFo
  `),
  arched: tpl(`
    ...oooo...
    .ooFFFFoo.
    .oFLLLLFo.
    oFLLggLLFo
    oFLLgGLLFo
    oFLLLLLLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlKFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLlLLlLFo
    oFLLLLLLFo
    oFFFFFFFFo
  `),
  double: tpl(`
    ooooooooooooooo
    oFFFFFFFFFFFFFo
    oFLLLLLoLLLLLFo
    oFLlLlLoLlLlLFo
    oFLlLlLoLlLlLFo
    oFLlLlLoLlLlLFo
    oFLLLLLoLLLLLFo
    oFLlLlKoKlLlLFo
    oFLlLlLoLlLlLFo
    oFLlLlLoLlLlLFo
    oFLlLlLoLlLlLFo
    oFLlLlLoLlLlLFo
    oFLLLLLoLLLLLFo
    oFFFFFFFFFFFFFo
  `),
  sliding: tpl(`
    oooooooooooooooooo
    oRRRRRRRRRRRRRRRRo
    oooooooooooooooooo
    .oFFFFFFFFFFFFFFo.
    .oFXLLLLLLLLLLXFo.
    .oFLXLlLLlLLlXLFo.
    .oFLlXLLlLLLXlLFo.
    .oFLlLXLlLLXLlLFo.
    .oFLlLLXlLXLLlLFo.
    .oFLlLLlXXLLLlLFo.
    .oFLlLLXlLXLLlLFo.
    .oFLlLXLlLLXLlLFo.
    .oFLlXLLlLLLXlLFo.
    .oFLXLlLLlLLlXLFo.
    .oFFFFFFFFFFFFFFo.
  `),
};

function doorColours(C) {
  const T = RAMPS[C.trim];
  const D = RAMPS[C.door];
  let F = T.base;
  if (Math.abs(LUMA[F] - LUMA[D.lo]) < 24) F = LUMA[D.lo] < 160 ? T.hi : T.lo;
  if (Math.abs(LUMA[F] - LUMA[D.lo]) < 24) F = LUMA[D.lo] < 160 ? 'c' : 'B';
  return { o: 'o', F, L: D.lo, l: D.base, K: 'u', g: 'u', G: 'c', X: F, R: T.lo === F ? T.deep : T.lo };
}

function makeDoor(kind, C) {
  return paintTpl(DOOR_TPL[kind], doorColours(C));
}

const WINDOW_TPL = {
  square: tpl(`
    ooooooooooo
    oFFFFFFFFFo
    oFGggFGggFo
    oFgggFgghFo
    oFFFFFFFFFo
    oFgggFgghFo
    oFgghFghhFo
    oFFFFFFFFFo
    ooooooooooo
  `),
  round: tpl(`
    ..ooooo..
    .oFFFFFo.
    oFGgFggFo
    oFggFghFo
    oFFFFFFFo
    oFggFghFo
    oFghFhhFo
    .oFFFFFo.
    ..ooooo..
  `),
  tall: tpl(`
    ...ooo...
    .ooFFFoo.
    .oFGggFo.
    oFGggghFo
    oFggFghFo
    oFggFghFo
    oFFFFFFFo
    oFggFghFo
    oFggFghFo
    oFggFghFo
    oFggFghFo
    oFghFhhFo
    oFFFFFFFo
    ooooooooo
  `),
};
const FLOWER_BOX = tpl(`
  .kLk.uk.Lkv.
  oooooooooooo
  oBBBBBBBBBBo
  oooooooooooo
`);

function windowColours(C) {
  const T = RAMPS[C.trim];
  const W = RAMPS[C.wall];
  let F = T.base;
  if (Math.abs(LUMA[F] - LUMA.u) < 14) F = T.lo;
  return { o: 'o', F, g: 'u', G: 'c', h: 'U', wall: W };
}

function makeWindow(kind, C) {
  return paintTpl(WINDOW_TPL[kind], windowColours(C));
}

// A shop window full of little goods on a shelf.
function makeShopfront(width, C) {
  const { F } = windowColours(C);
  const h = 12;
  const L = layer(width, h);
  fillRect(L, 0, 0, width, h, 'o');
  fillRect(L, 1, 1, width - 2, h - 2, F);
  const panes = Math.max(1, Math.round((width - 3) / 10));
  const edges = Array.from({ length: panes + 1 }, (_, i) => 1 + Math.round(((width - 3) * i) / panes));
  for (let y = 2; y <= 8; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      if (edges.includes(x)) continue;
      const d = mod(x - y, 11);
      put(L, x, y, d === 1 || (d === 2 && y < 5) ? 'c' : y >= 7 ? 'U' : 'u');
    }
  }
  const goods = ['r', 'e', 'l', 'U', 'k', 'v', 'B', 'w'];
  for (let x = 3, i = 0; x < width - 4; x += 3, i += 1) {
    const k = goods[mod(i * 3 + width, goods.length)];
    const tall = hash(x, width, 41) < 0.5;
    put(L, x, 8, k); put(L, x + 1, 8, k);
    if (tall) { put(L, x, 7, k); put(L, x + 1, 7, 'o'); }
  }
  for (let x = 1; x < width - 1; x += 1) { put(L, x, 9, 'o'); put(L, x, 10, F); }
  return toRows(L);
}

// A striped door awning with a scalloped hem, `width` px wide.
function makeAwning(width, colour) {
  const [a, b, aLo, bLo] = stripesOf(colour);
  const L = layer(width, 7);
  const stripe = (x) => mod(Math.floor((x - 1) / 3), 2) === 0;
  for (let x = 0; x < width; x += 1) {
    put(L, x, 0, RAMPS[colour].deep);
    put(L, x, 1, RAMPS[colour].deep);
    for (let y = 2; y <= 4; y += 1) {
      const shaded = x > width * 0.7 || y === 2;
      put(L, x, y, stripe(x) ? (shaded ? aLo : a) : shaded ? bLo : b);
    }
    const u = mod(x - 1, 3);
    if (x > 0 && x < width - 1 && u !== 2) put(L, x, 5, stripe(x) ? a : b);
  }
  outline(L);
  return toRows(L);
}

// ---------- chimneys, flags, signs ----------

function makeChimney(height) {
  const rows = ['oooooooo', 'osssssSo', 'oooooooo'];
  const body = ['.osssSo.', '.oSSSSo.', '.osSsso.', '.osssSo.', '.oSsSSo.'];
  for (let i = 0; i < height - 3; i += 1) rows.push(body[i % body.length]);
  return rows;
}

function makeStovepipe(height) {
  const rows = ['oooooo', 'oSssSo', 'oooooo'];
  for (let i = 0; i < height - 3; i += 1) rows.push(i % 4 === 2 ? '.oSSo.' : '.osSo.');
  return rows;
}

const PENNANT = [
  tpl(`
    oooooo...
    oAAAAAoo.
    oAaAAAAAo
    oAaaaoo..
    ooooo....
  `),
  tpl(`
    ooooooo..
    oAAAAAAoo
    oAaAAAAo.
    oAaaaaAoo
    oooooooo.
  `),
];

// Pole with a knob, a pennant flying to the right. Returns frames and the pole's foot (x, y).
function makeFlag(colour, pole = 9) {
  const R = RAMPS[colour];
  const frames = PENNANT.map((rows) => {
    const L = layer(12, pole + 3);
    put(L, 1, 0, 'o');
    put(L, 0, 1, 'o'); put(L, 1, 1, 'u'); put(L, 2, 1, 'o');
    for (let y = 2; y < pole + 3; y += 1) put(L, 1, y, 'o');
    blit(L, paintTpl(rows, { A: R.base, a: R.lo }), 2, 2);
    return toRows(L);
  });
  return { frames, footX: 1, h: pole + 3 };
}

// A 16 x 16 board with the 12 x 12 emblem. The board picks cream or wood so the emblem reads.
export function makeSign(emblem, C) {
  const rows = normalizeEmblem(emblem);
  let cream = 0;
  let total = 0;
  for (const row of rows) for (const ch of row) if (ch !== '.') { total += 1; if (LUMA[ch] > 220) cream += 1; }
  const board = total > 0 && cream / total > 0.35 ? 'b' : 'c';
  const F = RAMPS[C.trim].base === board ? RAMPS[C.trim].lo : RAMPS[C.trim].base;
  const L = layer(16, 16);
  fillRect(L, 0, 0, 16, 16, 'o');
  fillRect(L, 1, 1, 14, 14, F);
  fillRect(L, 2, 2, 12, 12, board);
  blit(L, rows, 2, 2);
  put(L, 1, 1, 'o'); put(L, 14, 1, 'o'); put(L, 1, 14, 'o'); put(L, 14, 14, 'o');
  put(L, 0, 0, '.'); put(L, 15, 0, '.'); put(L, 0, 15, '.'); put(L, 15, 15, '.');
  return toRows(L);
}

// ---------- assembling a building ----------

function makeRoof(style, P, C) {
  const R = RAMPS[C.roof];
  const T = RAMPS[C.trim];
  switch (style.roof) {
    case 'gable': return roofGable(P, R, T);
    case 'hip': return roofHip(P, R);
    case 'flat': return roofFlat(P, R, { battlements: style.shape === 'tower' });
    case 'dome': return roofDome(P, R, T, { slit: style.shape === 'observatory' });
    case 'thatch': return roofThatch(P, R);
    case 'awning': return roofAwning(P, C.roof);
    default: return roofShingle(P, R);
  }
}

// Greenhouse roofs are glazed: panes of sky between frames in the roof colour.
function glaze(roof, R) {
  const { L } = roof;
  for (let y = 0; y < L.h; y += 1) {
    for (let x = 0; x < L.w; x += 1) {
      const k = L.px[y][x];
      if (k === '.' || k === 'o') continue;
      const below = at(L, x, y + 1);
      if (below === 'o' || at(L, x, y - 1) === 'o' || at(L, x - 1, y) === 'o' || at(L, x + 1, y) === 'o') { L.px[y][x] = R.base; continue; }
      const shaded = k === R.lo || k === R.deep;
      if (mod(x, 6) === 0 || mod(y, 5) === 0) L.px[y][x] = R.base;
      else if (mod(x - y, 9) === 2) L.px[y][x] = 'f';
      else L.px[y][x] = shaded ? 'W' : 'w';
    }
  }
}

function roofTopAt(roof, x) {
  const y = columnTop(roof.L, x);
  return y === null ? roof.top : y;
}

// Ground-floor windows beside the door. Returns the boxes used.
function placeGroundWindows(out, P, style, C, door, { flowerBoxes = false } = {}) {
  let kind = style.windows;
  const boxes = [];
  if (kind === 'none') return boxes;
  const segments = [[P.x0 + 4, door.x0 - 3], [door.x1 + 3, P.x1 - 4]];
  for (const [a, b] of segments) {
    const span = b - a + 1;
    let k = kind;
    if (k === 'shopfront') {
      if (span >= 14) {
        const w = Math.min(span - 2, 34);
        const x = Math.round((a + b + 1 - w) / 2);
        const rows = makeShopfront(w, C);
        const y = P.yB - 1 - rows.length;
        blit(out, rows, x, y);
        boxes.push({ x, y, w, h: rows.length, kind: 'shopfront' });
        continue;
      }
      k = 'square';
    }
    const rows = makeWindow(k, C);
    const ww = rows[0].length;
    const n = span >= ww * 2 + 8 ? 2 : span >= ww ? 1 : 0;
    const y = k === 'tall' ? Math.max(P.yT + 2, door.y0) : Math.max(P.yT + 3, door.y0 + 1);
    for (let i = 0; i < n; i += 1) {
      const x = Math.round(a + ((span - n * ww) * (i + 1)) / (n + 1) + i * ww);
      blit(out, rows, x, y);
      if (flowerBoxes && k !== 'round') blit(out, FLOWER_BOX.map((row) => row.slice(0, ww)), x, y + rows.length - 1);
      boxes.push({ x, y, w: ww, h: rows.length, kind: k });
    }
  }
  return boxes;
}

const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Upper-floor windows on tall walls, clear of the sign. Falls back to smaller windows to fit.
function placeUpperWindows(out, P, style, C, ceiling, avoid) {
  if (style.windows === 'none' || P.wallH < 34) return [];
  const kinds = style.windows === 'shopfront' ? ['square', 'round'] : [style.windows, 'square', 'round'];
  const xs = P.bw >= 60 ? [P.x0 + Math.round(P.bw * 0.25), P.x1 - Math.round(P.bw * 0.25)] : [P.cx];
  for (const kind of kinds) {
    const rows = makeWindow(kind, C);
    const ww = rows[0].length;
    const wh = rows.length;
    const y = P.yT + 3;
    const boxes = xs.map((cx) => ({ x: cx - Math.floor(ww / 2), y, w: ww, h: wh, kind, upper: true }));
    const fits = boxes.every((box) => box.y + box.h <= ceiling && !overlaps({ ...box, x: box.x - 1, w: box.w + 2, h: box.h + 1 }, avoid));
    if (!fits) continue;
    for (const box of boxes) blit(out, rows, box.x, box.y);
    return boxes;
  }
  return [];
}

function shadeUnderRoof(out, body, roof, R) {
  for (let x = 0; x < out.w; x += 1) {
    let y = null;
    for (let yy = out.h - 1; yy >= 0; yy -= 1) if (at(roof.L, x, yy) !== '.') { y = yy; break; }
    if (y === null) continue;
    const k = at(body, x, y + 1);
    if (k !== '.' && k !== 'o' && at(out, x, y + 1) === k) put(out, x, y + 1, R.lo === k ? R.deep : R.lo);
  }
}

// A little bell cupola for halls, standing on the ridge.
function makeCupola(C) {
  const Wr = RAMPS[C.wall];
  const R = RAMPS[C.roof];
  return paintTpl(tpl(`
    ....oo....
    ...oaAo...
    ..oaaAAo..
    .oaaaAAAo.
    oooooooooo
    .oWWWWWWo.
    .oWoooowo.
    .oWoUUowo.
    .oWoUUowo.
    .oWWWWWwo.
    .oooooooo.
  `), { a: R.base, A: R.lo, W: Wr.base, w: Wr.lo, U: 'U' });
}

// A telescope tube leaning out toward the sky, for observatories.
const TELESCOPE_TUBE = tpl(`
  ......ooo
  .....oeeo
  ....oeEo.
  ...oeEo..
  ..oUEo...
  .oeEo....
  oeEo.....
  ooo......
`);

// A little domed turret with a slit and a telescope, for observatories under any other roof.
function makeTurret(C) {
  const R = RAMPS[C.roof];
  const Wr = RAMPS[C.wall];
  const T = RAMPS[C.trim];
  const L = layer(16, 15);
  for (let y = 10; y <= 14; y += 1) for (let x = 2; x <= 13; x += 1) put(L, x, y, y === 10 ? T.hi : y === 11 ? T.base : x >= 12 ? Wr.lo : Wr.base);
  for (let y = 2; y <= 10; y += 1) {
    for (let x = 2; x <= 13; x += 1) {
      const nx = (x + 0.5 - 8) / 6;
      const ny = (y + 0.5 - 10.5) / 8;
      if (nx * nx + ny * ny > 1 || y === 10) continue;
      const light = -0.55 * nx - 0.5 * ny + 0.62 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let k = light > 0.8 ? R.hi : light > 0.35 ? R.base : light > 0.02 ? R.lo : R.deep;
      if ((x === 8 || x === 9) && y >= 3) k = x === 8 ? 'o' : 'N';
      put(L, x, y, k);
    }
  }
  outline(L);
  blit(L, tpl(`
    ...ooo
    ..oeeo
    .oeEo.
    oUEo..
    ooo...
  `), 9, 0);
  return toRows(L);
}

function makeAtticWindow(C) {
  return makeWindow('round', C);
}

// The lean-to on a workshop's right side: a shed roof over an open bay with stacked timber.
function drawAnnex(out, P, C) {
  const R = RAMPS[C.roof];
  const Wr = RAMPS[C.wall];
  const L = layer(P.W, P.H);
  const ax0 = P.x1 - 1;
  const ax1 = Math.min(P.W - 2, P.x1 + P.annex);
  const top = P.yT + 7;
  for (let y = top; y <= P.yB; y += 1) {
    for (let x = ax0; x <= ax1; x += 1) {
      let k = y >= P.yB - 2 ? (y === P.yB - 1 ? 'S' : 's') : 'm';
      if (x === ax1 - 1 || x === ax1 - 2) k = y >= P.yB - 2 ? k : Wr.lo;
      put(L, x, y, k);
    }
  }
  for (let i = 0; i < 3; i += 1) {
    for (let x = ax0 + 2; x <= ax1 - 4; x += 1) {
      const y = P.yB - 4 - i * 2;
      put(L, x, y, i === 1 ? 'n' : 'b');
      put(L, x, y + 1, 'B');
    }
  }
  for (let y = P.yB - 9; y <= P.yB - 3; y += 1) put(L, ax0 + 3, y, 'B');
  outline(L);
  const S = layer(P.W, P.H);
  for (let x = ax0 - 1; x <= ax1 + 2; x += 1) {
    const drop = Math.round(((x - ax0) * 4) / Math.max(1, ax1 - ax0));
    for (let d = 0; d < 5; d += 1) put(S, x, top - 4 + drop + d, d === 3 ? R.lo : d === 4 ? R.deep : R.base);
  }
  outline(S);
  blit(out, L, 0, 0);
  blit(out, S, 0, 0);
}

function flagOn(roof, C, info, { x = roof.flagAt.x, y = roof.flagAt.y, dodgeSmoke = true } = {}) {
  if (!C.flag) return;
  const flag = makeFlag(C.flag);
  let fx = x;
  let fy = y;
  if (dodgeSmoke && info.smoke && Math.abs(info.smoke.x - fx) < 12) {
    fx = roof.ridge ? Math.round(roof.ridge[0]) : fx - 12;
    fy = roofTopAt(roof, fx);
  }
  info.flag = { frames: flag.frames, x: fx - flag.footX, y: fy - flag.h + 2 };
}

function drawHouse(bp, P, C) {
  const { style } = bp;
  const R = RAMPS[C.roof];
  const T = RAMPS[C.trim];
  const out = layer(P.W, P.H);
  const info = { smoke: null, flag: null };
  const roof = makeRoof(style, P, C);
  const greenhouse = style.shape === 'greenhouse';
  if (greenhouse && !['thatch', 'awning'].includes(style.roof)) glaze(roof, R);

  // Behind the body: the workshop lean-to and outside chimneys (domes and canopies have no
  // roof to carry a chimney, so it climbs the right wall instead).
  if (style.shape === 'workshop') drawAnnex(out, P, C);
  const outsideChimney = style.chimney && (style.roof === 'dome' || style.roof === 'awning') && style.shape !== 'workshop';
  if (outsideChimney) {
    const top = Math.max(1, P.yT - 9);
    blit(out, makeChimney(P.yB - top), P.x1 - 2, top);
    info.smoke = { x: P.x1 + 2, y: top };
  }

  const body = drawBody(P, style, C, { inGable: roof.inGable, glassUpper: greenhouse && style.walls !== 'glass' });
  blit(out, body, 0, 0);

  // Tall walls get a string course between floors.
  if (P.wallH >= 34 && style.walls !== 'glass') {
    const y = P.yT + Math.round(P.wallH * 0.42);
    for (let x = P.x0 - 1; x <= P.x1 + 1; x += 1) { put(out, x, y, 'o'); put(out, x, y + 1, T.hi); put(out, x, y + 2, T.lo); put(out, x, y + 3, 'o'); }
  }
  // Barns: corner boards in the trim colour.
  if (style.shape === 'barn' && style.walls !== 'glass') {
    for (let y = P.yT; y < P.yB - 2; y += 1) { put(out, P.x0 + 1, y, T.base); put(out, P.x0 + 2, y, T.lo); put(out, P.x1 - 2, y, T.base); put(out, P.x1 - 1, y, T.lo); }
  }

  // Door, centred on the gate side, on a stone step.
  const doorRows = makeDoor(style.door, C);
  const dw = doorRows[0].length;
  const dh = doorRows.length;
  const door = { x0: P.cx - Math.floor(dw / 2), y0: P.yB - 1 - dh, w: dw, h: dh };
  door.x1 = door.x0 + dw - 1;
  blit(out, doorRows, door.x0, door.y0);
  for (let x = door.x0; x <= door.x1; x += 1) put(out, x, P.yB - 1, x === door.x0 || x === door.x1 ? 'o' : 's');

  // Glass walls are windows already, so they get none cut into them.
  const glassy = style.walls === 'glass' || greenhouse;
  const ground = glassy ? [] : placeGroundWindows(out, P, style, C, door, { flowerBoxes: style.shape === 'cottage' });
  let awningTop = null;
  if (C.awning) {
    let ax0 = door.x0 - 4;
    let ax1 = door.x1 + 4;
    const fronts = ground.filter((w) => w.kind === 'shopfront');
    for (const w of fronts) { ax0 = Math.min(ax0, w.x - 2); ax1 = Math.max(ax1, w.x + w.w + 1); }
    ax0 = Math.max(ax0, P.x0 - 1);
    ax1 = Math.min(ax1, P.x1 + 1);
    const rows = makeAwning(ax1 - ax0 + 1, C.awning);
    awningTop = Math.min(door.y0, ...fronts.map((w) => w.y)) - rows.length + 1;
    blit(out, rows, ax0, awningTop);
  }

  // The roof over the walls, with a soft shadow line under its edge.
  blit(out, roof.L, 0, 0);
  shadeUnderRoof(out, body, roof, RAMPS[C.wall]);

  // Where the sign goes: in a front gable, on a shop's false front, else above the door.
  let signAt = null;
  if (roof.gable) {
    const g = roof.gable;
    let top = Math.max(g.top + 2, P.yT - 17);
    while (top < P.yT - 4 && g.halfAt(top + 2) < 8) top += 1;
    if (g.halfAt(top + 2) >= 7) signAt = { x: g.cx - 8, y: top };
    else if (g.halfAt(P.yT - 10) >= 5) blit(out, makeAtticWindow(C), g.cx - 4, P.yT - 11);
  }
  if (style.shape === 'shop' && ['shingle', 'hip', 'thatch'].includes(style.roof)) {
    const Wr = RAMPS[C.wall];
    const fw = Math.min(P.bw - 10, 40);
    const fx = P.cx - Math.floor(fw / 2);
    const fTop = Math.max(2, roof.top - 3);
    const F = layer(P.W, P.H);
    fillRect(F, fx, fTop, fw, P.yT - fTop, Wr.base);
    for (let x = fx; x < fx + fw; x += 1) { put(F, x, fTop + 1, T.hi); put(F, x, fTop + 2, T.base); put(F, x, fTop + 3, T.lo); }
    for (let y = fTop + 4; y < P.yT; y += 1) put(F, fx + fw - 2, y, Wr.lo);
    outline(F);
    blit(out, F, 0, 0);
    signAt = { x: P.cx - 8, y: fTop + 4 };
  }
  if (!signAt) signAt = { x: P.cx - 8, y: Math.max(1, (awningTop ?? door.y0) - 16) };
  const signBox = { x: signAt.x, y: signAt.y, w: 16, h: 16 };
  if (!glassy) placeUpperWindows(out, P, style, C, (awningTop ?? door.y0) - 2, signBox);

  // Halls get a bell cupola on the ridge (or on the deck of a flat roof).
  let cupolaTop = null;
  if (style.shape === 'hall' && style.roof !== 'dome') {
    const rows = makeCupola(C);
    const foot = style.roof === 'flat' ? roof.top + 4 : roofTopAt(roof, P.cx) + 4;
    const y = Math.max(0, foot - rows.length);
    blit(out, rows, P.cx - 5, y);
    cupolaTop = y;
  }
  // Observatories: a telescope leaning out of the dome's slit, or out of the roof.
  if (style.shape === 'observatory') {
    if (roof.dome) blit(out, TELESCOPE_TUBE, Math.round(roof.dome.cx) + 1, Math.max(0, Math.round(roof.dome.base - roof.dome.ry * 0.45) - 7));
    else {
      const rows = makeTurret(C);
      const foot = roof.flat ? roof.top + 5 : roofTopAt(roof, P.cx) + 5;
      const y = Math.max(0, foot - rows.length);
      blit(out, rows, P.cx - 8, y);
      cupolaTop = y + 2;
    }
  }

  // Chimney on the roof's right side (a stovepipe on workshops).
  if (style.chimney && !outsideChimney) {
    const x = P.x1 - Math.round(P.bw * 0.2) - 4;
    const surface = style.roof === 'flat' ? roof.top + 2 : roofTopAt(roof, x + 3);
    const top = Math.max(1, (roof.flat ? roof.top : surface) - 6);
    const height = Math.max(6, surface + 4 - top);
    const rows = style.shape === 'workshop' ? makeStovepipe(height) : makeChimney(height);
    blit(out, rows, x, top);
    info.smoke = { x: x + Math.floor(rows[0].length / 2), y: top };
  }

  blit(out, makeSign(bp.emblem, C), signAt.x, signAt.y);
  if (cupolaTop !== null) flagOn(roof, C, info, { x: P.cx, y: cupolaTop, dodgeSmoke: false });
  else if (style.shape === 'observatory' && roof.dome) flagOn(roof, C, info, { x: Math.round(roof.dome.cx - roof.dome.rx * 0.45), y: roofTopAt(roof, Math.round(roof.dome.cx - roof.dome.rx * 0.45)) });
  else flagOn(roof, C, info);
  return { out, door: { x: P.cx, y: P.yB }, info };
}

// Windmill: a tapering tower, a cap in the roof style, four lattice sails.
function drawMill(bp, P, C) {
  const { style } = bp;
  const out = layer(P.W, P.H);
  const info = { smoke: null, flag: null };
  const taper = Math.min(6, Math.floor(P.bw / 6));
  const R = RAMPS[C.wall];
  const mortar = RAMPS[C.wall].family === 'cream' ? R.lo : 'C';
  const body = layer(P.W, P.H);
  for (let y = P.yT - 1; y <= P.yB; y += 1) {
    const inset = Math.round(((P.yB - y) * taper) / P.wallH);
    for (let x = P.x0 + inset; x <= P.x1 - inset; x += 1) {
      const rx = x - P.x0 - 1;
      const ry = y - P.yT;
      let k = style.walls === 'glass' ? (mod(rx, 6) === 0 || mod(ry, 6) === 0 ? glassFrame(R) : mod(rx - ry, 7) === 2 ? 'f' : 'w') : wallKeyOf(style.walls, R, rx, ry, x, y, mortar);
      if (x >= P.x1 - inset - 1 && (k === R.base || k === R.hi)) k = R.lo;
      put(body, x, y, k);
    }
  }
  for (let x = P.x0; x <= P.x1; x += 1) { put(body, x, P.yB - 2, mod(x, 6) === 5 ? 'S' : 's'); put(body, x, P.yB - 1, 'S'); }
  outline(body);
  blit(out, body, 0, 0);
  const capP = { ...P, x0: P.x0 + taper - 1, x1: P.x1 - taper + 1, bw: P.bw - 2 * taper + 2 };
  const roof = makeRoof({ ...style, shape: 'mill' }, capP, C);
  const doorRows = makeDoor(style.door === 'sliding' || style.door === 'double' ? 'arched' : style.door, C);
  const dw = doorRows[0].length;
  const doorTop = P.yB - 1 - doorRows.length;
  blit(out, doorRows, P.cx - Math.floor(dw / 2), doorTop);
  blit(out, roof.L, 0, 0);
  shadeUnderRoof(out, body, roof, R);
  // The sign hangs above the door; a window fits between it and the sails' hub if there's room.
  const hub = { x: P.cx, y: P.yT + 1 };
  const signY = doorTop - 2;
  if (style.windows !== 'none') {
    const rows = makeWindow(style.windows === 'tall' || style.windows === 'shopfront' ? 'round' : style.windows, C);
    const y = hub.y + 4;
    if (y + rows.length <= signY - 1) blit(out, rows, P.cx - Math.floor(rows[0].length / 2), y);
  }
  if (style.chimney) {
    const x = capP.x1 - 6;
    const top = Math.max(1, roofTopAt(roof, x + 2) - 5);
    blit(out, makeStovepipe(roofTopAt(roof, x + 2) + 3 - top), x, top);
    info.smoke = { x: x + 3, y: top };
  }
  // Sails: cloth on a wooden lattice, turned into an X so the door and sign stay clear.
  const reach = Math.max(12, Math.min(Math.floor(P.W / 2) - 3, Math.floor((hub.y - 3) / 0.74), 28));
  const S = layer(P.W, P.H);
  for (let y = hub.y - reach - 2; y <= hub.y + reach + 2; y += 1) {
    for (let x = hub.x - reach - 2; x <= hub.x + reach + 2; x += 1) {
      for (const angle of [-3, -1, 1, 3]) {
        const th = (angle * Math.PI) / 4;
        const dx = Math.cos(th);
        const dy = Math.sin(th);
        const px = x - hub.x;
        const py = y - hub.y;
        const a = px * dx + py * dy;
        const p = -px * dy + py * dx;
        if (a < 1 || a > reach) continue;
        if (Math.abs(p) <= 0.6) put(S, x, y, 'B');
        else if (p > 0.6 && p <= 5 && a >= 5) put(S, x, y, mod(Math.round(a), 4) === 0 || (p > 2.6 && p < 3.4) ? 'b' : 'c');
      }
    }
  }
  outline(S);
  blit(out, S, 0, 0);
  const sx = Math.max(1, P.x0 - 10);
  const armY = doorTop - 2;
  for (let x = sx + 3; x <= P.x0 + 3; x += 1) { put(out, x, armY - 1, 'o'); put(out, x, armY, 'B'); put(out, x, armY + 1, 'o'); }
  for (const cx of [sx + 3, sx + 12]) put(out, cx, armY + 2, 'o');
  blit(out, makeSign(bp.emblem, C), sx, armY + 3);
  blit(out, paintTpl(tpl(`
    .ooo.
    oBbBo
    obuBo
    oBBBo
    .ooo.
  `), {}), hub.x - 2, hub.y - 2);
  // the flag flies from the middle of the cap, between the upper sails
  flagOn(roof, C, info, { x: P.cx, y: roofTopAt(roof, P.cx), dodgeSmoke: false });
  return { out, door: { x: P.cx, y: P.yB }, info };
}

// Pavilion: a deck on a plinth, posts and a low rail, a roof overhead and an open front. The
// deck darkens toward the back, under the roof, so it reads as open.
function drawPavilion(bp, P, C) {
  const { style } = bp;
  const out = layer(P.W, P.H);
  const info = { smoke: null, flag: null };
  const Wr = RAMPS[C.wall];
  const T = RAMPS[C.trim];
  const deck = RAMPS[Wr.family === 'wood' || Wr.family === 'cream' ? C.wall : 'wood'];
  const roof = makeRoof(style, P, C);
  const base = layer(P.W, P.H);
  const plinthTop = P.yB - 4;
  const depth = plinthTop - P.yT;
  for (let y = P.yT - 1; y <= P.yB; y += 1) {
    for (let x = P.x0; x <= P.x1; x += 1) {
      let k;
      if (y < plinthTop) {
        const t = (y - P.yT) / depth;
        const seam = mod(plinthTop - y, 3) === 0;
        if (t < 0.4) k = seam ? 'm' : deck.deep;
        else if (t < 0.7) k = seam ? deck.deep : deck.lo;
        else k = seam ? deck.lo : mod(plinthTop - y, 3) === 1 ? deck.base : deck.hi;
      } else {
        k = style.walls === 'glass' ? Wr.base : wallKeyOf(style.walls === 'log' ? 'plank' : style.walls, Wr, x - P.x0 - 1, y - plinthTop + 1, x, y, 'C');
      }
      put(base, x, y, k);
    }
  }
  outline(base);
  blit(out, base, 0, 0);
  // the far rail, in the shade under the roof
  for (let x = P.x0 + 1; x < P.x1; x += 1) { put(out, x, P.yT + 3, T.lo); put(out, x, P.yT + 4, 'o'); if (mod(x, 4) === 0) put(out, x, P.yT + 5, T.lo); }
  const posts = [P.x0 + 1, P.x1 - 3];
  const inner = Math.round(P.bw / 4);
  if (P.bw >= 56) posts.push(P.cx - inner - 1, P.cx + inner - 1);
  const railTop = plinthTop - 7;
  for (let x = P.x0 + 1; x < P.x1; x += 1) {
    if (Math.abs(x - P.cx + 0.5) < 8) continue;
    if (style.walls === 'glass') {
      for (let y = P.yT + 4; y < plinthTop; y += 1) put(out, x, y, mod(x - y, 7) === 2 ? 'f' : y < P.yT + 8 ? 'W' : 'w');
    } else {
      put(out, x, railTop, T.base); put(out, x, railTop + 1, 'o');
      if (mod(x, 3) === 0) for (let y = railTop + 2; y < plinthTop; y += 1) put(out, x, y, T.lo);
    }
  }
  for (const px of posts) {
    for (let y = P.yT - 1; y < plinthTop; y += 1) { put(out, px - 1, y, 'o'); put(out, px, y, T.hi); put(out, px + 1, y, T.base); put(out, px + 2, y, 'o'); }
  }
  for (let x = P.cx - 6; x <= P.cx + 5; x += 1) {
    const edge = x === P.cx - 6 || x === P.cx + 5;
    put(out, x, P.yB - 3, edge ? 'o' : deck.hi);
    put(out, x, P.yB - 2, edge ? 'o' : deck.base);
    put(out, x, P.yB - 1, edge ? 'o' : deck.lo);
  }
  if (C.awning) blit(out, makeAwning(P.bw - 2, C.awning).slice(1), P.x0 + 1, P.yT - 1);
  blit(out, roof.L, 0, 0);
  // a sign hanging in the opening
  const sy = P.yT + 2;
  for (let y = P.yT; y < sy; y += 1) { put(out, P.cx - 6, y, 'o'); put(out, P.cx + 5, y, 'o'); }
  blit(out, makeSign(bp.emblem, C), P.cx - 8, sy);
  if (style.chimney) {
    // an open pavilion keeps a brazier, so its chimney is a slim stovepipe
    const x = P.x1 - Math.round(P.bw * 0.2) - 4;
    const top = Math.max(1, roofTopAt(roof, x + 2) - 5);
    blit(out, makeStovepipe(roofTopAt(roof, x + 2) + 3 - top), x, top);
    info.smoke = { x: x + 3, y: top };
  }
  flagOn(roof, C, info);
  return { out, door: { x: P.cx, y: P.yB }, info };
}

// ---------- props ----------
// Small hand-drawn sprites in the camp's style (ink outlines, light from the upper left).

const SMALL_CRATE = tpl(`
  ooooooooo
  onnnnnnno
  onbbbbbno
  ooooooooo
  onbBbBbno
  onBbBbBno
  ooooooooo
`);
const SMALL_BARREL = tpl(`
  .oooooo.
  obnnnnbo
  onbbbbno
  oSSSSSSo
  obbbbbBo
  obBbbbBo
  oSSSSSSo
  obbbbbBo
  .oooooo.
`);

export const PROPS = {
  easel: SPRITES.easel[0],
  anvil: tpl(`
    ooooooooooo...
    occcsssssSSooo
    .ossssssssSSSo
    ..ooSSSSSSooo.
    ....oSSSSo....
    ..oooooooooo..
    ..onnnnnnnno..
    ..obBbbbbBbo..
    ..obbBbbBbbo..
    ..oooooooooo..
  `),
  crates: (() => {
    let rows = Array.from({ length: 17 }, () => '.'.repeat(14));
    rows = stampRows(rows, SPRITES.crate[0], 0, 6);
    return stampRows(rows, SMALL_CRATE, 1, 0);
  })(),
  barrels: (() => {
    let rows = Array.from({ length: 10 }, () => '.'.repeat(15));
    rows = stampRows(rows, SMALL_BARREL, 7, 0);
    return stampRows(rows, SMALL_BARREL, 0, 1);
  })(),
  bookcart: tpl(`
    ...oo.oo.oo.....
    ..orroeeouuo....
    ..orroeeouuoo...
    ..orroeeouuoko..
    ..orroeeouuoko..
    .oooooooooooooo.
    .onnnnnnnnnnnnbo
    .obbbbbbbbbbbbBo
    .oBBBBBBBBBBBBBo
    .oooooooooooooo.
    ..ooo......ooo..
    .obBbo....obBbo.
    ..ooo......ooo..
  `),
  telescope: tpl(`
    ..........ooo.
    .........oeeeo
    ........oeeEo.
    .......oeeEo..
    ......oUUEo...
    .....oeeEo....
    ....oeeEo.....
    ...ooeEo......
    ...ooooo......
    ....obo.......
    ...obobo......
    ...ob.obo.....
    ..ob..o.bo....
    ..ob..o..bo...
    .ob...o...bo..
    .oo...oo...oo.
  `),
  camera: tpl(`
    ...oooo.....
    ..oBBBBooooo
    .onnnnnnnnbo
    .oBBBBBBBBBo
    .oBooooBBuBo
    .oBoeeoBBBBo
    .oBoefoBBBBo
    .oBooooBBBBo
    .oBBBBBBBBBo
    ..ooooooooo.
    .....oo.....
    ....obbo....
    ...ob..bo...
    ..ob....bo..
    .ob......bo.
    .oo......oo.
  `),
  filmreel: tpl(`
    ....ooooo....
    ..ooSSSSSoo..
    .oSSsssssSSo.
    .oSszzSzzsSo.
    oSszzzSzzzsSo
    oSsszSSSzssSo
    oSsSSSoSSSsSo
    oSsszSSSzssSo
    oSszzzSzzzsSo
    .oSszzSzzsSo.
    .oSSsssssSSo.
    ..ooSSSSSoo..
    ....oSSSo....
    ...oBBBBBo...
    ..ooooooooo..
  `),
  musicstand: tpl(`
    .oooooooo.
    occcccccCo
    ocoocoocCo
    occcccccCo
    ococcoccCo
    occcccccCo
    .oooooooo.
    ....oSo...
    ....oSo...
    ....oSo...
    ....oSo...
    ....oSo...
    ....oSo...
    ...oSSSo..
    ..oSo.oSo.
    ..oo...oo.
  `),
  gardenbed: tpl(`
    ..q.q....q.q.k..
    ...l...u..l.kLk.
    oooooooooooooooo
    onnnnnnnnnnnnnbo
    obmmBmmmmmBmmmBo
    obmmmmmBmmmmmmBo
    oBBBBBBBBBBBBBBo
    oooooooooooooooo
  `),
  lantern: SPRITES.lantern[0],
  bench: tpl(`
    .oooooooooooooo.
    onnnnnnnnnnnnnbo
    obbbbbbbbbbbbbBo
    oooooooooooooooo
    onnnnnnnnnnnnnbo
    oBBBBBBBBBBBBBBo
    oooooooooooooooo
    .oBo........oBo.
    .ooo........ooo.
  `),
  mailbox: tpl(`
    ..oooooo....
    .oeeeeeeo.oo
    oeeeeeeeEoro
    oeoooooeEoro
    oeeeeeeeEooo
    oEEEEEEEEoo.
    oooooooooo..
    ...onbo.....
    ...onbo.....
    ...onbo.....
    ...onbo.....
    ...onbo.....
    ...onbo.....
    ..oooooo....
  `),
  pottedplant: tpl(`
    ...oooo...
    .ooqqlloo.
    oqqqllllLo
    oqlllLlLLo
    olLllLLLLo
    .oLLLLLLo.
    ..oooooo..
    ..orrrRo..
    .orrrrrRo.
    .orrrrRRo.
    ..orrRRo..
    ..oooooo..
  `),
  well: tpl(`
    ...oooooooooo...
    ..orrrrrrrrRRo..
    .orrrrrrrrrrRRo.
    orrrrrrrrrrrrRRo
    oRRRRRRRRRRRRRRo
    oooooooooooooooo
    .onbo......onbo.
    .onbooooooooonbo
    .onbo..oo..onbo.
    .onbo.oBBo.onbo.
    .onbo.oBBo.onbo.
    .onbo.oooo.onbo.
    oooooooooooooooo
    osWWWWWWWWWWWWSo
    osssSssssSsssSSo
    oSsssssSssssSSSo
    oSSSSSSSSSSSSSSo
    .oooooooooooooo.
  `),
  handcart: tpl(`
    .....oooo.......
    ....occcCo......
    ...occcccCo.....
    .oooooooooooo...
    .onnnnnnnnnnbo..
    .obbbbbbbbbbBooo
    ..oBBBBBBBBBoonb
    ...ooooooooo.ooo
    ....ooo.........
    ...oBbBo........
    ...obBbo........
    ....ooo.........
  `),
  dicetable: tpl(`
    ..oooo...oooo.
    ..okko...oUuo.
    ..oKko...oUUo.
    ..oooo...oooo.
    .oooooooooooo.
    onnnnnnnnnnnbo
    obbbbbbbbbbbBo
    .oBBBBBBBBBBo.
    ..oooooooooo..
    .....obbo.....
    .....oBBo.....
    ....oooooo....
  `),
  chalkboard: tpl(`
    .oooooooooo.
    obbbbbbbbbBo
    obMMMMMMMMBo
    obMcMMccMMBo
    obMMccMMcMBo
    obMcMcMMMMBo
    obMMMMccMMBo
    obMMMMMMMMBo
    obbbbbbbbbBo
    .oooooooooo.
    ..ob....bo..
    ..ob....bo..
    .ob......bo.
    .ob......bo.
    .oo......oo.
  `),
  antenna: tpl(`
    ....ooo....
    ....oro....
    ....ooo....
    .....o.....
    ..ooooooo..
    ..oSsssSo..
    ..ooooooo..
    ....oSo....
    ....oSo....
    ...oS.So...
    ...oSSSo...
    ...oS.So...
    ..oS...So..
    ..oSSSSSo..
    ..oS...So..
    .oS.....So.
    .oSSSSSSSo.
    .oo.....oo.
  `),
  beehive: tpl(`
    ......oooo...
    ....oouuuUoo.
    ...ouuuuuUUo.
    ...oUUUUUUUo.
    ..ouuuuuuuUUo
    ..oUUUUUUUUUo
    ..ouuuuooouUo
    ..oUUUUooUUUo
    ..ooooooooooo
    ...onnnnnnbo.
    ...obBBBBBBo.
    ...ob....bo..
    ...oo....oo..
  `),
  workbench: tpl(`
    .........oo.....
    .ooooooo.oSo....
    .onnnnnbooSo....
    oooooooooooooooo
    onnnnnnnnnnnnnbo
    obbbbbbbbbbbbbBo
    oooooooooooooooo
    .oBo........oBo.
    .oBo..oooo..oBo.
    .oBo..osSo..oBo.
    .oBo..oooo..oBo.
    .ooo........ooo.
  `),
  scrollrack: tpl(`
    oooooooooooooo
    onnnnnnnnnnnbo
    obmccmccmccmBo
    obmCcmCcmCcmBo
    obnnnnnnnnnnBo
    obmccmccmukmBo
    obmCcmCcmUkmBo
    obnnnnnnnnnnBo
    obmccmmmmccmBo
    obmCcmmmmCcmBo
    obbbbbbbbbbbBo
    oooooooooooooo
    .oBo......oBo.
    .ooo......ooo.
  `),
  trophy: tpl(`
    ..oooooooo..
    oooucuuuUooo
    ououcuuUUoUo
    oooouuuUUooo
    ...ouuuUo...
    ....ouUo....
    ....oUUo....
    ...oooooo...
    ..onnnnnbo..
    ..obBBBBBo..
    ..oooooooo..
  `),
  kiln: tpl(`
    .....oooo.....
    ...oorrrRoo...
    ..orrrrrrRRo..
    .orrRrrRrrRRo.
    .orrrrrrrrrRo.
    orrRrrRrrRrRRo
    orrrroooorrRRo
    orRrouuUorRrRo
    orrrouUUorrRRo
    oRRRoUUYoRRRRo
    oooooooooooooo
  `),
  fishingrack: tpl(`
    oooooooooooooooo
    onnnnnnnnnnnnnbo
    oooooooooooooooo
    obo..o..o..o.obo
    obo.oeoosooeoobo
    obo.oeoosooeoobo
    obo.oEooSooEoobo
    obo..o..o..o.obo
    obo.o.oo.oo.oobo
    obo..........obo
    obo..........obo
    obo..........obo
    ooo..........ooo
  `),
  birdhouse: tpl(`
    ...ooo...
    ..orrRo..
    .orrrRRo.
    orrrrRRRo
    ooooooooo
    .onnnnbo.
    .onoonbo.
    .onoonbo.
    .onnnnbo.
    .ooooooo.
    ...obo...
    ...obo...
    ...obo...
    ...obo...
    ...obo...
    ..ooooo..
  `),
  fountain: tpl(`
    .......ff.......
    ......fwwf......
    .......ww.......
    ......oSSo......
    .....osssSo.....
    .oooooosSoooooo.
    osssssssssssssSo
    oswwwwwwwwwwwwSo
    oswwfwwwwwfwwwSo
    oSSSSSSSSSSSSSSo
    .oSSSSSSSSSSSSo.
    ..oooooooooooo..
  `),
  signboard: tpl(`
    .oooooooooo.
    onnnnnnnnnbo
    onoooooonnbo
    onnnnnnnnnbo
    onooooonnnbo
    onnnnnnnnnbo
    obbbbbbbbbBo
    .oooooooooo.
    ....onbo....
    ....onbo....
    ....onbo....
    ....onbo....
    ....onbo....
    ...oooooo...
  `),
};

function stampRows(rows, patch, x, y) {
  const L = fromRows(rows);
  blit(L, patch, x, y);
  return toRows(L);
}

// ---------- yards and paths ----------

// The walk from the door to the gate, as axis-aligned points.
function pathPoints(P, door) {
  const { W, H, gate } = P;
  const dx = door.x;
  const dy = door.y;
  if (gate.side === 'bottom') {
    if (Math.abs(gate.at - dx) <= 1) return [[dx, dy], [dx, H - 1]];
    const mid = Math.min(H - 5, dy + 5);
    return [[dx, dy], [dx, mid], [gate.at, mid], [gate.at, H - 1]];
  }
  const edgeX = gate.side === 'right' ? W - 1 : 0;
  const gy = gate.at;
  if (gy >= dy + 3) return [[dx, dy], [dx, gy], [edgeX, gy]];
  const walk = Math.min(H - 5, dy + 5);
  const laneX = gate.side === 'right' ? W - 7 : 6;
  return [[dx, dy], [dx, walk], [laneX, walk], [laneX, gy], [edgeX, gy]];
}

function pathMask(W, H, points, width) {
  const mask = new Uint8Array(W * H);
  const lo = Math.floor(width / 2);
  const hi = width - lo - 1;
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1; };
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    for (let y = Math.min(ay, by) - lo; y <= Math.max(ay, by) + hi; y += 1) {
      for (let x = Math.min(ax, bx) - lo; x <= Math.max(ax, bx) + hi; x += 1) mark(x, y);
    }
  }
  // round the outer corners a touch
  const out = mask.slice();
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!mask[y * W + x]) continue;
      const open = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && !mask[yy * W + xx];
      if ((open(x - 1, y) && open(x, y - 1)) || (open(x + 1, y) && open(x, y - 1)) || (open(x - 1, y) && open(x, y + 1) && y < H - 1) || (open(x + 1, y) && open(x, y + 1) && y < H - 1)) out[y * W + x] = 0;
    }
  }
  return out;
}

const FLOWER_SPRITES = ['flower.pink', 'flower.butter', 'flower.lavender', 'flower.cream'].map((name) => SPRITES[name][0]);

function paintPath(ground, mask, style) {
  const { w: W, h: H } = ground;
  const inMask = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!inMask(x, y)) continue;
      const edge = !inMask(x - 1, y) || !inMask(x + 1, y) || !inMask(x, y - 1) || (!inMask(x, y + 1) && y < H - 1);
      if (style === 'stone') {
        const r = mod(y, 4);
        const joint = r === 3 || mod(x + (mod(Math.floor(y / 4), 2) ? 3 : 0), 6) === 5;
        put(ground, x, y, edge ? 'S' : joint ? 'S' : r === 0 && mod(x, 6) === 0 ? 'c' : 's');
      } else {
        put(ground, x, y, edge ? 'P' : hash(x, y, 57) < 0.05 ? 'P' : 'p');
      }
    }
  }
}

function roundedRect(L, x0, y0, x1, y1, keyAt) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const cornerX = Math.min(x - x0, x1 - x);
      const cornerY = Math.min(y - y0, y1 - y);
      if (cornerX + cornerY < 2) continue;
      const edge = cornerX === 0 || cornerY === 0 || cornerX + cornerY === 2;
      put(L, x, y, keyAt(x, y, edge));
    }
  }
}

// Yard art on the ground layer. `taken` marks pixels props stand on, so beds keep clear of them.
function paintYard(ground, yard, P, mask, points, taken) {
  const { W, H } = P;
  const free = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) {
      if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1 || mask[yy * W + xx] || taken[yy * W + xx]) return false;
    }
    return true;
  };
  if (yard === 'sand') {
    roundedRect(ground, 1, 1, W - 2, H - 1, (x, y, edge) => (edge ? 'P' : hash(x, y, 71) < 0.04 ? 'P' : 'p'));
    for (let i = 0; i < 6; i += 1) {
      const x = 4 + Math.floor(hash(i, W, 73) * (W - 12));
      const y = 3 + Math.floor(hash(i, H, 79) * (H - 8));
      if (free(x, y, 7, 3)) blit(ground, SPRITES.pebbles[0], x, y);
    }
    return;
  }
  if (yard === 'stone') {
    const court = new Uint8Array(W * H);
    for (let y = P.yB - 2; y < H; y += 1) for (let x = Math.max(1, P.x0 - 5); x <= Math.min(W - 2, P.x1 + 5); x += 1) court[y * W + x] = 1;
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) court[i] = 1;
    paintPath(ground, court, 'stone');
    return;
  }
  if (yard === 'grass') {
    // a narrow worn path, the same sand as the village roads it joins at the gate
    paintPath(ground, pathMask(W, H, points, 6), 'sand');
  } else {
    paintPath(ground, mask, 'sand');
  }
  if (yard === 'flowers') {
    // beds of flowers along the front wall, and a few clumps in the side yards
    const beds = [[P.x0 + 1, P.cx - Math.ceil(P.door.w / 2) - 4], [P.cx + Math.ceil(P.door.w / 2) + 3, P.x1 - 1]];
    for (const [a, b] of beds) {
      for (let x = a; x <= b; x += 1) {
        for (let y = P.yB + 1; y <= P.yB + 4; y += 1) {
          if (mask[y * W + x] || taken[y * W + x]) continue;
          const edge = x === a || x === b || y === P.yB + 4;
          const n = hash(x, y, 83);
          put(ground, x, y, edge ? 'L' : n < 0.18 ? 'k' : n < 0.3 ? 'u' : n < 0.4 ? 'v' : n < 0.46 ? 'c' : n < 0.75 ? 'l' : 'q');
        }
      }
    }
    for (let i = 0; i < 10; i += 1) {
      const x = 2 + Math.floor(hash(i, 3, 89) * (W - 10));
      const y = 2 + Math.floor(hash(i, 5, 97) * (H - 8));
      if (free(x, y, 7, 6) && (x + 7 < P.x0 - 3 || x > P.x1 + 3 || y > P.yB + 5)) blit(ground, FLOWER_SPRITES[i % 4], x, y);
    }
  }
  if (yard === 'garden') {
    // raised vegetable beds in the side yards
    for (const side of ['left', 'right']) {
      const room = side === 'left' ? P.x0 - 7 : W - P.x1 - 8;
      if (room < 12) continue;
      const w = Math.min(room, 24);
      const x = side === 'left' ? P.x0 - 5 - w : P.x1 + 6;
      for (const y of [P.yB - 24, P.yB - 11]) {
        if (y < 2 || !free(x, y, w, 10)) continue;
        blit(ground, makeBed(w, 10, x + y), x, y);
      }
    }
  }
  if (yard === 'grass' || yard === 'path') {
    for (let i = 0; i < 14; i += 1) {
      const x = 2 + Math.floor(hash(i, 7, 107) * (W - 8));
      const y = 2 + Math.floor(hash(i, 9, 109) * (H - 6));
      const name = i % 5 === 0 ? 'clover' : i % 2 ? 'tuft.light' : 'tuft';
      const rows = SPRITES[name][0];
      if (free(x, y, rows[0].length, rows.length)) blit(ground, rows, x, y);
    }
  }
}

// A raised bed: wooden frame, dark soil, rows of sprouts and the odd pumpkin.
function makeBed(w, h, seed = 0) {
  const L = layer(w, h);
  fillRect(L, 0, 0, w, h, 'o');
  fillRect(L, 1, 1, w - 2, h - 2, 'b');
  for (let x = 1; x < w - 1; x += 1) put(L, x, 1, 'n');
  for (let y = 2; y < h - 2; y += 1) for (let x = 2; x < w - 2; x += 1) put(L, x, y, hash(x, y, 151 + seed) < 0.1 ? 'B' : 'm');
  for (let x = 1; x < w - 1; x += 1) put(L, x, h - 2, 'B');
  const sprout = ['q.q', '.l.'];
  const pumpkin = ['.l.', 'UuU', 'UUU'];
  for (let x = 3, i = 0; x + 3 < w - 1; x += 5, i += 1) {
    const big = hash(i, seed, 157) < 0.25;
    blit(L, big ? pumpkin : sprout, x, big ? h - 6 : 2);
    if (!big && h >= 9) blit(L, sprout, x + 2 < w - 4 ? x + 2 : x, 5);
  }
  return toRows(L);
}

// Soft ellipse shadow on the ground, in the translucent shadow key.
function shadow(ground, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1 || !inb(ground, x, y)) continue;
      const k = ground.px[y][x];
      ground.px[y][x] = k === '.' ? 'x' : SHADOW_ON[k] || k;
    }
  }
}

// ---------- props on the plot ----------

function placeProps(bp, P, sprite, mask, doorBox) {
  const { W, H } = P;
  const occ = new Uint8Array(W * H); // 1 building, 2 path or door, 3 prop
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (sprite.px[y][x] !== '.') for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && !occ[yy * W + xx]) occ[yy * W + xx] = 1;
      }
      if (mask[y * W + x]) occ[y * W + x] = 2;
    }
  }
  for (let y = doorBox.y; y < H; y += 1) for (let x = doorBox.x - 2; x < doorBox.x + doorBox.w + 2; x += 1) if (x >= 0 && x < W) occ[y * W + x] = 2;
  const placed = [];
  const taken = new Uint8Array(W * H);
  const pathXs = [];
  for (let x = 0; x < W; x += 1) if (mask[(H - 2) * W + x]) pathXs.push(x);
  const pathL = pathXs.length ? Math.min(...pathXs) : P.cx - 4;
  const pathR = pathXs.length ? Math.max(...pathXs) : P.cx + 3;
  const spots = (side, pw) => {
    const list = [];
    if (side === 'left' || side === 'right') {
      // Beside the wall first, then tucked in further back by the same wall, and only then further
      // out: props stay grouped around the building instead of trailing off across a long plot.
      for (let k = 0; k < 5; k += 1) {
        for (const bottom of [P.yB + 1, P.yB - 15]) {
          const x = side === 'left' ? P.x0 - 4 - Math.ceil(pw / 2) - k * (pw + 3) : P.x1 + 4 + Math.floor(pw / 2) + k * (pw + 3);
          list.push({ x, bottom, front: false });
        }
      }
    } else {
      for (let k = 0; k < 6; k += 1) {
        list.push({ x: pathL - 4 - Math.ceil(pw / 2) - k * (pw + 3), bottom: H - 2, front: true });
        list.push({ x: pathR + 4 + Math.floor(pw / 2) + k * (pw + 3), bottom: H - 2, front: true });
      }
    }
    return list;
  };
  const order = { left: ['left', 'front', 'right'], right: ['right', 'front', 'left'], front: ['front', 'left', 'right'] };
  for (const prop of bp.props) {
    const rows = PROPS[prop.kind];
    const pw = rows[0].length;
    const ph = rows.length;
    let done = false;
    for (const side of order[prop.side]) {
      for (const spot of spots(side, pw)) {
        const x = spot.x - Math.floor(pw / 2);
        const y = spot.bottom - ph + 1;
        if (x < 1 || y < 0 || x + pw > W - 1 || spot.bottom > H - 1) continue;
        let clear = true;
        for (let dy = 0; dy < ph && clear; dy += 1) {
          for (let dx = 0; dx < pw && clear; dx += 1) {
            if (rows[dy][dx] === '.') continue;
            const o = occ[(y + dy) * W + x + dx];
            if (o === 2 || o === 3 || (o === 1 && !(spot.front && y + dy > P.yB - 4))) clear = false;
          }
        }
        if (!clear) continue;
        placed.push({ kind: prop.kind, rows, x, y, bottom: spot.bottom });
        for (let dy = -1; dy <= ph; dy += 1) for (let dx = -2; dx <= pw + 1; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) { occ[yy * W + xx] = 3; taken[yy * W + xx] = 1; }
        }
        done = true;
        break;
      }
      if (done) break;
    }
  }
  return { placed, taken };
}

// ---------- public drawing ----------

function plotCanvas(options) {
  const w = clamp(Math.floor(Number(options && options.w)) || 7, 3, 24);
  const h = clamp(Math.floor(Number(options && options.h)) || 5, 3, 12);
  const W = w * TILE_PX;
  const H = h * TILE_PX;
  return { w, h, W, H, gate: gateOf(options, W, H) };
}

const SHADOW_ON = { g: 'G', j: 'G', h: 'G', G: 'L', p: 'P', P: 'b', s: 'S', S: 'z', c: 'C', C: 'P', n: 'b', b: 'B', m: 'm', l: 'L', q: 'l', L: 'M', k: 'K', u: 'U', v: 'V', B: 'm' };

function grassBackdrop(W, H) {
  const L = layer(W, H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const n = hash(Math.floor(x / 5), Math.floor(y / 4), 131);
    put(L, x, y, n > 0.82 ? 'j' : 'g');
  }
  return L;
}

// Everything flattened onto grass: the picture panels and galleries show.
function composite(W, H, ground, sprite) {
  const L = grassBackdrop(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const g = ground.px[y][x];
      if (g === 'x') L.px[y][x] = SHADOW_ON[L.px[y][x]] || 'G';
      else if (g !== '.') L.px[y][x] = g;
    }
  }
  blit(L, sprite, 0, 0);
  return toRows(L);
}

/**
 * Draws a built plot from a blueprint. Sized to `w` x `h` tiles (the plot's buildable area).
 * @returns {{ rows: string[], ground: string[], sprite: string[], frames: string[][],
 *   anchor: {x:number,y:number}, door: {x:number,y:number}, smoke: {x:number,y:number}|null,
 *   size: {w:number,h:number}, box: {x:number,y:number,w:number,h:number}|null,
 *   props: {kind:string,x:number,y:number,w:number,h:number}[] }}
 */
export function drawBuilding(blueprint, options = {}) {
  const bp = normalizeForKit(blueprint);
  const { W, H, gate } = plotCanvas(options);
  const C = resolveColours(bp.style);
  const P = planHouse(bp, W, H, gate);
  const shape = bp.style.shape;
  const built = shape === 'mill' ? drawMill(bp, P, C) : shape === 'pavilion' ? drawPavilion(bp, P, C) : drawHouse(bp, P, C);
  const sprite = built.out;
  // a flag stands on the roof before props are placed, so they keep clear of it
  const flag = built.info.flag;
  const bare = flag ? fromRows(toRows(sprite)) : null; // the building without its flag
  if (flag) blit(sprite, flag.frames[0], flag.x, flag.y);
  const points = pathPoints(P, built.door);
  const width = bp.yard === 'grass' ? 6 : 8;
  const mask = pathMask(W, H, [[built.door.x, built.door.y - 1], ...points], width);
  const doorBox = { x: built.door.x - Math.ceil(P.door.w / 2), y: P.yB - P.door.h - 2, w: P.door.w };
  const { placed, taken } = placeProps(bp, P, sprite, mask, doorBox);

  const ground = layer(W, H);
  paintYard(ground, bp.yard, P, mask, points, taken);
  shadow(ground, P.cx + 2, P.yB + 0.5, P.bw / 2 + 4, 3.5);
  for (const prop of placed) shadow(ground, prop.x + prop.rows[0].length / 2 + 1, prop.bottom + 0.5, prop.rows[0].length / 2 + 1, 2);

  placed.sort((a, b) => a.bottom - b.bottom);
  const withProps = (base) => {
    const L = fromRows(toRows(base));
    for (const prop of placed) blit(L, prop.rows, prop.x, prop.y);
    return L;
  };
  const frame0 = withProps(sprite);
  const frames = [toRows(frame0)];
  if (flag) {
    // the second frame: the same building with the pennant caught by the breeze
    blit(bare, flag.frames[1], flag.x, flag.y);
    frames.push(toRows(withProps(bare)));
  }
  const groundRows = toRows(ground);
  return {
    rows: composite(W, H, ground, frame0),
    ground: groundRows,
    sprite: frames[0],
    frames,
    anchor: { x: P.cx, y: P.yB },
    door: { x: built.door.x, y: built.door.y },
    smoke: built.info.smoke,
    size: { w: W, h: H },
    box: opaqueBox(frame0),
    props: placed.map((prop) => ({ kind: prop.kind, x: prop.x, y: prop.y, w: prop.rows[0].length, h: prop.rows.length })),
  };
}

/**
 * A building being redesigned: the one standing there, with a light scaffold put up round it (a
 * pole each side, a plank walkway along the eaves, a ladder), so it reads as being worked on, not
 * gone. Same result shape as drawBuilding.
 */
export function drawRedesign(blueprint, options = {}) {
  const built = drawBuilding(blueprint, options);
  const bp = normalizeForKit(blueprint);
  const { W, H, gate } = plotCanvas(options);
  const P = planHouse(bp, W, H, gate);
  const L = layer(W, H);
  const deckY = clamp(P.yT + 3, 4, P.yB - 12);
  const left = clamp(P.x0 - 5, 0, W - 12);
  const right = clamp(P.x1 + 2, left + 8, W - 4);
  post(L, left, deckY, P.yB);
  post(L, right, deckY, P.yB);
  beam(L, left, right + 3, deckY);
  for (let x = left + 1; x < right + 3; x += 1) put(L, x, deckY - 1, mod(x, 5) === 0 ? 'o' : 'n');
  // The ladder leans on the side away from the gate path.
  const ladderX = gate.side === 'left' ? right - 8 : left + 5;
  ladder(L, clamp(ladderX, 0, W - 7), deckY - 3, P.yB);
  const over = toRows(L);
  const frames = built.frames.map((rows) => {
    const F = fromRows(rows);
    blit(F, over, 0, 0);
    return toRows(F);
  });
  const sprite = fromRows(frames[0]);
  return { ...built, rows: composite(W, H, fromRows(built.ground), sprite), sprite: frames[0], frames, box: opaqueBox(sprite) };
}

// ---------- empty plots and building sites ----------

const GLYPHS = {
  F: ['ooo', 'o..', 'oo.', 'o..', 'o..'],
  O: ['ooo', 'o.o', 'o.o', 'o.o', 'ooo'],
  R: ['oo.', 'o.o', 'oo.', 'o.o', 'o.o'],
  Y: ['o.o', 'o.o', '.o.', '.o.', '.o.'],
  U: ['o.o', 'o.o', 'o.o', 'o.o', 'ooo'],
};

function makeForYouSign() {
  const L = layer(15, 21);
  fillRect(L, 0, 0, 15, 15, 'o');
  fillRect(L, 1, 1, 13, 13, 'n');
  fillRect(L, 2, 2, 11, 11, 'c');
  for (let x = 1; x < 14; x += 1) put(L, x, 13, 'b');
  put(L, 0, 0, '.'); put(L, 14, 0, '.');
  ['FOR', 'YOU'].forEach((word, line) => {
    [...word].forEach((ch, i) => blit(L, GLYPHS[ch], 2 + i * 4, 2 + line * 6));
  });
  for (let y = 15; y < 20; y += 1) { put(L, 5, y, 'o'); put(L, 6, y, 'n'); put(L, 7, y, 'b'); put(L, 8, y, 'o'); }
  fillRect(L, 4, 20, 6, 1, 'o');
  return toRows(L);
}
export const FOR_YOU_SIGN = makeForYouSign();

function siteFootprint(W, H) {
  const front = H >= 72 ? 14 : 12;
  const x0 = 10;
  const x1 = W - 11;
  const y0 = 8;
  const y1 = H - front - 2;
  return { x0, x1, y0, y1 };
}

function gatePath(W, H, gate, fromX, fromY) {
  if (gate.side === 'bottom') return [[fromX, fromY], [fromX, H - 1]].map(([x, y], i) => (i === 1 ? [gate.at, y] : [x, y]));
  return [[fromX, fromY], [fromX, gate.at], [gate.side === 'right' ? W - 1 : 0, gate.at]];
}

function soilPatch(ground, fp) {
  roundedRect(ground, fp.x0, fp.y0, fp.x1, fp.y1, (x, y, edge) => (edge ? 'b' : hash(x, y, 137) < 0.03 ? 'b' : 'n'));
}

// String lines between the corner stakes, like a surveyor's.
function stringLines(ground, fp) {
  const x0 = fp.x0 + 3;
  const y0 = fp.y0 + 3;
  const x1 = fp.x1 - 3;
  const y1 = fp.y1 - 3;
  for (let x = x0; x <= x1; x += 1) if ((x - x0) % 4 < 2) { put(ground, x, y0, 'c'); put(ground, x, y1, 'c'); }
  for (let y = y0; y <= y1; y += 1) if ((y - y0) % 4 < 2) { put(ground, x0, y, 'c'); put(ground, x1, y, 'c'); }
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
}

function finishPlot(W, H, ground, sprite, anchor, door) {
  const frames = [toRows(sprite)];
  return { rows: composite(W, H, ground, sprite), ground: toRows(ground), sprite: frames[0], frames, anchor, door, smoke: null, size: { w: W, h: H }, box: opaqueBox(sprite) };
}

/** A tidy empty plot: cleared soil, stakes and string, a path from the gate, a "For you" sign. */
export function drawEmptyPlot(plot = {}) {
  const { W, H, gate } = plotCanvas(plot);
  const ground = layer(W, H);
  const sprite = layer(W, H);
  const fp = siteFootprint(W, H);
  const cx = gate.side === 'bottom' ? gate.at : Math.floor(W / 2);
  const path = pathMask(W, H, gatePath(W, H, gate, cx, fp.y1 - 1), 6);
  paintPath(ground, path, 'sand');
  soilPatch(ground, fp);
  const corners = stringLines(ground, fp);
  for (const [x, y] of corners) blit(sprite, SPRITES.stake[0], x - 1, y - 4);
  const sign = FOR_YOU_SIGN;
  const sx = gate.side === 'bottom' ? Math.max(1, gate.at - 9 - sign[0].length) : gate.side === 'right' ? W - sign[0].length - 3 : 3;
  const sy = gate.side === 'bottom' ? H - sign.length - 1 : clamp(gate.at - sign.length - 5, 1, H - sign.length - 1);
  blit(sprite, sign, sx, sy);
  shadow(ground, sx + 8, sy + sign.length - 0.5, 5, 1.5);
  return finishPlot(W, H, ground, sprite, { x: Math.floor(W / 2), y: fp.y1 }, { x: gate.side === 'bottom' ? gate.at : gate.side === 'right' ? W - 1 : 0, y: gate.side === 'bottom' ? H - 1 : gate.at });
}

const PLANK_PILE = SPRITES.planks[0];

function post(L, x, top, bottom) {
  for (let y = top; y <= bottom; y += 1) { put(L, x, y, 'o'); put(L, x + 1, y, 'n'); put(L, x + 2, y, 'b'); put(L, x + 3, y, 'o'); }
  put(L, x + 1, top, 'o'); put(L, x + 2, top, 'o');
}
function beam(L, x0, x1, y) {
  for (let x = x0; x <= x1; x += 1) { put(L, x, y, 'o'); put(L, x, y + 1, 'n'); put(L, x, y + 2, 'b'); put(L, x, y + 3, 'o'); }
}
function ladder(L, x, top, bottom) {
  for (let y = top; y <= bottom; y += 1) {
    put(L, x, y, 'o'); put(L, x + 1, y, 'b'); put(L, x + 5, y, 'b'); put(L, x + 6, y, 'o');
    if ((y - top) % 3 === 1) for (let xx = x + 2; xx <= x + 4; xx += 1) put(L, xx, y, 'n');
  }
}
// A timber drawn from (ax, ay) to (bx, by): three px thick, outlined.
function timber(L, ax, ay, bx, by) {
  const T = layer(L.w, L.h);
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(ax + ((bx - ax) * i) / steps);
    const y = Math.round(ay + ((by - ay) * i) / steps);
    for (let d = -1; d <= 1; d += 1) put(T, x, y + d, d < 0 ? 'n' : 'b');
  }
  outline(T);
  blit(L, T, 0, 0);
}

/** The building site while the crew designs: 0 stakes, 1 frame, 2 scaffold and planks, 3 nearly done. */
export function drawConstruction(plot = {}, stage = 0) {
  const s = clamp(Math.floor(Number(stage)) || 0, 0, 3);
  const { W, H, gate } = plotCanvas(plot);
  const ground = layer(W, H);
  const sprite = layer(W, H);
  const draft = normalizeForKit({ style: { shape: 'cottage', walls: 'plank', wallColor: 'woodLight', roof: 'shingle', roofColor: 'clay', trim: 'woodDeep', door: 'plain', windows: 'none', chimney: false } });
  const P = planHouse(draft, W, H, gate);
  // The same cleared soil as the empty plot, so the site grows out of it.
  const fp = siteFootprint(W, H);
  const cx = gate.side === 'bottom' ? gate.at : Math.floor(W / 2);
  paintPath(ground, pathMask(W, H, gatePath(W, H, gate, cx, fp.y1 - 1), 6), 'sand');
  soilPatch(ground, fp);
  const corners = stringLines(ground, fp);
  if (s <= 1) for (const [x, y] of corners) blit(sprite, SPRITES.stake[0], x - 1, y - 4);
  // materials by the side
  const pileRight = P.x1 + 6 + PLANK_PILE[0].length <= W - 2;
  const pileX = pileRight ? P.x1 + 6 : Math.max(1, P.x0 - 6 - PLANK_PILE[0].length);
  if (s < 3) blit(sprite, SMALL_CRATE, pileX + 3, P.yB - PLANK_PILE.length - SMALL_CRATE.length + 3);
  blit(sprite, PLANK_PILE, pileX, P.yB - PLANK_PILE.length + 2);
  const ridgeY = P.yT - P.rh + 3;
  if (s === 0) {
    // footing stones and a handcart have arrived
    const stones = tpl(`
      ...oooo.....
      ..osssSo.oo.
      .ooSSSooosSo
      osscoossSSSo
      oSSSSoSSSSo.
      .oooooooooo.
    `);
    blit(sprite, stones, P.cx - 6, P.yB - 5);
    const cart = PROPS.handcart;
    blit(sprite, cart, pileRight ? P.x0 + 4 : P.x1 - 4 - cart[0].length, P.yB - cart.length + 2);
    // the first posts are ready on the ground, and a sawhorse
    blit(sprite, tpl(`
      ooooooooooo
      onnnnnnnnbo
      ooooooooooo
      .ob.....bo.
      ob.......bo
      oo.......oo
    `), pileRight ? P.x0 - 2 : P.x1 - 9, P.yB - 4);
  }
  if (s >= 1) {
    // footing, posts, a top plate and the rafters: the shape of the house in timber
    for (let x = P.x0; x <= P.x1; x += 1) { put(sprite, x, P.yB - 2, mod(x, 6) === 5 ? 'S' : 's'); put(sprite, x, P.yB - 1, 'S'); put(sprite, x, P.yB, 'o'); }
    for (const x of [P.x0, P.x1]) for (let y = P.yB - 2; y < P.yB; y += 1) put(sprite, x, y, 'o');
    const posts = [P.x0, P.cx - 2, P.x1 - 3];
    if (P.bw >= 56) posts.push(P.x0 + Math.round(P.bw / 4) - 2, P.x1 - Math.round(P.bw / 4) - 1);
    if (s >= 3) {
      const walls = drawBody(P, draft.style, resolveColours(draft.style));
      blit(sprite, walls, 0, 0);
      fillRect(sprite, P.cx - 5, P.yB - 16, 10, 14, 'o');
      fillRect(sprite, P.cx - 4, P.yB - 15, 8, 13, 'm');
      fillRect(sprite, P.cx - 4, P.yB - 15, 8, 2, 'B');
    } else {
      if (s === 2) {
        // the lower walls are going up
        for (let y = P.yB - 10; y <= P.yB - 3; y += 1) for (let x = P.x0 + 1; x <= P.x1 - 1; x += 1) put(sprite, x, y, y === P.yB - 10 ? 'o' : ['c', 'n', 'n', 'b'][mod(x, 4)]);
      }
      for (const px of posts) post(sprite, px, P.yT, P.yB - 3);
      beam(sprite, P.x0 - 1, P.x1 + 1, P.yT);
      timber(sprite, P.x0 - 1, P.yT, P.cx, ridgeY);
      timber(sprite, P.x1 + 1, P.yT, P.cx, ridgeY);
      if (s === 1) for (const [a, b] of [[P.x0 + 3, P.x0 + 13], [P.x1 - 3, P.x1 - 13]]) timber(sprite, a, P.yT + 4, b, P.yB - 4);
    }
  }
  if (s >= 2) {
    // scaffold: a deck on posts along one side, and a ladder
    const deckY = Math.max(2, P.yT - 3);
    const left = s === 3;
    const sx0 = left ? P.x0 - 7 : P.x1 - 18;
    const sx1 = left ? P.x0 + 10 : P.x1 + 6;
    post(sprite, sx0, deckY, P.yB);
    post(sprite, sx1 - 3, deckY, left ? P.yB - 12 : P.yB);
    beam(sprite, sx0, sx1, deckY);
    for (let x = sx0 + 1; x < sx1; x += 1) put(sprite, x, deckY - 1, mod(x, 5) === 0 ? 'o' : 'n');
    ladder(sprite, left ? P.x0 + 12 : P.x1 - 26, deckY - 3, P.yB);
  }
  if (s === 3) {
    // roof: tiled on the left, bare battens on the right
    const roof = roofShingle(P, RAMPS.clay);
    const mid = P.cx + 4;
    for (let y = 0; y < H; y += 1) for (let x = mid; x < W; x += 1) {
      const k = roof.L.px[y][x];
      if (k === '.' || k === 'o') continue;
      roof.L.px[y][x] = mod(y, 3) === 0 ? 'B' : mod(x, 5) === 0 ? 'b' : 'm';
    }
    blit(sprite, roof.L, 0, 0);
  }
  shadow(ground, P.cx + 2, P.yB + 0.5, P.bw / 2 + 4, 3);
  return finishPlot(W, H, ground, sprite, { x: P.cx, y: P.yB }, { x: P.cx, y: P.yB });
}
