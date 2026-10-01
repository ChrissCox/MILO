// The rifts the engine draws in the world (CONTRACT-PHASE3.md §7.2, §7.4 and §13): real and story
// rifts from the shell, wild rifts from the chunks around the view, and the standing bleeds of the
// Greyreach and Cinderforge. It keeps their order for the bleeds (the same order for the ground and
// for dressing sprites: real, story, wild, standing, by id within each; see bleedOrder), glides a real rift to its new spot when its urgency moves it, builds each
// rift's strays once per stage, and plays the seal and the let-go when one leaves.
//
// Drawing goes through the engine's drawables (y-sorted with everything else) and a painter from
// scene-art.js. With motion off (t === null) everything stands still and draws the same every time.
import { tearArt, tearFrameAt, sealArt, letGoFrame, strayActors, weatherPixels, spriteTable, genreIndex, bleedReach as riftReach, ANIMATION_MS } from './riftfx.js';
import { HEART } from './worldgen.js';
import { isFieldBoss, leadRoam, sightRing } from './fieldboss.js';
import { ring as ringRows } from './fx.js';

// A fusion's bleed is one lobe per genre; riftfx makes the lobes wherever a rift bleeds (bleedsFor,
// bleedAt, weatherPixels, strayActors), so the ground, sprites, weather and every map agree. They
// are re-exported here for older callers.
export { bleedLobes, LOBE_OFFSET } from './riftfx.js';

const TILE = 16;
const FEET = 13;
const STAGES = new Set(['hairline', 'open', 'gaping']);
export const GLIDE_MAX_MS = 2000;

/** Whether a world-px rect overlaps the vale's pixels (nothing of a rift is ever drawn there). */
export const overHeart = (x, y, w, h) => x < (HEART.x + HEART.w) * TILE && y < (HEART.y + HEART.h) * TILE && x + w > HEART.x * TILE && y + h > HEART.y * TILE;
const inHeartOrRing = (x, y) => x >= HEART.x - 1 && y >= HEART.y - 1 && x <= HEART.x + HEART.w && y <= HEART.y + HEART.h;
const stageOf = (rift) => (STAGES.has(rift?.stage) ? rift.stage : STAGES.has(rift?.spec?.stage) ? rift.spec.stage : 'open');
const hashId = (text) => {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 9000;
};

/** Whether a Rift can be drawn in the world: placed, not held, never in the vale or on its ring. */
export function drawableRift(rift) {
  return !!rift && typeof rift.id === 'string' && Number.isInteger(rift.x) && Number.isInteger(rift.y)
    && !rift.held && !!rift.spec && Array.isArray(rift.spec.genres) && !inHeartOrRing(rift.x, rift.y);
}

/**
 * How far a bleed reaches from its tear, in world px: the outer radius, half its wobble and, for a
 * fusion, how far its lobes sit off the tear (riftfx.bleedReach).
 */
export const bleedReach = (rift) => riftReach(rift);

// Which group a bleed sorts in: real rifts (a Rift of any other kind from the shell counts as
// real), story rifts, wild rifts, then standing bleeds ({ x, y, radius, genre }: no spec).
const bleedRank = (r) => (!r.spec ? 3 : r.kind === 'wild' ? 2 : r.kind === 'story' ? 1 : 0);

/**
 * The one order bleeds are listed in wherever riftfx is asked about the ground (the layer's
 * bleeding(), and anything that must agree with it): real rifts first, then story rifts, then wild
 * rifts, then standing bleeds, and by id within each. A comparator for Array.prototype.sort.
 */
