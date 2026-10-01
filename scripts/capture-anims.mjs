// Phase 4 animation sheets (CONTRACT-PHASE4.md §7.8, COMBAT.md §14.5): every rig's clips, the party
// dressed in three genres and as likenesses, the 96 stray poses at 28 × 28, icons, numbers, effects,
// surfaces, projectiles, flourishes and props, and a strip and a mock fight of the new art beside the
// vale's own, so each wave can be looked at and iterated until it sits right.
//
//   node scripts/capture-anims.mjs
//
// Pure Node: the sheets are painted from the same pure modules the engine uses and written as PNGs
// with node:zlib, so no window opens. Writes test-results/anims-*.png (listed at the end).
import zlib from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(repo, 'test-results');
await mkdir(results, { recursive: true });

const S = await import('../src/world/sprites.js');
const FX = await import('../src/world/riftfx.js');
const ART = await import('../src/world/scene-art.js');
const PARTY = await import('../src/world/sprites-party.js');
const STRAY = await import('../src/world/straygen.js');
const EFFECTS = await import('../src/world/fx.js');
const ICONS = await import('../src/world/icons.js');
const PROPS = await import('../src/world/props4.js');
const anims = JSON.parse(await readFile(path.join(repo, 'content', 'combat', 'anims.json'), 'utf8'));
const genres = JSON.parse(await readFile(path.join(repo, 'content', 'genres.json'), 'utf8')).genres;
const genre = (id) => genres.find((g) => g.id === id) || null;

// ---------- a tiny RGBA canvas and PNG writer ----------

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const BASE = FX.spriteTable(null);
const INK = [61, 64, 56];
class Sheet {
  constructor(w, h, bg = INK) { this.w = Math.ceil(w); this.h = Math.ceil(h); this.data = new Uint8ClampedArray(this.w * this.h * 4); this.fill(0, 0, this.w, this.h, bg); }
  px(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4; const al = a / 255;
    this.data[i] = r * al + this.data[i] * (1 - al); this.data[i + 1] = g * al + this.data[i + 1] * (1 - al); this.data[i + 2] = b * al + this.data[i + 2] * (1 - al); this.data[i + 3] = 255;
  }
  fill(x, y, w, h, rgb) { for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.px(Math.round(x) + i, Math.round(y) + j, rgb); }
  rows(rows, x, y, { scale = 1, table = BASE, table2 = null, layers = null, mirror = false } = {}) {
    const w = rows[0].length;
    rows.forEach((row, j) => { for (let i = 0; i < w; i += 1) {
      const sx = mirror ? w - 1 - i : i; const ch = row[sx]; if (ch === '.' || ch === undefined) continue;
      const t = layers && table2 && layers[j] && layers[j][sx] === '1' ? table2 : table;
      const rgba = (t && t[ch]) || BASE[ch]; if (!rgba) continue;
      this.fill(x + i * scale, y + j * scale, scale, scale, rgba);
    } });
  }
  text(str, x, y, { scale = 2, fill = 'c' } = {}) { const r = ART.textRows(str, { fill }); this.rows(r, x, y, { scale }); return r[0].length * scale; }
  async save(file) { await writeFile(path.join(results, file), encodePng(this.w, this.h, this.data)); written.push(file); }
}
const written = [];
const rgb = (key) => BASE[key];
const GRASS = rgb('g');

/** Draw a Frame (sprites-party.js), dressed in a genre when it has clothes. */
function drawFrame(sheet, frame, x, y, scale, g = null) {
  const dressed = g && frame.family ? FX.outfitGrid(frame.family, frame.rows, { split: frame.split, wear: frame.wear }) : null;
  if (dressed) sheet.rows(dressed.rows, x, y, { scale, table: BASE, layers: dressed.layers, table2: FX.spriteTable(g), mirror: frame.mirror });
  else sheet.rows(frame.rows, x, y, { scale, mirror: frame.mirror });
}

