// The arena pass and the fight-ready Elsewhere (module D, CONTRACT-PHASE4.md §7.3, §5.3, §17 item 2,
// §16.2): riftgen's roomRects, src/world/arena.js, src/world/leadname.js and buildElsewhere's
// `fight`, `hooks` and cave options. Phase 3's scenes stay byte-identical (tests/golden.test.js).
//   node --test tests/arena.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadD, sweepSpecs, prepareOptions, caveOf } from './encounters-kit.mjs';
import { hashInts } from '../src/world/rng.js';
import { PALETTE } from '../src/world/sprites.js';
import { assertCalm } from './calm.js';

const D = await loadD();
const { arena: A, elsewhere, riftgen, words, genres, hooks, leadname } = D;
const { buildElsewhere } = elsewhere;
const { prepareElsewhere } = D.encounters;
const SWEEP = sweepSpecs(riftgen, genres, { hashInts });
const keyOf = (x, y) => `${x},${y}`;
const floorLike = (ch) => ch !== '#';
const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const gap = (a, b) => Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1), b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1));

function reachFrom(scene) {
  const seen = new Set([keyOf(scene.spawn.x, scene.spawn.y)]);
  const queue = [scene.spawn];
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = keyOf(x + dx, y + dy);
      if (seen.has(k) || !scene.walkable(x + dx, y + dy)) continue;
      seen.add(k);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

// Each case prepared once and shared by the sweeps below.
const PREPARED = SWEEP.map(({ spec, kind }) => {
  const layout0 = riftgen.layout(spec);
  const out = prepareElsewhere(spec, prepareOptions(D, kind));
  const sceneKind = kind === 'wild' ? null : kind;
  const scene = buildElsewhere(spec, out.layout, { genres, kind: sceneKind, words, hooks, fight: { plan: out.plan, encounters: out.encounters } });
  return { spec, kind, layout0, ...out, scene };
});

test(`the arena pass runs against ${D.mode === 'real' ? 'B’s rules' : 'the kit’s transcription of §4'}, over ${SWEEP.length} Elsewheres`, (t) => {
  t.diagnostic(`mode: ${D.mode}${D.why ? ` (${D.why})` : ''}`);
  assert.ok(SWEEP.length >= 500, `${SWEEP.length} specs`);
});

test('roomRects are every carved room, never overlapping, and the lead’s rect holds B, S and the 2×2 footprint', () => {
  let mirrored = 0;
  for (const { layout0: layout, spec } of PREPARED) {
    const rects = layout.roomRects;
    assert.ok(Array.isArray(rects) && rects.length === layout.rooms, `${spec.id}: one rect per room`);
    assert.equal(Object.keys(layout).at(-1), 'roomRects', 'appended last');
    rects.forEach((r, i) => {
      assert.equal(r.id, i, 'the id is the index');
      assert.ok(['entrance', 'lead', 'loot', 'puzzle', 'room'].includes(r.role));
      assert.ok(r.x >= 1 && r.y >= 1 && r.x + r.w <= layout.w - 1 && r.y + r.h <= layout.h - 1, `${spec.id}: inside the layout`);
      for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) assert.ok(floorLike(layout.rows[y][x]), `${spec.id}: a room is open ground`);
      if (r.mirror) mirrored += 1;
      for (let j = i + 1; j < rects.length; j += 1) assert.ok(gap(r, rects[j]) >= 1, `${spec.id}: rooms ${i} and ${j} overlap`);
    });
    const lead = rects.filter((r) => r.role === 'lead');
    assert.equal(lead.length, 1);
    const B = layout.boss;
    for (const t of [B, layout.stitch, { x: B.x - 1, y: B.y - 1 }, { x: B.x, y: B.y - 1 }, { x: B.x - 1, y: B.y }]) assert.ok(inRect(lead[0], t.x, t.y), `${spec.id}: ${t.x},${t.y} in the lead’s rect`);
    assert.ok(inRect(rects.find((r) => r.role === 'entrance') || lead[0], layout.entrance.x, layout.entrance.y));
    for (const L of layout.loot) assert.ok(rects.some((r) => r.role === 'loot' && inRect(r, L.x, L.y)));
    if (layout.puzzle) assert.ok(rects.some((r) => r.role === 'puzzle' && inRect(r, layout.puzzle.x, layout.puzzle.y)));
  }
  assert.ok(mirrored > 100, `mirrored rooms are marked (${mirrored})`);
});

