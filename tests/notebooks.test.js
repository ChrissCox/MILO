// The notebook files main keeps (CONTRACT-PHASE4.md §10.2): electron/notebooks.cjs. Ids, append at
// `at` (torn tails, `moved` for any `at` that isn't where the good frames end, committed rounds never
// cut off), the exact caps (a torn tail near 16 MiB included), replace with a previous (and as the
// first write), restore once and crash-safe, drop, blocked writes, flush, and crashes between the
// append and the state save. Main's notebook channels and preload's not-loaded gate are
// tested with the rest of the bridge in tests/alarm.test.js.
//   node --test tests/notebooks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, open, mkdir, readdir } from 'node:fs/promises';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notebooks = require('../electron/notebooks.cjs');
const { createNotebookStore, isNotebookId, checkFrames, goodEnd, crc32, tableCrc32, MAX_APPEND, MAX_FILE, FRAME_HEADER } = notebooks;

// ---------------------------------------------------------------------------
// A stand-in for src/combat/notebook.js's frame and unframe (§7.2, §10.2), written from the
// contract so these tests don't wait for wave 2:
//   [u16 LE 0x424e][u8 version 1][u16 LE count][u32 LE crc32 of the notes][u32 LE key] + count × 24

function notes(count, seed = 1) {
  const out = new Uint8Array(count * 24);
  for (let i = 0; i < out.length; i += 1) out[i] = (seed * 31 + i * 7) & 0xff;
  return out;
}

function frame(noteBytes, key) {
  const count = noteBytes.length / 24;
  const out = Buffer.alloc(FRAME_HEADER + noteBytes.length);
  out.writeUInt16LE(0x424e, 0);
  out.writeUInt8(1, 2);
  out.writeUInt16LE(count, 3);
  out.writeUInt32LE(zlib.crc32(noteBytes) >>> 0, 5);
  out.writeUInt32LE(key >>> 0, 9);
  out.set(noteBytes, FRAME_HEADER);
  return new Uint8Array(out);
}

// The renderer's reading: whole frames with a good CRC count; a bad CRC is stepped over; anything
// that isn't a whole frame ends it. good = bytes through the last whole good frame.
function unframe(bytes) {
  const buffer = Buffer.from(bytes);
  let offset = 0;
  let good = 0;
  let frames = 0;
  let lastKey = null;
  const kept = [];
  while (buffer.length - offset >= FRAME_HEADER) {
    if (buffer.readUInt16LE(offset) !== 0x424e || buffer[offset + 2] !== 1) break;
    const count = buffer.readUInt16LE(offset + 3);
    const end = offset + FRAME_HEADER + count * 24;
    if (end > buffer.length) break;
    const body = buffer.subarray(offset + FRAME_HEADER, end);
    if ((zlib.crc32(body) >>> 0) === buffer.readUInt32LE(offset + 5)) {
      frames += 1;
      good = end;
      lastKey = buffer.readUInt32LE(offset + 9);
      kept.push(body);
    }
    offset = end;
  }
  return { notes: Buffer.concat(kept), frames, good, lastKey, torn: buffer.length - good };
}

const concat = (...parts) => new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));

async function tempDir(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'milo-notebooks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, dir: path.join(root, 'notebooks') };
}

const onDisk = async (dir, name) => new Uint8Array(await readFile(path.join(dir, name)));
const exists = async (file) => stat(file).then(() => true, () => false);

// ---------------------------------------------------------------------------

test('notebook ids are lowercase slugs, and refuse traversal, uppercase and Windows device names', () => {
  for (const id of ['claude', 'codex', 'jev', 'tollkeeper', 'reg-1k2j9x', 'a', '0', 'x'.repeat(40), 'com10', 'lpt', 'console', 'nul-1']) {
    assert.equal(isNotebookId(id), true, id);
  }
  const refused = [
    '', '..', '../claude', '..\\claude', 'claude/../jev', 'a/b', 'a\\b', 'C:claude', '/claude', 'claude.notes', 'claude.',
    'Claude', 'CLAUDE', 'Jev', 'x'.repeat(41), '-claude', 'claude ', ' claude', 'cla ude', 'clä', 'claude\u0000',
    'con', 'prn', 'aux', 'nul', 'com0', 'com1', 'com5', 'com9', 'lpt0', 'lpt1', 'lpt9', 'CON', 'Nul',
    null, undefined, 42, {}, ['claude'],
  ];
  for (const id of refused) assert.equal(isNotebookId(id), false, JSON.stringify(id));
});

test('a bad id is refused before anything touches the disk', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const bytes = frame(notes(1), 1);
  for (const id of ['../escape', 'con', 'Claude', 'a/b', '']) {
    assert.deepEqual(await store.read(id), { ok: false, code: 'bad-id' });
    assert.deepEqual(await store.append(id, bytes, 0), { ok: false, code: 'bad-id' });
    assert.deepEqual(await store.replace(id, bytes, { keepPrevious: true }), { ok: false, code: 'bad-id' });
    assert.deepEqual(await store.restore(id), { ok: false, code: 'bad-id' });
    assert.deepEqual(await store.dropPrevious(id), { ok: false, code: 'bad-id' });
  }
  assert.equal(await exists(dir), false, 'the notebooks folder was never made');
  assert.equal(await exists(path.join(path.dirname(dir), 'escape.notes')), false);
});

