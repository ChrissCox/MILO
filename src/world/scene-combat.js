// The fight on the world's own ground (CONTRACT-PHASE4.md §11; COMBAT.md §4.1, §13, §14): an engine
// layer that draws the arena's grid and light, surfaces, the planner's overlay (reachable tiles,
// the path and its swipes, areas with everyone they'd catch, threats, cover, telegraph arrows, the
// tile cursor), every combatant (heroes on their rigs, strays posed from anims.json, leads and elites
// at 2×, devices and the Mimic), fight objects, telegraph icons, condition badges, damage numbers
// (numberRows, never floatText), effects, projectiles and outcome flashes.
//
// Combat is a mode, not a scene: the engine keeps drawing the Elsewhere, cave or wilds underneath
// and hands this layer its hooks (ground, collect, above, update, settle, hit, entities, hidden).
// While a fight runs the layer says Milo and the followers are hidden (the combatants draw every
// hero, Milo included), and so are the scene's own props where a fight object stands.
//
// Time: idle loops and playback run on a clock the engine advances by each tick's clamped dt, never
// absolute time, so a hidden or paused window holds the fight still. Playback comes from
// anim.timeline; with motion off it ends at once on its final frame, and a still frame (t === null)
// draws only still frames, the same list every time. Everything drawn is a cached canvas: frames
// come memoised and frozen from sprites-party, straygen, fx, icons and numberRows, so the painter
// keeps hitting (painter.made stays flat), and the grid, light, surfaces and overlay are baked when
// they change, never in a draw.
import { TILE } from './map.js';
import { SPRITES, PALETTE } from './sprites.js';
import { clipFrames } from './sprites-party.js';
import { composeStray, restFeet, PARTS } from './straygen.js';
import { outfitGrid } from './riftfx.js';
import { numberRows, textRows } from './scene-art.js';
import { INTENT_ICONS, CONDITION_ICONS, MARKERS, FLASHES, NUMBER_SLOT, THOUGHT_ICONS } from './icons.js';
import { effectFrame, projectileFrame, PROJECTILE_FOR, surfaceTile, shimmerOutline } from './fx.js';
import { PROPS4, propFrame } from './props4.js';
import { timeline, clipInfo, clipFrame, paceOf } from './anim.js';