test('over 500 Elsewheres the arena pass keeps every wall face, the size, the origin and the marks', () => {
  let widened = 0;
  let wet = 0;
  for (const { layout0, plan, layout, spec } of PREPARED) {
    assert.equal(layout, plan.layout, 'the one widened layout');
    assert.equal(layout.w, layout0.w);
    assert.equal(layout.h, layout0.h);
    for (const mark of ['entrance', 'boss', 'stitch', 'puzzle']) assert.deepEqual(layout[mark], layout0[mark], mark);
    assert.deepEqual(layout.loot, layout0.loot);
    const isWet = layout0.rows.some((row) => row.includes('~'));
    if (isWet) wet += 1;
    for (let y = 0; y < layout.h; y += 1) {
      for (let x = 0; x < layout.w; x += 1) {
        const before = layout0.rows[y][x];
        const after = layout.rows[y][x];
        if (before !== after) {
          assert.ok(before === '#' && after === '.', `${spec.id}: only wall turns to floor (${x},${y} ${before}→${after})`);
          assert.ok(!isWet, `${spec.id}: a wet Elsewhere keeps its layout`);
          widened += 1;
        }
        // A wall with open ground directly south of it draws a face: it stays a wall.
        if (before === '#' && y + 1 < layout.h && floorLike(layout0.rows[y + 1][x])) assert.equal(after, '#', `${spec.id}: the wall face at ${x},${y} stays`);
      }
    }
  }
  assert.ok(widened > 1000, `rooms widen where there’s wall to spare (${widened} tiles)`);
  assert.ok(wet > 50, `wet Elsewheres are in the sweep (${wet})`);
});

test('the arena pass never merges rooms: every widened room keeps two walls between it and the next', () => {
  let grew = 0;
  for (const { layout0, layout, spec } of PREPARED) {
    const before = layout0.roomRects;
    const after = layout.roomRects;
    for (let i = 0; i < after.length; i += 1) {
      const a = after[i];
      assert.ok(a.x <= before[i].x && a.y === before[i].y && a.x + a.w >= before[i].x + before[i].w && a.h >= before[i].h, `${spec.id}: room ${i} only grows west, east and south`);
      if (a.w !== before[i].w || a.h !== before[i].h) grew += 1;
      for (let j = i + 1; j < after.length; j += 1) {
        assert.ok(gap(a, after[j]) >= Math.min(3, gap(before[i], before[j])), `${spec.id}: rooms ${i} and ${j} stay apart`);
        assert.ok(gap(a, after[j]) >= 2, `${spec.id}: rooms ${i} and ${j} never merge`);
      }
      // The widened room is open ground through and through.
      for (let y = a.y; y < a.y + a.h; y += 1) for (let x = a.x; x < a.x + a.w; x += 1) assert.ok(floorLike(layout.rows[y][x]));
    }
  }
  assert.ok(grew > 300, `${grew} fight rooms grew`);
});

test('nothing the pass places cuts the way to E, B, S, P or L, the nook or a fight room', () => {
  let nooks = 0;
  let blocked = 0;
  for (const { spec, kind, layout0, plan, scene, encounters } of PREPARED) {
    const plain = buildElsewhere(spec, layout0, { genres, kind: kind === 'wild' ? null : kind, words, hooks });
    const reach = reachFrom(scene);
    const door = scene.objects.find((o) => o.kind === 'exit');
    assert.ok(reach.has(keyOf(door.x, door.y)), `${spec.id}: the way home`);
    for (const o of scene.objects.filter((x) => ['stitch', 'loot', 'curio', 'tale-lead', 'nook'].includes(x.kind))) {
      assert.ok(reach.has(keyOf(o.approach.x, o.approach.y)), `${spec.id}: ${o.id} can be walked up to`);
      const was = plain.objects.find((p) => p.id === o.id);
      if (!was || was.blocks) {
        assert.equal(o.blocks, true, `${spec.id}: ${o.id} still blocks (nothing boxed it in)`);
        blocked += 1;
      }
    }
    // The Tale-lead stands on its whole footprint, beside the seam, never on it.
    const lead = scene.objects.find((o) => o.kind === 'tale-lead');
    const B = plan.layout.boss;
    assert.deepEqual(plan.lead.footprint, [{ x: B.x - 1, y: B.y - 1 }, { x: B.x, y: B.y - 1 }, { x: B.x - 1, y: B.y }, { x: B.x, y: B.y }]);
    assert.ok(!plan.lead.footprint.some((t) => t.x === plan.layout.stitch.x && t.y === plan.layout.stitch.y), `${spec.id}: never on the stitch point`);
    for (const t of plan.lead.footprint) assert.equal(scene.walkable(t.x, t.y), false, `${spec.id}: the footprint blocks`);
    assert.ok(!plan.lead.footprint.some((t) => t.x === lead.approach.x && t.y === lead.approach.y));
    assert.ok(plan.lead.footprint.some((t) => Math.abs(t.x - lead.approach.x) + Math.abs(t.y - lead.approach.y) === 1), `${spec.id}: approached from beside the footprint`);
    // Every fight room can be reached, and every foe’s post too.
    for (const room of encounters.rooms) {
      for (const p of room.posts) {
        if (p.unitId === 'lead') continue;
        assert.ok(reach.has(keyOf(p.x, p.y)), `${spec.id}: ${room.roomId}’s ${p.unitId} can be reached`);
      }
    }
    if (plan.nook) {
      nooks += 1;
      assert.notEqual(spec.stage, 'hairline', 'no nook at hairline');
      const nook = scene.objects.find((o) => o.kind === 'nook');
      assert.deepEqual([nook.x, nook.y], [plan.nook.x, plan.nook.y]);
      assert.equal(nook.label, 'Hearth-nook · rest here');
      assertCalm(nook.label, 'the nook’s label');
      assert.ok(!nook.scenery, 'the nook is clickable');
    } else assert.ok(spec.stage === 'hairline' || plan.rooms.length < 4, `${spec.id}: an ${spec.stage} Elsewhere has a nook`);
  }
  assert.ok(nooks > 250 && blocked > 1500, `${nooks} nooks, ${blocked} blocking objects checked`);
});