test('a missing notebook reads as empty bytes, and the folder is made on the first write', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const empty = await store.read('claude');
  assert.equal(empty.ok, true);
  assert.equal(empty.size, 0);
  assert.ok(empty.bytes instanceof Uint8Array);
  assert.equal(empty.bytes.length, 0);
  assert.equal(await exists(dir), false, 'reading makes nothing');
  const first = frame(notes(3), 11);
  assert.deepEqual(await store.append('claude', first, 0), { ok: true, size: first.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), first);
  const read = await store.read('claude');
  assert.deepEqual(read.bytes, first);
  assert.equal(read.size, first.length);
  assert.equal(read.bytes.buffer.byteLength, read.bytes.length, 'an exact-size copy, never a view of a bigger buffer');
  assert.deepEqual(await readdir(dir), ['claude.notes'], 'only the notebook, no temp files');
});

test('append at the file’s size adds to the end, frame after frame', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const frames = [frame(notes(1, 1), 1), frame(notes(12, 2), 2), frame(notes(0), 3), frame(notes(40, 4), 4)];
  let at = 0;
  for (const bytes of frames) {
    const result = await store.append('jev', bytes, at);
    assert.deepEqual(result, { ok: true, size: at + bytes.length });
    at = result.size;
  }
  const file = await onDisk(dir, 'jev.notes');
  assert.deepEqual(file, concat(...frames));
  const read = unframe(file);
  assert.equal(read.frames, 4);
  assert.equal(read.good, file.length);
  assert.equal(read.lastKey, 4);
  assert.equal(read.notes.length, (1 + 12 + 0 + 40) * 24);
  const two = concat(frame(notes(2, 5), 5), frame(notes(3, 6), 6));
  assert.deepEqual(await store.append('jev', two, at), { ok: true, size: at + two.length }, 'one append may hold several whole frames');
});

test('append says moved, with the real size, when the file is shorter than at, and writes nothing', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const bytes = frame(notes(2), 1);
  assert.deepEqual(await store.append('codex', bytes, 5), { ok: false, code: 'moved', size: 0 }, 'no file yet');
  assert.equal(await exists(dir), false);
  await store.append('codex', bytes, 0);
  assert.deepEqual(await store.append('codex', bytes, bytes.length + 1), { ok: false, code: 'moved', size: bytes.length });
  assert.deepEqual(await store.append('codex', bytes, bytes.length * 3), { ok: false, code: 'moved', size: bytes.length });
  assert.deepEqual(await onDisk(dir, 'codex.notes'), bytes, 'nothing written on moved');
  assert.deepEqual(await store.append('codex', bytes, bytes.length), { ok: true, size: bytes.length * 2 }, 'the exact size appends');
});

test('a torn frame past at is truncated and the append lands after the good frames', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const good = concat(frame(notes(2, 1), 1), frame(notes(4, 2), 2));
  const next = frame(notes(3, 3), 3);
  const cases = {
    'half of a five-note frame': frame(notes(5, 9), 9).subarray(0, 70),
    'every byte but the last of a frame': frame(notes(5, 9), 9).subarray(0, FRAME_HEADER + 5 * 24 - 1),
    'a header cut short': frame(notes(5, 9), 9).subarray(0, 5),
    'one stray byte': new Uint8Array([0x4e]),
    'a whole frame whose notes didn’t reach the disk (bad CRC)': (() => { const f = frame(notes(5, 9), 9); f[FRAME_HEADER + 3] ^= 0xff; return f; })(),
    'zeros from a crash': new Uint8Array(200),
    'a torn biggest append (a frame of 2,730 notes, 65,000 bytes in)': frame(notes(2730, 7), 7).subarray(0, 65000),
    'exactly MAX_APPEND bytes: a biggest frame with a bad CRC, then a torn header': (() => {
      const f = frame(notes(2730, 7), 7);
      f[FRAME_HEADER] ^= 1;
      return concat(f, new Uint8Array([0x4e, 0x42, 0x01]));
    })(),
  };
  await mkdir(dir, { recursive: true });
  assert.equal(cases['exactly MAX_APPEND bytes: a biggest frame with a bad CRC, then a torn header'].length, MAX_APPEND);
  for (const [name, torn] of Object.entries(cases)) {
    await writeFile(path.join(dir, 'claude.notes'), concat(good, torn));
    const renderer = unframe(await onDisk(dir, 'claude.notes'));
    assert.equal(renderer.good, good.length, `${name}: the renderer's good stops before the tear`);
    const result = await store.append('claude', next, renderer.good);
    assert.deepEqual(result, { ok: true, size: good.length + next.length }, name);
    const after = await onDisk(dir, 'claude.notes');
    assert.deepEqual(after, concat(good, next), `${name}: the tear is gone and the new frame follows`);
    assert.equal(unframe(after).lastKey, 3, name);
  }
});

test('a torn tail with nothing to append is still cleared', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const good = frame(notes(2), 1);
  await store.append('claude', good, 0);
  await writeFile(path.join(dir, 'claude.notes'), concat(good, frame(notes(3), 2).subarray(0, 20)));
  assert.deepEqual(await store.append('claude', new Uint8Array(0), good.length), { ok: true, size: good.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), good);
});

test('more than MAX_APPEND unreadable bytes past at are left alone and refused', async (t) => {
  const { dir } = await tempDir(t);
  const reports = [];
  const store = createNotebookStore({ dir, report: (message) => reports.push(message) });
  const good = frame(notes(2), 1);
  const garbage = new Uint8Array(MAX_APPEND + 1).fill(0x55);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'claude.notes'), concat(good, garbage));
  const result = await store.append('claude', frame(notes(1), 2), good.length);
  assert.deepEqual(result, { ok: false, code: 'failed', size: good.length + garbage.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), concat(good, garbage), 'never truncated past one append');
  assert.equal(reports.length, 1);
});