const FEET = 13;
const EMPTY = Object.freeze([]);
const hashId = (text) => {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 4000;
};
const rgbOf = (key) => {
  const n = parseInt((PALETTE[key] || PALETTE.o).hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
const RGBA = (key, a) => `rgba(${rgbOf(key)},${a})`;
const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const BASES = new Set(['ready', 'dozing']);
const TOPS = new WeakMap();
/** The first row with ink in it (cached per rows): badges and numbers sit just over the head, not the frame. */
function inkTop(rows) {
  let top = TOPS.get(rows);
  if (top === undefined) {
    top = rows.findIndex((row) => /[^.x]/.test(row));
    if (top < 0) top = 0;
    TOPS.set(rows, top);
  }
  return top;
}

/** Feet (world px) of a unit standing at tile (x, y): a Large unit's are the middle of its 2×2. */
export function unitFeet(x, y, size = 1) {
  return size === 2 ? { x: x * TILE + 16, y: (y + 1) * TILE + FEET } : { x: x * TILE + 8, y: y * TILE + FEET };
}

const maskOf = (hit) => Object.freeze(Array.from({ length: TILE }, (_, y) => Array.from({ length: TILE }, (_, x) => (hit(x, y) ? '#' : '.')).join('')));
const plusAt = (x, y, cx, cy) => (x % 8 === cx && Math.abs((y % 8) - cy) <= 1) || (y % 8 === cy && Math.abs((x % 8) - cx) <= 1);
/**
 * An area's hatching on one tile ('#' drawn), a pattern per kind so harm and help read apart without
 * their colours (COMBAT §15): harm in diagonal stripes, help in small crosses.
 */
export const AREA_HATCH = Object.freeze({
  harm: maskOf((x, y) => (x + y) % 4 === 0),
  help: maskOf((x, y) => plusAt(x, y, 2, 2) || plusAt(x, y, 6, 6)),
});
/** Beside each unit an area would catch (allies included): harm a red wedge pointing down, help a green one pointing up. */
export const CAUGHT_MARKS = Object.freeze({
  harm: Object.freeze(['ooooo', 'orrro', '.oro.', '..o..']),
  help: Object.freeze(['..o..', '.olo.', 'olllo', 'ooooo']),
});
/** ⚠ on a path's step that draws a Parting swipe (COMBAT §4.1): a honey triangle with an ink "!". */
export const SWIPE_MARK = Object.freeze([
  '.....o.....',
  '....oUo....',
  '....oUo....',
  '...oUoUo...',
  '...oUoUo...',
  '..oUUoUUo..',
  '..oUUUUUo..',
  '.oUUUoUUUo.',
  'ooooooooooo',
]);

function cleanUnit(u) {
  return {
    id: u.id, side: u.side === 'party' || u.side === 'neutral' ? u.side : 'foe', rank: u.rank || 'stray', talkKind: u.talkKind ?? null,
    look: u.look || null, x: Number(u.x) || 0, y: Number(u.y) || 0, size: u.size === 2 ? 2 : 1, facing: u.facing === 'left' ? 'left' : 'right',
    name: typeof u.name === 'string' ? u.name : u.id, integrity: Number(u.integrity) || 0, max: Number(u.max) || 0, buffer: Number(u.buffer) || 0,
    offline: !!u.offline, sorted: u.sorted || null, conditions: Array.isArray(u.conditions) ? u.conditions.map((c) => ({ id: c.id, n: c.n ?? null })) : [],
    heat: Number(u.heat) || 0, bar: u.bar || null, gone: !!u.sorted, examined: !!u.examined,
  };
}

/** A startCombat view made clean: { arena, units: Map, objects, surfaces, lights, telegraphs, noticed }. */
export function boardOf(view) {
  const arena = view?.arena;
  if (!arena || !arena.rect || !Number.isFinite(arena.rect.w)) return null;
  const units = new Map();
  for (const u of Array.isArray(view.units) ? view.units : []) if (u && typeof u.id === 'string' && !units.has(u.id)) units.set(u.id, cleanUnit(u));
  return {
    arena: { rect: { ...arena.rect }, cells: String(arena.cells || ''), height: String(arena.height || ''), light: String(arena.light || ''), mouths: arena.mouths || [], entry: arena.entry || [] },
    units,
    objects: (Array.isArray(view.objects) ? view.objects : []).map((o) => ({ ...o })),
    surfaces: (Array.isArray(view.surfaces) ? view.surfaces : []).map((s) => ({ ...s })),
    lights: (Array.isArray(view.lights) ? view.lights : []).map((l) => ({ ...l })),
    telegraphs: Array.isArray(view.telegraphs) ? view.telegraphs.slice() : [],
    noticed: Array.isArray(view.noticed) ? view.noticed.slice() : null,
    abilities: view.abilities || null,
  };
}

/** How dark an arena tile is with the fight's lights (0 lit, 1 dim, 2 dark), by §4.17 and COMBAT §4.1's 1-2-1 distance. */
export function shadeAt(board, x, y) {
  const r = board.arena.rect;
  const ch = board.arena.light[(y - r.y) * r.w + (x - r.x)] || 'L';
  if (ch === 'L') return 0;
  for (const l of board.lights) {
    const dx = Math.abs(l.x - x);
    const dy = Math.abs(l.y - y);
    if (Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2) <= (Number(l.radius) || 0)) return 0;
  }
  return ch === 'D' ? 2 : 1;
}

/**
 * createCombatLayer(env) → the fight as a layer, plus start, sync, play, overlay, end, focus, shake,
 * snapshot and running. env: { painter, makeCanvas(w, h), anims(), rules(), tableFor(genre),
 * dressAt(px, py) → genre | null, genreAt(tile) → genre | null, motion() → true | 'reduced' | false,
 * wake() }.
 */
export function createCombatLayer(env) {
  let board = null;
  let overlay = null;
  let opening = null; // { tl, clock, resolve }
  let play = null; // { tl, clock, next, landed, events, holds, views, speed, fastFoes, motion, resolves }
  let idle = 0;
  let cur = null; // this draw's frame state
  let genre = null; // the room's genre, for effects, surfaces and props
  let hiddenProps = new Set();
  const baked = { grid: null, shade: null, surfaces: [], plan: null, planAt: null };
  let freshTelegraphs = false; // a telegraphs event (or a sync) came after the overlay was set
  /**
   * The telegraphs to draw: the planner's overlay's, unless B has sent newer ones since. Either way
   * only as the HUD's cards show them (§18.3 item 5, as K2's foeIntents): none from a foe that's
   * Unseen or sorted, and a Void lie's false target only until its foe is Examined.
   */
  const telegraphsNow = () => shownTelegraphs((!freshTelegraphs && overlay?.telegraphs) || board.telegraphs);
  const inView = (id) => {
    const u = board.units.get(id);
    return !!u && !u.gone && !(u.side !== 'party' && u.conditions.some((c) => c.id === 'unseen'));
  };
  function shownTelegraphs(list) {
    if (!Array.isArray(list)) return EMPTY;
    const lied = (tg) => tg.falseTarget && board.units.get(tg.unitId)?.examined;
    if (list.every((tg) => tg && inView(tg.unitId) && !lied(tg))) return list;
    return list.filter((tg) => tg && inView(tg.unitId)).map((tg) => (lied(tg) ? { ...tg, falseTarget: null } : tg));
  }
  /** The overlay's threats, or (when B's telegraphs are newer) the tiles of every shown area telegraph (§18.3 item 5). */
  function threatsNow() {
    if (!overlay?.threats) return EMPTY;
    if (!freshTelegraphs) return overlay.threats;
    const seen = new Map();
    for (const tg of telegraphsNow()) if (!tg.hidden && tg.icon === 'area') for (const t of tg.tiles || EMPTY) seen.set(`${t.x},${t.y}`, t);
    return [...seen.values()];
  }
  const strayFeet = new Map();
  const TABLE = (g) => env.tableFor(g || null);

  // ---------- baking (only ever when the board or overlay changes, never in a draw) ----------

  function canvasFor(w, h, tag) {
    const c = env.makeCanvas(Math.max(1, w), Math.max(1, h));
    c._milo = tag;
    return c;
  }

  function bakeGrid() {
    const { rect, cells } = board.arena;
    const c = canvasFor(rect.w * TILE, rect.h * TILE, 'overlay:grid');
    const ctx = c.getContext('2d');
    ctx.fillStyle = RGBA('o', 0.22);
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        const ch = cells[y * rect.w + x];
        if (ch === '#' || ch === ' ' || ch === undefined) continue;
        // A dotted edge along the top and left of every tile you can stand near: the grid reads, softly.
        for (let i = 0; i < TILE; i += 2) {
          ctx.fillRect(x * TILE + i, y * TILE, 1, 1);
          ctx.fillRect(x * TILE, y * TILE + i, 1, 1);
        }
      }
    }
    baked.grid = c;
  }

  function bakeShade() {
    const { rect } = board.arena;
    const c = canvasFor(rect.w * TILE, rect.h * TILE, 'overlay:light');
    const ctx = c.getContext('2d');
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        const ch = board.arena.cells[y * rect.w + x];
        const s = ch === '#' || ch === ' ' || ch === undefined ? 0 : shadeAt(board, rect.x + x, rect.y + y);
        if (!s) continue;
        ctx.fillStyle = RGBA('o', s === 2 ? 0.34 : 0.16);
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    baked.shade = c;
  }

  function bakeSurfaces() {
    const { rect } = board.arena;
    const at = new Map(board.surfaces.map((s) => [`${s.x},${s.y}`, s.id]));
    const same = (x, y, id) => at.get(`${x},${y}`) === id;
    baked.surfaces = [0, 1, 2].map((f) => {
      if (!board.surfaces.length) return null;
      const c = canvasFor(rect.w * TILE, rect.h * TILE, 'overlay:surface');
      const ctx = c.getContext('2d');
      for (const s of board.surfaces) {
        if (!inRect(rect, s.x, s.y)) continue;
        const edges = (same(s.x, s.y - 1, s.id) ? 1 : 0) | (same(s.x + 1, s.y, s.id) ? 2 : 0) | (same(s.x, s.y + 1, s.id) ? 4 : 0) | (same(s.x - 1, s.y, s.id) ? 8 : 0);
        let rows = null;
        try { rows = surfaceTile(s.id, f, { edges }); } catch { rows = null; }
        if (!rows) continue;
        ctx.drawImage(env.painter.grid(rows, TABLE(genre), genre || 'base', { tag: 'surface' }), (s.x - rect.x) * TILE, (s.y - rect.y) * TILE);
      }
      return c;
    });
  }

  const HATCH = new Map();
  function hatch(kind) {
    if (HATCH.has(kind)) return HATCH.get(kind);
    const key = kind === 'help' ? 'l' : 'r';
    const c = canvasFor(TILE, TILE, `overlay:hatch`);
    const ctx = c.getContext('2d');
    // Its own pattern per kind (colour-blind safe: areas read by their hatching, COMBAT §15), a faint fill under it.
    ctx.fillStyle = RGBA(key, 0.16);
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = RGBA(key, 0.75);
    const mask = AREA_HATCH[kind === 'help' ? 'help' : 'harm'];
    for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) if (mask[y][x] === '#') ctx.fillRect(x, y, 1, 1);
    HATCH.set(kind, c);
    return c;
  }

  function bakePlan() {
    baked.plan = null;
    if (!board || !overlay) return;
    const { rect } = board.arena;
    const c = canvasFor(rect.w * TILE, rect.h * TILE, 'overlay:plan');
    const ctx = c.getContext('2d');
    const lx = (x) => (x - rect.x) * TILE;
    const ly = (y) => (y - rect.y) * TILE;
    const icon = (rows, x, y) => ctx.drawImage(env.painter.grid(rows, null, 'base', { tag: 'overlay:icon' }), Math.round(x), Math.round(y));
    for (const t of overlay.reachable || EMPTY) {
      ctx.fillStyle = RGBA('u', 0.3);
      ctx.fillRect(lx(t.x) + 1, ly(t.y) + 1, TILE - 2, TILE - 2);
    }
    for (const t of threatsNow()) {
      ctx.fillStyle = RGBA('r', 0.7);
      for (const [dx, dy] of [[1, 1], [TILE - 3, 1], [1, TILE - 3], [TILE - 3, TILE - 3]]) ctx.fillRect(lx(t.x) + dx, ly(t.y) + dy, 2, 2);
    }
    for (const area of overlay.areas || EMPTY) {
      const h = hatch(area.kind === 'help' ? 'help' : 'harm');
      for (const t of area.tiles || EMPTY) ctx.drawImage(h, lx(t.x), ly(t.y));
    }
    for (const cov of overlay.cover || EMPTY) icon(cov.level === 2 ? MARKERS.coverHeavy : MARKERS.coverLow, lx(cov.x) + 4, ly(cov.y) + 4);
    // Telegraph arrows: dots from each foe to what it means to hit.
    for (const tg of telegraphsNow() || EMPTY) {
      const from = board.units.get(tg.unitId);
      if (!from || tg.hidden) continue;
      const a = unitFeet(from.x, from.y, from.size);
      const ends = [...(tg.falseTarget ? [tg.falseTarget] : tg.targets || EMPTY).map((id) => board.units.get(id)).filter(Boolean).map((u) => unitFeet(u.x, u.y, u.size)), ...(tg.tiles || EMPTY).map((t) => unitFeet(t.x, t.y))];
      ctx.fillStyle = RGBA('r', 0.8);
      for (const b of ends) {
        const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 4));
        for (let i = 1; i < n; i += 1) ctx.fillRect(Math.round(a.x + ((b.x - a.x) * i) / n) - rect.x * TILE, Math.round(a.y - 6 + ((b.y - a.y) * i) / n) - rect.y * TILE, 1, 1);
      }
    }
    const path = overlay.path;
    if (path && Array.isArray(path.tiles)) {
      for (const t of path.tiles) icon(MARKERS.pathDot, lx(t.x) + 6, ly(t.y) + 10);
      for (const t of path.swipes || EMPTY) icon(SWIPE_MARK, lx(t.x) + 2, ly(t.y) + 1); // ⚠: this step draws a Parting swipe
      const end = path.tiles[path.tiles.length - 1];
      if (end && Number.isFinite(path.cost) && Number.isFinite(path.of)) {
        const rows = textRows(`${path.cost} of ${path.of}`);
        ctx.drawImage(env.painter.grid(rows, null, 'base', { tag: 'overlay:words' }), lx(end.x) + 8 - (rows[0].length >> 1), ly(end.y) - 8);
      }
    }
    baked.plan = c;
  }

  function bakeAll() {
    genre = null;
    for (const u of board.units.values()) {
      const g = u.look?.kind === 'stray' ? (u.look.genres || [])[0] : null;
      if (g) { genre = g; break; }
    }
    if (!genre) {
      const r = board.arena.rect;
      genre = env.genreAt({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }) || null;
    }
    hiddenProps = new Set(board.objects.filter((o) => o.kind === 'prop').map((o) => `prop:${o.x},${o.y}`));
    bakeGrid();
    bakeShade();
    bakeSurfaces();
    bakePlan();
  }

  // ---------- the board as events land ----------

  // Every change the board draws comes as an event (§5.8, §18.3 item 2), each applied as B made it.
  function applyEvent(ev) {
    const u = typeof ev.unit === 'string' ? board.units.get(ev.unit) : null;
    const target = typeof ev.target === 'string' ? board.units.get(ev.target) : null;
    switch (ev.t) {
      case 'round':
        // B clears every Buffer as a round starts (and says so with `buffer` 0 events too).
        for (const v of board.units.values()) v.buffer = 0;
        break;
      case 'move': {
        const path = (Array.isArray(ev.path) ? ev.path : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
        if (u && path.length) {
          // B's facing: each step across turns the mover its way; a step straight up or down keeps it.
          for (const p of path) {
            if (p.x !== u.x) u.facing = p.x > u.x ? 'right' : 'left';
            u.x = p.x;
            u.y = p.y;
          }
        }
        break;
      }
      case 'damage': case 'patch': case 'bar': {
        const who = target || u;
        if (who) Object.assign(who, { integrity: ev.integrity ?? who.integrity, max: ev.max ?? who.max });
        // A lead's bar (cross-check 15): the bar it's on, and its phase from `phase`.
        if (ev.t === 'bar' && u && u.bar && Number.isFinite(ev.bar)) u.bar = { ...u.bar, bar: ev.bar };
        break;
      }
      case 'phase': if (u && u.bar && typeof ev.phase === 'string') u.bar = { ...u.bar, phase: ev.phase }; break;
      case 'condition':
        if (target) {
          // A count-down (on, with its new n) changes the badge where it stands; off takes it away.
          const at = target.conditions.findIndex((c) => c.id === ev.id);
          if (!ev.on) target.conditions = target.conditions.filter((c) => c.id !== ev.id);
          else if (at >= 0) target.conditions[at] = { id: ev.id, n: ev.n ?? null };
          else target.conditions.push({ id: ev.id, n: ev.n ?? null });
        }
        break;
      case 'heat': if (u) u.heat = Number(ev.heat) || 0; break;
      case 'buffer': if (u) u.buffer = Number(ev.buffer) || 0; break;
      // Going offline clears a hero's conditions and Buffer (B does it with no event of its own).
      case 'offline': if (u) Object.assign(u, { offline: true, buffer: 0, conditions: [] }); break;
      case 'reboot': if (u) u.offline = false; break;
      // Sorted, as B does it: no conditions, and a settled unit's Integrity at 0.
      case 'sorted': if (u) Object.assign(u, { sorted: ev.how || 'settled', gone: true, conditions: [] }, (ev.how || 'settled') === 'settled' ? { integrity: 0 } : {}); break;
      case 'gone': if (u) u.gone = true; break;
      // Examined: a Void stray's false target is drawn no more (its telegraphs point where it means).
      case 'reveal': if (u && ev.what === 'stats') u.examined = true; break;
      case 'spawn':
        if (ev.unit && typeof ev.unit === 'object' && typeof ev.unit.id === 'string') board.units.set(ev.unit.id, cleanUnit(ev.unit));
        if (ev.object && typeof ev.object === 'object') board.objects.push({ ...ev.object });
        break;
      case 'object': {
        const o = board.objects.find((it) => it.id === ev.object);
        if (o) o.state = ev.state;
        break;
      }
      case 'surface':
        for (const t of Array.isArray(ev.tiles) ? ev.tiles : []) {
          board.surfaces = board.surfaces.filter((s) => !(s.x === t.x && s.y === t.y));
          if (ev.on !== false) board.surfaces.push({ x: t.x, y: t.y, id: ev.id, rounds: ev.rounds ?? null });
        }
        bakeSurfaces();
        break;
      case 'light':
        board.lights = (Array.isArray(ev.lights) ? ev.lights : []).map((l) => ({ ...l }));
        bakeShade();
        break;
      case 'telegraphs': case 'end':
        // Newer than the planner's overlay: the board draws these (and their threats) from now on. A
        // fight that's over has no intents left (B clears them as it ends).
        board.telegraphs = ev.t === 'telegraphs' && Array.isArray(ev.list) ? ev.list.slice() : [];
        freshTelegraphs = true;
        break;
      default:
    }
  }

  const viewsOf = () => [...board.units.values()].map((u) => ({ ...u, sorted: u.gone ? u.sorted || 'settled' : null }));

  function finishOpening() {
    if (!opening) return;
    const done = opening;
    opening = null;
    done.resolve(true);
  }

  // Lands the board events due by the playback's clock (all of them with `all`), each once.
  function landDue(p, all = false) {
    const list = p.tl.events;
    while (p.next < list.length && (all || list[p.next].at <= p.clock)) {
      const { ev } = list[p.next];
      if (!p.landed.has(ev)) {
        p.landed.add(ev);
        applyEvent(ev);
      }
      p.next += 1;
    }
  }

  function finishPlay() {
    if (!play) return;
    const done = play;
    play = null;
    if (board) {
      landDue(done, true);
      for (const [id, f] of Object.entries(done.tl.final)) {
        const u = board.units.get(id);
        if (!u) continue;
        u.x = f.x;
        u.y = f.y;
        u.facing = f.facing;
        if (f.gone) u.gone = true;
      }
      // The planner's picture follows the landed board (its arrows start where the foes now stand).
      if (overlay) bakePlan();
    }
    for (const resolve of done.resolves) resolve();
  }

  function settleAll() {
    finishOpening();
    finishPlay();
  }

  // ---------- this draw's picture ----------

  function frameState(t) {
    const still = t === null;
    const anims = env.anims();
    const tl = play ? play.tl : opening ? opening.tl : null;
    const f = tl ? tl.at(play ? play.clock : opening.clock) : null;
    const units = [];
    for (const u of board.units.values()) {
      const s = f?.units[u.id];
      const base = u.offline ? 'dozing' : 'ready';
      let clip = s ? s.clip : base;
      let frame = s ? s.frame : 0;
      if (!s || BASES.has(clip)) {
        clip = s && BASES.has(s.clip) ? s.clip : base;
        frame = clipFrame(clipInfo(u.look, clip, anims), still ? null : idle + hashId(u.id), still);
      }
      const alpha = s ? s.alpha : u.gone ? 0 : 1;
      if (alpha <= 0) continue;
      const x = s ? s.x : u.x;
      const y = s ? s.y : u.y;
      units.push({ u, x, y, clip, frame, facing: s ? s.facing : u.facing, flash: s?.flash || null, feet: unitFeet(x, y, u.size), pose: null });
    }
    for (const it of units) it.pose = spriteOf(it, still);
    return { units, f, still, grid: f ? f.grid : 1 };
  }

  function feetOfStray(u) {
    const look = u.look;
    const sig = `${look.archetype}|${look.bodyKey}|${(look.parts || []).map((p) => p.id).join(',')}`;
    let known = strayFeet.get(u.id);
    if (!known || known.sig !== sig) {
      known = { sig, feet: restFeet({ archetype: look.archetype, bodyKey: look.bodyKey || 'r', parts: look.parts || [], size: 28 }) };
      strayFeet.set(u.id, known);
    }
    return known.feet;
  }

  /** What to draw for a combatant: { canvas, sx, sy, w, h (as drawn), rows, mirror, scale, shimmer }. */
  function spriteOf(it, still) {
    const { u } = it;
    const look = u.look || {};
    const tag = `cb:${u.id}`;
    const px = it.feet.x;
    const py = it.feet.y;
    if (look.kind === 'rig') {
      let frames = clipFrames(look, it.clip, it.facing);
      if (!frames.length) frames = clipFrames(look, 'ready', it.facing);
      const frame = frames[it.frame % Math.max(1, frames.length)];
      if (!frame) return null;
      const dress = frame.family ? env.dressAt(px, py - 1) : null;
      const outfit = dress ? outfitGrid(frame.family, frame.rows, { split: frame.split, wear: frame.wear }) : null;
      const canvas = outfit
        ? env.painter.grid(outfit.rows, null, `outfit:${dress}`, { mirror: frame.mirror, layers: outfit.layers, table2: TABLE(dress), tag })
        : env.painter.grid(frame.rows, null, 'base', { mirror: frame.mirror, tag });
      const hot = u.heat > 60;
      const shimmer = !still && u.side === 'party' && (u.heat > 30 || u.heat <= 15)
        ? { canvas: env.painter.grid(shimmerOutline(frame.rows, u.heat > 30), null, 'base', { mirror: frame.mirror, tag: 'shimmer' }), alpha: hot ? 0.6 : 0.35 } : null;
      const sy = Math.round(py - frame.feet[1]);
      return { canvas, sx: Math.round(px - frame.feet[0]), sy, top: sy + inkTop(frame.rows), w: frame.w, h: frame.h, rows: frame.rows, mirror: frame.mirror, scale: 1, shimmer };
    }
    if (look.kind === 'stray') {
      const info = clipInfo(look, it.clip, env.anims());
      const sprite = composeStray({ archetype: look.archetype, bodyKey: look.bodyKey || 'r', parts: look.parts || [], eyeKey: look.eyeKey ?? null, pose: info.pose || null, poseName: info.poseName || null, frame: it.frame, size: 28 });
      const feet = feetOfStray(u);
      const [g0, g1] = look.genres || [];
      const mirror = it.facing === 'left';
      const scale = look.scale === 2 || u.size === 2 ? 2 : 1;
      const canvas = env.painter.grid(sprite.rows, TABLE(g0), `${g0 || 'base'}|${g1 || g0 || 'base'}`, { mirror, layers: sprite.layers, table2: TABLE(g1 || g0), tag });
      const w = sprite.rows[0].length;
      const fx = mirror ? w - 1 - feet[0] : feet[0];
      const sy = Math.round(py - feet[1] * scale);
      return { canvas, sx: Math.round(px - fx * scale), sy, top: sy + inkTop(sprite.rows) * scale, w: w * scale, h: sprite.rows.length * scale, rows: sprite.rows, mirror, scale, shimmer: null };
    }
    let rows = null;
    let feet = null;
    if (look.kind === 'device') {
      const p = PROPS4[`device.${look.template}`];
      if (p) {
        rows = p.frames[still ? 0 : Math.floor(idle / 180) % p.frames.length];
        feet = p.feet;
      }
    } else if (look.kind === 'sprite' && SPRITES[look.name]) {
      // A sprite's second frame is its awake one (the Mimic's, chest.mimic): in a fight it's awake.
      const frames = SPRITES[look.name];
      rows = frames[Math.min(frames.length - 1, Number.isInteger(look.frame) ? look.frame : 1)];
      feet = [rows[0].length >> 1, rows.length - 1];
    }
    if (!rows) return null;
    const sy = Math.round(py - feet[1]);
    return { canvas: env.painter.grid(rows, null, 'base', { tag }), sx: Math.round(px - feet[0]), sy, top: sy + inkTop(rows), w: rows[0].length, h: rows.length, rows, mirror: false, scale: 1, shimmer: null };
  }

  const stateFor = (t) => {
    if (!cur || cur.t !== t || cur.version !== version) cur = { ...frameState(t), t, version };
    return cur;
  };
  let version = 0;
  const changed = () => { version += 1; };

  // ---------- the hooks ----------

  function ground(target, visible, t) {
    if (!board) return;
    const st = stateFor(t);
    const { rect } = board.arena;
    const ox = rect.x * TILE;
    const oy = rect.y * TILE;
    const [shake] = [shakeNow(st)];
    const x0 = ox + shake.dx;
    if (baked.surfaces.length && baked.surfaces[0]) target.drawImage(baked.surfaces[t === null ? 0 : Math.floor(idle / 420) % 3] || baked.surfaces[0], x0, oy);
    if (baked.shade) target.drawImage(baked.shade, x0, oy);
    if (baked.grid) {
      target.globalAlpha = st.grid;
      target.drawImage(baked.grid, x0, oy);
      target.globalAlpha = 1;
    }
    if (baked.plan && !play) target.drawImage(baked.plan, x0, oy);
    // Icons and markers carry one tag wherever they're drawn (the painter keeps the first it's given).
    const icon = (rows, x, y) => target.drawImage(env.painter.grid(rows, null, 'base', { tag: 'overlay:icon' }), Math.round(x), Math.round(y));
    // Rings under the chosen one and its targets; each side a shape (circle, diamond, square).
    const marks = new Map((overlay?.targets || EMPTY).map((id) => [id, MARKERS.target]));
    if (overlay?.selected) marks.set(overlay.selected, MARKERS.active);
    // While planning, everyone an area would catch gets its wedge (harm over help when both would).
    const caught = new Map();
    if (!play) for (const area of overlay?.areas || EMPTY) for (const id of area.caught || EMPTY) if (caught.get(id) !== 'harm') caught.set(id, area.kind === 'help' ? 'help' : 'harm');
    for (const it of st.units) {
      const ring = marks.get(it.u.id);
      if (ring) icon(ring, it.feet.x - 9 + shake.dx, it.feet.y - 3);
      if (!it.u.offline) icon(it.u.side === 'party' ? MARKERS.ally : it.u.side === 'neutral' ? MARKERS.neutral : MARKERS.foe, it.feet.x - 2 + shake.dx, it.feet.y + 1);
      const kind = caught.get(it.u.id);
      if (kind) icon(CAUGHT_MARKS[kind], it.feet.x + 4 + shake.dx, it.feet.y + 1);
    }
    if (overlay?.cursor && !play) {
      const c = overlay.cursor;
      target.fillStyle = RGBA('c', 0.95);
      const x = c.x * TILE;
      const y = c.y * TILE;
      for (const [dx, dy, w, h] of [[0, 0, 4, 1], [0, 0, 1, 4], [12, 0, 4, 1], [15, 0, 1, 4], [0, 15, 4, 1], [0, 12, 1, 4], [12, 15, 4, 1], [15, 12, 1, 4]]) target.fillRect(x + dx, y + dy, w, h);
    }
  }

  function shakeNow(st) {
    return st.f && st.f.shake ? st.f.shake : { dx: 0, dy: 0 };
  }

  function collect(drawables, target, visible, t, shadow) {
    if (!board) return;
    const st = stateFor(t);
    const sh = shakeNow(st);
    for (const o of board.objects) {
      const rows = o.kind === 'prop' ? PROPS4[o.state]?.frames[0] || null : propFrame(o.kind, o.state);
      if (!rows) continue;
      const p = o.kind === 'prop' ? PROPS4[o.state] : PROPS4[o.kind] || PROPS4[`device.${o.kind}`];
      const feet = p ? p.feet : [rows[0].length >> 1, rows.length - 1];
      const bx = o.x * TILE + 8 + sh.dx;
      const by = (o.y + 1) * TILE - 1;
      const sx = Math.round(bx - feet[0]);
      const sy = Math.round(by - feet[1]);
      if (!visible(sx, sy, rows[0].length, rows.length)) continue;
      const canvas = env.painter.grid(rows, TABLE(genre), genre || 'base', { tag: `cb:${o.id}` });
      drawables.push({ y: by, x: bx, draw: () => target.drawImage(canvas, sx, sy) });
    }
    for (const it of st.units) {
      const p = it.pose;
      if (!p || !visible(p.sx, p.sy, p.w, p.h)) continue;
      const large = p.scale === 2;
      shadow(it.feet.x + sh.dx, it.feet.y, large ? 20 : it.u.look?.kind === 'rig' ? 10 : 10, large ? 5 : 3, 0);
      drawables.push({
        y: it.feet.y + 0.4,
        x: it.feet.x,
        draw: () => {
          if (p.shimmer) {
            target.globalAlpha = p.shimmer.alpha;
            target.drawImage(p.shimmer.canvas, p.sx + sh.dx, p.sy);
            target.globalAlpha = 1;
          }
          if (large) target.drawImage(p.canvas, p.sx + sh.dx, p.sy, p.w, p.h);
          else target.drawImage(p.canvas, p.sx + sh.dx, p.sy);
        },
      });
    }
  }

  function above(target, visible, t, view) {
    if (!board) return;
    const st = stateFor(t);
    const anims = env.anims();
    const sh = shakeNow(st);
    // Numbers are tagged 'num'; icons, badges and flashes 'overlay:icon', as everywhere else.
    const grid = (rows) => env.painter.grid(rows, null, 'base', { tag: 'overlay:icon' });
    const num = (rows) => env.painter.grid(rows, null, 'base', { tag: 'num' });
    const pos = new Map(st.units.map((it) => [it.u.id, it]));
    // Telegraph icons over each foe (a hidden intent as '?'), and condition badges with their numbers.
    const telegraphs = telegraphsNow();
    const byUnit = new Map();
    for (const tg of telegraphs || EMPTY) {
      if (!byUnit.has(tg.unitId)) byUnit.set(tg.unitId, []);
      byUnit.get(tg.unitId).push(tg);
    }
    for (const it of st.units) {
      if (!it.pose) continue;
      const top = it.pose.top - 1;
      const list = (byUnit.get(it.u.id) || EMPTY).slice(0, 3);
      list.forEach((tg, i) => {
        const rows = INTENT_ICONS[tg.hidden ? 'hidden' : tg.icon] || INTENT_ICONS.hidden;
        target.drawImage(grid(rows), Math.round(it.feet.x - 4 - (list.length - 1) * 5 + i * 10 + sh.dx), top - 9);
      });
      const conds = it.u.conditions.slice(0, 3);
      conds.forEach((c, i) => {
        const rows = CONDITION_ICONS[c.id];
        if (!rows) return;
        const x = Math.round(it.feet.x - 7 - (conds.length - 1) * 7 + i * 14 + sh.dx);
        const y = top - (list.length ? 19 : 9);
        target.drawImage(grid(rows), x, y);
        if (c.n !== null && c.n !== undefined) target.drawImage(num(numberRows(String(c.n))), x + NUMBER_SLOT.x, y + NUMBER_SLOT.y);
      });
    }
    const f = st.f;
    if (f) {
      for (const e of f.effects) {
        const rows = e.projectile ? projectileFrame(PROJECTILE_FOR[e.projectile] || e.projectile || 'mote', e.frame, e.dir) : effectFrame(e.effect, e.frame, { anims });
        if (!rows) continue;
        const cx = e.x * TILE + 8 + sh.dx;
        const cy = e.y * TILE + (e.projectile ? 2 : 4);
        const canvas = env.painter.grid(rows, TABLE(genre), genre || 'base', { tag: 'fx' });
        target.drawImage(canvas, Math.round(cx - rows[0].length / 2), Math.round(cy - rows.length / 2));
      }
      for (const it of st.units) {
        if (!it.flash || !it.pose) continue;
        const rows = FLASHES[it.flash.kind]?.[it.flash.frame];
        if (rows) target.drawImage(grid(rows), Math.round(it.feet.x - 4 + sh.dx), it.pose.top - 4);
      }
      for (const m of f.marks) {
        const it = pos.get(m.unit);
        if (!it || !it.pose) continue;
        const rows = m.kind === 'feint' ? MARKERS.feint : THOUGHT_ICONS[m.picture];
        if (rows) target.drawImage(grid(rows), Math.round(it.feet.x - (rows[0].length >> 1)), it.pose.top - 9);
      }
      for (const n of f.numbers) {
        const it = pos.get(n.unit);
        const rows = numberRows(n.text, { size: n.size, fill: n.fill, star: n.star });
        const cx = it ? it.feet.x : n.x * TILE + 8;
        const top = it && it.pose ? it.pose.top - 2 : n.y * TILE - 8;
        target.globalAlpha = n.alpha;
        target.drawImage(num(rows), Math.round(cx - rows[0].length / 2 + sh.dx), Math.round(top - rows.length - n.dy));
        target.globalAlpha = 1;
      }
      if (f.flash > 0 && view) {
        target.globalAlpha = f.flash;
        target.fillStyle = PALETTE.o.hex;
        target.fillRect(view.x, view.y, view.w + 1, view.h + 1);
        target.globalAlpha = 1;
      }
    }
  }

  // ---------- entities ----------

  function entityOf(it) {
    const u = it.u;
    const x = Math.round(it.x);
    const y = Math.round(it.y);
    return { kind: 'combatant', id: `cb:${u.id}`, x, y, label: u.name, side: u.side, approach: { x, y } };
  }

  function hit(ax, ay, t, opaque) {
    if (!board) return null;
    const st = stateFor(t);
    const hits = [];
    for (const it of st.units) {
      const p = it.pose;
      if (!p) continue;
      if (ax < p.sx - 1 || ay < p.sy - 1 || ax >= p.sx + p.w + 1 || ay >= p.sy + p.h + 1) continue;
      const px = Math.floor((ax - p.sx) / p.scale);
      const py = Math.floor((ay - p.sy) / p.scale);
      const w = p.rows[0].length;
      // Its own tile(s) count too, so a small or thin sprite is easy to click.
      const tx = Math.floor(ax / TILE) - Math.round(it.x);
      const ty = Math.floor(ay / TILE) - Math.round(it.y);
      const onTile = tx >= 0 && ty >= 0 && tx < it.u.size && ty < it.u.size;
      if (onTile || opaque(p.rows, p.mirror ? w - 1 - px : px, py)) hits.push({ y: it.feet.y, it });
    }
    hits.sort((a, b) => b.y - a.y);
    return hits.length ? entityOf(hits[0].it) : null;
  }

  function entities(rect, t) {
    if (!board) return [];
    const st = stateFor(t);
    return st.units.filter((it) => {
      const x = Math.round(it.x);
      const y = Math.round(it.y);
      return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    }).map(entityOf);
  }

  // ---------- the calls ----------

  const motionOf = () => env.motion();

  function start(view) {
    settleAll();
    const next = boardOf(view);
    if (!next) return Promise.resolve(false);
    board = next;
    overlay = null;
    idle = 0;
    bakeAll();
    changed();
    const noticed = board.noticed || [...board.units.values()].filter((u) => u.side === 'foe' && !u.gone).map((u) => u.id);
    const tl = timeline([], { units: viewsOf(), anims: env.anims(), rules: env.rules(), motion: motionOf(), opening: noticed });
    if (tl.duration <= 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      opening = { tl, clock: 0, resolve };
      env.wake();
    });
  }

  function sync(view) {
    settleAll();
    const next = boardOf(view);
    if (!next) return false;
    board = next;
    freshTelegraphs = true;
    bakeAll();
    changed();
    return true;
  }

  /**
   * Plays events on the board. A call while a playback still runs (with the same motion and fastFoes)
   * adds its events to it from now on, so steps played one call each as they resolve still move a
   * kind's strays in one tick as one beat; a new speed carries on from the same point, with no jump.
   * Every call's promise settles when the whole playback ends.
   */
  function playEvents(events, { speed = 1, fastFoes = true } = {}) {
    if (!board) return Promise.resolve();
    finishOpening();
    const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e.t === 'string');
    const motion = motionOf();
    const opts = (views, from = null) => ({ units: views, abilities: board.abilities, anims: env.anims(), rules: env.rules(), motion, speed, fastFoes, from });
    if (play && play.fastFoes === fastFoes && play.motion === motion) {
      // Rebuilt from the same starting views: what's playing keeps its place (at a new speed, the same
      // point of the round, playing on from there quicker or slower), and the new events start now.
      // Every addition keeps its own hold (raw ms, before the pace) for the rest of the playback, so a
      // late joiner held to the moment it came is still held there when the next call or speed comes.
      const all = play.events.concat(list);
      const raw = play.tl.timeAt(play.clock) * paceOf(play.speed);
      const at = raw / paceOf(speed);
      if (list.length) play.holds.push({ index: play.events.length, raw });
      play.tl = timeline(all, opts(play.views, play.holds.map((h) => ({ index: h.index, at: h.raw / paceOf(speed) }))));
      if (paceOf(speed) !== paceOf(play.speed)) play.clock = play.tl.wallAt(at);
      play.events = all;
      play.speed = speed;
      play.next = 0;
      while (play.next < play.tl.events.length && play.landed.has(play.tl.events[play.next].ev)) play.next += 1;
      changed();
      return new Promise((resolve) => play.resolves.push(resolve));
    }
    finishPlay();
    const views = viewsOf();
    const tl = timeline(list, opts(views));
    const entry = { tl, clock: 0, next: 0, landed: new Set(), events: list, holds: [], views, speed, fastFoes, motion, resolves: [] };
    if (tl.duration <= 0) {
      play = entry;
      finishPlay();
      changed();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      entry.resolves.push(resolve);
      play = entry;
      changed();
      env.wake();
    });
  }

  function update(dt) {
    if (!board) return false;
    idle += dt;
    if (opening) {
      opening.clock += dt;
      if (opening.clock >= opening.tl.duration) finishOpening();
    }
    if (play) {
      play.clock += dt;
      landDue(play);
      if (play.clock >= play.tl.duration) finishPlay();
    }
    changed();
    return !!(opening || play);
  }

  function setOverlay(next) {
    overlay = next && typeof next === 'object' ? { ...next } : null;
    freshTelegraphs = false;
    if (board) bakePlan();
    changed();
  }

  function end() {
    settleAll();
    board = null;
    overlay = null;
    baked.grid = null;
    baked.shade = null;
    baked.surfaces = [];
    baked.plan = null;
    hiddenProps = new Set();
    cur = null;
    changed();
  }

  return {
    start,
    sync,
    play: playEvents,
    overlay: setOverlay,
    end,
    running: () => !!board,
    /** The fight's board as a startCombat view (for a benchmark to put back), with the overlay. */
    snapshot: () => (board ? { view: { arena: board.arena, units: viewsOf(), objects: board.objects, surfaces: board.surfaces, lights: board.lights, telegraphs: board.telegraphs, abilities: board.abilities }, overlay } : null),
    /** Where the camera looks when the arena doesn't fit: the tile cursor, else the selected unit. */
    focus() {
      if (!board || !overlay) return null;
      if (overlay.cursor && Number.isFinite(overlay.cursor.x)) return { x: overlay.cursor.x, y: overlay.cursor.y };
      const u = overlay.selected ? board.units.get(overlay.selected) : null;
      return u ? { x: u.x, y: u.y } : null;
    },
    shake: () => (cur && cur.f ? cur.f.shake : { dx: 0, dy: 0 }),
    unit: (id) => (board?.units.get(id) ? { ...board.units.get(id) } : null),
    /** The fight's own lights (the Hooklight, lamps), for the night sky to let through (world px). */
    lights: () => (board ? board.lights.map((l) => ({ x: l.x * TILE + 8, y: l.y * TILE + 8, r: Math.max(8, (Number(l.radius) || 1) * TILE), alpha: 0.7 })) : []),
    arena: () => (board ? { ...board.arena.rect } : null),
    // the layer
    update,
    busy: () => !!(opening || play),
    settle: settleAll,
    ground,
    collect,
    above,
    // Intents, badges, numbers and marks draw after the night's tint, so they read as clearly at night.
    aboveSky: true,
    hit,
    entities,
    hidden: (id) => !!board && (id === 'milo' || id.startsWith('party:') || hiddenProps.has(id)),
    dispose() {
      settleAll();
      board = null;
    },
  };
}