// The distinct frames of a clip in order, with how many entries each covers (slow loops repeat).
function runs(frames) {
  const out = [];
  for (const f of frames) { const last = out[out.length - 1]; if (last && last.frame === f) last.n += 1; else out.push({ frame: f, n: 1 }); }
  return out;
}

// ---------- 1. every clip of every look ----------

const LOOKS = [
  { file: 'anims-milo.png', title: 'Milo on the coat rig', look: { kind: 'rig', rig: 'coat', who: 'milo', likeness: null } },
  { file: 'anims-scribe.png', title: 'The Scribe on the robe rig', look: { kind: 'rig', rig: 'robe', who: 'claude', likeness: null } },
  { file: 'anims-artificer.png', title: 'The Artificer on the robe rig', look: { kind: 'rig', rig: 'robe', who: 'codex', likeness: null } },
  { file: 'anims-jev.png', title: 'Jev', look: { kind: 'rig', rig: 'jev', who: 'jev', likeness: null } },
  { file: 'anims-tollkeeper.png', title: 'The Tollkeeper', look: { kind: 'rig', rig: 'toll', who: 'tollkeeper', likeness: null } },
];
for (const { file, title, look } of LOOKS) {
  const rig = PARTY.RIGS[look.rig];
  const [fw, fh] = rig.frame;
  const scale = 3;
  const lines = [];
  for (const clip of PARTY.clipsOf(look)) {
    const side = PARTY.clipFrames(look, clip, 'right');
    const front = PARTY.clipFrames(look, clip, 'down');
    lines.push({ clip, facing: 'right', frames: runs(side) });
    if (front.length && front[0] !== side[0]) lines.push({ clip, facing: 'down', frames: runs(front) });
  }
  const cellW = fw * scale + 8;
  const perLine = Math.max(...lines.map((l) => l.frames.length));
  const W = 230 + perLine * cellW + 20;
  const lineH = fh * scale + 26;
  const sheet = new Sheet(W, 60 + lines.length * lineH);
  sheet.text(`${title}: every clip at 3x (right-facing; left mirrors at draw time)`, 14, 16, { scale: 2 });
  lines.forEach((l, i) => {
    const y = 50 + i * lineH;
    sheet.text(l.clip, 14, y + 8, { scale: 2 });
    sheet.text(l.facing === 'down' ? 'front' : 'side', 14, y + 26, { scale: 2, fill: 'h' });
    l.frames.forEach(({ frame, n }, j) => {
      const x = 230 + j * cellW;
      sheet.fill(x, y, fw * scale, fh * scale, GRASS);
      sheet.fill(x, y + (frame.feet[1] + 1) * scale, fw * scale, 1, rgb('G'));
      drawFrame(sheet, frame, x, y, scale);
      if (n > 1) sheet.text(`x${n}`, x + 2, y + fh * scale + 4, { scale: 1, fill: 'h' });
    });
  });
  await sheet.save(file);
}