test('a committed round is never cut off: whole good frames past at mean moved, never truncation', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const one = frame(notes(2, 1), 101);
  const two = frame(notes(3, 2), 102);
  await store.append('claude', one, 0);
  await store.append('claude', two, one.length);
  const three = frame(notes(1, 3), 103);
  // A renderer that lost track of round 102 (a stale at) is told the file moved…
  assert.deepEqual(await store.append('claude', three, one.length), { ok: false, code: 'moved', size: one.length + two.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), concat(one, two), 'round 102 is still there');
  // …even with a tear after the round it didn't know about, or a bad-CRC frame before it.
  const bad = (() => { const f = frame(notes(2, 9), 9); f[FRAME_HEADER] ^= 1; return f; })();
  await writeFile(path.join(dir, 'claude.notes'), concat(one, bad, two, frame(notes(4), 5).subarray(0, 30)));
  assert.equal((await store.append('claude', three, one.length)).code, 'moved');
  // Re-reading gives the right at, and the tear (only) goes.
  const reread = unframe(await onDisk(dir, 'claude.notes'));
  assert.equal(reread.lastKey, 102);
  assert.deepEqual(await store.append('claude', three, reread.good), { ok: true, size: reread.good + three.length });
  const final = unframe(await onDisk(dir, 'claude.notes'));
  assert.equal(final.frames, 3);
  assert.equal(final.lastKey, 103);
  assert.equal(final.torn, 0);
});

test('an at that isn’t where the good frames end hears moved, wherever it lands, and nothing is cut', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const one = frame(notes(2, 1), 201);
  const two = frame(notes(3, 2), 202);
  const next = frame(notes(1, 3), 203);
  const tear = frame(notes(4, 9), 9).subarray(0, 40);
  const bad = (() => { const f = frame(notes(2, 8), 8); f[FRAME_HEADER] ^= 1; return f; })();
  const files = {
    'two rounds': concat(one, two),
    'two rounds and a tear': concat(one, two, tear),
    'two rounds, a bad-CRC frame and a tear': concat(one, two, bad, tear),
  };
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    const good = one.length + two.length;
    assert.equal(unframe(bytes).good, good, name);
    const ats = {
      'five bytes before the end of the last round (a renderer bug)': good - 5,
      'one byte before the end': good - 1,
      'inside the last round’s header': one.length + 3,
      'inside the first round': 20,
      'at the start of the last round (a stale at)': one.length,
      'at 0': 0,
    };
    if (bytes.length > good) {
      ats['inside the tear past the good frames'] = bytes.length - 10;
      ats['one byte past the good frames'] = good + 1;
    }
    for (const [where, at] of Object.entries(ats)) {
      await writeFile(path.join(dir, 'claude.notes'), bytes);
      assert.deepEqual(await store.append('claude', next, at), { ok: false, code: 'moved', size: bytes.length }, `${name}, ${where}`);
      assert.deepEqual(await onDisk(dir, 'claude.notes'), bytes, `${name}, ${where}: nothing cut, nothing written`);
    }
    // The re-read's good is the at that appends, and only what's past it goes.
    const reread = unframe(await onDisk(dir, 'claude.notes'));
    assert.deepEqual(await store.append('claude', next, reread.good), { ok: true, size: good + next.length }, name);
    assert.deepEqual(await onDisk(dir, 'claude.notes'), concat(one, two, next), name);
  }
});

// A seeded stream for the property test below (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test('main’s goodEnd reads a file exactly as unframe does, over 1,000 seeded files', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 1000; seed += 1) {
    const next = seeded(seed);
    const pick = (n) => Math.floor(next() * n);
    const parts = [];
    for (let i = pick(8); i >= 0; i -= 1) {
      const f = frame(notes(1 + pick(6), seed + i), seed * 10 + i);
      const kind = pick(6);
      kinds.add(kind);
      if (kind === 0 || kind === 1) parts.push(f); // a good frame
      else if (kind === 2) { f[FRAME_HEADER + pick(f.length - FRAME_HEADER)] ^= 0xff; parts.push(f); } // a whole frame, bad CRC
      else if (kind === 3) parts.push(f.subarray(0, pick(f.length))); // a torn frame
      else if (kind === 4) parts.push(pick(2) ? new Uint8Array(pick(40)) : Uint8Array.from({ length: pick(30) }, () => pick(256))); // zeros or junk
      else { f[2] = 2; parts.push(f); } // a version-2 frame
    }
    const bytes = concat(...parts);
    assert.equal(goodEnd(bytes), unframe(bytes).good, `seed ${seed}`);
  }
  assert.equal(kinds.size, 6, 'every kind of piece came up');
  assert.equal(goodEnd(new Uint8Array(0)), 0);
  const one = frame(notes(2), 1);
  assert.equal(goodEnd(concat(one, one, new Uint8Array([0x4e, 0x42]))), one.length * 2);
});