// ---------- the camera and the pointer (pure, for the engine) ----------

/**
 * Where the camera's top-left goes (world px) to frame a fight's arena (§11.3 frameArena): centred in
 * the free rect the four insets leave (left, top, freeW, freeH, in world px). When it doesn't fit,
 * the view follows `focus` (the tile cursor or the selected unit, combat.focus()), kept on the arena.
 * In an Elsewhere (`scene`: its size, the right and bottom insets and the view) the view stays on the
 * scene, but may run under every inset; a scene smaller than the view on an axis keeps the arena centred.
 */
export function arenaCamera(rect, { left = 0, top = 0, freeW, freeH, focus = null, scene = null }) {
  const [ax, ay, aw, ah] = [rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE];
  const fits = aw <= freeW && ah <= freeH;
  const c = !fits && focus ? unitFeet(focus.x, focus.y) : { x: ax + aw / 2, y: ay + ah / 2 };
  const within = (v, lo, hi) => (lo > hi ? v : Math.max(lo, Math.min(hi, v)));
  let x = c.x - left - freeW / 2;
  let y = c.y - top - freeH / 2;
  if (!fits) {
    x = within(x, ax - left, ax + aw - left - freeW);
    y = within(y, ay - top, ay + ah - top - freeH);
  }
  if (scene) {
    x = within(x, -left, scene.w - scene.viewW + scene.right);
    y = within(y, -top, scene.h - scene.viewH + scene.bottom);
  }
  return { x, y };
}