// ---------- 2. dressed in genres, likenesses, heat shimmer, exploration frames ----------
{
  const scale = 4;
  const g3 = ['nocturne', 'neon', 'gothic'].map(genre);
  const who = [
    { look: { kind: 'rig', rig: 'coat', who: 'milo' }, clips: [['ready', 0], ['melee', 2], ['raise-lantern', 2], ['cheer', 0]] },
    { look: { kind: 'rig', rig: 'robe', who: 'claude' }, clips: [['ready', 0], ['melee', 2], ['cast', 0], ['cheer', 0]] },
    { look: { kind: 'rig', rig: 'robe', who: 'codex' }, clips: [['ready', 0], ['melee', 2], ['cast', 0], ['cheer', 0]] },
  ];
  const sheet = new Sheet(1420, 770);
  sheet.text('Dressed in a genre: only the clothes change, never the held lantern (2x)', 14, 16);
  let y = 50;
  for (const g of [null, ...g3]) {
    sheet.text(g ? g.name : 'the vale', 14, y + 20);
    let x = 200;
    for (const w of who) for (const [clip, i] of w.clips) {
      const f = PARTY.clipFrames(w.look, clip, clip === 'cheer' ? 'down' : 'right')[i];
      sheet.fill(x, y, 64, 56, g ? FX.spriteTable(g).g.slice(0, 3) : GRASS);
      drawFrame(sheet, f, x, y, 2, g);
      x += 70;
    }
    y += 64;
  }
  // likenesses beside the real thing
  y += 16;
  sheet.text('The Clay Likeness and the Slate Double (3x)', 14, y); y += 26;
  let x = 14;
  for (const [who2, lk] of [['claude', null], ['claude', 'clay'], ['codex', null], ['codex', 'slate']]) {
    for (const [clip, face] of [['ready', 'right'], ['ready', 'down'], ['melee', 'right']]) {
      const f = PARTY.clipFrames({ kind: 'rig', rig: 'robe', who: who2, likeness: lk }, clip, face)[clip === 'melee' ? 2 : 0];
      sheet.fill(x, y, 96, 84, GRASS);
      drawFrame(sheet, f, x, y, 3);
      x += 102;
    }
    x += 12;
  }
  y += 100;
  // heat shimmer: warm and cool outlines under Milo and a stray
  sheet.text('Heat shimmer (the outline drawn under a hero at low alpha): warm, cool (4x)', 14, y); y += 26;
  x = 14;
  const milo = PARTY.clipFrames({ kind: 'rig', rig: 'coat', who: 'milo' }, 'ready', 'right')[0];
  for (const warm of [true, false]) {
    sheet.fill(x, y, 128, 112, GRASS);
    const sh = EFFECTS.shimmerOutline(milo.rows, warm);
    sh.forEach((row, j) => { for (let i = 0; i < row.length; i += 1) if (row[i] !== '.') sheet.fill(x + i * 4, y + j * 4, 4, 4, [...BASE[row[i]].slice(0, 3), 110]); });
    drawFrame(sheet, milo, x, y, 4);
    x += 140;
  }
  y += 130;
  // exploration frames: the Tollkeeper at the bridge, the Wayfarers following
  sheet.text('Exploration frames: the Tollkeeper (20x26), the Scribe and the Artificer following, beside Milo (4x)', 14, y); y += 26;
  x = 14;
  for (const [look, dirs] of [[{ kind: 'rig', rig: 'toll', who: 'tollkeeper' }, ['down', 'up', 'right']], [{ kind: 'rig', rig: 'robe', who: 'claude' }, ['down', 'up', 'right']], [{ kind: 'rig', rig: 'robe', who: 'codex' }, ['down', 'up', 'right']]]) {
    for (const d of dirs) for (const f of PARTY.exploreFrames(look, d).slice(0, 2)) {
      sheet.fill(x, y + 104 - f.h * 4, f.w * 4, f.h * 4, GRASS);
      drawFrame(sheet, f, x, y + 104 - f.h * 4, 4);
      x += f.w * 4 + 6;
    }
    x += 10;
  }
  sheet.fill(x, y + 104 - 80, 64, 80, GRASS);
  sheet.rows(S.SPRITES['milo.down'][0], x, y + 104 - 80, { scale: 4 });
  await sheet.save('anims-dressed.png');
}