test('a relaunch between the append and the state save writes the round once and loses nothing', async (t) => {
  const { dir } = await tempDir(t);
  // Session 1: rounds 1–3 are appended and saved (count 6 in state); round 4 is appended, then MILO
  // stops before its state save lands.
  const first = createNotebookStore({ dir });
  const rounds = [[1, 2], [2, 1], [3, 3], [4, 2]].map(([key, n]) => ({ key, bytes: frame(notes(n, key), key) }));
  let at = 0;
  for (const round of rounds) at = (await first.append('claude', round.bytes, at)).size;
  const savedCount = 6; // the hint in state.json: rounds 1–3 only
  await first.flush();

  // Session 2: a fresh store (a relaunch). The renderer reads the file, which is the source of truth.
  const second = createNotebookStore({ dir });
  const read = await second.read('claude');
  const view = unframe(read.bytes);
  assert.equal(view.notes.length / 24, 8, 'the file has round 4, whatever the state said');
  assert.notEqual(view.notes.length / 24, savedCount);
  assert.equal(view.lastKey, 4);
  // A renderer working from the state's stale hint would be told moved, never allowed to cut round 4.
  const staleAt = rounds.slice(0, 3).reduce((sum, round) => sum + round.bytes.length, 0);
  assert.equal((await second.append('claude', rounds[3].bytes, staleAt)).code, 'moved');
  // The fight resumes from the saved battle and commits round 4 again: its key is the file's
  // lastKey, so the renderer skips it (§10.2), then round 5 appends at good.
  const replayed = rounds[3];
  const toWrite = replayed.key === view.lastKey ? [] : [replayed];
  assert.equal(toWrite.length, 0);
  const five = frame(notes(2, 5), 5);
  assert.deepEqual(await second.append('claude', five, view.good), { ok: true, size: view.good + five.length });
  const final = unframe(await onDisk(dir, 'claude.notes'));
  assert.equal(final.frames, 5, 'rounds 1–5, each once');
  assert.equal(final.notes.length / 24, 10);
});

// A stand-in for node:fs/promises whose file handles fail on cue, like a crash or a full disk.
function faultyFs({ writeLimit = Infinity, failSync = false, failStat = null } = {}) {
  const fs = {
    ...realFs,
    async stat(file) {
      if (failStat) throw Object.assign(new Error('denied'), { code: failStat });
      return realFs.stat(file);
    },
    async open(file, flags, mode) {
      const handle = await realFs.open(file, flags, mode);
      if (flags !== 'r+' && flags !== 'wx') return handle;
      return {
        truncate: (length) => handle.truncate(length),
        stat: () => handle.stat(),
        close: () => handle.close(),
        read: (...args) => handle.read(...args),
        async write(buffer, offset, length, position) {
          if (writeLimit <= 0) throw Object.assign(new Error('the power went'), { code: 'EIO' });
          const take = Math.min(length, writeLimit);
          const result = await handle.write(buffer, offset, take, position);
          writeLimit -= result.bytesWritten;
          if (take < length) throw Object.assign(new Error('the power went'), { code: 'EIO' });
          return result;
        },
        async sync() {
          if (failSync) throw Object.assign(new Error('the disk said no'), { code: 'EIO' });
          return handle.sync();
        },
      };
    },
  };
  return fs;
}

test('a crash part-way through an append leaves a tear the next append clears', async (t) => {
  const { dir } = await tempDir(t);
  const good = frame(notes(3, 1), 1);
  await createNotebookStore({ dir }).append('claude', good, 0);
  const next = frame(notes(6, 2), 2);
  const reports = [];
  const crashing = createNotebookStore({ dir, fs: faultyFs({ writeLimit: 40 }), report: (m) => reports.push(m) });
  assert.deepEqual(await crashing.append('claude', next, good.length), { ok: false, code: 'failed' });
  assert.equal(reports.length, 1);
  const torn = await onDisk(dir, 'claude.notes');
  assert.equal(torn.length, good.length + 40, 'half a frame reached the disk');
  assert.equal(unframe(torn).good, good.length);
  // The renderer never advanced its at, and retries (or relaunches and re-reads: the same at).
  const store = createNotebookStore({ dir });
  assert.deepEqual(await store.append('claude', next, good.length), { ok: true, size: good.length + next.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), concat(good, next));
});

test('an append whose fsync failed is found whole on retry, and is never written twice', async (t) => {
  const { dir } = await tempDir(t);
  const good = frame(notes(3, 1), 1);
  await createNotebookStore({ dir }).append('claude', good, 0);
  const next = frame(notes(2, 2), 2);
  const flaky = createNotebookStore({ dir, fs: faultyFs({ failSync: true }) });
  assert.equal((await flaky.append('claude', next, good.length)).code, 'failed');
  const store = createNotebookStore({ dir });
  // The bytes did land: a retry at the old at hears moved, and the re-read's lastKey skips the frame.
  assert.deepEqual(await store.append('claude', next, good.length), { ok: false, code: 'moved', size: good.length + next.length });
  const view = unframe((await store.read('claude')).bytes);
  assert.equal(view.lastKey, 2);
  assert.equal(view.frames, 2, 'once, not twice');
});