/** What a pointer at world pixel (ax, ay) means in a fight: its tile, and the combatant hit (its unit id), if any. */
export function pointerTarget(hit, ax, ay) {
  const unitId = hit && hit.entity && hit.entity.kind === 'combatant' ? hit.entity.id.slice(3) : null;
  return { tile: { x: Math.floor(ax / TILE), y: Math.floor(ay / TILE) }, unitId };
}

// ---------- a synthetic fight, for the benchmark and the preview ----------

/**
 * world.benchmark({ frames, actors })'s loop (§11.3, §15): puts benchView's fight round `centre` on the
 * layer, draws a warm-up then `frames` frames with drawFrame(t) (idle loops running), times each, and
 * puts back whatever fight was there (a playback still running jumps to its end first, as a settle
 * does). → { frames, actors, median, p90, mean, max } (ms).
 */
export function benchCombat(layer, { centre, frames = 200, actors = 16, now, step = 1000 / 30, drawFrame, warm = 60 }) {
  // A playback in hand lands in full first (its promise settles), so the fight put back is whole.
  layer.settle();
  const saved = layer.snapshot();
  const bench = benchView(centre, { actors });
  layer.sync(bench.view);
  layer.overlay(bench.overlay);
  const times = [];
  let t = now();
  try {
    for (let i = 0; i < warm + frames; i += 1) {
      t += step;
      const started = now();
      layer.update(step, t);
      drawFrame(t);
      // After the warm-up (every canvas made, the GPU awake), each frame's time.
      if (i >= warm) times.push(now() - started);
    }
  } finally {
    if (saved) {
      layer.sync(saved.view);
      layer.overlay(saved.overlay);
    } else layer.end();
  }
  const sorted = [...times].sort((a, b) => a - b);
  const q = (k) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * k))] || 0;
  return { frames: times.length, actors: bench.view.units.length, median: q(0.5), p90: q(0.9), mean: times.reduce((a, b) => a + b, 0) / Math.max(1, times.length), max: sorted[sorted.length - 1] || 0 };
}

