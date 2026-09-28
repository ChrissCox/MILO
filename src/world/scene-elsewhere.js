// Inside a rift (CONTRACT-PHASE3.md §7.3, §7.4 and §13): the Elsewhere as the engine shows it.
// elsewhere.js builds the pocket world (its ground in key codes, its objects and strays); this
// module turns it into a canvas, walks it, draws its objects and strays dressed in the genre that
// holds the ground they stand on, and answers clicks, hover and Enter.
//
// Scene coordinates: tile (0, 0) is the scene's top-left; world px = tile × 16 as everywhere.
import { buildElsewhere } from './elsewhere.js';
import { tearArt, tearFrameAt, sealArt, spriteTable, genreIndex, ANIMATION_MS } from './riftfx.js';
import { SPRITES } from './sprites.js';

const TILE = 16;
const FEET = 13;
const OBJECT_SHADOWS = { exit: [16, 3, -1], loot: [14, 4, -1], curio: [10, 3, -1], foliage: [14, 4, -1] };
const hashId = (text) => {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 9000;
};

/**
 * Where a walk to (tx, ty) may end, as every path here and the world's nav pick it: the tile
 * itself, or (when it can't be stood on) the nearest ring of walkable tiles within 3, closest by
 * Manhattan distance. [] when there is nowhere.
 */
export function walkGoals(walkable, tx, ty) {
  if (walkable(tx, ty)) return [{ x: tx, y: ty }];
  for (let r = 1; r <= 3; r += 1) {
    const ring = [];
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && walkable(tx + dx, ty + dy)) ring.push({ x: tx + dx, y: ty + dy });
    if (ring.length) {
      const d = (p) => Math.abs(p.x - tx) + Math.abs(p.y - ty);
      const best = Math.min(...ring.map(d));
      return ring.filter((p) => d(p) === best);
    }
  }
  return [];
}

/**
 * Breadth-first path over a scene's walkable tiles, four ways: the tiles after `from`, ending at
 * `to` or (when `to` can't be stood on) the nearest walkable tile within 3 of it. [] when there is
 * no way or Milo is already there.
 */
export function scenePath(walkable, w, h, from, to) {
  if (!from || !to) return [];
  const fx = Math.round(from.x);
  const fy = Math.round(from.y);
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  if (![fx, fy, tx, ty].every(Number.isFinite)) return [];
  const goals = walkGoals(walkable, tx, ty);
  if (!goals.length || goals.some((g) => g.x === fx && g.y === fy)) return [];
  if (fx < 0 || fy < 0 || fx >= w || fy >= h) return [];
  const goal = new Set(goals.map((g) => g.y * w + g.x));
  const prev = new Int32Array(w * h).fill(-2);
  const start = fy * w + fx;
  prev[start] = -1;
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head];
    if (goal.has(i)) {
      const path = [];
      for (let node = i; node !== start; node = prev[node]) path.push({ x: node % w, y: Math.floor(node / w) });
      return path.reverse();
    }
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (prev[j] !== -2 || !walkable(nx, ny)) continue;
      prev[j] = i;
      queue.push(j);
    }
  }
  return [];
}

/**
 * createElsewhereScene({ rift, genres, words, riftgen, painter, makeCanvas, base, art, visited })
 * → the scene the engine draws while Milo is inside `rift`.
 */