test('append refuses bytes that aren’t whole, good version-1 frames, and a bad at', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const okFrame = frame(notes(2), 1);
  const badCrc = frame(notes(2), 1); badCrc[FRAME_HEADER] ^= 1;
  const badMagic = frame(notes(2), 1); badMagic[0] = 0;
  const version2 = frame(notes(2), 1); version2[2] = 2;
  const refusedBytes = {
    'half a frame': okFrame.subarray(0, 20),
    'a frame and a stray byte': concat(okFrame, new Uint8Array([1])),
    'a bad CRC': badCrc,
    'a bad magic': badMagic,
    'version 2': version2,
    'a good frame after a bad one': concat(badCrc, okFrame),
    'a plain array': [...okFrame],
    'an ArrayBuffer': okFrame.buffer,
    'a Uint16Array': new Uint16Array(8),
    'a string': 'notes',
    null: null,
  };
  for (const [name, bytes] of Object.entries(refusedBytes)) {
    assert.deepEqual(await store.append('claude', bytes, 0), { ok: false, code: 'bad-frame' }, name);
  }
  for (const at of [-1, 1.5, NaN, Infinity, '0', null, undefined, MAX_FILE + 1]) {
    assert.deepEqual(await store.append('claude', okFrame, at), { ok: false, code: 'bad-frame' }, String(at));
  }
  assert.equal(await exists(dir), false, 'nothing was written');
  assert.equal(checkFrames(new Uint8Array(0)).ok, true, 'no frames at all is whole');
  assert.deepEqual(checkFrames(concat(okFrame, okFrame)), { ok: true, frames: 2 });
  // A Buffer is a Uint8Array too, and the store keeps its own copy.
  const mine = Buffer.from(okFrame);
  const pending = store.append('claude', mine, 0);
  mine.fill(0);
  assert.equal((await pending).ok, true);
  assert.deepEqual(await onDisk(dir, 'claude.notes'), okFrame, 'changing the caller’s bytes afterwards changes nothing');
});

// Whole, good frames of exactly `total` bytes: `count` frames (13 bytes each) whose notes (24 bytes
// each) make up the rest, spread as evenly as they go.
function framesOf(total, count, seed = 1) {
  const noteCount = (total - count * FRAME_HEADER) / 24;
  assert.ok(Number.isInteger(noteCount) && noteCount >= 0, `${total} bytes in ${count} frames`);
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const n = Math.floor(noteCount / count) + (i < noteCount % count ? 1 : 0);
    parts.push(frame(notes(n, seed + i), seed * 100 + i));
  }
  const bytes = concat(...parts);
  assert.equal(bytes.length, total);
  assert.equal(checkFrames(bytes).ok, true);
  return bytes;
}

// A file of `size` zero bytes, made sparse with truncate.
async function sparse(file, size) {
  const handle = await open(file, 'w');
  await handle.truncate(size);
  await handle.close();
}

test('caps: an append of exactly 64 KiB goes, and one byte more is too large', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  assert.equal(MAX_APPEND, 65536);
  assert.equal(FRAME_HEADER, 13);
  const exact = framesOf(MAX_APPEND, 16); // 16 × 13 + 2,722 × 24 = 65,536
  assert.deepEqual(await store.append('claude', exact, 0), { ok: true, size: MAX_APPEND }, 'exactly MAX_APPEND');
  const oneMore = framesOf(MAX_APPEND + 1, 5); // 5 × 13 + 2,728 × 24 = 65,537
  assert.deepEqual(await store.append('claude', oneMore, MAX_APPEND), { ok: false, code: 'too-large' }, 'MAX_APPEND + 1');
  assert.deepEqual(await store.append('claude', concat(exact, frame(notes(0), 9)), MAX_APPEND), { ok: false, code: 'too-large' });
  assert.equal((await stat(path.join(dir, 'claude.notes'))).size, MAX_APPEND, 'nothing written for the refused ones');
  // A torn tail of exactly MAX_APPEND bytes is still a tear; one byte more is left alone.
  const first = frame(notes(1), 1);
  await writeFile(path.join(dir, 'jev.notes'), concat(first, new Uint8Array(MAX_APPEND)));
  assert.deepEqual(await store.append('jev', frame(notes(1), 2), first.length), { ok: true, size: first.length * 2 }, 'a tail of exactly MAX_APPEND is cleared');
  await writeFile(path.join(dir, 'jev.notes'), concat(first, new Uint8Array(MAX_APPEND + 1)));
  assert.equal((await store.append('jev', frame(notes(1), 2), first.length)).code, 'failed', 'MAX_APPEND + 1 is not');
});

test('caps: a file may reach exactly 16 MiB, never a byte past it', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  assert.equal(MAX_FILE, 16 * 1024 * 1024);
  await mkdir(dir, { recursive: true });
  // An append that lands the file exactly on MAX_FILE goes, whether it's small or the biggest.
  await sparse(path.join(dir, 'jev.notes'), MAX_FILE - FRAME_HEADER);
  assert.deepEqual(await store.append('jev', frame(notes(0), 1), MAX_FILE - FRAME_HEADER), { ok: true, size: MAX_FILE }, 'a 13-byte frame to the byte');
  await sparse(path.join(dir, 'pip.notes'), MAX_FILE - MAX_APPEND);
  assert.deepEqual(await store.append('pip', framesOf(MAX_APPEND, 16), MAX_FILE - MAX_APPEND), { ok: true, size: MAX_FILE }, '64 KiB to the byte');
  // One byte more is too large, and nothing is written.
  await sparse(path.join(dir, 'mae.notes'), MAX_FILE - FRAME_HEADER + 1);
  assert.deepEqual(await store.append('mae', frame(notes(0), 1), MAX_FILE - FRAME_HEADER + 1), { ok: false, code: 'too-large', size: MAX_FILE - FRAME_HEADER + 1 });
  assert.equal((await stat(path.join(dir, 'mae.notes'))).size, MAX_FILE - FRAME_HEADER + 1);
  assert.deepEqual(await store.append('jev', frame(notes(0), 2), MAX_FILE), { ok: false, code: 'too-large', size: MAX_FILE }, 'a full file takes nothing more');
  assert.deepEqual(await store.append('jev', new Uint8Array(0), MAX_FILE), { ok: true, size: MAX_FILE }, 'at may be MAX_FILE itself');
  assert.deepEqual(await store.append('jev', new Uint8Array(0), MAX_FILE + 1), { ok: false, code: 'bad-frame' });
  // A file of exactly MAX_FILE reads; one past it doesn't, and takes no append.
  const full = await store.read('jev');
  assert.equal(full.ok, true);
  assert.equal(full.size, MAX_FILE);
  assert.equal(full.bytes.length, MAX_FILE);
  await sparse(path.join(dir, 'lumi.notes'), MAX_FILE + 1);
  assert.deepEqual(await store.read('lumi'), { ok: false, code: 'too-large', size: MAX_FILE + 1 });
  assert.deepEqual(await store.append('lumi', new Uint8Array(0), 0), { ok: false, code: 'too-large', size: MAX_FILE + 1 });
  // A reset may write exactly MAX_FILE of whole frames, never more.
  const whole = framesOf(MAX_FILE, 16, 7); // 16 × 13 + 699,042 × 24; one byte more is 29 × 13 + 699,035 × 24
  assert.deepEqual(await store.replace('tova', whole), { ok: true, size: MAX_FILE });
  assert.equal((await stat(path.join(dir, 'tova.notes'))).size, MAX_FILE);
  assert.deepEqual(await store.replace('tova', framesOf(MAX_FILE + 1, 29, 8)), { ok: false, code: 'too-large' });
  assert.deepEqual(await store.replace('tova', new Uint8Array(MAX_FILE + 13)), { ok: false, code: 'too-large' });
});