// ---------- 3. the 96 stray poses at 28 x 28 ----------
{
  const scale = 2;
  const looks = { floater: ['neon', 'e', ['visor', 'antenna']], walker: ['frontier', 'b', ['cowboyHat', 'bandana', 'lasso']], crawler: ['iron', 's', ['gear', 'goggles', 'smokestack']], flier: ['nocturne', 'V', ['batEars', 'batWings', 'moonCharm']], ghost: ['gothic', 'c', ['candle', 'ribbonCollar']], construct: ['noir', 'S', ['fedora', 'magnifier', 'redScarf']] };
  const lines = [];
  for (const [a, [gid, body, parts]] of Object.entries(looks)) for (const [name, pose] of Object.entries(anims.poses[a])) lines.push({ a, gid, body, parts, name, pose });
  const cell = 28 * scale + 4;
  const maxN = Math.max(...lines.map((l) => runs(l.pose.frames).length));
  const cols = 2;
  const colW = 200 + maxN * cell + 20;
  const perCol = Math.ceil(lines.length / cols);
  const sheet = new Sheet(cols * colW + 10, 50 + perCol * (cell + 2));
  sheet.text('Strays: 16 poses for each archetype at 28x28 (2x), in a genre table, distinct frames only', 14, 14);
  lines.forEach((l, i) => {
    const col = Math.floor(i / perCol);
    const x0 = 10 + col * colW;
    const y = 40 + (i % perCol) * (cell + 2);
    sheet.text(`${l.a} ${l.name}`, x0, y + 20, { scale: 1 });
    const table = FX.spriteTable(genre(l.gid));
    // collapse repeated specs (a slow loop) to one cell
    const seen = [];
    l.pose.frames.forEach((spec, fi) => { const k = JSON.stringify(spec); if (seen.length && seen[seen.length - 1].k === k) return; seen.push({ k, fi }); });
    seen.forEach(({ fi }, j) => {
      const x = x0 + 110 + j * cell;
      sheet.fill(x, y, 28 * scale, 28 * scale, GRASS);
      const s = STRAY.composeStray({ archetype: l.a, bodyKey: l.body, parts: l.parts.map((id) => ({ id, layer: 0 })), pose: l.pose, poseName: l.name, frame: fi, size: 28 });
      sheet.rows(s.rows, x, y, { scale, table });
    });
  });
  await sheet.save('anims-strays.png');
}

// ---------- 4. icons, markers, flashes and numbers ----------
{
  const sheet = new Sheet(1500, 900);
  sheet.text('Icons at 6x with each at 1x: intents, conditions (a number beside each), damage kinds, Jev\'s thoughts', 14, 14);
  let y = 44;
  for (const [set, icons] of Object.entries(ICONS.ICON_SETS)) {
    sheet.text(set, 14, y + 16);
    let x = 130;
    for (const [id, rows] of Object.entries(icons)) {
      if (x > 1420) { x = 130; y += 76; }
      sheet.fill(x - 2, y - 2, 52, 52, GRASS);
      sheet.rows(rows, x, y, { scale: 6 });
      sheet.rows(rows, x + 52, y + 40);
      if (set === 'condition') sheet.rows(ART.numberRows('2'), x + 52 + ICONS.NUMBER_SLOT.x, y + 40 + ICONS.NUMBER_SLOT.y);
      sheet.text(id.slice(0, 9), x - 2, y + 54, { scale: 1, fill: 'h' });
      x += 74;
    }
    y += 80;
  }
  sheet.text('Markers (4x)', 14, y + 10);
  let x = 130;
  for (const [id, rows] of Object.entries(ICONS.MARKERS)) {
    sheet.fill(x - 2, y - 2, rows[0].length * 4 + 4, rows.length * 4 + 4, GRASS);
    sheet.rows(rows, x, y, { scale: 4 });
    sheet.text(id, x, y + rows.length * 4 + 6, { scale: 1, fill: 'h' });
    x += Math.max(rows[0].length * 4, 44) + 16;
  }
  y += 70;
  sheet.text('Outcome flashes, 3 frames each (5x)', 14, y + 10);
  x = 250;
  for (const [id, frames] of Object.entries(ICONS.FLASHES)) {
    sheet.text(id, x, y - 2, { scale: 1, fill: 'h' });
    for (const rows of frames) { sheet.fill(x - 2, y + 8, rows[0].length * 5 + 4, rows.length * 5 + 4, GRASS); sheet.rows(rows, x, y + 10, { scale: 5 }); x += rows[0].length * 5 + 10; }
    x += 20;
  }
  y += 70;
  sheet.text('Numbers: small and big, damage, patch, a Critical, a Graze and a miss (4x and 1x)', 14, y);
  y += 26;
  x = 14;
  const nums = [['17', { fill: 'c' }], ['+5', { fill: 'l' }], ['23', { fill: 'u', star: true }], ['3', { fill: 'c' }], ['14?', { fill: 'c' }], ['miss', { fill: 'S' }], ['0123456789', { fill: 'c' }]];
  for (const size of ['small', 'big']) {
    for (const [t, o] of nums) {
      const rows = ART.numberRows(t, { size, ...o });
      sheet.fill(x - 4, y - 4, rows[0].length * 4 + 8, rows.length * 4 + 8, GRASS);
      sheet.rows(rows, x, y, { scale: 4 });
      sheet.rows(rows, x, y + rows.length * 4 + 10);
      x += rows[0].length * 4 + 24;
    }
    x = 14; y += 70;
  }
  await sheet.save('anims-icons.png');
}