export function bleedOrder(a, b) {
  const rank = bleedRank(a) - bleedRank(b);
  if (rank) return rank;
  const ai = String(a.id ?? '');
  const bi = String(b.id ?? '');
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/** Glide time for a real rift moving `tiles` tiles: calm, and never more than two seconds. */
export const glideMs = (tiles) => Math.min(GLIDE_MAX_MS, Math.round(350 + tiles * 110));

/**
 * createRiftLayer({ genres, words, painter, walkable, approach }) → the rifts in the world.
 * walkable(x, y) is where strays may stand (the world without Milo's own blockers); approach(x, y)
 * gives the tile Milo walks to for a tile (the engine's choice).
 * Phase 4 (CONTRACT-PHASE4.md §11.4): hidden(id) leaves those strays out of draws, hits and entity
 * lists (a fight in the wilds); hooks names the leads that keep their own names; and a field boss
 * (fieldboss.isFieldBoss, with leads and rules, content.combat's) roams its bleed on
 * fieldboss.leadRoam's wander instead of standing still, with its sight ring drawn softly round the
 * tear. Sight never starts anything here: the ring only shows where Challenge would fight.
 */
export function createRiftLayer({ genres, words = null, painter, walkable = () => true, approach = null, standing = [], hidden = () => false, hooks = [], leads = null, rules = null, worldgen = null, wilds = null, deferRoams = false, onRoamQueued = () => {} } = {}) {
  const isHidden = (id) => {
    try { return !!hidden(id); } catch { return false; }
  };
  const index = genreIndex(genres);
  const genreOf = (id) => index.get(id) || null;
  const real = new Map(); // id → { rift, from, to, at, dur }
  const wild = new Map(); // chunk key → Rift[]
  const closedIds = new Set(); // closed here today (closeRift), so a recompute never brings one back
  const recent = new Map(); // id → rift, removed without a word (for a closeRift that comes after)
  const closing = []; // { rift, how, at, x, y (px feet), stage, genre }
  const strays = new Map(); // rift id → { sig, actors }
  const standingList = standing.map((b) => ({ ...b, id: `standing:${b.x},${b.y}` }));
  let version = 0;
  let ordered = null;

  const changed = () => {
    version += 1;
    ordered = null;
  };

  function glideAt(entry, t) {
    if (!entry.dur || t === null || t - entry.at >= entry.dur) return { x: entry.to.x * TILE + 8, y: entry.to.y * TILE + FEET, done: true };
    const k = Math.max(0, (t - entry.at) / entry.dur);
    const e = k * k * (3 - 2 * k); // ease in and out
    return {
      x: (entry.from.x + (entry.to.x - entry.from.x) * e) * TILE + 8,
      y: (entry.from.y + (entry.to.y - entry.from.y) * e) * TILE + FEET,
      done: false,
    };
  }

  /** Real and story rifts (held ones and anything in the vale are ignored). A rift carrying `how` leaves. */
  function setReal(list, t, motion) {
    const seen = new Set();
    for (const rift of Array.isArray(list) ? list : []) {
      if (!rift || typeof rift.id !== 'string') continue;
      if (rift.how) {
        if (real.has(rift.id) || recent.has(rift.id) || drawableRift(rift)) close(rift.id, rift.how, t, motion, rift);
        continue;
      }
      if (!drawableRift(rift) || rift.kind === 'wild') continue;
      seen.add(rift.id);
      const entry = real.get(rift.id);
      if (!entry) {
        real.set(rift.id, { rift, from: { x: rift.x, y: rift.y }, to: { x: rift.x, y: rift.y }, at: t ?? 0, dur: 0 });
        changed();
        continue;
      }
      const moved = entry.to.x !== rift.x || entry.to.y !== rift.y;
      const restyled = stageOf(entry.rift) !== stageOf(rift) || !!entry.rift.warded !== !!rift.warded;
      if (moved) {
        const now = glideAt(entry, t);
        const from = { x: (now.x - 8) / TILE, y: (now.y - FEET) / TILE };
        const tiles = Math.hypot(rift.x - from.x, rift.y - from.y);
        entry.from = from;
        entry.to = { x: rift.x, y: rift.y };
        entry.at = t ?? 0;
        entry.dur = motion && t !== null ? glideMs(tiles) : 0;
      }
      entry.rift = rift;
      if (moved || restyled) changed();
    }
    for (const [id, entry] of real) {
      if (seen.has(id)) continue;
      real.delete(id);
      recent.set(id, entry.rift);
      changed();
    }
    while (recent.size > 40) recent.delete(recent.keys().next().value);
  }

  function setWild(key, list) {
    wild.set(key, (list || []).filter((r) => drawableRift(r)));
    if (deferRoams) for (const r of wild.get(key)) queueRoam(r); // worked out before it's in view, as a rule
    changed();
  }

  function dropWild(key) {
    if (wild.delete(key)) changed();
  }

  function clearWild() {
    wild.clear();
    changed();
  }

  function forgetClosed() {
    closedIds.clear();
  }

  function find(id) {
    if (real.has(id)) return { rift: real.get(id).rift, where: 'real' };
    for (const [key, list] of wild) {
      const rift = list.find((r) => r.id === id);
      if (rift) return { rift, where: key };
    }
    if (recent.has(id)) return { rift: recent.get(id), where: 'recent' };
    return null;
  }

  /** Play the seal (sealed, stitched) or the let-go now, and stop drawing the rift. */
  function close(id, how, t, motion, given = null) {
    const found = find(id) || (given && drawableRift(given) ? { rift: given, where: 'given' } : null);
    closedIds.add(id);
    if (!found) return false;
    const { rift, where } = found;
    let feet = { x: rift.x * TILE + 8, y: rift.y * TILE + FEET };
    if (where === 'real') {
      feet = glideAt(real.get(id), t);
      real.delete(id);
    } else if (where !== 'recent' && where !== 'given') {
      wild.set(where, wild.get(where).filter((r) => r.id !== id));
    }
    // While it closes, its strays fade where they stand and its bleed stays; both go with it.
    const plays = motion && t !== null && (how === 'sealed' || how === 'stitched' || how === 'let-go');
    const actors = plays && stageOf(rift) !== 'hairline' ? actorsFor(rift) : [];
    recent.delete(id);
    strays.delete(id);
    if (plays) {
      const bleed = { ...rift, x: Math.round((feet.x - 8) / TILE), y: Math.round((feet.y - FEET) / TILE) };
      closing.push({ rift, how, at: t, x: feet.x, y: feet.y, stage: stageOf(rift), genre: genreOf(rift.spec.genres[0]), cache: new Map(), actors, bleed });
    }
    changed();
    return true;
  }

  /** Everything drawn now: { rift, x, y (feet px), gliding }. */
  function active(t) {
    const out = [];
    for (const entry of real.values()) {
      const at = glideAt(entry, t);
      out.push({ rift: entry.rift, x: at.x, y: at.y, gliding: !at.done });
    }
    for (const list of wild.values()) {
      for (const rift of list) if (!closedIds.has(rift.id)) out.push({ rift, x: rift.x * TILE + 8, y: rift.y * TILE + FEET, gliding: false });
    }
    return out;
  }

  /**
   * The rifts that colour the ground and dress sprites, where they stand once settled (a gliding
   * rift's bleed stays where it was until it arrives). Standing bleeds come too. A fusion comes
   * whole: riftfx bleeds it as its lobes (bleedLobes) for the ground, the sprites and the weather
   * alike.
   *
   * One fixed order (bleedOrder): real rifts first, then story rifts, then wild ones, then the
   * standing bleeds, and by id within each. Where two bleeds overlap, riftfx's answers depend on
   * the order it is given them (bleedAt's interleave, and which genre a tie of strengths goes to),
   * so anything else that asks riftfx about the same ground (the shell's pictures of a place) must
   * list its rifts in this order too: sort them with bleedOrder.
   */
  function bleeding() {
    if (ordered) return ordered;
    const list = [];
    for (const entry of real.values()) {
      const settled = entry.dur ? entry.from : entry.to;
      const x = Math.round(settled.x);
      const y = Math.round(settled.y);
      list.push(x === entry.rift.x && y === entry.rift.y ? entry.rift : { ...entry.rift, x, y });
    }
    for (const rows of wild.values()) for (const rift of rows) if (!closedIds.has(rift.id)) list.push(rift);
    for (const c of closing) if (!list.some((r) => r.id === c.bleed.id)) list.push(c.bleed);
    list.push(...standingList);
    list.sort(bleedOrder);
    ordered = list;
    return ordered;
  }

  /** Glides that finished since the last look (their bleeds move now), and animations that ended. */
  function update(t) {
    let moved = false;
    for (const entry of real.values()) {
      if (entry.dur && (t === null || t - entry.at >= entry.dur)) {
        entry.dur = 0;
        entry.from = { ...entry.to };
        moved = true;
      }
    }
    if (moved) changed();
    for (let i = closing.length - 1; i >= 0; i -= 1) {
      const c = closing[i];
      const span = c.how === 'let-go' ? ANIMATION_MS.letGo : ANIMATION_MS.seal;
      if (t === null || t - c.at > span + 50) {
        closing.splice(i, 1);
        moved = true; // its bleed goes now
        changed();
      }
    }
    return moved;
  }

  /** Tiles a tear stands on (Milo walks round them). */
  function tiles() {
    const out = new Set();
    for (const entry of real.values()) out.add(`${entry.to.x},${entry.to.y}`);
    for (const list of wild.values()) for (const r of list) if (!closedIds.has(r.id)) out.add(`${r.x},${r.y}`);
    return out;
  }

  // ---------- strays ----------

  function actorsFor(rift) {
    const sig = `${stageOf(rift)}|${rift.x},${rift.y}`;
    const known = strays.get(rift.id);
    if (known && known.sig === sig) {
      strays.delete(rift.id); // most recently used last
      strays.set(rift.id, known);
      return known.actors;
    }
    let actors = [];
    try {
      actors = strayActors({ ...rift, stage: stageOf(rift) }, { walkable, seed: 0, words, hooks });
      actors = roaming(rift, actors);
    } catch (error) {
      console.error(error);
    }
    strays.delete(rift.id);
    strays.set(rift.id, { sig, actors });
    while (strays.size > 48) strays.delete(strays.keys().next().value);
    return actors;
  }

  // A field boss's lead roams inside its bleed (fieldboss.leadRoam), where Phase 3's stood still.
  // leadRoam's arena check (fieldArena) takes tens of ms, so with deferRoams (the wilds) it's worked
  // out in an idle slice (roamTask), never in a draw: the lead stands at home until then, and one
  // drawn standing first walks off from home when its roam is known, never jumping.
  const roams = new Map(); // roamKey → { roam: Roam | null, positionAt }
  const roamQueue = new Map(); // roamKey → rift, waiting for an idle slice
  const roamKey = (rift) => `${rift.id}|${stageOf(rift)}|${rift.x},${rift.y}`;
  const workOutRoam = (rift) => leadRoam({ ...rift, stage: stageOf(rift) }, { walkable, genres, seed: 0, leads, rules, worldgen, wilds });
  function queueRoam(rift) {
    const key = roamKey(rift);
    if (roams.has(key) || roamQueue.has(key) || !isFieldBoss(rift, { leads, rules })) return;
    roamQueue.set(key, rift);
    onRoamQueued();
  }
  /** The next field boss's roam to work out, as an idle task (the wilds' queue runs it), or null. */
  function roamTask() {
    const next = roamQueue.entries().next();
    if (next.done) return null;
    const [key, rift] = next.value;
    return () => {
      roamQueue.delete(key);
      let roam = null;
      try { roam = workOutRoam(rift); } catch (error) { console.error(error); }
      roams.set(key, { roam, positionAt: roam && (strays.has(rift.id) ? fromHome(roam) : roam.positionAt) });
      while (roams.size > 48) roams.delete(roams.keys().next().value);
      if (strays.has(rift.id)) {
        strays.delete(rift.id);
        changed();
      }
    };
  }
  /** A roam that starts from home the first time it's drawn (t), from the loop's first moment there. */
  function fromHome(roam) {
    const home = roam.positionAt(null);
    let offset = 0;
    for (let k = 0; k < roam.period; k += 100) {
      const p = roam.positionAt(k);
      if (!p.moving && p.x === home.x && p.y === home.y) { offset = k; break; }
    }
    let since = null;
    return (t) => {
      if (t == null || !Number.isFinite(t)) return home;
      if (since === null) since = t;
      return roam.positionAt(t - since + offset);
    };
  }
  function roaming(rift, actors) {
    if (!isFieldBoss(rift, { leads, rules })) return actors;
    const key = roamKey(rift);
    if (!roams.has(key)) {
      if (deferRoams) {
        queueRoam(rift);
        return actors;
      }
      const roam = workOutRoam(rift);
      roams.set(key, { roam, positionAt: roam && roam.positionAt });
    }
    const { roam, positionAt } = roams.get(key);
    if (!roam) return actors;
    return actors.map((a) => (a.lead ? { ...a, home: roam.home, speed: roam.speed, roams: true, positionAt } : a));
  }

  let sightCanvas = null;
  function drawSight(target, rift, visible) {
    const r = sightRing(rift);
    const px = Math.round(r.radius * TILE);
    const cx = rift.x * TILE + 8;
    const cy = rift.y * TILE + FEET;
    if (!visible(cx - px - 1, cy - px - 1, 2 * px + 2, 2 * px + 2)) return;
    if (!sightCanvas) sightCanvas = painter.grid(ringRows({ r: px, key: 'c', width: 1, dither: true }, 0), null, 'base', { tag: 'sight' });
    target.globalAlpha = 0.35;
    target.drawImage(sightCanvas, Math.round(cx - sightCanvas.width / 2), Math.round(cy - sightCanvas.height / 2));
    target.globalAlpha = 1;
  }

  const tableFor = (id) => spriteTable(genreOf(id));
  function strayCanvas(actor, mirror) {
    const g0 = actor.genre;
    const g1 = actor.second || actor.genre;
    return painter.grid(actor.sprite.rows, tableFor(g0), `${g0}|${g1}`, { mirror, layers: actor.sprite.layers || null, table2: tableFor(g1), tag: `stray:${actor.id}` });
  }

  /** Where a stray stands now and what to draw: { actor, x, y (feet px), canvas, sx, sy, w, h }. */
  function strayPose(actor, t, offset = null) {
    const p = actor.positionAt(t);
    const mirror = p.dir === 'left';
    const canvas = strayCanvas(actor, mirror);
    const w = actor.sprite.rows[0].length;
    const h = actor.sprite.rows.length;
    const feetX = mirror ? w - 1 - actor.feet.x : actor.feet.x;
    const bob = actor.hover && t !== null && Math.floor((t + hashId(actor.id)) / 520) % 2 === 0 ? -1 : 0;
    const x = p.x + (offset ? offset.x : 0);
    const y = p.y + (offset ? offset.y : 0);
    return { actor, x, y, canvas, sx: Math.round(x - feetX), sy: Math.round(y - actor.feet.y + bob), w, h, moving: p.moving };
  }

  // ---------- drawing ----------

  /** A soft pool of the lead's own rim colour on the ground at its feet, under every sprite. */
  function leadLight(target, actor, pose, t) {
    if (!painter.glow) return;
    const rim = tearArt('open', genreOf(actor.genre), 0).colours.a;
    const pool = painter.glow(rim, 13, 5, 0.6);
    const breath = t === null ? 1 : 0.7 + 0.3 * Math.sin((t + hashId(actor.id)) / 900);
    target.globalAlpha = breath;
    target.drawImage(pool, Math.round(pose.sx + pose.w / 2 - 13), Math.round(pose.y - 4));
    target.globalAlpha = 1;
  }

  function tearFor(item, t) {
    const { rift } = item;
    const genre = genreOf(rift.spec.genres[0]);
    const art = tearArt(stageOf(rift), genre, tearFrameAt(t, hashId(rift.id)), { warded: !!rift.warded });
    return { art, canvas: painter.art(art, `tear:${rift.id}`), sx: Math.round(item.x - art.anchor.x), sy: Math.round(item.y - art.anchor.y) };
  }

  /**
   * Push the tears, strays and seals in view into `drawables` ({ y, x, draw }), and their shadows
   * onto `target` at once. visible(x, y, w, h) culls in world px.
   */
  function collect(drawables, target, visible, t, shadow) {
    for (const item of active(t)) {
      const { rift } = item;
      const tear = tearFor(item, t);
      if (visible(tear.sx, tear.sy, tear.art.w, tear.art.h)) {
        shadow(item.x, item.y, 8, 2, 0);
        drawables.push({ y: item.y, x: item.x, draw: () => target.drawImage(tear.canvas, tear.sx, tear.sy) });
      }
      if (stageOf(rift) === 'hairline') continue;
      if (!visible(item.x - 80, item.y - 80, 160, 160)) continue;
      const actors = actorsFor(rift);
      if (!item.gliding && actors.some((a) => a.roams && !isHidden(a.id))) drawSight(target, rift, visible);
      const offset = item.gliding ? { x: item.x - (rift.x * TILE + 8), y: item.y - (rift.y * TILE + FEET) } : null;
      for (const actor of actors) {
        if (isHidden(actor.id)) continue;
        const pose = strayPose(actor, t, offset);
        if (!visible(pose.sx, pose.sy, pose.w, pose.h)) continue;
        // The Tale-lead stands in a soft pool of its own story's light (breathing slowly with motion).
        if (actor.lead) leadLight(target, actor, pose, t);
        shadow(pose.x, pose.y, actor.hover ? 6 : 10, actor.hover ? 2 : 3, 0);
        drawables.push({ y: pose.y, x: pose.x, draw: () => target.drawImage(pose.canvas, pose.sx, pose.sy) });
      }
    }
    for (const c of closing) {
      // The strays fade as the seam shuts (or the tear folds away).
      const span = c.how === 'let-go' ? ANIMATION_MS.letGo * 0.6 : ANIMATION_MS.seal;
      const fade = t === null ? 0 : Math.max(0, 1 - (t - c.at) / span);
      if (fade > 0.05) {
        for (const actor of c.actors) {
          const pose = strayPose(actor, t);
          if (!visible(pose.sx, pose.sy, pose.w, pose.h)) continue;
          drawables.push({
            y: pose.y,
            x: pose.x,
            draw: () => {
              target.globalAlpha = fade;
              target.drawImage(pose.canvas, pose.sx, pose.sy);
              target.globalAlpha = 1;
            },
          });
        }
      }
      if (c.how === 'let-go' || !visible(c.x - 20, c.y - 40, 40, 48)) continue;
      const p = Math.min(1, (t - c.at) / ANIMATION_MS.seal);
      const step = Math.min(24, Math.floor(p * 24));
      let canvas = c.cache.get(step);
      if (!canvas) {
        canvas = painter.art(sealArt(c.stage, c.genre, step / 24), `seal:${c.rift.id}`);
        c.cache.set(step, canvas);
      }
      const base = tearArt(c.stage, c.genre, 0);
      drawables.push({ y: c.y, x: c.x, draw: () => target.drawImage(canvas, Math.round(c.x - base.anchor.x), Math.round(c.y - base.anchor.y)) });
    }
  }

  /** Above everything: the let-go moth, and the genres' weather inside their bleeds (motion only). */
  function drawAbove(target, visible, t, view) {
    if (t === null) return;
    for (const c of closing) {
      if (c.how !== 'let-go') continue;
      const p = Math.min(1, (t - c.at) / ANIMATION_MS.letGo);
      const step = Math.min(40, Math.floor(p * 40));
      let frame = c.cache.get(step);
      if (!frame) {
        const f = letGoFrame(c.stage, c.genre, step / 40);
        frame = { f, canvas: painter.art(f, `letgo:${c.rift.id}`) };
        c.cache.set(step, frame);
      }
      const { f, canvas } = frame;
      // The moth flies west, unless the vale lies that way: it never crosses the sanctuary.
      const away = c.x > (HEART.x + HEART.w / 2) * TILE && c.y > HEART.y * TILE && c.y < (HEART.y + HEART.h) * TILE ? -1 : 1;
      const x = Math.round(c.x - f.anchor.x + f.dx * away);
      const y = Math.round(c.y - f.anchor.y + f.dy);
      if (!visible(x, y, canvas.width, canvas.height) || overHeart(x, y, canvas.width, canvas.height)) continue;
      target.globalAlpha = f.alpha;
      target.drawImage(canvas, x, y);
      target.globalAlpha = 1;
    }
    weather(target, t, view);
  }

  const fills = new Map();
  function weather(target, t, view) {
    const near = bleeding().filter((r) => {
      const reach = bleedReach(r);
      const cx = (r.x + 0.5) * TILE;
      const cy = (r.y + 0.5) * TILE;
      return cx + reach >= view.x && cy + reach >= view.y && cx - reach <= view.x + view.w && cy - reach <= view.y + view.h;
    });
    if (!near.length) return;
    const gliding = new Set([...real.values()].filter((e) => e.dur && t - e.at < e.dur).map((e) => e.rift.id));
    for (const rift of near) {
      if (gliding.has(rift.id)) continue;
      let pixels;
      try {
        pixels = weatherPixels(rift, { genres: index, t, rifts: near });
      } catch {
        continue;
      }
      for (const { x, y, rgb } of pixels) {
        if (x < view.x || y < view.y || x > view.x + view.w || y > view.y + view.h) continue;
        const key = rgb.join(',');
        let style = fills.get(key);
        if (!style) {
          style = `rgb(${key})`;
          fills.set(key, style);
        }
        target.fillStyle = style;
        target.fillRect(x, y, 1, 1);
      }
    }
  }

  // ---------- entities ----------

  function riftEntity(rift) {
    const name = rift.spec?.name || 'A rift';
    const label = rift.kind === 'wild' ? `${name} · wild rift` : name;
    const entity = { kind: 'rift', id: rift.id, x: rift.x, y: rift.y, label, riftId: rift.id, riftKind: rift.kind, stage: stageOf(rift) };
    if (approach) entity.approach = approach(rift.x, rift.y, 'rift');
    return entity;
  }

  function strayEntity(actor, rift, t) {
    const p = actor.positionAt(t);
    const x = Math.floor(p.x / TILE);
    const y = Math.floor((p.y - FEET + 8) / TILE);
    const label = actor.lead ? `${actor.name} · Tale-lead` : actor.name;
    const entity = { kind: 'stray', id: actor.id, x, y, label, riftId: rift.id };
    if (approach) entity.approach = approach(x, y, 'stray');
    return entity;
  }

  /** Rift and stray entities whose tiles fall in the rect (tiles, inclusive). */
  function entities(rect, t) {
    const out = [];
    const inside = (x, y) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    for (const item of active(t)) {
      const { rift } = item;
      if (inside(rift.x, rift.y)) out.push(riftEntity(rift));
      if (stageOf(rift) === 'hairline' || item.gliding) continue;
      if (Math.abs(rift.x - (rect.x0 + rect.x1) / 2) > (rect.x1 - rect.x0) / 2 + 6 || Math.abs(rift.y - (rect.y0 + rect.y1) / 2) > (rect.y1 - rect.y0) / 2 + 6) continue;
      for (const actor of actorsFor(rift)) {
        if (isHidden(actor.id)) continue;
        const e = strayEntity(actor, rift, t);
        if (inside(e.x, e.y)) out.push(e);
      }
    }
    return out;
  }

  /** The rift or stray under world pixel (ax, ay): strays first (they stand in front), then tears. */
  function hit(ax, ay, t, opaque) {
    const hits = [];
    for (const item of active(t)) {
      const { rift } = item;
      if (stageOf(rift) !== 'hairline' && !item.gliding && Math.abs(ax - item.x) < 90 && Math.abs(ay - item.y) < 90) {
        for (const actor of actorsFor(rift)) {
          if (isHidden(actor.id)) continue;
          const pose = strayPose(actor, t);
          if (ax < pose.sx - 1 || ay < pose.sy - 1 || ax >= pose.sx + pose.w + 1 || ay >= pose.sy + pose.h + 1) continue;
          const rows = actor.sprite.rows;
          const px = Math.floor(ax - pose.sx);
          const lx = pose.canvas && actor.positionAt(t).dir === 'left' ? pose.w - 1 - px : px;
          if (opaque(rows, lx, Math.floor(ay - pose.sy))) hits.push({ y: pose.y + 0.1, entity: () => strayEntity(actor, rift, t) });
        }
      }
      const tear = tearFor(item, t);
      if (ax >= tear.sx - 2 && ay >= tear.sy - 2 && ax < tear.sx + tear.art.w + 2 && ay < tear.sy + tear.art.h + 2) {
        const body = tear.art.body;
        const inBody = ax >= tear.sx + body.x - 3 && ax < tear.sx + body.x + body.w + 3 && ay >= tear.sy + body.y - 3 && ay < tear.sy + body.y + body.h + 3;
        if (inBody) hits.push({ y: item.y, entity: () => riftEntity(rift) });
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.y - a.y);
    return hits[0].entity();
  }

  function entityById(id, t) {
    if (id.startsWith('stray:')) {
      for (const item of active(t)) {
        if (!id.startsWith(`stray:${item.rift.id}:`)) continue;
        const actor = actorsFor(item.rift).find((a) => a.id === id && !isHidden(a.id));
        if (actor) return strayEntity(actor, item.rift, t);
      }
      return null;
    }
    const found = find(id);
    return found && found.where !== 'recent' ? riftEntity(found.rift) : null;
  }

  return {
    setReal, setWild, dropWild, clearWild, forgetClosed, close, active, bleeding, update, tiles,
    collect, drawAbove, entities, hit, entityById, actorsFor, find, roamTask,
    isClosed: (id) => closedIds.has(id),
    wildKeys: () => [...wild.keys()],
    hasWild: (key) => wild.has(key),
    closingCount: () => closing.length,
    get version() { return version; },
  };
}