test('caps: near 16 MiB, a torn tail doesn’t count against the room, only where the append lands', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  // Good frames up to 37 bytes short of MAX_FILE, then half of a 37-byte frame torn off by a crash.
  const one = frame(notes(1, 3), 3);
  const at = MAX_FILE - one.length;
  const good = framesOf(at, 15, 5); // 15 × 13 + 699,041 × 24
  const tear = one.subarray(0, 20);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'claude.notes'), concat(good, tear));
  const size = at + tear.length;
  assert.ok(size <= MAX_FILE && size + one.length > MAX_FILE, 'the tear plus the append would pass MAX_FILE; the append alone wouldn’t');
  // A frame that wouldn't fit even once the tear is gone is refused, and the tear is left for later.
  const two = frame(notes(2, 4), 4);
  assert.deepEqual(await store.append('claude', two, at), { ok: false, code: 'too-large', size });
  assert.equal((await stat(path.join(dir, 'claude.notes'))).size, size, 'nothing truncated for a refused append');
  // One that fits where the good frames end goes: the tear is cleared first.
  assert.deepEqual(await store.append('claude', one, at), { ok: true, size: MAX_FILE });
  const file = await onDisk(dir, 'claude.notes');
  assert.equal(file.length, MAX_FILE);
  assert.deepEqual(file.subarray(at), one);
  assert.equal(goodEnd(file), MAX_FILE);
});

test('replace writes the whole file, and keepPrevious keeps the old one as .previous', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const old = concat(frame(notes(3, 1), 1), frame(notes(2, 2), 2));
  await store.append('claude', old, 0);
  const lesson = frame(notes(1, 9), 9);
  assert.deepEqual(await store.replace('claude', lesson), { ok: true, size: lesson.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), lesson);
  assert.equal(await exists(path.join(dir, 'claude.notes.previous')), false, 'no previous unless asked');

  await store.replace('claude', old);
  assert.deepEqual(await store.replace('claude', new Uint8Array(0), { keepPrevious: true }), { ok: true, size: 0 }, 'a reset to a blank page');
  assert.deepEqual(await onDisk(dir, 'claude.notes'), new Uint8Array(0));
  assert.deepEqual(await onDisk(dir, 'claude.notes.previous'), old);
  assert.deepEqual(await store.replace('claude', lesson, { keepPrevious: 'yes' }), { ok: true, size: lesson.length }, 'only true keeps');
  assert.deepEqual(await onDisk(dir, 'claude.notes.previous'), old, 'the previous stays until dropped');
  assert.deepEqual(await store.replace('claude', frame(notes(2), 1).subarray(0, 10)), { ok: false, code: 'bad-frame' });
  assert.deepEqual(await store.replace('claude', 'notes'), { ok: false, code: 'bad-frame' });
  assert.deepEqual(await store.replace('jev', lesson, { keepPrevious: true }), { ok: true, size: lesson.length }, 'a notebook with no file yet');
  assert.deepEqual(await onDisk(dir, 'jev.notes.previous'), new Uint8Array(0));
  assert.deepEqual((await readdir(dir)).sort(), ['claude.notes', 'claude.notes.previous', 'jev.notes', 'jev.notes.previous'], 'no temp files left');
});

test('a reset before any fight is the first write: replace makes the folder', async (t) => {
  // A notebook reset before the companion has ever fought: no notebooks folder exists yet.
  const page = frame(notes(2, 4), 4);
  const kept = await tempDir(t);
  assert.equal(await exists(kept.dir), false);
  const store = createNotebookStore({ dir: kept.dir });
  assert.deepEqual(await store.replace('jev', page, { keepPrevious: true }), { ok: true, size: page.length });
  assert.deepEqual(await onDisk(kept.dir, 'jev.notes'), page);
  assert.deepEqual(await onDisk(kept.dir, 'jev.notes.previous'), new Uint8Array(0), 'an empty previous: there was no page before');
  assert.deepEqual((await readdir(kept.dir)).sort(), ['jev.notes', 'jev.notes.previous']);
  const plain = await tempDir(t);
  assert.deepEqual(await createNotebookStore({ dir: plain.dir }).replace('claude', new Uint8Array(0)), { ok: true, size: 0 }, 'and without a previous');
  assert.deepEqual(await readdir(plain.dir), ['claude.notes']);
});