test('fight rooms come from what the scene can reach: plain rooms first, then loot and puzzle rooms', () => {
  let short = 0;
  let total = 0;
  for (const { spec, plan, layout0, kind } of PREPARED) {
    const want = { hairline: 1, open: 2, gaping: 3 }[spec.stage];
    const fights = plan.rooms.filter((r) => r.fight && r.roomId !== 'lead');
    total += 1;
    if (fights.length < want) short += 1;
    assert.ok(fights.length <= want);
    const plain = buildElsewhere(spec, layout0, { genres, kind: kind === 'wild' ? null : kind, words, hooks });
    const reach = reachFrom(plain);
    for (const room of fights) {
      assert.notEqual(room.role, 'entrance');
      const r = layout0.roomRects[Number(room.roomId.slice(1))];
      let n = 0;
      for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) if (reach.has(keyOf(x, y))) n += 1;
      assert.ok(n * 2 >= r.w * r.h, `${spec.id}: ${room.roomId} is mostly reachable by the scene’s own walk (${n})`);
    }
    // Loot and puzzle rooms fight only when there aren't enough plain rooms to hand.
    const plainLeft = plan.rooms.filter((r) => r.role === 'room' && !r.fight);
    if (fights.some((r) => r.role === 'loot' || r.role === 'puzzle')) {
      for (const r of plainLeft) {
        const rect = layout0.roomRects[Number(r.roomId.slice(1))];
        let n = 0;
        for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) if (reach.has(keyOf(x, y))) n += 1;
        assert.ok(n * 2 < rect.w * rect.h || n < 6, `${spec.id}: ${r.roomId} was a plain room left over`);
      }
    }
    assert.equal(plan.rooms.filter((r) => r.roomId === 'lead').length, 1);
  }
  assert.ok(short <= total * 0.02, `almost every Elsewhere has its full count of fight rooms (${short} short of ${total})`);
});

test('a fight arena is the room plus 2 tiles into each corridor mouth, at most 20×16', () => {
  let rooms = 0;
  for (const { plan, spec } of PREPARED) {
    const rows = plan.layout.rows;
    for (const room of plan.rooms.filter((r) => r.fight && r.roomId !== 'lead')) {
      rooms += 1;
      const { arena, rect: r } = room;
      const a = arena.rect;
      assert.ok(a.w <= 20 && a.h <= 16, `${spec.id}: ${a.w}×${a.h}`);
      assert.ok(a.x <= r.x && a.y <= r.y && a.x + a.w >= r.x + r.w && a.y + a.h >= r.y + r.h, 'it holds the room');
      // Independently: 1 and 2 steps out of the room through open ground.
      const out = [];
      let front = [];
      for (let x = r.x; x < r.x + r.w; x += 1) front.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
      for (let y = r.y; y < r.y + r.h; y += 1) front.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
      front = front.filter((t) => floorLike(rows[t.y][t.x]));
      const mouths = front.map((t) => keyOf(t.x, t.y));
      const seen = new Set(mouths);
      out.push(...front);
      for (const t of front) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = t.x + dx;
          const ny = t.y + dy;
          if (inRect(r, nx, ny) || !floorLike(rows[ny]?.[nx] ?? '#') || seen.has(keyOf(nx, ny))) continue;
          seen.add(keyOf(nx, ny));
          out.push({ x: nx, y: ny });
        }
      }
      const box = out.reduce((b, t) => ({ x0: Math.min(b.x0, t.x), y0: Math.min(b.y0, t.y), x1: Math.max(b.x1, t.x), y1: Math.max(b.y1, t.y) }),
        { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 });
      if (box.x1 - box.x0 + 1 <= 20 && box.y1 - box.y0 + 1 <= 16) {
        assert.deepEqual(a, { x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1 }, `${spec.id}: ${room.roomId}’s arena`);
      }
      assert.deepEqual(arena.mouths.map((m) => keyOf(m.x, m.y)).sort(), mouths.filter((k) => { const [x, y] = k.split(',').map(Number); return inRect(a, x, y); }).sort());
      checkArena(arena, spec, room.roomId);
    }
  }
  assert.ok(rooms > 900, `${rooms} fight rooms`);
});

