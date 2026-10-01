'use strict';

// The companions' notebooks on disk (CONTRACT-PHASE4.md §10.2): one append-only file per companion,
// <data>/notebooks/<id>.notes, plus the <id>.notes.previous a reset keeps until the next Campfire.
// Main stores bytes and never interprets notes. The file is the source of truth; the roster's
// notebook.count in state.json is only a hint the renderer reconciles when it reads the file.
//
// The renderer (src/combat/notebook.js, §7.2) writes whole frames:
//   [u16 LE 0x424e][u8 version 1][u16 LE count][u32 LE crc32 of the notes][u32 LE key] + count × 24 bytes
// This module checks an append is whole, good version-1 frames before it touches a file, and it
// never truncates anything but a torn tail. When the file is longer than `at`, it walks the whole
// file the way unframe does (goodEnd) and truncates only when `at` is exactly where the good frames
// end: what's past that is a crash mid-append. Any other `at` (behind a round the renderer hasn't
// seen, inside a frame, or inside the tear itself) hears `moved`, so a committed round is never cut
// off and a new round never lands behind bytes unframe can't step over, whatever `at` is sent.
//
//   const store = createNotebookStore({ dir, atomicWrite, blocked: () => Boolean(loadError) });
//   await store.append('claude', frameBytes, at)   // → { ok: true, size } | { ok: false, code, size? }
//
// Every call resolves (never rejects) with { ok: true, … } or { ok: false, code }. Codes:
//   bad-id     the id isn't a notebook id (isNotebookId)
//   bad-frame  the bytes aren't a Uint8Array of whole, good version-1 frames, or `at` isn't a whole
//              number from 0 to MAX_FILE
//   too-large  the append is over MAX_APPEND, or the file would pass MAX_FILE (or already has)
//   moved      the file isn't where the renderer thinks: shorter than `at`, or longer with `at` not
//              where its good frames end (goodEnd). The renderer re-reads and retries at unframe's
//              good. Carries `size`. On §10.2's path (at = good) only a shorter file says it.
//   blocked    main's saved state couldn't be read (loadError), so nothing is written
//   none       restore found no previous file (never kept, dropped, or already restored)
//   failed     the disk said no (logged through `report`); a tail of more than MAX_APPEND bytes
//              past the good frames is refused this way, never truncated (no crash leaves one)
// Writes per id run one at a time, in call order; different ids run side by side. The single-instance
// lock is what makes append-only safe; tests use their own folders.

const nodeFs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_APPEND = 65536;
const MAX_FILE = 16 * 1024 * 1024;
const FRAME_HEADER = 13;
const FRAME_MAGIC = 0x424e;
const FRAME_VERSION = 1;
const NOTE_BYTES = 24;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Windows device names, which no file may take even with an extension. COM0 and LPT0 are on
// Microsoft's list too, so they're refused along with 1–9.
const DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** A notebook id: a lowercase slug of at most 40 characters that isn't a Windows device name. */
function isNotebookId(id) {
  return typeof id === 'string' && ID.test(id) && !DEVICE.test(id);
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE, as zlib): zlib.crc32 where Node has it, else a table.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function tableCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32 = typeof zlib.crc32 === 'function' ? bytes => zlib.crc32(bytes) >>> 0 : tableCrc32;

// ---------------------------------------------------------------------------
// Frames.

// The frame starting at `offset`: { end, good } when its header and length fit inside `bytes`
// (good: the magic, version and CRC all check out), or null when it doesn't (a torn frame, or
// bytes that aren't a frame at all).
function frameAt(bytes, offset) {
  if (bytes.length - offset < FRAME_HEADER) return null;
  const magic = bytes[offset] | (bytes[offset + 1] << 8);
  if (magic !== FRAME_MAGIC || bytes[offset + 2] !== FRAME_VERSION) return null;
  const count = bytes[offset + 3] | (bytes[offset + 4] << 8);
  const end = offset + FRAME_HEADER + count * NOTE_BYTES;
  if (end > bytes.length) return null;
  const stored = (bytes[offset + 5] | (bytes[offset + 6] << 8) | (bytes[offset + 7] << 16) | (bytes[offset + 8] << 24)) >>> 0;
  return { end, good: crc32(bytes.subarray(offset + FRAME_HEADER, end)) === stored };
}

/**
 * Whether `bytes` is nothing but whole, good version-1 frames, back to back (none at all counts).
 * → { ok: boolean, frames: number }
 */
function checkFrames(bytes) {
  let offset = 0;
  let frames = 0;
  while (offset < bytes.length) {
    const frame = frameAt(bytes, offset);
    if (!frame || !frame.good) return { ok: false, frames };
    offset = frame.end;
    frames += 1;
  }
  return { ok: true, frames };
}