test('restore brings the previous back once, and a repeat hears none rather than the reset’s page', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  assert.deepEqual(await store.restore('claude'), { ok: false, code: 'none' }, 'nothing to restore');
  const old = concat(frame(notes(3, 1), 1), frame(notes(2, 2), 2));
  await store.append('claude', old, 0);
  await store.replace('claude', new Uint8Array(0), { keepPrevious: true });
  const afterReset = frame(notes(1, 3), 3);
  await store.append('claude', afterReset, 0);
  assert.deepEqual(await store.restore('claude'), { ok: true, size: old.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), old, 'the old notebook is current again');
  assert.equal(await exists(path.join(dir, 'claude.notes.previous')), false, 'the previous is used up');
  // A retry after a lost reply, or a second click: the old notebook stays current.
  assert.deepEqual(await store.restore('claude'), { ok: false, code: 'none' });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), old, 'never flipped back to the reset’s page');
  // A double click queues both before either runs: the first restores, the second hears none.
  await store.replace('claude', afterReset, { keepPrevious: true });
  assert.deepEqual(await Promise.all([store.restore('claude'), store.restore('claude')]), [{ ok: true, size: old.length }, { ok: false, code: 'none' }]);
  assert.deepEqual(await onDisk(dir, 'claude.notes'), old);
  // New rounds on the restored notebook survive a late repeat.
  const next = frame(notes(1, 5), 5);
  assert.deepEqual(await store.append('claude', next, old.length), { ok: true, size: old.length + next.length });
  assert.deepEqual(await store.restore('claude'), { ok: false, code: 'none' });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), concat(old, next));
  assert.deepEqual(await readdir(dir), ['claude.notes'], 'no temp files left');
});

test('drop forgets a previous, and dropping nothing is fine', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const old = frame(notes(3, 1), 1);
  await store.append('claude', old, 0);
  await store.replace('claude', new Uint8Array(0), { keepPrevious: true });
  assert.deepEqual(await store.dropPrevious('claude'), { ok: true });
  assert.equal(await exists(path.join(dir, 'claude.notes.previous')), false);
  assert.deepEqual(await store.restore('claude'), { ok: false, code: 'none' }, 'nothing left to restore after the Campfire');
  assert.deepEqual(await onDisk(dir, 'claude.notes'), new Uint8Array(0));
  assert.deepEqual(await store.dropPrevious('claude'), { ok: true }, 'dropping nothing is fine');
  assert.deepEqual(await store.dropPrevious('jev'), { ok: true }, 'even with no folder');
});

test('restore writes the old notebook back before it lets the previous go, so a crash between loses nothing', async (t) => {
  const { dir } = await tempDir(t);
  const old = concat(frame(notes(3, 1), 1), frame(notes(2, 2), 2));
  const page = frame(notes(1, 3), 3);
  const setUp = async () => {
    const store = createNotebookStore({ dir });
    await store.replace('claude', old);
    await store.replace('claude', page, { keepPrevious: true });
  };
  // The write of the current file fails (a full disk, a crash): nothing has changed, and the
  // previous is still there to try again.
  await setUp();
  const reports = [];
  const full = createNotebookStore({ dir, atomicWrite: async () => { throw new Error('the disk is full'); }, report: (m) => reports.push(m) });
  assert.deepEqual(await full.restore('claude'), { ok: false, code: 'failed' });
  assert.equal(reports.length, 1);
  assert.deepEqual(await onDisk(dir, 'claude.notes'), page, 'the current file is as it was');
  assert.deepEqual(await onDisk(dir, 'claude.notes.previous'), old, 'the previous was never let go first');
  assert.deepEqual(await createNotebookStore({ dir }).restore('claude'), { ok: true, size: old.length }, 'a retry restores it');
  assert.deepEqual(await onDisk(dir, 'claude.notes'), old);
  // The previous can't be let go (a locked file): the old notebook is already current, so the
  // restore stands and the leftover holds the same bytes; a retry writes the same bytes again.
  await setUp();
  reports.length = 0;
  const locked = createNotebookStore({
    dir,
    fs: { ...realFs, async unlink(file) { if (file.endsWith('.previous')) throw Object.assign(new Error('in use'), { code: 'EBUSY' }); return realFs.unlink(file); } },
    report: (m) => reports.push(m),
  });
  assert.deepEqual(await locked.restore('claude'), { ok: true, size: old.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), old, 'the current file was written first');
  assert.deepEqual(await onDisk(dir, 'claude.notes.previous'), old);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /^Notebook claude was restored, but its old page couldn't be let go: in use/);
  const store = createNotebookStore({ dir });
  assert.deepEqual(await store.restore('claude'), { ok: true, size: old.length });
  assert.deepEqual(await onDisk(dir, 'claude.notes'), old);
  assert.deepEqual(await store.restore('claude'), { ok: false, code: 'none' });
});