function checkArena(arena, spec, roomId) {
  const { rect } = arena;
  const size = rect.w * rect.h;
  assert.equal(arena.cells.length, size);
  assert.equal(arena.height.length, size);
  assert.equal(arena.light.length, size);
  assert.match(arena.cells, /^[#.~ oO=]+$/);
  assert.match(arena.height, /^[012]+$/);
  assert.match(arena.light, /^[LdD]+$/);
  assert.equal(arena.seed, hashInts(spec.seed >>> 0, roomId, 'arena'));
  const at = (x, y) => arena.cells[(y - rect.y) * rect.w + (x - rect.x)];
  assert.equal(arena.entry.length, 4, `${spec.id}: ${roomId} has four start tiles`);
  assert.equal(new Set(arena.entry.map((t) => keyOf(t.x, t.y))).size, 4);
  for (const t of arena.entry) {
    assert.ok(inRect(rect, t.x, t.y));
    assert.ok(['.', '='].includes(at(t.x, t.y)), `${spec.id}: ${roomId} starts the party on open ground`);
  }
  for (const m of arena.mouths) assert.ok(at(m.x, m.y) !== '#' && at(m.x, m.y) !== ' ');
  assert.ok(Object.isFrozen(arena) && Object.isFrozen(arena.entry));
}

test('the Tale-lead’s arena is the 12×9 window round B, clamped inside the scene, with its walls left as walls', () => {
  for (const { plan, spec } of PREPARED) {
    const { arena } = plan.lead;
    const B = plan.layout.boss;
    const { rect } = arena;
    assert.equal(rect.w, Math.min(12, plan.layout.w));
    assert.equal(rect.h, Math.min(9, plan.layout.h));
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= plan.layout.w && rect.y + rect.h <= plan.layout.h);
    assert.equal(rect.x, Math.max(0, Math.min(B.x - 6, plan.layout.w - 12)));
    assert.equal(rect.y, Math.max(0, Math.min(B.y - 4, plan.layout.h - 9)));
    for (const t of [...plan.lead.footprint, plan.layout.stitch]) assert.ok(inRect(rect, t.x, t.y));
    for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const c = arena.cells[(y - rect.y) * rect.w + (x - rect.x)];
      assert.equal(plan.layout.rows[y][x] === '#', c === '#' || c === ' ', `${spec.id}: walls stay walls at ${x},${y}`);
    }
    for (const t of plan.lead.footprint) assert.equal(arena.cells[(t.y - rect.y) * rect.w + (t.x - rect.x)], '.', 'the lead stands on open ground');
    assert.equal(arena.cells[(plan.layout.stitch.y - rect.y) * rect.w + (plan.layout.stitch.x - rect.x)], 'o', 'the seam blocks');
    checkArena(arena, spec, 'lead');
    for (const t of arena.entry) assert.ok(!plan.lead.footprint.some((f) => f.x === t.x && f.y === t.y));
  }
});

test('an arena’s open cells are exactly the ground the fight-ready scene walks on', () => {
  let tiles = 0;
  for (const { plan, scene, spec } of PREPARED) {
    const foot = new Set(plan.lead.footprint.map((t) => keyOf(t.x, t.y)));
    for (const room of plan.rooms.filter((r) => r.arena)) {
      const { rect, cells } = room.arena;
      for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const c = cells[(y - rect.y) * rect.w + (x - rect.x)];
        const k = keyOf(x, y);
        if (foot.has(k)) { assert.equal(c, '.'); continue; }
        tiles += 1;
        assert.equal(c === '.' || c === '=', scene.walkable(x, y), `${spec.id}: ${room.roomId} at ${x},${y} is '${c}' and ${scene.walkable(x, y) ? 'walkable' : 'not walkable'}`);
        if (c === '~') assert.equal(scene.cellAt(x, y), 'water');
        if (c === '#') assert.equal(scene.cellAt(x, y), 'wall');
        if (c === ' ') assert.equal(scene.cellAt(x, y), 'void');
      }
    }
  }
  assert.ok(tiles > 50000, `${tiles} arena tiles checked`);
});