export function createElsewhereScene({ rift, genres, words = null, riftgen, painter, makeCanvas, base, art, visited = false }) {
  const spec = rift.spec;
  const index = genreIndex(genres);
  const layout = riftgen.layout(spec);
  const kind = rift.kind === 'real' || rift.kind === 'story' || rift.kind === 'wild' ? rift.kind : null;
  const scene = buildElsewhere(spec, layout, { genres, kind, words });
  const { w, h, width, height } = scene;

  // The ground, in the genres' own colours (a patchwork in a fusion).
  const canvas = makeCanvas(width, height);
  {
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    image.data.set(scene.rgba(base));
    ctx.putImageData(image, 0, 0);
    canvas._milo = `elsewhere:${spec.id}`;
  }
  // What lies past the scene's edge: the void between the pages, in the first genre's ink.
  const firstTable = spriteTable(index.get(scene.palettes[0]) || null);
  const ink = firstTable.o || [61, 64, 56];
  const background = `rgb(${ink[0]},${ink[1]},${ink[2]})`;

  const tables = new Map();
  const tableFor = (id) => {
    if (!tables.has(id)) tables.set(id, spriteTable(index.get(id) || null));
    return tables.get(id);
  };
  const genreAt = (px, py) => scene.genreAt(px, py);
  let opened = !!visited;
  let sealing = null; // { at }
  let sealed = false;

  const objects = scene.objects.map((o) => {
    const p = { ...o };
    if (o.kind === 'stitch' || o.kind === 'tale-lead') {
      p.feetX = o.x * TILE + 8 + (o.dx || 0);
      p.feetY = o.y * TILE + FEET + (o.dy || 0);
      return p;
    }
    const name = o.kind === 'foliage' ? o.sprite : o.sprite;
    const rows = SPRITES[name] ? SPRITES[name][0] : null;
    if (!rows) return null;
    p.name = name;
    p.baseX = (o.x + 0.5) * TILE + (o.dx || 0);
    p.baseY = (o.y + 1) * TILE + (o.dy || 0);
    p.sw = rows[0].length;
    p.sh = rows.length;
    p.sx = Math.round(p.baseX - p.sw / 2);
    p.sy = Math.round(p.baseY - p.sh);
    p.phase = hashId(o.id) * 1.3;
    return p;
  }).filter(Boolean);

  function frameOf(p, t) {
    if (p.kind === 'loot') return opened ? 1 : 0;
    if (p.name === 'reeds' && t !== null) return (t + p.phase) % 5200 < 600 ? 1 : 0;
    return 0;
  }

  function objectCanvas(p, t) {
    const rows = art.gridFor(p.name, frameOf(p, t));
    if (p.native) return { rows, canvas: null };
    const genre = genreAt(p.baseX, p.baseY - 1);
    return { rows, canvas: genre ? painter.grid(rows, tableFor(genre), genre) : null };
  }

  function leadCanvas(p) {
    return painter.grid(p.sprite.rows, tableFor(p.genre), p.genre, { layers: p.sprite.layers || null, table2: tableFor(p.genre), tag: 'tale-lead' });
  }

  function strayPose(s, t) {
    const pos = s.positionAt(t);
    const mirror = pos.dir === 'left';
    const g0 = s.genre;
    const g1 = s.second || s.genre;
    const canvas = painter.grid(s.sprite.rows, tableFor(g0), `${g0}|${g1}`, { mirror, layers: s.sprite.layers || null, table2: tableFor(g1), tag: `stray:${s.id}` });
    const sw = s.sprite.rows[0].length;
    const sh = s.sprite.rows.length;
    const fx = mirror ? sw - 1 - s.feet.x : s.feet.x;
    const bob = s.hover && t !== null && Math.floor((t + hashId(s.id)) / 520) % 2 === 0 ? -1 : 0;
    return { x: pos.x, y: pos.y, canvas, sx: Math.round(pos.x - fx), sy: Math.round(pos.y - s.feet.y + bob), w: sw, h: sh, mirror };
  }

  function tearFor(p, t) {
    const genre = index.get(p.genre) || null;
    const art2 = tearArt(p.stage, genre, tearFrameAt(t, hashId(spec.id)));
    return { art: art2, canvas: painter.art(art2, `tear:${spec.id}`), sx: Math.round(p.feetX - art2.anchor.x), sy: Math.round(p.feetY - art2.anchor.y) };
  }

  const sealCache = new Map();
  /** Objects and strays into drawables (shadows drawn at once). */
  function collect(drawables, target, visible, t, shadow) {
    for (const p of objects) {
      if (p.kind === 'stitch') {
        if (sealed) continue;
        // A still frame (motion switched off part way through the seal): it's stitched, so it's
        // shut, as seal(null) has it.
        if (sealing && t === null) {
          sealed = true;
          continue;
        }
        if (sealing) {
          const prog = Math.min(1, (t - sealing.at) / ANIMATION_MS.seal);
          if (prog >= 1) {
            sealed = true;
            continue;
          }
          const step = Math.min(24, Math.floor(prog * 24));
          if (!sealCache.has(step)) sealCache.set(step, painter.art(sealArt(p.stage, index.get(p.genre) || null, step / 24), 'seal'));
          const base0 = tearArt(p.stage, index.get(p.genre) || null, 0);
          const c = sealCache.get(step);
          drawables.push({ y: p.feetY, x: p.feetX, draw: () => target.drawImage(c, Math.round(p.feetX - base0.anchor.x), Math.round(p.feetY - base0.anchor.y)) });
          continue;
        }
        const tear = tearFor(p, t);
        if (!visible(tear.sx, tear.sy, tear.art.w, tear.art.h)) continue;
        shadow(p.feetX, p.feetY, 8, 2, 0);
        drawables.push({ y: p.feetY, x: p.feetX, draw: () => target.drawImage(tear.canvas, tear.sx, tear.sy) });
        continue;
      }
      if (p.kind === 'tale-lead') {
        const c = leadCanvas(p);
        const scale = p.scale || 2;
        const fw = p.sprite.rows[0].length * scale;
        const fh = p.sprite.rows.length * scale;
        const sx = Math.round(p.feetX - p.feet.x * scale);
        const sy = Math.round(p.feetY - p.feet.y * scale - (t !== null && Math.floor((t + 300) / 700) % 2 === 0 ? 1 : 0));
        if (!visible(sx, sy, fw, fh)) continue;
        shadow(p.feetX, p.feetY, 20, 5, 0);
        drawables.push({ y: p.feetY, x: p.feetX, draw: () => target.drawImage(c, sx, sy, fw, fh) });
        continue;
      }
      if (!visible(p.sx, p.sy, p.sw, p.sh + 8)) continue;
      const sh = OBJECT_SHADOWS[p.kind];
      if (sh && !(p.kind === 'foliage' && p.name === 'reeds')) shadow(p.baseX, p.baseY, sh[0], sh[1], sh[2]);
      const frame = frameOf(p, t);
      const { canvas: c } = objectCanvas(p, t);
      drawables.push({ y: p.baseY, x: p.baseX, draw: c ? () => target.drawImage(c, p.sx, p.sy) : () => art.drawSprite(target, p.name, frame, p.sx, p.sy) });
    }
    for (const s of scene.strays) {
      const pose = strayPose(s, t);
      if (!visible(pose.sx, pose.sy, pose.w, pose.h)) continue;
      shadow(pose.x, pose.y, s.hover ? 6 : 10, s.hover ? 2 : 3, 0);
      drawables.push({ y: pose.y, x: pose.x, draw: () => target.drawImage(pose.canvas, pose.sx, pose.sy) });
    }
  }

  // ---------- entities ----------

  function objectEntity(p) {
    const entity = { kind: p.kind, id: p.id, x: p.x, y: p.y, label: p.label, riftId: spec.id, approach: { ...p.approach } };
    if (p.kind === 'stitch') entity.refused = !!p.refused;
    if (p.kind === 'loot' && opened) entity.label = 'An open chest';
    if (p.kind === 'tale-lead') entity.label = p.name || p.label;
    return entity;
  }
  function strayEntity(s, t) {
    const pos = s.positionAt(t);
    const x = Math.floor(pos.x / TILE);
    const y = Math.floor((pos.y - FEET + 8) / TILE);
    const near = [[0, 0], [0, 1], [-1, 0], [1, 0], [0, -1]].map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((tile) => scene.walkable(tile.x, tile.y));
    return { kind: 'stray', id: s.id, x, y, label: s.council ? `${s.name} · the council` : s.name, riftId: spec.id, approach: near || { x, y } };
  }
  const clickable = () => objects.filter((p) => !p.scenery && !(p.kind === 'stitch' && (sealed || sealing)));

  function entities(rect, t) {
    const inside = (x, y) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    const out = clickable().filter((p) => inside(p.x, p.y)).map(objectEntity);
    for (const s of scene.strays) {
      const e = strayEntity(s, t);
      if (inside(e.x, e.y)) out.push(e);
    }
    return out;
  }

  function hit(ax, ay, t, opaque) {
    const hits = [];
    for (const s of scene.strays) {
      const pose = strayPose(s, t);
      if (ax < pose.sx - 1 || ay < pose.sy - 1 || ax >= pose.sx + pose.w + 1 || ay >= pose.sy + pose.h + 1) continue;
      const px = Math.floor(ax - pose.sx);
      if (opaque(s.sprite.rows, pose.mirror ? pose.w - 1 - px : px, Math.floor(ay - pose.sy))) hits.push({ y: pose.y + 0.1, e: () => strayEntity(s, t) });
    }
    for (const p of clickable()) {
      if (p.kind === 'stitch') {
        const tear = tearFor(p, t);
        const b = tear.art.body;
        if (ax >= tear.sx + b.x - 3 && ax < tear.sx + b.x + b.w + 3 && ay >= tear.sy + b.y - 3 && ay < tear.sy + b.y + b.h + 3) hits.push({ y: p.feetY, e: () => objectEntity(p) });
        continue;
      }
      if (p.kind === 'tale-lead') {
        const scale = p.scale || 2;
        const sx = p.feetX - p.feet.x * scale;
        const sy = p.feetY - p.feet.y * scale;
        const px = Math.floor((ax - sx) / scale);
        const py = Math.floor((ay - sy) / scale);
        if (px >= -1 && py >= -1 && px <= p.sprite.rows[0].length && py <= p.sprite.rows.length && opaque(p.sprite.rows, px, py)) hits.push({ y: p.feetY, e: () => objectEntity(p) });
        continue;
      }
      if (ax < p.sx || ay < p.sy || ax >= p.sx + p.sw || ay >= p.sy + p.sh) continue;
      if (opaque(art.gridFor(p.name, frameOf(p, null)), Math.floor(ax - p.sx), Math.floor(ay - p.sy))) hits.push({ y: p.baseY, e: () => objectEntity(p) });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.y - a.y);
    return hits[0].e();
  }

  function entityAt(tile, dir, t) {
    const ahead = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] || [0, 1];
    const list = entities({ x0: tile.x - 2, y0: tile.y - 2, x1: tile.x + 2, y1: tile.y + 2 }, t);
    const ok = list.filter((e) => (e.approach && e.approach.x === tile.x && e.approach.y === tile.y) || (e.kind === 'stray' && Math.abs(e.x - tile.x) + Math.abs(e.y - tile.y) <= 1));
    ok.sort((a, b) => {
      const fa = a.x - tile.x === ahead[0] && a.y - tile.y === ahead[1] ? 0 : 1;
      const fb = b.x - tile.x === ahead[0] && b.y - tile.y === ahead[1] ? 0 : 1;
      return fa - fb;
    });
    return ok[0] || null;
  }

  function entityById(id, t) {
    const p = clickable().find((o) => o.id === id);
    if (p) return objectEntity(p);
    const s = scene.strays.find((it) => it.id === id);
    return s ? strayEntity(s, t) : null;
  }

  return {
    riftId: spec.id,
    name: spec.name,
    depth: spec.depth || 1,
    tier: spec.tier || 1,
    spec,
    rift,
    scene,
    w, h, width, height,
    spawn: { ...scene.spawn },
    canvas,
    background,
    walkable: (x, y) => scene.walkable(x, y),
    findPath: (from, to) => scenePath(scene.walkable, w, h, from, to),
    genreAt,
    collect,
    hit,
    entities,
    entityAt,
    entityById,
    /** Stitch it: the seam draws shut (at once with motion off). */
    seal(t) {
      if (sealed || sealing) return;
      if (t === null) sealed = true;
      else sealing = { at: t };
    },
    get sealed() { return sealed || !!sealing; },
    setOpened(value) { opened = !!value; },
  };
}