// ---------- 5. effects, flourishes, projectiles, surfaces ----------
{
  const scale = 2;
  const ids = Object.keys(anims.effects);
  // Two columns, each effect on a line as tall as its square (16, 32 or 48 px).
  const lineOf = (id) => anims.effects[id].size * scale + 8;
  const colH = [0, 1].map((c) => ids.filter((_, i) => i % 2 === c).reduce((h, id) => h + lineOf(id), 0));
  const sheet = new Sheet(1700, 60 + Math.max(...colH) + 8 * 56 + 700);
  sheet.text('Effects: each spell, flourish and impact frame by frame (2x, in the vale\'s colours)', 14, 14);
  const colY = [44, 44];
  ids.forEach((id, i) => {
    const c = i % 2;
    const x0 = 14 + c * 840;
    const y = colY[c];
    colY[c] += lineOf(id);
    const size = anims.effects[id].size;
    sheet.text(`${id} (${size})`, x0, y + 12, { scale: 1 });
    for (let f = 0; f < anims.effects[id].frames; f += 1) {
      const r = EFFECTS.effectFrame(id, f, { anims });
      const x = x0 + 170 + f * (size * scale + 6);
      sheet.fill(x, y, r[0].length * scale, r.length * scale, rgb('G'));
      sheet.rows(r, x, y, { scale });
    }
  });
  let y = Math.max(...colY) + 6;
  sheet.text('Genre flourishes: two hand frames, then the procedural half (3x, each in its genre)', 14, y); y += 24;
  for (const [gid] of Object.entries(anims.flourishes)) {
    const g = genre(gid);
    const table = FX.spriteTable(g);
    sheet.text(g ? g.name : gid, 14, y + 20, { scale: 2 });
    const n = EFFECTS.flourishLength(gid, { anims });
    for (let f = 0; f < n; f += 1) {
      const r = EFFECTS.flourishFrame(gid, f, { anims });
      const x = 200 + f * 60;
      sheet.fill(x, y, 48, 48, table.g.slice(0, 3));
      const off = (48 - r[0].length * (r[0].length > 16 ? 1 : 3)) >> 1;
      sheet.rows(r, x + Math.max(0, off), y + Math.max(0, off), { scale: r[0].length > 16 ? 1 : 3, table });
    }
    y += 56;
  }
  y += 10;
  sheet.text('Projectiles (hand frame, the derived trail, turned up and down) at 5x', 14, y); y += 24;
  let x = 14;
  for (const id of Object.keys(EFFECTS.PROJECTILES)) {
    sheet.text(id, x, y, { scale: 1, fill: 'h' });
    sheet.fill(x, y + 10, 150, 100, GRASS);
    sheet.rows(EFFECTS.projectileFrame(id, 0), x + 4, y + 14, { scale: 5 });
    sheet.rows(EFFECTS.projectileFrame(id, 1), x + 4, y + 50, { scale: 5 });
    sheet.rows(EFFECTS.projectileFrame(id, 0, 'up'), x + 100, y + 14, { scale: 4 });
    sheet.rows(EFFECTS.projectileFrame(id, 0, 'down'), x + 100, y + 60, { scale: 4 });
    x += 164;
  }
  y += 120;
  sheet.text('Surfaces: a 3x2 patch (soft edges where it ends) and its three frames (2x)', 14, y); y += 24;
  EFFECTS.SURFACE_IDS.forEach((id, i) => {
    const x0 = 14 + (i % 4) * 420;
    const y0 = y + Math.floor(i / 4) * 100;
    sheet.text(id, x0, y0, { scale: 1 });
    sheet.fill(x0, y0 + 10, 16 * 3 * 2 + 12, 16 * 2 * 2 + 12, GRASS);
    for (let ty = 0; ty < 2; ty += 1) for (let tx = 0; tx < 3; tx += 1) {
      const edges = (ty > 0 ? 1 : 0) | (tx < 2 ? 2 : 0) | (ty < 1 ? 4 : 0) | (tx > 0 ? 8 : 0);
      sheet.rows(EFFECTS.surfaceTile(id, 0, { edges }), x0 + 6 + tx * 32, y0 + 16 + ty * 32, { scale: 2 });
    }
    for (let f = 0; f < 3; f += 1) { sheet.fill(x0 + 120 + f * 70, y0 + 10, 64, 64, GRASS); sheet.rows(EFFECTS.surfaceTile(id, f), x0 + 120 + f * 70, y0 + 10, { scale: 4 }); }
  });
  await sheet.save('anims-fx.png');
}

