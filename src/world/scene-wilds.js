// The wilds in the engine (CONTRACT-PHASE3.md §3, §7.4 and §13): everything beyond the vale that
// the world draws, walks and clicks. createWorld() makes one when it is given content.
//
//   streaming   worldgen's roads warmed in idle time; chunks within one chunk of the view
//               prepared in idle slices (chunk, ground in 64-row slices, the rifts round it, then
//               colour in 128-row slices), never inside the frame and never while hidden; a
//               visible chunk that isn't ready is painted at once, once; at most 25 chunk canvases,
//               rebuilt when the bleeds that touch them change
//   objects     the chunks' objects through the engine's placeObject, in the Hush's colours where
//               the Hush lies and in a genre's where a bleed holds their foot tile (riftfx's
//               tileDressAt: whole, never by one dithered pixel), lit lanterns glowing; the ring
//               of thicket or palisade round the vale, the gatehouses, the Gate Bell and the War
//               Table; the Stockade rising (raiseReveal)
//   rifts       real and story rifts from the shell, wild rifts per chunk, standing bleeds, their
//               strays, seals and let-gos (scene-rifts.js); echoes floating over their place in the vale
//   entities    what can be clicked, hovered, reached with Enter or listed (§4.5)
//   area        where Milo is (onAreaChange) and which chunks the view has shown (onExplore)
//
// Pure data comes from worldgen, wilds, nav, riftgen, rifts and riftfx; this module only arranges it.
import { TILE, MAP, isWalkable as mapIsWalkable, placeById } from './map.js';
import { SPRITES } from './sprites.js';
import { createWorldgen, CHUNK, HEART, GATES } from './worldgen.js';
import { createWilds, colouriseChunk, hushPalette, CHUNK_PX } from './wilds.js';
import { createNav } from './nav.js';
import { createRiftgen } from './riftgen.js';
import { wildRiftsForChunk } from '../rifts.js';
import { bleedsFor, bleedAt, spriteTable, genreIndex, tearArt, tileDressAt, tileStrength, bleedDressAt, makeDresser, DRESS } from './riftfx.js';
import { basePaletteByCode, paintRegion } from './wildsart.js';
import { createRiftLayer, bleedReach } from './scene-rifts.js';
import { isHushed, tableFromPalette, lampPoint } from './scene-art.js';

const FEET = 13;
const SLICE = 64; // ground rows per idle slice
const COLOUR_SLICE = 128; // colour rows per idle slice
export const MAX_CANVASES = 25;
const IDLE_BUDGET_MS = 12;
const MAX_TASKS_PER_SLICE = 8;
const REVEAL_MS = 1800;
const floorDiv = (a, b) => Math.floor(a / b);
const inHeart = (x, y) => x >= 0 && y >= 0 && x < HEART.w && y < HEART.h;
const chunkKey = (cx, cy) => `${cx},${cy}`;
const parseKey = (key) => key.split(',').map(Number);
/** A chunk wholly inside the vale (the vale draws itself there). */
export const allHeart = (cx, cy) => cx * CHUNK >= 0 && cy * CHUNK >= 0 && (cx + 1) * CHUNK <= HEART.w && (cy + 1) * CHUNK <= HEART.h;

/** Chunk keys whose 512 px square meets a world-px rect, nearest the rect's middle first. */
export function chunksInRect(x, y, w, h, pad = 0) {
  const cx0 = floorDiv(Math.floor(x) - pad * CHUNK_PX, CHUNK_PX);
  const cy0 = floorDiv(Math.floor(y) - pad * CHUNK_PX, CHUNK_PX);
  const cx1 = floorDiv(Math.floor(x + w) + pad * CHUNK_PX, CHUNK_PX);
  const cy1 = floorDiv(Math.floor(y + h) + pad * CHUNK_PX, CHUNK_PX);
  const mx = x + w / 2;
  const my = y + h / 2;
  const out = [];
  for (let cy = cy0; cy <= cy1; cy += 1) {
    for (let cx = cx0; cx <= cx1; cx += 1) {
      const d = Math.hypot((cx + 0.5) * CHUNK_PX - mx, (cy + 0.5) * CHUNK_PX - my);
      out.push({ key: chunkKey(cx, cy), cx, cy, d });
    }
  }
  out.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1));
  return out;
}

/** Whether a bleed (rift or standing) reaches into a world-px rect. */
export function bleedTouches(rift, x, y, w, h) {
  const reach = bleedReach(rift);
  const cx = (rift.x + 0.5) * TILE;
  const cy = (rift.y + 0.5) * TILE;
  const dx = Math.max(x - cx, 0, cx - (x + w));
  const dy = Math.max(y - cy, 0, cy - (y + h));
  return dx * dx + dy * dy <= reach * reach;
}

/** What a chunk's colours depend on: the bleeds that touch it, in their order. */
export function bleedSignature(list) {
  return list.map((r) => `${r.id}@${r.x},${r.y}:${r.stage || r.spec?.stage || r.radius || ''}`).join('|');
}

// A vale prop's sprite box in world px (as the engine places it).
function propBox(kind) {
  const o = MAP.objects.find((it) => it.kind === kind);
  if (!o || !SPRITES[kind]) return null;
  const rows = SPRITES[kind][0];
  const baseX = (o.x + o.w / 2) * TILE + (o.dx || 0);
  const baseY = (o.y + o.h) * TILE + (o.dy || 0);
  return { x: baseX - rows[0].length / 2, y: baseY - rows.length, w: rows[0].length, h: rows.length };
}

// Where an echo floats in the vale (world px of the icon's middle) and the tile to walk to: over the
// tent's peak for the camp, on the crew's workbench, at the watchtower's door, by a plot's signpost.
function echoSpot(place) {
  const camp = placeById('camp');
  const tent = propBox('tent');
  const bench = propBox('crew.bench');
  if (place === 'camp' && tent) return { x: tent.x + tent.w / 2, y: tent.y - 9, tile: camp.door };
  if (place === 'workbench' && bench) return { x: bench.x + bench.w / 2, y: bench.y - 5, tile: camp.door };
  const p = placeById(place);
  if (!p) return null;
  // Up the ladder, clear of Milo's head when he stands at the door.
  if (place === 'watchtower') return { x: p.door.x * TILE + 8, y: p.door.y * TILE - 26, tile: p.door };
  // A plot: by its signpost, just inside the gate.
  const gate = MAP.plots?.[place]?.gate;
  if (gate && gate.side === 'right') return { x: p.door.x * TILE - 10, y: p.door.y * TILE - 16, tile: p.door };
  return { x: p.door.x * TILE - 6, y: p.door.y * TILE - 20, tile: p.door };
}

