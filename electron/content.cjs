'use strict';

// The content manifest (CONTRACT-PHASE4.md §9.1): every file of the game's words and tables that
// main serves to the renderer over IPC (the page's CSP blocks fetch), read once at startup.
// electron/main.cjs and scripts/world-preview-main.cjs both read through here, and ESM tests can
// import it too, so there's one list.
//
//   content = {
//     genres, riftgen, fortress, wilds, story,                    // Phase 3, content/<name>.json, unchanged
//     skills, xp, economy, spells, examine, trails, sky,          // content/<name>.json; spells is the Grimoire
//     combat: { rules, callings, spells, leads, foes, anims, tuning },       // content/combat/<name>.json
//     party: { companions: { [id]: object }, regulars, teamups, banter },   // companions/*.json by file name
//     camp: { scenes, talks: { [id]: string } },                  // content/camp/talks/*.md as raw text
//     people: { npcs: { [id]: object }, folk },                   // content/people/npcs/*.json and folk.json (Phase 5)
//   }
//
// A JSON file must parse to a plain object; anything else is null. A missing file is null, and a
// missing directory makes its group null. Directory reads are filtered by NAME and sorted by name.
// Caps: 1 MiB per file, 200 files and 8 MiB per bundle; a file past a cap is null. A UTF-8 BOM is
// stripped, and a .md file has CRLF turned into LF. Nothing outside content/ is read: symbolic
// links are skipped. The five Phase 3 keys come out exactly as main's old reader made them.

const fs = require('node:fs/promises');
const path = require('node:path');

const CONTENT_DIR = path.resolve(__dirname, '..', 'content');
const LIMITS = Object.freeze({ fileBytes: 1024 * 1024, files: 200, bundleBytes: 8 * 1024 * 1024 });
const NAME = /^[a-z0-9][a-z0-9-]{0,39}\.(json|md)$/;

/** Phase 3's five files, which the renderer needs: any trouble with one is reported. */
const PHASE3_KEYS = Object.freeze(['genres', 'riftgen', 'fortress', 'wilds', 'story']);
/** Phase 4's flat files, in content/. */
const FLAT_KEYS = Object.freeze(['skills', 'xp', 'economy', 'spells', 'examine', 'trails', 'sky']);
/** Phase 4's groups: fixed files and directories of files, by folder. */
const GROUPS = Object.freeze({
  combat: Object.freeze({ files: Object.freeze(['rules', 'callings', 'spells', 'leads', 'foes', 'anims', 'tuning']) }),
  party: Object.freeze({ dirs: Object.freeze({ companions: 'json' }), files: Object.freeze(['regulars', 'teamups', 'banter']) }),
  camp: Object.freeze({ files: Object.freeze(['scenes']), dirs: Object.freeze({ talks: 'md' }) }),
  people: Object.freeze({ files: Object.freeze(['folk']), dirs: Object.freeze({ npcs: 'json' }) }),
});

const BOM = /^﻿/;
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Reads the whole bundle. { dir } is the content folder (content/ beside electron/ by default);
 * report(message) hears about a Phase 3 file that can't be read for any reason, and a Phase 4 file
 * that's there but can't be used (a missing Phase 4 file is expected while it's being written,
 * and phase4Problem names it). → Promise<content>
 */
async function loadContent({ dir = CONTENT_DIR, report = () => {} } = {}) {
  const root = path.resolve(dir);
  const budget = { files: 0, bytes: 0 };

  // A regular file inside root (never a link), within the caps. → its text, or null with a reason.
  async function readText(relative) {
    const file = path.join(root, relative);
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { text: null, missing: true, reason: 'it is missing' };
      return { text: null, reason: error.message };
    }
    if (!stat.isFile()) return { text: null, reason: stat.isSymbolicLink() ? 'it is a link' : 'it is not a file' };
    if (stat.size > LIMITS.fileBytes) return { text: null, reason: 'it is too large' };
    if (budget.files + 1 > LIMITS.files || budget.bytes + stat.size > LIMITS.bundleBytes) return { text: null, reason: 'the bundle is full' };
    budget.files += 1;
    budget.bytes += stat.size;
    try {
      return { text: (await fs.readFile(file, 'utf8')).replace(BOM, '') };
    } catch (error) {
      return { text: null, reason: error.message };
    }
  }

  async function readJSON(relative, { required = false } = {}) {
    const { text, missing, reason } = await readText(relative);
    let value = null;
    let why = reason;
    if (text !== null) {
      try {
        const parsed = JSON.parse(text);
        if (isRecord(parsed)) value = parsed;
        else why = 'it is not an object';
      } catch (error) {
        why = error.message;
      }
    }
    if (value === null && (required || !missing)) report(`Content ${relative.split(path.sep).join('/')} unavailable: ${why}`);
    return value;
  }

  async function readMarkdown(relative) {
    const { text, missing, reason } = await readText(relative);
    if (text === null && !missing) report(`Content ${relative.split(path.sep).join('/')} unavailable: ${reason}`);
    return text === null ? null : text.replace(/\r\n/g, '\n');
  }

  // A real directory inside root (never a link).
  async function isDir(relative) {
    try {
      return (await fs.lstat(path.join(root, relative))).isDirectory();
    } catch {
      return false;
    }
  }

  // A directory's files of this kind, sorted by name, or null when the directory isn't there.
  async function listDir(relative, extension) {
    const folder = path.join(root, relative);
    if (!(await isDir(relative))) return null;
    let entries;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch (error) {
      report(`Content ${relative.split(path.sep).join('/')}/ unavailable: ${error.message}`);
      return null;
    }
    return entries
      .filter(entry => entry.isFile() && NAME.test(entry.name) && path.extname(entry.name) === `.${extension}`)
      .map(entry => entry.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  const content = {};
  for (const key of PHASE3_KEYS) content[key] = await readJSON(`${key}.json`, { required: true });
  for (const key of FLAT_KEYS) content[key] = await readJSON(`${key}.json`);
  for (const [group, shape] of Object.entries(GROUPS)) {
    if (!(await isDir(group))) {
      content[group] = null;
      continue;
    }
    const out = {};
    for (const [sub, extension] of Object.entries(shape.dirs || {})) {
      const names = await listDir(path.join(group, sub), extension);
      if (names === null) {
        out[sub] = null;
        continue;
      }
      const files = {};
      for (const name of names) {
        const relative = path.join(group, sub, name);
        files[name.slice(0, -(extension.length + 1))] = extension === 'md' ? await readMarkdown(relative) : await readJSON(relative);
      }
      out[sub] = files;
    }
    for (const key of shape.files) out[key] = await readJSON(path.join(group, `${key}.json`));
    content[group] = orderGroup(group, out);
  }
  return content;
}

// A group's keys in §9.1's order, so the bundle always reads the same way.
function orderGroup(group, value) {
  const order = {
    combat: ['rules', 'callings', 'spells', 'leads', 'foes', 'anims', 'tuning'],
    party: ['companions', 'regulars', 'teamups', 'banter'],
    camp: ['scenes', 'talks'],
    people: ['npcs', 'folk'],
  }[group];
  return Object.fromEntries(order.map(key => [key, key in value ? value[key] : null]));
}

module.exports = { loadContent, CONTENT_DIR, LIMITS, NAME, PHASE3_KEYS, FLAT_KEYS, GROUPS };