test('each fight room stands 1–3 genre props away from its mouths, the Tale-lead’s included, and about a third have a dais', () => {
  let rooms = 0;
  let dais = 0;
  let props = 0;
  let leads = 0;
  let leadDais = 0;
  let leadProps = 0;
  for (const { plan, spec, scene } of PREPARED) {
    const fights = plan.rooms.filter((r) => r.fight);
    const raised = (room) => {
      let n = 0;
      for (let y = room.rect.y; y < room.rect.y + room.rect.h; y += 1) for (let x = room.rect.x; x < room.rect.x + room.rect.w; x += 1) if (plan.heights[y * plan.layout.w + x] !== '0') n += 1;
      return n;
    };
    for (const room of fights) {
      rooms += 1;
      const mine = plan.props.filter((p) => inRect(room.rect, p.x, p.y));
      assert.ok(mine.length >= 1 && mine.length <= 3, `${spec.id}: ${room.roomId} stands ${mine.length} props of its own`);
      props += mine.length;
      const genreProps = new Set(['crate', ...spec.genres.flatMap((g) => A.GENRE_PROPS[g] || [])]);
      for (const p of mine) {
        assert.ok(genreProps.has(p.state), `${spec.id}: ${p.state} belongs to the rift’s genres`);
        assert.deepEqual(p.flags, A.PROP_FLAGS[p.state]);
        assert.ok(!room.arena.mouths.some((m) => m.x === p.x && m.y === p.y), 'never in a mouth');
        const cell = room.arena.cells[(p.y - room.arena.rect.y) * room.arena.rect.w + (p.x - room.arena.rect.x)];
        assert.equal(cell, p.flags.includes('cover-high') ? 'O' : 'o');
        const object = scene.objects.find((o) => o.kind === 'prop' && o.x === p.x && o.y === p.y);
        assert.ok(object && object.blocks && object.scenery && object.label === null, 'a blocking scenery prop in the scene');
        assert.equal(object.state, p.state);
      }
      if (room.roomId === 'lead') {
        // The lead's room: its footprint, the seam and the lead's approach stay clear, and its
        // props are cover in the lead's 12×9 fight.
        leads += 1;
        leadProps += mine.length;
        if (room.dais) leadDais += 1;
        const lead = scene.objects.find((o) => o.kind === 'tale-lead');
        const S = plan.layout.stitch;
        for (const p of mine) {
          assert.ok(!plan.lead.footprint.some((t) => t.x === p.x && t.y === p.y), `${spec.id}: no prop on the footprint`);
          assert.ok(!(p.x === S.x && p.y === S.y) && !(p.x === lead.approach.x && p.y === lead.approach.y), `${spec.id}: the seam and the lead’s approach stay clear`);
          assert.ok(inRect(plan.lead.arena.rect, p.x, p.y));
        }
        assert.ok(scene.walkable(lead.approach.x, lead.approach.y), `${spec.id}: the lead can still be walked up to`);
      }
      if (room.dais) {
        dais += 1;
        assert.ok(raised(room) > 0, 'a dais is raised');
        assert.ok(room.arena.cells.includes('='), 'with a stair');
      } else assert.equal(raised(room), 0);
    }
    // Heights rise only on the daises.
    for (let i = 0; i < plan.heights.length; i += 1) {
      if (plan.heights[i] === '0') continue;
      const x = i % plan.layout.w;
      const y = Math.floor(i / plan.layout.w);
      assert.ok(fights.some((r) => r.dais && inRect(r.rect, x, y)), `${spec.id}: ${x},${y} is on a dais`);
    }
  }
  assert.ok(props >= rooms * 1.5, `about 2 props a room (${props} in ${rooms})`);
  assert.ok(dais / rooms > 0.28 && dais / rooms < 0.42, `about 35% have a dais (${Math.round((dais / rooms) * 100)}%)`);
  assert.ok(leads > 400 && leadProps >= leads * 1.5, `${leads} Tale-leads’ rooms, ${leadProps} props of their own`);
  assert.ok(leadDais / leads > 0.25 && leadDais / leads < 0.45, `about 35% of the leads’ rooms have a dais (${Math.round((leadDais / leads) * 100)}%)`);
});

