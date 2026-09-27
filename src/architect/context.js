// Chris's signals for the architect, and nothing else:
//   - skill names and the first 160 characters of their descriptions (~/.claude/skills/*/SKILL.md frontmatter)
//   - project folder names (C:\Users\chris\Projects\*)
//   - the names of buildings already in the village
// Only the frontmatter at the top of each SKILL.md is read (at most 8 KB), never the body, and
// nothing from sessions, transcripts, memory files or ~/.codex. Node only, read-only, synchronous
// (a handful of tiny reads) so offline suggestions stay instant.

import fs from 'node:fs';
import path from 'node:path';

export const DESCRIPTION_CHARS = 160;
export const MAX_SKILLS = 40;
export const MAX_PROJECTS = 40;
export const MAX_BUILT = 20;
const FRONTMATTER_BYTES = 8192;
const NAME_CHARS = 64;
const DEFAULT_TTL_MS = 30 * 1000;

const tidy = (value) => String(value || '')
  .replace(/[\x00-\x1f\x7f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function clip(value, max) {
  return Array.from(tidy(value)).slice(0, max).join('').trim();
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

/**
 * Reads `name` and `description` from YAML-style frontmatter. Handles plain, quoted, folded (>)
 * and literal (|) values plus indented continuation lines. Returns null without frontmatter.
 */
export function parseFrontmatter(text) {
  const source = String(text || '').replace(/^\ufeff/, '');
  const lines = source.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  const body = lines.slice(1, end === -1 ? lines.length : end);
  const fields = {};
  for (let i = 0; i < body.length; i += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(body[i]);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    const block = /^[>|][+-]?\s*$/.test(value.trim());
    const parts = block ? [] : [value];
    while (i + 1 < body.length && (/^\s+\S/.test(body[i + 1]) || (block && body[i + 1].trim() === ''))) {
      i += 1;
      parts.push(body[i].trim());
    }
    value = parts.filter((part) => part !== '').join(' ');
    fields[key] = unquote(value);
  }
  return fields;
}

function readHead(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(FRONTMATTER_BYTES);
    const bytes = fs.readSync(fd, buffer, 0, FRONTMATTER_BYTES, 0);
    return buffer.subarray(0, bytes).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isDirectory()) return true;
        if (!entry.isSymbolicLink()) return false;
        try {
          return fs.statSync(path.join(dir, entry.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** [{ name, description }] from <skillsDir>/<skill>/SKILL.md frontmatter, sorted by name. */
export function readSkills(skillsDir) {
  const skills = [];
  for (const folder of listDirs(skillsDir).sort(byName)) {
    if (folder.startsWith('.')) continue;
    const head = readHead(path.join(skillsDir, folder, 'SKILL.md'));
    if (head === null) continue;
    const fields = parseFrontmatter(head) || {};
    const name = clip(typeof fields.name === 'string' && fields.name.trim() ? fields.name : folder, NAME_CHARS);
    if (!name) continue;
    const description = clip(typeof fields.description === 'string' ? fields.description : '', DESCRIPTION_CHARS);
    skills.push({ name, description });
    if (skills.length >= MAX_SKILLS) break;
  }
  return skills;
}

/** Folder names directly inside `projectsDir`, sorted, hidden folders and node_modules left out. */
export function readProjects(projectsDir) {
  return listDirs(projectsDir)
    .filter((name) => !name.startsWith('.') && !name.startsWith('$') && name.toLowerCase() !== 'node_modules')
    .map((name) => clip(name, NAME_CHARS))
    .filter(Boolean)
    .sort(byName)
    .slice(0, MAX_PROJECTS);
}

/** Cleans the list of existing building names: strings only, trimmed, de-duplicated. */
export function cleanBuilt(built) {
  const out = [];
  for (const item of Array.isArray(built) ? built : []) {
    const name = clip(typeof item === 'string' ? item : item && (item.name || item.title), 40);
    if (name && !out.some((other) => other.toLowerCase() === name.toLowerCase())) out.push(name);
    if (out.length >= MAX_BUILT) break;
  }
  return out;
}

/**
 * Reads signals, cached briefly so a burst of calls touches the disk once.
 *   const reader = createSignalReader({ claudeHome, projectsDir });
 *   reader.read(built) -> { skills: [{ name, description }], projects: string[], built: string[] }
 */
export function createSignalReader({ claudeHome, projectsDir, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  let cache = null;
  return {
    read(built = []) {
      const time = now();
      if (!cache || time - cache.at > ttlMs || time < cache.at) {
        cache = {
          at: time,
          skills: claudeHome ? readSkills(path.join(claudeHome, 'skills')) : [],
          projects: projectsDir ? readProjects(projectsDir) : [],
        };
      }
      return {
        skills: cache.skills.map((skill) => ({ ...skill })),
        projects: [...cache.projects],
        built: cleanBuilt(built),
      };
    },
    clear() {
      cache = null;
    },
  };
}