// ---------- 6. props ----------
{
  const scale = 3;
  // the Last Bridge at every deck length E's lastBridge makes (1–5 tiles), its deck tiles as river
  const bridges = [1, 2, 3, 4, 5].flatMap((n) => [[`last-bridge.h ${n}`, PROPS.lastBridgeRows(n, 'h')], [`last-bridge.v ${n}`, PROPS.lastBridgeRows(n, 'v')]]);
  const entries = [...Object.entries(PROPS.PROPS4).filter(([id]) => !id.startsWith('last-bridge')), ...bridges];
  const sheet = new Sheet(1760, 1060);
  sheet.text('Phase 4 props at 3x (every frame, a frame per state for mechanic objects)', 14, 14);
  let x = 14; let y = 44; let rowH = 0;
  for (const [id, p] of entries) {
    const w = Math.max(p.frames.length * (p.w * scale + 6), 150);
    if (x + w > 1740) { x = 14; y += rowH + 30; rowH = 0; }
    sheet.text(id, x, y, { scale: 1, fill: 'h' });
    p.frames.forEach((rows, i) => {
      const fx = x + i * (p.w * scale + 6);
      sheet.fill(fx, y + 10, p.w * scale, p.h * scale, GRASS);
      if (p.span) sheet.fill(fx + p.span[0] * scale, y + 10 + p.span[1] * scale, p.span[2] * scale, p.span[3] * scale, rgb('w'));
      sheet.rows(rows, fx, y + 10, { scale });
      if (p.states) sheet.text(p.states[i], fx, y + 14 + p.h * scale, { scale: 1, fill: 'h' });
    });
    x += w + 16; rowH = Math.max(rowH, p.h * scale + 20);
  }
  await sheet.save('anims-props.png');
}