test('a fight-ready scene keeps growth inside every arena to reeds, and paints palette keys only', () => {
  const codes = new Set(Object.keys(PALETTE).filter((k) => k !== 'x').map((k) => k.charCodeAt(0)));
  for (const { plan, scene, spec } of PREPARED) {
    const rects = plan.rooms.filter((r) => r.arena).map((r) => r.arena.rect);
    for (const o of scene.objects.filter((x) => x.kind === 'foliage' && x.blocks)) assert.ok(!rects.some((r) => inRect(r, o.x, o.y)), `${spec.id}: no bush in an arena`);
  }
  let raised = 0;
  for (const { plan, scene } of PREPARED.filter((p) => p.plan.rooms.some((r) => r.dais)).slice(0, 6)) {
    const ground = scene.ground;
    for (let i = 0; i < ground.length; i += 1) if (!codes.has(ground[i])) assert.fail(`pixel ${i} has key code ${ground[i]}`);
    const room = plan.rooms.find((r) => r.dais);
    const i = room.arena.height.indexOf('1');
    const x = room.arena.rect.x + (i % room.arena.rect.w);
    const y = room.arena.rect.y + Math.floor(i / room.arena.rect.w);
    const px = x * 16 + 8;
    // A dais’s own tile is drawn differently from the same tile left flat.
    const flat = buildElsewhere(PREPARED.find((p) => p.plan === plan).spec, plan.layout, { genres, words, hooks, fight: { plan: { ...plan, heights: '0'.repeat(plan.heights.length), rooms: [] }, encounters: null } }).ground;
    let differs = 0;
    for (let py = y * 16; py < y * 16 + 16; py += 1) if (ground[py * scene.width + px] !== flat[py * scene.width + px]) differs += 1;
    assert.ok(differs > 0, 'the dais is painted');
    raised += 1;
  }
  assert.ok(raised >= 3);
});

test('a cave builds with no seam and no Tale-lead', () => {
  const spec = { ...PREPARED[0].spec, kind: 'cave', taleLead: null, genres: [], strays: [] };
  const layout = riftgen.layout(spec);
  const scene = buildElsewhere(spec, layout, { kind: 'cave', words });
  assert.equal(scene.kind, 'cave');
  assert.ok(!scene.objects.some((o) => o.kind === 'stitch' || o.kind === 'tale-lead'));
  assert.ok(scene.objects.some((o) => o.kind === 'exit'));
  assert.equal(scene.walkable(layout.stitch.x, layout.stitch.y), scene.cellAt(layout.stitch.x, layout.stitch.y) !== 'water', 'the seam’s tile is open ground');
  assert.deepEqual(scene.palettes, []);
});

test('without `fight`, a scene is Phase 3’s but for the Tale-lead’s shown name', () => {
  for (const { spec, layout0, kind } of PREPARED.slice(0, 60)) {
    const a = buildElsewhere(spec, layout0, { genres, kind: kind === 'wild' ? null : kind, words });
    const b = buildElsewhere(spec, layout0, { genres, kind: kind === 'wild' ? null : kind, words, hooks: ['Juno'] });
    const lead = a.objects.find((o) => o.kind === 'tale-lead');
    assert.equal(lead.name, leadname.leadDisplayName(spec, words));
    assert.equal(lead.label, lead.name);
    assert.equal(lead.footprint, undefined);
    assert.equal(a.encounters, undefined);
    assert.ok(!a.objects.some((o) => o.kind === 'prop' || o.kind === 'nook'));
    const strip = (s) => s.objects.map((o) => ({ ...o, name: undefined, label: o.kind === 'tale-lead' ? undefined : o.label }));
    assert.deepEqual(JSON.stringify(strip(a)), JSON.stringify(strip(b)), 'hooks change only the name');
  }
});

test('a lead whose name holds a company name shows the next name from its genre’s bank, from the rift’s seed', () => {
  let swapped = 0;
  for (let i = 0; i < 6000; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'display'), tier: 1 + (i % 8), depth: 1 });
    const name = spec.taleLead.name;
    const shown = leadname.leadDisplayName(spec, words);
    assert.equal(shown, leadname.leadDisplayName(spec, words), 'the same every time');
    assert.ok(shown.length <= 40, `${shown}: at most 40 characters`);
    const clash = leadname.companyNamesIn(name);
    if (!clash.length) { assert.equal(shown, leadname.clipName(name)); continue; }
    swapped += 1;
    assert.deepEqual(leadname.companyNamesIn(shown), [], `${name} → ${shown}`);
    assert.equal(leadname.leadDisplayName(spec, words, { hooks: clash }), leadname.clipName(name), 'a planned hook keeps its own');
    if (shown.endsWith('…')) continue;
    // The swap is one word for one entry of the same genre's bank.
    const bank = words.genres[spec.taleLead.genre];
    const pool = new Set([...(bank.names || []), ...bank.adjectives, ...bank.places]);
    const [word] = clash;
    const at = name.indexOf(word);
    const swappedIn = shown.slice(at, shown.length - (name.length - at - word.length));
    assert.ok(pool.has(swappedIn), `${name} → ${shown}: ${swappedIn} is from the ${spec.taleLead.genre} bank`);
  }
  assert.ok(swapped > 100, `${swapped} names swapped`);
  assert.equal(leadname.leadDisplayName({ taleLead: null }, words), '');
  assert.deepEqual(leadname.COMPANY_NAMES, ['Juno', 'Lumi', 'Vesperine', 'Ashcombe', 'Maddox', 'Holloway', 'Dusty', 'Calloway', 'Rivet', 'Pip', 'Mae', 'Tova', 'Nell', 'Whisper', 'Jev', 'Milo', 'Tamsin']);
  assert.deepEqual(leadname.companyNamesIn('Riveta and Pippa, not Rivet'), ['Rivet'], 'whole words only');
});