test('every write is refused while blocked, and reads still work', async (t) => {
  const { dir } = await tempDir(t);
  let blocked = false;
  const store = createNotebookStore({ dir, blocked: () => blocked });
  const bytes = frame(notes(2), 1);
  await store.append('claude', bytes, 0);
  await store.replace('claude', bytes, { keepPrevious: true });
  const before = { current: await onDisk(dir, 'claude.notes'), previous: await onDisk(dir, 'claude.notes.previous') };
  blocked = true;
  assert.deepEqual(await store.append('claude', frame(notes(1), 2), bytes.length), { ok: false, code: 'blocked' });
  assert.deepEqual(await store.append('jev', frame(notes(1), 2), 0), { ok: false, code: 'blocked' });
  assert.deepEqual(await store.replace('claude', new Uint8Array(0), { keepPrevious: true }), { ok: false, code: 'blocked' });
  assert.deepEqual(await store.restore('claude'), { ok: false, code: 'blocked' });
  assert.deepEqual(await store.dropPrevious('claude'), { ok: false, code: 'blocked' });
  assert.deepEqual((await store.read('claude')).bytes, bytes, 'reading is still allowed');
  assert.deepEqual(await onDisk(dir, 'claude.notes'), before.current);
  assert.deepEqual(await onDisk(dir, 'claude.notes.previous'), before.previous);
  assert.equal(await exists(path.join(dir, 'jev.notes')), false);
  const throwing = createNotebookStore({ dir, blocked: () => { throw new Error('no'); } });
  assert.deepEqual(await throwing.append('claude', frame(notes(1), 2), bytes.length), { ok: false, code: 'blocked' }, 'a broken check counts as blocked');
  blocked = false;
  assert.equal((await store.append('claude', frame(notes(1), 2), bytes.length)).ok, true);
});

test('writes for one notebook run in call order, and flush waits for every one of them', async (t) => {
  const { dir } = await tempDir(t);
  const store = createNotebookStore({ dir });
  const frames = Array.from({ length: 30 }, (_, i) => frame(notes(1 + (i % 5), i), i + 1));
  const pending = [];
  let at = 0;
  for (const bytes of frames) {
    pending.push(store.append('claude', bytes, at));
    pending.push(store.append('codex', bytes, at));
    at += bytes.length;
  }
  let settled = 0;
  for (const write of pending) write.then(() => { settled += 1; });
  await store.flush();
  assert.equal(settled, pending.length, 'every queued write was done when flush resolved');
  for (const result of await Promise.all(pending)) assert.equal(result.ok, true);
  const all = concat(...frames);
  assert.deepEqual(await onDisk(dir, 'claude.notes'), all);
  assert.deepEqual(await onDisk(dir, 'codex.notes'), all);
  await store.flush(); // nothing queued: resolves at once
});

test('flush waits for a write queued after every other queue has drained, while it’s still waiting', async (t) => {
  const { dir } = await tempDir(t);
  // A disk that holds claude's last write until the test lets it go, so claude's is the last
  // queue flush waits on, after codex's has drained.
  let opens = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fs = {
    ...realFs,
    async open(file, flags, mode) {
      if (path.basename(file) === 'claude.notes' && flags !== 'r' && ++opens === 3) await gate;
      return realFs.open(file, flags, mode);
    },
  };
  const store = createNotebookStore({ dir, fs });
  const frames = [1, 2, 3].map((key) => frame(notes(key, key), key));
  const claude = [];
  const codex = [];
  let at = 0;
  for (const bytes of frames) {
    claude.push(store.append('claude', bytes, at));
    codex.push(store.append('codex', bytes, at));
    at += bytes.length;
  }
  let flushed = false;
  let late = null;
  let lateDone = false;
  let queuedWhileWaiting = null;
  // Queued the moment claude's last write settles: codex's queue has drained by then (below), so
  // this is the only write left, and flush is still waiting.
  claude[2].then(() => {
    queuedWhileWaiting = !flushed;
    late = store.append('jev', frames[0], 0);
    late.then(() => { lateDone = true; });
  });
  const flushing = store.flush().then(() => { flushed = true; });
  assert.deepEqual((await Promise.all(codex)).map((result) => result.ok), [true, true, true]);
  assert.equal(flushed, false, 'flush waits for the held claude write');
  assert.equal(late, null, 'nothing else is queued yet');
  release();
  await flushing;
  assert.equal(queuedWhileWaiting, true, 'the late write was queued while flush was still waiting');
  assert.equal(lateDone, true, 'flush resolved only after the late write was done');
  assert.deepEqual(await late, { ok: true, size: frames[0].length });
  assert.deepEqual(await onDisk(dir, 'jev.notes'), frames[0]);
  assert.deepEqual(await onDisk(dir, 'claude.notes'), concat(...frames));
});

test('a disk that says no gives failed, never a thrown error', async (t) => {
  const { dir } = await tempDir(t);
  const reports = [];
  const store = createNotebookStore({ dir, fs: faultyFs({ failStat: 'EACCES' }), report: (m) => reports.push(m) });
  assert.deepEqual(await store.read('claude'), { ok: false, code: 'failed' });
  assert.deepEqual(await store.append('claude', frame(notes(1), 1), 0), { ok: false, code: 'failed' });
  assert.equal(reports.length, 2);
  assert.match(reports[0], /^Notebook claude couldn't be read: denied/);
  const blockedDir = path.join((await tempDir(t)).root, 'a-file');
  await writeFile(blockedDir, 'not a folder');
  const onFile = createNotebookStore({ dir: blockedDir });
  assert.deepEqual(await onFile.append('claude', frame(notes(1), 1), 0), { ok: false, code: 'failed' }, 'a folder that can’t be made');
  assert.throws(() => createNotebookStore({}), TypeError);
});

test('the CRC is zlib’s CRC-32, with a table for a Node without zlib.crc32', () => {
  assert.equal(tableCrc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  for (let n = 0; n < 50; n += 1) {
    const bytes = notes(n, n + 3);
    assert.equal(tableCrc32(bytes), zlib.crc32(bytes) >>> 0);
    assert.equal(crc32(bytes), zlib.crc32(bytes) >>> 0);
  }
});