/**
 * Where a file's good frames end, read the way notebook.js's unframe reads (§10.2): from byte 0, a
 * whole frame with a bad CRC is stepped over, and the first thing that isn't a whole frame (a torn
 * tail, zeros, junk) ends the walk. → the offset just past the last whole, good frame: unframe's
 * `good`, 0 when there's none.
 */
function goodEnd(bytes) {
  let offset = 0;
  let good = 0;
  for (;;) {
    const frame = frameAt(bytes, offset);
    if (!frame) return good;
    if (frame.good) good = frame.end;
    offset = frame.end;
  }
}

// A copy of a Uint8Array (a Buffer is one) from this realm or another, or null.
function bytesOf(value) {
  if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8Array]') return null;
  return Buffer.from(value);
}

// ---------------------------------------------------------------------------
// The store.

async function defaultAtomicWrite(fs, filename, contents) {
  const temporary = `${filename}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'w', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filename);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * createNotebookStore({ dir, fs, atomicWrite, blocked, report }) → the store.
 * dir          <data>/notebooks (made on the first write)
 * fs           node:fs/promises, or a stand-in with the same calls (tests)
 * atomicWrite  (file, bytes) → Promise: tmp, fsync, rename (main's); a local one when absent
 * blocked      () → boolean: true while main's loadError is set, which refuses every write
 * report       (message) → void: hears about a disk failure
 */
function createNotebookStore({ dir, fs = nodeFs, atomicWrite = null, blocked = () => false, report = () => {} } = {}) {
  if (typeof dir !== 'string' || !dir) throw new TypeError('The notebooks folder is required.');
  const root = path.resolve(dir);
  const write = typeof atomicWrite === 'function' ? atomicWrite : (file, contents) => defaultAtomicWrite(fs, file, contents);
  const queues = new Map();
  const fileOf = id => path.join(root, `${id}.notes`);
  const previousOf = id => `${fileOf(id)}.previous`;
  const refuse = (code, extra) => Promise.resolve({ ok: false, code, ...extra });

  function isBlocked() {
    try {
      return blocked() === true;
    } catch {
      return true;
    }
  }

  // Runs `work` after everything already queued for this id; never rejects.
  function enqueue(id, what, work) {
    const run = (queues.get(id) || Promise.resolve()).then(async () => {
      try {
        return await work();
      } catch (error) {
        try { report(`Notebook ${id} couldn't ${what}: ${error && error.message ? error.message : error}`); } catch { /* quiet */ }
        return { ok: false, code: 'failed' };
      }
    });
    queues.set(id, run);
    run.then(() => { if (queues.get(id) === run) queues.delete(id); });
    return run;
  }

  // The file's size, or null when it isn't there.
  async function sizeOf(file) {
    try {
      return (await fs.stat(file)).size;
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function readOrNull(file) {
    try {
      return await fs.readFile(file);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  return {
    /** → { ok: true, bytes: Uint8Array, size } (a missing file is empty bytes) or { ok: false, code } */
    read(id) {
      if (!isNotebookId(id)) return refuse('bad-id');
      return enqueue(id, 'be read', async () => {
        const file = fileOf(id);
        const size = await sizeOf(file);
        if (size === null) return { ok: true, bytes: new Uint8Array(0), size: 0 };
        if (size > MAX_FILE) return { ok: false, code: 'too-large', size };
        const data = await fs.readFile(file);
        // A fresh, exact-size copy: a view into a larger buffer would carry that buffer over IPC.
        return { ok: true, bytes: new Uint8Array(data), size: data.length };
      });
    },

    /**
     * Appends whole frames at `at`, the bytes the renderer knows are there (unframe's `good` plus
     * what it has appended since). → { ok: true, size } or { ok: false, code, size? }
     */
    append(id, bytes, at) {
      if (!isNotebookId(id)) return refuse('bad-id');
      const data = bytesOf(bytes);
      if (!data || !Number.isSafeInteger(at) || at < 0 || at > MAX_FILE) return refuse('bad-frame');
      if (data.length > MAX_APPEND) return refuse('too-large');
      if (!checkFrames(data).ok) return refuse('bad-frame');
      return enqueue(id, 'take the round', async () => {
        if (isBlocked()) return { ok: false, code: 'blocked' };
        const file = fileOf(id);
        const found = await sizeOf(file);
        const size = found ?? 0;
        if (size < at) return { ok: false, code: 'moved', size };
        if (at + data.length > MAX_FILE) return { ok: false, code: 'too-large', size };
        if (size > at) {
          // Past `at` is a torn frame from a crash, which goes, only when `at` is exactly where the
          // file's good frames end. Otherwise the renderer is behind (rounds it hasn't seen, which
          // stay) or its `at` sits inside a frame or the tear: it hears `moved`, re-reads, skips
          // what's already written and appends at unframe's good. This read happens only after a
          // crash or a lost reply; an ordinary append (size === at) never reads the file.
          if (size > MAX_FILE) return { ok: false, code: 'too-large', size };
          if (goodEnd(await fs.readFile(file)) !== at) return { ok: false, code: 'moved', size };
          if (size - at > MAX_APPEND) {
            report(`Notebook ${id} has ${size - at} unreadable bytes past ${at}; they were left alone.`);
            return { ok: false, code: 'failed', size };
          }
        }
        if (size === at && !data.length) return { ok: true, size };
        if (found === null) await fs.mkdir(root, { recursive: true });
        let handle = await fs.open(file, found === null ? 'wx' : 'r+', 0o600);
        try {
          if (size > at) await handle.truncate(at);
          let written = 0;
          while (written < data.length) {
            const { bytesWritten } = await handle.write(data, written, data.length - written, at + written);
            if (!bytesWritten) throw new Error('the disk took nothing');
            written += bytesWritten;
          }
          await handle.sync();
          const final = (await handle.stat()).size;
          await handle.close();
          handle = null;
          return { ok: true, size: final };
        } finally {
          if (handle) await handle.close().catch(() => {});
        }
      });
    },

    /**
     * Replaces the whole file (a reset, or empty bytes for a fresh page). With keepPrevious the
     * old file is kept as <id>.notes.previous first (written whole before the new file, so a crash
     * between the two leaves the old notebook where it was). → { ok: true, size } or { ok: false, code }
     */
    replace(id, bytes, options) {
      if (!isNotebookId(id)) return refuse('bad-id');
      const data = bytesOf(bytes);
      if (!data) return refuse('bad-frame');
      if (data.length > MAX_FILE) return refuse('too-large');
      if (!checkFrames(data).ok) return refuse('bad-frame');
      const keepPrevious = Boolean(options && typeof options === 'object' && options.keepPrevious === true);
      return enqueue(id, 'be replaced', async () => {
        if (isBlocked()) return { ok: false, code: 'blocked' };
        const file = fileOf(id);
        await fs.mkdir(root, { recursive: true });
        if (keepPrevious) await write(previousOf(id), (await readOrNull(file)) || Buffer.alloc(0));
        await write(file, data);
        return { ok: true, size: data.length };
      });
    },

    /**
     * The previous file becomes current, once: the reset's page goes (undoing the reset is what
     * Chris chose), and so does the previous, so a repeat (a double click, a retry after a lost
     * reply) hears `none` rather than bringing the reset's page back. The current file is written
     * first, so a crash between the two steps leaves the old notebook in both places, and a retry
     * writes the same bytes again. → { ok: true, size } or { ok: false, code: 'none' | … }
     */
    restore(id) {
      if (!isNotebookId(id)) return refuse('bad-id');
      return enqueue(id, 'be restored', async () => {
        if (isBlocked()) return { ok: false, code: 'blocked' };
        const previous = await readOrNull(previousOf(id));
        if (previous === null) return { ok: false, code: 'none' };
        await write(fileOf(id), previous);
        try {
          await fs.unlink(previousOf(id));
        } catch (error) {
          // The old notebook is current either way, so the restore stands; the copy left behind
          // holds the same bytes, and the next Campfire's dropPrevious lets it go.
          if (!error || error.code !== 'ENOENT') {
            try { report(`Notebook ${id} was restored, but its old page couldn't be let go: ${error && error.message ? error.message : error}`); } catch { /* quiet */ }
          }
        }
        return { ok: true, size: previous.length };
      });
    },

    /** Forgets the previous file (the next Campfire after a reset). → { ok: true } or { ok: false, code } */
    dropPrevious(id) {
      if (!isNotebookId(id)) return refuse('bad-id');
      return enqueue(id, 'let the old page go', async () => {
        if (isBlocked()) return { ok: false, code: 'blocked' };
        try {
          await fs.unlink(previousOf(id));
        } catch (error) {
          if (!error || error.code !== 'ENOENT') throw error;
        }
        return { ok: true };
      });
    },

    /** Resolves when every queued read and write is done, including any queued while waiting. */
    async flush() {
      while (queues.size) await Promise.all([...queues.values()]);
    },
  };
}

module.exports = {
  createNotebookStore,
  isNotebookId,
  checkFrames,
  goodEnd,
  crc32,
  tableCrc32,
  MAX_APPEND,
  MAX_FILE,
  FRAME_HEADER,
  FRAME_MAGIC,
  FRAME_VERSION,
  NOTE_BYTES,
};