// ---------- 7. beside the vale: a strip on one ground line, and a mock fight ----------
{
  const scale = 4;
  const sheet = new Sheet(1760, 1130);
  sheet.text('New art beside the vale (4x, feet on one ground line)', 14, 14);
  const ground = 44 + 40 * scale;
  sheet.fill(14, 44, 1732, 44 * scale, GRASS);
  sheet.fill(14, ground, 1732, 44 * scale - 40 * scale, rgb('j'));
  let x = 30;
  const put = (rows, label, { mirror = false, feetY = rows.length - 1, dx = 0 } = {}) => {
    sheet.rows(rows, x + dx, ground - (feetY + 1) * scale, { scale, mirror });
    sheet.text(label, x, ground + 8, { scale: 1 });
    x += rows[0].length * scale + 18;
  };
  put(S.SPRITES.tree[0], 'tree');
  put(S.SPRITES['milo.down'][0], 'milo (vale)');
  const f = (look, clip, face = 'right', i = 0) => PARTY.clipFrames(look, clip, face)[i];
  const milo = { kind: 'rig', rig: 'coat', who: 'milo' };
  const scribe = { kind: 'rig', rig: 'robe', who: 'claude' };
  const artificer = { kind: 'rig', rig: 'robe', who: 'codex' };
  const jev = { kind: 'rig', rig: 'jev', who: 'jev' };
  const toll = { kind: 'rig', rig: 'toll', who: 'tollkeeper' };
  for (const [look, clip, label, i] of [[milo, 'ready', 'milo ready', 0], [milo, 'melee', 'milo strike', 2], [scribe, 'ready', 'the scribe', 0], [artificer, 'ready', 'the artificer', 0], [jev, 'ready', 'jev', 0], [toll, 'ready', 'the tollkeeper', 0]]) {
    const fr = f(look, clip, 'right', i);
    sheet.rows(fr.rows, x - 6 * scale, ground - (fr.feet[1] + 1) * scale, { scale });
    sheet.text(label, x, ground + 8, { scale: 1 });
    x += (fr.w - 12) * scale + 18;
  }
  put(S.SPRITES['claude.stand'][0], 'claude (vale)');
  put(S.SPRITES.lantern[0], 'lantern');
  const stray = STRAY.composeStray({ archetype: 'walker', bodyKey: 'b', parts: [{ id: 'cowboyHat', layer: 0 }, { id: 'lasso', layer: 0 }], size: 28 });
  sheet.rows(stray.rows, x, ground - (STRAY.restFeet({ archetype: 'walker', bodyKey: 'b', parts: [{ id: 'cowboyHat' }, { id: 'lasso' }], size: 28 })[1] + 1) * scale, { scale, table: FX.spriteTable(genre('frontier')) });
  sheet.text('a stray', x, ground + 8, { scale: 1 });
  x += 28 * scale + 10;
  put(PROPS.PROPS4.handcart.frames[0], 'handcart');
  put(PROPS.PROPS4['breather-tea'].frames[0], 'tea');
  put(PROPS.PROPS4['nocturne.streetlamp'].frames[0], 'streetlamp');

  // a mock fight: the party against three strays on a Nocturne floor, with surfaces, markers,
  // intents, a number and a flash, at 3x
  const y0 = ground + 60;
  sheet.text('A mock fight at 3x: Nocturne floor, a puddle and moonbrew, markers, intents, numbers and a Critical', 14, y0);
  const noc = genre('nocturne');
  const table = FX.spriteTable(noc);
  const T = 16; const s3 = 3; const cols = 16; const rowsN = 9;
  const ox = 14; const oy = y0 + 24;
  for (let ty = 0; ty < rowsN; ty += 1) for (let tx = 0; tx < cols; tx += 1) {
    const tile = (tx + ty) % 2 ? table.g : table.G;
    sheet.fill(ox + tx * T * s3, oy + ty * T * s3, T * s3, T * s3, tile.slice(0, 3));
  }
  const tileAt = (tx, ty) => [ox + tx * T * s3, oy + ty * T * s3];
  for (const [id, cells] of [['neon-puddle', [[7, 5], [8, 5], [7, 6]]], ['moonbrew-spill', [[11, 3], [12, 3]]]]) {
    const set = new Set(cells.map(([a, b]) => `${a},${b}`));
    for (const [tx, ty] of cells) {
      const edges = (set.has(`${tx},${ty - 1}`) ? 1 : 0) | (set.has(`${tx + 1},${ty}`) ? 2 : 0) | (set.has(`${tx},${ty + 1}`) ? 4 : 0) | (set.has(`${tx - 1},${ty}`) ? 8 : 0);
      const [px, py] = tileAt(tx, ty);
      sheet.rows(EFFECTS.surfaceTile(id, 0, { edges }), px, py, { scale: s3, table });
    }
  }
  const [lx, ly] = tileAt(5, 1);
  sheet.rows(PROPS.PROPS4['nocturne.streetlamp'].frames[0], lx, ly, { scale: s3, table });
  const [bx, by] = tileAt(9, 7);
  sheet.rows(PROPS.PROPS4['nocturne.bench'].frames[0], bx, by + 7 * s3, { scale: s3, table });
  const drawUnit = (frame, tx, ty, { g: gg = noc, marker = null } = {}) => {
    const [px, py] = tileAt(tx, ty);
    const fx0 = px + 8 * s3; const fy0 = py + 13 * s3;
    if (marker) { const m = ICONS.MARKERS[marker]; sheet.rows(m, fx0 - (m[0].length >> 1) * s3, fy0 - 2 * s3, { scale: s3 }); }
    drawFrame(sheet, frame, fx0 - frame.feet[0] * s3, fy0 - frame.feet[1] * s3, s3, gg);
  };
  drawUnit(f(milo, 'ready'), 2, 4, { marker: 'active' });
  drawUnit(f(scribe, 'cast', 'right', 0), 1, 6);
  drawUnit(f(artificer, 'ready'), 3, 7);
  drawUnit(f(jev, 'ready'), 1, 2);
  const strays = [['floater', 'V', ['batEars', 'moonCharm'], 10, 4, 'idle', 0], ['walker', 'v', ['sleepyEyes', 'moonCharm'], 12, 6, 'attack', 2], ['flier', 'V', ['batEars', 'batWings'], 13, 3, 'hit', 0]];
  for (const [a, body, parts, tx, ty, poseName, fi] of strays) {
    const sp = STRAY.composeStray({ archetype: a, bodyKey: body, parts: parts.map((id) => ({ id, layer: 0 })), pose: anims.poses[a][poseName], poseName, frame: fi, size: 28 });
    const feet = STRAY.restFeet({ archetype: a, bodyKey: body, parts: parts.map((id) => ({ id })), size: 28 });
    const [px, py] = tileAt(tx, ty);
    if (tx === 13) sheet.rows(ICONS.MARKERS.target, px + 8 * s3 - 9 * s3, py + 11 * s3, { scale: s3 });
    sheet.rows(sp.rows, px + 8 * s3 - feet[0] * s3, py + 13 * s3 - feet[1] * s3, { scale: s3, table, mirror: true });
    sheet.rows(ICONS.INTENT_ICONS[a === 'floater' ? 'shoot' : a === 'walker' ? 'strike' : 'bite'], px + 4 * s3, py - 14 * s3, { scale: s3 });
  }
  // a Critical landing on the flier: its flash, its number, a mote in flight
  const [cx, cy] = tileAt(13, 3);
  sheet.rows(ICONS.FLASHES.crit[1], cx + 3 * s3, cy - 4 * s3, { scale: s3 });
  sheet.rows(ART.numberRows('17', { size: 'big', fill: 'u', star: true }), cx + 12 * s3, cy - 12 * s3, { scale: s3 });
  sheet.rows(EFFECTS.projectileFrame('mote', 1), tileAt(7, 3)[0], tileAt(7, 3)[1] + 6 * s3, { scale: s3 });
  const [wx, wy] = tileAt(12, 6);
  sheet.rows(ART.numberRows('miss', { fill: 'S' }), wx + 2 * s3, wy - 16 * s3, { scale: s3 });
  sheet.rows(ICONS.CONDITION_ICONS.drowsy, tileAt(10, 4)[0] + 14 * s3, tileAt(10, 4)[1] - 12 * s3, { scale: s3 });
  sheet.rows(ART.numberRows('2'), tileAt(10, 4)[0] + 22 * s3, tileAt(10, 4)[1] - 10 * s3, { scale: s3 });
  await sheet.save('anims-vale.png');
}

console.log(`wrote ${written.map((f) => `test-results/${f}`).join(', ')}`);