const BENCH_ARCHETYPES = ['walker', 'floater', 'crawler', 'flier', 'ghost', 'construct'];

/**
 * A startCombat view with `actors` combatants (by default 16: four heroes, eight strays, a lead at
 * 2×, a guest and two devices) round `centre` (tiles) on a 16×12 arena, with surfaces, a light,
 * props, conditions and telegraphs, and an overlay to go with it: what world.benchmark times and
 * the preview shows. Synthetic: no rift, no save, nothing real.
 */
export function benchView(centre, { actors = 16, genre = 'neon', second = 'nocturne' } = {}) {
  const rect = { x: Math.round(centre.x) - 8, y: Math.round(centre.y) - 6, w: 16, h: 12 };
  const n = rect.w * rect.h;
  const cells = Array.from({ length: n }, (_, i) => (i === 3 * rect.w + 9 || i === 7 * rect.w + 5 ? 'o' : '.')).join('');
  const light = Array.from({ length: n }, (_, i) => (i % rect.w < 4 ? 'd' : i % rect.w > 12 ? 'D' : 'L')).join('');
  const at = (dx, dy) => ({ x: rect.x + dx, y: rect.y + dy });
  const parts = Object.keys(PARTS);
  const heroes = [
    { id: 'milo', look: { kind: 'rig', rig: 'coat', who: 'milo', likeness: null }, name: 'Milo' },
    { id: 'claude', look: { kind: 'rig', rig: 'robe', who: 'claude', likeness: null }, name: 'The Scribe' },
    { id: 'codex', look: { kind: 'rig', rig: 'robe', who: 'codex', likeness: null }, name: 'The Artificer' },
    { id: 'jev', look: { kind: 'rig', rig: 'jev', who: 'jev', likeness: null }, name: 'Jev' },
  ];
  const units = [];
  const base = { rank: 'hero', talkKind: null, size: 1, integrity: 20, max: 24, buffer: 0, offline: false, sorted: null, bar: null };
  heroes.slice(0, Math.max(1, Math.min(4, actors))).forEach((h, i) => units.push({ ...base, ...h, side: 'party', ...at(2 + (i % 2), 4 + i * 1), facing: 'right', heat: [20, 45, 75, 10][i], conditions: i === 1 ? [{ id: 'brisk', n: null }] : [] }));
  // Four more (the lead, a guest and two devices) from 12 actors; the rest are strays, eight at most.
  const extras = actors >= 12 ? 4 : 0;
  const foes = Math.max(0, Math.min(8, actors - units.length - extras));
  for (let i = 0; i < foes; i += 1) {
    units.push({
      ...base, id: `f${i}`, side: 'foe', rank: i === 7 ? 'elite' : 'stray', talkKind: `k${i % 3}`, name: `Stray ${i + 1}`,
      look: { kind: 'stray', archetype: BENCH_ARCHETYPES[i % 6], bodyKey: ['r', 'e', 'k'][i % 3], parts: [{ id: parts[(i * 5) % parts.length], layer: 0 }, { id: parts[(i * 5 + 2) % parts.length], layer: i % 2 }], eyeKey: null, genres: [genre, i % 2 ? second : null], scale: 1 },
      ...at(9 + (i % 3) * 2, 2 + Math.floor(i / 3) * 3), facing: 'left', heat: 30 + i * 5, conditions: i % 3 === 0 ? [{ id: 'spooked', n: 1 }, { id: 'soaked', n: null }] : [],
    });
  }
  if (extras) {
    units.push({ ...base, id: 'lead', side: 'foe', rank: 'lead', name: 'The Tale-lead', size: 2, look: { kind: 'stray', archetype: 'walker', bodyKey: 'e', parts: parts.slice(0, 4).map((id) => ({ id, layer: 0 })), eyeKey: null, genres: [genre, null], scale: 2 }, ...at(12, 8), facing: 'left', heat: 50, conditions: [], bar: { phase: 'opening', bar: 0, bars: [40, 40] } });
    units.push({ ...base, id: 'tollkeeper', side: 'party', name: 'The Tollkeeper', look: { kind: 'rig', rig: 'toll', who: 'tollkeeper', likeness: null }, ...at(4, 9), facing: 'right', heat: 25, conditions: [] });
    units.push({ ...base, id: 'd0', side: 'party', rank: 'device', name: 'Drone', look: { kind: 'device', template: 'drone' }, ...at(5, 3), facing: 'right', heat: 0, conditions: [] });
    units.push({ ...base, id: 'd1', side: 'party', rank: 'device', name: 'Turret', look: { kind: 'device', template: 'turret' }, ...at(5, 7), facing: 'right', heat: 0, conditions: [] });
  }
  const view = {
    arena: { rect, cells, height: '0'.repeat(n), light, mouths: [], entry: [at(2, 4), at(3, 5), at(2, 6), at(3, 7)], seed: 1 },
    units: units.slice(0, Math.max(0, actors)),
    objects: [{ id: 'o0', kind: 'prop', x: rect.x + 9, y: rect.y + 3, state: 'crate', flags: ['cover-low'], integrity: null }, { id: 'o1', kind: 'lamp', x: rect.x + 7, y: rect.y + 1, state: 'lit', flags: [], integrity: null }],
    surfaces: [0, 1, 2].flatMap((dx) => [0, 1].map((dy) => ({ ...at(6 + dx, 8 + dy), id: 'neon-puddle', rounds: null }))),
    lights: [{ id: 'hooklight', ...at(2, 4), radius: 3, rounds: null, source: 'milo' }],
    telegraphs: units.filter((u) => u.side === 'foe').map((u, i) => ({ unitId: u.id, slot: 0, tick: 1, icon: ['strike', 'bite', 'shoot', 'cast'][i % 4], words: 'Bite Milo', targets: ['milo'], tiles: [], hidden: i === 2, falseTarget: null, adapting: null, aside: false })),
  };
  const reach = [];
  for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) if (Math.abs(dx) + Math.abs(dy) <= 3) reach.push(at(2 + dx + 3, 4 + dy));
  const overlay = {
    reachable: reach.filter((t) => inRect(rect, t.x, t.y)),
    path: { tiles: [at(3, 4), at(4, 4), at(5, 4), at(6, 4)], cost: 4, of: 5, swipes: [at(6, 4)] },
    areas: [{ tiles: [0, 1, 2].flatMap((dx) => [0, 1, 2].map((dy) => at(9 + dx, 2 + dy))), kind: 'harm', caught: ['f0', 'f1'] }],
    threats: [at(3, 4), at(3, 5)],
    cover: [{ ...at(9, 3), level: 1 }],
    selected: 'milo',
    targets: ['f0'],
    cursor: at(6, 4),
  };
  return { view, overlay };
}