test('the swapped-in name is the bank’s entry at hashInts(seed, ‘lead-name’), stepping past company names', () => {
  const starts = new Set();
  let checked = 0;
  for (let i = 0; i < 12000 && checked < 80; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'name-table'), tier: 1 + (i % 8), depth: 1 });
    const name = spec.taleLead.name;
    const clash = leadname.companyNamesIn(name);
    if (clash.length !== 1) continue;
    const [word] = clash;
    const bank = words.genres[spec.taleLead.genre];
    const whole = new RegExp(`(?<![\\p{L}\\p{N}’'-])${word}(?![\\p{L}\\p{N}’'-])`, 'gu');
    const hits = [...name.matchAll(whole)];
    // A name standing as a name (not "The Dusty …", an adjective), once.
    if (hits.length !== 1 || !bank.names?.includes(word) || /(?:^|\s)[Tt]he $/.test(name.slice(0, hits[0].index))) continue;
    const list = bank.names.filter((e) => typeof e === 'string' && !e.includes('{'));
    const start = hashInts(spec.seed >>> 0, 'lead-name');
    let pick = null;
    for (let step = 0; step < list.length && pick === null; step += 1) {
      const candidate = list[(start + step) % list.length];
      if (candidate !== word && leadname.companyNamesIn(candidate).length === 0) pick = candidate;
    }
    const at = hits[0].index;
    const want = leadname.clipName(name.slice(0, at) + pick + name.slice(at + word.length));
    assert.equal(leadname.leadDisplayName(spec, words), want, `${name}: entry ${start % list.length} of the ${spec.taleLead.genre} names`);
    starts.add(start % list.length);
    checked += 1;
  }
  assert.ok(checked >= 40, `${checked} names checked`);
  assert.ok(starts.size >= 10, `the start moves with the seed (${starts.size} different entries)`);
});

test('a long lead name is clipped at a word to 40 characters, the same on the map, in the scene and in the fight', () => {
  assert.equal(leadname.NAME_MAX, 40);
  assert.equal(leadname.clipName('Han, Senior Brother of the Thousand-Step Stair'), 'Han, Senior Brother of the…');
  assert.equal(leadname.clipName('Short and sweet'), 'Short and sweet');
  let long = 0;
  for (let i = 0; i < 20000 && long < 12; i += 1) {
    const spec = riftgen.wildRift({ seed: hashInts(i, 'len'), tier: 1 + (i % 8), depth: 1 });
    if (spec.taleLead.name.length <= 40) continue;
    long += 1;
    const shown = leadname.leadDisplayName(spec, words, { hooks });
    assert.ok(shown.length <= 40 && shown.endsWith('…'), shown);
    const layout = riftgen.layout(spec);
    const scene = buildElsewhere(spec, layout, { genres, words, hooks });
    const lead = scene.objects.find((o) => o.kind === 'tale-lead');
    assert.deepEqual([lead.name, lead.label], [shown, shown], 'the scene shows the clipped name');
    const unit = D.bestiary.leadUnit(spec, { level: 5, rules: D.rules, leads: D.leads, foes: D.foes, words, roadLevel: 5, hooks });
    assert.equal(unit.name, shown, 'and so does the fight');
    assert.equal(leadname.leadDisplayName(spec, words, { hooks: [spec.taleLead.name] }), leadname.clipName(spec.taleLead.name), 'a hooked long name is clipped the same way');
  }
  assert.ok(long >= 12, `${long} long names`);
});