const GATE_LIST = Object.entries(GATES).map(([id, g]) => ({ id, x: g.edge.x + g.dir.x, y: g.edge.y + g.dir.y }));

/**
 * createWildsScene(options) → the wilds for one world. options:
 *   content, seed                    the content bundle and the world seed
 *   makeCanvas, painter              canvases, and scene-art's painter
 *   art                              the engine's { placeObject, gridFor, objectFrame, drawSprite }
 *   now, requestIdle, cancelIdle     time and idle scheduling (setTimeout stands in where needed)
 *   isHidden, isPaused               no work while hidden or paused
 *   onReady()                        something visible changed (the engine redraws)
 *   onAreaChange(info), onExplore(keys)
 */
export function createWildsScene({
  content, seed = 'hushlands', makeCanvas, painter, art, now, requestIdle, cancelIdle,
  isHidden = () => false, isPaused = () => false, onReady = () => {}, onAreaChange = () => {}, onExplore = () => {},
}) {
  const genres = content.genres;
  const words = content.riftgen || null;
  const index = genreIndex(genres);
  const worldgen = createWorldgen({ seed, ...(words && words.regionWords ? { regionWords: words.regionWords } : {}) });
  const wilds = createWilds({ worldgen, maxChunks: 96 });
  let riftgen = null;
  try {
    if (words && genres) riftgen = createRiftgen({ words, genres });
  } catch (error) {
    console.error(error);
  }
  const base = basePaletteByCode();
  const hush = hushPalette(base);
  const hushTable = tableFromPalette(hushPalette());
  const genreTables = new Map();
  const genreTable = (id) => {
    let table = genreTables.get(id);
    if (!table) {
      table = spriteTable(index.get(id) || null);
      genreTables.set(id, table);
    }
    return table;
  };

  // ---------- the state the shell tells us ----------

  const wildState = { day: null, tier: 1, wardRadius: 0, closed: null, lit: null, opened: null, felled: null, notes: null, glimmers: null };
  let stateVersion = 0;
  const objectState = () => ({ felled: wildState.felled, lit: wildState.lit, opened: wildState.opened, day: wildState.day });
  const entityState = () => ({ tier: wildState.tier, lit: wildState.lit, opened: wildState.opened, notes: wildState.notes, glimmers: wildState.glimmers, felled: wildState.felled, day: wildState.day });

  // ---------- walking ----------

  let riftTiles = new Set();
  const ringBlocked = (x, y) => wilds.ringBlocked(x, y, wildState.tier);
  const navStatic = createNav({ valeWalkable: mapIsWalkable, worldgen, wildBlocked: wilds.blocked, extraBlocked: ringBlocked });
  const navMilo = createNav({
    valeWalkable: mapIsWalkable, worldgen, wildBlocked: wilds.blocked,
    extraBlocked: (x, y) => ringBlocked(x, y) || riftTiles.has(`${x},${y}`),
  });

  /** A tile Milo can walk to for something at (x, y): itself when he can stand there, else beside it. */
  function approachFor(x, y, kind = 'poi', from = null) {
    const standOn = kind === 'poi' || kind === 'lantern' || kind === 'gate' || kind === 'stray';
    if (standOn && navMilo.walkable(x, y)) return { x, y };
    // A tree is best chopped from the side (the axe reads against the trunk); never from behind it.
    const sides = kind === 'tree' ? [[-1, 0], [1, 0], [0, 1], [0, -1]] : [[0, 1], [-1, 0], [1, 0], [0, -1]];
    const around = sides.map(([dx, dy]) => ({ x: x + dx, y: y + dy, behind: dy < 0 })).filter((t) => navMilo.walkable(t.x, t.y));
    if (!around.length) return navMilo.nearestWalkable({ x, y }, 3) || { x, y };
    if (from && (kind === 'tree' || kind === 'war-table')) {
      const cost = (t) => Math.abs(t.x - from.x) + Math.abs(t.y - from.y) + (t.behind ? 4 : 0);
      around.sort((a, b) => cost(a) - cost(b));
    }
    return { x: around[0].x, y: around[0].y };
  }

  // ---------- rifts ----------

  let standing = [];
  try {
    standing = worldgen.standingBleeds();
  } catch {
    standing = [];
  }
  const rifts = createRiftLayer({ genres, words, painter, walkable: navStatic.walkable, approach: (x, y, kind) => approachFor(x, y, kind), standing });
  const wildRiftsSig = () => `${wildState.day}|${wildState.wardRadius}`;
  let wildSig = wildRiftsSig();
  const riftsKnown = new Set();

  function computeWild(key) {
    const [cx, cy] = parseKey(key);
    let list = [];
    if (riftgen && Number.isFinite(wildState.day)) {
      try {
        list = wildRiftsForChunk({ worldgen, riftgen, cx, cy, day: wildState.day, wardRadius: wildState.wardRadius, closed: wildState.closed, isFree: navStatic.walkable });
        list = list.filter((r) => !rifts.isClosed(r.id));
      } catch (error) {
        console.error(error);
        list = [];
      }
    }
    rifts.setWild(key, list);
    riftsKnown.add(key);
  }
  function refreshTiles() {
    riftTiles = rifts.tiles();
  }

  // ---------- echoes ----------

  let echoes = [];
  function setEchoes(list) {
    echoes = (Array.isArray(list) ? list : []).filter((e) => e && typeof e.place === 'string').map((e) => {
      const spot = echoSpot(e.place);
      if (!spot) return null;
      const riftId = typeof e.riftId === 'string' ? e.riftId : null;
      const id = typeof e.id === 'string' && e.id ? e.id : `echo:${riftId}`;
      const icon = ['moon', 'knocker', 'spark', 'star', 'crack'].includes(e.icon) ? e.icon : 'crack';
      const genre = index.get(e.genre) || null;
      const rim = genre ? tearArt('open', genre, 0).colours.a || null : null;
      return { id, riftId, place: e.place, icon, genre: e.genre || null, rim, label: typeof e.label === 'string' && e.label ? e.label : 'An echo of a rift', ...spot };
    }).filter(Boolean);
    onReady();
  }
  const halo = (rgb) => painter.glow(rgb, 9, 9, 0.55);
  const echoEntity = (e) => ({ kind: 'echo', id: e.id, x: e.tile.x, y: e.tile.y, label: e.label, riftId: e.riftId, place: e.place, approach: { x: e.tile.x, y: e.tile.y } });

  // ---------- the ring round the vale ----------

  const ringCache = new Map(); // level → { list, byChunk }
  function ring(level) {
    let entry = ringCache.get(level);
    if (!entry) {
      const list = wilds.ringObjects(level).map((o) => art.placeObject(o));
      const byChunk = new Map();
      for (const p of list) {
        const key = chunkKey(floorDiv(p.x, CHUNK), floorDiv(p.y, CHUNK));
        if (!byChunk.has(key)) byChunk.set(key, []);
        byChunk.get(key).push(p);
      }
      entry = { list, byChunk };
      ringCache.set(level, entry);
    }
    return entry;
  }
  let reveal = null; // { at, from, to }
  const ringLevel = () => (wildState.tier >= 2 ? 2 : 1);

  /**
   * The sprite boxes (world px { x, y, w, h }) of the ring's sprites that meet a world-px rect, at
   * both levels (the thicket and the Stockade), so whatever keeps clear of the wall (the harbour's
   * fog) keeps clear of it at any tier.
   */
  function ringBoxes(x, y, w, h) {
    const out = [];
    for (const level of [1, 2]) {
      for (const p of ring(level).list) {
        if (p.sx + p.sw <= x || p.sy + p.sh <= y || p.sx >= x + w || p.sy >= y + h) continue;
        out.push({ x: p.sx, y: p.sy, w: p.sw, h: p.sh, kind: p.kind });
      }
    }
    return out;
  }

  // ---------- chunks: objects and canvases ----------

  const chunks = new Map(); // key → { placed, version }
  function placedIn(key) {
    let entry = chunks.get(key);
    if (entry && entry.version === stateVersion) return entry.placed;
    const [cx, cy] = parseKey(key);
    wilds.chunk(cx, cy);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const placed = wilds.objectsIn(x0, y0, x0 + CHUNK - 1, y0 + CHUNK - 1, objectState()).map((o) => {
      const p = art.placeObject(o);
      // A lit lantern is the light come back: it keeps its warm colours even in the Hush.
      p.hushed = isHushed(o) && !(o.kind === 'lantern.post' && o.frame === 1);
      p.genre = undefined;
      p.genreV = -1;
      return p;
    });
    if (!entry) {
      entry = { placed, version: stateVersion };
      chunks.set(key, entry);
      while (chunks.size > 120) chunks.delete(chunks.keys().next().value);
    } else {
      entry.placed = placed;
      entry.version = stateVersion;
    }
    return placed;
  }

  /** A chunk's object as it is placed in the world (its sprite box, baseX, baseY), by id and tile; or null. */
  function placedAt(id, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    const key = chunkKey(floorDiv(x, CHUNK), floorDiv(y, CHUNK));
    return placedIn(key).find((p) => p.id === id) || null;
  }

  // Which bleeds touch a chunk: `exact` for its ground, and `list` grown by 3 tiles for the sprites
  // standing in it (a sprite on its edge, or whose foot row runs on past it: a hamlet is 3 wide).
  const touchCache = new Map();
  function bleedsTouching(cx, cy) {
    const key = chunkKey(cx, cy);
    const v = rifts.version;
    const known = touchCache.get(key);
    if (known && known.v === v) return known;
    const x0 = cx * CHUNK_PX;
    const y0 = cy * CHUNK_PX;
    const list = rifts.bleeding().filter((r) => bleedTouches(r, x0 - 3 * TILE, y0 - 3 * TILE, CHUNK_PX + 6 * TILE, CHUNK_PX + 6 * TILE));
    const exact = list.filter((r) => bleedTouches(r, x0, y0, CHUNK_PX, CHUNK_PX));
    // sig: what the ground depends on; dressSig: what the sprites standing in the chunk depend on.
    const entry = { v, list, sig: bleedSignature(exact), dressSig: bleedSignature(list), exact };
    touchCache.set(key, entry);
    if (touchCache.size > 200) touchCache.delete(touchCache.keys().next().value);
    return entry;
  }

  const canvases = new Map(); // key → { canvas, sig }
  let building = null; // { key, sig, bleeds, image, row }
  let scratchCtx = null;
  function imageBuffer() {
    if (!scratchCtx) scratchCtx = makeCanvas(1, 1).getContext('2d');
    return scratchCtx.createImageData(CHUNK_PX, CHUNK_PX);
  }

  function groundDone(cx, cy) {
    return wilds.chunk(cx, cy).groundRows >= CHUNK_PX;
  }

  function startBuild(key, cx, cy) {
    const touch = bleedsTouching(cx, cy);
    const bleeds = touch.exact.flatMap((r) => bleedsFor(r, { originX: cx * CHUNK_PX, originY: cy * CHUNK_PX, genres }));
    const image = building && building.image ? building.image : imageBuffer();
    image.data.fill(0);
    building = { key, cx, cy, sig: touch.sig, bleeds, image, row: 0 };
    return building;
  }

  function buildRows(b, rows) {
    const c = wilds.chunk(b.cx, b.cy);
    const to = Math.min(CHUNK_PX, b.row + rows);
    colouriseChunk(c.ground, { base, hush, hushMask: c.hush, bleeds: b.bleeds, originX: b.cx * CHUNK_PX, originY: b.cy * CHUNK_PX, from: b.row, to, out: b.image.data });
    b.row = to;
    if (b.row < CHUNK_PX) return false;
    const old = canvases.get(b.key);
    const canvas = old ? old.canvas : makeCanvas(CHUNK_PX, CHUNK_PX);
    canvas.getContext('2d').putImageData(b.image, 0, 0);
    canvas._milo = `chunk:${b.key}`;
    canvases.delete(b.key);
    canvases.set(b.key, { canvas, sig: b.sig });
    building = { image: b.image }; // keep the buffer for the next one
    trimCanvases();
    return true;
  }

  let focus = { x: 0, y: 0 }; // the view's middle, world px
  // Over the cap, the canvases go that aren't kept (farthest from the view's middle first), so a
  // chunk that is kept is never thrown out only to be painted again.
  function trimCanvases() {
    if (canvases.size <= MAX_CANVASES) return;
    const keep = kept();
    const keys = new Set(keep.map((c) => c.key));
    const cap = Math.max(MAX_CANVASES, keep.length);
    while (canvases.size > cap) {
      let worst = null;
      for (const [key] of canvases) {
        const [cx, cy] = parseKey(key);
        const d = Math.hypot((cx + 0.5) * CHUNK_PX - focus.x, (cy + 0.5) * CHUNK_PX - focus.y);
        const held = keys.has(key);
        if (!worst || (worst.held && !held) || (worst.held === held && d > worst.d)) worst = { key, d, held };
      }
      canvases.delete(worst.key);
    }
  }

  /** Paint a chunk's canvas now (a visible chunk the idle work hasn't reached). */
  function paintNow(cx, cy) {
    const key = chunkKey(cx, cy);
    wilds.ground(cx, cy);
    if (building && building.key === key) building = { image: building.image };
    const b = startBuild(key, cx, cy);
    buildRows(b, CHUNK_PX);
    return canvases.get(key);
  }

  // ---------- idle work ----------

  let view = { x: 0, y: 0, w: 1, h: 1 };
  let roadsWarm = false;
  let idleHandle = null;
  let idleIsTimer = false;
  let disposed = false;
  let suspended = false; // inside an Elsewhere: the world waits
  let visibleDirty = false;

  function wanted() {
    return chunksInRect(view.x, view.y, view.w, view.h, 1).filter((c) => !allHeart(c.cx, c.cy));
  }

  // The chunks whose canvases are kept: every one in view, then the nearest of the ring one chunk
  // out, up to the cap. (A very wide, short window's ring can hold more than the cap: the far ends
  // of it are simply painted when they come into view.)
  function kept() {
    const out = chunksInRect(view.x, view.y, view.w, view.h, 0).filter((c) => !allHeart(c.cx, c.cy));
    const cap = Math.max(MAX_CANVASES, out.length);
    const seen = new Set(out.map((c) => c.key));
    for (const c of wanted()) {
      if (out.length >= cap) break;
      if (!seen.has(c.key)) out.push(c);
    }
    return out;
  }

  function nextTask() {
    if (!roadsWarm) {
      return () => {
        worldgen.roads();
        wilds.terrainAt(HEART.w, -2); // the ring's road detours, from those roads
        roadsWarm = true;
      };
    }
    const list = wanted();
    const cached = new Set(wilds.cached());
    for (const c of list) {
      if (!cached.has(c.key)) return () => wilds.chunk(c.cx, c.cy);
      if (!groundDone(c.cx, c.cy)) {
        const from = wilds.chunk(c.cx, c.cy).groundRows;
        return () => wilds.ground(c.cx, c.cy, { from, to: from + SLICE });
      }
    }
    for (const c of list) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const key = chunkKey(c.cx + dx, c.cy + dy);
          if (riftsKnown.has(key)) continue;
          if (!cached.has(key)) return () => wilds.chunk(c.cx + dx, c.cy + dy);
          return () => {
            computeWild(key);
            refreshTiles();
            visibleDirty = true;
          };
        }
      }
    }
    for (const c of kept()) {
      const have = canvases.get(c.key);
      const touch = bleedsTouching(c.cx, c.cy);
      if (have && have.sig === touch.sig) continue;
      return () => {
        if (!building || building.key !== c.key || building.sig !== touch.sig) startBuild(c.key, c.cx, c.cy);
        if (buildRows(building, COLOUR_SLICE)) visibleDirty = true;
      };
    }
    return null;
  }

  function runIdle(deadline) {
    idleHandle = null;
    if (disposed) return;
    if (isHidden() || isPaused() || suspended) return; // resumed by wake()
    const start = now();
    const left = () => (deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : IDLE_BUDGET_MS);
    // At least one task a slice, and another only while it would still fit in 12 ms.
    let task = nextTask();
    let did = 0;
    let longest = 0;
    while (task && did < MAX_TASKS_PER_SLICE) {
      const began = now();
      try {
        task();
      } catch (error) {
        console.error(error);
      }
      longest = Math.max(longest, now() - began);
      did += 1;
      if (now() - start + longest > IDLE_BUDGET_MS || left() - longest < 2) break;
      task = nextTask();
    }
    if (visibleDirty) {
      visibleDirty = false;
      onReady();
    }
    if (task || nextTask()) schedule();
    return did;
  }

  function schedule() {
    if (idleHandle !== null || disposed || suspended) return;
    const handle = requestIdle(runIdle);
    idleHandle = handle.id;
    idleIsTimer = handle.timer;
  }
  function wake() {
    if (!disposed && !suspended && !isHidden()) schedule();
  }

  /** Run every idle task now (previews, captures and tests); returns the number run. */
  function settle(limit = 5000) {
    if (suspended || disposed) return 0;
    let n = 0;
    let task = nextTask();
    while (task && n < limit) {
      task();
      n += 1;
      task = nextTask();
    }
    refreshTiles();
    return n;
  }

  // ---------- the view: what's drawn, prepared and explored ----------

  const explored = new Set();
  let prunedAt = '';
  // Wild rifts are kept only for chunks near the view (they're rebuilt, the same, when it returns).
  function pruneRifts() {
    const cx0 = floorDiv(Math.floor(view.x), CHUNK_PX) - 3;
    const cy0 = floorDiv(Math.floor(view.y), CHUNK_PX) - 3;
    const cx1 = floorDiv(Math.floor(view.x + view.w), CHUNK_PX) + 3;
    const cy1 = floorDiv(Math.floor(view.y + view.h), CHUNK_PX) + 3;
    const here = `${cx0},${cy0},${cx1},${cy1}`;
    if (here === prunedAt) return;
    prunedAt = here;
    let dropped = false;
    for (const key of [...riftsKnown]) {
      const [cx, cy] = parseKey(key);
      if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) continue;
      riftsKnown.delete(key);
      rifts.dropWild(key);
      dropped = true;
    }
    if (dropped) refreshTiles();
  }
  let viewSpan = '';
  function setView(next, t = null) {
    view = next;
    focus = { x: next.x + next.w / 2, y: next.y + next.h / 2 };
    pruneRifts();
    // Idle work is asked for when the chunks round the view change or a bleed does; anything else
    // that makes work (state, rifts, waking up) asks for itself, and unfinished work reschedules.
    let ask = false;
    if (rifts.update(t)) {
      refreshTiles();
      visibleDirty = true;
      ask = true;
    }
    const span = `${floorDiv(Math.floor(next.x), CHUNK_PX)},${floorDiv(Math.floor(next.y), CHUNK_PX)},${floorDiv(Math.floor(next.x + next.w), CHUNK_PX)},${floorDiv(Math.floor(next.y + next.h), CHUNK_PX)}`;
    if (span !== viewSpan) {
      viewSpan = span;
      ask = true;
    }
    const fresh = [];
    for (const c of chunksInRect(next.x, next.y, next.w, next.h, 0)) {
      if (allHeart(c.cx, c.cy) || explored.has(c.key)) continue;
      explored.add(c.key);
      fresh.push(c.key);
    }
    if (fresh.length) {
      try {
        onExplore(fresh);
      } catch (error) {
        console.error(error);
      }
    }
    if (ask) wake();
  }

  /** Chunk ground under the view, before the vale's own ground is drawn over it. */
  function drawGround(target, t) {
    for (const c of chunksInRect(view.x, view.y, view.w, view.h, 0)) {
      if (allHeart(c.cx, c.cy)) continue;
      let entry = canvases.get(c.key);
      if (!entry) entry = paintNow(c.cx, c.cy);
      else {
        // Motion off: the picture must be the settled one, so a changed bleed is repainted now.
        if (t === null && entry.sig !== bleedsTouching(c.cx, c.cy).sig) entry = paintNow(c.cx, c.cy);
        canvases.delete(c.key);
        canvases.set(c.key, entry);
      }
      target.drawImage(entry.canvas, c.cx * CHUNK_PX, c.cy * CHUNK_PX);
    }
  }

  // ---------- drawing objects ----------

  let shake = null; // { id, dx } while Milo chops a tree

  /**
   * The genre a sprite standing on tiles wears, or null: riftfx's rule for anything that stands
   * (tileDressAt), by the bleeds' undithered strength over its foot tile, never by one dithered
   * pixel of the ground. A sprite wider than a tile (a ruin, a hamlet) goes by the mean over its
   * whole foot row, by the same rule. `bleeds` in the order the layer lists them (bleeding()).
   */
  function footDress(bleeds, x, y, w = 1) {
    if (!bleeds.length) return null;
    if (w <= 1) return tileDressAt(bleeds, x, y, { genres });
    const sum = {};
    for (let i = 0; i < w; i += 1) {
      const hit = tileStrength(bleeds, x + i, y, { genres });
      if (hit) for (const id of Object.keys(hit.strengths)) sum[id] = (sum[id] || 0) + hit.strengths[id];
    }
    let best = null;
    for (const id of Object.keys(sum)) if (!best || sum[id] > best.sum) best = { id, sum: sum[id] };
    return best && best.sum / w >= DRESS.at ? best.id : null;
  }

  // A placed object's genre, kept until the bleeds touching its chunk change.
  function genreOf(p, cx, cy) {
    const touch = bleedsTouching(cx, cy);
    if (p.genreV === touch.dressSig) return p.genre;
    p.genre = footDress(touch.list, p.x, p.y + Math.max(1, p.h || 1) - 1, Math.max(1, p.w || 1));
    p.genreV = touch.dressSig;
    return p.genre;
  }

  /** The colour table something standing on tile (x, y) is drawn in: a bleed's, the Hush's, or null (the world's own). */
  function tableAt(x, y) {
    const genre = tileDressAt(rifts.bleeding(), x, y, { genres });
    if (genre) return genreTable(genre);
    return isHushed({ x, y, hush: wilds.hushAt(x, y) }) ? hushTable : null;
  }

  /**
   * A dresser for one walking sprite (Milo; a crew member each): dress(px, py) → the genre it wears
   * with its feet at world px (px, py) under the bleeds as they stand now, or null. riftfx's
   * makeDresser: it puts a genre on well inside a bleed and keeps it until well out (hysteresis
   * over the strength round the feet), so a coat changes once as it crosses a bleed's edge and
   * never strobes on the wobbled fringe. dress.reset() forgets what it wore (after a jump).
   */
  function dresser() {
    const walker = makeDresser({ genres });
    const dress = (px, py) => walker(rifts.bleeding(), px, py);
    dress.reset = () => walker.reset();
    Object.defineProperty(dress, 'current', { get: () => walker.current });
    return dress;
  }
  const miloDress = dresser(); // Milo's own: the engine resets it whenever he travels or changes scene

  function spriteCanvas(p, frame, genre) {
    const rows = art.gridFor(p.sprite, frame);
    if (genre) return painter.grid(rows, genreTable(genre), genre, { tag: `dress:${genre}` });
    if (p.hushed) return painter.grid(rows, hushTable, 'hush', { tag: 'hush' });
    return null;
  }

  function pushObject(drawables, target, p, t, cx, cy, extraDx = 0) {
    const frame = art.objectFrame(p, t);
    const genre = genreOf(p, cx, cy);
    const canvas = spriteCanvas(p, frame, genre);
    const dx = shake && shake.id === p.id ? shake.dx : 0;
    const x = p.sx + dx + extraDx;
    drawables.push({
      y: p.baseY,
      x: p.baseX,
      draw: canvas ? () => target.drawImage(canvas, x, p.sy) : () => art.drawSprite(target, p.sprite, frame, x, p.sy),
    });
  }

  /**
   * Shadows (drawn now), and the wilds' sprites (pushed into drawables for the y-sort): chunk
   * objects and the ring in chunks meeting the view, the rifts, their strays and seals.
   */
  function collect(drawables, target, visible, t, shadow) {
    const margin = chunksInRect(view.x - 24, view.y - 8, view.w + 48, view.h + 64, 0);
    for (const c of margin) {
      if (!allHeart(c.cx, c.cy)) {
        for (const p of placedIn(c.key)) {
          if (!visible(p.sx, p.sy, p.sw, p.sh + 8)) continue;
          if (p.shadow) shadow(p.baseX, p.baseY, p.shadow[0], p.shadow[1], p.shadow[2]);
          pushObject(drawables, target, p, t, c.cx, c.cy);
        }
      }
      const ringHere = ring(ringLevel()).byChunk.get(c.key);
      if (!ringHere && !reveal) continue;
      const step = revealStep(t);
      if (step === null) {
        for (const p of ringHere || []) {
          if (!visible(p.sx, p.sy, p.sw, p.sh + 8)) continue;
          if (p.shadow) shadow(p.baseX, p.baseY, p.shadow[0], p.shadow[1], p.shadow[2]);
          pushObject(drawables, target, p, t, c.cx, c.cy);
        }
      } else {
        // The Stockade rises: the old ring thins away as the new one gathers, pixel by pixel.
        const from = ring(reveal.from >= 2 ? 2 : 1).byChunk.get(c.key) || [];
        const to = ring(reveal.to >= 2 ? 2 : 1).byChunk.get(c.key) || [];
        for (const [list, invert] of [[from, false], [to, true]]) {
          for (const p of list) {
            if (!visible(p.sx, p.sy, p.sw, p.sh + 8)) continue;
            const rows = art.gridFor(p.sprite, art.objectFrame(p, null));
            const canvas = painter.dissolve(rows, step, 8, { invert });
            drawables.push({ y: p.baseY, x: p.baseX, draw: () => target.drawImage(canvas, p.sx, p.sy) });
          }
        }
      }
    }
    rifts.collect(drawables, target, visible, t, shadow);
  }

  function revealStep(t) {
    if (!reveal) return null;
    if (t === null) {
      reveal = null;
      return null;
    }
    const age = t - reveal.at;
    if (age >= REVEAL_MS) {
      reveal = null;
      return null;
    }
    return Math.max(1, Math.min(7, Math.floor((Math.max(0, age) / REVEAL_MS) * 8)));
  }

  /** Warm light from lit lanterns and the gatehouse lanterns (tier 2 and up). */
  const lampCache = new Map();
  function lamp(name, frame) {
    const k = `${name}#${frame}`;
    if (!lampCache.has(k)) lampCache.set(k, lampPoint(art.gridFor(name, frame)));
    return lampCache.get(k);
  }
  function drawGlow(target, visible, glow) {
    const margin = chunksInRect(view.x - 24, view.y - 8, view.w + 48, view.h + 64, 0);
    for (const c of margin) {
      const lists = [];
      if (!allHeart(c.cx, c.cy)) lists.push(placedIn(c.key));
      const ringHere = ring(ringLevel()).byChunk.get(c.key);
      if (ringHere && !reveal) lists.push(ringHere);
      for (const list of lists) {
        for (const p of list) {
          const lit = (p.kind === 'lantern.post' && p.frame === 1) || p.kind === 'gatehouse';
          if (!lit || !visible(p.sx - 14, p.sy - 14, p.sw + 28, p.sh + 28)) continue;
          const at = lamp(p.sprite, p.frame || 0);
          // A lit lantern out in the wilds is the light come back: a little warmer than the vale's.
          if (at) glow(p.sx + at.x + 0.5, p.sy + at.y + 0.5, p.kind === 'gatehouse' ? 11 : 16, p.kind === 'gatehouse' ? 0.18 : 0.27);
        }
      }
    }
  }

  /** Echoes over their place, weather and the let-go moth: above the sprites. */
  function drawAbove(target, visible, t) {
    for (const e of echoes) {
      if (!visible(e.x - 10, e.y - 10, 20, 20)) continue;
      // A slow bob, and the other story's light flickering softly round it.
      const bob = t === null ? 0 : Math.round(Math.sin((t + e.x * 13) / 800) * 1.2);
      const x = Math.round(e.x);
      const y = Math.round(e.y) + bob;
      if (e.rim) {
        const flicker = t === null ? 1 : 0.65 + 0.35 * (Math.floor((t + e.y * 7) / 420) % 5 === 0 ? 0.3 : 1) * (0.75 + 0.25 * Math.sin(t / 650));
        target.globalAlpha = flicker;
        target.drawImage(halo(e.rim), x - 9, y - 9);
        target.globalAlpha = 1;
      }
      art.drawSprite(target, `echo.${e.icon}`, 0, x - 5, y - 5);
    }
    rifts.drawAbove(target, visible, t, view);
  }

  // ---------- entities ----------

  function withApproach(entity, from) {
    if (!entity || entity.approach) return entity;
    return { ...entity, approach: approachFor(entity.x, entity.y, entity.kind, from) };
  }

  /** The entity a map object stands for (trees, points of interest, gatehouses, the War Table). */
  function entityForPlace(placeId, from = null) {
    return resolve(placeId, from);
  }

  function resolve(id, from = null, t = null) {
    if (typeof id !== 'string' || !id) return null;
    let m = /^lantern:(-?\d+),(-?\d+)$/.exec(id) || /^poi:[a-z]+:(-?\d+),(-?\d+)$/.exec(id);
    if (m) {
      const p = wilds.poiAt(Number(m[1]), Number(m[2]));
      return p && p.id === id ? withApproach(wilds.poiEntity(p, entityState()), from) : null;
    }
    m = /^tree:(-?\d+),(-?\d+)$/.exec(id);
    if (m) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      wilds.chunk(floorDiv(x, CHUNK), floorDiv(y, CHUNK));
      const e = wilds.entitiesIn({ x0: x, y0: y, x1: x, y1: y }, entityState()).find((it) => it.id === id);
      return withApproach(e || null, from);
    }
    if (GATES[id]) {
      const g = GATE_LIST.find((it) => it.id === id);
      const e = wilds.entitiesIn({ x0: g.x, y0: g.y, x1: g.x, y1: g.y }, entityState()).find((it) => it.id === id);
      return withApproach(e || null, from);
    }
    if (id === 'war-table') {
      const war = wildState.tier >= 2 ? wilds.warTable() : null;
      if (!war) return null;
      return withApproach({ kind: 'war-table', id, x: war.x, y: war.y, label: 'War Table', place: 'war-table' }, from);
    }
    if (id.startsWith('echo:')) {
      const e = echoes.find((it) => it.id === id);
      return e ? echoEntity(e) : null;
    }
    if (id.startsWith('rift:') || id.startsWith('stray:')) return rifts.entityById(id, t);
    return null;
  }

  /** Every entity whose tile is in a tile rect (inclusive), with its approach tile. */
  function entitiesIn(rect, t = null, from = null) {
    const out = [];
    try {
      for (const e of wilds.entitiesIn(rect, entityState())) out.push(withApproach(e, from));
    } catch (error) {
      console.error(error);
    }
    out.push(...rifts.entities(rect, t));
    for (const e of echoes) if (e.tile.x >= rect.x0 && e.tile.x <= rect.x1 && e.tile.y >= rect.y0 && e.tile.y <= rect.y1) out.push(echoEntity(e));
    return out;
  }

  /** The entity under world pixel (ax, ay), or null: rifts and strays first, echoes, then sprites. */
  function hit(ax, ay, t, opaque, from) {
    const riftHit = rifts.hit(ax, ay, t, opaque);
    if (riftHit) return riftHit;
    for (const e of echoes) {
      if (Math.abs(ax - e.x) <= 7 && Math.abs(ay - e.y) <= 7) return echoEntity(e);
    }
    const candidates = [];
    for (const c of chunksInRect(ax - 24, ay - 8, 48, 64, 0)) {
      if (!allHeart(c.cx, c.cy) && chunks.has(c.key)) candidates.push(...placedIn(c.key));
      const ringHere = ring(ringLevel()).byChunk.get(c.key);
      if (ringHere) candidates.push(...ringHere);
    }
    const front = candidates.filter((p) => p.place && ax >= p.sx && ay >= p.sy && ax < p.sx + p.sw && ay < p.sy + p.sh).sort((a, b) => b.baseY - a.baseY);
    for (const p of front) {
      if (!opaque(art.gridFor(p.sprite, art.objectFrame(p, null)), Math.floor(ax - p.sx), Math.floor(ay - p.sy))) continue;
      const e = entityForPlace(p.place, from);
      if (e) return e;
    }
    return null;
  }

  /** The entity to open with Enter when Milo stands on `tile` facing `dir`. */
  function entityAt(tile, dir, t) {
    const rect = { x0: tile.x - 2, y0: tile.y - 2, x1: tile.x + 2, y1: tile.y + 2 };
    const list = entitiesIn(rect, t, tile);
    const ahead = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] || [0, 1];
    const ok = [];
    for (const e of list) {
      const own = e.x === tile.x && e.y === tile.y;
      const beside = Math.abs(e.x - tile.x) + Math.abs(e.y - tile.y) === 1;
      const byTile = e.approach && e.approach.x === tile.x && e.approach.y === tile.y;
      let reach = false;
      if (e.kind === 'tree' || e.kind === 'rift' || e.kind === 'war-table') reach = byTile || beside || (e.kind === 'war-table' && Math.abs(e.x + 0.5 - tile.x) <= 1.5 && Math.abs(e.y - tile.y) === 1);
      else if (e.kind === 'stray') reach = own || beside;
      else reach = byTile || own;
      if (!reach) continue;
      const facing = e.x - tile.x === ahead[0] && e.y - tile.y === ahead[1];
      const order = { rift: 0, stray: 1, lantern: 2, poi: 2, echo: 3, gate: 4, 'war-table': 3, tree: 5 }[e.kind] ?? 6;
      ok.push({ e, score: (facing ? 0 : 10) + order });
    }
    ok.sort((a, b) => a.score - b.score);
    return ok.length ? ok[0].e : null;
  }

  // ---------- area ----------

  let areaInfo = { area: 'vale', regionId: 'hearthvale', regionName: 'Hearthvale', tier: 1, depth: 1, hush: false, chunk: '0,0' };
  let areaKey = '';
  function infoAt(tile) {
    const cx = floorDiv(tile.x, CHUNK);
    const cy = floorDiv(tile.y, CHUNK);
    const chunk = chunkKey(cx, cy);
    if (inHeart(tile.x, tile.y)) return { area: 'vale', regionId: 'hearthvale', regionName: 'Hearthvale', tier: 1, depth: 1, hush: false, chunk };
    const region = wilds.hushRegion(tile.x, tile.y);
    let regionId = region ? region.id : null;
    const regionName = region ? region.name : worldgen.regionAt(tile.x, tile.y);
    if (!regionId) {
      const anchor = worldgen.anchors.find((a) => a.name === regionName);
      regionId = anchor ? anchor.id : null;
    }
    return { area: 'wilds', regionId, regionName, tier: worldgen.tierAt(tile.x, tile.y), depth: worldgen.depthAt(tile.x, tile.y), hush: wilds.hushAt(tile.x, tile.y) >= 128, chunk };
  }
  function miloAt(tile, force = false) {
    areaInfo = infoAt(tile);
    const key = `${areaInfo.area}|${areaInfo.regionId}|${areaInfo.regionName}|${areaInfo.hush}|${areaInfo.chunk}`;
    if (key === areaKey && !force) return areaInfo;
    areaKey = key;
    try {
      onAreaChange({ ...areaInfo });
    } catch (error) {
      console.error(error);
    }
    return areaInfo;
  }

  // ---------- the shell's state ----------

  const asSet = (value) => (Array.isArray(value) ? new Set(value) : value);
  function setWildState(next = {}) {
    let objects = false;
    let wildRifts = false;
    for (const key of ['lit', 'opened', 'felled', 'notes', 'glimmers']) {
      if (key in next) {
        wildState[key] = asSet(next[key]) || null;
        objects = true;
      }
    }
    if ('day' in next && Number.isFinite(next.day) && next.day !== wildState.day) {
      wildState.day = next.day;
      objects = true;
      wildRifts = true;
      rifts.forgetClosed();
    }
    if ('wardRadius' in next && Number.isFinite(next.wardRadius) && next.wardRadius !== wildState.wardRadius) {
      wildState.wardRadius = Math.max(0, next.wardRadius);
      wildRifts = true;
    }
    if ('closed' in next) {
      wildState.closed = asSet(next.closed) || null;
      wildRifts = true;
    }
    if ('tier' in next && Number.isFinite(next.tier)) {
      const tier = Math.max(1, Math.min(8, Math.round(next.tier)));
      if (tier !== wildState.tier) {
        // Remember the ring as it stood, so a raiseReveal just after can still show it rising.
        const was = ringLevel();
        wildState.tier = tier;
        if (ringLevel() !== was) ringChange = { from: was, at: now() };
        objects = true;
      }
    }
    if (objects) stateVersion += 1;
    if (wildRifts || wildSig !== wildRiftsSig()) {
      wildSig = wildRiftsSig();
      // Recompute the rifts already known (so nothing flickers), then let idle work do the rest.
      const known = [...riftsKnown];
      riftsKnown.clear();
      rifts.clearWild();
      const near = new Set(chunksInRect(view.x, view.y, view.w, view.h, 1).map((c) => c.key));
      for (const key of known) if (near.has(key)) computeWild(key);
      refreshTiles();
    }
    onReady();
    wake();
  }

  function setRifts(list, t, motion) {
    rifts.setReal(list, t, motion);
    refreshTiles();
    onReady();
    wake();
  }

  function closeRift(id, how, t, motion) {
    const done = rifts.close(id, how, t, motion);
    refreshTiles();
    onReady();
    wake();
    return done;
  }

  let ringChange = null; // { from, at }: the ring's level before the tier last moved it
  function raiseReveal(tier, t, motion) {
    const to = Math.max(1, Math.min(8, Math.round(Number(tier) || 2)));
    // Whichever comes first, setWildState's new tier or this call, the old ring is what dissolves.
    const from = ringChange && now() - ringChange.at < 1500 ? ringChange.from : ringLevel();
    ringChange = null;
    wildState.tier = Math.max(wildState.tier, to);
    stateVersion += 1;
    reveal = motion && t !== null && (from >= 2 ? 2 : 1) !== (to >= 2 ? 2 : 1) ? { at: t, from, to } : null;
    onReady();
  }

  /** Map art for a chunk at pxPerTile: wildsart in base colours, the Hush applied. */
  function paintMapChunk(cx, cy, pxPerTile = 4) {
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) return null;
    const size = Math.max(1, Math.min(16, Math.round(Number(pxPerTile) || 4)));
    const c = wilds.chunk(cx, cy);
    const { keys, width, height } = paintRegion(wilds, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, size);
    const rgba = colouriseChunk(keys, { base, hush, hushMask: c.hush, width, tileSize: size, originX: cx * CHUNK * size, originY: cy * CHUNK * size });
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    image.data.set(rgba);
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /**
   * Make the chunks round a tile ready now (before a fade in): ground, rifts and canvases. `at`,
   * when given, is the exact view there (world px); otherwise a view centred on the tile's feet.
   * The view moves there now, so the canvases kept are the ones round where Milo is going.
   */
  function prepareAround(tile, viewW, viewH, at = null) {
    const px = tile.x * TILE + 8;
    const py = tile.y * TILE + FEET;
    const rect = at && [at.x, at.y, at.w, at.h].every(Number.isFinite) ? { x: at.x, y: at.y, w: at.w, h: at.h } : { x: px - viewW / 2, y: py - viewH / 2, w: viewW, h: viewH };
    view = rect;
    focus = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    for (const c of chunksInRect(rect.x, rect.y, rect.w, rect.h, 0)) {
      if (allHeart(c.cx, c.cy)) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const key = chunkKey(c.cx + dx, c.cy + dy);
          if (!riftsKnown.has(key)) computeWild(key);
        }
      }
    }
    refreshTiles();
    for (const c of chunksInRect(rect.x, rect.y, rect.w, rect.h, 0)) {
      if (allHeart(c.cx, c.cy)) continue;
      const have = canvases.get(c.key);
      if (!have || have.sig !== bleedsTouching(c.cx, c.cy).sig) paintNow(c.cx, c.cy);
    }
  }

  function dispose() {
    disposed = true;
    if (idleHandle !== null) cancelIdle(idleHandle, idleIsTimer);
    idleHandle = null;
  }

  return {
    worldgen, wilds, rifts, riftgen, genres, words, index,
    // walking
    isWalkable: navStatic.walkable,
    miloWalkable: navMilo.walkable,
    findPath: (from, to) => navMilo.findPath(from, to),
    nearestWalkable: (tile, r) => navMilo.nearestWalkable(tile, r),
    approachFor,
    // state from the shell
    setWildState, setRifts, closeRift, setEchoes, raiseReveal,
    get tier() { return wildState.tier; },
    get day() { return wildState.day; },
    // drawing
    setView, drawGround, collect, drawGlow, drawAbove, genreTable, tableAt, ringBoxes,
    // The ground's genre at a world pixel (dithered, as the chunks are coloured): for the ground only.
    genreAt: (px, py) => bleedAt(rifts.bleeding(), px, py, { genres }),
    // Dressing sprites: one that stands at a pixel (dressAt), one that walks (dresser(), and Milo's
    // own miloDress), whole and never from one dithered pixel.
    dressAt: (px, py) => bleedDressAt(rifts.bleeding(), px, py, { genres }),
    dresser, miloDress,
    setShake: (value) => { shake = value; },
    placedAt,
    // entities and the area
    hit, entitiesIn, entityAt, resolve, miloAt, area: () => ({ ...areaInfo }),
    // streaming
    wake, settle, prepareAround, paintMapChunk,
    suspend(value) {
      suspended = !!value;
      if (!suspended) wake();
    },
    stats: () => ({ canvases: canvases.size, chunks: wilds.cached().length, riftsKnown: riftsKnown.size, pending: !!nextTask(), made: painter.made }),
    canvasKeys: () => [...canvases.keys()],
    dispose,
  };
}