test('a cave’s arenas: open cells are the ground its scene walks on, every chest, added or not, is cover, and each fight room stands 1–3 props', () => {
  const regions = [...Object.keys(D.foes.caves), 'painted-hills', 'ivory-college', 'hearthvale', 'far-shore'];
  let tiles = 0;
  let added = 0;
  let caveProps = 0;
  for (let i = 0; i < 300; i += 1) {
    const cave = caveOf(i * 17 - 1300, i * 3 - 400, { region: regions[i % regions.length], tier: 1 + (i % 8), depth: 1 + (i % 7), hashInts });
    const layout = riftgen.layout(cave);
    const out = D.encounters.prepareCave(cave, { layout, roadLevel: 3, partySize: 1 + (i % 4), rules: D.rules, foes: D.foes, words, day: 3 });
    const plain = buildElsewhere(cave, layout, { kind: 'cave', words });
    const scene = buildElsewhere(cave, out.layout, { kind: 'cave', words, fight: { plan: out.plan, encounters: out.encounters } });
    for (const t of out.plan.chests) {
      added += 1;
      assert.equal(plain.cellAt(t.x, t.y), 'floor', `${cave.id}: an added chest stands on dry floor`);
      const o = scene.objects.find((x) => x.kind === 'loot' && x.x === t.x && x.y === t.y);
      assert.ok(o && o.blocks, `${cave.id}: the chest at ${t.x},${t.y} is in the scene`);
    }
    const chestAt = new Set(scene.objects.filter((o) => o.kind === 'loot').map((o) => keyOf(o.x, o.y)));
    // Steps from the door by the scene's own walk (a bush outside the arenas never cuts anything off).
    const bushes = new Set(scene.objects.filter((o) => o.kind === 'foliage' && o.blocks).map((o) => keyOf(o.x, o.y)));
    const dist = new Map([[keyOf(out.layout.entrance.x, out.layout.entrance.y), 0]]);
    const queue = [out.layout.entrance];
    for (let head = 0; head < queue.length; head += 1) {
      const { x, y } = queue[head];
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const k = keyOf(x + dx, y + dy);
        if (dist.has(k) || !(scene.walkable(x + dx, y + dy) || bushes.has(k))) continue;
        dist.set(k, dist.get(keyOf(x, y)) + 1);
        queue.push({ x: x + dx, y: y + dy });
      }
    }
    for (const room of out.plan.rooms.filter((r) => r.fight)) {
      const mine = out.plan.props.filter((p) => inRect(room.rect, p.x, p.y));
      assert.ok(mine.length >= 1 && mine.length <= 3, `${cave.id}: ${room.roomId} stands ${mine.length} props`);
      for (const p of mine) assert.ok(['rubble', 'crate'].includes(p.state), `${cave.id}: rubble and crates`);
      caveProps += mine.length;
    }
    for (const room of out.plan.rooms.filter((r) => r.fight && r.arena.mouths.length)) {
      const nearest = Math.min(...room.arena.mouths.map((m) => dist.get(keyOf(m.x, m.y)) ?? Infinity));
      const first = dist.get(keyOf(room.arena.entry[0].x, room.arena.entry[0].y));
      assert.ok(first !== undefined && first <= nearest + 1, `${cave.id}: ${room.roomId}’s party starts at the mouth nearest the door`);
    }
    for (const room of out.plan.rooms.filter((r) => r.arena)) {
      const { rect, cells, entry } = room.arena;
      for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const c = cells[(y - rect.y) * rect.w + (x - rect.x)];
        tiles += 1;
        assert.equal(c === '.' || c === '=', scene.walkable(x, y), `${cave.id}: ${room.roomId} at ${x},${y} is '${c}'`);
        if (chestAt.has(keyOf(x, y))) assert.equal(c, 'o', `${cave.id}: the chest at ${x},${y} is cover`);
      }
      for (const t of entry) assert.ok(!chestAt.has(keyOf(t.x, t.y)), `${cave.id}: ${room.roomId} never starts the party on a chest`);
    }
  }
  assert.ok(tiles > 50000 && added > 100 && caveProps > 600, `${tiles} cave arena tiles, ${added} added chests, ${caveProps} props`);
});

test('the arena pass is deterministic, and every part of its plan is frozen', () => {
  for (const { spec, layout0, kind, plan } of PREPARED.slice(0, 40)) {
    const plain = buildElsewhere(spec, layout0, { genres, kind: kind === 'wild' ? null : kind, words, hooks });
    const again = A.arenaPass(spec, layout0, { genres, rules: D.rules, walkable: plain.walkable });
    assert.deepEqual(again, plan);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.rooms) && Object.isFrozen(plan.props));
  }
  assert.equal(A.tileWords({ rect: { x: 10, y: 4, w: 12, h: 9 } }, 14, 8), 'e5', 'the puddle at e5');
  assert.equal(A.tileWords({ rect: { x: 10, y: 4, w: 12, h: 9 } }, 9, 8), null);
});
